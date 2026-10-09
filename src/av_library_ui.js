/* Anvil -- R21 LIBRARY overlay shell (child A): the full-surface LIBRARY surface that hosts
   the import module's library manager. Per verify/_r21_wave.md section 3 (the wave contract;
   this block is the module's receipt). The overlay is BUILT BY JS and appended to
   document.body at init -- NO body.html edit. The manager subsystem itself stays in
   src/av_import_ui.js and is handed the #av-library-body mount target (guarded
   avImportUiManagerMount). This module owns ONLY the shell: the pinned DOM, the open/close
   laws, the search-first focus, the status mirror and the facade.

   R22 EXTENSION (verify/_r22_wave.md section 2 -- the wave contract): the shell gains the
   drag-to-resize grip, the minimize/maximize head toggles, the LS size pref av-library-pref,
   away-click suppression while minimized, and the snap() facade key. The ONLY behavior
   change to an existing law: the away-click close is suppressed while state.min is true
   (Esc, the close button and the hub strip button still close unconditionally).

   WHAT THIS IS -- a modal dialog over the whole surface:
     . ROOT    #av-library-pop.av-library-pop (role=dialog, aria-label=Library; hidden at
               rest; inline display:none so visibility never depends on a styles pass;
               R22: the state classes av-lib-min / av-lib-max are toggled here)
     . BOX     .av-library-box -- the dialog card (the ONLY containment the away-click law
               respects; R22: the resize target -- inline width/height px once sized)
     . HEAD    .av-library-head -- .av-library-title "LIBRARY" + the min/max/close buttons
               (DOM order: title, min, max, close)
               #av-library-min (.av-btn mini .av-library-min; the \u2013 glyph;
               title "minimize (stays open)" / "restore"; aria-pressed mirrors state.min)
               #av-library-max (.av-btn mini .av-library-max; the \u25a1 glyph;
               title "maximize" / "restore (back to size)"; aria-pressed mirrors state.max)
               #av-library-close (.av-btn mini .av-library-close; the house \u00d7 glyph;
               title "close (Esc)"; aria-label "Close the library")
     . STATUS  #av-library-status (.av-library-status .av-library-msg; role=status
               aria-live=polite; boots "library idle") -- the mirror line: every
               avImportUiSetStatus write is replicated here through avLibraryUiNote (kind
               "err" -> the av-library-err tint, the card-status pattern)
     . BODY    #av-library-body.av-library-body -- the manager mount target (the manager
               markup lives here once avImportUiManagerMount runs)
     . GRIP    .av-library-grip (data-av-library-grip=1; title "drag to resize
               (double-click resets)"; aria-hidden) -- appended INSIDE .av-library-box
               after the body div; the pointer-capture drag below resizes the box

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
     the toggle; the pointerdown pre-close is what this exclusion prevents). R22: the away
     handler early-returns while state.min is true (the minimized library stays put); the
     grip sits inside .av-library-box, so the existing exclusion already covers it.
   - R22 minimize (state.min): the #av-library-min click toggles it and clears max; root
     class av-lib-min; the parent CSS docks the box and stops the backdrop blocking the
     app (class toggling only here -- no inline styles). R22 maximize (state.max): the
     #av-library-max click toggles it and clears min; root class av-lib-max. Both buttons
     mirror aria-pressed + title. open() always resets to normal.
   - R22 resize (normal state only -- guarded return when min || max): the grip's
     pointerdown records the live box rect as the gesture base, setPointerCapture on the
     grip; pointermove applies base+delta as inline width/height px clamped to
     [640, innerWidth-32] x [340, innerHeight-32]; pointerup persists {v:1,w,h} to LS
     av-library-pref and stores state.size. double-click on the grip clears the pref
     (LS removeItem), the inline styles and state.size. The pref is read ONCE at init
     (tolerant junk -> null) and re-applied clamped by open(); close() never touches it.
   - mutual exclusion: open() closes the palette and the help overlay first (guarded);
     conversely, a pointerdown outside while the palette sits over the library closes the
     library through the same away-click law.
   - focus contract: open focuses #av-import-search (fallback: the close button); close
     restores focus to the remembered opener when it is still connected.
   - idempotent init: built once (dataset flag avLibraryUi on the root + state), re-init
     safe; the document pair, the close-button listener and the R22 controls bind once.

   OBSERVABLES: avLibraryUiInit() -> bool . avLibraryUiOpen() -> bool . avLibraryUiClose()
   -> bool . avLibraryUiToggle(force) -> bool (avAboutToggle shape: a boolean force wins,
   else flip) . avLibraryUiIsOpen() -> bool . avLibraryUiNote(msg, kind) -> bool (the
   status mirror; memo'd; safe before init) . avLibraryUiClasses() -> string[] (every NEW
   css class this module emits) . avLibraryUiSnap() -> {open, state: "min"|"max"|"normal",
   w, h, pref: {w,h}|null, grip: bool} (w/h = the box's getBoundingClientRect rounded;
   grip = the grip element exists). Facade window.__avLibrary = {version, init, open,
   close, toggle, isOpen, note, snap} -- the pinned smoke observable.

   PINS CONSUMED (all guarded): avPaletteRegister ({id:"lib.open", label:"Open library",
   group:"Library"}) . avPaletteClose / avHelpClose . avImportUiManagerMount (hosts the
   manager in #av-library-body) . avImportUiRefreshLib (open-time refresh) .
   avA11yAnnounce("Library").

   CSS CLASSES THIS MODULE NEEDS (the parent authors styles.css from this list; av-btn /
   mini are existing house classes and are NOT listed):
     .av-library-pop     the overlay root (fixed inset backdrop surface)
     .av-library-box     the dialog card (R22: the inline-resize target)
     .av-library-head .av-library-title .av-library-close    the head row + close button
     .av-library-status .av-library-msg .av-library-err      the mirror status line
     .av-library-body    the manager mount target
     .av-library-grip    R22: the resize grip (inside the box, after the body div)
     .av-library-min .av-library-max                         R22: the head toggle buttons
   ROOT STATE CLASSES toggled by R22 (pinned in the wave contract; not in the emitted
   array below): .av-lib-min (docked minimized) and .av-lib-max (fill maximized)

   ONE writer (child A; R21 shell + the R22 shell extension). */

