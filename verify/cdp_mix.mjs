// cdp_mix.mjs — Anvil S3 MIX & MASTER suite (child sa-D's rig; WRITTEN by sa-D, RUN BY THE PARENT
// after the S3 integration build). End-to-end over raw CDP against the frozen single-file build.
//
//   node verify/cdp_mix.mjs [path-to-index.html] [--port N] [--sha <hex>] > verify/last-cdp_mix.log 2>&1
//
// WRITE-ONLY: this file is authored by sa-D and never executed by sa-D. The parent runs it after
// the S3 integration (index.html must contain av_loud.js + av_mix.js + av_mix_ui.js after
// av_comp_ui and before av_synth; body.html must carry the #av-mix card + #av-mix-host; app_core
// boots avMixInit() -> avMixUiInit()) and the page URL carries ?avtest=1.
//
// LAUNCH SKELETON: copied VERBATIM from cdp_studio.mjs (candidates Chrome/Edge/Brave, free-port
// scan, fresh temp --user-data-dir + profile-scoped cleanup, 1440x900 device metrics override —
// Edge headless ignores --window-size, --mute-audio, --autoplay-policy=no-user-gesture-required,
// ONE browser, explicit exit, process.on('exit') kills ONLY processes whose command line carries
// OUR temp profile) PLUS the two fake-media flags (the takes legs need them):
//   --use-fake-ui-for-media-stream  (auto-grants getUserMedia)
//   --use-fake-device-for-media-stream  (the BEEP-TRAIN fake device — NEVER assert continuous
//                                        audio: assert pips/peaks only)
// The URL carries ?avtest=1 (the cdp_smoke law: the runtime proofs ride along).
//
// SHA FREEZE DISCIPLINE from cdp_studio.mjs / cdp_comp.mjs: index.html is sha256'd before and
// after the run; before === after is ALWAYS enforced. EXPECT_SHA is null until the parent pins
// the frozen S3 sha (constant below or --sha <hex>); while null the rig still enforces
// before === after and prints a pin note.
//
// RIG-OWN MATH (never planted literals): every numeric expectation is recomputed at run time by
// the rig's own in-page helpers (window.__mixw): pooled rms/peak/energy, byte equality of render
// pairs, a local 48 kHz BS.1770-4 integrated-loudness helper (K-weighting biquads + 400 ms/100 ms
// gating) and a 16-bit WAV decoder. av_loud / av_mix receipts are cross-checked against these
// live digests; the contract's pinned anchors (−23.0 LUFS / +6.02 / +3.01 LU / −6.02 dBTP /
// ≤0.910 limiter ceiling) are asserted against BOTH av_loud and the rig-own helper where the
// math allows (see SPEC note in group 11).
//
// WHAT IT PROVES, in order (contract: verify/_s3_wave.md §2.4 proofs 1–18):
//   1. boot + engine ctx + card mounted (#av-mix + #av-mix-host · .av-mix root · wired marker
//      avMixUiWired=1 · key controls via tolerant label scan) · module globals live (avMix* +
//      avLoud* + avMixUi*, window.__avMix/__avLoud/__avMixUi, pure surface, pinned param
//      defaults, page pristine).
//   2. sources: input enable on the fake device (beep-train witness ≥ 2.5 s) · two takes via the
//      avTakes path (distinct block-quantized lengths) · one comp via avCompCreate/
//      avCompAddSegment/avCompSetSegment/avCompRender.
//   3. add take-A + comp + engine tracks -> render (loops 1, tail 0.5): ok · frames > 0 /
//      ≥ rig-known lower bound · lufs/dbtp finite · deterministic (two renders byte-identical) ·
//      offsetFrames latency compensation asserted against the raw take data.
//   4. gain law ('buffers' fixture): −6 dB -> rms ratio 0.5012 ±1.5% · gain ≤ −60 AND mute ->
//      exact silence (≤ 1e-7) · solo semantics (solo B == A-muted byte-identical; differs from all).
//   5. pan law exact: hard left -> right |x| ≤ 1e-12 · center -> both channels carry the source
//      (≤ 1e-7) · hard right mirrored.
//   6. per-track FX: drive on/amount 1 changes the render (rms ratio ≠ 1) and stays deterministic
//      (byte-identical re-render); dyn on (thresh −30, ratio 10) -> peak ≤ off-peak (+1e-6) and
//      rms ratio < 1 on the hot fixture.
//   7. sends: sendA 0.8 + verb decay 0.7 -> post-source tail ≥ 100x the dry tail (wet floor
//      1e-4); sendB 0.8 + delay 0.25 -> post-source echo window rms > 10x dry.
//   8. bus glue: on/thresh −30/ratio 8 on a two-level fixture -> dynamic-balance improvement
//      >= 1.05 with the loud half measurably compressed (SPEC note below).
//   9. master limiter: hot amp-1.5 fixture + master dyn on, ceiling −1 -> max|out| ≤ 0.910+5e-3
//      and audible (peak > 0.5).
//  10. normalize: target −14, ceiling −1 -> measured lufs ≈ −14 ±0.6 (receipt AND rig-own) OR the
//      TP-limited case (lufs < −14 · norm.limited true · dbtp ≤ −0.95); deterministic re-render.
//  11. LUFS anchors via av_loud (amp-0.1 997 Hz: single channel -> −23.0 ±0.2 (also rig-own mean);
//      stereo L=R -> −20.0 ±0.25 (channel-sum = single +3.01) — SPEC-fixed 2026-10-07; doubling
//      +6.02 ±0.05; stereo-dup vs single +3.01 ±0.05; silence -> null, never NaN, kept 0).
//  12. TP anchors: amp 0.5 -> −6.02 ±0.15 dBTP (peakDb == rig-own sample peak); 12 kHz straddle
//      (4 samples/cycle, phase π/4) -> dBTP ≥ −0.2; dbtp ≥ peakDb in every fixture.
//  13. auto-balance: two fixtures 20 dB apart -> deltas differ by ≈ 20 dB (±1), applied gainDb set
//      on the tracks, silent material skipped; clamps ±24 on extreme fixtures.
//  14. A/B: ref = mix × 0.5 -> gainToMatchDb ≈ +6.02 ±0.15; setRef/compare leave rev untouched.
//  15. dither (pure.ditherApply): 16-bit off vs tpdf differ with |diff| ≤ 4 LSB; tpdf vs shaped
//      differ; same seed byte-identical; different seed differs; 32f ignores dither.
//  16. export: 16-bit when chosen (wavInfo bits/sr/frames, blob + blob: url, default name,
//      in-page decode peak > 0.05) + dither receipts {mode, seed, applied} + stale-refusal after
//      a mutation and recovery after re-render.
//  17. e2e: engine + take mix -> both contribute (each mute leg lowers the energy; take leg is
//      pip-structured — fake-device beeps, peak > 0.05, never-continuous fraction < 0.9).
//  18. seal: screenshot renders/s3-mix-suite.png · zero page errors · freeze sha256 before ===
//      after · page left CLEAN (tracks cleared, takes/comps deleted, ref cleared, transport
//      stopped, input disabled).
//
// SPEC NOTES (sa-D, for the first parent run):
//   (a) group 8 — the proof text says "quiet-half rms ratio (on/off) >= 1.05". A glue compressor
//       with makeup 0 (the pinned default) can never make an already-quiet half LOUDER; its
//       purpose is balance: the loud half gets compressed, the quiet half does not, so the quiet
//       half's RELATIVE level (quiet/loud) improves. The rig asserts that improvement ratio
//       ((quiet/loud)_on / (quiet/loud)_off) >= 1.05 AND that the loud half is measurably
//       compressed; the literal quiet_on/quiet_off value is reported in the info string.
//   (b) group 11 — RESOLVED by the parent SPEC fix (2026-10-07): the contract's −23.0 anchor is the
//       SINGLE-CHANNEL reading (measured −23.01); a strict BS.1770 channel-SUMMED stereo pair reads
//       −20.00 for the same fixture (single +3.01). 11a now asserts single -> −23.0 ±0.2 AND stereo
//       -> −20.0 ±0.25; the rig-own helper still reports BOTH conventions (mean / sum) as evidence.
//   (c) group 6 "rms ratio != 1" is operationalized as |ratio − 1| > 1e-3 (a measurably changed
//       render, not float noise); drive amount 1 guarantees a large change on the rig fixture.
//   (d) all heavy array math runs PAGE-SIDE (Float32Array does not cross the CDP boundary);
//       node receives only small JSON digests.

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
   S3: the frozen sha of the rebuilt index.html is not known until build.py runs — the parent may
   fill this constant or pass --sha <hex>; the rig never loosens the before === after check. */
const EXPECT_SHA = 'b1da601bb3b7e01842c042574931540dfd8655b7f4227e8118f71eb701d25dbc';
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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9620);
const profile = path.join(tmpdir(), 'anvil-mix-' + Date.now());
const url = 'file:///' + path.resolve(page).replace(/\\/g, '/') + '?avtest=1';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
console.log('cdp port ' + PORT + ' · profile ' + profile);

let pass = 0, fail = 0;
const expected = (cond, msg, info) => {
  if (cond === true) { pass++; console.log(' ok   ' + msg + (info ? '  -> ' + info : '')); }
  else { fail++; console.log(' FAIL ' + msg + (info ? '  -> ' + info : '')); }
  return cond === true;
};
const note = (t) => console.log('   · ' + t);
const fx3 = (x) => (x == null || typeof x !== 'number' || !isFinite(x)) ? String(x) : Number(x).toFixed(3);
const fx4 = (x) => (x == null || typeof x !== 'number' || !isFinite(x)) ? String(x) : Number(x).toFixed(4);
const J = (x) => { try { return JSON.stringify(x); } catch (e) { return String(x); } };

const chrome = spawn(exe, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--disable-sync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  url,
], { stdio: 'ignore', windowsHide: true });

const errors = [];

/* ---------- page-side scaffolding injected at runtime (rig-owned; never app code) ----------
   __mixw: the rig's OWN witnesses / metrics / fixtures —
     captureInput(ms)  the §0 probe: MediaStreamSource path via avInputNode() riding a parallel
                       ScriptProcessor(4096) -> gain-0 sink -> avTap.real, counting frames/peak/
                       nonzero of whatever the input node carries (the beep train);
     store()/takeRaw(id)  READ-ONLY reach into the avTakes store object (metas carry no data);
     mk*()             deterministic fixture builders (sines / straddle / two-level / silence);
     addBuf(name, patch)  add a 'buffers' source track from the fixture registry;
     clean()           avMixSetRef(null) + avMixClear() + pinned-default param reset (per-proof isolation);
     render(opts)      guarded avMixRender; rcpt(R)  compact JSON-safe receipt digest;
     rms/rms2/peak/peak2/maxAbs2/diff/eqArr/eqBytes/nzFrac/energy2  live array math;
     lufs(l, r)        rig-own 48 kHz BS.1770-4 integrated loudness in BOTH channel conventions
                       (mean = the contract derivation's 'ms'; sum = strict BS.1770 channel sum);
     peakDb(l, r)      sample peak in dBFS;  wavStats(buf) 16-bit WAV decoder digest;
     loudFn(key)       tolerant av_loud resolver (bare avLoud* global -> window.__avLoud). */

