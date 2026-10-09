/* Anvil — WAV byte codec (P6 'DELIVER' wave, sa-2): avWavEncode() writes a stereo RIFF/WAVE file
   at 16-bit PCM, 24-bit PCM or 32-bit IEEE float; avWavInfo() parses the RIFF header of this
   module's own output AND of foreign 16/24/32f/64f WAVs (rigs/harnesses use it as the decoder);
   avWavDecodeF64() reads 64-bit IEEE-float WAVs (R16 wave - read-only, tag 3, LE doubles).

   Pins (verify/_p6_wave.md §2.1):
   - avWavEncode({ l, r, sr, bits = 24, dither = "auto" }) -> ArrayBuffer | null
     l/r: equal-length Float32Arrays (both required, stereo only). sr: any positive number
     (missing/null -> 48000, the engine's native house rate; values are rounded for the header).
     bits: 16 | 24 | "32f" (numeric 32 tolerated as "32f"). 16/24 = PCM int LE with fmt tag 1 and
     blockAlign = ch x bits/8; 32f = IEEE float, tag 3. dither: true | false | "auto" —
     auto = on for 16, off for 24/32f; never applied to 32f (dither:true is ignored there).
     TPDF = two independent uniform draws summed to ±1 LSB peak (d = r1 - r2, in LSBs), applied
     BEFORE rounding for PCM. Invalid input -> null (never throws).
   - avWavInfo(buf) -> { ok, sampleRate, channels, bits, format, formatTag, float, frames,
     dataBytes, bytes, dataOffset, blockAlign, byteRate } | { ok:false, error }
     format = "pcm" | "float"; bits = the header's bitsPerSample (16/24 pcm; 32/64 float - R16
     wave: IEEE-float tag 3 at 64 bits is accepted for READ; other float depths stay refused and
     the encoder never writes them). Refuses honestly
     (ok:false) on non-RIFF/WAVE, missing fmt/data, unsupported tags or bit depths. A data chunk
     claiming more bytes than the buffer holds is clamped to what is actually there.
   - avWavDecodeF64(buf) -> { ok, channels, sampleRate, frames, bits: 64, float: true,
     ch1: Float32Array, ch2: Float32Array|null, warnings, error }   (verify/_r16_wave.md 4.2)
     Reads a 64-bit IEEE-float WAVE: the module's own chunk walk to data, little-endian doubles
     to planar Float32 (non-finite and f32-overflow doubles -> 0); mono -> ch1 only, ch2 null;
     a truncated data chunk is clamped to whole frames and warned; error = "" when ok.
     Never throws.
   - avWavMeta(buf) -> { ok, tempo, root, key, source: string[], warnings: string[], error }
     (K wave KL, verify/_k_wave.md section 4): read-only metadata chunk walk (iXML / acid /
     id3 / bext) on the avWavInfo discipline - never throws, clamps, honest refusal
     (ok:false + error for a non-RIFF/WAVE buffer). The section comment below pins the chunk
     layouts, the sanity clamps (tempo 20..300 else dropped; numeric root 0..127 else
     dropped) and the first-wins precedence. The import fold (av_import.js) is the caller.

   Byte laws (house discipline, av_rec.js header + writer): little-endian everywhere; 16-bit
   sample law = clamp(round(v * 32767), -32768, 32767) with NaN -> 0; 24-bit scales by 8388607
   (clamp -8388608..8388607); 32f writes finite values verbatim (non-finite -> 0) so a float
   round-trip through dataOffset is bit-exact. dither:false is bit-exact by construction; dithered
   output is intentionally stochastic (harness asserts bounds + mean, never bit-equality).

   Craft laws: "use strict", classic script (no modules/imports), node-loadable (no DOM at load,
   no top-level side effects), one namespace (avWav prefixes + AV_WAV_ consts), never throw. */
"use strict";

const AV_WAV_VERSION = "p6.0";
const AV_WAV_CHANNELS = 2;               /* the engine is stereo; the encoder accepts nothing else */
const AV_WAV_DEFAULT_BITS = 24;          /* §2.1 pin */
const AV_WAV_SR_DEFAULT = 48000;         /* house native rate (av_rec.js: "RATE: 48 kHz native") */
const AV_WAV_U32_MAX = 0xFFFFFFFF;       /* chunk/field ceiling for u32 headers */

/* ---------- input normalisers (never throw; null = honest refusal) ---------- */

