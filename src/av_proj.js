/* av_proj.js — Anvil S4 DELIVER EXTRAS (child sa-A, verify/_s4_wave.md §2.1): the .anvl project
   I/O core — save/open of full session projects through a File System Access seam with an anchor /
   download fallback, plus direct sample import from disk.

   R20 (verify/_r20_wave.md section 4, extended ADDITIVELY): the av-projects-store IDB v1 keeps
   recent projects + the current save target; a plain Save reuses the stored handle, Save As
   always picks, opens upsert recents. Boot templates stay deferred (recorded in the report).

   THE PIECES:
     avProjBuild  the envelope — compact JSON text of { magic:"anvl", v:1, app:"anvil",
                  kind:"project", at:<ISO>, name, state:<avSessionCapture() output verbatim> }
                  plus one trailing LF; explicit field order; deterministic (`at` derives from
                  meta.at, then state.savedAt, then the epoch ISO — never a wall-clock read).
     avProjParse  the read half — pure; validates magic==="anvl" && v===1 && kind==="project" &&
                  a state object; foreign/corrupt input is an honest ok:false.
     avProjSave   capture -> build -> FSA showSaveFilePicker -> createWritable -> write(text) ->
                  close; fallback avDeliverDownload(bytes, name) when callable, else an own anchor.
                  AbortError (user cancel) = {ok:false, error:"cancelled"} — no fallback noise.
     avProjOpen   FSA showOpenFilePicker (multiple:false) -> getFile() -> text() -> avProjParse ->
                  avSessionApply(project.state) — the session module's OWN laws apply; nothing is
                  re-implemented here.
     avProjImportSamples  FSA multi-open (audio types) -> avSampleImportFiles(files); fallback =
                  ONE hidden <input type="file" multiple accept="audio/*">, appended once, reused.
     store        av-projects-store v1 (R20 section 4): store `recents` (keyPath "id"; record
                  {id, name, at, size, handle|null, via}; cap 8, oldest rotated out) + store
                  `state` (keyPath "key"; the ONE `current` record {handle, name, at} behind
                  Save-reuse). Handles are structured-cloneable (the av_sources_store precedent);
                  a handle that cannot be structured-cloned persists as null and the record says
                  so. A record that never reaches the DB is session-only and says so.
     save reuse   a plain avProjSave reuses the stored current handle: queryPermission ->
                  requestPermission -> write straight through (NO picker); denied/absent -> the
                  picker. avProjSave({ saveAs: true }) / avProjSaveAs always picks and becomes
                  the new current. Save success upserts a recent (dedupe by name).
     recents      avProjRecents() -> Promise<{ok, count, items:[{id, name, at, size, via,
                  handle, note}]}> (newest first). avProjOpenRecent(id) -> Promise<receipt>:
                  resolve -> permission regrant -> read -> the SAME open/apply path; refusals
                  stay honest (no stored handle / denied / unreadable). avProjForgetRecent(id)
                  -> Promise<{ok, id, name, removed}> (the file on disk is never touched).

   PUBLIC SURFACE (classic-script globals, ONE namespace avProj* / AV_PROJ_*):
     avProjInit() -> bool               idempotent; no DOM; nothing to bind
     avProjSetFs(fs|null) -> bool       injection seam { showOpenFilePicker, showSaveFilePicker };
                                        resolved per call; window FSA is the default. An injected
                                        fs is NEVER merged with window - a fake records every call.
     avProjBuild(state?, meta?) -> {ok, error?, name, text}   pure; deterministic bytes
     avProjParse(text) -> {ok, error?, project}               pure; magic/v/kind/state validation
     avProjSave(opts?) -> Promise<receipt>   { ok, error?, name, bytes, via:"fsa"|"download",
                                               warnings[] } - opts: name, at, state (test seam),
                                               saveAs (always the picker; becomes the new current).
                                               A plain Save reuses the stored current handle
                                               (queryPermission -> requestPermission); only a
                                               denied/absent handle reaches the picker.
     avProjSaveAs(opts?) -> Promise<receipt> avProjSave with { saveAs: true } merged in
     avProjOpen(opts?) -> Promise<receipt>   { ok, error?, name, applied, skipped, warnings[] }
                                        - opts.state: raw file TEXT | parsed payload | bare state
     avProjImportSamples() -> Promise<receipt>  { ok, error?, added, errors, count, max,
                                                  via:"fsa"|"input" }
     avProjRecents() -> Promise<{ok, count, items:[{id, name, at, size, via, handle, note}]}>
                                        newest first; `handle` is a bool (JSON-safe rows)
     avProjOpenRecent(id) -> Promise<receipt>   the avProjOpen receipt shape; the record's stored
                                        handle is re-granted (query/request) and re-read; honest
                                        refusals (no such recent / no stored handle / denied)
     avProjForgetRecent(id) -> Promise<{ok, id, name, removed, error?, note?}>
     avProjState() -> { version, init, fsKind:"window"|"injected"|"none", lastSave, lastOpen,
                        lastError, backend:"idb"|"mem", note, recentsLoaded, recentCount,
                        recents:[rows], current:{name, at, hasHandle}|null }
     avProjClasses() -> []              mounts nothing (the UI card owns markup)
     window.__avProj = { version, init, setFs, build, parse, save, saveAs, open, samples,
                         recents, openRecent, forget, state }
     observables: window.__avProjLastSave = { name, bytes, via, at }
                  window.__avProjLastOpen = { name, ok, applied, skipped, at }

   DETERMINISM (the pure pair): build emits compact JSON of an explicitly-ordered object plus one
   trailing LF. `at` resolves meta.at (ms number or ISO string, verbatim when a string) ->
   state.savedAt -> AV_PROJ_EPOCH_ISO. Two builds of the same state + meta are byte-identical;
   parse is pure JSON in, project out.

   LAWS (verify/_s4_wave.md §3): 'use strict'; classic script; ONE namespace; node-loadable (zero
   DOM reach at load — every browser reach typeof-guarded inside functions); NEVER throws (honest
   refusals, counted skips); no console noise; bounded arrays (cap 16). The module creates no
   audio objects of any kind.

   ONE writer (child sa-A). */

"use strict";

/* ---------- pins (§2.1) ---------- */

const AV_PROJ_VERSION = "r20.0";
const AV_PROJ_MAGIC = "anvl";
const AV_PROJ_APP = "anvil";
const AV_PROJ_KIND = "project";
const AV_PROJ_V = 1;
const AV_PROJ_PREFIX = "anvil-project-";
const AV_PROJ_EXT = ".anvl";
const AV_PROJ_NAME_CAP = 64;
const AV_PROJ_SLUG_CAP = 40;
const AV_PROJ_MSG_CAP = 120;
const AV_PROJ_LIST_CAP = 16;                       /* every receipt array is bounded (§3 law 7) */
const AV_PROJ_TEXT_CAP = 16777216;                 /* 16 MiB — refuse absurd texts both ways */
const AV_PROJ_EPOCH_ISO = "1970-01-01T00:00:00.000Z";   /* the deterministic `at` of last resort */
const AV_PROJ_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})?$/;
const AV_PROJ_CLASSES = Object.freeze([]);         /* this module mounts nothing */
/* R20 section 4: the projects store (pinned names + shape) */
const AV_PROJ_DB = "av-projects-store";            /* pinned IDB name (v1) */
const AV_PROJ_DB_VER = 1;                          /* create-if-missing only; NO version bump */
const AV_PROJ_OS_RECENTS = "recents";              /* object store, keyPath "id" */
const AV_PROJ_OS_STATE = "state";                  /* object store, keyPath "key" */
const AV_PROJ_STATE_KEY = "current";               /* the ONE state record behind Save-reuse */
const AV_PROJ_RECENT_CAP = 8;                      /* recents cap - oldest rotated out */
const AV_PROJ_OPEN_CAP_MS = 1800;                  /* hung IDB open give-up (mirrors av_sources) */
const AV_PROJ_REC_ID_MAX = 96;                     /* recent id length guard */

/* ---------- module state (no DOM nodes; the input element is the one browser object held) ---- */

