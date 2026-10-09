// cdp_a11y.mjs - Anvil P7 accessibility suite (rig sa-C; WRITTEN by sa-C, RUN BY THE PARENT after
// the P7 integration build). End-to-end over raw CDP against the frozen single-file build.
//
//   node verify/cdp_a11y.mjs > verify/last-cdp_a11y.log 2>&1
//   (optional: [path-to-index.html] [--port N] [--sha <hex>])
//
// WRITE-ONLY: authored by sa-C and never executed by sa-C. The parent runs it after the P7 build
// (index.html must carry src/av_a11y.js, the av_knob keyboard/aria edit and the parent styles
// block - verify/_p7_wave.md section 2). EXPECT_SHA stays null until the parent pins it.
//
// LAUNCH: file:// rig - the launch block from cdp_m2.mjs (NO http server, NO service worker):
// candidates Chrome/Edge/Brave, free-port scan, fresh temp --user-data-dir + download dir,
// 1440x900 device metrics (Edge headless ignores --window-size), --mute-audio, --autoplay-policy,
// ONE browser, explicit exit, process.on('exit') kills ONLY processes whose command line carries
// OUR temp profile. Boots index.html?avtest=1 (the cdp_smoke law) with device metrics + focus
// emulation set BEFORE the navigate, so the fresh load is measured at 1440x900. The
// Page.javascriptDialogOpening auto-dismiss belt rides along.
//
// WHAT IT PROVES, in order (contract: verify/_p7_wave.md section 2.3; 31 checks + the conditional
// freeze pin leg):
//   A module   - window.__avA11y {version, init, state, setPref, toggle} + avA11yAnnounce live;
//                state(): inited/skip/live true, counts.sliders === DOM .av-knob[data-knob]
//                total; fresh-load defaults; the module UI (#av-a11y-host inside header.av-head,
//                two real buttons, title + aria-pressed mirrored).
//   B skip     - #av-a11y-skip (anchor -> #av-main); REAL Input.dispatchKeyEvent Tab from the
//                fresh load -> the skip link is the first focusable; Enter -> focus lands on
//                #av-main (Chromium focuses in-page anchor targets).
//   C knobs    - EVERY .av-knob[data-knob]: tabindex=0 + role=slider + numeric aria-valuemin/
//                max/valuenow; keyboard witness on the master knob with REAL CDP keys, readback
//                avState.master + aria-valuenow (the knob_feel observables): ArrowUp ~ +step,
//                Shift+ArrowUp ~ 10x step, End -> max, then the start value restored through the
//                same commit path.
//   D names    - every VISIBLE button has a nonempty accessible name (text | aria-label | title);
//                state().counts.unnamed === 0 for buttons.
//   E live     - >= 3 pinned-selector elements with role=status or aria-live;
//                avA11yAnnounce("a11y-rig-probe") writes #av-a11y-live; region attrs
//                (aria-live=polite, aria-atomic=true, class av-a11y-sr).
//   F contrast - click #av-a11y-contrast -> body gains av-contrast + aria-pressed "true" + the
//                computed --text token flips (read at documentElement AND body); reload restores
//                the class from prefs; reset goes clean.
//   G motion   - Emulation.setEmulatedMedia reduce -> 0 elements under main with a nonzero
//                transitionDuration (was >= 1 in normal mode); the manual #av-a11y-motion path
//                (class + aria-pressed + still 0 animated + persisted); reset back to system.
//   H seal     - prefs RESTORED TO DEFAULTS at the end (file:// localStorage may be shared with
//                every other suite - this rig owns its state and cleans up), zero page errors
//                across every section, sha256 before === after, freeze pin leg (passes only when
//                EXPECT_SHA is pinned).
//   Marker: A11Y-RESULT n/m (+ A11Y-RESULT-JSON).
//
// HARNESS LAWS (house): reads are machine observables (window globals, DOM attributes, computed
// styles, localStorage) - never console text; keyboard/pointer legs use REAL CDP input
// (Input.dispatchKeyEvent / Input.dispatchMouseEvent) - never synthetic DOM events; the rig
// never plants values where the app computes (the master witness reads the knob's own store).
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
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
   P7: the integrated index.html sha does not exist at authoring time - EXPECT_SHA stays null
   until the parent pins it (constant below or --sha <hex>); while null the rig still enforces
   before === after and prints a pin note (never loosened). */
const EXPECT_SHA = "354b74ddfaaf42788378a5089ceb7b3590c0c65036187ad743082c2d1ffc55fe";   /* sa-C pin slot - parent fills after the P7 build (or --sha <hex>) */
const PIN = (shaArg > -1 && argv[shaArg + 1] && /^[0-9a-f]{64}$/i.test(argv[shaArg + 1])) ? argv[shaArg + 1].toLowerCase() : EXPECT_SHA;
const shaOf = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const shaBefore = shaOf(page);
console.log('index.html sha256 (before): ' + shaBefore + (PIN ? '' : '   (EXPECT_SHA not pinned yet - pass --sha <hex> or set the constant)'));

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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9780);
const profile = path.join(tmpdir(), 'anvil-a11y-' + Date.now());
const DL_DIR = path.join(tmpdir(), 'anvil-a11y-dl-' + Date.now());
try { mkdirSync(DL_DIR, { recursive: true }); } catch (e) { /* best-effort */ }
const url = 'file:///' + path.resolve(page).replace(/\\/g, '/') + '?avtest=1';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
console.log('cdp port ' + PORT + ' - profile ' + profile);
console.log('url ' + url + '   (file:// - no server, no service worker)');

