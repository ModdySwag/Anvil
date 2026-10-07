/* av_deck.js — the DECK core (Anvil 'DECK wave', child sa-A). Analyser attach on the master tap,
   the ring set, the pure math surface and the ONE synchronous step engine the deck card rides.

   Pinned interface (verify/_deck_wave.md §2.1 + laws §3):
     avDeckInit() -> boolean                     state + rings + all preallocation; idempotent
     avDeckAttach() -> { ok, ctx, rate, fft }    LIVE ctx ONLY (engine facade first, avTap.live
                                                 fallback); no AudioContext is ever constructed;
                                                 offline contexts are never attached; honest refusal
     avDeckDetach() -> boolean                   disconnect + presentation reset (idempotent)
     avDeckStep() -> { at, frames, attached, voices, notesSeen }   ONE synchronous pass — THE seam
     avDeckFrame(kind) -> plain object           'scope' | 'spectrum' | 'waterfall' | 'meters' | 'gain'
     avDeckReadouts() -> { bpm, grid, voices, maxVoices, tier, ctxState, cpuMs, cpuAvgMs,
                           notesSeen, lastNote, fps }
     avDeckSetView(kind, patch) -> { ok, view }  run · freeze · dbFloor(-90..-20) · waterfallMs(40..250)
     avDeckClasses() -> []                       the core names no CSS classes (sa-B owns them)
     window.__avDeck = { version, init, attach, detach, step, frame, readouts, setView, snapshot, pure }

   LAWS HONORED:
   - 'use strict'; classic script; ONE namespace (avDeck* / AV_DECK_*); node-loadable; zero DOM at
     load (the guarded `typeof window` probe is the last statement); never throws (honest refusals,
     counted skips); no console noise; no AudioContext is ever constructed here; offline contexts
     are excluded.
   - Rings/all buffers preallocated in avDeckInit(); step() is allocation-free on its hot path
     (the only per-call allocation is the pinned receipt object; ≤2 Hz meter recompute may allocate
     tiny subarray views; the async engine samples allocate promise plumbing, chip-cadence only).
   - Frames are STABLE preallocated objects with typed-array payloads (no per-step allocation).
   - Freeze holds PRESENTED frames (rings stop advancing; counters/fps/engine samples keep running);
     unfreeze resumes. `run:false` (the card's PAUSE) uses the same pull gate.
   - Voices/CPU: reuses the engine facade's own RPC — avEngineStartVoiceChip's call `h.stats()`
     (av_engine.js L575-598) for voices + `h.bench("read")` (meanUs) for CPU — sampled from the
     step at ≥500 ms, single-flight, never via setInterval: no second polling loop is created.
   - LUFS/TP: av_loud on bounded rings (3 s stereo + 1 s true-peak). The rings are appended from
     the same time-domain pull the scope uses, with the sample count derived from the ctx clock
     (never duplicates, never fabricates); av_loud recompute is throttled to ≥500 ms and fully
     guarded (null-honest when av_loud is absent). lufsShort needs 3 s of ring audio by av_loud's
     ST-window law — before that it is honestly null.
   - Note ticker: the ONE avNote bus (__lastNotePreview transitions per step + __avNotes() held-set
     diffs at ≤4 Hz); notesSeen counts fresh downs; lastNote = { name, vel, at } | null
     (vel is null-honest — the bus does not expose velocity).

   DOCUMENTED INTERPRETATIONS (report keeps the full list):
   - Waterfall rows advance on the wall clock, at most every waterfallMs (default 120), with a
     hard 4-step fallback so synthetic (bulk, no-wall-time) step drives still advance rows; at the
     card's ~30 fps cadence the wall gate dominates (≈133 ms ≈ waterfallMs).
   - gain { l, r, peak } is measured from the deck's own L/R pulls (peak-hold ballistics via the
     pure holdDecay law) — deterministic under the rig, no dependence on the tap's rAF meter loop.
   - attach on an exotic context above 96 kHz upsizes the meter rings once (init preallocates for
     ≤96 kHz; the law's preallocation holds for every sane rate).
*/
"use strict";

const AV_DECK_VERSION = "deck.1.0";
const AV_DECK_FFT = 16384;                 /* analyser fftSize (binHz 2.93 @48k) — scope+spectrum+meters */
const AV_DECK_SMOOTH = 0.7;                /* analyser smoothingTimeConstant */
const AV_DECK_SCOPE_N = 480;               /* scope min/max envelope points (pinned) */
const AV_DECK_BANDS = 96;                  /* spectrum / waterfall bands (pinned) */
const AV_DECK_WF_ROWS = 96;                /* waterfall ring rows (pinned) */
const AV_DECK_F_LOW = 20;                  /* log band plan low edge, Hz */
const AV_DECK_F_HIGH = 20000;              /* log band plan high edge, Hz */
const AV_DECK_RING_SR = 96000;             /* init preallocates the meter rings for this max rate */
const AV_DECK_LUFS_S = 3;                  /* short-term ring seconds */
const AV_DECK_TP_S = 1;                    /* true-peak ring seconds */
const AV_DECK_METER_MS = 500;              /* av_loud recompute floor (≤2 Hz) */
const AV_DECK_ENG_MS = 500;                /* voices/CPU sample floor (chip cadence) */
const AV_DECK_NOTE_POLL_MS = 250;          /* __avNotes() held-set poll floor (≤4 Hz) */
const AV_DECK_DB_FLOOR_DEF = -60;
const AV_DECK_DB_FLOOR_MIN = -90;
const AV_DECK_DB_FLOOR_MAX = -20;
const AV_DECK_WF_MS_DEF = 120;
const AV_DECK_WF_MS_MIN = 40;
const AV_DECK_WF_MS_MAX = 250;
const AV_DECK_WF_STEPS = 4;                /* waterfall bulk-step fallback (see header) */
const AV_DECK_PEAK_MIN_DB = -105;          /* below this the spectrum peak is honest-none */
const AV_DECK_DB_CLAMP_LO = -200;          /* band dB clamp (JSON-safe finite payloads) */
const AV_DECK_DB_CLAMP_HI = 12;
const AV_DECK_GAIN_DOWN = 0.010;           /* gain strip decay per step (holdDecay 'down') */
const AV_DECK_PEAK_DOWN = 0.004;           /* gain strip peak decay per step */

