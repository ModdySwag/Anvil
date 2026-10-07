/* av_code.js -- Anvil S5 CODE section: the page facade over the user-module runtime (AVUMOD).
   Contract: verify/_s5_wave.md section 2.B. This module is the ONLY page-side owner of:
   - the SPN/worklet transport seam for `umod` messages (worklet: h.node.port.postMessage;
     SPN: AVUMOD.handle(h.engine, m, {postMessage: avCodeOnMessage}) - the fake port),
   - the module mirror + status self-refresh (poison telemetry rides a light `list` poll),
   - persistence: IndexedDB `av-code-store` (object store `modules`, keyPath `id`) with the
     av_store LS-fallback pattern (`av-code-ls` fallback key, memory as the honest last tier),
   - the three shipped example modules (tremolo fx / bitcrush fx / fold kind - own-authored,
     MIT, correct per the contract) and the `.avmod` export/import format,
   - the restore path: avEngineEnsure().then(h => avCodeRestore(h)); enabled records re-enter
     the engine through the SAME `umod` add message the editor uses.

   LAWS preserved:
   - strict mode; page scope only (this file never ships into the worklet); no console windows.
   - every DOM/window/localStorage/IndexedDB/fetch touch is guarded; the file loads side-effect
     free and runs headless (node harness) with all of those absent.
   - never throws out of the public API: refusals resolve as {ok:false, error} / return false.
   - no silent queue: an add while the engine handle is null refuses honestly.

   Exports (the pinned section 2.B list + the parent addendum + one documented extra):
   avCodeInit() · avCodeRestore(h) · avCodeList() · avCodeAdd(spec) · avCodeRemove(id) ·
   avCodeEnable(id, on) · avCodeSetParam(id, name, v) · avCodeGetParam(id, name) ·
   avCodeExamples() · avCodeExample(key) · avCodeExportText(id) · avCodeImportText(text) ·
   avCodeKinds() · avCodeKindNames() · avCodeStatus() · avCodeOnMessage(d) ·
   avCodeDownload(id) (extra: export text delivered via guarded avDeliverDownload / own anchor) ·
   window.__avCode = {version, list, status}. */
"use strict";

const AV_CODE_VERSION = "s5.0";
const AV_CODE_MAX_SRC = 65536;                       /* chars - mirrors the runtime limit */
const AV_CODE_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;     /* module id charset (the loader refuses) */
const AV_CODE_PARAM_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const AV_CODE_DB = "av-code-store";                  /* IndexedDB database */
const AV_CODE_OS = "modules";                        /* object store (keyPath: id) */
const AV_CODE_LS = "av-code-ls";                     /* localStorage fallback key */
const AV_CODE_DB_MS = 1800;                          /* hung-open cap (av_store pattern) */
const AV_CODE_REPLY_MS = 5000;                       /* umod reply budget; a timeout is honest */
const AV_CODE_POLL_MS = 900;                         /* status poll cadence while modules exist */
const AV_CODE_PERSIST_MS = 400;                      /* param-write persist debounce */

const avCodeState = {
  inited: false,
  handle: null,                    /* the live avEngineEnsure handle (node.port or .engine) */
  backend: "mem",                  /* 'idb' | 'ls' | 'mem' - the tier really in use */
  db: null,
  records: Object.create(null),    /* id -> {id,name,kind,src,params,enabled,savedAt} */
  status: Object.create(null),     /* id -> {ready,kindId,fxIndex,poisoned,on} */
  pending: Object.create(null),    /* id -> {resolve,timer} one in-flight umod op per id */
  persistTimers: Object.create(null),
  storePromise: null,
  storeLoaded: false,
  lastQuery: 0,
  pollTimer: null,
  lastError: null,
};

/* ---------- guarded environment reaches (never throw; plain node has none of these) ---------- */

function avCodeErr(e) {
  try { return String((e && (e.message || e.name)) || e || "unknown error") || "unknown error"; } catch (e2) { return "unknown error"; }
}
function avCodeLs() {
  try { if (typeof localStorage !== "undefined" && localStorage) return localStorage; } catch (e) { /* blocked */ }
  try { const w = (typeof window !== "undefined") ? window : null; if (w && w.localStorage) return w.localStorage; } catch (e) { /* blocked */ }
  return null;
}
function avCodeIdb() {
  try { if (typeof indexedDB !== "undefined" && indexedDB) return indexedDB; } catch (e) { /* none */ }
  try { const w = (typeof window !== "undefined") ? window : null; if (w && w.indexedDB) return w.indexedDB; } catch (e) { /* none */ }
  return null;
}
function avCodeTimer(fn, ms) {
  try { if (typeof setTimeout === "function") return setTimeout(fn, ms); } catch (e) { /* none */ }
  return null;
}
function avCodeClearTimer(t) {
  try { if (t != null && typeof clearTimeout === "function") clearTimeout(t); } catch (e) { /* ok */ }
}

/* ---------- IndexedDB plumbing (promise-wrapped, never throws - av_store pattern) ---------- */

