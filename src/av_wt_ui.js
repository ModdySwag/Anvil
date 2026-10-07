/* Anvil — WT EDITOR card (M1 wave, child sa-F): the wavetable-authoring card mounted into the
   parent-owned host `#av-wt-host` (the parent adds the `#av-wt` card + host after `#av-sample`
   at integration and calls avWtUiInit()); this module only fills the host. Per verify/_m1_wave.md
   §2.6. The authoring core it drives is sa-E's `src/av_wt.js` — WE CODE AGAINST THE PINNED §2.5
   NAMES EXACTLY, every call typeof-guarded PER CALL (the core may load after this file, or not
   at all: absent core = the card still mounts, every action refuses honestly, no throw paths).

   WHAT THIS CARD IS — one editor surface over one wavetable (a `table` object owned by av_wt.js):
     · CANVAS   `#av-wt-canvas` — a 2D strip whose x axis IS the sample domain: 2048 logical
                samples, full frame height maps to ±1 (8% headroom — the av_sample.js amp law).
                DPR-scaled (backing store = CSS box x devicePixelRatio, clamped 1..4, refitted
                only when it differs), resize-aware (ResizeObserver when present, window resize
                always). Pointer gestures paint inside guarded handlers:
                  draw   = freehand, samples under the stroke are set on every move;
                  line   = drag A->B, the straight line between the two sample values is filled;
                  smooth = drag across a region (a click smooths the whole frame) — 3-point
                           moving average, up to 4 passes;
                  every mutating gesture commits on pointerup: the frame is PEAK-NORMALISED
                  to 0.95 (the §2.5 mip law gain) and written through avWtSetFrame.
                Redraws happen on frame switch, morph, trim, resize, sync — nothing on init.
     · TOOLS    `#av-wt-tool` — [data-tool] buttons: draw · line · smooth (modes, aria-pressed)
                and normalise · undo-lite (one-step actions). UNDO-lite keeps ONE snapshot
                (table+frame+samples) taken before every mutation.
     · FRAMES   `#av-wt-frames` — `#av-wt-frame-add` plus per-frame chips `[data-frame="i"]`
                (each chip = pick button + a delete ✕; the last frame refuses to be deleted).
     · MORPH    `#av-wt-morph` (the range input, 0..100) blends the CURRENT frame (A) toward
                `#av-wt-morph-b` (the B select) via avWtMorph(t, cur, b, x) and PREVIEWS the
                baked frame on the canvas (mode "morph"; the preview never touches the table);
                BAKE (`#av-wt-morph-bake`, an extra control) writes the preview into the frame.
     · SPECTRAL `#av-wt-harmonics` (range 1..1024) — the harmonic-trim tool: keep harmonics
                1..N, zero everything above AND the DC bin (matching the §2.5 mip law's
                "DC and bin > 1024 zeroed" reading), analysis-FFT -> zero -> IFFT, then written
                via avWtSetFrame. Applied on release (change); the readout updates on input.
     · LIBRARY  `#av-wt-lib` — rows `[data-lib-id]` from avWtLibraryList() with LOAD / INSTALL /
                DELETE buttons; refreshed after installs and deletes (sync or promise lists are
                both settled).
     · ACTIONS  `#av-wt-new` · `#av-wt-import` (+ the hidden file input `#av-wt-import-file`,
                accept=".wt,.json") · `#av-wt-export` · `#av-wt-install` · `#av-wt-audition`.
                INSTALL: avWtInstall(table) -> sets osc2.type to wt.userN for the RECEIPT's slot
                (last-installed fallback), mirroring the value into avParams first and calling
                avApplyParam("osc2.type", ...) (CustomEvent "av-param" fallback without the app
                core), then avSynthOscOptionsRefresh() if that hook exists (the parent adds it).
                AUDITION: install to a free slot + one short c4 note through avNoteDown/avNoteUp
                (~600 ms; one audition at a time; the note bus is typeof-guarded).
     · STATUS   `#av-wt-status` (role=status, aria-live=polite) — every refusal is a plain line.
     · NAME     `#av-wt-name` (an extra control) renames the current table (guarded write; a
                frozen table refuses honestly).

   PINNED IDS (rig + parent rely on these; exact): #av-wt-canvas · #av-wt-tool [data-tool] ·
   #av-wt-frames · #av-wt-frame-add · [data-frame="i"] · #av-wt-morph (the range input) ·
   #av-wt-morph-b · #av-wt-harmonics · #av-wt-lib [data-lib-id] · #av-wt-new · #av-wt-import ·
   #av-wt-export · #av-wt-install · #av-wt-audition · #av-wt-status. EXTRA ids (documented, the
   parent does not need them): #av-wt-name · #av-wt-chips · #av-wt-morph-val · #av-wt-morph-bake ·
   #av-wt-harm-val · #av-wt-canvas-cap · #av-wt-import-file. The morph pin is read as "the range
   input carries #av-wt-morph" (an A/B + range control where A = the frame being edited, B = the
   select); the section around it is class-only (.av-wt-morph-sec).

   INSTALL vs LIBRARY (the one flow the pins leave to this card): INSTALL persists the table via
   avWtLibrarySave(table) UNLESS the library already lists an entry with the same name (a plain
   name-compare upsert guard — re-installing a library table can never duplicate rows); AUDITION
   never touches the library or osc2.type. Loading a table from the library also makes it the
   current editing table.

   TABLE ACCESS LAW (sa-E owns the table internals; §2.5 pins no getter): reading a frame tries,
   in order, t.frames[i] (typed/array-like) · t.getFrame(i) · avWtMorph(t, i, i, 0); writing
   ALWAYS prefers the pinned avWtSetFrame(t, i, f64_2048) and only falls back to an in-place
   write when the table exposes a live frames array. If a frame cannot be read, the editor works
   from a silence draft and says so; if the write path refuses, the status line says so.

   LAWS (house): 'use strict'; classic script; ONE namespace avWtUi* / wtUi* / AV_WT_UI_*;
   NO DOM at top level (every touch sits inside a guarded function); node-loadable (zero DOM at
   load — the harness loads this text in a Function scope); never throws outward; no console
   noise; no new AudioContext (this card makes NO sound of its own — audition rides the note
   bus); deterministic (no randomness).

   STYLES the parent should generate from avWtUiClasses() (the list below is the contract):
   .av-wt { display:flex; flex-direction:column; gap:8px; }  · .av-wt-canvas { width:100%;
   height:160px; display:block; touch-action:none; cursor:crosshair; background:#101416;
   border:1px solid var(--hair); border-radius:6px; }  · .av-wt-tool, .av-wt-frames,
   .av-wt-actions, .av-wt-morph-sec, .av-wt-spec, .av-wt-lib-row { display:flex; align-items:
   center; gap:6px; flex-wrap:wrap; }  · .av-wt-lib-row { justify-content:space-between; } ·
   .av-wt-chip { display:inline-flex; }  · .av-wt-chip-on the pick gets the teal "on" look
   (the .av-btn.on rule) · .av-wt-chip-x { a 22px mini button } · .av-wt-range { flex:1;
   min-width:120px; }  · .av-wt-err { color:#ff8f6e; }  · .av-wt-file { display:none; }.

   OBSERVABLES: avWtUiInit() -> bool (false without #av-wt-host; idempotent; re-mountable) ·
   avWtUiSnap() -> the honest card state (JSON-safe: never a DOM node, never a buffer copy) ·
   avWtUiClasses() -> string[] (the NEW css classes; the parent styles them) ·
   avWtUiSync(root) -> bool (full repaint from the module mirror; root defaults to #av-wt-host) ·
   window.__avWtUi = { version, state, init, snap, classes, sync }.

   ONE writer (child sa-F). DOM touches live only inside guarded functions. */

"use strict";

const AV_WT_UI_VERSION = "m1.0";
const AV_WT_UI_SAMPLES = 2048;          /* the §2.5 frame length — the canvas sample domain   */
const AV_WT_UI_PEAK = 0.95;             /* the §2.5 mip-law level-0 peak — commit/commit gain */
const AV_WT_UI_NOTE = "c4";             /* the audition note                                  */
const AV_WT_UI_NOTE_MS = 600;           /* the audition note length (short)                   */

/* the tool row, pinned order */
const AV_WT_UI_TOOLS = ["draw", "line", "smooth", "normalise", "undo-lite"];

const AV_WT_UI_TOOL_LABELS = {
  "draw": "DRAW", "line": "LINE", "smooth": "SMOOTH", "normalise": "NORMALISE", "undo-lite": "UNDO",
};

const AV_WT_UI_TOOL_TITLES = {
  "draw": "DRAW \u2014 freehand: the pointer sets the frame samples (peak-normalised to 0.95 on release).",
  "line": "LINE \u2014 drag from A to B: the straight line between the two sample values is filled in (normalised on release).",
  "smooth": "SMOOTH \u2014 drag across a region to smooth it (a click smooths the whole frame); normalised on release.",
  "normalise": "NORMALISE \u2014 peak-normalise the current frame to 0.95.",
  "undo-lite": "UNDO \u2014 restore the frame to its state before the last edit (one step).",
};

/* the five pinned actions, one table (markup + delegation + snapshot read one source) */
const AV_WT_UI_ACTS = [
  { id: "av-wt-new", act: "new", label: "NEW",
    title: "NEW \u2014 start a fresh wavetable (one sine frame to draw on)." },
  { id: "av-wt-import", act: "import", label: "IMPORT",
    title: "IMPORT \u2014 read a .wt (Serum) or .json wavetable file into the editor." },
  { id: "av-wt-export", act: "export", label: "EXPORT",
    title: "EXPORT \u2014 download the current table as a .wt.json file." },
  { id: "av-wt-install", act: "install", label: "INSTALL",
    title: "INSTALL \u2014 send the table to the engine as an osc2 wavetable and set osc2.type to it." },
  { id: "av-wt-audition", act: "audition", label: "AUDITION",
    title: "AUDITION \u2014 install the table to a free slot and play one short note." },
];

/* the NEW css classes this card introduces (the parent styles them; #av-wt-host excluded —
   it is parent-owned). Kept in one place so the integration class-coverage check can diff.
   av-wt-err / av-wt-chip* / av-wt-lib-row · -name · -meta · -empty are emitted dynamically
   (error state, frames present, library rows) — they are listed here all the same. */
const AV_WT_UI_CLASSES = [
  "av-wt", "av-wt-head", "av-wt-title", "av-wt-cap", "av-wt-namewrap", "av-wt-name-lbl", "av-wt-name",
  "av-wt-status-line", "av-wt-status", "av-wt-msg", "av-wt-err",
  "av-wt-stage", "av-wt-canvas", "av-wt-canvas-cap",
  "av-wt-tool", "av-wt-tool-btn", "av-wt-tool-on",
  "av-wt-frames", "av-wt-frame-add", "av-wt-chips", "av-wt-chip", "av-wt-chip-pick", "av-wt-chip-x", "av-wt-chip-on",
  "av-wt-morph-sec", "av-wt-range", "av-wt-select", "av-wt-morph-val",
  "av-wt-spec", "av-wt-harm-val", "av-wt-lbl",
  "av-wt-lib", "av-wt-lib-row", "av-wt-lib-name", "av-wt-lib-meta", "av-wt-lib-acts", "av-wt-lib-empty",
  "av-wt-actions", "av-wt-btn", "av-wt-file", "av-wt-note",
];

