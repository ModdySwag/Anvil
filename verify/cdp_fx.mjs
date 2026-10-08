// cdp_fx.mjs — Anvil P3 FX rack suite (child D's rig; WRITTEN by child D, RUN BY THE PARENT
// after integration). End-to-end over raw CDP against the frozen single-file build.
//
//   node verify/cdp_fx.mjs [path-to-index.html] [--port N] [--sha <hex>]
//
// Launch skeleton follows cdp_smoke.mjs VERBATIM (candidates Chrome/Edge/Brave, free-port scan,
// fresh temp --user-data-dir, 1440×900 device metrics override — Edge headless ignores
// --window-size, --mute-audio, --autoplay-policy=no-user-gesture-required, ONE browser, explicit
// exit, process.on('exit') kills ONLY processes whose command line carries OUR temp profile).
// SHA freeze discipline from cdp_midi.mjs / cdp_sample.mjs: index.html is sha256'd before and
// after the run and the two must match. EXPECT_SHA may be pinned by the parent (constant below)
// or passed with --sha <hex>; while it is null the rig still enforces before === after.
//
// WHAT IT PROVES, in order (contract: verify/_p3_wave.md §7 bullet 1 + §2/§3 pins):
//   1. boot contract (data-av-ready) + the rack card mounted into the parent-owned #av-fx-host:
//      card root, FIVE strips in the pinned order drive → mod → delay → verb → dyn, every knob
//      bound (data-knob-bound), every toggle/select bound (data-fx-bound), host wired marker,
//      exports live (avFxInit/avFxSnap/avFxClasses/avFxInventory + window.__avFx).
//   1b. absent-host contract: with #av-fx-host detached avFxInit() returns false WITHOUT throwing;
//      re-attaching the host and calling avFxInit() re-mounts the card (7 strips, all re-bound).
//   2. REAL input: a real CDP mouse click on the VERB toggle enables the module (mirror +
//      aria-pressed + strip .av-fx-on), and a real CDP drag on the VERB MIX knob lands it on 1
//      (mirror 1, aria-valuenow 1, readout 100%).
//   3. REVERB TAIL WITNESS: the rig's OWN AnalyserNode sits on the master tap (avMasterFor —
//      panel reads are never witnesses). avNoteDown('c4', 1.0) → hold → avNoteUp('c4'); the
//      control window BEFORE the note is silent (< 0.005 RMS) and the tail window AFTER
//      release (t+250..t+1000 ms) sits above it — the reverb tail is heard, not assumed.
//   4. BYPASS-NULL (OfflineAudioContext, the stress-style determinism): four fresh offline
//      engines, same patch (one held note, midi 60, same params), only fx flags differ —
//      A all-off, B all-off, C all modules ON with mix=0, W verb ON mix=1. The barriers are the
//      pinned delivery proofs (every setParam true; noteOn true; await stats() → active === 1
//      BEFORE startRendering). A ≡ B bit-identical (maxAbsDiff 0, the wave's bypass null);
//      C ≡ A bit-identical (§2.2: an enabled module leaves the signal bit-identical at mix=0);
//      A is NON-VACUOUS (dry RMS > 0.01) and W differs from A (the verb actually processes).
//   5. PARAM ROUND-TRIP: every mount path (40 controls) — the bound control is provoked with a
//      real wheel/change event through its own handler (the av-knob / select wiring), then
//      avApplyParam(path, v) must return true (accepted for delivery by the engine facade —
//      the pinned semantics; the worklet param protocol has no ack) with an exact avParams
//      mirror echo, and the control repaints from the mirror; then the old value is restored.
//      The §3 paths NOT mounted in the v1 rack (predelay · spread · duck · bpm · stages ·
//      down · eqLo/eqMid/eqHi · comp.att/rel/makeup) are swept the same way for delivery
//      acceptance.
//   6. zero page errors · screenshot renders/p3-fx-suite.png (the rack card, scale 2) ·
//      freeze sha256 before === after.
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
   P3: the frozen sha of the rebuilt index.html is not known until build.py runs — the parent may
   fill this constant or pass --sha <hex>; the rig never loosens the before === after check. */
const EXPECT_SHA = '22ea7e52cd7a16c688e271d9ca2f5b64015f20ba20b50e9395f0570523ef9379';
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
const profile = path.join(tmpdir(), 'anvil-fxui-' + Date.now());
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
   __fxWitness: the rig's OWN AnalyserNode on the master tap; a rAF loop records a time-stamped
   RMS timeline; windowMax(t0,t1) reads the max RMS inside an absolute page-time window.
   __fxRoundTrip / __fxSweep / __fxNullTest: the functional check runners (see headers above). */

