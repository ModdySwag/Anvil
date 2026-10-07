// cdp_sessions.mjs — Anvil S2 SESSIONS suite (child sa-D's rig; WRITTEN by sa-D, RUN BY THE PARENT
// after integration). End-to-end over raw CDP against the frozen single-file build.
//
//   node verify/cdp_sessions.mjs [path-to-index.html] [--port N] [--sha <hex>]
//
// WRITE-ONLY: this file is authored by sa-D and never executed by sa-D. The parent runs it after
// the S2 integration build (index.html must contain av_session.js + av_backup.js + av_session_ui.js
// and body.html must carry the #av-sessions card + #av-sessions-host; app_core boots
// avSessionInit() -> avBackupInit() -> avSessionUiInit()).
//
// Launch skeleton copied VERBATIM from cdp_studio.mjs (candidates Chrome/Edge/Brave, free-port
// scan, fresh temp --user-data-dir, 1440×900 device metrics override — Edge headless ignores
// --window-size, --mute-audio, --autoplay-policy=no-user-gesture-required, ONE browser, explicit
// exit, process.on('exit') kills ONLY processes whose command line carries OUR temp profile),
// MINUS the two fake-media flags (S2 §0: no fake media needed). The rig pattern loader below
// reuses cdp_studio's __seqi helper approach (import -> avSeqSetPattern -> avApplyParam bpm).
// SHA freeze discipline from cdp_store.mjs / cdp_studio.mjs: index.html is sha256'd before and
// after the run and the two must match. EXPECT_SHA is null until the parent pins the frozen S2
// sha (constant below or --sha <hex>); while it is null the rig still enforces before === after.
//
// WHAT IT PROVES, in order (contract: verify/_s2_wave.md §2.4 proofs 1–7):
//   1. boot (data-av-ready) + the sessions card mounted into #av-sessions / #av-sessions-host:
//      `.av-sessions` root, host wired marker (avSessionUiWired='1'), SAVE/LOAD/RESTORE controls
//      present (tolerant label scan), the module globals live (avSession* · avBackup* ·
//      avSessionUi*) and the debug handles window.__avSession / __avBackup / __avSessionUi.
//   2. session round-trip: rig pattern loaded (16 on-steps @ 120 bpm) + bpm 137 + param commits
//      (master 0.77 · filter.cutoff 1234) + macro0 0.37 -> avSessionSave('RIG') -> MUTATE
//      (cleared pattern · bpm 94 · macro0 0.81) -> avSessionLoad(id) -> witnesses deep-equal via
//      canonical strings: avSeqPatternExport() equal · bpm equal · macro equal (+ param mirror).
//   3. versions: mutate + save again -> avSessionVersions(id).length >= 2 -> avSessionRestore(id, 1)
//      -> the state equals the v1 snapshot again.
//   4. autosave -> reload -> recovery: avSessionAutosave(true, 1500) (the CLAMPED ms from the
//      returned state is what the rig waits on) -> mutate -> wait for the autosave record (poll
//      lastAutosaveAt — never raw sleeps alone) -> Page.navigate RELOAD (re-wait data-av-ready,
//      re-inject helpers — the script context dies) -> recovery.available true (savedAt/name sane,
//      NEVER auto-applied) -> avSessionRecover() -> witnesses match the mutated state -> cleared.
//   5. sessions survive the reload: avSessionList() after navigate still holds the session(s) and
//      avSessionVersions(id) still >= 2.
//   6. backup e2e: avBackupBuild() -> in-page avBackupRead(buffer): entries present (manifest.json ·
//      sessions.json · README.txt + any packs/samples) and manifest sha256s verified with REAL
//      recomputed digests (crypto.subtle over the entry bytes — never a planted literal); delete a
//      session -> avBackupRestore(buffer) -> sessions back (id/name + version ring). Downloaded-file
//      leg: Browser.setDownloadBehavior (the cdp_bounce precedent) + click the card's BACKUP button
//      (tolerant guard) else rig-drive the download from the built buffer; the landed file path +
//      sha256 are recorded (rig-driven: sha === the built buffer sha).
//   7. zero page errors · screenshot renders/s2-sessions-suite.png (the sessions card, scale 2) ·
//      freeze sha256 before === after · THE PAGE IS LEFT CLEAN (autosave back off, rig sessions
//      deleted, recovery cleared, transport stopped).
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
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
   S2: the frozen sha of the rebuilt index.html is not known until build.py runs — the parent may
   fill this constant or pass --sha <hex>; the rig never loosens the before === after check. */
const EXPECT_SHA = '31087322730b32420af04c0c88208c783cd4d4f6bd2917c93d5e3252b32bcf5a';
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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9580);
const profile = path.join(tmpdir(), 'anvil-sessions-' + Date.now());
const DL_DIR = path.join(tmpdir(), 'anvil-sessions-dl-' + Date.now());
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
const fx3 = (x) => (x == null || !isFinite(x)) ? String(x) : Number(x).toFixed(3);
const near = (v, t, eps) => typeof v === 'number' && isFinite(v) && Math.abs(v - t) <= eps;
const eqStr = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length > 0 && a === b;

const chrome = spawn(exe, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--disable-sync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
  url,
], { stdio: 'ignore', windowsHide: true });

const errors = [];

/* ---------- page-side scaffolding injected at runtime (rig-owned; never app code) ----------
   __seqi: the rig PATTERN loader — the cdp_studio approach (import string -> avSeqPatternImport
     -> avSeqLoad fallback -> avSeqSetPattern(avSeqSnap()) sync -> avApplyParam('bpm', 120)),
     plus H.clear(name) for the all-off "cleared" mutation pattern and H.macro / H.commit
     wrappers over avModMacroSet / avApplyParam.
   __s2w: the rig WITNESSES — wit() reads the canonical channels (avSeqPatternExport string,
     avParams.bpm / master / filter.cutoff, avModPayload().macros), sha() is async hex sha256,
     backupCheck() runs in-page avBackupRead + recomputes EVERY entry digest with crypto.subtle. */