let pass = 0, fail = 0;
const check = (name, ok, info) => {
  if (ok === true) { pass++; console.log(' ok   ' + name + (info ? '  -> ' + info : '')); }
  else { fail++; console.log(' FAIL ' + name + (info ? '  -> ' + info : '')); }
  return ok === true;
};
const note = (t) => console.log('   - ' + t);
const J = (x) => { try { return JSON.stringify(x); } catch (e) { return String(x); } };
const fmt4 = (x) => (typeof x === 'number' && isFinite(x)) ? x.toFixed(4) : String(x);

/* one browser instance, NO URL: metrics + focus emulation land BEFORE the fresh navigate (m2 law) */
const chrome = spawn(exe, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--disable-sync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--disable-popup-blocking', '--allow-file-access-from-files',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
], { stdio: 'ignore', windowsHide: true });

const errors = [];

/* ---------- page-side probes (strings only - the rig keeps NO persistent page state, so a
   reload never strands a helper) ---------- */

const KNOB_SEL = '#av-levels .av-knob[data-knob="master"]';

/* the knob readback the knob_feel rig uses: avState.master + aria-valuenow + the readout line */
const READ_KNOB = `(function () {
  try {
    var el = document.querySelector(${JSON.stringify(KNOB_SEL)});
    var out = { found: !!el, val: null, aria: null, min: null, max: null, step: null, readout: null, focused: false };
    if (el) {
      try { out.val = (typeof avState !== 'undefined' && avState) ? avState.master : null; } catch (e) { out.val = null; }
      out.aria = el.getAttribute('aria-valuenow');
      out.min = el.getAttribute('aria-valuemin');
      out.max = el.getAttribute('aria-valuemax');
      out.step = parseFloat(el.dataset.step);
      out.focused = (document.activeElement === el);
    }
    var ro = document.querySelector('[data-kval="master"]');
    out.readout = ro ? String(ro.textContent) : null;
    return out;
  } catch (e) { return { err: String((e && e.message) || e) }; }
})()`;

const ACTIVE_PROBE = `(function () {
  try {
    var a = document.activeElement;
    return a ? { id: a.id || null, tag: String(a.tagName || ''), cls: String(a.className || ''), txt: String(a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60) } : null;
  } catch (e) { return { err: String((e && e.message) || e) }; }
})()`;

/* contrast/prefs probe: body classes, button mirror, state() fields, stored prefs */
const CONTRAST_PROBE = `(function () {
  try {
    var s = (window.__avA11y && typeof __avA11y.state === 'function') ? __avA11y.state() : null;
    var btn = document.getElementById('av-a11y-contrast');
    var ls = null; try { ls = localStorage.getItem('av-a11y'); } catch (e) { ls = 'ERR'; }
    var lsObj = null; try { lsObj = ls ? JSON.parse(ls) : null; } catch (e) { lsObj = 'BAD'; }
    return { cls: String(document.body.className || ''), pressed: btn ? btn.getAttribute('aria-pressed') : null,
      contrast: s ? s.contrast : null, motion: s ? s.motion : null, ls: lsObj };
  } catch (e) { return { err: String((e && e.message) || e) }; }
})()`;

/* motion probe: classes, button mirror, state() fields, stored prefs, matchMedia */
const MOTION_PROBE = `(function () {
  try {
    var s = (window.__avA11y && typeof __avA11y.state === 'function') ? __avA11y.state() : null;
    var btn = document.getElementById('av-a11y-motion');
    var ls = null; try { ls = localStorage.getItem('av-a11y'); } catch (e) { ls = 'ERR'; }
    var lsObj = null; try { lsObj = ls ? JSON.parse(ls) : null; } catch (e) { lsObj = 'BAD'; }
    var mq = null;
    try { mq = (typeof matchMedia === 'function') ? matchMedia('(prefers-reduced-motion: reduce)').matches : null; } catch (e) { mq = null; }
    return { cls: String(document.body.className || ''), pressed: btn ? btn.getAttribute('aria-pressed') : null,
      motion: s ? s.motion : null, systemReduced: s ? s.systemReduced : null, reduceActive: s ? s.reduceActive : null,
      mq: mq, ls: lsObj };
  } catch (e) { return { err: String((e && e.message) || e) }; }
})()`;

/* the G sample: every element under main whose computed transitionDuration carries any component
   above 0.0001 s counts as animated (the WCAG snippet writes .01ms = 0.00001 s, so it reads 0) */
const COUNT_NZ = `(function () {
  try {
    var main = document.querySelector('main.av-main');
    if (!main) return { ok: false, why: 'no main.av-main' };
    var els = Array.prototype.slice.call(main.querySelectorAll('*'));
    var nz = [];
    for (var i = 0; i < els.length; i++) {
      var cs = null; try { cs = getComputedStyle(els[i]); } catch (e) { cs = null; }
      if (!cs) continue;
      var parts = String(cs.transitionDuration || '').split(',');
      var hot = false;
      for (var j = 0; j < parts.length; j++) {
        var p = parseFloat(parts[j]);
        if (isFinite(p) && p > 0.0001) hot = true;
      }
      if (hot) nz.push(String(els[i].id || els[i].className || els[i].tagName).slice(0, 48));
    }
    return { ok: true, total: els.length, nz: nz.length, sample: nz.slice(0, 8) };
  } catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
})()`;

