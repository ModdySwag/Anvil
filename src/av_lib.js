/* av_lib.js - Anvil SAMPLE PACKS: the LOCAL sample library. The ONE durable home for
   user-imported sample-pack content (audio + MIDI patterns; R15c adds EXS24 kits and
   ADG/ALS/SerumPreset reference packs). Everything here is local: nothing in this module
   touches the network, ever.

   Pins (verify/_r15b_wave.md section 4.4; receipt/record shapes are the section 2 shared spec,
   kept VERBATIM):

     AV_LIB_VERSION = "r15b.0"     AV_LIB_DB = "av-samples-store"   (IDB name)
     AV_LIB_DB_VER = 1             AV_LIB_OS = "items"              (object store, keyPath "id")
     AV_LIB_LS = "av-samples-ls"   AV_LIB_ITEM_MAX = 96 MiB         (per-item ceiling)
     AV_LIB_OPEN_CAP_MS = 1800     (a hung IDB open gives up fast; one late adoption follows)

     avLibInit() -> bool                idempotent; starts the async hydrate (list cache for
                                        status); safe when IDB is unavailable
     avLibAddItem(item) -> Promise      {ok, id, backend, error?} - normalize + persist one
                                        import item; skips items with result != "imported".
                                        Bytes come in on item.bytes (ArrayBuffer | typed view |
                                        Blob-like), an optional second ArrayBuffer argument, or
                                        item.file / item.arrayBuffer(); missing bytes -> honest
                                        "no bytes" refusal (id stays "")
     avLibList() -> Promise             {ok, backend, count, bytes, items:[{id, name, kind,
                                        format, size, at, meta}]} - newest first, NO raw bytes
     avLibGet(id) -> Promise            {ok, item?, error?} - the full record incl. bytes
     avLibRemove(id) -> Promise         {ok, error?} - durable drop first; a removal made while
                                        no DB connection is up is honoured at adoption
     avLibLoad(id) -> Promise           {ok, id, kind, entryId?, pattern?, error?} - never rejects
     avLibStatus() -> {}                sync snapshot: {version, inited, hydrated, backend,
                                        count, bytes, dbName, error, note}
     window.__avLib                     facade {version, status, list, get, load, remove, add}

   Record shape: { id, v: 1, name, kind, format, size, at, meta, bytes (ArrayBuffer), via }
     id = "l" + Date.now().toString(36) + "-" + slug(name); slug [a-z0-9-], cap 40.
     kind = "sample" | "pattern" | "kit" | "refs" (R15c). via = the backend the record was
     actually written through.

   Backends "idb" | "ls" | "mem" (always reportable). IndexedDB is the durable home; no
   IndexedDB -> the av-samples-ls localStorage map (records ride base64; a record over
   1.5 MiB is REFUSED there with the reason "too large for the localStorage fallback"); no
   storage at all -> "mem" (session only, an honest note in status). Tier fallback happens on
   unavailability, never on quota: an IDB write failure answers "quota" / "idb:<Name>" and
   never silently downgrades; only a missing/blocked DB falls through to localStorage.

   avLibLoad routes samples BY FORMAT:
     wav / mp3  -> bytes -> new File([bytes], name) -> avSampleImportFiles([file]) (it owns the
                   session cap accounting and the native decode); the resulting session entry
                   id is found by diffing avSampleStore.entries ids before vs after.
     aiff       -> AVAIFF.decode(bytes)
     rex2       -> AVRex.decode(bytes)      (sibling modules; guarded per call - may land late)
                   for aiff/rex2 the AudioBuffer is built page-side via avSampleStore.pickCtx()
                   + createBuffer + copyToChannel, behind the session-cap guard
                   (entries.length + pending >= max -> honest "session sample cap reached"),
                   then avSampleStore.makeEntry(name, buf) + avSampleStore.add(entry); the
                   receipt entryId is the entry that was just added.
                   R16: the decoded slice table rides on that entry as entry.rexSlices (cap 64;
                   the receipt gains additive slices). A wav probes avWavInfo first: an
                   IEEE-float 64-bit header takes this route via avWavDecodeF64 (guarded; absent
                   -> a pinned pending line); every other wav and all mp3 stay native.
     Patterns   -> avMidParse -> avMidToPattern -> avSeqLoad -> avSeqSnap -> avSeqSetPattern
                   (avSeqLoad alone only updates the core model; the scheduler needs the
                   explicit set - mirroring av_bank.js avBankSeqApply) -> avSeqUiSync (repaint
                   nicety) -> avUndoPush("seq", "import") (push AFTER load). Receipt pattern =
                   {name, bpm, notes} summary.
     kit (R15c) -> resolve each meta.samples name (basename, case-insensitive) against the
                   LIBRARY list at LOAD time; load the first 4 distinct resolved samples
                   through the sample routes above; avSampleSendToEngine(entryId, slot i) for
                   slots 0..3; build the zone v2 F64(144) table (s0/s1 fractions clamped to
                   the decoded length); avEngineZones(zones) then avApplyParam("engine.kind",
                   "sampler") (both guarded). Fewer than 1 resolved sample -> ok:false
                   "no resolvable samples" and the engine is NEVER touched. Receipt
                   {ok, slots, zones, skipped, error?}.
     refs (R15c) -> re-return the persisted meta, NO session change: receipt {ok:true, refs,
                   notes?, pattern?, meta} so the UI can offer the seq action for ALS items
                   (the seq application itself stays the ONE avMid flow, driven from
                   meta.pattern by its caller).

   Every cross-module call is typeof-guarded PER CALL. Never throws: every public entry point
   resolves a receipt / returns a sane value; try/catch wraps every reach. Promise plumbing
   mirrors av_store.js L293-361: promise-wrapped IDB, an open cap that gives up after
   AV_LIB_OPEN_CAP_MS, ONE late adoption attempt, db.onclose resets the cached handle.
   Hydrate: the localStorage snapshot paints first, then the database takes over - for a
   duplicate id the SNAPSHOT wins (it was written by a session that could not reach the DB),
   it is written through, and the LS key retires once its content is safe.

   Laws kept: "use strict"; DOM-free top level (parse-safe); ASCII-only; ONE avLib* /
   AV_LIB_* family of top-level names; no randomness; no network. */

"use strict";

/* ---------- pins (section 4.4; names frozen) ---------- */

const AV_LIB_VERSION = "r15b.0";
const AV_LIB_DB = "av-samples-store";        /* pinned IDB name */
const AV_LIB_DB_VER = 1;
const AV_LIB_OS = "items";                   /* object store, keyPath "id" */
const AV_LIB_LS = "av-samples-ls";           /* localStorage fallback key */
const AV_LIB_ITEM_MAX = 96 * 1024 * 1024;    /* 96 MiB per item (section 2 bundle law) */
const AV_LIB_OPEN_CAP_MS = 1800;             /* hung-open give-up (mirrors av_store) */
const AV_LIB_ADOPT_MS = 4000;                /* delay of the ONE late adoption attempt */
const AV_LIB_LS_MAX_BYTES = 1.5 * 1024 * 1024;   /* LS tier refuses items over 1.5 MiB */
const AV_LIB_LS_B64_MAX = Math.ceil((AV_LIB_LS_MAX_BYTES * 4) / 3) + 64;
/* R15c: the meta cap must hold kit/refs metas (16 zones + 512 refs + a 4x64 pattern) - the
   R15b flat-probe 4 KiB cap would drop them whole */
const AV_LIB_META_MAX = 256 * 1024;
const AV_LIB_ID_RE = /^l[a-z0-9-]{0,63}$/;   /* "l" + time36 + "-" + slug(40) */
const AV_LIB_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/* R16 section 4.3: the rex2 slice stash (entry.rexSlices) is capped here; beyond it the
   receipt carries an honest warning (the chop side consumes at most 16 zones anyway) */
const AV_LIB_REX_SLICE_MAX = 64;

/* ---------- state (the in-memory view the UI renders from) ---------- */

