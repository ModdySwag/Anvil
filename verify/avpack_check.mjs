#!/usr/bin/env node
/* verify/avpack_check.mjs - strict `.avpack` CLI verifier (Anvil R19 wave, child D).
   THE wave CLI: re-witnesses a user pack in plain node (no CDP, no Chrome, no DOM).

   Contract: verify/_r19_wave.md section 2 (THE table) + section 6 pin 2. Per pack:
     parse the zip (node:zlib; stored 0 + deflate-raw 8; the EOCD/central walk mirrors
     src/av_zip.js) -> container laws (required member manifest.json; every member name
     relative: no leading "/", no ".." segments, no backslashes; the two methods only; no
     encryption; no duplicate names) -> validate manifest.json (verify/avpack_schema.mjs,
     UTF-8 strict) -> for EVERY item row: locate the member at row.path, extract the bytes,
     verify the row's sha256 (the same gate the import route applies BEFORE commit) and the
     row's size -> honest per-item table + counts. VERDICT DISCIPLINE STRICT: exit 0 iff
     the container is clean, the manifest validates, and every item verifies.

   CLI:
     node verify/avpack_check.mjs <path.avpack>    verify one pack file (strict exit 0/1)
     node verify/avpack_check.mjs --selftest       build + validate a tiny in-memory pack:
                                                   positive checks + 9 negative controls +
                                                   sha256/crc32 vectors (CI-safe, no disk)
     node verify/avpack_check.mjs --help

   Laws: never throws (the top-level guard prints an honest report); repo READ-ONLY, stdout
   only - no log files (the only sanctioned fixture write in this wave is cache/r19/, by the
   caller). CRC32 mismatches inside an item are WARNINGS (src/av_zip.js precedent: data is
   returned) - sha256 is the refusal gate. Extra members are reported but tolerated
   (forward-compat, consistent with "unknown extra keys are tolerated"). Junk input, zip64,
   multi-disk and encrypted archives are honest refusals.                                              */
"use strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import * as SCHEMA from "./avpack_schema.mjs";

/* ---------------- paths & constants ---------------- */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

const EOCD_SIG = 0x06054B50;      /* end of central directory record  */
const CD_SIG = 0x02014B50;        /* central directory file header    */
const LFH_SIG = 0x04034B50;       /* local file header                */
const Z64_LOC_SIG = 0x07064B50;   /* zip64 EOCD locator               */

const EOCD_MIN = 22;              /* EOCD size, empty comment         */
const EOCD_COMMENT_MAX = 0xFFFF;  /* comment length field is u16      */
const CD_ENTRY_MIN = 46;          /* central entry, no name/extra/com */
const U32_FF = 0xFFFFFFFF;        /* zip64 sentinel                   */
const U16_FF = 0xFFFF;            /* zip64 sentinel                   */

const FLAG_ENCRYPTED = 0x0001;    /* general purpose bit 0            */
const FLAG_UTF8 = 0x0800;         /* general purpose bit 11           */
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const EXTRACT_MAX = 96 * 1024 * 1024;   /* per-entry cap (mirrors src/av_zip.js) */

const DOS_EPOCH_DATE = 0x0021;    /* 1980-01-01 (src/av_zipc.js law)  */
const DOS_EPOCH_TIME = 0x0000;

/* ---------------- logging (stdout only) ---------------- */
let harnessFails = 0;
function log(s) { console.log(String(s)); }
function check(name, ok, detail) {
  if (!ok) harnessFails++;
  log("  " + (ok ? "PASS" : "FAIL") + "  " + name + (detail !== undefined && detail !== "" ? "  ::  " + detail : ""));
  return !!ok;
}
function msgOf(e) { return String(e && e.message || e); }
function val(v) {
  try { return typeof v === "number" ? String(v) : JSON.stringify(v); }
  catch (e) { return "(unprintable)"; }
}
function padCell(s, n) {
  let t = (s === undefined || s === null) ? "" : String(s);
  if (t.length > n) t = t.slice(0, n > 1 ? n - 1 : n) + "~";
  while (t.length < n) t += " ";
  return t;
}

