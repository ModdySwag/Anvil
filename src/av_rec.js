/* Anvil — recorder core (P2, child E): capture the MASTER tap → a clean 16-bit stereo WAV.
   avRecInit() arms the UI row (parent-owned host #av-rec-host, absent-safe); avRecStart() wires a
   capture branch onto the live MASTER tap node; avRecStop() tears it down and returns the take as
   { ok, seconds, bytes, blob, url, ... } — plus a blob: object URL as the download handle.

   LAWS (from src/av_tap.js — read before this file):
   - The recorder rides the MASTER node (avMasterNodes() / avMasterFor(ctx)) — post both buses, so
     what the meters see is what gets recorded. Offline renders are never registered live by the
     tap, and this module only ever picks from avTap.live / avTap.ctx, so bounces are excluded.
   - The capture node cannot disturb the chain: ScriptProcessor(4096, 2, 2) rides a PARALLEL
     branch — master → sp → gain-0 sink → the REAL destination. The sp's outputBuffer is never
     written (the branch emits pure zeros), and the sink is gain 0 as belt-and-braces. The sink
     goes to the real destination, NEVER back into the tap bus (a loop through master would be a
     Web-Audio cycle and Chrome mutes cycles).
   - Track-before-wire (PF audit LIFE-10): nodes are stored on the module state BEFORE any connect,
     so a throw halfway can never strand a connected node on the master bus; avRecRelease() is
     idempotent and full.
   - Stop keeps capturing through a short settle window (AV_REC_SETTLE_MS) so the final partial
     block lands; the take's own seconds/frames describe exactly what was captured.

   RATE: 48 kHz native. The WAV header carries ctx.sampleRate (48 k on every typical engine ctx).
   The planned 44.1 k default out-rate depends on the export resampler that lands later; naive
   linear resampling here would trade audible aliasing for a nominal rate, so P2 writes the native
   rate and documents the deferral. Consumers (DAWs, players) all take 48 k happily.

   LAWS (module craft): allocations happen at BLOCK rate only (one 4096-frame copy per ~85 ms,
   main-thread SPN callback — PF's recorder discipline); no allocation, DOM or throw inside any
   per-sample path; one av- prefix over the whole surface (page module — matches av_tap.js style).

   API: avRecInit() -> { ok, host, version, classes }
        avRecStart() -> { ok, sampleRate, block, capture } | { ok:false, error }
        avRecStop() -> Promise<{ ok, seconds, bytes, blob, url, frames, sampleRate, wallSeconds,
                                 capture, peak, mime } | { ok:false, error }>   (await it)
        avRecStats() -> { recording, seconds }
        avRecSnap() -> diagnostics snapshot (rigs read this; no live nodes leak out)
        avRecClasses() -> CSS class list · avRecDownload() -> re-click the last take's handle
   CSS classes returned for the parent's UI row: av-rec-row · av-rec-btn · av-rec-time ·
   av-rec-state · av-rec-link · av-rec-on (recording) · av-rec-err (failure) — reuses av-btn /
   av-dim from the existing sheet. */
"use strict";

const AV_REC_VERSION = "p2.0";
const AV_REC_BLOCK = 4096;                 /* ScriptProcessor quantum — spec pin (§5) */
const AV_REC_SETTLE_MS = 180;              /* stop: keep capturing ~2 blocks so the tail lands */
const AV_REC_FILENAME = "anvil-rec.wav";
const AV_REC_CLASSES = Object.freeze(["av-rec-row", "av-rec-btn", "av-rec-time", "av-rec-state", "av-rec-link", "av-rec-on", "av-rec-err"]);

/* ---------- module state (never holds DOM nodes except the host row) ---------- */
const avRec = {
  inited: false,
  recording: false,
  stopping: false,
  capturing: false,
  ctx: null,          /* the context under capture (live only) */
  master: null,       /* the MASTER tap node the branch hangs off */
  sp: null,           /* the pass-through capture node */
  sink: null,         /* the gain-0 pull-down sink */
  chunks: [],         /* [{ l, r }] — one entry per captured block */
  frames: 0,
  sampleRate: 48000,
  startedWall: 0,     /* set lazily on the FIRST captured block (honest capture span) */
  stoppedWall: 0,
  finalWall: 0,
  peak: 0,
  tick: null,         /* UI readout interval while armed */
  host: null,
  hostBound: false,
  lastUrl: null,
  lastBlob: null,
  lastBytes: 0,
  lastSeconds: 0,
  lastFrames: 0,
  error: null,
};

