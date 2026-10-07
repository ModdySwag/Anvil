/* av_seq_core.js — Anvil P4 sequencer CORE (child A): the step-object + pattern model, 4 tracks,
   chains, song rows, scenes, sanitised serialisation (import/export + LS), and the seeded
   generators. Contract: verify/_p4_wave.md §3.1 (+ §2 global pins, §4 pinned file format); the
   model shape follows research/groovebox/T3-groovebox-sequencing.md (DELIVERABLE B/C) with the
   wave's v1 cuts. This file is the sequencer's single source of truth; every snap/load is a fresh
   deep copy (detachment is the contract).

   LAWS (do not drift):
   - "use strict"; ONE top-level namespace (avSeq* / AV_SEQ_*); never throws (garbage in => false /
     cleared value out); NO DOM reach-ins at load — the only top-level browser touch is the guarded
     `typeof window` boot probe at the end; the file loads in plain node with zero browser deps.
   - model: pattern = {v:1, name, bpm 20..300, grid "16"|"8t", swing 50..80, tracks[4], plocks[],
     rng} · track = {len 1..64, speed 0.25|0.5|0.75|1|1.5|2|4, swing 0=inherit|50..80, mute 0|1, steps[64 full step objects]} ·
     step = {on 0|1, note ("avNoteParse"/"avNoteName" canonical, c4=60, fallback grammar mirrored),
     vel 0.05..1, gate 0.05..1, slide 0|1, accent 0|1, oct -2..2, prob 0..100,
     cond ""|"fill"|"a:b"|"first"|"!first" (a,b 1..8), ratchet 1..4, micro -12..12 ticks} ·
     plock = {path (free text ≤64, E owns the v1 list), interp "step"|"lin",
     steps {"<idx 0..63>": number}} (E owns the rules; the core carries the container).
   - steps are FULL 64-length arrays of full step objects (wave §3.1 `step×64`); `len` selects the
     loop. Sanitisation is idempotent: sanitise(sanitise(x)) == sanitise(x); export === stringify
     (snap) with the pinned §4 key order; export -> import -> snap is deep-equal and export is
     byte-stable across the round trip.
   - RNG: xorshift32, constants 13/17/5 (same as the engine av_dsp prngU32); a zero seed is a
     degenerate stream and is remapped to 0x12345678. Generators are deterministic — same seed +
     same state => same output; draw orders are pinned below per generator.
   - song rows adopt T3 §4 (Digitakt song mode): {ref, repeats 1..256, mutes[4], len 0=inherit
     2..1024, tempo 0=inherit 20..300, label ≤16}, cap 99 rows. Chains adopt T3 §7/§C option 1:
     per-track ordered pattern-ref lists, cap 64 entries/track. Scenes adopt T3 §6/§C option 3:
     16 slots {name, tracks:[{ref, mute} x4]}; v1 has one pattern bank, so a scene's ref records
     the live pattern name and recall applies the mute snapshot (refs resolve when a bank lands).
   - LS keys (JSON; load-on-boot best-effort): av-seq-pattern / av-seq-chains / av-seq-song /
     av-seq-scenes. avSeqSaveLocal()/avSeqLoadLocal() are the bridge (extras; C/parent may call).

   Public surface (classic-script globals):
     avSeqDefaults() -> pattern                 fresh default pattern (deep, never shared)
     avSeqSnap() -> pattern                     fresh deep copy of the live pattern
     avSeqLoad(obj) -> bool                     sanitising load (caps, clamps, drops unknown)
     avSeqPatternExport() -> JSON string        the pinned §4 file format (minified)
     avSeqPatternImport(str) -> bool            JSON text -> avSeqLoad
     avSeqChainsSnap() -> {v,chains}            avSeqChainsLoad(obj) -> bool
     avSeqSongSnap() -> {v,rows}                avSeqSongLoad(obj) -> bool
     avSeqSceneCapture(name)/avSeqSceneRecall(name) -> bool
     avSeqScenesSnap() -> {v,scenes}            avSeqScenesLoad(obj) -> bool (extra)
     avSeqEuclid({len,pulses,rotate}) -> steps[]  0|1 mask, len entries
     avSeqMutate(seed, amount) -> bool          hit re-placement, count preserved (law below)
     avSeqHumanize(seed, amount) -> bool        micro/gate/vel nudge, ranges held (law below)
     avSeqFill(id) -> bool                      named deterministic 16-step fills
     avSeqFillIds() -> string[]                 the pinned fill ids
     avSeqStepGet(track, i) -> step|null        avSeqStepSet(track, i, patch) -> bool  (extras: C/G)
     avSeqSaveLocal()/avSeqLoadLocal() -> bool  avSeqLsKeys() -> [4 keys]              (extras: LS)
     AV_SEQ_VERSION, AV_SEQ_LS_*, AV_SEQ_TRACKS, AV_SEQ_STEPS, AV_SEQ_SPEEDS, AV_SEQ_GRIDS,
     AV_SEQ_CONDITIONS, AV_SEQ_FILL_IDS, AV_SEQ_DEF_RNG + the clamp pins below.

   GENERATOR LAWS (v1, pinned):
   - euclid: len 1..64 (dflt 16), pulses 0..len (dflt 4), rotate 0..len-1 (dflt 0). Mask law
     ((i*pulses) mod len) < pulses, then out[(i+rotate) mod len] = mask[i]; count == pulses and
     the gaps vary by <= 1 (Bjorklund-equivalent). Non-object input refuses with [].
   - mutate: per track, hits = sorted indices of on-steps in 0..len-1, N = count; M =
     round(N*amount); the highest M hits are re-placed onto M distinct positions drawn (partial
     Fisher-Yates, one rng draw per landing, in landing order) from {0..len-1} minus the kept
     (lowest N-M) hits; the moved payloads travel in ascending landing order; vacated slots reset
     to the default step; count/notes ('sounds') preserved; amount clamps 0..1 (0 = no-op);
     seed/amount must be finite numbers (else false).
   - humanize: per ON-step in track order 0..3, step order 0..len-1, exactly 3 draws in pinned
     order (u1 micro, u2 gate, u3 vel): micro += round((u1*2-1) * 12 * amount) clamped ±12;
     gate *= 1 + (u2*2-1) * 0.5 * amount; vel *= 1 + (u3*2-1) * 0.5 * amount; gate/vel clamped
     0.05..1. Never touches on/note/cond/prob/slide/accent/oct/ratchet.
   - fill: ids kick/snare/hat/beat/techno/break/euclid/random/clear. Every track named by the id's
     mask is cleared first (on=0, 0..len-1) then its hits set=1; other fields untouched; steps
     beyond len are never written. 'random' draws (rng % 100 < 50) per cell for all 4 tracks from
     the pattern rng field and writes the advanced state back (seeded/deterministic). */

