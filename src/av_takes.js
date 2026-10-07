/* av_takes.js — Anvil S1 record core (child C, verify/_s1_wave.md §2.3): the armed take recorder
   — records the DRY input (avInputNode() output: post input-gain, pre-master; av_input.js owns
   that node) through a parallel capture branch, splits lap takes on the transport cycle and keeps
   takes in memory as per-take Float32 arrays; avTakesExport() encodes one take via avWavEncode.

   CRAFT (mirrors src/av_rec.js — read it first):
   - Track-before-wire (PF audit LIFE-10): every node is stored on the module state BEFORE any
     connect, so a throw halfway can never strand a live node on the input gain. avTakesRelease()
     is idempotent and full (start failure, stop, abort and re-start all call it).
   - Parallel branch: inputGain → sp → gain-0 sink → avTap.real (guarded; the REAL destination is
     the terminal fallback — never back into the bus chain: a loop through master would be a
     Web-Audio cycle and Chrome mutes cycles). sp's outputBuffer is never written: the branch is
     silent twice over. ScriptProcessorNode(4096, ch, ch) — the input node's channel count (1..2).
   - Block-rate chunk copies only (SPN's recycled inputBuffer mandates a copy — one 4096-frame
     copy per ~85 ms, main-thread callback; av_rec discipline). No per-sample allocation, no DOM
     and no throw inside the capture path; a dropped block beats a broken page.
   - Stop keeps capturing through a short settle window (AV_TAKES_SETTLE_MS) so the final
     partial block lands; the take's own frames/seconds describe exactly what was captured.
     avTakesStop() returns a receipt that is ALSO thenable — `await avTakesStop()` yields the
     settled final receipt (the sync fields describe the moment of the stop request).

   LAP LAW (§2.3): avTakesStart({lapSync:true}) splits the recording into one take per transport
   cycle when avSeqIsPlaying() is live (guarded) and avSeqSnap() answers:
     cycleSteps = longest track len, floor 16, clamped 1..64   (the avSeqSchedCycleLen law)
     stepDur    = 60/bpm/4 (grid "16") | 60/bpm/3 (grid "8t")  (the avSeqSchedGridDur law)
     cycleDur   = cycleSteps · stepDur                          (PURE — computed once at start)
   bpm prefers the live avState.bpm overlay (guarded) over the snapshot's — identical to the
   scheduler's pattern-view law, so the grid the transport actually runs is the grid we split on.
   Boundaries are laid out analytically in the SAMPLE domain from the first captured block:
   boundaryFrame(k) = k · round(cycleDur · sampleRate); when a captured block crosses a boundary
   it is split EXACTLY there (sub-copies at block rate), the finished lap closes and the next
   opens. The live avSeqSchedNow() clock (guarded; the capture ctx's currentTime as fallback) is
   the second trigger: if it reports the boundary time has passed while frames lag (a stall), the
   lap closes honestly at the block start — the sample count and the clock can never disagree
   silently. Every completed cycle becomes a take (lap n); the final partial lap is kept and
   marked partial:true. No transport → one continuous take (cycleDur 0, partial false). Take
   content is delayed vs the transport by the input latency δ; each take carries
   offsetFrames = avInputLatency().totalFrames (honest) so playback can compensate.

   MEMORY CAP (§5): a single take is capped at 300 s — when the cap is reached the recorder
   ends itself (release + finalize, no settle) and marks the session capped:true /
   stopReason:'cap' (read avTakesState().lastReceipt). Per-take Float32 arrays only; WAV bytes
   exist only inside an export call.

   TAKE MODEL: { id:'t1'…, name:'Take 1', frames, rate, channels (1|2), lap, partial,
   offsetFrames, startedCtxT, seconds, data:[Float32Array,…] }. Mono sources keep one data
   channel and export duplicated to stereo (avWavEncode wants l+r; 16-bit default), file name
   `anvil_take<N>_lap<n>.wav` (N = the id's number, n = the lap).

   ARMING: avTakesArm(true) pre-arms when the input node is live (false = refuse). A start with
   live input is allowed even when not pre-armed — it arms implicitly (the REC button's flow per
   §2.4 never mentions a separate arm step). Refusal 'input not enabled' fires exactly when no
   live input node / no armed input exists. avTakesArm(false) while recording runs a normal stop
   (takes are kept); avTakesAbort() discards instead.

   API (§2.3 pin): avTakesInit() -> boolean · avTakesArm(on) -> armed boolean ·
   avTakesStart({lapSync}) -> Promise<receipt> · avTakesStop() -> receipt (thenable) ·
   avTakesAbort() · avTakesList() -> [take-meta] · avTakesExport(id) -> Promise<{ok,id,name,
   bytes,blob,url,wavInfo,seconds}> · avTakesDelete(id) · avTakesKeepLast(n) 0..32 (default 8,
   enforced on stop) · avTakesState() · avTakesClasses() -> string[] · window.__avTakes (debug
   handle — snapshots only, no live nodes leak).

   LAWS: "use strict"; classic script (no modules); node-loadable (no DOM at load; the only
   top-level browser touch is the guarded typeof window probe at the end); one namespace
   (avTakes* / AV_TAKES_*); never throws; honest refusals everywhere. Export `bytes` is the WAV
   byte COUNT (the av_rec receipt convention); the raw bytes ride `blob` (blob.arrayBuffer()). */

