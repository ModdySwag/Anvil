/* Anvil - TUNE card (T wave, child C-1): the microtuning card mounted into the parent-owned host
   `#av-tune-host` (the parent adds the `#av-tune` card + host after `#av-sample` at integration
   and calls avTuneUiInit()); this module only fills the host. Per verify/_t_wave.md section 5. The core
   it drives is child A's `src/av_tune.js` - WE CODE AGAINST THE PINNED section 3 NAMES EXACTLY, every
   call typeof-guarded PER CALL (the core may load after this file, or not at all: absent core =
   the card still mounts, every action refuses honestly, no throw paths). The engine senders
   avEngineTune / avEngineTuneActive are child B's av_engine.js additions, same guarded law.

   WHAT THIS CARD IS - one tuning surface over the engine's 8-slot tuning bank:
     - SCALE    `#av-tune-scale`  - the global selection: a leading "12-EDO (equal)" option
                (value `12edo`) ALWAYS, then the core's built-ins, then user library .scl rows.
                value = tuning id.
     - ROOT     `#av-tune-root`   - a select of midi notes g2..c6 (values 43..84) labelled via
                avNoteName ('c4' style), default c4 (60) - the midi key anchoring the scale 1/1.
     - MORPH    `#av-tune-morph`  - range 0..100 (default 100): 0 = 12-EDO equal, 100 = the
                scale fully applied. Upload = avTuneBuildTable -> avTuneMorph -> avEngineTune.
                Live on input (coalesced to one rAF), committed on release.
     - PARTS    `#av-tune-track-0`..`#av-tune-track-3` - per-track selects ("GLOBAL" = value ""
                or a tuning id). Track tunings upload to their own bank slots; the SCHED reads
                avTuneTrackSlot(trackIndex) at note emission (the live, side-effect-free lookup
                this module exports) and passes the slot as opts.tune - no pattern schema change.
     - LIBRARY  `#av-tune-lib` - rows `[data-tune-id]` with APPLY / DEL buttons (all promise-
                settled like av_wt's library). `#av-tune-import` + hidden `#av-tune-import-file`
                (accept ".scl,.kbm") sniff (avTuneParseScl then avTuneParseKbm; both parsing =
                extension tiebreak) and save via avTuneLibrarySave. A kbm row's APPLY attaches
                it as the keyboard mapping of the current global selection (rebuild + re-upload).
                An scl row's APPLY selects it globally. `#av-tune-export` downloads
                avTuneExportScl(sel) as `<name>.scl` (the house blob/anchor download law).
     - MTS      `#av-tune-mts` (checkbox) + `#av-tune-mts-status` - live MTS SysEx receive.
                avTuneMtsEnable(true) registers the module's sink through av_midi.js's passive
                hook avMidiSetSysExSink(fn) and requests SysEx access on first enable (its own
                {sysex:true} prompt; denied = "MTS needs SysEx permission"). Incoming F0..F7
                bytes -> avTuneMtsParse -> a 128-table -> avEngineTune(7, offs, "MTS live") +
                avEngineTuneActive(7). Scale forms replace the table (pitch classes replicate
                across octaves); single-note forms merge into it. OFF unregisters the sink and
                restores the global slot's active. MTS live tables are UNAUTHORITATIVE-scaled:
                the morph slider does NOT scale them (the sender's tuning lands as sent).
                The deck's avMidiSetSysExSink hook is passive - nothing in av_midi.js changes
                until this card registers.

   SLOT LAW (page-side): slot 7 is reserved for MTS live; slots 0..6 hold the distinct SELECTED
   tunings (global first, then the four tracks). Allocation: an id keeps its slot; a free slot is
   taken lowest-first; when none is free, the least-recently-used slot holding an id that is NO
   LONGER selected is reused (LRU by selection order); when every slot holds a live selected
   tuning the change is REFUSED on the status line - no silent eviction, ever. Distinct
   tunings share slots (a track on the same id as the global uses the global's slot).
   Upload: avTuneBuildTable({cents[,kbm]}, {root}) -> avTuneMorph(table, morph/100) ->
   avEngineTune(slot, offs, <id>) (the slot NAME is the tuning id, so stats().tune.slots reads
   the truth); avEngineTuneActive(global slot) after the global upload.

   LS PREF: `av-tune-pref` v:1 - { v, sel, root, morph, tracks[4], mts, map } (small; `map` is
   the additive pinned deviation: the attached .kbm library id, else ""). Re-applied on init.

   PINNED IDS (rig + parent rely on these; exact): #av-tune-scale - #av-tune-root -
   #av-tune-morph - #av-tune-track-0..3 - #av-tune-import - #av-tune-import-file -
   #av-tune-export - #av-tune-lib - #av-tune-mts - #av-tune-status - #av-tune-mts-status.
   EXTRA ids (documented, the parent does not need them): #av-tune-morph-val.
   #av-tune / #av-tune-host are parent-owned; this module never writes them (the root-id
   fallback only claims `av-tune` when NO such element exists anywhere - the av_files_ui idiom).

   LAWS (house): 'use strict'; classic script; ONE namespace avTuneUi* / tuneUi* / AV_TUNE_UI_*;
   NO DOM at top level (every touch sits inside a guarded function); node-loadable (zero DOM at
   load - the harness loads this text in a Function scope); never throws outward; no console
   noise; no new AudioContext (this card makes NO sound of its own); deterministic (no
   randomness); every avTune* / avEngineTune* / avMidiSetSysExSink call is typeof-guarded per
   call - absent core = honest refusals, never a throw.

   STYLES the parent should generate from avTuneUiClasses() (the list below is the contract):
   .av-tune { display:flex; flex-direction:column; gap:8px; }  - .av-tune-head { display:flex;
   align-items:baseline; gap:8px; flex-wrap:wrap; }  - .av-tune-title { a small caps title } -
   .av-tune-row, .av-tune-tracks, .av-tune-actions, .av-tune-mtsrow { display:flex;
   align-items:center; gap:6px; flex-wrap:wrap; }  - .av-tune-lbl { the tiny dim label } -
   .av-tune-select { min-width:140px; }  - .av-tune-range { flex:1; min-width:120px; } -
   .av-tune-morph-val { min-width:44px; text-align:right; }  - .av-tune-track { display:inline-flex;
   align-items:center; gap:4px; }  - .av-tune-lib-row { display:flex; align-items:center;
   gap:6px; justify-content:space-between; }  - .av-tune-lib-meta { flex:1; } -
   .av-tune-lib-acts { display:inline-flex; gap:4px; }  - .av-tune-err { color:#ff8f6e; } -
   .av-tune-file { display:none; }  - .av-tune-mts-status { max-width:100%; }.

   OBSERVABLES: avTuneUiInit() -> bool (false without #av-tune-host; idempotent; re-mountable) -
   avTuneUiSync(root) -> bool (full repaint; root defaults to #av-tune-host) -
   avTuneUiSnap() -> the honest card state (JSON-safe) - avTuneUiClasses() -> string[] -
   avTuneTrackSlot(trackIndex) -> int | undefined (the sched's live per-note lookup; side-effect
   free, never throws) - avTuneMtsEnable(on) -> bool (the #av-tune-mts handler) -
   avTuneUiMtsApply(bytes) -> bool (device-free parse+apply chain; the rig calls this directly) -
   window.__avTuneUi = { version, state, init, snap, classes, sync, mtsEnable, mtsApply, trackSlot }.

   ONE writer (child C). DOM touches live only inside guarded functions. */

"use strict";

const AV_TUNE_UI_VERSION = "t1.0";
const AV_TUNE_UI_PREF_KEY = "av-tune-pref";      /* the only LS key this card writes          */
const AV_TUNE_UI_MTS_SLOT = 7;                   /* slot 7 is reserved for MTS live           */
const AV_TUNE_UI_SLOT_MAX = 6;                   /* tuning slots 0..6                         */
const AV_TUNE_UI_TRACKS = 4;                     /* the four parts                            */
const AV_TUNE_UI_ROOT_MIN = 43;                  /* g2                                        */
const AV_TUNE_UI_ROOT_MAX = 84;                  /* c6                                        */
const AV_TUNE_UI_ROOT_DEF = 60;                  /* c4                                        */
const AV_TUNE_UI_MORPH_DEF = 100;
const AV_TUNE_UI_MTS_NAME = "MTS live";
const AV_TUNE_UI_EQUAL_ID = "12edo";             /* the leading "12-EDO (equal)" option value */
const AV_TUNE_UI_BUSY = "all 7 tuning slots are busy - no silent eviction (deselect a part first)";

/* the NEW css classes this card introduces (the parent styles them; #av-tune-host excluded -
   it is parent-owned). Kept in one place so the integration class-coverage check can diff.
   av-tune-err / av-tune-msg are toggled dynamically on #av-tune-status. */
const AV_TUNE_UI_CLASSES = [
  "av-tune", "av-tune-head", "av-tune-title", "av-tune-cap",
  "av-tune-status-line", "av-tune-status", "av-tune-msg", "av-tune-err",
  "av-tune-row", "av-tune-lbl", "av-tune-select", "av-tune-range", "av-tune-morph-val",
  "av-tune-tracks", "av-tune-track",
  "av-tune-lib", "av-tune-lib-row", "av-tune-lib-name", "av-tune-lib-meta", "av-tune-lib-acts", "av-tune-lib-empty",
  "av-tune-actions", "av-tune-btn", "av-tune-file",
  "av-tune-mtsrow", "av-tune-mtslbl", "av-tune-mtsbox", "av-tune-mts-status",
  "av-tune-note",
];

