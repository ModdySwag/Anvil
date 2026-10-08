/* Anvil - sample import core (R15b SAMPLE PACKS wave, child C): magic-byte sniffer + per-format
   policy table + the canonical-bundle pipeline behind avImportFiles().

   Pins (verify/_r15b_wave.md sections 2 and 3):
   - AV_IMPORT_VERSION = "r15b.0" | AV_IMPORT_ITEM_MAX = 96 MiB | AV_IMPORT_MAX_FILES = 600.
   - avImportSniff(u8OrArrayBuffer, ext) -> { format, note }. Recognition, first hit wins:
     wav (RIFF + WAVE) > mp3 ("ID3" or a frame sync) > aiff (FORM + AIFF|AIFC) > mid ("MThd") >
     rex2 ("CAT " + "REX2") > serum ("XferJson" or ext fxp/serumpreset) > zip ("PK" + 0x03 0x04) >
     adg/als (ext; gzip magic 1f8b corroborates - the note says when it is absent) > gzip (1f 8b,
     no adg/als ext) > wt (ext) > exs/nki/nbkt/sxt/kong/mxgrp (ext) > unknown.
     The optional second argument carries the lowercase extension - the ext-driven rules need it
     (the byte rules alone cannot see a name; pipeline call sites pass item.ext).
   - AV_IMPORT_POLICY: per-format { kind, result, reason, persist }. Only wav/mp3/aiff/rex2/mid
     are sample/pattern kinds; every other format is kind "refused" while its result still
     distinguishes deferred vs refused. The reason strings are the pinned contract, kept verbatim
     (the em dashes inside them are \u2014 escapes so this source stays ASCII-only).
   - avImportFiles(files, opts) -> Promise<receipt> that NEVER rejects:
     receipt = { ok, title, at, version, items, counts, errors } with
     counts = { total, imported, deferred, refused, samples, patterns } and one item per input
     file in input order: item = { key, name, path, ext, format, kind, result, reason, size,
     sibling, id, meta }. ok = true when at least one item landed (imported).
     files: an Array, a FileList or any iterable of File-likes (a single File-like is tolerated).
     Per-file flow: sniff the FIRST 64 BYTES ONLY (file.slice(0, 64).arrayBuffer()) -> policy;
     full bytes are read only when the policy persists AND size <= AV_IMPORT_ITEM_MAX (larger
     files: result "refused", reason "too large \u2014 96 MB cap", no read). The full read feeds
     the typeof-guarded cheap header probes (avWavInfo / AVAIFF.probe / avMidParse / AVRex.probe)
     for meta and is handed to avLibAddItem (guarded PER CALL; when av_lib is absent the item id
     stays "" and the counts are unchanged - receipt note: counts unchanged). No audio decode
     happens here: full decode happens at library LOAD (av_lib). REX2 degrades honestly when
     AVRex is absent or its depth is not decodable; AIFF degrades the same way when the AIFF
     reader module is missing (mirrors the rex2 pending precedent - never claim an import that
     can never decode). A run processes at most 600 files; the rest are reported via errors. An
     empty input resolves ok:false with errors containing "no files". Per-file try/catch - one
     bad file never sinks the batch.
   - sibling: for each item - the same-stem (case-insensitive, ext-stripped) sibling inside the
     processed set whose own sniff is wav/mp3/aiff (self excluded), else "".
   - meta from the cheap probes only: sample { rate, channels, frames?, bits? }; pattern
     { ppq, bpm, trackCount, noteCount }; rex2 { slices, rate, frames, tempo, bits }; else {}.

   Craft laws: "use strict", classic script (no modules/imports), node-loadable (no DOM at load,
   no top-level side effects), one namespace (avImport prefixes + AV_IMPORT_ consts), never
   throw. Every cross-module call is typeof-guarded PER CALL (av_aiff/av_rex/av_lib land in the
   same wave but this file must stay honest standalone and in a partial build). */
"use strict";

const AV_IMPORT_VERSION = "r15b.0";
const AV_IMPORT_ITEM_MAX = 96 * 1024 * 1024;   /* 96 MiB - the pinned item cap */
const AV_IMPORT_MAX_FILES = 600;               /* the pinned per-run file cap */
/* bound for pathological list scans (arrays/iterables far beyond the pinned cap); the pinned
   cap is 600 - this only guards against a runaway length/iterator */
