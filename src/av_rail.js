/* Anvil — the left module rail (R4): a pinnable, resizable, hideable navigator down the left edge.
   Groups = the 8 zones (accent-dotted, the active one highlighted); each group lists its cards as
   jump links (switch the zone + scroll the card into view). Toggle lives in the header (NAV) and
   on the rail itself; width + open state persist (av-rail-w / av-rail-open). */
"use strict";

const AV_RAIL_VERSION = "r4.0";
const AV_RAIL_W_KEY = "av-rail-w";
const AV_RAIL_OPEN_KEY = "av-rail-open";

const AV_RAIL_GROUPS = [
  { zone: "synth", label: "Synth", cards: [["av-levels", "Levels"], ["av-synth", "Synth engine"], ["av-fm", "FM"], ["av-drums", "Drums"], ["av-sample", "Samples"], ["av-chop", "Chop"], ["av-wt", "Wavetable editor"]] },
  { zone: "fx", label: "FX", cards: [["av-fx", "FX rack"]] },
  { zone: "mod", label: "Mod", cards: [["av-mod", "Mod matrix"]] },
  { zone: "seq", label: "Seq", cards: [["av-seq", "Sequencer"]] },
  { zone: "studio", label: "Studio", cards: [["av-rec", "Recorder"], ["av-studio", "Studio"], ["av-sessions", "Sessions"], ["av-comp", "Takes & comping"], ["av-mix", "Mix & master"], ["av-deck", "Deck"], ["av-deliver", "Deliver"]] },
  { zone: "store", label: "Store", cards: [["av-store", "Packs"]] },
  { zone: "code", label: "Code", cards: [["av-code", "CODE"]] },
  { zone: "system", label: "System", cards: [["av-midi-card", "MIDI"], ["av-files", "Project & share"], ["av-family", "Family bridges"]] },
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
    for (let g = 0; g < AV_RAIL_GROUPS.length; g++) {
      const grp = AV_RAIL_GROUPS[g];
      const wrap = document.createElement("div");
      wrap.className = "av-rail-group";
      wrap.setAttribute("data-zone", grp.zone);
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
        wrap.classList.add("open");
      });
      const list = document.createElement("div");
      list.className = "av-rail-cards";
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
      wrap.appendChild(zb);
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
    avRailState.ready = true;
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
  let cards = 0;
  try { cards = document.querySelectorAll(".av-rail-card").length; } catch (e) { /* none */ }
  return "RAIL SELFTEST " + JSON.stringify({
    v: AV_RAIL_VERSION,
    ready: avRailState.ready === true,
    groups: AV_RAIL_GROUPS.length,
    cards: cards,
    open: !document.body.classList.contains("av-rail-closed"),
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
    };
  } catch (e) { /* no window - nothing to publish */ }
}
