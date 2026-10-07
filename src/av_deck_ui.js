/* Anvil — DECK card (child sa-B): the pro readouts card mounted into the parent-owned host
   `#av-deck-host` (the parent adds the `#av-deck` card at integration and calls avDeckUiInit();
   this module only fills the host). Per verify/_deck_wave.md §2.2.

   WHAT THIS CARD IS
   - THREE HiDPI canvases (devicePixelRatio-scaled backing store, refit only when it differs —
     the av_sample law — crisp 1px grids, teal palette):
       · SCOPE    — 480-pt min/max envelope of the time-domain pull (avDeckFrame('scope'));
       · SPECTRUM — 96 log bands 20 Hz..20 kHz, drawn as bars + a cap line over the tops
                    (avDeckFrame('spectrum')); the DB FLOOR select maps band dB to display;
       · WATERFALL— 96-row spectrogram of the 96 bands (avDeckFrame('waterfall')), painted
                    through one reusable 96×96 ImageData blitted from an offscreen canvas
                    (the "ImageData-style" path §2.2 allows; a per-cell fillRect fallback
                    covers hosts without createElement/createImageData).
   - A meter block (DOM): LUFS + TRUE PEAK bars via the deck's `pure.meterNorm` (local
     fallback when `window.__avDeck.pure` is absent) + an L/R/peak gain strip
     (avDeckFrame('meters') / avDeckFrame('gain')).
   - A readouts row: BPM · VOICES n/max · TIER · CTX · CPU ms · NOTES · last note —
     straight from avDeckReadouts().
   - Controls: RUN/PAUSE toggle · FREEZE toggle · DB FLOOR select (-90/-60/-40/-20) ·
     WATERFALL rate select (60/120/240 ms). EVERY commit goes through avDeckSetView.

   THE VIEW COMMIT LADDER (documented seam). §2.1 pins avDeckSetView(kind, patch) -> {ok, view}
   but does not fix which of several plausible call shapes the sibling implements. The card
   tries, in order, and stops at the first non-refusal:
     ["view", patch] · [key, patch] · [key, value] · [patch]
   where key ∈ {run, freeze, dbFloor, waterfallMs} and patch = {key: value}. Commits are
   idempotent, so a shape probe can never corrupt state; when every shape refuses, the card
   keeps its mirror unchanged and says so (honest refusal). On success the returned `view`
   object (and, on the ~0.5 s cadence, window.__avDeck.snapshot()) is adopted so the UI never
   disagrees with the core. The card seeds the pinned defaults ONCE per mount
   (run=true · freeze=false · dbFloor=-60 · waterfallMs=120).

   rAF DISCIPLINE (pinned). The loop runs only while (visible ∩ !paused ∩ !document.hidden
   ∩ deck core present); a step gate targets ~30 fps (AV_DECK_UI_STEP_MS = 33); when idle it
   early-exits before any work (the av_seq_ui seq-loop precedent). The loop STOPS requesting
   frames the moment a gate closes (pause / hidden / off-screen) and is restarted by the
   IntersectionObserver, the visibilitychange listener, or a RUN/SYNC — so a paused or hidden
   deck adds zero CPU. ALL drawing goes through the SAME work path the rig drives:
   `window.__avDeckUi.step()` performs ONE avDeckStep() + one FULL redraw (forced waterfall
   repaint) and never depends on rAF timing.

   FREEZE LAW (UI side): while frozen the card skips canvas repaints on non-forced ticks
   (the presented frames are held by the core; redrawing identical pixels would only burn
   CPU) — forced `__avDeckUi.step()` still draws, deterministically. Counters/readouts keep
   updating. PAUSE (run=false) halts stepping AND drawing.

   Honest degraded notes when av_deck is absent (canvases idle, readouts dashed); the card
   never touches the engine directly, never creates an AudioContext, never throws, has no
   console output, no DOM at load, and ONE namespace: avDeckUi* / AV_DECK_UI_*.

   ID INVENTORY (rig + parent rely on these):
     #av-deck-run · #av-deck-freeze · #av-deck-dbfloor · #av-deck-wfrate
     #av-deck-scope · #av-deck-spectrum · #av-deck-waterfall      (the three canvases)
     #av-deck-status · #av-deck-note
     #av-deck-m-lufs · #av-deck-m-lufs-bar · #av-deck-m-tp · #av-deck-m-tp-bar
     #av-deck-g-l · #av-deck-g-l-bar · #av-deck-g-r · #av-deck-g-r-bar
     #av-deck-g-pk · #av-deck-g-pk-bar
     #av-deck-rd-bpm · #av-deck-rd-voices · #av-deck-rd-tier · #av-deck-rd-ctx
     #av-deck-rd-cpu · #av-deck-rd-notes · #av-deck-rd-last
   CARD HOOKS: `.av-deck[data-av-deck="1"]` root · `[data-deck-act=run|freeze]` buttons
   (state class `av-deck-on`, aria-pressed) · `select[data-deck-view=dbFloor|waterfallMs]` ·
   `[data-meter=...]`, `[data-gain=...]`, `.av-deck-idle` (panes while not attached),
   `.av-deck-over` (true-peak clip).

   OBSERVABLES: avDeckUiInit() -> bool (false without #av-deck-host; idempotent; dataset
   marker avDeckUiWired='1') · avDeckUiSync() -> bool · avDeckUiClasses() -> string[] (the
   NEW css classes; the parent styles them) · avDeckUiSnap() -> honest card state ·
   window.__avDeckUi = { state, sync, step, ... } (state = the snapshot fn; step() = the
   rig's deterministic driver).

   ONE writer (child sa-B). Sibling av_deck.js (sa-A) is consumed through the pinned §2.1
   names with typeof guards ONLY — avDeckInit/Attach/Detach/Step/Frame/Readouts/SetView/
   Classes and the window.__avDeck handle. DOM touches live only inside guarded functions. */

"use strict";

const AV_DECK_UI_VERSION = "s4.0";
const AV_DECK_UI_STEP_MS = 33;                    /* ~30 fps step gate (rAF is 60 Hz) */
const AV_DECK_UI_ATTACH_MS = 2000;                /* attach retry cadence when refused */
const AV_DECK_UI_ADOPT_MS = 500;                  /* snapshot view-adopt cadence */
const AV_DECK_UI_WF_ROWS = 96;                    /* waterfall ring rows */
const AV_DECK_UI_BANDS = 96;                      /* log bands (pinned) */
const AV_DECK_UI_FLOORS = [-90, -60, -40, -20];   /* DB FLOOR select values */
const AV_DECK_UI_WF_RATES = [60, 120, 240];       /* WATERFALL select values (ms) */
const AV_DECK_UI_DB_FLOOR_MIN = -90;
const AV_DECK_UI_DB_FLOOR_MAX = -20;
const AV_DECK_UI_WF_MS_MIN = 40;
const AV_DECK_UI_WF_MS_MAX = 250;
const AV_DECK_UI_VIEW_DEFAULTS = { run: true, freeze: false, dbFloor: -60, waterfallMs: 120 };

/* The NEW css classes this card introduces (the parent styles them; av-deck-host excluded —
   it is parent-owned). Kept in one place so the integration class-coverage check can diff. */
const AV_DECK_UI_CLASSES = [
  "av-deck", "av-deck-head", "av-deck-title", "av-deck-cap",
  "av-deck-status-line", "av-deck-status", "av-deck-msg", "av-deck-err",
  "av-deck-controls", "av-deck-ctl", "av-deck-ctl-lbl", "av-deck-btn", "av-deck-select",
  "av-deck-on",
  "av-deck-panes", "av-deck-pane", "av-deck-pane-lbl", "av-deck-canvas",
  "av-deck-scope", "av-deck-spectrum", "av-deck-waterfall", "av-deck-idle",
  "av-deck-meters", "av-deck-meter", "av-deck-meter-lbl", "av-deck-meter-bar",
  "av-deck-meter-fill", "av-deck-meter-val", "av-deck-over",
  "av-deck-gain", "av-deck-gain-row", "av-deck-gain-lbl", "av-deck-gain-bar",
  "av-deck-gain-fill", "av-deck-gain-val",
  "av-deck-readouts", "av-deck-rd", "av-deck-rd-lbl", "av-deck-rd-val",
  "av-deck-note", "av-deck-foot",
];

