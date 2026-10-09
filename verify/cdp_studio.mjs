// cdp_studio.mjs — Anvil S1 record-core suite (child sa-C's rig; WRITTEN by sa-C, RUN BY THE PARENT
// after integration). End-to-end over raw CDP against the frozen single-file build.
//
//   node verify/cdp_studio.mjs [path-to-index.html] [--port N] [--sha <hex>]
//
// WRITE-ONLY: this file is authored by sa-C and never executed by sa-C. The parent runs it after
// the S1 integration build (index.html must contain av_input.js + av_metro.js + av_takes.js +
// av_studio_ui.js and body.html must carry the #av-studio card + #av-studio-host).
//
// Launch skeleton copied VERBATIM from cdp_store.mjs (candidates Chrome/Edge/Brave, free-port
// scan, fresh temp --user-data-dir, 1440×900 device metrics override — Edge headless ignores
// --window-size, --mute-audio, --autoplay-policy=no-user-gesture-required, ONE browser, explicit
// exit, process.on('exit') kills ONLY processes whose command line carries OUR temp profile),
// PLUS the two fake-media flags the §0 probe used:
//   --use-fake-ui-for-media-stream  (auto-grants getUserMedia)
//   --use-fake-device-for-media-stream  (the BEEP-TRAIN fake device — NEVER assert continuous
//                                        audio: assert peak > 0.05 · nonzero > 1000 over ≥ 2.5 s)
// SHA freeze discipline from cdp_midi.mjs / cdp_sample.mjs / cdp_fx.mjs / cdp_store.mjs:
// index.html is sha256'd before and after the run and the two must match. EXPECT_SHA is null
// until the parent pins the frozen S1 sha (constant below or --sha <hex>); while it is null the
// rig still enforces before === after.
//
// WHAT IT PROVES, in order (contract: verify/_s1_wave.md §2.5 proofs 1–7):
//   1. boot + card mounted into #av-studio/#av-studio-host: `.av-studio` root, wired marker
//      (dataset avStudioUiWired='1'), REC + ENABLE controls present (tolerant label scan),
//      the four module globals live (avInput*. avMetro*. avTakes*. avStudioUi*. + window.__avTakes
//      debug handle at version s1.0) and window.__avStudioUi an object.
//   2. input enable on the fake device: ok · channels ≥ 1 · sr 48000 · the RIG'S OWN capture on
//      avInputNode() shows the §0 beep train (≥ 2.5 s window, peak > 0.05, nonzero > 1000) ·
//      monitor default OFF (state field guarded AND the master tap stays silent < 1e-4 rms) ·
//      disable clean (avInputNode() empties) and re-enable works.
//   3. metronome: on -> the planned-click ring has ≥ 4 clicks spaced at the beat (60/bpm ± 10 ms);
//      the RIG'S OWN AnalyserNode on avMasterFor(ctx) witnesses ≥ 4 transients; off -> none
//      (zero onsets and silence over the next window).
//   4. count-in: avMetroCountIn(2) resolves in 2 bars ± 150 ms (page-measured) with ≥ 8 clicks
//      newly scheduled in the ring.
//   5. takes (lapSync false): ~1.5 s -> stop -> frames ≈ 1.5·sr within [−2 blocks, +settle+1
//      block] (the stop keeps capturing through a 180 ms settle so the tail block lands — the
//      av_rec discipline; the exact captured span is reported) · the take exports through
//      avTakesExport: avWavInfo ok (16-bit, 48 k) + blob + url and decodes NON-SILENT (beeps:
//      peak > 0.05) · delete works · keepLast(1) is enforced ON STOP (list still holds 2 until
//      the next stop trims it to the newest 1).
//   6. lap split: rig pattern (16 steps @ 120 bpm -> 2 s cycle), avSeqPlay, record ~2.5 cycles ->
//      receipt.lapSync true, cycleDur ≈ 2 s, ≥ 2 takes, every FULL lap ≈ 2 s ± 0.15 s, the tail
//      take partial:true, laps numbered ascending; avSeqStop + a final abort (no take added);
//      transport left stopped.
//   7. zero page errors · screenshot renders/s1-studio-suite.png · freeze sha256 before === after
//      · THE PAGE IS LEFT CLEAN (takes disarmed + not recording, transport stopped, input
//      disabled).
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
   S1: the frozen sha of the rebuilt index.html is not known until build.py runs — the parent may
   fill this constant or pass --sha <hex>; the rig never loosens the before === after check. */
const EXPECT_SHA = '6ac4425b8d42fa583b8d2b17b04629039f00491c3890a98c3209dd26e93fa02e';
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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9560);
const profile = path.join(tmpdir(), 'anvil-studiui-' + Date.now());
const url = 'file:///' + path.resolve(page).replace(/\\/g, '/');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
console.log('cdp port ' + PORT + ' · profile ' + profile);

let pass = 0, fail = 0;
const check = (name, ok, info) => {
  if (ok) { pass++; console.log(' ok   ' + name + (info ? '  -> ' + info : '')); }
  else { fail++; console.log(' FAIL ' + name + (info ? '  -> ' + info : '')); }
};
const note = (t) => console.log('   · ' + t);
const fx3 = (x) => (x == null || !isFinite(x)) ? String(x) : Number(x).toFixed(3);

const chrome = spawn(exe, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--disable-sync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  url,
], { stdio: 'ignore', windowsHide: true });

