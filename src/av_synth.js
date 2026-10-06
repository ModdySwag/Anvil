/* Anvil — SYNTH card (P1 voice engine). avSynthInit() mounts the engine controls into the
   parent-owned host #av-synth-knobs: one row of selects (osc1 wave · osc2 wave · filter mode)
   plus one knob row per control group — OSC (mix/unison/sub), FILTER (cutoff/reso/env amount),
   ENV (env1 ADSR), VOICE (glide + LFO rate + LFO→CUT). All knobs ride the standard avKnob
   mechanics (avKnobCommit → avApplyParam); selects commit directly through avApplyParam.
   Defaults mirror verify/_p1_wave.md §4.2 — the single source of truth for paths/ranges/defaults.
   No persistence in P1: a fresh page always starts on the §4.2 defaults. */
"use strict";

/* the path→default table for every control this card mounts (§4.2). avSynthDefaults() hands out
   a fresh copy — the parent may reuse it when replaying the mirror into the engine at boot. */
function avSynthDefaults() {
  return {
    "osc1.type": "saw",
    "osc1.level": 1.0,
    "osc1.uni": 1,
    "osc1.spread": 12,
    "osc2.type": "wt.saw",
    "osc2.level": 0.5,
    "sub.level": 0,
    "filter.mode": "lp24",
    "filter.cutoff": 800,
    "filter.reso": 0.3,
    "filter.envAmt": 2,
    "env1.a": 0.002,
    "env1.d": 0.3,
    "env1.s": 0.8,
    "env1.r": 0.2,
    "voice.glide": 0,
    "lfo.rate": 5,
    "lfo.toCut": 0,
  };
}

/* the three waveform/mode picks — plain <select class="av-select"> (the parent skins them) */
const AV_SYNTH_SELECTS = [
  { path: "osc1.type", label: "OSC1", aria: "Oscillator 1 waveform", options: ["saw", "square", "pulse", "tri", "sine"] },
  { path: "osc2.type", label: "OSC2", aria: "Oscillator 2 wavetable", options: ["wt.saw", "wt.square", "wt.tri", "wt.sine", "wt.pulse25"] },
  { path: "filter.mode", label: "FILTER", aria: "Filter mode", options: ["lp12", "lp24", "bp", "hp"] },
];

