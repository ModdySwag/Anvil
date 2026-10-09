# R22 wave contract — LIBRARY UX: overlay resize + minimize/maximize + row preview

Owner ask (2026-10-09, live-testing feedback on the K build):
1. The LIBRARY overlay cannot be resized -- add drag-to-resize.
2. A per-row play/preview so a sample can be auditioned BEFORE any further action
   (the ask's example: a play button next to the row's LOAD button).
3. A minimize/maximize toggle so the library can stay open and tidy while the user
   organizes multiple imported packs.

State at open: K wave CLOSED + LIVE at `d040302` (frozen `e99ea8e5`; app 1.13.0).
This wave is page-side; the worklet must stay untouched.

## 1. Deliverables + file ownership

| # | files | work |
|---|-------|------|
| A | `src/av_library_ui.js` | resize grip + min/max states + LS pref + snap + away-click suppression while minimized + facade extension |
| B | `src/av_sample.js` + `src/av_import_ui.js` | avSamplePreviewBytes (one-voice law) + row preview button + preview act |
| R | `verify/cdp_hub.mjs` | rig legs RS (resize) + MM (min/max) + PV (preview), append-only before the freeze leg |
| P | `src/styles.css` + `src/app_core.js` (version) + build/deploy/close | parent: styles from the emitted class list, version bump, integration, battery, deploy |

Children NEVER run build.py / git / browsers / suites; `node --check` on their own edited
files only; write-first (complete file state on disk, then iterate); ASCII-only source;
one writer per file; source wins on conflicts -- name them in the report.

## 2. Pins -- A: library chrome (`src/av_library_ui.js`)

Exact DOM (all inside the existing pinned markup; keep every existing id/class/behavior):

- Head buttons, placed BEFORE the close button (order: title · min · max · close):
  - `<button type="button" id="av-library-min" class="av-btn mini av-library-min" title="minimize (stays open)" aria-label="Minimize the library (stays open)" aria-pressed="false">\u2013</button>`
  - `<button type="button" id="av-library-max" class="av-btn mini av-library-max" title="maximize" aria-label="Maximize the library" aria-pressed="false">\u25a1</button>`
- Grip, appended INSIDE `.av-library-box` (after the body div):
  - `<div class="av-library-grip" data-av-library-grip="1" title="drag to resize (double-click resets)" aria-hidden="true"></div>`
- New emitted classes to add to AV_LIBRARY_UI_CLASSES: `av-library-grip`, `av-library-min`,
  `av-library-max` (parent authors their CSS from this list).
