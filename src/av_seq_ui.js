/* Anvil — SEQUENCER card (P4 wave, child C): the step-sequencer UI mounted into the parent-owned
   host `#av-seq-host` (the parent card is `#av-seq` — the parent adds both; this module only
   fills the host). Per verify/_p4_wave.md §3.3.

   M2 ADDENDUM (wave verify/_m2_wave.md §2.7 — child sa-G): the generative + arranger surface.
   - Track header: per row `.av-seq-row[data-track]` gains a `.av-seq-track-ctl` block with
     `select[data-track-len]` (1..64) · `select[data-track-spd]` (model v2: 0.25 · 0.5 · 0.75 ·
     1 · 1.5 · 2 · 4, labels ×¼ ×½ ×¾ ×1 ×1½ ×2 ×4) · `select[data-track-swg]` (— INHERIT = 0 +
     50..80). Every read is guarded so a MISSING swing field falls back to 0 (inherit); missing
     speed → 1; missing len → 16. Edits ride avSeqUiModelEdit (snapshot → edit the copy →
     avSeqLoad → undo checkpoint AFTER — the P4 law).
   - GEN block `#av-seq-gen`: track select `#av-seq-gen-track` (T1..T4, euclid's target) · euclid
     `#av-seq-euclid-pulses` (1..16) / `#av-seq-euclid-len` (2..64) / `#av-seq-euclid-rot`
     (0..63) / `#av-seq-euclid-apply` (avSeqEuclid mask preferred — the local mirror reproduces
     the same pinned mask law when the core is absent; hits set on=1 keeping the step's note else
     c4, non-hits cleared within len, steps beyond len untouched) · mutate
     `#av-seq-mutate-amt` (0..100) / `#av-seq-mutate-apply` (avSeqMutate(seed = the pattern rng,
     amount/100)) · humanize `#av-seq-humanize-amt` / `#av-seq-humanize-apply`
     (avSeqHumanize, same args) · fill `#av-seq-fill-id` (avSeqFillIds) / `#av-seq-fill-apply`
     (avSeqFill(id)). Every apply = a model edit (snapshot → edit → avSeqLoad) + undo AFTER
     (label "gen"). The live-core generators (mutate/humanize/fill mutate the core in place — no
     copy-taking form) ride avSeqUiGenBridge: the copy's state is loaded to the core, the
     generator runs, the mutated state is reflected back into the copy, then the standard
     load + undo-AFTER follows.
   - SONG block additions (inside the existing `.av-seq-song`): rows list `#av-seq-song-rows`
     (rows `.av-seq-songrow[data-row]` with `[data-song-field]` inputs — label / repeats 1..256 /
     len 0..1024 (0 = inherit) / tempo 0..300 (0 = inherit); mutes
     `.av-seq-songrow-mute[data-track]`; buttons `[data-song-up]` / `[data-song-dn]` /
     `[data-song-del]`; `#av-seq-song-rows-add` appends {ref = live pattern name, repeats 1,
     mutes current, len 0, tempo 0, label ""}) · `#av-seq-song-play` (PLAY SONG ↔ STOP SONG,
     aria-pressed; avSongPlay/avSongStop guarded; avSongStatus polled for the active-row
     highlight `.cur` + `#av-seq-song-pos`) · quant select `#av-seq-song-quant`
     (instant/beat/cycle, def beat) — feeds the scene RECALL button's quant argument AND is
     stored as the recall default · `#av-seq-song-midi` (avSongExportMidi → a Blob-URL anchor
     download + an honest status line) · `#av-seq-song-json` / `#av-seq-song-open` (hidden file
     input; avSongImportJson) · timeline `#av-seq-song-timeline` with
     `.av-seq-tl-block[data-row]` (width ∝ L×R, `.cur` during playback). All song-row edits ride
     avSeqSongSnap/avSeqSongLoad + undo AFTER (label "song").
   - Scene recall: the RECALL button calls avSongSceneRecall(name, quantFromSelect) guarded when
     the song runner plays, else the existing immediate avSeqSceneRecall; the immediate branch
     pushes avUndoPush("seq","scene") AFTER (the playing branch's checkpoint is the runner's own
     ONE per applied recall — §2.6). Chain edits (+CHAIN/CLEAR) push checkpoints AFTER (label
     "chain"). The local default pattern builder (`avSeqUiLocalDefault`) gains swing 0 per track
     (model v2).
   - FOREIGN REACHES stay typeof-guarded: avSeqEuclid · avSeqMutate · avSeqHumanize · avSeqFill ·
     avSeqFillIds · avSeqSongSnap/Load · avSeqSchedCycleLen · avSongPlay/Stop/IsPlaying/Status/
     SceneRecall/ExportMidi/ExportJson/ImportJson (the sa-F sibling — authored in parallel; every
     call is typeof-guarded and this file never assumes it exists).

   WHAT THIS CARD IS
   - transport (PLAY · STOP · REC) wired to av_seq_sched.js's pinned API through typeof guards;
   - the BPM knob rides the standard av-knob idiom on path "bpm" (the parent adds the app_core
     branch: avState.bpm clamp 20..300 + mirror fx.delay.bpm);
   - the step grid: `.av-seq-grid` -> `.av-seq-row[data-track]` -> `.av-seq-cell[data-track]
     [data-step]` with `.on`, `.cur` (playhead), `.sel`; clicking a cell selects it and toggles
     its `on`; a per-row mute button (`M`) rides the same edit path;
   - the inspector `.av-seq-insp` edits the selected step's fields (note · vel · gate · prob ·
     ratchet · micro · oct · cond · slide · accent);
   - the song/scene block `.av-seq-song`: chain list (`.av-seq-chains` > `.av-seq-chain`),
     `#av-seq-song-add`, `#av-seq-song-clear`, scene name + `#av-seq-scene-cap`,
     `#av-seq-scene-sel`, `#av-seq-scene-recall`;
   - the pattern IO block: `#av-seq-export` / `#av-seq-import` over the `<textarea id="av-seq-io">`
     (the pinned JSON file format, §4).

   LAW: every ENGINE-bound control commits through the knob framework (avKnobCommit ->
   avApplyParam, or the 'av-param' event fallback) — never a direct engine call. Sequencer-domain
   edits (steps, tracks) mutate the core model via the pinned `avSeqSnap()` copy + `avSeqLoad()`
   path and are pushed live through `avSeqSetPattern()` when B defines it. The core APIs are
   pinned in verify/_p4_wave.md §3.1/§3.2 and consumed with typeof guards only — this file never
   reaches into another module's internals.

   PINS CONSUMED (guarded): avSeqSnap · avSeqLoad · avSeqPatternExport · avSeqPatternImport ·
   avSeqChainsSnap/Load · avSeqSceneCapture/Recall/ScenesSnap (A) · avSeqPlay/Stop/IsPlaying/
   Position/SetPattern (B) · avUndoPush (F) · avSeqCaptureArm/State (G) · avKnobHTML/RowHTML/
   Bind/ApplyVisual/Format + avParams (knob framework) · avNoteName/avNoteParse (note bus).

   OBSERVABLES: avSeqUiInit() -> bool (false without host/knob parts, never throws, re-mountable)
   · avSeqUiSync() -> bool (repaint from the core snapshot + live position) · avSeqUiClasses() ->
   string[] (the NEW css classes; the parent styles them) · window.__avSeqUi = { version, init,
   sync, classes, export, import, snap, select }.

   FULL ID INVENTORY (rig + parent rely on these):
     #av-seq-play · #av-seq-stop · #av-seq-rec · #av-seq-pos · knob .av-knob[data-knob="bpm"]
     #av-seq-insp-at · #av-seq-insp-empty · #av-seq-insp-body · #av-seq-insp-del
     #av-seq-insp-note · #av-seq-insp-vel · #av-seq-insp-gate · #av-seq-insp-prob
     #av-seq-insp-ratchet · #av-seq-insp-micro · #av-seq-insp-oct · #av-seq-insp-cond
     #av-seq-insp-slide · #av-seq-insp-accent
     #av-seq-chains · #av-seq-song-add · #av-seq-song-clear · #av-seq-scene-name
     #av-seq-scene-cap · #av-seq-scene-sel · #av-seq-scene-recall
     #av-seq-export · #av-seq-import · #av-seq-io (textarea)
     M2: #av-seq-gen · #av-seq-gen-track · #av-seq-gen-status
     #av-seq-euclid-pulses · #av-seq-euclid-len · #av-seq-euclid-rot · #av-seq-euclid-apply
     #av-seq-mutate-amt · #av-seq-mutate-apply · #av-seq-humanize-amt · #av-seq-humanize-apply
     #av-seq-fill-id · #av-seq-fill-apply
     #av-seq-song-rows · #av-seq-song-rows-add · #av-seq-song-play · #av-seq-song-pos
     #av-seq-song-quant · #av-seq-song-midi · #av-seq-song-json · #av-seq-song-open
     #av-seq-song-timeline · #av-seq-song-status

   No DOM at top level (loads in plain node: no document/window reach until a function runs).
   ONE namespace avSeqUi* / AV_SEQ_UI_*. Never throws. ONE writer (child C · sa-G for M2). */

"use strict";

const AV_SEQ_UI_VERSION = "p4.0";
const AV_SEQ_UI_TRACKS = 4;
const AV_SEQ_UI_DEFAULT_LEN = 16;
const AV_SEQ_UI_MAX_LEN = 64;
const AV_SEQ_UI_FIELDS = ["on", "note", "vel", "gate", "slide", "accent", "oct", "prob", "cond", "ratchet", "micro"];

/* ---------- M2 pins (model v2 mirrors — the core owns the authoritative tables) ---------- */

const AV_SEQ_UI_SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];      /* model v2 speed set (§4.7) */
const AV_SEQ_UI_SPEED_LABELS = ["×¼", "×½", "×¾", "×1", "×1½", "×2", "×4"];
const AV_SEQ_UI_SWING_MIN = 50;                                 /* track swing 0 = inherit | 50..80 */
const AV_SEQ_UI_SWING_MAX = 80;
const AV_SEQ_UI_DEF_RNG = 305419896;                            /* = AV_SEQ_DEF_RNG (0x12345678) */
const AV_SEQ_UI_SONG_CAP = 99;                                  /* = AV_SEQ_SONG_CAP */
const AV_SEQ_UI_MAX_REPEATS = 256;
const AV_SEQ_UI_ROW_LEN_MAX = 1024;
const AV_SEQ_UI_ROW_TEMPO_MAX = 300;
const AV_SEQ_UI_LABEL_CAP = 16;
/* mirror of AV_SEQ_FILL_IDS for environments without the core (same order) */
const AV_SEQ_UI_FILL_IDS = ["kick", "snare", "hat", "beat", "techno", "break", "euclid", "random", "clear"];

const avSeqUiState = {
  inited: false, mounts: 0, uiPlaying: false, rafOn: false,
  local: null,                 /* fallback model when av_seq_core is not loaded (harness / early boot) */
  sel: null,                   /* {track, step} selected cell, or null */
  lens: [],                    /* per-track cell counts at last grid build */
  curKey: "", posKey: "", lastExport: "", recMode: "off",
  notes: null, sceneKey: "", chainKey: "",
  /* M2 ui state */
  genTrack: 0,                 /* euclid target track (state mirror of #av-seq-gen-track) */
  fillId: "", fillKey: "",     /* fill select value + option-rebuild key */
  genMsg: "",                  /* last GEN status line (repainted after a rebuild) */
  songRowsKey: "",             /* song rows/timeline rebuild key */
  songPosKey: "",              /* #av-seq-song-pos text key */
  songQuant: "beat",           /* the stored scene-recall quantisation default */
  uiSongPlaying: false,
};

/* ---------- small helpers (pure; no DOM) ---------- */

const avSeqUiEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const avSeqUiNum = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };
const avSeqUiInt = (v, d) => { const n = Number(v); return isFinite(n) ? Math.round(n) : d; };

function avSeqUiDeepCopy(x) {
  try { return JSON.parse(JSON.stringify(x)); } catch (e) { return null; }
}

/* the local fallback pattern (only used when the core module is absent) — §4 shape, model v2
   (every track carries swing 0 = inherit) */
function avSeqUiLocalDefault() {
  const tracks = [];
  for (let t = 0; t < AV_SEQ_UI_TRACKS; t++) {
    const steps = [];
    for (let s = 0; s < AV_SEQ_UI_MAX_LEN; s++) {
      steps.push({ on: 0, note: "c4", vel: 0.8, gate: 0.95, slide: 0, accent: 0, oct: 0, prob: 100, cond: "", ratchet: 1, micro: 0 });
    }
    tracks.push({ len: AV_SEQ_UI_DEFAULT_LEN, speed: 1, swing: 0, mute: 0, steps: steps });
  }
  return { v: 1, name: "PAT 1", bpm: 120, grid: "16", swing: 66, tracks: tracks, plocks: [], rng: AV_SEQ_UI_DEF_RNG };
}

