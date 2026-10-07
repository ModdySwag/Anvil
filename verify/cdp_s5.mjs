// cdp_s5.mjs — Anvil S5 wave suite (rig sa-G1; WRITTEN by sa-G1, RUN BY THE PARENT after the S5
// integration build). End-to-end over raw CDP against the frozen single-file build.
//
//   node verify/cdp_s5.mjs [path-to-index.html] [--port N] [--sha <hex>] > verify/last-cdp_s5.log 2>&1
//
// WRITE-ONLY: this file is authored by sa-G1 and never executed by sa-G1. The parent runs it after
// the integration build (index.html must contain av_kb_pop.js / av_help.js / av_palette.js /
// av_lessons.js + the sa-B/sa-C modules; body.html must carry #pk-pop + #pk-return in the piano
// rail after #pk-close; app_core boots avKbPopInit/avHelpInit/avPaletteInit/avLessonsInit and the
// avKbHandle hook line (§4.5 E-kb6) is in place).
//
// LAUNCH SKELETON: copied VERBATIM from cdp_s4.mjs (candidates Chrome/Edge/Brave, free-port scan,
// fresh temp --user-data-dir + profile-scoped cleanup, 1440x900 device metrics override — Edge
// headless ignores --window-size, --mute-audio, --autoplay-policy=no-user-gesture-required, ONE
// browser, explicit exit, process.on('exit') kills ONLY processes whose command line carries OUR
// temp profile) PLUS the two PF cdp_pop.mjs popup flags: --disable-popup-blocking and
// --allow-file-access-from-files. The popout-target enumeration technique (about:blank page target
// -> attach -> evaluate IN it, bounded evaluates with re-attach) follows PF verify/cdp_pop.mjs.
//
// SHA FREEZE DISCIPLINE from cdp_deck/cdp_s4: index.html is sha256'd before and after the run and
// before === after is ALWAYS enforced. EXPECT_SHA stays null until the parent pins the frozen S5
// sha (constant below or --sha <hex>); while null the rig still enforces before === after and
// prints a pin note (never loosened).
//
// WHAT IT PROVES, in order (contract: verify/_s5_wave.md §2.G1 checks 1-12 — 35 checks):
//   1. boot + engine + the new globals (avHelpOpen / avPaletteCommands / avLessonsList /
//      avKbPopOpen + window.__avHelp/__avPalette/__avLessons/__avKbPop + versions) + the #pk-pop /
//      #pk-return rail markup + the #av-help button.
//   2. popout via avKbPopOpen({ pip:false }) -> CDP target enumeration (about:blank page target,
//      attach, evaluate IN it): bed #piano-keys with 61 .pk-key; app side body.piano-pop + the app
//      bed empty; the popout bar carries BACK / ARM / OCT; a real KeyboardEvent keydown 'a'
//      DISPATCHED IN THE POPOUT realm reaches the opener (__lastNotePreview === 'c4' + __lastFwd
//      advanced); keyup -> held 0 (avNote bus + avHeldByKey map).
//   3. avKbPopHome -> bed home inside #piano-dock (61 keys, class cleared) + pointerdown on a key
//      still sounds (clickable re-bind after the adoption round trip).
//   4. blocked popup honesty: window.open stubbed to null, pip:false -> via null + error string +
//      NO piano-pop half state; window.open restored.
//   5. document-PiP path when the platform offers it (via "dpip", bed live in the PiP window, home
//      returns); a platform-absent DPIP is an honest SKIP (a note, never a fail). If an eval-driven
//      open falls back to the named popup, the leg retries with a REAL mouse click on #pk-pop.
//   6. help: #av-help opens the overlay (side panel, rect width <= 480); SHORTCUTS lists
//      Ctrl+Alt+1/2/3 + Ctrl+K; the keyboard is NOT blocked ('y' flips the piano while open);
//      '?' toggles and Esc closes (the avUiKeyHook chain through avKbHandle).
//   7. tour: avHelpTour(3 rig steps, one carrying action 'seq.demo') -> active 1/3 + handle +
//      cutout/ring; next -> step 2 with the F action seam observed (unknown/absent tolerated — the
//      seam is optional); skip -> inactive.
//   8. tips: pointerover a curated control shows #av-tip with text; pointerout hides it.
//   9. palette: Ctrl+K opens (plain AND from a focused textarea); typing 'pian' leaves "Toggle
//      piano" first; Enter runs it (piano-closed flips); reopen; Esc closes.
//  10. lessons: fresh profile -> #av-firstrun visible; the first-sound button loads the demo
//      (notes > 0), plays, sets av-first-run, the strip goes; avLessonsList() carries the five ids
//      with title/blurb/steps; avLessonRun('first-beat') starts a tour.
//  11. wizard: avWizRun('bass') opens #av-wiz; choices apply curated params (diff against the
//      pre-wizard avParams mirror); AUDITION fires notes (__lastNotePreview transitions); KEEP
//      closes and the params stay.
//  12. seal: screenshot renders/s5-suite.png | cleanup (home, overlays closed, mode/piano
//      restored, notes released) | zero page errors | sha256 before === after | freeze pin leg
//      (notes honestly while null).
//
// RIG-OWN MATH (never planted literals where the app computes): the note the rig expects from 'a'
// is read back through the app's own avPianoNoteFor('a') and reported next to the contract's 'c4';
// param changes are diffed page-side between two avParams mirror snapshots (only small digests
// cross CDP); pattern note counts come from avSeqSnap(); playing state cascades through
// avSeqIsPlaying()/__avSeq; the tip target, palette first row, ring nodes, wizard choice groups
// and popout bar labels are all probed tolerantly (DECK-4b: deferred UI reads are null-honest; a
// platform-absent DPIP skips with a note, never a fail).
//
// SPEC NOTES (sa-G1, for the first parent run — fix the EXPECTATION to the check's stated intent,
// never loosen strength):
//   (a) The popout bar is probed by LABEL, not id (the contract pins only the chrome classes
//       av-pop-bar/av-pop-btn/av-pop-hint): one button >= /back/i, one >= /arm/i, /oct/i somewhere
//       in the bar (the OCT C3 window label) — the actual labels land in the 2b info dump.
//   (b) 'a' -> 'c4' is asserted at the default octave window (win 2, fresh profile). The rig sets
//       KEYS mode (avSetInputMode('keys', {persist:false})) before forwarding — a forwarded letter
//       is only a note while armed.
//   (c) The forward test stubs the POPOUT document's hasFocus to true when headless refuses real
//       focus (the wiring under test is the forward path, not the OS) and restores it after.
//   (d) DPIP: available -> via "dpip" + a live PiP window carrying the bed is REQUIRED (with a
//       real #pk-pop click retry first); absent -> a note, not a fail.
//   (e) Tour action seam: avLessonAction is wrapped for observation; if F is absent the leg notes
//       and moves on; if the app reports ok:false ("unknown") the effect assert STOPS honestly
//       (the seam is optional); ok:true requires a live effect (pattern name/notes or playing).
//   (f) Palette first row is expected to match /toggle piano/i (contract §2.E names the command
//       'toggle piano'); the focused-field leg prefers #av-code-src, else any textarea, else a
//       rig-created off-screen textarea (the info names what was used).
//   (g) #av-firstrun click prefers the strip's own <button>; if an earlier leg (the tour action)
//       already marked av-first-run, 10a fails loudly — the SPEC fix is then to move the strip
//       check before the tour section (never loosen 10a).
//   (h) Ring/cutout probe is selector-tolerant (av-help-ring / av-tour-ring / *cut* / *shade* /
//       *spot* / *tour* visible nodes) — the info dump names what matched.
//   (i) Overlay width is measured on #av-help-overlay itself (the side panel; contract: max
//       ~420 px) — a full-screen scrim implementation fails 6a at first run by design.
//   (j) The wizard choice picker clicks the first non-action button of up to 3 distinct parent
//       groups (AUDITION / KEEP / REROLL / close excluded); actual labels land in the info dump.
//   (k) Playing witness cascade: avSeqIsPlaying() -> window.__avSeq(.playing) -> null.
//   (l) #pk-pop / #pk-return / #av-help are PARENT markup; wiring of #av-help is proven by the 6a
//       click (a listener cannot be introspected). #pk-pop's click itself is only exercised by the
//       5a real-click retry (the contract's popout checks ride avKbPopOpen directly).
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const shaArg = argv.indexOf('--sha');
const page = argv.find(a => !a.startsWith('--') && (/\.html?$/i.test(a) || existsSync(a))) || path.join(here, '..', 'index.html');
if (!existsSync(page)) { console.error('page not found: ' + page); process.exit(2); }

/* FREEZE LAW: the bytes under test are named before anything runs, and re-checked after.
   S5: the frozen sha of the rebuilt index.html is not known until build.py runs — the parent may
   fill this constant or pass --sha <hex>; the rig never loosens the before === after check. */
const EXPECT_SHA = '335f4bd06f7aafff68725c1645a1b00518936a9c74fd90969221a7d2ce7d0d15';
const PIN = (shaArg > -1 && argv[shaArg + 1] && /^[0-9a-f]{64}$/i.test(argv[shaArg + 1])) ? argv[shaArg + 1].toLowerCase() : EXPECT_SHA;
const shaOf = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const shaBefore = shaOf(page);
console.log('index.html sha256 (before): ' + shaBefore + (PIN ? '' : '   (EXPECT_SHA not pinned yet — pass --sha <hex> or set the constant)'));

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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9680);
const profile = path.join(tmpdir(), 'anvil-s5-' + Date.now());
const DL_DIR = path.join(tmpdir(), 'anvil-s5-dl-' + Date.now());
try { mkdirSync(DL_DIR, { recursive: true }); } catch (e) { /* best-effort */ }
const url = 'file:///' + path.resolve(page).replace(/\\/g, '/');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
console.log('cdp port ' + PORT + ' · profile ' + profile);
console.log('download dir ' + DL_DIR);

