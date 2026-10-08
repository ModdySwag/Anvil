// cdp_s4.mjs — Anvil S4 wave suite (child sa-E's rig; WRITTEN by sa-E, RUN BY THE PARENT after the
// S4 integration build, in PARALLEL with av_proj.js / av_card.js / av_video.js / av_files_ui.js
// landing). End-to-end over raw CDP against the frozen single-file build.
//
//   node verify/cdp_s4.mjs [path-to-index.html] [--port N] [--sha <hex>] > verify/last-cdp_s4.log 2>&1
//
// WRITE-ONLY: this file is authored by sa-E and never executed by sa-E. The parent runs it after the
// integration build (index.html must contain av_proj.js + av_card.js + av_video.js + av_files_ui.js;
// body.html must carry the #av-files card + #av-files-host; app_core boots avProjInit/avCardInit/
// avVideoInit/avFilesUiInit + the guarded avCardUrlApply() hook).
//
// LAUNCH SKELETON: copied VERBATIM from cdp_deck.mjs (candidates Chrome/Edge/Brave, free-port scan,
// fresh temp --user-data-dir + profile-scoped cleanup, 1440x900 device metrics override — Edge
// headless ignores --window-size, --mute-audio, --autoplay-policy=no-user-gesture-required, ONE
// browser, explicit exit, process.on('exit') kills ONLY processes whose command line carries OUR
// temp profile) PLUS the two fake-media flags kept verbatim from the deck skeleton (harmless here).
// The URL is the plain file:// page (no ?avtest=1 — the S4 reads ride the S4 modules alone).
//
// SHA FREEZE DISCIPLINE from cdp_deck.mjs / cdp_comp.mjs: index.html is sha256'd before and after
// the run and before === after is ALWAYS enforced. EXPECT_SHA stays null until the parent pins the
// frozen S4 sha (constant below or --sha <hex>); while null the rig still enforces before === after
// and prints a pin note (never loosened).
//
// WHAT IT PROVES, in order (contract: verify/_s4_wave.md §2.5 proofs 1-10):
//   1. boot (data-av-ready + engine ctx running/48k) + the card mounted (#av-files + #av-files-host
//      + .av-files[data-av-files=1] root + avFilesUiWired=1) + all three sections' controls + the
//      module surface (avProj*/avCard*/avVideo*/avFilesUi* globals + window.__avProj/__avCard/
//      __avVideo/__avFilesUi handles + inits true).
//   2. project save via the avProjSetFs seam with a page-side fake that RECORDS every call — no real
//      picker is ever reached (window pickers are spied; the spy counter must stay 0). The written
//      .anvl text parses (magic/v/kind/state shape); build(state, meta) twice -> identical text; a
//      parse->build round-trip is a fixed point.
//   3. project open: rig pattern (cdp_bounce BUILD_PATTERN shape) + marker param save -> mutate param
//      + pattern -> avProjOpen({state}) -> param + pattern restored (avSeqSnap deep compare), applied
//      >= 1, picker skipped (opts.state seam). Foreign payloads (bad magic / v2 / wrong kind /
//      garbage + a foreign file through the fake picker) refuse honestly with nothing applied.
//   4. samples: a page-side WAV File (avWavEncode when present, else a handcrafted 44-byte-header
//      WAV) through the fake multi-open -> avProjImportSamples -> receipt added includes it, the
//      avSampleStore count advances, via "fsa".
//   5. card: build (known kind + param) -> encode/decode round-trip (kind, p, m[8]) · base64url cap
//      2048 · deterministic · url = base + #avp=<enc> (default + explicit base) · applyUrl applies
//      the encoded value via the hash (restored afterwards by cleanup) · bad enc refuses.
//   6. QR: self-check for a short ASCII string + a real URL (syndromesZero) · matrix structure
//      (size 17+4v, three finder patterns, binary rows) · deterministic matrices · >capacity refusal.
//   7. PNG: magic + bytes > 4096 + 1080x1080 · MAKE CARD click sets the preview img to a blob: URL ·
//      share absent -> download record (__avCardLast.via === "download"; the headless anchor write is
//      accepted).
//   8. video: supported honest report · pattern loaded · avVideoRecord({seconds: 2, fps: 15,
//      download: false}) POLLED (bounded) -> EBML magic 1A 45 DF A3, bytes > 8192, mime in the webm
//      chain, seconds 2, warnings [] · __avVideoLast set.
//   9. laws: screenshot renders/s4-suite.png (card live @2x) · cleanup (params/hash/notes/pattern
//      restored, sample removed, fake FS + window pickers restored) · FSA discipline (fake records
//      every call, zero real reaches) · zero page errors · sha256 before === after.
//  10. freeze pin leg: sha === pinned once EXPECT_SHA is set (null until the parent pins).
//
// RIG-OWN MATH (never planted literals where the app computes): the PNG/EBML magic compares run on
// bytes read from the actual blobs; the URL construction is checked against location.origin +
// location.pathname read live; the QR matrix is validated structurally by the rig's own pure
// checker; pattern equality is a page-side avSeqSnap deep-compare (JSON never crosses as a whole —
// only booleans and small digests do); the WAV fallback header math is harness-proven. Deferred
// emissions (UI busy flags, receipts) are read tolerantly (null-honest) per the DECK 4b lessons.
//
// SPEC NOTES (sa-E, for the first parent run — fix the EXPECTATION to the check's stated intent,
// never loosen strength):
//   (a) avProjBuild(s, { at, name }) is called with an EXPLICIT meta so determinism is provable;
//       if sa-A named the meta keys differently the first run shows it in 2d's info dump.
//   (b) avCardUrl default base is read live as location.origin + location.pathname (on file:// that
//       is "null" + pathname — the pin's own arithmetic, checked exactly).
//   (c) 7b accepts the preview img blob: URL OR a positive ui-snap string mentioning the preview
//       (the check plan grants "or via ui snap".
//   (d) The picker spies reject with NotAllowedError; the share leg hides showSaveFilePicker so
//       avDeliverDownload's anchor path runs deterministically (the headless anchor write is
//       accepted). The spy counters must stay 0 the whole run: any != 0 fails 9d loudly.
//   (e) Undetermined / deliberately not asserted here: the exact .anvl byte count (computed), the
//       precise slug text (only the anvil-project-<slug>.anvl shape), avCardShare's download file
//       NAME pattern (asserted as a bytes floor + the download record instead), MediaRecorder's
//       chosen codec pair (mime checked as "in the chain"), the UI busy-flag timing, and the
//       avVideoRecord unsupported-path stub probe (optional in the check plan).
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
   S4: the frozen sha of the rebuilt index.html is not known until build.py runs — the parent may
   fill this constant or pass --sha <hex>; the rig never loosens the before === after check. */
const EXPECT_SHA = '3f87b4d311716d97ff29cae495d78c9b013a90fdf2a2209b2affd4a70f42bbd2';
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
const profile = path.join(tmpdir(), 'anvil-s4-' + Date.now());
const DL_DIR = path.join(tmpdir(), 'anvil-s4-dl-' + Date.now());
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
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  url,
], { stdio: 'ignore', windowsHide: true });

const errors = [];

/* ---------- node-side pure helpers (extracted + unit-tested by the scratch harness) ---------- */
/* __S4_PURE_BEGIN */
/* byte-prefix magic compare (Array|Uint8Array vs number pattern) */
const magicEq = (bytes, pat) => {
  if (!bytes || !pat || typeof bytes.length !== 'number' || bytes.length < pat.length) return false;
  for (let i = 0; i < pat.length; i++) if ((bytes[i] & 255) !== pat[i]) return false;
  return true;
};
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
/* base64url (no padding) shape: url-safe charset, length % 4 !== 1, non-empty */
const b64urlOk = (s) => {
  if (typeof s !== 'string' || !s.length) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return false;
  return (s.length % 4) !== 1;
};
/* url === base + '#avp=' + enc (the pinned share-link construction) */
const hashUrlOk = (url, base, enc) => {
  if (typeof url !== 'string' || typeof base !== 'string' || typeof enc !== 'string') return false;
  return url === base + '#avp=' + enc;
};
/* the canonical 7x7 finder pattern at rows r0..r0+6 / cols c0..c0+6 of a "0"/"1" row-string matrix */
const qrFinderOk = (rows, r0, c0) => {
  if (!Array.isArray(rows)) return false;
  const P = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
  for (let r = 0; r < 7; r++) {
    const row = rows[r0 + r];
    if (typeof row !== 'string' || row.length < c0 + 7) return false;
    if (row.slice(c0, c0 + 7) !== P[r]) return false;
  }
  return true;
};
/* structural QR issues: [] means size = 17 + 4*version, every row binary + that length, three finders */
const qrStructIssues = (rows, version) => {
  const out = [];
  if (!Array.isArray(rows)) { out.push('matrix not an array'); return out; }
  if (!(Number.isInteger(version) && version >= 1)) out.push('bad version ' + version);
  const size = 17 + 4 * version;
  if (rows.length !== size) out.push('rows ' + rows.length + ' != size ' + size);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (typeof row !== 'string') { out.push('row ' + i + ' not a string'); continue; }
    if (row.length !== size) out.push('row ' + i + ' len ' + row.length + ' != ' + size);
    if (!/^[01]+$/.test(row)) out.push('row ' + i + ' not binary');
  }
  if (out.length === 0) {
    if (!qrFinderOk(rows, 0, 0)) out.push('finder TL missing');
    if (!qrFinderOk(rows, 0, size - 7)) out.push('finder TR missing');
    if (!qrFinderOk(rows, size - 7, 0)) out.push('finder BL missing');
  }
  return out;
};
/* __S4_PURE_END */

