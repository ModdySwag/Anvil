/* Anvil — the voice-engine facade (P1): tier ladder, hello→ready handshake, live singleton.
   Contract: verify/_p1_wave.md §6. One kernel source (av_dsp.js) rides three transports:
     1. worklet:blob — AudioWorklet module via a blob: object URL
     2. worklet:data — AudioWorklet module via a data: URL
     3. spn          — ScriptProcessorNode fallback executing the SAME AVDSP kernels directly
   The ladder runs in that order (?avengine=spn|worklet|auto overrides it), every attempt is
   caught, and a tier only counts once its hello → ready handshake lands inside 2.5 s.

   LAWS preserved:
   - avEngineBoot(ctx, opts) is PURE per context: no globals, no sink, no DOM, no side effects.
     It must work for OfflineAudioContexts too (rigs render offline through the same tap chain).
   - The engine connects to avKeysFor(ctx); ctx.destination is touched only as the last resort
     when the tap cannot answer (avEngineDestFor) — never otherwise.
   - AV_WORKLET_SRC / AV_WORKLET_SHA are injected by build.py just above this part: reference,
     never define. When they are missing the worklet tiers skip gracefully (go spn) and the
     reason is recorded in the boot log.
   - No console.error anywhere on the ladder (warn at most); nothing uncaught ever reaches the
     app boot. avEngineEnsure() resolves (never rejects) — handle or null.
   - avEngineEnsure() is the ONE live singleton: one AudioContext, one promise. The avNote sink
     is registered only once a tier is ready; held notes and the avParams mirror replay then.
   - ?avtest=1 boot is identical (suites run with --autoplay-policy=no-user-gesture-required).

   Handle fields app-side code relies on: mode ('worklet'|'spn'), tier ('worklet:blob'|
   'worklet:data'|'spn' — recorded honestly), url ('blob'|'data'|null), sr, maxVoices, os,
   noteOn(midi,gain)->bool, noteOff(midi), allOff(), setParam(path,v)->bool, bench(cmd)->Promise,
   stats()->Promise, ctx, node, engine (spn), offline, degraded, log, ready. */
"use strict";

const AV_ENGINE_HELLO_MS = 2500;    /* hello → ready handshake budget (§6) */
const AV_ENGINE_RPC_MS = 5000;      /* bench/stats round-trip budget; resolves null on timeout */
const AV_ENGINE_CHIP_MS = 500;      /* header voices chip sampling, ~2 Hz (§6) */
const AV_ENGINE_SPN_FRAMES = 1024;  /* ScriptProcessor quantum (§6) */
const AV_ENGINE_SPN_MAX = 16;       /* SPN tier default voice cap — the degraded tier stays honest */
const AV_ENGINE_WORKLET_MAX = 64;   /* worklet tier default voice cap (§6 opts default) */

/* ---------- module state (avEngineBoot itself never touches any of this) ---------- */
let avEngineLiveCtx = null;          /* the one live AudioContext (avEngineEnsure only) */
let avEngineLive = null;             /* its handle, once a tier is ready */
let avEngineEnsurePromise = null;    /* the idempotent singleton boot promise */
let avEngineMsgSeq = 0;              /* hello/bench/stats message ids */
let avEngineLastLog = [];            /* the most recent boot's attempt log (diagnostics) */

const avEngineNOW = (typeof performance !== "undefined" && typeof performance.now === "function")
  ? () => performance.now()
  : () => Date.now();

function avEngineErr(e) {
  try { return String((e && (e.message || e.name)) || e) || "unknown error"; } catch (e2) { return "unknown error"; }
}
function avEngineWarn(msg) { try { console.warn("[anvil] " + msg); } catch (e) { /* console gone */ } }
function avEngineLogLine(msg) { try { console.log("[anvil] " + msg); } catch (e) { /* console gone */ } }
function avEngineNote(log, msg, warn) {
  try { log.push(msg); } catch (e) { /* log gone */ }
  if (warn) avEngineWarn(msg);
}
function avEngineNum(v) { const n = Number(v); return isFinite(n) ? n : null; }

