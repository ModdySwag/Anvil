/* av_seq_acid.js — Anvil P4: the ACID lane (verify/_p4_wave.md §3.4, child D).
   The lane that turns the shared step model's acid columns (accent / slide / oct) into the exact
   AVACID engine semantics, and only those.

   ACTIVE WHEN the engine kind is `acid`: `avSeqAcidLane()` is the presence/active probe (truthy
   descriptor when active, false otherwise) the UI row switches on. UI hooks (the pinned names):
   `avSeqAcidClasses()` -> ["av-seq-acid-cols", "av-seq-acid-cell"] — the row container carries
   `.av-seq-acid-cols`, each of the three per-step cells carries `.av-seq-acid-cell`. This module
   builds no DOM (child C owns the card); it exposes semantics + validation only.

   THE MAPPING (verified against src/av_acid.js at P2 SHA bytes; line refs are that file):
     accent step  -> emitted gain 1.0 (§2 pin) AND the explicit accent flag (E decision,
                     verify/_e_wave.md section 1): av_seq_sched emits opts.acc = 1 for flagged
                     steps and opts.acc = 0 for the rest, and AVACID honours the explicit flag
                     when the voice carries one (av_acid.js initVoice predicate:
                     acc = (v.acc === 0 || v.acc === 1) ? v.acc : ((v.vel >= 0.8) ? 1 : 0)).
                     So for SEQUENCED notes the ACC column is authoritative at ANY velocity -
                     the old auto-accent at the core's default vel 0.8 is gone by decision. The
                     legacy `v.vel >= 0.8` threshold applies ONLY to flagless note-ons
                     (keyboard/MIDI/legacy avNoteDown); `avSeqAcidAccEnters` reports it.
                     Entry path: lazy cap discharge; charge kext.cap = cap+(1-cap)*0.5
                     (CAP_RISE); depth k.accAmt = acid.accent*(1+0.6*capBefore) (CAP_EXTRA;
                     acid.accent default 0.6); VCA k.ampBoost = 1+accAmt*1.5 (AMP_BOOST); fast
                     attack 0.0004 s + MEG decay forced to acid.accentDecay; resonance emphasis
                     x(1+accAmt*0.22) + sweep boost via the lagged `sw`. Consecutive accents
                     RISE (cap memory, T2 L82) - the P2 T3 run measured 0.273 < 0.310 < 0.316
                     < 0.342; ref: verify/p2-acid-node-out.log.
     slide step   -> the sched's (B) legato emission does the reorder (on(k+1) before off(k)); this
                     lane owns the glide WINDOW: `avSeqAcidSlideBegin()/End()` set `voice.glide` to
                     the 303 stock 0.06 s via the avApplyParam funnel during the pair and restore
                     the captured prior value after (default 0). Rationale: with eng.glide > 0 the
                     parent's noteOn starts v.pitch at eng.lastMidi (src/av_dsp.js L693) — the slide
                     origin survives voice steals; AVACID's held-voice scan (L221-230) is the primary
                     P2 law and needs no window call. The audible glide TIME for kind acid stays
                     module-owned `acid.slide` (cl 0.06..0.36, default 0.06 — T2 L103 "Normally the
                     slide time is 60 ms").
     oct step     -> step.oct in [-2..2] -> +-12/24 semitones. The PLANNER applies oct*12; this
                     module exposes/validates the shift (`avSeqAcidResolve().octShift`,
                     `avSeqAcidOctShift()`).

   LAWS (verify/_p2_wave.md §1 + _p4_wave.md §2/§5): "use strict"; ONE namespace
   (avSeqAcid* / AV_SEQ_ACID_*); never throws — refusals return false; NO DOM at load (every
   global/browser reach is `typeof`-guarded inside a function); deterministic (pure functions, no
   RNG); every committed value rides the avApplyParam funnel ('av-param' CustomEvent fallback,
   exactly the avKnobCommit shape — app_core.avApplyParam mirrors avParams and routes to the live
   engine); one writer per file.

   Public surface (classic-script globals, ONE namespace):
     avSeqAcidLane(kind?) -> descriptor | false   presence/active probe (§3.4)
     avSeqAcidColumns() -> [{key,label,kind,def,min?,max?}]   the three-column inventory
     avSeqAcidClasses() -> string[]               CSS classes this lane introduces
     avSeqAcidResolve(step) -> {gain,acc,slide,oct,octShift,...} | false   step -> engine params
     avSeqAcidValidateStep(step) -> bool          strict lane-field validation (refuses garbage)
     avSeqAcidColValue(col, v) -> bool            legal value per column (UI write guard)
     avSeqAcidCycleCol(col, cur, dir?) -> value | false   click-cycle semantics per column
     avSeqAcidOctShift(oct) -> semitones | false  the validated oct*12 the planner applies
     avSeqAcidAccEnters(gain) -> 0|1 | false      LEGACY AVACID entry predicate (vel >= 0.8);
                                                  sequenced notes use the explicit flag now
     avSeqAcidSlideBegin(label?) -> bool          arm the slide window (voice.glide := 0.06)
     avSeqAcidSlideEnd() -> bool                  release (restore captured prior; default 0)
     avSeqAcidSlideAbort() -> bool                force-restore + reset (panic safety)
     avSeqAcidSlideState() -> {armed,depth,prior,glide,active,...}   observable                */

