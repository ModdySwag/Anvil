/* Anvil -- LINKED SOURCES section (R18b wave, child B): the hub-card section that lists the
   folders linked through the File System Access seam and drives their ops -- link . re-scan .
   import-new . reconnect . unlink. Per verify/_r18b_wave.md section 4 (Child B pins). The core
   (`src/av_sources.js`, child A) owns the store, the walk, the diff and the facade
   `window.__avSources`; THIS module fills the parent-owned host `#av-sources-host` (child C
   inserts the bare div in the import card body, after the storage foot) and routes every op
   through the facade GUARDED PER CALL -- the core may load after this file, or not at all:
   the section still mounts and every action refuses honestly on the status line, never a throw.
   The WALK SURFACE is the core's (wave D3); the ROW STATES are this module's (busy attr .
   perm-driven RECONNECT . IMPORT disabled at 0 . counts . notes).

   WHAT THIS SECTION IS -- one header + one row per linked folder:
     . HEAD    .av-sources-head -- `LINKED SOURCES` title + the status span `#av-sources-status`
               (role=status, aria-live=polite) + the LINK button `#av-sources-link`
               (`av-btn mini`, label "LINK FOLDER") -> __avSources.link().
     . EMPTY   .av-sources-empty -- one honest empty state; it says WHICH state it is: the core
               absent, the folder list refused, no File System Access API in this browser, or
               the pinned "no linked folders -- link one to re-scan and diff it against the
               library". Respects the hidden attribute (never display-forced) while rows exist.
     . ROWS    .av-sources-row[data-id] (data-perm = the last permission read) -- name
               .av-sources-name + meta .av-sources-meta ("linked . last scan HH:MM . new N .
               changed N . gone N", plus the record's own note when it carries one) + buttons:
               RECONNECT (.av-sources-reconnect, only when perm !== "granted") .
               RE-SCAN (.av-sources-scan) . IMPORT NEW (N) (.av-sources-import, disabled when
               N = 0) . UNLINK (.av-sources-unlink). Every button is `av-btn mini` (the
               icon-box law: wide text labels ride the mini auto-width pattern; labels stay
               single-line).
     . BUSY    ONE op at a time: the row running an op carries data-busy="1" (+ aria-busy), the
               section root carries aria-busy, every button in the section disables; a second
               request refuses honestly on the status line. No timers, no polling -- ops
               self-refresh through avSourcesUiRefresh().
     . STATUS  ops report through the existing card status span `#av-import-status` when
               reachable, else this section's own `#av-sources-status`; the pin's cancel case
               (D4: AbortError -> error "cancelled") is a calm message, no error state.

   DOM CONTRACT (exact -- the wave pins these):
     host      #av-sources-host         parent-owned (child C); absent -> avSourcesUiInit()
                                        returns false and stays re-init safe (idempotent via
                                        host.dataset.avSourcesUi; re-mountable after a wipe)
     section   .av-sources
     head      .av-sources-head .av-sources-title .av-sources-status (#av-sources-status,
               role=status aria-live=polite)
     link      #av-sources-link (label "LINK FOLDER")
     empty     .av-sources-empty (respects the hidden attribute -- never display-forced)
     list      .av-sources-list (the rows container)
     rows      .av-sources-row[data-id] .av-sources-name .av-sources-meta
     buttons   .av-sources-reconnect .av-sources-scan .av-sources-import .av-sources-unlink
     state     data-busy="1" (+ aria-busy) on the row running an op; aria-busy on the section
               root; dataset avSourcesWired on the host (delegation bound once); dataset
               avSourcesUi on the host (mount flag, the idempotence gate)

   OBSERVABLES: avSourcesUiInit() -> bool (false without #av-sources-host; idempotent;
   re-mountable) . avSourcesUiRefresh() -> Promise<bool> (never rejects; one guarded
   __avSources.list() read -> rows repaint; ops self-refresh through it) . avSourcesUiClasses()
   -> string[] (every NEW css class this section emits). Facade additions NONE -- the core's
   window.__avSources is the single rig surface; this module publishes nothing on window.

   CONSTANTS this module owns: AV_SOURCES_UI_VERSION ("r18b.0") . AV_SOURCES_UI_ROWS_MAX 500
   (rows painted) . AV_SOURCES_UI_CLASSES (below).

   CSS CLASSES THIS MODULE NEEDS (the parent authors styles.css from this list; av-btn / mini /
   av-note / av-dim are existing house classes; #av-sources-host is parent-owned):
     .av-sources          the section root
     .av-sources-head .av-sources-title .av-sources-status (+ .av-sources-msg base /
                          .av-sources-err toggled)   the header row + status line
     .av-sources-link     the LINK FOLDER button
     .av-sources-empty    the empty state (respects the hidden attribute)
     .av-sources-list     the rows container
     .av-sources-more     the "showing the first N" truncation note
     .av-sources-row      one folder row (.av-sources-name . .av-sources-meta)
     .av-sources-reconnect .av-sources-scan .av-sources-import .av-sources-unlink
                          the row buttons (wide text labels: style with white-space:nowrap --
                          the wide-button law for text .av-btn)

   LAWS (house): "use strict"; classic script; ONE namespace avSourcesUi* / AV_SOURCES_UI_*;
   NO DOM at top level (node-loadable); every listener and every cross-module reach wrapped
   (never throws outward); no console noise; no timers; deterministic; ASCII-only source;
   ONE writer (child B, R18b). */

