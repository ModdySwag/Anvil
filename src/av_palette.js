/* av_palette.js — Anvil S5 command palette (#80) + the command registry (child sa-E).

   WHAT THIS IS — Ctrl-K anywhere: a fuzzy command palette over every feature of the instrument.
   `avPaletteInit()` mounts the overlay `#av-palette` (input + filtered list + group labels +
   footer), registers the ~40 core commands pinned in verify/_s5_wave.md §2.E, and wires the
   module's own listeners. The keyboard route is av_help.js's avUiKeyHook -> avPaletteKey only.

   LAWS preserved:
   - THE ONE document keydown law: this module NEVER adds a document keydown. Every key arrives
     through av_help's avUiKeyHook (contract §2.D) which calls avPaletteKey(e) FIRST and consumes
     when it returns true. The overlay-scoped keydown (bubble, deeper than document) is a
     fallback sighting of the same event — a marker on the event makes the second sighting a
     no-op, so nothing ever runs twice.
   - Esc stays claimed: this module consumes Esc only while the palette is open; otherwise Esc
     flows to av_kb unchanged (its blur / disarm / stop-loading chain).
   - mod+K works from inside text fields (pinned): the hook runs before av_kb's typing guard —
     it must, because the browser's own Ctrl+K would focus the omnibox otherwise.
   - ONE namespace (avPalette* / AV_PALETTE_*); every cross-module call is a one-line typeof
     guarded call (the module works alone; missing seams are an honest no-op).
   - node-loadable top level (no document/window reach until a function runs); never throws
     outward; no console noise (one warn only when a registered run genuinely throws).
   - Focus contract: focus goes to #av-palette-input on open; on close it is restored to the
     element that had it (guarded: only when still connected).
   - Mutual exclusion: avPaletteOpen() closes the help overlay first (guarded avHelpClose);
     the reverse rides the avUiKeyHook order plus the outside-click close below.

   PINS CONSUMED (all guarded): avPianoToggle (E-kb) · avSetInputMode (av_kb) · avSeqPlay /
   avSeqStop (av_seq_sched) · avLessonAction / avLessonRun / avWizRun (av_lessons, F) ·
   avHelpOpen / avHelpClose / avHelpTour|avHelpTour60 (av_help, D) · avMetroSet / avMetroState /
   avMetroCountIn (av_metro) · avProjSave (av_proj) · avCardShare (av_card) · avRecStart /
   avRecStop / avRecSnap (av_rec).

   OBSERVABLES: avPaletteInit() -> bool (idempotent) · avPaletteKey(e) -> true only when
   consumed · avPaletteOpen()/avPaletteClose() -> bool · avPaletteIsOpen() -> bool ·
   avPaletteRegister(cmd) -> bool ({id, label, hint?, group?, keys?, run, when?}) ·
   avPaletteCommands() -> sanitized copies ([{id,label,hint,group,keys}] — strings only, no
   functions leak) · avPaletteRun(id) -> bool · window.__avPalette = {version, open, close,
   isOpen, key, run, register, commands, filtered, score}.

   FULL ID INVENTORY (rig + parent rely on these):
     #av-palette (overlay) · #av-palette-input (placeholder "Type a command…") ·
     #av-palette-list (rows .av-palette-row[data-id][data-keys], option ids
     av-palette-opt-<id>) · #av-palette-foot ("↵ run · esc close").
   NEW CSS CLASSES (the parent styles them; full list in the report):
     av-palette · av-palette-box · av-palette-input · av-palette-list · av-palette-group ·
     av-palette-row · sel · av-palette-lbl · av-palette-hit · av-palette-keys ·
     av-palette-empty · av-palette-foot · av-palette-open (body while open) ·
     av-palette-flash (the Deliver RUN highlight, ~1.6 s).

   ONE writer (child sa-E). Scratch: cache/scratch/s5/e/. */

"use strict";

const AV_PALETTE_VERSION = "s5.0";
const AV_PALETTE_MAX_CMDS = 512;
const AV_PALETTE_MAX_ROWS = 120;      /* render cap per filter pass */
const AV_PALETTE_LABEL_CAP = 80;
const AV_PALETTE_HINT_CAP = 160;
const AV_PALETTE_KEYS_CAP = 32;
const AV_PALETTE_GROUP_CAP = 32;
const AV_PALETTE_FLASH_MS = 1600;     /* the Deliver RUN highlight dwell */
const AV_PALETTE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

const avPaletteState = {
  inited: false,
  open: false,
  cmds: [],               /* {id,label,hint,group,keys,run,when,order} — registration order */
  dom: null,              /* {overlay, input, list} once built */
  focusPrev: null,        /* the element focus returns to on close */
  query: "",
  sel: 0,
  selId: "",
  wiredDoc: false,
  flashTimer: null,
  lastRun: null,          /* {id, ok, note} — debug/verify readability */
};

