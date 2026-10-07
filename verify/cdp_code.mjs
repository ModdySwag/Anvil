// cdp_code.mjs — Anvil S5 CODE wave suite (child sa-G2's rig; WRITTEN by sa-G2, RUN BY THE PARENT
// after the S5 integration build). End-to-end over raw CDP against the frozen single-file build.
//
//   node verify/cdp_code.mjs [path-to-index.html] [--port N] [--sha <hex>] > verify/last-cdp_code.log 2>&1
//
// WRITE-ONLY: this file is authored by sa-G2 and never executed by sa-G2. The parent runs it after
// the integration build (index.html must contain av_umod_wl.js + av_code.js + av_code_ui.js;
// body.html must carry the #av-code card + #av-code-host; app_core boots avCodeInit/avCodeUiInit;
// av_dsp routes kind dispatch / engine.kind / fx+kind param fallbacks through AVUMOD; av_voiceproc
// handles {t:'umod'}; av_engine routes umod* replies to avCodeOnMessage; av_synth appends
// avCodeKinds() options to #av-synth-engine).
//
// LAUNCH SKELETON: copied VERBATIM from cdp_s4.mjs (itself the deck skeleton: candidates
// Chrome/Edge/Brave, free-port scan, fresh temp --user-data-dir + profile-scoped cleanup,
// 1440x900 device metrics override, --mute-audio, --autoplay-policy=no-user-gesture-required, ONE
// browser, explicit exit, process.on('exit') kills ONLY processes whose command line carries OUR
// temp profile) — plain cdp_s4 copy, NO popup flags (contract §2.G2). The URL is the plain
// file:// page (no ?avtest=1 — the reads ride the S5 modules alone).
//
// SHA FREEZE DISCIPLINE from cdp_s4.mjs: index.html is sha256'd before and after the run and
// before === after is ALWAYS enforced. EXPECT_SHA stays null until the parent pins the frozen S5
// sha (constant below or --sha <hex>); while null the rig still enforces before === after and
// prints a pin note (never loosened).
//
// WHAT IT PROVES, in order (contract: verify/_s5_wave.md §2.G2 checks 1-8) — the REAL live proof
// that user module code runs inside the audio engine:
//   1. boot (data-av-ready + engine ctx running/48k + window.__avEngine ready) + the #av-code card
//      + host mounted + the full avCode* API surface + window.__avCode {version, list, status}.
//   2. the rig's OWN fx module (half-gain st.oL = inL*0.5 with an amt param) added via avCodeAdd
//      → status ok / kind fx / kindId null + avCodeList row ready, then THREE audio witnesses on
//      the rig's OWN AnalyserNode sitting on the master tap (avMasterFor; the witness law): bypass
//      RMS (a) vs module amt=1 RMS (b) vs param-committed amt=0.25 RMS (c) — relational assertions
//      on the rig's own measurements only (a > b > c; ratio bands computed from live measurements,
//      never planted values).
//   3. poison: a THROWING fx module added while a note plays → the engine keeps rendering (stats
//      still answers, active >= 1), a FOLLOWING note still sounds, the module is reported
//      poisoned/off in avCodeList + avCodeStatus().poisoned, ZERO uncaught page errors, then it
//      removes cleanly.
//   4. versioned loader refusals, engine untouched: api:2 module, malformed src, bad id charset,
//      70 KB src — each refused honestly (ok:false + error), list/engine unchanged.
//   5. export/import: avCodeExportText('rigfx') parses (format anvil-module · api 1 · id/kind/src
//      round-trip · params object) → remove → avCodeImportText re-adds it (ok, list ready) →
//      foreign text (wrong format / not JSON / empty) refused honestly, list unchanged.
//   6. the rig's OWN source kind (sine osc + fast amp env, P2 kind contract) → kindId >= 64,
//      avApplyParam('engine.kind', <name>) accepted with mirror echo, noteOn WITNESSED non-silent
//      on the tap, avCodeKinds() lists it, and the parent-integrated #av-synth-engine select
//      carries the option.
//   7. UI path: >= 3 example buttons; the 'tremolo' example loaded into #av-code-src (+ id/name/
//      kind) and RUN via a real #av-code-run click → the list grows; the params panel mounts >= 2
//      knobs for the tremolo selection (data-knob paths fx.tremolo.*); a real #av-code-stop click
//      removes it; #av-code-status text is truthful.
//   8. seal: screenshot renders/code-suite.png (the card, scale 2, taken while modules are live) ·
//      cleanup (every rig module removed, engine.kind restored, notes released, fx param mirror
//      dropped) · zero page errors · sha256 before === after (+ the freeze pin leg once pinned).
//
// RIG-OWN MATH (never planted literals where the app computes): every RMS value comes from the
// rig's analyser on the master tap; the half-gain / quarter-amt assertions are RELATIONAL ratios
// over the rig's own before/after on the same note (the contract's ≈half claim sits inside the
// [0.2,0.8] band; the amt 0.25 further-drop inside [0.05,0.6] — bands are methodology, the exact
// ratio is printed every run); the following-note and kind-note witnesses are relational against
// the same run's amt-0.25 measurement (same chain state), plus the witness-law silence floor
// 0.005 that cdp_fx uses. kindId >= 64 and the 65536-char source cap are contract constants and
// are asserted as such. Only compact summaries ever cross CDP — sources/status objects are
// reduced page-side.
//
// SPEC NOTES (sa-G2, for the first parent run — fix the EXPECTATION to the check's stated intent,
// never loosen strength):
//   (a) the rig fx module's setParam matches the path's LAST segment ('fx.rigfx.amt' as av_dsp's
//       fx-prefix loop passes it, or a bare name) so prefix-policy drift shows up as a param-echo
//       mismatch in 2e, not as silence.
//   (b) avCodeExportText params: the exported amt is PRINTED (0.25 expected if records mirror the
//       committed value) but only "params is an object" is asserted — the first run pins the
//       record convention; then fix the sub-assertion to intent.
//   (c) 7c selection mechanism is PROBED (auto-select → data-av-code-id → edit button → row
//       click); the first run pins which path sa-C built; the check asserts only the stated intent
//       (>= 2 knobs for the tremolo selection) and prints the how.
//   (d) 6b applies the avCodeKinds() row's .name (fallback: the list row's name, then 'rigkind' —
//       the rig names its kind module id === display name so both kindIdByName readings coincide).
//   (e) 7e status truth = non-empty + no failure wording after a successful run/stop + no
//       zero-modules claim while modules are loaded; the exact wording is free.
//   (f) avCodeStatus().engine is read tolerant (string or object) — presence is asserted, the
//       shape is printed.
//   (g) tier: the contract expects worklet:data on file://; 1a mirrors cdp_s4's ctx probe rather
//       than pinning the tier, asserts engine ready/sr 48k, and PRINTS the tier each time it is
//       read (a non-worklet tier here is a finding for the parent, not a rig loosening).
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const shaArg = argv.indexOf('--sha');
const page = argv.find(a => !a.startsWith('--') && (/\.html?$/i.test(a) || existsSync(a))) || path.join(here, '..', 'index.html');
if (!existsSync(page)) { console.error('page not found: ' + page); process.exit(2); }

/* FREEZE LAW: the bytes under test are named before anything runs, and re-checked after.
   S5 CODE: the frozen sha of the rebuilt index.html is not known until build.py runs — the parent
   may fill this constant or pass --sha <hex>; the rig never loosens the before === after check. */
const EXPECT_SHA = 'b34a28b60716399b04844e783026f0472b0d768ba05769eff4cee9f2b489a6bf';
const PIN = (shaArg > -1 && argv[shaArg + 1] && /^[0-9a-f]{64}$/i.test(argv[shaArg + 1])) ? argv[shaArg + 1].toLowerCase() : EXPECT_SHA;
const shaOf = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const shaBefore = shaOf(page);
console.log('index.html sha256 (before): ' + shaBefore + (PIN ? '' : '   (EXPECT_SHA not pinned yet — pass --sha <hex> or set the constant)'));

const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
];
const exe = candidates.find(existsSync);
if (!exe) { console.error('no chromium found'); process.exit(2); }
console.log('using browser:', exe);

