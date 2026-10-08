#!/usr/bin/env node
/* verify/avpack_schema.mjs - canonical `.avpack` manifest module (Anvil R19 wave, child D).
   Lineage: av_bank_schema.mjs + the PF `synth_pack_schema.mjs` port note ("one shared module
   imported by both the author gate and the shipping verifier so the two can never drift");
   verify/_r19_wave.md section 2 (THE table - this file implements exactly it) + section 6
   (child D pins) + docs/12-import-and-persistence.md section 3.6 (shape, rules).

   What it is:
     - The section-2 rules table as code: manifest.json v1 shape, every cap, the slug regex,
       the kinds vocabulary, the sha256 form, and the container path laws (relative paths only:
       no leading "/", no ".." segments; items live at items/<key>.<ext>).
     - validateManifest(m) -> { ok, errors, manifest? } - never throws; every error is a
       path-bearing string. parseManifestText(text) covers the byte boundary (BOM strip +
       JSON.parse + the same validation).
     - Pure helpers the strict CLI reuses: isSafeRelPath, itemPathFor, checkItemPath.
     - A SELF-CHECK (CLI) that runs a crafted fixture corpus (positive shapes, literal
       negatives, documented derived edges, never-throw guards, helper truth tables) through
       the validator. When src/av_pack.js exists, the same corpus is cross-checked against the
       page-side avPackValidateManifest (drift probe): fixtures whose expectation is stated
       VERBATIM by the table ("literal") turn drift into errors; fixtures whose expectation is
       this module's documented reading of an under-specified edge ("derived") turn drift into
       warnings only. Absent / not node-loadable av_pack.js = probe skipped (never a failure -
       the page side may not have landed yet).

   AGREED readings of the table (it is quiet on these; src/av_pack.js documents the same option
   list - "mirrored in verify/avpack_schema.mjs; drift = parent reconciliation" - and the drift
   probe below enforces parity on every fixture):
     - "slug" for item rows reuses the id slug regex (the table's only slug definition).
     - Every listed field is REQUIRED (license may be "", tags may be []); name is 1..80 and
       the item name a leaf of 1..120; author may be "" (the builder defaults it to "").
     - at: finite epoch ms >= 0. size: finite number >= 0 (not required to be an integer).
     - path must be exactly items/<key>.<ext> for the row's own key, a single file under
       items/, ext in [a-z0-9]{1,12} (the format-token shape); backslashes are refused on top
       of the table's leading-"/" + ".." laws.
     - meta: an object when present; null is tolerated as absent (dropped, never routed).
     - Unknown extra keys are tolerated everywhere (table: forward-compat, never required).

   Laws preserved: never throws; errors are specific, path-bearing strings; ASCII source;
   JSON-only values on the read path; repo READ-ONLY (the self-check reads src/av_pack.js only).
   Run: node verify/avpack_schema.mjs   (self-check; exit 0 = clean)                        */
"use strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ============================== the section-2 table ============================== */

const AVPACK_VERSION = 1;                              /* manifest.json v */
const AVPACK_APP = "anvil-app";                        /* app: exact string */
const AVPACK_MANIFEST_NAME = "manifest.json";          /* required member (UTF-8 JSON) */
const AVPACK_ITEMS_DIR = "items/";                     /* items live at items/<key>.<ext> */
const AVPACK_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;       /* id (and item key) slug: 1..64 chars */
const AVPACK_SHA256_HEX = /^[0-9a-f]{64}$/;            /* sha256 fields: 64-hex lower */
const AVPACK_PATH_RE = /^items\/([a-z0-9][a-z0-9-]{0,63})\.([a-z0-9]{1,12})$/;  /* item path shape - the ext is the [a-z0-9] format-token shape (mirrors src/av_pack.js) */

/* kinds vocabulary - the table's exact list; a closed set (unknown kinds are invalid). */
const AVPACK_KINDS = Object.freeze(["sample", "kit", "refs", "pattern", "wt", "module"]);

/* Every cap / bound the table states, in one frozen place. */
const AVPACK_CAPS = Object.freeze({
  nameMax: 80,        /* manifest name        <= 80               */
  authorMax: 80,      /* manifest author      <= 80               */
  licenseMax: 40,     /* manifest license     <= 40 ("" allowed)  */
  tagsMax: 8,         /* tags: <= 8 entries (may be [])           */
  tagMax: 24,         /* each tag             <= 24               */
  formatMax: 12,      /* item format          <= 12               */
  itemNameMax: 120,   /* item name (leaf)     <= 120              */
});

