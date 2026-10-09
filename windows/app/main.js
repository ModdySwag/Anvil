/* Anvil - Windows desktop shell (Electron main process).
 *
 * Why this shape: the app is ONE self-contained HTML file (index.html carries its whole
 * runtime - no external script/style/font URLs at all) plus the PWA furniture the build
 * ships beside it (sw.js, manifest.webmanifest, the three icons, packs/, inbox.html).
 * Rather than re-implement anything, the shell serves those exact bytes over a loopback
 * HTTP server - the same origin shape (a secure context) the app was built and gated on
 * at moddys.net/anvil/. The app file itself is never modified: it is byte-identical to
 * the frozen, gated build, and the build script proves that before packaging.
 *
 * Loopback HTTP (not file://) on purpose: a secure origin is what AudioWorklet, Web MIDI,
 * the File System Access picks, the clipboard, a stable localStorage/IndexedDB origin and
 * the service-worker scope all need, and it is the exact context the live site runs in.
 *
 * Ported from the two shipped sibling shells (D1 of verify/_d_wave.md):
 *   C:/Users/Moddy/pattern-forge/windows/app/main.js     - PRIMARY (same family of web synth)
 *   C:/Users/Moddy/webmusic-hub/windows/app/main.js      - Resonance Studio (newest)
 * Deviations are named in the D1 report.
 *
 * Env hooks (used by the verification harness; harmless in normal use). AV_ is the family
 * prefix; the APP_ spellings are accepted as aliases because the D-wave contract phrases
 * the hooks as APP_* ("prefix-adjusted") - AV_ wins when both are set:
 *   AV_TEST=1          mute the audio output (the graph still runs; analysers still read)
 *   AV_DEBUG_PORT=n    open a CDP endpoint on 127.0.0.1:n
 *   AV_DL_DIR=<dir>    save downloads to <dir> instead of the Downloads folder (test hook)
 *   AV_OFFLINE=1       drop every non-loopback request (proves what boots without network)
 *   AV_PORT=n          preferred port for the loopback server (default 47900)
 *
 * No console windows: this file spawns nothing - there is no child_process use anywhere.
 *
 * ONE writer (D1).
 */
'use strict';

const { app, BrowserWindow, Menu, dialog, shell, session, net } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const BUILD = readJson(path.join(ROOT, 'build-info.json')) || {};
const PORT_DEFAULT = 47900;        // PF 47800, Resonance 47850 - the next slot in the family

/* env hooks: AV_* primary, APP_* alias (see the header) */
function hook(name) {
  const v = process.env['AV_' + name];
  if (v !== undefined) return v;
  const alias = process.env['APP_' + name];
  return alias === undefined ? '' : alias;
}

const TEST_MUTE = hook('TEST') === '1';
const OFFLINE = hook('OFFLINE') === '1';
const DL_DIR = hook('DL_DIR');
const DEBUG_PORT = hook('DEBUG_PORT');
const PORT_PREF = Number(hook('PORT') || PORT_DEFAULT) || PORT_DEFAULT;

function log(...parts) { console.log('[anvil]', ...parts); }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

/* ---------------------------------------------------------------- the loopback server */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.zip': 'application/zip',
  '.wav': 'audio/wav',
};

/* These can be replaced by an upgrade: never let Chromium serve a stale copy from cache. */
const NO_CACHE = new Set(['.html', '.js', '.mjs', '.css', '.webmanifest']);

/* Resolve a request path to a file inside ROOT (or null). Never escapes ROOT: a local server
 * that can read the whole disk would be a hole in an app that renders user-supplied text. */