function avWavBytes(buf) {
  try {
    if (buf == null) return null;
    if (typeof ArrayBuffer !== "undefined" && buf instanceof ArrayBuffer) return new Uint8Array(buf);
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(buf)) {
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    return null;
  } catch (e) { return null; }
}

function avWavChan(x) {
  try {
    if (x == null) return null;
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(x)) {
      return (typeof x.length === "number") ? x : null;
    }
    /* plain arrays are tolerated (read-only, index + length) */
    return (typeof x.length === "number") ? x : null;
  } catch (e) { return null; }
}

function avWavNormBits(bits) {
  if (bits === 16 || bits === 24) return bits;
  if (bits === 32) return "32f";
  if (typeof bits === "string") {
    const t = bits.trim().toLowerCase();
    if (t === "16") return 16;
    if (t === "24") return 24;
    if (t === "32" || t === "32f") return "32f";
  }
  return null;
}

function avWavNormDither(dither, bits) {
  if (dither === undefined || dither === null || dither === "auto") return bits === 16;
  if (dither === true || dither === false) return dither && bits !== "32f";   /* never for 32f */
  return null;
}

/* ---------- sample laws ---------- */

function avWavClamp1(v) {                       /* clamp to [-1, 1]; NaN / non-finite -> 0 */
  if (!(v >= -1 && v <= 1)) return v > 1 ? 1 : (v < -1 ? -1 : 0);
  return v;
}

function avWavTpdf() {                          /* TPDF: d = r1 - r2 in (-1, +1) LSBs, ±1 peak */
  return Math.random() - Math.random();
}

function avWavFinite(v) {                       /* 32f: finite verbatim; non-finite -> 0 */
  return (typeof v === "number" && isFinite(v)) ? v : 0;
}

function avWavErrMsg(e) {
  try { return String((e && (e.message || e.name)) || e) || "unknown error"; }
  catch (e2) { return "unknown error"; }
}

/* ---------- encode: RIFF/WAVE, 44-byte canonical header (no fact chunk), data last ---------- */

function avWavEncode(opts) {
  try {
    if (!opts || typeof opts !== "object") return null;
    const l = avWavChan(opts.l), r = avWavChan(opts.r);
    if (!l || !r) return null;
    const frames = l.length;
    if (frames !== r.length || !(frames >= 1)) return null;                /* empty / mismatched */
    const srRaw = (opts.sr === undefined || opts.sr === null) ? AV_WAV_SR_DEFAULT : Number(opts.sr);
    const sr = Math.round(srRaw);
    if (!isFinite(sr) || sr <= 0 || sr > AV_WAV_U32_MAX) return null;
    const bits = avWavNormBits(opts.bits === undefined ? AV_WAV_DEFAULT_BITS : opts.bits);
    if (bits === null) return null;
    const dither = avWavNormDither(opts.dither, bits);
    if (dither === null) return null;

    const float = (bits === "32f");
    const bytesPer = float ? 4 : (bits >> 3);
    const ch = AV_WAV_CHANNELS;
    const bps = float ? 32 : bits;
    const dataBytes = frames * ch * bytesPer;
    const blockAlign = ch * bytesPer;
    const byteRate = sr * blockAlign;
    if (dataBytes > AV_WAV_U32_MAX || byteRate > AV_WAV_U32_MAX) return null;

    const buf = new ArrayBuffer(44 + dataBytes);
    const dv = new DataView(buf);
    let o = 0;
    const u32 = (v) => { dv.setUint32(o, v >>> 0, true); o += 4; };
    const u16 = (v) => { dv.setUint16(o, v & 0xffff, true); o += 2; };
    const tag = (s) => {
      dv.setUint8(o++, s.charCodeAt(0) & 255); dv.setUint8(o++, s.charCodeAt(1) & 255);
      dv.setUint8(o++, s.charCodeAt(2) & 255); dv.setUint8(o++, s.charCodeAt(3) & 255);
    };
    tag("RIFF"); u32(36 + dataBytes); tag("WAVE");
    tag("fmt "); u32(16); u16(float ? 3 : 1); u16(ch); u32(sr);
    u32(byteRate); u16(blockAlign); u16(bps);
    tag("data"); u32(dataBytes);
    /* o === 44 — canonical 44-byte header, exactly as av_rec.js writes its 16-bit sibling */

    if (float) {
      for (let i = 0; i < frames; i++) {
        dv.setFloat32(o, avWavFinite(l[i]), true); o += 4;
        dv.setFloat32(o, avWavFinite(r[i]), true); o += 4;
      }
      return buf;
    }
    if (bits === 16) {
      for (let i = 0; i < frames; i++) {
        const xl = avWavClamp1(l[i]) * 32767 + (dither ? avWavTpdf() : 0);
        const xr = avWavClamp1(r[i]) * 32767 + (dither ? avWavTpdf() : 0);
        dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(xl))), true); o += 2;
        dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(xr))), true); o += 2;
      }
      return buf;
    }
    /* 24-bit PCM int LE, two's complement */
    for (let i = 0; i < frames; i++) {
      const ql = Math.max(-8388608, Math.min(8388607, Math.round(avWavClamp1(l[i]) * 8388607 + (dither ? avWavTpdf() : 0))));
      const qr = Math.max(-8388608, Math.min(8388607, Math.round(avWavClamp1(r[i]) * 8388607 + (dither ? avWavTpdf() : 0))));
      dv.setUint8(o++, ql & 255); dv.setUint8(o++, (ql >> 8) & 255); dv.setUint8(o++, (ql >> 16) & 255);
      dv.setUint8(o++, qr & 255); dv.setUint8(o++, (qr >> 8) & 255); dv.setUint8(o++, (qr >> 16) & 255);
    }
    return buf;
  } catch (e) { return null; }
}