const errors = [];

/* ---------- node-side onset detection (the metronome timing witness math) ---------- */
function detectOnsets(samples, gapMs = 55) {
  let max = 0;
  for (const s of samples) if (s[1] > max) max = s[1];
  const dthr = Math.max(0.006, max * 0.22);
  const onsets = [];
  let last = -1e9;
  for (let i = 1; i < samples.length; i++) {
    const t0 = samples[i - 1][0], r0 = samples[i - 1][1];
    const t1 = samples[i][0], r1 = samples[i][1];
    if (r1 - r0 > dthr && t1 - last > gapMs) { onsets.push(t1); last = t1; }
  }
  return { onsets, max, dthr };
}

/* ---------- page-side scaffolding injected at runtime (rig-owned; never app code) ----------
   __stui: the rig's OWN witnesses —
     scan(ms): an AnalyserNode on avMasterFor(ctx) sampling RMS every 5 ms (panel reads are never
               witnesses) returning the [(t, rms)] timeline for node-side onset math;
     captureInput(ms): the §0 probe verbatim — MediaStreamSource path via avInputNode() riding a
               parallel ScriptProcessor(4096): input -> sp -> gain-0 sink -> avTap.real, counting
               frames/peak/nonzero of whatever the input node carries (the beep train);
     stats(buf): decode a WAV ArrayBuffer via avWavInfo + DataView (peak/nonzero/rms, 16-bit);
     takeStats(id): avTakesExport -> blob.arrayBuffer() -> stats (the take-content witness).
   __seqi: the rig PATTERN (16 on-steps @ 120 bpm, grid "16", swing 50) + a sanitising load
     through avSeqPatternImport/avSeqLoad -> avSeqSetPattern(avSeqSnap()) -> avApplyParam bpm. */

const STUI_SETUP = `window.__stui = (function () {
  const API = { v: 1 };
  API.ctx = function () {
    try { const e = window.__avEngine; if (e && e.handle && e.handle.ctx) return e.handle.ctx; } catch (x) { }
    try { if (typeof avTap !== 'undefined' && avTap && avTap.ctx) return avTap.ctx; } catch (x) { }
    return null;
  };
  API.master = function (ctx) { try { if (typeof avMasterFor === 'function') return avMasterFor(ctx); } catch (e) { } return null; };
  API.scan = function (ms) {
    return new Promise(function (resolve) {
      const ctx = API.ctx();
      const master = ctx ? API.master(ctx) : null;
      if (!ctx || !master) { resolve({ ok: false, why: 'no master tap for the live ctx' }); return; }
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      an.smoothingTimeConstant = 0;
      master.connect(an);
      const samples = [];
      let on = true;
      const td = new Float32Array(an.fftSize);
      const timer = setInterval(function () {
        if (!on) return;
        try {
          an.getFloatTimeDomainData(td);
          let s = 0;
          for (let i = 0; i < td.length; i++) s += td[i] * td[i];
          samples.push([performance.now(), Math.sqrt(s / td.length)]);
        } catch (e) { }
      }, 5);
      setTimeout(function () {
        on = false;
        clearInterval(timer);
        try { an.disconnect(); } catch (e) { }
        resolve({ ok: true, sr: ctx.sampleRate, samples: samples });
      }, ms);
    });
  };
  API.captureInput = function (ms) {
    return new Promise(function (resolve) {
      const node = (typeof avInputNode === 'function') ? avInputNode() : null;
      if (!node || !node.context || typeof node.context.createScriptProcessor !== 'function') { resolve({ ok: false, why: 'no live input node' }); return; }
      const ctx = node.context;
      const sp = ctx.createScriptProcessor(4096, 2, 2);
      const sink = ctx.createGain();
      sink.gain.value = 0;
      const real = (typeof avTap !== 'undefined' && avTap && avTap.real && avTap.real.context === ctx) ? avTap.real : (ctx.destination || null);
      if (!real) { resolve({ ok: false, why: 'no real sink for the input branch' }); return; }
      const st = { frames: 0, peak: 0, nonzero: 0, blocks: 0 };
      sp.onaudioprocess = function (ev) {
        try {
          const inp = ev.inputBuffer;
          const c0 = inp.getChannelData(0);
          const c1 = inp.numberOfChannels > 1 ? inp.getChannelData(1) : c0;
          for (let i = 0; i < c0.length; i++) { const a = c0[i] < 0 ? -c0[i] : c0[i]; if (a > st.peak) st.peak = a; if (c0[i] !== 0) st.nonzero++; }
          if (c1 !== c0) for (let i = 0; i < c1.length; i++) { const a = c1[i] < 0 ? -c1[i] : c1[i]; if (a > st.peak) st.peak = a; if (c1[i] !== 0) st.nonzero++; }
          st.frames += c0.length;
          st.blocks++;
        } catch (e) { }
      };
      node.connect(sp);
      sp.connect(sink);
      sink.connect(real);
      setTimeout(function () {
        try { node.disconnect(sp); } catch (e) { }
        try { sp.onaudioprocess = null; sp.disconnect(); } catch (e) { }
        try { sink.disconnect(); } catch (e) { }
        resolve({ ok: true, frames: st.frames, blocks: st.blocks, peak: st.peak, nonzero: st.nonzero, seconds: st.frames / (ctx.sampleRate || 48000), sr: ctx.sampleRate || 48000 });
      }, ms);
    });
  };
  API.stats = function (buf) {
    try {
      const info = avWavInfo(buf);
      if (!info || info.ok !== true) return { ok: false, why: 'wavInfo: ' + ((info && info.error) || '?') };
      if (info.bits !== 16) return { ok: false, why: 'not 16-bit: ' + info.bits };
      const u8 = new Uint8Array(buf);
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      let peak = 0, nonzero = 0, rms = 0, n = 0;
      const frames = info.frames, ch = info.channels, off = info.dataOffset;
      for (let f = 0; f < frames; f++) {
        for (let c = 0; c < ch; c++) {
          const v = dv.getInt16(off + (f * ch + c) * 2, true) / 32768;
          const a = v < 0 ? -v : v;
          if (a > peak) peak = a;
          if (a > 0) nonzero++;
          rms += v * v; n++;
        }
      }
      return { ok: true, info: info, peak: peak, nonzero: nonzero, rms: Math.sqrt(rms / (n || 1)), n: n };
    } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
  };
  API.takeStats = async function (id) {
    try {
      const r = await avTakesExport(id);
      if (!r || r.ok !== true) return { ok: false, why: 'export: ' + ((r && r.error) || '?') };
      const ab = await r.blob.arrayBuffer();
      return {
        ok: true,
        name: r.name, bytes: r.bytes, url: (typeof r.url === 'string' && r.url.indexOf('blob:') === 0),
        wavInfo: r.wavInfo ? { ok: r.wavInfo.ok, sampleRate: r.wavInfo.sampleRate, channels: r.wavInfo.channels, bits: r.wavInfo.bits, frames: r.wavInfo.frames } : null,
        stats: API.stats(ab),
      };
    } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
  };
  return API;
})(); true`;

