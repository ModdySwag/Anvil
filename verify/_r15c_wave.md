# R15c wave — STRUCTURED PACKS: EXS24 · ADG/ALS · SerumPreset adapters (contract)

State at open: R15b shipped + live (`cb1128e2`, 3,716,625 B; sw `b4a0109e`). Smoke **63** · pins
**21** · battery **24 suites** · worklet sha `b65160e0` (page-side wave again — the worklet does
NOT change; it must still read `b65160e0` after the rebuild).

SCOPE SPLIT (recorded; docs/11's wave list gets edited at close): **R15c = the extraction trio
with immediate user value** — EXS24 (Logic kits → sampler kits), ADG/ALS (Ableton → refs +
clip-to-pattern), SerumPreset (→ wavetable refs + meta; the 30-min embed spike runs inside this
wave). **SXT / NKI / NBKT move to R15d** (refs/metadata readings; the same pipeline). All three
R15c adapters register into the R15b pipeline (`AV_IMPORT_POLICY` + the route-by-format load
law); sources: `research/import/03-serum-exs-native.md` (EXS + Serum, verified) and
`research/import/01-ableton-mystery.md` (ADG/ALS, verified first-hand).

## 1. Deliverable + file ownership

- CHILD A: `src/av_exs.js` — SOLE writer. Clean-room EXS24 binary reader (§4.1).
- CHILD B: `src/av_als.js` — SOLE writer. ADG/ALS gzip-XML extractor + clip-to-pattern (§4.2).
- CHILD C: `src/av_serum.js` — SOLE writer. SerumPreset container reader + the embed spike (§4.3).
- CHILD D: `src/av_import.js` + `src/av_import_ui.js` + `src/av_lib.js` — SOLE writer of each
  (the wiring: policy entries, kit/refs flows, UI actions, library load routes) (§4.4).
- PARENT: `build.py` (3 new parts) · `verify/cdp_smoke.mjs` (+3) · `verify/cdp_import.mjs` (+3)
  · pins sweep · docs/11 wave-line edit (at close) · commit/deploy. NO other files.

Child laws (unchanged from R15b): one complete file FIRST then iterate; `"use strict"`;
ASCII-only source; DOM-free top level; never throws; unique top-level names; block comments must
not contain the close sequence; `node --check` on your own file only; NO build/browsers/suites/
git; children A/B/C may keep scratch unit harnesses under `cache/r15c/<name>/` (untracked;
fixtures for verification only — for C, a REAL preset from
`C:/Users/Moddy/Documents/Xfer/Serum 2 Presets/Presets` may be read in the harness, never
shipped). Child D gets node --check only.

## 2. Shared spec deltas (the R15b bundle, extended — VERBATIM for D + the UI)

- item.kind vocabulary gains `"kit"` (EXS24) and `"refs"` (ALS/Serum): kinds are now
  `sample | pattern | kit | refs | refused`.
- counts gains `kits` and `refs` (numbers; additive — the R15b check fields stay valid).
- meta per new kind (JSON-safe — persisted + rendered):
  - kit: `{ zones: [zone...], samples: [{ ref, name }], skipped: number }` where zone =
    `{ lo, hi, root, buf, vol, s0, s1, fIn, fOut, velLow, velHigh, file }` (buf = the sample
    ref's index into `samples`; fIn/fOut = 0 — EXS has no per-zone fades); `file` = the zone's
    sample fileName (basename fallback of the path). Cap **16 zones** (the sampler v2 table);
    zones beyond it are counted in `skipped` with a warning. `vol` = the chop law
    `10^(dB/20) * 0.8` clamped 0..24 dB (reuse the av_chop constant law).
  - refs (als): `{ refs: [{name, path}], refCount, noteCount, tempoBpm, pattern }` — `pattern`
    is the SAME shape avMidToPattern emits (v/name/bpm/grid/swing/tracks/plocks/rng), capped at
    4 tracks x 64 steps by construction (cap the extracted notes at **512** first, first-N wins,
    warn while counting); refs capped at **512** (warn beyond).
  - refs (serum): `{ wtRefs: [{module, path}], presetName, product, version, kind: "serum2" }`
    — capped at 256.
- result for the new formats: `"imported"` when the reader exists and the parse succeeded;
  `"deferred"` when the reader module is absent OR the parse failed (honest reason, prefix
  pinned below); `"refused"` never for these three (always a parse-side deferral).
- Pinned reason strings (verbatim; em dashes as escapes in source):
  - `.exs — reader pending (this build)` · als/adg: `Ableton project — reader pending (this build)` ·
    `.SerumPreset — reader pending (this build)`
  - parse failures: `.exs — unreadable (` + detail + `)` · `Ableton project — unreadable (` +
    detail + `)` · `.SerumPreset — unreadable (` + detail + `)` (detail capped 80 chars).
- sibling rule unchanged (fills item.sibling from same-stem audio siblings).

## 3. Route-by-format LOAD law (av_lib, extended — VERBATIM)

- kind `kit`: resolve each `meta.samples[].name` (basename, case-insensitive) against the
  LIBRARY list at LOAD time (never by import order) -> for the first **4 distinct** resolved
  samples (the engine slot cap): load each via the existing sample routes (wav/mp3 ->
  File -> avSampleImportFiles; aiff/rex2 -> clean-room decode) -> `avSampleSendToEngine(entryId,
  slot i)`. Then build the zone v2 F64(144) table (16 zones x 9 floats
  [lo,hi,root,buf,vol,s0,s1,fIn,fOut] — buf = the resolved sample's slot; s0/s1 clamped to the
  decoded length; missing fades 0) and `avEngineZones(zones)` (typeof-guarded); set the engine
  kind to sampler through the ONE funnel when available (`avApplyParam("engine.kind",
  "sampler")`). Zones whose sample did not resolve (or beyond the 4-slot cap) are dropped and
  counted. Receipt `{ ok, slots, zones, skipped, error? }`.
- kind `refs`: LOAD = re-return the persisted meta (no session change) — receipt
  `{ ok: true, refs, notes?, pattern?, meta }` so the UI can offer the seq action for ALS items.
- kind `pattern` (mid AND als): the EXISTING avMid pattern flow is the ONE seq path —
  for ALS items the pattern comes from `meta.pattern`: `avSeqLoad(pattern)` -> `avSeqSnap()` ->
  `avSeqSetPattern(norm)` -> `avSeqUiSync()` -> `avUndoPush("seq","import")` (all guarded).
- kind `kit` must NEVER touch the engine when fewer than 1 sample resolves: receipt
  `{ ok:false, error:"no resolvable samples" }`.

## 4. Module pins

### 4.1 `src/av_exs.js` (child A)

Top-level: `AV_EXS_VERSION` ("r15c.0") · `AVEXS` (const) with:
- `AVEXS.probe(u8OrArrayBuffer)` -> `{ ok, zones, groups, samples, reversed, note, error? }` —
  block-count walk only (84-byte headers; detect `TBOS` at chunk offset 16, `SOBT`/byte-swapped
  = big-endian file -> `reversed: true`; big-endian full parse may refuse honestly:
  `error:"big-endian EXS not supported"` after probe).
- `AVEXS.parse(u8OrArrayBuffer)` -> `{ ok, name, zones: [...], groups: [{index, ...}],
  samples: [{ length, rate, bits, channels, type, filePath, fileName }], warnings, error? }`.
  Zone fields per research 03 §2.2 (offsets from data start): flags(bit0 oneshot, bit2 reverse,
  bit1 pitch-track-off), key(root), fineTuning i8, pan i8, volumeAdjust i8 dB, keyLow/keyHigh,
  velocityLow/High, sampleStart/sampleEnd u32, loopStart/loopEnd, loopCrossfade, loopOptions,
  loopDirection, coarseTuning i8, output, groupIndex i32, sampleIndex u32. Content sizes:
  zone 148 B, group 144 B, sample 600 B, instrument 88 B. sample.filePath @80 (256 B) and
  fileName @336 (256 B), NUL-trimmed. Guards: unknown block signatures -> warning + skip;
  truncated blocks -> warning + stop (never throw); zone.sampleIndex out of range -> warning.
  Clean-room from the public spec + the ISC/MIT references listed in research 03 §2.4 (direct
  porting with attribution is permitted by licence — keep the shipped file self-authored ASCII).

### 4.2 `src/av_als.js` (child B)

Top-level: `AV_ALS_VERSION` ("r15c.0") · `avAlsProbe(u8)` (sync: gzip magic + `Ableton` root
sniff far bytes? v1: gzip magic only -> `{ ok, kind: "gzip", error? }`) ·
`avAlsExtract(arrayBuffer)` -> Promise `{ ok, kind, creator, refs, notes, tempoBpm, warnings,
error? }` — `DecompressionStream('gzip')` (native; refuse honestly when absent); INCREMENTAL
regex/scan over the decompressed text (NEVER DOM-parse — fixtures reach 10 MB XML): audio
refs via `<RelativePath Value="...">`, `<Path Value="...">` and `<Name Value="...">` inside
FileRef blocks (both Live <=10 RelativePathElement chains and Live 11/12 Value forms), filter
to audio extensions (.wav/.wave/.aif/.aiff/.aifc/.mp3/.flac/.ogg), normalize `../` segments,
dedupe by basename (case-insensitive, first wins); notes via `<MidiNoteEvent .../>` attributes
Time/Duration/Velocity (ticks; also accept `<MidiKey Value>` context when cheap); tempo via
`<Tempo>` and `<TimeSignature>`. Decompressed-size guard `AV_ALS_MAX_XML = 64 MiB` (stop +
warning "XML truncated at 64 MB — refs may be incomplete"). No Ableton needed; no network.
· `avAlsToPattern(extracted, opts)` -> `{ ok, pattern, warnings }` — map notes to the SAME
pattern shape avMidToPattern emits (v/name/bpm/grid:"16"/swing:50/tracks(4,64 steps)/plocks[]/
rng), quantizing ticks->seconds by tempoBpm (default 120) -> 16th grid, first-hit-wins, gate =
dur/step clamped, vel = velocity/127; `name` from opts.name (cap 24). Pure + sync.

### 4.3 `src/av_serum.js` (child C)

Top-level: `AV_SERUM_VERSION` ("r15c.0") · `AVSerum` (const):
- `AVSerum.probe(u8OrArrayBuffer)` -> `{ ok, kind: "serum2"|"fxp"|"", name, error? }` — sync:
  `XferJson\0` header (9 bytes) + uint64 LE json-len + JSON parse -> meta (presetName etc.);
  `.fxp`: `CcnK` + BE size + `FPCh` + `XfsX` sniff.
- `AVSerum.extract(arrayBuffer)` -> Promise -> for serum2: `{ ok, meta, wtRefs, warnings,
  error? }` — after the JSON block: uint32 LE cborSize + uint32 LE encoding (2 = zstd) + zstd
  frame -> decompress via `DecompressionStream("zstd")` (VERIFY availability in the scratch
  harness first; absent -> `{ ok:false, error:"zstd decompress unavailable in this browser" }`)
  -> minimal clean-room CBOR reader (maps/arrays/text/int/float/bool/null; ~150 LOC; a key
  must never be re-encoded by us) -> walk top-level keys matching `WTOsc[0-9]+` for
  `.relativePathToWT` (string) -> wtRefs `[{module, path}]`; also collect presetName/product/
  version (from the JSON meta) and moduleCount. Embedded-table case: any WTOsc field that is
  not the known key set -> warning `"embedded wavetable present — extraction spike pending"`;
  never guess. for fxp: container + `DecompressionStream("deflate")` -> wavetable NAMES at
  offsets 0x3C08/0x3E08 (two 512-byte NUL-terminated strings per research 03 §1.2 — guard the
  decompressed length before reading) -> wtRefs `[{module:"fxp", path:name}]`.
- The 30-min SPIKE (child C records results in its report): (1) native
  `CompressionStream/DecompressionStream("zstd")` availability in this Chromium (the scratch
  harness answers it); (2) the embed case — no embed fixtures exist on this machine, so the
  reader ships the opaque-field warning path and the spike records that the empirical check
  needs a Serum-saved embed fixture later. The PNG-strip premise is dead (research 03 §1.3 —
  0 PNG signatures in 629 presets): do NOT write PNG code.

### 4.4 `src/av_import.js` + `src/av_import_ui.js` + `src/av_lib.js` (child D — wiring)

- `av_import.js`: add an adapter dispatch layer (per-format, typeof-guarded PER CALL):
  - exs: `AVEXS.parse(bytes)` at import (ms-class) -> build the kit meta (§2: zones from
    EXS zones -> table fields; `root` = key + coarseTuning folded; `buf` = ref index; s0/s1
    from sampleStart/End; honor oneshot/reverse as warnings only — v1 flattens), sample refs
    from the zone's sampleIndex -> samples[] `{ref: i, name: fileName}`; sibling matching at
    the SET level fills item.sibling as usual. `AVEXS` absent -> deferred pending; parse fail
    -> deferred unreadable.
  - als/adg: `await avAlsExtract(bytes)` -> build refs meta + `avAlsToPattern` result in
    meta.pattern (name = file leaf); absent/failed -> deferred per §2.
  - serum: `await AVSerum.extract(bytes)` -> refs meta; absent (or zstd unavailable) ->
    deferred per §2.
  - The existing policy entries for exs/adg/als/serum change result-path: keep the R15b
    pinned strings as the FALLBACKS; the new success path is `imported` with kind kit/refs.
  - counts: add kits/refs.
- `av_lib.js`: route-by-format LOAD per §3 (kit + refs kinds; als patterns ride the mid flow);
  `avLibLoad("kit")` resolves sample NAMES against the library at load time; persist records
  unchanged otherwise (meta carries the new shapes).
- `av_import_ui.js`: library rows render the new kinds: kit -> meta line "kit · N zones · M
  samples" + a `KIT` action (`data-av-import-act="kit"` -> avLibLoad(id) with status
  "kit loaded — N slots · M zones" or the honest refusal); als refs items show the `SEQ`
  action only when meta.pattern exists (same click path as mid); serum refs -> no action
  (meta line "refs · N tables"); report rows already render result+reason (no change needed);
  counts line gains "· N kits · M refs" when > 0. All cross-module calls typeof-guarded per
  call; never throws.

## 5. Parent edits (counted-assert `cache/r1/int_r15c.py`; --anchors DRY mode; all-or-nothing)

1. `build.py` — js_parts: insert `av_exs.js`, `av_als.js`, `av_serum.js` after the
   `av_import_ui.js` entry (the R15b block), in that order.
2. `verify/cdp_smoke.mjs` — 3 checks (**63 -> 66**), inserted BEFORE the `/* 6cd. R12: the
   proof gate` block:
   - `6cl` EXS kit end-to-end: synthesize a minimal little-endian .exs in-page (bytes built by
     the check: instrument/zone/sample blocks, one zone keyLow 36 / keyHigh 51 / sampleIndex 0 /
     sampleStart 0 / sampleEnd 100) + a same-folder WAV named exactly as the zone's fileName ->
     `await avImportFiles([exsFile, wavFile])` -> the exs item: kind "kit", result "imported",
     meta.zones length 1, meta.samples[0].name matches -> then `avLibLoad(kitItem.id)` ->
     receipt ok, zones 1, slots 1; `avEngineZones` called (facade witness); engine kind
     sampler accepted (`avApplyParam` funnel).
   - `6cm` ALS clip-to-pattern: synthesize a gzip .als in-page (CompressionStream('gzip') over
     a minimal `<Ableton>...<LiveSet><Tempo><Manual Value="128"/> ... <MidiNoteEvent
     Time="0" Duration="120" Velocity="100"/> ... <RelativePath Value="../Samples/Kick.aif"/>
     </Ableton>` doc) -> import -> item kind "refs", result "imported", meta.refCount 1,
     meta.noteCount 1, meta.pattern present -> `avLibLoad(id)` -> then the seq path: load the
     pattern + undo label "import" + `avSeqSnap()` notes >= 1.
   - `6cn` Serum: build the serum2 container in-page when `CompressionStream("zstd")` exists
     (XferJson header + JSON {fileType:"SerumPreset", presetName:"RIG"} + zstd(CBOR bytes with
     one WTOsc0.relativePathToWT)) -> import -> item kind "refs", meta.wtRefs[0].path matches;
     when zstd is unavailable assert the honest deferred path instead (reason starts
     ".SerumPreset"). The check picks the strongest reachable branch and reports it.
3. `verify/cdp_import.mjs` — +3 checks (**15 -> 18**) + fixtures in cache/r15c/rig-fixtures/
   (a synthetic .exs + its sibling WAV, a synthetic gzip .als, and ONE REAL `.SerumPreset`
   copied from the local corpus for verification only): (a) real-file kit import -> KIT load ->
   zones/slot witness; (b) als -> SEQ wire; (c) real SerumPreset -> refs meta exact (probe
   name + wtRefs count read from the file's own JSON block). Keep the existing 15 intact.
4. Pins sweep (`cache/r1/sweep_r15c.py` from sweep_r15b.py): OLD `cb1128e2...` -> new (20
   files) + cdp_import re-pin (its EXPECT_SHA) — EXPECT_FILES stays 20, cdp_import pinned
   separately as in R15b.
5. docs/11 — wave-list edit at close (R15c = the trio; SXT/NKI/NBKT -> R15d).

## 6. Gates + evidence

Standard order (unchanged): build -> smoke **66** first-run -> pins sweep -> battery **24
suites** (cdp_import updated, not added) + bench (worklet sha `b65160e0` must be UNCHANGED) ->
records commit -> deploy `index.html` + `sw.js` -> scoped `--verify` = 0 -> live pass (leak
probe `https://moddys.net/anvil/` — DIRECTORY url; live capture `renders/r15c-live-import.png`
inspected) -> addendum 52 final + docs/11 edit.

Watch-outs: the R15b laws all still apply (file-input FileList snapshot; decodeAudioData
resample; report view carries no meta — read `avLibList`; ASCII-only anchors; full-64-hex pin
sweep; battery-set completeness diff). The `.exs` synthetic bytes in the smoke check are the
CONTROLLED fixture — build them to the pinned layout exactly (the child-A harness numbers are
the template). `DecompressionStream` in the smoke harness: gzip is universally present; zstd is
probed at check time.

## 7. Report shapes (children, prose)

A/B/C: file path · exact new top-level names · node --check result · harness numbers (fixtures,
parse anchors) · spike results (C) · open items.
D: the three file paths · exact new/changed top-level names · the policy edits applied · DOM
changes (data-act names) · node --check results · open items.
