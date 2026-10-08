/* av_sxt.js - Anvil R15d child A: Reason NN-XT (.sxt / .sx2) patch reader (read-only).

   WHAT THIS FILE IS (contract: verify/_r15d_wave.md section 4.1; format facts:
   research/import/01-ableton-mystery.md section 1.1 plus scratch recon
   cache/r15d/sxt/recon-SO-9218208.md; framing pinned against the read-only
   ConvertWithMoss sxt sources under cache/r15d/cwm/refs - understanding only,
   no code copied; this entire file is self-authored)
   - AV_SXT_VERSION = "r15d.0"
   - AVSXT.probe(u8OrArrayBuffer) -> { ok, refs, version, error }
       Sync, cheap. ok true when the bytes are an IFF FORM container whose form
       type is "PTCH". refs = the REFE chunk count (chunk headers only).
       version = "M.m.r" read from the 5-byte tag (0xBC major minor rev 0x00)
       that opens the DESC chunk payload, else the first such tag opening any
       other top-level chunk payload, else "". error is "" when ok and an honest
       short line on every refusal; never throws.
   - AVSXT.extract(u8OrArrayBuffer) -> { ok, name, version, refs, refCount,
       warnings, error }
       Sync. Per REFE chunk: sample name + relative path, falling back to the
       absolute then the database path when the relative one is empty; when the
       chunk carries the Reason 4+ field set (version tag >= 1.3.0) the second
       path block wins whenever it holds any value, with the first block as the
       last resort. Rows dedupe case-insensitively by name, first wins (the
       path keys the row when the name is empty). An internal sanity cap of 1024
       rows applies and is reported in warnings. name = the DESC patch name when
       the container carries one, else "" - never guessed. Never throws; empty,
       unrecognized or header-truncated bytes return ok:false with a short
       honest error line.
   - FORMAT NOTES (pinned from the references above)
       Container: EA IFF 85 family. "FORM" + u32-BE size + "PTCH" + children.
       Group chunks ("CAT " in the writer) carry a 4-byte type ("REFS") after
       their size and hold the sample reference chunks. Local chunk payloads
       ("DESC", "AUTH", "PARM", "BODY") are raw data. Chunk sizes count the type
       field of group chunks; odd sizes may carry the standard IFF pad byte.
       Strings: u32-BE byte length + bytes, decoded ISO-8859-1, except when the
       chunk's leading version tag is exactly 1.3.0 (Reason 3 era) where the
       writer used UTF-8. A length word of 0xFFFFFFFF opens an explicit UTF-8
       block: version tag 1.0.0 + u32-BE byte count + UTF-8 bytes.
       REFE field order: version tag; relative path block; database path block;
       absolute path block; sample name; ReFill name; ReFill URL; one reserved
       byte; package name; and, when the version tag is >= 1.3.0, four more
       values: physical sample name plus the three path blocks again.
       Each path block: version tag, one valid-flag byte, then (only when
       valid) the type-specific payload: relative = step-up count u32 + subpath
       count u32 + subpath strings; database = ReFill name string + subpath
       count u32 + subpath strings; absolute = volume string, one volume-type
       byte, subpath count u32 + subpath strings, one part-of-refill byte, and
       (version >= 1.8.0) a reserved byte plus u32 reserved byte count plus
       those bytes, and (version >= 1.9.0) one more byte. Path blocks gain a
       trailing byte when their version tag is >= 1.5.0.
       REFE version >= 1.3.0 notes: the decoding switched to UTF-8 for the whole
       chunk; the second path block typically supersedes the first.
   - CORPUS NOTE: no real .sxt file exists on this machine (the bounded fetch
     attempt is recorded in cache/r15d/sxt/FETCH-NOTES.md); every branch below
     is pinned against writer-shaped synthetic fixtures in the scratch harness
     cache/r15d/sxt/harness.js plus the fixture card in the R15d report.

   LAWS (house discipline): "use strict"; classic script (no modules, no
   imports, no DOM at load, no top-level side effects beyond building the AVSXT
   closure); every entry point never throws; ASCII-only source; block comment
   prose contains no close sequence. */