const avRecNow = (typeof performance !== "undefined" && typeof performance.now === "function")
  ? () => performance.now()
  : () => Date.now();

function avRecErr(e) {
  try { return String((e && (e.message || e.name)) || e) || "unknown error"; } catch (e2) { return "unknown error"; }
}
function avRecWarn(msg) {
  try { if (typeof console !== "undefined" && console.warn) console.warn("[anvil] " + msg); } catch (e) { /* console gone */ }
}

/* ---------- target: the live MASTER tap node (tap law: live contexts only) ---------- */
function avRecTap() {
  try { if (typeof avTap !== "undefined" && avTap) return avTap; } catch (e) { /* not loaded */ }
  try { if (typeof window !== "undefined" && window.__avTap) return window.__avTap; } catch (e2) { /* no window */ }
  return null;
}

function avRecPickTarget() {
  const t = avRecTap();
  let ctx = null, master = null, real = null;
  try {
    const live = (t && Array.isArray(t.live)) ? t.live.filter(c => c && c.state !== "closed") : [];
    if (t && t.ctx && t.ctx.state !== "closed") ctx = t.ctx;
    else if (live.length) ctx = live[live.length - 1];
    if (ctx) {
      try { if (typeof avMasterFor === "function") master = avMasterFor(ctx); } catch (e) { master = null; }
      if (!master && t && t.node && t.node.context === ctx) master = t.node;
      try { if (t && t.real && t.real.context === ctx) real = t.real; } catch (e2) { real = null; }
    }
  } catch (e) { ctx = null; master = null; real = null; }
  return { ctx: ctx, master: (master && master.gain) ? master : null, real: real };
}

/* ---------- capture: the pass-through ScriptProcessor ----------
   The callback runs on the main thread (SPN's nature). It copies each 4096-frame block — the
   inputBuffer is recycled by the browser, so a copy is mandatory; block-rate allocation only.
   The outputBuffer is deliberately never written: the branch is silent by construction. */
function avRecProcess(ev) {
  try {
    if (!avRec.capturing) return;
    const inp = ev && ev.inputBuffer;
    if (!inp || typeof inp.getChannelData !== "function" || !inp.numberOfChannels) return;
    const c0 = inp.getChannelData(0);
    if (!c0 || !c0.length) return;
    const n = c0.length;
    const l = new Float32Array(n);
    l.set(c0);
    let r = l;
    if (inp.numberOfChannels > 1) {
      const c1 = inp.getChannelData(1);
      if (c1 !== c0) { r = new Float32Array(n); r.set(c1); }
    }
    let pk = avRec.peak;
    for (let i = 0; i < n; i++) { const a = l[i] < 0 ? -l[i] : l[i]; if (a > pk) pk = a; }
    if (r !== l) for (let i = 0; i < n; i++) { const a = r[i] < 0 ? -r[i] : r[i]; if (a > pk) pk = a; }
    avRec.peak = pk > 1.2 ? 1.2 : pk;
    if (!avRec.frames) avRec.startedWall = avRecNow();      /* first block: capture span starts */
    avRec.chunks.push({ l: l, r: r });
    avRec.frames += n;
  } catch (e) { /* capture must never throw; a lost block beats a broken page */ }
}

/* ---------- collect + WAV encoder (own code; PF's writer read for the approach only) ---------- */
function avRecCollect() {
  const chunks = avRec.chunks;
  let total = 0;
  for (let i = 0; i < chunks.length; i++) total += chunks[i].l.length;
  const L = new Float32Array(total), R = new Float32Array(total);
  let o = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    L.set(c.l, o);
    R.set(c.r, o);
    o += c.l.length;
  }
  avRec.chunks = [];
  return [L, R];
}

