# verify/_r18_wave.md — R18a: library intelligence (identity · dedupe · relink v1) — contract

Opened 2026-10-09. Plan of record: `docs/12-import-and-persistence.md` §5 (R18, AMENDED: R18 now
splits — R18a = THIS wave; R18b = linked source folders + PWA file_handlers, staged next).
Recon digest (parent spot-verified): `cache/r18/recon-r18.md`. Base: HEAD 541a3c3; frozen
`3f87b4d3`; worklet `b65160e0` MUST stay untouched (page-side wave); battery baseline 25 suites
(smoke 74 · cdp_hub 29 · cdp_import 24).

## §1 Scope

IN: sha256 content identity on import + provenance `source`; NON-BLOCKING duplicate handling
(flag + replace + delete-as-skip); missing-content detection + relink v1 (rename-based);
receipt/record/UI/facade additions; cdp_hub legs.

OUT: linked folders + PWA widening + folder diff (= R18b); `.avpack` (R19); persistence (R20).
No engine/worklet work. `cdp_import`'s 24 checks must stay green UNCHANGED (all additions are
additive fields/keys).

## §2 Design decisions (locked)

- D1 **Non-blocking dedupe** (amends docs/12 §3.2's "dialog"): the one-shot pipeline never
  pauses; a duplicate imports normally (keep-both is the default) flagged `dup`; `replace` and
  `skip`(=delete the new row) are explicit row actions. Rationale: the card has no dialog
  precedent; the receipt contract stays intact.
- D2 **One hash site:** sha256 computed ONCE in `avImportWrite` (av_import.js:885 — item+bytes
  co-located, the single commit fn), via a helper mirroring `avBackupSha256Hex`'s '' discipline
  (av_backup.js:122-131): no crypto → `''`, NEVER blocks the run.
- D3 **Provenance** `source = {name, path, size, at}` set at the same site (item already
  carries name/path/size; at = ctx.at).
- D4 **Detection** = `avLibFindSha(sha)` — a scan over the loaded list (NO DB index, NO version
  bump; docs/12 §4.5 additive-only law).
- D5 **Relink v1 = rename-based:** kits resolve sample names by lowercase basename at LOAD
  (av_lib.js:1768-1791); "relink" renames a chosen library item to the missing name via the
  EXISTING `avLibRename` (av_lib.js, R17).
- D6 **Additive only:** record `v` stays 1; receipt `counts` gains `dups`; receipt item gains
  `sha` + `dup`; record gains `sha256` ('' fallback), `source` (null fallback), `dupOf` (null
  fallback). Old records/receipts hydrate cleanly.

## §3 Child A pins (`src/av_import.js` + `src/av_lib.js`; sole writer)

av_import.js:
1. `avImportSha256Hex(buf) -> Promise<string>` — guarded crypto (mirror av_store.js:421-428's
   lookup style), resolve '' on absence/throw.
2. `avImportWrite` (:885): compute `sha` from `bytes` (when bytes non-empty) BEFORE the
   avLibAddItem call; rec literal (:888-892) gains `sha256: sha` + `source: {name: item.name,
   path: item.path, size: item.size, at: ctx.at}`; after `avLibAddItem`, when `sha !== ''` and
   `typeof avLibFindSha === "function"`, call it; on hit set the receipt item's `dup =
   {id, name}` (keep-both; the write still happens).
3. Receipt item base (:446-449) gains `sha: ""` + `dup: null`; `avImportNewCounts`
   (:358-360) gains `dups: 0`; the run increments `counts.dups` when an item's dup is set.
av_lib.js:
4. Record additive fields, riding EVERY read path: `avLibItemNorm` (:367), `avLibRecNorm`
   (:279), `avLibMetaView` (:265), `avLibLsPayload` (:306), `avLibPayloadView` (:316),
   `avLibPayloadRec` (:335):
   - `sha256` — string, accept only /^[0-9a-f]{64}$/ else ''.
   - `source` — object or null; normalize {name <=120, path <=200, size finite>=0, at finite};
     any invalid → null.
   - `dupOf` — null | {id (AV_LIB_ID_RE), name <=120}.
5. `avLibFindSha(sha) -> Promise<{ok, hit, id?, name?, error?}>` — refresh+scan the list for
   `sha256 === sha` (first hit; newest-first order rules).
6. `avLibReplaceDup(newId) -> Promise<{ok, id?, removed?, error?}>` — load the new record
   (must exist, must carry dupOf); resolve dupOf.id (must still exist; else honest refuse
   "target gone"); the TARGET record receives the new record's {bytes, size, format, ext,
   kind, meta, sha256} and `source = {name, path, size, at: Date.now(), replaced: true}` from
   the new record; `dupOf = null`; then the NEW record is removed (avLibRemoveRun ladder).
   Receipt {ok, id: targetId, removed: newId, error?}.
7. `avLibMissingScan() -> Promise<{ok, missing: [{name, want: [{id, name, kind}]}], error?}>`
   — referenced names: for kind `kit` → meta.samples[].name; for kind `refs` → the name-bearing
   arrays as built at av_import.js:746-881 (read the shapes; normalize; skip empties). A name
   is missing when its lowercase basename (avLibBaseLower :1731) matches NO library item name
   (same normal form). Sorted by name; want capped 32.
8. Facade `window.__avLib` (:1992) additive: `findSha`, `replaceDup`, `missingScan`.
Version strings stay (R16 precedent).

## §4 Child B pins (`src/av_import_ui.js`; sole writer)

1. Report rows: `item.dup` truthy → chip `.av-import-chip-dup` ("DUPLICATE of <name40>") after
   the result chip; counts line (:632-645 style) gains " · N dups" when
   `counts.dups > 0` (guard receipts without the key).
2. Library rows: record `dupOf` → chip + `[data-av-import-act=replace]` REPLACE action (drives
   guarded `avLibReplaceDup(id)` + refresh; status "replaced with <name>" / honest refuse).
3. Missing: on lib refresh (and after runs / relink), a guarded `avLibMissingScan()` fills a
   memo; rows for records named in `want` get `.av-import-chip-missing` + a
   `[data-av-import-act=relink]` RELINK action; `#av-import-libstat` (:existing) appends
   " · M missing refs" when M > 0.
4. Relink editor: RELINK → inline select `.av-import-relink` in the row (options = library
   items; ranked: same lowercase basename-stem first, then others; label "name (kind)");
   Enter commit → guarded `avLibRename(candidateId, missingName)` → rescan → status "relinked
   <name>". Esc/blur cancels. ONE editor at a time (mirror the rename editor law at
   avImportUiBeginRename).
