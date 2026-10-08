# R15d wave — the NI/Reason trio: SXT REFE refs · NKI partial · NBKT metadata (contract)

State at open: R15c shipped + live (`b1da601b`, 3,815,323 B; sw `94a77feb`). Smoke **66** · pins
**21 files carry the full sha** (20-sweep + cdp_import; sweep asserts 21) · battery **24 suites** ·
worklet sha `b65160e0` (page-side wave again — the worklet does NOT change; it must still read
`b65160e0` after the rebuild).

**KNOWN LIVE BUG, opened with this wave:** `avImportRun` builds `ctx` WITHOUT the notes array, yet
`if (ctx.notes.length)` runs on every call — so EVERY import (clean ones included) throws there,
gets caught by `avImportFiles`, and appends `"import run failed"` to `receipt.errors`; the card's
status line prints it (`imported N … · import run failed`). Reproduced in node this session against
current source. Child C fixes it (section 4.3); the new smoke checks witness `errors` empty.

SCOPE: the R15c pipeline carries three new readers (new adapters register in `AV_IMPORT_POLICY`):
- **SXT** (Reason NN-XT patch, `.sxt`/`.sx2`): recognize + `REFE` sample-reference extraction → refs.
- **NKI**: legacy (Kontakt 1 … 4.2.1 — zlib-compressed XML; zones + sample refs) → kit when zones
  are extractable; modern (4.2.2+ / K5+ — `hsin`/`DSIN` container: metadata + sample refs) → refs;
  encrypted container → honest refusal.
- **NBKT** (Battery 4 kit, same modern container): metadata (kit name, authoring app/version) +
  refs when the walk finds them → refs.
No `av_lib.js` change: the existing kit/refs load routes (verified this session against
`src/av_lib.js` 1112-1226) already cover the new metas. Counts vocabulary unchanged.

Sources + licences: `research/import/01-ableton-mystery.md` §1.1 (SXT) · `research/import/02-ni-rex2.md`
§1.2-1.6 (NI eras, container chunk types, NBKT) · scratch recon `cache/r15d/sxt/recon-SO-9218208.md`
(REFE field list + real-file byte fragment) · **CWM read-only reference files** under
`cache/r15d/cwm/refs/` (ConvertWithMoss is LGPL-3.0: READ for understanding only, NO code copying;
`SxtCreator` is its sxt WRITER and shows the exact chunk framing it emits) · **REAL modern-container
witness** `cache/r15d/cwm/Kontakt680Template.nki` (6,342 B, written by CWM — harness must parse it) ·
nkitool (linuxsampler.org/nkitool, **public domain**, one C file — may be consulted/reused with
attribution; keep the shipped files self-authored). Shipped files stay self-authored ASCII.

## 1. Deliverable + file ownership

- CHILD A: `src/av_sxt.js` — SOLE writer. Clean-room NN-XT reader (§4.1).
- CHILD B: `src/av_ni.js` — SOLE writer. NKI legacy + container + NBKT reader (§4.2).
- CHILD C: `src/av_import.js` + `src/av_import_ui.js` — SOLE writer of each (§4.3/§4.4).
- PARENT: `build.py` (2 new parts) · `verify/cdp_smoke.mjs` (+3) · `verify/cdp_import.mjs` (+3)
  · pins sweep · docs/11 wave-line edit (at close) · commit/deploy. NO other files.

Child laws (unchanged from R15b/R15c): ONE file each (C: two); complete file to disk FIRST, then
iterate (partial progress must exist on disk at all times); `"use strict"`; ASCII-only source;
DOM-free top level; never throws; unique top-level names; block-comment prose must not contain the
close sequence; `node --check` on your own file(s) only; NO build, NO browsers, NO verify suites,
NO git. A/B may keep scratch node harnesses under `cache/r15d/<name>/` (untracked; fixtures for
verification only — nothing from them ships). Child C gets `node --check` only.
**Conflict clause:** if a pinned name or shape conflicts with live source, the SOURCE wins — name
the conflict in the report, never silently diverge.

## 2. Shared spec deltas (verbatim for child C)

- kinds unchanged: `sample | pattern | kit | refs | refused`. counts unchanged (kits/refs exist).
- **nki legacy kit meta**: the SAME shape as the EXS kit meta — zones + samples + skipped, zones
  rows lo/hi/root/buf/vol/s0/s1/fIn/fOut/velLow/velHigh/file, built by the SHARED builder
  `avImportKitMetaFrom` (§4.3). `root` folds coarseTuning; `vol` = the chop law; 16-zone cap with
  `skipped` + notes (the existing EXS behavior).