/* ---------- the card list (the "open/close each card" commands — §2.E: scrollIntoView of
   #av-*). Store is NOT here: it has its own pinned command (F's store.open seam). The S5
   parent adds the #av-code card; until it exists the command is an honest no-op. ---------- */

const AV_PALETTE_CARDS = [
  { el: "av-levels", id: "card.levels", label: "Open Levels" },
  { el: "av-synth", id: "card.synth", label: "Open Synth" },
  { el: "av-fx", id: "card.fx", label: "Open FX Rack" },
  { el: "av-mod", id: "card.mod", label: "Open Mod Matrix" },
  { el: "av-midi-card", id: "card.midi", label: "Open MIDI" },
  { el: "av-drums", id: "card.drums", label: "Open Drums" },
  { el: "av-sample", id: "card.samples", label: "Open Samples" },
  { el: "av-rec", id: "card.rec", label: "Open Recorder" },
  { el: "av-seq", id: "card.seq", label: "Open Sequencer" },
  { el: "av-deliver", id: "card.deliver", label: "Open Deliver" },
  { el: "av-studio", id: "card.studio", label: "Open Studio" },
  { el: "av-sessions", id: "card.sessions", label: "Open Sessions" },
  { el: "av-comp", id: "card.comp", label: "Open Takes & Comping" },
  { el: "av-mix", id: "card.mix", label: "Open Mix & Master" },
  { el: "av-deck", id: "card.deck", label: "Open Deck" },
  { el: "av-files", id: "card.files", label: "Open Project & Share" },
  { el: "av-code", id: "card.code", label: "Open CODE" },
];

/* ---------- small helpers (pure; never throw) ---------- */

const avPaletteEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* strip control characters, trim, cap — the register() sanitizer */
function avPaletteClean(v, cap) {
  try {
    const s = String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
    return s.length > cap ? s.slice(0, cap) : s;
  } catch (e) { return ""; }
}

/* fuzzy subsequence match (case-insensitive; spaces in the query are ignored).
   Score: base per hit + consecutive-run bonus + word-start bonus + label-prefix bonus,
   minus a label-length penalty and a spread penalty. Deterministic; ties keep registration
   order. Returns {score, hits} (hits = indices into the RAW label, for the highlight) or
   null when the query is not a subsequence. */
function avPaletteMatch(label, query) {
  const L = String(label == null ? "" : label).toLowerCase();
  const q = String(query == null ? "" : query).toLowerCase().replace(/\s+/g, "");
  if (!q) return { score: 0, hits: [] };
  let li = 0, score = 0, last = -2;
  const hits = [];
  for (let i = 0; i < q.length; i++) {
    const ch = q.charAt(i);
    while (li < L.length && L.charAt(li) !== ch) li++;
    if (li >= L.length) return null;
    hits.push(li);
    score += 10;
    if (li === last + 1) score += 14;                                   /* consecutive run   */
    if (li === 0 || /[^a-z0-9]/.test(L.charAt(li - 1))) score += 20;    /* word start        */
    if (i === 0 && li === 0) score += 30;                               /* label prefix      */
    last = li;
    li++;
  }
  score -= Math.max(0, L.length - q.length) * 0.6;
  score -= Math.max(0, (hits[hits.length - 1] - hits[0]) - (q.length - 1)) * 0.4;
  return { score: score, hits: hits };
}

/* ---------- the registry ---------- */

/* when?(cmd): a command is visible/runnable only when its when() is not false. A throwing
   when() must not hide commands — treat as visible (honest default). */
function avPaletteWhenOK(entry) {
  try {
    if (entry && typeof entry.when === "function") return entry.when() !== false;
  } catch (e) { return true; }
  return true;
}

/* register (or update, by id) a command. Sanitized on the way in: id charset-checked, label
   required, strings capped. Returns true on success, false on any refusal. Pure registry op —
   no DOM needed, so it works before (and without) init. */
function avPaletteRegister(cmd) {
  try {
    if (!cmd || typeof cmd !== "object") return false;
    const id = avPaletteClean(cmd.id, 64);
    if (!id || !AV_PALETTE_ID_RE.test(id)) return false;
    const label = avPaletteClean(cmd.label, AV_PALETTE_LABEL_CAP);
    if (!label) return false;
    if (typeof cmd.run !== "function") return false;
    const entry = {
      id: id,
      label: label,
      hint: avPaletteClean(cmd.hint, AV_PALETTE_HINT_CAP),
      group: avPaletteClean(cmd.group, AV_PALETTE_GROUP_CAP) || "Commands",
      keys: avPaletteClean(cmd.keys, AV_PALETTE_KEYS_CAP),
      run: cmd.run,
      when: (typeof cmd.when === "function") ? cmd.when : null,
      order: avPaletteState.cmds.length,
    };
    const i = avPaletteState.cmds.findIndex(c => c.id === id);
    if (i >= 0) {
      entry.order = avPaletteState.cmds[i].order;    /* an update keeps its original slot */
      avPaletteState.cmds[i] = entry;
      return true;
    }
    if (avPaletteState.cmds.length >= AV_PALETTE_MAX_CMDS) return false;
    avPaletteState.cmds.push(entry);
    return true;
  } catch (e) { return false; }
}