const avImportEnumMax = 10000;

/* pinned reason lines (verbatim; em dashes as escapes to keep this source ASCII-only) */
const avImportRexDefer = ".rx2 \u2014 decoder pending (this build)";
const avImportRexDepth = ".rx2 \u2014 bit depth not decodable; a sibling WAV imports as audio";
const avImportAiffDefer = ".aiff \u2014 decoder pending (this build)";
const avImportTooLarge = "too large \u2014 96 MB cap";
const avImportNoFiles = "no files";
const avImportBadFile = "unreadable entry \u2014 not a File";
const avImportReadFail = "unreadable entry \u2014 read failed";

/* ---------- the per-format policy table (pinned verbatim; persist = read + library write) ---------- */

const AV_IMPORT_POLICY = {
  wav:     { kind: "sample",  result: "imported", reason: "", persist: true },
  mp3:     { kind: "sample",  result: "imported", reason: "", persist: true },
  aiff:    { kind: "sample",  result: "imported", reason: "", persist: true },
  mid:     { kind: "pattern", result: "imported", reason: "", persist: true },
  rex2:    { kind: "sample",  result: "imported", reason: "", persist: true },
  wt:      { kind: "refused", result: "deferred", reason: "wavetable \u2014 import it in the Wavetable editor (WT IMPORT)", persist: false },
  adg:     { kind: "refused", result: "deferred", reason: "Ableton project \u2014 reference extraction lands in R15c; drop the pack's audio folder instead", persist: false },
  als:     { kind: "refused", result: "deferred", reason: "Ableton project \u2014 reference extraction lands in R15c; drop the pack's audio folder instead", persist: false },
  exs:     { kind: "refused", result: "deferred", reason: "EXS24 (binary) \u2014 adapter planned (R15c); the pack's WAVs/AIFFs import now", persist: false },
  nki:     { kind: "refused", result: "deferred", reason: "Kontakt/Battery library \u2014 partial extraction planned (V2); import the Samples folder", persist: false },
  nbkt:    { kind: "refused", result: "deferred", reason: "Kontakt/Battery library \u2014 partial extraction planned (V2); import the Samples folder", persist: false },
  sxt:     { kind: "refused", result: "deferred", reason: "Reason NN-XT patch \u2014 reference extraction planned (V2)", persist: false },
  kong:    { kind: "refused", result: "refused",  reason: "Reason Kong kit \u2014 kit mapping is not readable; import the pack's WAVs", persist: false },
  mxgrp:   { kind: "refused", result: "refused",  reason: "NI Maschine group \u2014 not readable; import the pack's WAVs", persist: false },
  serum:   { kind: "refused", result: "deferred", reason: "Serum preset \u2014 wavetable import lands in R15c", persist: false },
  zip:     { kind: "refused", result: "deferred", reason: "zip \u2014 unzip and drop the folder (zip import lands later)", persist: false },
  gzip:    { kind: "refused", result: "refused",  reason: "unrecognized format", persist: false },
  unknown: { kind: "refused", result: "refused",  reason: "unrecognized format", persist: false }
};

/* ---------- small universal helpers (never throw) ---------- */

function avImportIsNum(x) {
  return typeof x === "number" && x === x && x !== Infinity && x !== -Infinity;
}

function avImportOpts(opts) {
  return (opts && typeof opts === "object" && !Array.isArray(opts)) ? opts : {};
}

function avImportCapStr(s, cap) {
  return (typeof s === "string") ? s.slice(0, cap) : "";
}

function avImportLeaf(s) {
  if (typeof s !== "string" || !s) return "";
  const parts = s.split(/[\\/]+/);
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i]) return parts[i];
  return "";
}

function avImportExtOf(name) {
  const n = (typeof name === "string") ? name : "";
  const slash = Math.max(n.lastIndexOf("/"), n.lastIndexOf("\\"));
  const leaf = (slash >= 0) ? n.slice(slash + 1) : n;
  const dot = leaf.lastIndexOf(".");
  if (dot <= 0 || dot === leaf.length - 1) return "";
  return leaf.slice(dot + 1).toLowerCase();
}

