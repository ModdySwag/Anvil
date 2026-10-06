// cdp_shot.mjs — one-shot headless screenshot of the built page (parent visual checks).
//   node verify/cdp_shot.mjs [page.html] [out.png] [--w 1440] [--h 900] [--tall 1400] [--wait 700]
// Launches Edge/Chrome headless, waits for data-av-ready, captures the viewport; --tall N also
// captures a second shot at height N (<out>-tall.png). Temp profile, explicit exit, own-profile kill.
import { spawn, execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf('--' + name); return i > -1 ? Number(argv[i + 1]) : dflt; };
const page = argv.find(a => !a.startsWith('--') && /\.html?$/i.test(a)) || path.join(here, '..', 'index.html');
const outArg = argv.find(a => /\.png$/i.test(a));
if (!existsSync(page)) { console.error('page not found: ' + page); process.exit(2); }
const W = flag('w', 1440), H = flag('h', 900), TALL = flag('tall', 0), WAIT = flag('wait', 700);

const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
];
const exe = candidates.find(existsSync);
if (!exe) { console.error('no chromium found'); process.exit(2); }

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
const PORT = await freePort(9700);
const profile = path.join(tmpdir(), 'anvil-shot-' + Date.now());
const url = 'file:///' + path.resolve(page).replace(/\\/g, '/');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const chrome = spawn(exe, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--disable-sync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', `--window-size=${W},${H}`, '--mute-audio',
  url,
], { stdio: 'ignore', windowsHide: true });

async function main() {
  let target = null;
  for (let i = 0; i < 150 && !target; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) target = (await r.json()).find(t => t.type === 'page' && String(t.url).startsWith('file://'));
    } catch { /* booting */ }
    if (!target) await sleep(200);
  }
  if (!target) { console.error('no file page target'); process.exit(2); }
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
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const r = await send('Runtime.evaluate', { expression: `document.documentElement.getAttribute('data-av-ready') === '1'`, returnByValue: true });
    if (r.result?.value === true) { ready = true; break; }
    await sleep(300);
  }
  if (!ready) console.error('WARN: data-av-ready not seen; shooting anyway');
  await sleep(WAIT);
  const out = outArg ? path.resolve(outArg) : path.join(here, '..', 'renders', 'shot.png');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('shot -> ' + out + '  (' + W + 'x' + H + ')');
  if (TALL > 0) {
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: TALL, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    const out2 = out.replace(/\.png$/i, '-tall.png');
    const shot2 = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(out2, Buffer.from(shot2.data, 'base64'));
    console.log('shot -> ' + out2 + '  (' + W + 'x' + TALL + ')');
  }
  try { ws.close(); } catch { }
  process.exit(0);
}

main().catch(err => { console.error('shot crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile.replace(/[\\/]/g, '\\\\')}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
