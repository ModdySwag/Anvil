/* av_metro.js — Anvil S1 metronome + count-in (wave sa-B; verify/_s1_wave.md §2.2).

   WHAT THIS IS — the studio click: a lookahead click scheduler riding the live audio clock,
   phase-aligned to the sequencer transport when it plays and standalone otherwise, plus the
   count-in (1..4 bars) that resolves when it completes. Nothing is mounted; no DOM at load.

   CLOCK LAW (mirrors src/av_seq_sched.js — read it first):
   - Own lookahead ticker: 0.12 s plan-ahead / 25 ms wake against the live ctx
     (window.__avEngine.handle.ctx first, avTap.ctx fallback — the same-context law).
   - Beat = 60/bpm; bpm = avState.bpm (guarded; 120 default; 20..300 clamp).
   - When avSeqIsPlaying(): PHASE-ALIGN. The transport grid is reconstructed from
     avSeqPosition() (guarded): after observing a step INCREMENT, origin = pos.t − step·sd
     where sd is the grid step (60/bpm/4 for "16", /3 for "8t" — the wave's pure formula,
     grid read from avSeqSnap() behind a 0.5 s cache; pos.t is the first sighting of the new
     step, so it is ≤ one wake late), minus wake/2 (the seq's half-wake midpoint law). Click k
     then sits at origin + k·beatDur — ON the transport grid within ±half a wake. Drift past
     half a grid step (the seq's stall re-anchor) re-locks; a bpm change re-locks; a step
     count that goes backwards (transport restart) re-locks. While the transport plays with no
     lock yet the click train PAUSES (≤ one grid step) — clicks never land off the grid; a
     transport start re-snaps the standalone train onto the grid, the resume beat being the
     first grid beat after (last planned click + ¾ beat) — a bounded re-sync gap in
     (0.75, 1.75] beats whenever the pointer is fresh; a stale pointer resumes at the next
     beat without a burst (the drop law). When the transport stops the current grid is KEPT
     (frozen, no jump).
   - Standalone: own origin = now + 0.05 s runway (the seq play offset), beats on it.
   - DELIVERY: a click is scheduled when its time is inside (now, now + 0.12 s); a click more
     than 0.05 s late (stall) is dropped and counted, never fired in a burst.

   CLICK LAW: synthesized ping — oscillator (sine), accent 1320 Hz / plain 880 Hz, ~25 ms
   exponential decay, gain = level (0..1) — connected to avMasterFor(ctx) ONLY. No master node
   (tap absent) or level 0 ⇒ the click is planned but not sounded (the ring is the planner's
   honest record). Clicks never touch the takes path (takes record the input node, not this).

   COUNT-IN: avMetroCountIn(bars) schedules bars×beatsPerBar clicks on its own origin
   (now + 0.05 s — it must resolve ≈ bars·bar-seconds from the CALL, so it does NOT wait for
   grid alignment; only bars 1..4, clamped), and resolves { ok, bars, seconds } at completion
   (checked on the ticker). Frozen at call time: beat duration, beatsPerBar and accent — a
   count-in bpm change leaves the count-in on its own steady tempo. During a count-in the
   regular train pauses; when it ends and the metronome is on, the train resumes on the
   current grid — the first grid beat after (last planned click + ¾ beat), deterministic
   and continuous when the click grids coincide. The count-in clicks regardless of the
   metronome on/off toggle (that gates only the recurring click) and never rejects: no ctx /
   ctx lost / superseded resolve { ok:false, ... } immediately — the promise can not hang on
   a dead clock.

   OBSERVABLES: avMetroInit() -> true · avMetroSet({ on, level, beatsPerBar, accent }) ->
   state · avMetroState() -> { on, level, bpm, beatsPerBar, originT, nextClickAt,
   clicks:[{t,accent}] } (the pinned shape; + mode, countIn, planned, dropped, reason,
   ctxBound, version) · avMetroCountIn(bars) -> Promise · avMetroClasses() -> [] (this
   module mounts nothing — the Studio card owns all markup) · window.__avMetro debug handle.

   LAWS: 'use strict'; ONE namespace (avMetro*, AV_METRO_*); node-loadable (no DOM/browser
   reach at load; every reach typeof-guarded inside a function); NEVER throws (a pump, a
   click, a state read and every setter fail soft; refusals are honest).

   ONE writer (child sa-B). The browser rig (verify/cdp_studio.mjs, sa-C) is the parent gate;
   this file is proven by a node harness (cache/scratch/s1/metro/). */

"use strict";

