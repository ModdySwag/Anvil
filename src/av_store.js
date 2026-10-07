/* av_store.js — Anvil P5 STORE CORE: the pack storage layer. Downloads, verifies and installs
   `.avbank.json` packs; it is the ONE owner of pack durability and the ONE network path.

   Pins (verify/_p5_wave.md §4b L89-96): `avStoreInit()` · `avStoreIndex(force)` (fetch
   `packs/index.json`) · `avStoreInstall(id)` · `avStoreRemove(id)` · `avStoreStatus()` ·
   `avStoreInstalled()` · `avStoreSetFetch(fn|null)` test seam (the ONLY network path; file://
   uses the seam/mock and shows an honest note; the deployed site uses real fetch). IDB name
   `av-packs-store`, LS fallback `av-packs-ls`, modes `idb|ls|mem`, quota-honest, sha256 via
   `crypto.subtle` verified BEFORE commit, offline relaunch hydrates from IDB. Never throws.
   Manifest shape pin (§4b L95): `{v:1, packs:[{id,name,file,sha256,bytes,presetCount,tags,
   engine}]}`, store base `packs/`.

   Ported from Pattern Forge's app_store.js per research/reuse/store-port-digest.md
   (§1.1 core ADAPT · §1.3 install flow · §1.4 quota contract · §1.5 offline relaunch · §3.1-3.3
   verdicts · §6 seams). PF line refs in comments; renames: pfPacks* → avStore*, DB
   `av-packs-store` (pinned). Dropped from the port: strudel/pack-kind vocabulary, the Stage-11
   wavetable-carry subsystem (§3.8 SKIP v1 — `.avbank.json` carries no binary fields).

   Storage tier law (ported verbatim, L9-16 / L245-288 / L191-243):
   - IndexedDB is the durable home; no IndexedDB → the `av-packs-ls` localStorage map; no
     storage at all → memory. The mode is always reportable (status().backend) so the UI is
     honest; a per-call result carries the tier it actually used.
   - `avStoreInstall` resolves `{ok:false, error:'quota'}` when a tier refuses the write and
     NOTHING is recorded as installed in that case — a pack that cannot persist is never shown
     as installed (the old code toasted "installed" while the write was silently swallowed).
   - Tier fallback happens on UNavailability, never on quota: an IDB write failure returns its
     name (`'quota'` / `'idb:<Name>'`) without a silent downgrade; only a missing/blocked DB
     falls through to localStorage, and only a fully unavailable localStorage falls to memory
     (`volatile:true`).
   - Hydrate: the LS snapshot paints first, then the database takes over (the snapshot is
     written only by a session that could not reach the DB, so for a duplicate id the SNAPSHOT
     wins; every snapshot id is written through and the key retires once its content is safe).
     Late adoption (one quiet background attempt, 4 s) rescues a cold/blocked open; removals
     made while the DB was unreachable are honoured in both directions (never resurrected).
   - IDB open gives up after 1.8 s (a hung open must not wedge the store) — the boot stays
     fast and the adoption covers the rest.

   The test seam: `avStoreSetFetch(fn|null)` — fn(url, opts) must resolve a fetch-like Response
   (`.ok`, `.status`, `.text()`, `.arrayBuffer()`). Exactly ONE function in this module reaches
   the network (`avStoreFetchUrl`); it uses the seam when set, else the real `fetch`, else
   refuses honestly (`'no-fetch'`). From a `file://` page status().note says so.

   Public surface (classic-script globals, ONE namespace avStore* / AV_STORE_*):
     avStoreInit() -> bool               wire + start the boot hydrate (idempotent; never throws)
     avStoreHydrate() -> Promise<mode>   idempotent boot hydrate ('idb'|'ls'|'mem')
     avStoreIndex(force) -> Promise      fetch+validate packs/index.json; force = refetch
     avStoreInstall(id) -> Promise       fetch → sha256 verify → parse → commit; {ok, backend,…}
     avStoreRemove(id) -> Promise<bool>  durable drop first, memory follows on success only
     avStoreStatus() -> {}               JSON-safe: backend, count, installed, index, net, note
     avStoreInstalled() -> []            per-pack summaries (no payloads), install order
     avStoreGet(id) -> {}|null           full record incl. a read-only deep copy of `pack`
     avStoreSetFetch(fn|null) -> bool    the network seam (returns "seam active?")
     avStoreBackend/Count/Estimate()     report helpers (Estimate = navigator.storage.estimate)
     avStoreAdopt(force) -> Promise      manual late-adoption retry (force skips the once-guard)
     avStoreOnChange(fn) -> bool         listener registry; avStorePaint() fires it (guarded)
     avStoreNote() -> string|null        the honest file:// note
     AV_STORE_VERSION, AV_STORE_MODES, AV_STORE_DB, AV_STORE_LS, AV_STORE_BASE, AV_STORE_MAX_BYTES.
   Result/error vocabulary: 'no-id' · 'no-index' · 'no-pack' · 'too-big' · 'no-fetch' · 'fetch'
   · 'http' · 'read' · 'json' · 'bad-manifest' · 'no-crypto' · 'sha-mismatch' · 'bad-pack' ·
   'quota' · 'idb:<Name>' (+ detail string where useful).

   Integration seams (parent): add this file to build.py js_parts BEFORE av_synth.js / the store
   UI / app_core.js; call `avStoreInit()` (or avStoreHydrate()) from the boot block guarded;
   the apply core (sa-3) reads packs via `avStoreGet(id)`; the store card (sa-1) subscribes with
   `avStoreOnChange(fn)`; the rig points the store at a local server with
   `localStorage['av-store-url']` + `avStoreSetFetch(...)`.

   Laws kept: "use strict"; page module — NO DOM at top level and NO top-level side effects (the
   file parses and loads in plain node); every DOM/global reach is guarded inside a function;
   ONE avStore* family; never throws (garbage in → false / null / empty out). */