const WITNESS_SETUP = `(() => {
  if (window.__fxWitness && window.__fxWitness.v === 1) return { ok: true, cached: true };
  const API = { v: 1, W: null };
  API.arm = function (ctx) {
    API.stop();
    const master = (typeof avMasterFor === 'function') ? avMasterFor(ctx) : null;
    if (!master) return { ok: false, why: 'no master tap node for this ctx' };
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0;
    master.connect(an);
    const W = { an: an, sr: ctx.sampleRate, td: new Float32Array(an.fftSize), samples: [], on: true, rmsNow: 0, tOn: performance.now(), tLast: 0 };
    API.W = W;
    const tick = function () {
      if (!W.on) return;
      try {
        W.an.getFloatTimeDomainData(W.td);
        let s = 0;
        for (let i = 0; i < W.td.length; i++) s += W.td[i] * W.td[i];
        const rms = Math.sqrt(s / W.td.length);
        W.rmsNow = rms;
        W.tLast = performance.now();
        W.samples.push({ t: W.tLast, r: rms });
        if (W.samples.length > 8000) W.samples.shift();
      } catch (e) { /* analyser gone */ }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return { ok: true, sr: W.sr, fft: an.fftSize };
  };
  API.windowMax = function (t0, t1) {
    const W = API.W;
    if (!W) return null;
    let mx = 0, n = 0, sum = 0;
    for (let i = 0; i < W.samples.length; i++) {
      const s = W.samples[i];
      if (s.t >= t0 && s.t <= t1) { n += 1; sum += s.r; if (s.r > mx) mx = s.r; }
    }
    return { max: mx, mean: n ? sum / n : 0, n: n, t0: t0, t1: t1 };
  };
  API.read = function () { const W = API.W; if (!W) return null; return { sr: W.sr, frames: W.samples.length, rmsNow: W.rmsNow, tOn: W.tOn, tLast: W.tLast }; };
  API.stop = function () { const W = API.W; if (W) { W.on = false; try { W.an.disconnect(); } catch (e) { } } API.W = null; return true; };
  window.__fxWitness = API;
  return { ok: true };
})()`;

const ROUNDTRIP_FN = `window.__fxRoundTrip = async function () {
  const rows = [];
  const inv = avFxInventory();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < inv.length; i++) {
    const e = inv[i];
    const out = { path: e.path, kind: e.kind, ok: false, stage: '' };
    try {
      const el = document.querySelector('#av-fx-host ' + e.sel);
      if (!el) { out.err = 'control not found'; rows.push(out); continue; }
      const old = avParams[e.path];
      if (e.kind === 'knob') {
        const min = parseFloat(el.dataset.min), max = parseFloat(el.dataset.max), step = parseFloat(el.dataset.step) || 0.01;
        const up = !(typeof old === 'number' && old >= max - step / 2);
        el.dispatchEvent(new WheelEvent('wheel', { deltaY: up ? -1 : 1, bubbles: true, cancelable: true }));
        await sleep(30);
        const moved = avParams[e.path];
        out.wheel = { from: old, to: moved, dir: up ? 'up' : 'down' };
        if (!(typeof moved === 'number' && (up ? moved > old : moved < old))) { out.err = 'wheel did not move the mirror through the bound handler'; rows.push(out); continue; }
        let v = (i % 2) ? max : min;
        if (v === old) v = (old === max ? min : max);
        let rvRaw = null;
        try { rvRaw = avApplyParam(e.path, v); } catch (err) { rvRaw = 'threw: ' + ((err && err.message) || err); }
        const rv = rvRaw === true;
        const echo = avParams[e.path] === v;
        out.accept = { v: v, returned: rvRaw, echo: echo };
        if (!rv || !echo) { out.err = 'funnel rejected (returned=' + JSON.stringify(rvRaw) + ' echo=' + echo + ')'; rows.push(out); continue; }
        try { avApplyParam(e.path, old); } catch (err) { }
        avFxSync();
        out.restored = avParams[e.path] === old;
        out.visual = parseFloat(el.getAttribute('aria-valuenow')) === old;
        out.ok = out.restored === true && out.visual === true;
        if (!out.ok && !out.err) out.err = 'restore/visual mismatch';
        rows.push(out);
        continue;
      }
      if (e.kind === 'toggle') {
        const v = old ? 0 : 1;
        let rvRaw = null;
        try { rvRaw = avApplyParam(e.path, v); } catch (err) { rvRaw = 'threw: ' + ((err && err.message) || err); }
        const rv = rvRaw === true;
        avFxSync();
        const pressed = el.getAttribute('aria-pressed') === (v ? 'true' : 'false');
        const cls = el.classList.contains('on') === !!v;
        const echo = avParams[e.path] === v;
        out.accept = { v: v, returned: rvRaw, echo: echo, pressed: pressed, cls: cls };
        try { avApplyParam(e.path, old); avFxSync(); } catch (err) { }
        out.restored = avParams[e.path] === old;
        out.ok = rv && echo && pressed && cls && out.restored;
        if (!out.ok) out.err = 'toggle funnel/visual mismatch';
        rows.push(out);
        continue;
      }
      const opts = (e.options || []);
      let v = null;
      for (let k = 0; k < opts.length; k++) { if (opts[k] !== old) { v = opts[k]; break; } }
      if (v == null) { out.err = 'no alternate option'; rows.push(out); continue; }
      el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(30);
      const echo = avParams[e.path] === v;
      let rvRaw = null;
      try { rvRaw = avApplyParam(e.path, v); } catch (err) { rvRaw = 'threw: ' + ((err && err.message) || err); }
      const rv = rvRaw === true;
      out.accept = { v: v, echo: echo, returned: rvRaw };
      el.value = old;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(30);
      out.restored = avParams[e.path] === old && el.value === old;
      out.ok = echo && rv && out.restored;
      if (!out.ok) out.err = 'select change/echo mismatch';
      rows.push(out);
      continue;
    } catch (err) {
      out.err = String((err && err.message) || err);
      rows.push(out);
      continue;
    }
  }
  const bad = rows.filter((r) => !r.ok).map((r) => r.path);
  return { n: rows.length, okN: rows.length - bad.length, bad: bad, rows: rows };
}; true`;