/* 16-bit PCM stereo WAV. Clamps to [-1, 1] (NaN → 0); clamps int16 exactly; little-endian. */
function avRecEncodeWav(channels, sampleRate) {
  const chans = (Array.isArray(channels) && channels.length) ? channels : [new Float32Array(0)];
  const nch = Math.max(1, Math.min(2, chans.length));
  const frames = (chans[0] && chans[0].length) || 0;
  const bits = 16;                     /* P2 pins 16-bit PCM */
  const bytesPerSample = bits >> 3;
  const dataBytes = frames * nch * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataBytes);
  const dv = new DataView(buf);
  let o = 0;
  const u32 = (v) => { dv.setUint32(o, v >>> 0, true); o += 4; };
  const u16 = (v) => { dv.setUint16(o, v & 0xffff, true); o += 2; };
  const tag = (s) => {
    dv.setUint8(o++, s.charCodeAt(0) & 255); dv.setUint8(o++, s.charCodeAt(1) & 255);
    dv.setUint8(o++, s.charCodeAt(2) & 255); dv.setUint8(o++, s.charCodeAt(3) & 255);
  };
  tag("RIFF"); u32(36 + dataBytes); tag("WAVE");
  tag("fmt "); u32(16); u16(1); u16(nch); u32(sampleRate);
  u32(sampleRate * nch * bytesPerSample); u16(nch * bytesPerSample); u16(bits);
  tag("data"); u32(dataBytes);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      let v = chans[c][i];
      if (!(v >= -1 && v <= 1)) v = v > 1 ? 1 : (v < -1 ? -1 : 0);   /* clamp + NaN → 0 */
      dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(v * 32767))), true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}

/* ---------- teardown (idempotent — start failure, stop, and re-start all call it) ---------- */
function avRecRelease() {
  try { const m = avRec.master, s = avRec.sp; if (m && s && typeof m.disconnect === "function") m.disconnect(s); } catch (e) { /* never wired */ }
  try { const s = avRec.sp; if (s) { s.onaudioprocess = null; s.disconnect(); } } catch (e2) { /* gone */ }
  try { const sk = avRec.sink; if (sk) sk.disconnect(); } catch (e3) { /* gone */ }
  avRec.sp = null;
  avRec.sink = null;
  avRec.master = null;
  avRec.ctx = null;
  avRec.capturing = false;
}

/* ---------- start / stop ---------- */
function avRecStart() {
  try {
    if (avRec.recording) return { ok: false, error: "already recording" };
    if (avRec.stopping) return { ok: false, error: "stop still settling — one moment" };
    const pick = avRecPickTarget();
    if (!pick.ctx || !pick.master) return { ok: false, error: "no live master tap — play the engine once (a key or note) so its AudioContext exists" };
    const ctx = pick.ctx;
    if (ctx.state === "suspended") {
      try { const p = ctx.resume(); if (p && typeof p.catch === "function") p.catch(() => { /* gesture-gated */ }); } catch (e) { /* retry on click */ }
      return { ok: false, error: "audio context is suspended — resuming; press REC again in a moment" };
    }
    if (ctx.state === "closed") return { ok: false, error: "audio context is closed" };
    if (!pick.real) return { ok: false, error: "tap real output unavailable for this context — cannot pull the capture branch" };
    if (typeof ctx.createScriptProcessor !== "function") return { ok: false, error: "ScriptProcessorNode unavailable in this browser" };
    const sampleRate = ctx.sampleRate || 48000;
    let sp = null, sink = null;
    try {
      sp = ctx.createScriptProcessor(AV_REC_BLOCK, 2, 2);
      sp.onaudioprocess = avRecProcess;
      sink = ctx.createGain();
      sink.gain.value = 0;                              /* belt-and-braces: the branch is silent twice over */
      /* track BEFORE wiring (PF audit LIFE-10) — a throw below can never strand a live node */
      avRec.ctx = ctx;
      avRec.master = pick.master;
      avRec.sp = sp;
      avRec.sink = sink;
      avRec.sampleRate = sampleRate;
      pick.master.connect(sp);
      sp.connect(sink);
      sink.connect(pick.real);                          /* the REAL destination — never the tap bus */
    } catch (e) {
      avRecRelease();
      avRec.error = avRecErr(e);
      avRecWarn("recorder capture start failed — " + avRec.error);
      return { ok: false, error: "capture start failed — " + avRec.error };
    }
    avRec.chunks = [];
    avRec.frames = 0;
    avRec.peak = 0;
    avRec.error = null;
    avRec.startedWall = 0;
    avRec.stoppedWall = 0;
    avRec.finalWall = 0;
    avRec.capturing = true;
    avRec.recording = true;
    avRec.stopping = false;
    avRecTickStart();
    avRecPaint();
    return { ok: true, sampleRate: sampleRate, block: AV_REC_BLOCK, capture: "scriptprocessor", version: AV_REC_VERSION };
  } catch (e) {
    return { ok: false, error: avRecErr(e) };
  }
}

