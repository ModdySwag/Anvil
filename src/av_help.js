/* av_help.js — Anvil's help system: the help overlay (?), the keymap (AV_KB_DEFS rows + the
   palette's command list + the static Ctrl-K / ? / Esc rows), curated tooltips, the four-div
   cutout tour engine with its built-in 60-second tour, and the four outcome-named recipe cards.

   LAWS preserved:
   - ONE keydown route (av_kb.js T9 §9): this module NEVER adds a document keydown listener.
     Everything arrives through avUiKeyHook(e), which the parent wires into avKbHandle right
     after `const mod = e.ctrlKey || e.metaKey;` (§4 E-kb6). The hook consumes ONLY what it
     claims: (a) the palette first (guarded avPaletteKey), (b) `?`, (c) Esc while the overlay or
     the palette is open. It returns false for everything else, so av_kb's esc chain, the
     Ctrl+Alt+1/2/3 input picks and every piano key keep working exactly as before.
   - Help never covers the instrument: the overlay is a side panel (400 px, right edge, tucked
     above the dock), tips are small bubbles, and the tour shading is pointer-events:none.
     Nothing here blocks the keyboard: keys still dispatch through avKbHandle while any of
     this is open.
   - The tour follows the pinned shape: sel resolved at step time (document.querySelector),
     scrolled into view, cut out by four shading divs + a ring (recomputed on resize/scroll),
     actions run through the cross-child seam `avLessonAction` (guarded — F owns the map), and
     the handle is {next, prev, skip, done} with window.__avHelp.tour = {active, step, total}.
     avHelpTour() with no steps (or avHelpTour60(), the palette's preferred name) starts the
     built-in tour. AUTO-ADVANCE: OFF — explicit next only; closable at every step (SKIP).
   - Cross-module calls are all typeof-guarded (avPaletteKey / avPaletteClose /
     avPaletteCommands / avLessonRun / avLessonAction / AV_KB_DEFS) so this module works alone;
     every entry point is try/catch-wrapped, and the top level is DOM-free (parse-safe for the
     node harness). The only window touch is the guarded __avHelp handle at the bottom.
   - Tooltips: `data-av-tip` attribute support plus the curated DO-NOT-EDIT registry below;
     ONE delegated handler on document (pointerover / pointerout / focusin / focusout); the
     bubble is #av-tip, pointer-events:none, and it never tips over this module's own UI.

   Styles contract (parent writes the S5 block; the roots carry their own geometry inline):
   ids: #av-help-overlay (hidden attr toggles) · #av-tip (hidden attr toggles) ·
        #av-help-close · #av-help-tab-shortcuts / -tour / -guides / -tips ·
        #av-help-shortcuts (rows host) · #av-help-tiprows · #av-help-tour-start;
   classes: .av-help .av-help-open .av-help-head .av-help-title .av-help-x .av-help-tabs
        .av-help-tab(.on) .av-help-body .av-help-pane .av-help-group .av-help-rows .av-help-row
        .av-help-keys .av-help-desc .av-help-lead .av-help-list .av-help-recipes .av-help-recipe
        .av-help-recipe-title .av-help-recipe-blurb .av-help-recipe-go .av-help-tour-go
        .av-help-tiprow .av-help-tipdot .av-help-note .av-help-spot .av-tip .av-tour-shade
        .av-tour-ring .av-tour-panel .av-tour-step .av-tour-title .av-tour-text .av-tour-actions
        .av-tour-prev .av-tour-next .av-tour-skip · body.av-tour-on;
   NOTE: visibility is driven by the `hidden` ATTRIBUTE on #av-help-overlay / #av-tip /
   .av-help-pane — sibling display rules must be written as `.av-help-pane:not([hidden])`
   style selectors, never a bare `{ display: … }` rule (a bare author display rule would
   override the UA [hidden] rule and pin the panel open).
   z ladder here: shades 1500 · ring 1501 · tour panel 1502 · tip 1600 · overlay 46 (dock 41). */
"use strict";

/* ================================ version + curated data ================================ */

const AV_HELP_VERSION = "1.0.0";

/* The curated tooltip registry — selector → text for the key controls. DO NOT EDIT casually:
   selectors are real ids shipped by the modules named in the pin; a row whose element is
   missing simply never fires (resolution happens at event time). Other modules attach their
   own tips with `avHelpTip(el, text)` / `data-av-tip` attributes. */
const AV_HELP_TIPS = [
  { sel: "#btn-piano", text: "Piano dock — 61 keys at the bottom; Y shows or hides it" },
  { sel: "#av-help", text: "Help — shortcuts, a 60-second tour, outcome guides and tips (?)" },
  { sel: "#pk-close", text: "Hide the piano dock (Y, or the \u266a button, brings it back)" },
  { sel: "#pk-modes [data-mode=\"studio\"]", text: "STUDIO — the typing letters stay quiet; play the dock with the pointer" },
  { sel: "#pk-modes [data-mode=\"keys\"]", text: "KEYS — the typing keys play the dock: A-row white, W-row black, Z / X hop octaves, Esc hands back" },
  { sel: "#pk-modes [data-mode=\"midi\"]", text: "MIDI — your hardware plays the notes; PC letters stay quiet" },
  { sel: "#pk-oct-down", text: "Piano window octave down — [ (or Z in KEYS)" },
  { sel: "#pk-oct-up", text: "Piano window octave up — ] (or X in KEYS)" },
  { sel: "#av-synth-engine", text: "ENGINE — pick the voice: VA, ACID, STRING, DRUM, GRANULAR or SAMPLER" },
  { sel: "#av-seq-play", text: "PLAY — start the audio-clock transport" },
  { sel: "#av-seq-stop", text: "STOP — halt and rewind the transport" },
  { sel: "#av-seq-rec", text: "REC — cycle the capture arm: off \u2192 step \u2192 live" },
  { sel: "[data-av-sample-drop]", text: "Drop a WAV here (or click to import) — it decodes locally; send it to GRANULAR or SAMPLER" },
  { sel: "#av-store-search", text: "Search the store — name, tags, engine" },
  { sel: "#av-mix-render", text: "Render the mixdown in memory (offline, chunked) with a live progress readout" },
  { sel: "#av-mix-export", text: "Encode the last render and download it as a WAV" },
  { sel: "#av-mix-auto", text: "Auto-mix — measure the tracks and nudge each gain toward the target" },
  { sel: "#av-deck-run", text: "RUN / PAUSE — the deck's live display loop" },
  { sel: "#av-studio-rec", text: "Record a take — count-in first; laps split at sequencer cycle ends" },
  { sel: "#av-studio-metro", text: "Metronome — clicks go to the master only, never into a take" },
  { sel: "#av-sessions-save", text: "Save a version snapshot of the working state" },
  { sel: "#av-sessions-backup", text: "Backup zip — every session, installed pack and sample slot in one file" },
  { sel: "#av-deliver-run", text: "EXPORT STEMS — render stems + master + MIDI + README offline into a DAW-ready zip" },
  { sel: "#av-deliver-master-run", text: "MASTER WAV — render just the master, one file" },
  { sel: "[data-rec=\"toggle\"]", text: "Record the master output to a WAV — press again to STOP" },
  { sel: "#av-files-save", text: "SAVE .anvl — write the whole session to a project file" },
];

