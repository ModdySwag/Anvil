/* av_backup.js — Anvil S2 (sessions wave, sa-B): BACKUP — a portable zip of the durable state
   (sessions · installed packs · sample slots), plus a NEW store-method zip READER and the
   additive restore. This module is the ONE owner of the backup/restore path.

   Pins (verify/_s2_wave.md §2.2):
   - avBackupInit() -> boolean                idempotent; no DOM; nothing durable to bind here.
   - avBackupBuild(opts?) -> Promise<{ ok, name, bytes, buffer (ArrayBuffer), manifest, skipped, at }>
     writes `anvil-backup-<YYYYMMDD-HHMMSS>.zip` with avZipBuild (store-method entries only):
       manifest.json      { v:1, app:'anvil', at (ISO), sha256: { '<entry>': '<hex>' }, counts:{sessions,packs,samples} }
                          (manifest.json itself carries no self-digest — it is the signature file)
       sessions.json      avSessionExport() payload (ALL sessions incl. versions)
       packs/<id>.json    one per INSTALLED pack (avStoreGet(id) payload — the full record incl. `pack`)
       samples/slot<n>-<name>.wav   one per non-empty sample slot (avWavEncode of {rate, ch1, ch2};
                          name + slot live in the WAV filename; 32f = bit-exact round trip of the float data)
       README.txt         what-this-is + the additive-restore hint
     Build opts (all optional): `now` (epoch ms — pins the stamp + manifest.at for harnesses),
     `date` (zip DOS timestamp: Date | number | null; null = avZipBuild's deterministic 1980 epoch).
     `skipped` lists everything that could not be included (counted, never silent).
   - avBackupRead(buf) -> { ok, error, entries: [{ name, size, bytes(Uint8Array) }], manifest,
     errors: [], count, bytes }
     The reader is OWN code: little-endian EOCD scan + central-directory walk; store (method 0)
     entries only; CRC-32 validated with the existing avZipCrc32 — a bad CRC / a deflate entry / a
     structural problem lands in `errors[]` and the entry is withheld, never thrown. ok:false only
     when the container itself is unreadable (bad/truncated/no EOCD, corrupt central directory,
     no CRC helper). `bytes` are zero-copy views into the source buffer — copy before mutating it.
   - avBackupRestore(bufOrReadResult, mode?) -> Promise<{ ok, error, restored:{sessions,packs,samples},
     skipped (flat total), skippedBy:{sessions,packs,samples}, errors: [], notes: [], at }>
     ADDITIVE ONLY — nothing the user currently holds is ever deleted:
       sessions via avSessionImport(payload) (the session module's own id-dedupe law);
       packs via the store's OWN machinery — avStoreHydrate -> avStoreGet (collision: the installed
       copy is kept) -> avStoreRecordNorm -> avStoreCommit (never a re-implemented IDB schema);
       samples via av_sample's import hook avSampleImportFiles (WAVs are handed over as File objects
       when File exists, else copies of the bytes). `mode` = 'all' (default) | 'sessions' | 'packs'
       | 'samples'. manifest.sha256 is re-verified per entry: a mismatch withholds the entry +
       errors[] (malformed digest = unverifiable = withheld). ok:true means the restore ran (fully or
       partially — read errors[]); ok:false = refused before any write (unreadable zip, missing/foreign
       manifest, unsupported version).
     Undetermined v1: engine slot routing for samples (avSampleStore.sent) is live state, not durable —
     restored WAVs land back in the registry, the send-to-slot routing is NOT re-applied (noted).
   - avBackupState() -> { version, init, busy, lastBuild:{name,bytes,at,counts}|null,
     lastRestore:{at,ok,restored,skipped,errorCount,errors[],notes[]}|null, lastError }
   - avBackupClasses() -> []  (this module mounts nothing — the Sessions card owns markup).
   - window.__avBackup = { version, init, build, read, restore, state } (guarded).

   Reuse (same page scope, all typeof-guarded, resolved per call): avZipBuild · avZipCrc32 ·
   avZipNameDecode (av_zipc.js), avWavEncode · avWavInfo (av_wavio.js), avSessionExport/Import
   (av_session.js), avStoreStatus/Installed/Get/Hydrate/RecordNorm/Commit (av_store.js),
   avSampleStore / avSampleImportFiles (av_sample.js). sha256 comes from crypto.subtle (guarded;
   absent -> the manifest carries no digests and the restore notes unverifiable entries).

   Laws kept: "use strict"; classic script (no modules/imports), node-loadable (no DOM/global reach
   at load, every reach guarded inside functions), ONE namespace (avBackup* / AV_BACKUP_*), never
   throws (honest refusals, counted skips), no console noise, bounded reports (errors capped at 64),
   forward-slash zip paths. */
"use strict";

const AV_BACKUP_VERSION = "s2.0";
const AV_BACKUP_APP = "anvil";
const AV_BACKUP_MANIFEST = "manifest.json";
const AV_BACKUP_SESSIONS = "sessions.json";
const AV_BACKUP_README = "README.txt";
const AV_BACKUP_PACK_DIR = "packs/";
const AV_BACKUP_SAMPLE_DIR = "samples/";
const AV_BACKUP_METHOD_STORE = 0;
const AV_BACKUP_MAX_ERRORS = 64;          /* bounded reports — no unbounded logs (§ laws 6) */
const AV_BACKUP_MAX_ENTRIES = 4096;       /* zip-reader sanity cap (no zip64) */
const AV_BACKUP_SAMPLE_CAP_S = 60;        /* per-slot encode cap, at the stored frames — no padding */
const AV_BACKUP_SAMPLE_NAME_RE = /^samples\/slot(\d+)(?:-([\s\S]+))?\.wav$/i;
const AV_BACKUP_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;     /* same slug law as the pack store */
const AV_BACKUP_SHA_RE = /^[0-9a-f]{64}$/i;
const AV_BACKUP_SAFE_RE = /[\/\\:*?"<>|\u0000-\u001f]+/g;

/* ---------- state (the report surface; JSON-safe by construction) ---------- */

const avBackupStore = {
  inited: false,
  busy: 0,                 /* > 0 while a build/restore is in flight */
  lastBuild: null,         /* { name, bytes, at, counts } */
  lastRestore: null,       /* { at, ok, restored, skipped, errorCount, errors, notes } */
  lastError: null,
};

/* ---------- guarded environment reaches (never throw; plain node has none of these) ---------- */

function avBackupErrText(e) {
  try {
    const s = (e && (e.message || e.name)) ? String(e.message || e.name) : String(e);
    return (s || "unknown error").slice(0, 160);
  } catch (e2) { return "unknown error"; }
}

function avBackupNow() { try { return Date.now(); } catch (e) { return 0; } }

function avBackupBytes(x) {
  try {
    if (x == null) return null;
    if (typeof ArrayBuffer !== "undefined" && x instanceof ArrayBuffer) return new Uint8Array(x);
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(x)) {
      return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    }
    return null;
  } catch (e) { return null; }
}