function avRecStop() {
  if (!avRec.recording || avRec.stopping) {
    return Promise.resolve({ ok: false, error: avRec.stopping ? "already stopping" : "not recording" });
  }
  avRec.recording = false;
  avRec.stopping = true;
  avRec.stoppedWall = avRecNow();
  avRecTickStop();
  avRecPaint();
  return new Promise((resolve) => {
    const finish = () => {
      try {
        avRec.capturing = false;
        avRec.finalWall = avRecNow();
        const sampleRate = avRec.sampleRate || 48000;
        const frames = avRec.frames;
        const seconds = frames / sampleRate;
        const wallSeconds = (avRec.startedWall > 0 && avRec.finalWall > avRec.startedWall)
          ? (avRec.finalWall - avRec.startedWall) / 1000 : 0;
        const channels = avRecCollect();
        const bytes = avRecEncodeWav(channels, sampleRate);
        const blob = new Blob([bytes], { type: "audio/wav" });
        if (avRec.lastUrl) { try { URL.revokeObjectURL(avRec.lastUrl); } catch (e) { /* already revoked */ } }
        let url = null;
        try { url = URL.createObjectURL(blob); } catch (e) { url = null; }
        avRec.lastUrl = url;
        avRec.lastBlob = blob;
        avRec.lastBytes = bytes.length;
        avRec.lastSeconds = seconds;
        avRec.lastFrames = frames;
        avRecLinkApply();
        avRecPaint();
        resolve({
          ok: bytes.length > 44 && frames > 0, seconds: seconds, bytes: bytes.length, blob: blob,
          url: url, frames: frames, sampleRate: sampleRate, wallSeconds: wallSeconds,
          capture: "scriptprocessor", peak: avRec.peak, mime: "audio/wav",
        });
      } catch (e) {
        resolve({ ok: false, error: avRecErr(e) });
      } finally {
        avRec.stopping = false;
        avRecRelease();
      }
    };
    /* settle window: the audio thread may still owe us one block — keep capturing, then finish */
    if (typeof setTimeout === "function") setTimeout(finish, AV_REC_SETTLE_MS);
    else finish();
  });
}

/* ---------- stats / snapshot ---------- */
function avRecStats() {
  return {
    recording: avRec.recording === true,
    seconds: avRec.recording ? (avRec.frames / (avRec.sampleRate || 48000)) : 0,
  };
}

function avRecSnap() {
  return {
    version: AV_REC_VERSION,
    inited: avRec.inited === true,
    recording: avRec.recording === true,
    stopping: avRec.stopping === true,
    seconds: avRec.frames / (avRec.sampleRate || 48000),
    frames: avRec.frames,
    sampleRate: avRec.sampleRate,
    wired: !!(avRec.sp && avRec.sink && avRec.master),
    capture: "scriptprocessor",
    block: AV_REC_BLOCK,
    peak: avRec.peak,
    error: avRec.error,
    last: avRec.lastUrl ? { seconds: avRec.lastSeconds, frames: avRec.lastFrames, bytes: avRec.lastBytes, url: true } : null,
    host: !!(avRec.host && avRec.host.isConnected),
  };
}

