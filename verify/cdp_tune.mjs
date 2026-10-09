// cdp_tune.mjs - Anvil T wave TUNING STUDIO rig (the wave's dedicated rig; authored as child E1).
//
//   node verify/cdp_tune.mjs [path-to-index.html] [--port N] [--sha <hex>] > verify/last-cdp_tune.log 2>&1
//
// WHAT IT PROVES, in order (contract: verify/_t_wave.md section 7):
//   T1  boot: the #av-tune card is mounted into the parent-owned #av-tune-host (host children > 0)
//       and sits in the SYNTH zone.
//   T2  boot: every pinned card id exists (scale/root/morph/track-0..3/import/import-file/export/
//       lib/mts/status/mts-status) + avTuneUiInit/avTuneUiClasses/__avTuneUi live; zero page errors
//       at boot.
//   T3  facade: __avTune present (version + full key set) - builtinIds length 12 - builtin('12edo')
//       and builtin('just-major') resolve with the module's documented cents shape (av_tune.js:
//       just-major ships the 12 pitch classes PLUS the closing 2/1 formal octave -> 13 values,
//       first 0, last 1200, ascending; 12edo -> 12 values, last 1200). The values are recorded;
//       the pitch expectation below is recomputed from the FIXTURE, never from the module.
//   T4  select: #av-tune-scale -> just-major, #av-tune-root -> c4, #av-tune-morph -> 100 accepted
//       and mirrored in the LS pref av-tune-pref (v1).
//   T5  select: the engine stats carry the global slot (tune.active 0..6, slots[active] "just-major").
//   T6  spectrum witness: a clean VA patch (fx muted via avApplyParam) + avNoteDown('e4') through
//       the ONE note path; the witness is POLLED until the audio actually flows (rms > 0.001,
//       3 s deadline) -> the rig's OWN AnalyserNode on the master tap, 4-term Blackman-Harris
//       FFT -> the fundamental within +-3 Hz of the tuned pitch recomputed IN THE RIG from the
//       just-major cents fixture [0, 111.73, 203.91, 315.64, 386.31, 498.04, 590.22, 701.96,
//       813.69, 884.36, 1017.60, 1088.27] (note 64: 386.31 - 400 = -13.69 cents -> ~327.03 Hz);
//       panel/mirror reads are never the witness.
//   T7  spectrum witness (12-EDO control): the same helper reads ~329.63 Hz.
//   T8  morph: morph 0 -> the peak returns to 12-EDO and the tuned<->morph delta is witnessed.
//   T9  track: global 12edo + #av-tune-track-0 = edo19; a minimal one-note pattern on track 0
//       (e4 = midi 64) is loaded through the pinned import path (the cdp_seq.mjs flow) and a
//       real PLAY click runs the SCHED -> stats().tune.last proves the note carried the track
//       slot (slot name edo19, not the global active slot); stopped + restored.
//   T10 MTS parse: the 21-byte scale/octave 1-byte frame (F0 7F dev 08 08 c1 c2 c3 + 12 tuning
//       bytes + F7) -> ok + ground-truth cents at two degrees (byte 55 -> -14.0625, byte 73 ->
//       +14.0625 per the 100/64-cent step from byte 64; the malformed frame refuses).
//   T11 MTS apply: avTuneUiMtsApply(bytes) -> tune.active 7 + slot 7 named MTS live; OFF restores
//       the global active slot (captured before the toggle).
//   T12 import: a synthesized .scl File through #av-tune-import-file (DataTransfer + change) ->
//       a #av-tune-lib row with data-tune-id appears.
//   T13 import: __avTune.library.list() contains the item and its id matches the DOM row.
//   T14 persistence: reload -> the LS pref (sel/root/morph) + the library item survive fresh.
//   closing: screenshot renders/tune-suite.png - zero page errors - the freeze sha256 before===after
//   pair plus the EXPECT_SHA pin. EXPECT_SHA is null at authoring; a provided --sha <hex> becomes
//   the run-time expectation (cdp_hub semantics, verbatim). A PINNED run reports ONE more check
//   than an unpinned one: 17 checks unpinned, 18 pinned.
//
// Launch skeleton follows cdp_hub.mjs VERBATIM (candidates Chrome/Edge/Brave, free-port scan,
// fresh temp --user-data-dir, wait for the file:// target itself, 1440x900 metrics override,
// autoplay allowed, ONE browser, explicit exit, process.on('exit') kills ONLY processes whose
// command line carries OUR temp profile's unique tag). Every fixture is synthesized IN-PAGE
// (a .scl File via DataTransfer + a hand-built MTS byte array) - no disk files.
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

/* freeze pin: the parent sets this to the frozen sha at the T-wave freeze (64-hex); null at
   authoring. A valid --sha <hex> becomes the run-time expectation while the constant is null,
   and echoes/overrides the constant once pinned (cdp_hub semantics, verbatim). The rig never
   loosens the before === after check. */
const EXPECT_SHA = '183d1588b3c694e72abc95f3542a788139f6de980369c2c40c99021dff197f25';
const PIN = (shaArg > -1 && argv[shaArg + 1] && /^[0-9a-f]{64}$/i.test(argv[shaArg + 1])) ? argv[shaArg + 1].toLowerCase() : EXPECT_SHA;
const shaOf = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const shaBefore = shaOf(page);
console.log('index.html sha256 (before): ' + shaBefore + (PIN ? '' : '   (EXPECT_SHA not pinned yet - pass --sha <hex> or set the constant)'));

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
    const ok = await new Promise(res => { const srv = net.createServer(); srv.once('error', () => res(false)); srv.once('listening', () => srv.close(() => res(true))); srv.listen(p, '127.0.0.1'); });
    if (ok) return p;
  }
  return start;
}
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9620);
const profile = path.join(tmpdir(), 'anvil-tune-' + Date.now());
const baseUrl = 'file:///' + path.resolve(page).replace(/\\/g, '/');
const url = baseUrl + '?avtest=1';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
console.log('cdp port ' + PORT + ' - profile ' + profile);
console.log('fixtures: synthesized in-page (.scl File via DataTransfer + the hand-built 21-byte MTS scale/octave frame; the pitch expectation is recomputed in the rig from the cents fixture)');

let pass = 0, fail = 0;
const check = (name, ok, info) => {
  if (ok) { pass++; console.log(' ok   ' + name + (info ? '  -> ' + info : '')); }
  else { fail++; console.log(' FAIL ' + name + (info ? '  -> ' + info : '')); }
};
const note = (t) => console.log('   . ' + t);
const r2 = (v) => (typeof v === 'number' && isFinite(v)) ? Math.round(v * 100) / 100 : v;

const chrome = spawn(exe, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--disable-sync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
  url,
], { stdio: 'ignore', windowsHide: true });

const errors = [];
const shotPath = path.join(here, '..', 'renders', 'tune-suite.png');

/* ---- the just-major cents fixture (contract section 7); the rig recomputes the expected tuned
   fundamental INDEPENDENTLY from these values -- the module's own table is never trusted ---- */
