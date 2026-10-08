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
//   12. (R21) the library manager now lives inside the #av-library-pop overlay (ids preserved):
//       manager/row legs run with the overlay OPEN, the library-jump leg asserts the overlay
//       opens, and N1-N7 witness the strip + open focus + containment, Esc close + focus return,
//       the format + pack facets, incremental rows (65 synthetic WAVs, cleaned up), bulk load
//       and the inspector.
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
const EXPECT_SHA = '1bbfe2cfe0631b60cba80b80176e451256accf31e97f72c41db57d79dddb54aa';
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

  /* R21 overlay helpers (verify/_r21_wave.md section 5): the library manager now lives INSIDE
     the #av-library-pop overlay (ids preserved), so every manager/row-touching leg runs with
     the overlay OPEN (the user path — not a hidden click). Facade returns accept true or a
     receipt object (house law); open/close wait until the root reflects the requested state. */
  const openLibrary = async () => {
    const r = await ev(`(async () => {
      try {
        const L = window.__avLibrary;
        if (!L || typeof L.open !== 'function') return { missing: true };
        const b = L.open();
        const ok = (String(b) === 'true') || !!(b && b.ok === true);
        return { open: ok, isOpen: (typeof L.isOpen === 'function') ? (L.isOpen() === true) : null };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    })()`);
    const vis = await waitFor(`(() => { const p = document.getElementById('av-library-pop'); return (p && p.hidden !== true) ? true : false; })()`, 12000);
    return { call: (r && r.value) || null, visible: vis === true };
  };
  const closeLibrary = async () => {
    const r = await ev(`(async () => {
      try {
        const L = window.__avLibrary;
        if (!L || typeof L.close !== 'function') return { missing: true };
        const b = L.close();
        return { close: (String(b) === 'true') || !!(b && b.ok === true) };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    })()`);
    const hid = await waitFor(`(() => { const p = document.getElementById('av-library-pop'); return (p && p.hidden === true) ? true : false; })()`, 8000);
    return { call: (r && r.value) || null, hidden: hid === true };
  };

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
  /* R21: the File menu path must ALSO open the overlay (the manager moved in there); witness it,
     then close so the fn path below opens it from closed (attribution) */
  const jumpOv1 = await waitFor(`(() => { const p = document.getElementById('av-library-pop'); return (p && p.hidden !== true) ? true : null; })()`, 8000);
  const jumpClose = await closeLibrary();
  const jump2R = await ev(`(() => {
    const visible = () => { const shown = Array.prototype.filter.call(document.querySelectorAll('.av-zone'), function (z) { return !z.hidden; }); return shown[0] ? shown[0].getAttribute('data-zone') : null; };
    const okSynth = (typeof avZoneShow === 'function') ? avZoneShow('synth', { source: 'rig' }) : false;
    const mid = visible();
    const ret = (typeof avImportUiLibrary === 'function') ? avImportUiLibrary() : null;
    return { okSynth: okSynth, mid: mid, ret: ret, end: visible() };
  })()`);
  const j2 = jump2R.value || {};
  const jumpOv2 = await waitFor(`(() => { const p = document.getElementById('av-library-pop'); return (p && p.hidden !== true) ? true : null; })()`, 8000);
  check('library jump: File > Library... and avImportUiLibrary() switch to the store pane (returns true) + open the overlay',
    jm.clicked === true && jm.afterMenu === 'store' && jumpOv1 === true && jumpClose.hidden === true
    && j2.okSynth === true && j2.mid === 'synth'
    && j2.ret === true && j2.end === 'store' && jumpOv2 === true,
    JSON.stringify({ menu: jm, menuOv: jumpOv1, close: jumpClose, fn: j2, fnOv: jumpOv2 }));

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

  /* R21: the manager subsystem now lives inside #av-library-pop — the manager-touching legs
     below run with the overlay OPEN (the user path). The reload above left a fresh page
     (overlay closed again): open it via the facade before the rename leg. */
  const mgrOpen1 = await openLibrary();
  note('R21 manager-section overlay open: ' + JSON.stringify(mgrOpen1));

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

  /* R21: the rename reload left a fresh page (overlay closed again) — re-open the overlay
     before the manager legs (search/filter/sort/select/delete/export read manager rows). */
  const mgrOpen2 = await openLibrary();
  note('R21 post-reload overlay re-open: ' + JSON.stringify(mgrOpen2));

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
  /* R21: #av-import-persist is a CARD control under the full-surface overlay — close the overlay
     first so the real click reaches the button (an open backdrop would take the hit and the
     away-click would close instead); the manager legs resume right after this leg. */
  const persClose = await closeLibrary();
  note('R21 persist: overlay closed for the card click: ' + JSON.stringify(persClose));
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

  /* R21: the manager legs resume — re-open the overlay (the R18a/R19 legs below read manager
     rows: dedupe/missing chips + the round-trip DOM count). */
  const mgrOpen3 = await openLibrary();
  note('R21 overlay re-open after persist: ' + JSON.stringify(mgrOpen3));

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
  /* R18a rig SPEC fix: the facade wrappers return the house boolean (avImportUiActReplace ->
     true on success, false on refusal); every semantic witness above already passed and only
     the receipt-SHAPE sub-assert failed -- the predicate now states its intent (op ok) and
     keeps the receipt-shape asserts whenever the object form is returned. */
  const rpOk = (rp.receipt && rp.receipt.ok === true) || String(rp.val) === 'true';
  check('R18a replace: __avImport.replace(newId) -> ONE record kept (old id, source.replaced) · new id gone · op ok',
    !!firstId && !!newId && rpOk
    && (!rp.receipt || (String(rp.receipt.id) === String(firstId) && String(rp.receipt.removed) === String(newId)))
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
  /* R18a rig SPEC fix (same class as the replace leg): avImportUiRelink returns the house
     boolean true on success; accept the receipt object form when present. */
  const rlOk = (rl.receipt && rl.receipt.ok === true) || String(rl.val) === 'true';
  check('R18a relink: __avImport.relink(name, candidateId) -> missing back to 0 · renamed name in avLibList · op ok',
    !!cand.id && rlOk
    && !!preRelink && preRelink.via === 'snap' && typeof preRelink.v === 'number' && preRelink.v >= 1
    && !!relinkWait && relinkWait.miss === 0 && relinkWait.name === 'r18-ghost.wav' && relinkWait.id === String(cand.id),
    JSON.stringify({ candidate: candR || cand, preRelink: preRelink, relink: rl.receipt || rl, after: relinkWait || null }));

  /* ── 23c. R18b linked source folders: link · scan diff · import new · change+gone ·
     reconnect · unlink (contract: verify/_r18b_wave.md §7; 6 checks). Every probe is
     guarded per call — a not-yet-landed window.__avSources fails its leg honestly (the
     info shows what was read), never throws. Fixtures are synthesized IN-PAGE: the stub
     tree follows the D3 walk surface (dir {kind,name,values,queryPermission,
     requestPermission}; file {kind,name,getFile}); the handle METHODS are defined
     non-enumerable so the tree stays structured-cloneable when the store puts the record
     into IDB (an enumerable function would DataCloneError the put). Legs 4-5 mutate the
     tree through the window.__r18b handle. The drop legs below use relative receipt
     arithmetic, so the +1 import run from importNew is safe; hub-bravo.wav stays
     untouched (leg 26 loads it by name). ── */
  const r18bInit = await ev(`(() => {
    try {
      if (typeof avWavEncode !== 'function') return { err: 'avWavEncode absent' };
      const NE = function (o, k, v) { Object.defineProperty(o, k, { value: v, enumerable: false, configurable: true }); };
      const mkBytes = function (frames, freq) {
        const sr = 8000, n = Math.max(8, frames | 0);
        const l = new Float32Array(n), r = new Float32Array(n);
        for (let i = 0; i < n; i++) { const v = 0.4 * Math.sin(2 * Math.PI * freq * i / sr); l[i] = v; r[i] = v; }
        return avWavEncode({ l: l, r: r, sr: sr, bits: 16, dither: false });
      };
      const boxes = { 'x.wav': { bytes: mkBytes(400, 523) }, 'sub/y.wav': { bytes: mkBytes(320, 659) }, 'kick.wav': { bytes: mkBytes(240, 131) } };
      const perm = { v: 'granted' };
      const mkFile = function (name, box) {
        const h = { kind: 'file', name: name };
        NE(h, 'getFile', function () { return Promise.resolve(new File([box.bytes], name)); });
        return h;
      };
      const kids = { root: new Map(), sub: new Map() };
      const mkDir = function (name, map) {
        const h = { kind: 'directory', name: name };
        NE(h, 'values', async function* () { const ent = Array.from(map.entries()); for (let i = 0; i < ent.length; i++) yield [ent[i][0], ent[i][1]]; });
        NE(h, 'queryPermission', function () { return Promise.resolve(perm.v); });
        NE(h, 'requestPermission', function () { perm.v = 'granted'; return Promise.resolve('granted'); });
        return h;
      };
      const root = mkDir('RIGSRC', kids.root), sub = mkDir('sub', kids.sub);
      kids.root.set('sub', sub);
      kids.root.set('x.wav', mkFile('x.wav', boxes['x.wav']));
      kids.root.set('kick.wav', mkFile('kick.wav', boxes['kick.wav']));
      kids.sub.set('y.wav', mkFile('y.wav', boxes['sub/y.wav']));
      window.__r18b = {
        dir: root,
        fs: { showDirectoryPicker: function () { return Promise.resolve(root); } },
        setBytes: function (key, frames, freq) { try { boxes[key].bytes = mkBytes(frames, freq); return { len: boxes[key].bytes.byteLength }; } catch (e) { return { err: String((e && e.message) || e) }; } },
        rmSub: function (name) { try { return { had: kids.sub.delete(name) }; } catch (e) { return { err: String((e && e.message) || e) }; } },
        forcePrompt: function () {
          try {
            NE(root, 'queryPermission', function () { return Promise.resolve('prompt'); });
            NE(root, 'requestPermission', function () {
              NE(root, 'queryPermission', function () { return Promise.resolve('granted'); });
              return Promise.resolve('granted');
            });
            return { ok: true };
          } catch (e) { return { err: String((e && e.message) || e) }; }
        }
      };
      return { ok: true, lens: { 'x.wav': boxes['x.wav'].bytes.byteLength, 'sub/y.wav': boxes['sub/y.wav'].bytes.byteLength, 'kick.wav': boxes['kick.wav'].bytes.byteLength } };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  const r18bInitV = (r18bInit && r18bInit.value) || {};
  const r18bLens = (r18bInitV && r18bInitV.lens) ? r18bInitV.lens : {};
  let r18bId = null;
  note('R18b fixtures: ' + JSON.stringify(r18bInitV));

  /* the shared scan probe: normalizes a §3.4 receipt for the legs (arrays out; -1/null when
     a surface is absent, so a failing leg's info shows exactly what was read) */
  const r18bScanRun = async (idStr) => {
    const r = await ev(`(async () => {
      try {
        const S = window.__avSources;
        if (!S || typeof S.scan !== 'function') return { missing: true };
        const rr = await S.scan(${JSON.stringify(String(idStr))});
        const sc = (rr && rr.scan) || {};
        const arr = function (x) { return Array.isArray(x) ? x : null; };
        const nm = function (x) { return String((x && x.name) == null ? '' : x.name); };
        const rl = function (x) { return String((x && x.relPath) == null ? '' : x.relPath); };
        const sz = function (x) { return (x && typeof x.size === 'number') ? x.size : -1; };
        return { ok: !!(rr && rr.ok), error: String((rr && rr.error) || ''),
                 newN: arr(sc.new) ? sc.new.length : -1, newNames: arr(sc.new) ? sc.new.map(nm) : null,
                 newRels: arr(sc.new) ? sc.new.map(rl) : null, newSizes: arr(sc.new) ? sc.new.map(sz) : null,
                 changedN: arr(sc.changed) ? sc.changed.length : -1, changedNames: arr(sc.changed) ? sc.changed.map(nm) : null,
                 changedSizes: arr(sc.changed) ? sc.changed.map(sz) : null,
                 goneN: arr(sc.gone) ? sc.gone.length : -1, goneNames: arr(sc.gone) ? sc.gone.map(nm) : null,
                 gonePaths: arr(sc.gone) ? sc.gone.map(function (x) { return String((x && x.path) == null ? '' : x.path); }) : null,
                 same: sc.same, capped: sc.capped };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    })()`);
    return (r && r.value) || {};
  };

  /* 23c.1 link: setFs(stub) + link() -> ok · id · name "RIGSRC" · list shows it · fsKind "injected" */
  const r18bLinkR = await ev(`(async () => {
    try {
      const S = window.__avSources;
      if (!S || typeof S.setFs !== 'function' || typeof S.link !== 'function') return { missing: true };
      const fx = window.__r18b && window.__r18b.fs;
      if (!fx) return { noFixture: true, fixtureInit: window.__r18b ? 'present' : 'absent' };
      S.setFs(fx);
      let fk = null;
      try { fk = (typeof S.fsKind === 'function') ? S.fsKind() : ((S.fsKind !== undefined) ? S.fsKind : null); } catch (e0) { fk = null; }
      const lk = await S.link();
      const lst = (typeof S.list === 'function') ? await S.list() : null;
      const lid = lk ? String(lk.id == null ? '' : lk.id) : '';
      const it = (lst && Array.isArray(lst.items)) ? (lst.items.find(function (x) { return String(x.id) === lid; }) || null) : null;
      return { link: lk ? { ok: lk.ok, id: lid, name: String(lk.name == null ? '' : lk.name), error: String(lk.error || ''),
                             scan: lk.scan ? { newN: (lk.scan.new || []).length, same: lk.scan.same, capped: lk.scan.capped } : null } : null,
               fsKind: fk,
               list: lst ? { ok: lst.ok, count: lst.count, n: (lst.items || []).length } : null,
               it: it ? { id: String(it.id), name: String(it.name == null ? '' : it.name), mode: String(it.mode || ''), perm: String(it.perm == null ? '' : it.perm) } : null };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  const r18bLinkV = (r18bLinkR && r18bLinkR.value) || {};
  r18bId = (r18bLinkV && r18bLinkV.link && r18bLinkV.link.id) ? r18bLinkV.link.id : null;
  check('R18b link: setFs(stub) + link() -> ok · id · name "RIGSRC" · list shows it · fsKind "injected"',
    !!r18bId && !!r18bLinkV.link && r18bLinkV.link.ok === true && r18bLinkV.link.name === 'RIGSRC'
    && r18bLinkV.fsKind === 'injected'
    && !!r18bLinkV.list && r18bLinkV.list.ok === true && r18bLinkV.list.count >= 1
    && !!r18bLinkV.it && r18bLinkV.it.id === r18bId && r18bLinkV.it.name === 'RIGSRC',
    JSON.stringify(r18bLinkV));

  /* 23c.2 scan diff: the fresh stub tree -> new 3 (sorted names · real sizes) · same 0 · gone 0 · capped false */
  const r18bS2 = r18bId ? await r18bScanRun(r18bId) : {};
  const r18bS2NamesOk = Array.isArray(r18bS2.newNames) && r18bS2.newNames.join(',') === 'kick.wav,x.wav,y.wav';
  const r18bS2SizesOk = Array.isArray(r18bS2.newRels) && Array.isArray(r18bS2.newSizes)
    && ['kick.wav', 'sub/y.wav', 'x.wav'].every(function (rp) {
      const i = r18bS2.newRels.indexOf(rp);
      return i >= 0 && r18bS2.newSizes[i] === r18bLens[rp];
    });
  check('R18b scan diff: the fresh stub tree -> new 3 (sorted names, real sizes) · same 0 · gone 0 · capped false',
    !!r18bId && r18bS2.ok === true && r18bS2.newN === 3 && r18bS2NamesOk && r18bS2SizesOk
    && r18bS2.same === 0 && r18bS2.goneN === 0 && r18bS2.capped === false,
    JSON.stringify(r18bS2));

  /* 23c.3 import new: importNew(id) -> count 3 · the library gains the three under
     source.path "RIGSRC/" · re-scan -> new 0 · same 3 */
  const r18bImpR = r18bId ? await ev(`(async () => {
    try {
      const S = window.__avSources;
      if (!S || typeof S.importNew !== 'function') return { missing: true };
      const r = await S.importNew(${JSON.stringify(String(r18bId || ''))});
      return { ok: !!(r && r.ok), count: (r && typeof r.count === 'number') ? r.count : -1,
               error: String((r && r.error) || ''), hasReceipt: !!(r && r.receipt) };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`) : {};
  const r18bImpV = (r18bImpR && r18bImpR.value) || {};
  const r18bLib3 = r18bId ? await waitFor(`(async () => {
    try {
      if (typeof avLibList !== 'function') return null;
      const l = await avLibList();
      if (!l || l.ok !== true) return null;
      const items = l.items || [];
      const hit = function (n) { return items.find(function (i) { return i && String(i.name) === n; }) || null; };
      const want = ['x.wav', 'y.wav', 'kick.wav'];
      if (!want.every(function (n) { return !!hit(n); })) return null;
      const src = want.map(function (n) { const it = hit(n); return (it && it.source) ? String(it.source.path || '') : ''; });
      return { count: l.count, withSrc: src.filter(function (p) { return p.indexOf('RIGSRC/') === 0; }).length, src: src };
    } catch (e) { return null; }
  })()`, 25000) : null;
  const r18bS3 = r18bId ? await r18bScanRun(r18bId) : {};
  check('R18b import new: importNew(id) count 3 · library gains the three under source.path "RIGSRC/" · re-scan new 0 · same 3',
    !!r18bId && r18bImpV.ok === true && r18bImpV.count === 3
    && !!r18bLib3 && r18bLib3.withSrc >= 1
    && r18bS3.ok === true && r18bS3.newN === 0 && r18bS3.same === 3,
    JSON.stringify({ imp: r18bImpV, lib: r18bLib3, scan: r18bS3 }));

  /* 23c.4 change + gone: grow x.wav's bytes (same name · new size) + delete sub/y.wav ->
     changed >= 1 (x.wav at the new size) · gone >= 1 (y.wav's library item, path under RIGSRC/) */
  const r18bMutR = r18bId ? await ev(`(() => {
    try {
      const B = window.__r18b;
      if (!B || typeof B.setBytes !== 'function' || typeof B.rmSub !== 'function') return { noFixture: true };
      return { grow: B.setBytes('x.wav', 500, 523), rm: B.rmSub('y.wav') };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`) : {};
  const r18bMutV = (r18bMutR && r18bMutR.value) || {};
  const r18bS4 = r18bId ? await r18bScanRun(r18bId) : {};
  const r18bChIx = Array.isArray(r18bS4.changedNames) ? r18bS4.changedNames.indexOf('x.wav') : -1;
  const r18bChSize = (r18bChIx >= 0 && Array.isArray(r18bS4.changedSizes)) ? r18bS4.changedSizes[r18bChIx] : null;
  const r18bGoIx = Array.isArray(r18bS4.goneNames) ? r18bS4.goneNames.indexOf('y.wav') : -1;
  const r18bGoPath = (r18bGoIx >= 0 && Array.isArray(r18bS4.gonePaths)) ? r18bS4.gonePaths[r18bGoIx] : null;
  const r18bGrowLen = (r18bMutV.grow && typeof r18bMutV.grow.len === 'number') ? r18bMutV.grow.len : -1;
  check('R18b change+gone: grown x.wav -> CHANGED (new size) · deleted y.wav -> GONE (library item under RIGSRC/)',
    !!r18bId && !!(r18bMutV.grow && r18bMutV.grow.len > 0) && !!(r18bMutV.rm && r18bMutV.rm.had === true)
    && r18bS4.ok === true && r18bS4.changedN >= 1 && r18bChIx >= 0 && r18bChSize === r18bGrowLen
    && r18bS4.goneN >= 1 && r18bGoIx >= 0 && String(r18bGoPath || '').indexOf('RIGSRC/') === 0,
    JSON.stringify({ mut: r18bMutV, scan: r18bS4 }));

  /* 23c.5 reconnect state: swap queryPermission -> "prompt" -> the list surfaces the
     non-granted perm and a scan makes no fake success (§9) · reconnect(id) with
     requestPermission -> "granted" -> perm "granted" (receipt + list) */
  const r18bP5aR = r18bId ? await ev(`(async () => {
    try {
      const S = window.__avSources;
      if (!S || typeof S.list !== 'function' || typeof S.scan !== 'function') return { missing: true };
      const B = window.__r18b;
      if (!B || typeof B.forcePrompt !== 'function') return { noFixture: true };
      const sw = B.forcePrompt();
      const lst = await S.list();
      const it = (lst && Array.isArray(lst.items)) ? (lst.items.find(function (x) { return String(x.id) === ${JSON.stringify(String(r18bId || ''))}; }) || null) : null;
      const scr = await S.scan(${JSON.stringify(String(r18bId || ''))});
      return { swap: sw, listOk: !!(lst && lst.ok), listPerm: it ? String(it.perm == null ? '' : it.perm) : null,
               scanOk: scr ? scr.ok : null, scanError: String((scr && scr.error) || ''), scanHasScan: !!(scr && scr.scan) };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`) : {};
  const r18bP5bR = r18bId ? await ev(`(async () => {
    try {
      const S = window.__avSources;
      if (!S || typeof S.reconnect !== 'function' || typeof S.list !== 'function') return { missing: true };
      const rc = await S.reconnect(${JSON.stringify(String(r18bId || ''))});
      const lst = await S.list();
      const it = (lst && Array.isArray(lst.items)) ? (lst.items.find(function (x) { return String(x.id) === ${JSON.stringify(String(r18bId || ''))}; }) || null) : null;
      return { ok: !!(rc && rc.ok), perm: String((rc && rc.perm) == null ? '' : (rc && rc.perm)), error: String((rc && rc.error) || ''),
               listPerm: it ? String(it.perm == null ? '' : it.perm) : null };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`) : {};
  const r18bP5a = (r18bP5aR && r18bP5aR.value) || {};
  const r18bP5b = (r18bP5bR && r18bP5bR.value) || {};
  check('R18b reconnect: "prompt" -> list perm !== "granted" + a scan with no fake success · reconnect() -> perm "granted"',
    !!r18bId && !!(r18bP5a.swap && r18bP5a.swap.ok === true)
    && typeof r18bP5a.listPerm === 'string' && r18bP5a.listPerm !== '' && r18bP5a.listPerm !== 'granted'
    && r18bP5a.scanOk !== true
    && r18bP5b.ok === true && r18bP5b.perm === 'granted' && r18bP5b.listPerm === 'granted',
    JSON.stringify({ prompt: r18bP5a, reconnect: r18bP5b }));

  /* 23c.6 unlink: unlink(id) -> removed · list count 0 · a scan of the old id refuses {ok:false} */
  const r18bP6R = r18bId ? await ev(`(async () => {
    try {
      const S = window.__avSources;
      if (!S || typeof S.unlink !== 'function' || typeof S.list !== 'function') return { missing: true };
      const un = await S.unlink(${JSON.stringify(String(r18bId || ''))});
      const lst = await S.list();
      return { ok: !!(un && un.ok), removed: un ? un.removed : null, error: String((un && un.error) || ''),
               count: (lst && typeof lst.count === 'number') ? lst.count : -1,
               n: (lst && Array.isArray(lst.items)) ? lst.items.length : -1 };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`) : {};
  const r18bP6 = (r18bP6R && r18bP6R.value) || {};
  const r18bS6 = r18bId ? await r18bScanRun(r18bId) : {};
  check('R18b unlink: removed · list count 0 · a scan of the old id refuses {ok:false}',
    !!r18bId && r18bP6.ok === true && r18bP6.removed === true && r18bP6.count === 0
    && r18bS6.ok === false,
    JSON.stringify({ unlink: r18bP6, scan: { ok: r18bS6.ok, error: r18bS6.error } }));

  /* ── 23d. R19 user packs: round-trip · sha-mismatch refusal · generic zip unchanged
     (contract: verify/_r19_wave.md §7; 3 checks). Every probe is guarded per call — a
     not-yet-landed window.__avPack fails its leg honestly (the info shows what was read),
     never throws. Fixtures are synthesized IN-PAGE (avWavEncode bytes; no disk). Leg 1
     hands the built pack back through the card change handler (the R18a drive); leg 2
     drives the facade's importFiles so the RAW receipt is captured — the per-item results
     ride the bundle row's meta, and the UI publication (avImportUiMetaPub) keeps only
     scalar values, so the facade return is the faithful read. The drop legs below use
     relative receipt arithmetic, so the +4 runs are safe; hub-bravo.wav stays untouched
     (leg 26 loads it by name). ── */
  const r19Init = await ev(`(() => {
    try {
      if (typeof avWavEncode !== 'function') return { err: 'avWavEncode absent' };
      const bytesOf = function (x) {
        try {
          if (!x) return null;
          if (typeof ArrayBuffer !== 'undefined' && x instanceof ArrayBuffer) return new Uint8Array(x);
          if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
          return null;
        } catch (e) { return null; }
      };
      /* naive sub-sequence search (typed arrays have no indexOf(needle)); the pack writer is
         store-method, so the verbatim WAV bytes locate inside the built pack */
      const findSeq = function (hay, needle) {
        try {
          if (!hay || !needle || needle.length < 16 || needle.length > hay.length) return -1;
          const end = hay.length - needle.length;
          for (let i = 0; i <= end; i++) {
            if (hay[i] !== needle[0]) continue;
            let j = 1;
            for (; j < needle.length; j++) if (hay[i + j] !== needle[j]) break;
            if (j === needle.length) return i;
          }
          return -1;
        } catch (e) { return -1; }
      };
      window.__r19 = {
        wa: null, wb: null, packBytes: null, packName: '', manifest: null,
        badBytes: null, badVia: null, genZip: null, lastReceipt: null,
        wav: function (freq) {
          try {
            const sr = 8000, n = 400;
            const l = new Float32Array(n), r = new Float32Array(n);
            for (let i = 0; i < n; i++) { const v = 0.45 * Math.sin(2 * Math.PI * freq * i / sr); l[i] = v; r[i] = v; }
            return avWavEncode({ l: l, r: r, sr: sr, bits: 16, dither: false });
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
        /* the corrupted pack: flip ONE payload byte inside the alpha item's bytes (located
           verbatim in the store-method pack); when locating fails, rebuild a scratch zip
           whose manifest sha256 for alpha is deliberately wrong (the contract fallback) */
        buildBad: function () {
          try {
            const B = window.__r19;
            const pack = B.packBytes ? bytesOf(B.packBytes) : null;
            const a = B.wa ? bytesOf(B.wa) : null;
            if (!pack || !a || !B.manifest) return { via: null, err: 'no pack fixture' };
            const at = findSeq(pack, a);
            if (at >= 0 && a.length > 80) {
              const copy = pack.slice(0);
              const pos = at + ((a.length / 2) | 0);
              copy[pos] = copy[pos] ^ 0x5A;
              B.badBytes = copy.buffer;
              B.badVia = 'flip';
              return { via: 'flip', at: at, pos: pos };
            }
            const bad = JSON.parse(JSON.stringify(B.manifest));
            const rows = Array.isArray(bad.items) ? bad.items : [];
            const row = rows.filter(function (x) { return x && String(x.name) === 'r19-alpha.wav'; })[0] || rows[0] || null;
            if (!row) return { via: null, err: 'no manifest row' };
            row.sha256 = (String(row.sha256 || '').charAt(0) === 'a' ? 'b' : 'a') + String(row.sha256 || '').slice(1);
            const entries = [{ name: 'manifest.json', data: JSON.stringify(bad) }];
            for (let i = 0; i < rows.length; i++) {
              const it = rows[i];
              const bytes = (String(it.name) === 'r19-alpha.wav') ? B.wa : B.wb;
              entries.push({ name: String(it.path), data: bytesOf(bytes) });
            }
            const z = (typeof avZipBuild === 'function') ? avZipBuild(entries) : null;
            if (!z) return { via: null, err: 'zip writer absent' };
            B.badBytes = z;
            B.badVia = 'rebuild';
            return { via: 'rebuild', rows: rows.length };
          } catch (e) { return { via: null, err: String((e && e.message) || e) }; }
        },
        makeGeneric: function () {
          try {
            const w = window.__r19.wav(700);
            const z = (typeof avZipBuild === 'function') ? avZipBuild([
              { name: 'r19-gen.wav', data: w },
              { name: 'readme.txt', data: 'r19 plain zip payload - no manifest here' },
            ]) : null;
            if (!z) return { err: 'zip writer absent' };
            window.__r19.genZip = z;
            return { len: z.byteLength };
          } catch (e) { return { err: String((e && e.message) || e) }; }
        }
      };
      return { ok: true, zipWriter: typeof avZipBuild,
               avPack: (typeof window.__avPack === 'object' && window.__avPack) ? typeof window.__avPack.build : String(typeof window.__avPack) };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  note('R19 fixtures: ' + JSON.stringify(r19Init.value || {}));

  /* drive files through the card's change handler (the R18a pattern); when no receipt lands
     in 15 s, fall back to __avImport.importFiles — the run happens either way;
     {via} names the path that worked (null = neither did) */
  const r19Import = async (label, filesExpr) => {
    const before = await receiptsNow();
    const want = before + 1;
    const cnt = `(async () => { try { if (typeof avLibReceiptList !== 'function') return 0; const r = await avLibReceiptList(); return (r && r.ok === true && r.count === ${want}) ? r.count : 0; } catch (e) { return 0; } })()`;
    const drove = await ev(`(() => { try { const fs = ${filesExpr}; return window.__r19.drive(fs); } catch (e) { return { err: String((e && e.message) || e) }; } })()`);
    let c = await waitFor(cnt, 15000);
    let via = 'change';
    if (c !== want) {
      note('R19 ' + label + ': change handler produced no receipt in 15 s — falling back to __avImport.importFiles');
      await ev(`(async () => { try { const fs = ${filesExpr}; if (window.__avImport && typeof window.__avImport.importFiles === 'function') { const r = await window.__avImport.importFiles(fs); window.__r19.lastReceipt = r || null; } } catch (e) { /* the wait below reports */ } return true; })()`);
      c = await waitFor(cnt, 20000);
      via = 'importFiles';
    }
    return { before: before, want: want, count: c, via: (c === want) ? via : null, drive: drove.value || null };
  };

  /* idempotent remove-by-name (legs 1/2 need the two WAVs gone): resolves {ok:true} once
     every name is absent; null on timeout/persistence trouble */
  const r19RemoveNames = async (names) => waitFor(`(async () => {
    try {
      if (typeof avLibRemove !== 'function' || typeof avLibList !== 'function') return null;
      const nms = ${JSON.stringify(names)};
      const l0 = await avLibList();
      const items0 = (l0 && l0.items) || [];
      for (let i = 0; i < nms.length; i++) {
        const it = items0.filter(function (x) { return x && String(x.name) === nms[i]; })[0] || null;
        if (it) { const r = await avLibRemove(String(it.id)); if (!(r && r.ok === true)) return null; }
      }
      const l1 = await avLibList();
      const items1 = (l1 && l1.items) || [];
      for (let i = 0; i < nms.length; i++) { if (items1.some(function (x) { return x && String(x.name) === nms[i]; })) return null; }
      return { ok: true, gone: nms.length };
    } catch (e) { return null; }
  })()`, 15000);

  /* 23d.1 round-trip: 2 fresh WAVs through the change handler -> __avPack.build (zip +
     manifest rows 2) -> delete both -> the .avpack back through the change handler ->
     ONE bundle receipt · both land with source.pack === manifest.id */
  const r19WavA = await ev(`(() => { try { window.__r19.wa = window.__r19.wav(311); return { len: window.__r19.wa ? window.__r19.wa.byteLength : -1 }; } catch (e) { return { err: String((e && e.message) || e) }; } })()`);
  const r19WavB = await ev(`(() => { try { window.__r19.wb = window.__r19.wav(622); return { len: window.__r19.wb ? window.__r19.wb.byteLength : -1 }; } catch (e) { return { err: String((e && e.message) || e) }; } })()`);
  const r19Imp1 = (r19WavA.value && r19WavA.value.len > 0 && r19WavB.value && r19WavB.value.len > 0)
    ? await r19Import('pair import', `[new File([window.__r19.wa], 'r19-alpha.wav'), new File([window.__r19.wb], 'r19-beta.wav')]`)
    : null;
  let r19A = null, r19B = null;
  if (r19Imp1 && r19Imp1.via) {
    const idR = await waitFor(`(async () => {
      try {
        const l = await avLibList();
        const items = (l && l.items) || [];
        const a = items.filter(function (i) { return i && String(i.name) === 'r19-alpha.wav'; })[0] || null;
        const b = items.filter(function (i) { return i && String(i.name) === 'r19-beta.wav'; })[0] || null;
        return (a && b) ? { a: String(a.id), b: String(b.id) } : null;
      } catch (e) { return null; }
    })()`, 15000);
    r19A = (idR && idR.a) ? idR.a : null;
    r19B = (idR && idR.b) ? idR.b : null;
  }
  const r19BuildV = (r19A && r19B) ? (((await ev(`(async () => {
    try {
      const P = window.__avPack;
      if (!P || typeof P.build !== 'function') return { missing: true, avPack: P ? typeof P : 'absent' };
      const b = await P.build({ ids: ${JSON.stringify([r19A || '', r19B || ''])} });
      if (!b || typeof b !== 'object') return { bad: true, got: String(b) };
      const bytes = b.bytes || null;
      let u8 = null;
      try {
        if (bytes instanceof ArrayBuffer) u8 = new Uint8Array(bytes);
        else if (bytes && ArrayBuffer.isView(bytes)) u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      } catch (e0) { u8 = null; }
      const pk = !!u8 && u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4B;
      let zOk = null, zNames = null;
      try {
        if (u8 && typeof AVZIP !== 'undefined' && AVZIP && typeof AVZIP.list === 'function') {
          const lr = AVZIP.list(u8);
          zOk = !!(lr && lr.ok === true);
          zNames = (lr && Array.isArray(lr.entries)) ? lr.entries.map(function (e2) { return String(e2.name); }).slice(0, 8) : null;
        }
      } catch (e1) { /* the names stay null */ }
      window.__r19.packBytes = bytes;
      window.__r19.packName = String(b.name == null ? '' : b.name);
      window.__r19.manifest = (b.manifest && typeof b.manifest === 'object') ? b.manifest : null;
      const m = window.__r19.manifest || {};
      const rows = Array.isArray(m.items) ? m.items : [];
      return { ok: b.ok === true, name: String(b.name == null ? '' : b.name), err: String(b.error || ''),
               pk: pk, len: u8 ? u8.length : -1, zipOk: zOk, zipNames: zNames,
               v: m.v, id: String(m.id == null ? '' : m.id), app: String(m.app == null ? '' : m.app),
               rowsN: rows.length,
               rows: rows.map(function (x) { return { key: String((x && x.key) == null ? '' : x.key),
                 name: String((x && x.name) == null ? '' : x.name), path: String((x && x.path) == null ? '' : x.path),
                 kind: String((x && x.kind) == null ? '' : x.kind), sha: String((x && x.sha256) == null ? '' : x.sha256),
                 size: (x && typeof x.size === 'number') ? x.size : -1 }; }) };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)).value) || {}) : {};
  note('R19 build: ' + JSON.stringify({ ok: r19BuildV.ok, id: r19BuildV.id, rows: r19BuildV.rowsN, pk: r19BuildV.pk, zipOk: r19BuildV.zipOk }));
  const r19NamesOk = Array.isArray(r19BuildV.rows) && r19BuildV.rows.length === 2
    && r19BuildV.rows.map(function (r) { return String(r.name); }).sort().join(',') === 'r19-alpha.wav,r19-beta.wav';
  const r19RowsOk = Array.isArray(r19BuildV.rows) && r19BuildV.rows.length === 2
    && r19BuildV.rows.every(function (r) {
      return /^[0-9a-f]{64}$/.test(String(r.sha)) && String(r.path) === 'items/' + String(r.key) + '.wav'
        && String(r.kind) === 'sample' && r.size >= 0
        && Array.isArray(r19BuildV.zipNames) && r19BuildV.zipNames.indexOf(String(r.path)) >= 0;
    });
  const r19ZipManifest = Array.isArray(r19BuildV.zipNames) && r19BuildV.zipNames.indexOf('manifest.json') >= 0;
  const r19Del = (r19BuildV.ok === true) ? await r19RemoveNames(['r19-alpha.wav', 'r19-beta.wav']) : null;
  const r19Imp2 = (r19BuildV.ok === true && r19Del && r19Del.ok === true)
    ? await r19Import('pack round-trip', `[new File([window.__r19.packBytes], 'rig-r19.avpack')]`)
    : null;
  const r19Final = (r19Imp2 && r19Imp2.via !== null) ? (((await ev(`(async () => {
    try {
      const B = window.__r19 || {};
      const m = (B.manifest && typeof B.manifest === 'object') ? B.manifest : {};
      const mid = String(m.id == null ? '' : m.id);
      const rows = Array.isArray(m.items) ? m.items : [];
      const rowOf = function (n) { return rows.filter(function (x) { return x && String(x.name) === n; })[0] || null; };
      const l = (typeof avLibList === 'function') ? await avLibList() : null;
      const items = (l && l.items) || [];
      const hit = function (n) { return items.filter(function (i) { return i && String(i.name) === n; })[0] || null; };
      const a = hit('r19-alpha.wav'), b = hit('r19-beta.wav');
      const srcOf = function (it) {
        const s = (it && it.source && typeof it.source === 'object') ? it.source : null;
        return s ? { pack: String(s.pack == null ? '' : s.pack), name: String(s.name == null ? '' : s.name), path: String(s.path == null ? '' : s.path) } : null;
      };
      const ra = rowOf('r19-alpha.wav'), rb = rowOf('r19-beta.wav');
      const sa = srcOf(a), sb = srcOf(b);
      const st = (typeof avImportUiState !== 'undefined' && avImportUiState && Array.isArray(avImportUiState.reportItems)) ? avImportUiState.reportItems : [];
      const bundle = st.filter(function (x) { return x && String(x.kind) === 'bundle'; })[0] || st[0] || null;
      const bm = (bundle && bundle.meta && typeof bundle.meta === 'object') ? bundle.meta : {};
      const rl = (typeof avLibReceiptList === 'function') ? await avLibReceiptList() : null;
      const run0 = (rl && Array.isArray(rl.runs) && rl.runs[0]) ? rl.runs[0] : null;
      return { mid: mid,
               lib: { a: !!a, b: !!b, aPack: sa ? sa.pack : null, bPack: sb ? sb.pack : null,
                      aName: sa ? sa.name : null,
                      aPath: (sa && ra) ? (sa.path === String(ra.path)) : null,
                      bPath: (sb && rb) ? (sb.path === String(rb.path)) : null },
               report: { n: st.length, name: bundle ? String(bundle.name) : '', kind: bundle ? String(bundle.kind) : '',
                         result: bundle ? String(bundle.result) : '' },
               meta: { pack: String(bm.pack == null ? '' : bm.pack), items: (typeof bm.items === 'number') ? bm.items : null,
                       installed: (typeof bm.installed === 'number') ? bm.installed : null, refused: (typeof bm.refused === 'number') ? bm.refused : null },
               run0: run0 ? { counts: run0.counts || null } : null,
               dom: document.querySelectorAll('#av-import-lib [data-av-import-lib]').length };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)).value) || {}) : {};
  check('R19 round-trip: 2 WAVs -> __avPack.build (zip + manifest rows 2) -> delete -> reimport the .avpack: ONE bundle receipt · both land with source.pack',
    !!r19Imp1 && r19Imp1.via !== null && !!r19A && !!r19B
    && r19BuildV.ok === true && r19BuildV.pk === true && r19BuildV.zipOk === true && r19ZipManifest
    && r19BuildV.v === 1 && r19BuildV.app === 'anvil-app' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(String(r19BuildV.id))
    && r19BuildV.rowsN === 2 && r19NamesOk && r19RowsOk
    && !!r19Del && r19Del.ok === true
    && !!r19Imp2 && r19Imp2.via !== null
    && r19Final.lib && r19Final.lib.a === true && r19Final.lib.b === true
    && r19Final.lib.aPack === String(r19BuildV.id) && r19Final.lib.bPack === String(r19BuildV.id)
    && String(r19Final.lib.aName) === 'rig-r19.avpack'
    && r19Final.lib.aPath === true && r19Final.lib.bPath === true
    && !!r19Final.report && r19Final.report.n === 1 && r19Final.report.kind === 'bundle'
    && r19Final.report.result === 'imported' && String(r19Final.report.name) === 'rig-r19.avpack'
    && !!r19Final.meta && r19Final.meta.pack.length >= 1 && r19Final.meta.pack === String(r19BuildV.id)
    && r19Final.meta.items === 2 && r19Final.meta.installed === 2 && r19Final.meta.refused === 0
    && !!r19Final.run0 && !!r19Final.run0.counts
    && r19Final.run0.counts.bundles === 1 && r19Final.run0.counts.total === 1,
    JSON.stringify({ imp1: r19Imp1 && { via: r19Imp1.via, count: r19Imp1.count }, ids: { a: !!r19A, b: !!r19B },
      build: { ok: r19BuildV.ok, pk: r19BuildV.pk, zip: r19BuildV.zipOk, len: r19BuildV.len, id: r19BuildV.id, rows: r19BuildV.rowsN, err: r19BuildV.err || r19BuildV.missing ? (r19BuildV.err || 'missing') : '' },
      del: r19Del || null, imp2: r19Imp2 && { via: r19Imp2.via, count: r19Imp2.count }, final: r19Final }));

  /* 23d.2 sha-mismatch refusal: delete the pair again -> the corrupted pack (one payload byte
     flipped; scratch rebuild with a wrong manifest sha when locating fails) -> import ->
     alpha refuses (named), beta lands; item-level honest results ride the bundle row's meta
     (read from the RAW receipt — the facade return) */
  const r19Del2 = (r19Imp2 && r19Imp2.via !== null) ? await r19RemoveNames(['r19-alpha.wav', 'r19-beta.wav']) : null;
  const r19BadB = (r19BuildV.ok === true) ? await ev(`(() => { try { return window.__r19.buildBad(); } catch (e) { return { via: null, err: String((e && e.message) || e) }; } })()`) : {};
  let r19BadDrive = null;
  if (r19BadB.value && r19BadB.value.via && r19Del2 && r19Del2.ok === true) {
    const badBefore = await receiptsNow();
    const dR = await ev(`(async () => {
      try {
        const B = window.__r19;
        if (!B || !B.badBytes) return { noFixture: true };
        if (!window.__avImport || typeof window.__avImport.importFiles !== 'function') return { missing: true };
        const f = new File([B.badBytes], 'rig-r19-bad.avpack');
        const r = await window.__avImport.importFiles([f]);
        window.__r19.lastReceipt = r || null;
        return { ok: !!(r && r.ok), at: (r && typeof r.at === 'number') ? r.at : null };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    })()`);
    const bc = await waitFor(`(async () => { try { if (typeof avLibReceiptList !== 'function') return 0; const r = await avLibReceiptList(); return (r && r.ok === true && r.count === ${badBefore + 1}) ? r.count : 0; } catch (e) { return 0; } })()`, 25000);
    r19BadDrive = { dR: dR.value || null, before: badBefore, count: bc };
  }
  const r19BadR = r19BadDrive ? (((await ev(`(async () => {
    try {
      const B = window.__r19 || {};
      const raw = B.lastReceipt || null;
      const m = (B.manifest && typeof B.manifest === 'object') ? B.manifest : {};
      const mid = String(m.id == null ? '' : m.id);
      const items = (raw && Array.isArray(raw.items)) ? raw.items : [];
      const row = items.filter(function (x) { return x && String(x.kind) === 'bundle'; })[0] || items[0] || null;
      const meta = (row && row.meta && typeof row.meta === 'object') ? row.meta : {};
      const l = (typeof avLibList === 'function') ? await avLibList() : null;
      const list = (l && l.items) || [];
      const aHits = list.filter(function (i) { return i && String(i.name) === 'r19-alpha.wav'; }).length;
      const bHit = list.filter(function (i) { return i && String(i.name) === 'r19-beta.wav'; })[0] || null;
      const bPack = (bHit && bHit.source && typeof bHit.source === 'object') ? String(bHit.source.pack == null ? '' : bHit.source.pack) : null;
      let uiPub = [];
      try { uiPub = (typeof avImportUiState !== 'undefined' && avImportUiState && Array.isArray(avImportUiState.reportItems)) ? avImportUiState.reportItems : []; } catch (e0) { uiPub = []; }
      const named = JSON.stringify(meta).indexOf('r19-alpha.wav') >= 0
        || JSON.stringify(items).indexOf('r19-alpha.wav') >= 0
        || JSON.stringify((raw && raw.errors) || []).indexOf('r19-alpha.wav') >= 0
        || JSON.stringify(uiPub).indexOf('r19-alpha.wav') >= 0;
      const counts = (raw && raw.counts && typeof raw.counts === 'object') ? raw.counts : {};
      return { mid: mid, hasRaw: !!raw,
               row: row ? { name: String(row.name || ''), kind: String(row.kind || ''), result: String(row.result || ''), reason: String(row.reason || '') } : null,
               itemsN: items.length,
               meta: { pack: String(meta.pack == null ? '' : meta.pack), items: (typeof meta.items === 'number') ? meta.items : null,
                       installed: (typeof meta.installed === 'number') ? meta.installed : null, refused: (typeof meta.refused === 'number') ? meta.refused : null },
               named: named, aHits: aHits, bHit: !!bHit, bPack: bPack,
               counts: { total: counts.total, imported: counts.imported, refused: counts.refused, bundles: counts.bundles },
               errors: (raw && Array.isArray(raw.errors)) ? raw.errors.slice(0, 4).map(String) : [] };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)).value) || {}) : {};
  check('R19 sha-mismatch: corrupted pack -> alpha refused (named) · beta lands · item-level results in the receipt row meta',
    !!(r19BadB.value && r19BadB.value.via) && !!r19BadDrive
    && !!r19BadDrive.dR && r19BadDrive.dR.ok === true
    && r19BadDrive.count === r19BadDrive.before + 1
    && r19BadR.hasRaw === true && r19BadR.itemsN === 1
    && !!r19BadR.row && r19BadR.row.kind === 'bundle' && r19BadR.row.result === 'imported'
    && String(r19BadR.row.name) === 'rig-r19-bad.avpack'
    && r19BadR.mid.length >= 1 && r19BadR.meta.pack === r19BadR.mid
    && r19BadR.meta.items === 2 && r19BadR.meta.installed === 1 && r19BadR.meta.refused === 1
    && r19BadR.named === true
    && r19BadR.aHits === 0 && r19BadR.bHit === true && r19BadR.bPack === r19BadR.mid
    && r19BadR.counts.bundles === 1 && r19BadR.counts.total === 1,
    JSON.stringify({ bad: r19BadB.value || null, del2: r19Del2 || null,
      drive: r19BadDrive ? { before: r19BadDrive.before, count: r19BadDrive.count, ok: r19BadDrive.dR && r19BadDrive.dR.ok } : null,
      read: r19BadR }));

  /* 23d.3 generic zip unchanged: a plain zip (no manifest.json) still takes the R16
     expansion (one bundle row + child rows) — guards the route ordering */
  const r19GenB = await ev(`(() => { try { return window.__r19.makeGeneric(); } catch (e) { return { err: String((e && e.message) || e) }; } })()`);
  const r19GenImp = (r19GenB.value && r19GenB.value.len > 0)
    ? await r19Import('generic zip', `[new File([window.__r19.genZip], 'r19-generic.zip')]`)
    : null;
  const r19GenR = (r19GenImp && r19GenImp.via !== null) ? (((await ev(`(async () => {
    try {
      const rl = (typeof avLibReceiptList === 'function') ? await avLibReceiptList() : null;
      const run0 = (rl && Array.isArray(rl.runs) && rl.runs[0]) ? rl.runs[0] : null;
      let st = [];
      try { st = (typeof avImportUiState !== 'undefined' && avImportUiState && Array.isArray(avImportUiState.reportItems)) ? avImportUiState.reportItems : []; } catch (e0) { st = []; }
      const rows = st.map(function (x) { return { name: String((x && x.name) || ''), kind: String((x && x.kind) || ''), result: String((x && x.result) || ''), format: String((x && x.format) || '') }; });
      return { counts: (run0 && run0.counts) ? run0.counts : null, n: rows.length, rows: rows,
               dom: document.querySelectorAll('#av-import-report [data-av-import-row]').length };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)).value) || {}) : {};
  check('R19 generic zip: no manifest -> the R16 expansion (bundle row + the 2 children) unchanged',
    !!r19GenB.value && r19GenB.value.len > 0 && !!r19GenImp && r19GenImp.via !== null
    && !!r19GenR && r19GenR.n === 3 && r19GenR.dom === 3
    && r19GenR.rows.length === 3 && r19GenR.rows[0].kind === 'bundle' && r19GenR.rows[0].result === 'imported'
    && r19GenR.rows.some(function (r) { return r.name === 'r19-gen.wav' && r.result === 'imported' && r.format === 'wav'; })
    && r19GenR.rows.some(function (r) { return r.name === 'readme.txt'; })
    && !!r19GenR.counts && r19GenR.counts.bundles === 1 && r19GenR.counts.total === 3,
    JSON.stringify(r19GenR));

  /* ===== R21 section 5: N1-N7 — the library OVERLAY surface (verify/_r21_wave.md section 5).
     The manager moved into #av-library-pop (ids preserved): strip + open focus + containment
     (N1), Esc close + focus return + facade shapes (N2), format facet (N3), pack facet (N4),
     incremental rows (N5), bulk load (N6), inspector (N7). N5 synthesizes 65 tiny WAVs
     in-page, imports them through the facade, then DELETES them again (select + delete) so
     the drop/row legs and the zero-error leg stay pristine. ===== */

  /* ── N1. strip: #av-import-libsum carries the count + the REAL OPEN LIBRARY button opens the
     overlay (focus lands in #av-import-search; the manager is contained by the overlay) ── */
  const n1Close = await closeLibrary();   /* the overlay is open (mgrOpen3) — start from closed */
  const n1Zone = await ev(`(() => {
    try {
      const ok = (typeof avZoneShow === 'function') ? avZoneShow('store', { source: 'rig' }) : false;
      const btn = document.getElementById('av-import-libopen');
      if (btn && typeof btn.focus === 'function') btn.focus();   /* deterministic opener for N2 */
      const shown = Array.prototype.filter.call(document.querySelectorAll('.av-zone'), function (z) { return !z.hidden; });
      return { ok: ok, zone: shown[0] ? shown[0].getAttribute('data-zone') : null, btn: !!btn };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  await sleep(250);
  const n1Stat = await waitFor(`(async () => {
    try {
      const el = document.getElementById('av-import-libsum');
      const t = el ? String(el.textContent || '') : '';
      const ix = t.indexOf(' item');
      let n = null;
      if (ix > 0) { let j = ix; while (j > 0 && t.charAt(j - 1) >= '0' && t.charAt(j - 1) <= '9') j--; if (j < ix) n = Number(t.slice(j, ix)); }
      let count = -1;
      try { const l = await avLibList(); count = (l && l.ok === true && typeof l.count === 'number') ? l.count : -1; } catch (e0) { count = -1; }
      const p = document.getElementById('av-library-pop');
      if (n === null || count < 1 || n !== count) return null;
      if (p && p.hidden !== true) return null;
      return { text: t, n: n, count: count, closed: !p || p.hidden === true };
    } catch (e) { return null; }
  })()`, 10000);
  let n1StatRaw = null;
  if (!n1Stat) n1StatRaw = (await ev(`(() => { const el = document.getElementById('av-import-libsum'); const p = document.getElementById('av-library-pop'); return { text: el ? String(el.textContent || '') : null, hidden: p ? p.hidden === true : null }; })()`)).value;
  const n1Click = await clickSel('#av-import-libopen', 400);
  const n1Open = await waitFor(`(() => {
    const p = document.getElementById('av-library-pop');
    if (!p || p.hidden === true) return null;
    const s = document.getElementById('av-import-search');
    if (!s || document.activeElement !== s) return null;
    return { open: true, focus: 'av-import-search' };
  })()`, 10000);
  const n1Cont = await ev(`(() => {
    const p = document.getElementById('av-library-pop');
    const s = document.getElementById('av-import-search');
    const l = document.getElementById('av-import-lib');
    return { hasSearch: !!(p && s && p.contains(s)), hasLib: !!(p && l && p.contains(l)) };
  })()`);
  const n1c = n1Cont.value || {};
  check('R21 N1 strip: #av-import-libsum carries the count + the REAL OPEN LIBRARY button opens the overlay (focus in search, manager contained)',
    !!n1Stat && n1Stat.n === n1Stat.count && n1Stat.count >= 1
    && !!n1Zone.value && n1Zone.value.zone === 'store' && n1Zone.value.btn === true
    && n1Click === true && !!n1Open && n1Open.focus === 'av-import-search'
    && n1c.hasSearch === true && n1c.hasLib === true,
    JSON.stringify({ closed: n1Close, stat: n1Stat || n1StatRaw, zone: n1Zone.value || null, click: n1Click, open: n1Open || null, cont: n1c }));

  /* ── N2. close: Esc closes (hidden back) + focus returns to the strip button; facade
     isOpen() false; open/close/toggle shapes true ── */
  const n2Esc = await ev(`(() => {
    try {
      const p = document.getElementById('av-library-pop');
      const before = { open: !!(p && p.hidden !== true) };
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
      return before;
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  const n2Closed = await waitFor(`(() => { const p = document.getElementById('av-library-pop'); return (p && p.hidden === true) ? true : null; })()`, 8000);
  const n2Focus = await waitFor(`(() => { const a = document.activeElement; const b = document.getElementById('av-import-libopen'); return (a && b && a === b) ? { onStrip: true, id: String(a.id || '') } : null; })()`, 5000);
  let n2FocusRaw = null;
  if (!n2Focus) n2FocusRaw = (await ev(`(() => { const a = document.activeElement; return { id: a ? String(a.id || a.tagName || '') : null }; })()`)).value;
  const n2Shapes = await ev(`(async () => {
    try {
      const L = window.__avLibrary || {};
      const T = function (x) { return (String(x) === 'true') || !!(x && x.ok === true); };
      const isOpen = function () { return (typeof L.isOpen === 'function') ? (L.isOpen() === true) : null; };
      const r = { isOpen0: isOpen() };
      r.open = (typeof L.open === 'function') ? T(L.open()) : null; r.openSt = isOpen();
      r.close = (typeof L.close === 'function') ? T(L.close()) : null; r.closeSt = isOpen();
      /* R21 rigfix: avLibraryUiToggle returns the NEW STATE (avAboutToggle shape) — true when
         asked on, false when asked off; assert the STATE equality, not op-success truthiness. */
      r.toggleOn = (typeof L.toggle === "function") ? (L.toggle(true) === true) : null; r.toggleOnSt = isOpen();
      r.toggleOff = (typeof L.toggle === "function") ? (L.toggle(false) === false) : null; r.toggleOffSt = isOpen();
      return r;
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  const n2s = n2Shapes.value || {};
  check('R21 N2 close: Esc closes + focus returns to the strip button + facade open/close/toggle shapes true (isOpen false)',
    !!n2Esc.value && n2Esc.value.open === true && n2Closed === true
    && !!n2Focus && n2Focus.onStrip === true
    && n2s.isOpen0 === false && n2s.open === true && n2s.openSt === true && n2s.close === true
    && n2s.closeSt === false && n2s.toggleOn === true && n2s.toggleOnSt === true
    && n2s.toggleOff === true && n2s.toggleOffSt === false,
    JSON.stringify({ esc: n2Esc.value || null, closed: n2Closed, focus: n2Focus || n2FocusRaw, shapes: n2s }));

  /* ── N3. format facet: data-fmt="wav" narrows to the wav count, "all" restores ── */
  const n3Open = await openLibrary();
  const n3Info = await ev(`(async () => {
    try {
      const l = await avLibList();
      const items = (l && l.items) || [];
      const isWav = function (it) {
        if (typeof avImportUiExtOf === 'function') { try { return String(avImportUiExtOf(it) || '').toLowerCase() === 'wav'; } catch (e0) { /* fall through */ } }
        const nm = String((it && it.name) || '').toLowerCase();
        return nm.slice(-4) === '.wav';
      };
      const wavs = items.filter(isWav).map(function (it) { return String(it.name); });
      return { total: items.length, wavs: wavs };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  const n3v = n3Info.value || {};
  await ev(`(() => { const c = document.querySelector('#av-import-formats [data-fmt="wav"]'); if (!c) return { missing: true }; c.click(); return { ok: true }; })()`);
  const n3Wav = await waitFor(`(() => {
    const rows = Array.prototype.slice.call(document.querySelectorAll('#av-import-lib [data-av-import-lib]'));
    const want = ${JSON.stringify(Array.isArray(n3v.wavs) ? n3v.wavs : [])};
    if (!want.length || rows.length !== Math.min(want.length, 60)) return null;
    const texts = rows.map(function (r) { return String(r.textContent || ''); });
    if (!texts.every(function (t) { return want.some(function (n) { return t.indexOf(n) >= 0; }); })) return null;
    const snap = (window.__avImport && window.__avImport.snap) ? window.__avImport.snap() : {};
    const m = snap.manager || {};
    if (m.fmt !== 'wav') return null;
    return { rows: rows.length, want: want.length, fmt: m.fmt };
  })()`, 10000);
  await ev(`(() => { const c = document.querySelector('#av-import-formats [data-fmt="all"]'); if (!c) return { missing: true }; c.click(); return { ok: true }; })()`);
  const n3All = await waitFor(`(() => {
    const rows = document.querySelectorAll('#av-import-lib [data-av-import-lib]').length;
    const total = ${Number(n3v.total) || 0};
    if (total < 1 || rows !== Math.min(total, 60)) return null;
    const snap = (window.__avImport && window.__avImport.snap) ? window.__avImport.snap() : {};
    const m = snap.manager || {};
    if (m.fmt !== 'all') return null;
    return { rows: rows, total: total, fmt: m.fmt };
  })()`, 10000);
  check('R21 N3 format facet: data-fmt="wav" narrows to the wav count, "all" restores (snap manager.fmt mirrors)',
    Array.isArray(n3v.wavs) && n3v.wavs.length >= 1 && !!n3Wav && n3Wav.rows === Math.min(n3v.wavs.length, 60)
    && !!n3All && n3All.rows === Math.min(n3v.total, 60) && n3All.fmt === 'all',
    JSON.stringify({ open: n3Open, total: n3v.total, wavs: Array.isArray(n3v.wavs) ? n3v.wavs.length : null, wav: n3Wav || null, all: n3All || null }));

  /* ── N4. pack facet: the R19 pack's chip narrows to its items; __none present when unpacked
     items exist ── */
  const n4Info = await ev(`(async () => {
    try {
      const l = await avLibList();
      const items = (l && l.items) || [];
      const packOf = function (it) { return (it && it.source && typeof it.source === 'object' && it.source.pack) ? String(it.source.pack) : ''; };
      const packed = items.filter(function (it) { return packOf(it) !== ''; });
      const ids = [];
      packed.forEach(function (it) { const p = packOf(it); if (ids.indexOf(p) < 0) ids.push(p); });
      const id = ids.length ? ids[0] : '';
      const mine = packed.filter(function (it) { return packOf(it) === id; });
      const unpacked = items.filter(function (it) { return packOf(it) === ''; }).length;
      return { id: id, n: mine.length, names: mine.map(function (it) { return String(it.name); }),
               unpacked: unpacked, total: items.length,
               chip: id ? !!document.querySelector('#av-import-packs [data-pack="' + id + '"]') : false,
               noneChip: !!document.querySelector('#av-import-packs [data-pack="__none"]') };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  const n4v = n4Info.value || {};
  await ev(`(() => { const id = ${JSON.stringify(String(n4v.id || ''))}; if (!id) return { missing: true }; const c = document.querySelector('#av-import-packs [data-pack="' + id + '"]'); if (!c) return { missing: true }; c.click(); return { ok: true }; })()`);
  const n4Pack = await waitFor(`(() => {
    const rows = Array.prototype.slice.call(document.querySelectorAll('#av-import-lib [data-av-import-lib]'));
    const want = ${JSON.stringify(Array.isArray(n4v.names) ? n4v.names : [])};
    const id = ${JSON.stringify(String(n4v.id || ''))};
    if (!want.length || !id || rows.length !== Math.min(want.length, 60)) return null;
    const texts = rows.map(function (r) { return String(r.textContent || ''); });
    if (!texts.every(function (t) { return want.some(function (n) { return t.indexOf(n) >= 0; }); })) return null;
    const snap = (window.__avImport && window.__avImport.snap) ? window.__avImport.snap() : {};
    const m = snap.manager || {};
    if (m.pack !== id) return null;
    return { rows: rows.length, want: want.length, pack: m.pack };
  })()`, 10000);
  await ev(`(() => { const c = document.querySelector('#av-import-packs [data-pack="all"]'); if (!c) return { missing: true }; c.click(); return { ok: true }; })()`);
  const n4All = await waitFor(`(() => {
    const rows = document.querySelectorAll('#av-import-lib [data-av-import-lib]').length;
    const total = ${Number(n4v.total) || 0};
    if (total < 1 || rows !== Math.min(total, 60)) return null;
    const snap = (window.__avImport && window.__avImport.snap) ? window.__avImport.snap() : {};
    const m = snap.manager || {};
    if (m.pack !== 'all') return null;
    return { rows: rows, total: total, pack: m.pack };
  })()`, 10000);
  check('R21 N4 pack facet: data-pack="<packid>" narrows to the pack items + __none present when unpacked items exist (snap manager.pack mirrors)',
    !!n4v.id && n4v.n >= 1 && n4v.chip === true && n4v.unpacked >= 1 && n4v.noneChip === true
    && !!n4Pack && n4Pack.rows === Math.min(n4v.n, 60)
    && !!n4All && n4All.rows === Math.min(n4v.total, 60) && n4All.pack === 'all',
    JSON.stringify({ pack: n4v, narrowed: n4Pack || null, all: n4All || null }));

  /* ── N5. incremental: 65 synthetic WAVs -> 60 rows + "show more (60 of M)" -> one click ->
     all rows + button hidden; the synthetic items are deleted again (select + delete = cleanup) ── */
  const n5Imp = await ev(`(async () => {
    try {
      if (typeof avWavEncode !== 'function') return { err: 'avWavEncode absent' };
      const l0 = (typeof avLibList === 'function') ? await avLibList() : null;
      const before = (l0 && typeof l0.count === 'number') ? l0.count : -1;
      if (before < 0) return { err: 'no avLibList count' };
      const files = [];
      for (let i = 0; i < 65; i++) {
        const sr = 8000, n = 400;
        const lch = new Float32Array(n), rch = new Float32Array(n);
        const freq = 220 + i * 3;
        for (let k = 0; k < n; k++) { const v2 = 0.4 * Math.sin(2 * Math.PI * freq * k / sr); lch[k] = v2; rch[k] = v2; }
        const wav = avWavEncode({ l: lch, r: rch, sr: sr, bits: 16, dither: false });
        if (!wav) return { err: 'encode null at ' + i };
        files.push(new File([wav], 'r21-n5-' + ('0' + i).slice(-2) + '.wav'));
      }
      window.__n5Names = files.map(function (x) { return x.name; });
      const f = window.__avImport;
      if (!f || typeof f.importFiles !== 'function') return { err: 'importFiles absent' };
      const r = await f.importFiles(files);
      return { ok: true, before: before, n: files.length, ret: (r && typeof r === 'object') ? (r.ok === true) : (String(r) === 'true') };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  const n5Want = (n5Imp.value && n5Imp.value.ok === true && typeof n5Imp.value.before === 'number' && n5Imp.value.before >= 0) ? n5Imp.value.before + 65 : -1;
  const n5Count = (n5Want > 0) ? await waitFor(`(async () => {
    try {
      const l = (typeof avLibList === 'function') ? await avLibList() : null;
      if (!l || l.ok !== true || l.count !== ${n5Want}) return null;
      const names = window.__n5Names || [];
      const got = (l.items || []).filter(function (i) { return names.indexOf(String(i.name)) >= 0; }).length;
      return (got === names.length && names.length === 65) ? { count: l.count, got: got } : null;
    } catch (e) { return null; }
  })()`, 45000) : null;
  const n5Paint = await waitFor(`(async () => {
    try {
      const rows = document.querySelectorAll('#av-import-lib [data-av-import-lib]').length;
      if (rows !== 60) return null;
      const more = document.getElementById('av-import-more');
      if (!more || more.hidden === true) return null;
      const t = String(more.textContent || '').trim();
      const a = t.indexOf('('), b2 = t.indexOf(' of '), c2 = t.indexOf(')', b2 + 1);
      if (a < 0 || b2 < 0 || c2 < 0 || t.slice(0, 9).toLowerCase() !== 'show more') return null;
      const p = Number(t.slice(a + 1, b2));
      const ms = t.slice(b2 + 4);
      let di = 0; while (di < ms.length && ms.charAt(di) >= '0' && ms.charAt(di) <= '9') di++;
      const M = di > 0 ? Number(ms.slice(0, di)) : NaN;
      const l = (typeof avLibList === 'function') ? await avLibList() : null;
      if (!l || l.ok !== true || p !== 60 || M !== l.count) return null;
      return { rows: rows, label: t, p: p, M: M };
    } catch (e) { return null; }
  })()`, 25000);
  await ev(`(() => { const b2 = document.getElementById('av-import-more'); if (!b2) return { missing: true }; b2.click(); return { ok: true }; })()`);
  const n5All = await waitFor(`(async () => {
    try {
      const l = (typeof avLibList === 'function') ? await avLibList() : null;
      if (!l || l.ok !== true) return null;
      const rows = document.querySelectorAll('#av-import-lib [data-av-import-lib]').length;
      const more = document.getElementById('av-import-more');
      if (l.count <= 60 || rows !== l.count || !more || more.hidden !== true) return null;
      return { rows: rows, count: l.count, hidden: more.hidden === true };
    } catch (e) { return null; }
  })()`, 15000);
  const n5SelR = await ev(`(async () => {
    try {
      const names = window.__n5Names || [];
      const l = (typeof avLibList === 'function') ? await avLibList() : null;
      const items = (l && l.items) || [];
      const mine = items.filter(function (i) { return names.indexOf(String(i.name)) >= 0; });
      if (mine.length !== names.length) return { missingItems: mine.length, names: names.length };
      const on = function (el) { return !!(el && (el.checked === true || el.getAttribute('aria-checked') === 'true' || (el.classList && el.classList.contains('on')))); };
      for (let i = 0; i < mine.length; i++) {
        const box = document.querySelector('#av-import-lib [data-av-import-lib="' + String(mine[i].id) + '"] [data-av-import-check]');
        if (!box) return { missingBox: String(mine[i].id) };
        if (!on(box)) box.click();
        await new Promise(function (r) { setTimeout(r, 30); });
      }
      let checked = 0;
      for (let k = 0; k < 60; k++) {
        checked = Array.prototype.filter.call(document.querySelectorAll('#av-import-lib [data-av-import-check]'), on).length;
        if (checked >= mine.length) break;
        await new Promise(function (r) { setTimeout(r, 250); });
      }
      return { want: mine.length, checked: checked };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  await ev(`(() => { const b2 = document.getElementById('av-import-delsel'); if (!b2) return { missing: true }; b2.click(); return { ok: true }; })()`);
  const n5Clean = await waitFor(`(async () => {
    try {
      const l = (typeof avLibList === 'function') ? await avLibList() : null;
      if (!l || l.ok !== true) return null;
      const names = window.__n5Names || [];
      if ((l.items || []).some(function (i) { return names.indexOf(String(i.name)) >= 0; })) return null;
      if (l.count !== ${n5Want > 0 ? n5Want - 65 : -1}) return null;
      const rows = document.querySelectorAll('#av-import-lib [data-av-import-lib]').length;
      return { count: l.count, rows: rows };
    } catch (e) { return null; }
  })()`, 45000);
  check('R21 N5 incremental: 65 synthetic WAVs -> 60 rows + "show more (60 of M)" -> one click -> all rows + button hidden; synthetic deleted (cleanup)',
    !!n5Imp.value && n5Imp.value.ok === true && n5Imp.value.n === 65 && !!n5Count && n5Count.got === 65
    && !!n5Paint && n5Paint.p === 60 && n5Paint.M > 60 && n5Paint.rows === 60
    && !!n5All && n5All.rows === n5All.count && n5All.hidden === true
    && !!n5SelR.value && n5SelR.value.want === 65 && n5SelR.value.checked === 65
    && !!n5Clean && n5Clean.count === (n5Want - 65) && n5Clean.rows === n5Clean.count,
    JSON.stringify({ imp: n5Imp.value || null, count: n5Count || null, paint: n5Paint || null, all: n5All || null, sel: n5SelR.value || null, clean: n5Clean || null }));

  /* ── N6. bulk: select 2 sample rows -> [data-av-import-bulk="load"] -> both load
     sequentially (session entries +2, 48 kHz native); the button is disabled at zero ── */
  const n6Zero = await ev(`(() => {
    const on = function (el) { return !!(el && (el.checked === true || el.getAttribute('aria-checked') === 'true' || (el.classList && el.classList.contains('on')))); };
    const checked = Array.prototype.filter.call(document.querySelectorAll('#av-import-lib [data-av-import-check]'), on);
    for (let i = 0; i < checked.length; i++) checked[i].click();
    return { unchecked: checked.length };
  })()`);
  const n6Dis = await waitFor(`(() => {
    const b2 = document.querySelector('#av-import-bulk [data-av-import-bulk="load"]');
    if (!b2) return null;
    return ((b2.disabled === true) || (b2.getAttribute('aria-disabled') === 'true')) ? { disabled: true } : null;
  })()`, 8000);
  const n6Pick = await ev(`(async () => {
    try {
      const l = (typeof avLibList === 'function') ? await avLibList() : null;
      const items = (l && l.items) || [];
      const samples = items.filter(function (i) { return i && String(i.kind) === 'sample'; });
      let a = null, b2 = null;
      for (let i = 0; i < samples.length; i++) if (String(samples[i].name) === 'x.wav') a = samples[i];
      for (let i = 0; i < samples.length; i++) if (String(samples[i].name) === 'kick.wav') b2 = samples[i];
      if (!a) a = samples[0] || null;
      if (!b2) b2 = samples.filter(function (i) { return !a || String(i.id) !== String(a.id); })[0] || null;
      if (!a || !b2) return { missing: true, samples: samples.length };
      return { a: String(a.id), b: String(b2.id), n0: (typeof avSampleStore !== "undefined" && avSampleStore.entries) ? avSampleStore.entries.length : -1 };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  const n6p = n6Pick.value || {};
  const n6Sel = await ev(`(async () => {
    try {
      const ids = [${JSON.stringify(String(n6p.a || ''))}, ${JSON.stringify(String(n6p.b || ''))}];
      for (let i = 0; i < ids.length; i++) {
        if (!ids[i]) return { missingId: i };
        const box = document.querySelector('#av-import-lib [data-av-import-lib="' + ids[i] + '"] [data-av-import-check]');
        if (!box) return { missingBox: ids[i] };
        box.click();
        await new Promise(function (r) { setTimeout(r, 250); });
      }
      return { ok: true };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  const n6Arm = await waitFor(`(() => {
    const b2 = document.querySelector('#av-import-bulk [data-av-import-bulk="load"]');
    if (!b2) return null;
    if ((b2.disabled === true) || (b2.getAttribute('aria-disabled') === 'true')) return null;
    const snap = (window.__avImport && window.__avImport.snap) ? window.__avImport.snap() : {};
    const m = snap.manager || {};
    return { label: String(b2.textContent || '').trim(), selected: m.selected };
  })()`, 8000);
  const n6ArmOk = !!n6Arm && ((typeof n6Arm.selected === 'number' && n6Arm.selected === 2) || (Array.isArray(n6Arm.selected) && n6Arm.selected.length === 2));
  await ev(`(() => { const b2 = document.querySelector('#av-import-bulk [data-av-import-bulk="load"]'); if (!b2) return { missing: true }; b2.click(); return { ok: true }; })()`);
  const n6Load = await waitFor(`(() => {
    const es = (typeof avSampleStore !== "undefined" && avSampleStore.entries) ? avSampleStore.entries : null;
    if (!es || es.length < ${Number(n6p.n0) + 2}) return null;
    const e0 = es[es.length - 2], e1 = es[es.length - 1];
    const ok1 = !!e0 && e0.sampleRate === 48000 && e0.buffer && e0.buffer.length > 0 && isFinite(e0.buffer.duration) && e0.buffer.duration > 0;
    const ok2 = !!e1 && e1.sampleRate === 48000 && e1.buffer && e1.buffer.length > 0 && isFinite(e1.buffer.duration) && e1.buffer.duration > 0;
    if (!ok1 || !ok2) return null;
    return { n: es.length, a: { rate: e0.sampleRate, frames: e0.buffer.length, secs: e0.buffer.duration },
             b: { rate: e1.sampleRate, frames: e1.buffer.length, secs: e1.buffer.duration } };
  })()`, 30000);
  check('R21 N6 bulk: 2 selected sample rows load via [data-av-import-bulk=load] (session entries +2, 48 kHz native) · disabled at zero selection',
    !!n6Pick.value && !!n6p.a && !!n6p.b && n6p.n0 >= 0
    && !!n6Sel.value && n6Sel.value.ok === true
    && !!n6Dis && n6Dis.disabled === true && n6ArmOk
    && !!n6Load && n6Load.n === n6p.n0 + 2,
    JSON.stringify({ zero: n6Dis || null, pick: n6p, sel: n6Sel.value || null, arm: n6Arm || null, load: n6Load || null }));

  /* ── N7. inspector: a row info button -> #av-import-detail (name/id/sha/source lines) ->
     close hides it ── */
  const n7Pick = await ev(`(async () => {
    try {
      const l = (typeof avLibList === 'function') ? await avLibList() : null;
      const items = (l && l.items) || [];
      const withPack = items.filter(function (i) { return i && i.source && typeof i.source === 'object' && i.source.pack; })[0] || null;
      const it = items.filter(function (i) { return i && String(i.name) === 'r19-beta.wav'; })[0] || withPack || items[0] || null;
      if (!it) return { missing: true };
      return { id: String(it.id), name: String(it.name), sha: String(it.sha256 || ''),
               pack: (it.source && it.source.pack) ? String(it.source.pack) : '',
               srcName: (it.source && it.source.name) ? String(it.source.name) : '' };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  const n7p = n7Pick.value || {};
  const n7Click = await ev(`(() => {
    const row = document.querySelector('#av-import-lib [data-av-import-lib="' + ${JSON.stringify(String(n7p.id || ''))} + '"]');
    if (!row) return { missingRow: true };
    const b2 = row.querySelector('[data-av-import-act="info"]');
    if (!b2) return { missingBtn: true };
    b2.click();
    return { ok: true };
  })()`);
  const n7Open = await waitFor(`(() => {
    const d = document.getElementById('av-import-detail');
    if (!d || d.hidden === true) return null;
    let titles = '';
    try { titles = Array.prototype.map.call(d.querySelectorAll('[title]'), function (e2) { return String(e2.getAttribute('title') || ''); }).join('|'); } catch (e0) { titles = ''; }
    return { text: String(d.textContent || '').slice(0, 4000), titles: titles.slice(0, 4000) };
  })()`, 8000);
  const n7Ok = !!n7Open && !!n7p.id && n7Open.text.indexOf(String(n7p.name)) >= 0 && n7Open.text.indexOf(String(n7p.id)) >= 0
    && (n7p.sha ? (n7Open.text.indexOf(String(n7p.sha).slice(0, 16)) >= 0 || n7Open.titles.indexOf(String(n7p.sha)) >= 0) : true)
    && (n7p.pack ? n7Open.text.indexOf(String(n7p.pack)) >= 0 : true)
    && (n7p.srcName ? n7Open.text.indexOf(String(n7p.srcName)) >= 0 : true);
  const n7Close = await ev(`(() => { const b2 = document.getElementById('av-import-detail-close'); if (!b2) return { missing: true }; b2.click(); return { ok: true }; })()`);
  const n7Hid = await waitFor(`(() => { const d = document.getElementById('av-import-detail'); return (d && d.hidden === true) ? true : null; })()`, 8000);
  check('R21 N7 inspector: row info -> #av-import-detail (name/id/sha/source lines) -> close hides it',
    !!n7p.id && !!n7Click.value && n7Click.value.ok === true && n7Ok
    && !!n7Close.value && n7Close.value.ok === true && n7Hid === true,
    JSON.stringify({ item: { id: n7p.id, name: n7p.name, sha: String(n7p.sha || '').slice(0, 16), pack: n7p.pack, srcName: n7p.srcName },
                     click: n7Click.value || null, open: n7Open ? { text: n7Open.text.slice(0, 200) } : null, ok: n7Ok, hid: n7Hid }));

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

  /* R21: the row-action buttons live inside the overlay — ensure it is OPEN (idempotent) so the
     real click below lands on the row's LOAD button. */
  const open26 = await openLibrary();
  note('R21 row-action overlay open: ' + JSON.stringify(open26));

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
