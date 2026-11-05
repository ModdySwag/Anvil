/* Anvil — the cockpit shell (R1 · C1 chassis): the fixed-window chassis.
   Pages are the app's workflow stations in SIGNAL ORDER — what you pick, what the performance
   does, the voice, what moves it, what plays it, what processes it, where it sums, what leaves,
   and the plumbing. One visible at a time, tabs at the top, internal pane scroll only — the page
   itself can never scroll. Pages with more than one card carry SUB-TABS; only one sub renders.
   The header, the inspector column and the piano dock stay put.
   Deep link: ?z=<page>&s=<sub> · persistence: localStorage "av-zone" / "av-sub" ·
   shortcuts: Alt+1..9 · palette group "Zones". Harness seams: window.__avZoneAuto(sel) and a
   scrollIntoView wrapper reveal the hidden page that holds a target before scrolling to it. */
"use strict";

const AV_SHELL_VERSION = "c1.0";
const AV_ZONE_DEFAULT = "sound";
const AV_ZONE_LS_KEY = "av-zone";
const AV_SUB_LS_KEY = "av-sub";

/* tab order = signal order (plan of record: docs/13-chassis-fsvr.md §3) */
const AV_ZONES = [
  { id: "browse",   label: "BROWSE",   hint: "What you pick - packs, presets, imports, saved sessions" },
  { id: "perform",  label: "PERFORM",  hint: "The performance - macro pots, poly and glide" },
  { id: "sound",    label: "SOUND",    hint: "The voice - engine, FM, drums, samples, chop, wavetable, tuning" },
  { id: "shape",    label: "SHAPE",    hint: "What moves it - the mod matrix and the LFO" },
  { id: "sequence", label: "SEQUENCE", hint: "What plays it - patterns, p-locks, chains, scenes, song" },
  { id: "effects",  label: "EFFECTS",  hint: "What processes it - the FX rack" },
  { id: "mix",      label: "MIX",      hint: "Where it sums - mix & master, comping, recorder, studio" },
  { id: "deliver",  label: "DELIVER",  hint: "What leaves - the deck display and the deliver render" },
  { id: "system",   label: "SYSTEM",   hint: "The plumbing - MIDI, project, CODE, family, roadmap" },
];

const avShellState = { ready: false, zone: null, why: "boot" };

function avZoneTabEl(id) { return document.getElementById("av-tab-" + id); }
function avZonePanelEl(id) { return document.getElementById("av-zone-" + id); }
function avZoneList() { return AV_ZONES.map(z => z.id); }
function avZoneInfo(id) { for (let i = 0; i < AV_ZONES.length; i++) if (AV_ZONES[i].id === id) return AV_ZONES[i]; return null; }
function avZoneCurrent() { return avShellState.zone; }

/* ---------- sub-tabs (C1) ----------
   A page with more than one card carries sub-tabs; exactly one sub renders. The chosen sub is
   remembered per page (localStorage "av-sub") and restored on every show, so a page always comes
   back the way it was left. Deep link: ?z=<page>&s=<sub>. A page with no subs is an honest no-op. */
const avSubState = { map: null };

