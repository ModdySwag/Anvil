// cdp_seq.mjs — Anvil P4 sequencer suite (child C's rig; WRITTEN by child C, RUN BY THE PARENT
// after integration). End-to-end over raw CDP against the frozen single-file build.
//
//   node verify/cdp_seq.mjs [path-to-index.html] [--port N] [--sha <hex>]
//
// Launch skeleton follows cdp_fx.mjs VERBATIM (candidates Chrome/Edge/Brave, free-port scan,
// fresh temp --user-data-dir, 1440×900 device metrics override — Edge headless ignores
// --window-size, --mute-audio, --autoplay-policy=no-user-gesture-required, ONE browser, explicit
// exit, process.on('exit') kills ONLY processes whose command line carries OUR temp profile).
// SHA freeze discipline from cdp_midi.mjs / cdp_sample.mjs / cdp_fx.mjs: index.html is sha256'd
// before and after the run and the two must match. EXPECT_SHA may be pinned by the parent
// (constant below) or passed with --sha <hex>; while it is null the rig still enforces
// before === after.
//
// WHAT IT PROVES, in order (contract: verify/_p4_wave.md §3.3):
//   1. boot contract (data-av-ready) + the sequencer card mounted into the parent-owned
//      #av-seq-host: card root, .av-seq-grid with 4 rows, transport buttons, BPM knob bound
//      (av-knob idiom, data-knob-bound), host wired marker, exports live (avSeqUiInit /
//      avSeqUiSync / avSeqUiClasses + window.__avSeqUi) and the P4 core/transport APIs present.
//   1b. absent-host contract: with #av-seq-host detached avSeqUiInit() returns false WITHOUT
//      throwing; re-attaching the host and calling avSeqUiInit() re-mounts the card.
//   2. REAL input: a real CDP mouse click on PLAY starts the transport (avSeqIsPlaying true)
//      and the playhead .cur advances between two samples; a real STOP click halts it and the
//      playhead freezes.
//   3. TIMING WITNESS: the rig's OWN AnalyserNode sits on the master tap (avMasterFor — panel
//      reads are never witnesses) and samples the RMS envelope at ~5 ms. A known 16-step
//      all-on pattern (S=50, 120 bpm) runs for 8+ bars; onset detection (rising edges) yields
//      16 onsets/bar, mean |onset − phase-fitted grid| ≤ 8 ms, and no cumulative drift (bar 8
//      within ±6 ms of bar 1). The witness patch switches engine.kind to drum (one-shot kick,
//      c2 = midi 36) so every onset is a clean transient; the kind is restored before the run
//      ends. The grid is phase-fitted to the first onset (a constant audio-path latency cancels
//      — BY DESIGN; the checks measure jitter and rate drift, plus a coarse first-onset window
//      against the PLAY click).
//   4. SWING wITNESS: S=66 ⇒ odd-step onsets shift ≈ +16 % of stepDur (0.16 × 125 ms = 20 ms,
//      tolerance ±6 ms) against an even-onset-fitted grid (the swing law from §2).
//   5. PROBABILITY witness: prob 0 on the odd steps ⇒ deterministic silence (16 onsets per 2
//      bars); prob 100 ⇒ all present (32 onsets per 2 bars).
//   6. PATTERN ROUND-TRIP through the UI path: real EXPORT click → the pinned JSON in
//      #av-seq-io → real IMPORT click → avSeqSnap() deep-equal to the pre-export snapshot.
//   7. P-LOCK witness: filter.cutoff locked to 800 at step 0 (pattern plocks container).
//      The rig taps the avApplyParam funnel (additive, marker __seqtTap) AND polls
//      avParams['filter.cutoff'] at 10 ms: the lock value is witnessed during the run at the
//      locked step, and the base value is restored after the lock ends.
//   8. UNDO/REDO: a real grid-cell click edits the pattern (via the UI's snapshot path);
//      avUndo() restores the pre-edit snapshot (deep-equal) and avRedo() reapplies it.
//   9. zero page errors · screenshot renders/p4-seq-suite.png · freeze sha256 before === after.
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

/* FREEZE LAW: the bytes under test are named before anything runs, and re-checked after.
   P4: the frozen sha of the rebuilt index.html is not known until build.py runs — the parent may
   fill this constant or pass --sha <hex>; the rig never loosens the before === after check. */
const EXPECT_SHA = '335f4bd06f7aafff68725c1645a1b00518936a9c74fd90969221a7d2ce7d0d15';
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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9480);
const profile = path.join(tmpdir(), 'anvil-sequi-' + Date.now());
const url = 'file:///' + path.resolve(page).replace(/\\/g, '/');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
console.log('cdp port ' + PORT + ' · profile ' + profile);

let pass = 0, fail = 0;
const check = (name, ok, info) => {
  if (ok) { pass++; console.log(' ok   ' + name + (info ? '  -> ' + info : '')); }
  else { fail++; console.log(' FAIL ' + name + (info ? '  -> ' + info : '')); }
};
const note = (t) => console.log('   · ' + t);

const chrome = spawn(exe, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--disable-sync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
  url,
], { stdio: 'ignore', windowsHide: true });

const errors = [];

/* ---------- node-side analysis helpers (the timing witness math) ---------- */

const STEP_MS = 125;          /* one 16th @ 120 bpm = 60/120/4 s */
const BAR_MS = STEP_MS * 16;  /* 2000 ms */
const MEAN_ABS_MAX = 8;       /* §3.3: mean |onset − grid| ≤ 8 ms */
const DRIFT_MAX = 6;          /* §3.3: bar 8 within ±6 ms of bar 1 */
const SWING_IDEAL = 20;       /* §2: S=66 ⇒ stepDur × 16/100 = 20 ms on odd steps */
const SWING_TOL = 6;