const avLibState = {
  inited: false,
  hydrated: false,
  hydratePromise: null,
  backend: "mem",              /* "idb" | "ls" | "mem" - kept honest, promoted never demoted */
  db: null,
  dbGaveUp: false,
  adoptTried: false,
  adoptTimer: null,
  items: {},                   /* id -> meta view {id,v,name,kind,format,size,at,meta} (no bytes) */
  bytes: 0,                    /* running sum of item sizes over items{} */
  lsMirror: {},                /* id -> LS payload (bytes base64) - LS-tier live copy */
  memMap: {},                  /* id -> full record (session memory tier) */
  droppedNoDb: new Set(),      /* ids removed while no DB connection was up */
  seq: 0,                      /* id-collision counter */
  lastAdopt: null,
  lastError: null,
};

/* ---------- guarded environment reaches (never throw; plain node has none of these) ---------- */

function avLibLs() {
  try { if (typeof localStorage !== "undefined" && localStorage) return localStorage; } catch (e) { /* blocked */ }
  try { const w = (typeof window !== "undefined") ? window : null; if (w && w.localStorage) return w.localStorage; } catch (e) { /* blocked */ }
  return null;
}

function avLibIdb() {
  try { if (typeof indexedDB !== "undefined" && indexedDB) return indexedDB; } catch (e) { /* none */ }
  try { const w = (typeof window !== "undefined") ? window : null; if (w && w.indexedDB) return w.indexedDB; } catch (e) { /* none */ }
  return null;
}

function avLibTimer(fn, ms) {
  try { if (typeof setTimeout === "function") return setTimeout(fn, ms); } catch (e) { /* no timers */ }
  return null;
}

function avLibClear(t) {
  try { if (t != null && typeof clearTimeout === "function") clearTimeout(t); } catch (e) { /* no timers */ }
}

/* ---------- tiny value laws (garbage in, sane value out) ---------- */

function avLibErrName(e) { try { return (e && e.name) ? String(e.name) : ""; } catch (e2) { return ""; } }
function avLibErrMsg(e) { try { const s = (e && e.message) ? String(e.message) : String(e); return s.slice(0, 120); } catch (e2) { return "error"; } }

function avLibStr(v, dflt, cap) {
  try {
    if (typeof v !== "string") return dflt;
    const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, cap || 80);
    return s || dflt;
  } catch (e) { return dflt; }
}

function avLibNum(v, dflt, lo, hi) {
  try {
    const n = Number(v);
    if (!isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  } catch (e) { return dflt; }
}

/* lowercase token: [a-z0-9] only (format ids, via vocabulary) */
function avLibToken(v, dflt, cap) {
  try {
    if (typeof v !== "string") return dflt;
    const s = v.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, cap || 12);
    return s || dflt;
  } catch (e) { return dflt; }
}

/* JSON-safe meta copy (flat probe objects; R15c kit/refs metas ride the AV_LIB_META_MAX
   bound; circular input -> {}) */
function avLibMetaNorm(m) {
  try {
    if (!m || typeof m !== "object") return {};
    const s = JSON.stringify(m);
    if (!s || s.length > AV_LIB_META_MAX) return {};
    const o = JSON.parse(s);
    return (o && typeof o === "object" && !Array.isArray(o)) ? o : {};
  } catch (e) { return {}; }
}

/* ---------- ids, record views, payload codecs ---------- */

function avLibSlug(name) {
  try {
    const s = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return s || "item";
  } catch (e) { return "item"; }
}

function avLibMakeId(name) {
  const st = avLibState;
  const base = "l" + Date.now().toString(36) + "-" + avLibSlug(name);
  let id = base;
  try {
    while (st.items[id] || st.lsMirror[id] || st.memMap[id]) {
      st.seq += 1;
      id = base + "-" + st.seq;
      if (st.seq > 100000) break;
    }
  } catch (e) { /* base id stands */ }
  return id;
}

/* the record kind vocabulary: sample | pattern | kit | refs ("" = not persistable) */
function avLibKindNorm(v) {
  try {
    if (v === "sample" || v === "pattern" || v === "kit" || v === "refs") return v;
  } catch (e) { /* none */ }
  return "";
}

/* the list-facing view of a record: exactly {id, v, name, kind, format, size, at, meta} */
function avLibMetaView(rec) {
  return {
    id: rec.id, v: 1,
    name: avLibStr(rec.name, rec.id, 120),
    kind: (rec.kind === "pattern") ? "pattern" : avLibKindNorm(rec.kind) || "sample",
    format: avLibToken(rec.format, "", 12),
    size: avLibNum(rec.size, 0, 0, AV_LIB_ITEM_MAX * 8),
    at: avLibNum(rec.at, 0, 0, 9e15),
    meta: avLibMetaNorm(rec.meta),
  };
}

/* a full stored record -> normalized record (bytes only when needBytes; never throws) */
function avLibRecNorm(rec, needBytes) {
  try {
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) return null;
    const id = (typeof rec.id === "string") ? rec.id : "";
    if (!AV_LIB_ID_RE.test(id)) return null;
    let bytes = rec.bytes;
    if (bytes && typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(bytes)) {
      bytes = avLibExactBuf(bytes);
    }
    const isBuf = (typeof ArrayBuffer !== "undefined") && (bytes instanceof ArrayBuffer);
    if (needBytes && (!isBuf || !bytes.byteLength)) return null;
    return {
      id: id, v: 1,
      name: avLibStr(rec.name, id, 120),
      kind: (rec.kind === "pattern") ? "pattern" : avLibKindNorm(rec.kind) || "sample",
      format: avLibToken(rec.format, "", 12),
      size: avLibNum(rec.size, 0, 0, AV_LIB_ITEM_MAX * 8),
      at: avLibNum(rec.at, 0, 0, 9e15),
      meta: avLibMetaNorm(rec.meta),
      bytes: needBytes ? bytes : undefined,
      via: avLibToken(rec.via, "", 8),
    };
  } catch (e) { return null; }
}

/* the LS JSON payload for a record (bytes ride base64) */
function avLibLsPayload(rec, b64) {
  return {
    id: rec.id, v: 1,
    name: rec.name, kind: rec.kind, format: rec.format,
    size: rec.size, at: rec.at, meta: rec.meta,
    via: "ls", bytes: b64,
  };
}

/* an LS payload -> meta view (no decode) */
function avLibPayloadView(pay) {
  try {
    if (!pay || typeof pay !== "object") return null;
    const id = (typeof pay.id === "string") ? pay.id : "";
    if (!AV_LIB_ID_RE.test(id)) return null;
    return {
      id: id, v: 1,
      name: avLibStr(pay.name, id, 120),
      kind: avLibKindNorm(pay.kind) || "sample",
      format: avLibToken(pay.format, "", 12),
      size: avLibNum(pay.size, 0, 0, AV_LIB_ITEM_MAX * 8),
      at: avLibNum(pay.at, 0, 0, 9e15),
      meta: avLibMetaNorm(pay.meta),
    };
  } catch (e) { return null; }
}

/* an LS payload -> full record with a decoded ArrayBuffer (null when undecodable) */
function avLibPayloadRec(pay) {
  try {
    if (!pay || typeof pay !== "object") return null;
    const id = (typeof pay.id === "string") ? pay.id : "";
    if (!AV_LIB_ID_RE.test(id)) return null;
    const b64 = (typeof pay.bytes === "string") ? pay.bytes : "";
    if (!b64 || b64.length > AV_LIB_LS_B64_MAX) return null;
    const u8 = avLibB64Dec(b64);
    if (!u8 || !u8.length) return null;
    const ab = avLibExactBuf(u8);
    if (!ab) return null;
    const rec = avLibRecNorm(pay, false);
    if (!rec) return null;
    rec.bytes = ab;
    rec.size = ab.byteLength;    /* the decoded bytes are the honest size */
    rec.via = "ls";
    return rec;
  } catch (e) { return null; }
}

/* an exact-length ArrayBuffer for a byte view (null on failure) */
function avLibExactBuf(u8) {
  try {
    if (!u8 || typeof u8.byteLength !== "number") return null;
    if (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength) return u8.buffer;
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  } catch (e) { return null; }
}

/* the import item (section 2 shape) -> the record fields this module persists.
   result != "imported" items are SKIPPED (null); only sample/pattern/kit/refs kinds are
   material. */