- **refs meta (nki container / nki legacy fallback / nbkt / sxt)**: refs rows (name + path),
  refCount, presetName, product, version, kind — extras per reader available; refs capped at
  **512** (`AV_IMPORT_NI_REF_CAP`, `AV_IMPORT_SXT_REF_CAP`); beyond-cap counted into a ctx note.
  meta.kind values: `nki-container` · `nki-legacy` · `nbkt` · `sxt`.
- Pinned reason strings (verbatim; em dashes as `\u2014` escapes in source):
  - pending (reader absent): `.nki — reader pending (this build)` · `.nbkt — reader pending (this build)` · `.sxt — reader pending (this build)`
  - parse failure: `.nki — unreadable (` + detail + `)` · `.nbkt — unreadable (` + detail + `)` · `.sxt — unreadable (` + detail + `)` (detail capped 80)
  - encrypted: `.nki — encrypted (locked library); import the pack's Samples folder` · `.nbkt — encrypted (locked library); import the pack's Samples folder` (result **refused**)
- Policy table edits (the R15b V2 rows are replaced; the old "partial extraction planned (V2)" /
  "reference extraction planned (V2)" strings go away — no suite asserts them):
  - nki: result `imported`, persist true, kind `refs` (dispatch upgrades to `kit` for legacy zones)
  - nbkt: result `imported`, persist true, kind `refs`
  - sxt: result `imported`, persist true, kind `refs`

## 3. Route-by-format (av_lib) — NO changes

The kit route resolves `meta.samples[].name` against the library at LOAD time (works for NKI legacy
kits untouched); the refs route re-returns the persisted meta (works for the new refs kinds). Kind
`kit` + fewer than 1 resolvable sample -> `ok:false "no resolvable samples"` unchanged.

## 4. Module pins

### 4.1 `src/av_sxt.js` (child A)

Top-level: `AV_SXT_VERSION` ("r15d.0") · `AVSXT` (const) with:
- `AVSXT.probe(u8OrArrayBuffer)` -> sync `{ ok, refs, version, error? }` — cheap chunk walk; refs =
  the REFE chunk count; version = "M.m.r" from the 5-byte tag (`0xBC major minor rev 0x00`) when
  found, else "".
- `AVSXT.extract(u8OrArrayBuffer)` -> sync `{ ok, name, version, refs: [{name, path}], refCount,
  warnings, error? }` — per-REFE: sample name + relative path (fall back to absolute/database path
  forms when relative is empty); dedupe case-insensitive by name (first wins); internal sanity cap
  1024 (warn when hit). name = the patch name when the container carries one; "" otherwise — never
  guess. Never throws; unrecognized/truncated bytes -> ok:false + a short honest error.
- Format facts: chunked IFF-family container, u32-BE length-prefixed strings; REFE field order per
  `cache/r15d/sxt/recon-SO-9218208.md` (size, version, relative/database/absolute path structs,
  sample name, ReFill name, ReFill URL, reserved, package name; version >= 1.3.0 adds 4 more
  values). Pin the exact framing against the CWM sxt references (SxtCreator = the writer).
- Fixture card REQUIRED in the report (§8): an offset-by-offset byte recipe for a minimal 2-REFE
  .sxt + expected extract values — the parent ports it into the smoke (in-page JS) and the rig.

### 4.2 `src/av_ni.js` (child B)

