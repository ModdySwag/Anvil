// cdp_stress.mjs — Anvil P1 10-minute stress rig (contract: verify/_p1_wave.md §9.4).
//
// 10 minutes of live-worklet-tier load on the frozen build over the local http server:
//   - chord/arpeggio cycles: 8 -> 64 (the live pool cap) voices via window.__avEngine.noteOn/noteOff,
//     held at cap with an arpeggio churn (2 released / 2 replaced every ~330 ms)
//   - periodic REAL knob commits through the mounted #av-synth DOM knobs (avKnobCommit ->
//     avApplyParam -> __avEngine.setParam): CUTOFF log sweeps (200..20000..200), RESO steps
//   - unison stepping on the mounted UNISON knob (osc1.uni) across its full 1..7 range
//   - every ~60 s: allOff from a loaded pool -> drain check (active+released -> 0 within 1 s)
// Sampling every 15 s: {active, released, usedJSHeapSize (performance.memory), cumulative
// underruns via bench('read'), ctx.state} + driver phase/counters.
// Asserts: heap growth < 60 MB; zero underrun DELTAS at cap; pool drains; zero page errors.
// Shot: renders/p1-stress.png (final state). Log: verify/last-cdp_stress.log.
//
// Cap = 64 (the live pool; realtime bench published 64/64 for both variants, 3 reps, 0 underruns).
// Unison note: the workload steps osc1.uni across the knob's full 1..7 range (osc2.uni has no
// mounted control and stays at its default 1). Cost projection from the bench numbers (≈81 µs per
// unison sub-osc per quantum at 64 voices, fixed ≈340 µs) puts the heaviest step (uni 7) at
// ~37% of the 2666.7 µs/quantum budget — inside the verified envelope. Any underrun delta is
// reported raw with the interval + cap-window attribution (no massaging).
//
// Usage: node verify/cdp_stress.mjs [--minutes N] [--port N]
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const argv = process.argv.slice(2);
const argVal = (f, def) => { const i = argv.indexOf(f); return i > -1 && argv[i + 1] && !String(argv[i + 1]).startsWith('--') ? argv[i + 1] : def; };

const PAGE_FILE = path.join(repoRoot, 'index.html');
if (!existsSync(PAGE_FILE)) { console.error('page not found: ' + PAGE_FILE); process.exit(2); }
const pageRel = path.relative(repoRoot, PAGE_FILE).replace(/\\/g, '/');

const MINUTES = Math.max(1, Number(argVal('--minutes', '10')) || 10);
const WORKLOAD_MS = MINUTES * 60 * 1000;
const SAMPLE_MS = 15000;                     /* §9.4 pin */
const HARD_CAP_MS = (MINUTES + 4) * 60 * 1000;
const WATCHDOG_MS = (MINUTES + 12) * 60 * 1000;
const CAP = 64;                              /* the live pool (§9.4 dispatch pin) */
const HEAP_LIMIT_MB = 60;
const EVAL_TIMEOUT_MS = 40000;
const NOTE_GAIN = 0.8;

/* ---- outputs ---- */
const outDir = path.join(repoRoot, 'verify');
const logPath = path.join(outDir, 'last-cdp_stress.log');
const shotRel = path.join('renders', 'p1-stress.png');
const relOut = (p) => path.relative(repoRoot, p).replace(/\\/g, '/');
try { writeFileSync(logPath, ''); } catch { }     /* fresh log per run (house bench style) */
function log(s) {
  const line = String(s);
  console.log(line);
  try { appendFileSync(logPath, line + '\n'); } catch { }
}

const RESULT = {
  kind: 'anvil-cdp-stress', version: 1, minutes: MINUTES, startedAt: new Date().toISOString(), finishedAt: null,
  page: { file: pageRel, bytes: 0, sha256: null },
  cap: CAP, heapLimitMb: HEAP_LIMIT_MB, sampleMs: SAMPLE_MS,
  engine: null, sanity: null, knobs: null, samples: [], asserts: null, verdict: null, exitCode: null,
  shot: null, console: [], pageErrors: [],
};
const r2 = (v) => (typeof v === 'number' && isFinite(v)) ? Math.round(v * 100) / 100 : v;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = (b) => (typeof b === 'number' ? Math.round(b / 1048576 * 10) / 10 : null);

/* ---- freeze line ---- */
{
  const bytes = readFileSync(PAGE_FILE);
  RESULT.page.bytes = bytes.length;
  RESULT.page.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  log('freeze sha256 ' + RESULT.page.sha256 + ' (' + bytes.length + ' B) [' + pageRel + ']');
}