"use strict";

const AV_LIBRARY_UI_VERSION = "r21.0";
const AV_LIBRARY_UI_ID = "av-library-pop";

/* R22: the LS size pref key + the resize bounds (w 640..innerWidth-32, h 340..innerHeight-32) */
const AV_LIBRARY_UI_PREF_KEY = "av-library-pref";
const AV_LIBRARY_UI_MIN_W = 640;
const AV_LIBRARY_UI_MIN_H = 340;
const AV_LIBRARY_UI_EDGE = 32;

/* the NEW css classes this module emits (the parent styles them from avLibraryUiClasses();
   av-btn / mini are existing house classes and are NOT listed) */
const AV_LIBRARY_UI_CLASSES = [
  "av-library-pop", "av-library-box", "av-library-head", "av-library-title",
  "av-library-close", "av-library-status", "av-library-msg", "av-library-err",
  "av-library-body", "av-library-grip", "av-library-min", "av-library-max",
];

/* UI-local state only -- the module owns no core facts */
const avLibraryUiState = {
  inited: false,
  open: false,
  min: false,                  /* R22: minimized (root class av-lib-min; away-close off)   */
  max: false,                  /* R22: maximized (root class av-lib-max)                   */
  size: null,                  /* R22: the last applied box size {w,h}, or null = default  */
  resizing: false,             /* R22: a grip pointer drag is in flight                    */
  wiredDoc: false,             /* the document pair (Esc + away pointerdown) binds once  */
  wiredClose: false,           /* the close-button click binds once                     */
  wiredControls: false,        /* R22: the min/max clicks + the grip drag bind once     */
  opener: null,                /* the element focus returns to on close                 */
  noteText: "library idle",    /* the mirror line (avImportUiSetStatus tail-writes here) */
  noteKind: "msg",
  noteMemo: { text: "\u0000", kind: "\u0000" },      /* write-on-change memo */
};

