// cdp_m1.mjs — Anvil M1 wave suite (rig sa-G; WRITTEN by sa-G, RUN BY THE PARENT after the M1
// integration build). End-to-end over raw CDP against the frozen single-file build.
//
//   node verify/cdp_m1.mjs [path-to-index.html] [--port N] [--sha <hex>] > verify/last-cdp_m1.log 2>&1
//
// WRITE-ONLY: this file is authored by sa-G and never executed by sa-G. The parent runs it after
// the M1 integration build (index.html must contain av_fm.js / av_fx_aw.js / av_fx_conv.js in the
// worklet concat + av_fm_ui.js / av_wt.js / av_wt_ui.js as page parts; body.html must carry the
// #av-fm and #av-wt cards + hosts; app_core boots avFmUiInit/avWtUiInit; av_dsp routes
// engine.kind "fm", fx.aw/fx.conv and wt.user<N> — verify/_m1_wave.md §2/§4).
//
// LAUNCH SKELETON: copied VERBATIM from cdp_s5.mjs (candidates Chrome/Edge/Brave, free-port scan,
// fresh temp --user-data-dir + profile-scoped cleanup, 1440x900 device metrics override — Edge
// headless ignores --window-size, --mute-audio, --autoplay-policy=no-user-gesture-required, ONE
// browser, explicit exit, process.on('exit') kills ONLY processes whose command line carries OUR
// temp profile). The S5 popup-target machinery (about:blank enumeration / attach / popEv) is
// intentionally dropped — M1 has no popout legs. New here: a Page.javascriptDialogOpening
// auto-dismiss belt so no native dialog can ever block the headless page.
//
// SHA FREEZE DISCIPLINE from cdp_s5/deck: index.html is sha256'd before and after the run and
// before === after is ALWAYS enforced. EXPECT_SHA stays null (the M1 freeze sha does not exist at
// authoring time) until the parent pins it (constant below or --sha <hex>); while null the rig
// still enforces before === after and prints a pin note (never loosened).
//
// WHAT IT PROVES, in order (contract: verify/_m1_wave.md §2.7 — 6 check groups, ~32 checks):
//   group 1 — cards:
//     1a boot (data-av-ready · engine ctx found/running/spc/sr 48k)
//     1b __m1w rig helpers injected
//     1c #av-fm card + #av-fm-host · 6 op tabs (data-op 1-6) · active op panel · #av-fm-status
//     1d #av-fm-algo select.av-select[data-param="fm.algo"] (>=8 opts) · fm.* knobs all
//        data-knob-bound="1" incl fm.fb + fm.volume · #av-fm-algo-view painted
//     1e #av-wt card + host · 2D canvas · tools row / frames strip / morph / harmonics ·
//        library · new/import/export/install/audition + status
//     1f window.__avFmUi + window.__avWtUi (init/snap/classes/sync members) + window.__avWt
//     1g avFmUiClasses()/avWtUiClasses() return clean new-class-name string arrays
//   group 2 — FM engine:
//     2a avApplyParam("engine.kind","fm") accepted + avParams mirror echo
//     2b the #av-synth-engine select reflects: fm option present, value fm, the fm panel shown
//     2c witness law: the RIG OWN AnalyserNode armed on avMasterNodes() (panel reads are never
//        witnesses)
//     2d avNoteDown(c4) held -> rig analyser RMS above the silence floor (+ stats active >= 1)
//     2e fm.op2.level 0 -> 0.8 changes the spectrum (bin-energy L1 delta)
//     2f fm.algo 0 -> 3 changes the spectrum
//     2g avNoteUp -> signal decays back to the floor
//   group 3 — FLAVOUR:
//     3a fx.aw.on=1 · mode tape · amount 0.7 -> spectrum delta vs bypass (analyser)
//     3b avFxSnap() 6-7 strips · order carries aw + conv · strips === order.length
//     3c engine stats().fxChain carries "aw"
//   group 4 — CONV:
//     4a fx.conv.on=1 (plate · mix 0.7) -> note-off tail RMS above the bypass tail
//     4b mode sweep plate/room/hall/spring/cab/user all accepted (no throw, receipt true)
//     4c synthetic delta impulse via avEngineConv(...) -> true (shape asserted rig-side)
//     4d mode "user" after the load produces signal
//     4e #av-fx-conv-import control exists
//   group 5 — WT:
//     5a avWtNew + seed saw + avWtInstall -> receipt ok (slot 0..15)
//     5b avWtInstalled mirror + avWtUserOscNames carry wt.user<slot>
//     5c engine stats().uwt >= 1 (user wavetable landed)
//     5d osc2.type="wt.user0" + osc2 level up (osc1 0) -> signal
//     5e its spectrum differs from wt.sine (seeded saw has more harmonics)
//     5f #av-wt-canvas pointer stroke -> frame signature / canvas digest change (no-stroke control)
//   group 6 — freeze pin leg (sha=pinned) — passes when EXPECT_SHA is set and matches.
//   seal: S1 screenshot renders/m1-suite.png · S2 cleanup (notes released, M1 params restored to
//      the armed values, witness detached) · S3 zero page errors · S4 sha256 before === after.
//
// HARNESS LAWS (house): one browser at a time; wait for the file:// target; the rig installs its
// OWN AnalyserNode on the master tap (avMasterNodes(); panel/UI reads are never witnesses); notes
// play via the avNote bus (avNoteDown/avNoteUp — the fresh-page default pattern is EMPTY; every
// note leg plays its own note); every assertion below reads machine observables (globals, DOM,
// engine stats RPC) — never console text. ?AVTEST LAW: this run uses the plain file:// page (no
// ?avtest=1 — the reads ride the M1 modules alone; deck/code precedent); if an app proof surface
// were ever needed it would be the ?avtest=1 machine objects (window.__av*Test / the av-*test DOM
// lines), never scraped console output.
//
// RIG-OWN FIXTURES (never planted literals where the app computes): the silence floor, the note
// RMS, the spectral bin-energy L1 deltas and the tail RMS all come from the rig's own analyser;
// param/kind/select/panel reads come from the app's own mirror + DOM. The synthetic conv impulse
// (delta: Float64Array 4096, ch1[0] = 1, ch2 mirror) is rig-authored and its shape is asserted as
// part of 4c.
//
// SPEC NOTES (sa-G, for the first parent run — fix the EXPECTATION to the check's stated intent,
// never loosen strength):
//   (a) avFxSnap strips is asserted inside the wave's stated 6-7 window with aw AND conv required
//       in the order (the §3 gate names 7 strips drive,aw,mod,delay,verb,conv,dyn); the actual
//       order lands in the info dump.
//   (b) Spectrum deltas are relational (bin-energy L1 / max(total)) — the 0.10 threshold for the
//       modulator/algo/saw-vs-sine legs and the 0.02 (or high-band fraction 0.004) threshold for
//       the tape flavour are fixture magnitudes, not path strength.
//   (c) §2.7 group 1 requires window.__avWt; §2.5 declares only the top-level avWt* functions —
//       check 1f therefore requires __avFmUi + __avWtUi (both pinned with member sets) AND
//       __avWt (object|function). If the first run fails only on __avWt, the SPEC fix is adding
//       the window.__avWt handle in av_wt.js (or correcting the §2.7 wording) — never loosen 1f.
//   (d) The WT stroke check (5f) reads avWtSnap()/avWtUiSnap() through a shape-blind sum-walk
//       signature plus the canvas digest, with a no-stroke control window; all three channels land
//       in the info so the parent can see which one changed (the snap shapes are not pinned).
//   (e) #av-wt-new is clicked through a rig-owned prompt/confirm/alert stub (a native dialog would
//       block the headless page; the CDP dialog belt backs it up) and restored immediately.
//   (f) The conv mode sweep includes "user" before any impulse is loaded — the documented honest
//       dry pass; the loaded-impulse path is proven by 4c/4d after it.
//   (g) Groups 3-5 run on engine kind "va" (rich saw input for a bus flavour and the osc2 legs) —
//       a fixture choice; cleanup restores the armed kind.
//   (h) Worklet setParam is fire-and-forget by design (av_engine.js header) — "receipt true" means
//       accepted for delivery; the real acceptance proof for fm/aw/conv/wt is the signal +
//       spectrum legs (2e/2f, 3a, 4a/4d, 5d/5e), never the boolean alone.
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
   M1: the frozen sha of the integrated index.html is not known until build.py runs and the parent
   pins it — EXPECT_SHA stays null; the rig never loosens the before === after check. */