function avLibItemNorm(item) {
  try {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    if (item.result !== "imported") return null;
    const kind = avLibKindNorm(item.kind);
    if (!kind) return null;
    return {
      name: avLibStr(item.name, "item", 120),
      kind: kind,
      format: avLibToken(item.format, "", 12),
      meta: avLibMetaNorm(item.meta),
    };
  } catch (e) { return null; }
}

/* the full file bytes for an add: item.bytes (ArrayBuffer | typed view | Blob-like), an
   optional second ArrayBuffer argument, item.file (Blob-like), or item.arrayBuffer(). */
async function avLibBytesNorm(item, bytesArg) {
  try {
    let b = bytesArg;
    if (!b && item && typeof item === "object") b = item.bytes;
    if (b) {
      if (typeof ArrayBuffer !== "undefined" && b instanceof ArrayBuffer) return b;
      if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(b)) return avLibExactBuf(b);
      if (typeof b === "object" && typeof b.arrayBuffer === "function") {
        const ab = await b.arrayBuffer();
        return (ab instanceof ArrayBuffer) ? ab : null;
      }
    }
    if (item && typeof item === "object") {
      const f = item.file;
      if (f && typeof f === "object" && typeof f.arrayBuffer === "function") {
        const ab2 = await f.arrayBuffer();
        return (ab2 instanceof ArrayBuffer) ? ab2 : null;
      }
      if (typeof item.arrayBuffer === "function") {
        const ab3 = await item.arrayBuffer();
        return (ab3 instanceof ArrayBuffer) ? ab3 : null;
      }
    }
    return null;
  } catch (e) { return null; }
}

/* ---------- base64 (works with or without atob/btoa; manual fallbacks) ---------- */

let avLibB64Map = null;

function avLibB64EncManual(u8) {
  const T = AV_LIB_B64;
  let out = "";
  let i = 0;
  for (; i + 2 < u8.length; i += 3) {
    const n = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
    out += T.charAt((n >> 18) & 63) + T.charAt((n >> 12) & 63) + T.charAt((n >> 6) & 63) + T.charAt(n & 63);
  }
  const rem = u8.length - i;
  if (rem === 1) {
    const n1 = u8[i] << 16;
    out += T.charAt((n1 >> 18) & 63) + T.charAt((n1 >> 12) & 63) + "==";
  } else if (rem === 2) {
    const n2 = (u8[i] << 16) | (u8[i + 1] << 8);
    out += T.charAt((n2 >> 18) & 63) + T.charAt((n2 >> 12) & 63) + T.charAt((n2 >> 6) & 63) + "=";
  }
  return out;
}

function avLibB64DecManual(s) {
  let m = avLibB64Map;
  if (!m) {
    m = {};
    for (let i = 0; i < AV_LIB_B64.length; i++) m[AV_LIB_B64.charAt(i)] = i;
    avLibB64Map = m;
  }
  let len = s.length;
  while (len > 0 && s.charAt(len - 1) === "=") len -= 1;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < len; i++) {
    const v = m[s.charAt(i)];
    if (v === undefined) return null;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o] = (buf >> bits) & 255;
      o += 1;
      buf &= (1 << bits) - 1;
    }
  }
  return (o === out.length) ? out : out.subarray(0, o);
}

function avLibB64Enc(buf) {
  try {
    const u8 = new Uint8Array(buf);
    try {
      if (typeof btoa === "function") {
        let s = "";
        for (let i = 0; i < u8.length; i += 0x8000) {
          s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + 0x8000, u8.length)));
        }
        return btoa(s);
      }
    } catch (e) { /* fall to the manual encoder */ }
    return avLibB64EncManual(u8);
  } catch (e) { return null; }
}

function avLibB64Dec(str) {
  try {
    if (typeof str !== "string" || !str) return null;
    try {
      if (typeof atob === "function") {
        const bin = atob(str);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i) & 255;
        return u8;
      }
    } catch (e) { /* fall to the manual decoder */ }
    return avLibB64DecManual(str);
  } catch (e) { return null; }
}

/* ---------- IndexedDB plumbing (promise-wrapped, never throws - av_store.js L293-361) ---------- */

function avLibDbOpen() {
  return new Promise(function (res) {
    try {
      const st = avLibState;
      if (st.db) return res(st.db);
      if (st.dbGaveUp) return res(null);
      const idb = avLibIdb();
      if (!idb) return res(null);
      let settled = false;
      const give = function (v) { if (!settled) { settled = true; res(v); } };
      /* a hung open (blocked upgrade in another tab) must not wedge the library: give up after
         AV_LIB_OPEN_CAP_MS - the boot stays fast and honest, and one late attempt adopts */
      const timer = avLibTimer(function () { st.dbGaveUp = true; give(null); avLibAdoptSoon(); }, AV_LIB_OPEN_CAP_MS);
      const rq = idb.open(AV_LIB_DB, AV_LIB_DB_VER);
      rq.onupgradeneeded = function () {
        try { const db = rq.result; if (!db.objectStoreNames || !db.objectStoreNames.contains(AV_LIB_OS)) db.createObjectStore(AV_LIB_OS, { keyPath: "id" }); }
        catch (e) { /* upgrade raced */ }
      };
      rq.onsuccess = function () {
        avLibClear(timer);
        if (st.dbGaveUp) { try { rq.result.close(); } catch (e) { /* ignore */ } return give(null); }
        const db = rq.result;
        st.db = db;
        try { db.onclose = function () { if (avLibState.db === db) avLibState.db = null; }; } catch (e) { /* fine */ }
        give(db);
      };
      rq.onerror = function () { avLibClear(timer); give(null); };
      rq.onblocked = function () { avLibClear(timer); give(null); };
    } catch (e) { res(null); }
  });
}

function avLibDbAll(db) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_LIB_OS, "readonly");
      const rq = tx.objectStore(AV_LIB_OS).getAll();
      rq.onsuccess = function () { res(rq.result || []); };
      rq.onerror = function () { res(null); };
      tx.onerror = function () { res(null); };
    } catch (e) { res(null); }
  });
}

function avLibDbGet(db, id) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_LIB_OS, "readonly");
      const rq = tx.objectStore(AV_LIB_OS).get(id);
      rq.onsuccess = function () { res(rq.result || null); };
      rq.onerror = function () { res(null); };
      tx.onerror = function () { res(null); };
    } catch (e) { res(null); }
  });
}

function avLibDbWrite(db, rec) {
  return new Promise(function (res, rej) {
    try {
      const tx = db.transaction(AV_LIB_OS, "readwrite");
      tx.objectStore(AV_LIB_OS).put(rec);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { rej((tx.error) || new Error("idb write failed")); };
      tx.onabort = function () { rej((tx.error) || new Error("idb write aborted")); };
    } catch (e) { rej(e); }
  });
}

function avLibDbRemove(db, id) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_LIB_OS, "readwrite");
      tx.objectStore(AV_LIB_OS).delete(id);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { res(false); };
      tx.onabort = function () { res(false); };
    } catch (e) { res(false); }
  });
}

/* ---------- localStorage plumbing (the av-samples-ls snapshot map) ---------- */

/* read + validate the snapshot: id -> payload (base64 validated, no decode here) */
function avLibLsLoad() {
  const out = {};
  try {
    const ls = avLibLs();
    if (!ls) return out;
    const raw = ls.getItem(AV_LIB_LS);
    if (raw == null) return out;
    let obj = null;
    try { obj = JSON.parse(raw); } catch (e) { obj = null; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const pay = obj[k];
      if (!AV_LIB_ID_RE.test(k)) continue;
      if (!pay || typeof pay !== "object" || Array.isArray(pay)) continue;
      if (typeof pay.bytes !== "string" || !pay.bytes || pay.bytes.length > AV_LIB_LS_B64_MAX) continue;
      out[k] = pay;
    }
  } catch (e) { /* storage blocked: memory only */ }
  return out;
}

/* write the whole snapshot map back (empty map -> retire the key). true on success. */
function avLibLsWriteMap(map) {
  try {
    const ls = avLibLs();
    if (!ls) return false;
    const ids = Object.keys(map);
    if (!ids.length) { ls.removeItem(AV_LIB_LS); return true; }
    ls.setItem(AV_LIB_LS, JSON.stringify(map));
    return true;
  } catch (e) { return false; }
}

/* ---------- hydrate + the ONE late adoption ---------- */

