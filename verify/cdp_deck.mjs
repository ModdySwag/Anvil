// cdp_deck.mjs — Anvil DECK wave suite (child sa-C's rig; WRITTEN by sa-C, RUN BY THE PARENT after
// the DECK integration build, in PARALLEL with av_deck.js / av_deck_ui.js landing). End-to-end over
// raw CDP against the frozen single-file build.
//
//   node verify/cdp_deck.mjs [path-to-index.html] [--port N] [--sha <hex>] > verify/last-cdp_deck.log 2>&1
//
// WRITE-ONLY: this file is authored by sa-C and never executed by sa-C. The parent runs it after the
// integration build (index.html must contain av_deck.js + av_deck_ui.js after av_mix_ui and before
// av_synth; body.html must carry the #av-deck card + #av-deck-host; app_core boots avDeckInit() ->
// avDeckUiInit()).
//
// LAUNCH SKELETON: copied VERBATIM from cdp_studio.mjs (candidates Chrome/Edge/Brave, free-port scan,
// fresh temp --user-data-dir + profile-scoped cleanup, 1440x900 device metrics override — Edge headless
// ignores --window-size, --mute-audio, --autoplay-policy=no-user-gesture-required, ONE browser, explicit
// exit, process.on('exit') kills ONLY processes whose command line carries OUR temp profile) PLUS the
// two fake-media flags kept verbatim from the studio skeleton (harmless here — the deck rig has no
// input/takes legs). The URL is the plain file:// page (no ?avtest=1 — the deck reads ride the deck
// module alone; the runtime self-tests belong to cdp_smoke).
//
// SHA FREEZE DISCIPLINE from cdp_comp.mjs / cdp_mix.mjs: index.html is sha256'd before and after the
// run and before === after is ALWAYS enforced. EXPECT_SHA is null until the parent pins the frozen
// DECK sha (constant below or --sha <hex>); while null the rig still enforces before === after and
// prints a pin note (never loosened).
//
// WHAT IT PROVES, in order (contract: verify/_deck_wave.md §2.3 proofs 1-10):
//   1. boot + engine ctx + card mounted (#av-deck + #av-deck-host + .av-deck root + wired marker
//      avDeckUiWired=1 + scope/spectrum/waterfall canvases) + controls (RUN/PAUSE · FREEZE · DB FLOOR
//      · WATERFALL rate; tolerant label scan) + the readouts row labels (BPM · VOICES · TIER · CTX ·
//      CPU · NOTES) + module surface (avDeck* + avDeckUi* globals · window.__avDeck { version, init,
//      attach, detach, step, frame, readouts, setView, snapshot, pure } · window.__avDeckUi
//      { state, sync, step } · avDeckInit() true · classes arrays · snapshot object).
//   2. rig-owned pure math: log-band plan (bandCount 96 · hzToBand 20 Hz -> 0 · 20 kHz -> 95 ·
//      monotone · bandToHz(0) ~ 20 Hz) · dbOfAmp anchors (1 -> 0 dB · 0.5 -> -6.02 ±0.05 · 0 non-finite
//      honest) · meterNorm (floor -> 0 · top -> 1 · clamps · monotone) · holdDecay contract (decays
//      toward cur, holds at prev == cur, never overshoots).
//   3. attach on the LIVE ctx ONLY (ok · ctx identity vs the engine/avTap grab — a fresh AudioContext
//      would fail here · rate 48000 · fft a power of two >= 256) + avDeckStep() advances `frames` and
//      shapes: scope n 480 min/max finite · spectrum bands 96 · waterfall rows/rowMs/latestRow(96) ·
//      meters keys present null-honest · gain l/r/peak · readouts rows all present (bpm 120 at rest,
//      ctxState running, tier live).
//   4. silence vs note: silence baseline (pull maxAbs < 1e-3 · scope canvas mostly dark) -> avNoteDown
//      ('c4') + step x8 (audio-clock bounded) -> scope canvas digest RISES (page-side getImageData
//      nonBlack + bg-relative ink + pixel sums — Float32/bytes never cross CDP) · spectrum peakBand
//      within ±3 of pure.hzToBand(261.6256) · note ticker (notesSeen >= 1 · lastNote.name = c4).
//   5. waterfall: rows advance over steps (or the saturated 96-row ring keeps rotating) · rowMs in the
//      pinned 40..250 range · canvas digest changes while playing.
//   6. meters: sustained c4+e4+g4 -> lufsShort finite and above the silent reading · dbtp >= peakDb ·
//      release -> energyDb decays >= 3 dB within a bounded step window (release tails respected).
//   7. voices: 6 notes held -> voices > 0 and <= maxVoices (chip cadence, bounded poll) -> all
//      released -> back to 0 within the window.
//   8. freeze/pause laws: freeze on + playing -> scope/spectrum/waterfall digests IDENTICAL across
//      steps · unfreeze + new note -> differ · RUN/PAUSE pause -> identical (same no-change law) ·
//      resume -> differ. (Engagement is tolerant: avDeckSetView across the view kinds + a
//      toggle-click fallback; the asserted LAW is the pixel identity/change.)
//   9. bpm readout: avApplyParam('bpm', 140) -> readout 140 · restored to 120.
//  10. witness law: the rig attaches its OWN AnalyserNode to avMasterFor(ctx) — time-domain energy
//      during a note > silence floor (the panel is not the witness); detached after.
//  11. seal: screenshot renders/deck-suite.png (the deck card, scale 2, taken while the deck is live)
//      · page left CLEAN (notes off, deck paused + detached, bpm 120, transport stopped) · zero page
//      errors · freeze sha256 before === after (+ the pinned-sha gate once EXPECT_SHA is set).
//
// RIG-OWN MATH (never planted literals): every numeric expectation is recomputed at run time — the
// band math from the module's own pure surface (hzToBand(261.6256)), the canvas digests from live
// getImageData, the witness RMS from the rig's own analyser, the decay drop from live meter reads.
//
// SPEC NOTES (sa-C, for the first parent run — fix the EXPECTATION to the check's stated intent,
// never loosen strength):
//   (a) Canvas digests are PAGE-SIDE summaries only (getImageData inside the page): background-relative
//       ink (mode-bucket luminance + 72) counts drawn pixels independent of the canvas bg colour, plus
//       raw nonBlack (lum > 24) and pixel sums. "Rises" accepts any ONE genuine rise measure (sums,
//       ink, inkSum, nonBlack) with margins; freeze/pause equality is EXACT on ink/inkSum/sumLum/nonBlack.
//   (b) Freeze/pause engagement walks avDeckSetView(kind, patch) across scope/spectrum/waterfall/meters/
//       gain/all/deck and falls back to clicking the card's toggle whose label matches freeze/pause.
//       If the real API uses different kind names, the pixel-identity law still fails loudly rather
//       than silently passing.
//   (c) lufsShort is polled over ~5 s because the deck recomputes LUFS/TP at <= 2 Hz on bounded 3 s
//       rings that build up from the step-pulled slices.
//   (d) voices rides the engine sampler chip cadence (AV_ENGINE_CHIP_MS 500) — poll windows ~3.6 s.
//   (e) spectrum peakBand tolerance ±3 bands (the c4 log band is ~1 band wide); peakHz is reported.
//   (f) waterfall "rows advance" also accepts a saturated 96-row ring whose latestRow sum changed —
//       both mean rows kept advancing.
//   (g) energyDb decay is asserted as a >= 3 dB drop of the minimum post-release reading vs the last
//       playing reading within 10 bursts x 2 steps (bounded window; release tails respected).
//   (h) at silence, meter/peakBand values may be null-honest; the rig rejects non-finite leaks
//       (NaN / -Infinity) in the meter fields.
// UNDETERMINED / deliberately not exercised here: fps value in headless (reported only), the `grid`
// readout value (presence only), the deck's internal pull slice size, the waterfall push rate above
// its configured rowMs. Tolerant reads on anything unpinned — the first parent run surfaces mismatches
// by design (rig SPEC-fix law: fix the expectation to the intent, never loosen).
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
   DECK: the frozen sha of the rebuilt index.html is not known until build.py runs — the parent may
   fill this constant or pass --sha <hex>; the rig never loosens the before === after check. */
const EXPECT_SHA = '7accc9fd7953c9cf0f47aefc481d3cb6d21dc027c67cfbdd1b6035b1947671cc';
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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9640);
const profile = path.join(tmpdir(), 'anvil-deck-' + Date.now());
const url = 'file:///' + path.resolve(page).replace(/\\/g, '/');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
console.log('cdp port ' + PORT + ' · profile ' + profile);

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
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  url,
], { stdio: 'ignore', windowsHide: true });

