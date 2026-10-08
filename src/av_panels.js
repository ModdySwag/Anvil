/* Anvil — the float workspace (R3): pop any module out into a free-floating panel, drag it by its
   module head, resize from the grip, bring it to front on focus — the FL-Studio-class "move your
   modules around the desk" workflow. Layouts persist in localStorage "av-float" {cardId:{x,y,w,h}}
   and restore at boot; curated presets (sound design / mixdown) + reset live in the palette.
   This module also owns the About popover: the phase-notes card moved out of the page into the
   header (BROWSE's neighbourhood) to save working screen space. */
"use strict";

const AV_PANELS_VERSION = "r3.0";
const AV_PANELS_LS = "av-float";
const AV_ABOUT_ID = "av-about-pop";
const AV_PANEL_ACCENTS = {
  synth: "#2ED8C9", fx: "#E69F00", mod: "#CC79A7", seq: "#009E73",
  studio: "#56B4E9", store: "#F0E442", code: "#E8794A", system: "#4C9FE0",
};
const AV_PANEL_LAYOUTS = {
  sounddesign: { open: [["av-synth", 40, 84], ["av-fm", 500, 84], ["av-mod", 60, 428], ["av-fx", 560, 428]] },
  mixdown: { open: [["av-mix", 40, 84], ["av-deck", 540, 84], ["av-fx", 60, 470]] },
};

const avPanelsState = { ready: false, z: 56, drag: null, seq: 0 };

function avPanelsMap() {
  try {
    const raw = localStorage.getItem(AV_PANELS_LS);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return (o && typeof o === "object") ? o : {};
  } catch (e) { return {}; }
}
function avPanelsSave(map) {
  try { localStorage.setItem(AV_PANELS_LS, JSON.stringify(map)); return true; } catch (e) { return false; }
}
function avPanelEl(id) { return document.getElementById("av-float-" + id); }
function avPanelsList() {
  const out = [];
  try {
    const all = document.querySelectorAll(".av-float[data-card]");
    for (let i = 0; i < all.length; i++) out.push(all[i].getAttribute("data-card"));
  } catch (e) { /* none */ }
  return out;
}
function avPanelZoneOf(card) {
  try {
    const z = card && card.closest ? card.closest(".av-zone") : null;
    return z ? z.getAttribute("data-zone") : null;
  } catch (e) { return null; }
}
function avPanelClampX(x, w) {
  const W = window.innerWidth || 1280;
  return Math.max(-(w - 90), Math.min(x, W - 90));
}
function avPanelClampY(y, h) {
  const H = window.innerHeight || 800;
  return Math.max(0, Math.min(y, H - 34));
}