/* ---------- page-side scaffolding injected at runtime (rig-owned; never app code) ----------
   __s4w: the rig's OWN seams / legs / digests —
     arm(): baseline params + pattern + hash (cleanup restores these);
     fakeInstall(): the avProjSetFs seam fake — RECORDS every call (saves store the written text);
     fileHandle(name, src): FileSystemFileHandle-shaped picker result;
     pickSpies()/pickRestore(): window showSaveFilePicker/showOpenFilePicker proxies that COUNT any
                  real reach (must stay 0) and reject; restored after the run;
     shareHide()/shareRestore(): navigator.share/canShare hidden so the download path runs;
     leg*(): composite page-side legs (save/parse/determinism/open/foreign/sample/card/qr/png/
                  share/video) returning compact summaries — blobs, matrices and .anvl text never
                  cross CDP as whole payloads;
     patEq(ref): avSeqSnap deep-compare page-side; cleanup(): the full restore. */
const S4W_HELPERS = `window.__s4w = (function () {
  const W = { v: 1, orig: null, pat0: null, savedText: null, patch: null, enc: null, url2: null, vidP: null, vidRes: null, vidErr: null, vidT0: 0, vidDone: 0, sampleName: 'rig-s4-sample.wav', _fs: null, _fsKindAtInject: null, _spySave: null, _share: null, pickOrig: null };
  W.num = function (x) { return (typeof x === 'number' && isFinite(x)) ? x : null; };
  W.safe = function (x) { try { return JSON.parse(JSON.stringify(x)); } catch (e) { return null; } };
  W.J = function (x) { try { return JSON.stringify(x); } catch (e) { return String(x); } };
  W.light = function (x) {
    if (x === undefined || x === null) return null;
    if (typeof x !== 'object') return x;
    const out = {};
    let n = 0;
    for (const k in x) {
      if (n >= 16) break;
      let v = null;
      try { v = x[k]; } catch (e) { v = null; }
      const t = typeof v;
      if (t === 'number') { out[k] = isFinite(v) ? v : String(v); n++; }
      else if (t === 'string') { out[k] = v.length > 64 ? v.slice(0, 64) : v; n++; }
      else if (t === 'boolean' || v === null) { out[k] = v; n++; }
      else if (Array.isArray(v)) { out[k] = 'array[' + v.length + ']'; n++; }
      else if (t === 'object') { out[k] = 'obj'; n++; }
      else { out[k] = t; n++; }
    }
    return out;
  };
  W.domGet = function (id) { try { return (typeof document !== 'undefined' && document && typeof document.getElementById === 'function') ? document.getElementById(id) : null; } catch (e) { return null; } };
  W.paramGet = function (path) {
    try {
      if (typeof avParams !== 'undefined' && avParams && avParams[path] !== undefined && avParams[path] !== null) {
        const v = avParams[path];
        if (typeof v === 'number') return isFinite(v) ? v : null;
        if (typeof v === 'string') return v;
      }
    } catch (e) { }
    return null;
  };
  W.paramSet = function (path, v) {
    try { return (typeof avApplyParam === 'function') ? (avApplyParam(path, v) !== false) : false; } catch (e) { return false; }
  };
  W.markerSet = function (v) { const ret = W.paramSet('master', v); return { ret: ret === true, cur: W.paramGet('master') }; };
  W.notes = function () { try { return (typeof window.__avNotes === 'function') ? window.__avNotes() : null; } catch (e) { return null; } };
  W.notesOff = function () {
    const st = W.notes();
    const held = (st && Array.isArray(st.held)) ? st.held : [];
    for (let i = 0; i < held.length; i++) { try { avNoteUp(held[i]); } catch (e) { } }
    try { if (typeof avNoteStopAll === 'function') avNoteStopAll(); } catch (e) { }
    const st2 = W.notes();
    return { held: st2 ? st2.held.length : null };
  };
  W.hashSet = function (h) { try { location.hash = h; return String(location.hash).slice(0, 32); } catch (e) { return null; } };
  W.hashClear = function () {
    try {
      if (typeof history !== 'undefined' && history && typeof history.replaceState === 'function' && typeof location !== 'undefined') {
        history.replaceState(null, '', location.pathname + location.search);
        return String(location.hash);
      }
    } catch (e) { }
    try { location.hash = ''; } catch (e2) { }
    try { return String(location.hash); } catch (e3) { return null; }
  };
  W.fs = function () { return W._fs; };
  W.fakeInstall = function () {
    const F = { calls: [], saves: [], opens: [], queue: [] };
    F.record = function (fn, extra) {
      const rec = { fn: fn, at: Date.now() };
      if (extra) { for (const k in extra) rec[k] = extra[k]; }
      F.calls.push(rec);
      return rec;
    };
    F.save = async function (opts) {
      const rec = F.record('save', { suggestedName: (opts && opts.suggestedName) ? String(opts.suggestedName) : null });
      const entry = { name: rec.suggestedName || 'unnamed', text: null, bytes: 0, closed: false, at: Date.now() };
      F.saves.push(entry);
      return {
        name: entry.name,
        createWritable: async function () {
          return {
            write: function (data) {
              try {
                if (typeof data === 'string') entry.text = data;
                else if (data && typeof data.byteLength === 'number') {
                  const u = new Uint8Array(data.buffer ? data.buffer : data, data.byteOffset || 0, data.byteLength);
                  let s = '';
                  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
                  entry.text = s;
                }
              } catch (e) { }
              return Promise.resolve();
            },
            close: function () { entry.closed = true; entry.bytes = entry.text ? entry.text.length : 0; return Promise.resolve(); },
          };
        },
      };
    };
    F.open = async function (opts) {
      const rec = F.record('open', { multiple: !!(opts && opts.multiple) });
      const list = [];
      while (F.queue.length) list.push(F.queue.shift());
      rec.count = list.length;
      F.opens.push({ at: Date.now(), multiple: !!(opts && opts.multiple), count: list.length });
      return list;
    };
    W._fs = F;
    let inst = false;
    try {
      inst = (typeof avProjSetFs === 'function') && (avProjSetFs({ showOpenFilePicker: F.open, showSaveFilePicker: F.save }) === true);
    } catch (e) { }
    try { const ps = W.projState(); W._fsKindAtInject = ps ? ps.fsKind : null; } catch (e) { W._fsKindAtInject = null; }
    return { ok: inst, calls: F.calls.length, fsKind: W._fsKindAtInject };
  };
  W.fileHandle = function (name, src) {
    let file = null;
    if (typeof File === 'function' && src instanceof File) file = src;
    else if (typeof File === 'function') file = new File([String(src == null ? '' : src)], name, { type: 'application/json' });
    else file = { name: name, text: async function () { return String(src == null ? '' : src); } };
    return { name: name, getFile: async function () { return file; } };
  };
  W.pickSpies = function () {
    const out = { ok: false, save: false, open: false };
    try {
      if (typeof window === 'undefined') return out;
      W.pickOrig = { save: window.showSaveFilePicker, open: window.showOpenFilePicker };
      window.__s4reach = { save: 0, open: 0 };
      const mk = function (kind) {
        return function () {
          try { window.__s4reach[kind] += 1; } catch (e) { }
          let err = null;
          try { err = new Error('rig-blocked real picker'); err.name = 'NotAllowedError'; } catch (e) { err = new Error('rig-blocked'); }
          return Promise.reject(err);
        };
      };
      W._spySave = mk('save');
      window.showSaveFilePicker = W._spySave;
      window.showOpenFilePicker = mk('open');
      out.ok = true;
      out.save = typeof W.pickOrig.save === 'function';
      out.open = typeof W.pickOrig.open === 'function';
    } catch (e) { out.err = String((e && e.message) || e); }
    return out;
  };
  W.pickHideSave = function () { try { W._spySave = window.showSaveFilePicker; window.showSaveFilePicker = undefined; return true; } catch (e) { return false; } };
  W.pickUnhideSave = function () { try { window.showSaveFilePicker = W._spySave || undefined; return true; } catch (e) { return false; } };
  W.pickRestore = function () {
    const out = { ok: true, save: false, open: false };
    try {
      if (typeof window === 'undefined') { out.ok = false; out.why = 'no window'; return out; }
      if (!W.pickOrig) { out.ok = false; out.why = 'no orig saved'; return out; }
      if (typeof W.pickOrig.save === 'function') window.showSaveFilePicker = W.pickOrig.save;
      else { try { delete window.showSaveFilePicker; } catch (e) { window.showSaveFilePicker = undefined; } }
      if (typeof W.pickOrig.open === 'function') window.showOpenFilePicker = W.pickOrig.open;
      else { try { delete window.showOpenFilePicker; } catch (e) { window.showOpenFilePicker = undefined; } }
      out.save = (typeof window.showSaveFilePicker === typeof W.pickOrig.save);
      out.open = (typeof window.showOpenFilePicker === typeof W.pickOrig.open);
    } catch (e) { out.ok = false; out.err = String((e && e.message) || e); }
    return out;
  };
  W.reach = function () { try { return window.__s4reach ? { save: window.__s4reach.save, open: window.__s4reach.open } : null; } catch (e) { return null; } };
  W.shareHide = function () {
    try {
      if (typeof navigator === 'undefined') return false;
      W._share = { had: ('share' in navigator) ? navigator.share : null, hadCan: ('canShare' in navigator) ? navigator.canShare : null };
      try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true, writable: true }); } catch (e) { try { navigator.share = undefined; } catch (e2) { } }
      try { Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true, writable: true }); } catch (e) { }
      return true;
    } catch (e) { return false; }
  };
  W.shareRestore = function () { try { if (typeof navigator === 'undefined') return false; delete navigator.share; delete navigator.canShare; return true; } catch (e) { return false; } };
  W.patSnap = function () { try { return (typeof avSeqSnap === 'function') ? avSeqSnap() : null; } catch (e) { return null; } };
  W.patEq = function (ref) { try { const cur = W.patSnap(); if (!cur || !ref) return false; return W.J(cur) === W.J(ref); } catch (e) { return false; } };
  W.patSave0 = function () { W.pat0 = W.patSnap(); return !!W.pat0; };
  W.rigPattern = function (name, variant) {
    const mk = function (on, note, vel) { return { on: on ? 1 : 0, note: note, vel: vel, gate: 0.5, slide: 0, accent: 0, oct: 0, prob: 100, cond: '', ratchet: 1, micro: 0 }; };
    const track = function (hits, note, vel) {
      const steps = [];
      for (let i = 0; i < 64; i++) steps.push(mk(0, note, vel));
      for (let i = 0; i < hits.length; i++) if (hits[i] < 64) steps[hits[i]] = mk(1, note, vel);
      return { len: 16, speed: 1, mute: 0, steps: steps };
    };
    const v = variant ? 1 : 0;
    const hits = v === 0 ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 2, 4, 6, 8, 10, 12, 14];
    const late = v === 0 ? [12, 13, 14, 15] : [8, 9, 10, 11];
    return { v: 1, name: name || (v === 0 ? 'RIG PAT 1' : 'RIG PAT 2'), bpm: 120, grid: '16', swing: 50, rng: 0x12345678,
      tracks: [ track(hits, v === 0 ? 'c3' : 'd3', 0.9), track(hits, v === 0 ? 'e3' : 'f3', 0.8), track(hits, v === 0 ? 'g3' : 'a3', 0.8), track(late, v === 0 ? 'c4' : 'd4', 0.9) ],
      plocks: [] };
  };
  W.patLoad = function (name, variant) {
    try {
      const ok = (typeof avSeqLoad === 'function') ? (avSeqLoad(W.rigPattern(name, variant)) === true) : false;
      return { ok: ok, name: (typeof avSeqSnap === 'function') ? avSeqSnap().name : null };
    } catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
  };
  W.patNoteCount = function () {
    try {
      const s = W.patSnap();
      if (!s || !Array.isArray(s.tracks)) return null;
      let n = 0;
      for (let t = 0; t < s.tracks.length; t++) {
        const steps = (s.tracks[t] && s.tracks[t].steps) || [];
        for (let i = 0; i < steps.length; i++) if (steps[i] && steps[i].on) n++;
      }
      return n;
    } catch (e) { return null; }
  };
  W.craftWav = function (sr, frames) {
    const dataBytes = frames * 4;
    const buf = new ArrayBuffer(44 + dataBytes);
    const b = new Uint8Array(buf);
    const dv = new DataView(buf);
    const tag = function (o, s) { for (let i = 0; i < 4; i++) b[o + i] = s.charCodeAt(i); };
    tag(0, 'RIFF'); dv.setUint32(4, 36 + dataBytes, true); tag(8, 'WAVE');
    tag(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
    tag(36, 'data'); dv.setUint32(40, dataBytes, true);
    for (let i = 0; i < frames; i++) {
      const v = Math.sin(2 * Math.PI * 440 * i / sr) * 0.5 * (1 - i / (frames || 1));
      const x = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
      dv.setInt16(44 + i * 4, x, true); dv.setInt16(46 + i * 4, x, true);
    }
    return buf;
  };
  W.wavFile = function (name) {
    const sr = 48000, frames = 12000;
    let via = 'craft', buf = null;
    try {
      if (typeof avWavEncode === 'function') {
        const l = new Float32Array(frames), rr = new Float32Array(frames);
        for (let i = 0; i < frames; i++) { const v = Math.sin(2 * Math.PI * 440 * i / sr) * 0.5 * (1 - i / frames); l[i] = v; rr[i] = v; }
        buf = avWavEncode({ l: l, r: rr, sr: sr, bits: 16, dither: false });
        via = buf ? 'avWavEncode' : 'craft';
      }
    } catch (e) { via = 'craft'; buf = null; }
    if (!buf) buf = W.craftWav(sr, frames);
    const file = new File([buf], name, { type: 'audio/wav' });
    return { file: file, via: via, bytes: buf.byteLength, sr: sr, frames: frames };
  };
  W.sampleCount = function () {
    try {
      const S = (typeof window !== 'undefined') ? window.__avSample : null;
      const s = (S && typeof S.snap === 'function') ? S.snap() : null;
      return s ? s.count : null;
    } catch (e) { return null; }
  };
  W.sampleRemoveByName = function (name) {
    try {
      const S = (typeof window !== 'undefined') ? window.__avSample : null;
      if (!S || typeof S.snap !== 'function' || typeof S.remove !== 'function') return { removed: false, why: 'no store' };
      const s = S.snap();
      const list = (s && Array.isArray(s.entries)) ? s.entries : [];
      let id = null;
      for (let i = 0; i < list.length; i++) if (list[i] && list[i].name === name) { id = list[i].id; break; }
      if (!id) return { removed: false, why: 'not found' };
      S.remove(id);
      return { removed: true, id: id, count: S.snap().count };
    } catch (e) { return { removed: false, why: String((e && e.message) || e) }; }
  };
  W.projState = function () { try { const P = (typeof window !== 'undefined') ? window.__avProj : null; return (P && typeof P.state === 'function') ? W.light(P.state()) : null; } catch (e) { return null; } };
  W.fsRecap = function () {
    const F = W._fs || { calls: [], saves: [], opens: [] };
    return {
      calls: F.calls.length, saves: F.saves.length, opens: F.opens.length,
      saveNames: F.saves.slice(0, 4).map(function (s) { return s.name; }),
      closed: F.saves.slice(0, 4).map(function (s) { return s.closed === true; }),
      kinds: F.calls.slice(0, 12).map(function (c) { return c.fn; }),
      reach: W.reach(), fsKindAtInject: W._fsKindAtInject || null,
    };
  };
  W.arm = function () {
    W.orig = {
      master: W.paramGet('master'), cutoff: W.paramGet('filter.cutoff'), kind: W.paramGet('engine.kind'),
      pat: W.patSnap(), hash: (typeof location !== 'undefined') ? String(location.hash) : null,
    };
    return { master: W.orig.master, cutoff: W.orig.cutoff, kind: W.orig.kind, pat: !!W.orig.pat, hash: W.orig.hash };
  };
  W.card = function () {
    try {
      const host = W.domGet('av-files-host');
      const card = W.domGet('av-files');
      let root = null;
      try { root = (typeof document !== 'undefined') ? document.querySelector('.av-files[data-av-files="1"]') : null; } catch (e) { root = null; }
      let wired = false;
      try { wired = !!(host && host.dataset && host.dataset.avFilesUiWired === '1') || !!(card && card.dataset && card.dataset.avFilesUiWired === '1'); } catch (e) { }
      return { host: !!host, card: !!card, root: !!root, wired: wired, attr: root ? root.getAttribute('data-av-files') : null };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  };
  W.ctrl = function () {
    const ids = ['av-files-save', 'av-files-open', 'av-files-samples', 'av-files-pstat', 'av-files-card-make', 'av-files-card-copy', 'av-files-card-png', 'av-files-card-preview', 'av-files-cstat', 'av-files-video-run', 'av-files-video-preview', 'av-files-vstat', 'av-files-status'];
    const out = { present: {}, tags: {}, buttons: 0, missing: [], img: false, video: false, videoMuted: false };
    try {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const el = W.domGet(id);
        out.present[id] = !!el;
        if (!el) { out.missing.push(id); continue; }
        const tag = String(el.tagName || '');
        out.tags[id] = tag;
        const role = (el.getAttribute && el.getAttribute('role')) || '';
        if (tag === 'BUTTON' || tag === 'A' || role === 'button' || String(el.className || '').indexOf('av-btn') >= 0) out.buttons += 1;
        if (id === 'av-files-card-preview') { out.img = (tag === 'IMG'); out.imgSrc0 = (typeof el.src === 'string') ? el.src.slice(0, 48) : null; }
        if (id === 'av-files-video-preview') { out.video = (tag === 'VIDEO'); out.videoMuted = (el.muted === true) || !!(el.hasAttribute && el.hasAttribute('muted')); }
      }
    } catch (e) { out.err = String((e && e.message) || e); }
    return out;
  };
  W.surface = function () {
    const g = function (n) { return typeof window[n]; };
    const projFns = ['avProjInit', 'avProjSetFs', 'avProjBuild', 'avProjParse', 'avProjSave', 'avProjOpen', 'avProjImportSamples', 'avProjClasses'];
    const cardFns = ['avCardInit', 'avCardBuild', 'avCardEncode', 'avCardDecode', 'avCardUrl', 'avCardApplyUrl', 'avCardQr', 'avCardQrSelfCheck', 'avCardPng', 'avCardShare', 'avCardCopyLink', 'avCardClasses'];
    const vidFns = ['avVideoInit', 'avVideoSupported', 'avVideoRenderFrame', 'avVideoRecord', 'avVideoDownload', 'avVideoClasses'];
    const uiFns = ['avFilesUiInit', 'avFilesUiSync', 'avFilesUiSnap', 'avFilesUiClasses'];
    const missing = projFns.concat(cardFns, vidFns, uiFns).filter(function (n) { return g(n) !== 'function'; });
    const P = window.__avProj || null, C = window.__avCard || null, V = window.__avVideo || null, U = window.__avFilesUi || null;
    const pmissing = ['init', 'setFs', 'build', 'parse', 'save', 'open', 'samples', 'state'].filter(function (n) { return !(P && typeof P[n] === 'function'); });
    const cmissing = ['init', 'build', 'encode', 'decode', 'url', 'applyUrl', 'qr', 'qrSelfCheck', 'png', 'share', 'copy', 'state'].filter(function (n) { return !(C && typeof C[n] === 'function'); });
    const vmissing = ['init', 'supported', 'record', 'renderFrame', 'download', 'state'].filter(function (n) { return !(V && typeof V[n] === 'function'); });
    const umissing = ['state', 'sync', 'snap', 'init'].filter(function (n) { return !(U && typeof U[n] === 'function'); });
    const init = { proj: null, card: null, video: null, ui: null, errs: [] };
    try { init.proj = (typeof avProjInit === 'function') ? avProjInit() : null; } catch (e) { init.errs.push('proj:' + String((e && e.message) || e)); }
    try { init.card = (typeof avCardInit === 'function') ? avCardInit() : null; } catch (e) { init.errs.push('card:' + String((e && e.message) || e)); }
    try { init.video = (typeof avVideoInit === 'function') ? avVideoInit() : null; } catch (e) { init.errs.push('video:' + String((e && e.message) || e)); }
    try { init.ui = (typeof avFilesUiInit === 'function') ? avFilesUiInit() : null; } catch (e) { init.errs.push('ui:' + String((e && e.message) || e)); }
    const cls = { proj: null, card: null, vid: null, ui: null };
    try { cls.proj = (typeof avProjClasses === 'function') ? (avProjClasses() || []).length : null; } catch (e) { cls.proj = 'threw'; }
    try { cls.card = (typeof avCardClasses === 'function') ? (avCardClasses() || []).length : null; } catch (e) { cls.card = 'threw'; }
    try { cls.vid = (typeof avVideoClasses === 'function') ? (avVideoClasses() || []).length : null; } catch (e) { cls.vid = 'threw'; }
    try { cls.ui = (typeof avFilesUiClasses === 'function') ? (avFilesUiClasses() || []).length : null; } catch (e) { cls.ui = 'threw'; }
    let uiState = null;
    try { uiState = (U && typeof U.state === 'function') ? W.light(U.state()) : null; } catch (e) { uiState = 'threw'; }
    let uiSnap = null;
    try {
      const s = (U && typeof U.snap === 'function') ? U.snap() : null;
      uiSnap = s && typeof s === 'object' ? { isObj: true, keys: Object.keys(s).slice(0, 24) } : (s === null ? null : { isObj: false });
    } catch (e) { uiSnap = 'threw'; }
    const projState = W.projState();
    return {
      missing: missing, pmissing: pmissing, cmissing: cmissing, vmissing: vmissing, umissing: umissing,
      hasProj: !!P, hasCard: !!C, hasVid: !!V, hasUi: !!U,
      versions: { proj: P ? P.version : 'none', card: C ? C.version : 'none', vid: V ? V.version : 'none', ui: U ? U.version : 'none' },
      init: init, classes: cls, uiState: uiState, uiSnap: uiSnap, projState: projState,
    };
  };
  W.legP1 = async function (name) {
    const out = {};
    try {
      if (typeof avProjSave !== 'function') { out.why = 'avProjSave missing'; return out; }
      const r = await avProjSave({ name: name });
      out.ok = !!(r && r.ok === true);
      out.error = (r && r.error) ? String(r.error).slice(0, 120) : null;
      out.via = (r && typeof r.via === 'string') ? r.via : null;
      out.name = (r && typeof r.name === 'string') ? r.name : null;
      out.bytes = W.num(r && r.bytes);
      out.warnLen = (r && Array.isArray(r.warnings)) ? r.warnings.length : null;
      const F = W._fs;
      if (F && F.saves.length) {
        const last = F.saves[F.saves.length - 1];
        out.sugg = last.name;
        out.textLen = last.text ? last.text.length : 0;
        out.closed = last.closed === true;
        W.savedText = last.text || null;
      }
      out.fakeSaveCount = F ? F.saves.length : -1;
      out.lastSave = W.safe(window.__avProjLastSave || null);
    } catch (e) { out.err = String((e && e.message) || e); }
    return out;
  };
  W.legP2 = function () {
    const out = {};
    try {
      if (!W.savedText) { out.why = 'no saved text'; return out; }
      out.textLen = W.savedText.length;
      const p = avProjParse(W.savedText);
      out.ok = !!(p && p.ok === true);
      out.error = (p && p.error) ? String(p.error).slice(0, 120) : null;
      const pr = (p && p.project) || {};
      out.magic = pr.magic; out.v = pr.v; out.app = pr.app; out.kind = pr.kind;
      out.atType = typeof pr.at; out.nameType = typeof pr.name;
      const s = pr.state;
      out.stateObj = !!(s && typeof s === 'object');
      if (out.stateObj) {
        out.stateV = s.v;
        out.stateName = (s.name === null || typeof s.name === 'string') ? s.name : 'BADTYPE';
        out.stateSavedAt = (typeof s.savedAt === 'number' && isFinite(s.savedAt)) ? s.savedAt : null;
        out.seqObj = !!(s.seq && typeof s.seq === 'object');
        out.seqKeys = (s.seq && typeof s.seq === 'object') ? Object.keys(s.seq).slice(0, 8) : null;
        out.hasPattern = !!(s.seq && s.seq.pattern && typeof s.seq.pattern === 'object');
        out.paramsObj = !!(s.params && typeof s.params === 'object');
        out.paramsLen = (s.params && typeof s.params === 'object') ? Object.keys(s.params).length : null;
        out.macrosLen = (s.mod && Array.isArray(s.mod.macros)) ? s.mod.macros.length : null;
        out.prefsObj = !!(s.prefs && typeof s.prefs === 'object');
      }
    } catch (e) { out.err = String((e && e.message) || e); }
    return out;
  };
  W.legDet = function () {
    const out = {};
    try {
      if (typeof avSessionCapture !== 'function' || typeof avProjBuild !== 'function') { out.why = 'missing modules'; return out; }
      const s = avSessionCapture();
      const meta = { at: '2026-01-02T03:04:05.000Z', name: 'RIG DET' };
      const b1 = avProjBuild(s, meta);
      const b2 = avProjBuild(s, meta);
      out.ok1 = !!(b1 && b1.ok === true && typeof b1.text === 'string');
      out.ok2 = !!(b2 && b2.ok === true && typeof b2.text === 'string');
      out.len1 = out.ok1 ? b1.text.length : null;
      out.name1 = (b1 && b1.name !== undefined) ? String(b1.name).slice(0, 64) : null;
      out.same12 = !!(out.ok1 && out.ok2 && b1.text === b2.text);
      out.hasAt = !!(out.ok1 && b1.text.indexOf('"at":"2026-01-02T03:04:05.000Z"') >= 0);
      if (out.ok1 && typeof avProjParse === 'function') {
        const p = avProjParse(b1.text);
        out.p1ok = !!(p && p.ok === true && p.project && p.project.state);
        if (out.p1ok) {
          const b3 = avProjBuild(p.project.state, meta);
          out.ok3 = !!(b3 && b3.ok === true && typeof b3.text === 'string');
          out.same13 = !!(out.ok3 && b3.text === b1.text);
        }
      }
    } catch (e) { out.err = String((e && e.message) || e); }
    return out;
  };
  W.leg3a = function () {
    const out = {};
    try {
      out.pl = W.patLoad('RIG PAT 1', 0);
      out.mk = W.markerSet(0.42);
      out.pat0 = W.patSave0();
      try { W.st0 = avSessionCapture(); out.st0Ok = !!(W.st0 && typeof W.st0 === 'object'); } catch (e) { out.st0Err = String((e && e.message) || e); }
      out.noteCount = W.patNoteCount();
    } catch (e) { out.err = String((e && e.message) || e); }
    return out;
  };
  W.legOpen = async function () {
    const out = {};
    try {
      const s = await avProjSave({ name: 'RIG OPEN SAVE' });
      out.saveOk = !!(s && s.ok === true);
      out.saveVia = (s && typeof s.via === 'string') ? s.via : null;
      const F = W._fs;
      const last = (F && F.saves.length) ? F.saves[F.saves.length - 1] : null;
      const text = last ? last.text : null;
      out.savedLen = text ? text.length : null;
      if (!text) { out.why = 'no text'; return out; }
      const p = avProjParse(text);
      out.parse = !!(p && p.ok === true);
      if (!out.parse) { out.why = 'parse refused'; return out; }
      const st = p.project.state;
      try { avApplyParam('master', 0.9); } catch (e) { }
      out.mutMaster = W.paramGet('master');
      out.mutLoad = (typeof avSeqLoad === 'function') ? (avSeqLoad(W.rigPattern('RIG PAT 2', 1)) === true) : false;
      out.mutName = (typeof avSeqSnap === 'function') ? avSeqSnap().name : null;
      out.opensBefore = F ? F.opens.length : -1;
      let r = null;
      try { r = await avProjOpen({ state: st }); } catch (e) { out.openErr = String((e && e.message) || e); }
      out.r = W.safe(r);
      out.opensAfter = F ? F.opens.length : -1;
      out.master = W.paramGet('master');
      out.patBack = W.patEq(W.pat0);
      out.patName = (typeof avSeqSnap === 'function') ? avSeqSnap().name : null;
      out.noteCount = W.patNoteCount();
    } catch (e) { out.err = String((e && e.message) || e); }
    return out;
  };
  W.legForeign = async function () {
    const out = { parses: [] };
    try {
      const bads = ['{"magic":"nope","v":1,"app":"anvil","kind":"project","state":{}}', '{"magic":"anvl","v":2,"app":"anvil","kind":"project","state":{}}', '{"magic":"anvl","v":1,"app":"anvil","kind":"preset","state":{}}', 'definitely not json {{{'];
      for (let i = 0; i < bads.length; i++) {
        let ok = null;
        try { const p = avProjParse(bads[i]); ok = !!p.ok; } catch (e) { ok = 'threw'; }
        out.parses.push(ok);
      }
      const before = W.paramGet('master');
      W._fs.queue.push(W.fileHandle('foreign.anvl', bads[0]));
      let r = null;
      try { r = await avProjOpen(); } catch (e) { out.openErr = String((e && e.message) || e); }
      out.open = W.safe(r);
      out.masterSame = W.paramGet('master') === before;
      out.patSame = W.patEq(W.pat0);
      out.opens = W._fs.opens.length;
    } catch (e) { out.err = String((e && e.message) || e); }
    return out;
  };
  W.legSample = async function () {
    const out = {};
    try {
      const wf = W.wavFile(W.sampleName);
      out.wavVia = wf.via; out.fileBytes = wf.bytes;
      out.count0 = W.sampleCount();
      W._fs.queue.push(W.fileHandle(W.sampleName, wf.file));
      out.opensBefore = W._fs.opens.length;
      let r = null;
      try { r = await avProjImportSamples(); } catch (e) { out.err = String((e && e.message) || e); }
      out.r = W.safe(r);
      out.added = (r && Array.isArray(r.added)) ? r.added.slice(0, 8) : null;
      out.via = (r && typeof r.via === 'string') ? r.via : null;
      out.opensAfter = W._fs.opens.length;
      out.count1 = W.sampleCount();
    } catch (e) { out.err = String((e && e.message) || e); }
    return out;
  };
  W.legCard = function () {
    const out = {};
    try {
      if (typeof avApplyParam === 'function') { avApplyParam('engine.kind', 'va'); avApplyParam('filter.cutoff', 1234); }
      out.kindMirror = W.paramGet('engine.kind');
      out.cutMirror = W.paramGet('filter.cutoff');
      const b = avCardBuild();
      out.buildOk = !!(b && b.ok === true);
      out.buildErr = (b && b.error) ? String(b.error).slice(0, 120) : null;
      if (!out.buildOk || !b.patch) return out;
      const p = b.patch;
      W.patch = W.safe(p);
      out.nType = typeof p.n; out.nLen = (typeof p.n === 'string') ? p.n.length : null;
      out.k = p.k; out.kType = typeof p.k;
      out.mLen = Array.isArray(p.m) ? p.m.length : null;
      out.mOk = Array.isArray(p.m) ? p.m.every(function (v) { return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1; }) : false;
      out.pKeys = (p.p && typeof p.p === 'object') ? Object.keys(p.p).slice(0, 300) : null;
      out.pLen = out.pKeys ? out.pKeys.length : null;
      out.sorted = out.pKeys ? out.pKeys.every(function (k, i) { return i === 0 || out.pKeys[i - 1] <= k; }) : false;
      out.cut = (p.p && typeof p.p === 'object') ? p.p['filter.cutoff'] : undefined;
      out.pFiniteOk = false;
      if (p.p && typeof p.p === 'object') {
        out.pFiniteOk = true;
        const ks = Object.keys(p.p);
        for (let i = 0; i < ks.length; i++) {
          const v2 = p.p[ks[i]]; const t = typeof v2;
          if (t === 'number') { if (!isFinite(v2)) out.pFiniteOk = false; }
          else if (t !== 'boolean') { out.pFiniteOk = false; }
        }
      }
      const e1 = avCardEncode(p);
      const e2 = avCardEncode(p);
      out.encOk = !!(e1 && e1.ok === true && typeof e1.enc === 'string');
      out.enc = out.encOk ? e1.enc : null;
      out.encLen = out.enc ? out.enc.length : null;
      out.encDet = !!(out.enc && e2 && e2.ok === true && e2.enc === out.enc);
      W.enc = out.enc;
      if (out.enc) {
        const d = avCardDecode(out.enc);
        out.decOk = !!(d && d.ok === true && d.patch);
        if (out.decOk) {
          out.decKind = d.patch.k;
          out.decCut = (d.patch.p && typeof d.patch.p === 'object') ? d.patch.p['filter.cutoff'] : undefined;
          out.decMlen = Array.isArray(d.patch.m) ? d.patch.m.length : null;
          out.decMEq = W.J(W.safe(d.patch.m)) === W.J(p.m);
          out.decPEq = W.J(W.safe(d.patch.p)) === W.J(p.p);
        }
        const u = avCardUrl(p);
        out.urlOk = !!(u && u.ok === true && typeof u.url === 'string');
        out.url = out.urlOk ? u.url : null;
        out.base = (typeof location !== 'undefined') ? (location.origin + location.pathname) : null;
        const u2 = avCardUrl(p, 'https://moddys.net/anvil.html');
        out.url2 = (u2 && u2.ok === true && typeof u2.url === 'string') ? u2.url : null;
        out.base2 = 'https://moddys.net/anvil.html';
        W.url2 = out.url2;
      }
      out.encErr = (e1 && e1.error) ? String(e1.error).slice(0, 120) : null;
    } catch (e) { out.err = String((e && e.message) || e); }
    return out;
  };
  W.legApply = async function () {
    const out = {};
    try {
      if (typeof avApplyParam === 'function') { avApplyParam('filter.cutoff', 777); }
      out.pre = W.paramGet('filter.cutoff');
      out.enc = W.enc;
      if (!out.enc) { out.why = 'no enc'; return out; }
      out.hashSet = W.hashSet('#avp=' + out.enc);
      let r = null;
      try { r = await avCardApplyUrl(); } catch (e) { out.err = String((e && e.message) || e); }
      out.r = W.safe(r);
      out.cut = W.paramGet('filter.cutoff');
      out.kind = W.paramGet('engine.kind');
    } catch (e) { out.err2 = String((e && e.message) || e); }
    return out;
  };
  W.legBadEnc = async function () {
    const out = {};
    try {
      const before = W.paramGet('filter.cutoff');
      W.hashSet('#avp=not~valid~b64');
      let r = null;
      try { r = await avCardApplyUrl(); } catch (e) { out.err = String((e && e.message) || e); }
      out.r = W.safe(r);
      out.same = W.paramGet('filter.cutoff') === before;
      let d = null;
      try { d = avCardDecode('not~valid~b64'); } catch (e) { out.decErr = String((e && e.message) || e); }
      out.dec = W.safe(d);
      W.hashClear();
      let r2 = null;
      try { r2 = await avCardApplyUrl(); } catch (e) { out.err2 = String((e && e.message) || e); }
      out.r2 = W.safe(r2);
      out.same2 = W.paramGet('filter.cutoff') === before;
    } catch (e) { out.err3 = String((e && e.message) || e); }
    return out;
  };
  W.legQr = function (t1, t2) {
    const out = {};
    try {
      let c1 = null, c2 = null;
      try { c1 = avCardQrSelfCheck(t1); } catch (e) { out.c1Err = String((e && e.message) || e); }
      try { c2 = avCardQrSelfCheck(t2); } catch (e) { out.c2Err = String((e && e.message) || e); }
      out.c1 = W.safe(c1); out.c2 = W.safe(c2);
      const q1 = avCardQr(t1);
      out.q1Ok = !!(q1 && q1.ok === true);
      if (out.q1Ok) {
        out.version = q1.version; out.size = q1.size;
        out.rows = Array.isArray(q1.matrix) ? q1.matrix.length : null;
        out.matrix = Array.isArray(q1.matrix) ? q1.matrix.slice(0, 90).map(function (row) { return String(row).slice(0, 90); }) : null;
        out.detLen = W.J(q1.matrix).length;
        const q2 = avCardQr(t1);
        out.same = !!(q2 && q2.ok === true && W.J(q2.matrix) === W.J(q1.matrix));
      }
      let big = null;
      try { big = avCardQr(new Array(601).join('A')); } catch (e) { out.bigThrew = String((e && e.message) || e); }
      out.big = big ? { ok: big.ok === true, error: (typeof big.error === 'string') ? big.error.slice(0, 80) : null } : null;
    } catch (e) { out.err = String((e && e.message) || e); }
    return out;
  };
  W.legPng = async function () {
    const out = {};
    try {
      if (!W.patch) { out.why = 'no patch'; return out; }
      const r = await avCardPng(W.patch, W.url2 || undefined);
      out.ok = !!(r && r.ok === true);
      out.error = (r && r.error) ? String(r.error).slice(0, 120) : null;
      out.bytes = W.num(r && r.bytes);
      out.w = W.num(r && r.w); out.h = W.num(r && r.h);
      out.blobSize = (r && r.blob && typeof r.blob.size === 'number') ? r.blob.size : null;
      if (r && r.blob && typeof r.blob.arrayBuffer === 'function') {
        const u = new Uint8Array(await r.blob.arrayBuffer());
        out.magic = [u[0], u[1], u[2], u[3], u[4], u[5], u[6], u[7]];
        out.arrayBytes = u.length;
      }
    } catch (e) { out.err = String((e && e.message) || e); }
    return out;
  };
  W.previewInfo = function () {
    const out = { present: false, src: null, isBlob: false, snap: null };
    try {
      const el = W.domGet('av-files-card-preview');
      out.present = !!el;
      if (el) {
        out.tag = String(el.tagName || '');
        out.src = (typeof el.src === 'string') ? el.src.slice(0, 48) : null;
        out.isBlob = !!(out.src && out.src.indexOf('blob:') === 0);
      }
      try {
        const U = window.__avFilesUi;
        if (U && typeof U.snap === 'function') { const s = U.snap(); out.snap = (s && typeof s === 'object') ? W.J(s).slice(0, 400) : String(s); }
      } catch (e) { out.snapErr = String((e && e.message) || e); }
    } catch (e) { out.err = String((e && e.message) || e); }
    return out;
  };
  W.legShare = async function () {
    const out = {};
    try {
      let r = null;
      try { r = await avCardShare(); } catch (e) { out.err = String((e && e.message) || e); }
      out.ok = !!(r && r.ok === true);
      out.error = (r && r.error) ? String(r.error).slice(0, 120) : null;
      out.via = (r && typeof r.via === 'string') ? r.via : null;
      out.last = W.safe(window.__avCardLast || null);
      out.deliver = W.safe(window.__avDeliverLastDownload || null);
      out.shareType = (typeof navigator !== 'undefined') ? typeof navigator.share : 'n/a';
    } catch (e) { out.err2 = String((e && e.message) || e); }
    return out;
  };
  W.vidSupported = function () {
    try {
      if (typeof avVideoSupported !== 'function') return { missing: true };
      return W.safe(avVideoSupported());
    } catch (e) { return { threw: String((e && e.message) || e) }; }
  };
  W.vidStart = function () {
    W.vidRes = null; W.vidErr = null; W.vidDone = 0; W.vidT0 = Date.now(); W.vidP = null;
    try {
      if (typeof avVideoRecord !== 'function') { W.vidErr = 'avVideoRecord missing'; return { state: 'error' }; }
      W.vidP = avVideoRecord({ seconds: 2, fps: 15, download: false }).then(function (r) { W.vidRes = r; W.vidDone = Date.now(); return r; }, function (e) { W.vidErr = String((e && e.message) || e); return null; });
      return { state: 'started' };
    } catch (e) { W.vidErr = String((e && e.message) || e); return { state: 'error' }; }
  };
  W.vidSnap = async function () {
    if (W.vidErr) return { state: 'error', err: W.vidErr };
    if (!W.vidP) return { state: 'idle' };
    if (!W.vidRes) return { state: 'running', ms: Date.now() - W.vidT0 };
    const r = W.vidRes;
    const out = { state: 'done', ms: W.vidDone - W.vidT0, ok: r.ok === true, error: (r.error) ? String(r.error).slice(0, 120) : null,
      seconds: W.num(r.seconds), bytes: W.num(r.bytes), mime: (typeof r.mime === 'string') ? r.mime : null,
      warnings: Array.isArray(r.warnings) ? r.warnings.slice(0, 8).map(String) : null,
      refused: Array.isArray(r.refused) ? r.refused.slice(0, 8).map(String) : null };
    try {
      if (r.blob && typeof r.blob.arrayBuffer === 'function') {
        const u = new Uint8Array(await r.blob.arrayBuffer());
        out.magic = [u[0], u[1], u[2], u[3]];
        out.fileBytes = u.length;
      }
    } catch (e) { out.magicErr = String((e && e.message) || e); }
    return out;
  };
  W.lastVideo = function () { try { return W.safe(window.__avVideoLast || null); } catch (e) { return null; } };
  W.legVideo = function () {
    const out = {};
    out.pl = W.patLoad('RIG PAT 1', 0);
    out.noteCount = W.patNoteCount();
    out.vs = W.vidStart();
    return out;
  };
  W.cleanup = function () {
    const out = { steps: [] };
    const orig = W.orig || {};
    try { W.notesOff(); } catch (e) { out.notesErr = String((e && e.message) || e); }
    try {
      if (typeof avApplyParam === 'function') {
        if (typeof orig.master === 'number') avApplyParam('master', orig.master);
        if (typeof orig.kind === 'string') avApplyParam('engine.kind', orig.kind);
        if (typeof orig.cutoff === 'number') avApplyParam('filter.cutoff', orig.cutoff);
      }
      out.params = { master: W.paramGet('master'), kind: W.paramGet('engine.kind'), cutoff: W.paramGet('filter.cutoff') };
    } catch (e) { out.paramErr = String((e && e.message) || e); }
    try { out.patRestored = !!(orig.pat && typeof avSeqLoad === 'function' && avSeqLoad(orig.pat) === true); } catch (e) { out.patErr = String((e && e.message) || e); }
    try { out.patEqOrig = !!(orig.pat && W.patEq(orig.pat)); } catch (e) { out.patEqErr = String((e && e.message) || e); }
    try { out.hash = W.hashClear(); } catch (e) { out.hashErr = String((e && e.message) || e); }
    try { out.sample = W.sampleRemoveByName(W.sampleName); } catch (e) { out.sampleErr = String((e && e.message) || e); }
    try { out.pick = W.pickRestore(); } catch (e) { out.pickErr = String((e && e.message) || e); }
    try { out.shareR = W.shareRestore(); } catch (e) { out.shareErr = String((e && e.message) || e); }
    try { out.fs = (typeof avProjSetFs === 'function') ? (avProjSetFs(null) !== false) : null; } catch (e) { out.fsErr = String((e && e.message) || e); }
    try { const ns = W.notes(); out.held = ns ? ns.held.length : null; out.taken = ns ? ns.taken.length : null; } catch (e) { out.notesErr2 = String((e && e.message) || e); }
    try { out.hashIs = String(location.hash).slice(0, 32); } catch (e) { out.hashIs = null; }
    return out;
  };
  return W;
})(); true`;

