// cdp_import.mjs — Anvil R15b SAMPLE PACKS suite (parent-authored; the wave's dedicated rig).
//
//   node verify/cdp_import.mjs [path-to-index.html] [--port N] [--sha <hex>]
//
// WHAT IT PROVES, in order (contract: verify/_r15b_wave.md):
//   1. boot contract (data-av-ready) + the SAMPLE PACKS card mounted in the store zone
//      (drop + pickers + report + lib + slot + facade, ids pinned in the contract).
//   2. the IMPORT SELFTEST proof line parses on an ?avtest=1 load (sniff = "wav").
//   3. absent-host contract: with #av-import-host detached avImportUiInit() returns false
//      WITHOUT throwing; re-attaching restores the card.
//   4. a real file-input import through DOM.setFileInputFiles (#av-import-file) with four
//      fixtures staged by this rig: tone.wav + note.mid + loop.rx2 (a real VelociLoops test
//      fixture, scratch only) + stub.exs. The browser loads the files from disk and fires
//      change; if headless declines to auto-fire it, the rig dispatches the same bubbling
//      change the picker would -> report rows 4, counts imported 3 / deferred 1.
//   5. the rx2 meta crossed the pipeline from AVRex.probe: slices 10, 44100 Hz, 16-bit,
//      117760 frames.
//   6. the exs row is an honest deferral (result deferred, reason starts "EXS24").
//   7. the local library lists the three imported items (avLibList + DOM rows); the deferred
//      exs item is NOT persisted.
//   8. LOAD on the wav row decodes into the session (decodeAudioData resamples to the live
//      48 kHz context; the 0.05 s duration is preserved).
//   9. SLOT 2 + SEND -> avSampleStore.sent[1] records tone.wav.
//   10. CHOP loads + drives #av-chop-src to the new entry (option present, synth zone revealed).
//   11. SEQ on the mid row pushes the pattern (notes >= 1, undo label "import").
//   12. LOAD on the rx2 row decodes in-browser (session entry, 117760 frames @ 44100 Hz) —
//       the REX2 end-to-end witness the child-B node harness anchors in scratch.
//   13. a RELOAD to the plain page: the library survives (IndexedDB, count 3), the report
//       resets (fresh page), and no SELFTEST text leaks on the plain load.
//   R16: zip expansion + f64-WAV + REX2 slice->chop legs.
//   R15d: legacy-NKI kit e2e · the real CWM container NKI · synthetic SXT + NBKT legs.
//   14. zero page errors · screenshot renders/r15b-import-suite.png · freeze sha before === after.
//
// Launch skeleton follows cdp_store.mjs / cdp_smoke.mjs VERBATIM (candidates Chrome/Edge/Brave,
// free-port scan, fresh temp --user-data-dir, 1440x900 metrics override, autoplay allowed, ONE
// browser, explicit exit, process.on('exit') kills ONLY processes whose command line carries OUR
// temp profile). SHA freeze discipline: index.html sha256'd before and after; EXPECT_SHA pinned
// to the R15b frozen build.
import { spawn, execSync } from 'node:child_process';
import zlib from 'node:zlib';
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs';
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

const EXPECT_SHA = 'a9d67b0e67daff9f6db9c4c3bd553f1612e45112153318b8cfcbdcabf6f3996c';
const PIN = (shaArg > -1 && argv[shaArg + 1] && /^[0-9a-f]{64}$/i.test(argv[shaArg + 1])) ? argv[shaArg + 1].toLowerCase() : EXPECT_SHA;
const shaOf = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const shaBefore = shaOf(page);
console.log('index.html sha256 (before): ' + shaBefore + (PIN ? '' : '   (EXPECT_SHA not pinned)'));

/* ---------- fixtures (scratch, regenerated each run; the rx2 is child B's VelociLoops stash,
   fetched for verification only — nothing ships) ---------- */
