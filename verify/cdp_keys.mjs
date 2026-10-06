// cdp_keys.mjs — Anvil keyboard-dock suite: the 61-key piano dock + the ONE keydown dispatcher
// (src/av_kb.js) over the avNote bus (src/av_note.js), driven by REAL CDP input — Input.dispatchKeyEvent
// and Input.dispatchMouseEvent (trusted, focus-aware, delivered wherever focus is), never synthetic DOM
// events. Launch skeleton copied from verify/cdp_smoke.mjs: new-headless Chromium, temp --user-data-dir,
// 1440x900 metrics override, --mute-audio, explicit exit, own-profile kill only, windowsHide.
// Checks: dock build (61 = 36 + 25) + black-key geometry; STUDIO/KEYS/MIDI switcher; typing keys over
// the bus; backquote + Esc; stop-all on leaving KEYS; pointer press/release + glide; octave window;
// a11y Enter (detail-0 click path); localStorage 'av-input-mode' over real reloads; zero console
// errors; a dock closeup shot. Adapted from Pattern Forge's verify/test_keys.mjs (phases 0/A3/MODE);
// PF-only phases (workstation keys, Kody, tracks, drawer, popout, desk split) are dropped.
//   node verify/cdp_keys.mjs [path-to-index.html] [--port N]
import { spawn, execSync } from 'node:child_process';
import { existsSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const page = argv.find(a => !a.startsWith('--') && (/\.html?$/i.test(a) || existsSync(a))) || path.join(here, '..', 'index.html');
if (!existsSync(page)) { console.error('page not found: ' + page); process.exit(2); }

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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9380);
const profile = path.join(tmpdir(), 'anvil-keys-' + Date.now());
const url = 'file:///' + path.resolve(page).replace(/\\/g, '/');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const chrome = spawn(exe, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--disable-sync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
  url,
], { stdio: 'ignore', windowsHide: true });

let pass = 0, fail = 0;
const check = (name, ok, info) => {
  if (ok) { pass++; console.log(' ok   ' + name + (info ? '  -> ' + info : '')); }
  else { fail++; console.log(' FAIL ' + name + (info ? '  -> ' + info : '')); }
};

