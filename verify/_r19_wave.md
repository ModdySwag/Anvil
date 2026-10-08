# verify/_r19_wave.md — R19: user packs (`.avpack` collect & pack + import route) — contract

Opened 2026-10-09 (close of R18b). Plan of record: `docs/12-import-and-persistence.md` §3.6 (shape,
rules), §3.7 (Collect & Pack under Exports; the hub is THE surface). Base: HEAD a45bd17; frozen
`4614fbe1`; worklet `b65160e0` MUST stay untouched (page-side wave); battery baseline 25 suites
(smoke 76 · cdp_hub 39 · cdp_platform 52 · cdp_import 24).

## §1 Scope

IN: `.avpack` export ("Collect & Pack" of selected library items -> ZIP with manifest.json + verbatim
item bytes) and import (routed as a `bundle` variant: one receipt, per-item sha256 verified BEFORE
commit, provenance `pack:<id>`, kinds route to their stores). Shared schema rules module + strict
CLI check. Rig legs (round-trip + sha-mismatch refusal).

OUT: Song Bundle (kind `song` — R20); backup coverage (R20); catalog re-install wiring; cloud.
No engine/worklet work. `cdp_import`'s 24 checks must stay green UNCHANGED (generic zips keep the
R16 expansion; `.avpack` is an additive route). `cdp_platform` untouched.

## §2 The shared spec (BOTH SIDES — av_pack.js in-page validator and verify/avpack_schema.mjs
node module implement exactly this table; drift = a rig/CLI failure)

- **Container:** ZIP (stored or deflate-raw entries only — our writer). Required member:
  `manifest.json` (UTF-8 JSON). Items live at `items/<key>.<ext>` — verbatim original bytes,
  relative paths only (no leading "/", no ".." segments).
- **manifest.json v1:** `{v:1, id (slug /^[a-z0-9][a-z0-9-]{0,63}$/), name (<=80), author (<=80),
  license (<=40, may be ""), tags (array of <=8 strings, each <=24; may be []), at (finite epoch ms),
  app:"anvil-app", items:[...]}`.
- **item rows:** `{key (slug, unique), kind, format (<=12), name (leaf <=120), path
  ("items/<key>.<ext>"), sha256 (64-hex lower), size (finite >=0)}` + optional `meta` (object).
  kinds vocabulary = `["sample","kit","refs","pattern","wt","module"]`.
- **Rules:** every item's sha256 is verified against the extracted bytes BEFORE commit; a mismatch
  or missing member = that item REFUSED (named), never landed; duplicate keys = manifest invalid.
  Unknown extra keys are tolerated (forward-compat) but never required.

## §3 Child A pins (`src/av_pack.js` NEW + `src/av_lib.js` EDIT — sole writer of both)

av_pack.js (globals `AVPACK_*`/`avPack*` — verified free):
1. `avPackVersion` = "r19.0"; `avPackClasses()` -> `[]`.
2. `avPackValidateManifest(m)` -> `{ok, errors:[...], manifest?}` — the §2 table; never throws.
3. `avPackDetect(bytes)` -> `{ok, manifest?}` — zip sniff (reuse the R16 reader style) + manifest
   present + app/v match; never throws. (Async if the reader is.)
4. `avPackBuild(o)` -> `{ok, name, bytes, manifest, counts, error?}` — o = `{ids:[libId...],
   name?, author?, license?, tags?}`: loads each library record + its bytes (av_lib), maps kind
   (`sample|kit|refs|pattern` from the record; `wt`/`module` records when their stores hold the
   id — read av_wt.js/av_code.js for the actual save/load names), computes sha256 per item
   (`avImportSha256Hex` — '' refused honestly), builds `items/<key>.<ext>` + manifest via the
   existing ZIP writer (read src/av_zipc.js for its actual API — source wins), returns the zip
   bytes + the manifest. Busy-guarded; never throws.
5. `avPackImportBytes(bytes, packName, o)` -> `{ok, pack:{id,name}?, counts, items:[{key,name,kind,
   result,reason}], errors}` — validates the manifest, extracts (R16 reader), sha-verifies each
   item BEFORE commit, routes: sample/kit/refs/pattern -> `avLibAddItem` (result "imported",
   source `{name: packName, path: item.path, size, at, pack: manifest.id}`), wt -> the wt-store
   save, module -> the code-store save; per-item honest results ("imported"/"refused"+reason).
   ONE receipt. Reuses `avImportSha256Hex` for verification.
6. Facade `window.__avPack` = `{version, validate, detect, build, importBytes}`.
av_lib.js EDIT (additive-only, the R18a law): the record normalizers' `source` object gains
optional `pack` (string, slug <=64; absent -> dropped). Touch ONLY the source normalization
sites (avLibItemNorm and the LS/payload mirrors — the R18a field was added at each read path;
grep `source` in av_lib.js and mirror). Everything else byte-stable (cdp_import + the hub
R18a/R18b legs run against this file).

## §4 Child B pins (`src/av_import.js` EDIT — sole writer)

In the zip pre-pass (`avImportZipPrep`, ~line 1264) BEFORE the generic R16 depth-1 expansion:
1. Open the zip (the existing reader path) and probe for `manifest.json`; if present and
   `avPackValidateManifest` (typeof-guarded global) says ok -> this input is a PACK: call
   `avPackImportBytes(bytes, leafName)` (guarded; fallback = generic expansion when absent);
   produce ONE bundle row: `kind:"bundle"`, `result:"imported"` (or "refused" with the honest
   reason when the pack fails), `meta` = `{pack: id, items: N, installed: N, refused: N}`;
   counts: `bundles` incremented as today; the pack's item results ride the row's meta (the
   receipt stays per-FILE, the pack is one file).