const errors = [];

/* ---------- node-side pure helpers (extracted + unit-tested by the scratch harness) ---------- */
/* __DECK_PURE_BEGIN */
/* digest equality: exact on the four integrity fields (identical redraw => identical pixels) */
const eqDig = (a, b) => !!(a && b && a.ok === true && b.ok === true &&
  a.ink === b.ink && a.inkSum === b.inkSum && a.sumLum === b.sumLum && a.nonBlack === b.nonBlack);
const eqAll = (A, B) => eqDig(A && A.scope, B && B.scope) && eqDig(A && A.spectrum, B && B.spectrum) && eqDig(A && A.waterfall, B && B.waterfall);
const anyChanged = (A, B) => !(eqDig(A && A.scope, B && B.scope) && eqDig(A && A.spectrum, B && B.spectrum) && eqDig(A && A.waterfall, B && B.waterfall));
/* "the digest rises" — any ONE genuine rise measure clears its margin; all are live digests. */
const riseOk = (a, b) => {
  if (!a || !b || a.ok !== true || b.ok !== true) return false;
  if (b.sumLum > a.sumLum * 1.05 + 1) return true;
  if (b.inkSum > a.inkSum * 1.08 + 1) return true;
  if (b.ink > a.ink + Math.max(24, Math.ceil(a.ink * 0.03))) return true;
  if (b.nonBlack > a.nonBlack + Math.max(16, Math.ceil(a.nonBlack * 0.02))) return true;
  return false;
};
/* __DECK_PURE_END */

/* ---------- page-side scaffolding injected at runtime (rig-owned; never app code) ----------
   __deckw: the rig's OWN witnesses / digests / drivers —
     digest(key): page-side getImageData summary of a deck canvas (bg-relative ink + raw sums;
                  Float32/bytes never cross CDP);
     digestAll(): the three deck canvases at once (freeze/pause pixel-identity law);
     frame(kind): normalized avDeckFrame() shapes (scope n/min-max, spectrum bands/peakBand/peakHz,
                  waterfall rows/rowMs/latestRow, meters keys + null/finite honesty, gain l/r/peak);
     readouts()/surface()/state(): JSON-safe probes of the deck readout row, module surface and
                  __avDeckUi.state()/__avDeck.snapshot();
     attach()/detach(): avDeckAttach/avDeckDetach receipts (ctx identity vs the engine/avTap grab);
     step(n)/core(n): SYNCHRONOUS step drivers — __avDeckUi.step() (forced step + full draw) and
                  avDeckStep() (the core seam); the rig never depends on rAF timing;
     setViewAll(patch): tolerant engagement across avDeckSetView kinds + a card-toggle click fallback;
     notesOn/notesOff/notes: the ONE avNote bus (avNoteDown/avNoteUp/avNoteStopAll + window.__avNotes);
     applyBpm(v): avApplyParam('bpm', v);
     witArm/witMax/witRelease: the RIG OWN AnalyserNode on avMasterFor(ctx) — panel reads are never
                  witnesses; restored (disconnected) after the reading. */