function avCodeDbOpen() {
  return new Promise(function (res) {
    try {
      const st = avCodeState;
      if (st.db) return res(st.db);
      const idb = avCodeIdb();
      if (!idb) return res(null);
      let settled = false;
      const give = function (v) { if (!settled) { settled = true; res(v); } };
      const timer = avCodeTimer(function () { give(null); }, AV_CODE_DB_MS);
      const rq = idb.open(AV_CODE_DB, 1);
      rq.onupgradeneeded = function () {
        try { const db = rq.result; if (!db.objectStoreNames || !db.objectStoreNames.contains(AV_CODE_OS)) db.createObjectStore(AV_CODE_OS, { keyPath: "id" }); }
        catch (e) { /* upgrade raced */ }
      };
      rq.onsuccess = function () {
        avCodeClearTimer(timer);
        const db = rq.result;
        st.db = db;
        try { db.onclose = function () { if (avCodeState.db === db) avCodeState.db = null; }; } catch (e) { /* fine */ }
        give(db);
      };
      rq.onerror = function () { avCodeClearTimer(timer); give(null); };
      rq.onblocked = function () { avCodeClearTimer(timer); give(null); };
    } catch (e) { res(null); }
  });
}
function avCodeDbAll(db) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_CODE_OS, "readonly");
      const rq = tx.objectStore(AV_CODE_OS).getAll();
      rq.onsuccess = function () { res(rq.result || []); };
      rq.onerror = function () { res(null); };
      tx.onerror = function () { res(null); };
    } catch (e) { res(null); }
  });
}
function avCodeDbPut(db, rec) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_CODE_OS, "readwrite");
      tx.objectStore(AV_CODE_OS).put(rec);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { res(false); };
      tx.onabort = function () { res(false); };
    } catch (e) { res(false); }
  });
}
function avCodeDbDel(db, id) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_CODE_OS, "readwrite");
      tx.objectStore(AV_CODE_OS).delete(id);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { res(false); };
      tx.onabort = function () { res(false); };
    } catch (e) { res(false); }
  });
}

/* ---------- record shape (the persistence record the contract pins) ---------- */

function avCodeRecordNorm(rec) {
  try {
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) return null;
    if (typeof rec.id !== "string" || !AV_CODE_ID_RE.test(rec.id)) return null;
    if (rec.kind !== "fx" && rec.kind !== "kind") return null;
    if (typeof rec.src !== "string" || rec.src.length === 0 || rec.src.length > AV_CODE_MAX_SRC) return null;
    const params = {};
    if (rec.params && typeof rec.params === "object" && !Array.isArray(rec.params)) {
      for (const k in rec.params) {
        if (!Object.prototype.hasOwnProperty.call(rec.params, k)) continue;
        const v = rec.params[k];
        if (typeof v === "number" && isFinite(v)) params[k] = v;
      }
    }
    return {
      id: rec.id,
      name: (typeof rec.name === "string" && rec.name) ? rec.name : rec.id,
      kind: rec.kind,
      src: rec.src,
      params: params,
      enabled: rec.enabled !== false,
      savedAt: (typeof rec.savedAt === "number" && isFinite(rec.savedAt)) ? rec.savedAt : 0,
    };
  } catch (e) { return null; }
}

/* ---------- store load (LS snapshot first, the database takes over - av_store law) ---------- */

function avCodeStoreLoad() {
  const st = avCodeState;
  if (st.storePromise) return st.storePromise;
  st.storePromise = new Promise(function (resolve) {
    const out = Object.create(null);
    const lsIds = [];
    try {
      const ls = avCodeLs();
      const raw = ls ? ls.getItem(AV_CODE_LS) : null;
      if (raw != null) {
        let obj = null;
        try { obj = JSON.parse(raw); } catch (e) { obj = null; }
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          for (const k in obj) {
            if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
            const rec = avCodeRecordNorm(obj[k]);
            if (rec && rec.id === k) { out[k] = rec; lsIds.push(k); }
          }
        }
      }
    } catch (e) { /* storage blocked: memory only */ }
    avCodeDbOpen().then(function (db) {
      if (!db) {
        st.records = out;
        st.backend = lsIds.length ? "ls" : "mem";
        st.storeLoaded = true;
        resolve(st.backend);
        return;
      }
      avCodeDbAll(db).then(function (rows) {
        st.records = out;
        st.backend = "idb";
        if (Array.isArray(rows)) {
          for (let i = 0; i < rows.length; i++) {
            const rec = avCodeRecordNorm(rows[i]);
            if (!rec) continue;
            const prev = out[rec.id];
            /* for a duplicate id the SNAPSHOT is the newer copy and wins (av_store L220-223) */
            if (!prev || (prev.savedAt || 0) <= (rec.savedAt || 0)) out[rec.id] = rec;
          }
          /* write the snapshot through, then retire the key once its content is safe */
          if (lsIds.length) {
            let chain = Promise.resolve(true);
            for (let i = 0; i < lsIds.length; i++) {
              const rec = out[lsIds[i]];
              if (!rec) continue;
              chain = chain.then(function (ok) { return ok ? avCodeDbPut(db, rec) : Promise.resolve(false); });
            }
            chain.then(function (ok) {
              if (ok) { try { const l2 = avCodeLs(); if (l2) l2.removeItem(AV_CODE_LS); } catch (e) { /* keep the spare */ } }
            });
          }
        }
        st.storeLoaded = true;
        resolve(st.backend);
      });
    });
  });
  return st.storePromise;
}

/* ---------- persist (idb -> LS -> mem; quota-honest, never throws) ---------- */

