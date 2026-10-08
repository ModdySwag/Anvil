/* Anvil — the left module rail (R4; R7 standard-menu pass): a pinnable, resizable, hideable
   navigator down the left edge. Groups = the 8 zones (accent-dotted, the active one highlighted);
   each group lists its cards as jump links (switch the zone + scroll the card into view) and
   collapses/expands from its chevron — independent per-section state, persisted
   (av-rail-sections). The Panels quick-view is collapsible the same way. Toggle lives in the
   header (NAV) and on the rail itself; width + open state persist (av-rail-w / av-rail-open). */
"use strict";

const AV_RAIL_VERSION = "r7.0";
const AV_RAIL_W_KEY = "av-rail-w";
const AV_RAIL_OPEN_KEY = "av-rail-open";
const AV_RAIL_SEC_KEY = "av-rail-sections";

const AV_RAIL_GROUPS = [
  { zone: "synth", label: "Synth", cards: [["av-levels", "Levels"], ["av-synth", "Synth engine"], ["av-fm", "FM"], ["av-drums", "Drums"], ["av-sample", "Samples"], ["av-chop", "Chop"], ["av-wt", "Wavetable editor"]] },
  { zone: "fx", label: "FX", cards: [["av-fx", "FX rack"]] },
  { zone: "mod", label: "Mod", cards: [["av-mod", "Mod matrix"]] },
  { zone: "seq", label: "Seq", cards: [["av-seq", "Sequencer"]] },
  { zone: "studio", label: "Studio", cards: [["av-rec", "Recorder"], ["av-studio", "Studio"], ["av-sessions", "Sessions"], ["av-comp", "Takes & comping"], ["av-mix", "Mix & master"], ["av-deck", "Deck"], ["av-deliver", "Deliver"]] },
  { zone: "store", label: "Store", cards: [["av-store", "Packs"]] },
  { zone: "code", label: "Code", cards: [["av-code", "CODE"]] },
  { zone: "system", label: "System", cards: [["av-midi-card", "MIDI"], ["av-files", "Project & share"], ["av-family", "Family bridges"], ["av-roadmap", "Roadmap"]] },
];

const avRailState = { ready: false, el: null, grip: null, drag: null };

function avRailEl() { return document.getElementById("av-rail"); }

function avRailPersist() {
  try {
    const el = avRailEl();
    if (el) { localStorage.setItem(AV_RAIL_W_KEY, String(Math.round(el.getBoundingClientRect().width))); }
    localStorage.setItem(AV_RAIL_OPEN_KEY, document.body.classList.contains("av-rail-closed") ? "0" : "1");
  } catch (e) { /* session only */ }
}
function avRailShow(on) {
  try {
    document.body.classList.toggle("av-rail-closed", on === false);
    avRailPersist();
    return on !== false;
  } catch (e) { return false; }
}
function avRailToggle() {
  return avRailShow(document.body.classList.contains("av-rail-closed"));
}
function avRailSetWidth(w) {
  try {
    const el = avRailEl();
    if (!el) return false;
    const nw = Math.max(150, Math.min(340, Math.round(w)));
    el.style.width = nw + "px";
    avRailPersist();
    return nw;
  } catch (e) { return false; }
}

/* R7 - standard-menu rail: per-section collapse/expand, independent per section, persisted
   (av-rail-sections: one 0|1 per zone + "panels"). First run seeds the active zone expanded +
   Panels expanded; every later change comes only from a chevron / the Panels head. */
const avRailSecState = { map: null };