/* The four outcome-named recipes (GUIDES). ids are the lesson ids avLessonsList() ships;
   `sel` is the card the fallback spotlights when the lessons module is not aboard. */
const AV_HELP_RECIPES = [
  { id: "first-beat", title: "Get your first beat",
    blurb: "Load the demo groove, hear the drums, add a step — a beat that plays.",
    sel: "#av-seq" },
  { id: "acid-line", title: "Make an acid line",
    blurb: "Choose the ACID engine, dial the squelch, program a line.",
    sel: "#av-synth" },
  { id: "sample-chop", title: "Chop a sample",
    blurb: "Import a WAV, scatter grains, slice it into a beat.",
    sel: "#av-sample" },
  { id: "stems-export", title: "Export stems to your DAW",
    blurb: "Render stems + master + MIDI into a DAW-ready zip.",
    sel: "#av-deliver" },
];

/* ---------- state (DOM touched only inside guarded functions) ---------- */

let avHelpInited = false;
let avHelpDocBound = false;
let avHelpOpenState = false;
let avHelpTab = "shortcuts";
let avHelpSpotTimer = 0;

const avHelpUi = { el: null };                       /* the overlay root, once built */
const avHelpTipState = { el: null, src: null, text: "" };

/* the live tour snapshot — window.__avHelp.tour is THIS object (mutated in place so external
   references stay current): {active, step, total} exactly, per the §2.D pin. */
const avHelpTourLive = { active: false, step: 0, total: 0 };

const avHelpTourState = {
  token: 0,          /* bumped per new tour — stale handles no-op instead of killing a newer tour */
  active: false,
  steps: [],
  i: 0,
  tEl: null,         /* the step's resolved element (sel resolved at step time) */
  parts: null,       /* {shades:[4], ring, panel} */
  onReframe: null,   /* the resize/scroll listener while the tour is up */
};

/* ================================ tiny helpers ================================ */

function avHelpEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

function avHelpQuery(sel) {
  try {
    if (typeof document === "undefined" || !sel || !document.querySelector) return null;
    const el = document.querySelector(String(sel));
    return (el && el.nodeType === 1) ? el : null;
  } catch (e) { return null; }
}

function avHelpScrollTo(el) {
  try {
    if (!el || typeof el.scrollIntoView !== "function") return false;
    try { el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }); }
    catch (e) { el.scrollIntoView(true); }
    return true;
  } catch (e) { return false; }
}

/* ================================ the overlay ================================ */

/* SHORTCUTS rows — AV_KB_DEFS (guarded: av_kb may not be aboard in a harness) + the palette's
   command list (guarded) + the static rows the dispatcher itself owns. */
function avHelpShortcutsHTML() {
  const rows = [];
  rows.push('<div class="av-help-group">INPUT — works from inside a text field</div>');
  rows.push(avHelpRow("Ctrl+Alt+1", "STUDIO — the typing letters stay quiet; play the dock with the pointer"));
  rows.push(avHelpRow("Ctrl+Alt+2", "KEYS — the typing keys play the dock: A-row white, W-row black, Z / X hop octaves"));
  rows.push(avHelpRow("Ctrl+Alt+3", "MIDI — your hardware plays; PC letters stay quiet"));
  rows.push(avHelpRow("Ctrl+K", "Open the command palette — every card and command, one search away (\u2318+K on a Mac)"));
  rows.push(avHelpRow("?", "Open or close this help panel"));
  rows.push(avHelpRow("Esc", "Close this panel or the palette — in KEYS it also hands your keyboard back"));

  let defs = [];
  try { if (typeof AV_KB_DEFS !== "undefined" && AV_KB_DEFS) defs = AV_KB_DEFS; } catch (e) { defs = []; }
  if (defs.length) {
    rows.push('<div class="av-help-group">PIANO \u2014 the dock\u2019s own keys</div>');
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i] || {};
      const label = (typeof d.label === "string" && d.label) ? d.label : String(d.key == null ? "" : d.key);
      rows.push(avHelpRow(label, String(d.desc == null ? "" : d.desc)));
    }
  }

  const cmds = avHelpPaletteRows();
  rows.push('<div class="av-help-group">COMMANDS \u2014 the palette carries them all</div>');
  if (cmds.length) rows.push(cmds.join(""));
  else rows.push(avHelpRow("PALETTE", "The command list lands with the palette module — Ctrl+K"));
  return rows.join("");
}

function avHelpRow(k, d) {
  return '<div class="av-help-row"><span class="av-help-keys">' + avHelpEsc(k)
    + '</span><span class="av-help-desc">' + avHelpEsc(d) + "</span></div>";
}