const shotPath = path.join(here, '..', 'renders', 's4-suite.png');

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

  /* ── 1. boot + card + surface ── */
  console.log('── 1. boot + card + surface ──');
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const r = await ev(`document.documentElement.getAttribute('data-av-ready') === '1'`);
    if (r.value === true) { ready = true; break; }
    await sleep(300);
  }
  /* the live engine ctx (S4 modules play through THIS context — never a fresh AudioContext) */
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

  await ev(S4W_HELPERS);
  const hR = await ev(`!!(window.__s4w && window.__s4w.v === 1 && typeof window.__s4w.legP1 === 'function' && typeof window.__s4w.legOpen === 'function' && typeof window.__s4w.legCard === 'function' && typeof window.__s4w.fakeInstall === 'function' && typeof window.__s4w.cleanup === 'function' && typeof window.__s4w.vidSnap === 'function')`);
  expected(val(hR) === true, '1b rig helpers injected (__s4w v1: fake-FS seam · picker probes · pattern/WAV/card/QR/PNG/share/video legs · page-side digests · cleanup)');

  let cardUp = false, cardInfo = '';
  for (let i = 0; i < 100 && !cardUp; i++) {
    const c = val(await ev('window.__s4w.card()')) || {};
    cardUp = c.host === true && c.card === true && c.root === true && c.wired === true;
    cardInfo = J(c);
    if (!cardUp) await sleep(150);
  }
  expected(cardUp, '1c card mounted: #av-files + #av-files-host + .av-files[data-av-files=1] root + wired marker (avFilesUiWired=1)', cardInfo);
  if (!cardUp) { console.error('S4 CARD MISSING — parent adds the #av-files card + #av-files-host and calls avFilesUiInit()'); process.exit(1); }

  const ctrl = val(await ev('window.__s4w.ctrl()')) || {};
  expected(cardUp && ctrl.missing && ctrl.missing.length === 0 && ctrl.buttons >= 7 && ctrl.img === true && ctrl.video === true && ctrl.videoMuted === true,
    '1d controls: PROJECT (save/open/samples + pstat) · SHARE (make/copy/png + preview img) · VIDEO (run + preview video muted) + cstat/vstat/status',
    J({ missing: ctrl.missing, buttons: ctrl.buttons, img: ctrl.img, video: ctrl.video, videoMuted: ctrl.videoMuted, tags: ctrl.tags }));

  const srf = val(await ev('window.__s4w.surface()')) || {};
  expected(Array.isArray(srf.missing) && srf.missing.length === 0 &&
    Array.isArray(srf.pmissing) && srf.pmissing.length === 0 &&
    Array.isArray(srf.cmissing) && srf.cmissing.length === 0 &&
    Array.isArray(srf.vmissing) && srf.vmissing.length === 0 &&
    Array.isArray(srf.umissing) && srf.umissing.length === 0 &&
    srf.init && srf.init.proj === true && srf.init.card === true && srf.init.video === true && srf.init.ui === true &&
    Array.isArray(srf.init.errs) && srf.init.errs.length === 0,
    '1e module surface: avProj*/avCard*/avVideo*/avFilesUi* globals + window handles member sets + inits true',
    J({ missing: srf.missing, pmissing: srf.pmissing, cmissing: srf.cmissing, vmissing: srf.vmissing, umissing: srf.umissing, init: srf.init }));

  const versOk = srf.versions && ['proj', 'card', 'vid', 'ui'].every(k =>
    (typeof srf.versions[k] === 'string' && srf.versions[k].length >= 1) || (typeof srf.versions[k] === 'number' && isFinite(srf.versions[k])));
  expected(srf.hasProj === true && srf.hasCard === true && srf.hasVid === true && srf.hasUi === true && versOk &&
    srf.classes && typeof srf.classes.proj === 'number' && typeof srf.classes.card === 'number' && typeof srf.classes.vid === 'number' &&
    typeof srf.classes.ui === 'number' && srf.classes.ui >= 1 &&
    srf.uiState && typeof srf.uiState === 'object' && srf.uiSnap && srf.uiSnap.isObj === true && Array.isArray(srf.uiSnap.keys) && srf.uiSnap.keys.length >= 2 &&
    srf.projState && typeof srf.projState.fsKind === 'string',
    '1f debug handles: __avProj/__avCard/__avVideo/__avFilesUi + versions + classes (ui card >= 1) + ui state/snap object + __avProj.state().fsKind',
    J({ versions: srf.versions, classes: srf.classes, uiSnap: srf.uiSnap, projState: srf.projState }));

  /* arm the baseline + install the picker spies + the fake FSA seam (2a) */
  const arm = val(await ev('window.__s4w.arm()')) || {};
  note('baseline armed: ' + J(arm));
  const spies = val(await ev('window.__s4w.pickSpies()')) || {};
  note('picker spies: ' + J(spies));

  /* ── 2. project save ── */
  console.log('── 2. project save ──');
  const fi = val(await ev('window.__s4w.fakeInstall()')) || {};
  const ps0 = fi.fsKind !== undefined ? fi.fsKind : null;
  expected(fi.ok === true && fi.calls === 0 && ps0 === 'injected' && spies.ok === true,
    '2a FSA seam: avProjSetFs(fake) accepted · __avProj state fsKind "injected" · fake records zero calls so far · window pickers spied',
    J({ fake: fi, spies: spies }));

  const p1 = val(await ev('window.__s4w.legP1("RIG SAVE")')) || {};
  expected(p1.ok === true && p1.via === 'fsa' && typeof p1.name === 'string' && /^anvil-project-.+\.anvl$/.test(p1.name) &&
    typeof p1.bytes === 'number' && p1.bytes > 64 && p1.closed === true && p1.textLen > 64 && p1.fakeSaveCount === 1 &&
    p1.sugg === p1.name &&
    p1.lastSave && p1.lastSave.via === 'fsa' && p1.lastSave.name === p1.name && typeof p1.lastSave.bytes === 'number' && p1.lastSave.bytes > 0 && ((typeof p1.lastSave.at === 'number' && p1.lastSave.at > 0) || (typeof p1.lastSave.at === 'string' && p1.lastSave.at.length >= 10)),
    '2b project save via seam: ok · via fsa · name anvil-project-<slug>.anvl · text captured + __avProjLastSave set',
    J({ ok: p1.ok, via: p1.via, name: p1.name, bytes: p1.bytes, sugg: p1.sugg, textLen: p1.textLen, closed: p1.closed, lastSave: p1.lastSave, err: p1.err || p1.error }));

  const p2 = val(await ev('window.__s4w.legP2()')) || {};
  expected(p2.ok === true && p2.magic === 'anvl' && p2.v === 1 && p2.app === 'anvil' && p2.kind === 'project' &&
    p2.atType === 'string' && (p2.stateName === null || typeof p2.stateName === 'string') &&
    p2.stateObj === true && p2.stateV === 1 && typeof p2.stateSavedAt === 'number' &&
    p2.seqObj === true && p2.hasPattern === true && p2.paramsObj === true && typeof p2.paramsLen === 'number' && p2.paramsLen >= 10 &&
    p2.macrosLen === 8 && p2.prefsObj === true,
    '2c saved bytes parse: avProjParse ok · magic anvl · v 1 · kind project · sessionless state (seq+pattern, params, macros[8], prefs)',
    J({ ok: p2.ok, magic: p2.magic, v: p2.v, app: p2.app, kind: p2.kind, at: p2.atType, stateName: p2.stateName, stateV: p2.stateV, savedAt: p2.stateSavedAt, seqKeys: p2.seqKeys, paramsLen: p2.paramsLen, macrosLen: p2.macrosLen, prefsObj: p2.prefsObj, err: p2.err || p2.error }));

  const det = val(await ev('window.__s4w.legDet()')) || {};
  const detNameOk = det.name1 === 'RIG DET' || /^anvil-project-rig-det\.anvl$/.test(String(det.name1 || ''));
  expected(det.ok1 === true && det.ok2 === true && det.same12 === true && det.hasAt === true &&
    det.ok3 === true && det.same13 === true && detNameOk,
    '2d determinism: avProjBuild(state, meta) twice → identical text · parse→build round-trip fixed point · at pinned by meta',
    J({ ok1: det.ok1, ok2: det.ok2, same12: det.same12, hasAt: det.hasAt, ok3: det.ok3, same13: det.same13, len1: det.len1, name1: det.name1, err: det.err }));

  /* ── 3. project open ── */
  console.log('── 3. project open ──');
  const a3 = val(await ev('window.__s4w.leg3a()')) || {};
  expected(a3.pl && a3.pl.ok === true && a3.pl.name === 'RIG PAT 1' && a3.mk && a3.mk.cur === 0.42 &&
    a3.pat0 === true && a3.st0Ok === true && typeof a3.noteCount === 'number' && a3.noteCount >= 8,
    '3a rig pattern + marker: avSeqLoad(RIG PAT 1) ok · master set 0.42 (read-back) · snapshot refs captured',
    J({ pl: a3.pl, mk: a3.mk, pat0: a3.pat0, st0Ok: a3.st0Ok, noteCount: a3.noteCount, err: a3.err }));

  const op = val(await ev('window.__s4w.legOpen()')) || {};
  const opR = op.r || {};
  expected(op.saveOk === true && op.savedLen > 64 && op.parse === true &&
    op.mutMaster === 0.9 && op.mutLoad === true &&
    opR.ok === true && opR.applied >= 1 && (Array.isArray(opR.skipped) ? opR.skipped.length === 0 : true) &&
    op.master === 0.42 && op.patBack === true && op.patName === 'RIG PAT 1' && op.noteCount === 28 &&
    op.opensAfter === op.opensBefore,
    '3b open via seam: save→mutate(param+pattern)→open(opts.state) → param 0.42 + pattern RIG PAT 1 restored · applied >= 1 · picker skipped',
    J({ saveOk: op.saveOk, savedLen: op.savedLen, parse: op.parse, mutMaster: op.mutMaster, mutName: op.mutName, open: opR, master: op.master, patBack: op.patBack, patName: op.patName, noteCount: op.noteCount, opensBefore: op.opensBefore, opensAfter: op.opensAfter, err: op.err }));

  const fo = val(await ev('window.__s4w.legForeign()')) || {};
  expected(Array.isArray(fo.parses) && fo.parses.length === 4 && fo.parses.every(p => p === false) &&
    fo.open && fo.open.ok === false && fo.masterSame === true && fo.patSame === true,
    '3c foreign refusal: bad magic / v2 / wrong kind / garbage all ok:false · foreign file via the fake picker refused · nothing applied',
    J({ parses: fo.parses, open: fo.open, masterSame: fo.masterSame, patSame: fo.patSame, opens: fo.opens, err: fo.err }));

  /* ── 4. samples ── */
  console.log('── 4. samples ──');
  const sm = val(await ev('window.__s4w.legSample()')) || {};
  const smR = sm.r || {};
  expected(smR.ok === true && Array.isArray(sm.added) && sm.added.indexOf('rig-s4-sample.wav') >= 0 && sm.via === 'fsa' &&
    typeof sm.fileBytes === 'number' && sm.fileBytes > 256 && (sm.wavVia === 'avWavEncode' || sm.wavVia === 'craft'),
    '4a samples: page-side WAV File (' + (sm.wavVia || '?') + ') via seam picker → receipt ok · added includes it · via fsa',
    J({ ok: smR.ok, added: sm.added, via: sm.via, wavVia: sm.wavVia, fileBytes: sm.fileBytes, count: smR.count, errors: smR.errors, err: sm.err }));

  expected(typeof sm.count0 === 'number' && typeof sm.count1 === 'number' && sm.count1 === sm.count0 + 1 &&
    sm.opensAfter === sm.opensBefore + 1 && smR.count === sm.count1,
    '4b samples: avSampleStore count advanced by exactly 1 · the fake open recorded the picker call',
    J({ count0: sm.count0, count1: sm.count1, rCount: smR.count, opensBefore: sm.opensBefore, opensAfter: sm.opensAfter }));

  /* ── 5. card ── */
  console.log('── 5. card ──');
  const cb = val(await ev('window.__s4w.legCard()')) || {};
  expected(cb.buildOk === true && cb.kindMirror === 'va' && cb.cutMirror === 1234 && cb.k === 'va' &&
    typeof cb.pLen === 'number' && cb.pLen >= 1 && cb.pLen <= 256 && cb.sorted === true && cb.pFiniteOk === true &&
    cb.cut === 1234 && cb.nLen !== null && cb.nLen <= 48 && cb.mLen === 8 && cb.mOk === true,
    '5a card build: kind from the mirror + known param in p · sorted keys ≤ 256 · macros 8×0..1 · finite/boolean values',
    J({ buildOk: cb.buildOk, kindMirror: cb.kindMirror, cutMirror: cb.cutMirror, k: cb.k, cut: cb.cut, pLen: cb.pLen, sorted: cb.sorted, pFiniteOk: cb.pFiniteOk, nLen: cb.nLen, mLen: cb.mLen, mOk: cb.mOk, err: cb.err || cb.buildErr }));

  const encCapOk = typeof cb.encLen === 'number' && cb.encLen <= 2048;
  expected(cb.encOk === true && encCapOk && b64urlOk(cb.enc) === true && cb.encDet === true &&
    cb.decOk === true && cb.decKind === 'va' && cb.decCut === 1234 && cb.decMlen === 8 && cb.decMEq === true && cb.decPEq === true,
    '5b encode/decode: base64url ≤ 2048 · deterministic · round-trip kind/p/m(8) exact',
    J({ encOk: cb.encOk, encLen: cb.encLen, encDet: cb.encDet, decOk: cb.decOk, decKind: cb.decKind, decCut: cb.decCut, decMlen: cb.decMlen, decMEq: cb.decMEq, decPEq: cb.decPEq, encHead: String(cb.enc || '').slice(0, 48), err: cb.encErr }));

  const urlOk = cb.urlOk === true && hashUrlOk(cb.url, cb.base, cb.enc) === true && hashUrlOk(cb.url2, cb.base2, cb.enc) === true;
  expected(urlOk, '5c url: default base location.origin+pathname + #avp=<enc> · explicit base concatenation exact',
    J({ urlOk: cb.urlOk, url: cb.url, base: cb.base, url2: String(cb.url2 || '').slice(0, 80), base2: cb.base2 }));

  const ap = val(await ev('window.__s4w.legApply()')) || {};
  expected(ap.pre === 777 && ap.r && ap.r.ok === true && ap.r.applied >= 1 && ap.cut === 1234 && (ap.kind === null || ap.kind === 'va'),
    '5d applyUrl: location.hash set to #avp=<enc> → avCardApplyUrl applies the encoded value back (applied >= 1)',
    J({ pre: ap.pre, r: ap.r, cut: ap.cut, kind: ap.kind, hashSet: ap.hashSet, err: ap.err }));

  const be = val(await ev('window.__s4w.legBadEnc()')) || {};
  expected(be.r && be.r.ok === false && be.same === true && be.dec && be.dec.ok === false && be.r2 && be.r2.ok === false && be.same2 === true,
    '5e bad enc: applyUrl ok:false with the param untouched · decode(not~b64) ok:false · empty hash ok:false',
    J({ r: be.r, same: be.same, dec: be.dec, r2: be.r2, same2: be.same2, err: be.err }));

  /* ── 6. QR ── */
  console.log('── 6. QR ──');
  const qrUrl = (cb.url2 && typeof cb.url2 === 'string' && cb.url2.length > 20) ? cb.url2 : 'https://moddys.net/anvil.html#avp=T0VTVA';
  const qr = val(await ev('window.__s4w.legQr("ANVIL S4 RIG", ' + JSON.stringify(qrUrl) + ')')) || {};
  expected(qr.c1 && qr.c1.ok === true && qr.c1.syndromesZero === true && typeof qr.c1.version === 'number' && qr.c1.version >= 1 &&
    qr.c2 && qr.c2.ok === true && qr.c2.syndromesZero === true && typeof qr.c2.version === 'number' && qr.c2.version >= 1,
    '6a QR self-check: short ASCII + a real URL → syndromesZero for both (RS syndromes + format round-trip)',
    J({ c1: qr.c1, c2: qr.c2, c1Err: qr.c1Err, c2Err: qr.c2Err }));

  const qrIssues = (qr.matrix && typeof qr.version === 'number') ? qrStructIssues(qr.matrix, qr.version) : ['no matrix'];
  expected(qr.q1Ok === true && Array.isArray(qr.matrix) && typeof qr.rows === 'number' && qr.rows === qr.size && qr.size === 17 + 4 * qr.version && qrIssues.length === 0,
    '6b QR matrix: size 17+4v · rows binary of that length · three 7×7 finder patterns (TL/TR/BL)',
    J({ version: qr.version, size: qr.size, rows: qr.rows, issues: qrIssues, err: qr.err }));

  expected(qr.same === true && typeof qr.detLen === 'number' && qr.detLen > 0,
    '6c QR deterministic: same text → identical matrix digest twice',
    J({ same: qr.same, detLen: qr.detLen }));

  expected(qr.big && qr.big.ok === false && typeof qr.big.error === 'string' && !qr.bigThrew,
    '6d QR >capacity (600 bytes): honest refusal, never throws',
    J({ big: qr.big, bigThrew: qr.bigThrew }));

  /* ── 7. PNG + preview + share ── */
  console.log('── 7. PNG + preview + share ──');
  const pg = val(await ev('window.__s4w.legPng()')) || {};
  expected(pg.ok === true && typeof pg.bytes === 'number' && pg.bytes > 4096 && pg.w === 1080 && pg.h === 1080 &&
    pg.blobSize === pg.bytes && magicEq(pg.magic, PNG_MAGIC) === true,
    '7a PNG card: magic 89 50 4E 47 0D 0A 1A 0A · bytes > 4096 · 1080×1080 · blob size == receipt bytes',
    J({ ok: pg.ok, bytes: pg.bytes, w: pg.w, h: pg.h, blobSize: pg.blobSize, magic: pg.magic, arrayBytes: pg.arrayBytes, err: pg.err || pg.error }));

  /* share hidden + save-picker hidden BEFORE the UI click so MAKE CARD's download path is deterministic */
  const shH = val(await ev('window.__s4w.shareHide()'));
  const pkH = val(await ev('window.__s4w.pickHideSave()'));
  note('share hidden: ' + J(shH) + ' · save picker hidden: ' + J(pkH));
  const clickedMake = await clickSel('#av-files-card-make', 400);
  note('MAKE CARD click: ' + (clickedMake ? 'dispatched' : 'not clickable'));
  let pv = null;
  for (let i = 0; i < 30; i++) {
    await sleep(400);
    pv = val(await ev('window.__s4w.previewInfo()')) || {};
    if (pv.isBlob === true) break;
  }
  pv = pv || {};
  const snapHasPreview = typeof pv.snap === 'string' && (/blob:/.test(pv.snap) || /"preview[^"]*"\s*:\s*(true|"[^"]+")/i.test(pv.snap));
  expected(pv.isBlob === true || snapHasPreview === true,
    '7b preview: MAKE CARD sets #av-files-card-preview src to a blob: object URL (or the ui snap reports the preview)',
    J({ isBlob: pv.isBlob, src: pv.src, tag: pv.tag, snapHasPreview: snapHasPreview, snap: String(pv.snap || '').slice(0, 220) }));

  const sh = val(await ev('window.__s4w.legShare()')) || {};
  expected(sh.ok === true && sh.shareType === 'undefined' &&
    sh.last && sh.last.via === 'download' && typeof sh.last.pngBytes === 'number' && sh.last.pngBytes > 4096 &&
    typeof sh.last.enc === 'string' && sh.last.enc.length > 0 &&
    sh.deliver && typeof sh.deliver.bytes === 'number' && sh.deliver.bytes > 4096 && sh.deliver.via === 'anchor',
    '7c share absent → download: __avCardLast.via "download" · pngBytes > 4096 · the anchor download recorded',
    J({ ok: sh.ok, shareType: sh.shareType, last: sh.last, deliver: sh.deliver, err: sh.err || sh.error }));

  /* ── 8. video ── */
  console.log('── 8. video ──');
  const vs = val(await ev('window.__s4w.vidSupported()')) || {};
  expected(vs.missing !== true && typeof vs.threw !== 'string' &&
    typeof vs.ok === 'boolean' && vs.ok === true && vs.capture === true && vs.recorder === true && typeof vs.audio === 'boolean' &&
    typeof vs.mime === 'string' && vs.mime.indexOf('video/webm') === 0 && Array.isArray(vs.reasons),
    '8a video supported: capture+recorder true · mime in the webm chain · audio flag + reasons[] present',
    J(vs));

  const vl = val(await ev('window.__s4w.legVideo()')) || {};
  note('video record started: ' + J({ pl: vl.pl, noteCount: vl.noteCount, vs: vl.vs }));
  let vn = null;
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    vn = val(await ev('window.__s4w.vidSnap()')) || {};
    if (vn.state === 'done' || vn.state === 'error') break;
  }
  vn = vn || {};
  expected(vl.pl && vl.pl.ok === true && typeof vl.noteCount === 'number' && vl.noteCount >= 8 &&
    vn.state === 'done' && vn.ok === true && vn.seconds === 2 && typeof vn.bytes === 'number' && vn.bytes > 8192 &&
    typeof vn.mime === 'string' && vn.mime.indexOf('video/webm') === 0 &&
    Array.isArray(vn.warnings) && vn.warnings.length === 0 && magicEq(vn.magic, EBML_MAGIC) === true,
    '8b video record 2s@15fps: EBML magic 1A 45 DF A3 · bytes > 8192 · mime webm · seconds 2 · warnings [] (polled)',
    J({ pl: vl.pl, noteCount: vl.noteCount, vn: vn }));

  const lv = val(await ev('window.__s4w.lastVideo()')) || {};
  expected(lv && typeof lv.bytes === 'number' && lv.bytes > 8192 && lv.seconds === 2 &&
    typeof lv.mime === 'string' && lv.mime.indexOf('video/webm') === 0 && typeof lv.at === 'number' && lv.at > 0,
    '8c __avVideoLast set: bytes/seconds/mime/at consistent with the receipt',
    J(lv));

  /* ── 9. seal — screenshot, cleanup, FSA discipline, errors, freeze ── */
  console.log('── 9. seal ──');
  await ev(`(() => { const el = document.getElementById('av-files') || document.getElementById('av-files-host'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); return true; })()`);
  await sleep(250);
  const rectR = await ev(`(() => { const el = document.getElementById('av-files') || document.getElementById('av-files-host'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }; })()`);
  const rect = val(rectR);
  let shotOk = false, shotInfo = 'no rect';
  if (rect && rect.w > 50 && rect.h > 50) {
    try {
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 2 }, captureBeyondViewport: true });
      const buf = Buffer.from(shot.data, 'base64');
      try { mkdirSync(path.dirname(shotPath), { recursive: true }); } catch (e) { }
      writeFileSync(shotPath, buf);
      shotOk = buf.length > 1000 && buf[0] === 0x89 && buf[1] === 0x50;
      shotInfo = buf.length + ' bytes · clip ' + Math.round(rect.w) + '×' + Math.round(rect.h) + ' @2x';
    } catch (e) { shotInfo = 'capture failed: ' + (e && e.message); }
  }
  expected(shotOk, '9a screenshot: renders/s4-suite.png (the card, scale 2 — taken while previews are live)', shotInfo);

  const cl = val(await ev('window.__s4w.cleanup()')) || {};
  const clp = cl.params || {};
  const masterOk = (typeof arm.master === 'number') ? (clp.master === arm.master) : true;
  const kindOk = (typeof arm.kind === 'string') ? (clp.kind === arm.kind) : true;
  const hashOk = !(typeof cl.hashIs === 'string' && cl.hashIs.indexOf('avp') >= 0);
  expected(cl.held === 0 && masterOk && kindOk && hashOk,
    '9b cleanup: notes released · params (master/kind) restored' + (typeof arm.cutoff === 'number' ? ' · cutoff restored' : ' · cutoff not present pre-run (kept, noted)') + ' · hash cleared',
    J({ held: cl.held, taken: cl.taken, params: clp, arm: { master: arm.master, kind: arm.kind, cutoff: arm.cutoff }, hashIs: cl.hashIs, cutoffOk: typeof arm.cutoff === 'number' ? clp.cutoff === arm.cutoff : 'n/a' }));

  expected(cl.patRestored === true && cl.patEqOrig === true && cl.sample && cl.sample.removed === true &&
    cl.pick && cl.pick.ok === true && cl.fs === true && (cl.shareR === true || cl.shareR === undefined),
    '9c cleanup: pattern restored (avSeqSnap identical) · sample removed · fake FS released + window pickers/share restored',
    J({ patRestored: cl.patRestored, patEqOrig: cl.patEqOrig, sample: cl.sample, pick: cl.pick, fs: cl.fs, shareR: cl.shareR, err: cl.err }));

  const rec = val(await ev('window.__s4w.fsRecap()')) || {};
  expected(rec.calls >= 4 && rec.saves >= 2 && rec.opens >= 2 && rec.calls === rec.saves + rec.opens &&
    rec.reach && rec.reach.save === 0 && rec.reach.open === 0 && rec.fsKindAtInject === 'injected',
    '9d FSA discipline: every project call rode the injected fake (saves+opens recorded) · zero real picker reaches',
    J(rec));

  expected(errors.length === 0, '9e zero page errors (exceptions · Log errors · console.error)', 'page errors=' + errors.length + (errors.length ? ' | ' + errors.slice(0, 3).join(' | ') : ''));

  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after): ' + shaAfter);
  expected(shaAfter === shaBefore, '9f freeze: index.html sha256 before === after (unchanged by the run)', shaAfter);

  /* ── 10. freeze pin leg ── */
  if (PIN) expected(shaBefore === PIN && shaAfter === PIN, '10 freeze pin leg: index.html sha256 = pinned', 'pinned ' + PIN.slice(0, 12) + '...');
  else note('10 EXPECT_SHA not pinned — after the S4 build, pass --sha <hex> or set the constant (never loosen)');

  console.log('');
  console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
  console.log('S4-RESULT ' + JSON.stringify({ kind: 'anvil-cdp-s4', sha256Before: shaBefore, sha256After: shaAfter, pinned: PIN || null, passed: pass, failed: fail, checks: pass + fail, verdict: fail ? 'fail' : 'pass' }));
  console.log(fail ? 'S4 FAILED' : 'S4 PASSED');
  try { ws.close(); } catch { /* done */ }
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('s4 harness crashed:', err); process.exit(1); });

process.on('exit', () => {
  try { chrome.kill(); } catch { }
  try {
    /* profile-scoped cleanup (LAW): kill ONLY processes whose command line carries OUR temp
       profile — matched by its unique basename, so the pattern needs no backslash escaping */
    const tag = path.basename(profile);
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch { }
});