function avRailSecInit() {
  try {
    let stored = null;
    try {
      const raw = localStorage.getItem(AV_RAIL_SEC_KEY);
      if (raw) { const o = JSON.parse(raw); if (o && typeof o === "object") stored = o; }
    } catch (e) { stored = null; }
    const map = {};
    if (stored) {
      for (let i = 0; i < AV_RAIL_GROUPS.length; i++) {
        const k = AV_RAIL_GROUPS[i].zone;
        map[k] = (stored[k] === 1) ? 1 : 0;
      }
      map.panels = (stored.panels === 0) ? 0 : 1;
    } else {
      const cur = (window.__avZone && typeof window.__avZone.current === "function") ? window.__avZone.current() : "synth";
      for (let i = 0; i < AV_RAIL_GROUPS.length; i++) {
        const k = AV_RAIL_GROUPS[i].zone;
        map[k] = (k === cur) ? 1 : 0;
      }
      map.panels = 1;
    }
    avRailSecState.map = map;
    try { localStorage.setItem(AV_RAIL_SEC_KEY, JSON.stringify(map)); } catch (e2) { /* session only */ }
    return avRailSecApply();
  } catch (e) { return false; }
}
function avRailSecApply() {
  try {
    const map = avRailSecState.map || {};
    const groups = document.querySelectorAll("#av-rail .av-rail-group");
    for (let i = 0; i < groups.length; i++) {
      const z = groups[i].getAttribute("data-zone");
      const on = map[z] === 1;
      groups[i].classList.toggle("expanded", on);
      const chev = groups[i].querySelector(".av-rail-chev");
      if (chev) chev.setAttribute("aria-expanded", on ? "true" : "false");
    }
    const sec = document.getElementById("av-rail-panels");
    if (sec) {
      const pon = (avRailSecState.map && avRailSecState.map.panels === 0) ? false : true;
      sec.classList.toggle("collapsed", !pon);
      const head = sec.querySelector(".av-rail-sec-head");
      if (head) head.setAttribute("aria-expanded", pon ? "true" : "false");
    }
    return true;
  } catch (e) { return false; }
}
function avRailSecSet(key, on) {
  try {
    if (!avRailSecState.map) avRailSecState.map = {};
    avRailSecState.map[key] = on ? 1 : 0;
    try { localStorage.setItem(AV_RAIL_SEC_KEY, JSON.stringify(avRailSecState.map)); } catch (e2) { /* session only */ }
    avRailSecApply();
    return avRailSecState.map[key] === 1;
  } catch (e) { return false; }
}
function avRailSecToggle(key) {
  const cur = !!(avRailSecState.map && avRailSecState.map[key] === 1);
  return avRailSecSet(key, !cur);
}

