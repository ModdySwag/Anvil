// cdp_bench.mjs — Anvil P1 proof-benchmark rig (contract: verify/_p1_wave.md §9.1; T5 §7).
//
// Phases:
//   1. sanity   — serve the repo root over a private http port (scan from 9400), load
//                 http://127.0.0.1:<port>/index.html?avtest=1 in new-headless Chromium, wait for
//                 data-av-engine + window.__avEngine; assert ctx.state==='running' after a resume
//                 attempt AND that over 2 s wall ctx.currentTime advances >= 1.9 s (proves headless
//                 audio is realtime); record baseLatency + console messages. FAILS LOUDLY otherwise.
//   2. ramp     — variants LIGHT/FAT (§9.2), steps [1,2,4,8,16,24,32,48,64]; per step: bench reset,
//                 noteOn i notes (midi_i = 21+i), hold 10 s, bench read {meanUs,p95Us,maxUs,underruns},
//                 allOff + 0.5 s settle. Stable = p95Us < 1333 AND underruns == 0. 3 reps per variant.
//                 Per rep: max stable step (largest step whose whole prefix is stable).
//                 Published per variant = min over reps. JSON + human log + screenshot.
//   3. fallback — file:// load of the same page, expect tier 'spn', sanity + p95 at 8 voices
//                 (no full ramp: single-cell smoke of the degraded tier — the published number comes
//                 from the http ramp only, §9.1).
//
// Engine absent (no window.__avEngine / data-av-engine never flips): graceful
// 'engine not integrated yet' verdict in <60 s, exit 3 (that is today's state until P1 integration).
//
// Flags: --mock  serve verify/_bench_mock.html at /index.html (rig self-test; skips the fallback
//                cell and writes *_mock output files, so real outputs are never clobbered)
//        --quick light variant, 1 rep, steps [8,32,64]
//        --file <path>  page to serve at /index.html (default ../index.html; ignored with --mock)
//        --port <n>     pin the http port (default: first free from 9400)
//
//   node verify/cdp_bench.mjs [--mock] [--quick] [--file <path>] [--port N]
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
const hasFlag = (f) => argv.includes(f);
const argVal = (f, def) => { const i = argv.indexOf(f); return i > -1 && argv[i + 1] && !String(argv[i + 1]).startsWith('--') ? argv[i + 1] : def; };

const MOCK = hasFlag('--mock');
const QUICK = hasFlag('--quick');

/* ---- page resolution (--mock pins the self-test page) ---- */
let pageFile = path.resolve(argVal('--file', path.join(repoRoot, 'index.html')));
if (MOCK) pageFile = path.join(here, '_bench_mock.html');
if (!existsSync(pageFile)) { console.error('page not found: ' + pageFile); process.exit(2); }
const pageRel = path.relative(repoRoot, pageFile).replace(/\\/g, '/');

/* ---- protocol constants (§9.1 / §9.2) ---- */
const STEPS = QUICK ? [8, 32, 64] : [1, 2, 4, 8, 16, 24, 32, 48, 64];
const VARIANTS = QUICK ? ['light'] : ['light', 'fat'];
const REPS = QUICK ? 1 : 3;
const HOLD_MS = 10000, SETTLE_MS = 500;
const P95_LIMIT_US = 1333, NOTE_GAIN = 0.8;
const EVAL_TIMEOUT_MS = 12000;
const WATCHDOG_MS = 25 * 60 * 1000;

const PATCH_LIGHT = {
  'osc1.type': 'saw', 'osc1.level': 1.0, 'osc1.uni': 1,
  'osc2.type': 'wt.saw', 'osc2.level': 0.5, 'osc2.tune': 0,
  'filter.mode': 'lp24', 'filter.cutoff': 800, 'filter.reso': 0.3, 'filter.envAmt': 2,
  'env1.a': 0.002, 'env1.d': 0.3, 'env1.s': 0.8, 'env1.r': 0.2,
  'env2.a': 0.001, 'env2.d': 0.5, 'env2.s': 0.5, 'env2.r': 0.3,
  'lfo.toCut': 0, 'lfo.toPitch': 0,
};
const PATCH_FAT = Object.assign({}, PATCH_LIGHT, {
  'osc1.uni': 3, 'osc1.spread': 15, 'osc2.uni': 2, 'osc2.spread': 20,
  'lfo.toCut': 0.3, 'lfo.rate': 5, 'voice.glide': 0.03,
});
const PATCHES = { light: PATCH_LIGHT, fat: PATCH_FAT };