/* UI-local state only - every core fact is read through the pinned apis per call. */
const avTuneUiState = {
  inited: false, mounts: 0,
  sel: AV_TUNE_UI_EQUAL_ID,        /* the global tuning id                            */
  root: AV_TUNE_UI_ROOT_DEF,       /* midi note anchoring the 1/1                     */
  morph: AV_TUNE_UI_MORPH_DEF,     /* 0..100 user units                               */
  tracks: ["", "", "", ""],        /* per-part tuning id or "" = global               */
  mts: false,                      /* the live receive toggle                         */
  map: "",                         /* attached .kbm library id, "" = none             */
  mapCache: null,                  /* { id, opts } resolved kbm                       */
  res: {},                         /* id -> resolved { id, name, kind, cents } cache  */
  slots: [null, null, null, null, null, null, null],   /* 0..6: { id, at, sent } | null   */
  mtsTable: null,                  /* the live slot-7 table (Float32Array(128) | null) */
  mtsKind: "", mtsCount: 0, mtsAt: 0, mtsError: "", mtsIgnored: 0, mtsOk: false,
  mtsReg: false,                   /* the av_midi sink registration landed            */
  sysexAsking: false, sysexOk: false, sysexDenied: false, sysexError: "",
  lib: [], libSig: "", lastLibErr: "",
  optSig: "",
  morphRaf: 0,
  replayPending: false,
  status: "tune idle - pick a scale", statusKind: "msg",
  wired: false, memo: { text: {}, cls: {} },
  seq: 0, lastError: "",
};

/* ---------- small pure helpers (no DOM; harness-covered) ---------- */

const avTuneUiEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function avTuneUiClamp(v, lo, hi) {
  const n = Number(v);
  if (!isFinite(n)) return lo;
  return n < lo ? lo : (n > hi ? hi : n);
}

function avTuneUiErrText(e, fallback) {
  try {
    if (e && typeof e === "object") {
      if (typeof e.error === "string" && e.error) return e.error;
      if (typeof e.message === "string" && e.message) return e.message;
    }
    if (typeof e === "string" && e) return e;
  } catch (e2) { /* fall through */ }
  return fallback || "refused";
}

/* settle a sync value or a promise exactly once, never throwing (the av_files_ui law) */
function avTuneUiSettle(p, cb) {
  const done = { v: false };
  const once = function (r) {
    if (done.v) return;
    done.v = true;
    try { cb(r); } catch (e) { /* settle never throws */ }
  };
  try {
    if (p && typeof p.then === "function") {
      p.then(once)["catch"](function (e) { once({ ok: false, error: avTuneUiErrText(e, "failed") }); });
      return true;
    }
    once(p);
    return true;
  } catch (e) {
    once({ ok: false, error: avTuneUiErrText(e, "failed") });
    return false;
  }
}

/* 60 -> 'c4' (the avNoteName shape); own fallback so the card never depends on av_note.js */
function avTuneUiRootLabel(midi) {
  try {
    const m = Math.round(Number(midi));
    if (typeof avNoteName === "function") {
      const n = avNoteName(m);
      if (typeof n === "string" && n) return n;
    }
    if (!isFinite(m) || m < 0 || m > 127) return "";
    const names = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
    return names[m % 12] + (Math.floor(m / 12) - 1);
  } catch (e) { return ""; }
}

function avTuneUiFmtAt(t) {
  try {
    const d = new Date(Number(t) || Date.now());
    const p = (n) => String(n).padStart(2, "0");
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  } catch (e) { return ""; }
}

function avTuneUiSanitizeFile(name) {
  try {
    const n = String(name == null ? "" : name).replace(/[^a-z0-9._ -]+/gi, "_").replace(/\s+/g, "_").slice(0, 48);
    return n || "tuning";
  } catch (e) { return "tuning"; }
}

function avTuneUiFileStem(name) {
  try {
    const n = String(name == null ? "" : name).replace(/\.[^./\\]*$/, "").replace(/[^a-z0-9._ -]+/gi, "_").trim().slice(0, 48);
    return n || "";
  } catch (e) { return ""; }
}

/* sniff decision (avTuneParseScl then avTuneParseKbm per the pin; when BOTH parse, the file
   extension breaks the tie - a .kbm that happens to read as .scl stays a mapping) */
function avTuneUiSniffKind(name, sclOk, kbmOk) {
  try {
    if (sclOk && kbmOk) {
      const lower = String(name || "").toLowerCase();
      return (lower.indexOf(".kbm") >= 0 && lower.indexOf(".scl") < 0) ? "kbm" : "scl";
    }
    if (sclOk) return "scl";
    if (kbmOk) return "kbm";
  } catch (e) { /* refuse */ }
  return "";
}

/* the pref round-trip: clean() is total (any garbage in -> sane defaults out) */
function avTuneUiPrefClean(raw) {
  const out = { v: 1, sel: AV_TUNE_UI_EQUAL_ID, root: AV_TUNE_UI_ROOT_DEF, morph: AV_TUNE_UI_MORPH_DEF, tracks: ["", "", "", ""], mts: false, map: "" };
  try {
    if (!raw || typeof raw !== "object") return out;
    if (typeof raw.sel === "string" && raw.sel) out.sel = raw.sel.slice(0, 64);
    const r = Math.round(Number(raw.root));
    if (isFinite(r)) out.root = Math.round(avTuneUiClamp(r, AV_TUNE_UI_ROOT_MIN, AV_TUNE_UI_ROOT_MAX));
    const m = Math.round(Number(raw.morph));
    if (isFinite(m)) out.morph = Math.round(avTuneUiClamp(m, 0, 100));
    if (raw.tracks && typeof raw.tracks.length === "number") {
      for (let i = 0; i < AV_TUNE_UI_TRACKS; i++) {
        const t = raw.tracks[i];
        if (typeof t === "string") out.tracks[i] = t.slice(0, 64);
      }
    }
    out.mts = (raw.mts === true);
    if (typeof raw.map === "string") out.map = raw.map.slice(0, 64);
  } catch (e) { /* defaults */ }
  return out;
}

function avTuneUiPrefBuild() {
  const s = avTuneUiState;
  return { v: 1, sel: s.sel, root: s.root, morph: s.morph, tracks: s.tracks.slice(0, AV_TUNE_UI_TRACKS), mts: !!s.mts, map: s.map || "" };
}

/* slot allocation (pure; mutates the slots array). Existing id keeps its slot; a free slot is
   taken lowest-first; else the LRU slot whose id is NOT live (still selected) is reused; else
   -1 (the honest refusal - a live slot is never evicted). */
function avTuneUiSlotNextAt(slots) {
  let m = 0;
  try {
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s && typeof s.at === "number" && isFinite(s.at) && s.at > m) m = s.at;
    }
  } catch (e) { /* empty */ }
  return m + 1;
}

function avTuneUiSlotAlloc(slots, id, live) {
  try {
    if (!slots || typeof slots.length !== "number" || typeof id !== "string" || !id) return -1;
    let i;
    for (i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s && s.id === id) { s.at = avTuneUiSlotNextAt(slots); return i; }
    }
    for (i = 0; i < slots.length; i++) {
      if (!slots[i]) { slots[i] = { id: id, at: avTuneUiSlotNextAt(slots), sent: false }; return i; }
    }
    const liveList = (live && typeof live.length === "number") ? live : [];
    let victim = -1, best = Infinity;
    for (i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s || liveList.indexOf(s.id) >= 0) continue;
      const at = (typeof s.at === "number" && isFinite(s.at)) ? s.at : 0;
      if (at < best) { best = at; victim = i; }
    }
    if (victim >= 0) { slots[victim] = { id: id, at: avTuneUiSlotNextAt(slots), sent: false }; return victim; }
    return -1;
  } catch (e) { return -1; }
}

/* MTS parse result -> shape checks + the 128-table. A scale/octave form replicates each degree
   across every octave by pitch class; a single-note form writes that one note only. */
function avTuneUiMtsScaleForm(r) {
  try {
    const kind = String((r && r.kind) || "").toLowerCase();
    if (kind.indexOf("scale") >= 0 || kind.indexOf("octave") >= 0) return true;
    if (kind.indexOf("note") >= 0 || kind.indexOf("single") >= 0) return false;
    const n = (r && r.notes && typeof r.notes.length === "number") ? r.notes.length : 0;
    return n >= 12;
  } catch (e) { return false; }
}

function avTuneUiMtsTable(r) {
  const out = new Float32Array(128);
  try {
    const notes = (r && r.notes && typeof r.notes.length === "number") ? r.notes : [];
    const cents = (r && r.cents && typeof r.cents.length === "number") ? r.cents : [];
    const n = Math.min(notes.length, cents.length);
    const scale = avTuneUiMtsScaleForm(r);
    for (let i = 0; i < n; i++) {
      const note = Math.round(Number(notes[i]));
      const c = Number(cents[i]);
      if (!isFinite(note) || !isFinite(c)) continue;
      const st = c / 100;
      if (scale) {
        const pc = ((note % 12) + 12) % 12;
        for (let m = pc; m < 128; m += 12) out[m] = st;
      } else if (note >= 0 && note <= 127) {
        out[note] = st;
      }
    }
  } catch (e) { /* zeros */ }
  return out;
}

/* ---------- guarded DOM / env access (no throw, no noise) ---------- */

function avTuneUiWin() {
  try { if (typeof window !== "undefined") return window; } catch (e) { /* none */ }
  return null;
}

function avTuneUiDoc() {
  try { if (typeof document !== "undefined") return document; } catch (e) { /* none */ }
  return null;
}

function avTuneUiHost() {
  try {
    const d = avTuneUiDoc();
    if (d && typeof d.getElementById === "function") return d.getElementById("av-tune-host");
  } catch (e) { /* no document */ }
  return null;
}

function avTuneUiHasWebMidi() {
  try { return typeof navigator !== "undefined" && !!navigator && typeof navigator.requestMIDIAccess === "function"; } catch (e) { return false; }
}

function avTuneUiLs() {
  try { if (typeof localStorage !== "undefined" && localStorage) return localStorage; } catch (e) { /* none */ }
  return null;
}

