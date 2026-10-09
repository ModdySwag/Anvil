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
                                        format, ext, size, at, meta}]} - newest first, NO raw bytes
     avLibGet(id) -> Promise            {ok, item?, error?} - the full record incl. bytes
     avLibRemove(id) -> Promise         {ok, error?} - durable drop first; a removal made while
                                        no DB connection is up is honoured at adoption
     avLibLoad(id) -> Promise           {ok, id, kind, entryId?, pattern?, error?} - never rejects
     avLibStatus() -> {}                sync snapshot: {version, inited, hydrated, backend,
                                        count, bytes, dbName, error, note}
     window.__avLib                     facade {version, status, list, get, load, remove, add,
                                        rename, receiptSave, receiptList, receiptClear}

   R17 additions (verify/_r17_wave.md section 3; AV_LIB_VERSION stays "r15b.0" - the pinned
   contract version is not bumped, the new surface is witnessed behaviorally): avLibRename(id,
   name) - the ONE rename path (trim, cap AV_LIB_NAME_MAX, ladder like avLibRemoveRun; a
   refused durable write with a DB up answers {ok:false, error:"rename refused"}); the receipts
   trio avLibReceiptSave/avLibReceiptList/avLibReceiptClear over the OWN database
   av-receipts-store (v1, store "runs", keyPath "id"; av-samples-store is NEVER migrated) with
   the av-receipts-ls fallback; rotation keeps the newest AV_LIB_REC_KEEP runs (by at); LS
   summaries may drop items. The additive record field `ext` (lowercase, dot-stripped, cap
   AV_LIB_EXT_MAX, "" fallback; old records hydrate as "") rides every read path.

   R18a additions (verify/_r18_wave.md section 3; additive only - record v stays 1 and old
   records hydrate cleanly): the additive record fields `sha256` (lowercase 64-hex, "" fallback),
   `source` (provenance {name, path, size, at, replaced?} or null) and `dupOf` ({id, name} or
   null) ride every read path (item/rec/meta/payload views + the list rows). avLibFindSha(sha)
   scans the loaded list for a content match (newest-first); avLibReplaceDup(id) folds a
   keep-both duplicate onto its recorded original and removes the newer row; avLibMissingScan()
   reports kit/refs names with no library match (relink v1 rides avLibRename). Facade additions:
   findSha, replaceDup, missingScan.

   R19 addition (verify/_r19_wave.md section 3; the same additive law): the `source` object
   may now carry `pack` (the exporting `.avpack` manifest id - a slug of <=64 chars). It rides
   every read path through avLibSourceNorm (absent or invalid -> dropped) and survives a
   replaceDup fold; old records hydrate cleanly, nothing else changes.

   R20 addition (verify/_r20_wave.md section 6; the same additive law): the record vocabulary
   gains kind "song" - the Song Bundle's project payload (bytes = the avProjBuild text). Its
   LOAD route (avLibLoadRun -> avLibLoadSong) decodes the stored bytes to utf-8 text and
   applies the project through the guarded avProjOpenText; the receipt is {ok, id,
   kind:"song", applied, warnings, error?}. avLibKindNorm accepts "song"; every read path
   (meta / rec / payload / item views + the missing scan's want rows) carries it exactly like
   the other kinds, and a replaceDup fold moves it like any other kind.

   Record shape: { id, v: 1, name, kind, format, ext, size, at, meta, bytes (ArrayBuffer), via }
     id = "l" + Date.now().toString(36) + "-" + slug(name); slug [a-z0-9-], cap 40.
     kind = "sample" | "pattern" | "kit" | "refs" (R15c) | "song" (R20). via = the backend the record was
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
     song (R20) -> the stored bytes decode to utf-8 text (TextDecoder; a bounded manual
                   fallback) -> the guarded avProjOpenText(name, text) applies the project
                   through the injected session module. NO session sample/seq change rides
                   here - the project apply owns every effect. Receipt {ok, id, kind:"song",
                   applied, warnings, error?}.

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

/* R17 section 3: the receipts history rides its OWN database (pinned name; av-samples-store is
   never migrated) - plus the rename + ext caps */
const AV_LIB_RECEIPT_DB = "av-receipts-store";  /* pinned IDB name */
const AV_LIB_RECEIPT_DB_VER = 1;
const AV_LIB_RECEIPT_OS = "runs";               /* object store, keyPath "id" */
const AV_LIB_RECEIPT_LS = "av-receipts-ls";     /* localStorage fallback key */
const AV_LIB_REC_KEEP = 20;                     /* persisted runs kept (newest by at) */
const AV_LIB_REC_ITEMS_MAX = 60;                /* stored receipt items cap */
const AV_LIB_REC_ERR_MAX = 20;                  /* stored error lines per run */
const AV_LIB_REC_TITLE_MAX = 80;                /* receipt title cap (default "import") */
const AV_LIB_REC_NOTE_MAX = 160;                /* per error / item-reason line cap */
const AV_LIB_NAME_MAX = 120;                    /* rename name cap (truncate, not refuse) */
const AV_LIB_EXT_MAX = 12;                      /* record ext cap */
/* R18 section 3: the additive identity / provenance laws */
const AV_LIB_SHA256_RE = /^[0-9a-f]{64}$/;      /* an accepted content hash (lowercase hex) */
const AV_LIB_PATH_MAX = 200;                    /* source.path cap */
const AV_LIB_MISSING_WANT_MAX = 32;             /* referencing records listed per missing name */
const AV_LIB_REC_ID_RE = /^r[a-z0-9-]{0,63}$/;  /* "r" + time36 (+ "-<seq>" on collision) */
/* R19 section 3: pack provenance rides inside source (additive; the exporting pack's id) */
const AV_LIB_PACK_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;  /* source.pack slug (cap 64) */
/* R20 section 6: the song route carries the avProjOpenText warnings, bounded here */
const AV_LIB_SONG_WARN_MAX = 16;                /* warnings kept on a song load receipt */

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

/* R17 section 3: the record `ext` (lowercase, dot-stripped, cap AV_LIB_EXT_MAX, "" fallback;
   old records without it read as "") */
function avLibExtNorm(v) {
  try {
    if (typeof v !== "string") return "";
    const s = v.toLowerCase().replace(/[\u0000-\u001f\u007f]/g, "").replace(/\./g, "").trim().slice(0, AV_LIB_EXT_MAX);
    return s || "";
  } catch (e) { return ""; }
}

/* R18 section 3: the additive record fields. sha256: lowercase 64-hex or "" (old records read
   as "" - nothing is repaired); source: {name <=120, path <=200, size >=0, at finite, plus the
   replaceDup `replaced` flag and the R19 `pack` slug} or null; dupOf: {id (AV_LIB_ID_RE),
   name <=120} or null. Garbage takes the fallback. */
function avLibSha256Norm(v) {
  try { if (typeof v === "string" && AV_LIB_SHA256_RE.test(v)) return v; } catch (e) { /* none */ }
  return "";
}

function avLibSourceNorm(v) {
  try {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const src = {
      name: avLibStr(v.name, "", AV_LIB_NAME_MAX),
      path: avLibStr(v.path, "", AV_LIB_PATH_MAX),
      size: avLibNum(v.size, 0, 0, AV_LIB_ITEM_MAX * 8),
      at: avLibNum(v.at, 0, 0, 9e15),
    };
    if (v.replaced === true) src.replaced = true;   /* the replaceDup provenance note rides through */
    if (typeof v.pack === "string" && AV_LIB_PACK_RE.test(v.pack)) src.pack = v.pack;   /* R19: pack provenance (absent/invalid -> dropped) */
    return src;
  } catch (e) { return null; }
}

function avLibDupOfNorm(v) {
  try {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const id = (typeof v.id === "string" && AV_LIB_ID_RE.test(v.id)) ? v.id : "";
    if (!id) return null;
    return { id: id, name: avLibStr(v.name, "", AV_LIB_NAME_MAX) };
  } catch (e) { return null; }
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

/* the record kind vocabulary: sample | pattern | kit | refs (R15c) | song (R20); "" = not
   persistable */
function avLibKindNorm(v) {
  try {
    if (v === "sample" || v === "pattern" || v === "kit" || v === "refs" || v === "song") return v;
  } catch (e) { /* none */ }
  return "";
}

/* the list-facing view of a record: {id, v, name, kind, format, ext, size, at, meta} plus the
   R18 additive fields {sha256, source, dupOf} */
function avLibMetaView(rec) {
  return {
    id: rec.id, v: 1,
    name: avLibStr(rec.name, rec.id, 120),
    kind: (rec.kind === "pattern") ? "pattern" : avLibKindNorm(rec.kind) || "sample",
    format: avLibToken(rec.format, "", 12),
    ext: avLibExtNorm(rec.ext),
    size: avLibNum(rec.size, 0, 0, AV_LIB_ITEM_MAX * 8),
    at: avLibNum(rec.at, 0, 0, 9e15),
    meta: avLibMetaNorm(rec.meta),
    sha256: avLibSha256Norm(rec.sha256),
    source: avLibSourceNorm(rec.source),
    dupOf: avLibDupOfNorm(rec.dupOf),
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
      ext: avLibExtNorm(rec.ext),
      size: avLibNum(rec.size, 0, 0, AV_LIB_ITEM_MAX * 8),
      at: avLibNum(rec.at, 0, 0, 9e15),
      meta: avLibMetaNorm(rec.meta),
      sha256: avLibSha256Norm(rec.sha256),
      source: avLibSourceNorm(rec.source),
      dupOf: avLibDupOfNorm(rec.dupOf),
      bytes: needBytes ? bytes : undefined,
      via: avLibToken(rec.via, "", 8),
    };
  } catch (e) { return null; }
}

/* the LS JSON payload for a record (bytes ride base64) */
function avLibLsPayload(rec, b64) {
  return {
    id: rec.id, v: 1,
    name: rec.name, kind: rec.kind, format: rec.format, ext: avLibExtNorm(rec.ext),
    size: rec.size, at: rec.at, meta: rec.meta,
    sha256: avLibSha256Norm(rec.sha256), source: avLibSourceNorm(rec.source), dupOf: avLibDupOfNorm(rec.dupOf),
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
      ext: avLibExtNorm(pay.ext),
      size: avLibNum(pay.size, 0, 0, AV_LIB_ITEM_MAX * 8),
      at: avLibNum(pay.at, 0, 0, 9e15),
      meta: avLibMetaNorm(pay.meta),
      sha256: avLibSha256Norm(pay.sha256),
      source: avLibSourceNorm(pay.source),
      dupOf: avLibDupOfNorm(pay.dupOf),
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
   result != "imported" items are SKIPPED (null); only sample/pattern/kit/refs/song kinds
   are material. */
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
      ext: avLibExtNorm(item.ext),
      meta: avLibMetaNorm(item.meta),
      sha256: avLibSha256Norm(item.sha256),
      source: avLibSourceNorm(item.source),
      dupOf: avLibDupOfNorm(item.dupOf),
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
    id: id, v: 1, name: it.name, kind: it.kind, format: it.format, ext: it.ext,
    size: buf.byteLength, at: Date.now(), meta: it.meta, bytes: buf, via: "",
    sha256: it.sha256, source: it.source, dupOf: it.dupOf,
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
      id: it.id, name: it.name, kind: it.kind, format: it.format, ext: avLibExtNorm(it.ext),
      size: it.size, at: it.at, meta: avLibMetaNorm(it.meta),
      sha256: avLibSha256Norm(it.sha256), source: avLibSourceNorm(it.source), dupOf: avLibDupOfNorm(it.dupOf),
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

/* ---------- R17: rename (verify/_r17_wave.md section 3) - the ONE rename path ---------- */

/* avLibRenameRun: the name is trimmed and capped AV_LIB_NAME_MAX (truncate, not refuse); an
   empty name is refused "no name". The ladder mirrors avLibRemoveRun: the durable row when a
   DB is up (read row, update name, put), the memory map, the LS mirror (map rewrite +
   write-through; refusal -> stuck). The durable leg is attempted first so a refused durable
   write cannot leave a half-renamed session copy behind: with a DB up that answers
   {ok:false, error:"rename refused"}. ok:true requires a real application (row / mem / LS);
   with no DB the mem+LS application answers honestly. st.items[id] follows on success.
   Never throws. */
async function avLibRenameRun(id, name) {
  const st = avLibState;
  await avLibReady();
  if (typeof id !== "string" || !id || !AV_LIB_ID_RE.test(id)) {
    return { ok: false, id: String(id == null ? "" : id), name: "", error: "no item" };
  }
  let clean = "";
  try { clean = avLibStr(name, "", AV_LIB_NAME_MAX); } catch (e) { clean = ""; }
  if (!clean) return { ok: false, id: id, name: "", error: "no name" };
  let applied = false;
  let stuck = false;
  /* the durable row when a DB is up: read row, update name, put */
  if (st.db) {
    let row = null;
    try { row = await avLibDbGet(st.db, id); } catch (e) { row = null; }
    if (row && typeof row === "object") {
      let refused = false;
      try {
        const upd = Object.assign({}, row);
        upd.name = clean; upd.v = 1; upd.via = "idb";
        await avLibDbWrite(st.db, upd);
        applied = true;
      } catch (e) { refused = true; }
      if (refused) { st.lastError = "rename refused"; return { ok: false, id: id, name: clean, error: "rename refused" }; }
    }
  }
  /* the memory map (the session tier's full record copy) */
  if (st.memMap[id]) {
    try { st.memMap[id].name = clean; applied = true; } catch (e) { /* the record stands */ }
  }
  /* the LS mirror (map rewrite + write-through; a refusal is stuck) */
  if (st.lsMirror[id]) {
    try {
      const map = Object.assign({}, st.lsMirror);
      const pay = Object.assign({}, map[id]);
      pay.name = clean;
      map[id] = pay;
      if (avLibLsWriteMap(map)) { st.lsMirror = map; applied = true; }
      else stuck = true;
    } catch (e) { stuck = true; }
  }
  if (applied) {
    try { if (st.items[id]) st.items[id].name = clean; } catch (e) { /* the view is a cache */ }
    st.lastError = null;
    return { ok: true, id: id, name: clean };
  }
  if (stuck) { st.lastError = "rename refused"; return { ok: false, id: id, name: clean, error: "rename refused" }; }
  return { ok: false, id: id, name: clean, error: "no item" };
}

/* ---------- R18: library intelligence (section 3: identity - dedupe - relink v1; additive
   only, scan-only - bounded by the loaded list, never a filesystem walk; never throws) ---------- */

/* the case-preserving leaf of a name/path (missing-scan display; avLibBaseLower stays the
   compare form) */
function avLibLeafCase(s) {
  try {
    const t = String(s == null ? "" : s);
    const parts = t.split(/[\\/]+/);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i]) return avLibStr(parts[i], "", AV_LIB_NAME_MAX);
    }
  } catch (e) { /* none */ }
  return "";
}