function avHelpPaletteRows() {
  let cmds = null;
  try { if (typeof avPaletteCommands === "function") cmds = avPaletteCommands(); } catch (e) { cmds = null; }
  if (!Array.isArray(cmds)) return [];
  const rows = [];
  for (let i = 0; i < cmds.length && rows.length < 40; i++) {
    const c = cmds[i];
    if (!c || typeof c !== "object") continue;
    const label = String(c.label == null ? "" : c.label);
    if (!label) continue;
    const keys = (typeof c.keys === "string" && c.keys) ? c.keys : "PALETTE";
    const desc = label + ((typeof c.hint === "string" && c.hint) ? (" \u2014 " + c.hint) : "");
    rows.push(avHelpRow(keys, desc));
  }
  return rows;
}

/* GUIDES — the four outcome-named recipes */
function avHelpGuidesHTML() {
  let out = '<p class="av-help-lead av-note">Four outcomes, one press each. Each runs its guided',
    out2 = ' walkthrough when the lessons module is aboard; otherwise it spotlights the card where it happens.</p>';
  out += out2;
  out += '<div class="av-help-recipes">';
  for (let i = 0; i < AV_HELP_RECIPES.length; i++) {
    const r = AV_HELP_RECIPES[i];
    out += '<button type="button" class="av-help-recipe" data-av-help="recipe" data-recipe="' + avHelpEsc(r.id) + '">'
      + '<span class="av-help-recipe-title">' + avHelpEsc(r.title) + "</span>"
      + '<span class="av-help-recipe-blurb">' + avHelpEsc(r.blurb) + "</span>"
      + '<span class="av-help-recipe-go">RUN \u25b6</span></button>';
  }
  return out + "</div>";
}

/* TOUR pane — the built-in 60-second tour lives behind the start button */
function avHelpTourPaneHTML() {
  return '<p class="av-help-lead av-note">The 60-second tour walks ten cards and leaves you playing. '
    + 'Twelve stops, about a minute, nothing auto-advances \u2014 SKIP leaves it at any step, and '
    + 'every key keeps working while it runs.</p>'
    + '<button type="button" class="av-btn av-help-tour-go" id="av-help-tour-start" data-av-help="tour-start">\u25b6 START THE 60-SECOND TOUR</button>'
    + '<ul class="av-help-list">'
    + "<li>Play something on the piano dock</li>"
    + "<li>Shape the sound, then set your levels</li>"
    + "<li>Make a beat \u00b7 load a pack \u00b7 mix it down</li>"
    + "<li>Export stems to your DAW</li>"
    + "</ul>";
}

/* TIPS — contextual list, rebuilt on every open (cheap) */
function avHelpContextTips() {
  const out = [];
  try {
    const body = (typeof document !== "undefined") ? document.body : null;
    if (body && body.classList && body.classList.contains("piano-closed")) {
      out.push("Your piano is put away \u2014 press Y (or the \u266a button) to bring the dock back.");
    } else {
      out.push("The piano dock is open: click keys to play, hold to sustain, glide to sweep.");
    }
    if (typeof avInputMode === "string" && avInputMode !== "keys") {
      out.push("Press ` (backtick) to turn the typing keys into the piano \u2014 A-row white, W-row black, Z and X hop octaves.");
    } else if (typeof avInputMode === "string") {
      out.push("KEYS mode is on \u2014 Esc hands your keyboard back to the page.");
    }
  } catch (e) { /* context probes are a nicety */ }
  out.push("Ctrl+K opens the command palette \u2014 it works from inside any text field.");
  out.push("Tab to any control and the keyboard takes over: arrows step, Enter activates, Esc lets go.");
  out.push("Nothing is lost by exploring \u2014 recording and exporting only act when you press them.");
  out.push("The DECK shows what the engine is doing right now: scope, spectrum, waterfall, voices.");
  out.push("Everything is local-first: projects, takes, packs and cards never leave this browser.");
  out.push("The 60-second tour lives on the TOUR tab \u2014 start it from there any time.");
  return out;
}

function avHelpTipsHTML() {
  const tips = avHelpContextTips();
  let out = "";
  for (let i = 0; i < tips.length; i++) {
    out += '<div class="av-help-tiprow"><span class="av-help-tipdot"></span>'
      + '<span class="av-help-desc">' + avHelpEsc(tips[i]) + "</span></div>";
  }
  return out;
}

function avHelpRootHTML() {
  return '<div class="av-help-head"><span class="av-help-title">HELP</span>'
    + '<button type="button" class="av-btn mini av-help-x" id="av-help-close" data-av-help="close" aria-label="Close help">\u2715</button></div>'
    + '<div class="av-help-tabs" role="tablist" aria-label="Help sections">'
    + '<button type="button" class="av-btn mini av-help-tab on" id="av-help-tab-shortcuts" role="tab" data-av-help="tab" data-tab="shortcuts" aria-selected="true">SHORTCUTS</button>'
    + '<button type="button" class="av-btn mini av-help-tab" id="av-help-tab-tour" role="tab" data-av-help="tab" data-tab="tour" aria-selected="false">TOUR</button>'
    + '<button type="button" class="av-btn mini av-help-tab" id="av-help-tab-guides" role="tab" data-av-help="tab" data-tab="guides" aria-selected="false">GUIDES</button>'
    + '<button type="button" class="av-btn mini av-help-tab" id="av-help-tab-tips" role="tab" data-av-help="tab" data-tab="tips" aria-selected="false">TIPS</button>'
    + "</div>"
    + '<div class="av-help-body">'
    + '<div class="av-help-pane" data-pane="shortcuts" role="tabpanel" aria-label="Shortcuts">'
    + '<div class="av-help-rows" id="av-help-shortcuts">' + avHelpShortcutsHTML() + "</div></div>"
    + '<div class="av-help-pane" data-pane="tour" role="tabpanel" aria-label="Tour" hidden>' + avHelpTourPaneHTML() + "</div>"
    + '<div class="av-help-pane" data-pane="guides" role="tabpanel" aria-label="Guides" hidden>' + avHelpGuidesHTML() + "</div>"
    + '<div class="av-help-pane" data-pane="tips" role="tabpanel" aria-label="Tips" hidden>'
    + '<div class="av-help-rows" id="av-help-tiprows">' + avHelpTipsHTML() + "</div></div>"
    + "</div>"
    + '<p class="av-help-note av-note av-dim">Nothing here leaves the page. ? opens or closes this panel \u2014 it never covers the instrument or the keys.</p>';
}