async function freePort(start) {
  for (let p = start; p < start + 400; p++) {
    const ok = await new Promise(res => {
      const srv = net.createServer();
      srv.once('error', () => res(false));
      srv.once('listening', () => srv.close(() => res(true)));
      srv.listen(p, '127.0.0.1');
    });
    if (ok) return p;
  }
  return start;
}
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9680);
const profile = path.join(tmpdir(), 'anvil-code-' + Date.now());
const DL_DIR = path.join(tmpdir(), 'anvil-code-dl-' + Date.now());
try { mkdirSync(DL_DIR, { recursive: true }); } catch (e) { /* best-effort */ }
const url = 'file:///' + path.resolve(page).replace(/\\/g, '/');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
console.log('cdp port ' + PORT + ' · profile ' + profile);
console.log('download dir ' + DL_DIR);

let pass = 0, fail = 0;
const expected = (cond, msg, info) => {
  if (cond === true) { pass++; console.log(' ok   ' + msg + (info ? '  -> ' + info : '')); }
  else { fail++; console.log(' FAIL ' + msg + (info ? '  -> ' + info : '')); }
  return cond === true;
};
const note = (t) => console.log('   · ' + t);
const J = (x) => { try { return JSON.stringify(x); } catch (e) { return String(x); } };

const chrome = spawn(exe, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--disable-sync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  url,
], { stdio: 'ignore', windowsHide: true });

const errors = [];

/* ---------- the rig's OWN module sources (contract §2.B / P2 §2 interface shapes) ----------
   Authored HERE, inside the rig — eval'd in the worklet via new Function('API', ...) by the
   AVUMOD runtime, never by app code. They live as template strings and are injected into the page
   scaffold as JSON. */
const RIG_FX_SRC = `/* rig-authored fx module (S5 CODE rig) — half-gain with amt scaling · wet convention */
var MOD = {
  api: 1,
  id: "rigfx",
  name: "Rig Half Gain",
  kind: "fx",
  params: [
    { name: "amt", min: 0, max: 1, def: 1, step: 0.01, label: "Amount" },
    { name: "mix", min: 0, max: 1, def: 1, step: 0.01, label: "Mix" }
  ],
  createState: function (cfg) {
    return { amt: 1, mix: 1, on: 1, sr: (cfg && cfg.sampleRate) || 0, oL: 0, oR: 0 };
  },
  bindEngine: function (st, eng) { st.engSr = (eng && eng.sr) || st.sr; },
  setParam: function (st, path, v) {
    var name = String(path).slice(String(path).lastIndexOf(".") + 1);
    if (name === "amt") { st.amt = Number(v); return true; }
    if (name === "mix") { st.mix = Number(v); return true; }
    if (name === "on") { st.on = Number(v); return true; }
    return false;
  },
  process: function (st, inL, inR) {
    var g = 0.5 * st.amt;
    st.oL = inL * g;
    st.oR = inR * g;
  }
};
return MOD;`;

const RIG_POISON_SRC = `/* rig-authored fx module (S5 CODE rig) — process() THROWS by design (poison leg) */
var MOD = {
  api: 1,
  id: "rigpoison",
  name: "rigpoison",
  kind: "fx",
  params: [
    { name: "mix", min: 0, max: 1, def: 1, step: 0.01, label: "Mix" }
  ],
  createState: function () { return { mix: 1, on: 1, oL: 0, oR: 0 }; },
  setParam: function (st, path, v) {
    var name = String(path).slice(String(path).lastIndexOf(".") + 1);
    if (name === "mix") { st.mix = Number(v); return true; }
    if (name === "on") { st.on = Number(v); return true; }
    return false;
  },
  process: function (st, inL, inR) {
    throw new Error("rig poison: process throws by design (S5 CODE rig)");
  }
};
return MOD;`;

const RIG_KIND_SRC = `/* rig-authored source kind (S5 CODE rig) — sine osc + fast amp env, P2 kind contract */
var MOD = {
  api: 1,
  id: "rigkind",
  name: "rigkind",
  kind: "kind",
  PREFIX: "rigkind",
  params: [
    { name: "level", min: 0, max: 1, def: 0.8, step: 0.01, label: "Level" }
  ],
  initEngineK: function (kext) { if (kext) kext.rigKindOn = 1; },
  initVoiceK: function (k) { if (!k) return; k.rkPhase = 0; k.rkEnv = 0; k.rkRel = 0; },
  initVoice: function (eng, v) {
    var k = v && v.k;
    if (!k) return;
    k.rkPhase = 0; k.rkEnv = 0; k.rkRel = 0;
  },
  releaseVoice: function (eng, v) { var k = v && v.k; if (k) k.rkRel = 1; },
  isVoiceDone: function (eng, v) { var k = v && v.k; return !!(k && k.rkRel === 1 && k.rkEnv <= 0.0004); },
  setParam: function (eng, path, value) {
    var name = String(path).slice(String(path).lastIndexOf(".") + 1);
    if (name === "level") { eng.rigKindLevel = Number(value); return true; }
    return false;
  },
  stepVoice: function (eng, v) {
    var k = v && v.k;
    if (!k) return 0;
    if (typeof k.rkPhase !== "number") { k.rkPhase = 0; k.rkEnv = 0; k.rkRel = 0; }
    var sr = (eng && eng.sr) || 48000;
    var target = (k.rkRel === 1) ? 0 : 1;
    var step = (k.rkEnv < target ? 1 / 0.004 : 1 / 0.08) / sr;
    if (k.rkEnv < target) { k.rkEnv += step; if (k.rkEnv > target) k.rkEnv = target; }
    else if (k.rkEnv > target) { k.rkEnv -= step; if (k.rkEnv < 0) k.rkEnv = 0; }
    var midi = (typeof v.pitch === "number" && isFinite(v.pitch)) ? v.pitch : 60;
    var bend = (eng && typeof eng.bend === "number") ? eng.bend : 0;
    var tune = (eng && typeof eng.tune === "number") ? eng.tune : 0;
    var f = 440 * Math.pow(2, (midi - 69 + bend + tune) / 12);
    k.rkPhase += f / sr;
    if (k.rkPhase >= 1) k.rkPhase -= 1;
    var lvl = (eng && typeof eng.rigKindLevel === "number") ? eng.rigKindLevel : 0.8;
    return Math.sin(6.283185307179586 * k.rkPhase) * k.rkEnv * lvl;
  }
};
return MOD;`;

const RIG_API2_SRC = `/* rig-authored fx module (S5 CODE rig) — declares api: 2 (versioned loader must refuse) */
var MOD = {
  api: 2,
  id: "rigapi2",
  name: "rigapi2",
  kind: "fx",
  params: [],
  createState: function () { return {}; },
  setParam: function () { return true; },
  process: function (st, inL, inR) { st.oL = inL; st.oR = inR; }
};
return MOD;`;

const RIG_BAD_SRC = `/* rig-authored module (S5 CODE rig) — deliberate syntax error (loader must refuse) */
var MOD = { api: 1, id: "rigsyntax", name: "rigsyntax", kind: "fx", params: [ ; return MOD;`;

const RIG_SRCS = { fx: RIG_FX_SRC, poison: RIG_POISON_SRC, kind: RIG_KIND_SRC, api2: RIG_API2_SRC, bad: RIG_BAD_SRC };

/* ---------- page-side scaffolding injected at runtime (rig-owned; never app code) ----------
   __codeW: the rig's OWN seams / legs / digests —
     witnessArm/winMax/witnessStop: the rig's own AnalyserNode on the master tap (avMasterFor —
                 panel reads are never witnesses), an rAF + 40 ms sampler RMS timeline;
     measure():  play note N via __avEngine.noteOn, settle, collect a window, noteOff — all
                 timestamps page-side (performance.now);
     arm()/cleanup(): baseline snapshot + the full restore (modules, params, notes, witness);
     addFx/poisonAdd/kindAdd/refuse/exportParsed/importText/applyKind/kindsList/engineSelect/
     examples/uiFill/uiTarget/paramsRead/uiSnap/surface/statusSnap/listRow/listIds/stats/card:
                 the per-check legs returning compact summaries (sources never cross as whole
                 payloads except the export text the round-trip needs). */
