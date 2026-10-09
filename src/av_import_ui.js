/* Anvil -- SAMPLE PACKS card (R15b wave, child E): the user-facing import surface mounted into
   the parent-owned host `#av-import-host` (the parent adds the `#av-import` card + host in the
   synth zone between the CHOP and WAVETABLE cards at integration and calls avImportUiInit());
   this module only fills the host. Per verify/_r15b_wave.md sections 2-4.5. The pipeline it
   drives is child C's `src/av_import.js` (avImportFiles -> the canonical receipt) backed by the
   local library of child D (`src/av_lib.js`); every cross-module reach is typeof-guarded PER
   CALL (the core and the library may load before, after, or not at all: the card still mounts
   and every action refuses honestly with a plain status line, never a throw).

   WHAT THIS CARD IS -- one drop surface + one report + one library list:
     . DROP     [data-av-import-drop] -- a folder or files, dropped anywhere on the host or
                picked through #av-import-file / #av-import-dir. Folder drops resolve through
                dataTransfer.items + webkitGetAsEntry (recursive, depth cap 8, file cap =
                AV_IMPORT_MAX_FILES when the core is loaded, 600 otherwise), falling back to
                dataTransfer.files. The document-wide dragover/drop claim-once follows the
                av_sample.js law (a stray drop must never navigate the page away). The host and
                the drop zone carry class `dragover` while a drag is over them.
     . REPORT   #av-import-report -- one row [data-av-import-row] per file of the latest run:
                name . format . size . result chip (imported / deferred / refused) . sibling
                chip . reason. The honest empty state is #av-import-empty.
     . COUNTS   #av-import-counts -- the latest run in one line (total / imported / deferred /
                refused / samples / patterns).
     . LIBRARY  #av-import-lib -- newest-first rows [data-av-import-lib="<id>"] with the five
                pinned actions [data-av-import-act=load|send|chop|seq|del] (+ data-id):
                  load -> avLibLoad(id)
                  send -> avLibLoad(id), then avSampleSendToEngine(entryId, slot-1); the slot
                          comes from #av-import-slot (select, options 1..4)
                  chop -> avLibLoad(id), then best-effort: avChopUiPaintSrc(#av-chop-host, true)
                          when that function exists, set #av-chop-src value = entryId and
                          dispatch a bubbling 'change', then window.__avZoneAuto("#av-chop")
                          when it exists -- the select state is never faked
                  seq  -> avLibLoad(id) (patterns only; the button is disabled for samples)
                  del  -> avLibRemove(id) + refresh
                R15c kinds: kit rows carry a KIT action [data-av-import-act=kit] -> avLibLoad(id)
                ("kit loaded \u2014 N slots \u00b7 M zones" or the honest refusal) + DEL; refs
                rows (ALS/Serum) carry SEQ ONLY when meta.pattern exists (the refs receipt
                re-returns the meta; the SEQ wire applies the pattern through the ONE seq flow)
                + DEL; serum refs rows carry no load-type action beyond their meta line; the
                counts line gains " N kits" / " M refs" when above zero. R16: the counts line
                also gains " B bundles" when above zero (zip expansion lives in the core);
                report and library rows stay unchanged -- bundle rows render through the
                generic path.
     . STATUS   #av-import-status -- every run/action result as one plain line ("imported N .
                deferred N . refused N . X MB -> library" plus the first refusal reason when
                any). BUSY: ONE op at a time (import run or library action) -- a second request
                refuses honestly; the pick buttons disable and the root carries class
                av-import-busy + dataset avImportBusy + aria-busy while a run/action is in
                flight.
     . NOTE     #av-import-note -- "Imports land in your local library -- nothing is uploaded."

   R17 -- IMPORT HUB v1 (the card relocates to the Store zone; that move is the PARENT's job --
   this module stays zone-agnostic and only fills its parent-owned host). The card gains the
   library manager (search #av-import-search . sort #av-import-sort . kind chips #av-import-filters
   > .av-import-fchip[data-f] . select-all #av-import-selall . delete-selected #av-import-delsel
   (both over the VISIBLE rows) . R19 collect-&-pack #av-import-pack "COLLECT & PACK (N)"
   (the selected rows -> one .avpack) . per-row checkbox [data-av-import-check] + REN/EXP
   actions . inline
   rename input.av-import-rename . per-item export through the guarded avDeliverDownload), the
   persisted receipts history (#av-import-runs rows button[data-av-import-run] "HH:MM . imported
   N . deferred N . refused N . title" . #av-import-runsclear . #av-import-runs-empty; a click
   paints the stored receipt into the report + counts and marks the root .av-import-hist -- the
   next live run clears it), the storage footer (#av-import-storage "storage: <used> of <quota> .
   <tier>" + the #av-import-persist nudge through the guarded avStoreEstimate / avStorePersist --
   never claims a grant it did not get), and drop-anywhere routing (the document-level drop keeps
   ALWAYS preventDefault and, for targets OUTSIDE #av-import-host, funnels the dataTransfer
   through avImportUiFilesFromDataTransfer -> avImportUiImport, then avZoneShow("store") +
   avImportUiReveal; drops INSIDE the host stay the card's own handler -- the containment guard is
   what prevents a double import). Every avImportFiles completion from the card (the single call
   site avImportUiImport) fire-and-forget saves a receipt (avLibReceiptSave, guarded) and refreshes
   the runs list; every manager action obeys the ONE-op busy law (manager controls disabled while
   busy; the busy classes stay av-import-busy + dataset.avImportBusy + aria-busy).

   R18 -- IDENTITY (dedupe . missing refs . relink v1; the sha256 + provenance halves live in
   av_import.js and av_lib.js and land in the same build -- every reach below is typeof-guarded
   PER CALL, so the card still mounts without them and refuses honestly): a report item whose
   receipt carries `dup` gains the DUPLICATE chip (av-import-chip-dup, "DUPLICATE of <name40>")
   after its result chip, and the counts line gains " N dups" above zero. A library record
   carrying `dupOf` gains the same chip + a REPLACE action ([data-av-import-act=replace] ->
   guarded avLibReplaceDup(id) -> refresh; status "replaced with <name>" or the honest refusal).
   One guarded avLibMissingScan() runs after every completed library refresh (and so after every
   run and relink) into a memo: rows whose id appears in a scan entry's `want` get
   av-import-chip-missing + a RELINK action ([data-av-import-act=relink] -> the inline
   select.av-import-relink inside that row; options = the library items, ranked (same lowercase
   basename-stem first, then the rest; label "name (kind)"); Enter commits through guarded
   avLibRename(candidateId, missingName) -> rescan -> "relinked <name>"; Esc/blur cancels; ONE
   editor at a time, the rename editor's law) and #av-import-libstat appends " M missing refs"
   above zero.

   R19 -- USER PACKS (collect & pack; every reach typeof-guarded PER CALL, so the card mounts
   without av_pack.js / av_proj.js and refuses honestly): the manager gains #av-import-pack
   "COLLECT & PACK (N)" directly after #av-import-delsel -- the same disabled law (busy or 0
   selected) and the live selected count in its label, both painted by avImportUiPaintManager.
   A click packs the SELECTED rows through the guarded window.__avPack.build({ids}) facade: on
   ok the bytes go through the guarded avProjPicker("save") seam (suggestedName "<name>.avpack")
   with an FSA write, else the avDeliverDownload(bytes, name) fallback (the S4 Blob->arrayBuffer
   law where the build hands back a Blob); AbortError is a calm cancel and never falls back
   (the av_proj.js law). Status: "packed N items -> <name>.avpack" (+ the route truth when the
   download carried it); refusals are honest. Library rows whose record carries source.pack
   gain the provenance chip "pack:<id>" (av-import-chip av-import-chip-sib -- existing classes,
   no new class list entries).

   R21 -- LIBRARY MANAGER v2 (verify/_r21_wave.md section 4; NO version bump -- r15b.0 stays):
   the card SLIMS: the manager controls, the libhead and the #av-import-lib list LEAVE the card
   for a full-surface overlay; in their place the card gains the summary strip
   (#av-import-libsum-row > #av-import-libsum (the avImportUiLibStatText line, memo key
   "libsum") + #av-import-libopen "OPEN LIBRARY"). The moved markup lives in
   avImportUiManagerHTML(), hosted by avImportUiManagerMount(container) (the first CONNECTED
   mount wins; the overlay's #av-library-body) and reached through avImportUiMgrEl() /
   manager-scoped queries so the SAME code serves the overlay. The manager gains format chips
   (#av-import-formats, data-fmt; the PRESENT formats in fixed order wav/mp3/aiff/rex2/mid/zip/
   other), pack chips (#av-import-packs, data-pack; all . __none . pack:<id> sorted, cap 32),
   an incremental paint (AV_IMPORT_UI_LIB_STEP 60 rows + #av-import-more "show more (P of M)";
   AV_IMPORT_UI_LIB_ROWS_MAX 400 stays the ceiling), a bulk bar (#av-import-bulk, five buttons
   data-av-import-bulk=load|send|chop|seq|export; sequential under ONE busy window, cap
   AV_IMPORT_UI_BULK_MAX 50, export = ONE anvil-library-<N>.zip through the real avZipBuild
   writer), and the per-row inspector ([data-av-import-act=info] + #av-import-detail).
   avImportUiSetStatus tail-writes the overlay status line through the guarded avLibraryUiNote;
   avImportUiLibrary() appends a guarded avLibraryUiOpen() (the store-jump behavior is kept).

   R20 -- SONG ROWS (verify/_r20_wave.md section 6; NO version bump): a row of kind "song"
   (the Song Bundle's project payload) carries the LOAD action (label LOAD, title "apply this
   song bundle's project" -> avLibLoad(id) -> the av_lib song route applies the project)
   + DEL; NO SEND / CHOP / SEQ (a song item has no session entry and no pattern) and no
   RELINK (a song record references nothing, so the missing-ref scan never flags it). The
   R17 REN/EXP pair and the R21 info toggle append as on every kind. A loaded song reports
   "loaded <name> . song . applied N" (+ " . N warnings" above zero) in the status line.
   The manager's kind facet set stays as-is (song rows appear under "all").

   DOM CONTRACT (exact -- suites pin these):
     host      #av-import-host          parent-owned; absent -> avImportUiInit() returns false
     root      .av-import[data-av-import="1"] (id "av-import" only when no element owns it --
               the av_chop_ui / av_files_ui idiom)
     drop      [data-av-import-drop]    role=button tabindex=0; click / Enter / Space open
               #av-import-file
     inputs    #av-import-file (hidden, multiple, accept list) . #av-import-dir (hidden,
               webkitdirectory multiple) -- both carry class av-import-file
     buttons   #av-import-pick . #av-import-pickdir
     status    #av-import-status (role=status aria-live=polite) . #av-import-counts
     report    #av-import-report (rows [data-av-import-row] with data-format + data-result,
               cells: .av-import-name . av-import-fmt . av-import-size . av-import-chip .
               av-import-reason) . #av-import-empty (hidden, inside the report, when rows exist)
     library   .av-import-libhead: .av-import-libtag . #av-import-libstat (extra id) .
               #av-import-slot (select, values 1..4) . #av-import-librefresh (extra id);
               list #av-import-lib with rows [data-av-import-lib="<id>"] (data-kind) and the
               five [data-av-import-act] buttons carrying data-id (seq disabled unless the row
               is a pattern)
     note      #av-import-note
     manager   #av-import-search (input search) . #av-import-sort (select newest|name|size|kind) .
               #av-import-filters (.av-import-fchip[data-f=all|sample|kit|refs|pattern], active
               class on) . #av-import-selall . #av-import-delsel . #av-import-pack (the last two
               disabled at 0 selected / while busy; the pack label carries the live count)
     runs      #av-import-runs (rows button[data-av-import-run]) . #av-import-runsclear .
               #av-import-runs-empty (static; hidden while rows exist)
     storage   #av-import-storage . #av-import-persist
     rows add  lib rows gain input.av-import-check[data-av-import-check] + the
               [data-av-import-act=rename|export] buttons; the inline editor is
               input.av-import-rename
     state     .dragover on the host + the drop zone during a drag; .av-import-busy +
               dataset avImportBusy + aria-busy on the root while busy; dataset avImportWired
               on the host (delegation bound once), dataset avImportUi on the host (mount flag,
               the idempotence gate)

   OBSERVABLES: avImportUiInit() -> bool (false without #av-import-host; idempotent via
   host.dataset.avImportUi; re-mountable) . avImportUiImport(files, opts) -> the core receipt,
   or a promise resolving to it (never rejects; refuses honestly while busy or when the core
   is absent) . avImportUiRefreshLib() -> Promise<bool> (never rejects) . avImportUiSnap() ->
   the honest card state (inited . host . version . busy . last {title, at, counts} . report
   items (JSON-safe) . lib {count, bytes, backend} . lastError) . avImportUiProof() ->
   "IMPORT SELFTEST " + JSON of {version, inited, libCount, sniff} (a fixed RIFF+WAVE 12-byte
   fixture sniffs "wav") . avImportUiClasses() -> string[] (every NEW css class this card
   emits). Facade: window.__avImport = {version:"r15b.0", init, snap, importFiles, refresh,
   classes}. R17 observables (additive): avImportUiPickDir() (the menubar import-folder) .
   avImportUiLibrary() (store zone show + reveal + focus; true) . avImportUiReveal() (scroll the
   hub into view + focus the drop zone) . avImportUiPick(kind) keeps its old contract (no arg or
   "file" = files, "dir" = folder) . snap() gains runs (the stored receipt count) + manager
   {search, sort, filter, selected (the selected count)} . the facade gains pick, pickDir,
   library, rename, exportItem (every existing key kept). R18 observables (additive):
   avImportUiActReplace(id) (the REPLACE commit) . avImportUiBeginRelink(id) (the row action ->
   editor) . avImportUiRelink(candidateId, name) (the commit) . avImportUiRefreshMissing() (one
   guarded scan -> memo) . avImportUiMissingCount() (the scan count) . snap() gains dups (last
   receipt counts.dups) + missing (the scan count); the facade gains replace(id),
   relink(name, candidateId), missing() (every existing key kept). R21 observables (additive):
   avImportUiManagerMount(container) (-> bool; first connected mount wins) . avImportUiMgrEl()
   (-> element|null) . avImportUiSetFormat(f) / avImportUiSetPack(p) (-> bool) .
   avImportUiMore() (-> bool) . avImportUiInspect(id) (-> bool) . avImportUiBulk(act) (-> bool);
   snap().manager gains fmt . pack . limit . shown . insp (existing keys kept); the facade gains
   managerMount, mgrEl, setFormat, setPack, more, inspect, bulk.

   PROOF EMISSION (the console-proof-leak law; mirrors av_lfo.js lines 255-275 EXACTLY in
   shape): at init, gated on the same ?avtest=1 query check the LFO card uses, deferred with
   setTimeout(..., 0): avTestLine(avImportUiProof(), "av-importtest") -- never at parse time,
   never on the plain page.

   CONSTANTS this module owns: AV_IMPORT_UI_VERSION "r15b.0" . AV_IMPORT_UI_DEPTH_CAP 8
   (folder-walk depth cap) . AV_IMPORT_UI_MAX_FILES 600 (fallback mirror of the core's
   AV_IMPORT_MAX_FILES) . AV_IMPORT_UI_ROWS_MAX 600 (report rows painted) .
   AV_IMPORT_UI_LIB_ROWS_MAX 400 (library rows painted) . AV_IMPORT_UI_ACCEPT (the input
   accept list) . AV_IMPORT_UI_CLASSES (below). R17 additive constants: AV_IMPORT_UI_NAME_MAX 120
   (the rename cap) . AV_IMPORT_UI_RUN_ITEMS_MAX 60 (receipt items saved per run) .
   AV_IMPORT_UI_EXT_FALLBACK (the export-filename fallback map) . AV_IMPORT_UI_FILTERS /
   AV_IMPORT_UI_SORTS (the manager vocabularies). R21 additive constants: AV_IMPORT_UI_LIB_STEP 60
   (library rows per incremental paint) . AV_IMPORT_UI_BULK_MAX 50 (the bulk action cap) .
   AV_IMPORT_UI_FMTS (the format facet vocabulary, fixed order).

   CSS CLASSES THIS MODULE NEEDS (the parent authors styles.css from this list; the
   parent-owned card id #av-import and host #av-import-host are NOT listed; av-btn / av-note /
   av-dim / av-select / mini are existing house classes):
     .av-import          the card root inside the host
     .av-import-head .av-import-title .av-import-cap          header row + caption
     .av-import-status-line .av-import-status .av-import-msg .av-import-err    the status line
     .av-import-drop     the drop zone (a dashed target; pointer cursor; focus ring)
     .av-import-dropmsg  the drop copy inside the zone
     .av-import-file     the two hidden inputs (visually gone; keep them in the DOM)
     .av-import-btns .av-import-btn                            the picker buttons row
     .av-import-counts   the one-line counts summary
     .av-import-report   the report list container
     .av-import-row      one report row (.av-import-row-imported / -deferred / -refused tint)
     .av-import-name .av-import-fmt .av-import-size .av-import-reason   the report cells
     .av-import-chip     the result chip (.av-import-chip-imported / -deferred / -refused,
                         plus .av-import-chip-sib for the same-stem sibling chip)
     .av-import-libhead .av-import-libtag .av-import-lbl .av-import-slot .av-import-libstat
                         the library header (LIBRARY tag . slot select . refresh . stat)
     .av-import-lib      the library list container
     .av-import-item     one library row (.av-import-item-name . .av-import-item-meta)
     .av-import-acts     the five-action row (.av-import-act = one action button)
     .av-import-empty    empty-state paragraphs (report when no runs; library when empty);
                         respects the hidden attribute -- do not force display on it
     .av-import-note     the "nothing is uploaded" line
     .av-import-busy     added to the root while a run/action is in flight
     .dragover           added to the host + the drop zone while a drag is over them
     R17: .av-import-manager .av-import-search .av-import-sort .av-import-filters .av-import-fchip
          (+ .on while a chip is the active kind filter) .av-import-check (the row checkbox) .
          .av-import-rename (the inline editor) .av-import-runs .av-import-run (a runs row
          button) .av-import-runs-head .av-import-foot (the storage footer row) .
          .av-import-storage (the storage line) .av-import-hist (the root while a stored run
          is being viewed)
     R18: .av-import-chip-dup .av-import-chip-missing (the identity chips; same slot as the
          report chips) . .av-import-relink (the inline relink select in a library row)
     R21: .av-import-libsum-row .av-import-libsum (the card summary strip) .av-import-facets
          (the format/pack chip groups) .av-import-bulk (the bulk action bar) .av-import-more
          (show more) .av-import-detail (+ -line -key -val -meta; the item inspector)

   LAWS (house): "use strict"; classic script; ONE namespace avImportUi* / AV_IMPORT_UI_*;
   NO DOM at top level (node-loadable -- the harness loads this text in a Function scope);
   every listener and every cross-module reach wrapped (never throws outward); no console
   noise; no new AudioContext (this card makes no sound); deterministic; ASCII-only source;
   ONE writer (child E; R15c wiring child D adds the KIT wire + the refs SEQ gate). */

"use strict";

const AV_IMPORT_UI_VERSION = "r15b.0";
const AV_IMPORT_UI_DEPTH_CAP = 8;        /* folder walk depth cap                             */
const AV_IMPORT_UI_MAX_FILES = 600;      /* fallback mirror of the core's AV_IMPORT_MAX_FILES */
const AV_IMPORT_UI_ROWS_MAX = 600;       /* report rows painted per run                       */
const AV_IMPORT_UI_LIB_ROWS_MAX = 400;   /* library rows painted                              */
/* R21 additive constants (the manager UX halves: incremental view + bulk + format facets) */
const AV_IMPORT_UI_LIB_STEP = 60;        /* library rows per incremental paint (show more)    */
const AV_IMPORT_UI_BULK_MAX = 50;        /* bulk actions cap (selected items per run)         */
/* R21: the format facet vocabulary (fixed order; a folded ext outside this set -> "other") */
const AV_IMPORT_UI_FMTS = ["wav", "mp3", "aiff", "rex2", "mid", "zip", "other"];
const AV_IMPORT_UI_ACCEPT = "audio/*,.wav,.aiff,.aif,.aifc,.mp3,.mid,.midi,.rx2,.exs,.nki,.nbkt,.sxt,.kong,.mxgrp,.wt,.fxp,.serumpreset,.adg,.als,.zip";
/* R17 additive constants (names frozen -- the manager . receipts . storage . export half) */
const AV_IMPORT_UI_NAME_MAX = 120;        /* inline rename cap (mirror of AV_LIB_NAME_MAX)      */
const AV_IMPORT_UI_RUN_ITEMS_MAX = 60;    /* receipt items saved per run (AV_LIB_REC_ITEMS_MAX) */
/* the export-filename fallback when a record carries no ext: format map first, then kind */
const AV_IMPORT_UI_EXT_FALLBACK = {
  wav: "wav", mp3: "mp3", aiff: "aiff", rex2: "rx2",
  "pattern-kind": "mid", "kit-kind": "exs", "refs-kind": "json",
};
const AV_IMPORT_UI_FILTERS = ["all", "sample", "kit", "refs", "pattern"];
const AV_IMPORT_UI_SORTS = ["newest", "name", "size", "kind"];

/* the NEW css classes this card emits (the parent styles them; #av-import / #av-import-host
   are parent-owned card ids and are NOT listed; av-btn / av-note / av-dim / av-select / mini
   are existing house classes). Kept in one place so the integration class-coverage check can
   diff. Dynamic/state classes are listed here all the same. */
const AV_IMPORT_UI_CLASSES = [
  "av-import", "av-import-head", "av-import-title", "av-import-cap",
  "av-import-status-line", "av-import-status", "av-import-msg", "av-import-err",
  "av-import-drop", "av-import-dropmsg", "av-import-file",
  "av-import-btns", "av-import-btn",
  "av-import-counts",
  "av-import-report", "av-import-row",
  "av-import-row-imported", "av-import-row-deferred", "av-import-row-refused",
  "av-import-name", "av-import-fmt", "av-import-size", "av-import-reason",
  "av-import-chip", "av-import-chip-imported", "av-import-chip-deferred",
  "av-import-chip-refused", "av-import-chip-sib",
  "av-import-libhead", "av-import-libtag", "av-import-lbl", "av-import-slot",
  "av-import-libstat", "av-import-lib",
  "av-import-item", "av-import-item-name", "av-import-item-meta",
  "av-import-acts", "av-import-act",
  "av-import-empty", "av-import-note",
  "av-import-busy", "dragover",
  /* R17: manager . runs . storage . inline rename + state classes */
  "av-import-manager", "av-import-search", "av-import-sort", "av-import-filters",
  "av-import-fchip", "on", "av-import-check", "av-import-rename",
  "av-import-runs", "av-import-run", "av-import-runs-head",
  "av-import-foot", "av-import-storage", "av-import-hist",
  /* R18: the identity chips + the inline relink select (exactly these three) */
  "av-import-chip-dup", "av-import-chip-missing", "av-import-relink",
  /* R21: the card strip + the manager UX halves (facets . bulk bar . more . inspector) */
  "av-import-libsum-row", "av-import-libsum", "av-import-facets", "av-import-bulk",
  "av-import-more", "av-import-detail", "av-import-detail-line", "av-import-detail-key",
  "av-import-detail-val", "av-import-detail-meta",
];

/* UI-local state only -- every core fact is read through the pinned apis per call */
const avImportUiState = {
  inited: false, mounts: 0,
  busy: false,                    /* ONE op at a time (import run or library action)  */
  dragDepth: 0,                   /* host dragenter/dragleave depth (av_sample law)   */
  runSeq: 0,                      /* bumped once per finished import run              */
  last: null,                     /* {title, at, counts} of the latest receipt        */
  reportItems: [],                /* the latest receipt's items (JSON-safe projection)*/
  lib: { ok: false, backend: "", count: 0, bytes: 0, items: [], error: "", at: 0 },
  walkNote: "",                   /* folder-walk truncation note, consumed by a run   */
  status: "", statusKind: "msg",
  lastError: "",
  reportPaintedSeq: -1,           /* report rebuild memo (runSeq)                     */
  libSig: "\u0000",               /* library rebuild memo (list signature)            */
  mgr: { search: "", sort: "newest", filter: "all", sel: {}, selSeq: 0,    /* R17 manager view */
         fmt: "all", pack: "all", limit: AV_IMPORT_UI_LIB_STEP, insp: "" }, /* R21: view halves + inspector */
  mgrHost: null,                  /* R21: the manager mount (first CONNECTED mount wins)  */
  runs: { ok: false, backend: "", count: 0, list: [], byId: {}, error: "", at: 0 },
  runsSig: "\u0000",              /* runs rebuild memo (list signature)               */
  hist: null,                     /* {id, at, title, counts, items} of the viewed run */
  storage: { checked: false, est: null, tier: "best-effort", at: 0 },
  /* R18: the missing-refs memo (one guarded avLibMissingScan per completed lib refresh) */
  missing: { ok: false, error: "", at: 0, count: 0, list: [], byId: {}, sig: "\u0000" },
  memos: { text: {}, cls: {} },   /* write-on-change memos so idle syncs never touch  */
};