function avSubMap() {
  if (avSubState.map) return avSubState.map;
  try {
    const raw = localStorage.getItem(AV_SUB_LS_KEY);
    const o = raw ? JSON.parse(raw) : null;
    avSubState.map = (o && typeof o === "object") ? o : {};
  } catch (e) { avSubState.map = {}; }
  return avSubState.map;
}
function avSubPersist() {
  try { localStorage.setItem(AV_SUB_LS_KEY, JSON.stringify(avSubMap())); } catch (e) { /* session only */ }
}
function avZoneSubList(zoneId) {
  const p = avZonePanelEl(zoneId);
  if (!p) return [];
  return Array.prototype.map.call(p.querySelectorAll(".av-sub[data-sub]"), function (e) { return e.getAttribute("data-sub"); });
}
function avZoneSubCurrent(zoneId) {
  const subs = avZoneSubList(zoneId);
  if (!subs.length) return null;
  const want = avSubMap()[zoneId];
  return (want && subs.indexOf(want) >= 0) ? want : subs[0];
}
function avZoneSub(zoneId, sub, opts) {
  try {
    const p = avZonePanelEl(zoneId);
    if (!p) return false;
    const subs = avZoneSubList(zoneId);
    if (!subs.length) return false;
    const pick = (sub && subs.indexOf(sub) >= 0) ? sub : subs[0];
    const tabs = p.querySelectorAll(".av-subtab[data-sub]");
    for (let i = 0; i < tabs.length; i++) {
      const on = tabs[i].getAttribute("data-sub") === pick;
      tabs[i].setAttribute("aria-selected", on ? "true" : "false");
      tabs[i].tabIndex = on ? 0 : -1;
    }
    const pans = p.querySelectorAll(".av-sub[data-sub]");
    for (let i = 0; i < pans.length; i++) {
      const on = pans[i].getAttribute("data-sub") === pick;
      if (!!pans[i].hidden === on) pans[i].hidden = !on;
    }
    avSubMap()[zoneId] = pick;
    avSubPersist();
    if (!(opts && opts.silent)) {
      try { window.dispatchEvent(new CustomEvent("av-sub-shown", { detail: { zone: zoneId, sub: pick } })); } catch (e3) { /* listeners best-effort */ }
    }
    return true;
  } catch (e) { return false; }
}
function avZoneSubRestore(zoneId) {
  const s = avZoneSubCurrent(zoneId);
  if (s) avZoneSub(zoneId, s, { silent: true });
  return s;
}
function avZoneSubWire() {
  const nav = document.getElementById("av-zones");
  let zones = 0;
  for (let i = 0; i < AV_ZONES.length; i++) {
    const zid = AV_ZONES[i].id;
    const p = avZonePanelEl(zid);
    if (!p) continue;
    zones++;
    const tabs = p.querySelectorAll(".av-subtab[data-sub]");
    for (let j = 0; j < tabs.length; j++) {
      (function (z, s) {
        tabs[j].addEventListener("click", function () { avZoneSub(z, s, { source: "subtab" }); });
      })(zid, tabs[j].getAttribute("data-sub"));
    }
  }
  return zones === AV_ZONES.length;
}

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
    avZoneSubRestore(id);
    try { document.body.setAttribute("data-av-zone", id); } catch (e2) { /* body attr is cosmetic */ }
    try { window.dispatchEvent(new CustomEvent("av-zone-shown", { detail: { zone: id } })); } catch (e5) { /* listeners are best-effort */ }
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
    const sub = el.closest(".av-sub");
    let shown = !!(zone && !zone.hidden);
    if (zone && zone.hidden) {
      const zid = zone.getAttribute("data-zone");
      if (zid) shown = avZoneShow(zid, { source: "reveal", silent: true }) === true;
    }
    /* a target inside a sub-tab must reveal the SUB as well, or it stays display:none */
    if (shown && zone && sub) {
      const zid2 = zone.getAttribute("data-zone");
      const sid = sub.getAttribute("data-sub");
      if (zid2 && sid) avZoneSub(zid2, sid, { silent: true });
    }
    return shown;
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
          if (zone) {
            const zid = zone.getAttribute("data-zone");
            if (zid) {
              if (zone.hidden) avZoneShow(zid, { source: "seam", silent: true });
              const sub = el.closest(".av-sub");
              const sid = sub && sub.getAttribute("data-sub");
              if (sid) avZoneSub(zid, sid, { silent: true });
            }
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

/* Alt+1..9 switches pages (workflow muscle memory; registered on capture so it wins early) */
function avShellWireKeys() {
  try {
    document.addEventListener("keydown", function (e) {
      try {
        if (!e || !e.altKey || e.ctrlKey || e.metaKey) return;
        if (!/^[1-9]$/.test(e.key || "")) return;
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
    avZoneSubWire();
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
    try {
      const s = (typeof URLSearchParams === "function") ? new URLSearchParams(location.search).get("s") : null;
      if (s) avZoneSub(def, s, { silent: true });
    } catch (e6) { /* boot sub default stands */ }
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
  sub: function (zone, s, opts) { return avZoneSub(zone, s, opts); },
  subList: function (zone) { return avZoneSubList(zone); },
  subCurrent: function (zone) { return avZoneSubCurrent(zone); },
  version: AV_SHELL_VERSION,
};