const avProj = {
  inited: false,
  fs: null,              /* the injected seam (null = window FSA default) */
  fsInjected: false,
  inputEl: null,         /* the ONE hidden <input> for the samples fallback — appended once */
  lastSave: null,
  lastOpen: null,
  lastError: null,
  /* R20: the av-projects-store state */
  db: null,              /* the shared IDB connection */
  dbGaveUp: false,       /* a hung open gave up - the honest "mem" tier stands */
  backend: "mem",        /* "idb" | "mem" - promoted never demoted */
  backendNote: null,
  recentsLoaded: false,
  loadP: null,
  recents: {},           /* id -> rec {id, name, at, size, handle, via, note, sessionOnly} */
  current: null,         /* {handle, name, at} - the Save-reuse target (session truth) */
  seq: 0,                /* recent-id collision counter */
};

/* ---------- guarded environment reaches (plain node has none of these) ---------- */

function avProjWin() {
  try {
    const w = (typeof window !== "undefined") ? window : null;
    if (w && typeof w === "object") return w;
  } catch (e) { /* no window */ }
  return null;
}

function avProjDoc() {
  try {
    if (typeof document !== "undefined" && document && typeof document.createElement === "function") return document;
  } catch (e) { /* no document */ }
  return null;
}

function avProjNow() {
  try { return Date.now(); } catch (e) { return 0; }
}
function avProjTimer(fn, ms) {
  try { if (typeof setTimeout === "function") return setTimeout(fn, ms); } catch (e) { /* no timers */ }
  return null;
}

function avProjClear(t) {
  try { if (t != null && typeof clearTimeout === "function") clearTimeout(t); } catch (e) { /* no timers */ }
}

function avProjIdb() {
  try { if (typeof indexedDB !== "undefined" && indexedDB) return indexedDB; } catch (e) { /* none */ }
  try { const w = avProjWin(); if (w && w.indexedDB) return w.indexedDB; } catch (e) { /* none */ }
  return null;
}

/* ---------- tiny value laws (garbage in, sane value out — never throw) ---------- */

function avProjObj(v) {
  return (v !== null && typeof v === "object" && !Array.isArray(v));
}

function avProjClone(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; }
}

function avProjErrName(e) {
  try { return (e && e.name) ? String(e.name).slice(0, 40) : ""; } catch (e2) { return ""; }
}

function avProjErrMsg(e) {
  try {
    const s = (e && e.message) ? String(e.message) : String(e);
    return s.slice(0, AV_PROJ_MSG_CAP);
  } catch (e2) { return "error"; }
}

/* bounded push: receipt arrays never grow past AV_PROJ_LIST_CAP (§3 law 7) */
function avProjPush(list, item) {
  try {
    if (list && typeof list.push === "function" && list.length < AV_PROJ_LIST_CAP) {
      list.push(String(item == null ? "" : item).slice(0, AV_PROJ_MSG_CAP));
    }
  } catch (e) { /* bounded by design */ }
}

/* copy a list of names/paths into a fresh, capped, string-only array */
function avProjStringList(v) {
  const out = [];
  try {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length && out.length < AV_PROJ_LIST_CAP; i++) {
        out.push(String(v[i] == null ? "" : v[i]).slice(0, AV_PROJ_MSG_CAP));
      }
    }
  } catch (e) { /* [] */ }
  return out;
}

/* ---------- naming (§2.1: anvil-project-<slug>.anvl; slug from the session name or "untitled") */

function avProjCleanName(v) {
  try {
    if (typeof v === "number" && isFinite(v)) v = String(v);
    if (typeof v !== "string") return null;
    const s = v.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
    if (!s) return null;
    return s.slice(0, AV_PROJ_NAME_CAP);
  } catch (e) { return null; }
}

function avProjSlug(v) {
  try {
    let s = String(v == null ? "" : v).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    s = s.replace(/^-+/, "").replace(/-+$/, "").slice(0, AV_PROJ_SLUG_CAP).replace(/-+$/, "");
    return s || "untitled";
  } catch (e) { return "untitled"; }
}

function avProjFileName(name) {
  return AV_PROJ_PREFIX + avProjSlug(name) + AV_PROJ_EXT;
}

/* ---------- the `at` law (deterministic; no wall-clock read) ---------- */

function avProjIso(v) {
  try {
    if (typeof v === "number") {
      if (!isFinite(v)) return null;
      return new Date(v).toISOString();
    }
    if (typeof v === "string") {
      const s = v.trim();
      if (s.length >= 19 && s.length <= 40 && AV_PROJ_ISO_RE.test(s)) return s;
    }
  } catch (e) { /* garbage in */ }
  return null;
}

function avProjResolveAt(state, meta) {
  let at = null;
  try { if (meta && meta.at !== undefined && meta.at !== null) at = avProjIso(meta.at); } catch (e) { at = null; }
  if (at) return at;
  try { if (state) at = avProjIso(state.savedAt); } catch (e) { at = null; }
  if (at) return at;
  return AV_PROJ_EPOCH_ISO;
}

/* ---------- UTF-8 accounting (bytes are the truth, whatever the code units) ---------- */

function avProjUtf8Bytes(text) {
  try {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(String(text == null ? "" : text));
  } catch (e) { /* fall through to the manual count */ }
  return null;
}

function avProjUtf8Len(text) {
  const s = String(text == null ? "" : text);
  try {
    const b = avProjUtf8Bytes(s);
    if (b) return b.length;
  } catch (e) { /* manual count stands */ }
  let n = 0;
  try {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { n += 4; i += 1; } else n += 3;
      } else n += 3;
    }
  } catch (e) { return 0; }
  return n;
}

/* ---------- the FSA seam (the ONLY picker reach; resolved per call) ---------- */

function avProjFs() {
  try { if (avProj.fsInjected && avProj.fs && typeof avProj.fs === "object") return avProj.fs; } catch (e) { /* read refused */ }
  return avProjWin();
}

function avProjFsKind() {
  try {
    if (avProj.fsInjected && avProj.fs) return "injected";
    const w = avProjWin();
    if (w && (typeof w.showSaveFilePicker === "function" || typeof w.showOpenFilePicker === "function")) return "window";
  } catch (e) { /* none */ }
  return "none";
}

/* resolved picker: { fs, fn } (called as fn.call(fs, opts) — receivers stay intact) or null */
function avProjPicker(kind) {
  const fs = avProjFs();
  if (!fs) return null;
  try {
    const fn = (kind === "save") ? fs.showSaveFilePicker : fs.showOpenFilePicker;
    if (typeof fn === "function") return { fs: fs, fn: fn };
  } catch (e) { /* property read refused */ }
  return null;
}

/* ---------- sibling-module resolvers (binding, then window property) ---------- */

function avProjCaptureFn() {
  try { if (typeof avSessionCapture === "function") return avSessionCapture; } catch (e) { /* not injected */ }
  try { const w = avProjWin(); if (w && typeof w.avSessionCapture === "function") return w.avSessionCapture; } catch (e) { /* no window */ }
  return null;
}

function avProjApplyFn() {
  try { if (typeof avSessionApply === "function") return avSessionApply; } catch (e) { /* not injected */ }
  try { const w = avProjWin(); if (w && typeof w.avSessionApply === "function") return w.avSessionApply; } catch (e) { /* no window */ }
  return null;
}

function avProjImportFn() {
  try { if (typeof avSampleImportFiles === "function") return avSampleImportFiles; } catch (e) { /* not injected */ }
  try { const w = avProjWin(); if (w && typeof w.avSampleImportFiles === "function") return w.avSampleImportFiles; } catch (e) { /* no window */ }
  return null;
}

function avProjDeliverFn() {
  try { if (typeof avDeliverDownload === "function") return avDeliverDownload; } catch (e) { /* not injected */ }
  try { const w = avProjWin(); if (w && typeof w.avDeliverDownload === "function") return w.avDeliverDownload; } catch (e) { /* no window */ }
  return null;
}

/* ---------- picker option builders (fresh objects per call; deterministic) ---------- */

function avProjSaveTypes() {
  return [{ description: "Anvil project", accept: { "application/json": [".anvl"] } }];
}

function avProjOpenTypes() {
  return [{ description: "Anvil project", accept: { "application/json": [".anvl", ".json"] } }];
}

function avProjAudioTypes() {
  return [{
    description: "Audio samples",
    accept: {
      "audio/wav": [".wav"],
      "audio/mpeg": [".mp3"],
      "audio/ogg": [".ogg"],
      "audio/flac": [".flac"],
      "audio/mp4": [".m4a"],
    },
  }];
}