"use strict";

/* ---------- pins (§4b; PF renames applied) ---------- */

const AV_STORE_VERSION = "p5.0";
const AV_STORE_DB = "av-packs-store";          /* pinned IDB name (§4b) */
const AV_STORE_DB_VER = 1;
const AV_STORE_OS = "packs";                   /* object store, keyPath 'id' (PF L21/L58) */
const AV_STORE_LS = "av-packs-ls";             /* localStorage fallback key (§4b) */
const AV_STORE_URL_LS = "av-store-url";        /* store base override (digest §6.8) */
const AV_STORE_BASE = "packs/";                /* default store base (§4b) */
const AV_STORE_INDEX = "index.json";
const AV_STORE_MODES = ["idb", "ls", "mem"];   /* reportable backends (PF L12) */
const AV_STORE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;  /* slug law (PF L250, capped at 64) */
const AV_STORE_SHA_RE = /^[0-9a-f]{64}$/;
const AV_STORE_MAX_BYTES = 20 * 1024 * 1024;   /* rig law: pack files stay under 20 MB */
const AV_STORE_OPEN_CAP_MS = 1800;             /* hung-open give-up (PF L51-54) */
const AV_STORE_ADOPT_MS = 4000;                /* one late adoption attempt (PF L84-89) */
const AV_STORE_FETCH_MS = 30000;               /* pack download timeout (PF flow L152-155) */
const AV_STORE_MANIFEST_MS = 10000;            /* manifest timeout (PF app_ui.js:282) */

/* ---------- state (in-memory truth the UI renders from, PF L23-28) ---------- */

const avStoreState = {
  inited: false,
  hydrated: false,
  hydratePromise: null,
  backend: "mem",              /* 'idb' | 'ls' | 'mem' — stays honest, promoted never demoted */
  installed: {},               /* id -> record {id,v,name,file,sha256,size,at,presetCount,tags,engine,pack} */
  db: null,
  dbGaveUp: false,
  adoptTried: false,
  adoptTimer: null,
  droppedNoDb: new Set(),      /* ids removed while no DB connection was up (PF L28) */
  lastAdopt: null,
  fetchFn: null,               /* the ONE seam (avStoreSetFetch) */
  index: null,                 /* {v, name, updated, packs:[entries]} once ready */
  indexCount: 0,
  indexStatus: null,           /* null | 'loading' | 'ready' | 'error' */
  indexError: null,
  indexBase: null,
  indexAt: 0,
  indexPromise: null,
  netIndex: 0,
  netPack: 0,
  listeners: [],
  lastError: null,
};

/* ---------- guarded environment reaches (never throw; plain node has none of these) ---------- */

function avStoreLs() {
  try { if (typeof localStorage !== "undefined" && localStorage) return localStorage; } catch (e) { /* blocked */ }
  try { const w = (typeof window !== "undefined") ? window : null; if (w && w.localStorage) return w.localStorage; } catch (e) { /* blocked */ }
  return null;
}

function avStoreIdb() {
  try { if (typeof indexedDB !== "undefined" && indexedDB) return indexedDB; } catch (e) { /* none */ }
  try { const w = (typeof window !== "undefined") ? window : null; if (w && w.indexedDB) return w.indexedDB; } catch (e) { /* none */ }
  return null;
}

function avStoreCryptoSrc() {
  try { if (typeof crypto !== "undefined" && crypto) return crypto; } catch (e) { /* none */ }
  try { const w = (typeof window !== "undefined") ? window : null; if (w && w.crypto) return w.crypto; } catch (e) { /* none */ }
  return null;
}

function avStoreNetFn() {
  try { if (typeof avStoreState.fetchFn === "function") return avStoreState.fetchFn; } catch (e) { /* fall through */ }
  try { if (typeof fetch === "function") return fetch; } catch (e) { /* none */ }
  try { const w = (typeof window !== "undefined") ? window : null; if (w && typeof w.fetch === "function") return w.fetch; } catch (e) { /* none */ }
  return null;
}

function avStoreFetchSource() {
  try { if (typeof avStoreState.fetchFn === "function") return "seam"; } catch (e) { /* fall through */ }
  try { if (typeof fetch === "function") return "real"; } catch (e) { /* none */ }
  try { const w = (typeof window !== "undefined") ? window : null; if (w && typeof w.fetch === "function") return "real"; } catch (e) { /* none */ }
  return "none";
}

/* the resolved scheme of a fetch target (relative URLs resolve against the page): "file:" means
   the browser will scheme-block the request; "" when it cannot be resolved (node harnesses). */
function avStoreUrlScheme(u) {
  try {
    const base = (typeof location !== "undefined" && location && location.href) ? location.href : undefined;
    if (typeof URL === "function") return String(new URL(String(u), base).protocol || "");
  } catch (e) { /* no URL/base — scheme-less */ }
  return "";
}

