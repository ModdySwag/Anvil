/* Anvil - R15c child A: clean-room EXS24 (Apple Logic Sampler) binary reader (av_exs.js).

   Why this file exists: Logic sample packs arrive as .exs binary sampler instruments that name
   their audio files (often AIFF - which Chromium cannot decode, see av_aiff.js). Nothing in
   the import pipeline understood the instrument container, so a dropped Logic pack exposed no
   kit. This module reads the .exs container page-side in pure JavaScript and hands the importer
   zones, groups and sample references.

   Authored clean-room against the public format descriptions in
   research/import/03-serum-exs-native.md section 2, plus the community references it cites,
   which permit reuse with attribution (ISC / MIT): asatamax/tonverk-elmulti-converter
   EXS24_FORMAT_SPEC.md (ISC), matt-allan/renoise-exs24 exs.lua (MIT), vonred exs2sfz.py (ISC).
   No code was copied; every offset below is implemented from the documented layout. The SHA of
   the reader is what matters to the pipeline, not its internals.

   Interface (pinned by verify/_r15c_wave.md section 4.1):
     AV_EXS_VERSION = "r15c.0"
     AVEXS.probe(u8OrArrayBuffer) -> { ok, zones, groups, samples, reversed, note, error }
     AVEXS.parse(u8OrArrayBuffer) -> { ok, name, zones, groups, samples, warnings, error }
   probe = cheap block-count walk (84-byte headers) + endianness detection. parse = full read;
   big-endian files refuse honestly after probe with the pinned error line. error is "" on
   success and an honest short line on every refusal; warnings is always an array.

   Block layout (all offsets from the start of a block; every block has an 84-byte header):
     0..1   signature bytes 0x01 0x01
     2      zero
     3      marker byte: 0 instrument, 1 zone, 2 group, 3 sample, 4 params, 11 binary plist.
            New-generation files add 0x40 to the marker (0x40..0x4B).
     4..7   content size in bytes, excluding the 84-byte header. New-generation files set bit 7
            of byte 5 as a flag; the low 15 bits carry the size (masked decode). Big-endian
            files store the u16 swapped (best-effort walk only).
     8..11  object id
     16..19 chunk id, ASCII: "TBOS" / "JBOS" little-endian, "SOBT" / "SOBJ" byte-swapped
            big-endian (a big-endian file's swapped magic always starts with "S")
     20..83 64-byte NUL-padded name
   Content sizes: instrument 88, zone 148, group 144, sample 600 bytes.

   Zone content (offsets from the data start): 0 flags (bit0 oneshot, bit1 pitch tracking OFF,
   bit2 reverse, bit3 velocity range active, bit6 output assigned) / 1 key (root) / 2 fineTuning
   i8 cents / 3 pan i8 / 4 volumeAdjust i8 dB / 5 volumeScale / 6 keyLow / 7 keyHigh /
   9 velocityLow / 10 velocityHigh / 12 sampleStart u32 / 16 sampleEnd u32 / 20 loopStart /
   24 loopEnd / 28 loopCrossfade ms / 32 loopTune / 33 loopOptions (bit0 loop on, bit1 equal
   power, bit2 play-to-end on release) / 34 loopDirection (0 forward, 1 backward, 2 ping-pong) /
   80 coarseTuning i8 semitones / 82 output / 88 groupIndex i32 (-1 = none) / 92 sampleIndex u32.

   Sample content: 4 length frames / 8 sampleRate / 12 bitDepth / 16 channels (field 20 is the
   secondary count and is used only when 16 is zero) / 28 type ASCII ("WAVE", "AIFF", ...) /
   80 filePath 256 B / 336 fileName 256 B (both NUL-trimmed).

   Sentinels (guarded): sampleStart / sampleEnd are u32 raw. 0 is legal ("from the file start").
   0xFFFFFFFF is not a usable absolute frame, so an unset sampleStart is guarded down to 0; an
   unset sampleEnd stays raw and means "play to end" (the kit layer clamps it with min against
   the decoded length). The reader never guesses beyond these documented sentinels and never
   throws.

   Craft laws (house discipline): "use strict"; classic script (no modules, no imports, no DOM
   at load, no top-level side effects beyond building the AVEXS closure); never throws anywhere
   (every entry point returns a receipt with ok:false + error); ASCII-only source. */

