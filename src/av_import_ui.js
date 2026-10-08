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
   classes}.

   PROOF EMISSION (the console-proof-leak law; mirrors av_lfo.js lines 255-275 EXACTLY in
   shape): at init, gated on the same ?avtest=1 query check the LFO card uses, deferred with
   setTimeout(..., 0): avTestLine(avImportUiProof(), "av-importtest") -- never at parse time,
   never on the plain page.

   CONSTANTS this module owns: AV_IMPORT_UI_VERSION "r15b.0" . AV_IMPORT_UI_DEPTH_CAP 8
   (folder-walk depth cap) . AV_IMPORT_UI_MAX_FILES 600 (fallback mirror of the core's
   AV_IMPORT_MAX_FILES) . AV_IMPORT_UI_ROWS_MAX 600 (report rows painted) .
   AV_IMPORT_UI_LIB_ROWS_MAX 400 (library rows painted) . AV_IMPORT_UI_ACCEPT (the input
   accept list) . AV_IMPORT_UI_CLASSES (below).

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
const AV_IMPORT_UI_ACCEPT = "audio/*,.wav,.aiff,.aif,.aifc,.mp3,.mid,.midi,.rx2,.exs,.nki,.nbkt,.sxt,.kong,.mxgrp,.wt,.fxp,.serumpreset,.adg,.als,.zip";

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
        meta: avImportUiMetaPub(it.meta),
      });
    }
  } catch (e) { /* empty stands */ }
  return out;
}

/* the receipt's counts (numbers only; derived from items when counts is absent) */
function avImportUiCountsOf(r) {
  /* R16: + bundles (the core's additive zip-expansion count) */
  const keys = ["total", "imported", "deferred", "refused", "samples", "patterns", "kits", "refs", "bundles"];
  const c = { total: 0, imported: 0, deferred: 0, refused: 0, samples: 0, patterns: 0, kits: 0, refs: 0, bundles: 0 };
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
   never navigate the page away). One claim per document, preventDefault only. */
function avImportUiClaimDoc() {
  try {
    const d = avImportUiDoc();
    if (!d) return false;
    const de = d.documentElement;
    if (de && de.dataset && de.dataset.avImportDoc === "1") return true;
    if (de && de.dataset) de.dataset.avImportDoc = "1";
    d.addEventListener("dragover", function (e) { try { e.preventDefault(); } catch (err) { /* ok */ } });
    d.addEventListener("drop", function (e) { try { e.preventDefault(); } catch (err) { /* ok */ } });
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
    return avImportUiPaintStatus(avImportUiHost());
  } catch (e) { return false; }
}

function avImportUiCountsText() {
  const s = avImportUiState;
  try {
    if (!s.last) return "no runs yet \u2014 drop a folder or files";
    const c = s.last.counts || {};
    let line = c.total + " files \u00b7 imported " + c.imported + " \u00b7 deferred " + c.deferred +
      " \u00b7 refused " + c.refused + " \u00b7 samples " + c.samples + " \u00b7 patterns " + c.patterns;
    if (c.kits > 0) line += " \u00b7 " + c.kits + " kits";
    if (c.refs > 0) line += " \u00b7 " + c.refs + " refs";
    /* R16: zip bundles (the core's counts.bundles; shown only above zero) */
    if (c.bundles > 0) line += " \u00b7 " + c.bundles + " bundles";
    return line;
  } catch (e) { return "no runs yet"; }
}

function avImportUiPaintCounts(host) {
  return avImportUiWriteText(host, "#av-import-counts", avImportUiCountsText(), "counts");
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
  if (it.sibling) {
    html += '<span class="av-import-chip av-import-chip-sib" title="' + avImportUiEsc("same-stem sibling in this run: " + it.sibling) + '">+ ' + avImportUiEsc(it.sibling) + "</span>";
  }
  html += '<span class="av-import-reason av-dim" title="' + avImportUiEsc(it.reason || "") + '">' + avImportUiEsc(it.reason || "") + "</span>";
  html += "</div>";
  return html;
}

/* rebuild the report when a run landed (memo: runSeq); the empty state stays in the DOM,
   hidden, whenever rows exist */
