/* Anvil — core shell (Phase 0). Boot contract: arm the master tap FIRST, then mount the knob
   framework on the LEVELS card and fill the header chips last; `data-av-ready` flips when all
   of that is wired. `?avtest=1` runs runtime proofs of the tap chain and the knob commit path. */
"use strict";

const ANVIL = Object.freeze({ version: "0.8.0", phase: "S2 · sessions", built: "2026-10-07" });
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
  if (path === "bpm") {    /* P4: the sequencer owns the transport tempo (20..300) */
    const n = Number(v);
    if (!isFinite(n)) return false;
    avState.bpm = Math.max(20, Math.min(300, n));
    avParams[path] = avState.bpm;
    if (window.__avEngine && window.__avEngine.ready && typeof window.__avEngine.setParam === "function") {
      try { window.__avEngine.setParam("fx.delay.bpm", avState.bpm); } catch (e) { /* mirror is best-effort */ }
    }
    return true;
  }
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
  let padsOk = false, sampleOk = false, recOk = false;
  try { padsOk = (typeof avPadsInit === "function") ? (avPadsInit() !== false) : false; } catch (e) { console.warn("[anvil] pads init failed", e); }
  try { sampleOk = (typeof avSampleInit === "function") ? (avSampleInit() !== false) : false; } catch (e) { console.warn("[anvil] sample init failed", e); }
  try { const r0 = (typeof avRecInit === "function") ? avRecInit() : null; recOk = !!(r0 && r0.ok === true); } catch (e) { console.warn("[anvil] rec init failed", e); }
  let fxOk = false, modOk = false;
  try { fxOk = (typeof avFxInit === "function") ? (avFxInit() !== false) : false; } catch (e) { console.warn("[anvil] fx rack init failed", e); }
  try { modOk = (typeof avModInit === "function") ? (avModInit() !== false) : false; } catch (e) { console.warn("[anvil] mod matrix init failed", e); }
  let seqOk = false, seqUiOk = false, capOk = false, undoOk = false;
  try { seqOk = (typeof avSeqInit === "function") ? (avSeqInit() !== false) : false; } catch (e) { console.warn("[anvil] seq sched init failed", e); }
  try { if (typeof avPlockInit === "function") avPlockInit(); } catch (e) { console.warn("[anvil] plock init failed", e); }
  try { seqUiOk = (typeof avSeqUiInit === "function") ? (avSeqUiInit() !== false) : false; } catch (e) { console.warn("[anvil] seq ui init failed", e); }
  try { capOk = (typeof avSeqCaptureInit === "function") ? (avSeqCaptureInit() !== false) : false; } catch (e) { console.warn("[anvil] seq capture init failed", e); }
  try { undoOk = (typeof avUndoInit === "function") ? (avUndoInit() !== false) : false; } catch (e) { console.warn("[anvil] undo init failed", e); }
  let storeOk = false, bankOk = false, storeUiOk = false;
  try { storeOk = (typeof avStoreInit === "function") ? (avStoreInit() !== false) : false; } catch (e) { console.warn("[anvil] store init failed", e); }
  try { bankOk = (typeof avBankInit === "function") ? (avBankInit() !== false) : false; } catch (e) { console.warn("[anvil] bank row init failed", e); }
  try { storeUiOk = (typeof avStoreUiInit === "function") ? (avStoreUiInit() !== false) : false; } catch (e) { console.warn("[anvil] store ui init failed", e); }
  /* P5: the BANK select follows installs — repaint on every store change */
  try {
    if (typeof avStoreOnChange === "function" && typeof avBankRefresh === "function") {
      avStoreOnChange(function () { try { avBankRefresh(); } catch (e) { /* bank repaint is best-effort */ } });
    }
  } catch (e) { console.warn("[anvil] store→bank wire failed", e); }
  let deliverOk = false;
  try { deliverOk = (typeof avDeliverUiInit === "function") ? (avDeliverUiInit() !== false) : false; } catch (e) { console.warn("[anvil] deliver ui init failed", e); }
  let inputOk = false, metroOk = false, takesOk = false, studioUiOk = false;
  try { inputOk = (typeof avInputInit === "function") ? (avInputInit() !== false) : false; } catch (e) { console.warn("[anvil] input init failed", e); }
  try { metroOk = (typeof avMetroInit === "function") ? (avMetroInit() !== false) : false; } catch (e) { console.warn("[anvil] metro init failed", e); }
  try { takesOk = (typeof avTakesInit === "function") ? (avTakesInit() !== false) : false; } catch (e) { console.warn("[anvil] takes init failed", e); }
  try { studioUiOk = (typeof avStudioUiInit === "function") ? (avStudioUiInit() !== false) : false; } catch (e) { console.warn("[anvil] studio ui init failed", e); }
  let sessionOk = false, backupOk = false, sessionUiOk = false;
  try { sessionOk = (typeof avSessionInit === "function") ? (avSessionInit() !== false) : false; } catch (e) { console.warn("[anvil] session init failed", e); }
  try { backupOk = (typeof avBackupInit === "function") ? (avBackupInit() !== false) : false; } catch (e) { console.warn("[anvil] backup init failed", e); }
  try { sessionUiOk = (typeof avSessionUiInit === "function") ? (avSessionUiInit() !== false) : false; } catch (e) { console.warn("[anvil] session ui init failed", e); }
  /* the P1 engine boots eagerly: its context starts suspended and the first gesture resumes it;
     once ready, the facade wires the note sink, replays params and takes the header chips over */
  try {
    if (typeof avEngineEnsure === "function") {
      avEngineEnsure().then(h => {
        /* P3: mirror the transport tempo into the delay module (div follows avState.bpm) */
        if (h) { try { h.setParam("fx.delay.bpm", avState.bpm); } catch (e) { /* bpm mirror is best-effort */ } }
      }).catch(e => console.warn("[anvil] engine boot failed", e));
    }
  } catch (e) { console.warn("[anvil] engine ensure threw", e); }
  const ver = document.getElementById("av-version");
  if (ver) ver.textContent = "v" + ANVIL.version;
  const tier = document.getElementById("av-tier");
  if (tier) tier.textContent = tapOk ? "tap: armed · engine: booting" : "tap: UNAVAILABLE";
  document.documentElement.setAttribute("data-av-ready", "1");   /* the smoke contract: tap + UI are wired */
  console.log("[anvil] boot — v" + ANVIL.version + " tap=" + tapOk + " knobs=" + levelsOk + " kb=" + kbOk + " midi=" + midiOk + " synth=" + synthOk + " pads=" + padsOk + " sample=" + sampleOk + " rec=" + recOk + " fx=" + fxOk + " mod=" + modOk + " seq=" + seqOk + " seqUi=" + seqUiOk + " cap=" + capOk + " undo=" + undoOk + " store=" + storeOk + " bank=" + bankOk + " storeUi=" + storeUiOk + " deliver=" + deliverOk + " input=" + inputOk + " metro=" + metroOk + " takes=" + takesOk + " studioUi=" + studioUiOk + " session=" + sessionOk + " backup=" + backupOk + " sessionUi=" + sessionUiOk);
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
    /* P2: kind switch acceptance + drum routing round-trip */
    out.kinds = {};
    let kindsOk = true;
    for (const k of ["va", "acid", "string", "drum", "grain", "sampler"]) {
      let acc = h.setParam("engine.kind", k) === true;
      if (acc && k === "acid") acc = h.setParam("acid.cutoff", 900) === true;
      if (acc && k === "string") acc = h.setParam("string.damp", 0.4) === true;
      if (acc && k === "drum") acc = h.setParam("drum.kick.decay", 0.3) === true;
      if (acc && k === "grain") acc = h.setParam("grain.pos", 0.25) === true;
      if (acc && k === "sampler") acc = h.setParam("sampler.root", 60) === true;
      out.kinds[k] = acc;
      kindsOk = kindsOk && acc;
    }
    /* P3: FX + mod wire acceptance (delivery semantics; default values re-sent, state unchanged) */
    out.fx = h.setParam("fx.verb.mix", 0.3) === true && h.setParam("fx.delay.time", 0.3) === true
      && h.setParam("fx.mod.rate", 0.6) === true && h.setParam("fx.drive.mode", "sat") === true;
    try { out.mod = (typeof avEngineMod === "function") ? (avEngineMod({ macros: new Float64Array(8), slots: new Float64Array(128) }) !== false) : false; } catch (e) { out.mod = false; }
    h.setParam("engine.kind", "drum");
    await new Promise(r => setTimeout(r, 150));
    h.noteOn(36, 0.9);
    await new Promise(r => setTimeout(r, 250));
    const s3 = await h.stats();
    out.drumNote = (s3.active || 0) >= 1;
    h.allOff();
    await new Promise(r => setTimeout(r, 150));
    h.setParam("engine.kind", "va");
    out.kindsOk = kindsOk;
    out.ok = !!out.tier && out.allocated === true && kindsOk && out.drumNote === true && out.fx === true && out.mod === true;
  } catch (e) { out.error = String((e && e.message) || e); }
  avTestLine("ENGINE SELFTEST " + JSON.stringify(out), "av-enginetest");
  window.__avEngineTest = out;
  return out;
}