"use strict";

const AV_SOURCES_UI_VERSION = "r18b.0";
const AV_SOURCES_UI_ROWS_MAX = 500;      /* folder rows painted (the house cap law)           */

/* the NEW css classes this section emits (the parent styles them from avSourcesUiClasses();
   av-btn / mini / av-note / av-dim are existing house classes and are NOT listed;
   #av-sources-host is the parent-owned host). Dynamic/state classes are listed all the same. */
const AV_SOURCES_UI_CLASSES = [
  "av-sources", "av-sources-head", "av-sources-title",
  "av-sources-status", "av-sources-msg", "av-sources-err",
  "av-sources-link", "av-sources-empty", "av-sources-list", "av-sources-more",
  "av-sources-row", "av-sources-name", "av-sources-meta",
  "av-sources-reconnect", "av-sources-scan", "av-sources-import", "av-sources-unlink",
];

/* UI-local state only -- every core fact is read through window.__avSources per call */
const avSourcesUiState = {
  inited: false,
  mounts: 0,
  busy: false,                 /* ONE op at a time (the card busy law)                */
  op: null,                    /* {id, label} of the op in flight ("" id = the link)  */
  items: [],                   /* the latest list mirror (JSON-safe rows)             */
  byId: {},
  listOk: false, listErr: "", listAbsent: false,
  fsKind: "",                  /* "injected" | "window" | "none" | ""                 */
  status: "", statusKind: "msg",
  lastError: "",
  rowsHTML: "\u0000",          /* rows paint memo (write-on-change)                   */
};

/* ---------- small pure helpers (no DOM; harness-covered) ---------- */

const avSourcesUiEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* a capped string (never throws; null/undefined -> "") */
function avSourcesUiStr(v, cap) {
  try {
    const t = String(v == null ? "" : v);
    return (cap && t.length > cap) ? t.slice(0, cap) : t;
  } catch (e) { return ""; }
}

function avSourcesUiNumOr(v, d) {
  const n = Number(v);
  return isFinite(n) ? n : d;
}

/* a truncating display slice ("abcdef" 4 -> "abc\u2026"); never throws */
function avSourcesUiShort(s, max) {
  try {
    const t = String(s == null ? "" : s);
    const m = (typeof max === "number" && max > 4) ? Math.floor(max) : 96;
    return t.length <= m ? t : t.slice(0, m - 1) + "\u2026";
  } catch (e) { return ""; }
}

/* "HH:MM" out of an epoch ms (or "--:--" when unusable) -- the row meta uses it */
function avSourcesUiClock(at) {
  try {
    const n = Number(at);
    if (!isFinite(n) || n <= 0) return "--:--";
    const d = new Date(n);
    if (!isFinite(d.getTime())) return "--:--";
    const h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  } catch (e) { return "--:--"; }
}

/* the count of a scan list: an array -> its length; a number -> the rounded number; else 0 */
function avSourcesUiLen(v) {
  try {
    if (v && typeof v.length === "number") return Math.max(0, v.length | 0);
    const n = Number(v);
    return isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  } catch (e) { return 0; }
}

/* an error/refusal line out of anything (receipts carry .error strings) */
function avSourcesUiErrText(e, fallback) {
  try {
    if (e && typeof e === "object") {
      if (typeof e.error === "string" && e.error) return e.error;
      if (typeof e.message === "string" && e.message) return e.message;
    }
    if (typeof e === "string" && e) return e;
  } catch (e2) { /* fall through */ }
  return fallback || "refused";
}