/* note options for the inspector (c2..c6); cached */
function avSeqUiNoteOptions() {
  if (avSeqUiState.notes) return avSeqUiState.notes;
  const out = [];
  const names = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
  for (let m = 36; m <= 84; m++) {
    let n = "";
    try { if (typeof avNoteName === "function") n = String(avNoteName(m) || ""); } catch (e) { n = ""; }
    if (!n) n = names[m % 12] + (Math.floor(m / 12) - 1);
    out.push(n);
  }
  avSeqUiState.notes = out;
  return out;
}

/* ---------- guarded core access ---------- */

function avSeqUiHost() {
  try {
    if (typeof document !== "undefined" && document && typeof document.getElementById === "function") {
      return document.getElementById("av-seq-host");
    }
  } catch (e) { /* no document */ }
  return null;
}

/* snapshot: core first; local fallback; last resort the local default (so the grid always has a
   shape — the card is never empty) */
function avSeqUiPatternSnapshot() {
  try {
    if (typeof avSeqSnap === "function") {
      const s = avSeqSnap();
      if (s && typeof s === "object") return s;
    }
  } catch (e) { /* fall through */ }
  try { if (avSeqUiState.local) return avSeqUiDeepCopy(avSeqUiState.local); } catch (e) { /* fall through */ }
  const d = avSeqUiLocalDefault();
  avSeqUiState.local = d;
  return avSeqUiDeepCopy(d) || d;
}

/* load: core first (authoritative when present — a core refusal is a refusal); local only when
   the core module is absent */
function avSeqUiPatternLoad(obj) {
  try {
    if (!obj || typeof obj !== "object") return false;
    if (typeof avSeqLoad === "function") {
      try { return avSeqLoad(obj) === true; } catch (e) { return false; }
    }
    avSeqUiState.local = avSeqUiDeepCopy(obj);
    return !!avSeqUiState.local;
  } catch (e) { return false; }
}

/* push the current snapshot into the live transport (B's avSeqSetPattern is live-safe) */
function avSeqUiSchedPush() {
  try {
    if (typeof avSeqSetPattern === "function" && typeof avSeqSnap === "function") {
      const s = avSeqSnap();
      if (s && typeof s === "object") { avSeqSetPattern(s); return true; }
    }
  } catch (e) { /* no transport yet */ }
  return false;
}

function avSeqUiIsPlaying() {
  try { if (typeof avSeqIsPlaying === "function") return avSeqIsPlaying() === true; } catch (e) { /* fall through */ }
  return !!avSeqUiState.uiPlaying;
}

function avSeqUiPosition() {
  try {
    if (typeof avSeqPosition === "function") {
      const p = avSeqPosition();
      if (p && typeof p === "object" && isFinite(p.step)) return p;
    }
  } catch (e) { /* no transport */ }
  return null;
}

function avSeqUiRecMode() {
  try {
    if (typeof avSeqCaptureState === "function") {
      const s = avSeqCaptureState();
      if (s && typeof s === "object") {
        const m = (typeof s.mode === "string") ? s.mode : (s.armed ? "step" : "off");
        if (m === "step" || m === "live" || m === "off") return m;
      }
    }
  } catch (e) { /* no capture module */ }
  return avSeqUiState.recMode || "off";
}

/* the model cycle length floor (mirror of the avSeqSchedCycleLen law; floor 16, 1..64) */
function avSeqUiCycleLen() {
  try {
    if (typeof avSeqSchedCycleLen === "function") {
      const n = avSeqSchedCycleLen();
      if (isFinite(n) && n > 0) return Math.max(AV_SEQ_UI_DEFAULT_LEN, Math.min(AV_SEQ_UI_MAX_LEN, Math.floor(n)));
    }
  } catch (e) { /* no scheduler */ }
  return AV_SEQ_UI_DEFAULT_LEN;
}

/* ---------- model edits (core snapshot path; undo push BEFORE the load when F is present) ---------- */

function avSeqUiCleanPatch(patch) {
  if (!patch || typeof patch !== "object") return null;
  const out = {};
  for (const k in patch) {
    if (AV_SEQ_UI_FIELDS.indexOf(k) < 0) continue;
    const v = patch[k];
    if (k === "on" || k === "slide" || k === "accent") out[k] = v ? 1 : 0;
    else if (k === "note") {
      const s = String(v == null ? "" : v).trim().toLowerCase();
      let okNote = false;
      try {
        okNote = (typeof avNoteParse === "function") ? (avNoteParse(s) != null) : /^[a-g]#?-?\d+$/.test(s);
      } catch (e) { okNote = false; }
      if (!okNote) return null;
      out[k] = s;
    }
    else if (k === "vel" || k === "gate") out[k] = Math.max(0.05, Math.min(1, avSeqUiNum(v, 0.8)));
    else if (k === "prob") out[k] = Math.max(0, Math.min(100, Math.round(avSeqUiNum(v, 100))));
    else if (k === "micro") out[k] = Math.max(-12, Math.min(12, Math.round(avSeqUiNum(v, 0))));
    else if (k === "ratchet") out[k] = Math.max(1, Math.min(4, Math.round(avSeqUiNum(v, 1))));
    else if (k === "oct") out[k] = Math.max(-2, Math.min(2, Math.round(avSeqUiNum(v, 0))));
    else if (k === "cond") {
      const s = String(v == null ? "" : v).trim();
      out[k] = (s === "" || s === "fill" || s === "first" || s === "!first" || /^\d+:\d+$/.test(s)) ? s.slice(0, 12) : "";
    }
  }
  return Object.keys(out).length ? out : null;
}

/* mutate a copy of the snapshot, then load it. The undo checkpoint is pushed AFTER the load —
   F's avUndoPush is push-after-change; avUndoInit() captured the boot baseline (probe-verified:
   init + push-after is the working pairing; push-before leaves the first edit unrestorable). */
function avSeqUiModelEdit(mutator, label) {
  try {
    const snap = avSeqUiPatternSnapshot();
    if (!snap || !Array.isArray(snap.tracks)) return false;
    let ok = false;
    try { ok = mutator(snap) !== false; } catch (e) { return false; }
    if (!ok) return false;
    const loaded = avSeqUiPatternLoad(snap);
    if (loaded) { try { if (typeof avUndoPush === "function") avUndoPush("seq", label || "edit"); } catch (e) { /* F optional */ } }
    avSeqUiSchedPush();
    avSeqUiSync();
    return loaded;
  } catch (e) { return false; }
}

function avSeqUiStepEdit(track, step, patch) {
  const t = Math.floor(Number(track)), s = Math.floor(Number(step));
  if (!isFinite(t) || !isFinite(s) || t < 0 || t >= AV_SEQ_UI_TRACKS || s < 0) return false;
  return avSeqUiModelEdit(function (snap) {
    const tr = snap.tracks[t];
    if (!tr || !Array.isArray(tr.steps) || !tr.steps[s]) return false;
    const clean = avSeqUiCleanPatch(patch);
    if (!clean) return false;
    for (const k in clean) tr.steps[s][k] = clean[k];
    return true;
  }, "step edit");
}

function avSeqUiSelect(track, step) {
  const t = Math.floor(Number(track)), s = Math.floor(Number(step));
  if (!isFinite(t) || !isFinite(s) || t < 0 || t >= AV_SEQ_UI_TRACKS || s < 0) return false;
  avSeqUiState.sel = { track: t, step: s };
  avSeqUiSync();
  return true;
}

function avSeqUiCellClick(cell) {
  try {
    const t = Math.floor(Number(cell.dataset.track)), s = Math.floor(Number(cell.dataset.step));
    if (!isFinite(t) || !isFinite(s)) return false;
    avSeqUiState.sel = { track: t, step: s };
    const snap = avSeqUiPatternSnapshot();
    let next = 1;
    try {
      const st = (snap && snap.tracks[t] && snap.tracks[t].steps) ? snap.tracks[t].steps[s] : null;
      if (st && st.on) next = 0;
    } catch (e) { next = 1; }
    return avSeqUiStepEdit(t, s, { on: next });
  } catch (e) { return false; }
}

function avSeqUiMuteToggle(btn) {
  const t = Math.floor(Number(btn.dataset.track));
  if (!isFinite(t) || t < 0 || t >= AV_SEQ_UI_TRACKS) return false;
  return avSeqUiModelEdit(function (snap) {
    const tr = snap.tracks[t];
    if (!tr) return false;
    tr.mute = tr.mute ? 0 : 1;
    return true;
  }, "mute toggle");
}

function avSeqUiInspClear() {
  const sel = avSeqUiState.sel;
  if (!sel) return false;
  return avSeqUiStepEdit(sel.track, sel.step, { on: 0 });
}

/* ---------- M2 · track header controls (LEN / SPD / SWG — model v2) ---------- */

/* guarded reads: a missing swing field falls back to 0 (inherit); missing speed → 1;
   missing len → 16 (avSeqUiTrackLen). */
function avSeqUiTrackSpeed(snap, t) {
  let sp = 1;
  try {
    const tr = (snap && Array.isArray(snap.tracks)) ? snap.tracks[t] : null;
    const n = tr ? Number(tr.speed) : NaN;
    if (isFinite(n) && AV_SEQ_UI_SPEEDS.indexOf(n) >= 0) sp = n;
  } catch (e) { sp = 1; }
  return sp;
}

function avSeqUiTrackSwing(snap, t) {
  let sw = 0;
  try {
    const tr = (snap && Array.isArray(snap.tracks)) ? snap.tracks[t] : null;
    const n = tr ? Number(tr.swing) : NaN;
    if (isFinite(n)) {
      const r = Math.round(n);
      if (r === 0 || (r >= AV_SEQ_UI_SWING_MIN && r <= AV_SEQ_UI_SWING_MAX)) sw = r;
    }
  } catch (e) { sw = 0; }
  return sw;
}

function avSeqUiSpeedOk(n) {
  return typeof n === "number" && isFinite(n) && AV_SEQ_UI_SPEEDS.indexOf(n) >= 0;
}

/* the edit rides the standard model-edit law; the value set is pinned (a value outside it is
   refused, never coerced silently) */
function avSeqUiTrackCtlEdit(el, kind) {
  try {
    const row = (el && typeof el.closest === "function") ? el.closest(".av-seq-row") : null;
    const t = row ? Math.floor(Number(row.dataset.track)) : NaN;
    if (!isFinite(t) || t < 0 || t >= AV_SEQ_UI_TRACKS) return false;
    const raw = (el && typeof el.value === "string") ? el.value : "";
    const n = Number(raw);
    if (!isFinite(n)) return false;
    if (kind === "len") {
      const len = Math.max(1, Math.min(AV_SEQ_UI_MAX_LEN, Math.round(n)));
      return avSeqUiModelEdit(function (snap) {
        const tr = snap.tracks[t];
        if (!tr) return false;
        tr.len = len;
        return true;
      }, "track len");
    }
    if (kind === "spd") {
      if (!avSeqUiSpeedOk(n)) return false;
      return avSeqUiModelEdit(function (snap) {
        const tr = snap.tracks[t];
        if (!tr) return false;
        tr.speed = n;
        return true;
      }, "track speed");
    }
    if (kind === "swg") {
      const sw = Math.round(n);
      if (!(sw === 0 || (sw >= AV_SEQ_UI_SWING_MIN && sw <= AV_SEQ_UI_SWING_MAX))) return false;
      return avSeqUiModelEdit(function (snap) {
        const tr = snap.tracks[t];
        if (!tr) return false;
        tr.swing = sw;                 /* 0 = inherit (model v2) */
        return true;
      }, "track swing");
    }
  } catch (e) { /* a listener never throws outward */ }
  return false;
}

function avSeqUiTrackCtlHTML(snap, t) {
  let lenOpts = "";
  const lenCur = avSeqUiTrackLen(snap, t);
  for (let i = 1; i <= AV_SEQ_UI_MAX_LEN; i++) lenOpts += '<option value="' + i + '"' + (i === lenCur ? " selected" : "") + '>' + i + '</option>';
  let spdOpts = "";
  const spdCur = avSeqUiTrackSpeed(snap, t);
  for (let i = 0; i < AV_SEQ_UI_SPEEDS.length; i++) {
    const v = AV_SEQ_UI_SPEEDS[i];
    spdOpts += '<option value="' + v + '"' + (v === spdCur ? " selected" : "") + '>' + AV_SEQ_UI_SPEED_LABELS[i] + '</option>';
  }
  const swgCur = avSeqUiTrackSwing(snap, t);
  let swgOpts = '<option value="0"' + (swgCur === 0 ? " selected" : "") + '>— INHERIT</option>';
  for (let s = AV_SEQ_UI_SWING_MIN; s <= AV_SEQ_UI_SWING_MAX; s++) swgOpts += '<option value="' + s + '"' + (s === swgCur ? " selected" : "") + '>' + s + '</option>';
  return '<span class="av-seq-track-ctl">' +
    '<select class="av-select av-seq-tsel" data-track-len="' + t + '" aria-label="Track ' + (t + 1) + ' length (steps)" title="Track length — 1..64 steps">' + lenOpts + '</select>' +
    '<select class="av-select av-seq-tsel" data-track-spd="' + t + '" aria-label="Track ' + (t + 1) + ' speed" title="Track speed — ×¼ ×½ ×¾ ×1 ×1½ ×2 ×4">' + spdOpts + '</select>' +
    '<select class="av-select av-seq-tsel" data-track-swg="' + t + '" aria-label="Track ' + (t + 1) + ' swing" title="Track swing — inherit the pattern swing, or 50..80">' + swgOpts + '</select>' +
    '</span>';
}