/* UI-local state only — every deck fact is read through the pinned apis per paint */
const avDeckUiState = {
  inited: false, mounts: 0,
  deckPresent: false, attached: false, viewSeeded: false,
  /* the view mirror (authoritative copy lives in the deck core; this tracks it) */
  view: { run: AV_DECK_UI_VIEW_DEFAULTS.run, freeze: AV_DECK_UI_VIEW_DEFAULTS.freeze,
          dbFloor: AV_DECK_UI_VIEW_DEFAULTS.dbFloor, waterfallMs: AV_DECK_UI_VIEW_DEFAULTS.waterfallMs },
  /* counters (observability) */
  steps: 0, forcedSteps: 0, frames: 0, draws: 0, ticks: 0,
  lastStepAt: -1e9, lastAttachTry: 0, lastAdoptAt: -1e9,
  /* loop discipline */
  rafOn: false, visible: true, docHidden: false, io: null, docBound: false,
  /* frame readiness + waterfall state */
  scopeReady: false, spectrumReady: false, spectrumLinear: false,
  wfReady: false, wfMode: "none", wfSrc: null, wfSrcN: 0, wfNewest: -1,
  wfRing: null, wfHead: 0, wfCount: 0, wfLastSig: NaN, wfLastCount: null, wfDirty: true,
  wfOff: null, wfOctx: null, wfImg: null, wfW: 0, wfH: 0,
  /* write-on-change memos so idle ticks never touch the DOM */
  lastText: {}, lastPct: {}, lastClass: {},
  /* readouts snapshot + copy */
  readouts: null, meters: null,
  statusMsg: "deck idle", statusKind: "msg", noteText: "",
};

/* ---------- small pure helpers (no DOM; harness-covered) ---------- */

const avDeckUiEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const avDeckUiNum = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };

function avDeckUiInt(v, lo, hi, def) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return (def === undefined ? null : def);
  return Math.max(lo, Math.min(hi, n));
}

function avDeckUiClamp01(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return n < 0 ? 0 : (n > 1 ? 1 : n);
}

/* receipt verdict: true / {ok:true} / {view:...} accept; false / null / {ok:false} refuse */
function avDeckUiOK(r) {
  try {
    if (r === true) return true;
    if (r && typeof r === "object") {
      if (r.ok === true) return true;
      if (r.ok === undefined && r.view !== undefined && r.view !== null) return true;
    }
  } catch (e) { /* refuse */ }
  return false;
}

function avDeckUiNow() {
  try {
    if (typeof performance !== "undefined" && performance && typeof performance.now === "function") return performance.now();
  } catch (e) { /* fall back */ }
  return Date.now();
}

function avDeckUiBoolish(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number" && isFinite(v)) return v !== 0;
  return null;
}

function avDeckUiPickBool(obj, keys) {
  try {
    if (!obj || typeof obj !== "object" || !keys || !keys.length) return null;
    for (let i = 0; i < keys.length; i++) {
      const b = avDeckUiBoolish(obj[keys[i]]);
      if (b !== null) return b;
    }
  } catch (e) { /* none */ }
  return null;
}

function avDeckUiPickNum(obj, keys) {
  try {
    if (!obj || typeof obj !== "object" || !keys || !keys.length) return null;
    for (let i = 0; i < keys.length; i++) {
      const v = obj[keys[i]];
      if (typeof v === "number" && isFinite(v)) return v;
    }
  } catch (e) { /* none */ }
  return null;
}

/* a numeric field by candidate names (null when absent/garbage) — used for row counters */
function avDeckUiNumField(obj, keys) {
  try {
    return avDeckUiPickNum(obj, keys);
  } catch (e) { return null; }
}

/* ---------- guarded DOM + deck access (no throw, no noise) ---------- */

function avDeckUiWin() {
  try { if (typeof window !== "undefined") return window; } catch (e) { /* none */ }
  return null;
}

function avDeckUiDoc() {
  try { if (typeof document !== "undefined") return document; } catch (e) { /* none */ }
  return null;
}

function avDeckUiHost() {
  try {
    const d = avDeckUiDoc();
    if (d && typeof d.getElementById === "function") return d.getElementById("av-deck-host");
  } catch (e) { /* no document */ }
  return null;
}

function avDeckUiEl(sel) {
  try {
    const host = avDeckUiHost();
    if (host && typeof host.querySelector === "function") return host.querySelector(sel);
  } catch (e) { /* no DOM */ }
  return null;
}

function avDeckUiDeckPresent() {
  try {
    return typeof avDeckInit === "function" || typeof avDeckAttach === "function"
      || typeof avDeckStep === "function" || typeof avDeckFrame === "function"
      || typeof avDeckReadouts === "function" || typeof avDeckSetView === "function";
  } catch (e) { return false; }
}

function avDeckUiReadouts() {
  try {
    if (typeof avDeckReadouts === "function") {
      const r = avDeckReadouts();
      if (r && typeof r === "object") return r;
    }
  } catch (e) { /* honest null */ }
  return null;
}

function avDeckUiFrame(kind) {
  try {
    if (typeof avDeckFrame === "function") {
      const f = avDeckFrame(kind);
      if (f && typeof f === "object") return f;
    }
  } catch (e) { /* honest null */ }
  return null;
}

/* ---------- value -> display mapping (deck pure.meterNorm first, local law second) ---------- */

function avDeckUiMeterNorm(db, floor, top) {
  try {
    const w = avDeckUiWin();
    const pure = (w && w.__avDeck && w.__avDeck.pure && typeof w.__avDeck.pure === "object") ? w.__avDeck.pure : null;
    if (pure && typeof pure.meterNorm === "function") {
      const v = pure.meterNorm(db, floor, top);
      if (isFinite(v)) return avDeckUiClamp01(v);
    }
  } catch (e) { /* local law */ }
  const f = avDeckUiNum(floor, -60), t = avDeckUiNum(top, 0);
  const d = avDeckUiNum(db, f);
  if (!(t > f)) return 0;
  return avDeckUiClamp01((d - f) / (t - f));
}

/* 96 log bands: values are dB (the core's own law — dbOfAmp/meterNorm); if the whole frame
   reads as 0..1 the bands are already normalized and pass through (tolerant seam). */
function avDeckUiBandsAreNorm(bands, count) {
  try {
    let seen = 0;
    for (let i = 0; i < count; i += 4) {
      const v = Number(bands[i]);
      if (!isFinite(v)) continue;
      if (v < 0 || v > 1) return false;
      seen += 1;
    }
    return seen > 0;
  } catch (e) { return false; }
}

function avDeckUiBandNorm(v, floor, linear) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  if (linear === true) return avDeckUiClamp01(n);
  return avDeckUiMeterNorm(n, floor, 0);
}

function avDeckUiDbToAmp(db) {
  const n = Number(db);
  if (!isFinite(n)) return 0;
  return Math.pow(10, Math.max(-90, Math.min(12, n)) / 20);
}

/* gain-frame levels: 0..1 = linear amplitude (time-domain), else treat as dB (tolerant) */
function avDeckUiGainNorm(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  if (n >= 0 && n <= 1) return n;
  return avDeckUiClamp01(avDeckUiDbToAmp(n));
}

function avDeckUiGainText(v) {
  const n = Number(v);
  if (v == null || !isFinite(n)) return "\u2014";
  if (n >= 0 && n <= 1) return n.toFixed(3);
  return (n > 0 ? "+" : "") + n.toFixed(1) + " dB";
}

function avDeckUiLufsText(v) {
  const n = Number(v);
  if (v == null || !isFinite(n)) return "\u2014";
  return n.toFixed(1) + " LUFS";
}

function avDeckUiTpText(v) {
  const n = Number(v);
  if (v == null || !isFinite(n)) return "\u2014";
  return (n > 0 ? "+" : "") + n.toFixed(2) + " dBTP";
}

function avDeckUiFmtBpm(v) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return "\u2014";
  return (Math.abs(n - Math.round(n)) < 0.05) ? String(Math.round(n)) : n.toFixed(1);
}

function avDeckUiFmtInt(v) {
  const n = Number(v);
  return isFinite(n) ? String(Math.round(n)) : "\u2014";
}

function avDeckUiLastNoteText(n) {
  try {
    if (n == null) return "\u2014";
    if (typeof n === "string") return n || "\u2014";
    if (typeof n !== "object") return String(n);
    const name = (typeof n.name === "string" && n.name) ? n.name : ((typeof n.note === "string" && n.note) ? n.note : "");
    let out = name || "note";
    if (isFinite(Number(n.vel))) out += " \u00b7 " + Number(n.vel).toFixed(2);
    return out;
  } catch (e) { return "\u2014"; }
}

/* ---------- the view mirror: adopt / commit (the §2.1 ladder) ---------- */

function avDeckUiAdoptView(v) {
  try {
    if (!v || typeof v !== "object") return false;
    const s = avDeckUiState;
    let changed = false;
    const run = avDeckUiPickBool(v, ["run", "running"]);
    if (run !== null && run !== (s.view.run === true)) { s.view.run = run; changed = true; }
    const fz = avDeckUiPickBool(v, ["freeze", "frozen", "hold"]);
    if (fz !== null && fz !== (s.view.freeze === true)) { s.view.freeze = fz; changed = true; }
    const fl = avDeckUiPickNum(v, ["dbFloor", "dbFloorDb", "floorDb"]);
    if (fl !== null) {
      const cf = Math.max(AV_DECK_UI_DB_FLOOR_MIN, Math.min(AV_DECK_UI_DB_FLOOR_MAX, fl));
      if (cf !== s.view.dbFloor) { s.view.dbFloor = cf; changed = true; }
    }
    const wm = avDeckUiPickNum(v, ["waterfallMs", "wfMs", "waterfallRateMs"]);
    if (wm !== null) {
      const cw = Math.max(AV_DECK_UI_WF_MS_MIN, Math.min(AV_DECK_UI_WF_MS_MAX, wm));
      if (cw !== s.view.waterfallMs) { s.view.waterfallMs = cw; changed = true; }
    }
    return changed;
  } catch (e) { return false; }
}

