/* Anvil — ZIP byte codec (P6 'DELIVER' wave, sa-2): avZipBuild() writes a store-method (0) zip
   with local file headers, a central directory and an EOCD; avZipInfo() walks the central
   directory (names / sizes / count — no extraction); avZipCrc32() is the exposed CRC-32.

   Pins (verify/_p6_wave.md §2.2):
   - avZipBuild(entries, opts) -> ArrayBuffer | null
     entries: [{ name: string, data: ArrayBuffer | string }], order preserved; strings encode
     UTF-8 (entry data AND names). Store method only, no data descriptors, CRC-32 per entry,
     UTF-8 name flag (bit 11) on every header of an entry whose name is non-ASCII. No zip64:
     refuse (null) above 512 MB total, over 65535 entries, or on malformed entries.
   - opts.date: Date | number (epoch ms) | null. null / missing -> FIXED deterministic DOS
     timestamp 1980-01-01 00:00:00 (date 0x0021, time 0x0000) so two builds are byte-identical;
     a real date is clamped to 1980..2107 (the DOS epoch range).
   - avZipInfo(buf) -> { ok, count, names, sizes, bytes, crcs, offsets } | { ok:false, error }
     Finds the EOCD (backwards scan, comment-aware), parses the central directory; names decode
     as UTF-8 when the entry's bit 11 is set, else as code page 1252 / Latin-1.
   - avZipCrc32(u8) -> number — standard CRC-32 (poly 0xEDB88320, init/final 0xFFFFFFFF);
     accepts a Uint8Array / ArrayBuffer / any view; invalid input -> 0 (documented, never throws).

   Byte laws: little-endian everywhere; DOS time = (h<<11)|(m<<5)|(s>>1), DOS date =
   ((y-1980)<<9)|(m<<5)|d; archive layout = [local header + name + data]* + [central entry +
   name]* + EOCD(22), all sizes exact u32/u16 fields. dither-free by construction: identical
   entries + identical (or null) date => bit-identical bytes.

   Craft laws: "use strict", classic script (no modules/imports), node-loadable (no DOM at load,
   no top-level side effects), one namespace (avZip prefixes + AV_ZIP_ consts), never throw. */
"use strict";

const AV_ZIP_VERSION = "p6.0";
const AV_ZIP_MAX_BYTES = 512 * 1024 * 1024;    /* §2.2: refuse (null) above 512 MB total */
const AV_ZIP_MAX_ENTRIES = 0xFFFF;             /* EOCD count fields are u16 (no zip64) */
const AV_ZIP_DOS_EPOCH_DATE = 0x0021;          /* 1980-01-01 (pin: 0x0021 / 0x0000) */
const AV_ZIP_DOS_EPOCH_TIME = 0x0000;          /* 00:00:00 */
const AV_ZIP_UTF8_FLAG = 0x0800;               /* general purpose bit 11 */
const AV_ZIP_U32_MAX = 0xFFFFFFFF;

/* ---------- input normalisers (never throw; null = honest refusal) ---------- */

function avZipBytes(x) {
  try {
    if (x == null) return null;
    if (typeof ArrayBuffer !== "undefined" && x instanceof ArrayBuffer) return new Uint8Array(x);
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(x)) {
      return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    }
    return null;
  } catch (e) { return null; }
}

/* ---------- UTF-8 (TextEncoder/Decoder when present, manual fallback otherwise) ---------- */

function avZipUtf8Manual(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let cp = str.charCodeAt(i);
    if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < str.length) {
      const lo = str.charCodeAt(i + 1);
      if (lo >= 0xDC00 && lo <= 0xDFFF) { cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00); i++; }
    }
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xC0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return new Uint8Array(out);
}

function avZipUtf8(str) {
  try {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
  } catch (e) { /* fall through to the manual encoder */ }
  return avZipUtf8Manual(str);
}

function avZipUtf8ManualDecode(b) {
  let s = "", i = 0;
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
  return s;
}

function avZipNameDecode(b, utf8) {
  try {
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder(utf8 ? "utf-8" : "windows-1252", { fatal: false }).decode(b);
    }
  } catch (e) { /* fall through to the manual decoder */ }
  if (utf8) return avZipUtf8ManualDecode(b);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

