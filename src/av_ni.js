"use strict";

// av_ni.js -- R15d clean-room reader for Native Instruments files.
//
// Covers:
//   - legacy NKI (Kontakt 1 .. 4.2.1): 170-byte header + zlib-compressed XML
//     (zlib stream at 0xAA, or 0x24 on early K1/NiSS files); zones + samples +
//     refs extracted with an incremental regex scan (never a DOM parse).
//   - modern NI container (Kontakt 4.2.2+ / K5 .. K8, and Battery 4 .nbkt):
//     hsin items, DSIN chunk stacks, u64 block framing; metadata from the
//     SOUNDINFO (108) and AUTHORING_APPLICATION (101) chunks; sample refs from
//     preset FILENAME_LIST / FILENAME_LIST_EX chunks and EXTERNAL_FILE_REFERENCE
//     (110) chunks; FastLZ-compressed SUB_TREE_ITEM (115) frames are decoded in
//     bounds; locked-library detection: an ENCRYPTION_ITEM (116) whose payload
//     cannot be decoded is reported as encrypted.
//
// Clean-room note: written from format understanding (public docs, the public
// domain nkitool source and read-only study of open-source NI handlers). No
// third-party code is copied; the FastLZ decoder below is an independent
// implementation of the published FastLZ compression format (algorithm by
// Ariya Hidayat, MIT).
//
// Laws: ASCII-only source, strict mode, no DOM access at load time, public
// entry points never throw. Exports (top level): AV_NI_VERSION, AVNI.
//
//   AVNI.probe(u8OrArrayBuffer, hint) -> { ok, kind, encrypted, error? }  (sync)
//     kind is "legacy" | "container" | "".
//   AVNI.parse(u8OrArrayBuffer, hint) -> Promise<receipt> (never rejects)
//     kind is "legacy" | "container" | "nbkt" (hint "nbkt" selects "nbkt").
//   hint = caller's extension: "nki" | "nbkt" | "".

const AV_NI_VERSION = "r15d.0";