function avCodeLsWrite(rec) {
  const st = avCodeState;
  try {
    const ls = avCodeLs();
    if (ls) {
      const map = {};
      for (const k in st.records) {
        if (!Object.prototype.hasOwnProperty.call(st.records, k)) continue;
        const r = st.records[k];
        if (r && r.id !== rec.id) map[k] = r;
      }
      map[rec.id] = rec;
      ls.setItem(AV_CODE_LS, JSON.stringify(map));
      if (st.backend === "mem") st.backend = "ls";
      st.lastError = null;
      return true;
    }
  } catch (e) { st.lastError = avCodeErr(e); }
  st.backend = "mem";
  return false;
}
function avCodePersistNow(rec) {
  const st = avCodeState;
  return new Promise(function (resolve) {
    try {
      const clean = avCodeRecordNorm(rec);
      if (!clean) return resolve(false);
      if (st.db) {
        avCodeDbPut(st.db, clean).then(function (ok) {
          if (ok) { st.backend = "idb"; st.lastError = null; resolve(true); return; }
          resolve(avCodeLsWrite(clean));
        });
        return;
      }
      if (st.storeLoaded && !avCodeIdb()) { resolve(avCodeLsWrite(clean)); return; }
      avCodeDbOpen().then(function (db) {
        if (db) {
          avCodeDbPut(db, clean).then(function (ok) {
            if (ok) { st.backend = "idb"; st.lastError = null; resolve(true); return; }
            resolve(avCodeLsWrite(clean));
          });
          return;
        }
        resolve(avCodeLsWrite(clean));
      });
    } catch (e) { st.lastError = avCodeErr(e); resolve(false); }
  });
}
function avCodePersistDelete(id) {
  const st = avCodeState;
  return new Promise(function (resolve) {
    try {
      const done = function (ok) {
        let lsOk = false;
        try {
          const ls = avCodeLs();
          if (ls) {
            const map = {};
            for (const k in st.records) {
              if (!Object.prototype.hasOwnProperty.call(st.records, k)) continue;
              const r = st.records[k];
              if (r && r.id !== id) map[k] = r;
            }
            ls.setItem(AV_CODE_LS, JSON.stringify(map));
            lsOk = true;
          }
        } catch (e) { /* quota/blocked */ }
        resolve(ok || lsOk);
      };
      if (st.db) { avCodeDbDel(st.db, id).then(done); return; }
      if (st.storeLoaded && !avCodeIdb()) { done(false); return; }
      avCodeDbOpen().then(function (db) { if (db) avCodeDbDel(db, id).then(done); else done(false); });
    } catch (e) { resolve(false); }
  });
}
function avCodePersistSoon(id) {
  const st = avCodeState;
  if (st.persistTimers[id] != null) return;
  const kick = function () {
    delete st.persistTimers[id];
    const rec = st.records[id];
    if (rec) { rec.savedAt = Date.now(); avCodePersistNow(rec); }
  };
  const t = avCodeTimer(kick, AV_CODE_PERSIST_MS);
  if (t == null) { kick(); return; }
  st.persistTimers[id] = t;
}

/* ---------- the mirror (avCodeList reads THIS; statuses self-refresh) ---------- */

function avCodeParamsCopy(params) {
  const out = {};
  if (params && typeof params === "object") {
    for (const k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
      const v = params[k];
      if (typeof v === "number" && isFinite(v)) out[k] = v;
    }
  }
  return out;
}

function avCodeList() {
  const st = avCodeState;
  avCodeKickRefresh(false);
  const out = [];
  for (const id in st.records) {
    if (!Object.prototype.hasOwnProperty.call(st.records, id)) continue;
    const rec = st.records[id];
    const s = st.status[id] || null;
    out.push({
      id: rec.id,
      name: rec.name,
      kind: rec.kind,
      api: 1,
      params: avCodeParamsCopy(rec.params),
      enabled: rec.enabled !== false,
      ready: !!(s && s.ready === true),
      kindId: (s && typeof s.kindId === "number") ? s.kindId : null,
      fxIndex: (s && typeof s.fxIndex === "number") ? s.fxIndex : null,
      poisoned: !!(s && s.poisoned === true),
    });
  }
  return out;
}

function avCodeStatus() {
  const st = avCodeState;
  avCodeKickRefresh(false);
  const poisoned = [];
  for (const id in st.status) {
    if (!Object.prototype.hasOwnProperty.call(st.status, id)) continue;
    if (st.status[id] && st.status[id].poisoned === true) poisoned.push(id);
  }
  let engine = null;
  if (st.handle && st.handle.ready === true) engine = st.handle.mode || st.handle.tier || null;
  return { engine: engine, count: Object.keys(st.records).length, poisoned: poisoned };
}

function avCodeKinds() {
  const st = avCodeState;
  const out = [];
  for (const id in st.records) {
    if (!Object.prototype.hasOwnProperty.call(st.records, id)) continue;
    const rec = st.records[id];
    if (rec.kind !== "kind") continue;
    const s = st.status[id];
    if (s && s.ready === true && typeof s.kindId === "number") out.push({ name: rec.id, label: rec.name, kindId: s.kindId });
  }
  return out;
}
function avCodeKindNames() {
  const kinds = avCodeKinds();
  const out = [];
  for (let i = 0; i < kinds.length; i++) out.push(kinds[i].name);
  return out;
}

/* the parent addendum: refresh the synth card's ENGINE select after kind add / kind remove /
   the end of a restore. The hook is a function declaration in av_synth.js (same bundle scope). */
function avCodeKindHook(kind) {
  if (kind !== "kind" && kind !== null) return;
  try {
    if (typeof avSynthKindOptionsRefresh === "function") avSynthKindOptionsRefresh();
  } catch (e) { /* the synth card is a nicety here */ }
}

function avCodePublish() {
  try {
    if (typeof document !== "undefined" && document && typeof document.dispatchEvent === "function" && typeof CustomEvent === "function") {
      document.dispatchEvent(new CustomEvent("av-code-change", { detail: { count: Object.keys(avCodeState.records).length } }));
    }
  } catch (e) { /* nobody listening */ }
}