const SEQI_HELPERS = `window.__seqi = (function () {
  const H = { v: 1 };
  H.step = function (o) { return Object.assign({ on: 0, note: 'c2', vel: 0.9, gate: 0.5, slide: 0, accent: 0, oct: 0, prob: 100, cond: '', ratchet: 1, micro: 0 }, o || {}); };
  H.off = function () { const a = []; for (let i = 0; i < 64; i++) a.push(H.step({ on: 0 })); return a; };
  H.pattern = function () {
    const steps = [];
    for (let s = 0; s < 16; s++) steps.push(H.step({ on: 1, note: 'c2', vel: 0.9, gate: 0.5 }));
    const all = steps.concat(H.off().slice(16));
    const tracks = [];
    for (let t = 0; t < 4; t++) tracks.push({ len: 16, speed: 1, mute: 0, steps: (t === 0 ? all.slice() : H.off()) });
    return { v: 1, name: 'RIG PAT', bpm: 120, grid: '16', swing: 50, rng: 305419896, tracks: tracks, plocks: [] };
  };
  H.load = function () {
    const P = H.pattern();
    let ok = false, why = '';
    try {
      if (typeof avSeqPatternImport === 'function') { ok = avSeqPatternImport(JSON.stringify(P)) === true; why = ok ? 'import' : 'import-refused'; }
      if (!ok && typeof avSeqLoad === 'function') { ok = avSeqLoad(P) === true; why = why + '+load' + (ok ? '' : '-refused'); }
    } catch (e) { ok = false; why = 'threw: ' + ((e && e.message) || e); }
    if (ok) {
      try { if (typeof avSeqSetPattern === 'function' && typeof avSeqSnap === 'function') avSeqSetPattern(avSeqSnap()); } catch (e) { }
      try { if (typeof avApplyParam === 'function') avApplyParam('bpm', 120); } catch (e) { }
    }
    return { ok: ok, why: why };
  };
  return H;
})(); true`;