function avLibHydrate() {
  const st = avLibState;
  if (st.hydratePromise) return st.hydratePromise;
  try {
    st.hydratePromise = avLibHydrateRun().catch(function (e) {
      st.lastError = "hydrate:" + avLibErrMsg(e);
      st.hydrated = true;
      return st.backend;
    });
    return st.hydratePromise;
  } catch (e) {
    st.hydrated = true;
    return Promise.resolve(st.backend);
  }
}

/* idempotent readiness: every public entry point awaits this once per session */
function avLibReady() {
  try { return Promise.resolve(avLibHydrate()); } catch (e) { return Promise.resolve(avLibState.backend); }
}

async function avLibHydrateRun() {
  const st = avLibState;
  if (st.hydrated) return st.backend;
  /* 1) the localStorage snapshot paints first (a session that could not reach the DB wrote it) */
  const lsMap = avLibLsLoad();
  st.lsMirror = lsMap;
  const lsIds = Object.keys(lsMap);
  const lsViews = {};
  for (let i = 0; i < lsIds.length; i++) {
    const v = avLibPayloadView(lsMap[lsIds[i]]);
    if (v) lsViews[v.id] = v;
  }
  st.items = {};
  const viewIds = Object.keys(lsViews);
  for (let i = 0; i < viewIds.length; i++) st.items[viewIds[i]] = lsViews[viewIds[i]];
  avLibRecount();
  /* 2) the database takes over */
  const db = await avLibDbOpen();
  if (db) {
    const recs = await avLibDbAll(db);
    if (recs === null) {
      st.backend = (lsIds.length) ? "ls" : "mem";      /* read blew up: stay on the snapshot */
    } else {
      st.backend = "idb";
      const fromDb = {};
      for (let i = 0; i < recs.length; i++) {
        const norm = avLibRecNorm(recs[i], false);
        if (norm) fromDb[norm.id] = avLibMetaView(norm);
      }
      /* for a duplicate id the SNAPSHOT wins (it is the newer copy) - PF-style merge law */
      st.items = Object.assign({}, fromDb, lsViews);
      /* write EVERY snapshot record through, then retire the key once its content is safe */
      let want = 0, imported = 0;
      for (let i = 0; i < lsIds.length; i++) {
        const rec = avLibPayloadRec(lsMap[lsIds[i]]);
        want += 1;
        if (!rec) continue;
        rec.via = "idb";
        try { await avLibDbWrite(db, rec); imported += 1; } catch (e) { /* best-effort import */ }
      }
      if (want && imported === want) {
        try { const l2 = avLibLs(); if (l2) l2.removeItem(AV_LIB_LS); st.lsMirror = {}; } catch (e) { /* keep the spare copy */ }
      }
      avLibRecount();
    }
  } else {
    st.backend = (lsIds.length) ? "ls" : "mem";
  }
  st.hydrated = true;
  return st.backend;
}

function avLibAdoptSoon() {
  const st = avLibState;
  if (st.adoptTried || st.adoptTimer) return;
  try { st.adoptTimer = avLibTimer(function () { st.adoptTimer = null; avLibAdopt(); }, AV_LIB_ADOPT_MS); }
  catch (e) { /* no timers (hatched test shells): the manual retry still exists */ }
}

function avLibAdopt(force) {
  try { return Promise.resolve(avLibAdoptRun(!!force)).catch(function () { return avLibState.backend; }); }
  catch (e) { return Promise.resolve(avLibState.backend); }
}

async function avLibAdoptRun(force) {
  const st = avLibState;
  if (st.hydratePromise && !st.hydrated) { try { await st.hydratePromise; } catch (e) { /* proceed */ } }
  if (st.db) return st.backend;                       /* already durable */
  if (!force && st.adoptTried) return st.backend;     /* once per session */
  st.adoptTried = true;
  st.dbGaveUp = false;                                /* forgive the boot timeout, this once */
  const db = await avLibDbOpen();
  if (!db) return st.backend;                         /* still slow: stay honest, stay volatile */
  st.backend = "idb";
  const recs = await avLibDbAll(db);
  const fromDb = {};
  const list = recs || [];
  for (let i = 0; i < list.length; i++) {
    const norm = avLibRecNorm(list[i], false);
    if (norm) fromDb[norm.id] = avLibMetaView(norm);
  }
  /* a removal made while no DB connection was up is the user's word - honour it now */
  let honoured = 0;
  st.droppedNoDb.forEach(function (id) {
    if (!(id in fromDb)) return;
    delete fromDb[id];
    try { avLibDbRemove(db, id); honoured += 1; } catch (e) { /* the merge below still wins */ }
  });
  st.droppedNoDb = new Set();
  /* session-held records join the list; the session's copy wins (it is the one that is live) */
  const merged = Object.assign({}, fromDb);
  const lsIds = Object.keys(st.lsMirror);
  for (let i = 0; i < lsIds.length; i++) {
    const v = avLibPayloadView(st.lsMirror[lsIds[i]]);
    if (v) merged[v.id] = v;
  }
  const memIds = Object.keys(st.memMap);
  for (let i = 0; i < memIds.length; i++) merged[memIds[i]] = avLibMetaView(st.memMap[memIds[i]]);
  /* every record the session holds outside the database lands in it now */
  const have = new Set(Object.keys(fromDb));
  let landed = 0, failed = 0;
  const mergedIds = Object.keys(merged);
  for (let i = 0; i < mergedIds.length; i++) {
    const id = mergedIds[i];
    if (have.has(id)) continue;
    let rec = null;
    if (st.memMap[id]) rec = st.memMap[id];
    else if (st.lsMirror[id]) rec = avLibPayloadRec(st.lsMirror[id]);
    if (!rec) continue;
    rec.via = "idb";
    try { await avLibDbWrite(db, rec); landed += 1; } catch (e) { failed += 1; }
  }
  if (!failed) {
    try { const ls = avLibLs(); if (ls) ls.removeItem(AV_LIB_LS); st.lsMirror = {}; } catch (e) { /* keep the spare copy */ }
  }
  st.items = merged;
  avLibRecount();
  st.hydrated = true;
  st.lastAdopt = {
    adopted: Object.keys(merged).length - Object.keys(fromDb).length,
    landed: landed, failed: failed, honoured: honoured, at: Date.now(),
  };
  st.lastError = null;
  return st.backend;
}

/* ---------- cache + commit (tier choice: idb -> ls -> mem; quota never downgrades) ---------- */

function avLibRecount() {
  try {
    const st = avLibState;
    let n = 0, b = 0;
    const ids = Object.keys(st.items);
    for (let i = 0; i < ids.length; i++) {
      const it = st.items[ids[i]];
      if (!it) continue;
      n += 1;
      b += avLibNum(it.size, 0, 0, 1e15);
    }
    st.bytes = b;
    return n;
  } catch (e) { return 0; }
}

function avLibCacheDrop(id) {
  try {
    const st = avLibState;
    if (st.items[id]) { delete st.items[id]; avLibRecount(); }
  } catch (e) { /* the cache is a view */ }
}