/* adopt from the core's snapshot (window.__avDeck.snapshot); conservative on the root —
   only uniquely-named fields there, full adoption from a nested `view` object */
function avDeckUiAdoptFromSnapshot() {
  try {
    const w = avDeckUiWin();
    if (!w || !w.__avDeck || typeof w.__avDeck.snapshot !== "function") return false;
    const snap = w.__avDeck.snapshot();
    if (!snap || typeof snap !== "object") return false;
    if (snap.view && typeof snap.view === "object") return avDeckUiAdoptView(snap.view);
    const s = avDeckUiState;
    let changed = false;
    const fl = avDeckUiPickNum(snap, ["dbFloor", "dbFloorDb", "floorDb"]);
    if (fl !== null) {
      const cf = Math.max(AV_DECK_UI_DB_FLOOR_MIN, Math.min(AV_DECK_UI_DB_FLOOR_MAX, fl));
      if (cf !== s.view.dbFloor) { s.view.dbFloor = cf; changed = true; }
    }
    const wm = avDeckUiPickNum(snap, ["waterfallMs", "wfMs", "waterfallRateMs"]);
    if (wm !== null) {
      const cw = Math.max(AV_DECK_UI_WF_MS_MIN, Math.min(AV_DECK_UI_WF_MS_MAX, wm));
      if (cw !== s.view.waterfallMs) { s.view.waterfallMs = cw; changed = true; }
    }
    return changed;
  } catch (e) { return false; }
}

/* the tolerant avDeckSetView caller (see the header ladder) */
function avDeckUiDeckSetView(key, value) {
  try {
    if (typeof avDeckSetView !== "function") return { ok: false, view: null, shape: -1 };
    const patch = {};
    patch[key] = value;
    const shapes = [
      ["view", patch],
      [key, patch],
      [key, value],
      [patch, undefined],
    ];
    for (let i = 0; i < shapes.length; i++) {
      let r = null;
      try { r = avDeckSetView(shapes[i][0], shapes[i][1]); } catch (e) { r = null; }
      if (avDeckUiOK(r)) {
        const view = (r && typeof r === "object" && r.view && typeof r.view === "object") ? r.view : null;
        return { ok: true, view: view, shape: i };
      }
    }
    return { ok: false, view: null, shape: -1 };
  } catch (e) { return { ok: false, view: null, shape: -1 }; }
}

/* commit one view field; deck absent (or no SetView) -> degraded local mirror, else honest */
function avDeckUiCommit(key, value) {
  try {
    const s = avDeckUiState;
    if (typeof avDeckSetView !== "function") { s.view[key] = value; return true; }
    const res = avDeckUiDeckSetView(key, value);
    if (!res.ok) return false;
    if (res.view) avDeckUiAdoptView(res.view);
    s.view[key] = value;
    return true;
  } catch (e) { return false; }
}

/* seed the pinned defaults ONCE per mount (idempotent pushes; failures counted, not thrown) */
function avDeckUiSeedView() {
  const s = avDeckUiState;
  if (s.viewSeeded) return true;
  s.viewSeeded = true;
  if (typeof avDeckSetView !== "function") return false;
  const d = AV_DECK_UI_VIEW_DEFAULTS;
  const r1 = avDeckUiCommit("run", d.run);
  const r2 = avDeckUiCommit("freeze", d.freeze);
  const r3 = avDeckUiCommit("dbFloor", d.dbFloor);
  const r4 = avDeckUiCommit("waterfallMs", d.waterfallMs);
  return !!(r1 && r2 && r3 && r4);
}

/* ---------- control setters (every commit via avDeckSetView) ---------- */

function avDeckUiSetView(key, value) {
  if (key === "run") return avDeckUiSetRun(value);
  if (key === "freeze") return avDeckUiSetFreeze(value);
  if (key === "dbFloor") return avDeckUiSetDbFloor(value);
  if (key === "waterfallMs") return avDeckUiSetWfRate(value);
  return false;
}

function avDeckUiSetRun(run) {
  const s = avDeckUiState;
  const want = run === true;
  if (want === (s.view.run === true)) return true;
  const okv = avDeckUiCommit("run", want);
  if (!okv) {
    avDeckUiNote("the deck core refused the RUN change");
    avDeckUiSetStatus("run change refused", "err");
    return false;
  }
  s.view.run = want;
  s.noteText = "";
  avDeckUiPaintControls();
  avDeckUiSetStatus(want ? "running" : "paused");
  if (want) { s.lastStepAt = -1e9; avDeckUiStartLoop(); }
  return true;
}

function avDeckUiToggleRun() { return avDeckUiSetRun(avDeckUiState.view.run !== true); }

function avDeckUiSetFreeze(freeze) {
  const s = avDeckUiState;
  const want = freeze === true;
  if (want === (s.view.freeze === true)) return true;
  const okv = avDeckUiCommit("freeze", want);
  if (!okv) {
    avDeckUiNote("the deck core refused the FREEZE change");
    avDeckUiSetStatus("freeze change refused", "err");
    return false;
  }
  s.view.freeze = want;
  s.noteText = "";
  avDeckUiPaintControls();
  avDeckUiSetStatus(want ? "frozen \u2014 presented frames held" : "live");
  return true;
}

function avDeckUiToggleFreeze() { return avDeckUiSetFreeze(avDeckUiState.view.freeze !== true); }

function avDeckUiSetDbFloor(v) {
  const s = avDeckUiState;
  const n = avDeckUiNum(v, NaN);
  if (!isFinite(n)) return false;
  const floor = Math.max(AV_DECK_UI_DB_FLOOR_MIN, Math.min(AV_DECK_UI_DB_FLOOR_MAX, Math.round(n)));
  const okv = avDeckUiCommit("dbFloor", floor);
  if (!okv) {
    avDeckUiNote("the deck core refused the DB FLOOR change");
    avDeckUiSetStatus("db floor refused", "err");
    return false;
  }
  s.view.dbFloor = floor;
  s.noteText = "";
  avDeckUiPaintControls();
  avDeckUiSetStatus("db floor " + floor + " dB");
  return true;
}

function avDeckUiSetWfRate(v) {
  const s = avDeckUiState;
  const n = avDeckUiNum(v, NaN);
  if (!isFinite(n)) return false;
  const ms = Math.max(AV_DECK_UI_WF_MS_MIN, Math.min(AV_DECK_UI_WF_MS_MAX, Math.round(n)));
  const okv = avDeckUiCommit("waterfallMs", ms);
  if (!okv) {
    avDeckUiNote("the deck core refused the WATERFALL rate change");
    avDeckUiSetStatus("waterfall rate refused", "err");
    return false;
  }
  s.view.waterfallMs = ms;
  s.noteText = "";
  avDeckUiPaintControls();
  avDeckUiSetStatus("waterfall " + ms + " ms");
  return true;
}

/* ---------- markup ---------- */

function avDeckUiFloorOptionsHTML(sel) {
  let out = "";
  for (let i = 0; i < AV_DECK_UI_FLOORS.length; i++) {
    const f = AV_DECK_UI_FLOORS[i];
    out += '<option value="' + f + '"' + (f === sel ? " selected" : "") + ">" + f + " dB</option>";
  }
  return out;
}

function avDeckUiRateOptionsHTML(sel) {
  let out = "";
  for (let i = 0; i < AV_DECK_UI_WF_RATES.length; i++) {
    const r = AV_DECK_UI_WF_RATES[i];
    out += '<option value="' + r + '"' + (r === sel ? " selected" : "") + ">" + r + " ms</option>";
  }
  return out;
}

