# R16 wave — the follow-ups: zip reading · REX2 slices -> chop kits · f64-WAV reader (contract)

State at open: R15d shipped + live (`50d6d793`, 3,886,455 B; sw `cc856925`). Smoke **69** · pins
**21 files** · battery **24 suites** · worklet sha `b65160e0` (page-side wave again — the concat
must not change). R15d's recorded follow-ups were: Serum `embeddedWTData` decode · REX2 slices ->
chop kits · zip reading · f64-WAV. This wave takes **zip + REX2->chop + f64-WAV**; the
`embeddedWTData` decode stays recorded (grep-verified 2026-10-09: 0 files in the local Serum 2
corpus carry the field — it genuinely needs a Serum-saved embed fixture).

## 1. Deliverable + file ownership

- CHILD A: `src/av_zip.js` — SOLE writer. Clean-room ZIP reader (§4.1).
- CHILD B: `src/av_import.js` + `src/av_import_ui.js` — SOLE writer of each. Zip expansion +
  bundles count + the counts-line edit (§4.4).
- CHILD C: `src/av_chop.js` + `src/av_lib.js` — SOLE writer of each. REX slice stash + the
  rex2 detect branch + the f64-WAV load route (§4.3).
- CHILD D: `src/av_wavio.js` — SOLE writer. f64 read support (§4.2).
- PARENT: `build.py` (1 new part) · `verify/cdp_smoke.mjs` (+3) · `verify/cdp_import.mjs` (+3)
  · pins sweep · docs/11 open-items edit (at close) · commit/deploy. NO other files.

Child laws (unchanged): one file each (B/C: two); complete file FIRST then iterate; `"use strict"`;
ASCII-only; DOM-free top level; never throws; unique top-level names; block-comment prose must not
contain the close sequence; `node --check` own file(s) only; NO build/browsers/suites/git; scratch
harnesses under `cache/r16/<name>/` (untracked). Conflict clause: source wins, name the conflict.

## 2. Shared spec deltas (verbatim for B/C/D)

- kind vocabulary gains **`bundle`**; counts gains **`bundles`** (number; additive).
- The canonical zip fixture (parent-built, python zipfile, deterministic): `cache/r16/zip/rig-pack.zip`
  (1899 B) — entries: `kick.wav` (400f 8k 16-bit WAV, STORED), `sub/snare.wav` (300f, DEFLATED),
  `notes.txt` (unknown format), `sub/` (directory entry). Non-dir entries 3.
- Pinned reason strings (fallbacks verbatim; em dashes as `\u2014` escapes in source):
  - absent reader (unchanged R15b line): `zip — unzip and drop the folder (zip import lands later)`
  - unreadable: `zip — unreadable (` + detail + `)` (detail cap 80)
  - nothing usable: `zip — no importable entries`
  - nested/cap refusal: `zip — nested archives are not expanded (v1)` · beyond-cap note via ctx.notes

## 3. Route-by-format + load law

- wav LOAD gains an f64 branch (§4.3). rex2 LOAD gains the slice stash (§4.3). Nothing else moves.

## 4. Module pins

### 4.1 `src/av_zip.js` (child A)

Top-level: `AV_ZIP_VERSION` ("r16.0") · `AVZIP` (const):
- `AVZIP.probe(u8OrArrayBuffer)` -> sync `{ ok, entries, error? }` — EOCD scan from the end (comment
  up to 64 KiB back), central-directory walk; entries = NON-directory count.
- `AVZIP.list(u8OrArrayBuffer)` -> sync `{ ok, entries: [{ name, dir, size, compressedSize, method,
  encrypted }], error? }` — sizes/methods from the central directory; `dir` = name ends with "/";
  order = central-directory order.
- `AVZIP.extract(u8OrArrayBuffer, index)` -> Promise `{ ok, name, bytes: Uint8Array, warnings,
  error? }` — STORED (0) verbatim; DEFLATE (8) via `DecompressionStream("deflate-raw")` (guarded;
  absent -> honest error); CRC32 computed and compared -> mismatch = warning "crc32 mismatch", data
  still returned. Refusals (honest error lines): `"zip64 not supported"` (0xFFFFFFFF sizes / zip64
  EOCD), `"encrypted entry"` (flag bit 0), `"method <n> not supported"`, size > 96 MiB
  `"entry too large"`. Local-header offsets honored; data descriptors irrelevant (central dir
  carries sizes). Never throws; junk -> ok:false + short error.
