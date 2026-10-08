/* av_pack.js - Anvil R19 USER PACKS: the `.avpack` collect & pack + import route.

   Pins (verify/_r19_wave.md section 3; the section 2 shared spec table is implemented
   VERBATIM here and in verify/avpack_schema.mjs - drift = a rig/CLI failure):

     avPackVersion = "r19.0"           avPackClasses() -> []
     avPackValidateManifest(m) -> {ok, errors:[...], manifest?}     (sync; never throws)
     avPackDetect(bytes) -> Promise<{ok, manifest?, error?}>        (R16 reader; never throws)
     avPackBuild(o) -> Promise<{ok, name, bytes, manifest, counts, refused, error?}>
                        o = {ids:[libId...], name?, author?, license?, tags?}
     avPackImportBytes(bytes, packName, o) -> Promise<receipt>
                        receipt = {ok, pack:{id,name}|null, counts:{items,imported,refused},
                                   items:[{key,name,kind,result,reason}], errors:[...]}
     window.__avPack = {version, validate, detect, build, importBytes}

   Container (section 2): a stored-method ZIP written by src/av_zipc.js avZipBuild (entries
   in order, opts date null = the deterministic 1980 DOS stamp), read by the R16 clean-room
   AVZIP (src/av_zip.js list/extract). Required member `manifest.json` (UTF-8 JSON); every
   item rides `items/<key>.<ext>` verbatim bytes. Relative paths only (no leading "/", no
   ".." segments). sha-256 comes from avImportSha256Hex (src/av_import.js) - guarded PER
   CALL; "" is an honest refusal in BOTH directions (never hash = never land).

   manifest.json v1: {v:1, id (slug /^[a-z0-9][a-z0-9-]{0,63}$/), name (<=80), author (<=80),
   license (<=40, may be ""), tags (array of <=8 strings, each <=24; may be []), at (finite
   epoch ms), app:"anvil-app", items:[...]}.
   item rows: {key (slug, unique), kind, format (<=12), name (leaf <=120), path
   ("items/<key>.<ext>"), sha256 (64-hex lower), size (finite >=0)} + optional meta (object).
   kinds vocabulary = ["sample","kit","refs","pattern","wt","module"]. Rules: every item's
   sha256 is verified against the extracted bytes BEFORE commit; a mismatch or missing member
   = that item REFUSED (named), never landed; duplicate keys = manifest invalid; unknown
   extra keys are tolerated (forward compat) but never required.

   Build kinds (section 3 pin 4): sample | kit | refs | pattern come from the library record
   (av_lib avLibGet - the record meta rides the manifest so kits/refs/patterns round-trip);
   a `wt` record loads from the wt-store (avWtLibraryLoad -> avWtExportJson, the .wt.json
   exchange text) and a `module` record from the code store (avCodeExportText, the .avmod
   exchange text) when their stores hold the id. Import routes (pin 5): sample/kit/refs/
   pattern -> avLibAddItem with source {name: packName, path: item.path, size, at,
   pack: manifest.id}; wt -> avWtImportJson + avWtLibrarySave; module -> avCodeImportText.
   Per-item honest results ("imported" / "refused" + reason); ONE receipt. avPackBuild is
   busy-guarded; library records are never mutated (bytes are read-only).

   Laws: "use strict"; ASCII-only source; DOM-free top level (parse-safe); classic script
   (no modules/imports); ONE avPack* / AVPACK_* family of top-level names; no randomness; no
   network; never throws outward - every public entry resolves an honest value. R19 scope
   note: Song Bundle (kind "song") and backup coverage are R20 - not here. */

"use strict";

/* ---------- pins ---------- */

const avPackVersion = "r19.0";

const AVPACK_APP = "anvil-app";
const AVPACK_MANIFEST = "manifest.json";
const AVPACK_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;        /* pack id + item key slug (cap 64) */
const AVPACK_KINDS = ["sample", "kit", "refs", "pattern", "wt", "module"];
const AVPACK_SHA_RE = /^[0-9a-f]{64}$/;                  /* an accepted content hash */
const AVPACK_PATH_RE = /^items\/([a-z0-9][a-z0-9-]{0,63})\.([a-z0-9]{1,12})$/;
const AVPACK_NAME_MAX = 80;                              /* manifest.name cap */
const AVPACK_AUTHOR_MAX = 80;                            /* manifest.author cap */
const AVPACK_LICENSE_MAX = 40;                           /* manifest.license cap */
const AVPACK_TAGS_MAX = 8;                               /* manifest.tags entries */
const AVPACK_TAG_MAX = 24;                               /* one tag cap */
const AVPACK_FORMAT_MAX = 12;                            /* item format cap */
const AVPACK_LEAF_MAX = 120;                             /* item name leaf cap */
const AVPACK_KEY_MAX = 56;                               /* slug base; its "-N" suffix stays <=64 */
const AVPACK_EXT_MAX = 12;                               /* path extension cap */
const AVPACK_ERR_MAX = 64;                               /* validation stops after this many */
const AVPACK_REASON_MAX = 96;                            /* one refusal reason line cap */
const AVPACK_SRCNAME_MAX = 120;                          /* source.name cap (the pack file leaf) */

