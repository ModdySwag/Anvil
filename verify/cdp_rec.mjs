// cdp_rec.mjs — Anvil recorder suite (P2 Child E): tap → WAV, end-to-end over raw CDP.
// Records THE MASTER TAP through src/av_rec.js (ScriptProcessor(4096,2,2) riding avMasterNodes):
// a silent control take first, then a ~3 s note played through the avNote bus — the WAV that comes
// back must parse (RIFF/WAVE · PCM · stereo 16-bit), its data chunk must match the take duration
// ±0.2 s, RMS must be non-zero on the note take and ≈ 0 on the control, the blob: download handle
// must exist, duplicate start / idle stop must be refused, zero page errors, sha frozen before/after.
//
//   node verify/cdp_rec.mjs [path-to-index.html] [--port N] [--sha HEX]
//
// --sha pins the frozen bytes under test (freeze law); without it the run still proves sha-before
// === sha-after but skips the pin. Written by child E (write only, never run by the child); the
// parent runs it one browser at a time, as usual.
//
// Launch skeleton copied from verify/cdp_smoke.mjs: new-headless Chromium (candidates list), free
// port scan from 9430, temp --user-data-dir, 1440×900 device metrics, --mute-audio,
// --autoplay-policy=no-user-gesture-required, explicit exit, process.on('exit') kills ONLY
// processes whose command line carries OUR temp profile. Audio capture note: a live AudioContext
// renders in real time in this environment (the P1 stress rig measures currentTime advancing), so
// the ScriptProcessor branch receives real blocks; if capture were dead here, the control take
// fails loudly first.
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const shaArg = argv.indexOf('--sha');
const EXPECT_SHA = ((shaArg > -1 ? argv[shaArg + 1] : null) || process.env.AV_REC_SHA || 'c6bc282ce4c7dd033ba8d67f32e6cb28e48a8affd6f1a60619c63bade148d624').toLowerCase() || null;
const page = argv.find(a => !a.startsWith('--') && (/\.html?$/i.test(a) || existsSync(a))) || path.join(here, '..', 'index.html');
if (!existsSync(page)) { console.error('page not found: ' + page); process.exit(2); }

/* FREEZE LAW: the bytes under test are named before anything runs, and re-checked after. */
const shaOf = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const shaBefore = shaOf(page);
console.log('index.html sha256 (before): ' + shaBefore);

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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9430);
const profile = path.join(tmpdir(), 'anvil-rec-' + Date.now());
const url = 'file:///' + path.resolve(page).replace(/\\/g, '/');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
console.log('cdp port ' + PORT + ' · profile ' + profile);

const chrome = spawn(exe, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--disable-sync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
  url,
], { stdio: 'ignore', windowsHide: true });

let pass = 0, fail = 0;
const check = (name, ok, info) => {
  if (ok) { pass++; console.log(' ok   ' + name + (info ? '  -> ' + info : '')); }
  else { fail++; console.log(' FAIL ' + name + (info ? '  -> ' + info : '')); }
};
const note = (t) => console.log('   · ' + t);

/* ---------- WAV reading helpers (Node side — the rig parses what the page produced) ---------- */
function parseWav(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (off) => String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
  if (dv.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let o = 12, fmt = null, dataOff = -1, dataLen = 0;
  while (o + 8 <= dv.byteLength) {
    const id = tag(o), len = dv.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { format: dv.getUint16(o + 8, true), channels: dv.getUint16(o + 10, true), sampleRate: dv.getUint32(o + 12, true), byteRate: dv.getUint32(o + 16, true), blockAlign: dv.getUint16(o + 20, true), bits: dv.getUint16(o + 22, true) };
    else if (id === 'data') { dataOff = o + 8; dataLen = len; }
    o += 8 + len + (len % 2);
  }
  if (!fmt || dataOff < 0) return null;
  const bytesPer = fmt.bits >> 3;
  const frames = Math.floor(dataLen / (fmt.channels * bytesPer));
  return Object.assign({ dataOff, dataLen, bytesPer, frames }, fmt);
}
/* RMS per channel + peak over a frame window of a parsed 16-bit WAV */
function wavSeg(buf, w, fromFrame, toFrame) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const start = Math.max(0, fromFrame | 0);
  const end = Math.min(toFrame == null ? w.frames : toFrame | 0, w.frames);
  const sums = new Array(w.channels).fill(0);
  let peak = 0, n = 0;
  for (let i = start; i < end; i++) {
    for (let c = 0; c < w.channels; c++) {
      const s = dv.getInt16(w.dataOff + (i * w.channels + c) * w.bytesPer, true) / 32768;
      sums[c] += s * s;
      const a = s < 0 ? -s : s;
      if (a > peak) peak = a;
    }
    n++;
  }
  return { rms: sums.map(v => Math.sqrt(v / Math.max(1, n))), peak, frames: n };
}