/* ---------- the av-projects-store (R20 section 4): recents + the current save target ----------

   IDB "av-projects-store" v1 (pinned), two stores:
     recents   keyPath "id"    record {id, name, at, size, handle|null, via}
     state     keyPath "key"   the ONE "current" record {key, handle, name, at} behind Save
   Handles are structured-cloneable (the av_sources_store precedent); a handle that cannot be
   cloned persists as null and the record says so. "mem" = the record never reached the DB
   (session-only, reported honestly). Every op ensures ONE lazy load first. */

function avProjDbOpen() {
  return new Promise(function (res) {
    try {
      const st = avProj;
      if (st.db) return res(st.db);
      if (st.dbGaveUp) return res(null);
      const idb = avProjIdb();
      if (!idb) return res(null);
      let settled = false;
      const give = function (v) { if (!settled) { settled = true; res(v); } };
      /* a hung open (blocked upgrade in another tab) must not wedge the module: give up after
         AV_PROJ_OPEN_CAP_MS; a late success closes its handle and stays honest */
      const timer = avProjTimer(function () { st.dbGaveUp = true; give(null); }, AV_PROJ_OPEN_CAP_MS);
      const rq = idb.open(AV_PROJ_DB, AV_PROJ_DB_VER);
      rq.onupgradeneeded = function () {
        try {
          const db = rq.result;
          if (!db.objectStoreNames || !db.objectStoreNames.contains(AV_PROJ_OS_RECENTS)) db.createObjectStore(AV_PROJ_OS_RECENTS, { keyPath: "id" });
          if (!db.objectStoreNames || !db.objectStoreNames.contains(AV_PROJ_OS_STATE)) db.createObjectStore(AV_PROJ_OS_STATE, { keyPath: "key" });
        } catch (e) { /* upgrade raced */ }
      };
      rq.onsuccess = function () {
        avProjClear(timer);
        if (st.dbGaveUp) { try { rq.result.close(); } catch (e) { /* ignore */ } return give(null); }
        const db = rq.result;
        st.db = db;
        try { db.onclose = function () { if (avProj.db === db) avProj.db = null; }; } catch (e) { /* fine */ }
        give(db);
      };
      rq.onerror = function () { avProjClear(timer); give(null); };
      rq.onblocked = function () { avProjClear(timer); give(null); };
    } catch (e) { res(null); }
  });
}

function avProjDbAll(db, os) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(os, "readonly");
      const rq = tx.objectStore(os).getAll();
      rq.onsuccess = function () { res(Array.isArray(rq.result) ? rq.result : []); };
      rq.onerror = function () { res(null); };
      tx.onerror = function () { res(null); };
    } catch (e) { res(null); }
  });
}

function avProjDbGet(db, os, key) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(os, "readonly");
      const rq = tx.objectStore(os).get(key);
      rq.onsuccess = function () { res((rq.result === undefined) ? null : rq.result); };
      rq.onerror = function () { res(null); };
      tx.onerror = function () { res(null); };
    } catch (e) { res(null); }
  });
}

/* put one record; resolves false when the value cannot be structured-cloned (stub handles) */
function avProjDbPut(db, os, rec) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(os, "readwrite");
      let settled = false;
      const done = function (v) { if (!settled) { settled = true; res(v); } };
      try { tx.objectStore(os).put(rec); }
      catch (ePut) { done(false); try { tx.abort(); } catch (e2) { /* ignore */ } return; }
      tx.oncomplete = function () { done(true); };
      tx.onerror = function () { done(false); };
      tx.onabort = function () { done(false); };
    } catch (e) { res(false); }
  });
}

function avProjDbDel(db, os, key) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(os, "readwrite");
      tx.objectStore(os).delete(key);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { res(false); };
      tx.onabort = function () { res(false); };
    } catch (e) { res(false); }
  });
}

/* ---------- record + id laws ---------- */

function avProjHandleNorm(v) {
  try { if (v && typeof v === "object" && !Array.isArray(v)) return v; } catch (e) { /* none */ }
  return null;
}

function avProjViaNorm(v) {
  try { if (v === "fsa" || v === "download") return v; } catch (e) { /* none */ }
  return null;
}

function avProjRecIdNorm(v) {
  try {
    if (typeof v !== "string") return "";
    return v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, AV_PROJ_REC_ID_MAX);
  } catch (e) { return ""; }
}

function avProjRecNorm(raw) {
  try {
    if (!avProjObj(raw)) return null;
    const id = avProjRecIdNorm(raw.id);
    if (!id) return null;
    return {
      id: id,
      name: avProjCleanName(raw.name) || "untitled",
      at: avProjIso(raw.at),
      size: (typeof raw.size === "number" && isFinite(raw.size) && raw.size >= 0) ? Math.floor(raw.size) : 0,
      handle: avProjHandleNorm(raw.handle),
      via: avProjViaNorm(raw.via),
      note: null,
      sessionOnly: false,
    };
  } catch (e) { return null; }
}

function avProjCurrentNorm(raw) {
  try {
    if (!avProjObj(raw)) return null;
    if (raw.key !== AV_PROJ_STATE_KEY) return null;
    return { handle: avProjHandleNorm(raw.handle), name: avProjCleanName(raw.name), at: avProjIso(raw.at) };
  } catch (e) { return null; }
}

/* a recent id: "p" + time36 + "-" + slug (+ "-<seq>" on collision) - house style */
function avProjMakeRecId(name) {
  const st = avProj;
  let id = "p" + avProjNow().toString(36) + "-" + avProjSlug(name);
  try {
    while (st.recents[id]) {
      st.seq += 1;
      id = "p" + avProjNow().toString(36) + "-" + avProjSlug(name) + "-" + st.seq;
      if (st.seq > 100000) break;
    }
  } catch (e) { /* the base id stands */ }
  return id;
}

/* ---------- permission probes (the av_sources D8 pattern; a stubbed STRING value is honoured) --- */

function avProjPermNorm(p) {
  try { if (p === "granted" || p === "prompt" || p === "denied") return p; } catch (e) { /* none */ }
  return "unknown";
}

function avProjPermFnV(handle, name) {
  try {
    const v = handle[name];
    if (typeof v === "function") return { has: true, fn: v, val: null };
    if (typeof v === "string") return { has: true, fn: null, val: v };   /* a stubbed state value */
  } catch (e) { /* read refused */ }
  return { has: false, fn: null, val: null };
}

async function avProjPermCall(handle, d, mode) {
  try {
    if (d && d.fn) return avProjPermNorm(await d.fn.call(handle, { mode: mode }));
    if (d && d.val !== null) return avProjPermNorm(d.val);
  } catch (e) { /* unknown */ }
  return "unknown";
}

/* "granted" -> the stored handle may be written straight through; "picker" -> the caller goes
   to the picker (an honest refusal for a reopen); "assume" -> the handle has NO permission
   surface at all (a stub / compat object): the write itself is then the permission test */
async function avProjPermGo(handle, mode) {
  try {
    if (!handle || typeof handle !== "object") return "picker";
    const m = (mode === "readwrite") ? "readwrite" : "read";
    const q = avProjPermFnV(handle, "queryPermission");
    const r = avProjPermFnV(handle, "requestPermission");
    if (!q.has && !r.has) return "assume";
    let v = "prompt";
    if (q.has) v = await avProjPermCall(handle, q, m);
    if (v === "granted") return "granted";
    if (v === "denied") return "picker";
    if (r.has) {
      const v2 = await avProjPermCall(handle, r, m);
      if (v2 === "granted") return "granted";
    }
    return "picker";
  } catch (e) { return "assume"; }
}

/* write through a stored handle: AbortError keeps the module's calm cancel; a permission failure
   sends the caller back to the picker; anything else falls through with a warning */
async function avProjReuseWrite(handle, text) {
  try {
    if (!handle || typeof handle.createWritable !== "function") return { ok: false, kind: "error", error: "no writable", cancelled: false };
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
    return { ok: true, kind: "ok", error: null, cancelled: false };
  } catch (e) {
    const nm = avProjErrName(e);
    if (nm === "AbortError") return { ok: false, kind: "cancel", error: "cancelled", cancelled: true };
    if (nm === "NotAllowedError" || nm === "SecurityError") return { ok: false, kind: "perm", error: avProjErrMsg(e), cancelled: false };
    return { ok: false, kind: "error", error: avProjErrMsg(e), cancelled: false };
  }
}

/* ---------- lazy load (hydrate once; every op ensures it) ---------- */

