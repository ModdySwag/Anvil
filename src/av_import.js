/* Anvil - sample import core (R15b SAMPLE PACKS wave, child C; R15c STRUCTURED PACKS wiring;
   R15d NI/SXT wiring; R16 ZIP BUNDLES):
   magic-byte sniffer + per-format policy table + the canonical-bundle pipeline behind
   avImportFiles() + the R15c adapter dispatch layer (EXS24 kits, ADG/ALS refs, SerumPreset refs).

   Pins (verify/_r15b_wave.md sections 2 and 3; verify/_r15c_wave.md sections 2 and 4.4):
   - AV_IMPORT_VERSION = "r15b.0" | AV_IMPORT_ITEM_MAX = 96 MiB | AV_IMPORT_MAX_FILES = 600.
     (The version pin stays r15b.0: the R15b checks assert it verbatim.)
   - avImportSniff(u8OrArrayBuffer, ext) -> { format, note }. Recognition, first hit wins:
     wav (RIFF + WAVE) > mp3 ("ID3" or a frame sync) > aiff (FORM + AIFF|AIFC) > mid ("MThd") >
     rex2 ("CAT " + "REX2") > serum ("XferJson" or ext fxp/serumpreset) > zip ("PK" + 0x03 0x04) >
     adg/als (ext; gzip magic 1f8b corroborates - the note says when it is absent) > gzip (1f 8b,
     no adg/als ext) > wt (ext) > exs/nki/nbkt/sxt/kong/mxgrp (ext) > unknown.
     The optional second argument carries the lowercase extension - the ext-driven rules need it
     (the byte rules alone cannot see a name; pipeline call sites pass item.ext).
   - AV_IMPORT_POLICY: per-format { kind, result, reason, persist }. R15c: exs/adg/als/serum
     persist true - kind "kit" (exs) and "refs" (adg/als/serum); the pinned pending/unreadable
     reason lines are the FALLBACKS the dispatch layer applies when the reader module is absent
     or the parse fails. wav/mp3/aiff/rex2/mid keep the R15b shapes; every other format stays
     kind "refused" while its result still distinguishes deferred vs refused. The reason strings
     are the pinned contract, kept verbatim (the em dashes inside them are \u2014 escapes so this
     source stays ASCII-only). R15d: nki/nbkt/sxt persist true - kind "refs" (the nki legacy
     branch upgrades item.kind to "kit" when the zones build).
   R16 ZIP BUNDLES (verify/_r16_wave.md sections 2 and 4.4):
   - zip policy row: kind "bundle", result "imported", reason "", persist false. The R15b line
     survives as the ABSENT-READER fallback (avImportZipAbsent). Guard avImportHasZip() =
     typeof AVZIP object + list/extract functions, reached typeof-guarded PER CALL.
   - The expansion pre-pass in avImportRun (before the per-file loop) stages the run list:
     each input whose head64 sniffs zip AND avImportHasZip() AND size <= AV_IMPORT_ITEM_MAX is
     read full, AVZIP.list'd and per non-dir entry extracted (await AVZIP.extract) into a
     synthesized File child fed right after its zip. Depth guard ctx.zipDepth = 1: a zip ENTRY
     that itself sniffs zip is NOT expanded (pinned nested line + ctx note). Children are
     budgeted against AV_IMPORT_MAX_FILES (slots already staged + the zip row + the remaining
     inputs are reserved); beyond-budget / over-cap / extract-failed entries are skipped with a
     ctx note. Every pre-pass failure degrades to the honest lines (absent / unreadable / no
     importable entries), never a throw.
   - The zip item is CONSTRUCTED in the pre-pass (never via avImportOne): key/name/path/ext as
     usual, format "zip", kind "bundle", result "imported", reason "", persist false, meta
     { entries, expanded, skipped } (entries = non-dir count; expanded = child items
     synthesized; skipped = entries not expanded: budget / cap / extract error / nested
     archive). Child keys "z" + n per zip; child name = entry leaf; child path = zip leaf +
     "/" + entry name (cap 200). Zero importable entries -> the zip item defers with
     avImportZipNoEntries. avImportOne keeps a zip safety branch (absent-reader / too-large /
     not-expanded defers) for a zip the pre-pass could not stage.
   - avImportFiles(files, opts) -> Promise<receipt> that NEVER rejects:
     receipt = { ok, title, at, version, items, counts, errors } with
     counts = { total, imported, deferred, refused, samples, patterns, kits, refs, bundles }
     and one item; R16 bundles is incremented for kind bundle && result imported (additive).
     per input file in input order: item = { key, name, path, ext, format, kind, result, reason,
     size, sibling, id, meta }. ok = true when at least one item landed (imported).
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
   - R15c adapter dispatch (section 4.4), EVERY adapter reach typeof-guarded PER CALL:
     exs     -> AVEXS.parse(bytes) (sync, ms-class) -> kit meta { zones, samples, skipped }
                (root = key + coarseTuning folded; buf = the sample ref index; s0/s1 from
                sampleStart/End; fades 0; the 16-zone cap counted in skipped; vol via the
                av_chop law 10^(dB/20) * scale with the dB clamped 0..24).
     adg/als -> await avAlsExtract(bytes) -> refs meta { refs, refCount, noteCount, tempoBpm,
                pattern } (+ avAlsToPattern; the extracted notes are capped at 512 FIRST,
                first-N wins; refs capped 512).
     serum   -> await AVSerum.extract(bytes) -> refs meta { wtRefs, presetName, product,
                version, kind } (wtRefs capped 256).
     A missing reader module defers with the pinned pending line; a parse failure defers with
     the pinned unreadable line (detail capped 80 chars). "imported" is claimed only when the
     reader exists and the parse produced usable content.
     R15d adapters (section 4.3), same per-call guards:
     nki/nbkt -> await AVNI.parse(bytes, item.ext): legacy with zones builds via the shared
                avImportKitMetaFrom (item.kind "kit"); legacy without zones -> refs meta
                (meta.kind "nki-legacy" + a ctx note); container -> "nki-container"; nbkt ->
                "nbkt"; encrypted -> refused with the pinned line; other failures -> deferred
                unreadable. sxt -> AVSXT.extract(bytes) -> refs meta (meta.kind "sxt",
                presetName + version). Refs hold to AV_IMPORT_NI_REF_CAP / AV_IMPORT_SXT_REF_CAP
                (512 each) with a ctx note when the cap bites.
   - sibling: for each item - the same-stem (case-insensitive, ext-stripped) sibling inside the
     processed set whose own sniff is wav/mp3/aiff (self excluded), else "".
   - meta from the cheap probes only: sample { rate, channels, frames?, bits? }; pattern
     { ppq, bpm, trackCount, noteCount }; rex2 { slices, rate, frames, tempo, bits }; kit/refs
     per the R15c section 2 shapes; else {}.

   R18a LIBRARY INTELLIGENCE (verify/_r18_wave.md section 3; additive only):
   - avImportSha256Hex(buf) -> Promise<string>: sha-256 hex of the full bytes, "" when
     crypto.subtle is absent or refuses (the avBackupSha256Hex '' discipline; av_store.js's
     lookup style - the import NEVER blocks on a hash).
   - avImportWrite (the ONE hash site): hashes the full bytes once, stamps the library rec with
     sha256 + source {name, path, size, at} and resolves a duplicate by sha BEFORE the commit
     (guarded avLibFindSha; keep-both - the write still happens): the rec gains dupOf {id, name}
     and the receipt item gains dup {id, name} + sha. The receipt item base gains sha:"" + dup:
     null; counts gains dups (each flagged item counts once).
   R19 USER PACKS (verify/_r19_wave.md section 4; additive route):
   - The zip pre-pass probes each staged zip (the existing AVZIP reader path) for a ROOT
     `manifest.json` member; when present and avPackValidateManifest (typeof-guarded global,
     av_pack.js) validates it, the input is a PACK and routes to
     avPackImportBytes(bytes, leafName) -- never the R16 depth-1 expansion. ONE bundle row:
     kind "bundle", result "imported" (or "refused" with the pack's first honest error),
     meta {pack: manifest id, items: [{key,name,kind,result,reason}...], installed, refused}
     -- the per-item results ride the row's meta (the receipt stays per-FILE, the pack is
     one file); counts.bundles increments as today. A non-avpack zip keeps the R16 behavior
     byte-for-byte. Any internal failure -- support absent, a throw, a garbage return --
     falls back to the generic expansion with a ctx note. Never throws outward.

   Craft laws: "use strict", classic script (no modules/imports), node-loadable (no DOM at load,
   no top-level side effects), one namespace (avImport prefixes + AV_IMPORT_ consts), never
   throw. Every cross-module call is typeof-guarded PER CALL (av_aiff/av_rex/av_lib/av_exs/
   av_als/av_serum/av_zip land in the same waves but this file must stay honest standalone and
   in a partial build). */
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

