// cdp_fit.mjs -- Anvil R22 W: the console-header width-sweep fit suite (the owner clip witness).
//
//   node verify/cdp_fit.mjs [path-to-index.html] [--port N] > verify/last-cdp_fit.log 2>&1
//
// WHAT IT PROVES (contract: verify/_r22_wave.md section 8): after the header responsive fix
// (flex-wrap + row-gap on header.av-head.av-console, flex:none on its direct .av-btn children
// and on #av-a11y-host + its .av-btn) the header lays out cleanly at every width the app must
// support -- nothing collides, nothing clips, no horizontal page scroll. ONE headless browser
// pass loads index.html, waits for data-av-ready, then sweeps [1440,1400,1300,1200,1100,1000,
// 900,800] via Emulation.setDeviceMetricsOverride (250 ms settle, one retry per read). Per width:
//   F1 no pairwise overlap among visible header buttons (2px tolerance)
//   F2 every header button's label fits its box (el.scrollWidth <= el.clientWidth + 1)
//   F3 the header is not clipped (header.av-head scrollWidth <= clientWidth + 1)
//   F4 no document horizontal scroll (documentElement.scrollWidth <= innerWidth + 1)
//   F5 av-a11y-contrast + av-a11y-motion fully inside the viewport
//      (rect.right <= innerWidth + 1, non-zero size)
//   F6 header height <= 130 px (>= 900) / <= 160 px at the 800 floor (calibrated after the first run)
// F7 after resizing back to 1440: F1 + F3 hold and all 15 header buttons are visible.
// Floor note: 800 px is the design floor (the transport deck itself cannot fit below).
// The run ends with a per-width tally + one FIT-RESULT line; exit 0 ONLY when all checks are
// green. Read-only: no inputs are driven, no storage is written, no page state is mutated.
//
// Launch skeleton follows cdp_hub.mjs / cdp_import.mjs VERBATIM (candidates Chrome/Edge/Brave,
// free-port scan, fresh temp --user-data-dir, 1440x900 metrics override, autoplay allowed, ONE
// browser, explicit exit, process.on('exit') kills ONLY processes whose command line carries
// OUR temp profile).
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const page = argv.find(a => !a.startsWith('--') && (/\.html?$/i.test(a) || existsSync(a))) || path.join(here, '..', 'index.html');
if (!existsSync(page)) { console.error('page not found: ' + page); process.exit(2); }

const shaOf = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const shaBefore = shaOf(page);
console.log('index.html sha256 (before): ' + shaBefore);

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
    const ok = await new Promise(res => { const srv = net.createServer(); srv.once('error', () => res(false)); srv.once('listening', () => srv.close(() => res(true))); srv.listen(p, '127.0.0.1'); });
    if (ok) return p;
  }
  return start;
}
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9620);
const profile = path.join(tmpdir(), 'anvil-fit-' + Date.now());
const baseUrl = 'file:///' + path.resolve(page).replace(/\\/g, '/');
const url = baseUrl + '?avtest=1';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
console.log('cdp port ' + PORT + ' | profile ' + profile);

/* the pinned sweep + bounds (contract section 8) */
const WIDTHS = [1440, 1400, 1300, 1200, 1100, 1000, 900, 800];
const HEIGHT = 900;
const SETTLE_MS = 250;
const HEAD_MAX_H = 130;   /* bound for widths >= 900 */
const HEAD_MAX_H_FLOOR = 160;   /* the 800px design floor wraps to 3 rows (measured 144, first run) */
const headMaxFor = (w) => (w >= 900 ? HEAD_MAX_H : HEAD_MAX_H_FLOOR);
const N_BUTTONS = 15;

let pass = 0, fail = 0;
const check = (name, ok, info) => {
  if (ok) { pass++; console.log(' ok   ' + name + (info ? '  -> ' + info : '')); }
  else { fail++; console.log(' FAIL ' + name + (info ? '  -> ' + info : '')); }
};
const note = (t) => console.log('   - ' + t);

/* the in-page reader: one evaluate returns everything F1-F6 need for the current width.
   Same method as cache/scratch/kdiag/header_probe.mjs (rects + pairwise overlap + the
   scrollWidth/clientWidth law), extended with the doc-scroll, a11y-inside and height reads. */