/* ---------- the umod transport (worklet port OR the SPN direct call with a fake port) ---------- */

function avCodeSend(m) {
  const st = avCodeState;
  const h = st.handle;
  if (!h || h.ready !== true) return { ok: false, error: "engine unavailable - no audio engine handle yet" };
  if (h.engine) {
    let U = null;
    try { U = (typeof AVUMOD !== "undefined" && AVUMOD) ? AVUMOD : null; } catch (e) { U = null; }
    if (!U || typeof U.handle !== "function") return { ok: false, error: "module runtime (AVUMOD) missing" };
    try { U.handle(h.engine, m, { postMessage: avCodeOnMessage }); return { ok: true, via: "spn" }; }
    catch (e) { return { ok: false, error: "runtime: " + avCodeErr(e) }; }
  }
  try {
    if (!h.node || !h.node.port || typeof h.node.port.postMessage !== "function") return { ok: false, error: "engine port unavailable" };
    h.node.port.postMessage(m);
    return { ok: true, via: "worklet" };
  } catch (e) { return { ok: false, error: "port: " + avCodeErr(e) }; }
}

function avCodeWait(id) {
  const st = avCodeState;
  return new Promise(function (resolve) {
    const entry = { resolve: resolve, timer: null };
    entry.timer = avCodeTimer(function () {
      if (st.pending[id] === entry) {
        delete st.pending[id];
        resolve({ ok: false, id: id, error: "engine reply timeout (" + AV_CODE_REPLY_MS + " ms)" });
      }
    }, AV_CODE_REPLY_MS);
    st.pending[id] = entry;
  });
}
function avCodeSettle(id, status) {
  const st = avCodeState;
  const p = st.pending[id];
  if (!p) return false;
  delete st.pending[id];
  avCodeClearTimer(p.timer);
  try { p.resolve(status); } catch (e) { /* the caller's problem */ }
  return true;
}

function avCodeApplyStat(data) {
  if (!Array.isArray(data)) return;
  const st = avCodeState;
  const seen = Object.create(null);
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    if (!d || typeof d.id !== "string") continue;
    seen[d.id] = true;
    st.status[d.id] = {
      ready: true,
      kindId: (typeof d.kindId === "number") ? d.kindId : null,
      fxIndex: (typeof d.fxIndex === "number") ? d.fxIndex : null,
      poisoned: d.poisoned === true,
      on: (d.on === 0) ? 0 : 1,
    };
  }
  /* statuses not listed by the engine are stale - drop them (never while an op is in flight) */
  for (const id in st.status) {
    if (!Object.prototype.hasOwnProperty.call(st.status, id)) continue;
    if (!seen[id] && !st.pending[id]) delete st.status[id];
  }
}

function avCodeKickRefresh(force) {
  try {
    const st = avCodeState;
    if (!st.handle || st.handle.ready !== true) return;
    if (Object.keys(st.records).length === 0) return;
    const now = Date.now();
    if (force !== true && now - st.lastQuery < 350) return;
    st.lastQuery = now;
    avCodeSend({ t: "umod", act: "list" });
  } catch (e) { /* telemetry is best-effort */ }
}

function avCodeStartPoll() {
  const st = avCodeState;
  if (st.pollTimer != null) return;
  try {
    if (typeof setInterval !== "function") return;
    st.pollTimer = setInterval(function () {
      try { avCodeKickRefresh(true); } catch (e) { /* keep polling */ }
    }, AV_CODE_POLL_MS);
  } catch (e) { /* no timers */ }
}

/* the reply router - av_engine's dispatcher hands every `umod*` message here (guarded), and the
   SPN fake port hands the same shapes over synchronously. Never throws. */
function avCodeOnMessage(d) {
  try {
    if (!d || typeof d !== "object") return;
    const st = avCodeState;
    if (d.t === "umodok") {
      const id = (typeof d.id === "string") ? d.id : null;
      if (d.removed === true) {
        avCodeSettle(id, { ok: true, id: id, kind: (typeof d.kind === "string") ? d.kind : null, kindId: (typeof d.kindId === "number") ? d.kindId : null, removed: true });
        return;
      }
      const status = {
        ok: true,
        id: id,
        kind: (typeof d.kind === "string") ? d.kind : null,
        kindId: (d.kindId == null) ? null : d.kindId,
        params: avCodeParamsCopy(d.params),
      };
      if (typeof d.fxIndex === "number") status.fxIndex = d.fxIndex;
      st.status[id] = {
        ready: true,
        kindId: status.kindId,
        fxIndex: (typeof d.fxIndex === "number") ? d.fxIndex : null,
        poisoned: false,
        on: 1,
      };
      avCodeSettle(id, status);
      avCodePublish();
      return;
    }
    if (d.t === "umoderr") {
      const id = (typeof d.id === "string") ? d.id : null;
      avCodeSettle(id, { ok: false, id: id, error: String(d.error == null ? "module error" : d.error) });
      return;
    }
    if (d.t === "umodstat") {
      avCodeApplyStat(d.data);
      avCodePublish();
      return;
    }
  } catch (e) { /* a dispatcher never throws */ }
}

/* ---------- params: the canonical paths (fx -> fx.<id>.<name>; kind -> <id>.<name>) ---------- */