/* build (or re-adopt) the overlay root; the geometry is inline so the panel is a correct side
   panel even before the parent's styles land (parent: style the inner classes). */
function avHelpEnsureOverlay() {
  try {
    if (typeof document === "undefined" || !document.getElementById || !document.body) return null;
    let root = avHelpUi.el;
    if (root && root.isConnected === false) root = null;
    if (!root) root = document.getElementById("av-help-overlay");
    if (root && !(root.classList && root.classList.contains("av-help"))) root = null;   /* foreign node */
    if (!root) {
      root = document.createElement("div");
      root.id = "av-help-overlay";
      root.className = "av-help";
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-label", "Help \u2014 shortcuts, tour, guides and tips");
      root.hidden = true;
      root.style.cssText = "position:fixed;top:52px;right:12px;width:400px;"
        + "max-width:min(480px,calc(100vw - 24px));"
        + "max-height:calc(100vh - 76px - var(--dock-tax, 0px));overflow:auto;"
        + "z-index:46;background:var(--panel,#10161b);border:1px solid rgba(255,255,255,.14);"
        + "border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.55);padding:10px 12px;"
        + "color:var(--text-2,#c8d4da);font-size:13px;line-height:1.4;";
      document.body.appendChild(root);
    }
    if (!root.dataset || root.dataset.avHelpWired !== "1") {
      if (root.dataset) root.dataset.avHelpWired = "1";
      root.addEventListener("click", avHelpClick);
    }
    if (!root.querySelector || !root.querySelector(".av-help-head")) {
      root.innerHTML = avHelpRootHTML();
    }
    avHelpUi.el = root;
    return root;
  } catch (e) { return null; }
}

function avHelpSetTab(name) {
  if (["shortcuts", "tour", "guides", "tips"].indexOf(name) < 0) name = "shortcuts";
  avHelpTab = name;
  const root = avHelpUi.el;
  if (!root || !root.querySelectorAll) return false;
  root.querySelectorAll('[data-av-help="tab"]').forEach(b => {
    const on = b.getAttribute("data-tab") === name;
    b.setAttribute("aria-selected", on ? "true" : "false");
    b.classList.toggle("on", on);
  });
  root.querySelectorAll("[data-pane]").forEach(p => { p.hidden = p.getAttribute("data-pane") !== name; });
  /* refresh the two live panes on the way in (the palette may have registered new commands) */
  if (name === "shortcuts") { const sc = root.querySelector("#av-help-shortcuts"); if (sc) sc.innerHTML = avHelpShortcutsHTML(); }
  if (name === "tips") { const tr = root.querySelector("#av-help-tiprows"); if (tr) tr.innerHTML = avHelpTipsHTML(); }
  return true;
}

function avHelpClick(e) {
  try {
    const t = e && e.target;
    if (!t || typeof t.closest !== "function") return;
    if (t.closest('[data-av-help="close"]')) { avHelpClose(); return; }
    const tab = t.closest('[data-av-help="tab"]');
    if (tab) { avHelpSetTab(tab.getAttribute("data-tab")); return; }
    if (t.closest('[data-av-help="tour-start"]')) { avHelpStartBuiltinTour(); return; }
    const rec = t.closest('[data-av-help="recipe"]');
    if (rec) { avHelpRunRecipe(rec.getAttribute("data-recipe")); return; }
  } catch (err) { /* the overlay never throws outward */ }
}

/* ---------- recipe seam ---------- */

function avHelpRecipeById(id) {
  for (let i = 0; i < AV_HELP_RECIPES.length; i++) if (AV_HELP_RECIPES[i].id === id) return AV_HELP_RECIPES[i];
  return null;
}

function avHelpRunRecipe(id) {
  const r = avHelpRecipeById(id);
  if (!r) return false;
  /* the cross-child seam: F's avLessonRun(id) starts the guided walkthrough when it exists */
  if (typeof avLessonRun === "function") {
    let ok = null;
    try { ok = avLessonRun(r.id); } catch (e) { ok = null; }
    if (ok !== false) { avHelpClose(); return true; }
  }
  /* fallback: close, spotlight the target card and say honestly what is up */
  avHelpClose();
  const el = avHelpQuery(r.sel);
  if (!el) return false;
  avHelpSpot(el);
  avHelpTipShowAt(el, r.title + " \u2014 the guided walkthrough runs here once the lessons module is aboard; this card is where it happens.");
  return true;
}

/* transient spotlight on a card (class removed after ~1.8 s) */
function avHelpSpot(elarg) {
  try {
    const el = (typeof elarg === "string") ? avHelpQuery(elarg) : elarg;
    if (!el || !el.classList) return false;
    avHelpScrollTo(el);
    el.classList.add("av-help-spot");
    if (avHelpSpotTimer) { try { clearTimeout(avHelpSpotTimer); } catch (e) { /* ok */ } }
    avHelpSpotTimer = setTimeout(() => {
      try { el.classList.remove("av-help-spot"); } catch (e) { /* ok */ }
      avHelpSpotTimer = 0;
    }, 1800);
    return true;
  } catch (e) { return false; }
}

/* ================================ open / close / toggle ================================ */

