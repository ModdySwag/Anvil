/* Anvil — SYNTH card (P1 voice engine, P2 ENGINE layer, P3 grain + sampler panels). avSynthInit() mounts the engine
   controls into the parent-owned host #av-synth-knobs:
   - one ENGINE select (#av-synth-engine — va · acid · string · drum · grain · sampler) at the
     top of the card, committing engine.kind through avApplyParam;
   - one panel per kind, a <div class="av-synth-panel" data-kind=...> section shown/hidden by
     the exported avSynthSetKind(kind):
       va     = the P1 body, unchanged: selects row (osc1 wave · osc2 wave · filter mode) plus
                one knob row per group — OSC (mix/unison/sub), FILTER (cutoff/reso/env amount),
                ENV (env1 ADSR), VOICE (glide + LFO rate + LFO→CUT).
       acid   = §3.1: the eight hero knobs + the eight-knob "MODS (EXPANDED)" group.
       string = §3.2: damp · decay · pluck · exciter pick · tone.
       drum   = §3.3: 11 voices x {tune, decay, level} in a compact 3-column kit grid, plus
                drum.split + drum.volume.
       grain   = P3 §5 (KIND 4): buf · pos · size · density · pitch · jitter · spread · vol.
       sampler = P3 §6 (KIND 5): buf · root · tune · loop · loopStart · loopEnd · vol.
   All knobs ride the standard avKnob mechanics (avKnobCommit → avApplyParam); selects commit
   directly through avApplyParam. Defaults mirror verify/_p1_wave.md §4.2 (va),
   verify/_p2_wave.md §3.1–3.3 (kinds) and the P3 pins in verify/_p3_wave.md §5/§6 (grain,
   sampler — ranges pinned there; defaults documented in avSynthDefaults below) — the single
   source of truth for paths/ranges/defaults. No persistence: a fresh page always starts on
   those defaults. */
"use strict";

const AV_SYNTH_VERSION = "p3.0";   /* P3: grain + sampler kind panels (KIND 4/5) */

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

/* the path→default table for every control this card mounts (§4.2 va + §3.1–3.3 kinds +
   P3 §5/§6 grain/sampler). avSynthDefaults() hands out a fresh copy — the parent may reuse it
   when replaying the mirror into the engine at boot. */
