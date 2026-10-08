/* Anvil — the menu bar (R5): a classic Windows-style menu row — File / Edit / View / Workspace /
   Help — with every navigation + manipulation command one click from home. All actions route to
   existing, guarded engine functions (menus never own state of their own). */
"use strict";

const AV_MENUBAR_VERSION = "r5.0";
const avMenuState = { ready: false, pop: null, openFor: null };

function avMenuCall(name) {
  try {
    if (typeof window[name] === "function") {
      return window[name].apply(null, Array.prototype.slice.call(arguments, 1));
    }
  } catch (e) { /* a menu action can never break the bar */ }
  return false;
}
function avMenuDefs() {
  const Z = (typeof AV_ZONES !== "undefined" && AV_ZONES) ? AV_ZONES : [];
  const goto = function (z) { return function () { avMenuCall("avZoneShow", z, { source: "menu" }); }; };
  return [
    { id: "file", label: "File", items: [
      ["Save project (.anvl)", function () { return avMenuCall("avProjSave"); }],
      ["Open project...", function () { return avMenuCall("avProjOpen"); }],
      ["Export stems (Deliver)", function () { avMenuCall("avZoneShow", "studio", { source: "menu" }); return avMenuCall("avPaletteDeliverHighlight"); }],
      ["Load demo groove", function () { return avMenuCall("avLessonAction", "seq.loadDemo"); }],
    ] },
    { id: "edit", label: "Edit", items: [
      ["Undo (Ctrl+Z)", function () { return avMenuCall("avUndo"); }],
      ["Redo (Ctrl+Y)", function () { return avMenuCall("avRedo"); }],
      ["A/B: store reference", function () { return avMenuCall("avUndoAStore"); }],
      ["A/B: recall reference", function () { return avMenuCall("avUndoARecall"); }],
    ] },
    { id: "view", label: "View", items: [].concat(
      Z.map(function (z) { return ["Go: " + z.label, goto(z.id)]; }),
      [
        ["sep", null],
        ["Show / hide piano (Y)", function () { return avMenuCall("avPianoToggle"); }],
        ["Show / hide module navigator", function () { return avMenuCall("avRailToggle"); }],
        ["About this build", function () { return avMenuCall("avAboutToggle"); }],
      ]
    ) },
    { id: "workspace", label: "Workspace", items: [
      ["Reset layout", function () { return avMenuCall("avPanelsReset"); }],
      ["Sound design desk", function () { return avMenuCall("avPanelsLayout", "sounddesign"); }],
      ["Mixdown desk", function () { return avMenuCall("avPanelsLayout", "mixdown"); }],
      ["Save layout...", function () { return avMenuCall("avPanelsSaveNamed", avMenuCall("avPanelsPromptName", "layout")); }],
      ["Load layout...", function () { return avMenuCall("avPanelsLoadNamed", avMenuCall("avPanelsPromptName", "layout")); }],
    ] },
    { id: "help", label: "Help", items: [
      ["Open help (?)", function () { return avMenuCall("avHelpOpen"); }],
      ["Start the 60-second tour", function () { return avMenuCall("avPaletteStartTour"); }],
      ["About this build", function () { return avMenuCall("avAboutToggle"); }],
    ] },
  ];
}