function avBackupSubtle() {
  try { if (typeof crypto !== "undefined" && crypto && crypto.subtle && typeof crypto.subtle.digest === "function") return crypto.subtle; } catch (e) { /* none */ }
  try {
    if (typeof window !== "undefined" && window && window.crypto && window.crypto.subtle && typeof window.crypto.subtle.digest === "function") return window.crypto.subtle;
  } catch (e) { /* no window */ }
  return null;
}

function avBackupHex(u8) {
  try {
    let s = "";
    for (let i = 0; i < u8.length; i++) { const h = u8[i].toString(16); s += h.length < 2 ? "0" + h : h; }
    return s;
  } catch (e) { return ""; }
}

/* sha-256 hex of bytes; "" when crypto.subtle is unavailable or digest refuses (honest, capped) */
function avBackupSha256Hex(bytes) {
  try {
    const subtle = avBackupSubtle();
    if (!subtle) return Promise.resolve("");
    const b = avBackupBytes(bytes);
    if (!b) return Promise.resolve("");
    return Promise.resolve(subtle.digest("SHA-256", b)).then(
      function (d) { return avBackupHex(new Uint8Array(d)); },
      function () { return ""; }
    );
  } catch (e) { return Promise.resolve(""); }
}

/* ---------- utf-8 (TextEncoder/Decoder when present, manual fallback otherwise) ---------- */

function avBackupUtf8(str) {
  const s = String(str == null ? "" : str);
  try { if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s); } catch (e) { /* fallback */ }
  const out = [];
  try {
    for (let i = 0; i < s.length; i++) {
      let cp = s.charCodeAt(i);
      if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < s.length) {
        const lo = s.charCodeAt(i + 1);
        if (lo >= 0xDC00 && lo <= 0xDFFF) { cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00); i++; }
      }
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xC0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
  } catch (e) { /* refuse to the partial */ }
  return Uint8Array.from(out);
}

function avBackupUtf8Decode(b) {
  try { if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8", { fatal: false }).decode(b); } catch (e) { /* fallback */ }
  let s = "", i = 0;
  try {
    while (i < b.length) {
      const c = b[i++];
      if (c < 0x80) s += String.fromCharCode(c);
      else if (c >= 0xC0 && c < 0xE0 && i < b.length) s += String.fromCharCode(((c & 0x1F) << 6) | (b[i++] & 0x3F));
      else if (c >= 0xE0 && c < 0xF0 && i + 1 < b.length) {
        s += String.fromCharCode(((c & 0x0F) << 12) | ((b[i++] & 0x3F) << 6) | (b[i++] & 0x3F));
      } else if (c >= 0xF0 && i + 2 < b.length) {
        let cp = ((c & 0x07) << 18) | ((b[i++] & 0x3F) << 12) | ((b[i++] & 0x3F) << 6) | (b[i++] & 0x3F);
        cp -= 0x10000;
        s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      } else s += String.fromCharCode(c);
    }
  } catch (e) { /* partial */ }
  return s;
}

/* ---------- tiny value laws (garbage in, sane value out) ---------- */

function avBackupJson(o) { try { return JSON.stringify(o); } catch (e) { return null; } }

function avBackupInt(v) {
  try {
    const n = Number(v);
    if (!isFinite(n) || n < 0) return 0;
    return Math.min(1000000000, Math.round(n));
  } catch (e) { return 0; }
}

/* bounded push (laws: counted skips, no unbounded logs) */
function avBackupPush(list, msg) {
  try {
    if (!Array.isArray(list)) return;
    const s = String(msg == null ? "unknown" : msg);
    if (list.length < AV_BACKUP_MAX_ERRORS) list.push(s);
    else if (list.length === AV_BACKUP_MAX_ERRORS) list.push("...more problems were omitted");
  } catch (e) { /* reporting is best-effort */ }
}

function avBackupPad2(n) { const v = Math.max(0, Math.min(99, n | 0)); return (v < 10 ? "0" : "") + v; }

function avBackupStamp(ms) {
  try {
    const d = new Date(ms);
    if (!d || !isFinite(d.getTime())) return String(ms == null ? "0" : ms).replace(/[^0-9]/g, "") || "0";
    return String(d.getFullYear()) + avBackupPad2(d.getMonth() + 1) + avBackupPad2(d.getDate()) +
      "-" + avBackupPad2(d.getHours()) + avBackupPad2(d.getMinutes()) + avBackupPad2(d.getSeconds());
  } catch (e) { return "0"; }
}

/* filename-safe sample name (keeps unicode; strips path-hostile chars + leading/trailing dots) */
function avBackupSafeName(s, dflt) {
  try {
    let v = String(s == null ? "" : s).replace(AV_BACKUP_SAFE_RE, "_").replace(/^[.\s]+/, "");
    v = v.replace(/[.\s]+$/, "");
    if (v.length > 80) v = v.slice(0, 80);
    return v || String(dflt || "sample");
  } catch (e) { return String(dflt || "sample"); }
}

/* ---------- zip-reader internals (little-endian; shared-scope avZip* helpers, all guarded) ---------- */

function avBackupU16(b, o) { return b[o] | (b[o + 1] << 8); }
function avBackupU32(b, o) { return ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0); }

