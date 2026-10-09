#!/usr/bin/env node
/* verify/av_bank_schema.mjs — canonical `.avbank.json` format module (Anvil P5 store stage, sa-2).
   Lineage: Pattern Forge `verify/synth_pack_schema.mjs` (PORT: one shared module imported by both
   the author gate and the shipping verifier "so the two can never drift"; never throws — every
   check returns path-bearing strings) + research/reuse/pack-pipeline-port-digest.md §6.1/§6.2/§8.

   What it is:
     - STATIC path/enum/hard-bound tables built from the shipped module sources (src/av_*.js):
       * hard bounds = the visible cl()/clamp literals in each setter. A value outside them is
         silently rewritten by the engine → the schema reports it as an ERROR (FAIL), and the
         witness proves the engine's own accept/refuse behaviour separately.
       * range-only params (toggle-style `.on` / `sampler.loop`, which accept any finite number and
         read truthiness — no clamp literal exists) report outside-[0,1] values as WARNINGS only.
       * enum strings are enumerated from the sources; the exact shipped spellings only.
     - Structural validators for the pinned shape (verify/_p5_wave.md §1):
         { v:1, id, meta:{name,author,license,tags,description,engine}, presets:[{name,section,
           tags,patch:{path:value},seq?}] }
     - Sanitise helpers (defensive read path for tooling: drop what the engine would refuse, never
       invent values) and a SELF-CHECK (CLI) that proves every path used by the 3 stage-0 packs is
       covered AND that the static tables still agree with the module sources (cl-literal / enum /
       toggle parity). Parity is the guard against table↔source drift: change a clamp in src/ and
       the self-check fails until the table is updated.

   LAWS preserved: never throws; errors are specific, path-bearing strings; JSON-only values
   (number|string|boolean, finite); no random-seed paths; licence discipline (author+license
   required); `mod.macroN` is page-routed (av_mod.js avModMacroIndexFromPath — exactly macro1..8).
   Run: node verify/av_bank_schema.mjs   (self-check; exit 0 = clean)                          */
"use strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ============================== constants & caps ============================== */

const AV_BANK_VERSION = 1;

/* Caps: the pin does not fix numbers (digest §Undetermined 1). Picked here: PF's dual file caps
   ported (20 MB hard / 10 MB soft; stage-0 packs are 55 KB..1.07 MB), presets cap 256 (stage-0
   reaches 100 — the digest requires >= 100), name/section/tag/description caps sized to the
   observed authoring surface with headroom. */
const AV_BANK_CAPS = Object.freeze({
  fileHard: 20 * 1024 * 1024,
  fileSoft: 10 * 1024 * 1024,
  presetsMax: 256,
  nameMax: 64,
  sectionMax: 24,
  tagsMax: 8,
  metaTagsMax: 16,
  tagMax: 32,
  descMax: 1000,
  idMax: 49,
});

const SLUG = /^[a-z0-9][a-z0-9-]{0,48}$/;

/* meta.engine has no meaning locked by the pin; the store index carries it for filtering. */
const AV_BANK_KNOWN_ENGINES = Object.freeze(["mixed", "va", "acid", "string", "drum", "grain", "sampler", "fx"]);

/* ============================== enums (from src/av_*.js) ============================== */

/* Exact accepted strings — enumerated from the shipped module sources (av_dsp OSC1_TYPES /
   WT_NAMES / SUB_WAVES / FILTER_MODES / LFO_SHAPES; av_string EXCITERS; av_fx_verb MODES;
   av_fx_delay DIVS; av_fx_mod MODES / STAGES_OK; av_fx_drive MODES; the inline engine.kind list
   in av_dsp setParam). Order is the source order so the self-check can compare deep-equal. */
const ENUMS = Object.freeze({
  OSC1_TYPES: ["saw", "square", "pulse", "tri", "sine"],
  WT_NAMES: ["wt.saw", "wt.square", "wt.tri", "wt.sine", "wt.pulse25"],
  SUB_WAVES: ["square", "sine"],
  FILTER_MODES: ["lp12", "lp24", "bp", "hp", "ladder24"],
  LFO_SHAPES: ["sine", "tri", "square", "sh"],
  ENGINE_KINDS: ["va", "acid", "string", "drum", "grain", "sampler", "fm"],
  EXCITERS: ["noise", "saw", "pulse"],
  VERB_MODES: ["plate", "fdn", "freeverb"],
  DELAY_DIVS: ["free", "1/1", "1/2", "1/4", "1/8", "1/8d", "1/16"],
  MOD_MODES: ["chorus", "ensemble", "flanger", "phaser"],
  DRIVE_MODES: ["sat", "fold", "crush"],
  MOD_STAGES: [4, 6, 8],          /* fx.mod.stages — numeric members only        */
  DRIVE_MODE_INT: [0, 2],         /* fx.drive.mode also accepts the integer 0..2 */
});

/* av_drum.js VOICE_IDS — the drum.<voice>.* family (11 voices x tune/decay/level). */
const DRUM_VOICES = Object.freeze(["kick", "snare", "rim", "clap", "ch", "oh", "lt", "mt", "ht", "crash", "ride"]);
const DRUM_VOICE_PARAMS = Object.freeze({ tune: [-12, 12], decay: [0.02, 2], level: [0, 1] });

/* Page-routed macro paths (av_mod.js avModMacroIndexFromPath: exactly mod.macro1..8). AVDSP has
   no worklet branch for them; the page rule (avApplyParam -> avModParamHit -> setMod) is the
   sanctioned acceptor — the witness probes parity against the shipped av_mod.js. */
const MOD_MACRO_RE = /^mod\.macro([1-8])$/;
const MOD_MACRO_DESC = Object.freeze({ path: "mod.macro1..8", kind: "num", hard: [0, 1], mode: "page" });

/* ============================== the path table ============================== */
/* Descriptor kinds:
     kind:"num"    hard:[lo,hi] (+ rounds:true when the setter does Math.round) — outside = FAIL
     kind:"enum"   enum:[...] (+ altInt:[lo,hi] where the setter also accepts integers)
     kind:"toggle" soft:[lo,hi] — truthiness param, no clamp literal → outside = WARN
   `mode:"page"` marks the mod.macroN paths (page funnel, not AVDSP.setParam).                  */