"use strict";

const AV_TAKES_VERSION = "s1.0";
const AV_TAKES_BLOCK = 4096;                 /* ScriptProcessor quantum (§2.3 pin) */
const AV_TAKES_SETTLE_MS = 180;              /* stop: keep capturing ~2 blocks so the tail lands */
const AV_TAKES_MAX_SECONDS = 300;            /* §5: single-take memory cap (auto-end, honest) */
const AV_TAKES_KEEP_DEF = 8;                 /* §2.3: keepLast default */
const AV_TAKES_KEEP_MAX = 32;
const AV_TAKES_LEN_DEF = 16;                 /* avSeqSchedCycleLen/avBounceCycleLen floor */
const AV_TAKES_STEPS_MAX = 64;
const AV_TAKES_TRACKS = 4;
const AV_TAKES_BPM_DEF = 120;
const AV_TAKES_BPM_MIN = 20;
const AV_TAKES_BPM_MAX = 300;
const AV_TAKES_WAV_BITS = 16;                /* §2.3: takes export 16-bit by default */
const AV_TAKES_CLASSES = Object.freeze([
  "av-takes-row", "av-takes-btn", "av-takes-list", "av-takes-item", "av-takes-name",
  "av-takes-meta", "av-takes-lap", "av-takes-partial", "av-takes-export", "av-takes-del",
  "av-takes-status", "av-takes-arm", "av-takes-on", "av-takes-err",
]);

/* ---------- module state (never holds DOM nodes; nodes only while capturing) ---------- */

const avTakes = {
  inited: false,
  armed: false,
  recording: false,
  stopping: false,
  capturing: false,
  ctx: null,              /* capture context (live only) */
  input: null,            /* avInputNode() the branch hangs off */
  sp: null,               /* pass-through capture node */
  sink: null,             /* gain-0 pull-down sink */
  sr: 48000,
  startedCtxT: null,      /* avSeqSchedNow seconds at start (null = unavailable) */
  startedWall: 0,
  stoppedWall: 0,
  finalWall: 0,
  captureWall: 0,         /* first captured block (honest capture span) */
  offsetFrames: 0,
  lapSyncActive: false,
  cycleSteps: 0,
  stepDur: 0,
  cycleDur: 0,
  cycleFrames: 0,
  laps: [],               /* session laps: [{ lap, frames, chunks, mono, startedCtxT, closed }] */
  lapSeq: 1,
  totalFrames: 0,
  takes: [],              /* finalized takes (newest last; keepLast trims from the front) */
  nextId: 1,
  keepLast: AV_TAKES_KEEP_DEF,
  peak: 0,
  capped: false,
  capFrames: 0,
  capKicked: false,
  stopReason: null,
  error: null,
  lastExport: null,
  lastUrlKeep: null,      /* the settled export's object URL (revoked on the next export) */
  lastReceipt: null,
  stopResolve: null,
};

const avTakesNowMs = (typeof performance !== "undefined" && typeof performance.now === "function")
  ? () => performance.now()
  : () => Date.now();

function avTakesErr(e) {
  try { return String((e && (e.message || e.name)) || e) || "unknown error"; } catch (e2) { return "unknown error"; }
}

/* ---------- pure helpers (the lap law) ---------- */

function avTakesClampNum(v, dflt, lo, hi) {
  const n = Number(v);
  if (v == null || v === "" || !isFinite(n)) return dflt;
  return n < lo ? lo : (n > hi ? hi : n);
}
function avTakesClampInt(v, dflt, lo, hi) {
  const n = Number(v);
  if (v == null || v === "" || !isFinite(n)) return dflt;
  const r = Math.round(n);
  return r < lo ? lo : (r > hi ? hi : r);
}

