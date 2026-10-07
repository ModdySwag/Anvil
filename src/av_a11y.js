/* av_a11y.js — Anvil's accessibility core (P7 · child A): the high-contrast and reduced-motion
   preferences, the header toggle pair, the skip link, the polite live region, and the
   idempotent decoration pass that upgrades the page for keyboard and screen-reader use.

   SURFACE (ONE namespace: avA11y* / AV_A11Y_*):
   - avA11yInit() -> true once wired. Idempotent: builds (or re-adopts) #av-a11y-host with the
     two real buttons, prepends the skip link, appends the live region, restores the persisted
     prefs, arms the prefers-reduced-motion media listener, runs decoration pass 1 and schedules
     pass 2 at +1200 ms. Never throws, never prints.
   - avA11yState() -> { version, inited, contrast, motion, systemReduced, reduceActive, skip,
     live, counts: { sliders, knobsTabbed, canvases, liveRegions, roleButtons, labeled,
     unnamed }, errors[] (cap 16) }. Counts are "satisfied totals" read fresh from the DOM
     (the stored pass snapshot stands in when there is no document): sliders = every
     .av-knob[data-knob]; labeled = controls inside header/main/footer carrying an accessible
     name after the pass; unnamed = the remainder (0 after the pass).
   - avA11ySetPref(k, v) / avA11yToggle(k) — k "contrast" | "motion" (motion folds to
     "system" | "reduce"; anything else reads as "system"). A change persists the `av-a11y`
     localStorage key, re-applies the body classes av-contrast / av-reduce-motion, repaints
     aria-pressed, announces on the live region and dispatches the `av-a11y` CustomEvent
     { detail: { contrast, motion } } on document (bubbles, so window listeners see it too).
   - avA11yAnnounce(text) -> writes #av-a11y-live (string, capped 200).
   - avA11yClasses() -> the class list the parent's styles block must cover: av-a11y ·
     av-a11y-btn · av-a11y-skip · av-a11y-sr · av-contrast · av-reduce-motion.
   - avA11yProof() -> one line "A11Y SELFTEST <json>" RETURNED to the caller (this module
     never calls avTestLine; the app core appends it in the ?avtest=1 block).
   - window.__avA11y = { version, init, state, setPref, toggle } — the debug handle.

   LAWS:
   - Classic script, "use strict", node-loadable (the top level is DOM-free; every reach is
     guarded inside a function), one namespace, never throws outward, no console output,
     ASCII source (unicode via escapes).
   - localStorage reads are tolerant (any shape -> defaults) and every write is try/catch'd:
     the file:// zero-error contract must hold even with a corrupt key.
   - The decoration pass writes attributes only (no layout, no fetch); pass 2 is one
     setTimeout. Both passes are idempotent: a second run over decorated DOM is a no-op.
   - The skip link is PREPENDED to body (the first focusable) and points at main.av-main
     (id="av-main" is set when missing); its hidden-until-focused styling lives in the
     parent's styles block, this module ships no inline geometry for it.
   - ONE document keydown listener: Enter/Space on a focused [role="button"]:not(button)
     clicks it. It consumes only that case and stands down when the key was already claimed.
     The av_kb dispatcher's own key map is untouched.
   - Pref restore path: avA11yInit() re-applies the persisted prefs every call, so a reload
     lands in the same contrast/motion state. */

"use strict";

const AV_A11Y_VERSION = "1.0.0";
const AV_A11Y_LS = "av-a11y";
const AV_A11Y_PASS2_MS = 1200;
const AV_A11Y_ANNOUNCE_MAX = 200;
const AV_A11Y_LABEL_MAX = 120;
const AV_A11Y_ERRORS_MAX = 16;
const AV_A11Y_MQ_REDUCE = "(prefers-reduced-motion: reduce)";
/* the pinned live-region selectors (docs/07 #79) — role="status" is added when missing */
const AV_A11Y_STATUS_SELECTORS = Object.freeze([".av-fam-status", "#av-deliver-status", ".av-session-status"]);
/* the class list the parent's styles block must cover (avA11yClasses() returns this) */
const AV_A11Y_CLASSES = Object.freeze(["av-a11y", "av-a11y-btn", "av-a11y-skip", "av-a11y-sr", "av-contrast", "av-reduce-motion"]);

