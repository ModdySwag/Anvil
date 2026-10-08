// cdp_sample.mjs — Anvil sample-core suite (P2 child D): import → decode → registry → waveform →
// preview, end-to-end over raw CDP against the frozen single-file build.
//
//   node verify/cdp_sample.mjs [path-to-index.html] [--port N] [--sha <hex>]
//
// Launch skeleton follows cdp_smoke.mjs VERBATIM (candidates Chrome/Edge/Brave, free-port scan,
// fresh temp --user-data-dir, 1440×900 device metrics override — Edge headless ignores
// --window-size, --mute-audio, --autoplay-policy=no-user-gesture-required, ONE browser, explicit
// exit, process.on('exit') kills ONLY processes whose command line carries OUR temp profile).
// SHA freeze discipline from cdp_midi.mjs: index.html is sha256'd before and after the run and the
// two must match. EXPECT_SHA may be pinned by the parent (constant below) or passed with --sha
// <hex>; while it is null the rig still enforces before === after and says so.
//
// WHAT IT PROVES (in order):
//   1. boot contract (data-av-ready) + the sample core loaded (avSampleStore + API + cap 32)
//      + the card mounted into the parent-owned #av-sample-host.
//   2. a KNOWN WAV is generated in-page (2.0 s · 440 Hz sine + deterministic seeded noise · mono
//      44.1 k) and imported through the REAL drop path (DataTransfer → DragEvent on the drop zone;
//      the file-input fallback only if the browser cannot synthesize the drop, and the path used is
//      logged either way).
//   3. the decoded entry appears with name kept · duration 2.0 s ±1% · mono at the decode rate ·
//      peaks present and NON-FLAT (envelope amplitude + loud-bucket share read from the entry).
//   4. the row's waveform canvas is HiDPI-correct (backing = CSS × dpr, refit idempotent) and has
//      real ink (pixel probe, not a vibes check).
//   5. PREVIEW: the row's PREVIEW button is clicked (real input path). The rig's OWN AnalyserNode
//      sits on the MASTER tap (avMasterFor(ctx) — panel reads are never witnesses): the one-shot
//      must be NON-SILENT with a dominant frequency ≈ 440 Hz (±5%) and a spectral peak well above
//      the floor. Because the witness taps the master node, a preview wired straight to
//      ctx.destination would read as silence and FAIL — the check is the tap law itself.
//      Controls: silence before the one-shot, and silence after it ends.
//   6. the file-input fallback path imports (0.4 s · 660 Hz) and a drop on the HOST element itself
//      imports too (0.3 s · 330 Hz); ✕ removes an entry from the registry AND the DOM.
//   7. zero page errors · screenshot renders/p2-sample-suite.png · freeze sha before/after.
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
   P2: the frozen sha of the rebuilt index.html is not known until build.py runs — the parent may
   fill this constant or pass --sha <hex>; the rig never loosens the before === after check. */
const EXPECT_SHA = '095b7e5d8dc07960cfc01f3410e905eb43e8cb97dbe00029e5fc4705246b5085';
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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9400);
const profile = path.join(tmpdir(), 'anvil-sample-' + Date.now());
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

/* ---------- page-side scaffolding injected at runtime (rig-owned; never app code) ----------
   The WAV generator builds a valid 16-bit mono PCM WAV with a SEEDED noise floor (deterministic);
   the witness API owns an AnalyserNode on the master tap and max-holds both the time-domain RMS
   and the per-bin dB spectrum while armed. */
const MAKE_WAV = (key, name, secs, freq, amp, noise) => `(() => {
  const sr = 44100, n = Math.round(sr * ${secs});
  const data = new Int16Array(n);
  let seed = 1234567 >>> 0;
  for (let i = 0; i < n; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const r = (seed / 4294967296) * 2 - 1;
    const s = ${amp} * Math.sin(2 * Math.PI * ${freq} * i / sr) + ${noise} * r;
    data[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
  }
  const bytes = new ArrayBuffer(44 + data.length * 2);
  const dv = new DataView(bytes);
  const ws = (off, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(off + i, str.charCodeAt(i)); };
  ws(0, 'RIFF'); dv.setUint32(4, 36 + data.length * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  ws(36, 'data'); dv.setUint32(40, data.length * 2, true);
  new Int16Array(bytes, 44).set(data);
  window.__rigFiles = window.__rigFiles || {};
  window.__rigFiles[${JSON.stringify(key)}] = new File([bytes], ${JSON.stringify(name)}, { type: 'audio/wav' });
  return { key: ${JSON.stringify(key)}, name: ${JSON.stringify(name)}, frames: n, bytes: 44 + n * 2 };
})()`;