/* ---------- M2 · generators (pure parts + the snapshot/edit law) ---------- */

/* local mirror of the core's avSeqEuclid mask law (same formula + clamps; used only when the
   core is absent — the core mask is preferred) */
function avSeqUiEuclidMaskLocal(len, pulses, rotate) {
  const L = Math.max(1, Math.min(AV_SEQ_UI_MAX_LEN, avSeqUiInt(len, AV_SEQ_UI_DEFAULT_LEN)));
  const P = Math.max(0, Math.min(L, avSeqUiInt(pulses, 4)));
  const R = Math.max(0, Math.min(L - 1, avSeqUiInt(rotate, 0)));
  const out = [];
  for (let i = 0; i < L; i++) out.push(0);
  for (let i = 0; i < L; i++) if ((i * P) % L < P) out[(i + R) % L] = 1;
  return out;
}

/* the mask: the core's avSeqEuclid when present (authoritative); the local mirror otherwise */
function avSeqUiEuclidMask(len, pulses, rotate) {
  try {
    if (typeof avSeqEuclid === "function") {
      const m = avSeqEuclid({ len: len, pulses: pulses, rotate: rotate });
      if (Array.isArray(m) && m.length > 0) return m;
    }
  } catch (e) { /* fall through to the mirror */ }
  return avSeqUiEuclidMaskLocal(len, pulses, rotate);
}

/* pure: map a euclid mask onto a full step array — hits set on=1 keeping the step's note (a
   missing note becomes "c4"), non-hits clear on=0 within the mask length; steps beyond the mask
   are untouched. Returns a NEW array of NEW step objects (the input is never mutated). */
function avSeqUiEuclidSteps(steps, mask) {
  if (!Array.isArray(steps) || !Array.isArray(mask)) return null;
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    const src = (steps[i] && typeof steps[i] === "object") ? steps[i] : {};
    const o = {};
    for (const k in src) o[k] = src[k];
    if (i < mask.length) {
      if (mask[i]) {
        o.on = 1;
        if (typeof o.note !== "string" || !o.note) o.note = "c4";
      } else o.on = 0;
    }
    out.push(o);
  }
  return out;
}

/* GEN bridge for the core's LIVE-model generators (avSeqMutate / avSeqHumanize / avSeqFill mutate
   the live pattern in place; there is no copy-taking form). The standard law still holds:
   snapshot -> [hand the core the copy's state, run the generator, reflect the mutated state back
   into the copy] -> the outer avSeqLoad -> undo checkpoint AFTER. */
function avSeqUiGenBridge(run, label) {
  return avSeqUiModelEdit(function (snap) {
    if (typeof run !== "function") return false;
    if (!avSeqUiPatternLoad(snap)) return false;
    let ok = false;
    try { ok = run() === true; } catch (e) { return false; }
    if (!ok) return false;
    let after = null;
    try { after = (typeof avSeqSnap === "function") ? avSeqSnap() : null; } catch (e) { after = null; }
    if (!after || !Array.isArray(after.tracks) || after.tracks.length !== snap.tracks.length) return false;
    for (let t = 0; t < snap.tracks.length; t++) snap.tracks[t] = after.tracks[t];
    if (isFinite(after.rng)) snap.rng = after.rng;
    return true;
  }, label || "gen");
}

function avSeqUiCtlNum(host, sel, dflt) {
  try {
    const el = host ? host.querySelector(sel) : null;
    if (el && typeof el.value === "string" && el.value !== "") {
      const n = Number(el.value);
      if (isFinite(n)) return n;
    }
  } catch (e) { /* no host */ }
  return dflt;
}

function avSeqUiGenTrackRead(host) {
  try {
    const el = host ? host.querySelector("#av-seq-gen-track") : null;
    if (el) {
      const t = Math.floor(Number(el.value));
      if (isFinite(t) && t >= 0 && t < AV_SEQ_UI_TRACKS) { avSeqUiState.genTrack = t; return t; }
    }
  } catch (e) { /* no host */ }
  const st = Math.floor(Number(avSeqUiState.genTrack));
  return (isFinite(st) && st >= 0 && st < AV_SEQ_UI_TRACKS) ? st : 0;
}

function avSeqUiFillIds() {
  try {
    if (typeof avSeqFillIds === "function") {
      const a = avSeqFillIds();
      if (Array.isArray(a) && a.length) {
        const out = [];
        for (let i = 0; i < a.length && out.length < 32; i++) {
          const id = (typeof a[i] === "string") ? a[i].trim().toLowerCase() : "";
          if (id) out.push(id);
        }
        if (out.length) return out;
      }
    }
  } catch (e) { /* no core */ }
  return AV_SEQ_UI_FILL_IDS.slice();
}

function avSeqUiFillIdRead(host) {
  let id = "";
  try {
    const el = host ? host.querySelector("#av-seq-fill-id") : null;
    if (el && typeof el.value === "string") id = el.value.trim().toLowerCase();
  } catch (e) { id = ""; }
  if (!id) id = String(avSeqUiState.fillId || "");
  const ids = avSeqUiFillIds();
  if (ids.indexOf(id) >= 0) return id;
  return ids.length ? ids[0] : "";
}

function avSeqUiGenStatus(host, msg) {
  avSeqUiState.genMsg = String(msg == null ? "" : msg);
  try {
    const el = host ? host.querySelector("#av-seq-gen-status") : null;
    if (el) el.textContent = avSeqUiState.genMsg;
  } catch (e) { /* no host */ }
}

/* euclid: the core mask onto the target track (see the header); model edit + undo AFTER */
function avSeqUiGenEuclid() {
  const host = avSeqUiHost();
  const pulses = Math.max(1, Math.min(16, avSeqUiInt(avSeqUiCtlNum(host, "#av-seq-euclid-pulses", 4), 4)));
  const len = Math.max(2, Math.min(AV_SEQ_UI_MAX_LEN, avSeqUiInt(avSeqUiCtlNum(host, "#av-seq-euclid-len", AV_SEQ_UI_DEFAULT_LEN), AV_SEQ_UI_DEFAULT_LEN)));
  const rot = Math.max(0, Math.min(63, avSeqUiInt(avSeqUiCtlNum(host, "#av-seq-euclid-rot", 0), 0)));
  const t = avSeqUiGenTrackRead(host);
  const mask = avSeqUiEuclidMask(len, pulses, rot);
  if (!Array.isArray(mask) || !mask.length) { avSeqUiGenStatus(host, "euclid unavailable"); return false; }
  const ok = avSeqUiModelEdit(function (snap) {
    const tr = snap.tracks[t];
    if (!tr || !Array.isArray(tr.steps)) return false;
    const next = avSeqUiEuclidSteps(tr.steps, mask);
    if (!next) return false;
    tr.steps = next;
    return true;
  }, "gen");
  avSeqUiGenStatus(host, ok ? ("euclid · T" + (t + 1) + " · " + pulses + "/" + len + (rot ? " rot " + rot : "")) : "euclid refused");
  return ok;
}

function avSeqUiGenMutate() {
  const host = avSeqUiHost();
  const amt = Math.max(0, Math.min(100, avSeqUiInt(avSeqUiCtlNum(host, "#av-seq-mutate-amt", 25), 25))) / 100;
  if (typeof avSeqMutate !== "function") { avSeqUiGenStatus(host, "mutate unavailable (core absent)"); return false; }
  let seed = AV_SEQ_UI_DEF_RNG;
  try {
    const s = avSeqUiPatternSnapshot();
    if (s && isFinite(Number(s.rng))) seed = Number(s.rng);
  } catch (e) { seed = AV_SEQ_UI_DEF_RNG; }
  const ok = avSeqUiGenBridge(function () { return avSeqMutate(seed, amt); }, "gen");
  avSeqUiGenStatus(host, ok ? ("mutate · " + Math.round(amt * 100) + "%") : "mutate refused");
  return ok;
}

function avSeqUiGenHumanize() {
  const host = avSeqUiHost();
  const amt = Math.max(0, Math.min(100, avSeqUiInt(avSeqUiCtlNum(host, "#av-seq-humanize-amt", 25), 25))) / 100;
  if (typeof avSeqHumanize !== "function") { avSeqUiGenStatus(host, "humanize unavailable (core absent)"); return false; }
  let seed = AV_SEQ_UI_DEF_RNG;
  try {
    const s = avSeqUiPatternSnapshot();
    if (s && isFinite(Number(s.rng))) seed = Number(s.rng);
  } catch (e) { seed = AV_SEQ_UI_DEF_RNG; }
  const ok = avSeqUiGenBridge(function () { return avSeqHumanize(seed, amt); }, "gen");
  avSeqUiGenStatus(host, ok ? ("humanize · " + Math.round(amt * 100) + "%") : "humanize refused");
  return ok;
}

function avSeqUiGenFill() {
  const host = avSeqUiHost();
  const id = avSeqUiFillIdRead(host);
  if (typeof avSeqFill !== "function") { avSeqUiGenStatus(host, "fill unavailable (core absent)"); return false; }
  if (!id) { avSeqUiGenStatus(host, "no fill id"); return false; }
  const ok = avSeqUiGenBridge(function () { return avSeqFill(id); }, "gen");
  avSeqUiGenStatus(host, ok ? ("fill · " + id) : "fill refused");
  return ok;
}

/* ---------- M2 · song rows + arranger (core snapshot path, undo AFTER — label "song") ---------- */

/* pure: normalise a song snapshot ({v,rows} or rows[]) into render rows — guarded reads with the
   core's clamps mirrored (repeats 1..256, len 0..1024, tempo 0..300, label ≤16, mutes ×4) */
function avSeqUiSongRowsModel(song) {
  const out = [];
  let rows = [];
  try { rows = Array.isArray(song) ? song : ((song && Array.isArray(song.rows)) ? song.rows : []); } catch (e) { rows = []; }
  for (let i = 0; i < rows.length && i < AV_SEQ_UI_SONG_CAP; i++) {
    const r = (rows[i] && typeof rows[i] === "object" && !Array.isArray(rows[i])) ? rows[i] : {};
    const mutes = [];
    const sm = Array.isArray(r.mutes) ? r.mutes : [];
    for (let t = 0; t < AV_SEQ_UI_TRACKS; t++) mutes.push(sm[t] ? 1 : 0);
    out.push({
      i: i,
      ref: (typeof r.ref === "string" && r.ref) ? r.ref.slice(0, 24) : "",
      label: (typeof r.label === "string") ? r.label.slice(0, AV_SEQ_UI_LABEL_CAP) : "",
      repeats: Math.max(1, Math.min(AV_SEQ_UI_MAX_REPEATS, avSeqUiInt(r.repeats, 1))),
      len: Math.max(0, Math.min(AV_SEQ_UI_ROW_LEN_MAX, avSeqUiInt(r.len, 0))),
      tempo: Math.max(0, Math.min(AV_SEQ_UI_ROW_TEMPO_MAX, avSeqUiInt(r.tempo, 0))),
      mutes: mutes,
    });
  }
  return out;
}

/* pure: a row's timeline span — L = len || cycleLen (floor 16), R = repeats; span = L×R */
function avSeqUiSongSpan(row, cycleLen) {
  const cyc = (isFinite(cycleLen) && cycleLen > 0) ? Math.floor(cycleLen) : AV_SEQ_UI_DEFAULT_LEN;
  let L = Math.max(1, cyc);
  if (row && isFinite(Number(row.len)) && Number(row.len) > 0) L = Math.max(1, Math.min(AV_SEQ_UI_ROW_LEN_MAX, Math.round(Number(row.len))));
  const R = (row && isFinite(Number(row.repeats)) && Number(row.repeats) > 0) ? Math.max(1, Math.round(Number(row.repeats))) : 1;
  return { L: L, R: R, span: L * R };
}

/* pure: the timeline strip markup — block widths ∝ L×R (min 2 %) */
function avSeqUiSongTimelineHTML(rows) {
  if (!Array.isArray(rows) || !rows.length) return "";
  const cyc = avSeqUiCycleLen();
  let total = 0;
  const spans = [];
  for (let i = 0; i < rows.length; i++) {
    const s = avSeqUiSongSpan(rows[i], cyc);
    spans.push(s);
    total += s.span;
  }
  if (!total) return "";
  let out = "";
  for (let i = 0; i < rows.length; i++) {
    const s = spans[i];
    const pct = Math.max(2, Math.round((s.span / total) * 1000) / 10);
    const label = (rows[i] && rows[i].label) ? rows[i].label : ("ROW " + (i + 1));
    out += '<span class="av-seq-tl-block" data-row="' + i + '" style="width:' + pct + '%" title="' +
      avSeqUiEsc(label) + ' · L' + s.L + ' × R' + s.R + ' = ' + s.span + ' steps"></span>';
  }
  return out;
}