const EXPECT_SHA = 'a85af992e99e7ce17dbf2217baba578c2f52882856fa3dd22883db100b74e861';
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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9720);
const profile = path.join(tmpdir(), 'anvil-m1-' + Date.now());
const DL_DIR = path.join(tmpdir(), 'anvil-m1-dl-' + Date.now());
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
const fx3 = (x) => (x == null || typeof x !== 'number' || !isFinite(x)) ? String(x) : Number(x).toFixed(3);
const fx4 = (x) => (x == null || typeof x !== 'number' || !isFinite(x)) ? String(x) : Number(x).toFixed(4);
const J = (x) => { try { return JSON.stringify(x); } catch (e) { return String(x); } };

const chrome = spawn(exe, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--disable-sync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--disable-popup-blocking', '--allow-file-access-from-files',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  url,
], { stdio: 'ignore', windowsHide: true });

const errors = [];

/* ---------- page-side scaffolding injected at runtime (rig-owned; never app code) ----------
   __m1w: the rig's OWN witness / spectra / legs / probes —
     witArm/witRelease/rms: the RIG OWN AnalyserNode on avMasterNodes() (witness law — panel
                 reads are never witnesses), rms(ms, delayMs) = a max/mean RMS window;
     spec0/spec1/specDrop: page-side FFT bin snapshots (1024 linear bins, 4 reads max-per-bin)
                 and the L1/max(total) delta between them — Float32 data never crosses CDP;
     notes: the ONE avNote bus (avNoteDown/avNoteUp/avNoteStopAll + window.__avNotes);
     paramGet/apply/kindApply: avParams mirror reads + avApplyParam receipts; kindApply also
                 drives #av-synth-engine like a user (value + change) and reads the fm panel;
     fxSnap/stats: avFxSnap() and the engine stats() RPC (uwt + fxChain fields, §2.7);
     convLoad/convSweep: the synthetic delta impulse through avEngineConv + the mode receipts;
     wtInstall/wtSig/stroke: the avWt* core calls, the shape-blind signature walk (avWtSnap /
                 avWtUiSnap / canvas digest) and the #av-wt-canvas pointer stroke;
     fmCard/fmWired/wtCard/handles/classes: pinned DOM + handle probes;
     arm/cleanup/dlgOn/dlgOff/clickId: the baseline snapshot, the full M1 restore, the dialog
                 stubs for the #av-wt-new click. Every read is tolerant/null-honest; nothing
                 plants values where the app computes. The function is stringified into the page,
                 so it must not reference anything outside its own body. */