function avCodeParamPath(rec, name) {
  if (!rec || typeof name !== "string" || !AV_CODE_PARAM_RE.test(name)) return null;
  if (rec.kind === "fx") return "fx." + rec.id + "." + name;
  if (rec.kind === "kind") return rec.id + "." + name;
  return null;
}
function avCodeApplyParam(id, name, v, persist) {
  const st = avCodeState;
  const rec = st.records[id];
  if (!rec) return false;
  const path = avCodeParamPath(rec, name);
  if (!path) return false;
  let ok = false;
  try { if (typeof avApplyParam === "function") ok = avApplyParam(path, v) === true; } catch (e) { ok = false; }
  try { if (typeof avParams !== "undefined" && avParams) avParams[path] = v; } catch (e) { /* mirror write only */ }
  rec.params[name] = v;
  if (persist === true) avCodePersistSoon(id);
  return ok;
}
function avCodeSetParam(id, name, v) {
  return avCodeApplyParam(id, name, v, true);
}
function avCodeGetParam(id, name) {
  const rec = avCodeState.records[id];
  if (!rec || typeof name !== "string") return null;
  const v = rec.params ? rec.params[name] : null;
  return (typeof v === "number" && isFinite(v)) ? v : null;
}

/* ---------- add / remove / enable (the umod client) ---------- */

function avCodeAdd(spec) {
  const st = avCodeState;
  return new Promise(function (resolve) {
    const id = (spec && typeof spec.id === "string") ? spec.id : null;
    const kind = (spec && (spec.kind === "fx" || spec.kind === "kind")) ? spec.kind : null;
    const src = (spec && typeof spec.src === "string") ? spec.src : null;
    const name = (spec && typeof spec.name === "string" && spec.name) ? spec.name : String(id || "");
    const out = { ok: false, id: id, kind: kind };
    if (!st.handle || st.handle.ready !== true) { out.error = "engine unavailable - no audio engine handle yet"; resolve(out); return; }
    if (id === null || !AV_CODE_ID_RE.test(id)) { out.error = "id must match /^[a-z][a-z0-9_-]{0,31}$/"; resolve(out); return; }
    if (kind === null) { out.error = "kind must be 'fx' or 'kind'"; resolve(out); return; }
    if (src === null || src.length === 0) { out.error = "src must be a non-empty string"; resolve(out); return; }
    if (src.length > AV_CODE_MAX_SRC) { out.error = "src is " + src.length + " chars - the limit is 65536"; resolve(out); return; }
    if (st.pending[id]) { out.error = "an operation for this id is already pending"; resolve(out); return; }
    if (st.status[id] && st.status[id].ready === true) { out.error = "id '" + id + "' is already loaded"; resolve(out); return; }
    const wait = avCodeWait(id);                    /* registered FIRST: the SPN tier replies sync */
    const sent = avCodeSend({ t: "umod", act: "add", id: id, name: name, kind: kind, src: src });
    if (!sent.ok) avCodeSettle(id, { ok: false, id: id, kind: kind, error: sent.error });
    wait.then(function (status) {
      try {
        if (status && status.ok === true) {
          const had = st.records[id];
          if (had && had.kind === kind && had.src === src) {
            /* the SAME revision re-loading (restore / enable): keep the record, re-apply its
               saved params on top of the fresh defaults, persist the re-load */
            had.enabled = true;
            avCodePersistNow(had);
            for (const nm in had.params) {
              if (!Object.prototype.hasOwnProperty.call(had.params, nm)) continue;
              avCodeApplyParam(id, nm, had.params[nm], false);
            }
          } else {
            st.records[id] = {
              id: id, name: name, kind: kind, src: src,
              params: (status.params && typeof status.params === "object") ? avCodeParamsCopy(status.params) : {},
              enabled: !(spec && spec.enabled === false),
              savedAt: Date.now(),
            };
            avCodePersistNow(st.records[id]);
          }
          avCodeKindHook(kind);
          avCodePublish();
        }
      } catch (e) { /* record bookkeeping is best-effort; the engine status is the truth */ }
      resolve(status);
    });
  });
}

function avCodeRemove(id) {
  const st = avCodeState;
  return new Promise(function (resolve) {
    if (typeof id !== "string" || !id) { resolve({ ok: false, id: null, error: "id required" }); return; }
    const rec = st.records[id] || null;
    const s = st.status[id] || null;
    if (!rec && !s) { resolve({ ok: false, id: id, error: "unknown module id" }); return; }
    const finishLocal = function (status) {
      const kind = rec ? rec.kind : (s && s.kind === "kind" ? "kind" : null);
      delete st.records[id];
      delete st.status[id];
      avCodePersistDelete(id);
      avCodeKindHook(rec ? rec.kind : null);
      avCodePublish();
      resolve(status);
    };
    if (!st.handle || st.handle.ready !== true || !s || s.ready !== true) {
      /* not loaded in the engine (or the engine is gone): drop the record locally, honestly */
      finishLocal({ ok: true, id: id, kind: rec ? rec.kind : null, kindId: null, removed: false });
      return;
    }
    const wait = avCodeWait(id);
    const sent = avCodeSend({ t: "umod", act: "remove", id: id });
    if (!sent.ok) avCodeSettle(id, { ok: false, id: id, error: sent.error });
    wait.then(function (status) {
      if (status && status.ok !== true) {
        /* the engine did not have it loaded - the record still goes (end state is achieved) */
        finishLocal({ ok: true, id: id, kind: rec ? rec.kind : null, kindId: null, removed: false, note: String(status.error || "") });
        return;
      }
      finishLocal(status);
    });
  });
}