function avDeckUiBodyHTML() {
  const d = AV_DECK_UI_VIEW_DEFAULTS;
  return '<div class="av-deck" data-av-deck="1">' +
    '<div class="av-deck-head"><span class="av-deck-title">DECK</span>' +
    '<span class="av-deck-cap av-dim">Oscilloscope \u00b7 spectrum \u00b7 spectrogram waterfall \u00b7 LUFS / true-peak meters \u00b7 voice + CPU readout \u00b7 note ticker \u2014 reads the master tap.</span></div>' +
    '<div class="av-deck-status-line"><span class="av-deck-status av-deck-msg" id="av-deck-status" role="status">deck idle</span></div>' +

    '<div class="av-deck-controls">' +
    '<button type="button" class="av-btn mini av-deck-btn" id="av-deck-run" data-deck-act="run" aria-pressed="true" title="RUN/PAUSE \u2014 start or pause the deck step loop">RUN</button>' +
    '<button type="button" class="av-btn mini av-deck-btn" id="av-deck-freeze" data-deck-act="freeze" aria-pressed="false" title="FREEZE \u2014 hold the presented frames (counters keep running)">FREEZE</button>' +
    '<label class="av-deck-ctl" for="av-deck-dbfloor"><span class="av-deck-ctl-lbl">DB FLOOR</span>' +
    '<select class="av-select av-deck-select" id="av-deck-dbfloor" data-deck-view="dbFloor" aria-label="Spectrum display floor in dB">' +
    avDeckUiFloorOptionsHTML(d.dbFloor) + "</select></label>" +
    '<label class="av-deck-ctl" for="av-deck-wfrate"><span class="av-deck-ctl-lbl">WATERFALL</span>' +
    '<select class="av-select av-deck-select" id="av-deck-wfrate" data-deck-view="waterfallMs" aria-label="Waterfall row interval in ms">' +
    avDeckUiRateOptionsHTML(d.waterfallMs) + "</select></label>" +
    "</div>" +

    '<div class="av-deck-panes">' +
    '<div class="av-deck-pane"><span class="av-deck-pane-lbl">SCOPE</span>' +
    '<canvas class="av-deck-canvas av-deck-scope" id="av-deck-scope" width="480" height="140" role="img" aria-label="Oscilloscope \u2014 min/max envelope"></canvas></div>' +
    '<div class="av-deck-pane"><span class="av-deck-pane-lbl">SPECTRUM</span>' +
    '<canvas class="av-deck-canvas av-deck-spectrum" id="av-deck-spectrum" width="480" height="140" role="img" aria-label="Spectrum \u2014 96 log bands, 20 Hz to 20 kHz"></canvas></div>' +
    '<div class="av-deck-pane"><span class="av-deck-pane-lbl">WATERFALL</span>' +
    '<canvas class="av-deck-canvas av-deck-waterfall" id="av-deck-waterfall" width="480" height="140" role="img" aria-label="Spectrogram waterfall \u2014 96 rows of the 96 bands"></canvas></div>' +
    "</div>" +

    '<div class="av-deck-meters">' +
    '<div class="av-deck-meter" data-meter="lufs"><span class="av-deck-meter-lbl">LUFS</span>' +
    '<span class="av-deck-meter-bar"><span class="av-deck-meter-fill" id="av-deck-m-lufs-bar"></span></span>' +
    '<span class="av-deck-meter-val" id="av-deck-m-lufs">\u2014</span></div>' +
    '<div class="av-deck-meter" data-meter="tp"><span class="av-deck-meter-lbl">TRUE PEAK</span>' +
    '<span class="av-deck-meter-bar"><span class="av-deck-meter-fill" id="av-deck-m-tp-bar"></span></span>' +
    '<span class="av-deck-meter-val" id="av-deck-m-tp">\u2014</span></div>' +
    '<div class="av-deck-gain">' +
    '<span class="av-deck-gain-row" data-gain="l"><span class="av-deck-gain-lbl">L</span>' +
    '<span class="av-deck-gain-bar"><span class="av-deck-gain-fill" id="av-deck-g-l-bar"></span></span>' +
    '<span class="av-deck-gain-val" id="av-deck-g-l">\u2014</span></span>' +
    '<span class="av-deck-gain-row" data-gain="r"><span class="av-deck-gain-lbl">R</span>' +
    '<span class="av-deck-gain-bar"><span class="av-deck-gain-fill" id="av-deck-g-r-bar"></span></span>' +
    '<span class="av-deck-gain-val" id="av-deck-g-r">\u2014</span></span>' +
    '<span class="av-deck-gain-row" data-gain="pk"><span class="av-deck-gain-lbl">PK</span>' +
    '<span class="av-deck-gain-bar"><span class="av-deck-gain-fill" id="av-deck-g-pk-bar"></span></span>' +
    '<span class="av-deck-gain-val" id="av-deck-g-pk">\u2014</span></span>' +
    "</div></div>" +

    '<div class="av-deck-readouts">' +
    '<span class="av-deck-rd"><span class="av-deck-rd-lbl">BPM</span><span class="av-deck-rd-val" id="av-deck-rd-bpm">\u2014</span></span>' +
    '<span class="av-deck-rd"><span class="av-deck-rd-lbl">VOICES</span><span class="av-deck-rd-val" id="av-deck-rd-voices">\u2014/\u2014</span></span>' +
    '<span class="av-deck-rd"><span class="av-deck-rd-lbl">TIER</span><span class="av-deck-rd-val" id="av-deck-rd-tier">\u2014</span></span>' +
    '<span class="av-deck-rd"><span class="av-deck-rd-lbl">CTX</span><span class="av-deck-rd-val" id="av-deck-rd-ctx">\u2014</span></span>' +
    '<span class="av-deck-rd"><span class="av-deck-rd-lbl">CPU</span><span class="av-deck-rd-val" id="av-deck-rd-cpu">\u2014</span></span>' +
    '<span class="av-deck-rd"><span class="av-deck-rd-lbl">NOTES</span><span class="av-deck-rd-val" id="av-deck-rd-notes">\u2014</span></span>' +
    '<span class="av-deck-rd"><span class="av-deck-rd-lbl">LAST NOTE</span><span class="av-deck-rd-val" id="av-deck-rd-last">\u2014</span></span>' +
    "</div>" +

    '<p class="av-deck-note av-dim" id="av-deck-note" hidden></p>' +
    '<p class="av-deck-foot av-dim">Panel reads are UI witnesses only \u2014 the verification rig owns its own AnalyserNode on the master tap. Offline renders are never attached to the deck. Pure math (band map \u00b7 meter norm) lives in av_deck.js and is consumed through typeof guards.</p>' +
    "</div>";
}

/* ---------- write-on-change DOM painting ---------- */

function avDeckUiWriteText(host, sel, txt, key) {
  try {
    const s = avDeckUiState;
    if (s.lastText[key] === txt) return false;
    s.lastText[key] = txt;
    const el = (host && typeof host.querySelector === "function") ? host.querySelector(sel) : null;
    if (el && el.textContent !== txt) el.textContent = txt;
    return true;
  } catch (e) { return false; }
}

function avDeckUiBar(host, sel, norm, key) {
  try {
    const pct = (avDeckUiClamp01(avDeckUiNum(norm, 0)) * 100).toFixed(1) + "%";
    const s = avDeckUiState;
    if (s.lastPct[key] === pct) return false;
    s.lastPct[key] = pct;
    const el = (host && typeof host.querySelector === "function") ? host.querySelector(sel) : null;
    if (el && el.style) el.style.width = pct;
    return true;
  } catch (e) { return false; }
}

function avDeckUiClass(host, sel, cls, on, key) {
  try {
    const s = avDeckUiState;
    const memoKey = key + "|" + cls;
    const want = !!on;
    if (s.lastClass[memoKey] === want) return false;
    s.lastClass[memoKey] = want;
    const el = (host && typeof host.querySelector === "function") ? host.querySelector(sel) : null;
    if (el && el.classList && typeof el.classList.add === "function") {
      if (want) el.classList.add(cls); else el.classList.remove(cls);
    }
    return true;
  } catch (e) { return false; }
}

function avDeckUiSetStatus(msg, kind) {
  try {
    const s = avDeckUiState;
    s.statusMsg = String(msg == null ? "" : msg);
    s.statusKind = (kind === "err") ? "err" : "msg";
    const host = avDeckUiHost();
    if (!host) return false;
    avDeckUiWriteText(host, "#av-deck-status", s.statusMsg, "status");
    avDeckUiClass(host, "#av-deck-status", "av-deck-err", s.statusKind === "err", "status-err");
    return true;
  } catch (e) { return false; }
}

/* an explicit note (refusal copy) — wins over the derived degraded text until cleared */
function avDeckUiNote(txt) {
  const s = avDeckUiState;
  s.noteText = String(txt == null ? "" : txt);
  return avDeckUiPaintNote();
}

function avDeckUiPaintNote() {
  const host = avDeckUiHost();
  if (!host) return false;
  try {
    const s = avDeckUiState;
    let txt = "";
    if (!s.deckPresent) {
      txt = "deck core (av_deck.js) not present \u2014 canvases idle, readouts dashed. The card fills in when the core loads (the parent boots avDeckInit + avDeckUiInit together).";
    } else if (s.attached !== true) {
      txt = "waiting for the live engine context \u2014 the deck attaches to the master tap (it never creates an AudioContext) and keeps retrying while RUN.";
    }
    if (s.noteText) txt = s.noteText;
    avDeckUiWriteText(host, "#av-deck-note", txt, "note");
    const el = (typeof host.querySelector === "function") ? host.querySelector("#av-deck-note") : null;
    if (el && el.hidden !== !txt) el.hidden = !txt;
    return true;
  } catch (e) { return false; }
}