const CODEW_HELPERS = `window.__codeW = (function () {
  var SRCS = ${JSON.stringify(RIG_SRCS)};
  var W = { v: 1, samples: [], an: null, on: false, td: null, timer: null, orig: null, p0: null, fxSrc: SRCS.fx, tremSrc: null, vstr: 1 };
  W.safe = function (x) { try { return JSON.parse(JSON.stringify(x)); } catch (e) { return null; } };
  W.J = function (x) { try { return JSON.stringify(x); } catch (e) { return String(x); } };
  W.num = function (x) { return (typeof x === 'number' && isFinite(x)) ? x : null; };
  W.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  W.domGet = function (id) { try { return (typeof document !== 'undefined' && document && document.getElementById) ? document.getElementById(id) : null; } catch (e) { return null; } };
  W.paramGet = function (path) {
    try {
      if (typeof avParams !== 'undefined' && avParams && avParams[path] !== undefined && avParams[path] !== null) {
        var v = avParams[path];
        if (typeof v === 'number') return isFinite(v) ? v : null;
        if (typeof v === 'string') return v;
        if (typeof v === 'boolean') return v;
      }
    } catch (e) { }
    return null;
  };
  W.engineInfo = function () {
    var e = window.__avEngine || {};
    var ctx = (e.handle && e.handle.ctx) || e.ctx || null;
    return {
      ready: e.ready === true, tier: (typeof e.tier === 'string') ? e.tier : null,
      sr: W.num(e.sr), maxVoices: W.num(e.maxVoices), os: W.num(e.os),
      ctxState: ctx ? String(ctx.state) : null
    };
  };
  W.noteOff = function (midi) { try { window.__avEngine.noteOff(midi); return true; } catch (e) { return false; } };
  W.notesOff = function () {
    try { if (typeof avNoteStopAll === 'function') avNoteStopAll(); } catch (e) { }
    try { if (window.__avEngine && typeof window.__avEngine.allOff === 'function') window.__avEngine.allOff(); } catch (e) { }
    try { var ns = (typeof avNoteState === 'function') ? avNoteState() : null; return ns ? ns.held.length : null; } catch (e) { return null; }
  };
  /* ---- witness: the rig own AnalyserNode on the master tap (witness law) ---- */
  W.witnessArm = function (ctx) {
    try {
      W.witnessStop();
      var master = (typeof avMasterFor === 'function') ? avMasterFor(ctx) : null;
      if (!master) return { ok: false, why: 'no master tap node for this ctx' };
      var an = ctx.createAnalyser();
      an.fftSize = 2048;
      an.smoothingTimeConstant = 0;
      master.connect(an);
      W.an = an; W.td = new Float32Array(2048); W.samples = []; W.on = true;
      var tick = function () {
        if (!W.on) return;
        try {
          W.an.getFloatTimeDomainData(W.td);
          var s = 0;
          for (var i = 0; i < W.td.length; i++) s += W.td[i] * W.td[i];
          W.samples.push({ t: performance.now(), r: Math.sqrt(s / W.td.length) });
          if (W.samples.length > 30000) W.samples.shift();
        } catch (e) { }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      W.timer = setInterval(function () {
        if (!W.on) return;
        try {
          W.an.getFloatTimeDomainData(W.td);
          var s = 0;
          for (var i = 0; i < W.td.length; i++) s += W.td[i] * W.td[i];
          W.samples.push({ t: performance.now(), r: Math.sqrt(s / W.td.length) });
          if (W.samples.length > 30000) W.samples.shift();
        } catch (e) { }
      }, 40);
      return { ok: true, sr: ctx.sampleRate, fft: an.fftSize };
    } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
  };
  W.witnessStop = function () {
    W.on = false;
    if (W.timer) { try { clearInterval(W.timer); } catch (e) { } W.timer = null; }
    if (W.an) { try { W.an.disconnect(); } catch (e) { } }
    W.an = null;
    return true;
  };
  W.winMax = function (t0, t1) {
    var mx = 0, sum = 0, n = 0;
    for (var i = 0; i < W.samples.length; i++) {
      var s = W.samples[i];
      if (s.t >= t0 && s.t <= t1) { n += 1; sum += s.r; if (s.r > mx) mx = s.r; }
    }
    return { max: mx, mean: n ? sum / n : 0, n: n, t0: t0, t1: t1 };
  };
  W.measure = async function (midi, settleMs, winMs, gain) {
    var h = window.__avEngine;
    if (!h || h.ready !== true) return { why: 'engine not ready' };
    if (!W.an) return { why: 'witness not armed' };
    var g = (typeof gain === 'number' && isFinite(gain)) ? gain : 0.9;
    var on = false;
    try { on = (h.noteOn(midi, g) === true); } catch (e) { return { why: 'noteOn threw: ' + ((e && e.message) || e) }; }
    await W.sleep(settleMs);
    var t0 = performance.now();
    await W.sleep(winMs);
    var t1 = performance.now();
    var mx = W.winMax(t0, t1);
    try { h.noteOff(midi); } catch (e) { }
    await W.sleep(140);
    return { on: on, max: mx.max, mean: mx.mean, n: mx.n };
  };
  /* ---- baseline + cleanup ---- */
  W.arm = function () {
    var paths = ['engine.kind', 'fx.rigfx.amt', 'fx.rigfx.mix', 'fx.rigpoison.mix', 'rigkind.level'];
    W.p0 = {};
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      var had = false, val = null;
      try { had = Object.prototype.hasOwnProperty.call(avParams, p); val = had ? avParams[p] : null; } catch (e) { }
      W.p0[p] = { had: had, val: val };
    }
    var kind = W.paramGet('engine.kind');
    W.orig = { kind: (typeof kind === 'string') ? kind : 'va' };
    return { kind: W.orig.kind, p0: W.p0 };
  };
  W.cleanup = async function () {
    var out = { removed: [] };
    var ids = ['rigfx', 'rigpoison', 'rigkind', 'tremolo'];
    for (var i = 0; i < ids.length; i++) {
      try {
        var cur = W.listIds() || [];
        if (cur.indexOf(ids[i]) >= 0) { avCodeRemove(ids[i]); out.removed.push(ids[i]); }
      } catch (e) { out['err_' + ids[i]] = String((e && e.message) || e); }
    }
    await W.sleep(700);
    var kindWant = (W.orig && typeof W.orig.kind === 'string') ? W.orig.kind : null;
    try { if (kindWant) avApplyParam('engine.kind', kindWant); } catch (e) { out.kindErr = String((e && e.message) || e); }
    try {
      if (W.p0) {
        for (var p in W.p0) {
          if (!Object.prototype.hasOwnProperty.call(W.p0, p)) continue;
          var rec = W.p0[p];
          if (rec && rec.had) avParams[p] = rec.val; else delete avParams[p];
        }
      }
    } catch (e) { out.paramErr = String((e && e.message) || e); }
    try { if (typeof avNoteStopAll === 'function') avNoteStopAll(); } catch (e) { }
    try { if (window.__avEngine && typeof window.__avEngine.allOff === 'function') window.__avEngine.allOff(); } catch (e) { }
    try { W.witnessStop(); } catch (e) { }
    var held = null;
    try { var ns = (typeof avNoteState === 'function') ? avNoteState() : null; held = ns ? ns.held.length : null; } catch (e) { }
    var amtMirror = 'err';
    try { amtMirror = (typeof avParams !== 'undefined' && avParams && Object.prototype.hasOwnProperty.call(avParams, 'fx.rigfx.amt')) ? avParams['fx.rigfx.amt'] : 'absent'; } catch (e) { }
    return { removed: out.removed, kindNow: W.paramGet('engine.kind'), kindWant: kindWant, held: held, amtMirror: amtMirror, errs: out };
  };
  /* ---- list / status ---- */
  W.listIds = function () {
    try { return (avCodeList() || []).map(function (r) { return (r && r.id) || null; }); } catch (e) { return null; }
  };
  W.rowLight = function (r) {
    if (!r || typeof r !== 'object') return null;
    return {
      id: (r.id === undefined ? null : r.id), name: (r.name === undefined ? null : String(r.name).slice(0, 60)),
      label: (r.label === undefined ? null : String(r.label).slice(0, 60)),
      kind: (r.kind === undefined ? null : r.kind), api: (r.api === undefined ? null : r.api),
      enabled: (r.enabled === undefined ? null : r.enabled), ready: (r.ready === undefined ? null : r.ready),
      kindId: (r.kindId === undefined ? null : r.kindId), fxIndex: (r.fxIndex === undefined ? null : r.fxIndex),
      poisoned: (r.poisoned === undefined ? null : r.poisoned),
      paramsLen: (r.params && typeof r.params.length === 'number') ? r.params.length : null
    };
  };
  W.listRow = function (id) {
    try {
      var list = avCodeList() || [];
      for (var i = 0; i < list.length; i++) { if (list[i] && list[i].id === id) return W.rowLight(list[i]); }
      return null;
    } catch (e) { return null; }
  };
  W.statusSnap = function () {
    var out = { has: false, len: null, engine: null, engineOk: false, count: null, keys: null, err: null };
    try {
      var s = avCodeStatus();
      out.keys = (s && typeof s === 'object') ? Object.keys(s).slice(0, 12) : null;
      out.count = (s && s.count !== undefined) ? s.count : null;
      var po = s ? s.poisoned : null;
      out.len = Array.isArray(po) ? po.length : null;
      if (Array.isArray(po)) {
        for (var i = 0; i < po.length; i++) {
          var p = po[i];
          var id = (typeof p === 'string') ? p : (p && p.id);
          if (id === 'rigpoison') { out.has = true; break; }
        }
      }
      var en = s ? s.engine : null;
      out.engineOk = !(en === null || en === undefined || en === false);
      out.engine = (en === null || en === undefined) ? null : ((typeof en === 'object') ? 'obj' : String(en));
    } catch (e) { out.err = String((e && e.message) || e); }
    return out;
  };
  W.stats = async function () {
    try { var s = await window.__avEngine.stats(); return W.safe(s); } catch (e) { return { err: String((e && e.message) || e) }; }
  };
  W.card = function () {
    try { return { card: !!W.domGet('av-code'), host: !!W.domGet('av-code-host') }; } catch (e) { return { err: String((e && e.message) || e) }; }
  };
  W.surface = function () {
    var fns = ['avCodeInit', 'avCodeList', 'avCodeAdd', 'avCodeRemove', 'avCodeEnable', 'avCodeSetParam', 'avCodeGetParam', 'avCodeExamples', 'avCodeExample', 'avCodeExportText', 'avCodeImportText', 'avCodeKinds', 'avCodeStatus', 'avCodeOnMessage'];
    var missing = [];
    for (var i = 0; i < fns.length; i++) { if (typeof window[fns[i]] !== 'function') missing.push(fns[i]); }
    var C = window.__avCode || null;
    var init = null;
    try { init = (typeof avCodeInit === 'function') ? (avCodeInit() !== false) : null; } catch (e) { init = 'threw: ' + ((e && e.message) || e); }
    var st = null, count = null, poisonedLen = null, engineOk = false, engineShape = null;
    try {
      st = (typeof avCodeStatus === 'function') ? avCodeStatus() : null;
      if (st && typeof st === 'object') {
        count = (st.count === undefined) ? null : st.count;
        poisonedLen = Array.isArray(st.poisoned) ? st.poisoned.length : null;
        var en = st.engine;
        engineOk = !(en === null || en === undefined || en === false);
        engineShape = (en === null || en === undefined) ? null : ((typeof en === 'object') ? 'obj' : String(en));
      }
    } catch (e) { engineShape = 'threw: ' + ((e && e.message) || e); }
    var listOk = false, statusOk = false;
    try { listOk = !!(C && typeof C.list === 'function' && Array.isArray(C.list())); } catch (e) { listOk = 'threw'; }
    try { var so = (C && typeof C.status === 'function') ? C.status() : null; statusOk = !!(so && typeof so === 'object'); } catch (e) { statusOk = 'threw'; }
    return {
      v: W.v, missing: missing, hasCode: !!C, ver: C ? C.version : null,
      listFn: C ? (typeof C.list) : 'none', statusFn: C ? (typeof C.status) : 'none',
      init: init, count: count, poisonedLen: poisonedLen, engineOk: engineOk, engine: engineShape,
      listOk: listOk, statusOk: statusOk
    };
  };
  /* ---- module legs ---- */
  W.addFx = async function () {
    try { var r = await avCodeAdd({ id: 'rigfx', name: 'Rig Half Gain', kind: 'fx', src: SRCS.fx }); return W.safe(r) || { raw: String(r) }; }
    catch (e) { return { threw: String((e && e.message) || e) }; }
  };
  W.poisonAdd = async function () {
    try { var r = await avCodeAdd({ id: 'rigpoison', name: 'rigpoison', kind: 'fx', src: SRCS.poison }); return W.safe(r) || { raw: String(r) }; }
    catch (e) { return { threw: String((e && e.message) || e) }; }
  };
  W.kindAdd = async function () {
    try { var r = await avCodeAdd({ id: 'rigkind', name: 'rigkind', kind: 'kind', src: SRCS.kind }); return W.safe(r) || { raw: String(r) }; }
    catch (e) { return { threw: String((e && e.message) || e) }; }
  };
  W.refuse = async function (which) {
    var spec = null;
    if (which === 'api2') spec = { id: 'rigapi2', name: 'rigapi2', kind: 'fx', src: SRCS.api2 };
    else if (which === 'syntax') spec = { id: 'rigsyntax', name: 'rigsyntax', kind: 'fx', src: SRCS.bad };
    else if (which === 'badid') spec = { id: 'Bad Id!', name: 'Bad Id!', kind: 'fx', src: SRCS.fx };
    else if (which === 'big') spec = { id: 'rigbig', name: 'rigbig', kind: 'fx', src: '/* ' + new Array(70001).join('x') + ' */' + SRCS.fx };
    if (!spec) return { ok: 'unknown refusal', error: null, threw: null, srcLen: null };
    try {
      var r = await avCodeAdd(spec);
      var o = W.safe(r);
      return { ok: (o && o.ok === true) ? true : ((o && o.ok === false) ? false : 'nonobj'), error: (o && typeof o.error === 'string') ? o.error.slice(0, 160) : null, threw: null, srcLen: spec.src.length };
    } catch (e) { return { ok: 'threw', error: null, threw: String((e && e.message) || e), srcLen: spec.src.length }; }
  };
  W.exportParsed = function (id) {
    try {
      var t = avCodeExportText(id);
      if (typeof t !== 'string') return { isStr: false, raw: String(t) };
      var o = null;
      try { o = JSON.parse(t); } catch (e) { return { isStr: true, parse: false, why: String((e && e.message) || e), len: t.length }; }
      return {
        isStr: true, parse: true, text: t, len: t.length,
        format: o.format, api: o.api, id: o.id, name: o.name, kind: o.kind,
        srcEq: o.src === W.fxSrc, srcLen: (typeof o.src === 'string') ? o.src.length : null,
        paramsIsObj: !!(o.params && typeof o.params === 'object'),
        amt: (o.params && typeof o.params === 'object') ? o.params.amt : null
      };
    } catch (e) { return { isStr: false, threw: String((e && e.message) || e) }; }
  };
  W.importText = async function (text) {
    try { var r = await avCodeImportText(text); return W.safe(r) || { raw: String(r) }; }
    catch (e) { return { threw: String((e && e.message) || e) }; }
  };
  W.kindsList = function () {
    try { return (avCodeKinds() || []).map(function (k) { return W.rowLight(k); }); } catch (e) { return null; }
  };
  W.applyKind = function (v) {
    try { var r = avApplyParam('engine.kind', v); return { ret: r === true, echo: W.paramGet('engine.kind') }; }
    catch (e) { return { ret: 'threw', err: String((e && e.message) || e) }; }
  };
  W.engineSelect = function (v) {
    try {
      var sel = W.domGet('av-synth-engine');
      if (!sel) return { found: false, why: 'no #av-synth-engine' };
      var opts = [];
      var match = false;
      for (var i = 0; i < sel.options.length; i++) {
        var ov = String(sel.options[i].value);
        var ot = String(sel.options[i].textContent || '').slice(0, 40);
        opts.push({ v: ov.slice(0, 40), t: ot });
        if (ov === v || ot.indexOf(v) >= 0) match = true;
      }
      return { found: true, match: match, n: opts.length, opts: opts.slice(0, 24) };
    } catch (e) { return { found: false, err: String((e && e.message) || e) }; }
  };
  /* ---- UI legs ---- */
  W.examples = function () {
    var out = { keys: null, btns: 0, tremLen: null };
    try { var ex = (typeof avCodeExamples === 'function') ? avCodeExamples() : null; out.keys = (ex || []).map(function (e) { return e && e.key; }); } catch (e) { out.examplesErr = String((e && e.message) || e); }
    try {
      var host = W.domGet('av-code-examples');
      if (host) out.btns = host.querySelectorAll('button, [role="button"], .av-btn').length;
      else out.noHost = true;
    } catch (e) { out.btnErr = String((e && e.message) || e); }
    try {
      var t = (typeof avCodeExample === 'function') ? avCodeExample('tremolo') : null;
      out.tremLen = (typeof t === 'string') ? t.length : null;
      W.tremSrc = (typeof t === 'string') ? t : null;
    } catch (e) { out.tremErr = String((e && e.message) || e); }
    return out;
  };
  W.uiFill = function () {
    var out = { present: { src: false, id: false, name: false, kind: false } };
    try {
      var src = W.tremSrc;
      out.usedFallback = !src;
      if (!src) src = SRCS.fx;
      var s = W.domGet('av-code-src');
      var i = W.domGet('av-code-id');
      var n = W.domGet('av-code-name');
      var k = W.domGet('av-code-kind');
      out.present = { src: !!s, id: !!i, name: !!n, kind: !!k };
      if (s) { s.value = src; s.dispatchEvent(new Event('input', { bubbles: true })); }
      if (i) { i.value = 'tremolo'; i.dispatchEvent(new Event('input', { bubbles: true })); }
      if (n) { n.value = 'Tremolo'; n.dispatchEvent(new Event('input', { bubbles: true })); }
      if (k) { k.value = 'fx'; k.dispatchEvent(new Event('change', { bubbles: true })); }
      out.srcLen = src ? src.length : 0;
    } catch (e) { out.err = String((e && e.message) || e); }
    return out;
  };
  W.uiTarget = function (id) {
    try {
      var host = W.domGet('av-code-list');
      if (!host) return { found: false, why: 'no #av-code-list' };
      var el = host.querySelector('[data-av-code-id="' + id + '"], [data-id="' + id + '"], [data-module="' + id + '"]');
      var how = el ? 'data' : null;
      if (!el) {
        var btns = host.querySelectorAll('button, [role="button"], .av-btn');
        var editBtn = null, nameBtn = null;
        for (var i = 0; i < btns.length; i++) {
          var tx = String(btns[i].textContent || '') + ' ' + String(btns[i].getAttribute('aria-label') || '') + ' ' + String(btns[i].className || '');
          if (tx.indexOf(id) >= 0) {
            if (/edit/i.test(tx) && !editBtn) editBtn = btns[i];
            nameBtn = btns[i];
          }
        }
        el = editBtn || nameBtn;
        how = editBtn ? 'edit-btn' : (nameBtn ? 'name-btn' : null);
      }
      if (!el) {
        var all = host.querySelectorAll('*');
        for (var j = 0; j < all.length; j++) { if (String(all[j].textContent || '').indexOf(id) >= 0) el = all[j]; }
        how = el ? 'deepest' : null;
      }
      if (!el) return { found: false, why: 'no row for ' + id };
      try { if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) { }
      var r = el.getBoundingClientRect();
      return {
        found: true, how: how, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
        w: Math.round(r.width), h: Math.round(r.height), tag: String(el.tagName || ''),
        txt: String(el.textContent || '').slice(0, 60)
      };
    } catch (e) { return { found: false, why: String((e && e.message) || e) }; }
  };
  W.paramsRead = function (id) {
    try {
      var host = W.domGet('av-code-params');
      if (!host) return { found: false, why: 'no #av-code-params' };
      var els = host.querySelectorAll('[data-knob]');
      var paths = [];
      var forSel = 0;
      for (var i = 0; i < els.length; i++) {
        var p = String(els[i].getAttribute('data-knob') || '');
        paths.push(p);
        if (p.indexOf('fx.' + id + '.') === 0 || p.indexOf(id + '.') === 0) forSel += 1;
      }
      return { found: true, n: paths.length, forSel: forSel, paths: paths.slice(0, 12) };
    } catch (e) { return { found: false, err: String((e && e.message) || e) }; }
  };
  W.uiSnap = function () {
    var out = {};
    try {
      var st = W.domGet('av-code-status');
      out.statusText = st ? String(st.textContent || '').trim().slice(0, 220) : null;
    } catch (e) { out.statusErr = String((e && e.message) || e); }
    try { out.ids = W.listIds(); } catch (e) { out.idsErr = String((e && e.message) || e); }
    try { out.rowEls = document.querySelectorAll('#av-code-list > *').length; } catch (e) { }
    return out;
  };
  return W;
})(); true`;