function avCodeEnable(id, on) {
  const st = avCodeState;
  return new Promise(function (resolve) {
    const rec = st.records[id];
    if (!rec) { resolve({ ok: false, id: id, error: "unknown module id" }); return; }
    if (on !== false) {
      rec.enabled = true;
      if (st.status[id] && st.status[id].ready === true) {
        avCodePersistNow(rec);
        resolve({ ok: true, id: id, kind: rec.kind, kindId: st.status[id].kindId, enabled: true });
        return;
      }
      avCodeAdd({ id: rec.id, name: rec.name, kind: rec.kind, src: rec.src }).then(function (status) {
        if (!status || status.ok !== true) { rec.enabled = false; avCodePersistNow(rec); }
        resolve(status);
      });
      return;
    }
    rec.enabled = false;
    avCodePersistNow(rec);
    if (!st.status[id] || st.status[id].ready !== true) {
      resolve({ ok: true, id: id, kind: rec.kind, kindId: null, enabled: false, removed: false });
      return;
    }
    const wait = avCodeWait(id);
    const sent = avCodeSend({ t: "umod", act: "remove", id: id });
    if (!sent.ok) avCodeSettle(id, { ok: false, id: id, error: sent.error });
    wait.then(function (status) {
      if (status && status.ok === true) delete st.status[id];
      avCodeKindHook(rec.kind);   /* parent addendum: a kind unload refreshes the ENGINE select */
      avCodePublish();
      resolve({ ok: true, id: id, kind: rec.kind, kindId: null, enabled: false, removed: !!(status && status.ok === true) });
    });
  });
}

/* ---------- the `.avmod` exchange format ---------- */

function avCodeExportText(id) {
  const rec = avCodeState.records[id];
  if (!rec) return null;
  try {
    return JSON.stringify({
      format: "anvil-module",
      api: 1,
      id: rec.id,
      name: rec.name,
      kind: rec.kind,
      src: rec.src,
      params: avCodeParamsCopy(rec.params),
    }, null, 2);
  } catch (e) { return null; }
}

function avCodeImportText(text) {
  return new Promise(function (resolve) {
    let obj = null;
    if (typeof text !== "string" || text.length === 0) { resolve({ ok: false, id: null, error: "empty import" }); return; }
    try { obj = JSON.parse(text); } catch (e) { resolve({ ok: false, id: null, error: "not JSON: " + avCodeErr(e) }); return; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) { resolve({ ok: false, id: null, error: "not an anvil-module file" }); return; }
    if (obj.format !== "anvil-module") { resolve({ ok: false, id: null, error: "foreign format ('" + String(obj.format) + "') - expected 'anvil-module'" }); return; }
    if (obj.api === undefined || obj.api === null) { resolve({ ok: false, id: null, error: "missing api - anvil-module files declare api 1" }); return; }
    const api = Number(obj.api);
    if (!isFinite(api) || api < 1) { resolve({ ok: false, id: null, error: "unsupported api " + String(obj.api) + " - this build speaks api 1" }); return; }
    if (api > 1) { resolve({ ok: false, id: null, error: "module api " + api + " - newer than this build (api 1)" }); return; }
    avCodeAdd({ id: obj.id, name: obj.name, kind: obj.kind, src: obj.src }).then(function (status) {
      try {
        if (status && status.ok === true && obj.params && typeof obj.params === "object") {
          const rec = avCodeState.records[status.id];
          if (rec) {
            for (const nm in obj.params) {
              if (!Object.prototype.hasOwnProperty.call(obj.params, nm)) continue;
              const v = obj.params[nm];
              if (typeof v === "number" && isFinite(v)) avCodeApplyParam(status.id, nm, v, false);
            }
            avCodePersistNow(rec);
          }
        }
      } catch (e) { /* params are best-effort on import */ }
      resolve(status);
    });
  });
}

function avCodeUtf8(s) {
  try { if (typeof TextEncoder === "function") return new TextEncoder().encode(String(s)); } catch (e) { /* manual */ }
  const out = [];
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }
    else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
      const c2 = str.charCodeAt(i + 1);
      if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
        const cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        i++;
      } else { out.push(0xEF, 0xBF, 0xBD); }
    } else { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
  }
  return new Uint8Array(out);
}

/* the honest own-anchor fallback of the house download pattern */
function avCodeAnchor(bytes, name) {
  try {
    if (typeof document === "undefined" || !document || typeof document.createElement !== "function") return false;
    if (typeof Blob === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    try { a.rel = "noopener"; } catch (e) { /* attribute refused */ }
    const body = document.body;
    let attached = false;
    if (body && typeof body.appendChild === "function") { try { body.appendChild(a); attached = true; } catch (e) { attached = false; } }
    try { a.click(); } catch (e) { /* click never throws outward here */ }
    if (attached && body && typeof body.removeChild === "function") { try { body.removeChild(a); } catch (e) { /* ok */ } }
    try { if (typeof setTimeout === "function") setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { /* ok */ } }, 8000); } catch (e) { /* ok */ }
    return true;
  } catch (e) { return false; }
}

/* the .avmod export delivered: avDeliverDownload when present (guard), else a plain anchor */
function avCodeDownload(id) {
  try {
    const rec = avCodeState.records[id];
    const text = avCodeExportText(id);
    if (!rec || text == null) return false;
    const bytes = avCodeUtf8(text);
    const fname = "avmod-" + rec.id + ".avmod";
    let dl = null;
    try { if (typeof avDeliverDownload === "function") dl = avDeliverDownload; } catch (e) { dl = null; }
    if (!dl) { try { if (typeof window !== "undefined" && window && typeof window.avDeliverDownload === "function") dl = window.avDeliverDownload; } catch (e) { dl = null; } }
    if (dl) { try { if (dl(bytes, fname) === true) return true; } catch (e) { /* fall through to the anchor */ } }
    return avCodeAnchor(bytes, fname);
  } catch (e) { return false; }
}

