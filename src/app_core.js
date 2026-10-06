/* Anvil — core shell (Phase 0). Boot contract: arm the master tap FIRST, then mount the knob
   framework on the LEVELS card and fill the header chips last; `data-av-ready` flips when all
   of that is wired. `?avtest=1` runs runtime proofs of the tap chain and the knob commit path. */
"use strict";

const ANVIL = Object.freeze({ version: "0.0.3", phase: "P0 · knobs live", built: "2026-10-07" });
window.ANVIL = ANVIL;

/* ---------- the value store ----------
   avState is what the master tap reads for every new AudioContext (master / keysVol).
   avParams (owned by av_knob.js) is the knob framework's path→value mirror; avApplyParam
   below is the app-side commit hook that keeps both in sync and routes to the engine. */
function avSavedNumber(key, dflt) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return dflt;
    const v = Number(raw);
    return isFinite(v) ? Math.max(0, Math.min(1.2, v)) : dflt;
  } catch (e) { return dflt; }
}
const avState = {
  master: avSavedNumber("av-master", 0.8),
  keysVol: avSavedNumber("av-keys-vol", 1.0),
};

function avApplyParam(path, v, meta) {
  if (path === "master") { avState.master = v; avParams[path] = v; return avMasterApply(v); }
  if (path === "keys") { avState.keysVol = v; avParams[path] = v; return avKeysApply(v); }
  avParams[path] = v;      /* not an engine parameter yet — parked for the P1 layers */
  return false;
}

/* ---------- the LEVELS card: the first live controls on the master-tap gains ---------- */
const AV_LEVELS = [
  { path: "keys", label: "Instrument", opts: { min: 0, max: 1.2, step: 0.01, def: 1.0, fmt: "pct", size: "lg" } },
  { path: "master", label: "Master", opts: { min: 0, max: 1.2, step: 0.01, def: 0.8, fmt: "pct", size: "lg" } },
];

function avMountLevels() {
  const host = document.getElementById("av-levels-knobs");
  if (!host || typeof avKnobHTML !== "function") return false;
  avParams.keys = avState.keysVol;        /* first paint reads the live store, not the markup */
  avParams.master = avState.master;
  host.innerHTML = avKnobRowHTML(AV_LEVELS.map(k =>
    avKnobHTML(k.path, k.label, Object.assign({ value: avParams[k.path] }, k.opts))));
  avKnobBind(host);
  return true;
}

/* ---------- boot ---------- */
(function avBoot() {
  const tapOk = (typeof avInstallAudioTap === "function") ? avInstallAudioTap() : false;
  const levelsOk = avMountLevels();
  const ver = document.getElementById("av-version");
  if (ver) ver.textContent = "v" + ANVIL.version;
  const tier = document.getElementById("av-tier");
  if (tier) tier.textContent = tapOk ? "tap: armed · engine: pending (P1)" : "tap: UNAVAILABLE";
  document.documentElement.setAttribute("data-av-ready", "1");   /* the smoke contract: tap + UI are wired */
  console.log("[anvil] boot — v" + ANVIL.version + " tap=" + tapOk + " knobs=" + levelsOk);
  if (/[?&]avtest=1/.test(location.search)) {
    try { avTapSelfTest(); } catch (e) { console.warn("avtest tap", e); }
    try { avKnobSelfTest(); } catch (e) { console.warn("avtest knob", e); }
  }
})();

/* ---------- runtime proofs (?avtest=1) ---------- */
function avTestLine(text, id) {
  const p = document.createElement("p");
  p.className = "av-mono";
  if (id) p.id = id;
  p.textContent = text;
  const main = document.querySelector(".av-main");
  if (main) main.appendChild(p);
  return p;
}

function avTapSelfTest() {
  const c = new AudioContext();
  const dest = c.destination;                    /* reading it builds the chain */
  const t = {
    viaTap: dest && dest.__avTap === true,
    keysBus: dest && dest.__avKeys === true,
    masterNode: !!(avTap.node && avTap.node.__avMaster),
    live: (avTap.live || []).filter(x => x.state !== "closed").length,
    ctxState: c.state,
  };
  avTestLine("TAP SELFTEST " + JSON.stringify(t), "av-taptest");
  try { c.close(); } catch (e) { /* ok */ }
}

async function avKnobSelfTest() {
  const out = { ok: false };
  try {
    const el = document.querySelector('.av-knob[data-knob="master"]');
    const keysEl = document.querySelector('.av-knob[data-knob="keys"]');
    out.knobFound = !!el && el.dataset.knobBound === "1";
    out.keysBound = !!keysEl && keysEl.dataset.knobBound === "1";
    if (!el) throw new Error("master knob not mounted");
    const before = avState.master;
    const c = new AudioContext();
    void c.destination;                          /* build the bus chain for this context */
    try { await c.resume(); } catch (e) { /* gesture-gated in some browsers */ }
    out.committed = avKnobCommit(el, 0.55) === 0.55;
    out.params = avParams.master === 0.55;
    out.state = avState.master === 0.55;
    out.aria = el.getAttribute("aria-valuenow") === "0.55";
    const readout = document.querySelector('[data-kval="master"]');
    out.readout = !!readout && readout.textContent === "55%";
    out.ctxState = c.state;
    if (c.state === "running") {
      await new Promise(r => setTimeout(r, 300));
      const m = (typeof avMasterFor === "function") ? avMasterFor(c) : null;
      out.gain = m ? Number(m.gain.value.toFixed(4)) : null;
      out.gainOk = !!m && Math.abs(m.gain.value - 0.55) < 0.02;
    } else {
      out.gain = "skipped (ctx " + c.state + ")";
      out.gainOk = null;
    }
    out.ok = ["knobFound", "keysBound", "committed", "params", "state", "aria", "readout"].every(k => out[k] === true)
      && out.gainOk !== false;
    avKnobCommit(el, before);                    /* leave the user's value exactly as found */
    try { c.close(); } catch (e) { /* ok */ }
  } catch (e) { out.error = String((e && e.message) || e); }
  avTestLine("KNOB SELFTEST " + JSON.stringify(out), "av-knobtest");
  window.__avKnobTest = out;
  return out;
}
