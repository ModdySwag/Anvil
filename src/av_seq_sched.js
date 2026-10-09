/* av_seq_sched.js — Anvil P4 sequencer timing layer (verify/_p4_wave.md §3.2, owner B).
   The pure event planner + the live transport (audio clock) + the note-bus bridge + slide/legato
   emission + the p-lock dispatch hook. Loads in plain node: every global reach (window,
   avEngineEnsure, avState, avNoteDown/Up, avPlock*, avSeqAcid*, avTuneTrackSlot) is
   `typeof`-guarded inside a function; nothing touches a DOM at load.

   THE PURE PLANNER — avSeqPlan(snap, fromStep, toStep, originT, rngState) -> {events, rngNext}
     Analytic times, no I/O. Per track (4, polymetric):
       td   = stepDur / speed            track step duration (16ths base; grid "8t" = /3)
       swing (T3 §16): delay = pairLen × (S−50)/100; odd local step shifts +td×(S−50)/100
                      (speed 1 reduces to the §2 pin stepDur×(S−50)/100)
       micro (§2):    +micro × stepDur/24  (24 ticks/step), applied after swing
       ratchet (T3 §18): R hits per step, spacing = gate×td/R, gapless (each hit sounds one
                      slice; gate is the step-fraction the whole ratchet lives in)
       probability:   own xorshift32 (13/17/5; seed from the snap / avSeqRng()). Draws happen
                      only for steps that passed their condition and have prob < 100:
                      hit ⇔ (u32 % 100) < prob  → prob 0 silent, prob 100 loud, same seed ⇒
                      same result. Draw order = track 0..3, local step ascending.
       conditions (T3 §17): "" | "fill" (runtime fill flag) | "a:b" (pass n ≡ A (mod B),
                      i.e. (n−1) % B === (A−1) % B; n = floor(k/len)+1) | "first" | "!first".
                      Conditions are evaluated BEFORE the probability roll.
       oct:           note + oct×12 semitones (oct −2..2) via avNoteParse/avNoteName.
       accent:        vel = 1.0 (the §2 pin); plain steps carry their own vel (clamped .05..1).
       gate/off law:  off = min(on + gate×td, next local step's analytic onset) — never past
                      the next on. Slide step k ties its LAST hit to the next step's onset
                      (legato; off(k) is ordered AFTER down(k+1) at the same planned time).
     Window membership is k-domain tiling per track: k ∈ [floor(from×speed), floor(to×speed)) —
     swing/micro can never drop or duplicate a step across consecutive windows. Events come back
     sorted (t, tie-rank, insertion); slide tie-offs carry a hidden __rank=1 so a transport
     merging plan windows keeps down(k+1) before off(k) across chunk boundaries.

   THE LIVE TRANSPORT — avSeqInit/Play/Stop/Toggle/IsPlaying/SetPattern/Position/Rng/SchedNow
     Lookahead 0.12 s / wake 25 ms (§2 pin), all times against the live handle's ctx.currentTime.
     Honest clock: every event time is analytic from the transport origin (no accumulation →
     no drift). A tempo/grid change re-anchors the origin at the current plan pointer, so the
     grid stays continuous. Delivery discipline: an event leaves when
     t ≤ now + wake/2 (12.5 ms) — half a wake early, so the audible onset lands inside ±half a
     wake around the grid (mean |Δ| ≈ 6 ms, the ≤8 ms rig gate). Stall recovery: if the pump is
     > 0.5 s behind (tab throttle), the origin re-anchors to now and stale pending events are
     dropped (a held note whose off is dropped is released immediately).
     Emission law: events leave ONLY via avNoteDown/avNoteUp. The bus owns dedupe — a down the
     bus refused (name already held) is never released by the scheduler, so user keys are never
     clobbered. Slide pairs arm the acid glide window (avSeqAcidSlideBegin/End, guarded) around
     the tie: begin before down(k+1), end after off(k). P-locks run first at every step boundary
     (avPlockApplyAt(step, tSec), guarded): step = monotonic step mod the pattern cycle length
     (max track len), tSec = the boundary's analytic audio time; avPlockTransportStart/Stop
     bracket play/stop and the snapshot's plocks array is pushed via avPlockLoad when present.
     Track tuning (T wave): the 'on' emission asks the page-side TUNE card for the track's bank
     slot via a guarded avTuneTrackSlot(ev.track) sibling call; a valid int 0..7 rides
     avNoteDown as its optional opts ({ tune: slot }, 4th param). No card / no assignment keeps
     the original 2-arg call exactly (guarded, never cached across emissions, never throws).
     Trace: bounded ring window.__avSeqTrace (256 × {t,type,note,step,track}, t = planned time);
     window.__avSeq debug handle (playing, patternName, lastEvents, + setFill/traceCount). */

"use strict";