function avBackupNameDecode(b, utf8) {
  try { if (typeof avZipNameDecode === "function") return avZipNameDecode(b, utf8); } catch (e) { /* fallback below */ }
  let s = "";
  try {
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder(utf8 ? "utf-8" : "windows-1252", { fatal: false }).decode(b);
    }
  } catch (e) { /* fallback below */ }
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

function avBackupCrcFn() {
  try { return (typeof avZipCrc32 === "function") ? avZipCrc32 : null; } catch (e) { return null; }
}

function avBackupFindEntry(entries, name) {
  try {
    for (let i = 0; i < entries.length; i++) if (entries[i] && entries[i].name === name) return entries[i];
  } catch (e) { /* refuse */ }
  return null;
}

/* avBackupRead: OWN store-method reader. Never throws — structural problems refuse the read,
   per-entry problems (deflate, CRC mismatch, bad local header) are counted in errors[] and the
   entry is withheld. */
function avBackupRead(buf) {
  const out = { ok: false, error: null, entries: [], manifest: null, errors: [], count: 0, bytes: 0 };
  try {
    const b = avBackupBytes(buf);
    if (!b) { out.error = "unsupported buffer (ArrayBuffer or a typed-array view required)"; avBackupPush(out.errors, out.error); return out; }
    out.bytes = b.length;
    const n = b.length;
    if (n < 22) { out.error = "too short for an end-of-central-directory record"; avBackupPush(out.errors, out.error); return out; }
    const crcFn = avBackupCrcFn();
    if (typeof crcFn !== "function") {
      out.error = "CRC-32 helper (avZipCrc32 from av_zipc.js) is not loaded — entries cannot be validated";
      avBackupPush(out.errors, out.error); return out;
    }

    /* EOCD: backwards scan, comment-aware (same discipline as avZipInfo) */
    const floor = Math.max(0, n - 22 - 0xFFFF);
    let eocd = -1;
    for (let i = n - 22; i >= floor; i--) {
      if (b[i] === 0x50 && b[i + 1] === 0x4B && b[i + 2] === 0x05 && b[i + 3] === 0x06) {
        const clen = avBackupU16(b, i + 20);
        if (i + 22 + clen === n) { eocd = i; break; }
      }
    }
    if (eocd < 0) { out.error = "no end-of-central-directory record"; avBackupPush(out.errors, out.error); return out; }
    const count = avBackupU16(b, eocd + 10);
    const cdSize = avBackupU32(b, eocd + 12);
    const cdOff = avBackupU32(b, eocd + 16);
    if (count > AV_BACKUP_MAX_ENTRIES) { out.error = "implausible entry count (" + count + ") — refused"; avBackupPush(out.errors, out.error); return out; }
    if (cdOff === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) { out.error = "zip64 archives are not supported"; avBackupPush(out.errors, out.error); return out; }
    if (cdOff + cdSize > n) { out.error = "central directory out of range"; avBackupPush(out.errors, out.error); return out; }

    let p = cdOff;
    for (let i = 0; i < count; i++) {
      if (p + 46 > n) { out.error = "central directory truncated at entry " + i; avBackupPush(out.errors, out.error); return out; }
      if (!(b[p] === 0x50 && b[p + 1] === 0x4B && b[p + 2] === 0x01 && b[p + 3] === 0x02)) {
        out.error = "central directory corrupt at entry " + i; avBackupPush(out.errors, out.error); return out;
      }
      const flags = avBackupU16(b, p + 8);
      const method = avBackupU16(b, p + 10);
      const crc = avBackupU32(b, p + 16);
      const compSize = avBackupU32(b, p + 20);
      const unComp = avBackupU32(b, p + 24);
      const nameLen = avBackupU16(b, p + 28);
      const extraLen = avBackupU16(b, p + 30);
      const cmtLen = avBackupU16(b, p + 32);
      const loff = avBackupU32(b, p + 42);
      if (p + 46 + nameLen > n) { out.error = "central directory name truncated at entry " + i; avBackupPush(out.errors, out.error); return out; }
      const name = avBackupNameDecode(b.subarray(p + 46, p + 46 + nameLen), !!(flags & 0x0800));
      p += 46 + nameLen + extraLen + cmtLen;

      if (!name) { avBackupPush(out.errors, "zip: entry #" + i + " carries an empty name — skipped"); continue; }
      if (method !== AV_BACKUP_METHOD_STORE) {
        avBackupPush(out.errors, "zip: " + name + ": compression method " + method + " is not store (0) — skipped");
        continue;
      }
      if (compSize !== unComp) { avBackupPush(out.errors, "zip: " + name + ": stored sizes disagree — skipped"); continue; }
      if (loff + 30 > n) { avBackupPush(out.errors, "zip: " + name + ": local header out of range — skipped"); continue; }
      if (!(b[loff] === 0x50 && b[loff + 1] === 0x4B && b[loff + 2] === 0x03 && b[loff + 3] === 0x04)) {
        avBackupPush(out.errors, "zip: " + name + ": local header corrupt — skipped"); continue;
      }
      const lNameLen = avBackupU16(b, loff + 26);
      const lExtraLen = avBackupU16(b, loff + 28);
      const dataOff = loff + 30 + lNameLen + lExtraLen;
      if (dataOff + compSize > n) { avBackupPush(out.errors, "zip: " + name + ": data out of range — skipped"); continue; }
      const data = b.subarray(dataOff, dataOff + compSize);
      if (crcFn(data) !== crc) { avBackupPush(out.errors, "zip: " + name + ": CRC-32 mismatch — skipped (the data is damaged)"); continue; }
      out.entries.push({ name: name, size: compSize, bytes: data });
    }
    if (p > cdOff + cdSize + 0xFFFF) { out.error = "central directory overran its size"; avBackupPush(out.errors, out.error); return out; }

    /* the manifest rides inside the archive; parse it tolerantly (info for the caller, gate for restore) */
    const mani = avBackupFindEntry(out.entries, AV_BACKUP_MANIFEST);
    if (!mani) {
      avBackupPush(out.errors, "manifest.json is missing — this zip is not an Anvil backup");
    } else {
      let obj = null;
      try { obj = JSON.parse(avBackupUtf8Decode(mani.bytes)); } catch (e) { obj = null; }
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        avBackupPush(out.errors, "manifest.json is not a JSON object — ignored");
      } else {
        out.manifest = obj;
        if (obj.app !== AV_BACKUP_APP) avBackupPush(out.errors, "manifest: app is " + String(obj.app) + " (expected \"anvil\")");
        else if (obj.v !== 1) avBackupPush(out.errors, "manifest: unsupported version " + String(obj.v));
        if (obj.sha256 != null && (typeof obj.sha256 !== "object" || Array.isArray(obj.sha256))) {
          avBackupPush(out.errors, "manifest: sha256 map is not an object — ignored");
        }
      }
    }
    out.ok = true;
    out.count = out.entries.length;
    return out;
  } catch (e) {
    out.ok = false;
    out.error = "zip read failed: " + avBackupErrText(e);
    avBackupPush(out.errors, out.error);
    return out;
  }
}

