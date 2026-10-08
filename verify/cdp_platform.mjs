// cdp_platform.mjs — Anvil PLATFORM wave suite (rig sa-E; WRITTEN by sa-E, RUN BY THE PARENT
// after the platform integration build). End-to-end over raw CDP + a rig-owned static HTTP server.
//
//   node verify/cdp_platform.mjs [path-to-index.html] [--port N] [--sha <hex>] > verify/last-cdp_platform.log 2>&1
//
// WRITE-ONLY: this file is authored by sa-E and never executed by sa-E. The parent runs it after the
// platform integration build (index.html must carry av_pwa.js in the concat, av_sw.js instantiated to
// sw.js, av_icon.py icons + manifest.webmanifest emitted, inbox.html + av_gnaural.js + av_family.js
// wired — verify/_platform_wave.md §1/§2). Artifacts missing => exit(2) with the list.
//
// THE FIRST HTTP-BASED SUITE (wave §2.7): the rig starts its OWN dependency-free static server
// (node http + fs) on 127.0.0.1:<ephemeral> serving a temp COPY of the artifact set
// (index.html, sw.js, manifest.webmanifest, icon-192.png, icon-512.png, icon-maskable-512.png,
// inbox.html). The temp copy is where the update-flow check REWRITES sw.js. Correct MIME types are
// served (application/manifest+json for .webmanifest — a wrong type is a manifest parse failure).
// Every response carries Cache-Control: no-store; the port is ephemeral so nothing caches across
// runs (wave §4). Virtual /fixtures/ files are generated at runtime:
//   pack.zip — a DEFLATE zip (node zlib.deflateRawSync + a hand-built central directory) holding
//              classic/constant-tone.gnaural (type 0, base 200.0, beat 10.0, one 30 s entry),
//              README.txt (decoy), classic/white-noise.gnaural (type 7, 10 s);
//   rig-loose-tone.gnaural — one loose .gnaural for the local-file leg (synthesized File).
// The .gnaural fixtures use the REAL Gnaural XML shape (root <schedule>, <voice_state>,
// <entry ... duration volume_left volume_right beatfreq basefreq>) — learned from the format
// reference the reader child used (InstantNap.gnaural).
//
// LAUNCH SKELETON: cdp_m2.mjs — candidates Chrome/Edge/Brave, free-port CDP scan, fresh temp
// --user-data-dir + download dir + profile-scoped cleanup (kill ONLY processes whose command line
// carries OUR temp profile tag), 1440x900 device metrics override (Edge headless ignores
// --window-size), --autoplay-policy=no-user-gesture-required, ONE browser, explicit exit. The
// browser launches WITHOUT a URL (m2 precedent) and the rig navigates AFTER Runtime/Log/Page are
// enabled, so console/page errors from the very first load are collected. The Page.javascriptDialog
// auto-dismiss belt rides along. Server close + temp dir removal + browser close in shutdown(),
// ALSO reached from process.on('exit') as the belt.
//
// SHA FREEZE DISCIPLINE from cdp_m2: the REPO index.html is sha256'd before and after the run and
// before === after is ALWAYS enforced. EXPECT_SHA stays null (the platform freeze sha does not
// exist at authoring time) until the parent pins it (constant below or --sha <hex>); while null
// the rig still enforces before === after and prints a pin note (never loosened).
//
// WHAT IT PROVES, in order (contract: verify/_platform_wave.md §2.7 — sections P1..P10 + seal;
// this rig counts 51 checks + the pin leg when pinned):
//   0a boot (data-av-ready + live 48 kHz ctx + master node on the tap) · 0b rig helpers injected ·
//      0c platform surface (__avPwa state/installPrompt + __avFamily send/importPack/preview/save/
//      openRadio/setPackBase + exactly 3 .av-fam-row) — exit(1) when the handles are missing.
//   P1 manifest: fetch 200 + MIME; name/id/start_url/scope/display/orientation/colors/categories
//      exact; description exact (em dash included); file_handlers exact; 3 icons (192/512/maskable)
//      each fetched 200 + image/png + PNG magic.
//   P2 registration over http: supported true; registered + swUrl ./sw.js; live registration scope
//      = origin root (the './' scope); navigator.serviceWorker.ready resolves + active + controlled;
//      the file:// guard leg (same run): supported false, NO registration, zero page errors.
//   P3 cache: caches.keys() includes anvil-<sha8> where sha8 = sha256 of the SERVED index.html
//      bytes (rig-computed); caches.match('./index.html') bytes sha256 === the served sha; the
//      SERVED sw.js SW_VERSION token carries the same sha8.
//   P4 offline: CDP Network.emulateNetworkConditions offline:true -> reload -> data-av-ready +
//      navigator.onLine false; body class av-pwa-offline; chip #av-pwa-offline visible; served-
//      from-cache proof (nav transferSize === 0 OR workerStart > 0) + full doc length printed;
//      then back online -> live reload.
//   P5 update flow: rewrite the temp sw.js SW_VERSION token to a different 8-hex + touch comment;
//      reg.update(); wait for registration.waiting + body class av-pwa-update + chip #av-pwa-update
//      visible; click the chip -> reload once -> new cache anvil-<new> present + old anvil-<old>
//      gone.
//   P6 install path (CODE-PATH TEST — never a real browser install): dispatch a synthetic
//      beforeinstallprompt Event with prompt/userChoice stubs -> __avPwa.installPrompt() truthy;
//      #av-pwa-install visible; click -> prompt() called once, userChoice resolves 'dismissed',
//      no crash.
//   P7 family HUB: load the cdp_bounce BUILD_PATTERN shape via avSeqLoad; __avFamily.send(
//      {loops:2}) with window.open stubbed -> receipt ok via 'inbox'; IDB moddys-bridges/outbox
//      record read via the page; navigate to ./inbox.html -> __avInbox.list() 1 row with the right
//      name/bpm/bytes; <audio> blob: src; a[download] blob href; delete -> count 0.
//   P8 family RESONANCE: setPackBase(rig server /fixtures/); importPack('pack') -> 2 sessions
//      listed, decoy README.txt skipped + noted; preview of the constant-tone session -> receipt ok
//      via 'master-tap' ~30 s; WITNESS: the rig's OWN AnalyserNode pair (channel splitter) on the
//      master tap (avMasterFor/avMasterNodes — the SAME node the preview routes into) measures
//      left ~195 Hz / right ~205 Hz within 1 Hz; save -> a WAV lands in the CDP download dir with
//      RIFF/WAVE magic + len > 44; local-file leg via a synthesized File (DataTransfer change);
//      404 refusal leg -> ok:false + honest note + the server saw the request.
//   P9 family RADIO: seed localStorage rbg-last + reload -> radio row text carries 'Test FM';
//      openRadio('dub') === 'https://moddys.net/#q=dub' exact; click #av-fam-radio-open with
//      window.open stubbed -> url 'https://moddys.net/' + target 'av-world-radio'.
//   P10 zero page errors/console errors across every section (offenders listed).
//   S1 repo index.html sha256 before === after · S2 freeze pin leg (when pinned).
//
// HARNESS LAWS (house): one browser at a time; the rig installs its OWN AnalyserNodes — UI reads are
// never witnesses; every assertion reads machine observables (globals, DOM, caches, IDB, timing
// entries, rig-owned FFT) — never console text. The rig uses the plain page (no ?avtest=1).
//
// SPEC NOTES (sa-E, for the first parent run — fix the EXPECTATION to the check's stated intent,
// never loosen strength):
//   (a) The P2 file:// leg follows the guard contract: supported false + no registration attempt +
//       zero page errors. A registration attempt on file:// (or any console noise) fails by design.
//   (b) P4 accepts EITHER nav transferSize === 0 OR workerStart > 0 (sw-served) and additionally
//       requires the reloaded document to be the full app (>100000 chars of outerHTML) — a cached
//       error page fails. If Chromium reports the nav entry differently headless, triage here.
//   (c) P5 assumes the built sw.js carries the version as SW_VERSION = "<8-hex>" (wave §2.2
//       template). A different literal shape => the rig fails with its detail; fix the rewrite
//       regex to the real shape, never the check.
//   (d) P6 drives the install CODE PATH only; 'dismissed' keeps canInstall — no real install is
//       possible or claimed.
//   (e) P7/P8/P9 read the pinned handles: __avFamily.send/importPack/preview/save/openRadio/
//       setPackBase/state, __avInbox.list/remove, __avPwa.state/installPrompt, and the parent ID
//       pins (#av-pwa-install/-update/-offline, #av-fam-hub-*, #av-fam-res-*, #av-fam-radio-*).
//       Inbox list() is read as an array (or {rows}); a different shape => SPEC fix.
//   (f) P8 witness checks the constant-tone fixture through the SAME master node preview routes
//       into (avMasterFor(ctx) then avMasterNodes(), the av_family resolution order); the tone must
//       be the strongest bin (±1 Hz) with db > -80 — a silent/other-frequency preview fails.
//   (g) P8 save uses __avFamily.save() when present (sa-D's current build), else clicks
//       #av-fam-res-save; either way the WAV must LAND as a file (CDP download dir) with RIFF.
//       showSaveFilePicker is deleted first so the anchor path runs headless.
//   (h) P8 local-file leg accepts append OR replace semantics (wave wording) — the loose session
//       must appear parsed; ordering/count differences are not triaged here.
//   (i) P9 only READS rbg-last (seed) — rbg-meta is never written by the rig (foreign key law).
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const shaArg = argv.indexOf('--sha');
const page = argv.find(a => !a.startsWith('--') && (/\.html?$/i.test(a) || existsSync(a))) || path.join(here, '..', 'index.html');
if (!existsSync(page)) { console.error('page not found: ' + page); process.exit(2); }

/* FREEZE LAW: the bytes under test are named before anything runs, and re-checked after.
   PLATFORM: the frozen sha of the integrated index.html is not known until build.py runs and the
   parent pins it — EXPECT_SHA stays null; the rig never loosens the before === after check. */
const EXPECT_SHA = "ff99f4828c34eb36f14aba5c19a95adaad88aa484f78cd0a775c4af1dcff6991";   /* sa-E pin slot — parent fills after the platform build (or --sha <hex>) */
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
const PORT = portArg > -1 ? Number(argv[portArg + 1]) : await freePort(9790);
const profile = path.join(tmpdir(), 'anvil-platform-' + Date.now());
const DL_DIR = path.join(tmpdir(), 'anvil-platform-dl-' + Date.now());
try { mkdirSync(DL_DIR, { recursive: true }); } catch (e) { /* best-effort */ }
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
const J = (x) => { try { return JSON.stringify(x); } catch (e) { return String(x); } };

/* ═══════════════════ the artifact set: temp copy + the rig's static server ═══════════════════ */

const ARTIFACTS = ['index.html', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'inbox.html'];
const artMissing = ARTIFACTS.filter(f => !existsSync(path.join(here, '..', f)));
if (artMissing.length) {
  console.error('PLATFORM ARTIFACTS MISSING in the repo root: ' + artMissing.join(', '));
  console.error('  (the parent integration build must land before this rig runs — wave §2.3/§2.4)');
  process.exit(2);
}