const avPackState = { busy: false };                     /* build busy law: one build at a time */

/* ---------- tiny value laws (garbage in, sane value out; never throw) ---------- */

function avPackErrText(e) {
  try { const s = (e && e.message) ? String(e.message) : String(e); return s.slice(0, 120); } catch (e2) { return "error"; }
}

function avPackCap(v, cap) {
  try { return String(v == null ? "" : v).slice(0, cap || 120); } catch (e) { return ""; }
}

function avPackStr(v, dflt, cap) {
  try {
    if (typeof v !== "string") return dflt;
    const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, cap || 80);
    return s || dflt;
  } catch (e) { return dflt; }
}

/* lowercase token: [a-z0-9] only (format ids) */
function avPackToken(v, dflt, cap) {
  try {
    if (typeof v !== "string") return dflt;
    const s = v.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, cap || 12);
    return s || dflt;
  } catch (e) { return dflt; }
}

/* slug: [a-z0-9-], starts alnum (the AVPACK_ID_RE shape), "" when nothing survives */
function avPackSlug(v, cap) {
  try {
    const s = String(v == null ? "" : v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, cap || 64);
    return s || "";
  } catch (e) { return ""; }
}

/* the path extension form: lowercase [a-z0-9], cap 12, "" when nothing survives */
function avPackExtOf(v) {
  try {
    if (typeof v !== "string") return "";
    const s = v.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, AVPACK_EXT_MAX);
    return s || "";
  } catch (e) { return ""; }
}

/* a leaf name (separators folded to "-"; control chars stripped; cap 120) */
function avPackLeaf(v, dflt) {
  try {
    const s = String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\/\\]+/g, "-").trim().slice(0, AVPACK_LEAF_MAX);
    return s || dflt;
  } catch (e) { return dflt; }
}

/* byteLength of anything byte-ish (0 when unknown) */
function avPackSize(b) {
  try { if (b && typeof b.byteLength === "number") return b.byteLength; } catch (e) { /* 0 */ }
  return 0;
}

/* ---------- byte + UTF-8 helpers (TextEncoder/Decoder when present, manual fallbacks) ---------- */

function avPackU8(x) {
  try {
    if (x == null) return null;
    if (typeof ArrayBuffer !== "undefined" && x instanceof ArrayBuffer) return new Uint8Array(x);
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(x)) {
      return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    }
    return null;
  } catch (e) { return null; }
}

function avPackUtf8Encode(s) {
  try {
    const str = String(s == null ? "" : s);
    if (typeof TextEncoder === "function") return new TextEncoder().encode(str);
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let cp = str.charCodeAt(i);
      if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < str.length) {
        const lo = str.charCodeAt(i + 1);
        if (lo >= 0xDC00 && lo <= 0xDFFF) { cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00); i += 1; }
      }
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xC0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return new Uint8Array(out);
  } catch (e) { return null; }
}