"use strict";

/* ---------- version + pins ---------- */
const AV_SEQ_VERSION = "p4.0";

/* LS keys (§3.1; JSON, load-on-boot best-effort) */
const AV_SEQ_LS_PATTERN = "av-seq-pattern";
const AV_SEQ_LS_CHAINS = "av-seq-chains";
const AV_SEQ_LS_SONG = "av-seq-song";
const AV_SEQ_LS_SCENES = "av-seq-scenes";

const AV_SEQ_TRACKS = 4;              /* §2: 4 tracks                */
const AV_SEQ_STEPS = 64;              /* §2/§3.1: up to 64 steps     */
const AV_SEQ_LEN_MIN = 1;
const AV_SEQ_LEN_MAX = 64;
const AV_SEQ_LEN_DEF = 16;
const AV_SEQ_SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];   /* M2 polyrhythm ratios: +3/4, +3/2 */
const AV_SEQ_BPM_MIN = 20;            /* §6: avState.bpm clamp 20..300 */
const AV_SEQ_BPM_MAX = 300;
const AV_SEQ_BPM_DEF = 120;
const AV_SEQ_GRIDS = ["16", "8t"];    /* §2: 16ths | 8th-triplets (12 steps/bar) */
const AV_SEQ_GRID_DEF = "16";
const AV_SEQ_SWING_MIN = 50;          /* §2: S ∈ [50,80], dflt 66 */
const AV_SEQ_SWING_MAX = 80;
const AV_SEQ_SWING_DEF = 66;
const AV_SEQ_VEL_MIN = 0.05;          /* §2: velocity/gain 0.05..1 */
const AV_SEQ_VEL_MAX = 1;
const AV_SEQ_VEL_DEF = 0.8;
const AV_SEQ_GATE_MIN = 0.05;         /* §2: gate 0.05..1 f of the step */
const AV_SEQ_GATE_MAX = 1;
const AV_SEQ_GATE_DEF = 0.95;
const AV_SEQ_OCT_MIN = -2;            /* §3.4: octave ±1..2 => ±12/24 st */
const AV_SEQ_OCT_MAX = 2;
const AV_SEQ_PROB_MIN = 0;            /* §2: probability 0..100 */
const AV_SEQ_PROB_MAX = 100;
const AV_SEQ_PROB_DEF = 100;
const AV_SEQ_RATCHET_MIN = 1;         /* §2: integer count 1..4 sub-hits */
const AV_SEQ_RATCHET_MAX = 4;
const AV_SEQ_RATCHET_DEF = 1;
const AV_SEQ_MICRO_MIN = -12;         /* §2: micro ±12 ticks (tick = stepDur/24) */
const AV_SEQ_MICRO_MAX = 12;
const AV_SEQ_MICRO_DEF = 0;
const AV_SEQ_NOTE_DEF = "c4";         /* §2: c4 = 60, A4 = 69 */
const AV_SEQ_NAME_DEF = "PAT 1";
const AV_SEQ_NAME_CAP = 24;           /* pattern/scene/chain-ref name cap (agree: refs resolve) */
const AV_SEQ_LABEL_CAP = 16;          /* song row label cap */
const AV_SEQ_PATH_CAP = 64;           /* plock path cap (free text; E validates) */
const AV_SEQ_PLOCK_CAP = 64;          /* plock lanes per pattern */
const AV_SEQ_CHAIN_CAP = 64;          /* chain entries per track */
const AV_SEQ_SONG_CAP = 99;           /* T3 §4: up to 99 rows/song */
const AV_SEQ_SONG_REPEAT_MAX = 256;
const AV_SEQ_ROW_LEN_MIN = 2;         /* T3 §4: row length steps 2..1024 (0 = inherit) */
const AV_SEQ_ROW_LEN_MAX = 1024;
const AV_SEQ_SCENE_CAP = 16;          /* T3 §6: 16 scene slots */
const AV_SEQ_DEF_RNG = 305419896;     /* §4: 0x12345678 — default pattern RNG seed */
const AV_SEQ_CONDITIONS = ["", "fill", "first", "!first"];   /* "a:b" (1..8:1..8) is the 5th form */
const AV_SEQ_FILL_IDS = ["kick", "snare", "hat", "beat", "techno", "break", "euclid", "random", "clear"];