let pass = 0, fail = 0;
const expected = (cond, msg, info) => {
  if (cond === true) { pass++; console.log(' ok   ' + msg + (info ? '  -> ' + info : '')); }
  else { fail++; console.log(' FAIL ' + msg + (info ? '  -> ' + info : '')); }
  return cond === true;
};
const note = (t) => console.log('   · ' + t);
const fx3 = (x) => (x == null || typeof x !== 'number' || !isFinite(x)) ? String(x) : Number(x).toFixed(3);
const J = (x) => { try { return JSON.stringify(x); } catch (e) { return String(x); } };

const chrome = spawn(exe, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--disable-sync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--disable-popup-blocking', '--allow-file-access-from-files',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  url,
], { stdio: 'ignore', windowsHide: true });

const errors = [];

/* ---------- node-side CDP plumbing for popup targets (technique: PF cdp_pop.mjs) ---------- */
async function getJson(p, tries = 30, spacing = 300) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + p); if (r.ok) return await r.json(); } catch { /* still booting */ }
    await sleep(spacing);
  }
  return null;
}
/* connect to a target's ws and hand back a tiny send/eval pair (used for the popout window).
   Every evaluate is BOUNDED: a send on a socket whose target already died can hang forever, so a
   timeout abandons the socket and popEv re-attaches to the live window. */
async function attach(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p(m); } };
  const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  await Promise.race([
    new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }),
    sleep(4000).then(() => { throw new Error('popup ws open timeout'); }),
  ]);
  await Promise.race([send('Runtime.enable'), sleep(5000).then(() => { throw new Error('popup Runtime.enable timeout'); })]);
  const ev = async (expression, timeoutMs = 8000) => {
    const m = await Promise.race([
      send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }),
      sleep(timeoutMs).then(() => { throw new Error('popup evaluate timeout'); }),
    ]);
    const r = m && m.result;
    if (r && r.exceptionDetails) {
      const d = r.exceptionDetails;
      return { __err: String((d.exception && d.exception.description) || d.text || 'exception').slice(0, 240) };
    }
    return r && r.result ? r.result.value : undefined;
  };
  return { send, ev, ws, close: () => { try { ws.close(); } catch { /* done */ } } };
}

/* ---------- page-side scaffolding injected at runtime (rig-owned; never app code) ----------
   __s5w: the rig's OWN legs — popout open/home/blocked/DPIP probes, the forward witness readers,
   help/tour/tip/palette/lessons/wizard legs, page-side param diffs and the cleanup. Every read is
   tolerant/null-honest (DECK-4b); nothing plants values where the app computes. The function is
   stringified into the page, so it must not reference anything outside its own body. */