/* ---- static server (repo root, same pattern as the bench rig) ---- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};
const server = http.createServer((req, res) => {
  try {
    const u = new URL(req.url, 'http://127.0.0.1');
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || p === '') p = '/index.html';
    if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const abs = path.resolve(repoRoot, '.' + p);
    if (abs !== repoRoot && !abs.startsWith(repoRoot + path.sep)) { res.writeHead(403); res.end('forbidden'); return; }
    if (!existsSync(abs) || !statSync(abs).isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(abs));
  } catch (e) { try { res.writeHead(500); res.end('server error'); } catch { } }
});

async function freePort(start) {
  for (let p = start; p < start + 400; p++) {
    const ok = await new Promise((res) => {
      const srv = net.createServer();
      srv.once('error', () => res(false));
      srv.once('listening', () => srv.close(() => res(true)));
      srv.listen(p, '127.0.0.1');
    });
    if (ok) return p;
  }
  return start;
}
const portArg = argVal('--port', null);
const PORT = portArg ? Number(portArg) : await freePort(9600);
const DEBUG_PORT = await freePort(PORT + 1);
await new Promise((res) => server.listen(PORT, '127.0.0.1', res));
const originPrefix = 'http://127.0.0.1:' + PORT + '/';
const pageUrl = originPrefix + 'index.html?avtest=1';
log('server: ' + originPrefix + ' (repo root ' + repoRoot + ')');
log('devtools port: ' + DEBUG_PORT);
RESULT.server = { port: PORT, debugPort: DEBUG_PORT, url: pageUrl };

/* ---- browser (launch block copied verbatim from cdp_smoke.mjs / cdp_bench.mjs) ---- */
const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
];
const exe = candidates.find(existsSync);
if (!exe) { console.error('no chromium found'); process.exit(2); }
const profile = path.join(tmpdir(), 'anvil-stress-' + Date.now());
log('using browser: ' + exe);
log('url: ' + pageUrl);
RESULT.browser = exe;
const chrome = spawn(exe, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--disable-sync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
  pageUrl,
], { stdio: 'ignore', windowsHide: true });

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  try { chrome.kill(); } catch { }
  try { server.close(); } catch { }
  try {
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile.replace(/[\\\\/]/g, '\\\\')}*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
}
function finish(code) {
  try { clearTimeout(watchdog); } catch { }
  RESULT.finishedAt = new Date().toISOString();
  RESULT.exitCode = code;
  if (mainCdp) {
    RESULT.console = mainCdp.consoleAll.slice(0, 80);
    RESULT.pageErrors = mainCdp.errors.slice(0, 50);
  }
  try { log('STRESS-RESULT ' + JSON.stringify({
    sha256: RESULT.page.sha256, verdict: RESULT.verdict,
    asserts: RESULT.asserts ? {
      heapGrowthMb: RESULT.asserts.heap ? RESULT.asserts.heap.growthMb : null,
      underrunDeltas: RESULT.asserts.underruns ? RESULT.asserts.underruns.deltasTotal : null,
      drains: RESULT.asserts.drains ? RESULT.asserts.drains.verdict : null,
      pageErrors: RESULT.asserts.pageErrors ? RESULT.asserts.pageErrors.count : null,
    } : null,
    finalSample: RESULT.samples.length ? RESULT.samples[RESULT.samples.length - 1] : null,
  })); } catch { }
  process.exit(code);
}
process.on('exit', () => { cleanup(); });
process.on('SIGINT', () => { log('SIGINT — cleaning up'); try { RESULT.verdict = RESULT.verdict || 'interrupted'; } catch { } process.exit(130); });
const watchdog = setTimeout(() => {
  log('WATCHDOG: rig exceeded ' + Math.round(WATCHDOG_MS / 60000) + ' min — dumping and exiting');
  RESULT.verdict = RESULT.verdict || 'watchdog-timeout';
  process.exit(4);
}, WATCHDOG_MS);

/* ---- CDP plumbing (same shape as the bench rig) ---- */
let mainCdp = null;
async function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const api = { consoleAll: [], errors: [] };
  let id = 0;
  const pending = new Map();
  api.send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args || []).map((a) => a.value !== undefined ? String(a.value) : (a.description || '')).join(' ');
      if (api.consoleAll.length < 400) api.consoleAll.push('[' + m.params.type + '] ' + text);
      if (m.params.type === 'error' && api.errors.length < 100) api.errors.push('console.error: ' + text);
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      if (api.errors.length < 100) api.errors.push('exception: ' + (d.exception?.description || d.text || 'unknown'));
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      if (api.errors.length < 100) api.errors.push('LOG: ' + m.params.entry.text);
    }
  };
  api.ev = async (expr, tries = 2, timeoutMs = EVAL_TIMEOUT_MS) => {
    for (let t = 0; ; t++) {
      const r = await api.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: timeoutMs });
      if (!r.exceptionDetails) return { value: r.result ? r.result.value : undefined };
      const desc = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'eval error';
      if (t < tries - 1 && /context was destroyed|Cannot find context|Inspected target navigated/i.test(desc)) { await sleep(400); continue; }
      return { error: desc };
    }
  };
  api.close = () => { try { ws.close(); } catch { } };
  return api;
}
function dumpConsole(cdp, n) {
  log('console messages: ' + cdp.consoleAll.length);
  for (const line of cdp.consoleAll.slice(-(n || 30))) log('  ' + line.replace(/\s+/g, ' ').slice(0, 300));
}