/* R15c STRUCTURED PACKS pinned adapter lines (verbatim; em dashes as escapes) */
const avImportExsPending = ".exs \u2014 reader pending (this build)";
const avImportAlsPending = "Ableton project \u2014 reader pending (this build)";
const avImportSerumPending = ".SerumPreset \u2014 reader pending (this build)";
const avImportExsUnread = ".exs \u2014 unreadable (";
const avImportAlsUnread = "Ableton project \u2014 unreadable (";
const avImportSerumUnread = ".SerumPreset \u2014 unreadable (";

/* R15c caps (section 2): 16 sampler-v2 zones; 512 als refs / notes; 256 serum wt refs */
const AV_IMPORT_KIT_ZONES = 16;
const AV_IMPORT_ALS_REF_CAP = 512;
const AV_IMPORT_ALS_NOTE_CAP = 512;
const AV_IMPORT_SERUM_WT_CAP = 256;

/* R15d NI/SXT adapter pinned lines (sections 2 and 4.3; verbatim -- the em dashes are \u2014
   escapes, exactly like the neighbours above, so this source stays ASCII-only) */
const avImportNkiPending = ".nki \u2014 reader pending (this build)";
const avImportNbktPending = ".nbkt \u2014 reader pending (this build)";
const avImportSxtPending = ".sxt \u2014 reader pending (this build)";
const avImportNkiUnread = ".nki \u2014 unreadable (";
const avImportNbktUnread = ".nbkt \u2014 unreadable (";
const avImportSxtUnread = ".sxt \u2014 unreadable (";
const avImportNkiEncrypted = ".nki \u2014 encrypted (locked library); import the pack's Samples folder";
const avImportNbktEncrypted = ".nbkt \u2014 encrypted (locked library); import the pack's Samples folder";

/* R15d caps (section 2): NI refs (legacy / container / nbkt) and SXT refs, 512 each */
const AV_IMPORT_NI_REF_CAP = 512;
const AV_IMPORT_SXT_REF_CAP = 512;

/* R16 ZIP BUNDLES pinned lines (sections 2 and 4.4; verbatim -- the em dashes are \u2014
   escapes exactly like the neighbours above, keeping this source ASCII-only) */
const avImportZipAbsent = "zip \u2014 unzip and drop the folder (zip import lands later)";
const avImportZipUnread = "zip \u2014 unreadable (";
const avImportZipNoEntries = "zip \u2014 no importable entries";
const avImportZipNested = "zip \u2014 nested archives are not expanded (v1)";

/* ---------- the per-format policy table (pinned verbatim; persist = read + library write) ---------- */