/* ---------- build (avZipBuild + avWavEncode + the sibling export paths, all guarded) ---------- */

function avBackupCountSessions(bytes) {
  try {
    const obj = JSON.parse(avBackupUtf8Decode(bytes));
    if (obj && Array.isArray(obj.sessions)) return obj.sessions.length;
  } catch (e) { /* unparseable */ }
  return 0;
}

function avBackupBuild(opts) {
  return new Promise(function (resolve) {
    const out = { ok: false, error: null, name: null, bytes: 0, buffer: null, manifest: null, skipped: [], at: 0 };
    let done = false;
    const finish = function () {
      if (done) return; done = true;
      try { avBackupStore.busy = Math.max(0, avBackupStore.busy - 1); } catch (e) { /* ok */ }
      try { resolve(out); } catch (e) { /* resolve never throws */ }
    };
    try {
      avBackupStore.busy += 1;
      avBackupBuildRun(opts, out).then(
        function () { finish(); },
        function (e) {
          out.ok = false;
          out.error = "backup build failed: " + avBackupErrText(e);
          avBackupPush(out.skipped, out.error);
          finish();
        }
      );
    } catch (e) {
      out.ok = false;
      out.error = "backup build failed: " + avBackupErrText(e);
      avBackupPush(out.skipped, out.error);
      finish();
    }
  });
}

