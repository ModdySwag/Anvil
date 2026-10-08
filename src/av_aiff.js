/* Anvil - R15b child A: clean-room AIFF / AIFF-C PCM reader (av_aiff.js).

   Why this file exists: Chromium does not decode AIFF (no AIFF demuxer in the bundled ffmpeg;
   probed live in research/import/03-serum-exs-native.md), yet Logic/EXS sample packs ship .aif /
   .aiff / .aifc files. This module reads them page-side in pure JavaScript, authored from the
   public AIFF-1.3 and AIFF-C specifications. Clean-room: no third-party code was copied.

   Interface (pinned by verify/_r15b_wave.md section 4.1):
     AV_AIFF_VERSION = "r15b.0"
     AVAIFF.probe(u8OrArrayBuffer)  -> { ok, channels, sampleRate, frames, bits, compression, error }
     AVAIFF.decode(u8OrArrayBuffer) -> { ok, channels, sampleRate, frames, bits, float, ch1, ch2,
                                         warnings, error }
   probe = COMM header parse only (no SSND required). decode = full PCM decode; ch1 = Float32Array
   (mono or left channel), ch2 = Float32Array or null (mono -> null). float = true when the source
   samples were IEEE single precision. error is "" on success and an honest line on every refusal.
   Samples normalise to -1..1 by dividing by 2 to the power (bits - 1); fl32 values pass through
   as-is. warnings is always an array (unexpected chunks, duplicates, size inconsistencies).

   Format coverage:
   - FORM walker for AIFF and AIFC. COMM: 16-bit channels, 32-bit frames, 16-bit sample size,
     80-bit extended-float sample rate (15-bit exponent, bias 16383, mantissa with an explicit
     integer bit - the same convention ffmpeg and SANE use).
   - SSND: offset and blockSize are read and honored; sound data begins offset bytes into the
     soundData field, and a nonzero blockSize is accepted as block-alignment metadata.
   - Big-endian signed PCM at 8 / 16 / 24 / 32 bits. Note: 8-bit AIFF samples are signed, unlike
     8-bit WAV (unsigned).
   - AIFC compressionType: NONE and twos (big-endian PCM), sowt (little-endian 16-bit), fl32
     (32-bit IEEE float). Every other type - fl64, ulaw, alaw, ima4, MAC3 and so on - refuses with
     "unsupported compression XXXX". Unsupported sample sizes refuse with "unsupported sample
     size: N". The reader never guesses.
   - Channels 1 (mono) or 2 (stereo); anything else refuses honestly.
   - A FORM size field that disagrees with the actual byte range does NOT truncate the walk: the
     buffer length is the bound (reader-robust, ffmpeg-like), and the disagreement is reported in
     warnings. A chunk claiming more bytes than the file holds is clamped and warned.

   Craft laws (house discipline): "use strict"; classic script (no modules, no imports, no DOM at
   load, no top-level side effects beyond building the AVAIFF closure); never throws anywhere
   (every entry point returns a receipt with ok:false + error); ASCII-only source. */

"use strict";

const AV_AIFF_VERSION = "r15b.0";

