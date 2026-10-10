// Take the release screenshots from the PACKAGED Anvil app (not a browser, not the source file):
// launch it, drive it to each view over CDP, capture the viewport at 1440x900 into windows/shots/.
//
//   node windows/tools/take_desktop_shots.mjs                 # the staged build
//   node windows/tools/take_desktop_shots.mjs --exe "<path>"  # a different build (e.g. installed)
//   node windows/tools/take_desktop_shots.mjs --cdp 9371 --out <dir>
//
// The three shots (the D wave contract section 4; shot 3 retargeted from the R22 library overlay
// to the SEQUENCER - a visual, well-populated surface):
//   desktop-01-boot     the app right after boot (synth zone, default state)
//   desktop-02-hub      the STORE zone with the import hub card (#av-import) revealed
//   desktop-03-seq      the SEQUENCER with the demo groove loaded (FIRST SOUND): the per-track
//                       step grid, the step editor and the generative tools, mid-groove
//
// Default target is the STAGED exe (windows/stage/Anvil/Anvil.exe): the release flow runs shots
// right after a build, before/without an install. The PF/RS reference tools defaulted to the
// installed path -- named deviation; pass --exe for the installed copy.
//
// Hook naming: same as the desktop rig -- both plausible Anvil prefixes are co-set (AV_* and
// ANVIL_*); extra env vars are inert for a shell that does not read them.
//
// Wide/viewport discipline: Electron has no CDP window resize (Browser.getWindowForTarget is not
// implemented), so the viewport comes from Emulation.setDeviceMetricsOverride plus a
// window-dispatch resize nudge -- the app's own matchMedia mount switch needs the event.
//
// Shot 3 rides the app's own FIRST SOUND control (avLessonFirstRunGo - the first-run strip's
// button): it loads the demo groove and starts the transport. No test fixtures involved.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WIN = path.join(HERE, '..');
const argv = process.argv.slice(2);
const argVal = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const EXE = argVal('--exe', path.join(WIN, 'stage', 'Anvil', 'Anvil.exe'));
const PORT = Number(argVal('--cdp', '9371'));
const OUT = argVal('--out', path.join(WIN, 'shots'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

if (!existsSync(EXE)) { console.error('no app at ' + EXE + ' -- stage it first (windows/tools/build_windows.py)'); process.exit(2); }
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
  if (r.exceptionDetails) return { __ex: String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200) };
  return r.result?.value;
};

try {
  let t = null;
  for (let i = 0; i < 90 && !t; i++) {
    try { t = (await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()).find(x => x.type === 'page' && String(x.url).startsWith('http://127.0.0.1:')) || null; } catch (e) { /* still booting */ }
    if (!t) await sleep(1000);
  }
  if (!t) throw new Error('the app never opened a debug port (check the debug-port hook; is another Anvil already running?)');
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await ev(`window.dispatchEvent(new Event('resize'))`);
  for (let i = 0; i < 120; i++) { if (await ev(`document.documentElement && document.documentElement.getAttribute('data-av-ready') === '1'`) === true) break; await sleep(1000); }
  console.log('ready');

  const shot = async (name) => {
    try { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4, button: 'none' }); } catch (e) { /* nicety */ }
    await sleep(350);
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = path.join(OUT, name + '.png');
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log('shot:', file);
    return file;
  };
  const call = async (expr, tag) => { const r = await ev(expr); console.log(tag + ': ' + JSON.stringify(r)); return r; };

  /* 01 -- boot: the app's default surface, settled after the engine/boot load */
  await sleep(2500);
  await shot('desktop-01-boot');

  /* 02 -- hub: the STORE zone with the import hub card revealed (the app's own zone switch) */
  await call(`(() => { try { if (typeof avZoneShow === 'function') return { ok: avZoneShow('store', { source: 'shots' }) === true }; return { ok: false, why: 'no avZoneShow' }; } catch (e) { return { err: String((e && e.message) || e) }; } })()`, 'store zone');
  await sleep(900);
  await call(`(() => { try { if (typeof avImportUiReveal === 'function') return { ok: avImportUiReveal() === true }; return { ok: false, why: 'no avImportUiReveal' }; } catch (e) { return { err: String((e && e.message) || e) }; } })()`, 'hub reveal');
  await sleep(900);
  await shot('desktop-02-hub');

  /* 03 -- seq: the demo groove in the sequencer. Press the app's own FIRST SOUND control (the
     first-run strip button - loads the demo pattern and starts the transport; no test fixtures),
     open the SEQ zone and capture the per-track step grid, the step editor and the GEN tools
     mid-groove. */
  const demo = await call(`(() => { try { if (typeof avLessonFirstRunGo !== 'function') return { err: 'no avLessonFirstRunGo' }; return avLessonFirstRunGo(); } catch (e) { return { err: String(e) }; } })()`, 'first sound');
  if (!demo || demo.loaded !== true) console.log('WARN: the demo groove did not load');
  await sleep(1600);

  await call(`(() => { try { return { ok: avZoneShow('seq', { source: 'shots' }) === true }; } catch (e) { return { err: String(e) }; } })()`, 'seq zone');
  await sleep(1200);
  console.log('seq playing:', JSON.stringify(await ev(`(typeof avSeqIsPlaying === 'function') ? avSeqIsPlaying() : null`)));

  await shot('desktop-03-seq');

  console.log('--- shell tail ---');
  console.log(out.split(/\r?\n/).filter(Boolean).slice(-4).join('\n'));
} catch (e) {
  console.error('shot run failed:', e && e.message);
  console.error(out.split(/\r?\n/).slice(-10).join('\n'));
  try { await ev('window.close()'); } catch (e2) { /* going down anyway */ }
  await sleep(1500);
  if (proc.exitCode === null) spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  process.exit(1);
}
try { await ev('window.close()'); } catch (e) { /* connection drops as it closes */ }
await sleep(2500);
if (proc.exitCode === null) spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
process.exit(0);