async function avProjLoadRun() {
  const st = avProj;
  const db = await avProjDbOpen();
  if (db) {
    st.backend = "idb";
    const raws = await avProjDbAll(db, AV_PROJ_OS_RECENTS);
    if (raws && Array.isArray(raws)) {
      for (let i = 0; i < raws.length; i++) {
        const rec = avProjRecNorm(raws[i]);
        if (rec && !st.recents[rec.id]) st.recents[rec.id] = rec;
      }
    }
    if (!st.current) {
      const curRaw = await avProjDbGet(db, AV_PROJ_OS_STATE, AV_PROJ_STATE_KEY);
      if (curRaw) st.current = avProjCurrentNorm(curRaw);
    }
  } else if (!st.backendNote) {
    st.backendNote = "IndexedDB unavailable - recents are session-only";
  }
  st.recentsLoaded = true;
  return true;
}

function avProjEnsureLoad() {
  const st = avProj;
  if (st.recentsLoaded) return Promise.resolve(true);
  if (st.loadP) return st.loadP;
  st.loadP = Promise.resolve(avProjLoadRun()).catch(function () { st.loadP = null; return false; });
  return st.loadP;
}

function avProjFindRec(id) {
  try {
    const rid = avProjRecIdNorm(id);
    if (!rid) return null;
    const rec = avProj.recents[rid];
    return avProjObj(rec) ? rec : null;
  } catch (e) { return null; }
}

/* ---------- persist (full first incl. the handle, then handle:null so the row still lists) ---- */

async function avProjPersistCurrent() {
  try {
    const st = avProj;
    const cur = st.current;
    if (!cur) return { tier: "mem", handleSaved: false };
    const db = await avProjDbOpen();
    if (!db) return { tier: "mem", handleSaved: false };
    st.backend = "idb";
    const handle = avProjHandleNorm(cur.handle);
    if (handle) {
      const okFull = await avProjDbPut(db, AV_PROJ_OS_STATE, { key: AV_PROJ_STATE_KEY, handle: handle, name: cur.name || null, at: cur.at || null });
      if (okFull) return { tier: "idb", handleSaved: true };
    }
    const okBare = await avProjDbPut(db, AV_PROJ_OS_STATE, { key: AV_PROJ_STATE_KEY, handle: null, name: cur.name || null, at: cur.at || null });
    if (okBare) return { tier: "idb", handleSaved: false };
    return { tier: "mem", handleSaved: false };
  } catch (e) { return { tier: "mem", handleSaved: false }; }
}

async function avProjPersistRecent(rec) {
  try {
    if (!rec || !rec.id) return { tier: "mem", handleSaved: false };
    const st = avProj;
    const db = await avProjDbOpen();
    if (!db) return { tier: "mem", handleSaved: false };
    st.backend = "idb";
    const handle = avProjHandleNorm(rec.handle);
    if (handle) {
      const okFull = await avProjDbPut(db, AV_PROJ_OS_RECENTS, { id: rec.id, name: rec.name, at: rec.at, size: rec.size, handle: handle, via: rec.via });
      if (okFull) return { tier: "idb", handleSaved: true };
    }
    const okBare = await avProjDbPut(db, AV_PROJ_OS_RECENTS, { id: rec.id, name: rec.name, at: rec.at, size: rec.size, handle: null, via: rec.via });
    if (okBare) return { tier: "idb", handleSaved: false };
    return { tier: "mem", handleSaved: false };
  } catch (e) { return { tier: "mem", handleSaved: false }; }
}

/* remove one recent (memory first - the session truth; the DB delete is best-effort) */
async function avProjDeleteRec(id) {
  try {
    const st = avProj;
    const rid = avProjRecIdNorm(id);
    if (!rid) return false;
    if (st.recents[rid]) delete st.recents[rid];
    const db = await avProjDbOpen();
    if (!db) return false;
    st.backend = "idb";
    return await avProjDbDel(db, AV_PROJ_OS_RECENTS, rid);
  } catch (e) { return false; }
}

/* ---------- recents (order + upsert) ---------- */

/* recents order: newest `at` first (a null at sorts oldest); name then id break ties */
function avProjRcSortRows(rows) {
  try {
    rows.sort(function (a, b) {
      const aa = (typeof a.at === "string") ? a.at : "";
      const bb = (typeof b.at === "string") ? b.at : "";
      if (aa !== bb) return (aa < bb) ? 1 : -1;
      if (a.name !== b.name) return (a.name < b.name) ? -1 : 1;
      return (a.id < b.id) ? -1 : ((a.id > b.id) ? 1 : 0);
    });
  } catch (e) { /* the previous order stands */ }
  return rows;
}

/* upsert a recent (dedupe by name - the existing record keeps its id; cap 8, the oldest `at`
   rotated out). The returned rec is the session truth: its handle stays in memory even when the
   DB refused the structured clone (the note says so). */
async function avProjUpsertRecent(info) {
  try {
    const st = avProj;
    await avProjEnsureLoad();
    const src = avProjObj(info) ? info : {};
    const name = avProjCleanName(src.name) || "untitled";
    let rec = null;
    const ids = Object.keys(st.recents);
    for (let i = 0; i < ids.length; i++) {
      const r = st.recents[ids[i]];
      if (r && r.name === name) { rec = r; break; }
    }
    const handle = (src.handle !== undefined) ? avProjHandleNorm(src.handle) : (rec ? rec.handle : null);
    const at = avProjIso(src.at) || (rec ? rec.at : null);
    const size = (typeof src.size === "number" && isFinite(src.size) && src.size >= 0) ? Math.floor(src.size) : (rec ? rec.size : 0);
    const via = avProjViaNorm(src.via) || (rec ? rec.via : null);
    if (!rec) {
      rec = { id: avProjMakeRecId(name), name: name, at: at, size: size, handle: handle, via: via, note: null, sessionOnly: false };
      st.recents[rec.id] = rec;
    } else {
      rec.name = name; rec.at = at; rec.size = size; rec.handle = handle; rec.via = via;
      rec.note = null; rec.sessionOnly = false;
    }
    /* rotate: drop the oldest (by at, then id) that is not the record just upserted; this
       ordering is OLDEST FIRST (the display order is newest first - never reuse it here) */
    const keys = Object.keys(st.recents);
    if (keys.length > AV_PROJ_RECENT_CAP) {
      const all = [];
      for (let i = 0; i < keys.length; i++) { if (st.recents[keys[i]]) all.push(st.recents[keys[i]]); }
      all.sort(function (a, b) {
        const aa = (typeof a.at === "string") ? a.at : "";
        const bb = (typeof b.at === "string") ? b.at : "";
        if (aa !== bb) return (aa < bb) ? -1 : 1;
        return (a.id < b.id) ? -1 : ((a.id > b.id) ? 1 : 0);
      });
      const excess = all.length - AV_PROJ_RECENT_CAP;
      let dropped = 0;
      for (let i = 0; i < all.length && dropped < excess; i++) {
        if (all[i].id === rec.id) continue;
        await avProjDeleteRec(all[i].id);
        dropped += 1;
      }
    }
    const persisted = await avProjPersistRecent(rec);
    if (persisted.tier !== "idb") {
      rec.note = "record is session-only (IndexedDB unavailable)";
      rec.sessionOnly = true;
    } else if (!persisted.handleSaved && avProjHandleNorm(rec.handle)) {
      rec.note = "handle not persistable - pick the file again after reload";
    }
    return rec;
  } catch (e) { return null; }
}

/* ---------- payload validation (§2.1: magic/v/kind/state; never throw) ---------- */

function avProjValidatePayload(p) {
  try {
    if (!avProjObj(p)) return { ok: false, error: "not a project payload", project: null };
    if (p.magic !== AV_PROJ_MAGIC) return { ok: false, error: "bad magic", project: null };
    if (p.v !== AV_PROJ_V) return { ok: false, error: "bad version", project: null };
    if (p.kind !== AV_PROJ_KIND) return { ok: false, error: "bad kind", project: null };
    if (!avProjObj(p.state)) return { ok: false, error: "no state", project: null };
    return {
      ok: true,
      error: null,
      project: {
        magic: AV_PROJ_MAGIC,
        v: AV_PROJ_V,
        app: (typeof p.app === "string" && p.app) ? p.app.slice(0, AV_PROJ_NAME_CAP) : null,
        kind: AV_PROJ_KIND,
        at: avProjIso(p.at),
        name: avProjCleanName(p.name),
        state: p.state,
      },
    };
  } catch (e) {
    return { ok: false, error: avProjErrMsg(e), project: null };
  }
}