/* cycleSteps: longest track len with the avSeqSchedCycleLen floor of 16 (1..64) */
function avTakesCycleSteps(snap) {
  let len = AV_TAKES_LEN_DEF;
  try {
    const tracks = (snap && snap.tracks && typeof snap.tracks.length === "number") ? snap.tracks : [];
    for (let i = 0; i < tracks.length && i < AV_TAKES_TRACKS; i++) {
      const n = avTakesClampInt(tracks[i] ? tracks[i].len : AV_TAKES_LEN_DEF, AV_TAKES_LEN_DEF, 1, AV_TAKES_STEPS_MAX);
      if (n > len) len = n;
    }
  } catch (e) { /* default stands */ }
  return len;
}

/* bpm: the live avState.bpm overlay first (the scheduler's pattern-view law), snapshot else */
function avTakesBpmOf(snap) {
  try {
    if (typeof avState !== "undefined" && avState && typeof avState.bpm === "number" && isFinite(avState.bpm)) {
      return avTakesClampNum(avState.bpm, AV_TAKES_BPM_DEF, AV_TAKES_BPM_MIN, AV_TAKES_BPM_MAX);
    }
  } catch (e) { /* no store */ }
  return avTakesClampNum(snap ? snap.bpm : AV_TAKES_BPM_DEF, AV_TAKES_BPM_DEF, AV_TAKES_BPM_MIN, AV_TAKES_BPM_MAX);
}

/* stepDur: the avSeqSchedGridDur law, mirrored purely (never reads another module) */
function avTakesStepDurOf(bpm, grid) {
  return (grid === "8t") ? (60 / bpm / 3) : (60 / bpm / 4);
}

/* ---------- guarded reach-ins (the capture siblings; all typeof-guarded) ---------- */

function avTakesPickInput() {
  try {
    if (typeof avInputNode === "function") {
      const n = avInputNode();
      if (n && typeof n.connect === "function" && n.context) return n;
    }
  } catch (e) { /* not loaded / not enabled */ }
  return null;
}

function avTakesPickReal(ctx) {
  try { if (typeof avTap !== "undefined" && avTap && avTap.real && avTap.real.context === ctx) return avTap.real; } catch (e) { /* no tap */ }
  try { if (typeof window !== "undefined" && window.__avTap && window.__avTap.real && window.__avTap.real.context === ctx) return window.__avTap.real; } catch (e2) { /* no window */ }
  try { return ctx.destination || null; } catch (e3) { return null; }
}

function avTakesOffsetFrames() {
  try {
    if (typeof avInputLatency === "function") {
      const l = avInputLatency();
      if (l && typeof l.totalFrames !== "undefined") {
        const f = Number(l.totalFrames);
        if (isFinite(f) && f >= 0) return Math.round(f);
      }
    }
  } catch (e) { /* latency is a nicety */ }
  return 0;
}

function avTakesCtxNow(ctx) {
  try {
    if (typeof avSeqSchedNow === "function") {
      const t = avSeqSchedNow();
      if (typeof t === "number" && isFinite(t)) return t;
    }
  } catch (e) { /* no scheduler */ }
  try {
    if (ctx && typeof ctx.currentTime === "number" && isFinite(ctx.currentTime)) return ctx.currentTime;
  } catch (e2) { /* gone */ }
  return null;
}

/* ---------- capture path (block rate only; never throws) ---------- */

function avTakesPushPart(lap, l, r, from, len, monoBlock) {
  if (!lap || !(len > 0)) return;
  const pl = new Float32Array(len);
  if (typeof l.subarray === "function") pl.set(l.subarray(from, from + len));
  else for (let i = 0; i < len; i++) pl[i] = l[from + i];
  let pr = pl;
  if (!monoBlock && r !== l) {
    pr = new Float32Array(len);
    if (typeof r.subarray === "function") pr.set(r.subarray(from, from + len));
    else for (let i = 0; i < len; i++) pr[i] = r[from + i];
  }
  lap.chunks.push({ l: pl, r: pr });
  lap.frames += len;
  lap.mono = lap.mono && (pr === pl);
  avTakes.totalFrames += len;
}

function avTakesCloseLap() {
  const laps = avTakes.laps;
  const k = laps.length - 1;
  const lap = laps[k];
  if (lap) {
    lap.closed = true;
    lap.endedCtxT = (avTakes.startedCtxT != null && avTakes.startedCtxT !== undefined && avTakes.cycleDur > 0)
      ? (avTakes.startedCtxT + (k + 1) * avTakes.cycleDur) : null;
  }
  avTakes.lapSeq++;
  const started = (avTakes.startedCtxT != null && avTakes.startedCtxT !== undefined && avTakes.cycleDur > 0)
    ? (avTakes.startedCtxT + (k + 1) * avTakes.cycleDur) : null;
  laps.push({ lap: avTakes.lapSeq, frames: 0, chunks: [], mono: true, startedCtxT: started, closed: false, endedCtxT: null });
}

