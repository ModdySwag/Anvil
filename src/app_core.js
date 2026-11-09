/* Anvil — core shell (Phase 0). Boot contract: arm the master tap FIRST, then mount the knob
   framework on the LEVELS card and fill the header chips last; `data-av-ready` flips when all
   of that is wired. `?avtest=1` runs runtime proofs of the tap chain and the knob commit path. */
"use strict";

const ANVIL = Object.freeze({ version: "1.15.0", phase: "C5 · rebuild", built: "2026-11-10" });
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
  try { avLevelsFold(); } catch (e) { /* the card stays open */ }
  return true;
}

/* C3-5: the LEVELS card folds to its head. It is chrome on every SOUND sub-page (the well is
   ~500px at 1280) and the head keeps the label + the fold toggle. Runs again after the chrome
   builds .av-mod-head, which is why the boot calls it a second time. */
function avLevelsFold() {
  try {
    const card = document.getElementById("av-levels");
    if (!card) return false;
    const body = card.querySelector(".av-levels-body");
    const head = card.querySelector(".av-mod-head");
    /* P2: the output strip lives in the head, so it survives the body fold. Built before the
       toggle guard — the second boot call (after the chrome made the head) is the one that lands. */
    try { avLevelsStrip(); } catch (e0) { /* the head strip is best-effort */ }
    if (!body || !head || head.querySelector(".av-sec-toggle")) return false;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "av-sec-toggle";
    btn.textContent = "▸";
    btn.title = "Show the levels controls";
    btn.setAttribute("aria-label", btn.title);
    btn.setAttribute("aria-expanded", "false");
    function sync() {
      const folded = body.classList.contains("av-sec-collapsed");
      btn.textContent = folded ? "▸" : "▾";
      btn.setAttribute("aria-expanded", folded ? "false" : "true");
      btn.title = (folded ? "Show" : "Hide") + " the levels controls";
      btn.setAttribute("aria-label", btn.title);
    }
    btn.addEventListener("click", function () { body.classList.toggle("av-sec-collapsed"); sync(); });
    const h2 = head.querySelector("h2");
    if (h2 && h2.nextSibling) head.insertBefore(btn, h2.nextSibling); else head.appendChild(btn);
    sync();
    return true;
  } catch (e) { return false; }
}

/* P2 (2026-11-10): the LEVELS head is the OUTPUT STAGE, not a label over a fold.
   The card must still fold to its head (chassis K24 pins that), so the head band is the only place
   that is always on screen — it carries the job: the two master-tap gains, a live stereo peak meter
   off avTap.levels, the peak-hold readout and a latched clip tell. The pots stay behind the fold
   (the body), unchanged. Reads avParams + avTap only; never writes a param. */
const AV_LV_HOLD_MS = 1200;
const avLvMeter = { clipAt: 0, holdL: -120, holdR: -120, holdAt: 0, raf: 0 };

