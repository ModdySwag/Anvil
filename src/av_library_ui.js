/* Anvil -- R21 LIBRARY overlay shell (child A): the full-surface LIBRARY surface that hosts
   the import module's library manager. Per verify/_r21_wave.md section 3 (the wave contract;
   this block is the module's receipt). The overlay is BUILT BY JS and appended to
   document.body at init -- NO body.html edit. The manager subsystem itself stays in
   src/av_import_ui.js and is handed the #av-library-body mount target (guarded
   avImportUiManagerMount). This module owns ONLY the shell: the pinned DOM, the open/close
   laws, the search-first focus, the status mirror and the facade.

   WHAT THIS IS -- a modal dialog over the whole surface:
     . ROOT    #av-library-pop.av-library-pop (role=dialog, aria-label=Library; hidden at
               rest; inline display:none so visibility never depends on a styles pass)
     . BOX     .av-library-box -- the dialog card (the ONLY containment the away-click law
               respects)
     . HEAD    .av-library-head -- .av-library-title "LIBRARY" + the close button
               #av-library-close (.av-btn mini .av-library-close; the house \u00d7 glyph;
               title "close (Esc)"; aria-label "Close the library")
     . STATUS  #av-library-status (.av-library-status .av-library-msg; role=status
               aria-live=polite; boots "library idle") -- the mirror line: every
               avImportUiSetStatus write is replicated here through avLibraryUiNote (kind
               "err" -> the av-library-err tint, the card-status pattern)
     . BODY    #av-library-body.av-library-body -- the manager mount target (the manager
               markup lives here once avImportUiManagerMount runs)

   NO .av-card / .av-zone / .av-zone-box classes anywhere inside the overlay (the cockpit
   card map and the zone scans stay untouched). z-index: styles.css places this overlay ONE
   STEP BELOW #av-palette (palette 1620 -> library 1610) so an open palette always renders
   over the library; the two never legitimately coexist (mutual exclusion below).

   LAWS:
   - "use strict"; classic script; ONE namespace (functions avLibraryUi, constants
     AV_LIBRARY_UI_); no DOM at top level beyond the guarded facade publication
     (node-loadable); never throws outward; no console noise; no timers; deterministic;
     ASCII-only source (non-ASCII glyphs ride \uXXXX escapes inside JS strings).
   - every cross-module call is typeof-guarded PER CALL (avPaletteRegister, avPaletteClose,
     avHelpClose, avImportUiManagerMount, avImportUiRefreshLib, avA11yAnnounce); a missing
     seam is an honest no-op. No proof text is ever emitted (the R12 leak law -- the
     console-proof seam is never called; this module paints no proof line).
   - Esc closes UNCONDITIONALLY while open (document keydown, capture TRUE -- the
     av_panels.js avAboutWireAway pattern; nothing is preventDefaulted, so av_kb's own
     Esc chains keep working).
   - away-click closes (document pointerdown, capture TRUE) when the target is outside
     .av-library-box AND outside #av-import-libopen (the strip button's own click drives
     the toggle; the pointerdown pre-close is what this exclusion prevents).
   - mutual exclusion: open() closes the palette and the help overlay first (guarded);
     conversely, a pointerdown outside while the palette sits over the library closes the
     library through the same away-click law.
   - focus contract: open focuses #av-import-search (fallback: the close button); close
     restores focus to the remembered opener when it is still connected.
   - idempotent init: built once (dataset flag avLibraryUi on the root + state), re-init
     safe; the document pair and the close-button listener bind once.

   OBSERVABLES: avLibraryUiInit() -> bool . avLibraryUiOpen() -> bool . avLibraryUiClose()
   -> bool . avLibraryUiToggle(force) -> bool (avAboutToggle shape: a boolean force wins,
   else flip) . avLibraryUiIsOpen() -> bool . avLibraryUiNote(msg, kind) -> bool (the
   status mirror; memo'd; safe before init) . avLibraryUiClasses() -> string[] (every NEW
   css class this module emits). Facade window.__avLibrary = {version, init, open, close,
   toggle, isOpen, note} -- the pinned smoke observable.

   PINS CONSUMED (all guarded): avPaletteRegister ({id:"lib.open", label:"Open library",
   group:"Library"}) . avPaletteClose / avHelpClose . avImportUiManagerMount (hosts the
   manager in #av-library-body) . avImportUiRefreshLib (open-time refresh) .
   avA11yAnnounce("Library").

   CSS CLASSES THIS MODULE NEEDS (the parent authors styles.css from this list; av-btn /
   mini are existing house classes and are NOT listed):
     .av-library-pop     the overlay root (fixed inset backdrop surface)
     .av-library-box     the dialog card
     .av-library-head .av-library-title .av-library-close    the head row + close button
     .av-library-status .av-library-msg .av-library-err      the mirror status line
     .av-library-body    the manager mount target

   ONE writer (child A, R21). */

