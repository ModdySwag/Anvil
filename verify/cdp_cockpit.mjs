// cdp_cockpit.mjs — Anvil R1 cockpit suite: the fixed-window chassis contract.
// Zones + tabs, one zone visible at a time, the page never scrolls, deep links, persistence,
// shortcuts, the reveal seams (__avZoneAuto + the scrollIntoView wrapper), palette zone commands,
// the SHELL SELFTEST proof and the card -> zone map. Launch laws copied from cdp_smoke.mjs
// (new headless Chromium, device metrics 1440x900, temp profile, explicit exit).
//   node verify/cdp_cockpit.mjs [path-to-index.html] [--port N]
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

/* freeze pin: set to the frozen sha after the R1 build; null = unpinned report */
const EXPECT_SHA = 'baf50ba0a7fb488c5449530bbf755a4abd34e578db83cbe628746f49bc021399';

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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9360);
const profile = path.join(tmpdir(), 'anvil-cockpit-' + Date.now());
const url = 'file:///' + path.resolve(page).replace(/\\/g, '/') + '?avtest=1';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const shaOf = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const shaBefore = shaOf(page);
console.log('index.html sha256 (before): ' + shaBefore);

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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return { value: r.result?.value };
  };
  const waitReady = async (tries = 120) => {
    for (let i = 0; i < tries; i++) {
      const r = await ev(`document.documentElement.getAttribute('data-av-ready') === '1'`);
      if (r.value === true) return true;
      await sleep(300);
    }
    return false;
  };

  /* 1. boot */
  let ready = await waitReady();
  check('boot: data-av-ready flips', ready);
  if (!ready) { console.error('APP NOT READY'); process.exit(1); }

  /* 2. tabs + order + one zone shown + default */
  const zR = await ev(`(() => {
    const zones = [...document.querySelectorAll('.av-zone')];
    const tabs = [...document.querySelectorAll('.av-zone-tab')];
    const shown = zones.filter(z => !z.hidden);
    return { zones: zones.length, tabs: tabs.length,
             order: tabs.map(t => t.getAttribute('data-zone')).join(','),
             shown: shown.map(z => z.getAttribute('data-zone')),
             bodyZone: document.body.getAttribute('data-av-zone'),
             sel: tabs.filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.getAttribute('data-zone')).join(','),
             vis: zones.filter(z => z.offsetParent !== null || (!z.hidden && getComputedStyle(z).display !== 'none')).map(z => z.getAttribute('data-zone')).join(',') };
  })()`);
  const z = zR.value || {};
  check('zones: 8 panels + 8 tabs in workflow order', z.zones === 8 && z.tabs === 8 && z.order === 'synth,fx,mod,seq,studio,store,code,system', JSON.stringify({ zones: z.zones, tabs: z.tabs, order: z.order }));
  check('default: exactly one zone rendered (synth) + aria-selected + body[data-av-zone] agree', z.shown.join(',') === 'synth' && z.vis === 'synth' && z.sel === 'synth' && z.bodyZone === 'synth', JSON.stringify(z));

  /* 3. the page cannot scroll (structure + real witness) */
  const noScroll = await ev(`(() => {
    const d = document.scrollingElement || document.documentElement;
    const before = window.scrollY;
    window.scrollTo(0, 500);
    const after = window.scrollY;
    window.scrollTo(0, 0);
    return { doc: d.scrollHeight, client: d.clientHeight, before: before, after: after,
             htmlOverflow: getComputedStyle(document.documentElement).overflowY,
             bodyOverflow: getComputedStyle(document.body).overflowY };
  })()`);
  const ns = noScroll.value || {};
  check('no page scroll: scrollHeight == clientHeight, html+body overflow hidden, scrollTo is a no-op',
    ns.doc <= ns.client + 2 && ns.htmlOverflow === 'hidden' && ns.bodyOverflow === 'hidden' && ns.after === 0 && ns.before === 0,
    JSON.stringify(ns));

  /* 4. card -> zone map (every id lands in its zone) */
  const ZONEMAP = {
    synth: ['av-levels', 'av-synth', 'av-fm', 'av-drums', 'av-sample', 'av-chop', 'av-wt'],
    fx: ['av-fx'], mod: ['av-mod', 'av-lfo'], seq: ['av-seq'],
    studio: ['av-rec', 'av-studio', 'av-sessions', 'av-comp', 'av-mix', 'av-deck', 'av-deliver'],
    store: ['av-store'], code: ['av-code'],
    system: ['av-midi-card', 'av-files', 'av-family'],
  };
  const mapR = await ev(`(() => {
    const map = ${JSON.stringify(ZONEMAP)};
    const bad = []; let n = 0;
    for (const zid of Object.keys(map)) {
      for (const cid of map[zid]) {
        const el = document.getElementById(cid);
        if (!el) { bad.push(cid + ':missing'); continue; }
        const zEl = el.closest('.av-zone');
        const got = zEl ? zEl.getAttribute('data-zone') : null;
        if (got !== zid) bad.push(cid + ':' + got); else n++;
      }
    }
    const fr = document.getElementById('av-firstrun');
    const frZone = fr ? (fr.closest('.av-zone') || {}).getAttribute : null;
    return { n: n, bad: bad, firstrun: fr ? (fr.closest('.av-zone') ? fr.closest('.av-zone').getAttribute('data-zone') : 'nozone') : 'absent',
             aboutHost: !!(document.getElementById('av-about-pop') && document.getElementById('av-about-pop').hidden === true && document.getElementById('av-about-pop').querySelector('h1') && document.getElementById('av-head-about')) };
  })()`);
  const mp = mapR.value || {};
  check('card map: every card id sits in its pinned zone (23/23)', mp.n === 23 && (mp.bad || []).length === 0, JSON.stringify({ n: mp.n, bad: mp.bad }));
  check('special: first-run strip lives in synth; the about notes live in the header popover (hidden at rest)',
    (mp.firstrun === 'synth') && mp.aboutHost === true, JSON.stringify({ firstrun: mp.firstrun, about: mp.aboutHost }));

  /* 5. tab click switches (and only one stays shown) */
  const clickR = await ev(`(() => {
    document.getElementById('av-tab-studio').click();
    const shown = [...document.querySelectorAll('.av-zone')].filter(x => !x.hidden).map(x => x.getAttribute('data-zone'));
    const sel = [...document.querySelectorAll('.av-zone-tab')].filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.getAttribute('data-zone'));
    return { shown: shown, sel: sel, bodyZone: document.body.getAttribute('data-av-zone'),
             synthHidden: document.getElementById('av-zone-synth').hidden === true };
  })()`);
  const cr = clickR.value || {};
  check('tab click: studio comes up alone (synth hides, aria follows, body[data-av-zone] follows)',
    cr.shown.join(',') === 'studio' && cr.sel.join(',') === 'studio' && cr.synthHidden === true && cr.bodyZone === 'studio', JSON.stringify(cr));

  /* 6. internal pane scroll only */
  const scrollR = await ev(`(() => {
    const p = document.getElementById('av-zone-studio');
    p.scrollTop = 140;
    const st = p.scrollTop;
    const win = window.scrollY;
    p.scrollTop = 0;
    return { st: st, win: win, doc: (document.scrollingElement||document.documentElement).scrollHeight };
  })()`);
  const sc = scrollR.value || {};
  check('pane scroll: the zone scrolls internally (scrollTop > 0) while the window stays at 0',
    sc.st > 0 && sc.win === 0, JSON.stringify(sc));

  /* 7. Alt+3 keyboard shortcut -> mod */
  await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 1, windowsVirtualKeyCode: 51, code: 'Digit3', key: '3' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 1, windowsVirtualKeyCode: 51, code: 'Digit3', key: '3' });
  await sleep(120);
  const altR = await ev(`(() => ({ zone: window.__avZone.current(), shown: [...document.querySelectorAll('.av-zone')].filter(x => !x.hidden).map(x => x.getAttribute('data-zone')) }))()`);
  const alt = altR.value || {};
  check('shortcut: Alt+3 switches to the mod zone', alt.zone === 'mod' && alt.shown.join(',') === 'mod', JSON.stringify(alt));

  /* 8. reveal seams: __avZoneAuto + the scrollIntoView wrapper */
  const seamR = await ev(`(() => {
    const ok = window.__avZoneAuto('#av-mix');
    const zone1 = window.__avZone.current();
    const seq = document.getElementById('av-seq');
    if (seq && seq.scrollIntoView) seq.scrollIntoView({ block: 'start' });
    const zone2 = window.__avZone.current();
    return { ok: ok, zone1: zone1, zone2: zone2 };
  })()`);
  const seam = seamR.value || {};
  check('seams: __avZoneAuto(#av-mix) reveals studio; scrollIntoView on a hidden-zone element reveals seq',
    seam.ok === true && seam.zone1 === 'studio' && seam.zone2 === 'seq', JSON.stringify(seam));

  /* 9. facade edges */
  const edgeR = await ev(`(() => ({
    list: window.__avZone.list().join(','),
    bad: window.__avZone.show('nope'),
    autoMissing: window.__avZoneAuto('#av-does-not-exist'),
  }))()`);
  const edge = edgeR.value || {};
  check('facade: list() = the 8 ids; unknown zone refused; missing selector refused without throwing',
    edge.list === 'synth,fx,mod,seq,studio,store,code,system' && edge.bad === false && edge.autoMissing === false, JSON.stringify(edge));

  /* 10. palette zone commands registered */
  const palR = await ev(`(() => {
    try {
      const fn = (typeof avPaletteCommands === 'function') ? avPaletteCommands : null;
      if (!fn) return { fn: false };
      const r = fn();
      const arr = Array.isArray(r) ? r : (r && Array.isArray(r.rows) ? r.rows : (r && Array.isArray(r.commands) ? r.commands : []));
      const ids = arr.map(c => String(c && c.id || ''));
      return { fn: true, n: arr.length, zones: ids.filter(i => i.indexOf('zone.') === 0).length,
               hasSystem: ids.indexOf('zone.system') >= 0 };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  const pal = palR.value || {};
  check('palette: the Zones group is registered (8 zone commands incl. zone.system)', pal.fn === true && pal.zones === 8 && pal.hasSystem === true, JSON.stringify(pal));

  /* 11. proof line */
  const prR = await ev(`(() => { try { const el = document.getElementById('av-shelltest'); return el ? el.textContent : null; } catch (e) { return null; } })()`);
  let proof = null;
  try { proof = prR.value ? JSON.parse(String(prR.value).replace('SHELL SELFTEST ', '')) : null; } catch (e) { proof = null; }
  check('proof: SHELL SELFTEST line present and sane (?avtest=1)', !!proof && proof.ready === true && proof.zones === 8 && typeof proof.active === 'string', JSON.stringify(proof));

  /* 12. persistence across reload */
  await ev(`window.__avZone.show('code', { source: 'rig' })`);
  await send('Page.navigate', { url });
  let ready2 = await waitReady();
  const persR = await ev(`(() => ({ zone: window.__avZone ? window.__avZone.current() : null, ready: document.documentElement.getAttribute('data-av-ready') }))()`);
  const pers = persR.value || {};
  check('persistence: reload restores the last zone (code)', ready2 === true && pers.zone === 'code', JSON.stringify(pers));

  /* 13. deep link ?z= wins where present */
  await send('Page.navigate', { url: url + '&z=system' });
  let ready3 = await waitReady();
  const deepR = await ev(`(() => ({ zone: window.__avZone ? window.__avZone.current() : null, shown: [...document.querySelectorAll('.av-zone')].filter(x => !x.hidden).map(x => x.getAttribute('data-zone')).join(',') }))()`);
  const deep = deepR.value || {};
  check('deep link: ?z=system boots into the system zone', ready3 === true && deep.zone === 'system' && deep.shown === 'system', JSON.stringify(deep));

  /* 14. one zone shown invariant after all switching */
  const invR = await ev(`(() => {
    const shown = [...document.querySelectorAll('.av-zone')].filter(x => !x.hidden);
    const tabsSel = [...document.querySelectorAll('.av-zone-tab')].filter(t => t.getAttribute('aria-selected') === 'true');
    return { shown: shown.length, tabsSel: tabsSel.length, zone: window.__avZone.current() };
  })()`);
  const inv = invR.value || {};
  check('invariant: exactly one zone + one selected tab at rest', inv.shown === 1 && inv.tabsSel === 1, JSON.stringify(inv));

  /* 14b. R3 workspace: float panels — open, move, resize, persist, restore; About toggle */
  /* rig SPEC note: style writes to a fixed panel reflect in getBoundingClientRect one frame later
     in the headless compositor (offsetLeft/style read correctly in-task; the rect needs a frame) —
     settle two rAFs before reading, then the geometry is exact. */
  const flR = await ev(`(async () => {
    const ok1 = window.__avPanels.open('av-mix');
    const p = document.getElementById('av-float-av-mix');
    const inPanel = !!(p && p.querySelector('#av-mix'));
    window.__avPanels.move('av-mix', 120, 150);
    window.__avPanels.resize('av-mix', 500, 360);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const r = p.getBoundingClientRect();
    const saved = JSON.parse(localStorage.getItem('av-float') || '{}');
    window.__avPanels.close('av-mix');
    const home = !!document.querySelector('#av-zone-studio #av-mix');
    const gone = !document.getElementById('av-float-av-mix');
    return { ok1: ok1, inPanel: inPanel, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width),
             saved: !!(saved['av-mix']), home: home, gone: gone, list: window.__avPanels.list().length };
  })()`);
  const fl = flR.value || {};
  check('R3 float: open moves the card into a floating panel; move+resize persist; close restores it to its zone',
    fl.ok1 === true && fl.inPanel === true && fl.x === 120 && fl.y === 150 && fl.w === 500 && fl.saved === true && fl.home === true && fl.gone === true, JSON.stringify(fl));

  const fl2R = await ev(`(() => {
    window.__avPanels.open('av-fx'); window.__avPanels.open('av-synth');
    const n = window.__avPanels.list().length;
    const fx = document.getElementById('av-float-av-fx');
    const z = fx ? fx.style.zIndex : null;
    window.__avPanels.reset();
    const after = window.__avPanels.list().length;
    const home = !!document.querySelector('#av-zone-fx #av-fx');
    return { n: n, z: z, after: after, home: home };
  })()`);
  const fl2 = fl2R.value || {};
  check('R3 float: two panels coexist with z-order set; reset() brings everything home',
    fl2.n === 2 && fl2.z !== null && fl2.z !== '' && fl2.after === 0 && fl2.home === true, JSON.stringify(fl2));

  const abR = await ev(`(() => {
    const b = document.getElementById('av-head-about');
    b.click();
    const el = document.getElementById('av-about-pop');
    const open = el.hidden === false;
    b.click();
    return { open: open, closed: el.hidden === true, hasH1: !!el.querySelector('h1') };
  })()`);
  const ab = abR.value || {};
  check('R3 about: the header About button toggles the phase-notes popover (moved out of the page)',
    ab.open === true && ab.closed === true && ab.hasH1 === true, JSON.stringify(ab));

  /* 15. zero page errors */
  check('zero page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* 16. freeze sha */
  const shaAfter = shaOf(page);
  if (EXPECT_SHA) check('freeze: index.html sha256 = pinned', shaBefore === EXPECT_SHA && shaAfter === EXPECT_SHA, 'pinned ' + String(EXPECT_SHA).slice(0, 12) + '...');
  else { console.log('note: EXPECT_SHA not pinned yet (set after the R1 freeze) — sha ' + shaBefore.slice(0, 12) + '...'); pass++; }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { ws.close(); } catch { /* done */ }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('cockpit harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    const tag = path.basename(profile);
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
