# R15b wave — SAMPLE PACKS: import card + sniffer + canonical bundle + local library (contract)

State at open: R14 shipped live (`baf50ba0`, 3,525,599 B; sw `b5aa5f2f`). R15a recon committed
(`e5ff8d7`): findings `research/import/01-03`, decisions `docs/11-sample-import.md` — the plan of
record; READ IT before authoring: it defines the per-format verdicts this contract implements.
Numbers: smoke **60** · pins **20 files** · battery **23 suites** · cockpit card map **23/23** ·
worklet sha **d7f0ee41**.

SCOPE NOTE: page-side only — the AudioWorklet concat does NOT change; the worklet sha must still
read `d7f0ee41` after the rebuild (nothing here touches av_dsp/av_sampler/av_drum/av_grain or any
engine module).

## 0. Deliverable

The owner ask (docs/11): users drop their own sample-pack content into Anvil and use it throughout.
This wave ships V1:

- **The SAMPLE PACKS card** (`#av-import`, synth zone) — drop a folder or files; a recognition
  report per file (recognised format, result, honest reason); a local library list with assignment
  actions.
- **Magic-byte sniffer + canonical bundle** — `src/av_import.js`.
- **Clean-room AIFF/AIFF-C reader** — `src/av_aiff.js` (browsers do not decode AIFF; probed).
- **MIDI as patterns** — SMF parser already ships (`av_mid.js`: `avMidParse` L534 · `avMidToPattern`
  L609; both currently have NO consumers — this wave wires them).
- **Local IndexedDB library** — `src/av_lib.js` (mirrors the `av_store.js` never-throw plumbing;
  ANYTHING here is local; nothing uploads).
- **BUDGET ITEM: REX2 decode** — `src/av_rex.js` (Unlicense spec + test vectors; recon says
  500-900 LOC, no WASM). Landing is additive: if it does not land clean the pipeline reports
  `.rx2 — decoder pending` honestly and the wave ships without it. Do not let it gate.

NOT in scope (report honestly, do not build): zip import (defer with a pointer — unzip first),
EXS/Serum/ADG/ALS/NKI/NBKT/SXT content extraction (R15c), any network path, drum-pad kits (chop's
job — the card feeds it), grain (reads engine slots; SEND TO SLOT covers it).

## 1. File ownership

