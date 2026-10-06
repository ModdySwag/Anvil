// cdp_alias.mjs — Anvil P1 aliasing-floor rig (contract: verify/_p1_wave.md §9.3).
//
// Offline renders via the page's global avEngineBoot (facade supports OfflineAudioContext; the tap
// chain exists, never live). Per case: ONE note held; delivery proven by the stats() barrier
// (await h.stats() after the note post, before startRendering — the rev3 lesson from the bench rig:
// without it the queued note messages race startRendering and you measure a 1-voice... or zero-voice
// render). 3 s renders; the LAST 2^17 samples are Blackman-windowed and FFT'd IN-PAGE (own radix-2,
// validated first on synthetic signals). Metric: worst NON-harmonic spur in dBc vs the carrier
// (max |X| within the ±3-bin window around f0); bins below 20 Hz are ignored; ±3 bins around every
// harmonic of f0 are masked. Cases: VA saw/square/pulse(pw .3)/tri/sine and the WT bank
// (wt.saw/wt.square/wt.tri/wt.sine/wt.pulse25) at C4 261.63 / A4 440 / C6 1046.5 (exact ET f0);
// osc alone (other level 0, sub 0), filter lp12 20000 reso 0 envAmt 0 (static open), env sustain 1.
// Gates: VA <= -45 dBc at >=C4; WT <= -80 dBc. Cross-rate spot: 44.1 kHz VA saw C4 + wt.saw A4.
// Determinism: two fresh offline engines, same patch/note -> bit-identical (max abs diff === 0).
//
// MEASUREMENT FLOOR (honest record, discovered + proven in the validation phase): a Blackman-windowed
// 2^17 FFT of any OFF-BIN signal leaks its first sidelobe at ~-57 dBc right outside a ±3-bin mask
// (the fundamental's shoulder). Every case here is off-bin (C4/A4/C6 are not multiples of sr/2^17),
// so the contract metric's floor is ~-57 dBc: VA can pass -45; the WT -80 gate cannot be evaluated
// below that floor by this metric. The rig therefore also records, for interpretation ONLY (clearly
// labeled diagnostic, NOT the contract metric): the same worst-spur computed with a ±30-bin mask
// (leakage-excluded view, floor ~-106 dBc) and the per-pitch synthetic leakage floor.
//
// Usage: node verify/cdp_alias.mjs [--port N]
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

const EVAL_TIMEOUT_MS = 60000;              /* per-case boot+render+2x FFT round trip */
const WATCHDOG_MS = 15 * 60 * 1000;         /* expected ~3-8 min */
const NOTE_GAIN = 0.8;                      /* same as the bench rig */
const RENDER_SECONDS = 3;                   /* §9.3 pin */
const FFT_N = 131072;                       /* 2^17 */
const MASK_BINS = 3;                        /* §9.3 pin: ±3 bins around each harmonic */
const DIAG_MASK_BINS = 30;                  /* diagnostic only: leakage-excluded view */
const SPUR_IGNORE_HZ = 20;                  /* §9.3 pin */
const GATE_VA_DBC = -45, GATE_WT_DBC = -80; /* §9.3 gates */

const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
const PITCHES = [
  { name: 'C4', midi: 60 },
  { name: 'A4', midi: 69 },
  { name: 'C6', midi: 84 },
].map(p => Object.assign({}, p, { f0: midiFreq(p.midi) }));
const VA_TYPES = ['saw', 'square', 'pulse', 'tri', 'sine'];
const WT_TYPES = ['wt.saw', 'wt.square', 'wt.tri', 'wt.sine', 'wt.pulse25'];
/* case baseline (§9.3): osc alone (both levels 0, overridden per case), sub 0, filter lp12 open
   (cutoff 20000, reso 0, envAmt 0 -> static open), env1 sustain 1, LFO routing 0, uni 1 */