const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const meanAbs = (a) => a.length ? a.reduce((s, x) => s + Math.abs(x), 0) / a.length : 0;
const fx3 = (x) => (x == null || !isFinite(x)) ? String(x) : Number(x).toFixed(3);

function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a == null || b == null) return false;
  if (typeof a !== 'object') return false;
  const aa = Array.isArray(a), ab = Array.isArray(b);
  if (aa !== ab) return false;
  if (aa) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEq(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i] || !deepEq(a[ka[i]], b[kb[i]])) return false;
  return true;
}

/* onset detection: rising RMS edges over the ~5 ms sampler stream. Adaptive slope threshold
   (a drum transient rises fast even over a decaying tail); a 55 ms re-arm gap stops double
   detections. Onset time = rise midpoint (a ~constant lag cancels in every phase-fit below). */
function detectOnsets(samples) {
  let max = 0;
  for (const s of samples) if (s[1] > max) max = s[1];
  const dthr = Math.max(0.006, max * 0.22);
  const onsets = [];
  let last = -1e9;
  for (let i = 1; i < samples.length; i++) {
    const t0 = samples[i - 1][0], r0 = samples[i - 1][1];
    const t1 = samples[i][0], r1 = samples[i][1];
    if (r1 - r0 > dthr && t1 - last > 55) {
      onsets.push(t0 + (t1 - t0) * 0.5);
      last = t1;
    }
  }
  return { onsets, max, dthr };
}

/* phase-fitted straight-grid stats: grid = o0 + k·125 ms */
function straightStats(onsets) {
  const o0 = onsets[0];
  const pairs = [];
  let j = 0;
  for (let k = 0; k < 128; k++) {
    const pred = o0 + k * STEP_MS;
    while (j < onsets.length && onsets[j] < pred - STEP_MS * 0.5) j++;
    if (j < onsets.length && Math.abs(onsets[j] - pred) <= STEP_MS * 0.5) { pairs.push([k, onsets[j] - pred]); j++; }
  }
  const barMean = (k0, k1) => {
    const r = pairs.filter(p => p[0] >= k0 && p[0] < k1).map(p => p[1]);
    return r.length ? mean(r) : null;
  };
  return { o0, count: pairs.length, resid: pairs.map(p => p[1]), meanAbs: meanAbs(pairs.map(p => p[1])), bar1: barMean(0, 16), bar8: barMean(112, 128) };
}

function swingStats(onsets) {
  const n = Math.min(48, onsets.length);
  const evens = [], odds = [];
  for (let k = 0; k < n; k++) {
    const r = onsets[k] - k * STEP_MS;
    if (k % 2 === 0) evens.push(r); else odds.push(r);
  }
  const t0E = mean(evens);
  return {
    n, t0E,
    oddShift: mean(odds) - t0E,
    evenShift: mean(evens) - mean(odds),   /* the phase-inverted read, reported for diagnosis */
    evenSpread: evens.length ? Math.max(...evens.map(x => Math.abs(x - t0E))) : null,
  };
}

function countIn(onsets, o0, steps) {
  const lo = o0 - 0.4 * STEP_MS, hi = o0 + (steps - 0.4) * STEP_MS;
  let c = 0;
  for (const t of onsets) if (t >= lo && t < hi) c++;
  return c;
}

/* ---------- page-side scaffolding injected at runtime (rig-owned; never app code) ----------
   __seqt: the rig's OWN AnalyserNode on the master tap (avMasterFor); a 5 ms setInterval records
   a time-stamped RMS timeline. __seqtPoll: avParams['filter.cutoff'] poller (10 ms) for the
   p-lock witness. __seqtTap: additive avApplyParam tap (marker __seqtTap) recording
   (t, path, value) — the p-lock funnel witness. __seqh: deepEq / pattern builders / loader. */

const SEQT_SETUP = `(() => {
  if (window.__seqt && window.__seqt.v === 1) return { ok: true, cached: true };
  const API = { v: 1, an: null, sr: 0, samples: [], on: false, timer: 0 };
  API.arm = function (ctx) {
    API.disarm();
    const master = (typeof avMasterFor === 'function') ? avMasterFor(ctx) : null;
    if (!master) return { ok: false, why: 'no master tap node for this ctx' };
    const an = ctx.createAnalyser();
    an.fftSize = 256;                 /* ~5.3 ms window @48k */
    an.smoothingTimeConstant = 0;
    master.connect(an);
    API.an = an; API.sr = ctx.sampleRate; API.samples = []; API.on = true;
    const tick = function () {
      if (!API.on) return;
      try {
        const td = new Float32Array(API.an.fftSize);
        API.an.getFloatTimeDomainData(td);
        let s = 0;
        for (let i = 0; i < td.length; i++) s += td[i] * td[i];
        const rms = Math.sqrt(s / td.length);
        API.samples.push([performance.now(), rms]);
        if (API.samples.length > 24000) API.samples.shift();
      } catch (e) { /* analyser gone */ }
    };
    API.timer = setInterval(tick, 5);
    return { ok: true, sr: API.sr, fft: an.fftSize };
  };
  API.disarm = function () {
    API.on = false;
    if (API.timer) { clearInterval(API.timer); API.timer = 0; }
    if (API.an) { try { API.an.disconnect(); } catch (e) { } }
    return true;
  };
  API.clear = function () { API.samples = []; return true; };
  API.pull = function () { return { sr: API.sr, n: API.samples.length, samples: API.samples.slice() }; };
  window.__seqt = API;
  return { ok: true };
})()`;