const SERVED_DIR = path.join(tmpdir(), 'anvil-platform-srv-' + Date.now());
try { mkdirSync(SERVED_DIR, { recursive: true }); } catch (e) { /* exists */ }
for (const f of ARTIFACTS) {
  writeFileSync(path.join(SERVED_DIR, f), readFileSync(path.join(here, '..', f)));
}
const SRV_SHA = shaOf(path.join(SERVED_DIR, 'index.html'));
const SHA8 = SRV_SHA.slice(0, 8);
console.log('served artifact set copied -> ' + SERVED_DIR);
console.log('served index.html sha256: ' + SRV_SHA + '  (sha8 ' + SHA8 + ')');
if (SRV_SHA !== shaBefore) note('served copy sha !== repo sha (copy raced an edit — triage)');

/* ---------- .gnaural fixtures (REAL Gnaural XML shape: <schedule>, <voice_state>, entry attrs) ---------- */
function gnXml(o) {
  return '<?xml version="1.0"?>\n' +
    '<!-- See http://gnaural.sourceforge.net -->\n' +
    '<schedule>\n' +
    '<gnauralfile_version>1.20101006</gnauralfile_version>\n' +
    '<gnaural_version>1.0.20110215</gnaural_version>\n' +
    '<title>' + o.title + '</title>\n' +
    '<schedule_description>' + (o.desc || o.title) + '</schedule_description>\n' +
    '<author>platform-rig</author>\n' +
    '<totaltime>' + o.total + '</totaltime>\n' +
    '<voicecount>1</voicecount>\n' +
    '<totalentrycount>1</totalentrycount>\n' +
    '<loops>0</loops>\n' +
    '<overallvolume_left>1</overallvolume_left>\n' +
    '<overallvolume_right>1</overallvolume_right>\n' +
    '<stereoswap>0</stereoswap>\n' +
    '<graphview>1</graphview>\n' +
    '<voice>\n' +
    '<description>' + (o.vdesc || o.title) + '</description>\n' +
    '<id>0</id>\n' +
    '<type>' + o.type + '</type>\n' +
    '<voice_state>1</voice_state>\n' +
    '<voice_hide>0</voice_hide>\n' +
    '<voice_mute>0</voice_mute>\n' +
    '<voice_mono>0</voice_mono>\n' +
    '<entrycount>1</entrycount>\n' +
    '<entries>\n' +
    '<entry parent="0" duration="' + o.duration + '" volume_left="' + o.vol + '" volume_right="' + o.vol + '" beatfreq="' + o.beat + '" basefreq="' + o.base + '" state="0"/>\n' +
    '</entries>\n' +
    '</voice>\n' +
    '</schedule>\n';
}
const GN_TONE_XML = gnXml({ title: 'Rig Constant Tone', total: 30, type: 0, duration: 30, base: 200, beat: 10, vol: 0.8,
  desc: 'Constant binaural tone: base 200 Hz, beat 10 Hz, one 30 s entry (195 Hz left / 205 Hz right).' });
const GN_NOISE_XML = gnXml({ title: 'Rig White Noise', total: 10, type: 7, duration: 10, base: 100, beat: 0, vol: 0.5,
  desc: 'White noise, 10 s, deterministic per the renderer seed.' });
const GN_LOOSE_XML = gnXml({ title: 'Rig Loose Tone', total: 30, type: 0, duration: 30, base: 200, beat: 10, vol: 0.8,
  desc: 'Loose .gnaural for the local-file leg.' });

/* ---------- a DEFLATE zip: zlib.deflateRawSync + a hand-built central directory (no deps) ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zipDeflate(entries) {
  /* method 8 (deflate) for every entry; DOS date 0x0021 = 1980-01-01; no extras, no comments */
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const def = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(def.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, def);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(def.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([ch, nameBuf]));
    offset += 30 + nameBuf.length + def.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

const FIXTURES = {
  'pack.zip': zipDeflate([
    { name: 'classic/constant-tone.gnaural', data: GN_TONE_XML },
    { name: 'README.txt', data: 'This is not a session — decoy file for the platform rig.\n' },
    { name: 'classic/white-noise.gnaural', data: GN_NOISE_XML },
  ]),
  'rig-loose-tone.gnaural': Buffer.from(GN_LOOSE_XML, 'utf8'),
};

/* ---------- the server (node http + fs, no deps): flat artifact set + virtual /fixtures/ ---------- */
function contentTypeFor(p) {
  if (p.endsWith('.html')) return 'text/html; charset=utf-8';
  if (p.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (p.endsWith('.webmanifest')) return 'application/manifest+json';
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.zip')) return 'application/zip';
  if (p.endsWith('.gnaural')) return 'application/xml; charset=utf-8';
  return 'application/octet-stream';
}
const reqLog = new Map();
let server = null;
server = http.createServer((req, res) => {
  try {
    const u = new URL(req.url, 'http://127.0.0.1');
    let pathname = '';
    try { pathname = decodeURIComponent(u.pathname); } catch (e) { pathname = u.pathname; }
    reqLog.set(pathname, (reqLog.get(pathname) || 0) + 1);
    const send2 = (code, type, buf) => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': buf.length });
      res.end(buf);
    };
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/favicon.ico') {
      try { send2(200, 'image/png', readFileSync(path.join(SERVED_DIR, 'icon-192.png'))); return; } catch (e) { /* fall through */ }
    }
    if (pathname.startsWith('/packs/')) {
      const rel = pathname.slice('/packs/'.length);
      const pfile = path.join(path.dirname(path.resolve(page)), 'packs', rel);
      try {
        if (!rel.includes('..')) { const pbuf = readFileSync(pfile); send2(200, contentTypeFor(rel), pbuf); return; }
      } catch (e) { /* not a file -> 404 below */ }
      send2(404, 'text/plain; charset=utf-8', Buffer.from('pack not found\n', 'utf8'));
      return;
    }
    if (pathname.startsWith('/fixtures/')) {
      const name = pathname.slice('/fixtures/'.length);
      const buf = FIXTURES[name];
      if (buf) { send2(200, contentTypeFor(name), buf); return; }
      send2(404, 'text/plain; charset=utf-8', Buffer.from('fixture not found: ' + name + '\n', 'utf8'));
      return;
    }
    const base = path.basename(pathname);
    if (pathname.includes('..') || base !== pathname.slice(1) || !ARTIFACTS.includes(base)) {
      send2(404, 'text/plain; charset=utf-8', Buffer.from('not found\n', 'utf8'));
      return;
    }
    const filePath = path.join(SERVED_DIR, base);
    if (!existsSync(filePath)) { send2(404, 'text/plain; charset=utf-8', Buffer.from('not found\n', 'utf8')); return; }
    send2(200, contentTypeFor(base), readFileSync(filePath));
  } catch (e) {
    try { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('rig server error\n'); } catch (e2) { /* done */ }
  }
});
await new Promise((res) => server.listen(0, '127.0.0.1', res));
const SRV_PORT = server.address().port;
const ROOT = 'http://127.0.0.1:' + SRV_PORT;
console.log('rig server: ' + ROOT + '  (serving ' + SERVED_DIR + ')');

const FILE_URL = 'file:///' + path.resolve(page).replace(/\\/g, '/');
console.log('file:// guard leg target: ' + FILE_URL);

/* ═══════════════════ browser (launch block from cdp_m2.mjs; NO URL — navigate after enables) ═══════════════════ */

let chrome = null;
chrome = spawn(exe, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--disable-sync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--disable-popup-blocking', '--allow-file-access-from-files',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--mute-audio',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
], { stdio: 'ignore', windowsHide: true });

const errors = [];

/* ---------- page-side rig helpers (rig-owned; never app code) — regex backslashes are DOUBLED
   for the eval transport. Loaded once per document; proves helpers for every section. ---------- */
