# verify/_r18b_wave.md — R18b: linked source folders + PWA file_handlers widening — contract

Opened 2026-10-09 (close of R18a). Plan of record: `docs/12-import-and-persistence.md` §3.1 item 2/4,
§3.4 (linked source folders), §5 R18b line, §7.4 item 4 (the .zip accept-list gate). Recon digest
(spot-verified): `cache/r18/recon-r18.md` §5 (FSA seam) + §6 (PWA) + §7 (build) + §8 (rigs).
Base: HEAD 996174d; frozen `a85af992`; worklet `b65160e0` MUST stay untouched (page-side wave);
battery baseline 25 suites (smoke 75 · cdp_hub 33 · cdp_import 24 · cdp_platform 52).

## §1 Scope

IN: linked source folders — `av-sources-store` (persisted FSA directory handles), link / RE-SCAN /
diff NEW·CHANGED·GONE / import-new / unlink / reconnect banner; the FSA dir-picker seam mirroring
`avProjSetFs`; the hub card's LINKED SOURCES section; File menu item "Link source folder...".
PWA `file_handlers` widening (`.anvl .zip .wav .mp3 .mid`) + the non-anvl launch route into the
import funnel.

OUT: folder watchers (none on the web — explicit refresh only); auto-import; tags (R18a left them
out; not this wave); `.avpack` (R19); persistence (R20). No engine/worklet work. `cdp_import`'s 24
checks must stay green UNCHANGED. `cdp_platform` P1d is the manifest pin that moves (below);
its count stays 52.

## §2 Design decisions (locked)

- D1 **Seam = av_proj.js mirror, resolve-per-call:** `avSrcFs()` (injected when `fsInjected`,
  else window), `avSrcFsKind()` → "injected"|"window"|"none", `avSrcDirPicker()` → `{fs, fn}` if
  the fs carries `showDirectoryPicker` (called `fn.call(fs, opts)`), `avSrcSetFs(fs|null)` (null
  clears; object must carry showDirectoryPicker; never merged). State exposes fsKind.
- D2 **Store:** IDB `av-sources-store` v1, store `sources`, keyPath `id`, create-if-missing only
  (NO version bump); record `{id, v:1, name, handle, linkedAt, lastScanAt, mode:"linked"}` —
  handles are structured-cloneable. LS mirror NOT required (handles are not JSON) — the LS tier
  reports the folded backend honestly ("mem"/"idb"); absence of a directory handle in the LS tier
  = the record lists with status "reconnect" and scans refuse honestly.
- D3 **Walk surface (the MINIMAL handle surface the core consumes — the rig stub contract):**
  dirHandle `{kind:"directory", name, values() → async iterator of [name, childHandle],
  queryPermission?(opts), requestPermission?(opts)}`; child dirs recurse; file handles
  `{kind:"file", name, getFile() → Promise<File>}`. Walk: depth cap 4, file cap 500, extension
  filter = `AV_SOURCES_EXTS` = ["wav","mp3","aiff","mid","rex2","adg","als","exs","nki","nbkt",
  "sxt","serum","zip"]. Never throws outward; `capped:true` reported when a cap clipped the walk.
- D4 **Refusals are calm:** AbortError (picker cancel) → `{ok:false, error:"cancelled"}` — no
  error state; absent picker → honest "linking needs the File System Access API" note.
- D5 **Diff vs the library (R18a `source` field):** walked file → `NEW` (no library item with the
  same leaf name AND size), `SAME` (name+size), `CHANGED` (same name, different size),
  `GONE` = library items whose `source.path` starts with `<folder record name>/` and whose leaf
  is no longer on disk. Scan sorts all lists by name; counts {new, changed, same, gone}.
- D6 **Import-new provenance:** `avSourcesImportNew(id)` re-wraps each NEW file as
  `new File([innerFile], rec.name + "/" + relPath)` and feeds them through the ONE funnel
  `avImportFiles(list)` (av_import.js). Consequence: `source.path` self-describes the folder
  (`"MySamples/sub/kick.wav"`) so D5's GONE match works. Leaf names stay correct (av_import
  takes the leaf; avLibBaseLower splits on "/").
