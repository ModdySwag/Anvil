/* Anvil — P-LOCK lanes (P4 §3.5, child E): the per-step parameter-lock model, the apply core the
   scheduler drives at every step boundary, the base-value capture/restore law (with the additive
   funnel tap for live re-capture), the ~64 Hz "lin" interpolation and the lane-row painting UI
   hooks for the sequencer inspector.

   Lane model (PIN, the container lives inside the core pattern snapshot per §3.1/§4):
     lane = { path: "filter.cutoff", interp: "step" | "lin", steps: { "<stepIdx>": value } }

   Apply law (PIN — verify/_p4_wave.md §3.5):
     - avPlockApplyAt(step, tSec?) is called by the scheduler (B) at each step boundary, BEFORE note
       events. Locked path at step s -> avApplyParam(path, value) (the ONE commit funnel) — never a
       direct engine call.
     - A path locked at step k with NO lock at k+1 -> restore the base value captured at transport
       start. The base is re-captured when the user moves a control while running: ONE additive,
       idempotent wrap of avApplyParam (marker __avPlockWrap, mirroring av_mod's __avModWrap pattern)
       taps every non-plock commit and refreshes the base for that lane's path; the original call
       always passes through untouched.
     - interp "step": immediate jump at the locked boundary. interp "lin": values interpolate
       between consecutive locked steps at ~64 Hz control rate while running; boundary calls apply
       the exact grid-point value, the ticker owns the in-between; past the last lock (no next step
       to interpolate to) the pinned restore law applies.
     - Transport: avPlockTransportStart(tSec?) captures the base of every lane path;
       avPlockTransportStop() restores everything the lanes still hold. avPlockApplyAt() also
       auto-starts on its first call and re-starts when it detects an idle gap (a fresh play that
       never announced a stop), so B only needs the one pinned hook.

   Conventions (P3 module pins, mirrored from av_mod.js): plain page module, NO DOM at top level,
   every global reach (window/document/avParams/avState/avApplyParam) guarded inside functions, ONE
   namespace (avPlock* / AV_PLOCK_*), version "p4.0", never throws (refuse with false). Caps align
   with the core carrier (§3.1): 64 lanes · 64-char paths · step indices 0..63. Every internal
   commit rides the funnel with meta {from:"plock", noCapture:true, plock:true, src:"plock"} so the
   capture tap (G) can skip plock-driven writes (F's undo tap ignores meta by design).

   Public surface (classic-script globals, ONE namespace):
     avPlockApplyAt(step, tSec?) -> bool          the pinned scheduler hook
     avPlockTransportStart(tSec?) / avPlockTransportStop() / avPlockIsRunning() -> bool
     avPlockTick(tSec?) -> bool                   the ~64 Hz control-rate tick (lin lanes)
     avPlockSampleLane(lane, pos) -> {value, kind} | null   pure interpolation sampler
     avPlockSnap() / avPlockLanesSnap() -> deep copy of the lane list (F's plock domain partner)
     avPlockLoad(x) / avPlockLanesLoad(arr) -> bool   sanitising load (array, {lanes}, {plocks})
     avPlockLaneAdd(path, interp?, steps?) / avPlockLaneRemove(i) / avPlockLaneIndex(path)
     avPlockLaneSetPath(i, path) / avPlockLaneSetInterp(i, interp)
     avPlockLaneSetStep(i, step, value) / avPlockLaneClearStep(i, step) / avPlockLaneToggleStep(i, step)
     avPlockLaneStepValue(i, step) -> value | null
     avPlockEnsureHooks() -> bool (idempotent) · avPlockHookState() -> {installed, wrapped, eventBound}
     avPlockState() -> observable snapshot · window.__avPlock republished on every change
     avPlockStepDur() -> seconds · avPlockSetGrid("16"|"8t") -> bool · avPlockSetLaneSteps(n) -> bool
     avPlockInit() -> bool (hooks + best-effort UI mount) · avPlockUiInit() / avPlockUiSync() -> bool
     avPlockUiPaint(lane, step) -> bool · avPlockLanesHTML() -> string (pure)
     avPlockClasses() -> string[] (parent styles them)
     AV_PLOCK_VERSION, AV_PLOCK_MAX_LANES, AV_PLOCK_MAX_STEPS, AV_PLOCK_TICK_HZ, AV_PLOCK_V1_PATHS */

"use strict";

const AV_PLOCK_VERSION = "p4.0";

/* pinned v1 path list for the lane-row select — free-text paths are accepted alongside it (§3.5) */
const AV_PLOCK_V1_PATHS = [
  "filter.cutoff", "filter.reso", "fx.verb.mix", "fx.delay.mix",
  "fx.delay.feedback", "fx.mod.rate", "engine.outScale",
];

const AV_PLOCK_MAX_LANES = 64;                 /* matches the core carrier AV_SEQ_PLOCK_CAP  */
const AV_PLOCK_MAX_STEPS = 64;                 /* matches the core AV_SEQ_STEPS (0..63)      */
const AV_PLOCK_PATH_MAXLEN = 64;               /* matches the core AV_SEQ_PATH_CAP           */
const AV_PLOCK_TICK_HZ = 64;                   /* lin control rate (§3.5)                  */
const AV_PLOCK_TICK_MS = 1000 / AV_PLOCK_TICK_HZ;
const AV_PLOCK_IDLE_STEPS = 3;                 /* idle gap (in stepDur) => fresh transport */
const AV_PLOCK_LIN_EPS_REL = 1e-4;             /* skip lin writes already this close       */
const AV_PLOCK_UI_STEPS_DEFAULT = 16;          /* lane-row painting width (v1)             */
const AV_PLOCK_UI_STEPS_MAX = 64;