/* one knob row per group — labels, ranges, defaults straight from §4.2 */
const AV_SYNTH_ROWS = [
  { cls: "av-synth-osc", knobs: [
    { path: "osc1.level", label: "OSC1 LVL", opts: { min: 0, max: 1, step: 0.01, def: 1.0, fmt: "pct" } },
    { path: "osc2.level", label: "OSC2 LVL", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct" } },
    { path: "osc1.uni", label: "UNISON", opts: { min: 1, max: 7, step: 1, def: 1, fmt: "int" } },
    { path: "osc1.spread", label: "SPREAD", opts: { min: 0, max: 50, step: 0.5, def: 12, fmt: "ct" } },
    { path: "sub.level", label: "SUB", opts: { min: 0, max: 1, step: 0.01, def: 0, fmt: "pct" } },
  ] },
  { cls: "av-synth-filter", knobs: [
    { path: "filter.cutoff", label: "CUTOFF", opts: { min: 20, max: 20000, step: 1, def: 800, curve: "log", fmt: "hz" } },
    { path: "filter.reso", label: "RESO", opts: { min: 0, max: 1, step: 0.01, def: 0.3, fmt: "pct" } },
    { path: "filter.envAmt", label: "ENV AMT", opts: { min: -4, max: 4, step: 0.1, def: 2, unit: "oct" } },
  ] },
  { cls: "av-synth-env", knobs: [
    { path: "env1.a", label: "ATTACK", opts: { min: 0.001, max: 4, step: 0.001, def: 0.002, curve: "log", fmt: "ms" } },
    { path: "env1.d", label: "DECAY", opts: { min: 0.001, max: 8, step: 0.001, def: 0.3, curve: "log", fmt: "ms" } },
    { path: "env1.s", label: "SUSTAIN", opts: { min: 0, max: 1, step: 0.01, def: 0.8, fmt: "pct" } },
    { path: "env1.r", label: "RELEASE", opts: { min: 0.001, max: 8, step: 0.001, def: 0.2, curve: "log", fmt: "ms" } },
  ] },
  { cls: "av-synth-mod", knobs: [
    { path: "voice.glide", label: "GLIDE", opts: { min: 0, max: 2, step: 0.001, def: 0, fmt: "ms" } },
    { path: "lfo.rate", label: "LFO RATE", opts: { min: 0.05, max: 20, step: 0.01, def: 5, curve: "log", fmt: "hz" } },
    { path: "lfo.toCut", label: "LFO→CUT", opts: { min: -1, max: 1, step: 0.01, def: 0, fmt: "pct" } },
  ] },
];

/* local escaper (same rules as avKnobEsc): this part carries no extra dependency on other parts */
const avSynthEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* one labelled select with its current option pre-selected from the live mirror */
function avSynthSelectHTML(spec) {
  const cur = avParams[spec.path];
  const opts = spec.options.map(o =>
    '<option value="' + avSynthEsc(o) + '"' + (o === cur ? " selected" : "") + ">" + avSynthEsc(o) + "</option>").join("");
  return '<label class="av-synth-pick"><span class="av-synth-pick-lbl">' + avSynthEsc(spec.label) + "</span>" +
    '<select class="av-select" data-param="' + avSynthEsc(spec.path) + '" aria-label="' + avSynthEsc(spec.aria) + '">' +
    opts + "</select></label>";
}

/* the whole card body: selects row first, then one avKnobs row per group */
function avSynthBodyHTML() {
  const picks = AV_SYNTH_SELECTS.map(s => avSynthSelectHTML(s)).join("");
  const rows = AV_SYNTH_ROWS.map(row => avKnobRowHTML(row.knobs.map(k =>
    avKnobHTML(k.path, k.label, Object.assign({ value: avParams[k.path] }, k.opts))), row.cls)).join("");
  return '<div class="av-synth-selects">' + picks + "</div>" + rows;
}

/* selects commit like every control: mirror first, then the app-side hook (with avKnobCommit's
   av-param fallback so the card still fans out when it ships without app_core) */
function avSynthSelectCommit(sel, path) {
  const v = sel.value;
  avParams[path] = v;
  if (typeof avApplyParam === "function") {
    try { avApplyParam(path, v, { from: "select" }); }
    catch (e) { console.warn("[anvil] avApplyParam(" + path + ") failed", e); }
  } else {
    try { window.dispatchEvent(new CustomEvent("av-param", { detail: { path: path, value: v, el: sel, from: "select" } })); }
    catch (e) { /* no fan-out */ }
  }
}

function avSynthBindSelects(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll("select.av-select[data-param]").forEach(sel => {
    const path = sel.getAttribute("data-param");
    sel.addEventListener("change", () => avSynthSelectCommit(sel, path));
  });
}

/* mount into the parent-owned host: seed the mirror first (LEVELS idiom — first paint reads
   avParams, not the markup), then render and bind. Seeding only fills unset paths so a re-mount
   can never clobber live values. Host absent or knob parts missing → false, no throw. */
function avSynthInit() {
  const host = document.getElementById("av-synth-knobs");
  if (!host) return false;
  if (typeof avKnobHTML !== "function" || typeof avKnobRowHTML !== "function" || typeof avKnobBind !== "function") return false;
  try {
    const defs = avSynthDefaults();
    for (const p in defs) {
      if (!(p in avParams)) avParams[p] = defs[p];
    }
    host.innerHTML = avSynthBodyHTML();
    avKnobBind(host);
    avSynthBindSelects(host);
    return true;
  } catch (e) {
    console.warn("[anvil] synth card mount failed", e);
    return false;
  }
}