/* ---------- the injected worklet source (build.py) ----------
   The build embeds `const AV_WORKLET_SRC = <json>` + `const AV_WORKLET_SHA = "<sha>"` right above
   this part. `typeof` keeps an uninjected build (or a TDZ read) quiet: the ladder then skips the
   worklet tiers, lands on spn, and records why. */
function avEngineWorkletSrc() {
  try { if (typeof AV_WORKLET_SRC === "string" && AV_WORKLET_SRC.length) return AV_WORKLET_SRC; } catch (e) { /* not injected */ }
  return null;
}
function avEngineWorkletSha() {
  try { if (typeof AV_WORKLET_SHA === "string" && AV_WORKLET_SHA) return AV_WORKLET_SHA; } catch (e) { /* not injected */ }
  return null;
}

/* ---------- the URL override: ?avengine=spn|worklet|auto ----------
   Consulted for LIVE contexts only. Offline contexts are rig-owned scratch renders (the alias
   rig boots them via avEngineBoot directly); the page's transport choice must never leak into
   them. An explicit opts.force always wins, for any context. */
function avEngineUrlForce() {
  try {
    if (typeof location === "undefined" || !location.search) return "auto";
    const m = /[?&]avengine=(spn|worklet|auto)(?:&|$)/i.exec(location.search);
    return m ? m[1].toLowerCase() : "auto";
  } catch (e) { return "auto"; }
}

/* ---------- destination + resume ---------- */

/* avKeysFor(ctx) is the required connection point (av_tap law): the instrument bus sits behind
   the tap chain. Reading ctx.destination here is the documented last resort — it builds the
   per-context chain when the tap exists, and is the real destination when it does not. */
function avEngineDestFor(ctx) {
  let dest = null;
  try { if (typeof avKeysFor === "function") dest = avKeysFor(ctx); } catch (e) { dest = null; }
  if (dest && typeof dest.connect === "function") return dest;
  try { return ctx.destination || null; } catch (e) { return null; }
}

function avEngineTryResume(ctx) {
  try {
    if (!ctx || typeof ctx.resume !== "function") return;
    if (typeof ctx.startRendering === "function") return;          /* offline: the render is explicit */
    if (ctx.state === "running" || ctx.state === "closed") return;
    const p = ctx.resume();
    if (p && typeof p.catch === "function") p.catch(() => { /* still gesture-gated — next gesture retries */ });
  } catch (e) { /* resume refused — gestures will retry */ }
}

/* gesture resume: the first pointerdown/keydown anywhere kicks ctx.resume() in the capture phase
   (passive — the app's own handlers are untouched); the listeners retire once running. One
   immediate guarded attempt at bind time keeps autoplay-allowed environments honest; without
   permission it silently stays pending and the gesture listeners do the work. */
function avEngineBindResume(ctx) {
  try {
    if (!ctx || typeof ctx.resume !== "function") return;
    if (typeof ctx.startRendering === "function") return;          /* offline: nothing to resume */
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
    let bound = false;
    const retire = () => {
      if (!bound) return;
      bound = false;
      try { document.removeEventListener("pointerdown", kick, true); document.removeEventListener("keydown", kick, true); } catch (e) { /* gone */ }
    };
    const kick = () => {
      try {
        if (ctx.state === "running" || ctx.state === "closed") { retire(); return; }
        const p = ctx.resume();
        if (p && typeof p.then === "function") p.then(() => { if (ctx.state === "running") retire(); }).catch(() => { /* retry next gesture */ });
      } catch (e) { /* retry on the next gesture */ }
    };
    document.addEventListener("pointerdown", kick, { capture: true, passive: true });
    document.addEventListener("keydown", kick, { capture: true, passive: true });
    bound = true;
    kick();
  } catch (e) { /* no document — nothing to bind */ }
}

/* ---------- the message port (worklet tier) ---------- */