function avLvDb(v) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0.0005) return -120;
  return 20 * Math.log10(n);
}
function avLvDbText(db) {
  if (db <= -99) return "-\u221E";
  return (db > -10 ? db.toFixed(1) : String(Math.round(db)));
}
function avLvStripHTML() {
  return '<span class="av-lv-strip" id="av-lv-strip" role="group" aria-label="Output stage">' +
    '<span class="av-lv-cell"><i>INST</i><b data-lv="keys">100 %</b></span>' +
    '<span class="av-lv-cell"><i>MASTER</i><b data-lv="master">80 %</b></span>' +
    '<span class="av-lv-meter" aria-hidden="true">' +
    '<span class="av-lv-bar" data-lv-bar="l"><i data-lv-fill="l"></i></span>' +
    '<span class="av-lv-bar" data-lv-bar="r"><i data-lv-fill="r"></i></span>' +
    '</span>' +
    '<span class="av-lv-cell av-lv-peak"><i>PEAK</i><b data-lv="peak">-\u221E</b></span>' +
    '<span class="av-lv-clip" id="av-lv-clip" title="Master clip tell">CLIP</span>' +
    '</span>';
}
function avLvStripPaint() {
  try {
    const strip = document.getElementById("av-lv-strip");
    if (!strip) return false;
    const lv = (typeof avTap !== "undefined" && avTap && avTap.levels) ? avTap.levels : null;
    const l = lv ? Math.max(0, Math.min(2, Number(lv.l) || 0)) : 0;
    const r = lv ? Math.max(0, Math.min(2, Number(lv.r) || 0)) : 0;
    /* -54 dB .. 0 dB maps to 0 .. 100 % of the bar: the useful meter span, not linear amplitude */
    const pct = (v) => {
      const db = avLvDb(v);
      if (db <= -54) return 0;
      return Math.max(0, Math.min(100, ((db + 54) / 54) * 100));
    };
    const fl = strip.querySelector('[data-lv-fill="l"]');
    const fr = strip.querySelector('[data-lv-fill="r"]');
    if (fl) fl.style.width = pct(l).toFixed(1) + "%";
    if (fr) fr.style.width = pct(r).toFixed(1) + "%";
    const now = Date.now();
    const dbl = avLvDb(l), dbr = avLvDb(r);
    if (dbl > avLvMeter.holdL) { avLvMeter.holdL = dbl; avLvMeter.holdAt = now; }
    if (dbr > avLvMeter.holdR) { avLvMeter.holdR = dbr; avLvMeter.holdAt = now; }
    if (now - avLvMeter.holdAt > AV_LV_HOLD_MS) {
      avLvMeter.holdL = Math.max(-120, avLvMeter.holdL - 0.9);
      avLvMeter.holdR = Math.max(-120, avLvMeter.holdR - 0.9);
    }
    const peak = strip.querySelector('[data-lv="peak"]');
    if (peak) {
      const txt = avLvDbText(Math.max(avLvMeter.holdL, avLvMeter.holdR));
      if (peak.textContent !== txt) peak.textContent = txt;
    }
    const kEl = strip.querySelector('[data-lv="keys"]');
    if (kEl && typeof avParams !== "undefined" && avParams) {
      const txt = Math.round((Number(avParams.keys) || 0) * 100) + " %";
      if (kEl.textContent !== txt) kEl.textContent = txt;
    }
    const mEl = strip.querySelector('[data-lv="master"]');
    if (mEl && typeof avParams !== "undefined" && avParams) {
      const txt = Math.round((Number(avParams.master) || 0) * 100) + " %";
      if (mEl.textContent !== txt) mEl.textContent = txt;
    }
    if (Math.max(l, r) >= 0.999) avLvMeter.clipAt = now;
    const clip = document.getElementById("av-lv-clip");
    if (clip) clip.classList.toggle("on", now - avLvMeter.clipAt < 2600);
    return true;
  } catch (e) { return false; }
}
function avLvStripLoop() {
  try {
    if (avLvMeter.raf) return true;
    const tick = function () {
      avLvMeter.raf = 0;
      if (typeof document === "undefined" || !document.getElementById("av-lv-strip")) return;
      /* the meter only has a job while the SOUND page owns the work area */
      const z = document.getElementById("av-zone-sound");
      if (z && z.offsetParent !== null) avLvStripPaint();
      avLvMeter.raf = (typeof requestAnimationFrame === "function") ? requestAnimationFrame(tick) : 0;
      if (!avLvMeter.raf) { try { avLvMeter.raf = setTimeout(tick, 120); } catch (e) { } }
    };
    tick();
    return true;
  } catch (e) { return false; }
}
function avLevelsStrip() {
  try {
    const card = document.getElementById("av-levels");
    if (!card) return false;
    const head = card.querySelector(".av-mod-head");
    if (!head) return false;
    if (!document.getElementById("av-lv-strip")) {
      const menu = head.querySelector(".av-mod-menu-btn");
      const wrap = document.createElement("span");
      wrap.innerHTML = avLvStripHTML();
      const node = wrap.firstChild;
      if (menu && menu.parentNode === head) head.insertBefore(node, menu);
      else head.appendChild(node);
    }
    avLvStripPaint();
    avLvStripLoop();
    return true;
  } catch (e) { return false; }
}