/* sanitized copies — strings only; `run`/`when` never leak. Consumers (help's SHORTCUTS tab,
   rigs) get JSON-safe rows carrying the keys hint. Hidden (when() === false) rows excluded. */
function avPaletteCommands() {
  const out = [];
  try {
    for (let i = 0; i < avPaletteState.cmds.length; i++) {
      const c = avPaletteState.cmds[i];
      if (!avPaletteWhenOK(c)) continue;
      out.push({ id: c.id, label: c.label, hint: c.hint, group: c.group, keys: c.keys });
    }
  } catch (e) { /* a sanitized read never throws */ }
  return out;
}

/* the filtered list (the paint source + __avPalette.filtered). Empty query -> registration
   order; otherwise score-sorted (stable, registration order breaks ties), render-capped. */
function avPaletteFilterQuery(q0) {
  const out = [];
  try {
    const q = String(q0 == null ? "" : q0).trim();
    const src = avPaletteCommands();
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (!q) { out.push({ id: c.id, label: c.label, hint: c.hint, group: c.group, keys: c.keys, score: 0, hits: [] }); continue; }
      const m = avPaletteMatch(c.label, q);
      if (m) out.push({ id: c.id, label: c.label, hint: c.hint, group: c.group, keys: c.keys, score: m.score, hits: m.hits, order: i });
    }
    if (q) out.sort((a, b) => (b.score - a.score) || ((a.order || 0) - (b.order || 0)));
  } catch (e) { /* filter failures yield whatever was collected */ }
  return out.slice(0, AV_PALETTE_MAX_ROWS);
}

/* ---------- run ---------- */

/* run a command by id. Never throws; false for unknown / hidden / a run that reported false
   or threw. Does NOT touch the open/close state (the key path closes first, then runs). */
function avPaletteRun(id) {
  try {
    const key = String(id == null ? "" : id);
    const entry = avPaletteState.cmds.find(c => c.id === key);
    if (!entry) { avPaletteState.lastRun = { id: key, ok: false, note: "unknown command" }; return false; }
    if (!avPaletteWhenOK(entry)) { avPaletteState.lastRun = { id: key, ok: false, note: "unavailable" }; return false; }
    let ok = false;
    try {
      ok = entry.run() !== false;
    } catch (err) {
      ok = false;
      try { if (typeof console !== "undefined" && console && typeof console.warn === "function") console.warn("[anvil] palette command failed", key, err); } catch (e2) { /* no console */ }
    }
    avPaletteState.lastRun = { id: key, ok: ok === true, note: ok === true ? "" : "no-op" };
    return ok === true;
  } catch (e) { return false; }
}

/* ---------- core command run helpers (one guarded seam each) ---------- */

/* scroll a card into view. Instant (no smooth scrolling): deterministic for the rigs and the
   user lands exactly where the command says. */
function avPaletteCardGo(elId) {
  try {
    if (typeof document === "undefined" || !document) return false;
    const el = document.getElementById(elId);
    if (!el || typeof el.scrollIntoView !== "function") return false;
    if (typeof avZoneReveal === "function") { try { avZoneReveal(el); } catch (e1) { /* reveal is best-effort */ } }
    el.scrollIntoView({ block: "start" });
    return true;
  } catch (e) { return false; }
}

/* open store — F's store.open seam first; fallback: scroll the store card into view */
function avPaletteStoreOpen() {
  let ok = false;
  try {
    if (typeof avLessonAction === "function") {
      const r = avLessonAction("store.open");
      ok = !!(r && r.ok === true);
    }
  } catch (e) { ok = false; }
  if (!ok) ok = avPaletteCardGo("av-store");
  return ok;
}

/* the Deliver RUN highlight (lesson seam first; local fallback: scroll + flash the button) */
function avPaletteDeliverFlash() {
  try {
    if (typeof document === "undefined" || !document) return false;
    const card = document.getElementById("av-deliver");
    if (card && typeof card.scrollIntoView === "function") card.scrollIntoView({ block: "start" });
    const run = document.getElementById("av-deliver-run");
    if (run && run.classList) {
      run.classList.add("av-palette-flash");
      if (avPaletteState.flashTimer && typeof clearTimeout === "function") clearTimeout(avPaletteState.flashTimer);
      if (typeof setTimeout === "function") {
        avPaletteState.flashTimer = setTimeout(function () {
          try { run.classList.remove("av-palette-flash"); } catch (e) { /* node left */ }
        }, AV_PALETTE_FLASH_MS);
      }
    }
    return true;
  } catch (e) { return false; }
}