const MIXW_HELPERS = `window.__mixw = (function () {
  const W = { v: 1, fx: {}, rig: {}, last: null };
  W.num = function (x) { return (typeof x === 'number' && isFinite(x)) ? x : null; };
  W.pair = function (x) {
    try {
      if (!x) return null;
      if (Array.isArray(x) && x.length >= 2 && x[0] && typeof x[0].length === 'number') return [x[0], x[1] || x[0]];
      if (x.l && x.r && typeof x.l.length === 'number') return [x.l, x.r];
      if (x.data && Array.isArray(x.data) && x.data.length >= 1) return [x.data[0], x.data[1] || x.data[0]];
      return null;
    } catch (e) { return null; }
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
  W.takeRaw = function (id) {
    const store = W.store();
    if (!store) return null;
    for (let i = 0; i < store.length; i++) {
      const t = store[i];
      try {
        if (!t || String(t.id) !== String(id)) continue;
        if (!t.data || typeof t.data.length !== 'number' || !t.data[0]) return null;
        return { id: t.id, frames: t.frames, rate: t.rate || 48000, channels: t.data.length, l: t.data[0], r: t.data.length > 1 ? t.data[1] : t.data[0], offsetFrames: W.num(t.offsetFrames) || 0 };
      } catch (e) { }
    }
    return null;
  };
  W.mkSine = function (name, amp, seconds, sr, freq) {
    const n = Math.round(seconds * sr);
    const l = new Float32Array(n), r = new Float32Array(n);
    const w = 2 * Math.PI * freq / sr;
    for (let i = 0; i < n; i++) { const x = Math.sin(w * i) * amp; l[i] = x; r[i] = x; }
    W.fx[name] = { l: l, r: r, sr: sr, frames: n };
    return { name: name, frames: n };
  };
  W.mkStraddle = function (name, amp, seconds, sr) {
    const n = Math.round(seconds * sr);
    const l = new Float32Array(n), r = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = amp * Math.sin(Math.PI / 4 + i * Math.PI / 2); l[i] = x; r[i] = x; }
    W.fx[name] = { l: l, r: r, sr: sr, frames: n };
    return { name: name, frames: n };
  };
  W.mkTwoLevel = function (name, ampLoud, ampQuiet, halfSeconds, sr, freq) {
    const half = Math.round(halfSeconds * sr);
    const n = 2 * half;
    const l = new Float32Array(n), r = new Float32Array(n);
    const w = 2 * Math.PI * freq / sr;
    for (let i = 0; i < half; i++) { const x = Math.sin(w * i) * ampLoud; l[i] = x; r[i] = x; }
    for (let i = half; i < n; i++) { const x = Math.sin(w * i) * ampQuiet; l[i] = x; r[i] = x; }
    W.fx[name] = { l: l, r: r, sr: sr, frames: n };
    return { name: name, frames: n };
  };
  W.mkSilence = function (name, seconds, sr) {
    const n = Math.round(seconds * sr);
    W.fx[name] = { l: new Float32Array(n), r: new Float32Array(n), sr: sr, frames: n };
    return { name: name, frames: n };
  };
  W.addBuf = function (fxName, patch) {
    const F = W.fx[fxName];
    if (!F) return { ok: false, error: 'no fixture ' + fxName };
    const opts = Object.assign({ name: fxName, source: { type: 'buffers', l: F.l, r: F.r, sr: F.sr } }, patch || {});
    try { return avMixAddTrack(opts); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  };
  W.resetParams = function () {
    const paths = [
      ['send.A.return', 0.35], ['send.A.verb.mode', 'plate'], ['send.A.verb.size', 0.5], ['send.A.verb.decay', 0.55], ['send.A.verb.damp', 0.3], ['send.A.verb.predelay', 0.01],
      ['send.B.return', 0.30], ['send.B.delay.time', 0.3], ['send.B.delay.feedback', 0.45], ['send.B.delay.pingpong', 0.5], ['send.B.delay.spread', 0.15], ['send.B.delay.duck', 0], ['send.B.delay.bpm', 120],
      ['glue.on', 0], ['glue.thresh', -18], ['glue.ratio', 2], ['glue.att', 0.03], ['glue.rel', 0.3], ['glue.makeup', 0],
      ['master.drive.on', 0], ['master.drive.mode', 'sat'], ['master.drive.amount', 0], ['master.drive.tone', 0.5],
      ['master.dyn.on', 0], ['master.dyn.eqLo', 0], ['master.dyn.eqMid', 0], ['master.dyn.eqHi', 0],
      ['master.dyn.comp.thresh', -6], ['master.dyn.comp.ratio', 2], ['master.dyn.comp.att', 0.01], ['master.dyn.comp.rel', 0.25], ['master.dyn.comp.makeup', 0], ['master.dyn.lim.ceiling', -1], ['master.dyn.mix', 1],
      ['master.norm.on', 0], ['master.norm.target', -14], ['master.norm.ceiling', -1.0],
    ];
    const out = { set: 0, refused: [] };
    for (let i = 0; i < paths.length; i++) {
      try { const r = avMixSetParam(paths[i][0], paths[i][1]); if (r && r.ok === true) out.set++; else out.refused.push(paths[i][0]); }
      catch (e) { out.refused.push(paths[i][0]); }
    }
    return out;
  };
  W.clean = function () {
    try { avMixSetRef(null); } catch (e) { }
    try { avMixClear(); } catch (e) { }
    return W.resetParams();
  };
  W.render = async function (opts) {
    try { return await avMixRender(opts || {}); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  };
  W.rcpt = function (r) {
    try {
      if (!r) return null;
      const o = { ok: r.ok === true, frames: W.num(r.frames), rate: W.num(r.rate), lufs: W.num(r.lufs), dbtp: W.num(r.dbtp), peak: W.num(r.peak), rms: W.num(r.rms), clipped: W.num(r.clipped), ms: W.num(r.ms), rev: W.num(r.rev), err: r.error ? String(r.error) : null };
      o.warn = Array.isArray(r.warnings) ? r.warnings.length : null;
      o.refusedN = Array.isArray(r.refused) ? r.refused.length : null;
      if (r.norm) o.norm = { on: r.norm.on === true, target: W.num(r.norm.target), ceiling: W.num(r.norm.ceiling), gainDb: W.num(r.norm.gainDb), limited: r.norm.limited === true };
      return o;
    } catch (e) { return { err: 'rcpt threw: ' + String((e && e.message) || e) }; }
  };
  W.rms = function (a, f0, f1) {
    let s = 0, n = 0; const hi = Math.min(f1, a.length);
    for (let i = f0; i < hi; i++) { const v = a[i]; if (typeof v === 'number' && isFinite(v)) { s += v * v; n++; } }
    return n ? Math.sqrt(s / n) : 0;
  };
  W.rms2 = function (l, r, f0, f1) {
    let s = 0, n = 0;
    const hi = Math.min(f1, l.length);
    for (let i = f0; i < hi; i++) { const v = l[i]; if (typeof v === 'number' && isFinite(v)) { s += v * v; n++; } }
    if (r && r !== l) { const hi2 = Math.min(f1, r.length); for (let i = f0; i < hi2; i++) { const v = r[i]; if (typeof v === 'number' && isFinite(v)) { s += v * v; n++; } } }
    return n ? Math.sqrt(s / n) : 0;
  };
  W.energy2 = function (l, r, f0, f1) {
    let s = 0, n = 0;
    const hi = Math.min(f1, l.length);
    for (let i = f0; i < hi; i++) { const v = l[i]; if (typeof v === 'number' && isFinite(v)) { s += v * v; n++; } }
    if (r && r !== l) { const hi2 = Math.min(f1, r.length); for (let i = f0; i < hi2; i++) { const v = r[i]; if (typeof v === 'number' && isFinite(v)) { s += v * v; n++; } } }
    return n ? s / n : 0;
  };
  W.peak = function (a, f0, f1) { let p = 0; const hi = Math.min(f1, a.length); for (let i = f0; i < hi; i++) { const v = a[i] < 0 ? -a[i] : a[i]; if (v > p) p = v; } return p; };
  W.peak2 = function (l, r, f0, f1) { let p = W.peak(l, f0, f1); if (r && r !== l) { const q = W.peak(r, f0, f1); if (q > p) p = q; } return p; };
  W.maxAbs2 = W.peak2;
  W.diff = function (a, b, bOff, count) {
    let m = 0; const n = Math.min(count, a.length, b.length - bOff);
    for (let i = 0; i < n; i++) { const d = Math.abs(a[i] - b[bOff + i]); if (d > m) m = d; }
    return m;
  };
  W.eqArr = function (a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };
  W.eqBytes = function (a, b) {
    try {
      if (!a || !b || a.length !== b.length) return false;
      const u1 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      const u2 = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      if (u1.length !== u2.length) return false;
      for (let i = 0; i < u1.length; i++) if (u1[i] !== u2[i]) return false;
      return true;
    } catch (e) { return false; }
  };
  W.nzFrac2 = function (l, r, thr) {
    let nz = 0, n = 0;
    for (let i = 0; i < l.length; i++) { const v = l[i]; if (typeof v === 'number' && isFinite(v)) { n++; const a = v < 0 ? -v : v; if (a > thr) nz++; } }
    if (r && r !== l) for (let i = 0; i < r.length; i++) { const v = r[i]; if (typeof v === 'number' && isFinite(v)) { n++; const a = v < 0 ? -v : v; if (a > thr) nz++; } }
    return n ? nz / n : 0;
  };
  W.kweight = function (x) {
    const n = x.length;
    const y = new Float64Array(n);
    const B0 = 1.53512485958697, B1 = -2.69169618940638, B2 = 1.19839281085285, A1 = -1.69065929318241, A2 = 0.73248077421585;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) { const s = x[i]; const o = B0 * s + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2; x2 = x1; x1 = s; y2 = y1; y1 = o; y[i] = o; }
    const C0 = 1.0, C1 = -2.0, C2 = 1.0, D1 = -1.99004745483398, D2 = 0.99007225036621;
    let x3 = 0, x4 = 0, y3 = 0, y4 = 0;
    for (let i = 0; i < n; i++) { const s = y[i]; const o = C0 * s + C1 * x3 + C2 * x4 - D1 * y3 - D2 * y4; x4 = x3; x3 = s; y4 = y3; y3 = o; y[i] = o; }
    return y;
  };
  W.lufs = function (l, r) {
    try {
      const blockN = 19200, hopN = 4800;
      const n = l ? l.length : 0;
      if (!(n >= blockN)) return { lufsMean: null, lufsSum: null, kept: 0, total: 0, why: 'shorter than one 400 ms block' };
      const kl = W.kweight(l);
      const kr = r ? W.kweight(r) : null;
      const chanP = function (k, from, to) { let s = 0; for (let i = from; i < to; i++) { const v = k[i]; s += v * v; } return s / (to - from); };
      const zs = [];
      for (let b = 0; b + blockN <= n; b += hopN) {
        const pl = chanP(kl, b, b + blockN);
        const pr = kr ? chanP(kr, b, b + blockN) : 0;
        zs.push({ mean: kr ? (pl + pr) / 2 : pl, sum: kr ? (pl + pr) : pl });
      }
      const integrate = function (key) {
        const kept = [];
        for (let i = 0; i < zs.length; i++) {
          const z = zs[i][key];
          if (z > 0) { const g = -0.691 + 10 * Math.log10(z); if (g > -70) kept.push({ z: z, g: g }); }
        }
        if (!kept.length) return { lufs: null, kept: 0 };
        let mz = 0; for (let i = 0; i < kept.length; i++) mz += kept[i].z; mz /= kept.length;
        const rel = -0.691 + 10 * Math.log10(mz) - 10;
        const kept2 = [];
        for (let i = 0; i < kept.length; i++) if (kept[i].g > rel) kept2.push(kept[i].z);
        const arr = kept2.length ? kept2 : kept.map(function (b) { return b.z; });
        let mz2 = 0; for (let i = 0; i < arr.length; i++) mz2 += arr[i]; mz2 /= arr.length;
        return { lufs: -0.691 + 10 * Math.log10(mz2), kept: arr.length };
      };
      const im = integrate('mean'), is = integrate('sum');
      return { lufsMean: im.lufs, lufsSum: is.lufs, kept: im.kept, total: zs.length };
    } catch (e) { return { lufsMean: null, lufsSum: null, kept: 0, total: 0, error: String((e && e.message) || e) }; }
  };
  W.peakDb = function (l, r) {
    let p = W.peak(l, 0, l.length);
    if (r && r !== l) { const q = W.peak(r, 0, r.length); if (q > p) p = q; }
    return p > 0 ? 20 * Math.log10(p) : null;
  };
  W.wavStats = function (buf) {
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
      return { ok: true, bits: info.bits, sr: info.sampleRate, ch: info.channels, frames: info.frames, peak: W.num(peak), nonzero: nonzero, rms: W.num(Math.sqrt(rms / (n || 1))) };
    } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
  };
  W.loudFn = function (key) {
    const gname = { lufs: 'avLoudLufs', momentary: 'avLoudMomentary', short: 'avLoudShortTerm', tp: 'avLoudTruePeak', analyze: 'avLoudAnalyze', autoGains: 'avLoudAutoGains', normalizeGain: 'avLoudNormalizeGain', compare: 'avLoudCompare' }[key];
    try { if (gname && typeof window[gname] === 'function') return window[gname]; } catch (e) { }
    try { const L = window.__avLoud; if (L && typeof L[key] === 'function') return L[key]; } catch (e2) { }
    return null;
  };
  return W;
})(); true`;