const POLL_SETUP = `(() => {
  if (window.__seqtPoll && window.__seqtPoll.v === 1) return { ok: true };
  const API = { v: 1, on: false, timer: 0, path: 'filter.cutoff', recs: [] };
  API.start = function (path) {
    API.path = path || 'filter.cutoff';
    API.recs = []; API.on = true;
    API.timer = setInterval(function () {
      try { API.recs.push([performance.now(), (typeof avParams !== 'undefined') ? avParams[API.path] : null]); } catch (e) { }
    }, 10);
    return true;
  };
  API.stop = function () { API.on = false; if (API.timer) { clearInterval(API.timer); API.timer = 0; } return true; };
  API.pull = function () { return API.recs.slice(); };
  window.__seqtPoll = API;
  return { ok: true };
})()`;

const TAP_SETUP = `(() => {
  if (window.__seqtTap && window.__seqtTap.v === 1) return { ok: true, cached: true };
  const API = { v: 1, recs: [] };
  try {
    if (typeof avApplyParam === 'function' && avApplyParam.__seqtTap !== true) {
      const orig = avApplyParam;
      const wrapped = function (path, v, meta) {
        try { API.recs.push([performance.now(), String(path), v]); } catch (e) { }
        return orig(path, v, meta);
      };
      wrapped.__seqtTap = true;
      avApplyParam = wrapped;
    }
    window.__seqtTap = API;
    return { ok: true, wrapped: true };
  } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
})()`;

const HELPERS = `(() => {
  if (window.__seqh && window.__seqh.v === 1) return { ok: true, cached: true };
  const H = { v: 1 };
  H.deepEq = function (a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a == null || b == null) return false;
    if (typeof a !== 'object') return false;
    const aa = Array.isArray(a), ab = Array.isArray(b);
    if (aa !== ab) return false;
    if (aa) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!H.deepEq(a[i], b[i])) return false; return true; }
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i] || !H.deepEq(a[ka[i]], b[kb[i]])) return false;
    return true;
  };
  H.step = function (o) {
    return Object.assign({ on: 0, note: 'c2', vel: 0.85, gate: 0.5, slide: 0, accent: 0, oct: 0, prob: 100, cond: '', ratchet: 1, micro: 0 }, o || {});
  };
  H.off = function () { const a = []; for (let i = 0; i < 64; i++) a.push(H.step({ on: 0 })); return a; };
  H.pattern = function (o) {
    o = o || {};
    const steps = [];
    for (let s = 0; s < 16; s++) {
      let on = 1, prob = 100;
      if (o.prob0Odd && (s % 2 === 1)) prob = 0;
      if (o.onSteps) on = (o.onSteps.indexOf(s) >= 0) ? 1 : 0;
      steps.push(H.step({ on: on, prob: prob }));
    }
    const all = steps.concat(H.off().slice(16));
    const tracks = [];
    for (let t = 0; t < 4; t++) tracks.push({ len: 16, speed: 1, mute: 0, steps: (t === 0 ? all.slice() : H.off()) });
    return { v: 1, name: o.name || 'RIG PAT', bpm: 120, grid: '16', swing: (o.swing == null ? 50 : o.swing), rng: 305419896, tracks: tracks, plocks: o.plocks || [] };
  };
  H.load = function (P) {
    let ok = false, why = '';
    try {
      if (typeof avSeqPatternImport === 'function') { ok = avSeqPatternImport(JSON.stringify(P)) === true; why = ok ? 'import' : 'import-refused'; }
      if (!ok && typeof avSeqLoad === 'function') { ok = avSeqLoad(P) === true; why = ok ? 'load' : 'load-refused'; }
    } catch (e) { ok = false; why = 'threw: ' + ((e && e.message) || e); }
    if (ok) {
      try { if (typeof avSeqSetPattern === 'function' && typeof avSeqSnap === 'function') avSeqSetPattern(avSeqSnap()); } catch (e) { }
      try { if (typeof avApplyParam === 'function') avApplyParam('bpm', 120); } catch (e) { }
      /* checkpoint like the app's import path: undo must restore the pre-edit pattern */
      try { if (typeof avUndoPush === 'function' && typeof avSeqSnap === 'function') avUndoPush('seq', 'rig-load'); } catch (e) { }
    }
    return { ok: ok, why: why };
  };
  window.__seqh = H;
  return { ok: true };
})()`;

/* ---------- §3.3 timings ---------- */

const RUN_STRAIGHT_MS = 17500;   /* 8 bars = 16 s + slack */
const RUN_SWING_MS = 6800;       /* ~3 bars */
const RUN_PROB_MS = 4800;        /* 2 bars + slack */
const RUN_PLOCK_MS = 4800;