/* UI-local state only — every core fact is read through the pinned apis per call */
const avWtUiState = {
  inited: false, mounts: 0,
  table: null,            /* the current table object (opaque; owned by av_wt.js)   */
  name: "",               /* its name mirror (used for statuses + the export name)  */
  frame: 0, frameCount: 0,
  edit: null,             /* Float64Array(2048): the frame being edited (read cache) */
  disp: null,             /* Float64Array(2048): what the canvas draws               */
  mode: "edit",           /* "edit" | "morph" (morph shows a preview, never writes)  */
  undo: null,             /* {table, frame, samples} — ONE slot (undo-lite)          */
  tool: "draw",
  gest: null, gestBase: null,   /* the live pointer gesture + its pre-gesture frame  */
  morph: { b: 0, x: 0 },
  harmonics: 1024,
  lib: [], libSig: "", lastLibErr: "",
  inst: [],
  osc: "",                /* the last osc2.type this card set                        */
  auditionTimer: null,
  seq: 0, edits: 0,
  status: "wavetable editor idle", statusKind: "msg",
  canvas: null, obs: null, obsCanvas: null, resizeWired: false, raf: 0, drawn: 0, dpr: 1,
  memo: { text: {}, cls: {} },
  lastError: "",
};

/* ---------- small pure helpers (no DOM; harness-covered) ---------- */

const avWtUiEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function avWtUiClamp(v, lo, hi) {
  const n = Number(v);
  if (!isFinite(n)) return lo;
  return n < lo ? lo : (n > hi ? hi : n);
}

function wtUiFmt2(v) {
  const n = Number(v);
  return isFinite(n) ? (Math.round(n * 100) / 100).toFixed(2) : "\u2014";
}

/* the peak of a frame (0 for empty/garbage — never NaN) */
function avWtUiPeakOf(f) {
  try {
    if (!f || typeof f.length !== "number") return 0;
    let p = 0;
    const n = Math.min(AV_WT_UI_SAMPLES, f.length | 0);
    for (let i = 0; i < n; i++) {
      const a = Math.abs(Number(f[i]) || 0);
      if (a > p) p = a;
    }
    return p;
  } catch (e) { return 0; }
}

/* copy any array-like of >= nothing into a fresh Float64Array(2048); null when not array-like */
function avWtUiCopySamples(x) {
  try {
    if (!x || typeof x.length !== "number") return null;
    const out = new Float64Array(AV_WT_UI_SAMPLES);
    const m = Math.min(AV_WT_UI_SAMPLES, x.length | 0);
    for (let i = 0; i < m; i++) out[i] = Number(x[i]) || 0;
    return out;
  } catch (e) { return null; }
}

/* peak-normalise a copy of f to `peak` (default 0.95). A silent frame stays silent. */
function avWtUiNormFrame(f, peak) {
  const n = AV_WT_UI_SAMPLES;
  const out = new Float64Array(n);
  const p = avWtUiPeakOf(f);
  const t = (typeof peak === "number" && isFinite(peak) && peak > 0) ? peak : AV_WT_UI_PEAK;
  if (p > 0) {
    const g = t / p;
    for (let i = 0; i < n; i++) out[i] = (Number(f[i]) || 0) * g;
  } else if (f) {
    for (let i = 0; i < n; i++) out[i] = Number(f[i]) || 0;
  }
  return out;
}

/* the editor's seed sine (used when avWtSeedFrom is absent) */
function avWtUiSine() {
  const n = AV_WT_UI_SAMPLES;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = AV_WT_UI_PEAK * Math.sin((2 * Math.PI * i) / n);
  return out;
}

/* straight line between (i0,v0) and (i1,v1), written into f over the touched range */
function avWtUiLineInto(f, i0, v0, i1, v1) {
  const n = AV_WT_UI_SAMPLES;
  const ia = Math.round(avWtUiClamp(i0, 0, n - 1));
  const ib = Math.round(avWtUiClamp(i1, 0, n - 1));
  const a = Math.min(ia, ib), b = Math.max(ia, ib);
  const va = (a === ia) ? v0 : v1, vb = (a === ia) ? v1 : v0;
  if (b === a) { f[a] = vb; return 1; }
  for (let i = a; i <= b; i++) {
    const t = (i - a) / (b - a);
    f[i] = va + (vb - va) * t;
  }
  return b - a + 1;
}

/* 3-point moving average ([1,2,1]/4) over [i0..i1] of f, up to 4 passes; a range narrower
   than 3 samples means "the whole frame" (a click). Returns the number of samples touched. */
function avWtUiSmoothInto(f, i0, i1, passes) {
  const n = AV_WT_UI_SAMPLES;
  let a = Math.round(avWtUiClamp(Math.min(i0, i1), 0, n - 1));
  let b = Math.round(avWtUiClamp(Math.max(i0, i1), 0, n - 1));
  if (b - a < 3) { a = 0; b = n - 1; }
  const p = Math.max(1, Math.min(4, Math.round(Number(passes) || 1)));
  const tmp = new Float64Array(b - a + 1);
  for (let k = 0; k < p; k++) {
    for (let i = a; i <= b; i++) {
      const im = i > a ? i - 1 : i;
      const ip = i < b ? i + 1 : i;
      tmp[i - a] = (f[im] + 2 * f[i] + f[ip]) * 0.25;
    }
    for (let i = a; i <= b; i++) f[i] = tmp[i - a];
  }
  return b - a + 1;
}

/* in-place radix-2 FFT (n a power of two); inverse divides by n. Allocation-free, deterministic. */
function avWtUiFFT(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tr = re[i]; re[i] = re[j]; re[j] = tr;
      let ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const ur = re[i + j], ui = im[i + j];
        const xr = re[i + j + half], xi = im[i + j + half];
        const vr = xr * cr - xi * ci;
        const vi = xr * ci + xi * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + half] = ur - vr; im[i + j + half] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}

/* the harmonic-trim tool: keep harmonics 1..keep, zero everything above AND the DC bin
   (matching the §2.5 mip law reading "DC and bin > 1024 zeroed"), analysis FFT -> zero -> IFFT.
   Returns a NEW peak-unnormalised Float64Array(2048); NaN-proof. */
function avWtUiTrimFrame(f, keep) {
  const n = AV_WT_UI_SAMPLES;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Number(f && f[i]) || 0;
  avWtUiFFT(re, im, false);
  const k = Math.round(avWtUiClamp(keep, 1, n >> 1));
  re[0] = 0; im[0] = 0;
  for (let i = 1; i < n; i++) {
    const harm = (i <= (n >> 1)) ? i : (n - i);
    if (harm > k) { re[i] = 0; im[i] = 0; }
  }
  avWtUiFFT(re, im, true);
  for (let i = 0; i < n; i++) { if (!isFinite(re[i])) re[i] = 0; }
  return re;
}

/* ---------- the guarded table access (sa-E's §2.5 surface; strategies documented atop) ---------- */

function avWtUiFrameCountOf(t) {
  try {
    if (!t) return 0;
    if (typeof avWtFrameCount === "function") {
      const n = Number(avWtFrameCount(t));
      if (isFinite(n) && n >= 0) return Math.round(n);
    }
    if (t.frames && typeof t.frames.length === "number") return t.frames.length | 0;
  } catch (e) { /* unreadable */ }
  return 0;
}

function avWtUiTableName(t) {
  try {
    if (t && typeof t.name === "string" && t.name) return t.name;
  } catch (e) { /* none */ }
  return "";
}

/* read frame i into a fresh Float64Array(2048) — frames[] · getFrame() · avWtMorph(i,i,0) · null */
function avWtUiReadFrame(t, i) {
  try {
    if (!t || typeof t !== "object") return null;
    const idx = Math.max(0, Math.round(Number(i) || 0));
    if (t.frames && typeof t.frames.length === "number" && idx < t.frames.length) {
      const c = avWtUiCopySamples(t.frames[idx]);
      if (c) return c;
    }
    if (typeof t.getFrame === "function") {
      const c = avWtUiCopySamples(t.getFrame(idx));
      if (c) return c;
    }
    if (typeof avWtMorph === "function") {
      const c = avWtUiCopySamples(avWtMorph(t, idx, idx, 0));
      if (c) return c;
    }
  } catch (e) { /* all strategies refused */ }
  return null;
}

/* write frame i — ALWAYS the pinned avWtSetFrame first; in-place frames[] only as fallback */
function avWtUiWriteFrame(t, i, f) {
  try {
    if (!t || !f || typeof f.length !== "number") return false;
    if (typeof avWtSetFrame === "function") {
      const r = avWtSetFrame(t, i, f);
      return r !== false;
    }
    if (t.frames && typeof t.frames.length === "number" && i >= 0 && i < t.frames.length &&
        t.frames[i] && typeof t.frames[i].length === "number") {
      const d = t.frames[i];
      const m = Math.min(d.length, f.length);
      for (let k = 0; k < m; k++) d[k] = f[k];
      return true;
    }
  } catch (e) {
    try { avWtUiState.lastError = String((e && e.message) || e); } catch (e2) { /* ok */ }
  }
  return false;
}

/* ---------- guarded DOM + core access (no throw, no noise) ---------- */

function avWtUiWin() {
  try { if (typeof window !== "undefined") return window; } catch (e) { /* none */ }
  return null;
}

function avWtUiDoc() {
  try { if (typeof document !== "undefined") return document; } catch (e) { /* none */ }
  return null;
}

function avWtUiHost() {
  try {
    const d = avWtUiDoc();
    if (d && typeof d.getElementById === "function") return d.getElementById("av-wt-host");
  } catch (e) { /* no document */ }
  return null;
}

/* every pinned core entry, each detected by typeof only (never called here) */
function wtUiCores() {
  const c = {
    new: false, frameCount: false, setFrame: false, addFrame: false, delFrame: false, seed: false,
    morph: false, mips: false, install: false, installed: false,
    libList: false, libSave: false, libLoad: false, libDel: false,
    expJson: false, impJson: false, impWt: false, userNames: false,
    applyParam: false, oscRefresh: false, noteDown: false, noteUp: false, params: false,
  };
  try { c["new"] = typeof avWtNew === "function"; } catch (e) { /* none */ }
  try { c.frameCount = typeof avWtFrameCount === "function"; } catch (e) { /* none */ }
  try { c.setFrame = typeof avWtSetFrame === "function"; } catch (e) { /* none */ }
  try { c.addFrame = typeof avWtAddFrame === "function"; } catch (e) { /* none */ }
  try { c.delFrame = typeof avWtDelFrame === "function"; } catch (e) { /* none */ }
  try { c.seed = typeof avWtSeedFrom === "function"; } catch (e) { /* none */ }
  try { c.morph = typeof avWtMorph === "function"; } catch (e) { /* none */ }
  try { c.mips = typeof avWtMips === "function"; } catch (e) { /* none */ }
  try { c.install = typeof avWtInstall === "function"; } catch (e) { /* none */ }
  try { c.installed = typeof avWtInstalled === "function"; } catch (e) { /* none */ }
  try { c.libList = typeof avWtLibraryList === "function"; } catch (e) { /* none */ }
  try { c.libSave = typeof avWtLibrarySave === "function"; } catch (e) { /* none */ }
  try { c.libLoad = typeof avWtLibraryLoad === "function"; } catch (e) { /* none */ }
  try { c.libDel = typeof avWtLibraryDelete === "function"; } catch (e) { /* none */ }
  try { c.expJson = typeof avWtExportJson === "function"; } catch (e) { /* none */ }
  try { c.impJson = typeof avWtImportJson === "function"; } catch (e) { /* none */ }
  try { c.impWt = typeof avWtImportWt === "function"; } catch (e) { /* none */ }
  try { c.userNames = typeof avWtUserOscNames === "function"; } catch (e) { /* none */ }
  try { c.applyParam = typeof avApplyParam === "function"; } catch (e) { /* none */ }
  try { c.oscRefresh = typeof avSynthOscOptionsRefresh === "function"; } catch (e) { /* none */ }
  try { c.noteDown = typeof avNoteDown === "function"; } catch (e) { /* none */ }
  try { c.noteUp = typeof avNoteUp === "function"; } catch (e) { /* none */ }
  try { c.params = (typeof avParams !== "undefined" && !!avParams); } catch (e) { /* none */ }
  return c;
}