/* a kit sample row / refs row / wtRef row -> the referenced name: `.name` when present, else
   the path leaf (serum wtRefs carry no name). "" = skip (the caller's rule). */
function avLibRefName(row) {
  try {
    if (!row || typeof row !== "object") return "";
    const nm = avLibStr(row.name, "", AV_LIB_NAME_MAX);
    if (nm) return nm;
    return avLibLeafCase(row.path);
  } catch (e) { return ""; }
}

/* avLibFindSha(sha) -> Promise<{ok, hit, id?, name?, error?}>: scan the LOADED list (the
   st.items meta views - no db index, no version bump) for sha256 === sha; the first hit in
   newest-first order (at desc, id desc - the avLibListRun rule) wins. A malformed/empty sha
   refuses honestly (the caller skips dedupe). Never throws. */
async function avLibFindShaRun(sha) {
  const st = avLibState;
  await avLibReady();
  if (typeof sha !== "string" || !AV_LIB_SHA256_RE.test(sha)) {
    return { ok: false, hit: false, error: "no sha" };
  }
  let best = null;
  const ids = Object.keys(st.items);
  for (let i = 0; i < ids.length; i++) {
    const it = st.items[ids[i]];
    if (!it || it.sha256 !== sha) continue;
    if (!best || (it.at > best.at) || (it.at === best.at && it.id > best.id)) best = it;
  }
  if (!best) return { ok: true, hit: false };
  return { ok: true, hit: true, id: best.id, name: avLibStr(best.name, best.id, AV_LIB_NAME_MAX) };
}