function avDeckUiPaintControls() {
  const host = avDeckUiHost();
  if (!host) return false;
  try {
    const s = avDeckUiState;
    const run = s.view.run === true;
    const fz = s.view.freeze === true;
    const runEl = (typeof host.querySelector === "function") ? host.querySelector("#av-deck-run") : null;
    if (runEl && typeof runEl.setAttribute === "function") {
      const ap = run ? "true" : "false";
      if (!runEl.getAttribute || runEl.getAttribute("aria-pressed") !== ap) runEl.setAttribute("aria-pressed", ap);
    }
    avDeckUiClass(host, "#av-deck-run", "av-deck-on", run, "run-on");
    const fzEl = (typeof host.querySelector === "function") ? host.querySelector("#av-deck-freeze") : null;
    if (fzEl && typeof fzEl.setAttribute === "function") {
      const ap = fz ? "true" : "false";
      if (!fzEl.getAttribute || fzEl.getAttribute("aria-pressed") !== ap) fzEl.setAttribute("aria-pressed", ap);
    }
    avDeckUiClass(host, "#av-deck-freeze", "av-deck-on", fz, "freeze-on");
    const dbSel = (typeof host.querySelector === "function") ? host.querySelector("#av-deck-dbfloor") : null;
    if (dbSel) {
      const v = String(s.view.dbFloor);
      if (String(dbSel.value) !== v) dbSel.value = v;
    }
    const wfSel = (typeof host.querySelector === "function") ? host.querySelector("#av-deck-wfrate") : null;
    if (wfSel) {
      const v = String(s.view.waterfallMs);
      if (String(wfSel.value) !== v) wfSel.value = v;
    }
    const card = (typeof host.querySelector === "function") ? host.querySelector(".av-deck") : null;
    if (card && card.dataset) {
      const rv = run ? "1" : "0", fv = fz ? "1" : "0";
      if (card.dataset.avDeckRun !== rv) card.dataset.avDeckRun = rv;
      if (card.dataset.avDeckFreeze !== fv) card.dataset.avDeckFreeze = fv;
    }
    return true;
  } catch (e) { return false; }
}

function avDeckUiPaintReadouts() {
  const host = avDeckUiHost();
  if (!host) return false;
  try {
    const s = avDeckUiState;
    const r = avDeckUiReadouts();
    s.readouts = r;
    avDeckUiWriteText(host, "#av-deck-rd-bpm", r ? avDeckUiFmtBpm(r.bpm) : "\u2014", "rd-bpm");
    avDeckUiWriteText(host, "#av-deck-rd-voices",
      r ? (avDeckUiFmtInt(r.voices) + "/" + avDeckUiFmtInt(r.maxVoices)) : "\u2014/\u2014", "rd-voices");
    avDeckUiWriteText(host, "#av-deck-rd-tier", (r && typeof r.tier === "string" && r.tier) ? r.tier : "\u2014", "rd-tier");
    avDeckUiWriteText(host, "#av-deck-rd-ctx", (r && typeof r.ctxState === "string" && r.ctxState) ? r.ctxState : "\u2014", "rd-ctx");
    avDeckUiWriteText(host, "#av-deck-rd-cpu",
      (r && isFinite(Number(r.cpuMs))) ? Number(r.cpuMs).toFixed(1) + " ms" : "\u2014", "rd-cpu");
    avDeckUiWriteText(host, "#av-deck-rd-notes",
      (r && isFinite(Number(r.notesSeen))) ? String(Math.round(Number(r.notesSeen))) : "\u2014", "rd-notes");
    avDeckUiWriteText(host, "#av-deck-rd-last", avDeckUiLastNoteText(r ? r.lastNote : null), "rd-last");
    const idle = !(s.deckPresent && s.attached === true);
    avDeckUiClass(host, ".av-deck-panes", "av-deck-idle", idle, "panes-idle");
    return true;
  } catch (e) { return false; }
}

function avDeckUiPaintMeters() {
  const host = avDeckUiHost();
  if (!host) return false;
  try {
    const s = avDeckUiState;
    const mf = avDeckUiFrame("meters");
    const gf = avDeckUiFrame("gain");
    const lufs = (mf && isFinite(Number(mf.lufsShort))) ? Number(mf.lufsShort) : null;
    const tp = (mf && isFinite(Number(mf.dbtp))) ? Number(mf.dbtp) : null;
    s.meters = { lufs: lufs, tp: tp };
    avDeckUiBar(host, "#av-deck-m-lufs-bar", lufs === null ? 0 : avDeckUiMeterNorm(lufs, -60, 0), "m-lufs");
    avDeckUiWriteText(host, "#av-deck-m-lufs", avDeckUiLufsText(lufs), "m-lufs-txt");
    avDeckUiBar(host, "#av-deck-m-tp-bar", tp === null ? 0 : avDeckUiMeterNorm(tp, -30, 0), "m-tp");
    avDeckUiWriteText(host, "#av-deck-m-tp", avDeckUiTpText(tp), "m-tp-txt");
    avDeckUiClass(host, "#av-deck-m-tp-bar", "av-deck-over", tp !== null && tp >= 0, "m-tp-over");
    const gl = (gf && isFinite(Number(gf.l))) ? Number(gf.l) : null;
    const gr = (gf && isFinite(Number(gf.r))) ? Number(gf.r) : null;
    const gp = (gf && isFinite(Number(gf.peak))) ? Number(gf.peak) : null;
    avDeckUiBar(host, "#av-deck-g-l-bar", avDeckUiGainNorm(gl), "g-l");
    avDeckUiWriteText(host, "#av-deck-g-l", avDeckUiGainText(gl), "g-l-txt");
    avDeckUiBar(host, "#av-deck-g-r-bar", avDeckUiGainNorm(gr), "g-r");
    avDeckUiWriteText(host, "#av-deck-g-r", avDeckUiGainText(gr), "g-r-txt");
    avDeckUiBar(host, "#av-deck-g-pk-bar", avDeckUiGainNorm(gp), "g-pk");
    avDeckUiWriteText(host, "#av-deck-g-pk", avDeckUiGainText(gp), "g-pk-txt");
    return true;
  } catch (e) { return false; }
}

/* ---------- canvas fit (the av_sample HiDPI law) ---------- */

function avDeckUiFitCanvas(canvas) {
  try {
    if (!canvas || typeof canvas.getContext !== "function") return null;
    const w = avDeckUiWin();
    const dprRaw = (w && isFinite(w.devicePixelRatio)) ? Number(w.devicePixelRatio) : 1;
    const dpr = Math.max(1, Math.min(4, avDeckUiNum(dprRaw, 1)));
    const cw = Number(canvas.clientWidth) || 0, ch = Number(canvas.clientHeight) || 0;
    let cssW = 0, cssH = 0;
    if (cw > 0 && ch > 0) { cssW = Math.round(cw); cssH = Math.round(ch); }
    else if (canvas.isConnected === false) {
      cssW = Math.max(1, Math.round(Number(canvas.width) || 480));
      cssH = Math.max(1, Math.round(Number(canvas.height) || 140));
    } else {
      return null;                       /* hidden in a live document: leave the surface alone */
    }
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    const g = canvas.getContext("2d");
    if (!g) return null;
    if (typeof g.setTransform === "function") g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g: g, cssW: cssW, cssH: cssH, dpr: dpr };
  } catch (e) { return null; }
}

/* ---------- the four draws ---------- */