/* one id-matched round trip on a worklet port; resolves null when the reply never lands */
function avEngineRpc(node, pend, t, extra, ms) {
  return new Promise((resolve) => {
    const id = ++avEngineMsgSeq;
    let done = false;
    let timer = null;
    const finish = (v) => {
      if (done) return;
      done = true;
      if (timer) { try { clearTimeout(timer); } catch (e) { /* ok */ } }
      try { pend.delete(id); } catch (e) { /* ok */ }
      resolve(v);
    };
    timer = setTimeout(() => finish(null), ms || AV_ENGINE_RPC_MS);
    try { pend.set(id, { finish: finish }); } catch (e) { finish(null); return; }
    try { node.port.postMessage(Object.assign({ t: t, id: id }, extra || {})); }
    catch (e) { finish(null); }
  });
}
function avEngineRpcDeliver(pend, d) {
  if (!d || d.id == null) return;
  let p = null;
  try { p = pend.get(d.id); } catch (e) { p = null; }
  if (!p || typeof p.finish !== "function") return;
  p.finish(d.data === undefined ? null : d.data);
}

/* hello → ready with the 2.5 s budget. The handler stays installed afterwards: it is also the
   dispatcher for every later bench/stats reply on this port. Messages are queued by the port
   until the handler exists, so a fast processor cannot beat us to it. */
function avEngineNodeHandshake(node, pend) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      if (timer) { try { clearTimeout(timer); } catch (e) { /* ok */ } }
      resolve(v);
    };
    node.port.onmessage = (ev) => {
      const d = ev && ev.data;
      if (!d || typeof d !== "object") return;
      if (d.t === "ready") { node.__avReady = d; finish(d); return; }
      if (d.t === "bench" || d.t === "stats") avEngineRpcDeliver(pend, d);
    };
    timer = setTimeout(() => finish(null), AV_ENGINE_HELLO_MS);
    try { node.port.postMessage({ t: "hello", id: ++avEngineMsgSeq }); } catch (e) { finish(null); }
  });
}

/* abandon a node whose tier never went ready — silent, fully guarded */
function avEngineDropNode(node) {
  try { node.port.onmessage = null; } catch (e) { /* ok */ }
  try { if (node.port && typeof node.port.close === "function") node.port.close(); } catch (e) { /* ok */ }
  try { node.disconnect(); } catch (e) { /* ok */ }
}

/* ---------- tier: worklet (blob: then data:) ---------- */

async function avEngineTryWorklet(ctx, transport, maxVoices, log) {
  const tag = "worklet:" + transport;
  try {
    if (!ctx || !ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== "function") {
      avEngineNote(log, tag + ": skipped — no audioWorklet", false);
      return null;
    }
    if (typeof AudioWorkletNode !== "function") {
      avEngineNote(log, tag + ": skipped — no AudioWorkletNode", false);
      return null;
    }
    const src = avEngineWorkletSrc();
    if (!src) {
      avEngineNote(log, tag + ": skipped — AV_WORKLET_SRC not injected", false);
      return null;
    }
    let url = null, revoke = false;
    if (transport === "blob") {
      if (typeof Blob === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
        avEngineNote(log, tag + ": skipped — no Blob/URL", false);
        return null;
      }
      url = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
      revoke = true;
    } else {
      url = "data:application/javascript;charset=utf-8," + encodeURIComponent(src);
    }
    try {
      await ctx.audioWorklet.addModule(url);
    } catch (e) {
      avEngineNote(log, tag + ": addModule failed — " + avEngineErr(e), true);
      if (revoke) { try { URL.revokeObjectURL(url); } catch (e2) { /* ok */ } }
      return null;
    }
    if (revoke) { try { URL.revokeObjectURL(url); } catch (e2) { /* module already loaded */ } }
    let node = null;
    try {
      node = new AudioWorkletNode(ctx, "av-voice", {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: { maxVoices: maxVoices },
      });
    } catch (e) {
      avEngineNote(log, tag + ": AudioWorkletNode failed — " + avEngineErr(e), true);
      return null;
    }
    const pend = new Map();
    node.__avPending = pend;
    const readyMsg = await avEngineNodeHandshake(node, pend);
    if (!readyMsg) {
      avEngineNote(log, tag + ": handshake timed out after " + AV_ENGINE_HELLO_MS + " ms", true);
      avEngineDropNode(node);
      return null;
    }
    const dest = avEngineDestFor(ctx);
    try {
      if (!dest) throw new Error("no destination");
      node.connect(dest);
    } catch (e) {
      avEngineNote(log, tag + ": connect failed — " + avEngineErr(e), true);
      avEngineDropNode(node);
      return null;
    }
    const h = avEngineMakeWorkletHandle(ctx, node, transport, readyMsg, maxVoices, log);
    avEngineNote(log, tag + ": ready (sr " + h.sr + " · " + h.maxVoices + " voices · os " + h.os + ")", false);
    return h;
  } catch (e) {
    avEngineNote(log, tag + ": failed — " + avEngineErr(e), true);
    return null;
  }
}