const shotPath = path.join(here, '..', 'renders', 'code-suite.png');

async function main() {
  /* a fresh Edge profile opens edge://sync-confirmation-dialog/ and edge://newtab/ BEFORE our
     page; wait for the file:// page target itself (smoke law) */
  let target = null;
  for (let i = 0; i < 150 && !target; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) target = (await r.json()).find(t => t.type === 'page' && String(t.url).startsWith('file://'));
    } catch { /* browser still booting */ }
    if (!target) await sleep(200);
  }
  if (!target) { console.error('no file page target to drive'); process.exit(2); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('LOG: ' + m.params.entry.text);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value || a.description || '').join(' '));
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  if (!String(target.url).startsWith('file://')) await send('Page.navigate', { url });
  /* Edge headless ignores --window-size: force the desktop viewport */
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => { });
  await send('Page.bringToFront').catch(() => { });
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR }).catch(() => note('Page.setDownloadBehavior unavailable — anchor writes still fire'));

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) {
      const e = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'unknown';
      note('eval threw: ' + String(e).split('\n')[0].slice(0, 220));
      return { error: e };
    }
    return { value: r.result?.value };
  };
  const val = (r) => (r && r.value !== undefined) ? r.value : null;
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const clickSel = async (sel, after = 300) => {
    const found = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; if (e.scrollIntoView) e.scrollIntoView({ block: 'center', inline: 'center' }); return true; })()`);
    if (found.value !== true) { note('click target missing: ' + sel); return false; }
    await sleep(180);
    const boxR = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width || !r.height) return null; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const b = boxR.value;
    if (!b) { note('click target not visible: ' + sel); return false; }
    await mouse('mousePressed', b.x, b.y);
    await sleep(30);
    await mouse('mouseReleased', b.x, b.y);
    await sleep(after);
    return true;
  };
  const untilTruthy = async (expr, tries, ms) => {
    for (let i = 0; i < tries; i++) { const v = val(await ev(expr)); if (v) return v; await sleep(ms); }
    return null;
  };
  const snapCard = async (sel, file) => {
    await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; if (el.scrollIntoView) el.scrollIntoView({ block: 'start' }); return true; })()`);
    await sleep(350);
    const rectR = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }; })()`);
    const rect = val(rectR);
    if (!rect || !(rect.w > 50 && rect.h > 50)) return { ok: false, info: 'no usable rect' };
    try {
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 2 }, captureBeyondViewport: true });
      const buf = Buffer.from(shot.data, 'base64');
      try { mkdirSync(path.dirname(file), { recursive: true }); } catch (e) { }
      writeFileSync(file, buf);
      return { ok: buf.length > 1000 && buf[0] === 0x89 && buf[1] === 0x50, info: buf.length + ' bytes · clip ' + Math.round(rect.w) + '×' + Math.round(rect.h) + ' @2x' };
    } catch (e) { return { ok: false, info: 'capture failed: ' + (e && e.message) }; }
  };

  /* ── 1. boot + card + API surface ── */
  console.log('── 1. boot + card + API surface ──');
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const r = await ev(`document.documentElement.getAttribute('data-av-ready') === '1'`);
    if (r.value === true) { ready = true; break; }
    await sleep(300);
  }
  /* the live engine ctx (the CODE runtime plays through THIS context — never a fresh AudioContext) */
  const engR = await ev(`(async () => {
    const e0 = window.__avEngine || {};
    let ctx = (e0.handle && e0.handle.ctx) || e0.ctx || null;
    if (!ctx && typeof avEngineEnsure === 'function') { try { const h = await avEngineEnsure(); ctx = (h && h.ctx) || null; } catch (x) { } }
    const e = window.__avEngine || e0;   /* the facade appears DURING the await — re-read it here */
    if (!ctx) { for (const k in e.handle || {}) { try { const v = e.handle[k]; if (v && typeof v.currentTime === 'number' && typeof v.resume === 'function') { ctx = v; break; } } catch (x) { } } }
    if (!ctx) return { found: false, codeReady: e.ready === true, codeTier: (typeof e.tier === 'string') ? e.tier : null };
    if (ctx.state !== 'running') { try { await Promise.race([ctx.resume().catch(function () { }), new Promise(function (res) { setTimeout(res, 2000); })]); } catch (x) { } }
    for (let i = 0; i < 20 && ctx.state !== 'running'; i++) await new Promise(function (res) { setTimeout(res, 125); });
    return { found: true, state: ctx.state, sampleRate: ctx.sampleRate, codeReady: e.ready === true, codeTier: (typeof e.tier === 'string') ? e.tier : null, maxVoices: e.maxVoices || null };
  })()`);
  const eng = val(engR) || {};
  await ev(CODEW_HELPERS);
  const bootOk = ready === true && eng.found === true && eng.state === 'running' && Number(eng.sampleRate) === 48000 && eng.codeReady === true && typeof eng.codeTier === 'string';
  expected(bootOk && val(await ev(`!!(window.__codeW && window.__codeW.v === 1 && typeof window.__codeW.measure === 'function' && typeof window.__codeW.addFx === 'function' && typeof window.__codeW.cleanup === 'function' && typeof window.__codeW.witnessArm === 'function')`)) === true,
    '1a boot: data-av-ready flips · engine ctx running/48k · window.__avEngine ready (tier ' + (eng.codeTier || '?') + ' — worklet:data expected on file://) · rig helpers injected (__codeW v1)',
    J({ ready: ready, eng: eng }));
  if (!ready) { console.error('APP NOT READY'); process.exit(1); }
  if (eng.codeReady !== true) note('engine not ready — adds below will surface honest refusals (SPEC note g)');

  let cardUp = false, cardInfo = '';
  for (let i = 0; i < 100 && !cardUp; i++) {
    const c = val(await ev('window.__codeW.card()')) || {};
    cardUp = c.card === true && c.host === true;
    cardInfo = J(c);
    if (!cardUp) await sleep(150);
  }
  expected(cardUp, '1b card mounted: #av-code + #av-code-host present (parent markup + avCodeUiInit)', cardInfo);
  if (!cardUp) { console.error('CODE CARD MISSING — parent adds the #av-code card + #av-code-host and boots avCodeInit/avCodeUiInit'); process.exit(1); }

  const srf = val(await ev('window.__codeW.surface()')) || {};
  expected(Array.isArray(srf.missing) && srf.missing.length === 0 && srf.hasCode === true &&
    (typeof srf.ver === 'string' || typeof srf.ver === 'number' || typeof srf.ver === 'object') &&
    srf.listFn === 'function' && srf.statusFn === 'function' && srf.init === true &&
    srf.count === 0 && srf.poisonedLen === 0 && srf.engineOk === true && srf.listOk === true && srf.statusOk === true,
    '1c API surface: all avCode* functions live · avCodeInit idempotent · window.__avCode {version, list, status} · avCodeStatus {engine, count 0, poisoned []}',
    J(srf));

  /* ── 2. live fx module + audio witness ── */
  console.log('── 2. live fx module + audio witness ──');
  const arm = val(await ev('window.__codeW.arm()')) || {};
  note('baseline armed: ' + J({ kind: arm.kind }));

  const wR = val(await ev(`(() => {
    const h = window.__avEngine;
    if (!h || h.ready !== true || !h.handle || !h.handle.ctx) return { ok: false, why: 'engine not ready' };
    try { const p = h.handle.ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { }
    return window.__codeW.witnessArm(h.handle.ctx);
  })()`)) || {};
  expected(wR.ok === true, "2a witness law: the rig's OWN AnalyserNode armed on the master tap (avMasterFor — panel reads are never witnesses)", J(wR));
  await sleep(600);

  const m1 = val(await ev('window.__codeW.measure(60, 300, 700, 0.9)')) || {};
  const A = (typeof m1.max === 'number') ? m1.max : -1;
  expected(m1.on === true && A > 0.005 && m1.n >= 10,
    '2b bypass baseline: note 60 via __avEngine.noteOn WITNESSED non-silent on the tap (rig-measured a — no planted literals)',
    J({ a: A, n: m1.n, on: m1.on }));

  const addFx = val(await ev('window.__codeW.addFx()')) || {};
  let fxRow = null;
  for (let i = 0; i < 40; i++) { fxRow = val(await ev("window.__codeW.listRow('rigfx')")); if (fxRow) break; await sleep(250); }
  const eng2 = val(await ev('window.__codeW.engineInfo()')) || {};
  expected(addFx.ok === true && addFx.kind === 'fx' && addFx.kindId == null && addFx.params !== undefined && addFx.threw === undefined &&
    fxRow && fxRow.ready === true && fxRow.enabled !== false && eng2.ready === true,
    '2c avCodeAdd(rig fx: st.oL = inL*0.5 + amt): status ok · kind fx · kindId null · avCodeList row ready · engine running (' + (eng2.tier || '?') + ')',
    J({ add: addFx, row: fxRow, eng: eng2 }));

  await sleep(500);
  const m2 = val(await ev('window.__codeW.measure(60, 300, 700, 0.9)')) || {};
  const Br = (typeof m2.max === 'number') ? m2.max : -1;
  const r2 = (A > 0) ? Br / A : null;
  expected(m2.on === true && A > 0 && Br > 0 && Br < A && r2 !== null && r2 >= 0.2 && r2 <= 0.8,
    '2d module RUNS LIVE: amt=1 default RMS ≈ half the bypass RMS — rig-measured ratio in [0.2, 0.8] (expected ≈0.5, printed)',
    J({ a: A, b: Br, ratio: (r2 === null ? null : Number(r2.toFixed(4))), n: m2.n }));

  const sp = val(await ev(`(() => {
    try {
      const ret = avCodeSetParam('rigfx', 'amt', 0.25);
      return { ret: ret === true, mirror: window.__codeW.paramGet('fx.rigfx.amt'), get: (typeof avCodeGetParam === 'function') ? avCodeGetParam('rigfx', 'amt') : 'missing' };
    } catch (e) { return { threw: String((e && e.message) || e) }; }
  })()`)) || {};
  expected(sp.ret === true && sp.mirror === 0.25 && sp.get === 0.25,
    "2e param commit: avCodeSetParam('rigfx','amt',0.25) true · avParams mirrors fx.rigfx.amt = 0.25 · avCodeGetParam echo 0.25",
    J(sp));

  await sleep(500);
  const m3 = val(await ev('window.__codeW.measure(60, 300, 700, 0.9)')) || {};
  const Cr = (typeof m3.max === 'number') ? m3.max : -1;
  const r3 = (Br > 0) ? Cr / Br : null;
  expected(m3.on === true && Br > 0 && Cr > 0 && Cr < Br && r3 !== null && r3 >= 0.05 && r3 <= 0.6,
    '2f param takes effect LIVE: amt 0.25 RMS drops FURTHER below amt 1 — rig-measured ratio in [0.05, 0.6] (expected ≈0.25, printed)',
    J({ b: Br, c: Cr, ratio: (r3 === null ? null : Number(r3.toFixed(4))), n: m3.n }));

  /* ── 3. poison (throwing module) ── */
  console.log('── 3. poison (throwing module) ──');
  const errBefore3 = errors.length;
  const pAdd = val(await ev(`(async () => {
    const h = window.__avEngine;
    const on = h.noteOn(60, 0.9);
    await window.__codeW.sleep(250);
    const r = await window.__codeW.poisonAdd();
    return { on: on === true, res: r };
  })()`)) || {};
  await sleep(900);
  const st3 = val(await ev('window.__codeW.stats()')) || {};
  let pRow = null;
  for (let i = 0; i < 40; i++) { pRow = val(await ev("window.__codeW.listRow('rigpoison')")); if (pRow && (pRow.poisoned === true || pRow.enabled === false)) break; await sleep(250); }
  const ps = val(await ev('window.__codeW.statusSnap()')) || {};
  expected(pAdd.res && pAdd.res.ok === true && pAdd.res.kind === 'fx' && pAdd.on === true &&
    st3 && typeof st3.active === 'number' && st3.active >= 1,
    '3a poison added WHILE a note plays: add ok · engine keeps rendering — stats() still answers with active >= 1 after the throwing module entered the chain',
    J({ add: pAdd.res, stats: st3 }));

  val(await ev('window.__codeW.noteOff(60)'));
  await sleep(450);
  const m4 = val(await ev('window.__codeW.measure(60, 300, 700, 0.9)')) || {};
  const F = (typeof m4.max === 'number') ? m4.max : -1;
  expected(m4.on === true && F > 0.005 && Cr > 0 && F > Cr * 0.3,
    '3b engine keeps rendering: a FOLLOWING note still sounds — witness tap, relational vs the same run amt-0.25 measurement (same chain state)',
    J({ c: Cr, follow: F, n: m4.n }));

  expected(pRow && (pRow.poisoned === true || pRow.enabled === false) && ps.has === true,
    '3c poison reported: avCodeList row poisoned/off · avCodeStatus().poisoned carries rigpoison',
    J({ row: pRow, status: ps }));

  const errAfter3 = errors.length;
  expected(errAfter3 === errBefore3,
    '3d poison never escapes: zero uncaught page errors across the poison window (count unchanged)',
    'before=' + errBefore3 + ' after=' + errAfter3 + (errAfter3 > errBefore3 ? ' | ' + errors.slice(errBefore3).join(' | ').slice(0, 300) : ''));

  const rmv = val(await ev(`(async () => { try { avCodeRemove('rigpoison'); } catch (e) { return { threw: String((e && e.message) || e) }; } await window.__codeW.sleep(400); return { done: true }; })()`)) || {};
  let pGone = false;
  for (let i = 0; i < 30; i++) { const row = val(await ev("window.__codeW.listRow('rigpoison')")); if (!row) { pGone = true; break; } await sleep(250); }
  expected(pGone === true && rmv.threw === undefined,
    '3e poison removed cleanly: avCodeRemove(rigpoison) → the row is gone from avCodeList',
    J({ pGone: pGone, rmv: rmv }));

  /* ── 4. versioned loader refusals ── */
  console.log('── 4. versioned loader refusals ──');
  const idsB4 = val(await ev('window.__codeW.listIds()'));
  const refusals = [
    ['api2', '4a versioned loader: api:2 module refused (api > 1 gate) with a clear error'],
    ['syntax', '4b versioned loader: malformed src (syntax error) refused — eval throw caught, never escapes'],
    ['badid', '4c versioned loader: bad id ("Bad Id!") refused (id charset gate)'],
    ['big', '4d versioned loader: 70 KB src (over the 65536-char cap) refused'],
  ];
  for (const [which, label] of refusals) {
    const rf = val(await ev("window.__codeW.refuse('" + which + "')")) || {};
    const extra = (which === 'big') ? ' · srcLen=' + rf.srcLen : '';
    expected(rf.ok === false && rf.threw === null && typeof rf.error === 'string' && rf.error.length > 0,
      label, J(rf) + extra);
  }
  const idsA4 = val(await ev('window.__codeW.listIds()'));
  const eng4 = val(await ev('window.__codeW.engineInfo()')) || {};
  const kind4 = val(await ev("window.__codeW.paramGet('engine.kind')"));
  expected(JSON.stringify(idsA4) === JSON.stringify(idsB4) && Array.isArray(idsA4) && idsA4.length === 1 && idsA4[0] === 'rigfx' &&
    eng4.ready === true && kind4 === arm.kind,
    '4e engine untouched by the refusals: avCodeList unchanged (rigfx only) · __avEngine still ready · engine.kind mirror unchanged',
    J({ before: idsB4, after: idsA4, eng: eng4, kind: kind4, armKind: arm.kind }));

  /* ── 5. export / import ── */
  console.log('── 5. export / import ──');
  const ex = val(await ev("window.__codeW.exportParsed('rigfx')")) || {};
  const exText = (typeof ex.text === 'string') ? ex.text : null;
  expected(ex.isStr === true && ex.parse === true && ex.format === 'anvil-module' && ex.api === 1 && ex.id === 'rigfx' && ex.kind === 'fx' && ex.srcEq === true && ex.paramsIsObj === true,
    '5a export round-trip: avCodeExportText parses · format anvil-module · api 1 · id/kind/src EXACT · params object',
    J({ len: ex.len, format: ex.format, api: ex.api, id: ex.id, kind: ex.kind, srcEq: ex.srcEq, srcLen: ex.srcLen, paramsIsObj: ex.paramsIsObj, amt: ex.amt }));
  note('5a note: exported params.amt = ' + J(ex.amt) + ' (0.25 expected if records mirror the committed value — printed, not asserted; SPEC note b)');

  await ev(`(async () => { try { avCodeRemove('rigfx'); } catch (e) { } await window.__codeW.sleep(500); return true; })()`);
  let gone5 = false;
  for (let i = 0; i < 30; i++) { const ids = val(await ev('window.__codeW.listIds()')); if (Array.isArray(ids) && ids.indexOf('rigfx') < 0) { gone5 = true; break; } await sleep(250); }
  const imp = val(await ev(`window.__codeW.importText(${JSON.stringify(exText || '')})`)) || {};
  let back5 = null;
  for (let i = 0; i < 40; i++) { back5 = val(await ev("window.__codeW.listRow('rigfx')")); if (back5) break; await sleep(250); }
  const amtEcho = val(await ev("window.__codeW.paramGet('fx.rigfx.amt')"));
  expected(gone5 === true && exText !== null && imp.ok === true && back5 && back5.ready === true && back5.kind === 'fx',
    '5b import re-adds: rigfx removed, then avCodeImportText(export) accepted — ok · list row ready · kind fx',
    J({ gone: gone5, imp: imp, row: back5, amtEcho: amtEcho }));

  const foreign = [
    '{"format":"foreign-module","api":1,"id":"x","name":"x","kind":"fx","src":"return {};"}',
    'definitely not json {{{',
    ''
  ];
  const fRes = [];
  for (let i = 0; i < foreign.length; i++) {
    const r = val(await ev(`window.__codeW.importText(${JSON.stringify(foreign[i])})`)) || {};
    fRes.push(r);
  }
  const ids5 = val(await ev('window.__codeW.listIds()'));
  const fOK = fRes.every(r => r && r.ok === false && typeof r.error === 'string' && r.threw === undefined && r.raw === undefined);
  expected(fOK && JSON.stringify(ids5) === JSON.stringify(['rigfx']),
    '5c foreign import refused honestly: wrong format · not JSON · empty — every ok:false with an error, list unchanged',
    J({ res: fRes, ids: ids5 }));

  /* ── 6. user kind module (sine + env) ── */
  console.log('── 6. user kind module (sine + env) ──');
  const kAdd = val(await ev('window.__codeW.kindAdd()')) || {};
  let kRow = null;
  for (let i = 0; i < 40; i++) { kRow = val(await ev("window.__codeW.listRow('rigkind')")); if (kRow) break; await sleep(250); }
  const kinds = val(await ev('window.__codeW.kindsList()')) || [];
  const kid = (kAdd && typeof kAdd.kindId === 'number') ? kAdd.kindId : null;
  const kEntry = Array.isArray(kinds) ? kinds.find(k => k && k.kindId === kid) : null;
  expected(kAdd.ok === true && kAdd.kind === 'kind' && typeof kAdd.kindId === 'number' && kAdd.kindId >= 64 &&
    kRow && kRow.ready === true && kEntry && kEntry.kindId >= 64,
    '6a kind add: first free user kindId >= 64 · list row ready · avCodeKinds() lists the entry',
    J({ add: kAdd, row: kRow, entry: kEntry || null, kinds: kinds }));

  const kName = (kEntry && typeof kEntry.name === 'string' && kEntry.name.length) ? kEntry.name
    : (kRow && typeof kRow.name === 'string' && kRow.name.length) ? kRow.name : 'rigkind';
  const ap = val(await ev(`window.__codeW.applyKind(${JSON.stringify(kName)})`)) || {};
  await sleep(250);
  expected(ap.ret === true && ap.echo === kName,
    "6b engine.kind accepts the user kind: avApplyParam('engine.kind', " + J(kName) + ") true + mirror echo",
    J({ kName: kName, ap: ap }));

  await sleep(250);
  const m5 = val(await ev('window.__codeW.measure(60, 300, 700, 0.9)')) || {};
  const K = (typeof m5.max === 'number') ? m5.max : -1;
  expected(m5.on === true && K > 0.005 && Cr > 0 && K > Cr * 0.25,
    '6c user kind SOUNDS: note 60 routed to the rig sine+env kind → tap witness non-silent (rig-measured, relational vs amt-0.25 chain)',
    J({ c: Cr, kind: K, n: m5.n }));

  const selInfo = val(await ev(`window.__codeW.engineSelect(${JSON.stringify(kName)})`)) || {};
  expected(selInfo.found === true && selInfo.match === true,
    '6d synth card: #av-synth-engine carries the user kind option (parent-integrated avCodeKinds() append)',
    J(selInfo));

  /* ── 7. UI path ── */
  console.log('── 7. UI path ──');
  await ev(`(() => { const el = document.getElementById('av-code'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' }); return true; })()`);
  await sleep(300);
  let exInfo = null;
  for (let i = 0; i < 20; i++) { exInfo = val(await ev('window.__codeW.examples()')) || {}; if (exInfo.btns >= 3) break; await sleep(250); }
  exInfo = exInfo || {};
  expected(exInfo.btns >= 3 && Array.isArray(exInfo.keys) && exInfo.keys.length >= 3 && exInfo.keys.indexOf('tremolo') >= 0 && typeof exInfo.tremLen === 'number' && exInfo.tremLen > 0,
    '7a examples: >= 3 buttons in #av-code-examples · avCodeExamples() >= 3 (tremolo/bitcrush/fold) · avCodeExample("tremolo") yields src',
    J(exInfo));

  const fill = val(await ev('window.__codeW.uiFill()')) || {};
  note('editor filled: ' + J(fill));
  const runClicked = await clickSel('#av-code-run', 500);
  let uiRow = null;
  for (let i = 0; i < 40; i++) { uiRow = val(await ev("window.__codeW.listRow('tremolo')")); if (uiRow) break; await sleep(300); }
  expected(fill.present && fill.present.src === true && fill.present.id === true && fill.present.kind === true && fill.usedFallback !== true && fill.srcLen > 0 && runClicked === true && uiRow && uiRow.ready === true && uiRow.kind === 'fx',
    '7b UI run: tremolo example into #av-code-src (+ id/name/kind) · #av-code-run click → list grows with a ready fx row',
    J({ fill: fill, runClicked: runClicked, row: uiRow }));

  let knobs = null;
  for (let i = 0; i < 6; i++) { knobs = val(await ev("window.__codeW.paramsRead('tremolo')")); if (knobs && knobs.forSel >= 2) break; await sleep(400); }
  let tgt = null, clickedRow = false;
  if (!knobs || !(knobs.forSel >= 2)) {
    tgt = val(await ev("window.__codeW.uiTarget('tremolo')")) || {};
    if (tgt.found === true) {
      await mouse('mousePressed', tgt.x, tgt.y);
      await sleep(30);
      await mouse('mouseReleased', tgt.x, tgt.y);
      clickedRow = true;
      for (let i = 0; i < 30; i++) { knobs = val(await ev("window.__codeW.paramsRead('tremolo')")); if (knobs && knobs.forSel >= 2) break; await sleep(300); }
    }
  }
  expected(knobs && knobs.found === true && typeof knobs.n === 'number' && knobs.n >= 2 && knobs.forSel >= 2,
    '7c params panel: >= 2 knobs mounted for the tremolo selection (data-knob paths fx.tremolo.*)',
    J({ knobs: knobs, target: tgt, clicked: clickedRow }));

  const stopClicked = await clickSel('#av-code-stop', 500);
  let removedUi = false;
  for (let i = 0; i < 30; i++) { const ids = val(await ev('window.__codeW.listIds()')); if (Array.isArray(ids) && ids.indexOf('tremolo') < 0) { removedUi = true; break; } await sleep(300); }
  expected(stopClicked === true && removedUi === true,
    '7d #av-code-stop click removes the selected module (list no longer contains tremolo)',
    J({ stopClicked: stopClicked, removed: removedUi }));

  const uiS = val(await ev('window.__codeW.uiSnap()')) || {};
  const badStatus = /fail|error|refus/i.test(uiS.statusText || '');
  const zeroClaim = /no modules|library is empty|0 modules/i.test(uiS.statusText || '');
  expected(typeof uiS.statusText === 'string' && uiS.statusText.length > 0 && badStatus === false && zeroClaim === false &&
    Array.isArray(uiS.ids) && uiS.ids.length >= 2 && uiS.ids.indexOf('tremolo') < 0,
    '7e #av-code-status truthful: non-empty · no failure wording while run/stop succeeded · no zero-modules claim while rig modules stay loaded',
    J(uiS));

  /* ── 8. seal — screenshot, cleanup, errors, freeze ── */
  console.log('── 8. seal ──');
  const shot = await snapCard('#av-code', shotPath);
  expected(shot.ok === true, '8a screenshot: renders/code-suite.png (the CODE card, scale 2 — taken while modules are live)', shot.info);

  const cl = val(await ev('window.__codeW.cleanup()')) || {};
  let cleanIds = null;
  for (let i = 0; i < 40; i++) {
    cleanIds = val(await ev('window.__codeW.listIds()'));
    if (Array.isArray(cleanIds) && !cleanIds.some(x => ['rigfx', 'rigpoison', 'rigkind', 'tremolo'].indexOf(x) >= 0)) break;
    await sleep(300);
  }
  const engEnd = val(await ev('window.__codeW.engineInfo()')) || {};
  expected(Array.isArray(cleanIds) && cleanIds.length === 0 && cl.held === 0 && cl.kindNow === cl.kindWant && cl.amtMirror === 'absent' && engEnd.ready === true,
    '8b cleanup: all rig modules removed · engine.kind restored to the armed value · notes released · fx rig param mirror dropped · engine still ready',
    J({ cl: cl, finalIds: cleanIds, eng: engEnd }));

  expected(errors.length === 0, '8c zero page errors across the whole run (exceptions · Log errors · console.error)',
    'page errors=' + errors.length + (errors.length ? ' | ' + errors.slice(0, 3).join(' | ') : ''));

  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after): ' + shaAfter);
  expected(shaAfter === shaBefore, '8d freeze: index.html sha256 before === after (unchanged by the run)', shaAfter);

  /* freeze pin leg — a note while EXPECT_SHA is null, a check once pinned */
  if (PIN) expected(shaBefore === PIN && shaAfter === PIN, 'pin leg: index.html sha256 = pinned', 'pinned ' + PIN.slice(0, 12) + '...');
  else note('EXPECT_SHA not pinned — after the S5 build, pass --sha <hex> or set the constant (never loosen)');

  console.log('');
  console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
  console.log('S5-CODE-RESULT ' + JSON.stringify({ kind: 'anvil-cdp-code', sha256Before: shaBefore, sha256After: shaAfter, pinned: PIN || null, passed: pass, failed: fail, checks: pass + fail, verdict: fail ? 'fail' : 'pass' }));
  console.log(fail ? 'S5 CODE FAILED' : 'S5 CODE PASSED');
  try { ws.close(); } catch { /* done */ }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('code harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    /* profile-scoped cleanup (LAW): kill ONLY processes whose command line carries OUR temp
       profile — matched by its unique basename, so the pattern needs no backslash escaping */
    const tag = path.basename(profile);
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
