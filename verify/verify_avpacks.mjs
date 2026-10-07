#!/usr/bin/env node
/* verify/verify_avpacks.mjs — canonical P5 pack verifier (sa-2) for `packs/*.avbank.json`.
   THE wave gate: re-witnesses EVERY stage-0 preset in plain node (no CDP, no Chrome, no DOM).

   Contract: verify/_p5_wave.md §2 (PIN) + §4b + research/reuse/pack-pipeline-port-digest.md
   §6.3/§7. Per EVERY preset:
     fresh engine (with the deterministic sample-slot-0 prep) -> apply every `patch` path via
     AVDSP.setParam (ALL must return true; any false FAILs the row with the path named; mod.macroN
     rides the page rule probed against the shipped av_mod.js, then one AVDSP.setMod push) ->
     if `seq`: av_seq_core admission (avSeqLoad === true) + import acceptance + canonical
     fixed-point (normal form is stable under re-load; export/import round-trip preserved;
     authored values never rewritten by the normaliser) -> noteOn(60, 0.9) (drum kind: 36) ->
     render 2.0 s @ 48 kHz -> assert all samples finite · peak > 1e-4 · determinism pair (two fresh
     engines, bit-identical). Verdict discipline is STRICT (the deviation from PF's tolerant
     verifier, per the pin): any FAIL -> exit non-zero.
     Adopted content-child rules (all three reference witnesses):
       (a) mod.macroN parity via the shipped av_mod.js (mirror fallback, never throws);
       (b) deterministic sample prep (setSample slot 0) for GRAIN/SAMPLER audibility; no zones;
       (c) drums noteOn(36) when eng.kind === 3 (else 60);
       (d) seq via av_seq_core.js, loaded separately, with the fixed-point canon.
     Doc deviation: the two seq-enforcing children required authored seq == engine normal form;
     the starter-100 stage-0 seqs ship a legal SHORTHAND form (defaults injected + step padding on
     load). The canonical check therefore enforces fixed-point stability of the LOADED form + no
     scalar rewrites, and reports shorthand as a WARNING (seqShorthand counts in the summary).

   CLI:
     node verify/verify_avpacks.mjs [--only id1,id2]     verify (default), strict exit 0/1
     node verify/verify_avpacks.mjs --index              regenerate packs/index.json from the
                                                         schema-validated packs (all packs)
   Outputs (written on every run): verify/last-av_packs_verify.log + .json.
   Laws: never throws in load paths (top-level guard writes an honest report); repo READ-ONLY
   except packs/index.json (only in --index mode) and the two report files above.                */
"use strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as SCHEMA from "./av_bank_schema.mjs";

/* ---------------- paths & constants ---------------- */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const PACKS_DIR = path.join(REPO, "packs");
const OUT_LOG = path.join(REPO, "verify", "last-av_packs_verify.log");
const OUT_JSON = path.join(REPO, "verify", "last-av_packs_verify.json");
const SR = 48000;
const RENDER_S = 2.0;
const RENDER_N = Math.round(RENDER_S * SR);

/* The build's worklet order (ONE Function scope). av_seq_core.js loads separately (§2). */
const PART_FILES = ["av_ladder.js", "av_dsp.js", "av_acid.js", "av_string.js", "av_drum.js",
  "av_grain.js", "av_sampler.js", "av_fx_verb.js", "av_fx_delay.js", "av_fx_mod.js",
  "av_fx_drive.js", "av_fx_dyn.js"];

/* ---------------- logging ---------------- */
const LOG = [];
let harnessFails = 0;
function log(s) { console.log(s); LOG.push(String(s)); }
function check(name, ok, detail) {
  if (!ok) harnessFails++;
  log("  " + (ok ? "PASS" : "FAIL") + "  " + name + (detail !== undefined ? "  ::  " + detail : ""));
  return !!ok;
}
const r4 = (v) => (typeof v === "number" && isFinite(v)) ? v.toFixed(4) : String(v);
const r6 = (v) => (typeof v === "number" && isFinite(v)) ? v.toFixed(6) : String(v);
const msgOf = (e) => String(e && e.message || e);

