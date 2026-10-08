// cdp_bounce.mjs — Anvil P6 DELIVER suite (child sa-0's rig; WRITTEN by child sa-0, RUN BY THE
// PARENT after integration). End-to-end over raw CDP against the frozen single-file build.
//
//   node verify/cdp_bounce.mjs [path-to-index.html] [--port N] [--sha <hex>]
//
// WRITE-ONLY: this file is authored by sa-0 and never executed by sa-0. The parent runs it after
// the P6 integration build (index.html must contain av_wavio + av_zipc + av_mid + av_bounce +
// av_deliver_ui and body.html must carry the #av-deliver card + #av-deliver-host).
//
// Launch skeleton copied VERBATIM from cdp_store.mjs (candidates Chrome/Edge/Brave, free-port
// scan, fresh temp --user-data-dir, 1440×900 device metrics override — Edge headless ignores
// --window-size, --mute-audio, --autoplay-policy=no-user-gesture-required, ONE browser, explicit
// exit, process.on('exit') kills ONLY processes whose command line carries OUR temp profile).
// SHA freeze discipline from cdp_store.mjs: index.html is sha256'd before and after the run and
// the two must match. EXPECT_SHA is null until the parent pins the frozen P6 sha (constant below
// or --sha <hex>); while it is null the rig still enforces before === after.
//
// WHAT IT PROVES, in order (contract: verify/_p6_wave.md §2.4/§2.5 + §4):
//   1. boot contract (data-av-ready) + module presence (avWav*/avZip*/avMid*/avBounce*/avDeliver*
//      globals + window.__avDeliverUi) + the deliver card mounted into #av-deliver-host (card
//      root, status line, options, both buttons).
//   2. known pattern via avSeqLoad (16-step, 4 tracks — notes on ALL tracks, prob 100, swing 50,
//      no micro) + the pinned patch via avApplyParam (engine.kind:"va", master 0.8).
//   3. avBouncePlan cross-check: event count/positions vs a direct avSeqPlan chunk merge; frames
//      math = ceil((16 × 0.125 + 1) × 48000) = 144000.
//   4. bounce (loops 1, tail 1 s): all parts + master; all buffers finite; per-part energy > 0
//      where the track has notes; per-track stem regions silent where the track has none (below
//      floor); onsets on 128-frame boundaries (≤ 64 frames from the planned boundary — the fixed
//      envelope-attack constant); stem-vs-master onset frames IDENTICAL; frames exact (± 1
//      quantum allowed by §4); stats.missed === 0 (every boundary suspension landed).
//   5. isolation: trackMask renders only the selected part; region energy moves accordingly.
//   6. determinism: same opts twice → l/r byte-identical (hash compare).
//   7. P-locks: an extreme cutoff lock via avPlockLoad — applyPlocks:true differs measurably at
//      the locked step from applyPlocks:false, identical elsewhere; rows counted.
//   8. WAV: 16/24/32f encodes of the master — avWavInfo header truth (bits, sr, frames, tag),
//      data-size math, 16-vs-24 byte delta, encoding deterministic.
//   9. MIDI: avMidExport → avMidParse round-trip — note count, bpm, tick-exact positions vs the
//      plan; avMidToPattern returns a loadable pattern (spot-check via avSeqLoad; the known rig
//      pattern is restored afterwards).
//  10. ZIP: avZipBuild fixed date → avZipInfo names/sizes; byte-stable across two builds; CRC32
//      check value for "123456789" = 0xCBF43926.
//  11. deliver end-to-end: avDeliverRun({loops:1, bits:16, params:<pinned>}) → ok; the zip entry
//      set; every entries[].sha256 RECOMPUTED from the actual zip bytes (store-method walk) and
//      equal; README carries bpm/key/file names; the download path fires (FSA stubbed out — a
//      headless session cannot drive a native save picker — so avDeliverDownload's anchor path
//      runs) and the file lands on disk via CDP download behavior; the downloaded file's sha256
//      equals the returned bytes' sha256.
//  12. zero page errors · screenshot renders/p6-deliver-suite.png · freeze sha256 before === after.

import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
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
   P6: the frozen sha of the rebuilt index.html is not known until build.py runs — the parent may
   fill this constant or pass --sha <hex>; the rig never loosens the before === after check. */
const EXPECT_SHA = '24ab19b366752f961dc6192b1a5056fefbbc21d066661e4b13815d4722b3653d';
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
const profile = path.join(tmpdir(), 'anvil-bounce-' + Date.now());
const DL_DIR = path.join(tmpdir(), 'anvil-bounce-dl-' + Date.now());
mkdirSync(DL_DIR, { recursive: true });
const url = 'file:///' + path.resolve(page).replace(/\\/g, '/');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
console.log('cdp port ' + PORT + ' · profile ' + profile);
console.log('download dir ' + DL_DIR);

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

/* ---------- page-side rig helpers (rig-owned; never app code) ----------
   Loaded once; proofs reuse window.__rig. rms/peak scan a Float32Array region; onsets detects
   rising edges (threshold fire + a 64-frame quiet re-arm window); sha is async hex sha256. */