/* ---------- small pure helpers (no DOM; harness-covered) ---------- */

const avImportUiEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function avImportUiNumOr(v, d) {
  const n = Number(v);
  return isFinite(n) ? n : d;
}

function avImportUiInt(v, lo, hi, dflt) {
  const n = Number(v);
  if (!isFinite(n)) return dflt;
  const r = Math.round(n);
  return r < lo ? lo : (r > hi ? hi : r);
}

/* a capped string (never throws; null/undefined -> "") */
function avImportUiStr(v, cap) {
  try {
    const t = String(v == null ? "" : v);
    return (cap && t.length > cap) ? t.slice(0, cap) : t;
  } catch (e) { return ""; }
}

function avImportUiShort(s, max) {
  try {
    const t = String(s == null ? "" : s);
    const m = (typeof max === "number" && max > 4) ? Math.floor(max) : 96;
    return t.length <= m ? t : t.slice(0, m - 1) + "\u2026";
  } catch (e) { return ""; }
}

function avImportUiFmtBytes(v) {
  const n = Number(v);
  if (!isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return Math.round(n) + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

/* an error/refusal line out of anything (receipts carry .error strings) */
function avImportUiErrText(e, fallback) {
  try {
    if (e && typeof e === "object") {
      if (typeof e.error === "string" && e.error) return e.error;
      if (typeof e.message === "string" && e.message) return e.message;
    }
    if (typeof e === "string" && e) return e;
  } catch (e2) { /* fall through */ }
  return fallback || "refused";
}

/* tolerant receipt normalizer -- a receipt is ALWAYS an object after this */
function avImportUiReceipt(r) {
  try {
    if (r === true) return { ok: true };
    if (r && typeof r === "object") return r;
    if (typeof r === "string" && r) return { ok: false, error: r };
    if (r === false) return { ok: false, error: "refused" };
  } catch (e) { /* fall through */ }
  return { ok: false, error: "no receipt" };
}

/* async settle: receipts may be promises or sync values; the callback runs EXACTLY once,
   never throws, and a rejection becomes an honest {ok:false, error} receipt */
function avImportUiSettle(p, cb) {
  const done = { v: false };
  const once = function (r) {
    if (done.v) return;
    done.v = true;
    try { cb(r); } catch (e) { /* settle never throws */ }
  };
  try {
    if (p && typeof p.then === "function") {
      p.then(once, function (e) { once({ ok: false, error: avImportUiErrText(e, "failed") }); });
      return true;
    }
    once(p);
    return true;
  } catch (e) {
    once({ ok: false, error: avImportUiErrText(e, "failed") });
    return false;
  }
}

/* ---------- guarded DOM + core access (no throw, no noise) ---------- */

function avImportUiWin() {
  try { if (typeof window !== "undefined") return window; } catch (e) { /* none */ }
  return null;
}

function avImportUiDoc() {
  try { if (typeof document !== "undefined") return document; } catch (e) { /* none */ }
  return null;
}

function avImportUiHost() {
  try {
    const d = avImportUiDoc();
    if (d && typeof d.getElementById === "function") return d.getElementById("av-import-host");
  } catch (e) { /* no document */ }
  return null;
}

/* ---------- R21: the manager mount resolution (the manager left the card) ---------- */

/* the pinned mount getter: state.mgrHost while it is CONNECTED to a document, else null */
function avImportUiMgrEl() {
  try {
    const h = avImportUiState.mgrHost;
    if (!h) return null;
    const d = (h.ownerDocument && typeof h.ownerDocument.contains === "function") ? h.ownerDocument : avImportUiDoc();
    if (d && typeof d.contains === "function") return d.contains(h) ? h : null;
    return h;   /* no document to check against (node harness): the host stands */
  } catch (e) { return null; }
}

/* the query root for whole-area manager paints: the mount host, else the document (the
   document-wide fallback stands when no host is registered) */
function avImportUiMgrRoot() {
  const el = avImportUiMgrEl();
  if (el) return el;
  return avImportUiDoc();
}

/* one manager-scoped element: the mount host first, then the document-wide lookup (the
   manager ids no longer live in the card). Never throws; absent -> null. */
function avImportUiMgrFind(sel) {
  try {
    const mgr = avImportUiMgrEl();
    if (mgr && typeof mgr.querySelector === "function") {
      const el = mgr.querySelector(sel);
      if (el) return el;
    }
  } catch (e) { /* fall through to the document reach */ }
  try {
    const d = avImportUiDoc();
    if (!d) return null;
    const s = String(sel == null ? "" : sel);
    if (s.charAt(0) === "#") {
      const id = s.slice(1).replace(/[^a-zA-Z0-9_-]/g, "");
      if (id && typeof d.getElementById === "function") return d.getElementById(id);
    }
    if (typeof d.querySelector === "function") return d.querySelector(s);
  } catch (e2) { /* none */ }
  return null;
}

/* the receipt's item array as a JSON-safe projection (bounded; primitives only) */
function avImportUiMetaPub(m) {
  const out = {};
  try {
    if (!m || typeof m !== "object") return out;
    let keys = 0;
    for (const k in m) {
      if (keys >= 16) break;
      const v = m[k];
      if (typeof v === "number" && isFinite(v)) { out[String(k)] = v; keys += 1; }
      else if (typeof v === "string" && v) { out[String(k)] = v.length > 80 ? v.slice(0, 80) : v; keys += 1; }
      else if (typeof v === "boolean") { out[String(k)] = v; keys += 1; }
    }
  } catch (e) { /* none */ }
  return out;
}

/* the R18 dup reference out of anything -- the report item's `dup` and a record's `dupOf`
   share the {id, name} shape; null unless at least a safe id or a name is present */
function avImportUiDupPub(d) {
  try {
    if (!d || typeof d !== "object") return null;
    const id = avImportUiSelId(d.id);
    const name = avImportUiStr(d.name, 120);
    if (!id && !name) return null;
    return { id: id, name: name };
  } catch (e) { return null; }
}

function avImportUiItemsPub(r) {
  const out = [];
  try {
    const items = (r && r.items && typeof r.items.length === "number") ? r.items : [];
    const n = Math.min(items.length | 0, AV_IMPORT_UI_ROWS_MAX);
    for (let i = 0; i < n; i++) {
      const it = items[i];
      if (!it || typeof it !== "object") continue;
      out.push({
        key: avImportUiStr(it.key, 24),
        name: avImportUiStr(it.name, 120),
        path: avImportUiStr(it.path, 200),
        ext: avImportUiStr(it.ext, 16),
        format: avImportUiStr(it.format, 24),
        kind: avImportUiStr(it.kind, 24),
        result: avImportUiStr(it.result, 16),
        reason: avImportUiStr(it.reason, 200),
        size: avImportUiNumOr(it.size, 0),
        sibling: avImportUiStr(it.sibling, 120),
        id: avImportUiStr(it.id, 80),
        /* R18: the identity fields (the receipt carries sha + dup additively) */
        sha: avImportUiStr(it.sha, 64),
        dup: avImportUiDupPub(it.dup),
        meta: avImportUiMetaPub(it.meta),
      });
    }
  } catch (e) { /* empty stands */ }
  return out;
}

/* the receipt's counts (numbers only; derived from items when counts is absent) */
function avImportUiCountsOf(r) {
  /* R16: + bundles (the core's additive zip-expansion count); R18: + dups (identity) */
  const keys = ["total", "imported", "deferred", "refused", "samples", "patterns", "kits", "refs", "bundles", "dups"];
  const c = { total: 0, imported: 0, deferred: 0, refused: 0, samples: 0, patterns: 0, kits: 0, refs: 0, bundles: 0, dups: 0 };
  try {
    const src = r && r.counts;
    if (src && typeof src === "object") {
      for (let i = 0; i < keys.length; i++) c[keys[i]] = Math.max(0, Math.round(avImportUiNumOr(src[keys[i]], 0)));
      return c;
    }
    const items = (r && r.items && typeof r.items.length === "number") ? r.items : [];
    c.total = items.length;
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const res = String(it.result || "");
      if (res === "imported") c.imported += 1;
      else if (res === "deferred") c.deferred += 1;
      else if (res === "refused") c.refused += 1;
      const kind = String(it.kind || "");
      if (kind === "sample") c.samples += 1;
      else if (kind === "pattern") c.patterns += 1;
      else if (kind === "kit") c.kits += 1;
      else if (kind === "refs") c.refs += 1;
      else if (kind === "bundle" && res === "imported") c.bundles += 1;   /* R16: zip bundles */
      /* R18: the derived path -- a dup flag on a raw receipt item */
      if (it.dup) c.dups += 1;
    }
  } catch (e) { /* zeros stand */ }
  return c;
}

function avImportUiErrorsOf(r) {
  const out = [];
  try {
    const e = r && r.errors;
    if (e && typeof e.length === "number") {
      for (let i = 0; i < e.length && out.length < 8; i++) if (typeof e[i] === "string" && e[i]) out.push(e[i]);
    }
  } catch (err) { /* none */ }
  return out;
}

/* sum of imported item sizes ("X MB -> library" in the run summary) */
function avImportUiImportedBytes(items) {
  let n = 0;
  try {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it && it.result === "imported") n += avImportUiNumOr(it.size, 0);
    }
  } catch (e) { /* none */ }
  return n;
}

/* the first honest reason of the run: refusals first, deferrals second */
function avImportUiFirstReason(items) {
  try {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it && it.result === "refused" && it.reason) return String(it.reason);
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it && it.result === "deferred" && it.reason) return String(it.reason);
    }
  } catch (e) { /* none */ }
  return "";
}

/* ---------- R17: manager view (search . sort . kind filter over the lib mirror) ---------- */

/* "HH:MM" out of an epoch ms (or "--:--" when unusable) -- the receipts rows use it */
function avImportUiClock(at) {
  try {
    const n = Number(at);
    if (!isFinite(n) || n <= 0) return "--:--";
    const d = new Date(n);
    if (!isFinite(d.getTime())) return "--:--";
    const h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  } catch (e) { return "--:--"; }
}

/* an attribute-selector-safe library id (av_lib ids are /^l[a-z0-9-]{0,63}$/) */
function avImportUiSelId(id) {
  const t = String(id == null ? "" : id);
  return /^[a-z0-9-]{1,64}$/.test(t) ? t : "";
}

/* R21: the folded format facet value of a mirror item (avImportUiExtOf lowercased with rx2
   folded to rex2 and midi to mid; anything outside the vocabulary reads "other"). Never throws. */
function avImportUiFmtOf(it) {
  let ext = "";
  try { ext = String(avImportUiExtOf(it) || "").toLowerCase(); } catch (e) { ext = ""; }
  if (ext === "rx2") ext = "rex2";
  else if (ext === "midi") ext = "mid";
  for (let i = 0; i < AV_IMPORT_UI_FMTS.length; i++) if (AV_IMPORT_UI_FMTS[i] === ext) return ext;
  return "other";
}

/* the manager's visible rows: kind filter + R21 fmt/pack facets + case-insensitive name search
   + sort, over the library mirror ("newest" = the mirror's own newest-first order). Never
   mutates the mirror; a filter/sort failure falls back to the mirror order. */
function avImportUiViewItems() {
  const s = avImportUiState;
  const out = [];
  try {
    const src = s.lib.items || [];
    const f = s.mgr.filter;
    const fmt = String(s.mgr.fmt || "all");
    const pk = String(s.mgr.pack || "all");
    const q = String(s.mgr.search || "").toLowerCase();
    for (let i = 0; i < src.length; i++) {
      const it = src[i];
      if (!it) continue;
      if (f !== "all" && String(it.kind || "") !== f) continue;
      if (fmt !== "all" && avImportUiFmtOf(it) !== fmt) continue;
      if (pk === "__none") { if (String(it.pack || "")) continue; }
      else if (pk !== "all" && String(it.pack || "") !== pk) continue;
      if (q && String(it.name || "").toLowerCase().indexOf(q) < 0) continue;
      out.push(it);
    }
  } catch (e) { return []; }
  try {
    const byName = function (a, b) {
      const an = String(a.name || "").toLowerCase(), bn = String(b.name || "").toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
    };
    if (s.mgr.sort === "name") out.sort(byName);
    else if (s.mgr.sort === "size") out.sort(function (a, b) {
      const d = avImportUiNumOr(b.size, 0) - avImportUiNumOr(a.size, 0);
      return d !== 0 ? d : byName(a, b);
    });
    else if (s.mgr.sort === "kind") out.sort(function (a, b) {
      const ak = String(a.kind || ""), bk = String(b.kind || "");
      if (ak < bk) return -1;
      if (ak > bk) return 1;
      return byName(a, b);
    });
  } catch (e) { /* the mirror order stands */ }
  return out;
}

/* the export extension: the record's own ext first, then the pinned fallback map, then bin */
function avImportUiExtOf(it) {
  let ext = "";
  try { ext = String((it && it.ext) || "").toLowerCase().replace(/[^a-z0-9]/g, ""); } catch (e) { ext = ""; }
  if (ext) return ext;
  let f = "";
  try { f = String((it && it.format) || "").toLowerCase(); } catch (e2) { f = ""; }
  if (f && AV_IMPORT_UI_EXT_FALLBACK[f]) return AV_IMPORT_UI_EXT_FALLBACK[f];
  let k = "";
  try { k = String((it && it.kind) || "").toLowerCase(); } catch (e3) { k = ""; }
  if (k && AV_IMPORT_UI_EXT_FALLBACK[k + "-kind"]) return AV_IMPORT_UI_EXT_FALLBACK[k + "-kind"];
  return "bin";
}

/* the export filename "<name>.<ext>"; a name that already carries the ext is kept as-is
   (never a doubled ".wav.wav"); the name is sanitised for a download and never empty */
function avImportUiExportName(it) {
  let name = "";
  try { name = String((it && it.name) || "").trim(); } catch (e) { name = ""; }
  if (!name) name = "item";
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
  if (name.length > 120) name = name.slice(0, 120);
  const ext = avImportUiExtOf(it);
  const suffix = "." + ext.toLowerCase();
  if (name.toLowerCase().slice(-suffix.length) === suffix) return name;
  return name + "." + ext;
}

/* the guarded avDeliverDownload reach (global first, then the window facade) */
function avImportUiDeliverFn() {
  try { if (typeof avDeliverDownload === "function") return avDeliverDownload; } catch (e) { /* not loaded */ }
  try {
    const w = avImportUiWin();
    if (w && typeof w.avDeliverDownload === "function") return w.avDeliverDownload;
  } catch (e2) { /* no window */ }
  return null;
}

/* ---------- the file cap (mirror of the core's constant, guarded per access) ---------- */

function avImportUiFileCap() {
  try {
    if (typeof AV_IMPORT_MAX_FILES === "number" && isFinite(AV_IMPORT_MAX_FILES) && AV_IMPORT_MAX_FILES > 0) {
      return Math.floor(AV_IMPORT_MAX_FILES);
    }
  } catch (e) { /* the core is absent (or its const is not initialised yet) */ }
  return AV_IMPORT_UI_MAX_FILES;
}

/* any Array / FileList / iterable of File-likes -> a plain array (bounded) */
function avImportUiToList(files) {
  const out = [];
  try {
    if (!files) return out;
    const n = (typeof files.length === "number") ? (files.length | 0) : 0;
    if (n > 0) {
      const cap = Math.min(n, 4096);
      for (let i = 0; i < cap; i++) {
        const f = files[i];
        if (f) out.push(f);
      }
      return out;
    }
    if (typeof files[Symbol.iterator] === "function") {
      for (const f of files) {
        if (f) out.push(f);
        if (out.length >= 4096) break;
      }
    }
  } catch (e) { /* partial list stands */ }
  return out;
}

/* ---------- folder traversal (dataTransfer items + webkitGetAsEntry) ---------- */

/* readEntries returns batches until an empty batch -- drain them all (never rejects) */
function avImportUiReadAllEntries(reader) {
  return new Promise(function (resolve) {
    const out = [];
    let batches = 0;
    const step = function () {
      try {
        batches += 1;
        if (batches > 512) { resolve(out); return; }
        reader.readEntries(
          function (batch) {
            try {
              if (!batch || !batch.length) { resolve(out); return; }
              for (let i = 0; i < batch.length; i++) out.push(batch[i]);
              step();
            } catch (e) { resolve(out); }
          },
          function () { resolve(out); }
        );
      } catch (e) { resolve(out); }
    };
    step();
  });
}

/* walk one entry depth-first: dirs recurse (depth cap), files land in state.files (file cap).
   state = {files: [], count: 0, cap, truncated: false}; never rejects. */
function avImportUiWalkEntry(entry, depth, state) {
  return new Promise(function (resolve) {
    try {
      if (!entry) { resolve(); return; }
      if (state.count >= state.cap) { state.truncated = true; resolve(); return; }
      if (entry.isFile) {
        if (typeof entry.file !== "function") { resolve(); return; }
        entry.file(
          function (f) {
            try {
              if (f && state.count < state.cap) {
                /* best-effort: stamp the entry path so the receipt shows the folder tree */
                try {
                  if (!f.webkitRelativePath && typeof entry.fullPath === "string" && entry.fullPath) {
                    const rel = entry.fullPath.replace(/^\//, "");
                    if (rel) Object.defineProperty(f, "webkitRelativePath", { value: rel, writable: true, configurable: true });
                  }
                } catch (e2) { /* the stamp is a nicety */ }
                state.files.push(f);
                state.count += 1;
              } else if (f) {
                state.truncated = true;
              }
            } catch (e) { /* skip */ }
            resolve();
          },
          function () { resolve(); }
        );
        return;
      }
      if (entry.isDirectory) {
        if (depth >= AV_IMPORT_UI_DEPTH_CAP) { state.truncated = true; resolve(); return; }
        if (typeof entry.createReader !== "function") { resolve(); return; }
        const reader = entry.createReader();
        avImportUiReadAllEntries(reader).then(function (entries) {
          let chain = Promise.resolve();
          for (let i = 0; i < entries.length; i++) {
            (function (en) {
              chain = chain.then(function () { return avImportUiWalkEntry(en, depth + 1, state); });
            })(entries[i]);
          }
          chain.then(function () { resolve(); }, function () { resolve(); });
        }, function () { resolve(); });
        return;
      }
      resolve();
    } catch (e) { resolve(); }
  });
}

/* a DataTransfer -> {files: File[], truncated: bool} promise (never rejects). Entries come
   from items + webkitGetAsEntry; getAsFile / dataTransfer.files are the fallbacks. */
function avImportUiFilesFromDataTransfer(dt) {
  return new Promise(function (resolve) {
    try {
      const cap = avImportUiFileCap();
      const items = (dt && dt.items) ? dt.items : null;
      const entries = [];
      const fallbackFiles = [];
      if (items && typeof items.length === "number") {
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (!it || it.kind !== "file") continue;
          let en = null;
          try { if (typeof it.webkitGetAsEntry === "function") en = it.webkitGetAsEntry(); } catch (e) { en = null; }
          if (en) {
            entries.push(en);
          } else {
            let f = null;
            try { if (typeof it.getAsFile === "function") f = it.getAsFile(); } catch (e2) { f = null; }
            if (f) fallbackFiles.push(f);
          }
        }
      }
      if (!entries.length) {
        /* no entry api: plain files (items' getAsFile first, dataTransfer.files as fallback) */
        const out = [];
        let truncated = false;
        const src = fallbackFiles.length ? fallbackFiles : ((dt && dt.files) ? dt.files : null);
        if (src && typeof src.length === "number") {
          if (src.length > cap) truncated = true;
          for (let i = 0; i < src.length && out.length < cap; i++) if (src[i]) out.push(src[i]);
        }
        resolve({ files: out, truncated: truncated });
        return;
      }
      const state = { files: [], count: 0, cap: cap, truncated: false };
      let chain = Promise.resolve();
      for (let i = 0; i < entries.length; i++) {
        (function (en) {
          chain = chain.then(function () { return avImportUiWalkEntry(en, 0, state); });
        })(entries[i]);
      }
      chain.then(function () {
        /* a walk that found nothing still honours whatever plain files arrived */
        for (let i = 0; i < fallbackFiles.length && state.files.length < cap; i++) state.files.push(fallbackFiles[i]);
        if (!state.files.length) {
          const fl = (dt && dt.files) ? dt.files : null;
          if (fl && typeof fl.length === "number") {
            for (let i = 0; i < fl.length && state.files.length < cap; i++) if (fl[i]) state.files.push(fl[i]);
          }
        }
        resolve({ files: state.files, truncated: state.truncated });
      }, function () { resolve({ files: state.files, truncated: state.truncated }); });
    } catch (e) {
      resolve({ files: [], truncated: false });
    }
  });
}

/* the document-wide dragover/drop claim-once (av_sample.js L301-310 law: a stray drop must
   never navigate the page away). One claim per document; the drop listener ALWAYS
   preventDefaults and gains the R17 routing for drops outside the hub host (avImportUiDocDrop
   -- the containment guard). */
function avImportUiClaimDoc() {
  try {
    const d = avImportUiDoc();
    if (!d) return false;
    const de = d.documentElement;
    if (de && de.dataset && de.dataset.avImportDoc === "1") return true;
    if (de && de.dataset) de.dataset.avImportDoc = "1";
    d.addEventListener("dragover", function (e) { try { e.preventDefault(); } catch (err) { /* ok */ } });
    d.addEventListener("drop", function (e) {
      /* R17 fix (battery v1, cdp_sample regression): only an UNCLAIMED drop routes to the hub.
         A deeper card-level drop surface that handled the drop has already preventDefaulted it
         (the DOM contract) \u2014 e.g. the sample card's host drop. Capture BEFORE our own
         preventDefault so the routing decision sees the pre-existing state. */
      let claimed = false;
      try { claimed = e.defaultPrevented === true; } catch (err) { claimed = false; }
      try { e.preventDefault(); } catch (err) { /* ok */ }
      if (!claimed) avImportUiDocDrop(e);
    });
    return true;
  } catch (e) { return false; }
}

/* ---------- write-on-change DOM painting ---------- */

function avImportUiWriteText(host, sel, txt, key) {
  try {
    const s = avImportUiState;
    if (s.memos.text[key] === txt) return false;
    s.memos.text[key] = txt;
    const el = (host && typeof host.querySelector === "function") ? host.querySelector(sel) : null;
    if (el && el.textContent !== txt) el.textContent = txt;
    return true;
  } catch (e) { return false; }
}

function avImportUiToggleClass(host, sel, cls, on, key) {
  try {
    const s = avImportUiState;
    const memoKey = key + "|" + cls;
    const want = !!on;
    if (s.memos.cls[memoKey] === want) return false;
    s.memos.cls[memoKey] = want;
    const el = (host && typeof host.querySelector === "function") ? host.querySelector(sel) : null;
    if (el && el.classList && typeof el.classList.add === "function") {
      if (want) el.classList.add(cls); else el.classList.remove(cls);
    }
    return true;
  } catch (e) { return false; }
}

function avImportUiPaintStatus(host) {
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const s = avImportUiState;
    avImportUiWriteText(host, "#av-import-status", s.status, "status");
    avImportUiToggleClass(host, "#av-import-status", "av-import-err", s.statusKind === "err", "status-err");
    return true;
  } catch (e) { return false; }
}

function avImportUiSetStatus(msg, kind) {
  try {
    const s = avImportUiState;
    s.status = String(msg == null ? "" : msg);
    s.statusKind = (kind === "err") ? "err" : "msg";
    const out = avImportUiPaintStatus(avImportUiHost());
    /* R21: the overlay status mirror (ONE guarded tail call; safe before the overlay exists) */
    try { if (typeof avLibraryUiNote === "function") avLibraryUiNote(s.status, s.statusKind); } catch (e2) { /* overlay optional */ }
    return out;
  } catch (e) { return false; }
}

function avImportUiCountsText(c0) {
  try {
    const c = (c0 && typeof c0 === "object") ? c0 : null;
    if (!c) return "no runs yet \u2014 drop a folder or files";
    let line = c.total + " files \u00b7 imported " + c.imported + " \u00b7 deferred " + c.deferred +
      " \u00b7 refused " + c.refused + " \u00b7 samples " + c.samples + " \u00b7 patterns " + c.patterns;
    if (c.kits > 0) line += " \u00b7 " + c.kits + " kits";
    if (c.refs > 0) line += " \u00b7 " + c.refs + " refs";
    /* R16: zip bundles (the core's counts.bundles; shown only above zero) */
    if (c.bundles > 0) line += " \u00b7 " + c.bundles + " bundles";
    /* R18: duplicate imports (the core's counts.dups; shown only above zero) */
    if (c.dups > 0) line += " \u00b7 " + c.dups + " dups";
    return line;
  } catch (e) { return "no runs yet"; }
}