function avPackUtf8Decode(u8) {
  try {
    if (!u8 || typeof u8.byteLength !== "number") return null;
    if (typeof TextDecoder === "function") return new TextDecoder("utf-8", { fatal: false }).decode(u8);
  } catch (e) { /* manual below */ }
  try {
    if (!u8 || typeof u8.byteLength !== "number") return null;
    const b = u8;
    let s = "";
    let i = 0;
    while (i < b.length) {
      const c = b[i++];
      if (c < 0x80) { s += String.fromCharCode(c); continue; }
      let cp = -1;
      let need = 0;
      if (c >= 0xC2 && c <= 0xDF) { cp = c & 0x1F; need = 1; }
      else if (c >= 0xE0 && c <= 0xEF) { cp = c & 0x0F; need = 2; }
      else if (c >= 0xF0 && c <= 0xF4) { cp = c & 0x07; need = 3; }
      if (cp < 0 || i + need > b.length) { s += "\uFFFD"; continue; }
      let bad = false;
      for (let k = 0; k < need; k++) {
        const cc = b[i + k];
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
  } catch (e) { return null; }
}

/* ---------- guarded cross-module reaches (typeof PER CALL; absent -> honest refusal) ---------- */

/* the R16 reader (src/av_zip.js): list -> {ok, entries:[{name,dir,...}]} (sync) */
function avPackZipList(bytes) {
  try {
    if (typeof AVZIP !== "object" || !AVZIP || typeof AVZIP.list !== "function") {
      return { ok: false, entries: [], error: "zip reader absent" };
    }
    const r = AVZIP.list(bytes);
    if (!r || r.ok !== true || !Array.isArray(r.entries)) {
      return { ok: false, entries: [], error: (r && r.error) ? avPackCap(String(r.error), 80) : "not a zip" };
    }
    return { ok: true, entries: r.entries };
  } catch (e) { return { ok: false, entries: [], error: "zip reader failed" }; }
}

/* extract one entry by its list() index -> Promise<{ok, name, bytes}|{ok:false, error}> */
function avPackZipExtract(bytes, index) {
  return Promise.resolve().then(function () {
    try {
      if (typeof AVZIP !== "object" || !AVZIP || typeof AVZIP.extract !== "function") {
        return { ok: false, error: "zip reader absent" };
      }
      const p = AVZIP.extract(bytes, index);
      return Promise.resolve(p).then(function (r) {
        if (!r || r.ok !== true || !r.bytes) {
          return { ok: false, error: (r && r.error) ? avPackCap(String(r.error), 80) : "extract failed" };
        }
        return { ok: true, name: (typeof r.name === "string") ? r.name : "", bytes: r.bytes };
      }, function () { return { ok: false, error: "extract failed" }; });
    } catch (e) { return { ok: false, error: "extract failed" }; }
  });
}

/* the first non-dir entry whose name === wanted (central-directory order), else -1 */
function avPackEntryIndex(entries, wanted) {
  try {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e || e.dir === true) continue;
      if (e.name === wanted) return i;
    }
  } catch (e) { /* -1 */ }
  return -1;
}

/* name -> first non-dir list index (null-prototype map; duplicate names: first wins) */
function avPackNameIndex(entries) {
  const idx = Object.create(null);
  try {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e || e.dir === true || typeof e.name !== "string" || !e.name) continue;
      if (idx[e.name] == null) idx[e.name] = i;
    }
  } catch (e) { /* the empty map stands */ }
  return idx;
}

/* sha-256 hex of byte-ish input via avImportSha256Hex (guarded; "" = honest refusal) */
async function avPackShaHex(bytes) {
  try {
    if (typeof avImportSha256Hex !== "function") return "";
    const s = await avImportSha256Hex(bytes);
    return (typeof s === "string" && AVPACK_SHA_RE.test(s)) ? s : "";
  } catch (e) { return ""; }
}

/* ---------- avPackValidateManifest: the section 2 table (sync, never throws) ---------- */

/* Options taken where the table is silent (mirrored in verify/avpack_schema.mjs; drift =
   parent reconciliation): every listed manifest field is REQUIRED (license may be "", tags
   may be []); item name must be a leaf (no "/" or "\"); path must be exactly
   "items/<its key>.<ext>" with ext in [a-z0-9]{1,12}; meta must be an object when present
   (null tolerated as absent); unknown extra keys never checked. Validation stops after
   AVPACK_ERR_MAX errors (bounded work on hostile manifests). The returned manifest copy is
   fresh (rows shallow; meta by reference - never mutated here). */