/* ---------- parse: own files + foreign 16/24/32f WAVs (chunk walker, extensible fmt aware) ---------- */

function avWavInfo(buf) {
  try {
    const u8 = avWavBytes(buf);
    if (!u8) return { ok: false, error: "unsupported buffer (ArrayBuffer|view required)" };
    const n = u8.length;
    if (n < 12) return { ok: false, error: "too short for a RIFF header" };
    if (!(u8[0] === 82 && u8[1] === 73 && u8[2] === 70 && u8[3] === 70)) return { ok: false, error: "missing RIFF tag" };
    if (!(u8[8] === 87 && u8[9] === 65 && u8[10] === 86 && u8[11] === 69)) return { ok: false, error: "not a WAVE file" };

    const dv = new DataView(u8.buffer, u8.byteOffset, n);
    let fmt = null, dataOff = -1, dataSize = 0;
    let o = 12;
    while (o + 8 <= n) {
      const id0 = u8[o], id1 = u8[o + 1], id2 = u8[o + 2], id3 = u8[o + 3];
      const size = dv.getUint32(o + 4, true);
      const body = o + 8;
      if (id0 === 102 && id1 === 109 && id2 === 116 && id3 === 32) {           /* "fmt " */
        if (size >= 16 && body + 16 <= n) {
          let tag = dv.getUint16(body, true);
          const channels = dv.getUint16(body + 2, true);
          const sampleRate = dv.getUint32(body + 4, true);
          const byteRate = dv.getUint32(body + 8, true);
          const blockAlign = dv.getUint16(body + 12, true);
          const bits = dv.getUint16(body + 14, true);
          /* WAVE_FORMAT_EXTENSIBLE: the real tag is the first u16 of the SubFormat GUID */
          if (tag === 0xFFFE && size >= 40 && body + 26 <= n) tag = dv.getUint16(body + 24, true);
          fmt = { tag, channels, sampleRate, byteRate, blockAlign, bits };
        }
      } else if (id0 === 100 && id1 === 97 && id2 === 116 && id3 === 97 && dataOff < 0) {   /* "data" */
        dataOff = body;
        dataSize = (size <= n - body) ? size : Math.max(0, n - body);          /* tolerate truncation */
      }
      if (size > n) break;                                                     /* implausible: stop walking */
      o = body + size + (size & 1);                                            /* RIFF chunks pad to even */
    }
    if (!fmt) return { ok: false, error: "missing fmt chunk" };
    if (dataOff < 0) return { ok: false, error: "missing data chunk" };
    if (!(fmt.channels >= 1 && fmt.channels <= 2)) return { ok: false, error: "unsupported channels: " + fmt.channels };
    let format = null;
    if (fmt.tag === 1) format = "pcm";
    else if (fmt.tag === 3) format = "float";
    else return { ok: false, error: "unsupported format tag: " + fmt.tag };
    if (format === "pcm" && !(fmt.bits === 16 || fmt.bits === 24)) return { ok: false, error: "unsupported pcm bits: " + fmt.bits };
    if (format === "float" && !(fmt.bits === 32 || fmt.bits === 64)) return { ok: false, error: "unsupported float bits: " + fmt.bits };
    if (fmt.sampleRate <= 0) return { ok: false, error: "invalid sample rate: " + fmt.sampleRate };

    const bytesPer = fmt.bits >> 3;
    const frameBytes = fmt.channels * bytesPer;
    const frames = Math.floor(dataSize / frameBytes);
    const blockAlign = fmt.blockAlign || frameBytes;
    const byteRate = fmt.byteRate || (fmt.sampleRate * blockAlign);
    return {
      ok: true,
      sampleRate: fmt.sampleRate,
      channels: fmt.channels,
      bits: fmt.bits,
      format: format,
      formatTag: fmt.tag,
      float: format === "float",
      frames: frames,
      dataBytes: dataSize,
      bytes: n,
      dataOffset: dataOff,
      blockAlign: blockAlign,
      byteRate: byteRate,
    };
  } catch (e) { return { ok: false, error: avWavErrMsg(e) }; }
}

