/* av_sources.js -- Anvil R18b linked source folders (child A; verify/_r18b_wave.md sections 1-3):
   the linked source-folder CORE -- persisted FSA directory handles, the directory-picker seam, the
   bounded walk, the NEW/CHANGED/SAME/GONE diff against the library, import-new, unlink and
   reconnect. This module owns NO DOM (the LINKED SOURCES card section lives in av_sources_ui.js).

   THE PIECES:
     seam      avSrcFs / avSrcFsKind / avSrcDirPicker / avSrcSetFs -- the av_proj.js pattern:
               resolved per call; injected when fsInjected, else window; the picker is called
               fn.call(fs, opts) so receivers stay intact; never merged.
     store     IndexedDB "av-sources-store" v1, store "sources", keyPath "id",
               create-if-missing only (NO version bump). Record {id, v:1, name, handle,
               linkedAt, lastScanAt, mode:"linked"}. No LS mirror (handles are not JSON) -- the
               folded backend is reported honestly ("idb" | "mem"); a handle that cannot be
               structured-cloned is persisted as null (the row then lists as reconnect) and a
               record that never reaches the DB is session-only. Absence of a handle = the row
               lists with status "reconnect" and scans refuse honestly (no fake success).
     walk      the MINIMAL handle surface (D3): dir {kind:"directory", name, values() -> async
               iterator of [name, childHandle], queryPermission?(opts), requestPermission?(opts)};
               child dirs recurse; file handles {kind:"file", name, getFile() -> Promise<File>}.
               Depth cap 4, file cap 500, extension filter AV_SOURCES_EXTS; never throws
               outward; capped:true when a cap clipped the walk.
     diff      D5: walked file vs the library (the R18a source field): NEW (no library item
               with the same leaf name AND size), SAME (name + size), CHANGED (same name,
               different size); GONE = library items whose source.path starts with
               "<folder>/" and whose leaf is no longer on disk. All lists sorted by name.
     ops       avSourcesLink / avSourcesList / avSourcesScan / avSourcesImportNew /
               avSourcesUnlink / avSourcesReconnect / avSourcesState / avSourcesSnap.

   PUBLIC SURFACE (classic-script globals, ONE family avSources* / avSrc* / AV_SRC*):
     avSourcesVersion  the version pin "r18b.0"
     AV_SOURCES_EXTS   the walk extension filter (frozen)
     avSourcesLink() -> Promise<{ok, id?, name?, scan?, error?, perm, backend, note, scanError}>
                        picker cancel = {ok:false, error:"cancelled"} -- calm, no error state
     avSourcesList() -> Promise<{ok, count, items:[{id, name, linkedAt, lastScanAt, mode, perm,
                        new, changed, gone, note}]}>   (per-row counts from the LAST scan memo)
     avSourcesScan(id) -> Promise<{ok, id, scan:{new:[{name, relPath, size, mtime}],
                        changed:[...], gone:[{id, name, path}], same:N, capped:bool}, perm, error?}>
     avSourcesImportNew(id) -> Promise<{ok, id, count, receipt?, scan?, error?}>
                        re-wraps each NEW file as File([inner], folder + "/" + relPath) and feeds
                        them through the ONE funnel avImportFiles (guarded); then re-scans
     avSourcesUnlink(id) -> Promise<{ok, id, removed}>
     avSourcesReconnect(id) -> Promise<{ok, id, perm, error?}>   (requestPermission, D8)
     avSourcesState() / avSourcesSnap() -> {ok, fsKind, backend, count, items:[...], note}
     avSourcesClasses() -> []          mounts nothing
     window.__avSources = {version, status, list, link, scan, importNew, unlink, reconnect,
                           setFs, fsKind}

   LAWS (verify/_r18b_wave.md sections 1-3, 9): 'use strict'; classic script; DOM-free at load
   (every browser reach typeof-guarded inside functions); NEVER throws outward (honest refusals,
   counted skips); no console noise; no randomness; bound arrays (depth 4 / files 500); ASCII
   source. avImportFiles is a global in av_import.js -- typeof-guarded everywhere. ONE writer
   (child A). */

"use strict";

/* ---------- pins (sections 2-3) ---------- */

const avSourcesVersion = "r18b.0";
const AV_SOURCES_EXTS = Object.freeze(["wav", "mp3", "aiff", "mid", "rex2", "adg", "als", "exs", "nki", "nbkt", "sxt", "serum", "zip"]);
const AV_SRC_DB = "av-sources-store";        /* pinned IDB name (D2) */
const AV_SRC_DB_VER = 1;                     /* create-if-missing only; NO version bump */
const AV_SRC_OS = "sources";                 /* object store, keyPath "id" */
const AV_SRC_MODE = "linked";
const AV_SRC_ID_RE = /^s[a-z0-9-]{0,63}$/;   /* "s" + time36 + "-" + slug(40) (+ "-<seq>") */
const AV_SRC_NAME_MAX = 64;
const AV_SRC_MSG_MAX = 120;
const AV_SRC_DEPTH_MAX = 4;                  /* walk depth cap (D3) */
const AV_SRC_FILE_MAX = 500;                 /* walk file cap (D3) */
const AV_SRC_OPEN_CAP_MS = 1800;             /* hung IDB open give-up (mirrors av_lib) */
const AV_SRC_CLASSES = Object.freeze([]);    /* this module mounts nothing */