/* Feed one copied block through the lap splitter. Boundaries are analytic in the sample domain;
   the guarded live clock is the second (stall) trigger — lap content is exact whenever the
   frames arrive, and honestly short when the clock says a boundary passed first. */
function avTakesFeedBlock(l, r, n, monoBlock, nowCtx) {
  let off = 0, guard = 0;
  while (off < n && guard++ < 64) {
    const laps = avTakes.laps;
    if (!laps.length) { avTakesCloseLap(); continue; }        /* defensive: never lose a block */
    const k = laps.length - 1;                                /* 0-based active lap index */
    const C = avTakes.cycleFrames;
    if (!(C > 0)) { avTakesPushPart(laps[k], l, r, off, n - off, monoBlock); off = n; break; }
    const boundaryTotal = (k + 1) * C;
    const frameHit = (avTakes.totalFrames + (n - off)) >= boundaryTotal;
    if (frameHit) {
      const bOff = boundaryTotal - avTakes.totalFrames;       /* frames-from-cursor where the boundary lands */
      if (bOff <= off) { avTakesCloseLap(); continue; }       /* behind the cursor: close here (stall) */
      if (bOff < n) {
        avTakesPushPart(laps[k], l, r, off, bOff - off, monoBlock);
        avTakesCloseLap();
        off = bOff;
        continue;
      }
      avTakesPushPart(laps[k], l, r, off, n - off, monoBlock); /* boundary at/after the block end */
      avTakesCloseLap();
      off = n;
      break;
    }
    const ctxHit = (avTakes.startedCtxT != null && avTakes.startedCtxT !== undefined && nowCtx != null)
      && ((nowCtx - avTakes.startedCtxT) >= (k + 1) * avTakes.cycleDur);
    if (ctxHit) { avTakesCloseLap(); continue; }               /* clock passed the boundary, frames lag */
    avTakesPushPart(laps[k], l, r, off, n - off, monoBlock);
    off = n;
  }
}

function avTakesProcess(ev) {
  try {
    if (!avTakes.capturing) return;
    const inp = ev && ev.inputBuffer;
    if (!inp || typeof inp.getChannelData !== "function" || !inp.numberOfChannels) return;
    const c0 = inp.getChannelData(0);
    if (!c0 || !c0.length) return;
    const n0 = c0.length;
    let n = n0;
    const capFrames = avTakes.capFrames;
    if (capFrames > 0 && avTakes.totalFrames + n > capFrames) n = capFrames - avTakes.totalFrames;
    if (!(n > 0)) { avTakesCapKick(); return; }
    const l = new Float32Array(n);
    if (typeof c0.subarray === "function") l.set(c0.subarray(0, n));
    else for (let i = 0; i < n; i++) l[i] = c0[i];
    let r = l, mono = true;
    if (inp.numberOfChannels > 1) {
      const c1 = inp.getChannelData(1);
      if (c1 !== c0) {
        r = new Float32Array(n);
        if (typeof c1.subarray === "function") r.set(c1.subarray(0, n));
        else for (let i = 0; i < n; i++) r[i] = c1[i];
        mono = false;
      }
    }
    let pk = avTakes.peak;
    for (let i = 0; i < n; i++) { const a = l[i] < 0 ? -l[i] : l[i]; if (a > pk) pk = a; }
    if (r !== l) for (let i = 0; i < n; i++) { const a = r[i] < 0 ? -r[i] : r[i]; if (a > pk) pk = a; }
    avTakes.peak = pk > 1.2 ? 1.2 : pk;
    if (!avTakes.totalFrames) avTakes.captureWall = avTakesNowMs();
    avTakesFeedBlock(l, r, n, mono, avTakesCtxNow(avTakes.ctx));
    if (n < n0 || (capFrames > 0 && avTakes.totalFrames >= capFrames)) avTakesCapKick();
  } catch (e) { /* capture must never throw; a lost block beats a broken page */ }
}

/* §5 cap: end the session honestly at 300 s (deferred out of the callback) */
function avTakesCapKick() {
  if (avTakes.capKicked) return;
  avTakes.capKicked = true;
  avTakes.capped = true;
  if (!avTakes.stopping) {
    avTakes.recording = false;
    avTakes.stopping = true;
    avTakes.stoppedWall = avTakesNowMs();
  }
  if (typeof setTimeout === "function") setTimeout(function () { avTakesFinish("cap"); }, 0);
  else avTakesFinish("cap");
}

/* ---------- teardown (idempotent — start failure, stop, abort and re-start all call it) ---------- */