function avPaletteDeliverHighlight() {
  let ok = false;
  try {
    if (typeof avLessonAction === "function") {
      const r = avLessonAction("deliver.highlight");
      ok = !!(r && r.ok === true);
    }
  } catch (e) { ok = false; }
  if (!ok) ok = avPaletteDeliverFlash();
  return ok;
}

/* toggle the metronome — read honestly, then flip through the pinned setter */
function avPaletteMetroToggle() {
  try {
    if (typeof avMetroSet !== "function") return false;
    let on = false;
    try {
      if (typeof avMetroState === "function") {
        const st = avMetroState();
        on = !!(st && st.on === true);
      }
    } catch (e) { on = false; }
    avMetroSet({ on: !on });
    return true;
  } catch (e) { return false; }
}

/* one bar of count-in. The metro has no cancel seam, so while a count-in is already running
   this is an honest no-op (the running one keeps ticking). */
function avPaletteCountIn() {
  try {
    if (typeof avMetroCountIn !== "function") return false;
    try {
      if (typeof avMetroState === "function") {
        const st = avMetroState();
        if (st && st.countIn && st.countIn.active === true) return false;
      }
    } catch (e) { /* state read failed — still try to start */ }
    avMetroCountIn(1);
    return true;
  } catch (e) { return false; }
}

/* start / stop the S1 recorder (the master-output WAV recorder) */
function avPaletteRecToggle() {
  try {
    let recording = false;
    try {
      if (typeof avRecSnap === "function") {
        const s = avRecSnap();
        recording = !!(s && s.recording === true);
      }
    } catch (e) { recording = false; }
    if (recording) {
      if (typeof avRecStop === "function") { avRecStop(); return true; }
      return false;
    }
    if (typeof avRecStart === "function") {
      const r = avRecStart();
      return !(r && r.ok === false);     /* a refusal ({ok:false,error…}) stays a refusal */
    }
    return false;
  } catch (e) { return false; }
}

/* the 60-second tour — D's seam. Preferred name avHelpTour60; §2.D's avHelpTour() with no
   args is the tolerant second attempt (built-in tour). */
function avPaletteStartTour() {
  try {
    if (typeof avHelpTour60 === "function") { avHelpTour60(); return true; }
  } catch (e) { /* fall through to the generic seam */ }
  try {
    if (typeof avHelpTour === "function") { avHelpTour(); return true; }
  } catch (e2) { /* no tour seam */ }
  return false;
}

/* ---------- the core commands (§2.E pins; registered by init; works-alone guarded) ---------- */