const JUST_MAJOR_CENTS = [0, 111.73, 203.91, 315.64, 386.31, 498.04, 590.22, 701.96, 813.69, 884.36, 1017.60, 1088.27];
const TUNE_NOTE = 64;                                        /* e4 = root c4 (60) + 4 semitones */
const OFFSET_ST = (JUST_MAJOR_CENTS[4] - 400) / 100;         /* (386.31 - 400)/100 = -0.1369 st */
const EXP_TUNED_HZ = 440 * Math.pow(2, (TUNE_NOTE + OFFSET_ST - 69) / 12);   /* ~327.03 Hz */
const EXP_EQUAL_HZ = 440 * Math.pow(2, (TUNE_NOTE - 69) / 12);               /* 329.6276 Hz */
const PEAK_TOL_HZ = 3;                                       /* contract: within +-3 Hz */
const SCL_TEXT = '! rig fixture scale\nRig Scale\n7\n0.0\n203.91\n386.31\n498.04\n701.96\n884.36\n1200.0\n';
/* MTS scale/octave 1-byte frame (21 bytes = the module's documented 0x08 layout):
   F0 7F <dev> 08 08 then the 3 channel bytes (0x7F 0x7F 0x03 = all 16 channels, bit 0 =
   channel 1) then the 12 pitch-class bytes then F7. Byte value 64 = 0 cents, step 100/64 c:
   pitch-class index 4 = byte 55 -> -14.0625 c; index 7 = byte 73 -> +14.0625 c. */
const MTS_BYTES = [240, 127, 0, 8, 8, 127, 127, 3, 64, 64, 64, 64, 55, 64, 64, 73, 64, 64, 64, 64, 247];
const MTS_BAD = [240, 127, 0, 8, 127, 247];
/* the edo19 default-mapping offset for key 64 (degree 4, root 60): (4*1200/19 - 400)/100
   = -1.4737 st; the global 12edo slot reads exactly 0. Recorded in the T9 evidence. */
const EDO19_OFF64 = ((4 * 1200 / 19) - 400) / 100;
/* the T9 fixture: a minimal one-note pattern (track 0, step 0 on, note e4 = midi 64, everything
   else off) in the exact step shape cdp_seq.mjs's H.pattern() builds (proven importable) */
const t9step = (o) => Object.assign({ on: 0, note: 'c2', vel: 0.85, gate: 0.5, slide: 0, accent: 0, oct: 0, prob: 100, cond: '', ratchet: 1, micro: 0 }, o || {});
const PAT9 = (() => {
  const mkTrack9 = (note9) => {
    const steps = [];
    for (let i = 0; i < 64; i++) steps.push((i === 0 && note9) ? t9step({ on: 1, note: note9 }) : t9step({ on: 0 }));
    return { len: 16, speed: 1, mute: 0, steps: steps };
  };
  return { v: 1, name: 'RIG TUNE T9', bpm: 120, grid: '16', swing: 50, rng: 305419896,
           tracks: [mkTrack9('e4'), mkTrack9(null), mkTrack9(null), mkTrack9(null)], plocks: [] };
})();

/* ============================================================================================
   IN-PAGE RUNTIME (installed once): the 4-term Blackman-Harris window + the radix-2 FFT copied
   from cdp_alias.mjs (the P1.x amended window), plus the fundamental-peak finder (log-magnitude
   parabolic refinement, the cdp_m2 peak method). All analysis happens in the page; the Node rig
   only drives and asserts.
   ============================================================================================ */
function tunePageRuntime() {
  const N = 32768;                      /* the witness analyser fftSize (the max chromium allows) */
  const WIN_BH = new Float64Array(N);   /* 4-term Blackman-Harris, symmetric N-1 denominator
                                           (copied from cdp_alias.mjs: a = [0.35875, 0.48829,
                                           0.14128, 0.01168]; sidelobes ~ -92 dB) */
  for (let i = 0; i < N; i++) {
    const d = N - 1, c1 = Math.cos(2 * Math.PI * i / d), c2 = Math.cos(4 * Math.PI * i / d), c3 = Math.cos(6 * Math.PI * i / d);
    WIN_BH[i] = 0.35875 - 0.48829 * c1 + 0.14128 * c2 - 0.01168 * c3;
  }
  /* in-place iterative radix-2 DIT FFT (copied from cdp_alias.mjs) */
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cwr = 1, cwi = 0;
        for (let j2 = 0; j2 < len / 2; j2++) {
          const ur = re[i + j2], ui = im[i + j2];
          const vr = re[i + j2 + len / 2] * cwr - im[i + j2 + len / 2] * cwi;
          const vi = re[i + j2 + len / 2] * cwi + im[i + j2 + len / 2] * cwr;
          re[i + j2] = ur + vr; im[i + j2] = ui + vi;
          re[i + j2 + len / 2] = ur - vr; im[i + j2 + len / 2] = ui - vi;
          const nwr = cwr * wr - cwi * wi; cwi = cwr * wi + cwi * wr; cwr = nwr;
        }
      }
    }
  }
  function sigStats(x) {
    let sum = 0, pk = 0;
    for (let i = 0; i < x.length; i++) { const v = x[i]; sum += v * v; const a = v < 0 ? -v : v; if (a > pk) pk = a; }
    return { rms: Math.sqrt(sum / x.length), peak: pk };
  }
  /* the fundamental peak: BH4-windowed FFT of the captured time-domain segment, argmax over
     [loHz, hiHz], log-magnitude parabolic refinement */
  function peakOf(seg, sr, loHz, hiHz) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = (seg[i] || 0) * WIN_BH[i];
    fft(re, im);
    const half = N >> 1, df = sr / N;
    const mag = new Float64Array(half);
    for (let k = 0; k < half; k++) { const a = re[k], b = im[k]; mag[k] = Math.sqrt(a * a + b * b); }
    const lo = Math.max(1, Math.floor(loHz / df)), hi = Math.min(half - 1, Math.ceil(hiHz / df));
    let bi = lo, bv = -1;
    for (let k = lo; k <= hi; k++) { if (mag[k] > bv) { bv = mag[k]; bi = k; } }
    let hz = bi * df, interp = null;
    if (bi > 0 && bi < half - 1 && bv > 0) {
      const db = function (v) { return (v > 0) ? 20 * Math.log10(v) : -999; };
      const a = db(mag[bi - 1]), b = db(mag[bi]), c = db(mag[bi + 1]);
      const den = 2 * (a - 2 * b + c);
      const d = (den !== 0) ? (a - c) / den : 0;
      if (isFinite(d) && Math.abs(d) < 1) { hz = (bi + d) * df; interp = d; }
    }
    return { hz: hz, db: (bv > 0) ? 20 * Math.log10(bv) : null, bin: bi, df: df, interp: interp };
  }
  return { N: N, fft: fft, sigStats: sigStats, peakOf: peakOf };
}

/* the witness API: the rig's OWN AnalyserNode on the master tap (avMasterFor -- panel reads are
   never witnesses). arm() once the live engine is up; read(lo, hi) captures the last 32768
   frames and FFTs them. */