/* ---------------- byte + hash helpers ---------------- */

function toBuf(x) {
  try {
    if (Buffer.isBuffer(x)) return x;
    if (x instanceof Uint8Array) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
    if (x instanceof ArrayBuffer) return Buffer.from(x);
    return null;
  } catch (e) { return null; }
}
function sha256hex(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

let crcTab = null;
function crcTable() {
  if (crcTab) return crcTab;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  crcTab = t;
  return t;
}
function crc32(buf) {   /* standard CRC-32, poly 0xEDB88320, init/final 0xFFFFFFFF */
  const b = toBuf(buf);
  if (!b) return 0;
  const t = crcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = (c >>> 8) ^ t[(c ^ b[i]) & 255];
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ---------------- the zip reader (mirrors src/av_zip.js semantics) ---------------- */

/* EOCD: signature sweep from the end, comment-aware (a planted signature inside comment
   bytes fails the length check, so the sweep keeps walking back instead of accepting it). */
function findEocd(b) {
  if (b.length < EOCD_MIN) return -1;
  const minPos = Math.max(0, b.length - EOCD_MIN - EOCD_COMMENT_MAX);
  for (let pos = b.length - EOCD_MIN; pos >= minPos; pos--) {
    if (b[pos] !== 0x50 || b[pos + 1] !== 0x4B || b[pos + 2] !== 0x05 || b[pos + 3] !== 0x06) continue;
    if (pos + EOCD_MIN + b.readUInt16LE(pos + 20) === b.length) return pos;
  }
  return -1;
}

/* zipRead(input) -> { ok, buf, entries: [{name, method, flags, crc, compSize, uncompSize,
   localOff}], error? }. Never throws; junk -> a short error. */
function zipRead(input) {
  const b = toBuf(input);
  if (!b) return { ok: false, error: "bad input" };
  if (b.length < EOCD_MIN) return { ok: false, error: "not a zip" };
  const eocd = findEocd(b);
  if (eocd < 0) return { ok: false, error: "not a zip" };
  if (eocd >= 20 && b.readUInt32LE(eocd - 20) === Z64_LOC_SIG) return { ok: false, error: "zip64 not supported" };
  const diskNo = b.readUInt16LE(eocd + 4);
  const cdDisk = b.readUInt16LE(eocd + 6);
  const nThis = b.readUInt16LE(eocd + 8);
  const nTotal = b.readUInt16LE(eocd + 10);
  const cdSize = b.readUInt32LE(eocd + 12);
  const cdOff = b.readUInt32LE(eocd + 16);
  if (nThis === U16_FF || nTotal === U16_FF || cdSize === U32_FF || cdOff === U32_FF) return { ok: false, error: "zip64 not supported" };
  if (diskNo !== 0 || cdDisk !== 0 || nThis !== nTotal) return { ok: false, error: "multi-disk zip not supported" };
  if (cdOff + cdSize > eocd) return { ok: false, error: "unreadable central directory" };
  const entries = [];
  let p = cdOff;
  const end = cdOff + cdSize;
  for (let i = 0; i < nTotal; i++) {
    if (p + CD_ENTRY_MIN > end || b.readUInt32LE(p) !== CD_SIG) return { ok: false, error: "unreadable central directory" };
    const flags = b.readUInt16LE(p + 8);
    const method = b.readUInt16LE(p + 10);
    const crc = b.readUInt32LE(p + 16);
    const compSize = b.readUInt32LE(p + 20);
    const uncompSize = b.readUInt32LE(p + 24);
    const nlen = b.readUInt16LE(p + 28);
    const elen = b.readUInt16LE(p + 30);
    const clen = b.readUInt16LE(p + 32);
    if (p + CD_ENTRY_MIN + nlen + elen + clen > end) return { ok: false, error: "unreadable central directory" };
    const name = b.subarray(p + CD_ENTRY_MIN, p + CD_ENTRY_MIN + nlen).toString((flags & FLAG_UTF8) ? "utf8" : "latin1");
    entries.push({ name: name, method: method, flags: flags, crc: crc, compSize: compSize, uncompSize: uncompSize, localOff: b.readUInt32LE(p + 42) });
    p += CD_ENTRY_MIN + nlen + elen + clen;
  }
  return { ok: true, buf: b, entries: entries };
}

/* zipExtract(zr, ent) -> { ok, name, bytes, warnings, error? }. Locates the data via the
   local header (data-descriptor entries are fine - sizes come from the central directory).
   CRC32 and uncompressed-size mismatches are warnings (data is still returned), exactly the
   src/av_zip.js posture; method/encryption/zip64 refusals are honest errors. */
function zipExtract(zr, ent) {
  const miss = (error) => ({ ok: false, name: ent.name, bytes: null, warnings: [], error: error });
  try {
    if (ent.flags & FLAG_ENCRYPTED) return miss("encrypted entry");
    if (ent.uncompSize === U32_FF || ent.compSize === U32_FF) return miss("zip64 not supported");
    if (ent.method !== METHOD_STORE && ent.method !== METHOD_DEFLATE) return miss("method " + ent.method + " not supported");
    if (ent.uncompSize > EXTRACT_MAX || ent.compSize > EXTRACT_MAX) return miss("entry too large");
    const b = zr.buf;
    const lho = ent.localOff;
    if (lho + 30 > b.length) return miss("truncated entry");
    if (b.readUInt32LE(lho) !== LFH_SIG) return miss("bad local header");
    const lnlen = b.readUInt16LE(lho + 26);
    const lelen = b.readUInt16LE(lho + 28);
    const dstart = lho + 30 + lnlen + lelen;
    if (dstart + ent.compSize > b.length) return miss("truncated entry");
    let data = null;
    if (ent.method === METHOD_STORE) data = b.subarray(dstart, dstart + ent.compSize);
    else {
      try { data = zlib.inflateRawSync(b.subarray(dstart, dstart + ent.compSize)); }
      catch (e) { return miss("inflate failed"); }
    }
    const warnings = [];
    if (data.length !== ent.uncompSize) warnings.push("uncompressed size mismatch (central " + ent.uncompSize + ", actual " + data.length + ")");
    if (crc32(data) !== ent.crc) warnings.push("crc32 mismatch");
    return { ok: true, name: ent.name, bytes: data, warnings: warnings };
  } catch (e) {
    return miss("unreadable entry");
  }
}

/* ---------------- the verifier core (shared by file mode and --selftest) ---------------- */

/* verifyPackBytes(input, label) -> report:
   { label, bytes, fileSha, ok, containerErrors, manifestErrors, manifest, rows, extras,
     counts: {items, passed, refused, extras, containerErrors, manifestErrors} }.
   NEVER throws - any internal failure lands as a container error and ok stays false. */
function verifyPackBytes(input, label) {
  const rep = {
    label: label === undefined ? "(buffer)" : String(label), bytes: 0, fileSha: "",
    ok: false, containerErrors: [], manifestErrors: [], manifest: null,
    rows: [], extras: [],
    counts: { items: 0, passed: 0, refused: 0, extras: 0, containerErrors: 0, manifestErrors: 0 },
  };
  const finish = () => {
    rep.counts.containerErrors = rep.containerErrors.length;
    rep.counts.manifestErrors = rep.manifestErrors.length;
    rep.ok = rep.containerErrors.length === 0 && rep.manifestErrors.length === 0 && rep.counts.refused === 0;
    return rep;
  };
  try {
    const b = toBuf(input);
    if (!b) { rep.containerErrors.push("input: not byte-ish (Buffer/Uint8Array/ArrayBuffer required)"); return finish(); }
    rep.bytes = b.length;
    rep.fileSha = sha256hex(b);
    const zr = zipRead(b);
    if (!zr.ok) { rep.containerErrors.push("container: " + zr.error); return finish(); }

    /* container laws: relative member names, the two methods, no encryption, unique names */
    const seenNames = new Map();
    for (let i = 0; i < zr.entries.length; i++) {
      const e = zr.entries[i];
      if (!SCHEMA.isSafeRelPath(e.name)) rep.containerErrors.push("member " + val(e.name) + ': unsafe relative path (no leading "/", no ".." segments, no backslashes)');
      if (SCHEMA.AVPACK_ZIP_METHODS.indexOf(e.method) < 0) rep.containerErrors.push("member " + val(e.name) + ": method " + e.method + " not supported (stored/deflate-raw only)");
      if (e.flags & FLAG_ENCRYPTED) rep.containerErrors.push("member " + val(e.name) + ": encrypted entry");
      if (seenNames.has(e.name)) rep.containerErrors.push("member " + val(e.name) + ": duplicate member name (first at entry " + seenNames.get(e.name) + ")");
      else seenNames.set(e.name, i);
    }

    /* required member: manifest.json (UTF-8 JSON) */
    let manifestEnt = null;
    for (const e of zr.entries) if (e.name === SCHEMA.AVPACK_MANIFEST_NAME) { manifestEnt = e; break; }
    if (!manifestEnt) { rep.containerErrors.push("container: required member " + SCHEMA.AVPACK_MANIFEST_NAME + " missing"); return finish(); }
    const mex = zipExtract(zr, manifestEnt);
    if (!mex.ok) { rep.containerErrors.push(SCHEMA.AVPACK_MANIFEST_NAME + ": " + mex.error); return finish(); }
    let text = null;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(mex.bytes); }
    catch (e) { rep.containerErrors.push(SCHEMA.AVPACK_MANIFEST_NAME + ": not valid UTF-8"); return finish(); }
    const pv = SCHEMA.parseManifestText(text);
    rep.manifestErrors = pv.errors.slice();
    rep.manifest = pv.ok ? pv.manifest : null;
    if (!pv.ok) return finish();

    /* EVERY item row: locate the member, extract, verify sha256 + size BEFORE anything lands */
    const byPath = new Map();
    for (const e of zr.entries) if (!byPath.has(e.name)) byPath.set(e.name, e);
    const itemPaths = new Set();
    for (let i = 0; i < rep.manifest.items.length; i++) {
      const row = rep.manifest.items[i];
      const r = { i: i + 1, key: row.key, kind: row.kind, format: row.format, name: row.name, path: row.path,
        sizeExp: row.size, sizeAct: null, shaExp: row.sha256, shaAct: "", result: "REFUSED", reason: "", warnings: [] };
      rep.counts.items++;
      itemPaths.add(row.path);
      const ent = byPath.get(row.path);
      if (!ent) {
        r.reason = 'member missing ("' + row.path + '")';
      } else {
        const ex = zipExtract(zr, ent);
        if (!ex.ok) {
          r.reason = "extract failed: " + ex.error;
        } else {
          r.sizeAct = ex.bytes.length;
          r.shaAct = sha256hex(ex.bytes);
          r.warnings = ex.warnings.slice();
          if (r.shaAct !== row.sha256) r.reason = "sha256 mismatch (want " + row.sha256 + ", got " + r.shaAct + ")";
          else if (r.sizeAct !== row.size) r.reason = "size mismatch (manifest " + row.size + ", actual " + r.sizeAct + ")";
          else r.result = "PASS";
        }
      }
      if (r.result === "PASS") rep.counts.passed++; else rep.counts.refused++;
      rep.rows.push(r);
    }

    /* extra members: reported but tolerated (forward-compat; only manifest paths are routed) */
    for (const e of zr.entries) if (e.name !== SCHEMA.AVPACK_MANIFEST_NAME && !itemPaths.has(e.name)) rep.extras.push(e.name);
    rep.counts.extras = rep.extras.length;
    return finish();
  } catch (e) {
    rep.containerErrors.push("check exception (never-throw guard): " + msgOf(e));
    return finish();
  }
}

/* ---------------- selftest-only zip writer (local + central + EOCD) ---------------- */

/* zipWrite(entries) -> Buffer. entries: [{name, data, method}]; method 0 stores, 8 deflates
   raw, any other numeric method stores the bytes under that method id (fixture construction
   only - the reader is expected to refuse it). CRC-32 per entry, fixed 1980 DOS stamp and
   UTF-8 flag on non-ASCII names (mirrors src/av_zipc.js laws). Selftest use only. */
function zipWrite(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(String(e.name), "utf8");
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), "utf8");
    const method = (e.method === undefined || e.method === null) ? METHOD_STORE : e.method;
    const comp = method === METHOD_DEFLATE ? zlib.deflateRawSync(data) : data;
    const crc = crc32(data);
    let nonAscii = false;
    for (let i = 0; i < name.length; i++) if (name[i] >= 0x80) { nonAscii = true; break; }
    const flags = nonAscii ? FLAG_UTF8 : 0;
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LFH_SIG, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(DOS_EPOCH_TIME, 10); local.writeUInt16LE(DOS_EPOCH_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    parts.push(local, comp);
    const cen = Buffer.alloc(CD_ENTRY_MIN + name.length);
    cen.writeUInt32LE(CD_SIG, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(flags, 8);
    cen.writeUInt16LE(method, 10); cen.writeUInt16LE(DOS_EPOCH_TIME, 12); cen.writeUInt16LE(DOS_EPOCH_DATE, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28); cen.writeUInt16LE(0, 30); cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34); cen.writeUInt16LE(0, 36); cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    name.copy(cen, CD_ENTRY_MIN);
    central.push(cen);
    offset += local.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(EOCD_MIN);
  eocd.writeUInt32LE(EOCD_SIG, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat(parts.concat([cdBuf, eocd]));
}

/* ---------------- selftest fixtures (in-memory only) ---------------- */

function tinyWav() {
  const n = 32, sr = 8000;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * i / sr)), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function mkRow(key, kind, format, name, data) {
  return { key: key, kind: kind, format: format, name: name, path: "items/" + key + "." + format,
    sha256: sha256hex(data), size: data.length };
}