/* ---------- module state (no DOM nodes held at load; everything guarded) ---------- */

const avA11y = {
  inited: false,
  contrast: false,
  motion: "system",
  systemReduced: false,
  mql: null,               /* the cached MediaQueryList */
  mediaBound: false,       /* the ONE media listener is armed */
  mediaHandler: null,
  keyBound: false,         /* the ONE keydown delegation listener is armed */
  timer2: 0,               /* the +1200 ms pass-2 handle */
  pass2Done: false,
  counts: { sliders: 0, knobsTabbed: 0, canvases: 0, liveRegions: 0, roleButtons: 0, labeled: 0, unnamed: 0 },
  errors: [],
};

/* ---------- tiny helpers ---------- */

/* the document, or null — the ONE way this module reaches for it */
function avA11yDoc() {
  try { if (typeof document !== "undefined" && document) return document; } catch (e) { /* none */ }
  return null;
}

/* record a caught exception (short, capped, never console) */
function avA11yRecord(e, where) {
  try {
    if (avA11y.errors.length >= AV_A11Y_ERRORS_MAX) return;
    const msg = String((e && (e.message || e.name)) || e || "unknown");
    avA11y.errors.push(String(where || "a11y") + ": " + msg.slice(0, 160));
  } catch (e2) { /* the recorder never throws */ }
}

/* tolerant boolean for setPref("contrast", ...) */
function avA11yBool(v) {
  if (v === true || v === 1 || v === "1" || v === "true" || v === "on" || v === "yes") return true;
  if (v === false || v === 0 || v === "0" || v === "false" || v === "off" || v === "no") return false;
  return !!v;
}

/* trim a string, capped — for labels and announcements */
function avA11yStr(s, max) {
  let out = String(s == null ? "" : s).trim();
  if (max && out.length > max) out = out.slice(0, max);
  return out;
}

/* ---------- prefs: localStorage `av-a11y` = {"contrast":false,"motion":"system"} ----------
   Tolerant read: any shape (missing key, junk, wrong types) falls back to the defaults.
   Every write is try/catch'd; failures are degradation, not errors (file:// contract). */

function avA11yReadPrefs() {
  const out = { contrast: false, motion: "system" };
  try {
    if (typeof localStorage === "undefined" || !localStorage) return out;
    const raw = localStorage.getItem(AV_A11Y_LS);
    if (!raw) return out;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") {
      if (obj.contrast === true) out.contrast = true;
      if (obj.motion === "reduce") out.motion = "reduce";
    }
  } catch (e) { /* any shape -> defaults */ }
  return out;
}

function avA11yWritePrefs() {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return false;
    localStorage.setItem(AV_A11Y_LS, JSON.stringify({
      contrast: avA11y.contrast === true,
      motion: avA11y.motion === "reduce" ? "reduce" : "system",
    }));
    return true;
  } catch (e) { return false; }
}

/* ---------- reduced motion: system query + body classes ---------- */

function avA11yMql() {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
    if (!avA11y.mql) avA11y.mql = window.matchMedia(AV_A11Y_MQ_REDUCE);
    return avA11y.mql || null;
  } catch (e) { return null; }
}

/* the system's current preference (cached; read live from the MQL when it answers) */
function avA11ySystemReduced() {
  try {
    const m = avA11yMql();
    if (m && typeof m.matches === "boolean") { avA11y.systemReduced = m.matches; return m.matches; }
  } catch (e) { /* fall through to the cache */ }
  return avA11y.systemReduced === true;
}

/* the effective reduce-motion state the body class follows */
function avA11yReduceActive() {
  if (avA11y.motion === "reduce") return true;
  return avA11ySystemReduced() === true;
}

/* arm the media listener while in system mode (guarded addEventListener, addListener fallback);
   the listener recomputes the body class on every system change. Bound once, kept for life. */
function avA11yMediaSync() {
  try {
    const m = avA11yMql();
    if (!m) return false;
    if (typeof m.matches === "boolean") avA11y.systemReduced = m.matches;
    if (avA11y.motion === "system" && !avA11y.mediaBound) {
      avA11y.mediaHandler = function () {
        try {
          const mm = avA11yMql();
          if (mm && typeof mm.matches === "boolean") avA11y.systemReduced = mm.matches;
          avA11yApply();
        } catch (e) { avA11yRecord(e, "media"); }
      };
      if (typeof m.addEventListener === "function") { m.addEventListener("change", avA11y.mediaHandler); avA11y.mediaBound = true; }
      else if (typeof m.addListener === "function") { m.addListener(avA11y.mediaHandler); avA11y.mediaBound = true; }
    }
    return true;
  } catch (e) { avA11yRecord(e, "media"); return false; }
}