/* ---------- R16 wave: 64-bit IEEE float read, LE doubles -> planar Float32 (never throws) ------ */

function avWavF64To32(v) {                   /* f64 -> f32 value; non-finite / f32 overflow -> 0 */
  const x = Math.fround(v);
  return (x >= -3.4028234663852886e38 && x <= 3.4028234663852886e38) ? x : 0;
}

function avWavDecodeF64(buf) {
  const res = {
    ok: false, channels: 0, sampleRate: 0, frames: 0, bits: 64, float: true,
    ch1: null, ch2: null, warnings: [], error: "",
  };
  try {
    const u8 = avWavBytes(buf);
    if (!u8) { res.error = "unsupported buffer (ArrayBuffer|view required)"; return res; }
    const info = avWavInfo(u8);              /* the module's own walker: fmt/data + truncation clamp */
    if (!info.ok) { res.error = info.error; return res; }
    if (!(info.float === true && info.bits === 64)) {
      res.error = "not 64-bit IEEE float (tag " + info.formatTag + ", " + info.bits + " bits)";
      return res;
    }
    const ch = info.channels;
    const frames = info.frames;
    const frameBytes = ch * 8;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.length);
    /* truncation honesty: the data chunk's declared size sits just before dataOffset */
    if (info.dataOffset >= 4) {
      const declared = dv.getUint32(info.dataOffset - 4, true);
      const avail = u8.length - info.dataOffset;
      if (declared > avail) res.warnings.push("data chunk truncated (" + avail + " of " + declared + " bytes)");
      else if (declared % frameBytes !== 0) res.warnings.push("data chunk ends mid-frame");
    }
    const ch1 = new Float32Array(frames);
    const ch2 = (ch === 2) ? new Float32Array(frames) : null;
    let pos = info.dataOffset;
    if (ch2 === null) {
      for (let i = 0; i < frames; i++) { ch1[i] = avWavF64To32(dv.getFloat64(pos, true)); pos += 8; }
    } else {
      for (let i = 0; i < frames; i++) {
        ch1[i] = avWavF64To32(dv.getFloat64(pos, true));
        ch2[i] = avWavF64To32(dv.getFloat64(pos + 8, true));
        pos += 16;
      }
    }
    res.ok = true;
    res.channels = ch;
    res.sampleRate = info.sampleRate;
    res.frames = frames;
    res.ch1 = ch1;
    res.ch2 = ch2;
    return res;
  } catch (e) {
    res.ok = false;
    res.error = "f64 read failed: " + avWavErrMsg(e);
    res.ch1 = null;
    res.ch2 = null;
    return res;
  }
}