const WITNESS_SETUP = `(() => {
  if (window.__witnessAPI && window.__witnessAPI.v === 1) return { ok: true, cached: true };
  const API = { v: 1, W: null, ctx: null };
  API.arm = function (ctx) {
    API.stop();
    const master = (typeof avMasterFor === 'function') ? avMasterFor(ctx) : null;
    if (!master) return { ok: false, why: 'no master tap node for this ctx' };
    const an = ctx.createAnalyser();
    an.fftSize = 16384;
    an.smoothingTimeConstant = 0;
    master.connect(an);
    const W = {
      an: an, sr: ctx.sampleRate,
      td: new Float32Array(2048), fd: new Float32Array(an.frequencyBinCount),
      spec: new Float32Array(an.frequencyBinCount),
      rmsMax: 0, rmsNow: 0, frames: 0, loudFrames: 0, firstLoud: 0, lastLoud: 0, on: true,
    };
    for (let i = 0; i < W.spec.length; i++) W.spec[i] = -Infinity;
    API.W = W; API.ctx = ctx;
    const tick = () => {
      if (!W.on) return;
      try {
        W.an.getFloatTimeDomainData(W.td);
        let s = 0;
        for (let i = 0; i < W.td.length; i++) s += W.td[i] * W.td[i];
        const rms = Math.sqrt(s / W.td.length);
        W.rmsNow = rms;
        if (rms > W.rmsMax) W.rmsMax = rms;
        W.an.getFloatFrequencyData(W.fd);
        for (let i = 0; i < W.fd.length; i++) { const v = W.fd[i]; if (v > W.spec[i]) W.spec[i] = v; }
        if (rms > 0.02) {
          W.loudFrames++;
          const now = performance.now();
          if (!W.firstLoud) W.firstLoud = now;
          W.lastLoud = now;
        }
        W.frames++;
      } catch (e) { /* analyser gone */ }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return { ok: true, sr: W.sr, binHz: W.sr / W.an.fftSize, fft: W.an.fftSize };
  };
  API.reset = function () {
    const W = API.W;
    if (!W) return false;
    W.rmsMax = 0; W.rmsNow = 0; W.frames = 0; W.loudFrames = 0; W.firstLoud = 0; W.lastLoud = 0;
    for (let i = 0; i < W.spec.length; i++) W.spec[i] = -Infinity;
    return true;
  };
  API.read = function () {
    const W = API.W;
    if (!W) return null;
    const binHz = W.sr / W.an.fftSize;
    const lo = Math.max(1, Math.floor(80 / binHz)), hi = Math.min(W.spec.length - 1, Math.ceil(4000 / binHz));
    let bi = -1, bv = -Infinity;
    for (let i = lo; i <= hi; i++) if (W.spec[i] > bv) { bv = W.spec[i]; bi = i; }
    let lit = 0;
    for (let i = 0; i < W.spec.length; i++) if (W.spec[i] > -90) lit++;
    return {
      sr: W.sr, binHz: binHz, fft: W.an.fftSize, frames: W.frames,
      rmsMax: W.rmsMax, rmsNow: W.rmsNow, loudFrames: W.loudFrames,
      loudSpanMs: (W.firstLoud && W.lastLoud) ? (W.lastLoud - W.firstLoud) : 0,
      peakHz: bi >= 0 ? bi * binHz : null,
      peakDB: isFinite(bv) ? bv : null,
      litBins: lit,
    };
  };
  API.stop = function () {
    const W = API.W;
    if (W) { W.on = false; try { W.an.disconnect(); } catch (e) { } }
    API.W = null; API.ctx = null;
    return true;
  };
  window.__witnessAPI = API;
  return { ok: true };
})()`;