/* fold the new record's content onto the target row (the TARGET keeps its own id, name, at) */
function avLibReplaceApplyTo(rec, nrec, newSource) {
  try {
    rec.bytes = nrec.bytes;
    rec.size = nrec.size;
    rec.format = nrec.format;
    rec.ext = nrec.ext;
    rec.kind = nrec.kind;
    rec.meta = nrec.meta;
    rec.sha256 = nrec.sha256;
    rec.source = newSource;
    rec.dupOf = null;
    rec.v = 1;
    return true;
  } catch (e) { return false; }
}

/* avLibReplaceDup(id) -> Promise<{ok, id?, removed?, error?}>: the keep-both resolution. The
   row `id` must exist and carry dupOf ({id, name}); its recorded original must still exist
   (else "target gone" - an honest refusal). The TARGET receives the new row's {bytes, size,
   format, ext, kind, meta, sha256} and source {name, path, size, at: now, replaced: true,
   plus the R19 `pack` slug when the folded record carried one}; dupOf goes null. The durable
   leg runs first (a refused write answers "replace refused" and nothing is removed); then
   the new row is removed through the avLibRemoveRun ladder. The target keeps its own id,
   name and at. Never throws. */
async function avLibReplaceDupRun(newId) {
  const st = avLibState;
  await avLibReady();
  if (typeof newId !== "string" || !newId || !AV_LIB_ID_RE.test(newId)) {
    return { ok: false, id: "", error: "no item" };
  }
  const g = await avLibGetRecRun(newId);
  if (!g || g.ok !== true || !g.item) return { ok: false, id: newId, error: "no item" };
  const nrec = g.item;
  const dup = avLibDupOfNorm(nrec.dupOf);
  if (!dup) return { ok: false, id: newId, error: "not a duplicate" };
  if (dup.id === newId) return { ok: false, id: newId, error: "target gone" };
  const t = await avLibGetRecRun(dup.id);
  if (!t || t.ok !== true || !t.item) return { ok: false, id: dup.id, error: "target gone" };
  const targetId = dup.id;
  const targetName = avLibStr(t.item.name, targetId, AV_LIB_NAME_MAX);
  const targetAt = avLibNum(t.item.at, 0, 0, 9e15);
  const src = avLibSourceNorm(nrec.source);
  const newSource = {
    name: (src && src.name) ? src.name : avLibStr(nrec.name, "", AV_LIB_NAME_MAX),
    path: src ? src.path : "",
    size: src ? src.size : avLibNum(nrec.size, 0, 0, AV_LIB_ITEM_MAX * 8),
    at: Date.now(),
    replaced: true,
  };
  if (src && typeof src.pack === "string") newSource.pack = src.pack;   /* R19: pack provenance rides the fold */
  let applied = false, stuck = false;
  /* 1) the durable row when a DB is up: read row, fold the new content in, put */
  if (st.db) {
    let row = null;
    try { row = await avLibDbGet(st.db, targetId); } catch (e) { row = null; }
    if (row && typeof row === "object") {
      try {
        const upd = Object.assign({}, row);
        if (avLibReplaceApplyTo(upd, nrec, newSource) !== true) throw new Error("apply failed");
        upd.via = "idb";
        await avLibDbWrite(st.db, upd);
        applied = true;
      } catch (e2) {
        st.lastError = "replace refused";
        return { ok: false, id: targetId, error: "replace refused" };
      }
    }
  }
  /* 2) the memory tier */
  if (st.memMap[targetId]) {
    try {
      const mr = Object.assign({}, st.memMap[targetId]);
      if (avLibReplaceApplyTo(mr, nrec, newSource) === true) { st.memMap[targetId] = mr; applied = true; }
    } catch (e3) { /* the durable leg already stands (or the LS leg follows) */ }
  }
  /* 3) the LS mirror (base64 write-through; a refusal is stuck) */
  if (st.lsMirror[targetId]) {
    try {
      const b64 = avLibB64Enc(nrec.bytes);
      if (b64 && b64.length <= AV_LIB_LS_B64_MAX) {
        const map = Object.assign({}, st.lsMirror);
        const pay = Object.assign({}, map[targetId]);
        pay.size = nrec.size; pay.format = nrec.format; pay.ext = nrec.ext; pay.kind = nrec.kind;
        pay.meta = nrec.meta; pay.sha256 = nrec.sha256; pay.source = newSource; pay.dupOf = null;
        pay.v = 1; pay.bytes = b64;
        map[targetId] = pay;
        if (avLibLsWriteMap(map)) { st.lsMirror = map; applied = true; }
        else stuck = true;
      } else {
        stuck = true;      /* the LS tier cannot hold the new bytes honestly */
      }
    } catch (e4) { stuck = true; }
  }
  if (!applied) {
    const err = stuck ? "replace refused" : "no item";
    st.lastError = err;
    return { ok: false, id: targetId, error: err };
  }
  /* the session view follows the fold (id, name and at stay the TARGET's) */
  try {
    st.items[targetId] = avLibMetaView({
      id: targetId, v: 1, name: targetName, kind: nrec.kind, format: nrec.format, ext: nrec.ext,
      size: nrec.size, at: targetAt, meta: nrec.meta,
      sha256: nrec.sha256, source: newSource, dupOf: null,
    });
    avLibRecount();
  } catch (e5) { /* the view is a cache; the next list rebuilds it */ }
  /* then the new row is removed through the avLibRemoveRun ladder */
  let rem = null;
  try { rem = await avLibRemoveRun(newId); } catch (e6) { rem = null; }
  if (!rem || rem.ok !== true) {
    return { ok: false, id: targetId, removed: "", error: (rem && rem.error) ? String(rem.error) : "removal refused" };
  }
  st.lastError = null;
  return { ok: true, id: targetId, removed: newId };
}