"use strict";

const AV_SXT_VERSION = "r15d.0";

const AVSXT = (function () {
  /* ----- encoded format versions: major*1000000 + minor*1000 + revision ----- */

  var V_1_0_0 = 1000000;
  var V_1_1_0 = 1001000;
  var V_1_2_0 = 1002000;
  var V_1_3_0 = 1003000;
  var V_1_5_0 = 1005000;
  var V_1_8_0 = 1008000;
  var V_1_9_0 = 1009000;

  /* ----- bounds ----- */

  var REF_CAP = 1024;      /* contract 4.1: internal sanity cap on refs rows */
  var WARN_CAP = 64;       /* bound the warnings array */
  var ITER_CAP = 65536;    /* bound every chunk walk (hostile input) */
  var SUB_CAP = 4096;      /* bound subpath counts (hostile input) */
  var STR_CAP = 16777216;  /* per-string sanity cap: 16 MiB */

  /* ----- pinned error lines ----- */

  var ERR_INPUT = "empty or unsupported input";
  var ERR_EMPTY = "empty input";
  var ERR_HDR = "truncated IFF header";
  var ERR_FORM = "not an IFF FORM container";

  /* ----- cached decoders ----- */

  var _TD8 = null;
  var _TD1252 = null;

  function _dec(d, start, end, utf8) {
    if (end - start <= 0) { return ""; }
    if (utf8) {
      try {
        if (!_TD8) { _TD8 = new TextDecoder("utf-8"); }
        return _TD8.decode(d.subarray(start, end));
      } catch (e) { /* fall through to the manual loop */ }
    } else {
      try {
        if (!_TD1252) { _TD1252 = new TextDecoder("windows-1252"); }
        return _TD1252.decode(d.subarray(start, end));
      } catch (e) { /* fall through to the manual loop */ }
    }
    return _decRaw(d, start, end);
  }

  function _decRaw(d, start, end) {
    var out = "";
    var i;
    for (i = start; i < end; i++) {
      out += String.fromCharCode(d[i]);
    }
    return out;
  }

  /* ----- byte helpers ----- */

  function _bytes(input) {
    try {
      if (!input) { return null; }
      if (typeof input === "string") { return null; }
      if (input instanceof Uint8Array) { return input; }
      if (input instanceof ArrayBuffer) { return new Uint8Array(input); }
      if (typeof SharedArrayBuffer !== "undefined" && input instanceof SharedArrayBuffer) {
        return new Uint8Array(input);
      }
      if (ArrayBuffer.isView(input)) {
        return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      }
      if (typeof input.length === "number" && input.length >= 0 && input.length <= STR_CAP) {
        var n = input.length >>> 0;
        var out = new Uint8Array(n);
        var i;
        for (i = 0; i < n; i++) {
          var v = input[i];
          out[i] = (typeof v === "number") ? (v & 255) : 0;
        }
        return out;
      }
    } catch (e) { return null; }
    return null;
  }

  function _msg(e) {
    var s = "";
    try { s = (e && e.message) ? String(e.message) : String(e); } catch (e2) { s = "unknown"; }
    if (s.length > 80) { s = s.slice(0, 80); }
    return s;
  }

  function _rdU32(d, p) {
    return ((d[p] << 24) | (d[p + 1] << 16) | (d[p + 2] << 8) | d[p + 3]) >>> 0;
  }

  function _rdTag(d, p, end) {
    /* 5-byte version tag: 0xBC major minor rev 0x00; encoded int or -1 */
    if (p + 5 > end) { return -1; }
    if (d[p] !== 0xBC) { return -1; }
    return d[p + 1] * 1000000 + d[p + 2] * 1000 + d[p + 3];
  }

  function _verStr(v) {
    if (v < 0) { return ""; }
    return Math.floor(v / 1000000) + "." + Math.floor((v % 1000000) / 1000) + "." + (v % 1000);
  }

  function _id4(d, p) {
    if (p + 4 > d.length) { return ""; }
    return String.fromCharCode(d[p], d[p + 1], d[p + 2], d[p + 3]);
  }

  function _idTrim(id) {
    var s = id;
    while (s.length && (s.charCodeAt(s.length - 1) === 0x20 || s.charCodeAt(s.length - 1) === 0)) {
      s = s.slice(0, s.length - 1);
    }
    return s;
  }

  function _idShow(id) {
    var s = "";
    var i;
    for (i = 0; i < id.length; i++) {
      var c = id.charCodeAt(i);
      s += (c >= 0x20 && c <= 0x7E) ? id.charAt(i) : "?";
    }
    return s;
  }

  function _isPrintableId(d, p, end) {
    if (p + 4 > end) { return false; }
    var i;
    for (i = 0; i < 4; i++) {
      var c = d[p + i];
      if (c < 0x20 || c > 0x7E) { return false; }
    }
    return true;
  }

  function _base(p) {
    if (!p) { return ""; }
    var i = p.lastIndexOf("/");
    var j = p.lastIndexOf("\\");
    if (j > i) { i = j; }
    return (i >= 0) ? p.slice(i + 1) : p;
  }

  function _pushWarn(warnings, text) {
    if (warnings.length < WARN_CAP) { warnings.push(text); }
    else if (warnings.length === WARN_CAP) { warnings.push("more warnings suppressed"); }
  }

  /* ----- bounded cursor over a byte range; c.bad latches any overrun ----- */

  function _cur(d, start, end) {
    return { d: d, p: start, end: end, bad: false };
  }

  function _cU8(c) {
    if (c.p >= c.end) { c.bad = true; return -1; }
    var v = c.d[c.p];
    c.p += 1;
    return v;
  }

  function _cU32(c) {
    if (c.p + 4 > c.end) { c.bad = true; c.p = c.end; return 0; }
    var v = _rdU32(c.d, c.p);
    c.p += 4;
    return v;
  }

  function _cTag(c) {
    if (c.p + 5 > c.end || c.d[c.p] !== 0xBC) { c.bad = true; c.p = c.end; return -1; }
    var v = _rdTag(c.d, c.p, c.end);
    c.p += 5;
    return v;
  }

  function _cSkip(c, n) {
    if (n < 0 || c.p + n > c.end) { c.bad = true; c.p = c.end; return; }
    c.p += n;
  }

  function _cStr(c, utf8) {
    var len = _cU32(c);
    if (c.bad) { return ""; }
    if (len === 0xFFFFFFFF) {
      /* explicit UTF-8 block: version tag, u32 byte count, UTF-8 bytes */
      var v = _cTag(c);
      if (c.bad || v < 0) { return ""; }
      var n = _cU32(c);
      if (c.bad) { return ""; }
      if (n > STR_CAP) { c.bad = true; return ""; }
      if (n > c.end - c.p) {
        c.bad = true;
        var s8 = _dec(c.d, c.p, c.end, true);
        c.p = c.end;
        return s8;
      }
      var s9 = _dec(c.d, c.p, c.p + n, true);
      c.p += n;
      return s9;
    }
    if (len > STR_CAP) { c.bad = true; return ""; }
    if (len > c.end - c.p) {
      c.bad = true;
      var rem = _dec(c.d, c.p, c.end, utf8);
      c.p = c.end;
      return rem;
    }
    var s = _dec(c.d, c.p, c.p + len, utf8);
    c.p += len;
    return s;
  }

  /* ----- path blocks (relative / database / absolute) ----- */

  function _readSubPaths(c, utf8) {
    var cnt = _cU32(c);
    if (c.bad) { return null; }
    if (cnt > SUB_CAP) { c.bad = true; return null; }
    var parts = [];
    var i;
    for (i = 0; i < cnt && !c.bad; i++) {
      parts.push(_cStr(c, utf8));
    }
    if (c.bad) { return null; }
    return parts;
  }

  function _readPaths(c, utf8) {
    var out = { rel: "", db: "", abs: "" };

    /* relative path block */
    var rv = _cTag(c);
    var ra = _cU8(c);
    if (!c.bad && ra > 0) {
      var step = _cU32(c);
      var subs = null;
      if (!c.bad) {
        if (step > SUB_CAP) { c.bad = true; }
        else {
          subs = _readSubPaths(c, utf8);
          if (subs !== null) {
            var parts = [];
            var si;
            if (step === 0) { parts.push("."); }
            else {
              for (si = 0; si < step; si++) { parts.push(".."); }
            }
            for (si = 0; si < subs.length; si++) { parts.push(subs[si]); }
            out.rel = parts.join("/");
          }
        }
      }
      if (!c.bad && rv >= V_1_5_0) { _cSkip(c, 1); }
    }

    /* database path block */
    var dv = _cTag(c);
    var da = _cU8(c);
    if (!c.bad && da > 0) {
      _cStr(c, utf8); /* ReFill host name; the path below stays plain */
      var subs2 = _readSubPaths(c, utf8);
      if (!c.bad && subs2 !== null && subs2.length) {
        out.db = "/" + subs2.join("/");
      }
      if (!c.bad && dv >= V_1_5_0) { _cSkip(c, 1); }
    }

    /* absolute path block */
    var av = _cTag(c);
    var aa = _cU8(c);
    if (!c.bad && aa > 0) {
      var vol = _cStr(c, utf8);
      _cSkip(c, 1); /* volume type byte */
      var subs3 = _readSubPaths(c, utf8);
      if (!c.bad && subs3 !== null) {
        var prefix = "";
        if (vol) {
          prefix = (vol.charAt(vol.length - 1) === ":") ? (vol + "/") : (vol + ":/");
        } else {
          prefix = "/";
        }
        out.abs = subs3.length ? (prefix + subs3.join("/")) : (vol ? prefix : "");
      }
      if (!c.bad) {
        _cU8(c); /* part-of-refill flag byte */
        if (!c.bad && av >= V_1_8_0) {
          _cSkip(c, 1);
          var rsz = _cU32(c);
          if (!c.bad && rsz > 0) { _cSkip(c, rsz); }
        }
        if (!c.bad && av >= V_1_9_0) { _cSkip(c, 1); }
      }
    }

    return out;
  }

  /* ----- one REFE chunk payload -> a refs row ----- */

  function _parseRefe(d, start, end) {
    var c = _cur(d, start, end);
    var ver = _cTag(c);
    var utf8 = (ver === V_1_3_0);
    var p1 = _readPaths(c, utf8);
    var uiName = _cStr(c, utf8);          /* sample name */
    _cStr(c, utf8);                       /* ReFill name */
    _cStr(c, utf8);                       /* ReFill URL */
    _cU8(c);                              /* reserved byte (the writer emits 13) */
    _cStr(c, utf8);                       /* package name */
    var physName = "";
    var p2 = null;
    if (ver >= V_1_3_0 && !c.bad) {
      physName = _cStr(c, utf8);
      p2 = _readPaths(c, utf8);
    }
    var set = p1;
    if (p2 && (p2.rel || p2.abs || p2.db)) { set = p2; }
    var path = set.rel || set.abs || set.db;
    if (!path && set !== p1) { path = p1.rel || p1.abs || p1.db; }
    var name = uiName || physName || _base(path);
    return { ok: !c.bad, name: name, path: path };
  }

  /* ----- walk sinks ----- */

  function _hitRefeChunk(d, s, e, full, out) {
    out.refsRaw += 1;
    if (!full) { return; }
    var row = _parseRefe(d, s, e);
    if (!row.ok) {
      _pushWarn(out.warnings, "malformed REFE chunk skipped");
      return;
    }
    if (!row.name && !row.path) {
      _pushWarn(out.warnings, "empty reference row skipped");
      return;
    }
    var key = (row.name || row.path).toLowerCase();
    if (out.seen[key]) { return; }
    if (out.rows.length >= REF_CAP) {
      out.dropped += 1;
      return;
    }
    out.seen[key] = true;
    out.rows.push({ name: row.name, path: row.path });
  }

  function _hitDesc(d, s, e, full, out) {
    var tag = _rdTag(d, s, e);
    if (tag >= 0 && !out.descVersion) { out.descVersion = _verStr(tag); }
    if (!full) { return; }
    var c = _cur(d, s, e);
    _cTag(c);
    _cU8(c); /* reserved byte (the writer emits 18) */
    var nm = _cStr(c, (tag === V_1_3_0));
    if (!c.bad && nm && !out.descName) { out.descName = nm; }
  }

  function _peekTag(d, s, e, out) {
    if (out.firstTag) { return; }
    var tag = _rdTag(d, s, e);
    if (tag >= 0) { out.firstTag = _verStr(tag); }
  }

  /* ----- chunk walkers ----- */

  function _advance(d, dend, size, limit) {
    /* standard IFF pad only when the pad byte is actually there */
    var next = dend;
    if ((size & 1) !== 0 && next < limit) {
      if (d[next] === 0 && _isPrintableId(d, next + 1, limit)) { next += 1; }
    }
    return next;
  }

  function _walkRefs(d, s, e, full, out, depth) {
    var pos = s;
    var iters = 0;
    while (pos + 8 <= e) {
      iters += 1;
      if (iters > ITER_CAP) {
        _pushWarn(out.warnings, "reference walk bound hit");
        break;
      }
      var id = _id4(d, pos);
      var trimmed = _idTrim(id);
      var size = _rdU32(d, pos + 4);
      var dstart = pos + 8;
      var dend = dstart + size;
      var truncated = false;
      if (dend > e) {
        _pushWarn(out.warnings, "reference chunk " + _idShow(id) + " size runs past end of REFS");
        dend = e;
        truncated = true;
      }
      if (trimmed === "REFE") {
        _hitRefeChunk(d, dstart, dend, full, out);
      } else if ((trimmed === "REFS" || trimmed === "CAT" || trimmed === "LIST" || trimmed === "FORM") && depth < 8) {
        if (dstart + 4 <= dend && _idTrim(_id4(d, dstart)) === "REFS") {
          _walkRefs(d, dstart + 4, dend, full, out, depth + 1);
        }
      } else {
        _pushWarn(out.warnings, "unexpected chunk " + _idShow(id) + " in reference list");
      }
      if (truncated) { break; }
      var next = _advance(d, dend, size, e);
      if (next <= pos) { next = pos + 8; }
      pos = next;
    }
  }

  function _scan(u8, full) {
    var out = {
      refsRaw: 0,
      rows: [],
      seen: Object.create(null),
      dropped: 0,
      descName: "",
      descVersion: "",
      firstTag: "",
      warnings: []
    };
    var end = u8.length;
    var formSize = _rdU32(u8, 4);
    var walkEnd = end;
    if (formSize + 8 > end) {
      _pushWarn(out.warnings, "FORM size field runs past end of data");
    } else if (formSize + 8 !== end) {
      _pushWarn(out.warnings, "FORM size field does not match data length");
      if (formSize + 8 >= 12) { walkEnd = formSize + 8; }
    }
    var pos = 12;
    var iters = 0;
    while (pos + 8 <= walkEnd) {
      iters += 1;
      if (iters > ITER_CAP) {
        _pushWarn(out.warnings, "chunk walk bound hit");
        break;
      }
      var id = _id4(u8, pos);
      var trimmed = _idTrim(id);
      var size = _rdU32(u8, pos + 4);
      var dstart = pos + 8;
      var dend = dstart + size;
      var truncated = false;
      if (dend > walkEnd) {
        _pushWarn(out.warnings, "chunk " + _idShow(id) + " size runs past end");
        dend = walkEnd;
        truncated = true;
      }
      if (trimmed === "REFE") {
        _hitRefeChunk(u8, dstart, dend, full, out);
      } else if (trimmed === "CAT" || trimmed === "LIST" || trimmed === "FORM") {
        if (dstart + 4 <= dend) {
          if (_idTrim(_id4(u8, dstart)) === "REFS") {
            _walkRefs(u8, dstart + 4, dend, full, out, 0);
          }
        } else {
          _pushWarn(out.warnings, "group chunk " + _idShow(id) + " is too short");
        }
      } else if (trimmed === "REFS") {
        var cstart = dstart;
        if (dstart + 4 <= dend && _idTrim(_id4(u8, dstart)) === "REFS") { cstart = dstart + 4; }
        _walkRefs(u8, cstart, dend, full, out, 0);
      } else if (trimmed === "DESC") {
        _hitDesc(u8, dstart, dend, full, out);
      } else {
        _peekTag(u8, dstart, dend, out);
      }
      if (truncated) { break; }
      var next = _advance(u8, dend, size, walkEnd);
      if (next <= pos) { next = pos + 8; }
      pos = next;
    }
    return out;
  }

  /* ----- receipts ----- */

  function _errReceipt(msg) {
    return { ok: false, name: "", version: "", refs: [], refCount: 0, warnings: [], error: msg };
  }

  function _badFormType(u8) {
    return 'not an NN-XT patch (form type "' + _idShow(_id4(u8, 8)) + '")';
  }

  function _probe(input) {
    try {
      var u8 = _bytes(input);
      if (!u8) { return { ok: false, refs: 0, version: "", error: ERR_INPUT }; }
      if (!u8.length) { return { ok: false, refs: 0, version: "", error: ERR_EMPTY }; }
      if (u8.length < 12) { return { ok: false, refs: 0, version: "", error: ERR_HDR }; }
      if (_id4(u8, 0) !== "FORM") { return { ok: false, refs: 0, version: "", error: ERR_FORM }; }
      if (_idTrim(_id4(u8, 8)) !== "PTCH") {
        return { ok: false, refs: 0, version: "", error: _badFormType(u8) };
      }
      var out = _scan(u8, false);
      return {
        ok: true,
        refs: out.refsRaw,
        version: out.descVersion || out.firstTag || "",
        error: ""
      };
    } catch (e) {
      return { ok: false, refs: 0, version: "", error: "probe failed (" + _msg(e) + ")" };
    }
  }

  function _extract(input) {
    var u8 = null;
    try { u8 = _bytes(input); } catch (e) { u8 = null; }
    if (!u8) { return _errReceipt(ERR_INPUT); }
    if (!u8.length) { return _errReceipt(ERR_EMPTY); }
    if (u8.length < 12) { return _errReceipt(ERR_HDR); }
    if (_id4(u8, 0) !== "FORM") { return _errReceipt(ERR_FORM); }
    if (_idTrim(_id4(u8, 8)) !== "PTCH") { return _errReceipt(_badFormType(u8)); }
    try {
      var out = _scan(u8, true);
      if (out.dropped > 0) {
        _pushWarn(out.warnings, "reference cap " + REF_CAP + " hit; " + out.dropped + " later references ignored");
      } else if (out.rows.length >= REF_CAP) {
        _pushWarn(out.warnings, "reference cap " + REF_CAP + " hit");
      }
      return {
        ok: true,
        name: out.descName,
        version: out.descVersion || out.firstTag || "",
        refs: out.rows,
        refCount: out.rows.length,
        warnings: out.warnings,
        error: ""
      };
    } catch (e) {
      return _errReceipt("reader failed (" + _msg(e) + ")");
    }
  }

  return { probe: _probe, extract: _extract };
})();
