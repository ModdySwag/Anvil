/* av_serum.js - Anvil R15c child C: Xfer Serum preset container reader (read-only).

   WHAT THIS FILE IS (contract: verify/_r15c_wave.md section 4.3; format facts:
   research/import/03-serum-exs-native.md section 1)
   - AV_SERUM_VERSION = "r15c.0"
   - AVSerum.probe(u8OrArrayBuffer) -> { ok, kind, name, error }
       Sync sniff. kind "serum2" = header "XferJson" + NUL (9 bytes) + uint64 LE
       JSON length + JSON metadata block (name = presetName). kind "fxp" = VST2
       container "CcnK" + big-endian byteSize + "FPCh" + plugin id "XfsX" at
       offset 16; name = the 28-byte program field at offset 28. error is "" when
       ok and an honest line on every refusal; never throws.
   - AVSerum.extract(arrayBuffer) -> Promise of { ok, meta, wtRefs, warnings, error }
       serum2: JSON block -> uint32 LE CBOR size -> uint32 LE encoding (2 = zstd)
       -> zstd frame -> native DecompressionStream("zstd") (pinned refusal when the
       format is unavailable: "zstd decompress unavailable in this browser") ->
       clean-room CBOR decode -> walk for wavetable references -> wtRefs entries
       { module, path } capped at 256. meta = the parsed JSON metadata plus
       meta.moduleCount (the top-level CBOR map member count).
       fxp: container parse -> DecompressionStream("deflate") over the chunk ->
       wavetable NAME strings at decompressed offsets 0x3C08 and 0x3E08 (two
       512-byte NUL-terminated fields; read only when the state covers them,
       else an honest warning) -> wtRefs entries { module: "fxp", path: name }.
       Never rejects; never throws. The result object always carries the five
       keys ok, meta, wtRefs, warnings, error.

   CORPUS NOTES (626 real factory presets, Xfer Serum 2, measured 2026-10-09)
   - All 626 files: encoding word 2, declared CBOR size equals the decompressed
     size exactly, JSON metadata 295..580 bytes, top-level CBOR map 174..178
     members, zstd frame magic 28 B5 2F FD, md5 of the zstd frame equals the
     JSON "hash" field.
   - Wavetable references are NESTED: Oscillator0.WTOsc0.relativePathToWT (and
     Oscillator1/WTOsc1, Oscillator2/WTOsc2). A top-level "WTOsc" key also exists
     in every preset but it is a GUI list of per-oscillator markers, not a table
     reference. The walk therefore matches WTOsc followed by digits at ANY depth
     and reports the container path (example: "Oscillator0/WTOsc0").
   - Per-preset reference counts across the corpus: 0 (83 files), 1 (88),
     2 (140), 3 (315). Paths resolve against Serum's Tables folder.
   - EMBEDDED TABLES EXIST in the corpus: 34 of 1878 WTOsc modules (in 23 files)
     carry embeddedWTData (a CBOR list) plus embed-family keys interpolateAfterLoad,
     tableDisplayName, numFrames, numChannels, sampleRate. The known key set below
     is the non-embedded field union, so any of those keys raises the pinned warning
     "embedded wavetable present (dash escaped as \u2014) extraction spike pending".
     The blob itself is NOT decoded and never guessed (no public spec); this reader
     is read-only metadata plus path references.
   - The fxp path has NO real fixtures on this machine (no .fxp file exists under
     Documents/Xfer); it is spec-derived (research 03 section 1.2) and is exercised
     against synthetic containers in the scratch harness only.

   LAWS (house discipline): "use strict"; classic script (no modules, no imports,
   no DOM at load, no top-level side effects beyond building the AVSerum closure);
   every entry point never throws and never rejects (honest refusals); ASCII-only
   source; block comments contain no close sequence. */

"use strict";

const AV_SERUM_VERSION = "r15c.0";