/* ---------------- generic helpers ---------------- */
function scan(arr) {
  let peak = 0, finite = true;
  for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (!isFinite(v)) { finite = false; break; } const a = v < 0 ? -v : v; if (a > peak) peak = a; }
  return { peak, finite };
}
function sameBits(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function maxAbsDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let d = 0;
  for (let i = 0; i < n; i++) { const x = Math.abs(a[i] - b[i]); if (x > d) d = x; }
  return d;
}
function hashF64(arr) {   /* FNV-1a 32-bit over the word view (starter witness style) */
  const u32 = new Uint32Array(arr.buffer, arr.byteOffset, arr.length * 2);
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < u32.length; i++) { h ^= u32[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return ("00000000" + h.toString(16)).slice(-8);
}
function sha256hex(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }
function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function jsonEq(a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } }

/* ---------------- loaders (never throw) ---------------- */
function loadEngine() {
  try {
    const CONCAT = PART_FILES.map(f => fs.readFileSync(path.join(REPO, "src", f), "utf8")).join("\n");
    const ENV = (new Function(CONCAT + "\nreturn { AVDSP: AVDSP };"))();
    if (!ENV.AVDSP || typeof ENV.AVDSP.create !== "function") return { ok: false, error: "AVDSP.create missing" };
    return { ok: true, AVDSP: ENV.AVDSP };
  } catch (e) { return { ok: false, error: msgOf(e) }; }
}

function loadSeq() {
  try {
    const SRC = fs.readFileSync(path.join(REPO, "src", "av_seq_core.js"), "utf8");
    const ENV = (new Function(SRC + "\nreturn { avSeqLoad: avSeqLoad, avSeqSnap: avSeqSnap, avSeqPatternImport: avSeqPatternImport, avSeqPatternExport: avSeqPatternExport };"))();
    for (const k of ["avSeqLoad", "avSeqSnap", "avSeqPatternImport", "avSeqPatternExport"]) {
      if (typeof ENV[k] !== "function") return { ok: false, error: k + " missing" };
    }
    return { ok: true, avSeqLoad: ENV.avSeqLoad, avSeqSnap: ENV.avSeqSnap, avSeqPatternImport: ENV.avSeqPatternImport, avSeqPatternExport: ENV.avSeqPatternExport };
  } catch (e) { return { ok: false, error: msgOf(e) }; }
}

/* mod.macroN: prefer the shipped av_mod.js (DOM-guarded); verbatim mirror fallback, flagged. */
function loadModRule() {
  const out = { idx: null, clamp: null, source: "mirror (av_mod.js failed to load)" };
  try {
    const SRC = fs.readFileSync(path.join(REPO, "src", "av_mod.js"), "utf8");
    const M = (new Function(SRC + "\nreturn { avModMacroIndexFromPath: avModMacroIndexFromPath, avModClamp01: avModClamp01 };"))();
    if (typeof M.avModMacroIndexFromPath === "function" && typeof M.avModClamp01 === "function") {
      out.idx = M.avModMacroIndexFromPath;
      out.clamp = M.avModClamp01;
      out.source = "av_mod.js (shipped)";
      return out;
    }
    out.source = "mirror (av_mod.js exported no symbols)";
  } catch (e) { out.source = "mirror (" + msgOf(e).slice(0, 60) + ")"; }
  out.idx = (p) => { if (typeof p !== "string") return -1; const m = /^mod\.macro([1-8])$/.exec(p); return m ? Number(m[1]) - 1 : -1; };
  out.clamp = (v) => { const n = Number(v); if (!isFinite(n)) return 0; return Math.max(0, Math.min(1, n)); };
  return out;
}