const S5W_INSTALL = function () {
  window.__s5w = (function () {
    var W = { v: 1, orig: null, tipWinner: null, tip0: null, tour: null, tourLog: null, tourPre: null, lessonTour: null, param0: null, wiz0: null };

    W.num = function (x) { return (typeof x === 'number' && isFinite(x)) ? x : null; };
    W.safe = function (x) { try { return JSON.parse(JSON.stringify(x)); } catch (e) { return null; } };
    W.J = function (x) { try { return JSON.stringify(x); } catch (e) { return String(x); } };
    W.light = function (x) {
      if (x === undefined || x === null) return null;
      if (typeof x !== 'object') return x;
      var out = {}, n = 0;
      for (var k in x) {
        if (n >= 16) break;
        var v = null;
        try { v = x[k]; } catch (e) { v = null; }
        var t = typeof v;
        if (t === 'number') { out[k] = isFinite(v) ? v : String(v); n++; }
        else if (t === 'string') { out[k] = v.length > 64 ? v.slice(0, 64) : v; n++; }
        else if (t === 'boolean' || v === null) { out[k] = v; n++; }
        else if (Object.prototype.toString.call(v) === '[object Array]') { out[k] = 'array[' + v.length + ']'; n++; }
        else if (t === 'object') { out[k] = 'obj'; n++; }
        else { out[k] = t; n++; }
      }
      return out;
    };
    W.domGet = function (id) { try { return document.getElementById(id); } catch (e) { return null; } };
    W.visible = function (el) { try { if (!el) return false; var r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; } catch (e) { return false; } };
    W.text = function (el) {
      var s = '';
      try { s = (el && el.textContent) ? String(el.textContent) : ''; } catch (e) { s = ''; }
      s = s.replace(/[ \t\r\n]+/g, ' ').trim();
      return s.length > 400 ? s.slice(0, 400) : s;
    };
    W.preview = function () { return (typeof window.__lastNotePreview === 'string') ? window.__lastNotePreview : null; };
    W.fwd = function () { return (typeof window.__lastFwd === 'number') ? window.__lastFwd : null; };
    W.notes = function () { try { return (typeof window.__avNotes === 'function') ? window.__avNotes() : null; } catch (e) { return null; } };
    W.heldCount = function () { var s = W.notes(); return (s && Object.prototype.toString.call(s.held) === '[object Array]') ? s.held.length : null; };
    W.takenCount = function () { var s = W.notes(); return (s && Object.prototype.toString.call(s.taken) === '[object Array]') ? s.taken.length : null; };
    W.kbSnap = function () { try { return (typeof window.__avKb === 'function') ? window.__avKb() : null; } catch (e) { return null; } };
    W.kbHeld = function () { var k = W.kbSnap(); return (k && Object.prototype.toString.call(k.held) === '[object Array]') ? k.held.length : null; };
    W.pianoClosed = function () { try { return document.body.classList.contains('piano-closed'); } catch (e) { return null; } };
    W.seqPlaying = function () {
      try { if (typeof avSeqIsPlaying === 'function') return avSeqIsPlaying() === true; } catch (e) { /* fall through */ }
      try {
        var S = window.__avSeq;
        if (typeof S === 'function') { var s = S(); if (s && typeof s.playing === 'boolean') return s.playing; }
        else if (S && typeof S.playing === 'boolean') return S.playing;
      } catch (e2) { /* unreadable */ }
      return null;
    };
    W.patSnap = function () { try { return (typeof avSeqSnap === 'function') ? avSeqSnap() : null; } catch (e) { return null; } };
    W.patNoteCount = function () {
      try {
        var s = W.patSnap();
        if (!s || Object.prototype.toString.call(s.tracks) !== '[object Array]') return null;
        var n = 0;
        for (var t = 0; t < s.tracks.length; t++) {
          var steps = (s.tracks[t] && s.tracks[t].steps) || [];
          for (var i = 0; i < steps.length; i++) if (steps[i] && steps[i].on) n++;
        }
        return n;
      } catch (e) { return null; }
    };
    W.arm = function () {
      var k = W.kbSnap();
      W.orig = { mode: k ? k.mode : null, closed: W.pianoClosed() };
      return W.orig;
    };
    W.quiet = function () {
      try { if (typeof avSeqStop === 'function' && W.seqPlaying() === true) avSeqStop(); } catch (e) { /* keep going */ }
      try { if (typeof avNoteStopAll === 'function') avNoteStopAll(); } catch (e2) { /* keep going */ }
      return { playing: W.seqPlaying(), held: W.heldCount() };
    };
    W.setPiano = function (open) { try { if (typeof avPianoSetOpen === 'function') { avPianoSetOpen(!!open); return W.pianoClosed(); } } catch (e) { return null; } return null; };
    W.closeOverlays = function () {
      try { if (typeof avHelpClose === 'function') avHelpClose(); } catch (e) { /* fine */ }
      try { if (typeof avPaletteClose === 'function') avPaletteClose(); } catch (e2) { /* fine */ }
      return { help: W.helpState().open, pal: W.palState().open };
    };

    /* ---- surface: the wave's pinned globals + rail markup ---- */
    W.surface = function () {
      var g = function (n) { return typeof window[n]; };
      var pinned = ['avHelpOpen', 'avPaletteCommands', 'avLessonsList', 'avKbPopOpen'];
      var support = ['avHelpInit', 'avHelpClose', 'avHelpIsOpen', 'avHelpTour', 'avUiKeyHook', 'avPaletteInit', 'avPaletteOpen', 'avPaletteClose', 'avPaletteKey', 'avKbPopInit', 'avKbPopHome', 'avKbPopIsOut', 'avLessonsInit', 'avLessonRun', 'avLessonAction', 'avWizRun'];
      var missing = [], smissing = [], i;
      for (i = 0; i < pinned.length; i++) if (g(pinned[i]) !== 'function') missing.push(pinned[i]);
      for (i = 0; i < support.length; i++) if (g(support[i]) !== 'function') smissing.push(support[i]);
      var H = window.__avHelp || null, P = window.__avPalette || null, L = window.__avLessons || null, KB = window.__avKbPop || null;
      return {
        missing: missing, smissing: smissing,
        hasHelp: !!H, hasPal: !!P, hasLessons: !!L, hasKbPop: !!KB,
        versions: { help: H ? H.version : null, pal: P ? P.version : null, lessons: L ? L.version : null, kbPop: KB ? KB.version : null },
        helpMiss: H ? ['open', 'tour'].filter(function (k) { return H[k] === undefined; }) : 'no handle',
        palOpenType: P ? typeof P.open : 'no handle',
        palIsOpenType: P ? typeof P.isOpen : 'no handle',
        palOpenState: (function () { try { return (P && typeof P.isOpen === 'function') ? (P.isOpen() === true) : null; } catch (e) { return 'err'; } })(),
        lessonsMiss: L ? ['list', 'run', 'action', 'wiz'].filter(function (k) { return L[k] === undefined; }) : 'no handle',
        pkPop: (function () { var b = W.domGet('pk-pop'); return b ? { tag: String(b.tagName), cls: String(b.className).slice(0, 60), vis: W.visible(b), label: W.text(b).slice(0, 40), title: b.getAttribute ? String(b.getAttribute('title') || '').slice(0, 60) : null } : null; })(),
        pkReturn: (function () { var b = W.domGet('pk-return'); return b ? { tag: String(b.tagName), vis: W.visible(b), label: W.text(b).slice(0, 40) } : null; })(),
        helpBtn: (function () { var b = W.domGet('av-help'); return b ? { tag: String(b.tagName), text: W.text(b).slice(0, 28) } : null; })()
      };
    };

    /* ---- popout legs ---- */
    W.popOpen = function (opts) {
      return new Promise(function (res) {
        var out = { opts: opts || null, via: null, error: null, thrown: null, ms: null, timedOut: false };
        var t0 = Date.now();
        var done = false;
        var fin = function () { if (done) return; done = true; out.ms = Date.now() - t0; res(out); };
        var timer = setTimeout(function () { out.timedOut = true; fin(); }, 9000);
        try {
          if (typeof avKbPopOpen !== 'function') { out.thrown = 'avKbPopOpen missing'; clearTimeout(timer); return fin(); }
          Promise.resolve(avKbPopOpen(opts)).then(function (r) {
            clearTimeout(timer);
            if (r && typeof r === 'object') { out.via = (r.via === undefined) ? null : r.via; out.error = (r.error === undefined) ? null : r.error; out.raw = W.light(r); }
            else out.raw = (r === undefined ? 'undefined' : String(r));
            fin();
          }, function (e) { clearTimeout(timer); out.thrown = String(e && e.message || e); fin(); });
        } catch (e) { clearTimeout(timer); out.thrown = String(e && e.message || e); fin(); }
      });
    };
    W.popState = function () {
      var out = {
        popped: document.body.classList.contains('piano-pop'),
        appKeys: document.querySelectorAll('#piano-keys .pk-key').length,
        docked: !!document.querySelector('#piano-dock #piano-keys'),
        keys61: document.querySelectorAll('#piano-keys .pk-key').length,
        out: null
      };
      try { out.out = (typeof avKbPopIsOut === 'function') ? avKbPopIsOut() === true : null; } catch (e) { out.outErr = String(e && e.message || e); }
      return out;
    };
    W.home = function () {
      return new Promise(function (res) {
        var out = { ret: null }, done = false;
        var fin = function () { if (done) return; done = true; out.state = W.popState(); res(out); };
        var timer = setTimeout(function () { out.timedOut = true; fin(); }, 7000);
        try {
          if (typeof avKbPopHome !== 'function') { out.thrown = 'avKbPopHome missing'; clearTimeout(timer); return fin(); }
          Promise.resolve(avKbPopHome()).then(function (r) { clearTimeout(timer); out.ret = W.light(r) === null ? (typeof r === 'boolean' ? r : null) : W.light(r); fin(); }, function (e) { clearTimeout(timer); out.thrown = String(e && e.message || e); fin(); });
        } catch (e) { clearTimeout(timer); out.thrown = String(e && e.message || e); fin(); }
      });
    };
    W.popBlocked = function () {
      return new Promise(function (res) {
        var real = window.open, out = { restored: false, stubbed: false };
        var finish = function () {
          try { window.open = real; out.restored = (window.open === real); } catch (e) { out.restoreErr = String(e && e.message || e); }
          out.state = W.popState();
          res(out);
        };
        try { window.open = function () { return null; }; out.stubbed = true; } catch (e) { out.stubErr = String(e && e.message || e); return finish(); }
        W.popOpen({ pip: false }).then(function (r) { out.r = r; finish(); });
      });
    };
    W.dpip = function () {
      var out = { avail: false };
      try {
        var dpp = window.documentPictureInPicture;
        out.avail = !!(dpp && typeof dpp.requestWindow === 'function');
        out.haveWindow = !!(dpp && dpp.window);
        out.liveWindow = !!(dpp && dpp.window && !dpp.window.closed);
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };
    W.dpipState = function () {
      var out = { popped: document.body.classList.contains('piano-pop'), appKeys: document.querySelectorAll('#piano-keys .pk-key').length, pipWin: false };
      try {
        var pw = window.documentPictureInPicture && window.documentPictureInPicture.window;
        out.pipWin = !!pw;
        if (pw && pw.document) {
          out.pipKeys = pw.document.querySelectorAll('#piano-keys .pk-key').length;
          out.pipBar = !!(pw.document.querySelector('.av-pop-bar') || pw.document.getElementById('pk-pop-bar'));
        }
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };
    W.popFwdArm = function () {
      var out = {};
      try { if (typeof avSetInputMode === 'function') { avSetInputMode('keys', { persist: false }); out.modeSet = true; } } catch (e) { out.modeErr = String(e && e.message || e); }
      out.fwd = W.fwd(); out.preview = W.preview(); out.held = W.heldCount();
      var k = W.kbSnap(); out.mode = k ? k.mode : null; out.armed = k ? k.armed : null;
      return out;
    };
    W.popFwdWit = function () { return { preview: W.preview(), fwd: W.fwd(), held: W.heldCount(), kbHeld: W.kbHeld() }; };
    W.keyClickTest = function () {
      var out = {};
      try {
        var k = document.querySelector('#piano-keys .pk-key[data-midi="60"]');
        if (!k) { out.err = 'no c4 key in the dock'; return out; }
        out.note = String(k.dataset.note || '');
        out.prev0 = W.preview();
        k.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 11, isPrimary: true }));
        out.prev1 = W.preview();
        out.held1 = W.heldCount();
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };
    W.keyReleaseTest = function () {
      var out = {};
      try {
        var box = document.getElementById('piano-keys');
        if (box) box.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 11, isPrimary: true }));
        try { if (typeof avNoteStopAll === 'function') avNoteStopAll(); } catch (e2) { /* fine */ }
        out.held = W.heldCount();
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };

    /* ---- help legs ---- */
    W.helpState = function () {
      var out = { open: null, overlay: false, vis: false, w: null, h: null };
      try { out.open = (typeof avHelpIsOpen === 'function') ? avHelpIsOpen() === true : null; } catch (e) { out.openErr = String(e && e.message || e); }
      var ov = document.getElementById('av-help-overlay');
      out.overlay = !!ov;
      out.vis = W.visible(ov);
      if (ov) { var r = ov.getBoundingClientRect(); out.w = Math.round(r.width); out.h = Math.round(r.height); }
      return out;
    };
    W.helpTabShortcuts = function () {
      var ov = document.getElementById('av-help-overlay');
      if (!ov) return { err: 'no overlay' };
      var btns = ov.querySelectorAll('button'), sh = null, i;
      for (i = 0; i < btns.length; i++) { if (W.text(btns[i]).toLowerCase().indexOf('shortcut') >= 0) { sh = btns[i]; break; } }
      if (sh) { try { sh.click(); } catch (e) { /* fine */ } }
      var txt = W.text(ov);
      var n = txt.toLowerCase().replace(/[^a-z0-9+#-]+/g, '');
      var has = function (a, b, c) { return n.indexOf(a) >= 0 || n.indexOf(b) >= 0 || n.indexOf(c) >= 0; };
      return {
        tabFound: !!sh, norm: n.slice(0, 600),
        ctrlAlt1: has('ctrl+alt+1', 'ctrl-alt-1', 'ctrlalt1'),
        ctrlAlt2: has('ctrl+alt+2', 'ctrl-alt-2', 'ctrlalt2'),
        ctrlAlt3: has('ctrl+alt+3', 'ctrl-alt-3', 'ctrlalt3'),
        ctrlK: has('ctrl+k', 'ctrl-k', 'ctrlk'),
        text: txt.slice(0, 300)
      };
    };
    W.yToggle = function () {
      var out = {};
      try {
        var mk = function () { var e = new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', bubbles: true, cancelable: true }); document.dispatchEvent(e); return e.defaultPrevented; };
        out.before = document.body.classList.contains('piano-closed');
        out.p1 = mk(); out.c1 = document.body.classList.contains('piano-closed');
        out.p2 = mk(); out.c2 = document.body.classList.contains('piano-closed');
        out.help = W.helpState();
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };
    W.qEscCycle = function () {
      var out = { seq: [] };
      var send = function (key, code, shift) {
        var e = new KeyboardEvent('keydown', { key: key, code: code || key, shiftKey: !!shift, bubbles: true, cancelable: true });
        document.dispatchEvent(e);
        return e.defaultPrevented;
      };
      try {
        out.seq.push({ step: 'start', open: W.helpState().open });
        out.pq1 = send('?', 'Slash', true); out.seq.push({ step: 'q1', open: W.helpState().open });
        out.pq2 = send('?', 'Slash', true); out.seq.push({ step: 'q2', open: W.helpState().open });
        out.pEsc = send('Escape', 'Escape', false); out.seq.push({ step: 'esc', open: W.helpState().open });
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };

    /* ---- tour legs ---- */
    W.tourState = function () {
      var H = window.__avHelp || null;
      return (H && H.tour) ? { active: H.tour.active === true, step: W.num(H.tour.step), total: W.num(H.tour.total) } : null;
    };
    W.ringProbe = function () {
      var known = ['#av-help-ring', '#av-tour-ring', '.av-help-ring', '.av-tour-ring', '.av-help-cutout', '.av-tour-cutout', '.av-help-hole', '.av-tour-hole', '.av-cut', '.av-shade', '.av-spot', '[data-av-ring]', '[data-av-tour]'];
      var hits = [], i, j, els;
      for (i = 0; i < known.length; i++) { try { els = document.querySelectorAll(known[i]); for (j = 0; j < els.length; j++) if (W.visible(els[j])) hits.push(known[i]); } catch (e) { /* selector */ } }
      var loose = [];
      try {
        var all = document.querySelectorAll('div,span,section');
        for (i = 0; i < all.length && loose.length < 8; i++) {
          try { if (all[i].closest && all[i].closest('#av-help-overlay')) continue; } catch (e3) { /* fine */ }
          var c = String(all[i].className || '');
          if (!c) continue;
          var cl = c.toLowerCase();
          if ((cl.indexOf('ring') >= 0 || cl.indexOf('cut') >= 0 || cl.indexOf('shade') >= 0 || cl.indexOf('spot') >= 0 || cl.indexOf('tour') >= 0 || cl.indexOf('help') >= 0) && W.visible(all[i])) loose.push(c.slice(0, 48));
        }
      } catch (e2) { /* fine */ }
      return { known: hits.length, knownSel: W.safe(hits), loose: loose.length, looseSample: W.safe(loose) };
    };
    W.tourArm = function () {
      var out = {};
      try {
        W.tourLog = { calls: [], hadAction: (typeof window.avLessonAction === 'function'), orig: null };
        W.tourPre = { name: (W.patSnap() || {}).name || null, notes: W.patNoteCount(), playing: W.seqPlaying() };
        if (W.tourLog.hadAction) {
          var orig = window.avLessonAction;
          W.tourLog.orig = orig;
          window.avLessonAction = function (k) {
            var r = null, err = null;
            try { r = orig(k); } catch (e) { err = String(e && e.message || e); }
            W.tourLog.calls.push({ k: String(k), r: W.light(r), err: err });
            return r;
          };
        }
        out.hadAction = W.tourLog.hadAction;
        out.pre = W.tourPre;
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };
    W.tourRestore = function () { try { if (W.tourLog && W.tourLog.orig) window.avLessonAction = W.tourLog.orig; return true; } catch (e) { return false; } };
    W.tourStart = function () {
      var out = {};
      try {
        if (typeof avHelpTour !== 'function') { out.err = 'avHelpTour missing'; return out; }
        W.tour = avHelpTour([
          { sel: '#av-levels', title: 'S5 rig step 1', text: 'The levels card (rig step).' },
          { sel: null, title: 'S5 rig step 2', text: 'The action step (rig).', action: 'seq.demo' },
          { sel: '#piano-dock', title: 'S5 rig step 3', text: 'The dock (rig).' }
        ]);
        out.hasHandle = !!(W.tour && typeof W.tour.next === 'function' && typeof W.tour.skip === 'function');
        out.handleMiss = W.tour ? ['next', 'prev', 'skip', 'done'].filter(function (k) { return typeof W.tour[k] !== 'function'; }) : 'none';
        out.state = W.tourState();
        out.ring = W.ringProbe();
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };
    W.tourNext = function () {
      var out = {};
      try { if (W.tour && typeof W.tour.next === 'function') W.tour.next(); out.state = W.tourState(); } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };
    W.tourLive = function () {
      return {
        state: W.tourState(),
        calls: (W.tourLog ? W.tourLog.calls : []),
        post: { name: (W.patSnap() || {}).name || null, notes: W.patNoteCount(), playing: W.seqPlaying() },
        pre: W.tourPre
      };
    };
    W.tourSkip = function () {
      var out = {};
      try { if (W.tour && typeof W.tour.skip === 'function') W.tour.skip(); out.state = W.tourState(); } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };
    W.tourClose = function () {
      var out = { before: W.tourState() };
      try { if (W.tour && typeof W.tour.skip === 'function') W.tour.skip(); } catch (e) { /* fine */ }
      try { if (W.lessonTour && typeof W.lessonTour.skip === 'function') W.lessonTour.skip(); } catch (e1) { /* fine */ }
      try { if (W.lessonTour && typeof W.lessonTour.done === 'function' && W.tourState() && W.tourState().active) W.lessonTour.done(); } catch (e2) { /* fine */ }
      try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); } catch (e3) { /* fine */ }
      try { if (typeof avHelpClose === 'function') avHelpClose(); } catch (e4) { /* fine */ }
      out.after = W.tourState();
      return out;
    };

    /* ---- tip legs ---- */
    W.tipState = function () { var t = document.getElementById('av-tip'); return { exists: !!t, vis: W.visible(t), txt: t ? W.text(t).slice(0, 100) : null }; };
    W.tipProbe = function () {
      var cands = ['#btn-piano', '#pk-pop', '#pk-close', '#av-help', '#pk-oct-down', '#pk-oct-up', '#pk-mode-hint', '#av-version'];
      var out = { tried: [] };
      var show = function (sel) {
        var el = document.querySelector(sel);
        if (!el) { out.tried.push({ sel: sel, found: false }); return false; }
        var r = el.getBoundingClientRect();
        var opts = { bubbles: true, cancelable: true, pointerId: 7, isPrimary: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
        try { el.dispatchEvent(new PointerEvent('pointerover', opts)); } catch (e) { out.tried.push({ sel: sel, err: String(e && e.message || e) }); return false; }
        var st = W.tipState();
        out.tried.push({ sel: sel, found: true, tipEl: st.exists, vis: st.vis, txt: st.txt ? st.txt.slice(0, 80) : null });
        if (st.vis && st.txt) { out.winner = sel; out.text = st.txt.slice(0, 120); return true; }
        return false;
      };
      for (var i = 0; i < cands.length; i++) if (show(cands[i])) break;
      W.tipWinner = out.winner || null;
      return out;
    };
    W.tipHide = function () {
      var out = { before: W.tipState().vis };
      try {
        if (W.tipWinner) { var el = document.querySelector(W.tipWinner); if (el) el.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, cancelable: true, pointerId: 7, isPrimary: true })); }
        document.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, cancelable: true, pointerId: 7, isPrimary: true }));
      } catch (e) { out.err = String(e && e.message || e); }
      out.after = W.tipState().vis;
      return out;
    };

    /* ---- palette legs ---- */
    W.palState = function () {
      var P = window.__avPalette || null;
      var ov = document.getElementById('av-palette');
      var open = null;
      try { if (P) open = (typeof P.isOpen === 'function') ? (P.isOpen() === true) : ((typeof P.open === 'boolean') ? P.open : !!P.open); } catch (e) { open = null; }
      return { handle: !!P, open: open, ov: !!ov, vis: W.visible(ov) };
    };
    W.palKey = function (o) {
      o = o || {};
      var out = {};
      try {
        var target = document, field = null, temp = false;
        if (o.field) {
          field = document.querySelector('#av-code-src') || document.querySelector('textarea');
          if (!field) {
            field = document.createElement('textarea');
            field.id = '__s5_ta';
            field.style.position = 'fixed';
            field.style.left = '-9999px';
            document.body.appendChild(field);
            temp = true;
          }
          try { field.focus(); } catch (e0) { /* headless may refuse */ }
          target = field;
        }
        out.field = field ? (field.id || String(field.tagName).toLowerCase()) : null;
        out.temp = temp;
        out.activeBefore = (document.activeElement === field);
        out.pre = W.palState();
        var evt = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true });
        target.dispatchEvent(evt);
        out.prevented = evt.defaultPrevented;
        out.post = W.palState();
        if (temp) { try { field.parentNode.removeChild(field); } catch (e1) { /* fine */ } }
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };
    W.palEsc = function () {
      var e = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
      try { document.dispatchEvent(e); } catch (ex) { /* fine */ }
      return { prevented: e.defaultPrevented, state: W.palState() };
    };
    W.palEnsureClosed = function () { if (W.palState().open === true) W.palEsc(); return W.palState(); };
    W.palType = function (t) {
      var out = {};
      try {
        var inp = document.getElementById('av-palette-input');
        if (!inp) { out.err = 'no #av-palette-input'; return out; }
        inp.value = String(t);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        var list = document.getElementById('av-palette-list');
        var rows = list ? list.querySelectorAll('.av-palette-row') : [];
        out.n = rows.length;
        var outRows = [], i;
        for (i = 0; i < rows.length && i < 6; i++) outRows.push(W.text(rows[i]).slice(0, 90));
        out.rows = outRows;
        out.first = outRows.length ? outRows[0] : null;
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };
    W.palEnter = function () {
      var out = {};
      try {
        var inp = document.getElementById('av-palette-input');
        var target = inp || document;
        out.closedBefore = document.body.classList.contains('piano-closed');
        var evt = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
        target.dispatchEvent(evt);
        out.prevented = evt.defaultPrevented;
        out.closedAfter = document.body.classList.contains('piano-closed');
        out.pal = W.palState();
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };

    /* ---- lessons legs ---- */
    W.firstRun = function () {
      var el = document.getElementById('av-firstrun');
      var btn = el ? (String(el.tagName) === 'BUTTON' ? el : el.querySelector('button')) : null;
      return { present: !!el, vis: W.visible(el), text: el ? W.text(el).slice(0, 160) : null, btn: !!btn, btnText: btn ? W.text(btn).slice(0, 120) : null };
    };
    W.firstRunClick = function () {
      var out = {};
      try {
        var el = document.getElementById('av-firstrun');
        if (!el) { out.err = 'no #av-firstrun'; return out; }
        var btn = (String(el.tagName) === 'BUTTON') ? el : el.querySelector('button');
        if (!btn) { out.err = 'no button in #av-firstrun'; return out; }
        out.btnText = W.text(btn).slice(0, 120);
        btn.click();
        out.clicked = true;
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };
    W.firstRunAfter = function () {
      var el = document.getElementById('av-firstrun');
      var flag = null;
      try { flag = localStorage.getItem('av-first-run'); } catch (e) { flag = 'ERR'; }
      return { notes: W.patNoteCount(), playing: W.seqPlaying(), flag: flag, stripPresent: !!el, stripVis: W.visible(el), name: (W.patSnap() || {}).name || null, preview: W.preview() };
    };
    W.lessonsList = function () {
      var out = {};
      try {
        var L = (typeof avLessonsList === 'function') ? avLessonsList() : null;
        if (Object.prototype.toString.call(L) !== '[object Array]') { out.err = 'avLessonsList not an array'; out.raw = W.light(L); return out; }
        var want = ['demo', 'first-beat', 'acid-line', 'sample-chop', 'stems-export'];
        var ids = [], bad = [], steps = [], i;
        for (i = 0; i < L.length; i++) {
          var x = L[i] || {};
          ids.push(x.id);
          if (typeof x.title !== 'string' || !x.title || typeof x.blurb !== 'string' || Object.prototype.toString.call(x.steps) !== '[object Array]') bad.push(x.id);
          steps.push(Object.prototype.toString.call(x.steps) === '[object Array]' ? x.steps.length : null);
        }
        var missing = [];
        for (i = 0; i < want.length; i++) if (ids.indexOf(want[i]) < 0) missing.push(want[i]);
        out.n = L.length; out.ids = W.safe(ids); out.missing = W.safe(missing); out.bad = W.safe(bad); out.steps = W.safe(steps.slice(0, 8));
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };
    W.lessonsRun = function (id) {
      var out = {};
      try {
        if (typeof avLessonRun !== 'function') { out.err = 'avLessonRun missing'; return out; }
        var r = avLessonRun(id);
        out.ret = W.light(r);
        /* avLessonRun returns { ok, note, handle } — the tour handle is r.handle; a bare-handle
           return is still accepted, but the wrapper is never captured as the handle. */
        var h = (r && r.handle && typeof r.handle.skip === 'function') ? r.handle : ((r && typeof r.skip === 'function') ? r : null);
        if (h) { W.lessonTour = h; out.handle = true; }
        out.state = W.tourState();
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };

    /* ---- wizard legs ---- */
    W.paramSnap = function () {
      var out = {};
      try {
        if (typeof avParams === 'undefined' || !avParams) return null;
        for (var k in avParams) {
          var v = avParams[k], t = typeof v;
          if (t === 'number' || t === 'string' || t === 'boolean') out[k] = v;
        }
      } catch (e) { return null; }
      return out;
    };
    W.paramMark = function () { W.param0 = W.paramSnap(); return { keys: W.param0 ? Object.keys(W.param0).length : null }; };
    W.paramDiff = function (a, b) {
      var out = { changed: [], count: 0, total: 0, err: null };
      try {
        if (!a || !b) return out;
        var keys = {}, i;
        for (i in a) keys[i] = 1;
        for (i in b) keys[i] = 1;
        for (i in keys) {
          out.total++;
          if (String(a[i]) !== String(b[i])) {
            out.count++;
            if (out.changed.length < 14) out.changed.push({ k: i, a: String(a[i]).slice(0, 24), b: String(b[i]).slice(0, 24) });
          }
        }
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };
    W.paramDiffMark = function () { return W.paramDiff(W.param0, W.paramSnap()); };
    W.wiz = function (kind) {
      var out = {};
      try {
        if (typeof avWizRun !== 'function') { out.err = 'avWizRun missing'; return out; }
        out.ret = W.light(avWizRun(kind));
        var p = document.getElementById('av-wiz');
        out.panel = !!p; out.vis = W.visible(p);
        out.text = p ? W.text(p).slice(0, 200) : null;
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };
    W.wizPick = function () {
      var out = {};
      try {
        var p = document.getElementById('av-wiz');
        if (!p) { out.err = 'no #av-wiz'; return out; }
        var btns = p.querySelectorAll('button'), i, j;
        out.buttons = btns.length;
        var act = ['audition', 'keep', 'reroll', 'close', 'cancel', 'done', 'stop'];
        var choosy = [];
        for (i = 0; i < btns.length; i++) {
          var t = W.text(btns[i]).toLowerCase();
          var isAct = false;
          for (j = 0; j < act.length; j++) if (t.indexOf(act[j]) >= 0) isAct = true;
          var hasAlnum = false;
          for (var c = 0; c < t.length; c++) { var ch = t.charAt(c); if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) { hasAlnum = true; break; } }
          if (!isAct && hasAlnum) choosy.push(btns[i]);
        }
        out.choosy = choosy.length;
        /* the panel re-renders its option rows after EVERY pick — a held button reference goes
           stale the moment another pick re-renders, and a click on a detached node never reaches
           the panel's delegated listener. Re-query fresh per row via the pinned data attributes. */
        var clicked = [];
        for (i = 0; i < 4; i++) {
          var opt = p.querySelector('.av-wiz-opt[data-wizrow="' + i + '"][data-wizopt="0"]');
          if (!opt) { clicked.push('row' + i + ':none'); continue; }
          opt.click();
          clicked.push(W.text(opt).slice(0, 40));
        }
        out.groups = clicked.filter(function (x) { return x.indexOf(':none') < 0; }).length;
        out.clicked = clicked;
        out.panelStill = W.visible(document.getElementById('av-wiz'));
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };
    W.wizAudition = function () {
      var out = {};
      try {
        var p = document.getElementById('av-wiz');
        if (!p) { out.err = 'no #av-wiz'; return out; }
        var btns = p.querySelectorAll('button'), b = null, i;
        for (i = 0; i < btns.length; i++) if (W.text(btns[i]).toLowerCase().indexOf('audition') >= 0) { b = btns[i]; break; }
        if (!b) { out.err = 'no AUDITION button'; return out; }
        out.pre = { preview: W.preview(), taken: W.takenCount(), held: W.heldCount() };
        b.click();
        out.clicked = true;
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };
    W.wizProbe = function () { return { preview: W.preview(), taken: W.takenCount(), held: W.heldCount() }; };
    W.wizKeep = function () {
      var out = {};
      try {
        var p = document.getElementById('av-wiz');
        if (!p) { out.err = 'no #av-wiz'; return out; }
        var btns = p.querySelectorAll('button'), b = null, i, texts = [];
        for (i = 0; i < btns.length; i++) {
          texts.push(W.text(btns[i]).slice(0, 24));
          if (!b && W.text(btns[i]).toLowerCase().indexOf('keep') >= 0) b = btns[i];
        }
        if (!b) { out.err = 'no KEEP button'; out.texts = texts; return out; }
        b.click();
        out.clicked = true;
      } catch (e) { out.err = String(e && e.message || e); }
      return out;
    };
    W.wizState = function () { var p = document.getElementById('av-wiz'); return { panel: !!p, vis: W.visible(p) }; };

    /* ---- cleanup: home, overlays closed, mode/piano restored, notes released ---- */
    W.cleanup = function () {
      var out = { steps: [] };
      var step = function (name, fn) { try { fn(); out.steps.push(name + ':ok'); } catch (e) { out.steps.push(name + ':err ' + String(e && e.message || e)); } };
      return new Promise(function (res) {
        step('notes', function () { if (typeof avNoteStopAll === 'function') avNoteStopAll(); });
        step('seq', function () { if (typeof avSeqStop === 'function' && W.seqPlaying() === true) avSeqStop(); });
        step('tourClose', function () { W.tourClose(); });
        step('help', function () { if (typeof avHelpClose === 'function') avHelpClose(); });
        step('palette', function () { if (typeof avPaletteClose === 'function') avPaletteClose(); });
        step('wiz', function () {
          var p = document.getElementById('av-wiz');
          if (p && W.visible(p)) {
            var btns = p.querySelectorAll('button');
            for (var i = 0; i < btns.length; i++) if (W.text(btns[i]).toLowerCase().indexOf('keep') >= 0) { btns[i].click(); break; }
          }
        });
        var p1;
        try { p1 = (typeof avKbPopHome === 'function') ? Promise.resolve(avKbPopHome()) : Promise.resolve(null); } catch (e) { p1 = Promise.resolve(null); }
        Promise.resolve(p1).then(function () {
          step('mode', function () { if (typeof avSetInputMode === 'function' && W.orig && W.orig.mode) avSetInputMode(W.orig.mode, { persist: false }); });
          step('piano', function () { if (typeof avPianoSetOpen === 'function' && W.orig && typeof W.orig.closed === 'boolean') avPianoSetOpen(!W.orig.closed); });
          step('notes2', function () { if (typeof avNoteStopAll === 'function') avNoteStopAll(); });
          var k = W.kbSnap();
          out.final = {
            mode: k ? k.mode : null,
            armed: k ? k.armed : null,
            closed: W.pianoClosed(),
            held: W.heldCount(),
            popped: document.body.classList.contains('piano-pop'),
            keys61: document.querySelectorAll('#piano-dock #piano-keys .pk-key').length,
            helpOpen: (typeof avHelpIsOpen === 'function') ? avHelpIsOpen() === true : null,
            palOpen: W.palState().open,
            winOpenType: typeof window.open,
            flag: (function () { try { return localStorage.getItem('av-first-run'); } catch (e) { return 'ERR'; } })(),
            tour: W.tourState()
          };
          out.orig = W.orig;
          res(out);
        }, function () { out.final = null; res(out); });
      });
    };

    return W;
  })();
  return true;
};

const shotPath = path.join(here, '..', 'renders', 's5-suite.png');

async function main() {
  /* a fresh Edge profile opens edge://sync-confirmation-dialog/ and edge://newtab/ BEFORE our
     page; wait for the file:// page target itself (smoke law) */
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
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => { });
  await send('Page.bringToFront').catch(() => { });
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR }).catch(() => note('Page.setDownloadBehavior unavailable — anchor writes still fire'));

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) {
      const e = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'unknown';
      note('eval threw: ' + String(e).split('\n')[0].slice(0, 220));
      return { error: e };
    }
    return { value: r.result?.value };
  };
  const val = (r) => (r && r.value !== undefined) ? r.value : null;
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const clickSel = async (sel, after = 300) => {
    const found = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; if (e.scrollIntoView) e.scrollIntoView({ block: 'center', inline: 'center' }); return true; })()`);
    if (found.value !== true) { note('click target missing: ' + sel); return false; }
    await sleep(180);
    const boxR = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width || !r.height) return null; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const b = boxR.value;
    if (!b) { note('click target not visible: ' + sel); return false; }
    await mouse('mousePressed', b.x, b.y);
    await sleep(30);
    await mouse('mouseReleased', b.x, b.y);
    await sleep(after);
    return true;
  };

  /* ---- popout wiring (CDP target enumeration; technique from PF cdp_pop.mjs) ---- */
  let popCur = null;
  const popClose = () => { if (popCur) { try { popCur.close(); } catch { /* done */ } popCur = null; } };
  async function popBind() {
    popClose();
    const live = await getJson('/json/list', 4, 250);
    if (!live) return false;
    const cands = live.filter(t => t.type === 'page' && /^about:blank/.test(String(t.url)) && t.id !== target.id);
    for (const t of cands) {
      let pop = null;
      try {
        pop = await attach(t.webSocketDebuggerUrl);
        const has = await pop.ev(`!!(document.getElementById('piano-keys') || document.querySelector('.av-pop-bar') || document.getElementById('pk-pop-bar'))`);
        if (has === true) { popCur = pop; return true; }
        pop.close();
      } catch { try { pop && pop.close(); } catch { /* a dead shell — try the next candidate */ } }
    }
    return false;
  }
  const popEv = async (expr, tries = 3) => {
    for (let t = 0; t < tries; t++) {
      if (!popCur || popCur.ws.readyState !== 1) {
        let bound = false;
        for (let i = 0; i < 8 && !bound; i++) { bound = await popBind(); if (!bound) await sleep(350); }
        if (!popCur) return undefined;
      }
      try { return await popCur.ev(expr); }
      catch (e) {
        if (/timeout/i.test(String(e && e.message))) { popClose(); continue; }   /* stale socket: re-attach */
        popClose(); throw e;
      }
    }
    return undefined;
  };

  /* ── 1. boot + new globals + rail ── */
  console.log('-- 1. boot + new globals + rail --');
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const r = await ev(`document.documentElement.getAttribute('data-av-ready') === '1'`);
    if (r.value === true) { ready = true; break; }
    await sleep(300);
  }
  const engR = await ev(`(async () => {
    const e = window.__avEngine || {};
    let ctx = (e.handle && e.handle.ctx) || e.ctx || null;
    if (!ctx && typeof avEngineEnsure === 'function') { try { const h = await avEngineEnsure(); ctx = (h && h.ctx) || null; } catch (x) { } }
    if (!ctx) { for (const k in e.handle || {}) { try { const v = e.handle[k]; if (v && typeof v.currentTime === 'number' && typeof v.resume === 'function') { ctx = v; break; } } catch (x) { } } }
    if (!ctx) return { found: false };
    if (ctx.state !== 'running') { try { await Promise.race([ctx.resume().catch(function () { }), new Promise(function (res) { setTimeout(res, 2000); })]); } catch (x) { } }
    for (let i = 0; i < 20 && ctx.state !== 'running'; i++) await new Promise(function (res) { setTimeout(res, 125); });
    return { found: true, state: ctx.state, sampleRate: ctx.sampleRate, scp: typeof ctx.createScriptProcessor === 'function' };
  })()`);
  const eng = val(engR) || {};
  expected(ready === true && eng.found === true && eng.state === 'running' && eng.scp === true && Number(eng.sampleRate) === 48000,
    '1a boot: data-av-ready flips + engine ctx found/running/ScriptProcessor-capable/sr 48k', J({ ready: ready, eng: eng }));
  if (!ready) { console.error('APP NOT READY'); process.exit(1); }
  if (eng.found !== true || eng.state !== 'running') note('engine ctx not running yet — the legs will surface honest refusals');

  await ev('(' + S5W_INSTALL.toString() + ')()');
  const legChk = val(await ev(`(function () {
    var g = function (n) { return typeof window.__s5w[n]; };
    var need = ['popOpen', 'popState', 'home', 'popBlocked', 'dpip', 'dpipState', 'popFwdArm', 'popFwdWit', 'keyClickTest', 'keyReleaseTest',
      'helpState', 'helpTabShortcuts', 'yToggle', 'qEscCycle', 'tourArm', 'tourStart', 'tourNext', 'tourLive', 'tourSkip', 'tourClose', 'tourRestore',
      'tipProbe', 'tipHide', 'tipState', 'palKey', 'palEsc', 'palType', 'palEnter', 'palState', 'palEnsureClosed',
      'firstRun', 'firstRunClick', 'firstRunAfter', 'lessonsList', 'lessonsRun',
      'paramMark', 'paramDiffMark', 'wiz', 'wizPick', 'wizAudition', 'wizProbe', 'wizKeep', 'wizState',
      'quiet', 'setPiano', 'closeOverlays', 'cleanup'];
    var miss = [];
    for (var i = 0; i < need.length; i++) if (g(need[i]) !== 'function') miss.push(need[i]);
    return { v: (window.__s5w && window.__s5w.v) || null, miss: miss };
  })()`));
  expected(legChk && legChk.v === 1 && Array.isArray(legChk.miss) && legChk.miss.length === 0,
    '1b rig helpers injected (__s5w v1: popout + CDP-popup seam · help/tour/tip/palette/lessons/wizard legs · page-side param diffs · cleanup)', J(legChk));

  const srf = val(await ev('window.__s5w.surface()')) || {};
  const verOk = srf.versions && ['help', 'pal', 'lessons', 'kbPop'].every(k =>
    (typeof srf.versions[k] === 'string' && srf.versions[k].length >= 1) || (typeof srf.versions[k] === 'number' && isFinite(srf.versions[k])));
  expected(Array.isArray(srf.missing) && srf.missing.length === 0 && srf.hasHelp === true && srf.hasPal === true && srf.hasLessons === true && srf.hasKbPop === true &&
    verOk && Array.isArray(srf.helpMiss) && srf.helpMiss.length === 0 && typeof srf.palOpenState === 'boolean' && (srf.palOpenType === 'boolean' || srf.palIsOpenType === 'function') && Array.isArray(srf.lessonsMiss) && srf.lessonsMiss.length === 0,
    '1c new globals: avHelpOpen/avPaletteCommands/avLessonsList/avKbPopOpen + window.__avHelp/__avPalette/__avLessons/__avKbPop (versions, member sets)',
    J({ missing: srf.missing, versions: srf.versions, helpMiss: srf.helpMiss, lessonsMiss: srf.lessonsMiss, palOpenType: srf.palOpenType, palIsOpenType: srf.palIsOpenType, palOpenState: srf.palOpenState, smissing: srf.smissing }));

  expected(srf.pkPop && srf.pkPop.tag === 'BUTTON' && srf.pkPop.vis === true && srf.pkReturn && srf.pkReturn.tag !== undefined && srf.helpBtn && srf.helpBtn.tag === 'BUTTON',
    '1d rail + help markup: #pk-pop (rail button, visible while docked) + #pk-return + #av-help button present (help wiring proven by the 6a click)',
    J({ pkPop: srf.pkPop, pkReturn: srf.pkReturn, helpBtn: srf.helpBtn }));

  /* baseline arm: the cleanup restores mode + piano-open state (pattern/params ride the app's own
     first-run flow by design — fresh profile, discarded with it) */
  const arm = val(await ev('window.__s5w.arm()')) || {};
  note('baseline armed: ' + J(arm));

  /* ── 2. popout (named popup) + CDP target + key forward ── */
  console.log('-- 2. popout via avKbPopOpen({pip:false}) + CDP target + key forward --');
  const o2 = val(await ev('window.__s5w.popOpen({ pip: false })'));
  await sleep(500);
  const st2 = val(await ev('window.__s5w.popState()'));
  expected(o2 && o2.via === 'window' && o2.timedOut !== true && o2.thrown == null && st2 && st2.popped === true && st2.appKeys === 0 && st2.out === true,
    '2a popout open: avKbPopOpen({pip:false}) -> via "window" · body.piano-pop · app #piano-keys empty (bed left the app document) · avKbPopIsOut',
    J({ open: o2, state: st2 }));

  let bound = false;
  for (let i = 0; i < 20 && !bound; i++) { bound = await popBind(); if (!bound) await sleep(350); }
  const bd = bound ? (await popEv(`(function () {
    var box = document.getElementById('piano-keys');
    var keys = box ? box.querySelectorAll('.pk-key').length : 0;
    var bar = document.querySelector('.av-pop-bar') || document.getElementById('pk-pop-bar');
    var barBtns = [];
    if (bar) { var bs = bar.querySelectorAll('button'); for (var i = 0; i < bs.length && i < 24; i++) barBtns.push(String(bs[i].textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40)); }
    var allBtns = [];
    var bs2 = document.querySelectorAll('button');
    for (var j = 0; j < bs2.length && j < 24; j++) allBtns.push(String(bs2[j].textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40));
    return { box: !!box, keys: keys, bar: !!bar, barBtns: barBtns, allBtns: allBtns,
      barText: bar ? String(bar.textContent || '').slice(0, 400) : '',
      bodyText: document.body ? String(document.body.textContent || '').slice(0, 200) : '',
      styles: document.querySelectorAll('style').length, title: document.title, hasHead: !!document.head };
  })()`)) : null;
  const bdOk = bd && !bd.__err;
  const bdAll = bdOk ? (bd.barBtns || []).concat(bd.allBtns || []) : [];
  const backOk = bdAll.some(t => /back/i.test(t)) || /back/i.test(String((bd && bd.barText) || ''));
  const armOk = bdAll.some(t => /arm/i.test(t));
  const octOk = /oct/i.test(String((bd && bd.barText) || '') + ' ' + String((bd && bd.bodyText) || '')) || bdAll.some(t => t === '-' || t === '+' || t === '\u2212');
  expected(bound === true && bdOk && bd.box === true && bd.keys === 61 && backOk === true && armOk === true && octOk === true,
    '2b popout target: about:blank page target found via CDP enumeration, bed #piano-keys with 61 keys inside it, bar carries BACK / ARM / OCT',
    J({ bound: bound, box: bd && bd.box, keys: bd && bd.keys, bar: bd && bd.bar, barBtns: bd && bd.barBtns, backOk: backOk, armOk: armOk, octOk: octOk, styles: bd && bd.styles, err: bd && bd.__err }));

  /* forward: 'a' dispatched in the POPOUT realm must reach the opener's ONE keydown path */
  const fw0 = val(await ev('window.__s5w.popFwdArm()'));
  const noteWant = val(await ev(`(typeof avPianoNoteFor === 'function') ? avPianoNoteFor('a') : null`));
  let wit = null;
  if (popCur) {
    await popEv(`(function () { window.__s5hf = null; try { if (!document.hasFocus()) { window.__s5hf = document.hasFocus; document.hasFocus = function () { return true; }; } } catch (e) { } return 1; })()`);
    try { await Promise.race([popCur.send('Page.bringToFront'), sleep(1500)]); } catch { /* fine */ }
    await popEv(`(function () { var e = new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true, cancelable: true }); document.dispatchEvent(e); return { prevented: e.defaultPrevented }; })()`);
    for (let i = 0; i < 14; i++) { await sleep(180); wit = val(await ev('window.__s5w.popFwdWit()')); if (wit && wit.preview === 'c4') break; }
  }
  const fwdAdv = !!(wit && fw0 && typeof wit.fwd === 'number' && typeof fw0.fwd === 'number' && wit.fwd > fw0.fwd);
  expected(popCur && fw0 && wit && wit.preview === 'c4' && fwdAdv,
    '2c key forward: keydown "a" dispatched in the popout realm -> opener __lastNotePreview "c4" + __lastFwd advanced (app computed ' + J(noteWant) + ')',
    J({ pop: !!popCur, before: fw0, after: wit }));

  let up = null;
  if (popCur) {
    await popEv(`(function () { document.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', bubbles: true, cancelable: true })); return 1; })()`);
    for (let i = 0; i < 14; i++) { await sleep(180); up = val(await ev('window.__s5w.popFwdWit()')); if (up && up.held === 0) break; }
    await popEv(`(function () { try { if (window.__s5hf) { document.hasFocus = window.__s5hf; window.__s5hf = null; } } catch (e) { } return 1; })()`);
  }
  expected(up && up.held === 0 && up.kbHeld === 0,
    '2d keyup: forwarded keyup releases the note — avNote bus held 0 + avHeldByKey map empty', J({ up: up }));

  /* ── 3. home + clickable re-bind ── */
  console.log('-- 3. avKbPopHome + clickable re-bind --');
  const h3 = val(await ev('window.__s5w.home()'));
  let st3 = h3 && h3.state;
  if (!(st3 && st3.popped === false && st3.docked === true && st3.keys61 === 61)) { await sleep(700); st3 = val(await ev('window.__s5w.popState()')); }
  expected(st3 && st3.popped === false && st3.docked === true && st3.keys61 === 61 && st3.out === false,
    '3a avKbPopHome: bed back inside #piano-dock (61 keys) · body.piano-pop cleared · avKbPopIsOut false',
    J({ home: h3, state: st3 }));

  const kc = val(await ev('window.__s5w.keyClickTest()'));
  let kcPrev = kc && kc.prev1;
  for (let i = 0; i < 10 && !(kc && kcPrev === kc.note && kc.note); i++) { await sleep(150); kcPrev = val(await ev('window.__lastNotePreview')); }
  const kr = val(await ev('window.__s5w.keyReleaseTest()'));
  expected(kc && !kc.err && typeof kc.note === 'string' && kc.note.length >= 2 && kcPrev === kc.note && kr && kr.held === 0,
    '3b clickable re-bind: pointerdown on the c4 key sounds again after the adoption round trip (' + ((kc && kc.note) || '?') + ') · release cleans',
    J({ click: kc, sweep: kcPrev, release: kr }));

  /* ── 4. blocked popup honesty ── */
  console.log('-- 4. blocked popup honesty --');
  const blk = val(await ev('window.__s5w.popBlocked()'));
  expected(blk && blk.stubbed === true && blk.restored === true && blk.r && blk.r.via === null && blk.r.thrown == null && typeof blk.r.error === 'string' && blk.r.error.length > 0 &&
    blk.state && blk.state.popped === false && blk.state.appKeys === 61 && blk.state.out !== true,
    '4a blocked popup: window.open stubbed to null, pip:false -> via null + error string, NO piano-pop half state, 61 keys stay; window.open restored',
    J(blk));

  /* ── 5. DPIP path (honest skip when the platform lacks it) ── */
  console.log('-- 5. document PiP path-or-skip --');
  const dp = val(await ev('window.__s5w.dpip()')) || {};
  const dp5info = { probe: dp };
  if (dp.avail !== true) {
    expected(true, '5a DPIP path: platform absent — skipped honestly (a note, not a fail)',
      'documentPictureInPicture.requestWindow unavailable; the named-popup path is already proven by 2a-2d');
  } else {
    const o5 = val(await ev('window.__s5w.popOpen()'));
    let ds = val(await ev('window.__s5w.dpipState()'));
    dp5info.evalOpen = o5; dp5info.state = ds;
    if (!(o5 && o5.via === 'dpip' && ds && ds.pipWin === true && ds.pipKeys === 61)) {
      /* the eval-driven open fell back (or refused): retry with a REAL user-gesture click on #pk-pop */
      if (ds && ds.popped === true) { await ev('window.__s5w.home()'); await sleep(500); }
      const clicked = await clickSel('#pk-pop', 900);
      for (let i = 0; i < 12; i++) { ds = val(await ev('window.__s5w.dpipState()')); if (ds && ds.pipWin === true && ds.pipKeys === 61) break; await sleep(250); }
      dp5info.click = clicked; dp5info.state2 = ds;
    }
    const held = !!(ds && ds.pipWin === true && ds.pipKeys === 61 && ds.popped === true);
    let homeOk = false;
    if (held) {
      const hm = val(await ev('window.__s5w.home()'));
      dp5info.home = hm;
      const hs = hm && hm.state;
      homeOk = !!(hs && hs.popped === false && hs.keys61 === 61);
    }
    expected(held && homeOk,
      '5a DPIP path: no-opts open rides document Picture-in-Picture (via "dpip" or a real #pk-pop click) — bed live in the PiP window + avKbPopHome returns',
      J(dp5info));
  }

  /* ── 6. help overlay ── */
  console.log('-- 6. help overlay --');
  await ev(`(function () { try { if (typeof avSetInputMode === 'function') avSetInputMode('studio', { persist: false }); } catch (e) { } return 1; })()`);
  const helpClick = await clickSel('#av-help', 500);
  let hs6 = null;
  for (let i = 0; i < 12; i++) { hs6 = val(await ev('window.__s5w.helpState()')); if (hs6 && hs6.open === true && hs6.vis === true) break; await sleep(200); }
  expected(helpClick === true && hs6 && hs6.open === true && hs6.vis === true && typeof hs6.w === 'number' && hs6.w > 40 && hs6.w <= 480,
    '6a help open: #av-help click -> overlay visible, side panel rect width <= 480 ("help never covers the instrument")', J(hs6));

  const sh6 = val(await ev('window.__s5w.helpTabShortcuts()'));
  expected(sh6 && !sh6.err && sh6.ctrlAlt1 === true && sh6.ctrlAlt2 === true && sh6.ctrlAlt3 === true && sh6.ctrlK === true,
    '6b SHORTCUTS tab lists Ctrl+Alt+1/2/3 and Ctrl+K', J(sh6));

  const y6 = val(await ev('window.__s5w.yToggle()'));
  expected(y6 && !y6.err && y6.c1 !== y6.before && y6.c2 === y6.before && y6.help && y6.help.open === true,
    '6c keyboard not blocked: "y" toggles the piano while the overlay is open (flip observed, restored, overlay still up)', J(y6));

  const q6 = val(await ev('window.__s5w.qEscCycle()'));
  expected(q6 && !q6.err && q6.seq && q6.seq.length === 4 && q6.seq[0].open === true && q6.seq[1].open === false && q6.seq[2].open === true && q6.seq[3].open === false,
    '6d "?" toggles the overlay closed then open; Esc closes it (avUiKeyHook chain through avKbHandle)', J(q6));

  /* ── 7. tour ── */
  console.log('-- 7. avHelpTour 3-step run --');
  const ta = val(await ev('window.__s5w.tourArm()'));
  const t7 = val(await ev('window.__s5w.tourStart()'));
  expected(t7 && !t7.err && t7.state && t7.state.active === true && t7.state.step === 1 && t7.state.total === 3 && t7.hasHandle === true &&
    t7.ring && (t7.ring.known >= 1 || t7.ring.loose >= 1),
    '7a tour start: avHelpTour(3 rig steps) -> active step 1/3 + handle {next,skip,done} + cutout/ring chrome present',
    J({ arm: ta, start: t7 }));

  await ev('window.__s5w.tourNext()');
  let tv = null;
  for (let i = 0; i < 15; i++) { await sleep(200); tv = val(await ev('window.__s5w.tourLive()')); if (tv && tv.state && tv.state.step === 2) break; }
  let act7ok = false, act7detail = 'step did not advance to 2';
  if (tv && tv.state && tv.state.step === 2) {
    const calls = tv.calls || [];
    if (!ta || ta.hadAction !== true) { act7ok = true; act7detail = 'avLessonAction absent (F seam optional) — action leg skipped honestly'; }
    else if (!calls.length) { act7detail = 'no avLessonAction call recorded on entering the action step'; }
    else {
      const c0 = calls[0];
      if (c0.err) { act7detail = 'avLessonAction threw: ' + c0.err; }
      else if (c0.k !== 'seq.demo') { act7detail = 'action key was ' + J(c0.k) + ' (wanted seq.demo)'; }
      else if (c0.r && c0.r.ok === false) { act7ok = true; act7detail = 'app reports action unknown/refused (' + J(c0.r) + ') — stopped, F seam optional'; }
      else if (c0.r == null) { act7ok = true; act7detail = 'action fired, no status returned (unverifiable) · calls ' + J(calls); }
      else {
        let eff = false, effAfter = null;
        for (let i = 0; i < 15; i++) {
          effAfter = val(await ev('window.__s5w.tourLive()'));
          const p0 = tv.pre || {}, p1 = (effAfter && effAfter.post) || {};
          eff = (p1.name !== p0.name) || (typeof p1.notes === 'number' && p1.notes > 0 && p1.notes !== p0.notes) || (p1.playing === true && p0.playing !== true);
          if (eff) break;
          await sleep(200);
        }
        act7ok = eff;
        act7detail = (eff ? 'action fired with live effect' : 'action called ok:true but no live effect seen') + ' · calls ' + J(calls) + ' · post ' + J(effAfter && effAfter.post);
      }
    }
  }
  expected(tv && tv.state && tv.state.step === 2 && act7ok,
    '7b next -> step 2 + the action step fires the F seam (unknown/absent tolerated — the seam is optional)', J({ live: tv, act: act7detail }));

  const sk7 = val(await ev('window.__s5w.tourSkip()'));
  expected(sk7 && !sk7.err && sk7.state && sk7.state.active === false,
    '7c tour skip -> inactive', J(sk7));
  await ev('window.__s5w.tourRestore()');
  await ev('window.__s5w.quiet()');   /* the action leg may have started playback — stop it for isolation */
  note('transport stopped after the tour action leg (isolation for the later witnesses)');

  /* ── 8. tips ── */
  console.log('-- 8. tips --');
  const tip = val(await ev('window.__s5w.tipProbe()'));
  let beforeHide = null, afterHide = null;
  beforeHide = val(await ev('window.__s5w.tipState()'));
  beforeHide = beforeHide ? beforeHide.vis : null;
  for (let i = 0; i < 12; i++) { const hid = val(await ev('window.__s5w.tipHide()')); afterHide = hid ? hid.after : null; if (afterHide === false) break; await sleep(150); }
  expected(tip && !tip.err && tip.winner && typeof tip.text === 'string' && tip.text.length > 0 && beforeHide === true && afterHide === false,
    '8a tips: pointerover a curated control shows #av-tip with text (' + ((tip && tip.winner) || '?') + ') · pointerout hides it',
    J({ probe: tip, before: beforeHide, after: afterHide }));

  /* ── 9. palette ── */
  console.log('-- 9. command palette --');
  const p9a = val(await ev('window.__s5w.palKey({})'));
  const esc9 = val(await ev('window.__s5w.palEsc()'));
  const p9b = val(await ev('window.__s5w.palKey({ field: true })'));
  expected(p9a && !p9a.err && p9a.post && p9a.post.open === true && esc9 && esc9.state && esc9.state.open === false && p9b && !p9b.err && p9b.post && p9b.post.open === true,
    '9a Ctrl+K opens the palette (plain AND from a focused textarea: ' + ((p9b && p9b.field) || '?') + ') · Esc closes',
    J({ plain: p9a, esc: esc9, field: p9b }));

  const ty9 = val(await ev('window.__s5w.palType("pian")'));
  expected(ty9 && !ty9.err && typeof ty9.first === 'string' && /toggle\s*piano/i.test(ty9.first),
    '9b type "pian" -> first row is Toggle piano', J(ty9));

  const en9 = val(await ev('window.__s5w.palEnter()'));
  await ev('window.__s5w.palEnsureClosed()');
  const p9r = val(await ev('window.__s5w.palKey({})'));
  const e9r = val(await ev('window.__s5w.palEsc()'));
  expected(en9 && !en9.err && en9.closedAfter !== en9.closedBefore && p9r && !p9r.err && p9r.post && p9r.post.open === true && e9r && e9r.state && e9r.state.open === false,
    '9c Enter runs the first row (piano-closed flips) · reopen via Ctrl+K · Esc closes',
    J({ enter: en9, reopen: p9r, esc: e9r }));
  await ev('window.__s5w.setPiano(' + ((arm && arm.closed === true) ? 'false' : 'true') + ')');   /* the toggle-flip is restored for the rest of the suite */

  /* ── 10. lessons ── */
  console.log('-- 10. lessons + first-run strip --');
  const fr0 = val(await ev('window.__s5w.firstRun()'));
  expected(fr0 && fr0.present === true && fr0.vis === true && fr0.btn === true,
    '10a first-run strip: #av-firstrun visible with its first-sound button (fresh profile, av-first-run unset)', J(fr0));

  const frc = val(await ev('window.__s5w.firstRunClick()'));
  let fra = null;
  for (let i = 0; i < 25; i++) {
    await sleep(250);
    fra = val(await ev('window.__s5w.firstRunAfter()'));
    if (fra && typeof fra.notes === 'number' && fra.notes > 0 && fra.playing === true && !!fra.flag && fra.stripVis !== true) break;
  }
  expected(frc && frc.clicked === true && fra && typeof fra.notes === 'number' && fra.notes > 0 && fra.playing === true && !!fra.flag && fra.stripVis !== true,
    '10b first sound: click -> demo pattern loaded (avSeqSnap notes > 0) + transport playing + av-first-run set + strip gone',
    J({ click: frc, after: fra }));

  const ll = val(await ev('window.__s5w.lessonsList()'));
  expected(ll && !ll.err && typeof ll.n === 'number' && ll.n >= 5 && Array.isArray(ll.missing) && ll.missing.length === 0 && Array.isArray(ll.bad) && ll.bad.length === 0,
    '10c avLessonsList: ids demo/first-beat/acid-line/sample-chop/stems-export complete, rows carry title/blurb/steps',
    J(ll));

  const lr = val(await ev('window.__s5w.lessonsRun("first-beat")'));
  let lrst = lr && lr.state;
  for (let i = 0; i < 15 && !(lrst && lrst.active === true); i++) { await sleep(200); lrst = val(await ev('window.__s5w.tourState()')); }
  expected(lr && !lr.err && lrst && lrst.active === true,
    '10d avLessonRun("first-beat") starts a tour (active through the help engine)', J({ run: lr, state: lrst }));
  const lc = val(await ev('window.__s5w.tourClose()'));
  note('lesson tour close attempt: ' + J(lc));

  /* ── 11. sound wizard ── */
  console.log('-- 11. avWizRun("bass") --');
  await ev('window.__s5w.quiet()');
  const pmk = val(await ev('window.__s5w.paramMark()'));
  note('pre-wizard param mirror: ' + J(pmk));
  const w11 = val(await ev('window.__s5w.wiz("bass")'));
  expected(w11 && !w11.err && w11.panel === true && w11.vis === true,
    '11a avWizRun("bass") -> #av-wiz panel open', J(w11));

  const wp = val(await ev('window.__s5w.wizPick()'));
  const d11 = val(await ev('window.__s5w.paramDiffMark()'));
  expected(wp && !wp.err && d11 && !d11.err && typeof d11.count === 'number' && d11.count >= 1,
    '11b choices picked -> curated params applied (changed from the pre-wizard snapshot)', J({ pick: wp, diff: d11 }));

  const aud = val(await ev('window.__s5w.wizAudition()'));
  const audStart = aud && aud.pre ? aud.pre.preview : null;
  const audTrail = [];
  let lastProbe = null;
  for (let i = 0; i < 30; i++) {
    await sleep(130);
    lastProbe = val(await ev('window.__s5w.wizProbe()'));
    if (lastProbe && lastProbe.preview && lastProbe.preview !== audStart && audTrail.indexOf(lastProbe.preview) < 0) audTrail.push(lastProbe.preview);
    if (audTrail.length >= 4) break;
  }
  const takenAdv = !!(lastProbe && aud && aud.pre && typeof lastProbe.taken === 'number' && typeof aud.pre.taken === 'number' && lastProbe.taken > aud.pre.taken);
  expected(aud && !aud.err && aud.clicked === true && (audTrail.length >= 1 || takenAdv),
    '11c AUDITION fires notes (witness __lastNotePreview transitions: ' + J(audTrail) + (takenAdv ? ' · note-bus taken advanced' : '') + ')',
    J({ audition: aud, trail: audTrail, last: lastProbe }));

  const kp = val(await ev('window.__s5w.wizKeep()'));
  let wpv = null;
  for (let i = 0; i < 10; i++) { wpv = val(await ev('window.__s5w.wizState()')); if (wpv && wpv.vis === false) break; await sleep(200); }
  const d11d = val(await ev('window.__s5w.paramDiffMark()'));
  expected(kp && !kp.err && kp.clicked === true && wpv && wpv.vis !== true && d11d && !d11d.err && typeof d11d.count === 'number' && d11d.count >= 1,
    '11d KEEP closes the wizard and the curated params stay (diff vs the pre-wizard mirror still >= 1)', J({ keep: kp, panel: wpv, diff: d11d }));
  await ev('window.__s5w.quiet()');

  /* ── 12. seal ── */
  console.log('-- 12. seal --');
  await ev('window.__s5w.quiet()');
  await ev('window.__s5w.tourClose()');
  await ev(`(function () { try { if (typeof avHelpClose === 'function') avHelpClose(); } catch (e) { } try { if (typeof avPaletteClose === 'function') avPaletteClose(); } catch (e2) { } try { window.scrollTo(0, 0); } catch (e3) { } return 1; })()`);
  await sleep(400);
  let shotOk = false, shotInfo = '';
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(shot.data, 'base64');
    try { mkdirSync(path.dirname(shotPath), { recursive: true }); } catch (e) { /* exists */ }
    writeFileSync(shotPath, buf);
    shotOk = buf.length > 1000 && buf[0] === 0x89 && buf[1] === 0x50;
    shotInfo = buf.length + ' bytes · viewport 1440x900';
  } catch (e) { shotInfo = 'capture failed: ' + (e && e.message); }
  expected(shotOk, '12a screenshot: renders/s5-suite.png (the instrument with the S5 wave live)', shotInfo);

  const cl12 = val(await ev('window.__s5w.cleanup()'));
  const fin = cl12 && cl12.final;
  expected(cl12 && fin && fin.held === 0 && fin.popped === false && fin.keys61 === 61 && fin.helpOpen === false && fin.palOpen === false && fin.winOpenType === 'function' &&
    fin.mode === (arm && arm.mode) && fin.closed === (arm && arm.closed),
    '12b cleanup: popout home · overlays closed · mode/piano restored to baseline · notes released · window.open intact',
    J({ cleanup: cl12, arm: arm }));

  expected(errors.length === 0, '12c zero page errors (exceptions · Log errors · console.error)', 'page errors=' + errors.length + (errors.length ? ' | ' + errors.slice(0, 3).join(' | ') : ''));

  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after): ' + shaAfter);
  expected(shaAfter === shaBefore, '12d freeze: index.html sha256 before === after (unchanged by the run)', shaAfter);

  /* ── freeze pin leg ── */
  if (PIN) expected(shaBefore === PIN && shaAfter === PIN, '13 freeze pin leg: index.html sha256 = pinned', 'pinned ' + PIN.slice(0, 12) + '...');
  else note('13 EXPECT_SHA not pinned — after the S5 integration build, pass --sha <hex> or set the constant (never loosen)');

  console.log('');
  console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
  console.log('S5-RESULT ' + JSON.stringify({ kind: 'anvil-cdp-s5', sha256Before: shaBefore, sha256After: shaAfter, pinned: PIN || null, passed: pass, failed: fail, checks: pass + fail, verdict: fail ? 'fail' : 'pass' }));
  console.log(fail ? 'S5 FAILED' : 'S5 PASSED');
  popClose();
  try { ws.close(); } catch { /* done */ }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('s5 harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    /* profile-scoped cleanup (LAW): kill ONLY processes whose command line carries OUR temp
       profile — matched by its unique basename, so the pattern needs no backslash escaping */
    const tag = path.basename(profile);
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
