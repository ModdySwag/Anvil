# verify/_r17_wave.md — R17 IMPORT HUB v1 (the Store one-stop shop) — contract

Opened 2026-10-09 (R17 design session). Plan of record: `docs/12-import-and-persistence.md`
(§0 D1-D11, §3, §5 R17). Base state at open: HEAD = the R17 design commit; frozen
`index.html` = `ebc4e907` (3,928,027 B, live moddys.net/anvil); worklet sha `b65160e0`
(PAGE-SIDE WAVE — the worklet concat must stay byte-identical); smoke 72/0 on the frozen
bytes (re-run green this session); battery 24 suites.

## §1 Scope

IN: (1) hub relocation — the `#av-import` card moves from the SYNTH zone into the STORE
zone, retitled; (2) File menu entries; (3) drop-anywhere routing; (4) library manager v1
(rename, multi-select delete, search, sort, filter, per-item export); (5) receipts history
(persisted, last 20 runs); (6) storage meter + persist() nudge; (7) facade + pick/library
functions the menu needs.

OUT (later waves): sha256 identity/dedupe/provenance + relink + linked folders (= R18);
`.avpack` + Song Bundle (= R19/R20); autosave changes (= R20); OPFS (deferred, docs/12 D10).

DO NOT TOUCH: `src/av_import.js` (the core pipeline — `cdp_import` 24/24 must stay green
on the new bytes, unchanged), engine, worklet concat, `av_store` install flow internals
(only additive persist helpers), seq, sessions.

## §2 Deliverables + file ownership (one writer per file)

| Writer | File(s) | Deliverable |
|---|---|---|
| Child A | `src/av_lib.js`, `src/av_store.js` | §3 pins: avLibRename · receipts store trio · record `ext` · facade additions · avStorePersist/Persisted |
| Child B | `src/av_import_ui.js` | §4 pins: manager v1 UI · receipts section · storage footer · drop-anywhere · pick/library/rename/exportItem functions |
| Child C | `verify/cdp_hub.mjs` (NEW) | §6 rig |
| Parent | `src/body.html`, `src/av_rail.js`, `src/av_menubar.js`, `verify/cdp_cockpit.mjs`, `verify/cdp_smoke.mjs`, `src/styles.css`, pin sweep | §5 integration (counted-assert script), build/freeze/battery/deploy |

No new `src/` build parts (all touched modules already in `js_parts`). Children never run
the build/browsers/git; parent owns everything shared.

## §3 Child A pins (`src/av_lib.js` + `src/av_store.js`)

Version strings stay stable (`AV_LIB_VERSION` "r15b.0" unchanged — R16 precedent: the
pinned contract version is not bumped; new surface is witnessed behaviorally).

New frozen constants in av_lib.js (additive, names frozen):
`AV_LIB_RECEIPT_DB = "av-receipts-store"` · `AV_LIB_RECEIPT_OS = "runs"` ·
`AV_LIB_RECEIPT_LS = "av-receipts-ls"` · `AV_LIB_REC_KEEP = 20` · `AV_LIB_REC_ITEMS_MAX = 60` ·
`AV_LIB_REC_ERR_MAX = 20` · `AV_LIB_REC_TITLE_MAX = 80` · `AV_LIB_REC_NOTE_MAX = 160` ·
`AV_LIB_NAME_MAX = 120` · `AV_LIB_EXT_MAX = 12`.

1. **Record additive field `ext`** — lowercase, dot-stripped, cap `AV_LIB_EXT_MAX`, `""`
   fallback. Accepted/retained by `avLibItemNorm` + `avLibRecNorm` (both read paths);
   `avLibMetaView` MAY carry it (pin: include it — the UI builds export filenames from
   list data). Old records without `ext` must hydrate as `""` (never a crash).
2. **`avLibRename(id, name) -> Promise<{ok, id, name, error?}>`** — never throws. `name`
   trimmed; empty after trim -> `{ok:false, id, name:"", error:"no name"}`; cap 120
   (truncate, not refuse). Mirror `avLibRemoveRun`'s tier ladder (av_lib.js:878-903):
   update the memory map, the LS mirror (map rewrite + write-through; refusal -> stuck),
   and the DB row when a DB is up (read row, update name, put). `ok:true` requires at
   least the memory/LS application; a refused durable write with a DB up ->
   `{ok:false, error:"rename refused"}`; no DB -> apply mem+LS and answer honestly.
   Update `st.items[id]` meta view on success.
