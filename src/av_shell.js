/* Anvil — the cockpit shell (R1): the fixed-window chassis.
   Zones are the app's workflow stations, Serum-2 style: one visible at a time, tabs at the top,
   internal pane scroll only — the page itself can never scroll. The header and the piano dock
   stay put; the dock-tax lifts the BODY, not the content.
   Deep link: ?z=<zone> · persistence: localStorage "av-zone" · shortcuts: Alt+1..8 ·
   palette group "Zones". Harness seams: window.__avZoneAuto(sel) and a scrollIntoView wrapper
   reveal the hidden zone that holds a target before scrolling to it (used by the suites). */
"use strict";

const AV_SHELL_VERSION = "r1.0";
const AV_ZONE_DEFAULT = "synth";
const AV_ZONE_LS_KEY = "av-zone";

/* tab order = workflow order (pins: verify/_r1_wave.md §Zone map) */
const AV_ZONES = [
  { id: "synth",  label: "Synth",  hint: "Engines - levels, synth, FM, drums, samples, chop, wavetable editor" },
  { id: "fx",     label: "FX",     hint: "The FX rack - drive / flavour / mod / delay / verb / conv / dyn" },
  { id: "mod",    label: "Mod",    hint: "The mod matrix - macros and routing slots" },
  { id: "seq",    label: "Seq",    hint: "The groovebox - patterns, p-locks, chains, scenes, song" },
  { id: "studio", label: "Studio", hint: "Record, sessions, comping, mix & master, deck, deliver" },
  { id: "store",  label: "Store",  hint: "Factory packs and banks - install once, play offline" },
  { id: "code",   label: "Code",   hint: "Write your own DSP modules - they run live in the engine" },
  { id: "system", label: "System", hint: "MIDI, project & share, family bridges, about" },
];

const avShellState = { ready: false, zone: null, why: "boot" };

function avZoneTabEl(id) { return document.getElementById("av-tab-" + id); }
function avZonePanelEl(id) { return document.getElementById("av-zone-" + id); }
function avZoneList() { return AV_ZONES.map(z => z.id); }
function avZoneInfo(id) { for (let i = 0; i < AV_ZONES.length; i++) if (AV_ZONES[i].id === id) return AV_ZONES[i]; return null; }
function avZoneCurrent() { return avShellState.zone; }

/* ---------- show a zone (the ONE state transition) ---------- */
function avZoneShow(id, opts) {
  try {
    if (!avZoneInfo(id)) return false;
    const o = opts || {};
    const first = avShellState.zone === null;
    const changed = avShellState.zone !== id;
    for (let i = 0; i < AV_ZONES.length; i++) {
      const zid = AV_ZONES[i].id;
      const panel = avZonePanelEl(zid);
      const tab = avZoneTabEl(zid);
      const on = zid === id;
      if (panel && !!panel.hidden === on) panel.hidden = !on;   /* toggle only when needed */
      if (tab) {
        tab.setAttribute("aria-selected", on ? "true" : "false");
        tab.tabIndex = on ? 0 : -1;
      }
    }
    avShellState.zone = id;
    avShellState.why = o.source || "api";
    try { document.body.setAttribute("data-av-zone", id); } catch (e2) { /* body attr is cosmetic */ }
    try { localStorage.setItem(AV_ZONE_LS_KEY, id); } catch (e3) { /* private mode - session only */ }
    if (changed && !first && !o.silent && typeof avA11yAnnounce === "function") {
      const inf = avZoneInfo(id);
      try { avA11yAnnounce("Zone: " + (inf ? inf.label : id)); } catch (e4) { /* announce is best-effort */ }
    }
    return true;
  } catch (e) { return false; }
}

/* ---------- reveal the zone that holds an element (harness + palette seam) ---------- */
function avZoneReveal(el) {
  try {
    if (!el || !el.closest) return false;
    const zone = el.closest(".av-zone");
    if (zone && zone.hidden) {
      const zid = zone.getAttribute("data-zone");
      if (zid) return avZoneShow(zid, { source: "reveal", silent: true });
    }
    return !!(zone && !zone.hidden);
  } catch (e) { return false; }
}
function avZoneAuto(selOrEl) {
  try {
    const el = (typeof selOrEl === "string") ? document.querySelector(selOrEl) : selOrEl;
    if (!el) return false;
    return avZoneReveal(el);
  } catch (e) { return false; }
}
window.__avZoneAuto = function (sel) { return avZoneAuto(sel); };

/* ---------- the scrollIntoView seam ----------
   A suite (or any flow) scrolling to an element inside a hidden zone must first reveal that zone.
   Wrapping the prototype keeps every call shape working without touching the callers; every guard
   is try/catch so scrolling can never break. */