const READ_TEXT = `(function () {
  try {
    var g = function (el) { return getComputedStyle(el).getPropertyValue('--text').trim(); };
    return { html: g(document.documentElement), body: g(document.body) };
  } catch (e) { return { err: String((e && e.message) || e) }; }
})()`;

const FINAL_PROBE = `(function () {
  try {
    var s = (window.__avA11y && typeof __avA11y.state === 'function') ? __avA11y.state() : null;
    var cb = document.getElementById('av-a11y-contrast');
    var mb = document.getElementById('av-a11y-motion');
    var ls = null; try { ls = localStorage.getItem('av-a11y'); } catch (e) { ls = 'ERR'; }
    var lsObj = null; try { lsObj = ls ? JSON.parse(ls) : null; } catch (e) { lsObj = 'BAD'; }
    return { cls: String(document.body.className || ''),
      cbPressed: cb ? cb.getAttribute('aria-pressed') : null,
      mbPressed: mb ? mb.getAttribute('aria-pressed') : null,
      contrast: s ? s.contrast : null, motion: s ? s.motion : null,
      errN: (s && s.errors) ? s.errors.length : -1, ls: lsObj, lsRaw: ls };
  } catch (e) { return { err: String((e && e.message) || e) }; }
})()`;

const splitCls = (s) => String(s == null ? '' : s).split(/\s+/);
const lsDefaults = (ls) => (ls === null) || (ls && ls !== 'BAD' && ls !== 'ERR' && ls.contrast === false && ls.motion === 'system');
const lsContrastFalse = (ls) => (ls === null) || (ls && ls !== 'BAD' && ls !== 'ERR' && ls.contrast === false);
const lsMotionReduce = (ls) => !!(ls && ls !== 'BAD' && ls !== 'ERR' && ls.motion === 'reduce');
const lsMotionSystem = (ls) => (ls === null) || (ls && ls !== 'BAD' && ls !== 'ERR' && ls.motion === 'system');