/* settle a sync value or a promise exactly once, never throwing (the av_files_ui law) */
function wtUiSettle(p, cb) {
  const done = { v: false };
  const once = function (r) {
    if (done.v) return;
    done.v = true;
    try { cb(r); } catch (e) { /* settle never throws */ }
  };
  try {
    if (p && typeof p.then === "function") {
      p.then(once)["catch"](function (e) { once({ ok: false, error: wtUiErrText(e, "failed") }); });
      return true;
    }
    once(p);
    return true;
  } catch (e) {
    once({ ok: false, error: wtUiErrText(e, "failed") });
    return false;
  }
}

function wtUiErrText(e, fallback) {
  try {
    if (e && typeof e === "object") {
      if (typeof e.error === "string" && e.error) return e.error;
      if (typeof e.message === "string" && e.message) return e.message;
    }
    if (typeof e === "string" && e) return e;
  } catch (e2) { /* fall through */ }
  return fallback || "refused";
}

/* ---------- write-on-change DOM painting ---------- */

function wtUiWriteText(host, sel, txt, key) {
  try {
    const s = avWtUiState;
    if (s.memo.text[key] === txt) return false;
    s.memo.text[key] = txt;
    const el = (host && typeof host.querySelector === "function") ? host.querySelector(sel) : null;
    if (el && el.textContent !== txt) el.textContent = txt;
    return true;
  } catch (e) { return false; }
}

function wtUiToggleClass(host, sel, cls, on, key) {
  try {
    const s = avWtUiState;
    const memoKey = key + "|" + cls;
    const want = !!on;
    if (s.memo.cls[memoKey] === want) return false;
    s.memo.cls[memoKey] = want;
    const el = (host && typeof host.querySelector === "function") ? host.querySelector(sel) : null;
    if (el && el.classList && typeof el.classList.add === "function") {
      if (want) el.classList.add(cls); else el.classList.remove(cls);
    }
    return true;
  } catch (e) { return false; }
}

function wtUiPaintStatus(host) {
  if (!host) return false;
  try {
    const s = avWtUiState;
    wtUiWriteText(host, "#av-wt-status", s.status, "status");
    wtUiToggleClass(host, "#av-wt-status", "av-wt-err", s.statusKind === "err", "status-err");
    return true;
  } catch (e) { return false; }
}

function wtUiSetStatus(msg, kind) {
  try {
    const s = avWtUiState;
    s.status = String(msg == null ? "" : msg);
    s.statusKind = (kind === "err") ? "err" : "msg";
    return wtUiPaintStatus(avWtUiHost());
  } catch (e) { return false; }
}

function wtUiPaintTools(host) {
  if (!host) return false;
  try {
    const s = avWtUiState;
    const btns = (typeof host.querySelectorAll === "function") ? host.querySelectorAll("#av-wt-tool [data-tool]") : null;
    if (!btns) return false;
    for (let i = 0; i < btns.length; i++) {
      const el = btns[i];
      const tool = String(el.getAttribute("data-tool") || "");
      const on = (tool === s.tool);
      if (el.classList) {
        if (on) el.classList.add("av-wt-tool-on"); else el.classList.remove("av-wt-tool-on");
      }
      if (typeof el.setAttribute === "function") el.setAttribute("aria-pressed", on ? "true" : "false");
    }
    return true;
  } catch (e) { return false; }
}

function wtUiChipHTML(i, cur, count) {
  const on = (i === cur);
  return '<span class="av-wt-chip' + (on ? " av-wt-chip-on" : "") + '" data-frame="' + i + '">' +
    '<button type="button" class="av-btn mini av-wt-chip-pick" data-wt-frame="' + i + '"' +
    ' aria-pressed="' + (on ? "true" : "false") + '" title="edit frame ' + (i + 1) + ' of ' + count + '">' + (i + 1) + "</button>" +
    (count > 1
      ? '<button type="button" class="av-wt-chip-x" data-wt-frame-del="' + i + '" title="delete frame ' + (i + 1) + '" aria-label="delete frame ' + (i + 1) + '">\u2715</button>'
      : "") +
    "</span>";
}

function wtUiPaintChips(host) {
  if (!host) return false;
  try {
    const s = avWtUiState;
    const sig = s.frameCount + "|" + s.frame;
    const box = (typeof host.querySelector === "function") ? host.querySelector("#av-wt-chips") : null;
    if (!box) return false;
    if (s.chipSig === sig && typeof box.children === "object" && box.children && box.children.length > 0) return false;
    let html = "";
    for (let i = 0; i < s.frameCount && i < 256; i++) html += wtUiChipHTML(i, s.frame, s.frameCount);
    box.innerHTML = html;
    s.chipSig = sig;
    return true;
  } catch (e) { return false; }
}

function wtUiPaintMorphSel(host) {
  if (!host) return false;
  try {
    const s = avWtUiState;
    const sel = (typeof host.querySelector === "function") ? host.querySelector("#av-wt-morph-b") : null;
    if (!sel) return false;
    const sig = "f" + s.frameCount;
    if (s.morphSig !== sig) {
      let opts = "";
      for (let i = 0; i < s.frameCount && i < 256; i++) opts += '<option value="' + i + '">' + (i + 1) + "</option>";
      sel.innerHTML = opts;
      s.morphSig = sig;
    }
    const want = String(Math.round(avWtUiClamp(s.morph.b, 0, Math.max(0, s.frameCount - 1))));
    if (sel.value !== want) sel.value = want;
    return true;
  } catch (e) { return false; }
}

function wtUiPaintReadouts(host) {
  if (!host) return false;
  try {
    const s = avWtUiState;
    const pct = Math.round(avWtUiClamp(s.morph.x, 0, 1) * 100);
    wtUiWriteText(host, "#av-wt-morph-val", pct + "%" + (s.mode === "morph" ? " \u00b7 preview" : ""), "morphval");
    wtUiWriteText(host, "#av-wt-harm-val", "1.." + Math.round(s.harmonics), "harmval");
    let cap;
    if (s.mode === "morph") {
      cap = "morph " + (s.frame + 1) + "\u2192" + (s.morph.b + 1) + " \u00b7 " + pct + "% preview";
    } else if (s.table && s.frameCount > 0) {
      cap = "frame " + (s.frame + 1) + "/" + s.frameCount + " \u00b7 " + s.tool + " tool \u00b7 2048 samples";
    } else {
      cap = "no table \u2014 press NEW to start";
    }
    wtUiWriteText(host, "#av-wt-canvas-cap", cap, "cancap");
    /* the name input is only touched when it is not being typed into */
    const d = avWtUiDoc();
    const nameEl = (typeof host.querySelector === "function") ? host.querySelector("#av-wt-name") : null;
    if (nameEl && typeof nameEl.value === "string" && s.name && nameEl.value !== s.name) {
      const active = (d && d.activeElement) ? d.activeElement : null;
      if (active !== nameEl) nameEl.value = s.name;
    }
    return true;
  } catch (e) { return false; }
}

function wtUiPaintName(host) {
  if (!host) return false;
  try {
    const s = avWtUiState;
    const el = (typeof host.querySelector === "function") ? host.querySelector("#av-wt-name") : null;
    if (el && typeof el.value === "string" && el.value !== s.name) el.value = s.name;
    return true;
  } catch (e) { return false; }
}

function wtUiLibRowHTML(e) {
  const meta = (typeof e.frames === "number" && isFinite(e.frames)) ? (e.frames + " frame" + (e.frames === 1 ? "" : "s")) : "";
  return '<div class="av-wt-lib-row" data-lib-id="' + avWtUiEsc(e.id) + '">' +
    '<span class="av-wt-lib-name" title="' + avWtUiEsc(e.name) + '">' + avWtUiEsc(e.name) + "</span>" +
    '<span class="av-wt-lib-meta av-dim">' + avWtUiEsc(meta) + "</span>" +
    '<span class="av-wt-lib-acts">' +
    '<button type="button" class="av-btn mini av-wt-btn" data-wt-lib-act="load" data-lib-id="' + avWtUiEsc(e.id) + '" title="load this table into the editor">LOAD</button>' +
    '<button type="button" class="av-btn mini av-wt-btn" data-wt-lib-act="install" data-lib-id="' + avWtUiEsc(e.id) + '" title="load and install this table as an osc2 wavetable">INSTALL</button>' +
    '<button type="button" class="av-btn mini av-wt-btn" data-wt-lib-act="delete" data-lib-id="' + avWtUiEsc(e.id) + '" title="remove this table from the library">DELETE</button>' +
    "</span></div>";
}

function wtUiPaintLib(host) {
  if (!host) return false;
  try {
    const s = avWtUiState;
    const box = (typeof host.querySelector === "function") ? host.querySelector("#av-wt-lib") : null;
    if (!box) return false;
    const sig = s.lib.map(e => e.id).join(",") + "|" + (s.lastLibErr || "");
    if (s.libSig === sig) return false;
    s.libSig = sig;
    if (!s.lib.length) {
      const why = s.lastLibErr ? (" \u2014 " + avWtUiEsc(s.lastLibErr)) : "";
      box.innerHTML = '<p class="av-note av-dim av-wt-lib-empty">library \u2014 install a table to store it here' + why + "</p>";
      return true;
    }
    let html = "";
    for (let i = 0; i < s.lib.length; i++) html += wtUiLibRowHTML(s.lib[i]);
    box.innerHTML = html;
    return true;
  } catch (e) { return false; }
}

/* ---------- the canvas (all work inside guarded functions) ---------- */

function wtUiTeal() {
  try {
    if (typeof getComputedStyle === "function" && typeof document !== "undefined" && document.documentElement) {
      const v = String(getComputedStyle(document.documentElement).getPropertyValue("--teal") || "").trim();
      if (v) return v;
    }
  } catch (e) { /* token unavailable */ }
  return "#2ed8c9";
}

function wtUiCanvasEl() {
  try {
    const host = avWtUiHost();
    if (host && typeof host.querySelector === "function") return host.querySelector("#av-wt-canvas");
  } catch (e) { /* none */ }
  return null;
}

function wtUiRefitCanvas(c) {
  const s = avWtUiState;
  const dprRaw = (function () {
    try { if (typeof window !== "undefined" && isFinite(window.devicePixelRatio)) return window.devicePixelRatio; } catch (e) { /* none */ }
    return 1;
  })();
  s.dpr = Math.max(1, Math.min(4, dprRaw));
  let cssW = Number(c.clientWidth) || 0;
  let cssH = Number(c.clientHeight) || 0;
  if (!(cssW > 0)) cssW = 1024;                 /* unmeasurable (hidden): a stable design box —
                                                   never read c.width here (that grows every draw) */
  if (!(cssH > 0)) cssH = 160;
  cssW = Math.max(1, Math.round(cssW));
  cssH = Math.max(1, Math.round(cssH));
  const bw = Math.max(1, Math.round(cssW * s.dpr));
  const bh = Math.max(1, Math.round(cssH * s.dpr));
  if (c.width !== bw) c.width = bw;
  if (c.height !== bh) c.height = bh;
  return { w: cssW, h: cssH };
}

