/* av_seq_capture.js — Anvil P4 §3.7 (child G): the step + live recording core.

   WHAT THIS FILE IS
   - avSeqCaptureInit()            installs (idempotently) the two additive taps; bool. The parent
                                   calls it guarded from the app_core boot block (§6).
   - avSeqCaptureArm(mode)         "step" | "live" | "off" (false / null / undefined = off); bool,
                                   false on garbage without changing state.
   - avSeqCaptureSetQuantize(pct)  0..100 (rounded, clamped); false on non-numbers.
   - avSeqCaptureSetTrack(i)       capture track selector 0..63 (clamped). V1 addition — the wave
                                   pins no selector; default is 0.
   - avSeqCaptureHold(on)          recall-suppression seam (see SEAMS); returns the flag.
   - avSeqCaptureState()           fresh observable each call: mode · quantize · track · hold ·
                                   playhead · hook health · counters · last captures.
   - avSeqCaptureQuantize(t,q,bpm,grid,swing)  the pure quantize kernel (no side effects; the
                                   harness verifies it directly).
   - avSeqCaptureEnsureHooks()     wraps only (parallel to avModEnsureHooks), bool.

   THE TWO TAPS (both additive, both idempotent, both marked)
   1. avApplyParam funnel (marker __avSeqCapWrap) — while armed, every numeric commit writes a
      p-lock { path, interp:"step", steps:{ "<playhead step>": value } } into the core snapshot
      via avSeqSnap/avSeqLoad ONLY (guarded typeof; never internals). Values follow the shipped
      container law (core avSeqPlockNorm + E's avPlockNum): finite numbers store as-is, booleans
      as 1|0, numeric strings coerce to numbers; anything else is refused with a miss (a stored
      non-numeric string would be silently dropped by the core sanitise). Path ≤64 chars, lane
      index mod 64, ≤64 lanes — all mirror the core caps (AV_SEQ_PATH_CAP / AV_SEQ_STEPS /
      AV_SEQ_PLOCK_CAP). Same-value commits are elided; meta {noCapture:true | plock:true |
      src:"plock" | capture:true} and an active hold skip. The wrapped call is forwarded
      untouched: same args, receiver, return and exceptions. Capture runs FIRST and can never
      break the funnel.
   2. the note bus avNoteDown/avNoteUp (marker __avSeqCapNoteWrap) — while armed, a FRESH down
      records a step into the capture track:
        step mode — the step under the playhead (avSeqPosition) is written, micro = 0;
        live mode — the played time (avSeqSchedNow, fallback avSeqPosition.t) is quantized to the
        nearest grid step at avSeqCaptureSetQuantize strength; the remainder lands in the step's
        `micro` field (±12 ticks, tick = stepDur/24, applied after swing).
      The original call is forward FIRST and ALWAYS untouched (arbitration law: no re-expansion,
      no parallel note delivery — the note bus stays the ONE note path; capture never emits
      notes). avNoteUp is wrapped for the marker/observability contract; v1 records on down
      (gate-from-duration is a deliberate non-feature of v1).

   QUANTIZE LAW (pinned here; live mode + kernel)
     stepDur = 60/bpm/4 ("16") or 60/bpm/3 ("8t")                  [wave §2]
     g(k)    = k*stepDur + (k odd ? stepDur*(swing−50)/100 : 0)    [swing, wave §2]
     k*      = argmin |g(k) − t| over k0±2 (k0 = round(t/stepDur)); ties → the EARLIER step.
     residual = t − g(k*);  r = residual × (1 − q/100)             [q = strength %, 0..100]
     micro   = clamp(round(r / (stepDur/24)), −12, 12)             [positive micro = LATER]
     q=100 ⇒ exactly on the grid; q=0 ⇒ played timing kept as far as the ±half-step micro
     window allows inside the track loop (idx = k* mod track.len).

   LAWS: "use strict"; one namespace (avSeqCapture* / AV_SEQ_CAPTURE_*); never throws (refuse
   with false); no DOM at load (nothing DOM is needed at all — every reach guarded); plain-node
   safe; one writer per file. Absent core ⇒ capture refuses (counts a miss); forwarding is
   unaffected.

   SEAMS (for the parent + siblings — repeated in the P4 report)
   - E/B recall commits ride the same funnel: while armed, applies made by avPlockApplyAt would
     be captured. Until E marks internal commits (meta.noCapture / meta.src="plock") or brackets
     them with avSeqCaptureHold(true/false), the hold is the suppression handle.
   - micro sign: positive = later than the (swung) grid; the planner (B) must apply
     t = swingTime + micro × (stepDur/24). Mirrored in avSeqCaptureQuantize's residual law.
   - track speed/polymeter: v1 quantizes against the global grid and maps k* → k* mod track.len;
     per-track speed factoring is flagged future work.
*/