/* every pinned core / engine / deck entry, each detected by typeof only (never called here) */
function avTuneUiCores() {
  const c = {
    parseScl: false, parseKbm: false, buildTable: false, morph: false, mtsParse: false,
    exportScl: false, builtin: false, builtinIds: false,
    libSave: false, libList: false, libLoad: false, libDel: false,
    engineTune: false, engineActive: false, engineEnsure: false, midiSink: false,
  };
  try { c.parseScl = typeof avTuneParseScl === "function"; } catch (e) { /* none */ }
  try { c.parseKbm = typeof avTuneParseKbm === "function"; } catch (e) { /* none */ }
  try { c.buildTable = typeof avTuneBuildTable === "function"; } catch (e) { /* none */ }
  try { c.morph = typeof avTuneMorph === "function"; } catch (e) { /* none */ }
  try { c.mtsParse = typeof avTuneMtsParse === "function"; } catch (e) { /* none */ }
  try { c.exportScl = typeof avTuneExportScl === "function"; } catch (e) { /* none */ }
  try { c.builtin = typeof avTuneBuiltin === "function"; } catch (e) { /* none */ }
  try { c.builtinIds = typeof avTuneBuiltinIds === "function"; } catch (e) { /* none */ }
  try { c.libSave = typeof avTuneLibrarySave === "function"; } catch (e) { /* none */ }
  try { c.libList = typeof avTuneLibraryList === "function"; } catch (e) { /* none */ }
  try { c.libLoad = typeof avTuneLibraryLoad === "function"; } catch (e) { /* none */ }
  try { c.libDel = typeof avTuneLibraryDelete === "function"; } catch (e) { /* none */ }
  try { c.engineTune = typeof avEngineTune === "function"; } catch (e) { /* none */ }
  try { c.engineActive = typeof avEngineTuneActive === "function"; } catch (e) { /* none */ }
  try { c.engineEnsure = typeof avEngineEnsure === "function"; } catch (e) { /* none */ }
  try { c.midiSink = typeof avMidiSetSysExSink === "function"; } catch (e) { /* none */ }
  return c;
}

/* ---------- status / painting (write-on-change, the av_wt_ui idiom) ---------- */

function avTuneUiWriteText(host, sel, txt, key) {
  try {
    const s = avTuneUiState;
    if (s.memo.text[key] === txt) return false;
    s.memo.text[key] = txt;
    const el = (host && typeof host.querySelector === "function") ? host.querySelector(sel) : null;
    if (el && el.textContent !== txt) el.textContent = txt;
    return true;
  } catch (e) { return false; }
}

function avTuneUiToggleClass(host, sel, cls, on, key) {
  try {
    const s = avTuneUiState;
    const memoKey = key + "|" + cls;
    if (s.memo.cls[memoKey] === !!on) return false;
    s.memo.cls[memoKey] = !!on;
    const el = (host && typeof host.querySelector === "function") ? host.querySelector(sel) : null;
    if (el && el.classList && typeof el.classList.add === "function") {
      if (on) el.classList.add(cls); else el.classList.remove(cls);
    }
    return true;
  } catch (e) { return false; }
}

function avTuneUiPaintStatus(host) {
  if (!host) return false;
  try {
    const s = avTuneUiState;
    avTuneUiWriteText(host, "#av-tune-status", s.status, "status");
    avTuneUiToggleClass(host, "#av-tune-status", "av-tune-err", s.statusKind === "err", "status-err");
    return true;
  } catch (e) { return false; }
}

function avTuneUiSetStatus(msg, kind) {
  try {
    const s = avTuneUiState;
    s.status = String(msg == null ? "" : msg);
    s.statusKind = (kind === "err") ? "err" : "msg";
    return avTuneUiPaintStatus(avTuneUiHost());
  } catch (e) { return false; }
}

/* the MTS status sentence - one source of truth for #av-tune-mts-status and the snap */
function avTuneUiDeckEnabled() {
  try {
    const w = avTuneUiWin();
    if (w && w.__avMidi && typeof w.__avMidi.snap === "function") {
      const sn = w.__avMidi.snap();
      return !!(sn && sn.enabled);
    }
  } catch (e) { /* no deck */ }
  return false;
}

function avTuneUiMtsStatusNow() {
  const s = avTuneUiState;
  if (!s.mts) return "MTS off - tick to receive live MTS tunings into slot 7";
  if (typeof avTuneMtsParse !== "function") return "MTS needs the tuning core (av_tune.js)";
  if (!avTuneUiHasWebMidi()) return "MTS needs Web MIDI";
  if (s.sysexAsking) return "MTS: asking for SysEx permission...";
  if (s.sysexDenied) return "MTS needs SysEx permission";
  if (typeof avMidiSetSysExSink !== "function") return "MTS needs the MIDI deck (av_midi.js)";
  let txt = "MTS listening - live tunings land in slot 7";
  if (!avTuneUiDeckEnabled()) txt += " - press ENABLE MIDI in the deck";
  if (s.mtsIgnored) txt += " - " + s.mtsIgnored + " non-MTS sysex ignored";
  if (s.mtsAt) txt += " - last: " + (s.mtsKind || "?") + " " + s.mtsCount + " note" + (s.mtsCount === 1 ? "" : "s") + " " + avTuneUiFmtAt(s.mtsAt);
  return txt;
}

function avTuneUiPaintMts(host) {
  if (!host) return false;
  try {
    const s = avTuneUiState;
    const box = (typeof host.querySelector === "function") ? host.querySelector("#av-tune-mts") : null;
    if (box && box.checked !== !!s.mts) box.checked = !!s.mts;
    avTuneUiWriteText(host, "#av-tune-mts-status", avTuneUiMtsStatusNow(), "mts");
    return true;
  } catch (e) { return false; }
}

function avTuneUiPaintMorph(host) {
  if (!host) return false;
  try {
    const s = avTuneUiState;
    const el = (typeof host.querySelector === "function") ? host.querySelector("#av-tune-morph") : null;
    const v = String(Math.round(avTuneUiClamp(s.morph, 0, 100)));
    if (el && typeof el.value === "string" && el.value !== v) {
      const d = avTuneUiDoc();
      const active = (d && d.activeElement) ? d.activeElement : null;
      if (active !== el) el.value = v;
    }
    avTuneUiWriteText(host, "#av-tune-morph-val", v + "%", "morphval");
    return true;
  } catch (e) { return false; }
}

function avTuneUiSelectHas(el, v) {
  try {
    if (!el || !el.options) return false;
    for (let i = 0; i < el.options.length; i++) {
      if (String(el.options[i].value) === String(v)) return true;
    }
  } catch (e) { /* unreadable */ }
  return false;
}

function avTuneUiBuiltinLabel(id) {
  try {
    if (typeof avTuneBuiltin === "function") {
      const b = avTuneBuiltin(id);
      if (b && typeof b.name === "string" && b.name) return b.name;
    }
  } catch (e) { /* id only */ }
  return id;
}

function avTuneUiScaleOptionsHTML() {
  let html = '<option value="' + avTuneUiEsc(AV_TUNE_UI_EQUAL_ID) + '">12-EDO (equal)</option>';
  try {
    if (typeof avTuneBuiltinIds === "function") {
      const ids = avTuneBuiltinIds();
      if (ids && typeof ids.length === "number") {
        for (let i = 0; i < ids.length && i < 64; i++) {
          const id = String(ids[i] || "");
          if (!id || id === AV_TUNE_UI_EQUAL_ID) continue;
          html += '<option value="' + avTuneUiEsc(id) + '">' + avTuneUiEsc(avTuneUiBuiltinLabel(id)) + "</option>";
        }
      }
    }
  } catch (e) { /* equal only */ }
  for (let i = 0; i < avTuneUiState.lib.length && i < 64; i++) {
    const e = avTuneUiState.lib[i];
    if (!e || e.kind === "kbm") continue;         /* kbm rows APPLY as mappings, not scales */
    html += '<option value="' + avTuneUiEsc(e.id) + '">' + avTuneUiEsc(e.name) + "</option>";
  }
  return html;
}

function avTuneUiTrackOptionsHTML() {
  let html = '<option value="">GLOBAL</option>';
  try {
    if (typeof avTuneBuiltinIds === "function") {
      const ids = avTuneBuiltinIds();
      if (ids && typeof ids.length === "number") {
        for (let i = 0; i < ids.length && i < 64; i++) {
          const id = String(ids[i] || "");
          if (!id) continue;
          const lbl = (id === AV_TUNE_UI_EQUAL_ID) ? "12-EDO (equal)" : avTuneUiBuiltinLabel(id);
          html += '<option value="' + avTuneUiEsc(id) + '">' + avTuneUiEsc(lbl) + "</option>";
        }
      }
    }
  } catch (e) { /* GLOBAL only */ }
  for (let i = 0; i < avTuneUiState.lib.length && i < 64; i++) {
    const e = avTuneUiState.lib[i];
    if (!e || e.kind === "kbm") continue;
    html += '<option value="' + avTuneUiEsc(e.id) + '">' + avTuneUiEsc(e.name) + "</option>";
  }
  return html;
}

function avTuneUiOptSig() {
  const s = avTuneUiState;
  let sig = "";
  try {
    if (typeof avTuneBuiltinIds === "function") {
      const ids = avTuneBuiltinIds();
      if (ids && typeof ids.length === "number") sig += ids.slice(0, 64).join(",");
    }
  } catch (e) { /* no builtins */ }
  sig += "|" + s.lib.map(e => e.id + ":" + e.kind).join(",");
  return sig;
}

function avTuneUiPaintSelects(host) {
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const s = avTuneUiState;
    const scaleEl = host.querySelector("#av-tune-scale");
    const trackEls = [];
    for (let i = 0; i < AV_TUNE_UI_TRACKS; i++) trackEls.push(host.querySelector("#av-tune-track-" + i));
    const sig = avTuneUiOptSig();
    if (s.optSig !== sig) {
      if (scaleEl) scaleEl.innerHTML = avTuneUiScaleOptionsHTML();
      for (let i = 0; i < AV_TUNE_UI_TRACKS; i++) {
        if (trackEls[i]) trackEls[i].innerHTML = avTuneUiTrackOptionsHTML();
      }
      s.optSig = sig;
    }
    if (scaleEl && avTuneUiSelectHas(scaleEl, s.sel) && scaleEl.value !== s.sel) scaleEl.value = s.sel;
    const rootEl = host.querySelector("#av-tune-root");
    if (rootEl) {
      const rv = String(s.root);
      if (avTuneUiSelectHas(rootEl, rv) && rootEl.value !== rv) rootEl.value = rv;
    }
    for (let i = 0; i < AV_TUNE_UI_TRACKS; i++) {
      const tv = s.tracks[i] || "";
      if (trackEls[i] && avTuneUiSelectHas(trackEls[i], tv) && trackEls[i].value !== tv) trackEls[i].value = tv;
    }
    return true;
  } catch (e) { return false; }
}

