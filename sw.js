/* Anvil - service-worker SOURCE TEMPLATE (PLATFORM wave, child sa-A, #78; verify/_platform_wave.md 2.2).

   build.py instantiates this file into `sw.js` at the repo root by string-replacing the two
   double-underscore placeholders that sit on the const lines below - one carries the built
   index.html sha256 (first 8 hex), the other a JSON array of the relative URLs to precache:

     const SW_VERSION = (version placeholder);   -> "3f2a9c10" (sha8 of the built index.html)
     const SW_ASSETS  = (assets placeholder);    -> ["./", "./index.html",
                                                     "./manifest.webmanifest", "./icon-192.png",
                                                     "./icon-512.png", "./icon-maskable-512.png",
                                                     "./inbox.html"]

   TEMPLATE CHECK NOTE: the raw template parses as-is - the assets placeholder sits in
   expression position as a bare identifier, so `node --check src/av_sw.js` passes on the
   untouched file. To check the INSTANTIATED shape, substitute both placeholders into a copy
   (version -> any 8 hex chars, assets -> the JSON array) and `node --check` that copy.
   build.py asserts the placeholders are present before replacing, so a stale template fails
   loudly instead of shipping a broken worker.

   LAWS: classic service-worker script (no module type) - `self` only, no DOM, no console
   output; install NEVER calls skipWaiting (only the page's UPDATE chip posts the message below
   after the user clicks it); a 404 on one precache asset must never brick install.

   BEHAVIOR (the pinned contract):
   - install : opens the versioned cache anvil-<SW_VERSION>; adds every asset INDIVIDUALLY
               wrapped in Promise.allSettled; failures land in lastInstallFailures and the
               install still settles (a dead icon can never block the whole app).
   - activate: deletes every "anvil-" cache that is not the current one; self.clients.claim().
   - fetch   : GET + same-origin only. navigate -> network-first (a fresh copy is cached on ok);
               when the network is gone: this URL's own cached copy first, then ./index.html as
               the app-shell fallback (inbox.html keeps its own offline copy this way).
               Precache-list request -> cache-first, network fallback with cache.put on ok.
               Anything else passes through untouched.
   - message : { t: "av-skip-waiting" } -> self.skipWaiting().

   ONE writer (child sa-A). */

"use strict";

const SW_VERSION = "a90806a5";
const SW_ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./inbox.html"];
const SW_CACHE = "anvil-" + SW_VERSION;
const SW_PREFIX = "anvil-";

/* per-asset install failures from the last install pass (diagnostics only) */
let lastInstallFailures = [];

/* the precache URL set, resolved against this worker's own location (lazy, failure-safe) */
let swAssetSet = null;
function swAssetUrls() {
  if (swAssetSet) return swAssetSet;
  swAssetSet = new Set();
  try {
    for (let i = 0; i < SW_ASSETS.length; i++) {
      try { swAssetSet.add(new URL(SW_ASSETS[i], self.location.href).href); } catch (e) { /* skip a bad entry */ }
    }
  } catch (e) { /* empty set - everything passes through */ }
  return swAssetSet;
}

function swIsPrecached(href) {
  try { return swAssetUrls().has(href); } catch (e) { return false; }
}

/* cache a copy of an ok response - best effort, never affects the response we return */
function swPutCopy(req, res) {
  try {
    const copy = res.clone();
    caches.open(SW_CACHE).then(function (cache) { return cache.put(req, copy); })
      .catch(function () { /* a cache write is a nicety, not a promise */ });
  } catch (e) { /* clone/cache unavailable */ }
}

/* ---------- install: precache per-asset, no skipWaiting, no bricking ---------- */
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SW_CACHE).then(function (cache) {
      const jobs = [];
      for (let i = 0; i < SW_ASSETS.length; i++) {
        const url = SW_ASSETS[i];
        jobs.push(
          cache.add(url).then(
            function () { return { url: url, ok: true }; },
            function (error) { return { url: url, ok: false, error: String((error && error.message) || error || "fetch failed") }; }
          )
        );
      }
      return Promise.allSettled(jobs).then(function (settled) {
        lastInstallFailures = [];
        for (let i = 0; i < settled.length; i++) {
          const r = settled[i];
          if (r && r.status === "fulfilled" && r.value && r.value.ok === false) {
            lastInstallFailures.push(r.value);
          } else if (r && r.status === "rejected") {
            lastInstallFailures.push({ url: SW_ASSETS[i], ok: false, error: String((r.reason && r.reason.message) || r.reason || "rejected") });
          }
        }
        return true;
      });
    })
  );
  /* NO skipWaiting here - the UPDATE chip owns that decision, always. */
});

/* ---------- activate: drop stale anvil- caches, claim the clients ---------- */
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      const deletions = [];
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key !== SW_CACHE && key.indexOf(SW_PREFIX) === 0) deletions.push(caches.delete(key));
      }
      return Promise.all(deletions);
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* ---------- fetch: navigate network-first, precache cache-first, else passthrough ---------- */
self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (!req || req.method !== "GET") return;
  let url = null;
  try { url = new URL(req.url); } catch (e) { return; }
  if (!url || url.origin !== self.location.origin) return;
  try {
    if (req.mode === "navigate") {
      event.respondWith(swNetworkFirst(req));
      return;
    }
    if (swIsPrecached(url.href)) {
      event.respondWith(swCacheFirst(req));
      return;
    }
  } catch (e) {
    /* fall through to passthrough - the network handles it */
  }
});

/* navigations: network-first; offline -> this URL's cached copy, then ./index.html (the shell) */
function swNetworkFirst(req) {
  return fetch(req).then(function (res) {
    if (res && res.ok) swPutCopy(req, res);
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) {
      if (hit) return hit;
      return caches.match("./index.html");
    }).catch(function () {
      return caches.match("./index.html");
    });
  });
}

/* precache list: cache-first; a miss goes to the network and re-caches on ok */
function swCacheFirst(req) {
  return caches.match(req).then(function (hit) {
    if (hit) return hit;
    return fetch(req).then(function (res) {
      if (res && res.ok) swPutCopy(req, res);
      return res;
    });
  }).catch(function () {
    return fetch(req);
  });
}

/* ---------- message: the page's UPDATE chip asks for the skip ---------- */
self.addEventListener("message", function (event) {
  const data = event ? event.data : null;
  if (data && data.t === "av-skip-waiting") {
    try { self.skipWaiting(); } catch (e) { /* nothing to do */ }
  }
});