function avHelpInit() {
  if (typeof document === "undefined" || !document.getElementById) return false;
  if (avHelpInited && avHelpUi.el && avHelpUi.el.isConnected !== false) return true;   /* idempotent */
  try {
    const btn = document.getElementById("av-help");
    if (btn && btn.addEventListener) {
      if (!btn.dataset || btn.dataset.avHelpBound !== "1") {
        if (btn.dataset) btn.dataset.avHelpBound = "1";
        btn.addEventListener("click", () => { avHelpToggle(); });
      }
      if (btn.setAttribute) {
        btn.setAttribute("title", "Help \u2014 shortcuts, a 60-second tour and guides (?)");
        btn.setAttribute("aria-label", "Help");
        if (!btn.hasAttribute || !btn.hasAttribute("aria-expanded")) btn.setAttribute("aria-expanded", "false");
      }
    }
    if (!avHelpEnsureOverlay()) return false;
    avHelpTipEnsure();
    if (!avHelpDocBound && document.addEventListener) {
      avHelpDocBound = true;
      /* ONE delegated tooltip handler (four event types, one function) — never a keydown */
      document.addEventListener("pointerover", avHelpTipEvent);
      document.addEventListener("pointerout", avHelpTipEvent);
      document.addEventListener("focusin", avHelpTipEvent);
      document.addEventListener("focusout", avHelpTipEvent);
    }
    avHelpInited = true;
    return true;
  } catch (e) { return false; }
}

function avHelpSetExpanded(v) {
  try {
    if (typeof document === "undefined" || !document.getElementById) return;
    const b = document.getElementById("av-help");
    if (b && b.setAttribute) b.setAttribute("aria-expanded", v ? "true" : "false");
  } catch (e) { /* a nicety */ }
}

function avHelpOpen() {
  try {
    if (typeof document === "undefined") return false;
    if (!avHelpInited && avHelpInit() !== true) return false;
    const root = avHelpEnsureOverlay();
    if (!root) return false;
    /* mutual exclusion: the palette closes the moment help opens (guarded — palette module) */
    try { if (typeof avPaletteClose === "function") avPaletteClose(); } catch (e) { /* guarded */ }
    avHelpSetTab(avHelpTab);
    root.hidden = false;
    root.classList.add("av-help-open");
    avHelpOpenState = true;
    avHelpSetExpanded(true);
    return true;
  } catch (e) { return false; }
}

function avHelpClose() {
  try {
    let root = avHelpUi.el;
    if ((!root || root.isConnected === false) && typeof document !== "undefined" && document.getElementById) {
      root = document.getElementById("av-help-overlay");
    }
    if (root) {
      root.hidden = true;
      root.classList.remove("av-help-open");
    }
    avHelpOpenState = false;
    avHelpSetExpanded(false);
    return true;
  } catch (e) { return false; }
}

function avHelpIsOpen() { return avHelpOpenState === true; }

function avHelpToggle() { return avHelpIsOpen() ? avHelpClose() : avHelpOpen(); }

/* ================================ the ONE key hook (av_kb route) ================================
   The parent inserts, right after `const mod = e.ctrlKey || e.metaKey;` in avKbHandle:
       if (typeof avUiKeyHook === "function" && avUiKeyHook(e) === true) return;
   This module never adds a keydown listener of its own. */

/* is the palette up (for the Esc fallback)? guarded probes, most precise first */
function avHelpPaletteUp() {
  try {
    if (typeof avPaletteIsOpen === "function") return avPaletteIsOpen() === true;
    if (typeof window !== "undefined" && window.__avPalette && typeof window.__avPalette.open === "boolean") {
      return window.__avPalette.open === true;
    }
    if (typeof document === "undefined" || !document.getElementById) return false;
    const el = document.getElementById("av-palette");
    if (!el) return false;
    if (typeof window !== "undefined" && window.getComputedStyle) {
      const cs = window.getComputedStyle(el);
      if (!cs || cs.display === "none" || cs.visibility === "hidden") return false;
      return (el.offsetWidth || 0) > 0 || (el.offsetHeight || 0) > 0;
    }
    return el.hidden !== true;
  } catch (e) { return false; }
}

function avUiKeyHook(e) {
  try {
    if (!e || typeof e !== "object") return false;
    if (e.isComposing === true) return false;          /* never fight an IME */

    /* (a) the palette asks first — Ctrl+K, arrows, Enter and Esc-while-open are ITS keys */
    if (typeof avPaletteKey === "function" && avPaletteKey(e) === true) return true;

    const t = e.target || null;
    const tag = ((t && t.tagName) || "").toLowerCase();
    const typing = tag === "input" || tag === "textarea" || tag === "select" || !!(t && t.isContentEditable);
    const mod = e.ctrlKey || e.metaKey;

    /* (b) `?` toggles the overlay — never from inside a field, never with a modifier held */
    if (e.key === "?" && !typing && !mod && !e.altKey) {
      const was = avHelpIsOpen();
      if (was) {
        avHelpClose();
      } else {
        try { if (typeof avPaletteClose === "function") avPaletteClose(); } catch (err) { /* guarded */ }
        avHelpOpen();
      }
      if (avHelpIsOpen() !== was) {
        if (e.preventDefault) e.preventDefault();
        return true;
      }
      return false;
    }

    /* (c) Esc closes the overlay — or the palette when it is still up — and consumes ONLY
       while one of them is open, so av_kb's own esc chain (hand the keyboard back / blur a
       field) keeps working otherwise. */
    if (e.key === "Escape") {
      if (avHelpIsOpen()) {
        if (e.preventDefault) e.preventDefault();
        avHelpClose();
        return true;
      }
      if (typeof avPaletteClose === "function" && avHelpPaletteUp()) {
        if (e.preventDefault) e.preventDefault();
        try { avPaletteClose(); } catch (err) { /* guarded */ }
        return true;
      }
    }
  } catch (err) { /* a hook never throws into the dispatcher */ }
  return false;
}

/* ================================ tooltips ================================ */