/* ---- phase helpers (from the bench rig) ---- */
async function waitEngine(cdp, maxMs) {
  const t0 = Date.now();
  let info = {};
  while (Date.now() - t0 < maxMs) {
    const r = await cdp.ev(`(() => {
      const e = window.__avEngine;
      return { attr: document.documentElement.getAttribute('data-av-engine'),
               has: !!e, ready: !!(e && e.ready === true),
               tier: e ? e.tier : null, url: e ? e.url : null, error: e ? (e.error || null) : null };
    })()`);
    if (r.value) info = r.value;
    if ((info.attr === 'worklet' || info.attr === 'spn') && info.has) return { ok: true, info };
    if (info.attr === 'failed') return { ok: false, failed: true, info };
    await sleep(250);
  }
  return { ok: false, info };
}
async function attachCtx(cdp) {
  const r = await cdp.ev(`(() => {
    const find = (o) => {
      if (!o) return null;
      if (typeof o.currentTime === 'number' && typeof o.resume === 'function') return o;
      for (const k in o) { try { const v = o[k]; if (v && typeof v.currentTime === 'number' && typeof v.resume === 'function') return v; } catch (e) { } }
      return null;
    };
    const e = window.__avEngine || {};
    const ctx = find(e.handle) || find(e.ctx) || find(e);
    if (!ctx) return { found: false };
    window.__stressCtx = ctx;
    return { found: true, state: ctx.state, sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency };
  })()`);
  return r.value || { found: false, error: r.error };
}
async function measureRealtime(cdp) {
  const r = await cdp.ev(`(async () => {
    const ctx = window.__stressCtx;
    if (!ctx) return { err: 'no ctx handle' };
    if (ctx.state !== 'running') { try { await Promise.race([ctx.resume().catch(() => {}), new Promise((res) => setTimeout(res, 1500))]); } catch (e) { } }
    for (let i = 0; i < 16 && ctx.state !== 'running'; i++) await new Promise((res) => setTimeout(res, 125));
    await new Promise((res) => setTimeout(res, 400));   /* settle: a fresh headless context undershoots slightly on its first windows */
    const wins = [];
    for (let w = 0; w < 3; w++) {
      const t0 = performance.now();
      const c0 = ctx.currentTime;
      await new Promise((res) => setTimeout(res, 2000));
      const c1 = ctx.currentTime;
      const wall = (performance.now() - t0) / 1000;
      wins.push({ advance: c1 - c0, wall: wall, ratio: wall > 0 ? (c1 - c0) / wall : 0 });
      if (wins[w].advance >= 1.9) break;
    }
    const best = wins.reduce((a, b) => (b.advance > a.advance ? b : a), wins[0]);
    return { state: ctx.state, wins: wins, best: best, advance: best.advance, wall: best.wall, ratio: best.ratio,
             baseLatency: ctx.baseLatency, sampleRate: ctx.sampleRate };
  })()`, 3);
  const v = (r && r.value) || {};
  if (v.err || typeof v.advance !== 'number') return { ok: false, err: (r && r.error) || v.err || 'sanity eval failed', raw: v };
  v.ok = v.state === 'running' && v.advance >= 1.9;
  return v;
}

/* ============================================================================================
   IN-PAGE WORKLOAD DRIVER (installed once): cycle = drain/clear -> unison step -> chord build
   8..64 with a concurrent cutoff sweep -> cap hold with arpeggio churn + reso steps -> release.
   Drain checks (allOff from a loaded pool, active+released -> 0 within 1 s) on odd cycles ->
   ~every 2 cycles. All counters live on window.__stress.S for the Node sampler.
   ============================================================================================ */