/* case-insensitive ext-stripped stem of a leaf name (sibling matching) */
function avImportStem(name) {
  const n = (typeof name === "string") ? name : "";
  if (!n) return "";
  const dot = n.lastIndexOf(".");
  if (dot <= 0) return n.toLowerCase();
  return n.slice(0, dot).toLowerCase();
}

function avImportErrText(e) {
  try { return String((e && e.message) || e || "unknown error"); } catch (e2) { return "unknown error"; }
}

/* ---------- byte input normalisers (sniff/full-read inputs; never throw) ---------- */

function avImportU8(x) {
  try {
    if (x == null) return null;
    if (typeof Uint8Array !== "undefined" && x instanceof Uint8Array) return x;
    if (typeof ArrayBuffer !== "undefined" && x instanceof ArrayBuffer) return new Uint8Array(x);
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(x)) {
      return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    }
    if (Array.isArray(x)) {
      const n = (x.length > 64) ? 64 : x.length;
      const u = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const b = Number(x[i]);
        u[i] = (b === b && b !== Infinity && b !== -Infinity ? Math.round(b) : 0) & 0xFF;
      }
      return u;
    }
    if (typeof x.length === "number" && x.length >= 0 && !x.buffer) {
      const n = (x.length > 64) ? 64 : Math.floor(x.length);
      const u = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        let b = 0;
        try { b = Number(x[i]); } catch (e) { b = 0; }
        u[i] = (b === b && b !== Infinity && b !== -Infinity ? Math.round(b) : 0) & 0xFF;
      }
      return u;
    }
    return null;
  } catch (e) { return null; }
}

/* full-read normaliser: ArrayBuffer | view | number[] -> ArrayBuffer (views and arrays copied) */
function avImportToAB(x) {
  try {
    if (x == null) return null;
    if (typeof ArrayBuffer !== "undefined" && x instanceof ArrayBuffer) return x;
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(x)) {
      return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength);
    }
    if (Array.isArray(x)) {
      const u = new Uint8Array(x.length);
      for (let i = 0; i < x.length; i++) {
        const b = Number(x[i]);
        u[i] = (b === b && b !== Infinity && b !== -Infinity ? Math.round(b) : 0) & 0xFF;
      }
      return u.buffer;
    }
    return null;
  } catch (e) { return null; }
}

/* 4 ASCII chars at offset o, or "" when out of range */
function avImportStr4(u8, o) {
  if (!u8 || u8.length < o + 4) return "";
  return String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
}

/* ---------- the sniffer (pinned order; first hit wins) ---------- */

function avImportSniff(u8OrArrayBuffer, ext) {
  try {
    let u8 = avImportU8(u8OrArrayBuffer);
    if (!u8) u8 = new Uint8Array(0);
    let e = "";
    try {
      if (typeof ext === "string") e = ext.trim().toLowerCase().replace(/^\.+/, "");
    } catch (e2) { e = ""; }
    const has2 = u8.length >= 2;
    const has3 = u8.length >= 3;
    const has4 = u8.length >= 4;
    const has8 = u8.length >= 8;
    const has12 = u8.length >= 12;
    if (has12 && avImportStr4(u8, 0) === "RIFF" && avImportStr4(u8, 8) === "WAVE") return { format: "wav", note: "" };
    if (has3 && u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) return { format: "mp3", note: "" };
    if (has2 && u8[0] === 0xFF && (u8[1] & 0xE0) === 0xE0) return { format: "mp3", note: "" };
    if (has12 && avImportStr4(u8, 0) === "FORM") {
      const t = avImportStr4(u8, 8);
      if (t === "AIFF" || t === "AIFC") return { format: "aiff", note: "" };
    }
    if (has4 && avImportStr4(u8, 0) === "MThd") return { format: "mid", note: "" };
    if (has12 && avImportStr4(u8, 0) === "CAT " && avImportStr4(u8, 8) === "REX2") return { format: "rex2", note: "" };
    if (has8 && avImportStr4(u8, 0) === "Xfer" && avImportStr4(u8, 4) === "Json") return { format: "serum", note: "" };
    if (e === "fxp" || e === "serumpreset") return { format: "serum", note: "extension match" };
    if (has4 && u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 0x03 && u8[3] === 0x04) return { format: "zip", note: "" };
    if (e === "adg" || e === "als") {
      const gz = has2 && u8[0] === 0x1F && u8[1] === 0x8B;
      return { format: e, note: gz ? "gzip magic present" : "gzip magic absent" };
    }
    if (has2 && u8[0] === 0x1F && u8[1] === 0x8B) return { format: "gzip", note: "" };
    if (e === "wt") return { format: "wt", note: "extension match" };
    if (e === "exs" || e === "nki" || e === "nbkt" || e === "sxt" || e === "kong" || e === "mxgrp") {
      return { format: e, note: "extension match" };
    }
    return { format: "unknown", note: "" };
  } catch (err) {
    return { format: "unknown", note: "" };
  }
}