/* avLibMissingScan() -> Promise<{ok, missing: [{name, want: [{id, name, kind}]}], error?}>:
   every kit meta.samples[].name and refs meta.refs[].name / meta.wtRefs[].path leaf (the
   R15c/R15d/R16 ref shapes) is a referenced name; a name is missing when its lowercase
   basename (avLibBaseLower) matches NO library item name (same compare form). want = the
   records that reference the missing name (each {id, name, kind}, capped
   AV_LIB_MISSING_WANT_MAX = 32); missing is sorted by name. Scan only - bounded by the
   library list, no filesystem walks. Never throws. */
async function avLibMissingScanRun() {
  await avLibReady();
  const listR = await avLibListRun();
  const list = (listR && listR.ok === true && Array.isArray(listR.items)) ? listR.items : [];
  const have = {};
  for (let i = 0; i < list.length; i++) {
    const k = avLibBaseLower(list[i] && list[i].name);
    if (k) have[k] = 1;
  }
  const byKey = {};
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (!it || typeof it !== "object") continue;
    const meta = (it.meta && typeof it.meta === "object") ? it.meta : {};
    let rows = null;
    if (it.kind === "kit") {
      rows = Array.isArray(meta.samples) ? meta.samples : null;
    } else if (it.kind === "refs") {
      const a = Array.isArray(meta.refs) ? meta.refs : [];
      const b = Array.isArray(meta.wtRefs) ? meta.wtRefs : [];
      rows = (a.length || b.length) ? a.concat(b) : null;
    }
    if (!rows || !rows.length) continue;
    for (let j = 0; j < rows.length; j++) {
      const nm = avLibRefName(rows[j]);
      if (!nm) continue;                       /* skip empties */
      const key = avLibBaseLower(nm);
      if (!key || have[key]) continue;
      let grp = byKey[key];
      if (!grp) { grp = byKey[key] = { name: nm, want: [], seen: {} }; }
      if (grp.seen[it.id]) continue;
      if (grp.want.length >= AV_LIB_MISSING_WANT_MAX) continue;
      grp.want.push({ id: it.id, name: avLibStr(it.name, it.id, AV_LIB_NAME_MAX), kind: avLibKindNorm(it.kind) || "sample" });
      grp.seen[it.id] = 1;
    }
  }
  const missing = [];
  const keys = Object.keys(byKey);
  for (let i = 0; i < keys.length; i++) missing.push({ name: byKey[keys[i]].name, want: byKey[keys[i]].want });
  missing.sort(function (a, b) { return (a.name < b.name) ? -1 : (a.name > b.name ? 1 : 0); });
  return { ok: true, missing: missing };
}