function avPackValidateManifest(m) {
  const errors = [];
  let over = false;
  const add = function (line) {
    if (over) return;
    if (errors.length >= AVPACK_ERR_MAX) { over = true; return; }
    errors.push(line);
  };
  try {
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      return { ok: false, errors: ["manifest must be an object"] };
    }
    if (m.v !== 1) add("v: must be 1");
    if (typeof m.id !== "string" || !AVPACK_ID_RE.test(m.id)) add("id: must be a slug matching /^[a-z0-9][a-z0-9-]{0,63}$/");
    if (typeof m.name !== "string" || m.name.length < 1 || m.name.length > AVPACK_NAME_MAX) {
      add("name: must be a string of 1.." + AVPACK_NAME_MAX + " chars");
    }
    if (typeof m.author !== "string" || m.author.length > AVPACK_AUTHOR_MAX) {
      add("author: must be a string of <= " + AVPACK_AUTHOR_MAX + " chars");
    }
    if (typeof m.license !== "string" || m.license.length > AVPACK_LICENSE_MAX) {
      add("license: must be a string of <= " + AVPACK_LICENSE_MAX + " chars (may be \"\")");
    }
    if (!Array.isArray(m.tags)) {
      add("tags: must be an array (may be [])");
    } else {
      if (m.tags.length > AVPACK_TAGS_MAX) add("tags: must hold <= " + AVPACK_TAGS_MAX + " entries");
      for (let i = 0; i < m.tags.length && i <= AVPACK_TAGS_MAX; i++) {
        const t = m.tags[i];
        if (typeof t !== "string" || t.length > AVPACK_TAG_MAX) {
          add("tags[" + i + "]: must be a string of <= " + AVPACK_TAG_MAX + " chars");
          break;
        }
      }
    }
    if (typeof m.at !== "number" || !isFinite(m.at) || m.at < 0) add("at: must be a finite epoch ms (>= 0)");
    if (m.app !== AVPACK_APP) add("app: must be \"" + AVPACK_APP + "\"");
    if (!Array.isArray(m.items)) {
      add("items: must be an array");
    } else {
      const seen = Object.create(null);
      for (let i = 0; i < m.items.length; i++) {
        if (over) break;
        const r = m.items[i];
        const at = "items[" + i + "]";
        if (!r || typeof r !== "object" || Array.isArray(r)) { add(at + ": must be an object"); continue; }
        if (typeof r.key !== "string" || !AVPACK_ID_RE.test(r.key)) {
          add(at + ".key: must be a slug matching /^[a-z0-9][a-z0-9-]{0,63}$/");
        } else if (seen[r.key]) {
          add(at + ".key: duplicate \"" + r.key + "\"");
        } else {
          seen[r.key] = 1;
        }
        if (typeof r.kind !== "string" || AVPACK_KINDS.indexOf(r.kind) < 0) {
          add(at + ".kind: must be one of " + AVPACK_KINDS.join("|"));
        }
        if (typeof r.format !== "string" || r.format.length > AVPACK_FORMAT_MAX) {
          add(at + ".format: must be a string of <= " + AVPACK_FORMAT_MAX + " chars");
        }
        if (typeof r.name !== "string" || r.name.length < 1 || r.name.length > AVPACK_LEAF_MAX
            || r.name.indexOf("/") >= 0 || r.name.indexOf("\\") >= 0) {
          add(at + ".name: must be a leaf string of 1.." + AVPACK_LEAF_MAX + " chars");
        }
        let pathOk = false;
        if (typeof r.path === "string") {
          const pm = AVPACK_PATH_RE.exec(r.path);
          if (pm && typeof r.key === "string" && pm[1] === r.key) pathOk = true;
        }
        if (!pathOk) add(at + ".path: must be \"items/<key>.<ext>\" for its key");
        if (typeof r.sha256 !== "string" || !AVPACK_SHA_RE.test(r.sha256)) add(at + ".sha256: must be 64 lowercase hex");
        if (typeof r.size !== "number" || !isFinite(r.size) || r.size < 0) add(at + ".size: must be a finite number >= 0");
        if (r.meta !== undefined && r.meta !== null && (typeof r.meta !== "object" || Array.isArray(r.meta))) {
          add(at + ".meta: must be an object");
        }
      }
    }
    if (over) {
      errors.push("errors truncated at " + AVPACK_ERR_MAX + " (further checks stopped)");
      return { ok: false, errors: errors };
    }
    if (errors.length) return { ok: false, errors: errors };
    const rows = [];
    for (let i = 0; i < m.items.length; i++) {
      const r = m.items[i];
      const row = {
        key: r.key, kind: r.kind, format: r.format, name: r.name,
        path: r.path, sha256: r.sha256, size: r.size,
      };
      if (r.meta && typeof r.meta === "object" && !Array.isArray(r.meta)) row.meta = r.meta;
      rows.push(row);
    }
    return {
      ok: true,
      errors: [],
      manifest: {
        v: 1, id: m.id, name: m.name, author: m.author, license: m.license,
        tags: m.tags.slice(), at: m.at, app: AVPACK_APP, items: rows,
      },
    };
  } catch (e) {
    return { ok: false, errors: ["manifest validation failed"] };
  }
}

/* ---------- avPackDetect: zip sniff + manifest present + app/v match (async, never throws) ---------- */

function avPackDetect(bytes) {
  try {
    return Promise.resolve(avPackDetectRun(bytes)).then(null, function (e) {
      return { ok: false, error: avPackCap(avPackErrText(e), 80) };
    });
  } catch (e) {
    return Promise.resolve({ ok: false, error: avPackCap(avPackErrText(e), 80) });
  }
}