const AVSerum = (function () {
  /* ---------- constants ---------- */

  var XFER_HDR = "XferJson\u0000";   /* 9 bytes: 8 ASCII characters + NUL */
  var JSON_CAP = 16777216;           /* JSON metadata sanity cap: 16 MiB */
  var CBOR_CAP = 67108864;           /* declared CBOR size cap: 64 MiB */
  var REF_CAP = 256;                 /* wtRefs cap (contract 4.3) */
  var FXP_NAME_END = 16392;          /* 0x4008: end of the second name field */
  var FXP_CHUNK_OFF = 60;            /* chunk data starts after the fxp header */
  var DECOMP_MS = 30000;             /* decompression watchdog: never hang a UI */
  var CBOR_ITEMS = 4000000;          /* decode item budget (hostile-input bound) */
  var WARN_CAP = 64;                 /* bound the warnings array */
  var WT_RE = /^WTOsc[0-9]+$/;       /* wavetable oscillator module key shape */
  var WT_KNOWN = {                   /* non-embedded WTOsc field union (626-preset corpus) */
    relativePathToWT: 1, plainParams: 1, flex: 1,
    numChannels: 1, numFrames: 1, sampleRate: 1, storedPhasePos: 1
  };
  var WARN_EMBED = "embedded wavetable present \u2014 extraction spike pending";
  var ERR_ZSTD = "zstd decompress unavailable in this browser";
  var ERR_DEFLATE = "deflate decompress unavailable in this browser";

  var _TD = null;
  var _td = function () {
    if (!_TD) { _TD = new TextDecoder("utf-8"); }
    return _TD;
  };

  /* ---------- small readers, byte normalisers ---------- */

  function _bytes(input) {
    if (!input) { return null; }
    try {
      if (input instanceof Uint8Array) { return input; }
      if (input instanceof ArrayBuffer) { return new Uint8Array(input); }
      var b = input.buffer;
      if (b && typeof input.byteOffset === "number" && typeof input.byteLength === "number" &&
          typeof b.byteLength === "number") {
        return new Uint8Array(b, input.byteOffset, input.byteLength);
      }
    } catch (e) { return null; }
    return null;
  }

  function _asEq(u8, o, s) {
    if (o + s.length > u8.length) { return false; }
    for (var i = 0; i < s.length; i++) {
      if (u8[o + i] !== s.charCodeAt(i)) { return false; }
    }
    return true;
  }

  function _u32le(u8, o) {
    if (o + 4 > u8.length) { return -1; }
    return u8[o] + u8[o + 1] * 256 + u8[o + 2] * 65536 + u8[o + 3] * 16777216;
  }

  function _u32be(u8, o) {
    if (o + 4 > u8.length) { return -1; }
    return u8[o] * 16777216 + u8[o + 1] * 65536 + u8[o + 2] * 256 + u8[o + 3];
  }

  function _u64le(u8, o) {
    if (o + 8 > u8.length) { return -1; }
    var lo = u8[o] + u8[o + 1] * 256 + u8[o + 2] * 65536 + u8[o + 3] * 16777216;
    var hi = u8[o + 4] + u8[o + 5] * 256 + u8[o + 6] * 65536 + u8[o + 7] * 16777216;
    return hi * 4294967296 + lo;
  }

  function _utf8(sub) { return _td().decode(sub); }

  function _msg(e) {
    var s = (e && e.message) ? String(e.message) : String(e);
    if (s.length > 120) { s = s.slice(0, 120) + "..."; }
    return s;
  }

  function _trim(s) { return String(s).replace(/^\s+/, "").replace(/\s+$/, ""); }

  function _cstr(u8, o, cap) {
    var end = Math.min(o + cap, u8.length);
    var z = -1;
    for (var i = o; i < end; i++) {
      if (u8[i] === 0) { z = i; break; }
    }
    return _trim(_utf8(u8.subarray(o, z >= 0 ? z : end)));
  }

  function _pushWarn(arr, s) {
    if (arr.length < WARN_CAP) { arr.push(s); }
  }

  /* ---------- clean-room CBOR reader (minimal): uint, nint, byte string, text
     string, array, map, tag pass-through, bool, null, float16/32/64. Indefinite
     lengths refuse honestly (the Serum writer emits definite lengths only).
     Map keys are consumed as decoded; nothing is ever re-encoded. ---------- */

  function _need(u8, o, k) {
    if (o + k > u8.length) { throw new Error("CBOR truncated item"); }
  }

  function _f16(h) {
    var s = (h & 32768) ? -1 : 1;
    var e = (h >> 10) & 31;
    var f = h & 1023;
    if (e === 0) { return s * f * 5.9604644775390625e-8; }
    if (e === 31) { return f !== 0 ? NaN : s * Infinity; }
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  }

  function _cborItem(u8, dv, o, depth, st) {
    if (depth > 64) { throw new Error("CBOR nesting too deep"); }
    st.items++;
    if (st.items > CBOR_ITEMS) { throw new Error("CBOR item budget exceeded"); }
    if (o >= u8.length) { throw new Error("CBOR truncated item"); }
    var ib = u8[o];
    var major = ib >> 5;
    var ai = ib & 31;
    var p = o + 1;
    var n = 0;
    if (ai < 24) { n = ai; }
    else if (ai === 24) { _need(u8, o, 2); n = u8[p]; p = o + 2; }
    else if (ai === 25) { _need(u8, o, 3); n = dv.getUint16(p, false); p = o + 3; }
    else if (ai === 26) { _need(u8, o, 5); n = dv.getUint32(p, false); p = o + 5; }
    else if (ai === 27) {
      _need(u8, o, 9);
      var hi = dv.getUint32(p, false);
      var lo = dv.getUint32(p + 4, false);
      if ((major === 0 || major === 1) && hi > 2097151) { throw new Error("CBOR integer beyond 2^53"); }
      n = hi * 4294967296 + lo;
      p = o + 9;
    } else if (ai === 31) { throw new Error("CBOR indefinite-length item not supported"); }
    else { throw new Error("CBOR reserved additional info " + ai); }

    if (major === 0) { return { v: n, o: p }; }
    if (major === 1) { return { v: -1 - n, o: p }; }
    if (major === 2 || major === 3) {
      if (n > u8.length - p) { throw new Error("CBOR string length beyond input"); }
      var sub = u8.subarray(p, p + n);
      return { v: major === 2 ? sub : _utf8(sub), o: p + n };
    }
    if (major === 4) {
      if (n > u8.length - p) { throw new Error("CBOR array length beyond input"); }
      var arr = [];
      for (var i = 0; i < n; i++) {
        var it = _cborItem(u8, dv, p, depth + 1, st);
        arr.push(it.v);
        p = it.o;
      }
      return { v: arr, o: p };
    }
    if (major === 5) {
      if (n > u8.length - p) { throw new Error("CBOR map length beyond input"); }
      var obj = Object.create(null);
      for (var j = 0; j < n; j++) {
        var k = _cborItem(u8, dv, p, depth + 1, st);
        p = k.o;
        var val = _cborItem(u8, dv, p, depth + 1, st);
        p = val.o;
        var kk = k.v;
        if (typeof kk === "number") { kk = String(kk); }
        if (typeof kk === "string") { obj[kk] = val.v; }
      }
      return { v: obj, o: p };
    }
    if (major === 6) {                       /* tag: pass the inner value through */
      var inner = _cborItem(u8, dv, p, depth + 1, st);
      return { v: inner.v, o: inner.o };
    }
    /* major 7: simple values and floats */
    if (ai === 20) { return { v: false, o: p }; }
    if (ai === 21) { return { v: true, o: p }; }
    if (ai === 22 || ai === 23) { return { v: null, o: p }; }
    if (ai === 25) { _need(u8, o, 3); return { v: _f16(dv.getUint16(o + 1, false)), o: o + 3 }; }
    if (ai === 26) { _need(u8, o, 5); return { v: dv.getFloat32(o + 1, false), o: o + 5 }; }
    if (ai === 27) { _need(u8, o, 9); return { v: dv.getFloat64(o + 1, false), o: o + 9 }; }
    return { v: n, o: p };                   /* ai 24 simple value, and reserved smalls */
  }

  function _cborDecode(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var st = { items: 0 };
    var r = _cborItem(u8, dv, 0, 0, st);
    return { value: r.v, end: r.o };
  }

  /* ---------- wavetable reference scan ---------- */

  function _scanNode(node, path, depth, out) {
    if (depth > 64 || !node || typeof node !== "object") { return; }
    if (Array.isArray(node)) {
      for (var a = 0; a < node.length; a++) {
        _scanNode(node[a], path + "[" + a + "]", depth + 1, out);
      }
      return;
    }
    if (node instanceof Uint8Array) { return; }
    var ks = Object.keys(node);
    for (var i = 0; i < ks.length; i++) {
      var k = ks[i];
      var v = node[k];
      var cp = path ? path + "/" + k : k;
      if (WT_RE.test(k)) {
        out.modules++;
        if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Uint8Array)) {
          var mks = Object.keys(v);
          var unknown = false;
          var pth = null;
          var odd = false;
          for (var j = 0; j < mks.length; j++) {
            if (!Object.prototype.hasOwnProperty.call(WT_KNOWN, mks[j])) { unknown = true; }
            if (mks[j] === "relativePathToWT") {
              if (typeof v[mks[j]] === "string") { pth = v[mks[j]]; }
              else { odd = true; }
            }
          }
          if (unknown && !out.embed) { out.embed = true; out.warnings.push(WARN_EMBED); }
          if (odd) { _pushWarn(out.warnings, "wavetable path is not a string (" + cp + ")"); }
          if (pth !== null) {
            if (out.refs.length < REF_CAP) { out.refs.push({ module: cp, path: pth }); }
            else { out.overflow++; }
          }
        }
      }
      _scanNode(v, cp, depth + 1, out);
    }
  }

  /* ---------- stream decompression via the native Compression Streams API ---------- */

  function _inflate(src, format, maxOut) {
    return new Promise(function (resolve) {
      var ds = null;
      try { ds = new DecompressionStream(format); } catch (e) { ds = null; }
      if (!ds) { resolve({ ok: false, out: null, bytes: 0, error: "no-format" }); return; }
      var reader = null;
      var writer = null;
      try {
        reader = ds.readable.getReader();
        writer = ds.writable.getWriter();
      } catch (e2) {
        resolve({ ok: false, out: null, bytes: 0, error: "no-format" });
        return;
      }
      var done = false;
      var chunks = [];
      var total = 0;
      var readErr = "";
      var timer = setTimeout(function () {
        try {
          var cp2 = reader.cancel();
          if (cp2 && typeof cp2.catch === "function") { cp2.catch(function () { }); }
          if (writer && typeof writer.abort === "function") {
            var ap = writer.abort();
            if (ap && typeof ap.catch === "function") { ap.catch(function () { }); }
          }
        } catch (e4) { /* teardown is best-effort */ }
        resolve({ ok: false, out: null, bytes: 0, error: "decompress timeout" });
      }, DECOMP_MS);
      var readLoop = (function () {
        function step() {
          return reader.read().then(function (r) {
            if (r.done) { done = true; return; }
            if (r.value && r.value.length) {
              chunks.push(r.value);
              total += r.value.length;
            }
            if (maxOut > 0 && total >= maxOut) {
              done = true;
              try {
                var cp = reader.cancel();
                if (cp && typeof cp.catch === "function") { cp.catch(function () { }); }
              } catch (e3) { /* cancel is best-effort */ }
              return;
            }
            return step();
          });
        }
        return step().catch(function (e) { if (!readErr) { readErr = _msg(e); } });
      })();
      var writeLoop = (function () {
        var off = 0;
        function step() {
          if (done) { return Promise.resolve(); }
          if (off >= src.length) {
            return writer.close().catch(function (e) { if (!readErr && !done) { readErr = _msg(e); } });
          }
          var end = Math.min(off + 65536, src.length);
          var part = src.subarray(off, end);
          off = end;
          return writer.write(part).then(step).catch(function (e) { if (!readErr && !done) { readErr = _msg(e); } });
        }
        return step();
      })();
      Promise.all([readLoop, writeLoop]).then(function () {
        clearTimeout(timer);
        if (!total) {
          resolve({ ok: false, out: null, bytes: 0, error: readErr || "empty output" });
          return;
        }
        var out = null;
        if (chunks.length === 1) {
          out = chunks[0];
        } else {
          out = new Uint8Array(total);
          var o = 0;
          for (var i = 0; i < chunks.length; i++) {
            out.set(chunks[i], o);
            o += chunks[i].length;
          }
        }
        resolve({ ok: true, out: out, bytes: total, error: "", readErr: readErr });
      }).catch(function (e) {
        clearTimeout(timer);
        resolve({ ok: false, out: null, bytes: 0, error: _msg(e) });
      });
    });
  }

  /* ---------- receipt helpers ---------- */

  function _fail(error, meta, warnings) {
    return { ok: false, meta: meta || null, wtRefs: [], warnings: warnings || [], error: error };
  }

  function _crash(e) {
    return { ok: false, meta: null, wtRefs: [], warnings: [], error: "reader crash (" + _msg(e) + ")" };
  }

  /* ---------- serum2 pipeline ---------- */

  async function _serum2(u8) {
    var warnings = [];
    if (u8.length < 17 || !_asEq(u8, 0, XFER_HDR)) { return _fail("not a serum2 preset"); }
    var jlen = _u64le(u8, 9);
    if (!(jlen > 0) || jlen > JSON_CAP) { return _fail("JSON metadata length out of range"); }
    if (u8.length < 17 + jlen) { return _fail("truncated JSON metadata block"); }
    var meta = null;
    var parseFail = false;
    try { meta = JSON.parse(_utf8(u8.subarray(17, 17 + jlen))); } catch (e) { parseFail = true; meta = null; }
    if (parseFail) { return _fail("JSON metadata parse failed"); }
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
      return _fail("JSON metadata is not an object");
    }
    var o = 17 + jlen;
    if (u8.length < o + 8) { return _fail("truncated CBOR header", meta); }
    var cborSize = _u32le(u8, o);
    var enc = _u32le(u8, o + 4);
    if (enc !== 2) { return _fail("CBOR encoding " + enc + " is not supported (expected 2 = zstd)", meta); }
    if (!(cborSize > 0) || cborSize > CBOR_CAP) {
      return _fail("CBOR size word out of range (" + cborSize + ")", meta);
    }
    var frame = u8.subarray(o + 8);
    if (!frame.length) { return _fail("zstd frame missing", meta); }

    var dc = await _inflate(frame, "zstd", cborSize);
    if (!dc.ok) {
      if (dc.error === "no-format") { return _fail(ERR_ZSTD, meta, warnings); }
      return _fail("zstd decompress failed (" + dc.error + ")", meta, warnings);
    }
    if (dc.bytes < cborSize) {
      if (dc.readErr) { return _fail("zstd decompress failed (" + dc.readErr + ")", meta, warnings); }
      _pushWarn(warnings, "zstd payload short (got " + dc.bytes + " of " + cborSize + " bytes)");
    } else if (dc.readErr) {
      _pushWarn(warnings, "trailing bytes after zstd frame ignored");
    }

    var dec = null;
    var cborErr = null;
    try { dec = _cborDecode(dc.out); } catch (e2) { cborErr = e2; dec = null; }
    if (!dec) { return _fail("CBOR decode failed (" + _msg(cborErr) + ")", meta, warnings); }
    var val = dec.value;
    if (!val || typeof val !== "object" || Array.isArray(val)) {
      return _fail("CBOR top level is not a map", meta, warnings);
    }
    if (dec.end < dc.out.length) {
      _pushWarn(warnings, "trailing bytes after CBOR item (" + (dc.out.length - dec.end) + ")");
    }

    var out = { refs: [], warnings: warnings, embed: false, overflow: 0, modules: 0 };
    _scanNode(val, "", 0, out);
    if (out.overflow > 0) {
      _pushWarn(warnings, "wavetable refs capped at " + REF_CAP + " (" + out.overflow + " more modules skipped)");
    }
    meta.moduleCount = Object.keys(val).length;
    return { ok: true, meta: meta, wtRefs: out.refs, warnings: warnings, error: "" };
  }

  /* ---------- fxp pipeline (Serum 1 VST2 chunk preset) ---------- */

  function _fxpNameAt(u8, total, off) {
    var lim = total - off;
    if (lim <= 0) { return null; }
    var avail = Math.min(512, lim);
    var end = off + avail;
    var nul = -1;
    for (var i = off; i < end; i++) {
      if (u8[i] === 0) { nul = i; break; }
    }
    if (nul < 0 && avail < 512) { return null; }   /* cut before a terminator: never guess */
    return _trim(_utf8(u8.subarray(off, nul >= 0 ? nul : end)));
  }

  async function _fxp(u8) {
    var warnings = [];
    if (u8.length < FXP_CHUNK_OFF || !_asEq(u8, 0, "CcnK") || !_asEq(u8, 8, "FPCh") ||
        !_asEq(u8, 16, "XfsX")) {
      return _fail("not a Serum 1 fxp container");
    }
    var byteSize = _u32be(u8, 4);
    var fxVersion = _u32be(u8, 20);
    var programs = _u32be(u8, 24);
    var name = _cstr(u8, 28, 28);
    var chunkSize = _u32be(u8, 56);
    var meta = {
      presetName: name, product: "Serum", version: "1", kind: "fxp",
      fxVersion: fxVersion, programCount: programs, byteSize: byteSize
    };
    var avail = u8.length - FXP_CHUNK_OFF;
    var take = avail;
    if (chunkSize > 0 && chunkSize < avail) { take = chunkSize; }
    else if (chunkSize > avail) {
      _pushWarn(warnings, "fxp chunk truncated (have " + avail + " of " + chunkSize + " bytes)");
    }
    if (take <= 0) { return _fail("fxp chunk missing", meta, warnings); }
    var chunk = u8.subarray(FXP_CHUNK_OFF, FXP_CHUNK_OFF + take);

    var dc = await _inflate(chunk, "deflate", FXP_NAME_END);
    if (!dc.ok) {
      if (dc.error === "no-format") { return _fail(ERR_DEFLATE, meta, warnings); }
      return _fail("fxp chunk decompress failed (" + dc.error + ")", meta, warnings);
    }
    var st = dc.out;
    var L = dc.bytes;
    var refs = [];
    if (L <= 0x3C08) {
      _pushWarn(warnings, "fxp state too small for wavetable names (" + L + " bytes)");
    } else {
      var n1 = _fxpNameAt(st, L, 0x3C08);
      if (n1 === null) { _pushWarn(warnings, "fxp first wavetable name cut before its terminator"); }
      else if (n1) { refs.push({ module: "fxp", path: n1 }); }
      if (L > 0x3E08) {
        var n2 = _fxpNameAt(st, L, 0x3E08);
        if (n2 === null) { _pushWarn(warnings, "fxp second wavetable name cut before its terminator"); }
        else if (n2) { refs.push({ module: "fxp", path: n2 }); }
      } else {
        _pushWarn(warnings, "fxp state ends before the second wavetable name (" + L + " bytes)");
      }
    }
    return { ok: true, meta: meta, wtRefs: refs, warnings: warnings, error: "" };
  }

  /* ---------- sync probe ---------- */

  function _probe(input) {
    try {
      var u8 = _bytes(input);
      if (!u8) { return { ok: false, kind: "", name: "", error: "empty or unsupported input" }; }
      if (!u8.length) { return { ok: false, kind: "", name: "", error: "empty input" }; }
      if (u8.length >= 9 && _asEq(u8, 0, XFER_HDR)) {
        if (u8.length < 17) { return { ok: false, kind: "serum2", name: "", error: "truncated XferJson header" }; }
        var jlen = _u64le(u8, 9);
        if (!(jlen > 0) || jlen > JSON_CAP) {
          return { ok: false, kind: "serum2", name: "", error: "JSON metadata length out of range" };
        }
        if (u8.length < 17 + jlen) {
          return { ok: false, kind: "serum2", name: "", error: "truncated JSON metadata block" };
        }
        var meta = null;
        try { meta = JSON.parse(_utf8(u8.subarray(17, 17 + jlen))); } catch (e) { meta = null; }
        if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
          return { ok: false, kind: "serum2", name: "", error: "JSON metadata parse failed" };
        }
        var nm = (typeof meta.presetName === "string") ? meta.presetName : "";
        return { ok: true, kind: "serum2", name: nm, error: "" };
      }
      if (u8.length >= 20 && _asEq(u8, 0, "CcnK") && _asEq(u8, 8, "FPCh")) {
        if (!_asEq(u8, 16, "XfsX")) {
          var pid = _cstr(u8, 16, 4);
          return { ok: false, kind: "", name: "", error: "fxp plugin id " + pid + " is not Serum (XfsX)" };
        }
        var fname = (u8.length >= 56) ? _cstr(u8, 28, 28) : "";
        return { ok: true, kind: "fxp", name: fname, error: "" };
      }
      return { ok: false, kind: "", name: "", error: "unrecognized preset container" };
    } catch (e) {
      return { ok: false, kind: "", name: "", error: "probe failed (" + _msg(e) + ")" };
    }
  }

  /* ---------- async extract (never rejects) ---------- */

  function _extract(input) {
    var u8 = null;
    try { u8 = _bytes(input); } catch (e) { u8 = null; }
    if (!u8 || !u8.length) {
      return Promise.resolve({ ok: false, meta: null, wtRefs: [], warnings: [], error: "empty or unsupported input" });
    }
    if (u8.length >= 9 && _asEq(u8, 0, XFER_HDR)) {
      return _serum2(u8).catch(function (e) { return _crash(e); });
    }
    if (u8.length >= 20 && _asEq(u8, 0, "CcnK") && _asEq(u8, 8, "FPCh") && _asEq(u8, 16, "XfsX")) {
      return _fxp(u8).catch(function (e) { return _crash(e); });
    }
    return Promise.resolve({ ok: false, meta: null, wtRefs: [], warnings: [], error: "unrecognized preset container" });
  }

  return { probe: _probe, extract: _extract };
})();