const AVNI = (function () {

  // ------------------------------------------------------------------
  // constants
  // ------------------------------------------------------------------

  const HSIN_AT = 0x0C;
  const LEGACY_OFFSETS = [0xAA, 0x24];
  const MAX_INPUT = 64 * 1024 * 1024;
  const MAX_DEPTH = 40;
  const MAX_CHUNKS = 200000;
  const MAX_ITEMS = 50000;
  const MAX_SUBTREE_OUT = 8 * 1024 * 1024;
  const MAX_PRESET_SCAN = 8 * 1024 * 1024;
  const MAX_REFS = 4096;
  const MAX_ZONES = 4096;
  const MAX_SAMPLES = 4096;
  const MAX_STR_CHARS = 4096;
  const MAX_XML = 64 * 1024 * 1024;
  const ENC_ERROR = "encrypted (locked library)";
  const UNREAD = "unreadable NI data";

  // chunk type ids (modern container)
  const CH_TERMINATOR = 1;
  const CH_AUTHORING = 101;
  const CH_SOUNDINFO = 108;
  const CH_PRESET = 109;
  const CH_EXTERNAL_REF = 110;
  const CH_SUBTREE = 115;
  const CH_ENCRYPTION = 116;

  // preset chunk ids (Kontakt 5+ preset chunk structure)
  const PC_FILENAME_LIST = 0x3D;
  const PC_FILENAME_LIST_EX = 0x4B;

  // authoring application ids -> product names
  const APP_NAMES = ["", "GuitarRig", "Kontakt", "KORE", "Reaktor", "Maschine",
    "Absynth", "Massive", "FM8", "Battery", "Komplete Kontrol", "SC"];

  // ------------------------------------------------------------------
  // small helpers
  // ------------------------------------------------------------------

  function toBytes(input) {
    try {
      if (!input) return null;
      if (input instanceof Uint8Array) return input;
      if (typeof ArrayBuffer !== "undefined" && input instanceof ArrayBuffer) return new Uint8Array(input);
      if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(input)) {
        return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  function u16(b, p) {
    return b[p] | (b[p + 1] << 8);
  }

  function u32(b, p) {
    return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
  }

  function u64(b, p) {
    // little-endian 64-bit -> Number; absurdly large values collapse to a
    // sentinel that every caller clamps against the buffer end.
    const lo = u32(b, p);
    const hi = u32(b, p + 4);
    if (hi > 0x200000) return Number.MAX_SAFE_INTEGER;
    return hi * 4294967296 + lo;
  }

  function ascii4(b, p) {
    let s = "";
    for (let i = 0; i < 4; i++) s += String.fromCharCode(b[p + i]);
    return s;
  }

  function readUtf16(b, p, end) {
    // u32 char count + count * 2 bytes UTF-16LE; null when out of bounds
    if (p + 4 > end) return null;
    const n = u32(b, p);
    if (n > MAX_STR_CHARS || p + 4 + 2 * n > end) return null;
    let s = "";
    const q = p + 4;
    for (let i = 0; i < n; i++) s += String.fromCharCode(u16(b, q + 2 * i));
    return { s: s, end: q + 2 * n };
  }

  function short(s, cap) {
    const t = (typeof s === "string") ? s : "";
    if (t.length <= cap) return t;
    return t.slice(0, cap);
  }

  function isZlibSig(b, p) {
    if (p + 2 > b.length) return false;
    if (b[p] !== 0x78) return false;
    const f = b[p + 1];
    return f === 0x01 || f === 0x5E || f === 0x9C || f === 0xDA;
  }

  function appNameFor(id) {
    if (typeof id !== "number" || id < 0) return "";
    if (id >= 1 && id <= 10) return APP_NAMES[id];
    if (id === 11) return "SC";
    if (id >= 12 && id <= 30) {
      const n = id - 11;
      return "FXF_" + (n < 10 ? "0" + n : String(n));
    }
    if (id === 31) return "Traktor";
    return "";
  }

  function leafName(s) {
    const t = (typeof s === "string") ? s : "";
    let k = -1;
    for (let i = t.length - 1; i >= 0; i--) {
      const c = t.charCodeAt(i);
      if (c === 47 || c === 92) { k = i; break; }
    }
    return k >= 0 ? t.slice(k + 1) : t;
  }

  // ------------------------------------------------------------------
  // FastLZ decoder (independent implementation of the published format)
  // ------------------------------------------------------------------

  function fastlz(b, p0, compLen, outSize) {
    try {
      if (compLen < 1 || compLen > b.length - p0) return null;
      if (outSize < 1 || outSize > MAX_SUBTREE_OUT) return null;
      const out = new Uint8Array(outSize);
      const inEnd = p0 + compLen;
      const level = ((b[p0] >>> 5) & 7) + 1;
      let ip = p0;
      let op = 0;
      let ctrl = b[ip++] & 31;
      let loop = true;
      do {
        let ref = op;
        let len = ctrl >>> 5;
        let ofs = (ctrl & 31) << 8;
        if (ctrl >= 32) {
          let code = 0;
          len--;
          ref -= ofs;
          if (len === 6) {
            if (level === 1) {
              if (ip >= inEnd) return null;
              len += b[ip++] & 0xff;
            } else {
              do {
                if (ip >= inEnd) return null;
                code = b[ip++] & 0xff;
                len += code;
              } while (code === 255);
            }
          }
          if (level === 1) {
            if (ip >= inEnd) return null;
            ref -= b[ip++] & 0xff;
          } else {
            if (ip >= inEnd) return null;
            code = b[ip++] & 0xff;
            ref -= code;
            if (code === 255 && ofs === (31 << 8)) {
              if (ip + 2 > inEnd) return null;
              ofs = (b[ip++] & 0xff) << 8;
              ofs += b[ip++] & 0xff;
              ref = op - ofs - 8191;
            }
          }
          if (op + len + 3 > outSize) return null;
          if (ref - 1 < 0) return null;
          if (ip < inEnd) ctrl = b[ip++] & 0xff; else loop = false;
          if (ref === op) {
            const v = out[ref - 1];
            out[op++] = v; out[op++] = v; out[op++] = v;
            for (; len !== 0; --len) out[op++] = v;
          } else {
            ref--;
            out[op++] = out[ref++]; out[op++] = out[ref++]; out[op++] = out[ref++];
            for (; len !== 0; --len) out[op++] = out[ref++];
          }
        } else {
          ctrl++;
          if (op + ctrl > outSize) return null;
          if (ip + ctrl > inEnd) return null;
          out[op++] = b[ip++];
          for (--ctrl; ctrl !== 0; ctrl--) out[op++] = b[ip++];
          loop = ip < inEnd;
          if (loop) ctrl = b[ip++] & 0xff;
        }
      } while (loop);
      return out.subarray(0, op);
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // container walk
  // ------------------------------------------------------------------

  function newWalkState() {
    return {
      warnings: [],
      refs: [],
      refSeen: {},
      chunks: 0,
      items: 0,
      soundinfos: [],
      authorings: [],
      encItems: [],
      subTreeFails: 0
    };
  }

  function warn(st, msg) {
    if (st && st.warnings && st.warnings.length < 64) st.warnings.push(short(msg, 160));
  }

  function addRef(st, path) {
    try {
      const p = short(path, 512);
      if (!p) return;
      const n = leafName(p) || p;
      const key = p.toLowerCase();
      if (st.refSeen[key]) return;
      if (st.refs.length >= MAX_REFS) {
        warn(st, "ref list capped at " + MAX_REFS);
        st.refSeen[key] = true;
        return;
      }
      st.refSeen[key] = true;
      st.refs.push({ name: short(n, 200), path: p });
    } catch (e) { /* ignore */ }
  }

  function parseSoundinfo(b, p, end) {
    const out = { version: 0, versionText: "", name: "", author: "", vendor: "", description: "", tags: [], attributes: [], properties: {} };
    try {
      let q = p;
      if (q + 16 > end) return null;
      out.version = u32(b, q); q += 4;
      const vm = u32(b, q); q += 4;
      const vn = u32(b, q); q += 4;
      const vp = u32(b, q); q += 4;
      out.soundinfoVersion = vm + "." + vn + "." + vp;
      const r1 = readUtf16(b, q, end); if (r1) { out.name = r1.s; q = r1.end; } else return out;
      const r2 = readUtf16(b, q, end); if (r2) { out.author = r2.s; q = r2.end; } else return out;
      const r3 = readUtf16(b, q, end); if (r3) { out.vendor = r3.s; q = r3.end; } else return out;
      const r4 = readUtf16(b, q, end); if (r4) { out.description = r4.s; q = r4.end; } else return out;
      q += 36; // reserved block: u32 + u64 + u64 + u64 + u32 + u32
      if (q + 4 > end) return out;
      let n = u32(b, q); q += 4;
      if (n > MAX_STR_CHARS) return out;
      for (let i = 0; i < n; i++) {
        const r = readUtf16(b, q, end);
        if (!r) return out;
        out.tags.push(r.s); q = r.end;
      }
      if (q + 4 > end) return out;
      n = u32(b, q); q += 4;
      if (n > MAX_STR_CHARS) return out;
      for (let i = 0; i < n; i++) {
        const r = readUtf16(b, q, end);
        if (!r) return out;
        out.attributes.push(r.s); q = r.end;
      }
      if (q + 8 > end) return out;
      q += 4;
      n = u32(b, q); q += 4;
      if (n > MAX_STR_CHARS) return out;
      for (let i = 0; i < n; i++) {
        const k = readUtf16(b, q, end);
        if (!k) return out;
        q = k.end;
        const v = readUtf16(b, q, end);
        if (!v) return out;
        q = v.end;
        if (Object.keys(out.properties).length < 256) out.properties[k.s] = v.s;
      }
      return out;
    } catch (e) {
      return out;
    }
  }

  function parseAuthoring(b, p, end) {
    const out = { version: 0, compressed: false, appID: -1, appVersion: "" };
    try {
      let q = p;
      if (q + 13 > end) return null;
      out.version = u32(b, q); q += 4;
      out.compressed = b[q] > 0; q += 1;
      out.appID = u32(b, q); q += 4;
      q += 4;
      const r = readUtf16(b, q, end);
      if (r) out.appVersion = r.s;
      return out;
    } catch (e) {
      return out;
    }
  }

  function decodeFileList(b, p, end, withVersion) {
    // Shared segment-path file list decode. Returns { files: [...] } or null.
    // withVersion: FILENAME_LIST_EX layout (u16 version first); false: the
    // version-less FILENAME_LIST layout.
    try {
      const files = [];
      let q = p;
      if (withVersion) {
        if (q + 2 > end) return null;
        const version = u16(b, q); q += 2;
        if (version !== 2 && version !== 3) return null;
        if (version === 3) {
          if (q + 12 > end) return null;
          const size = (u32(b, q) | 0); q += 4;
          if (size < 1 || size > 4096) return null;
          q += 8;
          for (let i = 0; i < size - 1; i++) {
            const r = readListFile(b, q, end);
            if (!r) return null;
            files.push(r.s); q = r.end;
            if (q < end) q += 32;
          }
          return { files: files, version: 3 };
        }
      }
      const n1 = (u32(b, q) | 0); q += 4;
      if (n1 < 0 || n1 > 4096) return null;
      for (let i = 0; i < n1; i++) {
        const r = readListFile(b, q, end);
        if (!r) return null;
        q = r.end;
      }
      if (q + 4 > end) return null;
      const n2 = (u32(b, q) | 0); q += 4;
      if (n2 < 0 || n2 > 4096) return null;
      for (let i = 0; i < n2; i++) {
        const r = readListFile(b, q, end);
        if (!r) return null;
        files.push(r.s); q = r.end;
      }
      return { files: files, version: withVersion ? 2 : 0 };
    } catch (e) {
      return null;
    }
  }

  function readListFile(b, p, end) {
    try {
      let q = p;
      if (q + 4 > end) return null;
      const segs = (u32(b, q) | 0); q += 4;
      if (segs < 0 || segs > 256) return null;
      let s = "";
      for (let i = 0; i < segs; i++) {
        if (q >= end) return null;
        const st = b[q]; q += 1;
        if (st === 0) {
          if (q + 2 > end) return null;
          let d = String.fromCharCode(b[q], b[q + 1]).replace(/\s+$/, "");
          q += 2;
          s += d === "" ? "/" : d + ":/";
        } else if (st === 1 || st === 2 || st === 4 || st === 8 || st === 9) {
          if (q + 4 > end) return null;
          const n = u32(b, q); q += 4;
          if (n > MAX_STR_CHARS || q + 2 * n > end) return null;
          let str = "";
          for (let k = 0; k < n; k++) str += String.fromCharCode(u16(b, q + 2 * k));
          q += 2 * n;
          if (st === 1) s += str === "" ? "/" : str + ":/";
          else if (st === 2) s += str + "/";
          else s += str;
        } else if (st === 3) {
          s += "../";
        } else if (st === 6) {
          // top element marker, nothing to append
        } else {
          return null;
        }
      }
      return { s: s, end: q };
    } catch (e) {
      return null;
    }
  }

  function scanPresetForRefs(b, start, end, st) {
    try {
      const stop = Math.min(end, start + MAX_PRESET_SCAN);
      for (let i = start; i + 6 <= stop; i++) {
        const id = u16(b, i);
        if (id !== PC_FILENAME_LIST && id !== PC_FILENAME_LIST_EX) continue;
        const size = u32(b, i + 2);
        if (size < 6 || size > MAX_PRESET_SCAN) continue;
        const dEnd = Math.min(i + 6 + size, stop);
        const dec = decodeFileList(b, i + 6, dEnd, id === PC_FILENAME_LIST_EX);
        if (!dec || !dec.files.length) continue;
        for (let k = 0; k < dec.files.length; k++) addRef(st, dec.files[k]);
        i = i + 5 + size; // skip past the decoded chunk
      }
    } catch (e) { /* ignore */ }
  }

  function scanExtRefChunk(b, start, end, st) {
    try {
      // try the segment file-list layouts first
      let dec = decodeFileList(b, start, end, true);
      if (!dec) dec = decodeFileList(b, start, end, false);
      if (dec && dec.files.length) {
        for (let i = 0; i < dec.files.length; i++) addRef(st, dec.files[i]);
        return;
      }
      if (end - start < 8) return;
      // fall back: readable UTF-16 runs that look like sample paths (both
      // parities are tried; refs dedupe case-insensitively)
      let found = 0;
      for (let parity = 0; parity < 2; parity++) {
        let cur = "";
        for (let i = start + parity; i + 1 < end; i += 2) {
          const c = u16(b, i);
          if (c >= 32 && c < 0x3000) {
            cur += String.fromCharCode(c);
          } else {
            if (cur.length >= 4 && (cur.indexOf(".") >= 0 || cur.indexOf("/") >= 0 || cur.indexOf("\\") >= 0)) {
              addRef(st, cur); found++;
            }
            cur = "";
          }
        }
        if (cur.length >= 4 && (cur.indexOf(".") >= 0 || cur.indexOf("/") >= 0 || cur.indexOf("\\") >= 0)) {
          addRef(st, cur); found++;
        }
      }
      if (!found) warn(st, "external file reference not decoded");
    } catch (e) { /* ignore */ }
  }

  function parseChunkChain(b, q0, hardEnd, depth, st, encCtx) {
    try {
      if (depth > MAX_DEPTH) { warn(st, "container nesting too deep"); return hardEnd; }
      if (st.chunks > MAX_CHUNKS) { warn(st, "chunk budget exhausted"); return hardEnd; }
      let q = q0;
      if (q + 12 > hardEnd) {
        if (q !== hardEnd) warn(st, "truncated chunk stack");
        return hardEnd;
      }
      if (q + 8 > hardEnd) return hardEnd;
      let size = u64(b, q);
      if (!(size >= 8)) { warn(st, "invalid chunk frame"); return hardEnd; }
      if (size - 8 > hardEnd - (q + 8)) {
        warn(st, "truncated chunk frame");
        size = hardEnd - q;
        if (size < 8) return hardEnd;
      }
      const cs = q + 8;
      const ce = cs + size - 8;
      if (ce - cs < 12) { warn(st, "truncated chunk header"); return ce; }
      st.chunks += 1;
      const domain = ascii4(b, cs);
      const type = u32(b, cs + 4);
      const version = u32(b, cs + 8);
      if (version !== 1) warn(st, "chunk version " + version + " (type " + type + ")");
      let childCtx = null;
      if (type === CH_ENCRYPTION) {
        childCtx = { offset: q, blob: ce - (cs + 12), subtreeSeen: false, subtreeOk: false };
        st.encItems.push(childCtx);
      }
      let dataStart;
      if (type !== CH_TERMINATOR) {
        dataStart = parseChunkChain(b, cs + 12, ce, depth + 1, st, childCtx);
      } else {
        dataStart = cs + 12;
      }
      if (dataStart < cs + 12) dataStart = cs + 12;
      if (dataStart > ce) dataStart = ce;
      // chunk data region is [dataStart, ce)
      if (type === CH_SOUNDINFO) {
        const si = parseSoundinfo(b, dataStart, ce);
        if (si) st.soundinfos.push(si);
      } else if (type === CH_AUTHORING) {
        const au = parseAuthoring(b, dataStart, ce);
        if (au) st.authorings.push(au);
      } else if (type === CH_PRESET) {
        if (dataStart + 20 <= ce) {
          const pver = u32(b, dataStart);
          const nItems = u32(b, dataStart + 8);
          const sizeItem = u32(b, dataStart + 12);
          const pStart = dataStart + 20;
          const pEnd = Math.min(pStart + sizeItem, ce);
          if (pver !== 1) warn(st, "preset chunk version " + pver);
          if (nItems !== 1) warn(st, "preset dictionary entries " + nItems);
          if (sizeItem > 0 && pStart < pEnd && sizeItem <= MAX_PRESET_SCAN) {
            scanPresetForRefs(b, pStart, pEnd, st);
          } else {
            warn(st, "preset data not scanned (size " + sizeItem + ")");
          }
        } else {
          warn(st, "preset chunk too small");
        }
      } else if (type === CH_EXTERNAL_REF) {
        scanExtRefChunk(b, dataStart, ce, st);
      } else if (type === CH_SUBTREE) {
        const r = parseSubTree(b, dataStart, ce, depth, st);
        if (!r.ok) st.subTreeFails += 1;
        if (encCtx) {
          encCtx.subtreeSeen = true;
          encCtx.subtreeOk = r.ok;
        }
      }
      return ce;
    } catch (e) {
      warn(st, "chunk walk error");
      return hardEnd;
    }
  }

  function parseSubTree(b, dataStart, dataEnd, depth, st) {
    try {
      if (dataStart + 5 > dataEnd) return { ok: false, reason: "truncated subtree frame" };
      const compressed = b[dataStart + 4];
      if (!compressed) {
        const before = st.items;
        parseItemAt(b, dataStart + 5, dataEnd, depth + 1, st);
        if (st.items > before) return { ok: true, reason: "" };
        return { ok: false, reason: "nested subtree item not recognized" };
      }
      if (dataStart + 13 > dataEnd) return { ok: false, reason: "truncated compressed subtree" };
      const outSize = u32(b, dataStart + 5);
      const compSize = u32(b, dataStart + 9);
      if (outSize < 1 || outSize > MAX_SUBTREE_OUT) return { ok: false, reason: "subtree size out of range" };
      if (compSize < 1 || compSize > dataEnd - (dataStart + 13)) return { ok: false, reason: "subtree payload out of range" };
      const out = fastlz(b, dataStart + 13, compSize, outSize);
      if (!out) return { ok: false, reason: "compressed subtree could not be decoded" };
      const before = st.items;
      parseItemAt(out, 0, out.length, depth + 1, st);
      if (st.items > before) return { ok: true, reason: "" };
      warn(st, "decoded subtree item not recognized");
      return { ok: false, reason: "decoded subtree item not recognized" };
    } catch (e) {
      return { ok: false, reason: "subtree read error" };
    }
  }

  function parseItemAt(b, start, hardEnd, depth, st) {
    try {
      if (depth > MAX_DEPTH) { warn(st, "item nesting too deep"); return hardEnd; }
      if (st.items > MAX_ITEMS) { warn(st, "item budget exhausted"); return hardEnd; }
      if (start + 8 > hardEnd) return hardEnd;
      let size = u64(b, start);
      if (!(size >= 8)) { warn(st, "invalid item frame"); return hardEnd; }
      if (size - 8 > hardEnd - (start + 8)) {
        warn(st, "truncated item frame");
        size = hardEnd - start;
        if (size < 8) return hardEnd;
      }
      const cs = start + 8;
      const ce = cs + size - 8;
      if (ce - cs < 32) { warn(st, "truncated item"); return ce; }
      const hv = u32(b, cs);
      const magic = ascii4(b, cs + 4);
      if (hv !== 1 || magic !== "hsin") {
        warn(st, "unrecognized item block");
        return ce;
      }
      st.items += 1;
      let q = parseChunkChain(b, cs + 32, ce, depth, st, null);
      if (q + 8 > ce) { warn(st, "truncated item footer"); return ce; }
      const numChildren = u32(b, q + 4);
      q += 8;
      if (numChildren > 65535) { warn(st, "child count out of range"); return ce; }
      for (let i = 0; i < numChildren; i++) {
        if (q + 12 > ce) { warn(st, "truncated child item"); break; }
        q += 12; // child index, domain, type
        q = parseItemAt(b, q, ce, depth + 1, st);
      }
      return ce;
    } catch (e) {
      warn(st, "item walk error");
      return hardEnd;
    }
  }

  function walkContainer(b) {
    const st = newWalkState();
    parseItemAt(b, 0, b.length, 0, st);
    // locked-library decision: an ENCRYPTION_ITEM whose payload could not be
    // read (undecodable compressed subtree, or an opaque payload) => encrypted.
    let encrypted = false;
    for (let i = 0; i < st.encItems.length; i++) {
      const e = st.encItems[i];
      if (e.subtreeSeen) {
        if (!e.subtreeOk) encrypted = true;
      } else if (e.blob > 16) {
        encrypted = true;
      } else if (e.blob <= 16) {
        warn(st, "empty encryption item");
      }
    }
    return {
      items: st.items,
      chunks: st.chunks,
      warnings: st.warnings,
      refs: st.refs,
      encrypted: encrypted,
      soundinfos: st.soundinfos,
      authorings: st.authorings
    };
  }

  function pickSoundinfo(st) {
    const list = st.soundinfos;
    let pick = null;
    for (let i = 0; i < list.length; i++) {
      if (list[i] && typeof list[i].name === "string" && list[i].name) { pick = list[i]; break; }
    }
    if (!pick && list.length) pick = list[0];
    return pick;
  }

  function pickAuthoring(st) {
    const list = st.authorings;
    let pick = null;
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].appID === 2) { pick = list[i]; break; }
    }
    if (!pick && list.length) pick = list[0];
    return pick;
  }

  function parseContainer(b, hint) {
    const kind = (hint === "nbkt") ? "nbkt" : "container";
    let st = null;
    try {
      st = walkContainer(b);
    } catch (e) {
      st = null;
    }
    if (!st) return { ok: false, kind: kind, encrypted: false, error: "container walk failed" };
    const si = pickSoundinfo(st);
    const au = pickAuthoring(st);
    const name = si ? short(si.name, 200) : "";
    const author = si ? short(si.author, 200) : "";
    const product = au ? appNameFor(au.appID) : "";
    const version = au ? short(au.appVersion, 80) : "";
    if (st.items === 0) {
      return { ok: false, kind: kind, encrypted: false, error: "no container items found" };
    }
    if (st.encrypted) {
      return {
        ok: false,
        kind: kind,
        encrypted: true,
        error: ENC_ERROR,
        name: name,
        product: product,
        version: version,
        warnings: st.warnings
      };
    }
    if (!si && !au && !st.refs.length) {
      warn(st, "no metadata or sample references found");
    }
    return {
      ok: true,
      kind: kind,
      encrypted: false,
      error: "",
      name: name,
      author: author,
      vendor: si ? short(si.vendor, 200) : "",
      description: si ? short(si.description, 1000) : "",
      soundinfoVersion: si ? short(si.soundinfoVersion, 40) : "",
      product: product,
      version: version,
      refs: st.refs,
      refCount: st.refs.length,
      warnings: st.warnings
    };
  }

  // ------------------------------------------------------------------
  // legacy NKI (zlib + XML scan)
  // ------------------------------------------------------------------

  function findLegacyOffset(b) {
    for (let i = 0; i < LEGACY_OFFSETS.length; i++) {
      if (isZlibSig(b, LEGACY_OFFSETS[i])) return LEGACY_OFFSETS[i];
    }
    return -1;
  }

  function inflateOnce(bytes, fmt) {
    return new Promise(function (resolve) {
      try {
        if (typeof DecompressionStream !== "function") { resolve(null); return; }
        if (typeof Blob !== "function" || typeof Response !== "function") { resolve(null); return; }
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(fmt));
        new Response(stream).arrayBuffer().then(function (buf) {
          resolve(new Uint8Array(buf));
        }, function () {
          resolve(null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function inflateLegacy(bytes) {
    if (typeof DecompressionStream !== "function") {
      return { ok: false, error: "decompression unavailable" };
    }
    const attempts = [];
    const seen = {};
    function pushCandidate(buf) {
      if (!buf || buf.length < 8) return;
      const k = String(buf.length);
      if (seen[k]) return;
      seen[k] = true;
      attempts.push(buf);
    }
    pushCandidate(bytes);
    // Kontakt 4 era files append a plain-text soundinfo footer after the
    // compressed stream; the stream reader rejects trailing bytes, so retry
    // with the footer trimmed at its known start markers (bounded to the file
    // tail). No marker found / wrong trim -> the attempt just fails quietly.
    try {
      const len = bytes.length;
      const tailStart = Math.max(0, len - 65536);
      const markers = ["<?xml", "<soundinfo"];
      for (let m = 0; m < markers.length; m++) {
        const pat = markers[m];
        let idx = -1;
        for (let i = len - pat.length; i >= tailStart; i--) {
          let hit = true;
          for (let k = 0; k < pat.length; k++) {
            if (bytes[i + k] !== pat.charCodeAt(k)) { hit = false; break; }
          }
          if (hit) { idx = i; break; }
        }
        if (idx > 8) pushCandidate(bytes.subarray(0, idx));
      }
    } catch (e) { /* best effort */ }
    for (let a = 0; a < attempts.length; a++) {
      let out = await inflateOnce(attempts[a], "deflate");
      if (!out) out = await inflateOnce(attempts[a], "deflate-raw");
      if (out) return { ok: true, bytes: out };
    }
    return { ok: false, error: "inflate failed" };
  }

  function bytesToText(bytes, offset) {
    const src = offset > 0 ? bytes.subarray(offset) : bytes;
    try {
      if (typeof TextDecoder === "function") {
        const td = new TextDecoder("utf-8");
        let s = td.decode(src);
        if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
        return s;
      }
    } catch (e) { /* fall through */ }
    let s = "";
    const n = Math.min(src.length, 512 * 1024);
    for (let i = 0; i < n; i++) s += String.fromCharCode(src[i]);
    return s;
  }

  function unescapeXml(s) {
    if (typeof s !== "string") return "";
    return s.replace(/&(amp|lt|gt|quot|apos);/g, function (m, e) {
      if (e === "amp") return "&";
      if (e === "lt") return "<";
      if (e === "gt") return ">";
      if (e === "quot") return "\"";
      return "'";
    });
  }

  function decodeEncodedPath(s) {
    let t = unescapeXml(s);
    t = t.replace(/%([0-9a-fA-F]{4})/g, function (m, h) {
      return String.fromCharCode(parseInt(h, 16));
    });
    return t;
  }

  function attrOf(tagText, name) {
    try {
      const m = new RegExp("\\b" + name + "\\s*=\\s*\"([^\"]*)\"").exec(tagText);
      return m ? m[1] : null;
    } catch (e) {
      return null;
    }
  }

  function collectTagParams(tagText, bodyText, out) {
    try {
      const re = /([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*"([^"]*)"/g;
      let m = re.exec(tagText);
      while (m) {
        out[m[1]] = m[2];
        m = re.exec(tagText);
      }
      const vre = /<V\b([^>]*)>/g;
      let v = vre.exec(bodyText);
      while (v) {
        const inner = v[1];
        const n = attrOf(inner, "name");
        if (n) {
          const val = attrOf(inner, "value");
          out[n] = val === null ? "" : val;
        }
        v = vre.exec(bodyText);
      }
    } catch (e) { /* ignore */ }
  }

  function numOf(params, name, dflt) {
    if (!params || typeof params[name] !== "string") return dflt;
    const v = parseFloat(params[name]);
    return isFinite(v) ? v : dflt;
  }

  function intOf(params, name, dflt) {
    const v = numOf(params, name, dflt);
    return Math.round(v);
  }

  function deriveTuning(params) {
    // explicit fineTuning / coarseTuning params win; otherwise derive from the
    // logarithmic zoneTune ratio (1.0 = no change) as coarse semitones + cents.
    if (typeof params.fineTuning === "string" || typeof params.coarseTuning === "string") {
      return { fine: intOf(params, "fineTuning", 0), coarse: intOf(params, "coarseTuning", 0) };
    }
    const t = numOf(params, "zoneTune", 1);
    if (!isFinite(t) || t <= 0 || Math.abs(t - 1) < 1e-9) return { fine: 0, coarse: 0 };
    let cents = Math.round(1200 * Math.log(t) / Math.LN2);
    if (!isFinite(cents)) return { fine: 0, coarse: 0 };
    const coarse = Math.trunc(cents / 100);
    const fine = cents - coarse * 100;
    return { fine: fine, coarse: coarse };
  }

  function parseLegacyXml(text, tailText) {
    const out = { name: "", author: "", zones: [], samples: [], refs: [], warnings: [] };
    try {
      // soundinfo block: properties/name + properties/author (first match wins)
      const nameM = /<properties\b[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>/.exec(text);
      if (nameM) out.name = unescapeXml(nameM[1]).trim();
      const authM = /<properties\b[^>]*>[\s\S]*?<author>([\s\S]*?)<\/author>/.exec(text);
      if (authM) out.author = unescapeXml(authM[1]).trim();
      if ((!out.name || !out.author) && typeof tailText === "string" && tailText) {
        if (!out.name) {
          const m2 = /<properties\b[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>/.exec(tailText);
          if (m2) out.name = unescapeXml(m2[1]).trim();
        }
        if (!out.author) {
          const m3 = /<properties\b[^>]*>[\s\S]*?<author>([\s\S]*?)<\/author>/.exec(tailText);
          if (m3) out.author = unescapeXml(m3[1]).trim();
        }
      }
      if (!out.name) {
        const pm = /<(?:K2_Program|NiSS_Program)\b[^>]*\bname\s*=\s*"([^"]*)"/.exec(text);
        if (pm) out.name = unescapeXml(pm[1]).trim();
      }

      // zone elements: K2 era and K1/NiSS era names
      const zre = /<(K2_Zone|NiSS_Zone)\b/g;
      let zm = zre.exec(text);
      let count = 0;
      while (zm && count < MAX_ZONES) {
        const zoneTag = zm[1];
        const openStart = zm.index;
        const openEnd = text.indexOf(">", openStart);
        if (openEnd < 0) break;
        let bodyStart = openEnd + 1;
        const closeIdx = text.indexOf("</" + zoneTag + ">", bodyStart);
        let bodyEnd = closeIdx >= 0 ? closeIdx : text.length;
        const nextZone = text.indexOf("<" + zoneTag, bodyStart);
        if (nextZone >= 0 && nextZone < bodyEnd && closeIdx < 0) bodyEnd = nextZone;
        if (bodyEnd - openStart > 65536) bodyEnd = openStart + 65536;
        const body = text.slice(bodyStart, bodyEnd);
        const params = {};
        collectTagParams(text.slice(openStart, openEnd + 1), body, params);
        const tune = deriveTuning(params);

        // sample element inside the zone
        let fileName = "";
        let filePath = "";
        let slength = 0, srate = 0, sbits = 0;
        const sIdx = body.indexOf("<Sample");
        if (sIdx >= 0) {
          const sOpenEnd = body.indexOf(">", sIdx);
          if (sOpenEnd >= 0) {
            const sClose = body.indexOf("</Sample>", sOpenEnd);
            const sBodyEnd = sClose >= 0 ? sClose : Math.min(body.length, sOpenEnd + 4096);
            const sBody = body.slice(sOpenEnd + 1, sBodyEnd);
            const sparams = {};
            collectTagParams(body.slice(sIdx, sOpenEnd + 1), sBody, sparams);
            let raw = sparams.file_ex2;
            if (typeof raw !== "string") raw = sparams.file_ex;
            if (typeof raw !== "string") raw = sparams.file;
            if (typeof raw === "string" && raw) {
              filePath = decodeEncodedPath(raw);
              fileName = leafName(filePath);
              slength = intOf(sparams, "sampleLength", intOf(params, "sampleLength", 0));
              srate = intOf(sparams, "sampleRate", intOf(params, "sampleRate", 0));
              sbits = intOf(sparams, "bitsPerSample", intOf(params, "bitsPerSample", 0));
            }
          }
        }

        let sidx = -1;
        if (fileName) {
          if (out.samples.length < MAX_SAMPLES) {
            const key = filePath.toLowerCase();
            sidx = -1;
            for (let i = 0; i < out.samples.length; i++) {
              if (out.samples[i].filePath.toLowerCase() === key) { sidx = i; break; }
            }
            if (sidx < 0) {
              sidx = out.samples.length;
              out.samples.push({ ref: sidx, fileName: short(fileName, 256), filePath: short(filePath, 512), length: slength, rate: srate, bits: sbits });
            }
          } else {
            out.warnings.push("sample list capped at " + MAX_SAMPLES);
          }
        }
        out.zones.push({
          keyLow: intOf(params, "lowKey", 0),
          keyHigh: intOf(params, "highKey", 127),
          key: intOf(params, "rootKey", intOf(params, "lowKey", 0)),
          fineTuning: tune.fine,
          coarseTuning: tune.coarse,
          volumeAdjust: numOf(params, "zoneVolume", 1),
          sampleStart: intOf(params, "sampleStart", 0),
          sampleEnd: intOf(params, "sampleEnd", 0),
          velocityLow: intOf(params, "lowVelocity", 1),
          velocityHigh: intOf(params, "highVelocity", 127),
          flags: intOf(params, "flags", 0),
          sampleIndex: typeof params.sampleIndex === "string" ? intOf(params, "sampleIndex", sidx) : sidx
        });
        count += 1;
        zm = zre.exec(text);
        if (zre.lastIndex <= openStart) break;
      }
      if (count >= MAX_ZONES) out.warnings.push("zone list capped at " + MAX_ZONES);

      // refs: from the parsed zones plus a file-attribute sweep (the sweep is
      // limited to file_ex2 / file_ex, and to file only when no zones were
      // recognized, so unrelated XML never floods the list).
      const seen = {};
      for (let i = 0; i < out.samples.length; i++) {
        const key = (out.samples[i].filePath || out.samples[i].fileName).toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        out.refs.push({ name: short(out.samples[i].fileName, 200), path: short(out.samples[i].filePath, 512) });
      }
      const sweep = count === 0 ? /(?:file_ex2|file_ex|file)\s*=\s*"([^"]*)"/g : /(?:file_ex2|file_ex)\s*=\s*"([^"]*)"/g;
      let fm = sweep.exec(text);
      while (fm && out.refs.length < MAX_REFS) {
        const raw = fm[1];
        if (raw) {
          const path = decodeEncodedPath(raw);
          const key = path.toLowerCase();
          if (path && !seen[key]) {
            seen[key] = true;
            out.refs.push({ name: short(leafName(path), 200), path: short(path, 512) });
          }
        }
        fm = sweep.exec(text);
      }
      if (out.refs.length >= MAX_REFS) out.warnings.push("ref list capped at " + MAX_REFS);
      if (!count) out.warnings.push("zone structure not recognized; refs extracted only");
    } catch (e) {
      out.warnings.push("xml scan failed");
    }
    return out;
  }

  async function parseLegacy(b, hint) {
    const off = findLegacyOffset(b);
    if (off < 0) {
      return { ok: false, kind: "legacy", encrypted: false, error: "no zlib stream at 0xAA or 0x24" };
    }
    const inf = await inflateLegacy(b.subarray(off));
    if (!inf.ok) {
      return { ok: false, kind: "legacy", encrypted: false, error: inf.error };
    }
    if (inf.bytes.length < 8) {
      return { ok: false, kind: "legacy", encrypted: false, error: "inflated payload too small" };
    }
    let text = "";
    try {
      const capped = inf.bytes.length > MAX_XML ? inf.bytes.subarray(0, MAX_XML) : inf.bytes;
      text = bytesToText(capped, 0);
    } catch (e) {
      return { ok: false, kind: "legacy", encrypted: false, error: "xml decode failed" };
    }
    let tailText = "";
    try {
      if (b.length > off) {
        const tailLen = Math.min(b.length - off, 262144);
        const tail = b.subarray(Math.max(0, b.length - tailLen));
        tailText = bytesToText(tail, 0);
      }
    } catch (e) { /* best effort */ }
    const xml = parseLegacyXml(text, tailText);
    return {
      ok: true,
      kind: "legacy",
      encrypted: false,
      error: "",
      name: short(xml.name, 200),
      author: short(xml.author, 200),
      samples: xml.samples,
      zones: xml.zones,
      refs: xml.refs,
      warnings: xml.warnings
    };
  }

  // ------------------------------------------------------------------
  // detection + public entry points
  // ------------------------------------------------------------------

  function detectKind(b, hint) {
    try {
      if (b.length >= 16 && b[HSIN_AT] === 0x68 && b[HSIN_AT + 1] === 0x73 && b[HSIN_AT + 2] === 0x69 && b[HSIN_AT + 3] === 0x6E) {
        return { kind: "container", offset: 0 };
      }
      const off = findLegacyOffset(b);
      if (off >= 0) return { kind: "legacy", offset: off };
    } catch (e) { /* ignore */ }
    return { kind: "", offset: -1 };
  }

  function probeInner(b, hint) {
    const det = detectKind(b, hint);
    if (det.kind === "container") {
      let encrypted = false;
      let failed = false;
      try {
        const st = walkContainer(b);
        encrypted = st.encrypted === true;
        if (st.items === 0) failed = true;
      } catch (e) {
        failed = true;
      }
      if (failed) {
        return { ok: false, kind: "container", encrypted: false, error: "container walk failed" };
      }
      return { ok: true, kind: "container", encrypted: encrypted, error: "" };
    }
    if (det.kind === "legacy") {
      return { ok: true, kind: "legacy", encrypted: false, error: "" };
    }
    return { ok: false, kind: "", encrypted: false, error: "unrecognized NI file" };
  }

  function probe(input, hint) {
    try {
      const b = toBytes(input);
      if (!b || !b.length) return { ok: false, kind: "", encrypted: false, error: "no bytes" };
      if (b.length < 16) return { ok: false, kind: "", encrypted: false, error: "too small" };
      const h = (typeof hint === "string") ? hint.toLowerCase().replace(/^\./, "") : "";
      return probeInner(b, h);
    } catch (e) {
      return { ok: false, kind: "", encrypted: false, error: "probe failed" };
    }
  }

  // Single-container re-read used by parse() so refs and metadata come from one
  // consistent walk.
  function parseContainerReceipt(b, hint) {
    try {
      return parseContainer(b, hint);
    } catch (e) {
      return { ok: false, kind: (hint === "nbkt") ? "nbkt" : "container", encrypted: false, error: UNREAD };
    }
  }

  function parse(input, hint) {
    return new Promise(function (resolve) {
      let done = false;
      function finish(r) {
        if (done) return;
        done = true;
        try { resolve(r); } catch (e) { /* ignore */ }
      }
      try {
        const b = toBytes(input);
        if (!b || !b.length) { finish({ ok: false, kind: "", encrypted: false, error: "no bytes" }); return; }
        if (b.length > MAX_INPUT) { finish({ ok: false, kind: "", encrypted: false, error: "file too large" }); return; }
        const h = (typeof hint === "string") ? hint.toLowerCase().replace(/^\./, "") : "";
        const det = detectKind(b, h);
        if (det.kind === "container") {
          finish(parseContainerReceipt(b, h));
          return;
        }
        if (det.kind === "legacy") {
          parseLegacy(b, h).then(function (r) {
            finish(r);
          }, function () {
            finish({ ok: false, kind: "legacy", encrypted: false, error: "legacy parse failed" });
          });
          return;
        }
        finish({ ok: false, kind: "", encrypted: false, error: "unrecognized NI file" });
      } catch (e) {
        finish({ ok: false, kind: "", encrypted: false, error: "parse failed" });
      }
    });
  }

  // ------------------------------------------------------------------
  // exports
  // ------------------------------------------------------------------

  return {
    version: AV_NI_VERSION,
    probe: probe,
    parse: parse
  };
})();