/* ZIP methods the container law allows: stored (0) + deflate-raw (8). */
const AVPACK_ZIP_METHODS = Object.freeze([0, 8]);

/* ============================== small helpers ============================== */

function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function jtype(v) { return v === null ? "null" : Array.isArray(v) ? "array" : typeof v; }
function msgOf(e) { return String(e && e.message || e); }
function val(v) {
  try { return typeof v === "number" ? String(v) : JSON.stringify(v); }
  catch (e) { return "(unprintable)"; }
}

/* ---- container path laws (section 2, first bullet) ---- */

/* Relative only: non-empty, no leading "/", no ".." segments. Backslashes refused on top
   (a Windows separator is a traversal vector the ".."-segment check alone would miss). */
function isSafeRelPath(p) {
  try {
    if (typeof p !== "string" || p === "") return false;
    if (p.charAt(0) === "/") return false;
    if (p.indexOf("\\") >= 0) return false;
    if (p.split("/").indexOf("..") >= 0) return false;
    return true;
  } catch (e) { return false; }
}

/* Writer-side helper: the member name for an item row. */
function itemPathFor(key, ext) { return AVPACK_ITEMS_DIR + String(key) + "." + String(ext); }

/* An item row's path must be exactly items/<key>.<ext> for THIS row's key: a single file
   under items/, ext in [a-z0-9]{1,12} (the format-token shape; mirrors src/av_pack.js). The
   gate is one regex match + key equality; the specific diagnostics never fire on a
   gate-passing path (their charsets exclude "/", "\" and ".."), so the acceptance set is
   the gate exactly. Returns reason strings (no label prefix; the caller labels them). */
function checkItemPath(p, key) {
  const out = [];
  try {
    if (typeof p !== "string") { out.push("path: must be a string (got " + jtype(p) + ")"); return out; }
    if (p === "") { out.push("path: must not be empty"); return out; }
    if (p.charAt(0) === "/") out.push('path: must be relative - no leading "/" (got ' + val(p) + ")");
    if (p.indexOf("\\") >= 0) out.push("path: must not contain backslashes (got " + val(p) + ")");
    if (p.split("/").indexOf("..") >= 0) out.push('path: must not contain ".." segments (got ' + val(p) + ")");
    const pm = AVPACK_PATH_RE.exec(p);
    if (!(pm && typeof key === "string" && pm[1] === key)) {
      out.push('path: must be "items/<key>.<ext>" for its key - ext [a-z0-9]{1,12} (got ' + val(p) + ")");
    }
    return out;
  } catch (e) {
    return ["path: check exception (never-throw guard): " + msgOf(e)];
  }
}

/* ============================== validateManifest ============================== */

/* The section-2 manifest.json v1 table. Returns { ok, errors, manifest? } - manifest is
   present only when ok. Unknown extra keys are ignored (forward-compat). Never throws. */