const AV_SEQ_SCHED_VERSION = "p4.0";
const AV_SEQ_SCHED_LOOKAHEAD_S = 0.12;             /* §2 pin: plan-ahead window */
const AV_SEQ_SCHED_WAKE_MS = 25;                   /* §2 pin: timer cadence    */
const AV_SEQ_SCHED_DELIVER_EPS_S = AV_SEQ_SCHED_WAKE_MS / 2000;  /* wake/2 = 0.0125 */
const AV_SEQ_SCHED_CHUNK_STEPS = 8;                /* steps planned per avSeqPlan call */
const AV_SEQ_SCHED_START_OFFSET_S = 0.05;          /* play → step 0 runway */
const AV_SEQ_SCHED_LATE_S = 0.5;                   /* stall: > this behind ⇒ re-anchor */
const AV_SEQ_SCHED_STALE_S = 0.01;                 /* stale pending drop threshold */
const AV_SEQ_SCHED_MAX_WINDOW = 512;               /* planner window sanity cap */
const AV_SEQ_SCHED_TRACE_CAP = 256;                /* §2: bounded trace ring */
const AV_SEQ_SCHED_LAST_CAP = 64;                  /* lastEvents cap */
const AV_SEQ_SCHED_SEED = 0x9E3779B9;              /* engine-lineage default (prngU32) */
const AV_SEQ_SCHED_BPM_MIN = 20;
const AV_SEQ_SCHED_BPM_MAX = 300;
const AV_SEQ_SCHED_SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];   /* M2: + 3/4, 3/2 (polyrhythm ratios) */
const AV_SEQ_SCHED_TRACKS = 4;
const AV_SEQ_SCHED_STEPS = 64;
const AV_SEQ_SCHED_DEF_LEN = 16;

/* ---------- small primitives (never throw) ---------- */

function avSeqSchedNum(v, dflt) {
  const n = Number(v);
  return isFinite(n) ? n : dflt;
}
function avSeqSchedClampNum(v, dflt, lo, hi) {
  const n = Number(v);
  if (v == null || v === "" || !isFinite(n)) return dflt;
  return n < lo ? lo : (n > hi ? hi : n);
}
function avSeqSchedClampInt(v, dflt, lo, hi) {
  const n = Number(v);
  if (v == null || v === "" || !isFinite(n)) return dflt;
  const r = Math.round(n);
  return r < lo ? lo : (r > hi ? hi : r);
}
function avSeqSchedPickSpeed(v) {
  const n = Number(v);
  if (isFinite(n)) {
    for (let i = 0; i < AV_SEQ_SCHED_SPEEDS.length; i++) if (n === AV_SEQ_SCHED_SPEEDS[i]) return n;
  }
  return 1;
}

/* ---------- the scheduler's own xorshift32 (engine constants 13/17/5, av_dsp prngU32) ---------- */

function avSeqSchedXor32(x) {
  x = x >>> 0;
  x ^= x << 13; x = x >>> 0;
  x ^= x >>> 17; x = x >>> 0;
  x ^= x << 5; x = x >>> 0;
  return x === 0 ? AV_SEQ_SCHED_SEED : x;   /* xorshift32 from a nonzero state never hits 0 */
}
function avSeqSchedSeedNorm(v) {
  let x = Number(v);
  if (!isFinite(x)) x = AV_SEQ_SCHED_SEED;
  x = Math.floor(x) >>> 0;
  return x === 0 ? AV_SEQ_SCHED_SEED : x;
}

/* grid → base step duration */
function avSeqSchedGridDur(bpm, grid) {
  const b = avSeqSchedClampNum(bpm, 120, AV_SEQ_SCHED_BPM_MIN, AV_SEQ_SCHED_BPM_MAX);
  return (grid === "8t") ? (60 / b / 3) : (60 / b / 4);
}

/* ---------- note names (bus-preferred; local fallback for plain node) ---------- */

