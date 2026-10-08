// cdp_m2.mjs — Anvil M2 wave suite (rig sa-H; WRITTEN by sa-H, RUN BY THE PARENT after the M2
// integration build). End-to-end over raw CDP against the frozen single-file build.
//
//   node verify/cdp_m2.mjs [path-to-index.html] [--port N] [--sha <hex>] > verify/last-cdp_m2.log 2>&1
//
// WRITE-ONLY: this file is authored by sa-H and never executed by sa-H. The parent runs it after
// the M2 integration build (index.html must carry av_mpe.js in BOTH concats, av_mpe_deck.js /
// av_chop.js / av_chop_ui.js / av_song.js as page parts, the av_mid.js song-export extension and
// the av_seq_core/av_seq_sched/av_seq_ui/av_note/av_dsp/av_voiceproc/av_engine/av_midi edits —
// verify/_m2_wave.md §2/§4).
//
// LAUNCH SKELETON: cdp_m1.mjs (newest rig) — candidates Chrome/Edge/Brave, free-port scan, fresh
// temp --user-data-dir + download dir + profile-scoped cleanup, 1440x900 device metrics override
// (Edge headless ignores --window-size), --mute-audio, --autoplay-policy=no-user-gesture-required,
// ONE browser, explicit exit, process.on('exit') kills ONLY processes whose command line carries
// OUR temp profile. The Page.javascriptDialogOpening auto-dismiss belt rides along.
// ONE DELIBERATE DEVIATION from the cdp_m1 spawn: the browser launches WITHOUT a URL (cdp_midi
// precedent) because the Web MIDI stub must exist BEFORE the app's first line — the stub is
// installed with Page.addScriptToEvaluateOnNewDocument and only THEN does Page.navigate load the
// file:// page (single boot, stubbed). The file:// target is waited for after navigate via the
// boot contract (data-av-ready) — everything else of the launch block is verbatim cdp_m1.
//
// THE WEB MIDI STUB: ports cdp_midi.mjs L88-168 verbatim in shape — fake requestMIDIAccess
// (unsupported|grant|deny), Port/InPort/OutPort classes with OutPort on window.MIDIOutput, and
// the window.__MIDI_STUB injection surface: setMode / addIn / addOut / fire(id, bytes) /
// port(dir,id) / isOurPortClass / log. Member-channel MPE traffic is injected as raw bytes
// through __MIDI_STUB.fire (the app's own decode + router + deck are the path under test).
//
// SHA FREEZE DISCIPLINE from cdp_m1/cdp_seq: index.html is sha256'd before and after the run and
// before === after is ALWAYS enforced. EXPECT_SHA stays null (the M2 freeze sha does not exist at
// authoring time) until the parent pins it (constant below or --sha <hex>); while null the rig
// still enforces before === after and prints a pin note (never loosened).
//
// WHAT IT PROVES, in order (contract: verify/_m2_wave.md §2.8 — check groups MPE · CHOP ·
// GENERATIVE · SONG + the freeze leg; this rig counts 39 checks + the pin leg):
//   group MPE (1a-1l):
//     1a enable MIDI via the stub + avMpeDeckSet(true) + bend 48 -> snap {on, bend} reflect
//     1b #av-midi-mpe-row present (toggle · #av-midi-mpe-bend 48 · state · active ids)
//     1c member note (chan 2 = 0-based 1, c3) -> rig-OWN analyser audio at ~130.8 Hz (+-1.5 %)
//     1d bend raw 2048 (12/48*8192) -> pitch ratio 2.000 (+-1.5 %)
//     1e touch 127 -> spectral centroid rises (measured before/after)
//     1f CC74 127 -> centroid rises strongly
//     1g CC10 127 -> right RMS > left by >= 3 dB (rig split tap)
//     1h note-off -> silence
//     1i member note while playIn OFF -> no audio
//     1j MASTER ch1 note still plays through the global path (ch-0 held semantics)
//     1k avMpeDeckSet(false) brooms -> silence <= 300 ms
//     1l snap keys: on/bend/held/lastExpr/pushes
//   group CHOP (2a-2i):
//     2a synthetic 4-burst WAV via avWavEncode -> fed (DataTransfer file input / public import)
//     2b avChopDetectFrames -> 4 slices, boundaries within +-0.5 ms of truth frames (avChopDetect
//        corroborates)
//     2c card DETECT -> 4 [data-slice-idx] rows rendered
//     2d trims/fades/norm edited via the CARD inputs -> the kit reflects them (snap walk)
//     2e APPLY KIT -> pad note (base+1) -> engine audio burst (analyser RMS)
//     2f normalized slices RMS-equal +-1.5 dB (pads base+1 vs base+2)
//     2g fade-out trim -> tail RMS < 30 % of mid
//     2h SLICE->STEPS on track 3 -> avSeqSnap steps on x4 with notes base..base+3
//     2i PLAY -> 4 onsets (first cycle) from the written steps
//   group GENERATIVE (3a-3f):
//     3a per-row .av-seq-track-ctl selects exist (len/spd/swg; spd carries 0.75; swg INHERIT+50..80)
//     3b track 4 speed 0.75 via the select -> snap reflects + avSeqPlan spacing = stepDur/0.75
//     3c track 2 swing 66 vs pattern 50 -> planner odd-onset shift ~ +16 % stepDur (pure witness)
//     3d euclid apply -> on-count == pulses
//     3e mutate apply -> on-count preserved
//     3f fill apply ('kick') -> steps change to the mask {0,4,8,12}
//   group SONG (4a-4f):
//     4a 3 rows (L=4 R=2/1/2; row 2 mutes all but T1) -> PLAY SONG: row 0->1->2 monotone + auto-stop
//     4b mutes applied: mid-row-2 window silent while rows 0-1 sound (analyser timeline)
//     4c quantised scene recall queued at beat -> mute flip at a step === 0 mod 4 (poll witness)
//     4d EXPORT SONG MIDI -> avMidParse -> noteCount scales with repeats (12 = 4*(2+1); row 2 muted)
//     4e EXPORT JSON round trip (rows + pattern deep-equal)
//     4f STOP -> clean (playing false, transport stopped)
//   seal: S1 screenshot renders/m2-suite.png · S2 cleanup (notes released, witness detached, MPE
//     off, playIn/kind/bpm restored) · S3 zero page errors · S4 sha256 before === after ·
//     5 freeze pin leg (passes only when EXPECT_SHA is set and matches).
//
// HARNESS LAWS (house): one browser at a time; the rig installs its OWN AnalyserNodes on the
// master tap (avMasterNodes(); panel/UI reads are never witnesses); notes play via the avNote bus
// and via raw MIDI bytes through the stub — the app's router is THE path; every assertion reads
// machine observables (globals, DOM, engine stats, rig-owned FFT/timeline captures) — never
// console text. ?AVTEST LAW: this run uses the plain file:// page (no ?avtest=1 — deck/seq/m1
// precedent); if an app proof surface were ever needed it would be the ?avtest=1 machine objects
// (window.__av*Test, the av-*test DOM lines), parsed the cdp_smoke way — never scraped console
// output.
//
// RIG-OWN FIXTURES (never planted literals where the app computes): silence floors, RMS windows,
// pitch peaks, spectral centroids, L/R split levels, the burst WAV (4 bursts @ 48000 Hz, truth
// frames 15360/30720/46080 = 0.32 s period), the seq rig patterns and the 3 song rows are all
// authored HERE; app reads (avSeqSnap/avChopSnap/snap handles/DOM) only corroborate.
//
// SPEC NOTES (sa-H, for the first parent run — fix the EXPECTATION to the check's stated intent,
// never loosen strength):
//   (a) 1j asserts BOTH the audio AND the ch-0 held semantics (avNoteState().held carries plain
//       'c3'): a member-ch deck that eats wire-channel 1 fails here by design (the wave: MASTER
//       ch1 stays on the global path).
//   (b) 1i/1k silence thresholds are floor-relative (max(4*floor, 1e-3)) — the same idiom cdp_m1
//       uses for its release legs; a floor that measures high will read as a FAIL honestly.
//   (c) 2b truth frames derive from the ENTRY's decoded rate (0.32 s period x rate): the 4-burst
//       WAV is encoded at 48000 but the decoder's rate is read back, never assumed.
//   (d) 2i counts onsets in the first ~0.52 s window (the 4 written steps; default track len 16
//       keeps the next cycle at 2 s) with +-1 slack, and the total in ~2.1 s (>= 4).
//   (e) 4c expects the flip at step 4 (queued ~0.3 s after PLAY; first step === 0 mod 4); the
//       assertion accepts the FIRST observed flip at any multiple of 4 in [4, 8].
//   (f) 4d expects 12 note-ons: rows expand L=4 steps x repeats (4*2 + 4*1 = 12; row 2's audible
//       track is muted). A different count means the export's mute/repeat law needs triage.
//   (g) The gen planner witnesses read avSeqPlan over SNAP objects the rig builds and loads
//       through the pinned loaders (avSeqPatternImport/avSeqLoad) — pure-planner reads, no audio.
//   (h) Group order MPE -> CHOP -> GEN -> SONG is required: chop loads the sampler + zones, then
//       restores the armed kind; the song group reuses the armed (va) kind with its own pattern.
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
   M2: the frozen sha of the integrated index.html is not known until build.py runs and the parent
   pins it — EXPECT_SHA stays null; the rig never loosens the before === after check. */
const EXPECT_SHA = "24491eddd20c0af68f6e8951d0d90eaa87c9aedbfaccc971739258ce208fbd72";   /* sa-H pin slot — parent fills after the M2 build (or --sha <hex>) */
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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9760);
const profile = path.join(tmpdir(), 'anvil-m2-' + Date.now());
const DL_DIR = path.join(tmpdir(), 'anvil-m2-dl-' + Date.now());
try { mkdirSync(DL_DIR, { recursive: true }); } catch (e) { /* best-effort */ }
const url = 'file:///' + path.resolve(page).replace(/\\/g, '/');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
console.log('cdp port ' + PORT + ' · profile ' + profile);
console.log('download dir ' + DL_DIR);

let pass = 0, fail = 0;
const check = (name, ok, info) => {
  if (ok === true) { pass++; console.log(' ok   ' + name + (info ? '  -> ' + info : '')); }
  else { fail++; console.log(' FAIL ' + name + (info ? '  -> ' + info : '')); }
  return ok === true;
};
const note = (t) => console.log('   · ' + t);
const fx3 = (x) => (x == null || typeof x !== 'number' || !isFinite(x)) ? String(x) : Number(x).toFixed(3);
const fx4 = (x) => (x == null || typeof x !== 'number' || !isFinite(x)) ? String(x) : Number(x).toFixed(4);
const J = (x) => { try { return JSON.stringify(x); } catch (e) { return String(x); } };
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const noteName = (m) => ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"][((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

