// Verify the PACKAGED Anvil Windows app -- the real .exe, not the source file.
//
//   node windows/tools/test_desktop_app.mjs                       # the staged build
//   node windows/tools/test_desktop_app.mjs --exe "<installed>\Anvil.exe"
//   node windows/tools/test_desktop_app.mjs --cdp 9357 --dl <dir>
//
// It launches the exe with a CDP endpoint, drives the running app over the protocol, and checks
// what only the packaged build can prove: the loopback origin, the desktop marker, ANVIL.version,
// the worklet engine tier with 64+ voices, a note PLAYED through the app's own note path
// (avNoteDown) and witnessed by the rig's OWN AnalyserNode on the master tap (the cdp_sample
// seam -- panel reads are never witnesses), Web MIDI permission, the R22 library overlay
// (__avLibrary snap + chrome), the 15-button header fit law, the library EXP download landing
// through the shell's will-download hook, and zero page errors.
//
// Every check prints ok/FAIL with its evidence; the run ends with ONE DESKTOP-RESULT line; the
// exit code is 0 only when every check passed.
//
// HOOK NAMING: the Anvil shell (windows/app/main.js, D1) was not on disk when this rig was
// authored. The PF reference shell uses PF_TEST / PF_DEBUG_PORT / PF_DL_DIR / PF_OFFLINE /
// PF_PORT; the Resonance shell uses RS_*. This rig therefore sets BOTH plausible Anvil prefixes
// on the spawn -- AV_* (matching the app's own __AV_DESKTOP / __avEngine / __avLibrary family,
// and the contract's "APP_DEBUG_PORT prefix-adjusted" wording) AND ANVIL_* -- so the shell picks
// up whichever it defines. Extra env vars are inert for a shell that does not read them; the
// parent reconciles the exact name when D1's main.js lands.
//
// This rig runs the app under the single-instance lock: if an Anvil window is ALREADY open on
// this machine, a fresh launch hands focus to it and the CDP endpoint never appears -- close any
// running Anvil first.
//
// NOTE: this rig drives the app's own paths only (avNoteDown/avNoteUp, __avLibrary facade,
// __avImport facade). It never reaches into module internals beyond the pinned observables.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WIN = path.join(HERE, '..');                       // <repo>/windows
let VERSION = {};
try { VERSION = JSON.parse(readFileSync(path.join(WIN, 'version.json'), 'utf8')); }
catch (e) { /* D2 owns version.json; the 1.15.0 pin is asserted regardless */ }

const argv = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const EXE = argVal('--exe', path.join(WIN, 'stage', 'Anvil', 'Anvil.exe'));
const CDP = Number(argVal('--cdp', '9356'));
const DL = argVal('--dl', path.join(WIN, 'tmp-dl-desktop'));

if (!existsSync(EXE)) { console.error('app not found: ' + EXE + ' -- stage it first (windows/tools/build_windows.py)'); process.exit(2); }

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  ok ? pass++ : fail++;
  console.log((ok ? ' ok  ' : ' FAIL') + ' ' + label + (detail ? '  -- ' + detail : ''));
};
const note = (t) => console.log('   - ' + t);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const filesIn = (dir, ext) => (existsSync(dir) ? readdirSync(dir).filter(f => f.toLowerCase().endsWith(ext)).map(f => path.join(dir, f)) : []);

// ---------------------------------------------------------------- the app under test
class DesktopApp {
  constructor() { this.proc = null; this.ws = null; this.id = 0; this.pending = new Map(); this.out = ''; this.errors = []; this.exceptions = []; }