/* ---------- module state (no DOM nodes anywhere) ---------- */

const avSrc = {
  loaded: false,
  loadP: null,
  fs: null,               /* the injected seam (null = window default) */
  fsInjected: false,
  backend: "mem",         /* "idb" | "mem" -- kept honest, promoted never demoted */
  backendNote: null,
  db: null,
  dbGaveUp: false,
  records: {},            /* id -> rec {id, v, name, handle, linkedAt, lastScanAt, mode, perm, sessionOnly, note} */
  memos: {},              /* id -> {new:[rows], changed:[rows], gone:[rows], same, capped, at} (rows keep handles) */
  seq: 0,                 /* id-collision counter */
};

/* ---------- guarded environment reaches (plain node has none of these) ---------- */

function avSrcWin() {
  try {
    const w = (typeof window !== "undefined") ? window : null;
    if (w && typeof w === "object") return w;
  } catch (e) { /* no window */ }
  return null;
}

function avSrcNow() {
  try { return Date.now(); } catch (e) { return 0; }
}

function avSrcTimer(fn, ms) {
  try { if (typeof setTimeout === "function") return setTimeout(fn, ms); } catch (e) { /* no timers */ }
  return null;
}

function avSrcClear(t) {
  try { if (t != null && typeof clearTimeout === "function") clearTimeout(t); } catch (e) { /* no timers */ }
}

function avSrcIdb() {
  try { if (typeof indexedDB !== "undefined" && indexedDB) return indexedDB; } catch (e) { /* none */ }
  try { const w = avSrcWin(); if (w && w.indexedDB) return w.indexedDB; } catch (e) { /* none */ }
  return null;
}

/* ---------- tiny value laws (garbage in, sane value out -- never throw) ---------- */

function avSrcErrName(e) {
  try { return (e && e.name) ? String(e.name).slice(0, 40) : ""; } catch (e2) { return ""; }
}

function avSrcErrMsg(e) {
  try { const s = (e && e.message) ? String(e.message) : String(e); return s.slice(0, AV_SRC_MSG_MAX); } catch (e2) { return "error"; }
}

function avSrcStr(v, dflt, cap) {
  try {
    if (typeof v !== "string") return dflt;
    const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, cap || 80);
    return s || dflt;
  } catch (e) { return dflt; }
}

function avSrcNum(v, dflt, lo, hi) {
  try {
    const n = Number(v);
    if (typeof n === "number" && isFinite(n)) {
      if (n < lo) return lo;
      if (n > hi) return hi;
      return n;
    }
  } catch (e) { /* dflt */ }
  return dflt;
}

function avSrcIdStr(id) {
  return (typeof id === "string") ? id : "";
}

/* ---------- ids (house style: prefix + time36 + "-" + slug) ---------- */

function avSrcSlug(name) {
  try {
    const s = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return s || "source";
  } catch (e) { return "source"; }
}

function avSrcMakeId(name) {
  const st = avSrc;
  const base = "s" + Date.now().toString(36) + "-" + avSrcSlug(name);
  let id = base;
  try {
    while (st.records[id]) {
      st.seq += 1;
      id = base + "-" + st.seq;
      if (st.seq > 100000) break;
    }
  } catch (e) { /* base id stands */ }
  return id;
}

/* ---------- the FSA seam (the ONLY picker reach; resolved per call -- D1) ---------- */

function avSrcFs() {
  try { if (avSrc.fsInjected && avSrc.fs && typeof avSrc.fs === "object") return avSrc.fs; } catch (e) { /* read refused */ }
  return avSrcWin();
}

function avSrcFsKind() {
  try {
    if (avSrc.fsInjected && avSrc.fs) return "injected";
    const w = avSrcWin();
    if (w && typeof w.showDirectoryPicker === "function") return "window";
  } catch (e) { /* none */ }
  return "none";
}

/* resolved dir picker: { fs, fn } (called as fn.call(fs, opts) -- receivers stay intact) or null */
function avSrcDirPicker() {
  const fs = avSrcFs();
  if (!fs) return null;
  try {
    const fn = fs.showDirectoryPicker;
    if (typeof fn === "function") return { fs: fs, fn: fn };
  } catch (e) { /* property read refused */ }
  return null;
}