2. Non-avpack zips: unchanged R16 behavior — byte-for-byte (cdp_import's 24 must stay green).
3. Never throw outward; any internal failure falls back to the generic path with a note.

## §5 Child C pins (`src/av_import_ui.js` EDIT — sole writer)

1. The manager row gains `#av-import-pack` ("COLLECT & PACK (N)") directly after
   `#av-import-delsel`; disabled at 0 selected (same update path as delsel, ~L2440-2442);
   button carries `.av-btn.mini` (the wide-button law).
2. Click: `window.__avPack.build({ids: selectedIds})` (guarded; absent -> honest note) -> on ok:
   FSA save picker when `avProjPicker('save')`-style seam is reachable (read av_proj.js — source
   wins; suggestedName = `<pack name>.avpack`), else `avDeliverDownload(name + ".avpack", bytes)`
   (the S4 pattern: Blob->arrayBuffer law where needed). Status line: "packed N items ->
   <name>.avpack" / honest refusals. Busy law: one op at a time; never throws.
3. Library rows: when `it.source && it.source.pack` -> a small `.av-import-chip-sib`-style chip
   reading `pack:<id>` (additive; reuse existing chip classes; no new class list needed unless
   the chip text needs one — prefer existing).
4. `AV_IMPORT_UI_CLASSES` unchanged unless a new class is truly introduced (report it).

## §6 Child D pins (`verify/avpack_schema.mjs` NEW + `verify/avpack_check.mjs` NEW — sole writer)

1. `avpack_schema.mjs` — the §2 table as a node module: `validateManifest(m)` export (+ the rules
   constants). Self-check mode (`node verify/avpack_schema.mjs`) prints PASS lines like
   av_bank_schema.mjs.
2. `avpack_check.mjs` — strict CLI: `node verify/avpack_check.mjs <path.avpack>` -> parses the zip
   (node:zlib), validates manifest, verifies EVERY item sha256 against the bytes, prints an honest
   per-item table + counts, exit 0 iff all pass; `--selftest` builds a tiny in-memory pack and
   validates it (so it can run in CI without a real file). Follow the verify_avpacks.mjs output
   style (the banks verifier precedent).
3. NOTE the name collision: `verify/verify_avpacks.mjs` is the BANKS verifier — do NOT touch it.

## §7 Child E pins (`verify/cdp_hub.mjs` EDIT — sole writer)

New section `/* -- 23d. R19 user packs -- */` after the R18b block, before the drop legs (+3 legs;
39 -> 42 pinned at freeze). In-page fixtures (avWavEncode bytes; no disk):
1. **round-trip:** import 2 fresh WAVs (distinct names) through the change handler -> select both
   in the manager (or drive `__avPack.build({ids})` directly with the two ids) -> build -> assert
   {ok, manifest.items 2, bytes zip} -> delete both from the library -> feed the pack bytes back
   through the card change handler as `rig-r19.avpack` -> one receipt, counts.bundles 1, both
   items land with `source.pack === manifest.id` -> avLibList shows both.
2. **sha-mismatch refusal:** copy the pack bytes, flip ONE byte inside an item's payload region
   (locate via the item's data; if locating is brittle, rebuild a pack with a manifest sha
   deliberately wrong via a scratch zip) -> import -> that item refuses (named), the other lands;
   item-level honest results in the receipt row meta.
3. **generic zip unchanged:** a plain zip (no manifest.json) still takes the R16 expansion
   (counts.bundles 1 + child rows) — guards the route ordering.
Keep EXPECT_SHA as-is (parent re-pins at freeze; count derived).

## §8 Parent integration

- **build.py js_parts gains `av_pack.js`** (before av_sources or app_core — name it explicitly;
  the R18b miss is the precedent). No app_core boot needed (lazy facade) unless Child C needs a
  boot hook — read C's report; a guarded `avPackInit`-style boot ONLY if C declares one.
- cdp_smoke +1 check (76 -> 77): `#av-import-pack` present in the manager + `__avPack` facade
  shape (version r19.0 + 4 fns).
- styles: Child C's reported classes only (expect none/minimal); the smoke layout guard must
  stay green.
- Gates: smoke **77** · cdp_hub **42** pinned (derived) · cdp_import **24 UNCHANGED** ·
  cdp_platform **52** · battery 25 + bench · pins sweep (full 64-hex; count re-checked) ·
  worklet `b65160e0` UNCHANGED · deploy index + sw · `avpack_check.mjs --selftest` green ·
  live pass + capture · addendum 65.
- Docs: docs/12 §3.6 wave line updated at close (shipped + as-built notes).

## §9 Watch-outs

- The R18b lesson: any new module not listed in build.py js_parts never ships (rigs fail guardly).
- av_zipc writer API + av_zip reader API: read the actual files; the contract's "zip writer/
  reader" references are placeholders for their real names (source wins).
- `avPackBuild` must not mutate library records; bytes are read-only.
- Provenance `pack` rides INSIDE `source` (additive); old records without it hydrate cleanly.
- One writer per file; children never run the build/browsers/suites/git; conflicts named.
- The pack name: default `<id>.avpack` — sanitize like av_video/av_card name caps.

## §10 Report shape

Per child: files written · interface list as implemented · not-done · conflicts · uncertainties.
Parent verifies landings by artifacts on disk (search_files + node --check), never by report.