- Harness: build variants with node `zlib` + hand-written central directories (stored-only,
  deflate-only, mixed, truncated EOCD, bad CRC, method 12, encrypted flag, zip64 marker, directory
  entries) + parse the canonical fixture; assert the exact list/extract values. FIXTURE CARD not
  needed (the canonical fixture is parent-built); report harness numbers + any extra recipe.

### 4.2 `src/av_wavio.js` (child D) — f64 read

- `avWavInfo`: accept IEEE-float (tag 3) at **64** bits — `{ float: true, bits: 64 }`; keep
  refusing other float depths. Byte layout untouched otherwise.
- NEW `avWavDecodeF64(u8OrArrayBuffer)` -> `{ ok, channels, sampleRate, frames, bits: 64,
  float: true, ch1: Float32Array, ch2: Float32Array|null, warnings, error? }` — chunk walk to
  `data` (reuse the module's own helpers), LE doubles -> planar Float32 (non-finite -> 0);
  mono -> ch1 only. Never throws.
- Harness: encode tiny f64 WAVs with node (hand-built header + `writeDoubleLE`), decode, assert
  sample values bit-close (round-trip vs the written doubles; tolerance 1e-7), mono/stereo, odd
  chunk order, truncation honesty. Keep the existing encode/info behavior byte-identical
  (`node --check` + a spot re-run of an existing smoke expectation is the witness).

### 4.3 `src/av_chop.js` + `src/av_lib.js` (child C)

- `av_lib.js`:
  - `avLibLoadCleanRoom(rec, "rex2")`: after a successful decode, stash the slice table on the new
    session entry — `entry.rexSlices = slices` (array of `{ start, len }`, numbers; cap 64 with a
    warning; set on the object from `store.makeEntry` BEFORE `store.add`, and re-check
    `store.byId[entryId]` after add and set there if the store cloned). Receipt gains additive
    `slices: <count>` for rex2.
  - wav LOAD route: in `avLibLoadSample`, `wav` now probes `avWavInfo(rec.bytes)` first — when
    `ok && float && bits === 64`: if `typeof avWavDecodeF64 === "function"` -> decode and build the
    page-side AudioBuffer through the SAME clean-room path (a shared/duplicated helper,
    `avLibLoadWavF64(rec)`, cap-guarded like aiff/rex2, entryId from the store); else
    `{ ok:false, error:"f64 wav decoder pending (this build)" }`. mp3 + non-f64 wav stay native.
- `av_chop.js`: `avChopDetect(id, opts)` gains the rex2 branch — after `avChopEntry(id)`, when the
  entry carries a non-empty `rexSlices` array: synthesize the SAME result shape the transient path
  yields (mirror `avChopDetectFrames`' success shape from live source — at minimum `ok:true`,
  `slices:[{s0,s1}]` from `{start,len}` clamped to the entry's frames, `count`, `rate`, `frames`),
  add a marker `via: "rex2"` (the transient path gets `via: "onsets"` — additive field), update
  `avChopState.lastDetect` as the normal path does. Malformed entries -> fall through to the
  transient path. The kit builder/zones/apply are UNTOUCHED (they consume the same shape).
- Harness: node probe — stash slices on a fake entry, call detect, diff against the transient-path
  shape keys; assert kit/zones/apply numbers with a stub engine.

### 4.4 `src/av_import.js` + `src/av_import_ui.js` (child B)

- `av_import.js`:
  - Policy: `zip` row becomes `{ kind:"bundle", result:"imported", reason:"", persist:false }`
    (the R15b fallback line survives as the absent-reader deferral); guard `avImportHasZip()`.
  - **Expansion pre-pass** in `avImportRun` (before the per-file loop): for each input whose head64
    sniffs `zip` AND `avImportHasZip()` AND size <= AV_IMPORT_ITEM_MAX: read full bytes ->
    `AVZIP.list` -> for each non-dir entry (budget = AV_IMPORT_MAX_FILES minus current count;
    beyond -> skipped + ctx note; per-entry size cap; extract error -> skipped + ctx note): extract
    (`await AVZIP.extract`) -> `new File([bytes], leaf)` fed as a synthesized child item right after
    its zip in the run list. Depth guard `ctx.zipDepth` = 1: a zip ENTRY that itself sniffs zip is
    NOT expanded — lands deferred with `zip — nested archives are not expanded (v1)` + a note.
    All failures of the pre-pass degrade to the zip item being processed normally by the old path
    (absent-reader line or unreadable).
  - The zip item itself is CONSTRUCTED in the pre-pass (not via avImportOne): key/name/path/ext as
    usual, format "zip", kind "bundle", result "imported", reason "", persist false, meta
    `{ entries, expanded, skipped }`. Child items: key `"z" + n` per zip (n = 1..), name = entry
    leaf, path = zip item leaf + "/" + entry name (cap 200), sibling logic runs over the final
    items as usual. Zero importable entries -> the zip item defers with `zip — no importable
    entries`.
  - counts: `bundles` incremented for kind bundle && result imported (extend `avImportNewCounts`
    + `avImportCounts`). Existing counts/semantics otherwise unchanged.
- `av_import_ui.js`: counts line gains `· N bundles` when > 0 (after the refs branch, same style);
  report/lib rows unchanged (bundle rows render through the generic path). Mark the edit R16.

## 5. Parent edits (counted-assert `cache/r1/int_r16.py`; --anchors DRY; all-or-nothing)

1. `build.py` — js_parts: insert `av_zip.js` after the `av_ni.js` entry.
2. `verify/cdp_smoke.mjs` — 3 checks (**69 -> 72**), inserted after the 6cq block, BEFORE the 6cd
   R12 block:
   - `6cr` zip: the canonical fixture (base64-embedded) -> `avImportFiles` -> bundle row (kind
     "bundle", result imported, meta.entries 3, expanded 3); children: kick.wav sample imported,
     sub/snare.wav sample imported (path "rig-pack.zip/sub/snare.wav"), notes.txt refused
     (unrecognized); counts {total 4, imported 3, refused 1, samples 2, bundles 1}; errors empty.
   - `6cs` f64-WAV: build a 2ch/8kHz/200-frame f64 wav in-page (tag 3, bits 64) -> imported, meta
     bits 64 -> `avLibLoad` -> session entry frames 200 @ 8000 Hz (the clean-room route witness).
   - `6ct` REX2->chop: on that entry set `rexSlices` [{0,50},{50,50},{100,100}] ->
     `avChopDetect` -> `via === "rex2"`, count 3, slices[2] s0/s1 100/200 -> `avChopKitNew` ->
     ok, 3 slices -> `avChopApply` -> ok, slot 0.
3. `verify/cdp_import.mjs` — 3 checks (**21 -> 24**) + fixtures staged in `cache/r16/rig-fixtures/`:
   - (a) real-file zip: stage `rig-pack.zip` -> file-input -> rows 4, counts bundles 1, samples 2,
     refused 1; library lists the two samples; one child path carries "rig-pack.zip/". LOAD the
     kick.wav child -> session entry (frames 400 @ 8000).
   - (b) f64 wav (node-built Buffer) -> import -> LOAD -> entry frames/rate asserted (clean-room).
   - (c) REX2->chop on the REAL rx2: find the session entry whose name includes "loop.rx2" (from
     the existing check-12 fixture) -> `entry.rexSlices` length 10 -> `avChopDetect` via "rex2",
     count 10 -> kit 10 -> apply ok.
   Keep the existing 21 intact; header comment updated.
4. Pins sweep (`cache/r1/sweep_r16.py` from sweep_r15d.py): OLD = FULL `50d6d793...` -> new;
   21 files, exactly-1 anchor each.
5. docs/11 open-items edit at close (zip/REX2/f64 lines go; embeddedWTData + MXGPR/KONG stay).

## 6. Gates + evidence

build -> smoke **72** first-run -> pins sweep (21) -> battery **24 suites** + bench (worklet sha
`b65160e0` UNCHANGED) -> records commit -> deploy index.html + sw.js (copy into
radio-browser/deploy/anvil/ FIRST) -> scoped --verify = 0 -> leak probe + capture
`renders/r16-live-import.png` -> addendum 54 + docs/11 edit -> close commit.

Watch-outs: R15b/R15c/R15d laws (FileList snapshot; decodeAudioData resample; report view has no
meta — read avLibList; ASCII anchors; full-64-hex sweep; battery-set diff; hidden spawns; one
writer per file; explicit-path commits). `DecompressionStream("deflate-raw")` is native in this
Chromium (verify in harness); zip fixtures are parent-built and byte-frozen. The zip pre-pass must
never break the honest-receipt contract (a corrupt zip = a deferred row, never a throw).

## 7. Report shapes (children, prose)

A: file path · top-level names · node --check · harness numbers (variants + fixture parse) · open
items. B: two paths · changed/new names · the pre-pass design as implemented · DOM notes · open
items. C: two paths · changed/new names · the stash/detect/route diffs · harness numbers · open
items. D: file path · new/changed names · harness numbers (round-trip tolerance) · open items.