function resolveRequestPath(urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath.split('?')[0].split('#')[0]); }
  catch (e) { return null; }
  if (rel.indexOf('\u0000') !== -1) return null;
  if (rel === '/' || rel === '') rel = '/index.html';
  if (!rel.startsWith('/')) return null;
  const abs = path.normalize(path.join(ROOT, rel));
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  return abs;
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      const abs = resolveRequestPath(req.url || '/');
      if (!abs) { res.writeHead(403).end(); return; }
      fs.stat(abs, (err, st) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }
        /* a directory means its index.html - /packs/ style links keep working */
        if (st.isDirectory()) {
          const idx = path.join(abs, 'index.html');
          if (!idx.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
          return serveFile(idx, res, req);
        }
        if (!st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }
        serveFile(abs, res, req);
      });
    });
    function serveFile(abs, res, req) {
      fs.stat(abs, (err2, st2) => {
        if (err2 || !st2.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }
        const ext = path.extname(abs).toLowerCase();
        const headers = {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Content-Length': st2.size,
          'Cache-Control': NO_CACHE.has(ext) ? 'no-cache' : 'public, max-age=31536000, immutable',
        };
        res.writeHead(200, headers);
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(abs).pipe(res);
      });
    }
    server.on('error', reject);
    // a stable port keeps the app's origin - and with it localStorage, IndexedDB and the
    // service-worker scope - stable across launches. Fall back only if something else
    // really holds it, and say so.
    let attempt = 0;
    const tryListen = () => {
      const port = PORT_PREF + attempt;
      const onError = (err) => {
        if (err && err.code === 'EADDRINUSE' && attempt < 9) {
          attempt += 1;
          log(`port ${port} busy - trying ${PORT_PREF + attempt}`);
          server.removeListener('listening', onListening);
          server.listen(PORT_PREF + attempt, '127.0.0.1');
          return;
        }
        reject(err);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        const actual = server.address().port;
        if (actual !== PORT_PREF) log(`WARNING: serving on ${actual} (not ${PORT_PREF}) - another app holds the port`);
        resolve({ server, port: actual });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    };
    tryListen();
  });
}

/* ------------------------------------------------------------------------ offline mode */

/* The app itself fetches nothing off-origin at boot; AV_OFFLINE=1 is the proof run. The
 * guard exists ONLY in offline mode - normal launches are left exactly as a browser would
 * behave (the RESONANCE pack import and the FAMILY radio links are user-triggered fetches
 * to moddys.net and must keep working when the cable is in). With it on, everything that
 * is not loopback is answered with a 503 and logged. */
function installOfflineGuard(ses) {
  if (!OFFLINE) return;
  function offlineOrFetch(request) {
    const local = /^https?:\/\/(127\.0\.0\.1|localhost)\b/.test(request.url);
    if (!local) {
      log('offline: blocked', request.url);
      return new Response('', { status: 503, statusText: 'Anvil offline mode' });
    }
    return net.fetch(request, { bypassCustomProtocolHandlers: true });
  }
  ses.protocol.handle('https', offlineOrFetch);
  ses.protocol.handle('http', offlineOrFetch);
}

/* ------------------------------------------------------------------------ permissions */

/* The capabilities the app itself uses. A desktop app the user installed themselves should
 * not need a second click-through for its own features, so they are granted here; everything
 * else falls through to Electron's default (deny).
 *
 *   midi + midiSysex   full Web MIDI in and out (hardware keyboards / controllers) - the pin
 *   media + audioCapture  the S1 STUDIO input (getUserMedia -> engine input): the SOURCE uses
 *                      it (av_input / the STUDIO ENABLE button), so it is granted although the
 *                      D-wave pin said "media not needed" - conflict reported by D1
 *   fileSystem         the File System Access picks (showDirectoryPicker for LINKED SOURCES,
 *                      showSaveFilePicker for exports): granted so a user-gesture picker
 *                      answers like it does in a browser; the app's own guarded fallbacks
 *                      (anchor download -> the will-download path below) cover a refusal
 *   clipboard-read + clipboard-sanitized-write  COPY LINK + the harness reading it back
 */
const GRANTED = new Set([
  'midi', 'midiSysex',
  'media', 'audioCapture',
  'fileSystem',
  'clipboard-read', 'clipboard-sanitized-write',
]);

function installPermissions(ses) {
  ses.setPermissionRequestHandler((wc, permission, callback) => callback(GRANTED.has(permission)));
  ses.setPermissionCheckHandler((wc, permission) => GRANTED.has(permission));
}

/* ------------------------------------------------------------------------- downloads */