function avDeckUiDrawScope() {
  try {
    const host = avDeckUiHost();
    if (!host) return false;
    const canvas = (typeof host.querySelector === "function") ? host.querySelector("#av-deck-scope") : null;
    const fit = avDeckUiFitCanvas(canvas);
    if (!fit) return false;
    const g = fit.g, W = fit.cssW, H = fit.cssH;
    g.clearRect(0, 0, W, H);
    const mid = H / 2;
    g.fillStyle = "rgba(34,48,58,0.55)";              /* hairline quarter grid */
    g.fillRect(Math.round(W * 0.25), 0, 1, H);
    g.fillRect(Math.round(W * 0.5), 0, 1, H);
    g.fillRect(Math.round(W * 0.75), 0, 1, H);
    g.fillStyle = "rgba(46,216,201,0.16)";            /* the quiet zero line */
    g.fillRect(0, mid - 0.5, W, 1);
    const s = avDeckUiState;
    const f = avDeckUiFrame("scope");
    s.scopeReady = !!(f && f.ready === true);
    if (!f || f.ready !== true) return true;
    const n = avDeckUiInt(f.n, 1, 1e9, 0);
    const mn = f.min, mx = f.max;
    if (!n || !mn || !mx || typeof mn.length !== "number" || typeof mx.length !== "number" || mn.length < n || mx.length < n) return true;
    const amp = mid * 0.92;                           /* 8% headroom (the av_sample law) */
    g.fillStyle = "rgba(46,216,201,0.9)";
    for (let x = 0; x < W; x++) {
      const i0 = Math.floor((x * n) / W);
      const i1 = Math.max(i0 + 1, Math.floor(((x + 1) * n) / W));
      const end = Math.min(i1, n);
      let lo = Infinity, hi = -Infinity;
      for (let i = i0; i < end; i++) {
        const a = mn[i], b = mx[i];
        if (a < lo) lo = a;
        if (b > hi) hi = b;
      }
      if (lo === Infinity) { lo = 0; hi = 0; }
      let y0 = mid - hi * amp, y1 = mid - lo * amp;
      if (!isFinite(y0)) y0 = mid;
      if (!isFinite(y1)) y1 = mid;
      if (y1 < y0) { const t = y0; y0 = y1; y1 = t; }
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
    return true;
  } catch (e) { return false; }
}

function avDeckUiDrawSpectrum() {
  try {
    const host = avDeckUiHost();
    if (!host) return false;
    const canvas = (typeof host.querySelector === "function") ? host.querySelector("#av-deck-spectrum") : null;
    const fit = avDeckUiFitCanvas(canvas);
    if (!fit) return false;
    const g = fit.g, W = fit.cssW, H = fit.cssH;
    g.clearRect(0, 0, W, H);
    g.fillStyle = "rgba(34,48,58,0.55)";
    g.fillRect(Math.round(W * 0.25), 0, 1, H);
    g.fillRect(Math.round(W * 0.5), 0, 1, H);
    g.fillRect(Math.round(W * 0.75), 0, 1, H);
    g.fillStyle = "rgba(46,216,201,0.16)";
    g.fillRect(0, H - 1, W, 1);
    const s = avDeckUiState;
    const f = avDeckUiFrame("spectrum");
    s.spectrumReady = !!(f && f.ready === true);
    if (!f || f.ready !== true) return true;
    const bands = f.bands;
    const count = (bands && typeof bands.length === "number") ? Math.min(AV_DECK_UI_BANDS, Math.floor(bands.length)) : 0;
    if (count <= 0) return true;
    const floor = s.view.dbFloor;
    const linear = avDeckUiBandsAreNorm(bands, count);
    s.spectrumLinear = linear;
    const bw = W / count;
    const plotH = Math.max(1, H - 3);
    g.fillStyle = "rgba(46,216,201,0.5)";             /* bars */
    for (let b = 0; b < count; b++) {
      const nrm = avDeckUiBandNorm(bands[b], floor, linear);
      const h = nrm * plotH;
      if (h < 0.5) continue;
      g.fillRect(b * bw, H - 1 - h, Math.max(1, bw - 1), h);
    }
    g.strokeStyle = "rgba(127,243,232,0.85)";         /* the cap line over the tops */
    g.lineWidth = 1;
    g.beginPath();
    let started = false;
    for (let b = 0; b < count; b++) {
      const nrm = avDeckUiBandNorm(bands[b], floor, linear);
      const x = b * bw + bw / 2;
      const y = H - 1 - nrm * plotH;
      if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
    }
    if (started && typeof g.stroke === "function") g.stroke();
    return true;
  } catch (e) { return false; }
}

/* ---------- waterfall helpers ---------- */

function avDeckUiRowLike(v) {
  try { return !!(v && typeof v.length === "number" && v.length >= 8); } catch (e) { return false; }
}

/* cheap content signature of a row (sum + finite count) — change detector, no alloc */
function avDeckUiRowSig(row) {
  let sum = 0, cnt = 0;
  try {
    const n = Math.min(AV_DECK_UI_BANDS, Math.max(0, Math.floor(Number(row.length) || 0)));
    for (let i = 0; i < n; i++) {
      const v = Number(row[i]);
      if (isFinite(v)) { sum += v; cnt += 1; }
    }
    return sum + cnt * 1e-3;
  } catch (e) { return -1; }
}

function avDeckUiWfEnsureRing() {
  const s = avDeckUiState;
  try {
    if (s.wfRing) return true;
    const n = AV_DECK_UI_WF_ROWS * AV_DECK_UI_BANDS;
    s.wfRing = (typeof Float32Array === "function") ? new Float32Array(n) : new Array(n);
    for (let i = 0; i < n; i++) s.wfRing[i] = NaN;
    return true;
  } catch (e) { return false; }
}

/* push one newest row into the UI-side ring (push-mode frames; ring-mode frames paint
   straight from the core's own ring and never touch this) */
function avDeckUiWfPush(f, row) {
  const s = avDeckUiState;
  if (!avDeckUiWfEnsureRing()) return false;
  const sig = avDeckUiRowSig(row);
  const cnt = avDeckUiNumField(f, ["count", "seq", "pushed", "rowsPushed", "total", "rowsPushedCount"]);
  let countMoved = false;
  if (cnt !== null && cnt !== s.wfLastCount) { s.wfLastCount = cnt; countMoved = true; }
  if (!countMoved && sig === s.wfLastSig && s.wfCount > 0) return false;
  s.wfLastSig = sig;
  const ring = s.wfRing;
  const base = s.wfHead * AV_DECK_UI_BANDS;
  const len = Math.min(AV_DECK_UI_BANDS, Math.max(0, Math.floor(Number(row.length) || 0)));
  for (let b = 0; b < AV_DECK_UI_BANDS; b++) {
    const v = (b < len) ? Number(row[b]) : NaN;
    ring[base + b] = isFinite(v) ? v : NaN;
  }
  s.wfHead = (s.wfHead + 1) % AV_DECK_UI_WF_ROWS;
  if (s.wfCount < AV_DECK_UI_WF_ROWS) s.wfCount += 1;
  s.wfDirty = true;
  return true;
}

/* resolve the waterfall frame into a paint plan; returns true when the paint content changed.
   Tolerant to the plausible §2.1 shapes: rows = ring of rows (with an optional numeric
   latestRow write index), rows = a single row, or latestRow = the newest row (push mode). */
function avDeckUiWfResolve() {
  const s = avDeckUiState;
  const f = avDeckUiFrame("waterfall");
  s.wfReady = !!(f && f.ready === true);
  s.wfMode = "none";
  s.wfSrc = null;
  s.wfSrcN = 0;
  s.wfNewest = -1;
  if (!s.wfReady) return false;
  const rows = f.rows;
  const latest = f.latestRow;
  if (rows && typeof rows.length === "number" && rows.length > 0 && avDeckUiRowLike(rows[0])) {
    s.wfMode = "ring";
    s.wfSrc = rows;
    s.wfSrcN = Math.min(AV_DECK_UI_WF_ROWS, Math.floor(rows.length));
    const idx = avDeckUiNum(latest, NaN);
    s.wfNewest = (isFinite(idx) && idx >= 0 && idx < s.wfSrcN) ? Math.floor(idx) : s.wfSrcN - 1;
    const sig = avDeckUiRowSig(rows[s.wfNewest]) + s.wfSrcN * 1e6;
    if (sig !== s.wfLastSig) { s.wfLastSig = sig; s.wfDirty = true; return true; }
    return false;
  }
  if (avDeckUiRowLike(latest)) { s.wfMode = "push"; return avDeckUiWfPush(f, latest); }
  if (avDeckUiRowLike(rows)) { s.wfMode = "push"; return avDeckUiWfPush(f, rows); }
  return false;
}

/* display row k (0 = newest, drawn at the top) -> source row index | -1 */
function avDeckUiWfDisplayIndex(k, rowsN) {
  const s = avDeckUiState;
  try {
    if (k < 0 || k >= rowsN) return -1;
    if (s.wfMode === "ring") {
      const n = s.wfSrcN;
      if (n <= 0) return -1;
      return ((s.wfNewest - k) % n + n) % n;
    }
    if (s.wfMode === "push") {
      if (s.wfCount <= 0) return -1;
      return ((s.wfHead - 1 - k) % AV_DECK_UI_WF_ROWS + AV_DECK_UI_WF_ROWS) % AV_DECK_UI_WF_ROWS;
    }
    return -1;
  } catch (e) { return -1; }
}

function avDeckUiWfCellValue(srcIdx, b) {
  const s = avDeckUiState;
  try {
    if (s.wfMode === "ring") {
      const row = s.wfSrc ? s.wfSrc[srcIdx] : null;
      if (!row || b >= row.length) return NaN;
      return Number(row[b]);
    }
    const ring = s.wfRing;
    if (!ring) return NaN;
    const i = srcIdx * AV_DECK_UI_BANDS + b;
    return (i >= 0 && i < ring.length) ? ring[i] : NaN;
  } catch (e) { return NaN; }
}

function avDeckUiWfEnsureOff() {
  const s = avDeckUiState;
  if (s.wfOff && s.wfOctx && s.wfImg) return true;
  try {
    const d = avDeckUiDoc();
    if (!d || typeof d.createElement !== "function") return false;
    const off = d.createElement("canvas");
    if (!off || typeof off.getContext !== "function") return false;
    off.width = AV_DECK_UI_BANDS;
    off.height = AV_DECK_UI_WF_ROWS;
    const octx = off.getContext("2d");
    if (!octx || typeof octx.createImageData !== "function" || typeof octx.putImageData !== "function") return false;
    const img = octx.createImageData(AV_DECK_UI_BANDS, AV_DECK_UI_WF_ROWS);
    if (!img || !img.data || img.data.length < AV_DECK_UI_BANDS * AV_DECK_UI_WF_ROWS * 4) return false;
    s.wfOff = off;
    s.wfOctx = octx;
    s.wfImg = img;
    return true;
  } catch (e) { return false; }
}

/* paint the ring: one reusable ImageData (teal palette) blitted and scaled to the pane */
function avDeckUiWfPaint(fit, rowsN, floor, linear) {
  const s = avDeckUiState;
  const g = fit.g, W = fit.cssW, H = fit.cssH;
  if (avDeckUiWfEnsureOff()) {
    try {
      const data = s.wfImg.data;
      for (let k = 0; k < AV_DECK_UI_WF_ROWS; k++) {
        const srcIdx = avDeckUiWfDisplayIndex(k, rowsN);
        const rowBase = k * AV_DECK_UI_BANDS;
        for (let b = 0; b < AV_DECK_UI_BANDS; b++) {
          const o = (rowBase + b) * 4;
          const nrm = (srcIdx >= 0) ? avDeckUiBandNorm(avDeckUiWfCellValue(srcIdx, b), floor, linear) : 0;
          if (nrm <= 0.02) {
            data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 0;
          } else {
            data[o] = Math.round(15 + 112 * nrm);
            data[o + 1] = Math.round(143 + 100 * nrm);
            data[o + 2] = Math.round(133 + 99 * nrm);
            data[o + 3] = Math.round(255 * Math.min(1, 0.10 + nrm * 0.90));
          }
        }
      }
      s.wfOctx.putImageData(s.wfImg, 0, 0);
      if (typeof g.drawImage === "function") {
        try { g.imageSmoothingEnabled = true; } catch (e) { /* nicety */ }
        g.drawImage(s.wfOff, 0, 0, AV_DECK_UI_BANDS, AV_DECK_UI_WF_ROWS, 0, 0, W, H);
        return true;
      }
    } catch (e) { /* fall through to the rect path */ }
  }
  return avDeckUiWfPaintRects(fit, rowsN, floor, linear, g, W, H);
}

/* honest fallback when the offscreen/ImageData path is unavailable (hostile hosts) */
function avDeckUiWfPaintRects(fit, rowsN, floor, linear, g, W, H) {
  try {
    const rh = H / AV_DECK_UI_WF_ROWS;
    const bw = W / AV_DECK_UI_BANDS;
    for (let k = 0; k < rowsN; k++) {
      const srcIdx = avDeckUiWfDisplayIndex(k, rowsN);
      if (srcIdx < 0) continue;
      const y = k * rh;
      for (let b = 0; b < AV_DECK_UI_BANDS; b++) {
        const nrm = avDeckUiBandNorm(avDeckUiWfCellValue(srcIdx, b), floor, linear);
        if (nrm <= 0.02) continue;
        const a = Math.round(255 * Math.min(1, 0.10 + nrm * 0.90)) / 255;
        g.fillStyle = "rgba(" + Math.round(15 + 112 * nrm) + "," + Math.round(143 + 100 * nrm) + "," + Math.round(133 + 99 * nrm) + "," + a.toFixed(3) + ")";
        g.fillRect(b * bw, y, Math.max(1, bw - 0.5), Math.max(1, rh));
      }
    }
    return true;
  } catch (e) { return false; }
}

function avDeckUiDrawWaterfall(force) {
  try {
    const host = avDeckUiHost();
    if (!host) return false;
    const canvas = (typeof host.querySelector === "function") ? host.querySelector("#av-deck-waterfall") : null;
    const fit = avDeckUiFitCanvas(canvas);
    if (!fit) return false;
    const s = avDeckUiState;
    if (s.wfW !== fit.cssW || s.wfH !== fit.cssH) { s.wfDirty = true; s.wfW = fit.cssW; s.wfH = fit.cssH; }
    const changed = avDeckUiWfResolve();
    if (!force && !s.wfDirty && !changed) return true;      /* nothing new — skip the repaint */
    s.wfDirty = false;
    const g = fit.g, W = fit.cssW, H = fit.cssH;
    g.fillStyle = "rgba(10,14,17,1)";                        /* the heat panel is opaque dark */
    g.fillRect(0, 0, W, H);
    if (!s.wfReady) return true;
    const rowsN = (s.wfMode === "ring") ? s.wfSrcN : s.wfCount;
    if (rowsN <= 0) return true;
    return avDeckUiWfPaint(fit, rowsN, s.view.dbFloor, s.spectrumLinear === true);
  } catch (e) { return false; }
}

function avDeckUiDrawAll(force) {
  const a = avDeckUiDrawScope();
  const b = avDeckUiDrawSpectrum();
  const c = avDeckUiDrawWaterfall(force === true);
  return !!(a || b || c);
}

/* ---------- the one work path (rAF + the rig's forced driver share it) ---------- */

function avDeckUiTryAttach(nowOpt) {
  const s = avDeckUiState;
  try {
    if (typeof avDeckAttach !== "function") return false;
    if (s.attached === true) return false;
    const t = avDeckUiNum(nowOpt, NaN);
    const now = isFinite(t) ? t : avDeckUiNow();
    if (s.lastAttachTry > 0 && (now - s.lastAttachTry) < AV_DECK_UI_ATTACH_MS) return false;
    s.lastAttachTry = now;
    const r = avDeckAttach();
    if (r && typeof r === "object" && r.ok === true) {
      s.attached = true;
      avDeckUiSetStatus("attached \u00b7 master tap");
      return true;
    }
  } catch (e) { /* honest refusal — the cadence keeps retrying */ }
  return false;
}

function avDeckUiStepWork(force) {
  const s = avDeckUiState;
  const t = avDeckUiNow();
  avDeckUiTryAttach(t);
  let stepR = null;
  if (typeof avDeckStep === "function") {
    try { stepR = avDeckStep(); } catch (e) { stepR = null; }
  }
  s.steps += 1;
  if (stepR && typeof stepR === "object") {
    const wasAttached = s.attached;
    if (typeof stepR.attached === "boolean") s.attached = stepR.attached;
    if (s.attached !== wasAttached) {
      avDeckUiSetStatus(s.attached ? "attached \u00b7 master tap" : "detached \u2014 waiting for a live context");
    }
    const fr = Number(stepR.frames);
    if (isFinite(fr) && fr >= 0) s.frames = fr;
  }
  const frozen = s.view.freeze === true;
  if (force || !frozen) {
    s.draws += 1;
    avDeckUiDrawAll(force === true);
  }
  avDeckUiPaintMeters();
  avDeckUiPaintReadouts();
  if (t - s.lastAdoptAt > AV_DECK_UI_ADOPT_MS) {
    s.lastAdoptAt = t;
    if (avDeckUiDeckPresent() && avDeckUiAdoptFromSnapshot()) avDeckUiPaintControls();
  }
  return { step: stepR, attached: s.attached === true };
}

/* the rig's deterministic driver: ONE avDeckStep() + one FULL draw — no rAF needed */
function avDeckUiStep() {
  const s = avDeckUiState;
  try {
    s.forcedSteps += 1;
    avDeckUiWfEnsureRing();
    const r = avDeckUiStepWork(true);
    return {
      ok: true,
      stepped: !!(r && r.step),
      attached: s.attached === true,
      frames: s.frames,
      draws: s.draws,
      forcedSteps: s.forcedSteps,
      at: avDeckUiNow(),
    };
  } catch (e) {
    return { ok: false, stepped: false, attached: s.attached === true, frames: s.frames, draws: s.draws, error: "deck ui step failed" };
  }
}

/* ---------- the rAF loop (visibility-gated, ~30 fps, cheap idle early-exit) ---------- */

function avDeckUiShouldRun() {
  const s = avDeckUiState;
  if (!s.inited) return false;
  if (s.view.run !== true) return false;          /* paused */
  if (s.docHidden === true) return false;
  if (s.visible !== true) return false;           /* off-screen (IntersectionObserver) */
  if (!avDeckUiDeckPresent()) return false;       /* no core: nothing to step, stay idle */
  return true;
}

function avDeckUiStartLoop() {
  const s = avDeckUiState;
  if (!avDeckUiShouldRun()) return false;
  if (s.rafOn) return true;
  if (typeof requestAnimationFrame !== "function") return false;
  s.rafOn = true;
  try { requestAnimationFrame(avDeckUiTick); } catch (e) { s.rafOn = false; return false; }
  return true;
}

function avDeckUiTick(now) {
  const s = avDeckUiState;
  if (!avDeckUiShouldRun()) { s.rafOn = false; return; }   /* the cheap early-exit: no step, no draw */
  const t = avDeckUiNum(now, NaN);
  const at = isFinite(t) ? t : avDeckUiNow();
  if (at - s.lastStepAt >= AV_DECK_UI_STEP_MS) {
    s.lastStepAt = at;
    s.ticks += 1;
    try { avDeckUiStepWork(false); } catch (e) { /* never break the frame */ }
  }
  if (!avDeckUiShouldRun()) { s.rafOn = false; return; }
  try { requestAnimationFrame(avDeckUiTick); } catch (e) { s.rafOn = false; }
}

/* ---------- visibility plumbing ---------- */

function avDeckUiObserve(host) {
  const s = avDeckUiState;
  try {
    if (typeof IntersectionObserver !== "function") { s.visible = true; return false; }
    if (s.io && typeof s.io.disconnect === "function") { try { s.io.disconnect(); } catch (e) { /* ok */ } }
    s.io = new IntersectionObserver(function (entries) {
      try {
        const e0 = entries && entries[0];
        if (e0 && typeof e0.isIntersecting === "boolean") s.visible = e0.isIntersecting;
        if (s.visible === true) avDeckUiStartLoop();
      } catch (err) { /* observer callbacks never throw outward */ }
    });
    if (host && typeof s.io.observe === "function") s.io.observe(host);
    return true;
  } catch (e) { s.io = null; s.visible = true; return false; }
}

function avDeckUiBindDoc() {
  const s = avDeckUiState;
  try {
    const d = avDeckUiDoc();
    if (!d || typeof d.addEventListener !== "function") return false;
    s.docHidden = d.hidden === true;
    if (s.docBound) return true;
    d.addEventListener("visibilitychange", avDeckUiOnVis);
    s.docBound = true;
    return true;
  } catch (e) { return false; }
}

function avDeckUiOnVis() {
  try {
    const s = avDeckUiState;
    const d = avDeckUiDoc();
    s.docHidden = !!(d && d.hidden === true);
    if (s.docHidden !== true) avDeckUiStartLoop();
  } catch (e) { /* visibility callbacks never throw outward */ }
}

/* ---------- event delegation (one click + one change per host) ---------- */

function avDeckUiClick(ev) {
  try {
    const t = ev && ev.target;
    if (!t || typeof t.closest !== "function") return;
    const btn = t.closest("[data-deck-act]");
    if (!btn) return;
    const act = String((btn.getAttribute && btn.getAttribute("data-deck-act")) || "");
    if (act === "run") avDeckUiToggleRun();
    else if (act === "freeze") avDeckUiToggleFreeze();
  } catch (err) { /* a listener never throws outward */ }
}

function avDeckUiChange(ev) {
  try {
    const t = ev && ev.target;
    if (!t || typeof t.closest !== "function") return;
    const sel = t.closest("select[data-deck-view]");
    if (!sel) return;
    const key = String((sel.getAttribute && sel.getAttribute("data-deck-view")) || "");
    const value = Number(sel.value);
    if (key === "dbFloor") avDeckUiSetDbFloor(value);
    else if (key === "waterfallMs") avDeckUiSetWfRate(value);
  } catch (err) { /* a listener never throws outward */ }
}

function avDeckUiWire(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  try {
    if (host.dataset && host.dataset.avDeckUiWired === "1") return true;   /* one delegation per host element */
    if (host.dataset) host.dataset.avDeckUiWired = "1";
    host.addEventListener("click", avDeckUiClick);
    host.addEventListener("change", avDeckUiChange);
    return true;
  } catch (e) { return false; }
}

/* ---------- init (mount, idempotent, re-mountable) ---------- */

function avDeckUiInit() {
  const host = avDeckUiHost();
  if (!host) return false;
  try {
    const s = avDeckUiState;
    let card = null;
    try { card = (typeof host.querySelector === "function") ? host.querySelector(".av-deck") : null; } catch (e) { card = null; }
    if (!card) {
      host.innerHTML = avDeckUiBodyHTML();
      s.lastText = {};
      s.lastPct = {};
      s.lastClass = {};
      s.wfDirty = true;
    }
    avDeckUiWire(host);
    s.inited = true;
    s.mounts += 1;
    s.deckPresent = avDeckUiDeckPresent();
    avDeckUiBindDoc();
    avDeckUiObserve(host);
    if (s.deckPresent) {
      avDeckUiSeedView();
      avDeckUiTryAttach();
    }
    avDeckUiSync();
    avDeckUiStartLoop();
    return true;
  } catch (e) { return false; }
}

/* ---------- sync (repaint) ---------- */

function avDeckUiSync() {
  const host = avDeckUiHost();
  if (!host) return false;
  try {
    const s = avDeckUiState;
    s.deckPresent = avDeckUiDeckPresent();
    if (s.deckPresent && avDeckUiAdoptFromSnapshot()) avDeckUiPaintControls();
    avDeckUiPaintControls();
    avDeckUiPaintReadouts();
    avDeckUiPaintMeters();
    avDeckUiPaintNote();
    if (s.deckPresent && s.view.run === true) avDeckUiStartLoop();
    return true;
  } catch (e) { return false; }
}

/* ---------- observables ---------- */

function avDeckUiSnap() {
  const host = avDeckUiHost();
  const s = avDeckUiState;
  const out = {
    version: AV_DECK_UI_VERSION,
    inited: !!s.inited,
    mounts: s.mounts,
    host: !!host,
    wired: !!(host && host.dataset && host.dataset.avDeckUiWired === "1"),
    card: false,
    canvases: { scope: false, spectrum: false, waterfall: false },
    deck: {
      present: avDeckUiDeckPresent(),
      attached: s.attached === true,
      steps: s.steps,
      forcedSteps: s.forcedSteps,
      frames: s.frames,
      draws: s.draws,
      viewSeeded: s.viewSeeded === true,
    },
    view: {
      run: s.view.run === true,
      freeze: s.view.freeze === true,
      dbFloor: s.view.dbFloor,
      waterfallMs: s.view.waterfallMs,
    },
    loop: {
      rafOn: s.rafOn === true,
      visible: s.visible === true,
      hidden: s.docHidden === true,
      paused: s.view.run !== true,
      ticks: s.ticks,
      lastStepAt: s.lastStepAt > -1e8 ? s.lastStepAt : null,
    },
    frames: { scopeReady: s.scopeReady === true, spectrumReady: s.spectrumReady === true, wfReady: s.wfReady === true },
    readouts: null,
    meters: s.meters ? { lufs: s.meters.lufs, tp: s.meters.tp } : null,
    status: s.statusMsg,
    statusKind: s.statusKind,
    note: s.noteText || "",
    classes: avDeckUiClasses(),
  };
  try {
    const r = avDeckUiReadouts();
    if (r) {
      out.readouts = {
        bpm: isFinite(Number(r.bpm)) ? Number(r.bpm) : null,
        voices: isFinite(Number(r.voices)) ? Number(r.voices) : null,
        maxVoices: isFinite(Number(r.maxVoices)) ? Number(r.maxVoices) : null,
        tier: (typeof r.tier === "string") ? r.tier : null,
        ctxState: (typeof r.ctxState === "string") ? r.ctxState : null,
        cpuMs: isFinite(Number(r.cpuMs)) ? Number(r.cpuMs) : null,
        notesSeen: isFinite(Number(r.notesSeen)) ? Number(r.notesSeen) : null,
        lastNote: (r.lastNote && typeof r.lastNote === "object")
          ? { name: (typeof r.lastNote.name === "string") ? r.lastNote.name : null, vel: isFinite(Number(r.lastNote.vel)) ? Number(r.lastNote.vel) : null }
          : ((typeof r.lastNote === "string" && r.lastNote) ? { name: r.lastNote, vel: null } : null),
      };
    }
  } catch (e) { /* honest null */ }
  try {
    if (host && typeof host.querySelector === "function") {
      out.card = !!host.querySelector(".av-deck");
      out.canvases.scope = !!host.querySelector("#av-deck-scope");
      out.canvases.spectrum = !!host.querySelector("#av-deck-spectrum");
      out.canvases.waterfall = !!host.querySelector("#av-deck-waterfall");
    }
  } catch (e) { /* no DOM */ }
  return out;
}

function avDeckUiClasses() {
  return AV_DECK_UI_CLASSES.slice();
}

/* ---------- debug/verify handle ---------- */

if (typeof window !== "undefined") {
  try {
    const stateFn = function () { return avDeckUiSnap(); };
    try {
      Object.defineProperty(stateFn, "inited", { get: function () { return !!avDeckUiState.inited; } });
      Object.defineProperty(stateFn, "view", { get: function () { return avDeckUiState.view; } });
      Object.defineProperty(stateFn, "attached", { get: function () { return avDeckUiState.attached === true; } });
    } catch (e2) { /* getters are a nicety */ }
    window.__avDeckUi = {
      version: AV_DECK_UI_VERSION,
      init: function () { return avDeckUiInit(); },
      sync: function () { return avDeckUiSync(); },
      classes: function () { return avDeckUiClasses(); },
      snap: function () { return avDeckUiSnap(); },
      state: stateFn,
      step: function () { return avDeckUiStep(); },
      view: function (key, value) { return avDeckUiSetView(key, value); },
      run: function (v) { return avDeckUiSetRun(v); },
      freeze: function (v) { return avDeckUiSetFreeze(v); },
      dbFloor: function (v) { return avDeckUiSetDbFloor(v); },
      waterfallMs: function (v) { return avDeckUiSetWfRate(v); },
      attach: function () { return avDeckUiTryAttach(); },
    };
  } catch (e) { /* no window — nothing to publish */ }
}