function wtUiDraw() {
  try {
    const s = avWtUiState;
    const c = s.canvas && s.canvas.isConnected !== false ? s.canvas : wtUiCanvasEl();
    if (!c || typeof c.getContext !== "function") return false;
    s.canvas = c;
    const box = wtUiRefitCanvas(c);
    const g = c.getContext("2d");
    if (!g) return false;
    const w = box.w, h = box.h;
    g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const mid = h / 2;
    const amp = (h / 2) * 0.92;                       /* the av_sample 8% headroom law */
    /* the quiet grid: zero line + one faint line every 256 samples */
    g.fillStyle = "rgba(46,216,201,0.16)";
    g.fillRect(0, mid - 0.5, w, 1);
    g.fillStyle = "rgba(46,216,201,0.07)";
    for (let i = 256; i < AV_WT_UI_SAMPLES; i += 256) {
      g.fillRect((i * w) / AV_WT_UI_SAMPLES, 0, 1, h);
    }
    const f = s.disp;
    if (f && typeof f.length === "number") {
      g.strokeStyle = (s.mode === "morph") ? "#7ff3e8" : wtUiTeal();
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < AV_WT_UI_SAMPLES; i++) {
        const x = (i * w) / AV_WT_UI_SAMPLES;
        const v = Math.max(-1.05, Math.min(1.05, Number(f[i]) || 0));
        const y = mid - v * amp;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    s.drawn += 1;
    return true;
  } catch (e) {
    try { avWtUiState.lastError = String((e && e.message) || e); } catch (e2) { /* ok */ }
    return false;
  }
}

function wtUiRequestDraw() {
  const s = avWtUiState;
  try {
    if (typeof requestAnimationFrame === "function") {
      if (!s.raf) {
        s.raf = requestAnimationFrame(function () { s.raf = 0; wtUiDraw(); });
      }
      return true;
    }
  } catch (e) { /* no raf */ }
  return wtUiDraw();
}

/* pointer pixel -> {i, v}: x/width maps to 0..2047, y maps to +-1 with the same 8% headroom */
function wtUiCanvasMap(ev) {
  const s = avWtUiState;
  const c = s.canvas || wtUiCanvasEl();
  if (!c) return null;
  let r = null;
  try { r = (typeof c.getBoundingClientRect === "function") ? c.getBoundingClientRect() : null; } catch (e) { r = null; }
  let wpx = r ? (Number(r.width) || 0) : 0;
  let hpx = r ? (Number(r.height) || 0) : 0;
  if (!(wpx > 0)) wpx = Number(c.clientWidth) || 0;
  if (!(hpx > 0)) hpx = Number(c.clientHeight) || 0;
  if (!(wpx > 0)) wpx = 1024;
  if (!(hpx > 0)) hpx = 160;
  const cx = (ev && isFinite(ev.clientX)) ? Number(ev.clientX) : 0;
  const cy = (ev && isFinite(ev.clientY)) ? Number(ev.clientY) : 0;
  const lx = r ? (cx - (Number(r.left) || 0)) : cx;
  const ly = r ? (cy - (Number(r.top) || 0)) : cy;
  const i = Math.round((lx / wpx) * (AV_WT_UI_SAMPLES - 1));
  const v = (hpx / 2 - ly) / ((hpx / 2) * 0.92);
  return { i: Math.round(avWtUiClamp(i, 0, AV_WT_UI_SAMPLES - 1)), v: avWtUiClamp(v, -1, 1) };
}

function wtUiPointerDown(ev) {
  try {
    const s = avWtUiState;
    if (ev && typeof ev.button === "number" && ev.button !== 0) return;
    if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
    if (!s.table || !s.edit) { wtUiSetStatus("no table \u2014 press NEW first", "err"); return; }
    if (s.mode === "morph") wtUiSetMode("edit");
    const pos = wtUiCanvasMap(ev);
    if (!pos) return;
    const c = s.canvas || wtUiCanvasEl();
    if (c && typeof c.setPointerCapture === "function" && ev && ev.pointerId != null) {
      try { c.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic or stale pointer id */ }
    }
    wtUiPushUndo();
    s.gestBase = s.edit.slice();
    if (s.tool === "draw") {
      s.gest = { kind: "draw", last: pos };
      s.edit[pos.i] = pos.v;
      wtUiRequestDraw();
    } else if (s.tool === "line") {
      s.gest = { kind: "line", start: pos };
    } else if (s.tool === "smooth") {
      s.gest = { kind: "smooth", i0: pos.i, i1: pos.i };
    } else {
      s.gest = { kind: "noop" };
    }
  } catch (e) { /* a listener never throws outward */ }
}

function wtUiPointerMove(ev) {
  try {
    const s = avWtUiState;
    if (!s.gest || !s.edit || !s.gestBase) return;
    if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
    const pos = wtUiCanvasMap(ev);
    if (!pos) return;
    const g = s.gest;
    if (g.kind === "draw") {
      const a = g.last;
      avWtUiLineInto(s.edit, a.i, a.v, pos.i, pos.v);
      g.last = pos;
      wtUiRequestDraw();
    } else if (g.kind === "line") {
      s.edit.set(s.gestBase);
      avWtUiLineInto(s.edit, g.start.i, g.start.v, pos.i, pos.v);
      wtUiRequestDraw();
    } else if (g.kind === "smooth") {
      g.i1 = pos.i;
      s.edit.set(s.gestBase);
      avWtUiSmoothInto(s.edit, g.i0, pos.i, 2);
      wtUiRequestDraw();
    }
  } catch (e) { /* a listener never throws outward */ }
}

function wtUiPointerUp(ev) {
  try {
    const s = avWtUiState;
    if (!s.gest) return;
    const c = s.canvas || wtUiCanvasEl();
    if (c && typeof c.releasePointerCapture === "function" && ev && ev.pointerId != null) {
      try { c.releasePointerCapture(ev.pointerId); } catch (e) { /* never captured */ }
    }
    wtUiCommitStroke();
  } catch (e) { /* a listener never throws outward */ }
}

function wtUiCommitStroke() {
  const s = avWtUiState;
  const g = s.gest;
  s.gest = null;
  s.gestBase = null;
  try {
    if (!g || g.kind === "noop") return false;
    if (!s.table || !s.edit) { wtUiSetStatus("no table \u2014 the stroke was not kept", "err"); return false; }
    const before = avWtUiPeakOf(s.edit);
    const norm = avWtUiNormFrame(s.edit);              /* commit law: peak-normalise to 0.95 */
    s.edit = norm;
    s.disp = norm;
    s.mode = "edit";
    const ok = avWtUiWriteFrame(s.table, s.frame, norm);
    s.edits += 1;
    wtUiRequestDraw();
    wtUiPaintReadouts(avWtUiHost());
    wtUiSetStatus((ok
      ? ((g.kind === "smooth") ? "frame " + (s.frame + 1) + " smoothed" : "frame " + (s.frame + 1) + " drawn") + " \u00b7 peak " + wtUiFmt2(before)
      : "the core refused the write \u2014 the stroke is only on screen") + " \u00b7 normalised to " + AV_WT_UI_PEAK,
      ok ? "msg" : "err");
    return ok;
  } catch (e) {
    try { s.lastError = String((e && e.message) || e); } catch (e2) { /* ok */ }
    return false;
  }
}

function wtUiSetMode(mode) {
  const s = avWtUiState;
  if (mode === "edit") {
    s.mode = "edit";
    s.disp = s.edit;
    wtUiRequestDraw();
    wtUiPaintReadouts(avWtUiHost());
  }
  return s.mode;
}

/* ---------- frame / table operations ---------- */

function wtUiPushUndo() {
  const s = avWtUiState;
  if (!s.table || !s.edit) { s.undo = null; return false; }
  s.undo = { table: s.table, frame: s.frame, samples: avWtUiCopySamples(s.edit) };
  return true;
}

function wtUiToolUndo() {
  const s = avWtUiState;
  const u = s.undo;
  if (!u || u.table !== s.table || u.frame !== s.frame) {
    wtUiSetStatus("undo-lite: nothing to undo" + (u ? " for this frame" : ""), "msg");
    return false;
  }
  const ok = avWtUiWriteFrame(s.table, s.frame, u.samples);
  if (!ok && s.table) {
    wtUiSetStatus("undo refused \u2014 the core refused the write", "err");
    return false;
  }
  s.edit = avWtUiCopySamples(u.samples);
  s.disp = s.edit;
  s.mode = "edit";
  s.undo = null;
  s.edits += 1;
  wtUiRequestDraw();
  wtUiPaintReadouts(avWtUiHost());
  wtUiSetStatus("undone \u2014 frame " + (s.frame + 1) + " restored one step", "msg");
  return true;
}

function wtUiToolNormalise() {
  const s = avWtUiState;
  if (!s.table || !s.edit) { wtUiSetStatus("no frame to normalise \u2014 press NEW first", "err"); return false; }
  const before = avWtUiPeakOf(s.edit);
  if (!(before > 0)) { wtUiSetStatus("frame " + (s.frame + 1) + " is silent \u2014 nothing to normalise", "msg"); return false; }
  wtUiPushUndo();
  const norm = avWtUiNormFrame(s.edit);
  s.edit = norm;
  s.disp = norm;
  s.mode = "edit";
  const ok = avWtUiWriteFrame(s.table, s.frame, norm);
  s.edits += 1;
  wtUiRequestDraw();
  wtUiPaintReadouts(avWtUiHost());
  wtUiSetStatus(ok
    ? "frame " + (s.frame + 1) + " normalised \u00b7 peak " + wtUiFmt2(before) + " \u2192 " + AV_WT_UI_PEAK
    : "normalise refused \u2014 the core refused the write", ok ? "msg" : "err");
  return ok;
}

function wtUiApplyTrim() {
  const s = avWtUiState;
  if (!s.table || !s.edit) { wtUiSetStatus("no frame to trim \u2014 press NEW first", "err"); return false; }
  const keep = Math.round(avWtUiClamp(s.harmonics, 1, AV_WT_UI_SAMPLES >> 1));
  wtUiPushUndo();
  const out = avWtUiTrimFrame(s.edit, keep);
  s.edit = out;
  s.disp = out;
  s.mode = "edit";
  const ok = avWtUiWriteFrame(s.table, s.frame, out);
  s.edits += 1;
  wtUiRequestDraw();
  wtUiPaintReadouts(avWtUiHost());
  wtUiSetStatus(ok
    ? "frame " + (s.frame + 1) + " trimmed to harmonics 1.." + keep + " \u00b7 DC removed \u00b7 peak " + wtUiFmt2(avWtUiPeakOf(out))
    : "trim refused \u2014 the core refused the write", ok ? "msg" : "err");
  return ok;
}

function wtUiFrameRefresh(repaint) {
  const s = avWtUiState;
  const t = s.table;
  let n = avWtUiFrameCountOf(t);
  if (n <= 0 && t && typeof avWtAddFrame === "function") {
    try { avWtAddFrame(t); } catch (e) { /* refused */ }
    n = avWtUiFrameCountOf(t);
  }
  s.frameCount = n;
  if (s.frame >= n) s.frame = Math.max(0, n - 1);
  if (s.frame < 0) s.frame = 0;
  s.edit = (t && n > 0) ? avWtUiReadFrame(t, s.frame) : null;
  if (!s.edit && t && n > 0) {
    s.edit = new Float64Array(AV_WT_UI_SAMPLES);     /* unreadable frame: draft from silence */
    s.lastError = "frame unreadable \u2014 working draft starts from silence";
  }
  s.disp = s.edit;
  s.mode = "edit";
  if (!(s.morph.b >= 0 && s.morph.b < n)) s.morph.b = 0;
  if (n > 1 && s.morph.b === s.frame) s.morph.b = (s.frame + 1) % n;
  if (n === 1) s.morph.b = 0;
  if (repaint) {
    const h = avWtUiHost();
    wtUiPaintChips(h);
    wtUiPaintMorphSel(h);
    wtUiPaintTools(h);
    wtUiPaintName(h);
    wtUiPaintReadouts(h);
    wtUiRequestDraw();
  }
  return s.frameCount;
}

function wtUiSetTable(t, how) {
  const s = avWtUiState;
  s.table = t || null;
  s.frame = 0;
  s.undo = null;
  s.mode = "edit";
  s.morph.x = 0;
  s.morph.b = 0;
  s.harmonics = AV_WT_UI_SAMPLES >> 1;
  s.name = avWtUiTableName(t);
  s.morphSig = "";
  s.chipSig = "";
  const h = avWtUiHost();
  /* reset the sliders to their fresh-table values */
  try {
    if (h && typeof h.querySelector === "function") {
      const mx = h.querySelector("#av-wt-morph");
      if (mx && typeof mx.value === "string") mx.value = "0";
      const hm = h.querySelector("#av-wt-harmonics");
      if (hm && typeof hm.value === "string") hm.value = String(AV_WT_UI_SAMPLES >> 1);
    }
  } catch (e) { /* sliders are a nicety */ }
  wtUiFrameRefresh(true);
  const n = s.frameCount;
  wtUiSetStatus(how + ": " + (s.name || "table") + " \u00b7 " + n + " frame" + (n === 1 ? "" : "s") +
    (n > 0 ? " \u2014 draw the frame" : " \u2014 the core reports no frames"), n > 0 ? "msg" : "err");
  return true;
}

function wtUiMakeTable(name) {
  if (typeof avWtNew !== "function") return null;
  let t = null;
  try { t = avWtNew(name); } catch (e) { t = null; }
  if (!t || typeof t !== "object") return null;
  try {
    if (typeof avWtSeedFrom === "function") avWtSeedFrom(t, 0, "sine");
    else avWtUiWriteFrame(t, 0, avWtUiSine());
  } catch (e2) {
    try { avWtUiWriteFrame(t, 0, avWtUiSine()); } catch (e3) { /* both seed paths refused */ }
  }
  return t;
}

function wtUiSelectFrame(i) {
  const s = avWtUiState;
  const n = s.frameCount;
  const idx = Math.round(Number(i));
  if (!s.table || !isFinite(idx) || idx < 0 || idx >= n) return false;
  if (idx === s.frame && s.mode !== "morph") { wtUiRequestDraw(); return true; }
  s.frame = idx;
  s.mode = "edit";
  s.undo = null;
  s.edit = avWtUiReadFrame(s.table, idx) || new Float64Array(AV_WT_UI_SAMPLES);
  s.disp = s.edit;
  const h = avWtUiHost();
  wtUiPaintChips(h);
  wtUiPaintReadouts(h);
  wtUiRequestDraw();
  wtUiSetStatus("frame " + (idx + 1) + " of " + n, "msg");
  return true;
}

function wtUiFrameAdd() {
  const s = avWtUiState;
  if (!s.table) { wtUiSetStatus("no table \u2014 press NEW first", "err"); return false; }
  if (typeof avWtAddFrame !== "function") { wtUiSetStatus("adding frames needs the wavetable core (av_wt.js)", "err"); return false; }
  const before = s.frameCount;
  let err = null;
  try { avWtAddFrame(s.table); } catch (e) { err = e; }
  const after = avWtUiFrameCountOf(s.table);
  if (after <= before) {
    wtUiSetStatus("frame add refused \u2014 " + (err ? wtUiErrText(err, "the core refused") : "the core did not add a frame"), "err");
    return false;
  }
  s.frameCount = after;
  s.frame = after - 1;
  s.edit = avWtUiReadFrame(s.table, s.frame) || new Float64Array(AV_WT_UI_SAMPLES);
  s.disp = s.edit;
  s.mode = "edit";
  s.undo = null;
  wtUiPaintChips(avWtUiHost());
  wtUiPaintMorphSel(avWtUiHost());
  wtUiPaintReadouts(avWtUiHost());
  wtUiRequestDraw();
  wtUiSetStatus("added frame " + after + " of " + after, "msg");
  return true;
}

function wtUiFrameDel(i) {
  const s = avWtUiState;
  if (!s.table) return false;
  if (s.frameCount <= 1) { wtUiSetStatus("the last frame stays \u2014 delete is refused", "msg"); return false; }
  if (typeof avWtDelFrame !== "function") { wtUiSetStatus("deleting frames needs the wavetable core (av_wt.js)", "err"); return false; }
  const del = Math.round(Number(i));
  if (!isFinite(del) || del < 0 || del >= s.frameCount) return false;
  let err = null;
  try { avWtDelFrame(s.table, del); } catch (e) { err = e; }
  const after = avWtUiFrameCountOf(s.table);
  if (after >= s.frameCount) {
    wtUiSetStatus("frame delete refused \u2014 " + (err ? wtUiErrText(err, "the core refused") : "the core kept the frame"), "err");
    return false;
  }
  s.frameCount = after;
  if (del === s.frame) s.frame = Math.min(del, after - 1);
  else if (del < s.frame) s.frame = s.frame - 1;
  s.frame = Math.round(avWtUiClamp(s.frame, 0, Math.max(0, after - 1)));
  s.edit = avWtUiReadFrame(s.table, s.frame) || new Float64Array(AV_WT_UI_SAMPLES);
  s.disp = s.edit;
  s.mode = "edit";
  s.undo = null;
  wtUiPaintChips(avWtUiHost());
  wtUiPaintMorphSel(avWtUiHost());
  wtUiPaintReadouts(avWtUiHost());
  wtUiRequestDraw();
  wtUiSetStatus("deleted frame " + (del + 1) + " \u00b7 " + after + " remain", "msg");
  return true;
}

/* ---------- morph ---------- */

function wtUiMorphPreview() {
  const s = avWtUiState;
  if (!s.table || !s.edit || s.frameCount <= 0) return false;
  if (!(s.morph.x > 0)) { wtUiSetMode("edit"); return true; }
  if (typeof avWtMorph !== "function") {
    wtUiSetStatus("morph needs the wavetable core (av_wt.js) \u2014 avWtMorph is not present", "err");
    return false;
  }
  let r = null;
  try { r = avWtMorph(s.table, s.frame, s.morph.b, s.morph.x); } catch (e) { r = null; }
  const c = avWtUiCopySamples(r);
  if (!c) { wtUiSetStatus("morph refused \u2014 the core returned no frame", "err"); return false; }
  s.disp = c;
  s.mode = "morph";
  wtUiRequestDraw();
  wtUiPaintReadouts(avWtUiHost());
  wtUiSetStatus("morph " + (s.frame + 1) + "\u2192" + (s.morph.b + 1) + " at " + Math.round(s.morph.x * 100) + "% \u2014 BAKE keeps it", "msg");
  return true;
}

function wtUiMorphBake() {
  const s = avWtUiState;
  if (s.mode !== "morph" || !s.disp || !s.table) {
    wtUiSetStatus("nothing to bake \u2014 move the morph range first", "msg");
    return false;
  }
  const baked = avWtUiCopySamples(s.disp);
  if (!baked) return false;
  wtUiPushUndo();
  s.edit = baked;
  s.disp = baked;
  s.mode = "edit";
  const ok = avWtUiWriteFrame(s.table, s.frame, baked);
  s.edits += 1;
  wtUiRequestDraw();
  wtUiPaintReadouts(avWtUiHost());
  wtUiSetStatus(ok
    ? "baked morph " + (s.frame + 1) + "\u2192" + (s.morph.b + 1) + " at " + Math.round(s.morph.x * 100) + "% into frame " + (s.frame + 1)
    : "bake refused \u2014 the core refused the write", ok ? "msg" : "err");
  return ok;
}

/* ---------- install / audition (the sa-E + notes + synth-hook seam) ---------- */

function wtUiLastInstalledSlot() {
  try {
    if (typeof avWtInstalled === "function") {
      const r = avWtInstalled();
      if (r && typeof r.length === "number" && r.length > 0) {
        const last = r[r.length - 1];
        const n = Number(last && last.slot);
        if (isFinite(n)) return Math.round(n);
      }
    }
  } catch (e) { /* none */ }
  return null;
}

function wtUiRefreshInst() {
  try {
    if (typeof avWtInstalled !== "function") return false;
    const out = avWtInstalled();
    wtUiSettle(out, function (r) {
      if (r && typeof r.length === "number") {
        const rows = [];
        for (let i = 0; i < r.length && i < 64; i++) {
          const e = r[i];
          if (!e || typeof e !== "object") continue;
          const slot = Number(e.slot);
          if (!isFinite(slot)) continue;
          rows.push({ slot: Math.round(slot), name: (typeof e.name === "string" && e.name) ? e.name : ("slot " + Math.round(slot)) });
        }
        avWtUiState.inst = rows;
      }
    });
    return true;
  } catch (e) { return false; }
}

function wtUiLibHasName(name) {
  try {
    const s = avWtUiState;
    if (!name) return false;
    for (let i = 0; i < s.lib.length; i++) {
      if (s.lib[i] && s.lib[i].name === name) return true;
    }
  } catch (e) { /* none */ }
  return false;
}

function wtUiInstallCurrent() {
  const s = avWtUiState;
  if (!s.table) { wtUiSetStatus("no table \u2014 press NEW or IMPORT first", "err"); return false; }
  if (typeof avWtInstall !== "function") {
    wtUiSetStatus("the wavetable core (av_wt.js) is not present \u2014 INSTALL is unavailable", "err");
    return false;
  }
  wtUiSetStatus("installing " + (s.name || "table") + "\u2026", "msg");
  let out = null;
  try { out = avWtInstall(s.table); }
  catch (e) { out = { ok: false, error: wtUiErrText(e, "the install failed") }; }
  wtUiSettle(out, wtUiFinishInstall);
  return true;
}

function wtUiFinishInstall(r0) {
  const s = avWtUiState;
  try {
    const r = (r0 && typeof r0 === "object") ? r0 : {};
    if (r.ok !== true) {
      wtUiSetStatus("install refused \u2014 " + wtUiErrText(r, "the core refused"), "err");
      return false;
    }
    let slot = Number(r.slot);
    if (!isFinite(slot)) slot = wtUiLastInstalledSlot();
    let osc = "";
    if (isFinite(slot) && slot >= 0 && slot <= 15) osc = "wt.user" + Math.round(slot);
    if (osc) {
      try { if (typeof avParams !== "undefined" && avParams) avParams["osc2.type"] = osc; } catch (e) { /* mirror only */ }
      let applied = false;
      try {
        if (typeof avApplyParam === "function") { avApplyParam("osc2.type", osc, { from: "wt" }); applied = true; }
      } catch (e) { applied = false; }
      if (!applied) {
        try {
          const w = avWtUiWin();
          if (w && typeof w.dispatchEvent === "function" && typeof CustomEvent === "function") {
            w.dispatchEvent(new CustomEvent("av-param", { detail: { path: "osc2.type", value: osc, from: "wt" } }));
          }
        } catch (e) { /* no fan-out */ }
      }
      s.osc = osc;
    }
    let refreshed = false;
    try {
      if (typeof avSynthOscOptionsRefresh === "function") { avSynthOscOptionsRefresh(); refreshed = true; }
    } catch (e) { refreshed = false; }
    /* library upsert (name-compare guard: re-installing a library table never duplicates rows) */
    let savedNote = "";
    if (typeof avWtLibrarySave === "function") {
      if (wtUiLibHasName(s.name)) {
        savedNote = " \u00b7 already in the library";
      } else {
        let so = null;
        try { so = avWtLibrarySave(s.table); } catch (e) { so = { ok: false, error: wtUiErrText(e, "save refused") }; }
        wtUiSettle(so, function (rr) {
          const ok = (rr === true) || (rr && typeof rr === "object" && rr.ok === true) || (rr && typeof rr === "object" && typeof rr.error === "undefined");
          wtUiLibRefresh();
          if (ok) wtUiSetStatus(avWtUiState.status + " \u00b7 saved to library", "msg");
          else wtUiSetStatus(avWtUiState.status + " \u00b7 library save refused: " + wtUiErrText(rr, "refused"), "err");
        });
        savedNote = " \u00b7 saving to library\u2026";
      }
    }
    wtUiRefreshInst();
    wtUiSetStatus("installed " + (s.name || "table") + " in slot " + (isFinite(slot) ? Math.round(slot) : "?") +
      (osc ? " \u2014 osc2 \u2192 " + osc : " \u2014 slot unknown, osc2 untouched") +
      (refreshed ? "" : " \u00b7 osc options not refreshed (avSynthOscOptionsRefresh absent)") + savedNote,
      "msg");
    return true;
  } catch (e) {
    wtUiSetStatus("install failed \u2014 " + wtUiErrText(e, "unexpected"), "err");
    return false;
  }
}

function wtUiAuditionStop() {
  const s = avWtUiState;
  if (s.auditionTimer == null) return false;
  try { if (typeof clearTimeout === "function") clearTimeout(s.auditionTimer); } catch (e) { /* none */ }
  s.auditionTimer = null;
  try { if (typeof avNoteUp === "function") avNoteUp(AV_WT_UI_NOTE); } catch (e) { /* note bus gone */ }
  return true;
}

function wtUiAudition() {
  const s = avWtUiState;
  if (!s.table) { wtUiSetStatus("no table \u2014 press NEW or IMPORT first", "err"); return false; }
  if (typeof avWtInstall !== "function") {
    wtUiSetStatus("the wavetable core (av_wt.js) is not present \u2014 AUDITION is unavailable", "err");
    return false;
  }
  wtUiAuditionStop();
  let out = null;
  try { out = avWtInstall(s.table); }
  catch (e) { out = { ok: false, error: wtUiErrText(e, "the audition install failed") }; }
  wtUiSettle(out, function (r0) {
    const r = (r0 && typeof r0 === "object") ? r0 : {};
    if (r.ok !== true) {
      wtUiSetStatus("audition refused \u2014 " + wtUiErrText(r, "the core refused"), "err");
      return;
    }
    let slot = Number(r.slot);
    if (!isFinite(slot)) slot = wtUiLastInstalledSlot();
    let note = false;
    if (typeof avNoteDown === "function") {
      try { note = (avNoteDown(AV_WT_UI_NOTE, 0.9) !== false); } catch (e) { note = false; }
      if (note && typeof setTimeout === "function") {
        s.auditionTimer = setTimeout(function () {
          s.auditionTimer = null;
          try { if (typeof avNoteUp === "function") avNoteUp(AV_WT_UI_NOTE); } catch (e) { /* note bus gone */ }
        }, AV_WT_UI_NOTE_MS);
      }
    }
    wtUiRefreshInst();
    wtUiSetStatus("auditioned " + (s.name || "table") + " \u00b7 slot " + (isFinite(slot) ? Math.round(slot) : "?") +
      (note ? " \u00b7 " + AV_WT_UI_NOTE + " (short)" : " \u2014 the note bus (av_note.js) is not present; the install stands"),
      "msg");
  });
  return true;
}

/* ---------- new / import / export / rename ---------- */

function wtUiActNew() {
  const s = avWtUiState;
  if (typeof avWtNew !== "function") {
    wtUiSetStatus("the wavetable core (av_wt.js) is not present \u2014 NEW is unavailable", "err");
    return false;
  }
  s.seq += 1;
  const t = wtUiMakeTable("table " + s.seq);
  if (!t) { wtUiSetStatus("NEW refused \u2014 the core did not return a table", "err"); return false; }
  wtUiSetTable(t, "new");
  return true;
}

function wtUiActImport() {
  const host = avWtUiHost();
  let input = null;
  try {
    input = (host && typeof host.querySelector === "function") ? host.querySelector("#av-wt-import-file") : null;
  } catch (e) { input = null; }
  if (!input || typeof input.click !== "function") {
    wtUiSetStatus("the import picker is not mounted", "err");
    return false;
  }
  try { input.value = ""; } catch (e) { /* ok */ }
  try { input.click(); return true; }
  catch (e) { wtUiSetStatus("the import picker refused to open", "err"); return false; }
}

function wtUiReadText(file) {
  return new Promise(function (res, rej) {
    try {
      if (file && typeof file.text === "function") { file.text().then(res, rej); return; }
      const FR = (typeof FileReader !== "undefined") ? FileReader : null;
      if (!FR) { rej(new Error("no FileReader")); return; }
      const r = new FR();
      r.onload = function () { res(String(r.result == null ? "" : r.result)); };
      r.onerror = function () { rej(new Error("read failed")); };
      r.readAsText(file);
    } catch (e) { rej(e); }
  });
}

function wtUiReadBuf(file) {
  return new Promise(function (res, rej) {
    try {
      if (file && typeof file.arrayBuffer === "function") { file.arrayBuffer().then(res, rej); return; }
      const FR = (typeof FileReader !== "undefined") ? FileReader : null;
      if (!FR) { rej(new Error("no FileReader")); return; }
      const r = new FR();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(new Error("read failed")); };
      r.readAsArrayBuffer(file);
    } catch (e) { rej(e); }
  });
}