function avRailBuild() {
  try {
    const el = avRailEl();
    if (!el || avRailState.ready) return false;
    const head = document.createElement("div");
    head.className = "av-rail-head";
    const title = document.createElement("span");
    title.className = "av-rail-title";
    title.textContent = "Modules";
    const hide = document.createElement("button");
    hide.type = "button";
    hide.className = "av-btn mini";
    hide.id = "av-rail-hide";
    hide.setAttribute("aria-label", "Hide the module navigator");
    hide.title = "Hide the module navigator";
    hide.textContent = "\u00AB";
    hide.addEventListener("click", function () { avRailShow(false); });
    head.appendChild(title);
    head.appendChild(hide);
    el.appendChild(head);
    avRailBuildPanels();
    for (let g = 0; g < AV_RAIL_GROUPS.length; g++) {
      const grp = AV_RAIL_GROUPS[g];
      const wrap = document.createElement("div");
      wrap.className = "av-rail-group";
      wrap.setAttribute("data-zone", grp.zone);
      const zrow = document.createElement("div");
      zrow.className = "av-rail-zrow";
      const chev = document.createElement("button");
      chev.type = "button";
      chev.className = "av-rail-chev";
      chev.setAttribute("data-zone", grp.zone);
      chev.setAttribute("aria-expanded", "false");
      chev.setAttribute("aria-controls", "av-rail-cards-" + grp.zone);
      chev.setAttribute("aria-label", "Collapse or expand the " + grp.label + " section");
      chev.title = "Collapse / expand";
      const chevGlyph = document.createElement("span");
      chevGlyph.className = "av-rail-chev-glyph";
      chevGlyph.textContent = "\u25B8";
      chev.appendChild(chevGlyph);
      (function (zone) {
        chev.addEventListener("click", function (e) {
          e.stopPropagation();
          avRailSecToggle(zone);
        });
      })(grp.zone);
      const zb = document.createElement("button");
      zb.type = "button";
      zb.className = "av-rail-zone";
      zb.setAttribute("data-zone", grp.zone);
      const dot = document.createElement("span");
      dot.className = "av-rail-dot";
      const lbl = document.createElement("span");
      lbl.textContent = grp.label;
      zb.appendChild(dot);
      zb.appendChild(lbl);
      zb.addEventListener("click", function () {
        if (typeof avZoneShow === "function") avZoneShow(grp.zone, { source: "rail" });
      });
      const list = document.createElement("div");
      list.className = "av-rail-cards";
      list.id = "av-rail-cards-" + grp.zone;
      for (let c = 0; c < grp.cards.length; c++) {
        const cid = grp.cards[c][0], clabel = grp.cards[c][1];
        const cb = document.createElement("button");
        cb.type = "button";
        cb.className = "av-rail-card";
        cb.setAttribute("data-card", cid);
        cb.textContent = clabel;
        (function (id, zone) {
          cb.addEventListener("click", function () {
            try {
              if (typeof avZoneShow === "function") avZoneShow(zone, { source: "rail-card" });
              const card = document.getElementById(id);
              if (card && card.scrollIntoView) card.scrollIntoView({ block: "start" });
            } catch (e) { /* jump best-effort */ }
          });
        })(cid, grp.zone);
        list.appendChild(cb);
      }
      zrow.appendChild(chev);
      zrow.appendChild(zb);
      wrap.appendChild(zrow);
      wrap.appendChild(list);
      el.appendChild(wrap);
    }
    const grip = document.createElement("div");
    grip.className = "av-rail-grip";
    grip.setAttribute("role", "separator");
    grip.setAttribute("aria-label", "Resize the module navigator");
    el.appendChild(grip);
    avRailState.grip = grip;
    avRailWireDrag(grip);
    window.addEventListener("av-zone-shown", function (e) {
      try {
        const zone = e && e.detail && e.detail.zone;
        const groups = document.querySelectorAll(".av-rail-group");
        for (let i = 0; i < groups.length; i++) groups[i].classList.toggle("on", groups[i].getAttribute("data-zone") === zone);
      } catch (e2) { /* highlight is cosmetic */ }
    });
    avRailWirePanelEvents();
    avRailPanelsRefresh();
    avRailState.ready = true;
    return true;
  } catch (e) { return false; }
}