"use strict";

const AV_SEQ_ACID_VERSION = "p4.0";
const AV_SEQ_ACID_KIND = "acid";

/* the three-column inventory (§3.4: the UI row switches to accent/slide/oct) */
const AV_SEQ_ACID_COLS = ["accent", "slide", "oct"];

/* UI hooks (pinned): row container + per-step cell */
const AV_SEQ_ACID_CLS_COLS = "av-seq-acid-cols";
const AV_SEQ_ACID_CLS_CELL = "av-seq-acid-cell";

/* accent law (§2 pin + E decision): an accent step emits gain 1.0 AND opts.acc = 1 (the step
   flag is authoritative for sequenced notes; verify/_e_wave.md section 1). ACC_VEL is the
   LEGACY engine entry threshold (vel >= 0.8) that still governs flagless note-ons and is what
   avSeqAcidAccEnters reports; it no longer decides sequenced-note accents. */
const AV_SEQ_ACID_ACCENT_GAIN = 1.0;
const AV_SEQ_ACID_ACC_VEL = 0.8;

/* slide window values (§3.4): set voice.glide to the 303 stock 60 ms during the pair
   (research/acid/T2-acid-heritage.md L103; acid.slide default/min 0.06) and restore the
   captured prior after — default 0 (av_synth defs "voice.glide": 0 / av_dsp eng.glide = 0) */
const AV_SEQ_ACID_GLIDE_PATH = "voice.glide";
const AV_SEQ_ACID_GLIDE_S = 0.06;
const AV_SEQ_ACID_GLIDE_RESTORE = 0;

/* step-model value ranges (verify/_p4_wave.md §3.1 step shape) */
const AV_SEQ_ACID_VEL_MIN = 0.05;
const AV_SEQ_ACID_VEL_MAX = 1;
const AV_SEQ_ACID_VEL_DEF = 0.8;
const AV_SEQ_ACID_OCT_MIN = -2;
const AV_SEQ_ACID_OCT_MAX = 2;
const AV_SEQ_ACID_OCT_SEMIS = 12;

/* ---------- small value laws (pure, never throw) ---------- */

function avSeqAcidClamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* canonical 0|1 from the step-model shapes (number 0/1 or boolean); null = invalid */
function avSeqAcidBool01(v) {
  if (v === 0 || v === false) return 0;
  if (v === 1 || v === true) return 1;
  return null;
}

/* STRICT finite number check without throwing: the type must be number — numeric strings are
   refused at the validation boundary (the core owns sanitising; the lane never coerces garbage). */
function avSeqAcidNumber(v) {
  return (typeof v === "number" && isFinite(v)) ? v : null;
}

/* ---------- engine kind resolution (guarded) ---------- */

/* live kind: explicit override (tests) -> avParams["engine.kind"] mirror -> "va" (engine default).
   avParams is the knob framework's mirror (src/av_knob.js); it is the same source av_synth's
   engine select commits into, so the probe tracks the SELECTED kind, not engine liveness. */
function avSeqAcidKind(kind) {
  try {
    if (typeof kind === "string" && kind.length > 0) return kind.toLowerCase();
    if (typeof avParams !== "undefined" && avParams && typeof avParams["engine.kind"] === "string") {
      return avParams["engine.kind"].toLowerCase();
    }
  } catch (e) { /* guarded */ }
  return "va";
}