async function main() {
  /* target wait: launching WITHOUT a URL - find a page target we can drive (m2 precedent; a fresh
     Edge profile may open edge:// targets first) */
  let target = null;
  for (let i = 0; i < 150 && !target; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) {
        const pages = (await r.json()).filter(t => t.type === 'page');
        target = pages.find(t => t.url === 'about:blank') || pages.find(t => !String(t.url).startsWith('edge://')) || pages[0] || null;
      }
    } catch { /* browser still booting */ }
    if (!target) await sleep(200);
  }
  if (!target) { console.error('no page target to drive'); process.exit(2); }
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
    else if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: false }).catch(() => { /* belt only */ });
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');

  /* metrics + focus emulation BEFORE the navigate: the fresh load is measured at 1440x900 and the
     page believes it is focused (so Tab traversal works headless) */
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => { });
  /* the harness boots with prefers-reduced-motion=reduce as the environment default; pin the
     baseline to no-preference so default-state checks are meaningful (system mode then proves
     BOTH directions by flipping the emulation) */
  await send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }).catch(() => { });
  await send('Page.navigate', { url });
  await send('Page.bringToFront').catch(() => { });
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR }).catch(() => note('Page.setDownloadBehavior unavailable'));

  const ev = async (expr) => {
    let r;
    try { r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true }); }
    catch (e) { return { error: String((e && e.message) || e) }; }
    if (r.exceptionDetails) {
      const e = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'unknown';
      note('eval threw: ' + String(e).split('\n')[0].slice(0, 220));
      return { error: e };
    }
    return { value: r.result?.value };
  };
  const val = (r) => (r && r.value !== undefined) ? r.value : null;
  const until = async (expr, ms = 4000, step = 120) => {
    const t0 = Date.now();
    for (;;) {
      const r = await ev(expr);
      if (r.value === true) return true;
      if (Date.now() - t0 > ms) return false;
      await sleep(step);
    }
  };
  const clickSel = async (sel, after = 300) => {
    const found = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; if (e.scrollIntoView) e.scrollIntoView({ block: 'center', inline: 'center' }); return true; })()`);
    if (found.value !== true) { note('click target missing: ' + sel); return false; }
    await sleep(200);
    const boxR = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width || !r.height) return null;
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const b = boxR.value;
    if (!b) { note('click target not visible: ' + sel); return false; }
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', clickCount: 1 });
    await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
    await sleep(after);
    return true;
  };

  /* real-input key helpers (cdp_keys law: Input.dispatchKeyEvent, never synthetic DOM events) */
  const keyEvent = (type, k, code, vk, text, mods = 0) => send('Input.dispatchKeyEvent', {
    type, key: k, code, modifiers: mods, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    ...(text != null ? { text, unmodifiedText: text } : {}),
  });
  const pressKey = async (k, code, vk, text = null) => {
    await keyEvent(text != null ? 'keyDown' : 'rawKeyDown', k, code, vk, text);
    await keyEvent('keyUp', k, code, vk, null);
  };

  /* ================= 0. boot ================= */
  console.log('== 0. boot ==');
  await sleep(700);
  const ready = await until(`document.documentElement.getAttribute('data-av-ready') === '1'`, 30000, 300);
  check('0 boot: data-av-ready flips on the file:// ?avtest=1 page (no server, no SW)', ready === true, 'url ' + url);
  if (ready !== true) { console.error('APP NOT READY'); process.exit(1); }
  const inited = await until(`(function () { try { return !!(window.__avA11y && typeof __avA11y.state === 'function' && __avA11y.state().inited === true); } catch (e) { return false; } })()`, 15000, 250);
  if (inited !== true) note('__avA11y not inited after ready - the A legs will report honestly');
  note('settle 1400 ms for the decoration pass 2 (module init + 1200 ms)');
  await sleep(1400);

  /* ================= A. module + state() ================= */
  console.log('== A. a11y module + state() ==');
  const a1 = val(await ev(`(function () {
    try {
      var h = window.__avA11y;
      return { has: !!h, version: h ? String(h.version || '') : null,
        init: h ? typeof h.init : null, state: h ? typeof h.state : null,
        setPref: h ? typeof h.setPref : null, toggle: h ? typeof h.toggle : null,
        announce: typeof avA11yAnnounce, proof: typeof avA11yProof, classes: typeof avA11yClasses };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)) || {};
  check('A1 module: window.__avA11y {version, init, state, setPref, toggle} + avA11yAnnounce fn',
    a1.has === true && !!a1.version && a1.init === 'function' && a1.state === 'function' && a1.setPref === 'function' && a1.toggle === 'function' && a1.announce === 'function',
    J(a1));

  const a2 = val(await ev(`(function () {
    try {
      var s = (window.__avA11y && typeof __avA11y.state === 'function') ? __avA11y.state() : null;
      var domN = document.querySelectorAll('.av-knob[data-knob]').length;
      return { inited: s ? s.inited : null, skip: s ? s.skip : null, live: s ? s.live : null,
        sliders: (s && s.counts) ? s.counts.sliders : null, counts: (s && s.counts) || null,
        errN: (s && s.errors) ? s.errors.length : -1, domKnobs: domN };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)) || {};
  check('A2 state(): inited/skip/live true + counts.sliders === DOM .av-knob[data-knob] total (sliders ' + J(a2.sliders) + ' vs DOM ' + J(a2.domKnobs) + ')',
    a2.inited === true && a2.skip === true && a2.live === true && a2.sliders !== null && a2.sliders === a2.domKnobs && a2.domKnobs > 0,
    J({ inited: a2.inited, skip: a2.skip, live: a2.live, sliders: a2.sliders, domKnobs: a2.domKnobs, counts: a2.counts, errN: a2.errN }));

  const a3 = val(await ev(`(function () {
    try {
      var s = (window.__avA11y && typeof __avA11y.state === 'function') ? __avA11y.state() : null;
      var ls = null; try { ls = localStorage.getItem('av-a11y'); } catch (e) { ls = 'ERR'; }
      var lsObj = null; try { lsObj = ls ? JSON.parse(ls) : null; } catch (e) { lsObj = 'BAD'; }
      return { cls: String(document.body.className || ''), contrast: s ? s.contrast : null, motion: s ? s.motion : null,
        systemReduced: s ? s.systemReduced : null, reduceActive: s ? s.reduceActive : null, ls: lsObj };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)) || {};
  const a3cls = splitCls(a3.cls);
  check('A3 fresh-load defaults: contrast false + motion system + no av-contrast / av-reduce-motion on body + stored prefs default-or-absent',
    a3.contrast === false && a3.motion === 'system' && a3cls.indexOf('av-contrast') < 0 && a3cls.indexOf('av-reduce-motion') < 0 && lsDefaults(a3.ls),
    J({ cls: a3.cls, contrast: a3.contrast, motion: a3.motion, systemReduced: a3.systemReduced, reduceActive: a3.reduceActive, ls: a3.ls }));

  const a4 = val(await ev(`(function () {
    try {
      var host = document.getElementById('av-a11y-host');
      var cb = document.getElementById('av-a11y-contrast');
      var mb = document.getElementById('av-a11y-motion');
      var shape = function (el) { return el ? { tag: String(el.tagName), pressed: el.getAttribute('aria-pressed'), title: String(el.getAttribute('title') || '').length > 0, label: String(el.getAttribute('aria-label') || '') } : null; };
      return { host: !!host, inHead: !!(host && host.closest && host.closest('header.av-head')),
        hostCls: host ? String(host.className || '') : null, contrast: shape(cb), motion: shape(mb) };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)) || {};
  const pressedOk = (s) => !!s && (s.pressed === 'true' || s.pressed === 'false');
  check('A4 module UI: #av-a11y-host inside header.av-head + real buttons #av-a11y-contrast / #av-a11y-motion (title + aria-pressed)',
    a4.host === true && a4.inHead === true &&
    !!a4.contrast && a4.contrast.tag === 'BUTTON' && a4.contrast.title === true && pressedOk(a4.contrast) &&
    !!a4.motion && a4.motion.tag === 'BUTTON' && a4.motion.title === true && pressedOk(a4.motion),
    J(a4));

  /* ================= B. skip link (real Tab + Enter, fresh load) ================= */
  console.log('== B. skip link (real Tab + Enter) ==');
  const b1 = val(await ev(`(function () {
    try {
      var skip = document.getElementById('av-a11y-skip');
      var main = document.querySelector('main.av-main');
      var first = document.body.firstElementChild ? (document.body.firstElementChild.id || document.body.firstElementChild.tagName) : null;
      var rect = skip ? skip.getBoundingClientRect() : null;
      return { skip: !!skip, tag: skip ? String(skip.tagName) : null, cls: skip ? String(skip.className || '') : null,
        href: skip ? String(skip.getAttribute('href') || '') : null,
        first: String(first || ''), mainId: main ? String(main.id || '') : null,
        rect: rect ? { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
        text: skip ? String(skip.textContent || '').trim().slice(0, 60) : null };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)) || {};
  check('B1 skip link: #av-a11y-skip anchor -> #av-main + main.av-main carries id="av-main"',
    b1.skip === true && b1.tag === 'A' && splitCls(b1.cls).indexOf('av-a11y-skip') >= 0 && /#av-main$/.test(String(b1.href)) && b1.mainId === 'av-main',
    J(b1));

  const actBefore = val(await ev(ACTIVE_PROBE)) || {};
  await pressKey('Tab', 'Tab', 9, String.fromCharCode(9));
  await sleep(240);
  const act1 = val(await ev(ACTIVE_PROBE)) || {};
  check('B2 skip link is the first focusable: fresh-load Tab -> activeElement #av-a11y-skip',
    act1.id === 'av-a11y-skip',
    J({ before: actBefore, after: act1 }));

  await pressKey('Enter', 'Enter', 13, String.fromCharCode(13));
  let act2 = null;
  for (let i = 0; i < 25; i++) {
    act2 = val(await ev(`(function () {
      try { var a = document.activeElement; return { id: a ? (a.id || null) : null, tag: a ? String(a.tagName) : null, hash: String(location.hash || ''), scrollY: Math.round(window.scrollY || 0) }; }
      catch (e) { return { err: String((e && e.message) || e) }; }
    })()`));
    if (act2 && act2.id === 'av-main') break;
    await sleep(120);
  }
  check('B3 skip link Enter: focus lands on #av-main', !!act2 && act2.id === 'av-main', J(act2));

  /* ================= C. knobs: declarations + the master keyboard witness ================= */
  console.log('== C. knobs (tabindex/role/aria + keyboard witness on master) ==');
  /* the ?avtest=1 knob selftest commits + restores the master value; wait for it to land so the
     witness never races it (triage note only - C stands on its own) */
  const stWait = await until('(function () { try { return !!window.__avKnobTest; } catch (e) { return false; } })()', 10000, 250);
  note('knob selftest present: ' + stWait);

  const cDec = val(await ev(`(function () {
    try {
      var els = Array.prototype.slice.call(document.querySelectorAll('.av-knob[data-knob]'));
      var badT = [], badN = [];
      var num = function (s) { return s != null && String(s) !== '' && isFinite(Number(s)); };
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var tag = String(el.dataset.knob || '?');
        if (el.getAttribute('tabindex') !== '0' || el.getAttribute('role') !== 'slider') badT.push(tag + ':ti=' + el.getAttribute('tabindex') + ',role=' + el.getAttribute('role'));
        var vmin = el.getAttribute('aria-valuemin'), vmax = el.getAttribute('aria-valuemax'), vnow = el.getAttribute('aria-valuenow');
        if (!num(vmin) || !num(vmax) || !num(vnow)) { badN.push(tag + ':(min=' + vmin + ',max=' + vmax + ',now=' + vnow + ')'); continue; }
        if (Number(vmin) > Number(vmax) || Number(vnow) < Number(vmin) - 1e-9 || Number(vnow) > Number(vmax) + 1e-9) badN.push(tag + ':(range ' + vmin + '..' + vmax + ' now ' + vnow + ')');
      }
      return { n: els.length, badT: badT.slice(0, 6), badN: badN.slice(0, 6) };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)) || {};
  check('C1 knobs: every .av-knob[data-knob] carries tabindex=0 + role=slider (n=' + J(cDec.n) + ')',
    cDec.n > 0 && Array.isArray(cDec.badT) && cDec.badT.length === 0,
    J({ n: cDec.n, bad: cDec.badT, err: cDec.err }));
  check('C2 knobs: numeric aria-valuemin/max/valuenow on every knob (min <= now <= max)',
    cDec.n > 0 && Array.isArray(cDec.badN) && cDec.badN.length === 0,
    J({ n: cDec.n, bad: cDec.badN }));

  const cOrig = val(await ev(READ_KNOB)) || {};
  const cSet = val(await ev(`(function () {
    try {
      var el = document.querySelector(${JSON.stringify(KNOB_SEL)});
      if (!el || typeof avKnobCommit !== 'function') return { ok: false, why: 'no knob or avKnobCommit' };
      var r = avKnobCommit(el, 0.5);
      el.focus();
      return { ok: true, committed: r, focused: document.activeElement === el, val: (typeof avState !== 'undefined') ? avState.master : null, aria: el.getAttribute('aria-valuenow') };
    } catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
  })()`)) || {};
  await sleep(180);
  const c1 = val(await ev(READ_KNOB)) || {};

  await pressKey('ArrowUp', 'ArrowUp', 38);
  await sleep(140);
  const c2 = val(await ev(READ_KNOB)) || {};
  const dUp = (typeof c1.val === 'number' && typeof c2.val === 'number') ? (c2.val - c1.val) : null;
  const step0 = (typeof c1.step === 'number' && isFinite(c1.step) && c1.step > 0) ? c1.step : null;
  check('C3 master knob ArrowUp (real CDP key): value rises ~step (+' + fmt4(dUp) + ') and aria-valuenow matches the store',
    cSet.ok === true && c1.focused === true && dUp !== null && step0 !== null && dUp > 0 && Math.abs(dUp - step0) <= 0.006 && c2.aria === String(c2.val),
    J({ set: cSet, v0: c1.val, v1: c2.val, step: step0, aria: c2.aria, delta: dUp, readout: c2.readout }));

  await keyEvent('rawKeyDown', 'ArrowUp', 'ArrowUp', 38, null, 8);
  await keyEvent('keyUp', 'ArrowUp', 'ArrowUp', 38, null, 8);
  await sleep(140);
  const c3 = val(await ev(READ_KNOB)) || {};
  const dShift = (typeof c2.val === 'number' && typeof c3.val === 'number') ? (c3.val - c2.val) : null;
  check('C4 master knob Shift+ArrowUp (real CDP key): ~10x step delta (+' + fmt4(dShift) + ') and aria-valuenow matches the store',
    cSet.ok === true && dShift !== null && step0 !== null && dShift > 0 && Math.abs(dShift - 10 * step0) <= 0.012 && c3.aria === String(c3.val),
    J({ v1: c2.val, v2: c3.val, step: step0, aria: c3.aria, delta: dShift, readout: c3.readout }));

  await pressKey('End', 'End', 35);
  await sleep(140);
  const c4 = val(await ev(READ_KNOB)) || {};
  const maxN = (c4.max != null && isFinite(Number(c4.max))) ? Number(c4.max) : null;
  check('C5 master knob End (real CDP key): value clamps to max (' + J(c4.max) + ') and aria-valuenow matches',
    cSet.ok === true && maxN !== null && typeof c4.val === 'number' && Math.abs(c4.val - maxN) < 1e-9 && c4.aria === String(c4.val),
    J({ v: c4.val, max: c4.max, aria: c4.aria, readout: c4.readout }));

  const origVal = (typeof cOrig.val === 'number') ? cOrig.val : null;
  if (origVal === null) {
    check('C6 master knob restore: start value restored through the commit path (readback matches)', false, J({ orig: cOrig, why: 'no numeric start value captured' }));
  } else {
    const cRes = val(await ev(`(function () {
      try {
        var el = document.querySelector(${JSON.stringify(KNOB_SEL)});
        if (!el || typeof avKnobCommit !== 'function') return { ok: false };
        avKnobCommit(el, ${JSON.stringify(origVal)});
        return { ok: true, val: (typeof avState !== 'undefined') ? avState.master : null, aria: el.getAttribute('aria-valuenow') };
      } catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
    })()`)) || {};
    await sleep(160);
    const c5 = val(await ev(READ_KNOB)) || {};
    check('C6 master knob restore: start value (' + J(origVal) + ') restored through the commit path (readback matches)',
      cRes.ok === true && typeof c5.val === 'number' && Math.abs(c5.val - origVal) <= 0.0051 && c5.aria === String(c5.val),
      J({ orig: origVal, restored: c5.val, aria: c5.aria }));
  }

  /* ================= D. accessible names ================= */
  console.log('== D. names (visible buttons + counts.unnamed) ==');
  const d1 = val(await ev(`(function () {
    try {
      var vis = function (el) {
        if (el.closest('[hidden]')) return false;
        var r = el.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return false;
        var cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.display !== 'none';
      };
      var nameOf = function (el) {
        var t = String(el.textContent || '').trim();
        var al = String(el.getAttribute('aria-label') || '').trim();
        var ti = String(el.getAttribute('title') || '').trim();
        return t || al || ti || '';
      };
      var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
      var visB = btns.filter(vis);
      var bad = [];
      for (var i = 0; i < visB.length; i++) {
        if (nameOf(visB[i]) === '') bad.push(String(visB[i].id || visB[i].className || 'button').slice(0, 60));
      }
      return { total: btns.length, visible: visB.length, bad: bad.slice(0, 8) };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)) || {};
  check('D1 names: every VISIBLE button has a nonempty accessible name (text | aria-label | title) - ' + J(d1.visible) + ' visible of ' + J(d1.total),
    d1.visible > 0 && Array.isArray(d1.bad) && d1.bad.length === 0,
    J(d1));

  const d2 = val(await ev(`(function () {
    try {
      var s = (window.__avA11y && typeof __avA11y.state === 'function') ? __avA11y.state() : null;
      return { unnamed: (s && s.counts) ? s.counts.unnamed : null, labeled: (s && s.counts) ? s.counts.labeled : null, counts: (s && s.counts) || null };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)) || {};
  check('D2 names: state().counts.unnamed === 0 for buttons', d2.unnamed === 0, J({ unnamed: d2.unnamed, labeled: d2.labeled, counts: d2.counts }));

  /* ================= E. live regions ================= */
  console.log('== E. live regions + announce ==');
  const e1 = val(await ev(`(function () {
    try {
      var els = Array.prototype.slice.call(document.querySelectorAll('.av-fam-status, #av-deliver-status, .av-session-status'));
      var live = els.filter(function (e) { return e.getAttribute('role') === 'status' || e.hasAttribute('aria-live'); });
      return { found: els.length, live: live.length, sample: live.slice(0, 8).map(function (e) { return e.id || String(e.className || '').slice(0, 24); }) };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)) || {};
  check('E1 live regions: >= 3 pinned-selector elements (.av-fam-status / #av-deliver-status / .av-session-status) carry role=status or aria-live (live ' + J(e1.live) + ' of ' + J(e1.found) + ')',
    typeof e1.live === 'number' && e1.live >= 3,
    J(e1));

  const e2 = val(await ev(`(function () {
    try {
      if (typeof avA11yAnnounce !== 'function') return { fn: false };
      avA11yAnnounce('a11y-rig-probe');
      var el = document.getElementById('av-a11y-live');
      return { fn: true, exists: !!el, text: el ? String(el.textContent) : null };
    } catch (e) { return { fn: true, err: String((e && e.message) || e) }; }
  })()`)) || {};
  check('E2 announce: avA11yAnnounce("a11y-rig-probe") writes #av-a11y-live textContent',
    e2.fn === true && e2.text === 'a11y-rig-probe',
    J(e2));

  const e3 = val(await ev(`(function () {
    try {
      var el = document.getElementById('av-a11y-live');
      return { exists: !!el, live: el ? el.getAttribute('aria-live') : null, atomic: el ? el.getAttribute('aria-atomic') : null,
        cls: el ? String(el.className || '') : null, inBody: !!(el && el.parentNode === document.body) };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)) || {};
  check('E3 live region attrs: #av-a11y-live aria-live=polite + aria-atomic=true + class av-a11y-sr',
    e3.exists === true && e3.live === 'polite' && e3.atomic === 'true' && splitCls(e3.cls).indexOf('av-a11y-sr') >= 0,
    J(e3));

  /* ================= F. contrast (toggle - token - reload - reset) ================= */
  console.log('== F. contrast (toggle - token - reload - reset) ==');
  const fPre = val(await ev(CONTRAST_PROBE)) || {};
  const fTok0 = val(await ev(READ_TEXT)) || {};
  const fClick = await clickSel('#av-a11y-contrast', 380);
  const fPost = val(await ev(CONTRAST_PROBE)) || {};
  const fTok1 = val(await ev(READ_TEXT)) || {};
  check('F1 contrast click: body gains av-contrast + aria-pressed "true" + state().contrast true',
    fClick === true && splitCls(fPost.cls).indexOf('av-contrast') >= 0 && fPost.pressed === 'true' && fPost.contrast === true,
    J({ click: fClick, cls: fPost.cls, pressed: fPost.pressed, contrast: fPost.contrast, before: { cls: fPre.cls, pressed: fPre.pressed } }));

  const fHtmlChanged = !!(fTok0 && fTok1 && fTok0.html !== '' && fTok1.html !== '' && fTok1.html !== fTok0.html);
  const fBodyChanged = !!(fTok0 && fTok1 && fTok0.body !== '' && fTok1.body !== '' && fTok1.body !== fTok0.body);
  if (fBodyChanged && !fHtmlChanged) note('F2 triage: --text moved on <body> (the class carrier); the documentElement read is unchanged');
  check('F2 contrast token: computed --text changes with the toggle (documentElement + body reads)',
    fHtmlChanged || fBodyChanged,
    J({ normal: fTok0, contrast: fTok1, htmlChanged: fHtmlChanged, bodyChanged: fBodyChanged }));

  await send('Page.reload');
  await sleep(500);
  const fReady = await until(`document.documentElement.getAttribute('data-av-ready') === '1'`, 25000, 300);
  const fInited = await until(`(function () { try { return !!(window.__avA11y && typeof __avA11y.state === 'function' && __avA11y.state().inited === true); } catch (e) { return false; } })()`, 10000, 250);
  const fRe = val(await ev(CONTRAST_PROBE)) || {};
  check('F3 contrast reload: class + aria-pressed + state RESTORED from prefs',
    fReady === true && fInited === true && splitCls(fRe.cls).indexOf('av-contrast') >= 0 && fRe.pressed === 'true' && fRe.contrast === true,
    J({ ready: fReady, inited: fInited, cls: fRe.cls, pressed: fRe.pressed, contrast: fRe.contrast, ls: fRe.ls }));

  const fClick2 = await clickSel('#av-a11y-contrast', 420);
  const f4 = val(await ev(CONTRAST_PROBE)) || {};
  check('F4 contrast reset: default clean (class off + aria-pressed "false" + state false + prefs contrast false)',
    fClick2 === true && splitCls(f4.cls).indexOf('av-contrast') < 0 && f4.pressed === 'false' && f4.contrast === false && lsContrastFalse(f4.ls),
    J({ click: fClick2, cls: f4.cls, pressed: f4.pressed, contrast: f4.contrast, ls: f4.ls }));

  /* ================= G. motion (emulated reduce + the manual toggle) ================= */
  console.log('== G. motion (emulated reduce + the manual toggle) ==');
  const g0 = val(await ev(COUNT_NZ)) || {};
  check('G1 motion premise: ' + J(g0.nz) + ' element(s) under main animate in normal mode (nonzero transitionDuration)',
    g0.ok === true && g0.nz >= 1,
    J(g0));

  await send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(520);
  const g1 = val(await ev(COUNT_NZ)) || {};
  const g1p = val(await ev(MOTION_PROBE)) || {};
  check('G2 motion emulated (prefers-reduced-motion: reduce): 0 elements under main with a nonzero transitionDuration (all <= 0.0001 s)',
    g1.ok === true && g1.nz === 0,
    J({ count: g1, cls: g1p.cls, matchMedia: g1p.mq, motion: g1p.motion, reduceActive: g1p.reduceActive }));

  await send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await sleep(400);
  const gClick = await clickSel('#av-a11y-motion', 420);
  const g2p = val(await ev(MOTION_PROBE)) || {};
  const g2c = val(await ev(COUNT_NZ)) || {};
  check('G3 motion manual: #av-a11y-motion click -> av-reduce-motion class + aria-pressed "true" + 0 animated elements',
    gClick === true && splitCls(g2p.cls).indexOf('av-reduce-motion') >= 0 && g2p.pressed === 'true' && g2p.motion === 'reduce' && g2c.ok === true && g2c.nz === 0,
    J({ click: gClick, cls: g2p.cls, pressed: g2p.pressed, motion: g2p.motion, count: g2c }));

  const g4 = val(await ev(MOTION_PROBE)) || {};
  check('G4 motion persisted: prefs motion "reduce" in av-a11y localStorage + state().motion reduce',
    lsMotionReduce(g4.ls) && g4.motion === 'reduce',
    J({ ls: g4.ls, motion: g4.motion }));

  const gClick2 = await clickSel('#av-a11y-motion', 420);
  const g5p = val(await ev(MOTION_PROBE)) || {};
  const g5c = val(await ev(COUNT_NZ)) || {};
  check('G5 motion reset: back to system (class off + aria-pressed "false" + count restored >= 1)',
    gClick2 === true && splitCls(g5p.cls).indexOf('av-reduce-motion') < 0 && g5p.pressed === 'false' && g5p.motion === 'system' && g5c.ok === true && g5c.nz >= 1 && lsMotionSystem(g5p.ls),
    J({ click: gClick2, cls: g5p.cls, pressed: g5p.pressed, motion: g5p.motion, count: g5c, ls: g5p.ls }));

  /* ================= H. seal ================= */
  console.log('== H. seal (prefs default - zero errors - freeze - pin) ==');
  const hSet = val(await ev(`(function () {
    try {
      var out = { before: null, err: null };
      try { out.before = localStorage.getItem('av-a11y'); } catch (e) { out.before = 'ERR'; }
      try {
        if (window.__avA11y && typeof __avA11y.setPref === 'function') { __avA11y.setPref('contrast', false); __avA11y.setPref('motion', 'system'); }
        else { out.err = 'no setPref'; }
      } catch (e2) { out.err = String((e2 && e2.message) || e2); }
      return out;
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)) || {};
  await sleep(260);
  const h1 = val(await ev(FINAL_PROBE)) || {};
  check('H1 prefs restored to defaults (contrast false + motion system + classes off + stored default-or-absent)',
    hSet.err === null && splitCls(h1.cls).indexOf('av-contrast') < 0 && splitCls(h1.cls).indexOf('av-reduce-motion') < 0 &&
    h1.cbPressed === 'false' && h1.mbPressed === 'false' && h1.contrast === false && h1.motion === 'system' && lsDefaults(h1.ls),
    J({ set: hSet, cls: h1.cls, cbPressed: h1.cbPressed, mbPressed: h1.mbPressed, contrast: h1.contrast, motion: h1.motion, ls: h1.ls }));
  note('prefs left at defaults - file:// localStorage may be shared with every other suite (this rig owns its state and cleans up)');

  check('H2 zero page errors across every section (exceptions + Log errors + console.error)',
    errors.length === 0,
    'page errors=' + errors.length + ' - module errors=' + (h1.errN != null ? h1.errN : '?') + (errors.length ? ' | ' + errors.slice(0, 3).join(' | ') : ''));

  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after):  ' + shaAfter);
  check('H3 freeze: index.html sha256 before === after (unchanged by the run)', shaAfter === shaBefore, shaAfter);

  if (PIN) check('H4 freeze pin leg: index.html sha256 = pinned', shaBefore === PIN && shaAfter === PIN, 'pinned ' + PIN.slice(0, 12) + '...');
  else note('H4 EXPECT_SHA not pinned yet - after the P7 integration build, pass --sha <hex> or set the constant (never loosened; before === after is always enforced)');

  console.log('');
  console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
  console.log('A11Y-RESULT ' + pass + '/' + (pass + fail));
  console.log('A11Y-RESULT-JSON ' + JSON.stringify({ kind: 'anvil-cdp-a11y', sha256Before: shaBefore, sha256After: shaAfter, pinned: PIN || null, passed: pass, failed: fail, checks: pass + fail, verdict: fail ? 'fail' : 'pass' }));
  console.log(fail ? 'A11Y FAILED' : 'A11Y PASSED');
  try { ws.close(); } catch { /* done */ }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('a11y harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    /* profile-scoped cleanup (LAW): kill ONLY processes whose command line carries OUR temp
       profile - matched by its unique basename, so the pattern needs no backslash escaping */
    const tag = path.basename(profile);
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
