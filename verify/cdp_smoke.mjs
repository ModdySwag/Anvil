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

  /* 6c. the SYNTH card + controls (P3 counts: 85 knobs, seven engine kinds with M1) */
  const synR = await ev(`(() => {
    const host = document.getElementById('av-synth-knobs');
    const knobs = [...document.querySelectorAll('#av-synth .av-knob[data-knob]')];
    const sels = [...document.querySelectorAll('#av-synth select.av-select')];
    const engOpts = [...document.querySelectorAll('#av-synth-engine option')].map(o => o.value);
    return { host: !!host, knobs: knobs.length, bound: knobs.every(k => k.dataset.knobBound === '1'), sels: sels.length, engOpts: engOpts };
  })()`);
  const syn = synR.value || {};
  check('synth card: knobs + selects mounted + bound (85 knobs)', syn.host === true && syn.knobs >= 85 && syn.bound === true && syn.sels >= 3, JSON.stringify(syn));
  check('synth card: ENGINE select offers all seven kinds', JSON.stringify(syn.engOpts) === JSON.stringify(['va', 'acid', 'string', 'drum', 'grain', 'sampler', 'fm']), JSON.stringify(syn.engOpts));

  /* 6d. the P3 FX rack + mod matrix cards */
  const p3R = await ev(`(() => {
    const fx = document.getElementById('av-fx-host');
    const md = document.getElementById('av-mod-host');
    const strips = fx ? [...fx.querySelectorAll('.av-fx-strip')] : [];
    const knobs = fx ? [...fx.querySelectorAll('.av-knob[data-knob]')] : [];
    const toggles = fx ? [...fx.querySelectorAll('[data-fx-toggle]')] : [];
    const sels = fx ? [...fx.querySelectorAll('select.av-fx-select')] : [];
    const macroKnobs = md ? [...md.querySelectorAll('.av-knob[data-knob]')] : [];
    return {
      fx: !!fx, mod: !!md,
      order: strips.map(s => s.dataset.mod).join(','), strips: strips.length,
      knobs: knobs.length, knobsBound: knobs.filter(k => k.dataset.knobBound === '1').length,
      toggles: toggles.filter(t => t.dataset.fxBound === '1').length,
      sels: sels.filter(s => s.dataset.fxBound === '1').length,
      imp: !!(fx && fx.querySelector('#av-fx-conv-import')),
      macros: macroKnobs.length, macrosBound: macroKnobs.filter(k => k.dataset.knobBound === '1').length,
    };
  })()`);
  const p3 = p3R.value || {};
  check('M1 fx rack: 7 strips (drive,aw,mod,delay,verb,conv,dyn) · 27 knobs + 7 toggles + 6 selects all bound + IR import',
    p3.fx === true && p3.order === 'drive,aw,mod,delay,verb,conv,dyn' && p3.strips === 7 && p3.knobs === 27 && p3.knobsBound === 27 && p3.toggles === 7 && p3.sels === 6 && p3.imp === true, JSON.stringify(p3));
  check('P3 mod matrix: card mounted with 8 bound macro knobs', p3.mod === true && p3.macros === 8 && p3.macrosBound === 8, JSON.stringify({ macros: p3.macros, bound: p3.macrosBound }));

  /* 6e. the P4 sequencer card */
  const seqR = await ev(`(() => {
    const card = document.getElementById('av-seq');
    const host = document.getElementById('av-seq-host');
    const rows = host ? [...host.querySelectorAll('.av-seq-row')] : [];
    const cells = host ? [...host.querySelectorAll('.av-seq-cell')] : [];
    return { card: !!card, host: !!host, rows: rows.length, cells: cells.length,
             play: !!document.getElementById('av-seq-play'), stop: !!document.getElementById('av-seq-stop'),
             rec: !!document.getElementById('av-seq-rec'), pos: !!document.getElementById('av-seq-pos'),
             bpmKnob: !!document.querySelector('#av-seq .av-knob[data-knob="bpm"]') };
  })()`);
  const seqC = seqR.value || {};
  check('P4 sequencer: card + grid mounted (4 rows · ≥64 cells) + transport controls + bpm knob',
    seqC.card === true && seqC.host === true && seqC.rows === 4 && seqC.cells >= 64 && seqC.play === true && seqC.stop === true && seqC.rec === true && seqC.pos === true && seqC.bpmKnob === true, JSON.stringify(seqC));

  /* 6f. the P5 store card + the synth-card BANK row */
  const stR = await ev(`(() => {
    const card = document.getElementById('av-store');
    const host = document.getElementById('av-store-host');
    const bankHost = document.getElementById('av-synth-bank-host');
    return { card: !!card, host: !!host,
             root: !!(host && host.querySelector('.av-store')),
             wired: !!(host && host.dataset && host.dataset.avStoreUiWired === '1'),
             search: !!document.querySelector('#av-store-host .av-store-search'),
             filters: document.querySelectorAll('#av-store-host .av-pf-filter').length,
             lists: !!document.getElementById('av-store-installed') && !!document.getElementById('av-store-avail'),
             mode: !!document.getElementById('av-store-mode'),
             bank: !!(bankHost && bankHost.querySelector('.av-bank')),
             bankSels: bankHost ? bankHost.querySelectorAll('select.av-bank-pack').length : 0,
             core: typeof avStoreStatus, ui: typeof window.__avStoreUi, api: typeof window.__avBank };
  })()`);
  const stC = stR.value || {};
  check('P5 store: card mounted + wired (search · chips · lists) + BANK row in the synth card',
    stC.card === true && stC.host === true && stC.root === true && stC.wired === true && stC.search === true && stC.filters === 3 && stC.lists === true && stC.mode === true && stC.bank === true && stC.bankSels === 1 && stC.core === 'function' && stC.ui === 'object' && stC.api === 'object', JSON.stringify(stC));

  /* 6g. the P6 deliver card (one-press STEM export) */
  const dlR = await ev(`(() => {
    const card = document.getElementById('av-deliver');
    const host = document.getElementById('av-deliver-host');
    return { card: !!card, host: !!host,
             root: !!(host && host.querySelector('.av-deliver')),
             wired: !!(host && host.dataset && host.dataset.avDeliverUiWired === '1'),
             run: !!document.getElementById('av-deliver-run'),
             master: !!document.getElementById('av-deliver-master-run'),
             loops: !!document.getElementById('av-deliver-loops'),
             bits: !!document.getElementById('av-deliver-bits'),
             dl: !!document.getElementById('av-deliver-download'),
             api: typeof window.__avDeliverUi,
             bounce: typeof avBounce, wav: typeof avWavEncode, mid: typeof avMidExport, zip: typeof avZipBuild };
  })()`);
  const dlC = dlR.value || {};
  check('P6 deliver: card mounted + wired (loops/bits · both run buttons · download) + offline-export API live',
    dlC.card === true && dlC.host === true && dlC.root === true && dlC.wired === true && dlC.run === true && dlC.master === true && dlC.loops === true && dlC.bits === true && dlC.dl === true && dlC.api === 'object' && dlC.bounce === 'function' && dlC.wav === 'function' && dlC.mid === 'function' && dlC.zip === 'function', JSON.stringify(dlC));

  /* 6h. the S1 studio card (record core) */
  const st1R = await ev(`(() => {
    const card = document.getElementById('av-studio');
    const host = document.getElementById('av-studio-host');
    return { card: !!card, host: !!host,
             root: !!(host && host.querySelector('.av-studio')),
             wired: !!(host && host.dataset && host.dataset.avStudioUiWired === '1'),
             enable: !!document.getElementById('av-studio-enable'),
             rec: !!document.getElementById('av-studio-rec'),
             device: !!document.getElementById('av-studio-device'),
             meter: !!document.getElementById('av-studio-meter'),
             countin: !!document.getElementById('av-studio-countin'),
             takes: !!document.getElementById('av-studio-takes'),
             ui: typeof window.__avStudioUi,
             inputApi: typeof avInputEnable, metroApi: typeof avMetroCountIn, takesApi: typeof avTakesStart,
             takesN: (typeof avTakesClasses === 'function') ? avTakesClasses().length : 0 };
  })()`);
  const st1 = st1R.value || {};
  check('S1 studio: card mounted + wired (ENABLE \u00b7 REC \u00b7 device \u00b7 meter \u00b7 count-in \u00b7 takes list) + input/metro/takes API live',
    st1.card === true && st1.host === true && st1.root === true && st1.wired === true && st1.enable === true && st1.rec === true && st1.device === true && st1.meter === true && st1.countin === true && st1.takes === true && st1.ui === 'object' && st1.inputApi === 'function' && st1.metroApi === 'function' && st1.takesApi === 'function' && st1.takesN >= 8, JSON.stringify(st1));

  /* 6i. the S2 sessions card (snapshots · autosave · backup) */
  const s2R = await ev(`(() => {
    const card = document.getElementById('av-sessions');
    const host = document.getElementById('av-sessions-host');
    return { card: !!card, host: !!host,
             root: !!(host && host.querySelector('.av-sessions')),
             wired: !!(host && host.dataset && host.dataset.avSessionUiWired === '1'),
             name: !!document.getElementById('av-sessions-name'),
             save: !!document.getElementById('av-sessions-save'),
             list: !!document.getElementById('av-sessions-list'),
             autosave: !!document.getElementById('av-sessions-autosave'),
             backup: !!document.getElementById('av-sessions-backup'),
             restore: !!document.getElementById('av-sessions-restore'),
             ui: typeof window.__avSessionUi,
             sessionApi: typeof avSessionSave, backupApi: typeof avBackupBuild, loadApi: typeof avSessionLoad,
             handles: typeof window.__avSession + '|' + typeof window.__avBackup };
  })()`);
  const s2 = s2R.value || {};
  check('S2 sessions: card mounted + wired (name \u00b7 SAVE \u00b7 list \u00b7 autosave \u00b7 BACKUP \u00b7 RESTORE) + session/backup API live',
    s2.card === true && s2.host === true && s2.root === true && s2.wired === true && s2.name === true && s2.save === true && s2.list === true && s2.autosave === true && s2.backup === true && s2.restore === true && s2.ui === 'object' && s2.sessionApi === 'function' && s2.backupApi === 'function' && s2.loadApi === 'function' && s2.handles === 'object|object', JSON.stringify(s2));

  /* 6j. the S2.1 comp card (take lanes \u00b7 pick-best \u00b7 render + export) */
  const s21R = await ev(`(() => {
    const card = document.getElementById('av-comp');
    const host = document.getElementById('av-comp-host');
    return { card: !!card, host: !!host,
             root: !!(host && host.querySelector('.av-comp')),
             wired: !!(host && host.dataset && host.dataset.avCompUiWired === '1'),
             status: !!document.getElementById('av-comp-status'),
             lanes: !!document.getElementById('av-comp-lanes'),
             list: !!document.getElementById('av-comp-list'),
             segs: !!document.getElementById('av-comp-segs'),
             add: !!document.getElementById('av-comp-add'),
             auto: !!document.getElementById('av-comp-auto'),
             fade: !!document.getElementById('av-comp-fade'),
             render: !!document.getElementById('av-comp-render'),
             exportBtn: !!document.getElementById('av-comp-export'),
             ui: typeof window.__avCompUi,
             compApi: typeof avCompList, autoApi: typeof avCompAutoComp,
             renderApi: typeof avCompRender, exportApi: typeof avCompExport,
             handles: typeof window.__avComp + '|' + typeof avTakesList };
  })()`);
  const s21 = s21R.value || {};
  check('S2.1 comp: card mounted + wired (lanes \u00b7 comp select \u00b7 segments \u00b7 ADD/AUTO/RENDER/EXPORT) + comp API live',
    s21.card === true && s21.host === true && s21.root === true && s21.wired === true && s21.status === true && s21.lanes === true && s21.list === true && s21.segs === true && s21.add === true && s21.auto === true && s21.fade === true && s21.render === true && s21.exportBtn === true && s21.ui === 'object' && s21.compApi === 'function' && s21.autoApi === 'function' && s21.renderApi === 'function' && s21.exportApi === 'function' && s21.handles === 'object|function', JSON.stringify(s21));

  /* 6k. the S3 mix card (mix desk \u00b7 sends \u00b7 glue \u00b7 master \u00b7 render/export \u00b7 auto-mix \u00b7 A/B) */
  const s3R = await ev(`(() => {
    const card = document.getElementById('av-mix');
    const host = document.getElementById('av-mix-host');
    return { card: !!card, host: !!host,
             root: !!(host && host.querySelector('.av-mix')),
             wired: !!(host && host.dataset && host.dataset.avMixUiWired === '1'),
             status: !!document.getElementById('av-mix-status'),
             addSrc: !!document.getElementById('av-mix-add-src'),
             add: !!document.getElementById('av-mix-add'),
             tracks: !!document.getElementById('av-mix-tracks'),
             render: !!document.getElementById('av-mix-render'),
             exportBtn: !!document.getElementById('av-mix-export'),
             bits: !!document.getElementById('av-mix-bits'),
             dither: !!document.getElementById('av-mix-dither'),
             auto: !!document.getElementById('av-mix-auto'),
             refFile: !!document.getElementById('av-mix-ref-file'),
             compare: !!document.getElementById('av-mix-compare'),
             playab: !!document.getElementById('av-mix-playab'),
             ui: typeof window.__avMixUi,
             mixApi: typeof avMixRender, autoApi: typeof avMixAutoBalance,
             refApi: typeof avMixSetRef, cmpApi: typeof avMixCompare,
             loudApi: typeof avLoudLufs,
             handles: typeof window.__avMix + '|' + typeof window.__avLoud };
  })()`);
  const s3 = s3R.value || {};
  check('S3 mix: card mounted + wired (ADD \u00b7 render \u00b7 export \u00b7 auto-mix \u00b7 A/B) + mix/loud API live',
    s3.card === true && s3.host === true && s3.root === true && s3.wired === true && s3.status === true && s3.addSrc === true && s3.add === true && s3.tracks === true && s3.render === true && s3.exportBtn === true && s3.bits === true && s3.dither === true && s3.auto === true && s3.refFile === true && s3.compare === true && s3.playab === true && s3.ui === 'object' && s3.mixApi === 'function' && s3.autoApi === 'function' && s3.refApi === 'function' && s3.cmpApi === 'function' && s3.loudApi === 'function' && s3.handles === 'object|object', JSON.stringify(s3));

  /* 6l. the DECK card (scope \u00b7 spectrum \u00b7 waterfall \u00b7 meters \u00b7 readouts) */
  const deckR = await ev(`(() => {
    const card = document.getElementById('av-deck');
    const host = document.getElementById('av-deck-host');
    return { card: !!card, host: !!host,
             root: !!(host && host.querySelector('.av-deck')),
             wired: !!(host && host.dataset && host.dataset.avDeckUiWired === '1'),
             status: !!document.getElementById('av-deck-status'),
             run: !!document.getElementById('av-deck-run'),
             freeze: !!document.getElementById('av-deck-freeze'),
             dbfloor: !!document.getElementById('av-deck-dbfloor'),
             wfrate: !!document.getElementById('av-deck-wfrate'),
             scope: !!document.getElementById('av-deck-scope'),
             spectrum: !!document.getElementById('av-deck-spectrum'),
             waterfall: !!document.getElementById('av-deck-waterfall'),
             lufs: !!document.getElementById('av-deck-m-lufs'),
             tp: !!document.getElementById('av-deck-m-tp'),
             bpm: !!document.getElementById('av-deck-rd-bpm'),
             ui: typeof window.__avDeckUi,
             deckApi: typeof avDeckStep, attachApi: typeof avDeckAttach,
             readsApi: typeof avDeckReadouts,
             handles: typeof window.__avDeck + '|' + typeof avDeckFrame };
  })()`);
  const deckS = deckR.value || {};
  check('DECK: card mounted + wired (RUN \u00b7 FREEZE \u00b7 FLOOR \u00b7 waterfalls \u00b7 meters \u00b7 readouts) + deck API live',
    deckS.card === true && deckS.host === true && deckS.root === true && deckS.wired === true && deckS.status === true && deckS.run === true && deckS.freeze === true && deckS.dbfloor === true && deckS.wfrate === true && deckS.scope === true && deckS.spectrum === true && deckS.waterfall === true && deckS.lufs === true && deckS.tp === true && deckS.bpm === true && deckS.ui === 'object' && deckS.deckApi === 'function' && deckS.attachApi === 'function' && deckS.readsApi === 'function' && deckS.handles === 'object|function', JSON.stringify(deckS));

  /* 6m. the PROJECT & SHARE card (files \u00b7 card \u00b7 video) */
  const filesR = await ev(`(() => {
    const card = document.getElementById('av-files');
    const host = document.getElementById('av-files-host');
    return { card: !!card, host: !!host,
             root: !!(host && host.querySelector('.av-files')),
             wired: !!(host && host.dataset && host.dataset.avFilesUiWired === '1'),
             status: !!document.getElementById('av-files-status'),
             save: !!document.getElementById('av-files-save'),
             open: !!document.getElementById('av-files-open'),
             samples: !!document.getElementById('av-files-samples'),
             cardmake: !!document.getElementById('av-files-card-make'),
             cardcopy: !!document.getElementById('av-files-card-copy'),
             cardpng: !!document.getElementById('av-files-card-png'),
             preview: !!document.getElementById('av-files-card-preview'),
             videorun: !!document.getElementById('av-files-video-run'),
             videoprev: !!document.getElementById('av-files-video-preview'),
             ui: typeof window.__avFilesUi,
             projApi: typeof avProjSave, openApi: typeof avProjOpen,
             cardApi: typeof avCardEncode, qrApi: typeof avCardQr,
             videoApi: typeof avVideoRecord,
             handles: typeof window.__avProj + '|' + typeof window.__avCard + '|' + typeof window.__avVideo };
  })()`);
  const filesS = filesR.value || {};
  check('S4: card mounted + wired (.anvl \u00b7 samples \u00b7 share card \u00b7 PNG \u00b7 video clip) + proj/card/video API live',
    filesS.card === true && filesS.host === true && filesS.root === true && filesS.wired === true && filesS.status === true && filesS.save === true && filesS.open === true && filesS.samples === true && filesS.cardmake === true && filesS.cardcopy === true && filesS.cardpng === true && filesS.preview === true && filesS.videorun === true && filesS.videoprev === true && filesS.ui === 'object' && filesS.projApi === 'function' && filesS.openApi === 'function' && filesS.cardApi === 'function' && filesS.qrApi === 'function' && filesS.videoApi === 'function' && filesS.handles === 'object|object|object', JSON.stringify(filesS));

  /* 6n. the S5 layer: CODE card + popout keyboard + help/palette/lessons surfaces */
  const s5R = await ev(`(() => {
    const code = document.getElementById('av-code');
    const codeHost = document.getElementById('av-code-host');
    return { card: !!code, host: !!codeHost,
             src: !!document.getElementById('av-code-src'),
             lib: !!document.getElementById('av-code-list'),
             run: !!document.getElementById('av-code-run'),
             stop: !!document.getElementById('av-code-stop'),
             params: !!document.getElementById('av-code-params'),
             status: !!document.getElementById('av-code-status'),
             pop: !!document.getElementById('pk-pop'),
             ret: !!document.getElementById('pk-return'),
             helpApi: typeof avHelpOpen, palApi: typeof avPaletteCommands,
             lesApi: typeof avLessonsList, popApi: typeof avKbPopOpen,
             codeApi: typeof avCodeAdd, kindsApi: typeof avCodeKinds,
             codeUi: typeof window.__avCodeUi, codeHandle: typeof window.__avCode };
  })()`);
  const s5S = s5R.value || {};
  check('S5: CODE card mounted + wired (editor \u00b7 library \u00b7 params \u00b7 status) + popout buttons + help/palette/lessons/popout APIs live',
    s5S.card === true && s5S.host === true && s5S.src === true && s5S.lib === true && s5S.run === true && s5S.stop === true && s5S.params === true && s5S.status === true && s5S.pop === true && s5S.ret === true && s5S.helpApi === 'function' && s5S.palApi === 'function' && s5S.lesApi === 'function' && s5S.popApi === 'function' && s5S.codeApi === 'function' && s5S.kindsApi === 'function' && s5S.codeUi === 'object' && s5S.codeHandle === 'object', JSON.stringify(s5S));


  /* 6o. the M1 layer: FM card + wavetable editor */
  const m1R = await ev(`(() => {
    const fm = document.getElementById('av-fm');
    const fmHost = document.getElementById('av-fm-host');
    const wt = document.getElementById('av-wt');
    const wtHost = document.getElementById('av-wt-host');
    const fmKnobs = fmHost ? [...fmHost.querySelectorAll('.av-knob[data-knob]')] : [];
    return { fmCard: !!fm, fmHost: !!fmHost, wtCard: !!wt, wtHost: !!wtHost,
             tabs: fmHost ? fmHost.querySelectorAll('.av-fm-op-tab').length : 0,
             algo: !!(fmHost && fmHost.querySelector('#av-fm-algo')),
             knobs: fmKnobs.length, knobsBound: fmKnobs.filter(k => k.dataset.knobBound === '1').length,
             canvas: !!(wtHost && wtHost.querySelector('#av-wt-canvas')),
             lib: !!(wtHost && wtHost.querySelector('#av-wt-lib')),
             install: !!(wtHost && wtHost.querySelector('#av-wt-install')),
             fmUi: typeof window.__avFmUi, wtUi: typeof window.__avWtUi,
             wtApi: typeof avWtMips, installApi: typeof avWtInstall };
  })()`);
  const m1S = m1R.value || {};
  check('M1 FM: card mounted + wired (6 op tabs \u00b7 algo select \u00b7 knobs bound \u00b7 api)',
    m1S.fmCard === true && m1S.fmHost === true && m1S.tabs === 6 && m1S.algo === true && m1S.knobs >= 10 && m1S.knobsBound === m1S.knobs && m1S.fmUi === 'object', JSON.stringify(m1S));
  check('M1 WT: editor card mounted + wired (canvas \u00b7 library \u00b7 install \u00b7 api)',
    m1S.wtCard === true && m1S.wtHost === true && m1S.canvas === true && m1S.lib === true && m1S.install === true && m1S.wtUi === 'object' && m1S.wtApi === 'function' && m1S.installApi === 'function', JSON.stringify(m1S));

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