function avHelpTipEnsure() {
  try {
    if (typeof document === "undefined" || !document.body) return null;
    let tip = document.getElementById("av-tip");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "av-tip";
      tip.className = "av-tip";
      tip.setAttribute("role", "tooltip");
      tip.hidden = true;
      /* pointer-events:none INLINE — a hover bubble that captures the pointer would flicker
         itself to death; it must never eat a click or a hover */
      tip.style.cssText = "position:fixed;left:0;top:0;pointer-events:none;z-index:1600;"
        + "max-width:280px;background:#161f26;border:1px solid rgba(46,216,201,.35);"
        + "border-radius:6px;padding:5px 8px;color:#c8d4da;font-size:12px;line-height:1.35;"
        + "box-shadow:0 6px 18px rgba(0,0,0,.55);white-space:normal;";
      document.body.appendChild(tip);
    }
    avHelpTipState.el = tip;
    return tip;
  } catch (e) { return null; }
}

/* resolve the tip for a node: data-av-tip attribute first, then the curated registry */
function avHelpTipSourceFor(node) {
  try {
    if (!node || node.nodeType !== 1 || typeof node.closest !== "function") return null;
    if (node.closest("#av-help-overlay, #av-tip, #av-tour-panel, #av-palette")) return null;   /* not over our own UI */
    const d = node.closest("[data-av-tip]");
    if (d) {
      const tx = d.getAttribute("data-av-tip");
      if (tx) return { el: d, text: tx };
    }
    for (let i = 0; i < AV_HELP_TIPS.length; i++) {
      const row = AV_HELP_TIPS[i];
      const m = node.closest(row.sel);
      if (m) return { el: m, text: row.text };
    }
  } catch (e) { /* unknown target */ }
  return null;
}

function avHelpTipPlace(tip, el) {
  try {
    if (typeof window === "undefined" || !el.getBoundingClientRect) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
    const tw = tip.offsetWidth || 240, th = tip.offsetHeight || 28;
    let x = Math.round(r.left + Math.min(12, Math.max(0, r.width / 2)));
    x = Math.max(8, Math.min(x, vw - tw - 8));
    let y = Math.round(r.bottom + 8);
    if (y + th + 8 > vh) y = Math.max(8, Math.round(r.top - th - 8));
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  } catch (e) { /* keep the last spot */ }
}

function avHelpTipShow(src) {
  const tip = avHelpTipEnsure();
  if (!tip || !src || !src.el) return false;
  try {
    tip.textContent = src.text;
    tip.hidden = false;
    avHelpTipPlace(tip, src.el);
    avHelpTipState.src = src.el;
    avHelpTipState.text = src.text;
    return true;
  } catch (e) { return false; }
}

function avHelpTipHide() {
  try {
    if (avHelpTipState.el) avHelpTipState.el.hidden = true;
    avHelpTipState.src = null;
    avHelpTipState.text = "";
    return true;
  } catch (e) { return false; }
}

/* show a bubble at an explicit element (recipe fallback + the avHelpTip API when it wants to) */
function avHelpTipShowAt(el, text) {
  if (!el || !el.getBoundingClientRect) return false;
  return avHelpTipShow({ el: el, text: String(text == null ? "" : text) });
}

/* the ONE delegated tooltip handler */
function avHelpTipEvent(e) {
  try {
    if (!e || !e.type) return;
    if (e.type === "pointerout" || e.type === "focusout") {
      const rt = e.relatedTarget;
      const nxt = (rt && rt.nodeType === 1) ? avHelpTipSourceFor(rt) : null;
      if (nxt && avHelpTipState.src && nxt.el === avHelpTipState.src) return;   /* still inside the same control */
      avHelpTipHide();
      return;
    }
    if (e.type === "pointerover" || e.type === "focusin") {
      const src = avHelpTipSourceFor(e.target);
      if (!src) return;
      if (avHelpTipState.src === src.el && avHelpTipState.text === src.text) return;   /* no flicker */
      avHelpTipShow(src);
    }
  } catch (err) { /* a listener never throws outward */ }
}

function avHelpTip(el, text) {
  try {
    const target = (typeof el === "string") ? avHelpQuery(el) : el;
    if (!target || !target.setAttribute) return null;
    target.setAttribute("data-av-tip", String(text == null ? "" : text));
    return target;
  } catch (e) { return null; }
}

/* ================================ the tour engine ================================ */

/* the built-in 60-second tour — ~12 stops over the main cards, no actions (look, don't touch) */
function avHelpTourSteps() {
  return [
    { sel: null, title: "Welcome to Anvil",
      text: "Twelve stops, about a minute. Nothing here plays until you make it \u2014 this is just the map. NEXT is bottom right; SKIP leaves at any step." },
    { sel: "#piano-dock", title: "1 \u00b7 Play something",
      text: "Click the keys \u2014 hold to sustain, glide to sweep. Press ` to turn your typing keys into the dock: A-row white, W-row black, Z and X hop octaves." },
    { sel: "#av-synth", title: "2 \u00b7 Shape the sound",
      text: "One ENGINE select \u2014 VA, ACID, STRING, DRUM, GRANULAR, SAMPLER \u2014 then knobs. Every move commits straight to the live engine." },
    { sel: "#av-levels", title: "3 \u00b7 Set your levels",
      text: "Instrument is the keys bus, Master is the final out. Double-click a knob to reset; arrow keys step when it is focused." },
    { sel: "#av-fx", title: "4 \u00b7 The FX rack",
      text: "Five modules in a fixed chain: drive, mod, delay, verb, dyn. All off is bit-identical bypass \u2014 nothing colors your sound until you turn it on." },
    { sel: "#av-drums", title: "5 \u00b7 A kit",
      text: "DRUM pads: play them with the pointer, the dock or MIDI. Notes below the split route to the kit." },
    { sel: "#av-sample", title: "6 \u00b7 Your own sounds",
      text: "Drop a WAV on this card and hand it to GRANULAR or SAMPLER. Nothing is uploaded \u2014 it decodes right here." },
    { sel: "#av-seq", title: "7 \u00b7 Make a beat",
      text: "Four tracks, sixteen steps, swing, p-locks, chains and scenes. PLAY starts the audio-clock transport \u2014 the GUIDES tab has a first-beat recipe." },
    { sel: "#av-store", title: "8 \u00b7 Packs",
      text: "Nine factory banks, 548 presets \u2014 installed once, verified by sha-256, yours offline after that." },
    { sel: "#av-mix", title: "9 \u00b7 Mix \u0026 master",
      text: "Gain, pan, sends, ducking; a master chain with LUFS / true-peak targets. Render the mixdown, A/B it, export the WAV." },
    { sel: "#av-deliver", title: "10 \u00b7 Take it to your DAW",
      text: "One press renders stems + master + MIDI + README offline into a zip. GUIDES has 'Export stems to your DAW'." },
    { sel: null, title: "That\u2019s the loop",
      text: "Press ? any time, or Ctrl+K for every command. Now make something \u2014 nothing here is uploaded, and nothing you touch is fragile." },
  ];
}