/* ---------- open / close (MOVE model: the live card relocates; close restores it) ---------- */
function avPanelFocus(panel) {
  try {
    if (!panel) return false;
    if (panel.classList.contains("av-float-pin")) { panel.style.zIndex = "900"; return true; }
    avPanelsState.z += 1;
    panel.style.zIndex = String(avPanelsState.z);
    return true;
  } catch (e) { return false; }
}
function avPanelOpen(id, pos) {
  try {
    if (avPanelEl(id)) { avPanelFocus(avPanelEl(id)); return true; }
    const card = document.getElementById(String(id || ""));
    if (!card || !card.closest || !card.closest(".av-zone")) return false;
    const zone = avPanelZoneOf(card);
    const panel = document.createElement("div");
    panel.className = "av-float";
    panel.id = "av-float-" + id;
    panel.setAttribute("data-card", id);
    panel.setAttribute("data-zone", zone || "synth");
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "Floating module: " + id);
    try { panel.style.setProperty("--zone-accent", AV_PANEL_ACCENTS[zone] || AV_PANEL_ACCENTS.synth); } catch (e2) { /* accent cosmetic */ }
    card.__avFloatHome = { parent: card.parentNode, next: card.nextSibling };
    document.body.appendChild(panel);
    panel.appendChild(card);
    /* the module head becomes the drag bar + gains a close button */
    const head = card.querySelector(":scope > .av-mod-head");
    if (head) {
      head.classList.add("av-float-head-drag");
      const wctl = avPanelHeadControls(id);
      for (let wi = 0; wi < wctl.length; wi++) head.appendChild(wctl[wi]);
      const x = document.createElement("button");
      x.type = "button";
      x.className = "av-btn mini av-float-btn";
      x.setAttribute("aria-label", "Bring this module back to its zone");
      x.title = "Bring this module back to its zone";
      x.textContent = "\u00D7";
      x.addEventListener("click", function () { avPanelClose(id); });
      head.appendChild(x);
    }
    const grip = document.createElement("div");
    grip.className = "av-float-grip";
    grip.setAttribute("role", "separator");
    grip.setAttribute("aria-label", "Resize panel");
    panel.appendChild(grip);
    /* position: last saved or a cascade */
    const saved = avPanelsMap()[id] || {};
    const n = avPanelsState.seq++;
    const x0 = (typeof saved.x === "number") ? saved.x : (40 + (n % 5) * 38);
    const y0 = (typeof saved.y === "number") ? saved.y : (76 + (n % 6) * 34);
    panel.style.left = x0 + "px";
    panel.style.top = y0 + "px";
    if (typeof saved.w === "number" && saved.w > 0) panel.style.width = saved.w + "px";
    if (typeof saved.h === "number" && saved.h > 0) panel.style.height = saved.h + "px";
    if (typeof saved.op === "number") panel.style.opacity = String(saved.op);
    avPanelFocus(panel);
    avPanelsPersist(id, panel);
    if (typeof avA11yAnnounce === "function") { try { avA11yAnnounce("Floating: " + id); } catch (e3) { /* announce best-effort */ } }
    try { window.dispatchEvent(new CustomEvent("av-panels-changed")); } catch (e4) { /* listeners best-effort */ }
    return true;
  } catch (e) { return false; }
}
function avPanelClose(id) {
  try {
    const panel = avPanelEl(id);
    if (!panel) return false;
    const card = panel.querySelector(":scope > .av-card");
    const head = card ? card.querySelector(":scope > .av-mod-head") : null;
    if (head) {
      head.classList.remove("av-float-head-drag");
      const x = head.querySelector(".av-float-btn");
      if (x && x.parentNode) x.parentNode.removeChild(x);
    }
    if (card && card.__avFloatHome) {
      const home = card.__avFloatHome;
      try { if (home.parent) home.parent.insertBefore(card, home.next || null); } catch (e2) { /* put back best effort */ }
      try { delete card.__avFloatHome; } catch (e3) { card.__avFloatHome = null; }
    }
    if (panel.parentNode) panel.parentNode.removeChild(panel);
    const map = avPanelsMap();
    delete map[id];
    avPanelsSave(map);
    try { window.dispatchEvent(new CustomEvent("av-panels-changed")); } catch (e4) { /* listeners best-effort */ }
    return true;
  } catch (e) { return false; }
}
function avPanelToggle(id) {
  return avPanelEl(id) ? avPanelClose(id) : avPanelOpen(id);
}
function avPanelsPersist(id, panel) {
  try {
    const map = avPanelsMap();
    const r = panel.getBoundingClientRect();
    map[id] = {
      x: Math.round(parseFloat(panel.style.left || r.left) || r.left),
      y: Math.round(parseFloat(panel.style.top || r.top) || r.top),
      w: Math.round(r.width), h: Math.round(r.height),
    };
    avPanelsSave(map);
    return true;
  } catch (e) { return false; }
}
function avPanelsMove(id, x, y) {
  try {
    const panel = avPanelEl(id);
    if (!panel) return false;
    const r = panel.getBoundingClientRect();
    panel.style.left = avPanelClampX(x, r.width) + "px";
    panel.style.top = avPanelClampY(y, r.height) + "px";
    avPanelsPersist(id, panel);
    return true;
  } catch (e) { return false; }
}
function avPanelsResize(id, w, h) {
  try {
    const panel = avPanelEl(id);
    if (!panel) return false;
    const W = window.innerWidth || 1280, H = window.innerHeight || 800;
    const nw = Math.max(320, Math.min(w, Math.round(W * 0.94)));
    const nh = Math.max(140, Math.min(h, Math.round(H * 0.88)));
    panel.style.width = nw + "px";
    panel.style.height = nh + "px";
    avPanelsPersist(id, panel);
    return true;
  } catch (e) { return false; }
}
function avPanelsReset() {
  try {
    const ids = avPanelsList();
    for (let i = 0; i < ids.length; i++) avPanelClose(ids[i]);
    return ids.length >= 0;
  } catch (e) { return false; }
}
function avPanelsLayout(name) {
  try {
    const L = AV_PANEL_LAYOUTS[name];
    if (!L) return false;
    avPanelsReset();
    let i = 0;
    for (let k = 0; k < L.open.length; k++) {
      const [id, x, y] = L.open[k];
      if (avPanelOpen(id)) { avPanelsMove(id, x + i * 14, y + i * 10); i += 1; }
    }
    return i > 0;
  } catch (e) { return false; }
}

