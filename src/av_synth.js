/* Anvil — SYNTH card (P1 voice engine, P2 ENGINE layer). avSynthInit() mounts the engine
   controls into the parent-owned host #av-synth-knobs:
   - one ENGINE select (#av-synth-engine — va · acid · string · drum) at the top of the card,
     committing engine.kind through avApplyParam;
   - one panel per kind, a <div class="av-synth-panel" data-kind=...> section shown/hidden by
     the exported avSynthSetKind(kind):
       va     = the P1 body, unchanged: selects row (osc1 wave · osc2 wave · filter mode) plus
                one knob row per group — OSC (mix/unison/sub), FILTER (cutoff/reso/env amount),
                ENV (env1 ADSR), VOICE (glide + LFO rate + LFO→CUT).
       acid   = §3.1: the eight hero knobs + the eight-knob "MODS (EXPANDED)" group.
       string = §3.2: damp · decay · pluck · exciter pick · tone.
       drum   = §3.3: 11 voices x {tune, decay, level} in a compact 3-column kit grid, plus
                drum.split + drum.volume.
   All knobs ride the standard avKnob mechanics (avKnobCommit → avApplyParam); selects commit
   directly through avApplyParam. Defaults mirror verify/_p1_wave.md §4.2 (va) and
   verify/_p2_wave.md §3.1–3.3 (kinds) — the single source of truth for paths/ranges/defaults.
   No persistence: a fresh page always starts on those defaults. */
"use strict";

const AV_SYNTH_VERSION = "p2.0";

/* the per-voice kit table (§3.3): id = the drum.<id> path segment, label = the voice caption,
   decay/level are the kit defaults (tune defaults to 0 st). One table drives both the defaults
   and the markup, so the two can never drift. */
const AV_SYNTH_DRUM_VOICES = [
  { id: "kick", label: "KICK", decay: 0.4, level: 1.0 },
  { id: "snare", label: "SNARE", decay: 0.2, level: 0.9 },
  { id: "rim", label: "RIM", decay: 0.08, level: 0.7 },
  { id: "clap", label: "CLAP", decay: 0.12, level: 0.8 },
  { id: "ch", label: "HAT CL", decay: 0.05, level: 0.7 },
  { id: "oh", label: "HAT OP", decay: 0.3, level: 0.7 },
  { id: "lt", label: "TOM LO", decay: 0.4, level: 0.85 },
  { id: "mt", label: "TOM MID", decay: 0.3, level: 0.85 },
  { id: "ht", label: "TOM HI", decay: 0.25, level: 0.85 },
  { id: "crash", label: "CRASH", decay: 1.4, level: 0.75 },
  { id: "ride", label: "RIDE", decay: 0.8, level: 0.65 },
];

/* the path→default table for every control this card mounts (§4.2 va + §3.1–3.3 kinds).
   avSynthDefaults() hands out a fresh copy — the parent may reuse it when replaying the
   mirror into the engine at boot. */