const M1W_INSTALL = function () {
  window.__m1w = (function () {
    var W = { v: 1, wit: null, s0: null, orig: null, dlg: null };

    /* ---- tiny utils ---- */
    W.num = function (x) { return (typeof x === 'number' && isFinite(x)) ? x : null; };
    W.safe = function (x) { try { return JSON.parse(JSON.stringify(x)); } catch (e) { return null; } };
    W.j = function (x) { try { return JSON.stringify(x); } catch (e) { return String(x); } };
    W.light = function (x) {
      if (x === undefined || x === null) return null;
      if (typeof x !== 'object') return x;
      var out = {}, n = 0, k;
      for (k in x) {
        if (n >= 14) break;
        var v = null;
        try { v = x[k]; } catch (e) { v = null; }
        var t = typeof v;
        if (t === 'number') { out[k] = isFinite(v) ? v : String(v); n++; }
        else if (t === 'string') { out[k] = v.length > 64 ? v.slice(0, 64) : v; n++; }
        else if (t === 'boolean' || v === null) { out[k] = v; n++; }
        else if (Object.prototype.toString.call(v) === '[object Array]') { out[k] = 'array[' + v.length + ']'; n++; }
        else if (t === 'object') { out[k] = 'obj'; n++; }
        else { out[k] = t; n++; }
      }
      return out;
    };
    W.domGet = function (id) { try { return document.getElementById(id); } catch (e) { return null; } };
    W.visible = function (el) { try { if (!el) return false; var r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; } catch (e) { return false; } };
    W.counter = function (sel, root) { try { return (root || document).querySelectorAll(sel).length; } catch (e) { return -1; } };
    W.paths = function (sel, root) {
      try {
        var out = [], els = (root || document).querySelectorAll(sel), i;
        for (i = 0; i < els.length && i < 200; i++) out.push(String(els[i].getAttribute('data-knob') || ''));
        return out;
      } catch (e) { return null; }
    };
    W.bound = function (sel, root) {
      try {
        var els = (root || document).querySelectorAll(sel), i, b = 0;
        for (i = 0; i < els.length; i++) if (els[i].dataset && els[i].dataset.knobBound === '1') b++;
        return { n: els.length, bound: b };
      } catch (e) { return { n: -1, bound: -1 }; }
    };
    W.digestData = function (img) {
      try {
        var d = img.data, hist = [], bi;
        for (bi = 0; bi < 24; bi++) hist[bi] = 0;
        var sumLum = 0, nonBlack = 0, n = 0, i;
        for (i = 0; i < d.length; i += 4) {
          var lum = d[i] + d[i + 1] + d[i + 2];
          sumLum += lum;
          if (lum > 24) nonBlack++;
          hist[(lum >> 5) < 23 ? (lum >> 5) : 23]++;
          n++;
        }
        var bg = 0, bgN = -1, b;
        for (b = 0; b < 24; b++) if (hist[b] > bgN) { bgN = hist[b]; bg = b; }
        var bgMid = bg * 32 + 16, thr = bgMid + 72, ink = 0, inkSum = 0;
        for (i = 0; i < d.length; i += 4) {
          var lum2 = d[i] + d[i + 1] + d[i + 2];
          if (lum2 > thr) { ink++; inkSum += (lum2 - bgMid); }
        }
        return { ok: true, w: img.width, h: img.height, n: n, sumLum: sumLum, nonBlack: nonBlack, ink: ink, inkSum: inkSum };
      } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
    };
    W.digestEl = function (el) {
      try {
        if (!el || !el.width || !el.height) return { ok: false, why: 'no canvas' };
        var g = (el.getContext ? el.getContext('2d') : null);
        if (!g || typeof g.getImageData !== 'function') return { ok: false, why: 'no 2d context' };
        return W.digestData(g.getImageData(0, 0, el.width, el.height));
      } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
    };

    /* ---- notes (the ONE avNote bus) ---- */
    W.notes = function () { try { return (typeof window.__avNotes === 'function') ? window.__avNotes() : null; } catch (e) { return null; } };
    W.held = function () { var s = W.notes(); return (s && Object.prototype.toString.call(s.held) === '[object Array]') ? s.held.length : null; };
    W.down = function (name, vel) {
      var out = { name: name, fresh: null, err: null };
      try { out.fresh = (typeof vel === 'number') ? (avNoteDown(name, vel) === true) : (avNoteDown(name) === true); }
      catch (e) { out.err = String((e && e.message) || e); }
      out.held = W.held();
      return out;
    };
    W.up = function (name) {
      var out = { name: name, ret: null, err: null };
      try { out.ret = (avNoteUp(name) === true); } catch (e) { out.err = String((e && e.message) || e); }
      out.held = W.held();
      return out;
    };
    W.stopAll = function () { try { if (typeof avNoteStopAll === 'function') avNoteStopAll(); } catch (e) { /* fine */ } return W.held(); };

    /* ---- params ---- */
    W.paramGet = function (path) {
      try {
        if (typeof avParams !== 'undefined' && avParams && avParams[path] !== undefined && avParams[path] !== null) {
          var v = avParams[path];
          if (typeof v === 'number') return isFinite(v) ? v : null;
          if (typeof v === 'string' || typeof v === 'boolean') return v;
        }
      } catch (e) { /* mirror unreadable */ }
      return null;
    };
    W.apply = function (path, v) {
      var out = { path: path, v: v, ret: null, err: null };
      try { out.ret = (typeof avApplyParam === 'function') ? (avApplyParam(path, v) === true) : 'no-avApplyParam'; }
      catch (e) { out.err = String((e && e.message) || e); }
      out.echo = W.paramGet(path);
      return out;
    };

    /* ---- witness: the rig OWN AnalyserNode on the master tap (witness law) ---- */
    W.witArm = function () {
      try {
        W.witRelease();
        if (typeof avMasterNodes !== 'function') return { ok: false, why: 'avMasterNodes missing' };
        var nodes = avMasterNodes() || [];
        var node = null, i;
        for (i = 0; i < nodes.length; i++) { if (nodes[i] && nodes[i].gain && nodes[i].context) { node = nodes[i]; break; } }
        if (!node) return { ok: false, why: 'no master node with a gain + context', n: nodes.length };
        var ctx = node.context;
        var an = ctx.createAnalyser();
        an.fftSize = 2048;
        an.smoothingTimeConstant = 0;
        node.connect(an);
        W.wit = { an: an, td: new Float32Array(an.fftSize), fd: new Float32Array(an.frequencyBinCount), sr: ctx.sampleRate, node: node };
        return { ok: true, sr: ctx.sampleRate, fft: an.fftSize, nodes: nodes.length, ctxState: String(ctx.state) };
      } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
    };
    W.witRelease = function () {
      var had = !!W.wit;
      if (W.wit) { try { W.wit.an.disconnect(); } catch (e) { /* gone */ } W.wit = null; }
      return { had: had };
    };
    W.rms = function (ms, delayMs) {
      return new Promise(function (resolve) {
        var wit = W.wit;
        if (!wit || !wit.an) { resolve({ ok: false, why: 'witness not armed' }); return; }
        var start = function () {
          var max = 0, sum = 0, n = 0;
          var read = function () {
            try {
              wit.an.getFloatTimeDomainData(wit.td);
              var s = 0, i;
              for (i = 0; i < wit.td.length; i++) { var v = wit.td[i]; s += v * v; }
              var r = Math.sqrt(s / wit.td.length);
              if (r > max) max = r;
              sum += r; n++;
            } catch (e) { /* one lost read */ }
          };
          var iv = setInterval(read, 8);
          setTimeout(function () {
            try { clearInterval(iv); } catch (e) { /* fine */ }
            resolve({ ok: true, max: max, mean: n ? sum / n : 0, n: n });
          }, ms);
        };
        if (delayMs > 0) setTimeout(start, delayMs); else start();
      });
    };

    /* ---- spectra: 1024 linear bins, 4 async reads, max per bin; delta = L1 / max(total) ---- */
    W._capAsync = function () {
      return new Promise(function (resolve) {
        var wit = W.wit;
        if (!wit || !wit.an) { resolve(null); return; }
        var out = new Float64Array(wit.fd.length), i;
        for (i = 0; i < out.length; i++) out[i] = 0;
        var r = 0;
        var tick = function () {
          try {
            wit.an.getFloatFrequencyData(wit.fd);
            for (var j = 0; j < out.length; j++) {
              var db = wit.fd[j];
              var p = isFinite(db) ? Math.pow(10, db / 20) : 0;
              if (p > out[j]) out[j] = p;
            }
          } catch (e) { /* one lost read */ }
          r++;
          if (r < 4) setTimeout(tick, 40); else resolve(out);
        };
        tick();
      });
    };
    W._bands = function (c) {
      var tot = 0, low = 0, mid = 0, high = 0, i;
      for (i = 2; i < c.length; i++) {
        tot += c[i];
        if (i < 32) low += c[i]; else if (i < 256) mid += c[i]; else high += c[i];
      }
      return { tot: tot, low: low, mid: mid, high: high };
    };
    W.spec0 = function () {
      return W._capAsync().then(function (c) {
        if (!c) return { ok: false, why: 'witness not armed' };
        W.s0 = c;
        var s = W._bands(c);
        return { ok: true, tot: s.tot, low: s.low, mid: s.mid, high: s.high, bins: c.length };
      });
    };
    W.spec1 = function () {
      return W._capAsync().then(function (c) {
        if (!c) return { ok: false, why: 'witness not armed' };
        if (!W.s0) return { ok: false, why: 'no baseline snapshot' };
        var a = W.s0, l1 = 0, ta = 0, tb = 0, i;
        for (i = 0; i < a.length && i < c.length; i++) { var d = a[i] - c[i]; if (d < 0) d = -d; l1 += d; ta += a[i]; tb += c[i]; }
        var ba = W._bands(a), bb = W._bands(c);
        return {
          ok: true, l1: l1, rel: l1 / Math.max(ta, tb, 1e-12), totA: ta, totB: tb,
          lowA: ba.low, lowB: bb.low, midA: ba.mid, midB: bb.mid, highA: ba.high, highB: bb.high,
          highFracA: ba.tot ? ba.high / ba.tot : 0, highFracB: bb.tot ? bb.high / bb.tot : 0, bins: c.length
        };
      });
    };
    W.specDrop = function () { W.s0 = null; return true; };

    /* ---- engine.kind: the pinned call + the user path (select value + change) + panel ---- */
    W.kindApply = function (v) {
      var out = { v: v };
      try { out.direct = (typeof avApplyParam === 'function') ? (avApplyParam('engine.kind', v) === true) : 'no-avApplyParam'; }
      catch (e) { out.direct = 'threw: ' + String((e && e.message) || e); }
      out.mirror = W.paramGet('engine.kind');
      try {
        var sel = W.domGet('av-synth-engine');
        if (!sel) { out.sel = null; }
        else {
          out.opts = [];
          for (var i = 0; i < sel.options.length && i < 40; i++) out.opts.push(String(sel.options[i].value).slice(0, 40));
          out.optMatch = out.opts.indexOf(v) >= 0;
          out.sel0 = String(sel.value);
          try { sel.value = v; } catch (e0) { out.valueErr = String((e0 && e0.message) || e0); }
          try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (e1) { out.dispatchErr = String((e1 && e1.message) || e1); }
          out.sel1 = String(sel.value);
        }
      } catch (e2) { out.selErr = String((e2 && e2.message) || e2); }
      out.mirror2 = W.paramGet('engine.kind');
      var panel = null;
      try { panel = document.querySelector('#av-synth-knobs .av-synth-panel[data-kind="' + v + '"]'); } catch (e3) { panel = null; }
      out.panel = panel ? { present: true, hidden: (panel.hidden === true) || (String(panel.style.display) === 'none') } : { present: false };
      return out;
    };

    /* ---- fx rack + engine stats ---- */
    W.fxSnap = function () {
      try {
        var s = (typeof avFxSnap === 'function') ? avFxSnap() : ((window.__avFx && typeof window.__avFx.snap === 'function') ? window.__avFx.snap() : null);
        if (!s) return { found: false };
        return {
          found: true, version: s.version, inited: s.inited === true, host: !!s.host, wired: s.wired === true,
          strips: W.num(s.strips), order: W.safe(s.order), expect: W.light(s.expect),
          classes: (Object.prototype.toString.call(s.classes) === '[object Array]') ? s.classes.length : null
        };
      } catch (e) { return { found: false, err: String((e && e.message) || e) }; }
    };
    W.stats = function () {
      return new Promise(function (resolve) {
        try {
          var e = window.__avEngine;
          if (!e || typeof e.stats !== 'function') { resolve({ ok: false, why: 'no __avEngine.stats' }); return; }
          Promise.resolve(e.stats()).then(function (s) {
            if (!s) { resolve({ ok: false, why: 'stats returned null' }); return; }
            resolve({ ok: true, active: W.num(s.active), uwt: W.num(s.uwt), fxChain: (typeof s.fxChain === 'string') ? s.fxChain : null, sr: W.num(s.sr), maxVoices: W.num(s.maxVoices), keys: W.light(s) });
          }, function (er) { resolve({ ok: false, why: 'stats rejected: ' + String((er && er.message) || er) }); });
        } catch (e2) { resolve({ ok: false, why: String((e2 && e2.message) || e2) }); }
      });
    };

    /* ---- CONV legs ---- */
    W.convLoad = function () {
      var out = { fn: typeof avEngineConv };
      try {
        if (typeof avEngineConv !== 'function') { out.err = 'avEngineConv missing'; return out; }
        var eng = window.__avEngine || {};
        var sr = (typeof eng.sr === 'number' && isFinite(eng.sr)) ? eng.sr : 48000;
        out.sr = sr;
        var n = 4096;
        var ch1 = new Float64Array(n); ch1[0] = 1;
        var ch2 = new Float64Array(n); ch2[0] = 1;
        out.len = n;
        out.shape = { t1: Object.prototype.toString.call(ch1), n1: ch1.length, first: ch1[0], rest: ch1[1] };
        var r = avEngineConv(0, 'm1-delta', sr, ch1, ch2);
        out.ret = (r === true) ? true : String(r);
      } catch (e) { out.err = String((e && e.message) || e); }
      return out;
    };
    W.convSweep = function (modes) {
      var out = { tried: [] }, i;
      for (i = 0; i < modes.length; i++) {
        var a = W.apply('fx.conv.mode', modes[i]);
        out.tried.push({ m: modes[i], ret: a.ret, err: a.err });
      }
      out.allTrue = true;
      for (i = 0; i < out.tried.length; i++) if (out.tried[i].ret !== true) out.allTrue = false;
      return out;
    };

    /* ---- WT legs ---- */
    W.wtInstall = function () {
      var out = { missing: [] };
      var need = ['avWtNew', 'avWtAddFrame', 'avWtFrameCount', 'avWtSeedFrom', 'avWtInstall', 'avWtInstalled', 'avWtUserOscNames'];
      for (var i = 0; i < need.length; i++) if (typeof window[need[i]] !== 'function') out.missing.push(need[i]);
      if (out.missing.length) return out;
      try {
        var t = avWtNew('m1-rig-saw');
        out.frames0 = avWtFrameCount(t);
        if (!(out.frames0 >= 1)) { avWtAddFrame(t); out.frames1 = avWtFrameCount(t); }
        avWtSeedFrom(t, 0, 'saw');
        var r = avWtInstall(t);
        out.receipt = W.light(r);
        out.ok = !!(r && r.ok === true);
        out.slot = (r && typeof r.slot === 'number') ? r.slot : null;
        try { out.installed = W.safe(avWtInstalled()); } catch (e) { out.installedErr = String((e && e.message) || e); }
        try { out.oscNames = W.safe(avWtUserOscNames()); } catch (e2) { out.oscNamesErr = String((e2 && e2.message) || e2); }
      } catch (e3) { out.err = String((e3 && e3.message) || e3); }
      return out;
    };
    W.walkSum = function (x) {
      var acc = { n: 0, sum: 0, strs: 0, cap: 4000 };
      var rec = function (v, d) {
        if (acc.n >= acc.cap || d > 4 || v === undefined || v === null) return;
        var t = typeof v;
        if (t === 'number') { if (isFinite(v)) { acc.n++; acc.sum += v; } return; }
        if (t === 'string') { acc.strs++; return; }
        if (t === 'boolean') return;
        if (Object.prototype.toString.call(v) === '[object Array]') {
          for (var i = 0; i < v.length && acc.n < acc.cap; i++) rec(v[i], d + 1);
          return;
        }
        if (t === 'object') {
          if (typeof v.length === 'number' && v.length > 0 && v.length < 1e6 && Object.prototype.toString.call(v).indexOf('Array') > 0) {
            var lim = v.length > 512 ? 512 : v.length;
            for (var q = 0; q < lim && acc.n < acc.cap; q++) rec(v[q], d + 1);
            return;
          }
          var c = 0;
          for (var k in v) { if (c++ > 40) break; try { rec(v[k], d + 1); } catch (e) { /* one bad leaf */ } }
        }
      };
      try { rec(x, 0); } catch (e) { /* partial is fine */ }
      return { n: acc.n, sum: acc.sum, strs: acc.strs };
    };
    W.wtSig = function () {
      var out = { core: null, ui: null, cv: null };
      try { out.core = W.walkSum((typeof avWtSnap === 'function') ? avWtSnap() : null); } catch (e) { out.coreErr = String((e && e.message) || e); }
      try { out.ui = W.walkSum((typeof avWtUiSnap === 'function') ? avWtUiSnap() : null); } catch (e2) { out.uiErr = String((e2 && e2.message) || e2); }
      try { out.cv = W.digestEl(W.domGet('av-wt-canvas')); } catch (e3) { out.cvErr = String((e3 && e3.message) || e3); }
      return out;
    };
    W.stroke = function () {
      var out = {};
      try {
        var cv = W.domGet('av-wt-canvas');
        if (!cv) { out.err = 'no #av-wt-canvas'; return out; }
        var r = cv.getBoundingClientRect();
        out.rect = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        if (!(r.width > 4 && r.height > 4)) { out.err = 'canvas not visible'; return out; }
        var mk = function (type, x, y, buttons) {
          return new PointerEvent(type, {
            bubbles: true, cancelable: true, composed: true, pointerId: 21, pointerType: 'mouse',
            isPrimary: true, buttons: buttons, pressure: buttons ? 0.5 : 0, clientX: x, clientY: y
          });
        };
        var x0 = r.left + 12, x1 = r.left + r.width - 12, ym = r.top + r.height * 0.5;
        cv.dispatchEvent(mk('pointerdown', x0, ym, 1));
        var steps = 12, i;
        for (i = 1; i <= steps; i++) cv.dispatchEvent(mk('pointermove', x0 + (x1 - x0) * i / steps, ym, 1));
        cv.dispatchEvent(mk('pointerup', x1, ym, 0));
        out.steps = steps + 2;
      } catch (e) { out.err = String((e && e.message) || e); }
      return out;
    };

    /* ---- card DOM probes ---- */
    W.fmCard = function () {
      var out = {};
      try {
        out.card = !!W.domGet('av-fm');
        out.host = !!W.domGet('av-fm-host');
        var tabs = document.querySelectorAll('#av-fm .av-fm-op-tab[data-op]');
        out.tabs = tabs.length;
        out.tabOps = [];
        for (var i = 0; i < tabs.length && i < 12; i++) out.tabOps.push(String(tabs[i].getAttribute('data-op')));
        var panels = document.querySelectorAll('#av-fm [data-op-panel]');
        out.panels = panels.length;
        var active = [], loose = [], j;
        for (j = 0; j < panels.length; j++) {
          var p = panels[j];
          var looseOk = false, visOk = false;
          try {
            looseOk = (p.hidden !== true) && (String(p.style.display) !== 'none');
            visOk = looseOk && W.visible(p);
          } catch (e) { visOk = false; looseOk = false; }
          if (visOk) active.push(String(p.getAttribute('data-op-panel')));
          if (looseOk) loose.push(String(p.getAttribute('data-op-panel')));
        }
        out.activeOps = active; out.activeOpsLoose = loose;
        out.status = !!W.domGet('av-fm-status');
      } catch (e2) { out.err = String((e2 && e2.message) || e2); }
      return out;
    };
    W.fmWired = function () {
      var out = {};
      try {
        var sel = W.domGet('av-fm-algo');
        out.sel = sel ? {
          tag: String(sel.tagName), cls: String(sel.className || ''), param: String(sel.getAttribute('data-param') || ''),
          opts: sel.options ? sel.options.length : 0,
          values: (function () { var v = [], i; if (!sel.options) return v; for (i = 0; i < sel.options.length && i < 12; i++) v.push(String(sel.options[i].value)); return v; })()
        } : null;
        var kb = W.bound('#av-fm .av-knob[data-knob]', null);
        out.knobs = kb.n; out.knobsBound = kb.bound;
        out.paths = W.paths('#av-fm .av-knob[data-knob]', null);
        var opK = 0, i;
        if (out.paths) for (i = 0; i < out.paths.length; i++) if (/^fm\.op\d\./.test(out.paths[i])) opK++;
        out.opKnobs = opK;
        out.hasFb = !!out.paths && out.paths.indexOf('fm.fb') >= 0;
        out.hasVol = !!out.paths && out.paths.indexOf('fm.volume') >= 0;
        var v2 = W.domGet('av-fm-algo-view');
        if (!v2) out.view = { found: false };
        else if (String(v2.tagName) === 'CANVAS') out.view = { found: true, kind: 'canvas', digest: W.digestEl(v2) };
        else out.view = { found: true, kind: String(v2.tagName).toLowerCase(), children: (v2.querySelectorAll ? v2.querySelectorAll('*').length : 0), w: Math.round(v2.getBoundingClientRect().width) };
      } catch (e) { out.err = String((e && e.message) || e); }
      return out;
    };
    W.wtCard = function () {
      var out = {};
      try {
        out.card = !!W.domGet('av-wt');
        out.host = !!W.domGet('av-wt-host');
        var cv = W.domGet('av-wt-canvas');
        out.canvas = cv ? { w: cv.width, h: cv.height, twoD: !!(cv.getContext && cv.getContext('2d')) } : null;
        out.tools = W.counter('#av-wt-tool [data-tool]', null);
        out.toolNames = (function () {
          try {
            var t = [], els = document.querySelectorAll('#av-wt-tool [data-tool]'), i;
            for (i = 0; i < els.length && i < 10; i++) t.push(String(els[i].getAttribute('data-tool')));
            return t;
          } catch (e) { return null; }
        })();
        out.frames = !!W.domGet('av-wt-frames');
        out.addFrame = !!W.domGet('av-wt-frame-add');
        out.chips = W.counter('#av-wt [data-frame]', null);
        var mm = W.domGet('av-wt-morph');
        out.morph = !!mm;
        out.morphTag = mm ? String(mm.tagName) + ':' + String(mm.getAttribute('type') || '') : null;
        out.morphB = !!W.domGet('av-wt-morph-b');
        out.harmonics = !!W.domGet('av-wt-harmonics');
        out.lib = !!W.domGet('av-wt-lib');
        out.libRows = W.counter('#av-wt-lib [data-lib-id]', null);
        out.newB = !!W.domGet('av-wt-new');
        out.importB = !!W.domGet('av-wt-import');
        out.exportB = !!W.domGet('av-wt-export');
        out.installB = !!W.domGet('av-wt-install');
        out.auditionB = !!W.domGet('av-wt-audition');
        out.status = !!W.domGet('av-wt-status');
        out.fileInput = W.counter('#av-wt input[type=file]', null);
      } catch (e2) { out.err = String((e2 && e2.message) || e2); }
      return out;
    };
    W.handles = function () {
      var out = {};
      try {
        var F = window.__avFmUi, U = window.__avWtUi, C = window.__avWt;
        var miss = function (h, names) {
          if (!h) return 'none';
          var m = [], i;
          for (i = 0; i < names.length; i++) if (h[names[i]] === undefined) m.push(names[i]);
          return m;
        };
        var ver = function (h) { return (h && (typeof h.version === 'number' || typeof h.version === 'string')) ? h.version : null; };
        out.fm = F ? { type: typeof F, version: ver(F), miss: miss(F, ['init', 'snap', 'classes', 'sync']) } : null;
        out.wt = U ? { type: typeof U, version: ver(U), miss: miss(U, ['init', 'snap', 'classes', 'sync']) } : null;
        out.core = C ? { type: typeof C, version: ver(C) } : null;
        var names = ['avWtNew', 'avWtFrameCount', 'avWtSetFrame', 'avWtAddFrame', 'avWtDelFrame', 'avWtSeedFrom', 'avWtMorph', 'avWtMips', 'avWtInstall', 'avWtInstalled', 'avWtLibraryList', 'avWtLibrarySave', 'avWtLibraryLoad', 'avWtLibraryDelete', 'avWtExportJson', 'avWtImportJson', 'avWtImportWt', 'avWtSnap', 'avWtClasses', 'avWtUserOscNames'];
        out.globals = [];
        for (var i = 0; i < names.length; i++) out.globals.push(names[i] + ':' + typeof window[names[i]]);
      } catch (e) { out.err = String((e && e.message) || e); }
      return out;
    };
    W.classes = function () {
      var out = {};
      try {
        var shape = function (x) {
          if (Object.prototype.toString.call(x) !== '[object Array]') return { isArray: false, type: typeof x };
          var bad = 0, i;
          for (i = 0; i < x.length; i++) if (typeof x[i] !== 'string' || !x[i]) bad++;
          return { isArray: true, n: x.length, bad: bad };
        };
        out.fm = shape((typeof avFmUiClasses === 'function') ? avFmUiClasses() : null);
        out.wt = shape((typeof avWtUiClasses === 'function') ? avWtUiClasses() : null);
      } catch (e) { out.err = String((e && e.message) || e); }
      return out;
    };

    /* ---- baseline + restore + dialog stubs ---- */
    W.PATHS = ['engine.kind', 'osc1.level', 'osc2.level', 'osc2.type', 'fm.algo', 'fm.op2.level', 'fx.aw.on', 'fx.aw.mode', 'fx.aw.amount', 'fx.conv.on', 'fx.conv.mode', 'fx.conv.mix'];
    W.DEFS = { 'engine.kind': 'va', 'osc1.level': 1, 'osc2.level': 0.5, 'osc2.type': 'wt.saw', 'fm.algo': 0, 'fm.op2.level': 0.35, 'fx.aw.on': 0, 'fx.aw.mode': 'console', 'fx.aw.amount': 0.5, 'fx.conv.on': 0, 'fx.conv.mode': 'plate', 'fx.conv.mix': 0.25 };
    W.arm = function () {
      var out = {}, i;
      for (i = 0; i < W.PATHS.length; i++) { try { out[W.PATHS[i]] = W.paramGet(W.PATHS[i]); } catch (e) { out[W.PATHS[i]] = 'ERR'; } }
      W.orig = out;
      return out;
    };
    W.cleanup = function () {
      var out = { steps: [] };
      var step = function (name, fn) { try { fn(); out.steps.push(name + ':ok'); } catch (e) { out.steps.push(name + ':err ' + String((e && e.message) || e)); } };
      step('notes', function () { if (typeof avNoteStopAll === 'function') avNoteStopAll(); });
      var i;
      for (i = 0; i < W.PATHS.length; i++) {
        (function (p) {
          var v = (W.orig && W.orig[p] !== null && W.orig[p] !== undefined && W.orig[p] !== 'ERR') ? W.orig[p] : W.DEFS[p];
          if (v === undefined) return;
          step('param ' + p, function () { if (typeof avApplyParam === 'function') avApplyParam(p, v); });
        })(W.PATHS[i]);
      }
      step('kindSel', function () {
        var k = (W.orig && W.orig['engine.kind']) || 'va';
        var sel = W.domGet('av-synth-engine');
        if (sel) sel.value = k;
      });
      step('witness', function () { W.witRelease(); });
      out.final = { held: W.held(), kind: W.paramGet('engine.kind'), awOn: W.paramGet('fx.aw.on'), convOn: W.paramGet('fx.conv.on'), osc2Type: W.paramGet('osc2.type'), witness: !!W.wit };
      return out;
    };
    W.dlgOn = function () {
      try {
        W.dlg = { p: window.prompt, c: window.confirm, a: window.alert };
        window.prompt = function () { return 'm1-rig'; };
        window.confirm = function () { return true; };
        window.alert = function () { /* swallowed */ };
        return true;
      } catch (e) { return false; }
    };
    W.dlgOff = function () {
      try {
        if (W.dlg) {
          if (W.dlg.p) window.prompt = W.dlg.p;
          if (W.dlg.c) window.confirm = W.dlg.c;
          if (W.dlg.a) window.alert = W.dlg.a;
          W.dlg = null;
        }
        return true;
      } catch (e) { return false; }
    };
    W.clickId = function (id) {
      try {
        var el = W.domGet(id);
        if (!el) return { found: false };
        el.click();
        return { found: true, tag: String(el.tagName) };
      } catch (e) { return { found: false, err: String((e && e.message) || e) }; }
    };

    return W;
  })();
  return true;
};