async function avBackupBuildRun(opts, out) {
  const o = (opts && typeof opts === "object" && !Array.isArray(opts)) ? opts : {};
  const skipped = out.skipped;
  let now = avBackupNow();
  try { const n0 = Number(o.now); if (isFinite(n0) && n0 >= 0) now = Math.round(n0); } catch (e) { /* default */ }
  out.at = now;
  let date = (o.date === undefined) ? new Date(now) : o.date;   /* null passes through (deterministic epoch) */

  /* 1) sessions: the whole avSessionExport() payload */
  let sessionsPayload = { v: 1, sessions: [] };
  try {
    if (typeof avSessionExport === "function") {
      let s = avSessionExport();
      if (s && typeof s.then === "function") s = await s;
      if (s && typeof s === "object" && !Array.isArray(s)) sessionsPayload = s;
      else avBackupPush(skipped, "sessions: avSessionExport() returned nothing usable — sessions.json left empty");
    } else {
      avBackupPush(skipped, "sessions: av_session.js is not loaded — sessions.json left empty");
    }
  } catch (e) {
    avBackupPush(skipped, "sessions: export failed (" + avBackupErrText(e) + ") — sessions.json left empty");
  }
  let sessionsCount = Array.isArray(sessionsPayload.sessions) ? sessionsPayload.sessions.length : 0;

  /* 2) packs: one entry per INSTALLED pack, the avStoreGet(id) record verbatim */
  const packItems = [];
  if (typeof avStoreGet === "function") {
    let list = [];
    if (typeof avStoreStatus === "function") {
      try { const stt = avStoreStatus(); list = (stt && Array.isArray(stt.installed)) ? stt.installed : []; } catch (e) { list = []; }
    }
    if (!list.length && typeof avStoreInstalled === "function") {
      try { list = avStoreInstalled() || []; } catch (e) { list = []; }
    }
    if (!Array.isArray(list)) list = [];
    const seen = {};
    for (let i = 0; i < list.length; i++) {
      const id = (list[i] && typeof list[i].id === "string") ? list[i].id : "";
      if (!id || seen[id]) continue;
      seen[id] = true;
      let rec = null;
      try { rec = avStoreGet(id); } catch (e) { rec = null; }
      if (rec && typeof rec === "object" && rec.pack && typeof rec.pack === "object" && !Array.isArray(rec.pack)) {
        packItems.push({ id: id, payload: rec });
      } else {
        avBackupPush(skipped, "packs: " + id + ": payload unavailable — skipped");
      }
    }
  } else {
    avBackupPush(skipped, "packs: av_store.js is not loaded — no packs in this backup");
  }

  /* 3) samples: one WAV per non-empty slot whose audio is still in the registry */
  const sampleItems = [];
  const sampleStore = (typeof avSampleStore !== "undefined" && avSampleStore) ? avSampleStore : null;
  if (!sampleStore) {
    avBackupPush(skipped, "samples: av_sample.js is not loaded — no samples in this backup");
  } else if (Array.isArray(sampleStore.sent) && sampleStore.sent.length) {
    if (typeof avWavEncode !== "function") {
      avBackupPush(skipped, "samples: av_wavio.js is not loaded — samples cannot be encoded");
    } else {
      for (let slot = 0; slot < sampleStore.sent.length && slot < 4; slot++) {
        const rec = sampleStore.sent[slot];
        if (!rec) continue;
        const rid = (typeof rec.id === "string") ? rec.id : "";
        let entry = null;
        try { entry = (rid && typeof sampleStore.get === "function") ? sampleStore.get(rid) : null; } catch (e) { entry = null; }
        const buf = (entry && entry.buffer) ? entry.buffer : null;
        if (!buf || typeof buf.getChannelData !== "function") {
          avBackupPush(skipped, "samples: slot " + slot + " (" + avBackupSafeName(rec.name || rid, "sample") + ") has no audio in the registry — skipped");
          continue;
        }
        const rate = (isFinite(buf.sampleRate) && buf.sampleRate > 0) ? Math.round(buf.sampleRate) :
          ((isFinite(entry.sampleRate) && entry.sampleRate > 0) ? Math.round(entry.sampleRate) : 48000);
        let frames = (isFinite(buf.length) && buf.length > 0) ? (buf.length | 0) : 0;
        const cap = Math.round(AV_BACKUP_SAMPLE_CAP_S * rate);
        if (frames > cap) frames = cap;
        if (frames <= 0) { avBackupPush(skipped, "samples: slot " + slot + ": empty audio — skipped"); continue; }
        let wav = null;
        try {
          const ch1 = buf.getChannelData(0);
          const ch2 = (buf.numberOfChannels > 1) ? buf.getChannelData(1) : ch1;
          if (!ch1 || !ch2) { avBackupPush(skipped, "samples: slot " + slot + ": channel data unavailable — skipped"); continue; }
          const m = Math.min(frames, ch1.length, ch2.length);
          if (m <= 0) { avBackupPush(skipped, "samples: slot " + slot + ": empty audio — skipped"); continue; }
          wav = avWavEncode({ l: ch1.subarray(0, m), r: ch2.subarray(0, m), sr: rate, bits: "32f" });
        } catch (e) { wav = null; }
        if (!wav) { avBackupPush(skipped, "samples: slot " + slot + ": WAV encode refused — skipped"); continue; }
        sampleItems.push({ slot: slot, name: avBackupSafeName(entry.name || rec.name, "sample"), data: wav });
      }
    }
  }

  /* 4) entry payloads (text entries as strings; WAVs as their ArrayBuffers) + digests */
  const data = [];                        /* [{ name, text }] — WAVs handled separately below */
  const sessText = avBackupJson(sessionsPayload);
  if (sessText == null) {
    avBackupPush(skipped, "sessions: payload is not JSON-safe — sessions.json left empty");
    sessionsCount = 0;
    data.push({ name: AV_BACKUP_SESSIONS, text: "{\"v\":1,\"sessions\":[]}" });
  } else {
    data.push({ name: AV_BACKUP_SESSIONS, text: sessText });
  }
  for (let i = 0; i < packItems.length; i++) {
    const t = avBackupJson(packItems[i].payload);
    if (t == null) { avBackupPush(skipped, "packs: " + packItems[i].id + ": payload is not JSON-safe — skipped"); continue; }
    data.push({ name: AV_BACKUP_PACK_DIR + packItems[i].id + ".json", text: t });
  }
  const packsCount = data.length - 1;                    /* entries after sessions.json so far */
  const counts = { sessions: sessionsCount, packs: packsCount, samples: sampleItems.length };
  let atIso = "";
  try { atIso = new Date(now).toISOString(); } catch (e) { atIso = ""; }
  const readme = "Anvil backup — " + counts.sessions + " session(s), " + counts.packs + " installed pack(s), " +
    counts.samples + " sample slot(s).\n" +
    "Restore: open Anvil → SESSIONS card → RESTORE (backup zip), or call avBackupRestore(buffer) in the console. " +
    "Restore is additive — nothing you currently have is deleted; a session or pack whose id you already hold is left untouched.\n" +
    "Built " + (atIso || String(now)) + " · app: anvil · schema v1 · sample WAVs are 32-bit float.\n";

  /* digests cover every content entry; manifest.json itself is the signature file (no self-digest) */
  const shaMap = {};
  let shaNotes = 0;
  if (avBackupSubtle()) {
    const all = [];
    for (let i = 0; i < data.length; i++) all.push({ name: data[i].name, bytes: avBackupUtf8(data[i].text) });
    for (let i = 0; i < sampleItems.length; i++) {
      all.push({ name: AV_BACKUP_SAMPLE_DIR + "slot" + sampleItems[i].slot + "-" + sampleItems[i].name + ".wav", bytes: avBackupBytes(sampleItems[i].data) });
    }
    all.push({ name: AV_BACKUP_README, bytes: avBackupUtf8(readme) });
    for (let i = 0; i < all.length; i++) {
      const h = await avBackupSha256Hex(all[i].bytes);
      if (!h) { shaNotes += 1; break; }
      shaMap[all[i].name] = h;
    }
    if (shaNotes) avBackupPush(skipped, "sha256: crypto.subtle refused mid-run — some digests are missing from the manifest");
  } else {
    avBackupPush(skipped, "sha256: crypto.subtle is unavailable — the manifest carries no digests");
  }
  const manifest = { v: 1, app: AV_BACKUP_APP, at: atIso, sha256: shaMap, counts: counts };
  const manText = avBackupJson(manifest);
  if (manText == null) { out.ok = false; out.error = "manifest is not JSON-safe — build refused"; return; }

  /* 5) assemble in the pinned layout order: manifest, sessions, packs, samples, README */
  const zipEntries = [{ name: AV_BACKUP_MANIFEST, data: manText }];
  for (let i = 0; i < data.length; i++) zipEntries.push({ name: data[i].name, data: data[i].text });
  for (let i = 0; i < sampleItems.length; i++) {
    zipEntries.push({ name: AV_BACKUP_SAMPLE_DIR + "slot" + sampleItems[i].slot + "-" + sampleItems[i].name + ".wav", data: sampleItems[i].data });
  }
  zipEntries.push({ name: AV_BACKUP_README, data: readme });

  if (typeof avZipBuild !== "function") { out.ok = false; out.error = "av_zipc.js (avZipBuild) is not loaded — cannot build a backup"; return; }
  let buf = null;
  try { buf = avZipBuild(zipEntries, { date: date }); } catch (e) { buf = null; }
  if (!buf || typeof buf.byteLength !== "number") {
    out.ok = false;
    out.error = "avZipBuild refused the archive (bad opts.date or an entry was refused)";
    return;
  }
  out.ok = true;
  out.name = "anvil-backup-" + avBackupStamp(now) + ".zip";
  out.bytes = buf.byteLength;
  out.buffer = buf;
  out.manifest = manifest;
  try {
    avBackupStore.lastBuild = { name: out.name, bytes: out.bytes, at: now, counts: counts };
    avBackupStore.lastError = null;
  } catch (e) { /* nicety */ }
}