/* ---------- drop / input simulators (the REAL paths the module binds) ---------- */
const DROP_ON = (fileKey, sel) => `(() => {
  const file = window.__rigFiles[${JSON.stringify(fileKey)}];
  const zone = document.querySelector(${JSON.stringify(sel)});
  if (!file) return { ok: false, why: 'no rig file ' + ${JSON.stringify(fileKey)} };
  if (!zone) return { ok: false, why: 'no drop target ' + ${JSON.stringify(sel)} };
  let pathUsed = 'drop', err = null;
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  } catch (e) {
    err = String((e && e.message) || e);
    pathUsed = 'input-fallback';
    try {
      const input = document.querySelector('#av-sample-host [data-av-sample-input]');
      if (!input) return { ok: false, why: 'no file input for fallback (drop said: ' + err + ')' };
      const dt2 = new DataTransfer();
      dt2.items.add(file);
      input.files = dt2.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e2) {
      return { ok: false, why: 'drop failed: ' + err + ' · fallback failed: ' + String((e2 && e2.message) || e2) };
    }
  }
  return { ok: true, path: pathUsed, err: err };
})()`;

const INPUT_IMPORT = (fileKey) => `(() => {
  const file = window.__rigFiles[${JSON.stringify(fileKey)}];
  const input = document.querySelector('#av-sample-host [data-av-sample-input]');
  if (!file) return { ok: false, why: 'no rig file ' + ${JSON.stringify(fileKey)} };
  if (!input) return { ok: false, why: 'no file input' };
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
  return { ok: true };
})()`;

