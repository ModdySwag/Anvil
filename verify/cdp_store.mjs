// cdp_store.mjs — Anvil P5 store suite (child sa-1's rig; WRITTEN by child sa-1, RUN BY THE PARENT
// after integration). End-to-end over raw CDP against the frozen single-file build.
//
//   node verify/cdp_store.mjs [path-to-index.html] [--port N] [--sha <hex>]
//
// WRITE-ONLY: this file is authored by sa-1 and never executed by sa-1. The parent runs it after
// the P5 integration build (index.html must contain av_store.js + av_store_ui.js and body.html
// must carry the store card + #av-store-host).
//
// Launch skeleton follows cdp_fx.mjs VERBATIM (candidates Chrome/Edge/Brave, free-port scan,
// fresh temp --user-data-dir, 1440×900 device metrics override — Edge headless ignores
// --window-size, --mute-audio, --autoplay-policy=no-user-gesture-required, ONE browser, explicit
// exit, process.on('exit') kills ONLY processes whose command line carries OUR temp profile).
// SHA freeze discipline from cdp_midi.mjs / cdp_sample.mjs / cdp_fx.mjs: index.html is sha256'd
// before and after the run and the two must match. EXPECT_SHA is null until the parent pins the
// frozen P5 sha (constant below or --sha <hex>); while it is null the rig still enforces
// before === after.
//
// WHAT IT PROVES, in order (contract: verify/_p5_wave.md §4b + store-port-digest.md §4 map):
//   1. boot contract (data-av-ready) + the store card mounted into the parent-owned #av-store-host:
//      card root, search, filter chips, status line, storage line (honest mode chip), the
//      INSTALLED + AVAILABLE list containers, host wired marker, exports live (avStoreUiInit /
//      avStoreUiSync / avStoreUiClasses + window.__avStoreUi) and the store-core preflight
//      (avStoreInit · avStoreIndex · avStoreInstall · avStoreRemove · avStoreStatus ·
//      avStoreInstalled · avStoreSetFetch — the pinned *_p5_wave.md §4b API).
//   1b. absent-host contract: with #av-store-host detached avStoreUiInit() returns false WITHOUT
//      throwing; re-attaching the host re-mounts the card.
//   2. MOCK injection through the avStoreSetFetch seam: three synthetic packs built IN PAGE with
//      REAL sha256 (crypto.subtle) — rig-alpha (2 pinned-shape entries + 3 presets), rig-beta,
//      rig-badsha (the manifest sha deliberately does NOT match its bytes). No network, no
//      server: file:// + the seam is the pinned development law.
//   3. index loads: avStoreUiRefresh(true) -> ok with 3 packs -> 3 available cards; card content
//      (name · count tag · size/sha meta · INSTALL) and the filter chips carry LIVE counts.
//   4. install (real mouse click on the card button): the progress affordance appears (card
//      .busy + disabled button + <progress>), then the card lands in INSTALLED with the badge
//      and the live counts move; three layers agree: DOM, avStoreInstalled(), and an INDEPENDENT
//      indexedDB.open('av-packs-store') read whose sha equals the manifest sha.
//   5. filter + search cut the lists; clearing restores.
//   6. remove (real click): badge clears, counts restore, the IDB record is gone (ground truth).
//   7. reinstall is idempotent: exactly one record, same sha.
//   8. host down (the seam rejects): installed packs survive, the OFFLINE badge shows on the
//      installed card, the status copy says the host is unreachable; host back -> badge clears.
//   9. mem-mode honest chip: with the store forced to report backend 'mem' (stub over
//      avStoreStatus), the chip says memory-only — never IndexedDB; removing the stub restores
//      the honest chip for the real backend.
//   10. sha-mismatch refusal: clicking INSTALL on rig-badsha is refused — no badge, count
//      unchanged, no client record, honest refusal copy on the status line.
//   11. zero page errors · screenshot renders/p5-store-suite.png · freeze sha256 before === after.
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

/* FREEZE LAW: the bytes under test are named before anything runs, and re-checked after.
   P5: the frozen sha of the rebuilt index.html is not known until build.py runs — the parent may
   fill this constant or pass --sha <hex>; the rig never loosens the before === after check. */
const EXPECT_SHA = '1bbfe2cfe0631b60cba80b80176e451256accf31e97f72c41db57d79dddb54aa';
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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9520);
const profile = path.join(tmpdir(), 'anvil-storeui-' + Date.now());
const url = 'file:///' + path.resolve(page).replace(/\\/g, '/');
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

/* ---------- page-side mock (rig-owned; never app code) ----------
   Synthetic packs built in-page with REAL sha256 via crypto.subtle over the exact bytes the
   seam serves. The manifest follows the PINNED _p5_wave.md §4b shape
   {v, packs:[{id,name,file,sha256,bytes,presetCount,tags,engine}]}. rig-badsha's manifest sha
   is deliberately wrong so the store's verify-before-commit path must refuse it. The alpha pack
   answers with a 500 ms delay so the UI's progress affordance is observable. */