/* fill masks: id -> { trackIndex: [hit positions] } — the tracks listed are cleared then set;
   tracks absent from the map stay untouched. 16 steps (T3 §11 "16 steps only"). */
const AV_SEQ_FILLS = {
  kick:   { 0: [0, 4, 8, 12] },
  snare:  { 1: [4, 12] },
  hat:    { 2: [0, 2, 4, 6, 8, 10, 12, 14] },
  beat:   { 0: [0, 4, 8, 12], 1: [4, 12], 2: [0, 2, 4, 6, 8, 10, 12, 14] },
  techno: { 0: [0, 4, 8, 12], 1: [4, 12], 2: [2, 6, 10, 14] },
  break:  { 0: [0, 6, 10], 1: [4, 11, 14], 2: [0, 2, 4, 6, 8, 10, 12, 14] },
  euclid: { 0: [0, 4, 7, 10, 13] },
  clear:  { 0: [], 1: [], 2: [], 3: [] },
};

const avSeqHas = Object.prototype.hasOwnProperty;

/* ---------- small value laws (sanitisation primitives) ---------- */

function avSeqClamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* finite number clamped; null/""/non-finite -> default */
function avSeqNum(v, lo, hi, dflt) {
  if (v == null || v === "") return dflt;
  const n = Number(v);
  if (!isFinite(n)) return dflt;
  return avSeqClamp(n, lo, hi);
}

/* rounded finite number clamped; null/""/non-finite -> default */
function avSeqInt(v, lo, hi, dflt) {
  if (v == null || v === "") return dflt;
  const n = Number(v);
  if (!isFinite(n)) return dflt;
  return avSeqClamp(Math.round(n), lo, hi);
}

/* 0|1: 1/true/"1" => 1; 0/false/"0"/null => 0; other finite numbers clamp-round (5 => 1);
   non-numeric garbage => 0 */
function avSeqBit(v) {
  if (v === 1 || v === true || v === "1") return 1;
  if (v == null || v === 0 || v === false || v === "0") return 0;
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return avSeqClamp(Math.round(n), 0, 1);
}

/* string/number only; controls stripped, trimmed, capped; -> dflt when empty/invalid */
function avSeqText(v, cap, dflt) {
  if (typeof v === "number") {
    if (!isFinite(v)) return dflt;
    v = String(v);
  }
  if (typeof v !== "string") return dflt;
  let s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (s.length > cap) s = s.slice(0, cap);
  return s.length ? s : dflt;
}

/* note canonicalisation: page -> avNoteParse/avNoteName; plain node -> the mirrored grammar
   (identical regex + name table; harness proves parity) */
function avSeqNoteParseLocal(name) {
  const m = /^([a-g])(#?)(-?\d+)$/.exec(name);
  if (!m) return null;
  const pc = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1]];
  return (Number(m[3]) + 1) * 12 + pc + (m[2] ? 1 : 0);
}
function avSeqNoteNameLocal(midi) {
  const m = Math.round(Number(midi));
  if (!isFinite(m)) return "";
  const names = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
  return names[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}
function avSeqNoteCanon(note) {
  let midi = null;
  if (typeof note === "number" && isFinite(note)) {
    midi = Math.round(note);
  } else {
    const s = String(note == null ? "" : note).trim().toLowerCase();
    if (typeof avNoteParse === "function") {
      const m = avNoteParse(s);
      if (m != null) midi = m;
    } else {
      midi = avSeqNoteParseLocal(s);
    }
  }
  if (midi == null || !isFinite(midi)) return AV_SEQ_NOTE_DEF;
  if (typeof avNoteName === "function") {
    const nm = avNoteName(midi);
    if (nm) return nm;
  }
  return avSeqNoteNameLocal(midi) || AV_SEQ_NOTE_DEF;
}

/* cond: "" | "fill" | "first" | "!first" | "a:b" (a,b 1..8); unknown -> "" */
function avSeqCondNorm(cond) {
  const s = (typeof cond === "string") ? cond.trim().toLowerCase() : "";
  if (s === "fill" || s === "first" || s === "!first") return s;
  const m = /^([1-8]):([1-8])$/.exec(s);
  if (m) return m[1] + ":" + m[2];
  return "";
}

function avSeqSpeedNorm(v) {
  const n = Number(v);
  for (let i = 0; i < AV_SEQ_SPEEDS.length; i++) if (n === AV_SEQ_SPEEDS[i]) return AV_SEQ_SPEEDS[i];
  return 1;
}

/* M2: per-track swing override -- 0 = inherit the pattern swing; else 50..80 */
function avSeqSwingNorm(v) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return 0;
  return avSeqInt(n, AV_SEQ_SWING_MIN, AV_SEQ_SWING_MAX, 0);
}

/* ---------- step / track / pattern construction (pinned key order) ---------- */

function avSeqStepDefault() {
  return { on: 0, note: AV_SEQ_NOTE_DEF, vel: AV_SEQ_VEL_DEF, gate: AV_SEQ_GATE_DEF,
           slide: 0, accent: 0, oct: 0, prob: AV_SEQ_PROB_DEF, cond: "", ratchet: AV_SEQ_RATCHET_DEF,
           micro: AV_SEQ_MICRO_DEF };
}