function tuneWitnessInstall() {
  const API = { v: 1, W: null };
  API.arm = function () {
    try {
      API.stop();
      const h = window.__avEngine;
      if (!h || h.ready !== true || !h.handle || !h.handle.ctx) return { ok: false, why: 'engine not ready' };
      const ctx = h.handle.ctx;
      try { const p = ctx.resume(); if (p && p.catch) p.catch(function () { }); } catch (e) { /* already running */ }
      const master = (typeof avMasterFor === 'function') ? avMasterFor(ctx) : null;
      if (!master) return { ok: false, why: 'no master tap node for the live ctx' };
      const an = ctx.createAnalyser();
      an.fftSize = 32768;
      an.smoothingTimeConstant = 0;
      master.connect(an);
      API.W = { an: an, ctx: ctx, sr: ctx.sampleRate, td: new Float32Array(an.fftSize) };
      return { ok: true, sr: ctx.sampleRate, fft: an.fftSize, tier: h.tier };
    } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
  };
  API.read = function (loHz, hiHz) {
    try {
      const W = API.W;
      if (!W) return { ok: false, why: 'witness not armed' };
      W.an.getFloatTimeDomainData(W.td);
      const ss = window.__tuneRig.sigStats(W.td);
      const pk = window.__tuneRig.peakOf(W.td, W.sr, loHz, hiHz);
      return { ok: true, hz: pk.hz, db: pk.db, rms: ss.rms, peakAmp: ss.peak, bin: pk.bin, df: pk.df, interp: pk.interp };
    } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
  };
  /* light flow gate (no FFT): the rms/peak of the CURRENT capture window */
  API.rms = function () {
    try {
      const W = API.W;
      if (!W) return { ok: false, why: 'witness not armed' };
      W.an.getFloatTimeDomainData(W.td);
      const ss = window.__tuneRig.sigStats(W.td);
      return { ok: true, rms: ss.rms, peakAmp: ss.peak };
    } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
  };
  API.stop = function () { try { if (API.W) API.W.an.disconnect(); } catch (e) { /* gone */ } API.W = null; return true; };
  window.__tuneWit = API;
  return { ok: true };
}