const CASE_BASE = {
  'osc1.level': 0, 'osc2.level': 0, 'sub.level': 0,
  'filter.mode': 'lp12', 'filter.cutoff': 20000, 'filter.reso': 0, 'filter.envAmt': 0,
  'env1.a': 0.001, 'env1.d': 0.3, 'env1.s': 1, 'env1.r': 0.2,
  'lfo.toCut': 0, 'lfo.toPitch': 0, 'voice.glide': 0,
  'osc1.uni': 1, 'osc2.uni': 1,
};
function vaSpec(type, pitch) {
  const params = Object.assign({}, CASE_BASE, { 'osc1.type': type, 'osc1.level': 1 });
  if (type === 'pulse') params['osc1.pw'] = 0.3;             /* §9.3: pulse(pw 0.3) */
  return { name: 'VA ' + type + ' ' + pitch.name, kind: 'va', sub: type, pitchName: pitch.name, midi: pitch.midi, f0: pitch.f0, sr: 48000, seconds: RENDER_SECONDS, params };
}
function wtSpec(type, pitch) {
  return { name: 'WT ' + type + ' ' + pitch.name, kind: 'wt', sub: type, pitchName: pitch.name, midi: pitch.midi, f0: pitch.f0, sr: 48000, seconds: RENDER_SECONDS, params: Object.assign({}, CASE_BASE, { 'osc2.type': type, 'osc2.level': 1 }) };
}
const CASE_SPECS = [];
for (const t of VA_TYPES) for (const p of PITCHES) CASE_SPECS.push(vaSpec(t, p));
for (const t of WT_TYPES) for (const p of PITCHES) CASE_SPECS.push(wtSpec(t, p));
const CROSS_SPECS = [
  Object.assign(vaSpec('saw', PITCHES[0]), { name: 'cross 44.1k VA saw C4', sr: 44100 }),
  Object.assign(wtSpec('wt.saw', PITCHES[1]), { name: 'cross 44.1k WT wt.saw A4', sr: 44100 }),
];
const DET_SPECS = [                              /* determinism pairs (fresh engines, same patch/note) */
  Object.assign(vaSpec('saw', PITCHES[0]), { name: 'det VA saw C4' }),
  Object.assign(wtSpec('wt.saw', PITCHES[0]), { name: 'det WT wt.saw C4' }),
];

/* ---- outputs (log only; scope-pinned) ---- */
const outDir = path.join(repoRoot, 'verify');
const logPath = path.join(outDir, 'last-cdp_alias.log');
const relOut = (p) => path.relative(repoRoot, p).replace(/\\/g, '/');
try { writeFileSync(logPath, ''); } catch { }     /* fresh log per run (house bench style) */
function log(s) {
  const line = String(s);
  console.log(line);
  try { appendFileSync(logPath, line + '\n'); } catch { }
}

const RESULT = {
  kind: 'anvil-cdp-alias', version: 1,
  startedAt: new Date().toISOString(), finishedAt: null,
  page: { file: pageRel, bytes: 0, sha256: null },
  protocol: {
    seconds: RENDER_SECONDS, fftN: FFT_N, window: 'Blackman', maskBins: MASK_BINS, diagMaskBins: DIAG_MASK_BINS,
    ignoreBelowHz: SPUR_IGNORE_HZ, gates: { vaDbc: GATE_VA_DBC, wtDbc: GATE_WT_DBC },
    segment: 'last 2^17 samples of the 3 s render', delivery: 'noteOn -> await h.stats() -> require active===1 -> startRendering',
  },
  validation: null, floors: null, cases: [], cross: [], determinism: [], gates: null, verdict: null, exitCode: null,
  console: [], pageErrors: [],
};
const r2 = (v) => (typeof v === 'number' && isFinite(v)) ? Math.round(v * 100) / 100 : v;
const r3 = (v) => (typeof v === 'number' && isFinite(v)) ? Math.round(v * 1000) / 1000 : v;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- freeze line ---- */
{
  const bytes = readFileSync(PAGE_FILE);
  RESULT.page.bytes = bytes.length;
  RESULT.page.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  log('freeze sha256 ' + RESULT.page.sha256 + ' (' + bytes.length + ' B) [' + pageRel + ']');
}