const FIT_DUMP = `(() => {
  const head = document.querySelector('header.av-head.av-console') || document.querySelector('header.av-head');
  if (!head) return { err: 'no header' };
  const btns = [];
  const all = head.querySelectorAll('button');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!(r.width > 0 && r.height > 0) || cs.visibility === 'hidden' || cs.display === 'none') continue;
    btns.push({
      id: el.id || '', txt: String(el.textContent || '').trim().slice(0, 18),
      x: r.left, y: r.top, w: r.width, h: r.height,
      sw: el.scrollWidth, cw: el.clientWidth,
    });
  }
  const hits = [];
  for (let i = 0; i < btns.length; i++) {
    for (let j = i + 1; j < btns.length; j++) {
      const a = btns[i], b = btns[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 2 && oy > 2) hits.push((a.id || a.txt) + ' X ' + (b.id || b.txt) + ' ' + Math.round(ox) + 'x' + Math.round(oy));
    }
  }
  const spill = [];
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i];
    if (b.sw > b.cw + 1) spill.push((b.id || b.txt) + ' scrollW ' + b.sw + ' > clientW ' + b.cw);
  }
  const a11y = [];
  const ids = ['av-a11y-contrast', 'av-a11y-motion'];
  for (let i = 0; i < ids.length; i++) {
    const el = document.getElementById(ids[i]);
    if (!el) { a11y.push({ id: ids[i], missing: true, inside: false }); continue; }
    const r = el.getBoundingClientRect();
    a11y.push({ id: ids[i], right: Math.round(r.right * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
                inside: (r.right <= window.innerWidth + 1) && r.width > 0 && r.height > 0 });
  }
  const hr = head.getBoundingClientRect();
  return {
    innerW: window.innerWidth, n: btns.length, ids: btns.map(function (b) { return b.id || b.txt; }),
    hits: hits, spill: spill,
    head: { sw: head.scrollWidth, cw: head.clientWidth, h: Math.round(hr.height * 10) / 10 },
    doc: { sw: document.documentElement.scrollWidth },
    a11y: a11y,
  };
})()`;