3. **Receipts trio** (own DB — `av-samples-store` is NEVER migrated):
   - `avLibReceiptSave(rec) -> Promise<{ok, id, error?}>` — normalize to
     `{id, v:1, at, title, counts, errors, items}`: `id = "r" + Date.now().toString(36)`;
     `at` = rec.at or now; `title` cap 80 (default "import"); `counts` = the receipt counts
     subset `{total, imported, deferred, refused, samples, patterns, kits, refs, bundles}`;
     `errors` = array of strings capped `AV_LIB_REC_ERR_MAX` x 160; `items` = capped
     `AV_LIB_REC_ITEMS_MAX` of `{name, format, kind, result, reason, size}` (reason cap 160).
     Tiers: idb (`av-receipts-store` v1, store `runs`, keyPath id, create-if-missing) -> ls
     (`av-receipts-ls`; summaries may drop `items`) -> mem. Mirror av_lib's honest-tier law:
     quota/DB failure does NOT silently downgrade (answer the tier it used / the error).
     Rotation: after commit, delete runs beyond newest `AV_LIB_REC_KEEP` (by `at`).
   - `avLibReceiptList() -> Promise<{ok, backend, count, runs: [{id, at, title, counts}]}>`
     newest-first.
   - `avLibReceiptClear() -> Promise<{ok, removed, error?}>` — durable-first like remove;
     retire the LS key when emptied.
   - Extend `window.__avLib` (av_lib.js:1407-1416) additively: `rename`, `receiptSave`,
     `receiptList`, `receiptClear`.
4. **`av_store.js` persist helpers** (beside `avStoreEstimate`, av_store.js:817-829,
   mirror its nav-lookup style; both never throw):
   - `avStorePersist() -> Promise<{ok:boolean, persisted:boolean, error?}>` —
     `navigator.storage.persist()` when present. Call ran: `{ok:true, persisted:<bool>}`
     (a `false` grant is a successful call, honestly reported). Unsupported/threw:
     `{ok:false, persisted:false, error}`.
   - `avStorePersisted() -> Promise<boolean|null>` — `persisted()` query; `null` when
     unsupported.

## §4 Child B pins (`src/av_import_ui.js`)

All new ids/classes frozen; follow the card's existing write-on-change paint discipline
and ONE-op-at-a-time busy law (manager controls disabled while busy; busy classes stay
`av-import-busy` + `dataset.avImportBusy` + `aria-busy`).

Manager controls (in the card, above the library list):
- `#av-import-search` — input type=search, placeholder "search the library..."; live
  filter (client-side over `avLibList()`; case-insensitive substring on name).
- `#av-import-sort` — select, values `newest|name|size|kind`, default `newest`
  (newest = current list order).
- `#av-import-filters` — chips host; `.av-import-fchip[data-f=all|sample|kit|refs|pattern]`
  (button; active class `on`; default `all`).
- `#av-import-selall` — select-all toggle button ("select all" / "clear"); operates on
  VISIBLE (filtered) rows.
- `#av-import-delsel` — "delete selected" button, disabled at 0 selected; deletes
  sequentially via `avLibRemove` (one op at a time), refresh + status "deleted N".
- Per-row: checkbox `[data-av-import-check]` (aria-label "select <name>"); action buttons
  extend the existing set with `[data-av-import-act=rename]` and
  `[data-av-import-act=export]` (keep load|send|chop|seq|kit|del as-is).
- Rename inline edit: click rename -> name cell becomes input `.av-import-rename`
  (value = current name, maxlength 120); Enter = commit via `avLibRename` + refresh;
  Esc = cancel; blur = cancel. Status line reports the result.
- Export: `avLibGet(id)` -> item.bytes (FULL record incl. bytes — av_lib.js:853
  "full record incl. bytes") -> `avDeliverDownload(bytes, filename)` (guarded typeof);
  filename = `name + "." + ext` when ext, else the fallback map
  `{wav:"wav", mp3:"mp3", aiff:"aiff", rex2:"rx2", pattern-kind:"mid", kit-kind:"exs",
  refs-kind:"json"}`, else `"bin"`. Status "exported <filename>" / honest failure.