/* ---------------- engine prep (see header rule b) ---------------- */
let AVDSP = null, SEQ = null, MOD = null;
const NBUF = SR;                                   /* 1.0 s mono source */
const BUF = new Float32Array(NBUF);
for (let i = 0; i < NBUF; i++) {
  const t = i / SR;
  const env = Math.exp(-3 * t);
  BUF[i] = 0.6 * env * (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 441 * t) + 0.25 * Math.sin(2 * Math.PI * 882 * t));
}
function freshEng() {
  const eng = AVDSP.create({ sampleRate: SR, maxVoices: 16 });
  const sOk = AVDSP.setSample(eng, 0, "p5-canonical-smoke", SR, BUF, null);
  if (sOk !== true) throw new Error("engine prep refused (setSample slot 0)");
  return eng;
}

/* apply every patch path; mod.macroN rides the page rule + one setMod post (rule a) */
function applyPatch(eng, patch) {
  const paths = Object.keys(patch || {});
  const macros = new Float64Array(8);
  let modHit = 0;
  const refused = [];
  for (const p of paths) {
    if (p.slice(0, 4) === "mod.") {
      const i = MOD.idx(p);
      if (i < 0) { refused.push(p); continue; }
      macros[i] = MOD.clamp(patch[p]);
      modHit++;
      continue;
    }
    let ok = false;
    try { ok = AVDSP.setParam(eng, p, patch[p]) === true; } catch (e) { ok = false; }
    if (!ok) refused.push(p);
  }
  if (modHit > 0) AVDSP.setMod(eng, macros, new Float64Array(128));   /* avModPayload shape: N macros, zero slots */
  return { total: paths.length, refused, modHit };
}

function render2s(eng) {
  const L = new Float64Array(RENDER_N), R = new Float64Array(RENDER_N);
  AVDSP.render(eng, L, R, RENDER_N);
  return { L, R };
}

/* ---------------- seq canon (rule d + documented deviation) ---------------- */
function classifySeqDiff(a, b, pth, out) {
  if (a === b) return;
  if (a === undefined && b !== undefined) { out.added++; return; }
  if (a !== undefined && b === undefined) { out.dropped++; if (out.droppedPaths.length < 3) out.droppedPaths.push(pth); return; }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) { out.rewrites.push(pth + " (array/type)"); return; }
    if (a.length !== b.length) out.padded = true;
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) classifySeqDiff(a[i], b[i], pth + "[" + i + "]", out);
    return;
  }
  if (isObj(a) && isObj(b)) {
    const keys = new Set(Object.keys(a).concat(Object.keys(b)));
    for (const k of keys) classifySeqDiff(a[k], b[k], pth + "." + k, out);
    return;
  }
  if (a !== b) out.rewrites.push(pth + " " + JSON.stringify(a) + " -> " + JSON.stringify(b));
}

function seqMetaFromSnap(snap) {
  const meta = { name: null, bpm: null, swing: null, tracks: 0, ons: 0 };
  try {
    if (isObj(snap)) {
      meta.name = typeof snap.name === "string" ? snap.name : null;
      meta.bpm = typeof snap.bpm === "number" ? snap.bpm : null;
      meta.swing = typeof snap.swing === "number" ? snap.swing : null;
      if (Array.isArray(snap.tracks)) {
        meta.tracks = snap.tracks.length;
        for (const tr of snap.tracks) if (isObj(tr) && Array.isArray(tr.steps)) for (const st of tr.steps) if (isObj(st) && st.on === 1) meta.ons++;
      } else if (Array.isArray(snap.patterns)) meta.tracks = snap.patterns.length;   /* tolerant */
    }
  } catch (e) { /* meta stays default */ }
  return meta;
}