const PATHS = Object.create(null);
function P(pth, spec) { PATHS[pth] = Object.assign({ path: pth, mode: "engine" }, spec); }
const N = (lo, hi, extra) => Object.assign({ kind: "num", hard: [lo, hi] }, extra || {});
const NI = (lo, hi) => ({ kind: "num", hard: [lo, hi], rounds: true });
const EN = (list, extra) => Object.assign({ kind: "enum", enum: list.slice() }, extra || {});
const TOG = () => ({ kind: "toggle", soft: [0, 1] });

/* ---- av_dsp.js — VA core / filter / envelopes / LFO / voice / engine ------------------- */
P("osc1.type", EN(ENUMS.OSC1_TYPES));
P("osc1.level", N(0, 1));
P("osc1.pw", N(0.05, 0.95));
P("osc1.tune", N(-24, 24));
P("osc1.fine", N(-100, 100));
P("osc1.uni", NI(1, 7));
P("osc1.spread", N(0, 50));
P("osc2.type", EN(ENUMS.WT_NAMES));
P("osc2.level", N(0, 1));
P("osc2.tune", N(-24, 24));
P("osc2.fine", N(-100, 100));
P("osc2.uni", NI(1, 7));
P("osc2.spread", N(0, 50));
P("sub.level", N(0, 1));
P("sub.wave", EN(ENUMS.SUB_WAVES));
P("noise.level", N(0, 1));
P("filter.mode", EN(ENUMS.FILTER_MODES));
P("filter.cutoff", N(20, 20000));
P("filter.reso", N(0, 1));
P("filter.envAmt", N(-4, 4));
P("filter.ktrk", N(0, 1));
P("filter.drive", N(0, 1));
P("env1.a", N(0.001, 4));
P("env1.d", N(0.001, 8));
P("env1.s", N(0, 1));
P("env1.r", N(0.001, 8));
P("env2.a", N(0.001, 4));
P("env2.d", N(0.001, 8));
P("env2.s", N(0, 1));
P("env2.r", N(0.001, 8));
P("lfo.shape", EN(ENUMS.LFO_SHAPES));
P("lfo.rate", N(0.05, 20));
P("lfo.toCut", N(-1, 1));
P("lfo.toPitch", N(-1, 1));
P("voice.glide", N(0, 2));
P("voice.bend", N(-12, 12));
P("tune", N(-12, 12));
P("engine.outScale", N(0.05, 1));
P("engine.kind", EN(ENUMS.ENGINE_KINDS));

/* ---- av_acid.js — acid.* (contract 3.1 expanded set) ----------------------------------- */
P("acid.wave", N(0, 1));
P("acid.cutoff", N(20, 20000));
P("acid.reso", N(0, 1));
P("acid.envMod", N(0, 1));
P("acid.decay", N(0.03, 3));
P("acid.accent", N(0, 1));
P("acid.volume", N(0, 1));
P("acid.slide", N(0.06, 0.36));
P("acid.accentDecay", N(0.03, 3));
P("acid.veg", N(0.016, 3));
P("acid.filterTrack", N(0, 1));
P("acid.overdrive", N(1, 66.6));
P("acid.muffler", N(0, 1));
P("acid.sweep", N(-2, 2));
P("acid.softAttack", N(0.0003, 0.03));
P("acid.accentMode", NI(0, 2));               /* Math.round then clamp 0..2 (manual)         */

/* ---- av_string.js — string.* ------------------------------------------------------------- */
P("string.damp", N(0, 1));
P("string.decay", N(0, 1));
P("string.pluck", N(0.05, 0.95));
P("string.exciter", EN(ENUMS.EXCITERS));
P("string.tone", N(0, 1));

/* ---- av_drum.js — drum.split / drum.volume + the drum.<voice>.* family ------------------- */
P("drum.split", Object.assign(NI(0, 127), { drumIf: true }));
P("drum.volume", Object.assign(N(0, 1), { drumIf: true }));

/* ---- av_grain.js — grain.* ---------------------------------------------------------------- */
P("grain.buf", NI(0, 3));
P("grain.pos", N(0, 1));
P("grain.size", N(0.01, 0.2));
P("grain.density", N(1, 16));
P("grain.pitch", N(-24, 24));
P("grain.jitter", N(0, 1));
P("grain.spread", N(0, 1));
P("grain.vol", N(0, 1));

/* ---- av_sampler.js — sampler.* (slot 0 fallback governs when no zones) -------------------- */
P("sampler.loop", TOG());
P("sampler.loopStart", N(0, 1));
P("sampler.loopEnd", N(0, 1));
P("sampler.root", NI(0, 127));
P("sampler.tune", N(-24, 24));
P("sampler.buf", NI(0, 3));
P("sampler.vol", N(0, 1));

/* ---- av_fx_verb.js — fx.verb.* ------------------------------------------------------------ */
P("fx.verb.mode", EN(ENUMS.VERB_MODES));
P("fx.verb.on", TOG());
P("fx.verb.mix", N(0, 1));
P("fx.verb.size", N(0, 1));
P("fx.verb.decay", N(0, 1));
P("fx.verb.damp", N(0, 1));
P("fx.verb.predelay", N(0, 0.15));            /* PD_MAX = 0.15 s                             */

/* ---- av_fx_delay.js — fx.delay.* ---------------------------------------------------------- */
P("fx.delay.time", N(0.01, 2));               /* T_MIN / T_MAX                               */
P("fx.delay.spread", N(0, 1));
P("fx.delay.feedback", N(0, 0.95));           /* FB_MAX                                      */
P("fx.delay.pingpong", N(0, 1));
P("fx.delay.duck", N(0, 1));
P("fx.delay.div", EN(ENUMS.DELAY_DIVS));
P("fx.delay.bpm", N(20, 300));                /* BPM_MIN / BPM_MAX                           */
P("fx.delay.on", TOG());
P("fx.delay.mix", N(0, 1));

/* ---- av_fx_mod.js — fx.mod.* --------------------------------------------------------------- */
P("fx.mod.mode", EN(ENUMS.MOD_MODES));
P("fx.mod.rate", N(0.05, 10));                /* RATE_MIN / RATE_MAX                         */
P("fx.mod.depth", N(0, 1));
P("fx.mod.feedback", N(-0.95, 0.95));         /* FB_MIN / FB_MAX                             */
P("fx.mod.stages", EN(ENUMS.MOD_STAGES));
P("fx.mod.on", TOG());
P("fx.mod.mix", N(0, 1));

