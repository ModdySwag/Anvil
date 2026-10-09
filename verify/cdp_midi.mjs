// cdp_midi.mjs — Anvil MIDI-deck suite (P0b Child B): the Web MIDI port —
// states · ports · decode · play-in routing · monitor caps · out tap · CC learn · clock out —
// exercised end-to-end over raw CDP against a stubbed browser MIDI stack injected BEFORE boot.
//
//   node verify/cdp_midi.mjs
//
// Launch skeleton copied from cdp_smoke.mjs: new-headless Chromium (candidates list), free-port
// scan from 9400, temp --user-data-dir, 1440×900 device metrics, --mute-audio, explicit exit,
// process.on('exit') kills ONLY processes whose command line carries OUR temp profile.
//
// The Web MIDI stub is Pattern Forge verify/test_midi.mjs L41-121 ported in shape: fake
// requestMIDIAccess with modes unsupported|grant|deny, Port/InPort/OutPort classes with
// OutPort on window.MIDIOutput (so the app's send-tap patches OUR class, as it would a real one),
// hotplug + input-byte injection through window.__MIDI_STUB, injected via
// Page.addScriptToEvaluateOnNewDocument *then* navigate — it exists before the app's first line.
//
// Checks: freeze sha · stub modes + no-sysex · hotplug add/remove · play-in through the ONE note
// bus (avNoteHeld / __lastNotePreview / avNoteGains) · monitor flood (1200 → totals/ring/dropped,
// ≤12 DOM rows a side, clear) · out tap (isOurPortClass, TEST NOTE real bytes) · CC learn
// (arm → CC pick → bind-click swallowed → hardware drives the knob → ✕ unbind → 200-msg burst
// coalescing) · clock out (one 0xFA → 0xF8 @ ~24 ppqn, ±30% mean gap at avState.bpm=120 →
// 0xFC freezes the wire) · zero console errors · screenshot. Exits non-zero on any fail.
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = path.join(here, '..', 'index.html');
if (!existsSync(page)) { console.error('page not found: ' + page); process.exit(2); }

/* FREEZE LAW: the bytes under test are named before anything runs, and re-checked after. */
const EXPECT_SHA = 'e99ea8e572b3572dbbb3f080ae069ccde5ae32e0bbc7c9a9c66e9b0328f35ffd';
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
const PORT = await freePort(9400);
const profile = path.join(tmpdir(), 'anvil-midi-' + Date.now());
const url = 'file:///' + page.replace(/\\/g, '/');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
console.log('cdp port ' + PORT + ' · profile ' + profile);

let pass = 0, fail = 0;
const appBugs = [];
const check = (name, ok, info) => {
  if (ok) { pass++; console.log(' ok   ' + name + (info ? '  -> ' + info : '')); }
  else { fail++; console.log(' FAIL ' + name + (info ? '  -> ' + info : '')); }
};
const note = (t) => console.log('   · ' + t);
const bug = (what, expected, actual, howToSee) => {
  const line = what + ' — expected: ' + expected + ' · actual: ' + actual + ' · to see: ' + howToSee;
  appBugs.push(line);
  console.log(' BUG  ' + line);
};

/* ───────────────────── the injected Web MIDI stub (runs before the app's first line) ─────────────────────
   Exact shape from Pattern Forge verify/test_midi.mjs L41-121: the app only ever sees
   navigator.requestMIDIAccess / MIDIOutput / MIDIInput; the stub's ports are instances of the class
   put on window.MIDIOutput, so the app's outgoing tap (a patch of MIDIOutput.prototype.send) is
   exercised the way a real browser exercises it. */
