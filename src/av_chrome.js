/* Anvil — the module chrome (R2): every card gets a Serum-2-style module head — collapse toggle,
   module menu (Init / Randomize / Collapse), plus the Synth-zone engine strip and the header
   utilities (BROWSE, undo, redo). All writes ride existing funnels: knobs return to their defaults
   through avKnobCommit (the one commit path); nothing here touches the engine directly. */
"use strict";

const AV_CHROME_VERSION = "r2.0";
const AV_CHROME_FOLD_KEY = "av-fold";

/* id -> capabilities: init = first knob of the card resets to data-def; rnd = randomize allowed */
const AV_CHROME_CARDS = [
  { id: "av-levels", init: true, rnd: false },
  { id: "av-synth", init: true, rnd: true },
  { id: "av-fm", init: true, rnd: true },
  { id: "av-fx", init: true, rnd: false },
  { id: "av-mod", init: true, rnd: false },
  { id: "av-drums", init: true, rnd: false },
  { id: "av-sample", init: true, rnd: false },
  { id: "av-chop", init: true, rnd: false },
  { id: "av-wt", init: true, rnd: false },
  { id: "av-seq", init: false, rnd: false },
  { id: "av-mix", init: false, rnd: false },
  { id: "av-deck", init: false, rnd: false },
  { id: "av-rec", init: false, rnd: false },
  { id: "av-studio", init: false, rnd: false },
  { id: "av-sessions", init: false, rnd: false },
  { id: "av-comp", init: false, rnd: false },
  { id: "av-deliver", init: false, rnd: false },
  { id: "av-store", init: false, rnd: false },
  { id: "av-code", init: false, rnd: false },
  { id: "av-files", init: false, rnd: false },
  { id: "av-family", init: false, rnd: false },
  { id: "av-roadmap", init: false, rnd: false },
  { id: "av-midi-card", init: false, rnd: false },
];

const avChromeState = { ready: false, menu: null, menuCard: null, menuOpenFor: null };

function avChromeInfo(id) {
  for (let i = 0; i < AV_CHROME_CARDS.length; i++) if (AV_CHROME_CARDS[i].id === id) return AV_CHROME_CARDS[i];
  return null;
}

