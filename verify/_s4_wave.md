# Anvil S4 wave — DELIVER EXTRAS: .anvl project I/O (FSA #77) · patch share cards (#18) · video clip capture (#83)

Trigger: DECK close (addendum 29, frozen `45cc39d7`). Scope: docs/08 §1 S4 ("direct-to-disk save
(FSA #77)" · "share card (#18)" · "video capture (#83)") + docs/07 #77/#18/#83 + docs/02 §6 (the
share loop pin: "save patch → copy link (compact JSON) → recipient opens and hears it; QR for
devices"). Stems/mixdown/.mid already shipped (P6). This wave adds the PROJECT & SHARE card.
Next after: popout keyboard · CODE (#81) · walkthrough/help · platform (share/cloud/PWA) → P7.

## 0. Platform notes (no probe required beyond the watch list)

All APIs are platform: File System Access (Chromium-only, ALWAYS behind the module seam + an anchor
download fallback), canvas.captureStream + MediaRecorder (WebM), canvas.toBlob, crypto none (QR is
own math). Reuse verified machinery — never re-implement: `avSessionCapture/Apply` (av_session.js —
the ONLY working-state apply path), `avSampleImportFiles(files, opts)` (av_sample.js — resolves
{ok, added, errors, count, max}, never rejects), `avDeliverDownload(bytes, name)` +
`window.__avDeliverLastDownload` (av_deliver_ui.js — FSA-save-preferred with anchor fallback),
`avBounce` (av_bounce.js — offline render for the clip audio), `avDeckFrame` (av_deck.js — the deck
is the capture surface), the ONE avNote bus (__avNotes()/__lastNotePreview). **No new AudioContext
ever**: the clip plays its rendered buffer through the LIVE ctx (resolve like av_deck's attach
does — read av_deck.js avDeckAttach for the exact live-ctx resolution; never create one).

## 1. Scope & file ownership (ONE writer per file)

| child | owns (write) | scratch |
|---|---|---|
| sa-A | `src/av_proj.js` — .anvl project save/open + sample import (FSA seam + fallbacks) | `cache/scratch/s4/proj/` |
| sa-B | `src/av_card.js` — patch capture/encode/URL + clean-room QR + PNG card + share/copy | `cache/scratch/s4/card/` |
| sa-C | `src/av_video.js` — clip compositor + captureStream/MediaRecorder pipeline | `cache/scratch/s4/video/` |
| sa-D | `src/av_files_ui.js` — the PROJECT & SHARE card (one card, three sections) | `cache/scratch/s4/ui/` |
| sa-E | `verify/cdp_s4.mjs` — WRITE-ONLY rig (parent runs it) | `cache/scratch/s4/rig/` |

Children never touch shared files (`build.py`, `src/body.html`, `src/styles.css`, `src/app_core.js`,
`verify/cdp_smoke.mjs`, any other `src/*`, `verify/*` except own rig) and never run the build,
browsers, suites or git. Each self-verifies with a node harness in its scratch (module text loaded
into one `new Function` scope, DOM-free stubs — the deck-ui harness pattern). **Write-first rule:**
the complete file goes to disk FIRST, then iterate.

## 2. Pinned interfaces

### 2.1 `src/av_proj.js` (sa-A) — classic script, ONE namespace `avProj*` / `AV_PROJ_*`

```js
avProjInit() -> boolean                      // idempotent; no DOM; nothing to bind
avProjSetFs(fs|null) -> boolean              // injection seam: { showOpenFilePicker, showSaveFilePicker }
                                             // resolved per call (window FSA default; the ONLY FSA reach)
avProjBuild(state?, meta?) -> {ok, error?, name, text}   // pure; deterministic bytes
avProjParse(text) -> {ok, error?, project}   // pure; magic/kind/v validation
avProjSave(opts?) -> Promise<receipt>        // capture -> build -> FSA save / download fallback
avProjOpen(opts?) -> Promise<receipt>        // FSA open -> parse -> avSessionApply(state)
avProjImportSamples() -> Promise<receipt>    // FSA multi-open -> avSampleImportFiles(files)
avProjClasses() -> []                        // mounts nothing (the UI card owns markup)
window.__avProj = { version, init, setFs, build, parse, save, open, samples, state }
```

- **`.anvl` v1 payload** (JSON text, LF): `{ magic:"anvl", v:1, app:"anvil", kind:"project", at:<ISO>,
  name, state:<avSessionCapture() output verbatim> }`. Open validates magic==="anvl" && v===1 &&
  kind==="project" && state object; foreign/corrupt = honest `ok:false` (never throw).
  `state` is REQUIRED for open (that is the point); when `avSessionCapture` is absent (degrade),
  save refuses honestly ("no session module").
- Save naming: `anvil-project-<slug>.anvl` (slug from the session name or "untitled"; opts `name`
  overrides; stamp not in the default name — the payload carries `at`). Receipt:
  `{ ok, error?, name, bytes, via: "fsa"|"download", warnings[] }`; observables
  `window.__avProjLastSave = { name, bytes, via, at }`, `window.__avProjLastOpen = { name, ok, applied,
  skipped, at }`. FSA save: showSaveFilePicker({ suggestedName, types:[{description, accept:{"application/json":[".anvl"]}}] })
  -> createWritable -> write(text) -> close; AbortError (user cancel) = `{ok:false, error:"cancelled"}`
  without noise. Fallback = `avDeliverDownload(bytes|text, name)` when callable, else own anchor;
  `via` records the truth.
- Open: FSA open (multiple:false, accept .anvl + json) -> getFile() -> text() -> avProjParse ->
  `avSessionApply(project.state)` (typeof-guarded; the module's OWN laws apply — do not re-implement;
  read av_session.js first) -> receipt `{ ok, error?, name, applied, skipped, warnings[] }` —
  `applied/skipped` mirror avSessionApply's receipt. `opts.state` seam skips the picker (tests).
- Samples: FSA multi-open (audio types: .wav/.mp3/.ogg/.flac/.m4a) -> File objects ->
  `avSampleImportFiles(files)` (typeof-guarded reuse) -> receipt `{ ok, error?, added, errors, count,
  max, via:"fsa"|"input" }`; fallback = hidden `<input type="file" multiple accept="audio/*">`
  appended once, click, change -> same path. AbortError = cancelled calmly.
- `avProjState() -> { version, init, fsKind:"window"|"injected"|"none", lastSave, lastOpen,
  lastError }`. FSA support check: typeof showSaveFilePicker/showOpenFilePicker.

### 2.2 `src/av_card.js` (sa-B) — classic script, ONE namespace `avCard*` / `AV_CARD_*`

```js
avCardInit() -> boolean
avCardBuild(patch?) -> {ok, error?, patch}   // live defaults: name/kind/params/macros
avCardEncode(patch) -> {ok, error?, enc}     // compact JSON -> base64url (no padding), deterministic
avCardDecode(enc) -> {ok, error?, patch}     // tolerant
avCardUrl(patch, base?) -> {ok, error?, url} // base defaults location.origin+pathname; '#avp='+enc
avCardApplyUrl(hash?) -> receipt             // parse '#avp='; apply (see order); default location.hash
avCardQr(text) -> {ok, error?, version, ec, size, matrix}   // clean-room byte-mode QR, EC M
avCardQrSelfCheck(text) -> {ok, version, syndromesZero}     // RS syndromes + format round-trip
avCardPng(patch, url?) -> Promise<{ok, error?, blob, bytes, w, h}>   // 1080x1080, deterministic
avCardShare(opts?) -> Promise<receipt>       // build+encode+png -> navigator.share | download
avCardCopyLink(patch?) -> Promise<{ok, url, via}>   // clipboard API guarded; fallback honest
avCardClasses() -> []
window.__avCard = { version, init, build, encode, decode, url, applyUrl, qr, qrSelfCheck, png,
                    share, copy, state }
```

- **Patch payload v1:** `{ n: name (string ≤48), k: engine kind (string; from the avParams mirror when
  present), p: { path: value } — finite numbers + booleans only, sorted keys, ≤256 entries },
  m: [8 numbers clamped 0..1 from avModPayload() — zeros when absent] }`. No Date, no random.
- Encode: `JSON.stringify` -> UTF-8 -> base64url; refuse > 2048 chars honestly (v1 cap). Decode
  tolerant (bad base64/JSON/shape = `ok:false`).
- **Apply order (mirror av_session.js's apply — READ IT):** kind first
  (`avApplyParam("engine.kind", k)` when k), then `p` paths in sorted order through the CURRENT
  `avApplyParam` funnel (resolved per call — the wraps reassign it), then macros `mod.macro1`..
  `mod.macro8` exactly the way av_session's mod rows commit (regex `/^mod\.macro[1-8]$/`, funnel
  `__avModWrap`; `avModMacroSet(i, v)` is the module's own setter). Receipt
  `{ ok, applied, skipped, macros, error? }`; restore discipline is the CALLER's (UI note says so).
- **QR:** clean-room byte-mode encoder, error-correction **M**, versions 1..15 auto; mask = lowest
  penalty of the 8 (spec penalty rules); text ≤ 500 bytes else honest refusal. Self-check = RS
  syndromes zero + format-info bits round-trip (the harness proves the encoder mathematically).
  `matrix` = array of row strings of "0"/"1" (JSON-safe; no canvases).
- **PNG card:** 1080×1080; dark bg + teal (house palette); wordmark "ANVIL — a MODDYS Foundry
  instrument"; patch name; kind + up to 8 `p` entries as text; the QR when it fits (else honest
  "link too long for QR" note); URL text small; footer "free · local-first · moddys.net". Pure
  drawing from the payload (deterministic); canvas.toBlob('image/png'). Uses its OWN offscreen
  canvas (document.createElement guarded; refuse honestly without DOM).
- Share: `navigator.share({files:[png]})` when `navigator.canShare({files})` (guarded; user-cancel =
  calm ok:false); else download via avDeliverDownload/anchor. `window.__avCardLast = { enc, url,
  pngBytes, via, at }`.

### 2.3 `src/av_video.js` (sa-C) — classic script, ONE namespace `avVideo*` / `AV_VIDEO_*`

```js
avVideoInit() -> boolean
avVideoSupported() -> { ok, capture, recorder, audio, mime, reasons[] }   // honest degrade report
avVideoRenderFrame(input, g, t) -> boolean   // THE compositor (harness-covered; stub 2d ctx ok)
avVideoRecord(opts?) -> Promise<receipt>     // realtime capture; seconds default 8 clamp 2..60; fps 30
avVideoDownload(blob, name?) -> bool         // reuse avDeliverDownload / anchor
avVideoClasses() -> []
window.__avVideo = { version, init, supported, record, renderFrame, download, state }
```

- **Compositor** draws 1280×720 from `input = { meta:{name,bpm,at?}, scope:{n,min,max}|null,
  spectrum:{bands}|null, waterfall:{rows,latestRow,cols,data}|null, notes:[{name,held}], t,
  seconds }`: bg + grid; scope trace; spectrum bars; waterfall slice; big note readout (held notes /
  last); title (name · bpm · ANVIL wordmark). Deterministic given input (no Date/random).
- **Record pipeline (realtime):** live ctx resolved like av_deck's attach (read it — never a new
  AudioContext); `avBounce` the current pattern -> AudioBuffer (read av_bounce.js for the receipt
  shape) -> BufferSource -> MediaStreamAudioDestinationNode -> audio track. No pattern/notes ->
  honest warning + video-only clip (no fake audio). Canvas: own offscreen canvas, captureStream(fps)
  -> video track; `new MediaStream([video, audio?])` -> MediaRecorder mime chain
  `video/webm;codecs=vp9,opus` -> `vp8,opus` -> `video/webm`; rAF loop calls the compositor with
  LIVE inputs (deck frames + avNote poll + meta) until `seconds`; stop -> blob. Not supported /
  no live ctx / no recorder = honest refusal `{ ok:false, error, reasons }`. Receipt `{ ok, error?,
  blob, bytes, seconds, mime, warnings[] }`; `window.__avVideoLast = { bytes, seconds, mime, at }`.
  Cleanup ALWAYS (tracks stop, nodes disconnect, rAF cancelled).
- `opts.onProgress(phase, frac)`; `opts.seconds`; `opts.fps`; `opts.download` bool (default false;
  true = also fire avVideoDownload).

### 2.4 `src/av_files_ui.js` (sa-D) — the card into `#av-files-host` (parent adds the host)

- Root `#av-files` · `.av-files[data-av-files="1"]` · `avFilesUiWired="1"` dataset on the host; class
  prefix `av-files-*` reusing `av-btn` / `av-note` / `av-dim` / `av-select` house tokens.
- Three sections + controls (ids pinned): PROJECT — `#av-files-save` (SAVE .anvl) ·
  `#av-files-open` (OPEN .anvl) · `#av-files-samples` (IMPORT SAMPLES) · `#av-files-pstat`;
  SHARE — `#av-files-card-make` (MAKE CARD) · `#av-files-card-copy` (COPY LINK) ·
  `#av-files-card-png` (SAVE PNG) · `#av-files-card-preview` (an `<img>`; object URL of the last
  PNG) · `#av-files-cstat`; VIDEO — `#av-files-video-run` (RENDER CLIP) ·
  `#av-files-video-preview` (a `<video>`; object URL of the last clip; muted) · `#av-files-vstat`.
  Status line `#av-files-status` + busy discipline (buttons disable while a job runs; never queue).
- `avFilesUiInit() -> bool` (false without host; idempotent; re-mountable) · `avFilesUiSync() ->
  bool` · `avFilesUiSnap() -> {...}` (busy flags, last receipts, previews present, cores present) ·
  `avFilesUiClasses() -> string[]` · `window.__avFilesUi = { version, state, sync, snap, init }`.
  Honest degrade notes when av_proj/av_card/av_video are absent; no console noise; every core reach
  typeof-guarded per call.

### 2.5 Rig `verify/cdp_s4.mjs` (sa-E writes; parent runs)

Launch skeleton VERBATIM from `cdp_deck.mjs` (same flags, freePort, metrics 1440×900, helpers with
`userGesture:true`); `EXPECT_SHA = null` until the parent pins. Proofs (~34–38):
1. boot + card mounted (#av-files + #av-files-host + root + wired + all three sections' controls) +
   module surface (avProj*/avCard*/avVideo*/avFilesUi* + window handles; inits true).
2. project save: seam FS injected (`avProjSetFs` with a page-side fake storing writes) -> avProjSave
   -> bytes parse via avProjParse (magic/v/kind/state.sessionless checks) + text round-trip equals
   built text; `via:"fsa"`; observable set. **Determinism: build twice -> identical text.**
3. project open: load a pattern (the cdp_bounce BUILD_PATTERN shape) + set a marker param, save via
   seam, MUTATE the param + pattern, open via seam (opts.state) -> param restored + pattern restored
   (compare avSeqSnap notes) + receipt applied>=1; foreign payload (bad magic / v2) -> honest
   ok:false, nothing applied.
4. samples: page-side WAV File (avWavEncode output bytes -> File) via seam picker -> receipt added
   includes it; avSampleStore count advanced; `via:"fsa"`.
5. card: build (set a known param + kind) -> encode/decode round-trip (kind, p values, m length 8);
   enc ≤ cap; URL starts with location base + '#avp='; applyUrl: set location.hash to the enc URL's
   fragment fragment, call avCardApplyUrl() -> param changed to the encoded value (restore after);
   bad enc -> ok:false.
6. QR: avCardQrSelfCheck for two strings (short ASCII + a real URL) -> syndromesZero true; matrix:
   three finder patterns present (corners), size = 17+4v, deterministic (same digest twice);
   >capacity text -> honest refusal.
7. PNG: avCardPng -> PNG magic bytes (89 50 4E 47 0D 0A 1A 0A), bytes > 4096, w=h=1080; preview img
   src set by MAKE CARD (blob: prefix) — or via ui snap; share path: avCardShare with share absent
   -> download record (`__avCardLast.via === "download"`; the headless anchor write is accepted).
8. video: avVideoSupported honest report; load pattern first; avVideoRecord({seconds:2, fps:15,
   download:false}) -> blob magic 1A 45 DF A3 (EBML), bytes > 8192, mime in the chain, seconds 2,
   warnings []; `__avVideoLast` set; unsupported-path refusal never throws (stub check optional).
9. laws: zero page errors; screenshot `renders/s4-suite.png` (card live @2x); sha256 before === after;
   cleanup (params/hash/notes restored or noted; no real picker ever reached — the fake FS records
   every call).
10. Freeze leg: `EXPECT_SHA` pin check (null until pinned; after pin, sha === pinned — the deck rig's
    10e shape).

## 3. Laws (wave-specific)

1. ONE writer per file; 'use strict'; classic scripts; ONE namespace each; node-loadable (zero DOM
   at load; guarded reaches). 2. NEVER throw; honest refusals; counted skips; no console noise.
3. No new AudioContext; offline contexts excluded from video (only the buffer → live ctx playback).
4. FSA + clipboard + share + MediaRecorder all typeof-guarded per call; the seam is the ONLY FSA
   reach; AbortError = calm cancel. 5. Nothing uploads — QR/link/card/clip are local artifacts.
6. Licences: QR = own clean-room; all else platform APIs (no libs). 7. Bounded everything (caps
   listed above; errors arrays capped at 16). 8. Children self-verify with DOM-free node harnesses
   (stub 2d ctx records ops; fake FS records calls; MediaRecorder NOT needed in harness — the rig
   owns the real path).

## 4. Parent integration (after children land)

ONE counted-assert script (`cache/scratch/s4/integrate/_s4_integrate.py`): build.py js_parts
(`av_proj` → `av_card` → `av_video` → `av_files_ui` after `av_deck_ui`, before `av_synth`) · body
`#av-files` card + `#av-files-host` after `#av-deck` (+ hero/footer copy) · styles block (class
coverage via runtime extraction) · app_core **1.2.0 "S4 · deliver extras"** + guarded inits
(avProjInit/avCardInit/avVideoInit/avFilesUiInit) + log fields + the guarded `avCardUrlApply()` boot
hook (after the inits) · cdp_smoke S4 card check (**22 → 23**). Then: rebuild → smoke → `cdp_s4` first
run (+ fixes) → pin EXPECT_SHA → re-run → FULL battery (**16 suites**; re-pin every freeze file) →
PERF GATE (bench within variance of bench-v15; worklet sha must stay `6e66274e` — no engine work this
wave) → commits + addendum 30 + README + mnemosyne.

## 5. Watch items

- MediaRecorder in headless=new: first rig run reveals (fallback chain pinned; if the recorder stalls,
  triage like DECK 4b — probe → fix to intent, app vs rig side by evidence).
- `canvas.toBlob` is async-callback; wrap in promises; headless supports it.
- QR mask selection must be deterministic (lowest penalty; tie → lowest mask number).
- The rig's fake FS must record every call so "no real picker reached" is provable.
- Video audio: avBounce determinism laws apply; silent-with-warning when no pattern (honest).
- The UI card must not auto-run heavy jobs on init (explicit buttons only); previews are object URLs
  (revoke on replace).

Carried: popout keyboard · CODE (#81) · walkthrough/help (#20/#45/#80) · platform (share/cloud/PWA,
#78/#82) · P·2 minBLEP pass · P4 follow-ups · PERFECT TUNINGS · optional quiet-window bench re-runs.
Resume phrase: **"continue anvil"**.