async function avPackDetectRun(bytes) {
  const head = avPackU8(bytes);
  if (!head || head.length < 22) return { ok: false, error: "not a zip" };
  /* the R16 sniff: a local-file-header signature ("PK" 0x03 0x04) */
  if (!(head[0] === 0x50 && head[1] === 0x4B && head[2] === 0x03 && head[3] === 0x04)) {
    return { ok: false, error: "not a zip" };
  }
  const zr = avPackZipList(bytes);
  if (!zr || zr.ok !== true) return { ok: false, error: (zr && zr.error) ? zr.error : "not a zip" };
  const idx = avPackEntryIndex(zr.entries, AVPACK_MANIFEST);
  if (idx < 0) return { ok: false, error: "no manifest.json" };
  const ex = await avPackZipExtract(bytes, idx);
  if (!ex || ex.ok !== true) return { ok: false, error: (ex && ex.error) ? ex.error : "manifest unreadable" };
  const text = avPackUtf8Decode(ex.bytes);
  if (text == null) return { ok: false, error: "manifest not decodable" };
  let m = null;
  try { m = JSON.parse(text); } catch (e) { return { ok: false, error: "manifest not JSON" }; }
  const v = avPackValidateManifest(m);
  if (!v || v.ok !== true) return { ok: false, error: "manifest invalid" };
  return { ok: true, manifest: v.manifest };
}

/* ---------- avPackBuild: selected library records -> ONE .avpack ---------- */

/* the build options (defaults: name "pack", author "", license "", tags []; ids deduped by
   the caller loop) */
function avPackOpts(o) {
  const r = { ids: [], name: "pack", author: "", license: "", tags: [] };
  try {
    const src = (o && typeof o === "object" && !Array.isArray(o)) ? o : null;
    if (!src) return r;
    if (Array.isArray(src.ids)) r.ids = src.ids;
    const nm = avPackStr(src.name, "", AVPACK_NAME_MAX);
    if (nm) r.name = nm;
    r.author = avPackStr(src.author, "", AVPACK_AUTHOR_MAX);
    r.license = avPackStr(src.license, "", AVPACK_LICENSE_MAX);
    r.tags = avPackTagsNorm(src.tags);
  } catch (e) { /* the defaults stand */ }
  return r;
}

function avPackTagsNorm(v) {
  const out = [];
  try {
    if (!Array.isArray(v)) return out;
    for (let i = 0; i < v.length && out.length < AVPACK_TAGS_MAX; i++) {
      const t = avPackStr(v[i], "", AVPACK_TAG_MAX);
      if (t) out.push(t);
    }
  } catch (e) { /* [] */ }
  return out;
}

/* a unique item key for a name within this pack (slug base <= 56; "-N" on collision) */
function avPackKeyFor(name, taken) {
  const base = avPackSlug(name, AVPACK_KEY_MAX) || "item";
  try {
    if (!taken[base]) { taken[base] = 1; return base; }
    let n = 2;
    let cand = base + "-" + n;
    while (taken[cand]) { n += 1; cand = base + "-" + n; }
    taken[cand] = 1;
    return cand;
  } catch (e) { return base; }
}

/* one id -> {ok, kind, name, format, ext, meta, bytes} | {ok:false, error}.
   Ladder: the library (av_lib) -> the wt-store (av_wt) -> the code store (av_code). */