const MOCK_BUILD = `window.__storeMockReady = (async () => {
  const enc = new TextEncoder();
  async function shaHex(u8) {
    const d = await crypto.subtle.digest('SHA-256', u8);
    const b = new Uint8Array(d); let s = '';
    for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
    return s;
  }
  const mk = (id, name, engine, presets) => ({ v: 1, id: id, meta: { name: name, author: 'RIG Foundry', license: 'CC0-1.0', tags: ['rig'], description: 'synthetic rig pack — ' + name, engine: engine }, presets: presets });
  const P = (n, section, patch) => ({ name: n, section: section, tags: ['rig'], patch: patch });
  const A = mk('rig-alpha', 'RIG ALPHA', 'mixed', [
    P('A1', 'VA', { 'osc1.type': 'saw', 'filter.cutoff': 800 }),
    P('A2', 'VA', { 'osc1.type': 'square', 'filter.cutoff': 1200 }),
    P('A3', 'ACID', { 'engine.kind': 'acid', 'acid.cutoff': 900 }),
  ]);
  const B = mk('rig-beta', 'RIG BETA', 'va', [
    P('B1', 'VA', { 'osc1.type': 'sine' }),
    P('B2', 'STRING', { 'engine.kind': 'string' }),
  ]);
  const C = mk('rig-badsha', 'RIG BAD SHA', 'va', [ P('C1', 'VA', { 'osc1.type': 'tri' }) ]);
  const bA = enc.encode(JSON.stringify(A)), bB = enc.encode(JSON.stringify(B)), bC = enc.encode(JSON.stringify(C));
  const sA = await shaHex(bA), sB = await shaHex(bB), sC = await shaHex(bC);
  const doc = { v: 1, name: 'RIG STORE', packs: [
    { id: 'rig-alpha', name: 'RIG ALPHA', file: 'rig-alpha.avbank.json', sha256: sA, bytes: bA.length, presetCount: 3, tags: ['rig', 'test'], engine: 'mixed' },
    { id: 'rig-beta', name: 'RIG BETA', file: 'rig-beta.avbank.json', sha256: sB, bytes: bB.length, presetCount: 2, tags: ['rig'], engine: 'va' },
    { id: 'rig-badsha', name: 'RIG BAD SHA', file: 'rig-badsha.avbank.json', sha256: 'f'.repeat(64), bytes: bC.length, presetCount: 1, tags: ['rig'], engine: 'va' },
  ] };
  const M = { v: 1, delayed: true };
  M.fetch = async function (url) {
    const u = String(url || '');
    if (u.indexOf('index.json') >= 0) return new Response(JSON.stringify(doc), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.indexOf('rig-alpha') >= 0) { if (M.delayed) await new Promise(r => setTimeout(r, 500)); return new Response(bA, { status: 200 }); }
    if (u.indexOf('rig-beta') >= 0) return new Response(bB, { status: 200 });
    if (u.indexOf('rig-badsha') >= 0) return new Response(bC, { status: 200 });
    return new Response('not found', { status: 404 });
  };
  M.failing = async function () { throw new TypeError('Failed to fetch'); };
  M.inject = function () { if (typeof avStoreSetFetch !== 'function') return false; avStoreSetFetch(M.fetch.bind(M)); return true; };
  M.fail = function () { if (typeof avStoreSetFetch !== 'function') return false; avStoreSetFetch(M.failing.bind(M)); return true; };
  M.sha = { alpha: sA, beta: sB, bad: sC };
  M.counts = { packs: 3, alphaPresets: 3, betaPresets: 2 };
  window.__storeMock = M;
  return { ok: true, sha: M.sha, counts: M.counts };
})(); true`;

/* independent IDB read of the store's own database (ground truth layer). Store name is sa-0's
   call ("object store name free but keep keyPath:'id'") — 'packs' preferred, else the first. */