  start(extraEnv = {}) {
    if (!existsSync(EXE)) throw new Error('app not found: ' + EXE);
    this.out = ''; this.errors = []; this.exceptions = [];
    /* AV_* and ANVIL_* are co-set (see the header note). windowsHide: true everywhere -- the
       no-console-windows law (the PF reference rig passed false; named deviation). */
    this.proc = spawn(EXE, [], {
      env: {
        ...process.env,
        AV_TEST: '1', ANVIL_TEST: '1',
        AV_DEBUG_PORT: String(CDP), ANVIL_DEBUG_PORT: String(CDP),
        AV_DL_DIR: DL, ANVIL_DL_DIR: DL,
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const tap = (d) => { const s = d.toString(); this.out += s; };
    this.proc.stdout.on('data', tap);
    this.proc.stderr.on('data', tap);
    return this;
  }

  log(needle) { return this.out.includes(needle); }

  async connect({ timeoutMs = 90000 } = {}) {
    let target = null;
    const t0 = Date.now();
    while (!target && Date.now() - t0 < timeoutMs) {
      try {
        const list = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json();
        target = list.find(t => t.type === 'page' && String(t.url).startsWith('http://127.0.0.1:')) || null;
      } catch (e) { /* not up yet */ }
      if (!target) await sleep(700);
    }
    if (!target) throw new Error('no CDP page target -- the app never opened its window (check the debug-port hook; see HOOK NAMING above)');
    this.target = target;
    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
        return;
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        this.exceptions.push(String((d.exception && (d.exception.description || d.exception.value)) || d.text || 'exception').slice(0, 300));
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push((m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
      }
    };
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    return this;
  }

  send(method, params = {}) {
    return new Promise((res, rej) => {
      const i = ++this.id;
      this.pending.set(i, { res, rej });
      this.ws.send(JSON.stringify({ id: i, method, params }));
    });
  }

  async ev(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) return { __ex: String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 300) };
    return r.result ? r.result.value : undefined;
  }

  async waitFor(expr, { timeoutMs = 90000, every = 500 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const v = await this.ev(expr);
      if (v === true) return true;
      await sleep(every);
    }
    return false;
  }

  async stop() {
    /* Graceful first: window.close() lets Chromium flush localStorage/IndexedDB before exit. */
    try { await this.ev('window.close()'); } catch (e) { /* connection can drop as it closes */ }
    const t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      if (!this.proc || this.proc.exitCode !== null) break;
      await sleep(400);
    }
    try { this.ws && this.ws.close(); } catch (e) { /* gone */ }
    if (this.proc && this.proc.pid && this.proc.exitCode === null) {
      spawnSync('taskkill', ['/PID', String(this.proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      await sleep(1500);
    }
    this.proc = null;
  }
}

/* ---------- page-side witness: the cdp_sample.mjs seam, copied verbatim ----------
   The rig's OWN AnalyserNode on the MASTER tap (avMasterFor(ctx) -- panel reads are never
   witnesses); max-holds both the time-domain RMS and the per-bin dB spectrum while armed. */
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

// ------------------------------------------------------------------------ the run
const app = new DesktopApp();
try {
  rmSync(DL, { recursive: true, force: true }); mkdirSync(DL, { recursive: true });
  console.log('\n== Anvil desktop app: ' + EXE);
  console.log('   cdp :' + CDP + ' | downloads -> ' + DL);
  if (!VERSION.version) note('windows/version.json not readable -- the 1.15.0 pin below is asserted from the wave contract (D2 owns the file)');

  app.start();
  await app.connect({ timeoutMs: 90000 });
  await app.waitFor('document.readyState === "complete"', { timeoutMs: 30000 });

  /* ---- shell + origin ---- */
  console.log('-- shell + origin');
  const info = await app.ev(`({
    href: location.href, secure: window.isSecureContext, title: document.title,
    desktop: window.__AV_DESKTOP === true,
    desktopVal: (typeof window.__AV_DESKTOP === 'object' && window.__AV_DESKTOP) ? window.__AV_DESKTOP : null,
    shell: (function () { try { const s = window.__AV_SHELL; return s ? { version: s.version || null, electron: s.electron || null, servePort: s.servePort || null } : null; } catch (e) { return null; } })(),
    worklet: typeof AudioWorkletNode === 'function',
  })`);
  const href = String((info && info.href) || '');
  const loop = href.indexOf('http://127.0.0.1:') === 0 && !href.startsWith('file:');
  const pagePort = Number(((href.split('://')[1] || '').split('/')[0] || '').split(':')[1]);
  check(loop, 'the app is served from the loopback server (not file://)', href);
  check(!!(info && info.secure === true && info.worklet === true), 'a secure context with AudioWorklet (the hosted-page path)');
  check(!!(info && info.desktop === true), '__AV_DESKTOP marker present (=== true)', JSON.stringify(info && (info.desktop ? 'true' : info.desktopVal)));
  check(!!(info && info.shell && Number(info.shell.servePort) === pagePort), '__AV_SHELL reports the serving port (version/electron reported)', JSON.stringify(info && info.shell));
  check((info && String(info.title || '').indexOf('Anvil') >= 0), 'the window carries the Anvil title', info && info.title);
  check(app.log('1.15.0'), 'the shell reports its build on stdout (tolerant: stdout mentions 1.15.0)');

  /* ---- boot contract ---- */
  console.log('-- boot');
  const ready = await app.waitFor(`document.documentElement && document.documentElement.getAttribute('data-av-ready') === '1'`, { timeoutMs: 120000, every: 400 });
  check(ready, 'boot: data-av-ready flips (the smoke contract)', ready ? '' : 'never became 1');
  if (!ready) throw new Error('the app never reached data-av-ready');

  const ver = await app.ev(`(() => { try { const A = window.ANVIL; return A ? { version: A.version, phase: A.phase, built: A.built } : null; } catch (e) { return { err: String(e) }; } })()`);
  check(!!(ver && ver.version === '1.15.0'), 'ANVIL.version reads 1.15.0 (the R22 freeze)', JSON.stringify(ver));
  if (VERSION.version && VERSION.version !== '1.15.0') note('windows/version.json carries ' + VERSION.version + ' -- reconcile against the 1.15.0 wave pin');

  /* ---- the engine: worklet tier, 64+ voices ---- */
  console.log('-- engine');
  let eng = null, nudged = false;
  const tEng = Date.now();
  while (Date.now() - tEng < 90000) {
    eng = (await app.ev(`(() => { const h = window.__avEngine; return h ? { ready: h.ready === true, tier: h.tier, url: h.url, sr: h.sr, maxVoices: h.maxVoices, os: h.os, err: h.error || null, ctx: !!(h.handle && h.handle.ctx) } : null; })()`)) || eng;
    if (eng && eng.ready === true) break;
    if (!nudged && Date.now() - tEng > 15000) {
      nudged = true;
      const nr = await app.ev(`(() => { try { if (typeof avEngineEnsure === 'function') { avEngineEnsure(); return 'nudged'; } } catch (e) { } return 'no-avEngineEnsure'; })()`);
      note('engine not ready after 15 s -- nudge: ' + nr);
    }
    await sleep(500);
  }
  check(!!(eng && eng.ready === true), 'the engine boots (__avEngine.ready)', JSON.stringify(eng));
  check(!!(eng && eng.tier === 'worklet'), 'the engine reports the worklet tier', 'tier=' + (eng && eng.tier) + ' url=' + (eng && eng.url) + ' err=' + (eng && eng.err));
  check(!!(eng && typeof eng.maxVoices === 'number' && eng.maxVoices >= 64), 'the engine carries 64+ voices (maxVoices)', 'maxVoices=' + (eng && eng.maxVoices) + ' sr=' + (eng && eng.sr));

  /* ---- a note through the app's own path, witnessed on the master tap ---- */
  console.log('-- note + master-tap witness');
  await app.ev(WITNESS_SETUP);
  const armR = await app.ev(`(() => {
    try {
      const h = window.__avEngine;
      if (!h || h.ready !== true || !h.handle || !h.handle.ctx) return { ok: false, why: 'engine ctx not ready' };
      if (!window.__witnessAPI || typeof window.__witnessAPI.arm !== 'function') return { ok: false, why: 'witness api missing' };
      return window.__witnessAPI.arm(h.handle.ctx);
    } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
  })()`);
  const armed = !!(armR && armR.ok === true);
  note('witness: ' + (armed ? ('armed on the master tap (' + JSON.stringify({ sr: armR.sr, binHz: armR.binHz, fft: armR.fft }) + ')') : ('NOT armed: ' + JSON.stringify(armR && (armR.why || armR)) + ' -- the audio checks below FAIL rather than fabricate a pass')));

  let base = null;
  if (armed) {
    await sleep(300);
    base = (await app.ev('window.__witnessAPI.read()')) || {};
    check(isFinite(base.rmsMax) && base.rmsMax < 0.005, 'witness baseline silent on the master tap before the note (control)', 'rmsMax=' + base.rmsMax);
    await app.ev('window.__witnessAPI.reset()');
  } else {
    check(false, 'witness baseline silent on the master tap before the note (control)', 'witness not armed');
  }

  const down = await app.ev(`(() => { try { return { ok: avNoteDown('a4', 1.0) === true, notes: (typeof window.__avNotes === 'function') ? window.__avNotes() : null }; } catch (e) { return { ok: false, err: String((e && e.message) || e) }; } })()`);
  check(!!(down && down.ok === true), "note: avNoteDown('a4') starts a note through the app's own note path", JSON.stringify(down && { ok: down.ok, held: down.notes && down.notes.held, sink: down.notes && down.notes.sink }));

  let flow = null;
  if (armed) {
    const tNote = Date.now();
    while (Date.now() - tNote < 3000) {
      const rd = (await app.ev('window.__witnessAPI.read()')) || {};
      if (typeof rd.rmsNow === 'number' && rd.rmsNow > 0.001) { flow = { ms: Date.now() - tNote, rmsNow: rd.rmsNow }; break; }
      await sleep(100);
    }
    await sleep(250);
  }
  const w1 = armed ? ((await app.ev('window.__witnessAPI.read()')) || {}) : {};
  check(armed && isFinite(w1.rmsMax) && w1.rmsMax > 0.01 && w1.frames >= 10,
    'note WITNESSED on the master tap: NON-SILENT (own AnalyserNode, never panel reads)',
    armed ? ('rmsMax=' + w1.rmsMax + ' frames=' + w1.frames + ' loudFrames=' + w1.loudFrames + (flow ? (' flow@' + flow.ms + 'ms rms=' + flow.rmsNow) : ' no-flow')) : 'witness not armed');
  check(armed && isFinite(w1.peakDB) && w1.peakDB > -70 && w1.litBins > 5,
    'note WITNESSED: spectral peak well above the floor',
    armed ? ('peakDB=' + w1.peakDB + ' lit bins=' + w1.litBins + ' peakHz=' + w1.peakHz) : 'witness not armed');
  check(armed && isFinite(w1.peakHz) && w1.peakHz >= 200 && w1.peakHz <= 1000,
    "note WITNESSED: dominant energy sits in the note's register (200-1000 Hz around a4=440)",
    armed ? ('peakHz=' + w1.peakHz + ' (bin ' + (w1.binHz || 0).toFixed(2) + ' Hz, fft ' + w1.fft + ')') : 'witness not armed');

  const up = await app.ev(`(() => { try { return { ok: avNoteUp('a4') === true }; } catch (e) { return { ok: false, err: String((e && e.message) || e) }; } })()`);
  check(!!(up && up.ok === true), 'note: avNoteUp releases the note', JSON.stringify(up));
  let sil = null;
  if (armed) {
    const tOff = Date.now();
    while (Date.now() - tOff < 6000) {
      const rd = (await app.ev('window.__witnessAPI.read()')) || {};
      if (typeof rd.rmsNow === 'number' && rd.rmsNow < 0.01) { sil = rd.rmsNow; break; }
      await sleep(150);
    }
  }
  check(armed && sil !== null, 'note: silence returns on the master tap after the release (control)', armed ? ('rmsNow=' + sil) : 'witness not armed');
  await app.ev(`(() => { try { if (typeof avNoteStopAll === 'function') avNoteStopAll(); } catch (e) { } try { window.__witnessAPI.stop(); } catch (e) { } return true; })()`);

  /* ---- Web MIDI (feature-detected; granted by the shell when present) ---- */
  console.log('-- Web MIDI');
  const midi = await app.ev(`(async () => {
    try {
      if (typeof navigator.requestMIDIAccess !== 'function') return { absent: true };
      const a = await navigator.requestMIDIAccess();
      return { granted: true, inputs: a.inputs.size, outputs: a.outputs.size, sysex: a.sysexEnabled, names: [...a.inputs.values()].map(p => p.name).slice(0, 4) };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  if (midi && midi.absent === true) {
    check(true, 'Web MIDI: navigator.requestMIDIAccess is absent -- check skipped by feature detection');
  } else {
    check(!!(midi && midi.granted === true), 'Web MIDI: navigator.requestMIDIAccess resolves (permission granted by the shell, no prompt)', JSON.stringify(midi));
  }

  /* ---- the R22 library overlay + the EXP download lane ---- */
  console.log('-- library (R22 overlay + EXP download)');
  const libBefore = await app.ev(`(() => {
    const L = window.__avLibrary;
    if (!L || typeof L.open !== 'function' || typeof L.snap !== 'function') return { present: false };
    return { present: true, version: L.version, before: L.snap() };
  })()`);
  const libOk = !!(libBefore && libBefore.present === true);
  check(libOk, 'library: the __avLibrary facade is present (version/open/snap)', JSON.stringify(libBefore && libBefore.version));

  if (!libOk) {
    check(false, 'the library overlay opens (snap.open, a real box)', 'no __avLibrary facade');
    check(false, 'the library overlay carries the R22 chrome (state normal, grip, real size)', 'no __avLibrary facade');
    check(false, 'library overlay: min/max buttons present and the pop is visible', 'no __avLibrary facade');
    check(false, 'library: a sample row exists for the EXP lane (imported via __avImport)', 'no __avLibrary facade');
    check(false, 'the library EXP action downloads through the shell (will-download -> DL dir, no dialog)', 'no __avLibrary facade');
    check(false, 'the downloaded file carries the library bytes (RIFF)', 'no __avLibrary facade');
    check(false, 'the library overlay closes (snap.open false)', 'no __avLibrary facade');
  } else {
    await app.ev(`(() => { try { window.__avLibrary.open(); } catch (e) { } return true; })()`);
    let snap = {}, snapOpen = false;
    const tL = Date.now();
    while (Date.now() - tL < 6000) {
      snap = (await app.ev('window.__avLibrary.snap()')) || {};
      if (snap.open === true && snap.w > 0) { snapOpen = true; break; }
      await sleep(150);
    }
    check(snapOpen, 'the library overlay opens (snap.open, a real box)', JSON.stringify(snap));
    check(snapOpen && snap.state === 'normal' && snap.grip === true && snap.w >= 200 && snap.h >= 200,
      'the library overlay carries the R22 chrome (state normal, grip, real size)', JSON.stringify(snap));
    const chrome = await app.ev(`(() => {
      const pop = document.getElementById('av-library-pop');
      return {
        pop: !!pop, hidden: pop ? pop.hidden === true : null,
        display: pop ? getComputedStyle(pop).display : null,
        min: !!document.getElementById('av-library-min'), max: !!document.getElementById('av-library-max'),
      };
    })()`);
    check(!!(chrome && chrome.pop === true && chrome.hidden === false && chrome.display !== 'none' && chrome.min === true && chrome.max === true),
      'library overlay: min/max buttons present and the pop is visible', JSON.stringify(chrome));

    /* a sample row is needed for the EXP lane; on a fresh profile import one through the app's
       own facade (avWavEncode + __avImport.importFiles -- the importer's own path). */
    let rows = await app.ev(`document.querySelectorAll('#av-library-body [data-av-import-lib], [data-av-import-lib]').length`);
    let importedSize = null;
    if (!rows) {
      const imp = await app.ev(`(async () => {
        try {
          if (!window.__avImport || typeof window.__avImport.importFiles !== 'function') return { ok: false, why: 'no __avImport.importFiles' };
          if (typeof avWavEncode !== 'function') return { ok: false, why: 'no avWavEncode' };
          const sr = 48000, n = sr;
          const l = new Float32Array(n), r = new Float32Array(n);
          for (let i = 0; i < n; i++) { const s = 0.5 * Math.sin(2 * Math.PI * 220 * i / sr); l[i] = s; r[i] = s; }
          const buf = avWavEncode({ l: l, r: r, sr: sr, bits: 16, dither: false });
          if (!buf) return { ok: false, why: 'avWavEncode refused' };
          const file = new File([buf], 'desktop-rig-220.wav', { type: 'audio/wav' });
          const ret = window.__avImport.importFiles([file]);
          if (ret && typeof ret.then === 'function') { try { await ret; } catch (e) { } }
          return { ok: true, bytes: buf.byteLength };
        } catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
      })()`);
      if (imp && imp.ok === true) importedSize = imp.bytes;
      note('library row import: ' + JSON.stringify(imp));
      const tRow = Date.now();
      while (Date.now() - tRow < 15000) {
        rows = await app.ev(`document.querySelectorAll('#av-library-body [data-av-import-lib], [data-av-import-lib]').length`);
        if (rows > 0) break;
        await sleep(500);
      }
    }
    check(rows > 0, 'library: a sample row exists for the EXP lane (imported via __avImport when missing)', 'rows=' + rows + (importedSize ? ' (fresh ' + importedSize + ' B import)' : ' (pre-existing)'));

    if (rows > 0) {
      const id = await app.ev(`(() => { const el = document.querySelector('[data-av-import-lib]'); return el ? el.getAttribute('data-av-import-lib') : null; })()`);
      if (!id) {
        check(false, 'the library EXP action downloads through the shell (will-download -> DL dir, no dialog)', 'row present but no row id read');
        check(false, 'the downloaded file carries the library bytes (RIFF)', 'no row id');
      } else {
        /* The shell exposes showSaveFilePicker (probed 2026-10-10) and this rig evaluates with
           userGesture: true -- with activation the app's picker leg is ALLOWED to show a native
           save dialog that no headless check can complete (exportItem returns ok, the picker
           promise pends, nothing lands). The chain under test is the download path the shell
           pins: anchor -> will-download -> DL dir, no dialog. Hide the picker for this leg (the
           cdp_s4 pickHideSave seam) and restore it right after. */
        await app.ev(`(() => { try { window.__rigPickSave = window.showSaveFilePicker; window.showSaveFilePicker = undefined; return true; } catch (e) { return false; } })()`);
        const expR = await app.ev(`(async () => { try { const ret = window.__avImport.exportItem(${JSON.stringify(id)}); if (ret && typeof ret.then === 'function') await ret; return { ok: true }; } catch (e) { return { ok: false, err: String((e && e.message) || e) }; } })()`);
        let dlFile = null;
        for (let i = 0; i < 40 && !dlFile; i++) {
          const hits = filesIn(DL, '.wav');
          if (hits.length) dlFile = hits[hits.length - 1];
          else await sleep(500);
        }
        await app.ev(`(() => { try { if (window.__rigPickSave) window.showSaveFilePicker = window.__rigPickSave; return typeof window.showSaveFilePicker; } catch (e) { return 'restore-failed'; } })()`);
        check(!!dlFile, 'the library EXP action downloads through the shell (will-download -> DL dir, no dialog)',
          dlFile ? path.basename(dlFile) + ' (' + statSync(dlFile).size + ' B)' : ('nothing landed in ' + DL + ' exportRet=' + JSON.stringify(expR)));
        if (dlFile) {
          const b = readFileSync(dlFile);
          const riff = b.length > 44 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE';
          const sizeOk = importedSize == null ? b.length > 44 : b.length === importedSize;
          check(riff && sizeOk, 'the downloaded file carries the library bytes (RIFF/WAVE; size matches the import when fresh)',
            path.basename(dlFile) + ' ' + b.length + ' B' + (importedSize != null ? (' == import ' + importedSize + ' B') : ' (pre-existing row)'));
        } else {
          check(false, 'the downloaded file carries the library bytes (RIFF)', 'no file to read');
        }
        note('the app recorded its own download metadata: ' + JSON.stringify(await app.ev('window.__avDeliverLastDownload || null')));
      }
    } else {
      check(false, 'the library EXP action downloads through the shell (will-download -> DL dir, no dialog)', 'no library row and the import did not land one');
      check(false, 'the downloaded file carries the library bytes (RIFF)', 'no row');
    }

    await app.ev(`(() => { try { window.__avLibrary.close(); } catch (e) { } return true; })()`);
    let closed = false;
    for (let i = 0; i < 40 && !closed; i++) {
      const s = (await app.ev('window.__avLibrary.snap()')) || {};
      closed = s.open === false;
      if (!closed) await sleep(120);
    }
    check(closed, 'the library overlay closes (snap.open false)');
  }

  /* ---- the header fit law: 15 buttons, no overlap, no clipped labels ---- */
  console.log('-- header (fit law)');
  const fit = await app.ev(`(() => {
    const head = document.querySelector('header.av-head.av-console') || document.querySelector('header.av-head');
    if (!head) return { err: 'no header' };
    const btns = [];
    const all = head.querySelectorAll('button');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!(r.width > 0 && r.height > 0) || cs.visibility === 'hidden' || cs.display === 'none') continue;
      btns.push({ id: el.id || String(el.textContent || '').trim().slice(0, 18), x: r.left, y: r.top, w: r.width, h: r.height, sw: el.scrollWidth, cw: el.clientWidth });
    }
    const hits = [];
    for (let i = 0; i < btns.length; i++) {
      for (let j = i + 1; j < btns.length; j++) {
        const a = btns[i], b = btns[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 2 && oy > 2) hits.push((a.id || '?') + ' X ' + (b.id || '?'));
      }
    }
    const spill = btns.filter(function (b) { return b.sw > b.cw + 1; }).map(function (b) { return b.id || '?'; });
    return { n: btns.length, hits: hits, spill: spill, ids: btns.map(function (b) { return b.id; }), innerW: window.innerWidth, innerH: window.innerHeight };
  })()`);
  check(!!(fit && fit.n === 15), 'the header renders 15 buttons (the fit law)', fit ? ('visible=' + fit.n + ' at ' + fit.innerW + 'x' + fit.innerH) : 'header read failed');
  check(!!(fit && Array.isArray(fit.hits) && fit.hits.length === 0 && Array.isArray(fit.spill) && fit.spill.length === 0),
    'the header buttons fit their boxes and do not overlap (fit law)', fit ? JSON.stringify({ hits: fit.hits, spill: fit.spill }) : 'header read failed');

  /* ---- zero page errors ---- */
  console.log('-- errors');
  check(app.exceptions.length === 0, 'zero uncaught exceptions during the run', app.exceptions.slice(0, 3).join(' | '));
  check(app.errors.length === 0, 'zero console errors during the run', app.errors.slice(0, 3).join(' | '));

  console.log('\n-- summary: ' + pass + ' passed, ' + fail + ' failed');
} catch (e) {
  fail++;
  console.log('\n FATAL ' + (e && e.stack ? String(e.stack).split('\n')[0] : e));
} finally {
  await app.stop();
}
console.log(fail
  ? ('\nDESKTOP-RESULT: RED -- ' + fail + ' of ' + (pass + fail) + ' checks failed (exit 1)')
  : ('\nDESKTOP-RESULT: GREEN -- all ' + pass + ' checks passed (exit 0)'));
process.exit(fail ? 1 : 0);
