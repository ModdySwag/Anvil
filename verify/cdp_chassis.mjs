// cdp_chassis.mjs -- Anvil C1: the chassis rig (plan docs/13-chassis-fsvr.md, contract verify/_c1_wave.md 4).
//
//   node verify/cdp_chassis.mjs [path-to-index.html] [--port N] > verify/last-cdp_chassis.log 2>&1
//
// WHAT IT PROVES -- the C1 chassis is real and is the ONLY navigation:
//   K1 virgin profile: the rail is closed and carries no visible jump links (one navigation)
//   K2 nine tabs, pinned signal order, every aria-controls resolves to a real page
//   K3 band: five groups in contract order, three LCD rows, four pot mounts, exactly one pot-mode key checked
//   K4 inspector: seven kind keys, six core pots, at least eight launchers, both dark screens, EDIT (every launcher target real)
//   K5 a launcher click lands on its page and its sub
//   K6 wheels: pitch springs back to 0 after a drag, mod holds its value
//   K7 density: every page's box scrollHeight <= C1_RATIO x page height at 1440x900 AND 1280x800
//      (C1 bound is 2.2 -- the 1.2 target is C3's page-fill work; the leg reports every ratio either way)
//   K8 reachability: every chrome card sits in a real page and, on a paged page, inside a declared sub
//   K9 zero page errors through the whole run
//   K10 the transport surface survives (play, stop, bpm, preset keys resolve)
// K7's second width also proves the 1180 px inspector collapse path.
//
// Launch skeleton follows cdp_fit.mjs VERBATIM (candidate list, free port, fresh temp profile,
// metrics override, autoplay allowed, ONE browser, explicit exit).
import { spawn } from 'node:child_process';
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
console.log('index.html sha256: ' + createHash('sha256').update(readFileSync(page)).digest('hex'));

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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9660);
const profile = path.join(tmpdir(), 'anvil-chassis-' + Date.now());
const url = 'file:///' + path.resolve(page).replace(/\\/g, '/') + '?avtest=1';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const PAGES = ['browse', 'perform', 'sound', 'shape', 'sequence', 'effects', 'mix', 'deliver', 'system'];
const C1_RATIO = 2.2;
let pass = 0, fail = 0;
const check = (name, ok, info) => {
  if (ok) { pass++; console.log(' ok   ' + name + (info ? '  -> ' + info : '')); }
  else { fail++; console.log(' FAIL ' + name + (info ? '  -> ' + info : '')); }
};
const note = (t) => console.log('   - ' + t);