async function avPackLoadOne(id) {
  /* 1) the library: the record + its verbatim bytes (meta rides for kit/refs/pattern) */
  if (typeof avLibGet === "function") {
    let g = null;
    try { g = await avLibGet(id); } catch (e) { g = null; }
    if (g && g.ok === true && g.item && typeof g.item === "object") {
      const it = g.item;
      const kind = (typeof it.kind === "string" && (it.kind === "sample" || it.kind === "kit"
        || it.kind === "refs" || it.kind === "pattern")) ? it.kind : "";
      if (!kind) return { ok: false, error: "unsupported kind" };
      const kb = avPackU8(it.bytes);
      if (!kb || kb.byteLength < 1) return { ok: false, error: "no bytes" };
      return {
        ok: true, kind: kind,
        name: avPackStr(it.name, id, AVPACK_LEAF_MAX),
        format: avPackToken(it.format, "", AVPACK_FORMAT_MAX),
        ext: avPackExtOf(it.ext),
        meta: (it.meta && typeof it.meta === "object" && !Array.isArray(it.meta)) ? it.meta : null,
        bytes: it.bytes,
      };
    }
  }
  /* 2) the wt-store: the table id -> its .wt.json exchange text (avWtExportJson) */
  if (typeof avWtLibraryLoad === "function") {
    let t = null;
    try { t = await avWtLibraryLoad(id); } catch (e2) { t = null; }
    if (t && typeof t === "object") {
      let json = null;
      try { if (typeof avWtExportJson === "function") json = avWtExportJson(t); } catch (e3) { json = null; }
      const u8 = (typeof json === "string" && json) ? avPackUtf8Encode(json) : null;
      if (!u8 || u8.byteLength < 1) return { ok: false, error: "wt export refused" };
      return {
        ok: true, kind: "wt",
        name: avPackStr(t.name, id, AVPACK_LEAF_MAX),
        format: "wt", ext: "json", meta: null, bytes: u8,
      };
    }
  }
  /* 3) the code store: the module id -> its .avmod exchange text (avCodeExportText).
     avCodeStoreLoad is awaited best-effort first (same bundle scope; guarded). */
  try {
    if (typeof avCodeStoreLoad === "function") {
      const p = avCodeStoreLoad();
      if (p && typeof p.then === "function") await p;
    }
  } catch (e4) { /* the loaded view is read below */ }
  if (typeof avCodeExportText === "function") {
    let text = null;
    try { text = avCodeExportText(id); } catch (e5) { text = null; }
    if (typeof text === "string" && text) {
      const u8 = avPackUtf8Encode(text);
      if (!u8 || u8.byteLength < 1) return { ok: false, error: "module export refused" };
      let nm = id;
      try {
        const o2 = JSON.parse(text);
        if (o2 && typeof o2.name === "string" && o2.name) nm = o2.name;
      } catch (e6) { /* the id stands */ }
      return {
        ok: true, kind: "module",
        name: avPackStr(nm, id, AVPACK_LEAF_MAX),
        format: "avmod", ext: "avmod", meta: null, bytes: u8,
      };
    }
  }
  return { ok: false, error: "no record" };
}

/* busy-guarded public build (one build at a time; never throws) */
function avPackBuild(o) {
  const st = avPackState;
  let busy = false;
  try { busy = st.busy === true; } catch (e) { busy = false; }
  if (busy) {
    return Promise.resolve({
      ok: false, name: "", bytes: null, manifest: null,
      counts: { items: 0, refused: 0, bytes: 0 }, refused: [], error: "busy",
    });
  }
  try { st.busy = true; } catch (e) { /* the guard is best-effort */ }
  return (async function () {
    try { return await avPackBuildRun(o); }
    catch (e) {
      return {
        ok: false, name: "", bytes: null, manifest: null,
        counts: { items: 0, refused: 0, bytes: 0 }, refused: [],
        error: avPackCap(avPackErrText(e), AVPACK_REASON_MAX),
      };
    } finally { try { st.busy = false; } catch (e2) { /* clears on the next call */ } }
  })();
}

async function avPackBuildRun(o) {
  const src = avPackOpts(o);
  const refused = [];
  const taken = Object.create(null);
  const seen = Object.create(null);
  const picked = [];
  for (let i = 0; i < src.ids.length; i++) {
    const id = src.ids[i];
    if (typeof id !== "string" || !id) {
      refused.push({ id: avPackCap(id == null ? "" : id, 64), reason: "bad id" });
      continue;
    }
    if (seen[id]) continue;
    seen[id] = 1;
    let one = null;
    try { one = await avPackLoadOne(id); } catch (e) { one = null; }
    if (!one || one.ok !== true) {
      refused.push({
        id: avPackCap(id, 64),
        reason: avPackCap((one && one.error) ? String(one.error) : "no record", AVPACK_REASON_MAX),
      });
      continue;
    }
    const sha = await avPackShaHex(one.bytes);
    if (!sha) { refused.push({ id: avPackCap(id, 64), reason: "no sha256 (crypto unavailable)" }); continue; }
    const key = avPackKeyFor(one.name || id, taken);
    const ext = avPackExtOf(one.ext) || avPackExtOf(one.format) || "bin";
    const row = {
      key: key, kind: one.kind, format: one.format,
      name: avPackLeaf(one.name, id),
      path: "items/" + key + "." + ext,
      sha256: sha,
      size: avPackSize(one.bytes),
    };
    if (one.meta && typeof one.meta === "object" && !Array.isArray(one.meta)) {
      let empty = true;
      try {
        for (const k in one.meta) {
          if (Object.prototype.hasOwnProperty.call(one.meta, k)) { empty = false; break; }
        }
      } catch (e2) { empty = true; }
      if (!empty) row.meta = one.meta;      /* the meta rides by reference; never mutated */
    }
    picked.push({ row: row, bytes: one.bytes });
  }
  const counts = { items: picked.length, refused: refused.length, bytes: 0 };
  const name = src.name;
  if (!picked.length) {
    return {
      ok: false, name: name, bytes: null, manifest: null, counts: counts, refused: refused,
      error: (refused.length ? "no importable items" : "no items"),
    };
  }
  const rows = [];
  for (let i = 0; i < picked.length; i++) rows.push(picked[i].row);
  const manifest = {
    v: 1,
    id: avPackSlug(name, 64) || "pack",
    name: name,
    author: src.author,
    license: src.license,
    tags: src.tags,
    at: Date.now(),
    app: AVPACK_APP,
    items: rows,
  };
  /* the builder self-check against the ONE shared table (same function import validates with) */
  const chk = avPackValidateManifest(manifest);
  if (!chk || chk.ok !== true) {
    return {
      ok: false, name: name, bytes: null, manifest: null, counts: counts, refused: refused,
      error: "manifest invalid: " + avPackCap((chk && chk.errors && chk.errors[0]) ? chk.errors[0] : "", 60),
    };
  }
  let buf = null;
  try {
    if (typeof avZipBuild === "function") {
      const entries = [{ name: AVPACK_MANIFEST, data: JSON.stringify(manifest) }];
      for (let i = 0; i < picked.length; i++) entries.push({ name: picked[i].row.path, data: picked[i].bytes });
      buf = avZipBuild(entries, { date: null });      /* date null = deterministic DOS stamp */
    }
  } catch (e3) { buf = null; }
  if (!buf || typeof buf.byteLength !== "number" || buf.byteLength < 1) {
    return {
      ok: false, name: name, bytes: null, manifest: manifest, counts: counts, refused: refused,
      error: (typeof avZipBuild === "function") ? "zip writer refused" : "zip writer absent",
    };
  }
  counts.bytes = buf.byteLength;
  return { ok: true, name: name, bytes: buf, manifest: manifest, counts: counts, refused: refused };
}