/* ---- av_fx_drive.js — fx.drive.* ------------------------------------------------------------ */
P("fx.drive.on", TOG());
P("fx.drive.mix", N(0, 1));
P("fx.drive.mode", EN(ENUMS.DRIVE_MODES, { altInt: ENUMS.DRIVE_MODE_INT.slice() }));
P("fx.drive.amount", N(0, 1));
P("fx.drive.tone", N(0, 1));
P("fx.drive.bits", NI(4, 16));
P("fx.drive.down", NI(1, 32));

/* ---- av_fx_dyn.js — fx.dyn.* ----------------------------------------------------------------- */
P("fx.dyn.on", TOG());
P("fx.dyn.mix", N(0, 1));
P("fx.dyn.eqLo", N(-15, 15));
P("fx.dyn.eqMid", N(-15, 15));
P("fx.dyn.eqHi", N(-15, 15));
P("fx.dyn.comp.thresh", N(-40, 0));
P("fx.dyn.comp.ratio", N(1, 20));
P("fx.dyn.comp.att", N(0.001, 0.3));
P("fx.dyn.comp.rel", N(0.05, 1));
P("fx.dyn.comp.makeup", N(0, 24));
P("fx.dyn.lim.ceiling", N(-6, 0));

/* ============================== lookup ============================== */

const DRUM_FAMILY_RE = /^drum\.([a-z][a-z0-9]*)\.(tune|decay|level)$/;

function lookupPath(pth) {
  try {
    if (typeof pth !== "string" || pth === "") return null;
    if (Object.prototype.hasOwnProperty.call(PATHS, pth)) return PATHS[pth];
    if (MOD_MACRO_RE.test(pth)) return MOD_MACRO_DESC;
    const m = DRUM_FAMILY_RE.exec(pth);
    if (m && DRUM_VOICES.indexOf(m[1]) >= 0) {
      const b = DRUM_VOICE_PARAMS[m[2]];
      return { path: pth, kind: "num", hard: b.slice(), mode: "engine", drumVoice: m[1] };
    }
    return null;
  } catch (e) { return null; }   /* never throw */
}

const LEVEL_OK = Object.freeze({ level: "ok" });

/* Judge ONE patch value against ONE path. Returns {level:"ok"|"warn"|"fail", reason?}. */
function checkPatchValue(pth, value) {
  try {
    const d = lookupPath(pth);
    if (!d) return { level: "fail", reason: "unknown path — not accepted by the shipped AVDSP/mod surface (any value would be refused)" };
    const page = d.mode === "page" ? " (page-routed: av_mod clamp01)" : "";

    if (d.kind === "enum") {
      if (d.enum.indexOf(value) >= 0) return LEVEL_OK;   /* exact member — strings and numeric enums alike */
      if (typeof value === "string") {
        return { level: "fail", reason: 'enum value ' + JSON.stringify(value) + " not in [" + d.enum.join(", ") + "]" };
      }
      if (typeof value === "number" && d.altInt && Math.floor(value) === value && value >= d.altInt[0] && value <= d.altInt[1]) return LEVEL_OK;
      return {
        level: "fail",
        reason: "enum path expects one of [" + d.enum.join(", ") + "]" +
          (d.altInt ? " or integer " + d.altInt[0] + ".." + d.altInt[1] : "") + " (got " + jtype(value) + ")",
      };
    }

    if (d.kind === "toggle") {
      if (typeof value === "boolean") return LEVEL_OK;
      if (typeof value === "number") {
        if (!isFinite(value)) return { level: "fail", reason: "non-finite value on a toggle path" };
        if (value < 0 || value > 1) {
          return { level: "warn", reason: "range-only param: value " + value + " outside [0,1] — engine reads truthiness (no clamp literal)" };
        }
        return LEVEL_OK;
      }
      if (typeof value === "string" && value.trim() !== "" && isFinite(Number(value))) {
        return { level: "warn", reason: "string-typed number on a toggle; engine coerces (prefer a JSON number)" };
      }
      return { level: "fail", reason: "toggle expects a number or boolean (got " + jtype(value) + ")" };
    }

    /* kind === "num" */
    let n = value;
    let coerced = null;
    if (typeof value === "boolean") { n = value ? 1 : 0; coerced = "boolean on a numeric path; engine coerces (prefer a JSON number)"; }
    else if (typeof value === "string") {
      if (value.trim() === "") return { level: "fail", reason: "empty string on a numeric path" };
      n = Number(value);
      if (!isFinite(n)) return { level: "fail", reason: "non-numeric value on a numeric path (" + JSON.stringify(value) + ")" };
      coerced = "string-typed number; engine coerces (prefer a JSON number)";
    } else if (typeof value !== "number") {
      return { level: "fail", reason: "value must be a finite number (got " + jtype(value) + ")" };
    }
    if (!isFinite(n)) return { level: "fail", reason: "non-finite number" };

    const lo = d.hard[0], hi = d.hard[1];
    if (d.rounds) {
      const r = Math.round(n);
      if (r < lo || r > hi) {
        return { level: "fail", reason: "out of hard bounds [" + lo + ", " + hi + "] (engine rounds+clamps silently; value " + n + ")" + page };
      }
      if (r !== n) return { level: "warn", reason: "value rounds to " + r + " (engine uses Math.round)" + page };
      return coerced ? { level: "warn", reason: coerced + page } : LEVEL_OK;
    }
    if (n < lo || n > hi) {
      return { level: "fail", reason: "out of hard bounds [" + lo + ", " + hi + "] (engine clamps silently; value " + n + ")" + page };
    }
    return coerced ? { level: "warn", reason: coerced + page } : LEVEL_OK;
  } catch (e) {
    return { level: "fail", reason: "check exception (never-throw guard): " + String(e && e.message || e) };
  }
}

/* ============================== small helpers ============================== */

function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function jtype(v) { return v === null ? "null" : Array.isArray(v) ? "array" : typeof v; }
function isFiniteNum(v) { return typeof v === "number" && isFinite(v); }

/* ============================== seq (light structural gate) ============================== */
/* The P4 pattern snapshot (`verify/_p4_wave.md` §4). Full admission is avSeqLoad's job (the
   witness); here: structure + the few range-only advisories. */