/* tolerant receipt normalizer -- a receipt is ALWAYS an object after this */
function avSourcesUiReceipt(r) {
  try {
    if (r === true) return { ok: true };
    if (r && typeof r === "object") return r;
    if (typeof r === "string" && r) return { ok: false, error: r };
    if (r === false) return { ok: false, error: "refused" };
  } catch (e) { /* fall through */ }
  return { ok: false, error: "no receipt" };
}

/* async settle: receipts may be promises or sync values; the callback runs EXACTLY once,
   never throws, and a rejection becomes an honest {ok:false, error} receipt */
function avSourcesUiSettle(p, cb) {
  const done = { v: false };
  const once = function (r) {
    if (done.v) return;
    done.v = true;
    try { cb(r); } catch (e) { /* settle never throws */ }
  };
  try {
    if (p && typeof p.then === "function") {
      p.then(once, function (e) { once({ ok: false, error: avSourcesUiErrText(e, "failed") }); });
      return true;
    }
    once(p);
    return true;
  } catch (e) {
    once({ ok: false, error: avSourcesUiErrText(e, "failed") });
    return false;
  }
}

/* ---------- guarded DOM + facade access (no throw, no noise) ---------- */

function avSourcesUiWin() {
  try { if (typeof window !== "undefined") return window; } catch (e) { /* none */ }
  return null;
}

function avSourcesUiDoc() {
  try { if (typeof document !== "undefined") return document; } catch (e) { /* none */ }
  return null;
}

/* the parent-owned host; absent -> every mount/paint path refuses safely */
function avSourcesUiHost() {
  try {
    const d = avSourcesUiDoc();
    if (d && typeof d.getElementById === "function") return d.getElementById("av-sources-host");
  } catch (e) { /* no document */ }
  return null;
}

/* this module's own section element, when mounted */
function avSourcesUiSection() {
  try {
    const host = avSourcesUiHost();
    if (host && typeof host.querySelector === "function") return host.querySelector(".av-sources");
  } catch (e) { /* none */ }
  return null;
}

/* the core facade (child A's window.__avSources) -- guarded; null when absent */
function avSourcesUiFacade() {
  try {
    const w = avSourcesUiWin();
    const f = (w && w.__avSources) ? w.__avSources : null;
    if (f && typeof f === "object") return f;
  } catch (e) { /* no window */ }
  return null;
}

/* the core's fs kind, read tolerantly (function or value; unknown -> "") */
function avSourcesUiFsKind(f) {
  try {
    if (f) {
      const raw = (typeof f.fsKind === "function") ? f.fsKind() : f.fsKind;
      const t = String(raw == null ? "" : raw);
      if (t) return t;
    }
  } catch (e) { /* the kind read is a nicety */ }
  return "";
}

/* the shared op gate: the facade must carry the named function, else the honest note */
function avSourcesUiNeed(fn) {
  const f = avSourcesUiFacade();
  if (!f || typeof f[fn] !== "function") {
    avSourcesUiSetStatus("linked sources unavailable \u2014 the core (av_sources.js) is not present", "err");
    return null;
  }
  return f;
}

/* ---------- the status line (card span first when reachable; own span otherwise) ---------- */

/* paint the current status text; preferCard = move through #av-import-status when it exists,
   else this section's own #av-sources-status (the pin's routing). The err class is managed
   only on our own span -- the card span's class memos stay the card's business. */
function avSourcesUiPaintStatus(preferCard) {
  const s = avSourcesUiState;
  let el = null;
  let own = false;
  try {
    const d = avSourcesUiDoc();
    if (preferCard && d && typeof d.getElementById === "function") {
      el = d.getElementById("av-import-status");
    }
    if (!el) {
      const host = avSourcesUiHost();
      el = (host && typeof host.querySelector === "function") ? host.querySelector("#av-sources-status") : null;
      if (!el && d && typeof d.getElementById === "function") el = d.getElementById("av-sources-status");
      own = !!el;
    }
  } catch (e) { el = null; }
  if (!el) return false;
  try {
    if (el.textContent !== s.status) el.textContent = s.status;
    if (own && el.classList && typeof el.classList.add === "function") {
      const err = (s.statusKind === "err");
      if (err && !el.classList.contains("av-sources-err")) el.classList.add("av-sources-err");
      else if (!err && el.classList.contains("av-sources-err")) el.classList.remove("av-sources-err");
    }
    return true;
  } catch (e) { return false; }
}

function avSourcesUiSetStatus(msg, kind) {
  try {
    const s = avSourcesUiState;
    s.status = String(msg == null ? "" : msg);
    s.statusKind = (kind === "err") ? "err" : "msg";
    return avSourcesUiPaintStatus(true);
  } catch (e) { return false; }
}

/* ---------- busy discipline (ONE op at a time -- the card busy law) ---------- */