/* ---------- UI row (parent-owned host #av-rec-host — fully optional) ---------- */
const avRecEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function avRecHostWire() {
  try {
    if (typeof document === "undefined" || !document.getElementById) return false;
    const host = document.getElementById("av-rec-host");
    if (!host) return false;
    if (avRec.host === host && avRec.hostBound && host.isConnected !== false) return true;
    avRec.host = host;
    host.innerHTML =
      '<div class="av-rec-row">' +
      '<button class="av-btn av-rec-btn" type="button" data-rec="toggle" aria-label="Record the master output">&#9679; REC</button>' +
      '<span class="av-rec-time" data-rec="time">0.0 s</span>' +
      '<span class="av-rec-state av-dim" data-rec="state">idle</span>' +
      '<a class="av-rec-link" data-rec="download" download="' + avRecEsc(AV_REC_FILENAME) + '" hidden>save WAV</a>' +
      "</div>";
    const btn = host.querySelector('[data-rec="toggle"]');
    if (btn) btn.addEventListener("click", () => {
      try { if (avRec.recording || avRec.stopping) avRecStop(); else avRecStart(); } catch (e) { /* guarded */ }
    });
    avRec.hostBound = true;
    avRecPaint();
    return true;
  } catch (e) { return false; }
}

function avRecLinkApply() {
  try {
    if (!avRec.host) return;
    const a = avRec.host.querySelector('[data-rec="download"]');
    if (!a) return;
    if (avRec.lastUrl) { a.href = avRec.lastUrl; a.hidden = false; }
    else { a.removeAttribute("href"); a.hidden = true; }
  } catch (e) { /* UI is a nicety */ }
}

function avRecTimePaint() {
  try {
    if (!avRec.host) return;
    const t = avRec.host.querySelector('[data-rec="time"]');
    if (t) t.textContent = (avRec.frames / (avRec.sampleRate || 48000)).toFixed(1) + " s";
  } catch (e) { /* nicety */ }
}

function avRecPaint() {
  try {
    const host = avRec.host;
    if (!host) return;
    const row = host.querySelector(".av-rec-row");
    if (row && row.classList) {
      row.classList.toggle("av-rec-on", !!(avRec.recording || avRec.stopping));
      row.classList.toggle("av-rec-err", !!avRec.error);
    }
    const btn = host.querySelector('[data-rec="toggle"]');
    if (btn) { btn.textContent = (avRec.recording || avRec.stopping) ? "\u25a0 STOP" : "\u25cf REC"; }
    const st = host.querySelector('[data-rec="state"]');
    if (st) {
      st.textContent = avRec.error ? ("error — " + avRec.error)
        : avRec.recording ? "recording"
          : avRec.stopping ? "saving\u2026"
            : (avRec.lastUrl ? ("saved " + avRec.lastSeconds.toFixed(1) + " s \u00b7 " + Math.round(avRec.lastBytes / 1024) + " KB") : "idle");
    }
    avRecTimePaint();
    avRecLinkApply();
  } catch (e) { /* nicety */ }
}

function avRecTickStart() {
  try {
    if (avRec.tick || typeof setInterval !== "function") return;
    avRec.tick = setInterval(() => { if (avRec.recording || avRec.stopping) avRecTimePaint(); }, 100);
  } catch (e) { /* nicety */ }
}
function avRecTickStop() {
  try { if (avRec.tick) { clearInterval(avRec.tick); avRec.tick = null; } } catch (e) { avRec.tick = null; }
}

/* ---------- download handle ---------- */
function avRecDownload() {
  try {
    if (!avRec.lastUrl || typeof document === "undefined") return false;
    const a = document.createElement("a");
    a.href = avRec.lastUrl;
    a.download = AV_REC_FILENAME;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    try { if (typeof window !== "undefined") window.__avRecLastDownload = { bytes: avRec.lastBytes, at: Date.now() }; } catch (e) { /* ok */ }
    return true;
  } catch (e) { return false; }
}

/* ---------- init ---------- */
function avRecInit() {
  try { avRecHostWire(); } catch (e) { /* host is parent-owned; absence is fine */ }
  avRec.inited = true;
  return { ok: true, host: !!avRec.host, version: AV_REC_VERSION, classes: AV_REC_CLASSES.slice() };
}

function avRecClasses() { return AV_REC_CLASSES.slice(); }

if (typeof window !== "undefined") {
  window.__avRec = {
    version: AV_REC_VERSION,
    init: avRecInit,
    start: avRecStart,
    stop: avRecStop,
    stats: avRecStats,
    snap: avRecSnap,
    classes: avRecClasses,
    download: avRecDownload,
  };
}