function avTakesRelease() {
  try { const inp = avTakes.input, sp = avTakes.sp; if (inp && sp && typeof inp.disconnect === "function") inp.disconnect(sp); } catch (e) { /* never wired */ }
  try { const sp = avTakes.sp; if (sp) { sp.onaudioprocess = null; sp.disconnect(); } } catch (e2) { /* gone */ }
  try { const sk = avTakes.sink; if (sk) sk.disconnect(); } catch (e3) { /* gone */ }
  avTakes.sp = null;
  avTakes.sink = null;
  avTakes.input = null;
  avTakes.ctx = null;
  avTakes.capturing = false;
}

/* ---------- finalize (per-take Float32 arrays; keepLast enforcement) ---------- */

function avTakesConcatLap(lap) {
  const chunks = lap.chunks;
  let total = 0;
  for (let i = 0; i < chunks.length; i++) total += chunks[i].l.length;
  const stereo = !lap.mono;
  const L = new Float32Array(total);
  const R = stereo ? new Float32Array(total) : null;
  let o = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    L.set(c.l, o);
    if (R) R.set(c.r, o);
    o += c.l.length;
  }
  lap.chunks = [];
  return stereo ? [L, R] : [L];
}

function avTakesMeta(t) {
  return {
    id: t.id, name: t.name, frames: t.frames, rate: t.rate, channels: t.channels,
    lap: t.lap, partial: t.partial === true, offsetFrames: t.offsetFrames,
    startedCtxT: t.startedCtxT, seconds: t.seconds,
  };
}

function avTakesFinalizeSession() {
  const metas = [];
  const laps = avTakes.laps;
  for (let i = 0; i < laps.length; i++) {
    const lap = laps[i];
    if (!(lap.frames > 0)) continue;                         /* empty boundary laps are dropped */
    const data = avTakesConcatLap(lap);
    const sr = avTakes.sr || 48000;
    const seq = avTakes.nextId++;
    const take = {
      id: "t" + seq,
      name: "Take " + seq,
      frames: lap.frames,
      rate: sr,
      channels: data.length,
      lap: lap.lap,
      partial: avTakes.lapSyncActive ? (lap.frames < avTakes.cycleFrames) : false,
      offsetFrames: avTakes.offsetFrames,
      startedCtxT: lap.startedCtxT,
      seconds: lap.frames / sr,
      data: data,
    };
    avTakes.takes.push(take);
    metas.push(avTakesMeta(take));
  }
  avTakes.laps = [];
  avTakes.totalFrames = 0;
  while (avTakes.takes.length > avTakes.keepLast) avTakes.takes.shift();   /* §2.3: on stop */
  return metas;
}

/* ---------- finish (shared by stop / arm-off / cap) ---------- */

function avTakesFinish(reason) {
  if (!avTakes.stopping) return;
  avTakes.stopReason = reason || avTakes.stopReason || "stop";
  avTakes.capturing = false;
  avTakes.finalWall = avTakesNowMs();
  avTakesRelease();
  let final;
  try {
    const sessionFrames = avTakes.totalFrames;
    const sr = avTakes.sr || 48000;
    const metas = avTakesFinalizeSession();
    const wallFrom = avTakes.startedWall > 0 ? avTakes.startedWall : avTakes.stoppedWall;
    const wallTo = avTakes.stoppedWall > 0 ? avTakes.stoppedWall : avTakes.finalWall;
    final = {
      ok: true,
      receipt: true,
      settling: false,
      stopReason: avTakes.stopReason,
      capped: avTakes.capped === true,
      sr: sr,
      frames: sessionFrames,
      seconds: sessionFrames / sr,
      wallSeconds: (wallTo > wallFrom) ? (wallTo - wallFrom) / 1000 : 0,
      takes: metas,
      laps: metas.length,
      kept: avTakes.takes.length,
      keepLast: avTakes.keepLast,
      config: {
        lapSync: avTakes.lapSyncActive === true,
        cycleSteps: avTakes.cycleSteps,
        stepDur: avTakes.stepDur,
        cycleDur: avTakes.cycleDur,
        cycleFrames: avTakes.cycleFrames,
        offsetFrames: avTakes.offsetFrames,
      },
      startedCtxT: avTakes.startedCtxT,
    };
  } catch (e) {
    final = { ok: false, receipt: true, settling: false, error: avTakesErr(e), stopReason: avTakes.stopReason };
  }
  avTakes.stopping = false;
  avTakes.recording = false;
  avTakes.lastReceipt = final;
  if (avTakes.stopResolve) {
    const done = avTakes.stopResolve;
    avTakes.stopResolve = null;
    try { done(final); } catch (e) { /* the settle promise is fire-and-forget */ }
  }
}

/* ---------- start / stop / abort ---------- */