function avStoreTimer(fn, ms) {
  try { if (typeof setTimeout === "function") return setTimeout(fn, ms); } catch (e) { /* no timers */ }
  return null;
}

function avStoreClear(t) {
  try { if (t != null && typeof clearTimeout === "function") clearTimeout(t); } catch (e) { /* no timers */ }
}

/* ---------- tiny value laws (garbage in, sane value out) ---------- */

function avStoreErrName(e) { try { return (e && e.name) ? String(e.name) : ""; } catch (e2) { return ""; } }
function avStoreErrMsg(e) { try { const s = (e && e.message) ? String(e.message) : String(e); return s.slice(0, 120); } catch (e2) { return "error"; } }

function avStoreStr(v, dflt, cap) {
  try {
    if (typeof v !== "string") return dflt;
    const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, cap || 80);
    return s || dflt;
  } catch (e) { return dflt; }
}

function avStoreNum(v, dflt, lo, hi) {
  try {
    const n = Number(v);
    if (!isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  } catch (e) { return dflt; }
}

function avStoreTags(v) {
  try {
    if (!Array.isArray(v)) return [];
    const out = [];
    for (let i = 0; i < v.length && out.length < 16; i++) {
      if (typeof v[i] === "string") { const s = avStoreStr(v[i], "", 32); if (s) out.push(s); }
    }
    return out;
  } catch (e) { return []; }
}

function avStoreHex(u8) {
  try {
    let s = "";
    for (let i = 0; i < u8.length; i++) { const h = u8[i].toString(16); s += h.length < 2 ? "0" + h : h; }
    return s;
  } catch (e) { return null; }
}

function avStoreIdOk(id) {
  try { return typeof id === "string" && AV_STORE_ID_RE.test(id); } catch (e) { return false; }
}

/* ---------- the record shape (PF L174-187, minus the kind vocabulary) ---------- */

function avStoreRecordNorm(id, v) {
  try {
    const pack = (v && typeof v.pack === "object" && !Array.isArray(v.pack)) ? v.pack : null;
    const meta = (pack && pack.meta && typeof pack.meta === "object") ? pack.meta : {};
    const shaIn = (v && typeof v.sha256 === "string") ? v.sha256.trim().toLowerCase() : "";
    return {
      id: id,
      v: 1,
      name: avStoreStr(v && v.name, avStoreStr(meta.name, id, 80), 80),
      file: avStoreStr(v && v.file, null, 160),
      sha256: AV_STORE_SHA_RE.test(shaIn) ? shaIn : null,
      size: avStoreNum(v && v.size, null, 0, AV_STORE_MAX_BYTES * 128),
      at: avStoreNum(v && v.at, 0, 0, 9e15),
      presetCount: avStoreNum(v && v.presetCount, (pack && Array.isArray(pack.presets)) ? pack.presets.length : 0, 0, 1000000),
      tags: avStoreTags(v && v.tags),
      engine: avStoreStr(v && v.engine, "", 24),
      pack: pack,
    };
  } catch (e) { return null; }
}

function avStoreRecordMake(id, entry, pack, bytes, hex) {
  const meta = (pack && pack.meta && typeof pack.meta === "object") ? pack.meta : {};
  const etags = (entry && Array.isArray(entry.tags) && entry.tags.length) ? entry.tags : null;
  const mtags = (Array.isArray(meta.tags) && meta.tags.length) ? meta.tags : null;
  return {
    id: id,
    v: 1,
    name: avStoreStr(meta.name, avStoreStr(entry && entry.name, id, 80), 80),
    file: avStoreStr(entry && entry.file, null, 160),
    sha256: hex,
    size: bytes,
    at: Date.now(),
    presetCount: (pack && Array.isArray(pack.presets)) ? pack.presets.length : 0,
    tags: avStoreTags(mtags || etags),
    engine: avStoreStr(meta.engine, avStoreStr(entry && entry.engine, "", 24), 24),
    pack: pack,
  };
}

/* manifest entry → normalised ({id,name,file,sha256,bytes,presetCount,tags,engine}) or null.
   An entry needs a slug id, a safe relative file and a 64-hex sha256 — the install gate. */
function avStoreEntryNorm(raw) {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const id = (typeof raw.id === "string") ? raw.id.trim() : "";
    if (!avStoreIdOk(id)) return null;
    const file = avStoreStr(raw.file, "", 160);
    if (!file || file.indexOf("..") >= 0 || file.charAt(0) === "/") return null;
    const shaIn = (typeof raw.sha256 === "string") ? raw.sha256.trim().toLowerCase() : "";
    if (!AV_STORE_SHA_RE.test(shaIn)) return null;
    return {
      id: id,
      name: avStoreStr(raw.name, id, 80),
      file: file,
      sha256: shaIn,
      bytes: avStoreNum(raw.bytes, null, 0, AV_STORE_MAX_BYTES * 128),
      presetCount: avStoreNum(raw.presetCount, null, 0, 1000000),
      tags: avStoreTags(raw.tags),
      engine: avStoreStr(raw.engine, "", 24),
    };
  } catch (e) { return null; }
}

function avStoreEntry(id) {
  try {
    const st = avStoreState;
    if (!st.index || !Array.isArray(st.index.packs)) return null;
    for (let i = 0; i < st.index.packs.length; i++) if (st.index.packs[i].id === id) return st.index.packs[i];
    return null;
  } catch (e) { return null; }
}