function avSourcesUiBusyRefuse() {
  avSourcesUiSetStatus("an op is already in progress \u2014 one op at a time", "err");
  return false;
}

function avSourcesUiBeginOp(id, label) {
  const s = avSourcesUiState;
  try {
    if (s.busy) return avSourcesUiBusyRefuse();
    s.busy = true;
    s.op = { id: id == null ? "" : String(id), label: String(label == null ? "working" : label) };
    avSourcesUiSetStatus(s.op.label + "\u2026", "msg");
    avSourcesUiPaintBusy();
    return true;
  } catch (e) { return false; }
}

function avSourcesUiEndOp() {
  const s = avSourcesUiState;
  try {
    s.busy = false;
    s.op = null;
    avSourcesUiPaintBusy();
    return true;
  } catch (e) { return false; }
}

/* the display name of a row id from the mirror (falls back to the raw id) */
function avSourcesUiNameOf(id) {
  try {
    const s = avSourcesUiState;
    const it = s.byId[String(id == null ? "" : id)];
    if (it && it.name) return it.name;
  } catch (e) { /* the raw id stands */ }
  return String(id == null ? "" : id);
}

/* ---------- list mirror + row/empty paint ---------- */

/* one core list item (wave section 3.3 shape) -> a JSON-safe UI row; null when unusable */
function avSourcesUiItemPub(it) {
  const id = avSourcesUiStr(it && it.id, 80);
  if (!id) return null;
  const name = avSourcesUiStr(it && it.name, 120) || id;
  let perm = avSourcesUiStr(it && it.perm, 16);
  if (!perm) perm = "unknown";
  return {
    id: id,
    name: name,
    linkedAt: avSourcesUiNumOr(it && it.linkedAt, 0),
    lastScanAt: avSourcesUiNumOr(it && it.lastScanAt, 0),
    mode: avSourcesUiStr(it && it.mode, 16) || "linked",
    perm: perm,
    newN: avSourcesUiLen(it && it.new),
    changedN: avSourcesUiLen(it && it.changed),
    goneN: avSourcesUiLen(it && it.gone),
    note: avSourcesUiStr(it && it.note, 120),
  };
}

/* the pinned meta line: "linked . last scan HH:MM . new N . changed N . gone N" (+ a note) */
function avSourcesUiRowMeta(it) {
  const last = (Number(it.lastScanAt) > 0) ? avSourcesUiClock(it.lastScanAt) : "never";
  let m = "linked \u00b7 last scan " + last + " \u00b7 new " + it.newN +
    " \u00b7 changed " + it.changedN + " \u00b7 gone " + it.goneN;
  if (it.note) m += " \u00b7 " + avSourcesUiShort(it.note, 90);
  return m;
}

/* one folder row -- the pinned row attrs + cells + the four buttons (RECONNECT only when the
   permission is not granted; IMPORT disabled at N = 0) */
function avSourcesUiRowHTML(it) {
  let html = '<div class="av-sources-row" data-id="' + avSourcesUiEsc(it.id) +
    '" data-perm="' + avSourcesUiEsc(it.perm) + '">';
  html += '<span class="av-sources-name" title="' + avSourcesUiEsc(it.name) + '">' + avSourcesUiEsc(it.name) + "</span>";
  html += '<span class="av-sources-meta av-dim">' + avSourcesUiEsc(avSourcesUiRowMeta(it)) + "</span>";
  if (it.perm !== "granted") {
    html += '<button type="button" class="av-btn mini av-sources-reconnect" title="' +
      avSourcesUiEsc("re-ask the browser for read permission on " + it.name) + '">RECONNECT</button>';
  }
  html += '<button type="button" class="av-btn mini av-sources-scan" title="' +
    avSourcesUiEsc("re-scan " + it.name + " and diff it against the library") + '">RE-SCAN</button>';
  html += '<button type="button" class="av-btn mini av-sources-import"' + (it.newN === 0 ? " disabled" : "") +
    ' title="' + avSourcesUiEsc("import the " + it.newN + " new file" + (it.newN === 1 ? "" : "s") +
    " through the import funnel") + '">IMPORT NEW (' + it.newN + ")</button>";
  html += '<button type="button" class="av-btn mini av-sources-unlink" title="' +
    avSourcesUiEsc("forget this folder \u2014 the items it already imported stay in the library") + '">UNLINK</button>';
  html += "</div>";
  return html;
}