/* ---------- restore (additive; the siblings' own write paths; never a re-implemented schema) ---------- */

function avBackupRestore(input, mode) {
  return new Promise(function (resolve) {
    const out = {
      ok: false, error: null,
      restored: { sessions: 0, packs: 0, samples: 0 },
      skipped: 0,                                   /* flat total (the card reads a number) */
      skippedBy: { sessions: 0, packs: 0, samples: 0 },
      errors: [], notes: [], at: 0,
    };
    let done = false;
    const finish = function () {
      if (done) return; done = true;
      try { out.skipped = out.skippedBy.sessions + out.skippedBy.packs + out.skippedBy.samples; } catch (e) { /* ok */ }
      try { out.at = avBackupNow(); } catch (e) { /* ok */ }
      try { avBackupStore.busy = Math.max(0, avBackupStore.busy - 1); } catch (e) { /* ok */ }
      try {
        avBackupStore.lastRestore = {
          at: out.at, ok: !!out.ok,
          restored: out.restored, skipped: out.skipped, skippedBy: out.skippedBy,
          errorCount: out.errors.length, errors: out.errors.slice(0, 8), notes: out.notes.slice(0, 4),
        };
        if (!out.ok) avBackupStore.lastError = out.error;
      } catch (e) { /* nicety */ }
      try { resolve(out); } catch (e) { /* resolve never throws */ }
    };
    try {
      avBackupStore.busy += 1;
      Promise.resolve(avBackupRestoreRun(input, mode, out)).then(finish, function (e) {
        out.ok = false;
        out.error = "restore failed: " + avBackupErrText(e);
        avBackupPush(out.errors, out.error);
        finish();
      });
    } catch (e) {
      out.ok = false;
      out.error = "restore failed: " + avBackupErrText(e);
      avBackupPush(out.errors, out.error);
      finish();
    }
  });
}

