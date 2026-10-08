// cdp_hub.mjs — Anvil R17 IMPORT HUB v1 suite (the wave's dedicated rig; authored as child C).
//
//   node verify/cdp_hub.mjs [path-to-index.html] [--port N] [--sha <hex>] > verify/last-cdp_hub.log 2>&1
//
// WHAT IT PROVES, in order (contract: verify/_r17_wave.md §4/§6):
//   1. boot: the hub card #av-import sits in the STORE zone, retitled "Import & Library"; every
//      legacy id survives (drop/file/dir/pick/pickdir/status/counts/report/lib/slot/note/empty)
//      and every new id exists (search/sort/filters/selall/delsel/runs/runsclear/runs-empty/
//      storage/persist). Facades: __avImport gains pick/pickDir/library/rename/exportItem (keys
//      kept additively); __avLib gains rename/receiptSave/receiptList/receiptClear.
//   2. File menu: Import sounds... / Import folder... / Library... present; the Library item AND
//      avImportUiLibrary() both switch to the store pane (returns true).
//   3. runs: a synthetic WAV + SMF + one unknown file through the card's change handler ->
//      report rows, the library gains the imports (the unknown file is NOT persisted), and a
//      persisted receipt lands (avLibReceiptList count 1 + #av-import-runs 1 row); a second run
//      -> receipt count 2.
//   4. persistence leg: RELOAD the page -> receipts, their counts and the library load FRESH
//      (house law).
//   5. rename: avLibRename (via the facade) applies to avLibList + the manager DOM and refuses
//      an empty name honestly; RELOAD -> the renamed item persists.
//   6. manager legs: search narrows 3 items -> 1 hit; filter chips narrow by kind; sort flips
//      order (name vs newest); select-all + delete-selected remove exactly the checked rows.
//   7. export: window.avDeliverDownload is swapped for a spy -> __avImport.exportItem(id)
//      delivers the FULL stored bytes under a filename carrying the ext; the original is
//      restored afterwards.
//   8. storage: the #av-import-storage line is honest ("storage: <used> of <quota> · <tier>" or
//      the unavailable fallback); avStorePersist() resolves {ok, persisted} (booleans, never
//      throws) and the #av-import-persist click writes an honest result into the status line —
//      never a grant it did not get.
//   9. drop-anywhere: a synthetic drop (DataTransfer + File) on a NON-hub element routes to the
//      store pane and imports exactly once; a drop INSIDE the hub drop zone imports exactly once
//      (the containment-guard witness — no double import). Battery v1 adds the regression leg:
//      a drop on the SAMPLE CARD's own surface stays the sample card's (no hub receipt, no
//      store-zone yank) — the unclaimed-drop requirement of the R17 fix.
//   10. one sample LOAD e2e on the surviving item (the cdp_import style) — the manager did not
//       break the existing row actions.
//   11. zero page errors · the EXPECT_SHA freeze pin (null until the R17 freeze — a PINNED run
//       reports ONE more check than an unpinned run) · screenshot renders/r17-hub-suite.png.
//
// Launch skeleton follows cdp_import.mjs / cdp_smoke.mjs VERBATIM (candidates Chrome/Edge/Brave,
// free-port scan, fresh temp --user-data-dir, 1440x900 metrics override, autoplay allowed, ONE
// browser, explicit exit, process.on('exit') kills ONLY processes whose command line carries OUR
// temp profile). Fixtures are synthesized IN-PAGE (no disk files): WAVs via avWavEncode, a
// hand-built SMF, one unknown file; the file input is driven through a DataTransfer FileList +
// a bubbling change event (the snapshot-first law the R15b rig found), drops through
// DataTransfer + DragEvent (the R8 mod-drag law).
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

/* freeze pin: the parent sets this to the frozen sha at the R17 freeze (64-hex); null until then.
   Pinned run = +1 check (the freeze check); unpinned run reports one FEWER check — mirroring
   cdp_import's structure with its pin absent. */
const EXPECT_SHA = '3f87b4d311716d97ff29cae495d78c9b013a90fdf2a2209b2affd4a70f42bbd2';
const PIN = (shaArg > -1 && argv[shaArg + 1] && /^[0-9a-f]{64}$/i.test(argv[shaArg + 1])) ? argv[shaArg + 1].toLowerCase() : EXPECT_SHA;
const shaOf = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const shaBefore = shaOf(page);
console.log('index.html sha256 (before): ' + shaBefore + (PIN ? '' : '   (EXPECT_SHA not pinned)'));

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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9580);
const profile = path.join(tmpdir(), 'anvil-hub-' + Date.now());
const baseUrl = 'file:///' + path.resolve(page).replace(/\\/g, '/');
const url = baseUrl + '?avtest=1';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
console.log('cdp port ' + PORT + ' · profile ' + profile);
console.log('fixtures: synthesized in-page (avWavEncode WAVs + hand-built SMF + one unknown file)');

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
const shotPath = path.join(here, '..', 'renders', 'r17-hub-suite.png');