function validateSeqLight(seq, at) {
  const errors = [], warnings = [];
  try {
    if (!isObj(seq)) { errors.push(at + ": must be an object (P4 pattern snapshot)"); return { errors, warnings }; }
    if (seq.v !== 1) errors.push(at + ".v: must be 1 (got " + JSON.stringify(seq.v) + ")");
    if (seq.name !== undefined && typeof seq.name !== "string") warnings.push(at + ".name: expected a string");
    if (seq.bpm !== undefined && !(isFiniteNum(seq.bpm) && seq.bpm >= 20 && seq.bpm <= 300)) warnings.push(at + ".bpm: outside [20,300] (range-only; normaliser clamps)");
    if (seq.swing !== undefined && !(isFiniteNum(seq.swing) && seq.swing >= 0 && seq.swing <= 100)) warnings.push(at + ".swing: outside [0,100] (range-only)");
    if (seq.grid !== undefined && typeof seq.grid !== "string") warnings.push(at + ".grid: expected a string");
    if (seq.rng !== undefined && !isFiniteNum(seq.rng)) warnings.push(at + ".rng: expected a finite number");
    if (seq.tracks !== undefined) {
      if (!Array.isArray(seq.tracks)) errors.push(at + ".tracks: must be an array");
      else for (let t = 0; t < seq.tracks.length; t++) {
        const tr = seq.tracks[t];
        if (!isObj(tr)) { errors.push(at + ".tracks[" + t + "]: not an object"); continue; }
        if (tr.steps !== undefined && !Array.isArray(tr.steps)) { errors.push(at + ".tracks[" + t + "].steps: must be an array"); continue; }
        if (Array.isArray(tr.steps)) for (let s = 0; s < tr.steps.length; s++) {
          if (!isObj(tr.steps[s])) errors.push(at + ".tracks[" + t + "].steps[" + s + "]: not an object");
        }
      }
    }
    if (seq.plocks !== undefined && !Array.isArray(seq.plocks)) errors.push(at + ".plocks: must be an array");
    return { errors, warnings };
  } catch (e) {
    return { errors: [at + ": seq check exception (never-throw guard): " + String(e && e.message || e)], warnings };
  }
}

/* ============================== pack validation ============================== */

function validateAvBank(pack, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const errors = [], warnings = [];
  const stats = { presets: 0, patchPaths: 0, modPaths: 0, seqPresets: 0, values: 0, duplicateNames: 0 };
  const E = (m) => errors.push(m);
  const W = (m) => warnings.push(m);
  const done = () => ({ ok: errors.length === 0, errors, warnings, stats });
  try {
    if (!isObj(pack)) { E("pack: not a JSON object"); return done(); }

    if (pack.v !== AV_BANK_VERSION) E("v: must be " + AV_BANK_VERSION + " (got " + JSON.stringify(pack.v) + ")");
    if (typeof pack.id !== "string" || !SLUG.test(pack.id)) E("id: must match " + String(SLUG) + " (got " + JSON.stringify(pack.id) + ")");

    if (!isObj(pack.meta)) E("meta: missing/not an object");
    else {
      const m = pack.meta;
      if (typeof m.name !== "string" || m.name.trim() === "") E("meta.name: non-empty string required");
      else if (m.name.length > AV_BANK_CAPS.nameMax) E("meta.name: " + m.name.length + " chars > cap " + AV_BANK_CAPS.nameMax);
      if (typeof m.author !== "string" || m.author.trim() === "") E("meta.author: non-empty string required (licence discipline)");
      if (typeof m.license !== "string" || m.license.trim() === "") E("meta.license: non-empty string required (licence discipline)");
      else if (m.license !== "CC0-1.0") W('meta.license: "' + m.license + '" — stage-0 content law is CC0-1.0');
      if (m.tags === undefined) W("meta.tags: missing (the pack index builds from it)");
      else if (!Array.isArray(m.tags) || m.tags.some(t => typeof t !== "string")) E("meta.tags: must be an array of strings");
      else if (m.tags.length > AV_BANK_CAPS.metaTagsMax) E("meta.tags: " + m.tags.length + " tags > cap " + AV_BANK_CAPS.metaTagsMax);
      if (m.description === undefined) W("meta.description: missing");
      else if (typeof m.description !== "string") E("meta.description: must be a string");
      else if (m.description.length > AV_BANK_CAPS.descMax) E("meta.description: " + m.description.length + " chars > cap " + AV_BANK_CAPS.descMax);
      if (typeof m.engine !== "string" || m.engine.trim() === "") E("meta.engine: non-empty string required");
      else if (AV_BANK_KNOWN_ENGINES.indexOf(m.engine) < 0) W('meta.engine: "' + m.engine + '" not in [' + AV_BANK_KNOWN_ENGINES.join(", ") + "]");
    }

    if (!Array.isArray(pack.presets)) { E("presets: array required"); return done(); }
    if (pack.presets.length < 1) E("presets: at least 1 preset required");
    if (pack.presets.length > AV_BANK_CAPS.presetsMax) E("presets: " + pack.presets.length + " exceeds cap " + AV_BANK_CAPS.presetsMax);

    const nameFirst = Object.create(null);
    for (let i = 0; i < pack.presets.length; i++) {
      const pr = pack.presets[i];
      const at = "presets[" + i + "]";
      if (!isObj(pr)) { E(at + ": not an object"); continue; }
      const label = at + ' ("' + String(pr.name) + '")';

      if (typeof pr.name !== "string" || pr.name.trim() === "") E(label + " name: non-empty string required");
      else {
        if (pr.name.length > AV_BANK_CAPS.nameMax) E(label + " name: " + pr.name.length + " chars > cap " + AV_BANK_CAPS.nameMax);
        if (nameFirst[pr.name] !== undefined) { stats.duplicateNames++; E(label + " name: duplicate of presets[" + nameFirst[pr.name] + "]"); }
        else nameFirst[pr.name] = i;
      }
      if (typeof pr.section !== "string" || pr.section.trim() === "") E(label + " section: non-empty string required");
      else if (pr.section.length > AV_BANK_CAPS.sectionMax) E(label + " section: " + pr.section.length + " chars > cap " + AV_BANK_CAPS.sectionMax);

      if (pr.tags === undefined) W(label + " tags: missing");
      else if (!Array.isArray(pr.tags) || pr.tags.some(t => typeof t !== "string")) E(label + " tags: must be an array of strings");
      else {
        if (pr.tags.length > AV_BANK_CAPS.tagsMax) E(label + " tags: " + pr.tags.length + " tags > cap " + AV_BANK_CAPS.tagsMax);
        for (const t of pr.tags) if (t.length > AV_BANK_CAPS.tagMax) E(label + " tags: tag " + JSON.stringify(t) + " > " + AV_BANK_CAPS.tagMax + " chars");
      }

      if (!isObj(pr.patch)) E(label + " patch: object required");
      else {
        const keys = Object.keys(pr.patch);
        if (keys.length === 0) E(label + " patch: at least one path required");
        for (const k of keys) {
          stats.patchPaths++;
          const v = pr.patch[k];
          stats.values++;
          if (k.slice(0, 4) === "mod.") stats.modPaths++;
          if (/(seed|rand)/i.test(k)) { E(label + " patch." + k + ": random-seed paths are not allowed (engine PRNG is engine-owned)"); continue; }
          const res = checkPatchValue(k, v);
          if (res.level === "fail") E(label + " patch." + k + ": " + res.reason);
          else if (res.level === "warn") W(label + " patch." + k + ": " + res.reason);
        }
      }

      if (pr.seq !== undefined) {
        stats.seqPresets++;
        const sq = validateSeqLight(pr.seq, label + " seq");
        for (const e of sq.errors) E(e);
        for (const w of sq.warnings) W(w);
      }
      stats.presets++;
    }
    return done();
  } catch (e) {
    E("validation exception (never-throw guard): " + String(e && e.message || e));
    return done();
  }
}