/* ---------- drag + resize wiring (pointer events, capture on window) ---------- */

/* ---------- R4 window controls: pin / opacity / minimize-stack / maximize + named layouts ---------- */
function avPanelHeadControls(id) {
  const out = [];
  try {
    const mk = function (cls, label, glyph, fn) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "av-btn mini " + cls;
      b.setAttribute("aria-label", label);
      b.title = label;
      b.textContent = glyph;
      b.addEventListener("click", function (e) { try { fn(id); } catch (e2) { /* guarded */ } if (e && e.stopPropagation) e.stopPropagation(); });
      return b;
    };
    out.push(mk("av-float-btnpin", "Pin panel above others", "\u25C9", function (pid) { avPanelPin(pid); }));
    out.push(mk("av-float-btnop", "Panel opacity", "\u25D1", function (pid) { avPanelCycleOpacity(pid); }));
    out.push(mk("av-float-btnmin", "Minimize (stacks in the corner)", "\u2013", function (pid) { avPanelMinimize(pid); }));
    out.push(mk("av-float-btnmax", "Maximize / restore panel", "\u25A1", function (pid) { avPanelMaxToggle(pid); }));
  } catch (e) { /* controls optional */ }
  return out;
}
function avPanelPin(id) {
  try {
    const panel = avPanelEl(id);
    if (!panel) return false;
    const on = !panel.classList.contains("av-float-pin");
    panel.classList.toggle("av-float-pin", on);
    const b = panel.querySelector(".av-float-btnpin");
    if (b) b.classList.toggle("on", on);
    avPanelFocus(panel);
    return true;
  } catch (e) { return false; }
}
function avPanelCycleOpacity(id) {
  try {
    const panel = avPanelEl(id);
    if (!panel) return false;
    const steps = [1, 0.85, 0.7];
    const cur = parseFloat(panel.style.opacity || "1") || 1;
    let i = 0;
    for (let k = 0; k < steps.length; k++) if (Math.abs(steps[k] - cur) < 0.01) i = k;
    const next = steps[(i + 1) % steps.length];
    panel.style.opacity = String(next);
    const map = avPanelsMap();
    map[id] = Object.assign({}, map[id] || {}, { op: next });
    avPanelsSave(map);
    return true;
  } catch (e) { return false; }
}
function avPanelStackSlot() {
  try { return document.querySelectorAll(".av-float.av-float-min").length; } catch (e) { return 0; }
}
function avPanelMinimize(id, on) {
  try {
    const panel = avPanelEl(id);
    if (!panel) return false;
    const min = (typeof on === "boolean") ? on : !panel.classList.contains("av-float-min");
    panel.classList.toggle("av-float-min", min);
    if (min) {
      panel.__avPrev = { l: panel.style.left, t: panel.style.top, w: panel.style.width, h: panel.style.height };
      panel.style.width = "";
      panel.style.height = "";
      panel.style.left = "12px";
      panel.style.top = (90 + avPanelStackSlot() * 34) + "px";
    } else {
      const pv = panel.__avPrev || {};
      if (pv.w) panel.style.width = pv.w;
      if (pv.h) panel.style.height = pv.h;
      panel.style.left = pv.l || "40px";
      panel.style.top = pv.t || "76px";
    }
    try { window.dispatchEvent(new CustomEvent("av-panels-changed")); } catch (e4) { /* listeners best-effort */ }
    return true;
  } catch (e) { return false; }
}
function avPanelMaxToggle(id) {
  try {
    const panel = avPanelEl(id);
    if (!panel) return false;
    const on = !panel.classList.contains("av-float-max");
    panel.classList.toggle("av-float-max", on);
    if (on) {
      panel.__avPrevMax = { l: panel.style.left, t: panel.style.top, w: panel.style.width, h: panel.style.height };
      panel.style.left = "10px";
      panel.style.top = "10px";
      panel.style.width = Math.max(320, window.innerWidth - 20) + "px";
      panel.style.height = Math.max(200, window.innerHeight - 20) + "px";
    } else {
      const pv = panel.__avPrevMax || {};
      panel.style.left = pv.l || "40px";
      panel.style.top = pv.t || "76px";
      panel.style.width = pv.w || "";
      panel.style.height = pv.h || "";
    }
    return true;
  } catch (e) { return false; }
}
function avPanelsNamedMap() {
  try {
    const raw = localStorage.getItem("av-layouts");
    const o = raw ? JSON.parse(raw) : {};
    return (o && typeof o === "object") ? o : {};
  } catch (e) { return {}; }
}
function avPanelsSaveNamed(name) {
  try {
    const nm = String(name || "").trim().slice(0, 40) || "layout";
    const store = avPanelsNamedMap();
    store[nm] = avPanelsMap();
    localStorage.setItem("av-layouts", JSON.stringify(store));
    return true;
  } catch (e) { return false; }
}
function avPanelsLoadNamed(name) {
  try {
    const nm = String(name || "").trim().slice(0, 40) || "layout";
    const store = avPanelsNamedMap();
    const map = store[nm];
    if (!map || typeof map !== "object") return false;
    avPanelsReset();
    avPanelsSave(map);
    const ids = Object.keys(map);
    for (let i = 0; i < ids.length; i++) avPanelOpen(ids[i], map[ids[i]]);
    return true;
  } catch (e) { return false; }
}
function avPanelsPromptName(dflt) {
  try {
    const r = window.prompt("Layout name", dflt || "layout");
    return (r && String(r).trim()) ? String(r).trim().slice(0, 40) : (dflt || "layout");
  } catch (e) { return dflt || "layout"; }
}