/* ---------- shared state (all buffers are attached by avDeckInit) ---------- */

const avDeck = {
  inited: false,
  attached: false,
  ctx: null, master: null, splitter: null, analyserL: null, analyserR: null,
  rate: null, fft: AV_DECK_FFT,
  run: true, freeze: false,
  dbFloor: AV_DECK_DB_FLOOR_DEF, waterfallMs: AV_DECK_WF_MS_DEF,
  frames: 0, skips: 0, errors: 0, attachRefusals: 0,
  /* presentation flags + receipts (the frames objects themselves live here too) */
  scopeReady: false, specReady: false,
  lufsShort: null, dbtp: null, peakDb: null, energyDb: null,
  gainL: 0, gainR: 0, gainPeak: 0,
  wfHead: 0, wfRows: 0, wfLatest: -1, wfGap: 0, wfAt: 0,
  meterAt: 0,
  /* rings */
  scopeMin: null, scopeMax: null, bands: null, wfData: null,
  timeL: null, timeR: null, freq: null,
  lufsL: null, lufsR: null, tpL: null, tpR: null,
  lufsLen: 0, tpLen: 0, lufsFill: 0, tpFill: 0,
  binLo: null, binHi: null,
  /* ctx clock */
  lastCtxAt: 0,
  /* note ticker */
  notesSeen: 0, lastNote: null, seenPreview: null, lastCode: null,
  heldSeen: null, notePollAt: 0, lastDownName: null, lastDownAt: -1e12,
  /* engine readouts */
  voices: null, maxVoices: null, tier: null, cpuMs: null, cpuAvgMs: null,
  engBusy: false, engAt: 0,
  /* fps window */
  fps: null, fpsLast: 0, fpsHead: 0, fpsRing: null,
  /* stable frame objects (built in init) */
  fScope: null, fSpectrum: null, fWaterfall: null, fMeters: null, fGain: null,
};

const avDeckClock = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
  ? performance : null;

/* ---------- tiny guarded helpers (never throw) ---------- */