function avSrcSetFs(fs) {
  try {
    const st = avSrc;
    if (fs === null || fs === undefined) { st.fs = null; st.fsInjected = false; return true; }
    if (typeof fs !== "object") return false;
    if (typeof fs.showDirectoryPicker !== "function") return false;
    st.fs = fs;
    st.fsInjected = true;
    return true;
  } catch (e) { return false; }
}

/* ---------- sibling-module resolvers (binding, then window property) ---------- */

function avSrcImportFn() {
  try { if (typeof avImportFiles === "function") return avImportFiles; } catch (e) { /* not injected */ }
  try { const w = avSrcWin(); if (w && typeof w.avImportFiles === "function") return w.avImportFiles; } catch (e) { /* no window */ }
  return null;
}

function avSrcLibListFn() {
  try { if (typeof avLibList === "function") return avLibList; } catch (e) { /* not injected */ }
  try { const w = avSrcWin(); if (w && typeof w.avLibList === "function") return w.avLibList; } catch (e) { /* no window */ }
  return null;
}

/* ---------- permission probes (D8; absent fn = "unknown" = the LS-tier case) ---------- */

function avSrcPermNorm(p) {
  try {
    if (p === "granted" || p === "prompt" || p === "denied") return p;
  } catch (e) { /* none */ }
  return "unknown";
}

async function avSrcQueryPerm(handle) {
  try {
    if (!handle || typeof handle !== "object") return "unknown";
    const fn = handle.queryPermission;
    if (typeof fn === "function") return avSrcPermNorm(await fn.call(handle, { mode: "read" }));
    if (typeof fn === "string") return avSrcPermNorm(fn);   /* a stubbed state value */
  } catch (e) { /* unknown */ }
  return "unknown";
}

async function avSrcRequestPerm(handle) {
  try {
    if (!handle || typeof handle !== "object") return "unknown";
    const fn = handle.requestPermission;
    if (typeof fn === "function") return avSrcPermNorm(await fn.call(handle, { mode: "read" }));
    if (typeof fn === "string") return avSrcPermNorm(fn);   /* a stubbed state value */
  } catch (e) { /* unknown */ }
  return "unknown";
}

/* ---------- record normalisation ---------- */

function avSrcHandleNorm(h) {
  try {
    if (h && typeof h === "object" && !Array.isArray(h)) return h;
  } catch (e) { /* none */ }
  return null;
}

function avSrcRecNorm(raw) {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const id = (typeof raw.id === "string" && AV_SRC_ID_RE.test(raw.id)) ? raw.id : "";
    if (!id) return null;
    return {
      id: id, v: 1,
      name: avSrcStr(raw.name, "source", AV_SRC_NAME_MAX),
      handle: avSrcHandleNorm(raw.handle),
      linkedAt: avSrcNum(raw.linkedAt, 0, 0, 9e15),
      lastScanAt: avSrcNum(raw.lastScanAt, 0, 0, 9e15),
      mode: AV_SRC_MODE,
      perm: "unknown",
      sessionOnly: false,
      note: null,
    };
  } catch (e) { return null; }
}

function avSrcRecPayload(rec, handle) {
  return {
    id: rec.id, v: 1, name: rec.name, handle: handle,
    linkedAt: rec.linkedAt, lastScanAt: rec.lastScanAt, mode: AV_SRC_MODE,
  };
}

/* ---------- IndexedDB plumbing (promise-wrapped, never throws -- av_lib.js pattern) ---------- */

function avSrcDbOpen() {
  return new Promise(function (res) {
    try {
      const st = avSrc;
      if (st.db) return res(st.db);
      if (st.dbGaveUp) return res(null);
      const idb = avSrcIdb();
      if (!idb) return res(null);
      let settled = false;
      const give = function (v) { if (!settled) { settled = true; res(v); } };
      /* a hung open (blocked upgrade in another tab) must not wedge the module: give up after
         AV_SRC_OPEN_CAP_MS; a late success closes its handle and stays honest */
      const timer = avSrcTimer(function () { st.dbGaveUp = true; give(null); }, AV_SRC_OPEN_CAP_MS);
      const rq = idb.open(AV_SRC_DB, AV_SRC_DB_VER);
      rq.onupgradeneeded = function () {
        try { const db = rq.result; if (!db.objectStoreNames || !db.objectStoreNames.contains(AV_SRC_OS)) db.createObjectStore(AV_SRC_OS, { keyPath: "id" }); }
        catch (e) { /* upgrade raced */ }
      };
      rq.onsuccess = function () {
        avSrcClear(timer);
        if (st.dbGaveUp) { try { rq.result.close(); } catch (e) { /* ignore */ } return give(null); }
        const db = rq.result;
        st.db = db;
        try { db.onclose = function () { if (avSrc.db === db) avSrc.db = null; }; } catch (e) { /* fine */ }
        give(db);
      };
      rq.onerror = function () { avSrcClear(timer); give(null); };
      rq.onblocked = function () { avSrcClear(timer); give(null); };
    } catch (e) { res(null); }
  });
}