async function avTakesStart(opts) {
  try {
    if (avTakes.recording) return { ok: false, error: "already recording" };
    if (avTakes.stopping) return { ok: false, error: "stop still settling — one moment" };
    const o = (opts && typeof opts === "object") ? opts : {};
    const input = avTakesPickInput();
    if (!input) { avTakes.armed = false; return { ok: false, error: "input not enabled" }; }
    const ctx = input.context;
    if (!ctx) return { ok: false, error: "input node has no audio context" };
    if (ctx.state === "closed") return { ok: false, error: "audio context is closed" };
    if (ctx.state === "suspended") {
      try { const p = ctx.resume(); if (p && typeof p.catch === "function") p.catch(function () { /* gesture-gated */ }); } catch (e) { /* retry on click */ }
      return { ok: false, error: "audio context is suspended — resuming; press REC again in a moment" };
    }
    if (typeof ctx.createScriptProcessor !== "function") return { ok: false, error: "ScriptProcessorNode unavailable in this browser" };
    const real = avTakesPickReal(ctx);
    if (!real) return { ok: false, error: "tap real output unavailable — cannot pull the capture branch" };

    const srNum = Number(ctx.sampleRate);
    const sr = (isFinite(srNum) && srNum > 0) ? srNum : 48000;

    /* lap plan (§2.3) — pure math off the guarded transport + snapshot */
    const lapWant = o.lapSync === true;
    let lapActive = false, lapReason = "lapSync off";
    let cycleSteps = 0, stepDur = 0, cycleDur = 0, cycleFrames = 0;
    if (lapWant) {
      let playing = false, snap = null;
      try { if (typeof avSeqIsPlaying === "function") playing = avSeqIsPlaying() === true; } catch (e) { playing = false; }
      try { if (typeof avSeqSnap === "function") { const s = avSeqSnap(); if (s && typeof s === "object") snap = s; } } catch (e2) { snap = null; }
      if (!playing) lapReason = "transport not playing";
      else if (!snap) lapReason = "no pattern snapshot (avSeqSnap)";
      else {
        cycleSteps = avTakesCycleSteps(snap);
        stepDur = avTakesStepDurOf(avTakesBpmOf(snap), (snap.grid === "8t") ? "8t" : "16");
        cycleDur = cycleSteps * stepDur;
        cycleFrames = Math.round(cycleDur * sr);
        lapActive = (cycleDur > 0 && cycleFrames > 0);
        lapReason = lapActive ? "transport playing" : "degenerate cycle";
      }
    }

    let ch = 2;
    try { const c = Number(input.channelCount); if (c === 1 || c === 2) ch = c; } catch (e3) { ch = 2; }

    const startedCtxT = avTakesCtxNow(ctx);
    const offsetFrames = avTakesOffsetFrames();

    /* session state BEFORE any wire (track-before-wire covers the nodes below too) */
    avTakes.sr = sr;
    avTakes.offsetFrames = offsetFrames;
    avTakes.startedCtxT = startedCtxT;
    avTakes.startedWall = avTakesNowMs();
    avTakes.stoppedWall = 0;
    avTakes.finalWall = 0;
    avTakes.captureWall = 0;
    avTakes.peak = 0;
    avTakes.totalFrames = 0;
    avTakes.lapSeq = 1;
    avTakes.laps = [{ lap: 1, frames: 0, chunks: [], mono: true, startedCtxT: startedCtxT, closed: false, endedCtxT: null }];
    avTakes.lapSyncActive = lapActive;
    avTakes.cycleSteps = cycleSteps;
    avTakes.stepDur = stepDur;
    avTakes.cycleDur = cycleDur;
    avTakes.cycleFrames = cycleFrames;
    avTakes.capped = false;
    avTakes.capKicked = false;
    avTakes.capFrames = Math.round(AV_TAKES_MAX_SECONDS * sr);
    avTakes.stopReason = null;
    avTakes.error = null;
    avTakes.lastReceipt = null;

    let sp = null, sink = null;
    try {
      sp = ctx.createScriptProcessor(AV_TAKES_BLOCK, ch, ch);
      sp.onaudioprocess = avTakesProcess;
      sink = ctx.createGain();
      sink.gain.value = 0;                                   /* belt-and-braces: silent twice over */
      avTakes.ctx = ctx;
      avTakes.input = input;
      avTakes.sp = sp;
      avTakes.sink = sink;
      input.connect(sp);
      sp.connect(sink);
      sink.connect(real);                                    /* the REAL destination — never the bus */
    } catch (e) {
      avTakesRelease();
      avTakes.error = avTakesErr(e);
      return { ok: false, error: "capture start failed — " + avTakes.error };
    }

    avTakes.armed = true;                                    /* live input ⇒ armed (see ARMING note) */
    avTakes.recording = true;
    avTakes.stopping = false;
    avTakes.capturing = true;
    return {
      ok: true, started: true, sr: sr, block: AV_TAKES_BLOCK, channels: ch,
      lapSync: lapActive, lapReason: lapReason, cycleSteps: cycleSteps, stepDur: stepDur,
      cycleDur: cycleDur, cycleFrames: cycleFrames, offsetFrames: offsetFrames,
      startedCtxT: startedCtxT, capSeconds: AV_TAKES_MAX_SECONDS, armed: true,
    };
  } catch (e) {
    try { avTakesRelease(); } catch (e2) { /* already gone */ }
    return { ok: false, error: avTakesErr(e) };
  }
}