const AV_METRO_VERSION = "s1.0";
const AV_METRO_LOOKAHEAD_S = 0.12;          /* the seq law: plan-ahead window (s)          */
const AV_METRO_WAKE_MS = 25;                /* the seq law: timer cadence (ms)             */
const AV_METRO_LOCK_BIAS_S = AV_METRO_WAKE_MS / 2000;  /* 0.0125 — half-wake midpoint (seq) */
const AV_METRO_START_OFFSET_S = 0.05;       /* standalone/count-in origin runway (seq play) */
const AV_METRO_LATE_DROP_S = 0.05;          /* a click later than this (stall) is dropped  */
const AV_METRO_RESYNC_GAP_FRAC = 0.75;      /* min gap to the resumed grid beat (× beat)   */
const AV_METRO_ACCENT_HZ = 1320;            /* accent ping                                 */
const AV_METRO_PLAIN_HZ = 880;              /* plain ping                                  */
const AV_METRO_DECAY_S = 0.025;             /* ~25 ms exponential decay                    */
const AV_METRO_STOP_PAD_S = 0.005;          /* osc.stop = start + decay + pad              */
const AV_METRO_CLICKS_CAP = 64;             /* §2.2: bounded ring (last 64)                */
const AV_METRO_PLAN_GUARD = 2048;           /* per-train per-pump scheduling cap           */
const AV_METRO_BPM_MIN = 20;
const AV_METRO_BPM_MAX = 300;
const AV_METRO_BPM_DEF = 120;
const AV_METRO_BEATS_MIN = 1;               /* beatsPerBar clamp                           */
const AV_METRO_BEATS_MAX = 16;
const AV_METRO_BEATS_DEF = 4;
const AV_METRO_LEVEL_MIN = 0;               /* §2.2 clamp: level 0..1                      */
const AV_METRO_LEVEL_MAX = 1;
const AV_METRO_LEVEL_DEF = 0.5;
const AV_METRO_BARS_MIN = 1;                /* count-in clamp: 1..4 bars                   */
const AV_METRO_BARS_MAX = 4;
const AV_METRO_BARS_DEF = 1;
const AV_METRO_GRID_CACHE_S = 0.5;          /* avSeqSnap() grid-string cache (deep copy!)  */
const AV_METRO_CLASSES = Object.freeze([]); /* no DOM of our own (the Studio card is sa-D) */

/* ---------- module state ---------- */

const avMetro = {
  inited: false,
  on: false,
  level: AV_METRO_LEVEL_DEF,
  beatsPerBar: AV_METRO_BEATS_DEF,
  accent: true,
  mode: "none",            /* "none" | "own" | "seq" — the kind of the ACTIVE regular grid  */
  originT: null,           /* active regular-grid origin (audio-clock s) | null             */
  nextT: null,             /* next regular click time to plan | null (paused / not streaming)*/
  lastT: null,             /* last planned click time (resync floor)                        */
  clicks: new Array(AV_METRO_CLICKS_CAP).fill(null),  /* bounded ring                        */
  clicksN: 0,              /* total planned (ring holds min(n, cap))                        */
  dropped: 0,              /* clicks dropped by the stall law                               */
  ctx: null,
  handle: null,
  ensureTried: false,
  ensurePending: false,
  timer: null,
  seqLock: null,           /* transport-grid origin lock (s) | null                         */
  seqLastStep: null,       /* last avSeqPosition().step seen (increment discipline)         */
  seqBeatDur: 0,           /* beat duration the lock was solved with (bpm-change detector)  */
  gridStr: null,           /* cached grid string ("16" | "8t") from avSeqSnap()             */
  gridAt: -1,
  cin: null,               /* active count-in | null                                        */
};

let avMetroDebug = null;   /* window.__avMetro handle (null in plain node)                  */

/* ---------- small primitives (never throw) ---------- */

function avMetroNum(v, dflt) {
  const n = Number(v);
  return isFinite(n) ? n : dflt;
}
function avMetroClampNum(v, dflt, lo, hi) {
  const n = Number(v);
  if (v == null || v === "" || !isFinite(n)) return dflt;
  return n < lo ? lo : (n > hi ? hi : n);
}
function avMetroClampInt(v, dflt, lo, hi) {
  const n = Number(v);
  if (v == null || v === "" || !isFinite(n)) return dflt;
  const r = Math.round(n);
  return r < lo ? lo : (r > hi ? hi : r);
}
function avMetroBoolish(v) {
  if (v === true || v === 1 || v === "1" || v === "true" || v === "on") return true;
  if (v === false || v === 0 || v === "0" || v === "false" || v === "off") return false;
  return null;
}

/* ---------- pure beat-grid math (the harness tests this in plain node) ---------- */

/* beat duration from bpm (guarded; 120 default; 20..300 clamp) */
function avMetroBeatDur(bpm) {
  const b = avMetroClampNum(bpm, AV_METRO_BPM_DEF, AV_METRO_BPM_MIN, AV_METRO_BPM_MAX);
  return 60 / b;
}