function avTuneUiLibRowHTML(e) {
  let meta;
  if (e.kind === "kbm") {
    meta = ".kbm - " + (e.mapSize != null ? (e.mapSize + " chain steps") : "keyboard mapping");
  } else {
    meta = "." + (e.kind === "builtin" ? "builtin" : "scl") + (e.count != null ? (" - " + e.count + " degrees") : "");
  }
  return '<div class="av-tune-lib-row" data-tune-id="' + avTuneUiEsc(e.id) + '">' +
    '<span class="av-tune-lib-name" title="' + avTuneUiEsc(e.name) + '">' + avTuneUiEsc(e.name) + "</span>" +
    '<span class="av-tune-lib-meta av-dim">' + avTuneUiEsc(meta) + "</span>" +
    '<span class="av-tune-lib-acts">' +
    '<button type="button" class="av-btn mini av-tune-btn" data-tune-act="apply" data-tune-id="' + avTuneUiEsc(e.id) + '" title="' + avTuneUiEsc(e.kind === "kbm" ? "attach as the keyboard mapping of the current selection" : "select this tuning as the global scale") + '">APPLY</button>' +
    '<button type="button" class="av-btn mini av-tune-btn" data-tune-act="delete" data-tune-id="' + avTuneUiEsc(e.id) + '" title="remove this entry from the library">DEL</button>' +
    "</span></div>";
}

function avTuneUiPaintLib(host) {
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const s = avTuneUiState;
    const box = host.querySelector("#av-tune-lib");
    if (!box) return false;
    const sig = s.lib.map(e => e.id).join(",") + "|" + (s.lastLibErr || "");
    if (s.libSig === sig) return false;
    s.libSig = sig;
    if (!s.lib.length) {
      const why = s.lastLibErr ? (" - " + avTuneUiEsc(s.lastLibErr)) : "";
      box.innerHTML = '<p class="av-note av-dim av-tune-lib-empty">library - import a .scl/.kbm to store it here' + why + "</p>";
      return true;
    }
    let html = "";
    for (let i = 0; i < s.lib.length && i < 64; i++) html += avTuneUiLibRowHTML(s.lib[i]);
    box.innerHTML = html;
    return true;
  } catch (e) { return false; }
}

/* ---------- prefs ---------- */

function avTuneUiPersist() {
  try {
    const ls = avTuneUiLs();
    if (!ls || typeof ls.setItem !== "function") return false;
    ls.setItem(AV_TUNE_UI_PREF_KEY, JSON.stringify(avTuneUiPrefBuild()));
    return true;
  } catch (e) { return false; }
}

function avTuneUiPrefLoad() {
  try {
    const ls = avTuneUiLs();
    if (!ls || typeof ls.getItem !== "function") return false;
    const raw = ls.getItem(AV_TUNE_UI_PREF_KEY);
    if (!raw) return false;
    const clean = avTuneUiPrefClean(JSON.parse(raw));
    const s = avTuneUiState;
    s.sel = clean.sel;
    s.root = clean.root;
    s.morph = clean.morph;
    s.tracks = clean.tracks.slice(0, AV_TUNE_UI_TRACKS);
    s.mts = clean.mts;
    s.map = clean.map;
    return true;
  } catch (e) { return false; }
}

/* ---------- slot bookkeeping ---------- */

function avTuneUiLiveIds() {
  const s = avTuneUiState;
  const out = [];
  if (s.sel) out.push(s.sel);
  for (let i = 0; i < AV_TUNE_UI_TRACKS; i++) {
    if (s.tracks[i] && out.indexOf(s.tracks[i]) < 0) out.push(s.tracks[i]);
  }
  return out;
}

function avTuneUiEnsureSlot(id) {
  try {
    if (typeof id !== "string" || !id) return -1;
    return avTuneUiSlotAlloc(avTuneUiState.slots, id, avTuneUiLiveIds());
  } catch (e) { return -1; }
}

function avTuneUiSlotForId(id) {
  try {
    const slots = avTuneUiState.slots;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] && slots[i].id === id) return i;
    }
  } catch (e) { /* none */ }
  return -1;
}

/* ---------- resolve / build / upload (the core + engine seam) ---------- */

function avTuneUiAsTable(x) {
  try {
    if (!x || typeof x.length !== "number" || x.length < 128) return null;
    const out = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      const v = Number(x[i]);
      out[i] = isFinite(v) ? v : 0;
    }
    return out;
  } catch (e) { return null; }
}

/* id -> { id, name, kind, cents } - builtins sync, library entries settled; never throws */
function avTuneUiResolve(id, cb) {
  const done = { v: false };
  const fin = function (res, err) {
    if (done.v) return;
    done.v = true;
    try { cb(res || null, err || ""); } catch (e) { /* caller settled */ }
  };
  try {
    const s = avTuneUiState;
    if (typeof id !== "string" || !id) { fin(null, "no tuning selected"); return; }
    if (s.res[id]) { fin(s.res[id], ""); return; }
    if (typeof avTuneBuiltin === "function") {
      let b = null;
      try { b = avTuneBuiltin(id); } catch (e) { b = null; }
      if (b && typeof b === "object" && b.cents && typeof b.cents.length === "number" && b.cents.length > 0) {
        const res = {
          id: id,
          name: (typeof b.name === "string" && b.name) ? b.name : id,
          kind: "builtin",
          cents: Array.prototype.slice.call(b.cents, 0, 512),
        };
        s.res[id] = res;
        fin(res, "");
        return;
      }
    }
    if (typeof avTuneLibraryLoad !== "function") { fin(null, "the tuning core (av_tune.js) is not present"); return; }
    let out = null;
    try { out = avTuneLibraryLoad(id); } catch (e) { fin(null, avTuneUiErrText(e, "the library load failed")); return; }
    avTuneUiSettle(out, function (item) {
      if (!item || typeof item !== "object") { fin(null, "the library has no entry " + id); return; }
      if (item.kind === "kbm") { fin(null, id + " is a keyboard mapping - use its APPLY"); return; }
      let cents = null;
      if (item.cents && typeof item.cents.length === "number" && item.cents.length > 0) {
        cents = Array.prototype.slice.call(item.cents, 0, 512);
      } else if (typeof item.text === "string" && item.text && typeof avTuneParseScl === "function") {
        let p = null;
        try { p = avTuneParseScl(item.text); } catch (e) { p = null; }
        if (p && p.ok && p.cents && typeof p.cents.length === "number" && p.cents.length > 0) cents = Array.prototype.slice.call(p.cents, 0, 512);
      }
      if (!cents || !cents.length) { fin(null, "the entry has no scale data"); return; }
      const res = {
        id: id,
        name: (typeof item.name === "string" && item.name) ? item.name : id,
        kind: (item.kind === "builtin") ? "builtin" : "scl",
        cents: cents,
      };
      s.res[id] = res;
      fin(res, "");
    });
  } catch (e) {
    fin(null, avTuneUiErrText(e, "the tuning could not be resolved"));
  }
}

/* a stored .kbm item -> the opts object avTuneBuildTable understands (present fields only) */
function avTuneUiKbmFromItem(item) {
  try {
    if (!item || typeof item !== "object") return null;
    if (item.chain && typeof item.chain.length === "number" && item.chain.length > 0) {
      const o = { chain: Array.prototype.slice.call(item.chain) };
      const fields = ["refNote", "refHz", "mapSize", "middleNote", "firstMidi", "lastMidi"];
      for (let i = 0; i < fields.length; i++) {
        const n = Number(item[fields[i]]);
        if (isFinite(n)) o[fields[i]] = n;
      }
      return o;
    }
    if (typeof item.text === "string" && item.text && typeof avTuneParseKbm === "function") {
      let p = null;
      try { p = avTuneParseKbm(item.text); } catch (e) { p = null; }
      if (p && p.ok === true) {
        return { chain: p.chain, refNote: p.refNote, refHz: p.refHz, mapSize: p.mapSize, middleNote: p.middleNote, firstMidi: p.firstMidi, lastMidi: p.lastMidi };
      }
    }
  } catch (e) { /* unreadable */ }
  return null;
}

/* id -> { offs, name, id } : build (root) + morph; the attached mapping applies to the global
   build (and only that build). cb exactly once, never thrown outward. */
function avTuneUiBuildOffs(id, useMap, cb) {
  const done = { v: false };
  const fin = function (res, err) {
    if (done.v) return;
    done.v = true;
    try { cb(res || null, err || ""); } catch (e) { /* settled */ }
  };
  try {
    avTuneUiResolve(id, function (res, rErr) {
      try {
        if (!res) { fin(null, rErr || "unresolved"); return; }
        if (typeof avTuneBuildTable !== "function") { fin(null, "the tuning core (av_tune.js) is not present"); return; }
        const s = avTuneUiState;
        const run = function (kbm, warn) {
          try {
            let table = null;
            const tuning = { cents: res.cents };
            if (kbm) {
              if (kbm.chain) tuning.chain = kbm.chain;
              if (isFinite(Number(kbm.refNote))) tuning.refNote = Number(kbm.refNote);
              if (isFinite(Number(kbm.refHz))) tuning.refHz = Number(kbm.refHz);
              if (isFinite(Number(kbm.mapSize))) tuning.mapSize = Number(kbm.mapSize);
              if (isFinite(Number(kbm.middleNote))) tuning.middleNote = Number(kbm.middleNote);
            }
            try { table = avTuneBuildTable(tuning, { root: Math.round(avTuneUiClamp(s.root, 0, 127)) }); } catch (e) { table = null; }
            const t = avTuneUiAsTable(table);
            if (!t) { fin(null, "the core refused to build a table for " + id); return; }
            let offs = t;
            let morphWarn = "";
            if (s.morph < 100) {
              if (typeof avTuneMorph === "function") {
                let m = null;
                try { m = avTuneMorph(t, avTuneUiClamp(s.morph / 100, 0, 1)); } catch (e) { m = null; }
                const mm = avTuneUiAsTable(m);
                if (mm) offs = mm; else morphWarn = " (morph skipped - the core refused)";
              } else {
                morphWarn = " (morph skipped - avTuneMorph is not present)";
              }
            }
            fin({ offs: offs, id: id, name: (res.name || id) + morphWarn }, "");
          } catch (e) { fin(null, avTuneUiErrText(e, "the build failed")); }
        };
        if (!useMap || !s.map) { run(null, ""); return; }
        if (s.mapCache && s.mapCache.id === s.map) { run(s.mapCache.opts, ""); return; }
        if (typeof avTuneLibraryLoad !== "function") { run(null, "map"); return; }
        let out = null;
        try { out = avTuneLibraryLoad(s.map); } catch (e) { run(null, "map"); return; }
        avTuneUiSettle(out, function (item) {
          const opts = avTuneUiKbmFromItem(item);
          if (opts) s.mapCache = { id: s.map, opts: opts };
          run(opts, "");
        });
      } catch (e) { fin(null, avTuneUiErrText(e, "the build failed")); }
    });
  } catch (e) { fin(null, avTuneUiErrText(e, "the build failed")); }
}

