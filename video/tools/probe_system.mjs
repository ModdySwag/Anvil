// Capture the remaining SYSTEM sub-tabs so the closing frame can be the most composed one.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const EXE = 'C:/Users/Moddy/anvil/windows/stage/Anvil/Anvil.exe';
const PORT = 9395;
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
  await sleep(1500);
  await ev(`document.getElementById('av-tab-system').click(); 1`);
  await sleep(900);

  const shot = async (name) => {
    try { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2, button: 'none' }); } catch (e) { /* nicety */ }
    await ev(`document.activeElement && document.activeElement.blur && document.activeElement.blur(); 1`);
    await sleep(520);
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const f = path.join(OUT, name + '.png'); writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('shot:', f);
  };

  for (const sub of ['code', 'family', 'roadmap']) {
    const r = await ev(`(() => { const b = document.querySelector('#av-zone-system .av-subtab[data-sub="${sub}"]'); if (!b) return 'missing'; b.click(); return 'ok'; })()`);
    console.log(sub, r);
    await sleep(1000);
    await shot('system-' + sub);
  }
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