/* click times = origin + k·beatDur for k with t ∈ [fromT, toT); accent on beat 1 of the bar.
   PURE, analytic, allocation-light; guard-capped so a degenerate beat can never hang. */
function avMetroClicksInWindow(originT, beatDur, beatsPerBar, accentOn, fromT, toT) {
  const out = [];
  try {
    const o = Number(originT), bd = Number(beatDur), f = Number(fromT), to = Number(toT);
    if (!isFinite(o) || !(bd > 0) || !isFinite(bd) || !isFinite(f) || !isFinite(to) || !(to > f)) return out;
    const bpb = avMetroClampInt(beatsPerBar, AV_METRO_BEATS_DEF, AV_METRO_BEATS_MIN, AV_METRO_BEATS_MAX);
    let k = Math.ceil((f - o) / bd - 1e-9);
    if (!isFinite(k) || k < 0) k = 0;
    let guard = 0;
    while (guard++ < AV_METRO_PLAN_GUARD) {
      const t = o + k * bd;
      if (!(t < to)) break;
      out.push({ t: t, accent: !!(accentOn && (k % bpb) === 0) });
      k++;
    }
  } catch (e) { /* pure math never throws — an empty plan is the honest fallback */ }
  return out;
}

/* count-in plan: bars×beatsPerBar beats from origin, accent on beat 1 of each bar. PURE. */
function avMetroCountInPlan(bars, bpm, beatsPerBar, originT, accentOn) {
  const b = avMetroClampInt(bars, AV_METRO_BARS_DEF, AV_METRO_BARS_MIN, AV_METRO_BARS_MAX);
  const bpb = avMetroClampInt(beatsPerBar, AV_METRO_BEATS_DEF, AV_METRO_BEATS_MIN, AV_METRO_BEATS_MAX);
  const bd = avMetroBeatDur(bpm);
  const o = avMetroNum(originT, 0);
  const total = b * bpb;
  const seconds = total * bd;
  const clicks = [];
  for (let k = 0; k < total; k++) clicks.push({ t: o + k * bd, accent: !!(accentOn && (k % bpb) === 0) });
  return { bars: b, beatsPerBar: bpb, total: total, seconds: seconds, originT: o, endT: o + seconds, clicks: clicks };
}

/* first grid beat strictly after `afterT` on origin + k·beatDur (null when degenerate).
   The +1e-9 guard keeps "strictly after" true under float noise: a boundary that lands
   within an ulp of `afterT` is skipped, never re-fired (no same-time/double click). */
function avMetroNextGridT(originT, beatDur, afterT) {
  const o = Number(originT), bd = Number(beatDur), a = Number(afterT);
  if (!isFinite(o) || !(bd > 0) || !isFinite(bd) || !isFinite(a)) return null;
  const k = Math.floor((a - o) / bd + 1e-9) + 1;
  const t = o + k * bd;
  return isFinite(t) ? t : null;
}

/* ---------- live tempo + grid (guarded sibling reads) ---------- */

function avMetroLiveBpm() {
  try {
    if (typeof avState !== "undefined" && avState && typeof avState.bpm === "number" && isFinite(avState.bpm)) {
      return avMetroClampNum(avState.bpm, AV_METRO_BPM_DEF, AV_METRO_BPM_MIN, AV_METRO_BPM_MAX);
    }
  } catch (e) { /* no store */ }
  return AV_METRO_BPM_DEF;
}

/* the seq's grid string — avSeqSnap() is a DEEP COPY (av_seq_core), so cache it ~0.5 s */
function avMetroGridCached(now) {
  try {
    const t = isFinite(now) ? now : 0;
    if (avMetro.gridStr !== null && (t - avMetro.gridAt) < AV_METRO_GRID_CACHE_S) return avMetro.gridStr;
    let grid = "16";
    if (typeof avSeqSnap === "function") {
      const s = avSeqSnap();
      if (s && s.grid === "8t") grid = "8t";
    }
    avMetro.gridStr = grid;
    avMetro.gridAt = t;
    return grid;
  } catch (e) { return avMetro.gridStr || "16"; }
}

/* the seq's live base step duration (the wave's pure formula; grid "16" → 60/bpm/4, "8t" → /3) */
function avMetroSeqStepDur(bpm, now) {
  const b = avMetroClampNum(bpm, AV_METRO_BPM_DEF, AV_METRO_BPM_MIN, AV_METRO_BPM_MAX);
  return avMetroGridCached(now) === "8t" ? (60 / b / 3) : (60 / b / 4);
}