/* ---------- boot ---------- */
(function avBoot() {
  const tapOk = (typeof avInstallAudioTap === "function") ? avInstallAudioTap() : false;
  const levelsOk = avMountLevels();
  let kbOk = false, midiOk = false, synthOk = false, mpeOk = false;
  try { kbOk = (typeof avKbInit === "function") ? (avKbInit() !== false) : false; } catch (e) { console.warn("[anvil] kb init failed", e); }
  try { midiOk = (typeof avMidiInit === "function") ? (avMidiInit() !== false) : false; } catch (e) { console.warn("[anvil] midi init failed", e); }
  try { mpeOk = (typeof avMpeDeckInit === "function") ? (avMpeDeckInit() !== false) : false; } catch (e) { console.warn("[anvil] mpe deck init failed", e); }
  try { synthOk = (typeof avSynthInit === "function") ? (avSynthInit() !== false) : false; } catch (e) { console.warn("[anvil] synth card failed", e); }
  let padsOk = false, sampleOk = false, recOk = false;
  try { padsOk = (typeof avPadsInit === "function") ? (avPadsInit() !== false) : false; } catch (e) { console.warn("[anvil] pads init failed", e); }
  try { sampleOk = (typeof avSampleInit === "function") ? (avSampleInit() !== false) : false; } catch (e) { console.warn("[anvil] sample init failed", e); }
  try { const r0 = (typeof avRecInit === "function") ? avRecInit() : null; recOk = !!(r0 && r0.ok === true); } catch (e) { console.warn("[anvil] rec init failed", e); }
  /* R15b: the SAMPLE PACKS card (contract verify/_r15b_wave.md) */
  let importOk = false;
  try { importOk = (typeof avImportUiInit === "function") ? (avImportUiInit() !== false) : false; } catch (e) { console.warn("[anvil] import card init failed", e); }
  let sourcesUiOk = false;
  try { sourcesUiOk = (typeof avSourcesUiInit === "function") ? (avSourcesUiInit() !== false) : false; } catch (e) { console.warn("[anvil] sources ui init failed", e); }
  /* R21: the LIBRARY overlay (contract verify/_r21_wave.md) */
  let libraryOk = false;
  try { libraryOk = (typeof avLibraryUiInit === "function") ? (avLibraryUiInit() !== false) : false; } catch (e) { console.warn("[anvil] library overlay init failed", e); }
  let fxOk = false, modOk = false;
  try { fxOk = (typeof avFxInit === "function") ? (avFxInit() !== false) : false; } catch (e) { console.warn("[anvil] fx rack init failed", e); }
  try { modOk = (typeof avModInit === "function") ? (avModInit() !== false) : false; } catch (e) { console.warn("[anvil] mod matrix init failed", e); }
  /* R13: the LFO card (contract verify/_r13_wave.md) */
  let lfoOk = false;
  try { lfoOk = (typeof avLfoInit === "function") ? (avLfoInit() !== false) : false; } catch (e) { console.warn("[anvil] lfo card failed", e); }
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
  let compOk = false, compUiOk = false;
  try { compOk = (typeof avCompInit === "function") ? (avCompInit() !== false) : false; } catch (e) { console.warn("[anvil] comp init failed", e); }
  try { compUiOk = (typeof avCompUiInit === "function") ? (avCompUiInit() !== false) : false; } catch (e) { console.warn("[anvil] comp ui init failed", e); }
  let mixOk = false, mixUiOk = false;
  try { mixOk = (typeof avMixInit === "function") ? (avMixInit() !== false) : false; } catch (e) { console.warn("[anvil] mix init failed", e); }
  try { mixUiOk = (typeof avMixUiInit === "function") ? (avMixUiInit() !== false) : false; } catch (e) { console.warn("[anvil] mix ui init failed", e); }
  let deckOk = false, deckUiOk = false;
  try { deckOk = (typeof avDeckInit === "function") ? (avDeckInit() !== false) : false; } catch (e) { console.warn("[anvil] deck init failed", e); }
  try { deckUiOk = (typeof avDeckUiInit === "function") ? (avDeckUiInit() !== false) : false; } catch (e) { console.warn("[anvil] deck ui init failed", e); }
  let projOk = false, cardOk = false, videoOk = false, filesUiOk = false;
  try { projOk = (typeof avProjInit === "function") ? (avProjInit() !== false) : false; } catch (e) { console.warn("[anvil] proj init failed", e); }
  try { cardOk = (typeof avCardInit === "function") ? (avCardInit() !== false) : false; } catch (e) { console.warn("[anvil] card init failed", e); }
  try { videoOk = (typeof avVideoInit === "function") ? (avVideoInit() !== false) : false; } catch (e) { console.warn("[anvil] video init failed", e); }
  try { filesUiOk = (typeof avFilesUiInit === "function") ? (avFilesUiInit() !== false) : false; } catch (e) { console.warn("[anvil] files ui init failed", e); }
  /* S4: a #avp= patch fragment on the URL applies at boot (guarded; av_card owns the decode+law) */
  try { if (typeof avCardUrlApply === "function") avCardUrlApply(); } catch (e) { console.warn("[anvil] card url apply failed", e); }
  /* S5: the popout keyboard · the CODE engine + card · help · palette · lessons */
  let kbPopOk = false, codeOk = false, codeUiOk = false, helpOk = false, palOk = false, lessonsOk = false;
  try { kbPopOk = (typeof avKbPopInit === "function") ? (avKbPopInit() !== false) : false; } catch (e) { console.warn("[anvil] kb popout init failed", e); }
  try { codeOk = (typeof avCodeInit === "function") ? (avCodeInit() !== false) : false; } catch (e) { console.warn("[anvil] code engine init failed", e); }
  try { codeUiOk = (typeof avCodeUiInit === "function") ? (avCodeUiInit() !== false) : false; } catch (e) { console.warn("[anvil] code card init failed", e); }
  try { helpOk = (typeof avHelpInit === "function") ? (avHelpInit() !== false) : false; } catch (e) { console.warn("[anvil] help init failed", e); }
  try { palOk = (typeof avPaletteInit === "function") ? (avPaletteInit() !== false) : false; } catch (e) { console.warn("[anvil] palette init failed", e); }
  try { lessonsOk = (typeof avLessonsInit === "function") ? (avLessonsInit() !== false) : false; } catch (e) { console.warn("[anvil] lessons init failed", e); }
  /* M1: the FM card + the wavetable editor */
  let fmUiOk = false, wtUiOk = false, chopUiOk = false, tuneUiOk = false;
  try { fmUiOk = (typeof avFmUiInit === "function") ? (avFmUiInit() !== false) : false; } catch (e) { console.warn("[anvil] fm card init failed", e); }
  try { wtUiOk = (typeof avWtUiInit === "function") ? (avWtUiInit() !== false) : false; } catch (e) { console.warn("[anvil] wt editor init failed", e); }
  try { tuneUiOk = (typeof avTuneUiInit === "function") ? (avTuneUiInit() !== false) : false; } catch (e) { console.warn("[anvil] tune card init failed", e); }
  try { chopUiOk = (typeof avChopUiInit === "function") ? (avChopUiInit() !== false) : false; } catch (e) { console.warn("[anvil] chop ui init failed", e); }
  /* PLATFORM: the PWA module + the FAMILY card */
  let pwaOk = false, familyOk = false;
  try { pwaOk = (typeof avPwaInit === "function") ? (avPwaInit() !== false) : false; } catch (e) { console.warn("[anvil] pwa init failed", e); }
  try { familyOk = (typeof avFamilyInit === "function") ? (avFamilyInit() !== false) : false; } catch (e) { console.warn("[anvil] family init failed", e); }
  /* P7: the accessibility layer */
  let a11yOk = false;
  try { a11yOk = (typeof avA11yInit === "function") ? (avA11yInit() !== false) : false; } catch (e) { console.warn("[anvil] a11y init failed", e); }
  /* R1: the cockpit shell — zones, tabs + the never-scrolling chassis (runs after the cards mount) */
  let shellOk = false;
  try { shellOk = (typeof avShellInit === "function") ? (avShellInit() !== false) : false; } catch (e) { console.warn("[anvil] shell init failed", e); }
  /* R2: the module chrome — heads + menu on every card, the engine strip, header utilities */
  let chromeOk = false;
  try { chromeOk = (typeof avChromeInit === "function") ? (avChromeInit() !== false) : false; } catch (e) { console.warn("[anvil] chrome init failed", e); }
  /* R3: the float workspace + the About popover */
  let panelsOk = false;
  try { panelsOk = (typeof avPanelsInit === "function") ? (avPanelsInit() !== false) : false; } catch (e) { console.warn("[anvil] panels init failed", e); }
  /* C3-5: the card heads exist now — give LEVELS its fold toggle */
  try { avLevelsFold(); } catch (e) { console.warn("[anvil] levels fold failed", e); }
  /* R4: the left module rail */
  let railOk = false;
  try { railOk = (typeof avRailInit === "function") ? (avRailInit() !== false) : false; } catch (e) { console.warn("[anvil] rail init failed", e); }
  /* C1: the inspector column (after the shell — it jumps through avZoneShow/avZoneSub) */
  let inspOk = false;
  try { inspOk = (typeof avInspectorInit === "function") ? (avInspectorInit() !== false) : false; } catch (e) { console.warn("[anvil] inspector init failed", e); }
  /* R5: the menu bar */
  let menusOk = false;
  try { menusOk = (typeof avMenubarInit === "function") ? (avMenubarInit() !== false) : false; } catch (e) { console.warn("[anvil] menubar init failed", e); }
  /* the P1 engine boots eagerly: its context starts suspended and the first gesture resumes it;
     once ready, the facade wires the note sink, replays params and takes the header chips over */
  try {
    if (typeof avEngineEnsure === "function") {
      avEngineEnsure().then(h => {
        /* P3: mirror the transport tempo into the delay module (div follows avState.bpm) */
        if (h) { try { h.setParam("fx.delay.bpm", avState.bpm); } catch (e) { /* bpm mirror is best-effort */ } }
        /* M2: re-push the MPE zone state once the engine is actually up */
        if (h) { try { if (typeof avMpeDeckPush === "function") avMpeDeckPush(); } catch (e) { /* mpe re-push is best-effort */ } }
      }).catch(e => console.warn("[anvil] engine boot failed", e));
    }
  } catch (e) { console.warn("[anvil] engine ensure threw", e); }
  const ver = document.getElementById("av-version");
  if (ver) ver.textContent = "v" + ANVIL.version;
  const tier = document.getElementById("av-tier");
  if (tier) tier.textContent = tapOk ? "tap: armed · engine: booting" : "tap: UNAVAILABLE";
  document.documentElement.setAttribute("data-av-ready", "1");   /* the smoke contract: tap + UI are wired */
  console.log("[anvil] boot — v" + ANVIL.version + " tap=" + tapOk + " knobs=" + levelsOk + " kb=" + kbOk + " midi=" + midiOk + " synth=" + synthOk + " pads=" + padsOk + " sample=" + sampleOk + " rec=" + recOk + " import=" + importOk + " sourcesUi=" + sourcesUiOk + " fx=" + fxOk + " mod=" + modOk + " lfo=" + lfoOk + " seq=" + seqOk + " seqUi=" + seqUiOk + " cap=" + capOk + " undo=" + undoOk + " store=" + storeOk + " bank=" + bankOk + " storeUi=" + storeUiOk + " deliver=" + deliverOk + " input=" + inputOk + " metro=" + metroOk + " takes=" + takesOk + " studioUi=" + studioUiOk + " session=" + sessionOk + " backup=" + backupOk + " sessionUi=" + sessionUiOk + " comp=" + compOk + " compUi=" + compUiOk + " mix=" + mixOk + " mixUi=" + mixUiOk + " deck=" + deckOk + " deckUi=" + deckUiOk + " proj=" + projOk + " card=" + cardOk + " video=" + videoOk + " filesUi=" + filesUiOk + " kbPop=" + kbPopOk + " code=" + codeOk + " codeUi=" + codeUiOk + " help=" + helpOk + " pal=" + palOk + " lessons=" + lessonsOk + " fmUi=" + fmUiOk + " wtUi=" + wtUiOk + " mpe=" + mpeOk + " chopUi=" + chopUiOk + " tuneUi=" + tuneUiOk + " pwa=" + pwaOk + " family=" + familyOk + " a11y=" + a11yOk + " shell=" + shellOk + " chrome=" + chromeOk + " panels=" + panelsOk + " rail=" + railOk + " menus=" + menusOk);
  if (/[?&]avtest=1/.test(location.search)) {
    try { avTapSelfTest(); } catch (e) { console.warn("avtest tap", e); }
    try { avKnobSelfTest(); } catch (e) { console.warn("avtest knob", e); }
    try { avEngineSelfTest(); } catch (e) { console.warn("avtest engine", e); }
    try { if (typeof avPwaProof === "function") { const _ps = avPwaProof(); if (_ps) avTestLine(_ps, "av-pwatest"); } } catch (e) { console.warn("avtest pwa", e); }
    try { if (typeof avA11yProof === "function") { const _as = avA11yProof(); if (_as) avTestLine(_as, "av-a11ytest"); } } catch (e) { console.warn("avtest a11y", e); }
    try { if (typeof avShellProof === "function") { const _ss = avShellProof(); if (_ss) avTestLine(_ss, "av-shelltest"); } } catch (e) { console.warn("avtest shell", e); }
    try { if (typeof avChromeProof === "function") { const _cs = avChromeProof(); if (_cs) avTestLine(_cs, "av-chrometest"); } } catch (e) { console.warn("avtest chrome", e); }
    try { if (typeof avPanelsProof === "function") { const _fs = avPanelsProof(); if (_fs) avTestLine(_fs, "av-panelstest"); } } catch (e) { console.warn("avtest panels", e); }
    try { if (typeof avRailProof === "function") { const _rs = avRailProof(); if (_rs) avTestLine(_rs, "av-railtest"); } } catch (e) { console.warn("avtest rail", e); }
    try { if (typeof avMenubarProof === "function") { const _ms = avMenubarProof(); if (_ms) avTestLine(_ms, "av-menubartest"); } } catch (e) { console.warn("avtest menubar", e); }
  }
})();