/* build a table from an avWtImportWt receipt {frames, name} via the pinned constructor */
function wtUiTableFromWt(res, fallbackName) {
  if (typeof avWtNew !== "function") return null;
  let t = null;
  try { t = avWtNew((res && res.name) || fallbackName || "imported"); } catch (e) { t = null; }
  if (!t || typeof t !== "object") return null;
  const frames = (res && res.frames && typeof res.frames.length === "number") ? res.frames : [];
  let want = frames.length;
  for (let guard = 0; want > 0 && avWtUiFrameCountOf(t) < want && guard < 64; guard++) {
    if (typeof avWtAddFrame !== "function") break;
    const before = avWtUiFrameCountOf(t);
    try { avWtAddFrame(t); } catch (e) { break; }
    if (avWtUiFrameCountOf(t) <= before) break;
  }
  for (let i = 0; i < frames.length && i < 512; i++) {
    const f = avWtUiCopySamples(frames[i]);
    if (f) avWtUiWriteFrame(t, i, f);
  }
  return t;
}

async function wtUiImportFile(file) {
  const s = avWtUiState;
  try {
    if (!file) return false;
    const name = String(file.name || "");
    const lower = name.toLowerCase();
    if (lower.indexOf(".wt") >= 0 && lower.indexOf(".json") < 0) {
      if (typeof avWtImportWt !== "function") {
        wtUiSetStatus("reading .wt files needs the wavetable core (av_wt.js) \u2014 IMPORT refused", "err");
        return false;
      }
      wtUiSetStatus("importing " + name + "\u2026", "msg");
      const buf = await wtUiReadBuf(file);
      let r = null;
      try { r = avWtImportWt(buf); } catch (e) { r = { error: wtUiErrText(e, "the import failed") }; }
      if (r && typeof r.then === "function") r = await r;
      if (!r || typeof r !== "object" || r.error) {
        wtUiSetStatus("import refused \u2014 " + wtUiErrText(r, "the core refused the .wt"), "err");
        return false;
      }
      const t = wtUiTableFromWt(r, name.replace(/\.wt$/i, ""));
      if (!t) { wtUiSetStatus("import refused \u2014 could not build a table", "err"); return false; }
      wtUiSetTable(t, "imported");
      return true;
    }
    /* .json (and the honest default for .json-labelled files) */
    if (typeof avWtImportJson !== "function") {
      wtUiSetStatus("reading .json tables needs the wavetable core (av_wt.js) \u2014 IMPORT refused", "err");
      return false;
    }
    wtUiSetStatus("importing " + name + "\u2026", "msg");
    const text = await wtUiReadText(file);
    let r = null;
    try { r = avWtImportJson(text); } catch (e) { r = { error: wtUiErrText(e, "the import failed") }; }
    if (r && typeof r.then === "function") r = await r;
    if (!r || typeof r !== "object" || r.error) {
      wtUiSetStatus("import refused \u2014 " + wtUiErrText(r, "the core refused the JSON"), "err");
      return false;
    }
    wtUiSetTable(r, "imported");
    return true;
  } catch (e) {
    wtUiSetStatus("import failed \u2014 " + wtUiErrText(e, "unexpected"), "err");
    return false;
  }
}