function avSeqStepCopy(s) {
  return { on: s.on, note: s.note, vel: s.vel, gate: s.gate, slide: s.slide, accent: s.accent,
           oct: s.oct, prob: s.prob, cond: s.cond, ratchet: s.ratchet, micro: s.micro };
}

function avSeqStepNorm(src) {
  const o = (src && typeof src === "object" && !Array.isArray(src)) ? src : null;
  if (!o) return avSeqStepDefault();
  return {
    on: avSeqBit(o.on),
    note: avSeqNoteCanon(o.note),
    vel: avSeqNum(o.vel, AV_SEQ_VEL_MIN, AV_SEQ_VEL_MAX, AV_SEQ_VEL_DEF),
    gate: avSeqNum(o.gate, AV_SEQ_GATE_MIN, AV_SEQ_GATE_MAX, AV_SEQ_GATE_DEF),
    slide: avSeqBit(o.slide),
    accent: avSeqBit(o.accent),
    oct: avSeqInt(o.oct, AV_SEQ_OCT_MIN, AV_SEQ_OCT_MAX, 0),
    prob: avSeqInt(o.prob, AV_SEQ_PROB_MIN, AV_SEQ_PROB_MAX, AV_SEQ_PROB_DEF),
    cond: avSeqCondNorm(o.cond),
    ratchet: avSeqInt(o.ratchet, AV_SEQ_RATCHET_MIN, AV_SEQ_RATCHET_MAX, AV_SEQ_RATCHET_DEF),
    micro: avSeqInt(o.micro, AV_SEQ_MICRO_MIN, AV_SEQ_MICRO_MAX, AV_SEQ_MICRO_DEF),
  };
}

function avSeqTrackDefault() {
  const steps = [];
  for (let i = 0; i < AV_SEQ_STEPS; i++) steps.push(avSeqStepDefault());
  return { len: AV_SEQ_LEN_DEF, speed: 1, swing: 0, mute: 0, steps: steps };
}

function avSeqTrackNorm(src) {
  const o = (src && typeof src === "object" && !Array.isArray(src)) ? src : null;
  const srcSteps = (o && Array.isArray(o.steps)) ? o.steps : null;
  const steps = [];
  const n = srcSteps ? Math.min(AV_SEQ_STEPS, srcSteps.length) : 0;
  for (let i = 0; i < n; i++) steps.push(avSeqStepNorm(srcSteps[i]));
  while (steps.length < AV_SEQ_STEPS) steps.push(avSeqStepDefault());
  return {
    len: avSeqInt(o ? o.len : undefined, AV_SEQ_LEN_MIN, AV_SEQ_LEN_MAX, AV_SEQ_LEN_DEF),
    speed: avSeqSpeedNorm(o ? o.speed : undefined),
    swing: avSeqSwingNorm(o ? o.swing : 0),
    mute: avSeqBit(o ? o.mute : 0),
    steps: steps,
  };
}

function avSeqTrackCopy(tr) {
  const steps = [];
  for (let i = 0; i < tr.steps.length; i++) steps.push(avSeqStepCopy(tr.steps[i]));
  return { len: tr.len, speed: tr.speed, swing: tr.swing, mute: tr.mute, steps: steps };
}

/* plock container (E owns rules; the core carries + sanitises the shape) */
function avSeqPlockNorm(src) {
  const o = (src && typeof src === "object" && !Array.isArray(src)) ? src : null;
  if (!o) return null;
  const path = avSeqText(o.path, AV_SEQ_PATH_CAP, "");
  if (!path) return null;
  const interp = (o.interp === "lin") ? "lin" : "step";
  const steps = {};
  const srcSteps = (o.steps && typeof o.steps === "object" && !Array.isArray(o.steps)) ? o.steps : null;
  if (srcSteps) {
    for (const k in srcSteps) {
      if (!avSeqHas.call(srcSteps, k)) continue;
      const idx = Number(k);
      if (!isFinite(idx) || idx !== Math.round(idx) || idx < 0 || idx >= AV_SEQ_STEPS) continue;
      const v = Number(srcSteps[k]);
      if (!isFinite(v)) continue;
      steps[String(idx)] = v;
    }
  }
  return { path: path, interp: interp, steps: steps };
}

function avSeqPlockCopy(p) {
  const steps = {};
  for (const k in p.steps) steps[k] = p.steps[k];
  return { path: p.path, interp: p.interp, steps: steps };
}

/* the §3.1 model object; garbage (non-object / foreign version) -> null */
function avSeqPatternNorm(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  if (obj.v != null && Number(obj.v) !== 1) return null;
  const srcTracks = Array.isArray(obj.tracks) ? obj.tracks : [];
  const tracks = [];
  for (let t = 0; t < AV_SEQ_TRACKS; t++) tracks.push(avSeqTrackNorm(srcTracks[t]));
  const plocks = [];
  const srcPlocks = Array.isArray(obj.plocks) ? obj.plocks : [];
  for (let i = 0; i < srcPlocks.length && plocks.length < AV_SEQ_PLOCK_CAP; i++) {
    const p = avSeqPlockNorm(srcPlocks[i]);
    if (p) plocks.push(p);
  }
  let rng = AV_SEQ_DEF_RNG;
  if (obj.rng != null) {
    const n = Number(obj.rng);
    if (isFinite(n)) rng = (n >>> 0) || AV_SEQ_DEF_RNG;   /* xorshift32 state 0 is degenerate */
  }
  return {
    v: 1,
    name: avSeqText(obj.name, AV_SEQ_NAME_CAP, AV_SEQ_NAME_DEF),
    bpm: avSeqInt(obj.bpm, AV_SEQ_BPM_MIN, AV_SEQ_BPM_MAX, AV_SEQ_BPM_DEF),
    grid: (obj.grid === "8t") ? "8t" : AV_SEQ_GRID_DEF,
    swing: avSeqInt(obj.swing, AV_SEQ_SWING_MIN, AV_SEQ_SWING_MAX, AV_SEQ_SWING_DEF),
    tracks: tracks,
    plocks: plocks,
    rng: rng,
  };
}