function avMenubarEl() { return document.getElementById("av-menubar"); }
function avMenuPop() {
  try {
    if (avMenuState.pop && document.body.contains(avMenuState.pop)) return avMenuState.pop;
    let el = document.getElementById("av-menu-pop");
    if (!el) {
      el = document.createElement("div");
      el.id = "av-menu-pop";
      el.className = "av-menu-pop";
      el.setAttribute("role", "menu");
      document.body.appendChild(el);
    }
    avMenuState.pop = el;
    return el;
  } catch (e) { return null; }
}
function avMenuClose() {
  try {
    const p = avMenuState.pop;
    if (p) { p.classList.remove("open"); p.innerHTML = ""; }
    const b = avMenuState.openFor;
    if (b) { try { b.setAttribute("aria-expanded", "false"); } catch (e) { /* gone */ } }
    avMenuState.openFor = null;
    return true;
  } catch (e) { return false; }
}
function avMenuOpenFor(btn) {
  try {
    const pop = avMenuPop();
    if (!pop || !btn) return false;
    const id = btn.getAttribute("data-menu");
    const defs = avMenuDefs();
    let def = null;
    for (let i = 0; i < defs.length; i++) if (defs[i].id === id) def = defs[i];
    if (!def) return false;
    pop.innerHTML = "";
    for (let i = 0; i < def.items.length; i++) {
      const it = def.items[i];
      if (it[0] === "sep") {
        const s = document.createElement("div");
        s.className = "av-menu-sep";
        pop.appendChild(s);
        continue;
      }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "av-menu-mi";
      b.setAttribute("role", "menuitem");
      b.textContent = it[0];
      (function (fn) {
        b.addEventListener("click", function () { avMenuClose(); try { fn(); } catch (e) { /* guarded */ } });
      })(it[1]);
      pop.appendChild(b);
    }
    pop.classList.add("open");
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(4, Math.round(r.left)) + "px";
    pop.style.top = Math.round(r.bottom) + "px";
    btn.setAttribute("aria-expanded", "true");
    avMenuState.openFor = btn;
    return true;
  } catch (e) { return false; }
}

function avMenubarBuild() {
  try {
    if (avMenubarEl()) return true;
    const head = document.querySelector("header.av-head");
    if (!head || !head.parentNode) return false;
    const bar = document.createElement("nav");
    bar.id = "av-menubar";
    bar.className = "av-menubar";
    bar.setAttribute("role", "menubar");
    bar.setAttribute("aria-label", "Menu bar");
    const defs = avMenuDefs();
    for (let i = 0; i < defs.length; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "av-menu-item";
      b.setAttribute("role", "menuitem");
      b.setAttribute("data-menu", defs[i].id);
      b.setAttribute("aria-haspopup", "true");
      b.setAttribute("aria-expanded", "false");
      b.textContent = defs[i].label;
      b.addEventListener("click", function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        if (avMenuState.openFor === b) { avMenuClose(); return; }
        avMenuClose();
        avMenuOpenFor(b);
      });
      bar.appendChild(b);
    }
    const stat = document.createElement("span");
    stat.className = "av-menu-status";
    stat.id = "av-menu-status";
    stat.textContent = "ANVIL" + (window.ANVIL ? " \u00B7 v" + window.ANVIL.version : "");
    bar.appendChild(stat);
    head.parentNode.insertBefore(bar, head);
    document.addEventListener("pointerdown", function (e) {
      if (!avMenuState.openFor) return;
      const pop = avMenuState.pop;
      if (pop && pop.contains(e.target)) return;
      if (avMenuState.openFor.contains(e.target)) return;
      avMenuClose();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (avMenuState.openFor && e && e.key === "Escape") avMenuClose();
    }, true);
    return true;
  } catch (e) { return false; }
}

function avMenubarInit() {
  try {
    if (avMenuState.ready) return true;
    avMenuPop();
    const ok = avMenubarBuild();
    avMenuState.ready = ok === true;
    return avMenuState.ready;
  } catch (e) {
    console.warn("[anvil] menubar init failed", e);
    return false;
  }
}
function avMenubarProof() {
  let items = 0;
  try { items = document.querySelectorAll(".av-menu-item").length; } catch (e) { /* none */ }
  return "MENUBAR SELFTEST " + JSON.stringify({ v: AV_MENUBAR_VERSION, items: items, ready: avMenuState.ready === true });
}

if (typeof window !== "undefined" && window) {
  try {
    window.__avMenubar = {
      version: AV_MENUBAR_VERSION,
      open: function (id) {
        const b = document.querySelector('.av-menu-item[data-menu="' + String(id) + '"]');
        return b ? avMenuOpenFor(b) : false;
      },
      close: function () { return avMenuClose(); },
      defs: function () { return avMenuDefs().map(function (d) { return d.id; }); },
    };
  } catch (e) { /* no window - nothing to publish */ }
}