const shotPath = path.join(here, '..', 'renders', 'p2-sample-suite.png');

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
  const until = async (expr, ms = 3000, step = 100) => {
    const t0 = Date.now();
    for (;;) {
      const r = await ev(expr);
      if (r.value === true) return true;
      if (Date.now() - t0 > ms) return false;
      await sleep(step);
    }
  };
  const clickSel = async (sel, after = 300) => {
    const found = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; if (e.scrollIntoView) e.scrollIntoView({ block: 'center', inline: 'center' }); return true; })()`);
    if (found.value !== true) { note('click target missing: ' + sel); return false; }
    await sleep(200);
    const boxR = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width || !r.height) return null; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight }; })()`);
    const b = boxR.value;
    if (!b) { note('click target not visible: ' + sel); return false; }
    if (b.top < 0 || b.bottom > b.vh) note('click target partly off-screen (' + b.top + '..' + b.bottom + ' of ' + b.vh + '): ' + sel);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
    await sleep(after);
    return true;
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

  const coreR = await ev(`(() => ({
    store: typeof avSampleStore === 'object' && avSampleStore.version === 'p2.0',
    api: typeof avSampleImportFiles === 'function' && typeof avSampleDrawWaveform === 'function' && typeof avSamplePreview === 'function' && typeof avSampleInit === 'function',
    handle: window.__avSample === avSampleStore && typeof avSampleStore.snap === 'function',
    cap: avSampleStore.max,
    count: avSampleStore.snap().count,
    inited: avSampleStore.inited === true,
  }))()`);
  const core = coreR.value || {};
  check('sample core mounted: avSampleStore + API + handle + ≤32 cap', core.store === true && core.api === true && core.handle === true && core.cap === 32 && core.count === 0 && core.inited === true, JSON.stringify(core));

  let hostOk = false;
  for (let i = 0; i < 100 && !hostOk; i++) {
    const r = await ev(`!!(document.getElementById('av-sample-host') && document.querySelector('#av-sample-host [data-av-sample-drop]') && document.querySelector('#av-sample-host [data-av-sample-input]') && document.querySelector('#av-sample-host [data-av-sample-list]'))`);
    if (r.value === true) { hostOk = true; break; }
    await sleep(150);
  }
  check('sample card mounted: #av-sample-host + drop zone + file input + list', hostOk);
  if (!hostOk) { console.error('SAMPLE HOST MISSING — parent adds #av-sample-host and calls avSampleInit()'); process.exit(1); }

  /* engine readiness is a NOTE here (preview prefers the engine ctx; the witness re-arms on
     whatever ctx the preview actually used, so the rig still works on the spn/fallback path) */
  let engReady = false;
  for (let i = 0; i < 80 && !engReady; i++) {
    const r = await ev(`!!(window.__avEngine && window.__avEngine.ready === true)`);
    if (r.value === true) { engReady = true; break; }
    await sleep(200);
  }
  note(engReady ? 'engine ready — preview will ride its context' : 'engine NOT ready after 16 s — witness will attach to the preview’s fallback ctx');

  /* ── 2. rig file A: 2.0 s of 440 Hz sine + seeded noise, imported via the real drop path ── */
  const wavA = await ev(MAKE_WAV('rigA', 'rig-440-noise.wav', 2.0, 440, 0.5, 0.05));
  check('rig WAV A generated in-page (2.0 s · 440 Hz · noise · 176,444 bytes)', !!wavA.value && wavA.value.frames === 88200 && wavA.value.bytes === 176444, JSON.stringify(wavA.value));

  const dropA = await ev(DROP_ON('rigA', '#av-sample-host [data-av-sample-drop]'));
  check('import A: dispatched through the real drop path', !!dropA.value && dropA.value.ok === true, JSON.stringify(dropA.value));
  if (dropA.value && dropA.value.path !== 'drop') note('drop synthesis unavailable — the input fallback carried import A (' + dropA.value.err + ')');

  let importedA = false;
  for (let i = 0; i < 80 && !importedA; i++) {
    const r = await ev(`avSampleStore.entries.length === 1`);
    if (r.value === true) { importedA = true; break; }
    await sleep(100);
  }
  check('import A: decoded entry appears in the registry', importedA, importedA ? '' : ('lastError=' + JSON.stringify((await ev('avSampleStore.lastError')).value)));
  if (!importedA) { console.error('import A never landed — aborting run'); process.exit(1); }

  const e1R = await ev(`(() => {
    const e = avSampleStore.entries[0];
    if (!e) return null;
    const pk = e.peaks || {}; const n = pk.n || 0; const mn = pk.min, mx = pk.max;
    let amp = 0, loud = 0, spread = 0, lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = mn[i], b = mx[i];
      const v = Math.max(a < 0 ? -a : a, b < 0 ? -b : b);
      if (v > amp) amp = v;
      if (b - a > 0.05) loud++;
      if (b - a > spread) spread = b - a;
      if (a < lo) lo = a; if (b > hi) hi = b;
    }
    const h = window.__avEngine;
    const ctxSr = (h && h.ready && h.handle && h.handle.ctx) ? h.handle.ctx.sampleRate : null;
    return {
      id: e.id, name: e.name, duration: e.duration, sampleRate: e.sampleRate, channels: e.channels,
      frames: e.buffer ? e.buffer.length : null, bufSr: e.buffer ? e.buffer.sampleRate : null, ctxSr: ctxSr,
      peaksN: n, amp: amp, spread: spread, loudBuckets: loud,
      row: !!document.querySelector('#av-sample-host [data-av-sample-row="' + e.id + '"]'),
      canvas: !!document.querySelector('#av-sample-host canvas[data-av-sample-canvas="' + e.id + '"]'),
      previewBtn: !!document.querySelector('#av-sample-host [data-av-sample-preview="' + e.id + '"]'),
    };
  })()`);
  const e1 = e1R.value || {};
  const idA = e1.id;
  check('entry A: name kept', e1.name === 'rig-440-noise.wav', 'name=' + e1.name);
  check('entry A: duration 2.00 s ±1% (decoded, honest)', isFinite(e1.duration) && Math.abs(e1.duration - 2.0) <= 0.02, 'duration=' + e1.duration);
  check('entry A: mono, decoded at a sane rate (ctx rate when the engine is up)', e1.channels === 1 && e1.sampleRate >= 8000 && (e1.ctxSr == null || e1.sampleRate === e1.ctxSr) && e1.sampleRate === e1.bufSr, 'sr=' + e1.sampleRate + ' ctxSr=' + e1.ctxSr + ' ch=' + e1.channels);
  check('entry A: peaks present + NON-FLAT (amp > 0.2, most buckets carrying signal)', e1.peaksN >= 64 && e1.amp > 0.2 && e1.amp <= 1.0 && e1.loudBuckets > e1.peaksN * 0.5, 'n=' + e1.peaksN + ' amp=' + (e1.amp || 0).toFixed(3) + ' loud=' + e1.loudBuckets + '/' + e1.peaksN + ' spread=' + (e1.spread || 0).toFixed(3));
  check('UI: row + waveform canvas + PREVIEW button mounted for entry A', e1.row === true && e1.canvas === true && e1.previewBtn === true, JSON.stringify({ row: e1.row, canvas: e1.canvas, previewBtn: e1.previewBtn }));

  /* ── 3. waveform canvas: HiDPI backing + real ink ── */
  const cv2R = await ev(`(() => {
    const e = avSampleStore.entries[0];
    if (!e) return null;
    const cv = document.querySelector('#av-sample-host canvas[data-av-sample-canvas="' + e.id + '"]');
    if (!cv) return { ok: false, why: 'no canvas' };
    const dpr = window.devicePixelRatio || 1;
    const wantW = Math.round(cv.clientWidth * dpr), wantH = Math.round(cv.clientHeight * dpr);
    let lit = 0, total = 0;
    try {
      const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 3; i < px.length; i += 4) { total++; if (px[i] > 0) lit++; }
    } catch (err) { return { ok: false, why: 'getImageData failed: ' + String((err && err.message) || err) }; }
    return { ok: true, w: cv.width, h: cv.height, cssW: cv.clientWidth, cssH: cv.clientHeight, dpr: dpr, wantW: wantW, wantH: wantH, lit: lit, total: total };
  })()`);
  const cv = cv2R.value || {};
  check('waveform: backing = CSS box × dpr (HiDPI law) + real ink', cv.ok === true && cv.w === cv.wantW && cv.h === cv.wantH && cv.cssW > 50 && cv.lit > cv.total * 0.02 && cv.lit < cv.total * 0.95, JSON.stringify(cv));

  /* ── 4. witness + preview ── */
  await ev(WITNESS_SETUP);
  const armR = await ev(`(() => {
    const h = window.__avEngine;
    const ctx = (h && h.ready === true && h.handle && h.handle.ctx) ? h.handle.ctx : null;
    if (!ctx) return { ok: false, why: 'engine ctx not ready' };
    return window.__witnessAPI.arm(ctx);
  })()`);
  const preArmed = !!(armR.value && armR.value.ok === true);
  if (preArmed) {
    await sleep(300);
    const baseR = await ev(`window.__witnessAPI.read()`);
    const base = baseR.value || {};
    check('preview: baseline silent on the master tap before the one-shot', base.rmsMax < 0.005, 'rmsMax=' + base.rmsMax);
    await ev(`window.__witnessAPI.reset()`);
  } else {
    note('witness not pre-armed (' + ((armR.value && armR.value.why) || '?') + ') — it attaches to the preview ctx right after the click');
  }

  const clickedPrompt = await clickSel(`#av-sample-host [data-av-sample-preview="${idA}"]`, 0);
  const started = await until(`(() => { const lp = avSampleStore.lastPreview; return !!(lp && lp.id === ${JSON.stringify(idA)}); })()`, 1500, 50);
  check('preview: PREVIEW button click starts the one-shot (lastPreview id match)', clickedPrompt === true && started === true);

  const idR = await ev(`(() => {
    const st = avSampleStore;
    const lp = st.lastPreview;
    if (!lp || !lp.ctx) return { ok: false, why: 'no lastPreview' };
    const W = window.__witnessAPI;
    if (W.ctx === lp.ctx) return { ok: true, same: true };
    const r = W.arm(lp.ctx);
    return { ok: r.ok === true, same: false, why: r.why || null };
  })()`);
  const wId = idR.value || {};
  check('witness: own AnalyserNode armed on the master tap of the preview ctx', wId.ok === true, wId.same ? 'same ctx as pre-arm' : ('re-armed on the preview ctx' + (wId.why ? ' · ' + wId.why : '')));
  if (!wId.ok) note('witness could not attach (' + (wId.why || '?') + ') — the audio checks below will FAIL rather than fabricate a pass');

  const ended = await until(`avSampleStore.active === null`, 6000, 100);
  note(ended ? 'one-shot ended (lastPreview duration ≈ 2 s)' : 'one-shot still marked active after 6 s');
  await sleep(150);
  const w1R = await ev(`window.__witnessAPI.read()`);
  const w1 = w1R.value || {};
  check('preview WITNESSED on the master tap: NON-SILENT (own AnalyserNode, never panel reads)', w1.rmsMax > 0.05 && w1.frames >= 10, 'rmsMax=' + w1.rmsMax + ' frames=' + w1.frames + ' loudFrames=' + w1.loudFrames);
  const hzOk = isFinite(w1.peakHz) && Math.abs(w1.peakHz - 440) <= 440 * 0.05;
  check('preview WITNESSED: dominant frequency ≈ 440 Hz (±5%)', hzOk, 'peakHz=' + w1.peakHz + ' (bin ' + (w1.binHz || 0).toFixed(2) + ' Hz · fft ' + w1.fft + ')');
  check('preview WITNESSED: spectral peak well above the floor', isFinite(w1.peakDB) && w1.peakDB > -60, 'peakDB=' + w1.peakDB + ' dB · lit bins=' + w1.litBins);
  check('preview: one-shot span ≈ 2 s (loud window 1.5–2.6 s)', w1.loudSpanMs >= 1500 && w1.loudSpanMs <= 2600, 'span=' + Math.round(w1.loudSpanMs) + ' ms');
  await sleep(350);
  const w2R = await ev(`window.__witnessAPI.read()`);
  const w2 = w2R.value || {};
  check('preview: silence after the one-shot ends (control)', isFinite(w2.rmsNow) && w2.rmsNow < 0.01, 'rmsNow=' + w2.rmsNow);
  await ev(`window.__witnessAPI.stop()`);

  /* ── 5. the file-input fallback path + a drop on the HOST element itself ── */
  const wavB = await ev(MAKE_WAV('rigB', 'rig-input-660.wav', 0.4, 660, 0.4, 0));
  const inB = await ev(INPUT_IMPORT('rigB'));
  const gotB = await until(`avSampleStore.entries.length === 2`, 6000, 100);
  check('import B (file-input fallback path): entry added', !!(wavB.value) && !!inB.value && inB.value.ok === true && gotB === true, JSON.stringify(inB.value));
  const eBR = await ev(`(() => { const e = avSampleStore.entries[1]; return e ? { id: e.id, name: e.name, duration: e.duration } : null; })()`);
  const eB = eBR.value || {};
  check('import B: entry identity (name kept, 0.4 s ±10%)', eB.name === 'rig-input-660.wav' && isFinite(eB.duration) && Math.abs(eB.duration - 0.4) <= 0.04, JSON.stringify(eB));

  const wavC = await ev(MAKE_WAV('rigC', 'rig-host-330.wav', 0.3, 330, 0.4, 0));
  const dropC = await ev(DROP_ON('rigC', '#av-sample-host'));
  const gotC = await until(`avSampleStore.entries.length === 3`, 6000, 100);
  check('import C (drop onto #av-sample-host itself): entry added', !!(wavC.value) && !!dropC.value && dropC.value.ok === true && gotC === true, JSON.stringify(dropC.value));
  const eCR = await ev(`(() => { const e = avSampleStore.entries[2]; return e ? { id: e.id, name: e.name } : null; })()`);
  const idC = (eCR.value || {}).id;
  check('import C: entry identity (name kept)', (eCR.value || {}).name === 'rig-host-330.wav', JSON.stringify(eCR.value));

  const removed = idC ? await clickSel(`#av-sample-host [data-av-sample-remove="${idC}"]`) : false;
  const goneC = await until(`avSampleStore.entries.length === 2`, 3000, 100);
  const goneR = await ev(`(() => ({
    byId: !!avSampleStore.byId[${JSON.stringify(idC)}],
    row: !!document.querySelector('#av-sample-host [data-av-sample-row="${idC}"]'),
    count: avSampleStore.snap().count,
  }))()`);
  const gone = goneR.value || {};
  check('registry: ✕ removes entry C from the DOM + the registry (count 3 → 2)', removed === true && goneC === true && gone.byId === false && gone.row === false && gone.count === 2, JSON.stringify(gone));

  /* ── 6. errors + screenshot + freeze ── */
  const snapR = await ev(`avSampleStore.snap()`);
  note('final sample snap: ' + JSON.stringify(snapR.value));

  check('zero page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await ev(`(() => { const el = document.getElementById('av-sample-host'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); return true; })()`);
  await sleep(250);
  const rectR = await ev(`(() => { const el = document.getElementById('av-sample-host'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }; })()`);
  const rect = rectR.value;
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
  check('screenshot: renders/p2-sample-suite.png (sample card, scale 2)', shotOk, shotInfo);

  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after): ' + shaAfter);
  check('freeze: index.html sha256 before === after (unchanged by the run)', shaAfter === shaBefore, shaAfter);
  if (PIN) check('freeze: index.html sha256 = pinned', shaBefore === PIN && shaAfter === PIN, 'pinned ' + PIN.slice(0, 12) + '…');
  else note('EXPECT_SHA not pinned — after the P2 build, pass --sha <hex> or set the constant (never loosen)');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { ws.close(); } catch { /* done */ }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('sample harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    /* profile-scoped cleanup (LAW): kill ONLY processes whose command line carries OUR temp
       profile — matched by its unique basename, so the pattern needs no backslash escaping */
    const tag = path.basename(profile);
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