function avSeqPatternCopy(src) {
  const tracks = [];
  for (let t = 0; t < src.tracks.length; t++) tracks.push(avSeqTrackCopy(src.tracks[t]));
  const plocks = [];
  for (let i = 0; i < src.plocks.length; i++) plocks.push(avSeqPlockCopy(src.plocks[i]));
  return { v: 1, name: src.name, bpm: src.bpm, grid: src.grid, swing: src.swing,
           tracks: tracks, plocks: plocks, rng: src.rng };
}

/* ---------- the live model (single source of truth) ---------- */

let avSeqPattern = avSeqPatternNorm({});
let avSeqChainsState = { v: 1, chains: [[], [], [], []] };
let avSeqSongState = { v: 1, rows: [] };
let avSeqScenesState = { v: 1, scenes: [] };

/* ---------- pattern API (§3.1) ---------- */

function avSeqDefaults() { return avSeqPatternNorm({}); }

function avSeqSnap() { return avSeqPatternCopy(avSeqPattern); }

function avSeqLoad(obj) {
  try {
    const p = avSeqPatternNorm(obj);
    if (!p) return false;
    avSeqPattern = p;
    return true;
  } catch (e) { return false; }
}

function avSeqPatternExport() {
  try { return JSON.stringify(avSeqPatternCopy(avSeqPattern)); } catch (e) { return ""; }
}

function avSeqPatternImport(str) {
  if (typeof str !== "string") return false;
  let obj;
  try { obj = JSON.parse(str); } catch (e) { return false; }
  return avSeqLoad(obj);
}

/* ---------- step helpers (extras: C grid edits / G recording) ---------- */

function avSeqStepGet(track, i) {
  try {
    const ti = Math.round(Number(track)), si = Math.round(Number(i));
    if (!isFinite(ti) || !isFinite(si)) return null;
    if (ti < 0 || ti >= AV_SEQ_TRACKS || si < 0 || si >= AV_SEQ_STEPS) return null;
    return avSeqStepCopy(avSeqPattern.tracks[ti].steps[si]);
  } catch (e) { return null; }
}

/* partial patch: only present keys are applied (each sanitised); unknown keys dropped */
function avSeqStepSet(track, i, patch) {
  try {
    const ti = Math.round(Number(track)), si = Math.round(Number(i));
    if (!isFinite(ti) || !isFinite(si)) return false;
    if (ti < 0 || ti >= AV_SEQ_TRACKS || si < 0 || si >= AV_SEQ_STEPS) return false;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
    const s = avSeqPattern.tracks[ti].steps[si];
    if (avSeqHas.call(patch, "on")) s.on = avSeqBit(patch.on);
    if (avSeqHas.call(patch, "note")) s.note = avSeqNoteCanon(patch.note);
    if (avSeqHas.call(patch, "vel")) s.vel = avSeqNum(patch.vel, AV_SEQ_VEL_MIN, AV_SEQ_VEL_MAX, s.vel);
    if (avSeqHas.call(patch, "gate")) s.gate = avSeqNum(patch.gate, AV_SEQ_GATE_MIN, AV_SEQ_GATE_MAX, s.gate);
    if (avSeqHas.call(patch, "slide")) s.slide = avSeqBit(patch.slide);
    if (avSeqHas.call(patch, "accent")) s.accent = avSeqBit(patch.accent);
    if (avSeqHas.call(patch, "oct")) s.oct = avSeqInt(patch.oct, AV_SEQ_OCT_MIN, AV_SEQ_OCT_MAX, s.oct);
    if (avSeqHas.call(patch, "prob")) s.prob = avSeqInt(patch.prob, AV_SEQ_PROB_MIN, AV_SEQ_PROB_MAX, s.prob);
    if (avSeqHas.call(patch, "cond")) s.cond = avSeqCondNorm(patch.cond);
    if (avSeqHas.call(patch, "ratchet")) s.ratchet = avSeqInt(patch.ratchet, AV_SEQ_RATCHET_MIN, AV_SEQ_RATCHET_MAX, s.ratchet);
    if (avSeqHas.call(patch, "micro")) s.micro = avSeqInt(patch.micro, AV_SEQ_MICRO_MIN, AV_SEQ_MICRO_MAX, s.micro);
    return true;
  } catch (e) { return false; }
}

/* ---------- chains (§3.1 / T3 §7 + §C option 1): per-track ordered pattern refs ---------- */

function avSeqChainNorm(src) {
  const out = [];
  if (Array.isArray(src)) {
    for (let i = 0; i < src.length && out.length < AV_SEQ_CHAIN_CAP; i++) {
      const s = avSeqText(src[i], AV_SEQ_NAME_CAP, "");
      if (s) out.push(s);
    }
  }
  return out;
}