/* persist one normalized record; resolves {ok, backend, error?} - never throws */
async function avLibCommit(rec) {
  const st = avLibState;
  /* 1) the durable home */
  const db = await avLibDbOpen();
  if (db) {
    try {
      rec.via = "idb";
      await avLibDbWrite(db, rec);
      st.backend = "idb";
      st.lastError = null;
      return { ok: true, backend: "idb" };
    } catch (e) {
      const name = avLibErrName(e);
      /* a closed connection (tab churn) may heal on the NEXT call; a quota will not - say which */
      if (name === "InvalidStateError" || name === "TransactionInactiveError") {
        st.db = null;
        try { await avLibDbOpen(); } catch (e2) { /* stays null */ }
      }
      const out = { ok: false, backend: "idb", error: (name === "QuotaExceededError") ? "quota" : ("idb:" + (name || "error")) };
      st.lastError = out.error;
      return out;
    }
  }
  /* 2) no IndexedDB: the localStorage path (base64; refuses items over 1.5 MiB) */
  const ls = avLibLs();
  if (ls) {
    const n = (rec.bytes && isFinite(rec.bytes.byteLength)) ? rec.bytes.byteLength : avLibNum(rec.size, 0, 0, 1e15);
    if (n > AV_LIB_LS_MAX_BYTES) {
      st.lastError = "too large for the localStorage fallback";
      return { ok: false, backend: "ls", error: "too large for the localStorage fallback" };
    }
    const b64 = avLibB64Enc(rec.bytes);
    if (b64 && b64.length <= AV_LIB_LS_B64_MAX) {
      const map = Object.assign({}, st.lsMirror);
      map[rec.id] = avLibLsPayload(rec, b64);
      try {
        ls.setItem(AV_LIB_LS, JSON.stringify(map));
        st.lsMirror = map;
        if (st.backend === "mem") st.backend = "ls";   /* the tier really is in use now */
        rec.via = "ls";
        st.lastError = null;
        return { ok: true, backend: "ls" };
      } catch (e) {
        if (avLibErrName(e) === "QuotaExceededError") {
          st.lastError = "quota";
          return { ok: false, backend: "ls", error: "quota" };
        }
        /* storage fully unavailable: fall to memory for this session */
      }
    }
  }
  /* 3) memory - volatile, and the receipt says so */
  rec.via = "mem";
  st.memMap[rec.id] = rec;
  st.lastError = null;
  return { ok: true, backend: "mem", volatile: true };
}

/* ---------- add ---------- */

async function avLibAddItemRun(item, bytesArg) {
  const st = avLibState;
  await avLibReady();
  const it = avLibItemNorm(item);
  if (!it) return { ok: false, id: "", backend: st.backend, error: "not imported" };
  const buf = await avLibBytesNorm(item, bytesArg);
  if (!buf) return { ok: false, id: "", backend: st.backend, error: "no bytes" };
  if (buf.byteLength > AV_LIB_ITEM_MAX) return { ok: false, id: "", backend: st.backend, error: "too large - 96 MB cap" };
  const id = avLibMakeId(it.name);
  const rec = {
    id: id, v: 1, name: it.name, kind: it.kind, format: it.format,
    size: buf.byteLength, at: Date.now(), meta: it.meta, bytes: buf, via: "",
  };
  const out = await avLibCommit(rec);
  if (out && out.ok === true) {
    st.items[id] = avLibMetaView(rec);
    avLibRecount();
    return { ok: true, id: id, backend: out.backend };
  }
  return {
    ok: false, id: "", backend: (out && out.backend) ? out.backend : st.backend,
    error: (out && out.error) ? out.error : "write failed",
  };
}

/* ---------- list + get + remove ---------- */

async function avLibListRun() {
  const st = avLibState;
  await avLibReady();
  const out = [];
  const ids = Object.keys(st.items);
  for (let i = 0; i < ids.length; i++) {
    const it = st.items[ids[i]];
    if (!it) continue;
    out.push({
      id: it.id, name: it.name, kind: it.kind, format: it.format,
      size: it.size, at: it.at, meta: avLibMetaNorm(it.meta),
    });
  }
  out.sort(function (a, b) { return (b.at - a.at) || (a.id < b.id ? 1 : (a.id > b.id ? -1 : 0)); });
  let bytes = 0;
  for (let i = 0; i < out.length; i++) bytes += avLibNum(out[i].size, 0, 0, 1e15);
  return { ok: true, backend: st.backend, count: out.length, bytes: bytes, items: out };
}

/* full record incl. bytes: db first, then the LS mirror, then the memory tier */
async function avLibGetRecRun(id) {
  const st = avLibState;
  await avLibReady();
  if (typeof id !== "string" || !AV_LIB_ID_RE.test(id)) return { ok: false, error: "no item" };
  if (st.db) {
    const raw = await avLibDbGet(st.db, id);
    if (raw) {
      const norm = avLibRecNorm(raw, true);
      if (norm) return { ok: true, item: norm };
    }
  }
  const pay = st.lsMirror[id];
  if (pay) {
    const rec = avLibPayloadRec(pay);
    if (rec) return { ok: true, item: rec };
  }
  const mem = st.memMap[id];
  if (mem) {
    const norm2 = avLibRecNorm(mem, true);
    if (norm2) { norm2.via = "mem"; return { ok: true, item: norm2 }; }
  }
  return { ok: false, error: "no item" };
}

async function avLibRemoveRun(id) {
  const st = avLibState;
  await avLibReady();
  if (typeof id !== "string" || !id || !AV_LIB_ID_RE.test(id)) return { ok: false, id: String(id == null ? "" : id), error: "no item" };
  let removed = false;
  let stuck = false;
  /* the memory tier */
  if (st.memMap[id]) { delete st.memMap[id]; removed = true; }
  /* the LS mirror (payload map + the stored JSON; empty map retires the key) */
  if (st.lsMirror[id]) {
    const map = Object.assign({}, st.lsMirror);
    delete map[id];
    if (avLibLsWriteMap(map)) { st.lsMirror = map; removed = true; }
    else stuck = true;
  }
  /* the durable home */
  if (st.db) {
    try { if (await avLibDbRemove(st.db, id)) removed = true; } catch (e) { stuck = true; }
  } else if (st.items[id]) {
    st.droppedNoDb.add(id);        /* no DB connection: honour the removal at adoption */
    removed = true;
  }
  if (removed) { avLibCacheDrop(id); st.lastError = null; return { ok: true, id: id }; }
  if (stuck) { st.lastError = "removal refused"; return { ok: false, id: id, error: "removal refused" }; }
  return { ok: false, id: id, error: "no item" };
}

/* ---------- load routes (sample by format; pattern via the seq core; R15c kit + refs) ---------- */

/* the session sample module (global first, then the __avSample facade) - null when absent */
function avLibSampleStore() {
  try { if (typeof avSampleStore !== "undefined" && avSampleStore && Array.isArray(avSampleStore.entries)) return avSampleStore; } catch (e) { /* not injected */ }
  try {
    const w = (typeof window !== "undefined") ? window : null;
    const s = w ? w.__avSample : null;
    if (s && Array.isArray(s.entries)) return s;
  } catch (e) { /* no window */ }
  return null;
}

/* entries.length + pending against max (the session cap guard for the clean-room path) */
function avLibSessionFull(store) {
  try {
    if (!store) return true;
    const n = Number(store.entries ? store.entries.length : 0);
    const p = Number(store.pending) || 0;
    const m = Number(store.max);
    if (!isFinite(n) || !isFinite(m) || m <= 0) return false;
    return (n + p) >= m;
  } catch (e) { return false; }
}

async function avLibLoadRun(id) {
  await avLibReady();
  const g = await avLibGetRecRun(id);
  if (!g || g.ok !== true || !g.item) {
    return { ok: false, id: (typeof id === "string") ? id : "", kind: "", error: (g && g.error) ? String(g.error) : "no item" };
  }
  const rec = g.item;
  if (rec.kind === "pattern") return avLibLoadPattern(rec);
  if (rec.kind === "sample") return avLibLoadSample(rec);
  if (rec.kind === "kit") return avLibLoadKit(rec);      /* R15c: EXS24 kits */
  if (rec.kind === "refs") return avLibLoadRefs(rec);    /* R15c: ALS / Serum refs */
  return { ok: false, id: rec.id, kind: "", error: "unknown kind" };
}

async function avLibLoadSample(rec) {
  const fmt = rec.format;
  /* R16 section 4.3: a wav probes first - an IEEE-float 64-bit header takes the clean-room
     f64 route; every other wav (and an unreadable header) stays native like mp3 */
  if (fmt === "wav") {
    let info = null;
    try { if (typeof avWavInfo === "function") info = avWavInfo(rec.bytes); } catch (e) { info = null; }
    if (info && info.ok === true && info.float === true && info.bits === 64) return avLibLoadWavF64(rec);
    return avLibLoadNative(rec);
  }
  if (fmt === "mp3") return avLibLoadNative(rec);
  if (fmt === "aiff") return avLibLoadCleanRoom(rec, "aiff");
  if (fmt === "rex2") return avLibLoadCleanRoom(rec, "rex2");
  return { ok: false, id: rec.id, kind: "sample", error: "format " + (fmt || "?") + " is not loadable as audio" };
}

/* wav / mp3: bytes -> File -> avSampleImportFiles([file]) (it owns cap accounting + native
   decode); the new session entry id comes from diffing the entries-id set before vs after. */