function avImportUiPaintReport(host, force) {
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const s = avImportUiState;
    if (!force && s.reportPaintedSeq === s.runSeq) return true;
    const box = host.querySelector("#av-import-report");
    if (!box) return false;
    const items = s.reportItems || [];
    let html = "";
    if (!items.length) {
      html = '<p class="av-note av-dim av-import-empty" id="av-import-empty">' + avImportUiEsc(avImportUiEmptyMsg()) + "</p>";
    } else {
      const n = Math.min(items.length, AV_IMPORT_UI_ROWS_MAX);
      for (let i = 0; i < n; i++) html += avImportUiRowHTML(items[i]);
      if (items.length > n) {
        html += '<p class="av-note av-dim av-import-empty">' + avImportUiEsc("showing the first " + n + " of " + items.length + " files") + "</p>";
      }
      html += '<p class="av-note av-dim av-import-empty" id="av-import-empty" hidden>' + avImportUiEsc(avImportUiEmptyMsg()) + "</p>";
    }
    box.innerHTML = html;
    s.reportPaintedSeq = s.runSeq;
    return true;
  } catch (e) { return false; }
}

/* ---------- the library list ---------- */

/* one library row's JSON-safe view; R15c adds bounded counts (zones/samples/refs/tables) and
   the hasPattern flag so the new-kind rows render without holding whole metas. */