function wtUiSanitizeFile(name) {
  try {
    const n = String(name == null ? "" : name).replace(/[^a-z0-9._ -]+/gi, "_").replace(/\s+/g, "_").slice(0, 48);
    return n || "wavetable";
  } catch (e) { return "wavetable"; }
}

function wtUiDownload(filename, text) {
  const w = avWtUiWin();
  const d = avWtUiDoc();
  if (!w || !d) return false;
  try {
    let url = "";
    if (typeof w.Blob === "function" && w.URL && typeof w.URL.createObjectURL === "function") {
      const blob = new w.Blob([text], { type: "application/json" });
      url = w.URL.createObjectURL(blob);
    } else {
      url = "data:application/json;charset=utf-8," + encodeURIComponent(text);
    }
    if (!url) return false;
    const a = d.createElement("a");
    if (!a) return false;
    a.href = url;
    a.download = filename;
    if (typeof a.setAttribute === "function") a.setAttribute("rel", "noopener");
    const parent = d.body || d.documentElement;
    if (parent && typeof parent.appendChild === "function") parent.appendChild(a);
    if (typeof a.click === "function") a.click();
    if (parent && typeof parent.removeChild === "function" && typeof a.remove === "function") a.remove();
    if (w.URL && typeof w.URL.revokeObjectURL === "function" && url.indexOf("blob:") === 0) {
      try {
        if (typeof setTimeout === "function") setTimeout(function () { try { w.URL.revokeObjectURL(url); } catch (e) { /* gone */ } }, 1000);
        else w.URL.revokeObjectURL(url);
      } catch (e) { /* best effort */ }
    }
    return true;
  } catch (e) { return false; }
}