/* ---------- R17: the receipts history (section 3) - OWN database av-receipts-store, store
   "runs" (av-samples-store is NEVER migrated); tier ladder idb -> ls -> mem named after the
   library's (quota never downgrades - answer the tier it used / the error); rotation keeps
   the newest AV_LIB_REC_KEEP runs (by at). LS summaries may drop items. ---------- */

const avLibReceiptState = {
  booted: false,
  bootPromise: null,
  backend: "mem",              /* "idb" | "ls" | "mem" - the tier a reach last actually used */
  db: null,
  dbGaveUp: false,
  taken: {},                   /* ids minted this session (same-ms collision guard) */
  mem: {},                     /* id -> receipt (the session memory tier) */
  seq: 0,                      /* id-collision counter */
  lastError: null,
};

/* idempotent readiness: every receipts entry point awaits this once per session */
function avLibReceiptReady() {
  const st = avLibReceiptState;
  if (st.bootPromise) return st.bootPromise;
  try {
    st.bootPromise = avLibReceiptBootRun().catch(function (e) {
      st.lastError = "receipts:" + avLibErrMsg(e);
      st.booted = true;
      return st.backend;
    });
    return st.bootPromise;
  } catch (e) {
    st.booted = true;
    return Promise.resolve(st.backend);
  }
}

/* one open attempt per session; a hung open gives up after AV_LIB_OPEN_CAP_MS (no adoption
   here by design - receipts are small and the LS summaries are a fine home; the next session
   boots fresh) */
async function avLibReceiptBootRun() {
  const st = avLibReceiptState;
  if (st.booted) return st.backend;
  const db = await avLibReceiptDbOpen();
  if (db) {
    const recs = await avLibReceiptDbAll(db);
    st.backend = (recs === null) ? (avLibReceiptLsOk() ? "ls" : "mem") : "idb";
  } else {
    st.backend = avLibReceiptLsOk() ? "ls" : "mem";
  }
  st.booted = true;
  return st.backend;
}

/* the receipts IndexedDB (promise-wrapped, never throws - the library's own plumbing, own
   names; store "runs" created if missing, keyPath "id") */
function avLibReceiptDbOpen() {
  return new Promise(function (res) {
    try {
      const st = avLibReceiptState;
      if (st.db) return res(st.db);
      if (st.dbGaveUp) return res(null);
      const idb = avLibIdb();
      if (!idb) return res(null);
      let settled = false;
      const give = function (v) { if (!settled) { settled = true; res(v); } };
      const timer = avLibTimer(function () { st.dbGaveUp = true; give(null); }, AV_LIB_OPEN_CAP_MS);
      const rq = idb.open(AV_LIB_RECEIPT_DB, AV_LIB_RECEIPT_DB_VER);
      rq.onupgradeneeded = function () {
        try { const db = rq.result; if (!db.objectStoreNames || !db.objectStoreNames.contains(AV_LIB_RECEIPT_OS)) db.createObjectStore(AV_LIB_RECEIPT_OS, { keyPath: "id" }); }
        catch (e) { /* upgrade raced */ }
      };
      rq.onsuccess = function () {
        avLibClear(timer);
        if (st.dbGaveUp) { try { rq.result.close(); } catch (e) { /* ignore */ } return give(null); }
        const db = rq.result;
        st.db = db;
        try { db.onclose = function () { if (avLibReceiptState.db === db) avLibReceiptState.db = null; }; } catch (e) { /* fine */ }
        give(db);
      };
      rq.onerror = function () { avLibClear(timer); give(null); };
      rq.onblocked = function () { avLibClear(timer); give(null); };
    } catch (e) { res(null); }
  });
}

function avLibReceiptDbAll(db) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_LIB_RECEIPT_OS, "readonly");
      const rq = tx.objectStore(AV_LIB_RECEIPT_OS).getAll();
      rq.onsuccess = function () { res(rq.result || []); };
      rq.onerror = function () { res(null); };
      tx.onerror = function () { res(null); };
    } catch (e) { res(null); }
  });
}

function avLibReceiptDbWrite(db, rec) {
  return new Promise(function (res, rej) {
    try {
      const tx = db.transaction(AV_LIB_RECEIPT_OS, "readwrite");
      tx.objectStore(AV_LIB_RECEIPT_OS).put(rec);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { rej((tx.error) || new Error("idb write failed")); };
      tx.onabort = function () { rej((tx.error) || new Error("idb write aborted")); };
    } catch (e) { rej(e); }
  });
}

function avLibReceiptDbRemove(db, id) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_LIB_RECEIPT_OS, "readwrite");
      tx.objectStore(AV_LIB_RECEIPT_OS).delete(id);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { res(false); };
      tx.onabort = function () { res(false); };
    } catch (e) { res(false); }
  });
}

function avLibReceiptDbClear(db) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_LIB_RECEIPT_OS, "readwrite");
      tx.objectStore(AV_LIB_RECEIPT_OS).clear();
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { res(false); };
      tx.onabort = function () { res(false); };
    } catch (e) { res(false); }
  });
}

/* the av-receipts-ls fallback (validated summary map; {} on any failure) */
function avLibReceiptLsOk() {
  try { return avLibLs() != null; } catch (e) { return false; }
}

function avLibReceiptLsLoad() {
  const out = {};
  try {
    const ls = avLibLs();
    if (!ls) return out;
    const raw = ls.getItem(AV_LIB_RECEIPT_LS);
    if (raw == null) return out;
    let obj = null;
    try { obj = JSON.parse(raw); } catch (e) { obj = null; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!AV_LIB_REC_ID_RE.test(k)) continue;
      const pay = obj[k];
      if (!pay || typeof pay !== "object" || Array.isArray(pay)) continue;
      out[k] = pay;
    }
  } catch (e) { /* storage blocked: memory only */ }
  return out;
}

/* ---------- receipt shapes (section 3: {id, v:1, at, title, counts, errors, items}) ---------- */

/* id = "r" + Date.now().toString(36); a same-millisecond save gains a "-<seq>" suffix so two
   runs in one tick can never collapse into one store row */