function avPaletteCoreCommands() {
  const cmds = [
    { id: "piano.toggle", label: "Toggle piano", group: "Piano", keys: "Y",
      hint: "Show / hide the 61-key piano dock",
      run: () => { if (typeof avPianoToggle === "function") { avPianoToggle(); return true; } return false; } },
    { id: "input.studio", label: "Input: Studio", group: "Input", keys: "Ctrl+Alt+1",
      hint: "Typing keys stay quiet (letters do nothing)",
      run: () => { if (typeof avSetInputMode === "function") { avSetInputMode("studio"); return true; } return false; } },
    { id: "input.keys", label: "Input: Keys", group: "Input", keys: "Ctrl+Alt+2",
      hint: "Typing keys play the dock (A-row white, W-row black)",
      run: () => { if (typeof avSetInputMode === "function") { avSetInputMode("keys"); return true; } return false; } },
    { id: "input.midi", label: "Input: MIDI", group: "Input", keys: "Ctrl+Alt+3",
      hint: "The hardware plays; PC letters stay quiet",
      run: () => { if (typeof avSetInputMode === "function") { avSetInputMode("midi"); return true; } return false; } },
    { id: "transport.play", label: "Play transport", group: "Transport",
      hint: "Start the step-sequencer transport",
      run: () => { if (typeof avSeqPlay === "function") { avSeqPlay(); return true; } return false; } },
    { id: "transport.stop", label: "Stop transport", group: "Transport",
      hint: "Halt and rewind the transport",
      run: () => { if (typeof avSeqStop === "function") { avSeqStop(); return true; } return false; } },
  ];
  /* R1: the cockpit zones — one command per station (Alt+1..8 in the same order) */
  if (typeof AV_ZONES !== "undefined" && AV_ZONES && AV_ZONES.length) {
    for (let zi = 0; zi < AV_ZONES.length; zi++) {
      const z = AV_ZONES[zi];
      cmds.push({
        id: "zone." + z.id, label: "Go: " + z.label, group: "Zones", keys: "Alt+" + (zi + 1),
        hint: z.hint || ("Switch to the " + z.label + " zone"),
        run: () => (typeof avZoneShow === "function" ? avZoneShow(z.id, { source: "palette" }) : false),
      });
    }
  }
  /* R3: the float workspace — reset + two curated layouts */
  if (typeof avPanelsReset === "function") {
    cmds.push(
      { id: "panels.reset", label: "Workspace: reset layout", group: "Workspace",
        hint: "Bring every floated module home", run: () => avPanelsReset() },
      { id: "panels.sounddesign", label: "Workspace: sound design", group: "Workspace",
        hint: "Float Synth + FM + Mod + FX for a sound-design desk",
        run: () => (typeof avPanelsLayout === "function" ? avPanelsLayout("sounddesign") : false) },
      { id: "panels.mixdown", label: "Workspace: mixdown", group: "Workspace",
        hint: "Float Mix + Deck + FX for a mixdown desk",
        run: () => (typeof avPanelsLayout === "function" ? avPanelsLayout("mixdown") : false) }
    );
  }
  for (let i = 0; i < AV_PALETTE_CARDS.length; i++) {
    const c = AV_PALETTE_CARDS[i];
    cmds.push({
      id: c.id, label: c.label, group: "Cards",
      hint: "Scroll the card into view",
      run: () => avPaletteCardGo(c.el),
    });
  }
  cmds.push(
    { id: "groove.demo", label: "Load demo groove", group: "Groove",
      hint: "Load the 4-track demo pattern (the lesson seam loads it)",
      run: () => { if (typeof avLessonAction === "function") { const r = avLessonAction("seq.loadDemo"); return !!(r && r.ok === true); } return false; } },
    { id: "lesson.first-beat", label: "Lesson: first beat", group: "Lessons",
      hint: "Walkthrough — get your first beat",
      run: () => { if (typeof avLessonRun === "function") { avLessonRun("first-beat"); return true; } return false; } },
    { id: "lesson.acid-line", label: "Lesson: acid line", group: "Lessons",
      hint: "Walkthrough — make an acid line",
      run: () => { if (typeof avLessonRun === "function") { avLessonRun("acid-line"); return true; } return false; } },
    { id: "lesson.sample-chop", label: "Lesson: sample chop", group: "Lessons",
      hint: "Walkthrough — chop a sample",
      run: () => { if (typeof avLessonRun === "function") { avLessonRun("sample-chop"); return true; } return false; } },
    { id: "lesson.stems-export", label: "Lesson: stems export", group: "Lessons",
      hint: "Walkthrough — export stems to your DAW",
      run: () => { if (typeof avLessonRun === "function") { avLessonRun("stems-export"); return true; } return false; } },
    { id: "wiz.bass", label: "Wizard: bass", group: "Wizards",
      hint: "Sound wizard — three choices, then audition",
      run: () => { if (typeof avWizRun === "function") { avWizRun("bass"); return true; } return false; } },
    { id: "wiz.pad", label: "Wizard: pad", group: "Wizards",
      hint: "Sound wizard — three choices, then audition",
      run: () => { if (typeof avWizRun === "function") { avWizRun("pad"); return true; } return false; } },
    { id: "wiz.pluck", label: "Wizard: pluck", group: "Wizards",
      hint: "Sound wizard — three choices, then audition",
      run: () => { if (typeof avWizRun === "function") { avWizRun("pluck"); return true; } return false; } },
    { id: "wiz.lead", label: "Wizard: lead", group: "Wizards",
      hint: "Sound wizard — three choices, then audition",
      run: () => { if (typeof avWizRun === "function") { avWizRun("lead"); return true; } return false; } },
    { id: "store.open", label: "Open store", group: "Store",
      hint: "Open the pack store card",
      run: () => avPaletteStoreOpen() },
    { id: "deliver.stems", label: "Export stems (Deliver)", group: "Deliver",
      hint: "Open Deliver and highlight RUN — renders stems + master offline",
      run: () => avPaletteDeliverHighlight() },
    { id: "help.tour", label: "Start the 60-second tour", group: "Help",
      hint: "A ~12-step walk over the main cards",
      run: () => avPaletteStartTour() },
    { id: "help.open", label: "Open help", group: "Help",
      hint: "Shortcuts, guides and tips",
      run: () => { if (typeof avHelpOpen === "function") { avHelpOpen(); return true; } return false; } },
    { id: "metro.toggle", label: "Toggle metronome", group: "Studio",
      hint: "The studio click — on / off",
      run: () => avPaletteMetroToggle() },
    { id: "metro.countin", label: "Count-in (1 bar)", group: "Studio",
      hint: "One bar of clicks before you come in",
      run: () => avPaletteCountIn() },
    { id: "rec.toggle", label: "Toggle recorder", group: "Studio",
      hint: "Start / stop recording the master output",
      run: () => avPaletteRecToggle() },
    { id: "proj.save", label: "Save project (.anvl)", group: "Project",
      hint: "Save everything to an .anvl file",
      run: () => { if (typeof avProjSave === "function") { avProjSave(); return true; } return false; } },
    { id: "share.card", label: "Export patch card", group: "Project",
      hint: "A PNG patch card + an offline link",
      run: () => { if (typeof avCardShare === "function") { avCardShare(); return true; } return false; } }
  );
  return cmds;
}