function selftestWorld() {
  const wav = tinyWav();
  const pat = Buffer.from('{"v":1,"pattern":"selftest","notes":[60,62,64]}', "utf8");
  const hat = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00]);
  const rows = {
    kick: mkRow("kick", "sample", "wav", "Kick 01.wav", wav),
    bassline: mkRow("bassline", "pattern", "avpat", "Bassline.avpat", pat),
    hat: mkRow("hat", "sample", "wav", "Hat.wav", hat),
  };
  const manifest = { v: 1, id: "selftest-mini", name: "Selftest Mini", author: "avpack_check",
    license: "", tags: ["selftest"], at: 1731100000000, app: "anvil-app", items: [rows.kick, rows.bassline] };
  return { wav: wav, pat: pat, hat: hat, rows: rows, manifest: manifest };
}

/* buildVariant(kind) -> { kind, buf, manifest, world } - the in-memory fixture set. */
function buildVariant(kind) {
  const w = selftestWorld();
  const enc = (o) => Buffer.from(JSON.stringify(o), "utf8");
  const E = (name, data, method) => ({ name: name, data: data, method: method });
  let manifest = null, entries = null;
  if (kind === "base") {
    manifest = w.manifest;
    entries = [E("manifest.json", enc(manifest), 8), E(w.rows.kick.path, w.wav, 0), E(w.rows.bassline.path, w.pat, 8)];
  } else if (kind === "wrong-sha") {
    const rows = JSON.parse(JSON.stringify(w.manifest.items));
    rows[0].sha256 = "0".repeat(64);
    manifest = Object.assign({}, w.manifest, { items: rows });
    entries = [E("manifest.json", enc(manifest), 0), E(w.rows.kick.path, w.wav, 0), E(w.rows.bassline.path, w.pat, 8)];
  } else if (kind === "missing") {
    const rows = JSON.parse(JSON.stringify(w.manifest.items)).concat([w.rows.hat]);
    manifest = Object.assign({}, w.manifest, { items: rows });
    entries = [E("manifest.json", enc(manifest), 0), E(w.rows.kick.path, w.wav, 0), E(w.rows.bassline.path, w.pat, 8)];
  } else if (kind === "dup-key") {
    manifest = Object.assign({}, w.manifest, { items: [w.rows.kick, w.rows.kick] });
    entries = [E("manifest.json", enc(manifest), 0), E(w.rows.kick.path, w.wav, 0)];
  } else if (kind === "bad-json") {
    entries = [E("manifest.json", Buffer.from('{ "v":1, oops', "utf8"), 0), E(w.rows.kick.path, w.wav, 0), E(w.rows.bassline.path, w.pat, 8)];
  } else if (kind === "extra") {
    manifest = w.manifest;
    entries = [E("manifest.json", enc(manifest), 0), E(w.rows.kick.path, w.wav, 0), E(w.rows.bassline.path, w.pat, 8), E("notes.txt", Buffer.from("hello pack", "utf8"), 0)];
  } else if (kind === "method12") {
    manifest = w.manifest;
    entries = [E("manifest.json", enc(manifest), 0), E(w.rows.kick.path, w.wav, 12), E(w.rows.bassline.path, w.pat, 8)];
  } else if (kind === "abspath") {
    manifest = w.manifest;
    entries = [E("manifest.json", enc(manifest), 0), E(w.rows.kick.path, w.wav, 0), E(w.rows.bassline.path, w.pat, 8), E("/evil.wav", w.hat, 0)];
  } else if (kind === "no-manifest") {
    entries = [E("a.txt", Buffer.from("just a zip", "utf8"), 0)];
  } else {
    return null;
  }
  return { kind: kind, buf: zipWrite(entries), entries: entries, manifest: manifest, world: w };
}

