/* Anvil — SEQUENCER card (P4 wave, child C): the step-sequencer UI mounted into the parent-owned
   host `#av-seq-host` (the parent card is `#av-seq` — the parent adds both; this module only
   fills the host). Per verify/_p4_wave.md §3.3.

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

   No DOM at top level (loads in plain node: no document/window reach until a function runs).
   ONE namespace avSeqUi* / AV_SEQ_UI_*. Never throws. ONE writer (child C). */

"use strict";

const AV_SEQ_UI_VERSION = "p4.0";
const AV_SEQ_UI_TRACKS = 4;
const AV_SEQ_UI_DEFAULT_LEN = 16;
const AV_SEQ_UI_MAX_LEN = 64;
const AV_SEQ_UI_FIELDS = ["on", "note", "vel", "gate", "slide", "accent", "oct", "prob", "cond", "ratchet", "micro"];

const avSeqUiState = {
  inited: false, mounts: 0, uiPlaying: false, rafOn: false,
  local: null,                 /* fallback model when av_seq_core is not loaded (harness / early boot) */
  sel: null,                   /* {track, step} selected cell, or null */
  lens: [],                    /* per-track cell counts at last grid build */
  curKey: "", posKey: "", lastExport: "", recMode: "off",
  notes: null, sceneKey: "", chainKey: "",
};

/* ---------- small helpers (pure; no DOM) ---------- */

const avSeqUiEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const avSeqUiNum = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };

function avSeqUiDeepCopy(x) {
  try { return JSON.parse(JSON.stringify(x)); } catch (e) { return null; }
}

/* the local fallback pattern (only used when the core module is absent) — §4 shape */
function avSeqUiLocalDefault() {
  const tracks = [];
  for (let t = 0; t < AV_SEQ_UI_TRACKS; t++) {
    const steps = [];
    for (let s = 0; s < AV_SEQ_UI_MAX_LEN; s++) {
      steps.push({ on: 0, note: "c4", vel: 0.8, gate: 0.95, slide: 0, accent: 0, oct: 0, prob: 100, cond: "", ratchet: 1, micro: 0 });
    }
    tracks.push({ len: AV_SEQ_UI_DEFAULT_LEN, speed: 1, mute: 0, steps: steps });
  }
  return { v: 1, name: "PAT 1", bpm: 120, grid: "16", swing: 66, tracks: tracks, plocks: [], rng: 305419896 };
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

function avSeqUiSongHTML() {
  return '<div class="av-seq-song">' +
    '<div class="av-seq-song-head"><span class="av-seq-insp-lbl">SONG</span>' +
    '<span class="av-seq-cap">chains · scenes (song rows land via the parent when A exposes them)</span></div>' +
    '<ul class="av-seq-chains" id="av-seq-chains"></ul>' +
    '<div class="av-seq-song-actions">' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-song-add" title="Append a chain entry (avSeqChainsSnap/Load)">+ CHAIN</button>' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-song-clear" title="Clear the chain list">CLEAR</button>' +
    '</div>' +
    '<div class="av-seq-scene-row">' +
    '<input type="text" class="av-seq-scene-name" id="av-seq-scene-name" spellcheck="false" placeholder="SCENE 1" aria-label="Scene name">' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-scene-cap" title="Capture the current pattern as a scene (avSeqSceneCapture)">CAPTURE</button>' +
    '<select class="av-select av-seq-scene-sel" id="av-seq-scene-sel" aria-label="Scene to recall"></select>' +
    '<button type="button" class="av-btn mini av-seq-btn" id="av-seq-scene-recall" title="Recall the selected scene">RECALL</button>' +
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
    '<span class="av-seq-cap">16th step grid · swing / prob / ratchet ride the core · p-lock lanes live under the inspector (lane module) · commits ride avApplyParam / the core model</span></div>' +
    avSeqUiTransportHTML() +
    avSeqUiGridHTML(snap) +
    avSeqUiInspHTML() +
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
    avSeqUiSongRefresh(host);
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
  avSeqUiSongRefresh(avSeqUiHost());
  return ok;
}

function avSeqUiChainClear() {
  let ok = false;
  try { if (typeof avSeqChainsLoad === "function") ok = avSeqChainsLoad([]) !== false; } catch (e) { ok = false; }
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

function avSeqUiSceneRecallUI() {
  let ok = false;
  try {
    const host = avSeqUiHost();
    const selEl = host ? host.querySelector("#av-seq-scene-sel") : null;
    const name = (selEl && selEl.value) ? String(selEl.value) : "";
    if (name && typeof avSeqSceneRecall === "function") ok = avSeqSceneRecall(name) !== false;
  } catch (e) { ok = false; }
  if (ok) avSeqUiSync();
  return ok;
}

/* ---------- transport + capture ---------- */

function avSeqUiTransport(what) {
  let ok = false;
  try {
    if (what === "play") { if (typeof avSeqPlay === "function") { avSeqPlay(); ok = true; } }
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
  } catch (err) { /* a listener never throws outward */ }
}

function avSeqUiChange(e) {
  try {
    const t = (e && e.target && typeof e.target.closest === "function") ? e.target : null;
    if (!t) return;
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

function avSeqUiWire(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  try {
    if (host.dataset && host.dataset.avSeqUiWired === "1") return true;   /* one delegation per host element */
    if (host.dataset) host.dataset.avSeqUiWired = "1";
    host.addEventListener("click", avSeqUiClick);
    host.addEventListener("change", avSeqUiChange);
    return true;
  } catch (e) { return false; }
}

/* ---------- the playhead loop (rAF; no document listeners — av_kb owns the ONE keydown path) ---------- */

function avSeqUiLoopBody() {
  if (!avSeqUiState.inited) return false;
  const host = avSeqUiHost();
  if (!host) return false;
  const playing = avSeqUiIsPlaying();
  if (playing !== avSeqUiState.uiPlaying) { avSeqUiState.uiPlaying = playing; avSeqUiSync(); return true; }
  if (!playing) return false;
  const pos = avSeqUiPosition();
  avSeqUiPaintCur(host, pos);
  avSeqUiPaintPos(host, pos);
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
  return snap;
}

function avSeqUiClasses() {
  return [
    "av-seq", "av-seq-head", "av-seq-title", "av-seq-cap", "av-seq-transport", "av-seq-btn",
    "av-seq-pos", "av-seq-bpm",
    "av-seq-gridwrap", "av-seq-grid", "av-seq-row", "av-seq-row-lbl", "av-seq-row-mute",
    "av-seq-cell", "on", "cur", "sel",
    "av-seq-insp", "av-seq-insp-head", "av-seq-insp-at", "av-seq-insp-empty", "av-seq-insp-body",
    "av-seq-insp-row", "av-seq-insp-lbl", "av-seq-insp-ctl", "av-seq-insp-val",
    "av-seq-range", "av-seq-check",
    "av-seq-song", "av-seq-song-head", "av-seq-chains", "av-seq-chain", "av-seq-song-actions",
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