function avMetroSeqIsPlaying() {
  try { if (typeof avSeqIsPlaying === "function") return avSeqIsPlaying() === true; } catch (e) { /* sibling gone */ }
  return false;
}
function avMetroSeqPosition() {
  try {
    if (typeof avSeqPosition === "function") {
      const p = avSeqPosition();
      if (p && typeof p === "object") return p;
    }
  } catch (e) { /* sibling gone */ }
  return null;
}

/* a suspended engine ctx cannot advance the click train until it resumes: ask, never insist */
function avMetroKickResume() {
  try {
    const ctx = avMetro.ctx;
    if (!ctx || ctx.state !== "suspended" || typeof ctx.resume !== "function") return false;
    const p = ctx.resume();
    if (p && typeof p.catch === "function") p.catch(function () { /* gesture-gated: stays suspended */ });
    return true;
  } catch (e) { return false; }
}

/* ---------- the clicks ring (bounded, last 64, chronological dump) ---------- */

function avMetroRingPush(t, accent) {
  try {
    avMetro.clicks[avMetro.clicksN % AV_METRO_CLICKS_CAP] = { t: t, accent: accent === true };
    avMetro.clicksN++;
  } catch (e) { /* a ring push never breaks a click */ }
}
function avMetroRingDump() {
  const out = [];
  try {
    const n = avMetro.clicksN;
    const start = n > AV_METRO_CLICKS_CAP ? n - AV_METRO_CLICKS_CAP : 0;
    for (let i = start; i < n; i++) {
      const e = avMetro.clicks[i % AV_METRO_CLICKS_CAP];
      if (e && typeof e.t === "number") out.push({ t: e.t, accent: e.accent === true });
    }
  } catch (e) { /* dump is read-only */ }
  return out;
}
function avMetroRingClear() {
  try {
    for (let i = 0; i < AV_METRO_CLICKS_CAP; i++) avMetro.clicks[i] = null;
    avMetro.clicksN = 0;
    avMetro.dropped = 0;
  } catch (e) { /* clearing is best effort */ }
}

/* ---------- the click (synthesized ping → master bus ONLY) ---------- */

function avMetroPing(t, accent) {
  let osc = null, g = null;
  try {
    const ctx = avMetro.ctx;
    if (!ctx || typeof ctx.createOscillator !== "function" || typeof ctx.createGain !== "function") return false;
    const level = avMetro.level;
    if (!(level > 0)) return false;                        /* level 0: planned, silent      */
    let master = null;
    try { if (typeof avMasterFor === "function") master = avMasterFor(ctx); } catch (e) { master = null; }
    if (!master) return false;                             /* click law: master ONLY, no fallback */
    osc = ctx.createOscillator();
    g = ctx.createGain();
    osc.type = "sine";
    if (osc.frequency && typeof osc.frequency.setValueAtTime === "function") {
      osc.frequency.setValueAtTime(accent ? AV_METRO_ACCENT_HZ : AV_METRO_PLAIN_HZ, t);
    } else if (osc.frequency) {
      osc.frequency.value = accent ? AV_METRO_ACCENT_HZ : AV_METRO_PLAIN_HZ;
    }
    if (g.gain && typeof g.gain.setValueAtTime === "function") {
      g.gain.setValueAtTime(level, t);
      if (typeof g.gain.exponentialRampToValueAtTime === "function") {
        g.gain.exponentialRampToValueAtTime(0.0001, t + AV_METRO_DECAY_S);   /* ~25 ms decay */
      }
    } else if (g.gain) {
      try { g.gain.value = level; } catch (e) { /* stub node */ }
    }
    osc.connect(g);
    g.connect(master);                                     /* ← avMasterFor(ctx) ONLY       */
    osc.start(t);
    osc.stop(t + AV_METRO_DECAY_S + AV_METRO_STOP_PAD_S);
    try {
      osc.onended = function () {
        try { osc.disconnect(); g.disconnect(); } catch (e) { /* ctx closed */ }
      };
    } catch (e) { /* stub node refuses onended */ }
    return true;
  } catch (e) {
    try { if (osc && typeof osc.disconnect === "function") osc.disconnect(); } catch (e2) { /* gone */ }
    try { if (g && typeof g.disconnect === "function") g.disconnect(); } catch (e3) { /* gone */ }
    return false;
  }
}

/* one planned click: ring (evidence) first, then the audible ping — never throws */
function avMetroEmitClick(t, accent) {
  try {
    avMetro.lastT = t;
    avMetroRingPush(t, accent === true);
    avMetroPing(t, accent === true);
  } catch (e) { /* a click never throws the caller */ }
}

/* ---------- context binding (lazy; never throws) ---------- */