function avSynthDefaults() {
  const d = {
    /* va — the P1 defaults (§4.2), unchanged */
    "osc1.type": "saw",
    "osc1.level": 1.0,
    "osc1.uni": 1,
    "osc1.spread": 12,
    "osc1.tune": 0,
    "osc1.fine": 0,
    "osc2.type": "wt.saw",
    "osc2.level": 0.5,
    "osc2.tune": 0,
    "osc2.fine": 0,
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
    "lfo.shape": "sine",
    "lfo.toPitch": 0,
    /* engine + kind panels (§3.1–3.3) */
    "engine.kind": "va",
    /* R23: the kind-filter gate (one engine filter, one set of values -- filter.mode / cutoff /
       reso / envAmt above). 0 = off: the string/drum/grain/sampler voices render unfiltered and
       the new stage is skipped entirely; the va and acid cores never read it. */
    "filter.on": 0,
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
  /* P3 grain (§5, KIND 4) — ranges pinned in verify/_p3_wave.md §5; defaults documented here
     (the worklet voices read these through the normal replay path):
       buf 0 · pos 0 · size 0.1 s (100 ms, centre of the pinned 10–200 ms Hann window) ·
       density 4 (low end of the docs/03 §2.1 "overlap 4–8" band, well under the 24-grain
       hard budget) · pitch 0 st · jitter 0 (deterministic until dialed) · spread 0.5
       (centred, moderate stereo width) · vol 0.8 (house engine-volume convention). */
  d["grain.buf"] = 0;
  d["grain.pos"] = 0;
  d["grain.size"] = 0.1;
  d["grain.density"] = 4;
  d["grain.pitch"] = 0;
  d["grain.jitter"] = 0;
  d["grain.spread"] = 0.5;
  d["grain.vol"] = 0.8;
  /* P3 sampler (§6, KIND 5) — ranges pinned in verify/_p3_wave.md §6; defaults documented here:
       buf 0 · root 60 (C4 — playback rate runs from key/root) · tune 0 st · loop 0 (one-shot
       until switched; 1 = loop) · loopStart 0 · loopEnd 1 (full-buffer loop) · vol 0.8. */
  d["sampler.buf"] = 0;
  d["sampler.root"] = 60;
  d["sampler.tune"] = 0;
  d["sampler.loop"] = 0;
  d["sampler.loopStart"] = 0;
  d["sampler.loopEnd"] = 1;
  d["sampler.vol"] = 0.8;
  return d;
}

/* the three waveform/mode picks — plain <select class="av-select"> (the parent skins them) */
const AV_SYNTH_SELECTS = [
  { path: "osc1.type", label: "OSC1", aria: "Oscillator 1 waveform", options: ["saw", "square", "pulse", "tri", "sine"] },
  { path: "osc2.type", label: "OSC2", aria: "Oscillator 2 wavetable (factory + your own tables)", options: ["wt.saw", "wt.square", "wt.tri", "wt.sine", "wt.pulse25"], optionsFn: avSynthWtOptions },
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
  /* R9: per-oscillator pitch — coarse (±24 st) + fine (±100 ct), the industry-standard pair.
     C3-5: this row is one of the VA panel's two deep groups (the other is GLIDE) and folds. */
  { cls: "av-synth-tune", sect: "tune", label: "TUNE", knobs: [
    { path: "osc1.tune", label: "OSC1 PITCH", opts: { min: -24, max: 24, step: 1, def: 0, unit: "st" } },
    { path: "osc1.fine", label: "OSC1 FINE", opts: { min: -100, max: 100, step: 1, def: 0, fmt: "ct" } },
    { path: "osc2.tune", label: "OSC2 PITCH", opts: { min: -24, max: 24, step: 1, def: 0, unit: "st" } },
    { path: "osc2.fine", label: "OSC2 FINE", opts: { min: -100, max: 100, step: 1, def: 0, fmt: "ct" } },
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
  { cls: "av-synth-mod", sect: "glide", label: "GLIDE", knobs: [
    { path: "voice.glide", label: "GLIDE", opts: { min: 0, max: 2, step: 0.001, def: 0, fmt: "ms" } },
  ] },
];

/* the six engine kinds (§2.1 + P3 §5/§6) — the card shows one panel per kind; the ordinal
   mapping (0 = va · 1 = acid · 2 = string · 3 = drum · 4 = grain · 5 = sampler) matches the
   worklet registerKind ids (KIND 4/5, per verify/_p3_wave.md §5/§6) */
const AV_SYNTH_KINDS = ["va", "acid", "string", "drum", "grain", "sampler", "fm"];

/* accept the string enum or the §2.1/P3 ordinal (0 = va · 1 = acid · 2 = string · 3 = drum ·
   4 = grain · 5 = sampler); anything else → null */
function avSynthKindNorm(kind) {
  if (typeof kind === "number" && isFinite(kind)) {
    const i = Math.round(kind);
    return (i >= 0 && i < AV_SYNTH_KINDS.length) ? AV_SYNTH_KINDS[i] : null;
  }
  const k = String(kind == null ? "" : kind);
  if (AV_SYNTH_KINDS.indexOf(k) >= 0) return k;
  return (avSynthUserKindNames().indexOf(k) >= 0) ? k : null;
}

/* S5: user kind modules (av_code/av_umod_wl) appear as ENGINE options; av_code calls the refresh
   on kind add/remove. Names only live while the engine tier can host them. */
function avSynthUserKindNames() {
  try {
    if (typeof avCodeKinds === "function") {
      const ks = avCodeKinds();
      if (ks && ks.length) return ks.map(k => String((k && k.name) || "")).filter(Boolean);
    }
  } catch (e) { /* code engine absent — no user kinds */ }
  return [];
}
function avSynthKindOptionsRefresh() {
  try {
    const sel = document.getElementById("av-synth-engine");
    if (!sel) return false;
    [...sel.querySelectorAll("option")].forEach(o => { if (o.dataset.userKind === "1") o.remove(); });
    for (const n of avSynthUserKindNames()) {
      if (![...sel.options].some(o => o.value === n)) {
        const o = document.createElement("option");
        o.value = n; o.textContent = n; o.dataset.userKind = "1";
        sel.appendChild(o);
      }
    }
    return true;
  } catch (e) { return false; }
}

/* M1: the OSC2 pick offers your installed wavetables after the factory five */
function avSynthWtOptions() {
  const base = ["wt.saw", "wt.square", "wt.tri", "wt.sine", "wt.pulse25"];
  try {
    if (typeof avWtUserOscNames === "function") {
      const extra = avWtUserOscNames();
      if (extra && extra.length) return base.concat(extra.map(x => String((x && x.value) || x)).filter(Boolean));
    }
  } catch (e) { /* wavetable editor absent — factory five only */ }
  return base;
}
function avSynthOscOptionsRefresh() {
  try {
    const sel = document.querySelector('select[data-param="osc2.type"]');
    if (!sel) return false;
    [...sel.querySelectorAll("option")].forEach(o => { if (o.dataset.userWt === "1") o.remove(); });
    for (const name of avSynthWtOptions()) {
      if (![...sel.options].some(o => o.value === name)) {
        const o = document.createElement("option");
        o.value = name; o.textContent = name; o.dataset.userWt = "1";
        sel.appendChild(o);
      }
    }
    const cur = avParams["osc2.type"];
    if (typeof cur === "string" && [...sel.options].some(o => o.value === cur)) sel.value = cur;
    return true;
  } catch (e) { return false; }
}

/* the ENGINE pick — always at the top of the card, data-knob-free (§6) */
const AV_SYNTH_ENGINE = {
  path: "engine.kind", id: "av-synth-engine", label: "ENGINE",
  aria: "Engine — voice architecture (va · acid · string · drum · grain · sampler · fm)",
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

/* GRAIN (P3 §5, KIND 4) — the granular voice: 8 knobs, ranges pinned in verify/_p3_wave.md §5.
   Defaults (documented; mirrored in avSynthDefaults — keep the two in lockstep):
     buf 0 → slot 0 (first registered sample) · pos 0 → buffer start ·
     size 0.1 → 100 ms Hann, centre of the pinned 10–200 ms · density 4 → 4 overlapping grains
     (low end of the docs/03 §2.1 "overlap 4–8" band, well under the 24-grain hard budget) ·
     pitch 0 st → untransposed · jitter 0 → deterministic cloud until dialed ·
     spread 0.5 → centred, moderate stereo width · vol 0.8 → house engine-volume convention. */
const AV_SYNTH_GRAIN_KNOBS = [
  { path: "grain.buf", label: "BUF", opts: { min: 0, max: 3, step: 1, def: 0, fmt: "int", hint: "sample slot 0–3" } },
  { path: "grain.pos", label: "POS", opts: { min: 0, max: 1, step: 0.01, def: 0, fmt: "pct", hint: "playhead 0–1 of buffer" } },
  { path: "grain.size", label: "SIZE", opts: { min: 0.01, max: 0.2, step: 0.001, def: 0.1, fmt: "ms", hint: "Hann grain 10–200 ms" } },
  { path: "grain.density", label: "DENSITY", opts: { min: 1, max: 16, step: 1, def: 4, fmt: "int", hint: "overlapping grains · budget 24" } },
  { path: "grain.pitch", label: "PITCH", opts: { min: -24, max: 24, step: 0.1, def: 0, unit: "st" } },
  { path: "grain.jitter", label: "JITTER", opts: { min: 0, max: 1, step: 0.01, def: 0, fmt: "pct", hint: "position randomness (seeded)" } },
  { path: "grain.spread", label: "SPREAD", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct", hint: "stereo width" } },
  { path: "grain.vol", label: "VOL", opts: { min: 0, max: 1, step: 0.01, def: 0.8, fmt: "pct" } },
];

/* SAMPLER (P3 §6, KIND 5) — the one-shot/loop voice: 7 knobs, ranges pinned in
   verify/_p3_wave.md §6. Defaults (documented; mirrored in avSynthDefaults — keep in lockstep):
     buf 0 → slot 0 · root 60 → C4 root key (playback rate = key/root) · tune 0 st ·
     loop 0 → one-shot until switched (1 = loop) · loopStart 0 → buffer start ·
     loopEnd 1 → buffer end (full-buffer loop) · vol 0.8. */
const AV_SYNTH_SAMPLER_KNOBS = [
  { path: "sampler.buf", label: "BUF", opts: { min: 0, max: 3, step: 1, def: 0, fmt: "int", hint: "sample slot 0–3" } },
  { path: "sampler.root", label: "ROOT", opts: { min: 0, max: 127, step: 1, def: 60, fmt: "int", hint: "root key · 60 = C4" } },
  { path: "sampler.tune", label: "TUNE", opts: { min: -24, max: 24, step: 0.1, def: 0, unit: "st" } },
  { path: "sampler.loop", label: "LOOP", opts: { min: 0, max: 1, step: 1, def: 0, fmt: "int", hint: "0 = one-shot · 1 = loop" } },
  { path: "sampler.loopStart", label: "LOOP ST", opts: { min: 0, max: 1, step: 0.01, def: 0, fmt: "pct", hint: "loop start 0–1 of buffer" } },
  { path: "sampler.loopEnd", label: "LOOP END", opts: { min: 0, max: 1, step: 0.01, def: 1, fmt: "pct", hint: "loop end 0–1 of buffer" } },
  { path: "sampler.vol", label: "VOL", opts: { min: 0, max: 1, step: 0.01, def: 0.8, fmt: "pct" } },
];

/* R23: the shared engine filter appended to the kind panels (string / drum / grain / sampler).
   One engine filter, one set of values: these controls drive the same filter.* params the VA
   core reads. The pick and the three knob specs are the VA group's exact specs (reconciled
   against AV_SYNTH_ROWS), led by the filter.on gate at the head of the knob row:
     filter.on 0 = off (kind voices render unfiltered, the new stage is skipped) / 1 = on.
   The group is append-only per panel; the VA and ACID panels are untouched. */
const AV_SYNTH_KIND_FILTER_SELECT = { path: "filter.mode", label: "FILTER", aria: "Filter mode", options: ["lp12", "lp24", "bp", "hp"] };
const AV_SYNTH_KIND_FILTER_KNOBS = [
  { path: "filter.on", label: "ON", opts: { min: 0, max: 1, step: 1, def: 0, fmt: "int", hint: "0 = off, 1 = on" } },
  { path: "filter.cutoff", label: "CUTOFF", opts: { min: 20, max: 20000, step: 1, def: 800, curve: "log", fmt: "hz" } },
  { path: "filter.reso", label: "RESO", opts: { min: 0, max: 1, step: 0.01, def: 0.3, fmt: "pct" } },
  { path: "filter.envAmt", label: "ENV AMT", opts: { min: -4, max: 4, step: 0.1, def: 2, unit: "oct" } },
];

/* local escaper (same rules as avKnobEsc): this part carries no extra dependency on other parts */
const avSynthEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* one labelled select with its current option pre-selected from the live mirror */
function avSynthSelectHTML(spec) {
  const cur = avParams[spec.path];
  const list = (typeof spec.optionsFn === "function") ? spec.optionsFn() : spec.options;
  const opts = list.map(o =>
    '<option value="' + avSynthEsc(o) + '"' + (o === cur ? " selected" : "") + ">" + avSynthEsc(o) + "</option>").join("");
  return '<label class="av-synth-pick"><span class="av-synth-pick-lbl">' + avSynthEsc(spec.label) + "</span>" +
    '<select class="av-select"' + (spec.id ? ' id="' + avSynthEsc(spec.id) + '"' : "") + ' data-param="' + avSynthEsc(spec.path) + '" aria-label="' + avSynthEsc(spec.aria) + '">' +
    opts + "</select></label>";
}

/* one knob from a spec row, one knob row from a spec table (value pre-read from the mirror) */
const avSynthKnobSpecHTML = (k) => avKnobHTML(k.path, k.label, Object.assign({ value: avParams[k.path] }, k.opts));
const avSynthKnobSpecRowHTML = (cls, knobs) => avKnobRowHTML(knobs.map(avSynthKnobSpecHTML), cls);

/* R23: the appended FILTER group for the kind panels -- the VA filter pick row (built with
   avSynthSelectHTML) plus the shared filter knob row led by the ON gate (avSynthKnobSpecRowHTML),
   so the four kind groups look native and can never drift from one another. */
const avSynthKindFilterHTML = () =>
  '<div class="av-synth-selects">' + avSynthSelectHTML(AV_SYNTH_KIND_FILTER_SELECT) + "</div>" +
  avSynthKnobSpecRowHTML("av-synth-filter", AV_SYNTH_KIND_FILTER_KNOBS);

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
    aria: AV_SYNTH_ENGINE.aria, options: AV_SYNTH_KINDS.concat(avSynthUserKindNames()),
  }) + "</div>";

  /* va — the P1 body exactly as it shipped: selects row + one knob row per group. C3-5: the
     deep rows carry a head (label + fold toggle) and the panel pairs its rows side by side. */
  const picks = AV_SYNTH_SELECTS.map(s => avSynthSelectHTML(s)).join("");
  const rows = AV_SYNTH_ROWS.map(row => {
    const body = avSynthKnobSpecRowHTML(row.cls, row.knobs);
    if (!row.sect) return body;
    return '<div class="av-synth-sec" data-sect="' + avSynthEsc(row.sect) + '">' +
      '<div class="av-synth-sec-head"><span class="av-synth-sec-lbl">' + avSynthEsc(row.label) + "</span></div>" +
      body + "</div>";
  }).join("");
  const va = avSynthPanelHTML("va", kind === "va", '<div class="av-synth-selects">' + picks + "</div>" + rows + avSynthEnvSectionHTML());

  /* acid — the hero row + MODS (EXPANDED) */
  const acid = avSynthPanelHTML("acid", kind === "acid",
    avSynthKnobSpecRowHTML("av-synth-acid", AV_SYNTH_ACID_MAIN) +
    '<div class="av-synth-sec"><div class="av-synth-sec-lbl">MODS (EXPANDED)</div>' +
    avSynthKnobSpecRowHTML("av-synth-acid-mods", AV_SYNTH_ACID_MODS) + "</div>");

  /* string — exciter pick row + four knobs */
  const strPicks = AV_SYNTH_STRING_SELECTS.map(s => avSynthSelectHTML(s)).join("");
  const str = avSynthPanelHTML("string", kind === "string",
    '<div class="av-synth-selects">' + strPicks + "</div>" +
    avSynthKnobSpecRowHTML("av-synth-string", AV_SYNTH_STRING_KNOBS) +
    avSynthKindFilterHTML());

  /* drum — the 11-voice kit grid + split/volume */
  const kit = AV_SYNTH_DRUM_VOICES.map(avSynthDrumVoiceHTML).join("");
  const drum = avSynthPanelHTML("drum", kind === "drum",
    '<div class="av-drum-kit">' + kit + "</div>" +
    avSynthKnobSpecRowHTML("av-drum-globals", AV_SYNTH_DRUM_GLOBALS) +
    avSynthKindFilterHTML());

  /* grain — the P3 granular voice knobs (§5, KIND 4) */
  const grain = avSynthPanelHTML("grain", kind === "grain",
    avSynthKnobSpecRowHTML("av-synth-grain", AV_SYNTH_GRAIN_KNOBS) +
    avSynthKindFilterHTML());

  /* sampler — the P3 sampler voice knobs (§6, KIND 5) */
  const smpl = avSynthPanelHTML("sampler", kind === "sampler",
    avSynthKnobSpecRowHTML("av-synth-sampler", AV_SYNTH_SAMPLER_KNOBS) +
    avSynthKindFilterHTML());

  /* fm — the operators live on the FM card; the panel keeps the kind switch legible */
  const fmp = avSynthPanelHTML("fm", kind === "fm",
    '<p class="av-note av-dim">Six-operator FM — the operator grid, algorithms and envelopes live on the FM card above.</p>' +
    avSynthKindFilterHTML());

  return engineRow + va + acid + str + drum + grain + smpl + fmp;
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

/* switch the visible kind panel (all six kinds: va/acid/string/drum/grain/sampler — the P3
   panels ride the same generic data-kind show/hide). The ENGINE pick calls this on every change;
   it commits the kind exactly like the select would (mirror + avApplyParam) unless {commit:false}
   — the card mount passes false because the P1 law is "seed the mirror, never push at init; the
   engine replay owns the push". Accepts the string enum or the §2.1/P3 ordinal. Unknown kind →
   false, no throw. */
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

/* ---------- C3-5 disclosure (the MIX/MIDI/FX contract, fourth card) ---------- */

/* The VA panel's deep rows fold behind one chip each: OSC + FILTER + ENV stay on the face, TUNE
   (the pitch pair) and GLIDE are one click away. The chip row lives INSIDE the panel (so a kind
   switch takes it with it), and the section head carries the fold-back toggle. */
const AV_SYNTH_ADV = [["tune", "TUNE"], ["glide", "GLIDE"], ["envscreen", "ENVELOPES"]];

function avSynthFoldInit(root) {
  if (!root || typeof root.querySelector !== "function" || typeof document === "undefined") return false;
  const panel = root.querySelector('.av-synth-panel[data-kind="va"]');
  if (!panel || panel.querySelector(".av-synth-adv")) return false;
  const anchor = panel.querySelector(".av-synth-selects");
  if (!anchor) return false;
  const row = document.createElement("div");
  row.className = "av-synth-adv";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "folded engine groups");
  AV_SYNTH_ADV.forEach(function (pair) {
    const name = pair[0], label = pair[1];
    const sec = panel.querySelector('.av-synth-sec[data-sect="' + name + '"]');
    if (!sec) return;
    const head = sec.querySelector(".av-synth-sec-head");
    if (!head || head.querySelector(".av-sec-toggle")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "av-sec-toggle";
    btn.textContent = "▸";
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "av-adv-chip";
    chip.dataset.adv = name;
    chip.textContent = label;
    function sync() {
      const folded = sec.classList.contains("av-sec-collapsed");
      chip.hidden = !folded;
      chip.setAttribute("aria-expanded", folded ? "false" : "true");
      chip.title = "Show the " + label + " controls";
      chip.setAttribute("aria-label", chip.title);
      btn.textContent = folded ? "▸" : "▾";
      btn.setAttribute("aria-expanded", folded ? "false" : "true");
      btn.title = (folded ? "Show the " : "Hide the ") + label + " controls";
      btn.setAttribute("aria-label", btn.title);
    }
    chip.addEventListener("click", function () { sec.classList.remove("av-sec-collapsed"); sync(); });
    btn.addEventListener("click", function () { sec.classList.toggle("av-sec-collapsed"); sync(); });
    sec.classList.add("av-sec-collapsed");
    head.appendChild(btn);
    row.appendChild(chip);
    sync();
  });
  if (anchor.nextSibling) panel.insertBefore(row, anchor.nextSibling); else panel.appendChild(row);
  return true;
}

/* mount into the parent-owned host: seed the mirror first (LEVELS idiom — first paint reads
   avParams, not the markup), then render and bind, then show the current kind's panel. Seeding
   only fills unset paths so a re-mount can never clobber live values. Host absent or knob parts
   missing → false, no throw. */
/* ---------- C3-13 screen 2: the envelopes group (folded) ---------- */

/* The engine has TWO envelopes (env1 = amp, env2 = filter; av_dsp.js carries no aux env), so the
   overlay draws the two real ones in their own colours. The VA line is full at 1280, so the screen
   folds behind the ENVELOPES chip: folded = 0px, open = one 104px block the user asked for. */
const AV_SYNTH_ENV_SECT = "envscreen";
function avSynthEnvSectionHTML() {
  return '<div class="av-synth-sec av-sec-collapsed" data-sect="' + AV_SYNTH_ENV_SECT + '">' +
    '<div class="av-synth-sec-head"><span class="av-synth-sec-lbl">ENVELOPES</span></div>' +
    '<div class="av-synth-envview">' +
    '<canvas class="av-synth-envcanvas" aria-label="Amp and filter envelopes - drag left to right for attack, decay, release; up and down for sustain"></canvas>' +
    '<span class="av-synth-envview-cap">A 2ms . D 300ms . S 80 . R 200ms</span></div></div>';
}
function avSynthEnvMs(v) {
  const s2 = Number(v) || 0;
  if (s2 >= 1) return s2.toFixed(1) + "s";
  return Math.round(s2 * 1000) + "ms";
}
function avSynthEnvPaintOne(ctx, w, h, col, a, d, sus, r, dpr) {
  const tot = Math.max(0.001, a + d + r);
  const holdShare = 0.24, span = 1 - holdShare;
  const xa = (a / tot) * span * w, xd = xa + (d / tot) * span * w;
  const xs = xd + holdShare * w, xr = xs + (r / tot) * span * w;
  const base = h - 6 * dpr, top = 6 * dpr;
  const ys = top + (1 - sus) * (base - top);
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(1, 1.6 * dpr);
  ctx.beginPath();
  ctx.moveTo(1, base);
  ctx.lineTo(Math.max(2, xa), top);
  ctx.lineTo(Math.max(xa + 1, xd), ys);
  ctx.lineTo(Math.max(xd + 2, xs), ys);
  ctx.lineTo(Math.max(xs + 1, xr), base);
  ctx.stroke();
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(Math.max(2, xa), top, 2 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.globalAlpha = 1;
}
function avSynthEnvPaint(canvas) {
  try {
    if (!canvas || typeof canvas.getContext !== "function") return false;
    const box = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    const cssW = Math.max(80, Math.round((box && box.width) || 300));
    const cssH = Math.max(40, Math.round((box && box.height) || 72));
    const dpr = Math.max(1, Math.min(3, (typeof window !== "undefined" && window.devicePixelRatio) || 1));
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const P = function (path, def) { return Number((typeof avParams !== "undefined" && avParams && avParams[path] != null) ? avParams[path] : def); };
    avSynthEnvPaintOne(ctx, canvas.width, canvas.height, "#2ed8c9", P("env1.a", 0.002), P("env1.d", 0.3), Math.max(0, Math.min(1, P("env1.s", 0.8))), P("env1.r", 0.2), dpr);
    avSynthEnvPaintOne(ctx, canvas.width, canvas.height, "#ff8f6e", P("env2.a", 0.002), P("env2.d", 0.3), Math.max(0, Math.min(1, P("env2.s", 0.8))), P("env2.r", 0.2), dpr);
    return true;
  } catch (e) { return false; }
}
function avSynthEnvSync(hostArg) {
  try {
    const host = hostArg || document.getElementById("av-synth-knobs");
    if (!host || typeof host.querySelectorAll !== "function") return false;
    const P = function (path, def) { return Number((typeof avParams !== "undefined" && avParams && avParams[path] != null) ? avParams[path] : def); };
    const cap = "A " + avSynthEnvMs(P("env1.a", 0.002)) + " . D " + avSynthEnvMs(P("env1.d", 0.3)) +
      " . S " + Math.round(Math.max(0, Math.min(1, P("env1.s", 0.8))) * 100) + " . R " + avSynthEnvMs(P("env1.r", 0.2));
    host.querySelectorAll(".av-synth-envview").forEach(function (box) {
      const canvas = box.querySelector(".av-synth-envcanvas");
      if (canvas) avSynthEnvPaint(canvas);
      const lab = box.querySelector(".av-synth-envview-cap");
      if (lab && lab.textContent !== cap) lab.textContent = cap;
    });
    return true;
  } catch (e) { return false; }
}
function avSynthEnvSet(path, v) {
  try {
    avParams[path] = v;
    if (typeof avApplyParam === "function") avApplyParam(path, v, { from: "envscreen" });
    else if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("av-param", { detail: { path: path, value: v, from: "envscreen" } }));
    const host = document.getElementById("av-synth-knobs");
    if (host && typeof avKnobRefreshAll === "function") avKnobRefreshAll(host);
    /* a folded section has no box to measure: repaint shortly after the chip opens it */
    try {
      const chip = host.querySelector('.av-synth-adv .av-adv-chip[data-adv="envscreen"]');
      if (chip && chip.dataset.avEnvRepaint !== "1") {
        chip.dataset.avEnvRepaint = "1";
        chip.addEventListener("click", function () { setTimeout(function () { try { avSynthEnvSync(host); } catch (e4) { } }, 40); });
      }
    } catch (e5) { /* repaint is a nicety */ }
    avSynthEnvSync(host);
    return true;
  } catch (e) { return false; }
}
function avSynthEnvInit(hostArg) {
  try {
    const host = hostArg || document.getElementById("av-synth-knobs");
    if (!host || typeof host.querySelectorAll !== "function") return false;
    host.querySelectorAll(".av-synth-envview").forEach(function (box) {
      const canvas = box.querySelector(".av-synth-envcanvas");
      if (!canvas || typeof canvas.addEventListener !== "function" || canvas.dataset.avEnvWired === "1") return;
      canvas.dataset.avEnvWired = "1";
      let drag = false;
      const at = function (e) {
        const r = canvas.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
        const y = Math.max(0, Math.min(1, (e.clientY - r.top) / Math.max(1, r.height)));
        if (x < 0.34) avSynthEnvSet("env1.a", Math.round(Math.max(0.001, Math.min(4, 0.001 + (x / 0.34) * 4)) * 1000) / 1000);
        else if (x < 0.67) avSynthEnvSet("env1.d", Math.round(Math.max(0.001, Math.min(8, 0.001 + ((x - 0.34) / 0.33) * 8)) * 1000) / 1000);
        else avSynthEnvSet("env1.r", Math.round(Math.max(0.001, Math.min(8, 0.001 + ((x - 0.67) / 0.33) * 8)) * 1000) / 1000);
        avSynthEnvSet("env1.s", Math.round((1 - y) * 100) / 100);
      };
      canvas.addEventListener("pointerdown", function (e) { drag = true; try { canvas.setPointerCapture(e.pointerId); } catch (err) { } at(e); e.preventDefault(); });
      canvas.addEventListener("pointermove", function (e) { if (drag) { at(e); e.preventDefault(); } });
      canvas.addEventListener("pointerup", function () { drag = false; });
      canvas.addEventListener("pointercancel", function () { drag = false; });
      /* a folded section has no box; the observer paints the moment the chip opens it (the click
         hook alone proved unreliable - the section is visible a frame later than the event) */
      try {
        if (typeof ResizeObserver === "function" && !box.__avEnvRO) {
          box.__avEnvRO = new ResizeObserver(function () { try { avSynthEnvSync(host); } catch (e6) { } });
          box.__avEnvRO.observe(box);
        }
      } catch (e7) { /* observer is a nicety */ }
    });
    avSynthEnvSync(host);
    return true;
  } catch (e) { return false; }
}

/* ---------- C3-12 screen 1: the filter response inset ---------- */

/* The VA panel's filter row is 194px of three pots; the panel is 944 wide at 1280, so the screen
   rides the SAME flex line as a shrinkable item (flex 0 1 186px, min 96) and takes whatever width
   is left — no absolute positioning, no new row, nothing blocked. The curve law is the inspector's
   (av_inspector.js avInspectorPaintFilter): the compact mirror lives there, this is where you drag. */
function avSynthFiltFreq(v) {
  const t = Math.max(0, Math.min(1, v));
  return 40 * Math.pow(300, t);
}
function avSynthFiltPos(f) {
  return Math.log(Math.max(40, Math.min(12000, f)) / 40) / Math.log(300);
}
function avSynthFiltLabel(cut, reso, mode) {
  const m = (mode === "lp24") ? "LP24" : (mode === "bp") ? "BP" : (mode === "hp") ? "HP" : "LP";
  const c = cut >= 1000 ? (cut / 1000).toFixed(1) + "k" : String(Math.round(cut));
  return m + " " + c + " R" + Math.round(reso * 100);
}
function avSynthFiltScreenHTML() {
  return '<div class="av-synth-filtscreen" data-av-filt="1">' +
    '<canvas class="av-synth-filtcanvas" aria-label="Filter response — drag across for cutoff, up for resonance"></canvas>' +
    '<span class="av-synth-filtscreen-cap">LP 800 R30</span></div>';
}
function avSynthFiltPaint(canvas) {
  try {
    if (!canvas || typeof canvas.getContext !== "function") return false;
    const box = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    const cssW = Math.max(60, Math.round((box && box.width) || 120));
    const cssH = Math.max(28, Math.round((box && box.height) || 56));
    const dpr = Math.max(1, Math.min(3, (typeof window !== "undefined" && window.devicePixelRatio) || 1));
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const w = canvas.width, h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cut = Number((typeof avParams !== "undefined" && avParams && avParams["filter.cutoff"]) || 800);
    const reso = Math.max(0, Math.min(1, Number((typeof avParams !== "undefined" && avParams && avParams["filter.reso"]) || 0)));
    const mode = String((typeof avParams !== "undefined" && avParams && avParams["filter.mode"]) || "lp12");
    const fc = Math.max(0, Math.min(1, avSynthFiltPos(cut)));
    const base = h - 4 * dpr, top = 4 * dpr, amp = (base - top) * 0.78;
    ctx.strokeStyle = "#2ed8c9"; ctx.lineWidth = Math.max(1, 1.4 * dpr);
    ctx.beginPath();
    for (let i = 0; i <= 140; i++) {
      const t = i / 140;
      let mag = 1 / Math.sqrt(1 + Math.pow(t / Math.max(0.02, fc), 4));
      if (mode === "lp24") mag = mag * mag;
      if (mode === "hp") mag = Math.sqrt(Math.max(0, 1 - 1 / (1 + Math.pow(t / Math.max(0.02, fc), 4))));
      const bump = reso * 0.9 * Math.exp(-Math.pow((t - fc) / Math.max(0.03, 0.10 + reso * 0.10), 2));
      mag = Math.min(1.35, mag + bump * (t > fc * 0.4 ? 1 : 0.35));
      const y = base - mag * amp;
      if (i === 0) ctx.moveTo(0, y); else ctx.lineTo(t * w, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.moveTo(fc * w, top); ctx.lineTo(fc * w, base); ctx.stroke();
    ctx.globalAlpha = 1;
    return true;
  } catch (e) { return false; }
}
function avSynthFiltSync(hostArg) {
  try {
    const host = hostArg || document.getElementById("av-synth-knobs");
    if (!host || typeof host.querySelectorAll !== "function") return false;
    const cut = Number((typeof avParams !== "undefined" && avParams && avParams["filter.cutoff"]) || 800);
    const reso = Math.max(0, Math.min(1, Number((typeof avParams !== "undefined" && avParams && avParams["filter.reso"]) || 0)));
    const mode = String((typeof avParams !== "undefined" && avParams && avParams["filter.mode"]) || "lp12");
    const cap = avSynthFiltLabel(cut, reso, mode);
    host.querySelectorAll(".av-synth-filtscreen").forEach((box) => {
      const canvas = box.querySelector(".av-synth-filtcanvas");
      if (canvas) avSynthFiltPaint(canvas);
      const lab = box.querySelector(".av-synth-filtscreen-cap");
      if (lab && lab.textContent !== cap) lab.textContent = cap;
    });
    return true;
  } catch (e) { return false; }
}
function avSynthFiltSet(path, v) {
  try {
    avParams[path] = v;
    if (typeof avApplyParam === "function") avApplyParam(path, v, { from: "filtscreen" });
    else if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("av-param", { detail: { path: path, value: v, from: "filtscreen" } }));
    const host = document.getElementById("av-synth-knobs");
    if (host && typeof avKnobRefreshAll === "function") avKnobRefreshAll(host);
    avSynthFiltSync(host);
    return true;
  } catch (e) { return false; }
}
function avSynthFiltInit(hostArg) {
  try {
    const host = hostArg || document.getElementById("av-synth-knobs");
    if (!host || typeof host.querySelectorAll !== "function") return false;
    host.querySelectorAll(".av-synth-filter").forEach((row) => {
      /* the screen is a PANEL-level flex item, not a knob-row child: inside the row it grew the row
         by its own width and pushed ENV onto a second line at 1280 (the paired-row trap again). */
      const panel = row.parentNode;
      if (!panel || panel.querySelector(".av-synth-filtscreen")) return;
      panel.insertAdjacentHTML("beforeend", avSynthFiltScreenHTML());
      const box = panel.querySelector(".av-synth-filtscreen");
      const canvas = box ? box.querySelector(".av-synth-filtcanvas") : null;
      if (!canvas || typeof canvas.addEventListener !== "function") return;
      let drag = false;
      const at = (e) => {
        const r = canvas.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
        const y = Math.max(0, Math.min(1, (e.clientY - r.top) / Math.max(1, r.height)));
        avSynthFiltSet("filter.cutoff", Math.round(avSynthFiltFreq(x)));
        avSynthFiltSet("filter.reso", Math.round((1 - y) * 100) / 100);
      };
      canvas.addEventListener("pointerdown", (e) => { drag = true; try { canvas.setPointerCapture(e.pointerId); } catch (err) { } at(e); e.preventDefault(); });
      canvas.addEventListener("pointermove", (e) => { if (drag) { at(e); e.preventDefault(); } });
      canvas.addEventListener("pointerup", () => { drag = false; });
      canvas.addEventListener("pointercancel", () => { drag = false; });
    });
    avSynthFiltSync(host);
    return true;
  } catch (e) { return false; }
}

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
    try { avSynthFoldInit(host); } catch (e) { /* deep groups stay up */ }
    avKnobBind(host);
    avSynthBindSelects(host);
    try { avSynthFiltInit(host); } catch (e) { /* the screen is an inset, never the card */ }
    try { avSynthEnvInit(host); } catch (e) { /* the envelope screen folds, never the card */ }
    try {
      if (!window.__avFiltHook) {
        window.__avFiltHook = 1;
        window.addEventListener("av-param", (ev) => {
          const p = ev && ev.detail && ev.detail.path;
          if (typeof p === "string" && p.indexOf("filter.") === 0) { try { avSynthFiltSync(); } catch (e2) { } }
          if (typeof p === "string" && p.indexOf("env1.") === 0) { try { avSynthEnvSync(); } catch (e3) { } }
        });
      }
    } catch (e3) { /* no window */ }
    avSynthSetKind(avParams["engine.kind"], { commit: false });
    try { avSynthOscOptionsRefresh(); } catch (e) { /* osc options are best-effort */ }
    return true;
  } catch (e) {
    console.warn("[anvil] synth card mount failed", e);
    return false;
  }
}