/* when an upload cannot land (engine not ready), re-apply once the engine boots */
function avTuneUiRequestEngineReplay() {
  try {
    const s = avTuneUiState;
    if (s.replayPending) return false;
    if (typeof avEngineEnsure !== "function") return false;
    s.replayPending = true;
    const p = avEngineEnsure();
    if (p && typeof p.then === "function") {
      p.then(function (h) {
        s.replayPending = false;
        if (h) avTuneUiApplySelection("engine ready");
      }, function () { s.replayPending = false; });
    } else {
      s.replayPending = false;
    }
    return true;
  } catch (e) { return false; }
}

/* upload one tuning's table to a slot: build -> morph -> avEngineTune(slot, offs, <id>) */
function avTuneUiUpload(id, slot, useMap, cb) {
  const done = { v: false };
  const fin = function (ok, err) {
    if (done.v) return;
    done.v = true;
    try { cb(!!ok, err || ""); } catch (e) { /* settled */ }
  };
  try {
    avTuneUiBuildOffs(id, useMap, function (r, err) {
      try {
        if (!r) { fin(false, err || "the build refused"); return; }
        const s = avTuneUiState;
        if (typeof avEngineTune !== "function") { fin(false, "the engine (av_engine.js) is not present"); return; }
        let sent = false;
        try { sent = (avEngineTune(slot, r.offs, r.id) !== false); } catch (e) { sent = false; }
        const sl = (slot >= 0 && slot < s.slots.length) ? s.slots[slot] : null;
        if (sl && sl.id === id) sl.sent = sent;
        if (!sent) { avTuneUiRequestEngineReplay(); fin(false, "the engine is not ready yet - the tuning re-applies when it boots"); return; }
        fin(true, "");
      } catch (e) { fin(false, avTuneUiErrText(e, "the upload failed")); }
    });
  } catch (e) { fin(false, avTuneUiErrText(e, "the upload failed")); }
}

function avTuneUiActivate(slot) {
  try {
    if (typeof avEngineTuneActive !== "function") return false;
    return avEngineTuneActive(slot) !== false;
  } catch (e) { return false; }
}

function avTuneUiActivateGlobal() {
  const s = avTuneUiState;
  const g = avTuneUiSlotForId(s.sel);
  if (g >= 0) { avTuneUiActivate(g); return true; }
  avTuneUiApplySelection("mts off");
  return true;
}

function avTuneUiReceipt(why, g) {
  const s = avTuneUiState;
  const parts = [];
  for (let i = 0; i < AV_TUNE_UI_TRACKS; i++) {
    if (s.tracks[i]) parts.push("p" + (i + 1) + "=" + s.tracks[i]);
  }
  return (why === "init" ? "TUNE ready - " : "") + "tuning " + s.sel + " - slot " + g +
    " - root " + avTuneUiRootLabel(s.root) + " - morph " + Math.round(s.morph) + "%" +
    (parts.length ? " - " + parts.join(" ") : "");
}

/* upload every in-use tuning (global first, then tracks), then activate the global slot
   (slot 7 while MTS live holds a table). Each upload settles once; the receipt is the last
   settled line (errors win with the first error text). Never throws. */
function avTuneUiApplySelection(why) {
  try {
    const s = avTuneUiState;
    const g = avTuneUiEnsureSlot(s.sel);
    if (g < 0) { avTuneUiSetStatus(AV_TUNE_UI_BUSY, "err"); return false; }
    const jobs = [{ id: s.sel, slot: g, cap: "" }];
    const doneSlots = {};
    doneSlots[g] = 1;
    let refusedBusy = false;
    for (let i = 0; i < AV_TUNE_UI_TRACKS; i++) {
      const id = s.tracks[i];
      if (!id) continue;
      const slot = avTuneUiEnsureSlot(id);
      if (slot < 0) { refusedBusy = true; continue; }
      if (doneSlots[slot]) continue;
      doneSlots[slot] = 1;
      jobs.push({ id: id, slot: slot, cap: "part " + (i + 1) });
    }
    let pending = jobs.length;
    let firstErr = refusedBusy ? AV_TUNE_UI_BUSY : "";
    const one = function (ok, err) {
      if (!ok && err && !firstErr) firstErr = err;
      pending -= 1;
      if (pending > 0) return;
      if (firstErr) { avTuneUiSetStatus("tuning apply refused - " + firstErr, "err"); return; }
      avTuneUiSetStatus(avTuneUiReceipt(why, g), "msg");
    };
    for (let j = 0; j < jobs.length; j++) {
      const job = jobs[j];
      avTuneUiUpload(job.id, job.slot, true, (function (jj) {
        return function (ok, err) {
          if (jj === 0) {
            const want = (avTuneUiState.mts && avTuneUiState.mtsTable) ? AV_TUNE_UI_MTS_SLOT : g;
            avTuneUiActivate(want);
          }
          one(ok, err);
        };
      })(j));
    }
    return true;
  } catch (e) {
    try { avTuneUiState.lastError = String((e && e.message) || e); } catch (e2) { /* ok */ }
    return false;
  }
}

/* ---------- the MTS live receive (the av_midi.js passive hook) ---------- */

function avTuneUiMtsSink(bytes) {
  try {
    const b = bytes || [];
    const looksMts = b.length >= 5 && (b[1] & 0xff) === 0x7f && (b[3] & 0xff) === 0x08;
    if (!looksMts) {
      avTuneUiState.mtsIgnored += 1;
      return false;
    }
    return avTuneUiMtsApply(bytes);
  } catch (e) { return false; }
}

/* the device-free parse + apply chain (the rig calls this directly; also the live sink path).
   Scale/octave forms replace the slot-7 table; single-note forms merge into it. Unmorphed by
   design: a sender's tuning lands as sent. true = parsed AND the engine accepted it. */
function avTuneUiMtsApply(bytes) {
  const s = avTuneUiState;
  try {
    if (typeof avTuneMtsParse !== "function") {
      avTuneUiSetStatus("MTS: the tuning core (av_tune.js) is not present", "err");
      return false;
    }
    let r = null;
    try { r = avTuneMtsParse(bytes); } catch (e) { r = null; }
    if (!r || typeof r !== "object" || r.ok !== true) {
      const why = (r && typeof r.error === "string" && r.error) ? r.error : "malformed sysex";
      s.mtsError = why;
      avTuneUiSetStatus("MTS: refused - " + why, "err");
      avTuneUiPaintMts(avTuneUiHost());
      return false;
    }
    const cents = (r.cents && typeof r.cents.length === "number") ? r.cents : null;
    const notes = (r.notes && typeof r.notes.length === "number") ? r.notes : [];
    if (!cents || !cents.length) {
      s.mtsError = "no tuning data";
      avTuneUiSetStatus("MTS: refused - the message carried no tuning data", "err");
      avTuneUiPaintMts(avTuneUiHost());
      return false;
    }
    const scale = avTuneUiMtsScaleForm(r);
    if (scale) {
      s.mtsTable = avTuneUiMtsTable(r);
      s.mtsCount = notes.length;
    } else {
      if (!s.mtsTable) s.mtsTable = new Float32Array(128);
      const n = Math.min(notes.length, cents.length);
      let wrote = 0;
      for (let i = 0; i < n; i++) {
        const note = Math.round(Number(notes[i]));
        const c = Number(cents[i]);
        if (!isFinite(note) || !isFinite(c) || note < 0 || note > 127) continue;
        s.mtsTable[note] = c / 100;
        wrote += 1;
      }
      s.mtsCount = wrote;
    }
    s.mtsKind = String(r.kind || (scale ? "scale" : "note"));
    s.mtsAt = Date.now();
    s.mtsError = "";
    let up = false, act = false;
    if (typeof avEngineTune === "function") {
      try { up = (avEngineTune(AV_TUNE_UI_MTS_SLOT, s.mtsTable, AV_TUNE_UI_MTS_NAME) !== false); } catch (e) { up = false; }
    }
    if (up) act = avTuneUiActivate(AV_TUNE_UI_MTS_SLOT);
    s.mtsOk = !!(up && act);
    if (up && act) {
      avTuneUiSetStatus("MTS: " + s.mtsKind + " tuning - slot 7 - " + s.mtsCount + " note" + (s.mtsCount === 1 ? "" : "s"), "msg");
    } else {
      avTuneUiSetStatus("MTS: " + s.mtsKind + " tuning parsed but the engine did not accept the slot 7 upload", "err");
      avTuneUiRequestEngineReplay();
    }
    avTuneUiPaintMts(avTuneUiHost());
    return up && act;
  } catch (e) {
    try { s.mtsError = avTuneUiErrText(e, "the MTS apply failed"); } catch (e2) { /* ok */ }
    return false;
  }
}

function avTuneUiMtsRegister() {
  const s = avTuneUiState;
  s.mtsReg = false;
  if (typeof avMidiSetSysExSink !== "function") return false;
  try {
    avMidiSetSysExSink(function (bytes) { return avTuneUiMtsSink(bytes); });
    s.mtsReg = true;
  } catch (e) { s.mtsReg = false; }
  return s.mtsReg;
}

function avTuneUiMtsUnregister() {
  const s = avTuneUiState;
  s.mtsReg = false;
  if (typeof avMidiSetSysExSink !== "function") return false;
  try { avMidiSetSysExSink(null); return true; } catch (e) { return false; }
}