const fxDir = path.join(here, '..', 'cache', 'r15b', 'rig-fixtures');
mkdirSync(fxDir, { recursive: true });
const wavPath = path.join(fxDir, 'tone.wav');
const midPath = path.join(fxDir, 'note.mid');
const exsPath = path.join(fxDir, 'stub.exs');
const rx2Path = path.join(fxDir, 'loop.rx2');
const exsPath2 = path.join(fxDir, 'rig-kit.exs');
const kitWavPath = path.join(fxDir, 'kit-tone.wav');
const alsPath = path.join(fxDir, 'rig.als');
const serumPath = path.join(fxDir, 'rig.SerumPreset');
{
  const sr = 8000, n = 400;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / sr) * 0.5 * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(wavPath, Buffer.concat([h, data]));
  writeFileSync(midPath, Buffer.from([0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xE0,
    0x4D, 0x54, 0x72, 0x6B, 0, 0, 0, 13, 0, 0x90, 60, 100, 0x83, 0x5F, 0x80, 60, 0, 0, 0xFF, 0x2F, 0]));
  writeFileSync(exsPath, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  const rx2Src = path.join(here, '..', 'cache', 'r15b', 'rex', 'VelociLoops-main', 'tests', 'data', '120Mono.rx2');
  if (!existsSync(rx2Src)) {
    console.error('rx2 fixture absent: ' + rx2Src + '\n  (child B scratch stash; fetch VelociLoops tests/data/120Mono.rx2 there for verification only)');
    process.exit(2);
  }
  copyFileSync(rx2Src, rx2Path);
  /* R15c fixtures: synthetic .exs + its sibling wav, gzip .als, and one REAL SerumPreset (verification only) */
  {
    const blk = (marker, size, name) => { const b = Buffer.alloc(84 + size); b[0] = 1; b[1] = 1; b[2] = 0; b[3] = marker; b.writeUInt32LE(size, 4); b.write('TBOS', 16, 'ascii'); b.write(name, 20, 'ascii'); return b; };
    const d = 84;
    const inst = blk(0, 88, 'RigKit');
    const zn = blk(1, 148, 'Z1');
    zn[d + 1] = 60; zn[d + 6] = 36; zn[d + 7] = 51; zn[d + 9] = 1; zn[d + 10] = 127;
    zn.writeUInt32LE(0, d + 12); zn.writeUInt32LE(50, d + 16); zn.writeUInt32LE(0, d + 92);
    const smp = blk(3, 600, 'S1');
    smp.writeUInt32LE(400, d + 4); smp.writeUInt32LE(8000, d + 8); smp[d + 12] = 16;
    smp.write('kit-tone.wav', d + 336, 'ascii');
    writeFileSync(exsPath2, Buffer.concat([inst, zn, smp]));
    copyFileSync(wavPath, kitWavPath);
    const doc = '<?xml version="1.0"?><Ableton MajorVersion="12" Creator="Ableton Live 12.1"><LiveSet><Tempo><Manual Value="128"/></Tempo><FileRef><RelativePath Value="../Samples/Drums/Kick 01.WAV"/></FileRef><MidiClip><Notes><KeyTracks><KeyTrack><MidiKey Value="60"/><Notes><MidiNoteEvent Time="0" Duration="0.25" Velocity="100" IsEnabled="true"/></Notes></KeyTrack></KeyTracks></Notes></MidiClip></LiveSet></Ableton>';
    writeFileSync(alsPath, zlib.gzipSync(Buffer.from(doc, 'utf8')));
    const corpus = 'C:/Users/Moddy/Documents/Xfer/Serum 2 Presets/Presets';
    const stack = [corpus]; let found = null;
    while (stack.length && !found) {
      const dir = stack.pop();
      let ents = [];
      try { ents = readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
      for (const e of ents) { const full = path.join(dir, e.name); if (e.isDirectory()) stack.push(full); else if (/\.SerumPreset$/i.test(e.name)) { found = full; break; } }
    }
    if (!found) { console.error('no real .SerumPreset under ' + corpus); process.exit(2); }
    copyFileSync(found, serumPath);
  }
}
/* R15d fixtures: the child-verified scratch fixtures (legacy NKI, SXT, NBKT) + the REAL CWM
   container NKI (verification only). The legacy kit's zone sample is sample_A.wav - its sibling. */
const nkiPath = path.join(fxDir, 'rig.nki');
const nkiWavPath = path.join(fxDir, 'sample_A.wav');
const nkiCwmPath = path.join(fxDir, 'cwm-template.nki');
const sxtPath = path.join(fxDir, 'rig.sxt');
const nbktPath = path.join(fxDir, 'rig.nbkt');
{
  const r15dSrc = path.join(here, '..', 'cache', 'r15d');
  const want = [
    [path.join(r15dSrc, 'ni', 'fix_legacy.nki'), nkiPath],
    [path.join(r15dSrc, 'ni', 'fix_container_nbkt.bin'), nbktPath],
    [path.join(r15dSrc, 'cwm', 'Kontakt680Template.nki'), nkiCwmPath],
  ];
  for (const pair of want) {
    if (!existsSync(pair[0])) { console.error('R15d fixture absent: ' + pair[0]); process.exit(2); }
    copyFileSync(pair[0], pair[1]);
  }
  copyFileSync(wavPath, nkiWavPath);
  const hex = readFileSync(path.join(r15dSrc, 'sxt', 'card-fixture.hex'), 'utf8').trim().replace(/\s+/g, '');
  writeFileSync(sxtPath, Buffer.from(hex, 'hex'));
}
/* R16 fixtures: the parent-built canonical zip + a node-built f64 wav. */
const zipPath = path.join(fxDir, 'rig-pack.zip');
const f64Path = path.join(fxDir, 'rig64.wav');
{
  const zipSrc = path.join(here, '..', 'cache', 'r16', 'zip', 'rig-pack.zip');
  if (!existsSync(zipSrc)) { console.error('R16 zip fixture absent: ' + zipSrc); process.exit(2); }
  copyFileSync(zipSrc, zipPath);
  const N = 200, sr = 8000;
  const b = Buffer.alloc(44 + N * 16);
  b.write('RIFF', 0); b.writeUInt32LE(36 + N * 16, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 16, 28); b.writeUInt16LE(16, 32); b.writeUInt16LE(64, 34);
  b.write('data', 36); b.writeUInt32LE(N * 16, 40);
  for (let i = 0; i < N; i++) { const v = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr); b.writeDoubleLE(v, 44 + i * 16); b.writeDoubleLE(v, 52 + i * 16); }
  writeFileSync(f64Path, b);
}
console.log('fixtures staged in ' + fxDir);

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
    const ok = await new Promise(res => { const srv = net.createServer(); srv.once('error', () => res(false)); srv.once('listening', () => srv.close(() => res(true))); srv.listen(p, '127.0.0.1'); });
    if (ok) return p;
  }
  return start;
}
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9560);
const profile = path.join(tmpdir(), 'anvil-import-' + Date.now());
const baseUrl = 'file:///' + path.resolve(page).replace(/\\/g, '/');
const url = baseUrl + '?avtest=1';
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
const shotPath = path.join(here, '..', 'renders', 'r15b-import-suite.png');