/* apply the prefs to the page: body classes + aria-pressed on both toggle buttons */
function avA11yApply() {
  try {
    const doc = avA11yDoc();
    if (!doc) return false;
    const body = doc.body;
    if (body && body.classList) {
      body.classList.toggle("av-contrast", avA11y.contrast === true);
      body.classList.toggle("av-reduce-motion", avA11yReduceActive() === true);
    }
    if (doc.getElementById) {
      const c = doc.getElementById("av-a11y-contrast");
      if (c && c.setAttribute) c.setAttribute("aria-pressed", avA11y.contrast === true ? "true" : "false");
      const m = doc.getElementById("av-a11y-motion");
      if (m && m.setAttribute) m.setAttribute("aria-pressed", avA11y.motion === "reduce" ? "true" : "false");
    }
    return true;
  } catch (e) { avA11yRecord(e, "apply"); return false; }
}

/* ---------- the live region + announcements ---------- */

function avA11yEnsureLive() {
  try {
    const doc = avA11yDoc();
    if (!doc || !doc.body || !doc.createElement) return false;
    let el = doc.getElementById ? doc.getElementById("av-a11y-live") : null;
    if (!el) {
      el = doc.createElement("div");
      el.id = "av-a11y-live";
      el.className = "av-a11y-sr";
      el.setAttribute("aria-live", "polite");
      el.setAttribute("aria-atomic", "true");
      doc.body.appendChild(el);
    }
    return true;
  } catch (e) { avA11yRecord(e, "live"); return false; }
}

/* write an announcement (string, capped 200). Falls back to building the region first. */
function avA11yAnnounce(text) {
  try {
    const msg = avA11yStr(text, AV_A11Y_ANNOUNCE_MAX);
    const doc = avA11yDoc();
    if (!doc) return false;
    let el = doc.getElementById ? doc.getElementById("av-a11y-live") : null;
    if (!el) { avA11yEnsureLive(); el = doc.getElementById ? doc.getElementById("av-a11y-live") : null; }
    if (!el) return false;
    el.textContent = msg;
    return true;
  } catch (e) { return false; }
}

/* ---------- the skip link + the main landmark id ---------- */

function avA11yEnsureSkip() {
  try {
    const doc = avA11yDoc();
    if (!doc || !doc.body || !doc.createElement) return false;
    let a = doc.getElementById ? doc.getElementById("av-a11y-skip") : null;
    if (!a) {
      a = doc.createElement("a");
      a.id = "av-a11y-skip";
      a.className = "av-a11y-skip";
      a.setAttribute("href", "#av-main");
      /* skip-link activation moves REAL focus: Chromium does not focus a plain <main> fragment
         target, so tabindex="-1" on main + focus() is the classic accessible pattern */
      try {
        a.addEventListener("click", function (ev) {
          try {
            const skipMain = doc.getElementById ? doc.getElementById("av-main") : null;
            if (skipMain) { ev.preventDefault(); try { skipMain.focus(); } catch (e2) { /* ok */ } }
          } catch (e3) { /* never throws */ }
        });
      } catch (e4) { /* ok */ }
      a.textContent = "Skip to main content";
      if (doc.body.insertBefore) doc.body.insertBefore(a, doc.body.firstChild || null);
      else doc.body.appendChild(a);
    }
    /* the module guarantees the main landmark target (main.av-main; plain main is the fallback) */
    let main = doc.querySelector ? doc.querySelector("main.av-main") : null;
    if (!main && doc.querySelector) main = doc.querySelector("main");
    if (main && !main.id) main.id = "av-main";
    if (main) { try { main.setAttribute("tabindex", "-1"); } catch (e) { /* ok */ } }
    return true;
  } catch (e) { avA11yRecord(e, "skip"); return false; }
}

/* ---------- the header UI: #av-a11y-host + two aria-pressed buttons ---------- */