function validateManifest(m) {
  const errors = [];
  try {
    if (!isObj(m)) { errors.push("manifest: not a JSON object (got " + jtype(m) + ")"); return { ok: false, errors }; }

    if (m.v !== AVPACK_VERSION) errors.push("v: must be " + AVPACK_VERSION + " (got " + val(m.v) + ")");
    if (typeof m.id !== "string" || !AVPACK_SLUG.test(m.id)) {
      errors.push("id: must be a slug matching " + String(AVPACK_SLUG) + " (got " + val(m.id) + ")");
    }

    if (typeof m.name !== "string") errors.push("name: must be a string (got " + jtype(m.name) + ")");
    else if (m.name.length < 1 || m.name.length > AVPACK_CAPS.nameMax) errors.push("name: must be 1.." + AVPACK_CAPS.nameMax + " chars (got " + m.name.length + ")");

    if (typeof m.author !== "string") errors.push("author: must be a string (got " + jtype(m.author) + ")");
    else if (m.author.length > AVPACK_CAPS.authorMax) errors.push("author: " + m.author.length + " chars > cap " + AVPACK_CAPS.authorMax);

    if (typeof m.license !== "string") errors.push('license: must be a string - "" allowed (got ' + jtype(m.license) + ")");
    else if (m.license.length > AVPACK_CAPS.licenseMax) errors.push("license: " + m.license.length + " chars > cap " + AVPACK_CAPS.licenseMax);

    if (!Array.isArray(m.tags)) errors.push("tags: must be an array (got " + jtype(m.tags) + ")");
    else {
      if (m.tags.length > AVPACK_CAPS.tagsMax) errors.push("tags: " + m.tags.length + " entries > cap " + AVPACK_CAPS.tagsMax);
      for (let i = 0; i < m.tags.length; i++) {
        const t = m.tags[i];
        if (typeof t !== "string") errors.push("tags[" + i + "]: must be a string (got " + jtype(t) + ")");
        else if (t.length > AVPACK_CAPS.tagMax) errors.push("tags[" + i + "]: " + t.length + " chars > cap " + AVPACK_CAPS.tagMax);
      }
    }

    if (typeof m.at !== "number" || !isFinite(m.at) || m.at < 0) errors.push("at: must be a finite epoch-ms number >= 0 (got " + val(m.at) + ")");

    if (m.app !== AVPACK_APP) errors.push('app: must be "' + AVPACK_APP + '" (got ' + val(m.app) + ")");

    if (!Array.isArray(m.items)) {
      errors.push("items: must be an array (got " + jtype(m.items) + ")");
      return { ok: false, errors };
    }

    const seen = Object.create(null);
    for (let i = 0; i < m.items.length; i++) {
      const row = m.items[i];
      const at = "items[" + i + "]";
      if (!isObj(row)) { errors.push(at + ": not an object (got " + jtype(row) + ")"); continue; }
      const label = at + (typeof row.key === "string" && row.key !== "" ? ' (key "' + row.key + '")' : "");

      /* key: slug, unique. Duplicate keys are manifest-invalid (named at both sites). */
      if (typeof row.key !== "string" || !AVPACK_SLUG.test(row.key)) {
        errors.push(label + " key: must be a slug matching " + String(AVPACK_SLUG) + " (got " + val(row.key) + ")");
      } else if (seen[row.key] !== undefined) {
        errors.push(label + ' key: duplicate of items[' + seen[row.key] + '] ("' + row.key + '") - duplicate keys are manifest-invalid');
      } else {
        seen[row.key] = i;
      }

      /* kind: the closed vocabulary. */
      if (typeof row.kind !== "string" || AVPACK_KINDS.indexOf(row.kind) < 0) {
        errors.push(label + " kind: must be one of [" + AVPACK_KINDS.join(", ") + "] (got " + val(row.kind) + ")");
      }

      /* format: string, cap 12. */
      if (typeof row.format !== "string") errors.push(label + " format: must be a string (got " + jtype(row.format) + ")");
      else if (row.format.length > AVPACK_CAPS.formatMax) errors.push(label + " format: " + row.format.length + " chars > cap " + AVPACK_CAPS.formatMax);

      /* name: string, leaf (no separators), cap 120. */
      if (typeof row.name !== "string") errors.push(label + " name: must be a string (got " + jtype(row.name) + ")");
      else {
        if (row.name.length < 1 || row.name.length > AVPACK_CAPS.itemNameMax) errors.push(label + " name: must be 1.." + AVPACK_CAPS.itemNameMax + " chars (got " + row.name.length + ")");
        if (row.name.indexOf("/") >= 0 || row.name.indexOf("\\") >= 0) errors.push(label + " name: must be a leaf name (no path separators) - got " + val(row.name));
      }

      /* path: items/<key>.<ext>, relative only. */
      for (const reason of checkItemPath(row.path, row.key)) errors.push(label + " " + reason);

      /* sha256: 64-hex lower. */
      if (typeof row.sha256 !== "string") errors.push(label + " sha256: must be a 64-char lowercase hex string (got " + jtype(row.sha256) + ")");
      else if (!AVPACK_SHA256_HEX.test(row.sha256)) {
        if (/^[0-9a-fA-F]{64}$/.test(row.sha256)) errors.push(label + " sha256: must be lowercase hex (got " + val(row.sha256) + ")");
        else if (row.sha256.length !== 64) errors.push(label + " sha256: must be exactly 64 hex chars (got " + row.sha256.length + ") - " + val(row.sha256.length > 80 ? row.sha256.slice(0, 80) + "..." : row.sha256));
        else errors.push(label + " sha256: must be hex chars only (got " + val(row.sha256) + ")");
      }

      /* size: finite >= 0. */
      if (typeof row.size !== "number" || !isFinite(row.size) || row.size < 0) errors.push(label + " size: must be a finite number >= 0 (got " + val(row.size) + ")");

      /* meta: optional; an object when present, null tolerated as absent (never routed). */
      if (row.meta !== undefined && row.meta !== null && !isObj(row.meta)) errors.push(label + " meta: must be an object when present, null tolerated as absent (got " + jtype(row.meta) + ")");
    }
    return errors.length === 0 ? { ok: true, errors: errors, manifest: m } : { ok: false, errors: errors };
  } catch (e) {
    errors.push("validation exception (never-throw guard): " + msgOf(e));
    return { ok: false, errors: errors };
  }
}