/* File gate: empty / size caps / JSON parse failure -> error strings (never throws). */
function validateAvBankFile(buf, label, opts) {
  const out = { label: label === undefined ? "(buffer)" : String(label), pack: null, errors: [], warnings: [], stats: null, bytes: null };
  try {
    let text = null;
    if (typeof buf === "string") {
      text = buf;
      try { out.bytes = typeof Buffer !== "undefined" ? Buffer.byteLength(buf, "utf8") : buf.length; } catch (e2) { out.bytes = buf.length; }
    } else if (buf && typeof buf.length === "number" && typeof buf !== "function") {
      out.bytes = buf.length;
      if (out.bytes === 0) { out.errors.push(out.label + ": file is empty"); return out; }
      if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") text = Buffer.from(buf).toString("utf8");
      else if (typeof TextDecoder !== "undefined") text = new TextDecoder("utf-8").decode(buf);
      else { out.errors.push(out.label + ": no decoder available for binary buffer"); return out; }
    } else {
      out.errors.push(out.label + ": not a string/Buffer");
      return out;
    }
    if (typeof text === "string" && text.length > 0 && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   /* BOM */
    if (typeof text === "string" && text === "") { out.errors.push(out.label + ": file is empty"); return out; }
    if (out.bytes !== null && out.bytes > AV_BANK_CAPS.fileHard) {
      out.errors.push(out.label + ": " + out.bytes + " bytes > hard cap " + AV_BANK_CAPS.fileHard);
      return out;
    }
    if (out.bytes !== null && out.bytes > AV_BANK_CAPS.fileSoft) {
      out.warnings.push(out.label + ": " + out.bytes + " bytes > soft cap " + AV_BANK_CAPS.fileSoft);
    }
    let parsed = null;
    try { parsed = JSON.parse(text); }
    catch (e) { out.errors.push(out.label + ": JSON parse failed: " + String(e && e.message || e)); return out; }
    const res = validateAvBank(parsed, opts);
    out.pack = parsed;
    out.errors = out.errors.concat(res.errors);
    out.warnings = out.warnings.concat(res.warnings);
    out.stats = res.stats;
    return out;
  } catch (e) {
    out.errors.push(out.label + ": file gate exception (never-throw guard): " + String(e && e.message || e));
    return out;
  }
}

function readAvBankFile(filePath, opts) {
  try {
    const buf = fs.readFileSync(filePath);
    return validateAvBankFile(buf, filePath, opts);
  } catch (e) {
    return { label: String(filePath), pack: null, errors: ["read failed: " + String(e && e.message || e)], warnings: [], stats: null, bytes: null };
  }
}

/* ============================== sanitise (defensive read path) ============================== */
/* Returns a clone safe for tooling to apply: patch entries that would be refused are DROPPED
   (and reported) — no value is ever invented or rewritten. */
function sanitizePreset(preset) {
  const out = { preset: null, dropped: [], warnings: [] };
  try {
    if (!isObj(preset)) { out.dropped.push("(preset is not an object)"); return out; }
    const clean = { name: "", section: "", tags: [], patch: {} };
    if (typeof preset.name === "string") clean.name = preset.name;
    else out.dropped.push("name");
    if (typeof preset.section === "string") clean.section = preset.section;
    else out.dropped.push("section");
    if (Array.isArray(preset.tags)) clean.tags = preset.tags.filter(t => typeof t === "string");
    if (isObj(preset.patch)) {
      for (const k of Object.keys(preset.patch)) {
        const res = checkPatchValue(k, preset.patch[k]);
        if (res.level === "fail") out.dropped.push(k + ": " + res.reason);
        else {
          clean.patch[k] = preset.patch[k];
          if (res.level === "warn") out.warnings.push(k + ": " + res.reason);
        }
      }
    } else out.dropped.push("patch");
    if (preset.seq !== undefined) {
      if (isObj(preset.seq)) clean.seq = preset.seq;
      else out.dropped.push("seq (not an object)");
    }
    out.preset = clean;
    return out;
  } catch (e) {
    out.dropped.push("sanitise exception (never-throw guard): " + String(e && e.message || e));
    return out;
  }
}

function sanitizeAvBank(pack) {
  const out = { pack: null, dropped: [], warnings: [] };
  try {
    if (!isObj(pack)) { out.dropped.push("(pack is not an object)"); return out; }
    const clean = { v: AV_BANK_VERSION, id: typeof pack.id === "string" ? pack.id : "", meta: isObj(pack.meta) ? pack.meta : {}, presets: [] };
    const list = Array.isArray(pack.presets) ? pack.presets : [];
    for (let i = 0; i < list.length; i++) {
      const s = sanitizePreset(list[i]);
      if (s.preset) clean.presets.push(s.preset);
      for (const d of s.dropped) out.dropped.push("presets[" + i + "] " + d);
      for (const w of s.warnings) out.warnings.push("presets[" + i + "] " + w);
    }
    out.pack = clean;
    return out;
  } catch (e) {
    out.dropped.push("sanitise exception (never-throw guard): " + String(e && e.message || e));
    return out;
  }
}

/* ============================== coverage ============================== */

/* Every distinct patch path used by the given parsed packs is covered by the tables. */
function pathCoverage(packs) {
  const used = new Set();
  let presets = 0;
  try {
    for (const pk of (Array.isArray(packs) ? packs : [])) {
      const list = pk && Array.isArray(pk.presets) ? pk.presets : [];
      for (const pr of list) {
        presets++;
        if (!isObj(pr) || !isObj(pr.patch)) continue;
        for (const k of Object.keys(pr.patch)) used.add(k);
      }
    }
  } catch (e) { /* never throw */ }
  const uncovered = [];
  for (const k of used) if (!lookupPath(k)) uncovered.push(k);
  return { ok: uncovered.length === 0, used: used.size, uncovered, presets };
}

/* ============================== source-parity (self-check) ============================== */

const CASE_MODULE_FILES = ["av_dsp.js", "av_acid.js", "av_string.js", "av_grain.js", "av_sampler.js",
  "av_fx_verb.js", "av_fx_delay.js", "av_fx_mod.js", "av_fx_drive.js", "av_fx_dyn.js"];
const DRUM_FILE = "av_drum.js";
const MOD_FILE = "av_mod.js";

function defaultRepoRoot() {
  try { return path.dirname(path.dirname(fileURLToPath(import.meta.url))); }
  catch (e) { return process.cwd(); }
}

function extractConsts(text) {
  const out = Object.create(null);
  const groups = text.match(/const\s+[^;]+;/g) || [];
  for (const g of groups) {
    const re = /([A-Z][A-Z0-9_]*)\s*=\s*(-?[\d.]+)/g;
    let m;
    while ((m = re.exec(g))) if (out[m[1]] === undefined) out[m[1]] = parseFloat(m[2]);
  }
  return out;
}

function parseQuotedList(inner) {
  const out = [];
  const re = /"([^"]*)"/g;
  let m;
  while ((m = re.exec(inner))) out.push(m[1]);
  return out;
}