const DECKW_HELPERS = `window.__deckw = (function () {
  const W = { v: 1, rig: {}, wit: null };
  W.num = function (x) { return (typeof x === 'number' && isFinite(x)) ? x : null; };
  W.light = function (x) {
    if (x === undefined) return null;
    if (x === null) return null;
    if (typeof x !== 'object') return x;
    const out = {};
    let n = 0;
    for (const k in x) {
      if (n >= 12) break;
      let v = null;
      try { v = x[k]; } catch (e) { v = null; }
      const t = typeof v;
      if (t === 'number') { out[k] = isFinite(v) ? v : String(v); n++; }
      else if (t === 'string') { out[k] = v.length > 64 ? v.slice(0, 64) : v; n++; }
      else if (t === 'boolean' || v === null) { out[k] = v; n++; }
      else if (Array.isArray(v)) { out[k] = 'array[' + v.length + ']'; n++; }
      else if (t === 'object') { out[k] = 'obj' + (typeof v.length === 'number' ? '[' + v.length + ']' : ''); n++; }
      else { out[k] = t; n++; }
    }
    return out;
  };
  W.liveCtx = function () {
    try { const e = window.__avEngine; if (e && e.handle && e.handle.ctx) return e.handle.ctx; } catch (x) { }
    try {
      if (typeof avTap !== 'undefined' && avTap) {
        if (avTap.ctx) return avTap.ctx;
        const l = avTap.live || [];
        for (let i = 0; i < l.length; i++) { if (l[i] && l[i].state !== 'closed') return l[i]; }
      }
    } catch (x) { }
    return null;
  };
  W.canvas = function (key) {
    try {
      const id = 'av-deck-' + key;
      const pick = function (el) { return (el && typeof el.getContext === 'function') ? el : null; };
      let el = pick(document.getElementById(id));
      if (!el) el = pick(document.querySelector('.' + id));
      if (!el) el = pick(document.querySelector('[class*=\"' + id + '\"]'));
      if (!el) {
        const host = document.getElementById('av-deck-host') || document.getElementById('av-deck');
        const cs = host ? host.querySelectorAll('canvas') : [];
        for (let i = 0; i < cs.length; i++) {
          const tag = String(cs[i].id || '') + ' ' + String(cs[i].className || '');
          if (tag.toLowerCase().indexOf(key) >= 0) { el = cs[i]; break; }
        }
      }
      return el || null;
    } catch (e) { return null; }
  };
  W.digest = function (key) {
    try {
      const el = W.canvas(key);
      if (!el) return { ok: false, why: 'no canvas for ' + key };
      const w = el.width, h = el.height;
      if (!w || !h) return { ok: false, why: 'zero-size canvas ' + key };
      const g = el.getContext('2d');
      if (!g || typeof g.getImageData !== 'function') return { ok: false, why: 'no 2d context for ' + key };
      const img = g.getImageData(0, 0, w, h);
      const d = img.data;
      const hist = new Array(24).fill(0);
      let sumLum = 0, nonBlack = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const lum = d[i] + d[i + 1] + d[i + 2];
        sumLum += lum;
        if (lum > 24) nonBlack++;
        const bi = (lum >> 5) < 23 ? (lum >> 5) : 23;
        hist[bi]++;
        n++;
      }
      let bg = 0, bgN = -1;
      for (let b = 0; b < hist.length; b++) { if (hist[b] > bgN) { bgN = hist[b]; bg = b; } }
      const bgMid = bg * 32 + 16;
      const thr = bgMid + 72;
      let ink = 0, inkSum = 0;
      for (let i = 0; i < d.length; i += 4) {
        const lum = d[i] + d[i + 1] + d[i + 2];
        if (lum > thr) { ink++; inkSum += (lum - bgMid); }
      }
      return { ok: true, key: key, w: w, h: h, n: n, sumLum: sumLum, nonBlack: nonBlack, nonBlackFrac: n ? nonBlack / n : 0, bg: bgMid, ink: ink, inkFrac: n ? ink / n : 0, inkSum: inkSum };
    } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
  };
  W.digestAll = function () { return { scope: W.digest('scope'), spectrum: W.digest('spectrum'), waterfall: W.digest('waterfall') }; };
  W.frame = function (kind) {
    try {
      const D = window.__avDeck;
      if (!D || typeof D.frame !== 'function') return { found: false };
      const f = D.frame(kind);
      if (!f || typeof f !== 'object') return { found: true, shape: 'none' };
      const out = { found: true, ready: f.ready === true };
      if (kind === 'scope') {
        const mn = f.min, mx = f.max;
        out.n = W.num(f.n);
        out.minLen = (mn && typeof mn.length === 'number') ? mn.length : null;
        out.maxLen = (mx && typeof mx.length === 'number') ? mx.length : null;
        out.minType = mn ? ((mn.constructor && mn.constructor.name) || typeof mn) : 'none';
        out.maxType = mx ? ((mx.constructor && mx.constructor.name) || typeof mx) : 'none';
        let maxAbs = 0, ok = true, cnt = 0;
        const scan = function (arr) {
          if (!arr || typeof arr.length !== 'number') return;
          for (let i = 0; i < arr.length; i++) {
            const v = arr[i];
            if (typeof v !== 'number' || !isFinite(v)) { ok = false; continue; }
            const a = v < 0 ? -v : v;
            if (a > maxAbs) maxAbs = a;
            cnt++;
          }
        };
        scan(mn); scan(mx);
        out.maxAbs = maxAbs; out.allFinite = ok; out.scanned = cnt;
        return out;
      }
      if (kind === 'spectrum') {
        const b = f.bands;
        out.bandsLen = (b && typeof b.length === 'number') ? b.length : null;
        out.bandsType = b ? ((b.constructor && b.constructor.name) || typeof b) : 'none';
        let sum = 0, mx = -Infinity, ok = true;
        if (b && typeof b.length === 'number') {
          for (let i = 0; i < b.length; i++) {
            const v = b[i];
            if (typeof v !== 'number' || !isFinite(v)) { ok = false; continue; }
            sum += v; if (v > mx) mx = v;
          }
        }
        out.bandSum = sum; out.bandMax = isFinite(mx) ? mx : null; out.bandsFinite = ok;
        out.peakBand = (typeof f.peakBand === 'number' && isFinite(f.peakBand)) ? f.peakBand : null;
        out.peakHz = W.num(f.peakHz);
        return out;
      }
      if (kind === 'waterfall') {
        out.rows = W.num(f.rows);
        out.rowMs = W.num(f.rowMs);
        const lr = f.latestRow;
        const cols = W.num(f.cols);
        let row = null;
        if (lr && typeof lr.length === 'number') { row = lr; }
        else if (typeof lr === 'number' && lr >= 0 && cols && f.data && typeof f.data.length === 'number') {
          const c = Math.round(cols);
          if (f.data.length >= (lr + 1) * c) {
            row = new Array(c);
            for (let i = 0; i < c; i++) row[i] = Number(f.data[lr * c + i]);
          } else if (f.data.length === 96 && f.data[lr] && typeof f.data[lr].length === 'number') {
            row = f.data[lr];
          }
        }
        out.latestIdx = (typeof lr === 'number') ? lr : null;
        out.latestLen = (row && typeof row.length === 'number') ? row.length : null;
        let s = 0, ok = true;
        if (row && typeof row.length === 'number') {
          for (let i = 0; i < row.length; i++) {
            const v = row[i];
            if (typeof v !== 'number' || !isFinite(v)) { ok = false; continue; }
            s += v;
          }
        }
        out.latestSum = s; out.latestFinite = ok;
        return out;
      }
      if (kind === 'meters') {
        out.has = {}; out.raw = {};
        const keys = ['lufsShort', 'dbtp', 'peakDb', 'energyDb'];
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          out.has[k] = Object.prototype.hasOwnProperty.call(f, k);
          const v = f[k];
          out.raw[k] = (v === null) ? 'null' : (typeof v === 'number' ? (isFinite(v) ? 'num' : 'NONFINITE') : (v === undefined ? 'undefined' : typeof v));
        }
        out.lufsShort = W.num(f.lufsShort); out.dbtp = W.num(f.dbtp); out.peakDb = W.num(f.peakDb); out.energyDb = W.num(f.energyDb);
        return out;
      }
      if (kind === 'gain') {
        out.l = W.num(f.l); out.r = W.num(f.r); out.peak = W.num(f.peak);
        out.keys = W.light(f);
        return out;
      }
      out.keys = W.light(f);
      return out;
    } catch (e) { return { found: true, err: String((e && e.message) || e) }; }
  };
  W.meters = function () { return W.frame('meters'); };
  W.readouts = function () {
    try {
      if (typeof avDeckReadouts !== 'function') return { found: false };
      const r = avDeckReadouts() || {};
      const out = { found: true };
      const keys = ['bpm', 'grid', 'voices', 'maxVoices', 'tier', 'ctxState', 'cpuMs', 'cpuAvgMs', 'notesSeen', 'fps'];
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const v = r[k];
        out['has_' + k] = Object.prototype.hasOwnProperty.call(r, k);
        if (typeof v === 'number') out[k] = isFinite(v) ? v : String(v);
        else if (typeof v === 'string') out[k] = v.length > 48 ? v.slice(0, 48) : v;
        else if (v === null) out[k] = null;
        else out[k] = typeof v;
      }
      out.has_lastNote = Object.prototype.hasOwnProperty.call(r, 'lastNote');
      const ln = r.lastNote;
      out.lastNote = (ln && typeof ln === 'object') ? { name: (typeof ln.name === 'string') ? ln.name : null, vel: W.num(ln.vel), at: W.num(ln.at), keys: Object.keys(ln).slice(0, 6) } : null;
      return out;
    } catch (e) { return { found: true, err: String((e && e.message) || e) }; }
  };
  W.state = function () {
    const out = {};
    try {
      const ui = window.__avDeckUi;
      if (ui && typeof ui.state === 'function') {
        const s = ui.state();
        out.ui = W.light(s);
        out.uiRaw = {};
        if (s && typeof s === 'object') {
          for (const k in s) {
            const v = s[k];
            if (typeof v === 'boolean') out.uiRaw[k] = v;
            else if (typeof v === 'number') out.uiRaw[k] = isFinite(v) ? v : String(v);
            else if (typeof v === 'string' && v.length <= 24) out.uiRaw[k] = v;
          }
        }
      }
    } catch (e) { out.uiErr = String((e && e.message) || e); }
    try {
      const D = window.__avDeck;
      if (D && typeof D.snapshot === 'function') {
        const s = D.snapshot();
        out.snapKeys = (s && typeof s === 'object') ? Object.keys(s).slice(0, 24) : null;
        out.snap = W.light(s);
      }
    } catch (e) { out.snapErr = String((e && e.message) || e); }
    return out;
  };
  W.surface = function () {
    const g = function (n) { return typeof window[n]; };
    const deckFns = ['avDeckInit', 'avDeckAttach', 'avDeckDetach', 'avDeckStep', 'avDeckFrame', 'avDeckReadouts', 'avDeckSetView', 'avDeckClasses'];
    const uiFns = ['avDeckUiInit', 'avDeckUiClasses', 'avDeckUiSync', 'avDeckUiSnap'];
    const missing = deckFns.concat(uiFns).filter(function (n) { return g(n) !== 'function'; });
    const D = window.__avDeck || null;
    const U = window.__avDeckUi || null;
    const dfns = ['init', 'attach', 'detach', 'step', 'frame', 'readouts', 'setView', 'snapshot'];
    const dmissing = dfns.filter(function (n) { return !(D && typeof D[n] === 'function'); });
    const P = (D && D.pure) || null;
    const pfns = ['hzToBand', 'bandToHz', 'bandCount', 'logBandPlan', 'dbOfAmp', 'holdDecay', 'meterNorm'];
    const pmissing = pfns.filter(function (n) { return !(P && typeof P[n] === 'function'); });
    let initTrue = null, initErr = null;
    try { initTrue = (typeof avDeckInit === 'function') ? (avDeckInit() === true) : null; } catch (e) { initErr = String((e && e.message) || e); }
    let uiInit = null, uiInitErr = null;
    try { uiInit = (typeof avDeckUiInit === 'function') ? (avDeckUiInit() !== false) : null; } catch (e) { uiInitErr = String((e && e.message) || e); }
    let sync = null;
    try { sync = (typeof avDeckUiSync === 'function') ? avDeckUiSync() : null; } catch (e) { sync = 'threw'; }
    let snapObj = false, snapKeys = null;
    try {
      if (D && typeof D.snapshot === 'function') {
        const s = D.snapshot();
        snapObj = !!(s && typeof s === 'object');
        snapKeys = snapObj ? Object.keys(s).slice(0, 24) : null;
      }
    } catch (e) { }
    let deckClasses = null, uiClasses = null;
    try { deckClasses = (typeof avDeckClasses === 'function') ? (avDeckClasses() || []).length : null; } catch (e) { deckClasses = 'threw'; }
    try { uiClasses = (typeof avDeckUiClasses === 'function') ? (avDeckUiClasses() || []).length : null; } catch (e) { uiClasses = 'threw'; }
    return { missing: missing, dmissing: dmissing, pmissing: pmissing,
      deckHandle: !!D, deckVersion: D ? D.version : null, deckVersionType: D ? typeof D.version : 'none',
      uiHandle: !!U, uiState: !!(U && typeof U.state === 'function'), uiStep: !!(U && typeof U.step === 'function'),
      initTrue: initTrue, initErr: initErr, uiInit: uiInit, uiInitErr: uiInitErr, sync: sync,
      deckClasses: deckClasses, uiClasses: uiClasses, snapObj: snapObj, snapKeys: snapKeys };
  };
  W.attach = function () {
    let r = null, err = null;
    try { r = (typeof avDeckAttach === 'function') ? avDeckAttach() : null; } catch (e) { err = String((e && e.message) || e); }
    const live = W.liveCtx();
    const rr = (r && typeof r === 'object') ? r : {};
    const fft = W.num(rr.fft);
    return { ok: rr.ok === true, sameAsLive: !!(rr.ctx && live && rr.ctx === live), ctxIsObj: !!(rr.ctx && typeof rr.ctx === 'object'),
      rate: W.num(rr.rate), fft: fft, fftPow2: (fft != null) ? ((fft & (fft - 1)) === 0) : null, err: err, raw: W.light(r) };
  };
  W.detach = function () {
    let r = null, err = null;
    try { r = (typeof avDeckDetach === 'function') ? avDeckDetach() : null; } catch (e) { err = String((e && e.message) || e); }
    return { ret: (typeof r === 'boolean') ? r : W.light(r), err: err };
  };
  W.click = function (keys) {
    try {
      const host = document.getElementById('av-deck-host') || document.getElementById('av-deck');
      if (!host) return null;
      const els = host.querySelectorAll('button, [role=\"button\"], .av-btn, [data-act]');
      for (let i = 0; i < els.length; i++) {
        const e = els[i];
        const label = ((e.textContent || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '') + ' ' + String(e.className || '') + ' ' + (e.id || '')).toLowerCase();
        for (let k = 0; k < keys.length; k++) {
          if (label.indexOf(keys[k]) >= 0) {
            try { e.click(); } catch (x) { return 'click-threw'; }
            return label.slice(0, 64);
          }
        }
      }
      return null;
    } catch (e) { return null; }
  };
  W.setViewAll = function (patch) {
    const kinds = ['scope', 'spectrum', 'waterfall', 'meters', 'gain', 'all', 'deck'];
    const tried = [];
    let anyOk = false;
    for (let i = 0; i < kinds.length; i++) {
      let r = null;
      try { r = (typeof avDeckSetView === 'function') ? avDeckSetView(kinds[i], patch) : null; } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
      const ok = !!(r && r.ok === true);
      if (ok) anyOk = true;
      tried.push({ kind: kinds[i], ok: ok, view: (r && r.view) ? W.light(r.view) : null });
    }
    let clicked = null;
    if (!anyOk) {
      if (Object.prototype.hasOwnProperty.call(patch, 'freeze')) clicked = W.click(['freeze', 'hold']);
      else if (Object.prototype.hasOwnProperty.call(patch, 'run')) clicked = W.click(['pause', 'run', 'play']);
    }
    return { ok: anyOk || !!clicked, anyOk: anyOk, clicked: clicked, tried: tried };
  };
  W.notes = function () {
    try { return (typeof window.__avNotes === 'function') ? window.__avNotes() : null; } catch (e) { return null; }
  };
  W.notesOn = function (names, vel) {
    const out = { down: [] };
    for (let i = 0; i < (names || []).length; i++) {
      let r = false;
      try {
        r = (typeof vel === 'number') ? (avNoteDown(names[i], vel) === true) : (avNoteDown(names[i]) === true);
      } catch (e) { r = 'threw'; }
      out.down.push({ name: names[i], fresh: r });
    }
    const st = W.notes();
    out.held = st ? st.held : null;
    out.taken = st ? st.taken : null;
    return out;
  };
  W.notesOff = function () {
    const st = W.notes();
    const held = (st && st.held) || [];
    for (let i = 0; i < held.length; i++) { try { avNoteUp(held[i]); } catch (e) { } }
    try { if (typeof avNoteStopAll === 'function') avNoteStopAll(); } catch (e) { }
    const st2 = W.notes();
    return { after: st2 ? { held: st2.held, taken: st2.taken } : null };
  };
  W.applyBpm = function (v) { try { return avApplyParam('bpm', v) === true; } catch (e) { return 'threw: ' + String((e && e.message) || e); } };
  W.step = function (n) {
    const out = { n: 0, err: 0, ui: false, last: null };
    const ui = window.__avDeckUi;
    out.ui = !!(ui && typeof ui.step === 'function');
    for (let i = 0; i < (n || 1); i++) {
      if (!out.ui) { out.err++; break; }
      let r = null;
      try { r = ui.step(); } catch (e) { out.err++; }
      out.n++;
      out.last = W.light(r);
    }
    return out;
  };
  W.core = function (n) {
    const out = { n: 0, err: 0, first: null, last: null };
    for (let i = 0; i < (n || 1); i++) {
      let r = null;
      try { r = (typeof avDeckStep === 'function') ? avDeckStep() : null; } catch (e) { out.err++; }
      if (i === 0) out.first = W.light(r);
      out.last = W.light(r);
      out.n++;
    }
    return out;
  };
  W.witArm = function () {
    try {
      if (W.wit) { try { W.wit.an.disconnect(); } catch (e) { } W.wit = null; }
      const ctx = W.liveCtx();
      const master = (ctx && typeof avMasterFor === 'function') ? avMasterFor(ctx) : null;
      if (!ctx || !master) return { ok: false, why: 'no live ctx/master tap' };
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      an.smoothingTimeConstant = 0;
      master.connect(an);
      W.wit = { an: an, td: new Float32Array(an.fftSize), sr: ctx.sampleRate };
      return { ok: true, sr: ctx.sampleRate, fft: an.fftSize };
    } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
  };
  W.witMax = function (ms) {
    return new Promise(function (resolve) {
      const wit = W.wit;
      if (!wit || !wit.an) { resolve({ ok: false, why: 'witness not armed' }); return; }
      let max = 0, n = 0, sum = 0;
      const read = function () {
        try {
          wit.an.getFloatTimeDomainData(wit.td);
          let s = 0;
          for (let i = 0; i < wit.td.length; i++) { const v = wit.td[i]; s += v * v; }
          const rms = Math.sqrt(s / wit.td.length);
          if (rms > max) max = rms;
          sum += rms; n++;
        } catch (e) { }
      };
      const iv = setInterval(read, 8);
      setTimeout(function () {
        try { clearInterval(iv); } catch (e) { }
        resolve({ ok: true, max: max, mean: n ? sum / n : 0, n: n, sr: wit.sr });
      }, ms);
    });
  };
  W.witRelease = function () {
    const had = !!W.wit;
    let ok = true;
    if (W.wit) {
      try { W.wit.an.disconnect(); } catch (e) { ok = false; }
      W.wit = null;
    }
    return { ok: ok, had: had };
  };
  return W;
})(); true`;