const shotPath = path.join(here, '..', 'renders', 'm1-suite.png');

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
    else if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: false }).catch(() => { /* belt only */ });
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

  /* ── 1a. boot: ready flag + engine ctx (the s5 contract) ── */
  console.log('-- 1. boot + helpers + the M1 cards --');
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const r = await ev(`document.documentElement.getAttribute('data-av-ready') === '1'`);
    if (r.value === true) { ready = true; break; }
    await sleep(300);
  }
  const engR = await ev(`(async () => {
    const e = window.__avEngine || {};
    let ctx = (e.handle && e.handle.ctx) || e.ctx || null;
    if (!ctx && typeof avEngineEnsure === 'function') { try { const h = await avEngineEnsure(); ctx = (h && h.ctx) || null; } catch (x) { } }
    if (!ctx) { for (const k in e.handle || {}) { try { const v = e.handle[k]; if (v && typeof v.currentTime === 'number' && typeof v.resume === 'function') { ctx = v; break; } } catch (x) { } } }
    if (!ctx) return { found: false };
    if (ctx.state !== 'running') { try { await Promise.race([ctx.resume().catch(function () { }), new Promise(function (res) { setTimeout(res, 2000); })]); } catch (x) { } }
    for (let i = 0; i < 20 && ctx.state !== 'running'; i++) await new Promise(function (res) { setTimeout(res, 125); });
    return { found: true, state: ctx.state, sampleRate: ctx.sampleRate, scp: typeof ctx.createScriptProcessor === 'function' };
  })()`);
  const eng = val(engR) || {};
  expected(ready === true && eng.found === true && eng.state === 'running' && eng.scp === true && Number(eng.sampleRate) === 48000,
    '1a boot: data-av-ready flips + engine ctx found/running/ScriptProcessor-capable/sr 48k', J({ ready: ready, eng: eng }));
  if (!ready) { console.error('APP NOT READY'); process.exit(1); }
  if (eng.found !== true || eng.state !== 'running') note('engine ctx not running yet — the legs will surface honest refusals');

  /* ── 1b. rig helpers ── */
  await ev('(' + M1W_INSTALL.toString() + ')()');
  const legChk = val(await ev(`(function () {
    var g = function (n) { return typeof window.__m1w[n]; };
    var need = ['light', 'domGet', 'visible', 'counter', 'paths', 'bound', 'digestEl', 'notes', 'down', 'up', 'stopAll', 'paramGet', 'apply', 'witArm', 'witRelease', 'rms',
      'spec0', 'spec1', 'specDrop', 'kindApply', 'fxSnap', 'stats', 'convLoad', 'convSweep', 'wtInstall', 'wtSig', 'stroke',
      'fmCard', 'fmWired', 'wtCard', 'handles', 'classes', 'arm', 'cleanup', 'dlgOn', 'dlgOff', 'clickId'];
    var miss = [];
    for (var i = 0; i < need.length; i++) if (g(need[i]) !== 'function') miss.push(need[i]);
    return { v: (window.__m1w && window.__m1w.v) || null, miss: miss };
  })()`));
  expected(legChk && legChk.v === 1 && Array.isArray(legChk.miss) && legChk.miss.length === 0,
    '1b rig helpers injected (__m1w v1: witness · spectra · conv/wt legs · DOM probes · cleanup)', J(legChk));

  /* baseline arm: the cleanup restores every M1 param the rig touches (fresh profile discarded) */
  const arm = val(await ev('window.__m1w.arm()')) || {};
  note('baseline armed: ' + J(arm));

  /* ── 1c. FM card mounted ── */
  const fmc = val(await ev('window.__m1w.fmCard()')) || {};
  const wantOps = ['1', '2', '3', '4', '5', '6'];
  const fmTabsOk = fmc.tabs === 6 && Array.isArray(fmc.tabOps) && wantOps.every(o => fmc.tabOps.indexOf(o) >= 0);
  const fmActiveOk = (Array.isArray(fmc.activeOps) && fmc.activeOps.length >= 1) || (Array.isArray(fmc.activeOpsLoose) && fmc.activeOpsLoose.length >= 1);
  expected(fmc.card === true && fmc.host === true && fmTabsOk && fmc.panels >= 1 && fmActiveOk && fmc.status === true,
    '1c FM card: #av-fm + #av-fm-host mounted · 6 op tabs (data-op 1-6) · active op panel · #av-fm-status', J(fmc));

  /* ── 1d. FM card wired: select + knobs + algo view ── */
  const fmw = val(await ev('window.__m1w.fmWired()')) || {};
  const viewPainted = (v) => {
    if (!v || v.found !== true) return false;
    if (v.kind === 'canvas') return !!(v.digest && v.digest.ok === true && (v.digest.nonBlack > 0 || v.digest.ink > 0));
    if (v.kind === 'svg') return typeof v.children === 'number' && v.children >= 1;
    return typeof v.w === 'number' && v.w > 4;
  };
  const selOk = !!(fmw.sel && fmw.sel.tag === 'SELECT' && /av-select/.test(fmw.sel.cls) && fmw.sel.param === 'fm.algo' && fmw.sel.opts >= 8);
  const knobsOk = typeof fmw.knobs === 'number' && fmw.knobs >= 10 && fmw.knobsBound === fmw.knobs;
  expected(selOk && knobsOk && fmw.opKnobs >= 6 && fmw.hasFb === true && fmw.hasVol === true && viewPainted(fmw.view),
    '1d FM wired: #av-fm-algo select.av-select[data-param="fm.algo"] (' + ((fmw.sel && fmw.sel.opts) || '?') + ' opts) · fm.* knobs all data-knob-bound + fb/volume · algo view painted',
    J({ sel: fmw.sel, knobs: fmw.knobs, bound: fmw.knobsBound, opKnobs: fmw.opKnobs, fb: fmw.hasFb, vol: fmw.hasVol, view: fmw.view, err: fmw.err }));

  /* ── 1e. WT card mounted ── */
  const wtc = val(await ev('window.__m1w.wtCard()')) || {};
  expected(wtc.card === true && wtc.host === true && wtc.canvas && wtc.canvas.twoD === true && wtc.tools >= 3 &&
    wtc.frames === true && wtc.addFrame === true && wtc.morph === true && wtc.harmonics === true && wtc.lib === true &&
    wtc.newB === true && wtc.importB === true && wtc.exportB === true && wtc.installB === true && wtc.auditionB === true && wtc.status === true,
    '1e WT card: #av-wt + host · 2D canvas (' + ((wtc.canvas && wtc.canvas.w) || '?') + 'x' + ((wtc.canvas && wtc.canvas.h) || '?') + ') · tools/frames/morph/harmonics · library · new/import/export/install/audition + status',
    J(wtc));

  /* ── 1f. editor handles ── */
  const hd = val(await ev('window.__m1w.handles()')) || {};
  expected(hd.fm && Array.isArray(hd.fm.miss) && hd.fm.miss.length === 0 && hd.wt && Array.isArray(hd.wt.miss) && hd.wt.miss.length === 0 &&
    hd.core && (hd.core.type === 'object' || hd.core.type === 'function'),
    '1f editor handles: window.__avFmUi + window.__avWtUi (init/snap/classes/sync) + window.__avWt core handle', J(hd));

  /* ── 1g. class lists (styles coverage input) ── */
  const clz = val(await ev('window.__m1w.classes()')) || {};
  expected(clz.fm && clz.fm.isArray === true && clz.fm.bad === 0 && clz.wt && clz.wt.isArray === true && clz.wt.bad === 0,
    '1g class lists: avFmUiClasses()/avWtUiClasses() -> clean new-class-name string arrays', J(clz));

  /* ── 2. FM engine: kind accept · witness · spectra · release ── */
  console.log('-- 2. FM engine (kind fm · witness · spectra) --');
  await ev('window.__m1w.stopAll()');
  const k2 = val(await ev('window.__m1w.kindApply("fm")')) || {};
  expected(k2.direct === true && k2.mirror === 'fm' && k2.mirror2 === 'fm',
    '2a kind accept: avApplyParam("engine.kind","fm") true + avParams mirror echo "fm"', J(k2));
  expected(k2.optMatch === true && k2.sel1 === 'fm' && k2.panel && k2.panel.present === true && k2.panel.hidden === false,
    '2b select reflects: #av-synth-engine carries the "fm" option · value "fm" · the fm panel is shown',
    J({ opts: k2.opts, sel0: k2.sel0, sel1: k2.sel1, panel: k2.panel }));

  const w2 = val(await ev('window.__m1w.witArm()')) || {};
  expected(w2.ok === true && typeof w2.sr === 'number' && w2.nodes >= 1,
    "2c witness law: the rig's OWN AnalyserNode armed on avMasterNodes() (panel reads are never witnesses)", J(w2));

  const floor2 = val(await ev('window.__m1w.rms(300)')) || {};
  const n2 = val(await ev('window.__m1w.down("c4", 0.9)')) || {};
  await sleep(450);
  const sig2 = val(await ev('window.__m1w.rms(350)')) || {};
  const st2 = val(await ev('window.__m1w.stats()')) || {};
  const sig2Ok = !!(sig2.ok === true && typeof sig2.max === 'number' && sig2.max > Math.max(4 * (floor2.max || 0), 1e-3));
  expected(n2.fresh === true && sig2Ok && st2.ok === true && typeof st2.active === 'number' && st2.active >= 1,
    '2d FM signal: avNoteDown(c4) held -> rig analyser RMS above the silence floor (' + fx3(sig2.max) + ' vs ' + fx3(floor2.max) + ') · stats active ' + J(st2.active),
    J({ floor: floor2, note: sig2, stats: { ok: st2.ok, active: st2.active } }));

  /* modulator off -> on (the note stays held) */
  const op0 = val(await ev('window.__m1w.apply("fm.op2.level", 0)')) || {};
  await sleep(250);
  const s0d = val(await ev('window.__m1w.spec0()')) || {};
  const op8 = val(await ev('window.__m1w.apply("fm.op2.level", 0.8)')) || {};
  await sleep(300);
  const s1d = val(await ev('window.__m1w.spec1()')) || {};
  expected(op0.ret === true && op8.ret === true && s0d.ok === true && s1d.ok === true && s1d.rel >= 0.10,
    '2e fm.op2.level 0->0.8 changes the spectrum (bin-energy L1 ' + fx4(s1d.rel) + ')', J({ a: s0d, b: s1d, ret0: op0.ret, ret8: op8.ret }));

  /* algorithm 0 -> 3 (same held note). SPEC NOTE (first-run triage): for a patch with only
     op1+op2 active, algos 0 and 3 are deliberately identical topologies (both = op2->op1);
     open op3 (algo 3's second carrier) + its modulator op4 first, so the 0->3 topology
     change is actually audible. */
  const a0 = val(await ev('window.__m1w.apply("fm.algo", 0)')) || {};
  const o3 = val(await ev('window.__m1w.apply("fm.op3.level", 0.5)')) || {};
  const o4 = val(await ev('window.__m1w.apply("fm.op4.level", 0.4)')) || {};
  await sleep(250);
  const s0a = val(await ev('window.__m1w.spec0()')) || {};
  const a3 = val(await ev('window.__m1w.apply("fm.algo", 3)')) || {};
  await sleep(300);
  const s1a = val(await ev('window.__m1w.spec1()')) || {};
  expected(a0.ret === true && o3.ret === true && o4.ret === true && a3.ret === true && s0a.ok === true && s1a.ok === true && s1a.rel >= 0.10,
    '2f fm.algo 0->3 (fixture: op3/op4 opened) changes the spectrum while the note holds (bin-energy L1 ' + fx4(s1a.rel) + ')', J({ a: s0a, b: s1a, ret0: a0.ret, ret3: a3.ret }));

  const up2 = val(await ev('window.__m1w.up("c4")')) || {};
  const dec2 = val(await ev('window.__m1w.rms(400, 1200)')) || {};
  expected(up2.ret === true && dec2.ok === true && dec2.max <= Math.max(4 * (floor2.max || 0), 1e-3),
    '2g release: avNoteUp -> signal decays back to the floor (tail max ' + fx3(dec2.max) + ')', J({ up: up2, tail: dec2 }));
  await ev('window.__m1w.specDrop()');

  /* ── 3. FLAVOUR (aw) ── */
  console.log('-- 3. FLAVOUR (studio flavours bank) --');
  await ev('window.__m1w.stopAll()');
  const k3 = val(await ev('window.__m1w.kindApply("va")')) || {};
  note('fixture: engine.kind -> va for the aw / conv / wt legs (direct ' + J(k3.direct) + ')');
  const n3 = val(await ev('window.__m1w.down("c4", 0.9)')) || {};
  await sleep(420);
  const s0f = val(await ev('window.__m1w.spec0()')) || {};
  const awOn = val(await ev('window.__m1w.apply("fx.aw.on", 1)')) || {};
  const awMode = val(await ev('window.__m1w.apply("fx.aw.mode", "tape")')) || {};
  const awAmt = val(await ev('window.__m1w.apply("fx.aw.amount", 0.7)')) || {};
  await sleep(350);
  const s1f = val(await ev('window.__m1w.spec1()')) || {};
  const awDelta = !!(s1f.ok === true && (s1f.rel >= 0.02 || Math.abs((s1f.highFracB || 0) - (s1f.highFracA || 0)) >= 0.004));
  expected(n3.fresh === true && awOn.ret === true && awMode.ret === true && awAmt.ret === true && s0f.ok === true && awDelta,
    '3a FLAVOUR: fx.aw.on=1 · mode tape · amount 0.7 -> spectrum delta vs bypass (rel ' + fx4(s1f.rel) + ' · highFrac ' + fx4(s1f.highFracA) + ' -> ' + fx4(s1f.highFracB) + ')',
    J({ rets: [awOn.ret, awMode.ret, awAmt.ret], a: s0f, b: s1f }));

  const fxs = val(await ev('window.__m1w.fxSnap()')) || {};
  const fxOrd = Array.isArray(fxs.order) ? fxs.order : null;
  expected(fxs.found === true && fxs.inited === true && typeof fxs.strips === 'number' && fxs.strips >= 6 && fxs.strips <= 7 &&
    fxOrd !== null && fxOrd.indexOf('aw') >= 0 && fxOrd.indexOf('conv') >= 0 && fxOrd.length === fxs.strips,
    '3b avFxSnap: ' + J(fxs.strips) + ' strips (6-7) · order carries aw + conv · strips === order.length',
    J({ strips: fxs.strips, order: fxOrd, expect: fxs.expect }));

  const st3 = val(await ev('window.__m1w.stats()')) || {};
  expected(st3.ok === true && typeof st3.fxChain === 'string' && /\baw\b/.test(st3.fxChain),
    '3c engine stats(): fxChain carries "aw" (' + J(st3.fxChain) + ')', J({ fxChain: st3.fxChain, uwt: st3.uwt }));

  /* ── 4. CONV ── */
  console.log('-- 4. CONV (impulse + tail) --');
  const awOff4 = val(await ev('window.__m1w.apply("fx.aw.on", 0)')) || {};
  await ev('window.__m1w.up("c4")');
  await ev('window.__m1w.stopAll()');
  await sleep(500);

  /* bypass tail: conv off */
  const cvOff = val(await ev('window.__m1w.apply("fx.conv.on", 0)')) || {};
  const bn = val(await ev('window.__m1w.down("c4", 0.9)')) || {};
  await sleep(400);
  await ev('window.__m1w.up("c4")');
  const tailOff = val(await ev('window.__m1w.rms(700, 350)')) || {};
  await sleep(600);

  /* wet tail: conv on (plate, mix 0.7 for a decisive measurement) */
  const cvOn = val(await ev('window.__m1w.apply("fx.conv.on", 1)')) || {};
  const cvMode = val(await ev('window.__m1w.apply("fx.conv.mode", "plate")')) || {};
  const cvMix = val(await ev('window.__m1w.apply("fx.conv.mix", 0.7)')) || {};
  const bn2 = val(await ev('window.__m1w.down("c4", 0.9)')) || {};
  await sleep(400);
  await ev('window.__m1w.up("c4")');
  const tailOn = val(await ev('window.__m1w.rms(700, 350)')) || {};
  expected(awOff4.ret === true && cvOff.ret === true && cvOn.ret === true && cvMode.ret === true && cvMix.ret === true &&
    bn.fresh === true && bn2.fresh === true && tailOn.ok === true && tailOff.ok === true &&
    tailOn.max > tailOff.max * 2 + 1e-4 && tailOn.max > Math.max(4 * (floor2.max || 0), 1e-3),
    '4a CONV tail: fx.conv.on=1 (plate · mix 0.7) -> note-off tail RMS above the bypass tail (' + fx3(tailOn.max) + ' vs ' + fx3(tailOff.max) + ')',
    J({ tailOn: tailOn, tailOff: tailOff }));

  /* mode sweep — no throw, receipt true (user = documented honest dry pass before 4c's load) */
  const sweep = val(await ev('window.__m1w.convSweep(["plate", "room", "hall", "spring", "cab", "user"])')) || {};
  expected(sweep.allTrue === true,
    '4b conv mode sweep: plate/room/hall/spring/cab/user all accepted (no throw, receipt true)', J(sweep));

  /* synthetic delta impulse through the pinned sender */
  const load4 = val(await ev('window.__m1w.convLoad()')) || {};
  expected(load4.fn === 'function' && load4.ret === true && load4.len === 4096 && load4.shape &&
    load4.shape.n1 === 4096 && load4.shape.first === 1 && load4.shape.rest === 0,
    '4c impulse load: synthetic delta (Float64Array 4096 · ch1[0]=1) via avEngineConv(0,"m1-delta",sr,ch1,ch2) -> true', J(load4));

  /* mode "user" after the load produces signal */
  const um = val(await ev('window.__m1w.apply("fx.conv.mode", "user")')) || {};
  await sleep(250);
  const un = val(await ev('window.__m1w.down("c4", 0.9)')) || {};
  await sleep(400);
  const usig = val(await ev('window.__m1w.rms(350)')) || {};
  await ev('window.__m1w.up("c4")');
  expected(um.ret === true && un.fresh === true && usig.ok === true && usig.max > Math.max(4 * (floor2.max || 0), 1e-3),
    '4d conv mode "user" after the load produces signal (RMS ' + fx3(usig.max) + ')', J({ mode: um, sig: usig }));

  const imp = val(await ev(`(function () {
    var el = document.getElementById('av-fx-conv-import');
    if (!el) return { found: false };
    var vis = false;
    try { var r = el.getBoundingClientRect(); vis = r.width > 1 && r.height > 1; } catch (e) { vis = false; }
    return { found: true, tag: String(el.tagName), type: String((el.getAttribute && el.getAttribute('type')) || ''), hidden: el.hidden === true, vis: vis, accept: String((el.getAttribute && el.getAttribute('accept')) || '') };
  })()`)) || {};
  expected(imp.found === true, '#av-fx-conv-import exists (the IMPORT IR control in the conv strip)', J(imp));

  /* ── 5. WT ── */
  console.log('-- 5. WT (install · engine · osc2 · stroke) --');
  const cvOff5 = val(await ev('window.__m1w.apply("fx.conv.on", 0)')) || {};
  await ev('window.__m1w.stopAll()');
  const wt = val(await ev('window.__m1w.wtInstall()')) || {};
  expected(Array.isArray(wt.missing) && wt.missing.length === 0 && wt.ok === true && typeof wt.slot === 'number' && wt.slot >= 0 && wt.slot <= 15,
    '5a WT install: avWtNew + seed saw + avWtInstall -> receipt ok (slot ' + J(wt.slot) + ')', J(wt));

  const nameWant = 'wt.user' + (typeof wt.slot === 'number' ? wt.slot : 0);
  const instN = Array.isArray(wt.installed) ? wt.installed.length : null;
  const names = Array.isArray(wt.oscNames) ? wt.oscNames.map(o => o && o.value) : null;
  expected(typeof instN === 'number' && instN >= 1 && names !== null && names.indexOf(nameWant) >= 0,
    '5b install mirror: avWtInstalled lists ' + J(instN) + ' slot(s) · avWtUserOscNames carries ' + nameWant,
    J({ installed: wt.installed, oscNames: wt.oscNames }));

  const stw = val(await ev('window.__m1w.stats()')) || {};
  expected(stw.ok === true && typeof stw.uwt === 'number' && stw.uwt >= 1,
    '5c engine stats(): uwt ' + J(stw.uwt) + ' >= 1 (user wavetable landed in the engine)', J({ uwt: stw.uwt, fxChain: stw.fxChain }));

  /* osc2 -> the user table (osc1 silenced so the table is the input under test) */
  const wtKind = val(await ev('window.__m1w.kindApply("va")')) || {};
  const wtOn = val(await ev('window.__m1w.apply("osc1.level", 0)')) || {};
  const wtLvl = val(await ev('window.__m1w.apply("osc2.level", 0.8)')) || {};
  const wtType = val(await ev('window.__m1w.apply("osc2.type", ' + JSON.stringify(nameWant) + ')')) || {};
  await sleep(250);
  const wn = val(await ev('window.__m1w.down("c4", 0.9)')) || {};
  await sleep(420);
  const wsig = val(await ev('window.__m1w.rms(350)')) || {};
  await sleep(150);
  const ws0 = val(await ev('window.__m1w.spec0()')) || {};
  const sineT = val(await ev('window.__m1w.apply("osc2.type", "wt.sine")')) || {};
  await sleep(350);
  const ws1 = val(await ev('window.__m1w.spec1()')) || {};
  await ev('window.__m1w.up("c4")');
  expected(wtKind.direct === true && wtOn.ret === true && wtType.ret === true && wtLvl.ret === true && wn.fresh === true && wsig.ok === true && wsig.max > Math.max(4 * (floor2.max || 0), 1e-3),
    '5d WT signal: osc2.type="' + nameWant + '" + osc2.level 0.8 (osc1 0) -> avNoteDown signal above the floor (RMS ' + fx3(wsig.max) + ')',
    J({ type: wtType.ret, lvl: wtLvl.ret, sig: wsig }));
  expected(sineT.ret === true && ws1.ok === true && ws1.rel >= 0.10,
    '5e WT character: the seeded-saw user table spectrum differs from wt.sine (rel ' + fx4(ws1.rel) + ' · highFrac ' + fx4(ws1.highFracA) + ' -> ' + fx4(ws1.highFracB) + ')',
    J({ a: ws0, b: ws1 }));

  /* canvas interaction smoke: NEW (stubbed dialogs) -> control window -> stroke -> change */
  const sigA = val(await ev('window.__m1w.wtSig()')) || {};
  const dlg1 = val(await ev('window.__m1w.dlgOn()'));
  const newClick = val(await ev('window.__m1w.clickId("av-wt-new")')) || {};
  const dlg2 = val(await ev('window.__m1w.dlgOff()'));
  await sleep(300);
  const sigB0 = val(await ev('window.__m1w.wtSig()')) || {};
  await sleep(320);
  const sigB1 = val(await ev('window.__m1w.wtSig()')) || {};
  const stroke = val(await ev('window.__m1w.stroke()')) || {};
  await sleep(420);
  const sigC = val(await ev('window.__m1w.wtSig()')) || {};
  const chg = (a, b) => {
    if (!a || !b) return null;
    const core = !!(a.core && b.core && (a.core.n !== b.core.n || a.core.sum !== b.core.sum));
    const ui = !!(a.ui && b.ui && (a.ui.n !== b.ui.n || a.ui.sum !== b.ui.sum));
    const cv = !!(a.cv && b.cv && a.cv.ok === true && b.cv.ok === true && (a.cv.ink !== b.cv.ink || a.cv.sumLum !== b.cv.sumLum || a.cv.nonBlack !== b.cv.nonBlack));
    return { core: core, ui: ui, cv: cv, any: core || ui || cv };
  };
  const noise = chg(sigB0, sigB1);
  const after = chg(sigB1, sigC);
  const shot = (s) => ({ core: s && s.core, ui: s && s.ui, cv: s && s.cv ? { ok: s.cv.ok, ink: s.cv.ink, sumLum: s.cv.sumLum } : s && s.cv });
  expected(stroke.err == null && typeof stroke.steps === 'number' && stroke.steps > 0 && after !== null && after.any === true && noise !== null && !(noise.core && noise.ui && noise.cv),
    '5f WT canvas stroke: pointer stroke on #av-wt-canvas -> frame signature / canvas digest changed (' + J(after) + ' · no-stroke control ' + J(noise) + ')',
    J({ dlg: [dlg1, dlg2], newClick: newClick, a: shot(sigA), b0: shot(sigB0), b1: shot(sigB1), c: shot(sigC), stroke: stroke }));

  /* ── seal ── */
  console.log('-- seal --');
  await ev('window.__m1w.stopAll()');
  let shotOk = false, shotInfo = '';
  try {
    await ev(`(function () { try { var c = document.getElementById('av-fm'); if (c && c.scrollIntoView) { c.scrollIntoView({ block: 'center' }); return true; } } catch (e) { } try { window.scrollTo(0, 0); } catch (e2) { } return true; })()`);
    await sleep(450);
    const img = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(img.data, 'base64');
    try { mkdirSync(path.dirname(shotPath), { recursive: true }); } catch (e) { /* exists */ }
    writeFileSync(shotPath, buf);
    shotOk = buf.length > 1000 && buf[0] === 0x89 && buf[1] === 0x50;
    shotInfo = buf.length + ' bytes · viewport 1440x900 · scrolled to #av-fm';
  } catch (e) { shotInfo = 'capture failed: ' + (e && e.message); }
  expected(shotOk, 'S1 screenshot: renders/m1-suite.png (the instrument with the M1 wave live)', shotInfo);

  const clS = val(await ev('window.__m1w.cleanup()')) || {};
  const fin = clS.final || {};
  expected(fin.held === 0 && fin.witness === false &&
    fin.kind === (arm ? arm['engine.kind'] : null) && fin.osc2Type === (arm ? arm['osc2.type'] : null) &&
    fin.awOn === (arm ? arm['fx.aw.on'] : null) && fin.convOn === (arm ? arm['fx.conv.on'] : null),
    'S2 cleanup: notes released · kind/osc2/aw/conv restored to the armed values · witness detached',
    J({ cleanup: clS, arm: arm }));

  expected(errors.length === 0, 'S3 zero page errors (exceptions · Log errors · console.error)',
    'page errors=' + errors.length + (errors.length ? ' | ' + errors.slice(0, 3).join(' | ') : ''));

  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after): ' + shaAfter);
  expected(shaAfter === shaBefore, 'S4 freeze: index.html sha256 before === after (unchanged by the run)', shaAfter);

  /* ── 6. freeze pin leg ── */
  if (PIN) expected(shaBefore === PIN && shaAfter === PIN, '6 freeze pin leg: index.html sha256 = pinned', 'pinned ' + PIN.slice(0, 12) + '...');
  else note('6 EXPECT_SHA not pinned — after the M1 integration build, pass --sha <hex> or set the constant (never loosen)');

  console.log('');
  console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
  console.log('M1-RIG-RESULT: ' + pass + '/' + (pass + fail));
  console.log('M1-RESULT ' + JSON.stringify({ kind: 'anvil-cdp-m1', sha256Before: shaBefore, sha256After: shaAfter, pinned: PIN || null, passed: pass, failed: fail, checks: pass + fail, verdict: fail ? 'fail' : 'pass' }));
  console.log(fail ? 'M1 FAILED' : 'M1 PASSED');
  try { ws.close(); } catch { /* done */ }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('m1 harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    /* profile-scoped cleanup (LAW): kill ONLY processes whose command line carries OUR temp
       profile — matched by its unique basename, so the pattern needs no backslash escaping */
    const tag = path.basename(profile);
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