Top-level: `AV_NI_VERSION` ("r15d.0") · `AVNI` (const) with:
- `AVNI.probe(u8OrArrayBuffer, hint)` -> sync `{ ok, kind: "legacy" | "container" | "", encrypted,
  error? }` — hint = "nki" | "nbkt" | "" (caller's ext). Detection: `hsin` at 0x0C..0x0F ->
  container; else zlib signature (`0x78` + one of 01/5E/9C/DA) at 0xAA (K2-era) or 0x24 (K1/NiSS) ->
  legacy; else ok:false. encrypted for containers = the walk finds an ENCRYPTION_ITEM (chunk 116).
- `AVNI.parse(u8OrArrayBuffer, hint)` -> Promise -> receipt:
  - legacy: ok, kind "legacy", name, samples (rows ref/fileName/filePath/length/rate/bits),
    zones (rows keyLow/keyHigh/key/fineTuning/coarseTuning/volumeAdjust/sampleStart/sampleEnd/
    velocityLow/velocityHigh/flags/sampleIndex), refs (name/path rows), warnings, error.
    Inflate the zlib stream via `DecompressionStream("deflate")` (guarded second attempt
    `"deflate-raw"`; absent -> ok:false with an honest error). XML via incremental regex/scan
    (NEVER DOM-parse). Zone/sample tag names pinned from nkitool + the CWM K2/NiSS handlers; a
    shape the reader does not recognize -> ok:true with zones empty + a warning + refs populated
    (the wiring falls back to refs).
  - container (hint nki -> kind "container"; hint nbkt -> kind "nbkt"): ok, name (SOUNDINFO,
    UTF-16LE), product + version (AUTHORING_APPLICATION), refs (FILE_LIST / EXTERNAL_FILE_REFERENCE
    — decoded paths per the CWM references), refCount, encrypted false, warnings.
    **AMENDMENT (as-built, from the real witness):** "encrypted" is NOT the mere presence of chunk
    116 (the real CWM container carries a 116 whose payload is a FastLZ-compressed SUB_TREE that
    decodes fine and yields 61 refs). As built: encrypted = a 116 whose payload cannot be read
    (FastLZ fails / opaque payload with no decodable subtree frame); a decodable subtree extracts
    normally. Reason: the real-file evidence wins (child B named the conflict; the rig pins the
    real file's success path).
  - encrypted container -> ok:false, encrypted true, error "encrypted (locked library)".
  - Compressed SUB_TREE_ITEM frames that the reader does not descend -> an explicit warning; never
    guess. Truncated/absent pieces -> warnings, never throws.
- Real-file witness: parse `cache/r15d/cwm/Kontakt680Template.nki` in the harness; record the exact
  extracted values (name/product/version/refs) — those become the rig's pinned expectations.
- Bounded real-file sourcing: up to ~4 short fetch attempts of real legacy-NKI / NBKT fixtures into
  scratch (verification only; small free libraries); record reachability honestly; synthetic
  fixtures otherwise. Nothing fetched ships.
- Fixture card REQUIRED in the report (§8): offset-by-offset recipes + expected values for (a) a
  minimal legacy NKI (zlib stream at 0xAA; one zone + one sample + one key range) and (b) a minimal
  container fixture (nki AND nbkt variants + an encrypted variant) — ported by the parent.

### 4.3 `src/av_import.js` (child C)

- New constants: `avImportNkiPending`, `avImportNbktPending`, `avImportSxtPending`,
  `avImportNkiUnread`, `avImportNbktUnread`, `avImportSxtUnread`, `avImportNkiEncrypted`,
  `avImportNbktEncrypted` (verbatim strings from §2), `AV_IMPORT_NI_REF_CAP = 512`,
  `AV_IMPORT_SXT_REF_CAP = 512`.
- Guards: `avImportHasSxt()` (typeof AVSXT object + extract function), `avImportHasNi()` (typeof
  AVNI object + parse function) — both try/catch, per call.
- Refactor: `avImportKitMeta(bytes, item, ctx)` keeps its signature; its body moves to a new
  `avImportKitMetaFrom(parsed, item, ctx)` (SOURCE-AGNOSTIC builder over a parsed object with
  zones + samples arrays; identical error strings, caps, notes). The exs call site becomes
  parse-then-build: a small guarded `avImportExsParse(bytes)` returns the parsed object or null.
  EXS behavior must be bit-for-bit identical (smoke 6cl is the witness).
- Dispatch (after the serum branch, same style — typeof-guarded per call):
  - `nki`/`nbkt`: absent reader -> deferred pending. Else `await` the reader (hint = item.ext):
    legacy with zones -> `avImportKitMetaFrom` -> item.kind "kit"; builder "no usable zones" ->
    refs fallback; legacy without zones -> refs meta (kind "nki-legacy") + a note; container/nbkt ->
    refs meta (kind "nki-container"/"nbkt"); encrypted -> **refused** with the encrypted line;
    other failures -> deferred unreadable. Refs builders cap at the NI cap + note.
  - `sxt`: absent -> deferred pending; parse fail -> deferred unreadable; ok -> refs meta
    (kind "sxt", presetName/version) capped at the SXT cap + note.
- **The ctx fix**: `avImportRun`'s context becomes `{ at: receipt.at, writeFails: 0, notes: [] }`
  so the existing `ctx.notes` channel works and a clean run's `receipt.errors` stays EMPTY.
- Everything else (receipt/item shapes, counts, siblings, caps, FileList laws) unchanged.

### 4.4 `src/av_import_ui.js` (child C)

- ONE edit: the library row meta line — after the serum branch add a non-serum refs branch:
  `"refs \u00b7 " + counts.refs + " refs \u00b7 " + format` (applies to als/nki/nbkt/sxt rows;
  serum keeps "refs · N tables"; kit rows and all actions unchanged). Mark it with a comment
  naming R15d. No other DOM/class changes.

## 5. Parent edits (counted-assert `cache/r1/int_r15d.py`; --anchors DRY mode; all-or-nothing)

1. `build.py` — js_parts: insert `av_sxt.js`, `av_ni.js` after the `av_serum.js` entry.
2. `verify/cdp_smoke.mjs` — 3 checks (**66 -> 69**), inserted after the 6cn block, BEFORE the
   `/* 6cd. R12: the proof gate` block:
   - `6co` SXT refs: synthesize the child-A fixture in-page -> `avImportFiles` -> item format
     "sxt", kind "refs", result "imported", meta.refCount + names match; `rc.errors.length === 0`
     (the ctx-fix witness).
   - `6cp` NKI legacy kit: synthesize the child-B legacy fixture in-page (XML ->
     `CompressionStream("deflate")` -> assembled at the pinned offset) + a sibling WAV named as the
     zone's fileName -> import -> kit imported, zones 1, sample name matches -> `avLibLoad` ->
     receipt ok, slots 1, zones 1; engine kind sampler.
   - `6cq` containers: synthesize the child-B container fixtures in-page (nki + nbkt + encrypted
     variants) -> refs metas exact (presetName, refCount, meta.kind) and the encrypted one refused
     with the pinned reason prefix; errors clean.
3. `verify/cdp_import.mjs` — +3 checks (**18 -> 21**) + fixtures staged in
   `cache/r15d/rig-fixtures/`:
   - (a) legacy .nki (node `zlib.deflateSync` of the child-B XML) + sibling WAV -> import -> KIT
     action -> `avSampleStore.sent[0]` slot 0 + engine kind sampler (mirrors the exs check).
   - (b) the REAL `cache/r15d/cwm/Kontakt680Template.nki` (copied to fixtures) -> file-input
     import -> row imported + library meta EXACTLY the values child B's harness recorded.
   - (c) synthetic .sxt + synthetic .nbkt in one run -> sxt refs meta exact + nbkt metadata; DOM
     rows render the refs meta line.
   Keep the existing 18 intact; update the header comment block.
4. Pins sweep (`cache/r1/sweep_r15d.py` from sweep_r15c.py): OLD = the FULL `b1da601b...` literal
   -> new sha; **21 files**, exactly 1 old-sha anchor each; `--dry` mode; post-check.
5. docs/11 — wave-list + open-items edit at close (SXT/NKI/NBKT shipped; follow-ups stay recorded).

## 6. Gates + evidence

Standard order (unchanged): build -> smoke **69** first-run -> pins sweep (21) -> battery **24
suites** (cdp_import updated) + bench (worklet sha `b65160e0` must be UNCHANGED) -> records commit
-> deploy `index.html` + `sw.js` (`python3 upload-site.py --only anvil/index.html anvil/sw.js`)
-> scoped `--verify` = 0 -> live pass (leak probe `https://moddys.net/anvil/` — DIRECTORY url;
live capture `renders/r15d-live-import.png` inspected; the status line no longer carries the
bug string) -> addendum 53 final + docs/11 edit.

Watch-outs: the R15b/R15c laws all still apply (file-input FileList snapshot; decodeAudioData
resample; report view carries no meta — read `avLibList`; ASCII-only anchors; full-64-hex sweep;
battery-set completeness diff against the R15c battery log; hidden spawns only; one writer per
file; commit with explicit paths). The smoke container fixtures are CONTROLLED — build them to the
child-B fixture card exactly. `CompressionStream("deflate")` is universally present in Chromium;
legacy NKI inflate in the smoke may use it directly (child-B's module does the same).

## 7. Report shapes (children, prose)

A/B: file path · exact new top-level names · node --check result · harness numbers (fixtures,
parse anchors, the real-template extraction values for B) · **FIXTURE CARD** (offset-by-offset
byte recipe + expected values, port-ready) · real-file fetch outcomes · open items.
C: the two file paths · exact new/changed top-level names · the policy edits applied · the ctx-fix
diff line · DOM change (the meta line) · node --check results · open items.

## 8. Fixture-card format (A + B)

A compact, port-ready list per fixture: for every field — offset (hex), length, byte pattern or
string, and the value the reader must yield; plus one line stating the expected full receipt
(ok/kind/refCount/zones/name/...). Keep each fixture minimal (one zone / two refs / one name).