function avImportUiPaintCounts(host) {
  /* R17: a viewed stored run paints ITS stored counts; otherwise the latest live run */
  const s = avImportUiState;
  const c = (s.hist && s.hist.counts) ? s.hist.counts : (s.last ? s.last.counts : null);
  return avImportUiWriteText(host, "#av-import-counts", avImportUiCountsText(c), "counts");
}

function avImportUiEmptyMsg() {
  return "no imports yet \u2014 drop a sample pack (folder or files) or use the pickers above";
}

/* one report row -- the pinned cells: name . format . size . result chip . sibling . reason */
function avImportUiRowHTML(it) {
  const result = (it.result === "imported" || it.result === "deferred" || it.result === "refused") ? it.result : "refused";
  const name = it.name || it.path || it.key || "file";
  let html = '<div class="av-import-row av-import-row-' + result + '" data-av-import-row="' + avImportUiEsc(it.key || "") +
    '" data-format="' + avImportUiEsc(it.format || "") + '" data-result="' + result + '">';
  html += '<span class="av-import-name" title="' + avImportUiEsc(it.path || name) + '">' + avImportUiEsc(name) + "</span>";
  html += '<span class="av-import-fmt">' + avImportUiEsc(String(it.format || "unknown").toUpperCase()) + "</span>";
  html += '<span class="av-import-size av-dim">' + avImportUiEsc(avImportUiFmtBytes(it.size)) + "</span>";
  html += '<span class="av-import-chip av-import-chip-' + result + '" data-result="' + result + '">' + result + "</span>";
  /* R18: the duplicate chip follows the result chip (item.dup = {id, name} of the original) */
  if (it.dup && (it.dup.name || it.dup.id)) {
    const dn = it.dup.name || it.dup.id;
    html += '<span class="av-import-chip av-import-chip-dup" title="' +
      avImportUiEsc("a copy of an item already in the library: " + dn) + '">DUPLICATE of ' +
      avImportUiEsc(avImportUiShort(dn, 40)) + "</span>";
  }
  if (it.sibling) {
    html += '<span class="av-import-chip av-import-chip-sib" title="' + avImportUiEsc("same-stem sibling in this run: " + it.sibling) + '">+ ' + avImportUiEsc(it.sibling) + "</span>";
  }
  html += '<span class="av-import-reason av-dim" title="' + avImportUiEsc(it.reason || "") + '">' + avImportUiEsc(it.reason || "") + "</span>";
  html += "</div>";
  return html;
}

/* rebuild the report when a run landed (memo: runSeq) or when a stored run is viewed (R17:
   the paint key gains the hist id); the empty state stays in the DOM, hidden, whenever rows
   exist */
function avImportUiPaintReport(host, force) {
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const s = avImportUiState;
    const key = s.runSeq + "|" + (s.hist ? s.hist.id : "");
    if (!force && s.reportPaintedSeq === key) return true;
    const box = host.querySelector("#av-import-report");
    if (!box) return false;
    const hist = s.hist;
    const items = hist ? (hist.items || []) : (s.reportItems || []);
    let html = "";
    if (!items.length) {
      let msg;
      if (hist) {
        msg = (hist.items == null)
          ? "items from that run are not held in this session \u2014 the counts line is the stored summary"
          : "that run recorded no items";
      } else {
        msg = avImportUiEmptyMsg();
      }
      html = '<p class="av-note av-dim av-import-empty" id="av-import-empty">' + avImportUiEsc(msg) + "</p>";
    } else {
      const n = Math.min(items.length, AV_IMPORT_UI_ROWS_MAX);
      for (let i = 0; i < n; i++) html += avImportUiRowHTML(items[i]);
      if (items.length > n) {
        html += '<p class="av-note av-dim av-import-empty">' + avImportUiEsc("showing the first " + n + " of " + items.length + " files") + "</p>";
      }
      html += '<p class="av-note av-dim av-import-empty" id="av-import-empty" hidden>' + avImportUiEsc(avImportUiEmptyMsg()) + "</p>";
    }
    box.innerHTML = html;
    s.reportPaintedSeq = key;
    return true;
  } catch (e) { return false; }
}

/* ---------- the library list ---------- */

/* the record's provenance pack id (source.pack; the R19 manifest slug, else "") -- the R19
   chip reads this; never throws */
function avImportUiSrcPack(it) {
  try {
    const src = (it && it.source && typeof it.source === "object") ? it.source : null;
    const t = String((src && src.pack) == null ? "" : src.pack);
    return /^[a-z0-9][a-z0-9-]{0,63}$/.test(t) ? t : "";
  } catch (e) { return ""; }
}

/* R21: a lowercase 64-hex sha256 or "" (the inspector omits the line honestly when absent) */
function avImportUiShaHex(v) {
  try {
    const t = String(v == null ? "" : v).toLowerCase();
    return /^[a-f0-9]{64}$/.test(t) ? t : "";
  } catch (e) { return ""; }
}

/* R21: the bounded provenance view for the inspector (the source object as the list tier
   hands it: {name, path, size, at, replaced?, pack?}); null when nothing is present. */
function avImportUiSourcePub(v) {
  try {
    if (!v || typeof v !== "object") return null;
    const name = avImportUiStr(v.name, 120);
    const path = avImportUiStr(v.path, 200);
    const size = avImportUiNumOr(v.size, 0);
    const at = avImportUiNumOr(v.at, 0);
    const pack = avImportUiSrcPack({ source: v });
    const replaced = (v.replaced === true);
    if (!name && !path && !size && !at && !pack && !replaced) return null;
    return { name: name, path: path, size: size, at: at, pack: pack, replaced: replaced };
  } catch (e) { return null; }
}

/* one library row's JSON-safe view; R15c adds bounded counts (zones/samples/refs/tables) and
   the hasPattern flag so the new-kind rows render without holding whole metas. R18 adds dupOf
   (the flagged original {id, name} or null -- the scan's missing refs live in the memo).
   R19 adds pack (the record's source.pack slug, else "" -- the provenance chip).
   R21 adds ext . sha256 . source (the inspector reads its values from the mirror only). */
function avImportUiLibItemPub(it) {
  const out = {
    id: avImportUiStr(it && it.id, 80),
    name: avImportUiStr(it && it.name, 120),
    kind: avImportUiStr(it && it.kind, 24),
    format: avImportUiStr(it && it.format, 24),
    ext: avImportUiStr(it && it.ext, 16),
    size: avImportUiNumOr(it && it.size, 0),
    at: avImportUiNumOr(it && it.at, 0),
    meta: avImportUiMetaPub(it && it.meta),
    counts: { zones: 0, samples: 0, refs: 0, tables: 0 },
    hasPattern: false,
    dupOf: null,
    pack: "",
    sha256: "",
    source: null,
  };
  try {
    const m = (it && it.meta && typeof it.meta === "object") ? it.meta : {};
    if (Array.isArray(m.zones)) out.counts.zones = m.zones.length;
    if (Array.isArray(m.samples)) out.counts.samples = m.samples.length;
    if (typeof m.refCount === "number" && isFinite(m.refCount)) out.counts.refs = Math.max(0, Math.round(m.refCount));
    else if (Array.isArray(m.refs)) out.counts.refs = m.refs.length;
    if (Array.isArray(m.wtRefs)) out.counts.tables = m.wtRefs.length;
    out.hasPattern = !!(m.pattern && typeof m.pattern === "object" && !Array.isArray(m.pattern));
  } catch (e) { /* zeros stand */ }
  out.dupOf = avImportUiDupPub(it && it.dupOf);
  out.pack = avImportUiSrcPack(it);
  out.sha256 = avImportUiShaHex(it && it.sha256);
  out.source = avImportUiSourcePub(it && it.source);
  return out;
}

function avImportUiActBtnHTML(id, act, label, title, disabled) {
  return '<button type="button" class="av-btn mini av-import-act" data-av-import-act="' + act +
    '" data-id="' + avImportUiEsc(id) + '" title="' + avImportUiEsc(title) + '"' +
    (disabled ? " disabled" : "") + ">" + label + "</button>";
}

/* one library row -- the pinned load-type actions stay as-is (sample/pattern rows keep
   LOAD|SEND|CHOP|SEQ|DEL, kit rows KIT|DEL, refs rows SEQ?|DEL, R20 song rows LOAD|DEL --
   no SEND/CHOP/SEQ); R17 appends the select checkbox + the RENAME/EXPORT management actions
   on every kind */
function avImportUiLibRowHTML(it, sel) {
  const id = String(it.id || "");
  const kind = String(it.kind || "");
  const isPattern = (kind === "pattern");
  const isKit = (kind === "kit");
  const isRefs = (kind === "refs");
  const isSong = (kind === "song");
  const name = String(it.name || id);
  const counts = (it.counts && typeof it.counts === "object") ? it.counts : {};
  let meta;
  if (isKit) {
    meta = "kit \u00b7 " + avImportUiNumOr(counts.zones, 0) + " zones \u00b7 " + avImportUiNumOr(counts.samples, 0) + " samples";
  } else if (isRefs && String(it.format || "") === "serum") {
    meta = "refs \u00b7 " + avImportUiNumOr(counts.tables, 0) + " tables";
  } else if (isRefs) {
    /* R15d: non-serum refs rows (als/nki/nbkt/sxt) render the extracted ref count */
    meta = "refs \u00b7 " + avImportUiNumOr(counts.refs, 0) + " refs \u00b7 " + String(it.format || "");
  } else {
    meta = kind || "item";
    if (it.format) meta += " \u00b7 " + String(it.format);
    meta += " \u00b7 " + avImportUiFmtBytes(it.size);
  }
  let html = '<div class="av-import-item" data-av-import-lib="' + avImportUiEsc(id) + '" data-kind="' + avImportUiEsc(kind) + '">';
  html += '<input type="checkbox" class="av-import-check" data-av-import-check="1" data-id="' + avImportUiEsc(id) +
    '" aria-label="' + avImportUiEsc("select " + name) + '"' + ((sel && sel[id]) ? " checked" : "") + ">";
  html += '<span class="av-import-item-name" title="' + avImportUiEsc(name) + '">' + avImportUiEsc(name) + "</span>";
  html += '<span class="av-import-item-meta av-dim">' + avImportUiEsc(meta) + "</span>";
  /* R18: the identity chips sit between the meta and the actions (the report chips' slot) */
  const dupOf = (it.dupOf && typeof it.dupOf === "object") ? it.dupOf : null;
  if (dupOf && (dupOf.name || dupOf.id)) {
    const dn = dupOf.name || dupOf.id;
    html += '<span class="av-import-chip av-import-chip-dup" title="' +
      avImportUiEsc("a duplicate copy -- replacing folds it into " + dn) + '">DUPLICATE of ' +
      avImportUiEsc(avImportUiShort(dn, 40)) + "</span>";
  }
  const missName = avImportUiMissingNameOf(id);
  if (missName) {
    html += '<span class="av-import-chip av-import-chip-missing" title="' +
      avImportUiEsc("references " + missName + ", which is not in the library") + '">MISSING ' +
      avImportUiEsc(avImportUiShort(missName, 40)) + "</span>";
  }
  /* R19: the pack provenance chip (source.pack on the record; existing chip classes) */
  const pack = String(it.pack || "");
  if (pack) {
    html += '<span class="av-import-chip av-import-chip-sib" title="' +
      avImportUiEsc("imported from pack " + pack) + '">pack:' + avImportUiEsc(pack) + "</span>";
  }
  html += '<span class="av-import-acts">';
  if (isKit) {
    html += avImportUiActBtnHTML(id, "kit", "KIT", "load this kit into the sampler engine (slots + zones)", false);
    html += avImportUiActBtnHTML(id, "del", "DEL", "remove it from the local library", false);
  } else if (isRefs) {
    if (it.hasPattern === true) {
      html += avImportUiActBtnHTML(id, "seq", "SEQ", "load the pattern into the sequencer", false);
    }
    html += avImportUiActBtnHTML(id, "del", "DEL", "remove it from the local library", false);
  } else if (isSong) {
    /* R20 section 6: the song bundle row -- LOAD applies the project; no session entry rides */
    html += avImportUiActBtnHTML(id, "load", "LOAD", "apply this song bundle's project", false);
    html += avImportUiActBtnHTML(id, "del", "DEL", "remove it from the local library", false);
  } else {
    html += avImportUiActBtnHTML(id, "load", "LOAD", "load this item into the session", false);
    html += avImportUiActBtnHTML(id, "send", "SEND", "load it and send the session entry to the slot above", false);
    html += avImportUiActBtnHTML(id, "chop", "CHOP", "load it and aim the chop card at it", false);
    html += avImportUiActBtnHTML(id, "seq", "SEQ", "load the pattern into the sequencer", !isPattern);
    html += avImportUiActBtnHTML(id, "del", "DEL", "remove it from the local library", false);
  }
  /* R17 (append-only -- the load-type set above is untouched) */
  html += avImportUiActBtnHTML(id, "rename", "REN", "rename this item inline", false);
  html += avImportUiActBtnHTML(id, "export", "EXP", "export the stored bytes as a download", false);
  /* R21 (append-only -- directly after EXP; the inspector toggle) */
  html += avImportUiActBtnHTML(id, "info", "i", "item details", false);
  /* R18 (append-only -- the load-type set and the R17 pair above are untouched) */
  if (dupOf) {
    html += avImportUiActBtnHTML(id, "replace", "REPLACE", "replace the original with this copy -- this row's bytes move into the original, this row goes", false);
  }
  if (missName) {
    html += avImportUiActBtnHTML(id, "relink", "RELINK", "rename a library item to " + missName + " (the missing reference)", false);
  }
  html += "</span></div>";
  return html;
}

function avImportUiLibStatText() {
  const s = avImportUiState;
  if (!s.lib.ok) return s.lib.error ? "library unavailable" : "library idle";
  let line = s.lib.count + " item" + (s.lib.count === 1 ? "" : "s") + " \u00b7 " + avImportUiFmtBytes(s.lib.bytes);
  /* R18: the missing-refs suffix (the scan count; above zero only) */
  const missN = avImportUiMissingCount();
  if (missN > 0) line += " \u00b7 " + missN + " missing refs";
  return line;
}

function avImportUiPaintLibStat(host) {
  /* R21: the libhead left the card -- the target resolves through the manager mount */
  try {
    const root = avImportUiMgrRoot();
    if (!root || typeof root.querySelector !== "function") return false;
    return avImportUiWriteText(root, "#av-import-libstat", avImportUiLibStatText(), "libstat");
  } catch (e) { return false; }
}

/* R21: the card summary strip (#av-import-libsum) -- the same libstat line, memo key "libsum" */
function avImportUiStripPaint() {
  try {
    const host = avImportUiHost();
    if (!host || typeof host.querySelector !== "function") return false;
    return avImportUiWriteText(host, "#av-import-libsum", avImportUiLibStatText(), "libsum");
  } catch (e) { return false; }
}

function avImportUiPaintLib(host, force) {
  /* R21: the host parameter stays for signature compat; every target resolves through the
     manager mount (the list left the card) */
  try {
    const s = avImportUiState;
    avImportUiStripPaint();   /* R21: the card strip rides every library repaint (memo'd) */
    let sig = (s.lib.ok ? "1" : "0") + "|" + s.lib.backend + "|" + s.lib.count + "|" + s.lib.bytes + "|" + s.lib.items.length;
    if (s.lib.items.length) sig += "|" + s.lib.items[0].id + "|" + s.lib.items[s.lib.items.length - 1].id;
    /* R17: the manager view is part of the paint key (search . sort . filter . selection);
       R21 adds the fmt/pack facets . the incremental window . the inspector */
    sig += "|" + s.mgr.search + "|" + s.mgr.sort + "|" + s.mgr.filter + "|" + s.mgr.selSeq;
    sig += "|" + s.mgr.fmt + "|" + s.mgr.pack + "|" + s.mgr.limit + "|" + s.mgr.insp;
    /* R18: the identity memo is part of the paint key (the chips ride the rows) */
    sig += "|" + s.missing.sig;
    if (!force && sig === s.libSig) { avImportUiPaintLibStat(host); avImportUiPaintManager(host); avImportUiPaintMore(); return true; }
    const box = avImportUiMgrFind("#av-import-lib");
    if (!box) return false;
    const items = avImportUiViewItems();
    let html = "";
    if (!items.length) {
      let msg;
      if (!(s.lib.items || []).length) {
        if (s.lib.ok) msg = "library empty \u2014 imported files land here";
        else if (s.lib.error) msg = "library unavailable \u2014 " + s.lib.error;
        else msg = "the library (av_lib.js) is not present \u2014 nothing to list yet";
      } else {
        msg = "no items match \u2014 clear the search or set the filter to all";
      }
      html = '<p class="av-note av-dim av-import-empty">' + avImportUiEsc(msg) + "</p>";
    } else {
      /* R21: incremental -- at most the window (step 60) and never past the ceiling */
      const n = Math.min(items.length, s.mgr.limit, AV_IMPORT_UI_LIB_ROWS_MAX);
      for (let i = 0; i < n; i++) html += avImportUiLibRowHTML(items[i], s.mgr.sel);
      if (items.length > n && n >= AV_IMPORT_UI_LIB_ROWS_MAX) {
        html += '<p class="av-note av-dim av-import-empty">' + avImportUiEsc("showing the first " + n + " of " + items.length + " items") + "</p>";
      }
    }
    box.innerHTML = html;
    s.libSig = sig;
    avImportUiPaintLibStat(host);
    avImportUiPaintManager(host);
    avImportUiPaintMore();
    avImportUiPaintDetail();
    return true;
  } catch (e) { return false; }
}

/* write one avLibList (or refusal) receipt into the module mirror + repaint */
function avImportUiApplyLib(r0) {
  const s = avImportUiState;
  try {
    const r = avImportUiReceipt(r0);
    if (r.ok !== true) {
      s.lib.ok = false;
      s.lib.error = avImportUiErrText(r, "the library read failed");
      s.lib.backend = (typeof r.backend === "string") ? r.backend : "";
      s.lib.count = 0;
      s.lib.bytes = 0;
      s.lib.items = [];
    } else {
      s.lib.ok = true;
      s.lib.error = "";
      s.lib.backend = (typeof r.backend === "string") ? r.backend : "";
      s.lib.count = Math.max(0, Math.round(avImportUiNumOr(r.count, 0)));
      s.lib.bytes = Math.max(0, avImportUiNumOr(r.bytes, 0));
      const src = (r.items && typeof r.items.length === "number") ? r.items : [];
      const out = [];
      const n = Math.min(src.length, AV_IMPORT_UI_LIB_ROWS_MAX);
      for (let i = 0; i < n; i++) {
        const it = src[i];
        if (!it || typeof it !== "object" || it.id == null) continue;
        out.push(avImportUiLibItemPub(it));
      }
      /* R17: prune selections whose ids are gone (only on a good read) */
      try {
        const live = {};
        for (let i = 0; i < out.length; i++) live[out[i].id] = 1;
        const sel = s.mgr.sel;
        for (const k in sel) { if (sel[k] && !live[k]) delete sel[k]; }
      } catch (e3) { /* pruning is best-effort */ }
      s.lib.items = out;
    }
    s.lib.at = Date.now();
    avImportUiPaintLib(avImportUiHost(), true);
    return true;
  } catch (e) { return false; }
}

function avImportUiLibName(id) {
  try {
    const items = avImportUiState.lib.items || [];
    for (let i = 0; i < items.length; i++) {
      if (items[i] && items[i].id === id) return items[i].name || String(id == null ? "" : id);
    }
  } catch (e) { /* none */ }
  return String(id == null ? "" : id);
}

/* the public refresh: avLibList (guarded) -> mirror -> repaint; Promise<bool>, never rejects */
function avImportUiRefreshLib() {
  const s = avImportUiState;
  return new Promise(function (resolve) {
    let done = false;
    const finish = function (v) { if (!done) { done = true; resolve(v); } };
    try {
      if (typeof avLibList !== "function") {
        s.lib.ok = false;
        s.lib.error = "av_lib.js is not present";
        s.lib.backend = "";
        s.lib.count = 0;
        s.lib.bytes = 0;
        s.lib.items = [];
        s.lib.at = Date.now();
        avImportUiPaintLib(avImportUiHost(), true);
        /* R18: the identity memo follows the library state (unavailable -> the scan folds it away) */
        try { avImportUiRefreshMissing(); } catch (e2) { /* the scan never blocks the refresh */ }
        finish(false);
        return;
      }
      let out = null;
      try { out = avLibList(); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the library read failed") }; }
      avImportUiSettle(out, function (r) {
        try { avImportUiApplyLib(r); } catch (e) { /* apply never throws */ }
        /* R18: every completed library read is followed by the guarded missing-refs scan
           (and so after every run and relink -- they all funnel through this refresh) */
        try { avImportUiRefreshMissing(); } catch (e2) { /* the scan never blocks the refresh */ }
        finish(true);
      });
    } catch (e) { finish(false); }
  });
}

/* ---------- busy discipline (ONE op at a time) ---------- */

function avImportUiBusyRefuse() {
  avImportUiSetStatus("a run is already in progress \u2014 one op at a time", "err");
  return false;
}

function avImportUiBegin(word) {
  const s = avImportUiState;
  try {
    if (s.busy) return avImportUiBusyRefuse();
    s.busy = true;
    avImportUiSetStatus((word || "working") + "\u2026", "msg");
    avImportUiPaintBusy(avImportUiHost());
    return true;
  } catch (e) { return false; }
}

function avImportUiEnd() {
  const s = avImportUiState;
  try {
    s.busy = false;
    avImportUiPaintBusy(avImportUiHost());
    return true;
  } catch (e) { return false; }
}

/* the busy paint: the pick buttons disable; the root carries av-import-busy + dataset +
   aria-busy (library action buttons are not blanket-disabled here -- the per-row seq law
   must survive; the busy guard refuses their clicks honestly) */
function avImportUiPaintBusy(host) {
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const s = avImportUiState;
    const busy = !!s.busy;
    const ids = ["#av-import-pick", "#av-import-pickdir"];
    for (let i = 0; i < ids.length; i++) {
      const el = host.querySelector(ids[i]);
      if (el && el.disabled !== busy) el.disabled = busy;
    }
    const card = host.querySelector(".av-import");
    if (card) {
      if (card.classList) {
        if (busy) card.classList.add("av-import-busy");
        else card.classList.remove("av-import-busy");
      }
      if (card.dataset) {
        const v = busy ? "1" : "0";
        if (card.dataset.avImportBusy !== v) card.dataset.avImportBusy = v;
      }
      if (typeof card.setAttribute === "function") {
        const av = busy ? "true" : "false";
        if (!card.getAttribute || card.getAttribute("aria-busy") !== av) card.setAttribute("aria-busy", av);
      }
    }
    /* R17: the manager controls disable while busy (the write-on-change manager paint) */
    avImportUiPaintManager(host);
    return true;
  } catch (e) { return false; }
}

function avImportUiPaintAll(host, force) {
  const h = host || avImportUiHost();
  if (!h || typeof h.querySelector !== "function") return false;
  try {
    avImportUiPaintStatus(h);
    avImportUiPaintCounts(h);
    avImportUiPaintReport(h, !!force);
    avImportUiPaintLib(h, !!force);
    avImportUiStripPaint();   /* R21: the summary strip rides PaintAll too (memo'd) */
    avImportUiPaintRuns(h, !!force);
    avImportUiPaintManager(h);
    avImportUiPaintStorage(h);
    avImportUiPaintHist(h);
    avImportUiPaintBusy(h);
    return true;
  } catch (e) { return false; }
}

function avImportUiSync(host) {
  return avImportUiPaintAll(host || avImportUiHost(), false);
}

/* ---------- the import run ---------- */

function avImportUiImportedLine(r, c, items) {
  let line = "imported " + c.imported + " \u00b7 deferred " + c.deferred + " \u00b7 refused " + c.refused +
    " \u00b7 " + avImportUiFmtBytes(avImportUiImportedBytes(items)) + " -> library";
  const reason = avImportUiFirstReason(items);
  if (reason) line += " \u00b7 first: " + avImportUiShort(reason, 64);
  const errs = avImportUiErrorsOf(r);
  if (errs.length) line += " \u00b7 " + avImportUiShort(errs[0], 80);
  return line;
}