/* ---------- IndexedDB plumbing (promise-wrapped, never throws — PF L44-172) ---------- */

function avStoreDbOpen() {
  return new Promise(function (res) {
    try {
      const st = avStoreState;
      if (st.db) return res(st.db);
      if (st.dbGaveUp) return res(null);
      const idb = avStoreIdb();
      if (!idb) return res(null);
      let settled = false;
      const give = function (v) { if (!settled) { settled = true; res(v); } };
      /* a hung open (blocked upgrade in another tab) must not wedge the store: give up after
         1.8 s — the boot stays honest and fast, and one late attempt below adopts the DB */
      const timer = avStoreTimer(function () { st.dbGaveUp = true; give(null); avStoreAdoptSoon(); }, AV_STORE_OPEN_CAP_MS);
      const rq = idb.open(AV_STORE_DB, AV_STORE_DB_VER);
      rq.onupgradeneeded = function () {
        try { const db = rq.result; if (!db.objectStoreNames || !db.objectStoreNames.contains(AV_STORE_OS)) db.createObjectStore(AV_STORE_OS, { keyPath: "id" }); }
        catch (e) { /* upgrade raced */ }
      };
      rq.onsuccess = function () {
        avStoreClear(timer);
        if (st.dbGaveUp) { try { rq.result.close(); } catch (e) { /* ignore */ } return give(null); }
        const db = rq.result;
        st.db = db;
        try { db.onclose = function () { if (avStoreState.db === db) avStoreState.db = null; }; } catch (e) { /* fine */ }
        give(db);
      };
      rq.onerror = function () { avStoreClear(timer); give(null); };
      rq.onblocked = function () { avStoreClear(timer); give(null); };
    } catch (e) { res(null); }
  });
}

function avStoreDbAll(db) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_STORE_OS, "readonly");
      const rq = tx.objectStore(AV_STORE_OS).getAll();
      rq.onsuccess = function () { res(rq.result || []); };
      rq.onerror = function () { res(null); };
      tx.onerror = function () { res(null); };
    } catch (e) { res(null); }
  });
}

function avStoreDbWrite(db, rec) {
  return new Promise(function (res, rej) {
    try {
      const tx = db.transaction(AV_STORE_OS, "readwrite");
      tx.objectStore(AV_STORE_OS).put(rec);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { rej((tx.error) || new Error("idb write failed")); };
      tx.onabort = function () { rej((tx.error) || new Error("idb write aborted")); };
    } catch (e) { rej(e); }
  });
}

function avStoreDbRemove(db, id) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_STORE_OS, "readwrite");
      tx.objectStore(AV_STORE_OS).delete(id);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { res(false); };
      tx.onabort = function () { res(false); };
    } catch (e) { res(false); }
  });
}

/* ---------- base + the ONE network path + sha256 ---------- */

function avStoreBase() {
  let base = AV_STORE_BASE;
  try { const ls = avStoreLs(); const v = ls ? ls.getItem(AV_STORE_URL_LS) : null; if (v) base = String(v); } catch (e) { /* default */ }
  if (typeof base !== "string" || !base) base = AV_STORE_BASE;
  if (base.charAt(base.length - 1) !== "/") base += "/";
  return base;
}

/* the ONLY place this module touches the network. The seam (when set) is called exactly like
   fetch(url, {signal}) and must resolve a Response-like: .ok, .status, .text(), .arrayBuffer(). */
function avStoreFetchUrl(url, timeoutMs, kind) {
  return new Promise(function (res, rej) {
    let timer = null;
    try {
      const st = avStoreState;
      const fn = avStoreNetFn();
      if (typeof fn !== "function") return rej(new Error("no-fetch"));
      /* §4b file:// law: a page fetch of a local file is scheme-blocked by the browser — refuse
         the doomed request here (and count no attempt) so no console noise fires; the seam,
         hosted http(s) and localhost servers all fetch as usual, and the note + status copy
         already explain the file:// state honestly. */
      if (avStoreFetchSource() === "real" && avStoreUrlScheme(url) === "file:") return rej(new Error("blocked-file"));
      if (kind === "pack") st.netPack += 1; else st.netIndex += 1;
      let controller = null;
      try {
        if (typeof AbortController === "function") {
          controller = new AbortController();
          timer = avStoreTimer(function () { try { controller.abort(); } catch (e) { /* ignore */ } }, (timeoutMs || AV_STORE_FETCH_MS));
        }
      } catch (e) { /* no AbortController: fetch without its own timeout */ }
      let out = null;
      try { out = fn(url, controller ? { signal: controller.signal } : undefined); }
      catch (e) { avStoreClear(timer); return rej(e); }
      Promise.resolve(out).then(
        function (r) { avStoreClear(timer); res(r); },
        function (e) { avStoreClear(timer); rej(e); }
      );
    } catch (e) { avStoreClear(timer); rej(e); }
  });
}

function avStoreBytesToText(buf) {
  try { if (typeof TextDecoder === "function") return new TextDecoder("utf-8").decode(buf); } catch (e) { /* fall back */ }
  try {
    const u8 = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return s;
  } catch (e) { return null; }
}

/* null when crypto.subtle is missing — the caller refuses the install (sha is never skipped) */
async function avStoreSha256Hex(buf) {
  const c = avStoreCryptoSrc();
  if (!c || !c.subtle || typeof c.subtle.digest !== "function") return null;
  try {
    const d = await c.subtle.digest("SHA-256", buf);
    return avStoreHex(new Uint8Array(d));
  } catch (e) { return null; }
}