/* ---------- avProjBuild (§2.1) — pure; deterministic bytes ---------- */

function avProjBuild(stateIn, metaIn) {
  try {
    const meta = avProjObj(metaIn) ? metaIn : {};
    let state = null;
    if (stateIn !== undefined && stateIn !== null) {
      if (!avProjObj(stateIn)) {
        return { ok: false, error: "state must be an object", name: avProjFileName(meta.name), text: "" };
      }
      state = stateIn;
    } else {
      /* no explicit state: the live capture is the default source (guarded; degrade refuses) */
      const cap = avProjCaptureFn();
      if (!cap) return { ok: false, error: "no session module", name: avProjFileName(meta.name), text: "" };
      let got = null;
      try { got = cap(); } catch (e) { got = null; }
      if (!avProjObj(got)) return { ok: false, error: "capture failed", name: avProjFileName(meta.name), text: "" };
      state = got;
    }
    const name = avProjCleanName(meta.name) || avProjCleanName(state.name) || "untitled";
    const at = avProjResolveAt(state, meta);
    let text = null;
    try {
      text = JSON.stringify({
        magic: AV_PROJ_MAGIC,
        v: AV_PROJ_V,
        app: AV_PROJ_APP,
        kind: AV_PROJ_KIND,
        at: at,
        name: name,
        state: state,
      });
    } catch (e) { text = null; }
    if (typeof text !== "string" || text.length === 0) {
      return { ok: false, error: "state not serialisable", name: avProjFileName(name), text: "" };
    }
    if (text.length > AV_PROJ_TEXT_CAP) {
      return { ok: false, error: "too large", name: avProjFileName(name), text: "" };
    }
    return { ok: true, error: null, name: avProjFileName(name), text: text + "\n" };
  } catch (e) {
    return { ok: false, error: avProjErrMsg(e), name: AV_PROJ_PREFIX + "untitled" + AV_PROJ_EXT, text: "" };
  }
}

/* ---------- avProjParse (§2.1) — pure; magic/v/kind/state validation ---------- */

function avProjParse(text) {
  try {
    if (typeof text !== "string") return { ok: false, error: "not a string", project: null };
    if (text.length > AV_PROJ_TEXT_CAP) return { ok: false, error: "too large", project: null };
    let p = null;
    try { p = JSON.parse(text); } catch (e) { return { ok: false, error: "not JSON", project: null }; }
    const v = avProjValidatePayload(p);
    if (!v.ok) return { ok: false, error: v.error, project: null };
    return { ok: true, error: null, project: v.project };
  } catch (e) {
    return { ok: false, error: avProjErrMsg(e), project: null };
  }
}

/* ---------- download fallback (avDeliverDownload when callable, else an own anchor) ---------- */

function avProjAnchor(text, name) {
  try {
    const doc = avProjDoc();
    if (!doc) return false;
    if (typeof Blob === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = doc.createElement("a");
    a.href = url;
    a.download = name;
    try { a.rel = "noopener"; } catch (e) { /* attribute refused */ }
    const body = doc.body;
    let attached = false;
    if (body && typeof body.appendChild === "function") { try { body.appendChild(a); attached = true; } catch (e) { attached = false; } }
    try { a.click(); } catch (e) { /* the anchor click never throws outward here */ }
    if (attached && body && typeof body.removeChild === "function") { try { body.removeChild(a); } catch (e) { /* ok */ } }
    try { if (typeof setTimeout === "function") setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { /* ok */ } }, 8000); } catch (e) { /* ok */ }
    return true;
  } catch (e) { return false; }
}

function avProjDownloadFallback(text, name, warnings) {
  const fn = avProjDeliverFn();
  if (fn) {
    const bytes = avProjUtf8Bytes(text);
    let ok = false;
    try { ok = !!(bytes && fn(bytes, name) === true); } catch (e) { ok = false; }
    if (ok) return true;
    avProjPush(warnings, "deliver download refused — used the anchor");
  }
  return avProjAnchor(text, name);
}

/* ---------- observables + receipt helpers ---------- */

function avProjRecordSave(name, bytes, via, at) {
  try { const w = avProjWin(); if (w) w.__avProjLastSave = { name: name, bytes: bytes, via: via, at: at }; } catch (e) { /* nicety */ }
}

function avProjRecordOpen(name, ok, applied, skipped) {
  try {
    const w = avProjWin();
    if (w) w.__avProjLastOpen = { name: name, ok: ok, applied: applied, skipped: skipped, at: avProjNow() };
  } catch (e) { /* nicety */ }
}

/* ---------- project-layer change fan-out (R20 section 4 recents gap) ----------
   ONE silent document-level CustomEvent after every public op settles. The PROJECT & SHARE
   card (av_files_ui.js) listens for 'av-proj-changed' and repaints its RECENT block, so a save
   or open driven by the File menu, the palette, a rig facade or the launcher refreshes the card
   exactly like the card's own buttons do. kind is 'save' | 'open' | 'recent' | 'forget'
   (informative only; listeners must not depend on it). Never throws, never logs; no document
   (node harness) is a quiet no-op. */
function avProjEmitChanged(kind) {
  try {
    const doc = avProjDoc();
    if (!doc || typeof doc.dispatchEvent !== "function" || typeof CustomEvent !== "function") return false;
    const k = (kind === "save" || kind === "open" || kind === "recent" || kind === "forget") ? kind : "change";
    doc.dispatchEvent(new CustomEvent("av-proj-changed", {
      detail: { kind: k },
    }));
    return true;
  } catch (e) { return false; }
}

function avProjSaveRefuse(error, name, bytes, warnings, via) {
  const receipt = { ok: false, error: error, name: name, bytes: bytes, via: via, warnings: warnings };
  if (error !== "cancelled") avProj.lastError = error;   /* a cancel is calm, not an error */
  return receipt;
}

function avProjSaveOk(name, bytes, via, warnings, at) {
  const receipt = { ok: true, error: null, name: name, bytes: bytes, via: via, warnings: warnings };
  avProj.lastSave = receipt;
  avProj.lastError = null;
  avProjRecordSave(name, bytes, via, at);
  return receipt;
}

/* ---------- avProjSave (§2.1) — capture -> build -> FSA save / download fallback ---------- */

function avProjSave(opts) {
  let out = null;
  try {
    out = Promise.resolve(avProjSaveRun(opts)).catch(function (e) {
      return avProjSaveRefuse(avProjErrMsg(e), null, 0, [], null);
    });
  } catch (e) {
    out = Promise.resolve(avProjSaveRefuse(avProjErrMsg(e), null, 0, [], null));
  }
  /* R20 fan-out: every save / save-as settle (File menu, palette, card, facade) tells the card; the receipt is unchanged */
  return out.then(function (r) { avProjEmitChanged("save"); return r; });
}