function avRailCardNames() {
  const m = {};
  for (let g = 0; g < AV_RAIL_GROUPS.length; g++) {
    const cards = AV_RAIL_GROUPS[g].cards;
    for (let c = 0; c < cards.length; c++) m[cards[c][0]] = cards[c][1];
  }
  return m;
}
function avRailBuildPanels() {
  try {
    const el = avRailEl();
    if (!el || document.getElementById("av-rail-panels")) return true;
    const sec = document.createElement("div");
    sec.className = "av-rail-sec";
    sec.id = "av-rail-panels";
    const head = document.createElement("button");
    head.type = "button";
    head.className = "av-rail-sec-head";
    head.setAttribute("aria-expanded", "true");
    head.setAttribute("aria-controls", "av-rail-panels-body");
    head.setAttribute("aria-label", "Collapse or expand the Panels quick-view");
    const hchev = document.createElement("span");
    hchev.className = "av-rail-chev-glyph";
    hchev.textContent = "\u25B8";
    const hlabel = document.createElement("span");
    hlabel.textContent = "Panels";
    head.appendChild(hchev);
    head.appendChild(hlabel);
    head.addEventListener("click", function () { avRailSecToggle("panels"); });
    sec.appendChild(head);
    const body = document.createElement("div");
    body.className = "av-rail-sec-body";
    body.id = "av-rail-panels-body";
    sec.appendChild(body);
    const mk = function (label, id) {
      const l = document.createElement("div");
      l.className = "av-rail-sublabel";
      l.textContent = label;
      body.appendChild(l);
      const box = document.createElement("div");
      box.id = id;
      body.appendChild(box);
    };
    mk("Open", "av-rail-open");
    mk("Minimized", "av-rail-min");
    mk("Available", "av-rail-avail");
    const firstGroup = el.querySelector(".av-rail-group");
    el.insertBefore(sec, firstGroup || null);
    return true;
  } catch (e) { return false; }
}
function avRailProw(name, cardId, actions, draggable) {
  const row = document.createElement("div");
  row.className = "av-rail-prow";
  row.setAttribute("data-card", cardId);
  if (draggable) {
    row.setAttribute("draggable", "true");
    row.addEventListener("dragstart", function (e) {
      try {
        e.dataTransfer.setData("text/av-card", cardId);
        e.dataTransfer.effectAllowed = "copy";
        document.body.classList.add("av-drag-card");
      } catch (e2) { /* drag best-effort */ }
    });
    row.addEventListener("dragend", function () { document.body.classList.remove("av-drag-card"); });
  }
  const nm = document.createElement("span");
  nm.className = "av-rail-prow-name";
  nm.textContent = name;
  row.appendChild(nm);
  for (let a = 0; a < actions.length; a++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "av-btn mini";
    b.setAttribute("aria-label", actions[a][1] + ": " + name);
    b.title = actions[a][1];
    b.textContent = actions[a][2];
    b.addEventListener("click", actions[a][0]);
    row.appendChild(b);
  }
  return row;
}
function avRailPanelsRefresh() {
  try {
    const openBox = document.getElementById("av-rail-open");
    const minBox = document.getElementById("av-rail-min");
    const availBox = document.getElementById("av-rail-avail");
    if (!openBox || !minBox || !availBox) return false;
    const names = avRailCardNames();
    const floated = (typeof avPanelsList === "function") ? avPanelsList() : [];
    const mins = [];
    for (let i = 0; i < floated.length; i++) {
      const p = document.getElementById("av-float-" + floated[i]);
      if (p && p.classList.contains("av-float-min")) mins.push(floated[i]);
    }
    const opens = floated.filter(function (id) { return mins.indexOf(id) < 0; });
    const fill = function (box, ids, mode) {
      box.innerHTML = "";
      if (!ids.length) {
        const em = document.createElement("div");
        em.className = "av-rail-prow-empty";
        em.textContent = mode === "open" ? "nothing floating" : (mode === "min" ? "nothing minimized" : "all floated");
        box.appendChild(em);
        return;
      }
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const acts = (mode === "open")
          ? [[function () { avPanelMinimize(id, true); }, "Minimize", "\u2013"], [function () { avPanelClose(id); }, "Dock back to zone", "\u00D7"]]
          : (mode === "min")
          ? [[function () { avPanelMinimize(id, false); }, "Restore", "\u25A1"], [function () { avPanelClose(id); }, "Dock back to zone", "\u00D7"]]
          : [[function () { avPanelOpen(id); }, "Float into the workspace", "\u29C9"]];
        box.appendChild(avRailProw(names[id] || id, id, acts, mode === "avail"));
      }
    };
    fill(openBox, opens, "open");
    fill(minBox, mins, "min");
    fill(availBox, Object.keys(names).filter(function (id) { return floated.indexOf(id) < 0; }), "avail");
    return true;
  } catch (e) { return false; }
}
function avRailWirePanelEvents() {
  try {
    window.addEventListener("av-panels-changed", function () { avRailPanelsRefresh(); });
    document.addEventListener("dragover", function (e) {
      try {
        if (e.dataTransfer && e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, "text/av-card") >= 0) e.preventDefault();
      } catch (e2) { /* dragover best-effort */ }
    });
    document.addEventListener("drop", function (e) {
      try {
        const id = e.dataTransfer ? e.dataTransfer.getData("text/av-card") : "";
        document.body.classList.remove("av-drag-card");
        if (!id) return;
        e.preventDefault();
        const rail = avRailEl();
        const rw = rail ? rail.getBoundingClientRect().width : 0;
        if (e.clientX < rw + 20) { avPanelOpen(id); avPanelMinimize(id, true); return; }
        avPanelOpen(id);
        avPanelsMove(id, e.clientX - 60, Math.max(60, e.clientY - 20));
      } catch (e2) { /* drop best-effort */ }
    });
    return true;
  } catch (e) { return false; }
}
function avRailWireDrag(grip) {
  try {
    grip.addEventListener("pointerdown", function (e) {
      try {
        const el = avRailEl();
        avRailState.drag = { x0: e.clientX, w0: el.getBoundingClientRect().width };
        document.body.classList.add("av-rail-dragging");
        if (e.target.setPointerCapture) { try { e.target.setPointerCapture(e.pointerId); } catch (e2) { /* best-effort */ } }
        e.preventDefault();
      } catch (e3) { /* drag best-effort */ }
    });
    window.addEventListener("pointermove", function (e) {
      const d = avRailState.drag;
      if (!d) return;
      avRailSetWidth(d.w0 + (e.clientX - d.x0));
    });
    window.addEventListener("pointerup", function () {
      if (!avRailState.drag) return;
      avRailState.drag = null;
      document.body.classList.remove("av-rail-dragging");
    });
    return true;
  } catch (e) { return false; }
}

