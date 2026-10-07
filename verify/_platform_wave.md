# PLATFORM wave — contract (PWA offline #78 · suite bridges #82)

State at open (2026-10-08): HEAD `5e2c37e` (M2 closed, session saved) · frozen `d311eaf8` (3,205,003 B;
on disk + pinned) · battery 20 suites · pins 17 files · tree clean except `?? cache/`. Wave scope per
`docs/05` §2.7 "remaining: platform (PWA, suite bridges)" + `docs/07` items #78 / #82.

This wave ships:
1. **PWA + offline (#78)** — manifest, service worker, install flow, offline boot, update flow,
   File Handling for `.anvl` (docs/08 §4 "open .anvl with the app").
2. **Suite bridges (#82)** — a new FAMILY card with three real handshakes:
   - **HUB**: bounce the current loop (master) -> write it to the shared same-origin bridge store ->
     open the HUB INBOX page (`inbox.html`) that lists / plays / downloads it. On file:// or without
     IDB: honest fallback (direct download + note).
   - **RESONANCE**: import Resonance session packs (`https://moddys.net/resonance/app/pack/<id>.zip`,
     deflate zips of `.gnaural` XML; also local `.zip` / `.gnaural` from disk) -> session list ->
     render (preview, 120 s cap) -> play through the master tap -> save WAV.
   - **RADIO**: cross-link to MODDYS World Radio — reads the radio's OWN same-origin localStorage
     (`rbg-last`, `rbg-meta`) and shows the last station, with OPEN RADIO + a search deep link
     (`https://moddys.net/#q=<term>` — the radio's hash format, `readHash()` in the live page).

Battery grows to **21 suites** (+`cdp_platform`). Rig runs over a **local HTTP server** (the first
http-based suite — PWA/SW/IDB bridges need a real origin; file:// stays the default for all others).

## §1 Deliverables + file ownership

| # | artifact | kind | owner |
|---|---|---|---|
| A1 | `src/av_pwa.js` | new | sa-A |
| A2 | `src/av_sw.js` | new (SW source template; build instantiates to `sw.js`) | sa-A |
| A3 | `src/av_icon.py` | new (stdlib PNG icon renderer) | sa-A |
| B1 | `inbox.html` (repo root) | new (static page, no build step) | sa-B |
| C1 | `src/av_gnaural.js` | new (clean-room `.gnaural` parse + render + zip reader) | sa-C |
| D1 | `src/av_family.js` | new (FAMILY card: HUB / RESONANCE / RADIO rows) | sa-D |
| E1 | `verify/cdp_platform.mjs` | new rig (write-only, EXPECT_SHA null) | sa-E |
| P | `build.py` · `src/body.html` · `src/app_core.js` · `src/av_proj.js` · `verify/cdp_smoke.mjs` · styles block · integration script · pins | parent integration | parent |

Children: never run the build, a browser, the suites or git; only `node --check` / `python3 -m py_compile`
on your own files (plus your own node harness where stated). Write the file to disk FIRST, then iterate.

## §2 Feature pins

### §2.1 `src/av_pwa.js` (page module — one namespace `avPwa*` / `AV_PWA_*`)

Classic script, "use strict", node-loadable (no DOM/global reach at load; every reach guarded inside
functions), never throws, no console noise, ONE debug handle `window.__avPwa`:

```
window.__avPwa = { version, supported, registered, active, waiting, state(), init,
                   installPrompt(), canInstall, installed, online, swUrl, scope, errors[] }
```

`avPwaInit()` -> boolean (false = honest "not available here", never an error). Behavior:

- **supported** = `"serviceWorker" in navigator` AND `location.protocol` is `https:` OR host is
  `localhost`/`127.0.0.1`/`[::1]`. On `file:` -> supported false, NO registration attempt, no error
  (the smoke zero-error contract runs on file://).
- **Registration**: `navigator.serviceWorker.register("./sw.js", { scope: "./" })` AFTER window load
  (or immediately if already loaded). Skip entirely when `?nosw=1` is in the URL (rig opt-out).
  Record `state()` = `{ supported, registered, active, waiting, controlled, online, scope, swUrl,
  errors }` (errors capped at 16). `registration.update()` called once a minute at most (guarded).
- **Update flow**: when `registration.waiting` exists (or `updatefound` -> state 'installed' while a
  controller exists) -> expose `waiting: true` and add class `av-pwa-update` to `document.body`; the
  page shows an "UPDATE READY — RELOAD" chip (`#av-pwa-update`, class `av-pwa-chip`). Click ->
  `registration.waiting.postMessage({ t: "av-skip-waiting" })`; on `controllerchange` -> reload once
  (guard a `reloading` flag). Never auto-skipWaiting.
- **Install**: capture `beforeinstallprompt` (preventDefault; store event; `canInstall` true; show
  `#av-pwa-install` button); click -> `prompt()` + await `userChoice`; `appinstalled` -> installed
  true, hide button. iOS/iPadOS Safari (no beforeinstallprompt): show the hint chip
  `#av-pwa-ios` ("Share -> Add to Home Screen") when `standalone` is not already set
  (`navigator.standalone === true` or `display-mode: standalone` media). `installPrompt()` = test hook
  returning the same path; a synthetic dispatched event must drive the same code (rig does this).
- **Offline chip**: track `online`/`offline` events + `navigator.onLine`; body class `av-pwa-offline`
  while offline; chip `#av-pwa-offline` ("OFFLINE — everything is local, keep going").
- **File Handling**: if `window.launchQueue` exists, `launchQueue.setConsumer(async (params) => {...})`
  reading `params.files[0]` -> `getFile()` -> `text()`; hand off: if `typeof avProjOpenText ===
  "function"` call `avProjOpenText(file.name, text)` (parent adds this seam to `av_proj.js`); else
  dispatch `new CustomEvent("av-launch-file", { detail: { name, text } })` on window. Track
  `launchCount` in state(). Never throws; a bad file -> errors[] + note.
- **Proof line**: when `?avtest=1`, `avPwaProof()` returns a one-line `PWA SELFTEST <json>`
  (`{supported, registered, active, waiting, installPath, launch}` — installPath = `"bip"|"ios"|"none"`).
  app_core appends it (parent integration). Also set `document.body.dataset.avPwa` = supported state.
- Debug/test hooks (contract): `__avPwa.state()` JSON-safe; `__avPwa.installPrompt()` returns the
  captured prompt object or null; `__avPwa.simulateInstallEvent()`? NO — the rig dispatches a
  synthetic `beforeinstallprompt` event itself (listener must be a plain `addEventListener` on
  window). Keep the real listener only.

### §2.2 `src/av_sw.js` (service-worker source; build instantiates `sw.js`)

Classic SW script, no DOM, `self` only. Tokens replaced by build.py:
`__AV_SW_VERSION__` (the new index.html sha, first 8 hex) and `__AV_SW_ASSETS__` (JSON array of the
relative URLs to precache: `["./", "./index.html", "./manifest.webmanifest", "./icon-192.png",
"./icon-512.png", "./icon-maskable-512.png", "./inbox.html"]`).

```
const SW_VERSION = "__AV_SW_VERSION__";
const SW_ASSETS = __AV_SW_ASSETS__;
const SW_CACHE = "anvil-" + SW_VERSION;
install:  caches.open(SW_CACHE) -> cache each asset individually (Promise.allSettled; a 404 must NOT
          brick install — record failures in a variable `lastInstallFailures`); NO skipWaiting here.
activate: delete every cache starting "anvil-" that is not SW_CACHE; self.clients.claim().
fetch:    only GET, only same-origin URLs. mode === "navigate" -> network-first (fetch, put copy in
          cache on ok), offline fallback -> caches.match("./index.html"); else cache-first for the
          precache list, network fallback -> cache.put on ok; anything else passthrough.
message:  { t: "av-skip-waiting" } -> self.skipWaiting().
```
`node --check` must pass on the TEMPLATE (tokens live inside string/JSDoc-safe spots — keep the
template itself valid: put tokens as `const SW_VERSION = "__AV_SW_VERSION__";` and
`const SW_ASSETS = __AV_SW_ASSETS__;` where the array token sits in an expression position; the raw
template must still parse: make it `const SW_ASSETS = /*__AV_SW_ASSETS__*/ ["./"];`? NO — simplest:
token line `const SW_ASSETS = __AV_SW_ASSETS__;` is valid JS as-is ONLY after replacement; for the
template, keep the same shape but build.py asserts `"__AV_SW_ASSETS__" in src` before replacing. For
`node --check` on the template use a copy with tokens substituted (document in the header).)

### §2.3 build.py emission (parent)

After the existing `index.html` write + sha print, ALSO write (repo root, all relative-path-safe):
- `sw.js` — `src/av_sw.js` text with `__AV_SW_VERSION__` -> sha[:8], `__AV_SW_ASSETS__` -> the JSON
  list. Print `built sw.js` + its sha (record in the build log; do NOT put sw.js into index.html).
- `manifest.webmanifest` — `json.dumps` (indent 2, ensure_ascii=False, newline "\n") of EXACTLY:
  `{ "name": "Anvil", "short_name": "Anvil", "description": "A MODDYS Foundry instrument — acid,
  wavetable, FM, string, drum, granular and sampler engines in one local-first browser synth.",
  "id": "./", "start_url": "./", "scope": "./", "display": "standalone", "orientation": "any",
  "background_color": "#16140f", "theme_color": "#16140f", "categories": ["music","entertainment"],
  "icons": [192 any, 512 any, 512 maskable — paths ./icon-192.png ./icon-512.png
  ./icon-maskable-512.png, type image/png, purpose "any"/"maskable"],
  "file_handlers": [{ "action": "./index.html", "accept": { "application/x-anvil-project": [".anvl"] } }] }`
- `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` — bytes from `src/av_icon.py`
  `render_icon(size, maskable=False) -> bytes` (import via importlib from `SRC / "av_icon.py"`;
  build.py is stdlib-only — av_icon.py stdlib-only too). Print all three shas.
- index.html gets (parent edits the head template or build injects): `<link rel="manifest"
  href="manifest.webmanifest">`, `<link rel="apple-touch-icon" href="icon-192.png">`,
  `<meta name="theme-color" content="#16140f">`. (Manifest fetch on file:// is a warning at most,
  never a page error — watch-out §4.)

### §2.4 `inbox.html` (HUB INBOX — repo root, standalone)

Static single-file page (inline CSS/JS, no external resources, works offline; dark ground `#16140f`,
teal accent — read the exact tokens from `src/styles.css` at authoring and match the app's look).
Reads the same-origin bridge store:

```
IDB: database "moddys-bridges", version 1, objectStore "outbox" (keyPath "id")
record: { id (string, "<at>-<rand>"), name, kind: "loop", bpm, bars, sec, sr, ch, bytes, at (epoch ms),
          wav (ArrayBuffer, WAV file bytes) }
```

Page behavior: list records NEWEST FIRST (idb getAll -> sort by at desc); each row shows name, bpm,
bars, sec, size KB, time; an `<audio controls>` per row built from `Blob([wav], {type:"audio/wav"})`
(revoke on unload); a Download button (`a.download = name`); a Delete button (delete + re-render);
count line "N loop(s)"; honest empty state ("Nothing here yet — bounce a loop in Anvil and press SEND
TO HUB."); if IDB unavailable -> honest note, no crash. Header: "ANVIL -> MUSIC HUB INBOX" + one line
explaining the handshake is local (same-origin, nothing uploaded) + a back link "Open Anvil"
(`./index.html`). Debug handle `window.__avInbox = { list(), remove(id), state() }` (list = the
readable rows for the rig). Zero console errors. ~no build step; keep it self-contained.

### §2.5 `src/av_gnaural.js` (clean-room core — one namespace `avGn*` / `AV_GN_*`)

Clean-room from the .gnaural XML FORMAT + observed behaviour (the Resonance app carries GPL lineage —
never copy its code; header records: "format by Gnaural (gnaural.sourceforge.net), semantics learned
from the format + freenotes; reimplemented clean-room"). Classic script, node-loadable, never throws.

- `avGnParse(xmlText)` -> `{ ok, error?, session: { title, description, author, totalSeconds,
  voiceCount, voices: [{ index, type, typeName, state, mono, mute, duration, entries: [{
  duration, volL, volR, beat, base }] }], warnings[] } }`. Types: 0 binaural, 1 pink noise,
  2 PCM file, 3/4 isopulse, 5/6 other Gnaural ext, 7 white noise, 8 brown noise (7/8 = Resonance
  extension types — accepted). `playable` = type 0/7/8 (v1 renderer). Tolerant: unknown fields
  ignored; numbers via a tolerant float parse; empty <entries> -> warning; entry count capped (4096).
- `avGnUnzip(arrayBuffer)` -> `{ ok, error?, files: [{ name, bytes(Uint8Array) }], errors[] }` —
  general zip READER: EOCD scan (comment-aware), central-directory walk, STORE (0) = slice, DEFLATE
  (8) = `DecompressionStream("deflate-raw")` (async; absent -> honest error listing the method),
  CRC-32 check when a CRC helper is available (reuse `avZipCrc32` guarded), name folders kept
  (`classic/Calm Clarity (alpha).gnaural`), non-`.gnaural` entries pass through in `files` (caller
  filters), zip64/encrypted -> honest refusal.
- `avGnSessionsFromZip(zipBuf)` -> `{ ok, error?, sessions: [{ name, xml, bytes }], errors[] }` —
  filters `.gnaural` entries (case-insensitive), decodes UTF-8 (BOM-tolerant).
- `avGnRender(session, opts)` -> Promise `{ ok, error?, sr, seconds, frames, l, r (Float32Array),
  warnings[] }`. Semantics (v1, honest): `sr` 48000 (or opts.sr 44100); timeline = max voice
  duration; each voice renders only while `state` truthy and not muted; parameters ramp LINEARLY:
  entry k's values apply from the END of entry k (entry 0 initial values hold/ramp — pin: value at
  t = linear interpolation where entry k's values are REACHED at cumulative end of entry k and hold
  after the last entry; between them lerp), `loop` fields ignored (note). Carrier math per voice:
  type 0 binaural = left sine at `base - beat/2`, right sine at `base + beat/2` (phase-continuous;
  frequency ramped per-sample no faster than linear over the entry); type 7 = white noise (seeded
  xorshift32 — DETERMINISTIC per parse: seed from session title hash), type 8 = brown noise
  (integrated white, leaky). Amplitude = volL/volR ramped values (0..1), sum across voices, clamp
  [-1,1] via soft limit `x / (1 + |x|*0.25)`? NO — pin hard headroom: sum then scale by 0.9/maxAbs
  if maxAbs > 0.95 (deterministic, noted in warnings). `opts.maxSeconds` default **120** (preview
  cap), hard cap 600; `opts.frames` override for harnesses. Render is a pure loop (no AudioContext).
- `avGnInfo(session)` -> `{ totalSeconds, voiceCount, playableVoices, types[], renderable }`.
- Node harness (in the child's scratch, summarized in the report; not shipped): parse the fixture
  InstantNap-style XML; zip read of a deflate zip; render a constant-tone fixture and FFT-verify
  left/right peaks at base∓beat/2 (±0.5 Hz) and the beat sideband spacing; determinism (two renders
  byte-identical for noise types).

### §2.6 `src/av_family.js` (FAMILY card — mounts into `#av-family-host`)

Classic script page module; `avFamilyInit()` -> boolean; debug handle `window.__avFamily =
{ version, init, state, send(opts), importPack(src), preview(sessionIndex), stop(), openRadio(q),
  setPackBase(url), classes() }`; `avFamilyClasses()` returns the class list for the styles block
(emit at integration). Card = one `<section class="av-card" id="av-family">` containing `<div
id="av-family-host">`; rows built by the module: `av-fam-row` per bridge + `av-fam-head`. Every
action is honest, receipt-shaped `{ ok, error?, note?, ... }`; nothing throws.

**HUB row (SUITE -> MUSIC HUB):** controls: loops select 2/4/8 (default 8) + `SEND TO HUB` button +
status line. `send()` pipeline (implemented in the module, page-side):
1. `avBounce({ loops, includeParts:false, includeMaster:true, tailS:2, sr:48000 })` (guard: no
   pattern -> bounce's own honest refusal note; surface it).
2. `avWavEncode` the master (confirm signature in `src/av_wavio.js` at authoring and call it the
   SAME way `av_deliver_ui.js` does — copy that call pattern; 16-bit, 48 k).
3. Write the §2.4 record to IDB `moddys-bridges`/`outbox` (guarded; structured clone of the
   ArrayBuffer — NEVER a transfer list).
4. `window.open("./inbox.html", "av-hub-inbox")` — never `about:blank`, never `_blank`
   (named target per the family popout law). When IDB unavailable (file://): skip 3, download the
   WAV via the house download path instead, note "saved as a file — the hub inbox needs moddys.net
   (same origin)". Receipt records `{ ok, via: "inbox"|"download", bytes, sec, bpm, name }`.
`state()` exposes the last receipt + whether the inbox path is available
(`avFamilyInboxAvailable()` = IndexedDB present && protocol http(s)).

**RESONANCE row:** source line (select of the 18 known pack ids: breathing classic depth focus
gnaural-web-complete listener schumann sleep sleepladder solfeggio speakers tours wave1..7 + local
file input `.zip/.gnaural`) + FETCH AND IMPORT + status. `importPack(src)`:
- remote: `fetch(packBase + id + ".zip")` where `packBase` default
  `https://moddys.net/resonance/app/pack/` (override via `setPackBase` — the rig points it at its
  own server). Non-ok / network error -> honest note ("packs live on moddys.net; import a .zip from
  disk instead").
- local: FileReader/arrayBuffer -> same path.
- unzip via `avGnUnzip`, sessions via `avGnSessionsFromZip`; per-session parse via `avGnParse`;
  state holds `sessions: [{ name, info, ok, error }]`; the UI lists name + minutes + type names;
  refusals listed (never hidden). `preview(i)`: `avGnRender(session, { maxSeconds: 120 })` -> build
  an AudioBuffer on the LIVE ctx (`avTap.ctx` or the tap accessor — confirm names in
  `src/av_tap.js`/`src/av_engine.js` at authoring) -> source -> CONNECT TO THE MASTER TAP input
  (`avMasterNodes()`), NOT ctx.destination (standing law). `stop()` disconnects + stops. Preview
  receipt `{ ok, seconds, sr, frames, capped }` + note when capped at 120 s. `save()` -> WAV of the
  rendered buffer via `avWavEncode` -> house download. No live playback of noise types >120 s
  without the cap note.

**RADIO row:** read `localStorage.getItem("rbg-last")` (JSON `{ m: <station>, ts }`) and
`rbg-meta` (tolerant: try/catch, `m.n`/`m.name`, `m.i`; missing -> honest "no history yet" state).
Show "MODDYS WORLD RADIO — you last played: <name> (<country>)" + OPEN RADIO button
(`window.open("https://moddys.net/", "av-world-radio")`) + search input + GO -> 
`window.open("https://moddys.net/#q=" + encodeURIComponent(term), "av-world-radio")`. One-line
honest note: "reads your radio history when both run on moddys.net". `openRadio(q)` returns the URL
string (rig asserts without navigating).

### §2.7 `verify/cdp_platform.mjs` (rig — write-only; EXPECT_SHA null)

Copy the cdp_m2.mjs launch block (Edge headless candidate ladder, 1440×900 metrics override,
`--autoplay-policy=no-user-gesture-required`, temp profile + profile-scoped cleanup; ONE browser at a
time). NEW: the rig starts its OWN static server (node `http`+`fs`, no deps) on 127.0.0.1:<ephemeral>
serving a temp COPY of the artifact set: `index.html`, `sw.js`, `manifest.webmanifest`,
`icon-*.png`, `inbox.html` (copied from the repo root — the copy is where the rig mutates `sw.js`
for the update test). Serve correct MIME for `.webmanifest` (`application/manifest+json`), `.js`,
`.html`, `.png`. Also serve virtual `/fixtures/` files generated at runtime: a DEFLATE zip
(node `zlib.deflateRawSync` + manual zip central directory) containing two inline `.gnaural`
fixtures — one constant binaural tone (type 0: base 200.0, beat 10.0, one 30 s entry -> left
195.0 Hz / right 205.0 Hz steady) and one white-noise (type 7, 10 s) — plus a `README.txt` decoy;
and a single loose `.gnaural` for the local-file leg (page-side File injection via DataTransfer).
Sections + checks (each check = house `check(name, cond, detail)` style; target ~55 checks):

- **P1 manifest**: fetch 200 + MIME; all §2.3 fields exact; icons 192/512 + maskable present, fetch
  each -> 200 + PNG magic (`\x89PNG`).
- **P2 registration**: page `__avPwa.supported === true` over http; `navigator.serviceWorker.ready`
  resolves; `state().active` true; scope ends `./`; on file:// (`file:///.../index.html` loaded in
  the same run): supported false + no registration + zero page errors (the guard contract).
- **P3 cache**: `caches.keys()` includes `anvil-<sha8>` where sha8 = sha256 of the SERVED
  index.html bytes (rig computes it); `caches.match("./index.html")` returns bytes whose sha256
  matches; sw.js on disk contains the same sha8.
- **P4 offline**: CDP `Network.emulateNetworkConditions {offline:true}` -> reload -> `data-av-ready`
  present; `navigator.onLine === false`; body class `av-pwa-offline`; chip `#av-pwa-offline`
  visible; served-from-cache proof: navigation `transferSize === 0` OR `responseStart` served by SW
  (measure via `performance.getEntriesByType("navigation")[0]`, accept either, print detail). Then
  back online.
- **P5 update flow**: rewrite the temp `sw.js` token sha to a different 8-hex + touch comment;
  `reg.update()`; wait for `registration.waiting`; body class `av-pwa-update` + chip visible;
  click chip -> reload -> new cache name present + old `anvil-<old>` gone.
- **P6 install path**: dispatch a synthetic `beforeinstallprompt` event (construct via
  `new Event("beforeinstallprompt")` + assign `prompt`/`userChoice` stubs) -> `#av-pwa-install`
  visible + `__avPwa.installPrompt()` truthy; call `prompt()` stub -> userChoice resolves 'dismissed'
  -> no crash. (Labeled as the code-path test — never claim a real browser install.)
- **P7 family HUB**: navigate to the served page; load the cdp_bounce BUILD_PATTERN shape via
  `avSeqLoad` (copy that helper verbatim); `__avFamily.send({ loops: 2 })` with `window.open`
  stubbed (capture url+target) -> receipt ok via "inbox"; IDB record exists (read via the page);
  then navigate to `./inbox.html` -> `__avInbox.list()` has 1 row with the right name/bpm/bytes;
  audio element src starts `blob:`; download link has `download` attr + href blob. Delete -> count 0.
- **P8 family RESONANCE**: `setPackBase(server + "/fixtures/")`; `importPack("pack")` (rig names the
  fixture zip `pack.zip`) -> 2 sessions listed (decoy README skipped, listed in a note); `preview(0)`
  -> receipt ok via the tap route; WITNESS: rig owns an AnalyserNode on the master node ->
  FFT peak left ~195 Hz, right ~205 Hz (±1 Hz) while previewing the constant fixture — measure both
  channels (channel-splitter analysers), the MB-witness law; `save()` -> WAV bytes len > 44 + RIFF
  magic; local-file leg: drop the loose fixture via a synthesized File -> sessions appended or
  replaced per design; refusal path: fetch a 404 name -> honest note, ok:false, no crash.
- **P9 family RADIO**: seed `localStorage.setItem("rbg-last", JSON.stringify({m:{n:"Test FM",i:"x",
  c:"Australia"},ts:Date.now()}))` + reload -> row text contains "Test FM"; `openRadio("dub")` ->
  `https://moddys.net/#q=dub` exact; click OPEN RADIO with window.open stubbed -> target url exact +
  target name "av-world-radio".
- **P10 zero errors**: every section leaves a clean console (pageerror + console.error collectors);
  final check asserts 0 (list offenders).

Rig convention: log to `verify/last-cdp_platform.log`, print `PLATFORM-RESULT n/m` marker; the rig
kill + cleanup in `finally` (server close, temp dir remove, browser close).

## §3 Integration recipe (parent, in order)

1. Verify the 5 child artifacts on disk + their `node --check`/py_compile + re-run child harnesses.
2. Author the styles block (`cache/scratch/platform/integrate/platform-styles.css`) from
   `avFamilyClasses()` + av_pwa/avPwa chip classes + inbox (inbox styles are inline — no block).
3. Integration script `cache/scratch/platform/integrate/_platform_integrate.py` (counted-assert,
   all-or-nothing, `--anchors` dry mode, child-artifact guard incl. edit-marker checks):
   - `build.py`: append `src/av_pwa.js` + `src/av_gnaural.js` + `src/av_family.js` to `js_parts`
     (order: after `av_kb_pop.js`/`av_code_ui.js`, before `av_synth.js`? follow existing block —
     pin at authoring; family AFTER av_bounce/av_seq/av_wavio deps exist as page globals: script
     order = declaration order, dependencies are runtime so position is safe anywhere after load;
     PIN: at the END of `js_parts`); add the §2.3 emission block + head links/meta injection.
   - `src/body.html`: add the `#av-family` card after `#av-code` (+ host div + dim placeholder
     paragraph).
   - `src/app_core.js`: `ANVIL` version -> `"1.6.0"` + phase `"platform · pwa · family bridges"`;
     add `try { pwaOk = (typeof avPwaInit === "function") ? (avPwaInit() !== false) : false; }` +
     `avFamilyInit()` inits + append `avPwaProof()` to the avtest proof list (copy the existing
     proof-line pattern).
   - `src/av_proj.js`: add `avProjOpenText(name, text)` public function (parse -> `avProjApplyFn()`
     -> record open; receipt shape like avProjOpenRun) + add it to `window.__avProj`.
   - `verify/cdp_smoke.mjs`: add checks — `#av-family` card + 3 rows mounted; `__avPwa.supported ===
     false` on file:// + `launchQueue` guard + zero-error (existing); manifest link tag present in
     head; family API live. Honest count bump.
   - styles append (styles.css) from the generated block.
4. `python3 build.py` -> expect index.html + sw.js + manifest + 3 icons; note the sha.
5. `node verify/cdp_smoke.mjs` -> green; then `node verify/cdp_platform.mjs` first run -> SPEC
   triage (fix rig expectations to intent, app only for real misbehaviour; record SPEC fixes).
6. Pins: EXPECT_SHA in all 17 existing files + the new `cdp_platform.mjs` -> the frozen sha.
7. Battery (21 suites, one at a time, redirected `verify/last-<name>.log`).
8. Perf gate: bench (knee must read 128 family on the same conditions; the platform code is
   page-side, not worklet — worklet sha must stay `d7f0ee41` UNCHANGED) + stress ×2 + old-bytes
   control only if counts jump.
9. Close commits + continuation addendum 34 + README + docs/05 status + skill updates.

## §4 Watch-outs

- SW + file://: every test surface except the platform rig runs `file://` — registration MUST be a
  no-op there with zero console noise. `?nosw=1` exists for the rig itself.
- The rig's server must set correct MIME for `.webmanifest` (wrong type = manifest parse failure)
  and must not be cached by the browser across sections (unique port per run).
- `DecompressionStream("deflate-raw")` is Chromium/Edge-supported; the reader must FAIL HONESTLY
  where absent (feature-detect, never throw).
- IDB structured clone: store ArrayBuffers (clone), never a transfer list (detaches live buffers —
  house law from the bounce worklet sends).
- New card controls: no new `.av-knob` in the family card v1 (keeps the s4 share-wire knob-diff
  untouched); selects/buttons/inputs only. If any knob creeps in, it MUST carry `data-def`.
- `rbg-last` read: foreign key, tolerate ANY shape (old versions); never throw; never write it.
- The smoke layout check wraps long unbreakable tokens — family chip/status copy stays short.
- ASCII-only anchors in the integration script (the house rule); manifest json written with
  `ensure_ascii=False` is fine (not an anchor).
- Console etiquette: no console output from SW or modules; errors[] arrays are reported via state()
  only.

## §5 Report shape (children -> parent)

- Files written (absolute paths) + line counts + `node --check` result; a list of exported names
  (functions/globals) as a plain list; the harness command + its pass/fail counts (one line per
  suite); every uncertainty flagged in an "Undetermined" list; a one-paragraph summary of what the
  module's `state()` returns.