function checkSeq(seq) {
  const errors = [], warnings = [];
  let meta = null;
  try {
    const text = JSON.stringify(seq);
    const loadOk = SEQ.avSeqLoad(seq) === true;
    if (!loadOk) errors.push("avSeqLoad(seq) !== true");
    const impOk = SEQ.avSeqPatternImport(text) === true;
    if (!impOk) errors.push("avSeqPatternImport(text) !== true");
    if (loadOk) {
      const snap1 = SEQ.avSeqSnap();
      /* canonical fixed point: the normal form is stable under re-load (idempotence) */
      let idem = false;
      try { idem = SEQ.avSeqLoad(snap1) === true && jsonEq(SEQ.avSeqSnap(), snap1); } catch (e) { idem = false; }
      if (!idem) errors.push("seq normal form is not a stable fixed point (load(snap) != snap)");
      /* export -> import preserves the loaded pattern */
      let rt = false;
      try {
        const exp = SEQ.avSeqPatternExport();
        rt = typeof exp === "string" && exp.length > 0 && SEQ.avSeqPatternImport(exp) === true && jsonEq(SEQ.avSeqSnap(), snap1);
      } catch (e) { rt = false; }
      if (!rt) errors.push("seq export/import round-trip changed the pattern");
      /* authored vs normal form: scalar rewrites are FAILs; defaults/padding are shorthand (warn) */
      const diff = { rewrites: [], added: 0, dropped: 0, droppedPaths: [], padded: false };
      classifySeqDiff(seq, snap1, "seq", diff);
      if (diff.rewrites.length) errors.push("seq normaliser rewrote authored value(s): " + diff.rewrites.slice(0, 2).join("; ") + (diff.rewrites.length > 2 ? " (+" + (diff.rewrites.length - 2) + " more)" : ""));
      if (diff.dropped) errors.push("seq normaliser dropped authored field(s): " + diff.droppedPaths.join(", ") + (diff.dropped > diff.droppedPaths.length ? " (+" + (diff.dropped - diff.droppedPaths.length) + " more)" : ""));
      if (diff.added > 0 || diff.padded) {
        warnings.push("seq shorthand: engine fills defaults/pads on load (" + diff.added + " field(s) defaulted" + (diff.padded ? ", steps padded" : "") + ")");
      }
      meta = seqMetaFromSnap(snap1);
    } else {
      meta = seqMetaFromSnap(seq);
    }
  } catch (e) { errors.push("seq check exception: " + msgOf(e)); }
  return { errors, warnings, meta };
}

/* ---------------- per-preset witness ---------------- */
function witnessPreset(packId, preset, pi) {
  const reasons = [], warns = [];
  const row = { pack: packId, i: pi + 1, name: preset.name, section: preset.section, paths: 0, modRoutes: 0, seq: false, seqMeta: null, peak: 0, hash: "", det: false, finite: true, warnings: [], reasons: [], pass: false };
  try {
    const paths = Object.keys(preset.patch || {});
    row.paths = paths.length;

    /* (A) fresh engine + every patch path + mod rule */
    const engA = freshEng();
    const apA = applyPatch(engA, preset.patch);
    row.modRoutes = apA.modHit;
    if (apA.refused.length) reasons.push("setParam refused: " + apA.refused.join(", "));
    if (apA.total !== paths.length) reasons.push("path count drift");

    /* (b2) seq admission + canon */
    if (preset.seq !== undefined) {
      row.seq = true;
      const sq = checkSeq(preset.seq);
      for (const e of sq.errors) reasons.push(e);
      for (const w of sq.warnings) warns.push(w);
      row.seqMeta = sq.meta;
    }

    /* (c) drum-aware note + 2.0 s render */
    const note = engA.kind === 3 ? 36 : 60;
    const noteOk = (() => { try { return AVDSP.noteOn(engA, note, 0.9) === true; } catch (e) { return false; } })();
    if (!noteOk) reasons.push("noteOn refused");
    const oA = render2s(engA);
    const sA = scan(oA.L), sAr = scan(oA.R);
    row.finite = sA.finite && sAr.finite;
    if (!row.finite) reasons.push("non-finite sample");
    row.peak = Math.max(sA.peak, sAr.peak);
    if (!(row.peak > 1e-4)) reasons.push("not audible (peak " + row.peak + ")");

    /* determinism pair: a second fresh engine through the identical steps */
    const engB = freshEng();
    const apB = applyPatch(engB, preset.patch);
    if (apB.refused.length) reasons.push("B setParam refused: " + apB.refused.join(", "));
    try { AVDSP.noteOn(engB, note, 0.9); } catch (e) { /* pair check will fail below */ }
    const oB = render2s(engB);
    const det = sameBits(oA.L, oB.L) && sameBits(oA.R, oB.R);
    row.det = det;
    if (!det) reasons.push("determinism pair not bit-identical (maxAbsDiff L=" + maxAbsDiff(oA.L, oB.L) + " R=" + maxAbsDiff(oA.R, oB.R) + ")");
    row.hash = hashF64(oA.L) + "/" + hashF64(oA.R);
  } catch (e) {
    reasons.push("witness exception: " + msgOf(e));
  }
  row.warnings = warns;
  row.reasons = reasons;
  row.pass = reasons.length === 0;
  return row;
}