/* ---------- commit (PF pfPacksPut L247-288: quota-honest, tier fallback on unavailability) ---------- */

async function avStoreCommit(record) {
  const st = avStoreState;
  /* 1) the durable home */
  if (st.db) {
    try {
      await avStoreDbWrite(st.db, record);
      st.installed[record.id] = record;
      st.lastError = null;
      return { ok: true, backend: "idb" };
    } catch (e) {
      const name = avStoreErrName(e);
      /* a closed connection (tab churn) may heal on the NEXT call; a quota will not — say which */
      if (name === "InvalidStateError" || name === "TransactionInactiveError") {
        st.db = null;
        try { await avStoreDbOpen(); } catch (e2) { /* stays null */ }
      }
      const out = { ok: false, backend: "idb", error: name === "QuotaExceededError" ? "quota" : ("idb:" + (name || "error")) };
      st.lastError = out.error;
      return out;
    }
  }
  /* 2) no IndexedDB: the localStorage path, with an honest quota failure */
  const ls = avStoreLs();
  if (ls) {
    const map = Object.assign({}, st.installed);
    map[record.id] = record;
    try {
      ls.setItem(AV_STORE_LS, JSON.stringify(map));
      st.installed[record.id] = record;
      if (st.backend === "mem") st.backend = "ls";   /* the tier really is in use now (PF L278-279) */
      st.lastError = null;
      return { ok: true, backend: "ls" };
    } catch (e) {
      if (avStoreErrName(e) === "QuotaExceededError") { st.lastError = "quota"; return { ok: false, error: "quota", backend: "ls" }; }
      /* storage fully unavailable: fall to memory for this session */
    }
  }
  /* 3) memory — volatile, and the result says so */
  st.installed[record.id] = record;
  st.lastError = null;
  return { ok: true, backend: "mem", volatile: true };
}

/* ---------- hydrate (PF pfPacksHydrate L191-243) + late adoption (L73-136) ---------- */

function avStoreHydrate() {
  const st = avStoreState;
  if (st.hydratePromise) return st.hydratePromise;
  try {
    st.hydratePromise = avStoreHydrateRun().catch(function (e) {
      st.lastError = "hydrate:" + avStoreErrMsg(e);
      st.hydrated = true;
      return st.backend;
    });
    return st.hydratePromise;
  } catch (e) {
    st.hydrated = true;
    return Promise.resolve(st.backend);
  }
}

async function avStoreHydrateRun() {
  const st = avStoreState;
  if (st.hydrated) return st.backend;
  /* 1) the localStorage snapshot paints first; an id from storage is re-validated before it is
     trusted again (slug + record shape) — PF L197-205 */
  const lsClean = {};
  try {
    const ls = avStoreLs();
    const raw = ls ? ls.getItem(AV_STORE_LS) : null;
    if (raw != null) {
      let obj = null;
      try { obj = JSON.parse(raw); } catch (e) { obj = null; }
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        const keys = Object.keys(obj);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          const v = obj[k];
          if (avStoreIdOk(k) && v && typeof v === "object" && !Array.isArray(v) && v.pack && typeof v.pack === "object") {
            const rec = avStoreRecordNorm(k, v);
            if (rec) lsClean[k] = rec;
          }
        }
      }
    }
  } catch (e) { /* storage blocked: memory only */ }
  st.installed = lsClean;
  /* 2) the database takes over */
  const db = await avStoreDbOpen();
  if (db) {
    const recs = await avStoreDbAll(db);
    if (recs === null) {
      st.backend = Object.keys(lsClean).length ? "ls" : "mem";   /* read blew up: stay on the snapshot */
    } else {
      st.backend = "idb";
      const fromDb = {};
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i];
        if (r && avStoreIdOk(r.id) && r.pack && typeof r.pack === "object") {
          const rec = avStoreRecordNorm(r.id, r);
          if (rec) fromDb[r.id] = rec;
        }
      }
      /* the snapshot is written only by a session that could not reach this database, so for a
         duplicate id the SNAPSHOT is the newer copy and wins (PF L220-223) */
      st.installed = Object.assign({}, fromDb, lsClean);
      /* write through EVERY snapshot id, then retire the key once its content is safe (L224-234) */
      let want = 0, imported = 0;
      const ids = Object.keys(lsClean);
      for (let i = 0; i < ids.length; i++) {
        want += 1;
        try { await avStoreDbWrite(db, st.installed[ids[i]]); imported += 1; } catch (e) { /* best-effort import */ }
      }
      if (want && imported === want) { try { const l2 = avStoreLs(); if (l2) l2.removeItem(AV_STORE_LS); } catch (e) { /* keep the spare copy */ } }
    }
  } else {
    st.backend = Object.keys(lsClean).length ? "ls" : "mem";
  }
  st.hydrated = true;
  avStorePaint();
  return st.backend;
}

function avStoreAdoptSoon() {
  const st = avStoreState;
  if (st.adoptTried || st.adoptTimer) return;
  try { st.adoptTimer = avStoreTimer(function () { st.adoptTimer = null; avStoreAdopt(); }, AV_STORE_ADOPT_MS); }
  catch (e) { /* no timers (hatched test shells): the manual retry still exists */ }
}