async function avProjSaveRun(opts) {
  const o = avProjObj(opts) ? opts : {};
  const warnings = [];
  /* 1) the state: the opts.state test seam, or the live capture (§2.1: capture -> build) */
  let state = null;
  if (o.state !== undefined && o.state !== null) {
    if (!avProjObj(o.state)) return avProjSaveRefuse("state must be an object", null, 0, warnings, null);
    state = o.state;
  } else {
    const cap = avProjCaptureFn();
    if (!cap) return avProjSaveRefuse("no session module", null, 0, warnings, null);
    let got = null;
    try { got = cap(); } catch (e) { got = null; }
    if (!avProjObj(got)) return avProjSaveRefuse("capture failed", null, 0, warnings, null);
    state = got;
  }
  /* 2) the deterministic envelope */
  const at = avProjResolveAt(state, o);
  const b = avProjBuild(state, { name: o.name, at: at });
  if (!b.ok) return avProjSaveRefuse(b.error || "build failed", b.name, 0, warnings, null);
  const name = b.name;
  const text = b.text;
  const bytes = avProjUtf8Len(text);
  if (bytes > AV_PROJ_TEXT_CAP) return avProjSaveRefuse("too large", name, bytes, warnings, null);
  /* 3) the FSA save: a plain Save reuses the stored current handle (queryPermission ->
        requestPermission -> write straight through; only a denied/absent handle reaches the
        picker). { saveAs: true } always picks and becomes the new current (R20 section 4).
        AbortError stays a calm cancel and never falls back. */
  const wantSaveAs = (o.saveAs === true);
  const pick = avProjPicker("save");
  if (!wantSaveAs) {
    await avProjEnsureLoad();
    const ch = avProjHandleNorm(avProj.current ? avProj.current.handle : null);
    if (ch) {
      const perm = await avProjPermGo(ch, "readwrite");
      if (perm !== "picker") {
        const wr = await avProjReuseWrite(ch, text);
        if (wr.ok) {
          const fname = avProjCleanName(ch.name) || name;
          avProj.current = { handle: ch, name: fname, at: at };
          await avProjPersistCurrent();
          const receipt = avProjSaveOk(fname, bytes, "fsa", warnings, at);
          await avProjUpsertRecent({ name: fname, at: at, size: bytes, handle: ch, via: "fsa" });
          return receipt;
        }
        if (wr.cancelled) return avProjSaveRefuse("cancelled", name, bytes, [], null);
        if (wr.kind !== "perm") {
          avProjPush(warnings, "stored handle write failed (" + (wr.error || "error") + ") - pick the file again");
        }
      }
    }
  }
  if (pick) {
    let handle = null, pickerNote = "";
    try {
      handle = await pick.fn.call(pick.fs, { suggestedName: name, types: avProjSaveTypes() });
    } catch (e) {
      if (avProjErrName(e) === "AbortError") return avProjSaveRefuse("cancelled", name, bytes, [], null);
      pickerNote = "save picker refused (" + (avProjErrName(e) || "error") + ") — downloaded instead";
      avProjPush(warnings, pickerNote);
    }
    if (handle && typeof handle.createWritable === "function") {
      let wrote = false;
      try {
        const w = await handle.createWritable();
        await w.write(text);
        await w.close();
        wrote = true;
      } catch (e) {
        if (avProjErrName(e) === "AbortError") return avProjSaveRefuse("cancelled", name, bytes, [], null);
        avProjPush(warnings, "fsa write failed (" + (avProjErrName(e) || "error") + ") — downloaded instead");
      }
      if (wrote) {
        const fname = avProjCleanName(handle.name) || name;
        avProj.current = { handle: handle, name: fname, at: at };
        await avProjPersistCurrent();
        const receipt = avProjSaveOk(fname, bytes, "fsa", warnings, at);
        await avProjUpsertRecent({ name: fname, at: at, size: bytes, handle: handle, via: "fsa" });
        return receipt;
      }
    } else if (handle && !pickerNote) {
      avProjPush(warnings, "fsa handle refused — downloaded instead");
    } else if (!handle && !pickerNote) {
      avProjPush(warnings, "save picker returned nothing — downloaded instead");
    }
  }
  /* 4) the download fallback (via records the truth; the recent row lists name-only) */
  const landed = avProjDownloadFallback(text, name, warnings);
  if (!landed) return avProjSaveRefuse("no save path", name, bytes, warnings, null);
  const receipt = avProjSaveOk(name, bytes, "download", warnings, at);
  await avProjUpsertRecent({ name: name, at: at, size: bytes, handle: null, via: "download" });
  return receipt;
}

/* ---------- avProjOpen (§2.1) — FSA open -> parse -> avSessionApply(state) ---------- */

function avProjOpen(opts) {
  let out = null;
  try {
    out = Promise.resolve(avProjOpenRun(opts)).catch(function (e) {
      return avProjOpenRefuse(avProjErrMsg(e), null, []);
    });
  } catch (e) {
    out = Promise.resolve(avProjOpenRefuse(avProjErrMsg(e), null, []));
  }
  /* R20 fan-out: every open settle repaints the card (a picker open upserts a recent) */
  return out.then(function (r) { avProjEmitChanged("open"); return r; });
}

function avProjOpenRefuse(error, name, warnings) {
  const receipt = { ok: false, error: error, name: name, applied: 0, skipped: [], warnings: warnings };
  avProj.lastOpen = avProjClone(receipt) || receipt;
  if (error !== "cancelled") avProj.lastError = error;
  avProjRecordOpen(name, false, 0, []);
  return receipt;
}

/* the apply half shared by every open route (picker / opts.state / recents): parse done, the
   project in - apply through the session module and record the receipt */
function avProjOpenFinish(project, name, warnings) {
  const applyFn = avProjApplyFn();
  if (!applyFn) return avProjOpenRefuse("no session module", name, warnings);
  let ap = null;
  try { ap = applyFn(project.state); } catch (e) { ap = null; }
  if (!avProjObj(ap)) return avProjOpenRefuse("apply failed", name, warnings);
  const applied = (typeof ap.applied === "number" && isFinite(ap.applied)) ? ap.applied : 0;
  const skipped = avProjStringList(ap.skipped);      /* mirrors avSessionApply's receipt */
  const ok = ap.ok === true;
  let errText = null;
  if (!ok && typeof ap.error === "string" && ap.error) errText = ap.error.slice(0, AV_PROJ_MSG_CAP);
  const receipt = { ok: ok, error: ok ? null : (errText || "apply refused"), name: name, applied: applied, skipped: skipped, warnings: warnings };
  avProj.lastOpen = avProjClone(receipt) || receipt;
  avProj.lastError = receipt.error;
  avProjRecordOpen(name, ok, applied, skipped);
  return receipt;
}

function avProjBaseName(fname) {
  try {
    if (typeof fname !== "string") return null;
    const s = fname.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (!s) return null;
    const i = s.lastIndexOf(".");
    const base = (i > 0) ? s.slice(0, i) : s;
    return base ? base.slice(0, AV_PROJ_NAME_CAP) : null;
  } catch (e) { return null; }
}

function avProjFileText(file) {
  return new Promise(function (res) {
    let settled = false;
    const done = function (t) { if (!settled) { settled = true; res((typeof t === "string") ? t : null); } };
    try {
      if (file && typeof file.text === "function") {
        let p = null;
        try { p = file.text(); } catch (e) { p = null; }
        if (p && typeof p.then === "function") { p.then(function (t) { done(t); }, function () { done(null); }); return; }
        done(p);
        return;
      }
    } catch (e) { /* fall through to FileReader */ }
    try {
      if (file && typeof FileReader === "function") {
        const fr = new FileReader();
        fr.onload = function () { done(fr.result); };
        fr.onerror = function () { done(null); };
        fr.onabort = function () { done(null); };
        fr.readAsText(file);
        return;
      }
    } catch (e) { /* give up */ }
    done(null);
  });
}

async function avProjOpenRun(opts) {
  const o = avProjObj(opts) ? opts : {};
  const warnings = [];
  let project = null;
  let fileBase = null;
  let pickedHandle = null, pickedFile = null;
  /* the opts.state test seam (§2.1: skips the picker) — raw text keeps the FULL pipeline */
  if (typeof o.state === "string") {
    const p = avProjParse(o.state);
    if (!p.ok) return avProjOpenRefuse(p.error || "parse failed", null, warnings);
    project = p.project;
  } else if (avProjObj(o.state)) {
    /* a payload carries magic/kind; a bare session state never does (its own `v` field must NOT
       route it into payload validation — a session state always has v:1) */
    if (o.state.magic !== undefined || o.state.kind !== undefined) {
      const v = avProjValidatePayload(o.state);
      if (!v.ok) return avProjOpenRefuse(v.error || "bad payload", null, warnings);
      project = v.project;
    } else {
      /* a bare state object: applied directly (test seam) */
      project = { magic: AV_PROJ_MAGIC, v: AV_PROJ_V, app: AV_PROJ_APP, kind: AV_PROJ_KIND, at: null, name: null, state: o.state };
    }
  } else {
    const pick = avProjPicker("open");
    if (!pick) return avProjOpenRefuse("no file picker", null, warnings);
    let handles = null;
    try {
      handles = await pick.fn.call(pick.fs, { multiple: false, types: avProjOpenTypes() });
    } catch (e) {
      if (avProjErrName(e) === "AbortError") return avProjOpenRefuse("cancelled", null, []);
      return avProjOpenRefuse("open picker failed (" + (avProjErrName(e) || "error") + ")", null, warnings);
    }
    const handle = Array.isArray(handles) ? handles[0] : handles;
    if (!handle) return avProjOpenRefuse("no selection", null, warnings);
    let file = null;
    try { if (typeof handle.getFile === "function") file = await handle.getFile(); } catch (e) { file = null; }
    if (!file) return avProjOpenRefuse("cannot read file", null, warnings);
    fileBase = avProjBaseName(file.name);
    const text = await avProjFileText(file);
    if (typeof text !== "string") return avProjOpenRefuse("cannot read file", fileBase, warnings);
    const p = avProjParse(text);
    if (!p.ok) return avProjOpenRefuse(p.error || "parse failed", fileBase, warnings);
    project = p.project;
    pickedHandle = handle;
    pickedFile = file;
  }
  const name = project.name || fileBase || null;
  const receipt = avProjOpenFinish(project, name, warnings);
  /* open success upserts a recent with its handle and re-targets Save (R20 section 4) */
  if (receipt.ok && (pickedHandle || fileBase)) {
    const oname = avProjCleanName(pickedFile ? pickedFile.name : null) ||
                  avProjCleanName(pickedHandle ? pickedHandle.name : null) ||
                  project.name || name || "untitled";
    const osize = (pickedFile && typeof pickedFile.size === "number" && isFinite(pickedFile.size)) ? pickedFile.size : 0;
    if (pickedHandle) {
      avProj.current = { handle: pickedHandle, name: oname, at: project.at || null };
      await avProjPersistCurrent();
    }
    await avProjUpsertRecent({ name: oname, at: project.at, size: osize, handle: pickedHandle || null, via: "fsa" });
  }
  return receipt;
}