function avMetroCtxAlive(ctx) {
  try {
    return !!ctx && typeof ctx.currentTime === "number" && isFinite(ctx.currentTime) && ctx.state !== "closed";
  } catch (e) { return false; }
}

function avMetroBindResolve(h) {
  try {
    avMetro.ensurePending = false;
    if (h && avMetroCtxAlive(h.ctx)) {
      avMetro.ctx = h.ctx;
      avMetro.handle = h;
      if (avMetro.on || avMetro.cin) avMetroPump();
    }
  } catch (e) { /* a late bind is best effort */ }
}

function avMetroBindCtx() {
  try {
    if (avMetroCtxAlive(avMetro.ctx)) return "bound";
    avMetro.ctx = null;
    avMetro.handle = null;
    if (typeof window !== "undefined" && window.__avEngine && window.__avEngine.ready === true) {
      const h = window.__avEngine.handle;
      if (h && avMetroCtxAlive(h.ctx)) { avMetro.ctx = h.ctx; avMetro.handle = h; return "bound"; }
    }
    if (typeof avTap !== "undefined" && avTap && avMetroCtxAlive(avTap.ctx)) { avMetro.ctx = avTap.ctx; return "bound"; }
    if (!avMetro.ensureTried && typeof avEngineEnsure === "function") {
      avMetro.ensureTried = true;
      let p = null;
      try { p = avEngineEnsure(); } catch (e) { p = null; }
      if (p && typeof p.then === "function") {
        avMetro.ensurePending = true;
        try { p.then(avMetroBindResolve, function () { avMetro.ensurePending = false; }); } catch (e) { avMetro.ensurePending = false; }
        return "pending";
      }
      if (p && avMetroCtxAlive(p.ctx)) { avMetro.ctx = p.ctx; avMetro.handle = p; return "bound"; }
    }
    return avMetro.ensurePending ? "pending" : "none";
  } catch (e) { return "none"; }
}

/* ---------- timers (stubbed freely in node harnesses) ---------- */

function avMetroStartTimer() {
  if (avMetro.timer != null) return true;
  try {
    if (typeof setInterval === "function") {
      avMetro.timer = setInterval(avMetroPump, AV_METRO_WAKE_MS);
      return true;
    }
  } catch (e) { avMetro.timer = null; }
  return false;
}
function avMetroStopTimer() {
  if (avMetro.timer == null) return false;
  try { if (typeof clearInterval === "function") clearInterval(avMetro.timer); } catch (e) { /* gone */ }
  avMetro.timer = null;
  return true;
}

/* ---------- transport lock (phase alignment; the increment discipline) ---------- */

function avMetroSeqLockUpdate(now, bd) {
  try {
    const playing = avMetroSeqIsPlaying();
    if (!playing) {
      if (avMetro.mode === "seq") avMetro.mode = "own";     /* keep the frozen grid          */
      if (avMetro.seqLock !== null || avMetro.seqLastStep !== null || avMetro.seqBeatDur !== 0) {
        avMetro.seqLock = null;
        avMetro.seqLastStep = null;
        avMetro.seqBeatDur = 0;
      }
      return;
    }
    if (!(avMetro.seqBeatDur > 0) || Math.abs(avMetro.seqBeatDur - bd) > bd * 1e-3) {
      /* bpm changed (the seq re-anchored its origin): the old lock no longer fits the grid */
      avMetro.seqLock = null;
      avMetro.seqLastStep = null;
      avMetro.seqBeatDur = bd;
      avMetro.gridAt = -1;                                  /* refresh the grid cache        */
    }
    const pos = avMetroSeqPosition();
    if (!pos || !isFinite(pos.t) || !(pos.step >= 0)) return;
    const step = Math.floor(pos.step);
    if (avMetro.seqLastStep === null) { avMetro.seqLastStep = step; return; }   /* need an increment to anchor */
    if (step === avMetro.seqLastStep) return;
    if (step < avMetro.seqLastStep) {                       /* transport restarted / re-anchored backwards */
      avMetro.seqLastStep = step;
      avMetro.seqLock = null;
      return;
    }
    const jump = step - avMetro.seqLastStep;
    avMetro.seqLastStep = step;
    const sd = avMetroSeqStepDur(avMetroLiveBpm(), now);
    if (!(sd > 0)) return;
    /* first sighting of the new step: the boundary happened ≤ one wake ago — solve the origin */
    const cand = pos.t - step * sd - AV_METRO_LOCK_BIAS_S;
    if (!isFinite(cand)) return;
    let adopted = false;
    if (avMetro.seqLock === null) {
      avMetro.seqLock = cand;                               /* first lock (best effort on a jump > 1) */
      adopted = true;
    } else if (jump === 1 && Math.abs(cand - avMetro.seqLock) > sd / 2) {
      avMetro.seqLock = cand;                               /* desync-scale drift: re-lock   */
      adopted = true;
    }
    if (adopted && avMetro.nextT !== null && avMetro.originT !== null) {
      /* streaming on a grid: snap the pointer onto the (re-)locked transport grid */
      avMetro.originT = avMetro.seqLock;
      avMetro.mode = "seq";
      const floorT = (typeof avMetro.lastT === "number")
        ? (avMetro.lastT + AV_METRO_RESYNC_GAP_FRAC * bd)
        : (now - 1e-9);
      avMetro.nextT = avMetroNextGridT(avMetro.originT, bd, floorT);
    }
  } catch (e) { /* the lock discipline is best effort — never breaks the pump */ }
}