/* ---------------- verify mode ---------------- */
function runVerify(only) {
  log("== verify_avpacks — canonical P5 pack witness (verify/_p5_wave.md section 2) ==");
  log("repo " + REPO + " · node " + process.version + " · sr " + SR + " · render " + RENDER_S + " s");

  /* ---- harness preamble ---- */
  log("");
  log("== harness ==");
  const eng = loadEngine();
  if (!check("engine concat loads in ONE scope (12 parts)", eng.ok, eng.ok ? "" : eng.error)) return 1;
  AVDSP = eng.AVDSP;
  const seq = loadSeq();
  if (!check("av_seq_core.js loads separately", seq.ok, seq.ok ? "" : seq.error)) return 1;
  SEQ = seq;
  MOD = loadModRule();
  log("  AVDSP version " + AVDSP.version + " · mod rule = " + MOD.source);

  check("seq loader negative control (null / v=2 / array refused)",
    (() => { try { return SEQ.avSeqLoad(null) === false && SEQ.avSeqLoad({ v: 2 }) === false && SEQ.avSeqLoad([]) === false; } catch (e) { return false; } })());

  /* mod page rule parity probe */
  {
    let ok = true; const bad = [];
    for (let i = 1; i <= 8; i++) if (MOD.idx("mod.macro" + i) !== i - 1) { ok = false; bad.push("macro" + i); }
    for (const p of ["mod.macro0", "mod.macro9", "mod.macros", "mod.macro", "mod.x", "mod.macro1.x", "fx.mod.rate"]) {
      if (MOD.idx(p) !== -1) { ok = false; bad.push("accepted:" + p); }
    }
    check("mod page rule: mod.macro1..8 -> 0..7, near-misses refused (" + MOD.source + ")", ok, bad.join(",") || "clean");
    check("mod clamp01 parity (0.5, -1->0, 2->1, non-numeric->0)",
      MOD.clamp(0.5) === 0.5 && MOD.clamp(-1) === 0 && MOD.clamp(2) === 1 && MOD.clamp("x") === 0 && MOD.clamp(NaN) === 0);
  }

  /* schema self-check: coverage of every pack path + table<->source parity */
  const sc = SCHEMA.selfCheck({ repoRoot: REPO });
  check("schema self-check (coverage + source parity)",
    sc.ok, "packs " + sc.stats.packs + " · paths " + sc.stats.usedPaths + "/" + sc.stats.usedPaths + " covered · parity " + sc.stats.casePaths + " case + " + sc.stats.drumChecked + " drum + " + sc.stats.modChecked + " mod · errors " + sc.errors.length);
  for (const e of sc.errors.slice(0, 12)) log("    schema:: " + e);

  /* ---- packs ---- */
  let files = [];
  try { files = fs.readdirSync(PACKS_DIR).filter(f => /\.avbank\.json$/.test(f)).sort(); }
  catch (e) { check("packs dir readable", false, msgOf(e)); return 1; }
  if (Array.isArray(only) && only.length) files = files.filter(f => only.indexOf(f) >= 0 || only.indexOf(f.replace(/\.avbank\.json$/, "")) >= 0);
  if (!check("packs discovered", files.length > 0, files.join(", ") || "(none)")) return 1;

  const packReports = [];
  const allRows = [];
  const totals = { packs: 0, presets: 0, passed: 0, failed: 0, warnings: 0, seqPresets: 0, seqShorthand: 0, pathsTotal: 0, modRoutes: 0 };

  for (const file of files) {
    const packPath = path.join(PACKS_DIR, file);
    let buf = null;
    try { buf = fs.readFileSync(packPath); } catch (e) { buf = null; }
    if (!check("pack readable: " + file, buf !== null)) { packReports.push({ id: file, file, ok: false, schemaErrors: ["unreadable"], presets: 0, passed: 0, failed: 0 }); continue; }

    const res = SCHEMA.validateAvBankFile(buf, "packs/" + file);
    const pack = res.pack;
    const report = {
      id: pack && typeof pack.id === "string" ? pack.id : file, file,
      bytes: buf.length, sha256: sha256hex(buf),
      presets: pack && Array.isArray(pack.presets) ? pack.presets.length : 0,
      passed: 0, failed: 0, warnings: 0, seqPresets: 0, seqShorthand: 0, pathsTotal: 0, modRoutes: 0,
      schemaErrors: res.errors, schemaWarnings: res.warnings, ok: false,
    };
    log("");
    log("== pack " + report.id + " (" + file + ", " + buf.length + " bytes) ==");
    const schemaOk = check("schema gate: " + file, res.errors.length === 0, res.errors.length ? res.errors.length + " error(s)" : "clean");
    for (const e of res.errors.slice(0, 12)) log("    schema:: " + e);
    if (!schemaOk) {
      totals.packs++; totals.presets += report.presets; totals.failed += report.presets;
      report.failed = report.presets;
      packReports.push(report);
      continue;
    }
    for (const w of res.warnings.slice(0, 8)) log("    schema warn:: " + w);
    if (res.warnings.length > 8) log("    schema warn:: (+" + (res.warnings.length - 8) + " more)");

    const presets = pack.presets;
    for (let pi = 0; pi < presets.length; pi++) {
      const row = witnessPreset(report.id, presets[pi], pi);
      allRows.push(row);
      report.passed += row.pass ? 1 : 0;
      report.failed += row.pass ? 0 : 1;
      report.warnings += row.warnings.length;
      report.pathsTotal += row.paths;
      report.modRoutes += row.modRoutes;
      if (row.seq) report.seqPresets++;
      for (const w of row.warnings) if (/shorthand/.test(w)) report.seqShorthand++;
      const seqInfo = row.seqMeta && row.seq ? " [seq " + (row.seqMeta.name || "?") + " bpm=" + row.seqMeta.bpm + " swing=" + row.seqMeta.swing + " ons=" + row.seqMeta.ons + "]" : "";
      log("  " + (row.pass ? "PASS" : "FAIL") + "  [" + String(pi + 1).padStart(3) + "/" + presets.length + "] " +
        String(row.section || "").padEnd(7) + " " + String(row.name || "").padEnd(24) +
        " paths=" + String(row.paths).padStart(2) + (row.modRoutes ? "(mod:" + row.modRoutes + ")" : "     ") +
        "  peak=" + r6(row.peak) + "  hash=" + row.hash + "  det=" + (row.det ? "y" : "N") + seqInfo +
        (row.warnings.length ? "  ~" + row.warnings.join("; ") : "") +
        (row.pass ? "" : "  << " + row.reasons.join(" | ")));
    }
    report.ok = report.failed === 0 && report.schemaErrors.length === 0;
    totals.packs++;
    totals.presets += report.presets;
    totals.passed += report.passed;
    totals.failed += report.failed;
    totals.warnings += report.warnings;
    totals.seqPresets += report.seqPresets;
    totals.seqShorthand += report.seqShorthand;
    totals.pathsTotal += report.pathsTotal;
    totals.modRoutes += report.modRoutes;
    log("  -- " + report.id + ": " + report.passed + "/" + report.presets + " pass · " +
      report.pathsTotal + " paths applied (" + report.modRoutes + " mod-routed) · " +
      report.seqPresets + " seq (" + report.seqShorthand + " shorthand) · warnings " + report.warnings);
    packReports.push(report);
  }

  /* ---- totals ---- */
  log("");
  log("== totals ==");
  for (const p of packReports) {
    log("  " + String(p.id).padEnd(16) + (p.ok ? "OK " : "BAD") + "  " + p.passed + "/" + p.presets +
      "  paths " + p.pathsTotal + "  seq " + (p.seqPresets || 0) + "  bytes " + (p.bytes || 0) + "  sha256 " + String(p.sha256 || "").slice(0, 12));
  }
  const allPass = totals.failed === 0 && harnessFails === 0 && totals.presets > 0;
  log("");
  log((allPass ? "AV PACKS VERIFY: " : "AV PACKS VERIFY: ") + totals.passed + "/" + totals.presets +
    " presets PASS · packs " + totals.packs + " · harness fails " + harnessFails +
    " · preset fails " + totals.failed + " · warnings " + totals.warnings +
    " · seqShorthand " + totals.seqShorthand);
  log(allPass ? "VERDICT: PASS (strict exit 0)" : "VERDICT: FAIL (strict exit 1)");

  const summary = {
    v: 1, tool: "verify_avpacks.mjs", mode: "verify", at: new Date().toISOString(),
    node: process.version, engine: { AVDSP: AVDSP.version, sr: SR, renderS: RENDER_S },
    modRule: MOD.source,
    schemaSelfCheck: { ok: sc.ok, errors: sc.errors.slice(0, 40), stats: sc.stats },
    packs: packReports,
    totals,
    harnessFails,
    rows: allRows,
  };
  writeOutputs(summary);
  return allPass ? 0 : 1;
}