function wtUiExportReceipt(txt) {
  const s = avWtUiState;
  if (typeof txt !== "string" || !txt) {
    wtUiSetStatus("export refused \u2014 the core returned no JSON", "err");
    return false;
  }
  const fn = wtUiSanitizeFile(s.name || "wavetable") + ".wt.json";
  const ok = wtUiDownload(fn, txt);
  wtUiSetStatus(ok
    ? "exported " + fn + " \u00b7 " + txt.length + " chars"
    : "export built (" + txt.length + " chars) but the download could not start \u2014 save is unavailable here", ok ? "msg" : "err");
  return ok;
}

function wtUiActExport() {
  const s = avWtUiState;
  if (!s.table) { wtUiSetStatus("no table to export \u2014 press NEW or IMPORT first", "err"); return false; }
  if (typeof avWtExportJson !== "function") {
    wtUiSetStatus("the wavetable core (av_wt.js) is not present \u2014 EXPORT is unavailable", "err");
    return false;
  }
  let txt = null;
  try { txt = avWtExportJson(s.table); } catch (e) { txt = null; }
  if (txt && typeof txt.then === "function") {
    wtUiSetStatus("exporting\u2026", "msg");
    wtUiSettle(txt, function (r) { wtUiExportReceipt(r); });
    return true;
  }
  return wtUiExportReceipt(txt);
}

function wtUiRename(v) {
  const s = avWtUiState;
  const name = String(v == null ? "" : v).trim().slice(0, 48);
  if (!s.table || !name || name === s.name) return false;
  const prev = s.name;
  let ok = false;
  try {
    s.table.name = name;
    ok = (avWtUiTableName(s.table) === name);
  } catch (e) { ok = false; }
  if (!ok) {
    wtUiSetStatus("rename refused \u2014 the core keeps table names read-only", "err");
    wtUiPaintName(avWtUiHost());
    return false;
  }
  s.name = name;
  wtUiSetStatus("renamed " + prev + " \u2192 " + name, "msg");
  return true;
}

/* ---------- library ---------- */

function wtUiLibListed(r) {
  const s = avWtUiState;
  let rows = [];
  let err = "";
  try {
    if (r && r.error) { err = String(r.error); }
    else if (r && typeof r.length === "number") { rows = r; }
    else if (r && r.rows && typeof r.rows.length === "number") { rows = r.rows; }
  } catch (e) { rows = []; }
  const out = [];
  for (let i = 0; i < rows.length && i < 64; i++) {
    const e = rows[i];
    if (!e || typeof e !== "object") continue;
    const id = (typeof e.id === "string" && e.id) ? e.id : ((typeof e.id === "number" && isFinite(e.id)) ? String(e.id) : "");
    if (!id) continue;
    let frames = null;
    if (typeof e.frames === "number" && isFinite(e.frames)) frames = e.frames;
    else if (typeof e.frameCount === "number" && isFinite(e.frameCount)) frames = e.frameCount;
    out.push({ id: id, name: (typeof e.name === "string" && e.name) ? e.name : "table", frames: frames });
  }
  s.lib = out;
  s.lastLibErr = err;
  wtUiPaintLib(avWtUiHost());
}

function wtUiLibRefresh() {
  const s = avWtUiState;
  try {
    if (typeof avWtLibraryList !== "function") {
      s.lastLibErr = "the library lives in av_wt.js (not present)";
      s.lib = [];
      wtUiPaintLib(avWtUiHost());
      return false;
    }
    const out = avWtLibraryList();
    wtUiSettle(out, wtUiLibListed);
    return true;
  } catch (e) {
    s.lastLibErr = wtUiErrText(e, "the library list failed");
    return false;
  }
}

function wtUiLibLoad(id, andInstall) {
  const s = avWtUiState;
  if (typeof avWtLibraryLoad !== "function") {
    wtUiSetStatus("the wavetable core (av_wt.js) is not present \u2014 library actions are unavailable", "err");
    return false;
  }
  wtUiSetStatus((andInstall ? "loading + installing " : "loading ") + id + "\u2026", "msg");
  let out = null;
  try { out = avWtLibraryLoad(id); } catch (e) { out = { error: wtUiErrText(e, "the load failed") }; }
  wtUiSettle(out, function (r) {
    if (!r || typeof r !== "object" || r.error) {
      wtUiSetStatus("library load refused \u2014 " + wtUiErrText(r, "the core refused"), "err");
      return false;
    }
    wtUiSetTable(r, "loaded");
    if (andInstall) wtUiInstallCurrent();
    return true;
  });
  return true;
}

function wtUiLibDelete(id) {
  if (typeof avWtLibraryDelete !== "function") {
    wtUiSetStatus("the wavetable core (av_wt.js) is not present \u2014 library actions are unavailable", "err");
    return false;
  }
  wtUiSetStatus("deleting " + id + "\u2026", "msg");
  let out = null;
  try { out = avWtLibraryDelete(id); } catch (e) { out = { ok: false, error: wtUiErrText(e, "the delete failed") }; }
  wtUiSettle(out, function (r) {
    const ok = (r === true) || (r && typeof r === "object" && r.ok === true) ||
               (r && typeof r === "object" && typeof r.error === "undefined" && typeof r.ok === "undefined");
    if (!ok) {
      wtUiSetStatus("library delete refused \u2014 " + wtUiErrText(r, "the core refused"), "err");
      return false;
    }
    wtUiSetStatus("deleted " + id + " from the library", "msg");
    wtUiLibRefresh();
    return true;
  });
  return true;
}

function wtUiLibAct(act, id) {
  if (act === "load") return wtUiLibLoad(id, false);
  if (act === "install") return wtUiLibLoad(id, true);
  if (act === "delete") return wtUiLibDelete(id);
  return false;
}

/* ---------- event wiring (one delegation per host) ---------- */

function wtUiOnClick(ev) {
  try {
    const t = ev && ev.target;
    if (!t || typeof t.closest !== "function") return;
    let el;
    el = t.closest("[data-tool]");
    if (el) { wtUiToolClick(String(el.getAttribute("data-tool") || "")); return; }
    el = t.closest("#av-wt-frame-add");
    if (el) { wtUiFrameAdd(); return; }
    el = t.closest("[data-wt-frame-del]");
    if (el) { wtUiFrameDel(parseInt(el.getAttribute("data-wt-frame-del"), 10)); return; }
    el = t.closest("[data-wt-frame]");
    if (el) { wtUiSelectFrame(parseInt(el.getAttribute("data-wt-frame"), 10)); return; }
    el = t.closest("[data-frame]");
    if (el) { wtUiSelectFrame(parseInt(el.getAttribute("data-frame"), 10)); return; }
    el = t.closest("[data-wt-lib-act]");
    if (el) { wtUiLibAct(String(el.getAttribute("data-wt-lib-act") || ""), String(el.getAttribute("data-lib-id") || "")); return; }
    el = t.closest("#av-wt-morph-bake");
    if (el) { wtUiMorphBake(); return; }
    el = t.closest("#av-wt-new");
    if (el) { wtUiActNew(); return; }
    el = t.closest("#av-wt-import");
    if (el) { wtUiActImport(); return; }
    el = t.closest("#av-wt-export");
    if (el) { wtUiActExport(); return; }
    el = t.closest("#av-wt-install");
    if (el) { wtUiInstallCurrent(); return; }
    el = t.closest("#av-wt-audition");
    if (el) { wtUiAudition(); return; }
  } catch (e) { /* a listener never throws outward */ }
}

function wtUiToolClick(tool) {
  if (tool === "normalise") { wtUiToolNormalise(); return; }
  if (tool === "undo-lite") { wtUiToolUndo(); return; }
  if (tool === "draw" || tool === "line" || tool === "smooth") {
    avWtUiState.tool = tool;
    wtUiPaintTools(avWtUiHost());
    wtUiPaintReadouts(avWtUiHost());
  }
}

function wtUiOnInput(ev) {
  try {
    const t = ev && ev.target;
    if (!t || !t.id) return;
    const s = avWtUiState;
    if (t.id === "av-wt-morph") {
      s.morph.x = avWtUiClamp(Number(t.value) / 100, 0, 1);
      wtUiPaintReadouts(avWtUiHost());
      wtUiMorphPreview();
    } else if (t.id === "av-wt-harmonics") {
      s.harmonics = Math.round(avWtUiClamp(Number(t.value), 1, AV_WT_UI_SAMPLES >> 1));
      wtUiPaintReadouts(avWtUiHost());
    }
  } catch (e) { /* a listener never throws outward */ }
}

function wtUiOnChange(ev) {
  try {
    const t = ev && ev.target;
    if (!t || !t.id) return;
    const s = avWtUiState;
    if (t.id === "av-wt-morph") {
      s.morph.x = avWtUiClamp(Number(t.value) / 100, 0, 1);
      wtUiPaintReadouts(avWtUiHost());
      wtUiMorphPreview();
    } else if (t.id === "av-wt-morph-b") {
      const idx = Math.round(Number(t.value));
      if (isFinite(idx)) { s.morph.b = Math.round(avWtUiClamp(idx, 0, Math.max(0, s.frameCount - 1))); wtUiMorphPreview(); }
    } else if (t.id === "av-wt-harmonics") {
      s.harmonics = Math.round(avWtUiClamp(Number(t.value), 1, AV_WT_UI_SAMPLES >> 1));
      wtUiApplyTrim();
    } else if (t.id === "av-wt-name") {
      wtUiRename(t.value);
    } else if (t.id === "av-wt-import-file") {
      const files = t.files;
      const f = (files && files.length) ? files[0] : null;
      if (f) wtUiImportFile(f);
      try { t.value = ""; } catch (e) { /* ok */ }
    }
  } catch (e) { /* a listener never throws outward */ }
}

function wtUiWireHost(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  try {
    if (host.dataset && host.dataset.avWtWired === "1") return true;
    if (host.dataset) host.dataset.avWtWired = "1";
    host.addEventListener("click", wtUiOnClick);
    host.addEventListener("input", wtUiOnInput);
    host.addEventListener("change", wtUiOnChange);
    return true;
  } catch (e) { return false; }
}

function wtUiBindCanvas() {
  const s = avWtUiState;
  const c = wtUiCanvasEl();
  s.canvas = c || null;
  if (!c) return false;
  try {
    if (!(c.dataset && c.dataset.avWtCanvas === "1")) {
      if (c.dataset) c.dataset.avWtCanvas = "1";
      if (typeof c.addEventListener === "function") {
        c.addEventListener("pointerdown", wtUiPointerDown);
        c.addEventListener("pointermove", wtUiPointerMove);
        c.addEventListener("pointerup", wtUiPointerUp);
        c.addEventListener("pointercancel", wtUiPointerUp);
      }
    }
  } catch (e) { /* the canvas listeners are best effort */ }
  try {
    if (typeof ResizeObserver === "function") {
      if (s.obs && s.obsCanvas !== c) { try { s.obs.disconnect(); } catch (e) { /* gone */ } s.obs = null; }
      if (s.obsCanvas !== c) {
        s.obs = new ResizeObserver(function () { wtUiRequestDraw(); });
        s.obs.observe(c);
        s.obsCanvas = c;
      }
    }
  } catch (e) { /* no RO: the window resize fallback covers it */ }
  if (!s.resizeWired) {
    try {
      const w = avWtUiWin();
      if (w && typeof w.addEventListener === "function") {
        s.resizeWired = true;
        w.addEventListener("resize", function () { wtUiRequestDraw(); });
      }
    } catch (e) { /* no window */ }
  }
  return true;
}

/* ---------- markup (pure string builders) ---------- */