function avImportUiLibItemPub(it) {
  const out = {
    id: avImportUiStr(it && it.id, 80),
    name: avImportUiStr(it && it.name, 120),
    kind: avImportUiStr(it && it.kind, 24),
    format: avImportUiStr(it && it.format, 24),
    size: avImportUiNumOr(it && it.size, 0),
    at: avImportUiNumOr(it && it.at, 0),
    meta: avImportUiMetaPub(it && it.meta),
    counts: { zones: 0, samples: 0, refs: 0, tables: 0 },
    hasPattern: false,
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
  return out;
}

function avImportUiActBtnHTML(id, act, label, title, disabled) {
  return '<button type="button" class="av-btn mini av-import-act" data-av-import-act="' + act +
    '" data-id="' + avImportUiEsc(id) + '" title="' + avImportUiEsc(title) + '"' +
    (disabled ? " disabled" : "") + ">" + label + "</button>";
}

/* one library row -- the five pinned actions on sample/pattern rows; R15c: kit rows show the
   KIT action + DEL, refs rows show SEQ (only when the meta carries a pattern) + DEL */
function avImportUiLibRowHTML(it) {
  const id = String(it.id || "");
  const kind = String(it.kind || "");
  const isPattern = (kind === "pattern");
  const isKit = (kind === "kit");
  const isRefs = (kind === "refs");
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
  html += '<span class="av-import-item-name" title="' + avImportUiEsc(name) + '">' + avImportUiEsc(name) + "</span>";
  html += '<span class="av-import-item-meta av-dim">' + avImportUiEsc(meta) + "</span>";
  html += '<span class="av-import-acts">';
  if (isKit) {
    html += avImportUiActBtnHTML(id, "kit", "KIT", "load this kit into the sampler engine (slots + zones)", false);
    html += avImportUiActBtnHTML(id, "del", "DEL", "remove it from the local library", false);
  } else if (isRefs) {
    if (it.hasPattern === true) {
      html += avImportUiActBtnHTML(id, "seq", "SEQ", "load the pattern into the sequencer", false);
    }
    html += avImportUiActBtnHTML(id, "del", "DEL", "remove it from the local library", false);
  } else {
    html += avImportUiActBtnHTML(id, "load", "LOAD", "load this item into the session", false);
    html += avImportUiActBtnHTML(id, "send", "SEND", "load it and send the session entry to the slot above", false);
    html += avImportUiActBtnHTML(id, "chop", "CHOP", "load it and aim the chop card at it", false);
    html += avImportUiActBtnHTML(id, "seq", "SEQ", "load the pattern into the sequencer", !isPattern);
    html += avImportUiActBtnHTML(id, "del", "DEL", "remove it from the local library", false);
  }
  html += "</span></div>";
  return html;
}

function avImportUiLibStatText() {
  const s = avImportUiState;
  if (!s.lib.ok) return s.lib.error ? "library unavailable" : "library idle";
  return s.lib.count + " item" + (s.lib.count === 1 ? "" : "s") + " \u00b7 " + avImportUiFmtBytes(s.lib.bytes);
}

function avImportUiPaintLibStat(host) {
  return avImportUiWriteText(host, "#av-import-libstat", avImportUiLibStatText(), "libstat");
}

function avImportUiPaintLib(host, force) {
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const s = avImportUiState;
    let sig = (s.lib.ok ? "1" : "0") + "|" + s.lib.backend + "|" + s.lib.count + "|" + s.lib.bytes + "|" + s.lib.items.length;
    if (s.lib.items.length) sig += "|" + s.lib.items[0].id + "|" + s.lib.items[s.lib.items.length - 1].id;
    if (!force && sig === s.libSig) { avImportUiPaintLibStat(host); return true; }
    const box = host.querySelector("#av-import-lib");
    if (!box) return false;
    const items = s.lib.items || [];
    let html = "";
    if (!items.length) {
      let msg;
      if (s.lib.ok) msg = "library empty \u2014 imported files land here";
      else if (s.lib.error) msg = "library unavailable \u2014 " + s.lib.error;
      else msg = "the library (av_lib.js) is not present \u2014 nothing to list yet";
      html = '<p class="av-note av-dim av-import-empty">' + avImportUiEsc(msg) + "</p>";
    } else {
      const n = Math.min(items.length, AV_IMPORT_UI_LIB_ROWS_MAX);
      for (let i = 0; i < n; i++) html += avImportUiLibRowHTML(items[i]);
      if (items.length > n) {
        html += '<p class="av-note av-dim av-import-empty">' + avImportUiEsc("showing the newest " + n + " of " + items.length + " items") + "</p>";
      }
    }
    box.innerHTML = html;
    s.libSig = sig;
    avImportUiPaintLibStat(host);
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
        finish(false);
        return;
      }
      let out = null;
      try { out = avLibList(); } catch (e) { out = { ok: false, error: avImportUiErrText(e, "the library read failed") }; }
      avImportUiSettle(out, function (r) {
        try { avImportUiApplyLib(r); } catch (e) { /* apply never throws */ }
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
  avImportUiPaintAll(avImportUiHost(), false);
  avImportUiRefreshLib();
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
    const host = avImportUiHost();
    if (host && typeof host.querySelector === "function") {
      const el = host.querySelector("#av-import-slot");
      if (el && el.value !== "") {
        const n = Number(el.value);
        if (isFinite(n)) return Math.min(4, Math.max(1, Math.round(n)));
      }
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
  } catch (e) {
    avImportUiSetStatus("the action failed \u2014 " + avImportUiErrText(e, "unexpected"), "err");
  }
  return false;
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
    if (!t || !t.id) return;
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

function avImportUiWire(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  try {
    if (host.dataset && host.dataset.avImportWired === "1") return true;
    if (host.dataset) host.dataset.avImportWired = "1";
    host.addEventListener("click", avImportUiOnClick);
    host.addEventListener("keydown", avImportUiOnKeydown);
    host.addEventListener("change", avImportUiOnChange);
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
    '<div class="av-import-libhead">' +
    '<span class="av-import-libtag">LIBRARY</span>' +
    '<span class="av-import-libstat av-dim" id="av-import-libstat">library idle</span>' +
    '<label class="av-import-lbl" for="av-import-slot">SEND TO SLOT</label>' +
    '<select class="av-select av-import-slot" id="av-import-slot" aria-label="Target sampler slot 1 to 4">' + avImportUiSlotOptionsHTML() + "</select>" +
    '<button type="button" class="av-btn mini av-import-btn" id="av-import-librefresh" title="refresh the local library list">\u27f3</button>' +
    "</div>" +
    '<div class="av-import-lib" id="av-import-lib"></div>' +
    '<p class="av-note av-dim av-import-note" id="av-import-note">Imports land in your local library \u2014 nothing is uploaded.</p>' +
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
      });
    }
  } catch (e) { /* report stays empty */ }
  try {
    out.lib.count = avImportUiNumOr(s.lib.count, 0);
    out.lib.bytes = avImportUiNumOr(s.lib.bytes, 0);
    out.lib.backend = String(s.lib.backend || "");
  } catch (e) { /* zeros stand */ }
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
    };
  } catch (e) { /* no window -- nothing to publish */ }
}