const SEQI_HELPERS = `window.__seqi = (function () {
  const H = { v: 1 };
  H.step = function (o) { return Object.assign({ on: 0, note: 'c2', vel: 0.9, gate: 0.5, slide: 0, accent: 0, oct: 0, prob: 100, cond: '', ratchet: 1, micro: 0 }, o || {}); };
  H.off = function () { const a = []; for (let i = 0; i < 64; i++) a.push(H.step({ on: 0 })); return a; };
  H.pattern = function (name, stepsOn) {
    const steps = [];
    for (let s = 0; s < 16; s++) steps.push(stepsOn === false ? H.step({ on: 0 }) : H.step({ on: 1, note: 'c2', vel: 0.9, gate: 0.5 }));
    const all = steps.concat(H.off().slice(16));
    const tracks = [];
    for (let t = 0; t < 4; t++) tracks.push({ len: 16, speed: 1, mute: 0, steps: (t === 0 ? all.slice() : H.off()) });
    return { v: 1, name: name || 'RIG PAT', bpm: 120, grid: '16', swing: 50, rng: 305419896, tracks: tracks, plocks: [] };
  };
  H.loadPattern = function (P) {
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
  H.load = function () { return H.loadPattern(H.pattern('RIG PAT', true)); };
  H.clear = function (name) { return H.loadPattern(H.pattern(name || 'RIG CLEAR', false)); };
  H.macro = function (i, v) {
    try { if (typeof avModMacroSet === 'function') return avModMacroSet(i, v) === true; } catch (e) { }
    try { if (typeof avApplyParam === 'function') { avApplyParam('mod.macro' + (i + 1), v); return true; } } catch (e) { }
    return false;
  };
  H.commit = function (path, v) {
    try { if (typeof avApplyParam === 'function') { avApplyParam(path, v); return true; } } catch (e) { }
    return false;
  };
  return H;
})(); true`;

const S2W_HELPERS = `window.__s2w = (function () {
  const W = { v: 1 };
  W.wit = function () {
    const out = { ok: false, export: null, bpm: null, patternBpm: null, macros: null, master: null, cutoff: null };
    try { out.export = (typeof avSeqPatternExport === 'function') ? String(avSeqPatternExport()) : null; } catch (e) { out.export = null; }
    try { if (typeof avParams !== 'undefined' && avParams && typeof avParams.bpm === 'number') out.bpm = avParams.bpm; } catch (e) { }
    try { if (typeof avSeqSnap === 'function') out.patternBpm = avSeqSnap().bpm; } catch (e) { }
    try { if (typeof avModPayload === 'function') { const mp = avModPayload(); out.macros = (mp && mp.macros) ? Array.prototype.slice.call(mp.macros) : null; } } catch (e) { out.macros = null; }
    try { if (typeof avParams !== 'undefined' && avParams) { if (typeof avParams.master === 'number') out.master = avParams.master; if (typeof avParams['filter.cutoff'] === 'number') out.cutoff = avParams['filter.cutoff']; } } catch (e) { }
    out.ok = true;
    return out;
  };
  W.sha = async function (u8) { const d = await crypto.subtle.digest('SHA-256', u8); const b = new Uint8Array(d); let s = ''; for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0'); return s; };
  W.toU8 = function (raw) {
    if (raw instanceof Uint8Array) return raw;
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
    if (Array.isArray(raw)) return Uint8Array.from(raw);
    return new Uint8Array(0);
  };
  W.backupCheck = async function (buf) {
    const out = { ok: false, why: null, errors: [], manifest: null, entries: [] };
    try {
      const rd = (typeof avBackupRead === 'function') ? avBackupRead(buf) : null;
      if (!rd) { out.why = 'avBackupRead unavailable'; return out; }
      out.ok = rd.ok === true;
      out.why = (rd.error || rd.why || null);
      out.errors = Array.isArray(rd.errors) ? rd.errors.slice(0, 8) : [];
      const man = (rd.manifest && typeof rd.manifest === 'object') ? rd.manifest : null;
      out.manifest = man ? { v: (man.v !== undefined) ? man.v : null, app: (man.app !== undefined) ? man.app : null, at: (man.at !== undefined) ? man.at : null, counts: man.counts || null, shaKeys: (man.sha256 && typeof man.sha256 === 'object') ? Object.keys(man.sha256) : [] } : null;
      const claims = (man && man.sha256 && typeof man.sha256 === 'object') ? man.sha256 : {};
      const list = Array.isArray(rd.entries) ? rd.entries : [];
      for (let i = 0; i < list.length; i++) {
        const e = list[i] || {};
        const u8 = W.toU8(e.bytes);
        const real = await W.sha(u8);
        const claim = (typeof claims[e.name] === 'string') ? String(claims[e.name]).toLowerCase() : null;
        out.entries.push({ name: e.name, size: (e.size !== undefined) ? e.size : null, len: u8.length, claim: claim, real: real, match: (claim === null) ? null : (claim === real) });
      }
      return out;
    } catch (e) { out.why = String((e && e.message) || e); return out; }
  };
  return W;
})(); true`;