function avZipHasNonAscii(b) {
  for (let i = 0; i < b.length; i++) if (b[i] >= 0x80) return true;
  return false;
}

/* ---------- CRC-32 (lazy 256-entry table; poly 0xEDB88320) ---------- */

let avZipCrcTab = null;
function avZipCrcTable() {
  if (avZipCrcTab) return avZipCrcTab;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  avZipCrcTab = t;
  return t;
}

function avZipCrc32(u8) {
  try {
    const b = avZipBytes(u8);
    if (!b) return 0;
    const t = avZipCrcTable();
    let c = 0xFFFFFFFF;
    for (let i = 0; i < b.length; i++) c = (c >>> 8) ^ t[(c ^ b[i]) & 255];
    return (c ^ 0xFFFFFFFF) >>> 0;
  } catch (e) { return 0; }
}

/* ---------- DOS timestamp (fixed epoch for null; real dates clamped 1980..2107) ---------- */

function avZipDosStamp(d) {
  try {
    if (d === null || d === undefined) return { date: AV_ZIP_DOS_EPOCH_DATE, time: AV_ZIP_DOS_EPOCH_TIME };
    let dt = null;
    if (typeof d === "number" && isFinite(d)) dt = new Date(d);
    else if (Object.prototype.toString.call(d) === "[object Date]") dt = new Date(d.getTime());
    else return null;                                  /* bad type: honest refusal */
    if (!dt || !isFinite(dt.getTime())) return { date: AV_ZIP_DOS_EPOCH_DATE, time: AV_ZIP_DOS_EPOCH_TIME };
    if (dt.getFullYear() < 1980) dt = new Date(1980, 0, 1, 0, 0, 0);
    else if (dt.getFullYear() > 2107) dt = new Date(2107, 11, 31, 23, 59, 58);
    const date = (((dt.getFullYear() - 1980) & 0x7F) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate();
    const time = (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1);
    return { date: date, time: time };
  } catch (e) { return null; }
}

/* ---------- build: store-method zip, no data descriptors, CRCs in the headers ---------- */

function avZipBuild(entries, opts) {
  try {
    if (!Array.isArray(entries)) return null;
    if (entries.length > AV_ZIP_MAX_ENTRIES) return null;
    const o = (opts && typeof opts === "object") ? opts : null;
    const stamp = avZipDosStamp(o ? o.date : null);
    if (!stamp) return null;

    const items = [];
    let total = 22;                                        /* EOCD */
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e || typeof e !== "object") return null;
      if (typeof e.name !== "string" || !e.name.length) return null;
      const nb = avZipUtf8(e.name);
      if (!nb || !nb.length || nb.length > 0xFFFF) return null;
      let data = null;
      if (typeof e.data === "string") data = avZipUtf8(e.data);
      else data = avZipBytes(e.data);
      if (!data) return null;
      if (data.length > AV_ZIP_MAX_BYTES || data.length > AV_ZIP_U32_MAX) return null;
      items.push({ nb: nb, data: data, flags: avZipHasNonAscii(nb) ? AV_ZIP_UTF8_FLAG : 0, crc: 0 });
      total += 30 + nb.length + data.length + 46 + nb.length;   /* local + central + name x2 */
      if (total > AV_ZIP_MAX_BYTES) return null;                /* §2.2: > 512 MB total */
    }

    const buf = new ArrayBuffer(total);
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let p = 0;
    const u32 = (v) => { dv.setUint32(p, v >>> 0, true); p += 4; };
    const u16 = (v) => { dv.setUint16(p, v & 0xFFFF, true); p += 2; };
    const raw = (b) => { u8.set(b, p); p += b.length; };

    const locals = new Array(items.length);
    for (let i = 0; i < items.length; i++) items[i].crc = avZipCrc32(items[i].data);

    for (let i = 0; i < items.length; i++) {               /* local file headers + payload */
      const it = items[i];
      locals[i] = p;
      u32(0x04034B50); u16(20); u16(it.flags); u16(0);     /* sig, verNeeded 2.0, flags, store */
      u16(stamp.time); u16(stamp.date);
      u32(it.crc); u32(it.data.length); u32(it.data.length);
      u16(it.nb.length); u16(0);                           /* name len, extra len 0 */
      raw(it.nb); raw(it.data);
    }

    const cdOff = p;
    for (let i = 0; i < items.length; i++) {               /* central directory */
      const it = items[i];
      u32(0x02014B50); u16(20); u16(20); u16(it.flags); u16(0);
      u16(stamp.time); u16(stamp.date);
      u32(it.crc); u32(it.data.length); u32(it.data.length);
      u16(it.nb.length); u16(0); u16(0);                   /* name, extra, comment lens */
      u16(0); u16(0); u32(0);                              /* disk start, int attrs, ext attrs */
      u32(locals[i]);
      raw(it.nb);
    }
    const cdSize = p - cdOff;

    u32(0x06054B50); u16(0); u16(0);                       /* EOCD: sig, disk 0, cd disk 0 */
    u16(items.length); u16(items.length);
    u32(cdSize); u32(cdOff); u16(0);                       /* comment len 0 */
    if (p !== total) return null;                          /* internal sanity — unreachable */
    return buf;
  } catch (e) { return null; }
}