function avTuneUiMtsRequestSysex() {
  const s = avTuneUiState;
  if (s.sysexAsking) return false;
  if (s.sysexOk) { avTuneUiPaintMts(avTuneUiHost()); return true; }
  if (!avTuneUiHasWebMidi()) {
    s.sysexDenied = true;
    s.sysexError = "MTS needs Web MIDI";
    avTuneUiPaintMts(avTuneUiHost());
    return false;
  }
  s.sysexAsking = true;
  s.sysexError = "";
  avTuneUiPaintMts(avTuneUiHost());
  try {
    const p = navigator.requestMIDIAccess({ sysex: true });
    avTuneUiSettle(p, function (acc) {
      s.sysexAsking = false;
      const ok = !!(acc && acc.sysexEnabled !== false);
      s.sysexOk = ok;
      s.sysexDenied = !ok;
      s.sysexError = ok ? "" : "MTS needs SysEx permission";
      if (!ok) s.mtsError = s.sysexError;
      avTuneUiPaintMts(avTuneUiHost());
    });
  } catch (e) {
    s.sysexAsking = false;
    s.sysexOk = false;
    s.sysexDenied = true;
    s.sysexError = "MTS needs SysEx permission";
    avTuneUiPaintMts(avTuneUiHost());
  }
  return true;
}

/* the #av-tune-mts handler (and the init re-apply path). Returns the new toggle state. */
function avTuneMtsEnable(on) {
  const s = avTuneUiState;
  const want = !!on;
  try {
    s.mts = want;
    if (want) {
      avTuneUiMtsRegister();
      avTuneUiMtsRequestSysex();
      if (s.mtsTable && typeof avEngineTune === "function") {
        try {
          if (avEngineTune(AV_TUNE_UI_MTS_SLOT, s.mtsTable, AV_TUNE_UI_MTS_NAME) !== false) avTuneUiActivate(AV_TUNE_UI_MTS_SLOT);
        } catch (e) { /* engine refused - the status line says so below */ }
      }
      avTuneUiSetStatus("MTS live receive on - incoming tunings write slot 7", "msg");
    } else {
      avTuneUiMtsUnregister();
      avTuneUiActivateGlobal();
      avTuneUiSetStatus("MTS live receive off - the global slot is active again", "msg");
    }
    avTuneUiPersist();
    avTuneUiPaintMts(avTuneUiHost());
    return s.mts;
  } catch (e) {
    try { s.lastError = String((e && e.message) || e); } catch (e2) { /* ok */ }
    return s.mts;
  }
}

/* ---------- the sched's per-note lookup (PIN: side-effect free, never throws) ---------- */

function avTuneTrackSlot(trackIndex) {
  try {
    const s = avTuneUiState;
    if (!s.inited) return undefined;
    const t = Math.round(Number(trackIndex));
    if (!isFinite(t) || t < 0 || t >= AV_TUNE_UI_TRACKS) return undefined;
    const id = s.tracks[t];
    if (!id) return undefined;
    const slot = avTuneUiSlotForId(id);
    return (slot >= 0 && slot <= AV_TUNE_UI_SLOT_MAX) ? slot : undefined;
  } catch (e) { return undefined; }
}

/* ---------- selection changes ---------- */

function avTuneUiSetSel(id) {
  const s = avTuneUiState;
  try {
    const next = String(id || AV_TUNE_UI_EQUAL_ID);
    if (next === s.sel) { return true; }
    const prev = s.sel;
    s.sel = next;
    if (avTuneUiEnsureSlot(next) < 0) {
      s.sel = prev;
      avTuneUiSetStatus(AV_TUNE_UI_BUSY + " - selection kept", "err");
      avTuneUiPaintSelects(avTuneUiHost());
      return false;
    }
    avTuneUiApplySelection("scale");
    avTuneUiPaintSelects(avTuneUiHost());       /* a library APPLY must show in the select too */
    avTuneUiPersist();
    return true;
  } catch (e) { return false; }
}

function avTuneUiSetTrack(i, id) {
  const s = avTuneUiState;
  try {
    const idx = Math.round(Number(i));
    if (!isFinite(idx) || idx < 0 || idx >= AV_TUNE_UI_TRACKS) return false;
    const next = String(id || "");
    if (next === s.tracks[idx]) return true;
    const prev = s.tracks[idx];
    s.tracks[idx] = next;
    if (next && avTuneUiEnsureSlot(next) < 0) {
      s.tracks[idx] = prev;
      avTuneUiSetStatus(AV_TUNE_UI_BUSY, "err");
      avTuneUiPaintSelects(avTuneUiHost());
      return false;
    }
    avTuneUiApplySelection("part " + (idx + 1));
    avTuneUiPaintSelects(avTuneUiHost());
    avTuneUiPersist();
    return true;
  } catch (e) { return false; }
}

function avTuneUiSetRoot(midi) {
  const s = avTuneUiState;
  try {
    const r = Math.round(Number(midi));
    if (!isFinite(r)) return false;
    s.root = Math.round(avTuneUiClamp(r, AV_TUNE_UI_ROOT_MIN, AV_TUNE_UI_ROOT_MAX));
    avTuneUiApplySelection("root");
    avTuneUiPersist();
    return true;
  } catch (e) { return false; }
}

function avTuneUiSetMorph(v, live) {
  const s = avTuneUiState;
  try {
    s.morph = Math.round(avTuneUiClamp(Number(v), 0, 100));
    avTuneUiPaintMorph(avTuneUiHost());
    if (live) {
      avTuneUiMorphLive();
    } else {
      avTuneUiApplySelection("morph");
      avTuneUiPersist();
    }
    return true;
  } catch (e) { return false; }
}

/* live morph: one re-upload per frame at most while the range is dragged */
function avTuneUiMorphLive() {
  const s = avTuneUiState;
  try {
    if (s.morphRaf) return true;
    const w = avTuneUiWin();
    if (w && typeof w.requestAnimationFrame === "function") {
      s.morphRaf = w.requestAnimationFrame(function () {
        s.morphRaf = 0;
        avTuneUiApplySelection("morph");
      });
      return true;
    }
  } catch (e) { /* no raf */ }
  avTuneUiApplySelection("morph");
  return true;
}

/* ---------- library ---------- */

function avTuneUiLibListed(r) {
  const s = avTuneUiState;
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
    let count = null;
    if (typeof e.count === "number" && isFinite(e.count)) count = Math.round(e.count);
    else if (e.cents && typeof e.cents.length === "number") count = e.cents.length;
    const row = {
      id: id,
      name: (typeof e.name === "string" && e.name) ? e.name : "tuning",
      kind: (typeof e.kind === "string" && e.kind) ? e.kind : "scl",
      count: count,
      mapSize: (typeof e.mapSize === "number" && isFinite(e.mapSize)) ? Math.round(e.mapSize) : null,
    };
    out.push(row);
  }
  s.lib = out;
  s.lastLibErr = err;
  avTuneUiPaintLib(avTuneUiHost());
  avTuneUiPaintSelects(avTuneUiHost());
  /* a selected/assigned id that vanished from a SUCCESSFUL list falls back honestly */
  if (!err) {
    let selBad = false;
    if (s.sel && s.sel !== AV_TUNE_UI_EQUAL_ID) {
      let known = false;
      try {
        if (typeof avTuneBuiltin === "function" && avTuneBuiltin(s.sel)) known = true;
      } catch (e) { /* not a builtin */ }
      if (!known) known = !!out.find(e => e.id === s.sel);
      if (!known) selBad = true;
    }
    if (selBad) { s.sel = AV_TUNE_UI_EQUAL_ID; s.map = ""; s.mapCache = null; avTuneUiApplySelection("library changed"); avTuneUiPersist(); }
    for (let i = 0; i < AV_TUNE_UI_TRACKS; i++) {
      const id = s.tracks[i];
      if (!id) continue;
      let known = false;
      try {
        if (typeof avTuneBuiltin === "function" && avTuneBuiltin(id)) known = true;
      } catch (e) { /* not a builtin */ }
      if (!known) known = !!out.find(e => e.id === id);
      if (!known) { s.tracks[i] = ""; avTuneUiApplySelection("library changed"); avTuneUiPersist(); }
    }
  }
}

function avTuneUiLibRefresh() {
  const s = avTuneUiState;
  try {
    if (typeof avTuneLibraryList !== "function") {
      s.lastLibErr = "the library lives in av_tune.js (not present)";
      s.lib = [];
      avTuneUiPaintLib(avTuneUiHost());
      return false;
    }
    const out = avTuneLibraryList();
    avTuneUiSettle(out, avTuneUiLibListed);
    return true;
  } catch (e) {
    s.lastLibErr = avTuneUiErrText(e, "the library list failed");
    return false;
  }
}

function avTuneUiLibFind(id) {
  try {
    for (let i = 0; i < avTuneUiState.lib.length; i++) {
      if (avTuneUiState.lib[i] && avTuneUiState.lib[i].id === id) return avTuneUiState.lib[i];
    }
  } catch (e) { /* none */ }
  return null;
}

function avTuneUiLibApply(id) {
  const s = avTuneUiState;
  try {
    const row = avTuneUiLibFind(id);
    if (!row) { avTuneUiSetStatus("library apply refused - no row " + id, "err"); return false; }
    if (row.kind === "kbm") {
      s.map = id;
      s.mapCache = null;
      avTuneUiApplySelection("map");
      avTuneUiPersist();
      avTuneUiSetStatus("keyboard mapping " + row.name + " attached to " + s.sel, "msg");
      return true;
    }
    return avTuneUiSetSel(id);
  } catch (e) { return false; }
}