const IDB_READ = (id) => `(async () => {
  const be = (typeof avStoreStatus === 'function') ? (avStoreStatus() || {}) : {};
  const backend = be.backend || be.mode || '';
  if (backend !== 'idb') return { skipped: true, backend: backend };
  return await new Promise((resolve) => {
    try {
      const req = indexedDB.open('av-packs-store');
      req.onerror = () => resolve({ ok: false, error: 'open error' });
      req.onsuccess = () => {
        try {
          const db = req.result;
          const names = [...db.objectStoreNames];
          const store = names.indexOf('packs') >= 0 ? 'packs' : names[0];
          if (!store) { try { db.close(); } catch (e) { } resolve({ ok: false, error: 'no object store', names: names }); return; }
          const tx = db.transaction([store], 'readonly');
          const all = tx.objectStore(store).getAll();
          all.onsuccess = () => {
            const recs = Array.isArray(all.result) ? all.result : [];
            const rec = recs.find(r => r && r.id === ${JSON.stringify(id)}) || null;
            try { db.close(); } catch (e) { }
            resolve({ ok: true, count: recs.length, rec: rec ? { id: rec.id, sha256: rec.sha256, hasPack: !!rec.pack } : null });
          };
          all.onerror = () => { try { db.close(); } catch (e) { } resolve({ ok: false, error: 'getAll error' }); };
        } catch (e) { try { req.result.close(); } catch (e2) { } resolve({ ok: false, error: String((e && e.message) || e) }); }
      };
    } catch (e) { resolve({ ok: false, error: String((e && e.message) || e) }); }
  });
})()`;