/* ---------- avProjImportSamples (§2.1) — FSA multi-open -> avSampleImportFiles(files) ---------- */

function avProjSamplesBase(error, via) {
  return { ok: false, error: error, added: [], errors: [], count: null, max: null, via: (via === undefined ? null : via) };
}

function avProjSamplesCancel(via) {
  return { ok: false, error: "cancelled", added: [], errors: [], count: null, max: null, via: via };
}

/* normalise the avSampleImportFiles result ({ok, added, errors, count, max}) — it never rejects,
   but every leg is guarded anyway; arrays come out capped and string-only */
async function avProjImportCall(importFn, files) {
  let r = null;
  try { r = await importFn(files); } catch (e) { r = { ok: false, added: [], errors: [avProjErrMsg(e)], count: null, max: null }; }
  if (!avProjObj(r)) r = { ok: false, added: [], errors: ["import refused"], count: null, max: null };
  return {
    ok: r.ok === true,
    added: avProjStringList(r.added),
    errors: avProjStringList(r.errors),
    count: (typeof r.count === "number" && isFinite(r.count)) ? r.count : null,
    max: (typeof r.max === "number" && isFinite(r.max)) ? r.max : null,
  };
}

function avProjSamplesReceipt(r, via) {
  const ok = r.ok === true;
  const receipt = {
    ok: ok,
    error: ok ? null : ((r.errors && r.errors.length) ? r.errors[0] : "import refused"),
    added: r.added,
    errors: r.errors,
    count: r.count,
    max: r.max,
    via: via,
  };
  avProj.lastError = ok ? null : receipt.error;
  return receipt;
}

/* the ONE hidden <input> fallback — appended once, reused on every later import */
function avProjImportInputPick(importFn) {
  return new Promise(function (res) {
    let settled = false;
    const done = function (r) { if (!settled) { settled = true; res(r); } };
    try {
      const doc = avProjDoc();
      if (!doc) return done(avProjSamplesBase("no DOM for the file input", "input"));
      let inp = avProj.inputEl;
      if (!inp) {
        inp = doc.createElement("input");
        try { inp.type = "file"; inp.multiple = true; inp.accept = "audio/*"; } catch (e) { /* attributes refused */ }
        try { inp.style.display = "none"; } catch (e) { /* ok */ }
        const host = doc.body || (doc.documentElement ? doc.documentElement : null);
        if (host && typeof host.appendChild === "function") { try { host.appendChild(inp); } catch (e) { /* ok */ } }
        avProj.inputEl = inp;
      }
      const cleanup = function () {
        try {
          if (typeof inp.removeEventListener === "function") {
            inp.removeEventListener("change", onChange);
            inp.removeEventListener("cancel", onCancel);
          }
        } catch (e) { /* ok */ }
      };
      const onChange = function () {
        cleanup();
        let files = null;
        try { files = inp.files; } catch (e) { files = null; }
        try { inp.value = ""; } catch (e) { /* ok */ }   /* re-importing the same file must fire again */
        if (files && typeof files.length === "number" && files.length > 0) {
          avProjImportCall(importFn, files).then(function (r) { done(avProjSamplesReceipt(r, "input")); });
        } else {
          done(avProjSamplesCancel("input"));
        }
      };
      const onCancel = function () { cleanup(); done(avProjSamplesCancel("input")); };
      if (typeof inp.addEventListener === "function") {
        try { inp.addEventListener("change", onChange); } catch (e) { return done(avProjSamplesBase("file input refused", "input")); }
        try { inp.addEventListener("cancel", onCancel); } catch (e) { /* the cancel event is a nicety */ }
      } else {
        return done(avProjSamplesBase("file input refused", "input"));
      }
      try { inp.value = ""; } catch (e) { /* ok */ }
      try { inp.click(); } catch (e) { cleanup(); return done(avProjSamplesBase("file input refused", "input")); }
    } catch (e) {
      done(avProjSamplesBase(avProjErrMsg(e), "input"));
    }
  });
}

function avProjImportSamples() {
  try {
    return Promise.resolve(avProjImportSamplesRun()).catch(function (e) {
      return avProjSamplesBase(avProjErrMsg(e), null);
    });
  } catch (e) {
    return Promise.resolve(avProjSamplesBase(avProjErrMsg(e), null));
  }
}

async function avProjImportSamplesRun() {
  const importFn = avProjImportFn();
  if (!importFn) return avProjSamplesBase("no sample module", null);
  const pick = avProjPicker("open");
  if (pick) {
    let handles = null, cancelled = false, failed = null;
    try {
      handles = await pick.fn.call(pick.fs, { multiple: true, types: avProjAudioTypes() });
    } catch (e) {
      if (avProjErrName(e) === "AbortError") cancelled = true;
      else failed = avProjErrName(e) || "error";
    }
    if (cancelled) return avProjSamplesCancel("fsa");
    if (!failed) {
      const files = [];
      const arr = Array.isArray(handles) ? handles : (handles ? [handles] : []);
      let skipped = 0;
      for (let i = 0; i < arr.length; i++) {
        try {
          const f = (arr[i] && typeof arr[i].getFile === "function") ? await arr[i].getFile() : arr[i];
          if (f) files.push(f); else skipped += 1;
        } catch (e) { skipped += 1; }
      }
      if (!files.length) return avProjSamplesBase(skipped ? "no readable files" : "no files", "fsa");
      const r = await avProjImportCall(importFn, files);
      if (skipped > 0) avProjPush(r.errors, "skipped " + skipped + " unreadable file(s)");
      return avProjSamplesReceipt(r, "fsa");
    }
    /* non-abort picker failure: the input fallback follows */
  }
  return avProjImportInputPick(importFn);
}

/* ---------- PLATFORM: avProjOpenText — the File Handling entry (a launched .anvl) ----------
   The read half of avProjOpenRun for text that arrives from outside (the PWA launchQueue consumer):
   parse -> apply through the injected session module (avSessionApply) -> record. Receipt shape
   matches avProjOpenRun's; never throws. */
function avProjOpenTextRun(name, text) {
  const warnings = [];
  const nm = avProjCleanName(name) || "launched.anvl";
  if (typeof text !== "string" || !text) return avProjOpenRefuse("the launched file was empty", nm, warnings);
  const p = avProjParse(text);
  if (!p.ok) return avProjOpenRefuse(p.error || "parse failed", nm, warnings);
  const project = p.project;
  const pname = project.name || nm;
  const applyFn = avProjApplyFn();
  if (!applyFn) return avProjOpenRefuse("no session module", pname, warnings);
  let ap = null;
  try { ap = applyFn(project.state); } catch (e) { ap = null; }
  if (!avProjObj(ap)) return avProjOpenRefuse("apply failed", pname, warnings);
  const applied = (typeof ap.applied === "number" && isFinite(ap.applied)) ? ap.applied : 0;
  const skipped = avProjStringList(ap.skipped);
  const ok = ap.ok === true;
  let errText = null;
  if (!ok && typeof ap.error === "string" && ap.error) errText = ap.error.slice(0, AV_PROJ_MSG_CAP);
  const receipt = { ok: ok, error: ok ? null : (errText || "apply refused"), name: pname, applied: applied, skipped: skipped, warnings: warnings };
  avProj.lastOpen = avProjClone(receipt) || receipt;
  avProj.lastError = receipt.error;
  avProjRecordOpen(pname, ok, applied, skipped);
  return receipt;
}