/* ---------- boot: init -> restore (after the engine is ready) ---------- */

function avCodeRestore(h) {
  const st = avCodeState;
  st.handle = (h && h.ready === true) ? h : null;
  avCodeStartPoll();
  return avCodeStoreLoad().then(function () {
    const ids = Object.keys(st.records);
    let restored = 0, failed = 0;
    let chain = Promise.resolve();
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      chain = chain.then(function () {
        const rec = st.records[id];
        if (!rec || rec.enabled !== true) return;
        if (st.status[id] && st.status[id].ready === true) return;   /* already live */
        if (!st.handle) return;
        return avCodeAdd({ id: rec.id, name: rec.name, kind: rec.kind, src: rec.src }).then(function (status) {
          if (status && status.ok === true) restored++;
          else failed++;
        });
      });
    }
    return chain.then(function () {
      avCodeKindHook(null);            /* parent addendum: refresh the ENGINE select once */
      avCodeKickRefresh(true);
      avCodePublish();
      try {
        if (typeof window !== "undefined" && window) window.__avCode = { version: AV_CODE_VERSION, list: avCodeList, status: avCodeStatus };
      } catch (e) { /* no window */ }
      return { ok: true, restored: restored, failed: failed, engine: st.handle ? (st.handle.mode || st.handle.tier || null) : null };
    });
  });
}

function avCodeInit() {
  const st = avCodeState;
  if (st.inited) return true;
  st.inited = true;
  try { if (typeof window !== "undefined" && window) window.__avCode = { version: AV_CODE_VERSION, list: avCodeList, status: avCodeStatus }; } catch (e) { /* no window */ }
  avCodeStoreLoad().then(function () { avCodePublish(); });
  try {
    if (typeof avEngineEnsure === "function") {
      Promise.resolve(avEngineEnsure()).then(function (h) { return avCodeRestore(h); })
        .catch(function () { /* engine failed - status stays honest */ });
    }
  } catch (e) { /* engine module absent */ }
  return true;
}

/* ---------- the three shipped example modules (own-authored, MIT, contract-correct) ---------- */

const AV_CODE_EXAMPLE_TREMOLO = `/* tremolo - a sine-LFO amplitude modulator (anvil CODE example, api 1, fx).
   WET convention: write st.oL / st.oR; the engine blends dry*(1-mix) + wet*mix.
   MIT - use it as the starting point for your own fx modules. */
return {
  api: 1,
  id: "tremolo",
  name: "Tremolo",
  kind: "fx",
  params: [
    { name: "rate",  min: 0.05, max: 20, def: 4,   step: 0.01, label: "Rate (Hz)" },
    { name: "depth", min: 0,    max: 1,  def: 0.6, step: 0.01, label: "Depth" },
    { name: "mix",   min: 0,    max: 1,  def: 1,   step: 0.01, label: "Mix" },
    { name: "on",    min: 0,    max: 1,  def: 1,   step: 1,    label: "On" }
  ],
  createState: function (cfg) {
    return {
      sr: cfg.sampleRate, phase: 0, step: 4 / cfg.sampleRate,
      rate: 4, depth: 0.6, mix: 1, on: 1, oL: 0, oR: 0
    };
  },
  setParam: function (st, path, value) {
    var name = path.slice(path.lastIndexOf(".") + 1);
    var v = Number(value);
    if (!isFinite(v)) return false;
    if (name === "rate") { st.rate = API.clamp(v, 0.05, 20); st.step = st.rate / st.sr; return true; }
    if (name === "depth") { st.depth = API.clamp(v, 0, 1); return true; }
    if (name === "mix") { st.mix = API.clamp(v, 0, 1); return true; }
    if (name === "on") { st.on = v > 0.5 ? 1 : 0; return true; }
    return false;
  },
  process: function (st, inL, inR) {
    var ph = st.phase + st.step;
    while (ph >= 1) ph -= 1;
    st.phase = ph;
    var g = 1 - st.depth * (0.5 - 0.5 * Math.cos(ph * API.TAU));
    st.oL = inL * g;
    st.oR = inR * g;
  }
};
`;

const AV_CODE_EXAMPLE_BITCRUSH = `/* bitcrush - downsample-and-hold plus amplitude quantization (anvil CODE example, api 1, fx).
   WET convention: write st.oL / st.oR. MIT. */
function crush(st, x) {
  var i = Math.floor((x + 1) * 0.5 * st.levels);
  if (i < 0) i = 0; else if (i > st.levels - 1) i = st.levels - 1;
  return i / (st.levels - 1) * 2 - 1;
}
return {
  api: 1,
  id: "bitcrush",
  name: "Bitcrush",
  kind: "fx",
  params: [
    { name: "bits", min: 1, max: 16, def: 8, step: 1,     label: "Bits" },
    { name: "rate", min: 1, max: 64, def: 4, step: 1,     label: "Downsample (x)" },
    { name: "mix",  min: 0, max: 1,  def: 1, step: 0.01,  label: "Mix" },
    { name: "on",   min: 0, max: 1,  def: 1, step: 1,     label: "On" }
  ],
  createState: function (cfg) {
    return {
      sr: cfg.sampleRate, bits: 8, levels: 256, hold: 4, count: 0,
      hL: 0, hR: 0, mix: 1, on: 1, oL: 0, oR: 0
    };
  },
  setParam: function (st, path, value) {
    var name = path.slice(path.lastIndexOf(".") + 1);
    var v = Number(value);
    if (!isFinite(v)) return false;
    if (name === "bits") { st.bits = Math.round(API.clamp(v, 1, 16)); st.levels = Math.pow(2, st.bits); return true; }
    if (name === "rate") { st.hold = Math.round(API.clamp(v, 1, 64)); return true; }
    if (name === "mix") { st.mix = API.clamp(v, 0, 1); return true; }
    if (name === "on") { st.on = v > 0.5 ? 1 : 0; return true; }
    return false;
  },
  process: function (st, inL, inR) {
    st.count += 1;
    if (st.count >= st.hold) {
      st.count = 0;
      st.hL = crush(st, inL);
      st.hR = crush(st, inR);
    }
    st.oL = st.hL;
    st.oR = st.hR;
  }
};
`;