function avSrcDbAll(db) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_SRC_OS, "readonly");
      const rq = tx.objectStore(AV_SRC_OS).getAll();
      rq.onsuccess = function () { res(Array.isArray(rq.result) ? rq.result : []); };
      rq.onerror = function () { res(null); };
      tx.onerror = function () { res(null); };
    } catch (e) { res(null); }
  });
}

/* put one record; resolves false when the value cannot be structured-cloned (stub handles) */
function avSrcDbPut(db, rec) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_SRC_OS, "readwrite");
      let settled = false;
      const done = function (v) { if (!settled) { settled = true; res(v); } };
      try { tx.objectStore(AV_SRC_OS).put(rec); }
      catch (ePut) { done(false); try { tx.abort(); } catch (e2) { /* ignore */ } return; }
      tx.oncomplete = function () { done(true); };
      tx.onerror = function () { done(false); };
      tx.onabort = function () { done(false); };
    } catch (e) { res(false); }
  });
}

function avSrcDbDel(db, id) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_SRC_OS, "readwrite");
      tx.objectStore(AV_SRC_OS).delete(id);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { res(false); };
      tx.onabort = function () { res(false); };
    } catch (e) { res(false); }
  });
}

/* persist one record: full first (handle incl.), then handle:null so the record at least lists
   as reconnect next session; "mem" = never reached the DB (session-only, reported honestly) */
async function avSrcPersistRec(rec) {
  try {
    if (!rec || !rec.id) return { tier: "mem", handleSaved: false };
    const db = await avSrcDbOpen();
    if (!db) {
      if (!avSrc.backendNote) avSrc.backendNote = "IndexedDB unavailable - records are session-only";
      return { tier: "mem", handleSaved: false };
    }
    avSrc.backend = "idb";               /* promoted never demoted */
    const handle = avSrcHandleNorm(rec.handle);
    if (handle) {
      const okFull = await avSrcDbPut(db, avSrcRecPayload(rec, handle));
      if (okFull) return { tier: "idb", handleSaved: true };
    }
    const okBare = await avSrcDbPut(db, avSrcRecPayload(rec, null));
    if (okBare) return { tier: "idb", handleSaved: false };
    return { tier: "mem", handleSaved: false };
  } catch (e) { return { tier: "mem", handleSaved: false }; }
}

/* ---------- lazy load (hydrate once; every op ensures it) ---------- */

async function avSrcLoadRun() {
  const st = avSrc;
  const db = await avSrcDbOpen();
  if (db) {
    st.backend = "idb";
    const raws = await avSrcDbAll(db);
    if (raws && Array.isArray(raws)) {
      for (let i = 0; i < raws.length; i++) {
        const rec = avSrcRecNorm(raws[i]);
        if (rec && !st.records[rec.id]) st.records[rec.id] = rec;
      }
    }
  }
  st.loaded = true;
  return true;
}

function avSrcEnsureLoad() {
  const st = avSrc;
  if (st.loaded) return Promise.resolve(true);
  if (st.loadP) return st.loadP;
  st.loadP = Promise.resolve(avSrcLoadRun()).catch(function () { st.loadP = null; return false; });
  return st.loadP;
}

function avSrcFind(id) {
  try {
    if (typeof id !== "string" || !id) return null;
    const rec = avSrc.records[id];
    return (rec && typeof rec === "object") ? rec : null;
  } catch (e) { return null; }
}

/* ---------- the walk (D3: depth 4, file cap 500, the extension filter) ---------- */

function avSrcExtOf(name) {
  try {
    if (typeof name !== "string") return "";
    const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
    const leaf = (slash >= 0) ? name.slice(slash + 1) : name;
    const dot = leaf.lastIndexOf(".");
    if (dot <= 0 || dot === leaf.length - 1) return "";
    return leaf.slice(dot + 1).toLowerCase();
  } catch (e) { return ""; }
}

function avSrcExtWanted(name) {
  try {
    const ext = avSrcExtOf(name);
    if (!ext) return false;
    for (let i = 0; i < AV_SOURCES_EXTS.length; i++) if (AV_SOURCES_EXTS[i] === ext) return true;
  } catch (e) { /* none */ }
  return false;
}

function avSrcValuesIt(handle) {
  try {
    if (!handle || typeof handle !== "object") return null;
    if (typeof handle.values !== "function") return null;
    const it = handle.values();
    if (!it || typeof it.next !== "function") return null;
    return it;
  } catch (e) { return null; }
}