function avLibReceiptId() {
  const st = avLibReceiptState;
  const base = "r" + Date.now().toString(36);
  let id = base;
  try {
    while (st.taken[id]) {
      st.seq += 1;
      id = base + "-" + st.seq;
      if (st.seq > 100000) break;
    }
  } catch (e) { /* base id stands */ }
  try { st.taken[id] = 1; } catch (e) { /* the guard is best-effort */ }
  return id;
}

/* the counts subset the stored run keeps (missing / garbage -> 0) */
function avLibReceiptCountsNorm(v) {
  const out = { total: 0, imported: 0, deferred: 0, refused: 0, samples: 0, patterns: 0, kits: 0, refs: 0, bundles: 0, dups: 0 };
  try {
    if (!v || typeof v !== "object") return out;
    const keys = ["total", "imported", "deferred", "refused", "samples", "patterns", "kits", "refs", "bundles", "dups"];
    for (let i = 0; i < keys.length; i++) out[keys[i]] = Math.round(avLibNum(v[keys[i]], 0, 0, 1e9));
  } catch (e) { /* defaults stand */ }
  return out;
}

/* error lines: strings only, each capped AV_LIB_REC_NOTE_MAX, at most AV_LIB_REC_ERR_MAX */
function avLibReceiptErrsNorm(v) {
  const out = [];
  try {
    if (!Array.isArray(v)) return out;
    for (let i = 0; i < v.length && out.length < AV_LIB_REC_ERR_MAX; i++) {
      if (typeof v[i] !== "string") continue;
      const s = avLibStr(v[i], "", AV_LIB_REC_NOTE_MAX);
      if (s) out.push(s);
    }
  } catch (e) { /* [] */ }
  return out;
}

/* one stored item: {name, format, kind, result, reason, size} (reason cap note-max) */
function avLibReceiptItemNorm(v) {
  try {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    return {
      name: avLibStr(v.name, "", AV_LIB_NAME_MAX),
      format: avLibToken(v.format, "", 12),
      kind: avLibToken(v.kind, "", 12),
      result: avLibToken(v.result, "", 16),
      reason: avLibStr(v.reason, "", AV_LIB_REC_NOTE_MAX),
      size: avLibNum(v.size, 0, 0, AV_LIB_ITEM_MAX * 8),
    };
  } catch (e) { return null; }
}

/* items capped AV_LIB_REC_ITEMS_MAX (counts.total still carries the honest run total) */
function avLibReceiptItemsNorm(v) {
  const out = [];
  try {
    if (!Array.isArray(v)) return out;
    for (let i = 0; i < v.length && out.length < AV_LIB_REC_ITEMS_MAX; i++) {
      const it = avLibReceiptItemNorm(v[i]);
      if (it) out.push(it);
    }
  } catch (e) { /* [] */ }
  return out;
}

/* an incoming receipt -> the stored shape. genId (the Save path) mints an id when none is
   present; the read path (genId false) drops a record without a valid id. */
function avLibReceiptNorm(raw, genId) {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    let id = (typeof raw.id === "string" && AV_LIB_REC_ID_RE.test(raw.id)) ? raw.id : "";
    if (!id) {
      if (!genId) return null;
      id = avLibReceiptId();
    }
    return {
      id: id,
      v: 1,
      at: avLibNum(raw.at, Date.now(), 0, 9e15),
      title: avLibStr(raw.title, "import", AV_LIB_REC_TITLE_MAX),
      counts: avLibReceiptCountsNorm(raw.counts),
      errors: avLibReceiptErrsNorm(raw.errors),
      items: avLibReceiptItemsNorm(raw.items),
    };
  } catch (e) { return null; }
}

/* the LS-tier payload: a summary - items may be dropped there (section 3) */
function avLibReceiptSummary(rec) {
  return { id: rec.id, v: 1, at: rec.at, title: rec.title, counts: rec.counts, errors: rec.errors };
}

/* the list row: exactly {id, at, title, counts} */
function avLibReceiptRow(rec) {
  return { id: rec.id, at: rec.at, title: rec.title, counts: rec.counts };
}

/* the newest AV_LIB_REC_KEEP ids of an id -> {at} map, newest first (at desc, id desc) */
function avLibReceiptKeepIds(map) {
  try {
    const ids = Object.keys(map);
    ids.sort(function (a, b) {
      const A = avLibNum(map[a] && map[a].at, 0, 0, 9e15);
      const B = avLibNum(map[b] && map[b].at, 0, 0, 9e15);
      return (B - A) || (a < b ? 1 : (a > b ? -1 : 0));
    });
    return ids.slice(0, AV_LIB_REC_KEEP);
  } catch (e) { return []; }
}

/* rotation after a DB commit: delete runs beyond the newest AV_LIB_REC_KEEP (best-effort -
   the commit already stands) */
async function avLibReceiptRotateDb(db, runs) {
  let dropped = 0;
  try {
    const keep = avLibReceiptKeepIds(runs);
    const kept = {};
    for (let i = 0; i < keep.length; i++) kept[keep[i]] = 1;
    const ids = Object.keys(runs);
    for (let i = 0; i < ids.length; i++) {
      if (kept[ids[i]]) continue;
      try { if (await avLibReceiptDbRemove(db, ids[i])) dropped += 1; } catch (e) { /* best-effort */ }
    }
  } catch (e) { /* best-effort */ }
  return dropped;
}

/* an LS summary map pruned to the newest AV_LIB_REC_KEEP entries */
function avLibReceiptPruneMap(map) {
  try {
    const keep = avLibReceiptKeepIds(map);
    const out = {};
    for (let i = 0; i < keep.length; i++) out[keep[i]] = map[keep[i]];
    return out;
  } catch (e) { return map; }
}

/* the memory tier pruned to the newest AV_LIB_REC_KEEP receipts */
function avLibReceiptPruneMem() {
  const st = avLibReceiptState;
  let dropped = 0;
  try {
    const keep = avLibReceiptKeepIds(st.mem);
    const kept = {};
    for (let i = 0; i < keep.length; i++) kept[keep[i]] = 1;
    const ids = Object.keys(st.mem);
    for (let i = 0; i < ids.length; i++) {
      if (kept[ids[i]]) continue;
      delete st.mem[ids[i]];
      dropped += 1;
    }
  } catch (e) { /* best-effort */ }
  return dropped;
}

