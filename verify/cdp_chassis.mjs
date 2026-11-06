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
//   K15 the two screens are editable (drags write through the param funnel)
//   K16 the kind keys are live: a key writes engine.kind, the synth select and the LCD follow
//   K17 the six core pots are live: drags on CUTOFF and LEVEL write the real engine paths
//   K18 POLY/MONO is a live voice mode: env.mono reaches the engine, mono keeps one voice per channel
//   K19 the scope and LEVEL see the engine: a sounding note inks the scope, LEVEL scales the tap
//   K20 the oscillator screen draws the live wavetable frame of an installed table (C2)
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

  /* K14 -- the voice screens are real drawing surfaces with live data (not empty boxes) */
  const k14 = (await ev(`(() => {
    const ink = (id) => {
      const c = document.querySelector('#' + id + ' canvas');
      if (!c) return -1;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
      return n;
    };
    return { wave: ink('av-insp-wave'), filter: ink('av-insp-filter'), env: ink('av-insp-env'),
             flab: (document.getElementById('av-insp-filter-lab') || {}).textContent || '',
             elab: (document.getElementById('av-insp-env-lab') || {}).textContent || '' };
  })()`)).value || {};
  check('K14 voice screens draw real data (oscillator, filter response with a live corner label, envelope with its time)',
    k14.wave > 500 && k14.filter > 500 && k14.env > 500 && /^LP /.test(k14.flab) && k14.elab.length > 0,
    JSON.stringify(k14));

  /* K15 -- the two screens are editable: a drag writes through the param funnel */
  const k15 = (await ev(`(() => {
    const drag = (id, fx, fy, pid) => {
      const c = document.querySelector('#' + id + ' canvas');
      if (!c) return false;
      const r = c.getBoundingClientRect();
      const o = { bubbles: true, pointerId: pid, clientX: r.left + r.width * fx, clientY: r.top + r.height * (1 - fy) };
      c.dispatchEvent(new PointerEvent('pointerdown', o));
      c.dispatchEvent(new PointerEvent('pointermove', o));
      c.dispatchEvent(new PointerEvent('pointerup', o));
      return true;
    };
    const c0 = Number(avParams['filter.cutoff']), a0 = Number(avParams['env1.a']);
    drag('av-insp-filter', 0.8, 0.8, 11);
    drag('av-insp-env', 0.12, 0.5, 12);
    return { c0: c0, c1: Number(avParams['filter.cutoff']), r1: Number(avParams['filter.reso']),
             a0: a0, a1: Number(avParams['env1.a']) };
  })()`)).value || {};
  check('K15 the screens edit: a drag on the filter moves cutoff + reso, a drag on the envelope moves attack',
    k15.c1 !== k15.c0 && k15.r1 > 0.5 && k15.a1 !== k15.a0, JSON.stringify(k15));

  /* K16 -- the kind keys are LIVE: a key writes engine.kind through the synth card's own commit */
  const k16 = (await ev(`(async () => {
    const click = (k) => { const b = document.querySelector('.av-kind-key[data-kind="' + k + '"]'); if (!b) return false; b.click(); return true; };
    const read = () => ({
      param: String((typeof avParams !== 'undefined' && avParams['engine.kind']) || ''),
      sel: (document.getElementById('av-synth-engine') || {}).value || '',
      lcd: (document.getElementById('av-lcd-engine') || {}).textContent || '',
      lit: Array.from(document.querySelectorAll('#av-insp-kinds .av-kind-key')).filter(b => b.getAttribute('aria-checked') === 'true').map(b => b.getAttribute('data-kind'))
    });
    const open = read();
    const okClick = click('fm');
    await new Promise(r => setTimeout(r, 400));
    const fm = read();
    click('wavetable');
    await new Promise(r => setTimeout(r, 400));
    const back = read();
    return { okClick, open, fm, back };
  })()`)).value || {};
  check('K16 kind keys drive the engine kind (param + synth select + LCD + lit key)',
    k16.okClick === true && k16.fm.param === 'fm' && k16.fm.sel === 'fm' && /^FM/.test(k16.fm.lcd)
    && k16.fm.lit.length === 1 && k16.fm.lit[0] === 'fm' && k16.back.param === 'va' && k16.back.sel === 'va',
    JSON.stringify(k16));

  /* K17 -- the six core pots are LIVE: a real drag on CUTOFF and LEVEL writes the real paths */
  const k17 = (await ev(`(async () => {
    const drag = (id, dy) => {
      const mount = document.getElementById(id);
      const el = mount ? mount.querySelector('.av-knob[data-knob]') : null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const o = (yy) => ({ bubbles: true, pointerId: 21, clientX: x, clientY: yy, button: 0, buttons: 1 });
      el.dispatchEvent(new PointerEvent('pointerdown', o(y)));
      for (let i = 1; i <= 8; i++) el.dispatchEvent(new PointerEvent('pointermove', o(y + (dy * i) / 8)));
      el.dispatchEvent(new PointerEvent('pointerup', o(y + dy)));
      return el.getAttribute('data-knob');
    };
    const c0 = Number(avParams['filter.cutoff']);
    const l0 = Number(avParams['engine.outScale']);
    const pathC = drag('av-insp-cutoff', -60);
    const pathL = drag('av-insp-level', -40);
    let c1 = c0, l1 = l0;
    for (let i = 0; i < 40 && (c1 === c0 || l1 === l0); i++) {
      await new Promise(r => setTimeout(r, 100));
      c1 = Number(avParams['filter.cutoff']); l1 = Number(avParams['engine.outScale']);
    }
    const num = (document.querySelector('#av-insp-cutoff .av-insp-num') || {}).textContent || '';
    return { pathC, pathL, c0, c1, l0, l1, num };
  })()`)).value || {};
  check('K17 core pots are live: drags on CUTOFF and LEVEL write filter.cutoff and engine.outScale',
    k17.pathC === 'filter.cutoff' && k17.pathL === 'engine.outScale'
    && isFinite(k17.c1) && k17.c1 !== k17.c0 && isFinite(k17.l1) && k17.l1 !== k17.l0,
    JSON.stringify(k17));

  /* K18 -- the POLY/MONO pair is a real control: env.mono lands on the engine, which keeps one
     voice per channel (two held notes -> active 1 in mono, 2 in poly) */
  const k18 = (await ev(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const h = await avEngineEnsure();
    if (!h) return { engine: false };
    const stats = async () => { try { return (await h.stats()) || {}; } catch (e) { return {}; } };
    const key = (m) => { const b = document.querySelector('.av-pair-key[data-poly="' + m + '"]'); if (!b) return false; b.click(); return true; };
    h.allOff(); await sleep(250);
    key('poly'); await sleep(150);
    const envPoly = Number(avParams['env.mono']);
    h.noteOn(60, 0.8); h.noteOn(64, 0.8);
    const poly = await stats();
    h.allOff(); await sleep(400);
    const clicked = key('mono'); await sleep(200);
    const envMono = Number(avParams['env.mono']);
    let lcd = '', lit = '';
    for (let i = 0; i < 25; i++) {
      lcd = (document.getElementById('av-lcd-poly') || {}).textContent || '';
      const on = document.querySelector('#av-insp-poly .av-pair-key[aria-checked="true"]');
      lit = on && on.getAttribute ? on.getAttribute('data-poly') : '';
      if (/^MONO/.test(lcd) && lit === 'mono') break;
      await sleep(100);
    }
    h.noteOn(60, 0.8); h.noteOn(64, 0.8);
    const mono2 = await stats();
    h.noteOff(64); await sleep(400);
    const back1 = await stats();
    h.noteOff(60); await sleep(500);
    const rel = await stats();
    h.allOff(); await sleep(300);
    key('poly'); await sleep(200);
    const restored = Number(avParams['env.mono']);
    return { engine: true, envPoly, poly: poly.active, statsMono: mono2.mono, mono2: mono2.active,
             clicked, envMono, lcd, lit, back1: back1.active, rel: rel.active, restored };
  })()`)).value || {};
  check('K18 POLY/MONO is a live voice mode (mono keeps one voice per channel, held notes return)',
    k18.engine === true && k18.envPoly === 0 && k18.poly === 2 && k18.clicked === true && k18.envMono === 1
    && /^MONO/.test(k18.lcd) && k18.lit === 'mono' && k18.statsMono === 1 && k18.mono2 === 1
    && k18.back1 === 1 && k18.rel === 0 && k18.restored === 0,
    JSON.stringify(k18));

  /* K19 -- the scope and the LEVEL pot see the live engine: a note inks the scope, LEVEL scales it */
  const k19 = (await ev(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const h = await avEngineEnsure();
    if (!h) return { engine: false };
    const read = () => {
      const c = document.getElementById('av-insp-scope');
      if (!c) return { ink: -1, spread: -1 };
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let ink = 0, spread = 0;
      /* the glass is #0a0c0f and the grid is 7% white; the trace is the accent — count
         pixels whose luminance clears 60 and measure how far they leave the centre line */
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        if (d[i + 3] > 8 && lum > 60) { ink++; const s = Math.abs(y - c.height / 2); if (s > spread) spread = s; }
      }
      return { ink: ink, spread: spread };
    };
    const rms = () => {
      const a = avTap && avTap.analyserL;
      if (!a) return -1;
      const b = new Uint8Array(a.fftSize);
      a.getByteTimeDomainData(b);
      let s = 0; for (let i = 0; i < b.length; i++) { const v = (b[i] - 128) / 128; s += v * v; }
      return Math.sqrt(s / b.length);
    };
    h.allOff(); await sleep(700);
    const silent = read(), r0 = rms();
    avApplyParam('engine.outScale', 1);
    h.noteOn(57, 0.9); await sleep(900);
    const loud = read(), r1 = rms();
    avApplyParam('engine.outScale', 0.05); await sleep(900);
    const r2 = rms();
    h.allOff(); await sleep(300);
    avApplyParam('engine.outScale', 0.25);
    return { engine: true, silent, loud, r0, r1, r2 };
  })()`)).value || {};
  check('K19 scope + LEVEL are live: a sounding note inks the scope and the LEVEL pot scales the master tap',
    k19.engine === true && k19.loud.spread > k19.silent.spread + 2 && k19.loud.ink > k19.silent.ink
    && k19.r1 > Math.max(0.004, k19.r0 * 4) && k19.r2 < k19.r1 / 1.5,
    JSON.stringify(k19));

  /* K20 -- the oscillator screen draws the LIVE wavetable frame (C2): install a user table, point
     osc2 at it, and the screen reports the table + frame it is drawing */
  const k20 = (await ev(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const h = await avEngineEnsure();
    if (!h || !window.__avWt) return { engine: false };
    const el = document.querySelector('#av-insp-wave canvas');
    const prevType = String(avParams['osc2.type'] == null ? '' : avParams['osc2.type']);
    const snap = __avWt.snap();
    if (!el || !snap || !snap.freeSlots || !snap.freeSlots.length) return { engine: true, noSlot: true };
    const slot = snap.freeSlots[0];
    const t = __avWt.newTable('C2 RIG TABLE');
    const ins = __avWt.install(t, slot);
    const before = { shape: el.getAttribute('data-shape'), wt: el.getAttribute('data-wt') || '' };
    avApplyParam('osc2.type', 'wt.user' + slot);
    avApplyParam('osc2.level', 0.7);
    avApplyParam('engine.kind', 'va');
    await sleep(800);
    const after = { shape: el.getAttribute('data-shape'), wt: el.getAttribute('data-wt') || '' };
    let ink = 0;
    const cv = el;
    if (cv) {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        if (lum > 60) ink++;
      }
    }
    avApplyParam('osc2.type', prevType || 'saw');
    avApplyParam('osc2.level', 0.5);
    return { engine: true, ok: ins && ins.ok === true, slot: slot, before: before, after: after, ink: ink };
  })()`)).value || {};
  check('K20 the oscillator screen draws the live wavetable frame of the installed table',
    k20.engine === true && k20.ok === true && k20.after.shape === 'wt'
    && /^C2 RIG TABLE #1\//.test(k20.after.wt) && k20.ink > 200,
    JSON.stringify(k20));

  /* K21 -- the band FITS: every group carries its own content and the strip never
     overflows. C2b: `pots` was the only shrinkable group, so it absorbed the whole
     shortfall and collapsed to 20px while its caps spilled. This leg pins the law. */
  const k21 = (await ev(`(() => {
    const band = document.getElementById('av-band');
    const grps = Array.from(document.querySelectorAll('#av-band .av-band-grp')).map(g => ({
      grp: g.getAttribute('data-grp'), cw: g.clientWidth, sw: g.scrollWidth
    }));
    return { band: { cw: band ? band.clientWidth : -1, sw: band ? band.scrollWidth : -1 }, grps: grps };
  })()`)).value || {};
  const badGrp = (k21.grps || []).filter(g => g.sw > g.cw + 1).map(g => g.grp + ' ' + g.sw + '>' + g.cw);
  check('K21 band fit: every group carries its content and the strip does not overflow',
    k21.band && k21.band.sw <= k21.band.cw + 1 && badGrp.length === 0,
    JSON.stringify({ band: k21.band, clipped: badGrp }));

  /* K22 -- the GLASS fits: every row and every field inside it at both widths, no field
     ellipsized, the tempo painted clear of the glass edge. C2b: row 3 ran 173px into 147
     because three C1 rules still shaped data fields (the green leading-label paint, the
     tempo's transport-window box, an absolute-pinned POLY). The band leg (K21) cannot see
     this: the glass fits its group while its own content spills. Pin the row budget here. */
  for (const W of [1440, 1280]) {
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(260);
    const k22 = (await ev(`(() => {
      const lcd = document.getElementById('av-lcd');
      const rows = Array.from(lcd.querySelectorAll('.av-lcd-row'));
      const painted = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
      const slot = (id) => {
        const el = document.getElementById(id);
        if (!el) return { id: id, missing: true };
        return { id: id, cw: el.clientWidth, sw: el.scrollWidth, display: getComputedStyle(el).display };
      };
      const val = document.getElementById('avc-bpm-val');
      const g = lcd.getBoundingClientRect();
      return {
        glass: { right: g.right, padR: parseFloat(getComputedStyle(lcd).paddingRight) || 0 },
        rows: rows.map((r) => ({ cw: r.clientWidth, sw: r.scrollWidth })),
        slots: [slot('av-lcd-voices'), slot('av-lcd-cpu')],
        tempo: val ? { right: painted(val).right, w: painted(val).width } : null
      };
    })()`)).value || {};
    const badRow = (k22.rows || []).filter((r) => r.sw > r.cw + 1).map((r) => r.sw + '>' + r.cw);
    const badSlot = (k22.slots || []).filter((s) => s.missing || s.display === 'none' || s.sw > s.cw + 1)
      .map((s) => s.id + (s.missing ? ':missing' : (s.display === 'none' ? ':hidden' : '=' + s.sw + '/' + s.cw)));
    const glassR = k22.glass ? k22.glass.right : 0;
    const inside = k22.tempo ? glassR - k22.tempo.right : -1;
    check('K22 W=' + W + ': glass rows + fields fit, tempo inside the glass',
      badRow.length === 0 && badSlot.length === 0 && k22.tempo !== null && inside >= 1,
      JSON.stringify({ rows: k22.rows, badRow: badRow, badSlot: badSlot, tempoRight: k22.tempo && +k22.tempo.right.toFixed(1), glassRight: +glassR.toFixed(1), inside: +inside.toFixed(1) }));
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(200);

  /* K23 -- the density gate (docs/13 s.7): a page/sub view that C3 has CLAIMED renders within
     1.2x the well height at BOTH widths. The list grows as each view is rebuilt; a view that
     regresses past 1.2 fails the chassis. A null sub = a zone with no sub-tabs (effects).
     Unclaimed views are the outstanding C3 rebuilds (system/code, sequence,
     sound/engine|fm|chop|wt|drums, shape/matrix) -- see CONTINUATION for the measured table. */
  const DENSITY_CLAIMED = [
    ['browse', 'packs'], ['browse', 'import'], ['browse', 'sessions'],
    ['perform', 'macros'], ['perform', 'voice'],
    ['sound', 'samples'], ['sound', 'tune'],
    ['shape', 'lfo'],
    ['mix', 'mix'], ['mix', 'comp'], ['mix', 'rec'], ['mix', 'studio'],
    ['effects', null],
    ['system', 'midi'],
    ['deliver', 'deck'], ['deliver', 'deliver'],
    ['system', 'project'], ['system', 'family'], ['system', 'roadmap']
  ];
  const DENSITY_MAX = 1.2;
  for (const W of [1440, 1280]) {
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: W === 1440 ? 900 : 800, deviceScaleFactor: 1, mobile: false });
    await sleep(240);
    const rows = [];
    for (const [z, sub] of DENSITY_CLAIMED) {
      const shown = ((await ev(`(() => {
        try { window.__avZone.show(${JSON.stringify(z)}); } catch (e) { return 'zone'; }
        const sub = ${JSON.stringify(sub)};
        if (sub == null) return 'ok';
        const btn = document.querySelector('#av-zone-${z} .av-subtab[data-sub="' + sub + '"]');
        if (!btn) return 'sub';
        btn.click();
        return 'ok';
      })()`)) || {}).value;
      await sleep(140);
      const m = shown === 'ok' ? (((await ev(`(() => {
        const zn = document.getElementById('av-zone-' + ${JSON.stringify(z)});
        const box = zn ? zn.querySelector('.av-zone-box') : null;
        return { h: zn ? zn.clientHeight : 0, s: box ? box.scrollHeight : 0 };
      })()`)) || {}).value || {}) : {};
      rows.push({ id: z + '/' + sub, ratio: m.h ? +(m.s / m.h).toFixed(3) : null, missing: shown === 'ok' ? null : shown });
    }
    /* null ratio = the measurement never happened; it must FAIL, not coerce to 0 and pass */
    const bad = rows.filter(r => r.missing || r.ratio == null || r.ratio > DENSITY_MAX);
    check('K23 W=' + W + ': every C3-claimed page/sub inside the ' + DENSITY_MAX + 'x density gate',
      bad.length === 0,
      bad.length ? JSON.stringify(bad) : rows.map(r => r.id + '=' + (r.ratio == null ? 'n/a' : r.ratio.toFixed(2))).join(' '));
  }
  await ev(`(() => { try { window.__avZone.show('sound'); const b = document.querySelector('#av-zone-sound .av-subtab[data-sub="engine"]'); if (b) b.click(); } catch (e) { /* stays put */ } return true; })()`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(200);

  /* K9 -- errors last, after every interaction */
  check('K9 zero page errors through the run', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 5)));

  console.log('');
  console.log('CHASSIS-RESULT pass=' + pass + ' fail=' + fail);
  await send('Page.close').catch(() => {});
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('rig failed: ' + (e && e.stack || e)); process.exit(2); });
