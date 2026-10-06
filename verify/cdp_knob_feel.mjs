// cdp_knob_feel.mjs — Anvil's knob feel suite (ported from Pattern Forge's cdp_knob_feel):
// travel curve, twist gesture, damped weight, mechanical stops, step/wheel/keys contract,
// and knob→tap-gain routing. Real mouse input over CDP, muted browser, temp profile.
//   node verify/cdp_knob_feel.mjs [path-to-index.html] [--port N]
import { spawn, execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9364);
const profile = path.join(tmpdir(), 'anvil-knobfeel-' + Date.now());
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

async function getJson(p, tries = 30) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); if (r.ok) return await r.json(); } catch { }
    await sleep(500);
  }
  throw new Error('CDP not reachable');
}

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
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('LOG: ' + m.params.entry.text);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value || a.description || '').join(' '));
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  if (!String(target.url).startsWith('file://')) await send('Page.navigate', { url });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return { value: r.result?.value };
  };
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const r = await ev(`document.documentElement.getAttribute('data-av-ready') === '1'`);
    if (r.value === true) { ready = true; break; }
    await sleep(300);
  }
  check('boot: data-av-ready flips and the app is wired', ready);
  if (!ready) { console.error('APP NOT READY'); process.exit(1); }

  const setMaster = async (v) => { await ev(`avKnobCommit(document.querySelector('.av-knob[data-knob="master"]'), ${v})`); await sleep(260); };
  const master = async () => (await ev('avState.master')).value;
  const knobRect = async (sel) => (await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height, cx: Math.round(b.left + b.width / 2), cy: Math.round(b.top + b.height / 2) }; })()`)).value;

  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const drag = async (from, deltas, gap = 18) => {
    await mouse('mousePressed', from.x, from.y);
    let x = from.x, y = from.y;
    for (const [dx, dy] of deltas) { x += dx; y += dy; await mouse('mouseMoved', x, y); if (gap) await sleep(gap); }
    await mouse('mouseReleased', x, y);
  };

  /* ---------- 1. mount + first paint ---------- */
  const mount = await ev(`(() => {
    const el = document.querySelector('.av-knob[data-knob="master"]');
    const k = document.querySelector('.av-knob[data-knob="keys"]');
    if (!el || !k) return null;
    const w = el.closest('.av-knob-wrap');
    const readout = document.querySelector('[data-kval="master"]');
    return {
      ring: !!el.querySelector('.av-knob-ring'), face: !!el.querySelector('.av-knob-face'), mark: !!el.querySelector('.av-knob-mark'),
      label: (w.querySelector('.av-knob-lbl') || {}).textContent || '',
      keysLabel: (k.closest('.av-knob-wrap').querySelector('.av-knob-lbl') || {}).textContent || '',
      bound: el.dataset.knobBound === '1' && k.dataset.knobBound === '1',
      inLevels: !!el.closest('#av-levels'),
      firstPaint: !!readout && readout.textContent === Math.round(avState.master * 100) + '%' && el.getAttribute('aria-valuenow') === String(avState.master),
      arc: (el.querySelector('.av-knob-ring').style.getPropertyValue('--knob-arc') || '').trim(),
    };
  })()`);
  const m = mount.value || {};
  check('both knobs mounted in the LEVELS card, skinned + bound', !!m.ring && !!m.face && !!m.mark && m.bound === true && m.inLevels === true, JSON.stringify({ ring: m.ring, bound: m.bound, inLevels: m.inLevels }));
  check('first paint: label, readout and aria from the live store', m.label === 'Master' && m.keysLabel === 'Instrument' && m.firstPaint === true && m.arc !== '', JSON.stringify({ label: m.label, keys: m.keysLabel, paint: m.firstPaint, arc: m.arc }));

  /* ---------- 2. the travel curve: fine at the start, faster the further you go --------- */
  await setMaster(0.05);
  const from = await knobRect('.av-knob[data-knob="master"]');
  await drag({ x: from.x, y: from.y }, [[0, -5], [0, -5], [0, -5], [0, -5]]);   /* 20 px up */
  await sleep(420);
  const dSmall = (await master()) - 0.05;
  await setMaster(0.05);
  await drag({ x: from.x, y: from.y }, Array.from({ length: 8 }, () => [0, -15]));  /* 120 px up */
  await sleep(420);
  const dBig = (await master()) - 0.05;
  const rateSmall = dSmall / 20, rateBig = dBig / 120;
  check('a short slide is fine, a long one is fast (the curve)', rateBig > rateSmall * 1.5 && dSmall > 0.005 && dBig > dSmall * 2,
    `20 px -> +${dSmall.toFixed(3)} (${(rateSmall * 1000).toFixed(0)}/kpx), 120 px -> +${dBig.toFixed(3)} (${(rateBig * 1000).toFixed(0)}/kpx)`);

  /* ---------- 3. twisting the rim works too -------------------------------------------- */
  await setMaster(0.05);
  const c = await knobRect('.av-knob[data-knob="master"]');
  const R = 21;                                                    /* on the rim of the 62 px cap, not past it */
  await mouse('mousePressed', c.x + R, c.y);                       /* 3 o'clock */
  for (let i = 1; i <= 6; i++) {
    const a = (Math.PI / 2) * (i / 6);                             /* sweep to 6 o'clock = clockwise */
    await mouse('mouseMoved', c.x + R * Math.cos(a), c.y + R * Math.sin(a));
    await sleep(30);
  }
  await mouse('mouseReleased', c.x, c.y + R);
  await sleep(420);
  const twist = (await master()) - 0.05;
  check('twisting clockwise raises the level', twist > 0.05, `+${twist.toFixed(3)} over a 90° twist`);

  /* ---------- 4. the weight: it lags, then settles dead on the target ------------------- */
  await setMaster(0.05);
  const f2 = await knobRect('.av-knob[data-knob="master"]');
  await mouse('mousePressed', f2.x, f2.y);
  let yy = f2.y;
  for (let i = 0; i < 6; i++) { yy -= 26; await mouse('mouseMoved', f2.x, yy); }   /* fast: no sleeps */
  const atRelease = await master();
  await mouse('mouseReleased', f2.x, yy);
  const seen = [];
  for (let i = 0; i < 14; i++) { seen.push(await master()); await sleep(30); }
  const settled = await master();
  const lag = settled - atRelease;
  const overshoot = Math.max(...seen.slice(1)) - settled;
  check('a flick keeps moving after release, then settles', lag > 0.004 && Math.abs(seen[seen.length - 1] - settled) < 0.001,
    `release ${atRelease.toFixed(4)} -> settles ${settled.toFixed(4)} (lag +${lag.toFixed(4)}, overshoot ${overshoot.toFixed(4)})`);
  check('it never overshoots the target (heavy, not springy)', overshoot <= 0.002, `max overshoot ${overshoot.toFixed(4)}`);

  /* ---------- 5. the mechanical stops + a drag is not a click --------------------------- */
  await setMaster(0.05);
  const f3 = await knobRect('.av-knob[data-knob="master"]');
  await mouse('mousePressed', f3.x, f3.y);
  let y3 = f3.y;
  for (let i = 0; i < 8; i++) { y3 -= 120; await mouse('mouseMoved', f3.x, y3); await sleep(12); }
  const stopSeen = (await ev(`document.querySelector('.av-knob[data-knob="master"]').classList.contains('at-stop')`)).value;
  await mouse('mouseReleased', f3.x, y3);
  await sleep(420);
  const top1 = await master();
  check('it stops dead at the maximum', top1 === 1.2, `value ${top1} (max 1.2), stop felt: ${stopSeen}`);
  check('the stop does not add a phantom step after the drag', top1 === 1.2, `value stayed ${top1}`);
  await setMaster(0.05);
  const f4 = await knobRect('.av-knob[data-knob="master"]');
  await mouse('mousePressed', f4.x, f4.y);
  let y4 = f4.y;
  for (let i = 0; i < 8; i++) { y4 += 120; await mouse('mouseMoved', f4.x, y4); await sleep(12); }
  await mouse('mouseReleased', f4.x, y4);
  await sleep(420);
  check('it stops dead at the minimum', (await master()) === 0, `value ${await master()}`);

  /* ---------- 6. the rest of the pointer contract: click / wheel / keys / reset ---------- */
  await setMaster(0.5);
  const c2 = await knobRect('.av-knob[data-knob="master"]');
  await mouse('mousePressed', c2.x, c2.y);
  await mouse('mouseReleased', c2.x, c2.y);
  await sleep(140);
  const clickUp = await master();
  check('a plain click steps one notch up', clickUp === 0.51, `0.50 -> ${clickUp}`);
  await mouse('mousePressed', c2.x, c2.y, { modifiers: 8 });
  await mouse('mouseReleased', c2.x, c2.y, { modifiers: 8 });
  await sleep(140);
  const shiftClick = await master();
  check('shift-click steps down', shiftClick === 0.5, `${clickUp} -> ${shiftClick}`);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(c2.x), y: Math.round(c2.y), deltaX: 0, deltaY: 120 });
  await sleep(140);
  const wheelDown = await master();
  check('wheel steps too (down = down)', wheelDown === 0.49, `${shiftClick} -> ${wheelDown}`);
  const keysR = await ev(`(() => {
    const el = document.querySelector('.av-knob[data-knob="master"]');
    const kd = (key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    el.focus(); kd('ArrowUp'); const up = avState.master;
    kd('End'); const end = avState.master;
    kd('Home'); const home = avState.master;
    return { up, end, home };
  })()`);
  const kv = keysR.value || {};
  check('arrow keys adjust, End/Home jump to the stops', kv.up === 0.5 && kv.end === 1.2 && kv.home === 0, JSON.stringify(kv));
  const dblR = await ev(`(() => {
    const el = document.querySelector('.av-knob[data-knob="master"]');
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    return avState.master;
  })()`);
  check('double-click resets to the default', dblR.value === 0.8, `home(0) -> dblclick -> ${dblR.value}`);

  /* ---------- 7. the two knobs are separate controls, readouts follow ------------------- */
  const bothR = await ev(`(() => {
    const k = document.querySelector('.av-knob[data-knob="keys"]');
    avKnobCommit(k, 0.9);
    const a = { keys: avState.keysVol, master: avState.master, keysTxt: (document.querySelector('[data-kval="keys"]') || {}).textContent };
    avKnobCommit(document.querySelector('.av-knob[data-knob="master"]'), 0.66);
    return { keys: a.keys, masterAfterKeys: a.master, keysTxt: a.keysTxt, masterTxt: (document.querySelector('[data-kval="master"]') || {}).textContent };
  })()`);
  const bv = bothR.value || {};
  check('instrument and master are independent, readouts follow', bv.keys === 0.9 && bv.masterAfterKeys === 0.8 && bv.keysTxt === '90%' && bv.masterTxt === '66%', JSON.stringify(bv));

  /* ---------- 8. the knobs drive the real tap gains ------------------------------------- */
  const gR = await ev(`(async () => {
    const c = new AudioContext(); void c.destination;
    await c.resume();
    avKnobCommit(document.querySelector('.av-knob[data-knob="master"]'), 0.9);
    avKnobCommit(document.querySelector('.av-knob[data-knob="keys"]'), 0.75);
    await new Promise(r => setTimeout(r, 320));
    const mo = avMasterFor(c), ko = avKeysFor(c);
    const out = { ctx: c.state, master: mo ? Number(mo.gain.value.toFixed(4)) : null, keys: ko ? Number(ko.gain.value.toFixed(4)) : null };
    try { c.close(); } catch (e) {}
    return out;
  })()`);
  const gv = gR.value || {};
  check('the knobs move the real master-tap gains', Math.abs(gv.master - 0.9) < 0.02 && Math.abs(gv.keys - 0.75) < 0.02, JSON.stringify(gv));

  /* ---------- 9. screenshots of the LEVELS card + the page ------------------------------- */
  await setMaster(0.96);
  await ev(`avKnobCommit(document.querySelector('.av-knob[data-knob="keys"]'), 0.6)`);
  await sleep(320);
  const rectR = await ev(`(() => { const r = document.getElementById('av-levels').getBoundingClientRect(); return { x: Math.floor(r.left), y: Math.floor(r.top), w: Math.ceil(r.width), h: Math.ceil(r.height) }; })()`);
  const rr = rectR.value || { x: 0, y: 0, w: 1440, h: 900 };
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: rr.x, y: rr.y, width: rr.w, height: rr.h, scale: 2 } });
  const cardOut = path.join(here, '..', 'renders', 'p0-knobs.png');
  writeFileSync(cardOut, Buffer.from(shot.data, 'base64'));
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  const fullOut = path.join(here, '..', 'renders', 'p0-knobs-full.png');
  writeFileSync(fullOut, Buffer.from(shot2.data, 'base64'));
  console.log('shots -> ' + cardOut + ' , ' + fullOut);

  check('no console errors during the knob session', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { ws.close(); } catch { }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('knob-feel harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile.replace(/[\\/]/g, '\\\\')}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