function avA11yEnsureHost() {
  try {
    const doc = avA11yDoc();
    if (!doc || !doc.createElement) return null;
    let host = doc.getElementById ? doc.getElementById("av-a11y-host") : null;
    if (host) return host;
    let header = doc.querySelector ? doc.querySelector("header.av-head") : null;
    if (!header && doc.getElementById) {
      const v = doc.getElementById("av-version");
      if (v && v.parentElement) header = v.parentElement;
    }
    if (!header) return null;               /* skip silently: neither anchor exists */
    host = doc.createElement("div");
    host.id = "av-a11y-host";
    host.className = "av-a11y";
    header.appendChild(host);
    return host;
  } catch (e) { avA11yRecord(e, "host"); return null; }
}

function avA11yEnsureButton(host, id, label, aria, title, kind) {
  try {
    const doc = avA11yDoc();
    if (!doc || !host) return null;
    let b = host.querySelector ? host.querySelector("#" + id) : null;
    if (!b && doc.getElementById) b = doc.getElementById(id);
    if (!b) {
      if (!doc.createElement) return null;
      b = doc.createElement("button");
      b.type = "button";
      b.id = id;
      b.className = "av-btn mini av-a11y-btn";
      b.textContent = label;
      host.appendChild(b);
    }
    if (b.setAttribute) {
      b.setAttribute("title", title);
      b.setAttribute("aria-label", aria);
      if (!b.getAttribute || !b.getAttribute("aria-pressed")) b.setAttribute("aria-pressed", "false");
    }
    if (!b.dataset || b.dataset.avA11yBound !== "1") {
      if (b.dataset) b.dataset.avA11yBound = "1";
      if (b.addEventListener) {
        b.addEventListener("click", function () {
          try { avA11yToggle(kind); } catch (e) { avA11yRecord(e, "click"); }
        });
      }
    }
    return b;
  } catch (e) { avA11yRecord(e, "ui"); return null; }
}

function avA11yEnsureUI() {
  const host = avA11yEnsureHost();
  if (!host) return false;
  const c = avA11yEnsureButton(host, "av-a11y-contrast", "CONTRAST", "High contrast",
    "High contrast \u2014 swap to the high-contrast palette", "contrast");
  const m = avA11yEnsureButton(host, "av-a11y-motion", "MOTION", "Reduce motion",
    "Reduce motion \u2014 follow your system setting or force it on", "motion");
  return !!(c && m);
}

/* ---------- the ONE keydown delegation: Enter/Space on a focused [role="button"] ---------- */

function avA11yKeydown(e) {
  try {
    if (!e || e.defaultPrevented) return;                    /* a claimed key stays claimed */
    if (e.repeat === true) return;
    const k = e.key;
    if (k !== "Enter" && k !== " " && k !== "Spacebar") return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing === true) return;
    const doc = avA11yDoc();
    if (!doc || !doc.activeElement) return;
    const ae = doc.activeElement;
    if (!ae || ae.tagName === "BUTTON") return;              /* real buttons already click */
    if (ae.getAttribute && ae.getAttribute("role") === "button" && typeof ae.click === "function") {
      if (e.preventDefault) e.preventDefault();
      ae.click();
    }
  } catch (err) { avA11yRecord(err, "keydown"); }
}

function avA11yBindKeys() {
  try {
    if (avA11y.keyBound) return true;
    const doc = avA11yDoc();
    if (!doc || typeof doc.addEventListener !== "function") return false;
    doc.addEventListener("keydown", avA11yKeydown);
    avA11y.keyBound = true;
    return true;
  } catch (e) { avA11yRecord(e, "keys"); return false; }
}

/* ---------- the decoration pass (idempotent; attribute writes only) ---------- */

