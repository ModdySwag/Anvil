// One-off probe: what sub-tabs exist per zone, and capture the populated PERFORM states.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const EXE = 'C:/Users/Moddy/anvil/windows/stage/Anvil/Anvil.exe';
const PORT = 9393;
const OUT = 'C:/Users/Moddy/anvil/video/captures-probe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

let out = '';
const proc = spawn(EXE, [], { env: { ...process.env, AV_TEST: '1', ANVIL_TEST: '1', AV_DEBUG_PORT: String(PORT), ANVIL_DEBUG_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
proc.stdout.on('data', d => out += d); proc.stderr.on('data', d => out += d);
let ws, id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) return { __ex: String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300) }; return r.result?.value; };

try {
  let t = null;
  for (let i = 0; i < 90 && !t; i++) {
    try { t = (await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()).find(x => x.type === 'page' && String(x.url).startsWith('http://127.0.0.1:')) || null; } catch (e) { /* booting */ }
    if (!t) await sleep(1000);
  }
  if (!t) throw new Error('no debug port');
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await sleep(400); await ev(`window.dispatchEvent(new Event('resize'))`);
  for (let i = 0; i < 120; i++) { if (await ev(`document.documentElement.getAttribute('data-av-ready') === '1'`) === true) break; await sleep(1000); }
  await sleep(1500);
  await ev(`(typeof avLessonFirstRunGo === 'function') ? avLessonFirstRunGo() : null`);
  await sleep(1600);

  const subs = await ev(`(() => {
    const zones = [...document.querySelectorAll('[data-zone]')].map(z => z.getAttribute('data-zone'));
    const out = { zones, subs: {} };
    for (const z of zones) {
      const host = document.getElementById('av-zone-' + z);
      out.subs[z] = host ? [...host.querySelectorAll('.av-subtab')].map(b => b.getAttribute('data-sub')) : null;
    }
    return out;
  })()`);
  console.log(JSON.stringify(subs, null, 1));

  const shot = async (name) => { await sleep(500); const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); const f = path.join(OUT, name + '.png'); writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('shot:', f); };

  await ev(`document.getElementById('av-tab-perform').click(); 1`);
  await sleep(900);
  const r1 = await ev(`(() => { const b = document.querySelector('#av-zone-perform .av-subtab[data-sub="voice"]'); if (!b) return 'no voice subtab'; b.click(); return 'clicked'; })()`);
  console.log('voice sub:', r1);
  await sleep(1100);
  await shot('perform-voice');

  await ev(`document.getElementById('av-tab-system').click(); 1`);
  await sleep(900);
  const r2 = await ev(`(() => { const b = document.querySelector('#av-zone-system .av-subtab[data-sub="project"]'); if (!b) return 'no project subtab'; b.click(); return 'clicked'; })()`);
  console.log('system project sub:', r2);
  await sleep(1100);
  await shot('system-project');
} catch (e) {
  console.error('probe failed:', e && e.message);
  try { await ev('window.close()'); } catch (e2) { /* going down */ }
  await sleep(1500);
  if (proc.exitCode === null) spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  process.exit(1);
}
try { await ev('window.close()'); } catch (e) { /* drops */ }
await sleep(2500);
if (proc.exitCode === null) spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
process.exit(0);