/* WAV / MIDI / ZIP / webm exports and library files come through here. The pin: save into
 * the OS Downloads dir WITHOUT a dialog, so an export never dead-ends behind a modal.
 * AV_DL_DIR (the test hook) redirects the folder and skips the collision handling so the
 * harness can hash exactly what lands. Names are reduced to their basename (a download name
 * is remote-supplied text; without a dialog it must not be able to climb out of the folder)
 * and, in the Downloads case, uniquified like a browser would ("name (2).wav") so a second
 * export never silently overwrites the first. */
function safeDownloadName(raw) {
  let name = path.basename(String(raw == null ? '' : raw));
  name = name.replace(/[\\/:*?"<>|]/g, '_').replace(/[\u0000-\u001f]/g, '_');
  name = name.replace(/^\.+/, '');
  name = name.replace(/[. ]+$/, '');
  if (!name) name = 'anvil-download';
  return name;
}

function uniquePath(dir, name) {
  let target = path.join(dir, name);
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 2; i < 10000; i++) {
    target = path.join(dir, stem + ' (' + i + ')' + ext);
    if (!fs.existsSync(target)) return target;
  }
  return path.join(dir, stem + ' (' + Date.now() + ')' + ext);
}

function installDownloads(ses) {
  ses.on('will-download', (event, item) => {
    const name = safeDownloadName(item.getFilename());
    if (DL_DIR) {
      try {
        fs.mkdirSync(DL_DIR, { recursive: true });
        item.setSavePath(path.join(DL_DIR, name));
        log(`download -> ${path.join(DL_DIR, name)}`);
      } catch (e) { log('download dir failed', String(e)); }
    } else {
      try {
        const dir = app.getPath('downloads');
        fs.mkdirSync(dir, { recursive: true });
        const target = uniquePath(dir, name);
        item.setSavePath(target);
        log(`download -> ${target}`);
      } catch (e) { log('download path failed - leaving it to Chromium defaults', String(e)); }
    }
    item.once('done', (e, state) => log(`download ${state}: ${name}`));
  });
}

/* ---------------------------------------------------------------------------- window */

function stateFile() { return path.join(app.getPath('userData'), 'window-state.json'); }

function loadWindowState() {
  const s = readJson(stateFile());
  if (!s || !Number.isFinite(s.width) || !Number.isFinite(s.height)) return null;
  return s;
}

function saveWindowState(w) {
  if (!w || w.isDestroyed() || w.isMinimized() || w.isFullScreen()) return;
  try {
    const b = w.getBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height }, null, 2));
  } catch (e) { /* not fatal */ }
}

/* The window/taskbar icon D2's make_icon.py produces; tolerate either capitalisation. */
function iconFile() {
  const candidates = ['anvil.ico', 'Anvil.ico'];
  for (const c of candidates) {
    const p = path.join(ROOT, 'icons', c);
    try { if (fs.existsSync(p)) return p; } catch (e) { /* keep looking */ }
  }
  return undefined;
}

let win = null;

/* Links that are not ours must not turn the instrument into a browser tab; and our own
 * pop-outs stay inside. The app's one pop-out is the keyboard (window.open('', 'av-keys'));
 * in a browser that surface is a document-PiP window, and av_kb_pop's own comment notes
 * Electron's Document-PiP "answers with an object born dead" so the named window is the
 * live path here - making it alwaysOnTop restores the PiP intent the way Pattern Forge
 * does for pf-keys. */
function wireWindow(w, port) {
  w.webContents.setWindowOpenHandler(({ url: target, frameName }) => {
    const external = /^https?:\/\//i.test(target);
    const ours = target === '' || target === 'about:blank' || target.startsWith(`http://127.0.0.1:${port}`);
    if (external && !ours) { shell.openExternal(target); return { action: 'deny' }; }
    if (!ours) return { action: 'deny' };
    const floaty = frameName === 'av-keys';
    log(`popout window ${frameName || '(unnamed)'} - alwaysOnTop: ${floaty}`);
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        backgroundColor: '#0b0f12',
        icon: iconFile(),
        alwaysOnTop: floaty,
        webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
      },
    };
  });
  w.webContents.on('will-navigate', (event, target) => {
    if (target.startsWith(`http://127.0.0.1:${port}`)) return;
    event.preventDefault();
    if (/^https?:/i.test(target)) shell.openExternal(target);
  });
}