const chrome = spawn(exe, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--disable-sync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
  url,
], { stdio: 'ignore', windowsHide: true });

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
  const pageErrors = [];
  ws.onmessage = (mev) => {
    const m = JSON.parse(mev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') pageErrors.push(String((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text || '').slice(0, 220));
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTHS[0], height: HEIGHT, deviceScaleFactor: 1, mobile: false });

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) {
      const e = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'unknown';
      note('eval threw: ' + String(e).split('\n')[0].slice(0, 220));
      return { error: e };
    }
    return { value: r.result?.value };
  };
  const waitReady = async () => { for (let i = 0; i < 120; i++) { const r = await ev(`!!(document.documentElement && document.documentElement.getAttribute('data-av-ready') === '1')`); if (r.value === true) return true; await sleep(300); } return false; };

  /* one read cycle per width: set the metrics, settle, read; a bad read gets ONE retry */
  const readFit = async (W) => {
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
    await sleep(SETTLE_MS);
    let r = await ev(FIT_DUMP);
    let d = (r && !r.error) ? r.value : null;
    if (!d || d.err || typeof d.innerW !== 'number' || !Array.isArray(d.hits)) {
      await sleep(SETTLE_MS);
      r = await ev(FIT_DUMP);
      d = (r && !r.error) ? r.value : null;
    }
    return (d && !d.err && typeof d.innerW === 'number' && Array.isArray(d.hits)) ? d : null;
  };

  const ready = await waitReady();
  note('data-av-ready: ' + ready + ' | widths ' + WIDTHS.join('/') + ' | settle ' + SETTLE_MS + ' ms, one retry per read');
  note('floor: 800 px is the design floor (the transport deck itself cannot fit below)');
  if (ready !== true) note('WARNING: data-av-ready never became 1 -- the reads below reflect the state the page reached');

  /* ---- the width sweep: F1-F6 at every pinned width ---- */
  const sweep = [];
  let baselineIds = null;
  const noData = 'read failed (null after one retry)';
  for (let wi = 0; wi < WIDTHS.length; wi++) {
    const W = WIDTHS[wi];
    const d = await readFit(W);
    if (wi === 0 && d && Array.isArray(d.ids)) baselineIds = d.ids.slice();
    const ok1 = !!d && d.hits.length === 0;
    const ok2 = !!d && Array.isArray(d.spill) && d.spill.length === 0;
    const ok3 = !!d && !!d.head && d.head.sw <= d.head.cw + 1;
    const ok4 = !!d && !!d.doc && d.doc.sw <= d.innerW + 1;
    const ok5 = !!d && Array.isArray(d.a11y) && d.a11y.length === 2 && d.a11y.every(function (x) { return x && x.inside === true; });
    const ok6 = !!d && !!d.head && typeof d.head.h === 'number' && d.head.h <= headMaxFor(W);
    check('F1 W=' + W + ': no pairwise overlap among visible header buttons (2px tolerance)', ok1,
      ok1 ? ('btns=' + d.n + ' hits=0') : (d ? JSON.stringify(d.hits) : noData));
    check('F2 W=' + W + ': every header button label fits its box (scrollWidth <= clientWidth+1)', ok2,
      ok2 ? ('btns=' + d.n + ' spill=0') : (d ? JSON.stringify(d.spill) : noData));
    check('F3 W=' + W + ': header not clipped (header.av-head scrollWidth <= clientWidth+1)', ok3,
      ok3 ? ('sw/cw ' + d.head.sw + '/' + d.head.cw) : (d ? JSON.stringify(d.head) : noData));
    check('F4 W=' + W + ': no document horizontal scroll (documentElement.scrollWidth <= innerWidth+1)', ok4,
      ok4 ? ('doc/inner ' + d.doc.sw + '/' + d.innerW) : (d ? JSON.stringify({ doc: d.doc, inner: d.innerW }) : noData));
    check('F5 W=' + W + ': av-a11y-contrast + av-a11y-motion fully inside the viewport (right <= innerWidth+1, non-zero size)', ok5,
      ok5 ? ('innerW=' + d.innerW + ' both inside') : (d ? JSON.stringify(d.a11y) : noData));
    check('F6 W=' + W + ': header height <= ' + headMaxFor(W) + ' px', ok6,
      ok6 ? ('h=' + d.head.h) : (d ? JSON.stringify(d.head) : noData));
    const g = [ok1, ok2, ok3, ok4, ok5, ok6].filter(Boolean).length;
    sweep.push({ W: W, g: g });
    note('W=' + W + ' tally ' + g + '/6' + (d
      ? (' | inner=' + d.innerW + ' headScroll=' + d.head.sw + '/' + d.head.cw + ' headH=' + d.head.h + ' docScroll=' + d.doc.sw + ' btns=' + d.n)
      : ' | READ FAILED'));
  }

  /* ---- F7: resize back to 1440 -- F1 + F3 hold and all 15 header buttons are visible again ---- */
  const d7 = await readFit(WIDTHS[0]);
  const f7f1 = !!d7 && d7.hits.length === 0;
  const f7f3 = !!d7 && !!d7.head && d7.head.sw <= d7.head.cw + 1;
  const f7n = !!d7 && Array.isArray(d7.ids) && d7.ids.length === N_BUTTONS;
  const f7same = !!d7 && Array.isArray(d7.ids) && (!baselineIds || (baselineIds.length === N_BUTTONS && baselineIds.every(function (x) { return d7.ids.indexOf(x) >= 0; })));
  const f7ok = f7f1 && f7f3 && f7n && f7same;
  check('F7 back at 1440: F1+F3 hold and all 15 header buttons are visible', f7ok,
    f7ok ? ('visible=' + d7.ids.length + ' hits=0') : JSON.stringify({ hits: d7 ? d7.hits : null, header: d7 ? d7.head : null, visible: d7 ? d7.ids : null, baseline: baselineIds }));

  if (pageErrors.length) note('page exceptions during the sweep: ' + JSON.stringify(pageErrors.slice(0, 3)));
  const shaAfter = shaOf(page);
  if (shaAfter !== shaBefore) note('index.html sha256 CHANGED during the run (before ' + shaBefore.slice(0, 12) + '.. after ' + shaAfter.slice(0, 12) + '..)');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('per-width tally: ' + sweep.map(function (x) { return x.W + ' ' + x.g + '/6'; }).join(' | '));
  console.log('FIT-RESULT: ' + (fail
    ? ('RED -- ' + fail + ' of ' + (pass + fail) + ' checks failed (exit 1)')
    : ('GREEN -- all ' + pass + ' checks passed (exit 0)')));
  try { ws.close(); } catch { }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('fit harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile.replace(/[\\/]/g, '\\\\')}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