function avTuneUiLibDelete(id) {
  const s = avTuneUiState;
  try {
    if (typeof avTuneLibraryDelete !== "function") {
      avTuneUiSetStatus("the tuning core (av_tune.js) is not present - library actions are unavailable", "err");
      return false;
    }
    avTuneUiSetStatus("deleting " + id + "...", "msg");
    let out = null;
    try { out = avTuneLibraryDelete(id); } catch (e) { out = { ok: false, error: avTuneUiErrText(e, "the delete failed") }; }
    avTuneUiSettle(out, function (r) {
      const ok = (r === true) || (r && typeof r === "object" && r.ok === true) ||
        (r && typeof r === "object" && typeof r.error === "undefined" && typeof r.ok === "undefined");
      if (!ok) {
        avTuneUiSetStatus("library delete refused - " + avTuneUiErrText(r, "the core refused"), "err");
        return false;
      }
      try { delete s.res[id]; } catch (e) { /* none */ }
      if (s.map === id) { s.map = ""; s.mapCache = null; }
      if (s.sel === id) { s.sel = AV_TUNE_UI_EQUAL_ID; avTuneUiApplySelection("delete"); }
      for (let i = 0; i < AV_TUNE_UI_TRACKS; i++) {
        if (s.tracks[i] === id) s.tracks[i] = "";
      }
      avTuneUiPersist();
      avTuneUiLibRefresh();
      avTuneUiSetStatus("deleted " + id + " from the library", "msg");
      return true;
    });
    return true;
  } catch (e) { return false; }
}

/* ---------- import / export ---------- */

function avTuneUiNewId(kind) {
  try {
    avTuneUiState.seq += 1;
    return String(kind || "scl") + "-" + Date.now().toString(36) + "-" + avTuneUiState.seq.toString(36);
  } catch (e) { return "scl-entry"; }
}

function avTuneUiItemName(kind, fileName, scl, kbm) {
  try {
    if (kind === "scl" && scl && typeof scl.name === "string" && scl.name.trim()) return scl.name.trim().slice(0, 48);
  } catch (e) { /* stem */ }
  const stem = avTuneUiFileStem(fileName);
  return stem || (kind + " entry");
}