function avShellInstallScrollSeam() {
  try {
    if (typeof Element === "undefined" || !Element.prototype) return false;
    if (Element.prototype.__avZoneSeam === true) return true;
    const orig = Element.prototype.scrollIntoView;
    if (typeof orig !== "function") return false;
    function seam(opts) {
      try {
        const el = this;
        if (el && el.closest) {
          const zone = el.closest(".av-zone");
          if (zone && zone.hidden) {
            const zid = zone.getAttribute("data-zone");
            if (zid) avZoneShow(zid, { source: "seam", silent: true });
          }
        }
      } catch (e) { /* never break a scroll */ }
      return orig.call(this, opts);
    }
    seam.__avZoneSeam = true;
    seam.__avZoneOrig = orig;
    Element.prototype.scrollIntoView = seam;
    return true;
  } catch (e) { return false; }
}

/* ---------- tab interactions ---------- */
function avShellWireTabs() {
  const nav = document.getElementById("av-zones");
  if (!nav) return false;
  let wired = 0;
  for (let i = 0; i < AV_ZONES.length; i++) {
    const tab = avZoneTabEl(AV_ZONES[i].id);
    if (!tab) continue;
    (function (zid) {
      tab.addEventListener("click", function () { avZoneShow(zid, { source: "tab" }); });
    })(AV_ZONES[i].id);
    wired++;
  }
  /* ArrowLeft / ArrowRight move within the tablist (roving tabindex law) */
  nav.addEventListener("keydown", function (e) {
    if (!e || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    const cur = avShellState.zone;
    const idx = avZoneList().indexOf(cur);
    if (idx < 0) return;
    const n = AV_ZONES.length;
    const next = avZoneList()[(idx + (e.key === "ArrowRight" ? 1 : n - 1)) % n];
    avZoneShow(next, { source: "tab-key" });
    const t = avZoneTabEl(next);
    if (t && typeof t.focus === "function") { try { t.focus(); } catch (e2) { /* focus is best-effort */ } }
    e.preventDefault();
  }, true);
  return wired === AV_ZONES.length;
}

/* Alt+1..8 switches zones (workflow muscle memory; registered on capture so it wins early) */
function avShellWireKeys() {
  try {
    document.addEventListener("keydown", function (e) {
      try {
        if (!e || !e.altKey || e.ctrlKey || e.metaKey) return;
        if (!/^[1-8]$/.test(e.key || "")) return;
        const idx = Number(e.key) - 1;
        if (idx < 0 || idx >= AV_ZONES.length) return;
        avZoneShow(AV_ZONES[idx].id, { source: "key" });
        e.preventDefault();
      } catch (e2) { /* a shortcut can never break typing */ }
    }, true);
    return true;
  } catch (e) { return false; }
}

/* ---------- the proof host (avTestLine writes here, never into .av-main) ---------- */
function avShellEnsureProofHost() {
  try {
    if (!document.getElementById("av-proofs")) {
      const d = document.createElement("div");
      d.id = "av-proofs";
      d.setAttribute("aria-hidden", "true");
      d.style.display = "none";
      document.body.appendChild(d);
    }
    return true;
  } catch (e) { return false; }
}

/* ---------- boot ---------- */
function avShellInit() {
  try {
    if (avShellState.ready) return true;
    /* every zone panel must exist (the static restructure ships them) */
    let have = 0;
    for (let i = 0; i < AV_ZONES.length; i++) {
      if (avZonePanelEl(AV_ZONES[i].id)) have++;
    }
    if (have !== AV_ZONES.length) {
      console.warn("[anvil] shell: zones missing (" + have + "/" + AV_ZONES.length + ") - staying a plain page");
      return false;
    }
    avShellWireTabs();
    avShellWireKeys();
    avShellInstallScrollSeam();
    avShellEnsureProofHost();
    /* default zone: ?z= > localStorage > synth */
    let def = AV_ZONE_DEFAULT;
    try {
      const q = (typeof URLSearchParams === "function") ? new URLSearchParams(location.search).get("z") : null;
      if (q && avZoneInfo(q)) def = q;
      else {
        const ls = localStorage.getItem(AV_ZONE_LS_KEY);
        if (ls && avZoneInfo(ls)) def = ls;
      }
    } catch (e2) { /* boot default stands */ }
    avShellState.zone = null;
    if (!avZoneShow(def, { source: "boot", silent: true })) return false;
    avShellState.ready = true;
    return true;
  } catch (e) {
    console.warn("[anvil] shell init failed", e);
    return false;
  }
}

function avShellProof() {
  return "SHELL SELFTEST " + JSON.stringify({
    v: AV_SHELL_VERSION,
    ready: avShellState.ready === true,
    zones: AV_ZONES.length,
    active: avZoneCurrent(),
  });
}

/* the public facade (suites + palette + anything else) */
window.__avZone = {
  show: function (id, opts) { return avZoneShow(id, opts); },
  current: function () { return avZoneCurrent(); },
  list: function () { return avZoneList(); },
  auto: function (sel) { return avZoneAuto(sel); },
  version: AV_SHELL_VERSION,
};