/* ---------------- report printing (the honest table) ---------------- */

function printPackReport(rep) {
  log("pack: " + rep.label + " | " + rep.bytes + " bytes | sha256 " + (rep.fileSha ? rep.fileSha.slice(0, 16) + "..." : "-"));
  if (rep.manifest) {
    const m = rep.manifest;
    log('manifest: v1 | id "' + m.id + '" | name "' + m.name + '" | author "' + m.author + '" | license "' + m.license + '" | tags ' + m.tags.length + " | items " + m.items.length);
  } else {
    log("manifest: (not validated)");
  }
  for (const e of rep.manifestErrors.slice(0, 20)) log("  MANIFEST-ERROR  " + e);
  if (rep.manifestErrors.length > 20) log("  MANIFEST-ERROR  ... (" + (rep.manifestErrors.length - 20) + " more)");
  for (const e of rep.containerErrors.slice(0, 20)) log("  CONTAINER-ERROR  " + e);
  if (rep.containerErrors.length > 20) log("  CONTAINER-ERROR  ... (" + (rep.containerErrors.length - 20) + " more)");
  if (rep.rows.length) {
    log("items:");
    for (const r of rep.rows) {
      const note = r.result === "PASS"
        ? (r.warnings.length ? "  note: " + r.warnings.join("; ") : "")
        : "  << " + r.reason + (r.warnings.length ? " | " + r.warnings.join("; ") : "");
      log("  " + (r.result === "PASS" ? "PASS   " : "REFUSED") + " [" + String(r.i).padStart(2) + "/" + String(rep.counts.items).padStart(2) + "] " +
        padCell(r.kind, 8) + " " + padCell(r.path, 26) + " " + padCell(r.name, 24) +
        " size " + String(r.sizeAct === null ? "-" : r.sizeAct).padStart(7) + "  sha " + (r.shaAct ? r.shaAct.slice(0, 12) : "------------") + note);
    }
  } else if (rep.manifest) {
    log("items: (none listed)");
  }
  if (rep.extras.length) log("extra members (tolerated, not routed): " + rep.extras.slice(0, 8).join(", ") + (rep.extras.length > 8 ? " (+" + (rep.extras.length - 8) + " more)" : ""));
  log("counts: items " + rep.counts.items + " | verified " + rep.counts.passed + " | refused " + rep.counts.refused +
    " | extras " + rep.counts.extras + " | container errors " + rep.counts.containerErrors + " | manifest errors " + rep.counts.manifestErrors);
}