/* ---------- stream continuity (start / pause / snap decisions) ---------- */

function avMetroStreamKeep(now, bd) {
  try {
    const playing = avMetroSeqIsPlaying();
    const streaming = (avMetro.nextT !== null && avMetro.originT !== null);
    if (streaming) {
      /* transport started under an own/frozen grid: pause; the lock (≤ 1 step) restarts us
         ON the grid — clicks never land between grids */
      if (playing && avMetro.mode !== "seq") {
        avMetro.nextT = null;
        avMetro.originT = null;
        avMetro.mode = "none";
      }
      return;
    }
    if (playing) {
      if (avMetro.seqLock === null) return;                 /* wait for the transport lock   */
      avMetro.originT = avMetro.seqLock;
      avMetro.mode = "seq";
    } else {
      if (avMetro.originT === null) avMetro.originT = now + AV_METRO_START_OFFSET_S;
      avMetro.mode = "own";
    }
    /* resume floor = the last planned click + ¾ beat — a pure pointer, not a wall-clock
       read, so the resume point is deterministic; a stale pointer catches up through the
       drop law (never a burst of late clicks) */
    const floorT = (typeof avMetro.lastT === "number")
      ? (avMetro.lastT + AV_METRO_RESYNC_GAP_FRAC * bd)
      : (now - 1e-9);
    avMetro.nextT = avMetroNextGridT(avMetro.originT, bd, floorT);
  } catch (e) { /* stream keeping is best effort */ }
}

/* ---------- scheduling (the lookahead window; the stall drop) ---------- */

function avMetroScheduleDue(now, bd) {
  try {
    if (!avMetro.ctx) return;
    const horizon = now + AV_METRO_LOOKAHEAD_S;
    /* count-in train first (its own origin + frozen beat; preempts the regular grid) */
    const cin = avMetro.cin;
    if (cin) {
      let guard = 0;
      while (cin.k < cin.total && guard++ < AV_METRO_PLAN_GUARD) {
        const t = cin.origin + cin.k * cin.bd;
        if (!(t < horizon)) break;
        if (t < now - AV_METRO_LATE_DROP_S) {               /* stall: never fire a stale cue */
          avMetro.dropped++;
          cin.k++;
          continue;
        }
        avMetroEmitClick(t, cin.accentOn && (cin.k % cin.bpb) === 0);
        cin.k++;
      }
    }
    /* regular train */
    if (!avMetro.on || cin) return;
    if (avMetro.nextT === null || avMetro.originT === null) return;
    if (avMetroSeqIsPlaying() && avMetro.seqLock === null) return;   /* aligning: hold       */
    if (!(bd > 0) || !isFinite(bd)) return;
    let guard = 0;
    while (avMetro.nextT < horizon && guard++ < AV_METRO_PLAN_GUARD) {
      const t = avMetro.nextT;
      const k = Math.round((t - avMetro.originT) / bd);
      if (t < now - AV_METRO_LATE_DROP_S) {
        avMetro.dropped++;
        avMetro.nextT = avMetro.originT + (k + 1) * bd;
        continue;
      }
      avMetroEmitClick(t, avMetro.accent && (k % avMetro.beatsPerBar) === 0);
      avMetro.nextT = avMetro.originT + (k + 1) * bd;
    }
  } catch (e) { /* scheduling is best effort; the pump survives */ }
}

/* ---------- count-in completion / refusal ---------- */

function avMetroCinFinish(result) {
  const cin = avMetro.cin;
  if (!cin) return false;
  avMetro.cin = null;
  try { if (typeof cin.finish === "function") cin.finish(result); } catch (e) { /* resolve never throws */ }
  try {
    if (avMetro.on && avMetroCtxAlive(avMetro.ctx)) {
      const now = avMetro.ctx.currentTime;
      avMetroStreamKeep(now, avMetroBeatDur(avMetroLiveBpm()));
    }
  } catch (e) { /* resume is best effort */ }
  if (!avMetro.on) avMetroStopTimer();
  avMetroPublish();
  return true;
}

