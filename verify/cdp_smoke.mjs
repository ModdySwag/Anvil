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

  /* M2: expression / chop / generative / arranger surfaces */
  const m2R = await ev(`(() => {
    const chopHost = document.getElementById('av-chop-host');
    const seqHost = document.getElementById('av-seq-host');
    return { chopCard: !!document.getElementById('av-chop'), chopHost: !!chopHost,
             detect: !!(chopHost && chopHost.querySelector('#av-chop-detect')),
             pads: !!(chopHost && chopHost.querySelectorAll('.av-chop-pad').length >= 16),
             apply: !!(chopHost && chopHost.querySelector('#av-chop-apply')),
             chopUi: typeof window.__avChopUi, chopApi: typeof avChopDetectFrames,
             mpeRow: !!document.getElementById('av-midi-mpe-row'),
             mpeApi: typeof window.__avMpeDeck, mpeSet: typeof avMpeDeckSet,
             mpeExprApi: typeof avEngineMpeExpr,
             gen: !!(seqHost && seqHost.querySelector('#av-seq-gen')),
             rows: !!(seqHost && seqHost.querySelector('#av-seq-song-rows')),
             songPlay: !!(seqHost && seqHost.querySelector('#av-seq-song-play')),
             trackCtl: !!(seqHost && seqHost.querySelector('[data-track-spd]')),
             songApi: typeof window.__avSong };
  })()`);
  const m2S = m2R.value || {};
  check('M2 MPE: deck row + API live + engine expression sender',
    m2S.mpeRow === true && m2S.mpeApi === 'object' && m2S.mpeSet === 'function' && m2S.mpeExprApi === 'function', JSON.stringify(m2S));
  check('M2 CHOP: card mounted + wired (detect / pads / apply) + api',
    m2S.chopCard === true && m2S.chopHost === true && m2S.detect === true && m2S.pads === true && m2S.apply === true && m2S.chopUi === 'object' && m2S.chopApi === 'function', JSON.stringify(m2S));
  check('M2 arranger + generative: GEN block / song rows / PLAY SONG / track ctl + song api',
    m2S.gen === true && m2S.rows === true && m2S.songPlay === true && m2S.trackCtl === true && m2S.songApi === 'object', JSON.stringify(m2S));

  /* PLATFORM: the FAMILY card (suite bridges) + the PWA file:// guard */
  const pfR = await ev(`(() => {
    const host = document.getElementById('av-family-host');
    return { famCard: !!document.getElementById('av-family'), host: !!host,
             rows: host ? host.querySelectorAll('.av-fam-row').length : 0,
             hub: !!(host && host.querySelector('#av-fam-hub-send')),
             loopSel: !!(host && host.querySelector('#av-fam-hub-loops')),
             res: !!(host && host.querySelector('#av-fam-res-import')),
             resSel: !!(host && host.querySelector('#av-fam-res-pack')),
             rad: !!(host && host.querySelector('#av-fam-radio-open')),
             famApi: typeof window.__avFamily, famInitApi: typeof avFamilyInit,
             pwaApi: typeof window.__avPwa, pwaSupported: !!(window.__avPwa && window.__avPwa.supported === true),
             manifest: !!document.querySelector('link[rel="manifest"]') };
  })()`);
  const pfS = pfR.value || {};
  check('PLATFORM family: card mounted + wired (3 bridge rows + hub/res/radio controls + api)',
    pfS.famCard === true && pfS.host === true && pfS.rows === 3 && pfS.hub === true && pfS.loopSel === true && pfS.res === true && pfS.resSel === true && pfS.rad === true && pfS.famApi === 'object' && pfS.famInitApi === 'function', JSON.stringify(pfS));
  check('PLATFORM pwa: file:// guard (module live, unsupported here, manifest link NOT injected)',
    pfS.pwaApi === 'object' && pfS.pwaSupported === false && pfS.manifest === false, JSON.stringify(pfS));

  /* P7: the accessibility layer */
  const p7R = await ev(`(() => {
    try {
      const s = (window.__avA11y && typeof window.__avA11y.state === 'function') ? window.__avA11y.state() : null;
      const skip = document.getElementById('av-a11y-skip');
      const main = document.getElementById('av-main');
      const btn = document.querySelector('#av-a11y-contrast');
      const mo = document.querySelector('#av-a11y-motion');
      return { api: typeof window.__avA11y,
               s: s ? { skip: s.skip, live: s.live, sliders: s.counts ? s.counts.sliders : null, unnamed: s.counts ? s.counts.unnamed : null } : null,
               skipHref: skip ? skip.getAttribute('href') : null, mainId: !!main,
               toggles: !!(btn && mo), pressed: btn ? btn.getAttribute('aria-pressed') : null };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`);
  const p7S = p7R.value || {};
  check('P7 a11y: module live + skip link -> #av-main + aria-pressed toggles',
    p7S.api === 'object' && p7S.s && p7S.s.skip === true && p7S.s.live === true && p7S.skipHref === '#av-main' && p7S.mainId === true && p7S.toggles === true && (p7S.pressed === 'true' || p7S.pressed === 'false'), JSON.stringify(p7S));
  check('P7 a11y: knobs decorated (>= 85 sliders) + zero unnamed buttons',
    p7S.s && typeof p7S.s.sliders === 'number' && p7S.s.sliders >= 85 && p7S.s.unnamed === 0, JSON.stringify(p7S.s));

  /* 6p. the R1 cockpit shell: zones + tabs, one zone shown, the page cannot scroll */
  const ckR = await ev(`(() => {
    const zones = [...document.querySelectorAll('.av-zone')];
    const tabs = [...document.querySelectorAll('.av-zone-tab')];
    const shown = zones.filter(z => !z.hidden);
    const d = document.scrollingElement || document.documentElement;
    const cs = getComputedStyle(document.body);
    let proof = null;
    try { const el = document.getElementById('av-shelltest'); proof = el ? JSON.parse(el.textContent.replace('SHELL SELFTEST ', '')) : null; } catch (e) { proof = null; }
    return { zones: zones.length, tabs: tabs.length, shown: shown.length,
             active: shown[0] ? shown[0].getAttribute('data-zone') : null,
             order: tabs.map(t => t.getAttribute('data-zone')).join(','),
             bodyZone: document.body.getAttribute('data-av-zone'),
             docScroll: d.scrollHeight, docClient: d.clientHeight, overflowY: cs.overflowY,
             facade: typeof window.__avZone, auto: typeof window.__avZoneAuto, proof: proof };
  })()`);
  const ck = ckR.value || {};
  check('R1 cockpit: 8 zones + 8 tabs (workflow order), exactly one shown (synth default), page cannot scroll',
    ck.zones === 8 && ck.tabs === 8 && ck.shown === 1 && ck.active === 'synth'
    && ck.order === 'synth,fx,mod,seq,studio,store,code,system' && ck.bodyZone === 'synth'
    && ck.docScroll <= ck.docClient + 2 && ck.overflowY === 'hidden'
    && ck.facade === 'object' && ck.auto === 'function', JSON.stringify({ zones: ck.zones, tabs: ck.tabs, shown: ck.shown, active: ck.active, doc: ck.docScroll + '/' + ck.docClient, overflow: ck.overflowY }));
  check('R1 cockpit: SHELL SELFTEST ok (?avtest=1)',
    !!ck.proof && ck.proof.ready === true && ck.proof.zones === 8 && ck.proof.active === 'synth', JSON.stringify(ck.proof));

  /* 6q. the R2 module chrome: heads + menu on every card, engine strip, header utilities */
  const chR = await ev(`(() => {
    const cards = ['av-synth','av-fm','av-fx','av-mod','av-seq','av-mix','av-store','av-code'];
    const heads = cards.filter(id => { const c = document.getElementById(id); return !!(c && c.querySelector(':scope > .av-mod-head')); }).length;
    const strip = document.getElementById('av-engine-strip');
    let proof = null;
    try { const el = document.getElementById('av-chrometest'); proof = el ? JSON.parse(el.textContent.replace('CHROME SELFTEST ', '')) : null; } catch (e) { proof = null; }
    return { heads: heads,
             toggles: document.querySelectorAll('.av-mod-toggle').length,
             menus: document.querySelectorAll('.av-mod-menu-btn').length,
             chips: strip ? strip.querySelectorAll('.av-engine-chip').length : 0,
             stripInSynth: !!(strip && strip.closest('#av-zone-synth')),
             browse: !!document.getElementById('av-head-browse'),
             undo: !!document.getElementById('av-head-undo'), redo: !!document.getElementById('av-head-redo'),
             menuHost: !!document.getElementById('av-mod-menu'),
             chromeApi: typeof window.__avChrome, proof: proof };
  })()`);
  const ch = chR.value || {};
  check('R2 chrome: module heads + menu buttons on every chrome card, engine strip (6 chips in Synth), header BROWSE/undo/redo',
    ch.heads === 8 && ch.toggles >= 20 && ch.menus >= 20 && ch.chips === 6 && ch.stripInSynth === true
    && ch.browse === true && ch.undo === true && ch.redo === true && ch.menuHost === true && ch.chromeApi === 'object', JSON.stringify(ch));
  check('R2 chrome: CHROME SELFTEST ok (?avtest=1)',
    !!ch.proof && ch.proof.heads >= 20 && ch.proof.cards >= 20 && ch.proof.strip === true && ch.proof.browse === true, JSON.stringify(ch.proof));

  /* 6r. R2 chrome works: fold toggles; Init returns a knob to its default through the funnel */
  const fnR2 = await ev(`(() => {
    const card = document.getElementById('av-synth');
    const tg = card && card.querySelector(':scope > .av-mod-head .av-mod-toggle');
    if (!tg) return { err: 'no toggle' };
    tg.click();
    const folded = card.classList.contains('av-mod-fold');
    tg.click();
    const unfolded = !card.classList.contains('av-mod-fold');
    let initN = null;
    try {
      const knob = card.querySelector('.av-knob[data-knob]');
      const def = parseFloat(knob.dataset.def);
      const before = parseFloat(knob.getAttribute('aria-valuenow'));
      avKnobCommit(knob, def === 0 ? 1 : 0);
      initN = window.__avChrome.initCard('av-synth');
      const after = parseFloat(knob.getAttribute('aria-valuenow'));
      return { folded: folded, unfolded: unfolded, initN: initN, restored: Math.abs(after - def) < 1e-9, before: before };
    } catch (e) { return { folded: folded, unfolded: unfolded, err: String((e && e.message) || e) }; }
  })()`);
  const fn2 = fnR2.value || {};
  check('R2 chrome: collapse toggles fold on/off; Init restores the first knob to its data-def via the one commit funnel',
    fn2.folded === true && fn2.unfolded === true && typeof fn2.initN === 'number' && fn2.initN > 0 && fn2.restored === true, JSON.stringify(fn2));

  /* 6s. R3 workspace: float buttons on every head + the About popover host + the panels facade */
  const r3R = await ev(`(() => {
    let proof = null;
    try { const el = document.getElementById('av-panelstest'); proof = el ? JSON.parse(el.textContent.replace('PANELS SELFTEST ', '')) : null; } catch (e) { proof = null; }
    return { floatBtns: document.querySelectorAll('.av-mod-float-btn').length,
             aboutBtn: !!document.getElementById('av-head-about'),
             aboutHost: !!(document.getElementById('av-about-pop') && document.getElementById('av-about-pop').hidden === true),
             panelsApi: typeof window.__avPanels, proof: proof };
  })()`);
  const r3 = r3R.value || {};
  check('R3 workspace: float buttons on every head (>=20), About button + hidden about host, panels facade + proof',
    r3.floatBtns >= 20 && r3.aboutBtn === true && r3.aboutHost === true && r3.panelsApi === 'object'
    && !!r3.proof && r3.proof.v && typeof r3.proof.open === 'number', JSON.stringify(r3));
  /* 6t. R4 workspace: the left rail + sectioned toggles + float window controls + named layouts */
  const r4R = await ev(`(() => {
    const rail = document.getElementById('av-rail');
    const tab = document.getElementById('av-tab-synth');
    const cs = tab ? getComputedStyle(tab) : null;
    let proof = null;
    try { const el = document.getElementById('av-railtest'); proof = el ? JSON.parse(el.textContent.replace('RAIL SELFTEST ', '')) : null; } catch (e) { proof = null; }
    return { rail: !!rail, groups: rail ? rail.querySelectorAll('.av-rail-group').length : 0,
             links: rail ? rail.querySelectorAll('.av-rail-card').length : 0,
             navBtn: !!document.getElementById('av-head-rail'),
             tabBorder: cs ? cs.borderTopWidth : null, tabRadius: cs ? cs.borderTopLeftRadius : null,
             railApi: typeof window.__avRail, proof: proof };
  })()`);
  const r4 = r4R.value || {};
  check('R4 rail: left navigator (8 groups + >=20 card links) + header NAV toggle + RAIL SELFTEST',
    r4.rail === true && r4.groups === 8 && r4.links >= 20 && r4.navBtn === true && r4.railApi === 'object'
    && !!r4.proof && r4.proof.ready === true && r4.proof.cards >= 20, JSON.stringify(r4));
  check('R4 toggles: the top tabs are sectioned chips (bordered, rounded)',
    r4.tabBorder === '1px' && parseFloat(r4.tabRadius) >= 4, JSON.stringify({ border: r4.tabBorder, radius: r4.tabRadius }));

  const r4f = await ev(`(() => {
    window.__avPanels.open('av-fx');
    const p = document.getElementById('av-float-av-fx');
    const btns = { pin: !!p.querySelector('.av-float-btnpin'), op: !!p.querySelector('.av-float-btnop'), min: !!p.querySelector('.av-float-btnmin'), max: !!p.querySelector('.av-float-btnmax') };
    window.__avPanels.minimize('av-fx', true);
    const mini = p.classList.contains('av-float-min');
    window.__avPanels.minimize('av-fx', false);
    const back = !p.classList.contains('av-float-min');
    const saved = window.__avPanels.saveNamed('smoke-layout');
    window.__avPanels.close('av-fx');
    window.__avPanels.reset();
    const loaded = window.__avPanels.loadNamed('smoke-layout');
    const n = window.__avPanels.list().length;
    window.__avPanels.reset();
    return { pin: btns.pin, op: btns.op, min: btns.min, max: btns.max, mini: mini, back: back, saved: saved, loaded: loaded, n: n };
  })()`);
  const r4f2 = r4f.value || {};
  check('R4 float controls: pin/opacity/min/max buttons + minimize toggle + named layout save/load',
    r4f2.pin && r4f2.op && r4f2.min && r4f2.max && r4f2.mini === true && r4f2.back === true
    && r4f2.saved === true && r4f2.loaded === true && r4f2.n === 1, JSON.stringify(r4f2));

  /* 6v. R5: the Windows-style menu bar + the rail Panels quick-view */
  const r5R = await ev(`(() => {
    const mb = document.getElementById('av-menubar');
    let proof = null;
    try { const el = document.getElementById('av-menubartest'); proof = el ? JSON.parse(el.textContent.replace('MENUBAR SELFTEST ', '')) : null; } catch (e) { proof = null; }
    const api = typeof window.__avMenubar;
    const opened = api === 'object' ? window.__avMenubar.open('workspace') : false;
    const pop = document.getElementById('av-menu-pop');
    const popOpen = !!(pop && pop.classList.contains('open'));
    const popItems = pop ? pop.querySelectorAll('.av-menu-mi').length : 0;
    if (api === 'object') window.__avMenubar.close();
    const closed = !(pop && pop.classList.contains('open'));
    return { mb: !!mb, items: mb ? mb.querySelectorAll('.av-menu-item').length : 0, api: api,
             proof: proof, opened: opened, popOpen: popOpen, popItems: popItems, closed: closed };
  })()`);
  const r5 = r5R.value || {};
  check('R5 menu bar: File/Edit/View/Workspace/Help + a dropdown opens with items and closes + MENUBAR SELFTEST',
    r5.mb === true && r5.items === 5 && r5.api === 'object' && r5.opened === true && r5.popOpen === true
    && r5.popItems >= 5 && r5.closed === true && !!r5.proof && r5.proof.ready === true, JSON.stringify(r5));

  const r5p = await ev(`(() => {
    const box = document.getElementById('av-rail-panels');
    const avail = document.querySelectorAll('#av-rail-avail .av-rail-prow');
    const info = { box: !!box, avail0: avail.length, draggable: avail.length > 0 ? avail[0].draggable === true : false };
    window.__avPanels.open('av-fx');
    info.open1 = document.querySelectorAll('#av-rail-open .av-rail-prow').length;
    info.avail1 = document.querySelectorAll('#av-rail-avail .av-rail-prow').length;
    window.__avPanels.minimize('av-fx', true);
    info.min1 = document.querySelectorAll('#av-rail-min .av-rail-prow').length;
    window.__avPanels.close('av-fx');
    info.open0 = document.querySelectorAll('#av-rail-open .av-rail-prow').length;
    info.avail2 = document.querySelectorAll('#av-rail-avail .av-rail-prow').length;
    return info;
  })()`);
  const r5p2 = r5p.value || {};
  check('R5 rail quick-view: Available rows (>=20, draggable) + live Open/Minimized reflection on float/min/dock',
    r5p2.box === true && r5p2.avail0 >= 20 && r5p2.draggable === true
    && r5p2.open1 === 1 && r5p2.avail1 === r5p2.avail0 - 1 && r5p2.min1 === 1
    && r5p2.open0 === 0 && r5p2.avail2 === r5p2.avail0, JSON.stringify(r5p2));

  /* 6w. R6: pane scroll-shadow scrims (sticky gradient edges on the zone panes) */
  const r6R = await ev(`(() => {
    const z = document.getElementById('av-zone-synth');
    const cs = z ? getComputedStyle(z, '::before') : null;
    const cs2 = z ? getComputedStyle(z, '::after') : null;
    return { beforeBg: cs ? cs.backgroundImage.indexOf('gradient') >= 0 : false,
             afterBg: cs2 ? cs2.backgroundImage.indexOf('gradient') >= 0 : false,
             sticky: cs ? cs.position : null };
  })()`);
  const r6 = r6R.value || {};
  check('R6 panes: scroll-shadow scrims (sticky gradient edges on the zone panes)',
    r6.beforeBg === true && r6.afterBg === true && r6.sticky === 'sticky', JSON.stringify(r6));

  /* 6x. R7: the rail as a standard menu — chevron section headers + independent persisted collapse */
  const r7R = await ev(`(() => {
    const info = { glyphs: document.querySelectorAll('#av-rail .av-rail-chev-glyph').length };
    const g = document.querySelector('.av-rail-group[data-zone="synth"]');
    const cards = g ? g.querySelector('.av-rail-cards') : null;
    const chev = g ? g.querySelector('.av-rail-chev') : null;
    const disp = (el) => (el ? getComputedStyle(el).display : null);
    info.g = !!g; info.chevBtn = !!chev;
    info.exp0 = g ? g.classList.contains('expanded') : null;
    info.vis0 = disp(cards);
    info.aria0 = chev ? chev.getAttribute('aria-expanded') : null;
    let map0 = null; try { map0 = JSON.parse(localStorage.getItem('av-rail-sections')); } catch (e) { map0 = null; }
    info.map0 = map0;
    if (chev) chev.click();
    info.exp1 = g.classList.contains('expanded');
    info.vis1 = disp(cards);
    info.aria1 = chev.getAttribute('aria-expanded');
    let map1 = null; try { map1 = JSON.parse(localStorage.getItem('av-rail-sections')); } catch (e) { map1 = null; }
    info.map1 = map1;
    if (chev) chev.click();
    info.exp2 = g.classList.contains('expanded');
    const zb = g ? g.querySelector('.av-rail-zone') : null;
    if (zb) zb.click();
    info.jumped = (window.__avZone && typeof window.__avZone.current === 'function') ? window.__avZone.current() : null;
    return info;
  })()`);
  const r7 = r7R.value || {};
  const r7Keys = ['synth', 'fx', 'mod', 'seq', 'studio', 'store', 'code', 'system', 'panels'];
  const r7MapOk = !!(r7.map0 && typeof r7.map0 === 'object' && r7Keys.every(k => k in r7.map0));
  check('R7 rail menu: 9 chevron headers + zone section toggles independently, persists to av-rail-sections, aria tracks it',
    r7.glyphs === 9 && r7.g === true && r7.chevBtn === true && r7MapOk
    && r7.exp1 === !r7.exp0 && r7.vis0 === (r7.exp0 ? 'flex' : 'none') && r7.vis1 === (r7.exp1 ? 'flex' : 'none')
    && r7.aria1 === String(r7.exp1) && !!r7.map1 && r7.map1.synth === (r7.exp1 ? 1 : 0)
    && r7.exp2 === r7.exp0 && r7.jumped === 'synth', JSON.stringify(r7));

  const r7p = await ev(`(() => {
    const sec = document.getElementById('av-rail-panels');
    const head = sec ? sec.querySelector('.av-rail-sec-head') : null;
    const body = sec ? sec.querySelector('.av-rail-sec-body') : null;
    const disp = (el) => (el ? getComputedStyle(el).display : null);
    const info = { sec: !!sec, head: !!head, body: !!body };
    info.pvis0 = disp(body);
    info.paria0 = head ? head.getAttribute('aria-expanded') : null;
    if (head) head.click();
    info.pvis1 = disp(body);
    info.paria1 = head ? head.getAttribute('aria-expanded') : null;
    let pmap = null; try { pmap = JSON.parse(localStorage.getItem('av-rail-sections')); } catch (e) { pmap = null; }
    info.pmap = pmap;
    if (head) head.click();
    info.pvis2 = disp(body);
    return info;
  })()`);
  const r7p2 = r7p.value || {};
  check('R7 panels section: the head collapses/expands the quick-view body and persists (av-rail-sections.panels)',
    r7p2.sec === true && r7p2.head === true && r7p2.body === true
    && r7p2.pvis0 === 'block' && r7p2.paria0 === 'true'
    && r7p2.pvis1 === 'none' && r7p2.paria1 === 'false' && !!r7p2.pmap && r7p2.pmap.panels === 0
    && r7p2.pvis2 === 'block', JSON.stringify(r7p2));

  /* 6y. R8: mod drag-to-modulate — chips strip, drop map, the mod ring, the refusal path */
  const r8R = await ev(`(() => {
    const info = { chips: document.querySelectorAll('#av-mod-host .av-mod-chip[data-src]').length };
    const chip = document.querySelector('#av-mod-host .av-mod-chip[data-src="env1"]');
    const knob = document.querySelector('.av-knob[data-knob="filter.cutoff"]');
    info.knob = !!knob;
    info.slots0 = (typeof avModSnap === 'function') ? avModSnap().slots.length : -1;
    let dt = null;
    try { dt = new DataTransfer(); } catch (e) { dt = null; }
    info.dt = !!dt;
    if (chip && knob && dt) {
      chip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      info.dragging = document.body.classList.contains('av-drag-modsrc');
      info.targets = document.querySelectorAll('.av-mod-target').length;
      knob.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      info.hover = knob.classList.contains('av-mod-droppable');
      knob.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
    info.dragging2 = document.body.classList.contains('av-drag-modsrc');
    info.targets2 = document.querySelectorAll('.av-mod-target').length;
    const slots = (typeof avModSnap === 'function') ? avModSnap().slots : [];
    info.slots = slots.length;
    const s0 = slots.length ? slots[slots.length - 1] : null;
    info.s1 = s0 ? (s0.src + '->' + s0.dst) : null;
    const modEl = knob ? knob.querySelector('.av-knob-mod') : null;
    info.ringShown = knob ? knob.classList.contains('av-mod-shown') : null;
    info.ringDisp = modEl ? getComputedStyle(modEl).display : null;
    info.modAttr = knob ? knob.getAttribute('data-mod') : null;
    info.rows = document.querySelectorAll('#av-mod-slots .av-mod-slot').length;
    const other = document.querySelector('.av-knob[data-knob="filter.envAmt"]');
    const chip2 = document.querySelector('#av-mod-host .av-mod-chip[data-src="env2"]');
    if (other && chip2 && dt) {
      chip2.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      other.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
    info.slotsAfter = (typeof avModSnap === 'function') ? avModSnap().slots.length : -1;
    return info;
  })()`);
  const r8 = r8R.value || {};
  check('R8 mod drag: 14 chips + drag begins (body class, 4 target halos) + drop on filter.cutoff assigns env1->cutoff with the mod ring shown + unmapped knob refused',
    r8.chips === 14 && r8.knob === true && r8.dt === true
    && r8.dragging === true && r8.targets === 4 && r8.hover === true
    && r8.dragging2 === false && r8.targets2 === 0
    && r8.slots === r8.slots0 + 1 && r8.s1 === 'env1->cutoff'
    && r8.ringShown === true && r8.ringDisp === 'block' && (r8.modAttr || '').indexOf('env1:') === 0
    && r8.rows === r8.slots && r8.slotsAfter === r8.slots, JSON.stringify(r8));

  /* 6z. R8: matrix grammar — column header · re-drop single-instance · POL · macro OUT · cleanup */
  const r8m = await ev(`(() => {
    const info = {};
    const hdr = document.querySelector('#av-mod-slots .av-mod-hdr');
    info.hdr = hdr ? hdr.textContent.replace(/\\s+/g, ' ').trim() : null;
    avModSlotSet(0, { amt: 0.2 });
    const before = avModSnap().slots.length;
    info.again = avModAssign('env1', 'filter.cutoff');
    const slots1 = avModSnap().slots;
    info.single = (slots1.length === before) && slots1.filter(s => s.src === 'env1' && s.dst === 'cutoff').length === 1;
    info.amtReset = slots1[0].amt === 0.5;
    const pol = document.querySelector('#av-mod-slots [data-slot-pol="0"]');
    info.pol0 = pol ? pol.textContent : null;
    if (pol) pol.click();
    info.amtPol = avModSnap().slots[0].amt;
    info.pol1 = pol ? pol.textContent : null;
    avModAssign('macro1', 'filter.reso');
    avModMacroSet(0, 0.42);
    const out = document.querySelector('#av-mod-slots [data-slot-out="1"]');
    info.out = out ? out.textContent : null;
    avModSlotRemove(1); avModSlotRemove(0);
    avModMacroSet(0, 0);
    const knob = document.querySelector('.av-knob[data-knob="filter.cutoff"]');
    info.ringCleared = knob ? !knob.classList.contains('av-mod-shown') : null;
    info.slotsEnd = avModSnap().slots.length;
    info.rowsEnd = document.querySelectorAll('#av-mod-slots .av-mod-slot').length;
    return info;
  })()`);
  const r8m2 = r8m.value || {};
  const r8hdrOk = !!r8m2.hdr && ['SOURCE', 'CURVE', 'AMOUNT', 'POL', 'DESTINATION', 'OUT'].every(w => r8m2.hdr.indexOf(w) >= 0);
  check('R8 matrix grammar: header (SOURCE/CURVE/AMOUNT/POL/DESTINATION/OUT) + re-drop re-defaults one instance + POL flips sign + macro OUT tracks 42% + cleanup clears ring',
    r8hdrOk === true && r8m2.again === true && r8m2.single === true && r8m2.amtReset === true
    && r8m2.pol0 === '+' && r8m2.amtPol === -0.5 && r8m2.pol1 === '\u00B1'
    && r8m2.out === '42%' && r8m2.ringCleared === true && r8m2.slotsEnd === 0 && r8m2.rowsEnd === 0, JSON.stringify(r8m2));

  /* 6bb. R9: module chrome on EVERY zone card (LEVELS + FAMILY were missing it) */
  const r9cR = await ev(`(() => {
    const cards = document.querySelectorAll('.av-zone .av-card');
    let withHead = 0, withFloat = 0;
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].querySelector(':scope > .av-mod-head')) withHead++;
      if (cards[i].querySelector(':scope > .av-mod-head .av-mod-float-btn')) withFloat++;
    }
    const lv = document.getElementById('av-levels');
    const fam = document.getElementById('av-family');
    const rd = document.getElementById('av-roadmap');
    return { cards: cards.length, withHead: withHead, withFloat: withFloat,
             lvMenu: !!(lv && lv.querySelector(':scope > .av-mod-head .av-mod-menu-btn')),
             lvFloat: !!(lv && lv.querySelector(':scope > .av-mod-head .av-mod-float-btn')),
             famToggle: !!(fam && fam.querySelector(':scope > .av-mod-head .av-mod-toggle')),
             rdMenu: !!(rd && rd.querySelector(':scope > .av-mod-head .av-mod-menu-btn')),
             rdFloat: !!(rd && rd.querySelector(':scope > .av-mod-head .av-mod-float-btn')) };
  })()`);
  const r9c = r9cR.value || {};
  check('R9 chrome: every zone card carries the module head + float button - LEVELS, FAMILY and ROADMAP included',
    r9c.cards >= 23 && r9c.withHead === r9c.cards && r9c.withFloat === r9c.cards
    && r9c.lvMenu === true && r9c.lvFloat === true && r9c.famToggle === true
    && r9c.rdMenu === true && r9c.rdFloat === true, JSON.stringify(r9c));

  /* 6bc. R9: osc PITCH/FINE knobs + funnel mirror + frame-coalesced drag lands on release */
  const r9pR = await ev(`(() => {
    const info = {};
    const paths = ['osc1.tune', 'osc1.fine', 'osc2.tune', 'osc2.fine'];
    info.knobs = paths.map(p => !!document.querySelector('#av-synth .av-knob[data-knob="' + p + '"]'));
    info.bound = paths.map(p => { const k = document.querySelector('#av-synth .av-knob[data-knob="' + p + '"]'); return !!(k && k.dataset.knobBound === '1'); });
    const fin = document.querySelector('#av-synth .av-knob[data-knob="osc1.fine"]');
    avKnobCommit(fin, 25);
    info.mirror = avParams['osc1.fine'];
    avKnobCommit(fin, 0);
    info.back = avParams['osc1.fine'];
    const cut = document.querySelector('#av-synth .av-knob[data-knob="filter.cutoff"]');
    window.__r9cut0 = avParams['filter.cutoff'];
    const r = cut.getBoundingClientRect();
    const n0 = parseFloat(cut.dataset.norm);
    info.n0 = n0;
    cut.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 7, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    for (let i = 1; i <= 4; i++) cut.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 7, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 - i * 14 }));
    info.mid = parseFloat(cut.dataset.norm);
    cut.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 7, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 - 56 }));
    info.end = parseFloat(cut.dataset.norm);
    return info;
  })()`);
  const r9p = r9pR.value || {};
  await sleep(320);
  const r9rR = await ev(`(() => {
    const cut = document.querySelector('#av-synth .av-knob[data-knob="filter.cutoff"]');
    const settled = parseFloat(cut.dataset.norm);
    const dragging = cut.classList.contains('dragging');
    avKnobCommit(cut, window.__r9cut0 === undefined ? 800 : window.__r9cut0);
    return { settled: settled, dragging: dragging, restored: parseFloat(cut.dataset.norm) };
  })()`);
  const r9r = r9rR.value || {};
  check('R9 pitch+fluidity: PITCH/FINE knobs bound + commit funnel mirrors + drag defers to rAF and lands on release',
    r9p.knobs && r9p.knobs.every(v => v === true) && r9p.bound && r9p.bound.every(v => v === true)
    && r9p.mirror === 25 && r9p.back === 0
    && r9p.mid === r9p.n0 && r9p.end > r9p.n0
    && r9r.dragging === false && Math.abs(r9r.settled - r9p.end) < 0.2 && Math.abs(r9r.restored - r9p.n0) < 0.03,
    JSON.stringify({ p: r9p, r: r9r }));

  /* 6bd. R10: no accidental text selection — chrome locked, text surfaces opt in */
  const r10R = await ev(`(() => {
    const cs = (el) => el ? getComputedStyle(el).userSelect : null;
    const note = document.querySelector('.av-note');
    const ta = document.querySelector('textarea');
    const inp = document.querySelector('input:not([type]), input[type="text"]');
    return { body: getComputedStyle(document.body).userSelect,
             note: cs(note),
             ta: ta ? cs(ta) : 'no-textarea',
             inp: inp ? cs(inp) : 'no-text-input' };
  })()`);
  const r10 = r10R.value || {};
  check('R10 no-select: body + card prose are user-select:none while text surfaces (textarea/input) stay selectable',
    r10.body === 'none' && r10.note === 'none'
    && (r10.ta === 'text' || r10.ta === 'no-textarea')
    && (r10.inp === 'text' || r10.inp === 'no-text-input'), JSON.stringify(r10));

  /* 6ca. R11: THE TRANSPORT CONSOLE — header rebuilt, every legacy id intact, OLED reads live */
  const r11R = await ev(`(() => {
    const gc = (id) => !!document.getElementById(id);
    const head = document.querySelector('header.av-head');
    return {
      cls: !!(head && head.classList.contains('av-console')),
      play: gc('avc-play'), stop: gc('avc-stop'), song: gc('avc-song'), rec: gc('avc-rec'),
      bpm: gc('avc-bpm-val'), pack: gc('avc-pack'), preset: gc('avc-preset'), power: gc('avc-power'),
      api: typeof window.__avConsole,
      bpmText: (document.getElementById('avc-bpm-val') || {}).textContent || '',
      bpmVal: (typeof avParams === 'object' && avParams) ? avParams.bpm : null,
      leg: { version: gc('av-version'), tier: gc('av-tier'), voices: gc('av-voices'),
             browse: gc('av-head-browse'), undo: gc('av-head-undo'), about: gc('av-head-about'),
             rail: gc('av-head-rail'), help: gc('av-help'), piano: gc('btn-piano') },
      tierInOled: !!(document.getElementById('avc-sys') && document.getElementById('avc-sys').contains(document.getElementById('av-tier'))),
    };
  })()`);
  const r11 = r11R.value || {};
  const r11l = r11.leg || {};
  check('R11 console: transport deck + BPM segment + OLED (pack/preset/sys) in the header, every legacy id intact, BPM live',
    r11.cls === true && r11.play === true && r11.stop === true && r11.song === true && r11.rec === true
    && r11.bpm === true && r11.pack === true && r11.preset === true && r11.power === true && r11.api === 'object'
    && r11.bpmVal !== null && r11.bpmText === String(Math.round(r11.bpmVal))
    && r11l.version === true && r11l.tier === true && r11l.voices === true && r11l.browse === true
    && r11l.undo === true && r11l.about === true && r11l.rail === true && r11l.help === true && r11l.piano === true
    && r11.tierInOled === true, JSON.stringify(r11));

  /* 6cb. R11: Space = transport (play then stop) through the console toggle */
  const r11sR = await ev(`(() => {
    window.__avConsole.refresh();
    const before = window.__avConsole.lastAction();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    const mid = window.__avConsole.lastAction();
    const playing = (typeof avSeqIsPlaying === 'function') ? avSeqIsPlaying() : null;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    const after = window.__avConsole.lastAction();
    const playing2 = (typeof avSeqIsPlaying === 'function') ? avSeqIsPlaying() : null;
    return { before: before, mid: mid, after: after, playing: playing, playing2: playing2 };
  })()`);
  const r11s = r11sR.value || {};
  check('R11 spacebar: Space toggles the transport (play then stop), the seq reports it',
    r11s.mid === 'play' && r11s.after === 'stop' && r11s.playing === true && r11s.playing2 === false, JSON.stringify(r11s));

  /* 6cc. R12: the BPM window is a live control (click halves / wheel / keys) through the funnel */
  const r11b = await ev(`(() => {
    const w = document.querySelector('.avc-bpm');
    if (!w) return { missing: true };
    const b0 = avParams.bpm;
    const r = w.getBoundingClientRect();
    w.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + 3 }));
    const b1 = avParams.bpm;
    w.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height - 3 }));
    const b2 = avParams.bpm;
    w.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 }));
    const b3 = avParams.bpm;
    window.__avConsole.setBpm(b0);
    return { b0: b0, b1: b1, b2: b2, b3: b3, back: avParams.bpm };
  })()`);
  const r11b2 = r11b.value || {};
  check('R12 BPM window: click top +1 / bottom -1 / wheel up +1 through the bpm funnel, restored exactly',
    r11b2.b0 !== undefined && r11b2.b1 === r11b2.b0 + 1 && r11b2.b2 === r11b2.b0
    && r11b2.b3 === r11b2.b0 + 1 && r11b2.back === r11b2.b0, JSON.stringify(r11b2));



  /* 6ce. R13: the LFO card — mounted, bound, seeded (mod zone reveal first) */
  const r13aR = await ev(`(() => {
    window.__avZoneAuto('#av-lfo');
    const card = document.getElementById('av-lfo');
    const knobs = card ? [...card.querySelectorAll('.av-knob[data-knob]')] : [];
    const paths = knobs.map(k => k.dataset.knob).sort().join(',');
    const sel = document.getElementById('av-lfo-shape');
    const opts = sel ? [...sel.options].map(o => o.value) : [];
    return { card: !!card, zone: card && card.closest('.av-zone') ? card.closest('.av-zone').getAttribute('data-zone') : null,
             knobs: knobs.length, paths: paths, bound: knobs.length > 0 && knobs.every(k => k.dataset.knobBound === '1'),
             selOpts: opts.join(','), canvas: !!document.getElementById('av-lfo-scope'),
             facade: typeof window.__avLfo, shape: (typeof avParams === 'object' && avParams) ? avParams['lfo.shape'] : null };
  })()`);
  const r13a = r13aR.value || {};
  check('R13 LFO card: mounted in the mod zone (4-option shape select + 3 bound knobs + scope + facade + seeded shape)',
    r13a.card === true && r13a.zone === 'mod' && r13a.knobs === 3
    && r13a.paths === 'lfo.rate,lfo.toCut,lfo.toPitch' && r13a.bound === true
    && r13a.selOpts === 'sine,tri,square,sh' && r13a.canvas === true && r13a.facade === 'object'
    && r13a.shape === 'sine', JSON.stringify(r13a));

  /* 6cf. R13: the LFO rides the funnel; the scope repaints per shape */
  const r13bR = await ev(`(() => {
    const card = document.getElementById('av-lfo');
    const k = card.querySelector('.av-knob[data-knob="lfo.toPitch"]');
    avKnobCommit(k, 0.6);
    const mirror = avParams['lfo.toPitch'];
    avKnobCommit(k, 0);
    const back = avParams['lfo.toPitch'];
    const canvas = document.getElementById('av-lfo-scope');
    const sel = document.getElementById('av-lfo-shape');
    window.__avLfo.redraw();
    const d0 = canvas.toDataURL();
    sel.value = 'tri';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    window.__avLfo.redraw();
    const d1 = canvas.toDataURL();
    const shape = avParams['lfo.shape'];
    const attr = canvas.getAttribute('data-shape');
    sel.value = 'sine';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const eng1 = (window.__avEngine && window.__avEngine.ready) ? window.__avEngine.setParam('lfo.shape', 'tri') : null;
    const eng2 = (window.__avEngine && window.__avEngine.ready) ? window.__avEngine.setParam('lfo.shape', 'sine') : null;
    return { mirror: mirror, back: back, diff: d0 !== d1, shape: shape, attr: attr,
             restored: avParams['lfo.shape'], eng1: eng1, eng2: eng2 };
  })()`);
  const r13b = r13bR.value || {};
  check('R13 LFO: commit + select ride the funnel, the scope repaints per shape, the engine accepts the schema path',
    r13b.mirror === 0.6 && r13b.back === 0 && r13b.diff === true && r13b.shape === 'tri' && r13b.attr === 'tri'
    && r13b.restored === 'sine' && r13b.eng1 === true && r13b.eng2 === true, JSON.stringify(r13b));

  /* 6cg. R14: console step keys + VU bars - structure + the honest no-op with no banks */
  const r14aR = await ev(`(() => {
    const gc = (id) => !!document.getElementById(id);
    const c = window.__avConsole || {};
    const info = { prev: gc('avc-preset-prev'), next: gc('avc-preset-next'), vuL: gc('avc-vu-l'), vuR: gc('avc-vu-r'),
                   stepApi: typeof c.stepPreset, vuApi: typeof c.vu, tickApi: typeof c.vuTick };
    const r = (typeof c.stepPreset === 'function') ? c.stepPreset(1) : null;
    info.step = r;
    info.last1 = (typeof c.lastAction === 'function') ? c.lastAction() : null;
    const pv = document.getElementById('avc-preset-prev');
    if (pv) pv.click();
    info.last2 = (typeof c.lastAction === 'function') ? c.lastAction() : null;
    return info;
  })()`);
  const r14a = r14aR.value || {};
  check('R14 console: step keys + VU bars mounted; the step is an honest no-op with no banks',
    r14a.prev === true && r14a.next === true && r14a.vuL === true && r14a.vuR === true
    && r14a.stepApi === 'function' && r14a.vuApi === 'function' && r14a.tickApi === 'function'
    && !!r14a.step && r14a.step.applied === false && r14a.step.reason === 'no-banks'
    && r14a.last1 === 'preset-next' && r14a.last2 === 'preset-prev', JSON.stringify(r14a));

  /* 6ch. R14: the VU bars paint from avTap.levels (inject -> paint -> restore) */
  const r14bR = await ev(`(() => {
    const c = window.__avConsole || {};
    const L = document.getElementById('avc-vu-l'), R = document.getElementById('avc-vu-r');
    const old = { l: avTap.levels.l, r: avTap.levels.r };
    avTap.levels.l = 0.8; avTap.levels.r = 0.4;
    const painted = (typeof c.vuTick === 'function') ? c.vuTick() : false;
    const sc = (el) => { const tx = (el && el.style && el.style.transform) || ''; const i = tx.indexOf('scaleY('); return i >= 0 ? parseFloat(tx.slice(i + 7)) : -1; };
    const info = { painted: painted === true, l: sc(L), r: sc(R), vu: (typeof c.vu === 'function') ? c.vu() : null };
    avTap.levels.l = old.l; avTap.levels.r = old.r;
    if (typeof c.vuTick === 'function') c.vuTick();
    return info;
  })()`);
  const r14b = r14bR.value || {};
  check('R14 console: VU bars paint from avTap.levels (inject 0.8/0.4 -> scaleY matches, restored)',
    r14b.painted === true && Math.abs(r14b.l - 0.8) < 0.05 && Math.abs(r14b.r - 0.4) < 0.05
    && !!r14b.vu && Math.abs(r14b.vu.l - 0.8) < 0.05, JSON.stringify(r14b));

  /* 6ci. R15b: the SAMPLE PACKS card - mounted in the synth zone with pickers + facade */
  const r15aR = await ev(`(() => {
    window.__avZoneAuto('#av-import');
    const card = document.getElementById('av-import');
    const q = (s) => !!document.querySelector(s);
    const f = window.__avImport || {};
    return { card: !!card,
             zone: card && card.closest('.av-zone') ? card.closest('.av-zone').getAttribute('data-zone') : null,
             drop: q('[data-av-import-drop]'), file: q('#av-import-file'), dir: q('#av-import-dir'),
             pick: q('#av-import-pick'), pickdir: q('#av-import-pickdir'),
             status: q('#av-import-status'), report: q('#av-import-report'),
             lib: q('#av-import-lib'), slot: q('#av-import-slot'), note: q('#av-import-note'),
             empty: q('#av-import-empty'),
             facade: typeof f.importFiles, snap: typeof f.snap, ver: f.version || null };
  })()`);
  const r15a = r15aR.value || {};
  check('R15b import card: mounted in the store zone (drop + pickers + report + lib + facade)',
    r15a.card === true && r15a.zone === 'store' && r15a.drop === true && r15a.file === true && r15a.dir === true
    && r15a.pick === true && r15a.pickdir === true && r15a.status === true && r15a.report === true
    && r15a.lib === true && r15a.slot === true && r15a.note === true && r15a.empty === true
    && r15a.facade === 'function' && r15a.snap === 'function' && r15a.ver === 'r15b.0',
    JSON.stringify(r15a));

  /* 6cj. R15b: the pipeline - a synthetic WAV + AIFF + MIDI + stub run (sniff + policy + persist) */
  const r15bR = await ev(`(async () => {
    const sr = 8000, n = 64;
    const l = new Float32Array(n), r = new Float32Array(n);
    for (let i = 0; i < n; i++) { l[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr); r[i] = l[i]; }
    const wav = (typeof avWavEncode === 'function') ? avWavEncode({ l: l, r: r, sr: sr, bits: 16, dither: false }) : null;
    const bytes = [];
    const push = (...xs) => { for (const x of xs) bytes.push(x & 255); };
    const u32 = (v) => push(v >>> 24, v >>> 16, v >>> 8, v);
    const u16 = (v) => push(v >> 8, v);
    const tag = (s) => push(s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3));
    tag('FORM'); u32(62); tag('AIFF');
    tag('COMM'); u32(18); u16(1); u32(8); u16(16); push(0x40, 0x0B, 0xFA, 0, 0, 0, 0, 0, 0, 0);
    tag('SSND'); u32(24); u32(0); u32(0);
    for (let i = 0; i < 8; i++) u16(i * 0x1000);
    const aiff = new Uint8Array(bytes);
    const m = [];
    const mpush = (...xs) => { for (const x of xs) m.push(x & 255); };
    const mu32 = (v) => mpush(v >>> 24, v >>> 16, v >>> 8, v);
    const mu16 = (v) => mpush(v >> 8, v);
    const mtag = (s) => mpush(s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3));
    mtag('MThd'); mu32(6); mu16(0); mu16(1); mu16(480);
    mtag('MTrk'); mu32(13);
    mpush(0x00, 0x90, 60, 100, 0x83, 0x5F, 0x80, 60, 0, 0x00, 0xFF, 0x2F, 0x00);
    const mid = new Uint8Array(m);
    const files = [ new File([wav], 't.wav'), new File([aiff], 't.aiff'), new File([mid], 't.mid'), new File([new Uint8Array([1, 2, 3, 4])], 'x.exs') ];
    if (typeof avImportFiles !== 'function') return { missing: true };
    const rc = await avImportFiles(files);
    const byFmt = {};
    for (const it of rc.items) byFmt[it.format] = it.result;
    const ids = rc.items.filter(i => i.result === 'imported').map(i => i.id ? 1 : 0);
    return { counts: rc.counts, byFmt: byFmt, ids: ids,
             exsReason: (rc.items.find(i => i.format === 'exs') || {}).reason || '' };
  })()`);
  const r15b = r15bR.value || {};
  check('R15b import pipeline: WAV+AIFF+MIDI+stub run = 3 imports + 1 deferred refusal (sniffer honest)',
    !!r15b.counts && r15b.counts.total === 4 && r15b.counts.imported === 3 && r15b.counts.deferred === 1
    && r15b.counts.refused === 0 && r15b.counts.samples === 2 && r15b.counts.patterns === 1
    && r15b.byFmt.wav === 'imported' && r15b.byFmt.aiff === 'imported' && r15b.byFmt.mid === 'imported'
    && r15b.byFmt.exs === 'deferred' && String(r15b.exsReason).indexOf('.exs \u2014 ') === 0
    && r15b.ids.length === 3 && r15b.ids.every(x => x === 1), JSON.stringify(r15b));

  /* 6ck. R15b: the local library - list/load/remove round-trip (AIFF decode + MIDI pattern + undo) */
  const r15cR = await ev(`(async () => {
    if (typeof avLibList !== 'function' || typeof avLibLoad !== 'function' || typeof avLibRemove !== 'function') return { missing: true };
    const list0 = await avLibList();
    const items = (list0 && list0.items) || [];
    const aiff = items.find(i => i.format === 'aiff') || null;
    const mid = items.find(i => i.format === 'mid') || null;
    const n0 = avSampleStore.entries.length;
    const la = aiff ? await avLibLoad(aiff.id) : null;
    const entry = (la && la.entryId) ? avSampleStore.byId[la.entryId] : null;
    const lm = mid ? await avLibLoad(mid.id) : null;
    let notes = -1;
    try { const sn = avSeqSnap(); notes = 0; for (const t of sn.tracks) for (const s of t.steps) if (s.on === 1) notes++; } catch (e) { notes = -2; }
    const undoLabel = (window.__avUndo && typeof window.__avUndo.label === 'string') ? window.__avUndo.label : null;
    const dr = aiff ? await avLibRemove(aiff.id) : null;
    const dm = mid ? await avLibRemove(mid.id) : null;
    const list1 = await avLibList();
    return { n0: n0, n1: avSampleStore.entries.length,
             entryFrames: (entry && entry.buffer) ? entry.buffer.length : -1,
             entryRate: entry ? entry.sampleRate : -1,
             loadedA: !!(la && la.ok), loadedM: !!(lm && lm.ok), notes: notes, undoLabel: undoLabel,
             removed: !!(dr && dr.ok) && !!(dm && dm.ok),
             count0: (list0 && list0.count) || 0, count1: (list1 && list1.count) || 0 };
  })()`);
  const r15c = r15cR.value || {};
  check('R15b library: AIFF loads to the session (8 frames @ 8000 Hz), MIDI to the seq (undo=import), removes land',
    r15c.loadedA === true && r15c.loadedM === true && r15c.entryFrames === 8 && r15c.entryRate === 8000
    && r15c.n1 === r15c.n0 + 1 && r15c.notes >= 1 && r15c.undoLabel === 'import'
    && r15c.removed === true && r15c.count1 === r15c.count0 - 2, JSON.stringify(r15c));

  /* 6cl. R15c: EXS24 kit - synthetic .exs + sibling WAV import as a kit, LOAD lands it on the engine */
  const r15dR = await ev(`(async () => {
    const blk = (marker, size, name) => { const b = new Uint8Array(84 + size); b[0] = 1; b[1] = 1; b[2] = 0; b[3] = marker;
      b[4] = size & 255; b[5] = (size >>> 8) & 255; b[6] = 0; b[7] = 0;
      const cid = 'TBOS'; for (let i = 0; i < 4; i++) b[16 + i] = cid.charCodeAt(i);
      for (let i = 0; i < name.length && i < 63; i++) b[20 + i] = name.charCodeAt(i); return b; };
    const wr32 = (b, o, v) => { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; b[o + 2] = (v >>> 16) & 255; b[o + 3] = (v >>> 24) & 255; };
    const d = 84;
    const inst = blk(0, 88, 'RigKit');
    const zn = blk(1, 148, 'Z1'); zn[d + 1] = 60; zn[d + 6] = 36; zn[d + 7] = 51; zn[d + 9] = 1; zn[d + 10] = 127;
    wr32(zn, d + 12, 0); wr32(zn, d + 16, 50); wr32(zn, d + 92, 0);
    const smp = blk(3, 600, 'S1'); wr32(smp, d + 4, 400); wr32(smp, d + 8, 8000); smp[d + 12] = 16;
    const fn = 'kit-tone.wav'; for (let i = 0; i < fn.length; i++) smp[d + 336 + i] = fn.charCodeAt(i);
    const cat = (arrs) => { let n = 0; for (const a of arrs) n += a.length; const o = new Uint8Array(n); let off = 0; for (const a of arrs) { o.set(a, off); off += a.length; } return o; };
    const exs = cat([inst, zn, smp]);
    const sr = 8000, N = 400; const l = new Float32Array(N), r = new Float32Array(N);
    for (let i = 0; i < N; i++) { l[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr); r[i] = l[i]; }
    const wav = avWavEncode({ l: l, r: r, sr: sr, bits: 16, dither: false });
    const rc = await avImportFiles([ new File([exs], 'rig-kit.exs'), new File([wav], 'kit-tone.wav') ]);
    const kit = rc.items.find(i => i.format === 'exs') || null;
    const load = kit ? await avLibLoad(kit.id) : null;
    const sent = (avSampleStore.sent && avSampleStore.sent[0]) ? { name: avSampleStore.sent[0].name, slot: avSampleStore.sent[0].slot } : null;
    return { counts: rc.counts,
             kit: kit && { kind: kit.kind, result: kit.result, zones: (kit.meta && kit.meta.zones) ? kit.meta.zones.length : -1, sname: (kit.meta && kit.meta.samples && kit.meta.samples[0]) ? kit.meta.samples[0].name : null },
             load: load && { ok: load.ok, slots: load.slots, zones: load.zones }, sent: sent,
             kind: (typeof avParams === 'object' && avParams) ? avParams['engine.kind'] : null };
  })()`);
  const r15d = r15dR.value || {};
  check('R15c EXS kit: synthetic .exs + sibling WAV import as a kit; LOAD lands 1 zone on 1 slot + engine kind sampler',
    !!r15d.counts && r15d.counts.kits === 1 && !!r15d.kit && r15d.kit.kind === 'kit' && r15d.kit.result === 'imported'
    && r15d.kit.zones === 1 && r15d.kit.sname === 'kit-tone.wav' && !!r15d.load && r15d.load.ok === true
    && r15d.load.zones === 1 && r15d.load.slots === 1 && !!r15d.sent && r15d.sent.slot === 0 && r15d.kind === 'sampler',
    JSON.stringify(r15d));

  /* 6cm. R15c: ADG/ALS - gzip .als extracts refs + notes; the pattern shape loads into the seq core */
  const r15eR = await ev(`(async () => {
    if (typeof CompressionStream === 'undefined' || typeof avAlsExtract !== 'function') return { missing: true };
    const doc = '<?xml version="1.0"?><Ableton MajorVersion="12" Creator="Ableton Live 12.1"><LiveSet><Tempo><Manual Value="128"/></Tempo>'
      + '<FileRef><RelativePath Value="../Samples/Drums/Kick 01.WAV"/><Path Value="C:/x/Kick 01.WAV"/></FileRef>'
      + '<MidiClip><Notes><KeyTracks><KeyTrack><MidiKey Value="60"/><Notes><MidiNoteEvent Time="0" Duration="0.25" Velocity="100" IsEnabled="true"/></Notes></KeyTrack></KeyTracks></Notes></MidiClip></LiveSet></Ableton>';
    const enc = new TextEncoder().encode(doc);
    const cs = new CompressionStream('gzip');
    const w = cs.writable.getWriter(); w.write(enc); w.close();
    const gz = new Uint8Array(await new Response(cs.readable).arrayBuffer());
    const rc = await avImportFiles([ new File([gz], 'rig.als') ]);
    const it = rc.items.find(i => i.format === 'als') || null;
    const p = (it && it.meta) ? it.meta.pattern : null;
    const loaded = p ? avSeqLoad(p) === true : false;
    let notes = -1;
    if (loaded) { try { const sn = avSeqSnap(); notes = 0; for (const t of sn.tracks) for (const s of t.steps) if (s.on === 1) notes++; } catch (e) { notes = -2; } }
    return { counts: rc.counts, it: it && { kind: it.kind, result: it.result, refs: it.meta ? it.meta.refCount : -1, notes: it.meta ? it.meta.noteCount : -1, tempo: it.meta ? it.meta.tempoBpm : -1 }, loaded: loaded, seqNotes: notes };
  })()`);
  const r15e = r15eR.value || {};
  check('R15c ADG/ALS: gzip .als extracts 1 ref + 1 note @128 bpm; the mapped pattern loads into the seq core',
    !!r15e.counts && r15e.counts.refs === 1 && !!r15e.it && r15e.it.kind === 'refs' && r15e.it.result === 'imported'
    && r15e.it.refs === 1 && r15e.it.notes === 1 && r15e.it.tempo === 128 && r15e.loaded === true && r15e.seqNotes >= 1,
    JSON.stringify(r15e));

  /* 6cn. R15c: SerumPreset - synthetic container (native zstd when available; honest deferral otherwise) */
  const r15fR = await ev(`(async () => {
    if (typeof AVSerum !== 'object' || !AVSerum) return { missing: true };
    const enc = new TextEncoder();
    const txt = (s) => { const b = enc.encode(s); return [0x60 + b.length].concat(Array.from(b)); };
    const m = (pairs) => { const out = [0xa0 + pairs.length]; for (const kv of pairs) { out.push.apply(out, kv[0]); out.push.apply(out, kv[1]); } return out; };
    const inner = m([[txt('relativePathToWT'), txt('wt/table.wav')]]);
    const cbor = new Uint8Array(m([[txt('WTOsc0'), inner]]));
    const json = enc.encode(JSON.stringify({ fileType: 'SerumPreset', presetName: 'RIG' }));
    let payload = null, via = 'zstd';
    try {
      const cs = new CompressionStream('zstd');
      const w = cs.writable.getWriter(); w.write(cbor); w.close();
      payload = new Uint8Array(await new Response(cs.readable).arrayBuffer());
    } catch (err) { via = 'none'; }
    const head = new Uint8Array(9 + 8 + json.length + 8);
    head.set(enc.encode('XferJson\u0000'), 0);
    const dv = new DataView(head.buffer);
    dv.setBigUint64(9, BigInt(json.length), true);
    head.set(json, 17);
    const off = 17 + json.length;
    dv.setUint32(off, cbor.length, true); dv.setUint32(off + 4, 2, true);
    let file = head;
    if (payload) { file = new Uint8Array(head.length + payload.length); file.set(head, 0); file.set(payload, head.length); }
    const rc = await avImportFiles([ new File([file], 'rig.SerumPreset') ]);
    const it = rc.items[0] || {};
    const wt = (it.meta && it.meta.wtRefs && it.meta.wtRefs[0]) ? it.meta.wtRefs[0].path : null;
    return { via: via, result: it.result, kind: it.kind, pname: it.meta ? it.meta.presetName : null, wt: wt, reason: String(it.reason || '') };
  })()`);
  const r15f = r15fR.value || {};
  check(r15f.via === 'zstd'
    ? 'R15c SerumPreset: synthetic container imports as refs (wtRefs[0] path + JSON name extracted)'
    : 'R15c SerumPreset: without native zstd the container defers honestly (reason starts .SerumPreset)',
    r15f.via === 'zstd'
      ? (r15f.result === 'imported' && r15f.kind === 'refs' && r15f.pname === 'RIG' && r15f.wt === 'wt/table.wav')
      : (r15f.result === 'deferred' && String(r15f.reason).indexOf('.SerumPreset \u2014 ') === 0),
    JSON.stringify(r15f));

  /* 6co. R15d: SXT - the card fixture extracts REFE refs; clean run keeps errors empty */
  const r15gR = await ev(`(async () => {
    const sxt = Uint8Array.from(atob('Rk9STQAAAUxQVENIQ0FUIAAAAPBSRUZTUkVGRQAAAES8AQEAALwBAQAAAQAAAAAAAAABAAAACktpY2swMS53YXa8AQIAAAC8AQUAAAAAAAAGS2ljazAxAAAAAAAAAAANAAAAAFJFRkUAAACYvAEDAAC8AQEAAAEAAAAAAAAAAgAAAA1QaWFubyBzYW1wbGVzAAAACkdyYW5kUGlhbm+8AQIAAAC8AQUAAAAAAAAHU25hcmUwMgAAAAAAAAAADQAAAAAAAAALU25hcmUwMi53YXa8AQUAAAC8AQUAAAEAAAAAAAAAAgAAAAVEcnVtcwAAAAtTbmFyZTAyLndhdgC8AQUAAABERVNDAAAALbwBAwAAEgAAAAtGaXh0dXJlIFNYVAAAABROTlhUIERpZ2l0YWwgU2FtcGxlcgBBVVRIAAAAErwBAwAAAAAABUFudmlsAAAAAA=='), c => c.charCodeAt(0));
    const rc = await avImportFiles([ new File([sxt], 'rig.sxt') ]);
    const it = rc.items[0] || {};
    const meta = it.meta || {};
    const r0 = (meta.refs && meta.refs[0]) ? meta.refs[0] : null;
    return { format: it.format, kind: it.kind, result: it.result, reason: String(it.reason || ''),
             refCount: meta.refCount, r0name: r0 ? r0.name : null, r0path: r0 ? r0.path : null,
             pname: meta.presetName, mk: meta.kind, errN: rc.errors.length };
  })()`);
  const r15g = r15gR.value || {};
  check('R15d SXT: card fixture imports as refs (REFE names+paths) + clean errors channel',
    r15g.format === 'sxt' && r15g.kind === 'refs' && r15g.result === 'imported' && r15g.mk === 'sxt'
    && r15g.refCount === 2 && r15g.r0name === 'Kick01' && r15g.r0path === './Kick01.wav'
    && r15g.pname === 'Fixture SXT' && r15g.errN === 0,
    JSON.stringify(r15g));

  /* 6cp. R15d: legacy NKI (zlib-XML) - zones import as a kit; LOAD lands a slot + zones + sampler */
  const r15hR = await ev(`(async () => {
    const nki = Uint8Array.from(atob('f6iQEgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4nJWUUU+DMBDH3/cpmj7pCzDUORPYYowaw8uSmT3shTTuZE1KS0phzE9vKLjCYF187N39//eDXi9YVilDJcicCh7iqePh5WISRH78IrgilINElO+gCrGHEScphPiGF4zdYqSOGYQ4pzxhEGdSJJKk2Hh5zoOHFxOEglWTy+sDQrV5GxlYv9FKFRJQRFXPad44afmKSJKCApn/hRAKNq1BKViRAkYlYQVoBuyelO5QGrxLUWRdp8iPdWzA1kSnPa4nw3WRzcY3dQzeJUQd3woO556RH9fhDmhSI37smkMHc9bHtKL2cHOSZgzWikhl/mkfeVTxynfmGz3PLmHisAEmvqg6GpFVsafJfijxH6+1icCU382utuiW38+t5VII9Q/3H8FhYx+FEcVnwe31l8ZH59b6ZiwtvimDGCr/1KK5y/jZOZByrNmYY+C2Y9kf67P51VX6QZnH2X2JOt8uCb1CXLNDdO60nRa/nYg8fjw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04IiBzdGFuZGFsb25lPSJubyIgPz4KPHNvdW5kaW5mbyB2ZXJzaW9uPSI0MDAiPgogIDxwcm9wZXJ0aWVzPgogICAgPG5hbWU+Rml4dHVyZSBLaXQ8L25hbWU+CiAgICA8YXV0aG9yPkFudmlsIEZpeHR1cmU8L2F1dGhvcj4KICA8L3Byb3BlcnRpZXM+Cjwvc291bmRpbmZvPgo='), c => c.charCodeAt(0));
    const sr = 8000, N = 400; const l = new Float32Array(N), r = new Float32Array(N);
    for (let i = 0; i < N; i++) { l[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr); r[i] = l[i]; }
    const wav = avWavEncode({ l: l, r: r, sr: sr, bits: 16, dither: false });
    const rc = await avImportFiles([ new File([nki], 'rig.nki'), new File([wav], 'sample_A.wav') ]);
    const kit = rc.items.find(i => i.format === 'nki') || null;
    const load = kit ? await avLibLoad(kit.id) : null;
    return { counts: rc.counts,
             kit: kit && { kind: kit.kind, result: kit.result,
               zones: (kit.meta && kit.meta.zones) ? kit.meta.zones.length : -1,
               sname: (kit.meta && kit.meta.samples && kit.meta.samples[0]) ? kit.meta.samples[0].name : null },
             load: load && { ok: load.ok, slots: load.slots, zones: load.zones },
             kind: (typeof avParams === 'object' && avParams) ? avParams['engine.kind'] : null,
             errN: rc.errors.length };
  })()`);
  const r15h = r15hR.value || {};
  check('R15d NKI legacy: zlib-XML zones import as a kit; LOAD lands 1 zone on 1 slot + engine kind sampler',
    !!r15h.counts && r15h.counts.kits === 1 && !!r15h.kit && r15h.kit.kind === 'kit'
    && r15h.kit.result === 'imported' && r15h.kit.zones === 1 && r15h.kit.sname === 'sample_A.wav'
    && !!r15h.load && r15h.load.ok === true && r15h.load.zones === 1 && r15h.load.slots === 1
    && r15h.kind === 'sampler' && r15h.errN === 0,
    JSON.stringify(r15h));

  /* 6cq. R15d: containers - nki refs + nbkt metadata + the encrypted refusal */
  const r15iR = await ev(`(async () => {
    const cN = Uint8Array.from(atob('tQIAAAAAAAABAAAAaHNpbgEAAAAAAAAAAAECAwQFBgcICQoLDA0ODxgAAAAAAAAARFNJTgEAAAABAAAAAQAAAAEAAAABAAAAAAAAADRLSU4DAAAAYQIAAAAAAAABAAAAaHNpbgEAAAAAAAAAAAECAwQFBgcICQoLDA0OD0sAAAAAAAAARFNJTmUAAAABAAAAGAAAAAAAAABEU0lOAQAAAAEAAAABAAAAAQAAAAACAAAAAQAAAAcAAAA2AC4ANwAuADEALgAwAAEAAAACAAAAAAAAAERTSU5sAAAA4AAAAAAAAAABAAAAaHNpbgEAAAAAAAAAAAECAwQFBgcICQoLDA0OD7AAAAAAAAAARFNJTmwAAAABAAAAGAAAAAAAAABEU0lOAQAAAAEAAAABAAAAAQAAAAEAAAAAAAAAAAAAAAsAAABGAGkAeAB0AHUAcgBlACAASwBpAHQADQAAAEEAbgB2AGkAbAAgAEYAaQB4AHQAdQByAGUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAABAAAARFNJTm0AAADuAAAAAAAAAAEAAABoc2luAQAAAAAAAAAAAQIDBAUGBwgJCgsMDQ4PvgAAAAAAAABEU0lObQAAAAEAAAAYAAAAAAAAAERTSU4BAAAAAQAAAAEAAAABAAAAAQAAAAEAAAB2AAAAAAAAAEsAcAAAAAIAAAAAAAIAAAACAAAAAggAAABGAGkAeAB0AHUAcgBlAHMABAoAAABrAGkAYwBrAF8AQQAuAHcAYQB2AAIAAAACCAAAAEYAaQB4AHQAdQByAGUAcwAECwAAAHMAbgBhAHIAZQBfAEEALgB3AGEAdgAAAAAADWJlhQEAAAAAAAAA'), c => c.charCodeAt(0));
    const cB = Uint8Array.from(atob('swIAAAAAAAABAAAAaHNpbgEAAAAAAAAAAAECAwQFBgcICQoLDA0ODxgAAAAAAAAARFNJTgEAAAABAAAAAQAAAAEAAAABAAAAAAAAADRLSU4DAAAAXwIAAAAAAAABAAAAaHNpbgEAAAAAAAAAAAECAwQFBgcICQoLDA0OD00AAAAAAAAARFNJTmUAAAABAAAAGAAAAAAAAABEU0lOAQAAAAEAAAABAAAAAQAAAAAJAAAAAQAAAAgAAAA0AC4AMQAuADYALgAyADcAAQAAAAIAAAAAAAAARFNJTmwAAADoAAAAAAAAAAEAAABoc2luAQAAAAAAAAAAAQIDBAUGBwgJCgsMDQ4PuAAAAAAAAABEU0lObAAAAAEAAAAYAAAAAAAAAERTSU4BAAAAAQAAAAEAAAABAAAAAQAAAAAAAAAAAAAADwAAAEIAYQB0AHQAZQByAHkAIABGAGkAeAB0AHUAcgBlAA0AAABBAG4AdgBpAGwAIABGAGkAeAB0AHUAcgBlAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAERTSU5tAAAA4gAAAAAAAAABAAAAaHNpbgEAAAAAAAAAAAECAwQFBgcICQoLDA0OD7IAAAAAAAAARFNJTm0AAAABAAAAGAAAAAAAAABEU0lOAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAagAAAAAAAABLAGQAAAACAAAAAAACAAAAAgAAAAIFAAAARAByAHUAbQBzAAQKAAAAawBpAGMAawBfAEIALgB3AGEAdgACAAAAAgUAAABEAHIAdQBtAHMABAsAAABzAG4AYQByAGUAXwBCAC4AdwBhAHYAAAAAAA1iZYUBAAAAAAAAAA=='), c => c.charCodeAt(0));
    const cE = Uint8Array.from(atob('TwMAAAAAAAABAAAAaHNpbgEAAAAAAAAAAAECAwQFBgcICQoLDA0ODxgAAAAAAAAARFNJTgEAAAABAAAAAQAAAAEAAAABAAAAAAAAADRLSU4DAAAA+wIAAAAAAAABAAAAaHNpbgEAAAAAAAAAAAECAwQFBgcICQoLDA0OD0sAAAAAAAAARFNJTmUAAAABAAAAGAAAAAAAAABEU0lOAQAAAAEAAAABAAAAAQAAAAACAAAAAQAAAAcAAAA2AC4ANwAuADEALgAwAAEAAAADAAAAAAAAAERTSU5sAAAA4AAAAAAAAAABAAAAaHNpbgEAAAAAAAAAAAECAwQFBgcICQoLDA0OD7AAAAAAAAAARFNJTmwAAAABAAAAGAAAAAAAAABEU0lOAQAAAAEAAAABAAAAAQAAAAEAAAAAAAAAAAAAAAsAAABGAGkAeAB0AHUAcgBlACAASwBpAHQADQAAAEEAbgB2AGkAbAAgAEYAaQB4AHQAdQByAGUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAABAAAARFNJTm0AAAC6AAAAAAAAAAEAAABoc2luAQAAAAAAAAAAAQIDBAUGBwgJCgsMDQ4PigAAAAAAAABEU0lObQAAAAEAAAAYAAAAAAAAAERTSU4BAAAAAQAAAAEAAAABAAAAAQAAAAEAAABCAAAAAAAAAEsAPAAAAAIAAAAAAAEAAAACAAAAAggAAABGAGkAeAB0AHUAcgBlAHMABAoAAABrAGkAYwBrAF8AQQAuAHcAYQB2AAAAAAANYmWFAQAAAAAAAAACAAAARFNJTnQAAADCAAAAAAAAAAEAAABoc2luAQAAAAAAAAAAAQIDBAUGBwgJCgsMDQ4PkgAAAAAAAABEU0lOdAAAAAEAAAB5AAAAAAAAAERTSU5zAAAAAQAAABgAAAAAAAAARFNJTgEAAAABAAAAAQAAAAEAAAABAAQAAEAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqAQAAAAABAAAAAAAAAA=='), c => c.charCodeAt(0));
    const rc = await avImportFiles([ new File([cN], 'rig.nki'), new File([cB], 'rig.nbkt'), new File([cE], 'locked.nki') ]);
    const a = rc.items[0] || {}; const b = rc.items[1] || {}; const c = rc.items[2] || {};
    return { aRes: a.result, aKind: a.kind, aMk: a.meta && a.meta.kind, aName: a.meta && a.meta.presetName, aRefs: a.meta && a.meta.refCount,
             bRes: b.result, bKind: b.kind, bMk: b.meta && b.meta.kind, bName: b.meta && b.meta.presetName,
             cRes: c.result, cReason: String(c.reason || ''), errN: rc.errors.length };
  })()`);
  const r15i = r15iR.value || {};
  check('R15d containers: NKI refs + NBKT metadata import; encrypted refuses with the pinned line',
    r15i.aRes === 'imported' && r15i.aKind === 'refs' && r15i.aMk === 'nki-container' && r15i.aName === 'Fixture Kit' && r15i.aRefs === 2
    && r15i.bRes === 'imported' && r15i.bKind === 'refs' && r15i.bMk === 'nbkt' && r15i.bName === 'Battery Fixture'
    && r15i.cRes === 'refused' && String(r15i.cReason).indexOf('.nki \u2014 encrypted') === 0
    && r15i.errN === 0,
    JSON.stringify(r15i));

  /* 6cr. R16: zip - the packed fixture expands into a bundle row + honest children */
  const r16aR = await ev(`(async () => {
    const u8 = Uint8Array.from(atob('UEsDBBQAAAAAAAAAIVwRjeQ8TAMAAEwDAAAIAAAAa2ljay53YXZSSUZGRAMAAFdBVkVmbXQgEAAAAAEAAQBAHwAAgD4AAAIAEABkYXRhIAMAAAAArRXLKBU33T41PxQ4UiqPFwICOuzH2PfJjMGCwPvGMdSW5vz72hGdJe40/D22P+g5QC0/GwUGFvAI3DrMjMIhwETFWdHz4vv39Q1KIpEy3Tz3P4A7ATDUHgIKA/Rt37HOysMBwMrDsc5t3wP0AgrUHgEwgDv3P908kTJKIvUN+/fz4lnRRMUhwIzCOswI3BbwBQY/G0At6Dm2P/w97jSdJdoR/PuW5jHU+8aCwIzB98nH2DrsAgKPF1IqFDg1P90+FTfLKK0VAABT6jXX68gjwcvA7Meu1XHo/v3GEzknCTZ0Pn4/BTnPK2oZBAQm7mPaEssEwkrAGMbA0sHk+/nqD/gjxjN0Pd8/vDqnLg0dBQgL8rbdb80jwwnAgMT/zyzh/vX9C5MgTzE2PP8/NjxPMZMg/Qv+9Szh/8+AxAnAI8NvzbbdC/IFCA0dpy68Ot8/dD3GM/gj6g/7+cHkwNIYxkrABMISy2PaJu4EBGoZzysFOX4/dD4JNjknxhP+/XHortXsx8vAI8HryDXXU+oAAK0VyygVN90+NT8UOFIqjxcCAjrsx9j3yYzBgsD7xjHUlub8+9oRnSXuNPw9tj/oOUAtPxsFBhbwCNw6zIzCIcBExVnR8+L79/UNSiKRMt089z+AOwEw1B4CCgP0bd+xzsrDAcDKw7HObd8D9AIK1B4BMIA79z/dPJEySiL1Dfv38+JZ0UTFIcCMwjrMCNwW8AUGPxtALeg5tj/8Pe40nSXaEfz7luYx1PvGgsCMwffJx9g67AICjxdSKhQ4NT/dPhU3yyitFQAAU+o11+vII8HLwOzHrtVx6P79xhM5Jwk2dD5+PwU5zytqGQQEJu5j2hLLBMJKwBjGwNLB5Pv56g/4I8YzdD3fP7w6py4NHQUIC/K23W/NI8MJwIDE/88s4f71/QuTIE8xNjz/PzY8TzGTIP0L/vUs4f/PgMQJwCPDb8223QvyBQgNHacuvDrfP3Q9xjP4I+oP+/nB5MDSGMZKwATCEstj2ibuBARqGc8rBTl+P3Q+CTY5J8YT/v1x6K7V7MfLwCPB68g111PqUEsDBBQAAAAIAAAAIVwOpCWjiQIAAIQCAAANAAAAc3ViL3NuYXJlLndhdgGEAnv9UklGRnwCAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YVgCAAAAALUfFTf9PxQ4cCECAg7i98kTwPvG3tz8+ycc7jTMP+g5zCQFBqrlOsxkwETFlNn7930YkTJcP4A7AygCCmHpsc71wMrDcNYD9LoUATCrPt08Eiv1DS/tWdHGwYzCd9MW8OMQQC26Pfw99S3aERDxMdTVwozBq9A67PoMUiqMPN0+qjCtFQD1NdcjxMvADs5x6AQJOScgO34/LTNqGfv4Y9qtxUrApMvB5AUF+CN4Od8/fTUNHf38tt1xxwnAb8ks4QEBkyCXN/8/lzeTIAEBLOFvyQnAcce23f38DR19Nd8/eDn4IwUFweSky0rArcVj2vv4ahktM34/IDs5JwQJcegOzsvAI8Q11wD1rRWqMN0+jDxSKvoMOuyr0IzB1cIx1BDx2hH1Lfw9uj1ALeMQFvB304zCxsFZ0S/t9Q0SK908qz4BMLoUA/Rw1srD9cCxzmHpAgoDKIA7XD+RMn0Y+/eU2UTFZMA6zKrlBQbMJOg5zD/uNCcc/Pve3PvGE8D3yQ7iAgJwIRQ4/T8VN7UfAABL4OvIA8Dsx5De/v3yHQk27T8FOSIjBATZ4xLLNMAYxjTb+/lWGsYznD+8OmwmBQiD52/NpMCAxP3X/vWfFk8xCz82PJAp/QtG6//PVcEjw+7UC/LREqcuOj50PYks6g8d78DSRsIEwgvSJu7wDs8rKz10PlUvxhMG867VdMMjwVbPU+oAC8so3Ts1P/Ixjxf89sfY4MSCwNPMluYFB50lUzq2P1w0Pxv7+gjciMYhwIPK8+IDA0oijzj3P5E21B7//m3fachQSwMEFAAAAAAAAAAhXK8slwYMAAAADAAAAAkAAABub3Rlcy50eHRoZWxsbyBhbnZpbApQSwMEFAAAAAAAAAAhXAAAAAAAAAAAAAAAAAQAAABzdWIvUEsBAhQAFAAAAAAAAAAhXBGN5DxMAwAATAMAAAgAAAAAAAAAAAAAAIABAAAAAGtpY2sud2F2UEsBAhQAFAAAAAgAAAAhXA6kJaOJAgAAhAIAAA0AAAAAAAAAAAAAAIABcgMAAHN1Yi9zbmFyZS53YXZQSwECFAAUAAAAAAAAACFcryyXBgwAAAAMAAAACQAAAAAAAAAAAAAAgAEmBgAAbm90ZXMudHh0UEsBAhQAFAAAAAAAAAAhXAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAIABWQYAAHN1Yi9QSwUGAAAAAAQABADaAAAAewYAAAAA'), c => c.charCodeAt(0));
    const rc = await avImportFiles([ new File([u8], 'rig-pack.zip') ]);
    const byName = (n) => rc.items.find(i => i.name === n) || null;
    const bundle = rc.items[0] || {};
    const kick = byName('kick.wav'); const snare = byName('snare.wav'); const txt = byName('notes.txt');
    const load = (kick && kick.id) ? await avLibLoad(kick.id) : null;
    const ent = (load && load.entryId) ? avSampleStore.byId[load.entryId] : null;
    return { counts: rc.counts, errN: rc.errors.length,
      bKind: bundle.kind, bRes: bundle.result, bMeta: bundle.meta || {},
      kickR: kick ? kick.result : null, snareR: snare ? snare.result : null, snarePath: snare ? snare.path : null,
      txtR: txt ? txt.result : null, txtWhy: txt ? String(txt.reason || '') : null,
      entry: ent ? { frames: ent.buffer ? ent.buffer.length : -1, rate: ent.sampleRate } : null };
  })()`);
  const r16a = r16aR.value || {};
  check('R16 zip: bundle row + children import (kick/snare samples, notes.txt refused) + child LOADs',
    !!r16a.counts && r16a.counts.bundles === 1 && r16a.counts.total === 4 && r16a.counts.imported === 3
    && r16a.counts.samples === 2 && r16a.counts.refused === 1 && r16a.errN === 0
    && r16a.bKind === 'bundle' && r16a.bRes === 'imported'
    && r16a.bMeta.entries === 3 && r16a.bMeta.expanded === 3
    && r16a.kickR === 'imported' && r16a.snareR === 'imported' && String(r16a.snarePath || '').indexOf('rig-pack.zip/') >= 0
    && r16a.txtR === 'refused' && !!r16a.entry && r16a.entry.frames === 2400 && r16a.entry.rate === 48000,
    JSON.stringify(r16a));

  /* 6cs. R16: f64-WAV - tag-3/64-bit imports; LOAD lands through the clean-room route */
  const r16bR = await ev(`(async () => {
    const N = 200, sr = 8000;
    const head = new ArrayBuffer(44); const dv = new DataView(head);
    const wrS = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    wrS(0, 'RIFF'); dv.setUint32(4, 36 + N * 16, true); wrS(8, 'WAVE'); wrS(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 3, true); dv.setUint16(22, 2, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 16, true); dv.setUint16(32, 16, true); dv.setUint16(34, 64, true);
    wrS(36, 'data'); dv.setUint32(40, N * 16, true);
    const data = new DataView(new ArrayBuffer(N * 16));
    for (let i = 0; i < N; i++) { const v = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr); data.setFloat64(i * 16, v, true); data.setFloat64(i * 16 + 8, v, true); }
    const rc = await avImportFiles([ new File([head, data.buffer], 'rig64.wav') ]);
    const it = rc.items[0] || {}; const meta = it.meta || {};
    const load = it.id ? await avLibLoad(it.id) : null;
    const ent = (load && load.entryId) ? avSampleStore.byId[load.entryId] : null;
    return { result: it.result, bits: meta.bits, rate: meta.rate, ch: meta.channels, errN: rc.errors.length,
             ok: load && load.ok, eid: !!(load && load.entryId),
             entry: ent ? { frames: ent.buffer ? ent.buffer.length : -1, rate: ent.sampleRate } : null };
  })()`);
  const r16b = r16bR.value || {};
  check('R16 f64-WAV: imports (meta bits 64) + LOAD lands via the clean-room route (200 frames @ 8000)',
    r16b.result === 'imported' && r16b.bits === 64 && r16b.rate === 8000 && r16b.ch === 2 && r16b.errN === 0
    && r16b.ok === true && r16b.eid === true
    && !!r16b.entry && r16b.entry.frames === 200 && r16b.entry.rate === 8000,
    JSON.stringify(r16b));

  /* 6ct. R16: REX2->chop - a stashed slice table drives detect/kit/apply (via rex2) */
  const r16cR = await ev(`(async () => {
    const es = avSampleStore.entries; let ent = null;
    for (let i = es.length - 1; i >= 0; i--) { const e = es[i]; if (e && e.buffer && e.buffer.length === 200 && e.sampleRate === 8000) { ent = e; break; } }
    if (!ent) return { missing: true };
    ent.rexSlices = [ { start: 0, len: 50 }, { start: 50, len: 50 }, { start: 100, len: 100 } ];
    const det = avChopDetect(ent.id);
    const kit = (det && det.ok) ? avChopKitNew(ent.id) : null;
    const apl = (kit && kit.ok) ? avChopApply(kit) : null;
    const s2 = (det && det.slices && det.slices[2]) ? det.slices[2] : null;
    return { via: det && det.via, count: det && det.count, s2: s2 ? { s0: s2.s0, s1: s2.s1 } : null,
             kitOk: kit && kit.ok, kitN: kit && kit.slices ? kit.slices.length : -1,
             aplOk: apl && apl.ok, slot: apl && apl.slot };
  })()`);
  const r16c = r16cR.value || {};
  check('R16 REX2->chop: slice table drives detect (via rex2) -> kit -> apply',
    r16c.via === 'rex2' && r16c.count === 3 && r16c.s2 && r16c.s2.s0 === 100 && r16c.s2.s1 === 200
    && r16c.kitOk === true && r16c.kitN === 3 && r16c.aplOk === true && r16c.slot === 0,
    JSON.stringify(r16c));

  /* 6cu. R17: the import hub v1 - manager controls + runs + storage footer + facade fns */
  const r17aR = await ev(`(() => {
    window.__avZoneAuto('#av-import');
    const q = (s) => !!document.querySelector(s);
    const f = window.__avImport || {};
    return { search: q('#av-import-search'), sort: q('#av-import-sort'), filters: q('#av-import-filters'),
             selall: q('#av-import-selall'), delsel: q('#av-import-delsel'),
             runs: q('#av-import-runs'), runsclear: q('#av-import-runsclear'),
             storage: q('#av-import-storage'), persist: q('#av-import-persist'),
             pick: typeof f.pick, pickDir: typeof f.pickDir, library: typeof f.library,
             rename: typeof f.rename, exportItem: typeof f.exportItem };
  })()`);
  const r17a = r17aR.value || {};
  check('R17 hub: manager ids + runs + storage footer + facade pick/pickDir/library/rename/exportItem',
    r17a.search === true && r17a.sort === true && r17a.filters === true && r17a.selall === true
    && r17a.delsel === true && r17a.runs === true && r17a.runsclear === true && r17a.storage === true
    && r17a.persist === true && r17a.pick === 'function' && r17a.pickDir === 'function'
    && r17a.library === 'function' && r17a.rename === 'function' && r17a.exportItem === 'function',
    JSON.stringify(r17a));

  /* R21: the library overlay shell - present + hidden at boot, hosts the manager (containment),
     the card strip + open ids resolve, the __avLibrary facade shape is pinned. Read-only: the
     smoke run never opens the overlay, so hidden === true holds at this point. */
  const r21aR = await ev(`(() => {
    const pop = document.getElementById('av-library-pop');
    const f = window.__avLibrary || {};
    return { pop: !!pop, hidden: pop ? pop.hidden === true : null,
             containsLib: !!(pop && pop.contains(document.getElementById('av-import-lib'))),
             containsSearch: !!(pop && pop.contains(document.getElementById('av-import-search'))),
             libsum: !!document.getElementById('av-import-libsum'),
             libopen: !!document.getElementById('av-import-libopen'),
             open: typeof f.open, close: typeof f.close, toggle: typeof f.toggle,
             isOpen: typeof f.isOpen, note: typeof f.note, version: String(f.version || '') };
  })()`);
  const r21a = r21aR.value || {};
  check('R21 library overlay: #av-library-pop exists hidden at boot + contains #av-import-lib and #av-import-search; #av-import-libsum + #av-import-libopen present; __avLibrary facade open/close/toggle/isOpen/note + version r21.0',
    r21a.pop === true && r21a.hidden === true
    && r21a.containsLib === true && r21a.containsSearch === true
    && r21a.libsum === true && r21a.libopen === true
    && r21a.open === 'function' && r21a.close === 'function' && r21a.toggle === 'function'
    && r21a.isOpen === 'function' && r21a.note === 'function' && r21a.version === 'r21.0',
    JSON.stringify(r21a));

  /* 6cv. R17: the File menu carries the import + library entries */
  const r17bR = await ev(`(() => {
    let labels = [];
    try {
      if (window.__avMenubar && typeof window.__avMenubar.open === 'function') {
        window.__avMenubar.open('file');
        const pop = document.getElementById('av-menu-pop');
        labels = pop ? Array.prototype.map.call(pop.querySelectorAll('.av-menu-mi'), function (el) { return String(el.textContent || '').trim(); }) : [];
        window.__avMenubar.close();
      }
    } catch (e) { labels = []; }
    return { labels: labels };
  })()`);
  const r17b = r17bR.value || {};
  check('R17 hub: File menu carries Import sounds / Import folder / Library',
    Array.isArray(r17b.labels) && r17b.labels.indexOf('Import sounds...') >= 0
    && r17b.labels.indexOf('Import folder...') >= 0 && r17b.labels.indexOf('Library...') >= 0,
    JSON.stringify(r17b.labels));

  /* R19: user packs - the manager button + the __avPack facade shape */
  const r19R = await ev(`(() => {
    try { if (typeof window.__avZoneAuto === 'function') window.__avZoneAuto('#av-import'); } catch (e) {}
    const btn = document.getElementById('av-import-pack');
    const f = window.__avPack || {};
    const fns = ['validate', 'detect', 'build', 'importBytes'].filter(k => typeof f[k] === 'function');
    return { btn: !!btn, label: btn ? String(btn.textContent || '').trim() : '', version: String(f.version || ''), fns: fns.length };
  })()`);
  const r19 = r19R.value || {};
  check('R19 user packs: #av-import-pack in the manager + __avPack facade complete',
    r19.btn === true && /^COLLECT & PACK/.test(r19.label) && r19.version === 'r19.0' && r19.fns === 4,
    JSON.stringify(r19));

  /* R18b: linked source folders - the section mounts in the hub card + the facade shape */
  const r18bR = await ev(`(() => {
    try { if (typeof window.__avZoneAuto === 'function') window.__avZoneAuto('#av-import'); } catch (e) {}
    const host = document.getElementById('av-sources-host');
    const sec = host ? !!host.querySelector('.av-sources') : false;
    const f = window.__avSources || {};
    const fns = ['link', 'scan', 'importNew', 'unlink', 'reconnect', 'setFs', 'list'].filter(k => typeof f[k] === 'function');
    return { host: !!host, sec: sec, version: String(f.version || ''), fns: fns.length, fsKind: typeof f.fsKind === 'function' ? f.fsKind() : null };
  })()`);
  const r18b = r18bR.value || {};
  check('R18b linked sources: section mounted in the hub card + __avSources facade complete',
    r18b.host === true && r18b.sec === true && r18b.version === 'r18b.0' && r18b.fns === 7,
    JSON.stringify(r18b));

  /* R18a layout guard: no text button overflows its box (the owner-clip defect class --
     a text label on the fixed .av-btn 26x26 icon box wraps/spills and collides with its
     neighbour; swept across all zones so the class cannot recur silently). */
  const ogR = await ev(`(async () => {
    const zones = ['synth', 'fx', 'mod', 'seq', 'studio', 'store', 'code', 'system'];
    const bad = [];
    const sweepBtn = function (zone, el) {
      try {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        const txt = (el.textContent || '').trim();
        if (txt.length <= 2) return;
        const rng = document.createRange(); rng.selectNodeContents(el);
        const textW = rng.getBoundingClientRect().width;
        const cs = getComputedStyle(el);
        const contentW = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
        const wrapOver = el.scrollHeight - el.clientHeight;
        if (textW > contentW + 1.5 || wrapOver > 1) bad.push({ zone: zone, id: el.id || String(el.className).slice(0, 32), t: txt.slice(0, 18),
          textW: Math.round(textW * 10) / 10, contentW: Math.round(contentW * 10) / 10, wrapOver: wrapOver });
      } catch (e) { /* skip */ }
    };
    for (let zi = 0; zi < zones.length; zi++) {
      const z = zones[zi];
      try { if (typeof avZoneShow === 'function') avZoneShow(z, { source: 'smoke' }); } catch (e) { /* keeps sweeping */ }
      await new Promise(function (res) { setTimeout(res, 200); });
      const pane = document.getElementById('av-zone-' + z);
      if (!pane) { bad.push({ zone: z, id: 'NO-PANE' }); continue; }
      const els = pane.querySelectorAll('button');
      for (let i = 0; i < els.length; i++) sweepBtn(z, els[i]);
    }
    return { bad: bad, zones: zones.length };
  })()`);
  const og = (ogR && ogR.value) ? ogR.value : {};
  check('R18a layout guard: no button label overflows its box (all zones swept)',
    !!og && og.zones === 8 && Array.isArray(og.bad) && og.bad.length === 0,
    JSON.stringify(og.bad ? og.bad.slice(0, 6) : og));

  /* 6cw. T wave: the TUNE card (microtuning studio) - mounted with its host populated
     (the smoke check count moves 78 -> 79 with this leg) */
  const tuneR = await ev(`(() => {
    try { if (typeof window.__avZoneAuto === 'function') window.__avZoneAuto('#av-tune'); } catch (e) { }
    const card = document.getElementById('av-tune');
    const host = document.getElementById('av-tune-host');
    return { card: !!card, host: !!host,
             children: host ? host.children.length : 0,
             scale: !!document.getElementById('av-tune-scale'),
             root: !!document.getElementById('av-tune-root'),
             morph: !!document.getElementById('av-tune-morph'),
             mts: !!document.getElementById('av-tune-mts'),
             status: !!document.getElementById('av-tune-status'),
             tuneUi: typeof window.__avTuneUi, coreApi: typeof window.__avTune };
  })()`);
  const tune = tuneR.value || {};
  check('T wave TUNE: card mounted + host populated (scale \u00b7 root \u00b7 morph \u00b7 MTS \u00b7 status)',
    tune.card === true && tune.host === true && tune.children > 0
    && tune.scale === true && tune.root === true && tune.morph === true && tune.mts === true && tune.status === true,
    JSON.stringify(tune));

  /* 6cd. R12: the proof gate — a PLAIN load (no ?avtest=1) renders ZERO proof text */
  const plainUrl = 'file:///' + path.resolve(page).replace(/\\/g, '/');
  await send('Page.navigate', { url: plainUrl });
  let plainReady = false;
  for (let i = 0; i < 120 && !plainReady; i++) {
    const r = await ev(`document.documentElement.getAttribute('data-av-ready') === '1'`);
    if (r.value === true) plainReady = true;
    else await sleep(300);
  }
  await sleep(600);
  const leakR = await ev(`(() => {
    const host = document.getElementById('av-proofs');
    return {
      hits: ((document.body.innerText || '').match(/SELFTEST/g) || []).length,
      hostText: host ? String(host.textContent || '').trim() : null,
      consoleEl: !!document.getElementById('av-consoletest'),
    };
  })()`);
  const leak = leakR.value || {};
  check('R12 proof gate: a plain load (no ?avtest=1) renders zero SELFTEST text + an empty proof host',
    plainReady === true && leak.hits === 0 && (leak.hostText === null || leak.hostText === '') && leak.consoleEl === false,
    JSON.stringify({ plainReady: plainReady, leak: leak }));

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