function avStoreAdopt(force) {
  try { return Promise.resolve(avStoreAdoptRun(!!force)).catch(function () { return avStoreBackend(); }); }
  catch (e) { return Promise.resolve(avStoreBackend()); }
}

async function avStoreAdoptRun(force) {
  const st = avStoreState;
  if (st.hydratePromise && !st.hydrated) { try { await st.hydratePromise; } catch (e) { /* proceed */ } }
  if (st.db) return st.backend;                       /* already durable */
  if (!force && st.adoptTried) return st.backend;     /* once per session (PF L93) */
  st.adoptTried = true;
  st.dbGaveUp = false;                                /* forgive the boot timeout, this once */
  const db = await avStoreDbOpen();
  if (!db) return st.backend;                         /* still slow: stay honest, stay volatile */
  st.backend = "idb";
  const recs = await avStoreDbAll(db);
  const fromDb = {};
  const list = recs || [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r && avStoreIdOk(r.id) && r.pack && typeof r.pack === "object") {
      const rec = avStoreRecordNorm(r.id, r);
      if (rec) fromDb[r.id] = rec;
    }
  }
  /* a removal made in this degraded session is the user's word, not a pending write: honour it in
     both directions rather than resurrecting the pack when the database lands (PF L102-110) */
  let honoured = 0;
  st.droppedNoDb.forEach(function (id) {
    if (!(id in fromDb)) return;
    delete fromDb[id];
    try { avStoreDbRemove(db, id); honoured += 1; } catch (e) { /* the merge below still wins */ }
  });
  st.droppedNoDb = new Set();
  /* records of earlier sessions join THIS session's list — a pack the session already holds keeps
     the session's copy (it is the one that is playing) — PF L111-115 */
  const before = Object.keys(st.installed).length;
  st.installed = Object.assign({}, fromDb, st.installed);
  const adopted = Object.keys(st.installed).length - before;
  /* every pack this session holds only in memory lands in the database now (L116-123) */
  const have = new Set(Object.keys(fromDb));
  let landed = 0, failed = 0;
  const ids = Object.keys(st.installed);
  for (let i = 0; i < ids.length; i++) {
    if (have.has(ids[i])) continue;
    try { await avStoreDbWrite(db, st.installed[ids[i]]); landed += 1; } catch (e) { failed += 1; }
  }
  if (!failed) { try { const ls = avStoreLs(); if (ls) ls.removeItem(AV_STORE_LS); } catch (e) { /* keep the spare copy */ } }
  st.hydrated = true;
  st.lastAdopt = { adopted: adopted, landed: landed, failed: failed, honoured: honoured, at: Date.now() };
  st.lastError = null;
  avStorePaint();
  return st.backend;
}

/* ---------- the index (PF refreshPackIndex flow; manifest shape pinned in §4b) ---------- */

function avStoreIndex(force) {
  const st = avStoreState;
  try {
    if (st.indexStatus === "loading" && st.indexPromise) return st.indexPromise;
    if (!force && st.indexStatus === "ready" && st.index) return Promise.resolve({ ok: true, cached: true, count: st.indexCount });
    const p = avStoreIndexRun().then(
      function (r) {
        if (avStoreState.indexPromise === p) avStoreState.indexPromise = null;
        return r;
      },
      function (e) {
        if (avStoreState.indexPromise === p) avStoreState.indexPromise = null;
        return { ok: false, error: "index:" + avStoreErrMsg(e) };
      }
    );
    st.indexPromise = p;
    return p;
  } catch (e) { return Promise.resolve({ ok: false, error: "index:" + avStoreErrMsg(e) }); }
}

async function avStoreIndexRun() {
  const st = avStoreState;
  st.indexStatus = "loading";
  st.indexError = null;
  const url = avStoreBase() + AV_STORE_INDEX;
  let res = null;
  try { res = await avStoreFetchUrl(url, AV_STORE_MANIFEST_MS, "index"); }
  catch (e) {
    const m = avStoreErrMsg(e);
    const err = (m === "no-fetch") ? "no-fetch" : "fetch";
    st.indexStatus = "error"; st.indexError = err; st.lastError = "index:" + m;
    avStorePaint();
    return { ok: false, error: err, detail: m };
  }
  if (!res || res.ok !== true) {
    st.indexStatus = "error"; st.indexError = "http"; st.lastError = "index:http";
    avStorePaint();
    return { ok: false, error: "http", detail: (res && res.status != null) ? String(res.status) : "" };
  }
  let text = null;
  try { text = await res.text(); } catch (e) { text = null; }
  if (text == null) {
    st.indexStatus = "error"; st.indexError = "read"; st.lastError = "index:read";
    avStorePaint();
    return { ok: false, error: "read" };
  }
  let man = null, parsed = true;
  try { man = JSON.parse(text); } catch (e) { parsed = false; }
  if (!parsed) {
    st.indexStatus = "error"; st.indexError = "json"; st.lastError = "index:json";
    avStorePaint();
    return { ok: false, error: "json" };
  }
  if (!man || typeof man !== "object" || Array.isArray(man) || !Array.isArray(man.packs) || (man.v != null && man.v !== 1)) {
    st.indexStatus = "error"; st.indexError = "bad-manifest"; st.lastError = "index:bad-manifest";
    avStorePaint();
    return { ok: false, error: "bad-manifest" };
  }
  const packs = [];
  let dropped = 0;
  for (let i = 0; i < man.packs.length; i++) {
    const e = avStoreEntryNorm(man.packs[i]);
    if (e) packs.push(e); else dropped += 1;
  }
  st.index = { v: 1, name: avStoreStr(man.name, null, 80), updated: avStoreStr(man.updated, null, 40), packs: packs };
  st.indexStatus = "ready";
  st.indexCount = packs.length;
  st.indexBase = avStoreBase();
  st.indexAt = Date.now();
  st.lastError = null;
  avStorePaint();
  return { ok: true, count: packs.length, dropped: dropped, base: st.indexBase };
}