- CHILD A: `src/av_aiff.js` — SOLE writer.
- CHILD B: `src/av_rex.js` — SOLE writer (budget item).
- CHILD C: `src/av_import.js` — SOLE writer (core: sniffer + policy + pipeline + bundle).
- CHILD D: `src/av_lib.js` — SOLE writer (IDB library).
- CHILD E: `src/av_import_ui.js` — SOLE writer (the card).
- PARENT: `build.py` (js_parts append — THE ORDER TRAP) · `src/body.html` (card block) ·
  `src/av_rail.js` (synth group) · `src/av_chrome.js` (AV_CHROME_CARDS) · `src/app_core.js`
  (init + boot log) · `src/styles.css` (R15b block, authored from E's class inventory) ·
  `verify/cdp_smoke.mjs` (+3) · `verify/cdp_cockpit.mjs` (24/24) · NEW `verify/cdp_import.mjs` ·
  pins sweep · commits · deploy. NO other files.

Child laws: ONE file each; complete file to disk FIRST, then iterate (partial progress must exist
on disk at all times); `"use strict"`; ASCII-only source; never throws (every entry point returns
false / a receipt / an honest error string); DOM-free top level (parse-safe); unique top-level
names (the strict node --check of the concatenation catches duplicates); block-comment prose must
not contain `*/`; `node --check src/<your file>.js` allowed; NO build, NO browsers, NO verify
suites, NO git, NO other files. Children A and B additionally get the scratch-harness allowance
(§6.4).

## 2. The canonical bundle — SHARED SPEC (C, D and E follow VERBATIM)

`avImportFiles(files, opts)` resolves a receipt (never rejects):

    receipt = {
      ok: boolean,            // true when at least one item landed (imported)
      title: string,          // run title (opts.title or "import" + date suffix), cap 80
      at: number,             // Date.now()
      version: string,        // "r15b.0"
      items: [ item ],        // one per input file, input order
      counts: { total, imported, deferred, refused, samples, patterns },  // all numbers
      errors: [ string ],     // pipeline-level errors only (per-file issues live in item.reason)
    }

    item = {
      key: string,            // "i1", "i2", ... in run order
      name: string,           // display name (path leaf), cap 120
      path: string,           // f.webkitRelativePath || f.name, cap 200
      ext: string,            // lowercase, no dot, "" when none
      format: string,         // sniffer id (§3)
      kind: string,           // "sample" | "pattern" | "refused"
      result: string,         // "imported" | "deferred" | "refused"
      reason: string,         // "" when imported; else the honest canonical line (§3 table)
      size: number,           // bytes
      sibling: string,        // "" or the same-stem sibling filename found in the set (sample fmt)
      id: string,             // library record id once persisted ("" when not persisted)
      meta: object,           // format meta: sample {rate, channels, frames?, bits?};
                              // pattern {ppq, bpm, trackCount, noteCount}; rex2 {slices, rate,
                              // frames, tempo, bits}; else {}
    }

Constants: `AV_IMPORT_VERSION = "r15b.0"` · sniff reads the FIRST 64 BYTES ONLY (file.slice(0,64))
· full bytes read only when the policy will persist AND size <= `AV_IMPORT_ITEM_MAX` (96 MiB;
larger files: result "refused", reason `"too large — 96 MB cap"`, no read) · a run processes at
most `AV_IMPORT_MAX_FILES = 600` (the rest reported via errors: `"N file(s) beyond the 600-file
cap skipped"`).

## 3. Sniffer vocabulary + format policy (pin EXACT)

`avImportSniff(u8)` -> `{ format: string, note: string }`. Recognition (checked in this order;
first hit wins; ext = lowercase extension no dot):

| format | rule |
|---|---|
| wav | bytes 0-3 "RIFF" && 8-11 "WAVE" |
| mp3 | 0-2 "ID3" || (b0 0xFF && (b1 & 0xE0) === 0xE0) |
| aiff | 0-3 "FORM" && 8-11 "AIFF" or "AIFC" |
| mid | 0-3 "MThd" |
| rex2 | 0-3 "CAT " && 8-11 "REX2" |
| serum | 0-7 "XferJson" || ext "fxp" / "serumpreset" |
| zip | 0-3 "PK" + 0x03 0x04 |
| adg / als | ext "adg" / "als" (gzip 1f8b corroborates, note when absent) |
| gzip | 0-1 1f 8b (no adg/als ext) |
| wt | ext "wt" |
| exs / nki / nbkt / sxt / kong / mxgrp | ext match |
| unknown | otherwise |

Policy table (kind / result / canonical reason — reasons are the contract, keep them verbatim):

| format | kind | result | reason (exact or prefix-pinned) |
|---|---|---|---|
| wav, mp3, aiff | sample | imported | "" — meta: wav via `avWavInfo(bytes)`; aiff via `AVAIFF.probe(u8)`; mp3 meta {} |
| mid | pattern | imported | "" — meta via `avMidParse(u8)` (ppq/bpm/trackCount/noteCount) |
| rex2 | sample | imported when `typeof AVRex === "object"` && `AVRex.probe` ok; else "deferred", reason `".rx2 — decoder pending (this build)"`. probe meta {slices, rate, frames, tempo, bits}. Unsupported depth (8-bit/32f) per probe: "deferred", reason `".rx2 — bit depth not decodable; a sibling WAV imports as audio"` |
| wt | | "deferred" | `"wavetable — import it in the Wavetable editor (WT IMPORT)"` |
| adg, als | | "deferred" | `"Ableton project — reference extraction lands in R15c; drop the pack's audio folder instead"` |
| exs | | "deferred" | `"EXS24 (binary) — adapter planned (R15c); the pack's WAVs/AIFFs import now"` |
| nki, nbkt | | "deferred" | `"Kontakt/Battery library — partial extraction planned (V2); import the Samples folder"` |
| sxt | | "deferred" | `"Reason NN-XT patch — reference extraction planned (V2)"` |
| kong | | "refused" | `"Reason Kong kit — kit mapping is not readable; import the pack's WAVs"` |
| mxgrp | | "refused" | `"NI Maschine group — not readable; import the pack's WAVs"` |
| serum | | "deferred" | `"Serum preset — wavetable import lands in R15c"` |
| zip | | "deferred" | `"zip — unzip and drop the folder (zip import lands later)"` |
| gzip, unknown | | "refused" | `"unrecognized format"` |

kinds: only wav/mp3/aiff/rex2/mid are "sample"/"pattern"; every other format: kind `"refused"`
(its result still distinguishes deferred vs refused). Sibling rule: for each item, `sibling` = a
same-stem (case-insensitive, ext-stripped) sibling IN THE SET that itself sniffs as wav/mp3/aiff;
"" otherwise. Do not alter reasons; the UI renders the sibling chip.

Structure: `avImportFiles(files, opts)` — per-file try/catch (one bad file never sinks the batch);
opts `{title?, persist?}` persist default TRUE; when persist, each imported item is written via
`avLibAddItem` (typeof-guarded; when av_lib is absent the item's `id` stays "" and the receipt
still counts it — receipt.char note: counts unchanged).

## 4. Module pins

### 4.1 `src/av_aiff.js` (child A) — clean-room AIFF/AIFF-C PCM reader

Top-level names: `AV_AIFF_VERSION` ("r15b.0") · `AVAIFF` (const object). API:

- `AVAIFF.probe(u8OrArrayBuffer)` -> `{ok, channels, sampleRate, frames, bits, compression, error?}`
  — COMM-only header parse; never throws.
- `AVAIFF.decode(u8OrArrayBuffer)` -> `{ok, channels, sampleRate, frames, bits, float, ch1, ch2,
  warnings, error?}` — ch1 = Float32Array (mono or left), ch2 = Float32Array | null; full PCM
  decode.
- Rules: FORM/AIFF (+AIFC) walker; COMM (80-bit extended sample rate — implement the ext-float
  reader); SSND (offset + blockSize honored); big-endian PCM 8/16/24/32-bit int; AIFC
  compressionType "NONE"/"twos" (BE) / "sowt" (LE 16-bit); float "fl32" supported; anything else
  (incl. "fl64") -> `{ok:false, error:"unsupported compression <type>"}`; never guesses. Decode
  to normalized float (-1..1; divide by 2^(bits-1)); mono -> ch1 only. Warnings array for odd
  chunks. Read `research/import/03-serum-exs-native.md` for the AIFF facts recorded there; the
  reader is authored from the public AIFF spec (clean-room).

### 4.2 `src/av_rex.js` (child B, BUDGET) — REX2 (.rx2) decode

Top-level names: `AV_REX_VERSION` ("r15b.0") · `AVRex` (const object):

- `AVRex.probe(u8)` -> `{ok, slices, rate, frames, bits, channels, tempo, bars, error?}` — IFF
  walker to HEAD/GLOB/SINF/SLCE counts; no DWOP decode.
- `AVRex.decode(u8)` -> `{ok, rate, frames, channels, bits, ch1, ch2, slices:[{start,len}], tempo,
  warnings, error?}` — full DWOP decode to normalized Float32 planar; slices = frame ranges.
- Spec: `research/import/02-ni-rex2.md` §2.1 (VelociLoops docs/format.md — Unlicense; the C source
  may be consulted/ported freely, keep the shipped file self-authored, clean-room spirit; NEVER
  bundle the proprietary REX SDK). 8-bit / 32f depths: probe ok + decode `{ok:false, error}` (the
  pipeline degrades to the sibling-WAV note). Test vectors: fetch the public fixture/spec into
  your scratch dir for verification only — nothing from it ships.
- Hard requirement: write the complete file FIRST, then iterate against the scratch harness (§6.4)
  — report the decoded anchor numbers (frame 322 / first-word checks from the spec when the
  fixture is reachable; else the harness asserts structure + slices + a self-consistency pass).

### 4.3 `src/av_import.js` (child C) — the core

Top-level names: `AV_IMPORT_VERSION`, `AV_IMPORT_ITEM_MAX`, `AV_IMPORT_MAX_FILES`, `AV_IMPORT_POLICY`
(table const), `avImportSniff(u8)`, `avImportFiles(files, opts)`, plus internal avImport* helpers.
Follows §2/§3 VERBATIM. Hardening: `files` may be an Array, a FileList, or any iterable of
File-likes; per-file: sniff (first 64 bytes) -> policy -> (persist? full read + avLibAddItem
guarded) -> item record. `avImportFiles` NEVER rejects; a totally empty input -> receipt ok:false,
errors ["no files"]. For samples: full decode does NOT happen at import time — decode happens at
library LOAD (av_lib); import meta comes from the cheap header probes (avWavInfo / AVAIFF.probe /
avMidParse / AVRex.probe). Reuse `avWavInfo` from av_wavio.js — do NOT re-implement WAV headers.
`avMidParse` takes bytes (it converts via avMidToU8 — ArrayBuffer ok). All cross-module calls
typeof-guarded PER CALL. Style reference: av_store.js L293-361 (never-throw promise plumbing).

### 4.4 `src/av_lib.js` (child D) — the local library (IDB)

Top-level names: `AV_LIB_VERSION` ("r15b.0") · `AV_LIB_DB` ("av-samples-store") ·
`AV_LIB_DB_VER` (1) · `AV_LIB_OS` ("items") · `AV_LIB_LS` ("av-samples-ls") ·
`AV_LIB_ITEM_MAX` (96 MiB) · `AV_LIB_OPEN_CAP_MS` (1800) · `avLibInit()`, `avLibAddItem(item)`,
`avLibList()`, `avLibGet(id)`, `avLibRemove(id)`, `avLibLoad(id)`, `avLibStatus()`.

- Record: `{ id, v: 1, name, kind, format, size, at, meta, bytes (ArrayBuffer), via }`.
  id = "l" + Date.now().toString(36) + "-" + slug(name) (slug: [a-z0-9-], cap 40).
- Plumbing: mirror av_store.js L293-361 (promise-wrapped, open-cap give-up, one late adoption
  attempt, db.onclose reset). Backends `"idb" | "ls" | "mem"` (reportable); LS fallback stores
  base64, refuses items > 1.5 MiB with reason "too large for the localStorage fallback"; `mem` =
  session-only with an honest note. Quota: on write failure -> receipt `{ok:false, error}` —
  never throws.
- `avLibAddItem(item)` -> Promise `{ok, id, backend, error?}`. Normalizes + persists (skips
  items with result != "imported").
- `avLibList()` -> Promise `{ok, backend, count, bytes, items:[{id, name, kind, format, size, at,
  meta}]}` — newest-first; NO raw bytes in list.
- `avLibGet(id)` -> Promise `{ok, item?, error?}` (with bytes).
- `avLibRemove(id)` -> Promise `{ok, error?}`.
- `avLibLoad(id)` -> Promise `{ok, id, kind, entryId?, pattern?, error?}` (never rejects):
  - kind "sample": ROUTE BY FORMAT — wav/mp3: bytes -> `new File([bytes], name)` ->
    `avSampleImportFiles([file])` (typeof-guarded; it owns cap accounting + the native decode);
    identify the new session entry by diffing `avSampleStore.entries` ids before/after.
    aiff: `AVAIFF.decode(bytes)`; rex2: `AVRex.decode(bytes)` -> planar Float32 — for these build
    the AudioBuffer page-side (`avSampleStore.pickCtx()` -> `createBuffer` + `copyToChannel`)
    behind the SESSION CAP GUARD (`avSampleStore.entries.length + avSampleStore.pending >=
    avSampleStore.max` -> honest `{ok:false, error:"session sample cap reached"}`), then
    `avSampleStore.makeEntry(name, buf)` + `avSampleStore.add(entry)` (all typeof-guarded).
    Receipt carries `entryId`; failures: decode error text or "no sample module".
  - kind "pattern": `avMidParse(bytes)` -> `avMidToPattern(parsed, {name: item.name})` ->
    `avSeqLoad(pattern)` -> then the avBankSeqApply flow: `avSeqSnap()` -> `avSeqSetPattern(norm)`
    (feed the scheduler; avSeqLoad alone only updates the core model) -> `avSeqUiSync()` (repaint
    nicety) -> THEN `avUndoPush("seq", "import")` (all typeof-guarded; the undo law is
    push-AFTER-load). Receipt carries `pattern` = {name, bpm, notes} summary.
- `avLibStatus()` -> `{version, inited, backend, count, bytes, dbName, error}` sync snapshot.
- `window.__avLib` = facade `{version, status, list, get, load, remove, add}` (functions; suites
  drive this). `avLibInit()` idempotent, returns bool; starts an async hydrate (list cache for
  status), safe when IDB is unavailable.

### 4.5 `src/av_import_ui.js` (child E) — the SAMPLE PACKS card

`avImportUiInit()`, `avImportUiSnap()`, `avImportUiProof()`, `avImportUiImport(files, opts)`,
`avImportUiRefreshLib()`, plus internal avImportUi* helpers. Mounts into the parent-owned
`<div id="av-import-host">` (host absent -> return false, no throw; idempotent via host.dataset).

DOM ids/attrs (exact — suites pin these):
- `[data-av-import-drop]` drop zone (role=button, tabindex, click/Enter/Space open the picker;
  same document-wide dragover/drop claim-once as av_sample.js L301-310) · `#av-import-file`
  (hidden input multiple, accept audio + .mid + .rx2 + .exs + .nki ...) · `#av-import-dir`
  (hidden input, webkitdirectory) · `#av-import-pick` / `#av-import-pickdir` buttons ·
  `#av-import-status` · `#av-import-counts` · `#av-import-report` (rows `[data-av-import-row]`,
  cells: name · format · result chip · reason) · `#av-import-lib` (rows
  `[data-av-import-lib="<id>"]`) · `#av-import-slot` (select 1..4) · `#av-import-empty` ·
  `#av-import-note` (the "nothing uploads" line) · state class `dragover` on the host while a
  drag is over it.
- Folder support: drop via `dataTransfer.items` + `webkitGetAsEntry()` directory traversal
  (recursive, depth cap 8, file cap AV_IMPORT_MAX_FILES); the hidden webkitdirectory input as the
  click path; plain multiple file input too. Resolved to a flat File list -> `avImportUiImport`.
- Library rows actions: `[data-av-import-act="load|send|chop|seq|del"]` + `data-id`. Behavior (all
  typeof-guarded, all results into the status line):
  - load -> avLibLoad(id)
  - send -> avLibLoad(id) then `avSampleSendToEngine(receipt.entryId, slot-1)` (slot from
    #av-import-slot, 1..4)
  - chop -> avLibLoad(id); then best-effort: `avChopUiPaintSrc(document.getElementById("av-chop-host"), true)`
    when that function exists, set `#av-chop-src` value = entryId + dispatch a bubbling 'change';
    then `window.__avZoneAuto("#av-chop")` when it exists
  - seq -> avLibLoad(id) (pattern kinds; hidden/disabled for samples)
  - del -> avLibRemove(id) + refresh
- After every import run / action: repaint report + library + counts; status line carries the
  run summary ("imported N · deferred N · refused N · X MB -> library", first refusal reason when
  any). BUSY guard like av_files_ui (one run at a time; a second request refuses honestly).
- Facade: `window.__avImport` = `{version: "r15b.0", init: avImportUiInit, snap: avImportUiSnap,
  importFiles: avImportUiImport, refresh: avImportUiRefreshLib, classes: fn}`. Snap: `{inited,
  host, version, busy, last: (last receipt summary {title, at, counts} | null), report: items
  array (JSON-safe), lib: {count, bytes, backend}, lastError}`.
- Proof: mirror av_lfo.js L255-275 EXACTLY in shape — at init, gated on the `?avtest=1` check
  av_lfo uses, deferred `setTimeout(..., 0)`, `avTestLine(avImportUiProof(), "av-importtest")`.
  `avImportUiProof()` returns "IMPORT SELFTEST " + JSON.stringify({version, inited, libCount,
  sniff: avImportSniff result for a fixed 12-byte RIFF+WAVE fixture -> "wav"}).
- Header comment MUST carry: constants, the DOM contract, the exact CSS class inventory the card
  needs (parent authors styles.css from it — copy the av_pads.js header style). CSS classes needed
  (reference list, E may extend and MUST enumerate): av-import-drop, av-import-dropmsg,
  av-import-file, av-import-btns, av-import-status, av-import-err, av-import-counts,
  av-import-report, av-import-row, av-import-chip, av-import-lib, av-import-item, av-import-acts,
  av-import-slot, av-import-empty, av-import-note.
- Card copy (natural voice; keep): drop text "DROP A SAMPLE PACK HERE — a folder or files · WAV ·
  MP3 · AIFF · MIDI · REX2"; note "Imports land in your local library — nothing is uploaded."

## 5. Parent edits (counted-assert `cache/r1/int_r15b.py`; --anchors DRY mode; all-or-nothing)

1. `build.py` — js_parts: insert after the `av_chop_ui.js` entry, in order: av_aiff.js, av_rex.js,
   av_lib.js, av_import.js, av_import_ui.js (comments: `# R15b: AIFF clean-room reader (page
   module)` etc.). Order trap: an unlisted file silently never ships.
2. `src/body.html` — the `#av-import` card section between `#av-chop` and `#av-wt` (match the
   exact surrounding block pattern; host div + note copy from E's header).
3. `src/av_rail.js` — synth group: insert `["av-import", "Sample packs"]` between `["av-chop",
   "Chop"]` and `["av-wt", "Wavetable editor"]`.
4. `src/av_chrome.js` — AV_CHROME_CARDS: insert `{ id: "av-import", init: true, rnd: false },`
   after the av-chop entry.
5. `src/app_core.js` — after the rec-init line: `let importOk = false; try { importOk = (typeof
   avImportUiInit === "function") ? (avImportUiInit() !== false) : false; } catch (e) {
   console.warn("[anvil] import card init failed", e); }` — plus the boot log gains
   `" import=" + importOk` after `" rec=" + recOk`.
6. `src/styles.css` — append the R15b block from E's class inventory.
7. `verify/cdp_smoke.mjs` — 3 checks (60 -> 63), inserted BEFORE the `/* 6cd. R12: the proof
   gate` block:
   - `6ci` card: `#av-import` in the synth zone; ids av-import-drop/-file/-dir/-status/-report/
     -lib/-slot present; facade functions; report empty-state renders; counts line present.
   - `6cj` pipeline: synthesize 4 Files in-page — a WAV (`avWavEncode` with a sine, check its
     opts in source), a minimal AIFF (hand-built bytes: FORM/AIFF + COMM with 80-bit ext 8000 Hz
     + SSND 16-bit) , a minimal SMF (hand-built MThd/MTrk byte array), and `x.exs` garbage — then
     `await avImportFiles(files)` -> counts {total 4, imported 3, deferred 1, refused 0, samples
     2, patterns 1}; item formats wav/aiff/mid/exs; the exs result "deferred" with reason starting
     "EXS24"; every imported item has id != "" (persisted). Fixture facts (source-confirmed):
     avWavEncode opts {l, r, sr, bits, dither}; AIFF = FORM/AIFF + COMM (ext-80 8000 Hz, 16-bit,
     8 frames) + SSND; SMF = hand-built MThd (format 0, PPQ 480) + one c4 note.
   - `6ck` library: `avLibLoad` the AIFF item -> session entry appears (frames === 8, sampleRate
     8000 — the AVAIFF decode witness); `avLibLoad` the MID item -> `avSeqSnap()` carries >= 1
     note + `window.__avUndo.label === "import"` (the push-after-load witness); `avLibRemove` the
     two persisted items -> list count back down by 2; the loaded session entry + pattern stay
     (fresh page each run — the proof-gate leg reloads anyway).
   Counts must read EXACTLY 63/63 (first-run).
8. `verify/cdp_cockpit.mjs` — ZONEMAP synth array gains `'av-import'`; label `(23/23)` ->
   `(24/24)`; `mp.n === 23` -> `mp.n === 24`.
9. NEW `verify/cdp_import.mjs` (parent authors; launch block copied from cdp_smoke/cdp_m2 laws;
   EXPECT_SHA pinned null until the parent pins the frozen build). ~15 checks:
   - real FileInput path: write temp fixtures to cache/r15b/rig-fixtures/ (a real WAV via python
     or node, a real .exs stub, a .rx2 if a fixture is present) -> CDP `DOM.setFileInputFiles` on
     `#av-import-file` -> report rows + counts + honest reasons.
   - persistence across reload: import -> `Page.reload` -> library still lists the items
     (IndexedDB), report resets (fresh page), counts honest.
   - load->session: avLibLoad -> entry; send->slot: `avSampleStore.sent[slot]` record + engine
     sampleSlot witness if cheap; chop wiring: `#av-chop-src` gains the option + select value
     after the chop action.
   - facade + proof gate: `window.__avImport.snap()` shape; plain-page leak leg NOTE: the R12
     proof-gate leg in cdp_smoke already covers the plain page; the rig asserts the avtest proof
     line parses (`IMPORT SELFTEST`).
   - zero page errors leg.
10. Pins sweep (`cache/r1/sweep_r15b.py` from sweep_r14.py): OLD `baf50ba0...` full 64-hex -> new;
    EXPECT_FILES 20 -> 21 (cdp_import added).

## 6. Gates + evidence

6.1 Standard order: build -> smoke 63 first-run -> pins 21 sweep -> battery **24 suites** (23 +
cdp_import) + bench (knee monotone; worklet sha d7f0ee41 UNCHANGED — if it moved, STOP) ->
records commit -> deploy `index.html` + `sw.js` (`python3 upload-site.py --only anvil/index.html
anvil/sw.js`) -> scoped `--verify` = 0 -> live pass (leak probe 11/11 via cache/r12/leak_check_live.mjs;
live capture renders/r15b-live-import.png inspected — drop zone, report, library) -> addendum 51.

6.2 New-suite pins: cdp_import carries `EXPECT_SHA`; battery-set completeness = diff the suite
list against the R14 battery log before launching.

6.3 REX2 witness (child B + parent): scratch node harness under `cache/r15b/rex/` decodes the
public fixture (fetch fixtures to scratch; NEVER committed, nothing ships). Parent re-runs it
before landing. If no fixture is reachable, the record = the child's structural harness + spec
anchors, and the card copy stays "best-effort" — state it plainly in the addendum.

6.4 Scratch-harness allowance (children A and B ONLY): unit harnesses under
`cache/r15b/<name>/` (untracked) run with plain node against YOUR OWN file (load its text into a
node Function scope — the cache/r1/r9_pitch_node.mjs pattern — pass synthetic bytes in, assert
PCM out). Downloading the public spec/fixture into that scratch dir for verification is allowed;
nothing from it ships. No other tooling.

## 7. Watch-outs

- The FULL-64-hex pin sweep — never prefix-shorten.
- Card completeness trio (body.html + AV_CHROME_CARDS + AV_RAIL_GROUPS) must land together —
  smoke's card-set check enforces.
- av_chop_ui.js L1488/1514 repaint cadence: after driving `#av-chop-src` from the import card,
  re-check during integration that the option list actually refreshed (if PaintSrc's private host
  query fights us, fall back to: select the option if present, else honestly say "run DETECT in
  the chop card" — never fake the select state).
- The R12 proof law: proof gated `?avtest=1` + deferred setTimeout, in the MODULE (mirror av_lfo).
- `avSavePacks` class of stale references: child modules must not call each other at PARSE time —
  only inside functions.
- `avKnobRowHTML` class of API drift: not used this wave (no knobs on the card) — if E adds any
  control, verify the helper against source first.
- Machine etiquette: hidden spawns only; one writer per file; commit with explicit paths (cache/
  stays untracked).

## 8. Report shapes (per child, prose)

A/B: file path · exact new top-level names · node --check result · harness result numbers (anchors
/ structural assertions) · open items.
C/D/E: file path · exact new top-level names · DOM ids added (E) · class inventory (E) · node
--check result · open items.