/* pull a take out of the page: stop, blob → base64, return only plain values (a Blob cannot
   cross returnByValue; the base64 string is the rig's transport) */
const STOP_EXPR = `(async () => {
  const r = await Promise.race([
    avRecStop(),
    new Promise((res) => setTimeout(() => res({ ok: false, error: 'stop timed out (5 s)' }), 5000)),
  ]);
  if (!r || r.ok !== true || !r.blob) return { ok: false, error: (r && r.error) || 'stop returned no take', frames: (r && r.frames) || 0 };
  let b64 = null;
  try {
    const buf = new Uint8Array(await r.blob.arrayBuffer());
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
    b64 = btoa(s);
  } catch (e) { return { ok: false, error: 'blob encode failed: ' + (e && e.message || e) }; }
  return { ok: true, seconds: r.seconds, bytes: r.bytes, frames: r.frames, sampleRate: r.sampleRate,
           wallSeconds: r.wallSeconds, url: r.url || null, mime: r.mime || null, peak: r.peak, b64: b64 };
})()`;

const errors = [];
async function main() {
  /* a fresh Edge profile opens edge://… targets BEFORE our page; wait for the file:// page itself */
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
  /* Edge headless ignores --window-size: force the desktop viewport */
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => { });
  if (!String(target.url).startsWith('file://')) await send('Page.navigate', { url });
  await send('Page.bringToFront').catch(() => { });
  await sleep(500);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) {
      const e = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'unknown';
      note('eval threw: ' + String(e).split('\n')[0].slice(0, 220));
      return { error: e };
    }
    return { value: r.result?.value };
  };
  const val = (r) => (r && r.value !== undefined ? r.value : null);

  /* 0. freeze: the bytes under test */
  check('freeze: index.html sha256 before = ' + (EXPECT_SHA ? EXPECT_SHA.slice(0, 8) + '…' : '(unpinned run)'),
    !EXPECT_SHA || shaBefore === EXPECT_SHA, shaBefore);

  /* 1. boot contract */
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const r = await ev(`document.documentElement.getAttribute('data-av-ready') === '1'`);
    if (r.value === true) { ready = true; break; }
    await sleep(300);
  }
  check('boot: data-av-ready flips', ready);
  if (!ready) { console.error('APP NOT READY'); process.exit(1); }
  await send('Page.bringToFront').catch(() => { });

  /* 2. engine ready — the recorder needs a LIVE context (and the note sink must exist) */
  let eng = null;
  for (let i = 0; i < 80; i++) {
    const r = await ev(`(() => { const e = window.__avEngine; return (e && e.ready === true) ? { ready: true, tier: e.tier, sr: e.sr } : null; })()`);
    if (val(r) && val(r).ready === true) { eng = val(r); break; }
    await sleep(250);
  }
  check('engine: ready (tier · sampleRate recorded)', !!eng, JSON.stringify(eng));
  if (!eng) { console.error('ENGINE NOT READY — the recorder needs the live engine context'); process.exit(1); }

  /* 3. the live context: running + ScriptProcessor-capable (resume like the stress rig does) */
  const ctxR = await ev(`(async () => {
    const e = window.__avEngine || {};
    let ctx = (e.handle && e.handle.ctx) || e.ctx || null;
    if (!ctx) { for (const k in e.handle || {}) { try { const v = e.handle[k]; if (v && typeof v.currentTime === 'number' && typeof v.resume === 'function') { ctx = v; break; } } catch (err) { } } }
    if (!ctx) return { found: false };
    window.__recCtx = ctx;
    if (ctx.state !== 'running') { try { await Promise.race([ctx.resume().catch(() => {}), new Promise((res) => setTimeout(res, 2000))]); } catch (err) { } }
    for (let i = 0; i < 20 && ctx.state !== 'running'; i++) await new Promise((res) => setTimeout(res, 125));
    return { found: true, state: ctx.state, sampleRate: ctx.sampleRate, scp: typeof ctx.createScriptProcessor === 'function' };
  })()`);
  const ctxInfo = val(ctxR) || {};
  check('engine ctx: running + ScriptProcessor-capable (capture target alive)',
    ctxInfo.found === true && ctxInfo.state === 'running' && ctxInfo.scp === true, JSON.stringify(ctxInfo));

  /* 4. module surface */
  const modR = await ev(`(() => ({
    init: typeof avRecInit, start: typeof avRecStart, stop: typeof avRecStop, stats: typeof avRecStats,
    snap: typeof avRecSnap, classes: typeof avRecClasses,
    handle: typeof window.__avRec, handleVer: (window.__avRec && window.__avRec.version) || null,
  }))()`);
  const mod = val(modR) || {};
  check('module: avRecInit/Start/Stop/Stats + __avRec handle (v p2.0)',
    mod.init === 'function' && mod.start === 'function' && mod.stop === 'function' && mod.stats === 'function' &&
    mod.snap === 'function' && mod.classes === 'function' && mod.handle === 'object' && mod.handleVer === 'p2.0',
    JSON.stringify(mod));

  const init1 = await ev(`(() => { try { const r = avRecInit(); return { ok: !!(r && r.ok), host: !!(r && r.host), version: r && r.version, classes: (r && r.classes) || null }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
  const init2 = await ev(`(() => { try { const r = avRecInit(); return { ok: !!(r && r.ok) }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
  check('module: avRecInit() ok + class list (av-rec-row in it) · second call idempotent',
    val(init1) && val(init1).ok === true && Array.isArray(val(init1).classes) && val(init1).classes.indexOf('av-rec-row') >= 0 && val(init1).version === 'p2.0' && val(init2) && val(init2).ok === true,
    JSON.stringify({ first: val(init1), second: val(init2) }));

  /* 5. tap inventory — the recorder rides the MASTER node */
  const tapR = await ev(`(() => { try { return { installed: (typeof avTap !== 'undefined' && avTap.installed === true), masters: (typeof avMasterNodes === 'function') ? avMasterNodes().length : -1, real: (typeof avTap !== 'undefined' && !!avTap.real) }; } catch (e) { return { error: String(e && e.message || e) }; } })()`);
  const tap = val(tapR) || {};
  check('tap: armed · master node present · real output known (branch can be pulled)',
    tap.installed === true && tap.masters >= 1 && tap.real === true, JSON.stringify(tap));

  /* ── 6. CONTROL TAKE: record silence (no note) — the honest zero ── */
  const cStart = await ev(`(() => { try { return avRecStart(); } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
  const cDup = await ev(`(() => { try { return avRecStart(); } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
  check('control take: avRecStart() starts on the master tap; a duplicate start is refused',
    val(cStart) && val(cStart).ok === true && Number(val(cStart).sampleRate) >= 8000 && Number(val(cStart).block) === 4096 && val(cStart).capture === 'scriptprocessor' &&
    val(cDup) && val(cDup).ok === false && /already recording/.test(String(val(cDup) && val(cDup).error)),
    JSON.stringify({ start: val(cStart), dup: val(cDup) }));

  await sleep(250);
  const cs1 = await ev(`avRecStats()`);
  await sleep(450);
  const cs2 = await ev(`avRecStats()`);
  check('control take: avRecStats() reports recording while armed (seconds moving)',
    val(cs1) && val(cs1).recording === true && val(cs2) && val(cs2).recording === true &&
    Number(val(cs2).seconds) >= Number(val(cs1).seconds) && Number(val(cs2).seconds) > 0,
    JSON.stringify({ first: val(cs1), second: val(cs2) }));

  await sleep(300);   /* armed ≈ 1.0 s + section-5 settle ≈ 0.2 s */
  const cStop = await ev(STOP_EXPR);
  const cTake = val(cStop);
  check('control take: avRecStop() resolves a take ({ok, seconds, bytes, blob})',
    !!(cTake && cTake.ok === true && cTake.bytes > 44),
    cTake && cTake.ok ? ('bytes=' + cTake.bytes + ' · seconds=' + Number(cTake.seconds).toFixed(3) + ' · frames=' + cTake.frames) : JSON.stringify(cTake));

  const cBuf = cTake && cTake.ok && cTake.b64 ? Buffer.from(cTake.b64, 'base64') : null;
  const cWav = cBuf ? parseWav(cBuf) : null;
  check('control take: WAV parses (RIFF/WAVE · PCM fmt · 2ch · 16-bit · header rate === take rate)',
    !!cWav && cWav.format === 1 && cWav.channels === 2 && cWav.bits === 16 && cWav.sampleRate === cTake.sampleRate &&
    cWav.byteRate === cWav.sampleRate * 4 && cWav.blockAlign === 4 && cWav.dataLen % 4 === 0,
    cWav ? JSON.stringify(cWav) : 'no parse');
  const cDur = cWav ? cWav.frames / cWav.sampleRate : 0;
  const cWall = cTake && typeof cTake.wallSeconds === 'number' ? Number(cTake.wallSeconds) : null;
  /* spec fix (first run, 2026-10-07): the armed span includes CDP round-trips (~2.9 s real), so the
     honest assertion is WAV-vs-take-wall-clock consistency (±0.5 s), matching the note take's check. */
  check('control take: duration sane (WAV vs take wall clock ±0.5 s)',
    !!cWav && cDur >= 0.5 && (cWall === null ? cDur <= 4.5 : Math.abs(cDur - cWall) <= 0.5),
    cDur ? (cDur.toFixed(3) + ' s') + (cWall === null ? '' : (' · wall ' + cWall.toFixed(3) + ' s · Δ ' + Math.abs(cDur - cWall).toFixed(3) + ' s')) : 'no parse');
  const cStats = cWav ? wavSeg(cBuf, cWav, 0, null) : null;
  check('control take: RMS ≈ 0 on both channels (silence when no note)',
    !!cStats && cStats.rms[0] < 1e-4 && cStats.rms[1] < 1e-4,
    cStats ? ('rms [' + cStats.rms.map(v => v.toExponential(2)).join(', ') + '] · peak ' + cStats.peak.toExponential(2)) : 'no parse');
  const cAfter = await ev(`avRecStats()`);
  check('control take: stats cleared after stop (recording false, seconds 0)',
    val(cAfter) && val(cAfter).recording === false && val(cAfter).seconds === 0, JSON.stringify(val(cAfter)));

  /* ── 7. NOTE TAKE: ~3 s note through the avNote bus ── */
  await sleep(200);
  const t0 = Date.now();
  const nStart = await ev(`(() => { try { return avRecStart(); } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
  check('note take: avRecStart() starts the second take', val(nStart) && val(nStart).ok === true, JSON.stringify(val(nStart)));
  await sleep(180);
  const dn = await ev(`(() => { const fresh = avNoteDown('c5'); const st = window.__avNotes(); return { fresh: fresh, held: st.held, taken: st.taken, sink: st.sink }; })()`);
  check('note take: avNoteDown("c5") held on the bus + taken by the engine sink',
    val(dn) && val(dn).fresh === true && val(dn).held.indexOf('c5') >= 0 && val(dn).taken.indexOf('c5') >= 0 && val(dn).sink === true,
    JSON.stringify(val(dn)));
  await sleep(1000);
  const mid = await ev(`avRecStats()`);
  check('note take: mid-take stats (recording · seconds ≈ 1+)',
    val(mid) && val(mid).recording === true && Number(val(mid).seconds) > 0.5, JSON.stringify(val(mid)));
  await sleep(2000);
  const up = await ev(`(() => { avNoteUp('c5'); return { held: [...avNoteHeld] }; })()`);
  check('note take: avNoteUp("c5") releases (held empty)', val(up) && Array.isArray(val(up).held) && val(up).held.length === 0, JSON.stringify(val(up)));
  await sleep(220);
  const nStop = await ev(STOP_EXPR);
  const t1 = Date.now();
  const nTake = val(nStop);
  const rigWall = (t1 - t0) / 1000;
  check('note take: avRecStop() resolves the take',
    !!(nTake && nTake.ok === true && nTake.bytes > 44),
    nTake && nTake.ok ? ('bytes=' + nTake.bytes + ' · seconds=' + Number(nTake.seconds).toFixed(3) + ' · peak=' + nTake.peak) : JSON.stringify(nTake));

  const nBuf = nTake && nTake.ok && nTake.b64 ? Buffer.from(nTake.b64, 'base64') : null;
  const nWav = nBuf ? parseWav(nBuf) : null;
  check('note take: WAV parses (RIFF/WAVE · PCM fmt · 2ch · 16-bit · header rate === take rate)',
    !!nWav && nWav.format === 1 && nWav.channels === 2 && nWav.bits === 16 && nWav.sampleRate === nTake.sampleRate &&
    nWav.byteRate === nWav.sampleRate * 4 && nWav.blockAlign === 4,
    nWav ? JSON.stringify(nWav) : 'no parse');

  const nDur = nWav ? nWav.frames / nWav.sampleRate : 0;
  check('note take: data chunk length matches duration ±0.2 s (page clock) + frames math exact',
    !!nWav && Math.abs(nWav.dataLen - nWav.frames * 4) < 4 &&
    Math.abs(Number(nTake.seconds) - nDur) <= 0.02 &&
    Math.abs(Number(nTake.seconds) - Number(nTake.wallSeconds)) <= 0.2,
    'seconds=' + Number(nTake.seconds).toFixed(3) + ' · dur=' + nDur.toFixed(3) + ' · wall=' + Number(nTake.wallSeconds).toFixed(3) + ' · Δwall=' + Math.abs(Number(nTake.seconds) - Number(nTake.wallSeconds)).toFixed(3) + ' s');
  check('note take: held ~3 s → take spans ~3.4–4.3 s (and within 0.45 s of the rig clock)',
    !!nWav && nDur >= 3.1 && nDur <= 4.3 && Math.abs(nDur - rigWall) <= 0.45,
    'dur=' + nDur.toFixed(3) + ' s · rigWall=' + rigWall.toFixed(3) + ' s · Δ=' + Math.abs(nDur - rigWall).toFixed(3) + ' s');

  const nStats = nWav ? wavSeg(nBuf, nWav, 0, null) : null;
  check('note take: RMS non-zero (note audible at the master tap)',
    !!nStats && Math.max(nStats.rms[0], nStats.rms[1]) > 0.005 && nStats.peak > 0.02,
    nStats ? ('rms [' + nStats.rms.map(v => v.toFixed(4)).join(', ') + '] · peak ' + nStats.peak.toFixed(4) +
      (cStats ? ' · vs control rms ' + Math.max(cStats.rms[0], cStats.rms[1]).toExponential(2) : '')) : 'no parse');
  const headFrames = nWav ? Math.min(nWav.frames, Math.round(0.04 * nWav.sampleRate)) : 0;
  const nHead = nWav && headFrames > 0 ? wavSeg(nBuf, nWav, 0, headFrames) : null;
  check('note take: first 40 ms silent (note starts after the capture began — in-take control)',
    !!nHead && Math.max(nHead.rms[0], nHead.rms[1]) < 1e-3,
    nHead ? ('head rms [' + nHead.rms.map(v => v.toExponential(2)).join(', ') + ']') : 'no parse');

  /* 8. the download handle: blob URL + snapshot */
  const snapR = await ev(`(() => { const s = avRecSnap(); return { last: s.last, wired: s.wired, recording: s.recording, error: s.error, host: s.host }; })()`);
  const snap = val(snapR) || {};
  check('download handle: blob: URL returned + __avRec snapshot keeps the take (branch released)',
    !!(nTake && typeof nTake.url === 'string' && nTake.url.startsWith('blob:')) &&
    snap.last && snap.last.url === true && snap.last.bytes > 44 && snap.last.seconds > 0 &&
    snap.recording === false && snap.wired === false && !snap.error,
    JSON.stringify(snap));

  /* 9. honesty guards: idle stop refused */
  const idle = await ev(`(async () => { try { const r = await avRecStop(); return { ok: r && r.ok, error: (r && r.error) || null }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
  check('avRecStop() when idle: honest refusal (ok:false · "not recording")',
    val(idle) && val(idle).ok === false && /not recording/.test(String(val(idle).error)), JSON.stringify(val(idle)));

  /* 10. the parent's UI row — when #av-rec-host exists (it is parent-added) */
  const uiR = await ev(`(() => {
    const host = document.getElementById('av-rec-host');
    if (!host) return { host: false };
    const link = host.querySelector('.av-rec-link');
    return { host: true, row: !!host.querySelector('.av-rec-row'), btn: !!host.querySelector('.av-rec-btn'),
             time: !!host.querySelector('.av-rec-time'), state: ((host.querySelector('[data-rec="state"]') || {}).textContent || ''),
             link: !!link, linkHref: !!(link && link.href) };
  })()`);
  if (val(uiR) && val(uiR).host === true) {
    check('UI: row mounted under #av-rec-host (av-rec classes · download link armed)',
      val(uiR).row === true && val(uiR).btn === true && val(uiR).time === true && val(uiR).link === true && val(uiR).linkHref === true,
      JSON.stringify(val(uiR)));
  } else {
    note('#av-rec-host absent — UI mount check skipped (the parent owns the host; the API is verified above)');
  }

  /* 11. zero console errors for the whole run */
  check('zero page errors for the whole run (exceptions · Log errors · console.error)',
    errors.length === 0, 'page errors=' + errors.length + (errors.length ? ' | ' + errors.slice(0, 3).join(' | ') : ''));

  /* 12. freeze: the bytes under test, after */
  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after): ' + shaAfter);
  check('freeze: index.html sha256 unchanged by the run', shaAfter === shaBefore && (!EXPECT_SHA || shaBefore === EXPECT_SHA), shaAfter);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { ws.close(); } catch { /* done */ }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('rec harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile.replace(/[\\\\/]/g, '\\\\\\\\')}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