/* R22: the LS pref mirror (read ONCE at init; every write/clear keeps it in sync so no
   code path re-reads raw LS mid-session) + the in-flight grip gesture geometry */
let avLibraryUiPref = null;          /* {v:1,w,h} or null = the CSS default size */
let avLibraryUiPrefLoaded = false;   /* the one-shot init read has run           */
const avLibraryUiDrag = { active: false, pid: 1, x0: 0, y0: 0, w0: 0, h0: 0, w: 0, h: 0 };

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

/* the dialog card (the away-click containment; R22: the resize target) */
function avLibraryUiBoxEl(root) {
  try {
    const r = root || avLibraryUiEl();
    if (r && typeof r.querySelector === "function") return r.querySelector(".av-library-box");
  } catch (e) { /* no root yet */ }
  return null;
}

/* the R22 resize grip inside the box */
function avLibraryUiGripEl(root) {
  try {
    const r = root || avLibraryUiEl();
    if (r && typeof r.querySelector === "function") return r.querySelector(".av-library-grip");
  } catch (e) { /* no root yet */ }
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

/* ---------- R22: the LS size pref + the clamp (av-library-pref) ---------- */

/* tolerant read: JSON {v:1,w,h} with finite positive w/h, else null (junk never throws) */
function avLibraryUiPrefLoad() {
  try {
    const st = (typeof window !== "undefined" && window && window.localStorage) ? window.localStorage : null;
    if (!st || typeof st.getItem !== "function") return null;
    const raw = st.getItem(AV_LIBRARY_UI_PREF_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object") return null;
    const pw = Number(j.w), ph = Number(j.h);
    if (!isFinite(pw) || !isFinite(ph) || pw <= 0 || ph <= 0) return null;
    return { v: 1, w: pw, h: ph };
  } catch (e) { return null; }
}

/* persist {v:1,w,h} to LS + the mirror (a refusing LS still updates the mirror) */
function avLibraryUiPrefWrite(size) {
  try {
    const rec = { v: 1, w: Math.round(Number(size.w) || 0), h: Math.round(Number(size.h) || 0) };
    avLibraryUiPref = rec;
    const st = (typeof window !== "undefined" && window && window.localStorage) ? window.localStorage : null;
    if (st && typeof st.setItem === "function") st.setItem(AV_LIBRARY_UI_PREF_KEY, JSON.stringify(rec));
    return true;
  } catch (e) { return false; }
}

/* the double-click reset: drop the pref (LS removeItem) + the mirror */
function avLibraryUiPrefClear() {
  try {
    avLibraryUiPref = null;
    const st = (typeof window !== "undefined" && window && window.localStorage) ? window.localStorage : null;
    if (st && typeof st.removeItem === "function") st.removeItem(AV_LIBRARY_UI_PREF_KEY);
    return true;
  } catch (e) { return false; }
}

/* clamp a candidate size into [640, innerWidth-32] x [340, innerHeight-32] (rounded px) */
function avLibraryUiClampSize(w, h) {
  let iw = 0, ih = 0;
  try {
    if (typeof window !== "undefined" && window) {
      iw = Number(window.innerWidth) || 0;
      ih = Number(window.innerHeight) || 0;
    }
  } catch (e) { iw = 0; ih = 0; }
  const hiW = Math.max(0, Math.round(iw) - AV_LIBRARY_UI_EDGE);
  const hiH = Math.max(0, Math.round(ih) - AV_LIBRARY_UI_EDGE);
  const nw = Math.min(Math.max(Math.round(Number(w) || 0), AV_LIBRARY_UI_MIN_W), hiW);
  const nh = Math.min(Math.max(Math.round(Number(h) || 0), AV_LIBRARY_UI_MIN_H), hiH);
  return { w: nw, h: nh };
}

/* ---------- R22: root classes, button mirrors, the applied size ---------- */

/* mirror min/max onto the root classes (av-lib-min / av-lib-max) and the two buttons */
function avLibraryUiRootSync() {
  try {
    const s = avLibraryUiState;
    const root = avLibraryUiEl();
    if (root && root.classList && typeof root.classList.add === "function") {
      if (s.min === true) root.classList.add("av-lib-min"); else root.classList.remove("av-lib-min");
      if (s.max === true) root.classList.add("av-lib-max"); else root.classList.remove("av-lib-max");
    }
    const minBtn = (root && typeof root.querySelector === "function") ? root.querySelector("#av-library-min") : null;
    if (minBtn && typeof minBtn.setAttribute === "function") {
      minBtn.setAttribute("aria-pressed", s.min === true ? "true" : "false");
      minBtn.title = (s.min === true) ? "restore" : "minimize (stays open)";
    }
    const maxBtn = (root && typeof root.querySelector === "function") ? root.querySelector("#av-library-max") : null;
    if (maxBtn && typeof maxBtn.setAttribute === "function") {
      maxBtn.setAttribute("aria-pressed", s.max === true ? "true" : "false");
      maxBtn.title = (s.max === true) ? "restore (back to size)" : "maximize";
    }
    return true;
  } catch (e) { return false; }
}

/* clear the inline box size (back to the CSS default width/height) */
function avLibraryUiSizeClearInline() {
  try {
    const box = avLibraryUiBoxEl();
    if (box && box.style) { box.style.width = ""; box.style.height = ""; return true; }
    return false;
  } catch (e) { return false; }
}

/* apply a clamped px size to the box inline styles; state.size mirrors it */
function avLibraryUiSizeApply(size) {
  try {
    const s = avLibraryUiState;
    const c = avLibraryUiClampSize(size.w, size.h);
    const box = avLibraryUiBoxEl();
    if (box && box.style) { box.style.width = c.w + "px"; box.style.height = c.h + "px"; }
    s.size = { w: c.w, h: c.h };
    return c;
  } catch (e) { return null; }
}

/* ---------- the pinned markup (built once, appended to document.body at init) ---------- */

function avLibraryUiBoxHTML() {
  return '<div class="av-library-box">' +
    '<div class="av-library-head">' +
    '<span class="av-library-title">LIBRARY</span>' +
    '<button type="button" id="av-library-min" class="av-btn mini av-library-min" title="minimize (stays open)" aria-label="Minimize the library (stays open)" aria-pressed="false">\u2013</button>' +
    '<button type="button" id="av-library-max" class="av-btn mini av-library-max" title="maximize" aria-label="Maximize the library" aria-pressed="false">\u25a1</button>' +
    '<button type="button" id="av-library-close" class="av-btn mini av-library-close" aria-label="Close the library" title="close (Esc)">\u00d7</button>' +
    "</div>" +
    '<span class="av-library-status av-library-msg" id="av-library-status" role="status" aria-live="polite">library idle</span>' +
    '<div class="av-library-body" id="av-library-body"></div>' +
    '<div class="av-library-grip" data-av-library-grip="1" title="drag to resize (double-click resets)" aria-hidden="true"></div>' +
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
   the #av-import-libopen exclusion keeps the strip's own click from pre-closing us.
   R22: the one behavior change -- while minimized the library stays put (early-return
   when state.min is true); Esc, the close button and the strip button stay unconditional. */
function avLibraryUiOnAway(ev) {
  try {
    const s = avLibraryUiState;
    if (s.open !== true) return;
    if (s.min === true) return;
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

/* ---------- R22: min/max clicks + the grip drag (the controls wire) ---------- */

function avLibraryUiOnMinClick() {
  try {
    const s = avLibraryUiState;
    if (s.min === true) { s.min = false; }
    else { s.min = true; s.max = false; }
    avLibraryUiRootSync();
  } catch (e) { /* a listener never throws outward */ }
}

function avLibraryUiOnMaxClick() {
  try {
    const s = avLibraryUiState;
    if (s.max === true) { s.max = false; }
    else { s.max = true; s.min = false; }
    avLibraryUiRootSync();
  } catch (e) { /* a listener never throws outward */ }
}

/* pointerdown on the grip: normal state only (guarded return when min || max); records
   the live box rect as the gesture base and captures the pointer on the grip */
function avLibraryUiOnGripDown(ev) {
  try {
    const s = avLibraryUiState;
    if (s.open !== true || s.min === true || s.max === true) return;
    const box = avLibraryUiBoxEl();
    if (!box || typeof box.getBoundingClientRect !== "function") return;
    const r = box.getBoundingClientRect();
    const d = avLibraryUiDrag;
    d.active = true;
    d.pid = (ev && typeof ev.pointerId === "number") ? ev.pointerId : 1;
    d.x0 = Number(ev && ev.clientX) || 0;
    d.y0 = Number(ev && ev.clientY) || 0;
    d.w0 = Number(r.width) || 0;
    d.h0 = Number(r.height) || 0;
    d.w = Math.round(d.w0);
    d.h = Math.round(d.h0);
    s.resizing = true;
    const grip = avLibraryUiGripEl();
    if (grip && typeof grip.setPointerCapture === "function") {
      try { grip.setPointerCapture(d.pid); } catch (e2) { /* capture is best-effort */ }
    }
  } catch (e) { /* a listener never throws outward */ }
}

/* pointermove (window, bound once): base + delta, clamped, as inline px */
function avLibraryUiOnGripMove(ev) {
  try {
    const s = avLibraryUiState;
    const d = avLibraryUiDrag;
    if (s.resizing !== true || d.active !== true) return;
    if (ev && typeof ev.pointerId === "number" && ev.pointerId !== d.pid) return;
    const c = avLibraryUiClampSize(d.w0 + ((Number(ev && ev.clientX) || 0) - d.x0),
                                   d.h0 + ((Number(ev && ev.clientY) || 0) - d.y0));
    const box = avLibraryUiBoxEl();
    if (box && box.style) { box.style.width = c.w + "px"; box.style.height = c.h + "px"; }
    d.w = c.w;
    d.h = c.h;
  } catch (e) { /* a listener never throws outward */ }
}

/* pointerup (window, bound once): finalize the clamped size, persist the pref, store size */
function avLibraryUiOnGripUp(ev) {
  try {
    const s = avLibraryUiState;
    const d = avLibraryUiDrag;
    if (s.resizing !== true || d.active !== true) return;
    if (ev && typeof ev.pointerId === "number" && ev.pointerId !== d.pid) return;
    d.active = false;
    s.resizing = false;
    const c = avLibraryUiClampSize(d.w, d.h);
    const box = avLibraryUiBoxEl();
    if (box && box.style) { box.style.width = c.w + "px"; box.style.height = c.h + "px"; }
    /* R22 calibration (triage 2026-10-09): persist the ACHIEVED size -- the overlay container's
       padding caps the rendered width below the computed target (1440 vp: target 1408, rendered
       1344), and the pref must match the size the user actually has */
    let fin = c;
    try {
      if (box && typeof box.getBoundingClientRect === "function") {
        const r = box.getBoundingClientRect();
        if (r && isFinite(r.width) && isFinite(r.height) && r.width > 0 && r.height > 0) {
          fin = avLibraryUiClampSize(Math.round(r.width), Math.round(r.height));
        }
      }
    } catch (e2) { /* the computed target stands */ }
    avLibraryUiPrefWrite(fin);
    s.size = { w: fin.w, h: fin.h };
  } catch (e) { /* a listener never throws outward */ }
}

/* double-click on the grip: the reset (pref cleared, inline size cleared, size null) */
function avLibraryUiOnGripDbl() {
  try {
    const s = avLibraryUiState;
    if (s.open !== true || s.min === true || s.max === true) return;
    avLibraryUiPrefClear();
    s.size = null;
    avLibraryUiSizeClearInline();
  } catch (e) { /* a listener never throws outward */ }
}

/* the R22 controls: min/max clicks + the grip drag pair; binds once (best effort) */
function avLibraryUiWireControls(root) {
  try {
    const s = avLibraryUiState;
    if (s.wiredControls) return true;
    const w = (typeof window !== "undefined" && window) ? window : null;
    if (!w || typeof w.addEventListener !== "function") return false;
    const r = root || avLibraryUiEl();
    if (!r || typeof r.querySelector !== "function") return false;
    const minBtn = r.querySelector("#av-library-min");
    const maxBtn = r.querySelector("#av-library-max");
    const grip = r.querySelector(".av-library-grip");
    if (!minBtn || !maxBtn || !grip) return false;
    if (typeof minBtn.addEventListener !== "function" || typeof maxBtn.addEventListener !== "function") return false;
    if (typeof grip.addEventListener !== "function") return false;
    minBtn.addEventListener("click", avLibraryUiOnMinClick);
    maxBtn.addEventListener("click", avLibraryUiOnMaxClick);
    grip.addEventListener("pointerdown", avLibraryUiOnGripDown);
    grip.addEventListener("dblclick", avLibraryUiOnGripDbl);
    w.addEventListener("pointermove", avLibraryUiOnGripMove);
    w.addEventListener("pointerup", avLibraryUiOnGripUp);
    s.wiredControls = true;
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
    /* R22: ONE tolerant read of the size pref (junk -> null; a refusing LS is tolerated) */
    if (avLibraryUiPrefLoaded !== true) {
      avLibraryUiPrefLoaded = true;
      avLibraryUiPref = avLibraryUiPrefLoad();
    }
    const okClose = avLibraryUiWireClose(root);
    const okDoc = avLibraryUiWireDoc();
    avLibraryUiWireControls(root);        /* R22: min/max + grip (best effort; shell-safe) */
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
    /* R22: open always starts NORMAL (min/max reset, any stale drag dropped) and re-applies
       the stored pref size when present (clamped); without a pref the CSS default stands */
    s.min = false;
    s.max = false;
    s.resizing = false;
    avLibraryUiDrag.active = false;
    avLibraryUiRootSync();
    if (avLibraryUiPref) avLibraryUiSizeApply(avLibraryUiPref);
    else { s.size = null; avLibraryUiSizeClearInline(); }
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

/* ---------- R22: the snap (a pinned read-only observable) ---------- */

/* {open, state, w, h, pref, grip} -- w/h are the box's getBoundingClientRect rounded;
   pref is the stored size {w,h} or null; grip says the grip element exists */
function avLibraryUiSnap() {
  try {
    const s = avLibraryUiState;
    const root = avLibraryUiEl();
    const state = (s.min === true) ? "min" : ((s.max === true) ? "max" : "normal");
    let w = 0, h = 0, grip = false;
    const box = avLibraryUiBoxEl(root);
    if (box && typeof box.getBoundingClientRect === "function") {
      const r = box.getBoundingClientRect();
      w = Math.round(Number(r.width) || 0);
      h = Math.round(Number(r.height) || 0);
    }
    grip = !!avLibraryUiGripEl(root);
    const p = avLibraryUiPref;
    return {
      open: s.open === true,
      state: state,
      w: w,
      h: h,
      pref: p ? { w: p.w, h: p.h } : null,
      grip: grip,
    };
  } catch (e) {
    return { open: false, state: "normal", w: 0, h: 0, pref: null, grip: false };
  }
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
      snap: function () { return avLibraryUiSnap(); },
    };
  } catch (e) { /* no window - nothing to publish */ }
}
