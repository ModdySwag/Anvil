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