"use strict";

const AV_SEQ_CAPTURE_VERSION = "p4.0";
const AV_SEQ_CAPTURE_TICK_DIV = 24;           /* micro ticks per step (wave §2) */
const AV_SEQ_CAPTURE_MICRO_MAX = 12;          /* ±12 ticks (wave §2) */
const AV_SEQ_CAPTURE_BPM_MIN = 20;
const AV_SEQ_CAPTURE_BPM_MAX = 300;
const AV_SEQ_CAPTURE_SWING_MIN = 50;
const AV_SEQ_CAPTURE_SWING_MAX = 80;
const AV_SEQ_CAPTURE_DEF_BPM = 120;
const AV_SEQ_CAPTURE_DEF_SWING = 66;
const AV_SEQ_CAPTURE_DEF_VEL = 0.9;
const AV_SEQ_CAPTURE_MIN_VEL = 0.05;
const AV_SEQ_CAPTURE_PATH_MAX = 64;          /* = core AV_SEQ_PATH_CAP */
const AV_SEQ_CAPTURE_STEP_CAP = 64;          /* = core AV_SEQ_STEPS (lane index law) */
const AV_SEQ_CAPTURE_LANE_CAP = 64;          /* = core AV_SEQ_PLOCK_CAP */

/* the step fields the capture writes (wave §3.1) — a fresh step is always minted complete */
const AV_SEQ_CAPTURE_STEP_DEFAULTS = Object.freeze({
  on: 0, note: "c4", vel: 0.8, gate: 0.95, slide: 0, accent: 0, oct: 0,
  prob: 100, cond: "", ratchet: 1, micro: 0,
});

/* ---------- module state ---------- */

let avSeqCaptureMode = "off";                 /* "off" | "step" | "live" */
let avSeqCaptureQuant = 100;                  /* 0..100 strength */
let avSeqCaptureTrackSel = 0;                 /* capture track index (clamped at write time) */
let avSeqCaptureLastStep = 0;                 /* last known playhead / written step */
let avSeqCaptureHoldFlag = false;             /* suppression flag (recall seam) */
let avSeqCaptureHooks = null;                 /* { funnel, notes, event } */
let avSeqCaptureStat = null;                  /* counters */

/* ---------- tiny laws ---------- */