const shotPath = path.join(here, '..', 'renders', 's1-studio-suite.png');

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

  /* ── 1. boot ── */
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const r = await ev(`document.documentElement.getAttribute('data-av-ready') === '1'`);
    if (r.value === true) { ready = true; break; }
    await sleep(300);
  }
  check('1 boot: data-av-ready flips', ready);
  if (!ready) { console.error('APP NOT READY'); process.exit(1); }

  /* engine ctx (the S1 capture must ride the engine's AudioContext — §2.1 ctx law) */
  const engR = await ev(`(async () => {
    const e = window.__avEngine || {};
    let ctx = (e.handle && e.handle.ctx) || e.ctx || null;
    if (!ctx && typeof avEngineEnsure === 'function') { try { const h = await avEngineEnsure(); ctx = (h && h.ctx) || null; } catch (x) { } }
    if (!ctx) { for (const k in e.handle || {}) { try { const v = e.handle[k]; if (v && typeof v.currentTime === 'number' && typeof v.resume === 'function') { ctx = v; break; } } catch (x) { } } }
    if (!ctx) return { found: false };
    if (ctx.state !== 'running') { try { await Promise.race([ctx.resume().catch(() => { }), new Promise((res) => setTimeout(res, 2000))]); } catch (x) { } }
    for (let i = 0; i < 20 && ctx.state !== 'running'; i++) await new Promise((res) => setTimeout(res, 125));
    return { found: true, state: ctx.state, sampleRate: ctx.sampleRate, scp: typeof ctx.createScriptProcessor === 'function' };
  })()`);
  const eng = val(engR) || {};
  check('1 engine ctx: found · running · ScriptProcessor-capable · sr 48 k', eng.found === true && eng.state === 'running' && eng.scp === true && Number(eng.sampleRate) === 48000, JSON.stringify(eng));
  if (eng.found !== true || eng.state !== 'running') { console.error('ENGINE CTX NOT READY — S1 capture needs the live engine context'); process.exit(1); }

  /* ── 1b. the studio card mounts into #av-studio-host ── */
  let cardUp = false;
  for (let i = 0; i < 100 && !cardUp; i++) {
    const r = await ev(`!!(document.getElementById('av-studio') && document.getElementById('av-studio-host') && document.querySelector('#av-studio-host .av-studio') && document.getElementById('av-studio-host').dataset.avStudioUiWired === '1')`);
    if (r.value === true) { cardUp = true; break; }
    await sleep(150);
  }
  check('1b card mounted: #av-studio + #av-studio-host + .av-studio root + wired marker (avStudioUiWired=1)', cardUp);
  if (!cardUp) { console.error('STUDIO CARD MISSING — parent adds the #av-studio card + #av-studio-host and calls avStudioUiInit()'); process.exit(1); }

  /* tolerant control discovery: REC + ENABLE controls (labels/classes/ids/data-attrs scanned) */
  const ctrlR = await ev(`(() => {
    const scan = (root) => {
      const els = [...root.querySelectorAll('button, [role="button"], input[type="button"], select, .av-btn, [data-act], [data-av-studio]')];
      const label = (e) => (((e.textContent || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '') + ' ' + (e.className || '') + ' ' + (e.id || '') + ' ' + JSON.stringify(e.dataset || {})).toLowerCase());
      return { els, label };
    };
    const host = document.getElementById('av-studio-host') || document.getElementById('av-studio');
    if (!host) return { host: false };
    const s = scan(host);
    const rec = s.els.filter((e) => /rec|record/.test(s.label(e)));
    const en = s.els.filter((e) => /enable|input/.test(s.label(e)));
    return { host: true, buttons: s.els.length, rec: rec.length, enable: en.length, labels: s.els.map((e) => s.label(e).replace(/\\s+/g, ' ').slice(0, 48)) };
  })()`);
  const ctrl = val(ctrlR) || {};
  check('1c controls: REC + input-ENABLE controls present in the studio card (tolerant label scan)', ctrl.host === true && ctrl.rec >= 1 && ctrl.enable >= 1, JSON.stringify({ buttons: ctrl.buttons, rec: ctrl.rec, enable: ctrl.enable, labels: (ctrl.labels || []).slice(0, 10) }));

  /* module globals + debug handles live */
  const modR = await ev(`(() => {
    const fns = ['avInputInit','avInputEnable','avInputDisable','avInputState','avInputNode','avInputLatency','avInputGain','avMetroSet','avMetroState','avMetroCountIn','avTakesInit','avTakesStart','avTakesStop','avTakesList','avTakesExport','avTakesDelete','avTakesKeepLast','avTakesState','avTakesClasses','avStudioUiInit'];
    const missing = fns.filter((n) => typeof window[n] !== 'function');
    return {
      missing: missing,
      takes: !!(window.__avTakes && typeof window.__avTakes === 'object'),
      takesVer: window.__avTakes ? window.__avTakes.version : null,
      ui: !!(window.__avStudioUi && typeof window.__avStudioUi === 'object'),
      classesN: (typeof avTakesClasses === 'function') ? avTakesClasses().length : 0,
    };
  })()`);
  const mod = val(modR) || {};
  check('1d module globals live: avInput* + avMetro* + avTakes* + avStudioUiInit present · window.__avTakes (s1.0) · window.__avStudioUi object',
    Array.isArray(mod.missing) && mod.missing.length === 0 && mod.takes === true && mod.takesVer === 's1.0' && mod.ui === true && mod.classesN >= 8,
    JSON.stringify(mod));
  check('1e page pristine: nothing recording and no armed take session before the run',
    val(await ev(`(() => { try { return !!(avTakesState && avTakesState() && avTakesState().recording === false); } catch (e) { return false; } })()`)) === true);

  /* inject the rig witnesses + helpers */
  await ev(STUI_SETUP);
  await ev(SEQI_HELPERS);
  check('1f rig side helpers injected (__stui · __seqi)', val(await ev(`!!(window.__stui && window.__stui.v === 1 && window.__seqi && window.__seqi.v === 1)`)) === true);

  /* ── 2. input enable (fake device) + the §0 beep-train witness ── */
  const enR = await ev(`(async () => { try { return await avInputEnable(); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } })()`);
  const en = val(enR) || {};
  check('2 avInputEnable(): ok · channels ≥ 1 · sampleRate 48000', en.ok === true && Number(en.channels) >= 1 && Number(en.sampleRate) === 48000,
    JSON.stringify({ ok: en.ok, channels: en.channels, sampleRate: en.sampleRate, label: en.label, error: en.error }));
  const nodeR = await ev(`(() => { try { return { live: !!(typeof avInputNode === 'function' && avInputNode()), state: (typeof avInputState === 'function') ? avInputState() : null }; } catch (e) { return { live: false, error: String((e && e.message) || e) }; } })()`);
  const node = val(nodeR) || {};
  check('2 avInputNode() live (the recording tap point exists)', node.live === true, JSON.stringify({ live: node.live }));

  const beepR = await ev(`window.__stui.captureInput(2600)`);   /* ≥ 2.5 s window (the §0 law) */
  const beep = val(beepR) || {};
  check('2 beep train on the input node (§0): ≥ 2.5 s window · peak > 0.05 · nonzero > 1000 (NEVER continuous-audio)',
    beep.ok === true && Number(beep.seconds) >= 2.5 && Number(beep.peak) > 0.05 && Number(beep.nonzero) > 1000,
    JSON.stringify({ seconds: fx3(beep.seconds), peak: fx3(beep.peak), nonzero: beep.nonzero, blocks: beep.blocks }));

  const monFieldR = await ev(`(() => {
    try {
      const s = (typeof avInputState === 'function') ? (avInputState() || {}) : {};
      const pick = (s.monitor !== undefined) ? s.monitor : (s.monitorOn !== undefined) ? s.monitorOn : (s.mon !== undefined) ? s.mon : null;
      return { field: pick };
    } catch (e) { return { field: null, error: String((e && e.message) || e) }; }
  })()`);
  const monField = (val(monFieldR) || {}).field;
  const monScanR = await ev(`window.__stui.scan(1000)`);
  const monScan = val(monScanR) || {};
  let monMax = 0;
  if (monScan.ok === true) for (const s of monScan.samples) if (s[1] > monMax) monMax = s[1];
  check('2 monitor default OFF: state field false-ish (guarded) AND the master tap stays silent (< 1e-4 rms over 1 s — feedback safety)',
    monScan.ok === true && monMax < 1e-4 && (monField === null || monField === false || monField === 0),
    JSON.stringify({ monitorField: monField, masterMaxRms: monMax }));

  const disR = await ev(`(async () => {
    try { const r = await avInputDisable(); const live = (typeof avInputNode === 'function') ? !!avInputNode() : false; return { r: r, live: live }; } catch (e) { return { error: String((e && e.message) || e) }; }
  })()`);
  const dis = val(disR) || {};
  const disLive = dis.live;
  check('2 avInputDisable() clean: input node gone (avInputNode() empty)', dis.error === undefined && disLive === false, JSON.stringify({ live: disLive, r: (dis.r && dis.r.ok) }));
  const reR = await ev(`(async () => { try { return await avInputEnable(); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } })()`);
  check('2 re-enable works after a clean disable (idempotent enable/disable cycle)', (val(reR) || {}).ok === true, JSON.stringify(val(reR)));

  /* ── 3. metronome: planned ring + audible witness on the master tap ── */
  const metroOn = await ev(`(() => { try { return avMetroSet({ on: true, level: 0.9, beatsPerBar: 4 }); } catch (e) { return { error: String((e && e.message) || e) }; } })()`);
  const mScanR = await ev(`window.__stui.scan(2400)`);
  const mScan = val(mScanR) || {};
  const mDet = (mScan.ok === true) ? detectOnsets(mScan.samples || []) : { onsets: [], max: 0, dthr: 0 };
  const mStateR = await ev(`(() => { try { const s = avMetroState(); return { on: s && s.on, bpm: s && s.bpm, clicks: (s && Array.isArray(s.clicks)) ? s.clicks.map((c) => (c && typeof c === 'object') ? c.t : c).filter((t) => typeof t === 'number' && isFinite(t)) : [] }; } catch (e) { return { error: String((e && e.message) || e) }; } })()`);
  const mState = val(mStateR) || {};
  const mTs = Array.isArray(mState.clicks) ? mState.clicks : [];
  const mDiffs = [];
  for (let i = 1; i < mTs.length; i++) mDiffs.push(mTs[i] - mTs[i - 1]);
  const beat = 60 / (Number(mState.bpm) > 0 ? Number(mState.bpm) : 120);
  const spacingOk = mDiffs.length >= 3 && mDiffs.every((d) => Math.abs(d - beat) <= 0.010);
  check('3 metronome ON: planned-click ring ≥ 4 clicks, consecutive spacing = beat (60/bpm) ± 10 ms',
    mState.on === true && mTs.length >= 4 && spacingOk,
    JSON.stringify({ on: mState.on, bpm: mState.bpm, clicks: mTs.length, diffs: mDiffs.map((d) => +d.toFixed(4)).slice(0, 6) }));
  check('3 metronome audible witness: ≥ 4 transients in ~2 bars on avMasterFor(ctx) (rig-owned analyser; peak > 0.02)',
    mScan.ok === true && mDet.onsets.length >= 4 && mDet.max > 0.02,
    JSON.stringify({ onsets: mDet.onsets.length, max: fx3(mDet.max), dthr: fx3(mDet.dthr) }));

  const metroOff = await ev(`(() => { try { return avMetroSet({ on: false }); } catch (e) { return { error: String((e && e.message) || e) }; } })()`);
  await sleep(260);                                          /* let any lookahead tail drain */
  const offScanR = await ev(`window.__stui.scan(1200)`);
  const offScan = val(offScanR) || {};
  const offDet = (offScan.ok === true) ? detectOnsets(offScan.samples || []) : { onsets: [], max: 0, dthr: 0 };
  check('3 metronome OFF: no transients and silence over the next ~1.2 s',
    metroOff !== null && offScan.ok === true && offDet.onsets.length === 0 && offDet.max < 0.006,
    JSON.stringify({ onsets: offDet.onsets.length, max: fx3(offDet.max) }));

  /* ── 4. count-in: 2 bars @ 120 bpm = 4000 ms ± 150 ms, ≥ 8 clicks scheduled ──
     RIG SPEC (parent fix, probe-verified 2026-10-07; evidence verify/s1-metro-countin-probe-out.log):
     the count-in runs with the metronome OFF. The count-in clicks regardless of the toggle (§2.2
     CLICK LAW); with the toggle ON, its first click can land on the SAME 128-frame audio quantum
     as the regular train's just-planned click — a duplicate timestamp the set-difference undercounts
     (observed 7 "new" for a full 8). The check asserts the ring delta AND the planner push count. */
  await ev(`(() => { try { avMetroSet({ on: false }); } catch (e) { } return true; })()`);
  await sleep(200);   /* the train drains; the ring stays clean */
  const beforeR = await ev(`(() => { try { const s = avMetroState(); return { clicks: (s && Array.isArray(s.clicks)) ? s.clicks.map((c) => (c && typeof c === 'object') ? c.t : c) : [], planned: (s && typeof s.planned === 'number') ? s.planned : null }; } catch (e) { return { clicks: [], planned: null }; } })()`);
  const before = val(beforeR) || {};
  const beforeClicks = Array.isArray(before.clicks) ? before.clicks : [];
  const ciR = await ev(`(async () => {
    const t0 = performance.now();
    let r = null, err = null;
    try { r = await avMetroCountIn(2); } catch (e) { err = String((e && e.message) || e); }
    return { r: r, err: err, ms: performance.now() - t0 };
  })()`);
  const ci = val(ciR) || {};
  const ciMs = Number(ci.ms);
  const ciR_ = ci.r || {};
  check('4 avMetroCountIn(2) resolves in ~2 bars (4000 ms ± 150 ms page-measured) with ok true',
    ci.err === null && ciR_.ok === true && isFinite(ciMs) && Math.abs(ciMs - 4000) <= 150,
    JSON.stringify({ ms: fx3(ciMs), r: { ok: ciR_.ok, bars: ciR_.bars, seconds: ciR_.seconds }, err: ci.err }));
  const afterR = await ev(`(() => { try { const s = avMetroState(); return { clicks: (s && Array.isArray(s.clicks)) ? s.clicks.map((c) => (c && typeof c === 'object') ? c.t : c) : [], planned: (s && typeof s.planned === 'number') ? s.planned : null }; } catch (e) { return { clicks: [], planned: null }; } })()`);
  const after = val(afterR) || {};
  const afterClicks = Array.isArray(after.clicks) ? after.clicks : [];
  const beforeSet = new Set(beforeClicks.filter((t) => typeof t === 'number'));
  const newClicks = afterClicks.filter((t) => typeof t === 'number' && !beforeSet.has(t));
  const plannedDelta = Number(after.planned) - Number(before.planned);
  check('4 count-in scheduled ≥ 8 clicks (ring delta ≥ 8 AND planner pushes ≥ 8)', newClicks.length >= 8 && plannedDelta >= 8, 'ring delta=' + newClicks.length + ' · planned delta=' + plannedDelta);
  await ev(`(() => { try { avMetroSet({ on: false }); } catch (e) { } return true; })()`);

  /* ── 5. takes (lapSync false): start → ~1.5 s → stop → frames ≈ 1.5·sr ── */
  const armR = await ev(`(() => { try { return avTakesArm(true); } catch (e) { return null; } })()`);
  note('arm(true) -> ' + JSON.stringify(val(armR)) + ' (a start with live input arms implicitly — av_takes.js ARMING note)');
  const st5R = await ev(`(async () => { try { return await avTakesStart({ lapSync: false }); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } })()`);
  const st5 = val(st5R) || {};
  check('5 avTakesStart({lapSync:false}): ok · sr 48000 · block 4096 · lapSync false · channels ≥ 1 · offsetFrames ≥ 0 (honest)',
    st5.ok === true && st5.sr === 48000 && st5.block === 4096 && st5.lapSync === false && Number(st5.channels) >= 1 && Number(st5.offsetFrames) >= 0,
    JSON.stringify({ ok: st5.ok, sr: st5.sr, block: st5.block, channels: st5.channels, offsetFrames: st5.offsetFrames, error: st5.error }));
  const wall5 = Date.now();
  await sleep(1500);
  const fin5R = await ev(`(async () => {
    let r = null;
    try { r = avTakesStop(); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    if (r && typeof r.then === 'function') { r = await r; }
    return r;
  })()`);
  const fin5 = val(fin5R) || {};
  const wall5s = (Date.now() - wall5) / 1000;
  const blockFrames = 4096, settleBlocks = Math.ceil(180 * 48 / 4096);
  const lo5 = 72000 - 2 * blockFrames, hi5 = 72000 + (settleBlocks + 2) * blockFrames;
  check('5 stop → frames ≈ 1.5·sr [−2 blocks, +settle+2 blocks ≈ 180 ms soak + one block alignment] · stopReason "stop" · exactly 1 take',
    fin5.ok === true && Number(fin5.frames) >= lo5 && Number(fin5.frames) <= hi5 &&
    fin5.stopReason === 'stop' && Array.isArray(fin5.takes) && fin5.takes.length === 1,
    JSON.stringify({ frames: fin5.frames, allowed: lo5 + '…' + hi5, wallS: fx3(wall5s), takes: (fin5.takes || []).map((t) => t.frames) }));
  const take5 = (fin5.takes || [])[0] || {};
  check('5 take model: frames === receipt.frames · partial false · lap 1 · name "Take N" · rate 48000',
    take5.frames === fin5.frames && take5.partial === false && take5.lap === 1 && /^Take \d+$/.test(String(take5.name)) && take5.rate === 48000,
    JSON.stringify(take5));

  const t5StatsR = await ev(`window.__stui.takeStats(${JSON.stringify(take5.id)})`);
  const t5Stats = val(t5StatsR) || {};
  const t5W = t5Stats.wavInfo || {};
  check('5 take is NON-SILENT (beeps): export → avWavInfo ok · 16-bit · 48 k · blob + url · decode peak > 0.05',
    t5Stats.ok === true && t5W.ok === true && t5W.bits === 16 && t5W.sampleRate === 48000 &&
    t5Stats.url === true && Number(t5Stats.bytes) > 44 &&
    !!(t5Stats.stats && t5Stats.stats.ok === true && t5Stats.stats.peak > 0.05),
    JSON.stringify({ name: t5Stats.name, bytes: t5Stats.bytes, url: t5Stats.url, wavInfo: t5W, peak: t5Stats.stats && fx3(t5Stats.stats.peak), nonzero: t5Stats.stats && t5Stats.stats.nonzero }));
  const del5 = await ev(`(() => { try { return avTakesDelete(${JSON.stringify(take5.id)}); } catch (e) { return false; } })()`);
  const list5 = val(await ev(`avTakesList().map((t) => t.id)`)) || [];
  check('5 avTakesDelete(id) true → the list empties', del5.value === true && Array.isArray(list5) && list5.length === 0, JSON.stringify({ del: del5.value, list: list5 }));

  /* take B + C for the keepLast dance */
  const recQuick = async (ms) => {
    const s = await ev(`(async () => { try { return await avTakesStart({ lapSync: false }); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } })()`);
    if (!(val(s) || {}).ok) return { startErr: val(s) };
    await sleep(ms);
    const f = await ev(`(async () => { let r = avTakesStop(); if (r && typeof r.then === 'function') r = await r; return r; })()`);
    return val(f) || {};
  };
  const finB = await recQuick(1200);
  const finC = await recQuick(1200);
  const idsBC = val(await ev(`avTakesList().map((t) => t.id)`)) || [];
  check('5 two more quick takes recorded → list holds 2', !!(finB.ok === true && finC.ok === true) && Array.isArray(idsBC) && idsBC.length === 2, JSON.stringify({ list: idsBC }));
  const kl = await ev(`(() => { try { return avTakesKeepLast(1); } catch (e) { return null; } })()`);
  const listBefore = val(await ev(`avTakesList().length`));
  check('5 avTakesKeepLast(1) -> 1; NOT enforced until a stop (list still 2 — the §2.3 law)',
    kl.value === 1 && listBefore === 2, JSON.stringify({ keepLast: kl.value, list: listBefore }));
  const finD = await recQuick(1200);
  const idsAfter = val(await ev(`avTakesList().map((t) => t.id)`)) || [];
  const lastId = (finD.takes || [])[0] ? finD.takes[0].id : null;
  check('5 keepLast enforced ON STOP: after take D the list is exactly [D] (newest kept, oldest dropped)',
    finD.ok === true && Array.isArray(idsAfter) && idsAfter.length === 1 && idsAfter[0] === lastId,
    JSON.stringify({ list: idsAfter, last: lastId }));

  /* ── 6. lap split on the transport cycle ── */
  await ev(`avTakesKeepLast(8)`);
  const loadR = await ev(`window.__seqi.load()`);
  const load = val(loadR) || {};
  const playR = await ev(`(() => { try { const p = avSeqPlay(); return { p: p, playing: (typeof avSeqIsPlaying === 'function') ? avSeqIsPlaying() : null }; } catch (e) { return { error: String((e && e.message) || e) }; } })()`);
  const play = val(playR) || {};
  check('6 rig pattern loaded (16 on-steps @ 120 bpm) + avSeqPlay() starts the transport', load.ok === true && play.p === true && play.playing === true, JSON.stringify({ load: load, play: play }));
  const st6R = await ev(`(async () => { try { return await avTakesStart({ lapSync: true }); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } })()`);
  const st6 = val(st6R) || {};
  check('6 lap start: lapSync true · cycleSteps 16 · cycleDur ≈ 2 s (120 bpm, grid 16) · cycleFrames ≈ 96000',
    st6.ok === true && st6.lapSync === true && st6.lapReason === 'transport playing' && st6.cycleSteps === 16 &&
    Math.abs(Number(st6.cycleDur) - 2) <= 0.02 && Math.abs(Number(st6.cycleFrames) - 96000) <= 960,
    JSON.stringify({ lapSync: st6.lapSync, reason: st6.lapReason, cycleSteps: st6.cycleSteps, cycleDur: st6.cycleDur, cycleFrames: st6.cycleFrames }));
  await sleep(5200);                                    /* ~2.5 cycles of the 2 s grid */
  const fin6R = await ev(`(async () => { let r = avTakesStop(); if (r && typeof r.then === 'function') r = await r; return r; })()`);
  const fin6 = val(fin6R) || {};
  const laps6 = Array.isArray(fin6.takes) ? fin6.takes : [];
  const full6 = laps6.filter((t) => t.partial === false);
  const tail6 = laps6[laps6.length - 1] || {};
  const lapsAsc = laps6.every((t, i) => i === 0 || (t.lap === laps6[i - 1].lap + 1));
  check('6 lap split: ≥ 2 takes · every FULL lap ≈ 2 s ± 0.15 s (96000 ± 7200 frames) · lap numbers ascending',
    laps6.length >= 2 && full6.length >= 2 && lapsAsc &&
    full6.every((t) => Math.abs(Number(t.frames) - 96000) <= 7200) &&
    full6.every((t) => t.lap >= 1),
    JSON.stringify(laps6.map((t) => ({ id: t.id, lap: t.lap, frames: t.frames, partial: t.partial }))));
  check('6 tail lap kept as partial (the final unfinished cycle) · receipt frames === sum of laps',
    tail6.partial === true && laps6.reduce((s, t) => s + Number(t.frames), 0) === Number(fin6.frames),
    JSON.stringify({ tail: { lap: tail6.lap, frames: tail6.frames, partial: tail6.partial }, frames: fin6.frames }));
  await ev(`(() => { try { avSeqStop(); } catch (e) { } return true; })()`);
  const stp6 = val(await ev(`(typeof avSeqIsPlaying === 'function') ? avSeqIsPlaying() : null`));
  check('6 avSeqStop(): transport stopped', stp6 === false, JSON.stringify({ playing: stp6 }));

  /* abort discipline: a started session is discarded; no take lands; list unchanged */
  const beforeAbortN = val(await ev(`avTakesList().length`));
  const stAb = await ev(`(async () => { try { return await avTakesStart({ lapSync: true }); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } })()`);
  await sleep(600);
  const abR = await ev(`(() => { try { return avTakesAbort(); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } })()`);
  const ab = val(abR) || {};
  const afterAbortN = val(await ev(`avTakesList().length`));
  const recAb = val(await ev(`avTakesState().recording`));
  check('6 abort: {ok:true, aborted:true} · recording false · NO take added (list count unchanged)',
    ab.ok === true && ab.aborted === true && recAb === false && afterAbortN === beforeAbortN,
    JSON.stringify({ abort: ab, before: beforeAbortN, after: afterAbortN }));

  /* ── 7. cleanup — the page left clean ── */
  const cleanR = await ev(`(async () => {
    try { if (typeof avTakesArm === 'function') avTakesArm(false); } catch (e) { }
    try { if (typeof avTakesAbort === 'function') avTakesAbort(); } catch (e) { }
    try { if (typeof avMetroSet === 'function') avMetroSet({ on: false }); } catch (e) { }
    try { if (typeof avSeqStop === 'function') avSeqStop(); } catch (e) { }
    try { if (typeof avInputDisable === 'function') await avInputDisable(); } catch (e) { }
    await new Promise((res) => setTimeout(res, 250));
    let rec = null, armed = null, playing = null, inNode = null, wired = null;
    try { const s = avTakesState(); rec = s.recording; armed = s.armed; wired = s.wired; } catch (e) { }
    try { playing = (typeof avSeqIsPlaying === 'function') ? avSeqIsPlaying() : null; } catch (e) { }
    try { inNode = (typeof avInputNode === 'function') ? (avInputNode() ? true : false) : null; } catch (e) { }
    return { rec: rec, armed: armed, playing: playing, inNode: inNode, wired: wired };
  })()`);
  const clean = val(cleanR) || {};
  check('7 page left clean: takes disarmed + not recording + branch released · transport stopped · input disabled (node empty)',
    clean.rec === false && clean.armed === false && clean.playing === false && (clean.inNode === false || clean.inNode === null) && clean.wired === false,
    JSON.stringify(clean));

  /* zero page errors for the whole run */
  check('7 zero page errors (exceptions · Log errors · console.error)', errors.length === 0, 'page errors=' + errors.length + (errors.length ? ' | ' + errors.slice(0, 3).join(' | ') : ''));

  /* screenshot renders/s1-studio-suite.png */
  await ev(`(() => { const el = document.getElementById('av-studio'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); return true; })()`);
  await sleep(250);
  const rectR = await ev(`(() => { const el = document.getElementById('av-studio'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }; })()`);
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
  check('7 screenshot: renders/s1-studio-suite.png (the studio card, scale 2)', shotOk, shotInfo);

  /* freeze sha before/after */
  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after): ' + shaAfter);
  check('7 freeze: index.html sha256 before === after (unchanged by the run)', shaAfter === shaBefore, shaAfter);
  if (PIN) check('7 freeze: index.html sha256 = pinned', shaBefore === PIN && shaAfter === PIN, 'pinned ' + PIN.slice(0, 12) + '…');
  else note('EXPECT_SHA not pinned — after the S1 build, pass --sha <hex> or set the constant (never loosen)');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'STUDIO FAILED' : 'STUDIO PASSED');
  try { ws.close(); } catch { /* done */ }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('studio harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    /* profile-scoped cleanup (LAW): kill ONLY processes whose command line carries OUR temp
       profile — matched by its unique basename, so the pattern needs no backslash escaping */
    const tag = path.basename(profile);
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