- D7 **PWA widening (docs/12 §3.1.4):** `.anvl` keeps the text→`avProjOpenText` route; the other
  widened extensions keep the File INTACT and route to `avImportFiles([file])` (guarded; honest
  note on absence). NEVER decode non-anvl as text. Manifest accept block pinned in §4D.
- D8 **Reconnect v1:** on list/scan, `queryPermission({mode:"read"})` → "granted" | "prompt" |
  "denied" | "unknown" (absent fn = "unknown" = the LS-tier case); "prompt"/"denied" → the row
  shows RECONNECT; `avSourcesReconnect(id)` calls `requestPermission` (gesture-bound).

## §3 Child A pins (`src/av_sources.js` — NEW; sole writer)

API (all guarded, never throw outward; async unless noted):
1. `avSourcesVersion` const ("r18b.0"); `AV_SOURCES_EXTS`; `avSourcesClasses()` → `[]` (no DOM).
2. `avSourcesLink()` — picker (D1/D4) → record (D2) → persist → first scan → receipt
   `{ok, id?, name?, scan?, error?}`.
3. `avSourcesList()` → `{ok, count, items:[{id, name, linkedAt, lastScanAt, mode, perm, new, changed, gone, note}]}`
   (the per-row counts come from the LAST scan memo; 0s before a scan).
4. `avSourcesScan(id)` → `{ok, id, scan:{new:[{name, relPath, size, mtime}], changed:[...same...],
   gone:[{id, name, path}], same:N, capped:bool}, error?}` — updates the memo + `lastScanAt`.
5. `avSourcesImportNew(id)` → `{ok, id, count, receipt?}` — D6; refreshes the memo (a fresh scan).
6. `avSourcesUnlink(id)` → `{ok, id, removed:bool}` — record + handle released.
7. `avSourcesReconnect(id)` → `{ok, id, perm, error?}` (D8).
8. `avSourcesState()` / `avSourcesSnap()` → `{ok, fsKind, backend, count, items:[...], note}`.
9. Facade `window.__avSources` = `{version, status:avSourcesState, list, link, scan, importNew,
   unlink, reconnect, setFs, fsKind}` — additive-only style; every call safe before init (lazy).
Globals must be unique (strict-mode duplicate guard): only `avSrc*`/`AV_SRC*`/`avSources*`.

## §4 Child B pins (`src/av_sources_ui.js` — NEW; sole writer)

1. Mounts the LINKED SOURCES section into `#av-sources-host` (created by Child C inside the
   import card). Idempotent init; re-renders on `avSourcesUiRefresh()` (called after ops + on an
   interval-free basis — ops self-refresh).
2. Markup (pinned ids/classes/attrs):
   - Section: `.av-sources` wrapper; header `.av-sources-head` + `LINKED SOURCES` title +
     status span `#av-sources-status`.
   - LINK button `#av-sources-link` (label "LINK FOLDER"); empty state `.av-sources-empty`
     ("no linked folders — link one to re-scan and diff it against the library").
   - Rows `.av-sources-row[data-id]` (BUSY attr `data-busy="1"` while an op runs — ONE op at a
     time, the card busy law): name span `.av-sources-name`, meta `.av-sources-meta`
     ("linked · last scan … · new N · changed N · gone N"), RECONNECT button
     `.av-sources-reconnect` (only when perm !== "granted"), SCAN `.av-sources-scan` (label
     "RE-SCAN"), IMPORT `.av-sources-import` (label "IMPORT NEW (N)", disabled when N=0),
     UNLINK `.av-sources-unlink`.
3. All wiring rides `window.__avSources` guarded (absence → honest note, never throw). Status
   line messages move through the existing card status span if reachable, else the section's
   own `#av-sources-status`.