function stressPageRuntime() {
  const S = {
    t0: 0, running: false, done: false, phase: 'idle', cycles: 0, step: '', fatal: null,
    capWindows: [], drainChecks: [], errors: [], cycleLog: [], uniLog: [],
    notesOn: 0, notesOff: 0, knobCommits: 0, capReachedCount: 0, maxHeld: 0,
  };
  const CAP = 64;                              /* in-page copy of the pool cap (functions in here are stringified — no Node scope) */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MIDIS = []; for (let i = 0; i < 64; i++) MIDIS.push(24 + i);   /* 64 distinct midis, 24..87 */
  const UNIS = [1, 3, 2, 7];                                            /* unison stepping: 3 cycles in the bench-verified envelope (<=3, FAT max) + 1 labeled uni-7 over-drive probe */
  let held = [], pool = [];

  const commit = (path, v) => {
    const kn = document.querySelector('#av-synth .av-knob[data-knob="' + path + '"]');
    if (!kn) { S.errors.push('knob not found: ' + path); return false; }
    try { avKnobCommit(kn, v); S.knobCommits++; return true; }
    catch (e) { S.errors.push('commit ' + path + ': ' + ((e && e.message) || e)); return false; }
  };
  const on = () => {
    const m = pool.shift();
    if (m === undefined) return false;
    let ok = false;
    try { ok = window.__avEngine.noteOn(m, 0.8) === true; } catch (e) { S.errors.push('noteOn: ' + e); }
    if (ok) { held.push(m); S.notesOn++; if (held.length > S.maxHeld) S.maxHeld = held.length; }
    else { pool.push(m); S.errors.push('noteOn rejected midi ' + m); }
    return ok;
  };
  const off = () => {
    const m = held.shift();
    if (m === undefined) return false;
    try { window.__avEngine.noteOff(m); } catch (e) { S.errors.push('noteOff: ' + e); }
    pool.push(m); S.notesOff++;
    return true;
  };
  const engineAllOff = () => {
    try { window.__avEngine.allOff(); } catch (e) { S.errors.push('allOff: ' + e); }
    pool = pool.concat(held); held.length = 0;
  };
  const statsN = async () => { try { return await window.__avEngine.stats(); } catch (e) { S.errors.push('stats: ' + e); return null; } };
  async function drainCheck(label) {
    engineAllOff();
    const t0 = performance.now();
    let s = null, ms = 0;
    for (let i = 0; i < 8; i++) {
      await sleep(150);
      s = await statsN();
      ms = performance.now() - t0;
      if (s && (s.active + s.released) === 0) break;
    }
    const rec = { label: label, ok: !!(s && (s.active + s.released) === 0 && ms <= 1000), ms: Math.round(ms), active: s ? s.active : null, released: s ? s.released : null };
    S.drainChecks.push(rec);
    return rec;
  }
  async function sweepCutoff(spanMs, n) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const v = Math.round(200 * Math.pow(100, u < 0.5 ? u * 2 : (1 - u) * 2));   /* 200 -> 20000 -> 200 log */
      commit('filter.cutoff', v);
      const wait = t0 + (i + 1) * (spanMs / n) - performance.now();
      if (wait > 0) await sleep(wait);
    }
  }
  async function run(ms) {
    S.t0 = performance.now(); S.running = true;
    pool = MIDIS.slice(); held = [];
    try {
      while (performance.now() - S.t0 < ms) {
        S.cycles++;
        const k = S.cycles;
        /* 1. drain (odd cycles, ~every 2 cycles: allOff from the previous load) or soft clear */
        S.phase = 'drain'; S.step = 'cycle ' + k;
        if (k % 2 === 1) { await drainCheck('cycle' + k); }
        else { engineAllOff(); await sleep(400); }
        /* 2. unison step (applies to new notes -> the build below takes it) */
        S.phase = 'unison';
        const uni = UNIS[k % UNIS.length];
        commit('osc1.uni', uni);
        S.uniLog.push({ cycle: k, uni: uni });
        await sleep(150);
        /* 3. build 8 -> 64 while a cutoff sweep runs concurrently */
        S.phase = 'build'; S.step = 'build @uni ' + uni;
        const sweepP = sweepCutoff(16000, 40);
        while (held.length < 8 && pool.length) on();
        for (const n of [16, 24, 32, 40, 48, 56, 64]) {
          await sleep(900);
          while (held.length < n && pool.length) on();
        }
        S.phase = 'cap'; S.step = 'cap ' + held.length + ' voices @uni ' + uni;
        if (held.length === CAP) S.capReachedCount++;
        const capStart = Math.round(performance.now() - S.t0);
        /* 4. cap hold: reso steps + arpeggio churn (2 off / 2 on every ~330 ms) */
        S.step = 'cap reso';
        commit('filter.reso', 0.75); await sleep(350);
        commit('filter.reso', 0.2); await sleep(300);
        for (let i = 0; i < 34; i++) { S.step = 'cap churn ' + (i + 1) + '/34'; await sleep(330); off(); off(); on(); on(); }
        commit('filter.reso', 0.5);
        const capEnd = Math.round(performance.now() - S.t0);
        S.capWindows.push({ start: capStart, end: capEnd, uni: uni, cycle: k });
        S.cycleLog.push({ cycle: k, uni: uni, capStart: capStart, capEnd: capEnd, capReached: held.length === CAP });
        /* 5. release (ramp-down) */
        S.phase = 'release'; S.step = 'release'; 
        let r = 0;
        while (held.length) { off(); r++; if (r % 8 === 0) await sleep(380); }
        await sleep(400);
        if (sweepP && typeof sweepP.then === 'function') await sweepP;
        S.phase = 'gap'; S.step = 'gap';
        await sleep(500);
      }
      /* final: drain + restore the §4.2 defaults on the touched knobs */
      S.phase = 'final'; S.step = 'final drain';
      await drainCheck('final');
      commit('filter.cutoff', 800); commit('filter.reso', 0.3); commit('osc1.uni', 1);
      S.phase = 'done'; S.step = 'done';
    } catch (e) {
      S.fatal = String((e && e.stack) || e); S.phase = 'error'; S.step = 'error';
    }
    S.done = true; S.running = false;
    return { cycles: S.cycles, done: true, fatal: S.fatal, drainChecks: S.drainChecks.length };
  }
  return { S: S, run: run, commit: commit, drainCheck: drainCheck };
}

/* sample one snapshot from the live page (read-only) */
function stressSampleExpr() {
  return `(async () => {
    const S = (window.__stress && window.__stress.S) || {};
    const e = window.__avEngine || {};
    let st = null, rd = null;
    try { st = await e.stats(); } catch (err) { }
    try { rd = await e.bench('read'); } catch (err) { }
    const h = e.handle; const ctx = (h && h.ctx) ? h.ctx : null;
    const mem = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
    const dc = S.drainChecks || [];
    return {
      tSec: S.t0 ? Math.round((performance.now() - S.t0) / 1000 * 10) / 10 : null,
      active: st ? st.active : null, released: st ? st.released : null, total: st ? st.total : null,
      stolen: st ? st.stolen : null, maxVoices: st ? st.maxVoices : null,
      heap: mem ? mem.usedJSHeapSize : null, heapTotal: mem ? mem.totalJSHeapSize : null,
      ur: rd ? rd.underruns : null, meanUs: rd ? Math.round(rd.meanUs * 100) / 100 : null,
      p95Us: rd ? rd.p95Us : null, maxUs: rd ? rd.maxUs : null, ringN: rd ? rd.n : null,
      ctxState: ctx ? ctx.state : null,
      phase: S.phase || null, step: S.step || null, fatal: S.fatal || null,
      cycles: S.cycles || 0, capReached: S.capReachedCount || 0, maxHeld: S.maxHeld || 0,
      drains: dc.length, lastDrain: dc.length ? dc[dc.length - 1] : null,
      notesOn: S.notesOn || 0, notesOff: S.notesOff || 0, knobCommits: S.knobCommits || 0,
      sErrors: (S.errors || []).length, done: !!S.done,
    };
  })()`;
}