function avDeckNum(v) {
  if (v === null || v === undefined) return NaN;
  try { const n = Number(v); return isFinite(n) ? n : NaN; } catch (e) { return NaN; }
}
function avDeckFiniteOr(v, dflt) {
  const n = avDeckNum(v);
  return isFinite(n) ? n : dflt;
}
function avDeckClampN(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function avDeckNow() {
  try {
    if (avDeckClock) { const t = avDeckClock.now(); if (isFinite(t)) return t; }
  } catch (e) { /* fall through */ }
  return Date.now();
}

/* ---------- the pure math surface (rig-verified; object keys live on __avDeck.pure) ---------- */

function avDeckHzToBand(hz) {
  const n = avDeckNum(hz);
  if (!isFinite(n) || n <= 0) return -1;
  if (n <= AV_DECK_F_LOW) return 0;
  if (n >= AV_DECK_F_HIGH) return AV_DECK_BANDS - 1;
  let b = Math.floor(AV_DECK_BANDS * Math.log(n / AV_DECK_F_LOW) / Math.log(AV_DECK_F_HIGH / AV_DECK_F_LOW));
  if (!isFinite(b) || b < 0) b = 0;
  if (b > AV_DECK_BANDS - 1) b = AV_DECK_BANDS - 1;
  return b;
}
function avDeckBandToHz(i) {
  const n = avDeckNum(i);
  if (!isFinite(n) || Math.floor(n) !== n || n < 0 || n >= AV_DECK_BANDS) return null;
  const hz = AV_DECK_F_LOW * Math.pow(AV_DECK_F_HIGH / AV_DECK_F_LOW, (n + 0.5) / AV_DECK_BANDS);
  return isFinite(hz) ? hz : null;
}
function avDeckBandCount() { return AV_DECK_BANDS; }

/* logBandPlan(sr, fftSize, count): the count+1 log band edges (returned as an Array whose extra
   props describe the plan: ok/count/lowHz/highHz/sr/fftSize/binHz/bins/binLo/binHi, with
   `plan.edges` self-referencing so both plan[i] and plan.edges[i] read the edges). Invalid
   arguments -> honest refusal plan (ok:false, edges:[]). */
function avDeckLogBandPlan(sr, fftSize, count) {
  let edges = null;
  try {
    let n = avDeckNum(count);
    if (!isFinite(n)) n = AV_DECK_BANDS;
    n = Math.floor(n);
    let srV = (sr === undefined || sr === null) ? 48000 : avDeckNum(sr);
    let f = (fftSize === undefined || fftSize === null) ? 4096 : avDeckNum(fftSize);
    if (!(n >= 1 && n <= 4096) || !isFinite(srV) || srV <= 0 || !isFinite(f) || f < 2) {
      edges = [];
      edges.ok = false;
      edges.count = 0;
      edges.edges = edges;
      return edges;
    }
    f = Math.floor(f);
    const bins = Math.floor(f / 2);
    const binHz = srV / f;
    const ratio = AV_DECK_F_HIGH / AV_DECK_F_LOW;
    edges = new Array(n + 1);
    const lo = new Int32Array(n), hi = new Int32Array(n);
    for (let j = 0; j <= n; j++) edges[j] = AV_DECK_F_LOW * Math.pow(ratio, j / n);
    for (let b = 0; b < n; b++) {
      let l = Math.ceil(edges[b] / binHz);
      if (!(l >= 0)) l = 0;
      if (l > bins - 1) l = bins - 1;
      let h = Math.floor(edges[b + 1] / binHz);
      if (h < l) h = l;
      if (h > bins - 1) h = bins - 1;
      lo[b] = l; hi[b] = h;
    }
    edges.ok = true;
    edges.count = n;
    edges.lowHz = AV_DECK_F_LOW;
    edges.highHz = AV_DECK_F_HIGH;
    edges.sr = srV;
    edges.fftSize = f;
    edges.binHz = binHz;
    edges.bins = bins;
    edges.binLo = lo;
    edges.binHi = hi;
    edges.edges = edges;
    return edges;
  } catch (e) {
    edges = [];
    edges.ok = false;
    edges.count = 0;
    edges.edges = edges;
    return edges;
  }
}

function avDeckDbOfAmp(v) {
  const n = avDeckNum(v);
  if (!isFinite(n) || n <= 0) return null;
  const db = 20 * Math.log10(n);
  return isFinite(db) ? db : null;
}

/* peak-hold decay law: rise toward cur with attack `up` (0..1, 1 = instant), fall floored at cur
   by an additive `down` per call. Non-finite arguments sanitize to live defaults. */
function avDeckHoldDecay(prev, cur, up, down) {
  const p = avDeckFiniteOr(prev, 0);
  const c = avDeckFiniteOr(cur, 0);
  const u = avDeckClampN(avDeckFiniteOr(up, 1), 0, 1);
  const d = Math.max(0, avDeckFiniteOr(down, 0));
  if (c > p) return p + (c - p) * u;
  const next = Math.max(c, p - d);
  return isFinite(next) ? next : 0;
}

/* bar mapping: 0..1 between [floor, top]; null/NaN/-Infinity db or an invalid range -> 0 (empty
   bar — the honest "no reading" position). */
function avDeckMeterNorm(db, floor, top) {
  const f = avDeckFiniteOr(floor, AV_DECK_DB_FLOOR_DEF);
  const t = avDeckFiniteOr(top, 0);
  if (!(t > f)) return 0;
  const v = (db === null || db === undefined) ? NaN : avDeckNum(db);
  if (!isFinite(v)) return 0;
  let n2 = (v - f) / (t - f);
  if (!isFinite(n2)) return 0;
  if (n2 < 0) n2 = 0;
  if (n2 > 1) n2 = 1;
  return n2;
}

const avDeckPure = {
  hzToBand: avDeckHzToBand,
  bandToHz: avDeckBandToHz,
  bandCount: avDeckBandCount,
  logBandPlan: avDeckLogBandPlan,
  dbOfAmp: avDeckDbOfAmp,
  holdDecay: avDeckHoldDecay,
  meterNorm: avDeckMeterNorm,
};

/* ---------- init: state + rings + every buffer, preallocated once ---------- */

function avDeckInit() {
  try {
    if (avDeck.inited) return true;
    avDeck.scopeMin = new Float32Array(AV_DECK_SCOPE_N);
    avDeck.scopeMax = new Float32Array(AV_DECK_SCOPE_N);
    avDeck.bands = new Float32Array(AV_DECK_BANDS);
    avDeck.wfData = new Float32Array(AV_DECK_WF_ROWS * AV_DECK_BANDS);
    avDeck.timeL = new Float32Array(AV_DECK_FFT);
    avDeck.timeR = new Float32Array(AV_DECK_FFT);
    avDeck.freq = new Float32Array(AV_DECK_FFT / 2);
    avDeck.lufsL = new Float32Array(AV_DECK_LUFS_S * AV_DECK_RING_SR);
    avDeck.lufsR = new Float32Array(AV_DECK_LUFS_S * AV_DECK_RING_SR);
    avDeck.tpL = new Float32Array(AV_DECK_TP_S * AV_DECK_RING_SR);
    avDeck.tpR = new Float32Array(AV_DECK_TP_S * AV_DECK_RING_SR);
    avDeck.binLo = new Int32Array(AV_DECK_BANDS);
    avDeck.binHi = new Int32Array(AV_DECK_BANDS);
    avDeck.fpsRing = new Float64Array(16);
    avDeck.heldSeen = {};
    avDeck.fScope = { ready: false, n: AV_DECK_SCOPE_N, min: avDeck.scopeMin, max: avDeck.scopeMax };
    avDeck.fSpectrum = { ready: false, bands: avDeck.bands, peakBand: -1, peakHz: null };
    avDeck.fWaterfall = { ready: false, rows: 0, latestRow: -1, rowMs: avDeck.waterfallMs, cols: AV_DECK_BANDS, data: avDeck.wfData };
    avDeck.fMeters = { lufsShort: null, dbtp: null, peakDb: null, energyDb: null };
    avDeck.fGain = { l: 0, r: 0, peak: 0 };
    avDeck.inited = true;
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- live-context resolution (NEVER creates a context; offline excluded) ---------- */

function avDeckUsableCtx(ctx) {
  try {
    if (!ctx || typeof ctx.createAnalyser !== "function" || typeof ctx.createChannelSplitter !== "function") return null;
    if (ctx.state === "closed") return null;
    if (typeof ctx.startRendering === "function") return null;      /* offline: never attached */
    return ctx;
  } catch (e) { return null; }
}

function avDeckEngineHandle() {
  try {
    if (typeof avEngineLive !== "undefined" && avEngineLive && avEngineLive.ready === true) return avEngineLive;
  } catch (e) { /* holder not loaded */ }
  try {
    const f = (typeof window !== "undefined") ? window.__avEngine : null;
    if (f && f.ready === true && f.handle && f.handle.ready === true) return f.handle;
  } catch (e) { /* no window */ }
  return null;
}

/* engine facade first (handle .ctx, then the avEngineLiveCtx holder), avTap.live fallback */
function avDeckResolveCtx() {
  const h = avDeckEngineHandle();
  if (h) { const c = avDeckUsableCtx(h.ctx); if (c) return c; }
  try {
    if (typeof avEngineLiveCtx !== "undefined") { const c = avDeckUsableCtx(avEngineLiveCtx); if (c) return c; }
  } catch (e) { /* holder not loaded */ }
  try {
    const live = (typeof avTap !== "undefined" && avTap && avTap.live && typeof avTap.live.length === "number") ? avTap.live : null;
    if (live) {
      for (let i = 0; i < live.length; i++) { const c = avDeckUsableCtx(live[i]); if (c) return c; }
    }
  } catch (e) { /* no tap */ }
  return null;
}

/* the MASTER node for the ctx (av_tap law: reading ctx.destination builds the chain; only when
   the tap is installed — never for an offline ctx, and the ctx is already proven live) */
function avDeckResolveMaster(ctx) {
  let m = null;
  try { if (typeof avMasterFor === "function") m = avMasterFor(ctx); } catch (e) { m = null; }
  if (m && typeof m.connect === "function") return m;
  try {
    if (typeof avTap !== "undefined" && avTap && avTap.installed === true) {
      try { void ctx.destination; } catch (e2) { /* destination refused */ }
      try { if (typeof avMasterFor === "function") m = avMasterFor(ctx); } catch (e3) { m = null; }
    }
  } catch (e) { m = null; }
  return (m && typeof m.connect === "function") ? m : null;
}

function avDeckDisconnect() {
  const nodes = [avDeck.splitter, avDeck.analyserL, avDeck.analyserR];
  for (let i = 0; i < nodes.length; i++) {
    try { const nd = nodes[i]; if (nd && typeof nd.disconnect === "function") nd.disconnect(); } catch (e) { /* gone */ }
  }
  avDeck.splitter = null;
  avDeck.analyserL = null;
  avDeck.analyserR = null;
}

/* ---------- attach / detach ---------- */

function avDeckAttach() {
  try {
    avDeckInit();
    if (avDeck.attached && avDeck.ctx) {
      return { ok: true, ctx: avDeck.ctx, rate: avDeck.rate, fft: avDeck.fft };
    }
    const ctx = avDeckResolveCtx();
    if (!ctx) { avDeck.attachRefusals++; return { ok: false, ctx: null, rate: null, fft: 0 }; }
    const rate = avDeckFiniteOr(ctx.sampleRate, 48000);
    if (!(rate > 0)) { avDeck.attachRefusals++; return { ok: false, ctx: ctx, rate: null, fft: 0 }; }
    const master = avDeckResolveMaster(ctx);
    if (!master) { avDeck.attachRefusals++; return { ok: false, ctx: ctx, rate: rate, fft: 0 }; }
    avDeckDisconnect();
    const aL = ctx.createAnalyser();
    aL.fftSize = AV_DECK_FFT;
    aL.smoothingTimeConstant = AV_DECK_SMOOTH;
    try { aL.minDecibels = -140; aL.maxDecibels = 12; } catch (e) { /* defaults stand */ }
    const aR = ctx.createAnalyser();
    aR.fftSize = AV_DECK_FFT;
    aR.smoothingTimeConstant = AV_DECK_SMOOTH;
    try { aR.minDecibels = -140; aR.maxDecibels = 12; } catch (e) { /* defaults stand */ }
    const split = ctx.createChannelSplitter(2);
    master.connect(split);
    split.connect(aL, 0);
    split.connect(aR, 1);
    /* exotic rates above the init preallocation: upsize the meter rings once, right here */
    if (rate > AV_DECK_RING_SR) {
      avDeck.lufsL = new Float32Array(Math.round(AV_DECK_LUFS_S * rate));
      avDeck.lufsR = new Float32Array(Math.round(AV_DECK_LUFS_S * rate));
      avDeck.tpL = new Float32Array(Math.round(AV_DECK_TP_S * rate));
      avDeck.tpR = new Float32Array(Math.round(AV_DECK_TP_S * rate));
    }
    const plan = avDeckLogBandPlan(rate, AV_DECK_FFT, AV_DECK_BANDS);
    for (let b = 0; b < AV_DECK_BANDS; b++) {
      avDeck.binLo[b] = (plan.ok === true) ? plan.binLo[b] : 0;
      avDeck.binHi[b] = (plan.ok === true) ? plan.binHi[b] : 0;
    }
    avDeck.lufsLen = Math.min(Math.round(AV_DECK_LUFS_S * rate), avDeck.lufsL.length);
    avDeck.tpLen = Math.min(Math.round(AV_DECK_TP_S * rate), avDeck.tpL.length);
    avDeck.lufsFill = 0;
    avDeck.tpFill = 0;
    avDeck.ctx = ctx;
    avDeck.master = master;
    avDeck.splitter = split;
    avDeck.analyserL = aL;
    avDeck.analyserR = aR;
    avDeck.rate = rate;
    avDeck.fft = AV_DECK_FFT;
    avDeck.attached = true;
    avDeck.lastCtxAt = avDeckFiniteOr(avDeckCtxTime(), 0);
    avDeck.wfAt = 0;
    avDeck.wfGap = 0;
    avDeck.meterAt = 0;
    return { ok: true, ctx: ctx, rate: rate, fft: AV_DECK_FFT };
  } catch (e) {
    avDeck.attachRefusals++;
    return { ok: false, ctx: null, rate: null, fft: 0 };
  }
}

function avDeckDetach() {
  try {
    avDeckDisconnect();
    avDeck.attached = false;
    avDeck.ctx = null;
    avDeck.master = null;
    avDeck.rate = null;
    avDeck.fft = AV_DECK_FFT;
    avDeck.scopeReady = false;
    avDeck.specReady = false;
    avDeck.wfHead = 0;
    avDeck.wfRows = 0;
    avDeck.wfLatest = -1;
    avDeck.wfGap = 0;
    avDeck.lufsFill = 0;
    avDeck.tpFill = 0;
    avDeck.lufsLen = 0;
    avDeck.tpLen = 0;
    avDeck.lufsShort = null;
    avDeck.dbtp = null;
    avDeck.peakDb = null;
    avDeck.energyDb = null;
    avDeck.gainL = 0;
    avDeck.gainR = 0;
    avDeck.gainPeak = 0;
    avDeck.lastCtxAt = 0;
    if (avDeck.inited) {
      avDeck.scopeMin.fill(0);
      avDeck.scopeMax.fill(0);
      avDeck.bands.fill(0);
      avDeck.wfData.fill(0);
      avDeck.fScope.ready = false;
      avDeck.fSpectrum.ready = false;
      avDeck.fSpectrum.peakBand = -1;
      avDeck.fSpectrum.peakHz = null;
      avDeck.fWaterfall.ready = false;
      avDeck.fWaterfall.rows = 0;
      avDeck.fWaterfall.latestRow = -1;
      avDeck.fMeters.lufsShort = null;
      avDeck.fMeters.dbtp = null;
      avDeck.fMeters.peakDb = null;
      avDeck.fMeters.energyDb = null;
      avDeck.fGain.l = 0;
      avDeck.fGain.r = 0;
      avDeck.fGain.peak = 0;
    }
    return true;
  } catch (e) { return false; }
}

/* ---------- ctx clock ---------- */

function avDeckCtxTime() {
  try {
    const c = avDeck.ctx;
    if (c) { const t = avDeckNum(c.currentTime); if (isFinite(t)) return t; }
  } catch (e) { /* hold */ }
  return avDeck.lastCtxAt;
}

/* ---------- note ticker (the ONE avNote bus; poll only) ---------- */

function avDeckNoteDown(name, at) {
  avDeck.notesSeen++;
  avDeck.lastDownName = name;
  avDeck.lastDownAt = at;
  avDeck.lastNote = { name: name, vel: null, at: Math.round(at) };
}

function avDeckPollNotes(now) {
  const w = (typeof window !== "undefined") ? window : null;
  if (!w) return;
  let preview = null;
  try { preview = w.__lastNotePreview; } catch (e) { preview = null; }
  try { avDeck.lastCode = w.__lastNoteCode; } catch (e) { /* keep last */ }
  if (typeof preview === "string" && preview.length > 0) {
    if (preview !== avDeck.seenPreview) {
      avDeck.seenPreview = preview;
      avDeckNoteDown(preview, now);
    }
  } else if (avDeck.seenPreview !== null && preview !== avDeck.seenPreview) {
    avDeck.seenPreview = preview;
  }
  if (now - avDeck.notePollAt >= AV_DECK_NOTE_POLL_MS) {
    avDeck.notePollAt = now;
    let held = null;
    try {
      if (typeof w.__avNotes === "function") {
        const s = w.__avNotes();
        if (s && s.held && typeof s.held.length === "number") held = s.held;
      }
    } catch (e) { held = null; }
    if (held) {
      const next = {};
      for (let i = 0; i < held.length; i++) {
        const nm = held[i];
        if (typeof nm !== "string" || nm.length === 0) continue;
        next[nm] = true;
        if (avDeck.heldSeen[nm] !== true) {
          if (!(nm === avDeck.lastDownName && (now - avDeck.lastDownAt) < AV_DECK_NOTE_POLL_MS)) avDeckNoteDown(nm, now);
        }
      }
      avDeck.heldSeen = next;
    }
  }
}

/* ---------- engine samples: voices (stats) + CPU (bench read), chip cadence ---------- */

function avDeckEngApplyStats(s, h) {
  try {
    if (s && typeof s === "object") {
      const a = avDeckNum(s.active);
      if (isFinite(a) && a >= 0) avDeck.voices = a;
      const m = avDeckNum(s.maxVoices);
      if (isFinite(m) && m > 0) avDeck.maxVoices = m;
      else if (h && isFinite(avDeckNum(h.maxVoices)) && h.maxVoices > 0) avDeck.maxVoices = h.maxVoices;
    }
  } catch (e) { /* keep last */ }
}

function avDeckEngApplyBench(b) {
  try {
    if (b && typeof b === "object") {
      const mean = avDeckNum(b.meanUs);
      if (isFinite(mean) && mean >= 0) {
        const ms = mean / 1000;
        avDeck.cpuMs = ms;
        const prev = avDeck.cpuAvgMs;
        avDeck.cpuAvgMs = (prev === null || !isFinite(avDeckNum(prev))) ? ms : (prev * 0.75 + ms * 0.25);
      }
    }
  } catch (e) { /* keep last */ }
}

function avDeckEngBenchCall(h) {
  try {
    const b = h.bench("read");
    return (b && typeof b.then === "function") ? b : null;
  } catch (e) { return null; }
}

function avDeckEngTick(now) {
  const h = avDeckEngineHandle();
  if (!h) {
    avDeck.voices = null;
    avDeck.maxVoices = null;
    avDeck.cpuMs = null;
    avDeck.cpuAvgMs = null;
    let t = null;
    try {
      const f = (typeof window !== "undefined") ? window.__avEngine : null;
      if (f && f.ready === true && typeof f.tier === "string") t = f.tier;
    } catch (e) { t = null; }
    avDeck.tier = t;
    return;
  }
  avDeck.tier = (typeof h.mode === "string" && h.mode) ? h.mode : ((typeof h.tier === "string") ? h.tier : null);
  if (avDeck.engBusy || now - avDeck.engAt < AV_DECK_ENG_MS) return;
  avDeck.engAt = now;
  avDeck.engBusy = true;
  try {
    let p = null;
    try { p = h.stats(); } catch (e) { p = null; }
    Promise.resolve(p)
      .then((s) => { avDeckEngApplyStats(s, h); return avDeckEngBenchCall(h); })
      .then((b) => { avDeckEngApplyBench(b); })
      .catch(() => { /* silent, counted below via skips when it matters */ })
      .then(() => { avDeck.engBusy = false; });
  } catch (e) {
    avDeck.engBusy = false;
    avDeck.skips++;
  }
}

/* ---------- fps window ---------- */

function avDeckFps(now) {
  const last = avDeck.fpsLast;
  if (last > 0) {
    const dt = now - last;
    if (dt > 0 && dt < 60000) {
      avDeck.fpsRing[avDeck.fpsHead & 15] = dt;
      avDeck.fpsHead++;
      const n = avDeck.fpsHead < 16 ? avDeck.fpsHead : 16;
      if (n >= 4) {
        let s = 0;
        for (let i = 0; i < n; i++) s += avDeck.fpsRing[i];
        if (s > 0) avDeck.fps = Math.round((1000 * n / s) * 10) / 10;
      }
    }
  }
  avDeck.fpsLast = now;
}

/* ---------- the pull: scope envelope + energy + gain ---------- */

function avDeckScopeEnergy(n) {
  const L = avDeck.timeL, R = avDeck.timeR;
  const N = AV_DECK_SCOPE_N, minA = avDeck.scopeMin, maxA = avDeck.scopeMax;
  let sumSq = 0, pkL = 0, pkR = 0;
  for (let b = 0; b < N; b++) {
    let i0 = Math.floor(b * n / N);
    let i1 = Math.floor((b + 1) * n / N);
    if (i1 <= i0) i1 = i0 + 1;
    if (i1 > n) i1 = n;
    let mn = Infinity, mx = -Infinity;
    for (let i = i0; i < i1; i++) {
      let l = L[i]; if (!isFinite(l)) l = 0;
      let r = R[i]; if (!isFinite(r)) r = 0;
      const m = (l + r) * 0.5;
      if (m < mn) mn = m;
      if (m > mx) mx = m;
      sumSq += l * l + r * r;
      const al = l < 0 ? -l : l;
      if (al > pkL) pkL = al;
      const ar = r < 0 ? -r : r;
      if (ar > pkR) pkR = ar;
    }
    if (!(mn <= mx)) { mn = 0; mx = 0; }
    minA[b] = mn;
    maxA[b] = mx;
  }
  avDeck.scopeReady = true;
  avDeck.fScope.ready = true;
  avDeck.gainL = avDeckHoldDecay(avDeck.gainL, pkL, 1, AV_DECK_GAIN_DOWN);
  avDeck.gainR = avDeckHoldDecay(avDeck.gainR, pkR, 1, AV_DECK_GAIN_DOWN);
  avDeck.gainPeak = avDeckHoldDecay(avDeck.gainPeak, pkL > pkR ? pkL : pkR, 1, AV_DECK_PEAK_DOWN);
  avDeck.fGain.l = avDeck.gainL;
  avDeck.fGain.r = avDeck.gainR;
  avDeck.fGain.peak = avDeck.gainPeak;
  const rms = Math.sqrt(sumSq / (2 * n));
  const edb = avDeckDbOfAmp(rms);
  avDeck.energyDb = edb;
  avDeck.fMeters.energyDb = edb;
}

/* ---------- the spectrum: linear FFT bins -> 96 log bands (max dB per band) ---------- */

function avDeckSpectrum() {
  const F = avDeck.freq, bands = avDeck.bands;
  const lo = avDeck.binLo, hi = avDeck.binHi;
  let best = -Infinity, bestB = -1;
  for (let b = 0; b < AV_DECK_BANDS; b++) {
    const i0 = lo[b], i1 = hi[b];
    let m = -Infinity;
    for (let i = i0; i <= i1; i++) {
      let v = F[i];
      if (typeof v !== "number" || !isFinite(v)) v = AV_DECK_DB_CLAMP_LO;
      if (v > m) m = v;
    }
    if (!isFinite(m) || m < AV_DECK_DB_CLAMP_LO) m = AV_DECK_DB_CLAMP_LO;
    if (m > AV_DECK_DB_CLAMP_HI) m = AV_DECK_DB_CLAMP_HI;
    bands[b] = m;
    if (m > best) { best = m; bestB = b; }
  }
  avDeck.specReady = true;
  avDeck.fSpectrum.ready = true;
  if (bestB >= 0 && best > AV_DECK_PEAK_MIN_DB) {
    avDeck.fSpectrum.peakBand = bestB;
    const hz = avDeckBandToHz(bestB);
    avDeck.fSpectrum.peakHz = (hz === null) ? null : Math.round(hz * 100) / 100;
  } else {
    avDeck.fSpectrum.peakBand = -1;
    avDeck.fSpectrum.peakHz = null;
  }
}

/* ---------- waterfall: rows of the current 96 bands, wall-clock gated ---------- */

function avDeckWfPush(now) {
  const data = avDeck.wfData, bands = avDeck.bands;
  const head = avDeck.wfHead, base = head * AV_DECK_BANDS;
  for (let b = 0; b < AV_DECK_BANDS; b++) data[base + b] = bands[b];
  avDeck.wfHead = (head + 1) % AV_DECK_WF_ROWS;
  avDeck.wfLatest = head;
  if (avDeck.wfRows < AV_DECK_WF_ROWS) avDeck.wfRows++;
  avDeck.fWaterfall.ready = avDeck.wfRows > 0;
  avDeck.fWaterfall.rows = avDeck.wfRows;
  avDeck.fWaterfall.latestRow = avDeck.wfLatest;
  avDeck.fWaterfall.rowMs = avDeck.waterfallMs;
  avDeck.wfAt = now;
  avDeck.wfGap = 0;
}

/* ---------- meter rings: append fresh samples (ctx clock), then av_loud at ≤2 Hz ---------- */

function avDeckRingAppend(ring, len, fill, buf, count) {
  if (count <= 0 || len <= 0 || !ring) return fill;
  if (count > buf.length) count = buf.length;
  if (count > len) count = len;
  let f = fill;
  if (!(f >= 0)) f = 0;
  if (f > len) f = len;
  if (f + count > len) {
    const shift = f + count - len;
    if (shift >= f) f = 0;
    else { ring.copyWithin(0, shift, f); f -= shift; }
  }
  const base = buf.length - count;
  for (let i = 0; i < count; i++) ring[f + i] = buf[base + i];
  return f + count;
}

function avDeckAppendRings(dts) {
  let count = dts;
  if (!(count > 0)) return;
  if (count > AV_DECK_FFT) count = AV_DECK_FFT;
  /* one fill counter per stereo PAIR: both channels append the same count, the counter
     advances ONCE (a per-channel advance would desync the rings — the sa-A harness caught it) */
  const lf = avDeck.lufsFill;
  const nlf = avDeckRingAppend(avDeck.lufsL, avDeck.lufsLen, lf, avDeck.timeL, count);
  avDeckRingAppend(avDeck.lufsR, avDeck.lufsLen, lf, avDeck.timeR, count);
  avDeck.lufsFill = nlf;
  const tf = avDeck.tpFill;
  const ntf = avDeckRingAppend(avDeck.tpL, avDeck.tpLen, tf, avDeck.timeL, count);
  avDeckRingAppend(avDeck.tpR, avDeck.tpLen, tf, avDeck.timeR, count);
  avDeck.tpFill = ntf;
}

function avDeckMeters(now) {
  avDeck.meterAt = now;
  let lufs = null, dbtp = null, pk = null;
  try {
    if (typeof avLoudShortTerm === "function" && avDeck.lufsFill >= 1) {
      const r = avLoudShortTerm(avDeck.lufsL, avDeck.lufsR, avDeck.rate, avDeck.lufsFill / avDeck.rate);
      if (r && r.ok === true && typeof r.lufs === "number" && isFinite(r.lufs)) lufs = r.lufs;
    }
  } catch (e) { lufs = null; }
  try {
    if (typeof avLoudTruePeak === "function" && avDeck.tpFill >= 1) {
      const tf = avDeck.tpFill;
      const vl = (tf >= avDeck.tpL.length) ? avDeck.tpL : avDeck.tpL.subarray(0, tf);
      const vr = (tf >= avDeck.tpR.length) ? avDeck.tpR : avDeck.tpR.subarray(0, tf);
      const r = avLoudTruePeak(vl, vr, avDeck.rate);
      if (r && r.ok === true) {
        if (typeof r.dbtp === "number" && isFinite(r.dbtp)) dbtp = r.dbtp;
        if (typeof r.peakDb === "number" && isFinite(r.peakDb)) pk = r.peakDb;
      }
    }
  } catch (e) { dbtp = null; pk = null; }
  avDeck.lufsShort = lufs;
  avDeck.dbtp = dbtp;
  avDeck.peakDb = pk;
  avDeck.fMeters.lufsShort = lufs;
  avDeck.fMeters.dbtp = dbtp;
  avDeck.fMeters.peakDb = pk;
}

/* ---------- the pull pass (only while attached ∩ run ∩ !freeze) ---------- */

function avDeckPull(now, dts) {
  const L = avDeck.analyserL, R = avDeck.analyserR;
  if (!L || !R) return;
  try { L.getFloatTimeDomainData(avDeck.timeL); } catch (e) { avDeck.skips++; return; }
  try { R.getFloatTimeDomainData(avDeck.timeR); } catch (e) { avDeck.skips++; return; }
  avDeckScopeEnergy(AV_DECK_FFT);
  try { L.getFloatFrequencyData(avDeck.freq); avDeckSpectrum(); } catch (e) { avDeck.skips++; }
  if (now - avDeck.wfAt >= avDeck.waterfallMs || avDeck.wfGap >= AV_DECK_WF_STEPS) avDeckWfPush(now);
  else avDeck.wfGap++;
  avDeckAppendRings(dts);
  if (now - avDeck.meterAt >= AV_DECK_METER_MS) avDeckMeters(now);
}

/* ---------- THE step (synchronous, deterministic; the rig's seam) ---------- */

function avDeckStep() {
  let now = 0;
  try {
    avDeckInit();
    now = avDeckNow();
    avDeck.frames++;
    avDeckFps(now);
    avDeckPollNotes(now);
    if (avDeck.attached && avDeck.ctx) {
      let closed = false;
      try { closed = (avDeck.ctx.state === "closed"); } catch (e) { closed = false; }
      if (closed) avDeckDetach();
    }
    const ct = avDeckCtxTime();
    let dts = 0;
    if (avDeck.attached) {
      const dt = ct - avDeck.lastCtxAt;
      if (dt > 0) dts = Math.round(dt * (avDeck.rate || 0));
    }
    avDeck.lastCtxAt = ct;
    const pullOk = avDeck.attached && avDeck.run === true && avDeck.freeze !== true;
    if (pullOk) avDeckPull(now, dts);   /* frozen/paused: every ring holds, gap counters included */
    avDeckEngTick(now);
  } catch (e) {
    avDeck.errors++;
  }
  return {
    at: now,
    frames: avDeck.frames,
    attached: avDeck.attached === true,
    voices: avDeck.voices,
    notesSeen: avDeck.notesSeen,
  };
}

/* ---------- frames · readouts · views · snapshot ---------- */

function avDeckFrame(kind) {
  try {
    avDeckInit();
    const k = String(kind == null ? "" : kind);
    if (k === "scope") return avDeck.fScope;
    if (k === "spectrum") return avDeck.fSpectrum;
    if (k === "waterfall") return avDeck.fWaterfall;
    if (k === "meters") return avDeck.fMeters;
    if (k === "gain") return avDeck.fGain;
  } catch (e) { return null; }
  return null;
}

function avDeckReadouts() {
  const out = {
    bpm: null,
    grid: null,
    voices: avDeck.voices,
    maxVoices: avDeck.maxVoices,
    tier: avDeck.tier,
    ctxState: null,
    cpuMs: avDeck.cpuMs,
    cpuAvgMs: avDeck.cpuAvgMs,
    notesSeen: avDeck.notesSeen,
    lastNote: null,
    fps: avDeck.fps,
  };
  try {
    if (typeof avState !== "undefined" && avState && isFinite(avDeckNum(avState.bpm))) out.bpm = Number(avState.bpm);
  } catch (e) { /* null */ }
  try {
    if (typeof avSeqSnap === "function") {
      const s = avSeqSnap();
      if (s && typeof s.grid === "string" && s.grid) out.grid = s.grid;
    }
  } catch (e) { /* null */ }
  try { if (avDeck.ctx) out.ctxState = String(avDeck.ctx.state); } catch (e) { /* null */ }
  out.lastNote = avDeck.lastNote ? { name: avDeck.lastNote.name, vel: avDeck.lastNote.vel, at: avDeck.lastNote.at } : null;
  return out;
}

function avDeckViewSnap() {
  return {
    run: avDeck.run === true,
    freeze: avDeck.freeze === true,
    dbFloor: avDeck.dbFloor,
    waterfallMs: avDeck.waterfallMs,
  };
}

function avDeckSetView(kind, patch) {
  try {
    avDeckInit();
    const k = String(kind == null ? "" : kind);
    if (k === "run" || k === "freeze") {
      if (typeof patch !== "boolean") return { ok: false, view: avDeckViewSnap() };
      if (k === "run") avDeck.run = patch;
      else avDeck.freeze = patch;
      return { ok: true, view: avDeckViewSnap() };
    }
    if (k === "dbFloor" || k === "waterfallMs") {
      const n = avDeckNum(patch);
      if (!isFinite(n)) return { ok: false, view: avDeckViewSnap() };
      if (k === "dbFloor") {
        avDeck.dbFloor = avDeckClampN(n, AV_DECK_DB_FLOOR_MIN, AV_DECK_DB_FLOOR_MAX);
      } else {
        avDeck.waterfallMs = avDeckClampN(n, AV_DECK_WF_MS_MIN, AV_DECK_WF_MS_MAX);
        avDeck.fWaterfall.rowMs = avDeck.waterfallMs;
      }
      return { ok: true, view: avDeckViewSnap() };
    }
  } catch (e) { /* refusal below */ }
  return { ok: false, view: avDeckViewSnap() };
}

function avDeckClasses() { return []; }

function avDeckSnapshot() {
  let ctxState = null;
  try { if (avDeck.ctx) ctxState = String(avDeck.ctx.state); } catch (e) { ctxState = null; }
  return {
    version: AV_DECK_VERSION,
    inited: avDeck.inited === true,
    attached: avDeck.attached === true,
    run: avDeck.run === true,
    freeze: avDeck.freeze === true,
    dbFloor: avDeck.dbFloor,
    waterfallMs: avDeck.waterfallMs,
    rate: avDeck.rate,
    fft: avDeck.fft,
    frames: avDeck.frames,
    skips: avDeck.skips,
    errors: avDeck.errors,
    attachRefusals: avDeck.attachRefusals,
    notesSeen: avDeck.notesSeen,
    lastNote: avDeck.lastNote ? { name: avDeck.lastNote.name, vel: avDeck.lastNote.vel, at: avDeck.lastNote.at } : null,
    lastCode: (avDeck.lastCode === null || avDeck.lastCode === undefined) ? null : String(avDeck.lastCode),
    voices: avDeck.voices,
    maxVoices: avDeck.maxVoices,
    tier: avDeck.tier,
    ctxState: ctxState,
    cpuMs: avDeck.cpuMs,
    cpuAvgMs: avDeck.cpuAvgMs,
    fps: avDeck.fps,
    scopeReady: avDeck.scopeReady === true,
    spectrumReady: avDeck.specReady === true,
    peakBand: avDeck.fSpectrum ? avDeck.fSpectrum.peakBand : -1,
    peakHz: avDeck.fSpectrum ? avDeck.fSpectrum.peakHz : null,
    wfRows: avDeck.wfRows,
    wfLatestRow: avDeck.wfLatest,
    wfRowMs: avDeck.waterfallMs,
    lufsShort: avDeck.lufsShort,
    dbtp: avDeck.dbtp,
    peakDb: avDeck.peakDb,
    energyDb: avDeck.energyDb,
    gain: { l: avDeck.gainL, r: avDeck.gainR, peak: avDeck.gainPeak },
    lufsFill: avDeck.lufsFill,
    lufsLen: avDeck.lufsLen,
    tpFill: avDeck.tpFill,
    tpLen: avDeck.tpLen,
  };
}

/* ---------- the guarded window probe (the very last statement; node harnesses stay DOM-free) ---------- */

if (typeof window !== "undefined") {
  try {
    window.__avDeck = {
      version: AV_DECK_VERSION,
      init: avDeckInit,
      attach: avDeckAttach,
      detach: avDeckDetach,
      step: avDeckStep,
      frame: avDeckFrame,
      readouts: avDeckReadouts,
      setView: avDeckSetView,
      snapshot: avDeckSnapshot,
      pure: avDeckPure,
    };
  } catch (e) { /* no window — node harness only */ }
}
