/* Anvil -- ZIP reader, clean room (R16 wave, child A): AVZIP.probe / .list / .extract.

   Scope: reading only, for the import pre-pass (src/av_import.js) and anything
   else that needs bytes out of an archive. STORED (method 0) and DEFLATE
   (method 8, raw deflate) entries; no zip64, no multi-disk, no encryption.

   Pins (verify/_r16_wave.md section 4.1):
   - AVZIP.probe(u8OrArrayBuffer) -> { ok, entries, error? }   (sync)
     EOCD scan from the end (comment window 64 KiB back: 65535 + 22), then a
     central-directory walk; entries = NON-directory count.
   - AVZIP.list(u8OrArrayBuffer) -> { ok, entries: [{ name, dir, size,
     compressedSize, method, encrypted }], error? }             (sync)
     Sizes and methods from the central directory; dir = name ends with "/";
     order = central-directory order.
   - AVZIP.extract(u8OrArrayBuffer, index) -> Promise<{ ok, name, bytes:
     Uint8Array, warnings, error? }>
     index = position in list()'s entries array. STORED = verbatim bytes;
     DEFLATE = DecompressionStream("deflate-raw") (guarded; absent, or a
     build that refuses the format, = honest error). CRC32 of the output is
     compared against the central directory: mismatch adds the warning
     "crc32 mismatch" and the data is still returned. Refusals: "zip64 not
     supported" (0xFFFFFFFF size markers / zip64 EOCD / zip64 locator),
     "encrypted entry" (general purpose flag bit 0), "method <n> not
     supported", "entry too large" (extraction cap 96 MiB). Local-header
     offsets are honored for the data start; data-descriptor entries are fine
     (the central directory carries the real sizes).
   - Never throws: junk input -> ok:false + a short error. Error vocabulary:
     "bad input" | "not a zip" | "zip64 not supported" | "multi-disk zip not
     supported" | "unreadable central directory" | "bad entry index" |
     "encrypted entry" | "method <n> not supported" | "entry too large" |
     "truncated entry" | "bad local header" | "deflate not supported" |
     "inflate failed".

   Version note (pin conflict, source wins): the wave pin asked for a
   top-level AV_ZIP_VERSION "r16.0", but that exact name is already declared
   top-level in src/av_zipc.js (the P6 deliver ZIP writer, "p6.0"). Two
   top-level consts of the same name are a strict-mode duplicate-declaration
   boot killer once build.py concatenates the parts, so this reader ships
   its version as AV_ZIPR_VERSION ("r16.0"), mirrored on AVZIP.version.

   Laws: "use strict", ASCII-only source, classic script (no modules/imports),
   no DOM access (DecompressionStream and TextDecoder are API globals, looked
   up per call and feature-checked), one namespace (AVZIP), never throws. */
"use strict";

const AV_ZIPR_VERSION = "r16.0";

