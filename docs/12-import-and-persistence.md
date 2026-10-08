# docs/12 — IMPORT CONTROL & WORK PERSISTENCE (plan of record)

Owner ask (2026-10-09, out-of-band): a robust schema design + integration plan for user
importing of sound packs / loops / custom file formats — maximum import control, industry-
standard methods, folded into the format-compatibility layer being built (docs/11); the
STORE (or its section) must be a ONE-STOP SHOP for all user importing; plus a robust
saving method for work and sessions "for later use and referral" (web app).

Status: DESIGN LOCKED (agent discretion, golden-build mandate). Waves staged: R17 (import
hub) → R18 (library intelligence) → R19 (user packs) → R20 (work persistence). The R17
plan is pre-staged in `verify/_r17_wave.md`.

Evidence: three recon digests (this session, parent spot-verified against source):
`cache/r17/recon-import.md` (import layer as built) · `cache/r17/recon-sessions.md`
(persistence as built) · `cache/r17/research-industry.md` (industry mechanisms + source
links; all adopted mechanisms cited there). Scratch only — the folded verdicts live HERE.

---

## 0. Decisions (locked)

- **D1 — One canonical model, lossless-or-labeled.** Every adapter is a pure function
  `external bytes -> canonical objects + provenance`; nothing downstream knows the source
  format. "100% compatibility" is defined honestly: 100% of SUPPORTED formats map without
  silent loss; unsupported formats refuse with a named reason + the sibling-WAV fallback
  hint; partial extraction states exactly what was dropped. Never a silent fail.
- **D2 — The STORE zone becomes the one-stop shop: STORE (catalog) + IMPORT & LIBRARY.**
  The SAMPLE PACKS card `#av-import` RELOCATES from the Synth zone into the Store zone,
  retitled "IMPORT & LIBRARY". One surface for: import (drop/pick/queue), receipts,
  library management, linked folders, storage. The Synth zone keeps only content
  CONSUMERS (slots / pads / chop / OSC2 / seq). Reach paths everywhere else (File menu,
  drop-anywhere, open-from-OS) all funnel into this ONE pipeline and show their receipt
  in this ONE card.
- **D3 — Reach paths:** File menu entries (Import sounds… / Import folder… / Link source
  folder… / Library…), a document-wide drop-anywhere handler (drops outside the card
  import and jump the hub to Store with the receipt), PWA `file_handlers` widened
  (.wav .mp3 .mid .zip .anvl) all routing through the same sniffer/policy/receipt.
- **D4 — Library management v1 (R17):** per-item RENAME; multi-select; search + sort +
  filter (kind/format/tag); PER-ITEM EXPORT (original bytes out: WAV/MID/AIFF/…); receipts
  HISTORY persisted (last 20 runs); per-row DELETE stays. (SEND/CHOP/SEQ/KIT actions exist.)
- **D5 — Linked source folders (FSA):** showDirectoryPicker → DirectoryHandle persisted in
  IDB; explicit RE-SCAN (manual refresh + File.lastModified staleness — the DAW-standard
  pattern; browsers cannot watch folders); diff list (new / changed / gone) → import
  selected. Reconnect flow re-requests permission on a click (grants die with the last
  tab — industry fact). Graceful fallback where FSA is absent (Chromium-only pickers).
- **D6 — Missing-content relink:** missing-sample list + ranked candidates (exact sha256 >
  name+size > fuzzy) + explicit human commit. Never silent substitution. Detection: kit /
  refs library records gain `refs:[names]`; the library resolves names at load today and
  keeps doing so.
- **D7 — User pack format `.avpack` = ZIP + manifest.json** (own clean-room shape, the
  SFZ/Decent-Sampler/Ableton-.alp lineage): root `manifest.json` + `items/` payload
  (original bytes verbatim), relative paths only, per-file sha256, license field, kind
  targets (sample/kit/refs/pattern/wt/module). ONE shared schema module
  (`verify/avpack_schema.mjs`, the `av_bank_schema.mjs` / PF `synth_pack_schema.mjs`
  lineage: imported by export path + import path + verifier so they can never drift).
  Export = "Collect & Pack" from the library (FSA save or download); import rides the
  existing `bundle` pipeline as kind `avpack`.