const STUB = `(() => {
  const log = { calls: [], outs: [], overrodeMIDIOutput: false, listenerErrors: [] };
  const inputs = new Map();
  const outputs = new Map();
  let mode = 'unsupported';   /* unsupported | grant | deny */

  function Port(type, id, name, man, state) {
    this.type = type; this.id = id; this.name = name;
    this.manufacturer = man || '';
    this.state = state || 'connected';
    this.connection = 'closed';
    this.version = '1.0';
    this._listeners = [];
  }
  Port.prototype.addEventListener = function (t, f) { if (t === 'midimessage' && this._listeners.indexOf(f) < 0) this._listeners.push(f); };
  Port.prototype.removeEventListener = function (t, f) { const i = this._listeners.indexOf(f); if (i >= 0) this._listeners.splice(i, 1); };
  Port.prototype.open = function () { this.connection = 'open'; return Promise.resolve(this); };
  Port.prototype.close = function () { this.connection = 'closed'; return Promise.resolve(this); };
  Port.prototype.fire = function (bytes) {
    const data = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes);
    const ev = { type: 'midimessage', data: data, target: this, currentTarget: this, srcElement: this, timeStamp: Date.now() };
    this._listeners.slice().forEach(f => { try { f(ev); } catch (e) { log.listenerErrors.push(String(e && e.message || e)); } });
    return this;
  };
  function InPort(id, name, man, state) { Port.call(this, 'input', id, name, man, state); }
  InPort.prototype = Object.create(Port.prototype);
  InPort.prototype.constructor = InPort;
  function OutPort(id, name, man, state) { Port.call(this, 'output', id, name, man, state); }
  OutPort.prototype = Object.create(Port.prototype);
  OutPort.prototype.constructor = OutPort;
  OutPort.prototype.send = function (data) { log.outs.push({ name: this.name, id: this.id, data: Array.from(data), t: Date.now() }); };

  const access = {
    inputs: inputs, outputs: outputs, sysexEnabled: false,
    onstatechange: null, onconnect: null, ondisconnect: null,
    addEventListener: function () {}, removeEventListener: function () {},
  };
  function fire(type, port) {
    const ev = { type: 'statechange', port: port, target: access, timeStamp: Date.now() };
    if (typeof access.onstatechange === 'function') access.onstatechange(ev);
    const h = access['on' + type];
    if (type !== 'statechange' && typeof h === 'function') h(ev);
  }

  function requestMIDIAccess(opts) {
    log.calls.push({ opts: opts ? { sysex: !!opts.sysex, software: !!opts.software } : null, at: Date.now() });
    if (mode === 'deny') { const e = new Error('Permission denied'); e.name = 'NotAllowedError'; return Promise.reject(e); }
    if (mode !== 'grant') { const e = new Error('Web MIDI unavailable'); e.name = 'NotSupportedError'; return Promise.reject(e); }
    return Promise.resolve(access);
  }

  window.__MIDI_STUB = {
    log: log,
    mode: function () { return mode; },
    setMode: function (m) {
      mode = m;
      if (m === 'unsupported') {
        try { Object.defineProperty(navigator, 'requestMIDIAccess', { value: undefined, configurable: true, writable: true }); }
        catch (e) { try { navigator.requestMIDIAccess = undefined; } catch (e2) { log.listenerErrors.push('cannot hide requestMIDIAccess'); } }
      } else {
        /* always re-install the stub as an own property: deleting it would expose the browser's
           real requestMIDIAccess again (which headless Chromium refuses without a gesture) */
        try { Object.defineProperty(navigator, 'requestMIDIAccess', { value: requestMIDIAccess, configurable: true, writable: true }); }
        catch (e) { try { navigator.requestMIDIAccess = requestMIDIAccess; } catch (e2) { log.listenerErrors.push('cannot install requestMIDIAccess'); } }
      }
      return mode;
    },
    addIn: function (id, name, man, state) { const p = new InPort(id, name, man, state); inputs.set(id, p); fire('statechange', p); return p; },
    removeIn: function (id) { const p = inputs.get(id); if (p) { p.state = 'disconnected'; p.connection = 'closed'; } inputs.delete(id); if (p) fire('statechange', p); return !!p; },
    addOut: function (id, name, man, state) { const p = new OutPort(id, name, man, state); outputs.set(id, p); fire('statechange', p); return p; },
    removeOut: function (id) { const p = outputs.get(id); if (p) { p.state = 'disconnected'; p.connection = 'closed'; } outputs.delete(id); if (p) fire('statechange', p); return !!p; },
    fire: function (id, bytes) { const p = inputs.get(id); if (!p) return false; p.fire(bytes); return true; },
    port: function (dir, id) { return (dir === 'in' ? inputs : outputs).get(id) || null; },
    /* true when the app's outgoing tap patched OUR port class (i.e. engine traffic is visible
       to the app's own monitor, exactly as it would be against a real MIDIOutput) */
    isOurPortClass: function () { return window.MIDIOutput === OutPort; },
  };
  window.__MIDI_STUB.setMode('unsupported');
  try { if (typeof window.MIDIOutput !== 'undefined') log.overrodeMIDIOutput = true; } catch (e) { /* ignore */ }
  try { window.MIDIOutput = OutPort; window.MIDIInput = InPort; } catch (e) { log.listenerErrors.push('MIDIOutput assignment failed'); }
})();`;

/* one browser instance, no URL: the stub must be injected BEFORE the app boots */
const chrome = spawn(exe, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--disable-sync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
], { stdio: 'ignore', windowsHide: true });

const errors = [];
const shotPath = path.join(here, '..', 'renders', 'p0-midi-suite.png');