/* ---------- avPackImportBytes: one receipt; sha verified BEFORE commit ---------- */

/* the per-item route: sample/kit/refs/pattern -> avLibAddItem (source carries pack),
   wt -> avWtImportJson + avWtLibrarySave, module -> avCodeImportText */
async function avPackRouteItem(row, itemBytes, srcName, manifest, at) {
  const kind = row.kind;
  if (kind === "sample" || kind === "kit" || kind === "refs" || kind === "pattern") {
    if (typeof avLibAddItem !== "function") return { ok: false, reason: "library absent" };
    const dot = row.path.lastIndexOf(".");
    const ext = (dot >= 0) ? avPackExtOf(row.path.slice(dot + 1)) : "";
    const rec = {
      name: row.name, kind: kind, format: row.format, ext: ext, meta: row.meta,
      result: "imported",           /* avLibItemNorm persists only imported items */
      sha256: row.sha256,
      bytes: itemBytes,
      source: {
        name: srcName, path: row.path, size: avPackSize(itemBytes), at: at,
        pack: manifest.id,          /* the R19 provenance slug (av_lib avLibSourceNorm keeps it) */
      },
    };
    let r = null;
    try { r = await avLibAddItem(rec); } catch (e) { r = null; }
    if (r && r.ok === true) return { ok: true, id: (typeof r.id === "string") ? r.id : "" };
    return { ok: false, reason: (r && r.error) ? avPackCap(String(r.error), 80) : "library refused" };
  }
  if (kind === "wt") {
    const text = avPackUtf8Decode(avPackU8(itemBytes));
    if (text == null) return { ok: false, reason: "bytes not text" };
    if (typeof avWtImportJson !== "function" || typeof avWtLibrarySave !== "function") {
      return { ok: false, reason: "wt core absent" };
    }
    let t = null;
    try { t = avWtImportJson(text); } catch (e2) { t = null; }
    if (!t || t.error) return { ok: false, reason: "wt: " + avPackCap((t && t.error) ? String(t.error) : "bad table", 60) };
    try { if (row.name) t.name = row.name; } catch (e3) { /* the parsed name stands */ }
    let s = null;
    try { s = await avWtLibrarySave(t); } catch (e4) { s = null; }
    if (s && s.ok === true) return { ok: true, id: (typeof s.id === "string") ? s.id : "" };
    return { ok: false, reason: (s && s.error) ? ("wt save: " + avPackCap(String(s.error), 60)) : "wt save refused" };
  }
  if (kind === "module") {
    const text = avPackUtf8Decode(avPackU8(itemBytes));
    if (text == null) return { ok: false, reason: "bytes not text" };
    if (typeof avCodeImportText !== "function") return { ok: false, reason: "code core absent" };
    let s = null;
    try { s = await avCodeImportText(text); } catch (e5) { s = null; }
    if (s && s.ok === true) return { ok: true, id: (typeof s.id === "string") ? s.id : "" };
    return { ok: false, reason: (s && s.error) ? avPackCap(String(s.error), 80) : "module refused" };
  }
  return { ok: false, reason: "unknown kind" };
}