async function main() {
  /* a fresh Edge profile opens edge://sync-confirmation-dialog/ and edge://newtab/
     BEFORE our page; wait for the file:// page target itself (PF smoke law) */
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
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('DOM.enable');
  if (!String(target.url).startsWith('file://')) await send('Page.navigate', { url });
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
  const waitFor = async (expr, ms = 30000, step = 250) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const r = await ev(expr);
      if (r.value) return r.value;
      await sleep(step);
    }
    return null;
  };
  const waitReady = async () => { for (let i = 0; i < 120; i++) { const r = await ev(`!!(document.documentElement && document.documentElement.getAttribute('data-av-ready') === '1')`); if (r.value === true) return true; await sleep(300); } return false; };
  /* real input dispatch (the cdp_seq.mjs start flow): the T9 transport starts with a real PLAY click */
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const clickSel = async (sel, after = 300) => {
    const found = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; if (e.scrollIntoView) e.scrollIntoView({ block: 'center', inline: 'center' }); return true; })()`);
    if (found.value !== true) { note('click target missing: ' + sel); return false; }
    await sleep(200);
    const boxR = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width || !r.height) return null; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const b = boxR.value;
    if (!b) { note('click target not visible: ' + sel); return false; }
    await mouse('mousePressed', b.x, b.y);
    await sleep(30);
    await mouse('mouseReleased', b.x, b.y);
    await sleep(after);
    return true;
  };

  /* ---- T1. boot: the card mounted into its host (children > 0), in the synth zone ---- */
  const ready = await waitReady();
  const t1R = (await ev(`(() => {
    const card = document.getElementById('av-tune');
    const host = document.getElementById('av-tune-host');
    const zone = (card && card.closest) ? card.closest('.av-zone') : null;
    return { card: !!card, host: !!host, children: host ? host.children.length : -1,
             zone: zone ? zone.getAttribute('data-zone') : null,
             ready: document.documentElement.getAttribute('data-av-ready') === '1' };
  })()`)).value || {};
  check('T1 boot: #av-tune card mounted into #av-tune-host (host children > 0) in the synth zone',
    ready === true && t1R.ready === true && t1R.card === true && t1R.host === true && t1R.children > 0 && t1R.zone === 'synth',
    JSON.stringify(t1R));

  /* ---- T2. boot: the pinned ids + the UI facade + zero page errors at boot ---- */
  const t2R = (await ev(`(() => {
    const id = function (x) { return !!document.getElementById(x); };
    return { scale: id('av-tune-scale'), root: id('av-tune-root'), morph: id('av-tune-morph'),
             track0: id('av-tune-track-0'), track1: id('av-tune-track-1'), track2: id('av-tune-track-2'), track3: id('av-tune-track-3'),
             imp: id('av-tune-import'), impFile: id('av-tune-import-file'), exp: id('av-tune-export'),
             lib: id('av-tune-lib'), mts: id('av-tune-mts'), status: id('av-tune-status'), mtsStatus: id('av-tune-mts-status'),
             init: typeof avTuneUiInit, classes: typeof avTuneUiClasses, ui: typeof window.__avTuneUi };
  })()`)).value || {};
  check('T2 boot: pinned TUNE ids (scale/root/morph/track-0..3/import/import-file/export/lib/mts/status/mts-status) + UI facade live + zero page errors at boot',
    t2R.scale === true && t2R.root === true && t2R.morph === true
    && t2R.track0 === true && t2R.track1 === true && t2R.track2 === true && t2R.track3 === true
    && t2R.imp === true && t2R.impFile === true && t2R.exp === true && t2R.lib === true
    && t2R.mts === true && t2R.status === true && t2R.mtsStatus === true
    && t2R.init === 'function' && t2R.classes === 'function' && t2R.ui === 'object'
    && errors.length === 0,
    JSON.stringify({ ids: t2R, errors: errors.slice(0, 3) }));

  /* ---- T3. facade: __avTune present - builtinIds length 12 - builtins resolve with the
     module's documented cents shape (av_tune.js: just-major = 12 pitch classes PLUS the closing
     2/1 formal octave -> 13 values, first 0, last 1200; 12edo -> 12 values, last 1200) ---- */
  const t3R = (await ev(`(() => {
    try {
      const T = window.__avTune || {};
      const ids = (typeof T.builtinIds === 'function') ? T.builtinIds() : null;
      const b12 = (typeof T.builtin === 'function') ? T.builtin('12edo') : null;
      const bjm = (typeof T.builtin === 'function') ? T.builtin('just-major') : null;
      const shapeOf = function (b) {
        if (!b || !Array.isArray(b.cents)) return null;
        const c = b.cents;
        let asc = true;
        for (let i = 1; i < c.length; i++) { if (!(c[i] + 1e-9 >= c[i - 1])) asc = false; }
        return { n: c.length, first: c[0], last: c[c.length - 1], asc: asc };
      };
      const libOk = (T.library && typeof T.library === 'object')
        ? ['save', 'list', 'load', 'delete'].filter(function (k) { return typeof T.library[k] === 'function'; }).length : -1;
      return { present: !!window.__avTune, version: String(T.version == null ? '' : T.version),
               idsN: Array.isArray(ids) ? ids.length : -1, ids: Array.isArray(ids) ? ids.slice(0, 16) : null,
               b12: b12 ? { id: String(b12.id == null ? '' : b12.id), shape: shapeOf(b12) } : null,
               bjm: bjm ? { id: String(bjm.id == null ? '' : bjm.id), name: String(bjm.name == null ? '' : bjm.name),
                           shape: shapeOf(bjm),
                           cents: Array.isArray(bjm.cents) ? bjm.cents.slice(0, 4) : null } : null,
               fns: ['parseScl', 'parseKbm', 'buildTable', 'morph', 'mtsParse', 'exportScl'].filter(function (k) { return typeof T[k] === 'function'; }).length,
               libFn: libOk };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)).value || {};
  check('T3 facade: __avTune present (version + key set) - builtinIds length 12 - builtin 12edo/just-major resolve (just-major: 13 cents values = 12 pitch classes + the closing 2/1 octave, first 0, last 1200, ascending; 12edo: 12 values, last 1200)',
    t3R.present === true && t3R.version.length > 0 && t3R.idsN === 12
    && !!t3R.b12 && !!t3R.b12.shape && t3R.b12.shape.n === 12 && Math.abs(t3R.b12.shape.last - 1200) <= 0.001 && t3R.b12.shape.asc === true
    && !!t3R.bjm && !!t3R.bjm.shape && t3R.bjm.shape.n === 13 && Math.abs(t3R.bjm.shape.first) <= 1e-6
    && Math.abs(t3R.bjm.shape.last - 1200) <= 0.001 && t3R.bjm.shape.asc === true
    && t3R.fns === 6 && t3R.libFn === 4,
    JSON.stringify({ facade: t3R, fixtureJustMajorDeg4: JUST_MAJOR_CENTS[4] }));

  /* engine readiness (the tune uploads + the witness need the live tier) */
  let engReady = false;
  for (let i = 0; i < 150 && !engReady; i++) {
    const r = await ev(`!!(window.__avEngine && window.__avEngine.ready === true)`);
    if (r.value === true) { engReady = true; break; }
    await sleep(200);
  }
  note('engine ready: ' + engReady + ' - tier ' + String((await ev('window.__avEngine ? String(window.__avEngine.tier) : ""')).value || ''));

  /* the clean VA patch + fx muted via avApplyParam BEFORE any measurement (contract section 10:
     the spectrum rig must never assert on the tap's raw noise floor); the rig never touches
     engine internals. */
  const patchR = await ev(`(() => {
    try {
      if (typeof avApplyParam !== 'function') return { ok: false, why: 'avApplyParam absent' };
      const clean = [['engine.kind', 'va'], ['master', 0.8], ['osc1.type', 'saw'], ['osc1.level', 1],
        ['osc2.level', 0], ['sub.level', 0], ['filter.mode', 'lp12'], ['filter.cutoff', 20000],
        ['filter.reso', 0], ['filter.envAmt', 0], ['env1.a', 0.001], ['env1.d', 0.3], ['env1.s', 1],
        ['env1.r', 0.2], ['lfo.toCut', 0], ['lfo.toPitch', 0], ['voice.glide', 0]];
      const cleanR = [];
      for (let i = 0; i < clean.length; i++) {
        let a = false;
        try { a = avApplyParam(clean[i][0], clean[i][1]) === true; } catch (e) { a = false; }
        cleanR.push([clean[i][0], a]);
      }
      const MODS = ['fx.drive', 'fx.aw', 'fx.mod', 'fx.delay', 'fx.verb', 'fx.conv', 'fx.dyn'];
      const fx = [];
      for (let i = 0; i < MODS.length; i++) {
        let on = false, mix = false, mirror = null;
        try { on = avApplyParam(MODS[i] + '.on', 0) === true; } catch (e) { on = false; }
        try { mix = avApplyParam(MODS[i] + '.mix', 0) === true; } catch (e) { mix = false; }
        try { mirror = (typeof avParams !== 'undefined') ? avParams[MODS[i] + '.on'] : undefined; } catch (e) { mirror = 'threw'; }
        fx.push({ mod: MODS[i], on: on, mix: mix, mirror: mirror });
      }
      const core = ['fx.drive', 'fx.mod', 'fx.delay', 'fx.verb', 'fx.dyn'];
      let coreOff = true;
      for (let i = 0; i < core.length; i++) {
        let m;
        try { m = (typeof avParams !== 'undefined') ? avParams[core[i] + '.on'] : undefined; } catch (e) { m = 'threw'; }
        if (m !== 0) coreOff = false;
      }
      const bad = cleanR.filter(function (r) { return r[1] !== true; }).map(function (r) { return r[0]; });
      return { ok: true, clean: cleanR, cleanBad: bad, fx: fx, coreOff: coreOff };
    } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
  })()`);
  const patchFacts = patchR.value || {};
  const cleanWanted = ['engine.kind', 'osc1.level', 'osc2.level', 'filter.cutoff', 'env1.s'];
  const cleanPatchOk = !!(patchFacts.ok === true && Array.isArray(patchFacts.clean)
    && cleanWanted.every(function (k) { return patchFacts.clean.some(function (r) { return r[0] === k && r[1] === true; }); }));
  note('clean VA patch: ok=' + cleanPatchOk + ' - fx core off=' + patchFacts.coreOff + ' - bad=' + JSON.stringify(patchFacts.cleanBad || null));

  /* ---- T4. select: just-major + root c4 + morph 100 -> the LS pref mirrors it ---- */
  const sel4 = (await ev(`(() => {
    try {
      const sg = document.getElementById('av-tune-scale');
      const rt = document.getElementById('av-tune-root');
      const mr = document.getElementById('av-tune-morph');
      if (!sg || !rt || !mr) return { missing: true, sg: !!sg, rt: !!rt, mr: !!mr };
      sg.value = 'just-major';
      sg.dispatchEvent(new Event('change', { bubbles: true }));
      let rootVia = null;
      const opt60 = Array.prototype.filter.call(rt.options, function (o) { return String(o.value) === '60'; })[0];
      if (opt60) { rt.value = '60'; rootVia = 'value-60'; }
      else {
        const optc4 = Array.prototype.filter.call(rt.options, function (o) { return String(o.textContent || '').trim().toLowerCase() === 'c4'; })[0];
        if (optc4) { rt.value = optc4.value; rootVia = 'text-c4'; }
        else rootVia = 'none-kept-' + String(rt.value);
      }
      rt.dispatchEvent(new Event('change', { bubbles: true }));
      mr.value = '100';
      mr.dispatchEvent(new Event('input', { bubbles: true }));
      mr.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, sel: String(sg.value), rootVia: rootVia, root: String(rt.value), morph: String(mr.value), scaleOpts: sg.options ? sg.options.length : -1 };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)).value || {};
  const pref4 = await waitFor(`(() => {
    try {
      const p = JSON.parse(localStorage.getItem('av-tune-pref') || 'null');
      if (!p) return null;
      return { v: p.v, sel: String(p.sel == null ? '' : p.sel), root: p.root, morph: p.morph,
               tracks: Array.isArray(p.tracks) ? p.tracks.slice() : null, mts: p.mts };
    } catch (e) { return null; }
  })()`, 15000);
  check('T4 select: just-major + root c4 + morph 100 accepted and mirrored in av-tune-pref (v1)',
    !!sel4 && sel4.ok === true && !!pref4
    && pref4.v === 1 && pref4.sel === 'just-major' && Number(pref4.root) === 60 && Number(pref4.morph) === 100,
    JSON.stringify({ drive: sel4, pref: pref4 }));

  /* ---- T5. select: the engine stats carry the global slot ---- */
  const st5 = await waitFor(`(async () => {
    try {
      const E = window.__avEngine;
      if (!E || E.ready !== true || typeof E.stats !== 'function') return null;
      const s = await E.stats();
      const t = s && s.tune ? s.tune : null;
      if (!t || typeof t.active !== 'number' || !Array.isArray(t.slots)) return null;
      if (!(t.active >= 0 && t.active <= 6)) return null;         /* 7 = the reserved MTS live slot */
      const nm = t.slots[t.active];
      if (!(typeof nm === 'string' && /just-major/i.test(nm))) return null;
      return { active: t.active, name: nm, slots: t.slots.map(function (x) { return x == null ? null : String(x); }) };
    } catch (e) { return null; }
  })()`, 30000);
  const justSlot = st5 ? st5.active : -1;
  check('T5 select: engine stats carry the global slot (tune.active 0..6 with slots[active] just-major)',
    !!st5 && typeof st5.active === 'number' && /just-major/i.test(String(st5.name)), JSON.stringify(st5));

  /* install the in-page runtime + arm the witness (own AnalyserNode on the master tap) */
  const inst = await ev('window.__tuneRig = (' + String(tunePageRuntime) + ')(); (' + String(tuneWitnessInstall) + ')(); true');
  if (!inst.value) note('page runtime install failed: ' + (inst.error || 'no value'));
  const armR = await ev(`(() => {
    try {
      if (!window.__tuneWit || typeof window.__tuneWit.arm !== 'function') return { ok: false, why: 'witness api missing' };
      return window.__tuneWit.arm();
    } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
  })()`);
  const armed = !!(armR.value && armR.value.ok === true);
  note('spectrum witness arm: ' + JSON.stringify(armR.value || armR.error));

  /* play ONE e4 through the real note path (avNoteDown); POLL the witness until the audio actually
     flows (rms > 0.001, ~100 ms steps, 3 s deadline - the first read used to race the audio path),
     then FFT the settled window. A timeout keeps the raw read as the honest failure evidence. */
  const measureE4 = async () => {
    /* full-capture retry: the first touch after boot can race the audio path (a dry capture);
       up to 3 attempts, each = fire -> poll flow (rms>0.001, 3 s) -> settle -> re-check -> FFT. */
    let last = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      let dn = (await ev(`(() => { const ok = avNoteDown('e4', 1.0); return { ok: ok === true }; })()`)).value;
      if (!dn || dn.ok !== true) {
        await ev(`(() => { try { avNoteUp('e4'); } catch (e) { /* retry path */ } return true; })()`);
        await sleep(220);
        dn = (await ev(`(() => { const ok = avNoteDown('e4', 1.0); return { ok: ok === true, retry: true }; })()`)).value;
      }
      if (!dn || dn.ok !== true) return { err: 'note-down refused', dn: dn };
      let flow = null, rmsLast = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 3000) {
        rmsLast = (await ev('window.__tuneWit && typeof window.__tuneWit.rms === "function" ? window.__tuneWit.rms() : null')).value || null;
        if (rmsLast && rmsLast.ok === true && typeof rmsLast.rms === 'number' && rmsLast.rms > 0.001) { flow = rmsLast; break; }
        await sleep(100);
      }
      const flowMs = flow ? (Date.now() - t0) : null;
      if (flow) {
        await sleep(250);                                  /* a short settle inside the steady sustain */
        const settle = (await ev('window.__tuneWit && typeof window.__tuneWit.rms === "function" ? window.__tuneWit.rms() : null')).value || null;
        if (settle && settle.ok === true && typeof settle.rms === 'number' && settle.rms > 0.001) {
          const read = (await ev('window.__tuneWit ? window.__tuneWit.read(80, 1200) : null')).value;
          const up = (await ev(`(() => { const ok = avNoteUp('e4'); return { ok: ok === true }; })()`)).value;
          await sleep(240);
          return { dn: dn, read: read, up: up, flowMs: flowMs, rmsFlow: flow.rms, peakFlow: flow.peakAmp, attempts: attempt };
        }
        last = { flowMs: flowMs, rmsSettle: settle, rmsFlow: flow.rms };
      } else {
        last = { flowMs: null, rmsPoll: rmsLast };
      }
      await ev(`(() => { try { avNoteUp('e4'); } catch (e) { /* attempt reset */ } return true; })()`);
      await sleep(320);                                    /* let the tail drain before the next touch */
    }
    const raw = (await ev('window.__tuneWit ? window.__tuneWit.read(80, 1200) : null')).value;
    return { dn: { ok: true }, read: raw, up: { ok: true }, flowMs: null, attempts: 3, last: last, err: 'no audio reached the witness across 3 attempts - the raw read is kept' };
  };

  /* ---- T6. spectrum witness: just-major e4 (expected recomputed from the fixture) ---- */
  const m6 = armed ? await measureE4() : { err: 'witness not armed' };
  const r6 = (m6 && m6.read) || null;
  check('T6 spectrum witness: just-major e4 fundamental within +-3 Hz of the rig-recomputed ' + r2(EXP_TUNED_HZ) + ' Hz (BH4 FFT, own analyser on the master tap, fx off)',
    armed === true && cleanPatchOk === true && patchFacts.coreOff === true
    && !!r6 && r6.ok === true && typeof r6.hz === 'number' && Math.abs(r6.hz - EXP_TUNED_HZ) <= PEAK_TOL_HZ
    && r6.rms > 0.001,
    JSON.stringify({ expTuned: r2(EXP_TUNED_HZ), expEqual: r2(EXP_EQUAL_HZ), offsetSt: OFFSET_ST,
      read: r6, note: m6 && m6.dn, up: m6 && m6.up, pollMs: m6 ? m6.flowMs : null, flowErr: m6 ? m6.err : null,
      fx: patchFacts.fx, cleanBad: patchFacts.cleanBad }));

  /* ---- T7. spectrum witness (12-EDO control through the same helper) ---- */
  const sel7 = (await ev(`(() => {
    const s = document.getElementById('av-tune-scale');
    if (!s) return { missing: true };
    s.value = '12edo';
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, v: String(s.value) };
  })()`)).value || {};
  const swap7 = await waitFor(`(async () => {
    try {
      const E = window.__avEngine;
      if (!E || E.ready !== true || typeof E.stats !== 'function') return null;
      const s = await E.stats();
      const t = s && s.tune ? s.tune : null;
      if (!t || !Array.isArray(t.slots) || typeof t.active !== 'number') return null;
      if (t.active === ${justSlot}) return null;      /* the active slot must move off just-major */
      const nm = t.slots[t.active];
      return { active: t.active, name: nm == null ? null : String(nm) };
    } catch (e) { return null; }
  })()`, 25000);
  const m7 = armed ? await measureE4() : { err: 'witness not armed' };
  const r7 = (m7 && m7.read) || null;
  check('T7 spectrum witness (12edo control): the same helper reads ' + r2(EXP_EQUAL_HZ) + ' Hz (+-3)',
    armed === true && !!sel7 && sel7.ok === true && !!swap7
    && !!r7 && r7.ok === true && typeof r7.hz === 'number' && Math.abs(r7.hz - EXP_EQUAL_HZ) <= PEAK_TOL_HZ
    && r7.rms > 0.001,
    JSON.stringify({ expEqual: r2(EXP_EQUAL_HZ), swap: swap7, read: r7, note: m7 && m7.dn, pollMs: m7 ? m7.flowMs : null }));

  /* ---- T8. morph: morph 0 -> back to 12-EDO + the tuned<->morph delta ---- */
  const sel8 = (await ev(`(() => {
    const sg = document.getElementById('av-tune-scale');
    const mr = document.getElementById('av-tune-morph');
    if (!sg || !mr) return { missing: true, sg: !!sg, mr: !!mr };
    sg.value = 'just-major';
    sg.dispatchEvent(new Event('change', { bubbles: true }));
    mr.value = '0';
    mr.dispatchEvent(new Event('input', { bubbles: true }));
    mr.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, sel: String(sg.value), morph: String(mr.value) };
  })()`)).value || {};
  const pref8 = await waitFor(`(() => {
    try {
      const p = JSON.parse(localStorage.getItem('av-tune-pref') || 'null');
      return (p && String(p.sel) === 'just-major' && Number(p.morph) === 0) ? { sel: String(p.sel), morph: p.morph } : null;
    } catch (e) { return null; }
  })()`, 12000);
  await sleep(350);
  const m8 = armed ? await measureE4() : { err: 'witness not armed' };
  const r8 = (m8 && m8.read) || null;
  const morphDelta = (r8 && typeof r8.hz === 'number' && r6 && typeof r6.hz === 'number') ? (r8.hz - r6.hz) : null;
  check('T8 morph delta: morph 0 returns the peak to 12-EDO (' + r2(EXP_EQUAL_HZ) + ' Hz) and the tuned<->morph delta is witnessed',
    armed === true && !!sel8 && sel8.ok === true && !!pref8
    && !!r8 && r8.ok === true && typeof r8.hz === 'number' && Math.abs(r8.hz - EXP_EQUAL_HZ) <= PEAK_TOL_HZ
    && morphDelta !== null && morphDelta >= 1.0,
    JSON.stringify({ expEqual: r2(EXP_EQUAL_HZ), read: r8, tunedHz: r6 ? r2(r6.hz) : null, deltaHz: r2(morphDelta), pollMs: m8 ? m8.flowMs : null }));
  /* restore morph 100 for the legs below (the pref wait is sequencing, not an assertion) */
  await ev(`(() => {
    const mr = document.getElementById('av-tune-morph');
    if (!mr) return { missing: true };
    mr.value = '100';
    mr.dispatchEvent(new Event('input', { bubbles: true }));
    mr.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  })()`);
  await waitFor(`(() => {
    try { const p = JSON.parse(localStorage.getItem('av-tune-pref') || 'null'); return (p && Number(p.morph) === 100) ? true : null; } catch (e) { return null; }
  })()`, 10000);

  /* ---- T9. track slot: global 12edo + #av-tune-track-0 = edo19; a minimal one-note pattern on
     track 0 (e4 = midi 64) loaded through the pinned import path + a real PLAY click runs the
     SCHED -> stats().tune.last proves the note carried the track slot (avSeqSchedEmit consults
     avTuneTrackSlot(ev.track)); stopped + restored. ---- */
  const sel9 = (await ev(`(() => {
    const sg = document.getElementById('av-tune-scale');
    const tr = document.getElementById('av-tune-track-0');
    if (!sg || !tr) return { missing: true, sg: !!sg, tr: !!tr };
    sg.value = '12edo';
    sg.dispatchEvent(new Event('change', { bubbles: true }));
    tr.value = 'edo19';
    tr.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, sel: String(sg.value), track: String(tr.value), trackOpts: tr.options ? tr.options.length : -1 };
  })()`)).value || {};
  const trk9 = await waitFor(`(async () => {
    try {
      const E = window.__avEngine;
      if (!E || E.ready !== true || typeof E.stats !== 'function') return null;
      const s = await E.stats();
      const t = s && s.tune ? s.tune : null;
      if (!t || !Array.isArray(t.slots) || typeof t.active !== 'number') return null;
      let edoS = -1;
      for (let i = 0; i < t.slots.length; i++) { if (t.slots[i] && /edo19/i.test(String(t.slots[i]))) { edoS = i; break; } }
      if (edoS < 0 || t.active === edoS) return null;
      const ts = (typeof avTuneTrackSlot === 'function') ? avTuneTrackSlot(0) : null;
      if (ts !== edoS) return null;                      /* the sched's own lookup must see the slot */
      return { active: t.active, activeName: t.slots[t.active] == null ? null : String(t.slots[t.active]),
               edoS: edoS, trackSlot: ts, slots: t.slots.map(function (x) { return x == null ? null : String(x); }) };
    } catch (e) { return null; }
  })()`, 25000);
  const slotProbe9 = (await ev(`(async () => {
    try {
      const E = window.__avEngine;
      const t = (E && E.ready === true && typeof E.stats === 'function') ? (await E.stats()).tune : null;
      const ts = (typeof avTuneTrackSlot === 'function') ? avTuneTrackSlot(0) : 'no-fn';
      return { trackSlot0: (ts === undefined ? 'undefined' : ts),
               active: t ? t.active : null, slots: t ? t.slots : null };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)).value || null;
  /* the fixture: a minimal one-note pattern (track 0, step 0 on, note e4 = midi 64; every other
     step/track off) loaded through the pinned cdp_seq.mjs flow: avSeqPatternImport ->
     avSeqSetPattern(avSeqSnap()) -> bpm. Then a real PLAY click (retry once; the pinned API as
     the documented fallback) starts the transport. */
  const load9 = (await ev(`(() => {
    try {
      const P = ${JSON.stringify(PAT9)};
      let ok = false, why = '';
      try { if (typeof avSeqPatternImport === 'function') { ok = avSeqPatternImport(JSON.stringify(P)) === true; why = ok ? 'import' : 'import-refused'; } } catch (e) { ok = false; why = 'import-threw'; }
      if (!ok && typeof avSeqLoad === 'function') { ok = avSeqLoad(P) === true; why = ok ? 'load' : 'load-refused'; }
      let pushed = false;
      if (ok) {
        try { pushed = !!(typeof avSeqSetPattern === 'function' && typeof avSeqSnap === 'function' && avSeqSetPattern(avSeqSnap()) === true); } catch (e) { pushed = false; }
        try { if (typeof avApplyParam === 'function') avApplyParam('bpm', 120); } catch (e) { /* bpm rode the pattern */ }
      }
      return { ok: ok, why: why, pushed: pushed };
    } catch (e) { return { ok: false, why: 'threw: ' + ((e && e.message) || e) }; }
  })()`)).value || {};
  const isPlaying9 = async () => (await ev(`(() => { try { return typeof avSeqIsPlaying === 'function' ? avSeqIsPlaying() === true : false; } catch (e) { return false; } })()`)).value === true;
  const clickPlay9 = async () => {
    await clickSel('#av-seq-host #av-seq-play', 300);
    for (let i = 0; i < 30; i++) { if (await isPlaying9()) return true; await sleep(100); }
    return false;
  };
  let played9 = await clickPlay9();
  if (!played9) played9 = await clickPlay9();          /* one retry of the real click */
  let startVia = played9 ? 'click' : null;
  if (!played9) {
    const apiR = (await ev(`(() => { try { return typeof avSeqPlay === 'function' ? avSeqPlay() === true : false; } catch (e) { return false; } })()`)).value === true;
    if (apiR) { startVia = 'api-fallback'; for (let i = 0; i < 20 && !(await isPlaying9()); i++) await sleep(100); }
    else startVia = 'not-playing';
  }
  note('T9 transport: startVia=' + startVia + ' playing=' + (await isPlaying9()) + ' load=' + JSON.stringify(load9));
  /* deadline + retry: the SCHED must emit the pattern note carrying the track slot */
  const last9 = await waitFor(`(async () => {
    try {
      const E = window.__avEngine;
      if (!E || E.ready !== true || typeof E.stats !== 'function') return null;
      const s = await E.stats();
      const t = s && s.tune ? s.tune : null;
      if (!t || !t.last) return null;
      if (t.last.midi !== 64) return null;
      const nm = (Array.isArray(t.slots) && t.last.slot >= 0) ? t.slots[t.last.slot] : null;
      if (!(nm && /edo19/i.test(String(nm)))) return null;
      return { midi: t.last.midi, slot: t.last.slot, off: t.last.off, name: String(nm), active: t.active };
    } catch (e) { return null; }
  })()`, 15000);
  /* stop the transport (avSeqStop releases every held sched note); the pattern stays loaded */
  await ev(`(() => { try { if (typeof avSeqStop === 'function') avSeqStop(); } catch (e) { /* checked below */ } return true; })()`);
  for (let i = 0; i < 30; i++) { if (!(await isPlaying9())) break; await sleep(100); }
  /* the raw snapshot kept for the evidence line (fail or pass) */
  const last9raw = (await ev(`(async () => {
    try {
      const E = window.__avEngine;
      if (!E || E.ready !== true) return null;
      const s = await E.stats();
      return { active: s && s.tune ? s.tune.active : null, last: (s && s.tune ? s.tune.last : null) || null,
               slots: s && s.tune ? s.tune.slots : null,
               playing: (typeof avSeqIsPlaying === 'function') ? avSeqIsPlaying() === true : null };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)).value || null;
  check('T9 track slot: #av-tune-track-0 = edo19 (global 12edo) - a one-note pattern on track 0 through the SCHED -> stats().tune.last carries the track slot (edo19, not the global active slot)',
    !!sel9 && sel9.ok === true && !!trk9 && trk9.trackSlot === trk9.edoS
    && !!load9 && load9.ok === true
    && !!last9 && last9.midi === 64 && last9.slot === trk9.edoS && last9.slot !== trk9.active
    && typeof last9.off === 'number' && isFinite(last9.off) && Math.abs(last9.off) >= 1e-3,
    JSON.stringify({ drive: sel9, stats: trk9, slotProbe: slotProbe9, load: load9, startVia: startVia, last: last9, raw: last9raw, expOff64: r2(EDO19_OFF64) }));
  /* restore: track-0 back to GLOBAL (""), per the contract's "restore" */
  await ev(`(() => {
    const tr = document.getElementById('av-tune-track-0');
    if (!tr) return { missing: true };
    tr.value = '';
    tr.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  })()`);
  await waitFor(`(() => {
    try { const p = JSON.parse(localStorage.getItem('av-tune-pref') || 'null'); return (p && Array.isArray(p.tracks) && !p.tracks[0]) ? true : null; } catch (e) { return null; }
  })()`, 10000);

  /* ---- T10. MTS parse: the 21-byte scale/octave 1-byte frame, digest leg ---- */
  const mtsR = (await ev(`(() => {
    try {
      const T = window.__avTune || {};
      if (typeof T.mtsParse !== 'function') return { missing: true };
      const a = T.mtsParse(${JSON.stringify(MTS_BYTES)});
      const b = T.mtsParse(${JSON.stringify(MTS_BAD)});
      return { a: a, b: b };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)).value || {};
  const mtsA = mtsR.a || null;
  const mtsB = mtsR.b || null;
  const degAt = (arr, d) => Array.isArray(arr) ? (arr.length >= 128 ? arr[60 + d] : (arr.length > d ? arr[d] : null)) : null;
  const deg4v = mtsA ? degAt(mtsA.cents, 4) : null;
  const deg7v = mtsA ? degAt(mtsA.cents, 7) : null;
  check('T10 MTS parse: the 21-byte scale/octave 1-byte frame -> ok (kind scale1, notes 0..11) + ground-truth cents (-14.0625 / +14.0625); malformed refuses',
    !!mtsA && mtsA.ok === true && mtsA.kind === 'scale1'
    && Array.isArray(mtsA.notes) && mtsA.notes.length === 12 && Array.isArray(mtsA.cents)
    && typeof deg4v === 'number' && Math.abs(deg4v - (-14.0625)) <= 0.6
    && typeof deg7v === 'number' && Math.abs(deg7v - 14.0625) <= 0.6
    && !!mtsB && mtsB.ok === false && typeof mtsB.error === 'string' && mtsB.error.length > 0,
    JSON.stringify({ parsed: mtsA ? { ok: mtsA.ok, kind: mtsA.kind, notesN: Array.isArray(mtsA.notes) ? mtsA.notes.length : -1,
      centsN: Array.isArray(mtsA.cents) ? mtsA.cents.length : -1, deg4: deg4v, deg7: deg7v, error: String(mtsA.error || '') } : null,
      refused: mtsB ? { ok: mtsB.ok, error: String(mtsB.error || '') } : null }));

  /* ---- T11. MTS apply: avTuneUiMtsApply(bytes) -> slot 7 live; OFF restores the global slot ---- */
  /* the pre-MTS active slot (the global selection's): OFF must return to exactly this one */
  const pre11 = (await ev(`(async () => {
    try {
      const E = window.__avEngine;
      if (!E || E.ready !== true || typeof E.stats !== 'function') return null;
      const s = await E.stats();
      const t = s && s.tune ? s.tune : null;
      if (!t || typeof t.active !== 'number') return null;
      return { active: t.active, name: (Array.isArray(t.slots) && t.slots[t.active] != null) ? String(t.slots[t.active]) : null };
    } catch (e) { return null; }
  })()`)).value || null;
  const mtsOn = (await ev(`(() => {
    try {
      const cb = document.getElementById('av-tune-mts');
      if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
      return { cb: !!cb, on: cb ? cb.checked === true : null };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)).value || {};
  const applyR = (await ev(`(() => {
    try {
      if (typeof avTuneUiMtsApply !== 'function') return { missing: true };
      const r = avTuneUiMtsApply(${JSON.stringify(MTS_BYTES)});
      return { r: r === true, raw: String(r) };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)).value || {};
  const live11 = await waitFor(`(async () => {
    try {
      const E = window.__avEngine;
      if (!E || E.ready !== true || typeof E.stats !== 'function') return null;
      const s = await E.stats();
      const t = s && s.tune ? s.tune : null;
      if (!t || t.active !== 7 || !Array.isArray(t.slots)) return null;
      const nm = t.slots[7];
      if (!(typeof nm === 'string' && nm.length > 0)) return null;
      return { active: t.active, name: nm };
    } catch (e) { return null; }
  })()`, 20000);
  const mtsOff = (await ev(`(() => {
    try {
      const cb = document.getElementById('av-tune-mts');
      if (cb) { cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); }
      return { ok: true, off: cb ? cb.checked === false : null };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)).value || {};
  const restore11 = await waitFor(`(async () => {
    try {
      const E = window.__avEngine;
      if (!E || E.ready !== true || typeof E.stats !== 'function') return null;
      const s = await E.stats();
      const t = s && s.tune ? s.tune : null;
      if (!t || typeof t.active !== 'number') return null;
      if (t.active === 7) return null;
      return { active: t.active, name: Array.isArray(t.slots) && t.slots[t.active] != null ? String(t.slots[t.active]) : null };
    } catch (e) { return null; }
  })()`, 20000);
  check('T11 MTS apply: avTuneUiMtsApply(bytes) -> tune.active 7 + slot 7 named MTS live; OFF restores the global active slot',
    !!pre11 && !!mtsOn && mtsOn.cb === true && !!applyR && applyR.r === true
    && !!live11 && live11.active === 7 && /mts live/i.test(String(live11.name))
    && !!restore11 && restore11.active === pre11.active && String(restore11.name) === String(pre11.name),
    JSON.stringify({ pre: pre11, toggle: mtsOn, apply: applyR, live: live11, off: mtsOff, restored: restore11 }));

  /* ---- T12. import: a synthesized .scl File through the hidden input ---- */
  const imp12 = (await ev(`(() => {
    try {
      const dt = new DataTransfer();
      dt.items.add(new File([${JSON.stringify(SCL_TEXT)}], 'rig-penta.scl', { type: 'text/plain' }));
      const inp = document.getElementById('av-tune-import-file');
      if (!inp) return { err: 'no #av-tune-import-file' };
      inp.files = dt.files;
      const n = inp.files ? inp.files.length : -1;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, n: n };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)).value || {};
  const row12 = await waitFor(`(() => {
    const rows = Array.prototype.slice.call(document.querySelectorAll('#av-tune-lib [data-tune-id]'));
    const hit = rows.filter(function (r) { return /rig/i.test(String(r.textContent || '')); })[0] || null;
    if (!hit) return null;
    return { rows: rows.length, id: String(hit.getAttribute('data-tune-id') || ''),
             text: String(hit.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 90) };
  })()`, 20000);
  const st12 = (await ev(`String((document.getElementById('av-tune-status') || {}).textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 140)`)).value || '';
  check('T12 import: a synthesized .scl File through #av-tune-import-file -> a #av-tune-lib row with data-tune-id',
    !!imp12 && imp12.ok === true && imp12.n === 1 && !!row12
    && typeof row12.id === 'string' && row12.id.length > 0 && /rig/i.test(String(row12.text)),
    JSON.stringify({ drive: imp12, row: row12, status: st12 }));

  /* ---- T13. import: __avTune.library.list() contains the item (id matches the DOM row) ---- */
  const lib13 = await waitFor(`(async () => {
    try {
      const T = window.__avTune || {};
      if (!T.library || typeof T.library.list !== 'function') return null;
      const raw = await T.library.list();
      const items = Array.isArray(raw) ? raw : ((raw && Array.isArray(raw.items)) ? raw.items : null);
      if (!items) return null;
      const hit = items.filter(function (x) { return x && /rig/i.test(String(x.name || '')); })[0] || null;
      if (!hit) return null;
      return { shape: Array.isArray(raw) ? 'array' : 'object', n: items.length,
               id: String(hit.id == null ? '' : hit.id), name: String(hit.name == null ? '' : hit.name),
               kind: String(hit.kind == null ? '' : hit.kind) };
    } catch (e) { return null; }
  })()`, 20000);
  check('T13 import: __avTune.library.list() contains the item and its id matches the DOM row',
    !!row12 && !!lib13 && lib13.id.length > 0 && lib13.id === row12.id && /rig/i.test(lib13.name),
    JSON.stringify({ row: row12, lib: lib13 }));

  /* ---- T14. persistence: reload -> the prefs + the library item survive fresh ---- */
  const pre14 = (await ev(`(() => {
    const sg = document.getElementById('av-tune-scale');
    const mr = document.getElementById('av-tune-morph');
    if (!sg || !mr) return { missing: true, sg: !!sg, mr: !!mr };
    sg.value = 'just-major';
    sg.dispatchEvent(new Event('change', { bubbles: true }));
    mr.value = '87';
    mr.dispatchEvent(new Event('input', { bubbles: true }));
    mr.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, sel: String(sg.value), morph: String(mr.value) };
  })()`)).value || {};
  const prefP = await waitFor(`(() => {
    try {
      const p = JSON.parse(localStorage.getItem('av-tune-pref') || 'null');
      return (p && String(p.sel) === 'just-major' && Number(p.morph) === 87) ? { v: p.v, sel: String(p.sel), root: p.root, morph: p.morph } : null;
    } catch (e) { return null; }
  })()`, 15000);
  await send('Page.navigate', { url });
  const ready14 = await waitReady();
  note('reloaded (avtest) - ready=' + ready14);
  const t14 = await waitFor(`(async () => {
    try {
      let pref = null;
      try { pref = JSON.parse(localStorage.getItem('av-tune-pref') || 'null'); } catch (e) { pref = null; }
      const sg = document.getElementById('av-tune-scale');
      const mr = document.getElementById('av-tune-morph');
      if (!pref || !sg) return null;
      const rows = document.querySelectorAll('#av-tune-lib [data-tune-id]').length;
      let libHit = false;
      const T = window.__avTune || {};
      if (T.library && typeof T.library.list === 'function') {
        const raw = await T.library.list();
        const items = Array.isArray(raw) ? raw : ((raw && Array.isArray(raw.items)) ? raw.items : null);
        libHit = !!(items && items.some(function (x) { return x && /rig/i.test(String(x.name || '')); }));
      }
      return { pref: { v: pref.v, sel: String(pref.sel == null ? '' : pref.sel), root: pref.root, morph: pref.morph },
               sel: String(sg.value || ''), morph: Number(mr ? mr.value : NaN), rows: rows, libHit: libHit };
    } catch (e) { return null; }
  })()`, 30000);
  check('T14 persistence: reload -> av-tune-pref (sel/root/morph) + the library item survive fresh',
    ready14 === true && !!prefP && !!t14
    && t14.pref.v === 1 && t14.pref.sel === 'just-major' && Number(t14.pref.root) === 60 && Number(t14.pref.morph) === 87
    && t14.sel === 'just-major' && t14.morph === 87 && t14.rows >= 1 && t14.libHit === true,
    JSON.stringify({ drive: pre14, beforeReload: prefP, afterReload: t14 }));

  /* ---- screenshot renders/tune-suite.png (the TUNE card, scale 2 - the house capture call) ---- */
  await ev(`(() => {
    try { if (typeof window.__avZoneAuto === 'function') window.__avZoneAuto('#av-tune'); } catch (e) { /* reveal is a nicety */ }
    const el = document.getElementById('av-tune') || document.getElementById('av-tune-host');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  await sleep(300);
  const rectR = await ev(`(() => {
    const el = document.getElementById('av-tune') || document.getElementById('av-tune-host');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
  })()`);
  const rect = rectR.value;
  let shotOk = false, shotInfo = 'no rect';
  if (rect && rect.w > 50 && rect.h > 50) {
    try {
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 2 }, captureBeyondViewport: true });
      const buf = Buffer.from(shot.data, 'base64');
      writeFileSync(shotPath, buf);
      shotOk = buf.length > 1000 && buf[0] === 0x89 && buf[1] === 0x50;
      shotInfo = buf.length + ' bytes - clip ' + Math.round(rect.w) + 'x' + Math.round(rect.h) + ' @2x';
    } catch (e) { shotInfo = 'capture failed: ' + (e && e.message); }
  }
  check('screenshot: renders/tune-suite.png (the TUNE card, scale 2)', shotOk, shotInfo);

  /* ---- zero page errors (the whole run) ---- */
  check('zero page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* ---- freeze: before === after always; the EXPECT_SHA pin only when set ---- */
  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after): ' + shaAfter);
  check('freeze: index.html sha256 before === after (unchanged by the run)', shaAfter === shaBefore, shaAfter === shaBefore ? 'sha stable (' + shaBefore.slice(0, 12) + '...)' : 'before ' + shaBefore.slice(0, 12) + '... vs after ' + shaAfter.slice(0, 12) + '...');
  if (PIN) {
    check('freeze: index.html sha256 = pinned', shaBefore === PIN && shaAfter === PIN, 'pinned ' + PIN.slice(0, 12) + '...');
  } else {
    note('EXPECT_SHA not pinned (the parent pins it after the first green run) - this unpinned run reports one FEWER check than the pinned run: 17 now, 18 pinned');
  }

  const tIds = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'T13', 'T14'];
  console.log('TUNE-RESULT ' + JSON.stringify({ kind: 'anvil-cdp-tune', version: 1, page: path.relative(here, path.resolve(page)).replace(/\\/g, '/'), sha256: shaBefore, pinned: !!PIN, checks: pass + fail, pass: pass, fail: fail, tIds: tIds, screenshot: 'renders/tune-suite.png', verdict: fail ? 'fail' : 'pass' }));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { ws.close(); } catch { }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('tune harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    /* profile-scoped cleanup (LAW): kill ONLY processes whose command line carries OUR temp
       profile - matched by its unique basename tag, so the pattern needs no backslash escaping */
    const tag = path.basename(profile);
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