/* ---------- §3.4 presence/active probe + UI metadata ---------- */

/* truthy descriptor when the lane is ACTIVE (engine kind = acid), false otherwise — the UI row
   can switch on the truthiness directly. */
function avSeqAcidLane(kind) {
  try {
    if (avSeqAcidKind(kind) !== AV_SEQ_ACID_KIND) return false;
    return {
      model: "avSeqAcid",
      v: AV_SEQ_ACID_VERSION,
      active: true,
      kind: AV_SEQ_ACID_KIND,
      cols: AV_SEQ_ACID_COLS.slice(),
      classes: { cols: AV_SEQ_ACID_CLS_COLS, cell: AV_SEQ_ACID_CLS_CELL },
      glide: AV_SEQ_ACID_GLIDE_S,
      accVel: AV_SEQ_ACID_ACC_VEL,
    };
  } catch (e) { return false; }
}

/* the three-column inventory (fresh copy every call; available regardless of kind) */
function avSeqAcidColumns() {
  return [
    { key: "accent", label: "ACC", kind: "toggle", def: 0 },
    { key: "slide", label: "SLD", kind: "toggle", def: 0 },
    { key: "oct", label: "OCT", kind: "cycle", def: 0, min: AV_SEQ_ACID_OCT_MIN, max: AV_SEQ_ACID_OCT_MAX },
  ];
}

/* the CSS class list this lane introduces (parent styles them; avModClasses idiom) */
function avSeqAcidClasses() { return [AV_SEQ_ACID_CLS_COLS, AV_SEQ_ACID_CLS_CELL]; }

/* ---------- per-column validation + cycle (the lane UI's write guard) ---------- */

function avSeqAcidColValue(col, v) {
  const c = String(col == null ? "" : col).toLowerCase();
  if (c === "accent" || c === "slide") return avSeqAcidBool01(v) !== null;
  if (c === "oct") {
    const n = avSeqAcidNumber(v);
    return n !== null && Math.floor(n) === n && n >= AV_SEQ_ACID_OCT_MIN && n <= AV_SEQ_ACID_OCT_MAX;
  }
  return false;
}

/* click-cycle semantics: accent/slide toggle 0<->1; oct steps by dir (+1 default) and CLAMPS at
   +-2 (the 303's octave switch is a range, not a ring). Refuses invalid `cur`/col with false. */
function avSeqAcidCycleCol(col, cur, dir) {
  const c = String(col == null ? "" : col).toLowerCase();
  if (c === "accent" || c === "slide") {
    if (avSeqAcidBool01(cur) === null) return false;
    return avSeqAcidBool01(cur) === 1 ? 0 : 1;
  }
  if (c === "oct") {
    const base = (cur === undefined || cur === null) ? 0 : cur;
    const n = avSeqAcidNumber(base);
    if (n === null || Math.floor(n) !== n || n < AV_SEQ_ACID_OCT_MIN || n > AV_SEQ_ACID_OCT_MAX) return false;
    let d = avSeqAcidNumber(dir);
    d = (d === null || d === 0) ? 1 : (d < 0 ? -1 : 1);
    return avSeqAcidClamp(n + d, AV_SEQ_ACID_OCT_MIN, AV_SEQ_ACID_OCT_MAX);
  }
  return false;
}

/* ---------- step -> engine-parameter mapping (the mapping table, as code) ---------- */

/* strict validation of the lane-relevant fields. Absent/null fields are legal (defaults apply);
   PRESENT fields must conform or the step is refused:
     accent / slide : 0 | 1 | true | false                      (step-model 0|1 booleans)
     oct            : number, integer in [-2..2]                (the 303 octave switch)
     vel            : number in [0.05..1]                       (gain law §2)
   Type-strict: numeric strings are refused (the core sanitises; the lane never coerces).
   Unknown extra fields are fine (the core model carries more than the lane reads). */
function avSeqAcidValidateStep(step) {
  try {
    if (!step || typeof step !== "object" || Array.isArray(step)) return false;
    if (step.accent !== undefined && step.accent !== null && avSeqAcidBool01(step.accent) === null) return false;
    if (step.slide !== undefined && step.slide !== null && avSeqAcidBool01(step.slide) === null) return false;
    if (step.oct !== undefined && step.oct !== null) {
      const o = avSeqAcidNumber(step.oct);
      if (o === null || Math.floor(o) !== o || o < AV_SEQ_ACID_OCT_MIN || o > AV_SEQ_ACID_OCT_MAX) return false;
    }
    if (step.vel !== undefined && step.vel !== null) {
      const v = avSeqAcidNumber(step.vel);
      if (v === null || v < AV_SEQ_ACID_VEL_MIN || v > AV_SEQ_ACID_VEL_MAX) return false;
    }
    return true;
  } catch (e) { return false; }
}