const shotPath = path.join(here, '..', 'renders', 's2-sessions-suite.png');

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
     fallback on the page session — either one lands files in DL_DIR (cdp_bounce precedent) */
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
  const val = (r) => (r && r.value !== undefined) ? r.value : null;
  /* boot wait that survives the Page.navigate reload (a context swap can reject an evaluate) */
  const waitReady = async (tries) => {
    for (let i = 0; i < tries; i++) {
      let ok = false;
      try { const r = await ev(`document.documentElement.getAttribute('data-av-ready') === '1'`); ok = r.value === true; } catch { /* context swap */ }
      if (ok) return true;
      await sleep(300);
    }
    return false;
  };
  const wit = async () => (val(await ev(`(window.__s2w && typeof window.__s2w.wit === 'function') ? window.__s2w.wit() : null`)) || {});
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

  /* ── 1. boot + the sessions card mounted into #av-sessions / #av-sessions-host ── */
  const ready1 = await waitReady(120);
  check('1 boot: data-av-ready flips', ready1);
  if (!ready1) { console.error('APP NOT READY'); process.exit(1); }

  let cardUp = false, cardInfo = '';
  for (let i = 0; i < 100 && !cardUp; i++) {
    const r = await ev(`(() => {
      const host = document.getElementById('av-sessions-host');
      const card = document.getElementById('av-sessions');
      const root = host ? host.querySelector('.av-sessions, [class*="av-sessions"]') : null;
      const wired = !!(host && host.dataset && host.dataset.avSessionUiWired === '1') || !!(card && card.dataset && card.dataset.avSessionUiWired === '1');
      return { host: !!host, card: !!card, root: !!root, wired: wired };
    })()`);
    const v = val(r) || {};
    cardUp = v.host === true && v.card === true && v.root === true && v.wired === true;
    cardInfo = JSON.stringify(v);
    if (!cardUp) await sleep(150);
  }
  check('1b card mounted: #av-sessions + #av-sessions-host + .av-sessions root + wired marker (avSessionUiWired=1)', cardUp, cardInfo);

  /* tolerant control discovery: SAVE · LOAD · RESTORE controls (labels/classes/ids/data-attrs) */
  const ctrlR = await ev(`(() => {
    const host = document.getElementById('av-sessions-host') || document.getElementById('av-sessions');
    if (!host) return { host: false };
    const els = [...host.querySelectorAll('button, [role="button"], input, select, .av-btn, [data-act]')];
    const label = (e) => (((e.textContent || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '') + ' ' + (e.className || '') + ' ' + (e.id || '') + ' ' + JSON.stringify(e.dataset || {})).toLowerCase());
    const hit = (re) => els.filter((e) => re.test(label(e))).length;
    return {
      host: true, controls: els.length,
      save: hit(/save/), load: hit(/load/), restore: hit(/restore/), backup: hit(/backup/),
      recover: hit(/recover/), dismiss: hit(/dismiss/),
      selects: [...host.querySelectorAll('select')].length, inputs: [...host.querySelectorAll('input')].length,
    };
  })()`);
  const ctrl = val(ctrlR) || {};
  check('1c controls: SAVE · LOAD · RESTORE present in the sessions card (tolerant label scan)',
    ctrl.host === true && ctrl.save >= 1 && ctrl.load >= 1 && ctrl.restore >= 1, JSON.stringify(ctrl));

  /* module globals + debug handles live */
  const modR = await ev(`(() => {
    const fns = ['avSessionInit','avSessionCapture','avSessionApply','avSessionSave','avSessionList','avSessionLoad','avSessionDelete','avSessionVersions','avSessionRestore','avSessionAutosave','avSessionState','avSessionRecover','avSessionDismissRecovery','avSessionExport','avSessionImport','avSessionTouch','avSessionClasses','avBackupInit','avBackupBuild','avBackupRead','avBackupRestore','avBackupState','avBackupClasses','avSessionUiInit','avSessionUiClasses','avSessionUiSync'];
    const missing = fns.filter((n) => typeof window[n] !== 'function');
    return {
      missing: missing,
      handle: !!(window.__avSession && typeof window.__avSession === 'object'),
      handleV: window.__avSession ? window.__avSession.version : null,
      ui: !!(window.__avSessionUi && typeof window.__avSessionUi === 'object'),
      uiV: window.__avSessionUi ? window.__avSessionUi.version : null,
      backup: !!(window.__avBackup && typeof window.__avBackup === 'object'),
      backupV: window.__avBackup ? window.__avBackup.version : null,
      classesN: (typeof avSessionUiClasses === 'function') ? avSessionUiClasses().length : 0,
    };
  })()`);
  const mod = val(modR) || {};
  check('1d module globals live: avSession* · avBackup* · avSessionUi* · window.__avSession / __avBackup / __avSessionUi objects',
    Array.isArray(mod.missing) && mod.missing.length === 0 && mod.handle === true && mod.ui === true && mod.backup === true,
    JSON.stringify({ missing: mod.missing, handle: mod.handle, handleV: mod.handleV, ui: mod.ui, uiV: mod.uiV, backup: mod.backup, backupV: mod.backupV, classesN: mod.classesN }));
  if (Array.isArray(mod.missing) && (mod.missing.indexOf('avSessionSave') >= 0 || mod.missing.indexOf('avSessionState') >= 0)) {
    console.error('S2 SESSION CORE MISSING — parent adds av_session.js / av_backup.js / av_session_ui.js and rebuilds');
    process.exit(1);
  }

  /* initial state — pristine page: no recovery offer on a fresh profile, autosave off */
  const st0R = await ev(`(() => { try { const s = avSessionState() || {}; return { backend: s.backend || null, count: (s.count !== undefined) ? s.count : null, current: s.current ? (s.current.name || s.current.id || null) : null, autosave: s.autosave || null, recovery: s.recovery || null, dirty: (s.dirty !== undefined) ? s.dirty : null }; } catch (e) { return { error: String((e && e.message) || e) }; } })()`);
  const st0 = val(st0R) || {};
  const initAutoOn = !!(st0.autosave && st0.autosave.on);
  check('1e page pristine: no recovery offer on a fresh profile · autosave off · honest backend',
    (st0.error === undefined || st0.error === null) && st0.recovery && st0.recovery.available !== true && initAutoOn === false && ['idb', 'ls', 'mem'].indexOf(String(st0.backend)) >= 0,
    JSON.stringify(st0));

  /* inject the rig helpers (pattern loader + witnesses) */
  await ev(SEQI_HELPERS);
  await ev(S2W_HELPERS);
  check('1f rig side helpers injected (__seqi · __s2w)',
    val(await ev(`!!(window.__seqi && window.__seqi.v === 1 && window.__s2w && window.__s2w.v === 1)`)) === true);

  /* ── 2. session round-trip ── */
  console.log('── 2. session round-trip ──');
  const loadR = await ev(`window.__seqi.load()`);
  const load2 = val(loadR) || {};
  check('2 rig pattern loaded (16 on-steps @ 120 bpm — the __seqi approach from cdp_studio)', load2.ok === true, JSON.stringify(load2));

  const cmR = await ev(`(() => {
    const H = window.__seqi;
    return { bpm: H.commit('bpm', 137), master: H.commit('master', 0.77), cutoff: H.commit('filter.cutoff', 1234), macro: H.macro(0, 0.37) };
  })()`);
  const cm = val(cmR) || {};
  check('2 committed: bpm 137 · master 0.77 · filter.cutoff 1234 · macro0 0.37',
    cm.bpm === true && cm.master === true && cm.cutoff === true && cm.macro === true, JSON.stringify(cm));

  const w0 = await wit();
  check('2 v1 witnesses captured (export string · bpm 137 · macro0 0.37 · master 0.77 · cutoff 1234)',
    typeof w0.export === 'string' && w0.export.length > 50 && w0.bpm === 137 && near(w0.macros && w0.macros[0], 0.37, 0.002) && w0.master === 0.77 && w0.cutoff === 1234,
    JSON.stringify({ exportLen: w0.export ? w0.export.length : null, bpm: w0.bpm, macro0: w0.macros ? w0.macros[0] : null, master: w0.master, cutoff: w0.cutoff }));

  const saveR = await ev(`(async () => { try { const r = await avSessionSave('RIG'); return r; } catch (e) { return { error: String((e && e.message) || e) }; } })()`);
  const save2 = val(saveR) || {};
  let rigId = (typeof save2 === 'string') ? save2 : (save2.id || save2.sessionId || (save2.session && save2.session.id) || (save2.record && save2.record.id) || null);
  const l2R = await ev(`(typeof avSessionList === 'function') ? avSessionList() : null`);
  const l2 = val(l2R) || [];
  if (!rigId) { const hit = l2.find(s => s && s.name === 'RIG'); if (hit) rigId = hit.id; }
  check('2 avSessionSave("RIG"): receipt · session created + listed',
    (save2.error === undefined || save2.error === null) && (rigId != null) && l2.some(s => s && (s.id === rigId || s.name === 'RIG')),
    JSON.stringify({ receiptKeys: save2 ? Object.keys(save2) : null, id: rigId, list: l2.map(s => s && { id: s.id, name: s.name, version: s.version }) }).slice(0, 400));

  const mutR = await ev(`(() => {
    const H = window.__seqi;
    const c = H.clear('RIG CUT');
    const b = H.commit('bpm', 94);
    const m = H.macro(0, 0.81);
    const g = H.commit('master', 0.2);
    const k = H.commit('filter.cutoff', 300);
    return { clear: c, bpm: b, macro: m, master: g, cutoff: k };
  })()`);
  const wM = await wit();
  check('2 mutate: state differs from v1 (cleared pattern · bpm 94 · macro0 0.81)',
    (val(mutR) || {}).clear && (val(mutR) || {}).clear.ok === true && wM.bpm === 94 && near(wM.macros && wM.macros[0], 0.81, 0.002) &&
    typeof wM.export === 'string' && wM.export !== w0.export,
    JSON.stringify({ bpm: wM.bpm, macro0: wM.macros ? wM.macros[0] : null, exportChanged: wM.export !== w0.export }));

  const ldR = await ev(`(async () => { try { const r = await avSessionLoad(${JSON.stringify(rigId)}); return r; } catch (e) { return { error: String((e && e.message) || e) }; } })()`);
  const ld2 = val(ldR) || {};
  const w1 = await wit();
  check('2 avSessionLoad(id): receipt (load of the newest version)',
    (ld2.error === undefined || ld2.error === null) && ld2.ok !== false,
    JSON.stringify(ld2).slice(0, 240));
  check('2 round-trip: avSeqPatternExport() equal after load (canonical string deep-equal)',
    eqStr(w0.export, w1.export),
    'len ' + (w1.export ? w1.export.length : null) + ' vs ' + (w0.export ? w0.export.length : null) + ' · equal=' + eqStr(w0.export, w1.export));
  check('2 round-trip: bpm equal (avParams.bpm 94 -> restored 137)',
    w1.bpm === 137, 'w1.bpm=' + JSON.stringify(w1.bpm) + ' (pattern bpm ' + JSON.stringify(w1.patternBpm) + ')');
  check('2 round-trip: macro0 equal (avModPayload probe restored to 0.37)',
    near(w1.macros && w1.macros[0], 0.37, 0.002), 'macro0=' + JSON.stringify(w1.macros ? w1.macros[0] : null));
  check('2 round-trip: param mirror restored (master 0.77 · filter.cutoff 1234)',
    w1.master === 0.77 && w1.cutoff === 1234, JSON.stringify({ master: w1.master, cutoff: w1.cutoff }));
  const curR = await ev(`(() => { try { const s = avSessionState() || {}; return { id: s.current ? s.current.id : null, name: s.current ? s.current.name : null }; } catch (e) { return { error: String((e && e.message) || e) }; } })()`);
  const cur = val(curR) || {};
  check('2 avSessionLoad marks current (state.current.id = the rig session)', cur.id === rigId, JSON.stringify(cur));

  /* ── 3. versions ── */
  console.log('── 3. versions ──');
  const mut3R = await ev(`(() => {
    const H = window.__seqi;
    const c = H.clear('RIG V2 CUT');
    const b = H.commit('bpm', 90);
    const m = H.macro(0, 0.11);
    const g = H.commit('master', 0.33);
    return { clear: c, bpm: b, macro: m, master: g };
  })()`);
  const save3R = await ev(`(async () => { try { const r = await avSessionSave('RIG'); return r; } catch (e) { return { error: String((e && e.message) || e) }; } })()`);
  const save3 = val(save3R) || {};
  const vsR = await ev(`(typeof avSessionVersions === 'function') ? avSessionVersions(${JSON.stringify(rigId)}) : null`);
  const vs = val(vsR) || [];
  check('3 second save -> new VERSION of the current session (avSessionVersions(id).length >= 2)',
    (val(mut3R) || {}).clear && (val(mut3R) || {}).clear.ok === true && (save3.error === undefined || save3.error === null) && Array.isArray(vs) && vs.length >= 2,
    JSON.stringify({ receiptKeys: save3 ? Object.keys(save3) : null, versions: vs.map(v => v && { version: v.version, savedAt: v.savedAt, bytes: v.bytes }) }).slice(0, 400));

  const rsR = await ev(`(async () => { try { const r = await avSessionRestore(${JSON.stringify(rigId)}, 1); return r; } catch (e) { return { error: String((e && e.message) || e) }; } })()`);
  const rs3 = val(rsR) || {};
  const w3 = await wit();
  check('3 avSessionRestore(id, 1) -> state equals the v1 snapshot again (export equal · bpm 137 · macro0 0.37)',
    (rs3.error === undefined || rs3.error === null) && rs3.ok !== false && eqStr(w0.export, w3.export) && w3.bpm === 137 && near(w3.macros && w3.macros[0], 0.37, 0.002),
    JSON.stringify({ receipt: rs3, exportEqual: eqStr(w0.export, w3.export), bpm: w3.bpm, macro0: w3.macros ? w3.macros[0] : null }).slice(0, 400));

  /* ── 4. autosave -> reload -> recovery ── */
  console.log('── 4. autosave -> reload -> recovery ──');
  const auR = await ev(`(() => { try { return avSessionAutosave(true, 1500); } catch (e) { return { error: String((e && e.message) || e) }; } })()`);
  const au = val(auR) || {};
  const clamped = (isFinite(Number(au.ms)) && Number(au.ms) >= 5000) ? Number(au.ms) : 5000;
  check('4 autosave on: {on:true} · the 1500 ms request clamps to the 5000 floor (returned ms feeds the wait)',
    au.on === true && (au.ms === undefined || au.ms === null || Number(au.ms) === 5000), JSON.stringify(au));

  const mut4R = await ev(`(() => {
    const H = window.__seqi;
    const c = H.clear('RIG AUTO CUT');
    const b = H.commit('bpm', 142);
    const m = H.macro(0, 0.66);
    return { clear: c, bpm: b, macro: m };
  })()`);
  const wA = await wit();
  check('4 mutated while autosave is on (cleared pattern · bpm 142 · macro0 0.66)',
    (val(mut4R) || {}).clear && (val(mut4R) || {}).clear.ok === true && wA.bpm === 142 && near(wA.macros && wA.macros[0], 0.66, 0.002),
    JSON.stringify({ bpm: wA.bpm, macro0: wA.macros ? wA.macros[0] : null }));

  const at0R = await ev(`(() => { try { const s = avSessionState() || {}; return { at: (s.lastAutosaveAt !== undefined) ? s.lastAutosaveAt : null }; } catch (e) { return { at: null }; } })()`);
  const atBefore = (val(at0R) || {}).at;
  let autoAt = null, waited4 = 0;
  const max4 = clamped + 9000;
  for (let i = 0; i < Math.ceil(max4 / 500) && autoAt == null; i++) {
    await sleep(500); waited4 += 500;
    const r = await ev(`(() => { try { const s = avSessionState() || {}; return { at: (s.lastAutosaveAt !== undefined) ? s.lastAutosaveAt : null, rec: !!(s.recovery && s.recovery.available) }; } catch (e) { return { at: null }; } })()`);
    const at = (val(r) || {}).at;
    if (at != null && at !== atBefore) autoAt = at;
  }
  check('4 autosave tick wrote the record (lastAutosaveAt moved — polled, not raw-slept)',
    autoAt != null, 'before=' + JSON.stringify(atBefore) + ' after=' + JSON.stringify(autoAt) + ' waited=' + waited4 + 'ms (clamped ms=' + clamped + ')');

  /* Page.navigate same URL: the script context dies — re-wait data-av-ready + re-inject helpers */
  note('Page.navigate reload — re-waiting data-av-ready, re-injecting helpers (script context dies)');
  await send('Page.navigate', { url });
  await sleep(350);
  const ready2 = await waitReady(160);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }).catch(() => { });
  await send('Page.bringToFront').catch(() => { });
  await ev(SEQI_HELPERS);
  await ev(S2W_HELPERS);
  const reIn = val(await ev(`!!(window.__seqi && window.__seqi.v === 1 && window.__s2w && window.__s2w.v === 1 && typeof window.__s2w.wit === 'function')`)) === true;
  check('4 after Page.navigate reload: data-av-ready flips again + helpers re-injected (script context died)', ready2 === true && reIn === true, JSON.stringify({ ready: ready2, reinjected: reIn }));
  if (!ready2) { console.error('APP NOT READY AFTER RELOAD'); process.exit(1); }

  let recAvail = false, recMeta = null;
  for (let i = 0; i < 60 && !recAvail; i++) {
    const r = await ev(`(() => { try { if (typeof avSessionState !== 'function') return { na: true }; const s = avSessionState() || {}; const rv = s.recovery || {}; return { avail: rv.available === true, savedAt: (rv.savedAt !== undefined) ? rv.savedAt : null, name: (rv.name !== undefined) ? rv.name : null, at: (rv.at !== undefined) ? rv.at : null }; } catch (e) { return { na: true, error: String((e && e.message) || e) }; } })()`);
    const v = val(r) || {};
    if (v.avail === true) { recAvail = true; recMeta = v; break; }
    await sleep(250);
  }
  const now4 = Date.now();
  const sa4 = recMeta ? Number(recMeta.savedAt) : NaN;
  const saneSaved = isFinite(sa4) && sa4 > 0 && (now4 - sa4) >= -60000 && (now4 - sa4) < 3600000;
  const saneName = recMeta ? (recMeta.name == null || (typeof recMeta.name === 'string' && recMeta.name.length > 0)) : false;
  const wPre = await wit();
  const notAutoApplied = !(eqStr(wPre.export, wA.export) && wPre.bpm === 142 && near(wPre.macros && wPre.macros[0], 0.66, 0.002));
  check('4 recovery offer after reload: available true · savedAt sane · name sane · NEVER auto-applied',
    recAvail && saneSaved && saneName && notAutoApplied,
    JSON.stringify({ meta: recMeta, saneSaved: saneSaved, saneName: saneName, notAutoApplied: notAutoApplied, preBpm: wPre.bpm }).slice(0, 400));

  const rcvR = await ev(`(async () => { let r = null, err = null; try { r = await avSessionRecover(); } catch (e) { err = String((e && e.message) || e); } return { r: r, err: err }; })()`);
  const rcv = val(rcvR) || {};
  let w4 = await wit();
  for (let i = 0; i < 20; i++) {
    if (eqStr(w4.export, wA.export) && w4.bpm === 142 && near(w4.macros && w4.macros[0], 0.66, 0.002)) break;
    await sleep(300);
    w4 = await wit();
  }
  check('4 avSessionRecover(): witnesses match the mutated state (export equal · bpm 142 · macro0 0.66)',
    rcv.err == null && rcv.r && rcv.r.ok !== false && eqStr(wA.export, w4.export) && w4.bpm === 142 && near(w4.macros && w4.macros[0], 0.66, 0.002),
    JSON.stringify({ receipt: rcv.r, err: rcv.err, exportEqual: eqStr(wA.export, w4.export), bpm: w4.bpm, macro0: w4.macros ? w4.macros[0] : null }).slice(0, 400));

  let cleared4 = false;
  for (let i = 0; i < 16 && !cleared4; i++) {
    const r = await ev(`(() => { try { const s = avSessionState() || {}; const rv = s.recovery || {}; return { avail: rv.available === true }; } catch (e) { return { avail: null }; } })()`);
    cleared4 = (val(r) || {}).avail === false;
    if (!cleared4) await sleep(250);
  }
  check('4 recovery cleared after avSessionRecover() (state.recovery.available false)', cleared4);

  /* ── 5. sessions survive the reload ── */
  console.log('── 5. sessions survive the reload ──');
  const l5 = val(await ev(`(typeof avSessionList === 'function') ? avSessionList() : null`)) || [];
  check('5 sessions survive reload: avSessionList() after navigate still holds the saved session (id / name RIG)',
    l5.some(s => s && (s.id === rigId || s.name === 'RIG')),
    JSON.stringify(l5.map(s => s && { id: s.id, name: s.name, version: s.version })).slice(0, 300));
  const v5 = val(await ev(`(typeof avSessionVersions === 'function') ? avSessionVersions(${JSON.stringify(rigId)}) : null`));
  check('5 versions survive reload: avSessionVersions(id).length >= 2 after the navigate',
    Array.isArray(v5) && v5.length >= 2, JSON.stringify(v5).slice(0, 240));

  /* ── 6. backup e2e ── */
  console.log('── 6. backup e2e ──');
  const bresR = await ev(`(async () => {
    try {
      const r = await avBackupBuild();
      if (r && r.ok === true) {
        window.__s2 = window.__s2 || {};
        window.__s2.backupBuf = r.buffer;
        window.__s2.backupName = r.name;
      }
      let sha = null;
      try { if (r && r.buffer) sha = await window.__s2w.sha(new Uint8Array(r.buffer)); } catch (e) { }
      return { ok: !!(r && r.ok === true), name: (r && r.name) || null, bytes: (r && r.bytes) || null, bufLen: (r && r.buffer && r.buffer.byteLength) || null, hasManifest: !!(r && r.manifest && typeof r.manifest === 'object'), sha: sha, keys: r ? Object.keys(r) : [], why: (r && (r.error || r.why)) || null };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  })()`);
  const bres = val(bresR) || {};
  check('6 avBackupBuild(): ok · name · buffer · manifest',
    bres.ok === true && typeof bres.name === 'string' && bres.name.length > 0 && Number(bres.bufLen) > 1000 && bres.hasManifest === true,
    JSON.stringify(bres).slice(0, 300));

  const rd = val(await ev(`window.__s2w.backupCheck(window.__s2 && window.__s2.backupBuf)`)) || {};
  const names6 = (rd.entries || []).map(e => e.name);
  const need6 = ['manifest.json', 'sessions.json', 'README.txt'];
  const missing6 = need6.filter(n => names6.indexOf(n) < 0);
  check('6 avBackupRead(buffer): ok · entries present (manifest.json · sessions.json · README.txt + any packs/samples) · reader errors none',
    rd.ok === true && (rd.entries || []).length >= 3 && missing6.length === 0 && (rd.errors || []).length === 0,
    JSON.stringify({ ok: rd.ok, why: rd.why, n: (rd.entries || []).length, names: names6, errors: rd.errors }).slice(0, 420));

  const claimed6 = (rd.entries || []).filter(e => e.claim !== null);
  const bad6 = claimed6.filter(e => e.match !== true);
  const shaKeys6 = (rd.manifest && rd.manifest.shaKeys) || [];
  const phantom6 = shaKeys6.filter(k => names6.indexOf(k) < 0);
  const sessClaim6 = (rd.entries || []).some(e => e.name === 'sessions.json' && e.claim !== null);
  check('6 manifest sha256s verified with REAL recomputed digests (crypto.subtle per entry) · sessions.json claimed · no phantom keys',
    claimed6.length >= 1 && bad6.length === 0 && phantom6.length === 0 && sessClaim6 === true,
    JSON.stringify({ claimed: claimed6.map(e => e.name), bad: bad6.map(e => ({ name: e.name, claim: (e.claim || '').slice(0, 12), real: (e.real || '').slice(0, 12) })), phantom: phantom6, sessClaim: sessClaim6, shaKeys: shaKeys6, counts: rd.manifest && rd.manifest.counts }).slice(0, 500));

  const delR = await ev(`(() => { try { return avSessionDelete(${JSON.stringify(rigId)}) === true; } catch (e) { return false; } })()`);
  let gone6 = false;
  for (let i = 0; i < 12 && !gone6; i++) {
    const l = val(await ev(`(typeof avSessionList === 'function') ? avSessionList() : null`)) || [];
    gone6 = !l.some(s => s && (s.id === rigId || s.name === 'RIG'));
    if (!gone6) await sleep(250);
  }
  check('6 restore leg: avSessionDelete(id) true -> the session is gone from the list', delR.value === true && gone6, JSON.stringify({ deleted: delR.value, gone: gone6 }));

  const restR = await ev(`(async () => {
    const buf = window.__s2 && window.__s2.backupBuf;
    if (!buf) return { ok: false, why: 'no stashed buffer' };
    let r = null, err = null;
    try { r = await avBackupRestore(buf); } catch (e) { err = String((e && e.message) || e); }
    return { ok: !!(r && r.ok === true), err: err, restored: (r && r.restored) || null, skipped: (r && r.skipped) || null, errors: (r && r.errors) || [], keys: r ? Object.keys(r) : [] };
  })()`);
  const rest6 = val(restR) || {};
  let back6 = false, l6 = [];
  for (let i = 0; i < 40 && !back6; i++) {
    l6 = val(await ev(`(typeof avSessionList === 'function') ? avSessionList() : null`)) || [];
    back6 = l6.some(s => s && s.id === rigId && s.name === 'RIG');
    if (!back6) await sleep(250);
  }
  check('6 avBackupRestore(buffer): ok · sessions back (avSessionList holds id + name RIG)',
    rest6.ok === true && back6 === true,
    JSON.stringify({ restore: { ok: rest6.ok, err: rest6.err, restored: rest6.restored, skipped: rest6.skipped, errors: rest6.errors }, list: l6.map(s => s && s.name) }).slice(0, 460));
  const v6 = val(await ev(`(typeof avSessionVersions === 'function') ? avSessionVersions(${JSON.stringify(rigId)}) : null`));
  check('6 restored session carries its version ring (avSessionVersions(id).length >= 2 — sessions.json holds versions)',
    Array.isArray(v6) && v6.length >= 2, JSON.stringify(v6).slice(0, 240));

  /* downloaded-file leg: click the card's BACKUP button if present (tolerant), else rig-drive the
     download from the built buffer; the landed file path + sha256 are recorded for the parent */
  const btnR = await ev(`(() => {
    const host = document.getElementById('av-sessions-host') || document.getElementById('av-sessions');
    if (!host) return { n: 0 };
    const els = [...host.querySelectorAll('button, [role="button"], .av-btn, a')];
    const cands = els.filter((el) => {
      const s = (((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.className || '') + ' ' + JSON.stringify(el.dataset || {})).toLowerCase());
      return /backup/.test(s) && !/restore/.test(s) && !el.disabled;
    });
    if (cands.length === 1) { cands[0].id = 'rig-s2-backup-btn'; return { n: 1, label: (cands[0].textContent || '').trim().slice(0, 40) }; }
    return { n: cands.length };
  })()`);
  let dlVia = 'none', clicked6 = false;
  if ((btnR.value || {}).n === 1) { clicked6 = await clickSel('#rig-s2-backup-btn', 500); if (clicked6) dlVia = 'click'; }
  note('backup download: button scan -> ' + JSON.stringify(btnR.value) + ' · clicked=' + clicked6);

  const scanDl = () => { try { return readdirSync(DL_DIR).filter(f => !/\.crdownload$|\.tmp$/i.test(f)); } catch (e) { return []; } };
  let dlFile = null, seen6 = [];
  if (clicked6) {
    for (let i = 0; i < 24 && !dlFile; i++) { seen6 = scanDl(); if (seen6.length) dlFile = seen6[0]; else await sleep(600); }
  }
  if (!dlFile) {
    const drv = await ev(`(() => {
      try {
        const buf = window.__s2 && window.__s2.backupBuf;
        if (!buf) return false;
        const blob = new Blob([buf], { type: 'application/zip' });
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = u;
        a.download = (window.__s2 && window.__s2.backupName) || 'anvil-backup.zip';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { try { URL.revokeObjectURL(u); a.remove(); } catch (e) { } }, 5000);
        return true;
      } catch (e) { return false; }
    })()`);
    note('backup download: rig-driving from the built buffer -> ' + JSON.stringify(drv.value));
    if (drv.value === true) {
      dlVia = 'rig-buffer';
      for (let i = 0; i < 20 && !dlFile; i++) { await sleep(600); seen6 = scanDl(); if (seen6.length) dlFile = seen6[0]; }
    }
  }
  check('6 download leg: the backup zip lands on disk (CDP download dir · ' + dlVia + ')',
    dlFile !== null, JSON.stringify({ dir: DL_DIR, seen: seen6 }));
  if (dlFile) {
    const dlPath = path.join(DL_DIR, dlFile);
    const dlSha = shaOf(dlPath);
    const dlSize = statSync(dlPath).size;
    const head = readFileSync(dlPath).subarray(0, 4);
    const zipMagic = head[0] === 0x50 && head[1] === 0x4b;
    if (dlVia === 'rig-buffer' && bres.sha) {
      check('6 download leg: landed file sha256 === the built buffer sha256 (the rig-driven artifact is the artifact)',
        dlSha === bres.sha && zipMagic === true,
        JSON.stringify({ file: dlFile, size: dlSize, sha: dlSha.slice(0, 16), bufSha: String(bres.sha).slice(0, 16) }));
    } else {
      check('6 download leg: landed file is a zip (PK magic) with content — sha recorded for the parent witness',
        zipMagic === true && dlSize > 1000,
        JSON.stringify({ file: dlFile, size: dlSize, sha: dlSha.slice(0, 16), via: dlVia }));
    }
    console.log('   · download artifact: ' + dlPath + '  sha256=' + dlSha);
  }

  /* ── 7. cleanup — the page left clean; then zero errors · screenshot · freeze ── */
  console.log('── 7. seal ──');
  const cleanR = await ev(`(async () => {
    const out = { killed: [], before: null };
    try { out.before = (typeof avSessionState === 'function') ? avSessionState() : null; } catch (e) { }
    try { if (typeof avSessionAutosave === 'function') avSessionAutosave(false); } catch (e) { }
    try { if (typeof avSeqStop === 'function') avSeqStop(); } catch (e) { }
    try {
      if (typeof avSessionList === 'function' && typeof avSessionDelete === 'function') {
        const list = avSessionList() || [];
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          const isRig = !!(s && (s.id === ${JSON.stringify(rigId)} || (typeof s.name === 'string' && /^RIG/.test(s.name))));
          if (isRig) { try { if (avSessionDelete(s.id) === true) out.killed.push(String(s.name) + ':' + String(s.id)); } catch (e) { } }
        }
      }
    } catch (e) { }
    try { if (typeof avSessionDismissRecovery === 'function') avSessionDismissRecovery(); } catch (e) { }
    await new Promise(function (res) { setTimeout(res, 400); });
    try {
      const st = (typeof avSessionState === 'function') ? (avSessionState() || {}) : {};
      const l = (typeof avSessionList === 'function') ? (avSessionList() || []) : [];
      out.after = {
        names: l.map(function (s) { return s && s.name; }),
        autosaveOn: st.autosave ? st.autosave.on : null,
        recovery: st.recovery ? st.recovery.available : null,
        current: st.current ? (st.current.name || st.current.id || null) : null,
        playing: (typeof avSeqIsPlaying === 'function') ? avSeqIsPlaying() : null,
        count: (st.count !== undefined) ? st.count : null,
      };
    } catch (e) { }
    return out;
  })()`);
  const cl = val(cleanR) || {};
  const clA = cl.after || {};
  const rigLeft = (clA.names || []).some(n => /^RIG/.test(String(n)));
  check('7 page left clean: rig sessions deleted · autosave back off (' + initAutoOn + ') · recovery cleared · transport stopped',
    Array.isArray(cl.killed) && cl.killed.length >= 1 && rigLeft === false && clA.autosaveOn === initAutoOn && clA.recovery === false && clA.playing !== true && (clA.current == null || !/^RIG/.test(String(clA.current))),
    JSON.stringify(cl).slice(0, 420));

  /* zero page errors for the whole run (incl. the reload) */
  check('7 zero page errors (exceptions · Log errors · console.error)', errors.length === 0, 'page errors=' + errors.length + (errors.length ? ' | ' + errors.slice(0, 3).join(' | ') : ''));

  /* screenshot renders/s2-sessions-suite.png (the sessions card, scale 2) */
  await ev(`(() => { const el = document.getElementById('av-sessions') || document.getElementById('av-sessions-host'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); return true; })()`);
  await sleep(250);
  const rectR = await ev(`(() => { const el = document.getElementById('av-sessions') || document.getElementById('av-sessions-host'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }; })()`);
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
  check('7 screenshot: renders/s2-sessions-suite.png (the sessions card, scale 2)', shotOk, shotInfo);

  /* freeze sha before/after */
  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after): ' + shaAfter);
  check('7 freeze: index.html sha256 before === after (unchanged by the run)', shaAfter === shaBefore, shaAfter);
  if (PIN) check('7 freeze: index.html sha256 = pinned', shaBefore === PIN && shaAfter === PIN, 'pinned ' + PIN.slice(0, 12) + '…');
  else note('EXPECT_SHA not pinned — after the S2 build, pass --sha <hex> or set the constant (never loosen)');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'SESSIONS FAILED' : 'SESSIONS PASSED');
  try { ws.close(); } catch { /* done */ }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('sessions harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    /* profile-scoped cleanup (LAW): kill ONLY processes whose command line carries OUR temp
       profile — matched by its unique basename, so the pattern needs no backslash escaping */
    const tag = path.basename(profile);
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