async function main() {
  /* a fresh profile (Edge) may open edge://xtra targets BEFORE ours; we launched without a URL,
     so wait for a page target we can drive */
  let target = null;
  for (let i = 0; i < 150 && !target; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) {
        const pages = (await r.json()).filter(t => t.type === 'page');
        target = pages.find(t => t.url === 'about:blank') || pages.find(t => !String(t.url).startsWith('edge://')) || pages[0] || null;
      }
    } catch { /* browser still booting */ }
    if (!target) await sleep(200);
  }
  if (!target) { console.error('no page target to drive'); process.exit(2); }
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

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) {
      const e = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'unknown';
      note('eval threw: ' + String(e).split('\n')[0].slice(0, 220));
      return { error: e };
    }
    return { value: r.result?.value };
  };
  const until = async (expr, ms = 3000, step = 100) => {
    const t0 = Date.now();
    for (;;) {
      const r = await ev(expr);
      if (r.value === true) return true;
      if (Date.now() - t0 > ms) return false;
      await sleep(step);
    }
  };
  const clickSel = async (sel, after = 300) => {
    const found = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; if (e.scrollIntoView) e.scrollIntoView({ block: 'center', inline: 'center' }); return true; })()`);
    if (found.value !== true) { note('click target missing: ' + sel); return false; }
    await sleep(200);
    const boxR = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width || !r.height) return null;
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight }; })()`);
    const b = boxR.value;
    if (!b) { note('click target not visible: ' + sel); return false; }
    if (b.top < 0 || b.bottom > b.vh) note('click target partly off-screen (' + b.top + '..' + b.bottom + ' of ' + b.vh + '): ' + sel);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
    await sleep(after);
    return true;
  };

  /* inject the stub BEFORE the app's first line — then navigate */
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await send('Page.navigate', { url });
  await send('Page.bringToFront').catch(() => {});
  await sleep(700);

  /* 0. freeze: the bytes under test */
  check('freeze: index.html sha256 before = 5861d7d6…', shaBefore === EXPECT_SHA, shaBefore);

  /* boot contract */
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const r = await ev(`document.documentElement.getAttribute('data-av-ready') === '1'`);
    if (r.value === true) { ready = true; break; }
    await sleep(300);
  }
  check('boot: data-av-ready flips (with the stub injected pre-boot)', ready);
  if (!ready) { console.error('APP NOT READY'); process.exit(1); }
  await send('Page.bringToFront').catch(() => {});

  const bootR = await ev(`(() => ({
    panel: !!document.querySelector('#av-midi-body .av-midi'),
    api: typeof window.__avMidi === 'object' && window.__avMidi.version === '1.0' && typeof window.__avMidi.snap === 'function',
    snapFn: typeof avMidiSnap === 'function',
    stub: !!window.__MIDI_STUB,
    ourClass: window.__MIDI_STUB ? window.__MIDI_STUB.isOurPortClass() : null
  }))()`);
  check('boot: MIDI deck mounted (#av-midi-body .av-midi) + __avMidi API + stub alive',
    bootR.value.panel === true && bootR.value.api === true && bootR.value.snapFn === true && bootR.value.stub === true,
    JSON.stringify(bootR.value));

  /* ── 1. stub mode: unsupported (boot default) — honest copy, no ENABLE action ── */
  const unsR = await ev(`(() => {
    const st = document.getElementById('av-midi-state');
    const txt = st ? st.textContent.replace(/\\s+/g, ' ') : '';
    return { status: avMidiStatus, supported: avMidiSupported(), txt,
             enableBtn: !!document.querySelector('#av-midi-body [data-midi="enable"]') };
  })()`);
  check('unsupported: honest no-Web-MIDI copy (NO WEB MIDI · Safari named)', 
    unsR.value.status === 'unsupported' && unsR.value.supported === false && /NO WEB MIDI/.test(unsR.value.txt) && /Safari/.test(unsR.value.txt), 
    'status=' + unsR.value.status + ' · ' + unsR.value.txt.slice(0, 120));
  check('unsupported: NO enable action rendered', unsR.value.enableBtn === false, 'enable button present: ' + unsR.value.enableBtn);

  /* ── 2. stub mode: deny — a real click on ENABLE ends 'denied' with the padlock way-out ── */
  note('setMode(deny) + re-render, then a REAL click on ENABLE');
  await ev(`(() => { window.__MIDI_STUB.setMode('deny'); avMidiRender(); return true; })()`);
  await sleep(200);
  const denyClicked = await clickSel('#av-midi-body [data-midi="enable"]');
  const denyOk = await until(`window.__avMidi.snap().status === 'denied'`, 4000);
  const denyR = await ev(`(() => {
    const st = document.getElementById('av-midi-state');
    const txt = st ? st.textContent.replace(/\\s+/g, ' ') : '';
    const s = window.__avMidi.snap();
    return { status: s.status, error: s.error, txt, calls: window.__MIDI_STUB.log.calls.length };
  })()`);
  check('deny: NotAllowedError path ends DENIED BY BROWSER + padlock way-out copy',
    denyClicked === true && denyOk === true && denyR.value.status === 'denied' && /DENIED/.test(denyR.value.txt) && /padlock/i.test(denyR.value.txt) && denyR.value.calls >= 1,
    'status=' + denyR.value.status + ' · err=' + JSON.stringify(denyR.value.error));

  /* no sysex, ever */
  const sysexR = await ev(`(() => {
    const calls = window.__MIDI_STUB.log.calls;
    return { n: calls.length, first: calls.length ? calls[0].opts : 'none',
             anySysex: calls.some(c => c.opts && c.opts.sysex), allNull: calls.every(c => c.opts === null) };
  })()`);
  check('no sysex: requestMIDIAccess called with NO options (log.calls[0].opts === null)',
    sysexR.value.n >= 1 && sysexR.value.first === null && sysexR.value.anySysex === false && sysexR.value.allNull === true,
    'calls=' + sysexR.value.n + ' · firstOpts=' + JSON.stringify(sysexR.value.first));

  /* ── 3. stub mode: grant — ports added first, then a real click on ENABLE ── */
  note('setMode(grant) + two ports, then a REAL click on ENABLE');
  await ev(`(() => {
    const s = window.__MIDI_STUB;
    s.setMode('grant');
    s.addIn('i1', 'KeyLab 61', 'Arturia');
    s.addOut('o1', 'Rev2', 'Sequential');
    return true;
  })()`);
  await sleep(200);
  const grantClicked = await clickSel('#av-midi-body [data-midi="enable"]');
  const enabledOk = await until(`window.__avMidi.snap().status === 'enabled'`, 4000);
  const enR = await ev(`(() => {
    const s = window.__avMidi.snap();
    const st = document.getElementById('av-midi-state');
    const txt = st ? st.textContent.replace(/\\s+/g, ' ') : '';
    const calls = window.__MIDI_STUB.log.calls;
    return { status: s.status, enabled: s.enabled, txt, calls: calls.length, allNull: calls.every(c => c.opts === null) };
  })()`);
  check('grant: a real ENABLE click enables (status enabled, ENABLED counts copy, still no sysex)',
    grantClicked === true && enabledOk === true && enR.value.status === 'enabled' && enR.value.enabled === true &&
    /ENABLED/.test(enR.value.txt) && /1 input/.test(enR.value.txt) && /1 output/.test(enR.value.txt) &&
    enR.value.calls === 2 && enR.value.allNull === true,
    'status=' + enR.value.status + ' · calls=' + enR.value.calls);

  const devR = await ev(`(() => ({
    inRows: [...document.querySelectorAll('#av-midi-dev-in .av-midi-dev')].map(r => r.textContent.replace(/\\s+/g, ' ')),
    outRows: [...document.querySelectorAll('#av-midi-dev-out .av-midi-dev')].map(r => r.textContent.replace(/\\s+/g, ' ')),
    inPick: !!document.querySelector('#av-midi-dev-in [data-midiin-pick="i1"]'),
    outPick: !!document.querySelector('#av-midi-dev-out [data-midiout-pick="o1"]'),
    selIn: window.__avMidi.snap().in, selOut: window.__avMidi.snap().out
  }))()`);
  check('grant: device rows render (in: KeyLab 61 · out: Rev2, both selected)',
    devR.value.inRows.length === 1 && /KeyLab 61/.test(devR.value.inRows[0]) && /Arturia/.test(devR.value.inRows[0]) && /connected/.test(devR.value.inRows[0]) &&
    devR.value.outRows.length === 1 && /Rev2/.test(devR.value.outRows[0]) &&
    devR.value.inPick === true && devR.value.outPick === true &&
    devR.value.selIn === 'KeyLab 61' && devR.value.selOut === 'Rev2',
    JSON.stringify(devR.value.inRows.concat(devR.value.outRows)));

  /* ── 4. hotplug: add/remove updates rows with NO refresh click ── */
  await ev(`window.__MIDI_STUB.addOut('o2', 'MiniLab 3', 'Arturia')`);
  const hp1 = await ev(`(() => ({ rows: document.querySelectorAll('#av-midi-dev-out .av-midi-dev').length, snapOut: window.__avMidi.snap().outputs }))()`);
  check('hotplug: addOut renders a new output row, no refresh click',
    hp1.value.rows === 2 && hp1.value.snapOut === 2, 'rows=' + hp1.value.rows + ' · snap=' + hp1.value.snapOut);

  await ev(`window.__MIDI_STUB.removeIn('i1')`);
  const hp2 = await ev(`(() => ({ rows: document.querySelectorAll('#av-midi-dev-in .av-midi-dev').length, txt: ((document.getElementById('av-midi-dev-in') || {}).textContent || '').replace(/\\s+/g, ' ') }))()`);
  await ev(`window.__MIDI_STUB.addIn('i3', 'Launchkey 49', 'Novation')`);
  const hp3 = await ev(`(() => ({
    rows: [...document.querySelectorAll('#av-midi-dev-in .av-midi-dev')].map(r => r.textContent.replace(/\\s+/g, ' ')),
    selIn: window.__avMidi.snap().in, inCount: window.__avMidi.snap().inputs
  }))()`);
  check('hotplug: unplug clears + replug re-picks a new input, no refresh click',
    hp2.value.rows === 0 && /no inputs found/.test(hp2.value.txt) &&
    hp3.value.rows.length === 1 && /Launchkey 49/.test(hp3.value.rows[0]) && hp3.value.inCount === 1 && hp3.value.selIn === 'Launchkey 49',
    'after unplug: ' + hp2.value.rows + ' rows · after replug: ' + JSON.stringify(hp3.value.rows));

  /* ── 5. play-in: hardware notes ride the ONE note bus ── */
  const p1 = await ev(`(() => {
    window.__MIDI_STUB.fire('i3', [0x90, 72, 100]);
    return { preview: window.__lastNotePreview, heldBus: [...avNoteHeld], heldMidi: [...avMidiHeld], notes: window.__avNotes().held, playIn: avMidiPrefs.playIn };
  })()`);
  check('play-in ON: note-on [90 48 64] plays through the bus (preview c5 · avNoteHeld · avMidiHeld)',
    p1.value.playIn === true && p1.value.preview === 'c5' && p1.value.heldBus.indexOf('c5') >= 0 && p1.value.heldMidi.indexOf('c5') >= 0 && p1.value.notes.indexOf('c5') >= 0,
    JSON.stringify(p1.value));

  const p2 = await ev(`(() => {
    window.__MIDI_STUB.fire('i3', [0x80, 72, 0]);
    return { heldBus: [...avNoteHeld], heldMidi: [...avMidiHeld], gain: avNoteGains.has('c5') };
  })()`);
  check('play-in: note-off [80 48 00] releases (bus + deck, gain cleared)',
    p2.value.heldBus.length === 0 && p2.value.heldMidi.length === 0 && p2.value.gain === false, JSON.stringify(p2.value));

  const p3 = await ev(`(() => {
    window.__MIDI_STUB.fire('i3', [0x90, 72, 127]);
    const out = { gain: avNoteGains.get('c5'), held: [...avNoteHeld], preview: window.__lastNotePreview };
    window.__MIDI_STUB.fire('i3', [0x80, 72, 0]);
    return out;
  })()`);
  check('play-in: velocity 127 clamps the note gain to 1 (avNoteGains)', p3.value.gain === 1 && p3.value.held.indexOf('c5') >= 0, JSON.stringify(p3.value));

  note('PLAY IN OFF via a real click; hardware notes must stay quiet');
  const offClicked = await clickSel('#av-midi-body [data-midi="playin"][data-midival="0"]');
  const offR = await ev(`(() => ({ playIn: avMidiPrefs.playIn, snapIn: window.__avMidi.snap().playIn }))()`);
  const p4 = await ev(`(() => {
    const before = window.__lastNotePreview;
    window.__MIDI_STUB.fire('i3', [0x90, 76, 100]);
    const out = { before, after: window.__lastNotePreview, heldBus: [...avNoteHeld], heldMidi: [...avMidiHeld] };
    window.__MIDI_STUB.fire('i3', [0x80, 76, 0]);
    return out;
  })()`);
  check('play-in OFF: hardware notes stay quiet (no held · no preview change)',
    offClicked === true && offR.value.playIn === false && offR.value.snapIn === false &&
    p4.value.after === p4.value.before && p4.value.heldBus.indexOf('e5') < 0 && p4.value.heldMidi.length === 0,
    'playIn=' + offR.value.playIn + ' · preview ' + p4.value.before + ' → ' + p4.value.after);
  await ev(`window.__avMidi.playIn(true)`);   /* restore for the rest of the run */

  /* ── 6. monitor flood: 1200 in → caps hold ── */
  await ev(`window.__avMidi.clearMonitor()`);
  await ev(`(() => { for (let i = 0; i < 1200; i++) window.__MIDI_STUB.fire('i3', [0xF8]); return true; })()`);
  await sleep(320);   /* repaint is coalesced at 120 ms — wait before reading DOM */
  const monR = await ev(`(() => {
    const s = window.__avMidi.snap().monitor;
    return { total: s.total, dropped: s.dropped, kept: s.kept,
      rowsIn: document.querySelectorAll('#av-midi-mon-in .av-midi-mon-line').length,
      rowsOut: document.querySelectorAll('#av-midi-mon-out .av-midi-mon-line').length,
      cntIn: ((document.getElementById('av-midi-count-in') || {}).textContent || ''),
      cntOut: ((document.getElementById('av-midi-count-out') || {}).textContent || '') };
  })()`);
  const mDrop = /(\d+) dropped/.exec(monR.value.cntIn);
  check('monitor flood: 1200 in → total 1200, ring 60 kept, dropped > 0',
    monR.value.total.in === 1200 && monR.value.total.out === 0 && monR.value.kept.in === 60 && monR.value.dropped.in > 0 && monR.value.dropped.out === 0,
    'total=' + JSON.stringify(monR.value.total) + ' · kept=' + JSON.stringify(monR.value.kept) + ' · dropped=' + JSON.stringify(monR.value.dropped));
  check('monitor flood: ≤12 DOM rows per direction + counter line present',
    monR.value.rowsIn === 12 && monR.value.rowsOut <= 12 &&
    monR.value.cntIn.indexOf('60/60 kept') >= 0 && monR.value.cntIn.indexOf('1200 total') >= 0 &&
    !!mDrop && Number(mDrop[1]) > 0 && Number(mDrop[1]) === monR.value.dropped.in &&
    monR.value.cntOut.indexOf('0/60 kept') >= 0,
    'rows in/out=' + monR.value.rowsIn + '/' + monR.value.rowsOut + ' · "' + monR.value.cntIn + '"');

  const clrClicked = await clickSel('#av-midi-body [data-midi="clear"]');
  const clrR = await ev(`(() => {
    const s = window.__avMidi.snap().monitor;
    return { total: s.total, kept: s.kept, dropped: s.dropped,
      rowsIn: document.querySelectorAll('#av-midi-mon-in .av-midi-mon-line').length,
      rowsOut: document.querySelectorAll('#av-midi-mon-out .av-midi-mon-line').length,
      cntIn: ((document.getElementById('av-midi-count-in') || {}).textContent || '') };
  })()`);
  check('monitor clear (real click): rings, totals, DOM all reset',
    clrClicked === true && clrR.value.total.in === 0 && clrR.value.total.out === 0 && clrR.value.kept.in === 0 && clrR.value.kept.out === 0 &&
    clrR.value.dropped.in === 0 && clrR.value.rowsIn === 0 && clrR.value.rowsOut === 0 && clrR.value.cntIn.indexOf('0/60 kept') >= 0 && clrR.value.cntIn.indexOf('0 total') >= 0,
    JSON.stringify(clrR.value));

  /* ── 7. out tap: isOurPortClass + TEST NOTE sends real bytes ── */
  const tapR = await ev(`(() => ({ our: window.__MIDI_STUB.isOurPortClass(), tap: window.__avMidi.snap().tap }))()`);
  check('out tap: the deck patched the stub MIDIOutput prototype (isOurPortClass + snap.tap)',
    tapR.value.our === true && tapR.value.tap === true, JSON.stringify(tapR.value));

  const outsAt = (await ev('window.__MIDI_STUB.log.outs.length')).value;
  const tnClicked = await clickSel('#av-midi-body [data-midi="testnote"]');
  let tnR = null;
  for (let i = 0; i < 12; i++) {
    const r = await ev(`(() => ({
      wire: window.__MIDI_STUB.log.outs.slice(${outsAt}).map(o => ({ d: o.data, name: o.name })),
      mon: window.__avMidi.monitor('out').map(m => ({ type: m.type, hex: m.hex, name: m.name }))
    }))()`);
    tnR = r.value || { wire: [], mon: [] };
    if (tnR.wire.length >= 2 && tnR.mon.length >= 2) break;
    await sleep(150);
  }
  const wireOk = tnR && tnR.wire.length === 2 &&
    JSON.stringify(tnR.wire[0].d) === '[144,60,100]' && tnR.wire[0].name === 'Rev2' &&
    JSON.stringify(tnR.wire[1].d) === '[128,60,0]' && tnR.wire[1].name === 'Rev2';
  const monOk = tnR && tnR.mon.length === 2 && tnR.mon[0].type === 'noteon' && tnR.mon[0].hex === '90 3c 64' && tnR.mon[1].type === 'noteoff' && tnR.mon[1].hex === '80 3c 00';
  check('out tap: TEST NOTE sends real [0x90,60,100] then [0x80,60,0] at the stub port (recorded once)',
    tnClicked === true && wireOk && monOk,
    JSON.stringify(tnR));

  /* ── 8. CC learn: arm → CC pick → bind-click swallowed → drive → unbind → burst ── */
  note('CC LEARN: arm via real click, pick CC 74 from hardware, click the keys knob');
  const armClicked = await clickSel('#av-midi-body [data-midilearn="arm"]');
  const armR = await ev(`(() => ({ armed: avMidiLearn.armed, enabled: avMidiEnabled }))()`);
  check('CC learn: ARM LEARN arms (needs enabled)', armClicked === true && armR.value.armed === true && armR.value.enabled === true, JSON.stringify(armR.value));

  const pickR = await ev(`(() => {
    window.__MIDI_STUB.fire('i3', [0xB0, 74, 100]);
    return { cc: avMidiLearn.cc, chan: avMidiLearn.chan, armed: avMidiLearn.armed };
  })()`);
  check('CC learn: the first hardware CC picks the controller (CC 74 ch1)', pickR.value.cc === 74 && pickR.value.chan === 1 && pickR.value.armed === true, JSON.stringify(pickR.value));

  const knobBefore = await ev(`(() => { const el = document.querySelector('.av-knob[data-knob="keys"]'); return el ? { aria: el.getAttribute('aria-valuenow'), norm: el.dataset.norm } : null; })()`);
  const knobClicked = await clickSel('.av-knob[data-knob="keys"]');
  const knobAfter = await ev(`(() => {
    const el = document.querySelector('.av-knob[data-knob="keys"]');
    const s = window.__avMidi.learn.state();
    return { aria: el ? el.getAttribute('aria-valuenow') : null, armed: s.armed,
             binds: s.binds.map(b => ({ id: b.id, cc: b.cc, ch: b.ch, path: b.path, min: b.min, max: b.max, step: b.step, def: b.def })) };
  })()`);
  const bindOk = knobClicked === true && knobBefore.value && knobAfter.value.aria === knobBefore.value.aria &&
    knobAfter.value.armed === false && knobAfter.value.binds.length === 1 &&
    knobAfter.value.binds[0].cc === 74 && knobAfter.value.binds[0].path === 'keys';
  check('CC learn: real click on .av-knob[data-knob] binds WITHOUT turning the knob (aria unchanged)',
    bindOk, 'aria ' + JSON.stringify(knobBefore.value) + ' → ' + JSON.stringify(knobAfter.value));
  if (!bindOk && knobClicked) bug('CC learn bind click', 'binding recorded with the knob untouched', 'aria ' + JSON.stringify(knobBefore.value) + ' → ' + JSON.stringify(knobAfter.value), 'click the keys knob while armed');

  await sleep(80);
  const moveR = await ev(`(() => {
    window.__MIDI_STUB.fire('i3', [0xB0, 74, 100]);
    return true;
  })()`);
  await sleep(80);
  const moveV = await ev(`(() => {
    const el = document.querySelector('.av-knob[data-knob="keys"]');
    const exp = avKnobNormToVal(100 / 127, parseFloat(el.dataset.min), parseFloat(el.dataset.max), el.dataset.curve || 'lin', parseFloat(el.dataset.step));
    const b = window.__avMidi.learn.state().binds[0] || {};
    return { exp, param: avParams['keys'], state: avState.keysVol, aria: el.getAttribute('aria-valuenow'),
             readout: ((document.querySelector('[data-kval="keys"]') || {}).textContent || ''), last: b.last, applied: b.applied };
  })()`);
  check('CC learn: the bound CC 74 moves the knob through avApplyParam (avParams · avState · aria)',
    moveV.value.exp !== undefined && moveV.value.param === moveV.value.exp && moveV.value.state === moveV.value.exp &&
    moveV.value.aria === String(moveV.value.exp) && moveV.value.last === 100 && moveV.value.applied === moveV.value.exp,
    JSON.stringify(moveV.value));

  note('CC learn: ✕ unbind via real click');
  const unClicked = await clickSel('#av-midi-body [data-ccbind-del]');
  const unR = await ev(`(() => ({ n: window.__avMidi.learn.state().binds.length, raw: avMidiCcBinds.length, dom: document.querySelectorAll('#av-midi-body [data-ccbind]').length }))()`);
  check('CC learn: ✕ unbind removes the binding everywhere', unClicked === true && unR.value.n === 0 && unR.value.raw === 0 && unR.value.dom === 0, JSON.stringify(unR.value));

  note('CC learn: re-bind, then a 200-message CC burst must coalesce');
  await clickSel('#av-midi-body [data-midilearn="arm"]');
  await ev(`window.__MIDI_STUB.fire('i3', [0xB0, 74, 10])`);
  const rebindClicked = await clickSel('.av-knob[data-knob="keys"]');
  const w0 = (await ev('window.__avMidi.learn.state().writes')).value;
  await ev(`(() => { for (let i = 0; i < 200; i++) window.__MIDI_STUB.fire('i3', [0xB0, 74, i & 127]); return true; })()`);
  await sleep(250);   /* one flush is immediate, the rest collapse into the 30 ms window */
  const burstV = await ev(`(() => {
    const el = document.querySelector('.av-knob[data-knob="keys"]');
    const st = window.__avMidi.learn.state();
    const b = st.binds[0] || {};
    const exp = avKnobNormToVal(71 / 127, parseFloat(el.dataset.min), parseFloat(el.dataset.max), el.dataset.curve || 'lin', parseFloat(el.dataset.step));
    return { exp, hits: b.hits, applied: b.applied, writes: st.writes, param: avParams['keys'], aria: el.getAttribute('aria-valuenow') };
  })()`);
  const dWrites = burstV.value.writes - w0;
  const burstOk = rebindClicked === true && burstV.value.hits === 200 && dWrites >= 1 && dWrites <= 6 &&
    burstV.value.applied === burstV.value.exp && burstV.value.param === burstV.value.exp && burstV.value.aria === String(burstV.value.exp);
  check('CC learn: a 200-message burst coalesces (writes bounded, final value wins)',
    burstOk, 'hits=' + burstV.value.hits + ' · writes=+' + dWrites + ' · applied=' + burstV.value.applied + ' (want ' + burstV.value.exp + ')');

  /* ── 9. clock out: 0xFA once → 0xF8 @ 24 ppqn → 0xFC freezes → OFF disables ── */
  const CLK_GAP = 60000 / 24 / 120;   /* 20.833 ms at avState.bpm=120 */
  note('CLOCK OUT: on via real click, then avMidiClockTransport(true)');
  const ckClicked = await clickSel('#av-midi-body [data-midiclock="on"]', 200);
  const ckOn = await ev(`(() => ({ on: avMidiPrefs.clockOut, stateOn: window.__avMidi.clock.state().on, bpm: avState.bpm }))()`);
  const outsA = (await ev('window.__MIDI_STUB.log.outs.length')).value;
  await ev(`(() => { avMidiClockTransport(true); return true; })()`);
  await sleep(650);
  const clkR = await ev(`(() => { const c = window.__avMidi.clock.state(); const sl = window.__MIDI_STUB.log.outs.slice(${outsA}); return { clock: c, bytes: sl.map(o => ({ d: o.data, t: o.t, name: o.name })) }; })()`);
  const bytesA = clkR.value.bytes;
  const isFA = (e) => e.d.length === 1 && e.d[0] === 250;
  const isF8 = (e) => e.d.length === 1 && e.d[0] === 248;
  const faA = bytesA.filter(isFA).length;
  const f8A = bytesA.filter(isF8);
  const otherA = bytesA.filter(e => !isFA(e) && !isF8(e));
  const faIdxA = bytesA.findIndex(isFA), first8 = bytesA.findIndex(isF8);
  const gaps = [];
  for (let i = 1; i < f8A.length; i++) gaps.push(f8A[i].t - f8A[i - 1].t);
  const meanGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  check('clock out: transport(true) → exactly one 0xFA then 0xF8 ticks at ~24 ppqn (mean gap ±30% at 120 BPM)',
    ckClicked === true && ckOn.value.on === true && ckOn.value.stateOn === true && ckOn.value.bpm === 120 &&
    faA === 1 && otherA.length === 0 && f8A.length >= 15 && faIdxA >= 0 && (first8 < 0 || faIdxA < first8) &&
    meanGap >= CLK_GAP * 0.7 && meanGap <= CLK_GAP * 1.3,
    'FA=' + faA + ' · ticks=' + f8A.length + ' · meanGap=' + meanGap.toFixed(2) + 'ms (want ~' + CLK_GAP.toFixed(2) + ') · ticking=' + clkR.value.clock.ticking);
  if (ckClicked && faA === 1 && f8A.length >= 15 && (meanGap < CLK_GAP * 0.7 || meanGap > CLK_GAP * 1.3))
    bug('clock out tick spacing', 'mean 0xF8 gap ≈ ' + CLK_GAP.toFixed(2) + 'ms ±30%', meanGap.toFixed(2) + 'ms over ' + gaps.length + ' gaps', 'enable clock out, avMidiClockTransport(true), watch log.outs');

  const markB = (await ev('window.__MIDI_STUB.log.outs.length')).value;
  await ev(`(() => { avMidiClockTransport(false); return true; })()`);
  await sleep(300);
  const stopR = await ev(`(() => { const c = window.__avMidi.clock.state(); const sl = window.__MIDI_STUB.log.outs.slice(${markB}); return { clock: c, bytes: sl.map(o => o.data) }; })()`);
  const bytesB = stopR.value.bytes;
  const fcIdx = bytesB.findIndex(d => d.length === 1 && d[0] === 252);
  const lastB = bytesB.length ? bytesB[bytesB.length - 1] : null;
  const f8AfterFC = fcIdx >= 0 && bytesB.slice(fcIdx + 1).some(d => d.length === 1 && d[0] === 248);
  check('clock out: transport(false) sends 0xFC and the wire freezes',
    stopR.value.clock.ticking === false && fcIdx >= 0 && !!lastB && lastB[0] === 252 && !f8AfterFC,
    'ticking=' + stopR.value.clock.ticking + ' · FC at ' + fcIdx + '/' + bytesB.length + ' · last=' + JSON.stringify(lastB));
  const frozenA = (await ev('window.__MIDI_STUB.log.outs.length')).value;
  await sleep(350);
  const frozenB = (await ev('window.__MIDI_STUB.log.outs.length')).value;
  check('clock out: the wire stays frozen after the stop byte', frozenA === frozenB, frozenA + ' → ' + frozenB);

  note('CLOCK OUT: restart, then OFF (real click) must stop it');
  await ev(`(() => { avMidiClockTransport(true); return true; })()`);
  await sleep(320);
  const runR = await ev(`(() => ({ ticking: window.__avMidi.clock.state().ticking, ticks: window.__avMidi.clock.state().ticks }))()`);
  const markC = (await ev('window.__MIDI_STUB.log.outs.length')).value;
  const ckOffClicked = await clickSel('#av-midi-body [data-midiclock="off"]', 200);
  await sleep(300);
  const offCR = await ev(`(() => {
    const c = window.__avMidi.clock.state();
    const sl = window.__MIDI_STUB.log.outs.slice(${markC});
    return { clock: c, pref: avMidiPrefs.clockOut, bytes: sl.map(o => o.data) };
  })()`);
  const bytesC = offCR.value.bytes;
  const lastC = bytesC.length ? bytesC[bytesC.length - 1] : null;
  const fcI = bytesC.findIndex(d => d.length === 1 && d[0] === 252);
  const f8AfterC = fcI >= 0 && bytesC.slice(fcI + 1).some(d => d.length === 1 && d[0] === 248);
  const frozenC = (await ev('window.__MIDI_STUB.log.outs.length')).value;
  await sleep(350);
  const frozenD = (await ev('window.__MIDI_STUB.log.outs.length')).value;
  check('clock out: OFF (real click) stops a running clock — 0xFC sent, wire frozen, pref off',
    runR.value.ticking === true && ckOffClicked === true && offCR.value.clock.ticking === false && offCR.value.pref === false &&
    fcI >= 0 && !!lastC && lastC[0] === 252 && !f8AfterC && frozenC === frozenD,
    'was ticking=' + runR.value.ticking + ' · FC at ' + fcI + '/' + bytesC.length + ' · frozen ' + frozenC + '=' + frozenD);

  /* ── 10. zero console errors for the whole run ── */
  const stubErrs = await ev(`window.__MIDI_STUB.log.listenerErrors`);
  const listenerErrs = Array.isArray(stubErrs.value) ? stubErrs.value.length : -1;
  check('zero console errors for the whole run (exceptions · Log errors · console.error · stub listener errors)',
    errors.length === 0 && listenerErrs === 0,
    'page errors=' + errors.length + ' · stub listener errors=' + listenerErrs + (errors.length ? ' | ' + errors.slice(0, 3).join(' | ') : ''));

  /* ── 11. screenshot: the panel post-enable, clipped to #av-midi-card at 2× ── */
  await ev(`(() => { const el = document.getElementById('av-midi-card'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); return true; })()`);
  await sleep(250);
  const rectR = await ev(`(() => { const el = document.getElementById('av-midi-card'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }; })()`);
  const rect = rectR.value;
  let shotOk = false, shotInfo = 'no rect';
  if (rect && rect.w > 50 && rect.h > 50) {
    try {
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 2 }, captureBeyondViewport: true });
      const buf = Buffer.from(shot.data, 'base64');
      writeFileSync(shotPath, buf);
      shotOk = buf.length > 1000 && buf[0] === 0x89 && buf[1] === 0x50;
      shotInfo = buf.length + ' bytes · clip ' + Math.round(rect.w) + '×' + Math.round(rect.h) + ' @2x';
    } catch (e) { shotInfo = 'capture failed: ' + (e && e.message); }
  }
  check('screenshot: renders/p0-midi-suite.png (panel post-enable, clip #av-midi-card, scale 2)', shotOk, shotInfo);

  /* ── 12. freeze: the bytes under test, after ── */
  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after): ' + shaAfter);
  check('freeze: index.html sha256 after = 5861d7d6… (unchanged by the run)', shaAfter === EXPECT_SHA && shaAfter === shaBefore, shaAfter);

  if (appBugs.length) { console.log('\n' + appBugs.length + ' app bug(s) recorded:'); appBugs.forEach(b => console.log('  - ' + b)); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { ws.close(); } catch { /* done */ }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('midi harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile.replace(/[\\\\/]/g, '\\\\\\\\')}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