/* ---------- runtime proofs (?avtest=1) ---------- */
function avTestLine(text, id) {
  const p = document.createElement("p");
  p.className = "av-mono";
  if (id) p.id = id;
  p.textContent = text;
  const main = document.getElementById("av-proofs") || document.querySelector(".av-main");
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
    for (const k of ["va", "acid", "string", "drum", "grain", "sampler", "fm"]) {
      let acc = h.setParam("engine.kind", k) === true;
      if (acc && k === "acid") acc = h.setParam("acid.cutoff", 900) === true;
      if (acc && k === "string") acc = h.setParam("string.damp", 0.4) === true;
      if (acc && k === "drum") acc = h.setParam("drum.kick.decay", 0.3) === true;
      if (acc && k === "grain") acc = h.setParam("grain.pos", 0.25) === true;
      if (acc && k === "sampler") acc = h.setParam("sampler.root", 60) === true;
      if (acc && k === "fm") acc = h.setParam("fm.fb", 0.2) === true;
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
    /* M2: MPE zone + member note + expression round trip (restores everything) */
    out.mpe = null;
    try {
      const zOn = (typeof avEngineMpeSet === "function") ? avEngineMpeSet(true, 48) : false;
      const xOk = (typeof avEngineMpeExpr === "function") ? avEngineMpeExpr(1, "bend", 12) : false;
      h.noteOn(60, 0.9, 1);
      await new Promise(r => setTimeout(r, 250));
      const s4 = await h.stats();
      const voiceOn = (s4.active || 0) >= 1;
      h.allOff();
      await new Promise(r => setTimeout(r, 150));
      const zOff = (typeof avEngineMpeSet === "function") ? avEngineMpeSet(false, 48) : false;
      out.mpe = { on: zOn, expr: xOk, voice: voiceOn, off: zOff };
    } catch (e) { out.mpe = { error: String((e && e.message) || e) }; }
    out.ok = !!out.tier && out.allocated === true && kindsOk && out.drumNote === true && out.fx === true && out.mod === true
      && !!(out.mpe && out.mpe.on === true && out.mpe.expr === true && out.mpe.voice === true && out.mpe.off === true);
  } catch (e) { out.error = String((e && e.message) || e); }
  avTestLine("ENGINE SELFTEST " + JSON.stringify(out), "av-enginetest");
  window.__avEngineTest = out;
  return out;
}