async function avSrcWalkDir(handle, depth, prefix, ctx) {
  const it = avSrcValuesIt(handle);
  if (!it) {
    if (depth === 0) ctx.badRoot = true;
    return;
  }
  let seen = 0;
  for (;;) {
    if (ctx.abort) return;
    let step = null;
    try { step = await it.next(); }
    catch (e) {
      if (depth === 0 && seen === 0) ctx.badRoot = true;   /* nothing readable at the root */
      break;                                               /* a mid-iteration failure ends THIS dir */
    }
    if (!step || step.done === true) break;
    const ent = step.value;
    let nm = "";
    let child = null;
    try {
      if (Array.isArray(ent)) { nm = ent[0]; child = ent[1]; }
      else if (ent && typeof ent === "object") {
        nm = (typeof ent.name === "string") ? ent.name : "";
        child = (ent.handle && typeof ent.handle === "object") ? ent.handle : ent[1];
        if (!child && ent.value && typeof ent.value === "object") child = ent.value;
      }
    } catch (e) { continue; }
    if (typeof nm !== "string") nm = "";
    if (!nm && child && typeof child.name === "string") nm = child.name;
    if (!nm || !child || typeof child !== "object") continue;
    seen += 1;
    const kind = (typeof child.kind === "string") ? child.kind : "";
    const isDir = (kind === "directory") || (!kind && typeof child.values === "function");
    const isFile = (kind === "file") || (!kind && typeof child.getFile === "function");
    if (isDir) {
      if (depth + 1 > AV_SRC_DEPTH_MAX) { ctx.capped = true; continue; }
      await avSrcWalkDir(child, depth + 1, prefix ? (prefix + "/" + nm) : nm, ctx);
      continue;
    }
    if (!isFile) continue;
    if (!avSrcExtWanted(nm)) continue;
    if (ctx.files.length >= AV_SRC_FILE_MAX) { ctx.capped = true; ctx.abort = true; return; }
    let file = null;
    try { file = await child.getFile(); } catch (e) { file = null; }
    if (!file) continue;                    /* unreadable file: skipped honestly, not listed */
    let size = 0;
    let mtime = 0;
    try { const s = file.size; if (typeof s === "number" && isFinite(s) && s >= 0) size = Math.floor(s); } catch (e) { /* 0 */ }
    try { const m = file.lastModified; if (typeof m === "number" && isFinite(m) && m >= 0) mtime = Math.floor(m); } catch (e) { /* 0 */ }
    const leaf = (typeof child.name === "string" && child.name) ? child.name : nm;
    ctx.files.push({ name: leaf, relPath: prefix ? (prefix + "/" + nm) : nm, size: size, mtime: mtime, handle: child });
  }
}

async function avSrcWalk(handle) {
  const ctx = { files: [], capped: false, abort: false, badRoot: false };
  try { await avSrcWalkDir(handle, 0, "", ctx); }
  catch (e) { /* never outward */ }
  if (ctx.badRoot) return { ok: false, files: ctx.files, capped: ctx.capped, error: "folder handle unreadable - reconnect" };
  return { ok: true, files: ctx.files, capped: ctx.capped };
}

/* ---------- the diff vs the library (D5) ---------- */

function avSrcSortRows(rows, k1, k2) {
  try {
    rows.sort(function (a, b) {
      const a1 = (typeof a[k1] === "string") ? a[k1] : "";
      const b1 = (typeof b[k1] === "string") ? b[k1] : "";
      if (a1 < b1) return -1;
      if (a1 > b1) return 1;
      const a2 = (typeof a[k2] === "string") ? a[k2] : "";
      const b2 = (typeof b[k2] === "string") ? b[k2] : "";
      if (a2 < b2) return -1;
      if (a2 > b2) return 1;
      return 0;
    });
  } catch (e) { /* the previous order stands */ }
}

function avSrcDiff(files, libItems, folderName, capped) {
  const scan = { new: [], changed: [], gone: [], same: 0, capped: capped === true };
  try {
    /* library leaf (case-insensitive) -> sizes */
    const libByLeaf = Object.create(null);
    for (let i = 0; i < libItems.length; i++) {
      const it = libItems[i];
      if (!it || typeof it !== "object") continue;
      const nm = (typeof it.name === "string" && it.name) ? it.name : "";
      if (!nm) continue;
      const key = nm.toLowerCase();
      const arr = libByLeaf[key] || (libByLeaf[key] = []);
      const sz = it.size;
      arr.push((typeof sz === "number" && isFinite(sz)) ? sz : -1);
    }
    const onDisk = Object.create(null);
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const key = f.name.toLowerCase();
      onDisk[key] = true;
      const sizes = libByLeaf[key];
      let cls = "new";
      if (sizes && sizes.length) {
        cls = "changed";
        for (let j = 0; j < sizes.length; j++) { if (sizes[j] === f.size) { cls = "same"; break; } }
      }
      if (cls === "same") scan.same += 1;
      else if (cls === "changed") scan.changed.push(f);
      else scan.new.push(f);
    }
    /* GONE = this folder's library items (source.path prefix "<folder>/") whose leaf is not on disk */
    const prefix = folderName + "/";
    for (let i = 0; i < libItems.length; i++) {
      const it = libItems[i];
      if (!it || typeof it !== "object") continue;
      const src = it.source;
      const path = (src && typeof src.path === "string") ? src.path : "";
      if (!path || path.indexOf(prefix) !== 0) continue;
      let nm = (typeof it.name === "string" && it.name) ? it.name : "";
      if (!nm) { const parts = path.split("/"); nm = parts[parts.length - 1] || ""; }
      if (nm && onDisk[nm.toLowerCase()]) continue;
      scan.gone.push({ id: (typeof it.id === "string") ? it.id : "", name: nm, path: path });
    }
    avSrcSortRows(scan.new, "name", "relPath");
    avSrcSortRows(scan.changed, "name", "relPath");
    avSrcSortRows(scan.gone, "name", "path");
  } catch (e) { /* the partial diff stands */ }
  return scan;
}