/* ---------- the pump (lock → stream → schedule → count-in resolve) ---------- */

function avMetroPump() {
  try {
    if (!avMetro.on && !avMetro.cin) return;                /* idle: the timer should be off */
    if (avMetro.ctx && !avMetroCtxAlive(avMetro.ctx)) {
      /* the clock died: refuse a waiting count-in honestly before looking for a new ctx */
      avMetro.ctx = null;
      avMetro.handle = null;
      if (avMetro.cin) {
        const cin = avMetro.cin;
        avMetroCinFinish({ ok: false, bars: cin.bars, seconds: null, error: "audio context lost" });
      }
    }
    if (!avMetro.ctx) {
      if (avMetroBindCtx() !== "bound") {
        if (avMetro.cin) {
          const cin = avMetro.cin;
          avMetroCinFinish({ ok: false, bars: cin.bars, seconds: null, error: "no audio context" });
        }
        avMetroPublish();
        return;
      }
    }
    const ctx = avMetro.ctx;
    const now = (ctx && typeof ctx.currentTime === "number" && isFinite(ctx.currentTime)) ? ctx.currentTime : null;
    if (now === null) return;

    const bd = avMetroBeatDur(avMetroLiveBpm());

    if (avMetro.on) avMetroSeqLockUpdate(now, bd);           /* (1) transport grid lock      */
    if (avMetro.on && !avMetro.cin) avMetroStreamKeep(now, bd);   /* (2) stream continuity   */
    avMetroScheduleDue(now, bd);                             /* (3) lookahead scheduling     */

    if (avMetro.cin) {                                       /* (4) count-in completion      */
      const cin = avMetro.cin;
      if (now >= cin.endT - 1e-9) avMetroCinFinish({ ok: true, bars: cin.bars, seconds: cin.seconds });
    }
    avMetroPublish();
  } catch (e) { /* a pump never throws */ }
}

/* ---------- state / diagnostics ---------- */

function avMetroReasonNow() {
  try {
    if (!avMetro.on && !avMetro.cin) return "";
    if (!avMetroCtxAlive(avMetro.ctx)) return "no ctx";
    if (avMetro.ctx && avMetro.ctx.state === "suspended") return "ctx suspended";
    if (avMetro.on && !avMetro.cin && avMetroSeqIsPlaying() && avMetro.seqLock === null) return "aligning to transport";
    return "";
  } catch (e) { return ""; }
}

function avMetroState() {
  try {
    const cin = avMetro.cin;
    let originT = null, nextClickAt = null;
    if (cin) {
      originT = cin.origin;
      nextClickAt = (cin.k < cin.total) ? (cin.origin + cin.k * cin.bd) : avMetro.nextT;
    } else {
      originT = avMetro.originT;
      nextClickAt = avMetro.nextT;
    }
    return {
      on: avMetro.on === true,
      level: avMetro.level,
      bpm: avMetroLiveBpm(),
      beatsPerBar: avMetro.beatsPerBar,
      originT: (typeof originT === "number" && isFinite(originT)) ? originT : null,
      nextClickAt: (typeof nextClickAt === "number" && isFinite(nextClickAt)) ? nextClickAt : null,
      clicks: avMetroRingDump(),
      accent: avMetro.accent === true,
      mode: cin ? "countin" : (avMetro.mode || "none"),
      countIn: cin ? { active: true, bars: cin.bars, beatsPerBar: cin.bpb, endT: cin.endT, done: cin.k, total: cin.total } : null,
      planned: avMetro.clicksN,
      dropped: avMetro.dropped,
      reason: avMetroReasonNow(),
      ctxBound: avMetroCtxAlive(avMetro.ctx),
      version: AV_METRO_VERSION,
    };
  } catch (e) {
    return {
      on: false, level: AV_METRO_LEVEL_DEF, bpm: AV_METRO_BPM_DEF, beatsPerBar: AV_METRO_BEATS_DEF,
      originT: null, nextClickAt: null, clicks: [],
    };
  }
}

function avMetroPublish() {
  try {
    if (avMetroDebug) {
      avMetroDebug.planned = avMetro.clicksN;
      avMetroDebug.on = avMetro.on;
    }
  } catch (e) { /* debug publishing is best effort */ }
}

/* ============================================================================================
   PUBLIC SURFACE (the pinned §2.2 API)
   ============================================================================================ */

function avMetroInit() {
  if (avMetro.inited) return true;
  avMetro.inited = true;
  try { avMetroBindCtx(); } catch (e) { /* warm the bind; absence is fine */ }
  avMetroPublish();
  return true;
}