/* ---------------- file mode ---------------- */

function runFile(p) {
  log("== avpack_check - R19 user pack verifier (verify/_r19_wave.md section 2) ==");
  log("repo " + REPO + " | node " + process.version);
  log("file: " + p);
  log("");
  let buf = null;
  try { buf = fs.readFileSync(p); }
  catch (e) { log("cannot read " + p + ": " + msgOf(e)); log(""); log("AVPACK CHECK: FAIL (strict exit 1)"); return 1; }
  const rep = verifyPackBytes(buf, p);
  printPackReport(rep);
  log("");
  log(rep.ok ? "AVPACK CHECK: PASS (strict exit 0)" : "AVPACK CHECK: FAIL (strict exit 1)");
  return rep.ok ? 0 : 1;
}

/* ---------------- selftest mode ---------------- */

function runSelftest() {
  log("== avpack_check --selftest - in-memory mini pack (verify/_r19_wave.md section 2) ==");
  log("repo " + REPO + " | node " + process.version);
  log("");

  const base = buildVariant("base");
  const again = buildVariant("base");
  if (!base || !again) { log("selftest fixture build failed"); return 1; }
  check("selftest builder deterministic (two builds byte-identical)", base.buf.equals(again.buf), base.buf.length + " bytes");
  const rep = verifyPackBytes(base.buf, "selftest-mini.avpack (in-memory)");
  check("mini pack: file sha256 + byte count recorded", rep.fileSha === sha256hex(base.buf) && rep.bytes === base.buf.length);
  check("mini pack: manifest valid (v1, id selftest-mini, items 2)",
    rep.manifest !== null && rep.manifestErrors.length === 0 && rep.manifest.id === "selftest-mini" && rep.manifest.items.length === 2);
  check("mini pack: 2/2 items sha256 verified | refused 0 | container 0 | extras 0",
    rep.ok === true && rep.counts.items === 2 && rep.counts.passed === 2 && rep.counts.refused === 0 &&
    rep.counts.containerErrors === 0 && rep.counts.manifestErrors === 0 && rep.counts.extras === 0);
  log("");
  printPackReport(rep);
  log("");
  log("negative controls (the checker must catch what the table refuses):");

  /* 1) one flipped byte inside the stored kick payload: sha256 must refuse it, and the CRC
        mismatch must ride as a note; the deflated bassline must still pass */
  const w = selftestWorld();
  const tam = Buffer.from(base.buf);
  const off = tam.indexOf(w.wav);
  let tamOk = false, tamDetail = "payload not locatable in the built zip";
  if (off >= 0) {
    tam[off + 60] ^= 0xFF;
    const repT = verifyPackBytes(tam, "tampered (1 byte flipped in items/kick.wav)");
    tamOk = repT.ok === false && repT.counts.refused === 1 && repT.rows.length === 2 &&
      repT.rows[0].result === "REFUSED" && /sha256 mismatch/.test(repT.rows[0].reason) &&
      repT.rows[0].warnings.some(x => /crc32/.test(x)) && repT.rows[1].result === "PASS";
    tamDetail = repT.rows.length ? "kick :: " + String(repT.rows[0].reason).slice(0, 90) : "no rows";
  }
  check("control: 1-byte tamper -> kick REFUSED (named sha256, crc note), bassline PASS", tamOk, tamDetail);

  const repW = verifyPackBytes(buildVariant("wrong-sha").buf, "wrong-sha");
  check("control: manifest sha deliberately wrong -> 1 REFUSED / 1 PASS (item named)",
    repW.ok === false && repW.counts.refused === 1 && repW.counts.passed === 1 &&
    repW.rows[0].result === "REFUSED" && /sha256 mismatch/.test(repW.rows[0].reason) && repW.rows[1].result === "PASS",
    String(repW.rows[0].reason).slice(0, 90));

  const repM = verifyPackBytes(buildVariant("missing").buf, "missing-member");
  check("control: manifest lists 3, zip holds 2 -> row 3 REFUSED (member missing), rows 1-2 PASS",
    repM.ok === false && repM.counts.items === 3 && repM.counts.refused === 1 &&
    repM.rows[2].result === "REFUSED" && /member missing/.test(repM.rows[2].reason) &&
    repM.rows[0].result === "PASS" && repM.rows[1].result === "PASS");

  const repD = verifyPackBytes(buildVariant("dup-key").buf, "dup-key");
  check("control: duplicate keys -> manifest invalid, no rows evaluated",
    repD.ok === false && repD.manifestErrors.some(e => /duplicate/.test(e)) && repD.rows.length === 0);

  const repJ = verifyPackBytes(buildVariant("bad-json").buf, "bad-json");
  check("control: corrupt manifest.json -> JSON parse failed (manifest invalid)",
    repJ.ok === false && repJ.manifestErrors.some(e => /JSON parse failed/.test(e)) && repJ.manifest === null);

  const repE = verifyPackBytes(buildVariant("extra").buf, "extra-member");
  check("control: extra member tolerated but reported (ok stays true)",
    repE.ok === true && repE.counts.extras === 1 && repE.extras[0] === "notes.txt");

  const repX = verifyPackBytes(buildVariant("method12").buf, "method12");
  check("control: foreign zip method -> container error (method 12 named) + row REFUSED",
    repX.ok === false && repX.containerErrors.some(e => /method 12/.test(e)) &&
    repX.rows.some(r => r.result === "REFUSED"));

  const repA = verifyPackBytes(buildVariant("abspath").buf, "abspath");
  check('control: unsafe member name ("/evil.wav") -> container error (unsafe relative path)',
    repA.ok === false && repA.containerErrors.some(e => /unsafe relative path/.test(e)));

  const repN = verifyPackBytes(buildVariant("no-manifest").buf, "no-manifest");
  check("control: zip without manifest.json -> required member error",
    repN.ok === false && repN.containerErrors.some(e => /manifest\.json missing/.test(e)));

  const repZ = verifyPackBytes(Buffer.from("this is not a zip at all........", "utf8"), "junk");
  check("control: junk bytes -> not a zip (never throws)",
    repZ.ok === false && repZ.containerErrors.some(e => /not a zip/.test(e)));

  check("sha256 vector: sha256(\"abc\") = ba7816bf... (known digest)",
    sha256hex(Buffer.from("abc", "utf8")) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  check("crc32 vector: crc32(\"123456789\") = cbf43926",
    crc32(Buffer.from("123456789", "utf8")) === 0xCBF43926);

  log("");
  if (harnessFails === 0) {
    log("AVPACK CHECK SELFTEST: PASS (strict exit 0)");
    return 0;
  }
  log("AVPACK CHECK SELFTEST: FAIL (strict exit 1) - " + harnessFails + " failed check(s)");
  return 1;
}

/* ---------------- main ---------------- */

function usage() {
  log("usage: node verify/avpack_check.mjs <path.avpack>   verify one pack file (strict exit 0/1)");
  log("       node verify/avpack_check.mjs --selftest      build + validate a tiny in-memory pack");
  log("       node verify/avpack_check.mjs --help");
}

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0) { usage(); return 1; }
  if (args[0] === "--help" || args[0] === "-h") { usage(); return 0; }
  if (args[0] === "--selftest") {
    if (args.length > 1) { log("unknown argument: " + args[1]); usage(); return 1; }
    return runSelftest();
  }
  if (args.length === 1 && args[0].charAt(0) !== "-") return runFile(args[0]);
  log("usage error: unexpected arguments: " + args.join(" "));
  usage();
  return 1;
}

/* ---------------- exports (import-safe; the CLI runs only as main) ---------------- */

export {
  REPO, EXTRACT_MAX, zipRead, zipExtract, zipWrite, crc32, sha256hex, toBuf,
  verifyPackBytes, buildVariant, printPackReport,
};

const IS_MAIN = (() => { try { return /(^|[\\/])avpack_check\.mjs$/.test(process.argv[1] || ""); } catch (e) { return false; } })();

if (IS_MAIN) {
  let exitCode = 1;
  try {
    exitCode = main(process.argv);
  } catch (e) {
    console.error("avpack_check harness exception (never-throw guard): " + String(e && e.stack || e));
    exitCode = 1;
  }
  process.exit(exitCode);
}