/* resolve one step to the values the emitter/planner uses. Refuses (false) anything that fails
   avSeqAcidValidateStep — the mapping never runs on garbage. */
function avSeqAcidResolve(step) {
  try {
    if (!avSeqAcidValidateStep(step)) return false;
    const accent = avSeqAcidBool01(step.accent) === 1 ? 1 : 0;
    const slide = avSeqAcidBool01(step.slide) === 1 ? 1 : 0;
    let oct = 0;
    if (step.oct !== undefined && step.oct !== null) oct = Number(step.oct);
    let vel = AV_SEQ_ACID_VEL_DEF;
    if (step.vel !== undefined && step.vel !== null) vel = Number(step.vel);
    vel = avSeqAcidClamp(vel, AV_SEQ_ACID_VEL_MIN, AV_SEQ_ACID_VEL_MAX);
    /* §2 pin: accent step => gain 1.0; otherwise the step's own velocity (gain law) */
    const gain = accent === 1 ? AV_SEQ_ACID_ACCENT_GAIN : vel;
    /* E decision: the entry the ENGINE takes for this sequenced step is the EXPLICIT flag
       (the scheduler emits opts.acc and AVACID honours it) - not the legacy vel rule. */
    const acc = accent;
    return {
      model: "avSeqAcid",
      v: AV_SEQ_ACID_VERSION,
      gain: gain,
      vel: vel,
      accent: accent,
      slide: slide,
      oct: oct,
      octShift: oct * AV_SEQ_ACID_OCT_SEMIS,   /* the planner applies this to the note */
      acc: acc,
      accVel: AV_SEQ_ACID_ACC_VEL,
    };
  } catch (e) { return false; }
}

/* oct -> semitone shift the planner applies (validated; refuse with false) */
function avSeqAcidOctShift(oct) {
  try {
    const o = avSeqAcidNumber(oct === undefined || oct === null ? 0 : oct);
    if (o === null || Math.floor(o) !== o || o < AV_SEQ_ACID_OCT_MIN || o > AV_SEQ_ACID_OCT_MAX) return false;
    return o * AV_SEQ_ACID_OCT_SEMIS;
  } catch (e) { return false; }
}

/* the LEGACY AVACID accent-entry predicate (v.vel >= 0.8), still mirrored from src/av_acid.js
   for the non-seq paths. E decision (verify/_e_wave.md section 1): SEQUENCED notes never run
   it - the scheduler emits the step's explicit accent flag (opts.acc 0|1) and the engine
   honours that. This helper keeps reporting the legacy predicate for GENERAL gain values
   (keyboard/MIDI/legacy note-ons; P2 numeric tests). 0|1 for a number gain; false for garbage. */
function avSeqAcidAccEnters(gain) {
  const g = avSeqAcidNumber(gain);
  if (g === null) return false;
  return g >= AV_SEQ_ACID_ACC_VEL ? 1 : 0;
}

/* ---------- the slide window (voice.glide during a slide pair) ---------- */

let avSeqAcidWindow = { depth: 0, armed: false, applied: false, prior: null };

/* avParams reach (guarded; av_knob.js owns it) */
function avSeqAcidParams() {
  try { if (typeof avParams !== "undefined" && avParams) return avParams; } catch (e) { /* guarded */ }
  return null;
}

/* commit one value through the app funnel (mirror first, then avApplyParam; the 'av-param'
   CustomEvent fallback is exactly the avKnobCommit shape). false when there is no sink at all. */