function avImportUiFinishImport(r0) {
  const s = avImportUiState;
  try {
    const r = (r0 && typeof r0 === "object") ? r0 : {};
    const counts = avImportUiCountsOf(r);
    const items = avImportUiItemsPub(r);
    s.last = {
      title: avImportUiStr(r.title, 80),
      at: avImportUiNumOr(r.at, Date.now()),
      counts: counts,
    };
    s.reportItems = items;
    s.runSeq += 1;
    s.lastError = (r.ok === true) ? "" : avImportUiErrText(r, "nothing was imported");
    let line = "";
    let kind = "msg";
    if (counts.total === 0) {
      const errs = avImportUiErrorsOf(r);
      line = "import refused \u2014 " + (errs.length ? errs[0] : avImportUiErrText(r, "nothing was imported"));
      kind = "err";
    } else {
      line = avImportUiImportedLine(r, counts, items);
      kind = (counts.imported > 0) ? "msg" : "err";
    }
    if (s.walkNote) {
      line += " \u00b7 " + s.walkNote;
      kind = "msg";
    }
    s.walkNote = "";
    avImportUiSetStatus(line, kind);
  } catch (e) {
    try { avImportUiState.lastError = avImportUiErrText(e, "the import failed"); } catch (e2) { /* ok */ }
  }
  s.busy = false;
  /* R17: a live run clears the history view (the report returns to the live receipt) */
  s.hist = null;
  avImportUiPaintAll(avImportUiHost(), false);
  avImportUiRefreshLib();
  /* R17: after EVERY completion -- the storage line refresh + the fire-and-forget receipt
     save (its settle refreshes the runs list; a failure notes into the status line) */
  avImportUiRefreshStorage();
  avImportUiSaveReceipt(r0 && typeof r0 === "object" ? r0 : {});
  return true;
}

/* avImportUiImport(files, opts) -> the core receipt (or a promise resolving to it; never
   rejects). Busy and absent-core cases refuse honestly with a receipt + status line. */