function avSeqSchedParseNote(name) {
  if (typeof avNoteParse === "function") {
    try { const m = avNoteParse(name); if (m != null) return m; } catch (e) { /* fall through */ }
  }
  const m = /^([a-g])(#?)(-?\d+)$/.exec(String(name == null ? "" : name).toLowerCase());
  if (!m) return null;
  const pc = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1]];
  return (Number(m[3]) + 1) * 12 + pc + (m[2] ? 1 : 0);
}
function avSeqSchedNameNote(midi) {
  if (typeof avNoteName === "function") {
    try { const s = avNoteName(midi); if (s) return s; } catch (e) { /* fall through */ }
  }
  const m = Math.round(Number(midi));
  if (!isFinite(m)) return "";
  const names = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
  return names[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}
function avSeqSchedNoteShift(note, semis) {
  const s = (typeof note === "string" && note) ? note : "c4";
  if (!semis) return s;
  const midi = avSeqSchedParseNote(s);
  if (midi == null) return s;               /* unparseable: pass through untouched */
  const nm = avSeqSchedNameNote(midi + semis);
  return nm || s;
}

/* ---------- conditions (T3 §17; evaluated per pass BEFORE the probability roll) ---------- */

function avSeqSchedCondPass(cond, pass, fill) {
  if (typeof cond !== "string" || !cond) return true;          /* "" → always */
  if (cond === "fill") return fill === 1;
  if (cond === "first") return pass === 1;
  if (cond === "!first") return pass !== 1;
  const m = /^(\d+):(\d+)$/.exec(cond);
  if (m) {
    const A = parseInt(m[1], 10), B = parseInt(m[2], 10);
    if (A >= 1 && B >= 1) return ((pass - 1) % B) === ((A - 1) % B);
  }
  return true;                                                 /* unknown → no gate */
}

/* ---------- event sort/seal helpers (temporaries live only inside a plan call) ---------- */

function avSeqSchedCmpNew(a, b) {
  return (a.t - b.t) || (a.__r - b.__r) || (a.__s - b.__s);
}
function avSeqSchedRankOf(ev) {
  return (ev && ev.__rank === 1) ? 1 : 0;
}
function avSeqSchedCmpPending(a, b) {
  return (a.t - b.t) || (avSeqSchedRankOf(a) - avSeqSchedRankOf(b));
}
function avSeqSchedSeal(ev) {
  const r = ev.__r;
  delete ev.__s;
  delete ev.__r;
  if (r === 1) {
    try { Object.defineProperty(ev, "__rank", { value: 1, enumerable: false, configurable: true, writable: true }); }
    catch (e) { /* hidden tie-break only — never fatal */ }
  }
}

/* ============================================================================================
   THE PURE PLANNER
   ============================================================================================ */

function avSeqPlan(snap, fromStep, toStep, originT, rngState) {
  const out = { events: [], rngNext: avSeqSchedSeedNorm(rngState) };
  try {
    const s = (snap && typeof snap === "object") ? snap : null;
    let rng = avSeqSchedSeedNorm(rngState);
    const bpm = avSeqSchedClampNum(s ? s.bpm : 120, 120, AV_SEQ_SCHED_BPM_MIN, AV_SEQ_SCHED_BPM_MAX);
    const grid = (s && s.grid === "8t") ? "8t" : "16";
    const stepDur = avSeqSchedGridDur(bpm, grid);
    const swing = avSeqSchedClampNum(s ? s.swing : 66, 66, 50, 80);
    const fill = (s && s.fill) ? 1 : 0;
    const oT = avSeqSchedNum(originT, 0);

    let fs = Math.floor(avSeqSchedNum(fromStep, 0));
    let ts = Math.floor(avSeqSchedNum(toStep, fs));
    if (!(fs >= 0)) fs = 0;
    if (!(ts > fs)) { out.rngNext = rng; return out; }
    if (ts - fs > AV_SEQ_SCHED_MAX_WINDOW) ts = fs + AV_SEQ_SCHED_MAX_WINDOW;

    const tracks = (s && s.tracks && typeof s.tracks.length === "number") ? s.tracks : [];
    const nTracks = Math.min(AV_SEQ_SCHED_TRACKS, tracks.length | 0);
    let seq = 0;

    for (let ti = 0; ti < nTracks; ti++) {
      const tr = tracks[ti];
      if (!tr || typeof tr !== "object") continue;
      if (tr.mute) continue;
      const len = avSeqSchedClampInt(tr.len, AV_SEQ_SCHED_DEF_LEN, 1, AV_SEQ_SCHED_STEPS);
      const speed = avSeqSchedPickSpeed(tr.speed);
      const td = stepDur / speed;
      const tSwing = (isFinite(Number(tr.swing)) && Number(tr.swing) >= 50) ? avSeqSchedClampNum(tr.swing, swing, 50, 80) : swing;
      const swingShift = td * (tSwing - 50) / 100;      /* T3 §16: pairLen×(S−50)/100 = td×… */
      const microTick = stepDur / 24;                  /* §2 pin: tick = stepDur/24 */
      const steps = (tr.steps && typeof tr.steps.length === "number") ? tr.steps : null;
      const kFrom = Math.max(0, Math.floor(fs * speed));   /* k-domain tiling: each local step */
      const kTo = Math.floor(ts * speed);                  /* is planned by exactly one window  */

      for (let k = kFrom; k < kTo; k++) {
        const st = steps ? steps[k % len] : null;
        if (!st || typeof st !== "object" || !st.on) continue;

        const micro = avSeqSchedClampInt(st.micro, 0, -12, 12);
        const onT = oT + k * td + ((k & 1) ? swingShift : 0) + micro * microTick;
        const pass = Math.floor(k / len) + 1;
        if (!avSeqSchedCondPass(st.cond, pass, fill)) continue;

        const prob = avSeqSchedClampInt(st.prob, 100, 0, 100);
        if (prob < 100) {
          rng = avSeqSchedXor32(rng);
          if ((rng % 100) >= prob) continue;
        }

        /* next local step's analytic onset — the clamp surface + the slide tie target */
        const st2 = steps ? steps[(k + 1) % len] : null;
        const micro2 = (st2 && typeof st2 === "object") ? avSeqSchedClampInt(st2.micro, 0, -12, 12) : 0;
        const nextOn = oT + (k + 1) * td + (((k + 1) & 1) ? swingShift : 0) + micro2 * microTick;

        const oct = avSeqSchedClampInt(st.oct, 0, -2, 2);
        const slide = st.slide ? 1 : 0;
        const accent = st.accent ? 1 : 0;
        const gate = avSeqSchedClampNum(st.gate, 0.95, 0.05, 1);
        const ratchet = avSeqSchedClampInt(st.ratchet, 1, 1, 4);
        const note = avSeqSchedNoteShift(st.note, oct * 12);
        const vel = accent ? 1 : avSeqSchedClampNum(st.vel, 0.8, 0.05, 1);
        const flags = { slide: slide, accent: accent, ratchet: ratchet, micro: micro };
        const stepIdx = k % len;
        const spacing = gate * td / ratchet;               /* T3 §18: gate×td/R */

        for (let i = 0; i < ratchet; i++) {
          const subOn = onT + i * spacing;
          const isLast = (i === ratchet - 1);
          let subOff;
          let tieRank = 0;
          if (isLast && slide) {
            subOff = nextOn;                               /* slide: the last hit ties to the boundary */
            tieRank = 1;                                   /* …and sorts AFTER down(k+1) at that time */
          } else {
            subOff = onT + (i + 1) * spacing;
            if (subOff > nextOn) subOff = nextOn;          /* never past the next on */
          }
          if (subOff < subOn) subOff = subOn;              /* degenerate micro edge: zero-length */
          const onEv = { t: subOn, type: "on", note: note, vel: vel, track: ti, step: stepIdx, flags: flags };
          const offEv = { t: subOff, type: "off", note: note, vel: 0, track: ti, step: stepIdx, flags: flags };
          onEv.__r = tieRank; onEv.__s = seq++;
          offEv.__r = tieRank; offEv.__s = seq++;
          out.events.push(onEv, offEv);
        }
      }
    }

    out.events.sort(avSeqSchedCmpNew);
    for (let i = 0; i < out.events.length; i++) avSeqSchedSeal(out.events[i]);
    out.rngNext = rng;
    return out;
  } catch (e) {
    return { events: [], rngNext: avSeqSchedSeedNorm(rngState) };
  }
}

/* ============================================================================================
   THE LIVE TRANSPORT (audio clock)
   ============================================================================================ */

let avSeqSchedInited = false;
let avSeqSchedPlaying = false;
let avSeqSchedCtx = null;                  /* the live handle's ctx */
let avSeqSchedHandle = null;
let avSeqSchedPattern = null;              /* snapshot as set (read-only use; never mutated) */
let avSeqSchedPatternName = "PAT 1";
let avSeqSchedFill = 0;                    /* runtime fill flag (T3 §17 modal boolean) */
let avSeqSchedPlanFrom = 0;                /* next monotonic global step to plan */
let avSeqSchedOriginT = 0;                 /* analytic base: T(g) = origin + g×stepDur */
let avSeqSchedOriginSet = false;
let avSeqSchedSeed = AV_SEQ_SCHED_SEED;    /* planner RNG state (u32) */
let avSeqSchedLastStepDur = 0;             /* grid re-anchor detector */
let avSeqSchedPending = [];                /* planned, not-yet-delivered events (sorted) */
let avSeqSchedHeld = null;                 /* Map name -> {step, track}: notes WE started */
let avSeqSchedPlockNext = 0;               /* next monotonic step boundary to dispatch */
let avSeqSchedTimer = null;
let avSeqSchedEnsureTried = false;
let avSeqSchedEnsurePending = false;
let avSeqSchedView = null;                 /* cached pattern view (base+bpm+fill overlay) */
let avSeqSchedViewBase = null;
let avSeqSchedViewBpm = null;
let avSeqSchedViewFill = -1;
let avSeqSchedTrace = new Array(AV_SEQ_SCHED_TRACE_CAP).fill(null);
let avSeqSchedTraceCount = 0;
let avSeqSchedLastEvents = [];
let avSeqSchedDebug = null;

function avSeqSchedHeldMap() {
  if (!avSeqSchedHeld) avSeqSchedHeld = new Map();
  return avSeqSchedHeld;
}

/* ---------- the internal default pattern (silence; A's snapshot wins when set) ---------- */

function avSeqSchedDefaultSnap() {
  const tracks = [];
  for (let t = 0; t < AV_SEQ_SCHED_TRACKS; t++) {
    tracks.push({ len: AV_SEQ_SCHED_DEF_LEN, speed: 1, swing: 0, mute: 0, steps: [] });
  }
  return { v: 1, name: "PAT 1", bpm: 120, grid: "16", swing: 66, tracks: tracks, plocks: [], rng: AV_SEQ_SCHED_SEED };
}

/* live tempo: avState.bpm is the pinned source; the snapshot's bpm is the fallback */
function avSeqSchedLiveBpm() {
  try {
    if (typeof avState !== "undefined" && avState && typeof avState.bpm === "number" && isFinite(avState.bpm)) {
      return avState.bpm;
    }
  } catch (e) { /* no store */ }
  return null;
}

/* shallow view: base snapshot + the live bpm overlay + the runtime fill flag (rebuilt on change) */
function avSeqSchedPatternView() {
  const base = avSeqSchedPattern || avSeqSchedDefaultSnap();
  const liveBpm = avSeqSchedLiveBpm();
  const fill = avSeqSchedFill;
  if (avSeqSchedView && avSeqSchedViewBase === base && avSeqSchedViewBpm === liveBpm && avSeqSchedViewFill === fill) {
    return avSeqSchedView;
  }
  const v = {};
  for (const k in base) {
    if (Object.prototype.hasOwnProperty.call(base, k)) v[k] = base[k];
  }
  if (liveBpm != null) v.bpm = liveBpm;
  v.fill = fill;
  avSeqSchedView = v;
  avSeqSchedViewBase = base;
  avSeqSchedViewBpm = liveBpm;
  avSeqSchedViewFill = fill;
  return v;
}

function avSeqSchedStepDurNow() {
  const v = avSeqSchedPatternView();
  return avSeqSchedGridDur(v ? v.bpm : 120, (v && v.grid === "8t") ? "8t" : "16");
}

/* pattern cycle length for p-lock dispatch: the longest track (1..64) */
function avSeqSchedCycleLen() {
  let len = AV_SEQ_SCHED_DEF_LEN;
  try {
    const v = avSeqSchedPatternView();
    const tracks = (v && v.tracks && typeof v.tracks.length === "number") ? v.tracks : [];
    for (let i = 0; i < tracks.length && i < AV_SEQ_SCHED_TRACKS; i++) {
      const n = avSeqSchedClampInt(tracks[i] ? tracks[i].len : AV_SEQ_SCHED_DEF_LEN, AV_SEQ_SCHED_DEF_LEN, 1, AV_SEQ_SCHED_STEPS);
      if (n > len) len = n;
    }
  } catch (e) { /* default stands */ }
  return len;
}

/* ---------- context binding (lazy; never throws) ---------- */

function avSeqSchedBindResolve(h) {
  try {
    avSeqSchedEnsurePending = false;
    if (h && h.ctx) {
      avSeqSchedCtx = h.ctx;
      avSeqSchedHandle = h;
      if (avSeqSchedPlaying) {
        if (!avSeqSchedOriginSet) avSeqSchedEnsureOrigin();
        avSeqSchedStartTimer();
        avSeqSchedPump();
      }
    }
  } catch (e) { /* a late bind is best effort */ }
}

function avSeqSchedBindState() {
  try {
    if (avSeqSchedCtx && avSeqSchedCtx.state !== "closed") return "bound";
    avSeqSchedCtx = null;
    avSeqSchedHandle = null;
    if (typeof window !== "undefined" && window.__avEngine && window.__avEngine.ready === true) {
      const h = window.__avEngine.handle;
      if (h && h.ctx) { avSeqSchedCtx = h.ctx; avSeqSchedHandle = h; return "bound"; }
    }
    if (!avSeqSchedEnsureTried && typeof avEngineEnsure === "function") {
      avSeqSchedEnsureTried = true;
      let p = null;
      try { p = avEngineEnsure(); } catch (e) { p = null; }
      if (p && typeof p.then === "function") {
        avSeqSchedEnsurePending = true;
        try { p.then(avSeqSchedBindResolve, function () { avSeqSchedEnsurePending = false; }); } catch (e) { avSeqSchedEnsurePending = false; }
        return "pending";
      }
      if (p && p.ctx) { avSeqSchedCtx = p.ctx; avSeqSchedHandle = p; return "bound"; }
    }
    return avSeqSchedEnsurePending ? "pending" : "none";
  } catch (e) { return "none"; }
}

function avSeqSchedEnsureOrigin() {
  if (!avSeqSchedOriginSet && avSeqSchedCtx && typeof avSeqSchedCtx.currentTime === "number") {
    avSeqSchedOriginT = avSeqSchedCtx.currentTime + AV_SEQ_SCHED_START_OFFSET_S;
    avSeqSchedOriginSet = true;
    avSeqSchedLastStepDur = 0;
  }
}

/* ---------- timers (stubbed freely in node harnesses) ---------- */

function avSeqSchedStartTimer() {
  if (avSeqSchedTimer != null) return true;
  try {
    if (typeof setInterval === "function") {
      avSeqSchedTimer = setInterval(avSeqSchedPump, AV_SEQ_SCHED_WAKE_MS);
      return true;
    }
  } catch (e) { avSeqSchedTimer = null; }
  return false;
}
function avSeqSchedStopTimer() {
  if (avSeqSchedTimer == null) return false;
  try { if (typeof clearInterval === "function") clearInterval(avSeqSchedTimer); } catch (e) { /* gone */ }
  avSeqSchedTimer = null;
  return true;
}

/* ---------- trace ring (bounded; t = the event's planned audio time) ---------- */

function avSeqSchedTracePush(t, type, note, step, track) {
  try {
    avSeqSchedTrace[avSeqSchedTraceCount % AV_SEQ_SCHED_TRACE_CAP] = { t: t, type: type, note: note, step: step, track: track };
    avSeqSchedTraceCount++;
    if (avSeqSchedDebug) avSeqSchedDebug.traceCount = avSeqSchedTraceCount;
  } catch (e) { /* trace is evidence, never a failure */ }
}

/* ---------- guarded sibling hooks (plock E · acid lane D) ---------- */

function avSeqSchedPlockStart(tSec) {
  try { if (typeof avPlockTransportStart === "function") { avPlockTransportStart(tSec); return true; } } catch (e) { /* no plock module */ }
  return false;
}
function avSeqSchedPlockStop() {
  try { if (typeof avPlockTransportStop === "function") { avPlockTransportStop(); return true; } } catch (e) { /* no plock module */ }
  return false;
}
function avSeqSchedPlockLoad(snap) {
  try {
    if (typeof avPlockLoad === "function" && snap && Array.isArray(snap.plocks)) {
      avPlockLoad({ plocks: snap.plocks });
      return true;
    }
  } catch (e) { /* lane load is best effort */ }
  return false;
}
function avSeqSchedSlideBegin() {
  try { if (typeof avSeqAcidSlideBegin === "function") { avSeqAcidSlideBegin(); return true; } } catch (e) { /* va kind: lane refuses */ }
  return false;
}
function avSeqSchedSlideEnd() {
  try { if (typeof avSeqAcidSlideEnd === "function") { avSeqAcidSlideEnd(); return true; } } catch (e) { /* refused */ }
  return false;
}
function avSeqSchedSlideAbort() {
  try { if (typeof avSeqAcidSlideAbort === "function") { avSeqAcidSlideAbort(); return true; } } catch (e) { /* refused */ }
  return false;
}

/* ---------- emission (the note bus is the ONE note path) ---------- */

function avSeqSchedEmit(ev) {
  try {
    if (ev.type === "on") {
      /* T wave: per-track microtuning (page-side). avTuneTrackSlot is the TUNE card's guarded
         sibling hook - a valid int 0..7 becomes the optional opts { tune }; anything else keeps
         the original 2-arg avNoteDown call exactly (re-evaluated every emission, never cached,
         never throws). The track index rides the event itself (ev.track, set by the planner). */
      let to = null;
      try {
        if (typeof avTuneTrackSlot === "function") {
          const ts = avTuneTrackSlot(ev.track);
          if (typeof ts === "number" && isFinite(ts) && Math.floor(ts) === ts && ts >= 0 && ts <= 7) to = { tune: ts | 0 };
        }
      } catch (e2) { to = null; }
      const took = (typeof avNoteDown === "function")
        ? (to ? (avNoteDown(ev.note, ev.vel, undefined, to) === true) : (avNoteDown(ev.note, ev.vel) === true))
        : false;
      if (took) {
        avSeqSchedHeldMap().set(ev.note, { step: ev.step, track: ev.track });
        avSeqSchedTracePush(ev.t, "on", ev.note, ev.step, ev.track);
      }
      return took;
    }
    if (ev.type === "off") {
      const held = avSeqSchedHeldMap();
      if (!held.has(ev.note)) return false;          /* bus dedupe law: we never release a note we did not start */
      if (typeof avNoteUp === "function") avNoteUp(ev.note);
      held.delete(ev.note);
      avSeqSchedTracePush(ev.t, "off", ev.note, ev.step, ev.track);
      return true;
    }
  } catch (e) { /* a pump never throws */ }
  return false;
}

/* release everything the scheduler still holds (stop / stale drops) */
function avSeqSchedReleaseStep(ev, now) {
  try {
    const held = avSeqSchedHeldMap();
    if (!held.has(ev.note)) return false;
    if (typeof avNoteUp === "function") avNoteUp(ev.note);
    held.delete(ev.note);
    avSeqSchedTracePush(now, "off", ev.note, ev.step, ev.track);
    return true;
  } catch (e) { return false; }
}

/* ---------- p-lock dispatch (order: plocks → note events) ---------- */

function avSeqSchedDispatchPlocks(now, sd) {
  try {
    /* margin: a negative-micro step's note can arrive up to half a step before its grid
       boundary — dispatch the boundary early enough that the plock always lands first */
    const dueT = now + AV_SEQ_SCHED_DELIVER_EPS_S + sd * 0.5;
    const cycle = avSeqSchedCycleLen();
    const limit = avSeqSchedPlanFrom;
    while (avSeqSchedPlockNext < limit && (avSeqSchedOriginT + avSeqSchedPlockNext * sd) <= dueT) {
      const g = avSeqSchedPlockNext++;
      if (typeof avPlockApplyAt === "function") {
        try { avPlockApplyAt(((g % cycle) + cycle) % cycle, avSeqSchedOriginT + g * sd); } catch (e) { /* E refuses, we continue */ }
      }
    }
  } catch (e) { /* dispatch must never kill the pump */ }
}

/* ---------- delivery (sorted pending; slide window; trace; lastEvents) ---------- */

function avSeqSchedDeliver(now) {
  const eps = now + AV_SEQ_SCHED_DELIVER_EPS_S;
  let batch = null;
  while (avSeqSchedPending.length && avSeqSchedPending[0].t <= eps) {
    if (!batch) batch = [];
    batch.push(avSeqSchedPending.shift());
  }
  if (!batch) return;

  /* slide ties in this batch: arm the acid glide window before the glide target's down,
     close it after the tie-off — depth-counted because one timestamp may carry several */
  const tieT = new Map();
  for (let i = 0; i < batch.length; i++) {
    const ev = batch[i];
    if (ev.type === "off" && ev.flags && ev.flags.slide === 1) tieT.set(ev.t, (tieT.get(ev.t) || 0) + 1);
  }
  const slideOpen = new Map();

  for (let i = 0; i < batch.length; i++) {
    const ev = batch[i];
    const ties = tieT.get(ev.t) || 0;
    if (ties > 0 && !slideOpen.has(ev.t) && ev.type === "on") {
      slideOpen.set(ev.t, ties);
      for (let n = 0; n < ties; n++) avSeqSchedSlideBegin();
    }
    avSeqSchedEmit(ev);
    if (ev.type === "off" && ev.flags && ev.flags.slide === 1) {
      const rem = slideOpen.get(ev.t) || 0;
      if (rem > 0) {
        slideOpen.set(ev.t, rem - 1);
        avSeqSchedSlideEnd();
      }
    }
  }
  avSeqSchedLastEvents = batch.slice(-AV_SEQ_SCHED_LAST_CAP);
  avSeqSchedPublish();
}

/* ---------- stall recovery ---------- */

function avSeqSchedDropStale(now) {
  if (!avSeqSchedPending.length) return;
  const keep = [];
  for (let i = 0; i < avSeqSchedPending.length; i++) {
    const ev = avSeqSchedPending[i];
    if (ev.t < now - AV_SEQ_SCHED_STALE_S) {
      if (ev.type === "off") avSeqSchedReleaseStep(ev, now);
      continue;
    }
    keep.push(ev);
  }
  avSeqSchedPending = keep;
}

/* ---------- the pump (plan ahead → dispatch plocks → deliver) ---------- */

function avSeqSchedPump() {
  try {
    if (!avSeqSchedPlaying) return;
    if (!avSeqSchedCtx) {
      if (avSeqSchedBindState() !== "bound") return;
    }
    const ctx = avSeqSchedCtx;
    if (!ctx || typeof ctx.currentTime !== "number" || !isFinite(ctx.currentTime)) return;
    const now = ctx.currentTime;

    avSeqSchedEnsureOrigin();
    const sd = avSeqSchedStepDurNow();

    if (avSeqSchedLastStepDur > 0 && sd !== avSeqSchedLastStepDur) {
      /* tempo/grid change: re-anchor so the grid is continuous at the plan pointer (no jump) */
      avSeqSchedOriginT = avSeqSchedOriginT + avSeqSchedPlanFrom * (avSeqSchedLastStepDur - sd);
      avSeqSchedLastStepDur = sd;
    } else if (!(avSeqSchedLastStepDur > 0)) {
      avSeqSchedLastStepDur = sd;
    }

    const planT = avSeqSchedOriginT + avSeqSchedPlanFrom * sd;
    if (planT < now - AV_SEQ_SCHED_LATE_S) {
      avSeqSchedOriginT += (now - planT);            /* stall: re-anchor, keep the musical step */
      avSeqSchedDropStale(now);
    }

    const horizon = now + AV_SEQ_SCHED_LOOKAHEAD_S;
    let planned = false, guard = 0;
    while ((avSeqSchedOriginT + avSeqSchedPlanFrom * sd) < horizon && guard++ < 64) {
      const res = avSeqPlan(avSeqSchedPatternView(), avSeqSchedPlanFrom, avSeqSchedPlanFrom + AV_SEQ_SCHED_CHUNK_STEPS, avSeqSchedOriginT, avSeqSchedSeed);
      avSeqSchedSeed = res.rngNext >>> 0;
      const evs = res.events;
      for (let i = 0; i < evs.length; i++) avSeqSchedPending.push(evs[i]);
      avSeqSchedPlanFrom += AV_SEQ_SCHED_CHUNK_STEPS;
      planned = true;
    }
    if (planned) avSeqSchedPending.sort(avSeqSchedCmpPending);   /* stable merge across chunks */

    avSeqSchedDispatchPlocks(now, sd);
    avSeqSchedDeliver(now);
    avSeqSchedPublish();
  } catch (e) { /* a pump never throws */ }
}

/* ---------- the debug handle ---------- */

function avSeqSchedPublish() {
  try {
    if (avSeqSchedDebug) {
      avSeqSchedDebug.playing = avSeqSchedPlaying;
      avSeqSchedDebug.patternName = avSeqSchedPatternName;
      avSeqSchedDebug.lastEvents = avSeqSchedLastEvents;
      avSeqSchedDebug.traceCount = avSeqSchedTraceCount;
      avSeqSchedDebug.fill = avSeqSchedFill;
    }
  } catch (e) { /* debug publishing is best effort */ }
}

function avSeqSetFill(on) {
  avSeqSchedFill = on ? 1 : 0;
  avSeqSchedPublish();
  return true;
}

if (typeof window !== "undefined") {
  try {
    avSeqSchedDebug = {
      version: AV_SEQ_SCHED_VERSION,
      playing: false,
      patternName: avSeqSchedPatternName,
      lastEvents: avSeqSchedLastEvents,
      traceCount: 0,
      fill: 0,
      setFill: function (on) { return avSeqSetFill(on); },
    };
    window.__avSeq = avSeqSchedDebug;
    window.__avSeqTrace = avSeqSchedTrace;
  } catch (e) { avSeqSchedDebug = null; }
}

/* ============================================================================================
   PUBLIC SURFACE (the pinned §3.2 API)
   ============================================================================================ */

function avSeqInit() {
  if (avSeqSchedInited) return true;
  avSeqSchedInited = true;
  try {
    if (!avSeqSchedPattern && typeof avSeqDefaults === "function") {
      const d = avSeqDefaults();
      if (d && typeof d === "object") avSeqSchedPattern = d;
    }
    if (avSeqSchedPattern && typeof avSeqSchedPattern.name === "string" && avSeqSchedPattern.name) {
      avSeqSchedPatternName = avSeqSchedPattern.name;
    }
    if (avSeqSchedPattern && avSeqSchedPattern.fill) avSeqSchedFill = avSeqSchedPattern.fill ? 1 : 0;
  } catch (e) { /* defaults from A are a nicety */ }
  avSeqSchedBindState();               /* warm the engine bind so the first PLAY is instant */
  avSeqSchedPublish();
  return true;
}

function avSeqPlay() {
  try {
    if (avSeqSchedPlaying) return false;
    avSeqSchedEnsureTried = false;
    avSeqSchedEnsurePending = false;
    const st = avSeqSchedBindState();
    if (st === "none") return false;   /* refuse honestly: no context and no engine boot in flight */
    avSeqSchedPending = [];
    avSeqSchedHeldMap().clear();
    avSeqSchedPlanFrom = 0;
    avSeqSchedPlockNext = 0;
    avSeqSchedOriginSet = false;
    avSeqSchedLastStepDur = 0;
    if (avSeqSchedPattern) avSeqSchedSeed = avSeqSchedSeedNorm(avSeqSchedPattern.rng);
    avSeqSchedPlaying = true;
    if (avSeqSchedCtx) {
      avSeqSchedEnsureOrigin();
      avSeqSchedPlockLoad(avSeqSchedPattern);              /* the snapshot's lanes, when present */
      avSeqSchedPlockStart(avSeqSchedOriginT);
      avSeqSchedStartTimer();
      avSeqSchedPump();
    } else {
      avSeqSchedStartTimer();                              /* pending bind: pump no-ops until ctx */
    }
    avSeqSchedPublish();
    return true;
  } catch (e) { return false; }
}

function avSeqStop() {
  try {
    if (!avSeqSchedPlaying) return false;
    avSeqSchedPlaying = false;
    avSeqSchedStopTimer();
    const now = (avSeqSchedCtx && typeof avSeqSchedCtx.currentTime === "number") ? avSeqSchedCtx.currentTime : 0;
    const held = avSeqSchedHeldMap();
    held.forEach(function (meta, name) {
      try { if (typeof avNoteUp === "function") avNoteUp(name); } catch (e) { /* bus gone */ }
      avSeqSchedTracePush(now, "off", name, meta ? meta.step : -1, meta ? meta.track : -1);
    });
    held.clear();
    avSeqSchedPending = [];
    avSeqSchedPlockStop();
    avSeqSchedSlideAbort();
    avSeqSchedOriginSet = false;
    avSeqSchedLastStepDur = 0;
    avSeqSchedPlanFrom = 0;
    avSeqSchedPlockNext = 0;
    avSeqSchedPublish();
    return true;
  } catch (e) { return false; }
}

function avSeqToggle() {
  try {
    if (avSeqSchedPlaying) { avSeqStop(); return false; }
    return avSeqPlay();
  } catch (e) { return false; }
}

function avSeqIsPlaying() {
  return avSeqSchedPlaying === true;
}

function avSeqSetPattern(snap) {
  try {
    if (!snap || typeof snap !== "object") return false;
    avSeqSchedPattern = snap;                     /* live-safe: applies from the next planned step */
    avSeqSchedViewBase = null;                    /* invalidate the view cache */
    avSeqSchedPatternName = (typeof snap.name === "string" && snap.name) ? snap.name : "PAT 1";
    avSeqSchedFill = snap.fill ? 1 : 0;
    const rs = Number(snap.rng);
    if (isFinite(rs)) avSeqSchedSeed = avSeqSchedSeedNorm(rs);   /* same seed ⇒ same result */
    avSeqSchedPublish();
    return true;
  } catch (e) { return false; }
}

function avSeqPosition() {
  try {
    const ctx = avSeqSchedCtx;
    const t = (ctx && typeof ctx.currentTime === "number" && isFinite(ctx.currentTime)) ? ctx.currentTime : 0;
    if (!avSeqSchedPlaying || !ctx || !avSeqSchedOriginSet) return { step: -1, track: 0, t: t };
    const sd = avSeqSchedStepDurNow();
    let g = Math.floor((t - avSeqSchedOriginT) / sd);
    if (!isFinite(g) || g < 0) g = 0;
    return { step: g, track: 0, t: t };
  } catch (e) { return { step: -1, track: 0, t: 0 }; }
}

function avSeqRng(seed) {
  try {
    if (typeof seed === "undefined") return avSeqSchedSeed >>> 0;
    avSeqSchedSeed = avSeqSchedSeedNorm(seed);
    return avSeqSchedSeed >>> 0;
  } catch (e) { return avSeqSchedSeed >>> 0; }
}

function avSeqSchedNow() {
  try {
    if (!avSeqSchedCtx) avSeqSchedBindState();
    const ctx = avSeqSchedCtx;
    if (ctx && typeof ctx.currentTime === "number" && isFinite(ctx.currentTime)) return ctx.currentTime;
  } catch (e) { /* fall through */ }
  return null;
}