function avHelpStartBuiltinTour() {
  avHelpClose();
  return avHelpTour(avHelpTourSteps());
}

/* the palette's preferred seam name (§2.E tries avHelpTour60 first, then avHelpTour() with no
   argument) — all three routes start the built-in 60-second tour. */
function avHelpTour60() { return avHelpStartBuiltinTour(); }

function avHelpTourSnap() {
  const st = avHelpTourState;
  return { active: st.active === true, step: st.active ? (st.i + 1) : 0, total: st.active ? st.steps.length : 0 };
}

function avHelpTourSync() {
  const s = avHelpTourSnap();
  avHelpTourLive.active = s.active;
  avHelpTourLive.step = s.step;
  avHelpTourLive.total = s.total;
  return avHelpTourLive;
}

/* build the cutout (four shading divs + a ring) and the step panel; pointer-events:none on the
   shading so the whole instrument stays live under a tour */
function avHelpTourBuild() {
  try {
    const shades = [];
    const sides = ["top", "bottom", "left", "right"];
    for (let i = 0; i < sides.length; i++) {
      const d = document.createElement("div");
      d.className = "av-tour-shade";
      d.setAttribute("data-av-tour", "shade");
      d.setAttribute("data-side", sides[i]);
      d.style.cssText = "position:fixed;pointer-events:none;z-index:1500;"
        + "background:rgba(4,10,13,.62);left:0;top:0;width:0;height:0;";
      document.body.appendChild(d);
      shades.push(d);
    }
    const ring = document.createElement("div");
    ring.className = "av-tour-ring";
    ring.setAttribute("data-av-tour", "ring");
    ring.style.cssText = "position:fixed;pointer-events:none;z-index:1501;left:0;top:0;width:0;height:0;"
      + "border:2px solid var(--teal,#2ED8C9);border-radius:8px;"
      + "box-shadow:0 0 0 1px rgba(46,216,201,.35),0 0 20px rgba(46,216,201,.45);";
    document.body.appendChild(ring);
    const panel = document.createElement("div");
    panel.className = "av-tour-panel";
    panel.setAttribute("data-av-tour", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Tour step");
    panel.style.cssText = "position:fixed;right:14px;bottom:calc(14px + var(--dock-tax, 0px));z-index:1502;"
      + "width:330px;max-width:calc(100vw - 28px);background:var(--panel,#10161b);"
      + "border:1px solid rgba(46,216,201,.35);border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,.6);"
      + "padding:10px 12px;color:var(--text-2,#c8d4da);font-size:13px;line-height:1.4;";
    panel.innerHTML = '<div class="av-tour-step"></div><div class="av-tour-title"></div>'
      + '<p class="av-tour-text"></p><div class="av-tour-actions">'
      + '<button type="button" class="av-btn mini av-tour-prev">\u25c0 BACK</button>'
      + '<button type="button" class="av-btn mini av-tour-next">NEXT \u25b6</button>'
      + '<button type="button" class="av-btn mini av-tour-skip">SKIP \u2715</button>'
      + "</div>";
    panel.addEventListener("click", avHelpTourPanelClick);
    document.body.appendChild(panel);
    document.body.classList.add("av-tour-on");
    return { shades: shades, ring: ring, panel: panel };
  } catch (e) { return null; }
}

function avHelpTourPanelClick(e) {
  try {
    const t = e && e.target;
    if (!t || typeof t.closest !== "function") return;
    const st = avHelpTourState;
    if (!st.active) return;
    if (t.closest(".av-tour-next")) { avHelpTourNext(st.token); return; }
    if (t.closest(".av-tour-prev")) { avHelpTourPrev(st.token); return; }
    if (t.closest(".av-tour-skip")) { avHelpTourStop(); }
  } catch (err) { /* the panel never throws outward */ }
}

/* recompute the cutout for the current step: sel resolved at step time, re-measured on
   resize/scroll so the hole follows the card (and a smooth-scroll, if any, stays framed) */
function avHelpTourFrame() {
  const st = avHelpTourState;
  const parts = st.parts;
  if (!parts || !st.active) return false;
  try {
    const el = st.tEl;
    let r = null;
    if (el && el.isConnected !== false && el.getBoundingClientRect) {
      const rr = el.getBoundingClientRect();
      if (rr && (rr.width > 0 || rr.height > 0)) r = rr;
    }
    if (!r) {
      for (let i = 0; i < parts.shades.length; i++) parts.shades[i].style.display = "none";
      parts.ring.style.display = "none";
      return true;
    }
    const P = 6;
    const vw = (typeof window !== "undefined" ? window.innerWidth : 0) || 1024;
    const vh = (typeof window !== "undefined" ? window.innerHeight : 0) || 768;
    const x0 = Math.max(0, Math.min(vw, r.left - P));
    const x1 = Math.max(0, Math.min(vw, r.right + P));
    const y0 = Math.max(0, Math.min(vh, r.top - P));
    const y1 = Math.max(0, Math.min(vh, r.bottom + P));
    const box = (d, left, top, w, h) => {
      if (!d) return;
      d.style.display = "block";
      d.style.left = left + "px";
      d.style.top = top + "px";
      d.style.width = Math.max(0, w) + "px";
      d.style.height = Math.max(0, h) + "px";
    };
    const sh = parts.shades;   /* [top, bottom, left, right] */
    box(sh[0], 0, 0, vw, y0);
    box(sh[1], 0, y1, vw, vh - y1);
    box(sh[2], 0, y0, x0, y1 - y0);
    box(sh[3], x1, y0, vw - x1, y1 - y0);
    box(parts.ring, x0, y0, x1 - x0, y1 - y0);
    return true;
  } catch (e) { return false; }
}

function avHelpTourPaint() {
  const st = avHelpTourState;
  const p = st.parts && st.parts.panel;
  if (!p || !p.querySelector) return false;
  const step = st.steps[st.i] || {};
  const n = st.steps.length;
  const elN = p.querySelector(".av-tour-step");
  if (elN) elN.textContent = "STEP " + (st.i + 1) + " / " + n;
  const elT = p.querySelector(".av-tour-title");
  if (elT) elT.textContent = String(step.title == null ? "" : step.title);
  const elX = p.querySelector(".av-tour-text");
  if (elX) elX.textContent = String(step.text == null ? "" : step.text);
  const next = p.querySelector(".av-tour-next");
  if (next) next.textContent = (st.i >= n - 1) ? "DONE \u2713" : "NEXT \u25b6";
  return true;
}

function avHelpTourEnter(i) {
  const st = avHelpTourState;
  if (!st.active || !st.steps.length) return false;
  st.i = Math.max(0, Math.min(i, st.steps.length - 1));
  const step = st.steps[st.i] || {};
  st.tEl = null;
  if (step.sel) {
    const el = avHelpQuery(step.sel);
    if (el) {
      st.tEl = el;
      avHelpScrollTo(el);
    }
  }
  avHelpTourFrame();
  avHelpTourPaint();
  avHelpTourSync();
  /* a fresh frame once layout settles (scrollIntoView can animate under a global scroll-behavior) */
  if (typeof window !== "undefined" && window.requestAnimationFrame) {
    try { window.requestAnimationFrame(() => { avHelpTourFrame(); }); } catch (e) { /* ok */ }
  }
  if (step.action) {
    try { if (typeof avLessonAction === "function") avLessonAction(step.action); } catch (e) { /* the seam is optional */ }
  }
  return true;
}

function avHelpTourNext(token) {
  const st = avHelpTourState;
  if (!st.active || token !== st.token) return avHelpTourSnap();
  if (st.i >= st.steps.length - 1) { avHelpTourStop(); return avHelpTourSnap(); }
  avHelpTourEnter(st.i + 1);
  return avHelpTourSnap();
}

function avHelpTourPrev(token) {
  const st = avHelpTourState;
  if (!st.active || token !== st.token) return avHelpTourSnap();
  if (st.i > 0) avHelpTourEnter(st.i - 1);
  return avHelpTourSnap();
}

function avHelpTourStop() {
  const st = avHelpTourState;
  st.active = false;
  st.steps = [];
  st.i = 0;
  st.tEl = null;
  if (st.onReframe) {
    try {
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", st.onReframe);
        window.removeEventListener("scroll", st.onReframe, true);
      }
    } catch (e) { /* ok */ }
    st.onReframe = null;
  }
  const parts = st.parts;
  st.parts = null;
  try {
    if (parts) {
      const nodes = parts.shades.concat([parts.ring, parts.panel]);
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n && n.parentNode) n.parentNode.removeChild(n);
      }
      if (typeof document !== "undefined" && document.body) document.body.classList.remove("av-tour-on");
    }
  } catch (e) { /* ok */ }
  avHelpTourSync();
  return avHelpTourSnap();
}