function avSeqChainsSnap() {
  const out = [];
  for (let t = 0; t < AV_SEQ_TRACKS; t++) out.push(avSeqChainsState.chains[t].slice());
  return { v: 1, chains: out };
}

function avSeqChainsLoad(obj) {
  try {
    let arr = null;
    if (Array.isArray(obj)) arr = obj;
    else if (obj && typeof obj === "object") {
      if (obj.v != null && Number(obj.v) !== 1) return false;
      arr = Array.isArray(obj.chains) ? obj.chains : [];
    } else return false;
    const out = [];
    for (let t = 0; t < AV_SEQ_TRACKS; t++) out.push(avSeqChainNorm(arr[t]));
    avSeqChainsState = { v: 1, chains: out };
    return true;
  } catch (e) { return false; }
}

/* ---------- song rows (§3.1 / T3 §4 song mode) ---------- */

function avSeqSongLen(v) {
  if (v == null || v === "") return 0;
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return 0;
  return avSeqInt(n, AV_SEQ_ROW_LEN_MIN, AV_SEQ_ROW_LEN_MAX, 0);
}

function avSeqSongTempo(v) {
  if (v == null || v === "") return 0;
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return 0;
  return avSeqInt(n, AV_SEQ_BPM_MIN, AV_SEQ_BPM_MAX, 0);
}

function avSeqRowNorm(src) {
  const o = (src && typeof src === "object" && !Array.isArray(src)) ? src : null;
  if (!o) return null;
  const ref = avSeqText(o.ref != null ? o.ref : (o.pattern != null ? o.pattern : o.patternRef),
                        AV_SEQ_NAME_CAP, "");
  if (!ref) return null;
  const srcM = Array.isArray(o.mutes) ? o.mutes : [];
  const mutes = [];
  for (let t = 0; t < AV_SEQ_TRACKS; t++) mutes.push(avSeqBit(srcM[t]));
  return {
    ref: ref,
    repeats: avSeqInt(o.repeats, 1, AV_SEQ_SONG_REPEAT_MAX, 1),
    mutes: mutes,
    len: avSeqSongLen(o.len),
    tempo: avSeqSongTempo(o.tempo),
    label: avSeqText(o.label, AV_SEQ_LABEL_CAP, ""),
  };
}

function avSeqSongSnap() {
  const rows = [];
  for (let i = 0; i < avSeqSongState.rows.length; i++) {
    const r = avSeqSongState.rows[i];
    rows.push({ ref: r.ref, repeats: r.repeats, mutes: r.mutes.slice(), len: r.len,
                tempo: r.tempo, label: r.label });
  }
  return { v: 1, rows: rows };
}

function avSeqSongLoad(obj) {
  try {
    let arr = null;
    if (Array.isArray(obj)) arr = obj;
    else if (obj && typeof obj === "object") {
      if (obj.v != null && Number(obj.v) !== 1) return false;
      arr = Array.isArray(obj.rows) ? obj.rows : [];
    } else return false;
    const rows = [];
    for (let i = 0; i < arr.length && rows.length < AV_SEQ_SONG_CAP; i++) {
      const r = avSeqRowNorm(arr[i]);
      if (r) rows.push(r);
    }
    avSeqSongState = { v: 1, rows: rows };
    return true;
  } catch (e) { return false; }
}

/* ---------- scenes (§3.1 / T3 §6 + §C option 3): 16 slots {name, tracks:[{ref,mute} x4]} ---------- */

function avSeqSceneNorm(src) {
  const o = (src && typeof src === "object" && !Array.isArray(src)) ? src : null;
  if (!o) return null;
  const name = avSeqText(o.name, AV_SEQ_NAME_CAP, "");
  if (!name) return null;
  const srcTracks = Array.isArray(o.tracks) ? o.tracks : [];
  const tracks = [];
  for (let t = 0; t < AV_SEQ_TRACKS; t++) {
    const st = (srcTracks[t] && typeof srcTracks[t] === "object" && !Array.isArray(srcTracks[t]))
      ? srcTracks[t] : null;
    tracks.push({ ref: st ? avSeqText(st.ref, AV_SEQ_NAME_CAP, "") : "", mute: st ? avSeqBit(st.mute) : 0 });
  }
  return { name: name, tracks: tracks };
}

function avSeqSceneCopy(sc) {
  const tracks = [];
  for (let t = 0; t < sc.tracks.length; t++) tracks.push({ ref: sc.tracks[t].ref, mute: sc.tracks[t].mute });
  return { name: sc.name, tracks: tracks };
}

function avSeqSceneCapture(name) {
  try {
    const nm = avSeqText(name, AV_SEQ_NAME_CAP, "");
    if (!nm) return false;
    const tracks = [];
    for (let t = 0; t < AV_SEQ_TRACKS; t++) {
      tracks.push({ ref: avSeqPattern.name, mute: avSeqPattern.tracks[t].mute });
    }
    const entry = { name: nm, tracks: tracks };
    const scenes = avSeqScenesState.scenes;
    for (let i = 0; i < scenes.length; i++) {
      if (scenes[i].name === nm) { scenes[i] = entry; return true; }   /* recapture overwrites */
    }
    if (scenes.length >= AV_SEQ_SCENE_CAP) return false;
    scenes.push(entry);
    return true;
  } catch (e) { return false; }
}