/* ---- outputs (mock runs use *_mock names so the real artifacts stay untouched) ---- */
const outDir = path.join(repoRoot, 'verify');
const logPath = path.join(outDir, MOCK ? 'last-cdp_bench_mock.log' : 'last-cdp_bench.log');
const jsonPath = path.join(outDir, MOCK ? 'last-cdp_bench_mock.json' : 'last-cdp_bench.json');
const shotRel = path.join('renders', MOCK ? 'p1-bench-mock.png' : 'p1-bench.png');
const relOut = (p) => path.relative(repoRoot, p).replace(/\\/g, '/');

try { writeFileSync(logPath, ''); } catch { }
function log(s) {
  const line = String(s);
  console.log(line);
  try { appendFileSync(logPath, line + '\n'); } catch { }
}

const RESULT = {
  kind: 'anvil-cdp-bench', version: 1,
  mode: MOCK ? 'mock' : 'real', quick: QUICK,
  startedAt: new Date().toISOString(), finishedAt: null,
  page: { file: pageRel, bytes: 0, sha256: null, servedPath: '/index.html', mockOverride: MOCK },
  protocol: {
    steps: STEPS, reps: REPS, variants: VARIANTS, holdMs: HOLD_MS, settleMs: SETTLE_MS,
    stability: 'p95Us < ' + P95_LIMIT_US + ' && underruns == 0',
    publishedRule: 'per rep: largest step whose stable-prefix is contiguous; per variant: min over reps',
  },
  patches: PATCHES,
  env: { node: process.version, platform: process.platform },
  engine: null, sanity: null, variants: {}, published: {},
  mock: MOCK ? {} : undefined, fallback: null,
  shot: null, console: [], pageErrors: [], verdict: null, exitCode: null,
};
function writeJson() {
  try { writeFileSync(jsonPath, JSON.stringify(RESULT, null, 2)); } catch (e) { console.error('json write failed: ' + e.message); }
}
const r2 = (v) => (typeof v === 'number' && isFinite(v)) ? Math.round(v * 100) / 100 : v;
const r3 = (v) => (typeof v === 'number' && isFinite(v)) ? Math.round(v * 1000) / 1000 : v;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- freeze line ---- */
{
  const bytes = readFileSync(pageFile);
  RESULT.page.bytes = bytes.length;
  RESULT.page.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  log('freeze sha256 ' + RESULT.page.sha256 + ' (' + bytes.length + ' B)');
  log('serving ' + (MOCK ? '[MOCK] ' : '') + pageRel + ' at /index.html' + (MOCK && argVal('--file', null) ? ' (--file ignored with --mock)' : ''));
}