/* The shell carries NO menu bar (Menu.setApplicationMenu(null): the app owns a full in-page
 * menu bar of its own - R5 avMenubar - and a native menu would only duplicate it and shadow
 * the app's keymap with accelerators). The two things a Windows shell still owes the user
 * are restored here as plain key events on the window:
 *   Ctrl+R          reload          (the pin: reload stays available)
 *   Ctrl+Shift+I    developer tools
 *   F11             full screen
 * The app's own law reserves Ctrl/Alt combos and F-keys for the shell (the av_kb MIDI hint),
 * and the only mod-combo the app claims is Ctrl+Alt+1/2/3 - none of these three collide. */
function wireKeyboard(w) {
  w.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '');
    if (!key) return;
    const ctrl = input.control === true;
    const shift = input.shift === true;
    const alt = input.alt === true;
    const k = key.toLowerCase();
    if (ctrl && !alt && !shift && k === 'r') { event.preventDefault(); w.webContents.reload(); return; }
    if (ctrl && shift && !alt && k === 'i') { event.preventDefault(); w.webContents.toggleDevTools(); return; }
    if (!ctrl && !alt && !shift && key === 'F11') { event.preventDefault(); w.setFullScreen(!w.isFullScreen()); return; }
  });
}

function createWindow(port) {
  const saved = loadWindowState();
  win = new BrowserWindow({
    width: (saved && saved.width) || 1500,    // the pinned default; the header design floor is 800
    height: (saved && saved.height) || 950,
    x: saved ? saved.x : undefined,
    y: saved ? saved.y : undefined,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#0b0f12',   // the Anvil dark - no white flash on launch
    title: 'Anvil',
    icon: iconFile(),
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,  // a music app must keep its clock when the window is covered
      devTools: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.on('resize', () => saveWindowState(win));
  win.on('move', () => saveWindowState(win));
  win.on('close', () => saveWindowState(win));

  wireWindow(win, port);
  wireKeyboard(win);

  win.webContents.on('render-process-gone', (event, details) => {
    log('renderer gone:', details.reason);
    const choice = dialog.showMessageBoxSync(win, {
      type: 'error', buttons: ['Reload', 'Quit'], defaultId: 0,
      title: 'Anvil', message: 'The app window stopped responding.',
      detail: 'Reason: ' + details.reason + '. Reloading rebuilds the interface - your sessions and library are kept.',
    });
    if (choice === 0) win.webContents.reload(); else app.quit();
  });

  win.loadURL(`http://127.0.0.1:${port}/index.html`);
  return win;
}

/* ------------------------------------------------------------------------------- boot */

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (TEST_MUTE) app.commandLine.appendSwitch('mute-audio');
if (DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', DEBUG_PORT);

app.setAppUserModelId((BUILD && BUILD.appId) || 'net.moddys.anvil');

/* One fixed home for the app's data (sessions, library, packs, window state). Electron would
 * derive this from the package name; pinning it means the folder is the same whatever the
 * package metadata says, and the uninstaller's "leaves your work behind" promise is exact:
 * %APPDATA%\Anvil, never touched by the installer. */
app.setPath('userData', path.join(app.getPath('appData'), 'Anvil'));

/* the preload reads these to report which build is wrapped */
process.env.AV_APP_VERSION = (BUILD && BUILD.version) || '';
process.env.AV_APP_BUILD = (BUILD && BUILD.appBuild) || '';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    let port;
    try {
      const started = await startServer();
      port = started.port;
    } catch (e) {
      dialog.showErrorBox('Anvil', 'Could not start the local app server: ' + String(e));
      app.quit();
      return;
    }
    process.env.AV_SERVE_PORT = String(port);
    log(`serving ${ROOT} on http://127.0.0.1:${port}/`);
    log(`build ${BUILD.version || '?'} - app ${BUILD.appBuild || '?'} - electron ${process.versions.electron}`);
    installPermissions(session.defaultSession);
    installOfflineGuard(session.defaultSession);
    installDownloads(session.defaultSession);
    Menu.setApplicationMenu(null);
    createWindow(port);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(port); });
  });

  app.on('window-all-closed', () => app.quit());
}