const shotPath = path.join(here, '..', 'renders', 's3-mix-suite.png');

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

  /* ── 1. boot + card + module surface ── */
  console.log('── 1. boot + card + modules ──');
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const r = await ev(`document.documentElement.getAttribute('data-av-ready') === '1'`);
    if (r.value === true) { ready = true; break; }
    await sleep(300);
  }
  check_boot: {
    /* boot + the live engine ctx (the §0 fake device + takes capture ride the engine context) */
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
    expected(ready === true && eng.found === true && eng.state === 'running' && eng.scp === true && Number(eng.sampleRate) === 48000,
      '1 boot: data-av-ready flips + engine ctx found/running/ScriptProcessor-capable/sr 48k', J({ ready: ready, eng: eng }));
  }
  if (!ready) { console.error('APP NOT READY'); process.exit(1); }

  /* 1b. the mix card mounts into #av-mix-host */
  let cardUp = false, cardInfo = '';
  for (let i = 0; i < 100 && !cardUp; i++) {
    const r = await ev(`(() => {
      const host = document.getElementById('av-mix-host');
      const card = document.getElementById('av-mix');
      const root = host ? host.querySelector('.av-mix, [class*="av-mix"]') : null;
      const wired = !!(host && host.dataset && host.dataset.avMixUiWired === '1') || !!(card && card.dataset && card.dataset.avMixUiWired === '1');
      return { host: !!host, card: !!card, root: !!root, wired: wired };
    })()`);
    const v = val(r) || {};
    cardUp = v.host === true && v.card === true && v.root === true && v.wired === true;
    cardInfo = J(v);
    if (!cardUp) await sleep(150);
  }
  expected(cardUp, '1b card mounted: #av-mix + #av-mix-host + .av-mix root + wired marker (avMixUiWired=1)', cardInfo);
  if (!cardUp) { console.error('MIX CARD MISSING — parent adds the #av-mix card + #av-mix-host and calls avMixUiInit()'); process.exit(1); }

  /* 1c. tolerant control discovery (labels/classes/ids/data-attrs scanned) */
  const ctrlR = await ev(`(() => {
    const host = document.getElementById('av-mix-host') || document.getElementById('av-mix');
    if (!host) return { host: false };
    const els = [...host.querySelectorAll('button, [role="button"], input, select, .av-btn, [data-act]')];
    const label = (e) => (((e.textContent || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '') + ' ' + (e.className || '') + ' ' + (e.id || '') + ' ' + JSON.stringify(e.dataset || {})).toLowerCase());
    const labels = els.map((e) => label(e));
    const cnt = (words) => labels.filter((t) => words.some((w) => t.indexOf(w) >= 0)).length;
    return {
      host: true, controls: els.length,
      add: cnt(['add track', 'add-track', 'addtrack', 'add']),
      sends: cnt(['sends', 'send a', 'send b', 'send-a', 'send-b', 'return']),
      glue: cnt(['glue']),
      master: cnt(['master']),
      norm: cnt(['norm']),
      render: cnt(['render', 'mixdown', 'update mix']),
      exp: cnt(['export']),
      auto: cnt(['auto']),
      ab: cnt(['reference', 'compare', 'a/b', 'a-b', 'ab-']),
    };
  })()`);
  const ctrl = val(ctrlR) || {};
  expected(ctrl.host === true && ctrl.add >= 1 && ctrl.sends >= 1 && ctrl.glue >= 1 && ctrl.master >= 1 && ctrl.render >= 1 && ctrl.exp >= 1 && ctrl.auto >= 1 && ctrl.ab >= 1,
    '1c controls: track ADD · SENDS · GLUE · MASTER · RENDER · EXPORT · AUTO-MIX · A/B present in the mix card (tolerant label scan)',
    J({ controls: ctrl.controls, add: ctrl.add, sends: ctrl.sends, glue: ctrl.glue, master: ctrl.master, render: ctrl.render, exp: ctrl.exp, auto: ctrl.auto, ab: ctrl.ab, norm: ctrl.norm }));

  /* 1d. module globals + handles + pure surface + init + pinned param defaults + pristine page */
  const surfR = await ev(`(() => {
    const g = (n) => typeof window[n];
    const mixFns = ['avMixInit','avMixState','avMixList','avMixAddTrack','avMixSetTrack','avMixRemoveTrack','avMixClear','avMixSetParam','avMixParams','avMixRender','avMixExport','avMixAutoBalance','avMixSetRef','avMixCompare','avMixClasses'];
    const loudFns = ['avLoudLufs','avLoudMomentary','avLoudShortTerm','avLoudTruePeak','avLoudAnalyze','avLoudAutoGains','avLoudNormalizeGain','avLoudCompare'];
    const uiFns = ['avMixUiInit','avMixUiClasses','avMixUiSync'];
    const missing = mixFns.concat(loudFns, uiFns).filter((n) => g(n) !== 'function');
    let initTrue = null;
    try { initTrue = avMixInit() === true; } catch (e) { initTrue = 'threw: ' + String((e && e.message) || e); }
    const M = window.__avMix || null;
    const pure = !!(M && M.pure && typeof M.pure.ditherApply === 'function' && typeof M.pure.balanceGains === 'function' && typeof M.pure.faderGain === 'function' && typeof M.pure.duckGain === 'function' && typeof M.pure.envFollower === 'function' && typeof M.pure.dbToLin === 'function');
    const L = window.__avLoud || null;
    const loudSurf = !!(L && typeof L.lufs === 'function' && typeof L.tp === 'function' && typeof L.analyze === 'function' && typeof L.autoGains === 'function' && typeof L.normalizeGain === 'function' && typeof L.compare === 'function' && typeof L.momentary === 'function' && typeof L.short === 'function');
    const params = (() => { try { const p = avMixParams(); return (p && typeof p === 'object') ? p : null; } catch (e) { return null; } })();
    const pick = (p, k) => (p && Object.prototype.hasOwnProperty.call(p, k)) ? p[k] : null;
    const defaults = {
      aRet: pick(params, 'send.A.return'), bRet: pick(params, 'send.B.return'),
      glueOn: pick(params, 'glue.on'), glueThr: pick(params, 'glue.thresh'), glueRatio: pick(params, 'glue.ratio'),
      normOn: pick(params, 'master.norm.on'), normT: pick(params, 'master.norm.target'), normC: pick(params, 'master.norm.ceiling')
    };
    const state = (() => { try { const s = avMixState() || {}; return { count: s.count, rev: s.rev }; } catch (e) { return null; } })();
    const takeN = (() => { try { return avTakesList().length; } catch (e) { return null; } })();
    const compN = (() => { try { return avCompList().length; } catch (e) { return null; } })();
    let rec = null; try { rec = avTakesState().recording; } catch (e) { }
    return { missing: missing, initTrue: initTrue, mixHandle: !!M, mixVer: M ? M.version : null, pure: pure,
      loudHandle: !!L, loudVer: L ? L.version : null, loudSurf: loudSurf,
      uiHandle: !!(window.__avMixUi && typeof window.__avMixUi === 'object'), uiVer: window.__avMixUi ? window.__avMixUi.version : null,
      classesN: (typeof avMixUiClasses === 'function') ? (avMixUiClasses() || []).length : 0,
      defaults: defaults, state: state, takeN: takeN, compN: compN, rec: rec };
  })()`);
  const surf = val(surfR) || {};
  const dfl = surf.defaults || {};
  const near = (a, b, eps) => (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= (eps || 1e-9));
  const defaultsOk = near(dfl.aRet, 0.35) && near(dfl.bRet, 0.30) && near(dfl.glueOn, 0) && near(dfl.glueThr, -18) && near(dfl.glueRatio, 2) && near(dfl.normOn, 0) && near(dfl.normT, -14) && near(dfl.normC, -1);
  expected(Array.isArray(surf.missing) && surf.missing.length === 0 && surf.initTrue === true && surf.mixHandle === true && typeof surf.mixVer === 'string' && surf.pure === true && surf.loudHandle === true && typeof surf.loudVer === 'string' && surf.loudSurf === true && surf.uiHandle === true && Number(surf.classesN) >= 10 && defaultsOk && !!(surf.state && surf.state.count === 0) && surf.takeN === 0 && surf.compN === 0 && surf.rec === false,
    '1d module surface: avMix* + avLoud* + avMixUi* globals · window.__avMix (pure) · __avLoud · __avMixUi · avMixInit() true · pinned param defaults · page pristine',
    J({ missing: surf.missing, initTrue: surf.initTrue, mixVer: surf.mixVer, loudVer: surf.loudVer, uiVer: surf.uiVer, pure: surf.pure, loudSurf: surf.loudSurf, classesN: surf.classesN, defaults: dfl, state: surf.state, takeN: surf.takeN, compN: surf.compN, rec: surf.rec }));
  if (Array.isArray(surf.missing) && (surf.missing.indexOf('avMixRender') >= 0 || surf.missing.indexOf('avMixAddTrack') >= 0)) {
    console.error('S3 MIX MODULE MISSING — parent adds av_loud.js / av_mix.js / av_mix_ui.js and rebuilds');
    process.exit(1);
  }

  /* 1e. rig helpers injected + fixtures built */
  await ev(MIXW_HELPERS);
  const fxR = await ev(`(() => {
    const W = window.__mixw;
    if (!W || W.v !== 1) return null;
    const o = {};
    o.v = W.v;
    o.s05 = W.mkSine('s05', 0.5, 1.0, 48000, 997).frames;
    o.s02 = W.mkSine('s02', 0.2, 1.0, 48000, 631).frames;
    o.hot = W.mkSine('hot', 1.5, 1.0, 48000, 997).frames;
    o.snd = W.mkSine('snd', 0.5, 0.6, 48000, 997).frames;
    o.two = W.mkTwoLevel('two', 0.8, 0.08, 1.0, 48000, 997).frames;
    o.a01 = W.mkSine('a01', 0.1, 3.0, 48000, 997).frames;
    o.a02 = W.mkSine('a02', 0.2, 3.0, 48000, 997).frames;
    o.straddle = W.mkStraddle('straddle', 1.0, 1.0, 48000).frames;
    o.q05 = W.mkSine('q05', 0.05, 1.0, 48000, 997).frames;
    o.sil = W.mkSilence('sil', 1.0, 48000).frames;
    o.q005 = W.mkSine('q005', 0.005, 1.0, 48000, 997).frames;
    o.loud4 = W.mkSine('loud4', 4.0, 1.0, 48000, 997).frames;
    o.dth = W.mkSine('dth', 0.1, 1.0, 48000, 997).frames;
    return o;
  })()`);
  const fx = val(fxR) || {};
  expected(fx.v === 1 && fx.s05 === 48000 && fx.s02 === 48000 && fx.hot === 48000 && fx.snd === 28800 && fx.two === 96000 && fx.a01 === 144000 && fx.a02 === 144000 && fx.straddle === 48000 && fx.q05 === 48000 && fx.sil === 48000 && fx.q005 === 48000 && fx.loud4 === 48000 && fx.dth === 48000,
    '1e rig helpers + fixtures injected (__mixw v1 · deterministic sines/straddle/two-level/silence @48k)', J(fx));

  /* ── 2. sources: input + two takes + one comp ── */
  console.log('── 2. sources ──');
  const en2R = await ev(`(async () => { try { return await avInputEnable(); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } })()`);
  const en2 = val(en2R) || {};
  const beep = val(await ev(`window.__mixw.captureInput(2600)`)) || {};
  expected(en2.ok === true && Number(en2.channels) >= 1 && Number(en2.sampleRate) === 48000 && beep.ok === true && Number(beep.seconds) >= 2.5 && Number(beep.peak) > 0.05 && Number(beep.nonzero) > 1000,
    '2 input enable (fake device): ok · channels >= 1 · sr 48k · beep-train witness on avInputNode (>= 2.5 s · peak > 0.05 · nonzero > 1000 — NEVER continuous-audio)',
    J({ ok: en2.ok, channels: en2.channels, sampleRate: en2.sampleRate, beep: { seconds: fx3(beep.seconds), peak: fx3(beep.peak), nonzero: beep.nonzero } }));

  const recQuick = async (ms) => {
    const s = await ev(`(async () => { try { return await avTakesStart({ lapSync: false }); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } })()`);
    const sv = val(s) || {};
    if (sv.ok !== true) return { start: sv, fin: {} };
    await sleep(ms);
    const f = await ev(`(async () => { let r = avTakesStop(); if (r && typeof r.then === 'function') r = await r; return r; })()`);
    return { start: sv, fin: val(f) || {} };
  };
  const recA = await recQuick(1200);
  await sleep(300);
  const recB = await recQuick(2000);   /* the 4096-block-quantized capture needs distinct whole-block waits */
  const list2R = await ev(`avTakesList().map(function (t) { return { id: t.id, name: t.name, frames: t.frames, rate: t.rate, lap: t.lap, partial: t.partial, offsetFrames: t.offsetFrames }; })`);
  const list2 = val(list2R) || [];
  const tA2 = list2[0] || {}, tB2 = list2[1] || {};
  const stash2R = await ev(`(() => {
    const l = avTakesList();
    if (!Array.isArray(l) || l.length < 2) return null;
    window.__mixw.rig.takeA = { id: l[0].id, frames: l[0].frames, offset: (typeof l[0].offsetFrames === 'number') ? l[0].offsetFrames : 0 };
    window.__mixw.rig.takeB = { id: l[1].id, frames: l[1].frames, offset: (typeof l[1].offsetFrames === 'number') ? l[1].offsetFrames : 0 };
    return { takeA: window.__mixw.rig.takeA, takeB: window.__mixw.rig.takeB };
  })()`);
  const stash2 = val(stash2R) || {};
  expected(!!(recA.fin && recA.fin.ok === true) && !!(recB.fin && recB.fin.ok === true) && list2.length === 2 && Number(tA2.frames) > 10000 && Number(tB2.frames) > 10000 && tA2.frames !== tB2.frames && tA2.rate === 48000 && tB2.rate === 48000 && tA2.partial === false && tB2.partial === false && stash2.takeA != null && stash2.takeB != null,
    '2 takes: two avTakes-path takes (fake-device beeps) · DISTINCT frames · sr 48k · partial false · rig stash pinned (A · B)',
    J({ A: { frames: tA2.frames, off: tA2.offsetFrames }, B: { frames: tB2.frames, off: tB2.offsetFrames }, stash: stash2 }));

  const p2cR = await ev(`(() => {
    const W = window.__mixw;
    const R = W.rig;
    const out = { ok: false, why: null };
    if (!R.takeB) { out.why = 'rig take stash missing'; return out; }
    if (typeof avCompCreate !== 'function' || typeof avCompAddSegment !== 'function' || typeof avCompSetSegment !== 'function' || typeof avCompRender !== 'function') { out.why = 'comp engine functions missing'; return out; }
    const c = avCompCreate({ name: 'RIG MIX COMP' });
    if (!c || typeof c.id !== 'string') { out.why = 'create refused'; out.c = c; return out; }
    out.id = c.id;
    const add = avCompAddSegment(c.id, { takeId: R.takeB.id, fromFrame: 0, toFrame: R.takeB.frames });
    out.addOk = !!(add && add.ok === true && add.index === 0);
    const set = avCompSetSegment(c.id, 0, { takeId: R.takeB.id, fromFrame: 0, toFrame: R.takeB.frames, fadeIn: 240, fadeOut: 240 });
    out.setOk = !!(set && set.ok === true);
    const ren = avCompRender(c.id);
    out.render = { ok: !!(ren && ren.ok === true), frames: ren ? ren.frames : null, error: (ren && ren.error) || null };
    if (ren && ren.ok === true && ren.frames > 0) { W.rig.comp = { id: c.id, frames: ren.frames }; out.ok = true; }
    return out;
  })()`);
  const p2c = val(p2cR) || {};
  expected(p2c.ok === true && p2c.addOk === true && p2c.setOk === true && !!(p2c.render && p2c.render.ok === true) && Number(p2c.render.frames) > 0 && p2c.render.frames > 0,
    '2 comp source: avCompCreate + avCompAddSegment(take B full) + avCompSetSegment + avCompRender ok (frames > 0)',
    J(p2c));

  /* ── 3. take + comp + engine tracks -> render + determinism + offset comp ── */
  console.log('── 3. tracks + render ──');
  const p3aR = await ev(`(() => {
    const W = window.__mixw;
    const R = W.rig;
    const out = {};
    out.enginePrereq = { avBounce: (typeof avBounce === 'function'), snap: (() => { try { return !!avSeqSnap(); } catch (e) { return false; } })() };
    if (!R.takeA || !R.comp) { out.why = 'rig stash incomplete'; return out; }
    const pack = (x) => ({ ok: !!(x && x.ok === true), id: (x && x.track && x.track.id) || null, name: (x && x.track && x.track.name) || null, error: (x && x.error) || null });
    /* SPEC fix (parent 2026-10-07): the ENGINE leg needs audible events — the fresh-page default
       pattern is EMPTY (probe: snapNotes 0 -> avBounce warns "pattern has no audible events").
       Load the house rig pattern shape (cdp_bounce BUILD_PATTERN: notes on all 4 tracks, prob 100). */
    out.patternLoaded = (function () {
      try {
        const mk = (on, note, vel) => ({ on: on ? 1 : 0, note: note, vel: vel, gate: 0.5, slide: 0, accent: 0, oct: 0, prob: 100, cond: '', ratchet: 1, micro: 0 });
        const track = (hits, note, vel) => { const steps = []; for (let i = 0; i < 64; i++) steps.push(mk(0, note, vel)); for (let i = 0; i < hits.length; i++) steps[hits[i]] = mk(1, note, vel); return { len: 16, speed: 1, mute: 0, steps: steps }; };
        const pat = { v: 1, name: 'RIG MIX PAT', bpm: 120, grid: '16', swing: 50, rng: 0x12345678,
          tracks: [ track([0, 1, 2, 3, 4, 5, 6, 7], 'c3', 0.9), track([0, 1, 2, 3, 4, 5, 6, 7], 'e3', 0.8), track([0, 1, 2, 3, 4, 5, 6, 7], 'g3', 0.8), track([8, 9, 10, 11], 'c4', 0.9) ],
          plocks: [] };
        const ok = (typeof avSeqLoad === 'function') ? avSeqLoad(pat) : false;
        return (ok === true) && !!((typeof avSeqSnap === 'function') && avSeqSnap() && avSeqSnap().name === 'RIG MIX PAT');
      } catch (e) { return 'err: ' + String((e && e.message) || e); }
    })();
    const t1 = avMixAddTrack({ name: 'TAKE-A', source: { type: 'take', id: R.takeA.id } });
    const t2 = avMixAddTrack({ name: 'COMP-1', source: { type: 'comp', id: R.comp.id } });
    const t3 = avMixAddTrack({ name: 'ENGINE', source: { type: 'engine', mask: [true, true, true, true], loops: 1, tailS: 0.5 } });
    out.add = { t1: pack(t1), t2: pack(t2), t3: pack(t3) };
    if (out.add.t1.id) R.t1 = out.add.t1.id;
    if (out.add.t2.id) R.t2 = out.add.t2.id;
    if (out.add.t3.id) R.t3 = out.add.t3.id;
    try { const s = avMixState() || {}; out.count = s.count; out.rev = W.num(s.rev); } catch (e) { out.stateErr = String((e && e.message) || e); }
    try { out.metas = avMixList().map((m) => ({ id: m.id, name: m.name, gainDb: W.num(m.gainDb), pan: W.num(m.pan), src: (m.source && m.source.type) || null })); } catch (e) { }
    return out;
  })()`);
  const p3a = val(p3aR) || {};
  const add3 = p3a.add || {};
  const metas3 = Array.isArray(p3a.metas) ? p3a.metas : [];
  expected(!!(add3.t1 && add3.t1.ok === true && add3.t1.id) && !!(add3.t2 && add3.t2.ok === true && add3.t2.id) && !!(add3.t3 && add3.t3.ok === true && add3.t3.id) && p3a.count === 3 && metas3.length === 3 && metas3.every((m) => typeof m.name === 'string' && typeof m.gainDb === 'number') && p3a.patternLoaded === true,
    '3a add tracks: rig pattern loaded (RIG MIX PAT) + take-A + comp + engine (loops 1, tail 0.5) all ok · state count 3 · list metas carry name/gainDb',
    J({ add: add3, count: p3a.count, metas: metas3, enginePrereq: p3a.enginePrereq, patternLoaded: p3a.patternLoaded, why: p3a.why }));

  const p3bR = await ev(`(async () => {
    const W = window.__mixw;
    const out = {};
    const r = await W.render({ tailS: 0.5 });
    W.last = r;
    out.R = W.rcpt(r);
    if (r && r.ok === true) {
      out.len = { l: r.l ? r.l.length : null, r: r.r ? r.r.length : null };
      out.peak = W.num(W.peak2(r.l, r.r, 0, r.l.length));
      out.rms = W.num(W.rms2(r.l, r.r, 0, r.l.length));
    }
    return out;
  })()`);
  const p3b = val(p3bR) || {};
  const R3 = p3b.R || {};
  const takeA3 = (stash2.takeA || {});
  const compFrames3 = Number((p2c.render || {}).frames) || 0;
  const knownMax3 = Math.max(Math.max(0, (Number(takeA3.frames) || 0) - (Number(takeA3.offset) || 0)), compFrames3);
  const lower3 = Math.ceil(knownMax3 + 0.5 * 48000) - 2;
  expected(R3.ok === true && Number(R3.frames) > 0 && Number(R3.frames) >= lower3 && Number(R3.frames) >= 12000 &&
    typeof R3.lufs === 'number' && isFinite(R3.lufs) && typeof R3.dbtp === 'number' && isFinite(R3.dbtp) &&
    R3.rate === 48000 && !!(p3b.len && p3b.len.l === R3.frames && p3b.len.r === R3.frames) && Number(p3b.peak) > 0 && Number(p3b.rms) > 0,
    '3b render (tail 0.5): ok · frames > 0 / >= rig-known lower bound · lufs+dbtp finite · rate 48k · l/r length === frames · non-silent',
    J({ R: R3, len: p3b.len, peak: fx3(p3b.peak), rms: fx4(p3b.rms), lower: lower3, knownMax: knownMax3 }));

  const p3cR = await ev(`(async () => {
    const W = window.__mixw;
    const r1 = await W.render({ tailS: 0.5 });
    const r2 = await W.render({ tailS: 0.5 });
    return {
      ok1: r1 && r1.ok === true, ok2: r2 && r2.ok === true,
      framesEq: !!(r1 && r2 && r1.frames === r2.frames),
      lEq: !!(r1 && r2 && W.eqBytes(r1.l, r2.l)), rEq: !!(r1 && r2 && W.eqBytes(r1.r, r2.r)),
      lufsEq: !!(r1 && r2 && r1.lufs === r2.lufs),
    };
  })()`);
  const p3c = val(p3cR) || {};
  expected(p3c.ok1 === true && p3c.ok2 === true && p3c.framesEq === true && p3c.lEq === true && p3c.rEq === true && p3c.lufsEq === true,
    '3c determinism: two renders of the same state -> byte-identical l AND r · frames equal · lufs equal (no randomness in the render path)', J(p3c));

  const p3dR = await ev(`(async () => {
    const W = window.__mixw;
    const R = W.rig;
    const out = {};
    const raw = W.takeRaw(R.takeA.id);
    if (!raw) { out.why = 'take raw data unreachable'; return out; }
    W.clean();
    /* TAKE-ONLY render: the compensated take contribution IS the output (gain 0 · pan center) */
    const addT = (typeof avMixAddTrack === 'function') ? avMixAddTrack({ name: 'OFFSET', source: { type: 'take', id: R.takeA.id } }) : null;
    out.addT = !!(addT && addT.ok === true);
    if (!out.addT) { out.addErr = addT && addT.error; return out; }
    const r = await W.render({ tailS: 0.25 });
    out.rok = r && r.ok === true;
    if (!r || r.ok !== true) { out.err = r && r.error; return out; }
    const off = raw.offsetFrames || 0;
    const n = Math.min(r.l.length, Math.max(0, raw.frames - off));
    out.off = off; out.n = n; out.rawFrames = raw.frames;
    out.maxDiff = W.num(W.diff(r.l, raw.l, off, n));
    out.maxDiffUncomp = W.num(W.diff(r.l, raw.l, 0, n));
    return out;
  })()`);
  const p3d = val(p3dR) || {};
  expected(p3d.rok === true && Number(p3d.n) > 1000 && typeof p3d.maxDiff === 'number' && p3d.maxDiff <= 1e-6,
    '3d offsetFrames latency comp: solo take render == raw take data advanced by offsetFrames (drop leading, clamped) — max|out[i] - raw[i+off]| <= 1e-6',
    J({ off: p3d.off, n: p3d.n, maxDiff: p3d.maxDiff, maxDiffUncomp: p3d.maxDiffUncomp, why: p3d.why, err: p3d.err }));

  /* ── 4. gain law + silencing + solo ── */
  console.log('── 4. gain law ──');
  const p4aR = await ev(`(async () => {
    const W = window.__mixw;
    W.clean();
    const F = W.fx.s05;
    const add = W.addBuf('s05', { name: 'G' });
    if (!add || add.ok !== true) return { why: 'add refused', error: add && add.error };
    const id = add.track.id;
    const r0 = await W.render({ tailS: 0.25 });
    if (!r0 || r0.ok !== true) return { why: 'render0 refused', error: r0 && r0.error };
    const rms0 = W.rms2(r0.l, r0.r, 0, F.frames);
    const st = avMixSetTrack(id, { gainDb: -6 });
    const r6 = await W.render({ tailS: 0.25 });
    if (!r6 || r6.ok !== true) return { why: 'render6 refused', error: r6 && r6.error };
    const rms6 = W.rms2(r6.l, r6.r, 0, F.frames);
    return { setOk: !!(st && st.ok === true), refused: st && st.refused, rms0: W.num(rms0), rms6: W.num(rms6), ratio: (rms0 > 0) ? W.num(rms6 / rms0) : null };
  })()`);
  const p4a = val(p4aR) || {};
  expected(p4a.setOk === true && typeof p4a.ratio === 'number' && Math.abs(p4a.ratio - 0.5012) <= 0.5012 * 0.015,
    '4a gain law: -6 dB -> rms ratio 0.5012 ±1.5% (rig-own pooled rms over the source window)', J(p4a));

  const p4bR = await ev(`(async () => {
    const W = window.__mixw;
    W.clean();
    const add = W.addBuf('s05', { name: 'S' });
    if (!add || add.ok !== true) return { why: 'add refused' };
    const id = add.track.id;
    avMixSetTrack(id, { gainDb: -60 });
    const r60 = await W.render({ tailS: 0.25 });
    const m60 = (r60 && r60.ok === true) ? W.maxAbs2(r60.l, r60.r, 0, r60.l.length) : null;
    avMixSetTrack(id, { gainDb: 0, mute: true });
    const rm = await W.render({ tailS: 0.25 });
    const mMute = (rm && rm.ok === true) ? W.maxAbs2(rm.l, rm.r, 0, rm.l.length) : null;
    return { ok60: r60 && r60.ok === true, okMute: rm && rm.ok === true, m60: W.num(m60), mMute: W.num(mMute) };
  })()`);
  const p4b = val(p4bR) || {};
  expected(p4b.ok60 === true && p4b.okMute === true && typeof p4b.m60 === 'number' && p4b.m60 <= 1e-7 && typeof p4b.mMute === 'number' && p4b.mMute <= 1e-7,
    '4b silencing laws: gainDb <= -60 -> fader gain 0 EXACTLY and mute -> exact silence (max|x| <= 1e-7 over the whole render)',
    J({ maxAbsGain60: p4b.m60, maxAbsMute: p4b.mMute }));

  const p4cR = await ev(`(async () => {
    const W = window.__mixw;
    W.clean();
    const a = W.addBuf('s05', { name: 'A' });
    const b = W.addBuf('s02', { name: 'B' });
    if (!a || a.ok !== true || !b || b.ok !== true) return { why: 'add refused' };
    const idA = a.track.id, idB = b.track.id;
    const rAll = await W.render({ tailS: 0.25 });
    avMixSetTrack(idA, { mute: true });
    const rAmute = await W.render({ tailS: 0.25 });
    avMixSetTrack(idA, { mute: false });
    avMixSetTrack(idB, { solo: true });
    const rSoloB = await W.render({ tailS: 0.25 });
    avMixSetTrack(idB, { solo: false });
    avMixSetTrack(idA, { solo: true });
    const rSoloA = await W.render({ tailS: 0.25 });
    avMixSetTrack(idA, { solo: false });
    avMixSetTrack(idB, { mute: true });
    const rBmute = await W.render({ tailS: 0.25 });
    const all = [rAll, rAmute, rSoloB, rSoloA, rBmute];
    const out = { okAll: all.every((r) => r && r.ok === true) };
    if (out.okAll) {
      out.soloB_eq_muteA = W.eqBytes(rSoloB.l, rAmute.l) && W.eqBytes(rSoloB.r, rAmute.r);
      out.soloB_ne_all = !(W.eqBytes(rSoloB.l, rAll.l) && W.eqBytes(rSoloB.r, rAll.r));
      out.soloA_eq_muteB = W.eqBytes(rSoloA.l, rBmute.l) && W.eqBytes(rSoloA.r, rBmute.r);
      out.soloB_peak = W.num(W.peak2(rSoloB.l, rSoloB.r, 0, rSoloB.l.length));
    }
    return out;
  })()`);
  const p4c = val(p4cR) || {};
  expected(p4c.okAll === true && p4c.soloB_eq_muteA === true && p4c.soloB_ne_all === true && p4c.soloA_eq_muteB === true,
    '4c solo semantics: solo B == A-muted (byte-identical) and != both-audible · solo A == B-muted (byte-identical)', J(p4c));

  /* ── 5. pan law exact ── */
  console.log('── 5. pan law ──');
  const p5R = await ev(`(async () => {
    const W = window.__mixw;
    const out = {};
    const F = W.fx.s05;
    const run = async (pan) => {
      W.clean();
      const a = W.addBuf('s05', { name: 'PAN' });
      if (!a || a.ok !== true) return { ok: false, err: 'add refused' };
      const st = avMixSetTrack(a.track.id, { pan: pan });
      const r = await W.render({ tailS: 0.25 });
      if (!r || r.ok !== true) return { ok: false, err: (r && r.error) || 'render refused' };
      return {
        ok: true, setOk: !!(st && st.ok === true),
        maxL: W.num(W.maxAbs2(r.l, null, 0, r.l.length)), maxR: W.num(W.maxAbs2(r.r, null, 0, r.r.length)),
        diffL: W.num(W.diff(r.l, F.l, 0, F.frames)), diffR: W.num(W.diff(r.r, F.r, 0, F.frames)),
      };
    };
    out.left = await run(-1);
    out.center = await run(0);
    out.right = await run(1);
    return out;
  })()`);
  const p5 = val(p5R) || {};
  const p5L = p5.left || {}, p5C = p5.center || {}, p5Rr = p5.right || {};
  expected(p5L.ok === true && p5L.setOk === true && typeof p5L.maxR === 'number' && p5L.maxR <= 1e-12 && typeof p5L.diffL === 'number' && p5L.diffL <= 1e-7,
    '5a pan hard LEFT: right channel |x| <= 1e-12 (exact zero) · left carries the source (<= 1e-7)', J(p5L));
  expected(p5C.ok === true && typeof p5C.diffL === 'number' && p5C.diffL <= 1e-7 && typeof p5C.diffR === 'number' && p5C.diffR <= 1e-7,
    '5b pan CENTER: both channels carry the source exactly (gL = gR = 1 · max|out - src| <= 1e-7)', J(p5C));
  expected(p5Rr.ok === true && typeof p5Rr.maxL === 'number' && p5Rr.maxL <= 1e-12 && typeof p5Rr.diffR === 'number' && p5Rr.diffR <= 1e-7,
    '5c pan hard RIGHT (mirrored): left channel |x| <= 1e-12 · right carries the source (<= 1e-7)', J(p5Rr));

  /* ── 6. per-track FX (drive · dyn) ── */
  console.log('── 6. per-track FX ──');
  const p6R = await ev(`(async () => {
    const W = window.__mixw;
    const out = {};
    const F = W.fx.s05;
    W.clean();
    const a = W.addBuf('s05', { name: 'DRV' });
    if (!a || a.ok !== true) return { why: 'add refused' };
    const id = a.track.id;
    const r0 = await W.render({ tailS: 0.25 });
    if (!r0 || r0.ok !== true) return { why: 'render dry refused', err: r0 && r0.error };
    const rms0 = W.rms2(r0.l, r0.r, 0, F.frames);
    const st = avMixSetTrack(id, { fx: { drive: { on: 1, amount: 1 } } });
    const r1 = await W.render({ tailS: 0.25 });
    if (!r1 || r1.ok !== true) return { why: 'render drive refused', err: r1 && r1.error };
    const rms1 = W.rms2(r1.l, r1.r, 0, F.frames);
    const r2 = await W.render({ tailS: 0.25 });
    out.setOk = !!(st && st.ok === true); out.refused = st && st.refused;
    out.ratio = (rms0 > 0) ? W.num(rms1 / rms0) : null;
    out.det = !!(r2 && r2.ok === true && W.eqBytes(r1.l, r2.l) && W.eqBytes(r1.r, r2.r));
    out.rms0 = W.num(rms0); out.rms1 = W.num(rms1);
    return out;
  })()`);
  const p6 = val(p6R) || {};
  expected(p6.setOk === true && typeof p6.ratio === 'number' && Math.abs(p6.ratio - 1) > 1e-3 && p6.det === true,
    '6a per-track drive (on, amount 1): changes the render (|rms ratio - 1| > 1e-3) AND stays deterministic (byte-identical re-render)',
    J({ ratio: p6.ratio, det: p6.det, refused: p6.refused, rms0: p6.rms0, rms1: p6.rms1, why: p6.why }));
  if (p6.why) note('6a debug: ' + J(p6));

  const p6bR = await ev(`(async () => {
    const W = window.__mixw;
    const out = {};
    const F = W.fx.hot;
    W.clean();
    const a = W.addBuf('hot', { name: 'DYN' });
    if (!a || a.ok !== true) return { why: 'add refused' };
    const id = a.track.id;
    const r0 = await W.render({ tailS: 0.25 });
    if (!r0 || r0.ok !== true) return { why: 'render off refused', err: r0 && r0.error };
    const p0 = W.peak2(r0.l, r0.r, 0, r0.l.length);
    const ms0 = W.rms2(r0.l, r0.r, 0, F.frames);
    const st = avMixSetTrack(id, { fx: { dyn: { on: 1, thresh: -30, ratio: 10 } } });
    const r1 = await W.render({ tailS: 0.25 });
    if (!r1 || r1.ok !== true) return { why: 'render dyn refused', err: r1 && r1.error };
    const p1 = W.peak2(r1.l, r1.r, 0, r1.l.length);
    const ms1 = W.rms2(r1.l, r1.r, 0, F.frames);
    out.setOk = !!(st && st.ok === true); out.refused = st && st.refused;
    out.p0 = W.num(p0); out.p1 = W.num(p1); out.ratio = (ms0 > 0) ? W.num(ms1 / ms0) : null;
    return out;
  })()`);
  const p6b = val(p6bR) || {};
  expected(p6b.setOk === true && typeof p6b.p1 === 'number' && typeof p6b.p0 === 'number' && p6b.p1 <= p6b.p0 + 1e-6 && typeof p6b.ratio === 'number' && p6b.ratio < 1 && p6b.p1 > 1e-4,
    '6b per-track dyn (on, thresh -30, ratio 10) on the HOT fixture (amp 1.5): peak <= off-peak (+1e-6) · rms ratio < 1 · still audible',
    J(p6b));

  /* ── 7. sends (verb · delay) ── */
  console.log('── 7. sends ──');
  const p7R = await ev(`(async () => {
    const W = window.__mixw;
    const out = {};
    const F = W.fx.snd;
    W.clean();
    const a = W.addBuf('snd', { name: 'SND' });
    if (!a || a.ok !== true) return { why: 'add refused' };
    const id = a.track.id;
    avMixSetTrack(id, { sends: { a: 0, b: 0 } });
    const r0 = await W.render({ tailS: 1.0 });
    if (!r0 || r0.ok !== true) return { why: 'dry render refused', err: r0 && r0.error };
    const N = F.frames;
    const dryTail = W.rms2(r0.l, r0.r, N, r0.l.length);
    avMixSetTrack(id, { sends: { a: 0.8 } });
    const sa = avMixSetParam('send.A.verb.decay', 0.7);
    const r1 = await W.render({ tailS: 1.0 });
    if (!r1 || r1.ok !== true) return { why: 'verb render refused', err: r1 && r1.error };
    const wetTail = W.rms2(r1.l, r1.r, N, r1.l.length);
    avMixSetTrack(id, { sends: { a: 0, b: 0.8 } });
    const sb = avMixSetParam('send.B.delay.time', 0.25);
    const r2 = await W.render({ tailS: 1.0 });
    if (!r2 || r2.ok !== true) return { why: 'delay render refused', err: r2 && r2.error };
    const delayTail = W.rms2(r2.l, r2.r, N, r2.l.length);
    const echoWin = W.rms2(r2.l, r2.r, N + 9600, r2.l.length);
    out.decaySet = !!(sa && sa.ok === true); out.timeSet = !!(sb && sb.ok === true);
    out.dryTail = W.num(dryTail); out.wetTail = W.num(wetTail); out.delayTail = W.num(delayTail); out.echoWin = W.num(echoWin);
    out.wetRatio = (dryTail > 0) ? W.num(wetTail / dryTail) : null;
    out.delayVsDry = W.num(delayTail / Math.max(dryTail, 1e-9));
    out.frames = W.num(r2.frames); out.tailFrom = N;
    return out;
  })()`);
  const p7 = val(p7R) || {};
  const wet7aOk = (p7.dryTail === 0) ? (typeof p7.wetTail === 'number' && p7.wetTail > 1e-4) : (typeof p7.wetRatio === 'number' && p7.wetRatio >= 100);
  expected(p7.why === undefined && p7.decaySet === true && typeof p7.dryTail === 'number' && p7.dryTail < 1e-5 && typeof p7.wetTail === 'number' && p7.wetTail > 1e-4 && wet7aOk,
    '7a send A: sendA 0.8 + verb decay 0.7 -> post-source tail energy >= 100x the dry tail (wet floor 1e-4 · dry < 1e-5; dry exactly 0 -> any wet floor passes)',
    J({ dryTail: p7.dryTail, wetTail: p7.wetTail, wetRatio: p7.wetRatio, why: p7.why }));
  expected(p7.why === undefined && p7.timeSet === true && typeof p7.delayTail === 'number' && p7.delayTail > 1e-4 && typeof p7.delayVsDry === 'number' && p7.delayVsDry > 10 && typeof p7.echoWin === 'number' && p7.echoWin > 1e-4,
    '7b send B: sendB 0.8 + delay time 0.25 -> post-source echo energy present (> 10x dry · echo window beyond 0.2 s > 1e-4)',
    J({ delayTail: p7.delayTail, delayVsDry: p7.delayVsDry, echoWin: p7.echoWin, why: p7.why }));

  /* ── 8. bus glue ── */
  console.log('── 8. bus glue ──');
  const p8R = await ev(`(async () => {
    const W = window.__mixw;
    const out = {};
    const F = W.fx.two;
    W.clean();
    const a = W.addBuf('two', { name: 'GLUE' });
    if (!a || a.ok !== true) return { why: 'add refused' };
    const rOff = await W.render({ tailS: 0.25 });
    if (!rOff || rOff.ok !== true) return { why: 'off render refused', err: rOff && rOff.error };
    const g1 = avMixSetParam('glue.on', 1);
    const g2 = avMixSetParam('glue.thresh', -30);
    const g3 = avMixSetParam('glue.ratio', 8);
    const rOn = await W.render({ tailS: 0.25 });
    if (!rOn || rOn.ok !== true) return { why: 'on render refused', err: rOn && rOn.error };
    const loudW = [2400, 48000], quietW = [50400, 96000];
    out.setOk = !!(g1 && g1.ok === true && g2 && g2.ok === true && g3 && g3.ok === true);
    out.loudOff = W.num(W.rms2(rOff.l, rOff.r, loudW[0], loudW[1]));
    out.quietOff = W.num(W.rms2(rOff.l, rOff.r, quietW[0], quietW[1]));
    out.loudOn = W.num(W.rms2(rOn.l, rOn.r, loudW[0], loudW[1]));
    out.quietOn = W.num(W.rms2(rOn.l, rOn.r, quietW[0], quietW[1]));
    if (out.loudOff > 0 && out.quietOff > 0 && out.loudOn > 0 && out.quietOn > 0) {
      out.balanceOff = out.quietOff / out.loudOff;
      out.balanceOn = out.quietOn / out.loudOn;
      out.improvement = W.num(out.balanceOn / out.balanceOff);
      out.quietRatio = W.num(out.quietOn / out.quietOff);
      out.loudRatio = W.num(out.loudOn / out.loudOff);
    }
    return out;
  })()`);
  const p8 = val(p8R) || {};
  expected(p8.setOk === true && typeof p8.improvement === 'number' && p8.improvement >= 1.05 && typeof p8.loudRatio === 'number' && p8.loudRatio < 1,
    '8 bus glue (on/thresh -30/ratio 8): dynamic-balance improvement (quiet/loud on vs off) >= 1.05 with the loud half compressed (SPEC note a)',
    J({ improvement: p8.improvement, quietRatio: p8.quietRatio, loudRatio: p8.loudRatio, loudOff: p8.loudOff, loudOn: p8.loudOn, quietOff: p8.quietOff, quietOn: p8.quietOn, why: p8.why }));

  /* ── 9. master limiter ── */
  console.log('── 9. master limiter ──');
  const p9R = await ev(`(async () => {
    const W = window.__mixw;
    W.clean();
    const a = W.addBuf('hot', { name: 'LIM' });
    if (!a || a.ok !== true) return { why: 'add refused' };
    const m1 = avMixSetParam('master.dyn.on', 1);
    const m2 = avMixSetParam('master.dyn.lim.ceiling', -1);
    const r = await W.render({ tailS: 0.25 });
    if (!r || r.ok !== true) return { why: 'render refused', err: r && r.error };
    return { setOk: !!(m1 && m1.ok === true && m2 && m2.ok === true), peak: W.num(W.maxAbs2(r.l, r.r, 0, r.l.length)), dbtp: W.num(r.dbtp) };
  })()`);
  const p9 = val(p9R) || {};
  expected(p9.setOk === true && typeof p9.peak === 'number' && p9.peak <= 0.910 + 5e-3 && p9.peak > 0.5,
    '9 master limiter: hot fixture (amp 1.5) + master dyn on, ceiling -1 -> max|out| <= 0.910 + 5e-3 and audible (peak > 0.5)',
    J(p9));

  /* ── 10. normalize ── */
  console.log('── 10. normalize ──');
  const p10R = await ev(`(async () => {
    const W = window.__mixw;
    W.clean();
    const a = W.addBuf('s05', { name: 'NORM' });
    if (!a || a.ok !== true) return { why: 'add refused' };
    const n1 = avMixSetParam('master.norm.on', 1);
    const n2 = avMixSetParam('master.norm.target', -14);
    const n3 = avMixSetParam('master.norm.ceiling', -1.0);
    const r1 = await W.render({ tailS: 0.25 });
    if (!r1 || r1.ok !== true) return { why: 'render refused', err: r1 && r1.error };
    const r2 = await W.render({ tailS: 0.25 });
    const rig = W.lufs(r1.l, r1.r);
    return {
      setOk: !!(n1 && n1.ok === true && n2 && n2.ok === true && n3 && n3.ok === true),
      R: W.rcpt(r1),
      rigMean: W.num(rig.lufsMean), rigSum: W.num(rig.lufsSum),
      det: !!(r2 && r2.ok === true && r1.frames === r2.frames && W.eqBytes(r1.l, r2.l) && W.eqBytes(r1.r, r2.r)),
      detOk2: r2 && r2.ok === true,
    };
  })()`);
  const p10 = val(p10R) || {};
  const R10 = p10.R || {};
  const nrm10 = R10.norm || {};
  const caseA = typeof R10.lufs === 'number' && isFinite(R10.lufs) && Math.abs(R10.lufs + 14) <= 0.6 &&
    ((typeof p10.rigMean === 'number' && Math.abs(p10.rigMean + 14) <= 0.6) || (typeof p10.rigSum === 'number' && Math.abs(p10.rigSum + 14) <= 0.6));
  const caseB = typeof R10.lufs === 'number' && R10.lufs < -14 && nrm10.limited === true && typeof R10.dbtp === 'number' && R10.dbtp <= -0.95;
  expected(p10.setOk === true && nrm10.on === true && nrm10.target === -14 && nrm10.ceiling === -1 && typeof nrm10.gainDb === 'number' && isFinite(nrm10.gainDb) && (caseA || caseB),
    '10a normalize (on, target -14, ceiling -1): receipt.norm {on,target,ceiling,gainDb} · lufs ≈ -14 ±0.6 (receipt AND a rig-own convention) OR the TP-limited case (lufs < -14 · limited true · dbtp <= -0.95)',
    J({ R: R10, rigMean: p10.rigMean, rigSum: p10.rigSum, caseA: caseA, caseB: caseB, why: p10.why }));
  expected(p10.det === true,
    '10b normalize determinism: two normalized renders byte-identical (l AND r · frames equal) — deterministic gain from the deterministic render', J({ det: p10.det }));

  /* ── 11. LUFS anchors ── */
  console.log('── 11. LUFS anchors ──');
  const p11R = await ev(`(() => {
    const W = window.__mixw;
    const out = {};
    const lufs = W.loudFn('lufs');
    out.found = !!lufs;
    if (!lufs) return out;
    const F1 = W.fx.a01, F2 = W.fx.a02;
    const av1 = lufs(F1.l, F1.r, 48000);
    out.av1 = { ok: !!(av1 && av1.ok === true), lufs: W.num(av1 && av1.lufs), kept: W.num(av1 && av1.kept), total: W.num(av1 && av1.total) };
    const rig1 = W.lufs(F1.l, F1.r);
    out.rig1 = { mean: W.num(rig1.lufsMean), sum: W.num(rig1.lufsSum), kept: W.num(rig1.kept) };
    const av2 = lufs(F2.l, F2.r, 48000);
    out.av2lufs = W.num(av2 && av2.lufs);
    const rig2 = W.lufs(F2.l, F2.r);
    const avS = lufs(F1.l, null, 48000);
    out.avSingle = W.num(avS && avS.lufs);
    const rigS = W.lufs(F1.l, null);
    const d = (x, y) => (typeof x === 'number' && typeof y === 'number') ? W.num(x - y) : null;
    out.deltas = {
      avDouble: d(out.av2lufs, out.av1.lufs),
      rigDoubleMean: d(rig2.lufsMean, rig1.lufsMean),
      avSingleVsStereo: d(out.av1.lufs, out.avSingle),
      rigSvMean: d(rig1.lufsMean, rigS.lufsMean),
      rigSvSum: d(rig1.lufsSum, rigS.lufsSum),
    };
    const z = new Float32Array(96000);
    const avZ = lufs(z, z, 48000);
    out.silence = { lufsIsNull: !!(avZ && avZ.lufs === null), lufsType: avZ ? typeof avZ.lufs : 'no-result', kept: W.num(avZ && avZ.kept), jsonSafe: JSON.stringify({ l: avZ ? avZ.lufs : 'none' }) === '{"l":null}' };
    return out;
  })()`);
  const p11 = val(p11R) || {};
  const a11 = p11.av1 || {};
  const dl11 = p11.deltas || {};
  expected(p11.found === true && a11.ok === true && typeof p11.avSingle === 'number' && Math.abs(p11.avSingle + 23.0) <= 0.2 && typeof a11.lufs === 'number' && Math.abs(a11.lufs + 20.0) <= 0.25 && typeof (p11.rig1 || {}).mean === 'number' && Math.abs(p11.rig1.mean + 23.0) <= 0.2,
    '11a LUFS anchor (SPEC-fixed): 997 Hz amp 0.1 -> single channel -23.0 ±0.2 (av_loud AND rig-own mean); stereo L=R reads -20.0 ±0.25 (BS.1770 channel-sum = single +3.01, the 11b law)',
    J({ avSingle: p11.avSingle, avStereo: a11.lufs, rigMean: (p11.rig1 || {}).mean, rigSum: (p11.rig1 || {}).sum, rigKept: (p11.rig1 || {}).kept }));
  expected(typeof dl11.avDouble === 'number' && Math.abs(dl11.avDouble - 6.02) <= 0.05 && typeof dl11.rigDoubleMean === 'number' && Math.abs(dl11.rigDoubleMean - 6.02) <= 0.05 && typeof dl11.avSingleVsStereo === 'number' && Math.abs(dl11.avSingleVsStereo - 3.01) <= 0.05,
    '11b LUFS dB laws: amplitude doubling +6.02 ±0.05 (av + rig) · stereo-dup vs single channel +3.01 ±0.05 (av)',
    J(dl11));
  const sil11 = p11.silence || {};
  expected(sil11.lufsIsNull === true && sil11.jsonSafe === true && sil11.lufsType !== 'number' && sil11.kept === 0,
    '11c LUFS silence: no gated blocks -> lufs null (NEVER NaN / -Infinity leaking) · kept 0 · JSON-safe', J(sil11));

  /* ── 12. true-peak anchors ── */
  console.log('── 12. TP anchors ──');
  const p12R = await ev(`(() => {
    const W = window.__mixw;
    const out = {};
    const tp = W.loudFn('tp');
    out.found = !!tp;
    if (!tp) return out;
    const F5 = W.fx.s05, ST = W.fx.straddle;
    const t5 = tp(F5.l, F5.r, 48000);
    out.amp05 = { ok: !!(t5 && t5.ok === true), dbtp: W.num(t5 && t5.dbtp), peakDb: W.num(t5 && t5.peakDb) };
    out.rig05 = W.num(W.peakDb(F5.l, F5.r));
    const ts = tp(ST.l, ST.r, 48000);
    out.straddle = { ok: !!(ts && ts.ok === true), dbtp: W.num(ts && ts.dbtp), peakDb: W.num(ts && ts.peakDb) };
    out.rigStraddle = W.num(W.peakDb(ST.l, ST.r));
    const names = ['a01', 's05', 'hot', 'straddle'];
    out.mono = names.map((n) => {
      const F = W.fx[n];
      const t = tp(F.l, F.r, 48000);
      return { name: n, ok: !!(t && t.ok === true), dbtp: W.num(t && t.dbtp), peakDb: W.num(t && t.peakDb), ge: (t && typeof t.dbtp === 'number' && typeof t.peakDb === 'number') ? (t.dbtp >= t.peakDb - 1e-9) : null };
    });
    return out;
  })()`);
  const p12 = val(p12R) || {};
  const a12 = p12.amp05 || {}, s12 = p12.straddle || {};
  expected(p12.found === true && a12.ok === true && typeof a12.dbtp === 'number' && Math.abs(a12.dbtp + 6.02) <= 0.15 && typeof a12.peakDb === 'number' && typeof p12.rig05 === 'number' && Math.abs(a12.peakDb - p12.rig05) <= 1e-6,
    '12a TP: 997 Hz amp 0.5 -> dBTP -6.02 ±0.15 · peakDb == rig-own sample peak in dBFS (<= 1e-6)', J({ av: a12, rig: p12.rig05 }));
  expected(s12.ok === true && typeof s12.dbtp === 'number' && s12.dbtp >= -0.2,
    '12b TP straddle: 12 kHz (4 samples/cycle, phase pi/4) amp 1.0 -> dBTP >= -0.2 (samples hit ±45°; true analog peak 0 dBFS)',
    J({ av: s12, rigSamplePeak: p12.rigStraddle }));
  const mono12 = Array.isArray(p12.mono) ? p12.mono : [];
  expected(mono12.length === 4 && mono12.every((m) => m.ok === true && m.ge === true),
    '12c TP floor law: dbtp >= peakDb in EVERY fixture (0.1 · 0.5 · 1.5 · straddle)', J(mono12));

  /* ── 13. auto-balance ── */
  console.log('── 13. auto-balance ──');
  const p13aR = await ev(`(() => {
    const W = window.__mixw;
    const out = {};
    W.clean();
    const p = W.addBuf('s05', { name: 'AB-P' });
    const q = W.addBuf('q05', { name: 'AB-Q' });
    const s = W.addBuf('sil', { name: 'AB-SIL' });
    if (!p || p.ok !== true || !q || q.ok !== true || !s || s.ok !== true) return { why: 'add refused' };
    out.ids = { p: p.track.id, q: q.track.id, sil: s.track.id };
    const ab = avMixAutoBalance({ target: -18 });
    out.ok = !!(ab && ab.ok === true);
    out.target = W.num(ab && ab.target);
    out.ms = W.num(ab && ab.ms);
    out.rows = (ab && Array.isArray(ab.rows)) ? ab.rows.map((r) => ({ id: r.id, lufs: W.num(r.lufs), deltaDb: W.num(r.deltaDb), gainDb: W.num(r.gainDb), applied: r.applied })) : null;
    out.tracks = (typeof avMixList === 'function') ? avMixList().map((t) => ({ id: t.id, gainDb: W.num(t.gainDb) })) : null;
    return out;
  })()`);
  const p13a = val(p13aR) || {};
  const rows13 = Array.isArray(p13a.rows) ? p13a.rows : [];
  const ids13 = p13a.ids || {};
  const rowP = rows13.filter((r) => String(r.id) === String(ids13.p))[0] || null;
  const rowQ = rows13.filter((r) => String(r.id) === String(ids13.q))[0] || null;
  /* SPEC fix (parent, 2026-10-07): the engine REPORTS a silent track's row honestly (lufs null,
     applied false -- the card renders it "silent \u00b7 skipped") rather than omitting it; the
     intent asserted here is "reported but NOT applied", strength kept. */
  const rowS13 = rows13.filter((r) => String(r.id) === String(ids13.sil))[0] || null;
  const silentOk = !!(rowS13 && rowS13.lufs === null && rowS13.applied === false);
  const trkP = ((p13a.tracks || []).filter((t) => String(t.id) === String(ids13.p))[0] || {}).gainDb;
  const trkQ = ((p13a.tracks || []).filter((t) => String(t.id) === String(ids13.q))[0] || {}).gainDb;
  const deltaGap = (rowP && rowQ && typeof rowP.deltaDb === 'number' && typeof rowQ.deltaDb === 'number') ? Math.abs(rowQ.deltaDb - rowP.deltaDb) : null;
  const appliedOk = !!(rowP && rowQ && rowP.applied === true && rowQ.applied === true && typeof rowP.gainDb === 'number' && typeof rowQ.gainDb === 'number' && typeof trkP === 'number' && typeof trkQ === 'number' && Math.abs(trkP - rowP.gainDb) <= 1e-6 && Math.abs(trkQ - rowQ.gainDb) <= 1e-6);
  expected(p13a.ok === true && !!rowP && !!rowQ && deltaGap !== null && Math.abs(deltaGap - 20) <= 1 && appliedOk && silentOk,
    '13a auto-balance (target -18): two fixtures 20 dB apart -> deltas differ by ~20 dB (±1) · audible rows applied on the tracks · silent track REPORTED but NOT applied (lufs null, applied false)',
    J({ ok: p13a.ok, target: p13a.target, ms: p13a.ms, rows: rows13, tracks: p13a.tracks, deltaGap: deltaGap, appliedOk: appliedOk, silentOk: silentOk, rowS: rowS13, why: p13a.why }));

  const p13bR = await ev(`(() => {
    const W = window.__mixw;
    const out = {};
    W.clean();
    const a = W.addBuf('q005', { name: 'AB-Q5' });
    const b = W.addBuf('loud4', { name: 'AB-L4' });
    if (!a || a.ok !== true || !b || b.ok !== true) return { why: 'add refused' };
    out.ids = { a: a.track.id, b: b.track.id };
    const ab = avMixAutoBalance({ target: -18 });
    out.ok = !!(ab && ab.ok === true);
    out.rows = (ab && Array.isArray(ab.rows)) ? ab.rows.map((r) => ({ id: r.id, lufs: W.num(r.lufs), deltaDb: W.num(r.deltaDb), gainDb: W.num(r.gainDb) })) : null;
    out.tracks = (typeof avMixList === 'function') ? avMixList().map((t) => ({ id: t.id, gainDb: W.num(t.gainDb) })) : null;
    return out;
  })()`);
  const p13b = val(p13bR) || {};
  const rowsB = Array.isArray(p13b.rows) ? p13b.rows : [];
  const rowsBids = p13b.ids || {};
  const rA = rowsB.filter((r) => String(r.id) === String(rowsBids.a))[0] || null;
  const rB = rowsB.filter((r) => String(r.id) === String(rowsBids.b))[0] || null;
  const tA13 = ((p13b.tracks || []).filter((t) => String(t.id) === String(rowsBids.a))[0] || {}).gainDb;
  const tB13 = ((p13b.tracks || []).filter((t) => String(t.id) === String(rowsBids.b))[0] || {}).gainDb;
  expected(p13b.ok === true && rA && rB && typeof rA.deltaDb === 'number' && Math.abs(rA.deltaDb - 24) <= 1e-9 && typeof rB.deltaDb === 'number' && Math.abs(rB.deltaDb + 24) <= 1e-9 && typeof tA13 === 'number' && Math.abs(tA13 - 24) <= 1e-6 && typeof tB13 === 'number' && Math.abs(tB13 + 24) <= 1e-6,
    '13b auto-balance clamps: extremely quiet fixture -> delta +24 · extremely loud -> delta -24 (clamped, applied)',
    J({ rows: rowsB, tracks: p13b.tracks, why: p13b.why }));

  /* ── 14. A/B reference ── */
  console.log('── 14. A/B reference ──');
  const p14R = await ev(`(async () => {
    const W = window.__mixw;
    const out = {};
    W.clean();
    const a = W.addBuf('s05', { name: 'ABX' });
    if (!a || a.ok !== true) return { why: 'add refused' };
    const r = await W.render({ tailS: 0.25 });
    out.rok = !!(r && r.ok === true);
    if (!out.rok) { out.err = r && r.error; return out; }
    const n = r.l.length;
    const rl = new Float32Array(n), rr = new Float32Array(n);
    for (let i = 0; i < n; i++) { rl[i] = r.l[i] * 0.5; rr[i] = r.r[i] * 0.5; }
    const rev0 = (function () { try { return avMixState().rev; } catch (e) { return null; } })();
    const s = avMixSetRef({ l: rl, r: rr, sr: (typeof r.rate === 'number') ? r.rate : 48000 });
    out.setRef = { ok: !!(s && s.ok === true), kind: (s && s.ref) ? String(s.ref.kind || '') : null, seconds: W.num(s && s.ref && s.ref.seconds) };
    const c = avMixCompare();
    const rev1 = (function () { try { return avMixState().rev; } catch (e) { return null; } })();
    out.cmp = { ok: !!(c && c.ok === true), mixLufs: W.num(c && c.mix && c.mix.lufs), refLufs: W.num(c && c.ref && c.ref.lufs), gain: W.num(c && c.gainToMatchDb), mixDbtp: W.num(c && c.mix && c.mix.dbtp) };
    out.revSame = (rev0 === rev1);
    out.rcptLufs = W.num(r.lufs);
    return out;
  })()`);
  const p14 = val(p14R) || {};
  const sr14 = p14.setRef || {};
  const cmp14 = p14.cmp || {};
  const refDelta14 = (typeof cmp14.refLufs === 'number' && typeof cmp14.mixLufs === 'number') ? Math.abs(cmp14.refLufs - (cmp14.mixLufs - 6.02)) : null;
  expected(p14.rok === true && sr14.ok === true && typeof sr14.kind === 'string' && sr14.kind.length > 0 && typeof sr14.seconds === 'number' && sr14.seconds > 0 && cmp14.ok === true && typeof cmp14.gain === 'number' && Math.abs(cmp14.gain - 6.02) <= 0.15 && refDelta14 !== null && refDelta14 <= 0.15 && p14.revSame === true,
    '14 A/B: ref = mix x 0.5 -> gainToMatchDb +6.02 ±0.15 · ref.lufs ≈ mix.lufs - 6.02 · setRef/compare leave rev untouched',
    J({ setRef: sr14, cmp: cmp14, refDelta: refDelta14, revSame: p14.revSame, rcptLufs: p14.rcptLufs, why: p14.why }));

  /* ── 15. dither (pure) ── */
  console.log('── 15. dither ──');
  const p15R = await ev(`(() => {
    const W = window.__mixw;
    const out = { found: false };
    const M = window.__avMix;
    const P = M && M.pure;
    if (!P || typeof P.ditherApply !== 'function') return out;
    out.found = true;
    const F = W.fx.dth;
    const off = W.pair(P.ditherApply(F.l, F.r, 16, 'off', 1));
    const tp1 = W.pair(P.ditherApply(F.l, F.r, 16, 'tpdf', 123));
    const sh = W.pair(P.ditherApply(F.l, F.r, 16, 'shaped', 123));
    const tp2 = W.pair(P.ditherApply(F.l, F.r, 16, 'tpdf', 123));
    const tp3 = W.pair(P.ditherApply(F.l, F.r, 16, 'tpdf', 456));
    out.offExact = !!(off && W.eqArr(off[0], F.l) && W.eqArr(off[1], F.r));
    out.diffOT = (off && tp1) ? W.num(W.diff(tp1[0], off[0], 0, off[0].length)) : null;
    out.diffOTlsb = (out.diffOT != null) ? W.num(out.diffOT * 32768) : null;
    out.diffTS = (tp1 && sh) ? W.num(W.diff(sh[0], tp1[0], 0, tp1[0].length)) : null;
    out.sameSeedEq = (tp1 && tp2) ? (W.eqBytes(tp1[0], tp2[0]) && W.eqBytes(tp1[1], tp2[1])) : null;
    out.diffSeedNe = (tp1 && tp3) ? !(W.eqBytes(tp1[0], tp3[0]) && W.eqBytes(tp1[1], tp3[1])) : null;
    let f32 = W.pair(P.ditherApply(F.l, F.r, '32f', 'tpdf', 123));
    out.f32Mode = '32f-string';
    if (!f32) { f32 = W.pair(P.ditherApply(F.l, F.r, 32, 'tpdf', 123)); out.f32Mode = '32-number'; }
    out.f32Exact = f32 ? (W.eqArr(f32[0], F.l) && W.eqArr(f32[1], F.r)) : null;
    return out;
  })()`);
  const p15 = val(p15R) || {};
  expected(p15.found === true && p15.offExact === true && typeof p15.diffOT === 'number' && p15.diffOT > 0 && typeof p15.diffOTlsb === 'number' && p15.diffOTlsb <= 4 + 1e-6 && typeof p15.diffTS === 'number' && p15.diffTS > 0,
    '15a dither 16-bit: off == input · off vs tpdf differ with |diff| <= 4 LSB · tpdf vs shaped differ', J(p15));
  expected(p15.sameSeedEq === true && p15.diffSeedNe === true && p15.f32Exact === true,
    '15b dither seeds + 32f: same seed byte-identical · different seed differs · 32f ignores dither (input verbatim)',
    J({ sameSeedEq: p15.sameSeedEq, diffSeedNe: p15.diffSeedNe, f32Exact: p15.f32Exact, f32Mode: p15.f32Mode }));

  /* ── 16. export (+ dither receipts + stale refusal) ── */
  console.log('── 16. export ──');
  const p16R = await ev(`(async () => {
    const W = window.__mixw;
    const out = {};
    W.clean();
    const a = W.addBuf('s05', { name: 'EXP' });
    if (!a || a.ok !== true) return { why: 'add refused' };
    const r = await W.render({ tailS: 0.25 });
    out.rok = !!(r && r.ok === true);
    if (!out.rok) { out.err = r && r.error; return out; }
    W.last = r;
    const rec = (x) => ({ ok: !!(x && x.ok === true), name: (x && x.name) || null, bits: W.num(x && x.bits), frames: W.num(x && x.frames),
      bytes: W.num(x && x.bytes), hasBlob: !!(x && x.blob && typeof x.blob.arrayBuffer === 'function'),
      url: !!(x && typeof x.url === 'string' && x.url.indexOf('blob:') === 0),
      wavInfo: (x && x.wavInfo) ? { ok: x.wavInfo.ok === true, bits: W.num(x.wavInfo.bits), sr: W.num(x.wavInfo.sampleRate), ch: W.num(x.wavInfo.channels), frames: W.num(x.wavInfo.frames) } : null,
      dither: (x && x.dither) ? { mode: x.dither.mode, seed: W.num(x.dither.seed), applied: x.dither.applied === true } : null,
      err: (x && x.error) ? String(x.error) : null });
    const e16 = await avMixExport({ bits: 16, dither: 'auto' });
    out.e16 = rec(e16);
    if (e16 && e16.ok === true && e16.blob && typeof e16.blob.arrayBuffer === 'function') {
      try { const ab = await e16.blob.arrayBuffer(); out.decode16 = W.wavStats(ab); } catch (e) { out.decode16 = { ok: false, why: String((e && e.message) || e) }; }
    }
    out.eTpdf = rec(await avMixExport({ bits: 16, dither: 'tpdf', seed: 4242 }));
    out.eOff = rec(await avMixExport({ bits: 16, dither: 'off' }));
    out.e24 = rec(await avMixExport({ bits: 24, dither: 'auto' }));
    out.eDefSeed = rec(await avMixExport({ bits: 16, dither: 'tpdf' }));
    const m = avMixSetTrack(a.track.id, { gainDb: -3 });
    out.mut = !!(m && m.ok === true);
    out.stale = rec(await avMixExport({ bits: 16 }));
    const r2 = await W.render({ tailS: 0.25 });
    out.rok2 = !!(r2 && r2.ok === true);
    out.recovered = rec(await avMixExport({ bits: 16 }));
    out.framesRender = W.num(r.frames);
    return out;
  })()`);
  const p16 = val(p16R) || {};
  const e16 = p16.e16 || {}, eW = e16.wavInfo || {}, d16 = e16.dither || {}, dec16 = p16.decode16 || {};
  const eT = p16.eTpdf || {}, eO = p16.eOff || {}, e24 = p16.e24 || {}, eDS = p16.eDefSeed || {};
  expected(p16.rok === true && e16.ok === true && e16.name === 'anvil_mixdown.wav' && e16.bits === 16 && eW.ok === true && eW.bits === 16 && eW.sr === 48000 && eW.ch === 2 && eW.frames === p16.framesRender && Number(e16.bytes) > 44 && e16.hasBlob === true && e16.url === true && dec16.ok === true && Number(dec16.peak) > 0.05 && Number(dec16.nonzero) > 1000 &&
    (eT.dither && eT.dither.mode === 'tpdf' && eT.dither.seed === 4242 && eT.dither.applied === true) && (eO.dither && eO.dither.mode === 'off' && eO.dither.applied === false) && (e24.dither && e24.dither.applied === false) && (e24.wavInfo && e24.wavInfo.bits === 24) && (eDS.dither && typeof eDS.dither.seed === 'number' && isFinite(eDS.dither.seed)),
    '16a export 16-bit: wavInfo 16/48k/2ch · frames match · bytes > 44 · blob + blob: url · default name · decode peak > 0.05 · dither receipts {mode,seed,applied} (tpdf/off/24-auto/default-seed)',
    J({ e16: e16, decode: dec16, dithers: { tpdf: (eT.dither || null), off: (eO.dither || null), auto24: (e24.dither || null), defaultSeed: (eDS.dither || null) } }));
  const st16 = p16.stale || {};
  expected(p16.mut === true && st16.ok === false && typeof st16.err === 'string' && st16.err.length > 0 && p16.rok2 === true && (p16.recovered || {}).ok === true,
    '16b export stale-refusal: mutating a track -> export REFUSED (honest error) until re-render -> export ok again',
    J({ mut: p16.mut, stale: st16, rok2: p16.rok2, recovered: p16.recovered }));

  /* ── 17. e2e: engine + take ── */
  console.log('── 17. e2e engine + take ──');
  const p17R = await ev(`(async () => {
    const W = window.__mixw;
    const out = {};
    const R = W.rig;
    W.clean();
    if (!R.takeA) { out.why = 'take stash missing'; return out; }
    const eng = avMixAddTrack({ name: 'E2E-ENG', source: { type: 'engine', mask: [true, true, true, true], loops: 1, tailS: 0.5 } });
    const tak = avMixAddTrack({ name: 'E2E-TAKE', source: { type: 'take', id: R.takeA.id } });
    out.addOk = !!(eng && eng.ok === true && tak && tak.ok === true);
    if (!out.addOk) { out.add = { eng: (eng && eng.error) || null, tak: (tak && tak.error) || null }; return out; }
    const rAll = await W.render({ tailS: 0.5 });
    avMixSetTrack(eng.track.id, { mute: true });
    const rTake = await W.render({ tailS: 0.5 });
    avMixSetTrack(eng.track.id, { mute: false });
    avMixSetTrack(tak.track.id, { mute: true });
    const rEng = await W.render({ tailS: 0.5 });
    out.ok = { all: rAll && rAll.ok === true, take: rTake && rTake.ok === true, eng: rEng && rEng.ok === true };
    if (out.ok.all && out.ok.take && out.ok.eng) {
      out.eAll = W.num(W.energy2(rAll.l, rAll.r, 0, rAll.l.length));
      out.eTake = W.num(W.energy2(rTake.l, rTake.r, 0, rTake.l.length));
      out.eEng = W.num(W.energy2(rEng.l, rEng.r, 0, rEng.l.length));
      out.peakTake = W.num(W.peak2(rTake.l, rTake.r, 0, rTake.l.length));
      out.fracTake = W.num(W.nzFrac2(rTake.l, rTake.r, 1e-4));
      out.frames = W.num(rAll.frames);
    }
    return out;
  })()`);
  const p17 = val(p17R) || {};
  expected(p17.addOk === true && !!(p17.ok && p17.ok.all === true && p17.ok.take === true && p17.ok.eng === true) && typeof p17.eAll === 'number' && typeof p17.eTake === 'number' && typeof p17.eEng === 'number' && p17.eAll > p17.eTake + 1e-6 && p17.eAll > p17.eEng + 1e-6 && p17.eTake > 1e-4 && p17.eEng > 1e-4,
    '17a e2e: engine + take mix -> both contribute (each mute leg lowers the energy · both legs non-silent)',
    J({ eAll: p17.eAll, eTake: p17.eTake, eEng: p17.eEng, add: p17.add, why: p17.why }));
  expected(typeof p17.peakTake === 'number' && p17.peakTake > 0.05 && typeof p17.fracTake === 'number' && p17.fracTake < 0.9,
    '17b e2e take leg is pip-structured (fake-device BEEPS, never continuous audio): peak > 0.05 · nonzero fraction < 0.9',
    J({ peakTake: p17.peakTake, fracTake: p17.fracTake, frames: p17.frames }));

  /* ── 18. seal — screenshot, cleanup, errors, freeze ── */
  console.log('── 18. seal ──');
  await ev(`(() => { const el = document.getElementById('av-mix') || document.getElementById('av-mix-host'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); return true; })()`);
  await sleep(350);
  const rectR = await ev(`(() => { const el = document.getElementById('av-mix') || document.getElementById('av-mix-host'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }; })()`);
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
  expected(shotOk, '18a screenshot: renders/s3-mix-suite.png (the mix card, scale 2)', shotInfo);

  const cleanR = await ev(`(async () => {
    const out = { compsKilled: 0, takesKilled: 0, before: null, after: null };
    try { out.before = { tracks: avMixList().length, takes: avTakesList().length, comps: avCompList().length }; } catch (e) { }
    try { if (typeof avSeqStop === 'function') avSeqStop(); } catch (e) { }
    try { if (typeof avTakesAbort === 'function') avTakesAbort(); } catch (e) { }
    try { if (typeof avTakesArm === 'function') avTakesArm(false); } catch (e) { }
    try { avMixSetRef(null); } catch (e) { }
    try { avMixClear(); } catch (e) { }
    try {
      const cl = avCompList() || [];
      for (let i = 0; i < cl.length; i++) { try { if (avCompDelete(cl[i].id) === true) out.compsKilled++; } catch (e) { } }
    } catch (e) { }
    try {
      const tl = avTakesList() || [];
      for (let i = 0; i < tl.length; i++) { try { if (avTakesDelete(tl[i].id) === true) out.takesKilled++; } catch (e) { } }
    } catch (e) { }
    try { if (typeof avInputDisable === 'function') await avInputDisable(); } catch (e) { }
    await new Promise(function (res) { setTimeout(res, 300); });
    try {
      const st = (typeof avTakesState === 'function') ? (avTakesState() || {}) : {};
      const ms = (typeof avMixState === 'function') ? (avMixState() || {}) : {};
      out.after = {
        count: ms.count, ref: (ms.ref === null || typeof ms.ref === 'undefined') ? null : 'set',
        tracks: (typeof avMixList === 'function') ? avMixList().length : null,
        takes: avTakesList().length, comps: avCompList().length,
        recording: st.recording === true, armed: st.armed === true,
        playing: (typeof avSeqIsPlaying === 'function') ? avSeqIsPlaying() : null,
        inNode: (typeof avInputNode === 'function') ? !!avInputNode() : null,
      };
    } catch (e) { out.afterErr = String((e && e.message) || e); }
    return out;
  })()`);
  const cl18 = val(cleanR) || {};
  const clA = cl18.after || {};
  expected(clA.count === 0 && clA.tracks === 0 && clA.ref === null && clA.takes === 0 && clA.comps === 0 && clA.recording === false && clA.armed === false && clA.playing === false && (clA.inNode === false || clA.inNode === null) && Number(cl18.takesKilled) >= 2 && Number(cl18.compsKilled) >= 1,
    '18b page left clean: tracks cleared (count 0) · ref cleared (null) · takes + comps deleted · transport stopped · input disabled (node empty)',
    J(cl18));

  expected(errors.length === 0, '18c zero page errors (exceptions · Log errors · console.error)', 'page errors=' + errors.length + (errors.length ? ' | ' + errors.slice(0, 3).join(' | ') : ''));

  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after): ' + shaAfter);
  expected(shaAfter === shaBefore, '18d freeze: index.html sha256 before === after (unchanged by the run)', shaAfter);
  if (PIN) expected(shaBefore === PIN && shaAfter === PIN, '18e freeze: index.html sha256 = pinned', 'pinned ' + PIN.slice(0, 12) + '…');
  else note('EXPECT_SHA not pinned — after the S3 build, pass --sha <hex> or set the constant (never loosen)');

  console.log('');
  console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
  console.log('MIX-RESULT ' + JSON.stringify({ kind: 'anvil-cdp-mix', sha256Before: shaBefore, sha256After: shaAfter, pinned: PIN || null, passed: pass, failed: fail, verdict: fail ? 'fail' : 'pass' }));
  console.log(fail ? 'MIX FAILED' : 'MIX PASSED');
  try { ws.close(); } catch { /* done */ }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('mix harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    /* profile-scoped cleanup (LAW): kill ONLY processes whose command line carries OUR temp
       profile — matched by its unique basename, so the pattern needs no backslash escaping */
    const tag = path.basename(profile);
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
