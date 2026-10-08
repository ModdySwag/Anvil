# R21 wave contract — IMPORT & LIBRARY redesign (library overlay + card slimming)

Owner ask (2026-10-09, recorded verbatim-intent in CONTINUATION OWNER ASK): full access to ALL
loaded files but a STREAMLINED surface — the hub card renders every library row inline and gets
cluttered; wants a SEPARATE FULL INTERACTIVE MODULE for user file interaction, clean and
uncluttered. Full build permission; decisions at agent discretion.

State at open (2026-10-09, HEAD db0ca56 = the R19 close): frozen/live `095b7e5d` (4,179,606 B;
sw `958f6524`); smoke 77 · hub 42 · platform 52 · import 24 · battery 25 + bench ALL GREEN;
pins 22 (full 64-hex, all at 095b7e5d); worklet `b65160e0` (UNTOUCHED this wave — page-side only).

## 1. The move (what R21 is)

1. The hub card (`#av-import`, store zone) SLIMS: drop zone + pickers + status + report + receipts
   (as-is) + a NEW compact library summary strip (counts + OPEN LIBRARY) + LINKED SOURCES + storage
   footer. The inline full manager/list LEAVES the card — that is the clutter source.
2. NEW `src/av_library_ui.js`: a full-surface LIBRARY overlay (sibling of the About popover):
   opens from the hub strip button, the File > Library... item and the command palette; Esc-close;
   away-click-close; search-first (focus lands in the search box).