/* ---- static server (repo root) — same pattern as the bench rig ---- */
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
const PORT = portArg ? Number(portArg) : await freePort(9500);
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
const profile = path.join(tmpdir(), 'anvil-alias-' + Date.now());
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
  try { log('ALIAS-RESULT ' + JSON.stringify({
    sha256: RESULT.page.sha256, verdict: RESULT.verdict,
    validation: RESULT.validation ? { onBinDBc: RESULT.validation.onBin.dBc, onBinPass: RESULT.validation.onBin.pass } : null,
    gates: RESULT.gates, determinism: RESULT.determinism.map(d => ({ name: d.name, maxAbsDiff: d.maxAbsDiff, identical: d.identical })),
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

/* ============================================================================================
   IN-PAGE RUNTIME (installed once): radix-2 FFT (2^17) + Blackman window + harmonic-mask spur
   analysis + synthetic signal builders + the two cell runners. All analysis happens in the page;
   the Node rig only ships specs in and numbers out.
   ============================================================================================ */
function aliasPageRuntime() {
  const N = 131072;                      /* 2^17 */
  const win = new Float64Array(N);       /* Blackman (symmetric, N-1 denominator) */
  for (let i = 0; i < N; i++) { const d = N - 1; win[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / d) + 0.08 * Math.cos(4 * Math.PI * i / d); }

  /* in-place iterative radix-2 DIT FFT */
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

  /* worst non-harmonic spur (dBc vs carrier = max |X| in the ±M window around f0); bins < 20 Hz
     ignored; ±M bins around every harmonic of f0 masked */
  function analyzeMask(seg, sr, f0, M) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = seg[i] * win[i];
    fft(re, im);
    const half = N >> 1;
    const mag = new Float64Array(half);
    for (let k = 0; k < half; k++) { const a = re[k], b = im[k]; mag[k] = Math.sqrt(a * a + b * b); }
    const df = sr / N;
    const mask = new Uint8Array(half);
    let harmonics = 0;
    for (let h = 1; h * f0 < sr / 2; h++) {
      const c = Math.round(h * f0 / df);
      const lo = Math.max(0, c - M), hi = Math.min(half - 1, c + M);
      for (let k = lo; k <= hi; k++) mask[k] = 1;
      harmonics++;
    }
    const minK = Math.max(1, Math.ceil(20 / df));
    const carC = Math.round(f0 / df);
    let car = 0;
    for (let k = Math.max(0, carC - M); k <= Math.min(half - 1, carC + M); k++) { if (mag[k] > car) car = mag[k]; }
    let worst = 0, wk = -1;
    for (let k = minK; k < half; k++) { if (mask[k]) continue; if (mag[k] > worst) { worst = mag[k]; wk = k; } }
    return {
      dBc: (car > 0 && worst > 0) ? 20 * Math.log10(worst / car) : null,
      freq: wk >= 0 ? wk * df : null, bin: wk, carrier: car, harmonics: harmonics, df: df,
      masked: mask.reduce((a, b) => a + b, 0),
    };
  }

  function genSine(f, sr, n) { const s = new Float64Array(n); for (let i = 0; i < n; i++) s[i] = Math.sin(2 * Math.PI * f * i / sr); return s; }
  function genBandSaw(f, sr, n) {           /* hand-built bandlimited saw: harmonics < Nyquist, 1/h */
    const s = new Float64Array(n);
    for (let h = 1; h * f < sr / 2; h++) { const a = 1 / h; for (let i = 0; i < n; i++) s[i] += a * Math.sin(2 * Math.PI * h * f * i / sr); }
    return s;
  }
  function sigStats(x) {
    let sum = 0, pk = 0;
    for (let i = 0; i < x.length; i++) { const v = x[i]; sum += v * v; const a = v < 0 ? -v : v; if (a > pk) pk = a; }
    return { rms: Math.sqrt(sum / x.length), peak: pk };
  }

  return { N: N, analyzeMask: analyzeMask, analyze3: (s, sr, f) => analyzeMask(s, sr, f, 3), genSine: genSine, genBandSaw: genBandSaw, sigStats: sigStats };
}

/* cell runner: fresh OfflineAudioContext -> avEngineBoot -> params -> ONE note -> stats barrier
   (require active === 1, the delivery proof) -> startRendering -> in-page analysis */
function aliasRunCase(spec) {
  return (async () => {
    const rig = window.__aliasRig;
    const out = { name: spec.name, kind: spec.kind, sub: spec.sub, pitch: spec.pitchName, midi: spec.midi, f0: spec.f0, sr: spec.sr };
    try {
      const oc = new OfflineAudioContext(2, Math.round(spec.seconds * spec.sr), spec.sr);
      const h = await avEngineBoot(oc, { maxVoices: 4, offline: true });
      if (!h) return Object.assign(out, { stage: 'boot-null' });
      out.tier = h.tier; out.url = h.url; out.maxVoices = h.maxVoices;
      const bad = [];
      for (const k in spec.params) {
        let ok = false;
        try { ok = h.setParam(k, spec.params[k]) === true; } catch (e) { ok = false; }
        if (!ok) bad.push(k);
      }
      out.badParams = bad;
      let okNote = false;
      try { okNote = h.noteOn(spec.midi, spec.gain || 0.8) === true; } catch (e) { okNote = false; }
      const st = await h.stats();
      out.noteOn = okNote;
      out.active = st ? st.active : null;
      out.released = st ? st.released : null;
      if (!okNote || !st || st.active !== 1) return Object.assign(out, { stage: 'delivery', err: 'note delivery barrier failed (noteOn=' + okNote + ' active=' + out.active + ')' });
      const buf = await oc.startRendering();
      const ch = buf.getChannelData(0);
      out.len = ch.length;
      const seg = ch.subarray(ch.length - rig.N);
      const ss = rig.sigStats(seg);
      out.rms = ss.rms; out.peak = ss.peak;
      if (!(ss.peak > 0)) return Object.assign(out, { stage: 'silent', err: 'rendered segment is silent' });
      const a3 = rig.analyze3(seg, spec.sr, spec.f0);
      const a30 = rig.analyzeMask(seg, spec.sr, spec.f0, 30);
      out.spur3 = a3.dBc; out.spur3Freq = a3.freq; out.spur3Bin = a3.bin; out.harmonics = a3.harmonics; out.df = a3.df;
      out.spur30 = a30.dBc; out.spur30Freq = a30.freq;
      out.stage = 'ok';
      return out;
    } catch (e) {
      return Object.assign(out, { stage: 'threw', err: String((e && e.message) || e) });
    }
  })();
}

/* determinism pair: same spec, two fresh engines; compare the full channel buffers */
function aliasRunPair(spec) {
  return (async () => {
    const render = async () => {
      const oc = new OfflineAudioContext(2, Math.round(spec.seconds * spec.sr), spec.sr);
      const h = await avEngineBoot(oc, { maxVoices: 4, offline: true });
      if (!h) return null;
      for (const k in spec.params) h.setParam(k, spec.params[k]);
      if (h.noteOn(spec.midi, spec.gain || 0.8) !== true) return null;
      const st = await h.stats();
      if (!st || st.active !== 1) return null;
      const buf = await oc.startRendering();
      return buf.getChannelData(0);
    };
    const a = await render(), b = await render();
    if (!a || !b) return { name: spec.name, ok: false, err: 'render failed' };
    const L = Math.min(a.length, b.length);
    let maxd = 0, firstI = -1;
    for (let i = 0; i < L; i++) { const d = Math.abs(a[i] - b[i]); if (d > maxd) { maxd = d; if (firstI < 0) firstI = i; } }
    return { name: spec.name, ok: true, lenA: a.length, lenB: b.length, lenEq: a.length === b.length, maxAbsDiff: maxd, identical: (maxd === 0 && a.length === b.length), firstDiffIndex: firstI };
  })();
}

/* synthetic validation + per-pitch leakage floors (run BEFORE any case) */
function aliasValidate(sr, pitchList) {
  return (async () => {
    const rig = window.__aliasRig;
    const fBin = 5000 * sr / rig.N;                       /* an exact-bin sine: isolates this FFT's own error */
    const vOn = rig.analyze3(rig.genSine(fBin, sr, rig.N), sr, fBin);
    const out = {
      onBin: { f: fBin, dBc: vOn.dBc, pass: vOn.dBc !== null && vOn.dBc < -120, note: 'pure on-bin sine — validates the FFT/window pipeline itself (require < -120 dBc)' },
      offBin: {}, saw: {},
    };
    for (const p of pitchList) {
      const off = rig.genSine(p.f0, sr, rig.N);
      const o3 = rig.analyze3(off, sr, p.f0);
      out.offBin[p.name] = { f: p.f0, dBc: o3.dBc, freq: o3.freq, note: 'off-bin pure sine — the Blackman leakage floor of the ±3-bin metric' };
    }
    const sawSig = rig.genBandSaw(pitchList[0].f0, sr, rig.N);  /* hand-built saw-ish sanity (C4) */
    const s3 = rig.analyze3(sawSig, sr, pitchList[0].f0);
    const s30 = rig.analyzeMask(sawSig, sr, pitchList[0].f0, 30);
    out.saw[pitchList[0].name] = { dBc3: s3.dBc, freq3: s3.freq, dBc30: s30.dBc, note: 'hand-built bandlimited saw (harmonics 1/h to Nyquist) — sanity + floor identity' };
    return out;
  })();
}

/* ---- main ---- */
async function main() {
  log('=== ANVIL alias rig === (contract §9.3; FFT 2^17 in-page; Blackman; mask ±3 bins; ignore < 20 Hz)');
  log('protocol: ' + RENDER_SECONDS + ' s renders · one held note per case · stats() delivery barrier (active===1) before startRendering · segment = last 2^17 samples');
  log('cases: VA [' + VA_TYPES.join(',') + '] · WT [' + WT_TYPES.join(',') + '] @ ' + PITCHES.map(p => p.name + ' ' + p.f0.toFixed(4) + ' Hz').join(' / '));
  log('gates: VA <= ' + GATE_VA_DBC + ' dBc · WT <= ' + GATE_WT_DBC + ' dBc · diagnostic: same spur with a ±' + DIAG_MASK_BINS + '-bin mask (NOT the contract metric)');

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

  /* page + engine surface */
  let surface = null;
  for (let i = 0; i < 120; i++) {
    const r = await cdp.ev(`(() => ({
      boot: typeof avEngineBoot === 'function',
      attr: document.documentElement.getAttribute('data-av-engine'),
      eng: window.__avEngine ? { tier: window.__avEngine.tier, url: window.__avEngine.url, sr: window.__avEngine.sr, maxVoices: window.__avEngine.maxVoices, ready: window.__avEngine.ready } : null,
    }))()`);
    if (r.value && r.value.boot && r.value.attr) { surface = r.value; break; }
    await sleep(250);
  }
  if (!surface || !surface.boot) {
    log('VERDICT: avEngineBoot is not a page global — the offline cells cannot run.');
    dumpConsole(cdp);
    RESULT.verdict = 'no-avEngineBoot';
    finish(3); return;
  }
  log('engine surface: attr=' + surface.attr + ' live=' + JSON.stringify(surface.eng || null) + ' avEngineBoot=global');
  if (surface.attr !== 'worklet') log('note: live engine attr is ' + surface.attr + ' (expected worklet on http; offline cells boot their own contexts anyway)');

  /* install the in-page runtime */
  const inst = await cdp.ev('window.__aliasRig = (' + String(aliasPageRuntime) + ')(); window.__aliasRunCase = (' + String(aliasRunCase) + '); window.__aliasRunPair = (' + String(aliasRunPair) + '); window.__aliasValidate = (' + String(aliasValidate) + '); true', 1, 20000);
  if (!inst.value) { log('FATAL: page runtime install failed: ' + (inst.error || 'no value')); RESULT.verdict = 'runtime-install-failed'; finish(1); return; }

  /* validation + floors */
  log('--- analysis validation (synthetic, runs BEFORE any case) ---');
  const valR = await cdp.ev('window.__aliasValidate(48000, ' + JSON.stringify(PITCHES) + ')', 1, 60000);
  if (!valR.value) { log('FATAL: validation eval failed: ' + (valR.error || 'no value')); RESULT.verdict = 'validation-eval-failed'; finish(1); return; }
  const val = valR.value;
  RESULT.validation = val;
  log(' on-bin sine ' + val.onBin.f.toFixed(4) + ' Hz -> worst spur ' + r2(val.onBin.dBc) + ' dBc  [require < -120] ' + (val.onBin.pass ? 'PASS' : 'FAIL'));
  if (!val.onBin.pass) {
    log('VALIDATION FAIL: the FFT/window pipeline does not meet the -120 dBc synthetic purity bound — stopping (no case numbers would be trustworthy).');
    RESULT.verdict = 'validation-fail'; finish(1); return;
  }
  log(' off-bin sine floors (Blackman leakage of the ±3-bin metric): ' + PITCHES.map(p => p.name + ' ' + r2(val.offBin[p.name].dBc) + ' dBc').join(' · '));
  const saw = val.saw[PITCHES[0].name];
  const identity = Math.abs(saw.dBc3 - val.offBin[PITCHES[0].name].dBc) < 3;
  log(' hand-built bandlimited saw C4 -> ' + r2(saw.dBc3) + ' dBc (mask3, floor identity ' + (identity ? 'ok' : 'MISMATCH') + ') · ' + r2(saw.dBc30) + ' dBc (mask30)');
  if (!identity) { log('VALIDATION WARN: saw floor does not sit at the sine floor — investigation needed (continuing, raw numbers below).'); }

  /* the 30 contract cases */
  log('--- cases (osc alone; levels 0/1 per case; lp12 20000 reso 0 envAmt 0; env1.s=1; ONE note held; stats barrier) ---');
  let firstCaseStop = false, failedCases = 0;
  for (const spec of CASE_SPECS) {
    let c = await cdp.ev('window.__aliasRunCase(' + JSON.stringify(spec) + ')', 1, EVAL_TIMEOUT_MS);
    let row = (c && c.value) || { name: spec.name, stage: 'eval', err: (c && c.error) || 'no value' };
    if (row.stage !== 'ok') {
      log('  retry: ' + spec.name + ' — stage ' + row.stage + ' (' + (row.err || row.badParams || '') + ') — fresh context');
      const first = { stage: row.stage, err: row.err || null, active: row.active ?? null };
      c = await cdp.ev('window.__aliasRunCase(' + JSON.stringify(spec) + ')', 1, EVAL_TIMEOUT_MS);
      row = (c && c.value) || { name: spec.name, stage: 'eval2', err: (c && c.error) || 'no value' };
      row.retried = true; row.firstAttempt = first;
    }
    RESULT.cases.push(row);
    if (row.stage === 'ok') {
      const gate = spec.kind === 'va' ? GATE_VA_DBC : GATE_WT_DBC;
      const pass = row.spur3 !== null && row.spur3 <= gate;
      row.gate = gate; row.pass = pass;
      log('  ' + row.name.padEnd(18) + ' spur3 ' + String(r2(row.spur3)).padStart(7) + ' dBc @' + r2(row.spur3Freq) + ' Hz' +
        ' (gate ' + gate + ' -> ' + (pass ? 'PASS' : 'FAIL') + ')' +
        ' | m30 ' + String(r2(row.spur30)).padStart(7) + ' dBc' +
        ' | tier ' + row.tier + ' active=' + row.active + ' rms=' + r3(row.rms) + ' peak=' + r3(row.peak) +
        (row.badParams && row.badParams.length ? ' BAD-PARAMS:' + row.badParams.join(',') : ''));
    } else {
      failedCases++;
      log('  ' + spec.name.padEnd(18) + ' FAILED stage=' + row.stage + ' ' + JSON.stringify(row));
      if (RESULT.cases.length === 1) { firstCaseStop = true; break; }
    }
  }
  if (firstCaseStop) {
    log('STOP: the first case failed even after a fresh-context retry — raw evidence above; stopping per contract (no massaging).');
    RESULT.verdict = 'alias-stop'; finish(1); return;
  }

  /* cross-rate spot (44.1 kHz) */
  log('--- cross-rate spot (44.1 kHz) ---');
  for (const spec of CROSS_SPECS) {
    const c = await cdp.ev('window.__aliasRunCase(' + JSON.stringify(spec) + ')', 1, EVAL_TIMEOUT_MS);
    const row = (c && c.value) || { name: spec.name, stage: 'eval', err: (c && c.error) || 'no value' };
    RESULT.cross.push(row);
    if (row.stage === 'ok') log('  ' + row.name.padEnd(22) + ' spur3 ' + r2(row.spur3) + ' dBc @' + r2(row.spur3Freq) + ' Hz | m30 ' + r2(row.spur30) + ' dBc | tier ' + row.tier + ' active=' + row.active);
    else log('  ' + row.name.padEnd(22) + ' FAILED ' + JSON.stringify(row));
  }

  /* determinism pairs */
  log('--- determinism (two fresh offline engines, same patch/note; require max abs diff === 0) ---');
  for (const spec of DET_SPECS) {
    const c = await cdp.ev('window.__aliasRunPair(' + JSON.stringify(spec) + ')', 1, EVAL_TIMEOUT_MS);
    const d = (c && c.value) || { name: spec.name, ok: false, err: (c && c.error) || 'no value' };
    RESULT.determinism.push(d);
    log('  ' + d.name.padEnd(20) + ' ' + (d.ok ? ('maxAbsDiff=' + d.maxAbsDiff + ' identical=' + d.identical + ' len=' + d.lenA + '/' + d.lenB + (d.firstDiffIndex >= 0 ? (' firstDiff@' + d.firstDiffIndex) : '')) : ('FAILED ' + JSON.stringify(d))));
  }

  /* summary + gates */
  const ok3 = (v) => typeof v === 'number' && isFinite(v);
  const vaRows = RESULT.cases.filter(r => r.kind === 'va' && r.stage === 'ok');
  const wtRows = RESULT.cases.filter(r => r.kind === 'wt' && r.stage === 'ok');
  const vaAllOk = vaRows.length === VA_TYPES.length * PITCHES.length && vaRows.every(r => r.pass);
  const wtAllOk = wtRows.length === WT_TYPES.length * PITCHES.length && wtRows.every(r => r.pass);
  const vaWorst = vaRows.reduce((m, r) => ok3(r.spur3) && (m === null || r.spur3 > m.v) ? { v: r.spur3, name: r.name } : m, null);
  const wtWorst = wtRows.reduce((m, r) => ok3(r.spur3) && (m === null || r.spur3 > m.v) ? { v: r.spur3, name: r.name } : m, null);
  const detOk = RESULT.determinism.length > 0 && RESULT.determinism.every(d => d.ok && d.identical === true);
  RESULT.gates = {
    va: { verdict: vaAllOk ? 'PASS' : 'FAIL', threshold: GATE_VA_DBC, cases: vaRows.length, worst: vaWorst },
    wt: { verdict: wtAllOk ? 'PASS' : 'FAIL', threshold: GATE_WT_DBC, cases: wtRows.length, worst: wtWorst },
    determinism: { verdict: detOk ? 'PASS' : 'FAIL', pairs: RESULT.determinism.map(d => ({ name: d.name, maxAbsDiff: d.maxAbsDiff, identical: d.identical })) },
    failedCases: failedCases,
    floorNote: 'Blackman leakage floor of the ±3-bin metric is ~-57 dBc (validated: off-bin sine + hand-built saw both sit there). The WT -80 gate cannot be evaluated below that floor by this metric; the m30 diagnostic column is the leakage-excluded view (not the contract metric).',
  };
  log('==== ALIAS SUMMARY ====');
  log('freeze: sha256 ' + RESULT.page.sha256 + ' (' + RESULT.page.bytes + ' B)');
  log('validation: on-bin sine ' + r2(val.onBin.dBc) + ' dBc (< -120 required) -> ' + (val.onBin.pass ? 'PASS' : 'FAIL'));
  log('leakage floor (mask3, off-bin sine): ' + PITCHES.map(p => p.name + ' ' + r2(val.offBin[p.name].dBc)).join(' · ') + ' dBc');
  log('gates: VA ' + RESULT.gates.va.verdict + ' (worst ' + (vaWorst ? vaWorst.name + ' ' + r2(vaWorst.v) + ' dBc' : 'n/a') + ', gate ' + GATE_VA_DBC + ')' +
    ' · WT ' + RESULT.gates.wt.verdict + ' (worst ' + (wtWorst ? wtWorst.name + ' ' + r2(wtWorst.v) + ' dBc' : 'n/a') + ', gate ' + GATE_WT_DBC + '; see floor note)');
  log('determinism: ' + RESULT.gates.determinism.verdict + ' (' + RESULT.determinism.map(d => d.name + ':' + d.maxAbsDiff).join(' · ') + ')');
  log('failed cases: ' + failedCases + ' · cross-rate rows: ' + RESULT.cross.length);
  dumpConsole(cdp, 12);
  RESULT.verdict = (vaAllOk && detOk && failedCases === 0) ? 'complete' : 'gates-not-met';
  finish((vaAllOk && detOk && failedCases === 0 && wtAllOk) ? 0 : 1);
}

main().catch((err) => {
  console.error('alias harness crashed:', err);
  try { log('harness crashed: ' + (err && err.stack || err)); } catch { }
  try { RESULT.verdict = RESULT.verdict || 'harness-crash'; } catch { }
  process.exit(1);
});