async function avLibLoadNative(rec) {
  const store = avLibSampleStore();
  if (!store) return { ok: false, id: rec.id, kind: "sample", error: "no sample module" };
  if (typeof avSampleImportFiles !== "function") return { ok: false, id: rec.id, kind: "sample", error: "no sample module" };
  let file = null;
  try {
    const name = avLibStr(rec.name, "sample", 120);
    const type = (rec.format === "wav") ? "audio/wav" : "audio/mpeg";
    if (typeof File === "function") file = new File([rec.bytes], name, { type: type });
    else if (typeof Blob === "function") file = new Blob([rec.bytes], { type: type });
  } catch (e) { file = null; }
  if (!file) return { ok: false, id: rec.id, kind: "sample", error: "no File support" };
  const before = {};
  try { for (let i = 0; i < store.entries.length; i++) { const en = store.entries[i]; if (en && en.id) before[en.id] = 1; } } catch (e) { /* diff degrades honestly below */ }
  let r = null;
  try { r = await avSampleImportFiles([file]); } catch (e) { return { ok: false, id: rec.id, kind: "sample", error: avLibErrMsg(e) }; }
  let entryId = "";
  try {
    for (let i = 0; i < store.entries.length; i++) {
      const en = store.entries[i];
      if (en && en.id && !before[en.id]) { entryId = en.id; break; }
    }
  } catch (e) { entryId = ""; }
  if (!entryId) {
    const why = (r && r.errors && r.errors.length) ? String(r.errors[0]) : "import failed";
    return { ok: false, id: rec.id, kind: "sample", error: why };
  }
  return { ok: true, id: rec.id, kind: "sample", entryId: entryId };
}

/* aiff / rex2: clean-room decode -> the shared clean-room tail (page-side AudioBuffer behind
   the session-cap guard, makeEntry + add; entryId is that entry). R16: rex2 also stashes the
   decoded slice table on the entry as entry.rexSlices (cap 64; the receipt gains slices). */
async function avLibLoadCleanRoom(rec, tag) {
  let dec = null;
  try {
    if (tag === "aiff") {
      if (typeof AVAIFF !== "undefined" && AVAIFF && typeof AVAIFF.decode === "function") dec = AVAIFF;
    } else {
      if (typeof AVRex !== "undefined" && AVRex && typeof AVRex.decode === "function") dec = AVRex;
    }
  } catch (e) { dec = null; }
  if (!dec) return { ok: false, id: rec.id, kind: "sample", error: tag + " decoder pending (this build)" };
  let res = null;
  try { res = dec.decode(rec.bytes); } catch (e) { return { ok: false, id: rec.id, kind: "sample", error: avLibErrMsg(e) }; }
  if (!res || res.ok !== true) {
    return { ok: false, id: rec.id, kind: "sample", error: (res && res.error) ? String(res.error) : (tag + " decode failed") };
  }
  const ch1 = (res.ch1 && typeof res.ch1.length === "number") ? res.ch1 : null;
  if (!ch1 || !ch1.length) return { ok: false, id: rec.id, kind: "sample", error: "decode produced no audio" };
  const ch2 = (res.ch2 && typeof res.ch2.length === "number" && res.ch2.length > 0) ? res.ch2 : null;
  const rate = Number((tag === "aiff") ? res.sampleRate : res.rate);
  if (!isFinite(rate) || rate <= 0) return { ok: false, id: rec.id, kind: "sample", error: "bad sample rate" };
  /* R16 section 4.3: rex2 only - the decoded slice table rides onto the new session entry */
  const stash = (tag === "rex2") ? avLibRexStash(res) : null;
  return avLibCleanRoomTail(rec, ch1, ch2, rate, stash);
}

/* R16 section 4.3: the shared clean-room tail - the page-side AudioBuffer (pickCtx +
   createBuffer + copyToChannel) behind the session-cap guard, then makeEntry + add; entryId is
   the entry that was just added. The optional `stash` (rex2, from avLibRexStash) lands on the
   entry BEFORE add (the store keeps the reference) and is re-applied on store.byId[entryId]
   after add when the store cloned the object on insert. Receipt { ok, id, kind, entryId } plus
   the additive { slices, warning? } for rex2. Never throws. */
function avLibCleanRoomTail(rec, ch1, ch2, rate, stash) {
  const frames = ch1.length;
  const channels = ch2 ? 2 : 1;
  const store = avLibSampleStore();
  if (!store) return { ok: false, id: rec.id, kind: "sample", error: "no sample module" };
  /* the session cap guard: entries length plus pending against max */
  if (avLibSessionFull(store)) return { ok: false, id: rec.id, kind: "sample", error: "session sample cap reached" };
  let ctx = null;
  try { if (typeof store.pickCtx === "function") ctx = store.pickCtx(); } catch (e) { ctx = null; }
  if (!ctx || typeof ctx.createBuffer !== "function") return { ok: false, id: rec.id, kind: "sample", error: "no AudioContext" };
  let buf = null;
  try { buf = ctx.createBuffer(channels, frames, rate); } catch (e) { buf = null; }
  if (!buf) return { ok: false, id: rec.id, kind: "sample", error: "createBuffer failed" };
  let copied = false;
  try {
    if (typeof buf.copyToChannel === "function") {
      buf.copyToChannel(ch1, 0);
      if (ch2) buf.copyToChannel(ch2, 1);
      copied = true;
    } else if (typeof buf.getChannelData === "function") {
      buf.getChannelData(0).set(ch1);
      if (ch2) buf.getChannelData(1).set(ch2);
      copied = true;
    }
  } catch (e) { copied = false; }
  if (!copied) return { ok: false, id: rec.id, kind: "sample", error: "buffer copy failed" };
  if (typeof store.makeEntry !== "function" || typeof store.add !== "function") {
    return { ok: false, id: rec.id, kind: "sample", error: "no sample module" };
  }
  let entry = null;
  try { entry = store.makeEntry(avLibStr(rec.name, "sample", 120), buf); } catch (e) { entry = null; }
  if (!entry) return { ok: false, id: rec.id, kind: "sample", error: "no sample module" };
  /* R16: the rex2 slice table lands on the entry BEFORE add (the store keeps the reference) */
  if (stash) {
    try { entry.rexSlices = stash.slices; } catch (e) { /* additive stash only */ }
  }
  let added = null;
  try { added = store.add(entry); } catch (e) { added = null; }
  const entryId = (typeof added === "string" && added) ? added : "";
  if (!entryId) return { ok: false, id: rec.id, kind: "sample", error: "session add failed" };
  if (stash) {
    /* a store that CLONED the entry on insert gets the stash re-applied here */
    try {
      const inStore = (store.byId && store.byId[entryId]) ? store.byId[entryId] : null;
      if (inStore && inStore !== entry && typeof inStore === "object") inStore.rexSlices = stash.slices;
    } catch (e) { /* additive stash only */ }
  }
  const out = { ok: true, id: rec.id, kind: "sample", entryId: entryId };
  if (stash) {
    out.slices = stash.slices.length;
    if (stash.warning) out.warning = stash.warning;
  }
  return out;
}

/* R16 section 4.3: the rex2 slice stash for the new session entry - sanitized { start, len }
   number pairs from the decode, capped at AV_LIB_REX_SLICE_MAX (the overflow rides out as the
   receipt's warning). Null when the decode carried no usable table. Never throws. */
function avLibRexStash(res) {
  try {
    const src = (res && Array.isArray(res.slices)) ? res.slices : null;
    if (!src || !src.length) return null;
    const slices = [];
    let total = 0;
    for (let i = 0; i < src.length; i++) {
      const s = src[i];
      if (!s || typeof s !== "object") continue;
      const start = Number(s.start);
      const len = Number(s.len);
      if (!isFinite(start) || !isFinite(len)) continue;
      total += 1;
      if (slices.length < AV_LIB_REX_SLICE_MAX) slices.push({ start: start, len: len });
    }
    if (!slices.length) return null;
    const capped = total - slices.length;
    return {
      slices: slices,
      total: total,
      warning: capped > 0 ? ("slice cap " + AV_LIB_REX_SLICE_MAX + " reached - extra rex2 slices ignored (" + total + " decoded)") : "",
    };
  } catch (e) { return null; }
}