Receipts history section (below the report view):
- Host `#av-import-runs` — rows `[data-av-import-run="<id>"]` (buttons): "HH:MM · imported N ·
  deferred N · refused N · <title>" (counts from the stored record). Click = history view:
  paint the stored items into `#av-import-report` (reuse the row builder) + stored counts
  into `#av-import-counts` + status "history view - run at <time>"; root gets
  `.av-import-hist`; the next live run clears it.
- `#av-import-runsclear` — "clear history" -> `avLibReceiptClear()` + refresh.
- `#av-import-runs-empty` — hidden when rows exist ("no runs yet").
- Save point: after EVERY `avImportFiles` completion from the card (single call site
  `avImportUiImport`), `avLibReceiptSave(subsetOfReceipt)` fire-and-forget; a failed save
  notes into the status line (honest, never blocks the run). Refresh the runs list after.

Storage footer:
- `#av-import-storage` — one line "storage: <used> of <quota> · <tier>"; on init + after
  runs via `avStoreEstimate()`; honest "storage: unavailable (this browser)" when null.
- `#av-import-persist` — "make storage persistent"; click -> `avStorePersist()` -> status
  line honest: "persistent storage granted" / "persistent storage not granted (best-effort)")
  / unsupported. Never claims a grant it did not get.

Drop-anywhere (extend `avImportUiClaimDoc`, av_import_ui.js:570-583):
- The document-level drop listener keeps ALWAYS preventDefault (stray-drop law) and gains
  routing: when `ev.target` is NOT inside the hub host (`host.contains(ev.target)` false),
  read the dataTransfer -> `avImportUiFilesFromDataTransfer` -> `avImportUiImport(files)`,
  then reveal: guarded `avZoneShow("store", {source:"drop"})` + `avImportUiReveal()`
  (scroll hub into view + focus the drop zone). Drops INSIDE the host are left to the
  card's own handler — the containment guard prevents double imports (witnessed in §6).

Facade additions (`window.__avImport` additive — keep existing keys):
`pick()` (opens `#av-import-file`), `pickDir()` (opens `#av-import-dir`),
`library()` (avZoneShow store + reveal + focus; returns true),
`rename(id, name)` and `exportItem(id)` (thin wrappers around the row actions for rigs).
`snap()` gains `runs` (count) + `manager` `{search, sort, filter, selected}` additively.
Proof line (`IMPORT SELFTEST`) may gain `hub:true` — gated + deferred law unchanged.

## §5 Parent integration (counted-assert script; anchors captured from a fresh read)

1. `src/body.html` — MOVE the whole `<section class="av-card" id="av-import">` block
   (current L56-59) out of the synth zone into the store zone box AFTER the av-store
   section (current L128-131); retitle `<h2>Sample Packs</h2>` -> `<h2>Import &amp;
   Library</h2>`; refresh the placeholder copy inside `#av-import-host` to hub wording
   (keep the "nothing is uploaded" honest note). The synth zone loses the section.
2. `src/av_rail.js` — synth group (L15): remove `["av-import", "Sample packs"]`; store
   group (L20): `cards: [["av-store", "Packs"], ["av-import", "Import & library"]]`.
   (Rail label sentence-case; card h2 title-case — deliberate.)
3. `src/av_menubar.js` — File items (L21-26) become, in order: Save project (.anvl) ·
   Open project... · `sep` · "Import sounds..." -> `avImportUiPick` · "Import folder..." ->
   `avImportUiPickDir` · "Library..." -> `avImportUiLibrary` · `sep` · Export stems
   (Deliver) · Load demo groove. (All via `avMenuCall`; menus own no state.)
4. `verify/cdp_cockpit.mjs` — ZONEMAP (L149-155): synth list drops `'av-import'`; store
   becomes `['av-store', 'av-import']`; check the following count assertion (update any
   pinned number; total card count stays 24).
5. `verify/cdp_smoke.mjs` — 6ci (L1107-1112): expected zone `'synth'` -> `'store'`
   (strength preserved). NEW check (after 6ci): hub v1 structure — search/sort/filters/
   selall/delsel/runs/runsclear/storage/persist ids present + File popup contains
   "Import sounds..." / "Import folder..." / "Library..." labels. Smoke 72 -> 74.
6. `src/styles.css` — R17 block authored by the parent from Child B's runtime class list
   (house law).
7. Also sweep `verify/cdp_import.mjs` for any card-zone assertion — update to `'store'`
   ONLY if pinned there (keep strength; its 24 checks must otherwise stay green on the
   new bytes).