function avTuneUiReadText(file) {
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

async function avTuneUiImportFile(file) {
  const s = avTuneUiState;
  try {
    if (!file) return false;
    const name = String(file.name || "");
    if (typeof avTuneParseScl !== "function" && typeof avTuneParseKbm !== "function") {
      avTuneUiSetStatus("the tuning core (av_tune.js) is not present - IMPORT is unavailable", "err");
      return false;
    }
    avTuneUiSetStatus("importing " + (name || "file") + "...", "msg");
    const text = await avTuneUiReadText(file);
    let scl = null, kbm = null;
    try { if (typeof avTuneParseScl === "function") scl = avTuneParseScl(text); } catch (e) { scl = null; }
    try { if (typeof avTuneParseKbm === "function") kbm = avTuneParseKbm(text); } catch (e) { kbm = null; }
    const kind = avTuneUiSniffKind(name, !!(scl && scl.ok), !!(kbm && kbm.ok));
    if (!kind) {
      const why = (scl && scl.error) ? scl.error : ((kbm && kbm.error) ? kbm.error : "not a Scala .scl or .kbm");
      avTuneUiSetStatus("import refused - " + why, "err");
      return false;
    }
    if (typeof avTuneLibrarySave !== "function") {
      avTuneUiSetStatus("the tuning core (av_tune.js) is not present - IMPORT is unavailable", "err");
      return false;
    }
    const item = {
      id: avTuneUiNewId(kind),
      name: avTuneUiItemName(kind, name, scl, kbm),
      kind: kind,
      text: String(text == null ? "" : text),
      at: Date.now(),
      v: 1,
    };
    if (kind === "scl") {
      item.cents = (scl.cents || []).slice(0, 512);
    } else {
      item.chain = (kbm.chain || []).slice(0, 512);
      if (isFinite(Number(kbm.mapSize))) item.mapSize = Math.round(Number(kbm.mapSize));
      if (isFinite(Number(kbm.firstMidi))) item.firstMidi = Math.round(Number(kbm.firstMidi));
      if (isFinite(Number(kbm.lastMidi))) item.lastMidi = Math.round(Number(kbm.lastMidi));
      if (isFinite(Number(kbm.middleNote))) item.middleNote = Math.round(Number(kbm.middleNote));
      if (isFinite(Number(kbm.refNote))) item.refNote = Math.round(Number(kbm.refNote));
      if (isFinite(Number(kbm.refHz))) item.refHz = Number(kbm.refHz);
    }
    let out = null;
    try { out = avTuneLibrarySave(item); }
    catch (e) { out = { ok: false, error: avTuneUiErrText(e, "the save failed") }; }
    return await new Promise(function (res) {
      avTuneUiSettle(out, function (rr) {
        const ok = (rr === true) || (rr && typeof rr === "object" && rr.ok === true) ||
          (rr && typeof rr === "object" && typeof rr.error === "undefined" && typeof rr.ok === "undefined");
        if (!ok) {
          avTuneUiSetStatus("import refused - " + avTuneUiErrText(rr, "the library refused the save"), "err");
          res(false);
          return;
        }
        avTuneUiLibRefresh();
        const detail = (kind === "scl")
          ? ("scl, " + (item.cents ? item.cents.length : 0) + " degrees")
          : ("kbm, " + (item.chain ? item.chain.length : 0) + " chain steps");
        avTuneUiSetStatus("imported " + item.name + " (" + detail + ") - press APPLY on its row", "msg");
        res(true);
      });
    });
  } catch (e) {
    avTuneUiSetStatus("import failed - " + avTuneUiErrText(e, "unexpected"), "err");
    return false;
  }
}

/* the house blob/anchor download law (the av_wt_ui shape, text/plain) */
function avTuneUiDownload(filename, text) {
  const w = avTuneUiWin();
  const d = avTuneUiDoc();
  if (!w || !d) return false;
  try {
    let url = "";
    if (typeof w.Blob === "function" && w.URL && typeof w.URL.createObjectURL === "function") {
      const blob = new w.Blob([text], { type: "text/plain;charset=utf-8" });
      url = w.URL.createObjectURL(blob);
    } else {
      url = "data:text/plain;charset=utf-8," + encodeURIComponent(text);
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

function avTuneUiDisplayName(id) {
  try {
    if (typeof avTuneBuiltin === "function") {
      const b = avTuneBuiltin(id);
      if (b && typeof b.name === "string" && b.name) return b.name;
    }
    if (avTuneUiState.res[id] && avTuneUiState.res[id].name) return avTuneUiState.res[id].name;
  } catch (e) { /* id */ }
  return id;
}

function avTuneUiExportReceipt(txt) {
  const s = avTuneUiState;
  if (typeof txt !== "string" || !txt) {
    avTuneUiSetStatus("export refused - the core returned no .scl text", "err");
    return false;
  }
  const fn = avTuneUiSanitizeFile(avTuneUiDisplayName(s.sel)) + ".scl";
  const ok = avTuneUiDownload(fn, txt);
  avTuneUiSetStatus(ok
    ? ("exported " + fn + " (" + txt.length + " chars)")
    : ("export built (" + txt.length + " chars) but the download could not start here"), ok ? "msg" : "err");
  return ok;
}

function avTuneUiActExport() {
  const s = avTuneUiState;
  try {
    if (typeof avTuneExportScl !== "function") {
      avTuneUiSetStatus("the tuning core (av_tune.js) is not present - EXPORT is unavailable", "err");
      return false;
    }
    let txt = null;
    try { txt = avTuneExportScl(s.sel); } catch (e) { txt = null; }
    if (txt && typeof txt.then === "function") {
      avTuneUiSetStatus("exporting...", "msg");
      avTuneUiSettle(txt, function (r) { avTuneUiExportReceipt(r); });
      return true;
    }
    return avTuneUiExportReceipt(txt);
  } catch (e) {
    avTuneUiSetStatus("export failed - " + avTuneUiErrText(e, "unexpected"), "err");
    return false;
  }
}

function avTuneUiActImport() {
  const host = avTuneUiHost();
  let input = null;
  try {
    input = (host && typeof host.querySelector === "function") ? host.querySelector("#av-tune-import-file") : null;
  } catch (e) { input = null; }
  if (!input || typeof input.click !== "function") {
    avTuneUiSetStatus("the import picker is not mounted", "err");
    return false;
  }
  try { input.value = ""; } catch (e) { /* ok */ }
  try { input.click(); return true; }
  catch (e) { avTuneUiSetStatus("the import picker refused to open", "err"); return false; }
}

/* ---------- event wiring (one delegation per host) ---------- */

function avTuneUiOnClick(ev) {
  try {
    const t = ev && ev.target;
    if (!t || typeof t.closest !== "function") return;
    let el;
    el = t.closest("#av-tune-import");
    if (el) { avTuneUiActImport(); return; }
    el = t.closest("#av-tune-export");
    if (el) { avTuneUiActExport(); return; }
    el = t.closest("[data-tune-act]");
    if (el) {
      const act = String(el.getAttribute("data-tune-act") || "");
      const id = String(el.getAttribute("data-tune-id") || "");
      if (act === "apply") avTuneUiLibApply(id);
      else if (act === "delete") avTuneUiLibDelete(id);
      return;
    }
  } catch (e) { /* a listener never throws outward */ }
}

function avTuneUiOnInput(ev) {
  try {
    const t = ev && ev.target;
    if (!t || t.id !== "av-tune-morph") return;
    avTuneUiSetMorph(t.value, true);
  } catch (e) { /* a listener never throws outward */ }
}

function avTuneUiOnChange(ev) {
  try {
    const t = ev && ev.target;
    if (!t || !t.id) return;
    if (t.id === "av-tune-scale") { avTuneUiSetSel(String(t.value || AV_TUNE_UI_EQUAL_ID)); return; }
    if (t.id === "av-tune-root") { avTuneUiSetRoot(t.value); return; }
    if (t.id === "av-tune-morph") { avTuneUiSetMorph(t.value, false); return; }
    const m = /^av-tune-track-([0-3])$/.exec(String(t.id));
    if (m) { avTuneUiSetTrack(Number(m[1]), String(t.value || "")); return; }
    if (t.id === "av-tune-mts") { avTuneMtsEnable(!!t.checked); return; }
    if (t.id === "av-tune-import-file") {
      const files = t.files;
      const f = (files && files.length) ? files[0] : null;
      if (f) avTuneUiImportFile(f);
      try { t.value = ""; } catch (e) { /* ok */ }
      return;
    }
  } catch (e) { /* a listener never throws outward */ }
}

function avTuneUiWireHost(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  try {
    if (host.dataset && host.dataset.avTuneWired === "1") return true;
    if (host.dataset) host.dataset.avTuneWired = "1";
    host.addEventListener("click", avTuneUiOnClick);
    host.addEventListener("input", avTuneUiOnInput);
    host.addEventListener("change", avTuneUiOnChange);
    return true;
  } catch (e) { return false; }
}

/* ---------- markup (pure string builder) ---------- */

function avTuneUiRootOptionsHTML() {
  let html = "";
  for (let m = AV_TUNE_UI_ROOT_MIN; m <= AV_TUNE_UI_ROOT_MAX; m++) {
    html += '<option value="' + m + '"' + (m === AV_TUNE_UI_ROOT_DEF ? " selected" : "") + ">" + avTuneUiEsc(avTuneUiRootLabel(m)) + "</option>";
  }
  return html;
}

function avTuneUiPaneHTML() {
  const s = avTuneUiState;
  let tracks = "";
  for (let i = 0; i < AV_TUNE_UI_TRACKS; i++) {
    tracks += '<span class="av-tune-track"><label class="av-tune-lbl" for="av-tune-track-' + i + '">PART ' + (i + 1) + "</label>" +
      '<select class="av-select av-tune-select" id="av-tune-track-' + i + '" aria-label="Tuning for part ' + (i + 1) + '"></select></span>';
  }
  return '<div class="av-tune" data-av-tune="1">' +
    '<div class="av-tune-head"><span class="av-tune-title">TUNE</span>' +
    '<span class="av-tune-cap av-dim">Scala .scl/.kbm scales, per-part tuning, MTS live receive. Everything stays on this machine.</span></div>' +
    '<div class="av-tune-status-line"><span class="av-tune-status av-tune-msg" id="av-tune-status" role="status" aria-live="polite">' + avTuneUiEsc(s.status) + "</span></div>" +
    '<div class="av-tune-row">' +
    '<label class="av-tune-lbl" for="av-tune-scale">SCALE</label>' +
    '<select class="av-select av-tune-select" id="av-tune-scale" aria-label="Global tuning scale"></select>' +
    '<label class="av-tune-lbl" for="av-tune-root">ROOT</label>' +
    '<select class="av-select av-tune-select" id="av-tune-root" aria-label="Root note (the scale 1/1 key)">' + avTuneUiRootOptionsHTML() + '</select>' +
    '<label class="av-tune-lbl" for="av-tune-morph">MORPH</label>' +
    '<input class="av-tune-range" id="av-tune-morph" type="range" min="0" max="100" step="1" value="' + Math.round(avTuneUiClamp(s.morph, 0, 100)) + '" aria-label="Morph between 12-EDO equal and the tuned scale">' +
    '<span class="av-tune-morph-val" id="av-tune-morph-val">' + Math.round(avTuneUiClamp(s.morph, 0, 100)) + "%</span></div>" +
    '<div class="av-tune-tracks">' + tracks + "</div>" +
    '<div class="av-tune-lib" id="av-tune-lib"><p class="av-note av-dim av-tune-lib-empty">library - import a .scl/.kbm to store it here</p></div>' +
    '<div class="av-tune-actions">' +
    '<button type="button" class="av-btn mini av-tune-btn" id="av-tune-import" title="read a Scala .scl scale or .kbm keyboard mapping into the library">IMPORT .SCL/.KBM</button>' +
    '<button type="button" class="av-btn mini av-tune-btn" id="av-tune-export" title="download the current global tuning as a .scl file">EXPORT .SCL</button>' +
    '<input class="av-tune-file" id="av-tune-import-file" type="file" accept=".scl,.kbm" data-av-tune-import hidden></div>' +
    '<div class="av-tune-mtsrow"><label class="av-tune-mtslbl" for="av-tune-mts">' +
    '<input class="av-tune-mtsbox" id="av-tune-mts" type="checkbox"' + (s.mts ? " checked" : "") + '> MTS LIVE RECEIVE</label>' +
    '<span class="av-tune-mts-status av-dim" id="av-tune-mts-status">' + avTuneUiEsc(avTuneUiMtsStatusNow()) + "</span></div>" +
    '<p class="av-note av-dim av-tune-note">0 = 12-EDO equal, 100 = the scale. Tracks play their own tuning (GLOBAL follows the scale). MTS writes slot 7 while it is on.</p>' +
    "</div>";
}

/* the parent's own `#av-tune` card element: this root only takes the id when no such element
   exists anywhere (never a duplicate id) - the av_files_ui idiom */
function avTuneUiEnsureRootId(pane) {
  try {
    if (!pane || pane.id) return false;
    const d = avTuneUiDoc();
    const existing = (d && typeof d.getElementById === "function") ? d.getElementById("av-tune") : null;
    if (existing && existing !== pane) return false;
    pane.id = "av-tune";
    return true;
  } catch (e) { return false; }
}

/* ---------- init / sync / snap / classes ---------- */

function avTuneUiInit() {
  const host = avTuneUiHost();
  if (!host) return false;
  try {
    const s = avTuneUiState;
    let pane = null;
    try { pane = (typeof host.querySelector === "function") ? host.querySelector(".av-tune") : null; } catch (e) { pane = null; }
    if (!pane) {
      s.memo = { text: {}, cls: {} };
      host.innerHTML = avTuneUiPaneHTML();
      try { pane = (typeof host.querySelector === "function") ? host.querySelector(".av-tune") : null; } catch (e2) { pane = null; }
    }
    avTuneUiEnsureRootId(pane);
    avTuneUiWireHost(host);
    s.mounts += 1;
    if (!s.inited) {
      avTuneUiPrefLoad();
      s.optSig = "";
      avTuneUiPaintSelects(host);
      s.inited = true;
      avTuneUiApplySelection("init");
      if (s.mts) {
        avTuneUiMtsRegister();
        avTuneUiMtsRequestSysex();
      }
    } else {
      avTuneUiPaintSelects(host);
    }
    avTuneUiLibRefresh();
    avTuneUiSync(host);
    if (typeof avTuneBuildTable !== "function") {
      avTuneUiSetStatus("the tuning core (av_tune.js) is not present - the card mounts and every action refuses honestly", "err");
    }
    return true;
  } catch (e) {
    try { avTuneUiState.lastError = String((e && e.message) || e); } catch (e2) { /* ok */ }
    return false;
  }
}

function avTuneUiSync(root) {
  let host = root || null;
  if (!host) host = avTuneUiHost();
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    avTuneUiPaintStatus(host);
    avTuneUiPaintMts(host);
    avTuneUiPaintMorph(host);
    avTuneUiPaintSelects(host);
    avTuneUiPaintLib(host);
    return true;
  } catch (e) { return false; }
}

function avTuneUiSnap() {
  const host = avTuneUiHost();
  const s = avTuneUiState;
  const out = {
    version: AV_TUNE_UI_VERSION,
    inited: !!s.inited,
    mounts: s.mounts,
    host: !!host,
    card: false,
    cores: avTuneUiCores(),
    sel: s.sel,
    root: s.root,
    morph: s.morph,
    tracks: s.tracks.slice(0, AV_TUNE_UI_TRACKS),
    map: s.map || "",
    slots: s.slots.map(function (sl) {
      return sl ? { id: sl.id, at: sl.at, sent: !!sl.sent } : null;
    }),
    mts: {
      on: !!s.mts, reg: !!s.mtsReg,
      asked: !!s.sysexAsking, ok: !!s.sysexOk, denied: !!s.sysexDenied,
      error: s.sysexError || "",
      kind: s.mtsKind, count: s.mtsCount, at: s.mtsAt, ignored: s.mtsIgnored,
      table: !!s.mtsTable, status: avTuneUiMtsStatusNow(),
    },
    lib: { count: s.lib.length, rows: s.lib.slice(0, 64), error: s.lastLibErr || "" },
    status: s.status,
    statusKind: s.statusKind,
    lastError: s.lastError || "",
    controls: {
      scale: false, root: false, morph: false, track0: false, track1: false, track2: false, track3: false,
      importBtn: false, importFile: false, exportBtn: false, lib: false, mts: false, status: false, mtsStatus: false,
    },
    classes: avTuneUiClasses(),
  };
  try {
    if (host && typeof host.querySelector === "function") {
      out.card = !!host.querySelector(".av-tune");
      const q = function (sel) { return !!host.querySelector(sel); };
      out.controls.scale = q("#av-tune-scale");
      out.controls.root = q("#av-tune-root");
      out.controls.morph = q("#av-tune-morph");
      out.controls.track0 = q("#av-tune-track-0");
      out.controls.track1 = q("#av-tune-track-1");
      out.controls.track2 = q("#av-tune-track-2");
      out.controls.track3 = q("#av-tune-track-3");
      out.controls.importBtn = q("#av-tune-import");
      out.controls.importFile = q("#av-tune-import-file");
      out.controls.exportBtn = q("#av-tune-export");
      out.controls.lib = q("#av-tune-lib");
      out.controls.mts = q("#av-tune-mts");
      out.controls.status = q("#av-tune-status");
      out.controls.mtsStatus = q("#av-tune-mts-status");
    }
  } catch (e) { /* no DOM */ }
  return out;
}

function avTuneUiClasses() {
  return AV_TUNE_UI_CLASSES.slice();
}

/* ---------- debug/verify handle (rigs + parent call these; names are the contract) ---------- */

if (typeof window !== "undefined") {
  try {
    const stateFn = function () { return avTuneUiSnap(); };
    try {
      Object.defineProperty(stateFn, "inited", { get: function () { return !!avTuneUiState.inited; } });
      Object.defineProperty(stateFn, "sel", { get: function () { return avTuneUiState.sel; } });
      Object.defineProperty(stateFn, "mts", { get: function () { return !!avTuneUiState.mts; } });
    } catch (e2) { /* getters are a nicety */ }
    window.__avTuneUi = {
      version: AV_TUNE_UI_VERSION,
      state: stateFn,
      init: function () { return avTuneUiInit(); },
      snap: function () { return avTuneUiSnap(); },
      classes: function () { return avTuneUiClasses(); },
      sync: function (root) { return avTuneUiSync(root); },
      mtsEnable: function (on) { return avTuneMtsEnable(on); },
      mtsApply: function (bytes) { return avTuneUiMtsApply(bytes); },
      trackSlot: function (i) { return avTuneTrackSlot(i); },
    };
  } catch (e) { /* no window - nothing to publish */ }
}