function avSeqAcidCommit(path, value, meta) {
  let wrote = false;
  const P = avSeqAcidParams();
  if (P) { try { P[path] = value; wrote = true; } catch (e) { /* frozen mirror */ } }
  let fn = null;
  try { if (typeof avApplyParam === "function") fn = avApplyParam; } catch (e) { /* guarded */ }
  if (fn === null) {
    try { if (typeof window !== "undefined" && window && typeof window.avApplyParam === "function") fn = window.avApplyParam; } catch (e) { /* guarded */ }
  }
  if (fn !== null) {
    try { if (fn(path, value, meta || { from: "seq-acid" }) === true) return true; } catch (e) { /* funnel refused */ }
    return wrote;
  }
  try {
    if (typeof window !== "undefined" && window && typeof window.dispatchEvent === "function" &&
        typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("av-param", { detail: { path: path, value: value, from: "seq-acid" } }));
      wrote = true;
    }
  } catch (e) { /* no fan-out */ }
  return wrote;
}

/* arm the slide window: set voice.glide to the 303 stock 60 ms while a slide pair is emitted.
   Refused (false) when the lane is not active, when there is no sink, or the set fails. */
function avSeqAcidSlideBegin(label) {
  try {
    if (!avSeqAcidLane()) return false;
    if (avSeqAcidWindow.depth === 0) {
      const P = avSeqAcidParams();
      let prior = AV_SEQ_ACID_GLIDE_RESTORE;
      if (P) {
        const cur = P[AV_SEQ_ACID_GLIDE_PATH];
        if (typeof cur === "number" && isFinite(cur)) prior = cur;
      }
      const ok = avSeqAcidCommit(AV_SEQ_ACID_GLIDE_PATH, AV_SEQ_ACID_GLIDE_S,
        { from: "seq-acid", slide: true, label: (typeof label === "string" ? label : "") });
      if (!ok) return false;
      avSeqAcidWindow.prior = prior;
      avSeqAcidWindow.applied = true;
    }
    avSeqAcidWindow.depth++;
    avSeqAcidWindow.armed = true;
    return true;
  } catch (e) { return false; }
}

/* release the slide window; the LAST end restores the captured prior value (default 0). */
function avSeqAcidSlideEnd() {
  try {
    if (avSeqAcidWindow.depth <= 0) return false;
    avSeqAcidWindow.depth--;
    if (avSeqAcidWindow.depth > 0) return true;
    let ok = true;
    if (avSeqAcidWindow.applied) {
      const prior = (typeof avSeqAcidWindow.prior === "number" && isFinite(avSeqAcidWindow.prior))
        ? avSeqAcidWindow.prior : AV_SEQ_ACID_GLIDE_RESTORE;
      ok = avSeqAcidCommit(AV_SEQ_ACID_GLIDE_PATH, prior,
        { from: "seq-acid", slide: false, restore: true }) === true;
    }
    avSeqAcidWindow.armed = false;
    avSeqAcidWindow.applied = false;
    avSeqAcidWindow.prior = null;
    return ok;
  } catch (e) { return false; }
}

/* panic safety: force-restore + reset, even mid-pair / after a dropped End. */
function avSeqAcidSlideAbort() {
  try {
    const applied = avSeqAcidWindow.applied;
    let ok = true;
    if (applied) {
      const prior = (typeof avSeqAcidWindow.prior === "number" && isFinite(avSeqAcidWindow.prior))
        ? avSeqAcidWindow.prior : AV_SEQ_ACID_GLIDE_RESTORE;
      ok = avSeqAcidCommit(AV_SEQ_ACID_GLIDE_PATH, prior,
        { from: "seq-acid", slide: false, abort: true }) === true;
    }
    avSeqAcidWindow.depth = 0;
    avSeqAcidWindow.armed = false;
    avSeqAcidWindow.applied = false;
    avSeqAcidWindow.prior = null;
    return applied ? ok : false;
  } catch (e) { return false; }
}

/* observable for the rig/UI */
function avSeqAcidSlideState() {
  const P = avSeqAcidParams();
  let glide = null;
  if (P) {
    const g = P[AV_SEQ_ACID_GLIDE_PATH];
    if (typeof g === "number" && isFinite(g)) glide = g;
  }
  return {
    model: "avSeqAcid",
    v: AV_SEQ_ACID_VERSION,
    active: !!avSeqAcidLane(),
    armed: avSeqAcidWindow.armed,
    depth: avSeqAcidWindow.depth,
    applied: avSeqAcidWindow.applied,
    prior: avSeqAcidWindow.prior,
    path: AV_SEQ_ACID_GLIDE_PATH,
    value: AV_SEQ_ACID_GLIDE_S,
    restore: AV_SEQ_ACID_GLIDE_RESTORE,
    glide: glide,
  };
}