/* song model edit: avSeqSongSnap -> mutate the copy -> avSeqSongLoad -> undo AFTER (label "song") */
function avSeqUiSongEdit(mutator, label) {
  try {
    if (typeof avSeqSongSnap !== "function" || typeof avSeqSongLoad !== "function") return false;
    const song = avSeqSongSnap();
    if (!song || typeof song !== "object") return false;
    let ok = false;
    try { ok = mutator(song) !== false; } catch (e) { return false; }
    if (!ok) return false;
    const loaded = avSeqSongLoad(song) === true;
    if (loaded) {
      try { if (typeof avUndoPush === "function") avUndoPush("seq", label || "song"); } catch (e) { /* F optional */ }
      avSeqUiSync();
    }
    return loaded;
  } catch (e) { return false; }
}

function avSeqUiSongStatusSet(msg) {
  try {
    const host = avSeqUiHost();
    const el = host ? host.querySelector("#av-seq-song-status") : null;
    if (el) el.textContent = String(msg == null ? "" : msg).slice(0, 96);
  } catch (e) { /* no host */ }
}

/* append {ref = live pattern name, repeats 1, mutes current, len 0, tempo 0, label ""} */
function avSeqUiSongRowAdd() {
  let ref = "";
  const mutes = [];
  for (let t = 0; t < AV_SEQ_UI_TRACKS; t++) mutes.push(0);
  try {
    const p = avSeqUiPatternSnapshot();
    if (p && typeof p.name === "string" && p.name) ref = p.name;
    if (p && Array.isArray(p.tracks)) {
      for (let t = 0; t < AV_SEQ_UI_TRACKS; t++) {
        const tr = p.tracks[t];
        if (tr && tr.mute) mutes[t] = 1;
      }
    }
  } catch (e) { /* defaults stand */ }
  if (!ref) ref = "PAT 1";
  const ok = avSeqUiSongEdit(function (song) {
    if (!Array.isArray(song.rows)) song.rows = [];
    if (song.rows.length >= AV_SEQ_UI_SONG_CAP) return false;
    song.rows.push({ ref: ref, repeats: 1, mutes: mutes.slice(), len: 0, tempo: 0, label: "" });
    return true;
  }, "song");
  avSeqUiSongStatusSet(ok ? ("row added · " + ref) : "row add failed");
  return ok;
}

function avSeqUiSongRowField(el) {
  try {
    const rowEl = (el && typeof el.closest === "function") ? el.closest(".av-seq-songrow") : null;
    const r = rowEl ? Math.floor(Number(rowEl.dataset.row)) : NaN;
    const f = String((el && typeof el.getAttribute === "function") ? (el.getAttribute("data-song-field") || "") : "");
    if (!isFinite(r) || r < 0 || !f) return false;
    const raw = (el && typeof el.value === "string") ? el.value : "";
    const vals = avSeqUiSongFieldNorm(f, raw);
    if (!vals) return false;
    const ok = avSeqUiSongEdit(function (song) {
      const row = (song.rows && song.rows[r]) ? song.rows[r] : null;
      if (!row) return false;
      row[f] = vals.value;
      return true;
    }, "song");
    if (!ok) avSeqUiSongStatusSet("row edit refused");
    return ok;
  } catch (e) { return false; }
}

/* pure: normalise a [data-song-field] value (clamps mirrored from the core) */
function avSeqUiSongFieldNorm(f, raw) {
  if (f === "label") return { value: String(raw == null ? "" : raw).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, AV_SEQ_UI_LABEL_CAP) };
  if (raw === "" || raw == null) return null;
  const n = Number(raw);
  if (!isFinite(n)) return null;
  if (f === "repeats") return { value: Math.max(1, Math.min(AV_SEQ_UI_MAX_REPEATS, Math.round(n))) };
  if (f === "len") {
    const v = Math.max(0, Math.min(AV_SEQ_UI_ROW_LEN_MAX, Math.round(n)));
    return { value: v === 1 ? 2 : v };         /* the core's row len: 0 = inherit, else 2..1024 */
  }
  if (f === "tempo") {
    const v = Math.max(0, Math.min(AV_SEQ_UI_ROW_TEMPO_MAX, Math.round(n)));
    return { value: (v > 0 && v < 20) ? 20 : v };   /* the core's row tempo: 0 = inherit, else 20..300 */
  }
  return null;
}

function avSeqUiSongRowMuteToggle(btn) {
  try {
    const rowEl = (btn && typeof btn.closest === "function") ? btn.closest(".av-seq-songrow") : null;
    const r = rowEl ? Math.floor(Number(rowEl.dataset.row)) : NaN;
    const t = Math.floor(Number(btn && btn.dataset ? btn.dataset.track : NaN));
    if (!isFinite(r) || r < 0 || !isFinite(t) || t < 0 || t >= AV_SEQ_UI_TRACKS) return false;
    return avSeqUiSongEdit(function (song) {
      const row = (song.rows && song.rows[r]) ? song.rows[r] : null;
      if (!row) return false;
      if (!Array.isArray(row.mutes)) row.mutes = [0, 0, 0, 0];
      row.mutes[t] = row.mutes[t] ? 0 : 1;
      return true;
    }, "song");
  } catch (e) { return false; }
}

function avSeqUiSongRowMove(rowEl, dir) {
  try {
    const r = rowEl ? Math.floor(Number(rowEl.dataset.row)) : NaN;
    const d = Number(dir);
    if (!isFinite(r) || r < 0 || !isFinite(d) || !d) return false;
    return avSeqUiSongEdit(function (song) {
      if (!Array.isArray(song.rows)) return false;
      const j = r + (d < 0 ? -1 : 1);
      if (r >= song.rows.length || j < 0 || j >= song.rows.length) return false;
      const tmp = song.rows[r]; song.rows[r] = song.rows[j]; song.rows[j] = tmp;
      return true;
    }, "song");
  } catch (e) { return false; }
}

function avSeqUiSongRowDel(rowEl) {
  try {
    const r = rowEl ? Math.floor(Number(rowEl.dataset.row)) : NaN;
    if (!isFinite(r) || r < 0) return false;
    return avSeqUiSongEdit(function (song) {
      if (!Array.isArray(song.rows) || r >= song.rows.length) return false;
      song.rows.splice(r, 1);
      return true;
    }, "song");
  } catch (e) { return false; }
}

/* ---------- M2 · song playback (av_song sibling — every reach typeof-guarded) ---------- */

function avSeqUiSongPlaying() {
  try { if (typeof avSongIsPlaying === "function") return avSongIsPlaying() === true; } catch (e) { /* no sibling */ }
  return false;
}

function avSeqUiQuantNorm(q) {
  const s = String(q == null ? "" : q).trim().toLowerCase();
  return (s === "instant" || s === "beat" || s === "cycle") ? s : "beat";
}

function avSeqUiQuantRead(host) {
  let q = "";
  try {
    const el = host ? host.querySelector("#av-seq-song-quant") : null;
    if (el && typeof el.value === "string") q = el.value;
  } catch (e) { q = ""; }
  const norm = avSeqUiQuantNorm(q || avSeqUiState.songQuant);
  avSeqUiState.songQuant = norm;         /* stored as the recall default */
  return norm;
}

function avSeqUiSongPlayToggle() {
  let ok = false;
  let msg = "";
  try {
    if (avSeqUiSongPlaying()) {
      if (typeof avSongStop === "function") { ok = avSongStop() !== false; msg = ok ? "stopped" : "stop refused"; }
      else msg = "avSongStop unavailable";
    } else if (typeof avSongPlay === "function") {
      const res = avSongPlay();
      if (res && typeof res === "object") {
        ok = res.ok !== false;
        msg = ok ? "playing" : ("refused · " + String(res.error || "no rows"));
      } else msg = "avSongPlay unavailable";
    } else msg = "avSongPlay unavailable (sibling not loaded)";
  } catch (e) { ok = false; msg = "song transport threw"; }
  avSeqUiSongStatusSet(msg);
  avSeqUiSync();
  return ok;
}

/* repaint the arranger's playback state from avSongStatus (the runner's own report) */
function avSeqUiSongPlaybackRefresh(host) {
  if (!host || !host.querySelector) return false;
  try {
    let st = null;
    try { if (typeof avSongStatus === "function") st = avSongStatus(); } catch (e) { st = null; }
    const playing = !!(st && st.playing === true);
    const row = (st && isFinite(Number(st.row))) ? Math.floor(Number(st.row)) : -1;
    const btn = host.querySelector("#av-seq-song-play");
    if (btn) {
      const label = playing ? "STOP SONG" : "PLAY SONG";
      if (btn.textContent !== label) btn.textContent = label;
      btn.setAttribute("aria-pressed", playing ? "true" : "false");
      btn.classList.toggle("on", playing);
    }
    const pos = host.querySelector("#av-seq-song-pos");
    if (pos) {
      let txt = "—";
      if (playing) {
        txt = "ROW " + (row + 1) + "/" + (isFinite(Number(st.rows)) ? Math.round(Number(st.rows)) : "?") +
          " · RPT " + (isFinite(Number(st.repeat)) ? Math.round(Number(st.repeat)) : 1) +
          " · STEP " + (isFinite(Number(st.step)) ? Math.max(0, Math.floor(Number(st.step))) : 0);
        if (st.queued) txt += " · Q";
      } else if (st && st.queued) txt = "recall queued";
      const key = "p:" + txt;
      if (key !== avSeqUiState.songPosKey) { avSeqUiState.songPosKey = key; pos.textContent = txt; }
    }
    const rows = host.querySelectorAll(".av-seq-songrow");
    for (let i = 0; i < rows.length; i++) {
      const ri = Math.floor(Number(rows[i].dataset.row));
      rows[i].classList.toggle("cur", playing && ri === row);
    }
    const blocks = host.querySelectorAll(".av-seq-tl-block");
    for (let i = 0; i < blocks.length; i++) {
      const bi = Math.floor(Number(blocks[i].dataset.row));
      blocks[i].classList.toggle("cur", playing && bi === row);
    }
    return true;
  } catch (e) { return false; }
}

/* the anchor-blob download idiom (as av_comp_ui / av_deliver_ui — never throws) */
function avSeqUiDownload(buf, mime, name) {
  try {
    if (typeof document === "undefined" || !document || typeof document.createElement !== "function") return false;
    if (typeof URL === "undefined" || !URL || typeof URL.createObjectURL !== "function" || typeof Blob !== "function") return false;
    let url = "";
    try { url = URL.createObjectURL(new Blob([buf], { type: mime || "application/octet-stream" })); } catch (e) { url = ""; }
    if (!url) return false;
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "anvil-song";
    try { a.rel = "noopener"; } catch (e) { /* attribute refused */ }
    const body = document.body;
    let attached = false;
    if (body && typeof body.appendChild === "function") { try { body.appendChild(a); attached = true; } catch (e) { attached = false; } }
    try { a.click(); } catch (e) { /* a click never throws outward here */ }
    if (attached && body && typeof body.removeChild === "function") { try { body.removeChild(a); } catch (e) { /* ok */ } }
    try { if (typeof setTimeout === "function") setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { /* ok */ } }, 8000); } catch (e) { /* ok */ }
    return true;
  } catch (e) { return false; }
}

function avSeqUiSongExportMidi() {
  let ok = false;
  let msg = "song MIDI unavailable";
  try {
    if (typeof avSongExportMidi === "function") {
      const r = avSongExportMidi({});
      if (r && r.ok === true && r.bytes != null) {
        const dl = avSeqUiDownload(r.bytes, "audio/midi", "anvil-song.mid");
        ok = true;
        msg = "song MIDI · " + (isFinite(Number(r.rows)) ? Math.round(Number(r.rows)) : "?") + " rows · " +
          (isFinite(Number(r.noteCount)) ? Math.round(Number(r.noteCount)) : "?") + " notes" + (dl ? " · written" : " · download unavailable");
        if (Array.isArray(r.warnings) && r.warnings.length) msg += " · " + String(r.warnings[0]).slice(0, 48);
      } else {
        msg = "song MIDI refused" + (r && r.error ? " · " + String(r.error).slice(0, 48) : "");
      }
    }
  } catch (e) { ok = false; msg = "song MIDI threw"; }
  avSeqUiSongStatusSet(msg);
  return ok;
}

function avSeqUiSongExportJson() {
  let ok = false;
  let msg = "song JSON unavailable";
  try {
    if (typeof avSongExportJson === "function") {
      const txt = avSongExportJson();
      if (typeof txt === "string" && txt) {
        const dl = avSeqUiDownload(txt, "application/json", "anvil-song.json");
        ok = true;
        msg = "song JSON · " + String(txt.length) + " chars" + (dl ? " · written" : " · download unavailable");
      } else msg = "song JSON refused";
    }
  } catch (e) { ok = false; msg = "song JSON threw"; }
  avSeqUiSongStatusSet(msg);
  return ok;
}

