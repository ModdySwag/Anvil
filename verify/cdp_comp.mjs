// cdp_comp.mjs — Anvil S2.1 COMP suite (child sa-C's rig; WRITTEN by sa-C, RUN BY THE PARENT
// after integration). End-to-end over raw CDP against the frozen single-file build.
//
//   node verify/cdp_comp.mjs [path-to-index.html] [--port N] [--sha <hex>]
//
// WRITE-ONLY: this file is authored by sa-C and never executed by sa-C. The parent runs it after
// the S2.1 integration build (index.html must contain av_comp.js + av_comp_ui.js after
// av_session_ui and before av_synth; body.html must carry the #av-comp card + #av-comp-host;
// app_core boots avCompInit() -> avCompUiInit()).
//
// Launch skeleton copied VERBATIM from cdp_studio.mjs (candidates Chrome/Edge/Brave, free-port
// scan, fresh temp --user-data-dir, 1440×900 device metrics override — Edge headless ignores
// --window-size, --mute-audio, --autoplay-policy=no-user-gesture-required, ONE browser, explicit
// exit, process.on('exit') kills ONLY processes whose command line carries OUR temp profile),
// PLUS the two fake-media flags the takes legs need:
//   --use-fake-ui-for-media-stream  (auto-grants getUserMedia)
//   --use-fake-device-for-media-stream  (the BEEP-TRAIN fake device — NEVER assert continuous
//                                        audio: assert pips/peaks only)
// SHA freeze discipline from cdp_studio.mjs: index.html is sha256'd before and after the run and
// the two must match. EXPECT_SHA is null until the parent pins the frozen S2.1 sha (constant
// below or --sha <hex>); while it is null the rig still enforces before === after.
//
// WHAT IT PROVES, in order (contract: verify/_s2b_wave.md §2.3 proofs 1–7):
//   1. boot (data-av-ready) + the live engine ctx (the §0 fake device needs it) + the comp card
//      mounted into #av-comp / #av-comp-host: `.av-comp` root, host wired marker
//      (avCompUiWired='1'), the LANES/COMP controls present (tolerant label scan: ADD SEGMENT ·
//      AUTO-COMP · RENDER · EXPORT WAV · FADE), the module globals live (avComp* · avCompUi*)
//      and the debug handles (window.__avComp version s2.1 incl. pure.xfadeGains/applyXfade/
//      stitch · window.__avCompUi). Page pristine: zero comps, zero takes, not recording.
//   2. takes: input enable on the fake device (beep-train witness on avInputNode) + two quick
//      takes via the avTakes path (avTakesStart/Stop, lapSync false, ~1.2 s and ~2.0 s — the
//      capture is 4096-frame block-quantized, so the waits differ by whole blocks) — the list
//      holds two takes with rig-evidenced DISTINCT frames; the card's lanes repaint (poll).
//   3. single-segment comp: avCompCreate + avCompAddSegment/avCompSetSegment (take A full range)
//      -> render frames === take A frames EXACTLY (±0); export -> avWavInfo ok 16-bit/48 kHz
//      stereo + blob + blob: url + in-page WAV decode NON-SILENT (fake-device beeps; peak > 0.05).
//   4. multi-segment + trims: segments [A 0..N/2, B 0..N/2] -> render ≈ N (minus the seam);
//      shrinking a segment's window by delta shrinks the render by EXACTLY delta; an oversized
//      toFrame CLAMPS to the take length (no throw) and the clamp re-renders by the exact stitch
//      math.
//   5. crossfade math (pure, rig-owned synthetic signals): pure.xfadeGains(n) — g1²+g2² = 1
//      (<= 1e-6) everywhere · endpoints g1 1→0 · g2 0→1 · monotone pair; pure.applyXfade on
//      constant signals is EXACT (a=1s,b=0s -> output = g1; a=0s,b=1s -> g2); pure.stitch
//      deterministic (two calls -> identical bytes; frames = ΣL − seam).
//   6. lap auto-comp: rig pattern (16 on-steps @ 120 bpm -> 2 s cycle) + avSeqPlay + a lapSync
//      take over ~2.5 cycles -> ≥ 2 takes, ≥ 2 FULL laps ≈ 2 s ± 0.15 s, tail partial ->
//      avCompAutoComp -> segments ≥ regions; the winning takeIds are the rig's OWN recomputed
//      pick-best winners — the rig re-reads the take store, re-derives cycle/owner/regions and
//      re-scores every region with its own pooled rms/peak reads (real values, never planted);
//      the segment ranges match the pinned region math; the render === the rig-own region
//      picks minus the pinned default seams AND === the exact stitch math ΣL − Σseam.
//   7. seal: card repaint witness + screenshot renders/s2b-comp-suite.png (the comp card, scale
//      2, taken while the card still carries the run's lanes/segments) · the page is left CLEAN
//      (comps deleted, takes deleted, transport stopped, input disabled) · zero page errors ·
//      freeze sha256 before === after.
// UNDETERMINED / deliberately not exercised here: the export DOWNLOAD to disk (§2.3 asks only
// for blob/url + in-page decode; the card's download leg belongs to the UI suite), inline trim
// editing (card v1 drives trims through the pinned engine — documented seam), comps riding
// session snapshots (documented future). Tolerant reads on anything unpinned (the first parent
// run surfaces mismatches by design).
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
   S2.1: the frozen sha of the rebuilt index.html is not known until build.py runs — the parent
   may fill this constant or pass --sha <hex>; the rig never loosens the before === after check. */
const EXPECT_SHA = '6c54b4884f1052acf4c5f15907c78d50caedeeacd6d3590e7cb8958e2933f2f4';
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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9600);
const profile = path.join(tmpdir(), 'anvil-comp-' + Date.now());
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

/* ---------- page-side scaffolding injected at runtime (rig-owned; never app code) ----------
   __compw: the rig's OWN witnesses/helpers —
     pureGet/g1g2: the pure crossfade surface (tolerant pair reads);
     stats(buf)/blobStats(blob): in-page WAV decode (avWavInfo + DataView, 16-bit peak/nonzero/rms);
     eqBytes: byte-exact Float32Array comparison (stitch determinism);
     captureInput(ms): the §0 probe — MediaStreamSource path via avInputNode() riding a parallel
       ScriptProcessor(4096): input -> sp -> gain-0 sink -> avTap.real, counting frames/peak/
       nonzero of whatever the input node carries (the beep train);
     store(): the READ-ONLY avTakes store read (avTakes.takes, typeof+try guarded);
     rmsPeak(chans, from, to): the pinned pooled metric (sum of squares over every channel,
       non-finite samples skipped — mirrors av_comp.js exactly);
     expected(): the rig's OWN pick-best recomputation — re-derives owner (longest, ties earlier),
       cycleFrames (median of full-lap take frames) and regions from the live store, then scores
       every take over every region with rmsPeak and picks the winner (ties -> earlier). Real
       digests read at run time, never planted values.
   __seqi: the rig PATTERN loader — the cdp_studio approach (import string -> avSeqPatternImport
     -> avSeqLoad fallback -> avSeqSetPattern(avSeqSnap()) sync -> avApplyParam('bpm', 120)). */