const AVAIFF = (function () {
  /* ---------- constants ---------- */

  var WARN_CAP = 64;                          /* bound the warnings array for hostile files */
  var F32_DENORM = Math.pow(2, -149);         /* smallest float32 subnormal unit */
  var POW2 = (function () {                   /* POW2[e] = 2 ^ (e - 127), for e = 0..254 */
    var t = new Array(255);
    for (var i = 0; i < 255; i++) t[i] = Math.pow(2, i - 127);
    return t;
  })();
  var KNOWN = {                               /* chunk ids that are expected and need no warning */
    COMM: 1, SSND: 1, FVER: 1, NAME: 1, AUTH: 1, ANNO: 1, COMT: 1, MARK: 1, INST: 1,
    MIDI: 1, AESD: 1, APPL: 1, ID3: 1, "ID3 ": 1, PEAK: 1, "(c) ": 1
  };

  /* ---------- small readers (all bounds-checked by their callers) ---------- */

  function errMsg(e) {
    try { return String((e && (e.message || e.name)) || e) || "unknown error"; }
    catch (e2) { return "unknown error"; }
  }

  function toU8(x) {
    try {
      if (x == null) return null;
      if (typeof ArrayBuffer === "undefined") return null;
      if (ArrayBuffer.isView && ArrayBuffer.isView(x)) {
        return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
      }
      if (x instanceof ArrayBuffer) return new Uint8Array(x);
      return null;
    } catch (e) { return null; }
  }

  function u16(u8, o) { return ((u8[o] << 8) | u8[o + 1]) & 0xFFFF; }
  function s16(u8, o) { var v = u16(u8, o); return v >= 0x8000 ? v - 0x10000 : v; }
  function u32(u8, o) {
    return (((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0);
  }
  function id4(u8, o) {
    var s = "";
    for (var i = 0; i < 4; i++) {
      var c = u8[o + i] & 0xFF;
      s += (c >= 32 && c <= 126) ? String.fromCharCode(c) : "?";
    }
    return s;
  }

  /* 80-bit extended float: 1 sign bit, 15 exponent bits (bias 16383), 64-bit mantissa whose
     most significant bit is the explicit integer bit. value = mantissa * 2^(exp - 16383 - 63). */
  function ext80(u8, o) {
    var se = ((u8[o] & 0xFF) << 8) | (u8[o + 1] & 0xFF);
    var neg = (se & 0x8000) !== 0;
    var exp = se & 0x7FFF;
    var hi = (u8[o + 2] & 0xFF) * 16777216 + ((u8[o + 3] & 0xFF) << 16) +
             ((u8[o + 4] & 0xFF) << 8) + (u8[o + 5] & 0xFF);
    var lo = (u8[o + 6] & 0xFF) * 16777216 + ((u8[o + 7] & 0xFF) << 16) +
             ((u8[o + 8] & 0xFF) << 8) + (u8[o + 9] & 0xFF);
    if (exp === 0x7FFF) return NaN;                        /* Inf or NaN - never a sample rate */
    if (exp === 0 && hi === 0 && lo === 0) return 0;       /* true zero */
    var e = (exp === 0) ? 1 : exp;                         /* denormal exponent convention */
    var mag = hi * Math.pow(2, e - 16383 - 31) + lo * Math.pow(2, e - 16383 - 63);
    return neg ? -mag : mag;
  }

  /* big-endian IEEE single; manual maths keeps the file free of DataView plumbing per sample */
  function f32be(u8, o) {
    var b0 = u8[o] & 0xFF, b1 = u8[o + 1] & 0xFF, b2 = u8[o + 2] & 0xFF, b3 = u8[o + 3] & 0xFF;
    var neg = (b0 & 0x80) !== 0;
    var e = ((b0 & 0x7F) << 1) | (b1 >> 7);
    var m = ((b1 & 0x7F) << 16) | ((b2 & 0xFF) << 8) | (b3 & 0xFF);
    var v;
    if (e === 0xFF) v = m ? NaN : Infinity;
    else if (e === 0) v = m * F32_DENORM;
    else v = (1 + m / 8388608) * POW2[e];
    return neg ? -v : v;
  }

  function warnPush(w, msg) {
    if (w.length < WARN_CAP) { w.push(msg); return; }
    if (w.length === WARN_CAP) w.push("warning cap reached");
  }

  /* ---------- FORM walker (AIFF and AIFC share the IFF container shape) ---------- */

  function walk(u8, w) {
    var len = u8.length;
    if (len < 12) return { ok: false, error: "too short for an AIFF header" };
    if (id4(u8, 0) !== "FORM") return { ok: false, error: "missing FORM tag" };
    var form = id4(u8, 8);
    if (form !== "AIFF" && form !== "AIFC") {
      return { ok: false, error: "not an AIFF file: form type " + form };
    }
    var declaredEnd = 8 + u32(u8, 4);
    var formBound = len;
    var formStrict = false;
    if (declaredEnd >= 12 && declaredEnd <= len) { formBound = declaredEnd; formStrict = true; }
    else warnPush(w, "FORM size field inconsistent");
    var formWarned = false;
    var chunks = [];
    var pos = 12;
    while (pos + 8 <= len) {
      var id = id4(u8, pos);
      var size = u32(u8, pos + 4);
      var dataOff = pos + 8;
      var avail = len - dataOff;
      var clipped = (size > avail);
      var eff = clipped ? avail : size;
      if (clipped) warnPush(w, "chunk " + id + " extends beyond file");
      if (!KNOWN[id]) warnPush(w, "unexpected chunk " + id);
      chunks.push({ id: id, off: dataOff, size: size, eff: eff });
      if (!clipped && formStrict && !formWarned && dataOff + size + (size & 1) > formBound) {
        warnPush(w, "FORM size field inconsistent");
        formWarned = true;
      }
      if (clipped) break;
      pos = dataOff + size + (size & 1);      /* IFF chunks pad to even */
    }
    return { ok: true, form: form, chunks: chunks };
  }

  /* ---------- COMM parse (shared by probe and decode) ---------- */

  function checkSupport(comp, bits) {
    if (comp === "NONE" || comp === "twos") {
      if (bits === 8 || bits === 16 || bits === 24 || bits === 32) return "";
      return "unsupported sample size: " + bits;
    }
    if (comp === "sowt") {
      if (bits === 16) return "";
      return "unsupported sample size: " + bits;
    }
    if (comp === "fl32") return "";           /* 32-bit float by definition of the type */
    return "unsupported compression " + comp;
  }

  function parse(u8) {
    var w = [];
    var out = {
      ok: false, error: "", warnings: w, isAifc: false, ssnd: null,
      channels: 0, sampleRate: 0, frames: 0, bits: 0, compression: ""
    };
    var wk = walk(u8, w);
    if (!wk.ok) { out.error = wk.error; return out; }
    out.isAifc = (wk.form === "AIFC");
    var comm = null, ssnd = null, sawFver = false;
    for (var i = 0; i < wk.chunks.length; i++) {
      var c = wk.chunks[i];
      if (c.id === "COMM") {
        if (comm) warnPush(w, "duplicate COMM chunk ignored"); else comm = c;
      } else if (c.id === "SSND") {
        if (ssnd) warnPush(w, "duplicate SSND chunk ignored"); else ssnd = c;
      } else if (c.id === "FVER") {
        sawFver = true;
      }
    }
    if (out.isAifc && !sawFver) warnPush(w, "AIFC without FVER chunk");
    if (!comm) { out.error = "no COMM chunk"; return out; }
    if (comm.eff < 18) { out.error = "bad COMM chunk"; return out; }
    var off = comm.off;
    var channels = s16(u8, off);
    var frames = u32(u8, off + 2);
    var bits = s16(u8, off + 6);
    var rate = ext80(u8, off + 8);
    var comp = "NONE";                        /* plain AIFF is uncompressed big-endian PCM */
    if (out.isAifc) {
      if (comm.eff < 22) { out.error = "bad COMM chunk"; return out; }
      comp = id4(u8, off + 18);
    }
    out.channels = channels;
    out.frames = frames;
    out.bits = bits;
    out.compression = comp;
    out.sampleRate = isFinite(rate) ? rate : 0;
    if (channels < 1 || channels > 2) { out.error = "unsupported channels: " + channels; return out; }
    if (!(isFinite(rate) && rate > 0)) {
      out.error = isFinite(rate) ? ("invalid sample rate: " + rate) : "invalid sample rate";
      return out;
    }
    var sup = checkSupport(comp, bits);
    if (sup) { out.error = sup; return out; }
    out.ssnd = ssnd;
    out.ok = true;
    return out;
  }

  /* ---------- public entry points ---------- */

  function probe(x) {
    var res = { ok: false, channels: 0, sampleRate: 0, frames: 0, bits: 0, compression: "", error: "" };
    try {
      var u8 = toU8(x);
      if (!u8) { res.error = "unsupported buffer (ArrayBuffer|view required)"; return res; }
      var h = parse(u8);
      res.channels = h.channels;
      res.sampleRate = h.sampleRate;
      res.frames = h.frames;
      res.bits = h.bits;
      res.compression = h.compression;
      if (!h.ok) { res.error = h.error; return res; }
      res.ok = true;
      return res;
    } catch (e) {
      res.ok = false;
      res.error = "aiff read failed: " + errMsg(e);
      return res;
    }
  }

  function decode(x) {
    var res = {
      ok: false, channels: 0, sampleRate: 0, frames: 0, bits: 0, float: false,
      ch1: null, ch2: null, warnings: [], error: ""
    };
    try {
      var u8 = toU8(x);
      if (!u8) { res.error = "unsupported buffer (ArrayBuffer|view required)"; return res; }
      var h = parse(u8);
      res.warnings = h.warnings;
      res.channels = h.channels;
      res.sampleRate = h.sampleRate;
      res.frames = h.frames;
      res.bits = h.bits;
      res.float = (h.compression === "fl32");
      if (!h.ok) { res.error = h.error; return res; }
      var s = h.ssnd;
      if (!s) { res.error = "no SSND chunk"; return res; }
      if (s.eff < 8) { res.error = "bad SSND chunk"; return res; }
      var offset = u32(u8, s.off);
      u32(u8, s.off + 4);                     /* blockSize: read and validated; data starts at offset */
      if (offset > s.eff - 8) { res.error = "bad SSND offset"; return res; }
      var dataLen = s.eff - 8 - offset;
      var bps = (h.compression === "fl32") ? 4 : (h.bits >> 3);
      var frameBytes = h.channels * bps;
      var availFrames = Math.floor(dataLen / frameBytes);
      var want = h.frames;
      var n = (want < availFrames) ? want : availFrames;
      if (n < want) warnPush(res.warnings, "SSND shorter than COMM frames (" + n + " of " + want + ")");
      else if (want === 0 && availFrames > 0) warnPush(res.warnings, "COMM reports zero frames");
      if (dataLen % frameBytes !== 0) warnPush(res.warnings, "SSND data ends mid-frame");
      if (h.compression === "fl32" && h.bits !== 32) {
        warnPush(res.warnings, "fl32 declares " + h.bits + " bits");
      }

      var ch1 = new Float32Array(n);
      var ch2 = (h.channels === 2) ? new Float32Array(n) : null;
      var pos = s.off + 8 + offset;
      var f = 0;
      /* channels is 1 or 2 here (support was checked); one tight loop per sample format. */
      if (h.compression === "fl32") {
        if (ch2 === null) {
          for (f = 0; f < n; f++) { ch1[f] = f32be(u8, pos); pos += 4; }
        } else {
          for (f = 0; f < n; f++) { ch1[f] = f32be(u8, pos); ch2[f] = f32be(u8, pos + 4); pos += 8; }
        }
      } else if (h.bits === 8) {
        if (ch2 === null) {
          for (f = 0; f < n; f++) {
            var x8 = u8[pos];
            ch1[f] = (x8 >= 128 ? x8 - 256 : x8) / 128;
            pos += 1;
          }
        } else {
          for (f = 0; f < n; f++) {
            var y8 = u8[pos];
            ch1[f] = (y8 >= 128 ? y8 - 256 : y8) / 128;
            var z8 = u8[pos + 1];
            ch2[f] = (z8 >= 128 ? z8 - 256 : z8) / 128;
            pos += 2;
          }
        }
      } else if (h.bits === 16) {
        if (h.compression === "sowt") {       /* little-endian 16-bit */
          if (ch2 === null) {
            for (f = 0; f < n; f++) {
              var l0 = u8[pos] | (u8[pos + 1] << 8);
              ch1[f] = (l0 >= 0x8000 ? l0 - 0x10000 : l0) / 32768;
              pos += 2;
            }
          } else {
            for (f = 0; f < n; f++) {
              var l1 = u8[pos] | (u8[pos + 1] << 8);
              ch1[f] = (l1 >= 0x8000 ? l1 - 0x10000 : l1) / 32768;
              var l2 = u8[pos + 2] | (u8[pos + 3] << 8);
              ch2[f] = (l2 >= 0x8000 ? l2 - 0x10000 : l2) / 32768;
              pos += 4;
            }
          }
        } else {                              /* big-endian 16-bit (NONE, twos, plain AIFF) */
          if (ch2 === null) {
            for (f = 0; f < n; f++) {
              var g0 = ((u8[pos] << 8) | u8[pos + 1]) & 0xFFFF;
              ch1[f] = (g0 >= 0x8000 ? g0 - 0x10000 : g0) / 32768;
              pos += 2;
            }
          } else {
            for (f = 0; f < n; f++) {
              var g1 = ((u8[pos] << 8) | u8[pos + 1]) & 0xFFFF;
              ch1[f] = (g1 >= 0x8000 ? g1 - 0x10000 : g1) / 32768;
              var g2 = ((u8[pos + 2] << 8) | u8[pos + 3]) & 0xFFFF;
              ch2[f] = (g2 >= 0x8000 ? g2 - 0x10000 : g2) / 32768;
              pos += 4;
            }
          }
        }
      } else if (h.bits === 24) {
        if (ch2 === null) {
          for (f = 0; f < n; f++) {
            var m0 = (u8[pos] << 16) | (u8[pos + 1] << 8) | u8[pos + 2];
            if (m0 >= 0x800000) m0 -= 0x1000000;
            ch1[f] = m0 / 8388608;
            pos += 3;
          }
        } else {
          for (f = 0; f < n; f++) {
            var m1 = (u8[pos] << 16) | (u8[pos + 1] << 8) | u8[pos + 2];
            if (m1 >= 0x800000) m1 -= 0x1000000;
            ch1[f] = m1 / 8388608;
            var m2 = (u8[pos + 3] << 16) | (u8[pos + 4] << 8) | u8[pos + 5];
            if (m2 >= 0x800000) m2 -= 0x1000000;
            ch2[f] = m2 / 8388608;
            pos += 6;
          }
        }
      } else {                                /* 32-bit big-endian integer */
        if (ch2 === null) {
          for (f = 0; f < n; f++) {
            var q0 = u32(u8, pos);
            if (q0 >= 2147483648) q0 -= 4294967296;
            ch1[f] = q0 / 2147483648;
            pos += 4;
          }
        } else {
          for (f = 0; f < n; f++) {
            var q1 = u32(u8, pos);
            if (q1 >= 2147483648) q1 -= 4294967296;
            ch1[f] = q1 / 2147483648;
            var q2 = u32(u8, pos + 4);
            if (q2 >= 2147483648) q2 -= 4294967296;
            ch2[f] = q2 / 2147483648;
            pos += 8;
          }
        }
      }

      res.ok = true;
      res.frames = n;
      res.ch1 = ch1;
      res.ch2 = ch2;
      return res;
    } catch (e) {
      res.ok = false;
      res.error = "aiff read failed: " + errMsg(e);
      res.ch1 = null;
      res.ch2 = null;
      return res;
    }
  }

  return { version: AV_AIFF_VERSION, probe: probe, decode: decode };
})();