const errors = [];
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
  ws.onmessage = (evt) => {
    const m = JSON.parse(evt.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('LOG: ' + m.params.entry.text);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value || a.description || '').join(' '));
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  /* boot at the desktop viewport: metrics FIRST, then a fresh navigate — so the dock is built
     at 1440x900, not at whatever default size the profile opened with */
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => { });
  await send('Page.navigate', { url });

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return { value: r.result?.value };
  };
  /* ev() can reject while a document is swapping under us (reload); treat that as "not yet" */
  const tryEv = async (expr) => { try { return await ev(expr); } catch (e) { return { error: String((e && e.message) || e) }; } };

  const waitReady = async (tries = 80) => {
    for (let i = 0; i < tries; i++) {
      const r = await tryEv(`document.documentElement.getAttribute('data-av-ready') === '1'`);
      if (r.value === true) return true;
      await sleep(250);
    }
    return false;
  };
  const reloadAndWait = async () => { await send('Page.reload'); await sleep(400); return await waitReady(80); };

  /* ---- real input helpers (PF law: real key/mouse events, never synthetic DOM events) ---- */
  const keyEvent = (type, k, code, vk, text, mods = 0) => send('Input.dispatchKeyEvent', {
    type, key: k, code, modifiers: mods, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    ...(text != null ? { text, unmodifiedText: text } : {}),
  });
  const keyDownPress = (k, code, vk, text) => keyEvent(k.length === 1 ? 'keyDown' : 'rawKeyDown', k, code, vk, text);
  const keyUpPress = (k, code, vk, mods = 0) => keyEvent('keyUp', k, code, vk, null, mods);
  const pressKey = async (k, code, vk, text) => { await keyDownPress(k, code, vk, text); await keyUpPress(k, code, vk); };
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });

  /* state setup between phases — never the thing under test (PF RESET, adapted) */
  const RESET = `(() => {
    try {
      if (typeof avSetInputMode === 'function') avSetInputMode('studio', { persist: false });
      if (typeof avNoteStopAll === 'function') avNoteStopAll();
      window.__lastNotePreview = null;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    } catch (e) { return 'reset failed: ' + (e && e.message); }
    return true; })()`;

  const SNAP = `(() => {
    const g = (id) => document.getElementById(id);
    const kb = (typeof window.__avKb === 'function') ? window.__avKb() : null;
    const notes = (typeof window.__avNotes === 'function') ? window.__avNotes() : null;
    const chips = [...document.querySelectorAll('#pk-modes .pk-mode')].map(b => ({ m: b.dataset.mode, on: b.classList.contains('on'), pr: b.getAttribute('aria-pressed') }));
    const led = g('pk-arm-led');
    return {
      mode: kb ? kb.mode : null, armed: kb ? kb.armed : null, win: kb ? kb.win : null,
      held: notes ? notes.held : null, taken: notes ? notes.taken : null,
      lastNote: window.__lastNotePreview || null,
      chips: chips, on: chips.filter(c => c.on).map(c => c.m),
      led: !!(led && led.classList.contains('on')),
      hint: g('pk-mode-hint') ? String(g('pk-mode-hint').textContent) : null,
      winTxt: g('pk-win') ? String(g('pk-win').textContent) : null,
      cls: String(document.body.className || ''),
      dock: !!g('piano-dock'),
      keys: document.querySelectorAll('#piano-keys .pk-key').length,
    }; })()`;
  const snap = async () => (await ev(SNAP)).value || {};

  const clickChip = async (mode) => {
    const b = await ev(`(() => {
      const el = document.querySelector('#pk-modes .pk-mode[data-mode="${mode}"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (!b.value) return false;
    await mouse('mousePressed', b.value.x, b.value.y);
    await mouse('mouseReleased', b.value.x, b.value.y);
    await sleep(340);
    return true;
  };

  /* ==================== checks ==================== */

  /* 1. boot + dock */
  const ready = await waitReady(120);
  check('boot: data-av-ready flips on the frozen build', ready === true);
  if (!ready) { console.error('APP NOT READY'); process.exit(1); }

  const d1 = (await ev(`(() => {
    const dock = document.getElementById('piano-dock');
    const box = document.getElementById('piano-keys');
    if (!dock || !box) return { dock: !!dock, box: !!box };
    const r = dock.getBoundingClientRect();
    return { dock: true, box: true,
      visible: getComputedStyle(dock).display !== 'none' && r.width > 900 && r.height > 80,
      total: box.querySelectorAll('.pk-key').length,
      white: box.querySelectorAll('.pk-white').length,
      black: box.querySelectorAll('.pk-black').length };
  })()`)).value || {};
  check('dock: #piano-dock on screen - exactly 61 keys (36 white / 25 black)',
    d1.dock === true && d1.visible === true && d1.total === 61 && d1.white === 36 && d1.black === 25, JSON.stringify(d1));

  /* 2. black-key geometry — left % on the boundary (belowIdx+1)*W - BW/2, W = 100/36, BW = W*0.6 */
  const geoR = await ev(`(() => {
    const box = document.getElementById('piano-keys');
    if (!box) return null;
    const boxR = box.getBoundingClientRect();
    const whites = [...box.querySelectorAll('.pk-white')].map(k => parseInt(k.dataset.midi, 10));
    const W = 100 / whites.length, BW = W * 0.6;
    const blacks = [...box.querySelectorAll('.pk-black')].map(b => {
      const m = parseInt(b.dataset.midi, 10);
      const belowIdx = whites.indexOf(m - 1);
      const exp = (belowIdx + 1) * W - BW / 2;
      const r = b.getBoundingClientRect();
      const below = box.querySelector('.pk-white[data-midi="' + (m - 1) + '"]');
      const bound = below ? (below.getBoundingClientRect().right - boxR.left) / boxR.width * 100 : null;
      return { m: m, belowIdx: belowIdx, exp: exp,
        styleLeft: parseFloat(b.style.left), styleW: parseFloat(b.style.width),
        left: (r.left - boxR.left) / boxR.width * 100, w: r.width / boxR.width * 100, bound: bound };
    });
    return { W: W, BW: BW, blacks: blacks };
  })()`);
  const geo = geoR.value || {};
  const blacks = geo.blacks || [];
  /* sample: the first 7 blacks + 7 picked across the rest (fixed-seed LCG, deterministic) */
  let seed = 20261007 >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pool = [...Array(Math.max(0, blacks.length - 7)).keys()].map(i => i + 7);
  const picked = [];
  while (picked.length < 7 && pool.length) picked.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  const idxs = [...new Set([0, 1, 2, 3, 4, 5, 6, ...picked])].filter(i => i < blacks.length);
  const samp = idxs.map(i => blacks[i]);
  const offLeft = samp.filter(b => !(Math.abs(b.left - b.exp) <= 0.3));
  const offStyle = samp.filter(b => !(Math.abs(b.styleLeft - b.exp) <= 0.005 && Math.abs(b.styleW - geo.BW) <= 0.005));
  const offCtr = samp.filter(b => b.bound == null || !(Math.abs((b.left + b.w / 2) - b.bound) <= 0.35));
  const worst = samp.length ? Math.max(...samp.map(b => Math.abs(b.left - b.exp))).toFixed(3) : 'n/a';
  check('black-key geometry: sampled left % sits on the piano boundary (+/-0.3; first 7 + 7 picks)',
    blacks.length === 25 && idxs.length === 14 && offLeft.length === 0 && offStyle.length === 0 && offCtr.length === 0,
    `n=${blacks.length} sampled=${idxs.length} worst=${worst} offLeft=${offLeft.length} offStyle=${offStyle.length} offCentre=${offCtr.length}`);
  const outside = blacks.filter(b => b.left < -0.05 || b.left + b.w > 100.05);
  check('black-key geometry: every black inside 0..100 of the bed', blacks.length === 25 && outside.length === 0, `outside=${outside.length}`);

  /* 3. fresh state — STUDIO, one lit chip, hint, no body classes (before anything changes mode) */
  const f0 = await snap();
  check('fresh state: STUDIO - one lit chip (aria-pressed), hint mentions STUDIO, no kb-armed/kb-midi',
    f0.mode === 'studio' && f0.armed === false && f0.on.length === 1 && f0.on[0] === 'studio'
    && f0.chips.filter(c => c.pr === 'true').length === 1 && f0.chips.filter(c => c.m === 'studio')[0].pr === 'true'
    && f0.chips.filter(c => c.m !== 'studio').every(c => c.pr === 'false')
    && /STUDIO/.test(String(f0.hint)) && !/kb-armed/.test(f0.cls) && !/kb-midi/.test(f0.cls),
    `mode=${f0.mode} on=${JSON.stringify(f0.on)} hint="${String(f0.hint).slice(0, 24)}..." cls="${f0.cls}"`);

  /* 4. KEYS chip click — real mouse at the chip centre */
  const clickedKeys = await clickChip('keys');
  const mK = await snap();
  check('KEYS chip click (real mouse) - mode keys, armed, #pk-arm-led on, body.kb-armed',
    clickedKeys === true && mK.mode === 'keys' && mK.armed === true && mK.led === true && /\bkb-armed\b/.test(mK.cls) && mK.on.join() === 'keys',
    `mode=${mK.mode} armed=${mK.armed} led=${mK.led} cls="${mK.cls}"`);

  /* 5. typing: real keydown A -> c4 on the bus; keyup releases */
  await keyDownPress('a', 'KeyA', 65, 'a');
  await sleep(300);
  const h1 = await snap();
  await keyUpPress('a', 'KeyA', 65);
  await sleep(340);
  const h2 = await snap();
  check('typing: real A in KEYS - __lastNotePreview c4 + bus held [c4]',
    h1.lastNote === 'c4' && Array.isArray(h1.held) && h1.held.indexOf('c4') >= 0,
    JSON.stringify({ note: h1.lastNote, held: h1.held }));
  check('typing: keyup releases - bus held empty (no drone)', Array.isArray(h2.held) && h2.held.length === 0,
    JSON.stringify({ held: h2.held }));

  /* 6. backquote toggles STUDIO<->KEYS; Escape disarms */
  await pressKey('`', 'Backquote', 192, '`');
  await sleep(320);
  const t1 = await snap();
  check('` toggles KEYS -> STUDIO (chip, LED and body class follow)',
    t1.mode === 'studio' && t1.armed === false && t1.led === false && t1.on.join() === 'studio' && !/kb-armed/.test(t1.cls),
    `mode=${t1.mode} led=${t1.led} cls="${t1.cls}"`);
  await pressKey('`', 'Backquote', 192, '`');
  await sleep(320);
  const t2 = await snap();
  check('` toggles STUDIO -> KEYS again', t2.mode === 'keys' && t2.armed === true && t2.led === true && t2.on.join() === 'keys',
    `mode=${t2.mode} armed=${t2.armed} led=${t2.led}`);
  await pressKey('Escape', 'Escape', 27, undefined);
  await sleep(320);
  const t3 = await snap();
  check('Escape disarms KEYS (armed false, LED off, chip back to STUDIO)',
    t3.mode === 'studio' && t3.armed === false && t3.led === false && t3.on.join() === 'studio',
    `mode=${t3.mode} armed=${t3.armed} led=${t3.led}`);

  /* 7. leaving KEYS while a note is held -> stop-all (never a drone) */
  await ev(RESET); await sleep(200);
  await pressKey('`', 'Backquote', 192, '`');
  await sleep(300);
  await keyDownPress('a', 'KeyA', 65, 'a');
  await sleep(300);
  const held7 = await snap();
  const clickedStudio = await clickChip('studio');
  const post7 = await snap();
  await keyUpPress('a', 'KeyA', 65);
  await sleep(220);
  check('leaving KEYS under a held note stops it (STUDIO chip click -> bus held empty)',
    Array.isArray(held7.held) && held7.held.length === 1 && held7.held[0] === 'c4' && clickedStudio === true
    && post7.mode === 'studio' && post7.held.length === 0,
    JSON.stringify({ before: held7.held, mode: post7.mode, after: post7.held }));

  /* 8. MIDI chip — the letters stay quiet */
  await ev(RESET); await sleep(160);
  const clickedMidi = await clickChip('midi');
  const mM = await snap();
  await ev(`window.__lastNotePreview = '__midi_probe__'; true`);
  const errBefore = errors.length;
  await keyDownPress('a', 'KeyA', 65, 'a');
  await sleep(200);
  await keyUpPress('a', 'KeyA', 65);
  await sleep(220);
  const a8 = await snap();
  check('MIDI chip - mode midi, body.kb-midi; letters quiet (A: no preview change, no held, no error)',
    clickedMidi === true && mM.mode === 'midi' && mM.armed === false && /\bkb-midi\b/.test(mM.cls)
    && a8.lastNote === '__midi_probe__' && a8.held.length === 0 && errors.length === errBefore,
    JSON.stringify({ mode: mM.mode, note: a8.lastNote, held: a8.held, errDelta: errors.length - errBefore }));

  /* 9. pointer: press / release / glide */
  await ev(RESET); await sleep(160);
  const p72 = (await ev(`(() => {
    const k = document.querySelector('#piano-keys .pk-key[data-midi="72"]');
    const box = document.getElementById('piano-keys');
    if (!k || !box) return null;
    const r = k.getBoundingClientRect(), br = box.getBoundingClientRect();
    return { note: k.dataset.note, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
      yLow: Math.round(br.top + br.height * 0.85) };
  })()`)).value || null;
  await mouse('mousePressed', p72.x, p72.y);
  await sleep(240);
  const p1 = await snap();
  await mouse('mouseReleased', p72.x, p72.y);
  await sleep(260);
  const p2 = await snap();
  check('pointer: press on .pk-key[data-midi=72] centre plays its data-note (held + preview)',
    !!p72 && p72.note === 'c5' && p1.held.indexOf('c5') >= 0 && p1.lastNote === 'c5',
    JSON.stringify({ key: p72 && p72.note, held: p1.held, note: p1.lastNote }));
  check('pointer: release stops all - bus held empty', p2.held.length === 0, JSON.stringify({ held: p2.held }));

  /* witness: every pointerenter/leave, capture phase (sees non-bubbling events) */
  await ev(`(() => {
    window.__kbPtr = [];
    const tag = (e, n) => { const t = e.target; const k = t && t.closest && t.closest('.pk-key'); window.__kbPtr.push(n + ':' + (k ? k.dataset.note : (t.id || t.tagName))); };
    ['pointerenter', 'pointerleave', 'pointerover', 'pointerout'].forEach(n => document.addEventListener(n, (e) => tag(e, n.slice(7)), true));
    return true; })()`);
  const p74 = (await ev(`(() => {
    const k = document.querySelector('#piano-keys .pk-key[data-midi="74"]');
    if (!k) return null;
    const r = k.getBoundingClientRect();
    return { note: k.dataset.note, x: Math.round(r.left + r.width / 2) };
  })()`)).value || null;
  /* glide low in the whites (85% height): the path never crosses a black key */
  await mouse('mousePressed', p72.x, p72.yLow);
  await sleep(200);
  const g0 = await snap();
  await mouse('mouseMoved', p74.x, p72.yLow);
  await sleep(300);
  const g1 = await snap();
  await mouse('mouseReleased', p74.x, p72.yLow);
  await sleep(260);
  const g2 = await snap();
  const ptr = (await ev(`window.__kbPtr.slice(-8)`)).value || [];
  check('pointer glide: holding and crossing onto the neighbour sounds BOTH keys',
    !!p74 && g0.held.indexOf('c5') >= 0 && g1.held.indexOf('c5') >= 0 && g1.held.indexOf('d5') >= 0 && g1.lastNote === 'd5' && g2.held.length === 0,
    JSON.stringify({ start: g0.held, after: g1.held, note: g1.lastNote, end: g2.held, ptr: ptr }));

  /* 10. octave window [ ] — steps, clamps, and the typing map shifts */
  await ev(RESET); await sleep(160);
  await pressKey(']', 'BracketRight', 221, ']');
  await sleep(200);
  const o1 = await snap();
  await pressKey(']', 'BracketRight', 221, ']');
  await sleep(200);
  const o2 = await snap();
  await pressKey('[', 'BracketLeft', 219, '[');
  await sleep(200);
  await pressKey('[', 'BracketLeft', 219, '[');
  await sleep(200);
  const o3 = await snap();
  check('octave: ] steps up to win 3 and clamps (#pk-win stays "OCT C5")',
    o1.win === 3 && o1.winTxt === 'OCT C5' && o2.win === 3 && o2.winTxt === 'OCT C5',
    `win ${o1.win}->${o2.win} "${o1.winTxt}"->"${o2.winTxt}"`);
  check('octave: [ steps win 3->2->1 (#pk-win C4->C3)', o3.win === 1 && o3.winTxt === 'OCT C3', `win=${o3.win} "${o3.winTxt}"`);
  await pressKey('`', 'Backquote', 192, '`');
  await sleep(300);
  await keyDownPress('a', 'KeyA', 65, 'a');
  await sleep(260);
  const o4 = await snap();
  await keyUpPress('a', 'KeyA', 65);
  await sleep(220);
  check('octave: the typing map shifted - A at win 1 = c3', o4.lastNote === 'c3' && o4.held.indexOf('c3') >= 0,
    JSON.stringify({ win: o4.win, note: o4.lastNote, held: o4.held }));
  await pressKey('Escape', 'Escape', 27, undefined);
  await sleep(240);
  await pressKey('[', 'BracketLeft', 219, '[');
  await sleep(200);
  await pressKey('[', 'BracketLeft', 219, '[');
  await sleep(200);
  const o5 = await snap();
  check('octave: clamps at win 0 (#pk-win "OCT C2" after two more [)', o5.win === 0 && o5.winTxt === 'OCT C2',
    `win=${o5.win} "${o5.winTxt}"`);

  /* 11. a11y — Enter on a focused key plays via the detail-0 click path, then auto-releases */
  await ev(RESET); await sleep(160);
  await ev(`(() => { window.__kbClicks = []; document.addEventListener('click', (e) => { const k = e.target && e.target.closest ? e.target.closest('.pk-key') : null; window.__kbClicks.push((k ? k.dataset.note : ((e.target && e.target.id) || 'other')) + '@' + e.detail); }, true); return true; })()`);
  const foc = (await ev(`(() => {
    const k = document.querySelector('#piano-keys .pk-key[data-midi="60"]');
    if (!k) return null;
    k.focus();
    return { focused: document.activeElement === k, note: k.dataset.note };
  })()`)).value || null;
  /* a physical Enter carries the CR character — dispatch it the way a real key does */
  await keyEvent('keyDown', 'Enter', 'Enter', 13, String.fromCharCode(13));
  await sleep(200);
  const e1 = await snap();
  await keyUpPress('Enter', 'Enter', 13);
  const clicks = (await ev(`window.__kbClicks`)).value || [];
  await sleep(520);
  const e2 = await snap();
  check('a11y: Enter on a focused key button plays it (the detail-0 click path)',
    !!foc && foc.focused === true && e1.lastNote === 'c4' && e1.held.indexOf('c4') >= 0,
    JSON.stringify({ focus: foc && foc.focused, note: e1.lastNote, held: e1.held, clicks: clicks }));
  check('a11y: the note auto-releases (~350 ms timer) - held empty at +720 ms',
    Array.isArray(e2.held) && e2.held.length === 0, JSON.stringify({ held: e2.held }));

  /* 12. persistence over real reloads: 'av-input-mode' */
  await ev(`(() => { try { localStorage.setItem('av-input-mode', 'keys'); } catch (e) {} return true; })()`);
  const rl1 = await reloadAndWait();
  const r1 = await snap();
  check('persistence: av-input-mode=keys survives a real reload',
    rl1 === true && r1.mode === 'keys' && r1.armed === true && r1.on.join() === 'keys' && r1.led === true && r1.keys === 61,
    JSON.stringify({ mode: r1.mode, armed: r1.armed, keys: r1.keys, led: r1.led }));
  await keyDownPress('a', 'KeyA', 65, 'a');
  await sleep(240);
  const r1b = await snap();
  await keyUpPress('a', 'KeyA', 65);
  await sleep(220);
  check('persistence: the restored KEYS mode really plays (A -> c4 after the reload)',
    r1b.lastNote === 'c4' && r1b.held.indexOf('c4') >= 0, JSON.stringify({ note: r1b.lastNote, held: r1b.held }));
  await ev(`(() => { try { localStorage.setItem('av-input-mode', 'klingon'); } catch (e) {} return true; })()`);
  const rl2 = await reloadAndWait();
  const r2 = await snap();
  check('persistence: a corrupt stored mode ("klingon") falls back to STUDIO at boot',
    rl2 === true && r2.mode === 'studio' && r2.armed === false && r2.on.join() === 'studio' && r2.keys === 61
    && !/kb-armed/.test(r2.cls) && !/kb-midi/.test(r2.cls),
    JSON.stringify({ mode: r2.mode, on: r2.on, keys: r2.keys, cls: r2.cls }));
  await ev(`(() => { try { localStorage.removeItem('av-input-mode'); } catch (e) {} return true; })()`);
  await reloadAndWait();

  /* 14. screenshot — dock closeup, KEYS mode mid-state */
  await ev(RESET); await sleep(160);
  const shotArmed = await clickChip('keys');
  await keyDownPress('a', 'KeyA', 65, 'a');
  await sleep(240);
  const rect = (await ev(`(() => {
    const r = document.getElementById('piano-dock').getBoundingClientRect();
    return { x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(r.width), height: Math.ceil(r.height) };
  })()`)).value || { x: 0, y: 700, width: 1440, height: 200 };
  const shotPath = path.join(here, '..', 'renders', 'p0-keys-suite.png');
  let shotOk = false;
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 2 } });
    writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    shotOk = statSync(shotPath).size > 2000;
  } catch (e) { /* FAIL below */ }
  await keyUpPress('a', 'KeyA', 65);
  await sleep(220);
  check('screenshot: dock closeup in KEYS mode -> renders/p0-keys-suite.png',
    shotOk && shotArmed === true, shotPath + (shotOk ? ' (' + statSync(shotPath).size + ' bytes)' : ' (not written)'));

  /* 13. zero console errors across the whole run */
  check('zero console errors for the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { ws.close(); } catch { }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('keys harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile.replace(/[\\/]/g, '\\\\')}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