/* ---- static server (repo root) ---- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.webm': 'video/webm', '.mp4': 'video/mp4',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};
const server = http.createServer((req, res) => {
  try {
    const u = new URL(req.url, 'http://127.0.0.1');
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || p === '') p = '/index.html';
    if (MOCK && p === '/index.html') {
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      res.end(readFileSync(pageFile));
      return;
    }
    const abs = path.resolve(repoRoot, '.' + p);
    if (abs !== repoRoot && !abs.startsWith(repoRoot + path.sep)) { res.writeHead(403); res.end('forbidden'); return; }
    if (!existsSync(abs) || !statSync(abs).isFile()) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(abs));
  } catch (e) {
    try { res.writeHead(500); res.end('server error'); } catch { }
  }
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
const PORT = portArg ? Number(portArg) : await freePort(9400);          // static server port
const DEBUG_PORT = await freePort(PORT + 1);                            // DevTools endpoint — must be distinct from the server
await new Promise((res) => server.listen(PORT, '127.0.0.1', res));
const originPrefix = 'http://127.0.0.1:' + PORT + '/';
const benchUrl = originPrefix + 'index.html?avtest=1';
log('server: ' + originPrefix + ' (repo root ' + repoRoot + ')');
log('devtools port: ' + DEBUG_PORT);
RESULT.server = { port: PORT, debugPort: DEBUG_PORT, url: benchUrl };

/* ---- browser (launch block copied verbatim from cdp_smoke.mjs) ---- */
const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
];
const exe = candidates.find(existsSync);
if (!exe) { console.error('no chromium found'); process.exit(2); }
const profile = path.join(tmpdir(), 'anvil-bench-' + Date.now());
log('using browser: ' + exe);
log('url: ' + benchUrl);
RESULT.browser = exe;
const chrome = spawn(exe, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--disable-sync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
  benchUrl,
], { stdio: 'ignore', windowsHide: true });

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  try { chrome.kill(); } catch { }
  try { server.close(); } catch { }
  try {
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile.replace(/[\\\\/]/g, '\\\\\\\\')}*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
}
function finish(code) {
  try { clearTimeout(watchdog); } catch { }
  RESULT.finishedAt = new Date().toISOString();
  RESULT.exitCode = code;
  if (mainCdp) {
    RESULT.console = mainCdp.consoleAll.slice(0, 100);
    RESULT.pageErrors = mainCdp.errors.slice(0, 50);
  }
  writeJson();
  process.exit(code);
}
process.on('exit', () => { writeJson(); cleanup(); });
process.on('SIGINT', () => { log('SIGINT — cleaning up'); try { RESULT.verdict = RESULT.verdict || 'interrupted'; } catch { } process.exit(130); });
const watchdog = setTimeout(() => {
  log('WATCHDOG: rig exceeded ' + Math.round(WATCHDOG_MS / 60000) + ' min — dumping state and exiting');
  RESULT.verdict = RESULT.verdict || 'watchdog-timeout';
  process.exit(4);
}, WATCHDOG_MS);

/* ---- CDP plumbing ---- */
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
  api.ev = async (expr, tries = 2) => {
    for (let t = 0; ; t++) {
      const r = await api.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: EVAL_TIMEOUT_MS });
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
  const list = cdp.consoleAll;
  log('console messages: ' + list.length);
  for (const line of list.slice(-(n || 40))) log('  ' + line.replace(/\s+/g, ' ').slice(0, 300));
}