function avSynthDefaults() {
  const d = {
    /* va — the P1 defaults (§4.2), unchanged */
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
    /* engine + kind panels (§3.1–3.3) */
    "engine.kind": "va",
    "acid.wave": 0,
    "acid.cutoff": 800,
    "acid.reso": 0.5,
    "acid.envMod": 0.5,
    "acid.decay": 0.3,
    "acid.accent": 0.5,
    "acid.volume": 0.8,
    "acid.slide": 0.06,
    "acid.accentDecay": 0.2,
    "acid.veg": 3,
    "acid.filterTrack": 0,
    "acid.overdrive": 1,
    "acid.muffler": 0,
    "acid.sweep": 0,
    "acid.softAttack": 0.0003,
    "acid.accentMode": 0,
    "string.damp": 0.5,
    "string.decay": 0.5,
    "string.pluck": 0.3,
    "string.exciter": "noise",
    "string.tone": 0.5,
    "drum.split": 0,
    "drum.volume": 0.8,
  };
  for (let i = 0; i < AV_SYNTH_DRUM_VOICES.length; i++) {
    const v = AV_SYNTH_DRUM_VOICES[i];
    d["drum." + v.id + ".tune"] = 0;
    d["drum." + v.id + ".decay"] = v.decay;
    d["drum." + v.id + ".level"] = v.level;
  }
  return d;
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

/* the four engine kinds (§2.1) — the card shows one panel per kind */
const AV_SYNTH_KINDS = ["va", "acid", "string", "drum"];

/* accept the string enum or the §2.1 ordinal (0 = va · 1 = acid · 2 = string · 3 = drum);
   anything else → null */
function avSynthKindNorm(kind) {
  if (typeof kind === "number" && isFinite(kind)) {
    const i = Math.round(kind);
    return (i >= 0 && i < AV_SYNTH_KINDS.length) ? AV_SYNTH_KINDS[i] : null;
  }
  const k = String(kind == null ? "" : kind);
  return AV_SYNTH_KINDS.indexOf(k) >= 0 ? k : null;
}

/* the ENGINE pick — always at the top of the card, data-knob-free (§6) */
const AV_SYNTH_ENGINE = {
  path: "engine.kind", id: "av-synth-engine", label: "ENGINE",
  aria: "Engine — voice architecture (va · acid · string · drum)",
};

/* ACID (§3.1) — the hero row (8) and the EXPANDED mods row (8) */
const AV_SYNTH_ACID_MAIN = [
  { path: "acid.wave", label: "WAVE", opts: { min: 0, max: 1, step: 0.01, def: 0, fmt: "pct", hint: "0 = saw · 1 = square" } },
  { path: "acid.cutoff", label: "CUTOFF", opts: { min: 20, max: 20000, step: 1, def: 800, curve: "log", fmt: "hz" } },
  { path: "acid.reso", label: "RESO", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct" } },
  { path: "acid.envMod", label: "ENV MOD", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct" } },
  { path: "acid.decay", label: "DECAY", opts: { min: 0.03, max: 3, step: 0.001, def: 0.3, curve: "log", fmt: "ms" } },
  { path: "acid.accent", label: "ACCENT", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct" } },
  { path: "acid.volume", label: "VOLUME", opts: { min: 0, max: 1, step: 0.01, def: 0.8, fmt: "pct" } },
  { path: "acid.slide", label: "SLIDE", opts: { min: 0.06, max: 0.36, step: 0.001, def: 0.06, fmt: "ms", hint: "legato glide · stock ≈ 60 ms" } },
];

const AV_SYNTH_ACID_MODS = [
  { path: "acid.accentDecay", label: "ACC DECAY", opts: { min: 0.03, max: 3, step: 0.001, def: 0.2, curve: "log", fmt: "ms", hint: "accent MEG decay" } },
  { path: "acid.veg", label: "VEG", opts: { min: 0.016, max: 3, step: 0.001, def: 3, curve: "log", fmt: "ms", hint: "VCA decay · stock ≈ 3 s" } },
  { path: "acid.filterTrack", label: "TRACKING", opts: { min: 0, max: 1, step: 0.01, def: 0, fmt: "pct", hint: "key tracking · 0 = stock 303" } },
  { path: "acid.overdrive", label: "OVERDRIVE", opts: { min: 1, max: 66.6, step: 0.1, def: 1, curve: "log", fmt: "x", hint: "1 = off" } },
  { path: "acid.muffler", label: "MUFFLER", opts: { min: 0, max: 1, step: 0.01, def: 0, fmt: "pct", hint: "post-VCA stage" } },
  { path: "acid.sweep", label: "SWEEP", opts: { min: -2, max: 2, step: 0.01, def: 0, unit: "oct", hint: "±2 oct continuous" } },
  { path: "acid.softAttack", label: "SOFT ATK", opts: { min: 0.0003, max: 0.03, step: 0.0001, def: 0.0003, curve: "log", fmt: "ms", hint: "0.3–30 ms" } },
  { path: "acid.accentMode", label: "ACC MODE", opts: { min: 0, max: 2, step: 1, def: 0, fmt: "int", hint: "0 = stock · 1–2 = sweep modes" } },
];

/* STRING (§3.2) — one exciter pick + four knobs */
const AV_SYNTH_STRING_SELECTS = [
  { path: "string.exciter", label: "EXCITER", aria: "String exciter", options: ["noise", "saw", "pulse"] },
];
const AV_SYNTH_STRING_KNOBS = [
  { path: "string.damp", label: "DAMP", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct" } },
  { path: "string.decay", label: "DECAY", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct" } },
  { path: "string.pluck", label: "PLUCK", opts: { min: 0.05, max: 0.95, step: 0.01, def: 0.3, fmt: "pct", hint: "comb injection 20–40%" } },
  { path: "string.tone", label: "TONE", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct" } },
];

/* DRUM (§3.3) — kit globals (the per-voice cells are generated from AV_SYNTH_DRUM_VOICES) */
const AV_SYNTH_DRUM_GLOBALS = [
  { path: "drum.split", label: "SPLIT", opts: { min: 0, max: 127, step: 1, def: 0, fmt: "int", hint: "0 = off · notes ≥ split play the synth" } },
  { path: "drum.volume", label: "VOLUME", opts: { min: 0, max: 1, step: 0.01, def: 0.8, fmt: "pct" } },
];

/* local escaper (same rules as avKnobEsc): this part carries no extra dependency on other parts */
const avSynthEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* one labelled select with its current option pre-selected from the live mirror */
function avSynthSelectHTML(spec) {
  const cur = avParams[spec.path];
  const opts = spec.options.map(o =>
    '<option value="' + avSynthEsc(o) + '"' + (o === cur ? " selected" : "") + ">" + avSynthEsc(o) + "</option>").join("");
  return '<label class="av-synth-pick"><span class="av-synth-pick-lbl">' + avSynthEsc(spec.label) + "</span>" +
    '<select class="av-select"' + (spec.id ? ' id="' + avSynthEsc(spec.id) + '"' : "") + ' data-param="' + avSynthEsc(spec.path) + '" aria-label="' + avSynthEsc(spec.aria) + '">' +
    opts + "</select></label>";
}

/* one knob from a spec row, one knob row from a spec table (value pre-read from the mirror) */
const avSynthKnobSpecHTML = (k) => avKnobHTML(k.path, k.label, Object.assign({ value: avParams[k.path] }, k.opts));
const avSynthKnobSpecRowHTML = (cls, knobs) => avKnobRowHTML(knobs.map(avSynthKnobSpecHTML), cls);

/* one drum voice block: caption + the three compact cells (tune · decay · level) */
function avSynthDrumVoiceHTML(v) {
  const cells = [
    { path: "drum." + v.id + ".tune", label: "TUNE", opts: { min: -12, max: 12, step: 0.1, def: 0, unit: "st", size: "sm" } },
    { path: "drum." + v.id + ".decay", label: "DECAY", opts: { min: 0.02, max: 2, step: 0.001, def: v.decay, curve: "log", fmt: "ms", size: "sm" } },
    { path: "drum." + v.id + ".level", label: "LEVEL", opts: { min: 0, max: 1, step: 0.01, def: v.level, fmt: "pct", size: "sm" } },
  ];
  return '<div class="av-drum-voice" data-voice="' + avSynthEsc(v.id) + '">' +
    '<div class="av-drum-vname">' + avSynthEsc(v.label) + "</div>" +
    avSynthKnobSpecRowHTML("av-drum-cells", cells) +
    "</div>";
}

/* one kind panel; inactive panels ship hidden with an inline display:none so the initial paint
   is correct even before the parent's stylesheet lands (avSynthSetKind keeps both in sync) */
function avSynthPanelHTML(kind, on, inner) {
  return '<div class="av-synth-panel" data-kind="' + avSynthEsc(kind) + '"' + (on ? "" : ' hidden style="display:none"') + ">" + inner + "</div>";
}

/* the whole card body: the ENGINE pick, then one panel per kind */
function avSynthBodyHTML() {
  const kind = avSynthKindNorm(avParams["engine.kind"]) || "va";

  const engineRow = '<div class="av-synth-engine-row">' + avSynthSelectHTML({
    path: AV_SYNTH_ENGINE.path, id: AV_SYNTH_ENGINE.id, label: AV_SYNTH_ENGINE.label,
    aria: AV_SYNTH_ENGINE.aria, options: AV_SYNTH_KINDS,
  }) + "</div>";

  /* va — the P1 body exactly as it shipped: selects row + one knob row per group */
  const picks = AV_SYNTH_SELECTS.map(s => avSynthSelectHTML(s)).join("");
  const rows = AV_SYNTH_ROWS.map(row => avSynthKnobSpecRowHTML(row.cls, row.knobs)).join("");
  const va = avSynthPanelHTML("va", kind === "va", '<div class="av-synth-selects">' + picks + "</div>" + rows);

  /* acid — the hero row + MODS (EXPANDED) */
  const acid = avSynthPanelHTML("acid", kind === "acid",
    avSynthKnobSpecRowHTML("av-synth-acid", AV_SYNTH_ACID_MAIN) +
    '<div class="av-synth-sec"><div class="av-synth-sec-lbl">MODS (EXPANDED)</div>' +
    avSynthKnobSpecRowHTML("av-synth-acid-mods", AV_SYNTH_ACID_MODS) + "</div>");

  /* string — exciter pick row + four knobs */
  const strPicks = AV_SYNTH_STRING_SELECTS.map(s => avSynthSelectHTML(s)).join("");
  const str = avSynthPanelHTML("string", kind === "string",
    '<div class="av-synth-selects">' + strPicks + "</div>" +
    avSynthKnobSpecRowHTML("av-synth-string", AV_SYNTH_STRING_KNOBS));

  /* drum — the 11-voice kit grid + split/volume */
  const kit = AV_SYNTH_DRUM_VOICES.map(avSynthDrumVoiceHTML).join("");
  const drum = avSynthPanelHTML("drum", kind === "drum",
    '<div class="av-drum-kit">' + kit + "</div>" +
    avSynthKnobSpecRowHTML("av-drum-globals", AV_SYNTH_DRUM_GLOBALS));

  return engineRow + va + acid + str + drum;
}

/* the shared commit path for picks/kind: mirror first, then the app-side hook (with avKnobCommit's
   av-param fallback so the card still fans out when it ships without app_core) */
function avSynthCommitValue(path, v, el) {
  avParams[path] = v;
  if (typeof avApplyParam === "function") {
    try { avApplyParam(path, v, { from: "select" }); }
    catch (e) { console.warn("[anvil] avApplyParam(" + path + ") failed", e); }
  } else {
    try { window.dispatchEvent(new CustomEvent("av-param", { detail: { path: path, value: v, el: el, from: "select" } })); }
    catch (e) { /* no fan-out */ }
  }
}

function avSynthSelectCommit(sel, path) {
  avSynthCommitValue(path, sel.value, sel);
}

function avSynthBindSelects(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll("select.av-select[data-param]").forEach(sel => {
    const path = sel.getAttribute("data-param");
    sel.addEventListener("change", () => {
      if (path === "engine.kind") { avSynthSetKind(sel.value); return; }
      avSynthSelectCommit(sel, path);
    });
  });
}

/* switch the visible kind panel. The ENGINE pick calls this on every change; it commits the kind
   exactly like the select would (mirror + avApplyParam) unless {commit:false} — the card mount
   passes false because the P1 law is "seed the mirror, never push at init; the engine replay owns
   the push". Accepts the string enum or the §2.1 ordinal. Unknown kind → false, no throw. */
function avSynthSetKind(kind, options) {
  const k = avSynthKindNorm(kind);
  if (!k) return false;
  let sel = null, host = null;
  try {
    if (typeof document !== "undefined" && document) {
      sel = document.getElementById("av-synth-engine");
      host = document.getElementById("av-synth-knobs");
    }
  } catch (e) { sel = null; host = null; }
  if (!options || options.commit !== false) avSynthCommitValue("engine.kind", k, sel);
  if (sel && sel.value !== k) sel.value = k;
  if (host && host.querySelectorAll) {
    host.querySelectorAll(".av-synth-panel[data-kind]").forEach(p => {
      const on = p.getAttribute("data-kind") === k;
      p.hidden = !on;
      p.style.display = on ? "" : "none";
      p.classList.toggle("av-kind-on", on);
    });
  }
  return true;
}

/* mount into the parent-owned host: seed the mirror first (LEVELS idiom — first paint reads
   avParams, not the markup), then render and bind, then show the current kind's panel. Seeding
   only fills unset paths so a re-mount can never clobber live values. Host absent or knob parts
   missing → false, no throw. */
function avSynthInit() {
  const host = document.getElementById("av-synth-knobs");
  if (!host) return false;
  if (typeof avKnobHTML !== "function" || typeof avKnobRowHTML !== "function" || typeof avKnobBind !== "function") return false;
  try {
    const defs = avSynthDefaults();
    for (const p in defs) {
      if (!(p in avParams)) avParams[p] = defs[p];
    }
    /* repair a value that is neither a known kind string nor a §2.1 ordinal before first paint */
    avParams["engine.kind"] = avSynthKindNorm(avParams["engine.kind"]) || "va";
    host.innerHTML = avSynthBodyHTML();
    avKnobBind(host);
    avSynthBindSelects(host);
    avSynthSetKind(avParams["engine.kind"], { commit: false });
    return true;
  } catch (e) {
    console.warn("[anvil] synth card mount failed", e);
    return false;
  }
}