/* ---------- K wave KL (verify/_k_wave.md section 4): avWavMeta ------------------------------
   Clean-room, READ-ONLY metadata chunk walk (the walker never writes to buf; files are never
   rewritten). avWavMeta(buf) -> { ok, tempo, root, key, source: string[], warnings: string[],
   error }. Discipline mirrors avWavInfo: never throws; honest refusal (ok:false + error) for a
   non-RIFF/WAVE buffer; ok:true with the fields present-or-null; clamps instead of lies.

   Chunk layouts (documented here because they are the contract this reader implements):
   - iXML (4-char tag "iXML", text): <TEMPO>/<ROOT>/<KEY> read via tolerant case-insensitive
     tag regexes (a missing close tag reads to the next "<"). Latin1 or BOM'd UTF-16 text.
   - acid (tag "acid", 16 bytes minimum; the Sonic Foundry ACIDized form):
       +0  u32  type      (1 = loop; informational)
       +4  u16  root      (16-bit field: HIGH byte = MIDI note 0..127, LOW byte = fractional
                           cents 0..99 - the note lands, the cents stay informational)
       +6  u16  reserved  (0x8000 nominal; informational)
       +8  f32  tempo     (BPM, little-endian)
       +12 u32  beats     (read for layout completeness; the pinned return shape has no slot)
     A 24-byte tail is tolerated; shorter chunks read what fits and warn.
   - id3 / ID3 (tag "id3 " - any case, any 4th byte; ID3v2.3/v2.4): TBPM (tempo) + TKEY (key)
     text frames; 64 KiB scan cap; syncsafe sizes for v2.4, plain BE u32 for v2.3; v2.2
     (3-byte frame headers) is warned and not guessed.
   - bext (tag "bext", EBU 3285): presence + the Description (256 B) / Originator (32 B)
     text; informational only - the strings ride warnings ("bext description: ..."), and
     "bext" in source marks presence.
   Sanity clamps: a tempo outside 20..300 from ANY source is DROPPED with a warning (never
   clamped into a lie); a numeric root outside 0..127 is dropped with a warning; a note-name
   root stays the trimmed literal string (capped 16 - no invented octave mapping).
   Precedence: first source that provides a field wins, in the pinned order iXML < acid <
   id3 (chunk order inside the file does not matter). source lists the readers that
   CONTRIBUTED (iXML/acid/id3) or were present (bext), in that order. */

const AV_WAV_META_ID3_CAP = 65536;       /* id3 scan cap (bytes of the chunk) */
const AV_WAV_META_IXML_CAP = 65536;      /* iXML scan cap (bytes) */
const AV_WAV_META_WARN_MAX = 20;         /* warning lines kept */
const AV_WAV_META_WARN_LEN = 140;        /* per-warning cap */
const AV_WAV_META_KEY_CAP = 64;          /* key string cap */
const AV_WAV_META_NAME_CAP = 16;         /* note-name root cap */
const AV_WAV_META_TEMPO_MIN = 20;
const AV_WAV_META_TEMPO_MAX = 300;

function avWavMetaWarn(res, msg) {
  try {
    if (res.warnings.length < AV_WAV_META_WARN_MAX) {
      res.warnings.push(String(msg).slice(0, AV_WAV_META_WARN_LEN));
    }
  } catch (e) { /* best-effort */ }
}