/* the one honest empty-state line for the current state of the world */
function avSourcesUiEmptyMsg() {
  const s = avSourcesUiState;
  if (s.listAbsent) return "linked sources unavailable \u2014 the core (av_sources.js) is not present";
  if (!s.listOk) return "linked folders unavailable \u2014 " + (s.listErr || "the folder list could not be read");
  if (s.fsKind === "none") return "no linked folders \u2014 linking needs the File System Access API (this browser does not offer it)";
  return "no linked folders \u2014 link one to re-scan and diff it against the library";
}

/* repaint the rows container + the empty state from the mirror (write-on-change) */
function avSourcesUiPaint() {
  const host = avSourcesUiHost();
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const s = avSourcesUiState;
    const box = host.querySelector(".av-sources-list");
    if (!box) return false;
    const items = s.items || [];
    const n = Math.min(items.length, AV_SOURCES_UI_ROWS_MAX);
    let html = "";
    for (let i = 0; i < n; i++) html += avSourcesUiRowHTML(items[i]);
    if (items.length > n) {
      html += '<p class="av-note av-dim av-sources-more">' +
        avSourcesUiEsc("showing the first " + n + " of " + items.length + " linked folders") + "</p>";
    }
    if (html !== s.rowsHTML) {
      box.innerHTML = html;
      s.rowsHTML = html;
    }
    const empty = host.querySelector(".av-sources-empty");
    if (empty) {
      const msg = avSourcesUiEmptyMsg();
      if (empty.textContent !== msg) empty.textContent = msg;
      const hid = items.length > 0;
      if (empty.hidden !== hid) empty.hidden = hid;
    }
    avSourcesUiPaintBusy();
    return true;
  } catch (e) { return false; }
}

/* the busy paint: the running op's row carries data-busy="1" (+ aria-busy); the section root
   carries aria-busy; every button disables while busy (the IMPORT button stays disabled at
   N = 0 once the op clears) */
function avSourcesUiPaintBusy() {
  const host = avSourcesUiHost();
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const s = avSourcesUiState;
    const busy = !!s.busy;
    const sec = host.querySelector(".av-sources");
    if (sec && typeof sec.setAttribute === "function") {
      const av = busy ? "true" : "false";
      if (!sec.getAttribute || sec.getAttribute("aria-busy") !== av) sec.setAttribute("aria-busy", av);
    }
    const linkBtn = host.querySelector("#av-sources-link");
    if (linkBtn && linkBtn.disabled !== busy) linkBtn.disabled = busy;
    let rows = null;
    try { rows = host.querySelectorAll(".av-sources-row"); } catch (e2) { rows = null; }
    if (!rows) return true;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rid = String((row.getAttribute && row.getAttribute("data-id")) || "");
      const lit = !!(busy && rid && s.op && s.op.id === rid);
      if (typeof row.setAttribute === "function") {
        if (lit) {
          if (row.getAttribute("data-busy") !== "1") row.setAttribute("data-busy", "1");
          if (row.getAttribute("aria-busy") !== "true") row.setAttribute("aria-busy", "true");
        } else {
          if (row.getAttribute("data-busy") != null) row.removeAttribute("data-busy");
          if (row.getAttribute("aria-busy") != null) row.removeAttribute("aria-busy");
        }
      }
      let btns = null;
      try { btns = row.querySelectorAll("button"); } catch (e3) { btns = null; }
      if (!btns) continue;
      const it = rid ? s.byId[rid] : null;
      for (let k = 0; k < btns.length; k++) {
        const b = btns[k];
        let dis = busy;
        if (!dis && it && it.newN === 0 && b.classList && typeof b.classList.contains === "function" &&
            b.classList.contains("av-sources-import")) {
          dis = true;
        }
        if (b.disabled !== dis) b.disabled = dis;
      }
    }
    return true;
  } catch (e) { return false; }
}

/* write one __avSources.list() receipt into the mirror + repaint */
function avSourcesUiApplyList(r0) {
  const s = avSourcesUiState;
  try {
    const r = avSourcesUiReceipt(r0);
    if (r.absent === true) {
      s.listOk = false;
      s.listAbsent = true;
      s.listErr = avSourcesUiErrText(r, "the core (av_sources.js) is not present");
      s.items = [];
      s.byId = {};
    } else if (r.ok !== true) {
      s.listOk = false;
      s.listAbsent = false;
      s.listErr = avSourcesUiErrText(r, "the folder list could not be read");
      s.items = [];
      s.byId = {};
    } else {
      s.listOk = true;
      s.listAbsent = false;
      s.listErr = "";
      const src = (r.items && typeof r.items.length === "number") ? r.items : [];
      const out = [];
      const byId = {};
      const n = Math.min(src.length, AV_SOURCES_UI_ROWS_MAX);
      for (let i = 0; i < n; i++) {
        const pub = avSourcesUiItemPub(src[i]);
        if (!pub) continue;
        out.push(pub);
        byId[pub.id] = pub;
      }
      s.items = out;
      s.byId = byId;
    }
    avSourcesUiPaint();
    return true;
  } catch (e) { return false; }
}