/* avHelpTour(steps) -> handle {next, prev, skip, done} (+ window.__avHelp.tour live snapshot).
   A new tour cleanly replaces a running one; a stale handle no-ops (token check). */
function avHelpTour(steps) {
  try {
    if (typeof document === "undefined" || !document.body) return null;
    if (steps === undefined || steps === null) steps = avHelpTourSteps();   /* no argument = the built-in 60-second tour */
    const list = [];
    if (Array.isArray(steps)) {
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        if (!s || typeof s !== "object") continue;
        list.push({
          sel: (typeof s.sel === "string" && s.sel) ? s.sel : null,
          title: String(s.title == null ? "" : s.title),
          text: String(s.text == null ? "" : s.text),
          action: (typeof s.action === "string" && s.action) ? s.action : null,
        });
      }
    }
    if (!list.length) return null;
    if (!avHelpInited) avHelpInit();
    avHelpTourStop();                        /* a new tour always replaces the old one, cleanly */
    const st = avHelpTourState;
    st.token += 1;
    st.steps = list;
    st.i = 0;
    st.active = true;
    st.parts = avHelpTourBuild();
    if (!st.parts) { st.active = false; st.steps = []; avHelpTourSync(); return null; }
    st.onReframe = () => { avHelpTourFrame(); };
    try {
      window.addEventListener("resize", st.onReframe);
      window.addEventListener("scroll", st.onReframe, true);
    } catch (e) { /* ok */ }
    avHelpTourEnter(0);
    const token = st.token;
    return {
      next: () => avHelpTourNext(token),
      prev: () => avHelpTourPrev(token),
      skip: () => { if (avHelpTourState.active && avHelpTourState.token === token) avHelpTourStop(); return avHelpTourSnap(); },
      done: () => { if (avHelpTourState.active && avHelpTourState.token === token) avHelpTourStop(); return avHelpTourSnap(); },
    };
  } catch (e) { return null; }
}

/* ================================ debug/verify surface ================================ */

if (typeof window !== "undefined") {
  window.__avHelp = { version: AV_HELP_VERSION, open: avHelpOpen, tour: avHelpTourLive };
}