const chrome = spawn(exe, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--disable-sync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
  url,
], { stdio: 'ignore', windowsHide: true });
process.on('exit', () => { try { chrome.kill(); } catch { /* gone */ } });

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
  const pageErrors = [];
  ws.onmessage = (mev) => {
    const m = JSON.parse(mev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') pageErrors.push(String((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text || '').slice(0, 200));
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) {
      const e = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'unknown';
      note('eval threw: ' + String(e).split('\n')[0].slice(0, 200));
      return { error: e };
    }
    return { value: r.result?.value };
  };
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    const r = await ev(`!!(document.documentElement && document.documentElement.getAttribute('data-av-ready') === '1')`);
    if (r.value === true) ready = true; else await sleep(300);
  }
  note('data-av-ready: ' + ready);
  if (!ready) note('WARNING: data-av-ready never became 1 -- reads reflect the state the page reached');

  /* K1 -- one navigation on a virgin profile */
  const k1 = (await ev(`(() => {
    const rail = document.getElementById('av-rail');
    const links = rail ? [...rail.querySelectorAll('a,button')].filter(e => e.offsetParent !== null && e.getBoundingClientRect().width > 0) : null;
    return { closed: document.body.classList.contains('av-rail-closed'), rail: !!rail, visibleRailCtl: links ? links.length : -1 };
  })()`)).value || {};
  check('K1 virgin: rail closed, no rail control visible (tabs are the one navigation)',
    k1.closed === true && k1.visibleRailCtl === 0, JSON.stringify(k1));

  /* K2 -- the tab bar */
  const k2 = (await ev(`(() => {
    const tabs = [...document.querySelectorAll('.av-zone-tab')];
    return { ids: tabs.map(t => t.dataset.zone), unresolved: tabs.filter(t => !document.getElementById(t.getAttribute('aria-controls'))).map(t => t.id) };
  })()`)).value || {};
  check('K2 nine tabs in the pinned signal order, every aria-controls resolves',
    JSON.stringify(k2.ids) === JSON.stringify(PAGES) && (k2.unresolved || []).length === 0, JSON.stringify(k2));

  /* K3 -- the band */
  const k3 = (await ev(`(() => ({
    grp: [...document.querySelectorAll('.av-band-grp')].map(e => e.getAttribute('data-grp')),
    lcdRows: document.querySelectorAll('#av-lcd .av-lcd-row').length,
    pots: ['a','b','c','d'].filter(k => document.getElementById('av-pot-' + k)).length,
    checked: document.querySelectorAll('#av-potmode [aria-checked="true"]').length,
    vol: !!document.getElementById('av-vol-pot')
  }))()`)).value || {};
  check('K3 band: groups in contract order, LCD rows, four pot mounts, one pot-mode key lit, volume pot',
    JSON.stringify(k3.grp) === JSON.stringify(['transport', 'identity', 'pots', 'view', 'out']) &&
    k3.lcdRows >= 3 && k3.pots === 4 && k3.checked === 1 && k3.vol === true, JSON.stringify(k3));

  /* K4 -- the inspector and every launcher target */
  const k4 = (await ev(`(() => {
    const ls = [...document.querySelectorAll('.av-insp-launch[data-page]')];
    const bad = ls.filter(l => {
      const p = l.dataset.page, s = l.dataset.sub;
      if (!document.getElementById('av-zone-' + p)) return true;
      if (!s) return false;
      return !document.getElementById('av-subpan-' + p + '-' + s);
    }).map(l => l.dataset.page + '/' + (l.dataset.sub || ''));
    return {
      kinds: document.querySelectorAll('.av-kind-key').length,
      pots: document.querySelectorAll('#av-insp-core .av-insp-pot').length,
      launches: ls.length, bad: bad,
      wave: !!document.getElementById('av-insp-wave'), env: !!document.getElementById('av-insp-env'),
      edit: !!document.getElementById('av-insp-edit'), title: (document.getElementById('av-insp-title') || {}).textContent || ''
    };
  })()`)).value || {};
  check('K4 inspector: seven kind keys, six core pots, eight+ launchers on real targets, both screens, EDIT',
    k4.kinds === 7 && k4.pots === 6 && k4.launches >= 8 && (k4.bad || []).length === 0 && k4.wave && k4.env && k4.edit,
    JSON.stringify(k4));

  /* K5 -- a launcher click lands */
  const k5 = (await ev(`(() => {
    const l = document.querySelector('.av-insp-launch[data-page="sound"][data-sub="fm"]');
    if (!l) return { err: 'no launcher' };
    l.click();
    return { zone: window.__avZone.current(), sub: window.__avZone.subCurrent('sound'), shown: !document.getElementById('av-subpan-sound-fm').hidden };
  })()`)).value || {};
  check('K5 launcher click lands page + sub', k5.zone === 'sound' && k5.sub === 'fm' && k5.shown === true, JSON.stringify(k5));

  /* K6 -- wheels: pitch springs back, mod holds */
  const k6 = (await ev(`(() => {
    const w = document.getElementById('av-wheel-pitch');
    const m = document.getElementById('av-wheel-mod');
    if (!w || !m) return { err: 'no wheels' };
    const drag = (el, dy) => {
      const r = el.getBoundingClientRect();
      const o = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.bottom - 6, pointerId: 1 };
      el.dispatchEvent(new PointerEvent('pointerdown', o));
      el.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, o, { clientY: o.clientY - dy })));
      el.dispatchEvent(new PointerEvent('pointerup', o));
    };
    drag(w, 60);
    const pitchAfter = Number(w.getAttribute('aria-valuenow'));
    drag(m, 60);
    const modHeld = Number(m.getAttribute('aria-valuenow'));
    return { pitchAfter: pitchAfter, modHeld: modHeld };
  })()`)).value || {};
  check('K6 pitch wheel springs back to 0; mod wheel holds a raised value',
    k6.pitchAfter === 0 && k6.modHeld > 0.2, JSON.stringify(k6));

  /* K7 -- density at both widths */
  for (const W of [1440, 1280]) {
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(280);
    const d = (await ev(`(() => {
      const out = [];
      const Zn = window.__avZone;
      for (const z of ${JSON.stringify(PAGES)}) {
        Zn.show(z);
        const zn = document.getElementById('av-zone-' + z);
        if (!zn) { out.push({ z: z, missing: true }); continue; }
        const box = zn.querySelector('.av-zone-box');
        out.push({ z: z, h: zn.clientHeight, s: box ? box.scrollHeight : 0 });
      }
      return out;
    })()`)).value || [];
    const over = d.filter(x => x.missing || x.s > x.h * C1_RATIO + 1).map(x => x.z + (x.missing ? ':missing' : ' ' + x.s + '/' + x.h));
    check(`K7 W=${W}: every page within ${C1_RATIO}x the page height`, over.length === 0,
      d.map(x => x.z + '=' + (x.missing ? 'missing' : (x.s / Math.max(1, x.h)).toFixed(2))).join(' '));
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(200);

  /* K8 -- reachability of every card */
  const k8 = (await ev(`(() => {
    const cards = [...document.querySelectorAll('.av-card[id]')].filter(c => c.id !== '');
    const bad = [];
    for (const c of cards) {
      const zn = c.closest('.av-zone');
      if (!zn) { bad.push(c.id + ':nozone'); continue; }
      const z = zn.dataset.zone;
      const subs = [...zn.querySelectorAll('.av-sub[data-sub]')].map(s => s.dataset.sub);
      if (subs.length) {
        const sub = c.closest('.av-sub');
        if (sub && subs.indexOf(sub.dataset.sub) < 0) bad.push(c.id + ':nosub');
      }
    }
    return { n: cards.length, bad: bad };
  })()`)).value || {};
  check('K8 every card sits in a real page (and inside a declared sub on a paged page)',
    k8.n > 20 && (k8.bad || []).length === 0, JSON.stringify({ n: k8.n, bad: (k8.bad || []).slice(0, 8) }));

  /* K10 -- the transport surface */
  const k10 = (await ev(`(() => ['avc-play','avc-stop','avc-bpm','avc-preset-prev','avc-preset-next']
    .filter(id => !document.getElementById(id)))()`)).value || [];
  check('K10 transport surface resolves (play, stop, bpm, preset keys)', k10.length === 0, JSON.stringify(k10));

  /* K11 -- the display: a bezelled instrument LCD with three dot rows and every field */
  const k11 = (await ev(`(() => {
    const bezel = document.getElementById('av-lcd-bezel');
    const lcd = document.getElementById('av-lcd');
    if (!bezel || !lcd) return { err: 'no display' };
    const ids = ['av-lcd-pack','av-lcd-preset','av-lcd-engine','av-lcd-poly','av-lcd-voices','av-lcd-cpu'];
    const rows = [...lcd.querySelectorAll('.av-lcd-row')];
    return {
      rows: rows.length, missing: ids.filter(i => !document.getElementById(i)),
      dots: (getComputedStyle(lcd).backgroundImage || '').indexOf('gradient') >= 0,
      bezelBg: getComputedStyle(bezel).backgroundColor,
      nowrap: rows.every(r => getComputedStyle(r).whiteSpace === 'nowrap'),
      stepsLeft: !!document.getElementById('av-lcd-up') && document.getElementById('av-lcd-up').getBoundingClientRect().left < lcd.getBoundingClientRect().left,
      status: lcd.getAttribute('role')
    };
  })()`)).value || {};
  check('K11 display: bezel + glass, three dot rows, every field id, no wrap, steppers at its left',
    k11.rows === 3 && (k11.missing || []).length === 0 && k11.dots === true && k11.nowrap === true
    && k11.stepsLeft === true && k11.status === 'status', JSON.stringify(k11));

  /* K12 -- the display is live: fields carry values, not placeholders forever */
  const k12 = (await ev(`(() => {
    const t = (i) => (document.getElementById(i) || {}).textContent || '';
    return { eng: t('av-lcd-engine'), poly: t('av-lcd-poly'), voices: t('av-lcd-voices'), cpu: t('av-lcd-cpu'), bpm: t('avc-bpm-val') };
  })()`)).value || {};
  check('K12 display fields read live state (engine kind, poly mode, voices, cpu, tempo)',
    k12.eng.length > 0 && /^(POLY|MONO)/.test(k12.poly) && /^VOICES/.test(k12.voices) && /^CPU/.test(k12.cpu) && /^\d+$/.test(k12.bpm),
    JSON.stringify(k12));

  /* K13 -- the steppers are clickable (nothing paints over them) and step the preset */
  const k13 = (await ev(`(() => {
    const up = document.getElementById('av-lcd-up');
    if (!up) return { err: 'no stepper' };
    const r = up.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    const sel = document.querySelector('#av-lcd-preset select');
    const before = sel ? sel.selectedIndex : null;
    const opts = sel ? sel.options.length : 0;
    up.click();
    const after = sel ? sel.selectedIndex : null;
    return { hit: hit ? hit.id : null, adopted: document.querySelectorAll('#av-lcd-preset select').length,
             opts: opts, before: before, after: after };
  })()`)).value || {};
  check('K13 steppers: nothing paints over them, the bank selects live in the display, a click steps',
    k13.hit === 'av-lcd-up' && k13.adopted === 1 && (k13.opts < 2 || k13.after !== k13.before),
    JSON.stringify(k13));

  /* K9 -- errors last, after every interaction */
  check('K9 zero page errors through the run', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 5)));

  console.log('');
  console.log('CHASSIS-RESULT pass=' + pass + ' fail=' + fail);
  await send('Page.close').catch(() => {});
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('rig failed: ' + (e && e.stack || e)); process.exit(2); });