/* v1: one pattern bank — recall applies the mute snapshot (refs recorded for future banks) */
function avSeqSceneRecall(name) {
  try {
    const nm = avSeqText(name, AV_SEQ_NAME_CAP, "");
    if (!nm) return false;
    const scenes = avSeqScenesState.scenes;
    for (let i = 0; i < scenes.length; i++) {
      if (scenes[i].name === nm) {
        for (let t = 0; t < AV_SEQ_TRACKS; t++) avSeqPattern.tracks[t].mute = scenes[i].tracks[t].mute;
        return true;
      }
    }
    return false;
  } catch (e) { return false; }
}

function avSeqScenesSnap() {
  const scenes = [];
  for (let i = 0; i < avSeqScenesState.scenes.length; i++) scenes.push(avSeqSceneCopy(avSeqScenesState.scenes[i]));
  return { v: 1, scenes: scenes };
}

function avSeqScenesLoad(obj) {
  try {
    let arr = null;
    if (Array.isArray(obj)) arr = obj;
    else if (obj && typeof obj === "object") {
      if (obj.v != null && Number(obj.v) !== 1) return false;
      arr = Array.isArray(obj.scenes) ? obj.scenes : [];
    } else return false;
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const sc = avSeqSceneNorm(arr[i]);
      if (!sc) continue;
      let at = -1;
      for (let j = 0; j < out.length; j++) if (out[j].name === sc.name) { at = j; break; }
      if (at >= 0) out[at] = sc;                     /* duplicate name: later entry wins */
      else if (out.length < AV_SEQ_SCENE_CAP) out.push(sc);
    }
    avSeqScenesState = { v: 1, scenes: out };
    return true;
  } catch (e) { return false; }
}

/* ---------- RNG (xorshift32; constants 13/17/5 as av_dsp prngU32) ---------- */

function avSeqRngNext(st) {
  let x = st.s >>> 0;
  if (x === 0) x = AV_SEQ_DEF_RNG;
  x ^= x << 13; x = x >>> 0;
  x ^= x >>> 17;
  x ^= x << 5; x = x >>> 0;
  st.s = x;
  return x;
}

/* ---------- generators (§3.1) ---------- */

/* Euclidean mask: len 1..64 entries of 0|1; count == pulses, gaps vary by <= 1; rotate shifts
   hits forward (hit at i lands at (i+rotate) mod len). Garbage -> [] (the refuse signal). */
function avSeqEuclid(opts) {
  try {
    if (!opts || typeof opts !== "object" || Array.isArray(opts)) return [];
    const len = avSeqInt(opts.len, AV_SEQ_LEN_MIN, AV_SEQ_LEN_MAX, AV_SEQ_LEN_DEF);
    const pulses = avSeqInt(opts.pulses, 0, len, 4);
    const rotate = avSeqInt(opts.rotate, 0, len - 1, 0);
    const out = [];
    for (let i = 0; i < len; i++) out.push(0);
    for (let i = 0; i < len; i++) {
      if ((i * pulses) % len < pulses) out[(i + rotate) % len] = 1;
    }
    return out;
  } catch (e) { return []; }
}

/* Mutate (Circuit Rhythm law): re-place hits, keep the count + payloads. per track: the highest
   M = round(N*amount) hits move onto distinct positions drawn from the free set; kept (lowest
   N-M) hits keep position and payload; moved payloads travel in ascending landing order;
   vacated slots reset to the default step. seed/amount must be finite numbers (else false). */
function avSeqMutate(seed, amount) {
  try {
    if (typeof seed !== "number" || !isFinite(seed)) return false;
    if (typeof amount !== "number" || !isFinite(amount)) return false;
    const a = avSeqClamp(amount, 0, 1);
    if (a <= 0) return true;                                   /* no-op, no draws */
    const st = { s: (seed >>> 0) || AV_SEQ_DEF_RNG };
    for (let t = 0; t < avSeqPattern.tracks.length; t++) {
      const tr = avSeqPattern.tracks[t];
      const len = tr.len;
      const hits = [];
      for (let i = 0; i < len; i++) if (tr.steps[i].on === 1) hits.push(i);
      const N = hits.length;
      if (N === 0) continue;
      const M = Math.round(N * a);
      if (M <= 0) continue;
      const keep = N - M;
      const inKeep = {};
      for (let j = 0; j < keep; j++) inKeep[hits[j]] = 1;
      const free = [];
      for (let i = 0; i < len; i++) if (!inKeep[i]) free.push(i);
      for (let j = 0; j < M; j++) {                            /* partial Fisher-Yates: M draws */
        const k = j + (avSeqRngNext(st) % (free.length - j));
        const tmp = free[j]; free[j] = free[k]; free[k] = tmp;
      }
      const landed = free.slice(0, M).sort(function (x, y) { return x - y; });
      const movedFrom = hits.slice(keep);
      const payloads = [];
      for (let j = 0; j < M; j++) payloads.push(avSeqStepCopy(tr.steps[movedFrom[j]]));
      for (let j = 0; j < M; j++) tr.steps[movedFrom[j]] = avSeqStepDefault();   /* vacated */
      for (let j = 0; j < M; j++) tr.steps[landed[j]] = payloads[j];
    }
    return true;
  } catch (e) { return false; }
}

/* Humanize (MPC law, v1 pin): additive micro (±12 ticks), relative gate/vel (±50%),
   3 draws per ON-step in pinned order (micro, gate, vel). seed/amount must be finite numbers. */