/* .av-knob[data-knob] without tabindex -> tabindex="0" */
function avA11yKnobPass() {
  try {
    const doc = avA11yDoc();
    if (!doc || !doc.querySelectorAll) return;
    const knobs = doc.querySelectorAll(".av-knob[data-knob]");
    for (let i = 0; i < knobs.length; i++) {
      const el = knobs[i];
      if (el && el.hasAttribute && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    }
  } catch (e) { avA11yRecord(e, "knobs"); }
}

/* canvas inside .av-card without role -> role="img" + aria-label from the card heading */
function avA11yCanvasPass() {
  try {
    const doc = avA11yDoc();
    if (!doc || !doc.querySelectorAll) return;
    const list = doc.querySelectorAll(".av-card canvas");
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || !c.setAttribute || (c.hasAttribute && c.hasAttribute("role"))) continue;
      c.setAttribute("role", "img");
      if (!c.getAttribute || !c.getAttribute("aria-label")) {
        let lbl = "";
        const card = (c.closest ? c.closest(".av-card") : null) || c.parentElement;
        if (card && card.querySelector) {
          const h = card.querySelector("h1, h2, h3, h4, h5, h6");
          if (h) lbl = avA11yStr(h.textContent, AV_A11Y_LABEL_MAX);
        }
        c.setAttribute("aria-label", lbl || "visual display");
      }
    }
  } catch (e) { avA11yRecord(e, "canvas"); }
}

/* the pinned status selectors -> role="status" when missing */
function avA11yStatusPass() {
  try {
    const doc = avA11yDoc();
    if (!doc || !doc.querySelectorAll) return;
    for (let i = 0; i < AV_A11Y_STATUS_SELECTORS.length; i++) {
      const list = doc.querySelectorAll(AV_A11Y_STATUS_SELECTORS[i]);
      for (let j = 0; j < list.length; j++) {
        const el = list[j];
        if (el && el.setAttribute && (!el.getAttribute || !el.getAttribute("role"))) el.setAttribute("role", "status");
      }
    }
  } catch (e) { avA11yRecord(e, "status"); }
}

/* the accessible name of a control, exactly per the pin: textContent || aria-label || title ||
   alt of a contained img. Empty string = nameless. */
function avA11yNameOf(el) {
  try {
    if (!el) return "";
    const text = avA11yStr(el.textContent, 0);
    if (text) return text;
    if (el.getAttribute) {
      const al = avA11yStr(el.getAttribute("aria-label"), 0);
      if (al) return al;
      const ti = avA11yStr(el.getAttribute("title"), 0);
      if (ti) return ti;
    }
    const img = el.querySelector ? el.querySelector("img[alt]") : null;
    if (img && img.getAttribute) {
      const alt = avA11yStr(img.getAttribute("alt"), 0);
      if (alt) return alt;
    }
  } catch (e) { /* a nameless control is the honest answer */ }
  return "";
}

/* every button/select/input/a[href] inside header, main and footer (hidden inputs excluded) */
function avA11yControlNodes() {
  const out = [];
  try {
    const doc = avA11yDoc();
    if (!doc || !doc.querySelectorAll) return out;
    const scopes = doc.querySelectorAll("header, main, footer");
    for (let i = 0; i < scopes.length; i++) {
      const found = scopes[i].querySelectorAll("button, select, input, a[href]");
      for (let j = 0; j < found.length; j++) {
        const el = found[j];
        if (!el) continue;
        if (el.tagName === "INPUT" && (el.type || (el.getAttribute ? el.getAttribute("type") : "")) === "hidden") continue;
        out.push(el);
      }
    }
  } catch (e) { /* partial list beats none */ }
  return out;
}

function avA11yNameAudit() {
  const nodes = avA11yControlNodes();
  let named = 0;
  for (let i = 0; i < nodes.length; i++) if (avA11yNameOf(nodes[i])) named++;
  return { total: nodes.length, named: named, unnamed: nodes.length - named };
}

/* backfill aria-label when a control has no accessible name: placeholder || name || id ||
   "control". Only writes where the name is empty, so a second pass is a no-op. */
function avA11yNamePass() {
  try {
    const nodes = avA11yControlNodes();
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (avA11yNameOf(el)) continue;
      let src = "";
      try {
        if (el.getAttribute) {
          src = avA11yStr(el.getAttribute("placeholder"), 0);
          if (!src) src = avA11yStr(el.getAttribute("name"), 0);
        }
        if (!src) src = avA11yStr(el.id, 0);
        if (!src) src = "control";
      } catch (e2) { src = "control"; }
      try { el.setAttribute("aria-label", avA11yStr(src, AV_A11Y_LABEL_MAX)); } catch (e3) { avA11yRecord(e3, "name"); }
    }
  } catch (e) { avA11yRecord(e, "names"); }
}