/* ---- phase helpers ---- */
async function waitEngine(cdp, maxMs) {
  const t0 = Date.now();
  let info = {};
  while (Date.now() - t0 < maxMs) {
    const r = await cdp.ev(`(() => {
      const e = window.__avEngine;
      return { attr: document.documentElement.getAttribute('data-av-engine'),
               mockFlag: document.documentElement.getAttribute('data-av-mock'),
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
    const ctx = find(e.handle) || find(e.ctx) || find(window.__mockBench) || find(e);
    if (!ctx) return { found: false };
    window.__benchCtx = ctx;
    return { found: true, state: ctx.state, sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency };
  })()`);
  return r.value || { found: false, error: r.error };
}

async function measureRealtime(cdp) {
  const r = await cdp.ev(`(async () => {
    const ctx = window.__benchCtx;
    if (!ctx) return { err: 'no ctx handle' };
    if (ctx.state !== 'running') { try { await Promise.race([ctx.resume().catch(() => {}), new Promise((res) => setTimeout(res, 1500))]); } catch (e) { } }
    for (let i = 0; i < 16 && ctx.state !== 'running'; i++) await new Promise((res) => setTimeout(res, 125));
    const t0 = performance.now();
    const c0 = ctx.currentTime;
    await new Promise((res) => setTimeout(res, 2000));
    const c1 = ctx.currentTime;
    const wall = (performance.now() - t0) / 1000;
    return { state: ctx.state, c0: c0, c1: c1, wall: wall, advance: c1 - c0,
             ratio: wall > 0 ? (c1 - c0) / wall : 0, baseLatency: ctx.baseLatency, sampleRate: ctx.sampleRate };
  })()`, 3);
  const v = (r && r.value) || {};
  if (v.err || typeof v.advance !== 'number') return { ok: false, err: (r && r.error) || v.err || 'sanity eval failed', raw: v };
  v.ok = v.state === 'running' && v.advance >= 1.9;
  return v;
}

async function applyPatch(cdp, variant) {
  const p = PATCHES[variant];
  const r = await cdp.ev('(() => { const e = window.__avEngine; const p = ' + JSON.stringify(p) +
    '; const bad = []; for (const k in p) { try { if (e.setParam(k, p[k]) === false) bad.push(k); } catch (err) { bad.push(k + " (threw)"); } } return bad; })()');
  return Array.isArray(r.value) ? r.value : [];
}

async function runStep(cdp, step) {
  const t0 = Date.now();
  await cdp.ev(`window.__avEngine.bench('reset')`);
  await cdp.ev(`(() => { const e = window.__avEngine; for (let i = 0; i < ${step}; i++) e.noteOn(${21} + i, ${NOTE_GAIN}); return true; })()`);
  await sleep(HOLD_MS);
  const rd = await cdp.ev(`window.__avEngine.bench('read')`);
  const st = await cdp.ev(`window.__avEngine.stats()`);
  await cdp.ev(`window.__avEngine.allOff()`);
  await sleep(SETTLE_MS);
  return analyzeRow(step, rd, st, Date.now() - t0);
}

function analyzeRow(step, rd, st, wallMs) {
  const row = { step, wallMs };
  const d = rd && rd.value;
  if (!d || !['meanUs', 'p95Us', 'maxUs', 'underruns'].every((k) => typeof d[k] === 'number' && isFinite(d[k]))) {
    row.invalid = true;
    row.note = (rd && rd.error) ? String(rd.error) : ('bench read unusable: ' + JSON.stringify(d));
    row.stable = false;
    return row;
  }
  row.meanUs = r2(d.meanUs);
  row.p95Us = r2(d.p95Us);
  row.maxUs = r2(d.maxUs);
  row.underruns = d.underruns;
  row.n = typeof d.n === 'number' ? d.n : null;
  if (Array.isArray(d.ring)) row.ring = d.ring.map(r2);
  row.stable = row.p95Us < P95_LIMIT_US && row.underruns === 0;
  const s = st && st.value;
  if (s && typeof s === 'object') row.stats = { active: s.active, released: s.released, total: s.total, stolen: s.stolen, maxVoices: s.maxVoices };
  return row;
}

const maxStablePrefix = (rows) => { let m = 0; for (const r of rows) { if (r.stable) m = r.step; else break; } return m; };

function stepLine(variant, rep, row) {
  if (row.invalid) return '  ' + variant + ' r' + rep + ' step ' + String(row.step).padStart(2) + '  INVALID READ  ' + row.note;
  const why = row.stable ? '' : (row.underruns > 0 && row.p95Us >= P95_LIMIT_US ? ' (p95 + underruns)' : row.underruns > 0 ? ' (underruns)' : ' (p95 >= ' + P95_LIMIT_US + ')');
  return '  ' + variant + ' r' + rep + ' step ' + String(row.step).padStart(2) +
    '  voices ' + (row.stats ? row.stats.active : '?') +
    '  mean ' + row.meanUs + '  p95 ' + row.p95Us + '  max ' + row.maxUs +
    '  underruns ' + row.underruns + '  n ' + row.n + '  -> ' + (row.stable ? 'ok' : 'UNSTABLE' + why);
}

async function shoot(cdp, rel) {
  try {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const abs = path.join(repoRoot, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, Buffer.from(r.data, 'base64'));
    const n = Buffer.byteLength(r.data, 'base64');
    log('shot: ' + rel.replace(/\\/g, '/') + ' (' + n + ' B)');
    RESULT.shot = { file: rel.replace(/\\/g, '/'), bytes: n };
    return true;
  } catch (e) { log('shot FAILED: ' + e.message); return false; }
}

/* ---- fallback cell (real mode only: file:// load, expect tier spn) ---- */
async function fallbackCell() {
  log('--- fallback cell (file:// load, expect tier spn; no full ramp: single-cell smoke of the degraded tier — the published number comes from the http ramp only) ---');
  /* forced spn: data:-URL worklets DO load on file:// in current Chromium (probe 2026-10-07), so
     an auto ladder lands on worklet:data — this cell deliberately forces the degraded tier */
  const fileUrl = 'file:///' + path.resolve(pageFile).replace(/\\/g, '/') + '?avtest=1&avengine=spn';
  let cdp2 = null;
  const info = { url: fileUrl };
  try {
    const t2r = await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json/new?' + encodeURIComponent(fileUrl), { method: 'PUT' });
    if (t2r.ok) {
      const t2 = await t2r.json();
      info.targetId = t2.id;
      cdp2 = await cdpConnect(t2.webSocketDebuggerUrl);
      await cdp2.send('Runtime.enable'); await cdp2.send('Log.enable'); await cdp2.send('Page.enable');
    } else { info.newTabError = 'HTTP ' + t2r.status; }
  } catch (e) { info.newTabError = String(e.message || e); }
  if (!cdp2) {
    log('fallback: new file:// target unavailable (' + (info.newTabError || 'no ws') + ') — trying Page.navigate on the main tab');
    try { await mainCdp.send('Page.navigate', { url: fileUrl }); cdp2 = mainCdp; info.via = 'Page.navigate'; }
    catch (e) { log('fallback: navigate failed: ' + e.message); }
  }
  if (!cdp2) { log('fallback: NO DATA'); RESULT.fallback = { ok: false, info }; return; }
  const boot = await waitEngine(cdp2, 30000);
  if (!boot.ok) {
    log('fallback: engine never came up on file:// — ' + JSON.stringify(boot.info));
    RESULT.fallback = { ok: false, info, boot: boot.info };
    return;
  }
  const tier = boot.info.attr;
  log('fallback tier: ' + tier + (tier === 'spn' ? ' (as expected)' : '  *** expected spn — noting as deviation ***'));
  const ctxA = await attachCtx(cdp2);
  const san = ctxA.found ? await measureRealtime(cdp2) : { ok: false, err: 'ctx not reachable' };
  log('fallback sanity: ' + (san.ok ? 'PASS' : 'FAIL') + '  state=' + (san.state || san.err) +
    '  advance=' + (typeof san.advance === 'number' ? r3(san.advance) + 's' : '—') +
    '  ratio=' + (typeof san.ratio === 'number' ? r3(san.ratio) : '—'));
  if (!san.ok) { RESULT.fallback = { ok: false, tier, sanity: san, info }; return; }
  await cdp2.ev(`window.__avEngine.bench('reset')`);
  await cdp2.ev(`(() => { const e = window.__avEngine; for (let i = 0; i < 8; i++) e.noteOn(${21} + i, ${NOTE_GAIN}); return true; })()`);
  await sleep(HOLD_MS);
  const rd = await cdp2.ev(`window.__avEngine.bench('read')`);
  await cdp2.ev(`window.__avEngine.allOff()`);
  await sleep(SETTLE_MS);
  const row = analyzeRow(8, rd, null, HOLD_MS);
  log('fallback 8-voice cell: ' + (row.invalid ? 'INVALID — ' + row.note :
    'mean ' + row.meanUs + '  p95 ' + row.p95Us + '  max ' + row.maxUs + '  underruns ' + row.underruns + '  -> ' + (row.stable ? 'stable' : 'UNSTABLE')));
  RESULT.fallback = {
    ok: true, tier, tierExpected: 'spn', tierMatches: tier === 'spn', cell: row, info,
    whyNoRamp: 'file:// is a single-cell smoke of the degraded tier; the published number comes from the http ramp only (§9.1)',
  };
  try { await mainCdp.send('Target.closeTarget', { targetId: info.targetId }); } catch { }
}

/* ---- main ---- */
async function main() {
  log('=== ANVIL bench rig === mode: ' + (MOCK ? 'MOCK (verify/_bench_mock.html served at /index.html)' : 'real') + (QUICK ? ' [quick]' : ''));
  log('protocol: variants ' + VARIANTS.join('+') + ' · steps [' + STEPS.join(',') + '] · ' + REPS + ' rep(s) · hold ' + (HOLD_MS / 1000) + ' s · stable = p95Us<' + P95_LIMIT_US + ' && underruns==0');

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
  if (!target) { log('FATAL: no page target to drive (browser did not come up)'); RESULT.verdict = 'no-target'; finish(2); return; }
  const cdp = await cdpConnect(target.webSocketDebuggerUrl);
  mainCdp = cdp;
  await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Page.enable');
  if (navigateNeeded || !String(target.url).startsWith(originPrefix)) await cdp.send('Page.navigate', { url: benchUrl });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  /* 1. boot + sanity */
  log('--- sanity ---');
  const bootT0 = Date.now();
  const boot = await waitEngine(cdp, 30000);
  RESULT.engine = {
    attr: boot.info.attr || null, has: !!boot.info.has, ready: !!boot.info.ready,
    tier: boot.info.tier ?? null, url: boot.info.url ?? null, mockFlag: boot.info.mockFlag || null,
    error: boot.info.error || null, bootMs: Date.now() - bootT0,
  };
  if (!boot.ok) {
    if (boot.failed) {
      log('VERDICT: engine boot FAILED (data-av-engine=failed: ' + (RESULT.engine.error || 'no error text') + ')');
      dumpConsole(cdp);
      RESULT.verdict = 'engine-boot-failed';
      finish(1); return;
    }
    log('VERDICT: engine not integrated yet — no window.__avEngine and data-av-engine never flipped (waited ' +
      ((Date.now() - bootT0) / 1000).toFixed(1) + ' s).');
    log('This is expected until the P1 engine lands (agents K/E + parent build); run with --mock to self-test the rig.');
    dumpConsole(cdp);
    RESULT.verdict = 'engine-not-integrated';
    finish(3); return;
  }
  const e2 = await cdp.ev(`(() => { const e = window.__avEngine || {}; return { sr: e.sr, maxVoices: e.maxVoices, os: e.os }; })()`);
  Object.assign(RESULT.engine, e2.value || {});
  log('engine: attr=' + RESULT.engine.attr + ' tier=' + RESULT.engine.tier + ' url=' + RESULT.engine.url +
    ' sr=' + RESULT.engine.sr + ' maxVoices=' + RESULT.engine.maxVoices + ' os=' + RESULT.engine.os +
    (RESULT.engine.mockFlag ? ' [mock page]' : '') + ' (boot ' + RESULT.engine.bootMs + ' ms)');
  if (!MOCK && RESULT.engine.attr !== 'worklet') log('NOTE: http tier is ' + RESULT.engine.attr + ' (expected worklet in the integrated build)');

  const ctxA = await attachCtx(cdp);
  if (!ctxA.found) {
    log('sanity FAIL: AudioContext not reachable via __avEngine.handle.ctx / __avEngine.ctx — rig cannot verify realtime.');
    RESULT.sanity = { ok: false, err: 'ctx not reachable (expected __avEngine.handle.ctx)' };
    dumpConsole(cdp);
    RESULT.verdict = 'sanity-ctx-missing';
    finish(1); return;
  }
  const san = await measureRealtime(cdp);
  if (!san.ok) {
    log('sanity FAIL: ' + JSON.stringify(san));
    log('SANITY FAIL — headless audio is not realtime; refusing to ramp (this path would have produced a fake published number).');
    dumpConsole(cdp);
    RESULT.sanity = { ok: false, raw: san };
    RESULT.verdict = 'sanity-fail';
    finish(1); return;
  }
  log('sanity: PASS  state=' + san.state + '  advance=' + r3(san.advance) + 's / wall ' + r3(san.wall) + 's (ratio ' + r3(san.ratio) + ')  baseLatency=' + san.baseLatency + '  sampleRate=' + san.sampleRate);
  RESULT.sanity = {
    ok: true, state: san.state, advanceSec: r3(san.advance), wallSec: r3(san.wall), ratio: r3(san.ratio),
    baseLatency: san.baseLatency, sampleRate: san.sampleRate, tier: RESULT.engine.attr, url: RESULT.engine.url,
    consoleCount: cdp.consoleAll.length,
  };
  dumpConsole(cdp, 20);

  /* 1b. mock self-check + driver exercise */
  if (MOCK) {
    const mc = await cdp.ev(`(() => { const b = window.__mockBench || {}; const e = window.__avEngine || {}; return { blobWorklet: b.blobWorklet === true, proto: b.proto || null, tier: e.tier || null, url: e.url || null, driver: typeof b.run === 'function', clock: b.clock || null }; })()`);
    const mcv = (mc && mc.value) || {};
    log('mock self-check: blobWorklet=' + mcv.blobWorklet + '  delivery=' + mcv.proto + '  tier=' + mcv.tier + '  url=' + mcv.url + '  driver=' + mcv.driver + '  clock=' + mcv.clock);
    RESULT.mock = { blobWorklet: mcv.blobWorklet, delivery: mcv.proto, tier: mcv.tier, url: mcv.url, driver: mcv.driver, clock: mcv.clock, driverRun: null, realtimeRatio: RESULT.sanity.ratio };
    const dr = await cdp.ev('window.__mockBench.run(8, 1)');
    log('mock driver run(8,1): ' + JSON.stringify((dr && dr.value) || (dr && dr.error) || null));
    RESULT.mock.driverRun = (dr && dr.value) || null;
  }

  /* 2. ramp */
  log('--- ramp ---');
  let invalidReads = 0;
  for (const variant of VARIANTS) {
    const v = { patch: PATCHES[variant], reps: [], published: null };
    RESULT.variants[variant] = v;
    const badParams = await applyPatch(cdp, variant);
    log('variant ' + variant.toUpperCase() + ': patch applied' + (badParams.length ? ' — setParam returned false for: ' + badParams.join(', ') : ' (all params accepted)'));
    for (let rep = 1; rep <= REPS; rep++) {
      const repT0 = Date.now();
      const rows = [];
      for (const step of STEPS) {
        const row = await runStep(cdp, step);
        if (row.invalid) invalidReads++;
        rows.push(row);
        log(stepLine(variant, rep, row));
      }
      const maxStable = maxStablePrefix(rows);
      v.reps.push({ rep, wallMs: Date.now() - repT0, maxStable, steps: rows });
      log('  ' + variant + ' rep ' + rep + ' max stable: ' + maxStable + ' / ' + STEPS[STEPS.length - 1]);
      writeJson();
    }
    v.published = Math.min(...v.reps.map((r) => r.maxStable));
    RESULT.published[variant] = v.published;
    log(variant.toUpperCase() + ' PUBLISHED: ' + v.published);
  }

  /* 3. screenshot, fallback cell */
  await sleep(350);
  await shoot(cdp, shotRel);
  if (MOCK) {
    log('fallback cell: skipped in --mock (the mock page has no tier ladder; the file:// cell targets the real facade — §9.1)');
    RESULT.fallback = { skipped: true, why: 'mock page has no spn tier; fallback cell targets the real facade ladder' };
  } else {
    await fallbackCell();
  }

  /* summary */
  log('==== BENCH SUMMARY ====');
  log('mode: ' + RESULT.mode + (QUICK ? ' (quick)' : ''));
  log('freeze: sha256 ' + RESULT.page.sha256 + ' (' + RESULT.page.bytes + ' B) [' + RESULT.page.file + ']');
  log('tier: ' + RESULT.engine.attr + ' (delivery ' + (RESULT.engine.url || '?') + ')');
  log('sanity: PASS  advance=' + RESULT.sanity.advanceSec + 's/2s  ratio=' + RESULT.sanity.ratio + '  baseLatency=' + RESULT.sanity.baseLatency);
  if (MOCK) log('mock: blobWorklet=' + RESULT.mock.blobWorklet + '  driver=' + JSON.stringify(RESULT.mock.driverRun));
  log('published: ' + JSON.stringify(RESULT.published));
  log('json: ' + relOut(jsonPath));
  log('log: ' + relOut(logPath));
  if (RESULT.shot) log('shot: ' + RESULT.shot.file);
  log('BENCH-RESULT ' + JSON.stringify({
    mode: RESULT.mode, quick: QUICK, tier: RESULT.engine.attr, url: RESULT.engine.url,
    realtimeRatio: RESULT.sanity.ratio,
    blobWorklet: MOCK && RESULT.mock ? RESULT.mock.blobWorklet : undefined,
    published: RESULT.published, invalidReads, json: relOut(jsonPath), log: relOut(logPath),
  }));

  RESULT.verdict = 'complete';
  finish(invalidReads > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('bench harness crashed:', err);
  try { log('harness crashed: ' + (err && err.stack || err)); } catch { }
  try { RESULT.verdict = RESULT.verdict || 'harness-crash'; } catch { }
  process.exit(1);
});