## §6 Child C pins (`verify/cdp_hub.mjs`, NEW rig)

Launch block copied from `verify/cdp_import.mjs` (house law: one browser at a time,
1440x900 metrics, --autoplay-policy, temp profile, explicit exit, log to
`verify/last-cdp_hub.log`). Synthesize fixtures in-page (small WAV via `avWavEncode`,
SMF pattern, one unknown file). Legs (~30 checks; expect the pinned count as final):

1. Boot: hub card `#av-import` present, `closest('.av-zone')` zone === `'store'`, h2
   "Import & Library"; legacy ids intact (drop/file/dir/pick/pickdir/status/counts/
   report/lib/slot/note/empty) + new ids (search/sort/filters/selall/delsel/runs/
   runsclear/storage/persist).
2. Facade: `__avImport` has pick/pickDir/library/rename/exportItem (functions);
   `__avLib` has rename/receiptSave/receiptList/receiptClear.
3. Menubar: File popup labels include the three new entries; `avImportUiLibrary()`
   switches the active zone to store (witness `data-zone` on the visible pane).
4. Import run -> receipt persisted: after one synthetic run, `avLibReceiptList()`
   count === 1 and `#av-import-runs` row count === 1; a second run -> 2.
5. Persistence leg: RELOAD the page, then list again from the run's stored records
   (runs and their counts survive; LOAD FRESH house law).
6. Rename: rename a row -> `avLibList` name updated; reload -> persists.
7. Manager legs: search narrows (3 items -> 1 hit); filter chips narrow by kind; sort
   flips order (name vs newest); selall + delsel removes selected only (others intact).
8. Export: swap `window.avDeliverDownload` with a spy; `exportItem(id)` -> spy got
   (bytes, name) with `bytes.byteLength === stored size` and the name carrying the ext;
   restore the original after.
9. Storage: `#av-import-storage` text matches a storage line (or the honest fallback);
   `avStorePersist()` resolves an object (never throws, `ok` a boolean); clicking
   `#av-import-persist` writes an honest result into the status line (do NOT assert a
   granted boolean — headless grants are false).
10. Drop-anywhere: synthetic drop (DataTransfer + File) on a NON-hub element -> zone
    becomes store, runs count increments once; a drop INSIDE the hub drop zone imports
    exactly once (containment guard witness — no double import).
11. Row-action sanity: one sample LOAD e2e (the cdp_import style) to prove the manager
    did not break the existing actions.
12. Zero page errors + the `EXPECT_SHA` pin leg (set at freeze; pinned runs report one
    more check than unpinned — carry the pinned count forward).

## §7 Gates (parent)

smoke **74** (updated + new check) · `cdp_import` **24/24 on the new bytes, expectations
UNCHANGED** · `cdp_hub` ALL GREEN first-lap (pinned) · `cdp_cockpit` green (updated map) ·
battery **25 suites** (adds cdp_hub) green + bench (knee monotone; realtime cells honest) ·
pins sweep over `verify/cdp_*.mjs` — FULL 64-hex literals, sweep size asserted · worklet
sha `b65160e0` UNCHANGED (verify via grep on the built index) · leak probe 11/11 live ·
deploy `index.html` + `sw.js` (scoped `--verify` = 0 not in sync, live sha = frozen) ·
live capture `renders/r17-live-hub.png` inspected.

## §8 Watch-outs

- FileList snapshot-first law (av_import_ui.js:1521-1528) — never regress; the rig drives
  the change handler.
- The doc-drop containment guard above; a second import path must not double-fire.
- One writer per file; anchors from a fresh `read_text` (LF sources); counted-assert
  integration script all-or-nothing; `python3 -m py_compile` it while drafting.
- `av_import.js` stays untouched — if a need arises there, it belongs in av_import_ui
  (the UI already holds the receipt it must save).
- Card moves = card trio + cockpit map + smoke check land TOGETHER (relocation law).
- Manager renders capped rows (existing caps: lib rows 400, report rows 600) — show the
  honest cap line, never silently truncate.
- Busy discipline: every manager action obeys the ONE-op-at-a-time law.

## §9 Report shape (each child)

Files written (exact paths) · interface list as implemented (names + receipts) · what was
NOT done · named conflicts vs pins (if any; source wins — name it) · uncertainties.
House law: child landings are verified by artifacts on disk (search_files + node --check),
never by the completion report.