- State classes on the ROOT (#av-library-pop): `av-lib-min`, `av-lib-max`
  (toggled by A; parent CSS + rig assert on them).

State + persistence:

- `avLibraryUiState` gains: `min: false`, `max: false`, `size: null` (object w,h or null),
  `resizing: false`. The module keeps owning no core facts; this is UI-local.
- LS key `av-library-pref`, JSON `{v:1,w,h}`. Read ONCE at init (tolerant junk -> null).
  Clamp on open: w in [640, innerWidth-32], h in [340, innerHeight-32].
- Resize (normal state only; guard: return when min || max):
  - pointerdown on the grip -> setPointerCapture; move: box inline width/height px =
    base + delta, clamped to [640..innerWidth-32] x [340..innerHeight-32]; up: persist
    `{v:1,w:clampedW,h:clampedH}` to LS and store state.size.
  - double-click on the grip: clear the pref (LS removeItem) + clear inline styles
    (size back to the CSS default) + state.size = null.
  - The grip must NOT trigger the away-close (it is inside `.av-library-box`, which the
    existing away handler already excludes via closest -- verify, do not change the law).
- Minimize toggle (`#av-library-min` click):
  - on: min=true, max=false; root class `av-lib-min`; the pop stops blocking the app --
    the PARENT CSS makes the root background transparent + `pointer-events:none` with the
    box `pointer-events:auto` (A only toggles the class; do not inline styles for this).
  - off: min=false (back to normal).
  - Button mirror: aria-pressed + title `minimize (stays open)` / `restore`.
- Maximize toggle (`#av-library-max` click): on -> max=true, min=false, root class
  `av-lib-max`; off -> max=false. Button mirror: aria-pressed + title `maximize` /
  `restore (back to size)`.
- AWAY-CLICK SUPPRESSION (the pinned behavior change): in the away pointerdown handler,
  early-return when `avLibraryUiState.min === true`. Esc + the close button + the strip
  button all keep closing UNCONDITIONALLY (existing laws unchanged).
- open(): always starts in the normal state (min/max reset false); re-applies the stored
  pref size when present. close(): unchanged; pref survives.
- Snap (facade extension -- `window.__avLibrary` keeps every existing key):
  - new key `snap: function () { ... }` returning
    `{ open, state: "min"|"max"|"normal", w, h, pref: {w,h}|null, grip: bool }`
    (w/h = the box's getBoundingClientRect rounded; grip = the grip element exists).
  - existing keys {version, init, open, close, toggle, isOpen, note} unchanged.
- Report: node --check; the exact diff; a snap() sample; anything Undetermined.

## 3. Pins -- B: row preview (`src/av_sample.js` + `src/av_import_ui.js`)

av_sample.js (keep every existing behavior; the ONE preview voice law is extended, not
forked):

- New: `avSamplePreviewBytes(label, bytes)` -> Promise of `{ok, label, error, at}`;
  never throws; failures -> `{ok:false, error}`.
  - label: a stable string (the UI passes `"lib:" + itemId`).
  - bytes: ArrayBuffer | Uint8Array. COPY before decode (the detach law -- decodeAudioData
    detaches its input; mirror the copy + decode call shape of avSampleImportFiles).
  - decode via `avSampleStore.pickCtx()`; destination via `avSampleStore.destFor(ctx)`
    (the SAME master-tap law avSamplePreview uses); resume the ctx when suspended
    (same guarded shape as avSamplePreview).
  - a new preview PREEMPTS the old one (st.stopPreview() first -- one preview voice, ever).
  - new store fields: `activeLib` (label string or null). Set on start; cleared on
    stop/onended. `activeId` stays for session-entry previews (this path leaves it null).
    `lastPreview` gains `lib` (existing keys kept).
  - `st.stopPreview` must clear activeLib too (find where it clears active/activeId).
- New: `avSamplePreviewStop()` -> boolean (public wrapper: stops the ONE active voice,
  whatever its source; true when something was stopped).
- Snap: the store's JSON-safe snap() gains `previewLib: <activeLib| null>` (existing keys
  kept). `window.__avSample = avSampleStore` stays.

av_import_ui.js (append-only house style; the load-type set stays as-is apart from the
new first button):

- Row button, in `avImportUiLibRowHTML`'s sample/pattern else-branch, inserted BEFORE the
  LOAD button, ONLY when `kind === "sample"` and the format is audio-decodable:
  - gate: `fmt = String(it.format||"").toLowerCase();` previewable = fmt in
    `["wav","aiff","mp3","ogg","flac"]` -- RECONCILE against the importer's real stored
    formats (avLibExtNorm + the importer's format taxonomy); include real stored spellings
    ("aif"/"wave" if they occur), report the final list.
  - markup: the same `av-btn mini av-import-act` shape with `data-av-import-act="preview"`;
    glyph `\u25b6` (title `preview -- one-shot through the master tap (no session load)`);
    when this id is the active preview: glyph `\u25a0`, title `stop the preview`, plus the
    class `av-import-act-playing` on the button.
  - the playing state is derivable at paint time from the active label (repaints keep it):
    one local helper reading `avSampleStore.activeLib` typeof-guarded.
- Act: `avImportUiAct` gains `if (act === "preview") return avImportUiActPreview(id);`
  (the click delegation that forwards [data-av-import-act] needs NO change -- VERIFY, and
  report if a whitelist exists).
- `avImportUiActPreview(id)`:
  - when `s.busy` -> the existing busy refuse. (Preview does NOT set busy: it is
    non-mutating; it never adds session entries or touches the session/song state.)
  - if the active label === `"lib:" + id` -> stop (avSamplePreviewStop; fallback
    `avSampleStore.stopPreview()` typeof-guarded) -> `avImportUiMgrTouch(false)` -> done.
  - else: read bytes via `avLibGet(id)` (the same getter the EXPORT action uses; the
    receipt shape is `{ok, item}` -- confirm which field of item carries the bytes in
    source and use it) -> `avSamplePreviewBytes("lib:" + id, bytes)` -> repaint
    (`avImportUiMgrTouch(false)`); failures -> the nearest honest note channel the other
    acts use (name it in the report; no fake success).
- Report: node --check both files; the exact gate list reconciled with source; the exact
  note channel chosen; anything Undetermined.

## 4. Rig contract -- R: `verify/cdp_hub.mjs` (append-only, BEFORE the freeze leg)

The freeze leg must stay LAST. Manage overlay state locally (open if closed; close at the
end). Use the existing helpers (ev / waitFor / clickSel / mouse / note). For the audio
witness copy the analyser seam verbatim from an existing rig that witnesses the master tap
(cdp_bank / cdp_store -- the av_bank preview law); attach the analyser to the master bus
node so it taps WITHOUT intercepting.

Legs (names are the contract):
- RS1 resize: open overlay; snap0; grip visible; CDP drag from the grip centre in 3 steps
  (+80,-40) each; assert w1 >= w0+180; h1 <= h0-60; LS av-library-pref present and matching
  snap w/h within 3px (default height stretches -- dragging UP shrinks it, so the assert
  is a shrink).
- RS2 persist: close + reopen via the facade; snap w/h match RS1 within 3px.
- RS3 clamp: drag (+9999,+9999) -> w <= innerWidth-30 and h <= innerHeight-30;
  drag (-9999,-9999) -> w >= 640 and h >= 340.
- RS4 reset: double-click the grip -> pref cleared (LS null) + size back to default
  (w0/h0 within 4px).
- MM1 maximize: click #av-library-max -> snap.state "max" + box width >= pop content
  width-2; MM2 click again -> "normal" + prior size back.
- MM3 minimize: click #av-library-min -> snap.state "min" + box height <= 64 + the body
  div is not visible.
- MM4 away suppression: dispatch a pointerdown+up OUTSIDE the box (e.g. 10,10) -> the
  overlay is STILL open (isOpen true).
- MM5 restore: click #av-library-min again -> "normal".
- PV0 fixtures: alpha = the hub-alpha.wav row id (from avLibList by name); zulu = the
  hub-zulu.wav row id; mid = the hub-mike.mid row id (if a name is absent at that point,
  pick the nearest sample row and note it).
- PV1 audition: alpha's row has a `[data-av-import-act="preview"]` button; click it ->
  within 600ms: snap.previewLib === "lib:"+alpha && audio rms over a ~300ms window at the
  master tap > 0.001; the button carries av-import-act-playing.
- PV2 stop: click again -> previewLib null within 600ms; button glyph back; no residue.
- PV3 preempt: start alpha, then click zulu's button -> previewLib === "lib:"+zulu; alpha's
  button no longer playing; exactly ONE active voice.
- PV4 gate: the mid row has NO preview button.
- PV5 no side effects: avLibList().count unchanged across PV1-PV3; __avSample snap entry
  count (session entries) unchanged.
- Report: the new leg count + the full new-checks list; keep every existing check intact.

## 5. Parent integration + gates

- Parent authors `src/styles.css` from the reconciled emitted class list (grip visual,
  av-lib-min dock (transparent + pointer-events none; box auto; hide body+status; width
  auto <= 560px; docked bottom-left), av-lib-max fill, .av-import-act-playing accent).
- Parent bumps app_core version -> 1.14.0, phase `R22 - library ux`.
- Parent: build.py rebuild -> sha; pins sweep (cdp_hub EXPECT_SHA + any others carrying
  the old sha); `--anchors`-style counted-assert discipline for its own edits.
- Triage: smoke + import + hub (new legs) + cockpit green.
- Battery: full 26 suites + bench + alias + stress x2 on the frozen bytes; then deploy
  (deploy_t.sh), leak (file + LIVE), live version check, addendum, commit, Mnemosyne.

## 6. Watch-outs

- Escape hazard: if a write/patch tool lands escape sequences as literal text (seen once
  this session), repair with a scoped python script built from chr(92) constants and
  verify byte-level (repr + counts) before committing. Repo src files are LF.
- The continuation doc is PURE CRLF -- touch it only with byte-verified edits.
- Preserve a failing rig log before the first re-run (cp to a preserved name).
- Never loosen an existing check or gate; never fabricate success -- honest refusals
  report their reason.
- The overlay's existing laws (idempotent init, Esc, away-click, focus return, note())
  must all keep working; the ONLY behavior change is away-close suppression while min.

## 7. Report shape (every child)

- files touched + the exact edit set (line-anchored);
- node --check output for each edited file;
- reconciliation notes (gate list / receipt shape / note channel -- whatever you verified
  against source);
- an Undetermined list (anything you could not verify statically).

## 8. W -- header responsive fix (owner clip 2026-10-09: resizing the screen -> overlap)

Probe evidence (cache/scratch/kdiag/header_probe.mjs, run 2026-10-09): the header's natural
one-row content width is 1298px. Below ~1300px the flex-shrink squeezes the right-cluster
buttons down to the .av-btn.mini 24px min-width FLOOR, so labels overflow their boxes and
collide (BROWSE shows as BRO etc -- the owner screenshot), and the a11y cluster
(av-a11y-contrast @1162+72 / av-a11y-motion @1240+58) extends past the viewport and is
clipped at narrower widths. Buttons carry flex-shrink 1; no wrap anywhere.

Fix (PARENT CSS at integration; a three-part change, keep every existing pin intact):
- `header.av-head.av-console { flex-wrap: wrap; row-gap: 6px; }`
- `header.av-head.av-console > .av-btn { flex: none; }`
- `header.av-head.av-console #av-a11y-host { flex: none; }` and
  `header.av-head.av-console #av-a11y-host .av-btn { flex: none; }`
- the >=1520px absolute-centre block stays unchanged.
Behaviour target: at fit widths one row exactly as today; when tight the right cluster
wraps to the second row (header height grows; nothing clips, nothing collides).

W (child) deliverables:
1) src/av_chrome.js / src/av_console.js / src/av_a11y.js -- change ONLY if static reading
   shows the CSS alone cannot hold; otherwise report "no source change needed" with the
   reasoning. (write-first rule applies if a change is needed.)
2) NEW `verify/cdp_fit.mjs` -- the width-sweep fit rig. Clone the launch block from
   verify/cdp_hub.mjs (raw CDP, Edge headless, temp profile, wait for data-av-ready).
   Sweep widths [1440,1400,1300,1200,1100,1000,900,800] via
   Emulation.setDeviceMetricsOverride (250ms settle, one retry per read). Per width assert:
   F1 no pairwise overlap among visible header buttons (2px tolerance)
   F2 every header button's label fits its box: el.scrollWidth <= el.clientWidth + 1
   F3 the header is not clipped: header.av-head scrollWidth <= clientWidth + 1
   F4 no document horizontal scroll: documentElement.scrollWidth <= innerWidth + 1
   F5 av-a11y-contrast + av-a11y-motion fully inside the viewport (rect.right <= innerWidth+1,
      non-zero size)
   F6 header height <= 130px at every width
   F7 after resizing back to 1440: F1+F3 hold and all 15 header buttons are visible
   Floor note: 800px is the design floor (the transport deck itself cannot fit below);
   end with a FIT-RESULT line + a per-width tally; exit 0 only when everything is green.
3) Report: files touched + node --check output + the new check list + anything Undetermined.
