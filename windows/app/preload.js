/* Anvil - Windows desktop preload.
 *
 * Two additive globals, namespaced so they cannot collide with the app's own (the app owns
 * __avEngine, __avLibrary, __avKb, __avDeliverUi, __avCompUiLastExport, window.av* ...):
 *
 *  __AV_DESKTOP   true - the page (and the verification harness) can gate desktop-only paths
 *                 on it.
 *  __AV_SHELL     which build is wrapped and where it is served; the pinned keys are
 *                 version / electron / servePort, the rest is family informational data.
 *
 * Context isolation is on (sandbox: true in the main process); this file is the only bridge.
 *
 * ONE writer (D1).
 */
'use strict';

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('__AV_DESKTOP', true);

contextBridge.exposeInMainWorld('__AV_SHELL', {
  shell: 'anvil-desktop',
  version: process.env.AV_APP_VERSION || '',
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  servePort: Number(process.env.AV_SERVE_PORT || 0),
  build: process.env.AV_APP_BUILD || '',
  platform: process.platform,
  arch: process.arch,
});