/* ---------- install (PF install flow L146-180 + pfPacksPut): fetch → sha → parse → commit ---------- */

function avStoreInstall(id) {
  try {
    return Promise.resolve(avStoreInstallRun(id)).catch(function (e) { return { ok: false, error: "install:" + avStoreErrMsg(e) }; });
  } catch (e) { return Promise.resolve({ ok: false, error: "install:" + avStoreErrMsg(e) }); }
}

async function avStoreInstallRun(id) {
  const st = avStoreState;
  if (!avStoreIdOk(id)) return { ok: false, error: "no-id" };
  if (!st.index && st.indexPromise) { try { await st.indexPromise; } catch (e) { /* fall below */ } }
  if (!st.index) return { ok: false, error: "no-index" };
  const entry = avStoreEntry(id);
  if (!entry) return { ok: false, error: "no-pack" };
  if (entry.bytes != null && entry.bytes > AV_STORE_MAX_BYTES) return { ok: false, error: "too-big" };
  const url = avStoreBase() + entry.file;
  let res = null;
  try { res = await avStoreFetchUrl(url, AV_STORE_FETCH_MS, "pack"); }
  catch (e) {
    const m = avStoreErrMsg(e);
    st.lastError = "pack:" + m;
    return { ok: false, error: (m === "no-fetch") ? "no-fetch" : "fetch", detail: m };
  }
  if (!res || res.ok !== true) {
    st.lastError = "pack:http";
    return { ok: false, error: "http", detail: (res && res.status != null) ? String(res.status) : "" };
  }
  let buf = null;
  try { buf = await res.arrayBuffer(); } catch (e) { buf = null; }
  if (!buf || typeof buf.byteLength !== "number") return { ok: false, error: "read" };
  if (buf.byteLength > AV_STORE_MAX_BYTES) return { ok: false, error: "too-big" };
  const hex = await avStoreSha256Hex(buf);
  if (!hex) { st.lastError = "no-crypto"; return { ok: false, error: "no-crypto" }; }
  /* sha256 verified BEFORE commit — a mismatch never reaches either tier */
  if (hex !== entry.sha256) { st.lastError = "sha-mismatch"; return { ok: false, error: "sha-mismatch", sha: hex }; }
  const text = avStoreBytesToText(buf);
  let fresh = null;
  try { fresh = (text == null) ? null : JSON.parse(text); } catch (e) { fresh = null; }
  if (!fresh || typeof fresh !== "object" || Array.isArray(fresh) || !Array.isArray(fresh.presets)) {
    st.lastError = "bad-pack";
    return { ok: false, error: "bad-pack" };
  }
  const record = avStoreRecordMake(id, entry, fresh, buf.byteLength, hex);
  const put = await avStoreCommit(record);
  if (!put || put.ok !== true) return put || { ok: false, error: "commit" };
  avStorePaint();
  return { ok: true, id: id, backend: put.backend, volatile: !!put.volatile, sha256: hex, presetCount: record.presetCount, size: record.size };
}

/* ---------- remove (PF pfPacksDelete L290-305): durable drop first, memory on success only ---------- */

function avStoreRemove(id) {
  try { return Promise.resolve(avStoreRemoveRun(id)).catch(function () { return false; }); }
  catch (e) { return Promise.resolve(false); }
}

async function avStoreRemoveRun(id) {
  const st = avStoreState;
  if (!avStoreIdOk(id)) return false;
  let dropped = false;
  if (st.db) {
    dropped = await avStoreDbRemove(st.db, id);
  } else {
    const ls = avStoreLs();
    let lsWrite = "none";   /* 'ok' | 'quota' | 'err' | 'none' */
    if (ls) {
      const map = Object.assign({}, st.installed);
      delete map[id];
      try { ls.setItem(AV_STORE_LS, JSON.stringify(map)); lsWrite = "ok"; }
      catch (e) { lsWrite = (avStoreErrName(e) === "QuotaExceededError") ? "quota" : "err"; }
    }
    if (lsWrite === "ok") {
      dropped = true;
      st.droppedNoDb.add(id);                 /* write-through at adoption: never resurrected */
      if (st.backend === "mem") st.backend = "ls";
    } else if (lsWrite === "quota") {
      dropped = false;                        /* the durable tier refused: the pack stays, honest */
    } else {
      /* nothing durable was in use (mem mode): there is nothing durable to drop */
      dropped = (st.backend === "mem");
      if (dropped) st.droppedNoDb.add(id);
    }
  }
  if (dropped) { delete st.installed[id]; avStorePaint(); }
  return dropped;
}

/* ---------- the report surface ---------- */