/* ---------- module state (single source of truth) ---------- */

let avPlockLanes = [];                         /* [{path, interp, steps:{idx:value}}]      */
let avPlockRunState = null;                    /* { bases, applied, segs, lastStep, lastStepT, clock, ticker, startedAt } */
let avPlockHooks = null;                       /* {installed, wrapped, eventBound}         */
let avPlockApplying = 0;                       /* >0 while OUR write rides the funnel      */
let avPlockGridMode = "16";                    /* "16" | "8t" — the §2 stepDur grid        */
let avPlockUiStepCount = AV_PLOCK_UI_STEPS_DEFAULT;
let avPlockLastApply = null;                   /* {path, value, kind, step}                */
let avPlockApplyCount = 0;

/* ---------- tiny guarded helpers ---------- */

function avPlockHas(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function avPlockWarn(msg, e) {
  try { if (typeof console !== "undefined" && console && typeof console.warn === "function") console.warn(msg, e); } catch (e2) { /* nothing */ }
}

/* ---------- value laws (refuse with null, never throw) ---------- */

function avPlockNum(v) {
  if (v === null || v === undefined || v === "" || typeof v === "boolean"
      || typeof v === "object" || typeof v === "function") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function avPlockStepIndex(v) {
  if (typeof v === "string" && !/^\d+$/.test(v.trim())) return -1;
  const n = Number(v);
  if (!isFinite(n) || Math.floor(n) !== n || n < 0 || n >= AV_PLOCK_MAX_STEPS) return -1;
  return n;
}

function avPlockPathNorm(p) {
  if (typeof p !== "string") return null;
  const s = p.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!s) return null;
  return s.slice(0, AV_PLOCK_PATH_MAXLEN);
}

function avPlockInterpNorm(v) {
  return (v === "lin") ? "lin" : "step";
}

function avPlockStepsNorm(src) {
  const out = {};
  if (!src || typeof src !== "object") return out;
  let n = 0;
  for (const k in src) {
    if (!avPlockHas(src, k)) continue;
    if (n >= AV_PLOCK_MAX_STEPS) break;
    const s = avPlockStepIndex(k);
    if (s < 0) continue;
    const v = avPlockNum(src[k]);
    if (v === null) continue;
    out[String(s)] = v;
    n++;
  }
  return out;
}

function avPlockLaneNorm(entry) {
  if (!entry || typeof entry !== "object") return null;
  const path = avPlockPathNorm(entry.path);
  if (!path) return null;
  return { path: path, interp: avPlockInterpNorm(entry.interp), steps: avPlockStepsNorm(entry.steps) };
}

/* ---------- model ---------- */

function avPlockLaneIndexIn(list, path) {
  for (let i = 0; i < list.length; i++) if (list[i].path === path) return i;
  return -1;
}

function avPlockLaneIndex(path) {
  const p = avPlockPathNorm(path);
  if (!p) return -1;
  return avPlockLaneIndexIn(avPlockLanes, p);
}

function avPlockLanesSnap() {
  try {
    const out = [];
    for (let i = 0; i < avPlockLanes.length; i++) {
      const lane = avPlockLanes[i];
      const steps = {};
      for (const k in lane.steps) if (avPlockHas(lane.steps, k)) steps[k] = lane.steps[k];
      out.push({ path: lane.path, interp: lane.interp, steps: steps });
    }
    return out;
  } catch (e) { return []; }
}

/* F's plock domain partner (av_undo.js): the lanes list, deep-copied. Arrays are `object`s and
   round-trip through avPlockLoad below. */
function avPlockSnap() { return avPlockLanesSnap(); }

/* sanitising load. Accepts the lanes array, {lanes:[…]} or the §4 container {plocks:[…]}.
   false only for non-containers; per-entry garbage is dropped, never thrown, and the model is
   left untouched on a refusal. */
function avPlockLoad(x) {
  try {
    let arr = null;
    if (Array.isArray(x)) arr = x;
    else if (x && typeof x === "object") {
      if (Array.isArray(x.lanes)) arr = x.lanes;
      else if (Array.isArray(x.plocks)) arr = x.plocks;
    }
    if (!arr) return false;
    if (avPlockRunState) avPlockRunReset();
    const next = [];
    for (let i = 0; i < arr.length && next.length < AV_PLOCK_MAX_LANES; i++) {
      const lane = avPlockLaneNorm(arr[i]);
      if (!lane) continue;
      if (avPlockLaneIndexIn(next, lane.path) >= 0) continue;   /* one lane per path */
      next.push(lane);
    }
    avPlockLanes = next;
    avPlockUiSync();
    avPlockPublish();
    return true;
  } catch (e) { return false; }
}

function avPlockLanesLoad(arr) { return avPlockLoad(arr); }

function avPlockLaneAdd(path, interp, steps) {
  try {
    const p = avPlockPathNorm(path);
    if (!p) return false;
    if (avPlockLanes.length >= AV_PLOCK_MAX_LANES) return false;
    if (avPlockLaneIndexIn(avPlockLanes, p) >= 0) return false;
    avPlockLanes.push({ path: p, interp: avPlockInterpNorm(interp), steps: avPlockStepsNorm(steps) });
    if (avPlockRunState) avPlockRunState.bases[p] = avPlockReadValue(p);   /* late lane: capture now */
    avPlockUiSync();
    avPlockPublish();
    return true;
  } catch (e) { return false; }
}

function avPlockLaneRemove(i) {
  try {
    const k = Math.floor(Number(i));
    if (!isFinite(k) || k < 0 || k >= avPlockLanes.length) return false;
    if (avPlockRunState) avPlockRunReset();       /* restore held values before indices shift */
    avPlockLanes.splice(k, 1);
    avPlockUiSync();
    avPlockPublish();
    return true;
  } catch (e) { return false; }
}

function avPlockLaneSetPath(i, path) {
  try {
    const k = Math.floor(Number(i));
    if (!isFinite(k) || k < 0 || k >= avPlockLanes.length) return false;
    const p = avPlockPathNorm(path);
    if (!p) return false;
    const at = avPlockLaneIndexIn(avPlockLanes, p);
    if (at >= 0 && at !== k) return false;        /* one lane per path */
    if (avPlockLanes[k].path === p) return true;
    if (avPlockRunState) {
      avPlockRunReset();
      avPlockLanes[k].path = p;
      avPlockRunState.bases[p] = avPlockReadValue(p);
    } else {
      avPlockLanes[k].path = p;
    }
    avPlockUiSync();
    avPlockPublish();
    return true;
  } catch (e) { return false; }
}

function avPlockLaneSetInterp(i, interp) {
  try {
    const k = Math.floor(Number(i));
    if (!isFinite(k) || k < 0 || k >= avPlockLanes.length) return false;
    avPlockLanes[k].interp = avPlockInterpNorm(interp);
    avPlockUiSync();
    avPlockPublish();
    return true;
  } catch (e) { return false; }
}

function avPlockLaneSetStep(i, step, value) {
  try {
    const k = Math.floor(Number(i));
    const s = avPlockStepIndex(step);
    const v = avPlockNum(value);
    if (!isFinite(k) || k < 0 || k >= avPlockLanes.length || s < 0 || v === null) return false;
    avPlockLanes[k].steps[String(s)] = v;
    avPlockUiSync();
    avPlockPublish();
    return true;
  } catch (e) { return false; }
}

function avPlockLaneClearStep(i, step) {
  try {
    const k = Math.floor(Number(i));
    const s = avPlockStepIndex(step);
    if (!isFinite(k) || k < 0 || k >= avPlockLanes.length || s < 0) return false;
    const key = String(s);
    if (!avPlockHas(avPlockLanes[k].steps, key)) return false;   /* valid call, nothing to clear */
    delete avPlockLanes[k].steps[key];
    avPlockUiSync();
    avPlockPublish();
    return true;
  } catch (e) { return false; }
}

function avPlockLaneStepValue(i, step) {
  try {
    const k = Math.floor(Number(i));
    const s = avPlockStepIndex(step);
    if (!isFinite(k) || k < 0 || k >= avPlockLanes.length || s < 0) return null;
    const key = String(s);
    if (!avPlockHas(avPlockLanes[k].steps, key)) return null;
    return avPlockNum(avPlockLanes[k].steps[key]);
  } catch (e) { return null; }
}

function avPlockLaneToggleStep(i, step) {
  try {
    const k = Math.floor(Number(i));
    const s = avPlockStepIndex(step);
    if (!isFinite(k) || k < 0 || k >= avPlockLanes.length || s < 0) return false;
    if (avPlockHas(avPlockLanes[k].steps, String(s))) return avPlockLaneClearStep(k, s);
    const v = avPlockReadValue(avPlockLanes[k].path);
    return avPlockLaneSetStep(k, s, v === null ? 0.5 : v);
  } catch (e) { return false; }
}

/* ---------- step model helpers (pure) ---------- */

/* next locked index strictly after s, or -1 */
function avPlockNextLockIdx(lane, s) {
  let best = -1;
  if (!lane || !lane.steps) return best;
  for (const k in lane.steps) {
    if (!avPlockHas(lane.steps, k)) continue;
    const i = Number(k);
    if (isFinite(i) && i > s && (best < 0 || i < best)) best = i;
  }
  return best;
}

/* pure sampler: the value the lane holds at fractional position `pos` (null before the first lock).
   kind: "lock" (step lane / exact lock point) · "lin" (interpolating) · "hold" (lin past last). */
function avPlockSampleLane(lane, pos) {
  try {
    if (!lane || typeof lane !== "object" || !lane.steps || typeof lane.steps !== "object") return null;
    const p = Number(pos);
    if (!isFinite(p) || p < 0) return null;
    let from = -1, fromVal = 0;
    for (const k in lane.steps) {
      if (!avPlockHas(lane.steps, k)) continue;
      const i = Number(k), v = Number(lane.steps[k]);
      if (!isFinite(i) || !isFinite(v)) continue;
      if (i <= p && i > from) { from = i; fromVal = v; }
    }
    if (from < 0) return null;
    if (avPlockInterpNorm(lane.interp) !== "lin") return { value: fromVal, kind: "lock", from: from };
    const nextIdx = avPlockNextLockIdx(lane, from);
    if (nextIdx < 0) return { value: fromVal, kind: "hold", from: from };
    const toVal = Number(lane.steps[String(nextIdx)]);
    let f = (p - from) / (nextIdx - from);
    if (f < 0) f = 0;
    if (f > 1) f = 1;
    return { value: fromVal + (toVal - fromVal) * f, kind: "lin", from: from, to: nextIdx };
  } catch (e) { return null; }
}

/* ---------- clock + tempo (guarded; §2 stepDur law) ---------- */

function avPlockEngineCtx() {
  try {
    if (typeof window !== "undefined" && window && window.__avEngine && window.__avEngine.handle) {
      const ctx = window.__avEngine.handle.ctx;
      if (ctx && typeof ctx.currentTime === "number" && isFinite(ctx.currentTime)) return ctx;
    }
  } catch (e) { /* no window / no handle */ }
  return null;
}

function avPlockHostNow() {
  try { if (typeof performance !== "undefined" && performance && typeof performance.now === "function") return performance.now() / 1000; } catch (e) { /* nothing */ }
  try { return Date.now() / 1000; } catch (e) { /* nothing */ }
  return 0;
}

function avPlockMakeClock() {
  const ctx = avPlockEngineCtx();
  if (ctx) {
    return function () {
      try { const t = ctx.currentTime; if (isFinite(t)) return t; } catch (e) { /* fall through */ }
      return avPlockHostNow();
    };
  }
  return avPlockHostNow;
}

function avPlockNowSec() {
  try { return avPlockMakeClock()(); } catch (e) { return avPlockHostNow(); }
}

function avPlockStepDur() {
  let bpm = 120;
  try {
    if (typeof avState !== "undefined" && avState && isFinite(avState.bpm) && avState.bpm > 0) bpm = avState.bpm;
  } catch (e) { /* default stands */ }
  return (avPlockGridMode === "8t") ? (60 / bpm / 3) : (60 / bpm / 4);
}

function avPlockSetGrid(g) {
  const m = String(g);
  if (m !== "16" && m !== "8t") return false;
  avPlockGridMode = m;
  avPlockPublish();
  return true;
}

function avPlockTimeArg(run, tSec) {
  if (tSec !== undefined && tSec !== null) {
    const n = Number(tSec);
    if (isFinite(n)) return n;
  }
  try { if (run && typeof run.clock === "function") { const t = run.clock(); if (isFinite(t)) return t; } } catch (e) { /* fall through */ }
  return avPlockNowSec();
}

/* ---------- read / apply / restore (the funnel core) ---------- */

function avPlockReadValue(path) {
  try {
    if (typeof avParams !== "undefined" && avParams && typeof path === "string") {
      if (avPlockHas(avParams, path)) {
        const n = Number(avParams[path]);
        if (isFinite(n)) return n;
      }
    }
  } catch (e) { /* no mirror */ }
  return null;
}

/* internal-commit markers the sibling children key on: the capture tap (G) skips commits with
   meta.noCapture / meta.plock / meta.src === "plock" (flat on the funnel, d.meta on the event);
   the undo tap (F) ignores meta by design. */
function avPlockMeta(kind, step) {
  return { from: "plock", kind: kind, step: step, noCapture: true, plock: true, src: "plock" };
}

/* ONE commit fan-out for a lock / lin step / restore. Rides avApplyParam when the app defines it,
   the 'av-param' window event otherwise (same funnel avKnobCommit falls back to). true = a write
   left this module; false = nothing could carry it. Never throws. */
function avPlockApplyValue(path, value, kind, step) {
  try {
    let fanout = false;
    if (typeof avApplyParam === "function") {
      avPlockApplying++;
      try { avApplyParam(path, value, avPlockMeta(kind, step)); }
      finally { avPlockApplying--; }
      fanout = true;
    } else {
      try {
        if (typeof window !== "undefined" && window && typeof window.dispatchEvent === "function"
            && typeof CustomEvent === "function") {
          window.dispatchEvent(new CustomEvent("av-param", { detail: { path: path, value: value, from: "plock", kind: kind, step: step, meta: avPlockMeta(kind, step) } }));
          fanout = true;
        }
      } catch (e) { fanout = false; }
    }
    if (fanout) {
      avPlockApplyCount++;
      avPlockLastApply = { path: path, value: value, kind: kind, step: step };
    }
    return fanout;
  } catch (e) { return false; }
}

function avPlockRestorePath(run, lane, s) {
  const base = run.bases[lane.path];
  if (base === null || base === undefined || !isFinite(base)) return false;   /* unknown base: hold on */
  const ok = avPlockApplyValue(lane.path, base, "restore", s);
  if (ok) delete run.applied[lane.path];
  return ok;
}

/* restore every path the lanes still hold (structural model changes + stop), never throws */
function avPlockRunReset() {
  const run = avPlockRunState;
  if (!run) return false;
  const paths = Object.keys(run.applied);
  for (let i = 0; i < paths.length; i++) {
    const base = run.bases[paths[i]];
    if (base !== null && base !== undefined && isFinite(base)) {
      avPlockApplyValue(paths[i], base, "restore", -1);
    }
  }
  run.applied = {};
  run.segs = {};
  return true;
}

/* ---------- per-lane boundary semantics ---------- */

function avPlockApplyStepLaneAt(run, i, lane, s) {
  if (avPlockHas(lane.steps, String(s))) {
    const v = avPlockNum(lane.steps[String(s)]);
    if (v === null) return false;
    if (avPlockApplyValue(lane.path, v, "lock", s)) { run.applied[lane.path] = true; return true; }
    return false;
  }
  /* the pinned law: locked at k, no lock at k+1 -> restore the transport-start base */
  if (run.applied[lane.path]) return avPlockRestorePath(run, lane, s);
  return false;
}

function avPlockApplyLinLaneAt(run, i, lane, s) {
  if (avPlockHas(lane.steps, String(s))) {
    const v = avPlockNum(lane.steps[String(s)]);
    if (v === null) return false;
    const next = avPlockNextLockIdx(lane, s);
    if (next >= 0) {
      const toVal = avPlockNum(lane.steps[String(next)]);
      run.segs[i] = (toVal === null)
        ? { from: s, fromVal: v, to: null, toVal: null }
        : { from: s, fromVal: v, to: next, toVal: toVal };
    } else {
      run.segs[i] = { from: s, fromVal: v, to: null, toVal: null };
    }
    if (avPlockApplyValue(lane.path, v, "lock", s)) { run.applied[lane.path] = true; return true; }
    return false;
  }
  const seg = run.segs[i] || null;
  if (seg && seg.to !== null) {                 /* mid-segment: apply the exact grid-point value */
    const span = seg.to - seg.from;
    let f = (span > 0) ? ((s - seg.from) / span) : 1;
    if (f < 0) f = 0;
    if (f > 1) f = 1;
    const v = seg.fromVal + (seg.toVal - seg.fromVal) * f;
    if (avPlockApplyValue(lane.path, v, "lin", s)) { run.applied[lane.path] = true; return true; }
    return false;
  }
  if (seg || run.applied[lane.path]) {          /* hold ended (no next step) -> restore */
    run.segs[i] = null;
    return avPlockRestorePath(run, lane, s);
  }
  return false;
}

/* ---------- transport + the pinned boundary hook ---------- */

function avPlockStartTicker() {
  const run = avPlockRunState;
  if (!run || run.ticker) return false;
  try {
    if (typeof setInterval === "function") {
      run.ticker = setInterval(function () {
        try { avPlockTick(); } catch (e) { /* a tick never escapes */ }
      }, AV_PLOCK_TICK_MS);
      try { if (run.ticker && typeof run.ticker.unref === "function") run.ticker.unref(); } catch (e) { /* browser ids */ }
      return true;
    }
  } catch (e) { avPlockWarn("[anvil] plock ticker failed", e); }
  return false;
}

function avPlockStopTicker() {
  const run = avPlockRunState;
  if (!run || !run.ticker) return false;
  try { if (typeof clearInterval === "function") clearInterval(run.ticker); } catch (e) { /* nothing */ }
  run.ticker = null;
  return true;
}

function avPlockTransportStart(tSec) {
  try {
    if (avPlockRunState) avPlockTransportStop();
    const clock = avPlockMakeClock();
    let t = avPlockNum(tSec);
    if (t === null) t = clock();
    const run = {
      bases: {}, applied: {}, segs: {},
      lastStep: -1, lastStepT: t, startedAt: t,
      clock: clock, ticker: null,
    };
    for (let i = 0; i < avPlockLanes.length; i++) {
      const lane = avPlockLanes[i];
      run.bases[lane.path] = avPlockReadValue(lane.path);   /* captured at transport start */
    }
    avPlockRunState = run;
    avPlockEnsureHooks();
    avPlockStartTicker();
    avPlockPublish();
    return true;
  } catch (e) {
    avPlockRunState = null;
    avPlockWarn("[anvil] plock transport start failed", e);
    return false;
  }
}

function avPlockTransportStop() {
  try {
    const run = avPlockRunState;
    if (!run) return false;
    avPlockStopTicker();
    const paths = Object.keys(run.applied);
    for (let i = 0; i < paths.length; i++) {
      const base = run.bases[paths[i]];
      if (base !== null && base !== undefined && isFinite(base)) avPlockApplyValue(paths[i], base, "restore", -1);
    }
    avPlockRunState = null;
    avPlockPublish();
    return true;
  } catch (e) {
    avPlockRunState = null;
    return false;
  }
}

function avPlockIsRunning() { return !!avPlockRunState; }

/* B's pinned hook (§3.2 dispatch: plocks -> note events). Called at every step boundary.
   Auto-starts on the first call (base capture happens BEFORE any lock of this step is applied)
   and restarts across an idle gap (fresh play without an announced stop). */
function avPlockApplyAt(step, tSec) {
  try {
    const s = avPlockStepIndex(step);
    if (s < 0) return false;

    let run = avPlockRunState;

    /* idle-gap watchdog: a new transport that never said stop */
    if (run && run.lastStep >= 0) {
      const now0 = avPlockTimeArg(run, tSec);
      if (isFinite(now0) && isFinite(run.lastStepT)) {
        const gap = now0 - run.lastStepT;
        const idle = avPlockStepDur() * AV_PLOCK_IDLE_STEPS + 0.05;
        if (gap < -0.001) run.lastStepT = now0;                 /* clock stepped back: resync */
        else if (gap > idle) { avPlockTransportStop(); run = null; }
      }
    }

    if (!run) {
      if (!avPlockLanes.length) return false;                    /* nothing to do: no hidden state */
      if (avPlockTransportStart(tSec) !== true) return false;
      run = avPlockRunState;
      if (!run) return false;
    }

    const now = avPlockTimeArg(run, tSec);
    let acted = false;
    for (let i = 0; i < avPlockLanes.length; i++) {
      const lane = avPlockLanes[i];
      if (lane.interp === "lin") acted = avPlockApplyLinLaneAt(run, i, lane, s) || acted;
      else acted = avPlockApplyStepLaneAt(run, i, lane, s) || acted;
    }
    if (isFinite(now)) { run.lastStep = s; run.lastStepT = now; }
    avPlockPublish();
    return acted;
  } catch (e) {
    avPlockWarn("[anvil] plock apply failed", e);
    return false;
  }
}

/* the ~64 Hz control-rate tick: lin lanes only, driven by the run clock (or an explicit tSec) */
function avPlockTick(tSec) {
  try {
    const run = avPlockRunState;
    if (!run) return false;
    const t = avPlockTimeArg(run, tSec);
    if (!isFinite(t)) return false;
    const stepDur = avPlockStepDur();
    if (!(stepDur > 0)) return false;
    let acted = false;
    for (let i = 0; i < avPlockLanes.length; i++) {
      const lane = avPlockLanes[i];
      if (lane.interp !== "lin") continue;
      const seg = run.segs[i];
      if (!seg || seg.to === null || seg.to === undefined) continue;
      const span = seg.to - seg.from;
      if (!(span > 0)) continue;
      let pos = run.lastStep + (t - run.lastStepT) / stepDur;
      if (pos < seg.from) pos = seg.from;
      if (pos > seg.to) pos = seg.to;
      let f = (pos - seg.from) / span;
      if (f < 0) f = 0;
      if (f > 1) f = 1;
      const v = seg.fromVal + (seg.toVal - seg.fromVal) * f;
      const cur = avPlockReadValue(lane.path);
      if (cur !== null && Math.abs(cur - v) <= AV_PLOCK_LIN_EPS_REL * (1 + Math.abs(v))) continue;
      if (avPlockApplyValue(lane.path, v, "lin", run.lastStep)) acted = true;
    }
    if (acted) avPlockPublish();
    return acted;
  } catch (e) { return false; }
}

/* ---------- the commit funnel: additive wrap + 'av-param' belt ---------- */

function avPlockFunnelTap(path, value) {
  try {
    if (avPlockApplying > 0) return false;                    /* our own write, never a base move */
    if (typeof path !== "string") return false;
    const run = avPlockRunState;
    if (!run) return false;                                   /* re-capture only while running */
    if (avPlockLaneIndexIn(avPlockLanes, path) < 0) return false;
    if (typeof value === "number" && isFinite(value)) {
      run.bases[path] = value;
      avPlockPublish();
      return true;
    }
    return false;
  } catch (e) { return false; }
}

function avPlockParamEvent(ev) {
  const d = ev && ev.detail;
  if (!d) return;
  avPlockFunnelTap(d.path, d.value);
}

function avPlockHookState() {
  const h = avPlockHooks || { installed: false, wrapped: false, eventBound: false };
  return { installed: !!h.installed, wrapped: !!h.wrapped, eventBound: !!h.eventBound };
}

/* Install ONCE: (1) the 'av-param' event belt (used when no app funnel exists), (2) the additive,
   idempotent avApplyParam wrap scoped to locked paths (marker __avPlockWrap; every call passes
   through untouched). Never throws. */
function avPlockEnsureHooks() {
  try {
    if (!avPlockHooks) avPlockHooks = { installed: false, wrapped: false, eventBound: false };
    if (avPlockHooks.installed) return true;
    try {
      if (typeof window !== "undefined" && window && typeof window.addEventListener === "function") {
        window.addEventListener("av-param", avPlockParamEvent);
        avPlockHooks.eventBound = true;
      }
    } catch (e) { /* no window — stays unbound */ }
    try {
      if (typeof avApplyParam === "function" && avApplyParam.__avPlockWrap !== true) {
        const orig = avApplyParam;
        const wrapped = function (path, v, meta) {
          try { avPlockFunnelTap(path, v); } catch (e) { /* never break the funnel */ }
          return orig(path, v, meta);
        };
        wrapped.__avPlockWrap = true;
        avApplyParam = wrapped;
        avPlockHooks.wrapped = true;
      } else if (typeof avApplyParam === "function" && avApplyParam.__avPlockWrap === true) {
        avPlockHooks.wrapped = true;                      /* another install already wrapped */
      }
    } catch (e) { /* funnel unreachable — the event belt still works */ }
    if (avPlockHooks.wrapped || avPlockHooks.eventBound) avPlockHooks.installed = true;
    return avPlockHooks.installed;
  } catch (e) { return false; }
}

/* ---------- observables ---------- */

function avPlockState() {
  try {
    const run = avPlockRunState;
    const bases = {};
    if (run) for (const k in run.bases) if (avPlockHas(run.bases, k)) bases[k] = run.bases[k];
    const applied = run ? Object.keys(run.applied) : [];
    return {
      version: AV_PLOCK_VERSION,
      running: !!run,
      startedAt: run ? run.startedAt : null,
      lastStep: run ? run.lastStep : -1,
      laneCount: avPlockLanes.length,
      bases: bases,
      applied: applied,
      lastApply: avPlockLastApply ? { path: avPlockLastApply.path, value: avPlockLastApply.value, kind: avPlockLastApply.kind, step: avPlockLastApply.step } : null,
      applyCount: avPlockApplyCount,
      tickHz: AV_PLOCK_TICK_HZ,
      grid: avPlockGridMode,
      stepDur: avPlockStepDur(),
      hooks: avPlockHookState(),
      lanes: avPlockLanesSnap(),
    };
  } catch (e) { return { version: AV_PLOCK_VERSION, running: false, laneCount: 0, lanes: [] }; }
}

function avPlockPublish() {
  try { if (typeof window !== "undefined" && window) window.__avPlock = avPlockState(); } catch (e) { /* no window */ }
}

/* ---------- UI: lane rows under the inspector (every reach guarded) ---------- */

function avPlockUiHost() {
  try {
    if (typeof document === "undefined" || !document) return null;
    if (typeof document.getElementById === "function") {
      const dedicated = document.getElementById("av-seq-plock");
      if (dedicated) return dedicated;                 /* preferred host the parent may add */
    }
    if (typeof document.querySelector === "function") {
      return document.querySelector(".av-seq-insp") || document.querySelector("#av-seq-insp") || null;
    }
  } catch (e) { /* no document */ }
  return null;
}

function avPlockUiShell() {
  try {
    const host = avPlockUiHost();
    if (!host) return null;
    if (host.id === "av-seq-plock") return host;
    if (typeof host.querySelector === "function") return host.querySelector(".av-seq-plock");
  } catch (e) { /* no DOM */ }
  return null;
}

function avPlockEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function avPlockNumText(v) {
  const n = Number(v);
  return isFinite(n) ? String(Math.round(n * 10000) / 10000) : "0";
}

function avPlockCellsHTML(lane, i) {
  let out = "";
  for (let s = 0; s < avPlockUiStepCount; s++) {
    const key = String(s);
    const has = avPlockHas(lane.steps, key);
    const v = has ? avPlockNum(lane.steps[key]) : null;
    out += '<span class="av-seq-plock-cell' + (has ? " on" : "") + '" data-lane="' + i + '" data-step="' + s + '"'
      + ' title="' + (has && v !== null ? "step " + s + ": " + avPlockEsc(avPlockNumText(v)) : "step " + s) + '"></span>';
  }
  return out;
}

function avPlockPathOptionsHTML(lane) {
  let out = "";
  const known = AV_PLOCK_V1_PATHS.indexOf(lane.path) >= 0;
  for (let i = 0; i < AV_PLOCK_V1_PATHS.length; i++) {
    const p = AV_PLOCK_V1_PATHS[i];
    out += '<option value="' + avPlockEsc(p) + '"' + (p === lane.path ? " selected" : "") + ">" + avPlockEsc(p) + "</option>";
  }
  if (!known) out += '<option value="' + avPlockEsc(lane.path) + '" selected>' + avPlockEsc(lane.path) + "</option>";
  out += '<option value="__custom">custom&hellip;</option>';
  return out;
}

function avPlockLaneRowHTML(lane, i) {
  const known = AV_PLOCK_V1_PATHS.indexOf(lane.path) >= 0;
  return '<div class="av-seq-plock-row" data-lane="' + i + '">' +
    '<select class="av-select av-seq-plock-path" data-lane-field="path" data-lane="' + i + '" aria-label="Lane ' + (i + 1) + ' path">' +
    avPlockPathOptionsHTML(lane) + "</select>" +
    '<input class="av-seq-plock-custom" type="text" data-lane-custom="' + i + '" aria-label="Lane ' + (i + 1) + ' custom path" placeholder="custom.path" value="' +
    (known ? "" : avPlockEsc(lane.path)) + '"' + (known ? " hidden" : "") + ">" +
    '<select class="av-select av-seq-plock-interp" data-lane-field="interp" data-lane="' + i + '" aria-label="Lane ' + (i + 1) + ' interpolation">' +
    '<option value="step"' + (lane.interp === "step" ? " selected" : "") + ">STEP</option>" +
    '<option value="lin"' + (lane.interp === "lin" ? " selected" : "") + ">LIN</option></select>" +
    '<div class="av-seq-plock-cells">' + avPlockCellsHTML(lane, i) + "</div>" +
    '<button type="button" class="av-btn mini av-seq-plock-del" data-lane-del="' + i + '" title="Remove lane ' + (i + 1) + '" aria-label="Remove lane ' + (i + 1) + '">&#10005;</button>' +
    "</div>";
}

function avPlockLanesHTML() {
  if (!avPlockLanes.length) {
    return '<p class="av-seq-plock-empty av-note av-dim">No p-lock lanes yet &mdash; + LANE, pick a path, then paint steps: click a cell to lock the current knob value at that step, click again to clear.</p>';
  }
  let out = "";
  for (let i = 0; i < avPlockLanes.length; i++) out += avPlockLaneRowHTML(avPlockLanes[i], i);
  return out;
}

function avPlockShellHTML() {
  return '<div class="av-seq-plock-head"><span class="av-seq-plock-lbl">P-LOCKS</span>' +
    '<button type="button" class="av-btn mini av-seq-plock-add" title="Add a p-lock lane">+ LANE</button></div>' +
    '<div class="av-seq-plock-lanes">' + avPlockLanesHTML() + "</div>";
}

function avPlockUiAddLane() {
  for (let i = 0; i < AV_PLOCK_V1_PATHS.length; i++) {
    if (avPlockLaneIndexIn(avPlockLanes, AV_PLOCK_V1_PATHS[i]) < 0) return avPlockLaneAdd(AV_PLOCK_V1_PATHS[i], "step");
  }
  return false;
}

function avPlockUiPaint(laneIdx, step) {
  return avPlockLaneToggleStep(laneIdx, step);
}

/* delegated card wiring (survives lane re-renders) */
function avPlockClick(e) {
  try {
    const t = e && e.target;
    if (!t || typeof t.closest !== "function") return;
    const cell = t.closest(".av-seq-plock-cell");
    if (cell) { avPlockUiPaint(Number(cell.getAttribute("data-lane")), Number(cell.getAttribute("data-step"))); return; }
    const del = t.closest(".av-seq-plock-del");
    if (del) { avPlockLaneRemove(Number(del.getAttribute("data-lane-del"))); return; }
    if (t.closest(".av-seq-plock-add")) avPlockUiAddLane();
  } catch (e2) { /* never break the card */ }
}

function avPlockChange(e) {
  try {
    const t = e && e.target;
    if (!t || typeof t.closest !== "function") return;
    const sel = t.closest("select[data-lane-field]");
    if (sel) {
      const i = Number(sel.getAttribute("data-lane"));
      const f = sel.getAttribute("data-lane-field");
      if (f === "path") {
        if (sel.value === "__custom") {                 /* reveal the free-text input (§3.5) */
          const shell = avPlockUiShell();
          let box = null;
          if (shell && typeof shell.querySelector === "function") box = shell.querySelector('[data-lane-custom="' + i + '"]');
          if (box) { try { box.hidden = false; } catch (e2) { /* stays hidden */ } if (typeof box.focus === "function") box.focus(); }
          return;
        }
        avPlockLaneSetPath(i, sel.value);
      } else if (f === "interp") {
        avPlockLaneSetInterp(i, sel.value);
      }
      avPlockUiSync();
      return;
    }
    const cust = t.closest("input[data-lane-custom]");
    if (cust) {
      avPlockLaneSetPath(Number(cust.getAttribute("data-lane-custom")), cust.value);
      avPlockUiSync();
    }
  } catch (e2) { /* never break the card */ }
}

function avPlockBindShell(shell) {
  if (!shell || typeof shell.addEventListener !== "function") return false;
  if (shell.__avPlockBound === true) return true;
  shell.__avPlockBound = true;
  shell.addEventListener("click", avPlockClick);
  shell.addEventListener("change", avPlockChange);
  return true;
}

function avPlockUiSync() {
  try {
    const shell = avPlockUiShell();
    if (!shell || typeof shell.querySelector !== "function") return false;
    const box = shell.querySelector(".av-seq-plock-lanes");
    if (box) box.innerHTML = avPlockLanesHTML();
    return true;
  } catch (e) { return false; }
}

/* mount: the dedicated host #av-seq-plock is written whole; a fallback host (.av-seq-insp) gets
   the shell appended as a child. false-without-throw when neither exists; re-mountable. */
function avPlockUiInit() {
  try {
    const host = avPlockUiHost();
    if (!host) return false;
    const doc = (typeof document !== "undefined") ? document : null;
    if (!doc) return false;
    let shell = null;
    if (host.id === "av-seq-plock") shell = host;
    else if (typeof host.querySelector === "function") shell = host.querySelector(".av-seq-plock");
    if (!shell) {
      if (typeof doc.createElement !== "function" || typeof host.appendChild !== "function") return false;
      shell = doc.createElement("div");
      try { shell.className = "av-seq-plock"; } catch (e) { /* className is a nicety */ }
      host.appendChild(shell);
    }
    if (typeof shell.innerHTML !== "undefined") shell.innerHTML = avPlockShellHTML();
    avPlockBindShell(shell);
    avPlockUiSync();
    return true;
  } catch (e) {
    avPlockWarn("[anvil] plock UI mount failed", e);
    return false;
  }
}

function avPlockSetLaneSteps(n) {
  const k = Math.floor(Number(n));
  if (!isFinite(k) || k < 1 || k > AV_PLOCK_UI_STEPS_MAX) return false;
  avPlockUiStepCount = k;
  avPlockUiSync();
  return true;
}

/* ---------- integration convenience (parent boot / C's card) ---------- */

/* hooks are the critical part; the UI mount is best-effort (no host -> still true when the funnel
   tap landed, so boot never depends on the sequencer card being present). */
function avPlockInit() {
  const hooks = avPlockEnsureHooks();
  try { avPlockUiInit(); } catch (e) { /* best effort */ }
  return hooks;
}

/* ---------- css classes this card introduces (parent styles them) ---------- */

function avPlockClasses() {
  return [
    "av-seq-plock", "av-seq-plock-head", "av-seq-plock-lbl", "av-seq-plock-add",
    "av-seq-plock-lanes", "av-seq-plock-row", "av-seq-plock-path", "av-seq-plock-custom",
    "av-seq-plock-interp", "av-seq-plock-cells", "av-seq-plock-cell",
    "av-seq-plock-del", "av-seq-plock-empty",
  ];
}