/* the hidden file input: read a song JSON file → avSongImportJson (guarded) */
function avSeqUiSongOpenFile(inputEl) {
  let started = false;
  try {
    const f = (inputEl && inputEl.files) ? inputEl.files[0] : null;
    if (!f) return false;
    const reset = function () { try { if (inputEl) inputEl.value = ""; } catch (e) { /* ok */ } };
    const done = function (txt) {
      let ok = false;
      try { if (typeof avSongImportJson === "function") ok = avSongImportJson(String(txt)) === true; } catch (e) { ok = false; }
      avSeqUiSongStatusSet(ok ? "song JSON imported" : "song JSON refused");
      if (ok) avSeqUiSync();
      reset();
    };
    const fail = function () { avSeqUiSongStatusSet("song file read failed"); reset(); };
    if (typeof f.text === "function") {
      const p = f.text();
      if (p && typeof p.then === "function") { p.then(done, fail); started = true; }
    }
    if (!started && typeof FileReader === "function") {
      const fr = new FileReader();
      fr.onload = function () { done(fr.result || ""); };
      fr.onerror = fail;
      fr.readAsText(f);
      started = true;
    }
    if (started) avSeqUiSongStatusSet("reading song JSON…");
  } catch (e) { started = false; }
  return started;
}

/* ---------- markup (pure string builders) ---------- */

function avSeqUiTrackLen(snap, t) {
  let len = AV_SEQ_UI_DEFAULT_LEN;
  try {
    if (snap && Array.isArray(snap.tracks) && snap.tracks[t] && isFinite(snap.tracks[t].len)) {
      len = avSeqUiNum(snap.tracks[t].len, AV_SEQ_UI_DEFAULT_LEN);
    }
  } catch (e) { len = AV_SEQ_UI_DEFAULT_LEN; }
  return Math.max(1, Math.min(AV_SEQ_UI_MAX_LEN, Math.floor(len)));
}

function avSeqUiTrackLens(snap) {
  const L = [];
  for (let t = 0; t < AV_SEQ_UI_TRACKS; t++) L.push(avSeqUiTrackLen(snap, t));
  return L;
}

function avSeqUiGridHTML(snap) {
  let rows = "";
  for (let t = 0; t < AV_SEQ_UI_TRACKS; t++) {
    const len = avSeqUiTrackLen(snap, t);
    let cells = "";
    for (let s = 0; s < len; s++) {
      cells += '<button type="button" class="av-seq-cell" data-track="' + t + '" data-step="' + s + '"' +
        ' aria-label="Track ' + (t + 1) + ' step ' + (s + 1) + '" aria-pressed="false"' +
        ' title="T' + (t + 1) + ' · step ' + (s + 1) + ' — click selects, click again toggles on/off"></button>';
    }
    rows += '<div class="av-seq-row" data-track="' + t + '">' +
      '<span class="av-seq-row-lbl">T' + (t + 1) + '</span>' +
      '<button type="button" class="av-btn mini av-seq-row-mute" data-track="' + t + '"' +
      ' aria-label="Mute track ' + (t + 1) + '" title="Mute / unmute track ' + (t + 1) + '">M</button>' +
      avSeqUiTrackCtlHTML(snap, t) +
      cells + '</div>';
  }
  return '<div class="av-seq-gridwrap"><div class="av-seq-grid" role="group" aria-label="Step grid">' + rows + '</div></div>';
}

function avSeqUiTransportHTML() {
  let bpm = 120;
  try {
    if (typeof avParams !== "undefined" && avParams && isFinite(avParams["bpm"])) bpm = avParams["bpm"];
    else if (typeof avState !== "undefined" && avState && isFinite(avState.bpm)) bpm = avState.bpm;
  } catch (e) { bpm = 120; }
  bpm = Math.max(20, Math.min(300, bpm));
  let knob = "";
  try {
    knob = avKnobHTML("bpm", "BPM", { min: 20, max: 300, step: 1, def: 120, value: bpm, fmt: "int", hint: "sequencer tempo · app_core owns the avApplyParam('bpm') branch" });
  } catch (e) { knob = ""; }
  return '<div class="av-seq-transport">' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-play" aria-pressed="false" title="PLAY — start the audio-clock transport">PLAY</button>' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-stop" title="STOP — halt and rewind the transport">STOP</button>' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-rec" aria-pressed="false" title="REC — cycle capture arm: off → step → live">REC</button>' +
    '<span class="av-seq-pos" id="av-seq-pos" role="status">BAR 1 · 01/16</span>' +
    '<span class="av-seq-bpm">' + knob + '</span>' +
    '</div>';
}

function avSeqUiInspRow(label, ctl) {
  return '<div class="av-seq-insp-row"><span class="av-seq-insp-lbl">' + label + '</span>' +
    '<span class="av-seq-insp-ctl">' + ctl + '</span></div>';
}

function avSeqUiInspHTML() {
  const noteOpts = avSeqUiNoteOptions().map(n => '<option value="' + avSeqUiEsc(n) + '">' + avSeqUiEsc(n.toUpperCase()) + '</option>').join("");
  const nums = (a, b) => { let o = ""; for (let i = a; i <= b; i++) o += '<option value="' + i + '">' + i + '</option>'; return o; };
  let conds = "";
  [["", "—"], ["fill", "FILL"], ["first", "FIRST"], ["!first", "!FIRST"], ["2:1", "2:1"], ["4:2", "4:2"], ["2:3", "2:3"], ["4:4", "4:4"]].forEach(c => {
    conds += '<option value="' + avSeqUiEsc(c[0]) + '">' + avSeqUiEsc(c[1]) + '</option>';
  });
  return '<div class="av-seq-insp" data-av-seq-insp="1">' +
    '<div class="av-seq-insp-head"><span class="av-seq-insp-lbl">STEP</span>' +
    '<span class="av-seq-insp-at" id="av-seq-insp-at">—</span>' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-insp-del" title="Clear the selected step (on = 0)">CLEAR</button></div>' +
    '<p class="av-seq-insp-empty av-note av-dim" id="av-seq-insp-empty">Click a grid cell to select it — the fields below edit the selected step (clicking a cell also toggles it on/off).</p>' +
    '<div class="av-seq-insp-body" id="av-seq-insp-body" hidden>' +
    avSeqUiInspRow("NOTE", '<select class="av-select" id="av-seq-insp-note" data-insp-field="note" aria-label="Step note">' + noteOpts + '</select>') +
    avSeqUiInspRow("VEL", '<input type="range" class="av-seq-range" id="av-seq-insp-vel" data-insp-field="vel" min="0.05" max="1" step="0.01" value="0.8" aria-label="Step velocity"><span class="av-seq-insp-val" data-insp-val="vel">0.80</span>') +
    avSeqUiInspRow("GATE", '<input type="range" class="av-seq-range" id="av-seq-insp-gate" data-insp-field="gate" min="0.05" max="1" step="0.01" value="0.95" aria-label="Step gate"><span class="av-seq-insp-val" data-insp-val="gate">0.95</span>') +
    avSeqUiInspRow("PROB", '<input type="range" class="av-seq-range" id="av-seq-insp-prob" data-insp-field="prob" min="0" max="100" step="1" value="100" aria-label="Step probability"><span class="av-seq-insp-val" data-insp-val="prob">100%</span>') +
    avSeqUiInspRow("RATCHET", '<select class="av-select" id="av-seq-insp-ratchet" data-insp-field="ratchet" aria-label="Step ratchet count">' + nums(1, 4) + '</select>') +
    avSeqUiInspRow("MICRO", '<input type="range" class="av-seq-range" id="av-seq-insp-micro" data-insp-field="micro" min="-12" max="12" step="1" value="0" aria-label="Step micro-timing (ticks)"><span class="av-seq-insp-val" data-insp-val="micro">0</span>') +
    avSeqUiInspRow("OCT", '<select class="av-select" id="av-seq-insp-oct" data-insp-field="oct" aria-label="Step octave">' + nums(-2, 2) + '</select>') +
    avSeqUiInspRow("COND", '<select class="av-select" id="av-seq-insp-cond" data-insp-field="cond" aria-label="Step condition">' + conds + '</select>') +
    avSeqUiInspRow("SLIDE", '<input type="checkbox" class="av-seq-check" id="av-seq-insp-slide" data-insp-field="slide" aria-label="Step slide">') +
    avSeqUiInspRow("ACCENT", '<input type="checkbox" class="av-seq-check" id="av-seq-insp-accent" data-insp-field="accent" aria-label="Step accent">') +
    '</div></div>';
}

function avSeqUiGenHTML() {
  const ids = avSeqUiFillIds();
  const fillOpts = ids.map(id => '<option value="' + avSeqUiEsc(id) + '"' + (id === avSeqUiState.fillId ? " selected" : "") + '>' + avSeqUiEsc(id.toUpperCase()) + '</option>').join("");
  let trackOpts = "";
  for (let t = 0; t < AV_SEQ_UI_TRACKS; t++) {
    trackOpts += '<option value="' + t + '"' + (t === avSeqUiState.genTrack ? " selected" : "") + '>T' + (t + 1) + '</option>';
  }
  return '<div class="av-seq-gen" id="av-seq-gen" data-av-seq-gen="1">' +
    '<div class="av-seq-gen-head"><span class="av-seq-insp-lbl">GEN</span>' +
    '<span class="av-seq-cap">euclid · mutate · humanize · fill — every apply: snapshot → edit → load, undo checkpoint after</span></div>' +
    '<div class="av-seq-gen-row">' +
    '<span class="av-seq-gen-lbl">TRACK</span>' +
    '<select class="av-select av-seq-tsel" id="av-seq-gen-track" aria-label="Generator target track (euclid)">' + trackOpts + '</select>' +
    '<span class="av-seq-gen-lbl">FILL</span>' +
    '<select class="av-select av-seq-tsel" id="av-seq-fill-id" aria-label="Named fill">' + fillOpts + '</select>' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-fill-apply" title="Apply the named fill (avSeqFill) — model edit, undo checkpoint after">FILL ▸</button>' +
    '</div>' +
    '<div class="av-seq-gen-row">' +
    '<span class="av-seq-gen-lbl">EUCLID</span>' +
    '<span class="av-seq-gen-lbl">P</span><input type="number" class="av-seq-num" id="av-seq-euclid-pulses" min="1" max="16" step="1" value="4" aria-label="Euclid pulses (1..16)">' +
    '<span class="av-seq-gen-lbl">L</span><input type="number" class="av-seq-num" id="av-seq-euclid-len" min="2" max="64" step="1" value="16" aria-label="Euclid length (2..64 steps)">' +
    '<span class="av-seq-gen-lbl">R</span><input type="number" class="av-seq-num" id="av-seq-euclid-rot" min="0" max="63" step="1" value="0" aria-label="Euclid rotation (0..63)">' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-euclid-apply" title="Euclid mask onto the target track (avSeqEuclid)">EUCLID ▸</button>' +
    '</div>' +
    '<div class="av-seq-gen-row">' +
    '<span class="av-seq-gen-lbl">MUTATE</span>' +
    '<input type="range" class="av-seq-range" id="av-seq-mutate-amt" min="0" max="100" step="1" value="25" aria-label="Mutate amount %"><span class="av-seq-insp-val" data-gen-val="mutate">25%</span>' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-mutate-apply" title="avSeqMutate(seed from the pattern rng, amount) — hit re-placement, count preserved">MUTATE ▸</button>' +
    '</div>' +
    '<div class="av-seq-gen-row">' +
    '<span class="av-seq-gen-lbl">HUMAN</span>' +
    '<input type="range" class="av-seq-range" id="av-seq-humanize-amt" min="0" max="100" step="1" value="25" aria-label="Humanize amount %"><span class="av-seq-insp-val" data-gen-val="humanize">25%</span>' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-humanize-apply" title="avSeqHumanize(seed from the pattern rng, amount) — micro/gate/vel nudge">HUMANIZE ▸</button>' +
    '</div>' +
    '<div class="av-seq-gen-row"><span class="av-seq-gen-status" id="av-seq-gen-status" role="status">—</span></div>' +
    '</div>';
}