const PLATW_INSTALL = function () {
  window.__platw = (function () {
    var W = { v: 1, ctx: null, node: null, spl: null, anL: null, anR: null, fdL: null, fdR: null };

    W.num = function (x) { return (typeof x === 'number' && isFinite(x)) ? x : null; };
    W.safe = function (x) { try { return JSON.parse(JSON.stringify(x)); } catch (e) { return null; } };
    W.j = function (x) { try { return JSON.stringify(x); } catch (e) { return String(x); } };
    W.domGet = function (id) { try { return document.getElementById(id); } catch (e) { return null; } };
    W.txt = function (id) { var el = W.domGet(id); return el ? String(el.textContent || '').replace(/\s+/g, ' ').slice(0, 200) : null; };
    W.counter = function (sel) { try { return document.querySelectorAll(sel).length; } catch (e) { return -1; } };
    W.light = function (x) {
      if (x === null || x === undefined) return x;
      if (typeof x !== 'object') return x;
      var out = {}, n = 0, k;
      for (k in x) {
        if (n >= 16) break;
        var v = null;
        try { v = x[k]; } catch (e) { v = null; }
        var t = typeof v;
        if (t === 'number') { out[k] = isFinite(v) ? v : String(v); n++; }
        else if (t === 'string') { out[k] = v.length > 96 ? v.slice(0, 96) : v; n++; }
        else if (t === 'boolean' || v === null) { out[k] = v; n++; }
        else if (Object.prototype.toString.call(v) === '[object Array]') { out[k] = 'array[' + v.length + ']'; n++; }
        else if (t === 'object') { out[k] = 'obj'; n++; }
        else { out[k] = t; n++; }
      }
      return out;
    };

    W.ready = function () { try { return document.documentElement.getAttribute('data-av-ready') === '1'; } catch (e) { return false; } };

    W.pageState = function () {
      var out = { href: null, ready: null, to: null, online: null, controlled: null, bodyCls: null };
      try {
        out.href = String(location.href);
        out.ready = document.documentElement.getAttribute('data-av-ready');
        out.to = (typeof performance !== 'undefined' && performance) ? performance.timeOrigin : null;
        out.online = (typeof navigator !== 'undefined') ? navigator.onLine : null;
        out.controlled = (typeof navigator !== 'undefined' && navigator.serviceWorker) ? !!navigator.serviceWorker.controller : null;
        out.bodyCls = (document.body && document.body.className) ? String(document.body.className).slice(0, 200) : '';
      } catch (e) { out.err = String((e && e.message) || e); }
      return out;
    };

    W.pwaState = function () {
      try {
        var h = window.__avPwa;
        if (!h) return { missing: true };
        var st = (typeof h.state === 'function') ? h.state() : null;
        var out = { missing: false, supported: h.supported, registered: h.registered, active: h.active, waiting: h.waiting, online: h.online, swUrl: h.swUrl, scope: h.scope };
        if (st) {
          if (st.supported !== undefined) out.supported = st.supported;
          if (st.registered !== undefined) out.registered = st.registered;
          if (st.active !== undefined) out.active = st.active;
          if (st.waiting !== undefined) out.waiting = st.waiting;
          if (st.controlled !== undefined) out.controlled = st.controlled;
          if (st.online !== undefined) out.online = st.online;
          if (st.scope !== undefined) out.scope = st.scope;
          if (st.swUrl !== undefined) out.swUrl = st.swUrl;
          out.errorsN = (Object.prototype.toString.call(st.errors) === '[object Array]') ? st.errors.length : null;
          out.errors0 = (Object.prototype.toString.call(st.errors) === '[object Array]' && st.errors.length) ? String(st.errors[0]).slice(0, 140) : null;
        }
        return out;
      } catch (e) { return { err: String((e && e.message) || e) }; }
    };

    W.famState = function () {
      try {
        var h = window.__avFamily;
        if (!h || typeof h.state !== 'function') return { missing: true };
        var st = h.state();
        var sessions = (Object.prototype.toString.call(st.sessions) === '[object Array]') ? st.sessions : [];
        return {
          version: st.version, inited: st.inited, busy: !!st.busy,
          inboxAvailable: st.inboxAvailable, selected: st.selected, previewing: !!st.previewing,
          sessionCount: st.sessionCount,
          sessions: sessions.map(function (s) {
            return {
              name: (s && typeof s.name === 'string') ? s.name : String(s && s.name),
              ok: !!(s && s.ok),
              error: (s && s.error) ? String(s.error).slice(0, 120) : '',
              totalSeconds: (s && s.info && typeof s.info.totalSeconds === 'number') ? s.info.totalSeconds : null,
              playableVoices: (s && s.info && typeof s.info.playableVoices === 'number') ? s.info.playableVoices : null,
              renderable: !!(s && s.info && s.info.renderable !== false),
            };
          }),
          lastRender: st.lastRender ? { name: st.lastRender.name, seconds: st.lastRender.seconds, sr: st.lastRender.sr, frames: st.lastRender.frames, capped: !!st.lastRender.capped } : null,
          lastReceipt: {
            hub: W.safe(st.lastReceipt ? st.lastReceipt.hub : null),
            resonance: W.safe(st.lastReceipt ? st.lastReceipt.resonance : null),
            radio: W.safe(st.lastReceipt ? st.lastReceipt.radio : null),
          },
          radio: st.radio ? W.safe(st.radio) : null,
          statuses: st.statuses ? W.safe(st.statuses) : null,
        };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    };

    /* the live ctx (avTap.ctx first; engine fallback) resumed; the witness rides THIS ctx */
    W.ensureCtx = function () {
      return new Promise(function (resolve) {
        var out = { ok: false, state: null, sr: null, nodes: 0, src: 'none' };
        var ctx = null;
        try {
          try { if (typeof avTap !== 'undefined' && avTap && avTap.ctx && avTap.ctx.state !== 'closed') { ctx = avTap.ctx; out.src = 'avTap.ctx'; } } catch (e) { }
          try { if (!ctx && window.__avTap && window.__avTap.ctx && window.__avTap.ctx.state !== 'closed') { ctx = window.__avTap.ctx; out.src = '__avTap.ctx'; } } catch (e) { }
          try {
            if (!ctx && typeof avMasterNodes === 'function') {
              var ns = avMasterNodes() || [];
              out.nodes = ns.length;
              if (ns[0] && ns[0].context) { ctx = ns[0].context; out.src = 'avMasterNodes'; }
            }
          } catch (e) { }
          var finish = function () {
            try {
              out.sr = ctx ? ctx.sampleRate : null;
              out.state = ctx ? String(ctx.state) : null;
              out.ok = !!(ctx && ctx.state === 'running');
              W.ctx = ctx || null;
              resolve(out);
            } catch (e) { resolve(out); }
          };
          var afterEnsure = function () { finish(); };
          if (!ctx && typeof avEngineEnsure === 'function') {
            out.src = 'avEngineEnsure';
            Promise.race([
              Promise.resolve().then(function () { return avEngineEnsure(); }).catch(function () { return null; }),
              new Promise(function (res) { setTimeout(function () { res(null); }, 3000); }),
            ]).then(function (h) {
              try { if (h && h.ctx) ctx = h.ctx; } catch (e) { }
              if (!ctx) { try { if (typeof avTap !== 'undefined' && avTap && avTap.ctx) ctx = avTap.ctx; } catch (e) { } }
              afterEnsure();
            });
            return;
          }
          if (!ctx) { finish(); return; }
          if (ctx.state !== 'running') {
            try { Promise.resolve(ctx.resume()).catch(function () { }); } catch (e) { }
            var t0 = Date.now();
            var poll = function () {
              if (ctx.state === 'running' || Date.now() - t0 > 2500) { finish(); return; }
              setTimeout(poll, 125);
            };
            poll();
            return;
          }
          finish();
        } catch (e) { out.err = String((e && e.message) || e); resolve(out); }
      });
    };

    /* the SAME node the preview routes into: avMasterFor(ctx) -> avMasterNodes() (av_family order) */
    W.masterPick = function (ctx) {
      try {
        var c = ctx || W.ctx || null;
        try { if (typeof avMasterFor === 'function' && c) { var n0 = avMasterFor(c); if (n0 && n0.gain) return n0; } } catch (e) { }
        try {
          if (typeof avMasterNodes === 'function') {
            var list = avMasterNodes() || [];
            for (var i = 0; i < list.length; i++) { var n = list[i]; if (n && n.gain && (!c || n.context === c)) return n; }
            if (list[0] && list[0].gain) return list[0];
          }
        } catch (e2) { }
      } catch (e3) { }
      return null;
    };

    W.witRelease = function () {
      var had = !!(W.spl || W.anL || W.anR || W.node);
      try { if (W.anL) W.anL.disconnect(); } catch (e) { }
      try { if (W.anR) W.anR.disconnect(); } catch (e) { }
      try { if (W.spl) W.spl.disconnect(); } catch (e) { }
      try { if (W.node) W.node.disconnect(W.spl); } catch (e) { }
      W.spl = null; W.anL = null; W.anR = null; W.fdL = null; W.fdR = null;
      return { had: had };
    };

    W.witArm = function () {
      try {
        W.witRelease();
        var ctx = W.ctx;
        if (!ctx) return { ok: false, why: 'no live ctx — ensureCtx first' };
        var node = W.masterPick(ctx);
        if (!node) return { ok: false, why: 'no master node (gain) on the tap' };
        var spl = ctx.createChannelSplitter(2);
        node.connect(spl);
        var anL = ctx.createAnalyser(); anL.fftSize = 32768; anL.smoothingTimeConstant = 0;
        var anR = ctx.createAnalyser(); anR.fftSize = 32768; anR.smoothingTimeConstant = 0;
        spl.connect(anL, 0);
        spl.connect(anR, 1);
        W.node = node; W.spl = spl; W.anL = anL; W.anR = anR;
        W.fdL = new Float32Array(anL.frequencyBinCount);
        W.fdR = new Float32Array(anR.frequencyBinCount);
        return { ok: true, sr: ctx.sampleRate, fft: anL.fftSize, binHz: ctx.sampleRate / anL.fftSize };
      } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
    };

    /* peak frequency of one witness channel (best-of reads + parabolic interpolation) */
    W.fp = function (side) {
      return new Promise(function (resolve) {
        try {
          var an = (side === 'r') ? W.anR : W.anL;
          var fd = (side === 'r') ? W.fdR : W.fdL;
          if (!an || !fd) { resolve({ ok: false, why: 'witness not armed' }); return; }
          var best = new Float64Array(fd.length); best.fill(-Infinity);
          var r = 0;
          var tick = function () {
            try {
              an.getFloatFrequencyData(fd);
              for (var j = 0; j < best.length; j++) { if (fd[j] > best[j]) best[j] = fd[j]; }
            } catch (e) { /* one lost read */ }
            r++;
            if (r < 4) { setTimeout(tick, 70); return; }
            var sr = W.ctx ? W.ctx.sampleRate : 48000;
            var binHz = sr / an.fftSize;
            var bi = 2, bv = -Infinity, i;
            for (i = 2; i < best.length; i++) { if (best[i] > bv) { bv = best[i]; bi = i; } }
            var hz = bi * binHz;
            if (bi > 2 && bi < best.length - 1) {
              var a = best[bi - 1], b = best[bi], c = best[bi + 1];
              var d = (a - c) / (2 * (a - 2 * b + c));
              if (isFinite(d) && Math.abs(d) < 1) hz = (bi + d) * binHz;
            }
            resolve({ ok: true, hz: hz, db: bv, bin: bi, binHz: binHz, fft: an.fftSize });
          };
          tick();
        } catch (e) { resolve({ ok: false, why: String((e && e.message) || e) }); }
      });
    };

    /* read the bridge store (never writes rows; creates the store only if the DB is absent) */
    W.idbOut = function () {
      return new Promise(function (resolve) {
        var out = { n: 0, row: null, err: null };
        try {
          var rq = null;
          try { rq = indexedDB.open('moddys-bridges', 1); } catch (e) { out.err = 'open:' + String((e && e.message) || e); resolve(out); return; }
          rq.onupgradeneeded = function () { try { var db = rq.result; if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' }); } catch (e) { } };
          rq.onerror = function () { out.err = 'open:error'; resolve(out); };
          rq.onblocked = function () { out.err = 'open:blocked'; resolve(out); };
          rq.onsuccess = function () {
            try {
              var db = rq.result;
              var tx = db.transaction('outbox', 'readonly');
              var g = tx.objectStore('outbox').getAll();
              g.onsuccess = function () {
                try {
                  var rows = g.result || [];
                  out.n = rows.length;
                  var r = rows.slice().sort(function (a, b) { return ((b && b.at) || 0) - ((a && a.at) || 0); })[0] || null;
                  if (r) out.row = { id: r.id, name: r.name, kind: r.kind, bpm: r.bpm, bars: r.bars, sec: r.sec, sr: r.sr, ch: r.ch, bytes: r.bytes, at: r.at, wavBytes: (r.wav && r.wav.byteLength) ? r.wav.byteLength : 0 };
                } catch (e) { out.err = 'read:' + String((e && e.message) || e); }
                try { db.close(); } catch (e) { }
                resolve(out);
              };
              g.onerror = function () { out.err = 'getAll:error'; try { db.close(); } catch (e) { } resolve(out); };
            } catch (e) { out.err = 'tx:' + String((e && e.message) || e); resolve(out); }
          };
        } catch (e) { out.err = String((e && e.message) || e); resolve(out); }
      });
    };

    /* window.open capture stub (family popout law: named targets; the rig asserts without navigating) */
    W.stubOpen = function () {
      try {
        window.__openLog = window.__openLog || [];
        window.open = function (url, target) {
          try { window.__openLog.push({ url: String(url == null ? '' : url), target: String(target == null ? '' : target), at: Date.now() }); } catch (e) { }
          return { closed: false, focus: function () { }, blur: function () { }, close: function () { }, postMessage: function () { } };
        };
        return true;
      } catch (e) { return false; }
    };
    W.openGet = function () { try { return (window.__openLog || []).slice(-8); } catch (e) { return []; } };

    return W;
  })();
  return true;
};

/* ---------- the known rig pattern for the HUB bounce (cdp_bounce BUILD_PATTERN, verbatim shape) ---------- */
const BUILD_PATTERN = `(() => {
  const mk = (on, note, vel) => ({ on: on ? 1 : 0, note: note, vel: vel, gate: 0.5, slide: 0, accent: 0, oct: 0, prob: 100, cond: '', ratchet: 1, micro: 0 });
  const track = (hits, note, vel) => {
    const steps = []; for (let i = 0; i < 64; i++) steps.push(mk(0, note, vel));
    for (let i = 0; i < hits.length; i++) steps[hits[i]] = mk(1, note, vel);
    return { len: 16, speed: 1, mute: 0, steps: steps };
  };
  const pat = { v: 1, name: 'RIG PAT 1', bpm: 120, grid: '16', swing: 50, rng: 0x12345678,
    tracks: [ track([0,1,2,3,4,5,6,7], 'c3', 0.9), track([0,1,2,3,4,5,6,7], 'e3', 0.8), track([0,1,2,3,4,5,6,7], 'g3', 0.8), track([12,13,14,15], 'c4', 0.9) ],
    plocks: [] };
  const ok = avSeqLoad(pat);
  return { ok: ok, name: (ok && typeof avSeqSnap === 'function') ? avSeqSnap().name : null };
})()`;

/* ═══════════════════ shutdown (server close, temp dirs remove, browser close) ═══════════════════ */

let ws = null;
let cleaned = false;
function shutdown() {
  if (cleaned) return;
  cleaned = true;
  try { if (ws) ws.close(); } catch (e) { /* done */ }
  try { if (server) { server.close(); if (typeof server.closeAllConnections === 'function') server.closeAllConnections(); } } catch (e) { /* done */ }
  try { if (chrome) chrome.kill(); } catch (e) { /* done */ }
  for (const d of [SERVED_DIR, DL_DIR, profile]) {
    try { rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* lock races are fine */ }
  }
}

process.on('exit', () => {
  try { if (chrome) chrome.kill(); } catch (e) { }
  try {
    /* profile-scoped cleanup (LAW): kill ONLY processes whose command line carries OUR temp
       profile — matched by its unique basename, so the pattern needs no backslash escaping */
    const tag = path.basename(profile);
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore', windowsHide: true });
  } catch (e) { }
});

/* ═══════════════════ main ═══════════════════ */

async function main() {
  /* target wait: launching WITHOUT a URL — find a page target we can drive (cdp_m2/midi law) */
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
  ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push('PAGE: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('LOG: ' + m.params.entry.text + (m.params.entry.url ? ' @ ' + m.params.entry.url : ''));
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('CONSOLE: ' + m.params.args.map(a => a.value || a.description || '').join(' '));
    else if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: false }).catch(() => { /* belt only */ });
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Network.enable').catch(() => { });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => { });
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR }).catch(() => note('Page.setDownloadBehavior unavailable — anchor writes still fire'));
  try {
    const vres = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    const vinfo = await vres.json();
    const bws = new WebSocket(vinfo.webSocketDebuggerUrl);
    await new Promise((res, rej) => { bws.onopen = res; bws.onerror = rej; setTimeout(res, 2000); });
    const bres = await new Promise((res) => {
      const h = (ev2) => { try { const m2 = JSON.parse(ev2.data); if (m2.id === 1) { bws.removeEventListener('message', h); res(m2); } } catch (e) { /* ignore */ } };
      bws.addEventListener('message', h);
      bws.send(JSON.stringify({ id: 1, method: 'Browser.setDownloadBehavior', params: { behavior: 'allow', downloadPath: DL_DIR, eventsEnabled: true } }));
      setTimeout(() => res({ note: 'no response in 4s' }), 4000);
    });
    note('Browser.setDownloadBehavior -> ' + JSON.stringify(bres && (bres.result || bres.error || bres)).slice(0, 140));
    /* KEEP this socket open for the whole run: the override is session-scoped, and closing the
       socket reverts it (round 1: downloads silently fell back to the profile default folder) */
    globalThis.__rigBws = bws;
  } catch (e) { note('browser-level download behavior unavailable: ' + (e && e.message)); }

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) {
      const e = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'unknown';
      note('eval threw: ' + String(e).split('\n')[0].slice(0, 220));
      return { error: e };
    }
    return { value: r.result?.value };
  };
  const evQ = async (expr) => {
    try {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r.exceptionDetails) return { error: true };
      return { value: r.result?.value };
    } catch (e) { return { error: true }; }
  };
  const val = (r) => (r && r.value !== undefined) ? r.value : null;
  const until = async (expr, ms = 4000, step = 120) => {
    const t0 = Date.now();
    for (;;) {
      const r = await evQ(expr);
      if (r.value === true) return true;
      if (Date.now() - t0 > ms) return false;
      await sleep(step);
    }
  };
  const pollEval = async (expr, ms = 6000, step = 250) => {
    const t0 = Date.now();
    let last = null;
    for (;;) {
      const r = await evQ(expr);
      last = val(r);
      if (last) return last;
      if (Date.now() - t0 > ms) return last;
      await sleep(step);
    }
  };
  const installPlatw = async () => {
    for (let i = 0; i < 12; i++) {
      await ev('(' + PLATW_INSTALL.toString() + ')()').catch(() => { });
      const ok = val(await evQ('!!(window.__platw && window.__platw.v === 1)')) === true;
      if (ok) return true;
      await sleep(250);
    }
    note('SPEC: __platw failed to install on the current document');
    return false;
  };
  const waitForPage = async (prefix, ms = 40000) => {
    const t0 = Date.now();
    let last = null;
    for (;;) {
      last = val(await evQ('window.__platw ? window.__platw.pageState() : (function () { try { return { href: String(location.href), ready: document.documentElement.getAttribute("data-av-ready"), to: performance.timeOrigin }; } catch (e) { return null; } })()'));
      if (last && String(last.href).startsWith(prefix) && last.ready === '1') return last;
      if (Date.now() - t0 > ms) return last;
      await sleep(250);
    }
  };
  const waitForRoot = async (ms = 40000) => {
    const t0 = Date.now();
    let last = null;
    for (;;) {
      last = val(await evQ('window.__platw ? window.__platw.pageState() : (function () { try { return { href: String(location.href), ready: document.documentElement.getAttribute("data-av-ready"), to: performance.timeOrigin }; } catch (e) { return null; } })()'));
      if (last && String(last.href) === ROOT + '/' && last.ready === '1') return last;
      if (Date.now() - t0 > ms) return last;
      await sleep(250);
    }
  };
  const waitForReload = async (oldTO, ms = 40000) => {
    const t0 = Date.now();
    let last = null;
    for (;;) {
      last = val(await evQ('window.__platw ? window.__platw.pageState() : (function () { try { return { href: String(location.href), ready: document.documentElement.getAttribute("data-av-ready"), to: performance.timeOrigin }; } catch (e) { return null; } })()'));
      if (last && last.to !== oldTO && last.ready === '1') return last;
      if (Date.now() - t0 > ms) return last;
      await sleep(250);
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

  /* ════════════════ P1. manifest (pure server reads — no page needed) ════════════════ */
  console.log('== P1. manifest + icons (served) ==');
  let manStatus = 0, manMime = '', manRaw = null;
  try {
    const mr = await fetch(ROOT + '/manifest.webmanifest');
    manStatus = mr.status;
    manMime = mr.headers.get('content-type') || '';
    manRaw = await mr.text();
  } catch (e) { note('manifest fetch failed: ' + (e && e.message)); }
  let man = null; try { man = JSON.parse(manRaw); } catch (e) { man = null; }
  check('P1a manifest fetch: 200 + MIME application/manifest+json', manStatus === 200 && manMime === 'application/manifest+json', 'status ' + manStatus + ' · mime ' + J(manMime));
  const EXPECT_DESC = 'A MODDYS Foundry instrument \u2014 acid, wavetable, FM, string, drum, granular and sampler engines in one local-first browser synth.';
  const fieldsOk = !!man &&
    man.name === 'Anvil' && man.short_name === 'Anvil' && man.id === './' && man.start_url === './' &&
    man.scope === './' && man.display === 'standalone' && man.orientation === 'any' &&
    man.background_color === '#16140f' && man.theme_color === '#16140f' &&
    J(man.categories) === J(['music', 'entertainment']);
  check('P1b manifest fields: name/short_name/id/start_url/scope/display/orientation/colors/categories exact', fieldsOk,
    J(man ? { name: man.name, short_name: man.short_name, id: man.id, start_url: man.start_url, scope: man.scope, display: man.display, orientation: man.orientation, bg: man.background_color, theme: man.theme_color, cats: man.categories } : man));
  check('P1c manifest description: exact pin (em dash included)', !!man && man.description === EXPECT_DESC, J(man ? man.description : null));
  const fh = man && Array.isArray(man.file_handlers) ? man.file_handlers[0] : null;
  check('P1d manifest file_handlers: [{ action ./index.html, accept application/x-anvil-project [.anvl] }]',
    !!fh && fh.action === './index.html' && !!fh.accept && J(fh.accept['application/x-anvil-project']) === J(['.anvl']), J(man ? man.file_handlers : null));
  const icons = man && Array.isArray(man.icons) ? man.icons : [];
  const iconExp = [
    { src: './icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: './icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
  const iconsOk = icons.length === 3 && iconExp.every(e => {
    const got = icons.find(i => i && i.src === e.src);
    return !!got && got.sizes === e.sizes && got.type === e.type && got.purpose === e.purpose;
  });
  check('P1e manifest icons: 192 any + 512 any + 512 maskable present (paths/type/purpose exact)', iconsOk, J(icons));
  const iconFetches = [];
  for (const e of iconExp) {
    const u = ROOT + '/' + e.src.replace(/^\.\//, '');
    try {
      const r = await fetch(u);
      const b = new Uint8Array(await r.arrayBuffer());
      iconFetches.push({ src: e.src, status: r.status, mime: r.headers.get('content-type') || '', magic: b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47, bytes: b.length });
    } catch (err) { iconFetches.push({ src: e.src, err: String(err && err.message) }); }
  }
  check('P1f icons fetch: each 200 + image/png + PNG magic', iconFetches.length === 3 && iconFetches.every(f => f.status === 200 && f.mime === 'image/png' && f.magic === true && f.bytes > 40), J(iconFetches));

  /* ════════════════ boot: navigate to the served page ════════════════ */
  console.log('== 0. boot (served page) ==');
  await send('Page.navigate', { url: ROOT + '/' });
  await send('Page.bringToFront').catch(() => { });
  const bootPage = await waitForPage('http://127.0.0.1:' + SRV_PORT, 45000);
  note('first load: ' + J(bootPage && { href: bootPage.href, ready: bootPage.ready }));
  if (!bootPage || bootPage.ready !== '1') { console.error('APP NOT READY on the served page'); process.exit(1); }

  /* the SW claims clients on first activate — wait for it, then a settle re-poll (a claim-time
     reload, if any, must land before the sections below read state) */
  let controlled = false;
  for (let i = 0; i < 60 && !controlled; i++) {
    controlled = val(await evQ('!!(navigator.serviceWorker && navigator.serviceWorker.controller)')) === true;
    if (!controlled) await sleep(200);
  }
  await sleep(800);
  const bootSettle = await waitForPage('http://127.0.0.1:' + SRV_PORT, 15000);
  note('controlled: ' + controlled + ' · settled: ' + J(bootSettle && { href: bootSettle.href, ready: bootSettle.ready, to: bootSettle.to }));

  await installPlatw();
  let boot0 = null;
  for (let i = 0; i < 20; i++) {
    boot0 = val(await ev(`(async () => {
      try {
        const out = { ready: document.documentElement.getAttribute('data-av-ready'), ctx: null, sr: null, nodes: 0 };
        let ctx = null;
        try { if (typeof avTap !== 'undefined' && avTap && avTap.ctx) ctx = avTap.ctx; } catch (e) { }
        let nodes = 0;
        try { if (typeof avMasterNodes === 'function') { const list = avMasterNodes() || []; nodes = list.length; if (!ctx && list[0] && list[0].context) ctx = list[0].context; } } catch (e) { }
        if (ctx && ctx.state !== 'running') { try { await Promise.race([ctx.resume().catch(function () { }), new Promise(function (res) { setTimeout(res, 2000); })]); } catch (e) { } }
        out.ctx = ctx ? String(ctx.state) : null;
        out.sr = ctx ? ctx.sampleRate : null;
        out.nodes = nodes;
        return out;
      } catch (e) { return { err: String((e && e.message) || e) }; }
    })()`)) || {};
    if (boot0.ready === '1' && boot0.ctx === 'running' && Number(boot0.sr) === 48000 && boot0.nodes >= 1) break;
    await sleep(400);
  }
  check('0a boot: data-av-ready flips + live ctx running (48 kHz) + master node on the tap', boot0.ready === '1' && boot0.ctx === 'running' && Number(boot0.sr) === 48000 && boot0.nodes >= 1, J(boot0));

  const legChk = val(await ev(`(function () {
    var need = ['num', 'safe', 'j', 'domGet', 'txt', 'counter', 'light', 'ready', 'pageState', 'pwaState', 'famState', 'ensureCtx', 'masterPick', 'witRelease', 'witArm', 'fp', 'idbOut', 'stubOpen', 'openGet'];
    var miss = [];
    for (var i = 0; i < need.length; i++) { var t = typeof (window.__platw ? window.__platw[need[i]] : undefined); if (t !== 'function') miss.push(need[i] + ':' + t); }
    return { v: (window.__platw && window.__platw.v) || null, miss: miss, rows: document.querySelectorAll('.av-fam-row').length };
  })()`)) || {};
  check('0b rig helpers injected + av-fam-row count probe', legChk.v === 1 && Array.isArray(legChk.miss) && legChk.miss.length === 0, J(legChk));

  const surf0 = val(await ev(`(function () {
    try {
      return {
        pwa: !!window.__avPwa, fam: !!window.__avFamily,
        pwaState: typeof (window.__avPwa && window.__avPwa.state) === 'function',
        ip: typeof (window.__avPwa && window.__avPwa.installPrompt) === 'function',
        send: typeof (window.__avFamily && window.__avFamily.send) === 'function',
        importPack: typeof (window.__avFamily && window.__avFamily.importPack) === 'function',
        preview: typeof (window.__avFamily && window.__avFamily.preview) === 'function',
        save: typeof (window.__avFamily && window.__avFamily.save) === 'function',
        stop: typeof (window.__avFamily && window.__avFamily.stop) === 'function',
        openRadio: typeof (window.__avFamily && window.__avFamily.openRadio) === 'function',
        setPackBase: typeof (window.__avFamily && window.__avFamily.setPackBase) === 'function',
        rows: document.querySelectorAll('.av-fam-row').length,
      };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  })()`)) || {};
  check('0c platform surface: __avPwa (state/installPrompt) + __avFamily (send/importPack/preview/save/stop/openRadio/setPackBase) + exactly 3 .av-fam-row',
    surf0.pwa === true && surf0.fam === true && surf0.pwaState === true && surf0.ip === true && surf0.send === true && surf0.importPack === true &&
    surf0.preview === true && surf0.save === true && surf0.stop === true && surf0.openRadio === true && surf0.setPackBase === true && surf0.rows === 3, J(surf0));
  if (surf0.pwa !== true || surf0.fam !== true) { console.error('PLATFORM MODULES MISSING — the parent integration build is not landed'); process.exit(1); }

  /* ════════════════ P2. registration over http + the file:// guard leg ════════════════ */
  console.log('== P2. service worker registration (http) + file:// guard ==');
  const st2 = await pollEval(`(function () { try { const st = window.__platw.pwaState(); if (st && st.supported === true && st.registered === true) return st; return null; } catch (e) { } return null; })()`, 10000, 300) || (val(await ev('window.__platw.pwaState()')) || {});
  check('P2a http origin: __avPwa.supported === true', st2.supported === true, J(st2));
  check('P2b registration: registered + swUrl ends /sw.js', st2.registered === true && /\/sw\.js$/.test(String(st2.swUrl || '')), J({ registered: st2.registered, swUrl: st2.swUrl }));
  const sc2 = val(await ev(`(async () => { try { const reg = await Promise.race([navigator.serviceWorker.getRegistration(), new Promise(function (res) { setTimeout(function () { res(null); }, 3000); })]); const st = window.__platw.pwaState(); return { regScope: reg ? String(reg.scope) : null, stateScope: st ? st.scope : null }; } catch (e) { return { err: String((e && e.message) || e) }; } })()`)) || {};
  check('P2c scope: live registration scope === ' + ROOT + '/ (the ./ scope)', sc2.regScope === ROOT + '/', J(sc2));
  const rd2p = await pollEval(`(async () => { try { const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(function (res) { setTimeout(function () { res(null); }, 6000); })]); const act = !!(reg && reg.active && reg.active.state === 'activated'); const ctl = !!navigator.serviceWorker.controller; if (reg && act && ctl) return { ready: true, active: true, state: reg.active.state, controlled: true }; return null; } catch (e) { return null; } })()`, 9000, 300);
  const rd2 = rd2p || val(await ev(`(async () => { try { const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(function (res) { setTimeout(function () { res(null); }, 4000); })]); return { ready: !!reg, active: !!(reg && reg.active), state: reg && reg.active ? reg.active.state : null, controlled: !!navigator.serviceWorker.controller }; } catch (e) { return { err: String((e && e.message) || e) }; } })()`)) || {};
  check('P2d navigator.serviceWorker.ready resolves + active + page controlled', rd2.ready === true && rd2.active === true && rd2.controlled === true, J(rd2));

  const errsBeforeFile = errors.length;
  await send('Page.navigate', { url: FILE_URL });
  const fileLeg = await waitForPage('file://', 40000);
  const f2 = val(await ev(`(async () => {
    const out = { href: null, supported: null, hasSW: null, reg: 'n/a', pwaErrors: null, errors0: null, err: null };
    try {
      out.href = String(location.href);
      out.hasSW = (typeof navigator.serviceWorker !== 'undefined' && !!navigator.serviceWorker);
      out.supported = (window.__avPwa && typeof window.__avPwa.state === 'function') ? window.__avPwa.state().supported : (window.__avPwa ? window.__avPwa.supported : null);
      if (out.hasSW) {
        try { const r = await Promise.race([navigator.serviceWorker.getRegistration(), new Promise(function (res) { setTimeout(function () { res('timeout'); }, 3000); })]); out.reg = (r === null || r === undefined) ? 'none' : (typeof r === 'string' ? r : 'SOME'); } catch (e) { out.reg = 'err'; }
      }
      try {
        const pst = (window.__avPwa && typeof window.__avPwa.state === 'function') ? window.__avPwa.state() : null;
        out.pwaErrors = (pst && Object.prototype.toString.call(pst.errors) === '[object Array]') ? pst.errors.length : null;
        out.errors0 = (pst && Object.prototype.toString.call(pst.errors) === '[object Array]' && pst.errors.length) ? String(pst.errors[0]).slice(0, 140) : null;
      } catch (e) { out.pwaErrors = null; }
    } catch (e) { out.err = String((e && e.message) || e); }
    return out;
  })()`)) || {};
  check('P2e file:// guard: __avPwa.supported === false (no registration attempt)', !!fileLeg && String(fileLeg.href).startsWith('file://') && f2.supported === false, J(f2));
  check('P2f file:// guard: no SW registration + zero page errors during the leg', f2.supported === false && (f2.hasSW === false || f2.reg === 'none' || f2.reg === 'err') && (f2.pwaErrors === 0 || f2.pwaErrors === null) && errors.length === errsBeforeFile,
    J({ hasSW: f2.hasSW, reg: f2.reg, pwaErrors: f2.pwaErrors, errors0: f2.errors0, errDelta: errors.length - errsBeforeFile }));
  await send('Page.navigate', { url: ROOT + '/' });
  const back2 = await waitForRoot(40000);
  note('back on the served origin: ' + J(back2 && { href: back2.href, ready: back2.ready }));
  if (!back2 || back2.ready !== '1') { console.error('APP NOT READY after the file:// leg'); process.exit(1); }
  await installPlatw();

  /* ════════════════ P3. cache identity vs the SERVED bytes ════════════════ */
  console.log('== P3. cache anvil-<sha8> vs the served index.html sha ==');
  const c3 = val(await ev(`(async () => {
    try {
      const keys = await caches.keys();
      const resp = await caches.match('./index.html');
      let sha = null, bytes = 0;
      if (resp) {
        const ab = await resp.arrayBuffer();
        bytes = ab.byteLength;
        const d = await crypto.subtle.digest('SHA-256', ab);
        sha = Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
      }
      return { keys, hasOld: keys.indexOf('anvil-' + ${JSON.stringify(SHA8)}) >= 0, resp: !!resp, bytes, sha };
    } catch (e) { return { err: String((e && e.message) || e), keys: null }; }
  })()`)) || {};
  check('P3a caches.keys() includes anvil-' + SHA8 + ' (the SERVED index.html sha8)', Array.isArray(c3.keys) && c3.hasOld === true, J(c3.keys));
  check('P3b caches.match("./index.html") bytes sha256 === the served index.html sha', !!c3.resp && c3.sha === SRV_SHA, J({ resp: c3.resp, bytes: c3.bytes, sha: c3.sha, want: SRV_SHA.slice(0, 16) + '...' }));
  const servedSw = readFileSync(path.join(SERVED_DIR, 'sw.js'), 'utf8');
  let swTok = null;
  const swM = servedSw.match(/SW_VERSION\s*=\s*"([0-9a-f]{8})"/);
  if (swM) swTok = swM[1];
  check('P3c served sw.js SW_VERSION token carries the same sha8 (sw.js on disk)', swTok === SHA8, J({ token: swTok, want: SHA8 }));

  /* ════════════════ P4. offline boot via CDP network emulation ════════════════ */
  console.log('== P4. offline (CDP Network.emulateNetworkConditions) ==');
  const errsBeforeOffline = errors.length;
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await sleep(250);
  const to4 = val(await ev('performance.timeOrigin'));
  await send('Page.reload');
  const rel4 = await waitForReload(to4, 45000);
  await installPlatw();
  const st4 = val(await evQ('window.__platw ? window.__platw.pageState() : null')) || {};
  check('P4a offline reload boots: data-av-ready + navigator.onLine === false', !!rel4 && rel4.ready === '1' && st4.ready === '1' && st4.online === false, J({ rel: rel4 && { href: rel4.href, ready: rel4.ready }, online: st4.online }));
  const offUi = await pollEval(`(function () { try { const b = (document.body && document.body.className) ? String(document.body.className) : ''; const el = document.getElementById('av-pwa-offline'); const vis = !!(el && el.getClientRects && el.getClientRects().length > 0); if (b.indexOf('av-pwa-offline') >= 0 && el && vis) return { cls: true, chip: true, vis: vis }; } catch (e) { } return null; })()`, 8000, 300);
  const offUi2 = offUi || (val(await ev(`(function () { try { const b = (document.body && document.body.className) ? String(document.body.className) : ''; const el = document.getElementById('av-pwa-offline'); return { cls: b.indexOf('av-pwa-offline') >= 0, chip: !!el, vis: !!(el && el.getClientRects && el.getClientRects().length > 0) }; } catch (e) { return { err: String((e && e.message) || e) }; } })()`)) || {});
  check('P4b offline state: body class av-pwa-offline', offUi2.cls === true, J(offUi2));
  check('P4c offline chip: #av-pwa-offline visible', offUi2.chip === true && offUi2.vis === true, J(offUi2));
  const nav4 = val(await ev(`(function () { try { const n = performance.getEntriesByType('navigation')[0] || null; const len = document.documentElement.outerHTML.length; return { n: n ? { transferSize: n.transferSize, decodedBodySize: n.decodedBodySize, encodedBodySize: n.encodedBodySize, workerStart: n.workerStart, responseStart: n.responseStart, duration: n.duration, type: n.type } : null, docLen: len }; } catch (e) { return { err: String((e && e.message) || e) }; } })()`)) || {};
  const nn4 = nav4.n;
  const cacheProof = !!nn4 && (nn4.transferSize === 0 || (typeof nn4.workerStart === 'number' && nn4.workerStart > 0));
  check('P4d served-from-cache proof: nav transferSize 0 OR workerStart > 0 + full doc (' + (nav4.docLen != null ? nav4.docLen : '?') + ' chars)', cacheProof && typeof nav4.docLen === 'number' && nav4.docLen > 100000, J(nav4));
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const to4b = val(await ev('performance.timeOrigin'));
  await send('Page.reload');
  const rel4b = await waitForReload(to4b, 45000);
  check('P4e back online: reload lands live (navigator.onLine true + ready)', !!rel4b && rel4b.ready === '1' && rel4b.online !== false, J(rel4b && { href: rel4b.href, online: rel4b.online, ready: rel4b.ready }));
  await installPlatw();

  /* ════════════════ P5. update flow (rewrite the temp sw.js) ════════════════ */
  console.log('== P5. update flow ==');
  /* sanctioned noise: a fetch attempt while the network is emulated-offline logs a browser-level
     net::ERR_* console message that no page code can suppress. The rig sanctions exactly those
     classes, only for the P4 window, and reports the count (everything else still fails P10). */
  const offlineNoise = [];
  { const kept = [];
    for (let i = 0; i < errors.length; i++) {
      const e2 = errors[i];
      if (typeof errsBeforeOffline === 'number' && i >= errsBeforeOffline && /net::ERR_(INTERNET_DISCONNECTED|NETWORK_CHANGED|FAILED|NAME_NOT_RESOLVED)/.test(e2)) offlineNoise.push(e2);
      else kept.push(e2);
    }
    errors.length = 0; for (const k of kept) errors.push(k); }
  note('sanctioned offline-window net failures: ' + offlineNoise.length);
  const swPath = path.join(SERVED_DIR, 'sw.js');
  let swDisk = readFileSync(swPath, 'utf8');
  const oldM = swDisk.match(/SW_VERSION\s*=\s*"([0-9a-f]{8})"/);
  const vOld = oldM ? oldM[1] : null;
  const NEWV = (vOld === 'deadbeef') ? 'feedface' : 'deadbeef';
  let rewriteOk = false;
  if (vOld) {
    swDisk = swDisk.replace(/(SW_VERSION\s*=\s*")[0-9a-f]{8}(")/, '$1' + NEWV + '$2');
    swDisk += '\n/* platform-rig update touch ' + Date.now() + ' */\n';
    writeFileSync(swPath, swDisk);
    rewriteOk = true;
    note('temp sw.js rewritten: SW_VERSION ' + vOld + ' -> ' + NEWV);
  } else {
    note('SPEC: could not locate SW_VERSION = "<8-hex>" in the served sw.js — the update leg is expected to fail');
  }
  const upd5 = val(await ev(`(async () => { try { const reg = await Promise.race([navigator.serviceWorker.getRegistration(), new Promise(function (res) { setTimeout(function () { res(null); }, 3000); })]); if (!reg) return { noReg: true }; await Promise.race([reg.update(), new Promise(function (res) { setTimeout(function () { res('timeout'); }, 12000); })]); return { called: true }; } catch (e) { return { err: String((e && e.message) || e) }; } })()`)) || {};
  note('reg.update(): ' + J(upd5) + ' · rewriteOk ' + rewriteOk);
  const post5 = val(await ev(`(async () => { try { const reg = await navigator.serviceWorker.getRegistration(); return { inst: !!(reg && reg.installing), wait: !!(reg && reg.waiting), act: !!(reg && reg.active) }; } catch (e) { return { err: String((e && e.message) || e) }; } })()`));
  note('post-update worker states: ' + JSON.stringify(post5));
  let wait5 = null;
  const seen5 = [];
  for (let i = 0; i < 60; i++) {
    wait5 = val(await evQ(`(async () => {
      try {
        const reg = await Promise.race([navigator.serviceWorker.getRegistration(), new Promise(function (res) { setTimeout(function () { res(null); }, 2000); })]);
        const st = window.__platw.pwaState();
        const cls = (document.body && String(document.body.className)) || '';
        const chip = document.getElementById('av-pwa-update');
        const vis = !!(chip && chip.getClientRects && chip.getClientRects().length > 0);
        return { installing: !!(reg && reg.installing), instState: (reg && reg.installing && reg.installing.state) || null, waiting: !!(reg && reg.waiting), stateWaiting: (st && st.waiting === true), active: !!(reg && reg.active), cls: cls.indexOf('av-pwa-update') >= 0, chip: !!chip, chipVis: vis };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    })()`)) || {};
    const sig5 = (wait5.installing ? 'I' : '-') + (wait5.waiting ? 'W' : '-') + (wait5.active ? 'A' : '-') + (wait5.cls ? 'C' : '-') + (wait5.chipVis ? 'V' : '-');
    if (!seen5.length || seen5[seen5.length - 1] !== sig5) seen5.push(sig5);
    if ((wait5.waiting || wait5.stateWaiting) && wait5.cls && wait5.chipVis) break;
    await sleep(250);
  }
  if (wait5) wait5 = Object.assign({}, wait5, { seen: seen5.slice(0, 16) });
  check('P5a update found: registration.waiting + body class av-pwa-update + chip visible', !!(wait5 && (wait5.waiting === true || wait5.stateWaiting === true) && wait5.cls === true && wait5.chipVis === true), J(wait5));
  const to5 = val(await ev('performance.timeOrigin'));
  const chipClick = await clickSel('#av-pwa-update', 250);
  if (chipClick !== true) {
    note('chip mouse click failed — DOM click fallback');
    await ev('(function () { try { const el = document.getElementById("av-pwa-update"); if (el && el.click) { el.click(); return true; } } catch (e) { } return false; })()');
  }
  const rel5 = await waitForReload(to5, 30000);
  check('P5b chip click -> reload once (controllerchange path)', !!rel5 && rel5.to !== to5 && rel5.ready === '1', J(rel5 && { href: rel5.href, ready: rel5.ready }));
  let keys5 = null;
  for (let i = 0; i < 40; i++) {
    keys5 = val(await evQ('caches.keys()')) || keys5;
    if (Array.isArray(keys5) && keys5.indexOf('anvil-' + NEWV) >= 0 && keys5.indexOf('anvil-' + vOld) < 0) break;
    await sleep(250);
  }
  check('P5c activation: new cache anvil-' + NEWV + ' present + old anvil-' + vOld + ' gone', Array.isArray(keys5) && keys5.indexOf('anvil-' + NEWV) >= 0 && keys5.indexOf('anvil-' + vOld) < 0, J(keys5));
  await installPlatw();

  /* ════════════════ P6. install code path (synthetic event) ════════════════ */
  console.log('== P6. install code path (synthetic beforeinstallprompt — code-path test only) ==');
  await sleep(500);
  const ev6 = val(await ev(`(function () { try { window.__piCalls = 0; const e = new Event('beforeinstallprompt'); e.prompt = function () { window.__piCalls++; return Promise.resolve(); }; e.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' }); window.dispatchEvent(e); return { dispatched: true }; } catch (err) { return { dispatched: false, err: String((err && err.message) || err) }; } })()`)) || {};
  const ip6 = val(await ev(`(function () { try { const ip = (window.__avPwa && typeof window.__avPwa.installPrompt === 'function') ? window.__avPwa.installPrompt() : null; return { truthy: !!ip, hasPrompt: !!(ip && typeof ip.prompt === 'function'), hasChoice: !!(ip && ip.userChoice) }; } catch (e) { return { err: String((e && e.message) || e) }; } })()`)) || {};
  check('P6a synthetic beforeinstallprompt captured: __avPwa.installPrompt() truthy (+prompt/userChoice stubs)', ev6.dispatched === true && ip6.truthy === true && ip6.hasPrompt === true, J({ ev6: ev6, ip6: ip6 }));
  const inst6 = await pollEval(`(function () { try { const el = document.getElementById('av-pwa-install'); if (!el) return null; const vis = !!(el.getClientRects && el.getClientRects().length > 0); return vis ? { vis: true } : null; } catch (e) { } return null; })()`, 6000, 250);
  check('P6b install affordance: #av-pwa-install visible after the event', !!(inst6 && inst6.vis === true), J(inst6));
  const err6 = errors.length;
  const click6 = await clickSel('#av-pwa-install', 600);
  if (click6 !== true) await ev('(function () { try { const el = document.getElementById("av-pwa-install"); if (el && el.click) { el.click(); return true; } } catch (e) { } return false; })()');
  const p6 = val(await ev(`(function () { try { const st = window.__avPwa.state(); return { calls: window.__piCalls, errorsN: (Object.prototype.toString.call(st.errors) === '[object Array]') ? st.errors.length : null }; } catch (e) { return { err: String((e && e.message) || e) }; } })()`)) || {};
  check('P6c prompt() code path: click -> prompt called once, userChoice dismissed, no crash (never a real install)',
    p6.calls === 1 && (p6.errorsN === 0 || p6.errorsN === null) && errors.length === err6, J({ p6: p6, errDelta: errors.length - err6 }));

  /* ════════════════ P7. family HUB -> inbox ════════════════ */
  console.log('== P7. family HUB -> inbox.html ==');
  const pat7 = val(await ev(BUILD_PATTERN)) || {};
  check('P7a pattern: avSeqLoad (cdp_bounce BUILD_PATTERN shape — 16-step x 4 tracks, bpm 120)', pat7.ok === true && pat7.name === 'RIG PAT 1', J(pat7));
  await ev('window.__platw.stubOpen()');
  const send7 = val(await ev(`(async () => { try { const r = await Promise.race([ window.__avFamily.send({ loops: 2 }), new Promise(function (res) { setTimeout(function () { res({ ok: false, error: 'rig timeout 45s' }); }, 45000); }) ]); return { ok: r.ok === true, via: r.via || null, bytes: (typeof r.bytes === 'number') ? r.bytes : null, sec: (typeof r.sec === 'number') ? r.sec : null, bpm: (typeof r.bpm === 'number') ? r.bpm : null, bars: (typeof r.bars === 'number') ? r.bars : null, name: (typeof r.name === 'string') ? r.name : null, loops: r.loops, error: r.error || null, note: r.note || null }; } catch (e) { return { ok: false, thrown: String((e && e.message) || e) }; } })()`)) || {};
  check('P7b hub send: receipt ok via "inbox" (loops 2 · ' + (send7.sec != null ? fx3(send7.sec) : '?') + ' s · ' + (send7.bytes || '?') + ' bytes)', send7.ok === true && send7.via === 'inbox' && typeof send7.bytes === 'number' && send7.bytes > 44 && typeof send7.name === 'string' && send7.name.length > 0, J(send7));
  const open7 = val(await ev('window.__platw.openGet()')) || [];
  const hit7 = open7.find(o => /inbox\.html$/.test(String(o.url)) && o.target === 'av-hub-inbox');
  check('P7c window.open: ./inbox.html + named target av-hub-inbox (never about:blank, never _blank)', !!hit7 && hit7.url !== 'about:blank' && hit7.target !== '_blank', J(open7));
  const idb7 = val(await ev('window.__platw.idbOut()')) || {};
  check('P7d bridge record in IDB moddys-bridges/outbox (1 row · kind loop · name/bpm/sr/ch/bytes/wav consistent)',
    idb7.n === 1 && !!idb7.row && idb7.row.kind === 'loop' && idb7.row.name === send7.name && idb7.row.bpm === 120 && idb7.row.sr === 48000 && idb7.row.ch === 2 &&
    typeof idb7.row.bytes === 'number' && idb7.row.bytes > 44 && idb7.row.wavBytes === idb7.row.bytes, J(idb7));

  await send('Page.navigate', { url: ROOT + '/inbox.html' });
  const inboxReady = await until(`(function () { try { return location.pathname === '/inbox.html' && document.readyState === 'complete' && !!(window.__avInbox && typeof window.__avInbox.list === 'function'); } catch (e) { return false; } })()`, 20000, 250);
  note('inbox page ready: ' + inboxReady);
  const LIST_EVAL = `(function () { try { const l = window.__avInbox.list(); const arr = Array.isArray(l) ? l : (l && Array.isArray(l.rows) ? l.rows : null); if (!arr) return { shape: String(typeof l) }; return { n: arr.length, rows: arr.slice(0, 6).map(function (r) { return (r && typeof r === 'object') ? { id: r.id, name: r.name, kind: r.kind, bpm: r.bpm, bars: r.bars, sec: r.sec, bytes: r.bytes, at: r.at } : String(r); }) }; } catch (e) { return { err: String((e && e.message) || e) }; } })()`;
  let list7 = null;
  for (let i = 0; i < 24; i++) {
    list7 = val(await ev(LIST_EVAL)) || {};
    if (list7.n === 1) break;
    await sleep(250);
  }
  check('P7e inbox list(): 1 row with the right name/bpm/bytes', list7.n === 1 && Array.isArray(list7.rows) && list7.rows[0] && list7.rows[0].name === send7.name && list7.rows[0].bpm === 120 && list7.rows[0].bytes === send7.bytes, J(list7));
  const dom7 = val(await ev(`(function () { try { const audios = Array.prototype.slice.call(document.querySelectorAll('audio')); const audio = audios.filter(function (a) { return String(a.currentSrc || a.src || '').indexOf('blob:') === 0; })[0] || null; const links = Array.prototype.slice.call(document.querySelectorAll('a[download]')); const link = links.filter(function (a) { return String(a.href || '').indexOf('blob:') === 0; })[0] || null; return { audios: audios.length, audioBlob: audio ? String(audio.src || audio.currentSrc).slice(0, 48) : null, links: links.length, dlName: link ? String(link.getAttribute('download') || '') : null, dlHref: link ? String(link.href).slice(0, 48) : null }; } catch (e) { return { err: String((e && e.message) || e) }; } })()`)) || {};
  check('P7f inbox audio: an <audio> element sourced from a blob: URL', typeof dom7.audioBlob === 'string' && dom7.audioBlob.indexOf('blob:') === 0, J({ audios: dom7.audios, audioBlob: dom7.audioBlob }));
  check('P7g inbox download: a[download] present with a blob: href', typeof dom7.dlHref === 'string' && dom7.dlHref.indexOf('blob:') === 0 && dom7.dlName !== null, J({ links: dom7.links, dlName: dom7.dlName, dlHref: dom7.dlHref }));
  const del7 = val(await ev(`(function () { try { const all = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"], a')); const b = all.filter(function (el) { return /delete|remove|trash|discard/i.test(String(el.textContent || '') + ' ' + String(el.getAttribute('data-act') || '') + ' ' + String(el.getAttribute('title') || '')); })[0] || null; if (!b) return { found: false, n: all.length }; b.id = 'rig-inbox-del'; return { found: true, tag: String(b.tagName), label: String(b.textContent || '').trim().slice(0, 40) }; } catch (e) { return { found: false, err: String((e && e.message) || e) }; } })()`)) || {};
  let delPath = null;
  if (del7.found === true) { await clickSel('#rig-inbox-del', 400); delPath = 'click'; }
  let list7b = null;
  for (let i = 0; i < 16; i++) {
    list7b = val(await ev(LIST_EVAL)) || {};
    if (list7b.n === 0) break;
    await sleep(250);
  }
  if (delPath !== null && (!list7b || list7b.n !== 0) && Array.isArray(list7 && list7.rows) && list7.rows[0] && list7.rows[0].id != null) {
    note('delete click did not clear — __avInbox.remove(id) fallback');
    await ev('(function () { try { return window.__avInbox.remove(' + JSON.stringify(String(list7.rows[0].id)) + ') === true; } catch (e) { return false; } })()');
    delPath = 'remove';
    for (let i = 0; i < 12; i++) {
      list7b = val(await ev(LIST_EVAL)) || {};
      if (list7b.n === 0) break;
      await sleep(250);
    }
  }
  check('P7h delete: row gone (__avInbox count 0)', delPath !== null && list7b.n === 0, J({ del: del7, path: delPath, after: list7b }));
  await send('Page.navigate', { url: ROOT + '/' });
  const back7 = await waitForRoot(40000);
  if (!back7 || back7.ready !== '1') { console.error('APP NOT READY after the inbox leg'); process.exit(1); }
  await installPlatw();

  /* ════════════════ P8. family RESONANCE ════════════════ */
  console.log('== P8. family RESONANCE (import · preview witness · save · local · 404) ==');
  const ctx8 = val(await ev('window.__platw.ensureCtx()')) || {};
  note('ctx: ' + J(ctx8));
  const base8 = val(await ev(`window.__avFamily.setPackBase(${JSON.stringify(ROOT + '/fixtures')})`));
  const imp8 = val(await ev(`(async () => { try { const r = await Promise.race([ window.__avFamily.importPack('pack'), new Promise(function (res) { setTimeout(function () { res({ ok: false, error: 'rig timeout 30s' }); }, 30000); }) ]); return { ok: r.ok === true, source: r.source || null, sessions: (typeof r.sessions === 'number') ? r.sessions : null, failed: (typeof r.failed === 'number') ? r.failed : null, note: r.note || null, error: r.error || null }; } catch (e) { return { ok: false, thrown: String((e && e.message) || e) }; } })()`)) || {};
  const st8 = val(await ev('window.__platw.famState()')) || {};
  const sess8 = Array.isArray(st8.sessions) ? st8.sessions : [];
  const names8 = sess8.map(s => String(s.name || ''));
  check('P8a setPackBase(rig /fixtures/) + importPack("pack"): receipt ok · 2 sessions · both parsed', base8 === true && imp8.ok === true && imp8.sessions === 2 && imp8.failed === 0 && sess8.length === 2 && sess8.every(s => s.ok === true), J({ base: base8, imp: imp8, names: names8 }));
  check('P8b decoy skipped: no README session + the import note lists it', !names8.some(n => /readme/i.test(n)) && /README\.txt/i.test(String(imp8.note || '')), J({ note: imp8.note, names: names8 }));
  const idx8 = sess8.findIndex(s => /constant-tone/i.test(String(s.name || '')));
  if (idx8 < 0) note('SPEC: constant-tone session not found among ' + J(names8));
  const arm8 = val(await ev('window.__platw.witArm()')) || {};
  note('witness: ' + J(arm8));
  const pv8 = val(await ev(`(async () => { try { const r = await Promise.race([ window.__avFamily.preview(${idx8 >= 0 ? idx8 : 0}), new Promise(function (res) { setTimeout(function () { res({ ok: false, error: 'rig timeout 20s' }); }, 20000); }) ]); return { ok: r.ok === true, seconds: (typeof r.seconds === 'number') ? r.seconds : null, sr: (typeof r.sr === 'number') ? r.sr : null, frames: (typeof r.frames === 'number') ? r.frames : null, capped: r.capped === true, via: r.via || null, name: r.name || null, error: r.error || null }; } catch (e) { return { ok: false, thrown: String((e && e.message) || e) }; } })()`)) || {};
  check('P8c preview(' + (idx8 >= 0 ? idx8 : 0) + '): receipt ok via master-tap · ~30 s uncapped (the constant fixture)', pv8.ok === true && pv8.via === 'master-tap' && typeof pv8.seconds === 'number' && Math.abs(pv8.seconds - 30) <= 0.5 && pv8.capped === false && typeof pv8.frames === 'number' && pv8.frames > 100000, J(pv8));
  await sleep(450);
  const live8 = val(await ev('window.__platw.famState()')) || {};
  check('P8d preview live on the master tap: state().previewing true + lastRender ~30 s', live8.previewing === true && !!live8.lastRender && Math.abs(Number(live8.lastRender.seconds) - 30) <= 0.5, J({ previewing: live8.previewing, lastRender: live8.lastRender }));
  let wL = null, wR = null;
  for (let i = 0; i < 4; i++) {
    const l = val(await ev('window.__platw.fp("l")')) || {};
    const r = val(await ev('window.__platw.fp("r")')) || {};
    if (!wL || ((l.db || -999) + (r.db || -999)) > ((wL.db || -999) + (wR.db || -999))) { wL = l; wR = r; }
    const goodL = wL && wL.ok === true && typeof wL.hz === 'number' && Math.abs(wL.hz - 195) <= 1;
    const goodR = wR && wR.ok === true && typeof wR.hz === 'number' && Math.abs(wR.hz - 205) <= 1;
    if (goodL && goodR) break;
    await sleep(200);
  }
  await ev('window.__avFamily.stop()').catch(() => { });
  check('P8e witness LEFT: FFT peak ~195.0 Hz (base-beat/2) within 1 Hz — measured ' + fx3(wL && wL.hz) + ' Hz', !!(wL && wL.ok === true && typeof wL.hz === 'number' && Math.abs(wL.hz - 195) <= 1 && wL.db > -80), J(wL));
  check('P8f witness RIGHT: FFT peak ~205.0 Hz (base+beat/2) within 1 Hz — measured ' + fx3(wR && wR.hz) + ' Hz', !!(wR && wR.ok === true && typeof wR.hz === 'number' && Math.abs(wR.hz - 205) <= 1 && wR.db > -80), J(wR));
  const dlBefore = new Set();
  try { for (const f of readdirSync(DL_DIR)) dlBefore.add(f); } catch (e) { /* empty */ }
  await ev('(function () { try { delete window.showSaveFilePicker; } catch (e) { window.showSaveFilePicker = undefined; } return true; })()');
  const saveR = val(await ev(`(function () { try { if (!window.__avFamily || typeof window.__avFamily.save !== 'function') return { noFn: true }; const ret = window.__avFamily.save(); return { ret: ret === true ? true : (ret === false ? false : String(ret)), last: (window.__avFamilyLastDownload && typeof window.__avFamilyLastDownload === 'object') ? { name: window.__avFamilyLastDownload.name, bytes: window.__avFamilyLastDownload.bytes, via: window.__avFamilyLastDownload.via } : null }; } catch (e) { return { err: String((e && e.message) || e) }; } })()`)) || {};
  const saveVia = saveR.noFn === true ? 'button' : 'handle';
  if (saveR.noFn === true) { note('save() is not on the handle — #av-fam-res-save button fallback'); await clickSel('#av-fam-res-save', 500); }
  let wavFile = null, wavLen = 0, wavHead = '';
  for (let i = 0; i < 30 && !wavFile; i++) {
    try {
      const seen = readdirSync(DL_DIR).filter(f => !f.endsWith('.crdownload'));
      const cand = seen.find(f => !dlBefore.has(f));
      if (cand) {
        const buf = readFileSync(path.join(DL_DIR, cand));
        wavFile = cand; wavLen = buf.length; wavHead = buf.subarray(0, 12).toString('latin1');
      }
    } catch (e) { /* dir race */ }
    if (!wavFile) await sleep(400);
  }
  const riffOk = wavHead.startsWith('RIFF') && wavHead.slice(8, 12) === 'WAVE';
  check('P8g save: WAV lands on disk — RIFF/WAVE magic + len > 44 (' + (wavFile || 'no file') + ' · ' + wavLen + ' B · via ' + saveVia + ')', !!wavFile && wavLen > 44 && riffOk && (saveR.ret === true || saveVia === 'button'), J({ ret: saveR.ret, via: saveVia, last: saveR.last, file: wavFile, len: wavLen, head: wavHead }));
  const local8 = val(await ev(`(async () => {
    try {
      const resp = await fetch(${JSON.stringify(ROOT + '/fixtures/rig-loose-tone.gnaural')});
      if (!resp || resp.ok !== true) return { ok: false, why: 'fixture fetch status ' + (resp ? resp.status : 'null') };
      const text = await resp.text();
      const input = document.getElementById('av-fam-res-file');
      if (!input) return { ok: false, why: 'no #av-fam-res-file input' };
      const before = (window.__avFamily.state().sessions || []).map(function (s) { return s.name; });
      const file = new File([text], 'rig-loose-tone.gnaural', { type: 'application/xml' });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const t0 = Date.now();
      for (;;) {
        const st = window.__avFamily.state();
        const sess = (st.sessions || []);
        const names = sess.map(function (s) { return s.name; });
        const mine = sess.filter(function (s) { return /rig-loose-tone/i.test(String(s.name || '')); });
        if (mine.length && mine[0].ok === true) return { ok: true, before: before, after: names, count: sess.length };
        if (Date.now() - t0 > 9000) return { ok: false, timeout: true, before: before, after: names, status: st.statuses ? st.statuses.resonance : null };
        await new Promise(function (r) { setTimeout(r, 250); });
      }
    } catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
  })()`)) || {};
  check('P8h local-file leg: synthesized File (DataTransfer) -> session rig-loose-tone imported (append or replace per design)', local8.ok === true && Array.isArray(local8.after) && local8.after.some(n => /rig-loose-tone/i.test(String(n))), J(local8));
  const errsBefore404 = errors.length;
  const miss8 = val(await ev(`(async () => { try { const r = await Promise.race([ window.__avFamily.importPack('rig-404-does-not-exist'), new Promise(function (res) { setTimeout(function () { res({ ok: false, error: 'rig timeout 20s' }); }, 20000); }) ]); return { ok: r.ok === true, error: r.error || null, note: r.note || null }; } catch (e) { return { ok: false, thrown: String((e && e.message) || e) }; } })()`)) || {};
  const hits404 = reqLog.get('/fixtures/rig-404-does-not-exist.zip') || 0;
  check('P8i 404 refusal: ok:false + honest note + HTTP 404 seen (the server request arrived)', miss8.ok === false && typeof miss8.error === 'string' && /HTTP 404/.test(miss8.error) && typeof miss8.note === 'string' && miss8.note.length > 0 && hits404 >= 1, J({ miss: miss8, hits: hits404 }));
  /* this leg WANTS its 404; the browser-level console message it causes is sanctioned for exactly
     this window (counted + reported in P10), never for any other 404. */
  await sleep(300);
  const refusal404 = [];
  { const kept = [];
    for (let i = 0; i < errors.length; i++) {
      const e2 = errors[i];
      if (typeof errsBefore404 === 'number' && i >= errsBefore404 && /status of 404/.test(e2)) refusal404.push(e2);
      else kept.push(e2);
    }
    errors.length = 0; for (const k of kept) errors.push(k); }
  note('sanctioned refusal 404 console messages: ' + refusal404.length);

  /* ════════════════ P9. family RADIO ════════════════ */
  console.log('== P9. family RADIO (rbg-last seed · deep link · OPEN RADIO) ==');
  const seed9 = JSON.stringify({ m: { n: 'Test FM', i: 'x', c: 'Australia' }, ts: Date.now() });
  await ev('(function () { try { localStorage.setItem("rbg-last", ' + JSON.stringify(seed9) + '); return true; } catch (e) { return false; } })()');
  const to9 = val(await ev('performance.timeOrigin'));
  await send('Page.reload');
  const rel9 = await waitForReload(to9, 40000);
  await installPlatw();
  let row9 = null;
  for (let i = 0; i < 20; i++) {
    row9 = val(await ev(`(function () { try { const rows = Array.prototype.slice.call(document.querySelectorAll('.av-fam-row')); const radio = rows.filter(function (r) { return /RADIO/i.test(String(r.textContent || '')); })[0] || null; const txt = radio ? String(radio.textContent || '').replace(/\\s+/g, ' ').trim() : null; const st = (window.__avFamily && typeof window.__avFamily.state === 'function') ? window.__avFamily.state() : null; return { rows: rows.length, txt: txt ? txt.slice(0, 300) : null, name: st && st.radio ? st.radio.name : null, ok: st && st.radio ? st.radio.ok : null }; } catch (e) { return { err: String((e && e.message) || e) }; } })()`)) || {};
    if (row9.txt && row9.txt.indexOf('Test FM') >= 0) break;
    await sleep(300);
  }
  check('P9a rbg-last seed + reload: the radio row text carries "Test FM"', !!(rel9 && rel9.ready === '1') && typeof row9.txt === 'string' && row9.txt.indexOf('Test FM') >= 0, J(row9));
  const url9 = val(await ev(`window.__avFamily.openRadio('dub')`));
  check('P9b openRadio("dub") returns the exact radio hash deep link', url9 === 'https://moddys.net/#q=dub', J(url9));
  await ev('window.__platw.stubOpen()');
  const click9 = await clickSel('#av-fam-radio-open', 500);
  if (click9 !== true) {
    note('OPEN RADIO mouse click failed — DOM click fallback');
    await ev('(function () { try { const el = document.getElementById("av-fam-radio-open"); if (el && el.click) { el.click(); return true; } } catch (e) { } return false; })()');
  }
  const open9 = val(await ev('window.__platw.openGet()')) || [];
  const hit9 = open9.find(o => o.url === 'https://moddys.net/' && o.target === 'av-world-radio');
  check('P9c OPEN RADIO click: window.open("https://moddys.net/", "av-world-radio") captured', !!hit9, J(open9));

  /* ════════════════ P10. zero errors + seal ════════════════ */
  console.log('== P10 + seal ==');
  const sanctionedN = (typeof offlineNoise !== 'undefined' ? offlineNoise.length : 0) + (typeof refusal404 !== 'undefined' ? refusal404.length : 0);
  check('P10 zero page errors and console errors across every section', errors.length === 0, errors.length ? (errors.length + ' offenders: ' + errors.slice(0, 5).join(' | ')) : ('0 offenders (sanctioned: ' + sanctionedN + ' = P4 offline net failures + P8i refusal 404)'));

  const shaAfter = shaOf(page);
  console.log('index.html sha256 (after): ' + shaAfter);
  check('S1 freeze: repo index.html sha256 before === after (unchanged by the run)', shaAfter === shaBefore, shaAfter);
  if (PIN) check('S2 freeze pin leg: index.html sha256 = pinned', shaBefore === PIN && shaAfter === PIN, 'pinned ' + PIN.slice(0, 12) + '...');
  else note('S2 EXPECT_SHA not pinned — after the platform build, pass --sha <hex> or set the constant (never loosen)');

  const srvHits = [...reqLog.entries()].filter(([p]) => p.startsWith('/fixtures/')).map(([p, n]) => p + ' x' + n);
  note('server: ' + [...reqLog.values()].reduce((a, b) => a + b, 0) + ' requests total · fixtures: ' + (srvHits.length ? srvHits.join(' · ') : 'none'));

  console.log('');
  console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
  console.log('PLATFORM-RESULT ' + pass + '/' + (pass + fail) + (fail ? ' FAILED' : ' PASSED'));
  console.log('PLATFORM-RESULT-JSON ' + JSON.stringify({ kind: 'anvil-cdp-platform', sha256Before: shaBefore, sha256After: shaAfter, servedIndexSha: SRV_SHA, pinned: PIN || null, passed: pass, failed: fail, checks: pass + fail, verdict: fail ? 'fail' : 'pass' }));
}

main().then(() => {
  shutdown();
  process.exit(fail ? 1 : 0);
}).catch(err => {
  console.error('platform harness crashed:', err);
  shutdown();
  process.exit(1);
});