const AV_IMPORT_POLICY = {
  wav:     { kind: "sample",  result: "imported", reason: "", persist: true },
  mp3:     { kind: "sample",  result: "imported", reason: "", persist: true },
  aiff:    { kind: "sample",  result: "imported", reason: "", persist: true },
  mid:     { kind: "pattern", result: "imported", reason: "", persist: true },
  rex2:    { kind: "sample",  result: "imported", reason: "", persist: true },
  wt:      { kind: "refused", result: "deferred", reason: "wavetable \u2014 import it in the Wavetable editor (WT IMPORT)", persist: false },
  scl:     { kind: "refused", result: "deferred", reason: "tuning scale - import it in the TUNE card (TUNE > LIBRARY)", persist: false },
  kbm:     { kind: "refused", result: "deferred", reason: "keyboard mapping - import it in the TUNE card (TUNE > LIBRARY)", persist: false },
  adg:     { kind: "refs",    result: "imported", reason: "", persist: true },
  als:     { kind: "refs",    result: "imported", reason: "", persist: true },
  exs:     { kind: "kit",     result: "imported", reason: "", persist: true },
  nki:     { kind: "refs",    result: "imported", reason: "", persist: true },
  nbkt:    { kind: "refs",    result: "imported", reason: "", persist: true },
  sxt:     { kind: "refs",    result: "imported", reason: "", persist: true },
  kong:    { kind: "refused", result: "refused",  reason: "Reason Kong kit \u2014 kit mapping is not readable; import the pack's WAVs", persist: false },
  mxgrp:   { kind: "refused", result: "refused",  reason: "NI Maschine group \u2014 not readable; import the pack's WAVs", persist: false },
  serum:   { kind: "refs",    result: "imported", reason: "", persist: true },
  zip:     { kind: "bundle",  result: "imported", reason: "", persist: false },
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

/* a display string: strings pass (capped); finite numbers / booleans stringify; else "" */
function avImportStrOf(v, cap) {
  try {
    if (typeof v === "string") return v.slice(0, cap);
    if (typeof v === "number" && avImportIsNum(v)) return String(v).slice(0, cap);
    if (typeof v === "boolean") return String(v);
  } catch (e) { /* fall through */ }
  return "";
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

/* an honest detail string out of anything (strings, error carriers, values) */
function avImportDetail(v) {
  try {
    if (typeof v === "string" && v) return v;
    if (v && typeof v.message === "string" && v.message) return v.message;
    if (v != null) return String(v);
  } catch (e) { /* fall through */ }
  return "parse failed";
}

/* the pinned unreadable line: prefix + detail (capped 80 chars) + ")" */
function avImportUnreadable(prefix, detail) {
  return prefix + avImportCapStr(avImportDetail(detail), 80) + ")";
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
    if (e === "scl" || e === "kbm") return { format: e, note: "extension match" };
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
  return { total: 0, imported: 0, deferred: 0, refused: 0, samples: 0, patterns: 0, kits: 0, refs: 0, bundles: 0, dups: 0 };
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

function avImportBase(f, index, key) {
  const item = {
    key: (typeof key === "string" && key) ? key : "i" + (index + 1),
    name: "", path: "", ext: "", format: "unknown",
    kind: "refused", result: "refused", reason: "", size: 0, sibling: "", id: "", sha: "", dup: null, meta: {}
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

function avImportFallbackItem(f, index, key) {
  const k = (typeof key === "string" && key) ? key : "i" + (index + 1);
  let base = null;
  try { base = avImportBase(f, index, k); } catch (e) { base = null; }
  if (!base) {
    base = {
      key: k, name: "", path: "", ext: "", format: "unknown",
      kind: "refused", result: "refused", reason: "", size: 0, sibling: "", id: "", sha: "", dup: null, meta: {}
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

/* ---------- R15c adapter dispatch (STRUCTURED PACKS; typeof-guarded PER CALL, never throws) ---------- */

function avImportHasExs() {
  try { return typeof AVEXS === "object" && AVEXS !== null && typeof AVEXS.parse === "function"; }
  catch (e) { return false; }
}

function avImportHasAls() {
  try { return typeof avAlsExtract === "function"; }
  catch (e) { return false; }
}

function avImportHasAlsPattern() {
  try { return typeof avAlsToPattern === "function"; }
  catch (e) { return false; }
}

function avImportHasSerum() {
  try { return typeof AVSerum === "object" && AVSerum !== null && typeof AVSerum.extract === "function"; }
  catch (e) { return false; }
}

/* R15d guards: the SXT (av_sxt.js) and NI (av_ni.js) readers, reached per call */
function avImportHasSxt() {
  try { return typeof AVSXT === "object" && AVSXT !== null && typeof AVSXT.extract === "function"; }
  catch (e) { return false; }
}

function avImportHasNi() {
  try { return typeof AVNI === "object" && AVNI !== null && typeof AVNI.parse === "function"; }
  catch (e) { return false; }
}

/* R16: the zip reader (av_zip.js) -- an AVZIP object carrying list + extract, per call */
function avImportHasZip() {
  try {
    return typeof AVZIP === "object" && AVZIP !== null &&
      typeof AVZIP.list === "function" && typeof AVZIP.extract === "function";
  } catch (e) { return false; }
}

/* a rounded finite number clamped into [lo, hi]; garbage -> dflt */
function avImportKitNum(v, dflt, lo, hi) {
  const n = Number(v);
  if (!avImportIsNum(n)) return dflt;
  const r = Math.round(n);
  return r < lo ? lo : (r > hi ? hi : r);
}

/* the av_chop volume law: 10^(dB/20) * AV_CHOP_VOL_SCALE, the dB clamped 0..24 (section 2) */
function avImportKitVol(db) {
  let scale = 0.8;
  try { if (avImportIsNum(AV_CHOP_VOL_SCALE) && AV_CHOP_VOL_SCALE > 0) scale = AV_CHOP_VOL_SCALE; }
  catch (e) { /* av_chop absent: the pinned default stands */ }
  const n = Number(db);
  const d = avImportIsNum(n) ? Math.max(0, Math.min(24, n)) : 0;
  const vol = Math.pow(10, d / 20) * scale;
  return avImportIsNum(vol) ? vol : 0;
}

/* one EXS zone -> the kit meta zone row (section 2: root folds coarseTuning, fades 0) */
function avImportKitZone(zn, sampleName, ref) {
  const lo = avImportKitNum(zn && zn.keyLow, 0, 0, 127);
  const hi0 = avImportKitNum(zn && zn.keyHigh, lo, 0, 127);
  const key = avImportKitNum(zn && zn.key, 60, 0, 127);
  const coarse = avImportKitNum(zn && (zn.coarseTuning != null ? zn.coarseTuning : zn.coarse), 0, -127, 127);
  const root = Math.max(0, Math.min(127, key + coarse));
  return {
    lo: lo,
    hi: (hi0 < lo) ? lo : hi0,
    root: root,
    buf: ref,
    vol: avImportKitVol(zn && zn.volumeAdjust),
    s0: avImportKitNum(zn && zn.sampleStart, 0, 0, 0xFFFFFFFF),
    s1: avImportKitNum(zn && zn.sampleEnd, 0, 0, 0xFFFFFFFF),
    fIn: 0,
    fOut: 0,
    velLow: avImportKitNum(zn && zn.velocityLow, 0, 0, 127),
    velHigh: avImportKitNum(zn && zn.velocityHigh, 127, 0, 127),
    file: sampleName
  };
}

/* the source-agnostic kit builder (R15d section 4.3): fed by the exs parse and by the AVNI
   legacy parse with a parsed object carrying zones + samples arrays -> { ok, meta:
   { zones, samples, skipped } } or { ok:false, error }. Zones without a resolvable sampleIndex
   are dropped (counted in skipped); the 16-zone cap is counted in skipped with a receipt note;
   oneshot/reverse flags are flattened (note only). Same error strings, caps and notes as the
   R15c builder so the EXS path stays bit-identical. */
function avImportKitMetaFrom(parsed, item, ctx) {
  try {
    if (!parsed || parsed.ok !== true) return { ok: false, error: avImportDetail(parsed && parsed.error) };
    const srcZones = Array.isArray(parsed.zones) ? parsed.zones : [];
    const srcSamples = Array.isArray(parsed.samples) ? parsed.samples : [];
    if (!srcZones.length) return { ok: false, error: "no zones found" };
    const zones = [];
    const samples = [];
    const byIdx = {};
    let skipped = 0, capN = 0, noRef = 0, flagsN = 0;
    for (let i = 0; i < srcZones.length; i++) {
      const zn = srcZones[i];
      if (!zn || typeof zn !== "object") { skipped += 1; noRef += 1; continue; }
      if (zones.length >= AV_IMPORT_KIT_ZONES) { skipped += 1; capN += 1; continue; }
      const si = avImportKitNum(zn.sampleIndex, -1, -1, 0xFFFFFFFF);
      const smp = (si >= 0 && si < srcSamples.length) ? srcSamples[si] : null;
      if (!smp || typeof smp !== "object") { skipped += 1; noRef += 1; continue; }
      let ref = byIdx[si];
      if (ref === undefined) {
        ref = samples.length;
        byIdx[si] = ref;
        const nm = avImportLeaf(avImportStrOf(smp.fileName, 256)) || avImportLeaf(avImportStrOf(smp.filePath, 512));
        samples.push({ ref: ref, name: avImportCapStr(nm, 120) });
      }
      const zrow = avImportKitZone(zn, samples[ref].name, ref);
      const fl = avImportKitNum(zn.flags, 0, 0, 255);
      if (((fl & 1) === 1) || ((fl & 4) === 4) || zn.oneshot === true || zn.reverse === true) flagsN += 1;
      zones.push(zrow);
    }
    if (!zones.length) return { ok: false, error: "no usable zones" };
    if (ctx && Array.isArray(ctx.notes)) {
      const nm2 = avImportCapStr(item && item.name, 60) || "exs";
      if (capN > 0) ctx.notes.push(nm2 + ": " + capN + " zone(s) beyond the 16-zone cap skipped");
      if (noRef > 0) ctx.notes.push(nm2 + ": " + noRef + " zone(s) without a sample reference dropped");
      if (flagsN > 0) ctx.notes.push(nm2 + ": " + flagsN + " oneshot/reverse zone flag(s) flattened (v1)");
    }
    return { ok: true, meta: { zones: zones, samples: samples, skipped: skipped } };
  } catch (e) {
    return { ok: false, error: avImportDetail(e) };
  }
}

/* AVEXS.parse behind the per-call guard: the parsed object, or null (never throws) */
function avImportExsParse(bytes) {
  try {
    if (!avImportHasExs()) return null;
    return AVEXS.parse(bytes);
  } catch (e) {
    return null;
  }
}

/* the exs call site (signature kept from R15c): parse-then-build via the shared builder */
function avImportKitMeta(bytes, item, ctx) {
  return avImportKitMetaFrom(avImportExsParse(bytes), item, ctx);
}

/* the NI refs meta (R15d section 2; container nki / nbkt / the legacy fallback): refs rows
   held to AV_IMPORT_NI_REF_CAP, refCount, presetName (the reader's name), product, version,
   kind ("nki-container" | "nki-legacy" | "nbkt"). Beyond-cap refs are counted into a ctx
   note. */
function avImportNiRefsMeta(pr, item, ctx, kind) {
  try {
    const srcRefs = Array.isArray(pr.refs) ? pr.refs : [];
    const refs = [];
    const n = Math.min(srcRefs.length, AV_IMPORT_NI_REF_CAP);
    for (let i = 0; i < n; i++) {
      const r = srcRefs[i];
      if (!r || typeof r !== "object") continue;
      refs.push({ name: avImportStrOf(r.name, 120), path: avImportStrOf(r.path, 200) });
    }
    if (ctx && Array.isArray(ctx.notes) && srcRefs.length > AV_IMPORT_NI_REF_CAP) {
      const nm2 = avImportCapStr(item && item.name, 60) || "ni";
      ctx.notes.push(nm2 + ": " + (srcRefs.length - AV_IMPORT_NI_REF_CAP) + " ref(s) beyond the 512-ref cap dropped");
    }
    return { ok: true, meta: {
      refs: refs,
      refCount: refs.length,
      presetName: avImportStrOf(pr.name, 120),
      product: avImportStrOf(pr.product, 60),
      version: avImportStrOf(pr.version, 60),
      kind: kind
    } };
  } catch (e) {
    return { ok: false, error: avImportDetail(e) };
  }
}

/* the SXT refs meta (R15d section 2; meta.kind "sxt"): refs rows held to AV_IMPORT_SXT_REF_CAP,
   refCount, presetName (the patch name when the reader found one), version from the tag,
   product "". Beyond-cap refs are counted into a ctx note. */
function avImportSxtRefsMeta(ex, item, ctx) {
  try {
    const srcRefs = Array.isArray(ex.refs) ? ex.refs : [];
    const refs = [];
    const n = Math.min(srcRefs.length, AV_IMPORT_SXT_REF_CAP);
    for (let i = 0; i < n; i++) {
      const r = srcRefs[i];
      if (!r || typeof r !== "object") continue;
      refs.push({ name: avImportStrOf(r.name, 120), path: avImportStrOf(r.path, 200) });
    }
    if (ctx && Array.isArray(ctx.notes) && srcRefs.length > AV_IMPORT_SXT_REF_CAP) {
      const nm2 = avImportCapStr(item && item.name, 60) || "sxt";
      ctx.notes.push(nm2 + ": " + (srcRefs.length - AV_IMPORT_SXT_REF_CAP) + " ref(s) beyond the 512-ref cap dropped");
    }
    return { ok: true, meta: {
      refs: refs,
      refCount: refs.length,
      presetName: avImportStrOf(ex.name, 120),
      product: "",
      version: avImportStrOf(ex.version, 60),
      kind: "sxt"
    } };
  } catch (e) {
    return { ok: false, error: avImportDetail(e) };
  }
}

/* avAlsExtract (async) -> refs meta { refs, refCount, noteCount, tempoBpm, pattern }; the
   extracted notes are capped at 512 FIRST (first-N wins) and the pattern maps from the capped
   set via avAlsToPattern (guarded per call; absent -> pattern stays null, the refs still land). */
async function avImportAlsMeta(bytes, item, ctx) {
  try {
    const ex = await avAlsExtract(bytes);
    if (!ex || ex.ok !== true) return { ok: false, error: avImportDetail(ex && ex.error) };
    const srcRefs = Array.isArray(ex.refs) ? ex.refs : [];
    const refs = [];
    const refN = Math.min(srcRefs.length, AV_IMPORT_ALS_REF_CAP);
    for (let i = 0; i < refN; i++) {
      const r = srcRefs[i];
      if (!r || typeof r !== "object") continue;
      refs.push({ name: avImportStrOf(r.name, 120), path: avImportStrOf(r.path, 200) });
    }
    let notes = Array.isArray(ex.notes) ? ex.notes : [];
    const noteTotal = notes.length;
    const noteN = Math.min(noteTotal, AV_IMPORT_ALS_NOTE_CAP);
    if (noteN < noteTotal) notes = notes.slice(0, noteN);          /* first-N wins */
    let tempo = Number(ex.tempoBpm);
    if (!avImportIsNum(tempo) || tempo < 0) tempo = 0;
    const meta = {
      refs: refs,
      refCount: refs.length,
      noteCount: notes.length,
      tempoBpm: tempo,
      pattern: null
    };
    /* name = the file leaf (avAlsToPattern caps it at 24) */
    const leaf = (typeof item.name === "string" && item.name) ? item.name : "";
    if (avImportHasAlsPattern() && notes.length) {
      try {
        const src = Object.assign({}, ex, { notes: notes });
        const mapped = avAlsToPattern(src, { name: leaf });
        if (mapped && mapped.ok === true && mapped.pattern) meta.pattern = mapped.pattern;
      } catch (e) { /* the pattern is a nicety; the refs stand */ }
    }
    if (ctx && Array.isArray(ctx.notes)) {
      const nm2 = avImportCapStr(item && item.name, 60) || "als";
      if (srcRefs.length > AV_IMPORT_ALS_REF_CAP) {
        ctx.notes.push(nm2 + ": " + (srcRefs.length - AV_IMPORT_ALS_REF_CAP) + " ref(s) beyond the 512-ref cap dropped");
      }
      if (noteTotal > AV_IMPORT_ALS_NOTE_CAP) {
        ctx.notes.push(nm2 + ": " + (noteTotal - AV_IMPORT_ALS_NOTE_CAP) + " note(s) beyond the 512-note cap dropped");
      }
    }
    return { ok: true, meta: meta };
  } catch (e) {
    return { ok: false, error: avImportDetail(e) };
  }
}

/* AVSerum.extract (async) -> refs meta { wtRefs, presetName, product, version, kind }.
   wtRefs capped at 256. kind: "serum2" (the pinned label) unless the reader reports "fxp". */
async function avImportSerumMeta(bytes) {
  try {
    const ex = await AVSerum.extract(bytes);
    if (!ex || ex.ok !== true) return { ok: false, error: avImportDetail(ex && ex.error) };
    const src = Array.isArray(ex.wtRefs) ? ex.wtRefs : [];
    const wtRefs = [];
    const n = Math.min(src.length, AV_IMPORT_SERUM_WT_CAP);
    for (let i = 0; i < n; i++) {
      const w = src[i];
      if (!w || typeof w !== "object") continue;
      wtRefs.push({ module: avImportStrOf(w.module, 24), path: avImportStrOf(w.path, 200) });
    }
    const mj = (ex.meta && typeof ex.meta === "object") ? ex.meta : {};
    const kind0 = (typeof ex.kind === "string" && ex.kind === "fxp") ? "fxp" : "serum2";
    return { ok: true, meta: {
      wtRefs: wtRefs,
      presetName: avImportStrOf(mj.presetName, 120),
      product: avImportStrOf(mj.product, 60),
      version: avImportStrOf(mj.version, 60),
      kind: kind0
    } };
  } catch (e) {
    return { ok: false, error: avImportDetail(e) };
  }
}

/* ---------- R18: content identity (sha-256; "" when crypto.subtle is absent or refuses -
   the import NEVER blocks on a hash, mirroring avBackupSha256Hex; av_store.js's lookup) ---------- */

function avImportCryptoSrc() {
  try { if (typeof crypto !== "undefined" && crypto) return crypto; } catch (e) { /* none */ }
  try { const w = (typeof window !== "undefined") ? window : null; if (w && w.crypto) return w.crypto; } catch (e) { /* no window */ }
  return null;
}

/* sha-256 hex of the full bytes; "" on absence/refusal (honest, capped - never throws) */
async function avImportSha256Hex(buf) {
  try {
    const c = avImportCryptoSrc();
    if (!c || !c.subtle || typeof c.subtle.digest !== "function") return "";
    const ab = avImportToAB(buf);
    if (!ab) return "";
    const d = await c.subtle.digest("SHA-256", ab);
    const u = new Uint8Array(d);
    let s = "";
    for (let i = 0; i < u.length; i++) { const h = u[i].toString(16); s += (h.length < 2 ? "0" : "") + h; }
    return (/^[0-9a-f]{64}$/.test(s)) ? s : "";
  } catch (e) { return ""; }
}

/* ---------- persistence (avLibAddItem, guarded per call) ---------- */

async function avImportWrite(item, bytes, ctx) {
  try {
    if (typeof avLibAddItem !== "function") return "";   /* absent library: id stays "" */
    /* R18a: the ONE hash site (D2). The sha runs before the write; the duplicate lookup also
       runs BEFORE the commit so the rec can carry dupOf (keep-both: the write still happens). */
    let sha = "";
    try {
      const bl = (bytes && typeof bytes.byteLength === "number") ? bytes.byteLength : -1;
      if (bytes && bl !== 0) sha = await avImportSha256Hex(bytes);
    } catch (e0) { sha = ""; }
    if (typeof sha !== "string") sha = "";
    item.sha = sha;
    let dup = null;
    if (sha) {
      try {
        if (typeof avLibFindSha === "function") {
          const f = await avLibFindSha(sha);
          if (f && f.ok === true && f.hit === true && typeof f.id === "string" && f.id) {
            dup = { id: f.id, name: avImportCapStr(f.name, 120) };
          }
        }
      } catch (e1) { dup = null; }
    }
    if (dup) item.dup = { id: dup.id, name: dup.name };
    const rec = {
      key: item.key, name: item.name, path: item.path, ext: item.ext,
      format: item.format, kind: item.kind, result: item.result, reason: item.reason,
      size: item.size, at: ctx.at, meta: item.meta, bytes: bytes, via: "import",
      sha256: sha,
      source: { name: item.name, path: item.path, size: item.size, at: ctx.at }
    };
    if (dup) rec.dupOf = { id: dup.id, name: dup.name };
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

async function avImportOne(f, index, o, ctx, key) {
  const item = avImportBase(f, index, key);
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
  /* R16: top-level zips are expanded by the run's pre-pass and never reach this call site; a
     zip that does (reader absent, or the pre-pass could not stage it) keeps the honest
     defers -- the R15b absent-reader line, the size refusal, or the unreadable line */
  if (item.format === "zip") {
    if (!avImportHasZip()) return avImportSet(item, "deferred", avImportZipAbsent);
    if (item.size > AV_IMPORT_ITEM_MAX) return avImportSet(item, "refused", avImportTooLarge);
    return avImportSet(item, "deferred", avImportUnreadable(avImportZipUnread, "not expanded"));
  }
  if (!pol.persist) return item;         /* deferred/refused per the pinned table */

  /* persist-policy formats: wav, mp3, aiff, mid, rex2, exs, adg, als, serum, nki, nbkt, sxt */
  if (item.size > AV_IMPORT_ITEM_MAX) return avImportSet(item, "refused", avImportTooLarge);
  if (item.format === "aiff" && !avImportHasAiff()) return avImportSet(item, "deferred", avImportAiffDefer);
  if (item.format === "rex2" && !avImportHasRex()) return avImportSet(item, "deferred", avImportRexDefer);
  /* R15c readers: a missing adapter defers with the pinned pending line BEFORE the full read */
  if (item.format === "exs" && !avImportHasExs()) return avImportSet(item, "deferred", avImportExsPending);
  if ((item.format === "adg" || item.format === "als") && !avImportHasAls()) return avImportSet(item, "deferred", avImportAlsPending);
  if (item.format === "serum" && !avImportHasSerum()) return avImportSet(item, "deferred", avImportSerumPending);
  /* R15d readers: the same defer-before-read discipline */
  if (item.format === "nki" && !avImportHasNi()) return avImportSet(item, "deferred", avImportNkiPending);
  if (item.format === "nbkt" && !avImportHasNi()) return avImportSet(item, "deferred", avImportNbktPending);
  if (item.format === "sxt" && !avImportHasSxt()) return avImportSet(item, "deferred", avImportSxtPending);

  let bytes = null;
  try { bytes = await avImportFull(f); } catch (e) { bytes = null; }
  if (!bytes) return avImportSet(item, "refused", avImportReadFail);

  if (item.format === "exs") {
    const r = avImportKitMeta(bytes, item, ctx);
    if (!r.ok) return avImportSet(item, "deferred", avImportUnreadable(avImportExsUnread, r.error));
    item.meta = r.meta;
    if (o.persist !== false) item.id = await avImportWrite(item, bytes, ctx);
    return item;
  }
  if (item.format === "adg" || item.format === "als") {
    const r = await avImportAlsMeta(bytes, item, ctx);
    if (!r.ok) return avImportSet(item, "deferred", avImportUnreadable(avImportAlsUnread, r.error));
    item.meta = r.meta;
    if (o.persist !== false) item.id = await avImportWrite(item, bytes, ctx);
    return item;
  }
  if (item.format === "serum") {
    const r = await avImportSerumMeta(bytes);
    if (!r.ok) return avImportSet(item, "deferred", avImportUnreadable(avImportSerumUnread, r.error));
    item.meta = r.meta;
    if (o.persist !== false) item.id = await avImportWrite(item, bytes, ctx);
    return item;
  }

  /* R15d: nki/nbkt -- legacy kits, modern containers, honest refusals (guarded per call) */
  if (item.format === "nki" || item.format === "nbkt") {
    let pr = null;
    try { pr = await AVNI.parse(bytes, item.ext); } catch (e) { pr = null; }
    if (!pr || pr.ok !== true) {
      if (pr && pr.encrypted === true) {
        return avImportSet(item, "refused", (item.format === "nbkt") ? avImportNbktEncrypted : avImportNkiEncrypted);
      }
      const un = (item.format === "nbkt") ? avImportNbktUnread : avImportNkiUnread;
      return avImportSet(item, "deferred", avImportUnreadable(un, pr && pr.error));
    }
    const isNbkt = (item.format === "nbkt" || pr.kind === "nbkt");
    if (pr.kind === "legacy") {
      const zn = Array.isArray(pr.zones) ? pr.zones : [];
      if (zn.length) {
        const k = avImportKitMetaFrom(pr, item, ctx);
        if (k.ok === true) {
          item.kind = "kit";
          item.meta = k.meta;
          if (o.persist !== false) item.id = await avImportWrite(item, bytes, ctx);
          return item;
        }
        /* "no usable zones": the refs below stand in */
      } else if (ctx && Array.isArray(ctx.notes)) {
        const nm2 = avImportCapStr(item.name, 60) || "nki";
        ctx.notes.push(nm2 + ": legacy parse without zones \u2014 refs only");
      }
      const r0 = avImportNiRefsMeta(pr, item, ctx, "nki-legacy");
      if (r0.ok !== true) return avImportSet(item, "deferred", avImportUnreadable(avImportNkiUnread, r0.error));
      item.meta = r0.meta;
      if (o.persist !== false) item.id = await avImportWrite(item, bytes, ctx);
      return item;
    }
    const r = avImportNiRefsMeta(pr, item, ctx, isNbkt ? "nbkt" : "nki-container");
    if (r.ok !== true) return avImportSet(item, "deferred", avImportUnreadable(isNbkt ? avImportNbktUnread : avImportNkiUnread, r.error));
    item.meta = r.meta;
    if (o.persist !== false) item.id = await avImportWrite(item, bytes, ctx);
    return item;
  }
  if (item.format === "sxt") {
    let ex = null;
    try { ex = AVSXT.extract(bytes); } catch (e) { ex = null; }
    if (!ex || ex.ok !== true) return avImportSet(item, "deferred", avImportUnreadable(avImportSxtUnread, ex && ex.error));
    const r = avImportSxtRefsMeta(ex, item, ctx);
    if (r.ok !== true) return avImportSet(item, "deferred", avImportUnreadable(avImportSxtUnread, r.error));
    item.meta = r.meta;
    if (o.persist !== false) item.id = await avImportWrite(item, bytes, ctx);
    return item;
  }

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

/* ---------- R16 zip expansion pre-pass (section 4.4) ---------- */

/* the plain run list (one entry per input; the pre-pass fallback) */
function avImportPlainRun(list) {
  const run = [];
  try {
    for (let i = 0; i < list.length; i++) run.push({ file: list[i], index: i, key: "i" + (i + 1) });
  } catch (e) { /* a partial run stands */ }
  return run;
}

/* one nested-archive child row (depth guard ctx.zipDepth = 1: a zip ENTRY that itself sniffs
   zip is NOT expanded): key "z" + n, name = entry leaf, path = zip leaf + "/" + entry (cap
   200); the caller sets the pinned deferred nested line on it */
function avImportZipChildRow(item, entryName, size) {
  const nm = (typeof entryName === "string") ? entryName : "";
  const leaf = avImportLeaf(nm) || nm;
  const zp = (typeof item.name === "string" && item.name) ? item.name : "";
  const row = {
    key: "", name: avImportCapStr(leaf, 120),
    path: avImportCapStr(zp ? (zp + "/" + nm) : nm, 200),
    ext: avImportExtOf(leaf), format: "zip", kind: "bundle", result: "imported",
    reason: "", size: 0, sibling: "", id: "", sha: "", dup: null, meta: {}
  };
  try { if (avImportIsNum(size) && size >= 0) row.size = Math.floor(size); } catch (e) { /* size stays 0 */ }
  return row;
}

/* the synthesized File child for one extracted entry: the entry leaf becomes the name and the
   receipt path rides webkitRelativePath (zip leaf + "/" + entry name, mirroring the
   folder-walk stamp). No File global (node harness) / construction refused -> null and the
   entry is skipped honestly by the caller. */
function avImportZipFile(item, entryName, bytes) {
  try {
    if (typeof File !== "function" || !bytes) return null;
    const nm = (typeof entryName === "string" && entryName) ? entryName : "entry";
    const leaf = avImportLeaf(nm) || nm;
    const f = new File([bytes], leaf);
    const zp = (typeof item.name === "string" && item.name) ? item.name : "";
    try {
      if (zp) Object.defineProperty(f, "webkitRelativePath", { value: zp + "/" + nm, writable: true, configurable: true });
    } catch (e2) { /* the path stamp is a nicety */ }
    return f;
  } catch (e) { return null; }
}

/* ---------- R19 user packs: the zip pre-pass route (verify/_r19_wave.md section 4) ---------- */

/* the av_pack.js entry points (typeof-guarded PER CALL; the window.__avPack facade is the
   belt). An absent module yields null and every zip keeps the R16 path verbatim. */
function avImportPackValidateFn() {
  try {
    if (typeof avPackValidateManifest === "function") return avPackValidateManifest;
    if (typeof window !== "undefined" && window && window.__avPack &&
        typeof window.__avPack.validate === "function") return window.__avPack.validate;
  } catch (e) { /* absent */ }
  return null;
}

function avImportPackImportFn() {
  try {
    if (typeof avPackImportBytes === "function") return avPackImportBytes;
    if (typeof window !== "undefined" && window && window.__avPack &&
        typeof window.__avPack.importBytes === "function") return window.__avPack.importBytes;
  } catch (e) { /* absent */ }
  return null;
}

/* the extracted manifest bytes -> parsed JSON (UTF-8; TextDecoder looked up per call --
   absent or a decode refusal -> null, and the input is simply not routed as a pack).
   Never throws. */
function avImportPackJson(x) {
  try {
    let b = null;
    if (typeof Uint8Array !== "undefined" && x instanceof Uint8Array) b = x;
    else if (typeof ArrayBuffer !== "undefined" && x instanceof ArrayBuffer) b = new Uint8Array(x);
    else if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(x)) {
      b = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    }
    if (!b) return null;
    let txt = null;
    try { if (typeof TextDecoder === "function") txt = new TextDecoder("utf-8").decode(b); } catch (e1) { txt = null; }
    if (typeof txt !== "string") return null;
    return JSON.parse(txt);
  } catch (e) { return null; }
}

/* the pack's per-item results -> the row-meta rows (fixed shape; strings capped) */
function avImportPackRows(rows) {
  const out = [];
  try {
    if (!Array.isArray(rows)) return out;
    for (let k = 0; k < rows.length; k++) {
      const r0 = (rows[k] && typeof rows[k] === "object") ? rows[k] : {};
      out.push({
        key: avImportCapStr(r0.key, 64),
        name: avImportCapStr(r0.name, 120),
        kind: avImportCapStr(r0.kind, 24),
        result: avImportCapStr(r0.result, 16),
        reason: avImportCapStr(r0.reason, 160)
      });
    }
  } catch (e) { /* the partial rows stand */ }
  return out;
}

/* the installed/refused tallies of the pack's per-item rows (rows absent -> the pack's own
   counts object, when it carries the numbers) */
function avImportPackCounts(rows, counts) {
  const out = { installed: 0, refused: 0 };
  try {
    if (Array.isArray(rows)) {
      for (let k = 0; k < rows.length; k++) {
        const rr = rows[k] || {};
        if (rr.result === "imported") out.installed += 1;
        else if (rr.result === "refused") out.refused += 1;
      }
      return out;
    }
    const c = (counts && typeof counts === "object") ? counts : {};
    if (avImportIsNum(c.installed)) out.installed = Math.max(0, Math.floor(c.installed));
    if (avImportIsNum(c.refused)) out.refused = Math.max(0, Math.floor(c.refused));
  } catch (e) { /* zeros stand */ }
  return out;
}

/* R19: the pack route. An input that opens as a zip (the existing AVZIP reader; the caller
   has the listed entries) AND carries a ROOT manifest.json whose manifest validates
   (avPackValidateManifest) is a PACK: avPackImportBytes installs the items and this ONE
   bundle row carries the per-item results in its meta {pack, items, installed, refused}.
   Returns true when the row was staged; false -- untouched, no note -- for a non-pack zip,
   and false with a ctx note when an identified pack could not be routed (support absent, a
   throw, a garbage return), so the generic R16 expansion proceeds. Never throws. */
async function avImportZipPackRoute(item, bytes, u8, entries, ctx, run) {
  const note = function (msg) {
    try { if (ctx && Array.isArray(ctx.notes)) ctx.notes.push(avImportCapStr(msg, 160)); } catch (e0) { /* best-effort */ }
  };
  try {
    const validate = avImportPackValidateFn();
    if (typeof validate !== "function") return false;      /* av_pack.js absent: R16 verbatim */
    let mi = -1;                                           /* the ROOT manifest.json member */
    for (let k = 0; k < entries.length; k++) {
      const en = entries[k];
      if (!en || typeof en !== "object" || en.dir === true) continue;
      if (en.name === "manifest.json") { mi = k; break; }
    }
    if (mi < 0) return false;                              /* no manifest: a generic zip */
    let man = null;
    try {
      const ex = (typeof AVZIP.extract === "function") ? await AVZIP.extract(u8, mi) : null;
      if (ex && ex.ok === true) man = avImportPackJson(ex.bytes);
    } catch (e1) { man = null; }
    let vd = null;
    try { vd = man ? validate(man) : null; } catch (e2) { vd = null; }
    if (!vd || vd.ok !== true) return false;               /* invalid manifest: a generic zip */
    const nm = avImportCapStr(item.name, 60) || "pack";
    const imp = avImportPackImportFn();
    if (typeof imp !== "function") {
      note(nm + ": .avpack support absent \u2014 expanded generically");
      return false;
    }
    let res = null, failD = "";
    try { res = await imp(bytes, avImportCapStr(item.name, 120) || "pack.avpack"); }
    catch (e3) { res = null; failD = avImportDetail(e3); }
    if (!res || typeof res !== "object") {
      note(nm + ": pack import failed" + (failD ? " (" + avImportCapStr(failD, 60) + ")" : "") + " \u2014 expanded generically");
      return false;
    }
    const rows = avImportPackRows(res.items);
    const nums = avImportPackCounts(res.items, res.counts);
    const pid = (res.pack && typeof res.pack === "object" && typeof res.pack.id === "string") ? res.pack.id : "";
    let result = "imported", reason = "";
    if (res.ok !== true) {
      result = "refused";
      const errs = Array.isArray(res.errors) ? res.errors : [];
      let first = "";
      for (let k = 0; k < errs.length; k++) { if (typeof errs[k] === "string" && errs[k]) { first = errs[k]; break; } }
      reason = first ? avImportCapStr(first, 160) : "pack import failed";
    }
    let pushed = false;
    try { run.push({ item: item }); pushed = true; } catch (e4) { pushed = false; }
    if (!pushed) return false;                             /* untouched: the generic R16 path */
    try {
      avImportSet(item, result, reason);
      item.meta = { pack: pid, items: (Array.isArray(rows) ? rows.length : 0), rows: rows, installed: nums.installed, refused: nums.refused };
    } catch (e5) { /* the row is staged; the creation defaults stand */ }
    return true;
  } catch (e6) {
    return false;                                          /* the caller's belt notes + R16 */
  }
}

/* expand ONE zip input (its head64 already sniffed zip): construct the bundle row and stage
   the run entries -- the zip row FIRST, then every expanded entry's child right after it.
   Budget: children count against AV_IMPORT_MAX_FILES (the pre-pass reserves a slot per
   remaining input and the zip row itself). Never throws: every failure lands as an honest
   deferred/refused row. Returns true when the zip row was staged. */
async function avImportZipExpand(f, i, ctx, run, budget) {
  const item = avImportBase(f, i);
  item.format = "zip";
  item.kind = "bundle";
  item.result = "imported";
  item.reason = "";
  item.meta = { entries: 0, expanded: 0, skipped: 0 };
  let staged = false;
  const stage = function () {
    if (staged) return;
    staged = true;
    try { run.push({ item: item }); } catch (e0) { /* the caller falls back */ }
  };
  let seen = 0, expanded = 0, skipped = 0;
  try {
    if (!avImportHasZip()) {
      avImportSet(item, "deferred", avImportZipAbsent);          /* the R15b fallback line */
      stage();
      return staged;
    }
    if (avImportIsNum(item.size) && item.size > AV_IMPORT_ITEM_MAX) {
      avImportSet(item, "refused", avImportTooLarge);
      stage();
      return staged;
    }
    let bytes = null;
    try { bytes = await avImportFull(f); } catch (e1) { bytes = null; }
    if (!bytes) {
      avImportSet(item, "deferred", avImportUnreadable(avImportZipUnread, "read failed"));
      stage();
      return staged;
    }
    const u8 = new Uint8Array(bytes);
    let lr = null;
    try { lr = (typeof AVZIP.list === "function") ? AVZIP.list(u8) : null; } catch (e2) { lr = null; }
    if (!lr || lr.ok !== true) {
      avImportSet(item, "deferred", avImportUnreadable(avImportZipUnread, lr && lr.error));
      stage();
      return staged;
    }
    const entries = Array.isArray(lr.entries) ? lr.entries : [];
    /* R19: an .avpack (ROOT manifest.json + a validating manifest) routes to the pack
       importer -- ONE bundle row, never the R16 expansion below. A non-pack zip proceeds
       byte-for-byte as R16; any internal failure falls back here with a ctx note. */
    try {
      if (await avImportZipPackRoute(item, bytes, u8, entries, ctx, run) === true) return true;
    } catch (e19) {
      try {
        if (ctx && Array.isArray(ctx.notes)) {
          ctx.notes.push(avImportCapStr((avImportCapStr(item.name, 60) || "zip") + ": pack probe failed (" + avImportCapStr(avImportDetail(e19), 60) + ") \u2014 expanded generically", 160));
        }
      } catch (e19b) { /* best-effort */ }
    }
    let zN = 0, beyondN = 0, capN = 0, failN = 0, failDetail = "", nestN = 0, nestFirst = "";
    let left = avImportIsNum(budget) ? budget : 0;
    ctx.zipDepth = (ctx.zipDepth | 0) + 1;      /* depth guard: only depth-0 zips expand (v1) */
    stage();                                    /* the zip row lands BEFORE its children */
    for (let k = 0; k < entries.length; k++) {
      const en = entries[k];
      if (!en || typeof en !== "object") continue;
      if (en.dir === true) continue;            /* directory entries are never children */
      const enName = avImportCapStr(en.name, 512);
      if (enName.slice(-1) === "/") continue;   /* belt: a trailing slash is a directory */
      seen += 1;
      if (left <= 0) { skipped += 1; beyondN += 1; continue; }
      if (avImportIsNum(en.size) && en.size > AV_IMPORT_ITEM_MAX) { skipped += 1; capN += 1; continue; }
      let ex = null;
      try { ex = (typeof AVZIP.extract === "function") ? await AVZIP.extract(u8, k) : null; } catch (e3) { ex = null; }
      let eb = null;
      try {
        if (ex && ex.ok === true && ex.bytes != null) {
          if (typeof Uint8Array !== "undefined" && ex.bytes instanceof Uint8Array) eb = ex.bytes;
          else if (typeof ArrayBuffer !== "undefined" && ex.bytes instanceof ArrayBuffer) eb = new Uint8Array(ex.bytes);
        }
      } catch (e4) { eb = null; }
      if (!eb) {
        skipped += 1;
        failN += 1;
        if (!failDetail) failDetail = avImportCapStr(avImportDetail(ex && ex.error), 60);
        continue;
      }
      let nf = { format: "unknown" };
      try {
        nf = avImportSniff((eb.length > 64) ? eb.slice(0, 64) : eb, avImportExtOf(enName));
      } catch (e5) { nf = { format: "unknown" }; }
      if (nf && nf.format === "zip") {
        /* depth guard ctx.zipDepth = 1: a nested archive is NOT expanded -- it lands
           deferred with the pinned nested line + a ctx note */
        zN += 1;
        const row = avImportZipChildRow(item, enName, eb.length);
        row.key = "z" + zN;
        avImportSet(row, "deferred", avImportZipNested);
        run.push({ item: row });
        skipped += 1;
        left -= 1;
        nestN += 1;
        if (!nestFirst) nestFirst = avImportCapStr(avImportLeaf(enName) || enName, 60);
        continue;
      }
      const zf = avImportZipFile(item, enName, eb);
      if (!zf) {
        skipped += 1;
        failN += 1;
        if (!failDetail) failDetail = "child file not available";
        continue;
      }
      zN += 1;
      run.push({ file: zf, index: i, key: "z" + zN });
      expanded += 1;
      left -= 1;
    }
    ctx.zipDepth = (ctx.zipDepth | 0) - 1;
    item.meta = { entries: seen, expanded: expanded, skipped: skipped };
    const znm = avImportCapStr(item.name, 60) || "zip";
    if (beyondN > 0) ctx.notes.push(znm + ": " + beyondN + " entry(ies) beyond the " + AV_IMPORT_MAX_FILES + "-file budget skipped");
    if (capN > 0) ctx.notes.push(znm + ": " + capN + " entry(ies) over the 96 MB item cap skipped");
    if (failN > 0) ctx.notes.push(znm + ": " + failN + " entry(ies) skipped (" + (failDetail || "extract failed") + ")");
    if (nestN > 0) ctx.notes.push(znm + ": " + nestN + " nested archive(s) not expanded (v1)" + (nestFirst ? ", first: " + nestFirst : ""));
    if (expanded === 0) avImportSet(item, "deferred", avImportZipNoEntries);
    return staged;
  } catch (e6) {
    try {
      avImportSet(item, "deferred", avImportUnreadable(avImportZipUnread, avImportDetail(e6)));
      stage();
      if (item.meta) item.meta = { entries: seen, expanded: expanded, skipped: skipped };
    } catch (e7) { /* the degrade is best-effort */ }
    return staged;
  }
}

/* R16: the expansion pre-pass -- stage the whole run. Every input whose head64 sniffs zip
   (reader present, size within the cap) is expanded in place; everything else passes
   through. Never throws: on failure the caller retries with the plain inputs. */
async function avImportZipPrep(list, o, ctx) {
  const run = [];
  try {
    if (!Array.isArray(list) || !avImportHasZip()) return avImportPlainRun(list);
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      let staged = false;
      try {
        if (f && typeof f === "object" && typeof f.slice === "function") {
          let sizeOk = true;
          try { const s0 = f.size; if (avImportIsNum(s0) && s0 > AV_IMPORT_ITEM_MAX) sizeOk = false; } catch (e1) { sizeOk = true; }
          if (sizeOk) {
            let head = null;
            try { head = await avImportHead64(f); } catch (e2) { head = null; }
            if (head) {
              let ext = "";
              try { if (typeof f.name === "string") ext = avImportExtOf(f.name); } catch (e3) { ext = ""; }
              const sn = avImportSniff(head, ext);
              if (sn && sn.format === "zip") {
                const budget = Math.max(0, AV_IMPORT_MAX_FILES - run.length - 1 - (list.length - i - 1));
                staged = (await avImportZipExpand(f, i, ctx, run, budget)) === true;
              }
            }
          }
        }
      } catch (e4) { staged = false; }
      if (!staged) run.push({ file: f, index: i, key: "i" + (i + 1) });
    }
    return run;
  } catch (e) { return null; }                 /* the caller retries with the plain run */
}

/* ---------- the run ---------- */

async function avImportRun(receipt, list, o) {
  /* R15d ctx fix: `notes` is part of the pinned context -- `if (ctx.notes.length)` below
     always runs, so without the array EVERY run threw there and avImportFiles stamped
     "import run failed" onto receipt.errors (clean runs included). */
  const ctx = { at: receipt.at, writeFails: 0, notes: [], zipDepth: 0 };
  try {
    /* R16: the zip expansion pre-pass stages the run list (constructed bundle rows +
       synthesized children right after their zip); any pre-pass failure falls back to the
       plain inputs, where avImportOne's zip branch still defers honestly */
    let run = null;
    try { run = await avImportZipPrep(list, o, ctx); } catch (eR16) { run = null; }
    if (!run || !Array.isArray(run)) run = avImportPlainRun(list);
    for (let i = 0; i < run.length; i++) {
      const ent = (run[i] && typeof run[i] === "object") ? run[i] : {};
      let item = null;
      if (ent.item && typeof ent.item === "object") {
        item = ent.item;                /* R16: the zip row constructed by the pre-pass */
      } else {
        try { item = await avImportOne(ent.file, ent.index, o, ctx, ent.key); }
        catch (e) { item = null; }      /* one bad file never sinks the batch */
        if (!item || typeof item !== "object") item = avImportFallbackItem(ent.file, ent.index, ent.key);
      }
      receipt.items.push(item);
    }
  } catch (e) {
    try { receipt.errors.push("import run failed: " + avImportErrText(e)); } catch (e2) { /* ignore */ }
  }
  try { avImportSiblings(receipt.items); } catch (e3) { /* sibling chips are best-effort */ }
  if (ctx.writeFails > 0) {
    try { receipt.errors.push("library write failed: " + ctx.writeFails + " item(s)"); } catch (e4) { /* ignore */ }
  }
  if (ctx.notes.length) {
    /* R15c: reader notes (zone cap / flag flattening / ref+note caps) ride the errors channel */
    try {
      for (let i = 0; i < ctx.notes.length && i < 60; i++) receipt.errors.push(avImportCapStr(String(ctx.notes[i]), 160));
    } catch (e5) { /* ignore */ }
  }
  try { avImportCounts(receipt); } catch (e6) { /* the caller computes them once more */ }
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
    else if (it.kind === "kit" && it.result === "imported") counts.kits++;
    else if (it.kind === "refs" && it.result === "imported") counts.refs++;
    else if (it.kind === "bundle" && it.result === "imported") counts.bundles++;   /* R16 */
    if (it.dup) counts.dups += 1;                       /* R18a: keep-both duplicates flagged */
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