function wtUiBodyHTML() {
  const s = avWtUiState;
  let tools = "";
  for (let i = 0; i < AV_WT_UI_TOOLS.length; i++) {
    const tool = AV_WT_UI_TOOLS[i];
    const on = (tool === s.tool);
    tools += '<button type="button" class="av-btn mini av-wt-tool-btn' + (on ? " av-wt-tool-on" : "") +
      '" data-tool="' + avWtUiEsc(tool) + '" aria-pressed="' + (on ? "true" : "false") +
      '" title="' + avWtUiEsc(AV_WT_UI_TOOL_TITLES[tool] || tool) + '">' + avWtUiEsc(AV_WT_UI_TOOL_LABELS[tool] || tool) + "</button>";
  }
  let acts = "";
  for (let i = 0; i < AV_WT_UI_ACTS.length; i++) {
    const a = AV_WT_UI_ACTS[i];
    acts += '<button type="button" class="av-btn mini av-wt-btn" id="' + avWtUiEsc(a.id) + '" title="' + avWtUiEsc(a.title) + '">' + avWtUiEsc(a.label) + "</button>";
  }
  const px = Math.round(avWtUiClamp(s.morph.x, 0, 1) * 100);
  const harm = Math.round(avWtUiClamp(s.harmonics, 1, AV_WT_UI_SAMPLES >> 1));
  return '<div class="av-wt" data-av-wt="1">' +
    '<div class="av-wt-head"><span class="av-wt-title">WT EDITOR</span>' +
    '<span class="av-wt-cap av-dim">Draw a frame \u00b7 trim its harmonics \u00b7 morph A\u2192B \u00b7 install it as an osc2 wavetable. Everything stays on this machine.</span>' +
    '<span class="av-wt-namewrap"><label class="av-wt-name-lbl" for="av-wt-name">NAME</label>' +
    '<input class="av-wt-name" id="av-wt-name" type="text" spellcheck="false" autocomplete="off" maxlength="48" aria-label="Wavetable name"></span></div>' +
    '<div class="av-wt-status-line"><span class="av-wt-status av-wt-msg" id="av-wt-status" role="status" aria-live="polite">' + avWtUiEsc(s.status) + "</span></div>" +
    '<div class="av-wt-stage"><canvas class="av-wt-canvas" id="av-wt-canvas" width="2048" height="160" role="img" aria-label="Wavetable frame editor \u2014 draw with the pointer"></canvas>' +
    '<span class="av-wt-canvas-cap av-dim" id="av-wt-canvas-cap"></span></div>' +
    '<div class="av-wt-tool" id="av-wt-tool">' + tools + "</div>" +
    '<div class="av-wt-frames" id="av-wt-frames"><button type="button" class="av-btn mini av-wt-frame-add" id="av-wt-frame-add" title="add a frame after the last one">+ FRAME</button>' +
    '<span class="av-wt-chips" id="av-wt-chips"></span></div>' +
    '<div class="av-wt-morph-sec"><span class="av-wt-lbl" title="A is the frame being edited; B is picked here">MORPH A\u2192B</span>' +
    '<input class="av-wt-range" id="av-wt-morph" type="range" min="0" max="100" step="1" value="' + px + '" aria-label="Morph position from the current frame (A) to frame B">' +
    '<label class="av-wt-lbl" for="av-wt-morph-b">B</label>' +
    '<select class="av-select av-wt-select" id="av-wt-morph-b" aria-label="Morph target frame B"></select>' +
    '<span class="av-wt-morph-val" id="av-wt-morph-val">' + px + "%</span>" +
    '<button type="button" class="av-btn mini av-wt-btn" id="av-wt-morph-bake" title="BAKE \u2014 write the morph preview into the current frame">BAKE</button></div>' +
    '<div class="av-wt-spec"><span class="av-wt-lbl">HARMONICS \u2264</span>' +
    '<input class="av-wt-range" id="av-wt-harmonics" type="range" min="1" max="1024" step="1" value="' + harm + '" aria-label="Keep harmonics 1..N">' +
    '<span class="av-wt-harm-val" id="av-wt-harm-val">1..' + harm + "</span>" +
    '<span class="av-wt-lbl av-dim" title="keep harmonics 1..N, zero everything above and the DC bin, then write the frame">trim on release \u00b7 DC removed</span></div>' +
    '<div class="av-wt-lib" id="av-wt-lib"><p class="av-note av-dim av-wt-lib-empty">library \u2014 install a table to store it here</p></div>' +
    '<div class="av-wt-actions">' + acts +
    '<input class="av-wt-file" id="av-wt-import-file" type="file" accept=".wt,.json" data-wt-import-input hidden></div>' +
    '<p class="av-note av-dim av-wt-note">DRAW / LINE / SMOOTH shape the frame (peak-normalised to 0.95 on release) \u00b7 UNDO steps back one edit \u00b7 INSTALL sends the table to the engine and points osc2 at it.</p>' +
    "</div>";
}

/* the parent's own `#av-wt` card element: this root takes the id only when no such element
   exists (never a duplicate id) — the av_files_ui idiom */
function wtUiEnsureRootId(card) {
  try {
    if (!card || card.id) return false;
    const d = avWtUiDoc();
    const existing = (d && typeof d.getElementById === "function") ? d.getElementById("av-wt") : null;
    if (existing && existing !== card) return false;
    card.id = "av-wt";
    return true;
  } catch (e) { return false; }
}

/* ---------- init / sync / snap / classes ---------- */

function avWtUiInit() {
  const host = avWtUiHost();
  if (!host) return false;
  try {
    const s = avWtUiState;
    let card = null;
    try { card = (typeof host.querySelector === "function") ? host.querySelector(".av-wt") : null; } catch (e) { card = null; }
    if (!card) {
      s.memo = { text: {}, cls: {} };
      host.innerHTML = wtUiBodyHTML();
      try { card = (typeof host.querySelector === "function") ? host.querySelector(".av-wt") : null; } catch (e2) { card = null; }
    }
    wtUiEnsureRootId(card);
    wtUiWireHost(host);
    wtUiBindCanvas();
    s.chipSig = ""; s.morphSig = ""; s.libSig = "";
    /* first paint: one editable scratch table when the core is present and none exists yet
       (an init-time convenience, not a job — NEW stays available any time) */
    if (!s.table && typeof avWtNew === "function") {
      s.seq += 1;
      const t = wtUiMakeTable("table " + s.seq);
      if (t) wtUiSetTable(t, "new");
    }
    s.inited = true;
    s.mounts += 1;
    avWtUiSync(host);
    if (!s.table) {
      const cores = wtUiCores();
      if (!cores["new"]) {
        wtUiSetStatus("the wavetable core (av_wt.js) is not present \u2014 the editor mounts and every action refuses honestly", "err");
      }
    }
    wtUiLibRefresh();
    wtUiRefreshInst();
    return true;
  } catch (e) {
    try { avWtUiState.lastError = String((e && e.message) || e); } catch (e2) { /* ok */ }
    return false;
  }
}

function avWtUiSync(root) {
  let host = root || null;
  if (!host) host = avWtUiHost();
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    wtUiPaintStatus(host);
    wtUiPaintTools(host);
    wtUiPaintChips(host);
    wtUiPaintMorphSel(host);
    wtUiPaintReadouts(host);
    wtUiPaintName(host);
    wtUiPaintLib(host);
    wtUiRequestDraw();
    return true;
  } catch (e) { return false; }
}

function avWtUiSnap() {
  const host = avWtUiHost();
  const s = avWtUiState;
  const out = {
    version: AV_WT_UI_VERSION,
    inited: !!s.inited,
    mounts: s.mounts,
    host: !!host,
    wired: !!(host && host.dataset && host.dataset.avWtWired === "1"),
    card: false,
    cores: wtUiCores(),
    table: s.table
      ? { name: s.name || avWtUiTableName(s.table), frames: s.frameCount, current: s.frame }
      : null,
    mode: s.mode,
    tool: s.tool,
    tools: AV_WT_UI_TOOLS.slice(),
    edits: s.edits,
    undo: s.undo ? { held: true, frame: s.undo.frame } : { held: false, frame: null },
    morph: { a: s.frame, b: s.morph.b, x: s.morph.x, preview: s.mode === "morph" },
    harmonics: s.harmonics,
    canvas: { present: false, w: 0, h: 0, dpr: s.dpr, draws: s.drawn },
    library: { count: s.lib.length, rows: s.lib.slice(0, 64), error: s.lastLibErr || "" },
    installed: s.inst.slice(0, 16),
    osc: s.osc || "",
    status: s.status,
    statusKind: s.statusKind,
    lastError: s.lastError || "",
    controls: {
      canvas: false, tool: false, frames: false, frameAdd: false, morph: false, morphB: false,
      harmonics: false, lib: false, new: false, importBtn: false, export: false, install: false,
      audition: false, status: false, fileInput: false, name: false, bake: false,
    },
    classes: avWtUiClasses(),
  };
  try {
    if (host && typeof host.querySelector === "function") {
      out.card = !!host.querySelector(".av-wt");
      const q = function (sel) { return !!host.querySelector(sel); };
      out.controls.canvas = q("#av-wt-canvas");
      out.controls.tool = q("#av-wt-tool");
      out.controls.frames = q("#av-wt-frames");
      out.controls.frameAdd = q("#av-wt-frame-add");
      out.controls.morph = q("#av-wt-morph");
      out.controls.morphB = q("#av-wt-morph-b");
      out.controls.harmonics = q("#av-wt-harmonics");
      out.controls.lib = q("#av-wt-lib");
      out.controls["new"] = q("#av-wt-new");
      out.controls.importBtn = q("#av-wt-import");
      out.controls["export"] = q("#av-wt-export");
      out.controls.install = q("#av-wt-install");
      out.controls.audition = q("#av-wt-audition");
      out.controls.status = q("#av-wt-status");
      out.controls.fileInput = q("#av-wt-import-file");
      out.controls.name = q("#av-wt-name");
      out.controls.bake = q("#av-wt-morph-bake");
      const c = host.querySelector("#av-wt-canvas");
      if (c) {
        out.canvas.present = true;
        out.canvas.w = Number(c.width) || 0;
        out.canvas.h = Number(c.height) || 0;
      }
    }
  } catch (e) { /* no DOM */ }
  try {
    if (typeof avParams !== "undefined" && avParams && typeof avParams["osc2.type"] === "string") {
      if (!out.osc) out.osc = avParams["osc2.type"];
    }
  } catch (e) { /* no params mirror */ }
  return out;
}

function avWtUiClasses() {
  return AV_WT_UI_CLASSES.slice();
}

/* ---------- debug/verify handle (rigs + parent call these; names are the contract) ---------- */

if (typeof window !== "undefined") {
  try {
    const stateFn = function () { return avWtUiSnap(); };
    try {
      Object.defineProperty(stateFn, "inited", { get: function () { return !!avWtUiState.inited; } });
      Object.defineProperty(stateFn, "mounts", { get: function () { return avWtUiState.mounts; } });
      Object.defineProperty(stateFn, "table", { get: function () { return avWtUiState.table; } });
    } catch (e2) { /* getters are a nicety */ }
    window.__avWtUi = {
      version: AV_WT_UI_VERSION,
      state: stateFn,
      init: function () { return avWtUiInit(); },
      snap: function () { return avWtUiSnap(); },
      classes: function () { return avWtUiClasses(); },
      sync: function (root) { return avWtUiSync(root); },
    };
  } catch (e) { /* no window — nothing to publish */ }
}