function avTakesStop() {
  try {
    if (avTakes.stopping) return { ok: false, error: "already stopping" };
    if (!avTakes.recording) return { ok: false, error: "not recording" };
    avTakes.recording = false;
    avTakes.stopping = true;
    avTakes.stoppedWall = avTakesNowMs();
    const sr = avTakes.sr || 48000;
    let resolveFinal = null;
    const p = new Promise(function (res) { resolveFinal = res; });
    avTakes.stopResolve = resolveFinal;
    const receipt = {
      ok: true, settling: true, settleMs: AV_TAKES_SETTLE_MS, sr: sr,
      frames: avTakes.totalFrames, seconds: avTakes.totalFrames / sr,
      stopRequestedWall: avTakes.stoppedWall, stopReason: "stop",
    };
    /* thenable receipt: sync fields above; `await` it for the settled final receipt */
    receipt.then = function (onFulfilled, onRejected) { return p.then(onFulfilled, onRejected); };
    receipt.catch = function (onRejected) { return p.catch(onRejected); };
    receipt.finally = function (onFinally) { return p.finally(onFinally); };
    if (typeof setTimeout === "function") setTimeout(function () { avTakesFinish("stop"); }, AV_TAKES_SETTLE_MS);
    else avTakesFinish("stop");
    return receipt;
  } catch (e) {
    return { ok: false, error: avTakesErr(e) };
  }
}

function avTakesAbort() {
  try {
    if (!avTakes.recording && !avTakes.stopping) return { ok: false, error: "not recording" };
    avTakes.recording = false;
    avTakes.stopping = false;
    avTakes.capturing = false;
    avTakes.stopReason = "abort";
    avTakes.capped = false;
    avTakesRelease();
    avTakes.laps = [];
    avTakes.totalFrames = 0;
    if (avTakes.stopResolve) {
      const done = avTakes.stopResolve;
      avTakes.stopResolve = null;
      try { done({ ok: false, aborted: true, error: "stop was aborted" }); } catch (e) { /* fire-and-forget */ }
    }
    return { ok: true, aborted: true, stopReason: "abort" };
  } catch (e) { return { ok: false, error: avTakesErr(e) }; }
}

/* ---------- arm ---------- */

function avTakesArm(on) {
  try {
    const want = (on === undefined) ? true : !!on;
    if (!want) {
      avTakes.armed = false;
      if (avTakes.recording && !avTakes.stopping) { try { avTakesStop(); } catch (e) { /* already gone */ } }
      return false;
    }
    if (!avTakesPickInput()) return false;
    avTakes.armed = true;
    return true;
  } catch (e) { return false; }
}

/* ---------- list / keepLast / delete ---------- */

function avTakesFind(id) {
  try {
    for (let i = 0; i < avTakes.takes.length; i++) {
      if (String(avTakes.takes[i].id) === String(id)) return avTakes.takes[i];
    }
  } catch (e) { /* never throws */ }
  return null;
}

function avTakesList() {
  const out = [];
  try { for (let i = 0; i < avTakes.takes.length; i++) out.push(avTakesMeta(avTakes.takes[i])); } catch (e) { /* empty */ }
  return out;
}

function avTakesKeepLast(n) {
  try {
    if (n === undefined || n === null) return avTakes.keepLast;
    avTakes.keepLast = avTakesClampInt(n, AV_TAKES_KEEP_DEF, 0, AV_TAKES_KEEP_MAX);
    return avTakes.keepLast;
  } catch (e) { return avTakes.keepLast; }
}

function avTakesDelete(id) {
  try {
    for (let i = 0; i < avTakes.takes.length; i++) {
      if (String(avTakes.takes[i].id) === String(id)) { avTakes.takes.splice(i, 1); return true; }
    }
  } catch (e) { /* never throws */ }
  return false;
}

/* ---------- export (16-bit stereo WAV via avWavEncode; mono duplicated) ---------- */

function avTakesNumOf(id) {
  try {
    const m = /(\d+)/.exec(String(id == null ? "" : id));
    const n = m ? parseInt(m[1], 10) : 0;
    return isFinite(n) && n > 0 ? n : 0;
  } catch (e) { return 0; }
}