"use strict";

const AV_EXS_VERSION = "r15c.0";

const AVEXS = (function () {
  /* ---------- constants ---------- */

  var WARN_CAP = 64;        /* bound the warnings array for hostile files */
  var HDR = 84;             /* every block's fixed header size */

  var KIND_INSTRUMENT = 0;
  var KIND_ZONE = 1;
  var KIND_GROUP = 2;
  var KIND_SAMPLE = 3;
  var KIND_PARAMS = 4;
  var KIND_PLIST = 11;

  /* Minimal content spans that can carry the documented fields; anything shorter is skipped. */
  var ZONE_MIN = 96;        /* through sampleIndex (92..95) */
  var GROUP_MIN = 92;       /* through enableByArticulationValue (91) */
  var SAMPLE_MIN = 32;      /* through type (28..31) */

  var MAX_KEEP = 65536;     /* per-type block cap, so a hostile file cannot exhaust memory */

  /* ---------- small helpers (all reads are bounds-guarded by their callers) ---------- */

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

  function u16le(u8, o) { return ((u8[o] & 0xFF) | ((u8[o + 1] & 0xFF) << 8)) & 0xFFFF; }

  function u32le(u8, o) {
    return (((u8[o] & 0xFF)) | ((u8[o + 1] & 0xFF) << 8) |
            ((u8[o + 2] & 0xFF) << 16) | ((u8[o + 3] & 0xFF) << 24)) >>> 0;
  }

  function s32le(u8, o) {
    var v = u32le(u8, o);
    return v >= 2147483648 ? v - 4294967296 : v;
  }

  function s8at(u8, o) {
    var v = u8[o] & 0xFF;
    return v >= 128 ? v - 256 : v;
  }

  function hex2(v) {
    v = v & 0xFF;
    return (v < 16 ? "0" : "") + v.toString(16);
  }

  /* NUL-terminated string; control bytes (except NUL, which ends it) and DEL become "?". */
  function cstr(u8, o, max, bound) {
    var end = o + max;
    if (end > bound) end = bound;
    var s = "", i, c;
    for (i = o; i < end; i++) {
      c = u8[i] & 0xFF;
      if (c === 0) break;
      s += (c >= 32 && c !== 127) ? String.fromCharCode(c) : "?";
    }
    return s;
  }

  function ascii4(u8, o) {
    var s = "", i, c;
    for (i = 0; i < 4; i++) {
      c = u8[o + i] & 0xFF;
      s += (c >= 32 && c <= 126) ? String.fromCharCode(c) : "?";
    }
    return s;
  }

  /* 4-byte ASCII type field ("WAVE", "AIFF", "CAF ", ...), NUL-trimmed, trailing blanks cut. */
  function typeStr(u8, o) {
    var s = cstr(u8, o, 4, o + 4);
    return s.replace(/\s+$/, "");
  }

  function warnPush(w, msg) {
    if (w.length < WARN_CAP) { w.push(msg); return; }
    if (w.length === WARN_CAP) w.push("warning cap reached");
  }

  /* ---------- size field (header offset 4) ---------- */

  /* Old files: plain u32 LE. New-generation files set bit 7 of byte 5 as a flag, so the size
     lives in the low 15 bits of the two low bytes. Big-endian files store the u16 swapped. */
  function decodeSize(u8, off, be) {
    var b4 = u8[off + 4] & 0xFF, b5 = u8[off + 5] & 0xFF;
    if (be) return (b4 << 8) | b5;
    if ((b5 & 0x80) !== 0) return b4 | ((b5 & 0x7F) << 8);
    return (b4 | (b5 << 8) | ((u8[off + 6] & 0xFF) << 16) | ((u8[off + 7] & 0xFF) << 24)) >>> 0;
  }

  /* ---------- the shared block walker ---------- */

  /* Walks 84-byte-header blocks from offset 0. Never throws: an unreadable or truncated block
     ends the walk with a warning (parse mode) and a recorded offset, never an exception.
     collect=false keeps it a pure count walk for probe (no per-block content parsing). */
  function walkCore(u8, be, collect) {
    var len = u8.length;
    var w = {
      blocks: 0, instruments: 0, zones: 0, groups: 0, samples: 0, params: 0, unknown: 0, plists: 0,
      truncatedAt: -1, warnedCap: false,
      warnings: [],
      zoneArr: [], groupArr: [], sampleArr: [],
      instrumentName: "", firstName: ""
    };
    var off = 0, guard = 0;
    var guardMax = Math.ceil(len / HDR) + 8;

    while (off + HDR <= len) {
      guard++;
      if (guard > guardMax) {
        if (collect) warnPush(w.warnings, "block walk safety cap hit at offset " + off);
        break;
      }

      var b0 = u8[off] & 0xFF, b1 = u8[off + 1] & 0xFF, b2 = u8[off + 2] & 0xFF;
      var marker = u8[off + 3] & 0xFF;
      var size = decodeSize(u8, off, be);
      var end = off + HDR + size;

      if (end > len) {
        if (collect) {
          warnPush(w.warnings, "truncated block at offset " + off +
            " (needs " + (HDR + size) + " bytes, " + (len - off) + " available) - stopped");
        }
        w.truncatedAt = off;
        break;
      }

      var kind = -1;
      if (b0 === 1 && b1 === 1 && b2 === 0) {
        if (marker <= 0x0B) kind = marker;
        else if (marker >= 0x40 && marker <= 0x4B) kind = marker - 0x40;
      }

      w.blocks++;

      if (kind === KIND_INSTRUMENT) {
        w.instruments++;
        if (w.instrumentName === "") w.instrumentName = cstr(u8, off + 20, 64, off + HDR);
      } else if (kind === KIND_ZONE) {
        w.zones++;
        if (collect) {
          if (w.zoneArr.length < MAX_KEEP) parseZone(u8, off, size, len, w);
          else if (!w.warnedCap) { w.warnedCap = true; warnPush(w.warnings, "zone list capped at " + MAX_KEEP); }
        }
      } else if (kind === KIND_GROUP) {
        w.groups++;
        if (collect) {
          if (w.groupArr.length < MAX_KEEP) parseGroup(u8, off, size, len, w);
          else if (!w.warnedCap) { w.warnedCap = true; warnPush(w.warnings, "group list capped at " + MAX_KEEP); }
        }
      } else if (kind === KIND_SAMPLE) {
        w.samples++;
        if (collect) {
          if (w.sampleArr.length < MAX_KEEP) parseSample(u8, off, size, len, w);
          else if (!w.warnedCap) { w.warnedCap = true; warnPush(w.warnings, "sample list capped at " + MAX_KEEP); }
        }
      } else if (kind === KIND_PARAMS) {
        w.params++;
      } else if (kind === KIND_PLIST) {
        w.plists++;                     /* binary plist chunks are expected and skipped quietly */
      } else {
        w.unknown++;
        if (collect) {
          warnPush(w.warnings, "unknown block at offset " + off +
            (marker !== 0xFF || b0 !== 0x01 ? " (marker 0x" + hex2(marker) + ")" : "") + " - skipped");
        }
      }

      if (off === 0 && w.firstName === "") w.firstName = cstr(u8, off + 20, 64, off + HDR);
      off = end;
    }

    if (off < len && w.truncatedAt < 0) {
      if (collect) warnPush(w.warnings, "truncated block header at offset " + off + " - stopped");
      w.truncatedAt = off;
    }
    return w;
  }

  /* ---------- per-type content readers ---------- */

  function parseZone(u8, off, size, len, w) {
    if (size < ZONE_MIN) {
      warnPush(w.warnings, "zone block at offset " + off + " is " + size +
        " bytes (need >= " + ZONE_MIN + ") - skipped");
      return;
    }
    var d = off + HDR;
    var fb = u8[d] & 0xFF;
    var lo = u8[d + 33] & 0xFF;
    var sStart = u32le(u8, d + 12);
    /* Guard the documented sentinels: 0 is legal ("from the file start"); 0xFFFFFFFF is not a
       usable absolute frame, so an unset start is guarded down to 0. An unset end stays raw -
       the kit layer clamps it with min against the decoded length, which collapses it to the
       full length. */
    if (sStart === 0xFFFFFFFF) sStart = 0;
    var sEnd = u32le(u8, d + 16);
    var z = {
      index: w.zoneArr.length,
      name: cstr(u8, off + 20, 64, off + HDR),
      flags: {
        oneshot: (fb & 1) !== 0,
        pitchTrackOff: (fb & 2) !== 0,
        reverse: (fb & 4) !== 0,
        velocityRange: (fb & 8) !== 0,
        outputAssigned: (fb & 64) !== 0,
        raw: fb
      },
      flagsByte: fb,
      oneshot: (fb & 1) !== 0,
      reverse: (fb & 4) !== 0,
      key: u8[d + 1] & 0xFF,
      fineTuning: s8at(u8, d + 2),
      pan: s8at(u8, d + 3),
      volumeAdjust: s8at(u8, d + 4),
      volumeScale: u8[d + 5] & 0xFF,
      keyLow: u8[d + 6] & 0xFF,
      keyHigh: u8[d + 7] & 0xFF,
      velocityLow: u8[d + 9] & 0xFF,
      velocityHigh: u8[d + 10] & 0xFF,
      sampleStart: sStart,                /* u32 raw; 0 = from start, guarded from 0xFFFFFFFF */
      sampleEnd: sEnd,                    /* u32 raw; 0xFFFFFFFF = play to end (clamped downstream) */
      loopStart: u32le(u8, d + 20),
      loopEnd: u32le(u8, d + 24),
      loopCrossfade: u32le(u8, d + 28),
      loopOptions: {
        loopOn: (lo & 1) !== 0,
        equalPower: (lo & 2) !== 0,
        playToEndOnRelease: (lo & 4) !== 0,
        raw: lo
      },
      loopOptionsByte: lo,
      loopDirection: u8[d + 34] & 0xFF,
      coarseTuning: s8at(u8, d + 80),
      output: u8[d + 82] & 0xFF,
      groupIndex: s32le(u8, d + 88),
      sampleIndex: u32le(u8, d + 92)
    };
    w.zoneArr.push(z);
  }

  function parseGroup(u8, off, size, len, w) {
    if (size < GROUP_MIN) {
      warnPush(w.warnings, "group block at offset " + off + " is " + size +
        " bytes (need >= " + GROUP_MIN + ") - skipped");
      return;
    }
    var d = off + HDR;
    var g = {
      index: w.groupArr.length,
      id: u32le(u8, off + 8),
      name: cstr(u8, off + 20, 64, off + HDR),
      volume: u8[d] & 0xFF,
      pan: u8[d + 1] & 0xFF,
      polyphony: u8[d + 2] & 0xFF,
      options: u8[d + 3] & 0xFF,
      exclusive: u8[d + 4] & 0xFF,
      minVelocity: u8[d + 5] & 0xFF,
      maxVelocity: u8[d + 6] & 0xFF,
      releaseTriggerTime: u16le(u8, d + 16),
      releaseTrigger: u8[d + 73] & 0xFF,
      output: u8[d + 74] & 0xFF,
      roundRobinGroupPos: s32le(u8, d + 80),
      enableByType: u8[d + 84] & 0xFF
    };
    w.groupArr.push(g);
  }

  function parseSample(u8, off, size, len, w) {
    if (size < SAMPLE_MIN) {
      warnPush(w.warnings, "sample block at offset " + off + " is " + size +
        " bytes (need >= " + SAMPLE_MIN + ") - skipped");
      return;
    }
    var d = off + HDR;
    var bound = off + HDR + size;
    var ch = 0;
    if (size >= 24) {
      ch = u32le(u8, d + 16);
      if (ch === 0) ch = u32le(u8, d + 20);
      if (ch < 0 || ch > 32) ch = 0;      /* hostile value - report unknown rather than absurd */
    }
    var s = {
      index: w.sampleArr.length,
      name: cstr(u8, off + 20, 64, off + HDR),
      length: u32le(u8, d + 4),
      rate: u32le(u8, d + 8),
      bits: u8[d + 12] & 0xFF,
      channels: ch,
      type: typeStr(u8, d + 28),
      filePath: "",
      fileName: ""
    };
    if (size >= 336) s.filePath = cstr(u8, d + 80, 256, bound);
    else warnPush(w.warnings, "sample block at offset " + off + " has no file path field (" + size + " bytes)");
    if (size >= 592) s.fileName = cstr(u8, d + 336, 256, bound);
    w.sampleArr.push(s);
  }

  /* ---------- public entry points ---------- */

  function probe(x) {
    var res = { ok: false, zones: 0, groups: 0, samples: 0, reversed: false, note: "", error: "" };
    try {
      var u8 = toU8(x);
      if (!u8) { res.error = "unsupported buffer (ArrayBuffer or typed-array view required)"; return res; }
      var len = u8.length;
      if (len < 20) { res.error = "too short for an EXS24 header"; return res; }

      var cid = ascii4(u8, 16);
      var be;
      if (cid === "TBOS" || cid === "JBOS") be = false;
      else if (cid === "SOBT" || cid === "SOBJ") be = true;
      else { res.error = "not an EXS24 file (chunk id \"" + cid + "\" at offset 16)"; return res; }

      res.reversed = be;
      var w = walkCore(u8, be, false);
      res.zones = w.zones;
      res.groups = w.groups;
      res.samples = w.samples;
      res.ok = true;

      res.note = "EXS24 " + (be ? "big-endian (byte-swapped; block counts are best-effort)"
                                : "little-endian") +
        ": zones " + w.zones + ", groups " + w.groups + ", samples " + w.samples +
        ", instruments " + w.instruments;
      if (w.params > 0) res.note += ", params " + w.params;
      if (w.unknown > 0) res.note += ", unknown " + w.unknown;
      if (w.truncatedAt >= 0) res.note += " - stopped at truncated block offset " + w.truncatedAt;
      return res;
    } catch (e) {
      res.ok = false;
      res.error = "exs probe failed: " + errMsg(e);
      return res;
    }
  }

  function parse(x) {
    var res = { ok: false, name: "", zones: [], groups: [], samples: [], warnings: [], error: "" };
    try {
      var u8 = toU8(x);
      if (!u8) { res.error = "unsupported buffer (ArrayBuffer or typed-array view required)"; return res; }
      var len = u8.length;
      if (len === 0) { res.error = "empty file"; return res; }
      if (len < 20) { res.error = "too short for an EXS24 header"; return res; }

      var cid = ascii4(u8, 16);
      if (cid === "SOBT" || cid === "SOBJ") { res.error = "big-endian EXS not supported"; return res; }
      if (cid !== "TBOS" && cid !== "JBOS") {
        res.error = "not an EXS24 file (chunk id \"" + cid + "\" at offset 16)";
        return res;
      }

      var w = walkCore(u8, false, true);
      res.zones = w.zoneArr;
      res.groups = w.groupArr;
      res.samples = w.sampleArr;
      res.warnings = w.warnings;
      res.name = w.instrumentName || w.firstName || "";

      if (w.instruments + w.zones + w.groups + w.samples === 0) {
        res.error = "no EXS24 blocks found";
        return res;
      }

      /* zone -> sample reference check (0xFFFFFFFF counts as out of range, honestly reported) */
      var i, zi;
      for (i = 0; i < res.zones.length; i++) {
        zi = res.zones[i].sampleIndex;
        if (zi >= res.samples.length) {
          warnPush(res.warnings, "zone " + i + " sampleIndex " + zi + " out of range (" +
            res.samples.length + " sample blocks)");
        }
      }

      res.ok = true;
      return res;
    } catch (e) {
      res.ok = false;
      res.error = "exs read failed: " + errMsg(e);
      return res;
    }
  }

  return { version: AV_EXS_VERSION, probe: probe, parse: parse };
})();