function avPaletteRegisterCore() {
  try {
    const defs = avPaletteCoreCommands();
    for (let i = 0; i < defs.length; i++) avPaletteRegister(defs[i]);
    return defs.length;
  } catch (e) { return 0; }
}

/* ---------- the overlay (created by this module; one per document) ---------- */

function avPaletteEnsureDom() {
  try {
    if (avPaletteState.dom) return avPaletteState.dom;
    if (typeof document === "undefined" || !document || typeof document.createElement !== "function") return null;
    let overlay = document.getElementById("av-palette");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "av-palette";
      overlay.className = "av-palette";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-label", "Command palette");
      overlay.setAttribute("hidden", "");
      overlay.style.display = "none";
      overlay.innerHTML = '<div class="av-palette-box">' +
        '<input id="av-palette-input" class="av-palette-input" type="text" autocomplete="off" spellcheck="false" placeholder="Type a command…" role="combobox" aria-expanded="true" aria-controls="av-palette-list" aria-label="Command palette input">' +
        '<div id="av-palette-list" class="av-palette-list" role="listbox" aria-label="Commands"></div>' +
        '<div id="av-palette-foot" class="av-palette-foot">↵ run · esc close</div>' +
        '</div>';
      const root = document.body || document.documentElement;
      if (!root || typeof root.appendChild !== "function") return null;
      root.appendChild(overlay);
    }
    const input = overlay.querySelector("#av-palette-input");
    const list = overlay.querySelector("#av-palette-list");
    if (!input || !list) return null;
    avPaletteState.dom = { overlay: overlay, input: input, list: list };
    return avPaletteState.dom;
  } catch (e) { return null; }
}

function avPaletteFocusInput() {
  try {
    const d = avPaletteState.dom || avPaletteEnsureDom();
    if (!d || !d.input) return false;
    if (typeof d.input.focus === "function") d.input.focus();
    if (typeof d.input.setSelectionRange === "function") {
      try { d.input.setSelectionRange(d.input.value.length, d.input.value.length); } catch (e) { /* type not text */ }
    }
    return true;
  } catch (e) { return false; }
}

/* the match-highlight builder — hits are raw-label indices, escaped char by char */
function avPaletteLabelHTML(label, hits) {
  let out = "", h = 0;
  const H = Array.isArray(hits) ? hits : [];
  for (let i = 0; i < label.length; i++) {
    const ch = avPaletteEsc(label.charAt(i));
    if (h < H.length && H[h] === i) { out += '<span class="av-palette-hit">' + ch + '</span>'; h++; }
    else out += ch;
  }
  return out;
}

function avPaletteRowHTML(it, isSel) {
  const oid = "av-palette-opt-" + String(it.id).replace(/[^A-Za-z0-9_-]/g, "-");
  let h = '<div class="av-palette-row' + (isSel ? " sel" : "") + '" role="option" id="' + oid +
    '" data-id="' + avPaletteEsc(it.id) + '" data-keys="' + avPaletteEsc(it.keys || "") +
    '" aria-selected="' + (isSel ? "true" : "false") + '"' +
    (it.hint ? ' title="' + avPaletteEsc(it.hint) + '"' : "") + '>';
  h += '<span class="av-palette-lbl">' + avPaletteLabelHTML(it.label, it.hits) + '</span>';
  if (it.keys) h += '<span class="av-palette-keys">' + avPaletteEsc(it.keys) + '</span>';
  return h + '</div>';
}

/* full repaint from state.query; keeps the selected id when it survives the new filter */
function avPalettePaint() {
  try {
    const d = avPaletteState.dom || avPaletteEnsureDom();
    if (!d) return false;
    const items = avPaletteFilterQuery(avPaletteState.query);
    let sel = 0;
    if (avPaletteState.selId) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].id === avPaletteState.selId) { sel = i; break; }
      }
    }
    if (!items.length) {
      avPaletteState.sel = 0;
      avPaletteState.selId = "";
    } else {
      sel = Math.max(0, Math.min(items.length - 1, sel));
      avPaletteState.sel = sel;
      avPaletteState.selId = items[sel].id;
    }
    let html = "";
    let lastGroup = "";
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.group && it.group !== lastGroup) {
        html += '<div class="av-palette-group" role="presentation">' + avPaletteEsc(it.group) + '</div>';
        lastGroup = it.group;
      }
      html += avPaletteRowHTML(it, i === sel);
    }
    if (!items.length) html = '<div class="av-palette-empty" role="presentation">No matching commands</div>';
    d.list.innerHTML = html;
    try {
      const selRow = d.list.querySelector(".av-palette-row.sel");
      if (selRow && selRow.id) d.input.setAttribute("aria-activedescendant", selRow.id);
      else d.input.removeAttribute("aria-activedescendant");
    } catch (e2) { /* aria is a nicety */ }
    return true;
  } catch (e) { return false; }
}