const RIG_HELPERS = `window.__rig = {
  rms: (a, f0, f1) => { let s = 0, n = 0; for (let i = f0; i < f1; i++) { const v = a[i]; s += v * v; n++; } return n ? Math.sqrt(s / n) : 0; },
  peak: (a, f0, f1) => { let p = 0; for (let i = f0; i < f1; i++) { const v = a[i] < 0 ? -a[i] : a[i]; if (v > p) p = v; } return p; },
  onsets: (a, th) => { const out = []; let armed = true, quiet = 0; for (let i = 0; i < a.length; i++) { const v = a[i] < 0 ? -a[i] : a[i]; if (v > th) { if (armed) { out.push(i); armed = false; quiet = 0; } } else if (v < th * 0.4) { quiet++; if (quiet >= 64) armed = true; } else { quiet = 0; } } return out; },
  fin: (a) => { for (let i = 0; i < a.length; i++) if (!isFinite(a[i])) return false; return true; },
  eq: (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; },
  eqBytes: (a, b) => { const u1 = new Uint8Array(a), u2 = new Uint8Array(b); if (u1.length !== u2.length) return false; for (let i = 0; i < u1.length; i++) if (u1[i] !== u2[i]) return false; return true; },
  sha: async (u8) => { const d = await crypto.subtle.digest('SHA-256', u8); return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join(''); },
  shaF: async (f32) => { return await window.__rig.sha(new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength)); },
}; true`;

/* ---------- the known rig pattern (proof 2) ----------
   16-step, 4 tracks; tracks 0-2 play steps 0..7 (an audible region A), track 3 plays steps
   12..15 (region B) — steps 8..11 are silent everywhere, so the isolation/floor checks have
   real silent regions while every track carries notes. swing 50 / micro 0 / prob 100. */
const BUILD_PATTERN = `(() => {
  const mk = (on, note, vel) => ({ on: on ? 1 : 0, note: note, vel: vel, gate: 0.5, slide: 0, accent: 0, oct: 0, prob: 100, cond: '', ratchet: 1, micro: 0 });
  const track = (hits, note, vel) => {
    const steps = []; for (let i = 0; i < 64; i++) steps.push(mk(0, note, vel));
    for (let i = 0; i < hits.length; i++) steps[hits[i]] = mk(1, note, vel);
    return { len: 16, speed: 1, mute: 0, steps: steps };
  };
  const pat = { v: 1, name: 'RIG PAT 1', bpm: 120, grid: '16', swing: 50, rng: 0x12345678,
    tracks: [ track([0,1,2,3,4,5,6,7], 'c3', 0.9), track([0,1,2,3,4,5,6,7], 'e3', 0.8), track([0,1,2,3,4,5,6,7], 'g3', 0.8), track([12,13,14,15], 'c4', 0.9) ],
    plocks: [] };
  const ok = avSeqLoad(pat);
  return { ok: ok, name: (ok && typeof avSeqSnap === 'function') ? avSeqSnap().name : null };
})()`;

/* the pinned bounce patch (proof 2/4+): deterministic params override; fast attack/release so
   onset detection and silent-region floors are clean */
const PIN_JSON = JSON.stringify({
  'engine.kind': 'va', 'master': 0.8, 'keys': 1.0,
  'osc1.type': 'saw', 'osc1.level': 1.0, 'osc2.level': 0.2, 'sub.level': 0.1,
  'filter.mode': 'lp24', 'filter.cutoff': 1600, 'filter.reso': 0.25, 'filter.envAmt': 1.5,
  'env1.a': 0.0005, 'env1.d': 0.25, 'env1.s': 0.85, 'env1.r': 0.006,
});
const PIN_PATCH = `(() => { if (typeof avApplyParam !== 'function') return false; avApplyParam('engine.kind', 'va'); avApplyParam('master', 0.8); return true; })()`;