function avPanelsBeginDrag(e, panel, mode) {
  try {
    const id = panel.getAttribute("data-card");
    const r = panel.getBoundingClientRect();
    avPanelsState.drag = {
      id: id, mode: mode, sx: e.clientX, sy: e.clientY,
      x0: r.left, y0: r.top, w0: r.width, h0: r.height, panel: panel,
    };
    document.body.classList.add("av-float-dragging");
    avPanelFocus(panel);
    if (e.target && e.target.setPointerCapture) { try { e.target.setPointerCapture(e.pointerId); } catch (e2) { /* capture best-effort */ } }
    e.preventDefault();
    return true;
  } catch (e3) { return false; }
}
function avPanelsWireDrag() {
  try {
    document.addEventListener("pointerdown", function (e) {
      const panel = e.target && e.target.closest ? e.target.closest(".av-float") : null;
      if (!panel) return;
      avPanelFocus(panel);
      if (e.target.closest(".av-float-grip")) { avPanelsBeginDrag(e, panel, "size"); return; }
      const head = e.target.closest(".av-float > .av-card > .av-mod-head");
      if (head && !e.target.closest("button, select, input, textarea, a")) avPanelsBeginDrag(e, panel, "move");
    }, true);
    window.addEventListener("pointermove", function (e) {
      const d = avPanelsState.drag;
      if (!d) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (d.mode === "move") {
        d.panel.style.left = avPanelClampX(d.x0 + dx, d.w0) + "px";
        d.panel.style.top = avPanelClampY(d.y0 + dy, d.h0) + "px";
      } else {
        const W = window.innerWidth || 1280, H = window.innerHeight || 800;
        const nw = Math.max(320, Math.min(d.w0 + dx, Math.round(W * 0.94)));
        const nh = Math.max(140, Math.min(d.h0 + dy, Math.round(H * 0.88)));
        d.panel.style.width = nw + "px";
        d.panel.style.height = nh + "px";
      }
    });
    document.addEventListener("wheel", function (e) {
      const head = e.target && e.target.closest ? e.target.closest(".av-float > .av-card > .av-mod-head") : null;
      if (!head) return;
      const panel = head.closest(".av-float");
      if (!panel) return;
      avPanelCycleOpacity(panel.getAttribute("data-card"));
      if (e.preventDefault) e.preventDefault();
    }, { passive: false });
    window.addEventListener("pointerup", function () {
      const d = avPanelsState.drag;
      if (!d) return;
      avPanelsState.drag = null;
      document.body.classList.remove("av-float-dragging");
      avPanelsPersist(d.id, d.panel);
    });
    return true;
  } catch (e) { return false; }
}