function avRailInit() {
  try {
    if (avRailState.ready) return true;
    if (!avRailEl()) return false;
    avRailBuild();
    avRailSecInit();
    try {
      const w = parseFloat(localStorage.getItem(AV_RAIL_W_KEY));
      if (isFinite(w) && w > 0) avRailSetWidth(w);
      if (localStorage.getItem(AV_RAIL_OPEN_KEY) === "0") avRailShow(false);
    } catch (e) { /* defaults stand */ }
    if (typeof avZoneShow === "function") { try { avZoneShow(window.__avZone ? window.__avZone.current() : "synth", { silent: true, source: "rail-init" }); } catch (e2) { /* sync best-effort */ } }
    const cur = window.__avZone ? window.__avZone.current() : "synth";
    const groups = document.querySelectorAll(".av-rail-group");
    for (let i = 0; i < groups.length; i++) groups[i].classList.toggle("on", groups[i].getAttribute("data-zone") === cur);
    return true;
  } catch (e) {
    console.warn("[anvil] rail init failed", e);
    return false;
  }
}

function avRailProof() {
  let cards = 0, secs = 0, panO = false;
  try { cards = document.querySelectorAll(".av-rail-card").length; } catch (e) { /* none */ }
  try { secs = document.querySelectorAll("#av-rail .av-rail-group.expanded").length; } catch (e) { /* none */ }
  try { const sec = document.getElementById("av-rail-panels"); panO = !!(sec && !sec.classList.contains("collapsed")); } catch (e) { /* none */ }
  return "RAIL SELFTEST " + JSON.stringify({
    v: AV_RAIL_VERSION,
    ready: avRailState.ready === true,
    groups: AV_RAIL_GROUPS.length,
    cards: cards,
    open: !document.body.classList.contains("av-rail-closed"),
    sections: secs,
    panels: panO,
  });
}

if (typeof window !== "undefined" && window) {
  try {
    window.__avRail = {
      version: AV_RAIL_VERSION,
      init: function () { return avRailInit(); },
      toggle: function () { return avRailToggle(); },
      show: function (on) { return avRailShow(on !== false); },
      width: function (w) { return (typeof w === "number") ? avRailSetWidth(w) : null; },
      groups: function () { return AV_RAIL_GROUPS.map(function (g) { return g.zone; }); },
      panels: function () { return avRailPanelsRefresh(); },
      sections: function () {
        const m = avRailSecState.map || {};
        const o = {};
        const ks = Object.keys(m);
        for (let i = 0; i < ks.length; i++) o[ks[i]] = m[ks[i]];
        return o;
      },
      sectionSet: function (key, on) { return avRailSecSet(key, on !== false); },
      sectionToggle: function (key) { return avRailSecToggle(key); },
    };
  } catch (e) { /* no window - nothing to publish */ }
}