3. The library MANAGER SUBSYSTEM stays physically in `src/av_import_ui.js` (it is deeply wired to
   the module's state/actions/wiring) and gains a MOUNT API: the overlay hosts it. The manager
   gains R21 UX: format + pack facet chips, incremental rendering (bounded rows + show more),
   a bulk action bar, and a per-item details inspector.
4. Every action still rides the EXISTING funnels (avLibLoad / avSampleSendToEngine / avChopUi* /
   avSeqLoad chain / export path / avLibRemove / collect & pack). No new core paths.

## 2. File ownership (one writer per file)

| # | file | work |
|---|------|------|
| A | `src/av_library_ui.js` (NEW) | the overlay shell module (§3) |
| B | `src/av_import_ui.js` (edits) | card slimming + manager mount + R21 manager UX (§4) |
| D1 | `verify/cdp_hub.mjs` (edits) | open-step updates + 7 new legs (§5) |
| D2 | `verify/cdp_smoke.mjs` + `verify/cdp_import.mjs` (edits) | smoke +1; import open-steps (§6) |
| P | parent (me) | styles block, build.py js_parts, app_core init+version, gates, pins, deploy |

Children NEVER run build.py / git / browsers / suites. `node --check` on the child's OWN file is
allowed (A/B: the src file; D1/D2: the rig files). Write the file to disk FIRST, then iterate.
If a pinned name/shape conflicts with the live source, the SOURCE wins — name the conflict in the
report, never silently diverge. ASCII-only file content; JS strings use the house \uXXXX escapes
for non-ASCII (read the neighbour modules for style). No `*/` inside block comments.

## 3. §A — `src/av_library_ui.js` (NEW; child A)

House conventions: `"use strict";` header comment block naming this contract; ONE namespace
(avLibraryUi* / AV_LIBRARY_UI_*); every cross-module call typeof-guarded PER CALL; no console
noise; no throw outward; write-on-change memo where cheap; a `avLibraryUiClasses()` array for the
styles pass; the file must load standalone (no top-level side effects beyond state init).

Consts: `AV_LIBRARY_UI_VERSION = "r21.0"`; `AV_LIBRARY_UI_ID = "av-library-pop"`.

DOM (built by JS in init, appended to document.body — NO body.html edit):
```
<div id="av-library-pop" class="av-library-pop" role="dialog" aria-label="Library" hidden>
  <div class="av-library-box">
    <div class="av-library-head">
      <span class="av-library-title">LIBRARY</span>
      <button id="av-library-close" class="av-btn mini av-library-close"
              aria-label="Close the library" title="close (Esc)">\u00d7</button>
    </div>
    <span class="av-library-status av-library-msg" id="av-library-status" role="status"
          aria-live="polite">library idle</span>
    <div class="av-library-body" id="av-library-body"></div>
  </div>
</div>
```
NO .av-card / .av-zone / .av-zone-box classes inside the overlay (keeps the cockpit card map and
the zone scans untouched). z-index: one step BELOW `#av-palette` (read its computed z from
styles.css and record the number in the report).

API (all -> bool unless noted; never throw; idempotent init):
- `avLibraryUiInit() -> bool` — build + append the DOM once (dataset flag on the root or state);
  wire: close-button click; document keydown Esc (capture TRUE — mirror av_panels.js
  `avAboutWireAway`: when open, Esc closes UNCONDITIONALLY, About-pattern); document pointerdown
  capture-away (close when the target is outside `.av-library-box` AND outside
  `#av-import-libopen`); register the palette command via guarded `avPaletteRegister`
  ({id:"lib.open", label:"Open library", group:"Library", hint:"Search, browse and manage your imported files",
  run: () => avLibraryUiOpen()}); call `avImportUiManagerMount(document.getElementById("av-library-body"))`
  if that fn exists (guarded). Return true when the root exists + is wired.
- `avLibraryUiOpen() -> bool` — ensure init; if already open return true; close the palette/help
  first (guarded avPaletteClose / avHelpClose — mutual exclusion); remember the current
  document.activeElement as the opener; un-hide (hidden=false, style.display=""); set state.open;
  fire `avImportUiRefreshLib()` (guarded, fire-and-forget); focus `#av-import-search` (fallback:
  the close button); `avA11yAnnounce("Library")` guarded.
- `avLibraryUiClose() -> bool` — hidden=true + display:none; state.open=false; restore focus to
  the opener when it is still connected (else blur nothing). Return true.
- `avLibraryUiToggle(force) -> bool` — the avAboutToggle shape (force boolean wins).
- `avLibraryUiIsOpen() -> bool`.
- `avLibraryUiNote(msg, kind) -> bool` — paint `#av-library-status` text + kind tint class
  (av-library-msg / av-library-err pattern like the card's status), memo'd; no-throw. Called BY
  av_import_ui's avImportUiSetStatus (see §4.3) and safe before the overlay exists.
- `avLibraryUiClasses() -> array of strings` — every class the module emits.
- Facade `window.__avLibrary = {version, init, open, close, toggle, isOpen, note}` — shape is a
  pinned test observable (smoke §6).

## 4. §B — `src/av_import_ui.js` (edits; child B)

NO version bump (`AV_IMPORT_UI_VERSION` STAYS "r15b.0" — smoke 6ci pins it; R17–R19 precedent).

4.1 CARD BODY (`avImportUiBodyHTML`): remove the `<div class="av-import-manager">...</div>` block,
the `av-import-libhead` div and the `<div class="av-import-lib" id="av-import-lib"></div>` from the
CARD. In their place (exact position: after `#av-import-runs-empty`, before the note) add the
summary strip:
```
'<div class="av-import-libsum-row">' +
'<span class="av-import-libsum av-dim" id="av-import-libsum">library idle</span>' +
'<button type="button" class="av-btn mini av-import-btn" id="av-import-libopen" title="open the full library - search, filter, bulk actions">OPEN LIBRARY</button>' +
'</div>' +
```
Strip text = the existing `avImportUiLibStatText()` (reuse; new write-memo key "libsum"); painted
wherever PaintLib/ApplyLib repaints (so imports/actions/deletes refresh it) + on PaintAll.

4.2 NEW `avImportUiManagerHTML()` — the moved manager markup EXACTLY as today (search `#av-import-search`,
sort `#av-import-sort`, kind chips `#av-import-filters` [data-f] all/sample/kit/refs/pattern,
`#av-import-selall`, `#av-import-delsel`, `#av-import-pack`, libhead with `#av-import-libstat` +
`#av-import-slot` + `#av-import-librefresh`, list `#av-import-lib`) PLUS (new, same .mini/.fchip
idioms):
- format chips group `<span class="av-import-facets" id="av-import-formats">` — chips
  `data-fmt="all|wav|mp3|aiff|rex2|mid|zip|other"`; "all" first, then the PRESENT formats in that
  fixed order (dynamic: only formats with >=1 item, plus always "other" when an unmapped ext
  exists). Values fold `avImportUiExtOf` lowercase into that set.
- pack chips group `<span class="av-import-facets" id="av-import-packs">` — chips
  `data-pack="all|__none|<id>"`; "all" first, then `__none` ("no pack", only when some item has no
  source.pack), then the distinct `source.pack` ids sorted, label `pack:<id>`. Cap 32 chips.
- bulk bar `<span class="av-import-bulk" id="av-import-bulk">` — five buttons
  `<button class="av-btn mini av-import-btn" data-av-import-bulk="load|send|chop|seq|export">`
  labelled `LOAD (N)` etc.; disabled whenever the selected count is 0 (same disabled law as
  #av-import-delsel/#av-import-pack); N = selected count, repainted in PaintManager.
- show-more `<button class="av-btn mini av-import-btn av-import-more" id="av-import-more" hidden>show more</button>`
  after the list.
- inspector `<div class="av-import-detail" id="av-import-detail" hidden></div>` last
  (inside it, when open: a `<button id="av-import-detail-close" class="av-btn mini">\u00d7</button>`
  + the fields below).

4.3 MOUNT + resolution:
- `avImportUiManagerMount(container) -> bool` — first CONNECTED mount wins: if state.mgrHost is
  set and connected -> return true (idempotent); if a DIFFERENT container is requested while a
  connected mount exists -> false; else store it, inject `avImportUiManagerHTML()` into it (only
  if it has no `.av-import-manager` yet), call `avImportUiWire(container)`, then repaint
  (PaintLib + PaintManager + libstat). Invalid container -> false.
- `avImportUiMgrEl() -> element|null` — state.mgrHost when connected, else null. EVERY manager
  DOM reach (search/sort/filters/formats/packs/selall/delsel/pack/bulk/libhead/libstat/slot/
  librefresh/lib/more/detail) resolves through manager-scoped queries against this element (or
  `document.getElementById` of the manager ids as the fallback when a host is absent). The
  existing `host` parameters of manager paint fns are kept for signature compat but do NOT change
  target resolution. Card-side paints (status/counts/report/runs/strip) keep using
  `avImportUiHost()`. NOTHING in the manager path may throw when the host is absent — honest
  no-op false.
- `avImportUiSetStatus(msg, kind)` gains ONE guarded tail call:
  `try { if (typeof avLibraryUiNote === "function") avLibraryUiNote(s.status, s.statusKind); } catch (e) {}`
  (overlay status mirror; keeps the card line too).

4.4 View + incremental (state.mgr extension; snap keys pinned):
- `state.mgr` gains `fmt:"all"`, `pack:"all"`, `limit:AV_IMPORT_UI_LIB_STEP`, `insp:""`.
  `AV_IMPORT_UI_LIB_STEP = 60` (new const; `AV_IMPORT_UI_LIB_ROWS_MAX` stays 400 = the append
  ceiling).
- `avImportUiViewItems()` = mirror items filtered by search AND kind AND fmt AND pack, then the
  existing sort. fmt = the folded ext value (all -> no-op); pack = "all" | "__none" (absent
  source.pack) | exact id. New setters `avImportUiSetFormat(f)` / `avImportUiSetPack(p)` (same
  shape as SetFilter; invalid -> "all"; RESET limit to STEP; MgrTouch).
- PaintLib paints `min(view.length, limit, ROWS_MAX)` rows. `#av-import-more` visible when
  `view.length > painted && painted < ROWS_MAX`; label `show more (P of M)`; click ->
  `avImportUiMore()` (limit += STEP, repaint; returns bool). Any view change (search/sort/kind/
  fmt/pack) resets limit to STEP. When ROWS_MAX items are painted and more remain, keep the
  existing honest "showing the first 400 of M items" note.
- Snap `avImportUiSnap().manager` gains `fmt`, `pack`, `limit`, `shown` (painted count), `insp`
  (existing keys kept).

4.5 Inspector:
- Row gains `<button ... data-av-import-act="info" ...>` (short label `i`, title "item details") —
  append-only, after EXP in the row action set.
- `avImportUiInspect(id) -> bool` — toggle state.mgr.insp (same id -> ""), repaint list + detail.
- `#av-import-detail` when open (escaped, av-mono/av-dim idioms): NAME, id, kind, format/ext,
  size (+human), added (locale date of `at` when present), source (from/path/folder/pack lines —
  only present fields), sha256 (full hex in title, first 16 visible; omit honestly when absent),
  dupOf (name/id), and meta (JSON.stringify pretty, bounded 2048 chars, in a pre/wrap block).
  `#av-import-detail-close` closes it (insp=""). All values from the mirror records only.

4.6 Bulk:
- `AV_IMPORT_UI_BULK_MAX = 50` (new const).
- `avImportUiBulk(act) -> bool` — acts: "load" | "send" | "chop" | "seq" | "export" (and "delete"
  routes to the EXISTING delete-selected path). Operates on the selected ids in mirror order,
  sequential: ONE busy op at a time through the existing busy law (a small internal queue that
  invokes the next id after the previous completes; status shows progress "bulk load 3/12 -
  name"). Selected > BULK_MAX -> honest refusal status, false. Missing/empty selection -> false.
- Bulk export = ONE zip: entry names = item names (sanitized; dedupe collisions with ("-2") style
  suffixes), bytes from `avLibGet(id)` (read its real record shape from av_lib.js — the payload
  field the export path uses), built with the real `avZipBuild` writer (mirror the exact call
  shape av_pack.js uses), downloaded through the same path the card's per-row EXP uses (the
  Blob -> arrayBuffer() law before avDeliverDownload). Any missing piece -> honest refusal status
  naming it. Filename `anvil-library-<N>.zip`.

4.7 Entry points:
- `avImportUiLibrary()` — KEEP its current behavior (store zone show + reveal + focus, true) and
  APPEND, guarded: `if (typeof avLibraryUiOpen === "function") avLibraryUiOpen();` — old
  semantics preserved (cdp_hub leg updates to assert both).
- `#av-import-libopen` click (the card's existing delegated handler): open the overlay via guarded
  avLibraryUiOpen(); when absent -> fallback to the store-jump + focus (honest degradation).
- `avImportUiClasses()` gains every new class (§4 additions).
- The delegated handlers (click/change/input) must keep working for elements inside the overlay:
  the overlay container is wired via avImportUiWire; do NOT rely on the card host containing the
  manager. Check every dispatcher branch that assumes `#av-import-*` targets are inside the card.

## 5. §D1 — `verify/cdp_hub.mjs` (edits; child D1)

Existing legs that drive the manager/rows/actions must run with the overlay OPEN (the user path —
not a hidden click): add ONE `await open overlay` step at the start of the manager section
(e.g. facade `window.__avLibrary.open()` then wait `#av-library-pop` not hidden; or the REAL strip
click — pick per leg and keep it minimal). Legs needing the open step include at least: manager
search / filter / sort / select-all / delete-selected / rename / export / dedupe / replace /
missing / relink / R19 round-trip + pack legs / row-action LOAD. The boot legs (ids intact) and
the reload legs keep their assertions (ids stay document-wide); a reload leg closes the overlay
implicitly (fresh page) — any leg after a reload that touches the manager needs its own open.

Update leg 7 (`library jump`): `avImportUiLibrary()` still returns true AND lands on the store
pane AND now ALSO opens the overlay (`#av-library-pop` not hidden) — extend the assertion; the
File > Library... menu path asserts the same.

SEVEN NEW legs (append where they fit; use the house check( ) + JSON detail idiom):
- N1 strip: `#av-import-libsum` text carries counts (parse "N item(s)") + clicking the REAL
  `#av-import-libopen` opens the overlay (not hidden) + document.activeElement is
  `#av-import-search` + containment: `#av-library-pop` contains `#av-import-search` and
  `#av-import-lib` (the manager now lives there).
- N2 close: Esc closes (hidden back) + focus returned to the strip button; facade
  `__avLibrary.isOpen()` false; open/close/toggle shapes true.
- N3 format facet: after the standard imports, chip `data-fmt="wav"` narrows to the wav count
  (and "all" restores); snap `manager.fmt` mirrors.
- N4 pack facet: after an R19 pack round-trip, a `data-pack="<packid>"` chip narrows to that
  pack's items; `__none` present when unpacked items exist.
- N5 incremental: synthesize ~65 tiny WAVs in-page (`avWavEncode({l, r, sr, bits, dither:false})`
  -> `new File([bytes], name)` -> the facade `__avImport.importFiles`), await the library count
  delta, then: overlay shows exactly 60 rows + `#av-import-more` label "show more (60 of N)";
  one click -> N rows + button hidden. CLEAN UP: delete the synthetic items afterwards (select +
  delete) so the zero-error leg + follow-ups stay pristine.
- N6 bulk: select 2 sample rows -> `[data-av-import-bulk="load"]` -> both load sequentially
  (session entries +2 / the sequence witness — mirror the existing row-action LOAD witness);
  button disabled at zero selection.
- N7 inspector: click a row's `[data-av-import-act="info"]` -> `#av-import-detail` visible with
  the item name + id + sha (when present) + source lines; `#av-import-detail-close` hides it.

Keep the freeze leg + zero-page-errors leg LAST as-is (parent re-sweeps EXPECT_SHA after the
wave freeze). Record the new total: hub 42 -> 49 expected; if a leg splits/merges, update the
recorded count in the report.

## 6. §D2 — `verify/cdp_smoke.mjs` + `verify/cdp_import.mjs` (edits; child D2)

smoke (+1, 77 -> 78): append ONE check after the R17 hub check (6cu), same ev() idiom:
`#av-library-pop` exists + `hidden === true` at boot + `#av-import-libsum` present +
`#av-import-libopen` present + containment (`#av-library-pop` contains `#av-import-lib` and
`#av-import-search`) + facade shape `window.__avLibrary` (open/close/toggle/isOpen/note functions,
version "r21.0"). Do NOT touch 6ci/6cu assertions (they only assert document-wide presence — the
moved ids still resolve).

cdp_import (edits only; keep the count at 24): every leg that clicks manager or row controls
(LOAD/SLOT SEND/CHOP/SEQ/LOAD-rx2/rename/dedupe etc.) must first OPEN the overlay
(`window.__avLibrary.open()` + wait visible is fine for setup) so the interaction runs on the real
surface; legs after a page reload get their own open. NO new checks; NO assertion loosening.

## 7. Watch-outs (all children)

- `.av-btn` = a fixed 26x26 icon box: every TEXT-labelled button needs `.mini` (or the scoped wide
  override). New buttons in §4 use `av-btn mini`.
- ASCII-only; `\uXXXX` escapes inside JS strings; no stray `*/` in block comments; trim trailing
  whitespace lines (build.py guard is loud about stray tokens).
- The overlay must not paint proof text; no avTestLine (the R12 leak law).
- node --check your OWN file before reporting. Report shapes as plain prose lists (no brace
  template blocks). State assumptions/uncertainties explicitly — the parent reconciles.
- House receipts: report = what changed (file + section), the pinned API list as implemented,
  any conflict clause hits, and the exact node --check output.

## 8. Parent integration (after children land)

1. Verify artifacts on disk (search_files + node --check + grep the new markers).
2. Styles block into src/styles.css from A/B class lists (av-library-* full-surface overlay: fixed
   inset backdrop, dialog box, head/status/body; av-import-libsum-row strip; facets overflow-x;
   bulk bar; more button; detail panel) — verify with a scratch screenshot before freeze.
3. Integration script (counted-assert, ONE write per file): build.py js_parts +=
   `(SRC / "av_library_ui.js")` AFTER the av_sources_ui.js line; app_core init line
   (`libraryOk = avLibraryUiInit()`) after the sourcesUi init line + version bump on the app-core
   version const (find its literal); nothing else.
4. Rebuild -> triage: smoke 78 -> hub 49 (or the recorded count) -> import 24 -> cockpit +
   platform unchanged -> a11y unchanged. Then pins sweep (22 files, full 64-hex) -> battery 25
   + bench -> deploy (index + sw) -> live capture (overlay open/close live + strip) -> close
   addendum 68.