/* the JSON-safe projection of a scan (handles stay internal) */
function avSrcScanPub(scan) {
  const out = { new: [], changed: [], gone: [], same: 0, capped: false };
  try {
    if (!scan || typeof scan !== "object") return out;
    out.same = (typeof scan.same === "number") ? scan.same : 0;
    out.capped = scan.capped === true;
    const arr = scan.new;
    if (Array.isArray(arr)) {
      for (let i = 0; i < arr.length; i++) {
        const r = arr[i];
        out.new.push({ name: r.name, relPath: r.relPath, size: r.size, mtime: r.mtime });
      }
    }
    const arrC = scan.changed;
    if (Array.isArray(arrC)) {
      for (let i = 0; i < arrC.length; i++) {
        const r = arrC[i];
        out.changed.push({ name: r.name, relPath: r.relPath, size: r.size, mtime: r.mtime });
      }
    }
    const arrG = scan.gone;
    if (Array.isArray(arrG)) {
      for (let i = 0; i < arrG.length; i++) {
        const r = arrG[i];
        out.gone.push({ id: r.id, name: r.name, path: r.path });
      }
    }
  } catch (e) { /* out stands */ }
  return out;
}

/* ---------- the scan core (memo + lastScanAt update; calm refusals) ---------- */

async function avSrcScanRec(rec) {
  try {
    if (!rec) return { ok: false, error: "no such source", perm: "unknown" };
    const handle = avSrcHandleNorm(rec.handle);
    if (!handle) return { ok: false, error: "handle missing - reconnect required", perm: "unknown" };
    const perm = await avSrcQueryPerm(handle);
    rec.perm = perm;
    if (perm === "prompt" || perm === "denied") {
      return { ok: false, error: "permission " + perm + " - reconnect required", perm: perm };
    }
    const walked = await avSrcWalk(handle);
    if (!walked || walked.ok !== true) {
      return { ok: false, error: (walked && walked.error) ? walked.error : "walk failed", perm: perm };
    }
    const libFn = avSrcLibListFn();
    if (!libFn) return { ok: false, error: "library module unavailable - cannot diff", perm: perm };
    let lib = null;
    try { lib = await libFn(); } catch (e) { lib = null; }
    if (!lib || lib.ok !== true || !Array.isArray(lib.items)) {
      return { ok: false, error: "library list failed", perm: perm };
    }
    const scan = avSrcDiff(walked.files, lib.items, rec.name, walked.capped);
    avSrc.memos[rec.id] = { new: scan.new, changed: scan.changed, gone: scan.gone, same: scan.same, capped: scan.capped, at: avSrcNow() };
    rec.lastScanAt = avSrcNow();
    await avSrcPersistRec(rec);
    return { ok: true, perm: perm, scan: scan };
  } catch (e) {
    return { ok: false, error: avSrcErrMsg(e), perm: "unknown" };
  }
}

/* ---------- public ops (guarded, never throw outward) ---------- */

async function avSourcesLinkRun() {
  await avSrcEnsureLoad();
  const pick = avSrcDirPicker();
  if (!pick) return { ok: false, error: "linking needs the File System Access API" };
  let handle = null;
  try {
    handle = await pick.fn.call(pick.fs, { mode: "read" });
  } catch (e) {
    if (avSrcErrName(e) === "AbortError") return { ok: false, error: "cancelled" };
    return { ok: false, error: avSrcErrMsg(e) };
  }
  if (!handle || typeof handle !== "object") return { ok: false, error: "picker returned no directory" };
  const name = avSrcStr(handle.name, "source", AV_SRC_NAME_MAX);
  const id = avSrcMakeId(name);
  const rec = {
    id: id, v: 1, name: name, handle: handle,
    linkedAt: avSrcNow(), lastScanAt: 0, mode: AV_SRC_MODE,
    perm: "unknown", sessionOnly: false, note: null,
  };
  avSrc.records[id] = rec;
  const persisted = await avSrcPersistRec(rec);
  let note = null;
  if (persisted.tier !== "idb") {
    note = "record is session-only (IndexedDB unavailable)";
    rec.sessionOnly = true;
  } else if (!persisted.handleSaved) {
    note = "handle not persistable - reconnect after reload";
  }
  rec.note = note;
  const sr = await avSrcScanRec(rec);       /* first scan (pin 2) */
  const out = {
    ok: true, id: id, name: name, scan: null,
    perm: rec.perm, backend: avSrc.backend, note: note, scanError: null,
  };
  if (sr && sr.ok === true) out.scan = avSrcScanPub(sr.scan);
  else {
    out.scanError = (sr && sr.error) ? sr.error : "scan failed";
    out.perm = (sr && sr.perm) ? sr.perm : rec.perm;
  }
  return out;
}