/* R16 section 4.3: the f64-WAV load route - avLibLoadSample probed avWavInfo as { float: true,
   bits: 64 }; decode via the sibling avWavDecodeF64 (guarded - absent in an older build -> the
   pinned pending line) and build the page-side AudioBuffer through the SAME clean-room tail as
   aiff/rex2 (cap-guarded, entryId from the store). Never throws. */
async function avLibLoadWavF64(rec) {
  let dec = null;
  try { if (typeof avWavDecodeF64 === "function") dec = avWavDecodeF64; } catch (e) { dec = null; }
  if (!dec) return { ok: false, id: rec.id, kind: "sample", error: "f64 wav decoder pending (this build)" };
  let res = null;
  try { res = dec(rec.bytes); } catch (e) { return { ok: false, id: rec.id, kind: "sample", error: avLibErrMsg(e) }; }
  if (!res || res.ok !== true) {
    return { ok: false, id: rec.id, kind: "sample", error: (res && res.error) ? String(res.error) : "f64 wav decode failed" };
  }
  const ch1 = (res.ch1 && typeof res.ch1.length === "number") ? res.ch1 : null;
  if (!ch1 || !ch1.length) return { ok: false, id: rec.id, kind: "sample", error: "decode produced no audio" };
  const ch2 = (res.ch2 && typeof res.ch2.length === "number" && res.ch2.length > 0) ? res.ch2 : null;
  const rate = Number(res.sampleRate);
  if (!isFinite(rate) || rate <= 0) return { ok: false, id: rec.id, kind: "sample", error: "bad sample rate" };
  return avLibCleanRoomTail(rec, ch1, ch2, rate, null);
}

/* patterns: avMidParse -> avMidToPattern -> avSeqLoad -> avSeqSnap -> avSeqSetPattern ->
   avSeqUiSync (nicety) -> avUndoPush("seq", "import") (the undo law: push AFTER load). */
async function avLibLoadPattern(rec) {
  if (typeof avMidParse !== "function" || typeof avMidToPattern !== "function") {
    return { ok: false, id: rec.id, kind: "pattern", error: "no midi module" };
  }
  let parsed = null;
  try { parsed = avMidParse(rec.bytes); } catch (e) { return { ok: false, id: rec.id, kind: "pattern", error: avLibErrMsg(e) }; }
  if (!parsed || parsed.ok !== true) {
    return { ok: false, id: rec.id, kind: "pattern", error: (parsed && parsed.error) ? String(parsed.error) : "midi parse failed" };
  }
  let mapped = null;
  try { mapped = avMidToPattern(parsed, { name: avLibStr(rec.name, "pattern", 120) }); } catch (e) { mapped = null; }
  if (!mapped || mapped.ok !== true || !mapped.pattern) {
    return { ok: false, id: rec.id, kind: "pattern", error: (mapped && mapped.error) ? String(mapped.error) : "pattern mapping failed" };
  }
  const pat = mapped.pattern;
  if (typeof avSeqLoad !== "function" || typeof avSeqSetPattern !== "function") {
    return { ok: false, id: rec.id, kind: "pattern", error: "no sequence module" };
  }
  let loaded = false;
  try { loaded = avSeqLoad(pat) === true; } catch (e) { loaded = false; }
  if (!loaded) return { ok: false, id: rec.id, kind: "pattern", error: "avSeqLoad refused" };
  /* feed the scheduler the core's own sanitised snapshot (avSeqLoad alone only updates the
     core model - the explicit set is what the scheduler hears); the raw pattern is the fallback */
  let feed = pat;
  try { if (typeof avSeqSnap === "function") { const s = avSeqSnap(); if (s && typeof s === "object") feed = s; } } catch (e) { /* raw pattern stands */ }
  let setOk = false;
  try { setOk = avSeqSetPattern(feed) !== false; } catch (e) { setOk = false; }
  if (!setOk) return { ok: false, id: rec.id, kind: "pattern", error: "avSeqSetPattern refused" };
  try { if (typeof avSeqUiSync === "function") avSeqUiSync(); } catch (e) { /* repaint is a nicety */ }
  try { if (typeof avUndoPush === "function") avUndoPush("seq", "import"); } catch (e) { /* undo is a nicety */ }
  return { ok: true, id: rec.id, kind: "pattern", pattern: avLibPatternSummary(feed, rec) };
}

/* ---------- R15c load routes: kits (EXS24) + refs (ALS / Serum) ---------- */

/* the lowercase basename of a name (kit sample matching: basename, case-insensitive) */
function avLibBaseLower(s) {
  try {
    const t = String(s == null ? "" : s);
    const parts = t.split(/[\\/]+/);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i]) return parts[i].toLowerCase().replace(/[\u0000-\u001f\u007f]/g, "");
    }
  } catch (e) { /* none */ }
  return "";
}

/* the decoded frame count of a just-loaded session entry (0 = unknown) */
function avLibKitFrames(entryId, slot) {
  try {
    const store = avLibSampleStore();
    if (store) {
      try {
        const e = (store.byId && store.byId[entryId]) ? store.byId[entryId] : null;
        if (e && e.buffer && isFinite(e.buffer.length) && e.buffer.length > 0) return e.buffer.length;
      } catch (e2) { /* try the sent record */ }
      try {
        const s = (Array.isArray(store.sent) && store.sent[slot]) ? store.sent[slot] : null;
        if (s && isFinite(s.frames) && s.frames > 0) return s.frames;
      } catch (e3) { /* unknown length */ }
    }
  } catch (e) { /* unknown */ }
  return 0;
}

/* the kit route (section 3): resolve each meta.samples name (basename, case-insensitive)
   against the LIBRARY list at LOAD time; load the first 4 distinct resolved samples through
   the existing sample routes; send them to engine slots 0..3; build the zone v2 F64(144)
   table (buf = the resolved sample's slot; s0/s1 fractions clamped to the decoded length) and
   push it via avEngineZones; then set engine.kind = "sampler" through the ONE funnel. Zones
   whose sample did not resolve (or beyond the 4-slot cap) are dropped and counted. Fewer than
   1 resolved sample -> ok:false "no resolvable samples" and the engine is NEVER touched.
   Receipt { ok, slots, zones, skipped, error? }. */