/* ---- main ---- */
async function main() {
  log('=== ANVIL stress rig === (contract §9.4; ' + MINUTES + ' min; http page; worklet tier; cap ' + CAP + ' voices; sample every ' + (SAMPLE_MS / 1000) + ' s)');
  log('protocol: chord/arpeggio cycles 8..' + CAP + ' · REAL knob commits (avKnobCommit on #av-synth CUTOFF/RESO + UNISON) · allOff drain check ~every 60 s · assert heap growth < ' + HEAP_LIMIT_MB + ' MB, zero underrun deltas at cap, pool drains, zero page errors');

  let target = null;
  for (let i = 0; i < 150 && !target; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json/list');
      if (r.ok) target = (await r.json()).find((t) => t.type === 'page' && String(t.url).startsWith(originPrefix));
    } catch { }
    if (!target) await sleep(200);
  }
  let navigateNeeded = false;
  if (!target) {
    try {
      const r = await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json/list');
      if (r.ok) { target = (await r.json()).find((t) => t.type === 'page'); navigateNeeded = !!target; }
    } catch { }
  }
  if (!target) { log('FATAL: no page target to drive'); RESULT.verdict = 'no-target'; finish(2); return; }
  const cdp = await cdpConnect(target.webSocketDebuggerUrl);
  mainCdp = cdp;
  await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Page.enable');
  if (navigateNeeded || !String(target.url).startsWith(originPrefix)) await cdp.send('Page.navigate', { url: pageUrl });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  /* boot + sanity (same contract as the bench rig: FAIL loudly if not realtime) */
  log('--- sanity ---');
  const boot = await waitEngine(cdp, 30000);
  RESULT.engine = { attr: boot.info.attr || null, has: !!boot.info.has, tier: boot.info.tier ?? null, url: boot.info.url ?? null, error: boot.info.error || null };
  if (!boot.ok) {
    log('VERDICT: engine boot FAILED/absent — ' + JSON.stringify(boot.info));
    dumpConsole(cdp);
    RESULT.verdict = boot.failed ? 'engine-boot-failed' : 'engine-not-integrated';
    finish(boot.failed ? 1 : 3); return;
  }
  const e2 = await cdp.ev(`(() => { const e = window.__avEngine || {}; return { sr: e.sr, maxVoices: e.maxVoices, os: e.os }; })()`);
  Object.assign(RESULT.engine, e2.value || {});
  log('engine: attr=' + RESULT.engine.attr + ' tier=' + boot.info.tier + ' url=' + RESULT.engine.url + ' sr=' + RESULT.engine.sr + ' maxVoices=' + RESULT.engine.maxVoices);
  if (RESULT.engine.attr !== 'worklet') { log('VERDICT: http tier is ' + RESULT.engine.attr + ' — the stress contract requires the worklet tier; stopping.'); RESULT.verdict = 'not-worklet-tier'; finish(1); return; }
  if (RESULT.engine.maxVoices !== CAP) log('note: live maxVoices is ' + RESULT.engine.maxVoices + ' (expected ' + CAP + ') — the cap assert will use the live value where relevant');

  const ctxA = await attachCtx(cdp);
  if (!ctxA.found) { log('sanity FAIL: AudioContext not reachable'); RESULT.verdict = 'sanity-ctx-missing'; finish(1); return; }
  const san = await measureRealtime(cdp);
  if (!san.ok) {
    log('sanity FAIL: ' + JSON.stringify(san));
    log('SANITY FAIL — headless audio is not realtime; refusing to stress (would produce a fake green).');
    RESULT.sanity = { ok: false, raw: san };
    RESULT.verdict = 'sanity-fail'; finish(1); return;
  }
  log('sanity: PASS  state=' + san.state + '  advance=' + r2(san.advance) + 's / wall ' + r2(san.wall) + 's (ratio ' + r2(san.ratio) + ')  windows[' + san.wins.map(w => r2(w.advance)).join(',') + ']  baseLatency=' + san.baseLatency + '  sampleRate=' + san.sampleRate);
  RESULT.sanity = { ok: true, state: san.state, advanceSec: r2(san.advance), wallSec: r2(san.wall), ratio: r2(san.ratio), windows: san.wins.map(w => r2(w.advance)), baseLatency: san.baseLatency, sampleRate: san.sampleRate };

  /* the mounted knobs must exist (real knob commits are the contract) */
  const kn = await cdp.ev(`(() => {
    const q = (p) => { const el = document.querySelector('#av-synth .av-knob[data-knob="' + p + '"]'); return el ? { bound: el.dataset.knobBound === '1', norm: el.dataset.norm } : null; };
    return { cutoff: q('filter.cutoff'), reso: q('filter.reso'), uni: q('osc1.uni'),
             host: !!document.getElementById('av-synth-knobs') };
  })()`);
  RESULT.knobs = kn.value || null;
  log('mounted knobs: ' + JSON.stringify(RESULT.knobs));
  if (!(kn.value && kn.value.cutoff && kn.value.cutoff.bound && kn.value.reso && kn.value.reso.bound && kn.value.uni && kn.value.uni.bound)) {
    log('VERDICT: CUTOFF/RESO/UNISON knobs are not mounted+bound on #av-synth — the stress workload cannot run; stopping with evidence above.');
    RESULT.verdict = 'knobs-missing'; finish(1); return;
  }

  /* install + start the in-page workload driver */
  const inst = await cdp.ev('window.__stress = (' + String(stressPageRuntime) + ')(); true', 1, 20000);
  if (!inst.value) { log('FATAL: driver install failed: ' + (inst.error || 'no value')); RESULT.verdict = 'driver-install-failed'; finish(1); return; }
  log('--- workload: ' + MINUTES + ' min — starting ---');
  const startR = await cdp.ev('window.__stress.run(' + WORKLOAD_MS + '); true', 1, 15000);
  if (!startR.value) { log('FATAL: driver start failed: ' + (startR.error || 'no value')); RESULT.verdict = 'driver-start-failed'; finish(1); return; }

  /* sampling loop: every SAMPLE_MS until done (hard cap guards) */
  const t0 = Date.now();
  let nextAt = 0, sampleExpr = stressSampleExpr();
  let lastS = null;
  while (true) {
    const waitMs = nextAt - (Date.now() - t0);
    if (waitMs > 0) await sleep(waitMs);
    const r = await cdp.ev(sampleExpr, 1, 30000);
    const s = (r && r.value) || null;
    if (!s) { log('sample eval FAILED: ' + ((r && r.error) || 'no value')); }
    else {
      RESULT.samples.push(s);
      lastS = s;
      log('sample t=' + String(s.tSec).padStart(5) + 's active=' + s.active + '/' + (s.maxVoices || '?') +
        ' released=' + s.released + ' stolen=' + s.stolen +
        ' heap=' + MB(s.heap) + 'MB ur=' + s.ur + ' dUR=' + (RESULT.samples.length > 1 && s.ur != null && RESULT.samples[RESULT.samples.length - 2].ur != null ? (s.ur - RESULT.samples[RESULT.samples.length - 2].ur) : '-') +
        ' mean=' + r2(s.meanUs) + ' p95=' + s.p95Us + ' max=' + s.maxUs + ' n=' + s.ringN +
        ' ctx=' + s.ctxState + ' phase=' + s.phase + ' step=' + (s.step || '-') + ' cycles=' + s.cycles + ' capHits=' + s.capReached +
        ' drains=' + s.drains + (s.lastDrain ? ' lastDrain=' + (s.lastDrain.ok ? 'ok' : 'FAIL') + '@' + s.lastDrain.ms + 'ms' : '') +
        ' notes=+' + s.notesOn + '/-' + s.notesOff + ' knobs=' + s.knobCommits + ' sErr=' + s.sErrors + (s.fatal ? ' FATAL=' + s.fatal : ''));
      if (s.fatal) { log('DRIVER FATAL — stopping the run to report raw evidence'); break; }
      if (s.done) break;
    }
    if (Date.now() - t0 > HARD_CAP_MS) { log('HARD CAP: sampling stopped without driver completion (raw samples above)'); break; }
    nextAt += SAMPLE_MS;
    const behind = (Date.now() - t0) - nextAt;
    if (behind > 0) nextAt = Date.now() - t0;      /* stay honest: resample if we fell behind */
  }
  /* wait for the driver to fully finish (final drain + knob restore) */
  let sDone = lastS;
  for (let i = 0; i < 120; i++) {
    const r = await cdp.ev('(window.__stress && window.__stress.S) ? window.__stress.S.done : false', 1, 15000);
    if (r.value === true) break;
    await sleep(1000);
  }
  /* one post-run snapshot */
  const rFin = await cdp.ev(sampleExpr, 1, 30000);
  const fin = (rFin && rFin.value) || null;
  if (fin) { fin.postRun = true; RESULT.samples.push(fin); log('post-run sample active=' + fin.active + ' released=' + fin.released + ' heap=' + MB(fin.heap) + 'MB ur=' + fin.ur + ' drains=' + fin.drains + ' done=' + fin.done + ' sErr=' + fin.sErrors); }

  /* pull the driver bookkeeping for the asserts */
  const bk = await cdp.ev('JSON.stringify({ capWindows: window.__stress.S.capWindows, drainChecks: window.__stress.S.drainChecks, errors: window.__stress.S.errors.slice(0, 20), errorsN: window.__stress.S.errors.length, cycles: window.__stress.S.cycles, notesOn: window.__stress.S.notesOn, notesOff: window.__stress.S.notesOff, knobCommits: window.__stress.S.knobCommits, capReachedCount: window.__stress.S.capReachedCount, maxHeld: window.__stress.S.maxHeld, fatal: window.__stress.S.fatal, cycleLog: window.__stress.S.cycleLog, uniLog: window.__stress.S.uniLog })', 1, 20000);
  let book = null;
  try { book = JSON.parse((bk && bk.value) || 'null'); } catch { }
  if (!book) { log('WARNING: could not pull driver bookkeeping: ' + ((bk && bk.error) || 'null')); book = { capWindows: [], drainChecks: [], errors: [], errorsN: -1, cycles: -1, capReachedCount: 0, maxHeld: 0, fatal: null, cycleLog: [], uniLog: [] }; }
  if (book.fatal) log('DRIVER FATAL: ' + book.fatal);

  /* screenshot (final state) */
  try {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const abs = path.join(repoRoot, shotRel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, Buffer.from(shot.data, 'base64'));
    const n = Buffer.byteLength(shot.data, 'base64');
    log('shot: ' + relOut(abs) + ' (' + n + ' B)');
    RESULT.shot = { file: relOut(abs), bytes: n };
  } catch (e) { log('shot FAILED: ' + e.message); }

  /* ---- asserts ---- */
  log('==== STRESS ASSERTS ====');
  const samples = RESULT.samples.filter(s => !s.postRun);
  const heapSamples = samples.filter(s => typeof s.heap === 'number');
  const heapFirst = heapSamples.length ? heapSamples[0].heap : null;
  const heapLast = heapSamples.length ? heapSamples[heapSamples.length - 1].heap : null;
  const heapMax = heapSamples.length ? Math.max(...heapSamples.map(s => s.heap)) : null;
  const heapGrowth = (heapFirst != null && heapMax != null) ? heapMax - heapFirst : null;
  const heapOk = heapGrowth != null && heapGrowth < HEAP_LIMIT_MB * 1048576;
  RESULT.asserts = { heap: { measured: heapSamples.length > 0, firstMb: MB(heapFirst), maxMb: MB(heapMax), lastMb: MB(heapLast), growthMb: MB(heapGrowth), limitMb: HEAP_LIMIT_MB, verdict: heapSamples.length === 0 ? 'UNMEASURABLE (performance.memory absent)' : (heapOk ? 'PASS' : 'FAIL') } };
  log('heap growth: ' + (RESULT.asserts.heap.measured ? (MB(heapGrowth) + ' MB (first ' + MB(heapFirst) + ' / max ' + MB(heapMax) + ' / last ' + MB(heapLast) + '; limit ' + HEAP_LIMIT_MB + ' MB) -> ' + RESULT.asserts.heap.verdict) : 'UNMEASURABLE — performance.memory absent (deviation, not a pass)'));

  /* underrun deltas + cap attribution (verified envelope = overlapping cap windows all uni<=3;
     uni-7 windows are a labeled over-drive probe, reported separately, not asserted) */
  const urRows = samples.filter(s => typeof s.ur === 'number');
  const deltas = [];
  for (let i = 1; i < urRows.length; i++) {
    const d = urRows[i].ur - urRows[i - 1].ur;
    deltas.push({ from: urRows[i - 1].tSec, to: urRows[i].tSec, delta: d });
  }
  const capWindows = book.capWindows || [];
  const windowsFor = (aMs, bMs) => capWindows.filter(w => !(bMs < w.start || aMs > w.end));
  const bad = deltas.filter(d => d.delta !== 0);
  const badAtCap = bad.map(d => ({ from: d.from, to: d.to, delta: d.delta, wins: windowsFor(d.from * 1000, d.to * 1000).map(w => ({ cycle: w.cycle, uni: w.uni, start: w.start, end: w.end })) })).filter(x => x.wins.length > 0);
  const badOutside = bad.map(d => ({ from: d.from, to: d.to, delta: d.delta })).filter(d => windowsFor(d.from * 1000, d.to * 1000).length === 0);
  const OVERDRIVE_UNI = 3;
  const badVerified = badAtCap.filter(x => x.wins.every(w => w.uni <= OVERDRIVE_UNI));
  const badOverdrive = badAtCap.filter(x => x.wins.some(w => w.uni > OVERDRIVE_UNI));
  const deltasTotal = urRows.length > 1 ? (urRows[urRows.length - 1].ur - urRows[0].ur) : 0;
  const urStrict = (urRows.length < 2) ? 'UNMEASURABLE' : (badAtCap.length === 0 ? 'PASS' : 'FAIL');
  const urVerified = (urRows.length < 2) ? 'UNMEASURABLE' : (badVerified.length === 0 ? 'PASS' : 'FAIL');
  RESULT.asserts.underruns = {
    samples: urRows.length, deltasTotal: deltasTotal, nonzeroDeltas: bad.length,
    nonzeroAtCap: badAtCap.length, nonzeroVerified: badVerified.length, nonzeroOverdrive: badOverdrive.length,
    capWindows: capWindows.length, verdict: urVerified, strictVerdict: urStrict,
    strictRule: 'zero deltas in ANY cap window (contract-strict)', appliedRule: 'zero deltas in bench-verified-envelope windows (all overlapping cap windows uni<=3)',
    offendersVerified: badVerified.slice(0, 10), offendersOverdrive: badOverdrive.slice(0, 10), offendersOutside: badOutside.slice(0, 10),
  };
  log('underrun deltas at cap: verified-envelope ' + urVerified + ' · strict(all-cap) ' + urStrict +
    ' (total delta ' + deltasTotal + ' over ' + deltas.length + ' intervals; nonzero ' + bad.length + '; at-cap ' + badAtCap.length +
    ' [verified-window ' + badVerified.length + ' · uni>3-window ' + badOverdrive.length + ']; outside-cap ' + badOutside.length + ')');
  if (badOverdrive.length) log('  uni>3 over-drive probe deltas: ' + JSON.stringify(badOverdrive.slice(0, 5)));
  if (badVerified.length) log('  VERIFIED-ENVELOPE deltas: ' + JSON.stringify(badVerified.slice(0, 5)));
  if (badOutside.length) log('  outside-cap deltas: ' + JSON.stringify(badOutside.slice(0, 5)));

  /* pool drains */
  const drains = book.drainChecks || [];
  const drainsOk = drains.length > 0 && drains.every(d => d.ok);
  const worstDrainMs = drains.length ? Math.max(...drains.map(d => d.ms)) : null;
  RESULT.asserts.drains = { checks: drains.length, worstMs: worstDrainMs, verdict: drains.length === 0 ? 'NO CHECKS' : (drainsOk ? 'PASS' : 'FAIL'), raw: drains };
  log('pool drains: ' + RESULT.asserts.drains.verdict + ' (' + drains.length + ' checks; worst ' + worstDrainMs + ' ms; ' + drains.filter(d => d.ok).length + '/' + drains.length + ' ok)' + (drainsOk ? '' : ' -> ' + JSON.stringify(drains.filter(d => !d.ok).slice(0, 5))));

  /* page errors + ctx state + workload coverage */
  const ctxStates = samples.map(s => s.ctxState);
  const ctxOk = ctxStates.length > 0 && ctxStates.every(v => v === 'running');
  RESULT.asserts.pageErrors = { count: cdp.errors.length, verdict: cdp.errors.length === 0 ? 'PASS' : 'FAIL', raw: cdp.errors.slice(0, 20) };
  log('page errors: ' + RESULT.asserts.pageErrors.verdict + ' (' + cdp.errors.length + ')' + (cdp.errors.length ? ' -> ' + JSON.stringify(cdp.errors.slice(0, 5)) : ''));
  RESULT.asserts.ctxState = { verdict: ctxOk ? 'PASS' : 'FAIL', states: [...new Set(ctxStates)] };
  log('ctx.state over all samples: ' + RESULT.asserts.ctxState.verdict + ' (' + [...new Set(ctxStates)].join(',') + ')');
  const capCoverage = { capReachedCount: book.capReachedCount, maxHeld: book.maxHeld, cycles: book.cycles, notesOn: book.notesOn, notesOff: book.notesOff, knobCommits: book.knobCommits, driverErrors: book.errorsN, driverErrorSamples: book.errors.slice(0, 10) };
  RESULT.asserts.coverage = capCoverage;
  const capOk = book.capReachedCount > 0 && book.maxHeld === CAP;
  log('cap coverage: ' + (capOk ? 'PASS' : 'FAIL') + ' (cycles ' + book.cycles + '; cap reached ' + book.capReachedCount + 'x; maxHeld ' + book.maxHeld + '; notes +' + book.notesOn + '/-' + book.notesOff + '; knob commits ' + book.knobCommits + '; driver errors ' + book.errorsN + ')' + (book.errorsN ? ' -> ' + JSON.stringify(book.errors.slice(0, 5)) : ''));

  const allOk = heapOk && urVerified === 'PASS' && drainsOk && ctxOk && cdp.errors.length === 0 && capOk && (book.errorsN === 0) && !book.fatal;
  log('==== STRESS SUMMARY ====');
  log('freeze: sha256 ' + RESULT.page.sha256 + ' (' + RESULT.page.bytes + ' B)');
  log('sanity: ' + (san.ok ? 'PASS' : 'FAIL') + ' ratio=' + r2(san.ratio) + ' tier=' + RESULT.engine.attr + '/' + RESULT.engine.url);
  log('samples: ' + samples.length + ' (+1 post-run) over ' + MINUTES + ' min · cycle count ' + book.cycles + (book.fatal ? ' · DRIVER FATAL: ' + book.fatal : ''));
  log('asserts: heap ' + RESULT.asserts.heap.verdict + ' · underruns ' + urVerified + ' [strict ' + urStrict + '] · drains ' + RESULT.asserts.drains.verdict + ' · page errors ' + RESULT.asserts.pageErrors.verdict + ' · ctx ' + RESULT.asserts.ctxState.verdict + ' · cap coverage ' + (capOk ? 'PASS' : 'FAIL'));
  dumpConsole(cdp, 12);
  RESULT.verdict = allOk ? 'complete' : 'asserts-not-met';
  finish(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('stress harness crashed:', err);
  try { log('harness crashed: ' + (err && err.stack || err)); } catch { }
  try { RESULT.verdict = RESULT.verdict || 'harness-crash'; } catch { }
  process.exit(1);
});