- **D8 — Work persistence = three layers.** L1 continuous autosave (extend the existing
  sessions `__autosave` record: default ON, debounced, `visibilitychange`→hidden flush,
  snapshot discipline; recovery offer already exists and never auto-applies). L2 explicit
  projects: `.anvl` as built (FSA), plus Save-reuses-handle, Save As, RECENT projects
  (handle + meta persisted in IDB), templates. L3 self-contained bundle: "Song Bundle"
  export/import = .avpack carrying `project.anvl` + referenced library items + user
  modules + wt tables + the installed-pack manifest refs (the web "Collect All and Save").
- **D9 — "For later use and referral":** session browser v2 (previews: engine kind /
  bars / take count / timestamps; tags; search+sort), recent projects (reopen without a
  picker where the stored handle is still permitted), snapshot ring visible with RESTORE
  (exists), boot recovery offer; share links / QR (S4 exists) and family bridges stay as
  the external referral paths; cloud stays later-phase (links-only stance).
- **D10 — Storage durability:** call `navigator.storage.persist()` after the first real
  save/import; show a usage meter (`estimate()`, pattern exists in av_store); honest
  language (browser storage is a cache; Export/Backup is the vault). OPFS: DEFERRED
  (file:// rig surface: `getDirectory()` throws SecurityError in Chromium 145 — probed;
  IDB covers every need at Anvil's sizes; revisit as an https-only enhancement).
- **D11 — Feature-detect everything, fall back gracefully:** FSA absent → input/download
  paths; persist absent → hide the meter nudge; no adapter → deferred + named reason.

## 1. The schema design principle (what "robust" means here)

P1 **Canonical content model.** The library is the single source of truth; everything in
the app references library ids, never raw files. Canonical kinds (as shipped): `sample`
(PCM bytes + rate/channels/frames/bits meta) · `pattern` (seq payload) · `kit` (zone map +
sample-name refs) · `refs` (extractable pointers/meta: Serum wt refs, NI/SXT refs). R19
adds pack-level containers; the kind set stays closed and versioned per record (`v:1`).

P2 **Adapters are pure + capability-registered.** `avImportSniff` → `AV_IMPORT_POLICY`
→ per-format adapter (typeof-guarded per call, so a dropped module degrades to an honest
"decoder pending" line). One funnel: every byte enters via `avImportFiles`.

P3 **Lossless-or-labeled** (D1). Fidelity contract per format, recorded in docs/11's
verdicts; refusals carry the reason + the actionable fallback (sibling WAVs).

P4 **Provenance + identity.** Every library record gains export of `source {name, path,
size, at}` and a content `sha256` (computed on import, `crypto.subtle` — secure-context
ok on file://). Identity = content hash: dedupe, relink and "already imported" all key
on it. (Today: ids are time+slug; the same file imported twice duplicates — R18 fixes.)

P5 **One schema module + one verifier.** Any new format (`.avpack`, later additions)
ships a schema module imported by EVERY side that writes/reads/validates it — the proven
`av_bank_schema.mjs` pattern; never two drifting definitions.

P6 **Versioned + migratable.** `v` on every record/container; create-if-missing upgrade
branches recorded as migrations; hydrate teaches-not-repairs (existing law).

P7 **Local-first spine.** Nothing uploads. Import adapts files in; export writes them
back out losslessly. The network is optional.

P8 **Honest receipts everywhere.** Import, export, relink, restore — every operation
reports per-item imported/deferred/refused and its storage tier (idb|ls|mem, volatile
flagged). Users judge importers by how honestly they explain misses.

Industry mapping — see §6 table. The short version: relative-path folder packs (SFZ /
Decent Sampler), one browser + user-added folders + drag-drop (Ableton Places, FL
Browser), explicit Refresh over watchers (FL / REAPER / Bitwig), missing-file list +
manual relink (Ableton File Manager, S1 Pool), content-hash dedupe (Anvil beats the
desktop DAWs here), Collect-All-and-Save (Ableton .alp), Backup-ring + Revert-to (Logic),
crash recovery (FL Backup folder / Ableton Crash folder), durable-web best practice
(persist() + meter + export as the vault).

## 2. As-built today (verified snapshot — the ground R17 builds on)

- Pipeline: `avImportFiles -> avImportSniff -> AV_IMPORT_POLICY -> adapters -> receipts`.
  Receipt `{ok,title,at,version,items,counts,errors}`; counts
  `{total,imported,deferred,refused,samples,patterns,kits,refs,bundles}`; item
  `{key,name,path,ext,format,kind,result,reason,size,sibling,id,meta}`. Caps: 96 MiB/item,
  600 files/run. (av_import.js:362-373, 446-449, 99-100)
- Formats live: wav mp3 aiff mid rex2 (core) + exs kit + adg als serum nki nbkt sxt refs
  + zip bundles; wt deferred-pointer; kong mxgrp gzip unknown refused. `embeddedWTData`
  and NKI modern zone maps remain open (docs/11).
- Library: IDB `av-samples-store` v1 / store `items`, record
  `{id,v,name,kind,format,size,at,meta,bytes,via}`; APIs init/add/list/get/remove/load/
  status; session cap 32; LS fallback (1.5 MiB/item refusal); NOT present: rename, hash,
  search, sort, export, dedupe, relink, receipts history. (av_lib.js:806-829, 93-96)
- UI: card `#av-import` in the SYNTH zone (to MOVE per D2); report rows, counts line,
  library rows with load|send|chop|seq|del (kit rows KIT|DEL; refs rows SEQ|DEL).
- Store: IDB `av-packs-store` v1 / `packs` `{id,v,name,file,sha256,size,at,presetCount,
  tags,engine,pack}`; sha256-before-commit; ONE network path (avStoreSetFetch seam);
  catalog sections INSTALLED/AVAILABLE + search + filters. (av_store.js:76-91, 691-737)
- Sessions: IDB `av-sessions-store` v1 / `sessions` `{id,name,createdAt,updatedAt,
  current,versions[<=16]}` + single `__autosave` record; autosave OFF by default, 45 s
  clamp 5-600 s; recovery offer at hydrate, never auto-applied; dirty fingerprint
  excludes prefs. (av_session.js:96-105, 134, 1377-1430)
- Projects: `.anvl` `{magic:anvl,v:1,app,kind:project,at,name,state}` + LF; 16 MiB cap;
  FSA seam avProjSetFs; save includes working state ONLY — no take audio, no sample
  bytes, no pack refs, no user modules; no handle reuse (picker every save); no recents.
  (av_proj.js:333-375, 814-826)
- Backup: `anvil-backup-<stamp>.zip` = sessions + installed packs + LIVE slot WAVs; does
  NOT cover av-samples-store / av-wt-store / av-code-store / LS prefs. Restore additive,
  sha-verified. (av_backup.js:7-18, 45-49)
- Menubar File as built: Save project (.anvl) · Open project... · Export stems (Deliver)
  · Load demo groove. (av_menubar.js:21-26)
- PWA: `file_handlers` accepts `.anvl` only; launchQueue → avProjOpenText.
  (manifest.webmanifest:36-45, av_pwa.js:573-621)
- FSA usage today: av_proj (file pickers) + avDeliverDownload — ZERO directory handles.
- Storage: `estimate()` shown in the store card; `persist()` never called (0 matches).

## 3. The user-facing import layout (maximum import control)

### 3.1 Surfaces map
1. **Store zone hub** — `STORE` card (catalog, unchanged) above `IMPORT & LIBRARY`
   (relocated `#av-import`). All import/management lives here.
2. **File menu** (added): `Import sounds...` · `Import folder...` · `Link source
   folder...` · `Library...` (jump + focus) — separators grouping with the existing
   Save/Open. (Workspace menu unchanged.)
3. **Drop-anywhere** — dropping files/folders ANYWHERE on the app imports through the
   funnel and (a) jumps to Store, (b) shows the receipt, (c) status line names the run.
   Context drops that exist today (onto assignment surfaces) stay working.
4. **Open-from-OS** — PWA file_handlers widened: `.anvl .zip .wav .mp3 .mid` → route:
   .anvl opens the project; others run the import funnel.
5. **Consumers (unchanged)** — slots 1-4 send, pads, chop, seq, OSC2.

### 3.2 The import flow (per run)
drop/pick → sniff (64 B) → policy → adapter → per-item result. Duplicates (R18a, as-built
NON-BLOCKING): a hash hit imports normally (keep-both) carrying a DUPLICATE flag + chip;
`replace` (swap payload + provenance note) and `skip` (= delete the new row) are explicit row
actions — no modal dialogs (the card has none, and the one-shot pipeline never pauses). Zip:
bundle row + children (depth-1). Sibling chip: same-stem WAV/MP3/AIFF
detected and served as the fallback suggestion for refs/refusals (already live).
Receipt: persisted to history (last 20); re-run deferred items button (R18: remembers
paths where the same folder is linked; otherwise re-drop).

### 3.3 Library manager (the management half of the hub)
Row: name · kind · format · size · imported-at · source (folded into a details line) ·
actions. R17 adds: RENAME (inline), multi-select + delete selected, search box, sort
(newest/name/size/kind), filter chips (All/samples/kits/refs/patterns). R18 adds: tags
row display + tag filter; dedupe badge; missing badge; relink button. R19 adds: packing
(select → "Collect & Pack"). Empty states + honest tier line stay.

### 3.4 Linked source folders (folder watch, the web way)
`Link source folder...` → showDirectoryPicker → handle stored in new IDB
`av-sources-store` / `sources` `{id,name,handle,linkedAt,lastScanAt,mode}` (handle
structured-cloneable — industry fact). Card section lists linked folders with
RE-SCAN / UNLINK. RECONNECT banner when a handle needs a permission re-grant (one click).
Rescan walks (depth cap, count caps) → diff NEW / CHANGED(lastModified+size) / GONE vs
the library's recorded source paths → import selected. No watchers — the DAW-standard
explicit refresh (FL "Refresh content", REAPER "Scan databases", Bitwig locations).

### 3.5 Missing-content relink (kits/refs)
Kit/refs records store their referenced names (`refs`). Missing = a ref with no library
match (resolution is by name, by design). The hub shows a missing banner (count) →
list rows (name, wanted-by kits, tried paths) → RELINK opens candidates: exact sha256 >
name+size > fuzzy; user commits one. Relink also accepts a re-linked folder scan as its
candidate source. Never silent substitution (Ableton/S1 pattern).

### 3.6 User packs — `.avpack` (R19)
Shape (SFZ/DS/Ableton lineage): ZIP (stored + deflate-raw — our reader AND writer both
exist) containing `manifest.json` + `items/<key>.<ext>` verbatim original bytes.
manifest.json (v:1): `{v, id (slug), name, author, license, tags, at, app:"anvil-app",
items:[{key, kind:"sample|kit|refs|pattern|wt|module", format, name, path:"items/...",
sha256, size, meta}]}`. Rules: relative paths only; sha256 per item, verified BEFORE
commit (the store's law); kinds route to their stores (sample/kit/refs → av-samples-store;
wt → av-wt-store; module → av-code-store; pattern → library). Export: FSA save or
download via avDeliverDownload. Import: routed as a `bundle` variant (one receipt; every
item lands with provenance `pack:<id>`). Gated by `verify/avpack_schema.mjs` (shared by
export/import/verifier) + a strict CLI check like the bank verifier.

### 3.7 Menus & file-system management (the full control story)
- File: Import sounds… · Import folder… · Link source folder… · Library… (jump). (D3)
- Library operations: rename, delete, dedupe on import, relink, export item, link/unlink
  folders, rescan. Storage meter + PERSIST nudge in the hub footer.
- Exports: Export stems (exists, Studio) · Export item (R17) · Collect & Pack (R19) ·
  Song Bundle (R20) · Backup zip (exists; R20 extends coverage).
- The hub is THE surface: every import entry point lands there; no second import card.

## 4. Work & session persistence (robust saving, web-app style)

### 4.1 What must never be lost (and where it lives)
Working state (params · seq family · mod macros · takes META · prefs) → sessions IDB +
`.anvl`. Take AUDIO → live sample store only today (backup zip covers live slots; R20
extends). Imported library (samples/kits/refs/patterns) → av-samples-store (+wt/code
stores) — NOT covered by any backup today (R20 fixes). User modules, wt tables → their
own stores. Preferences → 26 LS keys (R20: fold into backup + optional import).

### 4.2 The three layers (industry mapping in §6)
- **L1 autosave (continuous):** default ON after first save (avoids surprise writes on a
  fresh boot); debounced (dirty-fingerprint gate already exists; EXTEND the fingerprint to
  include prefs so prefs-only changes count); flushes on `visibilitychange → hidden`
  (Chrome page-lifecycle guidance; IDB is the target — no async work in `beforeunload`;
  beforeunload is warning-only, present-or-absent by dirty state); keeps the existing
  single `__autosave` record + the session version ring; recovery offer stays non-auto.
- **L2 projects (explicit):** `.anvl` as built. Add: save-handle reuse (save repeats with
  no picker while permission holds), Save As, RECENT list (name, at, path name; handle
  stored → reopen attempt with `queryPermission` and one-click re-grant), optional
  boot template. Downloads remain the fallback everywhere FSA is absent.
- **L3 bundles (archival/share):** Song Bundle = `.avpack` (kind `song`) with
  `project.anvl` + referenced library items (hash-deduped) + user modules + wt tables +
  manifest of installed-pack refs (by id/sha — packs are re-installable from catalog).
  Importing a bundle: verify manifest → install items → open project → honest per-part
  report. Backup zip (av_backup) extends to the same coverage set (R20).

### 4.3 "For later use and referral"
Session browser v2: rows gain preview facts (engine kind · bars · takes count · updated),
tags (free text, ≤8), search + sort. Recent projects list (L2). Snapshot ring + per-
version RESTORE (exists). Boot recovery offer (exists). Share: existing S4 link/QR +
PNG cards; family bridges unchanged; cloud phase unchanged (links-only until P1 backend —
docs/05 §2.6 untouched by this doc).

### 4.4 Storage honesty
`persist()` after first durable write (probe: headless returns false — real-user
engagement may grant; never a promise, always best-effort). Meter (`estimate()`) in the
hub footer + the store card (exists there). Language: browser storage = cache; downloads/
Backup = vault; Safari's 7-day rule noted in help copy (installed PWA exempt).

### 4.5 Versioning & integrity
`.avpack` manifest v1 · library record v1 with ADDITIVE fields only (`ext` in R17;
`sha256`, `source`, `refs` in R18) — no DB version bump; receipts live in their own DB
`av-receipts-store` v1 (`runs` store, last-20 rotation) so `av-samples-store` is never
migrated. New stores are created-if-missing by their owning module (house pattern).

## 5. Integration plan (waves, ownership, gates)

Order rationale: fastest user-visible control first (hub + menus + receipts + manager),
then intelligence (dedupe/relink/folders), then the pack container (needs R18's hash
identity), then persistence depth (largest surface, benefits from everything before it).

- **R17 — IMPORT HUB v1.** Move card to Store zone (card trio + cockpit ZONEMAP
  together), File menu entries (Import sounds... / Import folder... / Library...; Link
  source folder... lands with R18), drop-anywhere routing, library manager v1
  (rename/multi-select/search/sort/filter/export item), receipts history (own DB
  `av-receipts-store` v1, `runs` store, last-20 rotation — `av-samples-store` untouched),
  storage meter + persist() call. New rig `verify/cdp_hub.mjs`; smoke additions; pins
  sweep; battery.
- **R18 — LIBRARY INTELLIGENCE (split 2026-10-09: R18a + R18b).** R18a (contract
  `verify/_r18_wave.md`, NOW): sha256 identity on import + provenance `source` +
  NON-BLOCKING dedupe (flag + replace + delete-as-skip; docs/12 §3.2 amended) + missing-content
  detection + relink v1 (rename-based). Rig legs: dedupe flag/replace witnesses; missing +
  relink witnesses (in cdp_hub). R18b (next): linked source folders (`av-sources-store`,
  link/rescan/diff/reconnect, FSA seam) + PWA `file_handlers` widening (conditional on the
  launchQueue probe — §7.4); rig legs: folder diff from a synthesized tree.
- **R19 — USER PACKS.** `verify/avpack_schema.mjs` + export (Collect & Pack) + import
  route (kind `avpack` under the bundle pre-pass) + CLI verifier + docs/09-adjacent doc
  line. Rig legs: pack round-trip (export → wipe → import → byte-equal re-export).
- **R20 — WORK PERSISTENCE.** Autosave default-on + visibilitychange flush + fingerprint
  fix; save-handle reuse + Save As + RECENT (+ boot template); session browser v2
  (previews/tags/search); Song Bundle (kind `song`) + backup coverage extension for
  av-samples-store/av-wt-store/av-code-store/LS prefs. Rig legs: recovery witness (kill
  mid-dirty → offer → restore), recents reopen, bundle round-trip.

Each wave: contract at `verify/_r17|_r18|_r19|_r20_wave.md` (R17 staged NOW), children
author page-side modules only, parent integration as the counted-assert script, build →
smoke → pins sweep → battery + bench → deploy → live pass → addendum. No engine/worklet
work in any of these — worklet `b65160e0` must stay untouched (page-side waves).

## 6. Industry-standard cross-reference (what we copy, from whom)

| Mechanism | Industry source (links in cache/r17/research-industry.md) | Anvil adoption |
|---|---|---|
| Persistent browser panel + user-added folders + drag-drop + OS-open | Ableton Browser/Places; FL Browser; REAPER Media Explorer | D2 hub + D3 paths + §3.4 folders |
| Explicit Refresh/Scan instead of watchers | FL "Refresh content"; REAPER scan; Bitwig locations | §3.4 RE-SCAN + lastModified diff |
| Missing-file list + manual relink (never silent) | Ableton File Manager; Studio One Pool | §3.5 |
| Content-hash identity + dedupe | (Anvil-ahead: store sha256 law) | §3.2/P4 — R18 |
| Collect All and Save / pack container | Ableton .alp; SFZ/Decent Sampler relative folders; DS minVersion | D7 `.avpack` + R20 Song Bundle |
| Auto-backup ring + Revert to | Logic (≤10 backups/alternative, alternatives) | §4.2 L1 ring (16) + RESTORE |
| Crash recovery offer | FL Backup folder; Ableton Crash folder + undo file | existing recovery offer; R20 default-on |
| Save / Save As / Save a Copy / templates | Ableton save semantics | R20 recents/handles/template |
| BWF/iXML/acid/ID3 metadata reads | EBU 3285; iXML; ACIDized WAV; id3.org | R18 stretch: auto-tags for tempo/root (clean-room chunk reads; never rewrite files) |
| UCS naming (suggestions only) | universalcategorysystem.com | offer-as-suggestion only (playbook note) |
| FSA handle persistence + re-grant flow | web.dev FSA; MDN | §3.4 reconnect |
| IDB eviction + persist() + meter | MDN quotas; web.dev persistent storage | §4.4 |
| file_handlers / launchQueue | web.dev PWA file handling | D3 widening |
| OPFS for heavy blobs | web.dev OPFS | DEFERRED — file:// SecurityError (probe), IDB suffices |
| Local-first spine | Ink & Switch essay | P7 (already the house law) |

## 7. Options needing verification (before the things they gate)

1. **FSA pickers on `file://`** — API present, gesture-gated (probe); a real click test
   decides whether the file:// single-file promise keeps working pickers (gates §3.4 UX
   copy + fallbacks; the download fallback is always there).
2. **`persist()` grant behavior** on engagement — probe; UX must not promise grants.
3. **IDB record-size ceilings** for large single writes (samples up to 96 MiB) —
   benchmark at real sizes before R17 ships the export path.
4. **`.zip` in the widened PWA accept list** — confirm launchQueue arrives with a usable
   name + arrayBuffer (extension-only walker) or drop .zip from the accept list.
5. **Multi-tab contention** — two tabs sharing `av-sources-store` handles + autosave
   writes: probe, then a "another tab is saving" note or last-write-wins doc note (R20).
6. **Bundle ceilings** — a full Song Bundle zip size/time on a fat library; keep caps
   honest (16 MiB .anvl cap stays; bundle items individually capped at 96 MiB).
7. **BWF/iXML/acid chunk reads** (R18 stretch) — clean-room feasibility on the existing
   WAV reader; decide by fixture evidence, not by promise.

## 8. Laws added by this doc (never drift)

- One funnel: every imported byte enters via `avImportFiles`; every entry point lands in
  the hub card; no second import surface, no silent side doors.
- The hub lives in the STORE zone; consumers live where they consume.
- Lossless-or-labeled; refusals name the fallback; receipts persist.
- One schema module per format family, imported by writer + reader + verifier.
- Content hash is identity (R18+); names are for humans, hashes are for machines.
- Browser storage is a cache; export/backup is the vault; persist() is best-effort.
- No watchers on the web: link + re-scan + diff.
- Every wave keeps worklet `b65160e0` untouched unless a wave says otherwise.