async function avBackupRestoreRun(input, mode, out) {
  /* 0) the read (accept a raw buffer/view or a previous avBackupRead result) */
  let read = null;
  if (input && typeof input === "object" && Array.isArray(input.entries) && typeof input.ok === "boolean") read = input;
  else read = avBackupRead(input);
  if (!read || read.ok !== true) {
    out.ok = false;
    out.error = "zip not readable" + (read && read.error ? ": " + read.error : "");
    const errs = (read && Array.isArray(read.errors)) ? read.errors : [];
    for (let i = 0; i < errs.length; i++) avBackupPush(out.errors, errs[i]);
    avBackupPush(out.errors, out.error);
    return;
  }
  /* reader-level refusals (withheld entries: CRC, deflate, ...) are part of the restore story */
  if (Array.isArray(read.errors)) {
    for (let i = 0; i < read.errors.length; i++) avBackupPush(out.errors, read.errors[i]);
  }

  /* 1) the manifest gates the restore */
  const man = read.manifest;
  if (!man || typeof man !== "object" || Array.isArray(man)) {
    out.ok = false;
    out.error = "manifest.json is missing or unreadable — restore refused (an Anvil backup always carries one)";
    avBackupPush(out.errors, out.error);
    return;
  }
  if (man.app !== AV_BACKUP_APP) {
    out.ok = false;
    out.error = "not an Anvil backup (manifest.app = " + String(man.app) + ") — restore refused";
    avBackupPush(out.errors, out.error);
    return;
  }
  if (man.v !== 1) {
    out.ok = false;
    out.error = "unsupported backup version " + String(man.v) + " — restore refused (this build reads v1)";
    avBackupPush(out.errors, out.error);
    return;
  }

  /* 2) mode ('all' default; a subset selector is allowed, additive either way) */
  let only = null;
  if (mode === "sessions" || mode === "packs" || mode === "samples") only = mode;
  else if (mode != null && mode !== "all") out.notes.push("mode " + String(mode) + " is unknown — restoring everything");

  /* 3) manifest.sha256 re-verification (mismatch/malformed -> the entry is withheld) */
  const shaBad = {};
  const map = (man.sha256 && typeof man.sha256 === "object" && !Array.isArray(man.sha256)) ? man.sha256 : null;
  const subtleOK = !!avBackupSubtle();
  let verified = 0, unverified = 0, noDigest = 0;
  for (let i = 0; i < read.entries.length; i++) {
    const e = read.entries[i];
    if (e.name === AV_BACKUP_MANIFEST) continue;          /* the signature file has no self-digest */
    let want = map ? map[e.name] : null;
    if (typeof want === "string") want = want.trim().toLowerCase();
    if (want == null || want === "") { noDigest += 1; continue; }
    if (!AV_BACKUP_SHA_RE.test(want)) {
      shaBad[e.name] = true;
      avBackupPush(out.errors, "sha: " + e.name + ": manifest digest is malformed — entry withheld");
      continue;
    }
    if (!subtleOK) { unverified += 1; continue; }
    const got = await avBackupSha256Hex(e.bytes);
    if (!got) { unverified += 1; continue; }
    if (got !== want) {
      shaBad[e.name] = true;
      avBackupPush(out.errors, "sha: " + e.name + ": digest mismatch — entry withheld (not restored)");
    } else verified += 1;
  }
  if (verified) out.notes.push("sha: " + verified + " entr(ies) match their manifest digests");
  if (unverified) out.notes.push("sha: " + unverified + " entr(ies) could not be verified (crypto.subtle unavailable)");
  if (noDigest) out.notes.push("sha: " + noDigest + " entr(ies) carried no manifest digest (unverified)");

  /* 4) sessions — via avSessionImport (its own id-dedupe law) */
  if (!only || only === "sessions") {
    const se = avBackupFindEntry(read.entries, AV_BACKUP_SESSIONS);
    if (!se) {
      avBackupPush(out.errors, "sessions: sessions.json is missing from the zip — nothing restored");
    } else if (shaBad[se.name]) {
      const c = avBackupCountSessions(se.bytes);
      out.skippedBy.sessions += (c > 0 ? c : 1);          /* withheld by the sha gate (error already noted) */
    } else if (typeof avSessionImport !== "function") {
      const c = avBackupCountSessions(se.bytes);
      out.skippedBy.sessions += (c > 0 ? c : 1);
      avBackupPush(out.errors, "sessions: av_session.js is not loaded — sessions not restored (they stay in the zip)");
    } else {
      let payload = null;
      try { payload = JSON.parse(avBackupUtf8Decode(se.bytes)); } catch (e) { payload = null; }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        out.skippedBy.sessions += 1;
        avBackupPush(out.errors, "sessions: sessions.json is not a JSON object — skipped");
      } else {
        let r = null;
        try { r = await avSessionImport(payload); } catch (e) {
          r = null;
          avBackupPush(out.errors, "sessions: import refused (" + avBackupErrText(e) + ")");
        }
        if (r && typeof r === "object") {
          out.restored.sessions += avBackupInt(r.imported);
          out.skippedBy.sessions += avBackupInt(r.skipped);
          /* av_session's ok is false whenever ANY id was deduped (normal additive behaviour) —
             only a wholly empty result or a hard `error` string is a problem worth listing */
          if (r.ok === false && typeof r.error === "string" && r.error) {
            avBackupPush(out.errors, "sessions: the session module reported " + r.error);
          } else if (r.ok === false && avBackupInt(r.imported) === 0 && avBackupInt(r.skipped) === 0) {
            avBackupPush(out.errors, "sessions: the session module reported ok:false (nothing imported)");
          }
        } else if (r == null) {
          const c = avBackupCountSessions(se.bytes);
          out.skippedBy.sessions += (c > 0 ? c : 1);
        } else {
          avBackupPush(out.errors, "sessions: import returned nothing usable — skipped");
          out.skippedBy.sessions += 1;
        }
      }
    }
  }

  /* 5) packs — through the store's OWN machinery (hydrate -> get -> norm -> commit) */
  if (!only || only === "packs") {
    const packEntries = [];
    for (let i = 0; i < read.entries.length; i++) {
      const nm = read.entries[i].name;
      if (nm.slice(0, AV_BACKUP_PACK_DIR.length) === AV_BACKUP_PACK_DIR && nm.slice(-5) === ".json") packEntries.push(read.entries[i]);
    }
    const storeReady = (typeof avStoreGet === "function" && typeof avStoreCommit === "function");
    if (packEntries.length && !storeReady) {
      avBackupPush(out.errors, "packs: av_store.js install machinery is not loaded — packs not restored (they stay in the zip)");
    }
    let hydrated = false;
    for (let i = 0; i < packEntries.length; i++) {
      const pe = packEntries[i];
      if (shaBad[pe.name]) { out.skippedBy.packs += 1; continue; }
      const base = pe.name.slice(AV_BACKUP_PACK_DIR.length, pe.name.length - 5);
      let payload = null;
      try { payload = JSON.parse(avBackupUtf8Decode(pe.bytes)); } catch (e) { payload = null; }
      if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
          !payload.pack || typeof payload.pack !== "object" || Array.isArray(payload.pack)) {
        out.skippedBy.packs += 1;
        avBackupPush(out.errors, "packs/" + base + ": not a pack record — skipped");
        continue;
      }
      let id = (typeof payload.id === "string") ? payload.id.trim() : base;
      if (!AV_BACKUP_ID_RE.test(id)) {
        out.skippedBy.packs += 1;
        avBackupPush(out.errors, "packs/" + base + ": id is not a valid slug — skipped");
        continue;
      }
      if (!storeReady) { out.skippedBy.packs += 1; continue; }
      if (!hydrated) {
        hydrated = true;
        if (typeof avStoreHydrate === "function") { try { await avStoreHydrate(); } catch (e) { /* commit still tries */ } }
      }
      let existing = null;
      try { existing = avStoreGet(id); } catch (e) { existing = null; }
      if (existing) {
        out.skippedBy.packs += 1;
        out.notes.push("packs: " + id + " is already installed — the installed copy was kept (additive restore)");
        continue;
      }
      let record = payload;
      if (typeof avStoreRecordNorm === "function") {
        try { const nrm = avStoreRecordNorm(id, payload); if (nrm) record = nrm; } catch (e) { /* use the payload as-is */ }
      }
      try { if (record && typeof record === "object") record.id = id; } catch (e) { /* frozen payload: commit as-is */ }
      let put = null;
      try { put = await avStoreCommit(record); } catch (e) { put = null; }
      if (put && put.ok === true) {
        out.restored.packs += 1;
      } else {
        out.skippedBy.packs += 1;
        const why = (put && typeof put.error === "string" && put.error) ? put.error : "unknown";
        avBackupPush(out.errors, "packs: " + id + ": the store refused the write (" + why + ")");
      }
    }
    /* entries under packs/ that are not .json — ignored, counted once */
    let otherPacks = 0;
    for (let i = 0; i < read.entries.length; i++) {
      const nm = read.entries[i].name;
      if (nm.slice(0, AV_BACKUP_PACK_DIR.length) === AV_BACKUP_PACK_DIR && nm.slice(-5) !== ".json") otherPacks += 1;
    }
    if (otherPacks) out.notes.push("packs: " + otherPacks + " non-json entr(ies) under packs/ were ignored");
  }

  /* 6) samples — via av_sample's import hook (best-effort; slot routing is live state) */
  if (!only || only === "samples") {
    const matched = [];
    let ignored = 0;
    for (let i = 0; i < read.entries.length; i++) {
      const nm = read.entries[i].name;
      if (nm.slice(0, AV_BACKUP_SAMPLE_DIR.length) !== AV_BACKUP_SAMPLE_DIR) continue;
      const m = AV_BACKUP_SAMPLE_NAME_RE.exec(nm);
      if (m) matched.push({ entry: read.entries[i], slot: parseInt(m[1], 10), part: m[2] || "" });
      else { ignored += 1; out.skippedBy.samples += 1; avBackupPush(out.errors, "samples: unrecognized entry " + nm + " — ignored"); }
    }
    matched.sort(function (a, b) { return (a.slot - b.slot) || (a.entry.name < b.entry.name ? -1 : (a.entry.name > b.entry.name ? 1 : 0)); });
    if (matched.length) {
      if (typeof avSampleImportFiles !== "function") {
        out.skippedBy.samples += matched.length;
        avBackupPush(out.errors, "samples: av_sample.js exposes no import hook in this build — sample restore is best-effort only and could not run (the WAVs stay in the zip)");
        out.notes.push("Undetermined: samples were not restored (no import hook to call)");
      } else {
        const items = [];
        for (let i = 0; i < matched.length; i++) {
          const me = matched[i];
          if (shaBad[me.entry.name]) { out.skippedBy.samples += 1; continue; }
          if (typeof avWavInfo === "function") {
            let wi = null;
            try { wi = avWavInfo(me.entry.bytes); } catch (e) { wi = null; }
            if (wi && wi.ok !== true) {
              out.skippedBy.samples += 1;
              avBackupPush(out.errors, "samples: " + me.entry.name + ": not a readable WAV (" + String(wi.error) + ") — skipped");
              continue;
            }
          }
          const file = avBackupSampleFile(me.entry, me.part);
          if (!file) { out.skippedBy.samples += 1; avBackupPush(out.errors, "samples: " + me.entry.name + ": could not be handed over — skipped"); continue; }
          items.push(file);
        }
        if (items.length) {
          let r = null;
          try { r = await avSampleImportFiles(items); } catch (e) {
            r = null;
            avBackupPush(out.errors, "samples: import refused (" + avBackupErrText(e) + ")");
          }
          if (r && typeof r === "object") {
            const added = Array.isArray(r.added) ? r.added.length : avBackupInt(r.added);
            out.restored.samples += added;
            out.skippedBy.samples += Math.max(0, items.length - added);
            if (Array.isArray(r.errors)) {
              for (let i = 0; i < r.errors.length && i < AV_BACKUP_MAX_ERRORS; i++) avBackupPush(out.errors, "samples: " + String(r.errors[i]));
            }
            out.notes.push("samples: audio restored into the registry; engine slot routing (sendToEngine) is live state and was not re-applied");
          } else if (r == null) {
            out.skippedBy.samples += items.length;
          }
        }
      }
    }
  }

  out.ok = true;
}