const shotPath = path.join(here, '..', 'renders', 'p5-store-suite.png');

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

  /* ── 2. the store card mounts into the parent-owned #av-store-host ── */
  let storeUp = false;
  for (let i = 0; i < 100 && !storeUp; i++) {
    const r = await ev(`!!(document.getElementById('av-store-host') && document.querySelector('#av-store-host .av-store') && document.getElementById('av-store-installed') && document.getElementById('av-store-avail') && document.getElementById('av-store-search') && document.getElementById('av-store-mode') && document.querySelectorAll('#av-store-filters .av-pf-filter').length === 3)`);
    if (r.value === true) { storeUp = true; break; }
    await sleep(150);
  }
  check('store card mounted: #av-store-host + card root + search + 3 filter chips + both list containers + mode chip', storeUp);
  if (!storeUp) { console.error('STORE HOST MISSING — parent adds the store card + #av-store-host and calls avStoreUiInit()'); process.exit(1); }

  const exportsR = await ev(`(() => ({
    init: typeof avStoreUiInit === 'function',
    sync: typeof avStoreUiSync === 'function',
    classes: typeof avStoreUiClasses === 'function',
    refresh: !!(window.__avStoreUi && typeof window.__avStoreUi.refresh === 'function'),
    handle: !!(window.__avStoreUi && typeof window.__avStoreUi.snap === 'function'),
    version: window.__avStoreUi ? window.__avStoreUi.version : null,
    classesN: (typeof avStoreUiClasses === 'function') ? avStoreUiClasses().length : 0,
    wired: !!(document.getElementById('av-store-host') && document.getElementById('av-store-host').dataset.avStoreUiWired === '1'),
  }))()`);
  const exportsV = exportsR.value || {};
  check('exports: avStoreUiInit + avStoreUiSync + avStoreUiClasses + window.__avStoreUi (p5.0, ≥40 classes) · host wired',
    exportsV.init === true && exportsV.sync === true && exportsV.classes === true && exportsV.refresh === true && exportsV.handle === true && exportsV.version === 'p5.0' && exportsV.classesN >= 40 && exportsV.wired === true,
    JSON.stringify(exportsV));

  const coreR = await ev(`(() => {
    const names = ['avStoreInit','avStoreIndex','avStoreInstall','avStoreRemove','avStoreStatus','avStoreInstalled','avStoreSetFetch'];
    const missing = names.filter(n => typeof window[n] !== 'function');
    return { missing: missing, status: (typeof avStoreStatus === 'function') ? ((avStoreStatus() || {}).backend || (avStoreStatus() || {}).mode || '') : null };
  })()`);
  const core = coreR.value || {};
  check('store core preflight: the 7 pinned APIs present (init/index/install/remove/status/installed/setFetch)',
    Array.isArray(core.missing) && core.missing.length === 0,
    core.missing && core.missing.length ? 'missing: ' + core.missing.join(', ') : 'all present · backend=' + core.status);

  /* the entry-accessor canary: the card renders AVAILABLE packs only if the core exposes the
     manifest entries to it. sa-0's st.index already holds {packs}; exposing it (status().index.packs
     or an avStoreCatalog()/avStorePacks()/avStoreIndexEntries() accessor) closes the seam. */
  const accR = await ev(`(() => {
    const fns = ['avStoreCatalog','avStorePacks','avStoreIndexEntries'].filter(n => typeof window[n] === 'function');
    let statusPacks = false;
    try {
      const s = (typeof avStoreStatus === 'function') ? (avStoreStatus() || {}) : {};
      statusPacks = !!(s.index && typeof s.index === 'object' && (Array.isArray(s.index.packs) || Object.prototype.hasOwnProperty.call(s.index, 'packs')));
    } catch (e) { }
    return { fns: fns, statusPacks: statusPacks };
  })()`);
  const acc = accR.value || {};
  const accOk = (Array.isArray(acc.fns) && acc.fns.length > 0) || acc.statusPacks === true;
  check('index entries accessor: the store core exposes the manifest entries to the card (avStoreCatalog/avStorePacks/avStoreIndexEntries or status().index.packs)',
    accOk,
    accOk ? ('exposed via ' + ((acc.fns && acc.fns.length) ? acc.fns.join(',') : 'status().index.packs')) : 'NOT EXPOSED — sa-0 core gap: st.index already holds {packs}; expose the entries so the card can render available packs');

  /* ── 2b. absent-host contract + remount ── */
  const probeR = await ev(`(() => {
    const host = document.getElementById('av-store-host');
    if (!host || !host.parentNode) return { skip: true };
    const parent = host.parentNode, next = host.nextSibling;
    host.remove();
    let absent = null, absentThrew = false;
    try { absent = avStoreUiInit(); } catch (e) { absentThrew = true; }
    parent.insertBefore(host, next);
    let remount = null, remountThrew = false;
    try { remount = avStoreUiInit(); } catch (e) { remountThrew = true; }
    const host2 = document.getElementById('av-store-host');
    return {
      absent: absent, absentThrew: absentThrew, remount: remount, remountThrew: remountThrew,
      card: !!host2.querySelector('.av-store'), wired: host2.dataset.avStoreUiWired === '1',
      modes: host2.querySelectorAll('.av-pf-filter[data-f]').length,
    };
  })()`);
  const probe = probeR.value || {};
  check('absent-host contract: avStoreUiInit() -> false without throwing; re-attached host re-mounts the card',
    probe.absent === false && probe.absentThrew === false && probe.remount === true && probe.remountThrew === false && probe.card === true && probe.wired === true && probe.modes === 3,
    JSON.stringify(probe));

  /* ── 3. mock build (real sha256 in page) + inject through avStoreSetFetch ── */
  await ev(MOCK_BUILD);
  const mb = (await ev(`window.__storeMockReady`)).value;
  const mockOk = !!(mb && mb.ok === true && typeof mb.sha === 'object');
  check('mock built in page: 3 synthetic packs with REAL sha256 (crypto.subtle over the served bytes)',
    mockOk && /^[0-9a-f]{64}$/.test(mb.sha.alpha) && /^[0-9a-f]{64}$/.test(mb.sha.beta) && /^[0-9a-f]{64}$/.test(mb.sha.bad) &&
    mb.sha.bad !== 'f'.repeat(64) && mb.sha.alpha !== mb.sha.beta,
    mockOk ? ('alpha sha ' + mb.sha.alpha.slice(0, 12) + '… · beta sha ' + mb.sha.beta.slice(0, 12) + '… · badsha digest ' + mb.sha.bad.slice(0, 12) + '… (real digests; the manifest plants f…f on purpose) · counts ' + JSON.stringify(mb.counts)) : 'mock build failed');

  const injR = await ev(`window.__storeMock ? window.__storeMock.inject() : 'no-mock'`);
  check('avStoreSetFetch MOCK injected (the ONLY network path — no server, file:// + seam)',
    injR.value === true, JSON.stringify(injR.value || injR.error));

  const refR = await ev(`window.__avStoreUi.refresh(true)`);
  const ref = refR.value || {};
  let cards = null;
  for (let i = 0; i < 25 && cards !== 3; i++) {
    const r = await ev(`document.querySelectorAll('#av-store-avail .av-pack-card[data-pack]').length`);
    cards = r.value;
    if (cards !== 3) { await ev(`avStoreUiSync()`); await sleep(200); }
  }
  check('index loads through the seam: refresh() ok + 3 packs -> 3 available cards',
    ref.ok === true && ref.packs === 3 && cards === 3,
    JSON.stringify(ref) + ' · dom cards=' + cards);

  const metaR = await ev(`(() => {
    const host = document.getElementById('av-store-host');
    const cards = [...host.querySelectorAll('#av-store-avail .av-pack-card[data-pack]')];
    const txt = (el, sel) => { const n = el.querySelector(sel); return n ? n.textContent : ''; };
    return {
      n: cards.length,
      ids: cards.map(c => c.dataset.pack).sort().join(','),
      tags: cards.map(c => txt(c, '.av-pack-tag')),
      meta: cards.map(c => txt(c, '.av-pack-meta')),
      names: cards.map(c => txt(c, '.av-pack-name')),
      installs: host.querySelectorAll('#av-store-avail [data-act="install"]').length,
      counts: {
        all: txt(host, '[data-count="all"]'), avail: txt(host, '[data-count="avail"]'), installed: txt(host, '[data-count="installed"]'),
      },
      filters: host.querySelectorAll('#av-store-filters .av-pf-filter').length,
      status: txt(host, '#av-store-status'),
    };
  })()`);
  const meta = metaR.value || {};
  check('cards: name + preset-count tag + size/sha meta + INSTALL button each; chips carry LIVE counts (3/3/0)',
    meta.n === 3 && meta.ids === 'rig-alpha,rig-badsha,rig-beta' && meta.tags.every(t => /preset/.test(t)) &&
    meta.installs === 3 && meta.meta.every(m => m.length > 0) && meta.names.every(nn => nn.length > 0) &&
    meta.counts.all === '3' && meta.counts.avail === '3' && meta.counts.installed === '0' && meta.filters === 3,
    JSON.stringify(meta));

  const beR = await ev(`(() => {
    const b = (typeof avStoreStatus === 'function') ? (avStoreStatus() || {}) : {};
    const m = document.getElementById('av-store-mode');
    return { backend: b.backend || b.mode || '', mode: m ? m.textContent : '' };
  })()`);
  const be = beR.value || {};
  const expMode = be.backend === 'idb' ? /IndexedDB/i : be.backend === 'ls' ? /localStorage/i : be.backend === 'mem' ? /memory/i : null;
  check('storage chip honest to the reported backend (' + (be.backend || '?') + ')',
    expMode ? expMode.test(be.mode) : true, JSON.stringify(be));

  /* ── 4. install — real click when a card is renderable (preferred), else the card's own
     install() verb (the entries seam blocks the click; the core path is identical) ── */
  const instSel = '#av-store-host [data-pack="rig-alpha"] [data-act="install"]';
  const instCardable = (await ev(`!!document.querySelector(${JSON.stringify(instSel)})`)).value === true;
  let instVia = 'api';
  if (instCardable) instVia = (await clickSel(instSel, 100)) === true ? 'click' : 'api';
  if (instVia === 'api') await ev(`window.__avStoreUi.install('rig-alpha')`);
  note('install initial action via ' + instVia + (instCardable ? '' : ' (no available card — index entries not exposed by the core)'));
  const availExpect = accOk ? '2' : null;

  let busySeen = false, busyInfo = '';
  if (instVia === 'click') {
    for (let i = 0; i < 16 && !busySeen; i++) {
      const r = await ev(`(() => {
        const c = document.querySelector('#av-store-host [data-pack="rig-alpha"].busy');
        if (!c) return { busy: false };
        const b = c.querySelector('[data-act="install"]');
        return { busy: true, disabled: !!(b && b.disabled), prog: !!c.querySelector('progress.av-store-prog'), aria: c.getAttribute('aria-busy') };
      })()`);
      const v = r.value || {};
      if (v.busy) busyInfo = JSON.stringify(v);
      if (v.busy && v.disabled && v.prog && v.aria === 'true') busySeen = true;
      if (!busySeen) await sleep(60);
    }
  } else {
    busyInfo = 'not exercisable — no card to click (index entries seam); the in-flight state rides the status line';
  }
  check('install progress affordance: card .busy + disabled button + indeterminate <progress>', instVia === 'click' && busySeen, busyInfo || 'not observed');

  let instOk = false, instInfo = '';
  for (let i = 0; i < 30 && !instOk; i++) {
    const r = await ev(`(() => {
      const host = document.getElementById('av-store-host');
      const card = host.querySelector('#av-store-installed .av-pack-card.installed[data-pack="rig-alpha"]');
      const chip = card ? card.querySelector('.av-store-chip.inst') : null;
      let client = null;
      try { const s = avStoreInstalled(); client = Array.isArray(s) ? s.some(rr => rr && rr.id === 'rig-alpha') : !!(s && s['rig-alpha']); } catch (e) { client = 'threw'; }
      const cnt = (host.querySelector('[data-count="installed"]') || {}).textContent;
      const nInst = (host.querySelector('#av-store-n-inst') || {}).textContent;
      const avail = (host.querySelector('[data-count="avail"]') || {}).textContent;
      const status = (host.querySelector('#av-store-status') || {}).textContent || '';
      return { present: !!card, chip: chip ? chip.textContent : null, cnt: cnt, nInst: nInst, avail: avail, client: client, status: status };
    })()`);
    const v = r.value || {};
    instOk = v.present === true && v.chip === 'INSTALLED' && v.cnt === '1' && v.nInst === '1' && (availExpect === null || v.avail === availExpect) && v.client === true && /installed/i.test(v.status);
    instInfo = JSON.stringify(v);
    if (!instOk) await sleep(150);
  }
  check('install (' + instVia + '): badge INSTALLED + counts (0→1 inst' + (availExpect ? ', 3→2 avail' : '') + ') + client layer avStoreInstalled() + status copy',
    instOk, instInfo);

  const idbR = await ev(IDB_READ('rig-alpha'));
  const idb = idbR.value || {};
  check('ground truth: independent indexedDB.open(av-packs-store) read finds the record with the manifest sha',
    idb.skipped ? true : (idb.ok === true && !!idb.rec && idb.rec.sha256 === mb.sha.alpha),
    idb.skipped ? ('backend ' + idb.backend + ' — IDB read not applicable (client layer proven above)') : JSON.stringify(idb));

  /* ── 5. filter + search cut the lists (avail-side expectations need the entries accessor) ── */
  const fInst = await clickSel('#av-store-host .av-pf-filter[data-f="installed"]', 220);
  const c1R = await ev(`(() => { const h = document.getElementById('av-store-host'); const b = h.querySelector('.av-pf-filter[data-f="installed"]'); return { avail: h.querySelectorAll('#av-store-avail .av-pack-card').length, inst: h.querySelectorAll('#av-store-installed .av-pack-card').length, on: !!(b && b.classList.contains('on')), pressed: b ? b.getAttribute('aria-pressed') : null }; })()`);
  const c1 = c1R.value || {};
  const fAvail = await clickSel('#av-store-host .av-pf-filter[data-f="avail"]', 220);
  const c2R = await ev(`(() => { const h = document.getElementById('av-store-host'); return { avail: h.querySelectorAll('#av-store-avail .av-pack-card').length, inst: h.querySelectorAll('#av-store-installed .av-pack-card').length }; })()`);
  const c2 = c2R.value || {};
  const fAll = await clickSel('#av-store-host .av-pf-filter[data-f="all"]', 220);
  const c3R = await ev(`(() => { const h = document.getElementById('av-store-host'); return { avail: h.querySelectorAll('#av-store-avail .av-pack-card').length, inst: h.querySelectorAll('#av-store-installed .av-pack-card').length }; })()`);
  const c3 = c3R.value || {};
  check('filter chips: .on/aria-pressed flip + installed side filters (INST 1 / AVAIL 0 / ALL 1)' + (accOk ? ' + avail side (0 / 2 / 2)' : ' — avail side gated on the entries accessor'),
    fInst === true && fAvail === true && fAll === true && c1.avail === 0 && c1.inst === 1 && c1.on === true && c1.pressed === 'true' && c2.inst === 0 && c3.inst === 1 && (!accOk || (c2.avail === 2 && c3.avail === 2)),
    JSON.stringify({ c1: c1, c2: c2, c3: c3 }));

  const s1 = await ev(`(() => { const i = document.getElementById('av-store-search'); i.value = 'beta'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(150);
  const s1R = await ev(`(() => { const h = document.getElementById('av-store-host'); return { avail: h.querySelectorAll('#av-store-avail .av-pack-card[data-pack]').length, id: (h.querySelector('#av-store-avail .av-pack-card[data-pack]') || {}).getAttribute ? h.querySelector('#av-store-avail .av-pack-card[data-pack]').getAttribute('data-pack') : null, inst: h.querySelectorAll('#av-store-installed .av-pack-card').length }; })()`);
  const s1v = s1R.value || {};
  const s2 = await ev(`(() => { const i = document.getElementById('av-store-search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(150);
  const s2R = await ev(`document.querySelectorAll('#av-store-avail .av-pack-card[data-pack]').length`);
  check('search cuts the list (beta only) and clearing restores the full list',
    accOk === true && s1.value === true && s2.value === true && s1v.avail === 1 && s1v.id === 'rig-beta' && s1v.inst === 0 && s2R.value === 2,
    (accOk ? '' : 'entries seam — the search cut is not exercisable; ') + JSON.stringify({ search: s1v, restored: s2R.value }));

  /* ── 6. remove (real click) — badge clears, ground truth follows ── */
  const rclick = await clickSel('#av-store-host #av-store-installed [data-act="remove"]', 120);
  const remAvailExpect = accOk ? '3' : null;
  let remOk = false, remInfo = '';
  for (let i = 0; i < 30 && !remOk; i++) {
    const r = await ev(`(() => {
      const host = document.getElementById('av-store-host');
      const gone = !host.querySelector('#av-store-installed .av-pack-card[data-pack="rig-alpha"]');
      let client = null;
      try { const s = avStoreInstalled(); client = Array.isArray(s) ? s.some(rr => rr && rr.id === 'rig-alpha') : !!(s && s['rig-alpha']); } catch (e) { client = 'threw'; }
      return { gone: gone, cnt: (host.querySelector('[data-count="installed"]') || {}).textContent, avail: (host.querySelector('[data-count="avail"]') || {}).textContent, status: (host.querySelector('#av-store-status') || {}).textContent || '', client: client };
    })()`);
    const v = r.value || {};
    remOk = v.gone === true && v.cnt === '0' && (remAvailExpect === null || v.avail === remAvailExpect) && v.client === false && /removed/i.test(v.status);
    remInfo = JSON.stringify(v);
    if (!remOk) await sleep(150);
  }
  check('remove (real click): badge clears, counts restore (0 inst / 3 avail), client layer empty, status copy',
    rclick === true && remOk, remInfo);

  const idbR2 = await ev(IDB_READ('rig-alpha'));
  const idb2 = idbR2.value || {};
  check('ground truth: the av-packs-store record is gone after remove',
    idb2.skipped ? true : (idb2.ok === true && idb2.rec === null),
    idb2.skipped ? ('backend ' + idb2.backend + ' — IDB read not applicable') : JSON.stringify(idb2));

  /* ── 7. reinstall is idempotent (one record, same sha) — keeps a pack installed for phase 8 ── */
  const reSel = '#av-store-host [data-pack="rig-alpha"] [data-act="install"]';
  const reCardable = (await ev(`!!document.querySelector(${JSON.stringify(reSel)})`)).value === true;
  let reVia = 'api';
  if (reCardable) reVia = (await clickSel(reSel, 120)) === true ? 'click' : 'api';
  if (reVia === 'api') await ev(`window.__avStoreUi.install('rig-alpha')`);
  let reOk = false, reInfo = '';
  for (let i = 0; i < 30 && !reOk; i++) {
    const r = await ev(`!!document.querySelector('#av-store-host #av-store-installed .av-pack-card.installed[data-pack="rig-alpha"]')`);
    reOk = r.value === true;
    if (!reOk) await sleep(150);
  }
  const idbR3 = await ev(IDB_READ('rig-alpha'));
  const idb3 = idbR3.value || {};
  check('reinstall is idempotent: one record, same sha, one badge (' + reVia + ')',
    reOk === true && (idb3.skipped ? true : (idb3.ok === true && !!idb3.rec && idb3.count === 1 && idb3.rec.sha256 === mb.sha.alpha)),
    JSON.stringify({ dom: reOk, via: reVia, idb: idb3 }));

  /* ── 8. host down: installed survive + OFFLINE badge + honest copy; host back: badge clears ── */
  await ev(`window.__storeMock.fail()`);
  const offRef = (await ev(`window.__avStoreUi.refresh(true)`)).value || {};
  let offOk = false, offInfo = '';
  for (let i = 0; i < 20 && !offOk; i++) {
    const r = await ev(`(() => {
      const host = document.getElementById('av-store-host');
      const card = host.querySelector('#av-store-installed .av-pack-card[data-pack="rig-alpha"]');
      const off = card ? card.querySelector('.av-store-offline') : null;
      let client = null;
      try { const s = avStoreInstalled(); client = !!(s && (Array.isArray(s) ? s.some(rr => rr && rr.id === 'rig-alpha') : s['rig-alpha'])); } catch (e) { client = 'threw'; }
      return { card: !!card, off: off ? off.textContent : null, status: (host.querySelector('#av-store-status') || {}).textContent || '', client: client };
    })()`);
    const v = r.value || {};
    offOk = v.card === true && v.off === 'OFFLINE' && v.client === true && /reach|unreachable|offline|host/i.test(v.status);
    offInfo = JSON.stringify(v);
    if (!offOk) { await ev(`avStoreUiSync()`); await sleep(150); }
  }
  check('host down: installed pack survives + OFFLINE badge + status says the host is unreachable',
    offOk, offInfo + ' · refresh=' + JSON.stringify({ ok: offRef.ok, error: offRef.error }) + ' · seam-refresh-failed=' + (offRef.ok === false));

  await ev(`window.__storeMock.inject()`);
  const backRef = (await ev(`window.__avStoreUi.refresh(true)`)).value || {};
  let backOk = false, backInfo = '';
  for (let i = 0; i < 20 && !backOk; i++) {
    const r = await ev(`(() => {
      const host = document.getElementById('av-store-host');
      return {
        off: host.querySelectorAll('.av-store-offline').length,
        cards: host.querySelectorAll('#av-store-avail .av-pack-card[data-pack]').length,
        status: (host.querySelector('#av-store-status') || {}).textContent || '',
      };
    })()`);
    const v = r.value || {};
    backOk = v.off === 0 && v.cards === 2;
    backInfo = JSON.stringify(v);
    if (!backOk) { await ev(`avStoreUiSync()`); await sleep(150); }
  }
  check('host back: OFFLINE badge clears and the index refreshes (refresh ok=' + (backRef.ok === true) + ')',
    backRef.ok === true && backOk, backInfo);

  /* ── 9. mem-mode honest chip (the stub forces backend 'mem') ── */
  const stubR = await ev(`(() => {
    const orig = window.avStoreStatus;
    window.__storeStatusOrig = (typeof orig === 'function') ? orig : null;
    try {
      const base = (typeof orig === 'function') ? (orig() || {}) : {};
      window.avStoreStatus = function () { return Object.assign({}, base, { backend: 'mem', mode: 'mem' }); };
      const took = (typeof avStoreStatus === 'function') && ((avStoreStatus() || {}).backend === 'mem');
      return { took: took };
    } catch (e) { return { took: false, err: String((e && e.message) || e) }; }
  })()`);
  await ev(`avStoreUiSync()`);
  const chipR = await ev(`(() => { const m = document.getElementById('av-store-mode'); return m ? { text: m.textContent, cls: m.className } : null; })()`);
  const took = !!(stubR.value && stubR.value.took === true);
  const chip = chipR.value || {};
  check('mem-mode honest chip: backend forced to mem -> chip says memory-only, never IndexedDB',
    took && /memory only/i.test(chip.text || '') && !/IndexedDB/i.test(chip.text || '') && /\bmem\b/.test(chip.cls || ''),
    JSON.stringify({ took: stubR.value, chip: chip }));

  await ev(`(() => {
    if (window.__storeStatusOrig) { window.avStoreStatus = window.__storeStatusOrig; }
    else { try { delete window.avStoreStatus; } catch (e) { } }
    return true;
  })()`);
  await ev(`avStoreUiSync()`);
  const backChipR = await ev(`(() => { const b = (typeof avStoreStatus === 'function') ? (avStoreStatus() || {}) : {}; const m = document.getElementById('av-store-mode'); return { backend: b.backend || b.mode || '', text: m ? m.textContent : '' }; })()`);
  const backChip = backChipR.value || {};
  const expMode2 = backChip.backend === 'idb' ? /IndexedDB/i : backChip.backend === 'ls' ? /localStorage/i : backChip.backend === 'mem' ? /memory/i : null;
  check('chip restores to the real backend after the stub is removed',
    expMode2 ? expMode2.test(backChip.text || '') : true, JSON.stringify(backChip));

  /* ── 10. sha-mismatch refusal path ── */
  const badSel = '#av-store-host [data-pack="rig-badsha"] [data-act="install"]';
  const badCardable = (await ev(`!!document.querySelector(${JSON.stringify(badSel)})`)).value === true;
  let badVia = 'api';
  if (badCardable) badVia = (await clickSel(badSel, 120)) === true ? 'click' : 'api';
  if (badVia === 'api') await ev(`window.__avStoreUi.install('rig-badsha')`);
  let badOk = false, badInfo = '';
  for (let i = 0; i < 40 && !badOk; i++) {
    const r = await ev(`(() => {
      const host = document.getElementById('av-store-host');
      let client = null;
      try { const s = avStoreInstalled(); client = Array.isArray(s) ? s.some(rr => rr && rr.id === 'rig-badsha') : !!(s && s['rig-badsha']); } catch (e) { client = 'threw'; }
      return {
        badge: !!host.querySelector('#av-store-installed [data-pack="rig-badsha"]'),
        cnt: (host.querySelector('[data-count="installed"]') || {}).textContent,
        status: (host.querySelector('#av-store-status') || {}).textContent || '',
        client: client,
      };
    })()`);
    const v = r.value || {};
    const refusal = /mismatch|checksum|digest|refus|not stored|did not land/i.test(v.status);
    badOk = v.badge === false && v.cnt === '1' && v.client === false && refusal;
    badInfo = JSON.stringify(v);
    if (!badOk) await sleep(150);
  }
  check('sha-mismatch refusal: INSTALL on rig-badsha refused (' + badVia + ') — no badge, count unchanged (1), no client record, honest copy',
    badOk, badInfo);

  /* ── 11. zero page errors ── */
  check('zero page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* ── 12. screenshot renders/p5-store-suite.png ── */
  await ev(`(() => { const el = document.getElementById('av-store-host'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); return true; })()`);
  await sleep(250);
  const rectR = await ev(`(() => { const el = document.getElementById('av-store-host'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }; })()`);
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
  check('screenshot: renders/p5-store-suite.png (the store card, scale 2)', shotOk, shotInfo);

  /* ── 13. freeze sha before/after ── */
  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after): ' + shaAfter);
  check('freeze: index.html sha256 before === after (unchanged by the run)', shaAfter === shaBefore, shaAfter);
  if (PIN) check('freeze: index.html sha256 = pinned', shaBefore === PIN && shaAfter === PIN, 'pinned ' + PIN.slice(0, 12) + '…');
  else note('EXPECT_SHA not pinned — after the P5 build, pass --sha <hex> or set the constant (never loosen)');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'STORE FAILED' : 'STORE PASSED');
  try { ws.close(); } catch { /* done */ }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('store harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    /* profile-scoped cleanup (LAW): kill ONLY processes whose command line carries OUR temp
       profile — matched by its unique basename, so the pattern needs no backslash escaping */
    const tag = path.basename(profile);
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