/* [role="button"]:not(button) -> tabindex="0" when missing */
function avA11yRoleButtonPass() {
  try {
    const doc = avA11yDoc();
    if (!doc || !doc.querySelectorAll) return;
    const list = doc.querySelectorAll('[role="button"]:not(button)');
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (el && el.hasAttribute && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    }
  } catch (e) { avA11yRecord(e, "rolebuttons"); }
}

/* the pinned counts — satisfied totals, read fresh from the DOM (never a write) */
function avA11yCounts() {
  const c = { sliders: 0, knobsTabbed: 0, canvases: 0, liveRegions: 0, roleButtons: 0, labeled: 0, unnamed: 0 };
  try {
    const doc = avA11yDoc();
    if (!doc || !doc.querySelectorAll) return c;
    c.sliders = doc.querySelectorAll(".av-knob[data-knob]").length;
    c.knobsTabbed = doc.querySelectorAll(".av-knob[data-knob][tabindex]").length;
    c.canvases = doc.querySelectorAll(".av-card canvas[role]").length;
    let regs = 0;
    for (let i = 0; i < AV_A11Y_STATUS_SELECTORS.length; i++) {
      const list = doc.querySelectorAll(AV_A11Y_STATUS_SELECTORS[i]);
      for (let j = 0; j < list.length; j++) {
        const el = list[j];
        if (el && el.getAttribute && el.getAttribute("role") === "status") regs++;
      }
    }
    c.liveRegions = regs;
    c.roleButtons = doc.querySelectorAll('[role="button"]:not(button)[tabindex]').length;
    const audit = avA11yNameAudit();
    c.labeled = audit.named;
    c.unnamed = audit.unnamed;
  } catch (e) { /* partials stand */ }
  return c;
}

/* one full pass: decorate, then snapshot the counts. Never throws (every step guarded). */
function avA11yPass(why) {
  try {
    avA11yKnobPass();
    avA11yCanvasPass();
    avA11yStatusPass();
    avA11yNamePass();
    avA11yRoleButtonPass();
    avA11y.counts = avA11yCounts();
    return avA11y.counts;
  } catch (e) {
    avA11yRecord(e, "pass");
    return avA11y.counts;
  }
}

/* ---------- prefs changes: persist, apply, speak, emit ---------- */

function avA11yEmit() {
  try {
    const doc = avA11yDoc();
    if (!doc || typeof doc.dispatchEvent !== "function" || typeof CustomEvent !== "function") return false;
    doc.dispatchEvent(new CustomEvent("av-a11y", {
      detail: { contrast: avA11y.contrast === true, motion: avA11y.motion === "reduce" ? "reduce" : "system" },
      bubbles: true,
    }));
    return true;
  } catch (e) { return false; }
}

function avA11yCommit(kind, changed) {
  avA11yWritePrefs();
  avA11yMediaSync();
  avA11yApply();
  if (changed !== true) return;
  if (kind === "contrast") {
    avA11yAnnounce(avA11y.contrast === true ? "High contrast on" : "High contrast off");
  } else if (kind === "motion") {
    avA11yAnnounce(avA11y.motion === "reduce" ? "Reduce motion on" : "Reduce motion follows the system setting");
  }
  avA11yEmit();
}

function avA11ySetPref(k, v) {
  try {
    let nv = null;
    if (k === "contrast") nv = avA11yBool(v);
    else if (k === "motion") nv = (v === "reduce") ? "reduce" : "system";
    else return false;
    let changed = false;
    if (k === "contrast") { changed = avA11y.contrast !== nv; avA11y.contrast = nv; }
    else { changed = avA11y.motion !== nv; avA11y.motion = nv; }
    avA11yCommit(k, changed);
    return true;
  } catch (e) { avA11yRecord(e, "setPref"); return false; }
}

function avA11yToggle(k) {
  try {
    if (k === "contrast") return avA11ySetPref("contrast", avA11y.contrast !== true);
    if (k === "motion") return avA11ySetPref("motion", avA11y.motion === "reduce" ? "system" : "reduce");
    return false;
  } catch (e) { avA11yRecord(e, "toggle"); return false; }
}

/* ---------- init: pass 1 now, pass 2 at +1200 ms ---------- */