const SWEEP_FN = `window.__fxSweep = async function (list) {
  const rows = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i].path, v = list[i].v;
    const had = Object.prototype.hasOwnProperty.call(avParams, p);
    const old = avParams[p];
    let rvRaw = null;
    try { rvRaw = avApplyParam(p, v); } catch (e) { rvRaw = 'threw: ' + ((e && e.message) || e); }
    const rv = rvRaw === true;
    const echo = avParams[p] === v;
    try { if (had) avParams[p] = old; else delete avParams[p]; } catch (e) { }
    rows.push({ path: p, returned: rvRaw, echo: echo, ok: rv && echo });
  }
  const bad = rows.filter((r) => !r.ok).map((r) => r.path);
  return { n: rows.length, okN: rows.length - bad.length, bad: bad, rows: rows };
}; true`;

/* four fresh offline engines, same deterministic patch, one held note each; only the fx on/mix
   flags differ per run. Delivery barrier per run: every setParam true, noteOn true, and
   await stats() -> active === 1 BEFORE startRendering (the rev3 bench lesson). */
const NULLTEST_FN = `window.__fxNullTest = async function () {
  const SR = 48000, SECS = 3.0, MIDI = 60, GAIN = 0.8;
  const HOT = [
    ['fx.verb.mode', 'plate'], ['fx.verb.size', 0.8], ['fx.verb.decay', 0.9], ['fx.verb.damp', 0.4],
    ['fx.delay.time', 0.25], ['fx.delay.feedback', 0.6], ['fx.delay.pingpong', 1],
    ['fx.mod.mode', 'chorus'], ['fx.mod.rate', 1.5], ['fx.mod.depth', 0.6],
    ['fx.drive.mode', 'sat'], ['fx.drive.amount', 0.8], ['fx.drive.tone', 0.5],
    ['fx.dyn.comp.thresh', -20], ['fx.dyn.comp.ratio', 4], ['fx.dyn.lim.ceiling', -1]
  ];
  const MODS = ['fx.drive', 'fx.mod', 'fx.delay', 'fx.verb', 'fx.dyn'];
  const OFF = MODS.map(function (m) { return [m + '.on', 0]; });
  const ON1 = MODS.map(function (m) { return [m + '.on', 1]; });
  const MIX0 = MODS.map(function (m) { return [m + '.mix', 0]; });
  const WET = [['fx.verb.on', 1], ['fx.verb.mix', 1]].concat(OFF.filter(function (p) { return p[0] !== 'fx.verb.on'; }));
  async function run(extra) {
    const oc = new OfflineAudioContext(2, Math.round(SR * SECS), SR);
    const h = await avEngineBoot(oc, { maxVoices: 4, offline: true });
    if (!h) return { ok: false, why: 'boot-null' };
    const params = HOT.concat(extra);
    const bad = [];
    for (let i = 0; i < params.length; i++) {
      let a = false;
      try { a = h.setParam(params[i][0], params[i][1]) === true; } catch (e) { a = false; }
      if (!a) bad.push(params[i][0]);
    }
    if (h.noteOn(MIDI, GAIN) !== true) return { ok: false, why: 'note-rejected', bad: bad };
    const st = await h.stats();
    if (!st || st.active !== 1) return { ok: false, why: 'delivery-barrier', bad: bad, active: st ? st.active : null };
    const buf = await oc.startRendering();
    const ch0 = buf.getChannelData(0), ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0);
    return { ok: true, bad: bad, tier: h.tier, len: buf.length, ch0: ch0, ch1: ch1 };
  }
  function cmp(a, b) {
    if (!a || !b || !a.ok || !b.ok) return { ok: false, why: 'render failed', a: a && a.why, b: b && b.why };
    const L = Math.min(a.len, b.len);
    let d0 = 0, d1 = 0, i0 = -1, i1 = -1;
    for (let i = 0; i < L; i++) {
      const d = Math.abs(a.ch0[i] - b.ch0[i]);
      if (d > d0) { d0 = d; if (i0 < 0) i0 = i; }
      const e = Math.abs(a.ch1[i] - b.ch1[i]);
      if (e > d1) { d1 = e; if (i1 < 0) i1 = i; }
    }
    return { ok: true, lenEq: a.len === b.len, lenA: a.len, lenB: b.len, maxAbsDiff: Math.max(d0, d1), dL: d0, dR: d1, firstDiff: Math.min(i0 < 0 ? L : i0, i1 < 0 ? L : i1) };
  }
  function sig(ch, n) {
    let s = 0, peak = 0;
    for (let i = 0; i < n; i++) { const v = ch[i]; s += v * v; const a = v < 0 ? -v : v; if (a > peak) peak = a; }
    return { rms: Math.sqrt(s / n), peak: peak };
  }
  const A = await run(OFF);
  const B = await run(OFF);
  const C = await run(ON1.concat(MIX0));
  const W = await run(WET);
  const sA = A.ok ? sig(A.ch0, A.len) : null;
  const sW = W.ok ? sig(W.ch0, W.len) : null;
  return {
    secs: SECS, sr: SR, midi: MIDI, gain: GAIN,
    runs: {
      A: { ok: A.ok, why: A.why, bad: A.bad, tier: A.tier, len: A.len, rms: sA ? sA.rms : null, peak: sA ? sA.peak : null },
      B: { ok: B.ok, why: B.why, bad: B.bad },
      C: { ok: C.ok, why: C.why, bad: C.bad },
      W: { ok: W.ok, why: W.why, bad: W.bad, rms: sW ? sW.rms : null }
    },
    cmpAB: cmp(A, B),
    cmpAC: cmp(A, C),
    cmpAW: cmp(A, W)
  };
}; true`;