function avEngineNoteArgs(midi, gain) {
  const m = Math.round(Number(midi));
  if (!isFinite(m) || m < 0 || m > 127) return null;
  const g0 = Number(gain);
  return { midi: m, gain: isFinite(g0) ? Math.max(0.05, Math.min(1, g0)) : 0.9 };
}

function avEngineMakeWorkletHandle(ctx, node, transport, readyMsg, maxVoices, log) {
  const pend = node.__avPending;
  const sr = (readyMsg && avEngineNum(readyMsg.sr)) || ctx.sampleRate;
  const mv0 = readyMsg && avEngineNum(readyMsg.maxVoices);
  const os = (readyMsg && avEngineNum(readyMsg.os)) || 2;
  return {
    kind: "worklet",
    mode: "worklet",                    /* the base tier app_core/selftest reads (h.mode || h.tier) */
    tier: "worklet:" + transport,       /* the honest recorded tier (§2.2) */
    url: transport,                     /* 'blob' | 'data' */
    degraded: false,
    offline: (typeof ctx.startRendering === "function"),
    ready: true,
    ctx: ctx,
    node: node,
    engine: null,
    sr: sr,
    maxVoices: (mv0 && mv0 >= 1) ? Math.floor(mv0) : maxVoices,
    os: os,
    version: (readyMsg && readyMsg.version) || null,
    sha: avEngineWorkletSha(),
    log: log,
    noteOn: (midi, gain) => {
      avEngineTryResume(ctx);                              /* §6: also try resume inside noteOn */
      const a = avEngineNoteArgs(midi, gain);
      if (!a) return false;
      try { node.port.postMessage({ t: "note", on: true, midi: a.midi, gain: a.gain }); return true; }
      catch (e) { return false; }
    },
    noteOff: (midi) => {
      const a = avEngineNoteArgs(midi, 0.9);
      if (!a) return;
      try { node.port.postMessage({ t: "note", on: false, midi: a.midi }); } catch (e) { /* engine gone */ }
    },
    allOff: () => { try { node.port.postMessage({ t: "allOff" }); } catch (e) { /* engine gone */ } },
    /* fire-and-forget by design (k-rate law: everything arrives by port messages, §2.3); true
       means "accepted for delivery" — the processor is the authority on the path table */
    setParam: (path, v) => {
      if (typeof path !== "string" || !path) return false;
      if (typeof v === "number" ? !isFinite(v) : typeof v !== "string") return false;
      try { node.port.postMessage({ t: "param", path: path, v: v }); return true; }
      catch (e) { return false; }
    },
    /* 'read' is an id-matched round trip; 'reset' is fire-and-forget — the pinned processor
       (§5) acks read/stats only, so waiting for a reset ack would stall every rig step */
    bench: (cmd) => {
      if (cmd === "read") return avEngineRpc(node, pend, "bench", { cmd: "read" }, AV_ENGINE_RPC_MS);
      try { node.port.postMessage({ t: "bench", cmd: "reset", id: ++avEngineMsgSeq }); return Promise.resolve(true); }
      catch (e) { return Promise.resolve(null); }
    },
    stats: () => avEngineRpc(node, pend, "stats", {}, AV_ENGINE_RPC_MS),
    dispose: () => {
      try { node.port.onmessage = null; } catch (e) { /* ok */ }
      try { if (node.port && typeof node.port.close === "function") node.port.close(); } catch (e) { /* ok */ }
      try { node.disconnect(); } catch (e) { /* ok */ }
      try { if (pend) pend.forEach((p) => { if (p && typeof p.finish === "function") p.finish(null); }); } catch (e) { /* ok */ }
    },
  };
}

/* ---------- tier: spn (ScriptProcessorNode + direct AVDSP calls) ---------- */