const shotPath = path.join(here, '..', 'renders', 'deck-suite.png');

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
  const pump = async (rounds, sleepMs, steps) => {
    for (let i = 0; i < rounds; i++) {
      await sleep(sleepMs);
      await ev('window.__deckw.step(' + (steps || 1) + ')');
    }
  };

  /* ── 1. boot + helpers + card + controls + module surface ── */
  console.log('── 1. boot + card + surface ──');
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const r = await ev(`document.documentElement.getAttribute('data-av-ready') === '1'`);
    if (r.value === true) { ready = true; break; }
    await sleep(300);
  }
  /* the live engine ctx (the deck must attach to THIS context — never a fresh AudioContext) */
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
  if (eng.found !== true || eng.state !== 'running') note('engine ctx not running yet — the deck attach leg will surface the honest refusal');

  await ev(DECKW_HELPERS);
  const hR = await ev(`!!(window.__deckw && window.__deckw.v === 1 && typeof window.__deckw.digest === 'function' && typeof window.__deckw.frame === 'function' && typeof window.__deckw.core === 'function' && typeof window.__deckw.witArm === 'function' && typeof window.__deckw.setViewAll === 'function')`);
  expected(val(hR) === true, '1b rig helpers injected (__deckw v1: page-side digests · frames · step drivers · view engagement · avNote bus · rig-own witness)');

  let cardUp = false, cardInfo = '';
  for (let i = 0; i < 100 && !cardUp; i++) {
    const r = await ev(`(() => {
      const host = document.getElementById('av-deck-host');
      const card = document.getElementById('av-deck');
      const root = host ? host.querySelector('.av-deck, [class*="av-deck"]') : null;
      const wired = !!(host && host.dataset && host.dataset.avDeckUiWired === '1') || !!(card && card.dataset && card.dataset.avDeckUiWired === '1');
      const W = window.__deckw;
      const canvases = W ? { scope: !!W.canvas('scope'), spectrum: !!W.canvas('spectrum'), waterfall: !!W.canvas('waterfall') } : null;
      return { host: !!host, card: !!card, root: !!root, wired: wired, canvases: canvases };
    })()`);
    const v = val(r) || {};
    cardUp = v.host === true && v.card === true && v.root === true && v.wired === true && !!(v.canvases && v.canvases.scope && v.canvases.spectrum && v.canvases.waterfall);
    cardInfo = J(v);
    if (!cardUp) await sleep(150);
  }
  expected(cardUp, '1c card mounted: #av-deck + #av-deck-host + .av-deck root + wired marker (avDeckUiWired=1) + scope/spectrum/waterfall canvases', cardInfo);
  if (!cardUp) { console.error('DECK CARD MISSING — parent adds the #av-deck card + #av-deck-host and calls avDeckUiInit()'); process.exit(1); }

  const ctrlR = await ev(`(() => {
    const host = document.getElementById('av-deck-host') || document.getElementById('av-deck');
    if (!host) return { host: false };
    const els = [...host.querySelectorAll('button, [role="button"], input, select, .av-btn, [data-act]')];
    const label = (e) => (((e.textContent || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '') + ' ' + String(e.className || '') + ' ' + (e.id || '') + ' ' + JSON.stringify(e.dataset || {})).toLowerCase());
    const ctrlLabels = els.map(label);
    const leaves = [...host.querySelectorAll('span, b, i, em, strong, small, output, label, td, option, div')].filter((e) => e.children.length === 0);
    const leafLabels = leaves.map((e) => (((e.textContent || '') + ' ' + String(e.className || '') + ' ' + (e.id || '')).toLowerCase()));
    const hit = (arr, keys) => arr.filter((t) => keys.some((k) => t.indexOf(k) >= 0)).length;
    return { host: true, controls: els.length, leaves: leaves.length,
      runpause: hit(ctrlLabels, ['run', 'pause', 'play']), freeze: hit(ctrlLabels, ['freeze', 'hold']),
      floor: hit(ctrlLabels, ['floor']), wf: hit(ctrlLabels, ['waterfall', 'speed', 'rate']),
      bpm: hit(leafLabels, ['bpm', 'tempo']), voices: hit(leafLabels, ['voice']), tier: hit(leafLabels, ['tier']),
      ctx: hit(leafLabels, ['ctx', 'context']), cpu: hit(leafLabels, ['cpu']), notes: hit(leafLabels, ['note']) };
  })()`);
  const ctrl = val(ctrlR) || {};
  expected(ctrl.host === true && ctrl.runpause >= 1 && ctrl.freeze >= 1 && ctrl.floor >= 1 && ctrl.wf >= 1 &&
    ctrl.bpm >= 1 && ctrl.voices >= 1 && ctrl.tier >= 1 && ctrl.ctx >= 1 && ctrl.cpu >= 1 && ctrl.notes >= 1,
    '1d controls + readouts: RUN/PAUSE · FREEZE · DB FLOOR · WATERFALL rate (tolerant scan) + readout labels BPM · VOICES · TIER · CTX · CPU · NOTES',
    J(ctrl));

  const srf = val(await ev('window.__deckw.surface()')) || {};
  expected(Array.isArray(srf.missing) && srf.missing.length === 0 &&
    Array.isArray(srf.dmissing) && srf.dmissing.length === 0 &&
    Array.isArray(srf.pmissing) && srf.pmissing.length === 0 &&
    srf.deckHandle === true && typeof srf.deckVersion === 'string' && srf.deckVersion.length >= 1 &&
    srf.uiHandle === true && srf.uiState === true && srf.uiStep === true &&
    srf.initTrue === true && srf.uiInit !== null && srf.snapObj === true && Number(srf.uiClasses) >= 6,
    '1e module surface: avDeck* + avDeckUi* globals · window.__avDeck { version, init, attach, detach, step, frame, readouts, setView, snapshot } · __avDeckUi { state, sync, step } · pure surface · avDeckInit() true · snapshot object',
    J(srf));

  /* ── 2. pure math + attach + step shapes ── */
  console.log('── 2. pure math + attach + shapes ──');
  const pureB = val(await ev(`(() => {
    const D = window.__avDeck;
    const P = D && D.pure;
    if (!P) return { ok: false };
    const o = { ok: true };
    o.count = P.bandCount();
    o.hz20 = P.hzToBand(20); o.hz20k = P.hzToBand(20000); o.hzC4 = P.hzToBand(261.6256);
    o.mono = (P.hzToBand(40) <= P.hzToBand(1000)) && (P.hzToBand(1000) <= P.hzToBand(10000));
    o.b0 = P.bandToHz(0); o.b95 = P.bandToHz(95); o.bMid = P.bandToHz(47);
    const plan = P.logBandPlan(48000, 4096, 96);
    o.planLen = (plan && typeof plan.length === 'number') ? plan.length : null;
    o.planType = plan ? ((plan.constructor && plan.constructor.name) || typeof plan) : 'none';
    return o;
  })()`)) || {};
  expected(pureB.ok === true && pureB.count === 96 && pureB.hz20 === 0 && pureB.hz20k === 95 &&
    typeof pureB.hzC4 === 'number' && pureB.hzC4 >= 0 && pureB.hzC4 <= 95 && pureB.mono === true &&
    typeof pureB.b0 === 'number' && pureB.b0 >= 19 && pureB.b0 <= 22 &&
    typeof pureB.b95 === 'number' && pureB.b95 >= 9000 && pureB.b95 <= 20005 && Number(pureB.planLen) >= 96,
    '2a pure bands: bandCount 96 · hzToBand(20 Hz) = 0 · hzToBand(20 kHz) = 95 · monotone · bandToHz(0) ~ 20 Hz · bandToHz(95) reaches the top · logBandPlan >= 96 edges',
    J(pureB));

  const pureM = val(await ev(`(() => {
    const P = window.__avDeck && window.__avDeck.pure;
    if (!P) return { ok: false };
    const o = { ok: true };
    o.db1 = P.dbOfAmp(1);
    o.db05 = P.dbOfAmp(0.5);
    const z = P.dbOfAmp(0);
    o.db0 = (z === null) ? 'null' : (typeof z === 'number' ? (isFinite(z) ? z : 'nonfinite') : typeof z);
    o.mnFloor = P.meterNorm(-60, -60, 0); o.mnTop = P.meterNorm(0, -60, 0);
    o.mnLo = P.meterNorm(-120, -60, 0); o.mnHi = P.meterNorm(12, -60, 0);
    o.mnMid = P.meterNorm(-30, -60, 0);
    o.monoMeter = (P.meterNorm(-50, -60, 0) <= P.meterNorm(-30, -60, 0)) && (P.meterNorm(-30, -60, 0) <= P.meterNorm(-10, -60, 0));
    o.hdDecay = P.holdDecay(1, 0, 0.5, 0.5); o.hdRise = P.holdDecay(0, 1, 0.5, 0.5);
    o.hdSame = P.holdDecay(0.8, 0.8, 0.5, 0.5); o.hdDrop = P.holdDecay(0.9, 0.1, 0.5, 0.5);
    return o;
  })()`)) || {};
  expected(pureM.ok === true &&
    typeof pureM.db1 === 'number' && Math.abs(pureM.db1) <= 0.001 &&
    typeof pureM.db05 === 'number' && Math.abs(pureM.db05 + 6.0206) <= 0.05 &&
    (pureM.db0 === 'null' || pureM.db0 === 'nonfinite') &&
    pureM.mnFloor === 0 && pureM.mnTop === 1 && pureM.mnLo === 0 && pureM.mnHi === 1 &&
    typeof pureM.mnMid === 'number' && pureM.mnMid > 0 && pureM.mnMid < 1 && pureM.monoMeter === true &&
    typeof pureM.hdDecay === 'number' && pureM.hdDecay < 1 && pureM.hdDecay >= 0 &&
    typeof pureM.hdRise === 'number' && pureM.hdRise > 0 && pureM.hdRise <= 1 &&
    pureM.hdSame === 0.8 &&
    typeof pureM.hdDrop === 'number' && pureM.hdDrop >= 0.1 - 1e-9 && pureM.hdDrop <= 0.9 + 1e-9,
    '2b pure meters: dbOfAmp 1 -> 0 dB · 0.5 -> -6.02 ±0.05 · 0 non-finite honest · meterNorm floor 0 / top 1 / clamps / monotone · holdDecay decays, rises, holds at prev=cur',
    J(pureM));

  const att = val(await ev('window.__deckw.attach()')) || {};
  expected(att.ok === true && att.ctxIsObj === true && att.sameAsLive === true && att.rate === 48000 && att.fftPow2 === true && Number(att.fft) >= 256,
    '2c attach: ok on the LIVE ctx ONLY (identity vs the engine/avTap grab — no fresh AudioContext) · rate 48000 · fft a power of two >= 256',
    J(att));

  const c1 = val(await ev('window.__deckw.core(1)')) || {};
  await sleep(80);
  const c2 = val(await ev('window.__deckw.core(1)')) || {};
  const r1 = c1.last || {}, r2 = c2.last || {};
  expected(c1.n === 1 && c1.err === 0 && r1.attached === true &&
    typeof r1.frames === 'number' && typeof r1.at === 'number' && (r1.voices === null || typeof r1.voices === 'number') && typeof r1.notesSeen === 'number' &&
    c2.n === 1 && c2.err === 0 && r2.attached === true && typeof r2.frames === 'number' && r2.frames > r1.frames,
    '2d avDeckStep(): receipt { at, frames, attached:true, voices, notesSeen } present · frames ADVANCES across steps',
    J({ first: r1, second: r2, err1: c1.err, err2: c2.err }));

  const stE = val(await ev('window.__deckw.step(2)')) || {};
  await sleep(60);
  const sc = val(await ev('window.__deckw.frame("scope")')) || {};
  const sp = val(await ev('window.__deckw.frame("spectrum")')) || {};
  expected(stE.n === 2 && stE.err === 0 && stE.ui === true &&
    sc.found === true && sc.ready === true && sc.n === 480 && sc.minLen === 480 && sc.maxLen === 480 && sc.allFinite === true && sc.scanned === 960 &&
    sp.found === true && sp.ready === true && sp.bandsLen === 96 && sp.bandsFinite === true &&
    (sp.peakBand === null || sp.peakBand === -1 || (sp.peakBand >= 0 && sp.peakBand <= 95)) &&
    (sp.peakHz === null || (sp.peakHz >= 20 && sp.peakHz <= 20000)),
    '2e driver + scope/spectrum shapes: __avDeckUi.step(2) forced draws ok · scope { ready, n 480, min/max 480 finite } · spectrum { ready, bands 96 finite, peakBand 0..95 or none (null/-1) }',
    J({ step: { n: stE.n, err: stE.err, ui: stE.ui }, scope: sc, spectrum: sp }));

  const wf = val(await ev('window.__deckw.frame("waterfall")')) || {};
  const mt = val(await ev('window.__deckw.frame("meters")')) || {};
  const gn = val(await ev('window.__deckw.frame("gain")')) || {};
  const ro = val(await ev('window.__deckw.readouts()')) || {};
  const mKeys = ['lufsShort', 'dbtp', 'peakDb', 'energyDb'];
  const mOk = mt.found === true && mKeys.every(k => mt.has && mt.has[k] === true && mt.raw && mt.raw[k] !== 'NONFINITE' && (mt.raw[k] === 'null' || mt.raw[k] === 'undefined' || mt.raw[k] === 'num'));
  const wfOk = wf.found === true && typeof wf.rows === 'number' && wf.rows >= 0 && typeof wf.rowMs === 'number' && wf.rowMs >= 40 && wf.rowMs <= 250 &&
    (wf.rows === 0 || (wf.latestLen === 96 && wf.latestFinite === true));
  const gnOk = gn.found === true && typeof gn.l === 'number' && typeof gn.r === 'number' && typeof gn.peak === 'number';
  const rKeys = ['bpm', 'grid', 'voices', 'maxVoices', 'tier', 'ctxState', 'cpuMs', 'cpuAvgMs', 'notesSeen', 'lastNote', 'fps'];
  const roOk = ro.found === true && rKeys.every(k => ro['has_' + k] === true) &&
    typeof ro.bpm === 'number' && ro.bpm === 120 && typeof ro.grid === 'string' &&
    (ro.voices === null || typeof ro.voices === 'number') && (ro.maxVoices === null || (typeof ro.maxVoices === 'number' && ro.maxVoices >= 1)) &&
    typeof ro.tier === 'string' && ro.tier.length >= 1 && ro.ctxState === 'running' &&
    (ro.cpuMs === null || typeof ro.cpuMs === 'number') && (ro.cpuAvgMs === null || typeof ro.cpuAvgMs === 'number') && typeof ro.notesSeen === 'number' && typeof ro.fps === 'number';
  expected(wfOk && mOk && gnOk && roOk,
    '2f waterfall/meters/gain/readouts shapes: waterfall { rows, rowMs 40..250, latestRow 96 } · meters keys present null-honest · gain l/r/peak numbers · readouts all fields (bpm 120 at rest, ctxState running)',
    J({ waterfall: wf, meters: mt, gain: gn, readouts: ro }));

  /* ── 3. silence vs note ── */
  console.log('── 3. silence vs note ──');
  await ev('window.__deckw.notesOff()');
  await pump(3, 80, 2);
  const silScope = val(await ev('window.__deckw.frame("scope")')) || {};
  const silDig = val(await ev('window.__deckw.digest("scope")')) || {};
  const silMeters = val(await ev('window.__deckw.meters()')) || {};
  const silLufs = (typeof silMeters.lufsShort === 'number') ? silMeters.lufsShort : null;
  expected(silScope.found === true && silScope.ready === true && typeof silScope.maxAbs === 'number' && silScope.maxAbs < 1e-3 &&
    silDig.ok === true && typeof silDig.inkFrac === 'number' && silDig.inkFrac <= 0.5,
    '3a silence baseline: scope pull quiet (maxAbs < 1e-3) · scope canvas mostly dark (bg-relative ink <= 50%)',
    J({ scope: { ready: silScope.ready, maxAbs: silScope.maxAbs }, digest: { ink: silDig.ink, inkSum: silDig.inkSum, sumLum: silDig.sumLum, inkFrac: fx4(silDig.inkFrac) }, silentLufs: silLufs }));

  const down3 = val(await ev('window.__deckw.notesOn(["c4"])')) || {};
  let riseD = null, riseFr = null, risen = false;
  for (let i = 0; i < 16; i++) {
    await sleep(90);
    await ev('window.__deckw.step(2)');
    riseD = val(await ev('window.__deckw.digest("scope")')) || {};
    riseFr = val(await ev('window.__deckw.frame("scope")')) || {};
    if (riseOk(silDig, riseD) && typeof riseFr.maxAbs === 'number' && riseFr.maxAbs > 1e-4) { risen = true; break; }
  }
  expected(risen === true && !!(down3.down && down3.down[0] && down3.down[0].fresh === true),
    '3b note rise: avNoteDown(c4) + step x8 (audio-clock bounded) -> scope canvas digest RISES vs silence (live getImageData sums/ink) with the deck pull showing signal (maxAbs > 1e-4)',
    J({ silent: { ink: silDig.ink, inkSum: silDig.inkSum, sumLum: silDig.sumLum }, playing: riseD && { ink: riseD.ink, inkSum: riseD.inkSum, sumLum: riseD.sumLum, nonBlack: riseD.nonBlack }, frameMaxAbs: riseFr && riseFr.maxAbs, taken: down3.taken }));

  const spc = val(await ev(`(() => {
    const W = window.__deckw;
    const f = W.frame('spectrum');
    const P = (window.__avDeck && window.__avDeck.pure) || null;
    const exp = P ? P.hzToBand(261.6256) : null;
    return { f: f, exp: exp,
      diff: (f && typeof f.peakBand === 'number' && typeof exp === 'number') ? Math.abs(f.peakBand - exp) : null,
      hzRatio: (f && typeof f.peakHz === 'number') ? f.peakHz / 261.6256 : null };
  })()`)) || {};
  const spf = spc.f || {};
  expected(spf.found === true && spf.ready === true && spf.bandsLen === 96 && typeof spf.bandMax === 'number' && spf.bandMax > -120 &&
    typeof spf.peakBand === 'number' && typeof spc.exp === 'number' && typeof spc.diff === 'number' && spc.diff <= 3,
    '3c spectrum peak: peakBand within ±3 of pure.hzToBand(261.6256) (the c4 fundamental band, bandMax above the silence floor; rig-own expected)',
    J({ peakBand: spf.peakBand, peakHz: spf.peakHz, expBand: spc.exp, diff: spc.diff, bandMax: fx4(spf.bandMax), hzRatio: fx3(spc.hzRatio) }));

  const ro3 = val(await ev('window.__deckw.readouts()')) || {};
  expected(ro3.found === true && typeof ro3.notesSeen === 'number' && ro3.notesSeen >= 1 && ro3.lastNote && ro3.lastNote.name === 'c4',
    '3d note ticker: notesSeen advances (>= 1) · lastNote = { name: c4 } on the ONE avNote bus',
    J({ notesSeen: ro3.notesSeen, lastNote: ro3.lastNote }));

  /* ── 4. waterfall advance ── */
  console.log('── 4. waterfall ──');
  await pump(1, 280, 2);
  const w0 = val(await ev('window.__deckw.frame("waterfall")')) || {};
  const d0 = val(await ev('window.__deckw.digest("waterfall")')) || {};
  await pump(6, 300, 2);
  const w1 = val(await ev('window.__deckw.frame("waterfall")')) || {};
  const d1 = val(await ev('window.__deckw.digest("waterfall")')) || {};
  const rowsAdv = typeof w0.rows === 'number' && typeof w1.rows === 'number' &&
    (w1.rows > w0.rows || (w0.rows >= 96 && typeof w1.latestSum === 'number' && w1.latestSum !== w0.latestSum));
  expected(rowsAdv === true && typeof w1.rowMs === 'number' && w1.rowMs >= 40 && w1.rowMs <= 250 &&
    (w1.rows === 0 || (w1.latestLen === 96 && w1.latestFinite === true)),
    '4a waterfall: rows advance over steps (or the saturated 96-row ring keeps rotating — latestRow content changes) · rowMs within the pinned 40..250 range',
    J({ before: { rows: w0.rows, latestSum: w0.latestSum, rowMs: w0.rowMs }, after: { rows: w1.rows, latestSum: w1.latestSum, latestLen: w1.latestLen, rowMs: w1.rowMs } }));
  expected(d0.ok === true && d1.ok === true && !eqDig(d0, d1),
    '4b waterfall canvas CHANGES while playing (page-side digest before vs after the advance steps — rows are being drawn)',
    J({ before: { ink: d0.ink, inkSum: d0.inkSum, sumLum: d0.sumLum }, after: { ink: d1.ink, inkSum: d1.inkSum, sumLum: d1.sumLum } }));

  /* ── 5. meters + decay ── */
  console.log('── 5. meters + decay ──');
  await ev('window.__deckw.notesOn(["e4", "g4"])');
  let m1 = null;
  for (let i = 0; i < 34; i++) {
    await sleep(150);
    await ev('window.__deckw.step(3)');
    m1 = val(await ev('window.__deckw.meters()')) || {};
    if (typeof m1.lufsShort === 'number') break;
  }
  m1 = m1 || {};
  expected(typeof m1.lufsShort === 'number' && m1.lufsShort > -70 && (silLufs === null || m1.lufsShort > silLufs + 0.5),
    '5a meters: sustained c4+e4+g4 -> lufsShort FINITE and above the silent reading (null-until-signal counts as the floor)',
    J({ silentLufs: silLufs, lufsShort: m1.lufsShort, dbtp: m1.dbtp, peakDb: m1.peakDb, energyDb: m1.energyDb }));
  expected(typeof m1.dbtp === 'number' && typeof m1.peakDb === 'number' && m1.dbtp >= m1.peakDb - 1e-6,
    '5b meters: true peak >= sample peak during the sustained note (dbtp >= peakDb)',
    J({ dbtp: m1.dbtp, peakDb: m1.peakDb, lufsShort: m1.lufsShort }));
  const preE = (typeof m1.energyDb === 'number') ? m1.energyDb : null;
  await ev('window.__deckw.notesOff()');
  const series = [];
  for (let i = 0; i < 10; i++) {
    await sleep(80);
    await ev('window.__deckw.step(2)');
    const mm = val(await ev('window.__deckw.meters()')) || {};
    series.push(typeof mm.energyDb === 'number' ? mm.energyDb : null);
  }
  const svals = series.filter(x => typeof x === 'number');
  const minPost = svals.length ? Math.min(...svals) : null;
  expected(preE !== null && svals.length >= 2 && minPost !== null && (preE - minPost) >= 3,
    '5c meters decay: after note release energyDb DECAYS >= 3 dB within a bounded window (10 bursts x 2 steps — release tails respected)',
    J({ preRelease: fx3(preE), series: series.map(x => x === null ? null : fx3(x)), drop: (preE !== null && minPost !== null) ? fx3(preE - minPost) : null }));

  /* ── 6. voices ── */
  console.log('── 6. voices ──');
  await ev('window.__deckw.notesOff()');
  const six = val(await ev('window.__deckw.notesOn(["c4", "e4", "g4", "c5", "e5", "g5"])')) || {};
  let ro6a = null;
  for (let i = 0; i < 18; i++) {
    await sleep(200);
    await ev('window.__deckw.step(1)');
    ro6a = val(await ev('window.__deckw.readouts()')) || {};
    if (typeof ro6a.voices === 'number' && ro6a.voices > 0) break;
  }
  ro6a = ro6a || {};
  expected(Array.isArray(six.held) && six.held.length === 6 &&
    typeof ro6a.voices === 'number' && ro6a.voices > 0 && typeof ro6a.maxVoices === 'number' && ro6a.maxVoices >= 6 && ro6a.voices <= ro6a.maxVoices,
    '6a voices readout: 6 notes held -> voices > 0 and <= maxVoices (>= 6) within the engine-sampler chip window',
    J({ held: six.held, taken: six.taken, voices: ro6a.voices, maxVoices: ro6a.maxVoices, tier: ro6a.tier }));
  await ev('window.__deckw.notesOff()');
  let ro6b = null;
  for (let i = 0; i < 18; i++) {
    await sleep(200);
    await ev('window.__deckw.step(1)');
    ro6b = val(await ev('window.__deckw.readouts()')) || {};
    if (ro6b.voices === 0) break;
  }
  ro6b = ro6b || {};
  expected(ro6b.voices === 0, '6b voices release: all released -> readout returns to 0 within the bounded window', J({ voices: ro6b.voices }));

  /* ── 7. freeze / pause laws ── */
  console.log('── 7. freeze / pause ──');
  await ev('window.__deckw.notesOn(["c4"])');
  await pump(2, 140, 2);
  const frz = val(await ev('window.__deckw.setViewAll({ freeze: true })')) || {};
  const st1 = val(await ev('window.__deckw.state()')) || {};
  await pump(2, 160, 2);
  const dA = val(await ev('window.__deckw.digestAll()')) || {};
  const k1 = val(await ev('window.__deckw.core(1)')) || {};
  await sleep(80);
  const k2 = val(await ev('window.__deckw.core(1)')) || {};
  await pump(2, 160, 2);
  const dB = val(await ev('window.__deckw.digestAll()')) || {};
  expected(frz.ok === true && eqAll(dA, dB) && k2.n === 1 && k2.err === 0,
    '7a freeze: engaged + PLAYING -> scope/spectrum/waterfall digests IDENTICAL across steps (presented frames held; the deck kept stepping)',
    J({ engage: { ok: frz.ok, anyOk: frz.anyOk, clicked: frz.clicked, okKinds: (frz.tried || []).filter(t => t.ok).map(t => t.kind) }, uiRaw: st1.uiRaw, frozenDigest: { scopeInk: dA.scope && dA.scope.ink, spectrumInk: dA.spectrum && dA.spectrum.ink, waterfallInk: dA.waterfall && dA.waterfall.ink } }));

  const unf = val(await ev('window.__deckw.setViewAll({ freeze: false })')) || {};
  await ev('window.__deckw.notesOn(["e4"])');
  let dU = null, changed7b = false;
  for (let i = 0; i < 10; i++) {
    await sleep(140);
    await ev('window.__deckw.step(2)');
    dU = val(await ev('window.__deckw.digestAll()')) || {};
    if (anyChanged(dU, dA)) { changed7b = true; break; }
  }
  expected(unf.ok === true && changed7b === true,
    '7b unfreeze: freeze off + a new note -> digests DIFFER again (rendering resumed)',
    J({ engage: { ok: unf.ok, clicked: unf.clicked }, changed: changed7b, now: dU && { scopeInk: dU.scope && dU.scope.ink, spectrumInk: dU.spectrum && dU.spectrum.ink, waterfallInk: dU.waterfall && dU.waterfall.ink } }));

  const pz = val(await ev('window.__deckw.setViewAll({ run: false })')) || {};
  const st2 = val(await ev('window.__deckw.state()')) || {};
  await pump(2, 160, 2);
  const dC = val(await ev('window.__deckw.digestAll()')) || {};
  await pump(2, 160, 2);
  const dD = val(await ev('window.__deckw.digestAll()')) || {};
  expected(pz.ok === true && eqAll(dC, dD),
    '7c pause: RUN/PAUSE -> paused while playing -> digests IDENTICAL across steps (the same no-change law)',
    J({ engage: { ok: pz.ok, anyOk: pz.anyOk, clicked: pz.clicked, okKinds: (pz.tried || []).filter(t => t.ok).map(t => t.kind) }, uiRaw: st2.uiRaw, pausedDigest: { scopeInk: dC.scope && dC.scope.ink, spectrumInk: dC.spectrum && dC.spectrum.ink, waterfallInk: dC.waterfall && dC.waterfall.ink } }));

  const rz = val(await ev('window.__deckw.setViewAll({ run: true })')) || {};
  let dR = null, changed7d = false;
  for (let i = 0; i < 10; i++) {
    await sleep(140);
    await ev('window.__deckw.step(2)');
    dR = val(await ev('window.__deckw.digestAll()')) || {};
    if (anyChanged(dR, dC)) { changed7d = true; break; }
  }
  expected(rz.ok === true && changed7d === true,
    '7d resume: run on -> digests DIFFER again (the deck is live again before the seal legs)',
    J({ engage: { ok: rz.ok, clicked: rz.clicked }, changed: changed7d }));

  /* ── 8. bpm readout ── */
  console.log('── 8. bpm readout ──');
  const b1 = await ev('window.__deckw.applyBpm(140)');
  await ev('window.__deckw.step(1)');
  const roB1 = val(await ev('window.__deckw.readouts()')) || {};
  expected(b1.value === true && roB1.bpm === 140,
    '8a bpm readout: avApplyParam(bpm, 140) -> readout 140', J({ applied: b1.value, bpm: roB1.bpm }));
  const b2 = await ev('window.__deckw.applyBpm(120)');
  await ev('window.__deckw.step(1)');
  const roB2 = val(await ev('window.__deckw.readouts()')) || {};
  expected(b2.value === true && roB2.bpm === 120,
    '8b bpm restored: avApplyParam(bpm, 120) -> readout back to 120', J({ applied: b2.value, bpm: roB2.bpm }));

  /* ── 9. rig-own analyser witness law ── */
  console.log('── 9. rig-own witness ──');
  await ev('window.__deckw.notesOff()');
  await pump(3, 160, 1);
  const wa = val(await ev('window.__deckw.witArm()')) || {};
  const floor = val(await ev('window.__deckw.witMax(700)')) || {};
  await ev('window.__deckw.notesOn(["c4"])');
  const nt9 = val(await ev('window.__deckw.notes()')) || {};
  const during = val(await ev('window.__deckw.witMax(1200)')) || {};
  await ev('window.__deckw.notesOff()');
  const rel = val(await ev('window.__deckw.witRelease()')) || {};
  const taken9 = Array.isArray(nt9.taken) && nt9.taken.indexOf('c4') >= 0;
  expected(wa.ok === true && floor.ok === true && during.ok === true && taken9 === true &&
    typeof floor.max === 'number' && floor.max < 1e-4 &&
    typeof during.max === 'number' && during.max > Math.max(floor.max * 4, 1e-3),
    '9a witness: the RIG OWN AnalyserNode on avMasterFor(ctx) — silence floor < 1e-4 · note energy exceeds max(4x floor, 1e-3) (the panel is not the witness)',
    J({ arm: wa, floor: { max: fx3(floor.max), n: floor.n }, during: { max: fx3(during.max), mean: fx3(during.mean), n: during.n }, taken: nt9.taken }));
  const after9 = val(await ev('window.__deckw.notes()')) || {};
  expected(rel.ok === true && rel.had === true && Array.isArray(after9.held) && after9.held.length === 0,
    '9b witness restored: the rig analyser is detached after the reading · notes released (avNotes held empty)',
    J({ rel: rel, held: after9.held, taken: after9.taken }));

  /* ── 10. seal — screenshot, cleanup, errors, freeze ── */
  console.log('── 10. seal ──');
  await ev('window.__deckw.notesOn(["c4", "e4"])');
  await pump(2, 140, 2);
  await ev(`(() => { const el = document.getElementById('av-deck') || document.getElementById('av-deck-host'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); return true; })()`);
  await sleep(250);
  const rectR = await ev(`(() => { const el = document.getElementById('av-deck') || document.getElementById('av-deck-host'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }; })()`);
  const rect = val(rectR);
  let shotOk = false, shotInfo = 'no rect';
  if (rect && rect.w > 50 && rect.h > 50) {
    try {
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 2 }, captureBeyondViewport: true });
      const buf = Buffer.from(shot.data, 'base64');
      try { mkdirSync(path.dirname(shotPath), { recursive: true }); } catch (e) { }
      writeFileSync(shotPath, buf);
      shotOk = buf.length > 1000 && buf[0] === 0x89 && buf[1] === 0x50;
      shotInfo = buf.length + ' bytes · clip ' + Math.round(rect.w) + '×' + Math.round(rect.h) + ' @2x';
    } catch (e) { shotInfo = 'capture failed: ' + (e && e.message); }
  }
  expected(shotOk, '10a screenshot: renders/deck-suite.png (the deck card, scale 2 — taken while the deck is live)', shotInfo);

  const cleanR = await ev(`(async () => {
    const W = window.__deckw;
    const out = { det: null, pauseOk: null, before: {}, after: {} };
    try { out.before = { held: (W.notes() || {}).held, bpm: W.readouts().bpm, playing: (typeof avSeqIsPlaying === 'function') ? avSeqIsPlaying() : null }; } catch (e) { }
    try { const pz2 = W.setViewAll({ run: false }); out.pauseOk = pz2.ok; } catch (e) { out.pauseErr = String((e && e.message) || e); }
    try { W.notesOff(); } catch (e) { out.notesErr = String((e && e.message) || e); }
    let det = null;
    try { det = (typeof avDeckDetach === 'function') ? avDeckDetach() : null; } catch (e) { det = 'threw'; }
    out.det = det;
    try { if (typeof avSeqStop === 'function') avSeqStop(); } catch (e) { }
    try { if (typeof avApplyParam === 'function') avApplyParam('bpm', 120); } catch (e) { }
    await new Promise(function (res) { setTimeout(res, 300); });
    const c = W.core(1);
    const r2 = W.readouts();
    const ns = W.notes();
    out.after = { attached: (c.last || {}).attached, bpm: r2.bpm, held: ns ? ns.held.length : null, taken: ns ? ns.taken.length : null,
      playing: (typeof avSeqIsPlaying === 'function') ? avSeqIsPlaying() : null };
    return out;
  })()`);
  const cl = val(cleanR) || {};
  const ca = cl.after || {};
  expected(cl.det === true && ca.attached === false && ca.held === 0 && ca.taken === 0 && ca.bpm === 120 && ca.playing === false,
    '10b page left clean: deck detached (step attached:false) · notes off · bpm restored 120 · transport stopped (paused before detach)',
    J(cl).slice(0, 460));

  expected(errors.length === 0, '10c zero page errors (exceptions · Log errors · console.error)', 'page errors=' + errors.length + (errors.length ? ' | ' + errors.slice(0, 3).join(' | ') : ''));

  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after): ' + shaAfter);
  expected(shaAfter === shaBefore, '10d freeze: index.html sha256 before === after (unchanged by the run)', shaAfter);
  if (PIN) expected(shaBefore === PIN && shaAfter === PIN, '10e freeze: index.html sha256 = pinned', 'pinned ' + PIN.slice(0, 12) + '...');
  else note('EXPECT_SHA not pinned — after the DECK build, pass --sha <hex> or set the constant (never loosen)');

  console.log('');
  console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
  console.log('DECK-RESULT ' + JSON.stringify({ kind: 'anvil-cdp-deck', sha256Before: shaBefore, sha256After: shaAfter, pinned: PIN || null, passed: pass, failed: fail, checks: pass + fail, verdict: fail ? 'fail' : 'pass' }));
  console.log(fail ? 'DECK FAILED' : 'DECK PASSED');
  try { ws.close(); } catch { /* done */ }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('deck harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    /* profile-scoped cleanup (LAW): kill ONLY processes whose command line carries OUR temp
       profile — matched by its unique basename, so the pattern needs no backslash escaping */
    const tag = path.basename(profile);
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