function parseNumberList(inner) {
  return inner.split(",").map(s => parseFloat(s.trim())).filter(v => isFinite(v));
}

function extractCaseBodies(text) {
  const marks = [];
  const re = /^[ \t]*(?:case\s+"([^"]+)"\s*:|default\s*:)/gm;
  let m;
  while ((m = re.exec(text))) marks.push({ path: m[1] || null, start: m.index, bodyStart: re.lastIndex });
  const out = [];
  for (let i = 0; i < marks.length; i++) {
    if (!marks[i].path) continue;
    const end = (i + 1 < marks.length) ? marks[i + 1].start : Math.min(text.length, marks[i].start + 8000);
    out.push({ path: marks[i].path, body: text.slice(marks[i].bodyStart, end) });
  }
  return out;
}

/* Facet extraction for one case body. */
function parseCaseFacets(body) {
  const f = { bounds: null, rounds: false, enumName: null, enumInline: null, enumNumName: null, toggle: false, altInt: null, accent: false };
  const cl = /cl\(\s*(?:Math\.round\()?n\)?\s*,\s*(-?[\d.]+|[A-Z][A-Z0-9_]*)\s*,\s*(-?[\d.]+|[A-Z][A-Z0-9_]*)\s*\)/.exec(body);
  if (cl) {
    f.bounds = [/^-?\d/.test(cl[1]) ? parseFloat(cl[1]) : cl[1], /^-?\d/.test(cl[2]) ? parseFloat(cl[2]) : cl[2]];
    f.rounds = /Math\.round\(n\)/.test(cl[0]);
  }
  const acc = /m < (-?[\d.]+)\)\s*m = (-?[\d.]+);\s*else if \(m > (-?[\d.]+)\)\s*m = (-?[\d.]+)/.exec(body);
  if (acc) { f.bounds = [parseFloat(acc[2]), parseFloat(acc[4])]; f.rounds = /Math\.round\(n\)/.test(body); f.accent = true; }
  const tern = /n < (-?[\d.]+) \? (-?[\d.]+) : \(n > (-?[\d.]+) \? (-?[\d.]+) : n\)/.exec(body);
  if (tern) f.bounds = [parseFloat(tern[2]), parseFloat(tern[4])];
  const em = /mapEnum\(value,\s*([A-Z][A-Z0-9_]*)\)/.exec(body);
  if (em) f.enumName = em[1];
  const emi = /mapEnum\(value,\s*\[([^\]]*)\]\)/.exec(body);
  if (emi) f.enumInline = parseQuotedList(emi[1]);
  const ei = /([A-Z][A-Z0-9_]*)\.indexOf\(String\(value\)\)/.exec(body);
  if (ei) f.enumName = ei[1];
  if (/STAGES_OK\[i\]/.test(body)) f.enumNumName = "STAGES_OK";
  const alt = />=\s*0 && n <= (\d+) && Math\.floor\(n\) === n/.exec(body);
  if (alt) f.altInt = [0, parseFloat(alt[1])];
  if (/\?\s*1\s*:\s*0/.test(body)) f.toggle = true;
  return f;
}

function collectConstEnums(text) {
  const out = Object.create(null);
  const re = /const\s+([A-Z][A-Z0-9_]*)\s*=\s*\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(text))) {
    const inner = m[2];
    if (/"/.test(inner)) out[m[1]] = parseQuotedList(inner);
    else { const nums = parseNumberList(inner); if (nums.length) out[m[1]] = nums; }
  }
  return out;
}

function normCasePath(casePath) {
  /* av_fx_verb.js strips the `fx.` prefix before its switch — map its cases onto the full path. */
  if (Object.prototype.hasOwnProperty.call(PATHS, casePath)) return casePath;
  if (Object.prototype.hasOwnProperty.call(PATHS, "fx." + casePath)) return "fx." + casePath;
  return casePath;
}