async function main() {
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
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('DOM.enable');
  if (!String(target.url).startsWith('file://')) await send('Page.navigate', { url });
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
  const waitFor = async (expr, ms = 30000, step = 250) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const r = await ev(expr);
      if (r.value) return r.value;
      await sleep(step);
    }
    return null;
  };
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  const clickSel = async (sel, after = 350) => {
    const found = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; if (e.scrollIntoView) e.scrollIntoView({ block: 'center', inline: 'center' }); return true; })()`);
    if (found.value !== true) { note('click target missing: ' + sel); return false; }
    await sleep(180);
    const boxR = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width || !r.height) return null; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const b = boxR.value;
    if (!b) { note('click target not visible: ' + sel); return false; }
    await mouse('mousePressed', b.x, b.y); await sleep(30); await mouse('mouseReleased', b.x, b.y); await sleep(after);
    return true;
  };
  const waitReady = async () => { for (let i = 0; i < 120; i++) { const r = await ev(`!!(document.documentElement && document.documentElement.getAttribute('data-av-ready') === '1')`); if (r.value === true) return true; await sleep(300); } return false; };

  /* ── 1. boot + card ── */
  const ready = await waitReady();
  const bootR = await ev(`(() => {
    const card = document.getElementById('av-import');
    const q = (s) => !!document.querySelector(s);
    const f = window.__avImport || {};
    return { card: !!card, zone: card && card.closest('.av-zone') ? card.closest('.av-zone').getAttribute('data-zone') : null,
             drop: q('[data-av-import-drop]'), file: q('#av-import-file'), dir: q('#av-import-dir'), slot: q('#av-import-slot'),
             facade: typeof f.importFiles, ver: f.version || null };
  })()`);
  const b = bootR.value || {};
  check('boot + card: SAMPLE PACKS mounted in the store zone (drop, pickers, slot, facade)',
    ready === true && b.card === true && b.zone === 'store' && b.drop === true && b.file === true && b.dir === true && b.slot === true
    && b.facade === 'function' && b.ver === 'r15b.0', JSON.stringify(b));

  /* ── 2. proof line (?avtest=1) ── */
  const proofEl = await waitFor(`(() => { const el = document.getElementById('av-importtest'); return el ? String(el.textContent || '') : null; })()`, 8000);
  let proof = null;
  try { proof = proofEl && proofEl.startsWith('IMPORT SELFTEST ') ? JSON.parse(proofEl.slice('IMPORT SELFTEST '.length)) : null; } catch (e) { proof = null; }
  check('IMPORT SELFTEST proof: parses on the avtest load (inited, sniff = wav)',
    !!proof && proof.version === 'r15b.0' && proof.inited === true && proof.sniff === 'wav', JSON.stringify(proof));

  /* ── 3. absent-host contract ── */
  const absentR = await ev(`(() => {
    const host = document.getElementById('av-import-host');
    const card = document.getElementById('av-import');
    if (!host || !card) return { missing: true };
    host.remove();
    let r1 = null; let threw1 = false;
    try { r1 = avImportUiInit(); } catch (e) { threw1 = true; }
    card.appendChild(host);
    let r2 = null; let threw2 = false;
    try { r2 = avImportUiInit(); } catch (e) { threw2 = true; }
    return { r1: r1, threw1: threw1, r2: r2, threw2: threw2, back: !!document.querySelector('#av-import-host [data-av-import-drop]') };
  })()`);
  const ah = absentR.value || {};
  check('absent host: avImportUiInit() returns false without throwing; re-attaching restores the card',
    ah.r1 === false && ah.threw1 === false && ah.r2 !== false && ah.threw2 === false && ah.back === true, JSON.stringify(ah));

  /* ── 4. real file-input import ── */
  /* real disk files through the file input: the browser loads them via DOM.setFileInputFiles
     and fires change; if this build declines to auto-fire it, the rig dispatches the same
     bubbling change the OS picker would. (The first rig run failed here for an APP reason: the
     card cleared input.value BEFORE reading files.length, so Chromium's live FileList read
     empty and the import never ran; fixed in the same landing pass.) */
  const docR = await send('DOM.getDocument', {});
  const rootId = docR && docR.root ? docR.root.nodeId : null;
  const qR = rootId ? await send('DOM.querySelector', { nodeId: rootId, selector: '#av-import-file' }) : null;
  const inputId = qR ? qR.nodeId : 0;
  if (!inputId) { note('domain: #av-import-file not found for setFileInputFiles'); }
  else {
    await send('DOM.setFileInputFiles', { nodeId: inputId, files: [wavPath, midPath, exsPath, rx2Path] });
    await sleep(1500);
  }
  let rowsN = await waitFor(`document.querySelectorAll('#av-import-report [data-av-import-row]').length === 4 ? 4 : 0`, 12000);
  if (!rowsN) {
    note('no import within 12 s of setFileInputFiles - dispatching the change event');
    await ev(`(() => { const i = document.getElementById('av-import-file'); if (i) i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    rowsN = await waitFor(`document.querySelectorAll('#av-import-report [data-av-import-row]').length === 4 ? 4 : 0`, 20000);
  }
  const snap1 = (await ev(`(window.__avImport && window.__avImport.snap) ? window.__avImport.snap() : null`)).value || {};
  const c1 = snap1.last && snap1.last.counts ? snap1.last.counts : null;
  check('real file-input import: 4 rows land (imported 3 · deferred 1 · refused 0)',
    rowsN === 4 && !!c1 && c1.total === 4 && c1.imported === 3 && c1.deferred === 1 && c1.refused === 0
    && c1.samples === 2 && c1.patterns === 1, JSON.stringify(c1));

  /* ── 5. rx2 meta crossed the pipeline (AVRex.probe -> library record) ── */
  const rxReport = (snap1.report || []).find(i => i && i.format === 'rex2') || null;
  const rxLib = await waitFor(`(async () => { if (typeof avLibList !== 'function') return null; const l = await avLibList(); const it = (l.items || []).find(i => i.format === 'rex2'); return it && it.meta ? { slices: it.meta.slices, rate: it.meta.rate, bits: it.meta.bits, frames: it.meta.frames } : null; })()`, 12000);
  check('rx2 probe meta: slices 10 · 44100 Hz · 16-bit · 117760 frames (pipeline -> library record)',
    !!rxReport && rxReport.result === 'imported' && !!rxLib && rxLib.slices === 10 && rxLib.rate === 44100
    && rxLib.bits === 16 && rxLib.frames === 117760, JSON.stringify({ report: rxReport && rxReport.result, meta: rxLib }));

  /* ── 6. exs honest deferral ── */
  const exRow = (snap1.report || []).find(i => i && i.format === 'exs') || null;
  check('exs row: deferred with the honest reason (starts .exs \u2014)',
    !!exRow && exRow.result === 'deferred' && String(exRow.reason || '').indexOf('.exs \u2014 ') === 0, JSON.stringify(exRow && { result: exRow.result, reason: exRow.reason }));

  /* ── 7. library lists 3; deferred exs not persisted ── */
  const lib1 = await waitFor(`(async () => { if (typeof avLibList !== 'function') return null; const l = await avLibList(); return (l && l.count === 3) ? { count: l.count, formats: l.items.map(i => i.format).sort().join(',') } : null; })()`, 15000);
  const libDom = (await ev(`document.querySelectorAll('#av-import-lib [data-av-import-lib]').length`)).value;
  check('library: 3 items persisted (aiff-none · mid · rx2 · wav) + DOM rows match; exs absent',
    !!lib1 && lib1.count === 3 && lib1.formats === 'mid,rex2,wav' && libDom === 3, JSON.stringify({ lib1: lib1, dom: libDom }));

  /* helper: find a lib row id by its name text */
  const rowId = async (name) => (await ev(`(() => { const rows = [...document.querySelectorAll('#av-import-lib [data-av-import-lib]')]; const r = rows.find(x => String(x.textContent || '').indexOf(${JSON.stringify(name)}) >= 0); return r ? r.getAttribute('data-av-import-lib') : null; })()`)).value;

  /* ── 8. LOAD wav -> session (decodeAudioData resamples to the LIVE context: 48 kHz native,
     0.05 s preserved — the native path; the rate-preserving clean-room path is the smoke's
     AIFF witness, 8 frames @ 8000 Hz) ── */
  const wavId = await rowId('tone.wav');
  const n0 = (await ev(`avSampleStore.entries.length`)).value;
  await clickSel(`[data-av-import-lib="${wavId}"] [data-av-import-act="load"]`, 900);
  const loadedR = await waitFor(`(() => { const n = avSampleStore.entries.length; if (n <= ${Number(n0) || 0}) return null; const e = avSampleStore.entries[n - 1]; return { n: n, rate: e.sampleRate, frames: e.buffer ? e.buffer.length : -1, secs: (e.buffer && isFinite(e.buffer.duration)) ? e.buffer.duration : -1 }; })()`, 12000);
  check('LOAD (wav): decodes into the session at 48 kHz native (0.05 s preserved)',
    !!loadedR && loadedR.rate === 48000 && loadedR.frames === 2400 && Math.abs(loadedR.secs - 0.05) < 0.002, JSON.stringify(loadedR));

  /* ── 9. SLOT 2 + SEND ── */
  await ev(`(() => { const s = document.getElementById('av-import-slot'); if (s) { s.value = '2'; s.dispatchEvent(new Event('change', { bubbles: true })); } return true; })()`);
  await clickSel(`[data-av-import-lib="${wavId}"] [data-av-import-act="send"]`, 1200);
  const sentR = await waitFor(`(() => { const r = avSampleStore.sent && avSampleStore.sent[1]; return r ? { name: r.name, slot: r.slot, frames: r.frames } : null; })()`, 12000);
  check('SLOT 2 + SEND: avSampleStore.sent[1] records tone.wav through the engine facade',
    !!sentR && sentR.slot === 1 && String(sentR.name).indexOf('tone.wav') >= 0, JSON.stringify(sentR));

  /* ── 10. CHOP wiring ── */
  await clickSel(`[data-av-import-lib="${wavId}"] [data-av-import-act="chop"]`, 900);
  const chopR = await ev(`(() => {
    const sel = document.getElementById('av-chop-src');
    if (!sel) return { missing: true };
    const v = String(sel.value || '');
    const opt = v ? !!sel.querySelector('option[value="' + v + '"]') : false;
    const zone = (window.__avZone && typeof window.__avZone.current === 'function') ? window.__avZone.current() : null;
    const entry = v ? !!avSampleStore.byId[v] : false;
    return { v: v, opt: opt, zone: zone, entry: entry };
  })()`);
  const ch = chopR.value || {};
  check('CHOP: the new session entry is selected in #av-chop-src (option present, synth zone revealed)',
    ch.entry === true && ch.opt === true && ch.zone === 'synth', JSON.stringify(ch));

  /* ── 11. SEQ on the mid row ── */
  const midId = await rowId('note.mid');
  await clickSel(`[data-av-import-lib="${midId}"] [data-av-import-act="seq"]`, 900);
  const seqR = await waitFor(`(() => { let notes = 0; try { const sn = avSeqSnap(); for (const t of sn.tracks) for (const s of t.steps) if (s.on === 1) notes++; } catch (e) { return null; } const undo = (window.__avUndo && typeof window.__avUndo.label === 'string') ? window.__avUndo.label : null; return (notes >= 1 && undo === 'import') ? { notes: notes, undo: undo } : null; })()`, 12000);
  check('SEQ (mid): pattern loaded (notes >= 1) + undo label "import"',
    !!seqR && seqR.notes >= 1 && seqR.undo === 'import', JSON.stringify(seqR));

  /* ── 12. rx2 LOAD -> session (the REX2 decode witness) ── */
  const rx2Id = await rowId('loop.rx2');
  const m0 = (await ev(`avSampleStore.entries.length`)).value;
  await clickSel(`[data-av-import-lib="${rx2Id}"] [data-av-import-act="load"]`, 900);
  const rxLoadR = await waitFor(`(() => { const n = avSampleStore.entries.length; if (n <= ${Number(m0) || 0}) return null; const e = avSampleStore.entries[n - 1]; return { rate: e.sampleRate, frames: e.buffer ? e.buffer.length : -1 }; })()`, 20000);
  check('LOAD (rx2): decodes in-browser — session entry 117760 frames @ 44100 Hz',
    !!rxLoadR && rxLoadR.rate === 44100 && rxLoadR.frames === 117760, JSON.stringify(rxLoadR));

  /* screenshot with the populated report + library */
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    note('screenshot: ' + shotPath);
  } catch (e) { note('screenshot failed: ' + String(e && e.message || e)); }

  /* ── 13. reload -> plain page: IDB persists, report resets, no leak ── */
  await send('Page.navigate', { url: baseUrl });
  const ready2 = await waitReady();
  const persistR = await waitFor(`(async () => { if (typeof avLibList !== 'function') return null; const l = await avLibList(); return (l && l.count === 3) ? { count: l.count } : null; })()`, 20000);
  const freshR = await ev(`(() => ({ rows: document.querySelectorAll('#av-import-report [data-av-import-row]').length, hits: ((document.body.innerText || '').match(/SELFTEST/g) || []).length }))()`);
  const fr = freshR.value || {};
  check('reload: the library persists via IndexedDB (count 3), the report resets, no proof text on the plain page',
    ready2 === true && !!persistR && persistR.count === 3 && fr.rows === 0 && fr.hits === 0, JSON.stringify({ persist: persistR, fresh: fr }));

  /* ── 16-18. R15c: the structured trio on real files (second leg, after the reload) ── */
  {
    const docR2 = await send('DOM.getDocument', {});
    const qR2 = (docR2 && docR2.root) ? await send('DOM.querySelector', { nodeId: docR2.root.nodeId, selector: '#av-import-file' }) : null;
    if (!qR2 || !qR2.nodeId) {
      check('R15c rig: second-leg input missing', false, 'no #av-import-file node');
    } else {
      await send('DOM.setFileInputFiles', { nodeId: qR2.nodeId, files: [exsPath2, kitWavPath, alsPath, serumPath] });
      await sleep(1500);
      let rows2 = await waitFor(`document.querySelectorAll('#av-import-report [data-av-import-row]').length === 4 ? 4 : 0`, 15000);
      if (!rows2) {
        await ev(`(() => { const i = document.getElementById('av-import-file'); if (i) i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        rows2 = await waitFor(`document.querySelectorAll('#av-import-report [data-av-import-row]').length === 4 ? 4 : 0`, 20000);
      }
      const snap2 = (await ev(`(window.__avImport && window.__avImport.snap) ? window.__avImport.snap() : null`)).value || {};
      const items2 = snap2.report || [];
      const kit2 = items2.find(i => i && i.format === 'exs') || null;
      const als2 = items2.find(i => i && i.format === 'als') || null;
      const kitId = await rowId('rig-kit.exs');
      await clickSel(`[data-av-import-lib="${kitId}"] [data-av-import-act="kit"]`, 1500);
      const kitSent = await waitFor(`(() => { const r = avSampleStore.sent && avSampleStore.sent[0]; return (r && String(r.name).indexOf('kit-tone.wav') >= 0) ? { name: r.name, slot: r.slot } : null; })()`, 15000);
      const kitKind = (await ev(`(typeof avParams === 'object' && avParams) ? avParams['engine.kind'] : null`)).value;
      check('R15c rig: real .exs + sibling WAV -> kit row -> KIT loads a slot (engine kind sampler)',
        rows2 === 4 && !!kit2 && kit2.result === 'imported' && !!kitSent && kitSent.slot === 0 && kitKind === 'sampler',
        JSON.stringify({ rows: rows2, kit: kit2 && kit2.result, sent: kitSent, kind: kitKind }));
      const alsId = await rowId('rig.als');
      await clickSel(`[data-av-import-lib="${alsId}"] [data-av-import-act="seq"]`, 1200);
      const seq2 = await waitFor(`(() => { let n = 0; try { const sn = avSeqSnap(); for (const t of sn.tracks) for (const s of t.steps) if (s.on === 1) n++; } catch (e) { return null; } const u = (window.__avUndo && typeof window.__avUndo.label === 'string') ? window.__avUndo.label : null; return (n >= 1 && u === 'import') ? { notes: n, undo: u } : null; })()`, 15000);
      check('R15c rig: real .als -> refs row -> the SEQ button runs the pattern (undo import)',
        !!als2 && als2.result === 'imported' && !!seq2 && seq2.notes >= 1 && seq2.undo === 'import',
        JSON.stringify({ als: als2 && als2.result, seq: seq2 }));
      const zstdOK = (await ev(`(() => { try { new DecompressionStream('zstd'); return true; } catch (e) { return false; } })()`)).value;
      if (zstdOK) {
        const serumRec = await waitFor(`(async () => { if (typeof avLibList !== 'function') return null; const l = await avLibList(); const it = (l.items || []).find(i => i.format === 'serum'); return (it && it.meta) ? { kind: it.meta.kind, pn: it.meta.presetName, n: Array.isArray(it.meta.wtRefs) ? it.meta.wtRefs.length : -1 } : null; })()`, 15000);
        check('R15c rig: a REAL SerumPreset imports as refs (serum2 meta + wtRefs array)',
          !!serumRec && serumRec.kind === 'serum2' && String(serumRec.pn || '').length > 0 && serumRec.n >= 0 && serumRec.n <= 256,
          JSON.stringify(serumRec));
      } else {
        const serumRow = items2.find(i => i && i.format === 'serum') || null;
        check('R15c rig: without native zstd the real SerumPreset defers honestly (reason starts .SerumPreset \u2014)',
          !!serumRow && serumRow.result === 'deferred' && String(serumRow.reason || '').indexOf('.SerumPreset \u2014 ') === 0,
          JSON.stringify(serumRow && { result: serumRow.result, reason: serumRow.reason }));
      }
    }
  }

  /* ── 14. zero page errors ── */

  /* ── 14. zero page errors ── */
  /* ── R15d leg: the NI/Reason trio on staged fixtures (third import run, same page) ── */
  {
    const docR3 = await send('DOM.getDocument', {});
    const qR3 = (docR3 && docR3.root) ? await send('DOM.querySelector', { nodeId: docR3.root.nodeId, selector: '#av-import-file' }) : null;
    if (!qR3 || !qR3.nodeId) {
      check('R15d rig: input missing', false, 'no #av-import-file node');
    } else {
      /* leg a: legacy .nki + its sibling WAV -> kit -> KIT action -> slot + sampler */
      await send('DOM.setFileInputFiles', { nodeId: qR3.nodeId, files: [nkiPath, nkiWavPath] });
      await sleep(1500);
      let rows3 = await waitFor(`document.querySelectorAll('#av-import-report [data-av-import-row]').length === 2 ? 2 : 0`, 15000);
      if (!rows3) {
        await ev(`(() => { const i = document.getElementById('av-import-file'); if (i) i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        rows3 = await waitFor(`document.querySelectorAll('#av-import-report [data-av-import-row]').length === 2 ? 2 : 0`, 20000);
      }
      const nkiId = await rowId('rig.nki');
      await clickSel(`[data-av-import-lib="${nkiId}"] [data-av-import-act="kit"]`, 1500);
      const nkiSent = await waitFor(`(() => { const r = avSampleStore.sent && avSampleStore.sent[0]; return (r && String(r.name).indexOf('sample_A.wav') >= 0) ? { name: r.name, slot: r.slot } : null; })()`, 15000);
      const nkiKind = (await ev(`(typeof avParams === 'object' && avParams) ? avParams['engine.kind'] : null`)).value;
      check('R15d rig: legacy .nki zones -> kit row -> KIT loads a slot (engine kind sampler)',
        rows3 === 2 && !!nkiId && !!nkiSent && nkiSent.slot === 0 && nkiKind === 'sampler',
        JSON.stringify({ rows: rows3, sent: nkiSent, kind: nkiKind }));

      /* leg b: the REAL CWM container NKI -> refs meta pinned to the harness values */
      await send('DOM.setFileInputFiles', { nodeId: qR3.nodeId, files: [nkiCwmPath] });
      await sleep(1500);
      let rows3b = await waitFor(`document.querySelectorAll('#av-import-report [data-av-import-row]').length === 1 ? 1 : 0`, 15000);
      if (!rows3b) {
        await ev(`(() => { const i = document.getElementById('av-import-file'); if (i) i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        rows3b = await waitFor(`document.querySelectorAll('#av-import-report [data-av-import-row]').length === 1 ? 1 : 0`, 20000);
      }
      const cwmRec = await waitFor(`(async () => { if (typeof avLibList !== 'function') return null; const l = await avLibList(); const it = (l.items || []).find(i => i.name === 'cwm-template.nki'); return (it && it.meta) ? { mk: it.meta.kind, pn: it.meta.presetName, pr: it.meta.product, vr: it.meta.version, n: it.meta.refCount } : null; })()`, 15000);
      check('R15d rig: the real CWM container NKI parses to the pinned meta (FM8 Jam / Kontakt / 6.7.1.0 / 61 refs)',
        !!cwmRec && cwmRec.mk === 'nki-container' && cwmRec.pn === 'FM8 Jam' && cwmRec.pr === 'Kontakt' && cwmRec.vr === '6.7.1.0' && cwmRec.n === 61,
        JSON.stringify(cwmRec));

      /* leg c: synthetic SXT + NBKT in one run -> refs metas + DOM rows */
      await send('DOM.setFileInputFiles', { nodeId: qR3.nodeId, files: [sxtPath, nbktPath] });
      await sleep(1500);
      let rows3c = await waitFor(`document.querySelectorAll('#av-import-report [data-av-import-row]').length === 2 ? 2 : 0`, 15000);
      if (!rows3c) {
        await ev(`(() => { const i = document.getElementById('av-import-file'); if (i) i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        rows3c = await waitFor(`document.querySelectorAll('#av-import-report [data-av-import-row]').length === 2 ? 2 : 0`, 20000);
      }
      const trioRec = await waitFor(`(async () => { if (typeof avLibList !== 'function') return null; const l = await avLibList(); const s = (l.items || []).find(i => i.format === 'sxt'); const n = (l.items || []).find(i => i.format === 'nbkt'); return (s && n) ? { sk: s.meta && s.meta.kind, sn: s.meta && s.meta.refCount, nk: n.meta && n.meta.kind, nn: n.meta && n.meta.presetName } : null; })()`, 15000);
      check('R15d rig: synthetic .sxt refs + .nbkt metadata persist through the library',
        !!trioRec && trioRec.sk === 'sxt' && trioRec.sn === 2 && trioRec.nk === 'nbkt' && trioRec.nn === 'Battery Fixture',
        JSON.stringify(trioRec));
    }
  }

  /* ── R16 leg: zip · f64-WAV · REX2->chop (fourth import run, same page) ── */
  {
    const docR4 = await send('DOM.getDocument', {});
    const qR4 = (docR4 && docR4.root) ? await send('DOM.querySelector', { nodeId: docR4.root.nodeId, selector: '#av-import-file' }) : null;
    if (!qR4 || !qR4.nodeId) {
      check('R16 rig: input missing', false, 'no #av-import-file node');
    } else {
      /* leg a: the packed zip expands through the real file input */
      await send('DOM.setFileInputFiles', { nodeId: qR4.nodeId, files: [zipPath] });
      await sleep(1500);
      let rows4 = await waitFor(`document.querySelectorAll('#av-import-report [data-av-import-row]').length === 4 ? 4 : 0`, 15000);
      if (!rows4) {
        await ev(`(() => { const i = document.getElementById('av-import-file'); if (i) i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        rows4 = await waitFor(`document.querySelectorAll('#av-import-report [data-av-import-row]').length === 4 ? 4 : 0`, 20000);
      }
      const zipSnap = (await ev(`(window.__avImport && window.__avImport.snap) ? window.__avImport.snap() : null`)).value || {};
      const zc = zipSnap.last && zipSnap.last.counts ? zipSnap.last.counts : null;
      const n0 = (await ev(`avSampleStore.entries.length`)).value;
      const kickId = await rowId('kick.wav');
      await clickSel(`[data-av-import-lib="${kickId}"] [data-av-import-act="load"]`, 900);
      const zipLoad = await waitFor(`(() => { const es = avSampleStore.entries; if (es.length <= ${Number(n0) || 0}) return null; const e = es[es.length - 1]; return { frames: e.buffer ? e.buffer.length : -1, rate: e.sampleRate }; })()`, 12000);
      check('R16 rig: the real zip expands (4 rows; bundles 1 · samples 2 · refused 1) + a child LOADs (native resample: 0.05 s @ 48 kHz)',
        rows4 === 4 && !!zc && zc.bundles === 1 && zc.samples === 2 && zc.refused === 1
        && !!zipLoad && zipLoad.frames === 2400 && zipLoad.rate === 48000,
        JSON.stringify({ rows: rows4, counts: zc, load: zipLoad }));

      /* leg b: the f64 wav LOADs through the clean-room route */
      await send('DOM.setFileInputFiles', { nodeId: qR4.nodeId, files: [f64Path] });
      await sleep(1500);
      let rows4b = await waitFor(`document.querySelectorAll('#av-import-report [data-av-import-row]').length === 1 ? 1 : 0`, 15000);
      if (!rows4b) {
        await ev(`(() => { const i = document.getElementById('av-import-file'); if (i) i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        rows4b = await waitFor(`document.querySelectorAll('#av-import-report [data-av-import-row]').length === 1 ? 1 : 0`, 20000);
      }
      const n1 = (await ev(`avSampleStore.entries.length`)).value;
      const f64Id = await rowId('rig64.wav');
      await clickSel(`[data-av-import-lib="${f64Id}"] [data-av-import-act="load"]`, 900);
      const f64Load = await waitFor(`(() => { const es = avSampleStore.entries; if (es.length <= ${Number(n1) || 0}) return null; const e = es[es.length - 1]; return { frames: e.buffer ? e.buffer.length : -1, rate: e.sampleRate }; })()`, 12000);
      check('R16 rig: f64 wav imports + LOAD lands (clean-room route, 200 frames @ 8000)',
        rows4b === 1 && !!f64Id && !!f64Load && f64Load.frames === 200 && f64Load.rate === 8000,
        JSON.stringify({ rows: rows4b, load: f64Load }));

      /* leg c: the REAL rx2 (loaded fresh from the library — the page reloaded since check 12) */
      const rx2RowId = await rowId('loop.rx2');
      const n2 = (await ev(`avSampleStore.entries.length`)).value;
      await clickSel(`[data-av-import-lib="${rx2RowId}"] [data-av-import-act="load"]`, 900);
      const rxEntry = await waitFor(`(() => { const es = avSampleStore.entries; if (es.length <= ${Number(n2) || 0}) return null; const e = es[es.length - 1]; return { id: e.id }; })()`, 20000);
      const chopR = (rxEntry && rxEntry.id) ? await ev(`(async () => {
        const ent = avSampleStore.byId[${JSON.stringify(rxEntry.id)}];
        if (!ent) return { missing: true };
        const sl = Array.isArray(ent.rexSlices) ? ent.rexSlices : null;
        const det = avChopDetect(ent.id);
        const kit = (det && det.ok) ? avChopKitNew(ent.id) : null;
        const apl = (kit && kit.ok) ? avChopApply(kit) : null;
        return { n: sl ? sl.length : -1, via: det && det.via, count: det && det.count,
                 kitOk: kit && kit.ok, kitN: kit && kit.slices ? kit.slices.length : -1,
                 aplOk: apl && apl.ok };
      })()`) : null;
      const rch = (chopR && chopR.value) || {};
      check('R16 rig: the real .rx2 loads from the library -> 10 slices -> detect via rex2 -> kit -> apply',
        rch.n === 10 && rch.via === 'rex2' && rch.count === 10 && rch.kitOk === true && rch.kitN === 10 && rch.aplOk === true,
        JSON.stringify(rch));
    }
  }

  check('zero page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* ── 15. freeze ── */
  const shaAfter = shaOf(page);
  check('freeze: index.html sha256 = pinned (before === after)',
    shaBefore === PIN && shaAfter === shaBefore, 'pinned ' + PIN.slice(0, 12) + '… · before ' + shaBefore.slice(0, 12) + '… · after ' + shaAfter.slice(0, 12) + '…');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { ws.close(); } catch { }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('import harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile.replace(/[\\/]/g, '\\\\')}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