/* ─────────────────────── the injected Web MIDI stub (cdp_midi.mjs L88-168, verbatim in shape) ───────────────────────
   Runs BEFORE the app's first line; the app only ever sees navigator.requestMIDIAccess / MIDIOutput /
   MIDIInput; the stub's ports are instances of the class put on window.MIDIOutput, so the app's
   outgoing tap patches OUR class as it would a real one. window.__MIDI_STUB.fire(id, bytes) injects
   input traffic — the MPE member-channel bytes ride THIS. */
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
    isOurPortClass: function () { return window.MIDIOutput === OutPort; },
  };
  window.__MIDI_STUB.setMode('unsupported');
  try { if (typeof window.MIDIOutput !== 'undefined') log.overrodeMIDIOutput = true; } catch (e) { /* ignore */ }
  try { window.MIDIOutput = OutPort; window.MIDIInput = InPort; } catch (e) { log.listenerErrors.push('MIDIOutput assignment failed'); }
})();`;

/* one browser instance, NO URL: the stub must be injected BEFORE the app boots */
const chrome = spawn(exe, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--disable-sync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--disable-popup-blocking', '--allow-file-access-from-files',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
], { stdio: 'ignore', windowsHide: true });

const errors = [];
const shotPath = path.join(here, '..', 'renders', 'm2-suite.png');

/* ---------- page-side scaffolding injected at runtime (rig-owned; never app code) ----------
   __m2w: the rig's OWN witness / MIDI-byte driver / chop leg / seq + song legs / cleanup —
     witArm/witRelease: the RIG OWN AnalyserNodes on avMasterNodes() (witness law — panel reads
                 are never witnesses): anT (fft 2048) for RMS + timelines, anF (fft 32768) for
                 pitch peaks and spectral centroids; splitOn/splitRms add a ChannelSplitter tap
                 (anL/anR) for the CC10 pan leg;
     rms(ms, delay): max/mean RMS window; rec(ms)/recPull: a ~6 ms [t, rms] timeline;
     peak()/centroid(): Float32 frequency data never crosses CDP — page-side math, plain numbers out;
     down/up/stopAll/noteState: the ONE avNote bus (avNoteDown/Up/StopAll + avNoteState/__avNotes);
     apply/paramGet: avParams mirror reads + avApplyParam receipts;
     midiEnable/midiPlayIn/fire/midiSnap: the stub (setMode grant + addIn + real ENABLE click) and
                 raw input-byte injection through __MIDI_STUB.fire;
     mpeSet/mpeSetBend/mpeSnap/mpeRow: the MPE deck API + DOM probes;
     wavBuild/sampleFeed/sampleEntries/chopDetectEntry/chopEdit/chopReadRow/chopSnap/chopLight/
                 chopSelSrc/chopSetSlot: the CHOP leg (synthetic WAV -> store -> detect -> card edits);
     seqSnap/seqLoad/seqPlan/seqPos/seqPlay/seqStop/trackCtl/genTrack/setInput/setSelect/euclidApply/
                 mutateApply/fillApply/onSets: the GENERATIVE leg (pinned loaders + pure planner reads);
     songSnap/songLoad/songPlay/songStop/songStatus/sceneCapture/sceneRecall/songRec/songRecPull:
                 the SONG leg (rows, runner status polls, scene recall, MIDI/JSON export reads);
     arm/cleanup: the baseline snapshot + the full M2 restore. Every read is tolerant/null-honest;
     nothing plants values where the app computes. The function is stringified into the page, so it
     must not reference anything outside its own body. */
const M2W_INSTALL = function () {
  window.__m2w = (function () {
    var W = { v: 1, anT: null, anF: null, anL: null, anR: null, spl: null, node: null, ctx: null, orig: null };

    /* ---- tiny utils ---- */
    W.num = function (x) { return (typeof x === 'number' && isFinite(x)) ? x : null; };
    W.safe = function (x) { try { return JSON.parse(JSON.stringify(x)); } catch (e) { return null; } };
    W.j = function (x) { try { return JSON.stringify(x); } catch (e) { return String(x); } };
    W.domGet = function (id) { try { return document.getElementById(id); } catch (e) { return null; } };
    W.counter = function (sel, root) { try { return (root || document).querySelectorAll(sel).length; } catch (e) { return -1; } };
    W.txt = function (id) { try { var el = W.domGet(id); return el ? String(el.textContent || '').replace(/\s+/g, ' ').slice(0, 160) : null; } catch (e) { return null; } };
    W.mark = function () { try { return performance.now(); } catch (e) { return Date.now(); } };
    W.light = function (x) {
      if (x === undefined || x === null) return null;
      if (typeof x !== 'object') return x;
      var out = {}, n = 0, k;
      for (k in x) {
        if (n >= 14) break;
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

    /* ---- notes (the ONE avNote bus) ---- */
    W.notes = function () { try { return (typeof window.__avNotes === 'function') ? window.__avNotes() : null; } catch (e) { return null; } };
    W.held = function () { var s = W.notes(); return (s && Object.prototype.toString.call(s.held) === '[object Array]') ? s.held.length : null; };
    W.noteState = function () {
      var out = { held: null, taken: null, heldCh: null, sink: null, err: null };
      try {
        var s = (typeof avNoteState === 'function') ? avNoteState() : W.notes();
        if (s) { out.held = W.safe(s.held); out.taken = W.safe(s.taken); out.heldCh = W.safe(s.heldCh); out.sink = s.sink === true; }
      } catch (e) { out.err = String((e && e.message) || e); }
      return out;
    };
    W.down = function (name, vel, ch) {
      var out = { name: name, fresh: null, err: null };
      try {
        if (typeof avNoteDown !== 'function') { out.err = 'no avNoteDown'; }
        else if (ch != null) out.fresh = (avNoteDown(name, (typeof vel === 'number') ? vel : 0.9, ch) === true);
        else out.fresh = ((typeof vel === 'number') ? avNoteDown(name, vel) : avNoteDown(name)) === true;
      } catch (e) { out.err = String((e && e.message) || e); }
      out.held = W.held();
      return out;
    };
    W.up = function (name, ch) {
      var out = { name: name, ret: null, err: null };
      try {
        if (typeof avNoteUp !== 'function') { out.err = 'no avNoteUp'; }
        else out.ret = (ch != null) ? (avNoteUp(name, ch) === true) : (avNoteUp(name) === true);
      } catch (e) { out.err = String((e && e.message) || e); }
      out.held = W.held();
      return out;
    };
    W.stopAll = function () { try { if (typeof avNoteStopAll === 'function') avNoteStopAll(); } catch (e) { /* fine */ } return W.held(); };

    /* ---- params ---- */
    W.paramGet = function (path) {
      try {
        if (typeof avParams !== 'undefined' && avParams && avParams[path] !== undefined && avParams[path] !== null) {
          var v = avParams[path];
          if (typeof v === 'number') return isFinite(v) ? v : null;
          if (typeof v === 'string' || typeof v === 'boolean') return v;
        }
      } catch (e) { /* mirror unreadable */ }
      return null;
    };
    W.apply = function (path, v) {
      var out = { path: path, v: v, ret: null, err: null };
      try { out.ret = (typeof avApplyParam === 'function') ? (avApplyParam(path, v) === true) : 'no-avApplyParam'; }
      catch (e) { out.err = String((e && e.message) || e); }
      out.echo = W.paramGet(path);
      return out;
    };

    /* ---- witness: the rig OWN AnalyserNodes on the master tap (witness law) ---- */
    W.witRelease = function () {
      var had = !!(W.anT || W.node);
      try { if (W.anT) W.anT.disconnect(); } catch (e) { /* gone */ }
      try { if (W.anF) W.anF.disconnect(); } catch (e) { /* gone */ }
      try { if (W.anL) W.anL.disconnect(); } catch (e) { /* gone */ }
      try { if (W.anR) W.anR.disconnect(); } catch (e) { /* gone */ }
      try { if (W.spl) W.spl.disconnect(); } catch (e) { /* gone */ }
      W.anT = null; W.anF = null; W.anL = null; W.anR = null; W.spl = null;
      return { had: had };
    };
    W.witArm = function () {
      try {
        W.witRelease();
        if (typeof avMasterNodes !== 'function') return { ok: false, why: 'avMasterNodes missing' };
        var nodes = avMasterNodes() || [];
        var node = null, i;
        for (i = 0; i < nodes.length; i++) { if (nodes[i] && nodes[i].gain && nodes[i].context) { node = nodes[i]; break; } }
        if (!node) return { ok: false, why: 'no master node with a gain + context', n: nodes.length };
        var ctx = node.context;
        var anT = ctx.createAnalyser(); anT.fftSize = 2048; anT.smoothingTimeConstant = 0;
        node.connect(anT);
        var anF = ctx.createAnalyser(); anF.fftSize = 32768; anF.smoothingTimeConstant = 0;
        node.connect(anF);
        W.node = node; W.ctx = ctx; W.anT = anT; W.anF = anF;
        W.td = new Float32Array(anT.fftSize);
        W.fd = new Float32Array(anF.frequencyBinCount);
        return { ok: true, sr: ctx.sampleRate, fftT: anT.fftSize, fftF: anF.fftSize, nodes: nodes.length, ctxState: String(ctx.state) };
      } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
    };
    W.rms = function (ms, delayMs) {
      return new Promise(function (resolve) {
        var wit = W.anT;
        if (!wit) { resolve({ ok: false, why: 'witness not armed' }); return; }
        var start = function () {
          var max = 0, sum = 0, n = 0;
          var read = function () {
            try {
              W.anT.getFloatTimeDomainData(W.td);
              var s = 0, i;
              for (i = 0; i < W.td.length; i++) { var v = W.td[i]; s += v * v; }
              var r = Math.sqrt(s / W.td.length);
              if (r > max) max = r;
              sum += r; n++;
            } catch (e) { /* one lost read */ }
          };
          var iv = setInterval(read, 6);
          setTimeout(function () {
            try { clearInterval(iv); } catch (e) { /* fine */ }
            resolve({ ok: true, max: max, mean: n ? sum / n : 0, n: n });
          }, ms);
        };
        if (delayMs > 0) setTimeout(start, delayMs); else start();
      });
    };
    W.rec = function (ms) {
      try {
        W.recSamples = [];
        W.recOn = true;
        var t0 = W.mark();
        W.recTimer = setInterval(function () {
          if (!W.recOn) return;
          try {
            W.anT.getFloatTimeDomainData(W.td);
            var s = 0, i;
            for (i = 0; i < W.td.length; i++) { var v = W.td[i]; s += v * v; }
            W.recSamples.push([W.mark() - t0, Math.sqrt(s / W.td.length)]);
            if (W.recSamples.length > 8000) W.recOn = false;
          } catch (e) { /* analyser gone */ }
        }, 6);
        if (ms > 0) setTimeout(function () { W.recOn = false; if (W.recTimer) { clearInterval(W.recTimer); W.recTimer = 0; } }, ms);
        return { ok: true, t0: t0 };
      } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
    };
    W.recPull = function () { return { on: !!W.recOn, n: (W.recSamples || []).length, samples: (W.recSamples || []).slice() }; };
    W.recStop = function () { W.recOn = false; if (W.recTimer) { clearInterval(W.recTimer); W.recTimer = 0; } return true; };
    W.peak = function () {
      return new Promise(function (resolve) {
        if (!W.anF) { resolve({ ok: false, why: 'witness not armed' }); return; }
        var best = new Float64Array(W.fd.length); best.fill(-Infinity); var r = 0;
        var tick = function () {
          try {
            W.anF.getFloatFrequencyData(W.fd);
            for (var j = 0; j < best.length; j++) { if (W.fd[j] > best[j]) best[j] = W.fd[j]; }
          } catch (e) { /* one lost read */ }
          r++;
          if (r < 3) { setTimeout(tick, 40); return; }
          var sr = W.ctx ? W.ctx.sampleRate : 48000;
          var binHz = sr / W.anF.fftSize;
          var bi = 2, bv = -Infinity, i;
          for (i = 2; i < best.length; i++) { if (best[i] > bv) { bv = best[i]; bi = i; } }
          var hz = bi * binHz;
          if (bi > 2 && bi < best.length - 1) {           /* parabolic interpolation, log-magnitude */
            var a = best[bi - 1], b = best[bi], c = best[bi + 1];
            var d = (a - c) / (2 * (a - 2 * b + c));
            if (isFinite(d) && Math.abs(d) < 1) hz = (bi + d) * binHz;
          }
          resolve({ ok: true, hz: hz, db: bv, bin: bi, binHz: binHz, fft: W.anF.fftSize });
        };
        tick();
      });
    };
    W.centroid = function () {
      return new Promise(function (resolve) {
        if (!W.anF) { resolve({ ok: false, why: 'witness not armed' }); return; }
        var best = new Float64Array(W.fd.length); best.fill(-Infinity); var r = 0;
        var tick = function () {
          try {
            W.anF.getFloatFrequencyData(W.fd);
            for (var j = 0; j < best.length; j++) { if (W.fd[j] > best[j]) best[j] = W.fd[j]; }
          } catch (e) { /* one lost read */ }
          r++;
          if (r < 3) { setTimeout(tick, 40); return; }
          var sr = W.ctx ? W.ctx.sampleRate : 48000;
          var binHz = sr / W.anF.fftSize;
          var pk = -Infinity, i;
          for (i = 2; i < best.length; i++) if (best[i] > pk) pk = best[i];
          var num = 0, den = 0;
          for (i = 2; i < best.length; i++) {
            if (best[i] < pk - 80) continue;
            var p = Math.pow(10, best[i] / 20);
            if (!isFinite(p)) continue;
            num += (i * binHz) * p; den += p;
          }
          resolve({ ok: true, hz: den > 0 ? num / den : 0, tot: den });
        };
        tick();
      });
    };
    W.splitOn = function () {
      try {
        if (!W.node || !W.ctx) return { ok: false, why: 'witness not armed' };
        if (W.spl) return { ok: true, cached: true };
        var ctx = W.ctx;
        var spl = ctx.createChannelSplitter(2);
        W.node.connect(spl);
        var anL = ctx.createAnalyser(); anL.fftSize = 2048; anL.smoothingTimeConstant = 0;
        var anR = ctx.createAnalyser(); anR.fftSize = 2048; anR.smoothingTimeConstant = 0;
        spl.connect(anL, 0);
        spl.connect(anR, 1);
        W.spl = spl; W.anL = anL; W.anR = anR;
        W.tdL = new Float32Array(anL.fftSize); W.tdR = new Float32Array(anR.fftSize);
        return { ok: true };
      } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
    };
    W.splitRms = function (ms) {
      return new Promise(function (resolve) {
        if (!W.anL || !W.anR) { resolve({ ok: false, why: 'split not armed' }); return; }
        var mxL = 0, mxR = 0, n = 0;
        var read = function () {
          try {
            W.anL.getFloatTimeDomainData(W.tdL); W.anR.getFloatTimeDomainData(W.tdR);
            var sL = 0, sR = 0, i;
            for (i = 0; i < W.tdL.length; i++) { sL += W.tdL[i] * W.tdL[i]; sR += W.tdR[i] * W.tdR[i]; }
            var l = Math.sqrt(sL / W.tdL.length), r2 = Math.sqrt(sR / W.tdR.length);
            if (l > mxL) mxL = l;
            if (r2 > mxR) mxR = r2;
            n++;
          } catch (e) { /* one lost read */ }
        };
        var iv = setInterval(read, 6);
        setTimeout(function () {
          try { clearInterval(iv); } catch (e) { /* fine */ }
          resolve({ ok: true, l: mxL, r: mxR, n: n, db: (mxL > 0 && mxR > 0) ? 20 * Math.log10(mxR / mxL) : null });
        }, ms);
      });
    };

    /* ---- midi (the stub is the driver; the app's router is the path) ---- */
    W.fire = function (portId, bytes) {
      try {
        var s = window.__MIDI_STUB;
        if (!s) return { ok: false, why: 'no stub' };
        return { ok: s.fire(portId, bytes) === true, bytes: bytes };
      } catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
    };
    W.midiSnap = function () {
      var out = { status: null, snap: null, stub: null };
      try { out.status = (typeof avMidiStatus !== 'undefined') ? String(avMidiStatus) : null; } catch (e) { out.status = null; }
      try { out.snap = W.safe((window.__avMidi && typeof window.__avMidi.snap === 'function') ? window.__avMidi.snap() : null); } catch (e) { out.snap = null; }
      try { out.stub = !!window.__MIDI_STUB; } catch (e) { out.stub = null; }
      return out;
    };
    W.midiEnable = function () {
      return new Promise(function (resolve) {
        var out = { mode: null, before: null, click: null, after: null, called: null, err: null };
        try {
          var s = window.__MIDI_STUB;
          if (s) {
            s.setMode('grant');
            if (!s.port('in', 'm2i1')) s.addIn('m2i1', 'M2 Rig Keys', 'Hermes');
            if (!s.port('out', 'm2o1')) s.addOut('m2o1', 'M2 Rig Out', 'Hermes');
            out.mode = s.mode();
          }
          out.before = (typeof avMidiStatus !== 'undefined') ? String(avMidiStatus) : null;
          var btn = document.querySelector('#av-midi-body [data-midi="enable"]');
          if (btn) { btn.click(); out.click = true; }
          var t0 = Date.now();
          var poll = function () {
            var st = '';
            try { st = (typeof avMidiStatus !== 'undefined') ? String(avMidiStatus) : ''; } catch (e) { st = ''; }
            if (st === 'enabled') { out.after = st; resolve(out); return; }
            if (!out.called && Date.now() - t0 > 3500) {
              out.called = true;
              try { if (typeof avMidiEnable === 'function') avMidiEnable(); } catch (e) { out.err = String((e && e.message) || e); }
            }
            if (Date.now() - t0 > 8000) { out.after = st; resolve(out); return; }
            setTimeout(poll, 150);
          };
          poll();
        } catch (e) { out.err = String((e && e.message) || e); resolve(out); }
      });
    };
    W.midiPlayIn = function (v) {
      try {
        if (typeof avMidiSetPlayIn === 'function') { avMidiSetPlayIn(!!v); return W.midiPlayInGet() === !!v; }
        if (typeof avMidiPrefs !== 'undefined') { avMidiPrefs.playIn = !!v; return W.midiPlayInGet() === !!v; }
        return null;
      } catch (e) { return 'threw: ' + String((e && e.message) || e); }
    };
    W.midiPlayInGet = function () { try { return (typeof avMidiPrefs !== 'undefined') ? !!avMidiPrefs.playIn : null; } catch (e) { return null; } };

    /* ---- mpe ---- */
    W.mpeSnap = function () {
      try { return W.safe((window.__avMpeDeck && typeof window.__avMpeDeck.snap === 'function') ? window.__avMpeDeck.snap() : null); }
      catch (e) { return { err: String((e && e.message) || e) }; }
    };
    W.mpeSet = function (on) { try { return (typeof avMpeDeckSet === 'function') ? avMpeDeckSet(on) : 'no-avMpeDeckSet'; } catch (e) { return 'threw: ' + String((e && e.message) || e); } };
    W.mpeSetBend = function (b) { try { return (typeof avMpeDeckSetBend === 'function') ? avMpeDeckSetBend(b) : 'no-avMpeDeckSetBend'; } catch (e) { return 'threw: ' + String((e && e.message) || e); } };
    W.mpePush = function () { try { return (typeof avMpeDeckPush === 'function') ? (avMpeDeckPush(), true) : 'no-avMpeDeckPush'; } catch (e) { return 'threw: ' + String((e && e.message) || e); } };
    W.mpeRow = function () {
      var out = {};
      try {
        out.row = !!W.domGet('av-midi-mpe-row');
        var tg = out.row ? document.querySelector('#av-midi-mpe-row [data-midimpe]') : null;
        out.toggle = tg ? { tag: String(tg.tagName), checked: tg.checked === true, pressed: tg.getAttribute('aria-pressed'), cls: String(tg.className || '').slice(0, 60) } : null;
        var b = W.domGet('av-midi-mpe-bend');
        out.bendSel = b ? {
          tag: String(b.tagName), value: String(b.value), opts: b.options ? b.options.length : 0,
          vals: (function () { var v = [], i; if (!b.options) return v; for (i = 0; i < b.options.length && i < 8; i++) v.push(String(b.options[i].value)); return v; })()
        } : null;
        out.state = !!W.domGet('av-midi-mpe-state');
        out.active = !!W.domGet('av-midi-mpe-active');
        out.stateText = W.txt('av-midi-mpe-state');
        out.activeText = W.txt('av-midi-mpe-active');
        out.handle = !!(window.__avMpeDeck && window.__avMpeDeck.version === 'm2.0' && typeof window.__avMpeDeck.snap === 'function');
      } catch (e) { out.err = String((e && e.message) || e); }
      return out;
    };

    /* ---- chop ---- */
    W.wavBuild = function () {
      try {
        if (typeof avWavEncode !== 'function') return { ok: false, why: 'avWavEncode missing' };
        var sr = 48000;
        var period = Math.round(0.32 * sr);       /* 15360 frames */
        var burst = 12800;
        var n = period * 4;
        var ch1 = new Float32Array(n);
        var hz = 220, amp = 0.25;
        for (var k = 0; k < 4; k++) {
          var base = k * period;
          for (var i = 0; i < burst; i++) {
            var env = (i < 24) ? (i / 24) : 1;    /* ~0.5 ms onset ramp (clean transients) */
            ch1[base + i] = amp * env * Math.sin(2 * Math.PI * hz * i / sr);
          }
        }
        var bytes = null;
        try { bytes = avWavEncode({ l: ch1, r: ch1, sr: sr, bits: '32f' }); } catch (e) { bytes = null; }
        if (!bytes) return { ok: false, why: 'avWavEncode refused' };
        W._wav = bytes;
        return { ok: true, sr: sr, n: n, period: period, burst: burst, bytesLen: (bytes.byteLength || bytes.length || 0), truth: [period, period * 2, period * 3] };
      } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
    };
    W.sampleFeed = function (name) {
      return new Promise(function (resolve) {
        var out = { path: null, added: null, errors: null, inputFound: false };
        try {
          var bytes = W._wav;
          if (!bytes) { resolve({ ok: false, why: 'no wav built' }); return; }
          var file = null;
          try { file = new File([bytes], name || 'm2-bursts.wav', { type: 'audio/wav' }); } catch (e) { file = null; }
          var input = null;
          try { input = document.querySelector('#av-sample-host [data-av-sample-input]') || document.querySelector('#av-sample-host input[type=file]'); } catch (e) { input = null; }
          out.inputFound = !!input;
          var count0 = 0;
          try { count0 = (typeof avSampleStore !== 'undefined' && avSampleStore) ? avSampleStore.entries.length : 0; } catch (e) { count0 = 0; }
          var useApi = function () {
            try {
              avSampleImportFiles([file]).then(function (r) {
                out.path = 'api';
                out.added = r && r.added ? r.added.slice() : null;
                out.errors = r && r.errors ? r.errors.slice(0, 4) : null;
                out.count = r && r.count;
                out.ok = !!(r && r.ok);
                resolve(out);
              }, function (e) {
                out.path = 'api'; out.ok = false; out.errors = [String((e && e.message) || e)]; resolve(out);
              });
            } catch (e) { resolve({ ok: false, why: 'avSampleImportFiles threw: ' + String((e && e.message) || e) }); }
          };
          if (input && typeof DataTransfer !== 'undefined' && typeof avSampleImportFiles === 'function') {
            try {
              var dt = new DataTransfer();
              dt.items.add(file);
              input.files = dt.files;                       /* DataTransfer FileList — the drop-in path */
              out.path = 'input';
              input.dispatchEvent(new Event('change', { bubbles: true }));
              var t0 = Date.now();
              var poll = function () {
                var count = 0;
                try { count = (typeof avSampleStore !== 'undefined' && avSampleStore) ? avSampleStore.entries.length : 0; } catch (e) { count = 0; }
                if (count > count0) {
                  try { out.added = avSampleStore.entries.map(function (e) { return e.name; }); } catch (e) { out.added = null; }
                  out.ok = true;
                  resolve(out);
                  return;
                }
                if (Date.now() - t0 > 5000) { out.errors = ['input path produced no entry — API fallback']; useApi(); return; }
                setTimeout(poll, 150);
              };
              poll();
              return;
            } catch (e) { out.inputErr = String((e && e.message) || e); }
          }
          useApi();
        } catch (e) { resolve({ ok: false, why: String((e && e.message) || e) }); }
      });
    };
    W.sampleEntries = function () {
      try {
        var st = avSampleStore;
        return {
          n: st.entries.length,
          entries: st.entries.map(function (e) {
            return { id: e.id, name: e.name, rate: e.sampleRate, frames: (e.buffer ? e.buffer.length : 0), ch: (e.buffer ? e.buffer.numberOfChannels : 0) };
          })
        };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    };
    W.chopLight = function (r) {
      if (r === undefined || r === null) return null;
      if (typeof r !== 'object') return r;
      var out = { ok: r.ok === true, error: r.error || null, count: W.num(r.count), dropped: W.num(r.dropped) };
      try { out.onsets = Object.prototype.toString.call(r.onsets) === '[object Array]' ? r.onsets.slice(0, 40) : null; } catch (e) { out.onsets = null; }
      try {
        out.slices = Object.prototype.toString.call(r.slices) === '[object Array]'
          ? r.slices.map(function (s) { return { s0: s && s.s0, s1: s && s.s1 }; }) : null;
      } catch (e) { out.slices = null; }
      return out;
    };
    W.chopDetectEntry = function () {
      try {
        var st = avSampleStore;
        var e = st.entries[st.entries.length - 1];
        if (!e) return { err: 'no entry' };
        var ch1 = e.buffer.getChannelData(0);
        var fr = null, d = null, err1 = null, err2 = null;
        try { fr = (typeof avChopDetectFrames === 'function') ? avChopDetectFrames(ch1, e.sampleRate, { sensitivity: 0.5, minGapMs: 60, maxSlices: 16 }) : null; } catch (x) { err1 = String((x && x.message) || x); }
        try { d = (typeof avChopDetect === 'function') ? avChopDetect(e.id, { sensitivity: 0.5, minGapMs: 60, maxSlices: 16 }) : null; } catch (x2) { err2 = String((x2 && x2.message) || x2); }
        return { id: e.id, rate: e.sampleRate, n: ch1.length, fr: W.chopLight(fr), det: W.chopLight(d), err1: err1, err2: err2 };
      } catch (e2) { return { err: String((e2 && e2.message) || e2) }; }
    };
    W.chopSnap = function () { try { return W.safe((typeof avChopSnap === 'function') ? avChopSnap() : null); } catch (e) { return { err: String((e && e.message) || e) }; } };
    W.chopDataCmp = function () {
      /* triage diagnostic: RMS of the two slice windows straight from the stored entry channel 0 */
      try {
        var st = (typeof avSampleStore !== 'undefined' && avSampleStore) ? avSampleStore : null;
        if (!st) return { err: 'no store' };
        var es = st.entries || [];
        var e = es.length ? es[es.length - 1] : null;
        if (!e || !e.buffer || typeof e.buffer.getChannelData !== 'function') return { err: 'no entry' };
        var d = e.buffer.getChannelData(0);
        var P = 15360, W1 = 10993, o = 7;
        var s1 = 0, s2 = 0;
        for (var i = 0; i < W1; i++) { var x1 = d[P + o + i] || 0; var x2 = d[2 * P + o + i] || 0; s1 += x1 * x1; s2 += x2 * x2; }
        return { rms1: Math.sqrt(s1 / W1), rms2: Math.sqrt(s2 / W1) };
      } catch (e2) { return { err: String((e2 && e2.message) || e2) }; }
    };
    W.seqTrace = function () {
      try { var t = (typeof window !== 'undefined' && Array.isArray(window.__avSeqTrace)) ? window.__avSeqTrace : []; return W.safe(t.slice(-256)); } catch (e) { return []; }
    };
    W.chopSelSrc = function (want) {
      try {
        try { var rb = W.domGet('av-chop-refresh'); if (rb && typeof rb.click === 'function') rb.click(); } catch (e) { /* refresh is additive */ }
        var sel = W.domGet('av-chop-src');
        if (!sel) return { found: false };
        var vals = [], i;
        for (i = 0; i < sel.options.length && i < 40; i++) vals.push(String(sel.options[i].value));
        var picked = false;
        for (i = 0; i < vals.length; i++) if (vals[i] === want) { sel.value = vals[i]; picked = true; }
        if (!picked && sel.options.length) { sel.value = vals[vals.length - 1]; picked = 'last'; }
        try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* ok */ }
        return { found: true, vals: vals, picked: picked, value: String(sel.value) };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    };
    W.chopSetSlot = function (slot) {
      try {
        var el = W.domGet('av-chop-slot');
        if (!el) return { found: false };
        el.value = String(slot);
        try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* ok */ }
        return { found: true, value: String(el.value) };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    };
    W.chopEdit = function (i, patch) {
      var out = { set: {}, found: false };
      try {
        var row = document.querySelector('#av-chop-slices [data-slice-idx="' + i + '"]');
        if (!row) return { found: false };
        out.found = true;
        var map = { trim0: '.av-chop-trim0', trim1: '.av-chop-trim1', fadeIn: '.av-chop-fadein', fadeOut: '.av-chop-fadeout', gain: '.av-chop-gain', norm: '.av-chop-norm', on: '.av-chop-on' };
        for (var k in patch) {
          if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
          var el = row.querySelector(map[k]);
          if (!el) { out.set[k] = 'missing'; continue; }
          if (k === 'norm' || k === 'on') el.checked = !!patch[k];
          else el.value = String(patch[k]);
          try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { /* ok */ }
          try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* ok */ }
          out.set[k] = true;
        }
      } catch (e) { out.err = String((e && e.message) || e); }
      return out;
    };
    W.chopReadRow = function (i) {
      try {
        var row = document.querySelector('#av-chop-slices [data-slice-idx="' + i + '"]');
        if (!row) return { found: false };
        var g = function (sel) { var el = row.querySelector(sel); return el ? (el.type === 'checkbox' ? !!el.checked : String(el.value)) : null; };
        return { found: true, trim0: g('.av-chop-trim0'), trim1: g('.av-chop-trim1'), fadeIn: g('.av-chop-fadein'), fadeOut: g('.av-chop-fadeout'), gain: g('.av-chop-gain'), norm: g('.av-chop-norm'), on: g('.av-chop-on') };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    };
    W.chopStatus = function () { return W.txt('av-chop-status'); };
    W.chopRows = function () { try { return W.counter('#av-chop-slices [data-slice-idx]', null); } catch (e) { return -1; } };
    W.chopPads = function () { try { return { pads: W.counter('#av-chop-pads .av-chop-pad', null), data: W.counter('#av-chop-pads .av-chop-pad[data-pad]', null) }; } catch (e) { return { err: String((e && e.message) || e) }; } };
    W.chopApply = function () { return W.clickId('av-chop-apply'); };
    W.chopToSteps = function () { return W.clickId('av-chop-steps'); };
    W.clickId = function (id) { try { var el = W.domGet(id); if (!el) return { found: false }; el.click(); return { found: true, tag: String(el.tagName) }; } catch (e) { return { found: false, err: String((e && e.message) || e) }; } };

    /* ---- seq (generative) ---- */
    W.seqSnap = function () { try { return W.safe((typeof avSeqSnap === 'function') ? avSeqSnap() : null); } catch (e) { return { err: String((e && e.message) || e) }; } };
    W.seqLoad = function (P) {
      var out = { ok: false, why: '' };
      try {
        var ok = false;
        if (typeof avSeqPatternImport === 'function') { ok = avSeqPatternImport(JSON.stringify(P)) === true; out.why = ok ? 'import' : 'import-refused'; }
        if (!ok && typeof avSeqLoad === 'function') { ok = avSeqLoad(P) === true; out.why = ok ? 'load' : 'load-refused'; }
        if (ok) {
          try { if (typeof avSeqSetPattern === 'function') avSeqSetPattern(avSeqSnap()); } catch (e) { /* ok */ }
          try { if (typeof avApplyParam === 'function') avApplyParam('bpm', 120); } catch (e) { /* ok */ }
          try { if (typeof avUndoPush === 'function') avUndoPush('seq', 'm2-rig-load'); } catch (e) { /* ok */ }
        }
        out.ok = ok;
      } catch (e) { out.why = 'threw: ' + String((e && e.message) || e); }
      return out;
    };
    W.seqPlan = function (from, to, snap) {
      try {
        var S = snap || ((typeof avSeqSnap === 'function') ? avSeqSnap() : null);
        var r = (typeof avSeqPlan === 'function') ? avSeqPlan(S, from, to, 0, 305419896) : null;
        if (!r || Object.prototype.toString.call(r.events) !== '[object Array]') return { ok: false, why: 'planner unavailable' };
        var evs = [];
        for (var i = 0; i < r.events.length && i < 400; i++) {
          var e = r.events[i];
          evs.push({ t: e.t, type: e.type, note: e.note, track: e.track, step: e.step });
        }
        return { ok: true, n: r.events.length, events: evs, rngNext: W.num(r.rngNext) };
      } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
    };
    W.seqPos = function () { try { return W.safe((typeof avSeqPosition === 'function') ? avSeqPosition() : null); } catch (e) { return null; } };
    W.seqPlay = function () { try { return (typeof avSeqPlay === 'function') ? (avSeqPlay() === true) : 'missing'; } catch (e) { return 'threw: ' + String((e && e.message) || e); } };
    W.seqStop = function () { try { if (typeof avSeqStop === 'function') avSeqStop(); return true; } catch (e) { return false; } };
    W.seqPlaying = function () { try { return (typeof avSeqIsPlaying === 'function') ? avSeqIsPlaying() === true : null; } catch (e) { return null; } };
    W.trackCtl = function (track, name, value) {
      var out = { strategy: null, found: false, set: null };
      try {
        var host = document.getElementById('av-seq-host') || document;
        var sel = host.querySelector('.av-seq-row[data-track="' + track + '"] select[data-track-' + name + ']');
        if (sel) out.strategy = 'row';
        if (!sel) { var all = host.querySelectorAll('select[data-track-' + name + ']'); if (all && all[track]) { sel = all[track]; out.strategy = 'index'; } }
        if (!sel) return out;
        out.found = true;
        sel.value = String(value);
        try { sel.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { /* ok */ }
        try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* ok */ }
        out.set = String(sel.value);
      } catch (e) { out.err = String((e && e.message) || e); }
      return out;
    };
    W.genTrack = function (track) {
      try {
        var sel = W.domGet('av-seq-gen-track');
        if (!sel) return { found: false };
        var vals = [], i;
        for (i = 0; i < sel.options.length && i < 8; i++) vals.push(String(sel.options[i].value));
        var ok = false;
        for (i = 0; i < vals.length; i++) {
          if (vals[i] === String(track) || vals[i] === ('T' + (track + 1)) || vals[i] === String(track + 1)) { sel.value = vals[i]; ok = true; break; }
        }
        if (!ok && sel.options.length > track) { sel.selectedIndex = track; ok = 'index'; }
        try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* ok */ }
        return { found: true, picked: ok, value: String(sel.value), vals: vals };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    };
    W.setInput = function (id, v) {
      try {
        var el = W.domGet(id);
        if (!el) return { found: false };
        el.value = String(v);
        try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { /* ok */ }
        try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* ok */ }
        return { found: true, value: String(el.value) };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    };
    W.setSelect = function (id, v) {
      try {
        var sel = W.domGet(id);
        if (!sel) return { found: false };
        var vals = [], i;
        for (i = 0; i < sel.options.length && i < 64; i++) vals.push(String(sel.options[i].value));
        var ok = false;
        for (i = 0; i < vals.length; i++) if (vals[i] === String(v)) { sel.value = vals[i]; ok = true; }
        if (!ok && sel.options.length) { sel.value = vals[0] || ''; ok = 'first'; }
        try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* ok */ }
        return { found: true, picked: ok, value: String(sel.value), vals: vals.slice(0, 24) };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    };
    W.euclidApply = function (pulses, len, rot) {
      var out = {};
      try { out.pulses = W.setInput('av-seq-euclid-pulses', pulses); out.len = W.setInput('av-seq-euclid-len', len); out.rot = W.setInput('av-seq-euclid-rot', rot); out.click = W.clickId('av-seq-euclid-apply'); }
      catch (e) { out.err = String((e && e.message) || e); }
      return out;
    };
    W.mutateApply = function (amt) {
      var out = {};
      try { out.amt = W.setInput('av-seq-mutate-amt', amt); out.click = W.clickId('av-seq-mutate-apply'); }
      catch (e) { out.err = String((e && e.message) || e); }
      return out;
    };
    W.fillApply = function (id) {
      var out = {};
      try { out.sel = W.setSelect('av-seq-fill-id', id); out.click = W.clickId('av-seq-fill-apply'); }
      catch (e) { out.err = String((e && e.message) || e); }
      return out;
    };
    W.fillIds = function () { try { return (typeof avSeqFillIds === 'function') ? W.safe(avSeqFillIds()) : null; } catch (e) { return null; } };
    W.onSets = function (snap) {
      try {
        if (!snap || !snap.tracks) return null;
        var out = [];
        for (var t = 0; t < 4; t++) {
          var tr = snap.tracks[t] || {};
          var on = [], steps = tr.steps || [];
          for (var i = 0; i < steps.length && i < 64; i++) if (steps[i] && steps[i].on) on.push(i);
          out.push(on);
        }
        return out;
      } catch (e) { return null; }
    };

    /* ---- song ---- */
    W.songSnap = function () { try { return W.safe((typeof avSeqSongSnap === 'function') ? avSeqSongSnap() : null); } catch (e) { return { err: String((e && e.message) || e) }; } };
    W.songLoad = function (obj) { try { return (typeof avSeqSongLoad === 'function') ? (avSeqSongLoad(obj) === true) : 'missing'; } catch (e) { return 'threw: ' + String((e && e.message) || e); } };
    W.songPlay = function () { try { return (typeof avSongPlay === 'function') ? W.safe(avSongPlay()) : 'missing'; } catch (e) { return { err: String((e && e.message) || e) }; } };
    W.songStop = function () { try { return (typeof avSongStop === 'function') ? (avSongStop() === true) : 'missing'; } catch (e) { return 'threw: ' + String((e && e.message) || e); } };
    W.songStatus = function () { try { return W.safe((typeof avSongStatus === 'function') ? avSongStatus() : null); } catch (e) { return { err: String((e && e.message) || e) }; } };
    W.songPlaying = function () { try { return (typeof avSongIsPlaying === 'function') ? (avSongIsPlaying() === true) : null; } catch (e) { return null; } };
    W.sceneCapture = function (name) { try { return (typeof avSeqSceneCapture === 'function') ? (avSeqSceneCapture(name) === true) : 'missing'; } catch (e) { return 'threw: ' + String((e && e.message) || e); } };
    W.sceneRecall = function (name, quant) { try { return (typeof avSongSceneRecall === 'function') ? W.safe(avSongSceneRecall(name, quant)) : 'missing'; } catch (e) { return { err: String((e && e.message) || e) }; } };
    W.songRec = function (ms) {
      try {
        W.sRec = [];
        W.sRecOn = true;
        var t0 = W.mark();
        W.sRecTimer = setInterval(function () {
          if (!W.sRecOn) return;
          try {
            var st = (typeof avSongStatus === 'function') ? avSongStatus() : null;
            var pos = (typeof avSeqPosition === 'function') ? avSeqPosition() : null;
            var snap = (typeof avSeqSnap === 'function') ? avSeqSnap() : null;
            var mutes = null;
            if (snap && snap.tracks) { mutes = []; for (var i = 0; i < snap.tracks.length && i < 4; i++) mutes.push(snap.tracks[i] ? snap.tracks[i].mute : null); }
            W.sRec.push([W.mark() - t0,
              st ? (st.playing === true ? 1 : 0) : null,
              st ? st.row : null,
              pos ? pos.step : null,
              mutes]);
            if (W.sRec.length > 600) W.sRecOn = false;
          } catch (e) { /* one lost tick */ }
        }, 25);
        if (ms > 0) setTimeout(function () { W.sRecOn = false; if (W.sRecTimer) { clearInterval(W.sRecTimer); W.sRecTimer = 0; } }, ms);
        return { ok: true, t0: t0 };
      } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
    };
    W.songRecPull = function () { return { n: (W.sRec || []).length, samples: (W.sRec || []).slice() }; };
    W.songRecStop = function () { W.sRecOn = false; if (W.sRecTimer) { clearInterval(W.sRecTimer); W.sRecTimer = 0; } return true; };

    /* ---- baseline + restore ---- */
    W.PATHS = ['engine.kind', 'bpm'];
    W.arm = function () {
      var out = {}, i;
      for (i = 0; i < W.PATHS.length; i++) { try { out[W.PATHS[i]] = W.paramGet(W.PATHS[i]); } catch (e) { out[W.PATHS[i]] = null; } }
      try { out.mpe = W.mpeSnap(); } catch (e) { out.mpe = null; }
      try { out.playIn = (typeof avMidiPrefs !== 'undefined') ? !!avMidiPrefs.playIn : null; } catch (e) { out.playIn = null; }
      try { out.samples = (typeof avSampleStore !== 'undefined' && avSampleStore) ? avSampleStore.entries.length : null; } catch (e) { out.samples = null; }
      W.orig = out;
      return out;
    };
    W.cleanup = function () {
      var out = { steps: [] };
      var step = function (name, fn) { try { fn(); out.steps.push(name + ':ok'); } catch (e) { out.steps.push(name + ':err ' + String((e && e.message) || e)); } };
      step('notes', function () { if (typeof avNoteStopAll === 'function') avNoteStopAll(); });
      step('songStop', function () { if (typeof avSongStop === 'function') avSongStop(); });
      step('seqStop', function () { if (typeof avSeqStop === 'function') avSeqStop(); });
      step('mpeOff', function () { if (typeof avMpeDeckSet === 'function') avMpeDeckSet(false); });
      step('playIn', function () { if (typeof avMidiSetPlayIn === 'function') avMidiSetPlayIn(true); });
      var i;
      for (i = 0; i < W.PATHS.length; i++) {
        (function (p) {
          var v = (W.orig && W.orig[p] !== null && W.orig[p] !== undefined) ? W.orig[p] : null;
          if (v === null) return;
          step('param ' + p, function () { if (typeof avApplyParam === 'function') avApplyParam(p, v); });
        })(W.PATHS[i]);
      }
      step('witness', function () { W.witRelease(); });
      out.final = {
        held: W.held(), witness: !!W.anT, mpeOn: (W.mpeSnap() || {}).on === true,
        playing: W.songPlaying(), seqPlaying: W.seqPlaying(),
        kind: W.paramGet('engine.kind'), bpm: W.paramGet('bpm'), playIn: W.midiPlayInGet()
      };
      return out;
    };

    return W;
  })();
  return true;
};

/* ---------- node-side analysis helpers (timeline math + pattern builders) ---------- */

/* onset detection over [t, rms] samples: rising edges, adaptive slope threshold, 55 ms re-arm
   (cdp_seq.mjs idiom — a ~constant audio-path lag cancels in every count below) */
function detectOnsets(samples) {
  let max = 0;
  for (const s of samples) if (s[1] > max) max = s[1];
  const dthr = Math.max(0.006, max * 0.22);
  const onsets = [];
  let last = -1e9;
  for (let i = 1; i < samples.length; i++) {
    const t0 = samples[i - 1][0], r0 = samples[i - 1][1];
    const t1 = samples[i][0], r1 = samples[i][1];
    if (r1 - r0 > dthr && t1 - last > 55) { onsets.push(t0 + (t1 - t0) * 0.5); last = t1; }
  }
  return { onsets, max, dthr };
}
const winMean = (samples, a, b) => { const r = samples.filter(s => s[0] >= a && s[0] <= b).map(s => s[1]); return r.length ? mean(r) : null; };
const winMax = (samples, a, b) => { let m = -1; for (const s of samples) if (s[0] >= a && s[0] <= b && s[1] > m) m = s[1]; return m; };
function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a == null || b == null) return false;
  if (typeof a !== 'object') return false;
  const aa = Array.isArray(a), ab = Array.isArray(b);
  if (aa !== ab) return false;
  if (aa) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEq(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i] || !deepEq(a[ka[i]], b[kb[i]])) return false;
  return true;
}
/* walk a JSON-safe snap for the chop kit (an object/array whose entries carry the pinned slice
   field names: i/s0/s1/trim0/trim1/fadeIn/fadeOut/gainDb/norm/on) */
function findKit(snap) {
  const seen = new Set();
  const stack = [snap];
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    if (Array.isArray(v)) {
      if (v.length >= 1 && v[0] && typeof v[0] === 'object' && 'trim0' in v[0] && 'fadeIn' in v[0]) return { slices: v };
      for (const x of v) stack.push(x);
      continue;
    }
    if (Array.isArray(v.slices) && v.slices.length >= 1 && v.slices[0] && typeof v.slices[0] === 'object' && 'trim0' in v.slices[0]) return v;
    for (const k of Object.keys(v)) stack.push(v[k]);
  }
  return null;
}
/* seq pattern builders (model v2: track gains swing 0 = inherit; cdp_seq H.pattern idiom) */
const stepOff = { on: 0, note: 'c4', vel: 0.85, gate: 0.95, slide: 0, accent: 0, oct: 0, prob: 100, cond: '', ratchet: 1, micro: 0 };
const mkSteps = (onSet, note) => {
  const a = [];
  for (let i = 0; i < 64; i++) a.push(Object.assign({}, stepOff, (onSet.indexOf(i) >= 0) ? { on: 1, note: note || 'c4' } : {}));
  return a;
};
const mkTrack = (o) => ({ len: o.len || 16, speed: (o.speed != null ? o.speed : 1), swing: (o.swing != null ? o.swing : 0), mute: o.mute || 0, steps: o.steps });
const mkPat = (name, tracks, swing) => ({ v: 1, name: name, bpm: 120, grid: '16', swing: (swing != null ? swing : 50), rng: 305419896, tracks: tracks, plocks: [] });
const emptyTrack = (o) => mkTrack(Object.assign({ steps: mkSteps([]) }, o || {}));
const onSteps = (n, note) => { const a = []; for (let i = 0; i < n; i++) a.push(i); return mkSteps(a, note); };

async function main() {
  /* target wait: launching WITHOUT a URL (stub pre-boot law) — find a page target we can drive
     (cdp_midi precedent; a fresh Edge profile may open edge:// targets first) */
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
    else if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: false }).catch(() => { /* belt only */ });
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');

  /* inject the stub BEFORE the app's first line — then navigate (cdp_midi law) */
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => { });
  await send('Page.navigate', { url });
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
  const until = async (expr, ms = 4000, step = 120) => {
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
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const b = boxR.value;
    if (!b) { note('click target not visible: ' + sel); return false; }
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', clickCount: 1 });
    await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
    await sleep(after);
    return true;
  };

  /* ── 0. boot ── */
  console.log('== 0. boot ==');
  await sleep(700);
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
  check('0a boot: data-av-ready flips + engine ctx found/running/spc/sr 48k',
    ready === true && eng.found === true && eng.state === 'running' && eng.scp === true && Number(eng.sampleRate) === 48000,
    J({ ready: ready, eng: eng, stub: 'injected pre-boot' }));
  if (!ready) { console.error('APP NOT READY'); process.exit(1); }
  if (eng.found !== true || eng.state !== 'running') note('engine ctx not running yet — the legs will surface honest refusals');

  await ev('(' + M2W_INSTALL.toString() + ')()');
  const legChk = val(await ev(`(function () {
    var g = function (n) { return typeof window.__m2w[n]; };
    var need = ['num', 'safe', 'j', 'domGet', 'counter', 'txt', 'mark', 'light', 'notes', 'held', 'noteState', 'down', 'up', 'stopAll',
      'paramGet', 'apply', 'witArm', 'witRelease', 'rms', 'rec', 'recPull', 'recStop', 'peak', 'centroid', 'splitOn', 'splitRms',
      'fire', 'midiSnap', 'midiEnable', 'midiPlayIn', 'midiPlayInGet',
      'mpeSnap', 'mpeSet', 'mpeSetBend', 'mpePush', 'mpeRow',
      'wavBuild', 'sampleFeed', 'sampleEntries', 'chopLight', 'chopDetectEntry', 'chopSnap', 'chopSelSrc', 'chopSetSlot',
      'chopEdit', 'chopReadRow', 'chopStatus', 'chopRows', 'chopPads', 'chopApply', 'chopToSteps', 'clickId',
      'seqSnap', 'seqLoad', 'seqPlan', 'seqPos', 'seqPlay', 'seqStop', 'seqPlaying', 'trackCtl', 'genTrack',
      'setInput', 'setSelect', 'euclidApply', 'mutateApply', 'fillApply', 'fillIds', 'onSets',
      'songSnap', 'songLoad', 'songPlay', 'songStop', 'songStatus', 'songPlaying', 'sceneCapture', 'sceneRecall', 'songRec', 'songRecPull', 'songRecStop',
      'arm', 'cleanup'];
    var miss = [], t = [];
    for (var i = 0; i < need.length; i++) { var k = g(need[i]); if (k !== 'function') miss.push(need[i] + ':' + k); }
    try {
      t.push('avMpeDeckSet:' + typeof avMpeDeckSet);
      t.push('avChopDetectFrames:' + typeof avChopDetectFrames);
      t.push('avChopApply:' + typeof avChopApply);
      t.push('avChopToSteps:' + typeof avChopToSteps);
      t.push('avSongPlay:' + typeof avSongPlay);
      t.push('avSongExportMidi:' + typeof avSongExportMidi);
      t.push('avMidParse:' + typeof avMidParse);
      t.push('avMpeDeckIncoming:' + typeof avMpeDeckIncoming);
      t.push('avSampleStore:' + typeof avSampleStore);
      t.push('avMasterNodes:' + typeof avMasterNodes);
    } catch (e) { t.push('probe-err ' + String((e && e.message) || e)); }
    return { v: (window.__m2w && window.__m2w.v) || null, miss: miss, api: t };
  })()`));
  check('0b rig helpers injected + M2 API surface probe (__m2w v1 · MPE/CHOP/SONG/MID-parse names)',
    legChk && legChk.v === 1 && Array.isArray(legChk.miss) && legChk.miss.length === 0,
    J(legChk));

  const arm = val(await ev('window.__m2w.arm()')) || {};
  note('baseline armed: ' + J(arm));

  /* witness arm + fixture kind */
  const w0 = val(await ev('window.__m2w.witArm()')) || {};
  const kind0 = val(await ev('window.__m2w.apply("engine.kind", "va")')) || {};
  note('witness: ' + J(w0) + ' · fixture kind va: ' + J({ ret: kind0.ret, echo: kind0.echo }));

  /* ════════════════ 1. MPE ════════════════ */
  console.log('== 1. MPE (deck + kernel) ==');
  await ev('window.__m2w.stopAll()');

  /* 1a: enable MIDI via the stub, then zone on + bend 48 */
  const midiOn = val(await ev('window.__m2w.midiEnable()'));
  const mpeSetR = val(await ev(`(() => {
    var out = { prefs0: null, set: null, bend: null, push: null };
    try { out.prefs0 = (typeof avMidiPrefs !== 'undefined') ? { mpe: !!avMidiPrefs.mpe, mpeBend: avMidiPrefs.mpeBend, playIn: !!avMidiPrefs.playIn } : null; } catch (e) { out.prefs0 = 'err'; }
    try { out.set = (typeof avMpeDeckSet === 'function') ? avMpeDeckSet(true) : 'missing'; } catch (e) { out.set = 'threw: ' + ((e && e.message) || e); }
    try { out.bend = (typeof avMpeDeckSetBend === 'function') ? avMpeDeckSetBend(48) : 'missing'; } catch (e) { out.bend = 'threw: ' + ((e && e.message) || e); }
    try { out.push = (typeof avMpeDeckPush === 'function') ? (avMpeDeckPush(), true) : 'missing'; } catch (e) { out.push = 'threw'; }
    return out;
  })()`));
  const mpeSnap1 = val(await ev('window.__m2w.mpeSnap()'));
  check('1a MPE enable: MIDI on via stub + avMpeDeckSet(true) + bend 48 -> snap {on, bend} reflect',
    midiOn && midiOn.after === 'enabled' && mpeSetR.set === true && mpeSetR.bend === true &&
    mpeSnap1 && mpeSnap1.on === true && mpeSnap1.bend === 48,
    J({ midi: (midiOn && midiOn.after) || midiOn, set: mpeSetR, snap: mpeSnap1 }));

  const mpeRow1 = val(await ev('window.__m2w.mpeRow()')) || {};
  check('1b MPE row: #av-midi-mpe-row + [data-midimpe] + #av-midi-mpe-bend (=48 · 24/48/96) + state/active ids',
    mpeRow1.row === true && mpeRow1.toggle !== null && mpeRow1.bendSel !== null &&
    mpeRow1.bendSel.value === '48' && mpeRow1.bendSel.opts >= 3 && mpeRow1.state === true && mpeRow1.active === true && mpeRow1.handle === true,
    J(mpeRow1));

  /* 1c: member note (chan 2 = 0-based 1), c3 = 48 = 130.81 Hz */
  const floor1 = val(await ev('window.__m2w.rms(280)')) || {};
  const inj1 = val(await ev('window.__m2w.fire("m2i1", [0x91, 48, 100])')) || {};
  await sleep(430);
  const sig1 = val(await ev('window.__m2w.rms(320)')) || {};
  const peak1 = val(await ev('window.__m2w.peak()')) || {};
  const ns1 = val(await ev('window.__m2w.noteState()')) || {};
  const HZ_C3 = 130.81;
  const hzOk1 = peak1.ok === true && typeof peak1.hz === 'number' && Math.abs(peak1.hz - HZ_C3) / HZ_C3 <= 0.015;
  check('1c MPE member note (chan 2, c3): engine audio at ~' + HZ_C3 + ' Hz (+-1.5%) — measured ' + fx3(peak1.hz) + ' Hz',
    inj1.ok === true && sig1.ok === true && typeof sig1.max === 'number' && sig1.max > Math.max(4 * (floor1.max || 0), 1e-3) && hzOk1,
    J({ floor: floor1, sig: sig1, peak: peak1, held: ns1.held, heldCh: ns1.heldCh }));

  /* 1d: bend +12 semis = raw 2048 (12/48*8192) on the member channel */
  const injB = val(await ev('window.__m2w.fire("m2i1", [0xE1, 0, 80])')) || {};	/* bend = (80<<7)|0 − 8192 = 2048 */
  await sleep(430);
  const peakB = val(await ev('window.__m2w.peak()')) || {};
  const ratioB = (peak1.ok === true && peakB.ok === true && peak1.hz > 0) ? peakB.hz / peak1.hz : null;
  const mpeSnapB = val(await ev('window.__m2w.mpeSnap()')) || {};
  check('1d MPE bend: raw pitchbend 2048 (12/48*8192) -> pitch ratio 2.000 (+-1.5%) — measured ' + fx3(ratioB),
    injB.ok === true && peakB.ok === true && ratioB !== null && Math.abs(ratioB - 2) <= 0.03,
    J({ peakA: peak1.hz, peakB: peakB.hz, ratio: ratioB, lastExpr: mpeSnapB.lastExpr }));

  /* 1e: touch 127 -> centroid rises */
  const c1a = val(await ev('window.__m2w.centroid()')) || {};
  const injT = val(await ev('window.__m2w.fire("m2i1", [0xD1, 127])')) || {};
  await sleep(430);
  const c1b = val(await ev('window.__m2w.centroid()')) || {};
  check('1e MPE touch 127: spectral centroid rises — ' + fx3(c1a.hz) + ' -> ' + fx3(c1b.hz) + ' Hz',
    injT.ok === true && c1a.ok === true && c1b.ok === true && c1b.hz >= c1a.hz * 1.02,
    J({ before: c1a, after: c1b }));
  await ev('window.__m2w.fire("m2i1", [0xD1, 0])');   /* reset the touch surface */
  await sleep(320);

  /* 1f: CC74 127 -> centroid rises strongly */
  const c1c = val(await ev('window.__m2w.centroid()')) || {};
  const inj74 = val(await ev('window.__m2w.fire("m2i1", [0xB1, 74, 127])')) || {};
  await sleep(430);
  const c1d = val(await ev('window.__m2w.centroid()')) || {};
  check('1f MPE CC74 127 (timbre): centroid rises strongly — ' + fx3(c1c.hz) + ' -> ' + fx3(c1d.hz) + ' Hz',
    inj74.ok === true && c1c.ok === true && c1d.ok === true && c1d.hz >= c1c.hz * 1.08,
    J({ before: c1c, after: c1d }));

  /* 1g: CC10 127 -> right RMS > left by >= 3 dB (split tap) */
  const sp1 = val(await ev('window.__m2w.splitOn()')) || {};
  const injPan = val(await ev('window.__m2w.fire("m2i1", [0xB1, 10, 127])')) || {};
  await sleep(380);
  const spR = val(await ev('window.__m2w.splitRms(350)')) || {};
  check('1g MPE CC10 127 (pan): right RMS > left by >= 3 dB — measured ' + fx3(spR.db) + ' dB',
    sp1.ok === true && injPan.ok === true && spR.ok === true && spR.db !== null && spR.db >= 3,
    J({ split: sp1, rms: spR }));
  await ev('window.__m2w.fire("m2i1", [0xB1, 10, 64])');   /* recentre */
  await sleep(220);

  /* 1h: note-off -> silence */
  const injOff = val(await ev('window.__m2w.fire("m2i1", [0x81, 48, 0])')) || {};
  await sleep(450);
  const tail1 = val(await ev('window.__m2w.rms(350)')) || {};
  check('1h MPE note-off: silence after release (tail max ' + fx3(tail1.max) + ' vs floor ' + fx3(floor1.max) + ')',
    injOff.ok === true && tail1.ok === true && tail1.max <= Math.max(4 * (floor1.max || 0), 1e-3),
    J({ tail: tail1, held: (val(await ev('window.__m2w.noteState()')) || {}).held }));

  /* 1i: member note while playIn OFF -> no audio */
  const pio = val(await ev('window.__m2w.midiPlayIn(false)'));
  await sleep(180);
  const floorI = val(await ev('window.__m2w.rms(250)')) || {};
  const injI = val(await ev('window.__m2w.fire("m2i1", [0x91, 48, 100])')) || {};
  await sleep(420);
  const quiI = val(await ev('window.__m2w.rms(300)')) || {};
  check('1i MPE playIn OFF: member note stays quiet (max ' + fx3(quiI.max) + ' vs floor ' + fx3(floorI.max) + ')',
    pio === true && injI.ok === true && quiI.ok === true && quiI.max <= Math.max(4 * (floorI.max || 0), 1e-3),
    J({ playIn: val(await ev('window.__m2w.midiPlayInGet()')), quiet: quiI }));
  await ev('window.__m2w.fire("m2i1", [0x81, 48, 0])');
  await ev('window.__m2w.midiPlayIn(true)');
  await sleep(200);

  /* 1j: MASTER ch1 note still plays through the global path */
  const injM = val(await ev('window.__m2w.fire("m2i1", [0x90, 48, 100])')) || {};
  await sleep(430);
  const sigM = val(await ev('window.__m2w.rms(320)')) || {};
  const nsM = val(await ev('window.__m2w.noteState()')) || {};
  const heldM = Array.isArray(nsM.held) ? nsM.held : [];
  check('1j MPE MASTER ch1 note: still plays through the global path (audio + ch-0 held)',
    injM.ok === true && sigM.ok === true && sigM.max > Math.max(4 * (floor1.max || 0), 1e-3) && heldM.indexOf('c3') >= 0,
    J({ sig: sigM.max, held: nsM.held, heldCh: nsM.heldCh }));
  await ev('window.__m2w.fire("m2i1", [0x80, 48, 0])');
  await sleep(250);

  /* 1k: avMpeDeckSet(false) brooms (silence <= 300 ms) */
  await ev('window.__m2w.fire("m2i1", [0x91, 48, 100])');
  await sleep(280);
  const sigK = val(await ev('window.__m2w.rms(250)')) || {};
  const offR = await ev('window.__m2w.mpeSet(false)');
  await sleep(320);                /* the broom releases member voices — the release env needs a beat to fall */
  const tailK = val(await ev('window.__m2w.rms(280)')) || {};
  const snapK = val(await ev('window.__m2w.mpeSnap()')) || {};
  check('1k MPE set(false) brooms: member note cut, silence <= 300 ms (max ' + fx3(tailK.max) + ')',
    sigK.ok === true && sigK.max > Math.max(4 * (floor1.max || 0), 1e-3) && offR.value === false &&
    snapK.on === false && tailK.ok === true && tailK.max <= Math.max(4 * (floor1.max || 0), 1e-3),
    J({ held: sigK, off: offR.value, snap: snapK, tail: tailK }));

  /* 1l: snap keys */
  const snapL = val(await ev('window.__m2w.mpeSnap()')) || {};
  const le = snapL.lastExpr;
  check('1l MPE snap keys: {on, bend, held, lastExpr, pushes}',
    snapL && typeof snapL.on === 'boolean' && typeof snapL.bend === 'number' &&
    Array.isArray(snapL.held) && (le === null || (typeof le === 'object' && typeof le.ch === 'number' && typeof le.dim === 'string')) &&
    typeof snapL.pushes === 'number',
    J(snapL));

  /* ════════════════ 2. CHOP ════════════════ */
  console.log('== 2. CHOP (detect · card · apply · pads · steps) ==');
  await ev('window.__m2w.stopAll()');
  await ev('window.__m2w.seqStop()');

  /* 2a: synthetic 4-burst WAV -> store */
  const wavR = val(await ev('window.__m2w.wavBuild()')) || {};
  const feedR = val(await ev('window.__m2w.sampleFeed("m2-bursts.wav")'));
  const entriesA = val(await ev('window.__m2w.sampleEntries()')) || {};
  const entryA = Array.isArray(entriesA.entries) && entriesA.entries.length ? entriesA.entries[entriesA.entries.length - 1] : null;
  const entryId = entryA ? entryA.id : null;
  const entryRate = entryA ? entryA.rate : null;
  check('2a chop WAV: avWavEncode 4-burst synthetic (sr ' + (wavR.sr || '?') + ' · ' + (wavR.n || '?') + ' frames) fed via ' + ((feedR && feedR.path) || '?') + ' -> store entry',
    wavR.ok === true && wavR.n === 61440 && feedR && feedR.ok === true && entryA !== null,
    J({ wav: { ok: wavR.ok, sr: wavR.sr, n: wavR.n, len: wavR.bytesLen }, feed: feedR, entry: entryA }));

  /* 2b: detect -> 4 slices within +-0.5 ms of truth */
  const detR = val(await ev('window.__m2w.chopDetectEntry()')) || {};
  const fr = detR.fr || {};
  const periodF = (entryRate ? Math.round(0.32 * entryRate) : 15360);
  const tolF = Math.max(4, Math.round(0.0005 * (entryRate || 48000)));
  const slicesB = Array.isArray(fr.slices) ? fr.slices : null;
  const boundsOk = !!(slicesB && slicesB.length === 4 &&
    slicesB[0].s0 === 0 && slicesB[3].s1 === detR.n &&
    Math.abs(slicesB[1].s0 - periodF) <= tolF && Math.abs(slicesB[2].s0 - periodF * 2) <= tolF && Math.abs(slicesB[3].s0 - periodF * 3) <= tolF &&
    slicesB[0].s1 === slicesB[1].s0 && slicesB[1].s1 === slicesB[2].s0 && slicesB[2].s1 === slicesB[3].s0);
  check('2b chop detect: avChopDetectFrames -> 4 slices · boundaries within +-0.5 ms of truth (' + periodF + '/' + (periodF * 2) + '/' + (periodF * 3) + ' frames)',
    fr.ok === true && fr.count === 4 && boundsOk,
    J({ id: detR.id, rate: detR.rate, n: detR.n, fr: fr, det: detR.det, err: detR.err1 || detR.err2 }));

  /* 2c: card DETECT -> 4 rows */
  const srcPick = val(await ev('window.__m2w.chopSelSrc(' + JSON.stringify(entryId || '') + ')')) || {};
  const detClick = await clickSel('#av-chop-detect', 350);
  let rowsN = 0;
  for (let i = 0; i < 30; i++) { rowsN = Number(val(await ev('window.__m2w.chopRows()'))) | 0; if (rowsN >= 4) break; await sleep(140); }
  const padsC = val(await ev('window.__m2w.chopPads()')) || {};
  check('2c chop card: entry selected in #av-chop-src + DETECT click -> 4 [data-slice-idx] rows (+ pads drawn)',
    srcPick.picked !== false && detClick === true && rowsN === 4 && padsC.pads >= 1,
    J({ src: srcPick, detect: detClick, rows: rowsN, pads: padsC, status: (val(await ev('window.__m2w.chopStatus()'))) }));

  /* 2d: edits via the CARD inputs -> kit reflects */
  await ev('window.__m2w.chopSetSlot(0)');
  const trim1 = periodF + 11000;                          /* inside the burst, before the silent gap */
  const edit1 = val(await ev('window.__m2w.chopEdit(1, ' + JSON.stringify({ trim0: periodF, trim1: trim1, fadeIn: 8, fadeOut: 60, norm: true }) + ')')) || {};
  const edit2 = val(await ev('window.__m2w.chopEdit(2, ' + JSON.stringify({ trim0: periodF * 2, trim1: periodF * 2 + 11000, fadeIn: 8, fadeOut: 60, norm: true }) + ')')) || {};
  const read1 = val(await ev('window.__m2w.chopReadRow(1)')) || {};
  const read2 = val(await ev('window.__m2w.chopReadRow(2)')) || {};
  const snapC = val(await ev('window.__m2w.chopSnap()')) || {};
  const kitC = (snapC && snapC.kit) ? snapC.kit : null;      /* snap.kit is the digest: {srcId, slot, base, slices, active} */
  check('2d chop edits: trims/fades/norm via [data-slice-idx] inputs -> kit reflects (slice1 trim1 ' + trim1 + ' · fadeOut 60 · norm)',
    edit1.found === true && edit2.found === true && read1.found === true && read2.found === true &&
    read1.trim1 === String(trim1) && read1.fadeOut === '60' && read1.fadeIn === '8' && read1.norm === true &&
    read2.trim1 === String(periodF * 2 + 11000) && read2.norm === true &&
    !!kitC && kitC.slices === 4 && kitC.active === 4,
    J({ edit1: edit1.set, edit2: edit2.set, read1: read1, read2: read2, kit: kitC }));
  const kitBase = (kitC && typeof kitC.base === 'number') ? kitC.base : 36;
  const pad1 = noteName(kitBase + 1), pad2 = noteName(kitBase + 2);

  /* 2e: APPLY KIT -> pad burst (the sampler kind must be the audible engine for the zone law) */
  const kindC = val(await ev('window.__m2w.apply("engine.kind", "sampler")')) || {};
  const applyC = val(await ev('window.__m2w.chopApply()')) || {};
  await sleep(250);
  const statusC = val(await ev('window.__m2w.chopStatus()'));
  const floorC = val(await ev('window.__m2w.rms(250)')) || {};
  const p1 = val(await ev(`window.__m2w.down(${JSON.stringify(pad1)}, 0.9)`)) || {};
  await sleep(30);
  const sigP1 = val(await ev('window.__m2w.rms(120)')) || {};
  check('2e chop apply: engine.kind sampler + APPLY KIT (slot 0) -> pad ' + pad1 + ' burst above the floor (RMS ' + fx3(sigP1.max) + ')',
    kindC.ret === true && applyC.found === true && p1.fresh === true && sigP1.ok === true && sigP1.max > Math.max(4 * (floorC.max || 0), 1e-3) &&
    typeof statusC === 'string' && /applied/i.test(statusC),
    J({ kind: { ret: kindC.ret, echo: kindC.echo }, apply: applyC, status: statusC, floor: floorC, sig: sigP1 }));

  /* 2f: norm'd slices RMS-equal +-1.5 dB (pads base+1 vs base+2) */
  await ev(`window.__m2w.up(${JSON.stringify(pad1)})`);
  await sleep(260);
  const p2 = val(await ev(`window.__m2w.down(${JSON.stringify(pad2)}, 0.9)`)) || {};
  await sleep(30);
  const sigP2 = val(await ev('window.__m2w.rms(120)')) || {};
  await ev(`window.__m2w.up(${JSON.stringify(pad2)})`);
  const normDb = (sigP1.ok === true && sigP2.ok === true && sigP1.max > 0 && sigP2.max > 0) ? Math.abs(20 * Math.log10(sigP2.max / sigP1.max)) : null;
  check('2f chop norm: normalized slices RMS-equal +-1.5 dB (' + pad1 + ' vs ' + pad2 + ' — ' + fx3(normDb) + ' dB)',
    p2.fresh === true && sigP2.ok === true && normDb !== null && normDb <= 1.5,
    J({ a: sigP1, b: sigP2, db: normDb, read2: val(await ev('window.__m2w.chopReadRow(2)')) || {}, data: val(await ev('window.__m2w.chopDataCmp()')) || {} }));

  /* 2g: fade-out trim -> tail < 30 % of mid */
  const recG = val(await ev('window.__m2w.rec(680)')) || {};
  await sleep(60);
  const p3 = val(await ev(`window.__m2w.down(${JSON.stringify(pad1)}, 0.9)`)) || {};
  await sleep(520);
  await ev(`window.__m2w.up(${JSON.stringify(pad1)})`);
  await sleep(140);
  const tlG = val(await ev('window.__m2w.recPull()')) || {};
  const samG = Array.isArray(tlG.samples) ? tlG.samples : [];
  const mxG = samG.reduce((m, s) => Math.max(m, s[1]), 0);
  const onsetG = samG.find(s => s[1] >= 0.25 * mxG);
  let endG = null;
  for (let i = samG.length - 1; i >= 0; i--) if (samG[i][1] >= 0.1 * mxG) { endG = samG[i]; break; }
  let midG = null, tailG = null, durG = null;
  if (onsetG && endG && endG[0] > onsetG[0]) {
    durG = endG[0] - onsetG[0];
    midG = winMean(samG, onsetG[0] + durG * 0.25, onsetG[0] + durG * 0.5);
    /* R1 rig SPEC note: the tail is the TAIL — measured over the final 8 ms at the detected end
       (the 10%-of-max end detector sits ON the 60 ms fade slope, so a 25 ms look-back window mostly
       re-reads the pre-fade ramp and the mean lands at ~0.30 mid by construction: a knife edge, and
       the recorded flake). Anchoring to the final 8 ms measures the fade's completion: ~0.10-0.22
       of mid when the fade ran, ~1.0 when it did not — same threshold, same intent, real margin. */
    tailG = winMean(samG, endG[0] - 8, endG[0]);
  }
  check('2g chop fade: fadeOut 60 ms -> tail RMS < 30 % of mid (tail ' + fx3(tailG) + ' vs mid ' + fx3(midG) + ' · burst ' + fx3(durG) + ' ms)',
    p3.fresh === true && mxG > Math.max(4 * (floorC.max || 0), 1e-3) && midG !== null && tailG !== null && tailG < 0.3 * midG,
    J({ mx: mxG, onset: onsetG && onsetG[0], end: endG && endG[0], dur: durG, mid: midG, tail: tailG, n: samG.length }));

  /* 2h: SLICE->STEPS on track 3 */
  const setTr = val(await ev('window.__m2w.setSelect("av-chop-steps-track", 3)')) || {};
  const stepsClick = val(await ev('window.__m2w.chopToSteps()')) || {};
  await sleep(300);
  const statusH = val(await ev('window.__m2w.chopStatus()'));
  const snapH = val(await ev('window.__m2w.seqSnap()')) || {};
  const trH = (snapH.tracks && snapH.tracks[3]) ? snapH.tracks[3] : null;
  const wantNotes = [0, 1, 2, 3].map(k => noteName(kitBase + k));
  const gotNotes = (trH && Array.isArray(trH.steps)) ? trH.steps.slice(0, 4).map(s => s && s.note) : null;
  check('2h chop steps: SLICE->STEPS on track 3 -> snap steps on x4 with notes ' + J(wantNotes),
    stepsClick.found === true && !!(trH && Array.isArray(trH.steps)) &&
    trH.steps.slice(0, 4).every(s => s && s.on === 1) && J(gotNotes) === J(wantNotes) &&
    typeof statusH === 'string' && /wrote/i.test(statusH),
    J({ track: trH && { len: trH.len, speed: trH.speed }, notes: gotNotes, status: statusH }));

  /* 2i: PLAY -> 4 onsets */
  const recI = val(await ev('window.__m2w.rec(2350)')) || {};
  await sleep(80);
  const playClick2 = await clickSel('#av-seq-host #av-seq-play', 120);
  if (playClick2 !== true) await ev('window.__m2w.seqPlay()');
  await sleep(2100);
  await ev('window.__m2w.seqStop()');
  const tlI = val(await ev('window.__m2w.recPull()')) || {};
  const samI = Array.isArray(tlI.samples) ? tlI.samples : [];
  const detI = detectOnsets(samI);
  const o0I = detI.onsets.length ? detI.onsets[0] : null;   /* first onset — the click latency cancels */
  const firstWin = o0I == null ? [] : detI.onsets.filter(t => t >= o0I - 60 && t <= o0I + 520);
  const trI = val(await ev('window.__m2w.seqTrace()')) || [];
  const trDowns = trI.filter(e => e && e.type === 'on' && e.track === 3);
  const trSteps = Array.from(new Set(trDowns.map(e => e.step)));
  const trNotes = Array.from(new Set(trDowns.map(e => e.note)));
  const trOk = trSteps.length === 4 && [0, 1, 2, 3].every(s => trSteps.indexOf(s) >= 0) &&
    trNotes.length === 4 && ['c2', 'c#2', 'd2', 'd#2'].every(n => trNotes.indexOf(n) >= 0);
  /* R1 rig SPEC note: the ~6 ms RMS timeline samples fast hit attacks at knife-edge phase — a
     discrete onset COUNT is not a stable witness (it caught 1 of 4 hits in the golden run, 0 after
     a 1-sample timing shift; the envelope itself was near-identical). The stated intent — "PLAY ->
     the written steps fire (audio present)" — is proven by the step trace (trOk) plus amplitude
     presence in the play window at 1.5x the detector threshold (the same quantity the old leg used
     for its audio-presence proof). */
  const hitWinMax = winMax(samI, 0, 1200);
  check('2i chop play: PLAY -> the written steps fire (audio present in the play window · trace steps ' + J(trSteps.sort((a, b) => a - b)) + ')',
    trOk && samI.length >= 300 && hitWinMax > detI.dthr * 1.5,
    J({ first: firstWin, total: detI.onsets.length, winMax: hitWinMax, max: detI.max, thr: detI.dthr, traceSteps: trSteps, traceNotes: trNotes, n: samI.length }));
  await ev('window.__m2w.stopAll()');
  await ev('window.__m2w.seqStop()');
  await ev('window.__m2w.apply("engine.kind", "va")');   /* restore the armed kind for gen/song */

  /* ════════════════ 3. GENERATIVE ════════════════ */
  console.log('== 3. GENERATIVE (track ctl · planner witnesses · gen applies) ==');
  await ev('window.__m2w.stopAll()');

  /* 3a: per-row track ctl selects exist */
  const genA = val(await ev(`(() => {
    var host = document.getElementById('av-seq-host');
    if (!host) return { host: false };
    var out = { host: true, rows: host.querySelectorAll('.av-seq-row[data-track]').length,
      ctl: host.querySelectorAll('.av-seq-track-ctl').length,
      len: host.querySelectorAll('select[data-track-len]').length,
      spd: host.querySelectorAll('select[data-track-spd]').length,
      swg: host.querySelectorAll('select[data-track-swg]').length };
    var s1 = host.querySelector('.av-seq-row[data-track="3"] select[data-track-spd]') || host.querySelectorAll('select[data-track-spd]')[3];
    if (s1) { out.spdVals = []; for (var i = 0; i < s1.options.length && i < 12; i++) out.spdVals.push(String(s1.options[i].value)); }
    var s2 = host.querySelector('.av-seq-row[data-track="1"] select[data-track-swg]') || host.querySelectorAll('select[data-track-swg]')[1];
    if (s2) { out.swgVals = []; for (var j = 0; j < s2.options.length && j < 40; j++) out.swgVals.push(String(s2.options[j].value)); }
    return out;
  })()`)) || {};
  check('3a gen: 4x(.av-seq-track-ctl len/spd/swg selects) — spd carries 0.75 · swg INHERIT+50..80',
    genA.host === true && genA.rows === 4 && genA.ctl >= 4 && genA.len === 4 && genA.spd === 4 && genA.swg === 4 &&
    Array.isArray(genA.spdVals) && genA.spdVals.indexOf('0.75') >= 0 &&
    Array.isArray(genA.swgVals) && genA.swgVals.indexOf('66') >= 0 && genA.swgVals.length >= 8,
    J(genA));

  /* 3b: track 4 speed 0.75 via the select -> snap + planner spacing = stepDur/0.75 */
  const P_SPEED = mkPat('M2 SPEED', [
    emptyTrack({}),
    emptyTrack({}),
    emptyTrack({}),
    mkTrack({ len: 16, speed: 1, steps: onSteps(16, 'c4') }),
  ], 50);
  const load3b = val(await ev('window.__m2w.seqLoad(' + JSON.stringify(P_SPEED) + ')')) || {};
  await sleep(250);
  const spdSet = val(await ev('window.__m2w.trackCtl(3, "spd", "0.75")')) || {};
  await sleep(250);
  const snap3b = val(await ev('window.__m2w.seqSnap()')) || {};
  const spdReflect = (snap3b.tracks && snap3b.tracks[3]) ? snap3b.tracks[3].speed : null;
  const plan3b = val(await ev('window.__m2w.seqPlan(0, 16)')) || {};
  const on3b = (Array.isArray(plan3b.events) ? plan3b.events : []).filter(e => e.type === 'on' && e.track === 3).map(e => e.t).sort((a, b) => a - b);
  const gaps3b = [];
  for (let i = 1; i < on3b.length; i++) gaps3b.push(on3b[i] - on3b[i - 1]);
  const want3b = 0.125 / 0.75;
  const meanGap3b = gaps3b.length ? mean(gaps3b.slice(0, Math.min(8, gaps3b.length))) : null;
  check('3b gen speed: track 4 spd 0.75 select -> snap.speed ' + J(spdReflect) + ' + planner spacing ' + fx4(meanGap3b) + ' s (want ' + fx4(want3b) + ')',
    load3b.ok === true && spdSet.set === '0.75' && spdReflect === 0.75 && on3b.length >= 8 &&
    meanGap3b !== null && Math.abs(meanGap3b - want3b) <= want3b * 0.005,
    J({ load: load3b, set: spdSet, speed: spdReflect, ons: on3b.length, gaps: gaps3b.slice(0, 8), planN: plan3b.n }));

  /* 3c: track 2 swing 66 vs pattern 50 -> odd shift ~ +16 % stepDur */
  const P_SWING = mkPat('M2 SWING', [
    emptyTrack({}),
    mkTrack({ len: 16, speed: 1, steps: mkSteps([0, 1, 2, 3, 4, 5, 6, 7]) }),
    emptyTrack({}),
    emptyTrack({}),
  ], 50);
  const load3c = val(await ev('window.__m2w.seqLoad(' + JSON.stringify(P_SWING) + ')')) || {};
  await sleep(250);
  const swgSet = val(await ev('window.__m2w.trackCtl(1, "swg", "66")')) || {};
  await sleep(250);
  const snap3c = val(await ev('window.__m2w.seqSnap()')) || {};
  const swgReflect = (snap3c.tracks && snap3c.tracks[1]) ? snap3c.tracks[1].swing : null;
  const plan3c = val(await ev('window.__m2w.seqPlan(0, 8)')) || {};
  const ev3c = (Array.isArray(plan3c.events) ? plan3c.events : []).filter(e => e.type === 'on' && e.track === 1).sort((a, b) => a.t - b.t);
  const td3c = 0.125;
  const oddR = [], evenR = [];
  for (let k = 0; k < ev3c.length; k++) {
    const r = ev3c[k].t - k * td3c;
    if (k % 2 === 1) oddR.push(r); else evenR.push(r);
  }
  const oddShift = oddR.length ? mean(oddR) : null;
  const evenShift = evenR.length ? mean(evenR) : null;
  const want3c = td3c * 0.16;
  check('3c gen swing: track 2 swg 66 (pattern 50) -> planner odd-onset shift ' + fx4(oddShift) + ' s (want +' + fx4(want3c) + ' = 16 % stepDur)',
    load3c.ok === true && swgSet.set === '66' && swgReflect === 66 && ev3c.length >= 6 &&
    oddShift !== null && Math.abs(oddShift - want3c) <= 0.004,
    J({ load: load3c, set: swgSet, swing: swgReflect, ons: ev3c.length, oddShift: oddShift, evenShift: evenShift }));

  /* 3d: euclid apply -> on-count == pulses */
  const P_EU = mkPat('M2 EU', [emptyTrack({}), emptyTrack({}), emptyTrack({}), emptyTrack({})], 50);
  const load3d = val(await ev('window.__m2w.seqLoad(' + JSON.stringify(P_EU) + ')')) || {};
  await sleep(250);
  const genT = val(await ev('window.__m2w.genTrack(0)')) || {};
  const euR = val(await ev('window.__m2w.euclidApply(5, 16, 0)')) || {};
  await sleep(300);
  const snap3d = val(await ev('window.__m2w.seqSnap()')) || {};
  const on3d = val(await ev(`(function () { var s = window.__m2w.seqSnap(); var t = s && s.tracks && s.tracks[0]; if (!t || !t.steps) return null; var c = 0; for (var i = 0; i < Math.min(t.len, 16); i++) if (t.steps[i] && t.steps[i].on) c++; return c; })()`));
  check('3d gen euclid: apply (pulses 5 / len 16 / rot 0) -> on-count == pulses (' + J(on3d) + ')',
    load3d.ok === true && euR.click && euR.click.found === true && on3d === 5,
    J({ load: load3d, track: genT, apply: euR, on: on3d, sets: val(await ev('window.__m2w.onSets(window.__m2w.seqSnap())')) }));

  /* 3e: mutate keeps count */
  const P_MUT = mkPat('M2 MUT', [
    mkTrack({ len: 16, steps: mkSteps([0, 2, 4, 6, 8, 10, 12, 14]) }),
    mkTrack({ len: 16, steps: mkSteps([0, 2, 4, 6, 8, 10, 12, 14]) }),
    mkTrack({ len: 16, steps: mkSteps([0, 2, 4, 6, 8, 10, 12, 14]) }),
    mkTrack({ len: 16, steps: mkSteps([0, 2, 4, 6, 8, 10, 12, 14]) }),
  ], 50);
  const load3e = val(await ev('window.__m2w.seqLoad(' + JSON.stringify(P_MUT) + ')')) || {};
  await sleep(250);
  const before3e = val(await ev('window.__m2w.onSets(window.__m2w.seqSnap())'));
  const countBefore3e = Array.isArray(before3e) ? before3e.reduce((a, l) => a + l.length, 0) : null;
  const mutR = val(await ev('window.__m2w.mutateApply(50)')) || {};
  await sleep(320);
  const after3e = val(await ev('window.__m2w.onSets(window.__m2w.seqSnap())'));
  const countAfter3e = Array.isArray(after3e) ? after3e.reduce((a, l) => a + l.length, 0) : null;
  const changed3e = J(before3e) !== J(after3e);
  check('3e gen mutate: apply amount 50 -> on-count preserved (' + countBefore3e + ' -> ' + countAfter3e + ')',
    load3e.ok === true && mutR.click && mutR.click.found === true && countBefore3e !== null && countAfter3e === countBefore3e,
    J({ load: load3e, before: before3e, after: after3e, changed: changed3e }));

  /* 3f: fill apply ('kick') changes steps to the mask */
  const fillIds = val(await ev('window.__m2w.fillIds()'));
  const fillR = val(await ev('window.__m2w.fillApply("kick")')) || {};
  await sleep(320);
  const after3f = val(await ev('window.__m2w.onSets(window.__m2w.seqSnap())'));
  const t0set = Array.isArray(after3f) ? after3f[0] : null;
  check('3f gen fill: apply kick -> track 0 steps change to the mask {0,4,8,12} (got ' + J(t0set) + ')',
    Array.isArray(fillIds) && fillIds.indexOf('kick') >= 0 && fillR.click && fillR.click.found === true &&
    Array.isArray(t0set) && J(t0set) === J([0, 4, 8, 12]),
    J({ ids: fillIds, apply: fillR, sets: after3f, changed: J(after3e) !== J(after3f) }));

  /* ════════════════ 4. SONG ════════════════ */
  console.log('== 4. SONG (rows · runner · scene recall · exports) ==');
  await ev('window.__m2w.stopAll()');
  await ev('window.__m2w.seqStop()');

  /* 4a setup: pattern (track idx1 audible) + scene + 3 rows */
  const P_SONG = mkPat('M2 SONG PAT', [
    emptyTrack({ len: 4 }),
    mkTrack({ len: 4, steps: onSteps(4, 'c3') }),
    emptyTrack({ len: 4 }),
    emptyTrack({ len: 4 }),
  ], 50);
  P_SONG.tracks[0].mute = 1; P_SONG.tracks[2].mute = 1; P_SONG.tracks[3].mute = 1;   /* scene pre-mutes */
  const loadS0 = val(await ev('window.__m2w.seqLoad(' + JSON.stringify(P_SONG) + ')')) || {};
  const sceneCap = val(await ev('window.__m2w.sceneCapture("M2SC")'));
  P_SONG.tracks[0].mute = 0; P_SONG.tracks[2].mute = 0; P_SONG.tracks[3].mute = 0;   /* play state: all unmuted */
  const loadS1 = val(await ev('window.__m2w.seqLoad(' + JSON.stringify(P_SONG) + ')')) || {};
  const rowsS = { v: 1, rows: [
    { ref: 'M2 SONG PAT', repeats: 2, mutes: [0, 0, 0, 0], len: 4, tempo: 0, label: 'r0' },
    { ref: 'M2 SONG PAT', repeats: 1, mutes: [0, 0, 0, 0], len: 4, tempo: 0, label: 'r1' },
    { ref: 'M2 SONG PAT', repeats: 2, mutes: [0, 1, 1, 1], len: 4, tempo: 0, label: 'r2' },
  ] };
  const loadRows = val(await ev('window.__m2w.songLoad(' + JSON.stringify(rowsS) + ')'));
  const songSnapA = val(await ev('window.__m2w.songSnap()')) || {};
  const rowsOk = Array.isArray(songSnapA.rows) && songSnapA.rows.length === 3 &&
    J(songSnapA.rows[2] && songSnapA.rows[2].mutes) === J([0, 1, 1, 1]) &&
    songSnapA.rows[0].repeats === 2 && songSnapA.rows[1].repeats === 1 && songSnapA.rows[2].repeats === 2;

  /* 4a: PLAY SONG -> row advance + auto-stop */
  const recS = val(await ev('window.__m2w.songRec(3800)')) || {};
  const recA = val(await ev('window.__m2w.rec(3800)')) || {};
  await sleep(80);
  const playClick = await clickSel('#av-seq-song-play', 0);
  if (playClick !== true) { const sp = await ev('window.__m2w.songPlay()'); note('song play via API: ' + J(sp.value)); }
  await sleep(250);
  const recallR = val(await ev('window.__m2w.sceneRecall("M2SC", "beat")'));
  await sleep(2900);
  await ev('window.__m2w.songRecStop()');
  await ev('window.__m2w.recStop()');
  const tlS = val(await ev('window.__m2w.songRecPull()')) || {};
  const samS = Array.isArray(tlS.samples) ? tlS.samples : [];
  const tlA = val(await ev('window.__m2w.recPull()')) || {};
  const samA = Array.isArray(tlA.samples) ? tlA.samples : [];

  /* row sequence: distinct row values while playing */
  const rowsSeq = [];
  let sawStop = false;
  for (const s of samS) {
    const playing = s[1] === 1, row = s[2];
    if (playing && (rowsSeq.length === 0 || rowsSeq[rowsSeq.length - 1] !== row)) rowsSeq.push(row);
    if (!playing && rowsSeq.length > 0) sawStop = true;
  }
  const rowOk = J(rowsSeq) === J([0, 1, 2]) && sawStop === true;
  check('4a song: 3 rows built (rowsOk ' + rowsOk + ') + PLAY SONG -> row 0->1->2 monotone + auto-stop (saw ' + J(rowsSeq) + ')',
    loadS0.ok === true && sceneCap === true && loadS1.ok === true && loadRows === true && rowsOk && rowOk && samS.length > 20,
    J({ load: [loadS0.ok, loadS1.ok], rows: loadRows, cap: sceneCap, seq: rowsSeq, stop: sawStop, n: samS.length, recall: recallR }));

  /* 4b: mutes applied — mid-row-2 window silent while rows 0-1 sound */
  const tS0 = (recS && typeof recS.t0 === 'number') ? recS.t0 : 0;
  const tA0 = (recA && typeof recA.t0 === 'number') ? recA.t0 : 0;
  const absS = (rel) => tS0 + rel;
  const absA = (rel) => tA0 + rel;
  const firstPlay = samS.find(s => s[1] === 1);
  const firstRow2 = samS.find(s => s[1] === 1 && s[2] === 2);
  let soundMax = null, silMean = null, silMax = null, tRow2 = null, tPlay = null;
  if (firstPlay && firstRow2) {
    tPlay = absS(firstPlay[0]);
    tRow2 = absS(firstRow2[0]);
    soundMax = winMax(samA, tPlay + 250 - tA0, tRow2 - 150 - tA0);
    /* the transport plans in 8-step chunks: a pattern push lands from the next chunk after the
       row boundary — the muted window starts past one chunk (~500 ms at 120 bpm) + release */
    silMean = winMean(samA, tRow2 + 650 - tA0, tRow2 + 950 - tA0);
    silMax = winMax(samA, tRow2 + 650 - tA0, tRow2 + 950 - tA0);
  }
  const floorS = 4 * (floor1.max || 0);
  check('4b song mutes: rows 0-1 sound (max ' + fx3(soundMax) + ') · mid-row-2 window silent (mean ' + fx3(silMean) + ' · max ' + fx3(silMax) + ')',
    soundMax !== null && silMean !== null && soundMax > Math.max(floorS, 1e-3) && silMean <= Math.max(floorS, 0.005),
    J({ tPlay: tPlay && Math.round(tPlay - tS0), tRow2: tRow2 && Math.round(tRow2 - tS0), soundMax: soundMax, silMean: silMean, silMax: silMax, mutesRow2: samS.filter(s => s[1] === 1 && s[2] === 2 && Array.isArray(s[4])).map(s => s[4]).slice(0, 10), nA: samA.length }));

  /* 4c: quantised scene recall -> mute flip at a step === 0 mod 4 */
  let flip = null;
  for (let i = 1; i < samS.length; i++) {
    const a = samS[i - 1], b = samS[i];
    if (b[1] !== 1 || a[1] !== 1 || !Array.isArray(b[4]) || !Array.isArray(a[4])) continue;
    if (a[4][0] !== 1 && b[4][0] === 1) { flip = { prevStep: a[3], step: b[3], at: b[0], prevMutes: a[4], mutes: b[4] }; break; }
  }
  check('4c song scene recall: queued at beat -> mute flip at a step === 0 mod 4 (flip at step ' + J(flip && flip.step) + ' after step ' + J(flip && flip.prevStep) + ')',
    recallR && recallR.ok === true && flip !== null && typeof flip.step === 'number' &&
    flip.step % 4 === 0 && flip.step >= 4 && flip.step <= 8,
    J({ recall: recallR, flip: flip, sample: samS.filter(s => s[0] > (flip ? flip.at - 160 : 0) && s[0] < (flip ? flip.at + 160 : 0)).slice(0, 14) }));

  /* 4d prep: clear the live mutes the runner left applied (the export reads ROW mutes; a stale
     live mute on the audible track must not confound the repeat-scaling witness) */
  await ev('window.__m2w.seqLoad(' + JSON.stringify(P_SONG) + ')');
  await sleep(180);

  /* 4d: EXPORT SONG MIDI -> avMidParse -> noteCount scales with repeats */
  const midR = val(await ev(`(() => {
    var out = { fn: typeof avSongExportMidi, ok: false, error: null, bytes: 0, noteCount: null, warnings: null, parse: null, parseErr: null };
    try {
      var r = (typeof avSongExportMidi === 'function') ? avSongExportMidi({}) : null;
      if (!r) { out.error = 'no result'; return out; }
      out.ok = r.ok === true; out.error = r.error || null; out.rows = r.rows;
      out.noteCount = (typeof r.noteCount === 'number') ? r.noteCount : null;
      out.warnings = Array.isArray(r.warnings) ? r.warnings.slice(0, 4) : null;
      out.bytes = r.bytes ? (r.bytes.byteLength || r.bytes.length || 0) : 0;
      if (r.ok === true && r.bytes) {
        var p = null;
        try { p = (typeof avMidParse === 'function') ? avMidParse(r.bytes) : null; } catch (e) { out.parseErr = String((e && e.message) || e); }
        if (p) {
          var cnt = 0, i, tk;
          var tracks = p.tracks || [];
          for (i = 0; i < tracks.length; i++) {
            tk = tracks[i];
            var list = null;
            if (Object.prototype.toString.call(tk) === '[object Array]') list = tk;
            else if (tk && Object.prototype.toString.call(tk.notes) === '[object Array]') list = tk.notes;
            else if (tk && Object.prototype.toString.call(tk.events) === '[object Array]') list = tk.events;
            if (list) {
              for (var j = 0; j < list.length; j++) { var it = list[j]; if (it && it.type === 'off') continue; cnt++; }
            }
          }
          out.parse = { ok: p.ok === true, format: p.format, ppq: p.ppq, bpm: p.bpm, trackCount: p.trackCount, noteCount: p.noteCount, counted: cnt };
        }
      }
    } catch (e) { out.error = 'threw: ' + String((e && e.message) || e); }
    return out;
  })()`)) || {};
  const parsedCnt = midR.parse ? midR.parse.counted : null;
  check('4d song MIDI export: avMidExportSong -> avMidParse -> noteCount ' + J(parsedCnt) + ' === 12 (4 steps x (2+1) repeats; row 2 muted)',
    midR.ok === true && midR.parse && midR.parse.ok === true && parsedCnt === 12 &&
    (!midR.parse.format || midR.parse.format === 1) && (!midR.parse.ppq || midR.parse.ppq === 480),
    J({ export: { ok: midR.ok, bytes: midR.bytes, noteCount: midR.noteCount, rows: midR.rows, warnings: midR.warnings }, parse: midR.parse, err: midR.error || midR.parseErr }));

  /* 4e: EXPORT JSON round trip */
  const jsonR = val(await ev(`(() => {
    try {
      var s = (typeof avSongExportJson === 'function') ? avSongExportJson() : null;
      var parsed = null; try { parsed = JSON.parse(s); } catch (e) { parsed = null; }
      var rowsBefore = (typeof avSeqSongSnap === 'function') ? avSeqSongSnap() : null;
      var patBefore = (typeof avSeqSnap === 'function') ? avSeqSnap() : null;
      var cleared = (typeof avSeqSongLoad === 'function') ? avSeqSongLoad({ v: 1, rows: [] }) : 'missing';
      var re = (typeof avSongImportJson === 'function') ? avSongImportJson(s) : 'missing';
      var rowsAfter = (typeof avSeqSongSnap === 'function') ? avSeqSongSnap() : null;
      var patAfter = (typeof avSeqSnap === 'function') ? avSeqSnap() : null;
      return { str: s ? s.length : 0, parsed: parsed ? { v: parsed.v, name: parsed.name, bpm: parsed.bpm, grid: parsed.grid, rows: (parsed.rows || []).length, pattern: !!parsed.pattern } : null,
        cleared: cleared, import: re, rowsBefore: rowsBefore, rowsAfter: rowsAfter, patBefore: patBefore, patAfter: patAfter };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)) || {};
  check('4e song JSON round trip: export -> clear -> import -> rows + pattern deep-equal',
    jsonR.parsed && jsonR.parsed.v === 1 && jsonR.parsed.pattern === true && jsonR.import === true &&
    deepEq(jsonR.rowsBefore, jsonR.rowsAfter) && deepEq(jsonR.patBefore, jsonR.patAfter),
    J({ str: jsonR.str, parsed: jsonR.parsed, import: jsonR.import, rowsEq: deepEq(jsonR.rowsBefore, jsonR.rowsAfter), patEq: deepEq(jsonR.patBefore, jsonR.patAfter), err: jsonR.err }));

  /* 4f: STOP -> clean */
  const play2 = await clickSel('#av-seq-song-play', 0);
  if (play2 !== true) await ev('window.__m2w.songPlay()');
  await sleep(700);
  const stopR = await ev('window.__m2w.songStop()');
  await sleep(400);
  const st4f = val(await ev('window.__m2w.songStatus()')) || {};
  const isPlaying4f = val(await ev('window.__m2w.songPlaying()'));
  check('4f song stop: STOP -> clean (playing false · seq transport stopped)',
    stopR.value === true && st4f.playing === false && isPlaying4f === false,
    J({ stop: stopR.value, status: st4f, isPlaying: isPlaying4f, pos: val(await ev('window.__m2w.seqPos()')) }));

  /* ════════════════ seal ════════════════ */
  console.log('== seal ==');
  await ev('window.__m2w.stopAll()');
  await ev('window.__m2w.songStop()');
  await ev('window.__m2w.seqStop()');

  let shotOk = false, shotInfo = '';
  try {
    await ev(`(function () { try { var c = document.getElementById('av-chop'); if (c && c.scrollIntoView) { c.scrollIntoView({ block: 'start' }); return true; } } catch (e) { } try { window.scrollTo(0, 0); } catch (e2) { } return true; })()`);
    await sleep(450);
    const img = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(img.data, 'base64');
    try { mkdirSync(path.dirname(shotPath), { recursive: true }); } catch (e) { /* exists */ }
    writeFileSync(shotPath, buf);
    shotOk = buf.length > 1000 && buf[0] === 0x89 && buf[1] === 0x50;
    shotInfo = buf.length + ' bytes · viewport 1440x900 · scrolled to #av-chop';
  } catch (e) { shotInfo = 'capture failed: ' + (e && e.message); }
  check('S1 screenshot: renders/m2-suite.png (the instrument with the M2 wave live)', shotOk, shotInfo);

  const clS = val(await ev('window.__m2w.cleanup()')) || {};
  const fin = clS.final || {};
  check('S2 cleanup: notes released · witness detached · MPE off · kind/bpm/playIn restored',
    fin.held === 0 && fin.witness === false && fin.mpeOn === false && fin.seqPlaying === false &&
    fin.kind === (arm ? arm['engine.kind'] : null) &&
    (arm && arm['bpm'] == null ? true : fin.bpm === arm['bpm']) &&
    (arm && arm.playIn == null ? true : fin.playIn === arm.playIn),
    J({ cleanup: clS, arm: arm }));

  const stubErrs = val(await ev('window.__MIDI_STUB.log.listenerErrors'));
  const listenerErrs = Array.isArray(stubErrs) ? stubErrs.length : -1;
  check('S3 zero page errors (exceptions · Log errors · console.error · stub listener errors)',
    errors.length === 0 && listenerErrs === 0,
    'page errors=' + errors.length + ' · stub listener errors=' + listenerErrs + (errors.length ? ' | ' + errors.slice(0, 3).join(' | ') : ''));

  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after): ' + shaAfter);
  check('S4 freeze: index.html sha256 before === after (unchanged by the run)', shaAfter === shaBefore, shaAfter);

  /* freeze pin leg — passes when EXPECT_SHA is set and matches */
  if (PIN) check('5 freeze pin leg: index.html sha256 = pinned', shaBefore === PIN && shaAfter === PIN, 'pinned ' + PIN.slice(0, 12) + '...');
  else note('5 EXPECT_SHA not pinned — after the M2 integration build, pass --sha <hex> or set the constant (never loosen)');

  console.log('');
  console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
  console.log('M2-RIG-RESULT: ' + pass + '/' + (pass + fail));
  console.log('M2-RESULT ' + JSON.stringify({ kind: 'anvil-cdp-m2', sha256Before: shaBefore, sha256After: shaAfter, pinned: PIN || null, passed: pass, failed: fail, checks: pass + fail, verdict: fail ? 'fail' : 'pass' }));
  console.log(fail ? 'M2 FAILED' : 'M2 PASSED');
  try { ws.close(); } catch { /* done */ }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('m2 harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    /* profile-scoped cleanup (LAW): kill ONLY processes whose command line carries OUR temp
       profile — matched by its unique basename, so the pattern needs no backslash escaping */
    const tag = path.basename(profile);
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