function avTakesExport(id) {
  return new Promise(function (resolve) {
    try {
      const take = avTakesFind(id);
      if (!take) { resolve({ ok: false, error: "take not found: " + String(id) }); return; }
      if (typeof avWavEncode !== "function") { resolve({ ok: false, error: "wav encoder unavailable (avWavEncode missing)" }); return; }
      const d = (take.data && take.data.length) ? take.data : null;
      if (!d || !d[0] || !d[0].length) { resolve({ ok: false, error: "take is empty" }); return; }
      const lCh = d[0];
      const rCh = (d.length > 1 && d[1] && d[1].length) ? d[1] : d[0];      /* mono → duplicated stereo */
      let buf = null;
      try { buf = avWavEncode({ l: lCh, r: rCh, sr: take.rate || avTakes.sr || 48000, bits: AV_TAKES_WAV_BITS, dither: "auto" }); } catch (e) { buf = null; }
      if (!buf) { resolve({ ok: false, error: "wav encode refused (bad take data)" }); return; }
      let bytes = 0;
      try { bytes = (typeof buf.byteLength === "number") ? buf.byteLength : 0; } catch (e) { bytes = 0; }
      let wavInfo = null;
      try { if (typeof avWavInfo === "function") wavInfo = avWavInfo(buf); } catch (e) { wavInfo = null; }
      let blob = null;
      try { blob = new Blob([buf], { type: "audio/wav" }); } catch (e) { blob = null; }
      if (avTakes.lastUrlKeep) { try { URL.revokeObjectURL(avTakes.lastUrlKeep); } catch (e) { /* already revoked */ } }
      let url = null;
      try { url = (blob && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") ? URL.createObjectURL(blob) : null; } catch (e) { url = null; }
      avTakes.lastUrlKeep = url;
      const name = "anvil_take" + avTakesNumOf(take.id) + "_lap" + take.lap + ".wav";
      avTakes.lastExport = { id: take.id, name: name, bytes: bytes, at: avTakesNowMs() };
      resolve({
        ok: true, id: take.id, name: name, bytes: bytes, blob: blob, url: url,
        wavInfo: wavInfo, seconds: take.seconds,
      });
    } catch (e) {
      resolve({ ok: false, error: avTakesErr(e) });
    }
  });
}

/* ---------- state / snapshot / classes (snapshots only — no live nodes leak) ---------- */

function avTakesState() {
  let liveSeconds = 0;
  try { liveSeconds = avTakes.totalFrames / (avTakes.sr || 48000); } catch (e) { liveSeconds = 0; }
  return {
    version: AV_TAKES_VERSION,
    inited: avTakes.inited === true,
    armed: avTakes.armed === true,
    recording: avTakes.recording === true,
    stopping: avTakes.stopping === true,
    capturing: avTakes.capturing === true,
    wired: !!(avTakes.input && avTakes.sp && avTakes.sink),
    sr: avTakes.sr,
    block: AV_TAKES_BLOCK,
    seconds: liveSeconds,
    frames: avTakes.totalFrames,
    laps: avTakes.laps.length,
    lapNow: avTakes.laps.length ? avTakes.laps[avTakes.laps.length - 1].lap : 0,
    lapSync: avTakes.lapSyncActive === true,
    cycleSteps: avTakes.cycleSteps,
    stepDur: avTakes.stepDur,
    cycleDur: avTakes.cycleDur,
    cycleFrames: avTakes.cycleFrames,
    offsetFrames: avTakes.offsetFrames,
    keeps: avTakes.takes.length,
    keepLast: avTakes.keepLast,
    peak: avTakes.peak,
    capped: avTakes.capped === true,
    stopReason: avTakes.stopReason,
    error: avTakes.error,
    lastExport: avTakes.lastExport ? { id: avTakes.lastExport.id, name: avTakes.lastExport.name, bytes: avTakes.lastExport.bytes } : null,
    lastReceipt: avTakes.lastReceipt,
  };
}

function avTakesClasses() { return AV_TAKES_CLASSES.slice(); }

/* ---------- init ---------- */

function avTakesInit() {
  avTakes.inited = true;
  return true;
}

if (typeof window !== "undefined") {
  try {
    window.__avTakes = {
      version: AV_TAKES_VERSION,
      init: avTakesInit,
      arm: avTakesArm,
      start: avTakesStart,
      stop: avTakesStop,
      abort: avTakesAbort,
      list: avTakesList,
      export: avTakesExport,
      del: avTakesDelete,
      keepLast: avTakesKeepLast,
      state: avTakesState,
      classes: avTakesClasses,
    };
  } catch (e) { /* no window — node harness only */ }
}