/* ---------- fold (collapse) ---------- */
function avChromeFoldMap() {
  try {
    const raw = localStorage.getItem(AV_CHROME_FOLD_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return (o && typeof o === "object") ? o : {};
  } catch (e) { return {}; }
}
function avChromeFoldSave(map) {
  try { localStorage.setItem(AV_CHROME_FOLD_KEY, JSON.stringify(map)); } catch (e) { /* session only */ }
}
function avChromeSetFold(card, fold, persist) {
  if (!card) return false;
  card.classList.toggle("av-mod-fold", fold === true);
  const tg = card.querySelector(":scope > .av-mod-head .av-mod-toggle");
  if (tg) {
    tg.textContent = fold === true ? "\u25B8" : "\u25BE";
    tg.setAttribute("aria-expanded", fold === true ? "false" : "true");
    tg.setAttribute("aria-label", fold === true ? "Expand module" : "Collapse module");
    tg.title = fold === true ? "Expand module" : "Collapse module";
  }
  if (persist) {
    const map = avChromeFoldMap();
    if (fold === true) map[card.id] = true; else delete map[card.id];
    avChromeFoldSave(map);
  }
  return true;
}

/* ---------- Init / Randomize (through the ONE knob commit funnel) ---------- */
function avChromeCardKnobs(card) {
  if (!card) return [];
  return Array.prototype.slice.call(card.querySelectorAll(".av-knob[data-knob]"));
}
function avChromeInitCard(id) {
  try {
    const card = document.getElementById(id);
    const info = avChromeInfo(id);
    if (!card || !info || !info.init) return 0;
    if (typeof avKnobCommit !== "function") return 0;
    const knobs = avChromeCardKnobs(card);
    let n = 0;
    for (let i = 0; i < knobs.length; i++) {
      const el = knobs[i];
      const def = parseFloat(el.dataset.def);
      if (!isFinite(def)) continue;
      try { avKnobCommit(el, def); n++; } catch (e) { /* one knob must not stop the sweep */ }
    }
    return n;
  } catch (e) { return 0; }
}
function avChromeRandomizeCard(id) {
  try {
    const card = document.getElementById(id);
    const info = avChromeInfo(id);
    if (!card || !info || !info.rnd) return 0;
    if (typeof avKnobCommit !== "function") return 0;
    const knobs = avChromeCardKnobs(card);
    let n = 0;
    for (let i = 0; i < knobs.length; i++) {
      const el = knobs[i];
      const min = parseFloat(el.dataset.min), max = parseFloat(el.dataset.max), step = parseFloat(el.dataset.step);
      if (!isFinite(min) || !isFinite(max) || max <= min) continue;
      let v = min + Math.random() * (max - min);
      if (isFinite(step) && step > 0) v = min + Math.round((v - min) / step) * step;
      v = Math.max(min, Math.min(max, v));
      try { avKnobCommit(el, v); n++; } catch (e) { /* one knob must not stop the sweep */ }
    }
    return n;
  } catch (e) { return 0; }
}

/* ---------- the module menu popover ---------- */
function avChromeMenuEl() {
  try {
    if (avChromeState.menu && document.body.contains(avChromeState.menu)) return avChromeState.menu;
    let el = document.getElementById("av-mod-menu");
    if (!el) {
      el = document.createElement("div");
      el.id = "av-mod-menu";
      el.className = "av-mod-menu";
      el.setAttribute("role", "menu");
      el.setAttribute("aria-label", "Module menu");
      document.body.appendChild(el);
    }
    avChromeState.menu = el;
    return el;
  } catch (e) { return null; }
}
function avChromeMenuClose() {
  const el = avChromeState.menu;
  if (el) { el.classList.remove("open"); el.innerHTML = ""; }
  const btn = avChromeState.menuOpenFor;
  if (btn) { try { btn.setAttribute("aria-expanded", "false"); } catch (e) { /* gone */ } }
  avChromeState.menuOpenFor = null;
  avChromeState.menuCard = null;
}
function avChromeMenuOpen(btn, card) {
  try {
    const el = avChromeMenuEl();
    if (!el || !card) return false;
    const info = avChromeInfo(card.id) || { init: false, rnd: false };
    const items = [];
    if (info.init) items.push({ label: "Init module (knobs to defaults)", run: function () { avChromeInitCard(card.id); } });
    if (info.rnd) items.push({ label: "Randomize module", run: function () { avChromeRandomizeCard(card.id); } });
    if (typeof avPanelToggle === "function") items.push({ label: "Float / dock module", run: function () { avPanelToggle(card.id); } });
    items.push({ label: "Collapse / expand", run: function () { avChromeSetFold(card, !card.classList.contains("av-mod-fold"), true); } });
    el.innerHTML = "";
    for (let i = 0; i < items.length; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "av-mod-menu-item";
      b.setAttribute("role", "menuitem");
      b.textContent = items[i].label;
      (function (fn) { b.addEventListener("click", function () { avChromeMenuClose(); try { fn(); } catch (e) { /* action guards itself */ } }); })(items[i].run);
      el.appendChild(b);
    }
    el.classList.add("open");
    const r = btn.getBoundingClientRect();
    const w = el.offsetWidth || 180, h = el.offsetHeight || 90;
    let x = Math.min(Math.max(8, r.right - w), Math.max(8, window.innerWidth - w - 8));
    let y = r.bottom + 4;
    if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 4);
    el.style.left = x + "px";
    el.style.top = y + "px";
    try { btn.setAttribute("aria-expanded", "true"); } catch (e2) { /* gone */ }
    avChromeState.menuOpenFor = btn;
    avChromeState.menuCard = card.id;
    return true;
  } catch (e) { return false; }
}
function avChromeMenuWireAway() {
  try {
    document.addEventListener("pointerdown", function (e) {
      if (!avChromeState.menuOpenFor) return;
      const el = avChromeState.menu;
      if (el && el.contains(e.target)) return;
      if (avChromeState.menuOpenFor.contains && avChromeState.menuOpenFor.contains(e.target)) return;
      avChromeMenuClose();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (avChromeState.menuOpenFor && e && e.key === "Escape") avChromeMenuClose();
    }, true);
    return true;
  } catch (e) { return false; }
}