function avSeqUiSongRowHTML(row) {
  const i = row.i;
  let mutes = "";
  for (let t = 0; t < AV_SEQ_UI_TRACKS; t++) {
    const on = row.mutes[t] ? 1 : 0;
    mutes += '<button type="button" class="av-btn mini av-seq-songrow-mute' + (on ? " on" : "") + '" data-track="' + t + '"' +
      ' aria-pressed="' + (on ? "true" : "false") + '" aria-label="Row ' + (i + 1) + ' mute track ' + (t + 1) + '"' +
      ' title="Mute track ' + (t + 1) + ' for this row">' + (t + 1) + '</button>';
  }
  return '<li class="av-seq-songrow" data-row="' + i + '">' +
    '<span class="av-seq-songrow-idx">' + (i + 1) + '</span>' +
    '<span class="av-seq-songrow-ref" title="Pattern ref — v1 rows resolve to the live pattern">' + avSeqUiEsc(row.ref || "—") + '</span>' +
    '<input type="text" class="av-seq-songrow-label" data-song-field="label" maxlength="16" value="' + avSeqUiEsc(row.label) + '" spellcheck="false" placeholder="label" aria-label="Row ' + (i + 1) + ' label">' +
    '<input type="number" class="av-seq-num" data-song-field="repeats" min="1" max="256" step="1" value="' + row.repeats + '" aria-label="Row ' + (i + 1) + ' repeats (1..256)" title="Repeats 1..256">' +
    '<input type="number" class="av-seq-num" data-song-field="len" min="0" max="1024" step="1" value="' + row.len + '" aria-label="Row ' + (i + 1) + ' length (0 = inherit)" title="Row length — 0 inherit · 2..1024 steps">' +
    '<input type="number" class="av-seq-num" data-song-field="tempo" min="0" max="300" step="1" value="' + row.tempo + '" aria-label="Row ' + (i + 1) + ' tempo (0 = inherit)" title="Row tempo — 0 inherit · 20..300 bpm">' +
    '<span class="av-seq-songrow-mutes">' + mutes + '</span>' +
    '<button type="button" class="av-btn mini av-seq-btn av-seq-songrow-btn" data-song-up="1" aria-label="Move row ' + (i + 1) + ' up" title="Move row up">▲</button>' +
    '<button type="button" class="av-btn mini av-seq-btn av-seq-songrow-btn" data-song-dn="1" aria-label="Move row ' + (i + 1) + ' down" title="Move row down">▼</button>' +
    '<button type="button" class="av-btn mini av-seq-btn av-seq-songrow-btn" data-song-del="1" aria-label="Delete row ' + (i + 1) + '" title="Delete row">✕</button>' +
    '</li>';
}

function avSeqUiSongHTML() {
  return '<div class="av-seq-song">' +
    '<div class="av-seq-song-head"><span class="av-seq-insp-lbl">SONG</span>' +
    '<span class="av-seq-cap">chains · scenes · arrangement (v1 rows reference the live pattern)</span></div>' +
    '<ul class="av-seq-chains" id="av-seq-chains"></ul>' +
    '<div class="av-seq-song-actions">' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-song-add" title="Append a chain entry (avSeqChainsSnap/Load)">+ CHAIN</button>' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-song-clear" title="Clear the chain list">CLEAR</button>' +
    '</div>' +
    '<div class="av-seq-arrange">' +
    '<div class="av-seq-arrange-head"><span class="av-seq-insp-lbl">ARRANGER</span>' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-song-rows-add" title="Append a song row — ref = live pattern, repeats 1, mutes current, len 0, tempo 0">+ ROW</button>' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-song-play" aria-pressed="false" title="PLAY SONG — the song runner walks the rows (STOP SONG while it runs)">PLAY SONG</button>' +
    '<span class="av-seq-song-pos" id="av-seq-song-pos" role="status">—</span>' +
    '<span class="av-seq-song-quant-wrap"><span class="av-seq-gen-lbl">QUANT</span>' +
    '<select class="av-select av-seq-song-quant" id="av-seq-song-quant" aria-label="Scene recall quantisation — feeds the RECALL button and is stored as the recall default">' +
    '<option value="instant"' + (avSeqUiState.songQuant === "instant" ? " selected" : "") + '>INSTANT</option>' +
    '<option value="beat"' + (avSeqUiState.songQuant === "beat" ? " selected" : "") + '>BEAT</option>' +
    '<option value="cycle"' + (avSeqUiState.songQuant === "cycle" ? " selected" : "") + '>CYCLE</option>' +
    '</select></span>' +
    '</div>' +
    '<ul class="av-seq-song-rows" id="av-seq-song-rows"></ul>' +
    '<div class="av-seq-song-timeline" id="av-seq-song-timeline" style="display:flex" aria-label="Arrangement timeline — width ∝ row len × repeats"></div>' +
    '<div class="av-seq-song-export">' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-song-midi" title="Export the arrangement as a Standard MIDI File (avSongExportMidi)">EXPORT SONG MIDI</button>' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-song-json" title="Export the arrangement as JSON (avSongExportJson)">EXPORT SONG JSON</button>' +
    '<label class="av-btn mini av-seq-btn av-seq-song-openbtn" for="av-seq-song-open" title="Open a song JSON file (avSongImportJson)">OPEN JSON</label>' +
    '<input type="file" class="av-seq-song-file" id="av-seq-song-open" accept=".json,application/json" aria-label="Open a song JSON file" hidden>' +
    '<span class="av-seq-song-status" id="av-seq-song-status" role="status">—</span>' +
    '</div>' +
    '</div>' +
    '<div class="av-seq-scene-row">' +
    '<input type="text" class="av-seq-scene-name" id="av-seq-scene-name" spellcheck="false" placeholder="SCENE 1" aria-label="Scene name">' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-scene-cap" title="Capture the current pattern as a scene (avSeqSceneCapture)">CAPTURE</button>' +
    '<select class="av-select av-seq-scene-sel" id="av-seq-scene-sel" aria-label="Scene to recall"></select>' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-scene-recall" title="Recall the selected scene — quantised through the song runner while it plays">RECALL</button>' +
    '</div></div>';
}

function avSeqUiIoHTML() {
  return '<div class="av-seq-io">' +
    '<div class="av-seq-io-row">' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-export" title="Write avSeqPatternExport() into the textarea">EXPORT</button>' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-import" title="Load the textarea through avSeqPatternImport()">IMPORT</button>' +
    '</div>' +
    '<textarea class="av-seq-io-area" id="av-seq-io" spellcheck="false" rows="3" aria-label="Pattern JSON — export writes here, import reads here" placeholder="pattern JSON (export / import)"></textarea>' +
    '</div>';
}

function avSeqUiBodyHTML(snap) {
  return '<div class="av-seq" data-av-seq="1">' +
    '<div class="av-seq-head"><span class="av-seq-title">SEQUENCER</span>' +
    '<span class="av-seq-cap">16th step grid · per-track len / speed / swing · generative ops under GEN · arrangement rows under ARRANGER · commits ride avApplyParam / the core model</span></div>' +
    avSeqUiTransportHTML() +
    avSeqUiGridHTML(snap) +
    avSeqUiInspHTML() +
    avSeqUiGenHTML() +
    avSeqUiSongHTML() +
    avSeqUiIoHTML() +
    '</div>';
}

/* ---------- repaint ---------- */

function avSeqUiFmtVal(f, v) {
  if (f === "vel" || f === "gate") return (Math.round(avSeqUiNum(v, 0) * 100) / 100).toFixed(2);
  if (f === "prob") return String(Math.round(avSeqUiNum(v, 100))) + "%";
  if (f === "micro") { const n = Math.round(avSeqUiNum(v, 0)); return (n > 0 ? "+" : "") + String(n); }
  return String(v);
}

function avSeqUiPaintCell(cell, snap, sel, pos, lens) {
  const t = Math.floor(Number(cell.dataset.track)), s = Math.floor(Number(cell.dataset.step));
  let on = false, len = 0;
  try {
    const st = (snap && snap.tracks[t] && snap.tracks[t].steps) ? snap.tracks[t].steps[s] : null;
    on = !!(st && st.on);
    len = lens[t] || AV_SEQ_UI_DEFAULT_LEN;
  } catch (e) { on = false; len = AV_SEQ_UI_DEFAULT_LEN; }
  cell.classList.toggle("on", on);
  cell.setAttribute("aria-pressed", on ? "true" : "false");
  const isSel = !!(sel && sel.track === t && sel.step === s);
  cell.classList.toggle("sel", isSel);
  const cur = !!(pos && len > 0 && (((Math.floor(pos.step) % len) + len) % len) === s);
  cell.classList.toggle("cur", cur);
}

function avSeqUiPaintCur(host, pos) {
  const lens = avSeqUiState.lens.length === AV_SEQ_UI_TRACKS ? avSeqUiState.lens : [16, 16, 16, 16];
  const key = pos ? ("p" + Math.floor(pos.step) + ":" + lens.join(",")) : "off";
  if (key === avSeqUiState.curKey) return false;
  avSeqUiState.curKey = key;
  try {
    host.querySelectorAll(".av-seq-cell").forEach(cell => {
      const t = Math.floor(Number(cell.dataset.track)), s = Math.floor(Number(cell.dataset.step));
      const len = lens[t] || AV_SEQ_UI_DEFAULT_LEN;
      const cur = !!(pos && (((Math.floor(pos.step) % len) + len) % len) === s);
      cell.classList.toggle("cur", cur);
    });
  } catch (e) { return false; }
  return true;
}

function avSeqUiPaintPos(host, pos) {
  let el = null;
  try { el = host.querySelector("#av-seq-pos"); } catch (e) { el = null; }
  if (!el) return false;
  let txt = "BAR 1 · 01/16";
  if (pos && isFinite(pos.step)) {
    const step = Math.max(0, Math.floor(pos.step));
    txt = "BAR " + (Math.floor(step / 16) + 1) + " · " + String((step % 16) + 1).padStart(2, "0") + "/16";
  }
  if (txt !== avSeqUiState.posKey) { avSeqUiState.posKey = txt; el.textContent = txt; }
  return true;
}

function avSeqUiInspRefresh(host, snap) {
  try {
    const body = host.querySelector("#av-seq-insp-body");
    const empty = host.querySelector("#av-seq-insp-empty");
    const at = host.querySelector("#av-seq-insp-at");
    const sel = avSeqUiState.sel;
    let step = null;
    if (sel && snap) {
      try { step = (snap.tracks[sel.track] && snap.tracks[sel.track].steps) ? snap.tracks[sel.track].steps[sel.step] : null; } catch (e) { step = null; }
    }
    if (at) at.textContent = sel ? ("T" + (sel.track + 1) + " · " + (sel.step + 1)) : "—";
    if (body) body.hidden = !step;
    if (empty) empty.hidden = !!step;
    if (!step) return false;
    const setV = (id, v) => { const el = host.querySelector("#" + id); if (el) el.value = v; };
    const setC = (id, v) => { const el = host.querySelector("#" + id); if (el) el.checked = !!v; };
    setV("av-seq-insp-note", step.note || "c4");
    setV("av-seq-insp-vel", step.vel);
    setV("av-seq-insp-gate", step.gate);
    setV("av-seq-insp-prob", step.prob);
    setV("av-seq-insp-ratchet", step.ratchet);
    setV("av-seq-insp-micro", step.micro);
    setV("av-seq-insp-oct", step.oct);
    setV("av-seq-insp-cond", step.cond || "");
    setC("av-seq-insp-slide", step.slide);
    setC("av-seq-insp-accent", step.accent);
    host.querySelectorAll("[data-insp-val]").forEach(el => {
      const f = el.getAttribute("data-insp-val");
      if (f && step[f] != null) el.textContent = avSeqUiFmtVal(f, step[f]);
    });
    return true;
  } catch (e) { return false; }
}

/* the track header selects follow the snapshot (guarded reads — a missing swing field reads 0) */
function avSeqUiTrackCtlRefresh(host, snap) {
  try {
    const rows = host.querySelectorAll(".av-seq-row[data-track]");
    rows.forEach(function (rowEl) {
      const t = Math.floor(Number(rowEl.dataset.track));
      if (!isFinite(t)) return;
      const lenEl = rowEl.querySelector("[data-track-len]");
      const spdEl = rowEl.querySelector("[data-track-spd]");
      const swgEl = rowEl.querySelector("[data-track-swg]");
      const len = String(avSeqUiTrackLen(snap, t));
      const spd = String(avSeqUiTrackSpeed(snap, t));
      const swg = String(avSeqUiTrackSwing(snap, t));
      if (lenEl && lenEl.value !== len) lenEl.value = len;
      if (spdEl && spdEl.value !== spd) spdEl.value = spd;
      if (swgEl && swgEl.value !== swg) swgEl.value = swg;
    });
    return true;
  } catch (e) { return false; }
}

/* the GEN selectors follow the core's id list + the UI state (never clobbers a live edit) */
function avSeqUiGenRefresh(host) {
  try {
    const fillEl = host.querySelector("#av-seq-fill-id");
    if (fillEl) {
      const ids = avSeqUiFillIds();
      const key = "f:" + ids.join("|");
      if (key !== avSeqUiState.fillKey) {
        avSeqUiState.fillKey = key;
        let cur = (fillEl.value || avSeqUiState.fillId || "");
        if (ids.indexOf(cur) < 0) cur = ids.length ? ids[0] : "";
        fillEl.innerHTML = ids.map(id => '<option value="' + avSeqUiEsc(id) + '">' + avSeqUiEsc(id.toUpperCase()) + '</option>').join("");
        if (cur) fillEl.value = cur;
        avSeqUiState.fillId = cur;
      } else if (fillEl.value && ids.indexOf(fillEl.value) >= 0) {
        avSeqUiState.fillId = fillEl.value;
      }
    }
    const gt = host.querySelector("#av-seq-gen-track");
    if (gt) {
      const want = String(avSeqUiState.genTrack);
      if (gt.value !== want) gt.value = want;
      else { const t = Math.floor(Number(gt.value)); if (isFinite(t) && t >= 0 && t < AV_SEQ_UI_TRACKS) avSeqUiState.genTrack = t; }
    }
    const q = host.querySelector("#av-seq-song-quant");
    if (q && q.value !== avSeqUiState.songQuant) q.value = avSeqUiState.songQuant;
    const gs = host.querySelector("#av-seq-gen-status");
    if (gs && avSeqUiState.genMsg && gs.textContent !== avSeqUiState.genMsg) gs.textContent = avSeqUiState.genMsg;
    return true;
  } catch (e) { return false; }
}