/* the 40 mounted controls are counted from the frozen table (a drift between av_fx.js and this
   rig is a real failure, not a silent pass) */
const WANT_CONTROLS = 40, WANT_KNOBS = 27, WANT_TOGGLES = 7, WANT_SELECTS = 6;

/* §3 paths NOT mounted by the v1 rack — swept for delivery acceptance after the mount paths */
const SWEEP = [
  { path: 'fx.verb.predelay', v: 0.02 },
  { path: 'fx.delay.spread', v: 0.1 },
  { path: 'fx.delay.duck', v: 0.2 },
  { path: 'fx.delay.bpm', v: 120 },
  { path: 'fx.mod.stages', v: 6 },
  { path: 'fx.drive.down', v: 2 },
  { path: 'fx.dyn.eqLo', v: -3 },
  { path: 'fx.dyn.eqMid', v: 0 },
  { path: 'fx.dyn.eqHi', v: 3 },
  { path: 'fx.dyn.comp.att', v: 0.01 },
  { path: 'fx.dyn.comp.rel', v: 0.2 },
  { path: 'fx.dyn.comp.makeup', v: 0 },
];

const shotPath = path.join(here, '..', 'renders', 'p3-fx-suite.png');

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
  const drag = async (from, deltas, gap = 16) => {
    await mouse('mousePressed', from.x, from.y);
    let x = from.x, y = from.y;
    for (const [dx, dy] of deltas) { x += dx; y += dy; await mouse('mouseMoved', x, y); if (gap) await sleep(gap); }
    await mouse('mouseReleased', x, y);
  };
  const clickSel = async (sel, after = 300) => {
    const found = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; if (e.scrollIntoView) e.scrollIntoView({ block: 'center', inline: 'center' }); return true; })()`);
    if (found.value !== true) { note('click target missing: ' + sel); return false; }
    await sleep(200);
    const boxR = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width || !r.height) return null; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight }; })()`);
    const b = boxR.value;
    if (!b) { note('click target not visible: ' + sel); return false; }
    if (b.top < 0 || b.bottom > b.vh) note('click target partly off-screen (' + b.top + '..' + b.bottom + ' of ' + b.vh + '): ' + sel);
    await mouse('mousePressed', b.x, b.y);
    await sleep(30);
    await mouse('mouseReleased', b.x, b.y);
    await sleep(after);
    return true;
  };
  /* real drag to the knob's mechanical max (the cdp_knob_feel technique) */
  const maxKnob = async (sel, path, target) => {
    await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e && e.scrollIntoView) e.scrollIntoView({ block: 'center', inline: 'center' }); return true; })()`);
    await sleep(250);
    for (let attempt = 0; attempt < 3; attempt++) {
      const boxR = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
      if (!boxR.value) return { ok: false, why: 'knob not found' };
      await drag(boxR.value, [[0, -45], [0, -45], [0, -45], [0, -45], [0, -45], [0, -45]]);   /* 270 px up */
      await sleep(460);
      const v = (await ev(`avParams[${JSON.stringify(path)}]`)).value;
      if (v === target) return { ok: true, value: v, drags: attempt + 1 };
    }
    const v = (await ev(`avParams[${JSON.stringify(path)}]`)).value;
    return { ok: false, why: 'never reached ' + target, value: v };
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

  /* the rack card mounts into the parent-owned #av-fx-host (parent adds host + calls avFxInit) */
  let fxUp = false;
  for (let i = 0; i < 100 && !fxUp; i++) {
    const r = await ev(`!!(document.getElementById('av-fx-host') && document.querySelector('#av-fx-host .av-fx') && document.querySelectorAll('#av-fx-host .av-fx-strip[data-mod]').length === 7)`);
    if (r.value === true) { fxUp = true; break; }
    await sleep(150);
  }
  check('fx rack mounted: #av-fx-host + card root + 7 strips', fxUp);
  if (!fxUp) { console.error('FX HOST MISSING — parent adds #av-fx-host and calls avFxInit()'); process.exit(1); }

  const exportsR = await ev(`(() => ({
    init: typeof avFxInit === 'function',
    snap: typeof avFxSnap === 'function',
    classes: typeof avFxClasses === 'function',
    inventory: typeof avFxInventory === 'function',
    handle: !!(window.__avFx && typeof window.__avFx.snap === 'function'),
    version: window.__avFx ? window.__avFx.version : null,
  }))()`);
  const exportsV = exportsR.value || {};
  check('exports: avFxInit + avFxSnap + avFxClasses + avFxInventory + window.__avFx (p3.0)',
    exportsV.init === true && exportsV.snap === true && exportsV.classes === true && exportsV.inventory === true && exportsV.handle === true && exportsV.version === 'p3.0',
    JSON.stringify(exportsV));

  /* strip order (fixed per §2.1) + structure + binding state */
  const domR = await ev(`(() => {
    const host = document.getElementById('av-fx-host');
    const strips = [...host.querySelectorAll('.av-fx-strip[data-mod]')];
    const knobs = [...host.querySelectorAll('.av-knob[data-knob]')];
    const toggles = [...host.querySelectorAll('[data-fx-toggle]')];
    const sels = [...host.querySelectorAll('select.av-fx-select[data-param]')];
    return {
      order: strips.map(s => s.dataset.mod).join(','),
      perStrip: strips.map(s => ({
        mod: s.dataset.mod,
        knobs: s.querySelectorAll('.av-knob[data-knob]').length,
        toggles: s.querySelectorAll('[data-fx-toggle]').length,
        selects: s.querySelectorAll('select.av-fx-select').length,
      })),
      knobs: knobs.length, boundKnobs: knobs.filter(k => k.dataset.knobBound === '1').length,
      toggles: toggles.length, selects: sels.length,
      boundTS: toggles.filter(t => t.dataset.fxBound === '1').length + sels.filter(s => s.dataset.fxBound === '1').length,
      wired: host.dataset.avFxWired === '1',
      verbsToggle: !!host.querySelector('[data-fx-toggle="fx.verb.on"]'),
      verbsMix: !!host.querySelector('.av-knob[data-knob="fx.verb.mix"]'),
    };
  })()`);
  const dom = domR.value || {};
  check('strips: fixed order drive,aw,mod,delay,verb,conv,dyn — 1 toggle each + per-module knobs (aw 3 · rest 4) + 1 enum pick except dyn (conv adds the IR import button)',
    dom.order === 'drive,aw,mod,delay,verb,conv,dyn' &&
    (dom.perStrip || []).every(s => s.toggles === 1 && (s.mod === 'aw' ? s.knobs === 3 : s.knobs === 4) && (s.mod === 'dyn' ? s.selects === 0 : s.selects === 1)),
    JSON.stringify(dom.perStrip));
  check('controls mounted + bound: 27 knobs (all data-knob-bound), 7 toggles + 6 selects (all data-fx-bound), host wired',
    dom.knobs === WANT_KNOBS && dom.boundKnobs === WANT_KNOBS && dom.toggles === WANT_TOGGLES && dom.selects === WANT_SELECTS && dom.boundTS === WANT_TOGGLES + WANT_SELECTS && dom.wired === true,
    JSON.stringify({ knobs: dom.knobs, boundKnobs: dom.boundKnobs, toggles: dom.toggles, selects: dom.selects, boundTS: dom.boundTS, wired: dom.wired }));

  const snapR = await ev(`avFxSnap()`);
  const snap = snapR.value || {};
  check('avFxSnap(): inited + host + wired + card + 7 strips in order + counts = 40 controls (27/7/6)',
    snap.inited === true && snap.host === true && snap.wired === true && snap.card === true && snap.strips === 7 &&
    snap.order && snap.order.join(',') === 'drive,aw,mod,delay,verb,conv,dyn' &&
    snap.expect && snap.expect.controls === WANT_CONTROLS && snap.expect.knobs === WANT_KNOBS && snap.expect.toggles === WANT_TOGGLES && snap.expect.selects === WANT_SELECTS &&
    snap.controls && snap.controls.knobs === WANT_KNOBS && snap.controls.boundKnobs === WANT_KNOBS && snap.controls.toggles === WANT_TOGGLES && snap.controls.selects === WANT_SELECTS && snap.controls.bound === WANT_TOGGLES + WANT_SELECTS &&
    Array.isArray(snap.inventory) && snap.inventory.length === WANT_CONTROLS && Array.isArray(snap.classes) && snap.classes.length >= 10,
    JSON.stringify({ inited: snap.inited, strips: snap.strips, controls: snap.controls, inv: snap.inventory ? snap.inventory.length : null, classes: snap.classes ? snap.classes.length : null }));

  /* ── 1b. absent-host contract + remount ── */
  const probeR = await ev(`(() => {
    const host = document.getElementById('av-fx-host');
    if (!host || !host.parentNode) return { skip: true };
    const parent = host.parentNode, next = host.nextSibling;
    host.remove();
    let absent = null, absentThrew = false;
    try { absent = avFxInit(); } catch (e) { absentThrew = true; }
    parent.insertBefore(host, next);
    let remount = null, remountThrew = false;
    try { remount = avFxInit(); } catch (e) { remountThrew = true; }
    const strips = document.querySelectorAll('#av-fx-host .av-fx-strip[data-mod]').length;
    const knobs = [...document.querySelectorAll('#av-fx-host .av-knob[data-knob]')];
    const ts = [...document.querySelectorAll('#av-fx-host [data-fx-toggle], #av-fx-host select.av-fx-select[data-param]')];
    return {
      absent: absent, absentThrew: absentThrew, remount: remount, remountThrew: remountThrew,
      strips: strips, knobsBound: knobs.filter(k => k.dataset.knobBound === '1').length,
      boundTS: ts.filter(t => t.dataset.fxBound === '1').length, wired: host.dataset.avFxWired === '1',
    };
  })()`);
  const probe = probeR.value || {};
  check('absent-host contract: avFxInit() -> false without throwing, and a re-attached host re-mounts the card',
    probe.absent === false && probe.absentThrew === false && probe.remount === true && probe.remountThrew === false &&
    probe.strips === 7 && probe.knobsBound === WANT_KNOBS && probe.boundTS === WANT_TOGGLES + WANT_SELECTS && probe.wired === true,
    JSON.stringify(probe));

  /* ── 2. REAL input: click the VERB toggle, drag the VERB MIX knob to 1 ── */
  const clicked = await clickSel('#av-fx-host [data-fx-toggle="fx.verb.on"]', 350);
  const onR = await ev(`(() => {
    const btn = document.querySelector('#av-fx-host [data-fx-toggle="fx.verb.on"]');
    const strip = document.querySelector('#av-fx-host .av-fx-strip[data-mod="verb"]');
    return { mirror: avParams['fx.verb.on'], pressed: btn.getAttribute('aria-pressed'), onCls: btn.classList.contains('on'), stripOn: strip.classList.contains('av-fx-on') };
  })()`);
  const on = onR.value || {};
  check('real click on the VERB toggle enables it (mirror 1 · aria-pressed true · strip .av-fx-on)',
    clicked === true && on.mirror === 1 && on.pressed === 'true' && on.onCls === true && on.stripOn === true, JSON.stringify(on));

  const mx = await maxKnob('.av-knob[data-knob="fx.verb.mix"]', 'fx.verb.mix', 1);
  const mixR = await ev(`(() => {
    const el = document.querySelector('#av-fx-host .av-knob[data-knob="fx.verb.mix"]');
    const ro = document.querySelector('#av-fx-host [data-kval="fx.verb.mix"]');
    return { mirror: avParams['fx.verb.mix'], aria: el.getAttribute('aria-valuenow'), readout: ro ? ro.textContent.trim() : null };
  })()`);
  const mixV = mixR.value || {};
  check('real drag on the VERB MIX knob lands on 1 (mirror 1 · aria-valuenow 1 · readout 100%)',
    mx.ok === true && mixV.mirror === 1 && mixV.aria === '1' && mixV.readout === '100%',
    JSON.stringify({ drags: mx.drags, value: mx.value, why: mx.why, mirror: mixV.mirror, aria: mixV.aria, readout: mixV.readout }));

  /* ── 3. engine readiness + the reverb-tail witness ── */
  let engReady = false;
  for (let i = 0; i < 100 && !engReady; i++) {
    const r = await ev(`!!(window.__avEngine && window.__avEngine.ready === true)`);
    if (r.value === true) { engReady = true; break; }
    await sleep(200);
  }
  check('engine ready (the live tier is up before the tail witness)', engReady,
    engReady ? ((await ev(`window.__avEngine.tier`)).value || '') : 'not ready after 20 s');

  await ev(WITNESS_SETUP);
  const armR = await ev(`(() => {
    const h = window.__avEngine;
    if (!h || h.ready !== true || !h.handle || !h.handle.ctx) return { ok: false, why: 'engine not ready' };
    try { const p = h.handle.ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { }
    return window.__fxWitness.arm(h.handle.ctx);
  })()`);
  const armed = !!(armR.value && armR.value.ok === true);
  check('tail witness: rig\'s OWN AnalyserNode armed on the master tap (avMasterFor)', armed, JSON.stringify(armR.value || armR.error));

  let ctl = null, dn = null, up = null, hold = null, tail = null;
  if (armed) {
    await sleep(900);
    const ctlR = await ev(`window.__fxWitness.windowMax(performance.now() - 700, performance.now() - 150)`);
    ctl = ctlR.value;
    check('tail witness: silent control window BEFORE the note (RMS < 0.005)', !!ctl && ctl.max < 0.005,
      'control max=' + (ctl ? ctl.max.toFixed(5) : null) + ' over ' + (ctl ? ctl.n : 0) + ' samples');
    const dnR = await ev(`(() => { const ok = avNoteDown('c4', 1.0); return { ok: ok === true, t: performance.now() }; })()`);
    dn = dnR.value;
    check('tail: note started through the ONE note path (avNoteDown(\'c4\', 1.0))', !!dn && dn.ok === true, JSON.stringify(dn));
    await sleep(1300);
    const upR = await ev(`(() => { const ok = avNoteUp('c4'); return { ok: ok === true, t: performance.now() }; })()`);
    up = upR.value;
    check('tail: note released (avNoteUp(\'c4\'))', !!up && up.ok === true, JSON.stringify(up));
    if (dn && up) {
      const holdR = await ev(`window.__fxWitness.windowMax(${Math.round(dn.t + 350)}, ${Math.round(up.t - 80)})`);
      hold = holdR.value;
      check('tail witness: the held note is LOUD on the master tap (RMS > 0.02)', !!hold && hold.max > 0.02,
        'hold max=' + (hold ? hold.max.toFixed(4) : null));
      await sleep(1350);
      const tailR = await ev(`window.__fxWitness.windowMax(${Math.round(up.t + 250)}, ${Math.round(up.t + 1000)})`);
      tail = tailR.value;
      const tailOk = !!tail && !!ctl && tail.max > 0.005 && tail.max > Math.max(ctl.max * 4, 0.005);
      check('REVERB TAIL WITNESSED: tail RMS after note-off (t+250..t+1000 ms) sits above the silent control window',
        tailOk, 'tail max=' + (tail ? tail.max.toFixed(4) : null) + ' vs control max=' + (ctl ? ctl.max.toFixed(5) : null) + ' · tail mean=' + (tail ? tail.mean.toFixed(4) : null) + ' · headless engine, tail table=' + ((await ev(`window.__avEngine.tier`)).value || ''));
    }
    await ev(`window.__fxWitness.stop()`);
  } else {
    check('tail witness: silent control window BEFORE the note (RMS < 0.005)', false, 'witness not armed');
    check('tail: note started through the ONE note path (avNoteDown(\'c4\', 1.0))', false, 'witness not armed');
    check('tail: note released (avNoteUp(\'c4\'))', false, 'witness not armed');
    check('tail witness: the held note is LOUD on the master tap (RMS > 0.02)', false, 'witness not armed');
    check('REVERB TAIL WITNESSED: tail RMS after note-off (t+250..t+1000 ms) sits above the silent control window', false, 'witness not armed');
  }

  /* ── 4. param acceptance round-trip: every mounted module path ── */
  await ev(ROUNDTRIP_FN);
  const rtR = await ev(`window.__fxRoundTrip()`);
  const rt = rtR.value;
  if (!rt) {
    check('param round-trip: every module path accepted (29/29)', false, JSON.stringify(rtR.error || 'no value'));
  } else {
    check(`param round-trip: every mounted module path accepted (${WANT_CONTROLS} paths — wheel/change through the bound handler, avApplyParam true, mirror echo, visual repaint, restore)`,
      rt.n === WANT_CONTROLS && rt.okN === WANT_CONTROLS && rt.bad.length === 0,
      rt.bad.length ? 'bad: ' + rt.bad.join(', ') : (rt.n + '/' + rt.okN + ' ok'));
    const knobRow = (rt.rows || []).find(r => r.kind === 'knob' && r.wheel);
    if (knobRow) note('round-trip sample (first knob): ' + JSON.stringify(knobRow));
  }

  /* ── 4b. §3 path sweep: the paths the v1 rack does not mount ── */
  await ev(SWEEP_FN);
  const swR = await ev(`window.__fxSweep(${JSON.stringify(SWEEP)})`);
  const sw = swR.value;
  if (!sw) {
    check('§3 path sweep: unmounted paths accepted for delivery (12/12)', false, JSON.stringify(swR.error || 'no value'));
  } else {
    check(`§3 path sweep: unmounted module paths accepted for delivery (${SWEEP.length}/${SWEEP.length} — predelay · spread · duck · bpm · stages · down · eqLo/eqMid/eqHi · comp.att/rel/makeup)`,
      sw.n === SWEEP.length && sw.okN === SWEEP.length && sw.bad.length === 0,
      sw.bad.length ? 'bad: ' + sw.bad.join(', ') : (sw.n + '/' + sw.okN + ' ok'));
  }

  /* ── 5. bypass-null: four offline renders (the stress-style determinism) ── */
  await ev(NULLTEST_FN);
  const ntR = await ev(`window.__fxNullTest()`);
  const nt = ntR.value;
  if (!nt) {
    check('bypass-null: the offline null test ran', false, JSON.stringify(ntR.error || 'no value'));
  } else {
    note('null test runs: A(all-off) tier=' + nt.runs.A.tier + ' len=' + nt.runs.A.len + ' rms=' + (nt.runs.A.rms != null ? nt.runs.A.rms.toFixed(4) : null) + ' · B=' + nt.runs.B.ok + ' · C(ON/mix0)=' + nt.runs.C.ok + ' · W(verb wet)=' + nt.runs.W.ok);
    const badAll = [].concat(nt.runs.A.bad || [], nt.runs.B.bad || [], nt.runs.C.bad || [], nt.runs.W.bad || []);
    check('bypass-null: 4 fresh offline engines, all params accepted + note delivered (stats barrier active===1)',
      nt.runs.A.ok && nt.runs.B.ok && nt.runs.C.ok && nt.runs.W.ok && badAll.length === 0,
      'bad params: ' + JSON.stringify(badAll) + ' · whys: ' + JSON.stringify([nt.runs.A.why, nt.runs.B.why, nt.runs.C.why, nt.runs.W.why]));
    check('bypass-null: the dry render is NON-VACUOUS (all-off RMS > 0.01 — a silent render cannot pass the nulls)',
      nt.runs.A.rms != null && nt.runs.A.rms > 0.01, 'dry rms=' + nt.runs.A.rms + ' peak=' + nt.runs.A.peak);
    check('BYPASS NULL: two all-off renders of the same patch are BIT-IDENTICAL (maxAbsDiff 0, both channels)',
      nt.cmpAB.ok && nt.cmpAB.maxAbsDiff === 0 && nt.cmpAB.lenEq, JSON.stringify(nt.cmpAB));
    check('mix=0 null (§2.2): all modules ON with mix 0 = all-off, BIT-IDENTICAL (maxAbsDiff 0, both channels)',
      nt.cmpAC.ok && nt.cmpAC.maxAbsDiff === 0 && nt.cmpAC.lenEq, JSON.stringify(nt.cmpAC));
    check('wet sanity: verb ON mix 1 CHANGES the render vs dry (maxAbsDiff > 0 — the chain is live, not dead)',
      nt.cmpAW.ok && nt.cmpAW.maxAbsDiff > 0, JSON.stringify(nt.cmpAW));
  }

  /* ── 6. zero page errors ── */
  check('zero page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* ── 7. screenshot renders/p3-fx-suite.png ── */
  await ev(`(() => { const el = document.getElementById('av-fx-host'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); return true; })()`);
  await sleep(250);
  const rectR = await ev(`(() => { const el = document.getElementById('av-fx-host'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }; })()`);
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
  check('screenshot: renders/p3-fx-suite.png (the FX rack card, scale 2)', shotOk, shotInfo);

  /* ── 8. freeze sha before/after ── */
  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after): ' + shaAfter);
  check('freeze: index.html sha256 before === after (unchanged by the run)', shaAfter === shaBefore, shaAfter);
  if (PIN) check('freeze: index.html sha256 = pinned', shaBefore === PIN && shaAfter === PIN, 'pinned ' + PIN.slice(0, 12) + '…');
  else note('EXPECT_SHA not pinned — after the P3 build, pass --sha <hex> or set the constant (never loosen)');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { ws.close(); } catch { /* done */ }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('fx harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    /* profile-scoped cleanup (LAW): kill ONLY processes whose command line carries OUR temp
       profile — matched by its unique basename, so the pattern needs no backslash escaping */
    const tag = path.basename(profile);
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
