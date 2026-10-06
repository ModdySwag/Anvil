/* Anvil — core shell (Phase 0). Boot contract: arm the master tap FIRST, then mount the knob
   framework on the LEVELS card and fill the header chips last; `data-av-ready` flips when all
   of that is wired. `?avtest=1` runs runtime proofs of the tap chain and the knob commit path. */
"use strict";

const ANVIL = Object.freeze({ version: "0.1.0", phase: "P1 · voice engine", built: "2026-10-07" });
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
  bpm: 120,               /* transport tempo — the MIDI clock-out reads it every tick; the sequencer will own it later */
};

function avApplyParam(path, v, meta) {
  if (path === "master") { avState.master = v; avParams[path] = v; return avMasterApply(v); }
  if (path === "keys") { avState.keysVol = v; avParams[path] = v; return avKeysApply(v); }
  avParams[path] = v;      /* engine parameters (P1): route to the live engine once it is ready */
  if (window.__avEngine && window.__avEngine.ready && typeof window.__avEngine.setParam === "function") {
    try { window.__avEngine.setParam(path, v); return true; } catch (e) { return false; }
  }
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
  let kbOk = false, midiOk = false, synthOk = false;
  try { kbOk = (typeof avKbInit === "function") ? (avKbInit() !== false) : false; } catch (e) { console.warn("[anvil] kb init failed", e); }
  try { midiOk = (typeof avMidiInit === "function") ? (avMidiInit() !== false) : false; } catch (e) { console.warn("[anvil] midi init failed", e); }
  try { synthOk = (typeof avSynthInit === "function") ? (avSynthInit() !== false) : false; } catch (e) { console.warn("[anvil] synth card failed", e); }
  /* the P1 engine boots eagerly: its context starts suspended and the first gesture resumes it;
     once ready, the facade wires the note sink, replays params and takes the header chips over */
  try {
    if (typeof avEngineEnsure === "function") {
      avEngineEnsure().catch(e => console.warn("[anvil] engine boot failed", e));
    }
  } catch (e) { console.warn("[anvil] engine ensure threw", e); }
  const ver = document.getElementById("av-version");
  if (ver) ver.textContent = "v" + ANVIL.version;
  const tier = document.getElementById("av-tier");
  if (tier) tier.textContent = tapOk ? "tap: armed · engine: booting" : "tap: UNAVAILABLE";
  document.documentElement.setAttribute("data-av-ready", "1");   /* the smoke contract: tap + UI are wired */
  console.log("[anvil] boot — v" + ANVIL.version + " tap=" + tapOk + " knobs=" + levelsOk + " kb=" + kbOk + " midi=" + midiOk + " synth=" + synthOk);
  if (/[?&]avtest=1/.test(location.search)) {
    try { avTapSelfTest(); } catch (e) { console.warn("avtest tap", e); }
    try { avKnobSelfTest(); } catch (e) { console.warn("avtest knob", e); }
    try { avEngineSelfTest(); } catch (e) { console.warn("avtest engine", e); }
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

/* ---------- engine proof (?avtest=1): tier + allocation + release ---------- */
async function avEngineSelfTest() {
  const out = { ok: false };
  try {
    const h = (typeof avEngineEnsure === "function") ? await avEngineEnsure() : null;
    if (!h) throw new Error("engine unavailable");
    out.tier = h.mode || h.tier || null;
    out.url = h.url || null;
    out.sr = h.sr || null;
    out.maxVoices = h.maxVoices || null;
    const s0 = await h.stats();
    h.noteOn(60, 0.9);
    await new Promise(r => setTimeout(r, 250));
    const s1 = await h.stats();
    h.allOff();
    await new Promise(r => setTimeout(r, 150));
    const s2 = await h.stats();
    out.allocated = (s1.active || 0) >= 1;
    out.released = (s2.active || 0) === 0;
    out.voices = [s0.active || 0, s1.active || 0, s2.active || 0];
    out.ok = !!out.tier && out.allocated === true;
  } catch (e) { out.error = String((e && e.message) || e); }
  avTestLine("ENGINE SELFTEST " + JSON.stringify(out), "av-enginetest");
  window.__avEngineTest = out;
  return out;
}