function avImportUiImport(files, opts) {
  const s = avImportUiState;
  try {
    if (s.busy) {
      avImportUiSetStatus("a run is already in progress \u2014 one op at a time", "err");
      return { ok: false, error: "a run is already in progress" };
    }
    if (typeof avImportFiles !== "function") {
      const msg = "the import core (av_import.js) is not present \u2014 imports are unavailable";
      avImportUiSetStatus(msg, "err");
      return { ok: false, error: msg };
    }
    const list = avImportUiToList(files);
    if (!list.length) {
      avImportUiSetStatus("no files \u2014 drop a folder or files", "err");
      return { ok: false, error: "no files" };
    }
    if (!avImportUiBegin("importing " + list.length + " file" + (list.length === 1 ? "" : "s"))) {
      return { ok: false, error: "a run is already in progress" };
    }
    let out = null;
    try { out = avImportFiles(list, opts); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the import failed") }; }
    if (out && typeof out.then === "function") {
      return out.then(
        function (r) { avImportUiFinishImport(r); return r; },
        function (e2) {
          const r = { ok: false, error: avImportUiErrText(e2, "the import failed") };
          avImportUiFinishImport(r);
          return r;
        }
      );
    }
    avImportUiFinishImport(out);
    return out;
  } catch (e) {
    try {
      s.busy = false;
      avImportUiPaintBusy(avImportUiHost());
    } catch (e2) { /* shell */ }
    return { ok: false, error: avImportUiErrText(e, "the import failed") };
  }
}

/* ---------- the five library actions (every core reach typeof-guarded per call) ---------- */

function avImportUiSlotValue() {
  try {
    /* R21: the slot select lives in the manager mount now */
    const el = avImportUiMgrFind("#av-import-slot");
    if (el && el.value !== "") {
      const n = Number(el.value);
      if (isFinite(n)) return Math.min(4, Math.max(1, Math.round(n)));
    }
  } catch (e) { /* none */ }
  return 1;
}

function avImportUiLoadLine(name, r) {
  try {
    if (r.kind === "pattern") {
      const p = (r.pattern && typeof r.pattern === "object") ? r.pattern : {};
      const notes = avImportUiNumOr(p.notes, avImportUiNumOr(p.noteCount, null));
      let line = "loaded " + name + " \u00b7 pattern";
      if (notes != null) line += " \u00b7 " + notes + " notes";
      return line;
    }
    if (r.kind === "kit") {
      return "loaded " + name + " \u00b7 kit \u00b7 " + avImportUiNumOr(r.slots, 0) + " slots \u00b7 " + avImportUiNumOr(r.zones, 0) + " zones";
    }
    if (r.kind === "refs") {
      return "loaded " + name + " \u00b7 refs \u00b7 " + avImportUiNumOr(r.refs, 0) + " refs";
    }
    if (r.kind === "song") {
      const applied = avImportUiNumOr(r.applied, 0);
      const wn = (r.warnings && typeof r.warnings.length === "number") ? r.warnings.length : 0;
      let line = "loaded " + name + " \u00b7 song \u00b7 applied " + applied;
      if (wn > 0) line += " \u00b7 " + wn + " warning" + (wn === 1 ? "" : "s");
      return line;
    }
    const eid = (r.entryId != null && String(r.entryId)) ? String(r.entryId) : "";
    return "loaded " + name + (eid ? " \u00b7 session entry " + avImportUiShort(eid, 40) : " \u00b7 session");
  } catch (e) { return "loaded " + name; }
}

function avImportUiActLoad(id) {
  const s = avImportUiState;
  const name = avImportUiLibName(id);
  try {
    if (s.busy) return avImportUiBusyRefuse();
    if (typeof avLibLoad !== "function") {
      avImportUiSetStatus("the library (av_lib.js) is not present \u2014 loading is unavailable", "err");
      return false;
    }
    if (!avImportUiBegin("loading " + name)) return false;
    let out = null;
    try { out = avLibLoad(id); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the load failed") }; }
    avImportUiSettle(out, function (r0) {
      const r = avImportUiReceipt(r0);
      avImportUiEnd();
      if (r.ok !== true) {
        avImportUiSetStatus("load refused \u2014 " + avImportUiErrText(r, "the library refused"), "err");
        return;
      }
      avImportUiSetStatus(avImportUiLoadLine(name, r), "msg");
    });
    return true;
  } catch (e) {
    avImportUiEnd();
    avImportUiSetStatus("load failed \u2014 " + avImportUiErrText(e, "unexpected"), "err");
    return false;
  }
}

function avImportUiActSend(id) {
  const s = avImportUiState;
  const name = avImportUiLibName(id);
  try {
    if (s.busy) return avImportUiBusyRefuse();
    if (typeof avLibLoad !== "function") {
      avImportUiSetStatus("the library (av_lib.js) is not present \u2014 sending is unavailable", "err");
      return false;
    }
    const slot = avImportUiSlotValue();
    if (!avImportUiBegin("sending " + name + " \u2192 slot " + slot)) return false;
    let out = null;
    try { out = avLibLoad(id); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the load failed") }; }
    avImportUiSettle(out, function (r0) {
      const r = avImportUiReceipt(r0);
      if (r.ok !== true) {
        avImportUiEnd();
        avImportUiSetStatus("send refused \u2014 " + avImportUiErrText(r, "the load was refused"), "err");
        return;
      }
      const eid = (r.entryId != null && String(r.entryId)) ? String(r.entryId) : "";
      if (r.kind === "pattern" || !eid) {
        avImportUiEnd();
        avImportUiSetStatus("send needs a sample \u2014 " + name + " loaded as " + (r.kind === "pattern" ? "a pattern" : "no session entry"), "err");
        return;
      }
      if (typeof avSampleSendToEngine !== "function") {
        avImportUiEnd();
        avImportUiSetStatus("the sample core (av_sample.js) is not present \u2014 sending is unavailable", "err");
        return;
      }
      let out2 = null;
      try { out2 = avSampleSendToEngine(eid, slot - 1); } catch (e2) { out2 = false; }
      avImportUiSettle(out2, function (x) {
        avImportUiEnd();
        const ok = (x === true) || (x && typeof x === "object" && x.ok === true);
        if (ok) avImportUiSetStatus("sent " + name + " \u2192 slot " + slot, "msg");
        else avImportUiSetStatus("send refused \u2014 the engine bridge refused (slot " + slot + ")", "err");
      });
    });
    return true;
  } catch (e) {
    avImportUiEnd();
    avImportUiSetStatus("send failed \u2014 " + avImportUiErrText(e, "unexpected"), "err");
    return false;
  }
}

/* best-effort drive of the chop card: paint its source list from the store, select the new
   entry when its option exists (never fakes the select state), dispatch a bubbling 'change',
   then reveal the zone through the shell seam */
function avImportUiDriveChop(eid) {
  const out = { drove: false, why: "" };
  try {
    const d = avImportUiDoc();
    if (!d || typeof d.getElementById !== "function") { out.why = "no document"; return out; }
    const chopHost = d.getElementById("av-chop-host");
    try {
      if (typeof avChopUiPaintSrc === "function") avChopUiPaintSrc(chopHost, true);
    } catch (e) { /* the repaint is best-effort */ }
    let sel = null;
    try { sel = d.getElementById("av-chop-src"); } catch (e) { sel = null; }
    if (sel) {
      let has = false;
      try {
        for (let i = 0; i < sel.options.length; i++) {
          if (sel.options[i].value === eid) { has = true; break; }
        }
      } catch (e) { has = false; }
      if (has) {
        try {
          sel.value = eid;
          if (typeof d.createEvent === "function") {
            const ev = d.createEvent("Event");
            ev.initEvent("change", true, false);
            sel.dispatchEvent(ev);
          } else if (typeof d.defaultView !== "undefined" && d.defaultView && typeof d.defaultView.Event === "function") {
            sel.dispatchEvent(new d.defaultView.Event("change", { bubbles: true }));
          }
          out.drove = true;
        } catch (e) { out.why = "the select refused the value"; }
      } else {
        out.why = "the chop source list has no option for it yet";
      }
    } else {
      out.why = "the chop card is not present";
    }
  } catch (e) { out.why = "the drive failed"; }
  try {
    const w = avImportUiWin();
    if (w && typeof w.__avZoneAuto === "function") w.__avZoneAuto("#av-chop");
  } catch (e) { /* the reveal is a nicety */ }
  return out;
}

function avImportUiActChop(id) {
  const s = avImportUiState;
  const name = avImportUiLibName(id);
  try {
    if (s.busy) return avImportUiBusyRefuse();
    if (typeof avLibLoad !== "function") {
      avImportUiSetStatus("the library (av_lib.js) is not present \u2014 chopping is unavailable", "err");
      return false;
    }
    if (!avImportUiBegin("loading " + name + " for the chop card")) return false;
    let out = null;
    try { out = avLibLoad(id); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the load failed") }; }
    avImportUiSettle(out, function (r0) {
      const r = avImportUiReceipt(r0);
      if (r.ok !== true) {
        avImportUiEnd();
        avImportUiSetStatus("chop refused \u2014 " + avImportUiErrText(r, "the load was refused"), "err");
        return;
      }
      const eid = (r.entryId != null && String(r.entryId)) ? String(r.entryId) : "";
      if (r.kind === "pattern" || !eid) {
        avImportUiEnd();
        avImportUiSetStatus("chop needs a sample \u2014 " + name + " loaded as " + (r.kind === "pattern" ? "a pattern" : "no session entry"), "err");
        return;
      }
      const d = avImportUiDriveChop(eid);
      avImportUiEnd();
      if (d.drove) avImportUiSetStatus("chop: " + name + " \u2192 source \u00b7 press DETECT in the chop card", "msg");
      else avImportUiSetStatus("chop: " + name + " loaded to the session \u2014 select it and press DETECT in the chop card", "msg");
    });
    return true;
  } catch (e) {
    avImportUiEnd();
    avImportUiSetStatus("chop failed \u2014 " + avImportUiErrText(e, "unexpected"), "err");
    return false;
  }
}

function avImportUiActSeq(id) {
  const s = avImportUiState;
  const name = avImportUiLibName(id);
  try {
    if (s.busy) return avImportUiBusyRefuse();
    if (typeof avLibLoad !== "function") {
      avImportUiSetStatus("the library (av_lib.js) is not present \u2014 seq loading is unavailable", "err");
      return false;
    }
    if (!avImportUiBegin("loading " + name + " into the sequencer")) return false;
    let out = null;
    try { out = avLibLoad(id); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the load failed") }; }
    avImportUiSettle(out, function (r0) {
      const r = avImportUiReceipt(r0);
      if (r.ok !== true) {
        avImportUiEnd();
        avImportUiSetStatus("seq refused \u2014 " + avImportUiErrText(r, "the load was refused"), "err");
        return;
      }
      /* R15c: an ALS refs item carries its pattern in the receipt (the refs load makes NO
         session change); the application runs the ONE avMid seq flow, step for step */
      if (r.kind === "refs") {
        if (!r.pattern || typeof r.pattern !== "object") {
          avImportUiEnd();
          avImportUiSetStatus("seq: no pattern in " + name, "err");
          return;
        }
        const ap = avImportUiSeqApply(r.pattern);
        avImportUiEnd();
        if (ap.ok !== true) {
          avImportUiSetStatus("seq refused \u2014 " + (ap.error || "the sequence core refused"), "err");
          return;
        }
        const k = avImportUiCountNotes(ap.feed);
        avImportUiSetStatus("seq: " + name + " \u2192 pattern" + (k >= 0 ? " \u00b7 " + k + " notes" : ""), "msg");
        return;
      }
      /* the undo law is push-AFTER-load; av_lib owns the push -- this is the belt-and-braces
         nudge (a duplicate push is a no-op by the undo module's no-change rule) */
      try { if (typeof avUndoPush === "function") avUndoPush("seq", "import"); } catch (e) { /* F optional */ }
      avImportUiEnd();
      const p = (r.pattern && typeof r.pattern === "object") ? r.pattern : {};
      const notes = avImportUiNumOr(p.notes, avImportUiNumOr(p.noteCount, null));
      avImportUiSetStatus("seq: " + name + " \u2192 pattern" + (notes != null ? " \u00b7 " + notes + " notes" : ""), "msg");
    });
    return true;
  } catch (e) {
    avImportUiEnd();
    avImportUiSetStatus("seq failed \u2014 " + avImportUiErrText(e, "unexpected"), "err");
    return false;
  }
}

function avImportUiActDel(id) {
  const s = avImportUiState;
  const name0 = avImportUiLibName(id);
  try {
    if (s.busy) return avImportUiBusyRefuse();
    if (typeof avLibRemove !== "function") {
      avImportUiSetStatus("the library (av_lib.js) is not present \u2014 removing is unavailable", "err");
      return false;
    }
    if (!avImportUiBegin("removing " + name0)) return false;
    const proceed = function (name) {
      let out = null;
      try { out = avLibRemove(id); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the remove failed") }; }
      avImportUiSettle(out, function (r0) {
        const r = avImportUiReceipt(r0);
        avImportUiEnd();
        if (r.ok !== true) avImportUiSetStatus("remove refused \u2014 " + avImportUiErrText(r, "the library refused"), "err");
        else avImportUiSetStatus("removed " + name, "msg");
        avImportUiRefreshLib();
      });
    };
    if (name0 === String(id == null ? "" : id) && typeof avLibGet === "function") {
      /* the cache has no name for this id: ask the library once (guarded, best-effort) so the
         status line carries the real name; the remove proceeds either way */
      let g = null;
      try { g = avLibGet(id); } catch (e) { g = null; }
      avImportUiSettle(g, function (r0) {
        const r = avImportUiReceipt(r0);
        const it = (r.ok === true && r.item && typeof r.item === "object") ? r.item : null;
        proceed((it && typeof it.name === "string" && it.name) ? it.name : name0);
      });
    } else {
      proceed(name0);
    }
    return true;
  } catch (e) {
    avImportUiEnd();
    avImportUiSetStatus("remove failed \u2014 " + avImportUiErrText(e, "unexpected"), "err");
    return false;
  }
}

/* R15c: apply an ALS pattern through the ONE seq flow (avSeqLoad -> avSeqSnap ->
   avSeqSetPattern -> avSeqUiSync -> avUndoPush("seq","import")); every reach guarded. */
function avImportUiSeqApply(pat) {
  try {
    if (typeof avSeqLoad !== "function" || typeof avSeqSetPattern !== "function") {
      return { ok: false, error: "no sequence module" };
    }
    let loaded = false;
    try { loaded = avSeqLoad(pat) === true; } catch (e) { loaded = false; }
    if (!loaded) return { ok: false, error: "avSeqLoad refused" };
    let feed = pat;
    try { if (typeof avSeqSnap === "function") { const s = avSeqSnap(); if (s && typeof s === "object") feed = s; } } catch (e) { /* raw pattern stands */ }
    let setOk = false;
    try { setOk = avSeqSetPattern(feed) !== false; } catch (e) { setOk = false; }
    if (!setOk) return { ok: false, error: "avSeqSetPattern refused" };
    try { if (typeof avSeqUiSync === "function") avSeqUiSync(); } catch (e) { /* repaint is a nicety */ }
    try { if (typeof avUndoPush === "function") avUndoPush("seq", "import"); } catch (e) { /* undo is a nicety */ }
    return { ok: true, feed: feed };
  } catch (e) {
    return { ok: false, error: "seq failed" };
  }
}

/* the active-step count of a seq pattern (for the status line; -1 when unreadable) */
function avImportUiCountNotes(feed) {
  try {
    let notes = 0;
    const tracks = (feed && Array.isArray(feed.tracks)) ? feed.tracks : [];
    for (let t = 0; t < tracks.length; t++) {
      const steps = (tracks[t] && Array.isArray(tracks[t].steps)) ? tracks[t].steps : [];
      for (let x = 0; x < steps.length; x++) { if (steps[x] && steps[x].on) notes += 1; }
    }
    return notes;
  } catch (e) { return -1; }
}

/* the KIT action (R15c): avLibLoad(id) -> "kit loaded \u2014 N slots \u00b7 M zones" or the
   honest refusal; one op at a time, never throws */
function avImportUiActKit(id) {
  const s = avImportUiState;
  const name = avImportUiLibName(id);
  try {
    if (s.busy) return avImportUiBusyRefuse();
    if (typeof avLibLoad !== "function") {
      avImportUiSetStatus("the library (av_lib.js) is not present \u2014 kit loading is unavailable", "err");
      return false;
    }
    if (!avImportUiBegin("loading kit " + name)) return false;
    let out = null;
    try { out = avLibLoad(id); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the load failed") }; }
    avImportUiSettle(out, function (r0) {
      const r = avImportUiReceipt(r0);
      avImportUiEnd();
      if (r.ok !== true) {
        avImportUiSetStatus("kit refused \u2014 " + avImportUiErrText(r, "the load was refused"), "err");
        return;
      }
      avImportUiSetStatus("kit loaded \u2014 " + avImportUiNumOr(r.slots, 0) + " slots \u00b7 " + avImportUiNumOr(r.zones, 0) + " zones", "msg");
    });
    return true;
  } catch (e) {
    avImportUiEnd();
    avImportUiSetStatus("kit failed \u2014 " + avImportUiErrText(e, "unexpected"), "err");
    return false;
  }
}

/* the act dispatcher (used by the delegated click and by the rig/harness directly) */
function avImportUiAct(act, id) {
  try {
    if (act === "load") return avImportUiActLoad(id);
    if (act === "send") return avImportUiActSend(id);
    if (act === "chop") return avImportUiActChop(id);
    if (act === "seq") return avImportUiActSeq(id);
    if (act === "kit") return avImportUiActKit(id);
    if (act === "del") return avImportUiActDel(id);
    /* R17: the management actions */
    if (act === "rename" || act === "export") return avImportUiActManaged(act, id);
    /* R18: the identity actions (replace commits; relink opens the inline editor) */
    if (act === "replace") return avImportUiActReplace(id);
    if (act === "relink") return avImportUiBeginRelink(id);
    /* R21: the inspector toggle (the row's INFO button routes here) */
    if (act === "info") return avImportUiInspect(id);
  } catch (e) {
    avImportUiSetStatus("the action failed \u2014 " + avImportUiErrText(e, "unexpected"), "err");
  }
  return false;
}

/* ---------- R17: the library manager (view state . selection . rename . export) ----------
   Every core reach is typeof-guarded PER CALL; every action obeys the ONE-op busy law. */

/* one view-state write -> the memo'd rebuild (libSig carries the manager state) */
function avImportUiMgrTouch(selChanged) {
  try {
    if (selChanged) avImportUiState.mgr.selSeq += 1;
    const host = avImportUiHost();
    avImportUiPaintLib(host, false);
    avImportUiPaintManager(host);
    return true;
  } catch (e) { return false; }
}

function avImportUiSetSearch(v) {
  try {
    const s = avImportUiState;
    const t = avImportUiStr(v, 120);
    if (t === s.mgr.search) return false;
    s.mgr.search = t;
    s.mgr.limit = AV_IMPORT_UI_LIB_STEP;   /* R21: a view change resets the incremental window */
    return avImportUiMgrTouch(false);
  } catch (e) { return false; }
}

function avImportUiSetFilter(f) {
  try {
    const s = avImportUiState;
    const raw = String(f == null ? "" : f);
    let t = "all";
    for (let i = 0; i < AV_IMPORT_UI_FILTERS.length; i++) if (AV_IMPORT_UI_FILTERS[i] === raw) t = raw;
    if (t === s.mgr.filter) return false;
    s.mgr.filter = t;
    s.mgr.limit = AV_IMPORT_UI_LIB_STEP;   /* R21: a view change resets the incremental window */
    return avImportUiMgrTouch(false);
  } catch (e) { return false; }
}

function avImportUiSetSort(v) {
  try {
    const s = avImportUiState;
    const raw = String(v == null ? "" : v);
    let t = "newest";
    for (let i = 0; i < AV_IMPORT_UI_SORTS.length; i++) if (AV_IMPORT_UI_SORTS[i] === raw) t = raw;
    if (t === s.mgr.sort) return false;
    s.mgr.sort = t;
    s.mgr.limit = AV_IMPORT_UI_LIB_STEP;   /* R21: a view change resets the incremental window */
    return avImportUiMgrTouch(false);
  } catch (e) { return false; }
}

/* R21: the format facet setter (same shape as SetFilter; an invalid value -> "all"; the
   incremental window resets; the mgr repaint rides MgrTouch) */
function avImportUiSetFormat(f) {
  try {
    const s = avImportUiState;
    const raw = String(f == null ? "" : f);
    let t = "all";
    for (let i = 0; i < AV_IMPORT_UI_FMTS.length; i++) if (AV_IMPORT_UI_FMTS[i] === raw) t = raw;
    if (t === s.mgr.fmt) return false;
    s.mgr.fmt = t;
    s.mgr.limit = AV_IMPORT_UI_LIB_STEP;
    return avImportUiMgrTouch(false);
  } catch (e) { return false; }
}

/* R21: the pack facet setter ("all" | "__none" | a source.pack slug; anything else -> "all") */
function avImportUiSetPack(p) {
  try {
    const s = avImportUiState;
    const raw = String(p == null ? "" : p);
    let t = "all";
    if (raw === "__none") t = "__none";
    else if (/^[a-z0-9][a-z0-9-]{0,63}$/.test(raw)) t = raw;
    if (t === s.mgr.pack) return false;
    s.mgr.pack = t;
    s.mgr.limit = AV_IMPORT_UI_LIB_STEP;
    return avImportUiMgrTouch(false);
  } catch (e) { return false; }
}

/* R21: show more -- extend the incremental window by one step and repaint; false when there
   is nothing more to show (or the manager is not mounted anywhere) */
function avImportUiMore() {
  try {
    const s = avImportUiState;
    const vis = avImportUiViewItems();
    const painted = Math.min(vis.length, s.mgr.limit, AV_IMPORT_UI_LIB_ROWS_MAX);
    if (!(vis.length > painted && painted < AV_IMPORT_UI_LIB_ROWS_MAX)) return false;
    s.mgr.limit += AV_IMPORT_UI_LIB_STEP;
    avImportUiMgrTouch(false);
    return true;
  } catch (e) { return false; }
}

/* the selected count + the selected ids in the mirror's own order (deterministic) */
function avImportUiSelCount() {
  let n = 0;
  try {
    const sel = avImportUiState.mgr.sel;
    for (const k in sel) { if (sel[k]) n += 1; }
  } catch (e) { n = 0; }
  return n;
}

function avImportUiSelIds() {
  const s = avImportUiState;
  const out = [];
  try {
    const src = s.lib.items || [];
    for (let i = 0; i < src.length; i++) {
      const id = src[i] && src[i].id;
      if (id && s.mgr.sel[id]) out.push(id);
    }
  } catch (e) { /* partial stands */ }
  return out;
}

function avImportUiToggleSel(id, on) {
  try {
    const s = avImportUiState;
    const sid = avImportUiStr(id, 80);
    if (!sid) return false;
    if (on) s.mgr.sel[sid] = 1; else delete s.mgr.sel[sid];
    return avImportUiMgrTouch(true);
  } catch (e) { return false; }
}

/* select-all toggle over the VISIBLE (filtered) rows */
function avImportUiSelAll() {
  const s = avImportUiState;
  try {
    const vis = avImportUiViewItems();
    if (!vis.length) return false;
    let allSel = true;
    for (let i = 0; i < vis.length; i++) { if (!s.mgr.sel[vis[i].id]) { allSel = false; break; } }
    for (let i = 0; i < vis.length; i++) {
      const id = vis[i].id;
      if (!id) continue;
      if (allSel) delete s.mgr.sel[id];
      else s.mgr.sel[id] = 1;
    }
    avImportUiMgrTouch(true);
    return true;
  } catch (e) { return false; }
}

/* one remove through the library (guarded per call); resolves true on ok -- never rejects */
function avImportUiRemoveOne(id) {
  return new Promise(function (resolve) {
    let out = null;
    try { out = avLibRemove(id); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the remove failed") }; }
    avImportUiSettle(out, function (r0) {
      const r = avImportUiReceipt(r0);
      resolve(r.ok === true);
    });
  });
}

/* delete-selected: sequential removes under ONE busy window, then refresh + "deleted N" */
function avImportUiDelSel() {
  const s = avImportUiState;
  try {
    if (s.busy) return avImportUiBusyRefuse();
    if (typeof avLibRemove !== "function") {
      avImportUiSetStatus("the library (av_lib.js) is not present \u2014 removing is unavailable", "err");
      return false;
    }
    const ids = avImportUiSelIds();
    if (!ids.length) {
      avImportUiSetStatus("nothing selected \u2014 tick rows first", "err");
      return false;
    }
    if (!avImportUiBegin("deleting " + ids.length + " item" + (ids.length === 1 ? "" : "s"))) return false;
    let gone = 0, stuck = 0;
    let chain = Promise.resolve();
    for (let i = 0; i < ids.length; i++) {
      (function (id) {
        chain = chain.then(function () {
          return avImportUiRemoveOne(id).then(function (ok) {
            if (ok) {
              gone += 1;
              try { delete s.mgr.sel[id]; } catch (e) { /* ok */ }
            } else stuck += 1;
          });
        });
      })(ids[i]);
    }
    chain.then(function () {
      avImportUiEnd();
      const line = "deleted " + gone + (stuck > 0 ? " \u00b7 " + stuck + " refused" : "");
      avImportUiSetStatus(line, (gone === 0 && stuck > 0) ? "err" : "msg");
      avImportUiMgrTouch(true);
      avImportUiRefreshLib();
    }, function () {
      avImportUiEnd();
      avImportUiSetStatus("deleted " + gone + (stuck > 0 ? " \u00b7 " + stuck + " refused" : ""), "err");
      avImportUiMgrTouch(true);
      avImportUiRefreshLib();
    });
    return true;
  } catch (e) {
    avImportUiEnd();
    avImportUiSetStatus("delete failed \u2014 " + avImportUiErrText(e, "unexpected"), "err");
    return false;
  }
}

/* ---------- R19: collect & pack (the selected library rows -> ONE .avpack file) ----------
   The build half lives in av_pack.js (window.__avPack; authored in parallel -- guarded PER
   CALL, absent -> honest refusal). The save half mirrors the av_proj.js seam: the guarded
   avProjPicker("save") reach (binding, then window -- an injected fs stays authoritative),
   an FSA write, then the avDeliverDownload(bytes, name) fallback (av_deliver_ui.js:930 --
   BYTES FIRST; the in-file export precedent calls dl(it.bytes, fname)). AbortError is a calm
   cancel and never falls back (the av_proj.js law); Blob bytes convert via arrayBuffer()
   (the S4 Blob->arrayBuffer law, av_video.js avVideoDownload's shape). ONE busy window. */

/* the guarded __avPack facade reach (the window facade; its build is the entry) */
function avImportUiPackFn() {
  try {
    const w = avImportUiWin();
    if (w && w.__avPack && typeof w.__avPack.build === "function") return w.__avPack;
  } catch (e) { /* no window */ }
  return null;
}

/* the guarded avProjPicker("save") reach -- { fs, fn } (call fn.call(fs, opts)), or null */
function avImportUiPackPicker() {
  try {
    if (typeof avProjPicker === "function") {
      const p = avProjPicker("save");
      if (p && typeof p.fn === "function") return p;
    }
  } catch (e) { /* not loaded */ }
  try {
    const w = avImportUiWin();
    if (w && typeof w.avProjPicker === "function") {
      const p = w.avProjPicker("save");
      if (p && typeof p.fn === "function") return p;
    }
  } catch (e2) { /* no window */ }
  return null;
}

/* the picker options (a fresh object per call); the .avpack rides application/zip */
function avImportUiPackTypes() {
  return [{ description: "Anvil user pack", accept: { "application/zip": [".avpack"] } }];
}

/* the error name out of anything ("AbortError" = the calm cancel) */
function avImportUiErrName(e) {
  try { if (e && typeof e.name === "string" && e.name) return e.name; } catch (e2) { /* none */ }
  return "";
}

/* the pack filename: the receipt name (or the manifest id), sanitised like the export names,
   capped at 120, with the .avpack suffix guaranteed */
function avImportUiPackFileName(r) {
  let name = "";
  try {
    name = String((r && r.name) || "").trim();
    if (!name) {
      const m = (r && r.manifest && typeof r.manifest === "object") ? r.manifest : null;
      name = String((m && m.id) || "").trim();
    }
  } catch (e) { name = ""; }
  if (!name) name = "pack";
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
  if (name.length > 120) name = name.slice(0, 120);
  const suffix = ".avpack";
  if (name.toLowerCase().slice(-suffix.length) === suffix) return name;
  return name + suffix;
}

/* the packed-item count (receipt counts.items, then manifest.items, else 0) */
function avImportUiPackCount(r) {
  let n = 0;
  try {
    if (r && r.counts && typeof r.counts === "object" && typeof r.counts.items === "number") {
      n = Math.round(r.counts.items);
    } else if (r && r.manifest && typeof r.manifest === "object" &&
               r.manifest.items && typeof r.manifest.items.length === "number") {
      n = r.manifest.items.length;
    }
  } catch (e) { n = 0; }
  return (isFinite(n) && n > 0) ? n : 0;
}

/* the honest refused count (receipt counts.refused, else 0) */
function avImportUiPackRefused(r) {
  let n = 0;
  try {
    if (r && r.counts && typeof r.counts === "object") n = Math.round(avImportUiNumOr(r.counts.refused, 0));
  } catch (e) { n = 0; }
  return (isFinite(n) && n > 0) ? n : 0;
}

/* the build's bytes -> a byte source the FSA write / avDeliverDownload accept, or null.
   Blob -> arrayBuffer (the S4 law; byteLength first, the av_video.js shape). Never throws. */
function avImportUiPackBytesOf(b) {
  return new Promise(function (resolve) {
    try {
      if (b && typeof b.byteLength === "number" && b.byteLength > 0) { resolve(b); return; }
      if (b && typeof b.size === "number" && typeof b.arrayBuffer === "function") {
        const p = b.arrayBuffer();
        if (p && typeof p.then === "function") {
          p.then(function (ab) {
            resolve((ab && typeof ab.byteLength === "number" && ab.byteLength > 0) ? ab : null);
          }, function () { resolve(null); });
          return;
        }
      }
    } catch (e) { /* null below */ }
    resolve(null);
  });
}

/* one FSA write attempt through the resolved seam; resolves { ok } | { cancelled } |
   { fallbackNote } -- never rejects */
function avImportUiPackFsa(bytes, name, pick) {
  return new Promise(function (resolve) {
    let done = false;
    const fin = function (v) { if (!done) { done = true; resolve(v); } };
    const writeStep = function (handle) {
      if (!handle || typeof handle.createWritable !== "function") {
        fin({ fallbackNote: "the save picker returned nothing" });
        return;
      }
      let stream = null;
      try { stream = handle.createWritable(); }
      catch (e2) {
        if (avImportUiErrName(e2) === "AbortError") { fin({ cancelled: true }); return; }
        fin({ fallbackNote: "the fsa write failed (" + (avImportUiErrName(e2) || "error") + ")" });
        return;
      }
      let ws = null;
      Promise.resolve(stream).then(function (s2) {
        ws = s2;
        if (!ws || typeof ws.write !== "function") throw new Error("no write");
        return ws.write(bytes);
      }).then(function () {
        if (ws && typeof ws.close === "function") return ws.close();
        return null;
      }).then(function () {
        fin({ ok: true });
      }, function (e3) {
        if (avImportUiErrName(e3) === "AbortError") { fin({ cancelled: true }); return; }
        fin({ fallbackNote: "the fsa write failed (" + (avImportUiErrName(e3) || "error") + ")" });
      });
    };
    let pr = null;
    try { pr = pick.fn.call(pick.fs, { suggestedName: name, types: avImportUiPackTypes() }); }
    catch (e) {
      if (avImportUiErrName(e) === "AbortError") { fin({ cancelled: true }); return; }
      fin({ fallbackNote: "the save picker refused (" + (avImportUiErrName(e) || "error") + ")" });
      return;
    }
    if (pr && typeof pr.then === "function") {
      pr.then(function (handle) { writeStep(handle); }, function (e4) {
        if (avImportUiErrName(e4) === "AbortError") { fin({ cancelled: true }); return; }
        fin({ fallbackNote: "the save picker refused (" + (avImportUiErrName(e4) || "error") + ")" });
      });
      return;
    }
    writeStep(pr);
  });
}

/* the avDeliverDownload fallback (clean boolean; never throws) */
function avImportUiPackDeliver(bytes, name) {
  const dl = avImportUiDeliverFn();
  if (typeof dl !== "function") return false;
  let ok = false;
  try {
    const x = dl(bytes, name);
    ok = (x === true) || !!(x && typeof x === "object" && x.ok === true);
  } catch (e) { ok = false; }
  return ok;
}

/* the save half: bytes -> FSA (the seam) or the download fallback; done(line, kind) runs once */
function avImportUiPackSave(r, done) {
  const finish = function (line, kind) { try { done(line, kind); } catch (e) { /* never throws outward */ } };
  const name = avImportUiPackFileName(r);
  const n = avImportUiPackCount(r);
  const refused = avImportUiPackRefused(r);
  const nTxt = (n > 0) ? (n + " item" + (n === 1 ? "" : "s")) : "the selection";
  let base = "packed " + nTxt + " -> " + name;
  if (refused > 0) base += " \u00b7 " + refused + " refused";
  if (n === 0 && refused > 0) {
    finish("packing refused \u2014 the build refused " + refused + " item" + (refused === 1 ? "" : "s"), "err");
    return;
  }
  avImportUiPackBytesOf(r.bytes).then(function (bytes) {
    if (!bytes) { finish("packing refused \u2014 the build returned no bytes", "err"); return; }
    const pick = avImportUiPackPicker();
    if (!pick) {
      if (avImportUiPackDeliver(bytes, name)) finish(base + " \u00b7 downloaded", "msg");
      else finish("packing refused \u2014 the download path (avDeliverDownload) is not present", "err");
      return;
    }
    avImportUiPackFsa(bytes, name, pick).then(function (res) {
      try {
        if (res && res.ok === true) { finish(base, "msg"); return; }
        if (res && res.cancelled === true) { finish("packing cancelled \u2014 nothing saved", "msg"); return; }
        const note = (res && res.fallbackNote) ? res.fallbackNote : "the save picker refused";
        if (avImportUiPackDeliver(bytes, name)) finish(base + " \u00b7 " + note + " \u2014 downloaded instead", "msg");
        else finish("packing refused \u2014 " + note + " and the download path (avDeliverDownload) is not present", "err");
      } catch (e) { finish("packing failed \u2014 " + avImportUiErrText(e, "unexpected"), "err"); }
    }, function () {
      if (avImportUiPackDeliver(bytes, name)) finish(base + " \u00b7 the save picker refused \u2014 downloaded instead", "msg");
      else finish("packing refused \u2014 the download path (avDeliverDownload) is not present", "err");
    });
  });
}

/* collect & pack: the selected library rows -> ONE .avpack (guarded build + save);
   ONE busy window; never throws */
function avImportUiPackSel() {
  const s = avImportUiState;
  try {
    if (s.busy) return avImportUiBusyRefuse();
    const ids = avImportUiSelIds();
    if (!ids.length) {
      avImportUiSetStatus("nothing selected \u2014 tick rows first", "err");
      return false;
    }
    const fac = avImportUiPackFn();
    if (!fac) {
      avImportUiSetStatus("packing is unavailable \u2014 the pack module (av_pack.js) is not present", "err");
      return false;
    }
    if (!avImportUiBegin("packing " + ids.length + " item" + (ids.length === 1 ? "" : "s"))) return false;
    let out = null;
    try { out = fac.build({ ids: ids }); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the build failed") }; }
    avImportUiSettle(out, function (r0) {
      const r = avImportUiReceipt(r0);
      if (r.ok !== true) {
        avImportUiEnd();
        avImportUiSetStatus("packing refused \u2014 " + avImportUiErrText(r, "the build refused"), "err");
        return;
      }
      try {
        avImportUiPackSave(r, function (line, kind) {
          avImportUiEnd();
          avImportUiSetStatus(line, kind);
        });
      } catch (e2) {
        avImportUiEnd();
        avImportUiSetStatus("packing failed \u2014 " + avImportUiErrText(e2, "unexpected"), "err");
      }
    });
    return true;
  } catch (e) {
    avImportUiEnd();
    avImportUiSetStatus("packing failed \u2014 " + avImportUiErrText(e, "unexpected"), "err");
    return false;
  }
}

/* rename commit: avLibRename (guarded) + refresh; the status line reports the result */
function avImportUiRename(id, name) {
  const s = avImportUiState;
  try {
    if (s.busy) return avImportUiBusyRefuse();
    if (typeof avLibRename !== "function") {
      avImportUiSetStatus("the library (av_lib.js) is not present \u2014 renaming is unavailable", "err");
      return false;
    }
    if (!avImportUiBegin("renaming " + avImportUiLibName(id))) return false;
    const raw = String(name == null ? "" : name);
    let out = null;
    try { out = avLibRename(id, raw); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the rename failed") }; }
    avImportUiSettle(out, function (r0) {
      const r = avImportUiReceipt(r0);
      avImportUiEnd();
      if (r.ok !== true) {
        avImportUiSetStatus("rename refused \u2014 " + avImportUiErrText(r, "the library refused"), "err");
      } else {
        const nm = avImportUiStr(r.name, 120) || avImportUiStr(raw, 120);
        avImportUiSetStatus("renamed to " + avImportUiShort(nm, 60), "msg");
      }
      avImportUiRefreshLib();
    });
    return true;
  } catch (e) {
    avImportUiEnd();
    avImportUiSetStatus("rename failed \u2014 " + avImportUiErrText(e, "unexpected"), "err");
    return false;
  }
}

/* cancel the inline editor: the name cell comes back with the current name */
function avImportUiCancelName(id, input) {
  try {
    const d = avImportUiDoc();
    if (!d || typeof d.createElement !== "function") return false;
    if (!input || !input.parentNode) return false;      /* already replaced by a refresh */
    const span = d.createElement("span");
    span.className = "av-import-item-name";
    const name = avImportUiLibName(id);
    span.textContent = name;
    if (typeof span.setAttribute === "function") span.setAttribute("title", name);
    input.parentNode.replaceChild(span, input);
    return true;
  } catch (e) { return false; }
}

/* the inline editor: click rename -> the name cell becomes input.av-import-rename
   (value = current name, maxlength 120); Enter commits via avLibRename + refresh;
   Esc and blur cancel. ONE editor at a time; never throws. */
function avImportUiBeginRename(id) {
  const s = avImportUiState;
  try {
    if (s.busy) return avImportUiBusyRefuse();
    const d = avImportUiDoc();
    if (!d || typeof d.createElement !== "function") return false;
    const mgr = avImportUiMgrRoot();
    if (!mgr || typeof mgr.querySelector !== "function") return false;
    if (mgr.querySelector(".av-import-rename") || mgr.querySelector(".av-import-relink")) return true;   /* one editor at a time (R18: the relink editor counts too) */
    const sid = avImportUiSelId(id);
    if (!sid) return false;
    let row = null;
    try { row = avImportUiMgrFind('[data-av-import-lib="' + sid + '"]'); } catch (e) { row = null; }
    if (!row) {
      avImportUiSetStatus("that row is gone \u2014 refresh the library list", "err");
      return false;
    }
    let cur = "";
    try {
      const items = s.lib.items || [];
      for (let i = 0; i < items.length; i++) if (items[i].id === id) { cur = String(items[i].name || ""); break; }
    } catch (e2) { cur = ""; }
    const input = d.createElement("input");
    input.type = "text";
    input.className = "av-import-rename";
    input.value = cur;
    try { input.maxLength = AV_IMPORT_UI_NAME_MAX; } catch (e3) { /* the attribute below stands */ }
    if (typeof input.setAttribute === "function") {
      input.setAttribute("maxlength", String(AV_IMPORT_UI_NAME_MAX));
      input.setAttribute("aria-label", "rename " + (cur || String(id)));
    }
    const done = { v: false };
    const commit = function () {
      if (done.v) return;
      done.v = true;
      avImportUiRename(id, input.value);
    };
    const cancel = function () {
      if (done.v) return;
      done.v = true;
      avImportUiCancelName(id, input);
    };
    input.addEventListener("keydown", function (ev) {
      try {
        if (ev.key === "Enter") { if (typeof ev.preventDefault === "function") ev.preventDefault(); commit(); }
        else if (ev.key === "Escape") { if (typeof ev.preventDefault === "function") ev.preventDefault(); cancel(); }
      } catch (e4) { /* a listener never throws outward */ }
    });
    input.addEventListener("blur", function () { try { cancel(); } catch (e5) { /* ok */ } });
    let nameEl = null;
    try { nameEl = row.querySelector(".av-import-item-name"); } catch (e6) { nameEl = null; }
    if (nameEl && nameEl.parentNode) nameEl.parentNode.replaceChild(input, nameEl);
    else if (row.firstChild) row.insertBefore(input, row.firstChild);
    else row.appendChild(input);
    try { input.focus(); if (typeof input.select === "function") input.select(); } catch (e7) { /* focus is a nicety */ }
    avImportUiSetStatus("rename \u2014 type the new name; Enter saves, Esc cancels", "msg");
    return true;
  } catch (e) { return false; }
}

/* per-item export: avLibGet (the FULL record incl. bytes) -> avDeliverDownload(bytes, name);
   the filename is "<name>.<ext>" with the pinned fallback map, then the typed status line */
function avImportUiExportItem(id) {
  const s = avImportUiState;
  const name0 = avImportUiLibName(id);
  try {
    if (s.busy) return avImportUiBusyRefuse();
    if (typeof avLibGet !== "function") {
      avImportUiSetStatus("the library (av_lib.js) is not present \u2014 exporting is unavailable", "err");
      return false;
    }
    if (!avImportUiBegin("exporting " + name0)) return false;
    let out = null;
    try { out = avLibGet(id); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the read failed") }; }
    avImportUiSettle(out, function (r0) {
      let line = "", kind = "msg";
      try {
        const r = avImportUiReceipt(r0);
        const it = (r.ok === true && r.item && typeof r.item === "object") ? r.item : null;
        if (!it) {
          line = "export refused \u2014 " + avImportUiErrText(r, "the item is gone");
          kind = "err";
        } else if (!it.bytes || typeof it.bytes.byteLength !== "number") {
          line = "export refused \u2014 no stored bytes for " + name0;
          kind = "err";
        } else {
          const dl = avImportUiDeliverFn();
          if (typeof dl !== "function") {
            line = "export refused \u2014 the download path (avDeliverDownload) is not present";
            kind = "err";
          } else {
            const fname = avImportUiExportName(it);
            let ok = false;
            try {
              const x = dl(it.bytes, fname);
              ok = (x === true) || !!(x && typeof x === "object" && x.ok === true);
            } catch (e2) { ok = false; }
            if (ok) line = "exported " + fname;
            else { line = "export refused \u2014 the download was refused"; kind = "err"; }
          }
        }
      } catch (e3) {
        line = "export failed \u2014 " + avImportUiErrText(e3, "unexpected");
        kind = "err";
      }
      avImportUiEnd();
      avImportUiSetStatus(line, kind);
    });
    return true;
  } catch (e) {
    avImportUiEnd();
    avImportUiSetStatus("export failed \u2014 " + avImportUiErrText(e, "unexpected"), "err");
    return false;
  }
}

/* the act dispatcher's R17 arms (the row buttons route here through avImportUiAct) */
function avImportUiActManaged(act, id) {
  try {
    if (act === "rename") return avImportUiBeginRename(id);
    if (act === "export") return avImportUiExportItem(id);
  } catch (e) { /* the dispatcher's own catch stands */ }
  return false;
}

/* ---------- R21: the item inspector (the per-row INFO action + #av-import-detail) ---------- */

/* the INFO row action: toggle state.mgr.insp (the same id closes it), repaint list + panel;
   true when the panel ends open; an empty id closes an open panel (false) */
function avImportUiInspect(id) {
  try {
    const s = avImportUiState;
    const sid = avImportUiSelId(id);
    if (!sid) {
      if (!s.mgr.insp) return false;
      s.mgr.insp = "";
      avImportUiMgrTouch(false);
      return false;
    }
    s.mgr.insp = (s.mgr.insp === sid) ? "" : sid;
    avImportUiMgrTouch(false);
    return s.mgr.insp === sid;
  } catch (e) { return false; }
}

/* one escaped label/value line of the panel */
function avImportUiDetailLine(k, v, title) {
  return '<div class="av-import-detail-line"><span class="av-import-detail-key av-dim">' + avImportUiEsc(k) +
    '</span><span class="av-import-detail-val"' + (title ? ' title="' + avImportUiEsc(title) + '"' : "") +
    ">" + avImportUiEsc(v) + "</span></div>";
}

/* the open panel's HTML out of ONE mirror record (every value escaped; the optional fields --
   sha256 . dupOf . source . meta -- are omitted honestly when absent) */
function avImportUiDetailHTML(it) {
  let html = '<button type="button" class="av-btn mini" id="av-import-detail-close" aria-label="close the inspector" title="close">\u00d7</button>';
  try {
    const name = String(it.name || it.id || "");
    html += avImportUiDetailLine("NAME", name, name);
    html += avImportUiDetailLine("id", String(it.id || ""));
    html += avImportUiDetailLine("kind", String(it.kind || "item"));
    html += avImportUiDetailLine("format", String(it.format || "") + (it.ext ? " / " + String(it.ext) : ""));
    html += avImportUiDetailLine("size", avImportUiFmtBytes(it.size) + " \u00b7 " + avImportUiNumOr(it.size, 0) + " B");
    const at = avImportUiNumOr(it.at, 0);
    if (at > 0) {
      let when = "";
      try { when = new Date(at).toLocaleString(); } catch (e) { when = ""; }
      html += avImportUiDetailLine("added", when || String(at));
    }
    const src = (it.source && typeof it.source === "object") ? it.source : null;
    if (src) {
      if (src.name) html += avImportUiDetailLine("from", String(src.name), String(src.name));
      if (src.path) {
        html += avImportUiDetailLine("path", String(src.path), String(src.path));
        const parts = String(src.path).split(/[\\/]+/);
        let folder = "";
        try { parts.pop(); folder = parts.join("/"); } catch (e4) { folder = ""; }
        if (folder) html += avImportUiDetailLine("folder", folder, folder);
      }
      if (src.pack) html += avImportUiDetailLine("pack", String(src.pack));
      if (src.replaced === true) html += avImportUiDetailLine("replaced", "yes");
    }
    const sha = String(it.sha256 || "");
    if (sha) html += avImportUiDetailLine("sha256", sha.slice(0, 16) + "\u2026", sha);
    const dup = (it.dupOf && typeof it.dupOf === "object") ? it.dupOf : null;
    if (dup) html += avImportUiDetailLine("duplicate of", String(dup.name || dup.id || ""));
    let metaTxt = "";
    try {
      const keys = (it.meta && typeof it.meta === "object") ? Object.keys(it.meta) : [];
      if (keys.length) {
        metaTxt = JSON.stringify(it.meta, null, 2);
        if (!metaTxt) metaTxt = "";
        if (metaTxt.length > 2048) metaTxt = metaTxt.slice(0, 2048) + "\u2026";
      }
    } catch (e5) { metaTxt = ""; }
    if (metaTxt) html += '<pre class="av-import-detail-meta av-mono av-dim">' + avImportUiEsc(metaTxt) + "</pre>";
  } catch (e) { /* the button stands */ }
  return html;
}

/* paint #av-import-detail from state.mgr.insp (an open item -> the fields; none -> hidden) */
function avImportUiPaintDetail() {
  try {
    const el = avImportUiMgrFind("#av-import-detail");
    if (!el) return false;
    const s = avImportUiState;
    const id = String(s.mgr.insp || "");
    let it = null;
    if (id) {
      const items = s.lib.items || [];
      for (let i = 0; i < items.length; i++) {
        if (items[i] && items[i].id === id) { it = items[i]; break; }
      }
    }
    if (!it) {
      if (el.hidden !== true) el.hidden = true;
      if (el.innerHTML !== "") el.innerHTML = "";
      return false;
    }
    const html = avImportUiDetailHTML(it);
    if (el.innerHTML !== html) el.innerHTML = html;
    if (el.hidden !== false) el.hidden = false;
    return true;
  } catch (e) { return false; }
}

/* ---------- R21: the bulk actions (sequential, ONE busy window, cap AV_IMPORT_UI_BULK_MAX) ---------- */

/* one step promise for load . send . chop . seq over ONE id; resolves {ok, why?}; a step
   never rejects and never throws (the chain's own catch is the belt) */
function avImportUiBulkStep(act, id, slot) {
  return new Promise(function (resolve) {
    const fail = function (why) { resolve({ ok: false, why: String(why || "refused") }); };
    try {
      if (typeof avLibLoad !== "function") { fail("the library (av_lib.js) is not present"); return; }
      let out = null;
      try { out = avLibLoad(id); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the load failed") }; }
      avImportUiSettle(out, function (r0) {
        try {
          const r = avImportUiReceipt(r0);
          if (r.ok !== true) { fail(avImportUiErrText(r, "the load was refused")); return; }
          if (act === "load") { resolve({ ok: true }); return; }
          const eid = (r.entryId != null && String(r.entryId)) ? String(r.entryId) : "";
          if (act === "send") {
            if (r.kind === "pattern" || !eid) { fail("needs a sample"); return; }
            let out2 = null;
            try { out2 = avSampleSendToEngine(eid, slot - 1); } catch (e2) { out2 = false; }
            avImportUiSettle(out2, function (x) {
              const ok = (x === true) || (x && typeof x === "object" && x.ok === true);
              if (ok) resolve({ ok: true });
              else fail("the engine bridge refused (slot " + slot + ")");
            });
            return;
          }
          if (act === "chop") {
            if (r.kind === "pattern" || !eid) { fail("needs a sample"); return; }
            avImportUiDriveChop(eid);
            resolve({ ok: true });
            return;
          }
          if (act === "seq") {
            if (r.kind === "refs") {
              if (!r.pattern || typeof r.pattern !== "object") { fail("no pattern in the refs item"); return; }
              const ap = avImportUiSeqApply(r.pattern);
              if (ap.ok !== true) { fail(ap.error || "the sequence core refused"); return; }
              resolve({ ok: true });
              return;
            }
            try { if (typeof avUndoPush === "function") avUndoPush("seq", "import"); } catch (e3) { /* F optional */ }
            resolve({ ok: true });
            return;
          }
          fail("unknown action");
        } catch (e) { fail("unexpected"); }
      });
    } catch (e) { fail("unexpected"); }
  });
}

/* the sequential walker: ONE busy window, one id at a time, progress in the status line
   ("bulk load 3/12 - name"), then the honest summary */
function avImportUiBulkChain(act, ids, slot) {
  const total = ids.length;
  let i = 0, ok = 0, bad = 0, firstWhy = "";
  const next = function () {
    try {
      if (i >= total) {
        avImportUiEnd();
        let line = "bulk " + act + " \u2014 " + ok + " of " + total + " ok";
        if (bad > 0) line += " \u00b7 " + bad + " failed" + (firstWhy ? " \u00b7 first: " + avImportUiShort(firstWhy, 64) : "");
        avImportUiSetStatus(line, (ok === 0 && bad > 0) ? "err" : "msg");
        return;
      }
      const id = ids[i];
      const name = avImportUiLibName(id);
      i += 1;
      avImportUiSetStatus("bulk " + act + " " + i + "/" + total + " - " + avImportUiShort(name, 48), "msg");
      avImportUiBulkStep(act, id, slot).then(function (res) {
        try {
          if (res && res.ok) ok += 1;
          else { bad += 1; if (!firstWhy && res && res.why) firstWhy = String(res.why); }
        } catch (e) { bad += 1; }
        next();
      }, function () { bad += 1; next(); });
    } catch (e) {
      avImportUiEnd();
      avImportUiSetStatus("bulk " + act + " failed \u2014 " + avImportUiErrText(e, "unexpected"), "err");
    }
  };
  next();
}

/* bulk export: ONE zip -- entry names = the item export names (sanitised, "-2" style dedupe),
   bytes from avLibGet (the record's .bytes payload), built with the real avZipBuild writer
   (the av_pack.js call shape: avZipBuild(entries, { date: null })) and downloaded through the
   card EXP path (avDeliverDownload, the Blob->arrayBuffer law first). Every missing piece is
   refused honestly, naming it. ONE busy window. */
function avImportUiBulkExport(ids) {
  const total = ids.length;
  try {
    if (typeof avLibGet !== "function") {
      avImportUiSetStatus("bulk export refused \u2014 the library (av_lib.js) is not present", "err");
      return false;
    }
    if (typeof avZipBuild !== "function") {
      avImportUiSetStatus("bulk export refused \u2014 the zip writer (av_zipc.js avZipBuild) is not present", "err");
      return false;
    }
    const dl = avImportUiDeliverFn();
    if (typeof dl !== "function") {
      avImportUiSetStatus("bulk export refused \u2014 the download path (avDeliverDownload) is not present", "err");
      return false;
    }
    if (!avImportUiBegin("exporting " + total + " item" + (total === 1 ? "" : "s") + " as one zip")) return false;
    const entries = [];
    const used = {};
    const entryNameFor = function (it) {
      const base = avImportUiExportName(it);
      let name = base;
      let n = 2;
      while (used[name.toLowerCase()]) {
        const dot = base.lastIndexOf(".");
        const stem = (dot > 0) ? base.slice(0, dot) : base;
        const ext = (dot > 0) ? base.slice(dot) : "";
        name = stem + "-" + n + ext;
        n += 1;
        if (n > 999) break;   /* bounded; the export names cap at 120 chars anyway */
      }
      used[name.toLowerCase()] = 1;
      return name;
    };
    const walk = function (i) {
      try {
        if (i >= total) {
          let buf = null;
          try { buf = avZipBuild(entries, { date: null }); } catch (e) { buf = null; }
          if (!buf || typeof buf.byteLength !== "number" || buf.byteLength < 1) {
            avImportUiEnd();
            avImportUiSetStatus("bulk export refused \u2014 the zip writer refused", "err");
            return;
          }
          avImportUiPackBytesOf(buf).then(function (bytes) {
            try {
              if (!bytes) {
                avImportUiEnd();
                avImportUiSetStatus("bulk export refused \u2014 the zip writer returned no bytes", "err");
                return;
              }
              const name = "anvil-library-" + total + ".zip";
              let ok = false;
              try {
                const x = dl(bytes, name);
                ok = (x === true) || !!(x && typeof x === "object" && x.ok === true);
              } catch (e2) { ok = false; }
              avImportUiEnd();
              if (ok) avImportUiSetStatus("exported " + name + " \u00b7 " + total + " item" + (total === 1 ? "" : "s"), "msg");
              else avImportUiSetStatus("bulk export refused \u2014 the download was refused", "err");
            } catch (e3) {
              avImportUiEnd();
              avImportUiSetStatus("bulk export failed \u2014 " + avImportUiErrText(e3, "unexpected"), "err");
            }
          });
          return;
        }
        avImportUiSetStatus("bulk export " + (i + 1) + "/" + total + " - " + avImportUiShort(avImportUiLibName(ids[i]), 48), "msg");
        let out = null;
        try { out = avLibGet(ids[i]); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the read failed") }; }
        avImportUiSettle(out, function (r0) {
          try {
            const r = avImportUiReceipt(r0);
            const it = (r.ok === true && r.item && typeof r.item === "object") ? r.item : null;
            if (!it) {
              avImportUiEnd();
              avImportUiSetStatus("bulk export refused \u2014 " + avImportUiErrText(r, "an item could not be read") + " (" + avImportUiShort(avImportUiLibName(ids[i]), 40) + ")", "err");
              return;
            }
            if (!it.bytes || typeof it.bytes.byteLength !== "number" || it.bytes.byteLength < 1) {
              avImportUiEnd();
              avImportUiSetStatus("bulk export refused \u2014 no stored bytes for " + avImportUiShort(avImportUiLibName(ids[i]), 48), "err");
              return;
            }
            entries.push({ name: entryNameFor(it), data: it.bytes });
            walk(i + 1);
          } catch (e2) {
            avImportUiEnd();
            avImportUiSetStatus("bulk export failed \u2014 " + avImportUiErrText(e2, "unexpected"), "err");
          }
        });
      } catch (e) {
        avImportUiEnd();
        avImportUiSetStatus("bulk export failed \u2014 " + avImportUiErrText(e, "unexpected"), "err");
      }
    };
    walk(0);
    return true;
  } catch (e) {
    avImportUiEnd();
    avImportUiSetStatus("bulk export failed \u2014 " + avImportUiErrText(e, "unexpected"), "err");
    return false;
  }
}

/* the pinned bulk entry: acts load . send . chop . seq . export (delete routes to the EXISTING
   delete-selected path); the selected ids in mirror order, sequential, ONE busy window, the
   cap AV_IMPORT_UI_BULK_MAX with an honest refusal above it */
function avImportUiBulk(act) {
  const a = String(act == null ? "" : act);
  try {
    if (a === "delete") return avImportUiDelSel();
    if (a !== "load" && a !== "send" && a !== "chop" && a !== "seq" && a !== "export") return false;
    const s = avImportUiState;
    if (s.busy) return avImportUiBusyRefuse();
    const ids = avImportUiSelIds();
    if (!ids.length) {
      avImportUiSetStatus("nothing selected \u2014 tick rows first", "err");
      return false;
    }
    if (ids.length > AV_IMPORT_UI_BULK_MAX) {
      avImportUiSetStatus("bulk " + a + " refused \u2014 " + ids.length + " selected; the cap is " + AV_IMPORT_UI_BULK_MAX, "err");
      return false;
    }
    if (a === "export") return avImportUiBulkExport(ids);
    if (typeof avLibLoad !== "function") {
      avImportUiSetStatus("the library (av_lib.js) is not present \u2014 bulk " + a + " is unavailable", "err");
      return false;
    }
    if (a === "send" && typeof avSampleSendToEngine !== "function") {
      avImportUiSetStatus("the sample core (av_sample.js) is not present \u2014 bulk sending is unavailable", "err");
      return false;
    }
    const slot = avImportUiSlotValue();
    if (!avImportUiBegin("bulk " + a + " \u00b7 " + ids.length + " item" + (ids.length === 1 ? "" : "s"))) return false;
    avImportUiBulkChain(a, ids, slot);
    return true;
  } catch (e) {
    avImportUiEnd();
    avImportUiSetStatus("bulk failed \u2014 " + avImportUiErrText(e, "unexpected"), "err");
    return false;
  }
}

/* ---------- R18: identity (duplicates . missing refs . relink) --
   The av_lib half (avLibReplaceDup / avLibMissingScan / avLibRename) is authored in parallel
   and lands in the same build; every reach here is typeof-guarded PER CALL, so the card still
   mounts and refuses honestly without it. One scan per completed library refresh; ONE op at a
   time (busy law); ONE editor at a time (the rename editor's law). */

/* the scan count (snap.missing . the libstat suffix . the facade missing()) */
function avImportUiMissingCount() {
  try { return Math.max(0, Math.round(avImportUiNumOr(avImportUiState.missing.count, 0))); }
  catch (e) { return 0; }
}

/* the (first, name-sorted) missing reference that wants this library record; "" when none */
function avImportUiMissingNameOf(id) {
  try {
    const byId = avImportUiState.missing.byId;
    if (!byId) return "";
    return avImportUiStr(byId[id], 120);
  } catch (e) { return ""; }
}

/* the lowercase basename (a local mirror of av_lib's avLibBaseLower so this card never depends
   on the library being loaded; the same normal form the kit load matches on) */
function avImportUiBaseLower(s) {
  try {
    const t = String(s == null ? "" : s);
    const parts = t.split(/[\\/]+/);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i]) return parts[i].toLowerCase().replace(/[\u0000-\u001f\u007f]/g, "");
    }
  } catch (e) { /* none */ }
  return "";
}

/* the basename minus the final extension ("Kick.WAV" -> "kick"; "a.b.c" -> "a.b") */
function avImportUiStem(s) {
  const b = avImportUiBaseLower(s);
  const i = b.lastIndexOf(".");
  return (i > 0 && i < b.length - 1) ? b.slice(0, i) : b;
}

/* one scan entry's `want` array ({id, name, kind} records asking for the missing name) */
function avImportUiWantPub(w) {
  const out = [];
  try {
    if (!w || typeof w.length !== "number") return out;
    const n = Math.min(w.length | 0, 32);
    for (let i = 0; i < n; i++) {
      const it = w[i];
      if (!it || typeof it !== "object") continue;
      const id = avImportUiSelId(it.id);
      if (!id) continue;
      out.push({ id: id, name: avImportUiStr(it.name, 120), kind: avImportUiStr(it.kind, 24) });
    }
  } catch (e) { /* partial stands */ }
  return out;
}

/* write one avLibMissingScan receipt into the memo + repaint (the chips + the libstat) */
function avImportUiApplyMissing(r0) {
  const s = avImportUiState;
  try {
    const r = avImportUiReceipt(r0);
    const m = s.missing;
    if (r.ok !== true) {
      m.ok = false;
      m.error = avImportUiErrText(r, "the missing-refs scan failed");
      m.count = 0;
      m.list = [];
      m.byId = {};
    } else {
      const src = (r.missing && typeof r.missing.length === "number") ? r.missing : [];
      const entries = [];
      for (let i = 0; i < src.length; i++) {
        const e = src[i];
        if (!e || typeof e !== "object") continue;
        const name = avImportUiStr(e.name, 120);
        if (!name) continue;
        entries.push({ name: name, want: avImportUiWantPub(e.want) });
      }
      /* name-sorted (the scan pins this; re-sorted defensively for a deterministic paint) */
      entries.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
      const byId = {};
      for (let i = 0; i < entries.length; i++) {
        const want = entries[i].want;
        for (let k = 0; k < want.length; k++) {
          if (want[k].id && !byId[want[k].id]) byId[want[k].id] = entries[i].name;
        }
      }
      m.ok = true;
      m.error = "";
      m.count = entries.length;
      m.list = entries;
      m.byId = byId;
    }
    /* the paint key: ok . count . the wanted record ids (bounded by the scan) */
    let sig = (m.ok ? "1" : "0") + "|" + m.count;
    try {
      const ids = [];
      for (const k in m.byId) ids.push(k);
      ids.sort();
      sig += "|" + ids.join(",");
    } catch (e2) { /* the count stands */ }
    m.sig = sig;
    m.at = Date.now();
    avImportUiPaintLib(avImportUiHost(), false);
    return true;
  } catch (e) { return false; }
}

/* the missing scan: avLibMissingScan (guarded) -> memo -> repaint; Promise<bool>, never
   rejects. Fired after every completed library refresh (and so after runs and relinks). */
function avImportUiRefreshMissing() {
  return new Promise(function (resolve) {
    let done = false;
    const finish = function (v) { if (!done) { done = true; resolve(v); } };
    try {
      if (typeof avLibMissingScan !== "function") {
        avImportUiApplyMissing({ ok: false, error: "the missing-refs scan (the av_lib.js R18 half) is not present" });
        finish(false);
        return;
      }
      let out = null;
      try { out = avLibMissingScan(); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the missing-refs scan failed") }; }
      avImportUiSettle(out, function (r0) {
        try { avImportUiApplyMissing(r0); } catch (e) { /* apply never throws */ }
        finish(true);
      });
    } catch (e) { finish(false); }
  });
}

/* the REPLACE action (R18): the row being driven is the flagged COPY (it carries dupOf) --
   guarded avLibReplaceDup(id) folds this copy into the original, then the refresh repaints;
   status "replaced with <name>" or the honest refusal. ONE op at a time; never throws. */
function avImportUiActReplace(id) {
  const s = avImportUiState;
  try {
    if (s.busy) return avImportUiBusyRefuse();
    if (typeof avLibReplaceDup !== "function") {
      avImportUiSetStatus("the library (av_lib.js) is not present \u2014 replacing is unavailable", "err");
      return false;
    }
    /* the name the status line reports: the original's live name, else its flagged name */
    let targetName = "";
    try {
      const items = s.lib.items || [];
      for (let i = 0; i < items.length; i++) {
        if (items[i] && items[i].id === id) {
          const d = items[i].dupOf;
          if (d && typeof d === "object") {
            targetName = avImportUiStr(d.name, 120);
            const tId = avImportUiSelId(d.id);
            if (tId) {
              const live = avImportUiLibName(tId);
              if (live && live !== tId) targetName = live;
            }
          }
          break;
        }
      }
    } catch (e2) { /* the fallback below stands */ }
    if (!targetName) targetName = avImportUiLibName(id);
    if (!avImportUiBegin("replacing " + avImportUiShort(targetName, 48))) return false;
    let out = null;
    try { out = avLibReplaceDup(id); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the replace failed") }; }
    avImportUiSettle(out, function (r0) {
      const r = avImportUiReceipt(r0);
      avImportUiEnd();
      if (r.ok !== true) {
        avImportUiSetStatus("replace refused \u2014 " + avImportUiErrText(r, "the library refused"), "err");
      } else {
        avImportUiSetStatus("replaced with " + avImportUiShort(targetName, 60), "msg");
      }
      avImportUiRefreshLib();
    });
    return true;
  } catch (e) {
    avImportUiEnd();
    avImportUiSetStatus("replace failed \u2014 " + avImportUiErrText(e, "unexpected"), "err");
    return false;
  }
}

/* the relink candidates: every library item, ranked -- items whose lowercase basename-stem
   matches the missing name's stem first, then the rest (mirror order inside each rank, so the
   newest-first mirror order is the tie-break). Deterministic; never throws. */
function avImportUiRelinkCandidates(missingName) {
  const out = [];
  try {
    const src = avImportUiState.lib.items || [];
    const want = avImportUiStem(missingName);
    const first = [];
    const rest = [];
    for (let i = 0; i < src.length; i++) {
      const it = src[i];
      if (!it || !it.id) continue;
      if (want && avImportUiStem(it.name) === want) first.push(it);
      else rest.push(it);
    }
    for (let i = 0; i < first.length; i++) out.push(first[i]);
    for (let i = 0; i < rest.length; i++) out.push(rest[i]);
  } catch (e) { return []; }
  return out;
}

/* close the relink editor (remove the select; the row keeps exactly what it had) */
function avImportUiCloseRelink(sel) {
  try {
    if (sel && sel.parentNode) sel.parentNode.removeChild(sel);
    return true;
  } catch (e) { return false; }
}

/* the relink commit (the facade's relink(name, candidateId) and the editor's Enter route
   here): guarded avLibRename(candidateId, missingName) -> refresh (which rescans) -> status
   "relinked <name>" or the honest refusal. ONE op at a time; never throws. */
function avImportUiRelink(candidateId, name) {
  const s = avImportUiState;
  const raw = String(name == null ? "" : name);
  try {
    if (s.busy) return avImportUiBusyRefuse();
    if (typeof avLibRename !== "function") {
      avImportUiSetStatus("the library (av_lib.js) is not present \u2014 relinking is unavailable", "err");
      return false;
    }
    if (!avImportUiBegin("relinking " + avImportUiShort(raw || "item", 48))) return false;
    let out = null;
    try { out = avLibRename(candidateId, raw); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the relink failed") }; }
    avImportUiSettle(out, function (r0) {
      const r = avImportUiReceipt(r0);
      avImportUiEnd();
      if (r.ok !== true) {
        avImportUiSetStatus("relink refused \u2014 " + avImportUiErrText(r, "the library refused"), "err");
      } else {
        const nm = avImportUiStr(r.name, 120) || raw;
        avImportUiSetStatus("relinked " + avImportUiShort(nm, 60), "msg");
      }
      avImportUiRefreshLib();   /* the rescan fires from the refresh */
    });
    return true;
  } catch (e) {
    avImportUiEnd();
    avImportUiSetStatus("relink failed \u2014 " + avImportUiErrText(e, "unexpected"), "err");
    return false;
  }
}

/* the RELINK row action: the inline editor -- select.av-import-relink inside the row, options =
   the library items (ranked; label "name (kind)"), Enter commits, Esc/blur cancels. ONE editor
   at a time (the rename editor's law; never over a rename editor, and vice versa). */
function avImportUiBeginRelink(id) {
  const s = avImportUiState;
  try {
    if (s.busy) return avImportUiBusyRefuse();
    const missingName = avImportUiMissingNameOf(id);
    if (!missingName) {
      avImportUiSetStatus("no missing reference is waiting on that item \u2014 refresh the library list", "err");
      return false;
    }
    const mgr = avImportUiMgrRoot();
    const d = avImportUiDoc();
    if (!mgr || typeof mgr.querySelector !== "function" || !d || typeof d.createElement !== "function") return false;
    if (mgr.querySelector(".av-import-relink") || mgr.querySelector(".av-import-rename")) return true;   /* one editor at a time */
    const sid = avImportUiSelId(id);
    if (!sid) return false;
    let row = null;
    try { row = avImportUiMgrFind('[data-av-import-lib="' + sid + '"]'); } catch (e) { row = null; }
    if (!row) {
      avImportUiSetStatus("that row is gone \u2014 refresh the library list", "err");
      return false;
    }
    const cands = avImportUiRelinkCandidates(missingName);
    if (!cands.length) {
      avImportUiSetStatus("relink: the library has no items to rename \u2014 import the sample first", "err");
      return false;
    }
    const sel = d.createElement("select");
    sel.className = "av-select av-import-relink";
    for (let i = 0; i < cands.length; i++) {
      const o = d.createElement("option");
      o.value = String(cands[i].id);
      o.textContent = avImportUiStr(cands[i].name, 120) + " (" + (avImportUiStr(cands[i].kind, 24) || "item") + ")";
      sel.appendChild(o);
    }
    if (typeof sel.setAttribute === "function") {
      sel.setAttribute("aria-label", "relink: pick the library item to rename to " + missingName);
      sel.setAttribute("title", "rename the picked item to " + missingName + " (Enter relinks, Esc cancels)");
    }
    const done = { v: false };
    const commit = function () {
      if (done.v) return;
      done.v = true;
      const cid = String(sel.value || "");
      avImportUiCloseRelink(sel);
      avImportUiRelink(cid, missingName);
    };
    const cancel = function () {
      if (done.v) return;
      done.v = true;
      avImportUiCloseRelink(sel);
    };
    sel.addEventListener("keydown", function (ev) {
      try {
        if (ev.key === "Enter") { if (typeof ev.preventDefault === "function") ev.preventDefault(); commit(); }
        else if (ev.key === "Escape") { if (typeof ev.preventDefault === "function") ev.preventDefault(); cancel(); }
      } catch (e3) { /* a listener never throws outward */ }
    });
    sel.addEventListener("blur", function () { try { cancel(); } catch (e4) { /* ok */ } });
    let metaEl = null;
    try { metaEl = row.querySelector(".av-import-item-meta"); } catch (e5) { metaEl = null; }
    if (metaEl && metaEl.parentNode) metaEl.parentNode.insertBefore(sel, metaEl.nextSibling);
    else if (row.firstChild) row.insertBefore(sel, row.firstChild);
    else row.appendChild(sel);
    try { sel.focus(); } catch (e6) { /* focus is a nicety */ }
    avImportUiSetStatus("relink \u2014 the missing " + avImportUiShort(missingName, 60) + ": pick the library item to rename to it; Enter relinks, Esc cancels", "msg");
    return true;
  } catch (e) { return false; }
}

/* ---------- R17: the manager paints (write-on-change, like everything else) ---------- */

/* the chips' active states + aria-pressed (R21: three groups -- kind data-f . format data-fmt
   . pack data-pack) */
function avImportUiPaintChips(root) {
  try {
    if (!root || typeof root.querySelectorAll !== "function") return false;
    const s = avImportUiState;
    let chips = null;
    try { chips = root.querySelectorAll(".av-import-fchip"); } catch (e2) { chips = null; }
    if (!chips) return false;
    for (let i = 0; i < chips.length; i++) {
      const el = chips[i];
      if (!el || typeof el.getAttribute !== "function") continue;
      const vFmt = el.getAttribute("data-fmt");
      const vPack = el.getAttribute("data-pack");
      let on = false;
      if (vFmt != null) on = (String(vFmt) === s.mgr.fmt);
      else if (vPack != null) on = (String(vPack) === s.mgr.pack);
      else on = (String(el.getAttribute("data-f") || "") === s.mgr.filter);
      if (el.classList && typeof el.classList.add === "function") {
        if (on && !el.classList.contains("on")) el.classList.add("on");
        else if (!on && el.classList.contains("on")) el.classList.remove("on");
      }
      const pressed = on ? "true" : "false";
      if (typeof el.setAttribute === "function" && (!el.getAttribute || el.getAttribute("aria-pressed") !== pressed)) {
        el.setAttribute("aria-pressed", pressed);
      }
    }
    return true;
  } catch (e) { return false; }
}

/* R21: the format + pack facet chip groups (#av-import-formats / #av-import-packs) -- rebuilt
   only when their signature (the present formats . the pack list . __none) changes */
function avImportUiPaintFacets(root) {
  if (!root || typeof root.querySelector !== "function") return false;
  try {
    const s = avImportUiState;
    const items = s.lib.items || [];
    const counts = {};
    let hasNone = false;
    const packSet = {};
    for (let i = 0; i < items.length; i++) {
      const f = avImportUiFmtOf(items[i]);
      counts[f] = (counts[f] || 0) + 1;
      const p = String((items[i] && items[i].pack) || "");
      if (p) packSet[p] = 1;
      else hasNone = true;
    }
    const fmts = [];
    for (let i = 0; i < AV_IMPORT_UI_FMTS.length; i++) {
      if (counts[AV_IMPORT_UI_FMTS[i]]) fmts.push(AV_IMPORT_UI_FMTS[i]);
    }
    const packs = [];
    for (const k in packSet) packs.push(k);
    packs.sort();
    if (packs.length > 32) packs.length = 32;   /* the pinned cap */
    const sig = fmts.join(",") + "|" + (hasNone ? "1" : "0") + "|" + packs.join(",");
    if (s.memos.text["facets"] === sig) return true;
    s.memos.text["facets"] = sig;
    const chip = function (attr, val, label, on, title) {
      return '<button type="button" class="av-btn mini av-import-fchip' + (on ? " on" : "") + '" ' +
        attr + '="' + avImportUiEsc(val) + '" aria-pressed="' + (on ? "true" : "false") + '"' +
        (title ? ' title="' + avImportUiEsc(title) + '"' : "") + ">" + avImportUiEsc(label) + "</button>";
    };
    let html = chip("data-fmt", "all", "all", s.mgr.fmt === "all", "every format");
    for (let i = 0; i < fmts.length; i++) html += chip("data-fmt", fmts[i], fmts[i], s.mgr.fmt === fmts[i], "only " + fmts[i]);
    const fEl = root.querySelector("#av-import-formats");
    if (fEl && fEl.innerHTML !== html) fEl.innerHTML = html;
    let html2 = chip("data-pack", "all", "all", s.mgr.pack === "all", "every source pack");
    if (hasNone) html2 += chip("data-pack", "__none", "no pack", s.mgr.pack === "__none", "items with no source pack");
    for (let i = 0; i < packs.length; i++) html2 += chip("data-pack", packs[i], "pack:" + packs[i], s.mgr.pack === packs[i], "imported from pack " + packs[i]);
    const pEl = root.querySelector("#av-import-packs");
    if (pEl && pEl.innerHTML !== html2) pEl.innerHTML = html2;
    return true;
  } catch (e) { return false; }
}

/* R21: #av-import-more -- visible while rows remain unpainted under the ceiling; the label
   carries "show more (P of M)" (P = painted, M = the whole view) */
function avImportUiPaintMore() {
  try {
    const el = avImportUiMgrFind("#av-import-more");
    if (!el) return false;
    const s = avImportUiState;
    const vis = avImportUiViewItems();
    const painted = Math.min(vis.length, s.mgr.limit, AV_IMPORT_UI_LIB_ROWS_MAX);
    const more = (vis.length > painted && painted < AV_IMPORT_UI_LIB_ROWS_MAX);
    if (el.hidden !== !more) el.hidden = !more;
    const label = "show more (" + painted + " of " + vis.length + ")";
    if (s.memos.text["libmore"] !== label) {
      s.memos.text["libmore"] = label;
      if (el.textContent !== label) el.textContent = label;
    }
    return true;
  } catch (e) { return false; }
}

/* the selall label . the delsel disabled state . the bulk labels . the chip actives . the
   facet groups (R21: every target resolves through the manager mount; honest no-op false
   when the manager markup is not mounted anywhere) */
function avImportUiPaintManager(host) {
  /* host kept for signature compat (R21: it no longer changes target resolution) */
  try {
    const root = avImportUiMgrRoot();
    if (!root || typeof root.querySelector !== "function") return false;
    if (!avImportUiMgrFind("#av-import-search")) return false;   /* no manager mounted anywhere */
    const s = avImportUiState;
    const busy = !!s.busy;
    const vis = avImportUiViewItems();
    let allSel = vis.length > 0;
    for (let i = 0; i < vis.length; i++) { if (!s.mgr.sel[vis[i].id]) { allSel = false; break; } }
    avImportUiWriteText(root, "#av-import-selall", allSel ? "clear" : "select all", "selall");
    const selN = avImportUiSelCount();
    const ids = ["#av-import-search", "#av-import-sort", "#av-import-selall"];
    for (let i = 0; i < ids.length; i++) {
      const el = avImportUiMgrFind(ids[i]);
      if (el && el.disabled !== busy) el.disabled = busy;
    }
    const del = avImportUiMgrFind("#av-import-delsel");
    if (del && del.disabled !== (busy || selN === 0)) del.disabled = (busy || selN === 0);
    /* R19: collect & pack rides the same update path (disabled at 0 selected / while busy;
       its label carries the live selected count) */
    const packBtn = avImportUiMgrFind("#av-import-pack");
    if (packBtn) {
      if (packBtn.disabled !== (busy || selN === 0)) packBtn.disabled = (busy || selN === 0);
      avImportUiWriteText(root, "#av-import-pack", "COLLECT & PACK (" + selN + ")", "pack");
    }
    /* R21: the bulk bar (five buttons; the same disabled law; the labels carry the count) */
    const acts = ["load", "send", "chop", "seq", "export"];
    for (let i = 0; i < acts.length; i++) {
      const btn = avImportUiMgrFind('[data-av-import-bulk="' + acts[i] + '"]');
      if (!btn) continue;
      if (btn.disabled !== (busy || selN === 0)) btn.disabled = (busy || selN === 0);
      const label = acts[i].toUpperCase() + " (" + selN + ")";
      const key = "bulk-" + acts[i];
      if (s.memos.text[key] !== label) {
        s.memos.text[key] = label;
        if (btn.textContent !== label) btn.textContent = label;
      }
    }
    let chips = null;
    try { chips = root.querySelectorAll(".av-import-fchip"); } catch (e2) { chips = null; }
    if (chips) {
      for (let i = 0; i < chips.length; i++) {
        const el = chips[i];
        if (el && el.disabled !== busy) el.disabled = busy;
      }
    }
    avImportUiPaintChips(root);
    avImportUiPaintFacets(root);
    return true;
  } catch (e) { return false; }
}

/* the root's history-view marker (a stored run is being viewed) */
function avImportUiPaintHist(host) {
  return avImportUiToggleClass(host, ".av-import", "av-import-hist", !!(avImportUiState.hist), "hist");
}

/* ---------- R17: the receipts history (persisted via the guarded avLibReceipt* trio) ------ */

/* the receipt subset the library stores -- lean, JSON-safe, capped (RUN_ITEMS_MAX) */
function avImportUiReceiptItems(r) {
  const out = [];
  try {
    const items = (r && r.items && typeof r.items.length === "number") ? r.items : [];
    const n = Math.min(items.length | 0, AV_IMPORT_UI_RUN_ITEMS_MAX);
    for (let i = 0; i < n; i++) {
      const it = items[i];
      if (!it || typeof it !== "object") continue;
      out.push({
        name: avImportUiStr(it.name, 120),
        format: avImportUiStr(it.format, 24),
        kind: avImportUiStr(it.kind, 24),
        result: avImportUiStr(it.result, 16),
        reason: avImportUiStr(it.reason, 160),
        size: avImportUiNumOr(it.size, 0),
      });
    }
  } catch (e) { /* empty stands */ }
  return out;
}

/* a failed receipt save notes into the status line (honest; never blocks or stomps a busy op) */
function avImportUiNoteSaveFail(err) {
  try {
    const s = avImportUiState;
    if (s.busy) return false;
    const note = "receipt save failed \u2014 " + avImportUiShort(err, 60);
    if (String(s.status || "").indexOf("receipt save failed") >= 0) return false;
    avImportUiSetStatus(s.status ? (s.status + " \u00b7 " + note) : note, "err");
    return true;
  } catch (e) { return false; }
}

/* after EVERY avImportFiles completion from the card: the fire-and-forget receipt save */
function avImportUiSaveReceipt(r) {
  const s = avImportUiState;
  try {
    if (typeof avLibReceiptSave !== "function") {
      avImportUiNoteSaveFail("the library (av_lib.js) is not present");
      return false;
    }
    const items = avImportUiReceiptItems(r);
    const rec = {
      at: avImportUiNumOr(r && r.at, Date.now()),
      title: avImportUiStr(r && r.title, 80),
      counts: avImportUiCountsOf(r),
      errors: avImportUiErrorsOf(r),
      items: items,
    };
    let out = null;
    try { out = avLibReceiptSave(rec); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the receipt save failed") }; }
    avImportUiSettle(out, function (r0) {
      try {
        const rr = avImportUiReceipt(r0);
        if (rr.ok === true) {
          const id = avImportUiStr(rr.id, 80);
          if (id) {
            if (!s.runs.byId || typeof s.runs.byId !== "object") s.runs.byId = {};
            s.runs.byId[id] = items;
          }
        } else {
          avImportUiNoteSaveFail(avImportUiErrText(rr, "the receipt save failed"));
        }
      } catch (e2) { /* the refresh below still runs */ }
      avImportUiRefreshRuns();
    });
    return true;
  } catch (e) { return false; }
}

/* one runs row -- button[data-av-import-run]: "HH:MM . imported N . deferred N . refused N . title" */
function avImportUiRunRowHTML(run) {
  const id = avImportUiStr(run && run.id, 80);
  const c = avImportUiCountsOf(run);
  const title = avImportUiStr(run && run.title, 80) || "import";
  const line = avImportUiClock(run && run.at) + " \u00b7 imported " + c.imported + " \u00b7 deferred " +
    c.deferred + " \u00b7 refused " + c.refused + " \u00b7 " + title;
  return '<button type="button" class="av-import-run" data-av-import-run="' + avImportUiEsc(id) +
    '" title="show this run in the report above">' + avImportUiEsc(line) + "</button>";
}

function avImportUiRunsSig() {
  const s = avImportUiState;
  let sig = (s.runs.ok ? "1" : "0") + "|" + s.runs.backend + "|" + s.runs.count + "|" + (s.runs.list || []).length;
  const list = s.runs.list || [];
  if (list.length) sig += "|" + list[0].id + "|" + list[list.length - 1].id;
  return sig;
}

/* rebuild the runs list (memo: list signature); #av-import-runs-empty is static in the card,
   hidden while rows exist */
function avImportUiPaintRuns(host, force) {
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const s = avImportUiState;
    const sig = avImportUiRunsSig();
    if (!force && sig === s.runsSig) return true;
    const box = host.querySelector("#av-import-runs");
    if (!box) return false;
    const list = s.runs.list || [];
    let html = "";
    const n = Math.min(list.length, 20);
    for (let i = 0; i < n; i++) html += avImportUiRunRowHTML(list[i]);
    box.innerHTML = html;
    const empty = host.querySelector("#av-import-runs-empty");
    if (empty) {
      const msg = s.runs.ok
        ? "no runs yet"
        : (s.runs.error ? ("history unavailable \u2014 " + s.runs.error) : "no runs yet");
      if (empty.textContent !== msg) empty.textContent = msg;
      if (empty.hidden !== (n > 0)) empty.hidden = (n > 0);
    }
    s.runsSig = sig;
    return true;
  } catch (e) { return false; }
}

/* write one avLibReceiptList (or refusal) receipt into the runs mirror + repaint */
function avImportUiApplyRuns(r0) {
  const s = avImportUiState;
  try {
    const r = avImportUiReceipt(r0);
    if (r.ok !== true) {
      s.runs.ok = false;
      s.runs.error = avImportUiErrText(r, "the receipts read failed");
      s.runs.backend = (typeof r.backend === "string") ? r.backend : "";
      s.runs.count = 0;
      s.runs.list = [];
    } else {
      s.runs.ok = true;
      s.runs.error = "";
      s.runs.backend = (typeof r.backend === "string") ? r.backend : "";
      s.runs.count = Math.max(0, Math.round(avImportUiNumOr(r.count, 0)));
      const src = (r.runs && typeof r.runs.length === "number") ? r.runs : [];
      const out = [];
      const n = Math.min(src.length, 20);
      for (let i = 0; i < n; i++) {
        const run = src[i];
        if (!run || typeof run !== "object" || run.id == null) continue;
        const id = avImportUiStr(run.id, 80);
        out.push({
          id: id,
          at: avImportUiNumOr(run.at, 0),
          title: avImportUiStr(run.title, 80),
          counts: avImportUiCountsOf(run),
        });
        /* the record's own items, when the tier returned them, feed the history view */
        try {
          if (run.items && typeof run.items.length === "number" && !s.runs.byId[id]) {
            const items = [];
            const m = Math.min(run.items.length, AV_IMPORT_UI_RUN_ITEMS_MAX);
            for (let k = 0; k < m; k++) {
              const it = run.items[k];
              if (!it || typeof it !== "object") continue;
              items.push({
                name: avImportUiStr(it.name, 120),
                format: avImportUiStr(it.format, 24),
                kind: avImportUiStr(it.kind, 24),
                result: avImportUiStr(it.result, 16),
                reason: avImportUiStr(it.reason, 160),
                size: avImportUiNumOr(it.size, 0),
              });
            }
            s.runs.byId[id] = items;
          }
        } catch (e2) { /* items are a nicety */ }
      }
      s.runs.list = out;
    }
    s.runs.at = Date.now();
    avImportUiPaintRuns(avImportUiHost(), true);
    return true;
  } catch (e) { return false; }
}

/* the public runs refresh: avLibReceiptList (guarded) -> mirror -> repaint; never rejects */
function avImportUiRefreshRuns() {
  const s = avImportUiState;
  return new Promise(function (resolve) {
    let done = false;
    const finish = function (v) { if (!done) { done = true; resolve(v); } };
    try {
      if (typeof avLibReceiptList !== "function") {
        s.runs.ok = false;
        s.runs.error = "the library (av_lib.js) is not present";
        s.runs.backend = "";
        s.runs.count = 0;
        s.runs.list = [];
        avImportUiPaintRuns(avImportUiHost(), true);
        finish(false);
        return;
      }
      let out = null;
      try { out = avLibReceiptList(); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the receipts read failed") }; }
      avImportUiSettle(out, function (r0) {
        try { avImportUiApplyRuns(r0); } catch (e) { /* apply never throws */ }
        finish(true);
      });
    } catch (e) { finish(false); }
  });
}

/* click a runs row: paint the stored receipt into the report + counts; the root gets
   .av-import-hist; the next live run clears it (avImportUiFinishImport) */
function avImportUiShowRun(id) {
  const s = avImportUiState;
  try {
    const sid = avImportUiStr(id, 80);
    let run = null;
    const list = s.runs.list || [];
    for (let i = 0; i < list.length; i++) if (list[i].id === sid) run = list[i];
    if (!run) return false;
    let items = null;
    try {
      if (s.runs.byId && s.runs.byId[sid] && typeof s.runs.byId[sid].length === "number") items = s.runs.byId[sid];
    } catch (e) { items = null; }
    s.hist = {
      id: sid,
      at: avImportUiNumOr(run.at, 0),
      title: avImportUiStr(run.title, 80),
      counts: avImportUiCountsOf(run),
      items: items,
    };
    const host = avImportUiHost();
    avImportUiPaintHist(host);
    avImportUiPaintCounts(host);
    avImportUiPaintReport(host, false);
    avImportUiSetStatus("history view - run at " + avImportUiClock(run.at), "msg");
    return true;
  } catch (e) { return false; }
}

/* "clear history" -> avLibReceiptClear (guarded) -> refresh; the view returns to live */
function avImportUiClearRuns() {
  const s = avImportUiState;
  try {
    if (s.busy) return avImportUiBusyRefuse();
    if (typeof avLibReceiptClear !== "function") {
      avImportUiSetStatus("the library (av_lib.js) is not present \u2014 the history is unavailable", "err");
      return false;
    }
    if (!avImportUiBegin("clearing the run history")) return false;
    let out = null;
    try { out = avLibReceiptClear(); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the clear failed") }; }
    avImportUiSettle(out, function (r0) {
      const r = avImportUiReceipt(r0);
      avImportUiEnd();
      if (r.ok !== true) {
        avImportUiSetStatus("clear refused \u2014 " + avImportUiErrText(r, "the receipts store refused"), "err");
      } else {
        const removed = Math.max(0, Math.round(avImportUiNumOr(r.removed, 0)));
        avImportUiSetStatus("history cleared \u2014 " + removed + " run" + (removed === 1 ? "" : "s") + " removed", "msg");
        s.hist = null;
        s.runs.byId = {};
        const host = avImportUiHost();
        avImportUiPaintHist(host);
        avImportUiPaintCounts(host);
        avImportUiPaintReport(host, false);
      }
      avImportUiRefreshRuns();
    });
    return true;
  } catch (e) {
    avImportUiEnd();
    avImportUiSetStatus("clear failed \u2014 " + avImportUiErrText(e, "unexpected"), "err");
    return false;
  }
}

/* ---------- R17: the storage footer (estimate + the persist nudge; never a false claim) --- */

/* the persist tier: avStorePersisted when present, else the raw navigator query */
function avImportUiQueryTier() {
  return new Promise(function (resolve) {
    let done = false;
    const fin = function (v) { if (!done) { done = true; resolve(v); } };
    try {
      if (typeof avStorePersisted === "function") {
        let out = null;
        try { out = avStorePersisted(); } catch (e) { out = null; }
        avImportUiSettle(out, function (v) { fin(v === true ? "persistent" : "best-effort"); });
        return;
      }
      let nav = null;
      try { nav = (typeof navigator !== "undefined") ? navigator : null; } catch (e2) { nav = null; }
      if (nav && nav.storage && typeof nav.storage.persisted === "function") {
        Promise.resolve(nav.storage.persisted()).then(
          function (v) { fin(v === true ? "persistent" : "best-effort"); },
          function () { fin("best-effort"); }
        );
        return;
      }
    } catch (e3) { /* fall through */ }
    fin("best-effort");
  });
}

/* on init + after runs: avStoreEstimate (guarded) -> the storage line; null = honest fallback */
function avImportUiRefreshStorage() {
  const s = avImportUiState;
  try {
    avImportUiQueryTier().then(function (tier) {
      try {
        s.storage.tier = tier;
        avImportUiPaintStorage(avImportUiHost());
      } catch (e2) { /* paint never throws */ }
    });
    if (typeof avStoreEstimate !== "function") {
      s.storage.checked = true;
      s.storage.est = null;
      s.storage.at = Date.now();
      avImportUiPaintStorage(avImportUiHost());
      return Promise.resolve(false);
    }
    let out = null;
    try { out = avStoreEstimate(); } catch (e) { out = null; }
    avImportUiSettle(out, function (est) {
      try {
        s.storage.est = (est && typeof est === "object")
          ? { usage: Math.max(0, avImportUiNumOr(est.usage, 0)), quota: Math.max(0, avImportUiNumOr(est.quota, 0)) }
          : null;
        s.storage.checked = true;
        s.storage.at = Date.now();
        avImportUiPaintStorage(avImportUiHost());
      } catch (e2) { /* zeros stand */ }
    });
    return Promise.resolve(true);
  } catch (e) { return Promise.resolve(false); }
}

function avImportUiStorageText() {
  const s = avImportUiState;
  if (!s.storage.checked) return "storage: checking\u2026";
  if (!s.storage.est) return "storage: unavailable (this browser)";
  const tier = (s.storage.tier === "persistent") ? "persistent" : "best-effort";
  return "storage: " + avImportUiFmtBytes(s.storage.est.usage) + " of " + avImportUiFmtBytes(s.storage.est.quota) + " \u00b7 " + tier;
}

function avImportUiPaintStorage(host) {
  return avImportUiWriteText(host, "#av-import-storage", avImportUiStorageText(), "storage");
}

/* "make storage persistent" -> avStorePersist (guarded) -> the honest status line */
function avImportUiPersist() {
  const s = avImportUiState;
  try {
    if (s.busy) return avImportUiBusyRefuse();
    if (typeof avStorePersist !== "function") {
      avImportUiSetStatus("persistent storage unsupported (this browser)", "err");
      return false;
    }
    if (!avImportUiBegin("asking the browser for persistent storage")) return false;
    let out = null;
    try { out = avStorePersist(); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the persist call failed") }; }
    avImportUiSettle(out, function (r0) {
      const r = avImportUiReceipt(r0);
      avImportUiEnd();
      if (r.ok !== true) {
        avImportUiSetStatus("persistent storage unsupported (this browser)", "err");
      } else if (r.persisted === true) {
        avImportUiSetStatus("persistent storage granted", "msg");
      } else {
        avImportUiSetStatus("persistent storage not granted (best-effort)", "msg");
      }
      avImportUiRefreshStorage();
    });
    return true;
  } catch (e) {
    avImportUiEnd();
    avImportUiSetStatus("persistent storage unsupported (this browser)", "err");
    return false;
  }
}

/* ---------- R17: drop-anywhere routing + reveal ---------- */

/* scroll the hub into view + focus the drop zone (the menubar "Library..." jump, drop routing) */
function avImportUiReveal() {
  try {
    const host = avImportUiHost();
    if (!host) return false;
    let card = null;
    try { card = host.querySelector(".av-import"); } catch (e) { card = null; }
    const target = card || host;
    try { if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "nearest" }); } catch (e2) { /* the shell seam may wrap this */ }
    let zone = null;
    try { zone = host.querySelector("[data-av-import-drop]"); } catch (e3) { zone = null; }
    if (zone && typeof zone.focus === "function") {
      try { zone.focus(); } catch (e4) { /* focus is a nicety */ }
    }
    return true;
  } catch (e) { return false; }
}

/* the facade/menubar "Library..." action: jump to the Store zone, reveal + focus the hub,
   then open the full library overlay (R21, guarded -- the old store-jump behavior is kept) */
function avImportUiLibrary() {
  try {
    try { if (typeof avZoneShow === "function") avZoneShow("store", { source: "menu" }); } catch (e) { /* zone seam optional */ }
    avImportUiReveal();
    try { if (typeof avLibraryUiOpen === "function") avLibraryUiOpen(); } catch (e2) { /* overlay optional */ }
    return true;
  } catch (e) { return false; }
}

/* the menubar "Import folder..." action (avImportUiPick("dir") stays for the old callers) */
function avImportUiPickDir() {
  return avImportUiPick("dir");
}

/* the doc-level drop routing: preventDefault always happens in the claim; a drop OUTSIDE the
   hub host imports through the funnel and reveals the hub -- a drop INSIDE it stays the card's
   own handler (the containment guard is what prevents a double import) */
function avImportUiDocDrop(ev) {
  try {
    const s = avImportUiState;
    if (!s.inited) return false;
    const host = avImportUiHost();
    const tgt = ev && ev.target;
    if (host && tgt && typeof host.contains === "function" && host.contains(tgt)) return false;
    const dt = ev ? ev.dataTransfer : null;
    if (!dt) return false;
    avImportUiFilesFromDataTransfer(dt).then(function (res) {
      try {
        if (!res || !res.files || !res.files.length) return;
        if (res.truncated) s.walkNote = "folder walk capped at " + avImportUiFileCap() + " files";
        avImportUiImport(res.files);
        try { if (typeof avZoneShow === "function") avZoneShow("store", { source: "drop" }); } catch (e) { /* zone seam optional */ }
        avImportUiReveal();
      } catch (e2) { /* a listener never throws outward */ }
    }, function () { /* a stray unreadable drop is nothing */ });
    return true;
  } catch (e) { return false; }
}

/* ---------- event wiring (one delegation set per host) ---------- */

function avImportUiPick(kind) {
  try {
    const host = avImportUiHost();
    if (!host || typeof host.querySelector !== "function") return false;
    const el = host.querySelector(kind === "dir" ? "#av-import-dir" : "#av-import-file");
    if (!el || typeof el.click !== "function") return false;
    try { el.value = ""; } catch (e) { /* ok */ }
    el.click();
    return true;
  } catch (e) { return false; }
}

function avImportUiDragover(on) {
  try {
    const want = !!on;
    const host = avImportUiHost();
    if (host && host.classList) {
      if (want) host.classList.add("dragover"); else host.classList.remove("dragover");
    }
    if (host && typeof host.querySelector === "function") {
      const zone = host.querySelector("[data-av-import-drop]");
      if (zone && zone.classList) {
        if (want) zone.classList.add("dragover"); else zone.classList.remove("dragover");
      }
    }
    return true;
  } catch (e) { return false; }
}

function avImportUiDragDepth(delta) {
  try {
    const s = avImportUiState;
    s.dragDepth = Math.max(0, (s.dragDepth | 0) + delta);
    avImportUiDragover(s.dragDepth > 0);
    return true;
  } catch (e) { return false; }
}

function avImportUiOnClick(ev) {
  try {
    const t = ev && ev.target;
    if (!t || typeof t.closest !== "function") return;
    const actBtn = t.closest("[data-av-import-act]");
    if (actBtn) {
      if (actBtn.disabled === true) return;
      const act = String((actBtn.getAttribute && actBtn.getAttribute("data-av-import-act")) || "");
      const id = String((actBtn.getAttribute && actBtn.getAttribute("data-id")) || "");
      avImportUiAct(act, id);
      return;
    }
    if (t.closest("#av-import-pick")) { avImportUiPick("file"); return; }
    if (t.closest("#av-import-pickdir")) { avImportUiPick("dir"); return; }
    if (t.closest("#av-import-librefresh")) { avImportUiRefreshLib(); return; }
    /* R21: the strip's OPEN LIBRARY (the overlay; an honest store-jump when it is absent) */
    if (t.closest("#av-import-libopen")) {
      let opened = false;
      try { if (typeof avLibraryUiOpen === "function") opened = (avLibraryUiOpen() !== false); } catch (e2) { opened = false; }
      if (!opened) {
        try { if (typeof avZoneShow === "function") avZoneShow("store", { source: "menu" }); } catch (e3) { /* zone seam optional */ }
        avImportUiReveal();
      }
      return;
    }
    /* R17: the manager + runs + storage controls */
    if (t.closest("#av-import-selall")) { avImportUiSelAll(); return; }
    if (t.closest("#av-import-delsel")) { avImportUiDelSel(); return; }
    if (t.closest("#av-import-pack")) { avImportUiPackSel(); return; }
    /* R21: the bulk bar (five sequential actions; disabled at zero selection) */
    const bulkBtn = t.closest("[data-av-import-bulk]");
    if (bulkBtn) {
      if (bulkBtn.disabled === true) return;
      avImportUiBulk(String((bulkBtn.getAttribute && bulkBtn.getAttribute("data-av-import-bulk")) || ""));
      return;
    }
    const chip = t.closest(".av-import-fchip");
    if (chip) {
      const vFmt = chip.getAttribute && chip.getAttribute("data-fmt");
      const vPack = chip.getAttribute && chip.getAttribute("data-pack");
      if (vFmt) { avImportUiSetFormat(String(vFmt)); return; }
      if (vPack) { avImportUiSetPack(String(vPack)); return; }
      avImportUiSetFilter(String((chip.getAttribute && chip.getAttribute("data-f")) || ""));
      return;
    }
    /* R21: show more + the inspector close */
    if (t.closest("#av-import-more")) { avImportUiMore(); return; }
    if (t.closest("#av-import-detail-close")) { avImportUiInspect(""); return; }
    const runBtn = t.closest("[data-av-import-run]");
    if (runBtn) { avImportUiShowRun(String((runBtn.getAttribute && runBtn.getAttribute("data-av-import-run")) || "")); return; }
    if (t.closest("#av-import-runsclear")) { avImportUiClearRuns(); return; }
    if (t.closest("#av-import-persist")) { avImportUiPersist(); return; }
    const zone = t.closest("[data-av-import-drop]");
    if (zone) {
      /* the picker's synthetic click returning through the zone must not loop */
      if (t.id === "av-import-file" || t.id === "av-import-dir") return;
      avImportUiPick("file");
    }
  } catch (e) { /* a listener never throws outward */ }
}

function avImportUiOnKeydown(ev) {
  try {
    const t = ev && ev.target;
    if (!t || typeof t.closest !== "function") return;
    if (!t.closest("[data-av-import-drop]")) return;
    if (ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar") {
      if (typeof ev.preventDefault === "function") ev.preventDefault();
      avImportUiPick("file");
    }
  } catch (e) { /* a listener never throws outward */ }
}

function avImportUiOnChange(ev) {
  try {
    const t = ev && ev.target;
    if (!t) return;
    /* R17: the manager controls (the row checkboxes carry data-id, not an id) */
    if (t.closest && t.closest("[data-av-import-check]")) {
      avImportUiToggleSel(String((t.getAttribute && t.getAttribute("data-id")) || ""), !!t.checked);
      return;
    }
    if (!t.id) return;
    if (t.id === "av-import-sort") { avImportUiSetSort(t.value); return; }
    if (t.id === "av-import-search") { avImportUiSetSearch(t.value); return; }
    if (t.id === "av-import-file" || t.id === "av-import-dir") {
      /* SNAPSHOT FIRST (house law -- the av_sample pattern): in Chromium, clearing
         input.value empties the LIVE FileList, so checking files.length after the clear always
         reads 0 and the import silently never ran. Found by the R15b rig. */
      const files = t.files;
      const list = files ? Array.prototype.slice.call(files, 0) : [];
      try { t.value = ""; } catch (e) { /* ok -- re-picking the same file must fire again */ }
      if (list.length) avImportUiImport(list);
    }
  } catch (e) { /* a listener never throws outward */ }
}

function avImportUiOnDrop(ev) {
  try {
    if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
    const s = avImportUiState;
    s.dragDepth = 0;
    avImportUiDragover(false);
    const dt = ev ? ev.dataTransfer : null;
    if (!dt) {
      avImportUiSetStatus("the drop carried no data \u2014 try the picker buttons", "err");
      return;
    }
    avImportUiFilesFromDataTransfer(dt).then(function (res) {
      try {
        if (!res || !res.files || !res.files.length) {
          avImportUiSetStatus("the drop carried no files \u2014 try the picker buttons", "err");
          return;
        }
        if (res.truncated) s.walkNote = "folder walk capped at " + avImportUiFileCap() + " files";
        avImportUiImport(res.files);
      } catch (e) { /* a listener never throws outward */ }
    }, function () {
      avImportUiSetStatus("the drop could not be read \u2014 try the picker buttons", "err");
    });
  } catch (e) { /* a listener never throws outward */ }
}

/* R17: the live search filter (the input event keeps the list in step while typing) */
function avImportUiOnInput(ev) {
  try {
    const t = ev && ev.target;
    if (t && t.id === "av-import-search") avImportUiSetSearch(t.value);
  } catch (e) { /* a listener never throws outward */ }
}

function avImportUiWire(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  try {
    if (host.dataset && host.dataset.avImportWired === "1") return true;
    if (host.dataset) host.dataset.avImportWired = "1";
    host.addEventListener("click", avImportUiOnClick);
    host.addEventListener("keydown", avImportUiOnKeydown);
    host.addEventListener("change", avImportUiOnChange);
    host.addEventListener("input", avImportUiOnInput);
    host.addEventListener("dragover", function (e) {
      try { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } catch (err) { /* ok */ }
    });
    host.addEventListener("dragenter", function (e) {
      try { e.preventDefault(); } catch (err) { /* ok */ }
      avImportUiDragDepth(1);
    });
    host.addEventListener("dragleave", function () { avImportUiDragDepth(-1); });
    host.addEventListener("drop", avImportUiOnDrop);
    return true;
  } catch (e) { return false; }
}

/* ---------- markup (pure string builders) ---------- */

function avImportUiSlotOptionsHTML() {
  let out = "";
  for (let i = 1; i <= 4; i++) out += '<option value="' + i + '">' + i + "</option>";
  return out;
}

/* ---------- R21: the manager markup + the mount (the manager left the card) ---------- */

/* the moved manager markup, VERBATIM (search . sort . kind chips . selall . delsel . pack .
   libhead . list) PLUS the R21 halves: the format facet group (#av-import-formats, data-fmt),
   the pack facet group (#av-import-packs, data-pack), the bulk bar (#av-import-bulk, five
   data-av-import-bulk buttons), show more (#av-import-more, after the list) and the inspector
   panel (#av-import-detail, last; its close button is injected by avImportUiPaintDetail) */
function avImportUiManagerHTML() {
  return '<div class="av-import-manager">' +
    '<input class="av-import-search" id="av-import-search" type="search" placeholder="search the library..." aria-label="Search the library by name">' +
    '<select class="av-select av-import-sort" id="av-import-sort" aria-label="Sort the library list">' +
    '<option value="newest" selected>newest</option><option value="name">name</option><option value="size">size</option><option value="kind">kind</option></select>' +
    '<span class="av-import-filters" id="av-import-filters">' +
    '<button type="button" class="av-btn mini av-import-fchip on" data-f="all" aria-pressed="true">all</button>' +
    '<button type="button" class="av-btn mini av-import-fchip" data-f="sample" aria-pressed="false">samples</button>' +
    '<button type="button" class="av-btn mini av-import-fchip" data-f="kit" aria-pressed="false">kits</button>' +
    '<button type="button" class="av-btn mini av-import-fchip" data-f="refs" aria-pressed="false">refs</button>' +
    '<button type="button" class="av-btn mini av-import-fchip" data-f="pattern" aria-pressed="false">patterns</button>' +
    "</span>" +
    '<span class="av-import-facets" id="av-import-formats"></span>' +
    '<span class="av-import-facets" id="av-import-packs"></span>' +
    '<button type="button" class="av-btn mini av-import-btn" id="av-import-selall">select all</button>' +
    '<button type="button" class="av-btn mini av-import-btn" id="av-import-delsel" disabled>delete selected</button>' +
    /* R19: collect & pack -- directly after delsel; same disabled law; the label carries (N) */
    '<button type="button" class="av-btn mini av-import-btn" id="av-import-pack" disabled title="collect the selected library items into one .avpack file">COLLECT &amp; PACK (0)</button>' +
    /* R21: the bulk bar -- five sequential actions over the selected rows (labels carry (N)) */
    '<span class="av-import-bulk" id="av-import-bulk">' +
    '<button type="button" class="av-btn mini av-import-btn" data-av-import-bulk="load" disabled title="load every selected item into the session, one at a time">LOAD (0)</button>' +
    '<button type="button" class="av-btn mini av-import-btn" data-av-import-bulk="send" disabled title="load every selected item and send it to the slot, one at a time">SEND (0)</button>' +
    '<button type="button" class="av-btn mini av-import-btn" data-av-import-bulk="chop" disabled title="load every selected item and aim the chop card at it, one at a time">CHOP (0)</button>' +
    '<button type="button" class="av-btn mini av-import-btn" data-av-import-bulk="seq" disabled title="load every selected pattern into the sequencer, one at a time">SEQ (0)</button>' +
    '<button type="button" class="av-btn mini av-import-btn" data-av-import-bulk="export" disabled title="export every selected item as ONE zip download">EXPORT (0)</button>' +
    "</span>" +
    "</div>" +
    '<div class="av-import-libhead">' +
    '<span class="av-import-libtag">LIBRARY</span>' +
    '<span class="av-import-libstat av-dim" id="av-import-libstat">library idle</span>' +
    '<label class="av-import-lbl" for="av-import-slot">SEND TO SLOT</label>' +
    '<select class="av-select av-import-slot" id="av-import-slot" aria-label="Target sampler slot 1 to 4">' + avImportUiSlotOptionsHTML() + "</select>" +
    '<button type="button" class="av-btn mini av-import-btn" id="av-import-librefresh" title="refresh the local library list">\u27f3</button>' +
    "</div>" +
    '<div class="av-import-lib" id="av-import-lib"></div>' +
    '<button type="button" class="av-btn mini av-import-btn av-import-more" id="av-import-more" hidden>show more</button>' +
    '<div class="av-import-detail" id="av-import-detail" hidden></div>';
}

/* R21: host the manager in a container (the overlay hands #av-library-body). The FIRST
   CONNECTED mount wins: the same container -> true (idempotent); a different container while
   a connected mount exists -> false. Otherwise the host is stored, the markup injected ONCE
   (".av-import-manager" presence test; fresh markup resets the write memos), the container is
   wired through the existing delegation, and the manager repaints. Invalid -> false. */
function avImportUiManagerMount(container) {
  const s = avImportUiState;
  try {
    if (!container || typeof container.querySelector !== "function") return false;
    const cur = avImportUiMgrEl();
    if (cur) return (cur === container);   /* connected mount: idempotent or refused */
    s.mgrHost = container;
    let mgr = null;
    try { mgr = container.querySelector(".av-import-manager"); } catch (e) { mgr = null; }
    if (!mgr) {
      const html = avImportUiManagerHTML();
      s.memos = { text: {}, cls: {} };   /* fresh markup: every memo repaints once */
      s.libSig = "\u0000";               /* the forced mount paint rebuilds the list */
      let injected = false;
      try {
        if (typeof container.insertAdjacentHTML === "function") {
          container.insertAdjacentHTML("beforeend", html);
          injected = true;
        }
      } catch (e2) { injected = false; }
      if (!injected) {
        const d = avImportUiDoc();
        try {
          if (d && typeof d.createElement === "function") {
            const t = d.createElement("div");
            t.innerHTML = html;
            while (t.firstChild) container.appendChild(t.firstChild);
            injected = true;
          }
        } catch (e3) { injected = false; }
      }
      if (!injected) { s.mgrHost = null; return false; }
    }
    try { avImportUiWire(container); } catch (e4) { /* wiring never throws outward */ }
    avImportUiPaintLib(null, true);    /* the mount paint: list + stat + manager + strip */
    avImportUiPaintManager(null);
    avImportUiPaintLibStat(null);
    return true;
  } catch (e) { return false; }
}

function avImportUiBodyHTML() {
  return '<div class="av-import" data-av-import="1">' +
    '<div class="av-import-head"><span class="av-import-title">SAMPLE PACKS</span>' +
    '<span class="av-import-cap av-dim">Drop a folder or files \u2014 every file gets a recognition report; samples land in the local library below with load / send / chop actions. Nothing uploads.</span></div>' +
    '<div class="av-import-status-line"><span class="av-import-status av-import-msg" id="av-import-status" role="status" aria-live="polite">imports idle</span></div>' +
    '<div class="av-import-drop" data-av-import-drop="1" role="button" tabindex="0" aria-label="Drop a sample pack folder or files, or press Enter to pick files">' +
    '<span class="av-import-dropmsg">DROP A SAMPLE PACK HERE \u2014 a folder or files \u00b7 WAV \u00b7 MP3 \u00b7 AIFF \u00b7 MIDI \u00b7 REX2</span>' +
    '<input class="av-import-file" id="av-import-file" type="file" multiple hidden tabindex="-1" aria-hidden="true" accept="' + AV_IMPORT_UI_ACCEPT + '">' +
    '<input class="av-import-file" id="av-import-dir" type="file" webkitdirectory directory multiple hidden tabindex="-1" aria-hidden="true">' +
    "</div>" +
    '<div class="av-import-btns">' +
    '<button type="button" class="av-btn av-import-btn" id="av-import-pick" title="pick one or more sample files">PICK FILES</button>' +
    '<button type="button" class="av-btn av-import-btn" id="av-import-pickdir" title="pick a folder \u2014 its subfolders are walked">PICK FOLDER</button>' +
    "</div>" +
    '<div class="av-import-counts av-dim" id="av-import-counts">no runs yet \u2014 drop a folder or files</div>' +
    '<div class="av-import-report" id="av-import-report"></div>' +
    '<div class="av-import-runs-head"><span class="av-import-libtag">RECENT RUNS</span>' +
    '<button type="button" class="av-btn mini av-import-btn" id="av-import-runsclear" title="clear the saved run history">clear history</button></div>' +
    '<div class="av-import-runs" id="av-import-runs"></div>' +
    '<p class="av-note av-dim av-import-empty" id="av-import-runs-empty">no runs yet</p>' +
    /* R21: the summary strip -- the manager left for the library overlay; OPEN LIBRARY opens it */
    '<div class="av-import-libsum-row">' +
    '<span class="av-import-libsum av-dim" id="av-import-libsum">library idle</span>' +
    '<button type="button" class="av-btn mini av-import-btn" id="av-import-libopen" title="open the full library - search, filter, bulk actions">OPEN LIBRARY</button>' +
    "</div>" +
    '<p class="av-note av-dim av-import-note" id="av-import-note">Imports land in your local library \u2014 nothing is uploaded.</p>' +
    '<div class="av-import-foot">' +
    '<span class="av-import-storage av-dim" id="av-import-storage">storage: checking\u2026</span>' +
    '<button type="button" class="av-btn mini av-import-btn" id="av-import-persist" title="ask the browser for persistent storage (best-effort)">make storage persistent</button>' +
    "</div>" +
    '<div id="av-sources-host"></div>' +
    "</div>";
}

/* the parent's own `#av-import` card element: this root takes the id only when no such
   element exists (never a duplicate id) -- the av_chop_ui / av_files_ui idiom */
function avImportUiEnsureRootId(card) {
  try {
    if (!card || card.id) return false;
    const d = avImportUiDoc();
    const existing = (d && typeof d.getElementById === "function") ? d.getElementById("av-import") : null;
    if (existing && existing !== card) return false;
    card.id = "av-import";
    return true;
  } catch (e) { return false; }
}

/* ---------- init / snap / proof / classes ---------- */

function avImportUiInit() {
  const host = avImportUiHost();
  if (!host || typeof host.querySelector !== "function") return false;   /* host absent -> false */
  try {
    const s = avImportUiState;
    let card = null;
    try { card = host.querySelector(".av-import"); } catch (e) { card = null; }
    const flagged = !!(host.dataset && host.dataset.avImportUi === "1");
    if (flagged && card && s.inited) return true;      /* idempotent via the host dataset flag */
    if (!card) {
      s.memos = { text: {}, cls: {} };
      s.reportPaintedSeq = -1;                          /* fresh markup needs its first paint   */
      s.libSig = "\u0000";
      host.innerHTML = avImportUiBodyHTML();
      try { card = host.querySelector(".av-import"); } catch (e2) { card = null; }
    }
    avImportUiEnsureRootId(card);
    avImportUiWire(host);
    avImportUiClaimDoc();
    s.inited = true;
    s.mounts += 1;
    if (host.dataset) host.dataset.avImportUi = "1";
    if (!s.status) {
      let coreReady = false;
      try { coreReady = (typeof avImportFiles === "function"); } catch (e3) { coreReady = false; }
      if (coreReady) {
        s.status = "ready \u2014 drop a sample pack (a folder or files)";
        s.statusKind = "msg";
      } else {
        s.status = "the import core (av_import.js) is not present \u2014 the card mounts and refuses honestly";
        s.statusKind = "err";
      }
    }
    /* the local library boots alongside the card (guarded, fire-and-forget) */
    try { if (typeof avLibInit === "function") avLibInit(); } catch (e4) { /* library optional */ }
    avImportUiPaintAll(host, true);
    avImportUiRefreshLib();
    /* R17: the receipts history + the storage footer boot alongside the card (guarded) */
    avImportUiRefreshRuns();
    avImportUiRefreshStorage();
    /* proof: ?avtest=1 ONLY, deferred (the R12 leak law -- never parse-time, never on the
       plain page); the deferred tick also lets the host settle before the line lands */
    try {
      if (typeof avTestLine === "function" && typeof location !== "undefined" && /[?&]avtest=1/.test(String(location.search))) {
        setTimeout(function () { try { const p = avImportUiProof(); if (p) avTestLine(p, "av-importtest"); } catch (e5) { /* ok */ } }, 0);
      }
    } catch (e) { /* proof is a nicety */ }
    return true;
  } catch (e) {
    try { avImportUiState.lastError = String((e && e.message) || e); } catch (e2) { /* ok */ }
    return false;
  }
}

function avImportUiSnap() {
  const host = avImportUiHost();
  const s = avImportUiState;
  const out = {
    inited: !!s.inited,
    host: !!host,
    version: AV_IMPORT_UI_VERSION,
    busy: !!s.busy,
    last: null,
    report: [],
    lib: { count: 0, bytes: 0, backend: "" },
    runs: 0,
    /* R18: the identity observables (additive; receipts without the key read 0) */
    dups: 0,
    missing: 0,
    manager: { search: "", sort: "newest", filter: "all", selected: 0,
               fmt: "all", pack: "all", limit: AV_IMPORT_UI_LIB_STEP, shown: 0, insp: "" },
    lastError: String(s.lastError || ""),
  };
  try {
    if (s.last) {
      out.last = {
        title: String(s.last.title || ""),
        at: avImportUiNumOr(s.last.at, 0),
        counts: avImportUiCountsOf(s.last),
      };
    }
  } catch (e) { /* last stays null */ }
  try {
    const items = s.reportItems || [];
    const n = Math.min(items.length, AV_IMPORT_UI_ROWS_MAX);
    for (let i = 0; i < n; i++) {
      const it = items[i] || {};
      out.report.push({
        key: String(it.key || ""),
        name: String(it.name || ""),
        path: String(it.path || ""),
        ext: String(it.ext || ""),
        format: String(it.format || ""),
        kind: String(it.kind || ""),
        result: String(it.result || ""),
        reason: String(it.reason || ""),
        size: avImportUiNumOr(it.size, 0),
        sibling: String(it.sibling || ""),
        id: String(it.id || ""),
        /* R18: the identity fields (additive) */
        sha: String(it.sha || ""),
        dup: avImportUiDupPub(it.dup),
      });
    }
  } catch (e) { /* report stays empty */ }
  try {
    out.lib.count = avImportUiNumOr(s.lib.count, 0);
    out.lib.bytes = avImportUiNumOr(s.lib.bytes, 0);
    out.lib.backend = String(s.lib.backend || "");
  } catch (e) { /* zeros stand */ }
  try {
    out.runs = Math.max(0, Math.round(avImportUiNumOr(s.runs.count, 0)));
  } catch (e) { /* zero stands */ }
  /* R18: dups = the last receipt's counts.dups (guarded for receipts without the key);
     missing = the current scan count */
  try {
    out.dups = (s.last && s.last.counts) ? Math.max(0, Math.round(avImportUiNumOr(s.last.counts.dups, 0))) : 0;
  } catch (e) { /* zero stands */ }
  try {
    out.missing = avImportUiMissingCount();
  } catch (e) { /* zero stands */ }
  try {
    out.manager.search = String(s.mgr.search || "");
    out.manager.sort = String(s.mgr.sort || "newest");
    out.manager.filter = String(s.mgr.filter || "all");
    out.manager.selected = avImportUiSelCount();
    /* R21: the view halves + the incremental window + the inspector (existing keys kept) */
    out.manager.fmt = String(s.mgr.fmt || "all");
    out.manager.pack = String(s.mgr.pack || "all");
    out.manager.limit = Math.max(0, Math.round(avImportUiNumOr(s.mgr.limit, AV_IMPORT_UI_LIB_STEP)));
    out.manager.insp = String(s.mgr.insp || "");
    try { out.manager.shown = Math.min(avImportUiViewItems().length, out.manager.limit, AV_IMPORT_UI_LIB_ROWS_MAX); }
    catch (e2) { out.manager.shown = 0; }
  } catch (e) { /* defaults stand */ }
  return out;
}

function avImportUiProof() {
  let sniff = null;
  try {
    if (typeof avImportSniff === "function") {
      const r = avImportSniff(new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]));
      if (r && typeof r === "object" && typeof r.format === "string") sniff = r.format;
    }
  } catch (e) { /* the core is not present */ }
  return "IMPORT SELFTEST " + JSON.stringify({
    version: AV_IMPORT_UI_VERSION,
    inited: avImportUiState.inited === true,
    libCount: avImportUiNumOr(avImportUiState.lib.count, 0),
    sniff: sniff,
    hub: true,
  });
}

function avImportUiClasses() {
  return AV_IMPORT_UI_CLASSES.slice();
}

/* ---------- debug/verify handle (rigs + parent call these; names are the contract) ---------- */

if (typeof window !== "undefined" && window) {
  try {
    window.__avImport = {
      version: AV_IMPORT_UI_VERSION,
      init: function () { return avImportUiInit(); },
      snap: function () { return avImportUiSnap(); },
      importFiles: function (files, opts) { return avImportUiImport(files, opts); },
      refresh: function () { return avImportUiRefreshLib(); },
      classes: function () { return avImportUiClasses(); },
      /* R17 additions (every existing key kept) */
      pick: function () { return avImportUiPick("file"); },
      pickDir: function () { return avImportUiPickDir(); },
      library: function () { return avImportUiLibrary(); },
      rename: function (id, name) { return avImportUiRename(id, name); },
      exportItem: function (id) { return avImportUiExportItem(id); },
      /* R18 additions (every existing key kept) */
      replace: function (id) { return avImportUiActReplace(id); },
      relink: function (name, candidateId) { return avImportUiRelink(candidateId, name); },
      missing: function () { return avImportUiMissingCount(); },
      /* R21 additions (every existing key kept) */
      managerMount: function (el) { return avImportUiManagerMount(el); },
      mgrEl: function () { return avImportUiMgrEl(); },
      setFormat: function (f) { return avImportUiSetFormat(f); },
      setPack: function (p) { return avImportUiSetPack(p); },
      more: function () { return avImportUiMore(); },
      inspect: function (id) { return avImportUiInspect(id); },
      bulk: function (act) { return avImportUiBulk(act); },
    };
  } catch (e) { /* no window -- nothing to publish */ }
}