function avPaletteScrollSel() {
  try {
    const d = avPaletteState.dom;
    if (!d || !d.list || typeof d.list.querySelector !== "function") return false;
    const selRow = d.list.querySelector(".av-palette-row.sel");
    if (selRow && typeof selRow.scrollIntoView === "function") selRow.scrollIntoView({ block: "nearest" });
    return true;
  } catch (e) { return false; }
}

function avPaletteMove(dir) {
  try {
    const items = avPaletteFilterQuery(avPaletteState.query);
    if (!items.length) return false;
    let sel = avPaletteState.sel;
    if (!(sel >= 0 && sel < items.length)) sel = 0;
    sel = (sel + (dir >= 0 ? 1 : -1) + items.length) % items.length;   /* cyclic */
    avPaletteState.sel = sel;
    avPaletteState.selId = items[sel].id;
    avPalettePaint();
    avPaletteScrollSel();
    return true;
  } catch (e) { return false; }
}

/* Enter / a row click: close first (focus goes home), then run */
function avPaletteRunSelected() {
  try {
    const items = avPaletteFilterQuery(avPaletteState.query);
    const sel = Math.max(0, Math.min(items.length - 1, avPaletteState.sel));
    const it = items[sel];
    if (!it) return false;
    avPaletteClose();
    return avPaletteRun(it.id);
  } catch (e) { return false; }
}

/* ---------- the module's own listeners (never a document keydown) ---------- */

function avPaletteOnInput() {
  try {
    const d = avPaletteState.dom;
    if (!d || !d.input) return;
    avPaletteState.query = String(d.input.value == null ? "" : d.input.value).trim();
    avPaletteState.selId = "";
    avPalettePaint();
  } catch (e) { /* a listener never throws outward */ }
}

function avPaletteOnListClick(e) {
  try {
    const t = e && e.target;
    const row = (t && typeof t.closest === "function") ? t.closest(".av-palette-row") : null;
    if (!row) return;
    const id = row.getAttribute("data-id") || "";
    avPaletteState.selId = id;
    avPaletteClose();
    avPaletteRun(id);
  } catch (e2) { /* a listener never throws outward */ }
}

/* the overlay-scoped keydown — a second sighting of events that bubble on to av_kb's ONE
   document listener; the marker in avPaletteKey makes the document sighting a no-op */
function avPaletteOnOverlayKey(e) {
  try { avPaletteKey(e); } catch (err) { /* a listener never throws outward */ }
}

/* click outside -> close (pointerdown, capture; the frame's keyboard laws are untouched) */
function avPaletteOnDocPointer(e) {
  try {
    if (!avPaletteState.open) return;
    const d = avPaletteState.dom;
    const t = e && e.target;
    if (d && d.overlay && t && typeof d.overlay.contains === "function" && d.overlay.contains(t)) return;
    avPaletteClose();
  } catch (err) { /* a listener never throws outward */ }
}

/* ---------- open / close / isOpen ---------- */

/* Open: closes the help overlay first (guarded avHelpClose — mutual exclusion), remembers
   the focused element, shows + paints + focuses the input. Returns true when open. */
function avPaletteOpen() {
  try {
    if (typeof document === "undefined" || !document) return false;
    if (!avPaletteState.inited) avPaletteInit();      /* lazy safety: boot calls init anyway */
    const d = avPaletteEnsureDom();
    if (!d) return false;
    if (avPaletteState.open === true) { avPaletteFocusInput(); return true; }
    try { if (typeof avHelpClose === "function") avHelpClose(); } catch (e) { /* D optional */ }
    let prev = null;
    try {
      const ae = document.activeElement;
      if (ae && ae !== document.body && ae !== document.documentElement && !d.overlay.contains(ae)) prev = ae;
    } catch (e2) { prev = null; }
    avPaletteState.focusPrev = prev;
    avPaletteState.open = true;
    avPaletteState.query = "";
    avPaletteState.selId = "";
    avPaletteState.sel = 0;
    try { d.input.value = ""; } catch (e3) { /* read-only input is absurd; belt and braces */ }
    d.overlay.hidden = false;
    d.overlay.style.display = "";                     /* hand layout back to the parent CSS */
    d.overlay.classList.add("open");
    try { if (document.body) document.body.classList.add("av-palette-open"); } catch (e4) { /* no body */ }
    avPalettePaint();
    avPaletteFocusInput();
    return true;
  } catch (e) { avPaletteState.open = false; return false; }
}

/* Close: hides the overlay, restores focus to where it came from (guarded). Returns true when
   the palette was open and is now closed; false when it was already closed. The state flips
   FIRST and every DOM touch is guarded on its own — a close is never half-done. */