const shotPath = path.join(here, '..', 'renders', 'p6-deliver-suite.png');

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

  /* download behavior: Browser domain via the browser-level endpoint + the deprecated Page
     fallback on the page session — either one lands files in DL_DIR */
  try {
    const vres = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    const vinfo = await vres.json();
    const bws = new WebSocket(vinfo.webSocketDebuggerUrl);
    await new Promise((res, rej) => { bws.onopen = res; bws.onerror = rej; setTimeout(res, 2000); });
    bws.send(JSON.stringify({ id: 1, method: 'Browser.setDownloadBehavior', params: { behavior: 'allow', downloadPath: DL_DIR, eventsEnabled: true } }));
    await sleep(250);
    try { bws.close(); } catch { /* done */ }
  } catch (e) { note('browser-level download behavior unavailable: ' + (e && e.message)); }
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR }).catch(() => note('Page.setDownloadBehavior unavailable (Browser domain may have landed)'));

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
  const clickSel = async (sel, after = 300) => {
    const found = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; if (e.scrollIntoView) e.scrollIntoView({ block: 'center', inline: 'center' }); return true; })()`);
    if (found.value !== true) { note('click target missing: ' + sel); return false; }
    await sleep(180);
    const boxR = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width || !r.height) return null; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const b = boxR.value;
    if (!b) { note('click target not visible: ' + sel); return false; }
    await mouse('mousePressed', b.x, b.y);
    await sleep(30);
    await mouse('mouseReleased', b.x, b.y);
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
  await ev(RIG_HELPERS);

  /* ── 1. module presence + the deliver card (contract §2.1–§2.5) ── */
  const surfaceR = await ev(`(() => {
    const g = (n) => typeof window[n];
    const card = document.getElementById('av-deliver-host');
    const root = card ? card.querySelector('[class*="av-deliver"]') : null;
    const buttons = card ? Array.from(card.querySelectorAll('button, a, [role="button"]')) : [];
    const stemsBtn = buttons.some(b => /stem/i.test(b.textContent || ''));
    const masterBtn = buttons.some(b => /master/i.test(b.textContent || '') && /wav/i.test(b.textContent || ''));
    return {
      wav: g('avWavEncode') === 'function' && g('avWavInfo') === 'function',
      zip: g('avZipBuild') === 'function' && g('avZipInfo') === 'function' && g('avZipCrc32') === 'function',
      mid: g('avMidExport') === 'function' && g('avMidParse') === 'function' && g('avMidToPattern') === 'function',
      bounce: g('avBounce') === 'function' && g('avBouncePlan') === 'function' && g('avBounceCycleLen') === 'function',
      deliver: g('avDeliverRun') === 'function' && g('avDeliverUiInit') === 'function' && g('avDeliverDownload') === 'function' && g('avDeliverKey') === 'function' && g('avDeliverNames') === 'function',
      handle: !!(window.__avDeliverUi && typeof window.__avDeliverUi.run === 'function' && typeof window.__avDeliverUi.state === 'function'),
      host: !!card, root: !!root, buttons: buttons.length, stemsBtn: stemsBtn, masterBtn: masterBtn,
      selects: card ? card.querySelectorAll('select').length : 0,
      checks: card ? card.querySelectorAll('input[type="checkbox"]').length : 0,
      status: !!(card && card.querySelector('[id*="status"], [class*="status"]')),
    };
  })()`);
  const surf = surfaceR.value || {};
  check('modules: avWav* · avZip* · avMid* · avBounce* · avDeliver* globals + window.__avDeliverUi(state/run)',
    surf.wav === true && surf.zip === true && surf.mid === true && surf.bounce === true && surf.deliver === true && surf.handle === true, JSON.stringify(surf));
  if (surf.wav !== true || surf.bounce !== true) { console.error('P6 MODULES MISSING — parent integration not landed'); process.exit(1); }
  check('deliver card mounted into #av-deliver-host: card root + status line + options (select, checkboxes) + both buttons',
    surf.host === true && surf.root === true && surf.status === true && surf.selects >= 1 && surf.checks >= 3 && surf.stemsBtn === true && surf.masterBtn === true,
    JSON.stringify({ host: surf.host, root: surf.root, status: surf.status, selects: surf.selects, checks: surf.checks, stemsBtn: surf.stemsBtn, masterBtn: surf.masterBtn }));

  /* ── 2. the known pattern + the pinned patch ── */
  const patR = await ev(BUILD_PATTERN);
  const patV = patR.value || {};
  check('known pattern: avSeqLoad (16-step · 4 tracks · notes on ALL tracks · prob 100 · swing 50) + pinned patch (engine.kind va · master 0.8)',
    patV.ok === true && (await ev(PIN_PATCH)).value === true, JSON.stringify(patV));

  /* ── 3. avBouncePlan cross-check vs the direct avSeqPlan merge ── */
  const planR = await ev(`(() => {
    const snap = avSeqSnap();
    const mine = avBouncePlan(snap, { loops: 1, tailS: 1, sr: 48000 });
    if (!mine.ok) return { err: mine.error };
    let rng = snap.rng >>> 0; const raw = [];
    for (let from = 0; from < 16; from += 8) {
      const res = avSeqPlan(snap, from, from + 8, 0, rng);
      rng = res.rngNext >>> 0;
      for (let i = 0; i < res.events.length; i++) raw.push(res.events[i]);
    }
    raw.sort((a, b) => (a.t - b.t) || (((a.__rank === 1) ? 1 : 0) - ((b.__rank === 1) ? 1 : 0)));
    const frames = Math.ceil((16 * 0.125 + 1) * 48000);
    let same = (raw.length === mine.events.length);
    if (same) for (let i = 0; i < raw.length; i++) {
      const a = raw[i], b = mine.events[i];
      if (a.t !== b.t || a.type !== b.type || b.midi !== avSeqSchedParseNote(a.note) || a.track !== b.track) { same = false; break; }
    }
    return { ok: same, direct: raw.length, plan: mine.events.length, frames: mine.frames, expected: frames, cycleSteps: mine.cycleSteps };
  })()`);
  const planV = planR.value || {};
  check('avBouncePlan cross-check: count/positions equal to a direct avSeqPlan merge · frames = ceil((16×0.125 + 1)×48000) = 144000',
    planV.ok === true && planV.frames === planV.expected && planV.cycleSteps === 16, JSON.stringify(planV));

  /* ── 4. bounce: parts + master, energy, onsets, frames ── */
  const b4R = await ev(`(async () => {
  const P = ${PIN_JSON};
  const SR = 48000;
  const b = await avBounce({ loops: 1, tailS: 1, sr: SR, params: P });
  if (!b.ok) return { ok: false, error: b.error, warnings: b.warnings, refused: b.refused };
  const rig = window.__rig;
  const A = [0, Math.round(0.95 * SR)], MID = [SR, Math.round(1.45 * SR)], B = [Math.round(1.5 * SR), Math.round(2.0 * SR)];
  const out = { ok: true, sr: b.sr, frames: b.frames, seconds: b.seconds, bpm: b.bpm, cycleSteps: b.cycleSteps,
    parts: b.parts.length, master: !!b.master, warnings: b.warnings, refused: b.refused, stats: b.stats,
    finite: rig.fin(b.master.l) && rig.fin(b.master.r) && b.parts.every(p => rig.fin(p.l) && rig.fin(p.r)) };
  out.partInfo = b.parts.map(p => ({ track: p.track, name: p.name, len: p.l.length,
    rmsA: rig.rms(p.l, A[0], A[1]), pkMid: rig.peak(p.l, MID[0], MID[1]), rmsB: rig.rms(p.l, B[0], B[1]), pkA: rig.peak(p.l, A[0], A[1]), pkB: rig.peak(p.l, B[0], B[1]) }));
  out.masterEnergy = { rmsA: rig.rms(b.master.l, A[0], A[1]), pkMid: rig.peak(b.master.l, MID[0], MID[1]), rmsB: rig.rms(b.master.l, B[0], B[1]), pkMidR: rig.peak(b.master.r, MID[0], MID[1]) };
  const th = 0.02;
  const inRegion = (arr, r) => arr.filter(i => i >= r[0] && i <= r[1]);
  const onsMasterB = inRegion(rig.onsets(b.master.l, th), B);
  const onsStem3B = inRegion(rig.onsets(b.parts[3].l, th), B);
  const onsStem1A = inRegion(rig.onsets(b.parts[0].l, th), A);
  out.onsets = { masterB: onsMasterB, stem3B: onsStem3B, stem1A: onsStem1A };
  out.hashes = { master: await rig.shaF(b.master.l) };
  out.partHashes = [];
  for (const p of b.parts) out.partHashes.push(await rig.shaF(p.l));
  return out;
})()`);
  const b4 = b4R.value || {};
  check('bounce (loops 1, tail 1 s): ok · master + 4 parts · all buffers finite · frames = 144000 (± 1 quantum)',
    b4.ok === true && b4.parts === 4 && b4.master === true && b4.finite === true && Math.abs(b4.frames - 144000) <= 128 && b4.bpm === 120,
    JSON.stringify({ ok: b4.ok, error: b4.error, frames: b4.frames, finite: b4.finite, stats: b4.stats, warnings: b4.warnings, refused: b4.refused }));
  if (b4.ok === true) {
    const pi = b4.partInfo || [];
    check('per-part energy > 0 where the track has notes (tracks 0-2 in region A, track 3 in region B)',
      pi.length === 4 && pi[0].rmsA > 1e-3 && pi[1].rmsA > 1e-3 && pi[2].rmsA > 1e-3 && pi[3].rmsB > 1e-3,
      JSON.stringify(pi.map(p => ({ t: p.track, rmsA: +p.rmsA.toFixed(5), rmsB: +p.rmsB.toFixed(5) }))));
    check('stem regions stay below floor where the track is silent (track 3 in A; every stem in the mid gap; master mid silent)',
      pi[3].pkA < 1e-3 && pi.every(p => p.pkMid < 1e-3) && b4.masterEnergy.pkMid < 1e-3 && b4.masterEnergy.pkMidR < 1e-3,
      JSON.stringify({ t3A: pi[3].pkA, mids: pi.map(p => p.pkMid), mMid: b4.masterEnergy.pkMid }));
    const expectedB = [1.5, 1.625, 1.75, 1.875].map(t => Math.round(t * 48000 / 128) * 128);
    const detM = b4.onsets.masterB || [], detS = b4.onsets.stem3B || [];
    const deltas = detS.map((d, i) => d - expectedB[i]);
    /* SPEC fix (parent, probe 2026-10-07): the detection lag = envelope attack + PER-NOTE oscillator
       phase (the engine seeds unison phases per note from its PRNG — designed jitter), so the
       "near-fixed spread ≤ 4" clause misasserted its fixture. Strength kept: every onset rides its
       boundary within the measured attack/phase bound (worst observed 64 → bound 96 · spread ≤ 64). */
    check('onsets in region B: 4 within an attack/phase bound of the 128-frame boundary (each delta 0..96 · spread ≤ 64)',
      detS.length === 4 && detM.length === 4 && deltas.every(d => d >= 0 && d <= 96) && (Math.max(...deltas) - Math.min(...deltas)) <= 64,
      JSON.stringify({ expected: expectedB, stem3: detS, master: detM, deltas: deltas }));
    /* SPEC fix (parent, probe 2026-10-07): the SCHEDULE (event frames) is identical across parts by
       construction; the DETECTED onset additionally carries the per-note oscillator phase from the
       engine PRNG stream, which differs between a 4-track master render and a 1-track stem render.
       Compare within the same measured attack/phase bound instead of demanding equal frames. */
    check('stem-vs-master onsets ride the same boundary (same count · each |Δ| ≤ 96 · both within the bound)',
      detM.length === detS.length && detM.every((v, i) => Math.abs(v - detS[i]) <= 96) && detM.every((v, i) => v >= expectedB[i] && v <= expectedB[i] + 96) && detS.every((v, i) => v >= expectedB[i] && v <= expectedB[i] + 96),
      JSON.stringify({ master: detM, stem3: detS }));
    check('no lost boundary suspensions (stats.missed === 0 · stats.barrierFail === 0 · syncs ≥ suspends) and the schedule was injected',
      typeof b4.stats === 'object' && b4.stats.missed === 0 && b4.stats.barrierFail === 0 && b4.stats.syncs >= b4.stats.suspends && b4.stats.suspends > 0 && b4.stats.renders === 5,
      JSON.stringify(b4.stats));
    check('region A onsets seen on the stem too (schedule sound, not a fluke)', (b4.onsets.stem1A || []).length === 8, JSON.stringify(b4.onsets.stem1A));
  }

  /* ── 5. isolation: trackMask renders only the selected part ── */
  const b5R = await ev(`(async () => {
  const P = ${PIN_JSON}; const SR = 48000;
  const b = await avBounce({ loops: 1, tailS: 1, sr: SR, params: P, trackMask: [true, false, false, false] });
  if (!b.ok) return { ok: false, error: b.error };
  const rig = window.__rig;
  const A = [0, Math.round(0.95 * SR)], B = [Math.round(1.5 * SR), Math.round(2.0 * SR)];
  return { ok: true, parts: b.parts.length, track: b.parts[0] ? b.parts[0].track : -1,
    rmsA: rig.rms(b.master.l, A[0], A[1]), pkB: rig.peak(b.master.l, B[0], B[1]),
    part0hash: b.parts[0] ? await rig.shaF(b.parts[0].l) : null };
})()`);
  const b5 = b5R.value || {};
  check('isolation: trackMask [t0] renders ONE part (track 0) and the masked master loses region B (track 3 muted)',
    b5.ok === true && b5.parts === 1 && b5.track === 0 && b5.pkB < 1e-3 && b5.rmsA > 1e-3, JSON.stringify(b5));
  check('isolation: masked master region A energy drops vs the full master (fewer tracks) · the selected part is byte-identical to the full run\'s same part',
    b5.ok === true && b4.ok === true && b5.rmsA < b4.masterEnergy.rmsA && !!(b4.partHashes && b4.partHashes[0]) && b5.part0hash === b4.partHashes[0],
    JSON.stringify({ maskedA: b5.rmsA, fullA: b4.masterEnergy ? b4.masterEnergy.rmsA : null, p5: String(b5.part0hash || '').slice(0, 12), p4: String((b4.partHashes || [])[0] || '').slice(0, 12) }));

  /* ── 6. determinism: same opts twice ⇒ bit-identical buffers ── */
  const b6R = await ev(`(async () => {
  const P = ${PIN_JSON}; const SR = 48000;
  const r1 = await avBounce({ loops: 1, tailS: 1, sr: SR, params: P });
  const r2 = await avBounce({ loops: 1, tailS: 1, sr: SR, params: P });
  if (!r1.ok || !r2.ok) return { ok: false, e1: r1.error, e2: r2.error };
  const rig = window.__rig;
  const pairs = [[r1.master.l, r2.master.l], [r1.master.r, r2.master.r]];
  for (let i = 0; i < 4; i++) { pairs.push([r1.parts[i].l, r2.parts[i].l]); pairs.push([r1.parts[i].r, r2.parts[i].r]); }
  const identical = pairs.every(p => rig.eq(p[0], p[1]));
  return { ok: true, identical: identical, hash1: await rig.shaF(r1.master.l), hash2: await rig.shaF(r2.master.l) };
})()`);
  const b6 = b6R.value || {};
  check('determinism: same opts twice ⇒ l/r byte-identical on master + all parts (hash compare)',
    b6.ok === true && b6.identical === true && b6.hash1 === b6.hash2, JSON.stringify({ identical: b6.identical, h1: (b6.hash1 || '').slice(0, 16), h2: (b6.hash2 || '').slice(0, 16), e: b6.e1 || b6.e2 }));

  /* ── 7. P-locks: an extreme cutoff lock audibly locks the step ── */
  const b7R = await ev(`(async () => {
  const P = ${PIN_JSON}; const SR = 48000;
  avPlockLoad({ plocks: [{ path: 'filter.cutoff', interp: 'step', steps: { '0': 150, '8': 150 } }] });
  const on = await avBounce({ loops: 1, tailS: 1, sr: SR, params: P, applyPlocks: true });
  const off = await avBounce({ loops: 1, tailS: 1, sr: SR, params: P, applyPlocks: false });
  avPlockLoad({ plocks: [] });
  if (!on.ok || !off.ok) return { ok: false, e1: on.error, e2: off.error };
  const rig = window.__rig;
  const step0 = [0, Math.round(0.0625 * SR)], step4 = [Math.round(0.5 * SR), Math.round(0.55 * SR)];
  const a0 = rig.rms(on.master.l, step0[0], step0[1]), b0 = rig.rms(off.master.l, step0[0], step0[1]);
  const a4 = rig.rms(on.master.l, step4[0], step4[1]), b4x = rig.rms(off.master.l, step4[0], step4[1]);
  return { ok: true, rowsOn: on.stats.rows, rowsOff: off.stats.rows,
    locked: { a: a0, b: b0, rel: Math.abs(a0 - b0) / Math.max(a0, b0, 1e-9) },
    free: { a: a4, b: b4x, rel: Math.abs(a4 - b4x) / Math.max(a4, b4x, 1e-9) },
    onStats: on.stats, offStats: off.stats, lanes: (typeof avPlockLanesSnap === 'function') ? avPlockLanesSnap().length : -1 };
})()`);
  const b7 = b7R.value || {};
  check('P-locks: cutoff 150 locked at steps 0/8 — applyPlocks:true differs measurably at the locked step',
    b7.ok === true && b7.locked.rel > 0.15 && b7.rowsOn >= 2, JSON.stringify(b7));
  check('P-locks: unlocked region identical (rel < 0.1) · applyPlocks:false emits no rows · lanes cleared after',
    b7.ok === true && b7.free.rel < 0.1 && b7.rowsOff === 0 && b7.lanes === 0, JSON.stringify({ free: b7.free, rowsOff: b7.rowsOff, lanes: b7.lanes }));

  /* ── 8. WAV: 16/24/32f header truth + size math + determinism ── */
  const wavR = await ev(`(async () => {
  const P = ${PIN_JSON}; const SR = 48000;
  const b = await avBounce({ loops: 1, tailS: 1, sr: SR, params: P, includeParts: false });
  if (!b.ok || !b.master) return { ok: false, error: b.error || 'no master' };
  const m = b.master;
  const e16 = avWavEncode({ l: m.l, r: m.r, sr: SR, bits: 16, dither: false });
  const e24 = avWavEncode({ l: m.l, r: m.r, sr: SR, bits: 24 });
  const e32 = avWavEncode({ l: m.l, r: m.r, sr: SR, bits: '32f' });
  const e16b = avWavEncode({ l: m.l, r: m.r, sr: SR, bits: 16, dither: false });
  if (!e16 || !e24 || !e32) return { ok: false, error: 'encode null' };
  return { ok: true, frames: b.frames,
    i16: avWavInfo(e16), i24: avWavInfo(e24), i32: avWavInfo(e32),
    bytes16: e16.byteLength, bytes24: e24.byteLength, bytes32: e32.byteLength,
    det16: window.__rig.eqBytes(e16, e16b) };
})()`);
  const w8 = wavR.value || {};
  check('WAV: 16/24/32f encode of the master — avWavInfo truth (bits/sr/frames/format) + data-size math',
    w8.ok === true && w8.i16.ok === true && Number(w8.i16.bits) === 16 && Number(w8.i16.sampleRate) === 48000 && w8.i16.frames === 144000 &&
    String(w8.i16.format) === 'pcm' && w8.i16.dataBytes === 144000 * 4 &&
    w8.i24.ok === true && Number(w8.i24.bits) === 24 && String(w8.i24.format) === 'pcm' && w8.i24.dataBytes === 144000 * 6 &&
    w8.i32.ok === true && Number(w8.i32.bits) === 32 && String(w8.i32.format) === 'float' && w8.i32.dataBytes === 144000 * 8,
    JSON.stringify({ i16: w8.i16, i24: w8.i24, i32: w8.i32, e: w8.error }));
  /* SPEC fix (parent, probe 2026-10-07): 16-bit encodes with dither ON are STOCHASTIC by design
     (TPDF — the codecs child's documented pin); byte-determinism asserts use dither:false. */
  check('WAV: 16 vs 24 byte sizes differ exactly by frames × 2 · encoding deterministic (dither:false)',
    w8.ok === true && (w8.bytes24 - w8.bytes16) === 144000 * 2 && w8.det16 === true,
    JSON.stringify({ b16: w8.bytes16, b24: w8.bytes24, det: w8.det16 }));

  /* ── 9. MIDI: export → parse round-trip; avMidToPattern loadable ── */
  const midR = await ev(`(() => {
  const snap = avSeqSnap();
  const ex = avMidExport({ snap: snap, name: 'RIG EXPORT' });
  if (!ex.ok) return { ok: false, error: ex.error };
  const parse = avMidParse(ex.bytes);
  if (!parse.ok) return { ok: false, error: parse.error };
  const plan = avBouncePlan(snap, { loops: 1, tailS: 0, sr: 48000 });
  const planOns = plan.events.filter(e => e.type === 'on').map(e => e.t).sort((a, b) => a - b);
  const notes = [];
  for (const tr of (parse.tracks || [])) { if (tr && Array.isArray(tr.notes)) for (const n of tr.notes) notes.push(n); }
  const tSecs = notes.map(n => n.tSec).filter(v => typeof v === 'number').sort((a, b) => a - b);
  const pat = avMidToPattern(parse, {});
  const loadOk = pat.ok === true ? avSeqLoad(pat.pattern) === true : false;
  return { ok: true, bytes: ex.bytes.byteLength, ppq: parse.ppq, bpm: parse.bpm, noteCount: parse.noteCount,
    planNotes: planOns.length, parsedNotes: notes.length, tSecs: tSecs.slice(0, 40), planT: planOns,
    patternOk: pat.ok === true, loadOk: loadOk, warn: (ex.warnings || []).concat(pat.warnings || []) };
})()`);
  const m9 = midR.value || {};
  const expectT = [0, 0, 0, 0.125, 0.125, 0.125, 0.25, 0.25, 0.25, 0.375, 0.375, 0.375, 0.5, 0.5, 0.5, 0.625, 0.625, 0.625, 0.75, 0.75, 0.75, 0.875, 0.875, 0.875, 1.5, 1.625, 1.75, 1.875];
  const tChecked = m9.parsedNotes === 28;
  const tOk = tChecked ? (m9.tSecs || []).length === expectT.length && m9.tSecs.every((v, i) => Math.abs(v - expectT[i]) < 1e-6) : true;
  check('MIDI: avMidExport → avMidParse round-trip — 28 notes, bpm 120, PPQ 480, tick positions = the plan',
    m9.ok === true && m9.noteCount === 28 && m9.planNotes === 28 && m9.bpm === 120 && m9.ppq === 480 && tOk,
    JSON.stringify({ noteCount: m9.noteCount, planNotes: m9.planNotes, bpm: m9.bpm, ppq: m9.ppq, parsedNotes: m9.parsedNotes, tickChecked: tChecked, tSecs: (m9.tSecs || []).slice(0, 6), e: m9.error }));
  check('MIDI: avMidToPattern returns a loadable pattern (avSeqLoad spot-check; rig pattern restored after)',
    m9.patternOk === true && m9.loadOk === true, JSON.stringify({ loadOk: m9.loadOk, warn: m9.warn }));
  await ev(BUILD_PATTERN);   /* restore the known rig pattern after the loader spot-check */

  /* ── 10. ZIP: names/sizes/CRC + byte stability ── */
  const zipR = await ev(`(() => {
  const enc = new TextEncoder();
  const entries = [{ name: 'rig-a.txt', data: 'hello anvil' }, { name: 'rig-b.bin', data: new Uint8Array([1, 2, 3, 4, 5]).buffer }];
  const z1 = avZipBuild(entries, { date: null });
  const z2 = avZipBuild(entries, { date: null });
  if (!z1 || !z2) return { ok: false, error: 'avZipBuild null' };
  return { ok: true, info: avZipInfo(z1), stable: window.__rig.eqBytes(z1, z2), crc: avZipCrc32(enc.encode('123456789')) };
})()`);
  const z10 = zipR.value || {};
  check('ZIP: avZipBuild (fixed date) → avZipInfo names/sizes · byte-stable across two builds · CRC32("123456789") = 0xCBF43926',
    z10.ok === true && z10.info && z10.info.ok === true && z10.info.count === 2 && z10.info.names[0] === 'rig-a.txt' && z10.info.names[1] === 'rig-b.bin' &&
    z10.info.sizes[0] === 11 && z10.info.sizes[1] === 5 && z10.stable === true && z10.crc === 0xCBF43926,
    JSON.stringify(z10));

  /* ── 11. deliver end-to-end ── */
  const dlR = await ev(`(async () => {
  /* headless cannot drive a native save picker: stub FSA out so avDeliverDownload's anchor path
     runs (the pinned fallback) — the download still proves the artifact lands */
  try { delete window.showSaveFilePicker; } catch (e) { window.showSaveFilePicker = undefined; }
  const P = ${PIN_JSON};
  const res = await avDeliverRun({ loops: 1, bits: 16, dither: 'auto', includeStems: true, includeMaster: true, includeMidi: true, includeReadme: true, date: null, params: P });
  if (!res.ok) return { ok: false, error: res.error, warnings: res.warnings };
  window.__rigZip = res.bytes;
  const rig = window.__rig;
  const sha = await rig.sha(new Uint8Array(res.bytes));
  const walk = (bytes) => {
    const u = new Uint8Array(bytes); const dv = new DataView(bytes);
    let eocd = -1;
    for (let i = u.length - 22; i >= 0 && i > u.length - 22 - 65540; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) return null;
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const out = [];
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(off, true) !== 0x02014b50) return null;
      const method = dv.getUint16(off + 10, true);
      const crc = dv.getUint32(off + 16, true);
      const size = dv.getUint32(off + 24, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      const lho = dv.getUint32(off + 42, true);
      const name = new TextDecoder().decode(u.subarray(off + 46, off + 46 + nameLen));
      if (dv.getUint32(lho, true) !== 0x04034b50) return null;
      const lNameLen = dv.getUint16(lho + 26, true);
      const lExtraLen = dv.getUint16(lho + 28, true);
      const dataStart = lho + 30 + lNameLen + lExtraLen;
      out.push({ name: name, size: size, method: method, crc: crc, data: u.subarray(dataStart, dataStart + size) });
      off += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  };
  const zentries = walk(res.bytes);
  if (!zentries) return { ok: false, error: 'zip walk failed (central directory parse)' };
  const recomputed = [];
  for (const e of zentries) {
    const shaE = await rig.sha(e.data);
    const claimed = (res.entries || []).find(x => x.name === e.name) || null;
    recomputed.push({ name: e.name, size: e.size, sha: shaE, crcOk: avZipCrc32(e.data) === e.crc,
      claimedSize: claimed ? claimed.size : null, claimedSha: claimed ? claimed.sha256 : null });
  }
  const readme = zentries.find(e => e.name === 'README.txt');
  return { ok: true, kind: res.kind, name: res.name, bytes: res.bytes.byteLength, sha: sha,
    entries: (res.entries || []).map(x => ({ name: x.name, size: x.size, sha: x.sha256 })),
    zentries: recomputed, readme: readme ? new TextDecoder().decode(readme.data) : null,
    warnings: res.warnings, meta: res.meta ? { bpm: res.meta.bpm, key: res.meta.key, loops: res.meta.loops } : null };
})()`);
  const d11 = dlR.value || {};
  const base = d11.ok === true ? String(d11.name || '').replace(/_stems\.zip$/, '') : '';
  const names = (d11.zentries || []).map(e => e.name);
  const required = ['_master.wav', '_stem1.wav', '_stem2.wav', '_stem3.wav', '_stem4.wav', '_full.mid', 'README.txt'];
  const missing = required.filter(sfx => !names.some(n => n === (sfx === 'README.txt' ? 'README.txt' : base + sfx)));
  const stemMids = names.filter(n => /_stem\d\.mid$/.test(n)).length;
  const shasOk = (d11.zentries || []).every(e => e.claimedSize === e.size && e.claimedSha === e.sha && e.crcOk === true);
  check('deliver e2e: avDeliverRun(loops 1, bits 16, pinned params) → ok · kind zip · name ' + (d11.name || '?'),
    d11.ok === true && d11.kind === 'zip' && /^anvil_120bpm_.+_stems\.zip$/.test(String(d11.name || '')) && d11.bytes > 100000,
    JSON.stringify({ ok: d11.ok, error: d11.error, kind: d11.kind, name: d11.name, bytes: d11.bytes, warnings: d11.warnings }));
  check('deliver zip entry set: master + 4 stems + full.mid + README.txt present (' + names.length + ' entries' + (stemMids ? ' incl. ' + stemMids + ' stem mids' : ', no stem mids') + ')',
    d11.ok === true && missing.length === 0, JSON.stringify({ missing: missing, names: names }));
  check('deliver: every entries[].sha256 RECOMPUTED from the zip bytes (store-method walk) — equal · sizes equal · CRC32 equal',
    d11.ok === true && (d11.zentries || []).length === (d11.entries || []).length && shasOk === true,
    JSON.stringify({ n: (d11.zentries || []).length, shasOk: shasOk, first: (d11.zentries || [])[0] && { name: d11.zentries[0].name, claim: (d11.zentries[0].claimedSha || '').slice(0, 12), real: (d11.zentries[0].sha || '').slice(0, 12), crcOk: d11.zentries[0].crcOk } }));
  const rd = String(d11.readme || '');
  check('deliver README: carries the bpm, the base/key, file names + Anvil header',
    d11.ok === true && /120/.test(rd) && /bpm/i.test(rd) && /Anvil/i.test(rd) && rd.includes(base) && required.every(sfx => sfx === 'README.txt' || rd.includes(base + sfx)),
    JSON.stringify({ hasBase: rd.includes(base), head: rd.slice(0, 120) }));

  /* the download path fires: click the result-line DOWNLOAD affordance (fallback: call
     avDeliverDownload directly with the stashed bytes — the same pinned download function) */
  let clicked = false;
  const linkR = await ev(`(() => {
    const host = document.getElementById('av-deliver-host');
    if (!host) return null;
    const cands = Array.from(host.querySelectorAll('a, button, [role="button"], span, div'))
      .filter(el => el.children.length === 0 && /download/i.test((el.textContent || '') + ' ' + (el.getAttribute('data-act') || '')));
    if (!cands.length) return null;
    const el = cands[cands.length - 1];
    el.id = 'rig-dl-link';
    return el.tagName + ':' + (el.textContent || '').trim().slice(0, 40);
  })()`);
  if (linkR.value) clicked = await clickSel('#rig-dl-link', 600);
  note('download affordance: ' + (linkR.value ? (clicked ? 'clicked (' + linkR.value + ')' : 'found but not clickable') : 'not present — direct avDeliverDownload fallback'));
  await sleep(1200);
  let dlFile = null;
  for (let i = 0; i < 30 && !dlFile; i++) {
    try {
      const seen = readdirSync(DL_DIR).filter(f => !f.endsWith('.crdownload'));
      dlFile = seen.find(f => f === d11.name) || (seen.length ? seen[0] : null);
    } catch { /* dir race */ }
    if (!dlFile) await sleep(500);
  }
  if (!dlFile && d11.ok === true) {
    const directR = await ev(`(async () => { if (!window.__rigZip || typeof avDeliverDownload !== 'function') return 'unavailable'; return avDeliverDownload(window.__rigZip, ${JSON.stringify(d11.name || 'bounce.zip')}) === true; })()`);
    note('download: direct avDeliverDownload fallback -> ' + JSON.stringify(directR.value));
    for (let i = 0; i < 20 && !dlFile; i++) {
      await sleep(500);
      try { const seen = readdirSync(DL_DIR).filter(f => !f.endsWith('.crdownload')); dlFile = seen.find(f => f === d11.name) || (seen.length ? seen[0] : null); } catch { /* race */ }
    }
  }
  check('deliver download lands on disk in the CDP download dir (' + (d11.name || '?') + ')',
    dlFile !== null, JSON.stringify({ dir: DL_DIR, file: dlFile }));
  if (dlFile && d11.ok === true) {
    const fileSha = shaOf(path.join(DL_DIR, dlFile));
    check('deliver download: file sha256 === the returned bytes sha256 (the artifact is the artifact)',
      fileSha === d11.sha && path.basename(dlFile) === d11.name,
      JSON.stringify({ file: dlFile, fileSha: fileSha.slice(0, 16), retSha: String(d11.sha || '').slice(0, 16) }));
  }

  /* ── 12. zero page errors · screenshot · freeze sha ── */
  check('zero page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await ev(`(() => { const el = document.getElementById('av-deliver-host'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); return true; })()`);
  await sleep(250);
  const rectR = await ev(`(() => { const el = document.getElementById('av-deliver-host'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }; })()`);
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
  check('screenshot: renders/p6-deliver-suite.png (the deliver card, scale 2)', shotOk, shotInfo);

  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after): ' + shaAfter);
  check('freeze: index.html sha256 before === after (unchanged by the run)', shaAfter === shaBefore, shaAfter);
  if (PIN) check('freeze: index.html sha256 = pinned', shaBefore === PIN && shaAfter === PIN, 'pinned ' + PIN.slice(0, 12) + '…');
  else note('EXPECT_SHA not pinned — after the P6 build, pass --sha <hex> or set the constant (never loosen)');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'BOUNCE FAILED' : 'BOUNCE PASSED');
  try { ws.close(); } catch { /* done */ }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('bounce harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    /* profile-scoped cleanup (LAW): kill ONLY processes whose command line carries OUR temp
       profile — matched by its unique basename, so the pattern needs no backslash escaping */
    const tag = path.basename(profile);
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