function avSeqUiChainItems() {
  try {
    if (typeof avSeqChainsSnap === "function") {
      const a = avSeqChainsSnap();
      if (Array.isArray(a)) return a.slice(0, 32);
    }
  } catch (e) { /* no chains module */ }
  return [];
}

function avSeqUiChainText(item, i) {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const n = item.name != null ? item.name : (item.label != null ? item.label : "");
    if (n) return String(n);
    try { return JSON.stringify(item).slice(0, 60); } catch (e) { return "CHAIN " + (i + 1); }
  }
  return "CHAIN " + (i + 1);
}

function avSeqUiSceneNames() {
  try {
    if (typeof avSeqScenesSnap === "function") {
      const a = avSeqScenesSnap();
      if (Array.isArray(a)) {
        const out = [];
        for (let i = 0; i < a.length && out.length < 32; i++) {
          const x = a[i];
          if (typeof x === "string" && x) out.push(x);
          else if (x && typeof x === "object" && (x.name || x.id)) out.push(String(x.name || x.id));
        }
        return out;
      }
    }
  } catch (e) { /* no scenes module */ }
  return [];
}

function avSeqUiSongRefresh(host) {
  if (!host || !host.querySelector) return false;
  try {
    const chains = avSeqUiChainItems();
    const items = chains.map((c, i) => '<li class="av-seq-chain" data-idx="' + i + '">' + avSeqUiEsc(avSeqUiChainText(c, i)) + '</li>').join("");
    const box = host.querySelector("#av-seq-chains");
    if (box) {
      const key = "c" + chains.length + ":" + items.slice(0, 300);
      if (key !== avSeqUiState.chainKey) { avSeqUiState.chainKey = key; box.innerHTML = items; }
    }
    const names = avSeqUiSceneNames();
    const selEl = host.querySelector("#av-seq-scene-sel");
    if (selEl) {
      const key = "s:" + names.join("|");
      if (key !== avSeqUiState.sceneKey) {
        avSeqUiState.sceneKey = key;
        let cur = "";
        try { cur = selEl.value || ""; } catch (e) { cur = ""; }
        selEl.innerHTML = names.map(n => '<option value="' + avSeqUiEsc(n) + '">' + avSeqUiEsc(n) + '</option>').join("");
        if (names.indexOf(cur) >= 0) selEl.value = cur;
      }
    }
    /* M2: the song rows list + timeline strip (keyed rebuild — never clobbers a live edit) */
    let rows = [];
    try { if (typeof avSeqSongSnap === "function") rows = avSeqUiSongRowsModel(avSeqSongSnap()); } catch (e) { rows = []; }
    const rowsKey = "r" + rows.length + ":" + rows.map(r => [r.i, r.ref, r.label, r.repeats, r.len, r.tempo, r.mutes.join("")].join(",")).join(";").slice(0, 600);
    const rowsBox = host.querySelector("#av-seq-song-rows");
    if (rowsBox && rowsKey !== avSeqUiState.songRowsKey) {
      avSeqUiState.songRowsKey = rowsKey;
      rowsBox.innerHTML = rows.map(avSeqUiSongRowHTML).join("");
      const tl = host.querySelector("#av-seq-song-timeline");
      if (tl) tl.innerHTML = avSeqUiSongTimelineHTML(rows);
    }
    return true;
  } catch (e) { return false; }
}

function avSeqUiTransportRefresh(host, playing) {
  try {
    const play = host.querySelector("#av-seq-play");
    if (play) {
      play.classList.toggle("on", !!playing);
      play.setAttribute("aria-pressed", playing ? "true" : "false");
    }
    const mode = avSeqUiRecMode();
    avSeqUiState.recMode = mode;
    const rec = host.querySelector("#av-seq-rec");
    if (rec) {
      const armed = mode !== "off";
      rec.classList.toggle("on", armed);
      rec.setAttribute("aria-pressed", armed ? "true" : "false");
      rec.textContent = mode === "step" ? "REC·STEP" : mode === "live" ? "REC·LIVE" : "REC";
    }
    return true;
  } catch (e) { return false; }
}

/* full repaint from the core snapshot + live transport state (the rig and the parent call this
   after external writes; the card itself calls it after every edit) */
function avSeqUiSync() {
  const host = avSeqUiHost();
  if (!host) return false;
  try {
    const snap = avSeqUiPatternSnapshot();
    const lens = avSeqUiTrackLens(snap);
    let needBuild = false;
    try { needBuild = !host.querySelector(".av-seq-grid"); } catch (e) { needBuild = true; }
    if (!needBuild && avSeqUiState.lens.length === AV_SEQ_UI_TRACKS && avSeqUiState.lens.join(",") !== lens.join(",")) needBuild = true;
    if (needBuild) {
      host.innerHTML = avSeqUiBodyHTML(snap);
      if (typeof avKnobBind === "function") avKnobBind(host);
      avSeqUiState.curKey = "";
      avSeqUiState.posKey = "";
      avSeqUiState.sceneKey = "";
      avSeqUiState.chainKey = "";
      avSeqUiState.songRowsKey = "";
      avSeqUiState.songPosKey = "";
      avSeqUiState.fillKey = "";
    }
    avSeqUiState.lens = lens;
    const playing = avSeqUiIsPlaying();
    avSeqUiState.uiPlaying = playing;
    const sel = avSeqUiState.sel;
    const pos = playing ? avSeqUiPosition() : null;
    let cells = [];
    try { cells = host.querySelectorAll(".av-seq-cell"); } catch (e) { cells = []; }
    cells.forEach(cell => avSeqUiPaintCell(cell, snap, sel, pos, lens));
    avSeqUiPaintPos(host, pos);
    avSeqUiTransportRefresh(host, playing);
    avSeqUiInspRefresh(host, snap);
    avSeqUiTrackCtlRefresh(host, snap);
    avSeqUiGenRefresh(host);
    avSeqUiSongRefresh(host);
    avSeqUiSongPlaybackRefresh(host);
    /* keep every knob on the card honest to the mirror (BPM is the only one today) */
    try {
      const knob = host.querySelector('.av-knob[data-knob="bpm"]');
      if (knob && typeof avParams !== "undefined" && avParams && isFinite(avParams["bpm"])) {
        if (typeof avKnobApplyVisual === "function") avKnobApplyVisual(knob, avParams["bpm"]);
        if (typeof avKnobFormat === "function") {
          host.querySelectorAll('[data-kval="bpm"]').forEach(n => { n.textContent = avKnobFormat(avParams["bpm"], { fmt: "int" }); });
        }
      }
    } catch (e) { /* mirror absent */ }
    return true;
  } catch (e) {
    console.warn("[anvil] seq sync failed", e);
    return false;
  }
}

/* ---------- pattern IO (the pinned §4 JSON path) ---------- */

function avSeqUiExport() {
  let txt = "";
  try {
    if (typeof avSeqPatternExport === "function") {
      const s = avSeqPatternExport();
      if (typeof s === "string" && s) txt = s;
    }
  } catch (e) { txt = ""; }
  if (!txt) {
    const snap = avSeqUiPatternSnapshot();
    if (snap) { try { txt = JSON.stringify(snap); } catch (e) { txt = ""; } }
  }
  avSeqUiState.lastExport = txt;
  try {
    const host = avSeqUiHost();
    const area = host ? host.querySelector("#av-seq-io") : null;
    if (area) area.value = txt;
  } catch (e) { /* no host */ }
  return txt;
}

function avSeqUiImport() {
  let txt = "";
  try {
    const host = avSeqUiHost();
    const area = host ? host.querySelector("#av-seq-io") : null;
    if (area && typeof area.value === "string" && area.value.trim()) txt = area.value;
  } catch (e) { txt = ""; }
  if (!txt) txt = avSeqUiState.lastExport || "";
  let ok = false;
  try {
    if (typeof avSeqPatternImport === "function") ok = avSeqPatternImport(txt) === true;
    else {
      let obj = null;
      try { obj = JSON.parse(txt); } catch (e) { obj = null; }
      ok = obj ? avSeqUiPatternLoad(obj) : false;
    }
  } catch (e) { ok = false; }
  if (ok) {
    try { if (typeof avUndoPush === "function") avUndoPush("seq", "import"); } catch (e) { /* F optional */ }
    avSeqUiSchedPush(); avSeqUiSync();
  }
  return ok;
}

/* ---------- song actions ---------- */

function avSeqUiChainAdd() {
  let ok = false;
  try {
    const items = avSeqUiChainItems();
    let name = "CHAIN " + (items.length + 1);
    try {
      const snap = avSeqUiPatternSnapshot();
      if (snap && snap.name) name = "CHAIN " + (items.length + 1) + " · " + String(snap.name).slice(0, 24);
    } catch (e) { /* name nicety */ }
    if (typeof avSeqChainsLoad === "function") ok = avSeqChainsLoad(items.concat([{ name: name }])) !== false;
  } catch (e) { ok = false; }
  if (ok) { try { if (typeof avUndoPush === "function") avUndoPush("seq", "chain"); } catch (e) { /* F optional */ } }
  avSeqUiSongRefresh(avSeqUiHost());
  return ok;
}

function avSeqUiChainClear() {
  let ok = false;
  try { if (typeof avSeqChainsLoad === "function") ok = avSeqChainsLoad([]) !== false; } catch (e) { ok = false; }
  if (ok) { try { if (typeof avUndoPush === "function") avUndoPush("seq", "chain"); } catch (e) { /* F optional */ } }
  avSeqUiSongRefresh(avSeqUiHost());
  return ok;
}

function avSeqUiSceneCaptureUI() {
  const host = avSeqUiHost();
  let ok = false;
  try {
    let name = "";
    try {
      const input = host ? host.querySelector("#av-seq-scene-name") : null;
      if (input && typeof input.value === "string") name = input.value.trim().slice(0, 32);
    } catch (e) { name = ""; }
    if (!name) name = "SCENE " + (avSeqUiSceneNames().length + 1);
    if (typeof avSeqSceneCapture === "function") ok = avSeqSceneCapture(name) !== false;
  } catch (e) { ok = false; }
  avSeqUiSongRefresh(host);
  return ok;
}

/* RECALL: the song runner's quantised path while it plays (the runner pushes its own ONE
   checkpoint per applied recall — §2.6), else the immediate avSeqSceneRecall + undo AFTER */
function avSeqUiSceneRecallUI() {
  const host = avSeqUiHost();
  let ok = false;
  try {
    const selEl = host ? host.querySelector("#av-seq-scene-sel") : null;
    const name = (selEl && selEl.value) ? String(selEl.value) : "";
    if (name) {
      if (avSeqUiSongPlaying() && typeof avSongSceneRecall === "function") {
        const quant = avSeqUiQuantRead(host);
        const r = avSongSceneRecall(name, quant);
        ok = !!(r && typeof r === "object" ? r.ok !== false : true);
      } else if (typeof avSeqSceneRecall === "function") {
        ok = avSeqSceneRecall(name) !== false;
        if (ok) { try { if (typeof avUndoPush === "function") avUndoPush("seq", "scene"); } catch (e) { /* F optional */ } }
      }
    }
  } catch (e) { ok = false; }
  if (ok) avSeqUiSync();
  return ok;
}

/* ---------- transport + capture ---------- */

function avSeqUiTransport(what) {
  let ok = false;
  try {
    if (what === "play") {
      if (typeof avSeqUiSchedPush === "function") avSeqUiSchedPush();   /* play what you see: the sched gets the current snapshot first */
      if (typeof avSeqPlay === "function") { avSeqPlay(); ok = true; }
    }
    else if (what === "stop") { if (typeof avSeqStop === "function") { avSeqStop(); ok = true; } }
  } catch (e) { ok = false; }
  avSeqUiState.uiPlaying = (what === "play");
  avSeqUiSync();
  return ok;
}

function avSeqUiRecCycle() {
  const cur = avSeqUiRecMode();
  const next = cur === "off" ? "step" : cur === "step" ? "live" : "off";
  let ok = false;
  try { if (typeof avSeqCaptureArm === "function") ok = avSeqCaptureArm(next) !== false; } catch (e) { ok = false; }
  avSeqUiState.recMode = ok ? next : cur;
  avSeqUiSync();
  return ok;
}

/* ---------- wiring (delegated, bound ONCE per host element) ---------- */