/* the public refresh: one guarded __avSources.list() read -> mirror -> repaint;
   Promise<bool>, never rejects. Ops self-refresh through this. */
function avSourcesUiRefresh() {
  const s = avSourcesUiState;
  return new Promise(function (resolve) {
    let done = false;
    const finish = function (v) { if (!done) { done = true; resolve(v); } };
    try {
      if (!s.inited) { try { avSourcesUiInit(); } catch (e0) { /* never throws */ } }
      const f = avSourcesUiFacade();
      s.fsKind = avSourcesUiFsKind(f);
      if (!f || typeof f.list !== "function") {
        avSourcesUiApplyList({ ok: false, absent: true, error: "the core (av_sources.js) is not present" });
        finish(false);
        return;
      }
      let out = null;
      try { out = f.list(); } catch (e) { out = { ok: false, error: avSourcesUiErrText(e, "the folder list could not be read") }; }
      avSourcesUiSettle(out, function (r) {
        try { avSourcesUiApplyList(r); } catch (e) { /* apply never throws */ }
        finish(true);
      });
    } catch (e) { finish(false); }
  });
}

/* ---------- the scan line (head + the D5 counts + the cap note) ---------- */

function avSourcesUiScanLine(head, scan) {
  try {
    if (!scan || typeof scan !== "object") return head;
    let line = head + " \u2014 new " + avSourcesUiLen(scan.new) + " \u00b7 changed " + avSourcesUiLen(scan.changed) +
      " \u00b7 gone " + avSourcesUiLen(scan.gone) + " \u00b7 same " + avSourcesUiLen(scan.same);
    if (scan.capped === true) line += " \u00b7 walk capped";
    return line;
  } catch (e) { return head; }
}

/* ---------- the ops (every facade reach guarded; one op at a time; ops self-refresh) ------ */

/* LINK -> __avSources.link(); D4: a cancel is a calm message, never an error state */
function avSourcesUiLink() {
  try {
    const f = avSourcesUiNeed("link");
    if (!f) return false;
    if (!avSourcesUiBeginOp("", "linking a source folder")) return false;
    let out = null;
    try { out = f.link(); } catch (e) { out = { ok: false, error: avSourcesUiErrText(e, "the link failed") }; }
    avSourcesUiSettle(out, function (r0) {
      const r = avSourcesUiReceipt(r0);
      avSourcesUiEndOp();
      if (r.ok === true) {
        const nm = avSourcesUiStr(r.name, 120) || "folder";
        avSourcesUiSetStatus(avSourcesUiScanLine("linked " + avSourcesUiShort(nm, 60), r.scan), "msg");
      } else if (String(r.error) === "cancelled") {
        avSourcesUiSetStatus("link cancelled \u2014 nothing was linked", "msg");
      } else {
        avSourcesUiSetStatus("link refused \u2014 " + avSourcesUiErrText(r, "the core refused"), "err");
      }
      avSourcesUiRefresh();
    });
    return true;
  } catch (e) {
    avSourcesUiEndOp();
    avSourcesUiSetStatus("link failed \u2014 " + avSourcesUiErrText(e, "unexpected"), "err");
    return false;
  }
}

/* RE-SCAN -> __avSources.scan(id); the row meta + counts refresh from the memo after */
function avSourcesUiScan(id) {
  const name = avSourcesUiNameOf(id);
  try {
    const f = avSourcesUiNeed("scan");
    if (!f) return false;
    if (!avSourcesUiBeginOp(id, "scanning " + name)) return false;
    let out = null;
    try { out = f.scan(id); } catch (e) { out = { ok: false, error: avSourcesUiErrText(e, "the scan failed") }; }
    avSourcesUiSettle(out, function (r0) {
      const r = avSourcesUiReceipt(r0);
      avSourcesUiEndOp();
      if (r.ok === true) {
        const nm = avSourcesUiStr(r.name, 120) || name;
        avSourcesUiSetStatus(avSourcesUiScanLine("scanned " + avSourcesUiShort(nm, 60), r.scan), "msg");
      } else {
        avSourcesUiSetStatus("scan refused \u2014 " + avSourcesUiErrText(r, "the core refused"), "err");
      }
      avSourcesUiRefresh();
    });
    return true;
  } catch (e) {
    avSourcesUiEndOp();
    avSourcesUiSetStatus("scan failed \u2014 " + avSourcesUiErrText(e, "unexpected"), "err");
    return false;
  }
}