/* public import: never throws; o is accepted for forward-compat (unused in r19.0) */
function avPackImportBytes(bytes, packName, o) {
  try {
    return Promise.resolve(avPackImportBytesRun(bytes, packName, o)).then(null, function (e) {
      return {
        ok: false, pack: null, counts: { items: 0, imported: 0, refused: 0 }, items: [],
        errors: [avPackCap(avPackErrText(e), AVPACK_REASON_MAX)],
      };
    });
  } catch (e) {
    return Promise.resolve({
      ok: false, pack: null, counts: { items: 0, imported: 0, refused: 0 }, items: [],
      errors: [avPackCap(avPackErrText(e), AVPACK_REASON_MAX)],
    });
  }
}

async function avPackImportBytesRun(bytes, packName, o) {
  const out = {
    ok: false, pack: null,
    counts: { items: 0, imported: 0, refused: 0 },
    items: [], errors: [],
  };
  try {
    const zr = avPackZipList(bytes);
    if (!zr || zr.ok !== true) { out.errors.push((zr && zr.error) ? zr.error : "not a zip"); return out; }
    const entries = zr.entries;
    const manIdx = avPackEntryIndex(entries, AVPACK_MANIFEST);
    if (manIdx < 0) { out.errors.push("no manifest.json"); return out; }
    const ex = await avPackZipExtract(bytes, manIdx);
    if (!ex || ex.ok !== true) { out.errors.push("manifest: " + ((ex && ex.error) ? ex.error : "unreadable")); return out; }
    const text = avPackUtf8Decode(avPackU8(ex.bytes));
    let m = null;
    try { m = (text == null) ? null : JSON.parse(text); } catch (e) { m = null; }
    if (!m || typeof m !== "object") { out.errors.push("manifest: not JSON"); return out; }
    const v = avPackValidateManifest(m);
    if (!v || v.ok !== true) {
      const list = (v && Array.isArray(v.errors)) ? v.errors : ["manifest invalid"];
      for (let i = 0; i < list.length && i < 8; i++) out.errors.push("manifest invalid: " + avPackCap(String(list[i]), AVPACK_REASON_MAX));
      if (list.length > 8) out.errors.push("manifest invalid: +" + (list.length - 8) + " more");
      return out;
    }
    const manifest = v.manifest;
    out.pack = { id: manifest.id, name: manifest.name };
    const rows = manifest.items;
    out.counts.items = rows.length;
    if (!rows.length) { out.errors.push("manifest has no items"); return out; }
    const at = Date.now();
    const srcName = avPackStr(packName, "", AVPACK_SRCNAME_MAX) || avPackStr(manifest.name, "", AVPACK_SRCNAME_MAX);
    const idxByName = avPackNameIndex(entries);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let result = "refused";
      let reason = "";
      const idx = (row.path && idxByName[row.path] != null) ? idxByName[row.path] : -1;
      if (idx < 0) {
        reason = "member missing";
      } else {
        const x = await avPackZipExtract(bytes, idx);
        if (!x || x.ok !== true) {
          reason = "extract: " + ((x && x.error) ? x.error : "failed");
        } else {
          const got = await avPackShaHex(x.bytes);       /* verify BEFORE commit */
          if (!got) {
            reason = "sha unavailable";
          } else if (got !== row.sha256) {
            reason = "sha256 mismatch";
          } else {
            const routed = await avPackRouteItem(row, x.bytes, srcName, manifest, at);
            if (routed && routed.ok === true) result = "imported";
            else reason = (routed && routed.reason) ? avPackCap(String(routed.reason), AVPACK_REASON_MAX) : "refused";
          }
        }
      }
      if (result === "imported") out.counts.imported += 1; else out.counts.refused += 1;
      out.items.push({ key: row.key, name: row.name, kind: row.kind, result: result, reason: reason });
    }
    out.ok = out.counts.imported > 0;
    return out;
  } catch (e2) {
    if (!out.errors.length) out.errors.push(avPackCap(avPackErrText(e2), AVPACK_REASON_MAX));
    return out;
  }
}

/* ---------- classes + facade ---------- */

/* r19.0 introduces no new UI classes (the hub chip reuses existing ones) */
function avPackClasses() { return []; }

/* the suite/console facade (the R19 hub leg + the SAMPLE PACKS card drive this) */
if (typeof window !== "undefined") {
  window.__avPack = {
    version: avPackVersion,
    validate: avPackValidateManifest,
    detect: avPackDetect,
    build: avPackBuild,
    importBytes: avPackImportBytes,
  };
}