function avSeqUiClick(e) {
  try {
    const t = (e && e.target && typeof e.target.closest === "function") ? e.target : null;
    if (!t) return;
    if (t.closest("#av-seq-play")) { avSeqUiTransport("play"); return; }
    if (t.closest("#av-seq-stop")) { avSeqUiTransport("stop"); return; }
    if (t.closest("#av-seq-rec")) { avSeqUiRecCycle(); return; }
    const cell = t.closest(".av-seq-cell");
    if (cell) { avSeqUiCellClick(cell); return; }
    const mute = t.closest(".av-seq-row-mute");
    if (mute) { avSeqUiMuteToggle(mute); return; }
    if (t.closest("#av-seq-insp-del")) { avSeqUiInspClear(); return; }
    if (t.closest("#av-seq-song-add")) { avSeqUiChainAdd(); return; }
    if (t.closest("#av-seq-song-clear")) { avSeqUiChainClear(); return; }
    if (t.closest("#av-seq-scene-cap")) { avSeqUiSceneCaptureUI(); return; }
    if (t.closest("#av-seq-scene-recall")) { avSeqUiSceneRecallUI(); return; }
    if (t.closest("#av-seq-export")) { avSeqUiExport(); return; }
    if (t.closest("#av-seq-import")) { avSeqUiImport(); return; }
    /* M2 — the GEN block */
    if (t.closest("#av-seq-euclid-apply")) { avSeqUiGenEuclid(); return; }
    if (t.closest("#av-seq-mutate-apply")) { avSeqUiGenMutate(); return; }
    if (t.closest("#av-seq-humanize-apply")) { avSeqUiGenHumanize(); return; }
    if (t.closest("#av-seq-fill-apply")) { avSeqUiGenFill(); return; }
    /* M2 — the arranger */
    if (t.closest("#av-seq-song-rows-add")) { avSeqUiSongRowAdd(); return; }
    if (t.closest("#av-seq-song-play")) { avSeqUiSongPlayToggle(); return; }
    if (t.closest("#av-seq-song-midi")) { avSeqUiSongExportMidi(); return; }
    if (t.closest("#av-seq-song-json")) { avSeqUiSongExportJson(); return; }
    const srow = t.closest(".av-seq-songrow");
    if (srow) {
      if (t.closest("[data-song-up]")) { avSeqUiSongRowMove(srow, -1); return; }
      if (t.closest("[data-song-dn]")) { avSeqUiSongRowMove(srow, +1); return; }
      if (t.closest("[data-song-del]")) { avSeqUiSongRowDel(srow); return; }
      const sm = t.closest(".av-seq-songrow-mute");
      if (sm) { avSeqUiSongRowMuteToggle(sm); return; }
    }
  } catch (err) { /* a listener never throws outward */ }
}

function avSeqUiChange(e) {
  try {
    const t = (e && e.target && typeof e.target.closest === "function") ? e.target : null;
    if (!t) return;
    /* M2 — track header controls */
    const tl = t.closest("[data-track-len]");
    if (tl) { avSeqUiTrackCtlEdit(tl, "len"); return; }
    const tsp = t.closest("[data-track-spd]");
    if (tsp) { avSeqUiTrackCtlEdit(tsp, "spd"); return; }
    const tsw = t.closest("[data-track-swg]");
    if (tsw) { avSeqUiTrackCtlEdit(tsw, "swg"); return; }
    /* M2 — gen + quant selectors (UI state only) */
    if (t.closest("#av-seq-gen-track")) {
      const v = Math.floor(Number(t.value));
      if (isFinite(v) && v >= 0 && v < AV_SEQ_UI_TRACKS) avSeqUiState.genTrack = v;
      return;
    }
    if (t.closest("#av-seq-fill-id")) {
      const id = String(t.value || "").trim().toLowerCase();
      if (avSeqUiFillIds().indexOf(id) >= 0) avSeqUiState.fillId = id;
      return;
    }
    if (t.closest("#av-seq-song-quant")) {
      avSeqUiState.songQuant = avSeqUiQuantNorm(t.value);
      return;
    }
    /* M2 — song rows */
    const sf = t.closest("[data-song-field]");
    if (sf) { avSeqUiSongRowField(sf); return; }
    if (t.closest("#av-seq-song-open")) { avSeqUiSongOpenFile(t); return; }
    /* the P4 inspector fields */
    const el = t.closest("[data-insp-field]");
    if (!el) return;
    const sel = avSeqUiState.sel;
    if (!sel) return;
    const f = String(el.getAttribute("data-insp-field") || "");
    if (!f || AV_SEQ_UI_FIELDS.indexOf(f) < 0) return;
    let v;
    if (el.type === "checkbox") v = el.checked ? 1 : 0;
    else if (f === "note" || f === "cond") v = el.value;
    else v = Number(el.value);
    const patch = {};
    patch[f] = v;
    avSeqUiStepEdit(sel.track, sel.step, patch);
  } catch (err) { /* a listener never throws outward */ }
}

/* live readouts for the GEN amount ranges (no model edit on input) */
function avSeqUiInput(e) {
  try {
    const t = (e && e.target && typeof e.target.closest === "function") ? e.target : null;
    if (!t) return;
    const kind = t.closest("#av-seq-mutate-amt") ? "mutate" : (t.closest("#av-seq-humanize-amt") ? "humanize" : "");
    if (!kind) return;
    const host = avSeqUiHost();
    const el = host ? host.querySelector('[data-gen-val="' + kind + '"]') : null;
    if (el) el.textContent = String(Math.max(0, Math.min(100, avSeqUiInt(t.value, 25)))) + "%";
  } catch (err) { /* a listener never throws outward */ }
}

function avSeqUiWire(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  try {
    if (host.dataset && host.dataset.avSeqUiWired === "1") return true;   /* one delegation per host element */
    if (host.dataset) host.dataset.avSeqUiWired = "1";
    host.addEventListener("click", avSeqUiClick);
    host.addEventListener("change", avSeqUiChange);
    host.addEventListener("input", avSeqUiInput);
    return true;
  } catch (e) { return false; }
}

/* ---------- the playhead loop (rAF; no document listeners — av_kb owns the ONE keydown path) ---------- */

function avSeqUiLoopBody() {
  if (!avSeqUiState.inited) return false;
  const host = avSeqUiHost();
  if (!host) return false;
  const playing = avSeqUiIsPlaying();
  const songOn = avSeqUiSongPlaying();
  if (playing !== avSeqUiState.uiPlaying) { avSeqUiState.uiPlaying = playing; avSeqUiSync(); return true; }
  if (songOn !== avSeqUiState.uiSongPlaying) { avSeqUiState.uiSongPlaying = songOn; avSeqUiSync(); return true; }
  if (!playing && !songOn) return false;
  const pos = playing ? avSeqUiPosition() : null;
  if (playing) {
    avSeqUiPaintCur(host, pos);
    avSeqUiPaintPos(host, pos);
  }
  if (songOn) avSeqUiSongPlaybackRefresh(host);
  return true;
}

function avSeqUiLoop() {
  try { avSeqUiLoopBody(); } catch (e) { /* never break the frame */ }
  try {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(avSeqUiLoop);
    else avSeqUiState.rafOn = false;
  } catch (e) { avSeqUiState.rafOn = false; }
}

function avSeqUiStartLoop() {
  if (avSeqUiState.rafOn) return false;
  if (typeof requestAnimationFrame !== "function") return false;
  avSeqUiState.rafOn = true;
  try { requestAnimationFrame(avSeqUiLoop); } catch (e) { avSeqUiState.rafOn = false; return false; }
  return true;
}

/* ---------- init (mount, re-mountable) ---------- */

function avSeqUiInit() {
  const host = avSeqUiHost();
  if (!host) return false;
  if (typeof avKnobHTML !== "function" || typeof avKnobRowHTML !== "function" || typeof avKnobBind !== "function") return false;
  if (typeof avParams === "undefined" || !avParams) return false;
  try {
    /* seed the mirror (unset paths only — the LEVELS idiom; a re-mount never clobbers) */
    if (!("bpm" in avParams)) {
      let bpm = 120;
      try { if (typeof avState !== "undefined" && avState && isFinite(avState.bpm)) bpm = avState.bpm; } catch (e) { bpm = 120; }
      avParams["bpm"] = Math.max(20, Math.min(300, bpm));
    }
    const snap = avSeqUiPatternSnapshot();
    host.innerHTML = avSeqUiBodyHTML(snap);
    avKnobBind(host);
    avSeqUiWire(host);
    avSeqUiState.inited = true;
    avSeqUiState.mounts += 1;
    avSeqUiState.lens = avSeqUiTrackLens(snap);
    avSeqUiState.curKey = ""; avSeqUiState.posKey = ""; avSeqUiState.sceneKey = ""; avSeqUiState.chainKey = "";
    avSeqUiState.songRowsKey = ""; avSeqUiState.songPosKey = ""; avSeqUiState.fillKey = "";
    avSeqUiSync();
    avSeqUiStartLoop();
    return true;
  } catch (e) {
    console.warn("[anvil] seq card mount failed", e);
    return false;
  }
}

/* ---------- observables ---------- */

function avSeqUiSnap() {
  const host = avSeqUiHost();
  const snap = {
    version: AV_SEQ_UI_VERSION,
    inited: !!avSeqUiState.inited,
    mounts: avSeqUiState.mounts,
    host: !!host,
    wired: !!(host && host.dataset && host.dataset.avSeqUiWired === "1"),
    card: !!(host && host.querySelector && host.querySelector(".av-seq")),
    rows: 0, cells: 0, cellsOn: 0, cur: 0,
    sel: avSeqUiState.sel ? { track: avSeqUiState.sel.track, step: avSeqUiState.sel.step } : null,
    playing: avSeqUiIsPlaying(),
    recMode: avSeqUiRecMode(),
    lens: avSeqUiState.lens.slice(),
    classes: avSeqUiClasses(),
  };
  try {
    if (host && host.querySelectorAll) {
      snap.rows = host.querySelectorAll(".av-seq-row[data-track]").length;
      const cells = host.querySelectorAll(".av-seq-cell");
      snap.cells = cells.length;
      cells.forEach(c => {
        if (c.classList.contains("on")) snap.cellsOn++;
        if (c.classList.contains("cur")) snap.cur++;
      });
    }
  } catch (e) { /* no DOM */ }
  /* M2 observability (additive) */
  try {
    const pat = avSeqUiPatternSnapshot();
    const tracks = [];
    for (let t = 0; t < AV_SEQ_UI_TRACKS; t++) tracks.push({ len: avSeqUiTrackLen(pat, t), speed: avSeqUiTrackSpeed(pat, t), swing: avSeqUiTrackSwing(pat, t) });
    let songRows = 0;
    try { if (typeof avSeqSongSnap === "function") songRows = avSeqUiSongRowsModel(avSeqSongSnap()).length; } catch (e) { songRows = 0; }
    snap.ctl = {
      tracks: tracks,
      genTrack: avSeqUiState.genTrack,
      fill: avSeqUiState.fillId || avSeqUiFillIdRead(host),
      songQuant: avSeqUiState.songQuant,
      songPlaying: avSeqUiSongPlaying(),
      songRows: songRows,
    };
  } catch (e) { snap.ctl = null; }
  return snap;
}

function avSeqUiClasses() {
  return [
    "av-seq", "av-seq-head", "av-seq-title", "av-seq-cap", "av-seq-transport", "av-seq-btn",
    "av-seq-pos", "av-seq-bpm",
    "av-seq-gridwrap", "av-seq-grid", "av-seq-row", "av-seq-row-lbl", "av-seq-row-mute",
    "av-seq-track-ctl", "av-seq-tsel",
    "av-seq-cell", "on", "cur", "sel",
    "av-seq-insp", "av-seq-insp-head", "av-seq-insp-at", "av-seq-insp-empty", "av-seq-insp-body",
    "av-seq-insp-row", "av-seq-insp-lbl", "av-seq-insp-ctl", "av-seq-insp-val",
    "av-seq-range", "av-seq-check",
    "av-seq-gen", "av-seq-gen-head", "av-seq-gen-row", "av-seq-gen-lbl", "av-seq-gen-status", "av-seq-num",
    "av-seq-song", "av-seq-song-head", "av-seq-chains", "av-seq-chain", "av-seq-song-actions",
    "av-seq-arrange", "av-seq-arrange-head", "av-seq-song-pos", "av-seq-song-quant", "av-seq-song-quant-wrap",
    "av-seq-song-rows", "av-seq-songrow", "av-seq-songrow-idx", "av-seq-songrow-ref", "av-seq-songrow-label",
    "av-seq-songrow-mutes", "av-seq-songrow-mute", "av-seq-songrow-btn",
    "av-seq-song-timeline", "av-seq-tl-block",
    "av-seq-song-export", "av-seq-song-file", "av-seq-song-openbtn", "av-seq-song-status",
    "av-seq-scene-row", "av-seq-scene-name", "av-seq-scene-sel",
    "av-seq-io", "av-seq-io-row", "av-seq-io-area",
  ];
}

/* ---------- debug/verify handle ---------- */

if (typeof window !== "undefined") {
  window.__avSeqUi = {
    version: AV_SEQ_UI_VERSION,
    init: () => avSeqUiInit(),
    sync: () => avSeqUiSync(),
    classes: () => avSeqUiClasses(),
    export: () => avSeqUiExport(),
    import: () => avSeqUiImport(),
    snap: () => avSeqUiSnap(),
    select: (t, s) => avSeqUiSelect(t, s),
  };
}