function avStoreInstalled() {
  try {
    const st = avStoreState;
    const out = [];
    const ids = Object.keys(st.installed);
    for (let i = 0; i < ids.length; i++) {
      const r = st.installed[ids[i]];
      if (!r) continue;
      out.push({
        id: r.id, v: r.v || 1, name: r.name, file: r.file, sha256: r.sha256,
        size: r.size, at: r.at, presetCount: r.presetCount, engine: r.engine,
        tags: Array.isArray(r.tags) ? r.tags.slice() : [],
      });
    }
    out.sort(function (a, b) { return (a.at || 0) - (b.at || 0) || (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)); });
    return out;
  } catch (e) { return []; }
}

function avStoreGet(id) {
  try {
    const st = avStoreState;
    if (typeof id !== "string" || !st.installed[id]) return null;
    const r = st.installed[id];
    /* read-only contract: callers get a fresh deep copy, never the store's own record */
    let pack = r.pack;
    try { if (typeof JSON !== "undefined") pack = JSON.parse(JSON.stringify(r.pack)); } catch (e) { pack = r.pack; }
    return {
      id: r.id, v: r.v || 1, name: r.name, file: r.file, sha256: r.sha256, size: r.size,
      at: r.at, presetCount: r.presetCount, engine: r.engine,
      tags: Array.isArray(r.tags) ? r.tags.slice() : [], pack: pack,
    };
  } catch (e) { return null; }
}

function avStoreBackend() { try { return avStoreState.backend; } catch (e) { return null; } }
function avStoreCount() { try { return Object.keys(avStoreState.installed).length; } catch (e) { return 0; } }

function avStoreEstimate() {
  try {
    let nav = null;
    try { nav = (typeof navigator !== "undefined") ? navigator : ((typeof window !== "undefined" && window) ? window.navigator : null); } catch (e) { nav = null; }
    if (nav && nav.storage && typeof nav.storage.estimate === "function") {
      return Promise.resolve(nav.storage.estimate()).then(
        function (e) { return { usage: (e && e.usage) || 0, quota: (e && e.quota) || 0 }; },
        function () { return null; }
      );
    }
  } catch (e) { /* none */ }
  return Promise.resolve(null);
}

function avStoreStatus() {
  try {
    const st = avStoreState;
    const summaries = avStoreInstalled();
    return {
      v: AV_STORE_VERSION,
      ok: true,
      inited: !!st.inited,
      hydrated: !!st.hydrated,
      backend: st.backend,
      count: summaries.length,
      ids: summaries.map(function (e) { return e.id; }),
      installed: summaries,
      db: !!st.db,
      dbGaveUp: !!st.dbGaveUp,
      adopt: st.lastAdopt ? { adopted: st.lastAdopt.adopted, landed: st.lastAdopt.landed, failed: st.lastAdopt.failed, honoured: st.lastAdopt.honoured, at: st.lastAdopt.at } : null,
      index: { status: st.indexStatus, count: st.indexCount, base: st.indexBase, at: st.indexAt, error: st.indexError, name: st.index ? st.index.name : null, updated: st.index ? st.index.updated : null, packs: st.index ? st.index.packs : null },
      net: { source: avStoreFetchSource(), index: st.netIndex, pack: st.netPack },
      note: avStoreNote(),
      lastError: st.lastError,
    };
  } catch (e) {
    return { v: AV_STORE_VERSION, ok: false, backend: null, count: 0, installed: [], lastError: "status:" + avStoreErrMsg(e) };
  }
}

function avStoreNote() {
  try {
    const src = avStoreFetchSource();
    let filePage = false;
    try { filePage = (typeof location !== "undefined" && location && String(location.protocol) === "file:"); } catch (e) { filePage = false; }
    if (src === "none") {
      return filePage
        ? "file:// page with no fetch — the store cannot reach packs; it loads packs on the hosted site (or via the test seam)."
        : "no fetch available here — the store cannot reach packs.";
    }
    if (filePage && src === "seam") return "file:// page on the test seam — packs come from the rig's mock server, not the live site.";
    if (filePage && src === "real") return "file:// page — browsers block local-file fetches; packs load from the hosted site (or a local server via the store seam).";
    return null;
  } catch (e) { return null; }
}

/* ---------- the seam + listeners + init ---------- */

function avStoreSetFetch(fn) {
  try {
    if (fn == null) { avStoreState.fetchFn = null; return false; }
    if (typeof fn === "function") { avStoreState.fetchFn = fn; return true; }
  } catch (e) { /* ignore */ }
  try { return typeof avStoreState.fetchFn === "function"; } catch (e) { return false; }
}

function avStoreOnChange(fn) {
  try {
    const st = avStoreState;
    if (typeof fn === "function" && Array.isArray(st.listeners) && st.listeners.length < 32) { st.listeners.push(fn); return true; }
  } catch (e) { /* ignore */ }
  return false;
}

function avStorePaint() {
  const st = avStoreState;
  let snap = null;
  try { snap = avStoreStatus(); } catch (e) { snap = null; }
  let list = [];
  try { list = Array.isArray(st.listeners) ? st.listeners.slice() : []; } catch (e) { list = []; }
  for (let i = 0; i < list.length; i++) { try { list[i](snap); } catch (e) { /* a listener never breaks the store */ } }
  return snap;
}

function avStoreInit() {
  try {
    const st = avStoreState;
    if (!st.inited) {
      st.inited = true;
      avStoreHydrate();   /* best-effort boot hydrate; idempotent by promise */
    }
    return true;
  } catch (e) { return false; }
}