const COMPW_HELPERS = `window.__compw = (function () {
  const W = { v: 1 };
  W.pureGet = function () { try { return (window.__avComp && window.__avComp.pure) || null; } catch (e) { return null; } };
  W.g1g2 = function (pair) {
    try {
      if (!pair) return null;
      const g1 = pair.g1 || pair[0];
      const g2 = pair.g2 || pair[1];
      if (!g1 || !g2 || typeof g1.length !== 'number' || typeof g2.length !== 'number') return null;
      return { g1: g1, g2: g2 };
    } catch (e) { return null; }
  };
  W.eqBytes = function (a, b) {
    try {
      const u1 = new Uint8Array(a.buffer, a.byteOffset || 0, a.byteLength);
      const u2 = new Uint8Array(b.buffer, b.byteOffset || 0, b.byteLength);
      if (u1.length !== u2.length) return false;
      for (let i = 0; i < u1.length; i++) if (u1[i] !== u2[i]) return false;
      return true;
    } catch (e) { return false; }
  };
  W.stats = function (buf) {
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
      return { ok: true, info: { ok: info.ok, bits: info.bits, sampleRate: info.sampleRate, channels: info.channels, frames: info.frames }, peak: peak, nonzero: nonzero, rms: Math.sqrt(rms / (n || 1)), n: n };
    } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
  };
  W.blobStats = async function (blob) {
    try { const ab = await blob.arrayBuffer(); return W.stats(ab); } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
  };
  W.captureInput = function (ms) {
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
  W.store = function () {
    try { if (typeof avTakes !== 'undefined' && avTakes && Array.isArray(avTakes.takes)) return avTakes.takes; } catch (e) { }
    try { if (window.avTakes && Array.isArray(window.avTakes.takes)) return window.avTakes.takes; } catch (e) { }
    return null;
  };
  W.rmsPeak = function (chans, from, to) {
    let sum = 0, peak = 0, n = 0;
    try {
      for (let c = 0; c < chans.length; c++) {
        const ch = chans[c];
        const hi = to < ch.length ? to : ch.length;
        for (let i = from; i < hi; i++) {
          const v = ch[i];
          if (typeof v !== 'number' || !isFinite(v)) continue;
          sum += v * v;
          const a = v < 0 ? -v : v;
          if (a > peak) peak = a;
          n += 1;
        }
      }
    } catch (e) { }
    return { rms: n ? Math.sqrt(sum / n) : 0, peak: peak, n: n };
  };
  W.expected = function () {
    const store = W.store();
    if (!store) return { ok: false, why: 'avTakes store unreachable (avTakes.takes)' };
    const spans = [];
    for (let i = 0; i < store.length; i++) {
      const t = store[i];
      try {
        if (!t || !t.data || typeof t.data.length !== 'number' || !(t.data.length >= 1)) continue;
        const chans = [];
        for (let c = 0; c < t.data.length && c < 8; c++) {
          const ch = t.data[c];
          if (!ch || typeof ch.length !== 'number' || !(ch.length >= 1)) { chans.length = 0; break; }
          chans.push(ch);
        }
        if (!chans.length) continue;
        let dataLen = chans[0].length;
        for (let c = 1; c < chans.length; c++) if (chans[c].length < dataLen) dataLen = chans[c].length;
        let frames = Math.round(Number(t.frames));
        if (!isFinite(frames) || frames < 0) frames = dataLen;
        if (frames > dataLen) frames = dataLen;
        if (!(frames > 0)) continue;
        spans.push({ id: String(t.id), frames: frames, chans: chans, partial: t.partial === true });
      } catch (e) { }
    }
    if (!spans.length) return { ok: false, why: 'no readable take spans in the store' };
    let owner = spans[0];
    for (let i = 1; i < spans.length; i++) if (spans[i].frames > owner.frames) owner = spans[i];
    const full = [];
    for (let i = 0; i < spans.length; i++) if (spans[i].partial !== true && spans[i].frames > 0) full.push(spans[i].frames);
    full.sort(function (x, y) { return x - y; });
    let cycle = 0;
    if (full.length) cycle = (full.length % 2) ? full[(full.length - 1) / 2] : Math.round((full[full.length / 2 - 1] + full[full.length / 2]) / 2);
    if (!(cycle > 0)) cycle = owner.frames;
    if (!(cycle > 0)) return { ok: false, why: 'no cycle (empty takes)' };
    const regions = Math.max(1, Math.ceil(owner.frames / cycle));
    const ids = [], ranges = [], wframes = [], top = [];
    let skipped = 0;
    for (let r = 0; r < regions; r++) {
      const from = r * cycle;
      let best = null, bestScore = 0, bestN = 0;
      for (let ti = 0; ti < spans.length; ti++) {
        const t = spans[ti];
        const to = Math.min((r + 1) * cycle, t.frames);
        if (to <= from) continue;
        const m = W.rmsPeak(t.chans, from, to);
        if (!(m.n > 0)) continue;
        const score = m.rms * (m.peak <= 0.98 ? 1 : 0.5);
        if (!isFinite(score)) continue;
        if (best === null || score > bestScore) { best = t; bestScore = score; bestN = m.n; }
      }
      if (!best) { skipped += 1; continue; }
      ids.push(best.id);
      ranges.push([from, Math.min((r + 1) * cycle, best.frames)]);
      wframes.push(best.frames);
      top.push({ r: r, id: best.id, score: bestScore, n: bestN, from: from, to: Math.min((r + 1) * cycle, best.frames) });
    }
    return { ok: true, cycle: cycle, regions: regions, skipped: skipped, winners: ids, ranges: ranges, wframes: wframes, top: top, owner: owner.id, ownerFrames: owner.frames, takes: spans.length };
  };
  return W;
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

const shotPath = path.join(here, '..', 'renders', 's2b-comp-suite.png');

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
  console.log('── 1. boot + card ──');
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const r = await ev(`document.documentElement.getAttribute('data-av-ready') === '1'`);
    if (r.value === true) { ready = true; break; }
    await sleep(300);
  }
  check('1 boot: data-av-ready flips', ready);
  if (!ready) { console.error('APP NOT READY'); process.exit(1); }

  /* engine ctx (the §0 fake device + takes capture ride the engine's AudioContext) */
  const engR = await ev(`(async () => {
    const e = window.__avEngine || {};
    let ctx = (e.handle && e.handle.ctx) || e.ctx || null;
    if (!ctx && typeof avEngineEnsure === 'function') { try { const h = await avEngineEnsure(); ctx = (h && h.ctx) || null; } catch (x) { } }
    if (!ctx) { for (const k in e.handle || {}) { try { const v = e.handle[k]; if (v && typeof v.currentTime === 'number' && typeof v.resume === 'function') { ctx = v; break; } } catch (x) { } } }
    if (!ctx) return { found: false };
    if (ctx.state !== 'running') { try { await Promise.race([ctx.resume().catch(function () { }), new Promise(function (res) { setTimeout(res, 2000); })]); } catch (x) { } }
    for (let i = 0; i < 20 && ctx.state !== 'running'; i++) await new Promise(function (res) { setTimeout(res, 125); });
    return { found: true, state: ctx.state, sampleRate: ctx.sampleRate, scp: typeof ctx.createScriptProcessor === 'function' };
  })()`);
  const eng = val(engR) || {};
  check('1 engine ctx: found · running · ScriptProcessor-capable · sr 48 k', eng.found === true && eng.state === 'running' && eng.scp === true && Number(eng.sampleRate) === 48000, JSON.stringify(eng));
  if (eng.found !== true || eng.state !== 'running') note('engine ctx not running yet — the takes start leg will surface the honest refusal');

  /* 1b. the comp card mounts into #av-comp-host */
  let cardUp = false, cardInfo = '';
  for (let i = 0; i < 100 && !cardUp; i++) {
    const r = await ev(`(() => {
      const host = document.getElementById('av-comp-host');
      const card = document.getElementById('av-comp');
      const root = host ? host.querySelector('.av-comp, [class*="av-comp"]') : null;
      const wired = !!(host && host.dataset && host.dataset.avCompUiWired === '1') || !!(card && card.dataset && card.dataset.avCompUiWired === '1');
      return { host: !!host, card: !!card, root: !!root, wired: wired };
    })()`);
    const v = val(r) || {};
    cardUp = v.host === true && v.card === true && v.root === true && v.wired === true;
    cardInfo = JSON.stringify(v);
    if (!cardUp) await sleep(150);
  }
  check('1b card mounted: #av-comp + #av-comp-host + .av-comp root + wired marker (avCompUiWired=1)', cardUp, cardInfo);
  if (!cardUp) { console.error('COMP CARD MISSING — parent adds the #av-comp card + #av-comp-host and calls avCompUiInit()'); process.exit(1); }

  /* 1c. tolerant control discovery (labels/classes/ids/data-attrs scanned) + 1d module globals */
  const ctrlR = await ev(`(() => {
    const host = document.getElementById('av-comp-host') || document.getElementById('av-comp');
    if (!host) return { host: false };
    const els = [...host.querySelectorAll('button, [role="button"], input, select, .av-btn, [data-act]')];
    const label = (e) => (((e.textContent || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '') + ' ' + (e.className || '') + ' ' + (e.id || '') + ' ' + JSON.stringify(e.dataset || {})).toLowerCase());
    const hit = (re) => els.filter((e) => re.test(label(e))).length;
    const fns = ['avCompInit','avCompList','avCompCreate','avCompDelete','avCompSetSegment','avCompAddSegment','avCompRemoveSegment','avCompSegments','avCompAutoComp','avCompRender','avCompExport','avCompState','avCompClasses','avCompUiInit','avCompUiClasses','avCompUiSync'];
    const missing = fns.filter((n) => typeof window[n] !== 'function');
    return {
      host: true, controls: els.length,
      add: hit(/add|segment/), auto: hit(/auto/), render: hit(/render/), exp: hit(/export|wav/), fade: hit(/fade/),
      lanesEl: !!host.querySelector('#av-comp-lanes, .av-comp-lanes'),
      segsEl: !!host.querySelector('#av-comp-segs, .av-comp-segs'),
      statusEl: !!host.querySelector('#av-comp-status, .av-comp-status'),
      missing: missing,
      handle: !!(window.__avComp && typeof window.__avComp === 'object'),
      handleV: window.__avComp ? window.__avComp.version : null,
      pure: !!(window.__avComp && window.__avComp.pure && typeof window.__avComp.pure.xfadeGains === 'function' && typeof window.__avComp.pure.applyXfade === 'function' && typeof window.__avComp.pure.stitch === 'function'),
      uiHandle: !!(window.__avCompUi && typeof window.__avCompUi === 'object' && typeof window.__avCompUi.state === 'function'),
      uiV: window.__avCompUi ? window.__avCompUi.version : null,
      classesN: (typeof avCompUiClasses === 'function') ? avCompUiClasses().length : 0
    };
  })()`);
  const ctrl = val(ctrlR) || {};
  check('1c controls: ADD SEGMENT · AUTO-COMP · RENDER · EXPORT WAV · FADE present in the comp card (tolerant label scan) + lanes/segs/status hosts',
    ctrl.host === true && ctrl.add >= 1 && ctrl.auto >= 1 && ctrl.render >= 1 && ctrl.exp >= 1 && ctrl.fade >= 1 &&
    ctrl.lanesEl === true && ctrl.segsEl === true && ctrl.statusEl === true,
    JSON.stringify({ controls: ctrl.controls, add: ctrl.add, auto: ctrl.auto, render: ctrl.render, exp: ctrl.exp, fade: ctrl.fade, lanesEl: ctrl.lanesEl, segsEl: ctrl.segsEl, statusEl: ctrl.statusEl }));
  check('1d module globals live: avComp* · avCompUi* · window.__avComp (s2.1, incl. pure.stitch) · window.__avCompUi object',
    Array.isArray(ctrl.missing) && ctrl.missing.length === 0 && ctrl.handle === true && ctrl.handleV === 's2.1' && ctrl.pure === true && ctrl.uiHandle === true && ctrl.uiV === 's2.1' && Number(ctrl.classesN) >= 30,
    JSON.stringify({ missing: ctrl.missing, handleV: ctrl.handleV, pure: ctrl.pure, uiV: ctrl.uiV, classesN: ctrl.classesN }));
  if (Array.isArray(ctrl.missing) && (ctrl.missing.indexOf('avCompRender') >= 0 || ctrl.missing.indexOf('avCompCreate') >= 0)) {
    console.error('S2.1 COMP MODULE MISSING — parent adds av_comp.js / av_comp_ui.js and rebuilds');
    process.exit(1);
  }

  /* 1e. pristine page */
  const st1R = await ev(`(() => {
    try {
      const cs = (typeof avCompState === 'function') ? avCompState() : null;
      const list = (typeof avTakesList === 'function') ? avTakesList() : null;
      let rec = null;
      try { rec = avTakesState().recording; } catch (e) { }
      return { comps: cs ? cs.count : null, takes: Array.isArray(list) ? list.length : null, recording: rec };
    } catch (e) { return { error: String((e && e.message) || e) }; }
  })()`);
  const st1 = val(st1R) || {};
  check('1e page pristine: zero comps · zero takes · not recording (fresh profile)', st1.comps === 0 && st1.takes === 0 && st1.recording === false, JSON.stringify(st1));

  /* inject the rig side helpers */
  await ev(COMPW_HELPERS);
  await ev(SEQI_HELPERS);
  check('1f rig side helpers injected (__compw v1 incl. expected() · __seqi v1)',
    val(await ev(`!!(window.__compw && window.__compw.v === 1 && typeof window.__compw.expected === 'function' && typeof window.__compw.captureInput === 'function' && window.__seqi && window.__seqi.v === 1)`)) === true);

  /* ── 2. input enable + two quick takes (fake-device beeps, lapSync false) ── */
  console.log('── 2. takes ──');
  const en2R = await ev(`(async () => { try { return await avInputEnable(); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } })()`);
  const en2 = val(en2R) || {};
  check('2 avInputEnable() (fake device): ok · channels >= 1 · sampleRate 48000', en2.ok === true && Number(en2.channels) >= 1 && Number(en2.sampleRate) === 48000,
    JSON.stringify({ ok: en2.ok, channels: en2.channels, sampleRate: en2.sampleRate, label: en2.label, error: en2.error }));
  const live2 = val(await ev(`(() => { try { return !!(typeof avInputNode === 'function' && avInputNode()); } catch (e) { return false; } })()`));
  check('2 avInputNode() live (the capture tap point exists)', live2 === true);
  const beep2 = val(await ev(`window.__compw.captureInput(2600)`)) || {};
  check('2 beep-train witness on the input node (fake device): >= 2.5 s window · peak > 0.05 · nonzero > 1000 (NEVER continuous-audio)',
    beep2.ok === true && Number(beep2.seconds) >= 2.5 && Number(beep2.peak) > 0.05 && Number(beep2.nonzero) > 1000,
    JSON.stringify({ seconds: fx3(beep2.seconds), peak: fx3(beep2.peak), nonzero: beep2.nonzero, blocks: beep2.blocks }));

  const klR = await ev(`(() => { try { return (typeof avTakesKeepLast === 'function') ? avTakesKeepLast(8) : null; } catch (e) { return null; } })()`);
  note('avTakesKeepLast(8) -> ' + JSON.stringify(val(klR)) + ' (both quick takes + the lap fixture survive every stop)');

  const recQuick = async (ms) => {
    const s = await ev(`(async () => { try { return await avTakesStart({ lapSync: false }); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } })()`);
    const sv = val(s) || {};
    if (sv.ok !== true) return { start: sv, fin: {} };
    await sleep(ms);
    const f = await ev(`(async () => { let r = avTakesStop(); if (r && typeof r.then === 'function') r = await r; return r; })()`);
    return { start: sv, fin: val(f) || {} };
  };
  const recA = await recQuick(1200);
  const finA = recA.fin || {};
  check('2 take A: start ok (sr 48000 · block 4096 · lapSync false · channels >= 1) · stop ok · stopReason "stop" · exactly 1 take · receipt.frames === take frames',
    !!(recA.start && recA.start.ok === true && recA.start.sr === 48000 && recA.start.block === 4096 && recA.start.lapSync === false && Number(recA.start.channels) >= 1) &&
    finA.ok === true && finA.stopReason === 'stop' && Array.isArray(finA.takes) && finA.takes.length === 1 && Number(finA.takes[0].frames) === Number(finA.frames),
    JSON.stringify({ start: recA.start, stop: { ok: finA.ok, stopReason: finA.stopReason, frames: finA.frames, takes: (finA.takes || []).map(t => t.frames), error: finA.error } }).slice(0, 420));
  await sleep(300);
  const recB = await recQuick(2000);                 /* rig SPEC fix: the 4096-block-quantized capture needs a >1-block wait gap (1250 ms landed on take A's exact block count) */
  const finB = recB.fin || {};
  check('2 take B: start ok (lapSync false) · stop ok · exactly 1 take',
    !!(recB.start && recB.start.ok === true) && finB.ok === true && Array.isArray(finB.takes) && finB.takes.length === 1,
    JSON.stringify({ start: recB.start, stop: { ok: finB.ok, stopReason: finB.stopReason, frames: finB.frames, takes: (finB.takes || []).map(t => t.frames) } }).slice(0, 380));

  const list2R = await ev(`avTakesList().map(function (t) { return { id: t.id, name: t.name, frames: t.frames, rate: t.rate, lap: t.lap, partial: t.partial }; })`);
  const list2 = val(list2R) || [];
  const tA2 = list2[0] || {}, tB2 = list2[1] || {};
  check('2 takes present: 2 takes · DISTINCT rig-evidenced frames (' + tA2.frames + ' vs ' + tB2.frames + ') · rate 48 k · lap 1 · partial false · names "Take N"',
    list2.length === 2 && Number(tA2.frames) > 10000 && Number(tB2.frames) > 10000 && tA2.frames !== tB2.frames &&
    tA2.rate === 48000 && tB2.rate === 48000 && tA2.lap === 1 && tB2.lap === 1 && tA2.partial === false && tB2.partial === false &&
    /^Take \d+$/.test(String(tA2.name)) && /^Take \d+$/.test(String(tB2.name)),
    JSON.stringify(list2));

  const stashR = await ev(`(() => {
    const l = avTakesList();
    if (!Array.isArray(l) || l.length < 2) return null;
    window.__compw.rig = window.__compw.rig || {};
    window.__compw.rig.takeA = { id: l[0].id, frames: l[0].frames };
    window.__compw.rig.takeB = { id: l[1].id, frames: l[1].frames };
    return { takeA: window.__compw.rig.takeA, takeB: window.__compw.rig.takeB };
  })()`);
  const stash = val(stashR) || {};
  const takeA = stash.takeA || {};
  const takeB = stash.takeB || {};
  check('2 rig stash: take ids/frames pinned page-side for the comp legs (A · B)', takeA.id != null && takeB.id != null, JSON.stringify(stash));

  /* the card repaints takes -> lanes via its ~1.2 s poll */
  let lanesN = 0;
  for (let i = 0; i < 30; i++) {
    const r = await ev(`document.querySelectorAll('#av-comp-host .av-comp-lane').length`);
    lanesN = Number(r.value) || 0;
    if (lanesN >= 2) break;
    await sleep(200);
  }
  check('2b card repaint: >= 2 take lanes on screen within the poll window (takes -> lanes)', lanesN >= 2, 'lanes=' + lanesN);

  /* ── 3. single-segment comp: create + add/set (take A full range) + render + export ── */
  console.log('── 3. single-segment comp ──');
  const p3R = await ev(`(async () => {
    const W = window.__compw;
    const R = W.rig || {};
    const out = { ok: false, why: null };
    if (!R.takeA || !R.takeB) { out.why = 'rig take stash missing'; return out; }
    if (typeof avCompCreate !== 'function' || typeof avCompAddSegment !== 'function' || typeof avCompSetSegment !== 'function' || typeof avCompRender !== 'function' || typeof avCompExport !== 'function') { out.why = 'engine functions missing'; return out; }
    const c1 = avCompCreate({ name: 'RIG COMP 1' });
    if (!c1 || typeof c1.id !== 'string') { out.why = 'create refused'; out.c1 = c1; return out; }
    out.id = c1.id; out.name = c1.name;
    const add = avCompAddSegment(c1.id, { takeId: R.takeA.id, fromFrame: 0, toFrame: R.takeA.frames });
    out.add = add ? { ok: add.ok === true, index: add.index, seg: add.segment || null, error: add.error || null } : null;
    const set = avCompSetSegment(c1.id, 0, { takeId: R.takeA.id, fromFrame: 0, toFrame: R.takeA.frames });
    out.set = set ? { ok: set.ok === true, seg: set.segment || null, error: set.error || null } : null;
    out.segs = avCompSegments(c1.id);
    const ren = avCompRender(c1.id);
    out.render = ren ? { ok: ren.ok === true, frames: ren.frames, peak: ren.peak, rms: ren.rms, clipped: ren.clipped, rate: ren.rate, channels: ren.channels, skipped: ren.skipped, error: ren.error || null } : null;
    const list = avCompList();
    const meta = Array.isArray(list) ? list.filter(function (c) { return c && c.id === c1.id; })[0] : null;
    out.meta = meta ? { id: meta.id, name: meta.name, segs: (meta.segments || []).length, out: meta.out ? { frames: meta.out.frames, rate: meta.out.rate, channels: meta.out.channels } : null } : null;
    let exp = null;
    try { exp = await avCompExport(c1.id); } catch (e) { exp = { ok: false, error: String((e && e.message) || e) }; }
    out.export = exp ? { ok: exp.ok === true, id: exp.id, name: exp.name, frames: exp.frames, rate: exp.rate, seconds: exp.seconds, bytes: exp.bytes, hasBlob: !!exp.blob, url: (typeof exp.url === 'string' && exp.url.indexOf('blob:') === 0), wavInfo: exp.wavInfo ? { ok: exp.wavInfo.ok, bits: exp.wavInfo.bits, sampleRate: exp.wavInfo.sampleRate, channels: exp.wavInfo.channels, frames: exp.wavInfo.frames } : null, error: exp.error || null } : null;
    if (exp && exp.ok === true && exp.blob && typeof exp.blob.arrayBuffer === 'function') {
      out.decode = await W.blobStats(exp.blob);
    }
    W.rig.c1 = c1.id;
    out.ok = true;
    return out;
  })()`);
  const p3 = val(p3R) || {};
  check('3 comp create + add + set: fresh comp · segment index 0 · take A full range [0, N] · avCompSegments length 1',
    p3.ok === true && typeof p3.id === 'string' &&
    !!(p3.add && p3.add.ok === true && p3.add.index === 0) &&
    !!(p3.set && p3.set.ok === true && p3.set.seg && p3.set.seg.takeId === takeA.id && p3.set.seg.fromFrame === 0 && Number(p3.set.seg.toFrame) === Number(takeA.frames)) &&
    Array.isArray(p3.segs) && p3.segs.length === 1 && p3.segs[0].takeId === takeA.id && p3.segs[0].fromFrame === 0 && Number(p3.segs[0].toFrame) === Number(takeA.frames),
    JSON.stringify({ id: p3.id, add: p3.add && { ok: p3.add.ok, index: p3.add.index }, set: p3.set && { ok: p3.set.ok, seg: p3.set.seg }, segs: p3.segs, why: p3.why }).slice(0, 460));
  check('3 render: frames === take A frames EXACTLY (delta 0) · comp list out mirrors the render',
    !!(p3.render && p3.render.ok === true) && Number(p3.render.frames) === Number(takeA.frames) &&
    !!(p3.meta && p3.meta.out && Number(p3.meta.out.frames) === Number(p3.render.frames)),
    JSON.stringify({ render: p3.render, metaOut: p3.meta && p3.meta.out, takeAFrames: takeA.frames }).slice(0, 400));
  check('3 export: ok · avWavInfo 16-bit / 48 kHz stereo · frames === render · blob + blob: url · bytes > 44 · name anvil_comp*.wav',
    !!(p3.export && p3.export.ok === true && p3.export.wavInfo && p3.export.wavInfo.ok === true) &&
    Number(p3.export.wavInfo.bits) === 16 && Number(p3.export.wavInfo.sampleRate) === 48000 &&
    Number(p3.export.wavInfo.channels) === 2 && Number(p3.export.wavInfo.frames) === Number(p3.render.frames) &&
    p3.export.hasBlob === true && p3.export.url === true && Number(p3.export.bytes) > 44 &&
    /^anvil_comp\d*\.wav$/.test(String(p3.export.name)),
    JSON.stringify(p3.export).slice(0, 480));
  check('3 in-page WAV decode: NON-SILENT (fake-device beeps) — peak > 0.05 · nonzero > 0',
    !!(p3.decode && p3.decode.ok === true && Number(p3.decode.peak) > 0.05 && Number(p3.decode.nonzero) > 0),
    JSON.stringify({ ok: p3.decode && p3.decode.ok, peak: p3.decode && fx3(p3.decode.peak), nonzero: p3.decode && p3.decode.nonzero, frames: p3.decode && p3.decode.info && p3.decode.info.frames, why: p3.decode && p3.decode.why }).slice(0, 340));

  /* ── 4. multi-segment + trims + clamp ── */
  console.log('── 4. multi-segment + trims ──');
  const p4R = await ev(`(async () => {
    const W = window.__compw;
    const R = W.rig || {};
    const out = { ok: false, why: null };
    if (!R.takeA || !R.takeB) { out.why = 'rig take stash missing'; return out; }
    const N = R.takeA.frames;
    const h = Math.round(N / 2);
    const c2 = avCompCreate({ name: 'RIG COMP 2' });
    if (!c2 || typeof c2.id !== 'string') { out.why = 'create refused'; return out; }
    out.id = c2.id;
    const a1 = avCompAddSegment(c2.id, { takeId: R.takeA.id, fromFrame: 0, toFrame: h });
    const a2 = avCompAddSegment(c2.id, { takeId: R.takeB.id, fromFrame: 0, toFrame: h });
    out.add = { a1: !!(a1 && a1.ok === true), a2: !!(a2 && a2.ok === true) };
    out.segs0 = avCompSegments(c2.id);
    const ren0 = avCompRender(c2.id);
    out.ren0 = ren0 ? { ok: ren0.ok === true, frames: ren0.frames, error: ren0.error || null } : null;
    const delta = 1000;
    const st = avCompSetSegment(c2.id, 0, { takeId: R.takeA.id, fromFrame: delta });
    out.trim = st ? { ok: st.ok === true, seg: st.segment || null, error: st.error || null } : null;
    const ren1 = avCompRender(c2.id);
    out.ren1 = ren1 ? { ok: ren1.ok === true, frames: ren1.frames, error: ren1.error || null } : null;
    let threw = false, st2 = null;
    try { st2 = avCompSetSegment(c2.id, 0, { toFrame: 999999999 }); } catch (e) { threw = true; }
    out.clamp = { threw: threw, ok: !!(st2 && st2.ok === true), seg: (st2 && st2.segment) || null, error: (st2 && st2.error) || null };
    let threw2 = false, ren2 = null;
    try { ren2 = avCompRender(c2.id); } catch (e) { threw2 = true; }
    out.ren2 = { threw: threw2, ok: !!(ren2 && ren2.ok === true), frames: ren2 && ren2.frames, error: (ren2 && ren2.error) || null };
    out.math = { N: N, h: h, ren0: 2 * h - 240, ren1: 2 * h - 240 - delta, ren2: (N - delta) + h - 240 };
    W.rig.c2 = c2.id;
    out.ok = true;
    return out;
  })()`);
  const p4 = val(p4R) || {};
  const m4 = p4.math || {};
  check('4 multi-segment: segments [A 0..N/2, B 0..N/2] -> render ~ N (2 halves minus the 240-frame seam)',
    p4.ok === true && p4.add && p4.add.a1 === true && p4.add.a2 === true &&
    !!(p4.ren0 && p4.ren0.ok === true) &&
    Math.abs(Number(p4.ren0 && p4.ren0.frames) - (2 * Number(m4.h) - 240)) <= 2 &&
    Math.abs(Number(p4.ren0 && p4.ren0.frames) - Number(m4.N)) <= 262,
    JSON.stringify({ frames: p4.ren0 && p4.ren0.frames, expected: 2 * Number(m4.h) - 240, N: m4.N, segs: p4.segs0, why: p4.why }).slice(0, 460));
  check('4 trim: shrinking segment 0 (fromFrame 0 -> 1000) shrinks the render by EXACTLY 1000 frames',
    !!(p4.trim && p4.trim.ok === true && p4.trim.seg && Number(p4.trim.seg.fromFrame) === 1000) &&
    !!(p4.ren1 && p4.ren1.ok === true && p4.ren0 && p4.ren0.ok === true) &&
    Number(p4.ren1.frames) === Number(p4.ren0.frames) - 1000,
    JSON.stringify({ ren0: p4.ren0 && p4.ren0.frames, ren1: p4.ren1 && p4.ren1.frames, delta: 1000, seg: p4.trim && p4.trim.seg }).slice(0, 400));
  check('4 clamp: oversized toFrame 999999999 clamps to the take length (no throw) · re-render exact',
    !!(p4.clamp && p4.clamp.threw === false && p4.clamp.ok === true && p4.clamp.seg && Number(p4.clamp.seg.toFrame) === Number(m4.N)) &&
    !!(p4.ren2 && p4.ren2.threw === false && p4.ren2.ok === true) &&
    Math.abs(Number(p4.ren2.frames) - Number(m4.ren2)) <= 2,
    JSON.stringify({ clampSeg: p4.clamp && p4.clamp.seg, N: m4.N, ren2: p4.ren2, expected2: m4.ren2 }).slice(0, 440));

  /* ── 5. crossfade + stitch math (pure, synthetic signals) ── */
  console.log('── 5. pure crossfade/stitch math ──');
  const p5R = await ev(`(() => {
    const W = window.__compw;
    const P = W.pureGet();
    if (!P || typeof P.xfadeGains !== 'function' || typeof P.applyXfade !== 'function' || typeof P.stitch !== 'function') return { ok: false, why: 'pure surface missing' };
    const out = { ok: true };
    const n = 64;
    const gp = W.g1g2(P.xfadeGains(n));
    if (!gp) return { ok: false, why: 'xfadeGains returned no pair' };
    const g1 = gp.g1, g2 = gp.g2;
    out.gains = { n: g1.length, g1first: g1[0], g2first: g2[0], g1last: g1[g1.length - 1], g2last: g2[g2.length - 1] };
    let maxErr = 0, monoDown = true, monoUp = true;
    for (let i = 0; i < g1.length; i++) {
      const e = Math.abs(g1[i] * g1[i] + g2[i] * g2[i] - 1);
      if (e > maxErr) maxErr = e;
      if (i > 0) {
        if (g1[i] > g1[i - 1] + 1e-6) monoDown = false;
        if (g2[i] < g2[i - 1] - 1e-6) monoUp = false;
      }
    }
    out.gains.maxErr = maxErr; out.gains.monoDown = monoDown; out.gains.monoUp = monoUp;
    const a1 = new Float32Array(n); a1.fill(1);
    const z0 = new Float32Array(n);
    const dst = new Float32Array(n);
    const ret = P.applyXfade(dst, 0, a1, z0, n);
    let maxDiff = 0;
    for (let i = 0; i < n; i++) { const d = Math.abs(dst[i] - g1[i]); if (d > maxDiff) maxDiff = d; }
    const dst2 = new Float32Array(n);
    P.applyXfade(dst2, 0, z0, a1, n);
    let maxDiff2 = 0;
    for (let i = 0; i < n; i++) { const d = Math.abs(dst2[i] - g2[i]); if (d > maxDiff2) maxDiff2 = d; }
    out.ax = { retIsDst: ret === dst, maxDiff: maxDiff, maxDiff2: maxDiff2 };
    const mk = function (len, seed) { const a = new Float32Array(len); for (let i = 0; i < len; i++) a[i] = Math.sin((i + seed) * 0.01) * 0.7; return a; };
    const parts = [{ chans: [mk(1000, 0)], fadeIn: 0, fadeOut: 64 }, { chans: [mk(1000, 5)], fadeIn: 64, fadeOut: 0 }];
    const s1 = P.stitch(parts, { edgeFrames: 32 });
    const s2 = P.stitch(parts, { edgeFrames: 32 });
    out.stitch = { ok1: !!(s1 && s1.ok === true), ok2: !!(s2 && s2.ok === true), frames: (s1 && s1.ok === true) ? s1.frames : null, expected: 1936, identical: null, lenEq: null };
    if (s1 && s1.ok === true && s2 && s2.ok === true) {
      out.stitch.identical = W.eqBytes(s1.data[0], s2.data[0]);
      out.stitch.lenEq = s1.data[0].length === s2.data[0].length;
    }
    return out;
  })()`);
  const p5 = val(p5R) || {};
  const g5 = p5.gains || {};
  check('5 pure.xfadeGains(64): g1^2+g2^2 = 1 (max err <= 1e-6) · endpoints g1 1->0 / g2 0->1 · both monotone',
    p5.ok === true && Number(g5.n) === 64 &&
    Math.abs(Number(g5.g1first) - 1) <= 1e-6 && Math.abs(Number(g5.g2first)) <= 1e-6 &&
    Math.abs(Number(g5.g1last)) <= 1e-6 && Math.abs(Number(g5.g2last) - 1) <= 1e-6 &&
    Number(g5.maxErr) <= 1e-6 && g5.monoDown === true && g5.monoUp === true,
    JSON.stringify(g5));
  const a5 = p5.ax || {};
  check('5 pure.applyXfade on constants is EXACT: a=1s,b=0s -> output = g1 · a=0s,b=1s -> g2 (max diff <= 1e-6)',
    p5.ok === true && a5.retIsDst === true && Number(a5.maxDiff) <= 1e-6 && Number(a5.maxDiff2) <= 1e-6,
    JSON.stringify(a5));
  const s5 = p5.stitch || {};
  check('5 pure.stitch deterministic: two calls -> identical bytes · frames = sum(L) - seam = 1936',
    s5.ok1 === true && s5.ok2 === true && Number(s5.frames) === 1936 && s5.identical === true && s5.lenEq === true,
    JSON.stringify(s5));

  /* ── 6. lap auto-comp on the rig pattern ── */
  console.log('── 6. lap auto-comp ──');
  const fix6R = await ev(`(() => {
    const W = window.__compw;
    const R = W.rig || {};
    const out = { del: [] };
    const ids = [R.takeA ? R.takeA.id : null, R.takeB ? R.takeB.id : null];
    for (let i = 0; i < ids.length; i++) {
      if (!ids[i]) { out.del.push({ id: null, ok: false }); continue; }
      try { out.del.push({ id: ids[i], ok: avTakesDelete(ids[i]) === true }); } catch (e) { out.del.push({ id: ids[i], ok: false }); }
    }
    out.list = avTakesList().map(function (t) { return t.id; });
    return out;
  })()`);
  const fix6 = val(fix6R) || {};
  check('6 fixture: the two quick takes deleted before the lap session (avTakesDelete ok · list empty)',
    Array.isArray(fix6.del) && fix6.del.length === 2 && fix6.del.every(d => d.ok === true) && Array.isArray(fix6.list) && fix6.list.length === 0,
    JSON.stringify(fix6));

  const load6R = await ev(`window.__seqi.load()`);
  const load6 = val(load6R) || {};
  const play6R = await ev(`(() => { try { const p = avSeqPlay(); return { p: p, playing: (typeof avSeqIsPlaying === 'function') ? avSeqIsPlaying() : null }; } catch (e) { return { error: String((e && e.message) || e) }; } })()`);
  const play6 = val(play6R) || {};
  check('6 rig pattern loaded (16 on-steps @ 120 bpm) + avSeqPlay() starts the transport', load6.ok === true && play6.p === true && play6.playing === true, JSON.stringify({ load: load6, play: play6 }));

  const st6R = await ev(`(async () => { try { return await avTakesStart({ lapSync: true }); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } })()`);
  const st6 = val(st6R) || {};
  check('6 lap start: lapSync true · cycleSteps 16 · cycleDur ~ 2 s (120 bpm, grid 16) · cycleFrames ~ 96000',
    st6.ok === true && st6.lapSync === true && st6.lapReason === 'transport playing' && st6.cycleSteps === 16 &&
    Math.abs(Number(st6.cycleDur) - 2) <= 0.02 && Math.abs(Number(st6.cycleFrames) - 96000) <= 960,
    JSON.stringify({ lapSync: st6.lapSync, reason: st6.lapReason, cycleSteps: st6.cycleSteps, cycleDur: st6.cycleDur, cycleFrames: st6.cycleFrames, error: st6.error }));
  await sleep(5300);                                    /* ~2.5 cycles of the 2 s grid */
  const stop6R = await ev(`(async () => { let r = avTakesStop(); if (r && typeof r.then === 'function') r = await r; return r; })()`);
  const fin6 = val(stop6R) || {};
  const laps6 = Array.isArray(fin6.takes) ? fin6.takes : [];
  const full6 = laps6.filter(t => t && t.partial === false);
  const tail6 = laps6[laps6.length - 1] || {};
  const lapsAsc = laps6.every((t, i) => i === 0 || (t.lap === laps6[i - 1].lap + 1));
  check('6 lap split: >= 2 takes · every FULL lap ~ 2 s +/- 0.15 s (96000 +/- 7200 frames) · lap numbers ascending',
    fin6.ok === true && laps6.length >= 2 && full6.length >= 2 && lapsAsc &&
    full6.every(t => Math.abs(Number(t.frames) - 96000) <= 7200),
    JSON.stringify(laps6.map(t => ({ id: t.id, lap: t.lap, frames: t.frames, partial: t.partial }))));
  check('6 tail lap kept as partial (the final unfinished cycle) · receipt frames === sum of laps',
    tail6.partial === true && laps6.reduce((s, t) => s + Number(t.frames), 0) === Number(fin6.frames),
    JSON.stringify({ tail: { lap: tail6.lap, frames: tail6.frames, partial: tail6.partial }, frames: fin6.frames }));
  await ev(`(() => { try { avSeqStop(); } catch (e) { } return true; })()`);
  const stp6 = val(await ev(`(typeof avSeqIsPlaying === 'function') ? avSeqIsPlaying() : null`));
  check('6 avSeqStop(): transport stopped', stp6 === false, JSON.stringify({ playing: stp6 }));

  const p6R = await ev(`(async () => {
    const W = window.__compw;
    const out = { ok: false, why: null };
    const c3 = avCompCreate({ name: 'RIG AUTO' });
    if (!c3 || typeof c3.id !== 'string') { out.why = 'create refused'; return out; }
    out.id = c3.id;
    const auto = avCompAutoComp(c3.id);
    out.auto = auto ? { ok: auto.ok === true, regions: auto.regions, cycleFrames: auto.cycleFrames, skipped: auto.skipped, picked: auto.picked || null, segments: auto.segments || null, error: auto.error || null } : null;
    out.expected = W.expected();
    const ren = avCompRender(c3.id);
    out.render = ren ? { ok: ren.ok === true, frames: ren.frames, peak: ren.peak, rms: ren.rms, clipped: ren.clipped, rate: ren.rate, channels: ren.channels, skipped: ren.skipped, error: ren.error || null } : null;
    const segsA = (auto && Array.isArray(auto.segments)) ? auto.segments : [];
    const Ls = [];
    let sumL = 0, sumSeam = 0;
    for (let i = 0; i < segsA.length; i++) { const L = Math.max(0, Number(segsA[i].toFrame) - Number(segsA[i].fromFrame)); Ls.push(L); sumL += L; }
    for (let i = 0; i + 1 < Ls.length; i++) {
      let s2 = Math.max(Number(segsA[i].fadeOut) || 0, Number(segsA[i + 1].fadeIn) || 0);
      if (s2 > Ls[i]) s2 = Ls[i];
      if (s2 > Ls[i + 1]) s2 = Ls[i + 1];
      sumSeam += s2;
    }
    out.stitchMath = { sumL: sumL, sumSeam: sumSeam, exact: sumL - sumSeam };
    W.rig.c3 = c3.id;
    out.ok = true;
    return out;
  })()`);
  const p6 = val(p6R) || {};
  const a6 = p6.auto || {};
  const e6 = p6.expected || {};
  const r6 = p6.render || {};
  const sm6 = p6.stitchMath || {};
  const segs6 = Array.isArray(a6.segments) ? a6.segments : [];
  const expIds6 = Array.isArray(e6.winners) ? e6.winners : [];
  const expRanges6 = Array.isArray(e6.ranges) ? e6.ranges : [];
  check('6 auto-comp receipt: ok · segments >= regions · cycle/regions equal the rig-own median/owner recomputation (live store re-read)',
    p6.ok === true && a6.ok === true && Number(a6.regions) >= 1 && segs6.length >= Number(a6.regions) &&
    e6.ok === true && Number(a6.cycleFrames) === Number(e6.cycle) && Number(a6.regions) === Number(e6.regions),
    JSON.stringify({ receipt: { ok: a6.ok, regions: a6.regions, cycleFrames: a6.cycleFrames, skipped: a6.skipped, error: a6.error }, rig: { cycle: e6.cycle, regions: e6.regions, skipped: e6.skipped, takes: e6.takes, ownerFrames: e6.ownerFrames, why: e6.why } }).slice(0, 520));
  check('6 winners = the rig-own pick-best recomputation (own rms/peak reads of the SAME regions -> takeIds; ties -> earlier take)',
    expIds6.length > 0 && expIds6.length === segs6.length &&
    expIds6.every((id, i) => segs6[i] && String(segs6[i].takeId) === String(id)) &&
    Array.isArray(a6.picked) && a6.picked.length === expIds6.length &&
    a6.picked.every((id, i) => String(id) === String(expIds6[i])),
    JSON.stringify({ expected: e6.top, segs: segs6.map(g => ({ takeId: g.takeId, from: g.fromFrame, to: g.toFrame })), picked: a6.picked }).slice(0, 560));
  check('6 segment ranges = the pinned region math (from = r*cycle · to = min((r+1)*cycle, winner frames))',
    expRanges6.length === segs6.length && expRanges6.length > 0 &&
    expRanges6.every((rr, i) => segs6[i] && Number(segs6[i].fromFrame) === Number(rr[0]) && Number(segs6[i].toFrame) === Number(rr[1])),
    JSON.stringify({ expectedRanges: expRanges6, segs: segs6.map(g => [g.fromFrame, g.toFrame]) }).slice(0, 440));
  /* rig SPEC fix: the old '≈ min(longest, regions*cycle)' leg assumed the longest take wins every
     region; a shorter scorer wins legitimately (winner-clamped ranges), so the expectation = the
     rig's OWN region picks minus the pinned 240-frame default seams (max(fadeOut_i, fadeIn_i+1)
     clamped to the shorter segment -> min(240, L_i, L_i+1)). */
  const rl6 = expRanges6.map(rr => Math.max(0, Number(rr[1]) - Number(rr[0])));
  let expSeam6 = 0;
  for (let i = 0; i + 1 < rl6.length; i++) expSeam6 += Math.min(240, rl6[i], rl6[i + 1]);
  const expFrames6 = rl6.reduce((s, v) => s + v, 0) - expSeam6;
  check('6 render: === the rig-own region picks minus the pinned default seams AND === the exact stitch math sum(L) - sum(seam)',
    r6.ok === true && expRanges6.length > 0 &&
    Math.abs(Number(r6.frames) - expFrames6) <= 2 &&
    Math.abs(Number(r6.frames) - Number(sm6.exact)) <= 2,
    JSON.stringify({ frames: r6.frames, expFrames: expFrames6, expSeams: expSeam6, exact: sm6.exact, sumL: sm6.sumL, sumSeam: sm6.sumSeam, regions: a6.regions, cycle: a6.cycleFrames }).slice(0, 460));

  /* ── 7. seal — repaint witness, screenshot (populated), page clean, errors, freeze ── */
  console.log('── 7. seal ──');
  const c3id = p6.id || null;
  if (c3id) {
    await ev(`(() => { try { const ui = window.__avCompUi; if (ui && typeof ui.pick === 'function') return ui.pick(${JSON.stringify(c3id)}); } catch (e) { } return false; })()`);
  }
  let segRows = 0;
  for (let i = 0; i < 15; i++) {
    const r = await ev(`document.querySelectorAll('#av-comp-host .av-comp-seg').length`);
    segRows = Number(r.value) || 0;
    if (segRows >= 1) break;
    await sleep(200);
  }
  check('7a card repaint: the auto-comp segment rows are on screen at screenshot time (poll/pick sync <= 3 s)', segRows >= 1, 'seg rows=' + segRows);

  await ev(`(() => { const el = document.getElementById('av-comp') || document.getElementById('av-comp-host'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); return true; })()`);
  await sleep(250);
  const rectR = await ev(`(() => { const el = document.getElementById('av-comp') || document.getElementById('av-comp-host'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }; })()`);
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
  check('7 screenshot: renders/s2b-comp-suite.png (the comp card, scale 2 — taken while the card carries the run lanes/segments)', shotOk, shotInfo);

  const cleanR = await ev(`(async () => {
    const out = { compsKilled: [], takesKilled: [], before: null, after: null };
    try { out.before = { comps: avCompList().length, takes: avTakesList().length, recording: (typeof avTakesState === 'function') ? avTakesState().recording : null }; } catch (e) { }
    try { if (typeof avSeqStop === 'function') avSeqStop(); } catch (e) { }
    try { if (typeof avTakesAbort === 'function') avTakesAbort(); } catch (e) { }
    try { if (typeof avTakesArm === 'function') avTakesArm(false); } catch (e) { }
    try {
      const cl = avCompList() || [];
      for (let i = 0; i < cl.length; i++) { try { if (avCompDelete(cl[i].id) === true) out.compsKilled.push(cl[i].id); } catch (e) { } }
    } catch (e) { }
    try {
      const tl = avTakesList() || [];
      for (let i = 0; i < tl.length; i++) { try { if (avTakesDelete(tl[i].id) === true) out.takesKilled.push(tl[i].id); } catch (e) { } }
    } catch (e) { }
    try { if (typeof avInputDisable === 'function') await avInputDisable(); } catch (e) { }
    await new Promise(function (res) { setTimeout(res, 300); });
    try {
      const st = (typeof avTakesState === 'function') ? (avTakesState() || {}) : {};
      out.after = {
        comps: avCompList().length,
        takes: avTakesList().length,
        recording: st.recording === true,
        armed: st.armed === true,
        wired: st.wired === true,
        playing: (typeof avSeqIsPlaying === 'function') ? avSeqIsPlaying() : null,
        inNode: (typeof avInputNode === 'function') ? !!avInputNode() : null,
        compCount: (typeof avCompState === 'function') ? avCompState().count : null
      };
    } catch (e) { out.afterErr = String((e && e.message) || e); }
    return out;
  })()`);
  const cl7 = val(cleanR) || {};
  const clA = cl7.after || {};
  check('7 page left clean: comps deleted (>= 3) · takes deleted · not recording/armed · transport stopped · input disabled (node empty)',
    Array.isArray(cl7.compsKilled) && cl7.compsKilled.length >= 3 &&
    Array.isArray(cl7.takesKilled) && cl7.takesKilled.length >= 2 &&
    clA.comps === 0 && clA.takes === 0 && clA.recording === false && clA.armed === false && clA.wired === false &&
    clA.playing === false && (clA.inNode === false || clA.inNode === null) && clA.compCount === 0,
    JSON.stringify(cl7).slice(0, 460));

  check('7 zero page errors (exceptions · Log errors · console.error)', errors.length === 0, 'page errors=' + errors.length + (errors.length ? ' | ' + errors.slice(0, 3).join(' | ') : ''));

  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after): ' + shaAfter);
  check('7 freeze: index.html sha256 before === after (unchanged by the run)', shaAfter === shaBefore, shaAfter);
  if (PIN) check('7 freeze: index.html sha256 = pinned', shaBefore === PIN && shaAfter === PIN, 'pinned ' + PIN.slice(0, 12) + '...');
  else note('EXPECT_SHA not pinned — after the S2.1 build, pass --sha <hex> or set the constant (never loosen)');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'COMP FAILED' : 'COMP PASSED');
  try { ws.close(); } catch { /* done */ }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('comp harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    /* profile-scoped cleanup (LAW): kill ONLY processes whose command line carries OUR temp
       profile — matched by its unique basename, so the pattern needs no backslash escaping */
    const tag = path.basename(profile);
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