/* ---------- info: EOCD backwards scan + central directory walk (no extraction) ---------- */

function avZipInfo(buf) {
  try {
    const b = avZipBytes(buf);
    if (!b) return { ok: false, error: "unsupported buffer (ArrayBuffer|view required)" };
    const n = b.length;
    if (n < 22) return { ok: false, error: "too short for an EOCD" };
    const floor = Math.max(0, n - 22 - 0xFFFF);            /* max comment = 65535 */
    let eocd = -1;
    for (let i = n - 22; i >= floor; i--) {
      if (b[i] === 0x50 && b[i + 1] === 0x4B && b[i + 2] === 0x05 && b[i + 3] === 0x06) {
        const clen = b[i + 20] | (b[i + 21] << 8);
        if (i + 22 + clen === n) { eocd = i; break; }
      }
    }
    if (eocd < 0) return { ok: false, error: "no end-of-central-directory record" };
    const count = b[eocd + 10] | (b[eocd + 11] << 8);
    const cdSize = ((b[eocd + 12] | (b[eocd + 13] << 8) | (b[eocd + 14] << 16) | (b[eocd + 15] << 24)) >>> 0);
    const cdOff = ((b[eocd + 16] | (b[eocd + 17] << 8) | (b[eocd + 18] << 16) | (b[eocd + 19] << 24)) >>> 0);
    if (cdOff + cdSize > n) return { ok: false, error: "central directory out of range" };

    const names = [], sizes = [], crcs = [], offsets = [];
    let p = cdOff;
    for (let i = 0; i < count; i++) {
      if (p + 46 > n) return { ok: false, error: "central directory truncated" };
      if (!(b[p] === 0x50 && b[p + 1] === 0x4B && b[p + 2] === 0x01 && b[p + 3] === 0x02)) {
        return { ok: false, error: "central directory corrupt at entry " + i };
      }
      const flags = b[p + 8] | (b[p + 9] << 8);
      const crc = ((b[p + 16] | (b[p + 17] << 8) | (b[p + 18] << 16) | (b[p + 19] << 24)) >>> 0);
      const un = ((b[p + 24] | (b[p + 25] << 8) | (b[p + 26] << 16) | (b[p + 27] << 24)) >>> 0);
      const nlen = b[p + 28] | (b[p + 29] << 8);
      const elen = b[p + 30] | (b[p + 31] << 8);
      const clen = b[p + 32] | (b[p + 33] << 8);
      const loff = ((b[p + 42] | (b[p + 43] << 8) | (b[p + 44] << 16) | (b[p + 45] << 24)) >>> 0);
      if (p + 46 + nlen > n) return { ok: false, error: "central directory name truncated" };
      const name = avZipNameDecode(b.subarray(p + 46, p + 46 + nlen), !!(flags & AV_ZIP_UTF8_FLAG));
      names.push(name);
      sizes.push(un);
      crcs.push(crc);
      offsets.push(loff);
      p += 46 + nlen + elen + clen;
    }
    if (p > cdOff + cdSize + 65535) return { ok: false, error: "central directory overran its size" };
    return { ok: true, count: count, names: names, sizes: sizes, bytes: n, crcs: crcs, offsets: offsets };
  } catch (e) { return { ok: false, error: "zip parse failed" }; }
}