/* Byte-boundary path: BOM strip + JSON.parse + the same validation. Never throws. */
function parseManifestText(text) {
  try {
    if (typeof text !== "string") return { ok: false, errors: ["manifest.json: not text (got " + jtype(text) + ")"] };
    let t = text;
    if (t.length > 0 && t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
    if (t.trim() === "") return { ok: false, errors: ["manifest.json: empty file"] };
    let parsed = null;
    try { parsed = JSON.parse(t); }
    catch (e) { return { ok: false, errors: ["manifest.json: JSON parse failed: " + msgOf(e)] }; }
    return validateManifest(parsed);
  } catch (e) {
    return { ok: false, errors: ["manifest.json: parse exception (never-throw guard): " + msgOf(e)] };
  }
}

/* ============================== fixture corpus (self-check) ============================== */

/* Every fixture: { group, name, make, expect, errorsLike? }. group "positive"/"negative" =
   the table states the expectation (probe tier "literal"); group "derived" = an AGREED
   reading of an under-specified edge, mirroring the src/av_pack.js option list (probe tier
   "derived" - drift warns only). */
function fixtureList() {
  const list = [];
  const add = (group, name, make, expect, errorsLike) => list.push({ group: group, name: name, make: make, expect: expect, errorsLike: errorsLike || null });

  const baseItem = () => ({ key: "kick", kind: "sample", format: "wav", name: "Kick 01.wav", path: "items/kick.wav", sha256: "ab".repeat(32), size: 44 });
  const base = () => ({ v: 1, id: "mini", name: "Mini", author: "Anvil", license: "", tags: [], at: 1700000000000, app: "anvil-app", items: [baseItem()] });
  const mOf = (patch) => Object.assign(base(), patch);
  const iOf = (patch) => Object.assign(base(), { items: [Object.assign(baseItem(), patch)] });
  const del = (field) => () => { const m = base(); delete m[field]; return m; };
  const delItem = (field) => () => { const m = base(); delete m.items[0][field]; return m; };

  /* ---- positive shapes ---- */
  add("positive", "minimal valid manifest", base, true);
  add("positive", "all caps at their limit", () => mOf({
    name: "n".repeat(80), author: "a".repeat(80), license: "l".repeat(40),
    tags: Array.from({ length: 8 }, () => "t".repeat(24)),
    items: [Object.assign(baseItem(), { name: "x".repeat(120), format: "f".repeat(12) })],
  }), true);
  add("positive", "unknown extra keys tolerated (manifest + item)", () => mOf({ futureKey: { a: 1 }, items: [Object.assign(baseItem(), { extraRow: "x" })] }), true);
  add("positive", "item meta object present", () => iOf({ meta: { dur: 1.5, src: "scan" } }), true);
  add("positive", "all six kinds accepted", () => mOf({
    items: ["sample", "kit", "refs", "pattern", "wt", "module"].map((k, i) => ({
      key: "k" + i, kind: k, format: "dat", name: "Item " + i,
      path: "items/k" + i + ".dat", sha256: "0".repeat(63) + "a", size: i,
    })),
  }), true);
  add("positive", "id 64 chars (slug max)", () => mOf({ id: "a" + "b".repeat(63) }), true);
  add("positive", "id starts with a digit", () => mOf({ id: "0pack" }), true);
  add("positive", "id trailing hyphen (the pinned regex allows it)", () => mOf({ id: "a-" }), true);
  add("positive", "sha256 all-lowercase f x64", () => iOf({ sha256: "f".repeat(64) }), true);
  add("positive", "size 0 allowed", () => iOf({ size: 0 }), true);
  add("positive", "empty tags array allowed", () => mOf({ tags: [] }), true);
  add("positive", "at 0 allowed (finite epoch ms)", () => mOf({ at: 0 }), true);

  /* ---- literal negatives ---- */
  add("negative", "v must be 1 (got 2)", () => mOf({ v: 2 }), false);
  add("negative", 'v must be a number (got "1")', () => mOf({ v: "1" }), false);
  add("negative", "id uppercase refused", () => mOf({ id: "Mini" }), false);
  add("negative", "id leading hyphen refused", () => mOf({ id: "-mini" }), false);
  add("negative", "id 65 chars refused", () => mOf({ id: "a" + "b".repeat(64) }), false);
  add("negative", "id underscore refused", () => mOf({ id: "a_b" }), false);
  add("negative", "id space refused", () => mOf({ id: "a b" }), false);
  add("negative", "id empty refused", () => mOf({ id: "" }), false);
  add("negative", "id missing refused", del("id"), false);
  add("negative", "name 81 chars refused", () => mOf({ name: "n".repeat(81) }), false);
  add("negative", "name non-string refused", () => mOf({ name: 7 }), false);
  add("negative", "author 81 chars refused", () => mOf({ author: "a".repeat(81) }), false);
  add("negative", "license 41 chars refused", () => mOf({ license: "l".repeat(41) }), false);
  add("negative", "license missing refused", del("license"), false);
  add("negative", "tags string refused", () => mOf({ tags: "x" }), false);
  add("negative", "tags 9 entries refused", () => mOf({ tags: Array.from({ length: 9 }, () => "t") }), false);
  add("negative", "tag 25 chars refused", () => mOf({ tags: ["t".repeat(25)] }), false);
  add("negative", "tags non-string entry refused", () => mOf({ tags: [1] }), false);
  add("negative", "at string refused", () => mOf({ at: "1700000000000" }), false);
  add("negative", "at NaN refused", () => mOf({ at: NaN }), false);
  add("negative", "at Infinity refused", () => mOf({ at: Infinity }), false);
  add("negative", "app wrong refused", () => mOf({ app: "other-app" }), false);
  add("negative", "app missing refused", del("app"), false);
  add("negative", "items missing refused", del("items"), false);
  add("negative", "items object refused", () => mOf({ items: {} }), false);
  add("negative", "item row not an object refused", () => mOf({ items: ["x"] }), false);
  add("negative", "key uppercase refused", () => iOf({ key: "KICK", path: "items/KICK.wav" }), false);
  add("negative", "key missing refused", delItem("key"), false);
  add("negative", "duplicate keys refused (named)", () => mOf({ items: [baseItem(), baseItem()] }), false, /duplicate/);
  add("negative", "kind unknown refused (vocabulary named)", () => iOf({ kind: "song" }), false, /kind/);
  add("negative", "kind missing refused", delItem("kind"), false);
  add("negative", "kind non-string refused", () => iOf({ kind: 3 }), false);
  add("negative", "format 13 chars refused", () => iOf({ format: "f".repeat(13) }), false);
  add("negative", "format non-string refused", () => iOf({ format: 7 }), false);
  add("negative", "item name 121 chars refused", () => iOf({ name: "x".repeat(121) }), false);
  add("negative", "item name with slash refused", () => iOf({ name: "a/b.wav" }), false);
  add("negative", "sha uppercase refused (lowercase named)", () => iOf({ sha256: "AB".repeat(32) }), false, /lowercase/);
  add("negative", "sha 63 chars refused", () => iOf({ sha256: "a".repeat(63) }), false);
  add("negative", "sha non-hex refused", () => iOf({ sha256: "zz".repeat(32) }), false);
  add("negative", "sha non-string refused", () => iOf({ sha256: 123 }), false);
  add("negative", "size negative refused", () => iOf({ size: -1 }), false);
  add("negative", "size string refused", () => iOf({ size: "44" }), false);
  add("negative", "size NaN refused", () => iOf({ size: NaN }), false);
  add("negative", "meta array refused", () => iOf({ meta: [] }), false);
  add("negative", "meta string refused", () => iOf({ meta: "x" }), false);
  add("negative", "meta number refused", () => iOf({ meta: 3 }), false);
  add("negative", "path leading slash refused", () => iOf({ path: "/items/kick.wav" }), false);
  add("negative", "path dotdot segment refused", () => iOf({ path: "items/../kick.wav" }), false);
  add("negative", "path outside items/ refused", () => iOf({ path: "kick.wav" }), false);
  add("negative", "path nested under items/ refused", () => iOf({ path: "items/sub/kick.wav" }), false);
  add("negative", "path key mismatch refused", () => iOf({ path: "items/other.wav" }), false);
  add("negative", "path without extension refused", () => iOf({ path: "items/kick" }), false);
  add("negative", "path empty extension refused", () => iOf({ path: "items/kick." }), false);
  add("negative", "path backslash refused", () => iOf({ key: "kick2", path: "items\\kick2.wav" }), false);
  add("negative", "path non-string refused", () => iOf({ path: 7 }), false);

  /* ---- derived edges (agreed readings - mirrored from the src/av_pack.js option list) ---- */
  add("derived", "name empty refused (agreed 1..80 edge)", () => mOf({ name: "" }), false);
  add("derived", 'empty author tolerated (builder defaults it to "")', () => mOf({ author: "" }), true);
  add("derived", "fractional size tolerated (finite >= 0)", () => iOf({ size: 44.5 }), true);
  add("derived", "at negative refused (agreed >= 0 edge)", () => mOf({ at: -1 }), false);
  add("derived", "empty items array tolerated (array required, count unstated)", () => mOf({ items: [] }), true);
  add("derived", "multi-dot extension refused (agreed ext [a-z0-9]{1,12})", () => iOf({ path: "items/kick.tar.gz" }), false);
  add("derived", "ext 13 chars refused (agreed ext cap 12)", () => iOf({ path: "items/kick." + "e".repeat(13) }), false);
  add("derived", "ext with dash refused (agreed ext charset)", () => iOf({ path: "items/kick.d-a" }), false);
  add("derived", "ext uppercase refused (lowercase ext law)", () => iOf({ path: "items/kick.WAV" }), false);
  add("derived", "meta null tolerated as absent (agreed edge)", () => iOf({ meta: null }), true);
  add("derived", "item name empty refused (agreed 1..120 edge)", () => iOf({ name: "" }), false);
  add("derived", "item name backslash refused (leaf reading)", () => iOf({ name: "a\\b.wav" }), false);

  return list;
}

/* ============================== drift probe (src/av_pack.js) ============================== */

/* Best-effort cross-check of the page-side avPackValidateManifest against the same corpus.
   Status: "ran" | "skipped" | "warn". Literal-tier drift = errors; derived-tier = warnings. */
function sourceProbe(repoRoot, fixtures) {
  const out = { status: "skipped", reason: "", checked: 0, errors: [], warnings: [] };
  const file = path.join(repoRoot, "src", "av_pack.js");
  try {
    if (!fs.existsSync(file)) { out.reason = "src/av_pack.js not present"; return out; }
    let fn = null;
    try {
      const SRC = fs.readFileSync(file, "utf8");
      const ENV = (new Function(SRC + "\nreturn (typeof avPackValidateManifest === 'function') ? avPackValidateManifest : null;"))();
      if (typeof ENV === "function") fn = ENV;
    } catch (e) {
      out.status = "warn"; out.reason = "src/av_pack.js not node-loadable (" + msgOf(e).slice(0, 80) + ")"; return out;
    }
    if (!fn) { out.status = "warn"; out.reason = "src/av_pack.js exposes no avPackValidateManifest"; return out; }
    out.status = "ran";
    for (const f of fixtures) {
      let got = null;
      try { const r = fn(f.make()); got = !!(r && r.ok === true); }
      catch (e) { got = "(threw: " + msgOf(e).slice(0, 60) + ")"; }
      if (got !== f.expect) {
        const line = "drift (" + (f.group === "derived" ? "derived" : "literal") + "): " + f.name +
          " - table expects ok=" + f.expect + ", av_pack.js says " + got;
        if (f.group === "derived") out.warnings.push(line); else out.errors.push(line);
      }
      out.checked++;
    }
    return out;
  } catch (e) {
    out.status = "warn"; out.reason = "probe exception (never-throw guard): " + msgOf(e); return out;
  }
}

/* ============================== self-check ============================== */

function defaultRepoRoot() {
  try { return path.dirname(path.dirname(fileURLToPath(import.meta.url))); }
  catch (e) { return process.cwd(); }
}

const GROUP_LABELS = { positive: "positive shapes", negative: "literal negatives", derived: "derived edges" };

function selfCheck(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const repoRoot = typeof o.repoRoot === "string" && o.repoRoot ? o.repoRoot : defaultRepoRoot();
  const errors = [], warnings = [];
  const stats = { fixtures: 0, mismatches: 0, guards: 0, helpers: 0, groups: [], probe: null };
  try {
    /* fixtures */
    const fixtures = fixtureList();
    const byGroup = { positive: { name: "positive", label: GROUP_LABELS.positive, count: 0, misfits: 0 },
      negative: { name: "negative", label: GROUP_LABELS.negative, count: 0, misfits: 0 },
      derived: { name: "derived", label: GROUP_LABELS.derived, count: 0, misfits: 0 } };
    for (const f of fixtures) {
      stats.fixtures++;
      byGroup[f.group].count++;
      const res = validateManifest(f.make());
      let bad = res.ok !== f.expect;
      let detail = "";
      if (bad) detail = "table expects ok=" + f.expect + ", validateManifest says ok=" + res.ok + " :: " + (res.errors[0] || "(no error)");
      else if (f.errorsLike && !res.errors.some(e => f.errorsLike.test(e))) { bad = true; detail = "expected an error matching " + String(f.errorsLike); }
      if (bad) { byGroup[f.group].misfits++; stats.mismatches++; errors.push("fixture (" + f.group + ") " + f.name + ": " + detail); }
    }
    stats.groups = [byGroup.positive, byGroup.negative, byGroup.derived];

    /* never-throw guards */
    let gn = 0;
    const G = (name, cond) => { gn++; if (!cond) errors.push("guard: " + name); };
    G("validateManifest(null) -> ok:false", validateManifest(null).ok === false);
    G("validateManifest(undefined) -> ok:false", validateManifest(undefined).ok === false);
    G('validateManifest("x") -> ok:false', validateManifest("x").ok === false);
    G("validateManifest([]) -> ok:false", validateManifest([]).ok === false);
    G("validateManifest(42) -> ok:false", validateManifest(42).ok === false);
    {
      const evil = { v: 1, id: "mini", author: "A", license: "", tags: [], at: 1, app: "anvil-app", items: [] };
      Object.defineProperty(evil, "name", { get() { throw new Error("boom"); } });
      const r = validateManifest(evil);
      G("throwing getter -> ok:false + never-throw message", r.ok === false && r.errors.some(e => /never-throw/.test(e)));
    }
    G("circular object -> no throw", (() => {
      try {
        const c = { v: 1, id: "mini", name: "N", author: "A", license: "", tags: [], at: 1, app: "anvil-app", items: [] };
        c.self = c;
        return typeof validateManifest(c).ok === "boolean";
      } catch (e) { return false; }
    })());
    {
      const okText = JSON.stringify({ v: 1, id: "p", name: "N", author: "A", license: "", tags: [], at: 1, app: "anvil-app", items: [] });
      G("parseManifestText valid -> ok", parseManifestText(okText).ok === true);
      G("parseManifestText BOM stripped -> ok", parseManifestText("\uFEFF" + okText).ok === true);
      G("parseManifestText junk -> JSON parse failed", (() => {
        const r = parseManifestText("{oops");
        return r.ok === false && r.errors.some(e => /JSON parse failed/.test(e));
      })());
      G("parseManifestText empty -> error", (() => {
        const r = parseManifestText("  ");
        return r.ok === false && r.errors.length > 0;
      })());
      G("parseManifestText non-string -> error", parseManifestText(7).ok === false);
    }
    stats.guards = gn;

    /* helpers */
    let hn = 0;
    const H = (name, cond) => { hn++; if (!cond) errors.push("helper: " + name); };
    H("itemPathFor", itemPathFor("abc", "wav") === "items/abc.wav");
    H("isSafeRelPath truth table", isSafeRelPath("items/a.wav") === true && isSafeRelPath("a/b") === true &&
      isSafeRelPath("") === false && isSafeRelPath("/a") === false && isSafeRelPath("a/../b") === false &&
      isSafeRelPath("..") === false && isSafeRelPath("a\\b") === false && isSafeRelPath(7) === false);
    H("checkItemPath clean -> no errors", checkItemPath("items/a.wav", "a").length === 0);
    H("checkItemPath key mismatch -> error", checkItemPath("items/b.wav", "a").length >= 1);
    H("checkItemPath nested -> error", checkItemPath("items/x/a.wav", "a").length >= 1);
    stats.helpers = hn;

    /* drift probe */
    const probe = sourceProbe(repoRoot, fixtures);
    stats.probe = { status: probe.status, reason: probe.reason, checked: probe.checked,
      literalDrift: probe.errors.length, derivedDrift: probe.warnings.length };
    for (const e of probe.errors) errors.push(e);
    for (const w of probe.warnings) warnings.push(w);

    return { ok: errors.length === 0, errors: errors, warnings: warnings, stats: stats, repoRoot: repoRoot };
  } catch (e) {
    errors.push("self-check exception (never-throw guard): " + msgOf(e));
    return { ok: false, errors: errors, warnings: warnings, stats: stats, repoRoot: repoRoot };
  }
}

/* ============================== exports ============================== */

export {
  AVPACK_VERSION, AVPACK_APP, AVPACK_MANIFEST_NAME, AVPACK_ITEMS_DIR, AVPACK_SLUG, AVPACK_SHA256_HEX,
  AVPACK_PATH_RE, AVPACK_KINDS, AVPACK_CAPS, AVPACK_ZIP_METHODS,
  isSafeRelPath, itemPathFor, checkItemPath,
  validateManifest, parseManifestText,
  fixtureList, sourceProbe, selfCheck, defaultRepoRoot,
};

/* ============================== CLI (self-check) ============================== */

const IS_MAIN = (() => { try { return /(^|[\\/])avpack_schema\.mjs$/.test(process.argv[1] || ""); } catch (e) { return false; } })();

if (IS_MAIN) {
  try {
    const res = selfCheck({ repoRoot: defaultRepoRoot() });
    console.log("== avpack_schema self-check ==");
    console.log("module: " + fileURLToPath(import.meta.url));
    const gcounts = res.stats.groups.map(g => g.name + " " + g.count).join(" - ");
    console.log("fixtures: " + res.stats.fixtures + " (" + gcounts + ") - mismatches " + res.stats.mismatches);
    for (const g of res.stats.groups) {
      console.log("  " + (g.misfits === 0 ? "PASS" : "FAIL") + "  " + g.label + " (" + g.count + ")" +
        (g.misfits ? " - misfits " + g.misfits : ""));
    }
    console.log("  " + (res.stats.guards > 0 && !res.errors.some(e => e.indexOf("guard:") === 0) ? "PASS" : "FAIL") +
      "  never-throw guards & parseManifestText (" + res.stats.guards + ")");
    console.log("  " + (!res.errors.some(e => e.indexOf("helper:") === 0) ? "PASS" : "FAIL") +
      "  helpers isSafeRelPath/itemPathFor/checkItemPath (" + res.stats.helpers + ")");
    const p = res.stats.probe;
    if (p && p.status === "ran") {
      console.log("source probe: ran - " + p.checked + " fixtures cross-checked against src/av_pack.js - literal drift " +
        p.literalDrift + " - derived drift " + p.derivedDrift);
    } else if (p) {
      console.log("source probe: skipped (" + (p.reason || p.status) + ")");
    }
    if (res.errors.length) {
      console.log("errors: " + res.errors.length);
      for (const e of res.errors.slice(0, 40)) console.log("  FAIL  " + e);
      if (res.errors.length > 40) console.log("  ... (" + (res.errors.length - 40) + " more)");
    } else console.log("errors: 0");
    if (res.warnings.length) {
      console.log("warnings: " + res.warnings.length);
      for (const w of res.warnings.slice(0, 20)) console.log("  WARN  " + w);
    }
    console.log(res.ok ? "AVPACK SCHEMA SELF-CHECK: PASS" : "AVPACK SCHEMA SELF-CHECK: FAIL");
    process.exit(res.ok ? 0 : 1);
  } catch (e) {
    console.error("avpack_schema CLI exception (never-throw guard): " + String(e && e.stack || e));
    process.exit(1);
  }
}