const shotPath = path.join(here, '..', 'renders', 'p4-seq-suite.png');

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

  const stopTransport = async () => {
    await ev(`(() => { try { if (typeof avSeqStop === 'function') avSeqStop(); } catch (e) { } return true; })()`);
    await sleep(220);
  };
  const pullSamples = async () => {
    const r = await ev(`window.__seqt.pull()`);
    return (r.value && Array.isArray(r.value.samples)) ? r.value.samples : [];
  };

  /* ── 1. boot ── */
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const r = await ev(`document.documentElement.getAttribute('data-av-ready') === '1'`);
    if (r.value === true) { ready = true; break; }
    await sleep(300);
  }
  check('boot: data-av-ready flips', ready);
  if (!ready) { console.error('APP NOT READY'); process.exit(1); }

  /* ── 2. the sequencer card mounts into the parent-owned #av-seq-host ── */
  let seqUp = false;
  for (let i = 0; i < 100 && !seqUp; i++) {
    const r = await ev(`!!(document.getElementById('av-seq-host') && document.querySelector('#av-seq-host .av-seq') && document.querySelector('#av-seq-host .av-seq-grid') && document.querySelectorAll('#av-seq-host .av-seq-row[data-track]').length === 4)`);
    if (r.value === true) { seqUp = true; break; }
    await sleep(150);
  }
  check('seq card mounted: #av-seq-host + card root + grid (4 rows)', seqUp);
  if (!seqUp) { console.error('SEQ HOST MISSING — parent adds #av-seq-host and calls avSeqUiInit()'); process.exit(1); }

  const domR = await ev(`(() => {
    const host = document.getElementById('av-seq-host');
    const rows = [...host.querySelectorAll('.av-seq-row[data-track]')];
    const perRow = rows.map(r => r.querySelectorAll('.av-seq-cell').length);
    const knobs = [...host.querySelectorAll('.av-knob[data-knob]')];
    return {
      perRow: perRow,
      total: host.querySelectorAll('.av-seq-cell').length,
      pinnedCells: [...host.querySelectorAll('.av-seq-cell')].filter(c => c.dataset.track != null && c.dataset.step != null).length,
      play: !!host.querySelector('#av-seq-play'), stop: !!host.querySelector('#av-seq-stop'), rec: !!host.querySelector('#av-seq-rec'),
      pos: !!host.querySelector('#av-seq-pos'), bpmKnob: !!host.querySelector('.av-knob[data-knob="bpm"]'),
      bpmBound: !!host.querySelector('.av-knob[data-knob="bpm"][data-knob-bound="1"]'),
      wired: host.dataset.avSeqUiWired === '1',
    };
  })()`);
  const dom = domR.value || {};
  check('grid counts: 4 rows × N cells (N ≥ 4; total ≥ 64), every cell pinned data-track/data-step',
    Array.isArray(dom.perRow) && dom.perRow.length === 4 && dom.perRow.every(n => n >= 4) && dom.total >= 64 && dom.pinnedCells === dom.total,
    JSON.stringify(dom.perRow) + ' · total=' + dom.total);
  check('controls bound: PLAY/STOP/REC/pos present · BPM knob via av-knob idiom, bound · host wired marker',
    dom.play === true && dom.stop === true && dom.rec === true && dom.pos === true && dom.bpmKnob === true && dom.bpmBound === true && dom.wired === true,
    JSON.stringify({ play: dom.play, bpmBound: dom.bpmBound, wired: dom.wired }));

  const exportsR = await ev(`(() => ({
    init: typeof avSeqUiInit === 'function',
    sync: typeof avSeqUiSync === 'function',
    classes: typeof avSeqUiClasses === 'function',
    handle: !!(window.__avSeqUi && typeof window.__avSeqUi.snap === 'function'),
    version: window.__avSeqUi ? window.__avSeqUi.version : null,
    classesN: (typeof avSeqUiClasses === 'function') ? avSeqUiClasses().length : 0,
  }))()`);
  const exportsV = exportsR.value || {};
  check('exports: avSeqUiInit + avSeqUiSync + avSeqUiClasses + window.__avSeqUi (p4.0, ≥30 classes)',
    exportsV.init === true && exportsV.sync === true && exportsV.classes === true && exportsV.handle === true && exportsV.version === 'p4.0' && exportsV.classesN >= 30,
    JSON.stringify(exportsV));

  /* ── 2b. core/transport preflight (the pinned P4 APIs this rig drives) ── */
  const coreR = await ev(`(() => {
    const names = ['avSeqSnap','avSeqLoad','avSeqPatternExport','avSeqPatternImport','avSeqPlay','avSeqStop','avSeqIsPlaying','avSeqPosition','avSeqSetPattern'];
    const missing = names.filter(n => typeof window[n] !== 'function');
    return { missing: missing, undo: typeof avUndo === 'function' && typeof avRedo === 'function', plock: typeof avPlockApplyAt === 'function', capture: typeof avSeqCaptureArm === 'function' };
  })()`);
  const core = coreR.value || {};
  check('core preflight: A + B pinned APIs present (snap/load/export/import/play/stop/isPlaying/position/setPattern)',
    Array.isArray(core.missing) && core.missing.length === 0,
    core.missing && core.missing.length ? 'missing: ' + core.missing.join(', ') : 'all present · undo=' + core.undo + ' plock=' + core.plock + ' capture=' + core.capture);

  /* ── 2c. absent-host contract + remount ── */
  const probeR = await ev(`(() => {
    const host = document.getElementById('av-seq-host');
    if (!host || !host.parentNode) return { skip: true };
    const parent = host.parentNode, next = host.nextSibling;
    host.remove();
    let absent = null, absentThrew = false;
    try { absent = avSeqUiInit(); } catch (e) { absentThrew = true; }
    parent.insertBefore(host, next);
    let remount = null, remountThrew = false;
    try { remount = avSeqUiInit(); } catch (e) { remountThrew = true; }
    return {
      absent: absent, absentThrew: absentThrew, remount: remount, remountThrew: remountThrew,
      rows: document.querySelectorAll('#av-seq-host .av-seq-row[data-track]').length,
      wired: host.dataset.avSeqUiWired === '1',
      bpmBound: !!host.querySelector('.av-knob[data-knob="bpm"][data-knob-bound="1"]'),
    };
  })()`);
  const probe = probeR.value || {};
  check('absent-host contract: avSeqUiInit() -> false without throwing; re-attached host re-mounts the card',
    probe.absent === false && probe.absentThrew === false && probe.remount === true && probe.remountThrew === false && probe.rows === 4 && probe.wired === true && probe.bpmBound === true,
    JSON.stringify(probe));

  /* ── 3. engine ready + the rig's OWN witness on the master tap ── */
  let engReady = false;
  for (let i = 0; i < 100 && !engReady; i++) {
    const r = await ev(`!!(window.__avEngine && window.__avEngine.ready === true)`);
    if (r.value === true) { engReady = true; break; }
    await sleep(200);
  }
  check('engine ready (the live tier is up before the witnesses)', engReady,
    engReady ? ((await ev(`window.__avEngine.tier`)).value || '') : 'not ready after 20 s');

  await ev(SEQT_SETUP);
  await ev(POLL_SETUP);
  await ev(TAP_SETUP);
  await ev(HELPERS);
  const armR = await ev(`(() => {
    const h = window.__avEngine;
    if (!h || h.ready !== true || !h.handle || !h.handle.ctx) return { ok: false, why: 'engine not ready' };
    try { const p = h.handle.ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { }
    return window.__seqt.arm(h.handle.ctx);
  })()`);
  let armed = !!(armR.value && armR.value.ok === true);
  check('timing witness: rig\'s OWN AnalyserNode armed on the master tap (avMasterFor, ~5 ms RMS sampling)', armed, JSON.stringify(armR.value || armR.error));

  const helpR = await ev(`window.__seqh.pattern({ all16: true })`);
  check('witness helpers: pattern builder live (H.pattern)', !!helpR.value && Array.isArray(helpR.value.tracks), helpR.error ? String(helpR.error).slice(0, 120) : 'ok');

  /* the witness patch: one-shot drum voices make every onset a clean transient (restored later) */
  const kindR = await ev(`(() => {
    const prev = { kind: null, kick: null };
    try { prev.kind = avParams['engine.kind']; } catch (e) { }
    try { prev.kick = avParams['drum.kick.decay']; } catch (e) { }
    let ok = false;
    try { ok = (typeof avApplyParam === 'function') ? (avApplyParam('engine.kind', 'drum') === true) : false; } catch (e) { ok = false; }
    try { if (typeof avApplyParam === 'function') avApplyParam('drum.kick.decay', 0.12); } catch (e) { }
    return { ok: ok, prev: prev, mirror: (typeof avParams !== 'undefined') ? avParams['engine.kind'] : null };
  })()`);
  const kindV = kindR.value || {};
  const kindPrev = (kindV.prev && kindV.prev.kind) != null ? kindV.prev.kind : 'va';
  const kickPrev = (kindV.prev && typeof kindV.prev.kick === 'number') ? kindV.prev.kick : null;
  check('witness patch: engine.kind -> drum accepted (one-shot kick c2 = midi 36; kind restored at the end)', kindV.ok === true, JSON.stringify(kindV));

  if (armed) {
    await sleep(500);
    const baseR = await ev(`(() => { const p = window.__seqt.pull(); let m = 0; for (const s of p.samples) if (s[1] > m) m = s[1]; return { max: m, n: p.n }; })()`);
    const baseB = baseR.value || {};
    check('baseline: silent control window BEFORE the first PLAY (RMS < 0.01)', typeof baseB.max === 'number' && baseB.max < 0.01, JSON.stringify(baseB));
  } else {
    check('baseline: silent control window BEFORE the first PLAY (RMS < 0.01)', false, 'witness not armed');
  }

  /* ── 4. transport: real PLAY click → playing + playhead advances; STOP halts ── */
  let playAdvanceOk = false, stopOk = false, playingSeen = false;
  {
    await stopTransport();
    const loadR = await ev(`window.__seqh.load(window.__seqh.pattern({ all16: true }))`);
    note('transport run pattern: ' + JSON.stringify(loadR.value));
    if (armed) await ev(`window.__seqt.clear()`);
    const tPre = (await ev(`performance.now()`)).value;
    const clicked = await clickSel('#av-seq-host #av-seq-play', 500);
    const tPost = (await ev(`performance.now()`)).value;
    for (let i = 0; i < 20 && !playingSeen; i++) {
      const r = await ev(`(() => { try { return typeof avSeqIsPlaying === 'function' ? avSeqIsPlaying() === true : false; } catch (e) { return false; } })()`);
      if (r.value === true) { playingSeen = true; break; }
      await sleep(100);
    }
    await sleep(650);
    const sig1 = (await ev(`(() => { try { return [...document.querySelectorAll('#av-seq-host .av-seq-cell.cur')].map(c => c.dataset.track + ':' + c.dataset.step).sort().join(','); } catch (e) { return ''; } })()`)).value;
    await sleep(700);
    const sig2 = (await ev(`(() => { try { return [...document.querySelectorAll('#av-seq-host .av-seq-cell.cur')].map(c => c.dataset.track + ':' + c.dataset.step).sort().join(','); } catch (e) { return ''; } })()`)).value;
    playAdvanceOk = clicked === true && playingSeen && typeof sig1 === 'string' && sig1.length > 0 && sig2 !== sig1;
    check('real PLAY click: transport runs (avSeqIsPlaying) and the playhead .cur advances',
      playAdvanceOk, 'playing=' + playingSeen + ' · cur "' + sig1 + '" -> "' + sig2 + '" · click window ' + Math.round(tPost - tPre) + ' ms');

    const stopped = await clickSel('#av-seq-host #av-seq-stop', 200);
    let halted = false;
    for (let i = 0; i < 20 && !halted; i++) {
      const r = await ev(`(() => { try { return typeof avSeqIsPlaying === 'function' ? avSeqIsPlaying() === false : false; } catch (e) { return false; } })()`);
      if (r.value === true) { halted = true; break; }
      await sleep(100);
    }
    const f1 = (await ev(`(() => { try { return [...document.querySelectorAll('#av-seq-host .av-seq-cell.cur')].map(c => c.dataset.track + ':' + c.dataset.step).sort().join(','); } catch (e) { return ''; } })()`)).value;
    await sleep(500);
    const f2 = (await ev(`(() => { try { return [...document.querySelectorAll('#av-seq-host .av-seq-cell.cur')].map(c => c.dataset.track + ':' + c.dataset.step).sort().join(','); } catch (e) { return ''; } })()`)).value;
    stopOk = stopped === true && halted && f1 === f2;
    check('real STOP click: transport halts and the playhead freezes',
      stopOk, 'halted=' + halted + ' · frozen "' + f1 + '"');
  }

  /* ── 5. TIMING WITNESS: straight 16ths, S=50, 8+ bars ── */
  let straight = null;
  if (armed) {
    await stopTransport();
    const loadR = await ev(`window.__seqh.load(window.__seqh.pattern({ all16: true, swing: 50 }))`);
    check('timing: known 16-step all-on pattern loaded @120 bpm (S=50) via the pinned import path',
      !!(loadR.value && loadR.value.ok === true), JSON.stringify(loadR.value));
    await ev(`window.__seqt.clear()`);
    const tPre = (await ev(`performance.now()`)).value;
    await clickSel('#av-seq-host #av-seq-play', 250);
    const tPost = (await ev(`performance.now()`)).value;
    await sleep(RUN_STRAIGHT_MS);
    await clickSel('#av-seq-host #av-seq-stop', 200);
    const samples = await pullSamples();
    const det = detectOnsets(samples);
    straight = straightStats(det.onsets);
    straight.clickPre = tPre; straight.clickPost = tPost;
    straight.onsetN = det.onsets.length; straight.max = det.max; straight.dthr = det.dthr;
    note('timing capture: samples=' + samples.length + ' · onsets=' + det.onsets.length + ' · maxRms=' + fx3(det.max) + ' · slopeThr=' + fx3(det.dthr));
    check('timing: first onset lands within the PLAY click window (transport actually started)',
      det.onsets.length >= 1 && det.onsets[0] >= tPre - 60 && det.onsets[0] <= tPost + 700,
      det.onsets.length ? ('first onset ' + (det.onsets[0] - tPost).toFixed(0) + ' ms after the click reads') : 'no onsets');
    check('timing: 16 onsets/bar over 8 bars (128 matched grid slots)',
      straight.count >= 126 && straight.count <= 130,
      'matched=' + straight.count + '/128');
    check('timing: mean |onset − grid| ≤ ' + MEAN_ABS_MAX + ' ms (phase-fitted, jitter witness)',
      straight.meanAbs <= MEAN_ABS_MAX, 'mean|Δ|=' + fx3(straight.meanAbs) + ' ms');
    check('timing: NO cumulative drift — bar 8 within ±' + DRIFT_MAX + ' ms of bar 1',
      straight.bar1 != null && straight.bar8 != null && Math.abs(straight.bar8 - straight.bar1) <= DRIFT_MAX,
      'bar1=' + fx3(straight.bar1) + ' ms · bar8=' + fx3(straight.bar8) + ' ms · drift=' + fx3(straight.bar8 - straight.bar1) + ' ms');
  } else {
    check('timing: known 16-step all-on pattern loaded @120 bpm (S=50) via the pinned import path', false, 'witness not armed');
    check('timing: first onset lands within the PLAY click window (transport actually started)', false, 'witness not armed');
    check('timing: 16 onsets/bar over 8 bars (128 matched grid slots)', false, 'witness not armed');
    check('timing: mean |onset − grid| ≤ ' + MEAN_ABS_MAX + ' ms (phase-fitted, jitter witness)', false, 'witness not armed');
    check('timing: NO cumulative drift — bar 8 within ±' + DRIFT_MAX + ' ms of bar 1', false, 'witness not armed');
  }

  /* ── 6. SWING WITNESS: S=66 ⇒ odd onsets shift ≈ +16 % of stepDur ── */
  if (armed) {
    await stopTransport();
    const loadR = await ev(`window.__seqh.load(window.__seqh.pattern({ all16: true, swing: 66 }))`);
    note('swing pattern: ' + JSON.stringify(loadR.value));
    await ev(`window.__seqt.clear()`);
    await clickSel('#av-seq-host #av-seq-play', 250);
    await sleep(RUN_SWING_MS);
    await clickSel('#av-seq-host #av-seq-stop', 200);
    const samples = await pullSamples();
    const det = detectOnsets(samples);
    const sw = swingStats(det.onsets);
    note('swing capture: onsets=' + det.onsets.length + ' · evenShiftAlt=' + fx3(sw.evenShift) + ' ms · evenSpread=' + fx3(sw.evenSpread));
    check('swing: S=66 ⇒ odd onsets shift ≈ +' + SWING_IDEAL + ' ms (16 % of stepDur) ±' + SWING_TOL + ' ms',
      det.onsets.length >= 32 && Math.abs(sw.oddShift - SWING_IDEAL) <= SWING_TOL,
      'oddShift=' + fx3(sw.oddShift) + ' ms over n=' + sw.n + (Math.abs(sw.oddShift - SWING_IDEAL) > SWING_TOL && Math.abs(sw.evenShift - SWING_IDEAL) <= SWING_TOL ? ' (phase-inverted read — transport did not start at step 0)' : ''));
  } else {
    check('swing: S=66 ⇒ odd onsets shift ≈ +' + SWING_IDEAL + ' ms (16 % of stepDur) ±' + SWING_TOL + ' ms', false, 'witness not armed');
  }

  /* ── 7. PROBABILITY WITNESS: prob 0 on odd steps ⇒ silent; prob 100 ⇒ present ── */
  if (armed) {
    const probRun = async (kind) => {
      await stopTransport();
      const loadR = await ev(`window.__seqh.load(window.__seqh.pattern({ all16: true, swing: 50, prob0Odd: ${kind === 'zero'} }))`);
      if (!(loadR.value && loadR.value.ok)) return { ok: false, why: JSON.stringify(loadR.value) };
      await ev(`window.__seqt.clear()`);
      await clickSel('#av-seq-host #av-seq-play', 250);
      await sleep(RUN_PROB_MS);
      await clickSel('#av-seq-host #av-seq-stop', 200);
      const samples = await pullSamples();
      const det = detectOnsets(samples);
      const n = det.onsets.length ? countIn(det.onsets, det.onsets[0], 32) : 0;
      return { ok: true, onsets: det.onsets.length, in2bars: n };
    };
    const p0 = await probRun('zero');
    check('probability: prob 0 on the odd steps ⇒ deterministic silence (16 onsets / 2 bars)',
      p0.ok === true && p0.in2bars >= 15 && p0.in2bars <= 17,
      'in2bars=' + p0.in2bars + ' · total onsets=' + p0.onsets + (p0.why ? ' · ' + p0.why : ''));
    const p100 = await probRun('full');
    check('probability: prob 100 ⇒ all steps present (32 onsets / 2 bars)',
      p100.ok === true && p100.in2bars >= 31 && p100.in2bars <= 33,
      'in2bars=' + p100.in2bars + ' · total onsets=' + p100.onsets + (p100.why ? ' · ' + p100.why : ''));
  } else {
    check('probability: prob 0 on the odd steps ⇒ deterministic silence (16 onsets / 2 bars)', false, 'witness not armed');
    check('probability: prob 100 ⇒ all steps present (32 onsets / 2 bars)', false, 'witness not armed');
  }

  /* ── 8. PATTERN ROUND-TRIP through the UI path (export → import → deep-equal) ── */
  {
    await stopTransport();
    const loadR = await ev(`window.__seqh.load(window.__seqh.pattern({ all16: true, swing: 66, name: 'IO PAT' }))`);
    if (!(loadR.value && loadR.value.ok)) note('io setup load: ' + JSON.stringify(loadR.value));
    await sleep(250);
    const snapA = (await ev(`avSeqSnap()`)).value;
    const exClick = await clickSel('#av-seq-host #av-seq-export', 250);
    const ioR = await ev(`(() => { const t = document.getElementById('av-seq-io'); return t ? t.value : null; })()`);
    let parsed = null;
    try { parsed = JSON.parse(ioR.value); } catch (e) { parsed = null; }
    const imClick = await clickSel('#av-seq-host #av-seq-import', 350);
    const snapB = (await ev(`avSeqSnap()`)).value;
    const rtOk = exClick === true && imClick === true && !!parsed && parsed.v === 1 && parsed.name === 'IO PAT' && !!snapA && !!snapB && deepEq(snapA, snapB);
    check('pattern round-trip (UI path): real EXPORT writes the pinned JSON → real IMPORT → avSeqSnap() deep-equal',
      rtOk, 'exported ' + (ioR.value ? ioR.value.length : 0) + ' chars · import ' + (deepEq(snapA, snapB) ? 'deep-equal' : 'DIFFERS'));
  }

  /* ── 9. P-LOCK WITNESS: filter.cutoff locked at step 0, witnessed at its step, restored after ── */
  {
    await stopTransport();
    const baseR = await ev(`(() => {
      let base = (typeof avParams !== 'undefined' && isFinite(avParams['filter.cutoff'])) ? avParams['filter.cutoff'] : 1800;
      try { if (typeof avApplyParam === 'function') avApplyParam('filter.cutoff', base); } catch (e) { }
      return { base: base };
    })()`);
    const BASE = (baseR.value && isFinite(baseR.value.base)) ? baseR.value.base : 1800;
    await ev(`window.__seqtTap.recs = [];`);
    await ev(`window.__seqtPoll.start('filter.cutoff')`);
    const loadR = await ev(`window.__seqh.load(window.__seqh.pattern({ onSteps: [0,4,8,12], swing: 50, plocks: [{ path: 'filter.cutoff', interp: 'step', steps: { '0': 800 } }] }))`);
    note('p-lock pattern: ' + JSON.stringify(loadR.value));
    await clickSel('#av-seq-host #av-seq-play', 250);
    await sleep(RUN_PLOCK_MS);
    await clickSel('#av-seq-host #av-seq-stop', 250);
    await ev(`window.__seqtPoll.stop()`);
    const tapRecs = (await ev(`window.__seqtTap.recs`)).value || [];
    const pollRecs = (await ev(`window.__seqtPoll.pull()`)).value || [];
    const cutRecs = tapRecs.filter(r => Array.isArray(r) && r[1] === 'filter.cutoff');
    const lockRecs = cutRecs.filter(r => r[2] === 800);
    const restoreRecs = cutRecs.filter(r => typeof r[2] === 'number' && Math.abs(r[2] - BASE) < 0.51);
    const poll800 = pollRecs.filter(r => Array.isArray(r) && r[1] === 800);
    const afterR = await ev(`(typeof avParams !== 'undefined') ? avParams['filter.cutoff'] : null`);
    const after = afterR.value;
    check('p-lock: filter.cutoff 800 witnessed at the locked step (funnel tap + avParams mirror poll)',
      lockRecs.length >= 1 && poll800.length >= 1,
      'funnel hits=' + lockRecs.length + ' · mirror@800 samples=' + poll800.length);
    check('p-lock: base value restored after the lock ended (funnel + mirror after stop)',
      restoreRecs.some(r => lockRecs.length && r[0] > lockRecs[0][0]) && typeof after === 'number' && Math.abs(after - BASE) < 0.51,
      'base=' + BASE + ' · restore hits=' + restoreRecs.length + ' · mirror after stop=' + after);
    /* cleanup: drop the plocks + put the base value back */
    await ev(`window.__seqh.load(window.__seqh.pattern({ all16: true, swing: 50 }))`);
    await ev(`(() => { try { if (typeof avApplyParam === 'function') avApplyParam('filter.cutoff', ${JSON.stringify(BASE)}); } catch (e) { } return true; })()`);
  }

  /* ── 10. UNDO/REDO: click-edit → undo restores → redo reapplies ── */
  {
    const hasUndo = (await ev(`typeof avUndo === 'function' && typeof avRedo === 'function'`)).value === true;
    if (!hasUndo) {
      check('undo/redo: edit → undo restores → redo reapplies', false, 'F APIs missing (avUndo/avRedo)');
    } else {
      await stopTransport();
      await ev(`window.__seqh.load(window.__seqh.pattern({ onSteps: [0,2,4,6,8,10,12,14], swing: 50 }))`);
      await sleep(450);   /* let F's params-domain quiet snapshot settle */
      const snap0 = (await ev(`avSeqSnap()`)).value;
      const clicked = await clickSel('#av-seq-host .av-seq-cell[data-track="0"][data-step="1"]', 350);
      const snap1 = (await ev(`avSeqSnap()`)).value;
      const step1 = (snap1 && snap1.tracks && snap1.tracks[0] && snap1.tracks[0].steps) ? snap1.tracks[0].steps[1] : null;
      const editedOk = clicked === true && !!snap0 && !!snap1 && !!step1 && !deepEq(snap0, snap1) && step1.on === 1;
      const undoR = await ev(`(() => { try { return avUndo() === true; } catch (e) { return 'threw: ' + ((e && e.message) || e); } })()`);
      const snapU = (await ev(`avSeqSnap()`)).value;
      const undoOk = undoR.value === true && !!snapU && deepEq(snapU, snap0);
      /* repaint through the pinned UI API, then confirm the cell class followed */
      await ev(`avSeqUiSync()`);
      await sleep(120);
      const cellOff = (await ev(`(() => { const c = document.querySelector('#av-seq-host .av-seq-cell[data-track="0"][data-step="1"]'); return !!(c && !c.classList.contains('on')); })()`)).value;
      const redoR = await ev(`(() => { try { return avRedo() === true; } catch (e) { return 'threw: ' + ((e && e.message) || e); } })()`);
      const snapR2 = (await ev(`avSeqSnap()`)).value;
      const redoOk = redoR.value === true && !!snapR2 && deepEq(snapR2, snap1);
      check('undo/redo: real cell click edits (snap changes) → avUndo() restores pre-edit → avRedo() reapplies',
        editedOk && undoOk && redoOk,
        'edited=' + editedOk + ' · undo=' + JSON.stringify(undoR.value) + ' restore=' + (undoOk ? 'deep-equal' : 'DIFFERS') + ' · redo=' + JSON.stringify(redoR.value) + ' reapply=' + (redoOk ? 'deep-equal' : 'DIFFERS'));
      check('undo: UI repaint after avUndo() (cell .on follows the restored snapshot)', undoOk && cellOff === true, 'cell .on cleared=' + cellOff);
    }
  }

  /* ── 11. restore the witness patch (engine kind + kick decay) ── */
  await stopTransport();
  await ev(`(() => {
    try { if (typeof avApplyParam === 'function') avApplyParam('engine.kind', ${JSON.stringify(kindPrev)}); } catch (e) { }
    try { if (typeof avApplyParam === 'function' && ${kickPrev != null}) avApplyParam('drum.kick.decay', ${kickPrev != null ? kickPrev : 0.3}); } catch (e) { }
    return true;
  })()`);
  note('witness patch restored: engine.kind=' + JSON.stringify(kindPrev) + ' kick.decay=' + JSON.stringify(kickPrev));

  /* ── 12. zero page errors ── */
  check('zero page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* ── 13. screenshot renders/p4-seq-suite.png ── */
  await ev(`(() => { const el = document.getElementById('av-seq-host'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); return true; })()`);
  await sleep(250);
  const rectR2 = await ev(`(() => { const el = document.getElementById('av-seq-host'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }; })()`);
  const rect = rectR2.value;
  let shotOk = false, shotInfo = 'no rect';
  if (rect && rect.w > 50 && rect.h > 50) {
    try {
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 2 }, captureBeyondViewport: true });
      const buf = Buffer.from(shot.data, 'base64');
      writeFileSync(shotPath, buf);
      shotOk = buf.length > 1000 && buf[0] === 0x89 && buf[1] === 0x50;
      shotInfo = buf.length + ' bytes · clip ' + Math.round(rect.w) + '×' + Math.round(rect.h) + ' @2x';
    } catch (e) { shotInfo = 'capture failed: ' + (e && e.message); }
  }
  check('screenshot: renders/p4-seq-suite.png (the sequencer card, scale 2)', shotOk, shotInfo);

  /* ── 14. freeze sha before/after ── */
  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after): ' + shaAfter);
  check('freeze: index.html sha256 before === after (unchanged by the run)', shaAfter === shaBefore, shaAfter);
  if (PIN) check('freeze: index.html sha256 = pinned', shaBefore === PIN && shaAfter === PIN, 'pinned ' + PIN.slice(0, 12) + '…');
  else note('EXPECT_SHA not pinned — after the P4 build, pass --sha <hex> or set the constant (never loosen)');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { ws.close(); } catch { /* done */ }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('seq harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    /* profile-scoped cleanup (LAW): kill ONLY processes whose command line carries OUR temp
       profile — matched by its unique basename, so the pattern needs no backslash escaping */
    const tag = path.basename(profile);
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