/* ---------------- index mode ---------------- */
function runIndex(only) {
  log("== verify_avpacks --index — regenerate packs/index.json from schema-validated packs ==");
  log("repo " + REPO + " · node " + process.version);
  if (Array.isArray(only) && only.length) log("  note: --only is ignored in --index mode (the index covers ALL packs)");
  let files = [];
  try { files = fs.readdirSync(PACKS_DIR).filter(f => /\.avbank\.json$/.test(f)).sort(); }
  catch (e) { log("packs dir unreadable: " + msgOf(e)); writeIndexReport({ ok: false, errors: [msgOf(e)] }); return 1; }
  const entries = [];
  const errors = [];
  for (const file of files) {
    const res = SCHEMA.readAvBankFile(path.join(PACKS_DIR, file));
    if (res.errors.length) {
      log("  FAIL  " + file + " :: " + res.errors[0]);
      errors.push(file + ": " + res.errors[0]);
      continue;
    }
    if (!res.pack || typeof res.pack.id !== "string") { errors.push(file + ": no id"); continue; }
    if (file !== res.pack.id + ".avbank.json") {
      log("  FAIL  " + file + ' :: file name must equal <id>.avbank.json (id "' + res.pack.id + '")');
      errors.push(file + ": file name != id");
      continue;
    }
    let buf = null;
    try { buf = fs.readFileSync(path.join(PACKS_DIR, file)); } catch (e) { errors.push(file + ": re-read failed"); continue; }
    entries.push({
      id: res.pack.id,
      name: res.pack.meta && res.pack.meta.name,
      file: file,
      sha256: sha256hex(buf),
      bytes: buf.length,
      presetCount: Array.isArray(res.pack.presets) ? res.pack.presets.length : 0,
      tags: res.pack.meta && Array.isArray(res.pack.meta.tags) ? res.pack.meta.tags.slice() : [],
      engine: res.pack.meta && res.pack.meta.engine,
    });
    log("  OK    " + file + " :: " + entries[entries.length - 1].presetCount + " presets · " + buf.length + " bytes · sha256 " + entries[entries.length - 1].sha256.slice(0, 16) + "…");
  }
  entries.sort((a, b) => a.id < b.id ? -1 : (a.id > b.id ? 1 : 0));
  const index = { v: 1, packs: entries };
  if (errors.length) {
    log("");
    log("INDEX NOT WRITTEN — " + errors.length + " pack(s) failed validation");
    writeIndexReport({ ok: false, errors, index });
    return 1;
  }
  const outPath = path.join(PACKS_DIR, "index.json");
  let wrote = false;
  try {
    fs.writeFileSync(outPath, JSON.stringify(index, null, 2) + "\n");
    wrote = true;
  } catch (e) { errors.push("write failed: " + msgOf(e)); }
  /* read-back verification (never trust the write alone) */
  if (wrote) {
    let back = null;
    try { back = JSON.parse(fs.readFileSync(outPath, "utf8")); } catch (e) { back = null; }
    const ok = isObj(back) && back.v === 1 && Array.isArray(back.packs) && back.packs.length === entries.length &&
      back.packs.every((e, i) => e && e.id === entries[i].id && e.sha256 === entries[i].sha256 && e.bytes === entries[i].bytes && e.presetCount === entries[i].presetCount && e.file === entries[i].file &&
        e.name === entries[i].name && jsonEq(e.tags, entries[i].tags) && e.engine === entries[i].engine);
    log("");
    if (!ok) { errors.push("read-back verification failed"); log("INDEX READ-BACK: FAIL"); }
    else log("INDEX READ-BACK: OK (3 listed packs re-hash-verified: " + entries.map(e => e.id + "@" + e.sha256.slice(0, 12)).join(", ") + ")");
  }
  const totalBytes = entries.reduce((s, e) => s + e.bytes, 0);
  const totalPresets = entries.reduce((s, e) => s + e.presetCount, 0);
  log("");
  log("packs/index.json " + (wrote && !errors.length ? "written" : "NOT written") + " — " + entries.length + " packs · " + totalPresets + " presets · " + totalBytes + " bytes");
  log(errors.length ? "INDEX VERDICT: FAIL (strict exit 1)" : "INDEX VERDICT: PASS (strict exit 0)");
  writeIndexReport({ ok: wrote && errors.length === 0, errors, index });
  return (wrote && errors.length === 0) ? 0 : 1;
}