function avEngineMakeSpnHandle(ctx, maxVoices, log) {
  if (!ctx || typeof ctx.createScriptProcessor !== "function") {
    avEngineNote(log, "spn: createScriptProcessor unavailable", true);
    return null;
  }
  if (typeof AVDSP === "undefined" || !AVDSP || typeof AVDSP.create !== "function") {
    avEngineNote(log, "spn: AVDSP unavailable", true);
    return null;
  }
  let eng = null, node = null;
  try {
    if (typeof AVDSP.buildTables === "function") AVDSP.buildTables();     /* deterministic, idempotent */
    eng = AVDSP.create({ sampleRate: ctx.sampleRate, maxVoices: maxVoices });
  } catch (e) {
    avEngineNote(log, "spn: AVDSP.create failed — " + avEngineErr(e), true);
    return null;
  }
  try {
    node = ctx.createScriptProcessor(AV_ENGINE_SPN_FRAMES, 0, 2);         /* §6 pin: 1024, 0 in, 2 out */
  } catch (e) {
    avEngineNote(log, "spn: createScriptProcessor failed — " + avEngineErr(e), true);
    return null;
  }
  const h = {
    kind: "spn",
    mode: "spn",
    tier: "spn",
    url: null,
    degraded: true,                       /* honest: main-thread rendering, 16-voice default cap */
    offline: (typeof ctx.startRendering === "function"),
    ready: true,
    ctx: ctx,
    node: node,
    engine: eng,
    sr: ctx.sampleRate,
    maxVoices: maxVoices,
    os: 2,                                /* the kernels always run 2× oversampled internally */
    version: (typeof AVDSP.version === "string") ? AVDSP.version : null,
    sha: null,
    log: log,
    noteOn: (midi, gain) => {
      avEngineTryResume(ctx);
      const a = avEngineNoteArgs(midi, gain);
      if (!a) return false;
      try { return AVDSP.noteOn(eng, a.midi, a.gain) === true; } catch (e) { return false; }
    },
    noteOff: (midi) => {
      const a = avEngineNoteArgs(midi, 0.9);
      if (!a) return;
      try { AVDSP.noteOff(eng, a.midi); } catch (e) { /* engine gone */ }
    },
    allOff: () => { try { AVDSP.allOff(eng); } catch (e) { /* engine gone */ } },
    setParam: (path, v) => { try { return AVDSP.setParam(eng, path, v) === true; } catch (e) { return false; } },
    bench: (cmd) => new Promise((resolve) => {
      try {
        if (cmd === "read") resolve(AVDSP.benchRead(eng));
        else { AVDSP.benchReset(eng); resolve(true); }
      } catch (e) { resolve(null); }
    }),
    stats: () => new Promise((resolve) => { try { resolve(AVDSP.stats(eng)); } catch (e) { resolve(null); } }),
    dispose: () => {
      try { node.onaudioprocess = null; } catch (e) { /* ok */ }
      try { node.disconnect(); } catch (e) { /* ok */ }
    },
  };
  /* the render callback: same kernels, same recordQuantum discipline as the worklet tier */
  node.onaudioprocess = (ev) => {
    try {
      const out = ev && ev.outputBuffer;
      if (!out || out.numberOfChannels < 1) return;
      const L = out.getChannelData(0);
      const R = out.numberOfChannels > 1 ? out.getChannelData(1) : L;
      const t0 = avEngineNOW();
      AVDSP.render(eng, L, R, L.length);
      AVDSP.recordQuantum(eng, (avEngineNOW() - t0) * 1000, L.length);   /* §4.1 takes µs */
    } catch (e) { /* never throw from an audio callback */ }
  };
  const dest = avEngineDestFor(ctx);
  try {
    if (!dest) throw new Error("no destination");
    node.connect(dest);
  } catch (e) {
    avEngineNote(log, "spn: connect failed — " + avEngineErr(e), true);
    try { node.onaudioprocess = null; node.disconnect(); } catch (e2) { /* ok */ }
    return null;
  }
  avEngineNote(log, "spn: ready (degraded · sr " + ctx.sampleRate + " · " + maxVoices + " voices)", false);
  return h;
}

/* ---------- avEngineBoot: the pure per-context ladder ---------- */

