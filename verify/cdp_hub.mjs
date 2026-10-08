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

  /* ── 23b. R18a library intelligence: dedupe · replace · missing · relink (contract:
     verify/_r18_wave.md §5; 4 checks). Every probe is guarded per call — a not-yet-landed
     surface fails its leg honestly (the info shows what was read), never throws. The drop
     legs below use relative receipt arithmetic, so the extra runs (dup x2 + kit) are safe;
     hub-bravo.wav is left untouched (leg 26 loads it by name). ── */
  const r18Before = await receiptsNow();
  const r18Entry = (await ev(`(async () => { try { const l = await avLibList(); return { count: l.count, names: (l.items || []).map(i => String(i.name)).sort().join(',') }; } catch (e) { return null; } })()`)).value;
  note('R18a entry: receipts ' + r18Before + ' · library ' + JSON.stringify(r18Entry));

  /* page-side helpers for this section (in-page fixtures only; no disk files) */
  await ev(`(() => {
    window.__r18wav = null;
    window.__r18kit = null;
    window.__r18 = {
      makeWav: function (freq) {
        try {
          const sr = 8000, n = 400;
          const l = new Float32Array(n), r = new Float32Array(n);
          for (let i = 0; i < n; i++) { const v = 0.4 * Math.sin(2 * Math.PI * freq * i / sr); l[i] = v; r[i] = v; }
          return avWavEncode({ l: l, r: r, sr: sr, bits: 16, dither: false });
        } catch (e) { return null; }
      },
      /* the R15c synthetic EXS24 block fixture (cdp_smoke 6cl shape): one zone whose sample
         name is written at d+336 of the sample block — here a name that is NOT in the library */
      exsKit: function (refName) {
        try {
          const blk = function (marker, size, name) { const b = new Uint8Array(84 + size); b[0] = 1; b[1] = 1; b[2] = 0; b[3] = marker;
            b[4] = size & 255; b[5] = (size >>> 8) & 255; b[6] = 0; b[7] = 0;
            const cid = 'TBOS'; for (let i = 0; i < 4; i++) b[16 + i] = cid.charCodeAt(i);
            for (let i = 0; i < name.length && i < 63; i++) b[20 + i] = name.charCodeAt(i); return b; };
          const wr32 = function (b, o, v) { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; b[o + 2] = (v >>> 16) & 255; b[o + 3] = (v >>> 24) & 255; };
          const d0 = 84;
          const inst = blk(0, 88, 'R18Kit');
          const zn = blk(1, 148, 'Z1'); zn[d0 + 1] = 60; zn[d0 + 6] = 36; zn[d0 + 7] = 51; zn[d0 + 9] = 1; zn[d0 + 10] = 127;
          wr32(zn, d0 + 12, 0); wr32(zn, d0 + 16, 50); wr32(zn, d0 + 92, 0);
          const smp = blk(3, 600, 'S1'); wr32(smp, d0 + 4, 400); wr32(smp, d0 + 8, 8000); smp[d0 + 12] = 16;
          const fn = String(refName); for (let i = 0; i < fn.length; i++) smp[d0 + 336 + i] = fn.charCodeAt(i);
          const o = new Uint8Array(inst.length + zn.length + smp.length);
          o.set(inst, 0); o.set(zn, inst.length); o.set(smp, inst.length + zn.length);
          return o;
        } catch (e) { return null; }
      },
      drive: function (files) {
        try {
          const dt = new DataTransfer();
          for (let i = 0; i < files.length; i++) dt.items.add(files[i]);
          const inp = document.getElementById('av-import-file');
          if (!inp) return { err: 'no #av-import-file' };
          inp.files = dt.files;
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, n: dt.files.length };
        } catch (e) { return { err: String((e && e.message) || e) }; }
      },
      /* the missing-count read: the pinned snap().missing first; the facade missing() wrapper
         (guarded) is a diagnostic fallback only — the legs assert on the snap read (via). */
      missNow: async function () {
        try {
          const sn = (window.__avImport && window.__avImport.snap) ? window.__avImport.snap() : {};
          if (typeof sn.missing === 'number' && isFinite(sn.missing)) return { via: 'snap', v: sn.missing };
        } catch (e0) { /* fall through */ }
        try {
          const f = window.__avImport || {};
          if (typeof f.missing === 'function') {
            const r = await f.missing();
            let v = null;
            if (typeof r === 'number') v = r;
            else if (r && typeof r === 'object') {
              if (typeof r.missing === 'number') v = r.missing;
              else if (Array.isArray(r.missing)) v = r.missing.length;
              else if (typeof r.count === 'number') v = r.count;
            }
            if (typeof v === 'number' && isFinite(v)) return { via: 'facade', v: v };
          }
        } catch (e1) { /* fall through */ }
        return { via: null, v: null };
      }
    };
    return true;
  })()`);

  /* drive one file through the card's change handler (the R15b snapshot-first law); when no
     receipt lands in 15 s, fall back to __avImport.importFiles — the run happens either way;
     {via} names the path that worked (null = neither did) */
  const r18Import = async (label, fileExpr) => {
    const before = await receiptsNow();
    const want = before + 1;
    const cnt = `(async () => { try { if (typeof avLibReceiptList !== 'function') return 0; const r = await avLibReceiptList(); return (r && r.ok === true && r.count === ${want}) ? r.count : 0; } catch (e) { return 0; } })()`;
    const drove = await ev(`(() => { try { const f = ${fileExpr}; return window.__r18.drive([f]); } catch (e) { return { err: String((e && e.message) || e) }; } })()`);
    let c = await waitFor(cnt, 15000);
    let via = 'change';
    if (c !== want) {
      note('R18a ' + label + ': change handler produced no receipt in 15 s — falling back to __avImport.importFiles');
      await ev(`(async () => { try { const f = ${fileExpr}; if (window.__avImport && typeof window.__avImport.importFiles === 'function') await window.__avImport.importFiles([f]); } catch (e) { /* the wait below reports */ } return true; })()`);
      c = await waitFor(cnt, 20000);
      via = 'importFiles';
    }
    return { before: before, want: want, count: c, via: (c === want) ? via : null, drive: drove.value || null };
  };

  /* ── 23b.1 dedupe: the SAME WAV imported twice through the change handler ── */
  const wavR = await ev(`(() => { try { window.__r18wav = window.__r18.makeWav(523); return { len: window.__r18wav ? window.__r18wav.byteLength : -1 }; } catch (e) { return { err: String((e && e.message) || e) }; } })()`);
  const dupImp1 = (wavR.value && wavR.value.len > 0) ? await r18Import('dup import 1', `new File([window.__r18wav], 'r18-dup.wav')`) : null;
  let firstId = null;
  if (dupImp1 && dupImp1.via) {
    const fR = await waitFor(`(async () => {
      try {
        const l = await avLibList();
        const hits = (l.items || []).filter(i => i && String(i.name) === 'r18-dup.wav');
        return (hits.length === 1) ? { id: String(hits[0].id) } : null;
      } catch (e) { return null; }
    })()`, 15000);
    firstId = (fR && fR.id) ? fR.id : null;
  }
  const dupImp2 = firstId ? await r18Import('dup import 2 (same bytes)', `new File([window.__r18wav], 'r18-dup.wav')`) : null;
  let dupWait = null;
  let dupAfter = {};
  if (dupImp2 && dupImp2.via) {
    dupWait = await waitFor(`(async () => {
      try {
        if (typeof avLibReceiptList !== 'function') return null;
        const r = await avLibReceiptList();
        if (!r || r.ok !== true || r.count !== ${r18Before + 2}) return null;
        const run0 = (r.runs && r.runs[0]) || {};
        const c = run0.counts || {};
        const snap = (window.__avImport && window.__avImport.snap) ? window.__avImport.snap() : {};
        const chips = document.querySelectorAll('#av-import-report .av-import-chip-dup').length;
        /* the receipt item's dup: the pinned snap projection first, then the module's live
           report items (the chip is built from those); no carrier -> the leg fails honestly */
        let uiItems = null;
        try { uiItems = (typeof avImportUiState !== 'undefined' && avImportUiState) ? avImportUiState.reportItems : null; } catch (e0) { uiItems = null; }
        const cars = [];
        if (Array.isArray(snap.report)) cars.push(['snap', snap.report]);
        if (Array.isArray(uiItems)) cars.push(['ui', uiItems]);
        let dup = null, via = null;
        for (let i = 0; i < cars.length && !dup; i++) {
          const arr = cars[i][1];
          for (let k = 0; k < arr.length; k++) {
            const it = arr[k];
            if (it && String(it.name) === 'r18-dup.wav' && it.dup) { dup = it.dup; via = cars[i][0]; break; }
          }
        }
        const dupId = dup ? String(dup.id == null ? '' : dup.id) : '';
        const dupName = dup ? String(dup.name == null ? '' : dup.name) : '';
        const dupsOk = (typeof c.dups === 'number') && c.dups === 1;
        if (!(dupsOk && snap.dups === 1 && chips >= 1 && dupId === ${JSON.stringify(String(firstId))} && dupName === 'r18-dup.wav')) return null;
        return { count: r.count, total: (typeof c.total === 'number') ? c.total : null, imported: (typeof c.imported === 'number') ? c.imported : null,
                 dups: c.dups, snapDups: snap.dups, chips: chips, dup: { id: dupId, name: dupName }, dupVia: via };
      } catch (e) { return null; }
    })()`, 25000);
    await sleep(300);
    dupAfter = ((await ev(`(async () => {
      try {
        const r = (typeof avLibReceiptList === 'function') ? await avLibReceiptList() : null;
        const run0 = (r && Array.isArray(r.runs) && r.runs[0]) ? r.runs[0] : null;
        const c = (run0 && run0.counts) ? run0.counts : null;
        const snap = (window.__avImport && window.__avImport.snap) ? window.__avImport.snap() : {};
        let uiItems = null;
        try { uiItems = (typeof avImportUiState !== 'undefined' && avImportUiState) ? avImportUiState.reportItems : null; } catch (e0) { uiItems = null; }
        const chipEl = document.querySelector('#av-import-report .av-import-chip-dup');
        return { count: (r && r.ok === true) ? r.count : -1,
                 counts: c ? { total: c.total, imported: c.imported, dups: (typeof c.dups === 'number') ? c.dups : null } : null,
                 snapDups: (typeof snap.dups === 'number') ? snap.dups : null,
                 snapReportN: Array.isArray(snap.report) ? snap.report.length : -1,
                 uiReportN: Array.isArray(uiItems) ? uiItems.length : -1,
                 chips: document.querySelectorAll('#av-import-report .av-import-chip-dup').length,
                 chipText: chipEl ? String(chipEl.textContent || '').trim().slice(0, 80) : '',
                 subtle: !!(window.crypto && window.crypto.subtle) };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    })()`)).value) || {};
  }
  check('R18a dedupe: the same WAV twice -> 2nd receipt item.dup = 1st {id,name} · counts.dups 1 · snap.dups 1 · dup chip row',
    !!firstId && !!dupImp2 && dupImp2.via !== null && !!dupWait
    && dupWait.dups === 1 && dupWait.snapDups === 1 && dupWait.chips >= 1
    && !!dupWait.dup && dupWait.dup.id === String(firstId) && dupWait.dup.name === 'r18-dup.wav',
    JSON.stringify({ imp1: dupImp1 && { via: dupImp1.via, count: dupImp1.count }, imp2: dupImp2 && { via: dupImp2.via, count: dupImp2.count },
      firstId: firstId, got: dupWait || null, after: dupAfter }));

  /* ── 23b.2 replace: __avImport.replace(newId) -> ONE record kept (the old id) ── */
  let pairR = null, newId = null;
  if (firstId && dupImp2 && dupImp2.via) {
    pairR = await waitFor(`(async () => {
      try {
        const l = await avLibList();
        const hits = (l.items || []).filter(i => i && String(i.name) === 'r18-dup.wav');
        if (hits.length !== 2) return null;
        const newOne = hits.find(i => String(i.id) !== ${JSON.stringify(String(firstId))}) || null;
        return { count: l.count, ids: hits.map(i => String(i.id)), newId: newOne ? String(newOne.id) : null,
                 newDupOf: (newOne && newOne.dupOf && typeof newOne.dupOf === 'object')
                   ? { id: String(newOne.dupOf.id == null ? '' : newOne.dupOf.id), name: String(newOne.dupOf.name == null ? '' : newOne.dupOf.name) } : null };
      } catch (e) { return null; }
    })()`, 15000);
  }
  const pair = pairR || {};
  newId = pair.newId || null;
  let repR = null, repDone = null;
  if (firstId && newId) {
    repR = await ev(`(async () => {
      try {
        const f = window.__avImport || {};
        if (typeof f.replace !== 'function') return { missing: true };
        const r = await f.replace(${JSON.stringify(newId)});
        if (r && typeof r === 'object') return { receipt: { ok: r.ok, id: String(r.id == null ? '' : r.id), removed: String(r.removed == null ? '' : r.removed), error: String(r.error || '') } };
        return { val: String(r) };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    })()`);
    repDone = await waitFor(`(async () => {
      try {
        const l = (typeof avLibList === 'function') ? await avLibList() : null;
        if (!l || l.ok !== true) return null;
        const items = l.items || [];
        const hits = items.filter(i => i && String(i.name) === 'r18-dup.wav');
        const kept = hits[0] || null;
        const goneNew = !items.some(i => i && String(i.id) === ${JSON.stringify(newId)});
        const keptOld = !!kept && String(kept.id) === ${JSON.stringify(String(firstId))};
        const replaced = !!(kept && kept.source && kept.source.replaced === true);
        if (hits.length !== 1 || !keptOld || !goneNew || !replaced) return null;
        return { hits: hits.length, count: l.count, keptId: String(kept.id), goneNew: goneNew, replaced: replaced,
                 srcName: kept.source ? String(kept.source.name || '') : '', srcAt: (kept.source && typeof kept.source.at === 'number') ? kept.source.at : null };
      } catch (e) { return null; }
    })()`, 25000);
  }
  const rp = (repR && repR.value) ? repR.value : {};
  check('R18a replace: __avImport.replace(newId) -> ONE record kept (old id, source.replaced) · new id gone · receipt ok',
    !!firstId && !!newId && !!rp.receipt && rp.receipt.ok === true
    && String(rp.receipt.id) === String(firstId) && String(rp.receipt.removed) === String(newId)
    && !!pair.newDupOf && String(pair.newDupOf.id) === String(firstId)
    && !!repDone && repDone.hits === 1 && repDone.keptId === String(firstId) && repDone.goneNew === true && repDone.replaced === true,
    JSON.stringify({ firstId: firstId, newId: newId, pair: pairR || null, receipt: rp.receipt || rp, after: repDone || null }));

  /* ── 23b.3 missing: a synthetic .exs kit whose sibling WAV is NOT in the library ── */
  const preMiss = await waitFor(`(async () => {
    try { const m = await window.__r18.missNow(); return (m.via === 'snap' && typeof m.v === 'number' && isFinite(m.v)) ? m : null; }
    catch (e) { return null; }
  })()`, 10000);
  const kitR = await ev(`(() => { try { window.__r18kit = window.__r18.exsKit('r18-ghost.wav'); return { len: window.__r18kit ? window.__r18kit.length : -1 }; } catch (e) { return { err: String((e && e.message) || e) }; } })()`);
  const kitImp = (kitR.value && kitR.value.len > 0) ? await r18Import('kit import (.exs, sibling absent)', `new File([window.__r18kit], 'r18-kit.exs')`) : null;
  let kitWait = null, kitProbe = {};
  if (kitImp && kitImp.via) {
    kitWait = await waitFor(`(async () => {
      try {
        const m = await window.__r18.missNow();
        if (!(m.via === 'snap' && typeof m.v === 'number' && m.v >= 1)) return null;
        const chips = document.querySelectorAll('#av-import-lib .av-import-chip-missing').length;
        if (chips < 1) return null;
        return { miss: m.v, via: m.via, chips: chips };
      } catch (e) { return null; }
    })()`, 25000);
    kitProbe = ((await ev(`(async () => {
      try {
        const m = await window.__r18.missNow();
        const snap = (window.__avImport && window.__avImport.snap) ? window.__avImport.snap() : {};
        const l = (typeof avLibList === 'function') ? await avLibList() : null;
        const items = (l && l.items) ? l.items : [];
        const kit = items.find(i => i && String(i.name) === 'r18-kit.exs') || items.find(i => i && String(i.format) === 'exs') || null;
        const kitId = kit ? String(kit.id) : '';
        let rowHas = false, rowKind = '';
        if (kitId) {
          const row = document.querySelector('#av-import-lib [data-av-import-lib="' + kitId + '"]');
          rowHas = !!(row && row.querySelector('.av-import-chip-missing'));
          rowKind = row ? String(row.getAttribute('data-kind') || '') : '';
        }
        const rep = (snap.report || []).find(x => x && String(x.name) === 'r18-kit.exs') || null;
        return { miss: m.v, via: m.via, kitId: kitId, kind: kit ? String(kit.kind) : '', rowKind: rowKind, rowHas: rowHas,
                 chipsAll: document.querySelectorAll('#av-import-lib .av-import-chip-missing').length,
                 rep: rep ? { result: String(rep.result || ''), kind: String(rep.kind || '') } : null };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    })()`)).value) || {};
  }
  check('R18a missing: .exs kit with an absent sibling WAV -> pre-scan 0 · snap.missing >= 1 · kit row missing chip',
    !!preMiss && preMiss.via === 'snap' && preMiss.v === 0 && !!kitImp && kitImp.via !== null
    && !!kitWait && typeof kitProbe.miss === 'number' && kitProbe.miss >= 1
    && kitProbe.rowHas === true && kitProbe.kind === 'kit'
    && !!kitProbe.rep && kitProbe.rep.result === 'imported' && kitProbe.rep.kind === 'kit',
    JSON.stringify({ pre: preMiss, kitLen: kitR.value && kitR.value.len, imp: kitImp && { via: kitImp.via, count: kitImp.count }, wait: kitWait, probe: kitProbe }));

  /* ── 23b.4 relink: rename an existing sample row to the missing name (rename-based v1) ── */
  const candR = await waitFor(`(async () => {
    try {
      const l = (typeof avLibList === 'function') ? await avLibList() : null;
      if (!l || l.ok !== true) return null;
      const items = (l.items || []).filter(i => i && String(i.name) === 'r18-dup.wav');
      if (!items.length) return null;
      const sample = items.find(i => String(i.kind) === 'sample') || items[0];
      return { id: String(sample.id), kind: String(sample.kind), n: items.length };
    } catch (e) { return null; }
  })()`, 10000);
  const cand = candR || {};
  const preRelink = ((await ev(`(async () => { try { return await window.__r18.missNow(); } catch (e) { return { via: null, v: null }; } })()`)).value) || { via: null, v: null };
  let relinkR = null, relinkWait = null;
  if (cand.id) {
    relinkR = await ev(`(async () => {
      try {
        const f = window.__avImport || {};
        if (typeof f.relink !== 'function') return { missing: true };
        const r = await f.relink('r18-ghost.wav', ${JSON.stringify(String(cand.id))});
        if (r && typeof r === 'object') return { receipt: { ok: r.ok, error: String(r.error || ''), name: String(r.name == null ? '' : r.name) } };
        return { val: String(r) };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    })()`);
    relinkWait = await waitFor(`(async () => {
      try {
        const m = await window.__r18.missNow();
        if (!(m.via === 'snap' && m.v === 0)) return null;
        const l = (typeof avLibList === 'function') ? await avLibList() : null;
        const it = l ? (l.items || []).find(x => x && String(x.id) === ${JSON.stringify(String(cand.id))}) : null;
        if (!it || String(it.name) !== 'r18-ghost.wav') return null;
        return { miss: m.v, via: m.via, id: String(it.id), name: String(it.name),
                 chipsAll: document.querySelectorAll('#av-import-lib .av-import-chip-missing').length };
      } catch (e) { return null; }
    })()`, 25000);
  }
  const rl = (relinkR && relinkR.value) ? relinkR.value : {};
  check('R18a relink: __avImport.relink(name, candidateId) -> missing back to 0 · renamed name in avLibList',
    !!cand.id && !!rl.receipt && rl.receipt.ok === true
    && !!preRelink && preRelink.via === 'snap' && typeof preRelink.v === 'number' && preRelink.v >= 1
    && !!relinkWait && relinkWait.miss === 0 && relinkWait.name === 'r18-ghost.wav' && relinkWait.id === String(cand.id),
    JSON.stringify({ candidate: candR || cand, preRelink: preRelink, relink: rl.receipt || rl, after: relinkWait || null }));

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