/* ---------- the About popover (the phase-notes card, in the header now) ---------- */
function avAboutEl() { return document.getElementById(AV_ABOUT_ID); }
function avAboutSet(show) {
  try {
    const el = avAboutEl();
    if (!el) return false;
    el.hidden = !show;
    const b = document.getElementById("av-head-about");
    if (b) b.setAttribute("aria-expanded", show ? "true" : "false");
    return true;
  } catch (e) { return false; }
}
function avAboutToggle(force) {
  try {
    const el = avAboutEl();
    if (!el) return false;
    const show = (typeof force === "boolean") ? force : el.hidden === true;
    avAboutSet(show);
    if (show && typeof avA11yAnnounce === "function") { try { avA11yAnnounce("About this build"); } catch (e2) { /* best-effort */ } }
    return show;
  } catch (e) { return false; }
}
function avAboutWireAway() {
  try {
    document.addEventListener("pointerdown", function (e) {
      const el = avAboutEl();
      if (!el || el.hidden) return;
      if (el.contains(e.target)) return;
      const b = document.getElementById("av-head-about");
      if (b && b.contains(e.target)) return;
      avAboutSet(false);
    }, true);
    document.addEventListener("keydown", function (e) {
      if (!e || e.key !== "Escape") return;
      const el = avAboutEl();
      if (el && !el.hidden) avAboutSet(false);
    }, true);
    return true;
  } catch (e) { return false; }
}

/* ---------- boot ---------- */
function avPanelsInit() {
  try {
    if (avPanelsState.ready) return true;
    avPanelsWireDrag();
    avAboutWireAway();
    const map = avPanelsMap();
    const ids = Object.keys(map);
    for (let i = 0; i < ids.length; i++) avPanelOpen(ids[i], map[ids[i]]);
    avPanelsState.ready = true;
    return true;
  } catch (e) {
    console.warn("[anvil] panels init failed", e);
    return false;
  }
}
function avPanelsProof() {
  return "PANELS SELFTEST " + JSON.stringify({
    v: AV_PANELS_VERSION,
    open: avPanelsList().length,
    layouts: Object.keys(AV_PANEL_LAYOUTS),
    about: !!avAboutEl(),
  });
}

if (typeof window !== "undefined" && window) {
  try {
    window.__avPanels = {
      version: AV_PANELS_VERSION,
      open: function (id, pos) { return avPanelOpen(id, pos); },
      close: function (id) { return avPanelClose(id); },
      toggle: function (id) { return avPanelToggle(id); },
      move: function (id, x, y) { return avPanelsMove(id, x, y); },
      resize: function (id, w, h) { return avPanelsResize(id, w, h); },
      reset: function () { return avPanelsReset(); },
      layout: function (n) { return avPanelsLayout(n); },
      saveNamed: function (n) { return avPanelsSaveNamed(n); },
      loadNamed: function (n) { return avPanelsLoadNamed(n); },
      minimize: function (id, on) { return avPanelMinimize(id, on); },
      maximize: function (id) { return avPanelMaxToggle(id); },
      pin: function (id) { return avPanelPin(id); },
      opacity: function (id) { return avPanelCycleOpacity(id); },
      list: function () { return avPanelsList(); },
      about: function (f) { return avAboutToggle(f); },
    };
  } catch (e) { /* no window - nothing to publish */ }
}