/* IMPORT NEW -> __avSources.importNew(id) (the core feeds avImportFiles, D6); on a landed
   import the card's library list is nudged to repaint (guarded, best-effort) */
function avSourcesUiImportNew(id) {
  const name = avSourcesUiNameOf(id);
  try {
    const f = avSourcesUiNeed("importNew");
    if (!f) return false;
    if (!avSourcesUiBeginOp(id, "importing new files from " + name)) return false;
    let out = null;
    try { out = f.importNew(id); } catch (e) { out = { ok: false, error: avSourcesUiErrText(e, "the import failed") }; }
    avSourcesUiSettle(out, function (r0) {
      const r = avSourcesUiReceipt(r0);
      avSourcesUiEndOp();
      if (r.ok === true) {
        const c = Math.max(0, Math.round(avSourcesUiNumOr(r.count, 0)));
        const nm = avSourcesUiStr(r.name, 120) || name;
        if (c > 0) {
          avSourcesUiSetStatus("imported " + c + " new file" + (c === 1 ? "" : "s") + " from " + avSourcesUiShort(nm, 60), "msg");
          avSourcesUiNudgeCard();
        } else {
          avSourcesUiSetStatus("no new files in " + avSourcesUiShort(nm, 60) + " \u2014 nothing to import", "msg");
        }
      } else {
        avSourcesUiSetStatus("import refused \u2014 " + avSourcesUiErrText(r, "the core refused"), "err");
      }
      avSourcesUiRefresh();
    });
    return true;
  } catch (e) {
    avSourcesUiEndOp();
    avSourcesUiSetStatus("import failed \u2014 " + avSourcesUiErrText(e, "unexpected"), "err");
    return false;
  }
}

/* UNLINK -> __avSources.unlink(id); the record + handle release (library items stay) */
function avSourcesUiUnlink(id) {
  const name = avSourcesUiNameOf(id);
  try {
    const f = avSourcesUiNeed("unlink");
    if (!f) return false;
    if (!avSourcesUiBeginOp(id, "unlinking " + name)) return false;
    let out = null;
    try { out = f.unlink(id); } catch (e) { out = { ok: false, error: avSourcesUiErrText(e, "the unlink failed") }; }
    avSourcesUiSettle(out, function (r0) {
      const r = avSourcesUiReceipt(r0);
      avSourcesUiEndOp();
      if (r.ok === true) {
        if (r.removed === true) avSourcesUiSetStatus("unlinked " + avSourcesUiShort(name, 60), "msg");
        else avSourcesUiSetStatus("nothing to unlink for " + avSourcesUiShort(name, 60), "msg");
      } else {
        avSourcesUiSetStatus("unlink refused \u2014 " + avSourcesUiErrText(r, "the core refused"), "err");
      }
      avSourcesUiRefresh();
    });
    return true;
  } catch (e) {
    avSourcesUiEndOp();
    avSourcesUiSetStatus("unlink failed \u2014 " + avSourcesUiErrText(e, "unexpected"), "err");
    return false;
  }
}

/* RECONNECT -> __avSources.reconnect(id) (D8; gesture-bound requestPermission); the row's
   RECONNECT state clears only when the core reports perm "granted" */
function avSourcesUiReconnect(id) {
  const name = avSourcesUiNameOf(id);
  try {
    const f = avSourcesUiNeed("reconnect");
    if (!f) return false;
    if (!avSourcesUiBeginOp(id, "reconnecting " + name)) return false;
    let out = null;
    try { out = f.reconnect(id); } catch (e) { out = { ok: false, error: avSourcesUiErrText(e, "the reconnect failed") }; }
    avSourcesUiSettle(out, function (r0) {
      const r = avSourcesUiReceipt(r0);
      avSourcesUiEndOp();
      if (r.ok !== true) {
        avSourcesUiSetStatus("reconnect refused \u2014 " + avSourcesUiErrText(r, "the core refused"), "err");
      } else {
        const perm = avSourcesUiStr(r.perm, 16) || "unknown";
        if (perm === "granted") avSourcesUiSetStatus("reconnected " + avSourcesUiShort(name, 60), "msg");
        else avSourcesUiSetStatus("reconnect \u2014 permission " + perm + " (the row stays in reconnect)", "err");
      }
      avSourcesUiRefresh();
    });
    return true;
  } catch (e) {
    avSourcesUiEndOp();
    avSourcesUiSetStatus("reconnect failed \u2014 " + avSourcesUiErrText(e, "unexpected"), "err");
    return false;
  }
}