function avEngineBoot(ctx, opts) {
  opts = (opts && typeof opts === "object") ? opts : {};
  return new Promise((resolve) => {
    (async () => {
      const log = [];
      try {
        if (!ctx || typeof ctx !== "object" || typeof ctx.createGain !== "function") {
          avEngineNote(log, "boot: no usable AudioContext", true);
          avEngineLastLog = log;
          resolve(null);
          return;
        }
        if (ctx.state === "closed") {
          avEngineNote(log, "boot: context is closed", true);
          avEngineLastLog = log;
          resolve(null);
          return;
        }
        const offline = (opts.offline === true) || (typeof ctx.startRendering === "function");
        const explicit = (typeof opts.force === "string" && /^(spn|worklet|auto)$/i.test(opts.force))
          ? opts.force.toLowerCase() : null;
        const force = explicit || (offline ? "auto" : avEngineUrlForce());
        const want = avEngineNum(opts.maxVoices);
        const wlMax = (want && want >= 1) ? Math.floor(want) : AV_ENGINE_WORKLET_MAX;
        const spnMax = (want && want >= 1) ? Math.floor(want) : AV_ENGINE_SPN_MAX;
        avEngineNote(log, "boot: force=" + force + (offline ? " · offline" : " · live"), false);
        let h = null;
        if (force !== "spn") {
          /* blob: worklets from a file: page have an opaque origin and are refused by
             Chromium-family browsers (probe-verified 2026-10-07) — skip straight to data: on
             file: pages (which load fine); http(s) keeps the pinned blob-first order */
          const filePage = (typeof location !== "undefined" && location.protocol === "file:");
          if (!filePage) h = await avEngineTryWorklet(ctx, "blob", wlMax, log);
          if (!h) h = await avEngineTryWorklet(ctx, "data", wlMax, log);
        }
        if (!h && force !== "worklet") h = avEngineMakeSpnHandle(ctx, spnMax, log);
        avEngineLastLog = log;
        resolve(h);
      } catch (e) {
        avEngineNote(log, "boot: " + avEngineErr(e), true);
        avEngineLastLog = log;
        resolve(null);
      }
    })();
  });
}

/* ---------- the live singleton: avEngineEnsure ---------- */

/* window.__avEngine exactly as §6 specifies; the failure shape keeps the same surface with
   ready:false so callers can probe it either way */
function avEngineSetWindow(h, err) {
  try {
    if (typeof window === "undefined") return;
    if (h) {
      window.__avEngine = {
        ready: true,
        tier: h.mode,                   /* §6: 'worklet' | 'spn' */
        url: h.url,                     /* §6: 'blob' | 'data' | null */
        error: null,
        sr: h.sr,
        maxVoices: h.maxVoices,
        os: h.os,
        noteOn: (midi, gain) => h.noteOn(midi, gain),
        noteOff: (midi) => h.noteOff(midi),
        allOff: () => h.allOff(),
        setParam: (path, v) => h.setParam(path, v),
        bench: (cmd) => h.bench(cmd),
        stats: () => h.stats(),
        handle: h,
      };
    } else {
      window.__avEngine = {
        ready: false,
        tier: null,
        url: null,
        error: String(err || "engine unavailable"),
        sr: (avEngineLiveCtx && avEngineLiveCtx.sampleRate) || null,
        maxVoices: 0,
        os: 0,
        noteOn: () => false,
        noteOff: () => {},
        allOff: () => {},
        setParam: () => false,
        bench: () => Promise.resolve(null),
        stats: () => Promise.resolve(null),
        handle: null,
      };
    }
  } catch (e) { /* no window — nothing to publish */ }
}

/* the avNote sink goes in only when a tier is ready (a failed engine must not eat notes) */
function avEngineRegisterSink(h) {
  try {
    if (typeof avNoteSetSink !== "function") return;
    avNoteSetSink({
      on: (midi, gain) => h.noteOn(midi, gain),
      off: (midi) => { h.noteOff(midi); },
      allOff: () => { h.allOff(); },
    });
  } catch (e) { avEngineWarn("note sink registration failed — " + avEngineErr(e)); }
}