async function main() {
  /* a fresh Edge profile opens edge://sync-confirmation-dialog/ and edge://newtab/
     BEFORE our page; wait for the file:// page target itself (PF smoke law) */
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

  /* helper: the receipt count right now (guard = -1 when the surface is absent) */
  const receiptsNow = async () => (await ev(`(async () => { try { if (typeof avLibReceiptList !== 'function') return -1; const r = await avLibReceiptList(); return (r && r.ok) ? r.count : -1; } catch (e) { return -1; } })()`)).value;

  /* ── 1. boot: the hub card in the store zone ── */
  const ready = await waitReady();
  const bootR = await ev(`(() => {
    const card = document.getElementById('av-import');
    const h2 = card ? card.querySelector('h2') : null;
    const zone = (card && card.closest) ? card.closest('.av-zone') : null;
    return { card: !!card, zone: zone ? zone.getAttribute('data-zone') : null,
             h2: h2 ? String(h2.textContent || '').trim() : null };
  })()`);
  const b = bootR.value || {};
  check('hub boot: card in the store zone + h2 "Import & Library"',
    ready === true && b.card === true && b.zone === 'store' && b.h2 === 'Import & Library', JSON.stringify(b));

  /* ── 2. boot: legacy ids intact ── */
  const legacyR = await ev(`(() => {
    const id = (x) => !!document.getElementById(x);
    const q = (s) => !!document.querySelector(s);
    return { drop: q('[data-av-import-drop]'), file: id('av-import-file'), dir: id('av-import-dir'),
             pick: id('av-import-pick'), pickdir: id('av-import-pickdir'), status: id('av-import-status'),
             counts: id('av-import-counts'), report: id('av-import-report'), lib: id('av-import-lib'),
             slot: id('av-import-slot'), note: id('av-import-note'), empty: id('av-import-empty') };
  })()`);
  const lg = legacyR.value || {};
  check('hub boot: legacy ids intact (drop/file/dir/pick/pickdir/status/counts/report/lib/slot/note/empty)',
    lg.drop === true && lg.file === true && lg.dir === true && lg.pick === true && lg.pickdir === true
    && lg.status === true && lg.counts === true && lg.report === true && lg.lib === true
    && lg.slot === true && lg.note === true && lg.empty === true, JSON.stringify(lg));

  /* ── 3. boot: the new manager / receipts / storage ids ── */
  const newR = await ev(`(() => {
    const id = (x) => !!document.getElementById(x);
    return { search: id('av-import-search'), sort: id('av-import-sort'), filters: id('av-import-filters'),
             selall: id('av-import-selall'), delsel: id('av-import-delsel'), runs: id('av-import-runs'),
             runsclear: id('av-import-runsclear'), runsEmpty: id('av-import-runs-empty'),
             storage: id('av-import-storage'), persist: id('av-import-persist') };
  })()`);
  const nw = newR.value || {};
  check('hub boot: new ids (search/sort/filters/selall/delsel/runs/runsclear/runs-empty/storage/persist)',
    nw.search === true && nw.sort === true && nw.filters === true && nw.selall === true && nw.delsel === true
    && nw.runs === true && nw.runsclear === true && nw.runsEmpty === true && nw.storage === true && nw.persist === true,
    JSON.stringify(nw));

  /* ── 4/5. facades ── */
  const facR = await ev(`(() => {
    const f = window.__avImport || {};
    const g = window.__avLib || {};
    return { pick: typeof f.pick, pickDir: typeof f.pickDir, library: typeof f.library,
             rename: typeof f.rename, exportItem: typeof f.exportItem,
             importFiles: typeof f.importFiles, snap: typeof f.snap,
             lrename: typeof g.rename, recSave: typeof g.receiptSave, recList: typeof g.receiptList,
             recClear: typeof g.receiptClear, list: typeof g.list, get: typeof g.get };
  })()`);
  const fc = facR.value || {};
  check('facade __avImport: pick/pickDir/library/rename/exportItem + existing keys kept',
    fc.pick === 'function' && fc.pickDir === 'function' && fc.library === 'function'
    && fc.rename === 'function' && fc.exportItem === 'function'
    && fc.importFiles === 'function' && fc.snap === 'function', JSON.stringify(fc));
  check('facade __avLib: rename/receiptSave/receiptList/receiptClear + list/get kept',
    fc.lrename === 'function' && fc.recSave === 'function' && fc.recList === 'function'
    && fc.recClear === 'function' && fc.list === 'function' && fc.get === 'function', JSON.stringify(fc));

  /* ── 6. menubar: the File entries ── */
  const menuR = await ev(`(() => {
    let labels = [];
    try {
      if (window.__avMenubar && typeof window.__avMenubar.open === 'function') {
        window.__avMenubar.open('file');
        const pop = document.getElementById('av-menu-pop');
        labels = pop ? Array.prototype.map.call(pop.querySelectorAll('.av-menu-mi'), function (el) { return String(el.textContent || '').trim(); }) : [];
        window.__avMenubar.close();
      }
    } catch (e) { labels = []; }
    return { labels: labels };
  })()`);
  const menu = menuR.value || {};
  check('menubar File: Import sounds... / Import folder... / Library... present',
    Array.isArray(menu.labels) && menu.labels.indexOf('Import sounds...') >= 0
    && menu.labels.indexOf('Import folder...') >= 0 && menu.labels.indexOf('Library...') >= 0,
    JSON.stringify(menu.labels));

  /* ── 7. library jump: the File item AND avImportUiLibrary() land on the store pane ── */
  const jumpR = await ev(`(() => {
    const visible = () => { const shown = Array.prototype.filter.call(document.querySelectorAll('.av-zone'), function (z) { return !z.hidden; }); return shown[0] ? shown[0].getAttribute('data-zone') : null; };
    let clicked = false;
    try {
      window.__avMenubar.open('file');
      const pop = document.getElementById('av-menu-pop');
      const item = pop ? Array.prototype.find.call(pop.querySelectorAll('.av-menu-mi'), function (el) { return String(el.textContent || '').trim() === 'Library...'; }) : null;
      if (item) { item.click(); clicked = true; }
      window.__avMenubar.close();
    } catch (e) { clicked = false; }
    return { clicked: clicked, afterMenu: visible() };
  })()`);
  const jm = jumpR.value || {};
  const jump2R = await ev(`(() => {
    const visible = () => { const shown = Array.prototype.filter.call(document.querySelectorAll('.av-zone'), function (z) { return !z.hidden; }); return shown[0] ? shown[0].getAttribute('data-zone') : null; };
    const okSynth = (typeof avZoneShow === 'function') ? avZoneShow('synth', { source: 'rig' }) : false;
    const mid = visible();
    const ret = (typeof avImportUiLibrary === 'function') ? avImportUiLibrary() : null;
    return { okSynth: okSynth, mid: mid, ret: ret, end: visible() };
  })()`);
  const j2 = jump2R.value || {};
  check('library jump: File > Library... and avImportUiLibrary() switch to the store pane (returns true)',
    jm.clicked === true && jm.afterMenu === 'store' && j2.okSynth === true && j2.mid === 'synth'
    && j2.ret === true && j2.end === 'store', JSON.stringify({ menu: jm, fn: j2 }));

  /* ── 8. import run 1: WAV + SMF + unknown through the card change handler ── */
  const run1R = await ev(`(() => {
    try {
      if (typeof avWavEncode !== 'function') return { err: 'avWavEncode absent' };
      const sr = 8000, n = 400;
      const lch = new Float32Array(n), rch = new Float32Array(n);
      for (let i = 0; i < n; i++) { const v = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr); lch[i] = v; rch[i] = v; }
      const wav = avWavEncode({ l: lch, r: rch, sr: sr, bits: 16, dither: false });
      if (!wav) return { err: 'avWavEncode null' };
      const m = [];
      const mp = (...xs) => { for (const x of xs) m.push(x & 255); };
      const m32 = (v) => { mp(v >>> 24, v >>> 16, v >>> 8, v); };
      const m16 = (v) => { mp(v >> 8, v); };
      const tag = (s) => { mp(s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)); };
      tag('MThd'); m32(6); m16(0); m16(1); m16(480);
      tag('MTrk'); m32(13);
      mp(0x00, 0x90, 60, 100, 0x83, 0x5F, 0x80, 60, 0, 0x00, 0xFF, 0x2F, 0x00);
      const mid = new Uint8Array(m);
      const unk = new Uint8Array([66, 73, 78, 1, 2, 3, 4, 5]);
      const dt = new DataTransfer();
      dt.items.add(new File([wav], 'hub-alpha.wav'));
      dt.items.add(new File([mid], 'hub-mike.mid'));
      dt.items.add(new File([unk], 'mystery.bin'));
      const inp = document.getElementById('av-import-file');
      if (!inp) return { err: 'no #av-import-file' };
      inp.files = dt.files;
      const filesN = inp.files ? inp.files.length : -1;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return { filesN: filesN, wavLen: wav.byteLength };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  let rows1 = await waitFor(`document.querySelectorAll('#av-import-report [data-av-import-row]').length === 3 ? 3 : 0`, 15000);
  if (!rows1) {
    note('change-drive produced no run within 15 s — falling back to __avImport.importFiles([...])');
    await ev(`(async () => {
      try {
        const sr = 8000, n = 400;
        const lch = new Float32Array(n), rch = new Float32Array(n);
        for (let i = 0; i < n; i++) { const v = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr); lch[i] = v; rch[i] = v; }
        const wav = avWavEncode({ l: lch, r: rch, sr: sr, bits: 16, dither: false });
        const m = [];
        const mp = (...xs) => { for (const x of xs) m.push(x & 255); };
        const m32 = (v) => { mp(v >>> 24, v >>> 16, v >>> 8, v); };
        const m16 = (v) => { mp(v >> 8, v); };
        const tag = (s) => { mp(s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)); };
        tag('MThd'); m32(6); m16(0); m16(1); m16(480);
        tag('MTrk'); m32(13);
        mp(0x00, 0x90, 60, 100, 0x83, 0x5F, 0x80, 60, 0, 0x00, 0xFF, 0x2F, 0x00);
        const f = window.__avImport;
        if (f && typeof f.importFiles === 'function') await f.importFiles([new File([wav], 'hub-alpha.wav'), new File([new Uint8Array(m)], 'hub-mike.mid'), new File([new Uint8Array([66, 73, 78, 1, 2, 3, 4, 5])], 'mystery.bin')]);
      } catch (e) { /* the poll below reports */ }
      return true;
    })()`);
    rows1 = await waitFor(`document.querySelectorAll('#av-import-report [data-av-import-row]').length === 3 ? 3 : 0`, 20000);
  }
  const snap1 = (await ev(`(window.__avImport && window.__avImport.snap) ? window.__avImport.snap() : null`)).value || {};
  const items1 = snap1.report || [];
  const byName1 = (nm) => items1.find(i => i && i.name === nm) || null;
  const rAlpha = byName1('hub-alpha.wav'), rMike = byName1('hub-mike.mid'), rUnk = byName1('mystery.bin');
  const c1 = snap1.last && snap1.last.counts ? snap1.last.counts : null;
  check('import run 1: three files land (2 imported + 1 unknown honest) via the change handler',
    !!run1R.value && run1R.value.filesN === 3 && rows1 === 3
    && !!c1 && c1.total === 3 && c1.imported === 2 && (c1.deferred + c1.refused) === 1
    && c1.samples === 1 && c1.patterns === 1
    && !!rAlpha && rAlpha.result === 'imported' && !!rMike && rMike.result === 'imported'
    && !!rUnk && rUnk.result !== 'imported',
    JSON.stringify({ filesN: run1R.value && run1R.value.filesN, counts: c1,
      alpha: rAlpha && rAlpha.result, mike: rMike && rMike.result,
      unk: rUnk && { result: rUnk.result, reason: String(rUnk.reason || '').slice(0, 60) } }));

  /* ── 9. import run 1: the library gains the imports; the unknown file is NOT persisted ── */
  const lib1 = await waitFor(`(async () => {
    try {
      if (typeof avLibList !== 'function') return null;
      const l = await avLibList();
      if (!l || l.ok !== true || l.count !== 2) return null;
      const names = (l.items || []).map(i => String(i.name)).sort().join(',');
      const dom = document.querySelectorAll('#av-import-lib [data-av-import-lib]').length;
      return { count: l.count, names: names, dom: dom };
    } catch (e) { return null; }
  })()`, 15000);
  check('import run 1: library gains the 2 imports (unknown not persisted) + DOM rows match',
    !!lib1 && lib1.count === 2 && lib1.names === 'hub-alpha.wav,hub-mike.mid' && lib1.dom === 2,
    JSON.stringify(lib1));

  /* ── 10. import run 1: the receipt persisted ── */
  const rc1 = await waitFor(`(async () => {
    try {
      if (typeof avLibReceiptList !== 'function') return null;
      const r = await avLibReceiptList();
      if (!r || r.ok !== true || r.count !== 1) return null;
      const rows = document.querySelectorAll('#av-import-runs [data-av-import-run]').length;
      if (rows !== 1) return null;
      const snap = (window.__avImport && window.__avImport.snap) ? window.__avImport.snap() : {};
      const emptyEl = document.getElementById('av-import-runs-empty');
      const rowEl = document.querySelector('#av-import-runs [data-av-import-run]');
      return { count: r.count, backend: String(r.backend || ''), rows: rows,
               snapRuns: snap.runs, emptyHidden: emptyEl ? emptyEl.hidden === true : null,
               rowText: String((rowEl && rowEl.textContent) || '') };
    } catch (e) { return null; }
  })()`, 20000);
  check('import run 1: receipt persisted (avLibReceiptList 1 + #av-import-runs 1 row, empty line hidden)',
    !!rc1 && rc1.count === 1 && rc1.rows === 1 && rc1.snapRuns === 1 && rc1.emptyHidden === true
    && rc1.backend.length > 0 && /imported\s+2/.test(rc1.rowText),
    JSON.stringify(rc1));

  /* ── 11. import run 2: a second run -> receipt count 2 ── */
  await ev(`(() => {
    try {
      const sr = 8000, n = 400;
      const lch = new Float32Array(n), rch = new Float32Array(n);
      for (let i = 0; i < n; i++) { const v = 0.35 * Math.sin(2 * Math.PI * 220 * i / sr); lch[i] = v; rch[i] = v; }
      const wav = avWavEncode({ l: lch, r: rch, sr: sr, bits: 16, dither: false });
      const dt = new DataTransfer();
      dt.items.add(new File([wav], 'hub-zulu.wav'));
      const inp = document.getElementById('av-import-file');
      if (!inp) return { err: 'no input' };
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  const rc2 = await waitFor(`(async () => {
    try {
      if (typeof avLibReceiptList !== 'function') return null;
      const r = await avLibReceiptList();
      if (!r || r.ok !== true || r.count !== 2) return null;
      const rows = document.querySelectorAll('#av-import-runs [data-av-import-run]').length;
      if (rows !== 2) return null;
      const rep = document.querySelectorAll('#av-import-report [data-av-import-row]').length;
      const l = await avLibList();
      const z = (l.items || []).find(i => i.name === 'hub-zulu.wav');
      const c0 = (r.runs && r.runs[0] && r.runs[0].counts) ? r.runs[0].counts : null;
      return { count: r.count, rows: rows, rep: rep, zulu: !!z, c0: c0 };
    } catch (e) { return null; }
  })()`, 20000);
  check('import run 2: a second run -> receipt count 2 + #av-import-runs 2 rows',
    !!rc2 && rc2.count === 2 && rc2.rows === 2 && rc2.rep === 1 && rc2.zulu === true
    && !!rc2.c0 && rc2.c0.total === 1 && rc2.c0.imported === 1, JSON.stringify(rc2));

  /* ── 12/13. persistence leg: RELOAD (house law: navigate -> waitReady -> re-acquire) ── */
  await send('Page.navigate', { url: baseUrl });
  const ready2 = await waitReady();
  note('reloaded (plain page) — ready=' + ready2);
  const pers1 = await waitFor(`(async () => {
    try {
      if (typeof avLibReceiptList !== 'function') return null;
      const r = await avLibReceiptList();
      if (!r || r.ok !== true || r.count !== 2) return null;
      const rows = document.querySelectorAll('#av-import-runs [data-av-import-run]').length;
      if (rows !== 2) return null;
      const a = r.runs[0] || {}, bb = r.runs[1] || {};
      return { count: r.count, rows: rows, a: a.counts || null, b: bb.counts || null };
    } catch (e) { return null; }
  })()`, 25000);
  check('reload: receipts survive fresh (count 2 + the stored counts intact + runs rows reborn)',
    !!pers1 && pers1.count === 2 && pers1.rows === 2
    && !!pers1.a && pers1.a.total === 1 && pers1.a.imported === 1
    && !!pers1.b && pers1.b.total === 3 && pers1.b.imported === 2, JSON.stringify(pers1));
  const libFront = await waitFor(`(async () => {
    try {
      if (typeof avLibList !== 'function') return null;
      const l = await avLibList();
      if (!l || l.ok !== true || l.count !== 3) return null;
      const names = (l.items || []).map(i => String(i.name)).sort().join(',');
      const dom = document.querySelectorAll('#av-import-lib [data-av-import-lib]').length;
      return { count: l.count, names: names, dom: dom };
    } catch (e) { return null; }
  })()`, 20000);
  check('reload: the library loads fresh (3 items + DOM rows 3)',
    !!libFront && libFront.count === 3 && libFront.names === 'hub-alpha.wav,hub-mike.mid,hub-zulu.wav'
    && libFront.dom === 3, JSON.stringify(libFront));

  /* ── 14. rename via the facade: applies + refuses an empty name ── */
  const renR = await ev(`(async () => {
    try {
      if (typeof avLibList !== 'function') return { missing: true };
      const l0 = await avLibList();
      const it = (l0.items || []).find(i => i.name === 'hub-alpha.wav') || null;
      if (!it) return { missingItem: true };
      const f = window.__avLib || {};
      const hub = window.__avImport || {};
      /* R17 rig SPEC fix (first run): the DOM-refresh witness rides the UI commit path
         (avImportUiRename accepts -> settles async -> refreshes the manager); it returns
         true = accepted, so the applied name is awaited through avLibList below. */
      const acc = (typeof hub.rename === 'function') ? await hub.rename(it.id, 'hub-bravo.wav') : null;
      let now = {};
      for (let i = 0; i < 60; i++) {
        const l1 = await avLibList();
        now = (l1.items || []).find(v => v.id === it.id) || {};
        if (String(now.name || '') === 'hub-bravo.wav') break;
        await new Promise(function (r) { setTimeout(r, 250); });
      }
      const r2 = (typeof f.rename === 'function') ? await f.rename(it.id, '   ') : null;
      const l2 = await avLibList();
      const still = (l2.items || []).find(i => i.id === it.id) || {};
      return { id: it.id, acc: acc === true,
               nowName: String(now.name || ''),
               r2: r2 ? { ok: r2.ok, name: String(r2.name == null ? '' : r2.name), err: String(r2.error || '') } : null,
               stillName: String(still.name || '') };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  const ren = renR.value || {};
  const renDom = await waitFor(`(() => {
    const rows = Array.prototype.slice.call(document.querySelectorAll('#av-import-lib [data-av-import-lib]'));
    const hit = rows.find(function (r) { return String(r.textContent || '').indexOf('hub-bravo.wav') >= 0; });
    const old = rows.find(function (r) { return String(r.textContent || '').indexOf('hub-alpha.wav') >= 0; });
    return hit && !old ? { hit: true } : null;
  })()`, 10000);
  check('rename: avLibRename applies via the UI commit (avLibList + manager DOM); empty name refused',
    !!ren && ren.acc === true && ren.nowName === 'hub-bravo.wav'
    && !!ren.r2 && ren.r2.ok === false && ren.r2.name === '' && ren.stillName === 'hub-bravo.wav'
    && !!renDom && renDom.hit === true,
    JSON.stringify({ ren: ren, dom: renDom }));

  /* ── 15. rename persists across a second RELOAD ── */
  await send('Page.navigate', { url: baseUrl });
  const ready3 = await waitReady();
  note('reloaded again — ready=' + ready3);
  const persRen = await waitFor(`(async () => {
    try {
      if (typeof avLibList !== 'function') return null;
      const l = await avLibList();
      if (!l || l.ok !== true || l.count !== 3) return null;
      const names = (l.items || []).map(i => String(i.name));
      const r = await avLibReceiptList();
      return { bravo: names.indexOf('hub-bravo.wav') >= 0, alpha: names.indexOf('hub-alpha.wav') >= 0,
               receipts: r && r.ok ? r.count : -1 };
    } catch (e) { return null; }
  })()`, 25000);
  check('reload: the renamed item persists (hub-bravo.wav present, hub-alpha.wav gone)',
    !!persRen && persRen.bravo === true && persRen.alpha === false && persRen.receipts === 2,
    JSON.stringify(persRen));

  /* ── 16. manager search: 3 items -> 1 hit ── */
  await ev(`(() => {
    const s = document.getElementById('av-import-search');
    if (!s) return { missing: true };
    s.value = 'mike';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('keyup', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  })()`);
  const searchRes = await waitFor(`(() => {
    const rows = Array.prototype.slice.call(document.querySelectorAll('#av-import-lib [data-av-import-lib]'));
    if (rows.length !== 1) return null;
    const txt = String(rows[0].textContent || '');
    if (txt.indexOf('hub-mike.mid') < 0) return null;
    const snap = (window.__avImport && window.__avImport.snap) ? window.__avImport.snap() : {};
    const m = snap.manager || {};
    return { rows: rows.length, hit: txt.indexOf('hub-mike.mid') >= 0, search: m.search };
  })()`, 10000);
  check('manager search: "mike" narrows 3 items -> 1 hit (snap manager.search)',
    !!searchRes && searchRes.rows === 1 && searchRes.hit === true && searchRes.search === 'mike',
    JSON.stringify(searchRes));
  await ev(`(() => { const s = document.getElementById('av-import-search'); if (s) { s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); } return true; })()`);
  await waitFor(`document.querySelectorAll('#av-import-lib [data-av-import-lib]').length === 3 ? 3 : 0`, 8000);

  /* ── 17. manager filters: chips narrow by kind ── */
  const chipClick = (f) => ev(`(() => { const c = document.querySelector('#av-import-filters [data-f="' + ${JSON.stringify(String(f))} + '"]'); if (!c) return { missing: true }; c.click(); return { ok: true }; })()`);
  const fstate = (want) => waitFor(`(() => {
    const rows = document.querySelectorAll('#av-import-lib [data-av-import-lib]').length;
    if (rows !== ${want}) return null;
    const snap = (window.__avImport && window.__avImport.snap) ? window.__avImport.snap() : {};
    const m = snap.manager || {};
    const on = Array.prototype.map.call(document.querySelectorAll('#av-import-filters [data-f]'), function (c) { return c.getAttribute('data-f') + (c.classList && c.classList.contains('on') ? ':on' : ':'); }).join(',');
    return { rows: rows, filter: m.filter, on: on };
  })()`, 10000);
  await chipClick('pattern');
  const fPat = await fstate(1);
  await chipClick('sample');
  const fSam = await fstate(2);
  await chipClick('all');
  const fAll = await fstate(3);
  check('manager filter: chips narrow pattern -> 1, sample -> 2, all -> 3 (snap manager.filter)',
    !!fPat && fPat.rows === 1 && fPat.filter === 'pattern' && String(fPat.on).indexOf('pattern:on') >= 0
    && !!fSam && fSam.rows === 2
    && !!fAll && fAll.rows === 3 && String(fAll.on).indexOf('all:on') >= 0,
    JSON.stringify({ pattern: fPat, sample: fSam, all: fAll }));

  /* ── 18. manager sort: name vs newest flips the order ── */
  const namesOf = `(function () {
    const nm = function (r) {
      const e = r.querySelector('.av-import-item-name');
      if (e) return String(e.textContent || '').trim();
      const t = String(r.textContent || '');
      const k = ['hub-bravo.wav', 'hub-mike.mid', 'hub-zulu.wav'].find(function (x) { return t.indexOf(x) >= 0; });
      return k || '';
    };
    return Array.prototype.map.call(document.querySelectorAll('#av-import-lib [data-av-import-lib]'), nm);
  })()`;
  const ord0 = (await ev(namesOf)).value;
  const ord0Join = JSON.stringify((Array.isArray(ord0) ? ord0 : []).join(','));
  await ev(`(() => { const s = document.getElementById('av-import-sort'); if (!s) return { missing: true }; s.value = 'name'; s.dispatchEvent(new Event('change', { bubbles: true })); return { ok: true }; })()`);
  const sortN = await waitFor(`(() => {
    const names = ${namesOf};
    if (!names.length || names.join() === ${ord0Join}) return null;   /* wait for the flip */
    const snap = (window.__avImport && window.__avImport.snap) ? window.__avImport.snap() : {};
    const m = snap.manager || {};
    return { names: names, sort: m.sort };
  })()`, 10000);
  await ev(`(() => { const s = document.getElementById('av-import-sort'); if (!s) return { missing: true }; s.value = 'newest'; s.dispatchEvent(new Event('change', { bubbles: true })); return { ok: true }; })()`);
  const sortBack = await waitFor(`(() => {
    const names = ${namesOf};
    if (!names.length || names.join() !== ${ord0Join}) return null;   /* wait for the round-trip */
    const snap = (window.__avImport && window.__avImport.snap) ? window.__avImport.snap() : {};
    const m = snap.manager || {};
    return { names: names, sort: m.sort };
  })()`, 10000);
  /* R17 rig SPEC fix (first run): newest-first = [zulu (run 2), mike, bravo]; "name" is the
     exact reverse; flipping back restores the newest order byte-for-byte. */
  check('manager sort: name vs newest flips the order (snap manager.sort)',
    Array.isArray(ord0) && ord0.length === 3 && ord0[0] === 'hub-zulu.wav'
    && !!sortN && Array.isArray(sortN.names) && sortN.names.join() === ord0.slice().reverse().join() && sortN.sort === 'name'
    && !!sortBack && Array.isArray(sortBack.names) && sortBack.names.join() === ord0.join() && sortBack.sort === 'newest',
    JSON.stringify({ newest: ord0, name: sortN && sortN.names, back: sortBack && sortBack.names }));

  /* ── 19. manager select-all: all visible rows check + delete-selected arms ── */
  await ev(`(() => { const b = document.getElementById('av-import-selall'); if (!b) return { missing: true }; b.click(); return { ok: true }; })()`);
  const selA = await waitFor(`(() => {
    const on = function (el) { return !!(el && (el.checked === true || el.getAttribute('aria-checked') === 'true' || (el.classList && el.classList.contains('on')))); };
    const boxes = Array.prototype.slice.call(document.querySelectorAll('#av-import-lib [data-av-import-check]'));
    const n = boxes.filter(on).length;
    if (n !== 3 || boxes.length !== 3) return null;
    const d = document.getElementById('av-import-delsel');
    const armed = !!d && d.disabled !== true && d.getAttribute('aria-disabled') !== 'true';
    if (!armed) return null;
    const snap = (window.__avImport && window.__avImport.snap) ? window.__avImport.snap() : {};
    const m = snap.manager || {};
    return { checked: n, armed: armed, selected: m.selected };
  })()`, 10000);
  const selOk = (v) => (typeof v === 'number' && v === 3) || (Array.isArray(v) && v.length === 3);
  check('manager select-all: all 3 visible rows check + delete-selected arms (snap selected 3)',
    !!selA && selA.checked === 3 && selA.armed === true && selOk(selA.selected), JSON.stringify(selA));

  /* ── 20. manager delete-selected: only the checked rows go ── */
  const bravoId = (await ev(`(async () => { const l = await avLibList(); const it = (l.items || []).find(i => i.name === 'hub-bravo.wav'); return it ? it.id : null; })()`)).value;
  await ev(`(() => {
    if (!${JSON.stringify(bravoId)}) return { missing: true };
    const row = document.querySelector('#av-import-lib [data-av-import-lib="' + ${JSON.stringify(bravoId)} + '"]');
    if (!row) return { missing: true };
    const c = row.querySelector('[data-av-import-check]');
    if (!c) return { missing: true };
    c.click();
    return { ok: true };
  })()`);
  const un1 = await waitFor(`(() => {
    const on = function (el) { return !!(el && (el.checked === true || el.getAttribute('aria-checked') === 'true' || (el.classList && el.classList.contains('on')))); };
    return Array.prototype.filter.call(document.querySelectorAll('#av-import-lib [data-av-import-check]'), on).length === 2 ? 2 : 0;
  })()`, 8000);
  await ev(`(() => { const b = document.getElementById('av-import-delsel'); if (!b) return { missing: true }; b.click(); return { ok: true }; })()`);
  const del1 = await waitFor(`(async () => {
    try {
      const l = await avLibList();
      if (!l || l.ok !== true || l.count !== 1) return null;
      const names = (l.items || []).map(i => String(i.name));
      const rows = document.querySelectorAll('#av-import-lib [data-av-import-lib]').length;
      const st = String((document.getElementById('av-import-status') || {}).textContent || '');
      const d = document.getElementById('av-import-delsel');
      const disarmed = !!d && (d.disabled === true || d.getAttribute('aria-disabled') === 'true');
      if (!disarmed) return null;
      return { count: l.count, rows: rows, names: names, status: st, disarmed: disarmed };
    } catch (e) { return null; }
  })()`, 20000);
  check('manager delete selected: the checked rows go, the unchecked row intact (deleted 2)',
    !!del1 && del1.count === 1 && del1.rows === 1 && del1.names.length === 1 && del1.names[0] === 'hub-bravo.wav'
    && /deleted\s+2/.test(del1.status) && del1.disarmed === true, JSON.stringify(del1));

  /* ── 21. export via the avDeliverDownload spy ── */
  const exp0 = await ev(`(async () => {
    try {
      const l = await avLibList();
      const it = (l.items || []).find(i => i.name === 'hub-bravo.wav') || null;
      if (!it) return { missing: true };
      const sr = 8000, n = 400;
      const lch = new Float32Array(n), rch = new Float32Array(n);
      for (let i = 0; i < n; i++) { const v = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr); lch[i] = v; rch[i] = v; }
      const wav = (typeof avWavEncode === 'function') ? avWavEncode({ l: lch, r: rch, sr: sr, bits: 16, dither: false }) : null;
      window.__hubSpyGot = null; window.__hubSpyCalls = 0;
      window.__hubSpyOrig = window.avDeliverDownload;
      window.avDeliverDownload = function (bytes, name) {
        window.__hubSpyCalls++;
        window.__hubSpyGot = { len: (bytes && typeof bytes.byteLength === 'number') ? bytes.byteLength : -1, name: String(name == null ? '' : name) };
        return true;
      };
      return { id: it.id, size: it.size, L: wav ? wav.byteLength : -1, hadOrig: typeof window.__hubSpyOrig === 'function' };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  const ex = exp0.value || {};
  await ev(`(async () => { try { if (window.__avImport && typeof window.__avImport.exportItem === 'function' && ${JSON.stringify(ex.id || '')}) await window.__avImport.exportItem(${JSON.stringify(ex.id || '')}); } catch (e) { /* the poll below reports */ } return true; })()`);
  const gotR = await waitFor(`window.__hubSpyGot ? { got: window.__hubSpyGot, n: window.__hubSpyCalls } : null`, 10000);
  await sleep(250);
  const expStatus = (await ev(`String((document.getElementById('av-import-status') || {}).textContent || '')`)).value || '';
  const rstR = await ev(`(() => { const o = window.__hubSpyOrig; window.avDeliverDownload = o; window.__hubSpyOrig = null; return { restored: window.avDeliverDownload === o, isFn: typeof window.avDeliverDownload === 'function' }; })()`);
  const rst = rstR.value || {};
  check('export: spy got (bytes, filename) — length === stored size + the name carries the ext; original restored',
    !!ex && ex.hadOrig === true && typeof ex.size === 'number' && ex.size > 44 && ex.size === ex.L
    && !!gotR && gotR.n === 1 && !!gotR.got && gotR.got.len === ex.size
    && /bravo/.test(gotR.got.name) && gotR.got.name.slice(-4).toLowerCase() === '.wav'
    && rst.restored === true && rst.isFn === true && /exported/i.test(expStatus),
    JSON.stringify({ ex: { size: ex.size, L: ex.L, id: !!ex.id }, got: gotR && gotR.got, calls: gotR && gotR.n, restored: rst, status: expStatus.slice(0, 80) }));

  /* ── 22. storage line ── */
  const stLine = await waitFor(`(() => {
    const el = document.getElementById('av-import-storage');
    const t = el ? String(el.textContent || '').trim() : '';
    return t.slice(0, 8).toLowerCase() === 'storage:' ? t : null;
  })()`, 10000);
  check('storage: the footer line is honest (storage: <used> of <quota> · <tier> or the unavailable fallback)',
    !!stLine && (stLine.indexOf(' of ') > 0 || stLine.toLowerCase().indexOf('unavailable') >= 0),
    JSON.stringify(stLine));

  /* ── 23. persist: the honest result reaches the status line ── */
  const prR = await ev(`(async () => {
    try {
      if (typeof avStorePersist !== 'function') return { missing: true };
      const r = await avStorePersist();
      return { ok: typeof (r && r.ok) === 'boolean', persisted: typeof (r && r.persisted) === 'boolean',
               val: r && { ok: r.ok, persisted: r.persisted, error: String((r && r.error) || '') } };
    } catch (e) { return { threw: String((e && e.message) || e) }; }
  })()`);
  const pr = prR.value || {};
  await clickSel('#av-import-persist', 500);
  const pstText = await waitFor(`(() => {
    const t = String((document.getElementById('av-import-status') || {}).textContent || '');
    return (t.indexOf('persistent storage') >= 0 || t.indexOf('unsupported') >= 0) ? t : null;
  })()`, 10000);
  const claimsGrant = !!pstText && /granted/i.test(pstText) && !/not granted/i.test(pstText) && !/unsupported/i.test(pstText);
  const granted = !!(pr && pr.val && pr.val.persisted === true);   /* the honest grant value, not the shape flag */
  const persistHonest = granted ? claimsGrant === true : claimsGrant === false;
  check('persist: avStorePersist() resolves {ok,persisted} honestly + the button writes the honest result',
    !!pr && pr.ok === true && pr.persisted === true && !pr.threw && !pr.missing
    && !!pstText && persistHonest, JSON.stringify({ res: pr.val || pr, status: pstText && pstText.slice(0, 90), claimsGrant: claimsGrant }));

  /* ── 24. drop-anywhere: a non-hub drop routes to the store pane and imports exactly once ── */
  const before24 = await receiptsNow();
  const zon24 = await ev(`(() => {
    const ok = (typeof avZoneShow === 'function') ? avZoneShow('synth', { source: 'rig' }) : false;
    const shown = Array.prototype.filter.call(document.querySelectorAll('.av-zone'), function (z) { return !z.hidden; });
    return { ok: ok, zone: shown[0] ? shown[0].getAttribute('data-zone') : null };
  })()`);
  const drop24R = await ev(`(() => {
    try {
      const sr = 8000, n = 200;
      const lch = new Float32Array(n), rch = new Float32Array(n);
      for (let i = 0; i < n; i++) { const v = 0.4 * Math.sin(2 * Math.PI * 330 * i / sr); lch[i] = v; rch[i] = v; }
      const wav = avWavEncode({ l: lch, r: rch, sr: sr, bits: 16, dither: false });
      const dt = new DataTransfer();
      dt.items.add(new File([wav], 'drop-one.wav'));
      const host = document.getElementById('av-import-host');
      const t = document.getElementById('av-zone-synth');
      if (!t || !host) return { missing: true };
      if (host.contains(t)) return { hubTarget: true };
      t.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return { ok: true };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  const settle24 = await waitFor(`(async () => {
    try {
      const r = await avLibReceiptList();
      if (!r || r.ok !== true || r.count !== ${before24 + 1}) return null;
      const shown = Array.prototype.filter.call(document.querySelectorAll('.av-zone'), function (z) { return !z.hidden; });
      const zone = shown[0] ? shown[0].getAttribute('data-zone') : null;
      if (zone !== 'store') return null;
      const rows = document.querySelectorAll('#av-import-runs [data-av-import-run]').length;
      const rep = document.querySelectorAll('#av-import-report [data-av-import-row]').length;
      const l = await avLibList();
      const hit = (l.items || []).filter(i => i.name === 'drop-one.wav').length;
      return { count: r.count, zone: zone, rows: rows, rep: rep, hit: hit };
    } catch (e) { return null; }
  })()`, 20000);
  await sleep(900);
  const after24 = await receiptsNow();
  check('drop-anywhere: a non-hub drop routes to the store pane and imports exactly once',
    !!zon24.value && zon24.value.zone === 'synth' && !!drop24R.value && drop24R.value.ok === true
    && !!settle24 && settle24.count === before24 + 1 && settle24.zone === 'store'
    && settle24.rows === before24 + 1 && settle24.rep === 1 && settle24.hit === 1
    && after24 === before24 + 1 && before24 >= 0,
    JSON.stringify({ before: before24, settle: settle24, after: after24, drop: drop24R.value && drop24R.value.err }));

  /* ── 25. containment guard: a drop INSIDE the hub drop zone imports exactly once ── */
  const before25 = await receiptsNow();
  const drop25R = await ev(`(() => {
    try {
      const sr = 8000, n = 200;
      const lch = new Float32Array(n), rch = new Float32Array(n);
      for (let i = 0; i < n; i++) { const v = 0.3 * Math.sin(2 * Math.PI * 165 * i / sr); lch[i] = v; rch[i] = v; }
      const wav = avWavEncode({ l: lch, r: rch, sr: sr, bits: 16, dither: false });
      const dt = new DataTransfer();
      dt.items.add(new File([wav], 'drop-two.wav'));
      const zone = document.querySelector('#av-import-host [data-av-import-drop]');
      if (!zone) return { missing: true };
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return { ok: true };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  const settle25 = await waitFor(`(async () => {
    try {
      const r = await avLibReceiptList();
      if (!r || r.ok !== true || r.count !== ${before25 + 1}) return null;
      const rows = document.querySelectorAll('#av-import-runs [data-av-import-run]').length;
      const rep = document.querySelectorAll('#av-import-report [data-av-import-row]').length;
      const l = await avLibList();
      const hit = (l.items || []).filter(i => i.name === 'drop-two.wav').length;
      return { count: r.count, rows: rows, rep: rep, hit: hit };
    } catch (e) { return null; }
  })()`, 20000);
  await sleep(900);
  const after25 = await receiptsNow();
  check('drop inside the hub: imports exactly once — containment guard, no double import',
    !!drop25R.value && drop25R.value.ok === true
    && !!settle25 && settle25.count === before25 + 1 && settle25.rows === before25 + 1
    && settle25.rep === 1 && settle25.hit === 1
    && after25 === before25 + 1 && before25 >= 0,
    JSON.stringify({ before: before25, settle: settle25, after: after25 }));

  /* ── 25b. regression guard (battery v1, cdp_sample): a drop on the SAMPLE CARD's own drop
     surface stays the sample card's -- the hub must not run, and the pane must not yank to
     the store zone (an UNCLAIMED drop still routes: leg 24). ── */
  const before25b = await receiptsNow();
  const zon25b = await ev(`(() => {
    const ok = (typeof avZoneShow === 'function') ? avZoneShow('synth', { source: 'rig' }) : false;
    const shown = Array.prototype.filter.call(document.querySelectorAll('.av-zone'), function (z) { return !z.hidden; });
    return { ok: ok, zone: shown[0] ? shown[0].getAttribute('data-zone') : null };
  })()`);
  await sleep(250);
  const n25b = (await ev(`avSampleStore.entries.length`)).value;
  const drop25bR = await ev(`(() => {
    try {
      const sr = 8000, n = 200;
      const lch = new Float32Array(n), rch = new Float32Array(n);
      for (let i = 0; i < n; i++) { const v = 0.25 * Math.sin(2 * Math.PI * 220 * i / sr); lch[i] = v; rch[i] = v; }
      const wav = avWavEncode({ l: lch, r: rch, sr: sr, bits: 16, dither: false });
      const dt = new DataTransfer();
      dt.items.add(new File([wav], 'card-kept.wav'));
      const t = document.querySelector('#av-sample-host [data-av-sample-drop]');
      if (!t) return { missing: true };
      t.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return { ok: true };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  const settle25b = await waitFor(`(async () => {
    try {
      const es = avSampleStore.entries.length;
      if (es !== ${Number(n25b) + 1}) return null;
      const r = await avLibReceiptList();
      const shown = Array.prototype.filter.call(document.querySelectorAll('.av-zone'), function (z) { return !z.hidden; });
      const zone = shown[0] ? shown[0].getAttribute('data-zone') : null;
      return { entries: es, receipts: r && r.ok ? r.count : -1, zone: zone };
    } catch (e) { return null; }
  })()`, 20000);
  await sleep(900);
  const after25b = await receiptsNow();
  check('drop on the sample card stays the sample card (no hub receipt, no store yank)',
    !!zon25b.value && zon25b.value.zone === 'synth' && !!drop25bR.value && drop25bR.value.ok === true
    && !!settle25b && settle25b.receipts === before25b && settle25b.zone === 'synth'
    && after25b === before25b,
    JSON.stringify({ before: before25b, settle: settle25b, after: after25b, drop: drop25bR.value && drop25bR.value.err }));

  /* screenshot with the manager + runs + storage populated */
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    note('screenshot: ' + shotPath);
  } catch (e) { note('screenshot failed: ' + String((e && e.message) || e)); }

  /* ── 26. row-action sanity: one sample LOAD e2e (the cdp_import style) ── */
  const loadId = (await ev(`(async () => { const l = await avLibList(); const it = (l.items || []).find(i => i.name === 'hub-bravo.wav'); return it ? it.id : null; })()`)).value;
  const n0 = (await ev(`avSampleStore.entries.length`)).value;
  const loadClicked = await clickSel(`[data-av-import-lib="${loadId}"] [data-av-import-act="load"]`, 900);
  const loadedR = await waitFor(`(() => { const es = avSampleStore.entries; if (!es || es.length <= ${Number(n0) || 0}) return null; const e = es[es.length - 1]; return { n: es.length, rate: e.sampleRate, frames: e.buffer ? e.buffer.length : -1, secs: (e.buffer && isFinite(e.buffer.duration)) ? e.buffer.duration : -1 }; })()`, 12000);
  check('row action: the surviving sample LOADs end-to-end (48 kHz native, 0.05 s preserved)',
    loadClicked === true && !!loadId && !!loadedR && loadedR.rate === 48000 && loadedR.frames === 2400
    && Math.abs(loadedR.secs - 0.05) < 0.002, JSON.stringify(loadedR));

  /* ── 27. zero page errors ── */
  check('zero page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* ── 28. freeze pin (a PINNED run reports this check; an unpinned run reports one fewer) ── */
  const shaAfter = shaOf(page);
  if (PIN) {
    check('freeze: index.html sha256 = pinned (before === after)',
      shaBefore === PIN && shaAfter === shaBefore,
      'pinned ' + PIN.slice(0, 12) + '… · before ' + shaBefore.slice(0, 12) + '… · after ' + shaAfter.slice(0, 12) + '…');
  } else {
    note('EXPECT_SHA not pinned (parent sets it at the R17 freeze) — freeze check SKIPPED: this unpinned run reports one FEWER check than the pinned run; pin and re-run for the final count');
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { ws.close(); } catch { }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('hub harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile.replace(/[\\/]/g, '\\\\')}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