function avMetroSet(patch) {
  try {
    const p = (patch && typeof patch === "object") ? patch : null;
    if (p) {
      if ("level" in p) {
        const n = Number(p.level);
        if (p.level != null && p.level !== "" && isFinite(n)) {
          avMetro.level = n < AV_METRO_LEVEL_MIN ? AV_METRO_LEVEL_MIN : (n > AV_METRO_LEVEL_MAX ? AV_METRO_LEVEL_MAX : n);
        }
      }
      if ("beatsPerBar" in p) {
        const n = Number(p.beatsPerBar);
        if (p.beatsPerBar != null && p.beatsPerBar !== "" && isFinite(n)) {
          const r = Math.round(n);
          avMetro.beatsPerBar = r < AV_METRO_BEATS_MIN ? AV_METRO_BEATS_MIN : (r > AV_METRO_BEATS_MAX ? AV_METRO_BEATS_MAX : r);
        }
      }
      if ("accent" in p) {
        const b = avMetroBoolish(p.accent);
        if (b !== null) avMetro.accent = b;
      }
      if ("on" in p) {
        const b = avMetroBoolish(p.on);
        if (b === true && !avMetro.on) {
          /* OFF→ON: a fresh train — the old grid and lock are dropped, the ring starts clean */
          avMetro.on = true;
          avMetro.nextT = null; avMetro.originT = null; avMetro.mode = "none"; avMetro.lastT = null;
          avMetro.seqLock = null; avMetro.seqLastStep = null; avMetro.seqBeatDur = 0;
          avMetroRingClear();
          avMetroKickResume();
          avMetroStartTimer();
          avMetroPump();
        } else if (b === false && avMetro.on) {
          avMetro.on = false;
          avMetro.nextT = null; avMetro.originT = null; avMetro.mode = "none"; avMetro.lastT = null;
          avMetro.seqLock = null; avMetro.seqLastStep = null; avMetro.seqBeatDur = 0;
          avMetroRingClear();                              /* OFF ⇒ nothing planned ("none") */
          if (!avMetro.cin) avMetroStopTimer();            /* a live count-in keeps ticking  */
        }
      }
    }
    avMetroPublish();
    return avMetroState();
  } catch (e) {
    try { return avMetroState(); } catch (e2) {
      return {
        on: false, level: AV_METRO_LEVEL_DEF, bpm: AV_METRO_BPM_DEF, beatsPerBar: AV_METRO_BEATS_DEF,
        originT: null, nextClickAt: null, clicks: [],
      };
    }
  }
}

function avMetroCountIn(bars) {
  return new Promise(function (resolve) {
    let settled = false;
    const finish = function (r) {
      if (settled) return;
      settled = true;
      try { resolve(r); } catch (e) { /* resolve never throws */ }
    };
    try {
      const b = avMetroClampInt(bars, AV_METRO_BARS_DEF, AV_METRO_BARS_MIN, AV_METRO_BARS_MAX);
      if (!avMetroCtxAlive(avMetro.ctx)) avMetroBindCtx();
      avMetroKickResume();
      const ctx = avMetro.ctx;
      if (!avMetroCtxAlive(ctx)) {                         /* honest refusal — never hangs  */
        finish({ ok: false, bars: b, seconds: null, error: "no audio context" });
        return;
      }
      if (avMetro.cin) {
        avMetroCinFinish({ ok: false, bars: avMetro.cin.bars, seconds: null, error: "superseded" });
      }
      const now = ctx.currentTime;
      const bpb = avMetro.beatsPerBar;
      const bd = avMetroBeatDur(avMetroLiveBpm());
      const origin = now + AV_METRO_START_OFFSET_S;
      const total = b * bpb;
      const seconds = total * bd;
      avMetro.cin = {
        bars: b, bpb: bpb, bd: bd, accentOn: avMetro.accent === true,
        origin: origin, endT: origin + seconds, total: total, seconds: seconds,
        k: 0, finish: finish,
      };
      avMetro.nextT = null;                                /* the count-in preempts the train */
      avMetroStartTimer();
      avMetroPump();
    } catch (e) {
      finish({ ok: false, bars: AV_METRO_BARS_DEF, seconds: null, error: "count-in failed" });
    }
  });
}

function avMetroClasses() { return AV_METRO_CLASSES.slice(); }

/* ---------- debug handle (rigs read this; no live nodes leak) ---------- */

if (typeof window !== "undefined") {
  try {
    avMetroDebug = {
      version: AV_METRO_VERSION,
      init: avMetroInit,
      set: avMetroSet,
      state: avMetroState,
      countIn: avMetroCountIn,
      classes: avMetroClasses,
      pump: avMetroPump,
    };
    window.__avMetro = avMetroDebug;
  } catch (e) { avMetroDebug = null; }
}