"use strict";

const AV_LIBRARY_UI_VERSION = "r21.0";
const AV_LIBRARY_UI_ID = "av-library-pop";

/* the NEW css classes this module emits (the parent styles them from avLibraryUiClasses();
   av-btn / mini are existing house classes and are NOT listed) */
const AV_LIBRARY_UI_CLASSES = [
  "av-library-pop", "av-library-box", "av-library-head", "av-library-title",
  "av-library-close", "av-library-status", "av-library-msg", "av-library-err",
  "av-library-body",
];

/* UI-local state only -- the module owns no core facts */
const avLibraryUiState = {
  inited: false,
  open: false,
  wiredDoc: false,             /* the document pair (Esc + away pointerdown) binds once  */
  wiredClose: false,           /* the close-button click binds once                     */
  opener: null,                /* the element focus returns to on close                 */
  noteText: "library idle",    /* the mirror line (avImportUiSetStatus tail-writes here) */
  noteKind: "msg",
  noteMemo: { text: "\u0000", kind: "\u0000" },      /* write-on-change memo               */
};

/* ---------- guarded document access (no throw, no noise) ---------- */

function avLibraryUiDoc() {
  try { if (typeof document !== "undefined") return document; } catch (e) { /* none */ }
  return null;
}

/* the overlay root; null until init has built (or adopted) it */
function avLibraryUiEl() {
  try {
    const d = avLibraryUiDoc();
    if (d && typeof d.getElementById === "function") return d.getElementById(AV_LIBRARY_UI_ID);
  } catch (e) { /* no document */ }
  return null;
}

/* the mirror status span (root-scoped first; the pinned id is document-wide unique) */
function avLibraryUiStatusEl() {
  try {
    const root = avLibraryUiEl();
    if (root && typeof root.querySelector === "function") {
      const el = root.querySelector("#av-library-status");
      if (el) return el;
    }
    const d = avLibraryUiDoc();
    if (d && typeof d.getElementById === "function") return d.getElementById("av-library-status");
  } catch (e) { /* fall through */ }
  return null;
}

/* ---------- the status mirror (card pattern: text + err tint, memo'd) ---------- */

/* paint the stored note onto #av-library-status; write-on-change; false when no element */
function avLibraryUiPaintNote() {
  try {
    const s = avLibraryUiState;
    const el = avLibraryUiStatusEl();
    if (!el) return false;
    const text = String(s.noteText == null ? "" : s.noteText);
    const kind = (s.noteKind === "err") ? "err" : "msg";
    const memo = s.noteMemo || (s.noteMemo = { text: "\u0000", kind: "\u0000" });
    if (memo.text !== text) {
      if (el.textContent !== text) el.textContent = text;
      memo.text = text;
    }
    if (memo.kind !== kind) {
      const cls = el.classList;
      if (cls && typeof cls.add === "function") {
        if (kind === "err") cls.add("av-library-err");
        else cls.remove("av-library-err");
      }
      memo.kind = kind;
    }
    return true;
  } catch (e) { return false; }
}

/* the public mirror write (called BY av_import_ui's avImportUiSetStatus; kind "err" tints;
   safe before the overlay exists -- the note is remembered and painted at init) */
function avLibraryUiNote(msg, kind) {
  try {
    const s = avLibraryUiState;
    s.noteText = String(msg == null ? "" : msg);
    s.noteKind = (kind === "err") ? "err" : "msg";
    return avLibraryUiPaintNote();
  } catch (e) { return false; }
}

/* ---------- the pinned markup (built once, appended to document.body at init) ---------- */

function avLibraryUiBoxHTML() {
  return '<div class="av-library-box">' +
    '<div class="av-library-head">' +
    '<span class="av-library-title">LIBRARY</span>' +
    '<button type="button" id="av-library-close" class="av-btn mini av-library-close" aria-label="Close the library" title="close (Esc)">\u00d7</button>' +
    "</div>" +
    '<span class="av-library-status av-library-msg" id="av-library-status" role="status" aria-live="polite">library idle</span>' +
    '<div class="av-library-body" id="av-library-body"></div>' +
    "</div>";
}