function avA11yTick2() {
  try {
    avA11yEnsureUI();
    avA11yEnsureSkip();
    avA11yEnsureLive();
    avA11yMediaSync();
    avA11yApply();
    avA11yPass("pass2");
  } catch (e) { avA11yRecord(e, "pass2"); }
  avA11y.timer2 = 0;
  avA11y.pass2Done = true;
}

function avA11yInit() {
  try {
    const doc = avA11yDoc();
    if (!doc) return false;
    const prefs = avA11yReadPrefs();
    avA11y.contrast = prefs.contrast === true;
    avA11y.motion = prefs.motion === "reduce" ? "reduce" : "system";
    avA11yEnsureUI();
    avA11yEnsureSkip();
    avA11yEnsureLive();
    avA11yBindKeys();
    avA11yMediaSync();
    avA11yApply();
    avA11y.inited = true;
    avA11yPass("pass1");
    if (typeof setTimeout === "function" && !avA11y.timer2 && !avA11y.pass2Done) {
      avA11y.timer2 = setTimeout(avA11yTick2, AV_A11Y_PASS2_MS);
    }
    return true;
  } catch (e) { avA11yRecord(e, "init"); return false; }
}

/* ---------- state / proof / classes (the pinned surfaces) ---------- */

function avA11yState() {
  const st = {
    version: AV_A11Y_VERSION,
    inited: avA11y.inited === true,
    contrast: avA11y.contrast === true,
    motion: avA11y.motion === "reduce" ? "reduce" : "system",
    systemReduced: false,
    reduceActive: false,
    skip: false,
    live: false,
    counts: { sliders: 0, knobsTabbed: 0, canvases: 0, liveRegions: 0, roleButtons: 0, labeled: 0, unnamed: 0 },
    errors: [],
  };
  try {
    st.systemReduced = avA11ySystemReduced() === true;
    st.reduceActive = avA11yReduceActive() === true;
    const doc = avA11yDoc();
    if (doc) {
      st.skip = !!(doc.getElementById && doc.getElementById("av-a11y-skip"));
      st.live = !!(doc.getElementById && doc.getElementById("av-a11y-live"));
      st.counts = avA11yCounts();
    } else {
      st.counts = {
        sliders: avA11y.counts.sliders, knobsTabbed: avA11y.counts.knobsTabbed,
        canvases: avA11y.counts.canvases, liveRegions: avA11y.counts.liveRegions,
        roleButtons: avA11y.counts.roleButtons, labeled: avA11y.counts.labeled,
        unnamed: avA11y.counts.unnamed,
      };
    }
    st.errors = avA11y.errors.slice(0, AV_A11Y_ERRORS_MAX);
  } catch (e) { /* the honest defaults stand */ }
  return st;
}

/* one line for the app core's ?avtest=1 list — RETURNED, never printed here */
function avA11yProof() {
  const out = { ok: false };
  try {
    const st = avA11yState();
    out.version = st.version;
    out.inited = st.inited === true;
    out.contrast = st.contrast === true;
    out.motion = st.motion;
    out.systemReduced = st.systemReduced === true;
    out.reduceActive = st.reduceActive === true;
    out.skip = st.skip === true;
    out.live = st.live === true;
    out.sliders = st.counts.sliders;
    out.knobsTabbed = st.counts.knobsTabbed;
    out.canvases = st.counts.canvases;
    out.liveRegions = st.counts.liveRegions;
    out.roleButtons = st.counts.roleButtons;
    out.labeled = st.counts.labeled;
    out.unnamed = st.counts.unnamed;
    out.errors = st.errors.length;
    out.ok = out.inited === true && out.skip === true && out.live === true && out.unnamed === 0;
  } catch (e) { /* keep the honest defaults */ }
  try { return "A11Y SELFTEST " + JSON.stringify(out); } catch (e2) { return "A11Y SELFTEST {}"; }
}

function avA11yClasses() {
  return AV_A11Y_CLASSES.slice();
}

/* ---------- debug handle (contract surface) ---------- */

if (typeof window !== "undefined") {
  try {
    window.__avA11y = {
      version: AV_A11Y_VERSION,
      init: avA11yInit,
      state: avA11yState,
      setPref: avA11ySetPref,
      toggle: avA11yToggle,
    };
  } catch (e) { /* no window - nothing to publish */ }
}