/* a File object when the platform has one (name preserved for the decode path), else a byte copy */
function avBackupSampleFile(entry, part) {
  const name = ((part && part.length) ? part : "sample") + ".wav";
  try {
    if (typeof File === "function") return new File([entry.bytes], name, { type: "audio/wav" });
  } catch (e) { /* fall through to the copy */ }
  try { return entry.bytes.slice().buffer; } catch (e) { return null; }
}

/* ---------- public surface ---------- */

function avBackupInit() {
  try { avBackupStore.inited = true; return true; } catch (e) { return false; }
}

function avBackupState() {
  try {
    const st = avBackupStore;
    return {
      version: AV_BACKUP_VERSION,
      init: !!st.inited,
      busy: st.busy > 0,
      lastBuild: st.lastBuild ? { name: st.lastBuild.name, bytes: st.lastBuild.bytes, at: st.lastBuild.at, counts: st.lastBuild.counts } : null,
      lastRestore: st.lastRestore ? {
        at: st.lastRestore.at, ok: !!st.lastRestore.ok,
        restored: { sessions: st.lastRestore.restored.sessions, packs: st.lastRestore.restored.packs, samples: st.lastRestore.restored.samples },
        skipped: (typeof st.lastRestore.skipped === "number") ? st.lastRestore.skipped : 0,
        skippedBy: st.lastRestore.skippedBy ? {
          sessions: st.lastRestore.skippedBy.sessions, packs: st.lastRestore.skippedBy.packs, samples: st.lastRestore.skippedBy.samples,
        } : { sessions: 0, packs: 0, samples: 0 },
        errorCount: st.lastRestore.errorCount, errors: st.lastRestore.errors.slice(), notes: st.lastRestore.notes.slice(),
      } : null,
      lastError: st.lastError,
    };
  } catch (e) {
    return { version: AV_BACKUP_VERSION, init: false, busy: false, lastBuild: null, lastRestore: null, lastError: "state: " + avBackupErrText(e) };
  }
}

/* the card adds shared classes later; this module mounts nothing (S1 metro convention) */
function avBackupClasses() { return []; }

if (typeof window !== "undefined") {
  try {
    window.__avBackup = {
      version: AV_BACKUP_VERSION,
      init: avBackupInit,
      build: avBackupBuild,
      read: avBackupRead,
      restore: avBackupRestore,
      state: avBackupState,
    };
  } catch (e) { /* a locked-down window is not a reason to fail the script */ }
}