function avSeqCaptureClampNum(v, lo, hi, dflt) {
  const n = Number(v);
  if (!isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

/* guarded core access — window first (page), then globalThis (plain node harness/vm) */
function avSeqCaptureCoreRef(name) {
  try {
    if (typeof window !== "undefined" && window && typeof window[name] === "function") return window[name];
  } catch (e) { /* no window */ }
  try {
    if (typeof globalThis !== "undefined" && globalThis && typeof globalThis[name] === "function") return globalThis[name];
  } catch (e) { /* no globalThis */ }
  return null;
}

function avSeqCaptureCoreSnap() {
  const f = avSeqCaptureCoreRef("avSeqSnap");
  if (!f) return null;
  try {
    const s = f();
    return (s && typeof s === "object") ? s : null;
  } catch (e) { return null; }
}

function avSeqCaptureCoreLoad(snap) {
  const f = avSeqCaptureCoreRef("avSeqLoad");
  if (!f) return false;
  try { return f(snap) !== false; } catch (e) { return false; }
}

/* ---------- pattern facts (from the core snapshot; guarded fallbacks) ---------- */

function avSeqCapturePatternBpm(snap) {
  const b = avSeqCaptureClampNum(snap && snap.bpm, AV_SEQ_CAPTURE_BPM_MIN, AV_SEQ_CAPTURE_BPM_MAX, NaN);
  if (isFinite(b)) return b;
  try {
    if (typeof avState !== "undefined" && avState) {
      const a = avSeqCaptureClampNum(avState.bpm, AV_SEQ_CAPTURE_BPM_MIN, AV_SEQ_CAPTURE_BPM_MAX, NaN);
      if (isFinite(a)) return a;
    }
  } catch (e) { /* no avState binding */ }
  return AV_SEQ_CAPTURE_DEF_BPM;
}

function avSeqCapturePatternGrid(snap) {
  return (snap && snap.grid === "8t") ? "8t" : "16";   /* unknown ⇒ 16ths (pinned fallback) */
}

function avSeqCapturePatternSwing(snap) {
  return avSeqCaptureClampNum(snap && snap.swing, AV_SEQ_CAPTURE_SWING_MIN, AV_SEQ_CAPTURE_SWING_MAX, AV_SEQ_CAPTURE_DEF_SWING);
}

/* ---------- the quantize kernel (pure; wave §2 time model) ---------- */

function avSeqCaptureStepDur(bpm, grid) {
  const b = avSeqCaptureClampNum(bpm, AV_SEQ_CAPTURE_BPM_MIN, AV_SEQ_CAPTURE_BPM_MAX, AV_SEQ_CAPTURE_DEF_BPM);
  return (grid === "8t") ? (60 / b / 3) : (60 / b / 4);
}

function avSeqCaptureGridTime(k, stepDur, swing) {
  const s = avSeqCaptureClampNum(swing, AV_SEQ_CAPTURE_SWING_MIN, AV_SEQ_CAPTURE_SWING_MAX, AV_SEQ_CAPTURE_DEF_SWING);
  const shift = stepDur * (s - 50) / 100;
  return k * stepDur + ((k % 2 !== 0) ? shift : 0);
}

/* tSec × strength → {step, micro, gridT, residual, snappedT, stepDur} | null.
   step is the ABSOLUTE grid step (≥0; not loop-mapped — callers map into the track loop). */
function avSeqCaptureQuantize(tSec, q, bpm, grid, swing) {
  const t = Number(tSec);
  if (!isFinite(t)) return null;
  const g = (grid === "8t") ? "8t" : "16";
  const qq = avSeqCaptureClampNum(q, 0, 100, 100);
  const stepDur = avSeqCaptureStepDur(bpm, g);
  const k0 = Math.round(t / stepDur);
  let best = k0, bestD = Infinity;
  for (let k = k0 - 2; k <= k0 + 2; k++) {
    const d = Math.abs(avSeqCaptureGridTime(k, stepDur, swing) - t);
    if (d < bestD) { bestD = d; best = k; }        /* strict < ⇒ ties resolve to the earlier step */
  }
  if (best < 0) best = 0;
  const gridT = avSeqCaptureGridTime(best, stepDur, swing);
  const residual = t - gridT;
  const tick = stepDur / AV_SEQ_CAPTURE_TICK_DIV;
  let micro = Math.round((residual * (1 - qq / 100)) / tick);
  if (micro > AV_SEQ_CAPTURE_MICRO_MAX) micro = AV_SEQ_CAPTURE_MICRO_MAX;
  else if (micro < -AV_SEQ_CAPTURE_MICRO_MAX) micro = -AV_SEQ_CAPTURE_MICRO_MAX;
  return {
    step: best, micro: micro, gridT: gridT, residual: residual,
    snappedT: t - residual * (qq / 100), stepDur: stepDur,
  };
}

/* ---------- transport reads (all guarded) ---------- */

function avSeqCapturePlayheadStep() {
  try {
    const f = avSeqCaptureCoreRef("avSeqPosition");
    if (f) {
      const p = f();
      if (p && typeof p === "object") {
        const n = Number(p.step);
        if (isFinite(n) && n >= 0) { avSeqCaptureLastStep = Math.floor(n); return avSeqCaptureLastStep; }
      }
    }
  } catch (e) { /* transport unreachable — fall through to the last known step */ }
  return avSeqCaptureLastStep;
}

function avSeqCaptureClockNow() {
  try {
    const f = avSeqCaptureCoreRef("avSeqSchedNow");
    if (f) { const t = Number(f()); if (isFinite(t)) return t; }
  } catch (e) { /* fall through */ }
  try {
    const f2 = avSeqCaptureCoreRef("avSeqPosition");
    if (f2) {
      const p = f2();
      if (p && typeof p === "object") { const t2 = Number(p.t); if (isFinite(t2)) return t2; }
    }
  } catch (e) { /* fall through */ }
  return null;
}

function avSeqCaptureIsFresh(name) {
  if (typeof name !== "string" || !name) return false;
  try {
    const f = avSeqCaptureCoreRef("avNoteState");
    if (f) {
      const s = f();
      if (s && Array.isArray(s.held)) return s.held.indexOf(name) < 0;
    }
  } catch (e) { /* no oracle — accept */ }
  return true;
}

/* ---------- writes (avSeqSnap → mutate → avSeqLoad ONLY; guarded) ---------- */

function avSeqCaptureLoopIndex(absIdx, tr) {
  const n = Number(tr && tr.len);
  const have = (tr && Array.isArray(tr.steps)) ? tr.steps.length : 0;
  const len = (isFinite(n) && n >= 1) ? Math.floor(n) : have;
  if (len < 1) return -1;
  let idx = Math.floor(absIdx) % len;
  if (idx < 0) idx += len;
  return idx;
}

function avSeqCaptureLockIndex(idx) {
  const n = Math.floor(Number(idx));
  if (!isFinite(n)) return -1;
  return ((n % AV_SEQ_CAPTURE_STEP_CAP) + AV_SEQ_CAPTURE_STEP_CAP) % AV_SEQ_CAPTURE_STEP_CAP;
}

function avSeqCaptureFullStep(cur) {
  const st = {};
  for (const k in AV_SEQ_CAPTURE_STEP_DEFAULTS) st[k] = AV_SEQ_CAPTURE_STEP_DEFAULTS[k];
  if (cur && typeof cur === "object") {
    for (const k in cur) { if (Object.prototype.hasOwnProperty.call(cur, k)) st[k] = cur[k]; }
  }
  return st;
}

function avSeqCaptureWriteNote(snap, absIdx, name, vel, micro) {
  const tracks = snap.tracks;
  if (!tracks.length) return false;
  const ti = Math.min(avSeqCaptureTrackSel, tracks.length - 1);
  const tr = tracks[ti];
  if (!tr || !Array.isArray(tr.steps) || !tr.steps.length) return false;
  const idx = avSeqCaptureLoopIndex(absIdx, tr);
  if (idx < 0) return false;
  const st = avSeqCaptureFullStep(tr.steps[idx]);
  st.on = 1;
  st.note = name;
  st.vel = vel;
  st.micro = micro;
  tr.steps[idx] = st;
  if (!avSeqCaptureCoreLoad(snap)) return false;
  avSeqCaptureLastStep = idx;
  return true;
}

/* one lane per path (interp/blank repaired; existing lanes are reused, never duplicated) */
function avSeqCaptureLockLane(snap, path) {
  if (!Array.isArray(snap.plocks)) snap.plocks = [];
  for (let i = 0; i < snap.plocks.length; i++) {
    const e = snap.plocks[i];
    if (e && typeof e === "object" && e.path === path) {
      if (!e.steps || typeof e.steps !== "object") e.steps = {};
      if (e.interp !== "step" && e.interp !== "lin") e.interp = "step";
      return e;
    }
  }
  if (snap.plocks.length >= AV_SEQ_CAPTURE_LANE_CAP) return null;   /* container full — refuse */
  const lane = { path: path, interp: "step", steps: {} };
  snap.plocks.push(lane);
  return lane;
}

/* ---------- capture events (invoked by the taps; also callable directly) ---------- */

function avSeqCaptureStatEnsure() {
  if (!avSeqCaptureStat) {
    avSeqCaptureStat = { notes: 0, params: 0, writes: 0, miss: 0, elided: 0, lastNote: null, lastUp: null, lastParam: null };
  }
  return avSeqCaptureStat;
}

function avSeqCaptureNoteHit(name, vel) {
  const st = avSeqCaptureStatEnsure();
  if (avSeqCaptureMode === "off") return false;
  if (typeof name !== "string" || !name) return false;
  try {
    const parse = avSeqCaptureCoreRef("avNoteParse");
    if (parse && parse(name) == null) { st.miss++; return false; }
  } catch (e) { /* parser gone — accept; the bus is the authority on names */ }
  const snap = avSeqCaptureCoreSnap();
  if (!snap || typeof snap !== "object" || !Array.isArray(snap.tracks)) { st.miss++; return false; }
  const v = avSeqCaptureClampNum(vel, AV_SEQ_CAPTURE_MIN_VEL, 1, AV_SEQ_CAPTURE_DEF_VEL);
  let idx;
  let micro = 0;
  if (avSeqCaptureMode === "step") {
    idx = avSeqCapturePlayheadStep();
  } else {
    const t = avSeqCaptureClockNow();
    if (t == null) { st.miss++; return false; }
    const qz = avSeqCaptureQuantize(t, avSeqCaptureQuant, avSeqCapturePatternBpm(snap), avSeqCapturePatternGrid(snap), avSeqCapturePatternSwing(snap));
    if (!qz) { st.miss++; return false; }
    idx = qz.step;
    micro = qz.micro;
  }
  if (!avSeqCaptureWriteNote(snap, idx, name, v, micro)) { st.miss++; return false; }
  st.notes++;
  st.writes++;
  st.lastNote = { note: name, vel: v, step: avSeqCaptureLastStep, mode: avSeqCaptureMode, micro: micro };
  return true;
}

function avSeqCaptureUpHit(name) {
  if (avSeqCaptureMode === "off") return false;
  if (typeof name !== "string" || !name) return false;
  const st = avSeqCaptureStatEnsure();
  st.lastUp = { note: name };
  return true;
}

function avSeqCaptureParamHit(path, value, meta) {
  if (avSeqCaptureMode === "off") return false;
  if (avSeqCaptureHoldFlag) return false;
  if (typeof path !== "string" || !path.length || path.length > AV_SEQ_CAPTURE_PATH_MAX) return false;
  if (meta && typeof meta === "object") {
    if (meta.noCapture === true || meta.capture === true || meta.plock === true || meta.src === "plock") return false;
  }
  const st = avSeqCaptureStatEnsure();
  let v;
  if (typeof value === "number") {
    if (!isFinite(value)) { st.miss++; return false; }
    v = (value === 0) ? 0 : value;    /* normalise −0 → 0 so the echo elision compares cleanly */
  } else if (typeof value === "boolean") {
    v = value ? 1 : 0;                /* the core container is numeric (avSeqPlockNorm via Number()) */
  } else if (typeof value === "string") {
    if (!value.trim()) { st.miss++; return false; }   /* ""/"  " would coerce to 0 — refuse */
    v = Number(value);
    if (!isFinite(v)) { st.miss++; return false; }    /* non-numeric strings are not lockable (v1) */
  } else {
    st.miss++;
    return false;
  }
  const snap = avSeqCaptureCoreSnap();
  if (!snap || typeof snap !== "object" || !Array.isArray(snap.tracks)) { st.miss++; return false; }
  const idx = avSeqCaptureLockIndex(avSeqCapturePlayheadStep());
  if (idx < 0) { st.miss++; return false; }
  const lane = avSeqCaptureLockLane(snap, path);
  if (!lane) { st.miss++; return false; }
  const key = String(idx);
  if (lane.steps[key] === v) { st.elided++; return false; }   /* same value already locked here */
  lane.steps[key] = v;
  if (!avSeqCaptureCoreLoad(snap)) { st.miss++; return false; }
  st.params++;
  st.writes++;
  st.lastParam = { path: path, step: idx, value: v };
  return true;
}

/* ---------- the taps ---------- */

function avSeqCaptureHooksEnsure() {
  if (!avSeqCaptureHooks) avSeqCaptureHooks = { funnel: false, notes: false, event: false };
  return avSeqCaptureHooks;
}

function avSeqCaptureEnsureHooks() {
  const h = avSeqCaptureHooksEnsure();
  if (h.funnel && h.notes) return true;

  /* belt 1 — the funnel: one additive wrap, idempotent by flag AND marker */
  if (!h.funnel) {
    try {
      if (typeof avApplyParam === "function" && avApplyParam.__avSeqCapWrap !== true) {
        const orig = avApplyParam;
        const wrapped = function () {
          try { avSeqCaptureParamHit(arguments[0], arguments[1], arguments[2]); } catch (e) { /* capture never breaks the funnel */ }
          return orig.apply(this, arguments);
        };
        wrapped.__avSeqCapWrap = true;
        avApplyParam = wrapped;
      }
      h.funnel = (typeof avApplyParam === "function" && avApplyParam.__avSeqCapWrap === true);
    } catch (e) { h.funnel = false; }
  }

  /* belt 2 — the note bus: both directions wrapped, forward-first, marker-checked */
  if (!h.notes) {
    try {
      if (typeof avNoteDown === "function" && avNoteDown.__avSeqCapNoteWrap !== true) {
        const origDown = avNoteDown;
        const wrappedDown = function () {
          let fresh = false;
          try { fresh = avSeqCaptureIsFresh(arguments[0]); } catch (e) { fresh = false; }
          const ret = origDown.apply(this, arguments);   /* forward FIRST, untouched */
          try { if (fresh) avSeqCaptureNoteHit(arguments[0], arguments[1]); } catch (e2) { /* capture never breaks the bus */ }
          return ret;
        };
        wrappedDown.__avSeqCapNoteWrap = true;
        avNoteDown = wrappedDown;
      }
      if (typeof avNoteUp === "function" && avNoteUp.__avSeqCapNoteWrap !== true) {
        const origUp = avNoteUp;
        const wrappedUp = function () {
          const ret = origUp.apply(this, arguments);     /* forward FIRST, untouched */
          try { avSeqCaptureUpHit(arguments[0]); } catch (e) { /* capture never breaks the bus */ }
          return ret;
        };
        wrappedUp.__avSeqCapNoteWrap = true;
        avNoteUp = wrappedUp;
      }
      h.notes = (typeof avNoteDown === "function" && avNoteDown.__avSeqCapNoteWrap === true);
    } catch (e) { h.notes = false; }
  }

  /* belt 3 — the 'av-param' event (the no-app-core funnel fallback avKnobCommit dispatches) */
  if (!h.event) {
    try {
      if (typeof window !== "undefined" && window && typeof window.addEventListener === "function") {
        window.addEventListener("av-param", avSeqCaptureParamEvent);
        h.event = true;
      }
    } catch (e) { h.event = false; }
  }

  return (h.funnel || h.notes || h.event);
}

function avSeqCaptureParamEvent(ev) {
  const d = ev && ev.detail;
  if (!d || typeof d !== "object") return;
  try {
    const meta = (d.meta && typeof d.meta === "object") ? d.meta : { src: "event" };
    avSeqCaptureParamHit(d.path, d.value, meta);
  } catch (e) { /* never */ }
}

/* ---------- public surface ---------- */

function avSeqCaptureInit() {
  try { return avSeqCaptureEnsureHooks(); } catch (e) { return false; }
}

function avSeqCaptureArm(mode) {
  let m;
  if (mode === "step" || mode === "live" || mode === "off") m = mode;
  else if (mode === false || mode == null) m = "off";
  else return false;
  try { avSeqCaptureEnsureHooks(); } catch (e) { /* arming still stands */ }
  avSeqCaptureMode = m;
  return true;
}

function avSeqCaptureSetQuantize(pct) {
  const n = Number(pct);
  if (!isFinite(n)) return false;
  avSeqCaptureQuant = Math.round(Math.max(0, Math.min(100, n)));
  return true;
}

function avSeqCaptureSetTrack(i) {
  const n = Number(i);
  if (!isFinite(n)) return false;
  avSeqCaptureTrackSel = Math.max(0, Math.min(63, Math.floor(n)));
  return true;
}

function avSeqCaptureHold(on) {
  if (typeof on === "boolean") avSeqCaptureHoldFlag = on;
  return avSeqCaptureHoldFlag;
}

function avSeqCaptureState() {
  const st = avSeqCaptureStatEnsure();
  const h = avSeqCaptureHooksEnsure();
  return {
    v: AV_SEQ_CAPTURE_VERSION,
    armed: avSeqCaptureMode,
    quantize: avSeqCaptureQuant,
    track: avSeqCaptureTrackSel,
    hold: avSeqCaptureHoldFlag,
    playhead: avSeqCaptureLastStep,
    hooks: { funnel: h.funnel, notes: h.notes, event: h.event },
    stat: {
      notes: st.notes,
      params: st.params,
      writes: st.writes,
      miss: st.miss,
      elided: st.elided,
      lastNote: st.lastNote ? { note: st.lastNote.note, vel: st.lastNote.vel, step: st.lastNote.step, mode: st.lastNote.mode, micro: st.lastNote.micro } : null,
      lastUp: st.lastUp ? { note: st.lastUp.note } : null,
      lastParam: st.lastParam ? { path: st.lastParam.path, step: st.lastParam.step, value: st.lastParam.value } : null,
    },
  };
}

/* page observable (guarded — plain node never reaches this) */
if (typeof window !== "undefined") {
  try { window.__avSeqCapture = avSeqCaptureState; } catch (e) { /* frozen window — state() still works */ }
}