/* The full source-parity pass. Returns {errors, warnings, stats}. */
function sourceParity(repoRoot) {
  const errors = [], warnings = [];
  const stats = { casePaths: 0, parityChecked: 0, unparsed: [], drumChecked: 0, drumPaths: 0, modChecked: 0, sourceFiles: 0, unresolvedConsts: [] };
  const seenEngine = new Set();
  try {
    const srcDir = path.join(repoRoot, "src");
    /* ---- case modules ---- */
    for (const file of CASE_MODULE_FILES) {
      let text = null;
      try { text = fs.readFileSync(path.join(srcDir, file), "utf8"); }
      catch (e) { errors.push("parity: cannot read src/" + file + ": " + String(e && e.message || e)); continue; }
      stats.sourceFiles++;
      const consts = extractConsts(text);
      const constEnums = collectConstEnums(text);
      const cases = extractCaseBodies(text);
      for (const c of cases) {
        stats.casePaths++;
        const pth = normCasePath(c.path);
        const f = parseCaseFacets(c.body);
        seenEngine.add(pth);
        const t = PATHS[pth];
        if (!t) { errors.push("parity: src/" + file + ' case "' + c.path + '" has no table entry (path ' + pth + ")"); continue; }
        let facets = 0;
        /* bounds */
        if (f.bounds) {
          facets++;
          const lo = typeof f.bounds[0] === "number" ? f.bounds[0] : consts[f.bounds[0]];
          const hi = typeof f.bounds[1] === "number" ? f.bounds[1] : consts[f.bounds[1]];
          if (lo === undefined || hi === undefined) { stats.unresolvedConsts.push(pth); errors.push("parity " + pth + ": unresolved clamp symbol [" + f.bounds + "]"); }
          else if (!t.hard) errors.push("parity " + pth + ": source clamps to [" + lo + ", " + hi + "] but the table has no hard bounds");
          else if (t.hard[0] !== lo || t.hard[1] !== hi) errors.push("parity " + pth + ": bounds table [" + t.hard.join(", ") + "] != source [" + lo + ", " + hi + "]");
          if (!!t.rounds !== f.rounds) errors.push("parity " + pth + ": rounds flag table=" + !!t.rounds + " source=" + f.rounds);
        } else if (t.hard) {
          errors.push("parity " + pth + ": table claims hard bounds but the source case shows no clamp literal");
        }
        /* enums */
        let srcEnum = null;
        if (f.enumInline) srcEnum = f.enumInline;
        else if (f.enumNumName) { srcEnum = constEnums[f.enumNumName] || null; if (!srcEnum) errors.push("parity " + pth + ": cannot resolve numeric enum " + f.enumNumName); }
        else if (f.enumName) { srcEnum = constEnums[f.enumName] || null; if (!srcEnum) errors.push("parity " + pth + ": cannot resolve enum " + f.enumName); }
        if (srcEnum || f.enumName || f.enumNumName) {
          facets++;
          if (srcEnum) {
            if (!t.enum) errors.push("parity " + pth + ": source enum [" + srcEnum.join(", ") + "] but the table has none");
            else if (JSON.stringify(t.enum) !== JSON.stringify(srcEnum)) errors.push("parity " + pth + ": enum table [" + t.enum.join(", ") + "] != source [" + srcEnum.join(", ") + "]");
          }
        } else if (t.enum) {
          errors.push("parity " + pth + ": table has an enum but the source case shows none");
        }
        /* toggle */
        if (f.toggle) {
          facets++;
          if (t.kind !== "toggle") errors.push("parity " + pth + ": source is a truthiness toggle but table kind=" + t.kind);
        } else if (t.kind === "toggle") {
          errors.push("parity " + pth + ": table marks a toggle but the source case shows no `? 1 : 0` map");
        }
        /* drive-mode integer alternate */
        if (f.altInt) {
          facets++;
          if (!t.altInt || t.altInt[0] !== f.altInt[0] || t.altInt[1] !== f.altInt[1]) {
            errors.push("parity " + pth + ": altInt table [" + (t.altInt || []).join(", ") + "] != source [" + f.altInt.join(", ") + "]");
          }
        } else if (t.altInt) {
          errors.push("parity " + pth + ": table has altInt but the source case shows no integer fallback");
        }
        if (facets > 0) stats.parityChecked++; else stats.unparsed.push(pth);
      }
    }
    /* reverse: every engine-mode table entry (except the drum if-chain pair) must appear in a case */
    for (const pth of Object.keys(PATHS)) {
      if (PATHS[pth].mode !== "engine" || PATHS[pth].drumIf) continue;
      if (!seenEngine.has(pth)) errors.push("parity: table entry " + pth + " has no matching case in the sources");
    }

    /* ---- av_drum.js (if-chain: no cases) ---- */
    let drumText = null;
    try { drumText = fs.readFileSync(path.join(srcDir, DRUM_FILE), "utf8"); }
    catch (e) { errors.push("parity: cannot read src/" + DRUM_FILE + ": " + String(e && e.message || e)); }
    if (drumText) {
      const vm = /const VOICE_IDS = Object\.freeze\(\[([^\]]+)\]\)/.exec(drumText);
      const srcVoices = vm ? parseQuotedList(vm[1]) : null;
      if (!srcVoices) errors.push("parity drum: cannot extract VOICE_IDS");
      else if (JSON.stringify(srcVoices) !== JSON.stringify(DRUM_VOICES.slice())) errors.push("parity drum: VOICE_IDS table [" + DRUM_VOICES.join(", ") + "] != source [" + srcVoices.join(", ") + "]");
      const dr = (re, label) => { const m = re.exec(drumText); return m ? [parseFloat(m[1]), parseFloat(m[2])] : (errors.push("parity drum: cannot extract " + label + " clamp"), null); };
      const checks = [
        ["drum.split  (cl(Math.round(n),..))", /kext\.split = cl\(Math\.round\(n\), (-?[\d.]+), (-?[\d.]+)\)/, PATHS["drum.split"], true],
        ["drum.volume", /kext\.vol = cl\(n, (-?[\d.]+), (-?[\d.]+)\)/, PATHS["drum.volume"], false],
        ["drum.<voice>.tune", /kext\.vtune\[vi\] = cl\(n, (-?[\d.]+), (-?[\d.]+)\)/, { hard: DRUM_VOICE_PARAMS.tune }, false],
        ["drum.<voice>.decay", /kext\.vdecay\[vi\] = cl\(n, (-?[\d.]+), (-?[\d.]+)\)/, { hard: DRUM_VOICE_PARAMS.decay }, false],
        ["drum.<voice>.level", /kext\.vlevel\[vi\] = cl\(n, (-?[\d.]+), (-?[\d.]+)\)/, { hard: DRUM_VOICE_PARAMS.level }, false],
      ];
      for (const [label, re, t, rounds] of checks) {
        const b = dr(re, label);
        stats.drumChecked++;
        if (!b) continue;
        if (!t || !t.hard) { errors.push("parity drum: table missing for " + label); continue; }
        if (t.hard[0] !== b[0] || t.hard[1] !== b[1]) errors.push("parity drum: bounds " + label + " table [" + t.hard.join(", ") + "] != source [" + b.join(", ") + "]");
        if (rounds !== undefined && !!t.rounds !== rounds && label.indexOf("voice") < 0 && label.indexOf("volume") < 0) {
          /* drum.split is the only rounding one of the two explicit entries */
          errors.push("parity drum: rounds flag mismatch for " + label);
        }
      }
      stats.drumPaths = DRUM_VOICES.length * 3 + 2;
    }

    /* ---- av_mod.js (page rule) ---- */
    let modText = null;
    try { modText = fs.readFileSync(path.join(srcDir, MOD_FILE), "utf8"); }
    catch (e) { errors.push("parity: cannot read src/" + MOD_FILE + ": " + String(e && e.message || e)); }
    if (modText) {
      stats.modChecked++;
      if (modText.indexOf("^mod\\.macro([1-8])$") < 0) errors.push("parity mod: macro path regex ^mod\\.macro([1-8])$ not found in av_mod.js");
      if (modText.indexOf("Math.max(0, Math.min(1, n))") < 0) errors.push("parity mod: clamp01 body Math.max(0, Math.min(1, n)) not found in av_mod.js");
      if (!/const AV_MOD_MACRO_COUNT = 8\s*;/.test(modText)) errors.push("parity mod: AV_MOD_MACRO_COUNT = 8 not found in av_mod.js");
      if (MOD_MACRO_DESC.hard[0] !== 0 || MOD_MACRO_DESC.hard[1] !== 1) errors.push("parity mod: table clamp01 bounds != [0, 1]");
    }
    return { errors, warnings, stats };
  } catch (e) {
    errors.push("parity exception (never-throw guard): " + String(e && e.message || e));
    return { errors, warnings, stats };
  }
}