/* ---------- the module heads ---------- */
function avChromeBuildHead(card) {
  try {
    if (!card || card.querySelector(":scope > .av-mod-head")) return false;
    let h2 = null;
    const kids = card.children;
    for (let i = 0; i < kids.length; i++) { if (kids[i].tagName === "H2") { h2 = kids[i]; break; } }
    if (!h2) return false;
    const head = document.createElement("div");
    head.className = "av-mod-head";
    const tg = document.createElement("button");
    tg.type = "button";
    tg.className = "av-mod-toggle av-btn mini";
    tg.setAttribute("aria-label", "Collapse module");
    tg.setAttribute("aria-expanded", "true");
    tg.title = "Collapse module";
    tg.textContent = "\u25BE";
    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "av-mod-menu-btn av-btn mini";
    menu.setAttribute("aria-haspopup", "menu");
    menu.setAttribute("aria-expanded", "false");
    menu.setAttribute("aria-label", "Module menu");
    menu.title = "Module menu";
    menu.textContent = "\u22EF";
    const gap = document.createElement("span");
    gap.className = "av-mod-gap";
    card.insertBefore(head, h2);
    head.appendChild(tg);
    head.appendChild(h2);          /* the ORIGINAL h2 moves in, text preserved */
    head.appendChild(gap);
    head.appendChild(menu);
    const flt = document.createElement("button");
    flt.type = "button";
    flt.className = "av-mod-float-btn av-btn mini";
    flt.setAttribute("aria-label", "Float this module in the workspace");
    flt.title = "Float this module in the workspace";
    flt.textContent = "\u29C9";
    head.appendChild(flt);
    flt.addEventListener("click", function () { if (typeof avPanelToggle === "function") avPanelToggle(card.id); });
    tg.addEventListener("click", function () { avChromeSetFold(card, !card.classList.contains("av-mod-fold"), true); });
    menu.addEventListener("click", function () { avChromeMenuOpen(menu, card); });
    return true;
  } catch (e) { return false; }
}

/* ---------- the Synth-zone engine strip (jumps row, OSC-A/B/C style) ---------- */
function avChromeBuildEngineStrip() {
  try {
    if (document.getElementById("av-engine-strip")) return true;
    const box = document.querySelector("#av-zone-synth .av-zone-box");
    if (!box) return false;
    const strip = document.createElement("div");
    strip.id = "av-engine-strip";
    strip.className = "av-engine-strip";
    strip.setAttribute("role", "toolbar");
    strip.setAttribute("aria-label", "Engines");
    const chips = [
      ["VA \u00B7 WT", "av-synth"],
      ["FM", "av-fm"],
      ["DRUMS", "av-drums"],
      ["SAMPLES", "av-sample"],
      ["CHOP", "av-chop"],
      ["WT EDITOR", "av-wt"],
    ];
    for (let i = 0; i < chips.length; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "av-engine-chip";
      b.setAttribute("data-target", chips[i][1]);
      b.textContent = chips[i][0];
      b.title = "Jump to the " + chips[i][0] + " module";
      (function (target) {
        b.addEventListener("click", function () {
          try {
            const el = document.getElementById(target);
            if (el && el.scrollIntoView) el.scrollIntoView({ block: "start" });
          } catch (e) { /* jump is best-effort */ }
        });
      })(chips[i][1]);
      strip.appendChild(b);
    }
    /* after the first-run strip when present, else first */
    const firstrun = box.querySelector("#av-firstrun");
    if (firstrun && firstrun.nextSibling) box.insertBefore(strip, firstrun.nextSibling);
    else if (firstrun) box.appendChild(strip);
    else box.insertBefore(strip, box.firstChild);
    return true;
  } catch (e) { return false; }
}

