// Capture the nine zone surfaces from the PACKAGED Anvil app over CDP.
//   node tools/capture_zones.mjs [--exe <path>] [--cdp 9391] [--out <dir>] [--dsf 2]
// Mirrors windows/tools/take_desktop_shots.mjs (same launch + hook + readiness contract).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIDEO = path.join(HERE, '..');
const argv = process.argv.slice(2);
const argVal = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const EXE = argVal('--exe', 'C:/Users/Moddy/anvil/windows/stage/Anvil/Anvil.exe');
const PORT = Number(argVal('--cdp', '9391'));
const OUT = argVal('--out', path.join(VIDEO, 'captures'));
const DSF = Number(argVal('--dsf', '2'));
const ZONES = ['browse', 'perform', 'sound', 'shape', 'sequence', 'effects', 'mix', 'deliver', 'system'];
// Sub-tab chosen per zone (only where the default sub-state is near-empty on a zero-pack install).
const SUBS = Object.fromEntries(argv.filter(a => a.startsWith('--sub')).map(a => a.split('=').slice(1).join('=')).filter(Boolean).map(s => s.split('=')).map(([z, v]) => [z, v]));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

if (!existsSync(EXE)) { console.error('no app at ' + EXE); process.exit(2); }
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

let out = '';
const proc = spawn(EXE, [], {
  env: {
    ...process.env,
    AV_TEST: '1', ANVIL_TEST: '1',
    AV_DEBUG_PORT: String(PORT), ANVIL_DEBUG_PORT: String(PORT),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
proc.stdout.on('data', d => out += d);
proc.stderr.on('data', d => out += d);

let ws, id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) return { __ex: String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300) };
  return r.result?.value;
};

try {
  let t = null;
  for (let i = 0; i < 90 && !t; i++) {
    try { t = (await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()).find(x => x.type === 'page' && String(x.url).startsWith('http://127.0.0.1:')) || null; } catch (e) { /* booting */ }
    if (!t) await sleep(1000);
  }
  if (!t) throw new Error('no debug port (another Anvil already running?)');
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: DSF, mobile: false });
  await sleep(400);
  await ev(`window.dispatchEvent(new Event('resize'))`);
  for (let i = 0; i < 120; i++) { if (await ev(`document.documentElement && document.documentElement.getAttribute('data-av-ready') === '1'`) === true) break; await sleep(1000); }
  console.log('ready', JSON.stringify(await ev(`({w:innerWidth,h:innerHeight,dpr:devicePixelRatio})`)));

  const shot = async (name) => {
    try { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2, button: 'none' }); } catch (e) { /* nicety */ }
    try { await ev(`document.activeElement && document.activeElement.blur && document.activeElement.blur(); 1`); } catch (e) { /* nicety */ }
    await sleep(420);
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = path.join(OUT, 'zone-' + name + '.png');
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log('shot:', file);
  };

  await sleep(2200);
  if (argv.includes('--demo')) {
    const d = await ev(`(() => { try { return (typeof avLessonFirstRunGo === 'function') ? avLessonFirstRunGo() : { err: 'no avLessonFirstRunGo' }; } catch (e) { return { err: String(e) }; } })()`);
    console.log('first sound:', JSON.stringify(d));
    await sleep(1800);
  }
  for (const z of ZONES) {
    const r = await ev(`(() => {
      const b = document.getElementById('av-tab-${z}');
      if (b) { b.click(); return { via: 'tab', ok: true }; }
      if (typeof avZoneShow === 'function') return { via: 'api', ok: avZoneShow('${z}', { source: 'video' }) === true };
      return { ok: false, why: 'no tab, no api' };
    })()`);
    console.log(z, JSON.stringify(r));
    await sleep(900);
    const sub = SUBS[z];
    if (sub) {
      const s = await ev(`(() => { const b = document.querySelector('#av-zone-${z} .av-subtab[data-sub="${sub}"]'); if (!b) return 'no subtab ${sub}'; b.click(); return 'clicked'; })()`);
      console.log('  sub:', sub, s);
      await sleep(900);
    }
    // let the zone's own entrance motion finish before the still
    await ev(`new Promise(res => { let n = 0; const tick = () => { if (++n < 30) requestAnimationFrame(tick); else res(1); }; requestAnimationFrame(tick); })`);
    await shot(z);
  }
  console.log('--- shell tail ---');
  console.log(out.split(/\r?\n/).filter(Boolean).slice(-4).join('\n'));
} catch (e) {
  console.error('capture failed:', e && e.message);
  console.error(out.split(/\r?\n/).slice(-10).join('\n'));
  try { await ev('window.close()'); } catch (e2) { /* going down */ }
  await sleep(1500);
  if (proc.exitCode === null) spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  process.exit(1);
}
try { await ev('window.close()'); } catch (e) { /* connection drops */ }
await sleep(2500);
if (proc.exitCode === null) spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
process.exit(0);