/* ---------- the close + Esc + away wiring (bound once) ---------- */

function avLibraryUiOnCloseClick() {
  try { avLibraryUiClose(); } catch (e) { /* a listener never throws outward */ }
}

/* Esc: close while open, UNCONDITIONALLY (About pattern -- no preventDefault, so av_kb's
   own Esc chains keep running); the state OR the live hidden attribute counts as open */
function avLibraryUiOnKey(ev) {
  try {
    if (!ev || ev.key !== "Escape") return;
    const root = avLibraryUiEl();
    if ((root && root.hidden === false) || avLibraryUiState.open === true) avLibraryUiClose();
  } catch (e) { /* a listener never throws outward */ }
}

/* away-click: a pointerdown outside .av-library-box AND outside the strip button closes;
   the #av-import-libopen exclusion keeps the strip's own click from pre-closing us */
function avLibraryUiOnAway(ev) {
  try {
    if (avLibraryUiState.open !== true) return;
    const t = ev && ev.target;
    if (t && typeof t.closest === "function") {
      if (t.closest(".av-library-box")) return;
      if (t.closest("#av-import-libopen")) return;
    }
    avLibraryUiClose();
  } catch (e) { /* a listener never throws outward */ }
}

/* the document pair: keydown Esc (capture TRUE) + pointerdown away (capture TRUE) */
function avLibraryUiWireDoc() {
  try {
    const s = avLibraryUiState;
    if (s.wiredDoc) return true;
    const d = avLibraryUiDoc();
    if (!d || typeof d.addEventListener !== "function") return false;
    d.addEventListener("keydown", avLibraryUiOnKey, true);
    d.addEventListener("pointerdown", avLibraryUiOnAway, true);
    s.wiredDoc = true;
    return true;
  } catch (e) { return false; }
}

function avLibraryUiWireClose(root) {
  try {
    const s = avLibraryUiState;
    if (s.wiredClose) return true;
    const btn = (root && typeof root.querySelector === "function") ? root.querySelector("#av-library-close") : null;
    if (!btn || typeof btn.addEventListener !== "function") return false;
    btn.addEventListener("click", avLibraryUiOnCloseClick);
    s.wiredClose = true;
    return true;
  } catch (e) { return false; }
}

/* ---------- init (build + wire once; idempotent) ---------- */

function avLibraryUiInit() {
  try {
    const s = avLibraryUiState;
    const d = avLibraryUiDoc();
    if (!d || typeof d.createElement !== "function") return false;
    let root = avLibraryUiEl();
    const flagged = !!(root && root.dataset && root.dataset.avLibraryUi === "1");
    if (flagged && s.inited) return true;                          /* idempotent */
    if (!root) {
      root = d.createElement("div");
      root.id = AV_LIBRARY_UI_ID;
      root.className = "av-library-pop";
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-label", "Library");
      root.hidden = true;
      root.style.display = "none";        /* visibility truth before any style pass lands */
      root.innerHTML = avLibraryUiBoxHTML();
      const where = d.body || d.documentElement;
      if (!where || typeof where.appendChild !== "function") return false;
      where.appendChild(root);
      s.noteMemo = { text: "\u0000", kind: "\u0000" };   /* fresh markup needs its first paint */
    }
    const okClose = avLibraryUiWireClose(root);
    const okDoc = avLibraryUiWireDoc();
    /* the palette command (guarded; register-by-id is an upsert, so re-init is safe) */
    try {
      if (typeof avPaletteRegister === "function") {
        avPaletteRegister({
          id: "lib.open", label: "Open library", group: "Library",
          hint: "Search, browse and manage your imported files",
          run: () => avLibraryUiOpen(),
        });
      }
    } catch (e) { /* the palette is optional */ }
    /* hand the manager mount to the import hub (guarded; the manager half may land later,
       in which case open() retries the mount) */
    try {
      if (typeof avImportUiManagerMount === "function") {
        const bodyEl = (typeof d.getElementById === "function") ? d.getElementById("av-library-body") : null;
        if (bodyEl) avImportUiManagerMount(bodyEl);
      }
    } catch (e) { /* the manager half is optional at load time */ }
    avLibraryUiPaintNote();               /* reflect any note written before the overlay existed */
    if (okClose && okDoc) {
      s.inited = true;
      if (root.dataset) root.dataset.avLibraryUi = "1";
    }
    return !!(okClose && okDoc);          /* true when the root exists and is wired */
  } catch (e) { return false; }
}