/* ---------- the header utilities ---------- */
function avChromeHeaderButton(id, label, title, onClick) {
  try {
    if (document.getElementById(id)) return true;
    const head = document.querySelector("header.av-head");
    if (!head) return false;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "av-btn mini";
    b.id = id;
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("click", onClick);
    const help = document.getElementById("av-help");
    if (help && help.parentNode === head) head.insertBefore(b, help);
    else head.appendChild(b);
    return true;
  } catch (e) { return false; }
}
function avChromeBuildHeader() {
  avChromeHeaderButton("av-head-browse", "BROWSE", "Browse packs and presets (the Store zone)", function () {
    try {
      if (typeof avZoneShow === "function") avZoneShow("store", { source: "browse" });
      const s = document.querySelector("#av-store-host .av-store-search");
      if (s && s.focus) { try { s.focus(); } catch (e) { /* focus is best-effort */ } }
    } catch (e) { /* browse stays clickable */ }
  });
  avChromeHeaderButton("av-head-undo", "\u21B6", "Undo (Ctrl+Z)", function () { try { if (typeof avUndo === "function") avUndo(); } catch (e) { /* guard */ } });
  avChromeHeaderButton("av-head-redo", "\u21B7", "Redo (Ctrl+Y)", function () { try { if (typeof avRedo === "function") avRedo(); } catch (e) { /* guard */ } });
  avChromeHeaderButton("av-head-about", "ABOUT", "About this build - the phase notes (moved out of the page)", function () { try { if (typeof avAboutToggle === "function") avAboutToggle(); } catch (e) { /* guard */ } });
  avChromeHeaderButton("av-head-rail", "NAV", "Module navigator - show / hide the left rail", function () { try { if (typeof avRailToggle === "function") avRailToggle(); } catch (e) { /* guard */ } });
  return true;
}

/* ---------- boot ---------- */
function avChromeInit() {
  try {
    if (avChromeState.ready) return true;
    avChromeMenuEl();              /* materialize the menu host up front (the R2 contract pins it) */
    let heads = 0;
    for (let i = 0; i < AV_CHROME_CARDS.length; i++) {
      const card = document.getElementById(AV_CHROME_CARDS[i].id);
      if (card && avChromeBuildHead(card)) heads++;
    }
    avChromeBuildEngineStrip();
    avChromeBuildHeader();
    avChromeMenuWireAway();
    /* apply persisted folds */
    const map = avChromeFoldMap();
    for (let i = 0; i < AV_CHROME_CARDS.length; i++) {
      const card = document.getElementById(AV_CHROME_CARDS[i].id);
      if (card && map[card.id]) avChromeSetFold(card, true, false);
    }
    avChromeState.ready = heads > 0;
    return avChromeState.ready;
  } catch (e) {
    console.warn("[anvil] chrome init failed", e);
    return false;
  }
}

function avChromeProof() {
  let heads = 0;
  for (let i = 0; i < AV_CHROME_CARDS.length; i++) if (document.querySelector("#" + AV_CHROME_CARDS[i].id + " > .av-mod-head")) heads++;
  return "CHROME SELFTEST " + JSON.stringify({
    v: AV_CHROME_VERSION,
    heads: heads,
    cards: AV_CHROME_CARDS.length,
    strip: !!document.getElementById("av-engine-strip"),
    browse: !!document.getElementById("av-head-browse"),
  });
}

if (typeof window !== "undefined" && window) {
  try {
    window.__avChrome = {
      version: AV_CHROME_VERSION,
      init: function () { return avChromeInit(); },
      initCard: function (id) { return avChromeInitCard(id); },
      randomizeCard: function (id) { return avChromeRandomizeCard(id); },
      fold: function (id, on) { const c = document.getElementById(id); return c ? avChromeSetFold(c, on === true, true) : false; },
      cards: function () { return AV_CHROME_CARDS.map(function (c) { return c.id; }); },
    };
  } catch (e) { /* no window - nothing to publish */ }
}