/* the public File Handling entry stays synchronous and receipt-identical; the wrapper adds the
   R20 fan-out emit so a launched .anvl refreshes the card's RECENT block too */
function avProjOpenText(name, text) {
  let receipt = null;
  try { receipt = avProjOpenTextRun(name, text); }
  catch (e) { receipt = avProjOpenRefuse(avProjErrMsg(e), null, []); }
  avProjEmitChanged("open");
  return receipt;
}

/* ---------- R20 section 4: the recents ops + Save As ---------- */

async function avProjRecentsRun() {
  await avProjEnsureLoad();
  const st = avProj;
  const ids = Object.keys(st.recents);
  const rows = [];
  for (let i = 0; i < ids.length; i++) {
    const rec = st.recents[ids[i]];
    if (!rec) continue;
    const handle = avProjHandleNorm(rec.handle);
    let note = rec.note || null;
    if (!handle && !note) note = "no stored handle in this browser - pick the project file to reopen";
    rows.push({
      id: rec.id, name: rec.name, at: rec.at, size: rec.size, via: rec.via,
      handle: !!handle, note: note,
    });
  }
  avProjRcSortRows(rows);
  return { ok: true, count: rows.length, items: rows };
}

function avProjRecents() {
  try { return Promise.resolve(avProjRecentsRun()).catch(function (e) { return { ok: false, count: 0, items: [], error: avProjErrMsg(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, count: 0, items: [], error: "error" }); }
}

async function avProjOpenRecentRun(id) {
  const warnings = [];
  await avProjEnsureLoad();
  const rec = avProjFindRec(id);
  if (!rec) return avProjOpenRefuse("no such recent project", null, warnings);
  const handle = avProjHandleNorm(rec.handle);
  if (!handle) return avProjOpenRefuse("no stored handle in this browser - pick the project file to reopen", rec.name, warnings);
  const perm = await avProjPermGo(handle, "read");
  if (perm === "picker") return avProjOpenRefuse("permission denied - pick the project file to reopen", rec.name, warnings);
  let file = null;
  try { if (typeof handle.getFile === "function") file = await handle.getFile(); } catch (e) { file = null; }
  if (!file) return avProjOpenRefuse("cannot read the stored file - pick the project file to reopen", rec.name, warnings);
  const text = await avProjFileText(file);
  if (typeof text !== "string") return avProjOpenRefuse("cannot read the stored file - pick the project file to reopen", rec.name, warnings);
  const p = avProjParse(text);
  if (!p.ok) return avProjOpenRefuse(p.error || "parse failed", rec.name, warnings);
  const project = p.project;
  const nm = project.name || avProjBaseName(rec.name) || rec.name;
  const receipt = avProjOpenFinish(project, nm, warnings);
  if (receipt.ok) {
    /* the reopened file becomes the current save target; the recent refreshes its size/at */
    if (!avProj.current || avProjHandleNorm(avProj.current.handle) !== handle) {
      avProj.current = { handle: handle, name: rec.name, at: project.at || rec.at || null };
      await avProjPersistCurrent();
    }
    const fsize = (file && typeof file.size === "number" && isFinite(file.size)) ? file.size : rec.size;
    await avProjUpsertRecent({ name: rec.name, at: project.at || rec.at, size: fsize, handle: handle });
  }
  return receipt;
}

function avProjOpenRecent(id) {
  let out = null;
  try { out = Promise.resolve(avProjOpenRecentRun(id)).catch(function (e) { return avProjOpenRefuse(avProjErrMsg(e), null, []); }); }
  catch (e) { out = Promise.resolve(avProjOpenRefuse(avProjErrMsg(e), null, [])); }
  /* R20 fan-out: a reopen refreshes the recent record (size/at) - tell the card */
  return out.then(function (r) { avProjEmitChanged("recent"); return r; });
}

async function avProjForgetRecentRun(id) {
  await avProjEnsureLoad();
  const rid = avProjRecIdNorm(id);
  const rec = avProjFindRec(rid);
  if (!rec) return { ok: false, error: "no such recent project", id: rid, name: null, removed: false };
  const persisted = await avProjDeleteRec(rid);
  const out = { ok: true, error: null, id: rec.id, name: rec.name, removed: true };
  if (!persisted) out.note = "removed for this session only";
  return out;
}

function avProjForgetRecent(id) {
  let out = null;
  try { out = Promise.resolve(avProjForgetRecentRun(id)).catch(function (e) { return { ok: false, error: avProjErrMsg(e), id: "", name: null, removed: false }; }); }
  catch (e) { out = Promise.resolve({ ok: false, error: "error", id: "", name: null, removed: false }); }
  /* R20 fan-out: a removal changes the recent list - tell the card */
  return out.then(function (r) { avProjEmitChanged("forget"); return r; });
}

/* Save As: always the picker (or the download fallback when no picker exists); on success the
   picked file becomes the new current save target */
function avProjSaveAs(opts) {
  try {
    const o = avProjObj(opts) ? opts : {};
    return avProjSave({ name: o.name, at: o.at, state: o.state, saveAs: true });
  } catch (e) {
    return Promise.resolve(avProjSaveRefuse(avProjErrMsg(e), null, 0, [], null));
  }
}

/* ---------- avProjInit / avProjSetFs / avProjState / avProjClasses (§2.1) ---------- */

function avProjInit() {
  try { avProj.inited = true; return true; } catch (e) { return false; }
}

function avProjSetFs(fs) {
  try {
    const st = avProj;
    if (fs === null || fs === undefined) { st.fs = null; st.fsInjected = false; return true; }
    if (typeof fs !== "object") return false;
    const hasOpen = typeof fs.showOpenFilePicker === "function";
    const hasSave = typeof fs.showSaveFilePicker === "function";
    if (!hasOpen && !hasSave) return false;
    st.fs = fs;
    st.fsInjected = true;
    return true;
  } catch (e) { return false; }
}

function avProjState() {
  try {
    const st = avProj;
    const rows = [];
    const ids = Object.keys(st.recents);
    for (let i = 0; i < ids.length; i++) {
      const rec = st.recents[ids[i]];
      if (!rec) continue;
      rows.push({
        id: rec.id, name: rec.name, at: rec.at, size: rec.size,
        via: rec.via, handle: !!avProjHandleNorm(rec.handle), note: rec.note || null,
      });
    }
    avProjRcSortRows(rows);
    const cur = avProjObj(st.current) ? st.current : null;
    return {
      version: AV_PROJ_VERSION,
      init: st.inited === true,
      fsKind: avProjFsKind(),
      lastSave: st.lastSave ? avProjClone(st.lastSave) : null,
      lastOpen: st.lastOpen ? avProjClone(st.lastOpen) : null,
      lastError: st.lastError,
      backend: st.backend,
      note: st.backendNote,
      recentsLoaded: st.recentsLoaded === true,
      recentCount: rows.length,
      recents: rows,
      current: cur ? { name: cur.name || null, at: cur.at || null, hasHandle: !!avProjHandleNorm(cur.handle) } : null,
    };
  } catch (e) {
    return {
      version: AV_PROJ_VERSION, init: false, fsKind: "none", lastSave: null, lastOpen: null,
      lastError: "state", backend: "mem", note: null, recentsLoaded: false, recentCount: 0,
      recents: [], current: null,
    };
  }
}

function avProjClasses() {
  return AV_PROJ_CLASSES.slice();   /* this module mounts nothing — the UI card owns markup */
}

/* ---------- debug handle (rigs + parent call these; names are the contract) ---------- */

if (typeof window !== "undefined" && window) {
  try {
    window.__avProj = {
      version: AV_PROJ_VERSION,
      init: avProjInit,
      setFs: avProjSetFs,
      build: avProjBuild,
      parse: avProjParse,
      openText: avProjOpenText,
      save: avProjSave,
      saveAs: avProjSaveAs,
      open: avProjOpen,
      samples: avProjImportSamples,
      recents: avProjRecents,
      openRecent: avProjOpenRecent,
      forget: avProjForgetRecent,
      state: avProjState,
    };
  } catch (e) { /* no window — node harness only */ }
}