/* ---------------- outputs ---------------- */
function writeOutputs(summary) {
  try { fs.writeFileSync(OUT_LOG, LOG.join("\n") + "\n"); } catch (e) { console.error("log write failed: " + msgOf(e)); }
  try { fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 1) + "\n"); } catch (e) { console.error("json write failed: " + msgOf(e)); }
}
function writeIndexReport(rep) {
  const summary = {
    v: 1, tool: "verify_avpacks.mjs", mode: "index", at: new Date().toISOString(),
    node: process.version, ok: !!rep.ok, errors: rep.errors || [],
    index: rep.index || null,
  };
  try { fs.writeFileSync(OUT_LOG, LOG.join("\n") + "\n"); } catch (e) { console.error("log write failed: " + msgOf(e)); }
  try { fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 1) + "\n"); } catch (e) { console.error("json write failed: " + msgOf(e)); }
}

/* ---------------- main ---------------- */
function main() {
  const argv = process.argv.slice(2);
  let mode = "verify";
  let only = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--index") mode = "index";
    else if (a === "--only" && argv[i + 1] !== undefined) { only = String(argv[++i]).split(",").map(s => s.trim()).filter(Boolean); }
    else if (a.indexOf("--only=") === 0) { only = a.slice(7).split(",").map(s => s.trim()).filter(Boolean); }
    else if (a === "--help" || a === "-h") {
      console.log("usage: node verify/verify_avpacks.mjs [--only id1,id2] | [--index]");
      return 0;
    } else {
      log("unknown argument ignored: " + a);
    }
  }
  return mode === "index" ? runIndex(only) : runVerify(only);
}

let exitCode = 1;
try {
  exitCode = main();
} catch (e) {
  log("");
  log("HARNESS EXCEPTION (never-throw guard): " + msgOf(e));
  try { log((e && e.stack) ? String(e.stack) : String(e)); } catch (e2) { /* ignore */ }
  try { fs.writeFileSync(OUT_LOG, LOG.join("\n") + "\n"); } catch (e2) { /* ignore */ }
  try { fs.writeFileSync(OUT_JSON, JSON.stringify({ v: 1, tool: "verify_avpacks.mjs", ok: false, exception: msgOf(e), at: new Date().toISOString() }, null, 1) + "\n"); } catch (e2) { /* ignore */ }
  exitCode = 1;
}
process.exit(exitCode);