function avSourcesLink() {
  try { return Promise.resolve(avSourcesLinkRun()).catch(function (e) { return { ok: false, error: avSrcErrMsg(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, error: "error" }); }
}

async function avSourcesListRun() {
  await avSrcEnsureLoad();
  const st = avSrc;
  const ids = Object.keys(st.records);
  const rows = [];
  for (let i = 0; i < ids.length; i++) {
    const rec = st.records[ids[i]];
    if (!rec) continue;
    const handle = avSrcHandleNorm(rec.handle);
    let perm = "unknown";
    if (handle) perm = await avSrcQueryPerm(handle);
    rec.perm = perm;
    const memo = st.memos[rec.id];
    let note = rec.note || null;
    if (!handle && !note) note = "handle missing - reconnect";
    rows.push({
      id: rec.id, name: rec.name, linkedAt: rec.linkedAt, lastScanAt: rec.lastScanAt,
      mode: rec.mode, perm: perm,
      new: (memo && Array.isArray(memo.new)) ? memo.new.length : 0,
      changed: (memo && Array.isArray(memo.changed)) ? memo.changed.length : 0,
      gone: (memo && Array.isArray(memo.gone)) ? memo.gone.length : 0,
      note: note,
    });
  }
  rows.sort(function (a, b) { return (b.linkedAt - a.linkedAt) || (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)); });
  return { ok: true, count: rows.length, items: rows };
}

function avSourcesList() {
  try { return Promise.resolve(avSourcesListRun()).catch(function (e) { return { ok: false, count: 0, items: [], error: avSrcErrMsg(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, count: 0, items: [], error: "error" }); }
}

async function avSourcesScanRun(id) {
  await avSrcEnsureLoad();
  const rec = avSrcFind(id);
  if (!rec) return { ok: false, id: avSrcIdStr(id), perm: "unknown", error: "no such source" };
  const r = await avSrcScanRec(rec);
  if (r && r.ok === true) return { ok: true, id: rec.id, name: rec.name, scan: avSrcScanPub(r.scan), perm: r.perm };
  return { ok: false, id: rec.id, name: rec.name, perm: (r && r.perm) ? r.perm : "unknown", error: (r && r.error) ? r.error : "scan failed" };
}

function avSourcesScan(id) {
  try { return Promise.resolve(avSourcesScanRun(id)).catch(function (e) { return { ok: false, id: avSrcIdStr(id), perm: "unknown", error: avSrcErrMsg(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, id: avSrcIdStr(id), perm: "unknown", error: "error" }); }
}

async function avSourcesImportNewRun(id) {
  await avSrcEnsureLoad();
  const rec = avSrcFind(id);
  if (!rec) return { ok: false, id: avSrcIdStr(id), count: 0, error: "no such source" };
  const fn = avSrcImportFn();
  if (!fn) return { ok: false, id: rec.id, count: 0, error: "import module unavailable" };
  const sr = await avSrcScanRec(rec);       /* a fresh scan decides what is NEW right now */
  if (!sr || sr.ok !== true) return { ok: false, id: rec.id, count: 0, error: (sr && sr.error) ? sr.error : "scan failed" };
  const news = (sr.scan && Array.isArray(sr.scan.new)) ? sr.scan.new : [];
  let wrapped = [];
  if (news.length) {
    if (typeof File !== "function") return { ok: false, id: rec.id, count: 0, error: "File constructor unavailable" };
    for (let i = 0; i < news.length; i++) {
      const row = news[i];
      try {
        if (!row || !row.handle || typeof row.handle.getFile !== "function") continue;
        const inner = await row.handle.getFile();
        if (!inner) continue;
        /* D6: the re-wrapped name carries the folder so source.path self-describes the folder
           ("MySamples/sub/kick.wav"); av_import takes the leaf for name/kit logic */
        wrapped.push(new File([inner], rec.name + "/" + row.relPath));
      } catch (e) { /* skip this file honestly */ }
    }
  }
  let receipt = null;
  if (wrapped.length) {
    try { receipt = await fn(wrapped); } catch (e) { receipt = null; }
  }
  /* refresh the memo (a fresh scan after the import) */
  let fresh = null;
  try {
    const fr = await avSrcScanRec(rec);
    if (fr && fr.ok === true) fresh = avSrcScanPub(fr.scan);
  } catch (e2) { fresh = null; }
  return { ok: true, id: rec.id, name: rec.name, count: wrapped.length, receipt: receipt, scan: fresh };
}

function avSourcesImportNew(id) {
  try { return Promise.resolve(avSourcesImportNewRun(id)).catch(function (e) { return { ok: false, id: avSrcIdStr(id), count: 0, error: avSrcErrMsg(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, id: avSrcIdStr(id), count: 0, error: "error" }); }
}

async function avSourcesUnlinkRun(id) {
  await avSrcEnsureLoad();
  const rec = avSrcFind(id);
  if (!rec) return { ok: true, id: avSrcIdStr(id), removed: false };
  delete avSrc.records[rec.id];
  delete avSrc.memos[rec.id];
  try {
    const db = await avSrcDbOpen();
    if (db) await avSrcDbDel(db, rec.id);
  } catch (e) { /* the in-memory removal stands */ }
  return { ok: true, id: rec.id, removed: true };
}

function avSourcesUnlink(id) {
  try { return Promise.resolve(avSourcesUnlinkRun(id)).catch(function (e) { return { ok: false, id: avSrcIdStr(id), removed: false, error: avSrcErrMsg(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, id: avSrcIdStr(id), removed: false, error: "error" }); }
}

async function avSourcesReconnectRun(id) {
  await avSrcEnsureLoad();
  const rec = avSrcFind(id);
  if (!rec) return { ok: false, id: avSrcIdStr(id), perm: "unknown", error: "no such source" };
  const handle = avSrcHandleNorm(rec.handle);
  if (!handle) return { ok: false, id: rec.id, perm: "unknown", error: "handle missing - relink the folder" };
  const perm = await avSrcRequestPerm(handle);
  rec.perm = perm;
  if (perm === "granted") return { ok: true, id: rec.id, perm: perm };
  return { ok: false, id: rec.id, perm: perm, error: "permission not granted" };
}

function avSourcesReconnect(id) {
  try { return Promise.resolve(avSourcesReconnectRun(id)).catch(function (e) { return { ok: false, id: avSrcIdStr(id), perm: "unknown", error: avSrcErrMsg(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, id: avSrcIdStr(id), perm: "unknown", error: "error" }); }
}

/* ---------- state / snap / classes (synchronous reads of the live view) ---------- */

function avSrcStateRows() {
  const st = avSrc;
  const ids = Object.keys(st.records);
  const rows = [];
  for (let i = 0; i < ids.length; i++) {
    const rec = st.records[ids[i]];
    if (!rec) continue;
    const handle = avSrcHandleNorm(rec.handle);
    const memo = st.memos[rec.id];
    let note = rec.note || null;
    if (!handle && !note) note = "handle missing - reconnect";
    rows.push({
      id: rec.id, name: rec.name, linkedAt: rec.linkedAt, lastScanAt: rec.lastScanAt,
      mode: rec.mode, perm: rec.perm || "unknown",
      new: (memo && Array.isArray(memo.new)) ? memo.new.length : 0,
      changed: (memo && Array.isArray(memo.changed)) ? memo.changed.length : 0,
      gone: (memo && Array.isArray(memo.gone)) ? memo.gone.length : 0,
      note: note,
    });
  }
  try { rows.sort(function (a, b) { return (b.linkedAt - a.linkedAt) || (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)); }); }
  catch (e) { /* order stands */ }
  return rows;
}

function avSrcStateNote() {
  const parts = [];
  try {
    if (!avSrc.loaded) parts.push("records not loaded yet");
    if (avSrc.backendNote) parts.push(avSrc.backendNote);
  } catch (e) { /* none */ }
  return parts.length ? parts.join(" - ") : null;
}

function avSourcesState() {
  try {
    const rows = avSrcStateRows();
    return {
      ok: true,
      fsKind: avSrcFsKind(),
      backend: avSrc.backend,
      count: rows.length,
      items: rows,
      note: avSrcStateNote(),
    };
  } catch (e) {
    return { ok: false, fsKind: "none", backend: "mem", count: 0, items: [], note: "state" };
  }
}

function avSourcesSnap() {
  return avSourcesState();
}

function avSourcesClasses() {
  return AV_SRC_CLASSES.slice();   /* this module mounts nothing -- the UI section owns markup */
}

/* ---------- debug handle (rigs + parent call these; names are the contract) ---------- */

if (typeof window !== "undefined" && window) {
  try {
    window.__avSources = {
      version: avSourcesVersion,
      status: avSourcesState,
      list: avSourcesList,
      link: avSourcesLink,
      scan: avSourcesScan,
      importNew: avSourcesImportNew,
      unlink: avSourcesUnlink,
      reconnect: avSourcesReconnect,
      setFs: avSrcSetFs,
      fsKind: avSrcFsKind,
    };
  } catch (e) { /* no window -- node harness only */ }
}