const AV_CODE_EXAMPLE_FOLD = `/* fold - a wavefolded sine voice (anvil CODE example, api 1, kind).
   Kind modules own osc + envelope; stepVoice returns ONE base-rate sample and the engine
   multiplies it by v.vel * v.fade. Voice fields live on the shared v.k object (created in
   initVoiceK, reset per note in initVoice). MIT. */
function fold4(x) {
  var p = x % 4;
  if (p < 0) p += 4;
  if (p < 1) return p;
  if (p < 3) return 2 - p;
  return p - 4;
}
var Z = { fdFold: 0.35, fdAttack: 0.005, fdRelease: 0.4, fdLevel: 0.8 };
return {
  api: 1,
  id: "fold",
  name: "Fold",
  kind: "kind",
  params: [
    { name: "fold",    min: 0,     max: 1, def: 0.35,  step: 0.01,  label: "Fold" },
    { name: "attack",  min: 0.001, max: 2, def: 0.005, step: 0.001, label: "Attack (s)" },
    { name: "release", min: 0.005, max: 4, def: 0.4,   step: 0.001, label: "Release (s)" },
    { name: "level",   min: 0,     max: 1, def: 0.8,   step: 0.01,  label: "Level" }
  ],
  initEngineK: function (kext) {
    kext.fdFold = 0.35;
    kext.fdAttack = 0.005;
    kext.fdRelease = 0.4;
    kext.fdLevel = 0.8;
  },
  initVoiceK: function (k) {
    k.fdPhase = 0;
    k.fdEnv = 0;
    k.fdAstep = 0.01;
    k.fdRc = 0.99;
    k.fdInc = 440 / 48000;
  },
  initVoice: function (eng, v) {
    var k = v.k;
    k.fdPhase = 0;
    k.fdEnv = 0;
    var kx = eng.kext || Z;
    var sr = (typeof eng.sr === "number" && eng.sr > 0) ? eng.sr : 48000;
    k.fdAstep = 1 / (Math.max(0.001, kx.fdAttack) * sr);
    k.fdRc = Math.exp(-4.6 / (Math.max(0.005, kx.fdRelease) * sr));
    k.fdInc = 440 * Math.pow(2, ((v.pitch || 60) + (eng.bend || 0) + (eng.tune || 0) - 69) / 12) / sr;
  },
  stepVoice: function (eng, v) {
    var k = v.k;
    var kx = eng.kext || Z;
    if (v.state === 2) k.fdEnv *= k.fdRc;
    else if (k.fdEnv < 1) k.fdEnv += k.fdAstep;
    if (k.fdEnv < 1e-5) k.fdEnv = 0;
    var ph = k.fdPhase + k.fdInc;
    while (ph >= 1) ph -= 1;
    k.fdPhase = ph;
    var drive = 1 + 9 * kx.fdFold;
    return fold4(Math.sin(ph * API.TAU) * drive) * k.fdEnv * kx.fdLevel;
  },
  releaseVoice: function (eng, v) {
    void eng; void v;   /* the release stage is driven by v.state === 2 in stepVoice */
  },
  isVoiceDone: function (eng, v) {
    void eng;
    return v.state === 2 && v.k.fdEnv <= 0;
  },
  setParam: function (eng, path, value) {
    var kext = eng.kext;
    if (!kext) return false;
    var name = path.slice(path.lastIndexOf(".") + 1);
    var v = Number(value);
    if (!isFinite(v)) return false;
    if (name === "fold") { kext.fdFold = API.clamp(v, 0, 1); return true; }
    if (name === "attack") { kext.fdAttack = API.clamp(v, 0.001, 2); return true; }
    if (name === "release") { kext.fdRelease = API.clamp(v, 0.005, 4); return true; }
    if (name === "level") { kext.fdLevel = API.clamp(v, 0, 1); return true; }
    return false;
  }
};
`;

const AV_CODE_EXAMPLES = [
  { key: "tremolo", name: "Tremolo", kind: "fx", src: AV_CODE_EXAMPLE_TREMOLO },
  { key: "bitcrush", name: "Bitcrush", kind: "fx", src: AV_CODE_EXAMPLE_BITCRUSH },
  { key: "fold", name: "Fold", kind: "kind", src: AV_CODE_EXAMPLE_FOLD },
];

function avCodeExamples() {
  const out = [];
  for (let i = 0; i < AV_CODE_EXAMPLES.length; i++) {
    out.push({ key: AV_CODE_EXAMPLES[i].key, name: AV_CODE_EXAMPLES[i].name, kind: AV_CODE_EXAMPLES[i].kind, src: AV_CODE_EXAMPLES[i].src });
  }
  return out;
}
function avCodeExample(key) {
  for (let i = 0; i < AV_CODE_EXAMPLES.length; i++) {
    if (AV_CODE_EXAMPLES[i].key === key) return AV_CODE_EXAMPLES[i].src;
  }
  return null;
}