function avSeqHumanize(seed, amount) {
  try {
    if (typeof seed !== "number" || !isFinite(seed)) return false;
    if (typeof amount !== "number" || !isFinite(amount)) return false;
    const a = avSeqClamp(amount, 0, 1);
    if (a <= 0) return true;                                   /* no-op, no draws */
    const st = { s: (seed >>> 0) || AV_SEQ_DEF_RNG };
    for (let t = 0; t < avSeqPattern.tracks.length; t++) {
      const tr = avSeqPattern.tracks[t];
      for (let i = 0; i < tr.len; i++) {
        const s = tr.steps[i];
        if (s.on !== 1) continue;
        const u1 = (avSeqRngNext(st) % 24001) / 24000;
        const u2 = (avSeqRngNext(st) % 2001) / 2000;
        const u3 = (avSeqRngNext(st) % 2001) / 2000;
        const dT = Math.round((u1 * 2 - 1) * 12 * a);
        s.micro = avSeqClamp(Math.round(s.micro) + dT, AV_SEQ_MICRO_MIN, AV_SEQ_MICRO_MAX);
        s.gate = avSeqClamp(s.gate * (1 + (u2 * 2 - 1) * 0.5 * a), AV_SEQ_GATE_MIN, AV_SEQ_GATE_MAX);
        s.vel = avSeqClamp(s.vel * (1 + (u3 * 2 - 1) * 0.5 * a), AV_SEQ_VEL_MIN, AV_SEQ_VEL_MAX);
      }
    }
    return true;
  } catch (e) { return false; }
}

/* Named 16-step fills (pin table above). 'random' consumes the pattern rng field (seeded). */
function avSeqFill(id) {
  try {
    if (typeof id !== "string") return false;
    const key = id.trim().toLowerCase();
    const known = AV_SEQ_FILL_IDS.indexOf(key) >= 0;
    if (!known) return false;
    if (key === "random") {
      const st = { s: avSeqPattern.rng || AV_SEQ_DEF_RNG };
      for (let t = 0; t < AV_SEQ_TRACKS; t++) {
        const tr = avSeqPattern.tracks[t];
        for (let i = 0; i < tr.len; i++) {
          tr.steps[i].on = (avSeqRngNext(st) % 100 < 50) ? 1 : 0;
        }
      }
      avSeqPattern.rng = st.s || AV_SEQ_DEF_RNG;
      return true;
    }
    const mask = AV_SEQ_FILLS[key];
    for (const tk in mask) {
      const t = Number(tk);
      if (!(t >= 0 && t < AV_SEQ_TRACKS)) continue;
      const tr = avSeqPattern.tracks[t];
      const positions = mask[tk];
      for (let i = 0; i < tr.len; i++) tr.steps[i].on = 0;
      for (let j = 0; j < positions.length; j++) {
        const p = positions[j];
        if (p >= 0 && p < tr.len) tr.steps[p].on = 1;
      }
    }
    return true;
  } catch (e) { return false; }
}

function avSeqFillIds() { return AV_SEQ_FILL_IDS.slice(); }

/* ---------- localStorage bridge (extras; best-effort, never throws) ---------- */

function avSeqLsStore() {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return null;
    return localStorage;
  } catch (e) { return null; }
}

function avSeqLsKeys() {
  return [AV_SEQ_LS_PATTERN, AV_SEQ_LS_CHAINS, AV_SEQ_LS_SONG, AV_SEQ_LS_SCENES];
}

function avSeqSaveLocal() {
  try {
    const store = avSeqLsStore();
    if (!store) return false;
    store.setItem(AV_SEQ_LS_PATTERN, avSeqPatternExport());
    store.setItem(AV_SEQ_LS_CHAINS, JSON.stringify(avSeqChainsSnap()));
    store.setItem(AV_SEQ_LS_SONG, JSON.stringify(avSeqSongSnap()));
    store.setItem(AV_SEQ_LS_SCENES, JSON.stringify(avSeqScenesSnap()));
    return true;
  } catch (e) { return false; }        /* quota / private mode / blocked storage */
}

function avSeqLoadLocal() {
  try {
    const store = avSeqLsStore();
    if (!store) return false;
    let rawPat = null, rawCh = null, rawSong = null, rawSc = null;
    try {
      rawPat = store.getItem(AV_SEQ_LS_PATTERN);
      rawCh = store.getItem(AV_SEQ_LS_CHAINS);
      rawSong = store.getItem(AV_SEQ_LS_SONG);
      rawSc = store.getItem(AV_SEQ_LS_SCENES);
    } catch (e) { return false; }
    if (rawPat != null) avSeqPatternImport(String(rawPat));
    if (rawCh != null) { try { avSeqChainsLoad(JSON.parse(String(rawCh))); } catch (e) { /* corrupt */ } }
    if (rawSong != null) { try { avSeqSongLoad(JSON.parse(String(rawSong))); } catch (e) { /* corrupt */ } }
    if (rawSc != null) { try { avSeqScenesLoad(JSON.parse(String(rawSc))); } catch (e) { /* corrupt */ } }
    return true;
  } catch (e) { return false; }
}

/* ---------- boot: best-effort LS restore — pages only; plain node skips this whole block ------ */
if (typeof window !== "undefined") {
  try { avSeqLoadLocal(); } catch (e) { /* a broken storage never blocks boot */ }
}