5. Facade `window.__avImport` (:2870) additive: `replace(id)`, `relink(name, candidateId)`,
   `missing()` (thin wrappers for rigs); `snap()` gains `dups` (last receipt `counts.dups`)
   + `missing` (scan count) additively.
6. AV_IMPORT_UI_CLASSES (:196-215) gains exactly: "av-import-chip-dup",
   "av-import-chip-missing", "av-import-relink". Keep every existing id/behavior intact
   (smoke 6ci/6cu + all cdp_hub legs run against this file).

## §5 Child C pins (`verify/cdp_hub.mjs`; sole writer — extend, never weaken)

New section after §26, before the drop legs; 4 checks (29 → expect 33 pinned):
1. **dedupe:** import the SAME small WAV twice via the change handler → 2nd receipt: item.dup
   truthy with the 1st id/name, `counts.dups === 1`, `snap.dups === 1`, a
   `.av-import-chip-dup` row present.
2. **replace:** drive `__avImport.replace(newId)` (or the row action) → avLibList keeps exactly
   ONE record of that name — the OLD id, with `source.replaced === true` — and the new id is
   gone; receipt ok.
3. **missing:** import a synthetic .exs kit whose sibling WAV is NOT in the library → after
   scan, `snap.missing >= 1`, the kit row carries `.av-import-chip-missing`; assert the
   pre-scan missing count was 0.
4. **relink:** import a same-stem-named library item? NO — rename path: `__avImport.relink(
   missingName, candidateId)` where candidateId is an existing sample row → rescan clears the
   missing count to 0; receipt ok; the renamed name visible in avLibList.
Keep EXPECT_SHA as-is (parent re-pins at freeze). In-page fixtures only (no disk files).

## §6 Parent integration

- docs/12 §5 amendment (R18 split) + §3.2 dedupe as-built note (landed with this contract).
- Styles block from Child B's class list (chips + relink select).
- Gates: smoke **74** · cdp_hub **33 pinned** · cdp_import **24 UNCHANGED** · battery 25 +
  bench · pins sweep (count re-checked at freeze) · worklet `b65160e0` · deploy (index + sw) ·
  live pass + capture. Continuation addendum at close.

## §7 Watch-outs

- Additive-only discipline: never mutate old records' missing fields into fake values; '' /
  null fallbacks everywhere (hydrate teaches, not repairs).
- The scan paths are bounded by the library list (no filesystem walks in R18a).
- One op at a time (busy law) for replace/relink; relink honors the ONE-editor law.
- `av_import.js` edits must keep `cdp_import` 24/24 with UNCHANGED expectations.
- Source wins over pins; name conflicts in the report, never silently diverge.

## §8 Report shape

Per child: files written · interface list as implemented · not-done · conflicts · uncertainties.
Parent verifies landings by artifacts on disk (search_files + node --check), never by report.