/* ---------- the receipts trio run bodies ---------- */

async function avLibReceiptSaveRun(rec) {
  const st = avLibReceiptState;
  await avLibReceiptReady();
  const r = avLibReceiptNorm(rec, true);
  if (!r) return { ok: false, id: "", error: "no receipt" };
  /* 1) the durable home (a quota / DB failure never silently downgrades) */
  const db = await avLibReceiptDbOpen();
  if (db) {
    try {
      await avLibReceiptDbWrite(db, r);
    } catch (e) {
      const name = avLibErrName(e);
      /* a closed connection (tab churn) may heal on the NEXT call; a quota will not - say which */
      if (name === "InvalidStateError" || name === "TransactionInactiveError") {
        st.db = null;
        try { await avLibReceiptDbOpen(); } catch (e2) { /* stays null */ }
      }
      const out = { ok: false, id: r.id, backend: "idb", error: (name === "QuotaExceededError") ? "quota" : ("idb:" + (name || "error")) };
      st.lastError = out.error;
      return out;
    }
    st.backend = "idb";
    st.lastError = null;
    /* rotation: after commit, delete runs beyond the newest AV_LIB_REC_KEEP (by at) */
    try {
      const recs = await avLibReceiptDbAll(db);
      if (Array.isArray(recs)) {
        const runs = {};
        for (let i = 0; i < recs.length; i++) {
          const norm = avLibReceiptNorm(recs[i], false);
          if (norm) runs[norm.id] = norm;
        }
        runs[r.id] = r;
        await avLibReceiptRotateDb(db, runs);
      }
    } catch (e) { /* rotation is best-effort; the commit already stands */ }
    return { ok: true, id: r.id, backend: "idb" };
  }
  /* 2) no IndexedDB: the LS summaries (items may be dropped there) */
  const ls = avLibLs();
  if (ls) {
    const map = Object.assign({}, avLibReceiptLsLoad());
    map[r.id] = avLibReceiptSummary(r);
    const pruned = avLibReceiptPruneMap(map);
    try {
      const ids = Object.keys(pruned);
      if (!ids.length) ls.removeItem(AV_LIB_RECEIPT_LS);
      else ls.setItem(AV_LIB_RECEIPT_LS, JSON.stringify(pruned));
      if (st.backend === "mem") st.backend = "ls";   /* the tier really is in use now */
      st.lastError = null;
      return { ok: true, id: r.id, backend: "ls" };
    } catch (e) {
      if (avLibErrName(e) === "QuotaExceededError") {
        st.lastError = "quota";
        return { ok: false, id: r.id, backend: "ls", error: "quota" };
      }
      /* storage fully unavailable: fall to memory for this session */
    }
  }
  /* 3) memory - volatile, and the receipt says so */
  st.mem[r.id] = r;
  avLibReceiptPruneMem();
  st.lastError = null;
  return { ok: true, id: r.id, backend: "mem", volatile: true };
}

async function avLibReceiptListRun() {
  const st = avLibReceiptState;
  await avLibReceiptReady();
  const runs = {};
  let backend = "mem";
  /* the durable home first */
  if (st.db) {
    const recs = await avLibReceiptDbAll(st.db);
    if (recs !== null) {
      backend = "idb";
      for (let i = 0; i < recs.length; i++) {
        const norm = avLibReceiptNorm(recs[i], false);
        if (norm) runs[norm.id] = norm;
      }
    }
  }
  /* the LS snapshot (summaries) fills in when the database is not serving */
  if (backend !== "idb") {
    const map = avLibReceiptLsLoad();
    const ids = Object.keys(map);
    for (let i = 0; i < ids.length; i++) {
      const norm = avLibReceiptNorm(map[ids[i]], false);
      if (norm) runs[norm.id] = norm;
    }
    if (ids.length) backend = "ls";
  }
  /* session-held runs join the list (they are the live ones) */
  const memIds = Object.keys(st.mem);
  for (let i = 0; i < memIds.length; i++) if (st.mem[memIds[i]]) runs[memIds[i]] = st.mem[memIds[i]];
  const list = [];
  const ids2 = Object.keys(runs);
  for (let i = 0; i < ids2.length; i++) list.push(avLibReceiptRow(runs[ids2[i]]));
  /* newest-first (at desc, id desc - the av_lib list order) */
  list.sort(function (a, b) { return (b.at - a.at) || (a.id < b.id ? 1 : (a.id > b.id ? -1 : 0)); });
  return { ok: true, backend: backend, count: list.length, runs: list };
}