/* ============================== self-check ============================== */

/* Coverage (every path in every packs/*.avbank.json) + source parity + pack validity. */
function selfCheck(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const repoRoot = typeof o.repoRoot === "string" && o.repoRoot ? o.repoRoot : defaultRepoRoot();
  const errors = [], warnings = [];
  const stats = { packs: 0, presets: 0, usedPaths: 0, uncovered: 0, parityChecked: 0, unparsed: [], sourceFiles: 0, casePaths: 0, drumPaths: 0, modChecked: 0 };
  try {
    /* packs */
    const packsDir = path.join(repoRoot, "packs");
    let files = [];
    try { files = fs.readdirSync(packsDir).filter(f => /\.avbank\.json$/.test(f)).sort(); }
    catch (e) { errors.push("self-check: cannot read packs dir " + packsDir + ": " + String(e && e.message || e)); }
    const packs = [];
    for (const f of files) {
      const res = readAvBankFile(path.join(packsDir, f));
      stats.packs++;
      if (res.errors.length) { for (const e of res.errors.slice(0, 20)) errors.push("pack " + f + ": " + e); }
      for (const w of res.warnings.slice(0, 20)) warnings.push("pack " + f + ": " + w);
      if (res.pack) packs.push(res.pack);
    }
    /* coverage */
    const cov = pathCoverage(packs);
    stats.usedPaths = cov.used;
    stats.uncovered = cov.uncovered.length;
    stats.presets = cov.presets;
    for (const k of cov.uncovered) errors.push('coverage: pack path "' + k + '" is not covered by the tables');

    /* source parity */
    const sp = sourceParity(repoRoot);
    for (const e of sp.errors) errors.push(e);
    for (const w of sp.warnings) warnings.push(w);
    stats.parityChecked = sp.stats.parityChecked;
    stats.unparsed = sp.stats.unparsed;
    stats.sourceFiles = sp.stats.sourceFiles;
    stats.casePaths = sp.stats.casePaths;
    stats.drumChecked = sp.stats.drumChecked;
    stats.drumPaths = sp.stats.drumPaths;
    stats.modChecked = sp.stats.modChecked;
    for (const pth of sp.stats.unparsed) errors.push("parity: no facet extracted for " + pth + " (scanner gap)");
    for (const pth of sp.stats.unresolvedConsts) errors.push("parity: unresolved constant for " + pth);

    return { ok: errors.length === 0, errors, warnings, stats, repoRoot };
  } catch (e) {
    errors.push("self-check exception (never-throw guard): " + String(e && e.message || e));
    return { ok: false, errors, warnings, stats, repoRoot };
  }
}

/* ============================== exports ============================== */

export {
  AV_BANK_VERSION, AV_BANK_CAPS, AV_BANK_KNOWN_ENGINES, SLUG,
  ENUMS, DRUM_VOICES, DRUM_VOICE_PARAMS, MOD_MACRO_RE, MOD_MACRO_DESC,
  PATHS,
  lookupPath, checkPatchValue,
  validateSeqLight, validateAvBank, validateAvBankFile, readAvBankFile,
  sanitizePreset, sanitizeAvBank,
  pathCoverage, sourceParity, selfCheck, defaultRepoRoot,
};

/* ============================== CLI (self-check) ============================== */

const IS_MAIN = (() => { try { return /(^|[\\/])av_bank_schema\.mjs$/.test(process.argv[1] || ""); } catch (e) { return false; } })();

if (IS_MAIN) {
  try {
    const res = selfCheck({ repoRoot: defaultRepoRoot() });
    console.log("== av_bank_schema self-check ==");
    console.log("repo: " + res.repoRoot);
    console.log("packs: " + res.stats.packs + " (" + res.stats.presets + " presets) · paths used " +
      res.stats.usedPaths + " (uncovered " + res.stats.uncovered + ")");
    console.log("source parity: " + res.stats.sourceFiles + " module sources — " +
      res.stats.casePaths + " case paths checked (" + res.stats.parityChecked + " with facets) + " +
      res.stats.drumChecked + " drum clamp assertions (" + res.stats.drumPaths + " drum paths) + " +
      res.stats.modChecked + " av_mod block · unparsed " + res.stats.unparsed.length);
    if (res.errors.length) {
      console.log("errors: " + res.errors.length);
      for (const e of res.errors.slice(0, 40)) console.log("  FAIL  " + e);
      if (res.errors.length > 40) console.log("  ... (" + (res.errors.length - 40) + " more)");
    } else console.log("errors: 0");
    if (res.warnings.length) {
      console.log("warnings: " + res.warnings.length);
      for (const w of res.warnings.slice(0, 20)) console.log("  WARN  " + w);
    }
    console.log(res.ok ? "AV BANK SCHEMA SELF-CHECK: PASS" : "AV BANK SCHEMA SELF-CHECK: FAIL");
    process.exit(res.ok ? 0 : 1);
  } catch (e) {
    console.error("av_bank_schema CLI exception (never-throw guard): " + String(e && e.stack || e));
    process.exit(1);
  }
}