/* the guarded card nudge: after a landed import the hub's library list repaints (best-effort;
   the card may not be present -- then this is a no-op, never a throw) */
function avSourcesUiNudgeCard() {
  try {
    const w = avSourcesUiWin();
    const imp = (w && w.__avImport) ? w.__avImport : null;
    if (imp && typeof imp.refresh === "function") {
      imp.refresh();
      return true;
    }
  } catch (e) { /* best-effort */ }
  return false;
}

/* ---------- markup (pure string builders) ---------- */

function avSourcesUiBodyHTML() {
  return '<div class="av-sources">' +
    '<div class="av-sources-head">' +
    '<span class="av-sources-title">LINKED SOURCES</span>' +
    '<span class="av-sources-status av-sources-msg" id="av-sources-status" role="status" aria-live="polite">linked folders idle</span>' +
    '<button type="button" class="av-btn mini av-sources-link" id="av-sources-link" title="link a local folder (File System Access) \u2014 its files are scanned and diffed against the library">LINK FOLDER</button>' +
    "</div>" +
    '<p class="av-note av-dim av-sources-empty">no linked folders \u2014 link one to re-scan and diff it against the library</p>' +
    '<div class="av-sources-list"></div>' +
    "</div>";
}

/* ---------- event wiring (one delegation set per host) ---------- */

function avSourcesUiWire(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  try {
    if (host.dataset && host.dataset.avSourcesWired === "1") return true;
    if (host.dataset) host.dataset.avSourcesWired = "1";
    host.addEventListener("click", avSourcesUiOnClick);
    return true;
  } catch (e) { return false; }
}

function avSourcesUiOnClick(ev) {
  try {
    const t = ev && ev.target;
    if (!t || typeof t.closest !== "function") return;
    if (t.closest("#av-sources-link")) { avSourcesUiLink(); return; }
    const row = t.closest(".av-sources-row");
    if (!row) return;
    const rid = String((row.getAttribute && row.getAttribute("data-id")) || "");
    if (!rid) return;
    if (t.closest(".av-sources-reconnect")) { avSourcesUiReconnect(rid); return; }
    if (t.closest(".av-sources-scan")) { avSourcesUiScan(rid); return; }
    if (t.closest(".av-sources-import")) { avSourcesUiImportNew(rid); return; }
    if (t.closest(".av-sources-unlink")) { avSourcesUiUnlink(rid); return; }
  } catch (e) { /* a listener never throws outward */ }
}

/* ---------- init / classes ---------- */

/* mount the section into #av-sources-host; false when the host is absent (child C's edit may
   not have landed) -- stays re-init safe: the second call mounts, later calls are idempotent */
function avSourcesUiInit() {
  const host = avSourcesUiHost();
  if (!host || typeof host.querySelector !== "function") return false;   /* host absent -> false */
  try {
    const s = avSourcesUiState;
    let sec = null;
    try { sec = host.querySelector(".av-sources"); } catch (e) { sec = null; }
    const flagged = !!(host.dataset && host.dataset.avSourcesUi === "1");
    if (flagged && sec && s.inited) return true;      /* idempotent via the host dataset flag */
    if (!sec) {
      s.rowsHTML = "\u0000";                          /* fresh markup needs its first paint */
      host.innerHTML = avSourcesUiBodyHTML();
      try { sec = host.querySelector(".av-sources"); } catch (e2) { sec = null; }
    }
    avSourcesUiWire(host);
    s.inited = true;
    s.mounts += 1;
    if (host.dataset) host.dataset.avSourcesUi = "1";
    if (!s.status) {
      const f = avSourcesUiFacade();
      if (!f) {
        s.status = "linked sources unavailable \u2014 the core (av_sources.js) is not present";
        s.statusKind = "err";
      } else if (avSourcesUiFsKind(f) === "none") {
        s.status = "linking needs the File System Access API (this browser does not offer it)";
        s.statusKind = "msg";
      } else {
        s.status = "linked folders idle \u2014 link one to diff it against the library";
        s.statusKind = "msg";
      }
    }
    avSourcesUiPaintStatus(false);                    /* the boot line stays OURS (own span) */
    avSourcesUiRefresh();
    return true;
  } catch (e) {
    try { avSourcesUiState.lastError = String((e && e.message) || e); } catch (e2) { /* ok */ }
    return false;
  }
}

function avSourcesUiClasses() {
  return AV_SOURCES_UI_CLASSES.slice();
}