/* collapse control runs + whitespace (the tolerant text normaliser) */
function avWavMetaTrimStr(s) {
  try {
    return String(s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").replace(/^ +| +$/g, "");
  } catch (e) { return ""; }
}

/* latin1 (or BOM'd UTF-16) decode of u8[start .. start+len), capped 4096 chars; keepNul=false
   stops at the first NUL (text fields), keepNul=true maps NULs to spaces (iXML blocks) */
function avWavMetaText(u8, start, len, keepNul) {
  const n = u8.length;
  let end = start + len;
  if (end > n) end = n;
  if (start >= end) return "";
  const b0 = u8[start], b1 = u8[start + 1];
  if (start + 1 < end && b0 === 0xFF && b1 === 0xFE) {    /* UTF-16LE BOM */
    let s = "";
    for (let i = start + 2; i + 1 < end && s.length < 4096; i += 2) {
      const c = u8[i] | (u8[i + 1] << 8);
      if (c === 0) { if (keepNul) { s += " "; continue; } break; }
      s += String.fromCharCode(c);
    }
    return s;
  }
  if (start + 1 < end && b0 === 0xFE && b1 === 0xFF) {    /* UTF-16BE BOM */
    let s = "";
    for (let i = start + 2; i + 1 < end && s.length < 4096; i += 2) {
      const c = (u8[i] << 8) | u8[i + 1];
      if (c === 0) { if (keepNul) { s += " "; continue; } break; }
      s += String.fromCharCode(c);
    }
    return s;
  }
  let s = "";
  for (let i = start; i < end && s.length < 4096; i++) {
    const c = u8[i];
    if (c === 0) { if (keepNul) { s += " "; continue; } break; }
    s += String.fromCharCode(c);
  }
  return s;
}

/* first numeric token in a string ("128 bpm" -> 128); null when none */
function avWavMetaNumOf(txt) {
  try {
    if (typeof txt !== "string" || !txt) return null;
    const m = /[-+]?(?:\d+\.?\d*|\.\d+)/.exec(txt);
    if (!m) return null;
    const v = Number(m[0]);
    return isFinite(v) ? v : null;
  } catch (e) { return null; }
}

function avWavMetaTempoOk(v) {
  return (typeof v === "number" && isFinite(v) && v >= AV_WAV_META_TEMPO_MIN && v <= AV_WAV_META_TEMPO_MAX);
}

/* <TAG ...>value</TAG> or an unterminated <TAG ...>value< tolerant read; "" when absent */
function avWavMetaTag(text, tag) {
  try {
    let re = new RegExp("<\\s*" + tag + "(\\s[^>]*)?>([\\s\\S]*?)<\\s*/\\s*" + tag + "\\s*>", "i");
    let m = re.exec(text);
    if (m) return avWavMetaTrimStr(m[2]);
    re = new RegExp("<\\s*" + tag + "(\\s[^>]*)?>([^<]*)", "i");
    m = re.exec(text);
    if (m) return avWavMetaTrimStr(m[2]);
  } catch (e) { /* absent */ }
  return "";
}

/* the iXML read: { tempo, root, key, got } (got = at least one field landed) */
function avWavMetaFromIxml(u8, start, size, avail, res) {
  const out = { tempo: null, root: null, key: null, got: false };
  try {
    if (size > avail) avWavMetaWarn(res, "iXML chunk truncated (" + avail + " of " + size + " bytes)");
    let len = (size < avail) ? size : avail;
    if (len > AV_WAV_META_IXML_CAP) { len = AV_WAV_META_IXML_CAP; avWavMetaWarn(res, "iXML chunk beyond the 64 KiB read cap"); }
    const txt = avWavMetaText(u8, start, len, true);
    if (!txt) return out;
    const t = avWavMetaTag(txt, "TEMPO");
    if (t) {
      const v = avWavMetaNumOf(t);
      if (avWavMetaTempoOk(v)) { out.tempo = v; out.got = true; }
      else avWavMetaWarn(res, "iXML TEMPO " + t.slice(0, 24) + " outside 20..300 - dropped");
    }
    const r = avWavMetaTag(txt, "ROOT");
    if (r) {
      if (/^[-+]?\d+$/.test(r)) {
        const rv = Number(r);
        if (isFinite(rv) && rv >= 0 && rv <= 127) { out.root = rv; out.got = true; }
        else avWavMetaWarn(res, "iXML ROOT " + r.slice(0, 24) + " outside 0..127 - dropped");
      } else { out.root = r.slice(0, AV_WAV_META_NAME_CAP); out.got = true; }
    }
    const k = avWavMetaTag(txt, "KEY");
    if (k) { out.key = k.slice(0, AV_WAV_META_KEY_CAP); out.got = true; }
  } catch (e) { /* absent */ }
  return out;
}

/* the acid read: { tempo, root, got } on the documented 16-byte layout above (a short chunk
   reads the fields its bytes actually hold and warns) */
function avWavMetaFromAcid(dv, start, size, avail, res) {
  const out = { tempo: null, root: null, beats: 0, got: false };
  try {
    if (size < 16) avWavMetaWarn(res, "acid chunk undersized (" + size + " bytes; the documented layout is 16)");
    if (size > avail) avWavMetaWarn(res, "acid chunk truncated (" + avail + " of " + size + " bytes)");
    const len = (size < avail) ? size : avail;
    if (len >= 6) {
      const root16 = dv.getUint16(start + 4, true);
      const note = (root16 >> 8) & 0xFF;                  /* high byte = MIDI note */
      if (note >= 0 && note <= 127) { out.root = note; out.got = true; }
      else avWavMetaWarn(res, "acid root note " + note + " outside 0..127 - dropped");
    }
    if (len >= 12) {
      const t = dv.getFloat32(start + 8, true);
      if (avWavMetaTempoOk(t)) { out.tempo = t; out.got = true; }
      else avWavMetaWarn(res, "acid tempo " + (isFinite(t) ? String(t) : "non-finite") + " outside 20..300 - dropped");
    }
    if (len >= 16) out.beats = dv.getUint32(start + 12, true);   /* read; no output slot (pinned shape) */
  } catch (e) { /* absent */ }
  return out;
}

/* ID3v2 syncsafe 28-bit integer (tag + v2.4 frame sizes): 4 x 7-bit groups, MSB first */
function avWavMetaSyncsafe(u8, o) {
  return ((u8[o] & 0x7F) << 21) | ((u8[o + 1] & 0x7F) << 14) | ((u8[o + 2] & 0x7F) << 7) | (u8[o + 3] & 0x7F);
}

/* one ID3 text frame's text (enc 0 latin1 / 1 UTF-16 BOM'd / 2 UTF-16BE / 3 UTF-8-tolerated) */
function avWavMetaId3Text(u8, o, end) {
  if (o >= end) return "";
  const enc = u8[o];
  const s = o + 1;
  if (enc === 1 || enc === 2) {
    let be = (enc === 2), st = s;
    if (enc === 1) {
      if (s + 1 < end && u8[s] === 0xFF && u8[s + 1] === 0xFE) { be = false; st = s + 2; }
      else if (s + 1 < end && u8[s] === 0xFE && u8[s + 1] === 0xFF) { be = true; st = s + 2; }
    }
    let out = "";
    for (let i = st; i + 1 < end && out.length < 256; i += 2) {
      const c = be ? ((u8[i] << 8) | u8[i + 1]) : (u8[i] | (u8[i + 1] << 8));
      if (c === 0) break;
      out += String.fromCharCode(c);
    }
    return avWavMetaTrimStr(out);
  }
  if (enc === 3 && typeof TextDecoder === "function") {
    try {
      let out = new TextDecoder("utf-8").decode(u8.subarray(s, end));
      const z = out.indexOf("\u0000");
      if (z >= 0) out = out.slice(0, z);
      return avWavMetaTrimStr(out).slice(0, 256);
    } catch (e2) { /* fall through to the latin1 read */ }
  }
  let out = "";
  for (let i = s; i < end && out.length < 256; i++) {
    const c = u8[i];
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return avWavMetaTrimStr(out);
}

/* the id3 read: { tempo, key, got } - ID3v2.3/v2.4 TBPM + TKEY text frames, 64 KiB cap */
function avWavMetaFromId3(u8, start, size, avail, res) {
  const out = { tempo: null, key: null, got: false };
  try {
    if (size < 10) { avWavMetaWarn(res, "id3 chunk undersized (" + size + " bytes) - nothing read"); return out; }
    if (size > avail) avWavMetaWarn(res, "id3 chunk truncated (" + avail + " of " + size + " bytes)");
    let len = (size < avail) ? size : avail;
    if (len > AV_WAV_META_ID3_CAP) { avWavMetaWarn(res, "id3 chunk beyond the 64 KiB scan cap"); len = AV_WAV_META_ID3_CAP; }
    if (!(u8[start] === 0x49 && u8[start + 1] === 0x44 && u8[start + 2] === 0x33)) {
      avWavMetaWarn(res, "id3 chunk without an ID3 tag header - skipped");
      return out;
    }
    const major = u8[start + 3];
    if (major !== 3 && major !== 4) {
      avWavMetaWarn(res, "ID3v2." + major + " tag - frames not read (v2.3/v2.4 only)");
      return out;
    }
    const tagSize = avWavMetaSyncsafe(u8, start + 6);
    let body = start + 10;
    let end = start + 10 + tagSize;
    const hardEnd = start + len;
    if (end > hardEnd) end = hardEnd;
    let frames = 0;
    while (body + 10 <= end && frames < 64) {
      const i0 = u8[body], i1 = u8[body + 1], i2 = u8[body + 2], i3 = u8[body + 3];
      if (i0 === 0) break;                                  /* padding starts */
      const id = String.fromCharCode(i0, i1, i2, i3);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;                 /* not a frame id: stop honestly */
      const fsz = (major === 4)
        ? avWavMetaSyncsafe(u8, body + 4)
        : ((u8[body + 4] * 0x1000000) + (u8[body + 5] << 16) + (u8[body + 6] << 8) + u8[body + 7]);
      const dataEnd = body + 10 + fsz;
      if (dataEnd > end) { avWavMetaWarn(res, "id3 frame " + id + " truncated - skipped"); break; }
      if (id === "TBPM") {
        const t = avWavMetaId3Text(u8, body + 10, dataEnd);
        const v = avWavMetaNumOf(t);
        if (avWavMetaTempoOk(v)) { out.tempo = v; out.got = true; }
        else avWavMetaWarn(res, "id3 TBPM " + (t ? t.slice(0, 24) : "empty") + " outside 20..300 - dropped");
      } else if (id === "TKEY") {
        const t = avWavMetaId3Text(u8, body + 10, dataEnd);
        if (t) { out.key = t.slice(0, AV_WAV_META_KEY_CAP); out.got = true; }
      }
      body = dataEnd;
      frames += 1;
    }
  } catch (e) { /* absent */ }
  return out;
}

/* the bext read: presence + informational Description (256 B) / Originator (32 B) strings
   (they ride warnings - the pinned shape has no bext field); returns presence */
function avWavMetaFromBext(u8, start, size, avail, res) {
  try {
    if (size < 348) avWavMetaWarn(res, "bext chunk undersized (" + size + " bytes)");
    const len = (size < avail) ? size : avail;
    if (len >= 288) {
      const desc = avWavMetaTrimStr(avWavMetaText(u8, start, 256, false)).slice(0, 160);
      const orig = avWavMetaTrimStr(avWavMetaText(u8, start + 256, 32, false)).slice(0, 80);
      if (desc) avWavMetaWarn(res, "bext description: " + desc);
      if (orig) avWavMetaWarn(res, "bext originator: " + orig);
    }
    return true;
  } catch (e) { return false; }
}

function avWavMeta(buf) {
  const res = { ok: false, tempo: null, root: null, key: null, source: [], warnings: [], error: "" };
  try {
    const u8 = avWavBytes(buf);
    if (!u8) { res.error = "unsupported buffer (ArrayBuffer|view required)"; return res; }
    const n = u8.length;
    if (n < 12) { res.error = "too short for a RIFF header"; return res; }
    if (!(u8[0] === 82 && u8[1] === 73 && u8[2] === 70 && u8[3] === 70)) { res.error = "missing RIFF tag"; return res; }
    if (!(u8[8] === 87 && u8[9] === 65 && u8[10] === 86 && u8[11] === 69)) { res.error = "not a WAVE file"; return res; }

    const dv = new DataView(u8.buffer, u8.byteOffset, n);
    const got = { ixml: null, acid: null, id3: null, bext: false };
    let sawAny = false;
    let o = 12;
    while (o + 8 <= n) {
      const size = dv.getUint32(o + 4, true);
      const body = o + 8;
      const avail = (body <= n) ? (n - body) : 0;
      const c0 = u8[o] | 0x20, c1 = u8[o + 1] | 0x20, c2 = u8[o + 2] | 0x20, c3 = u8[o + 3] | 0x20;
      if (c0 === 105 && c1 === 120 && c2 === 109 && c3 === 108) {          /* "iXML" */
        sawAny = true;
        if (!got.ixml) got.ixml = avWavMetaFromIxml(u8, body, size, avail, res);
      } else if (c0 === 97 && c1 === 99 && c2 === 105 && c3 === 100) {     /* "acid" */
        sawAny = true;
        if (!got.acid) got.acid = avWavMetaFromAcid(dv, body, size, avail, res);
      } else if (c0 === 105 && c1 === 100 && c2 === 51) {                  /* "id3" (any 4th byte) */
        sawAny = true;
        if (!got.id3) got.id3 = avWavMetaFromId3(u8, body, size, avail, res);
      } else if (c0 === 98 && c1 === 101 && c2 === 120 && c3 === 116) {    /* "bext" */
        sawAny = true;
        if (got.bext === false) got.bext = avWavMetaFromBext(u8, body, size, avail, res) === true;
      }
      if (size > n) { avWavMetaWarn(res, "chunk at " + o + " claims more bytes than the buffer holds - walking stopped"); break; }
      o = body + size + (size & 1);                                        /* RIFF chunks pad to even */
    }

    /* first-wins fold in the pinned order iXML < acid < id3; bext contributes presence */
    const srcs = [];
    if (got.ixml && got.ixml.got) {
      if (got.ixml.tempo !== null) res.tempo = got.ixml.tempo;
      if (got.ixml.root !== null) res.root = got.ixml.root;
      if (got.ixml.key !== null) res.key = got.ixml.key;
      srcs.push("iXML");
    }
    if (got.acid && got.acid.got) {
      if (res.tempo === null && got.acid.tempo !== null) res.tempo = got.acid.tempo;
      if (res.root === null && got.acid.root !== null) res.root = got.acid.root;
      srcs.push("acid");
    }
    if (got.id3 && got.id3.got) {
      if (res.tempo === null && got.id3.tempo !== null) res.tempo = got.id3.tempo;
      if (res.key === null && got.id3.key !== null) res.key = got.id3.key;
      srcs.push("id3");
    }
    if (got.bext) srcs.push("bext");
    res.source = srcs;
    if (!srcs.length) res.warnings.push(sawAny ? "no usable metadata found" : "no metadata chunks found");
    res.ok = true;
    return res;
  } catch (e) {
    res.ok = false;
    res.tempo = null;
    res.root = null;
    res.key = null;
    res.source = [];
    res.error = avWavErrMsg(e);
    return res;
  }
}