4. `avSourcesUiInit()` → bool; `avSourcesUiClasses()` → exactly the class list used (for the
   parent styles block); facade additions NONE (the core's facade is the single rig surface).
5. Esc/blur not needed (no editors). Buttons are `.av-btn mini` (the icon-box law — wide labels
   need min-width:auto patterns; keep labels single-line).

## §5 Child C pins (EDITS: `src/av_import_ui.js` host div + `src/av_menubar.js` menu item; sole writer)

1. `av_import_ui.js`: insert `<div id="av-sources-host"></div>` inside the card body HTML
   (avImportUiBodyHTML), directly BEFORE the closing of the card — after the storage-foot block
   and the hist block (child anchors on the actual tail at authoring; report the anchor line).
   NO other edits: classes/ids/behavior untouched (smoke + cdp_hub + cdp_import run against
   this file).
2. `av_menubar.js`: File menu gains `Link source folder...` DIRECTLY AFTER `Import folder...`
   (label exact, ASCII dots), routing through the menu's existing guarded-action shape to
   `avSourcesLink` (typeof-guarded; honest no-op if absent). Read the menu's own convention and
   follow it exactly (report the action form used).

## §6 Child D pins (EDITS: `src/av_pwa.js` + `verify/cdp_platform.mjs`; sole writer)

1. `av_pwa.js` — `avPwaLaunchHandle` gains the route (D7) before any text decode:
   - `.anvl` (case-insensitive) → existing text path unchanged.
   - ext ∈ {"wav","mp3","mid","zip"} → keep `file` intact; `typeof avImportFiles === "function"`
     → `avImportFiles([file])` (fire-and-forget with a `.then` refusal logger); else honest
     `s.launchNote`. `s.lastLaunch = {name, via:"import"}`; store the ext.
   - unknown ext → keep the .anvl-text path? NO — unknown → the import funnel too (the sniffer
     refuses honestly, better than decoding binary as text). Pin: everything except .anvl goes
     to the funnel.
2. `avPwaLaunchHandoff` — unchanged (the .anvl path); non-anvl MUST NOT reach it.
3. `verify/cdp_platform.mjs` P1d check → the widened manifest (exact literal READ IT FIRST:
   `grep -n "P1d" verify/cdp_platform.mjs`; update the expectation, keep the check's strength:
   action === './index.html' + accept carries ALL FIVE keys with exact arrays:
   `application/x-anvil-project:[".anvl"]`, `audio/wav:[".wav"]`, `audio/mpeg:[".mp3"]`,
   `audio/midi:[".mid"]`, `application/zip:[".zip"]`). Count stays 52. The manifest itself is
   emitted by the PARENT (build.py edit at integration — the literal below is the source of
   truth for both sides):
   `"file_handlers": [ { "action": "./index.html", "accept": { "application/x-anvil-project":
   [".anvl"], "audio/wav": [".wav"], "audio/mpeg": [".mp3"], "audio/midi": [".mid"],
   "application/zip": [".zip"] } } ]`

## §7 Child E pins (`verify/cdp_hub.mjs` — EDIT; +6 legs; sole writer)

New section `/* ── 23c. R18b linked source folders ── */` AFTER the R18a block (23b) and BEFORE the
drop legs; in-page fixtures only. Stub: `__avSources.setFs({ showDirectoryPicker: async () => dir })`
where `dir` is a MUTABLE synthesized tree (per the D3 surface; the rig keeps a handle on it).
Legs (each: guarded probes, honest info JSON):
1. **link:** setFs(stub) → `__avSources.link()` → ok + id + name "RIGSRC"; list shows it; fsKind
   "injected". (The stub picker resolves the tree directly.)
2. **scan diff:** tree = {x.wav, sub/y.wav, kick.wav(also already in library? NO — fresh names)}
   → scan → `new === 3` (sorted names), `same === 0`, `gone === 0`, capped false.
3. **import new:** `importNew(id)` → count 3 → library gains the three, `source.path` starts with
   "RIGSRC/" (assert one), re-scan → `new === 0`, `same === 3`.
4. **change + gone:** mutate the tree (grow x.wav's bytes → same name new size; delete y.wav) →
   rescan → `changed >= 1` (x.wav), `gone >= 1` (y.wav's library item).
5. **reconnect state:** swap the stub handle's `queryPermission` → "prompt" → list/scan surface
   `perm !== "granted"` (the reconnect row state); `reconnect(id)` with `requestPermission` →
   "granted" → perm "granted".
6. **unlink:** unlink → list count 0; a scan of the old id refuses with `{ok:false}`.
Keep EXPECT_SHA as-is (parent re-pins at freeze; the count 33 → 39 pinned is derived at the
freeze). Fixtures synthesized in-page via `avWavEncode`; no disk files.

## §8 Parent integration

- build.py manifest emission → the §6 literal (count/order pinned there); build + rebuild.
- app_core: guarded `avSourcesUiInit()` boot (after the import UI boot) + version **1.8.0
  "R18b · linked folders"** + boot-log flag.
- styles.css: the styles block from `avSourcesUiClasses()` (chips/rows/buttons; the wide-button
  law for any text `.av-btn` — the smoke layout guard must stay green).
- cdp_smoke: +1 check — the linked-sources section mounts in the hub card + `__avSources` facade
  shape (75 → 76).
- Gates: smoke **76** · cdp_hub **39 pinned** (derived) · cdp_import **24 UNCHANGED** ·
  cdp_platform **52** (P1d widened) · battery 25 + bench · pins sweep (full 64-hex literals;
  count re-checked at freeze) · worklet `b65160e0` UNCHANGED · deploy = index.html + sw.js +
  **manifest.webmanifest** (new in the set — accept widened) · live pass + capture · addendum 62.

## §9 Watch-outs

- The re-wrapped File names carry "/" (D6) — verify av_import's leaf/sibling logic on one
  round-trip; the kit/zip paths must accept the relPath form.
- `.zip` keep-or-drop (§docs/12 §7.4): v1 KEEPS .zip in accept (the funnel handles zip; the real
  launchQueue arrival test is owed to the owner pass — headless cannot launch files from the OS).
- Handle persistence needs IDB; on the LS tier the record lists with status "reconnect" and all
  scans refuse honestly (no fake success).
- `avImportFiles` is global in av_import.js — typeof-guard everywhere; Child D and A both call it.
- One writer per file; children never run the build/browsers/suites/git; report shape §10.
- Source wins over pins; a conflict is named in the report, never silently diverged.

## §10 Report shape

Per child: files written · interface list as implemented · not-done · conflicts · uncertainties.
Parent verifies landings by artifacts on disk (search_files + node --check), never by report.

## §11 Close amendments - 2026-10-09 (as-built)

- **Integration miss (named):** the parent integration script's first pass added the app_core
  boots but NOT the two build.py `js_parts` entries -- caught by the first triage chain (smoke
  75/76 + hub 33/39: the R18b surface absent from the bundle). Fixed (js_parts gains av_sources +
  av_sources_ui before app_core); re-run green.
- **Close gates (frozen `4614fbe1d5cbd5e64be456343d26cdcacc103288388852b5a90e9aec715bd7775`,
  4,120,547 B; worklet `b65160e0` unchanged; sw `b1f02503`; manifest `7cb76e43`):** smoke **76** ·
  cdp_hub **39** · cdp_platform **52** (widened P1d) · cdp_import **24** · battery **25 suites**
  + bench exit=0 (realtime {light 64, fat 48}; offline knee 96/128 monotone, invalidReads 0 --
  the recorded loaded-window class). Pins 22 -> `4614fbe1` full literals.
- **Battery-lap flake (recorded):** cdp_hub's two reload-wait legs missed once under battery load
  ("receipts survive fresh" + "library loads fresh") -- solo re-run **39/39 green** (the
  addendum-58 reload-wait flake class).
- **Rig SPEC notes:** none -- the six new legs passed first-run after the js_parts fix. The
  children's named uncertainties all resolved by the green runs (scan refusal under "prompt"
  matches the rig's leg 5; leaf-name sort matches; avMenuCall resolves the function declaration).
- Deployed: index.html + sw.js + **manifest.webmanifest** (the widened accept) -- scoped --verify
  0 not in sync; live shas = frozen; live probe: __avSources r18b.0 · 7 fns · fsKind "window" ·
  the five-key accept served live; leak 11/11 LIVE. Capture `renders/r18b-live-hub.png` inspected.
- Owed to the owner pass: the real launchQueue arrival test for the widened handler set (headless
  cannot launch files from the OS); a real FSA directory-picker click (gesture-gated; stubbed in rigs).