const AVZIP = (function () {

  /* ------------------------------------------------------------------ */
  /* constants                                                          */
  /* ------------------------------------------------------------------ */

  const EOCD_SIG = 0x06054B50;         /* end of central directory record */
  const CD_SIG = 0x02014B50;           /* central directory file header */
  const LFH_SIG = 0x04034B50;          /* local file header */
  const Z64_LOC_SIG = 0x07064B50;      /* zip64 EOCD locator */

  const EOCD_MIN = 22;                 /* EOCD size with an empty comment */
  const EOCD_COMMENT_MAX = 0xFFFF;     /* the comment length field is u16 */
  const CD_ENTRY_MIN = 46;             /* central entry, no name/extra/comment */
  const MAX_ENTRY = 96 * 1024 * 1024;  /* extraction cap per entry (pin) */
  const U32_FF = 0xFFFFFFFF;           /* zip64 sentinel in u32 fields */
  const U16_FF = 0xFFFF;               /* zip64 sentinel in u16 fields */

  const FLAG_ENCRYPTED = 0x0001;       /* general purpose bit 0 */
  const FLAG_UTF8 = 0x0800;            /* general purpose bit 11 */

  const METHOD_STORE = 0;
  const METHOD_DEFLATE = 8;

  /* ------------------------------------------------------------------ */
  /* input normalisation + little-endian readers (never throw)          */
  /* ------------------------------------------------------------------ */

  function asBytes(x) {
    try {
      if (x == null) return null;
      if (typeof ArrayBuffer !== "undefined" && x instanceof ArrayBuffer) return new Uint8Array(x);
      if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(x)) {
        return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }

  function u32(b, o) {
    return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  }

  /* ------------------------------------------------------------------ */
  /* name decoding: UTF-8 when flag bit 11 is set, latin-1 otherwise    */
  /* ------------------------------------------------------------------ */

  function utf8Manual(b, off, len) {
    let out = "";
    let i = off;
    const end = off + len;
    while (i < end) {
      const c = b[i++];
      if (c < 0x80) { out += String.fromCharCode(c); continue; }
      let cp = -1;
      let need = 0;
      if (c >= 0xC2 && c <= 0xDF) { cp = c & 0x1F; need = 1; }
      else if (c >= 0xE0 && c <= 0xEF) { cp = c & 0x0F; need = 2; }
      else if (c >= 0xF0 && c <= 0xF4) { cp = c & 0x07; need = 3; }
      if (cp < 0 || i + need > end) { out += "\uFFFD"; continue; }
      let bad = false;
      for (let k = 0; k < need; k++) {
        const cc = b[i + k];
        if ((cc & 0xC0) !== 0x80) { bad = true; break; }
        cp = (cp << 6) | (cc & 0x3F);
      }
      if (bad) { out += "\uFFFD"; continue; }
      i += need;
      if ((need === 1 && cp < 0x80)
          || (need === 2 && cp < 0x800)
          || (need === 3 && (cp < 0x10000 || cp > 0x10FFFF))
          || (cp >= 0xD800 && cp <= 0xDFFF)) {
        out += "\uFFFD";
        continue;
      }
      if (cp > 0xFFFF) {
        cp -= 0x10000;
        out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      } else {
        out += String.fromCharCode(cp);
      }
    }
    return out;
  }

  function decodeName(b, off, len, utf8) {
    if (utf8) {
      try {
        if (typeof TextDecoder === "function") return new TextDecoder("utf-8").decode(b.subarray(off, off + len));
      } catch (e) { /* fall through to the manual decoder */ }
      return utf8Manual(b, off, len);
    }
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(b[off + i]);
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* EOCD scan: signature sweep from the end, up to 64 KiB back          */
  /* ------------------------------------------------------------------ */

  function findEocd(b) {
    const len = b.length;
    if (len < EOCD_MIN) return -1;
    let minPos = len - EOCD_MIN - EOCD_COMMENT_MAX;
    if (minPos < 0) minPos = 0;
    for (let pos = len - EOCD_MIN; pos >= minPos; pos--) {
      if (b[pos] !== 0x50 || b[pos + 1] !== 0x4B || b[pos + 2] !== 0x05 || b[pos + 3] !== 0x06) continue;
      /* the real record's comment field ends the file exactly; a signature
         planted inside comment bytes fails this check, so the sweep keeps
         walking back instead of accepting it */
      if (pos + EOCD_MIN + u16(b, pos + 20) === len) return pos;
    }
    return -1;
  }

  /* ------------------------------------------------------------------ */
  /* archive parse: EOCD checks, then the central-directory walk         */
  /* ------------------------------------------------------------------ */

  function parseArchive(input) {
    const b = asBytes(input);
    if (!b) return { ok: false, error: "bad input" };
    if (b.length < EOCD_MIN) return { ok: false, error: "not a zip" };
    const eocd = findEocd(b);
    if (eocd < 0) return { ok: false, error: "not a zip" };
    if (eocd >= 20 && u32(b, eocd - 20) === Z64_LOC_SIG) return { ok: false, error: "zip64 not supported" };
    const diskNo = u16(b, eocd + 4);
    const cdDisk = u16(b, eocd + 6);
    const nThis = u16(b, eocd + 8);
    const nTotal = u16(b, eocd + 10);
    const cdSize = u32(b, eocd + 12);
    const cdOff = u32(b, eocd + 16);
    if (nThis === U16_FF || nTotal === U16_FF || cdSize === U32_FF || cdOff === U32_FF) {
      return { ok: false, error: "zip64 not supported" };
    }
    if (diskNo !== 0 || cdDisk !== 0 || nThis !== nTotal) {
      return { ok: false, error: "multi-disk zip not supported" };
    }
    if (cdOff + cdSize > eocd) return { ok: false, error: "unreadable central directory" };
    const entries = [];
    let p = cdOff;
    const end = cdOff + cdSize;
    for (let i = 0; i < nTotal; i++) {
      if (p + CD_ENTRY_MIN > end) return { ok: false, error: "unreadable central directory" };
      if (u32(b, p) !== CD_SIG) return { ok: false, error: "unreadable central directory" };
      const flags = u16(b, p + 8);
      const method = u16(b, p + 10);
      const crc = u32(b, p + 16);
      const csize = u32(b, p + 20);
      const usize = u32(b, p + 24);
      const nlen = u16(b, p + 28);
      const elen = u16(b, p + 30);
      const clen = u16(b, p + 32);
      if (p + CD_ENTRY_MIN + nlen + elen + clen > end) return { ok: false, error: "unreadable central directory" };
      const name = decodeName(b, p + CD_ENTRY_MIN, nlen, (flags & FLAG_UTF8) !== 0);
      entries.push({
        name: name,
        dir: name.length > 0 && name.charAt(name.length - 1) === "/",
        size: usize,
        compressedSize: csize,
        method: method,
        encrypted: (flags & FLAG_ENCRYPTED) !== 0,
        crc: crc,
        localOff: u32(b, p + 42)
      });
      p += CD_ENTRY_MIN + nlen + elen + clen;
    }
    return { ok: true, b: b, entries: entries };
  }

  /* ------------------------------------------------------------------ */
  /* CRC-32 (poly 0xEDB88320, init/final 0xFFFFFFFF)                     */
  /* ------------------------------------------------------------------ */

  let crcTab = null;

  function crcTable() {
    if (crcTab) return crcTab;
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    crcTab = t;
    return t;
  }

  function crc32(b) {
    const t = crcTable();
    let c = -1;
    for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  /* ------------------------------------------------------------------ */
  /* raw-deflate inflate: guarded DecompressionStream, output-capped     */
  /* ------------------------------------------------------------------ */

  function inflateRaw(comp) {
    return new Promise(function (resolve) {
      let settled = false;
      function done(res) { if (!settled) { settled = true; resolve(res); } }

      let DS = null;
      try { if (typeof DecompressionStream === "function") DS = DecompressionStream; } catch (e0) { DS = null; }
      if (!DS) { done({ ok: false, error: "deflate not supported" }); return; }
      let ds = null;
      try { ds = new DS("deflate-raw"); }
      catch (e1) { done({ ok: false, error: "deflate not supported" }); return; }
      let writer = null;
      let reader = null;
      try {
        writer = ds.writable.getWriter();
        reader = ds.readable.getReader();
      } catch (e2) { done({ ok: false, error: "deflate not supported" }); return; }

      const chunks = [];
      let total = 0;

      function pumpRead() {
        return reader.read().then(function (q) {
          if (q.done || settled) return null;
          total += q.value.length;
          if (total > MAX_ENTRY) {
            done({ ok: false, error: "entry too large" });
            let cp = null;
            try { cp = reader.cancel(); } catch (e3) { cp = null; }
            if (cp && typeof cp.catch === "function") cp.catch(function () { return null; });
            return null;
          }
          chunks.push(q.value);
          return pumpRead();
        }, function () {
          done({ ok: false, error: "inflate failed" });
          return null;
        });
      }

      function pushData() {
        return writer.write(comp).then(function () {
          return writer.close();
        }).then(function () {
          return null;
        }, function () {
          return null;
        });
      }

      const readDone = pumpRead();
      const writeDone = pushData();

      Promise.all([readDone, writeDone]).then(function () {
        if (settled) return;
        const out = new Uint8Array(total);
        let off = 0;
        for (let i = 0; i < chunks.length; i++) {
          out.set(chunks[i], off);
          off += chunks[i].length;
        }
        done({ ok: true, bytes: out });
      }, function () {
        done({ ok: false, error: "inflate failed" });
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* public: probe / list / extract                                      */
  /* ------------------------------------------------------------------ */

  function probe(input) {
    try {
      const r = parseArchive(input);
      if (!r.ok) return { ok: false, entries: 0, error: r.error };
      let n = 0;
      for (let i = 0; i < r.entries.length; i++) if (!r.entries[i].dir) n++;
      return { ok: true, entries: n };
    } catch (e) {
      return { ok: false, entries: 0, error: "unreadable zip" };
    }
  }

  function list(input) {
    try {
      const r = parseArchive(input);
      if (!r.ok) return { ok: false, entries: [], error: r.error };
      const out = [];
      for (let i = 0; i < r.entries.length; i++) {
        const e = r.entries[i];
        out.push({
          name: e.name,
          dir: e.dir,
          size: e.size,
          compressedSize: e.compressedSize,
          method: e.method,
          encrypted: e.encrypted
        });
      }
      return { ok: true, entries: out };
    } catch (e2) {
      return { ok: false, entries: [], error: "unreadable zip" };
    }
  }

  function extract(input, index) {
    return new Promise(function (resolve) {
      try {
        const r = parseArchive(input);
        if (!r.ok) {
          resolve({ ok: false, name: "", bytes: new Uint8Array(0), warnings: [], error: r.error });
          return;
        }
        const entries = r.entries;
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= entries.length) {
          resolve({ ok: false, name: "", bytes: new Uint8Array(0), warnings: [], error: "bad entry index" });
          return;
        }
        const e = entries[index];

        function fail(error) {
          resolve({ ok: false, name: e.name, bytes: new Uint8Array(0), warnings: [], error: error });
        }

        function finish(data) {
          const warnings = [];
          if (crc32(data) !== e.crc) warnings.push("crc32 mismatch");
          resolve({ ok: true, name: e.name, bytes: data, warnings: warnings });
        }

        if (e.encrypted) { fail("encrypted entry"); return; }
        if (e.size === U32_FF || e.compressedSize === U32_FF) { fail("zip64 not supported"); return; }
        if (e.method !== METHOD_STORE && e.method !== METHOD_DEFLATE) {
          fail("method " + e.method + " not supported");
          return;
        }
        if (e.size > MAX_ENTRY || e.compressedSize > MAX_ENTRY) { fail("entry too large"); return; }

        const b = r.b;
        const lho = e.localOff;
        if (lho + 30 > b.length) { fail("truncated entry"); return; }
        if (u32(b, lho) !== LFH_SIG) { fail("bad local header"); return; }
        const lnlen = u16(b, lho + 26);
        const lelen = u16(b, lho + 28);
        const dstart = lho + 30 + lnlen + lelen;
        if (dstart + e.compressedSize > b.length) { fail("truncated entry"); return; }

        if (e.method === METHOD_STORE) {
          finish(b.slice(dstart, dstart + e.compressedSize));
          return;
        }
        inflateRaw(b.subarray(dstart, dstart + e.compressedSize)).then(function (inf) {
          if (!inf.ok) { fail(inf.error); return; }
          finish(inf.bytes);
        }, function () {
          fail("inflate failed");
        });
      } catch (err) {
        resolve({ ok: false, name: "", bytes: new Uint8Array(0), warnings: [], error: "unreadable zip" });
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* exports                                                            */
  /* ------------------------------------------------------------------ */

  return {
    version: AV_ZIPR_VERSION,
    probe: probe,
    list: list,
    extract: extract
  };
})();