/* notes the user was already holding while the engine booted replay through the fresh sink */
function avEngineReplayHeld(h) {
  try {
    if (typeof avNoteState !== "function") return;
    const st = avNoteState();
    const held = (st && st.held) || [];
    for (let i = 0; i < held.length; i++) {
      const name = held[i];
      const midi = (typeof avNoteParse === "function") ? avNoteParse(name) : null;
      if (midi == null) continue;
      const gain = (typeof avNoteGain === "function") ? avNoteGain(name) : 0.9;
      try { h.noteOn(midi, gain); } catch (e) { /* one lost note is not a boot failure */ }
    }
  } catch (e) { /* replay is best effort */ }
}

/* the avParams mirror (knob defaults + live commits) replays into the engine */
function avEngineReplayParams(h) {
  try {
    if (typeof avParams === "undefined" || !avParams) return;
    for (const path in avParams) {
      if (!Object.prototype.hasOwnProperty.call(avParams, path)) continue;
      try { h.setParam(path, avParams[path]); } catch (e) { /* keep replaying */ }
    }
  } catch (e) { /* best effort */ }
}

function avEngineTierChip(tierText) {
  try {
    if (typeof document === "undefined" || !document.getElementById) return;
    const el = document.getElementById("av-tier");
    if (!el) return;
    const cur = String(el.textContent || "");
    const tapPart = /UNAVAILABLE/i.test(cur) ? "tap: UNAVAILABLE" : "tap: armed";
    el.textContent = tapPart + " · engine: " + tierText;
  } catch (e) { /* chip is a nicety */ }
}

/* voices: n/max, sampled ~2 Hz; retires itself when the context dies */
function avEngineStartVoiceChip(h) {
  try {
    if (typeof document === "undefined" || !document.getElementById || typeof setInterval !== "function") return;
    const el = document.getElementById("av-voices");
    if (!el) return;
    let timer = null, busy = false;
    const tick = async () => {
      try {
        if (!h.ctx || h.ctx.state === "closed") { if (timer) { clearInterval(timer); timer = null; } return; }
        if (busy) return;
        busy = true;
        let s = null;
        try { s = await h.stats(); } catch (e) { s = null; }
        busy = false;
        if (!s || !isFinite(s.active)) return;
        const mx = isFinite(s.maxVoices) && s.maxVoices > 0 ? s.maxVoices : h.maxVoices;
        el.textContent = "voices: " + (s.active + 0) + "/" + mx;
      } catch (e) { busy = false; }
    };
    tick();
    timer = setInterval(tick, AV_ENGINE_CHIP_MS);
  } catch (e) { /* chip is a nicety */ }
}

function avEngineFailEnsure(reason) {
  const r = String(reason || "engine unavailable");
  try { if (typeof document !== "undefined" && document.documentElement) document.documentElement.setAttribute("data-av-engine", "failed"); } catch (e) { /* ok */ }
  avEngineSetWindow(null, r);
  avEngineTierChip("failed");
  avEngineWarn("engine failed — " + r);
}

function avEngineEnsure(opts) {
  if (avEngineEnsurePromise) return avEngineEnsurePromise;
  avEngineEnsurePromise = (async () => {
    let ctx = null;
    try {
      try {
        if (typeof AudioContext === "undefined") throw new Error("AudioContext unavailable");
        ctx = new AudioContext({ latencyHint: "interactive" });     /* §6 pin */
      } catch (e) {
        avEngineFailEnsure("context — " + avEngineErr(e));
        return null;
      }
      avEngineLiveCtx = ctx;
      const force = (opts && typeof opts.force === "string") ? opts.force : undefined;
      const h = await avEngineBoot(ctx, { force: force });
      if (!h) {
        avEngineFailEnsure(avEngineLastLog.length ? avEngineLastLog.join(" | ") : "no tier available");
        return null;
      }
      avEngineLive = h;
      try { document.documentElement.setAttribute("data-av-engine", h.mode); } catch (e) { /* attribute is a nicety */ }
      avEngineSetWindow(h, null);
      avEngineRegisterSink(h);
      avEngineReplayHeld(h);
      avEngineReplayParams(h);
      avEngineTierChip(h.mode);
      avEngineStartVoiceChip(h);
      avEngineBindResume(ctx);
      avEngineLogLine("engine ready — " + h.tier + " · sr " + h.sr + " · voices " + h.maxVoices);
      return h;
    } catch (e) {
      avEngineFailEnsure("ensure — " + avEngineErr(e));
      return null;
    }
  })();
  return avEngineEnsurePromise;
}
