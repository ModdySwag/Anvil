// cdp_smoke.mjs — Anvil smoke suite: the boot contract end-to-end, over raw CDP.
// Ported from Pattern Forge's cdp_smoke launch laws: new-headless Chromium, device metrics
// 1440×900, --mute-audio, temp --user-data-dir (never touches the user profile), explicit exit;
// checks: boot → data-av-ready → chips filled → tap armed → knobs mounted → selftest lines →
// zero page errors. Runs against index.html?avtest=1 so the runtime proofs execute too.
//   node verify/cdp_smoke.mjs [path-to-index.html] [--port N]
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9344);
const profile = path.join(tmpdir(), 'anvil-smoke-' + Date.now());
const url = 'file:///' + path.resolve(page).replace(/\\/g, '/') + '?avtest=1';
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

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return { value: r.result?.value };
  };

  /* 1. boot contract */
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const r = await ev(`document.documentElement.getAttribute('data-av-ready') === '1'`);
    if (r.value === true) { ready = true; break; }
    await sleep(300);
  }
  check('boot: data-av-ready flips', ready);
  if (!ready) { console.error('APP NOT READY'); process.exit(1); }

  /* 2. chips filled */
  const chipsR = await ev(`(() => {
    const t = (id) => ((document.getElementById(id) || {}).textContent || '').trim();
    return { ver: t('av-version'), tier: t('av-tier'),
             voices: [...document.querySelectorAll('.av-chip')].some(c => /voices/.test(c.textContent)),
             version: ANVIL.version };
  })()`);
  const chips = chipsR.value || {};
  check('chips filled: version + tier + voices', chips.ver === 'v' + chips.version && /^tap: armed/.test(chips.tier) && chips.voices === true, JSON.stringify(chips));

  /* 3. tap armed + its selftest line */
  const tapR = await ev(`(() => {
    const el = document.getElementById('av-taptest');
    let line = null; try { if (el) line = JSON.parse(el.textContent.replace('TAP SELFTEST ', '')); } catch (e) {}
    return { installed: avTap.installed === true,
             onNode: typeof avMasterOnNode === 'function' && avMasterOnNode() === true, line };
  })()`);
  const tap = tapR.value || {};
  check('tap armed (installed + master node)', tap.installed === true && tap.onNode === true, JSON.stringify({ installed: tap.installed, onNode: tap.onNode }));
  check('TAP SELFTEST: viaTap + keysBus + masterNode + live', !!tap.line && tap.line.viaTap === true && tap.line.keysBus === true && tap.line.masterNode === true && tap.line.live >= 1, JSON.stringify(tap.line));

  /* 4. knobs mounted + bound on the LEVELS card */
  const knobsR = await ev(`(() => {
    const els = [...document.querySelectorAll('#av-levels .av-knob[data-knob]')];
    return { n: els.length,
             paths: els.map(e => e.dataset.knob).sort().join(','),
             bound: els.every(e => e.dataset.knobBound === '1'),
             inLevels: els.every(e => !!e.closest('#av-levels')),
             readouts: [...document.querySelectorAll('#av-levels [data-kval]')].map(n => n.textContent).join(' ') };
  })()`);
  const knobs = knobsR.value || {};
  check('two knobs mounted + bound on the LEVELS card', knobs.n === 2 && knobs.paths === 'keys,master' && knobs.bound === true && knobs.inLevels === true, JSON.stringify(knobs));

  /* 5. the async KNOB SELFTEST (?avtest=1) — poll until it lands */
  let kst = null;
  for (let i = 0; i < 40; i++) {
    const r = await ev(`window.__avKnobTest || null`);
    if (r.value) { kst = r.value; break; }
    await sleep(250);
  }
  check('KNOB SELFTEST ok', !!kst && kst.ok === true, JSON.stringify(kst));

  /* 5b. the async ENGINE SELFTEST (?avtest=1) — tier + allocation */
  let est = null;
  for (let i = 0; i < 60; i++) {
    const r = await ev(`window.__avEngineTest || null`);
    if (r.value) { est = r.value; break; }
    await sleep(250);
  }
  check('ENGINE SELFTEST ok (tier + allocation)', !!est && est.ok === true, JSON.stringify(est));

  /* 6. layout sanity at 1440 */
  const layR = await ev(`(() => {
    const vw = window.innerWidth, bad = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 0.5 || r.left < -0.5) bad.push((el.id || el.className || el.tagName) + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']');
    }
    return { scroll: document.documentElement.scrollWidth, inner: vw, bad: bad.slice(0, 6) };
  })()`);
  const lay = layR.value || {};
  check('layout: no horizontal overflow at 1440', lay.scroll <= lay.inner + 1, `scrollWidth ${lay.scroll} vs innerWidth ${lay.inner}` + (lay.bad && lay.bad.length ? ' | offenders: ' + lay.bad.join(' ; ') : ''));

  /* 6b. keyboard + MIDI wired */
  const ioR = await ev(`(() => ({
    keys: document.querySelectorAll('.pk-key').length,
    dock: !!document.getElementById('piano-dock'),
    kbsnap: typeof window.__avKb,
    midi: typeof window.__avMidi,
    midiBody: !!document.querySelector('#av-midi-body .av-midi'),
  }))()`);
  const io = ioR.value || {};
  check('keyboard dock: 61 keys, snap handle, MIDI deck mounted', io.keys === 61 && io.dock === true && io.kbsnap === 'function' && io.midi === 'object' && io.midiBody === true, JSON.stringify(io));

  /* 6c. the P1 SYNTH card + controls */
  const synR = await ev(`(() => {
    const host = document.getElementById('av-synth-knobs');
    const knobs = [...document.querySelectorAll('#av-synth .av-knob[data-knob]')];
    const sels = [...document.querySelectorAll('#av-synth select.av-select')];
    return { host: !!host, knobs: knobs.length, bound: knobs.every(k => k.dataset.knobBound === '1'), sels: sels.length };
  })()`);
  const syn = synR.value || {};
  check('synth card: knobs + selects mounted + bound', syn.host === true && syn.knobs >= 12 && syn.bound === true && syn.sels >= 3, JSON.stringify(syn));

  /* 7. zero page errors */
  check('zero page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { ws.close(); } catch { }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('smoke harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile.replace(/[\\/]/g, '\\\\')}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