function avPaletteClose() {
  try {
    if (avPaletteState.open !== true) return false;
    avPaletteState.open = false;
    const d = avPaletteState.dom;
    try {
      if (d) {
        d.overlay.classList.remove("open");
        d.overlay.hidden = true;
        d.overlay.style.display = "none";             /* visibility truth, whatever CSS does */
      }
    } catch (e0) { /* overlay gone — the state already flipped */ }
    try { if (typeof document !== "undefined" && document && document.body) document.body.classList.remove("av-palette-open"); } catch (e) { /* no body */ }
    const prev = avPaletteState.focusPrev;
    avPaletteState.focusPrev = null;
    try {
      if (prev && prev.isConnected === true && typeof prev.focus === "function") prev.focus();
      else if (d && d.input && typeof d.input.blur === "function") d.input.blur();
    } catch (e2) { /* focus restore is best effort */ }
    return true;
  } catch (e) { return false; }
}

function avPaletteIsOpen() {
  return avPaletteState.open === true;
}

/* ---------- the key route (avUiKeyHook -> avPaletteKey; never a document keydown) ---------- */

function avPaletteMark(e, consumed) {
  try { e.preventDefault(); } catch (err) { /* synthetic events refuse */ }
  try { e.__avPaletteKey = AV_PALETTE_VERSION; e.__avPaletteConsumed = consumed === true; } catch (err2) { /* frozen event */ }
  return consumed === true;
}

/* true ONLY when consumed:
   - mod+K (ctrl/meta, no alt/shift): toggles — from anywhere, text fields included
   - while open: Esc closes, ArrowUp/Down move (cyclic), Enter runs the selection
   Everything else returns false so av_kb's own chains keep working unchanged. */
function avPaletteKey(e) {
  try {
    if (!e || typeof e !== "object") return false;
    if (e.__avPaletteKey === AV_PALETTE_VERSION) return e.__avPaletteConsumed === true;   /* second sighting */
    const key = String(e.key == null ? "" : e.key);
    const mod = e.ctrlKey === true || e.metaKey === true;
    if (mod && e.altKey !== true && e.shiftKey !== true && key.toLowerCase() === "k") {
      const ok = (avPaletteState.open === true) ? avPaletteClose() : avPaletteOpen();
      if (ok === true) return avPaletteMark(e, true);
      return false;
    }
    if (avPaletteState.open !== true) return false;    /* closed: Esc etc. stay av_kb's */
    if (key === "Escape") { avPaletteClose(); return avPaletteMark(e, true); }
    if (key === "ArrowDown") { avPaletteMove(1); return avPaletteMark(e, true); }
    if (key === "ArrowUp") { avPaletteMove(-1); return avPaletteMark(e, true); }
    if (key === "Enter") { avPaletteRunSelected(); return avPaletteMark(e, true); }
    return false;
  } catch (err) { return false; }
}

/* ---------- init (mount + wire + register; idempotent) ---------- */

function avPaletteInit() {
  try {
    if (typeof document === "undefined" || !document) return false;
    if (avPaletteState.inited) return true;
    const d = avPaletteEnsureDom();
    if (!d) return false;
    try {
      if (d.input.dataset && d.input.dataset.avPaletteWired !== "1") {
        d.input.dataset.avPaletteWired = "1";
        d.input.addEventListener("input", avPaletteOnInput);
      }
      if (d.list.dataset && d.list.dataset.avPaletteWired !== "1") {
        d.list.dataset.avPaletteWired = "1";
        d.list.addEventListener("click", avPaletteOnListClick);
      }
      if (d.overlay.dataset && d.overlay.dataset.avPaletteWired !== "1") {
        d.overlay.dataset.avPaletteWired = "1";
        d.overlay.addEventListener("keydown", avPaletteOnOverlayKey);
      }
      if (!avPaletteState.wiredDoc) {
        avPaletteState.wiredDoc = true;
        document.addEventListener("pointerdown", avPaletteOnDocPointer, true);
      }
    } catch (e) { /* wiring is best effort; the guard flags prevent doubles */ }
    avPaletteRegisterCore();
    avPaletteState.inited = true;
    return true;
  } catch (e) { return false; }
}

/* ---------- debug/verify handle ---------- */

if (typeof window !== "undefined") {
  try {
    window.__avPalette = {
      version: AV_PALETTE_VERSION,
      open: () => avPaletteOpen(),
      close: () => avPaletteClose(),
      isOpen: () => avPaletteIsOpen(),
      key: (e) => avPaletteKey(e),
      run: (id) => avPaletteRun(id),
      register: (cmd) => avPaletteRegister(cmd),
      commands: () => avPaletteCommands(),
      filtered: (q) => avPaletteFilterQuery(q),
      score: (label, q) => avPaletteMatch(label, q),
    };
  } catch (e) { /* no window */ }
}