/* ---------- open / close / toggle / isOpen ---------- */

/* search-first: #av-import-search when the manager is mounted, else the close button */
function avLibraryUiFocus() {
  const d = avLibraryUiDoc();
  if (!d) return false;
  let search = null;
  try { search = (typeof d.getElementById === "function") ? d.getElementById("av-import-search") : null; } catch (e) { search = null; }
  if (search && typeof search.focus === "function") {
    try { search.focus(); return true; } catch (e2) { /* fall through to the close button */ }
  }
  const root = avLibraryUiEl();
  const btn = (root && typeof root.querySelector === "function") ? root.querySelector("#av-library-close") : null;
  if (btn && typeof btn.focus === "function") {
    try { btn.focus(); return true; } catch (e3) { return false; }
  }
  return false;
}

function avLibraryUiOpen() {
  try {
    const s = avLibraryUiState;
    if (!s.inited) avLibraryUiInit();                     /* lazy safety: boot inits anyway */
    const d = avLibraryUiDoc();
    if (!d) return false;
    const root = avLibraryUiEl();
    if (!root) return false;
    if (s.open === true) { avLibraryUiFocus(); return true; }
    /* mutual exclusion: the palette and the help overlay close first (each guarded) */
    try { if (typeof avPaletteClose === "function") avPaletteClose(); } catch (e) { /* the palette is optional */ }
    try { if (typeof avHelpClose === "function") avHelpClose(); } catch (e) { /* the help overlay is optional */ }
    /* remember the opener (a body/documentElement focus is not a useful return target) */
    let prev = null;
    try {
      const ae = d.activeElement;
      if (ae && ae !== d.body && ae !== d.documentElement) prev = ae;
    } catch (e) { prev = null; }
    s.opener = prev;
    s.open = true;
    root.hidden = false;
    root.style.display = "";                              /* hand layout back to the parent CSS */
    /* the manager half may have landed after init: retry the guarded mount, then refresh */
    try {
      if (typeof avImportUiManagerMount === "function") {
        const bodyEl = (typeof d.getElementById === "function") ? d.getElementById("av-library-body") : null;
        if (bodyEl) avImportUiManagerMount(bodyEl);
      }
    } catch (e2) { /* the manager half is optional */ }
    try { if (typeof avImportUiRefreshLib === "function") avImportUiRefreshLib(); } catch (e3) { /* the hub card is optional */ }
    avLibraryUiFocus();
    try { if (typeof avA11yAnnounce === "function") avA11yAnnounce("Library"); } catch (e4) { /* a11y is optional */ }
    return true;
  } catch (e) {
    avLibraryUiState.open = false;
    return false;
  }
}

function avLibraryUiClose() {
  try {
    const s = avLibraryUiState;
    const root = avLibraryUiEl();
    if (!root) return false;                              /* nothing built: honest no-op */
    s.open = false;
    root.hidden = true;
    root.style.display = "none";
    const prev = s.opener;
    s.opener = null;
    try {
      if (prev && prev.isConnected === true && typeof prev.focus === "function") prev.focus();
    } catch (e) { /* focus restore is best effort */ }
    return true;
  } catch (e) { return false; }
}

/* the avAboutToggle shape: a boolean force wins, else flip; returns the state it asked for */
function avLibraryUiToggle(force) {
  try {
    if (!avLibraryUiState.inited) avLibraryUiInit();
    const root = avLibraryUiEl();
    if (!root) return false;
    const show = (typeof force === "boolean") ? force : (avLibraryUiState.open !== true);
    if (show) avLibraryUiOpen(); else avLibraryUiClose();
    return show;
  } catch (e) { return false; }
}

function avLibraryUiIsOpen() {
  return avLibraryUiState.open === true;
}

function avLibraryUiClasses() {
  return AV_LIBRARY_UI_CLASSES.slice();
}

/* ---------- the facade (a pinned test observable; the av_panels publication pattern) ------ */

if (typeof window !== "undefined" && window) {
  try {
    window.__avLibrary = {
      version: AV_LIBRARY_UI_VERSION,
      init: function () { return avLibraryUiInit(); },
      open: function () { return avLibraryUiOpen(); },
      close: function () { return avLibraryUiClose(); },
      toggle: function (f) { return avLibraryUiToggle(f); },
      isOpen: function () { return avLibraryUiIsOpen(); },
      note: function (m, k) { return avLibraryUiNote(m, k); },
    };
  } catch (e) { /* no window - nothing to publish */ }
}