/* ---------- receipt + title ---------- */

function avImportStamp(ms) {
  const d = new Date(ms);
  const pad = function (v) { return (v < 10 ? "0" : "") + v; };
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function avImportTitle(o) {
  try {
    if (o && typeof o.title === "string" && o.title) return o.title.slice(0, 80);
  } catch (e) { /* fall through to the default */ }
  return avImportCapStr("import " + avImportStamp(Date.now()), 80);
}

function avImportNewCounts() {
  return { total: 0, imported: 0, deferred: 0, refused: 0, samples: 0, patterns: 0 };
}

function avImportReceipt(opts) {
  const o = avImportOpts(opts);
  return {
    ok: false,
    title: avImportTitle(o),
    at: Date.now(),
    version: AV_IMPORT_VERSION,
    items: [],
    counts: avImportNewCounts(),
    errors: []
  };
}

function avImportBareReceipt() {
  let t = "import";
  try { t = avImportTitle({}); } catch (e) { t = "import"; }
  return {
    ok: false,
    title: avImportCapStr(t, 80),
    at: Date.now(),
    version: AV_IMPORT_VERSION,
    items: [],
    counts: avImportNewCounts(),
    errors: []
  };
}

/* ---------- input materialisation: Array | FileList/array-like | iterable | single File-like ---------- */

function avImportCollect(v, out) {
  if (!v || typeof v !== "object") return;   /* non-object entries are not files */
  if (out.files.length < AV_IMPORT_MAX_FILES) out.files.push(v);
  else out.beyond++;
}

function avImportScanList(arr, len, out) {
  let n = Math.floor(len);
  if (n > avImportEnumMax) {          /* huge length: count the unscanned tail as beyond honestly */
    out.beyond += n - avImportEnumMax;
    n = avImportEnumMax;
  }
  for (let i = 0; i < n; i++) {
    let v = null;
    try { v = arr[i]; } catch (e) { continue; }
    avImportCollect(v, out);
  }
}

function avImportList(files) {
  const out = { files: [], beyond: 0 };
  try {
    if (!files) return out;
    if (Array.isArray(files)) { avImportScanList(files, files.length, out); return out; }
    if (typeof files.length === "number" && files.length >= 0) {
      avImportScanList(files, files.length, out);        /* FileList / array-like */
      return out;
    }
    if (typeof Symbol !== "undefined" && Symbol.iterator && typeof files[Symbol.iterator] === "function") {
      let iter = null;
      try { iter = files[Symbol.iterator](); } catch (e) { iter = null; }
      if (iter && typeof iter.next === "function") {
        let seen = 0;
        while (seen < avImportEnumMax) {
          let step = null;
          try { step = iter.next(); } catch (e) { break; }
          if (!step || step.done) break;
          seen++;
          avImportCollect(step.value, out);
        }
      }
      return out;
    }
    /* a lone File-like (tolerated; the pinned shapes are Array/FileList/iterable) */
    if (files && typeof files === "object" &&
        (typeof files.slice === "function" || typeof files.arrayBuffer === "function")) {
      avImportCollect(files, out);
    }
  } catch (e) { /* return what we have */ }
  return out;
}

/* ---------- per-file record ---------- */

function avImportBase(f, index) {
  const item = {
    key: "i" + (index + 1), name: "", path: "", ext: "", format: "unknown",
    kind: "refused", result: "refused", reason: "", size: 0, sibling: "", id: "", meta: {}
  };
  let nm = "";
  try { if (typeof f.name === "string") nm = f.name; } catch (e) { nm = ""; }
  let pth = "";
  try {
    if (typeof f.webkitRelativePath === "string" && f.webkitRelativePath) pth = f.webkitRelativePath;
  } catch (e) { pth = ""; }
  if (!pth) pth = nm;
  if (!nm) nm = pth;
  item.name = avImportCapStr(avImportLeaf(nm), 120);
  item.path = avImportCapStr(pth, 200);
  item.ext = avImportExtOf(item.name);
  try {
    const s = f.size;
    if (avImportIsNum(s) && s >= 0) item.size = Math.floor(s);
  } catch (e) { /* size stays 0 */ }
  return item;
}

function avImportSet(item, result, reason) {
  try { item.result = result; item.reason = reason; } catch (e) { /* ignore */ }
  return item;
}

function avImportFallbackItem(f, index) {
  let base = null;
  try { base = avImportBase(f, index); } catch (e) { base = null; }
  if (!base) {
    base = {
      key: "i" + (index + 1), name: "", path: "", ext: "", format: "unknown",
      kind: "refused", result: "refused", reason: "", size: 0, sibling: "", id: "", meta: {}
    };
  }
  return avImportSet(base, "refused", avImportBadFile);
}

/* ---------- file reads ---------- */

/* FIRST 64 BYTES ONLY, via file.slice(0, 64).arrayBuffer() - the pinned sniff read */
async function avImportHead64(f) {
  if (!f || typeof f.slice !== "function") return null;
  const part = f.slice(0, 64);
  if (!part || typeof part.arrayBuffer !== "function") return null;
  const buf = await part.arrayBuffer();
  const u8 = avImportU8(buf);
  if (!u8) return null;
  return (u8.length > 64) ? u8.slice(0, 64) : u8;
}

/* full read, only reached when the policy persists and size was cap-checked */
async function avImportFull(f) {
  if (!f || typeof f.arrayBuffer !== "function") return null;
  const buf = await f.arrayBuffer();
  return avImportToAB(buf);
}

/* ---------- capability guards + cheap header probes (typeof-guarded PER CALL) ---------- */

function avImportHasAiff() {
  try { return typeof AVAIFF === "object" && AVAIFF !== null && typeof AVAIFF.probe === "function"; }
  catch (e) { return false; }
}

function avImportHasRex() {
  try { return typeof AVRex === "object" && AVRex !== null && typeof AVRex.probe === "function"; }
  catch (e) { return false; }
}

function avImportSampleMeta(rate, channels, frames, bits) {
  const m = {};
  if (avImportIsNum(rate) && rate > 0) m.rate = rate;
  if (avImportIsNum(channels) && channels > 0) m.channels = channels;
  if (avImportIsNum(frames) && frames >= 0) m.frames = frames;
  if (avImportIsNum(bits) && bits > 0) m.bits = bits;
  return m;
}

function avImportWavMeta(bytes) {
  try {
    if (typeof avWavInfo === "function") {
      const inf = avWavInfo(bytes);       /* ArrayBuffer accepted by avWavInfo */
      if (inf && inf.ok === true) return avImportSampleMeta(inf.sampleRate, inf.channels, inf.frames, inf.bits);
    }
  } catch (e) { return {}; }
  return {};
}

function avImportAiffMeta(bytes) {
  try {
    if (avImportHasAiff()) {
      const pr = AVAIFF.probe(new Uint8Array(bytes));
      if (pr && pr.ok === true) return avImportSampleMeta(pr.sampleRate, pr.channels, pr.frames, pr.bits);
    }
  } catch (e) { return {}; }
  return {};
}

function avImportMidMeta(bytes) {
  try {
    if (typeof avMidParse === "function") {
      const pr = avMidParse(bytes);       /* ArrayBuffer ok (converts via avMidToU8) */
      if (pr && pr.ok === true) {
        const m = {};
        if (avImportIsNum(pr.ppq)) m.ppq = pr.ppq;
        if (avImportIsNum(pr.bpm)) m.bpm = pr.bpm;
        if (avImportIsNum(pr.trackCount)) m.trackCount = pr.trackCount;
        if (avImportIsNum(pr.noteCount)) m.noteCount = pr.noteCount;
        return m;
      }
    }
  } catch (e) { return {}; }
  return {};
}

function avImportRexProbe(bytes) {
  try {
    if (avImportHasRex()) {
      const pr = AVRex.probe(new Uint8Array(bytes));
      if (pr && typeof pr === "object") return pr;
    }
  } catch (e) { return null; }
  return null;
}

function avImportRexMeta(pr) {
  const m = {};
  try {
    if (avImportIsNum(pr.slices)) m.slices = pr.slices;
    if (avImportIsNum(pr.rate)) m.rate = pr.rate;
    if (avImportIsNum(pr.frames)) m.frames = pr.frames;
    if (avImportIsNum(pr.tempo)) m.tempo = pr.tempo;
    if (avImportIsNum(pr.bits)) m.bits = pr.bits;
  } catch (e) { return {}; }
  return m;
}

function avImportMeta(format, bytes) {
  try {
    if (format === "wav") return avImportWavMeta(bytes);
    if (format === "aiff") return avImportAiffMeta(bytes);
    if (format === "mid") return avImportMidMeta(bytes);
  } catch (e) { return {}; }
  return {};                             /* mp3 (and any future format): no header probe */
}

/* ---------- persistence (avLibAddItem, guarded per call) ---------- */

async function avImportWrite(item, bytes, ctx) {
  try {
    if (typeof avLibAddItem !== "function") return "";   /* absent library: id stays "" */
    const rec = {
      key: item.key, name: item.name, path: item.path, ext: item.ext,
      format: item.format, kind: item.kind, result: item.result, reason: item.reason,
      size: item.size, at: ctx.at, meta: item.meta, bytes: bytes, via: "import"
    };
    const r = await avLibAddItem(rec);
    if (r && r.ok === true) return (typeof r.id === "string" && r.id) ? r.id : "";
    ctx.writeFails++;
    return "";
  } catch (e) {
    ctx.writeFails++;
    return "";
  }
}

/* ---------- per-file pipeline ---------- */

async function avImportOne(f, index, o, ctx) {
  const item = avImportBase(f, index);
  if (!f || typeof f !== "object") return avImportSet(item, "refused", avImportBadFile);
  if (typeof f.slice !== "function") return avImportSet(item, "refused", avImportBadFile);

  let head = null;
  try { head = await avImportHead64(f); } catch (e) { head = null; }
  if (!head) return avImportSet(item, "refused", avImportReadFail);

  const sn = avImportSniff(head, item.ext);
  const format = (sn && typeof sn.format === "string") ? sn.format : "unknown";
  const pol = AV_IMPORT_POLICY[format] || AV_IMPORT_POLICY.unknown;
  item.format = AV_IMPORT_POLICY[format] ? format : "unknown";
  item.kind = pol.kind;
  item.result = pol.result;
  item.reason = pol.reason;
  if (!pol.persist) return item;         /* deferred/refused per the pinned table */

  /* persist-policy formats: wav, mp3, aiff, mid, rex2 */
  if (item.size > AV_IMPORT_ITEM_MAX) return avImportSet(item, "refused", avImportTooLarge);
  if (item.format === "aiff" && !avImportHasAiff()) return avImportSet(item, "deferred", avImportAiffDefer);
  if (item.format === "rex2" && !avImportHasRex()) return avImportSet(item, "deferred", avImportRexDefer);

  let bytes = null;
  try { bytes = await avImportFull(f); } catch (e) { bytes = null; }
  if (!bytes) return avImportSet(item, "refused", avImportReadFail);

  if (item.format === "rex2") {
    const pr = avImportRexProbe(bytes);
    if (!pr || pr.ok !== true) return avImportSet(item, "deferred", avImportRexDefer);
    if (pr.bits === 8 || pr.bits === 32 || pr.float === true) {
      return avImportSet(item, "deferred", avImportRexDepth);   /* 8-bit / 32f: not decodable */
    }
    item.meta = avImportRexMeta(pr);
  } else {
    item.meta = avImportMeta(item.format, bytes);
  }

  if (o.persist !== false) item.id = await avImportWrite(item, bytes, ctx);
  return item;
}

/* ---------- the run ---------- */

async function avImportRun(receipt, list, o) {
  const ctx = { at: receipt.at, writeFails: 0 };
  try {
    for (let i = 0; i < list.length; i++) {
      let item = null;
      try { item = await avImportOne(list[i], i, o, ctx); }
      catch (e) { item = null; }        /* one bad file never sinks the batch */
      if (!item || typeof item !== "object") item = avImportFallbackItem(list[i], i);
      receipt.items.push(item);
    }
  } catch (e) {
    try { receipt.errors.push("import run failed: " + avImportErrText(e)); } catch (e2) { /* ignore */ }
  }
  try { avImportSiblings(receipt.items); } catch (e3) { /* sibling chips are best-effort */ }
  if (ctx.writeFails > 0) {
    try { receipt.errors.push("library write failed: " + ctx.writeFails + " item(s)"); } catch (e4) { /* ignore */ }
  }
  try { avImportCounts(receipt); } catch (e5) { /* the caller computes them once more */ }
}

/* sibling rule: same-stem (case-insensitive, ext-stripped) sibling in the processed set whose
   own sniff is wav/mp3/aiff; self excluded; "" when none */
function avImportSiblings(items) {
  try {
    if (!Array.isArray(items)) return;
    const byStem = Object.create(null);
    for (let i = 0; i < items.length; i++) {
      const f = items[i] ? items[i].format : "";
      if (f !== "wav" && f !== "mp3" && f !== "aiff") continue;
      const stem = avImportStem(items[i].name);
      if (!stem) continue;
      if (!byStem[stem]) byStem[stem] = [];
      byStem[stem].push(i);
    }
    for (let i = 0; i < items.length; i++) {
      let pick = "";
      const stem = avImportStem(items[i].name);
      const arr = stem ? byStem[stem] : null;
      if (arr) {
        for (let j = 0; j < arr.length; j++) {
          const k = arr[j];
          if (k === i) continue;
          const nm = (items[k] && typeof items[k].name === "string") ? items[k].name : "";
          if (nm) { pick = nm; break; }
        }
      }
      items[i].sibling = pick;
    }
  } catch (e) { /* ignore */ }
}

function avImportCounts(receipt) {
  const counts = avImportNewCounts();
  const items = (receipt && Array.isArray(receipt.items)) ? receipt.items : [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    if (it.result === "imported") counts.imported++;
    else if (it.result === "deferred") counts.deferred++;
    else if (it.result === "refused") counts.refused++;
    if (it.kind === "sample") counts.samples++;
    else if (it.kind === "pattern") counts.patterns++;
  }
  counts.total = items.length;
  receipt.counts = counts;
  receipt.ok = counts.imported > 0;
}

/* ---------- the entry point (NEVER rejects) ---------- */

async function avImportFiles(files, opts) {
  let receipt = null;
  let list = [];
  try {
    receipt = avImportReceipt(opts);
    const material = avImportList(files);
    if (material && Array.isArray(material.files)) list = material.files;
    if (material && avImportIsNum(material.beyond) && material.beyond > 0) {
      receipt.errors.push(material.beyond + " file(s) beyond the 600-file cap skipped");
    }
    if (!list.length) receipt.errors.push(avImportNoFiles);
  } catch (e) {
    if (!receipt) receipt = avImportBareReceipt();
    list = [];
    try { receipt.errors.push(avImportNoFiles); } catch (e2) { /* ignore */ }
  }
  try {
    await avImportRun(receipt, list, avImportOpts(opts));
  } catch (e) {
    try { if (!receipt.errors.length) receipt.errors.push("import run failed"); } catch (e2) { /* ignore */ }
  }
  try { avImportCounts(receipt); } catch (e) { /* counts best-effort */ }
  return receipt;
}