async function avLibReceiptClearRun() {
  const st = avLibReceiptState;
  await avLibReceiptReady();
  const gone = {};
  let stuck = false;
  /* the durable home first (like avLibRemoveRun) */
  if (st.db) {
    const recs = await avLibReceiptDbAll(st.db);
    const list = Array.isArray(recs) ? recs : [];
    const cleared = await avLibReceiptDbClear(st.db);
    if (cleared) {
      for (let i = 0; i < list.length; i++) {
        const id = (list[i] && typeof list[i].id === "string" && list[i].id) ? list[i].id : "";
        if (id) gone[id] = 1;
      }
    } else stuck = true;
  }
  /* the LS snapshot (retire the key when emptied) */
  const ls = avLibLs();
  if (ls) {
    const map = avLibReceiptLsLoad();
    const ids = Object.keys(map);
    if (ids.length) {
      try {
        ls.removeItem(AV_LIB_RECEIPT_LS);
        for (let i = 0; i < ids.length; i++) gone[ids[i]] = 1;
      } catch (e) { stuck = true; }
    }
  }
  /* the memory tier */
  const memIds = Object.keys(st.mem);
  for (let i = 0; i < memIds.length; i++) { delete st.mem[memIds[i]]; gone[memIds[i]] = 1; }
  const removed = Object.keys(gone).length;
  if (removed > 0) { st.lastError = null; return { ok: true, removed: removed }; }
  if (stuck) { st.lastError = "removal refused"; return { ok: false, removed: 0, error: "removal refused" }; }
  return { ok: true, removed: 0 };
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
  if (rec.kind === "song") return avLibLoadSong(rec);    /* R20: song bundle project payload */
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

/* R20 section 6: bytes -> utf-8 text for the song route (TextDecoder first, then a bounded
   manual decoder mirroring the av_pack.js reader; null when undecodable) */
function avLibUtf8Text(bytes) {
  let u8 = null;
  try {
    if (bytes && typeof ArrayBuffer !== "undefined" && (bytes instanceof ArrayBuffer)) u8 = new Uint8Array(bytes);
    else if (bytes && typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(bytes)) u8 = bytes;
  } catch (e) { u8 = null; }
  if (!u8 || typeof u8.length !== "number" || !u8.length) return null;
  try { if (typeof TextDecoder === "function") return new TextDecoder("utf-8", { fatal: false }).decode(u8); } catch (e2) { /* manual below */ }
  try {
    let s = "";
    let i = 0;
    while (i < u8.length) {
      const c = u8[i++];
      if (c < 0x80) { s += String.fromCharCode(c); continue; }
      let cp = -1;
      let need = 0;
      if (c >= 0xC2 && c <= 0xDF) { cp = c & 0x1F; need = 1; }
      else if (c >= 0xE0 && c <= 0xEF) { cp = c & 0x0F; need = 2; }
      else if (c >= 0xF0 && c <= 0xF4) { cp = c & 0x07; need = 3; }
      if (cp < 0 || i + need > u8.length) { s += "\uFFFD"; continue; }
      let bad = false;
      for (let k = 0; k < need; k++) {
        const cc = u8[i + k];
        if ((cc & 0xC0) !== 0x80) { bad = true; break; }
        cp = (cp << 6) | (cc & 0x3F);
      }
      if (bad) { s += "\uFFFD"; continue; }
      i += need;
      if (cp > 0xFFFF) {
        cp -= 0x10000;
        s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      } else s += String.fromCharCode(cp);
    }
    return s;
  } catch (e3) { return null; }
}

/* the song route (R20 section 6): the stored bytes decode to utf-8 text and the project
   applies through the guarded avProjOpenText(name, text) (the global first, then the
   __avProj facade; absent -> honest refusal). The receipt carries the project open shape's
   applied / warnings (bounded by AV_LIB_SONG_WARN_MAX); NO session sample/seq change rides
   here - the project apply owns every effect. NEVER throws. Receipt {ok, id, kind:"song",
   applied, warnings, error?}. */
function avLibLoadSong(rec) {
  const out = { ok: false, id: (rec && rec.id) ? rec.id : "", kind: "song", applied: 0, warnings: [] };
  try {
    let open = null;
    try { if (typeof avProjOpenText === "function") open = avProjOpenText; } catch (e) { open = null; }
    if (typeof open !== "function") {
      try {
        const w = (typeof window !== "undefined") ? window : null;
        if (w && w.__avProj && typeof w.__avProj.openText === "function") open = w.__avProj.openText;
      } catch (e2) { open = null; }
    }
    if (typeof open !== "function") { out.error = "project module absent"; return out; }
    const text = avLibUtf8Text(rec && rec.bytes);
    if (typeof text !== "string" || !text) { out.error = "no project text"; return out; }
    let r = null;
    try { r = open(avLibStr(rec.name, "song.anvl", AV_LIB_NAME_MAX), text); } catch (e3) { r = null; }
    if (!r || typeof r !== "object") { out.error = "open refused"; return out; }
    out.applied = Math.round(avLibNum(r.applied, 0, 0, 0x7FFFFFFF));
    let warns = null;
    try { warns = Array.isArray(r.warnings) ? r.warnings : null; } catch (e4) { warns = null; }
    if (warns) {
      const list = [];
      for (let i = 0; i < warns.length && i < AV_LIB_SONG_WARN_MAX; i++) {
        const s = avLibStr(warns[i], "", 200);
        if (s) list.push(s);
      }
      out.warnings = list;
    }
    if (r.ok !== true) { out.error = avLibStr(r.error, "", 200) || "apply refused"; return out; }
    out.ok = true;
    return out;
  } catch (e) {
    out.error = avLibErrMsg(e);
    return out;
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

/* R17: rename + the receipts trio (section 3; every entry point never throws) */
function avLibRename(id, name) {
  try { return Promise.resolve(avLibRenameRun(id, name)).catch(function (e) { return { ok: false, id: (typeof id === "string") ? id : "", name: "", error: avLibErrMsg(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, id: (typeof id === "string") ? id : "", name: "", error: "error" }); }
}

/* R18: identity / dedupe / missing-scan (section 3; every entry point never throws) */
function avLibFindSha(sha) {
  try { return Promise.resolve(avLibFindShaRun(sha)).catch(function (e) { return { ok: false, hit: false, error: avLibErrMsg(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, hit: false, error: "error" }); }
}

function avLibReplaceDup(id) {
  try { return Promise.resolve(avLibReplaceDupRun(id)).catch(function (e) { return { ok: false, id: (typeof id === "string") ? id : "", error: avLibErrMsg(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, id: (typeof id === "string") ? id : "", error: "error" }); }
}

function avLibMissingScan() {
  try { return Promise.resolve(avLibMissingScanRun()).catch(function (e) { return { ok: false, missing: [], error: avLibErrMsg(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, missing: [], error: "error" }); }
}

function avLibReceiptSave(rec) {
  try { return Promise.resolve(avLibReceiptSaveRun(rec)).catch(function (e) { return { ok: false, id: "", error: avLibErrMsg(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, id: "", error: "error" }); }
}

function avLibReceiptList() {
  try { return Promise.resolve(avLibReceiptListRun()).catch(function (e) { return { ok: false, backend: avLibReceiptState.backend, count: 0, runs: [], error: avLibErrMsg(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, backend: "mem", count: 0, runs: [], error: "error" }); }
}

function avLibReceiptClear() {
  try { return Promise.resolve(avLibReceiptClearRun()).catch(function (e) { return { ok: false, removed: 0, error: avLibErrMsg(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, removed: 0, error: "error" }); }
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
    rename: avLibRename,
    receiptSave: avLibReceiptSave,
    receiptList: avLibReceiptList,
    receiptClear: avLibReceiptClear,
    findSha: avLibFindSha,
    replaceDup: avLibReplaceDup,
    missingScan: avLibMissingScan,
  };
}