async function avLibLoadKit(rec) {
  const out = { ok: false, id: rec.id, kind: "kit", slots: 0, zones: 0, skipped: 0 };
  try {
    const meta = (rec.meta && typeof rec.meta === "object") ? rec.meta : {};
    const mSamples = Array.isArray(meta.samples) ? meta.samples : [];
    const mZones = Array.isArray(meta.zones) ? meta.zones : [];
    const listR = await avLibListRun();
    const list = (listR && listR.ok === true && Array.isArray(listR.items)) ? listR.items : [];
    const chosen = [];
    const chosenIds = {};
    for (let i = 0; i < mSamples.length && chosen.length < 4; i++) {
      const nm = avLibBaseLower(mSamples[i] && mSamples[i].name);
      if (!nm) continue;
      let hit = null;
      for (let j = 0; j < list.length; j++) {
        const it = list[j];
        if (!it || it.kind !== "sample" || chosenIds[it.id]) continue;
        if (avLibBaseLower(it.name) === nm) { hit = it; break; }
      }
      if (!hit) continue;
      chosenIds[hit.id] = 1;
      chosen.push(hit);
    }
    if (!chosen.length) { out.error = "no resolvable samples"; return out; }
    /* load + send: slot i for the i-th chosen sample (engine slots 0..3) */
    const slots = new Array(chosen.length);
    const frames = new Array(chosen.length);
    for (let i = 0; i < chosen.length; i++) {
      slots[i] = null;
      frames[i] = 0;
      let full = null;
      try { full = await avLibGetRecRun(chosen[i].id); } catch (e) { full = null; }
      if (!full || full.ok !== true || !full.item) continue;
      let loaded = null;
      try { loaded = await avLibLoadSample(full.item); } catch (e) { loaded = null; }
      if (!loaded || loaded.ok !== true || typeof loaded.entryId !== "string" || !loaded.entryId) continue;
      let sent = false;
      try {
        if (typeof avSampleSendToEngine === "function") sent = (await avSampleSendToEngine(loaded.entryId, i)) === true;
      } catch (e) { sent = false; }
      if (sent !== true) continue;
      slots[i] = i;
      frames[i] = avLibKitFrames(loaded.entryId, i);
    }
    let used = 0;
    for (let i = 0; i < slots.length; i++) if (slots[i] !== null) used += 1;
    out.slots = used;
    if (used < 1) { out.error = "samples could not be loaded"; return out; }
    /* zone v2 table: 16 zones x [lo, hi, root, buf, vol, s0, s1, fIn, fOut]; missing fades 0 */
    const table = new Float64Array(144);
    let zi = 0, skipped = 0;
    for (let z = 0; z < mZones.length; z++) {
      const zn = (mZones[z] && typeof mZones[z] === "object") ? mZones[z] : null;
      const refI = zn ? Math.round(avLibNum(zn.buf, -1, -1, 0xFFFFFFFF)) : -1;
      const slot = (refI >= 0 && refI < slots.length && slots[refI] !== null) ? slots[refI] : null;
      if (!zn || slot === null || zi >= 16) { skipped += 1; continue; }
      const o = zi * 9;
      const lo = avLibNum(zn.lo, 0, 0, 127);
      let hi = avLibNum(zn.hi, lo, 0, 127);
      if (hi < lo) hi = lo;
      table[o + 0] = lo;
      table[o + 1] = hi;
      table[o + 2] = avLibNum(zn.root, 60, 0, 127);
      table[o + 3] = slot;
      table[o + 4] = avLibNum(zn.vol, 0.8, 0, 24);
      const n = frames[refI] || 0;
      let s0f = 0, s1f = 1;
      if (n > 0) {
        s0f = avLibNum(zn.s0, 0, 0, 0xFFFFFFFF) / n;      /* frames -> fraction */
        s1f = avLibNum(zn.s1, 0, 0, 0xFFFFFFFF) / n;
        if (!isFinite(s0f) || s0f < 0) s0f = 0;
        if (s0f > 1) s0f = 1;                             /* clamped to the decoded length */
        if (!isFinite(s1f) || s1f < 0) s1f = 0;
        if (s1f > 1) s1f = 1;
        if (!(s1f > s0f)) s1f = Math.min(1, s0f + 1 / n);
      }
      if (!(s1f > s0f)) s1f = 1;
      table[o + 5] = s0f;
      table[o + 6] = s1f;
      table[o + 7] = avLibNum(zn.fIn, 0, 0, 2);
      table[o + 8] = avLibNum(zn.fOut, 0, 0, 2);
      zi += 1;
    }
    out.zones = zi;
    out.skipped = skipped;
    try { if (typeof avEngineZones === "function") avEngineZones(table); } catch (e) { /* best-effort */ }
    try { if (typeof avApplyParam === "function") avApplyParam("engine.kind", "sampler"); } catch (e) { /* funnel optional */ }
    out.ok = true;
    return out;
  } catch (e) {
    out.ok = false;
    out.error = avLibErrMsg(e);
    return out;
  }
}

/* the refs route (section 3): re-return the persisted meta - NO session change. The receipt
   carries the refs/notes counts and the pattern (when present) so the UI can offer the seq
   action for ALS items; the seq application itself is the ONE avMid flow, driven by the
   caller from meta.pattern. Receipt { ok:true, refs, notes?, pattern?, meta }. */
function avLibLoadRefs(rec) {
  try {
    const meta = (rec.meta && typeof rec.meta === "object") ? rec.meta : {};
    let refs = 0;
    if (typeof meta.refCount === "number" && isFinite(meta.refCount)) refs = Math.max(0, Math.round(meta.refCount));
    else if (Array.isArray(meta.refs)) refs = meta.refs.length;
    else if (Array.isArray(meta.wtRefs)) refs = meta.wtRefs.length;
    const out = { ok: true, id: rec.id, kind: "refs", refs: refs, meta: meta };
    if (typeof meta.noteCount === "number" && isFinite(meta.noteCount)) out.notes = Math.max(0, Math.round(meta.noteCount));
    if (meta.pattern && typeof meta.pattern === "object" && !Array.isArray(meta.pattern)) out.pattern = meta.pattern;
    return out;
  } catch (e) {
    return { ok: false, id: (rec && rec.id) ? rec.id : "", kind: "refs", refs: 0, error: "meta read failed" };
  }
}

/* the {name, bpm, notes} summary for the load receipt (notes = active steps) */
function avLibPatternSummary(feed, rec) {
  try {
    let notes = 0;
    const tracks = (feed && Array.isArray(feed.tracks)) ? feed.tracks : [];
    for (let t = 0; t < tracks.length; t++) {
      const steps = (tracks[t] && Array.isArray(tracks[t].steps)) ? tracks[t].steps : [];
      for (let s = 0; s < steps.length; s++) { if (steps[s] && steps[s].on) notes += 1; }
    }
    return {
      name: avLibStr(feed && feed.name, avLibStr(rec && rec.name, "pattern", 40), 40),
      bpm: avLibNum(feed && feed.bpm, 0, 0, 1000),
      notes: notes,
    };
  } catch (e) { return { name: "pattern", bpm: 0, notes: 0 }; }
}

/* ---------- public API (classic-script globals; every entry point never throws) ---------- */

/* idempotent; starts the async hydrate (list cache for status); safe when IDB is unavailable */
function avLibInit() {
  try {
    const st = avLibState;
    if (st.inited) return true;
    st.inited = true;
    avLibHydrate();
    return true;
  } catch (e) { return false; }
}

function avLibAddItem(item, bytesArg) {
  try { return Promise.resolve(avLibAddItemRun(item, bytesArg)).catch(function (e) { return { ok: false, id: "", backend: avLibState.backend, error: avLibErrMsg(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, id: "", backend: "mem", error: avLibErrMsg(e) }); }
}

function avLibList() {
  try { return Promise.resolve(avLibListRun()).catch(function (e) { return { ok: false, backend: avLibState.backend, count: 0, bytes: 0, items: [], error: avLibErrMsg(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, backend: "mem", count: 0, bytes: 0, items: [], error: avLibErrMsg(e) }); }
}

function avLibGet(id) {
  try { return Promise.resolve(avLibGetRecRun(id)).catch(function (e) { return { ok: false, error: avLibErrMsg(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, error: avLibErrMsg(e) }); }
}

function avLibRemove(id) {
  try { return Promise.resolve(avLibRemoveRun(id)).catch(function (e) { return { ok: false, id: (typeof id === "string") ? id : "", error: avLibErrMsg(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, id: (typeof id === "string") ? id : "", error: "error" }); }
}

function avLibLoad(id) {
  try { return Promise.resolve(avLibLoadRun(id)).catch(function (e) { return { ok: false, id: (typeof id === "string") ? id : "", kind: "", error: avLibErrMsg(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, id: (typeof id === "string") ? id : "", kind: "", error: "error" }); }
}

/* the honest tier note (mem = session only; ls = base64 fallback with the 1.5 MiB refusal) */
function avLibNote() {
  try {
    const st = avLibState;
    if (!st.hydrated) return null;
    if (st.backend === "mem") return "session only - storage unavailable; items vanish on reload";
    if (st.backend === "ls") return "localStorage fallback - base64; items over 1.5 MiB are refused";
    return null;
  } catch (e) { return null; }
}

function avLibStatus() {
  try {
    const st = avLibState;
    return {
      version: AV_LIB_VERSION,
      inited: st.inited,
      hydrated: st.hydrated,
      backend: st.backend,
      count: avLibRecount(),
      bytes: st.bytes,
      dbName: AV_LIB_DB,
      error: st.lastError,
      note: avLibNote(),
    };
  } catch (e) {
    return { version: AV_LIB_VERSION, inited: false, hydrated: false, backend: "mem", count: 0, bytes: 0, dbName: AV_LIB_DB, error: "status", note: null };
  }
}

/* the suite/console facade (suites drive this) */
if (typeof window !== "undefined") {
  window.__avLib = {
    version: AV_LIB_VERSION,
    status: avLibStatus,
    list: avLibList,
    get: avLibGet,
    load: avLibLoad,
    remove: avLibRemove,
    add: avLibAddItem,
  };
}
