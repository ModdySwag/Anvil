/* av_rex.js -- Anvil R15b SAMPLE PACKS wave (child B, budget item): REX2 (.rx2) reader and
   DWOP decoder for the import pipeline.
   Contract: verify/_r15b_wave.md sections 2, 3, 4.2, 6.4; spec summary in
   research/import/02-ni-rex2.md section 2.1 (VelociLoops Unlicense docs/format.md). This file is
   a self-authored port of the Unlicense DWOP algorithm; no third-party code ships, and no
   provenance bytes from the spec or its fixtures are embedded here.

   WHAT THIS FILE IS
   - AV_REX_VERSION = "r15b.0" (pin); AVRex = the module facade (const object).
   - AVRex.probe(u8) -> { ok, slices, rate, frames, bits, channels, tempo, bars, decodable, error }
     IFF/CIFF walker over the CAT REX2 container: HEAD (magic 0x490cf18d, version byte <= 3),
     GLOB (slice count, bars/beats, time signature, sensitivity, gate, gain, preview tempo x1000),
     CAT SLCL with one SLCE per slice (start frame, length, analyze points, flags), SINF
     (channels, depth code, sample rate, frame count, loop start/end). No DWOP decode.
     - slices = the VISIBLE slice count -- the same slice-sequence pass AVRex.decode applies, so
       probe and decode always agree on the list (stored SLCE count can differ; GLOB's stored
       count is reported through a decode warning when it mismatches).
     - tempo = GLOB preview tempo as BPM (stored x1000 divided by 1000).
     - bits = 8 for SINF code 1, 16 for 3, 24 for 5, 32 for 7; decodable = code is 3 or 5.
       8-bit and 32f probe ok but decode refuses honestly (the pipeline then falls back to the
       sibling-WAV note).
   - AVRex.decode(u8) -> { ok, rate, frames, channels, bits, ch1, ch2, slices, tempo, warnings,
     error }
     Full SDAT/DWOP decode: MSB-first bitreader over big-endian 32-bit words, five predictor
     deltas plus five running averages selecting one of five integration-order predictors,
     adaptive prefix/remainder residual coding (state j / rbits), stereo coded as left plus side
     channel sharing one bitreader, integer PCM halved from the stored 2x domain, normalized to
     Float32 planar arrays (divide by 32768 for 16-bit, 8388608 for 24-bit). ch1 = left or mono;
     ch2 = right or null. slices = array of { start, len } frame ranges into the one decoded
     waveform (post visibility pass, matching the official SDK slice list). warnings = honest
     notes; error = "" when ok, else the reason.

   LAWS kept: "use strict"; classic script, no modules; DOM-free at top level (plain-node safe,
   no top-level side effects); never throws (every entry point returns an object, with a truthful
   error string when it cannot deliver); ASCII-only source; one namespace (avRex* helpers,
   AV_REX_* constants); block-comment prose never contains a comment-close sequence; no sibling
   module is touched. Caps: slice list 1024 entries and decode block 0x100000 frames (reference
   decoder caps); decode additionally refuses frame counts beyond AV_REX_FRAME_CAP with an honest
   error (probe stays header-honest). The DWOP predictor state carries across decode blocks;
   per-block j/rbits reset exactly like the reference decoder.

   Error strings (stable, honest):
   - "no bytes" -- input was not a byte source
   - "not a REX2 file: CAT /REX2 magic missing"
   - "corrupt: <detail>" -- chunk runs past EOF, HEAD magic/version, GLOB size/tempo, SINF
     missing/short/zero frames, SDAT missing, empty DWOP payload
   - "unsupported bit depth: ..." -- 8-bit (code 1), 32-bit float (code 7), or unknown code
   - "DWOP stream ended early (frame F of N)" / "DWOP prefix overflow at frame F (corrupt stream)"
   - "frame count N is beyond the decode cap (16777216 frames)"
   Verified in scratch (cache/r15b/rex harness): spec DWOP first words and the frame-322 anchor,
   the reference slice lists (sensitivity/gate/synthetic-leading cases), and the reference
   rejection fixtures; details in the R15b record. */

"use strict";

/* ---------- pins + caps ---------- */

const AV_REX_VERSION = "r15b.0";
const AV_REX_SLICE_MAX = 1024;      /* reference decoder's SLCE list cap */
const AV_REX_BLOCK = 0x100000;      /* reference decode block, frames */
const AV_REX_FRAME_CAP = 16777216;  /* 16M frames: ~6 min at 44.1 kHz, browser-sane */
const AV_REX_CAT_DEPTH = 8;         /* nested CAT scan depth cap (safety) */

/* ---------- small helpers (never throw) ---------- */

function avRexBe32(b, o) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function avRexBe16(b, o) {
  return (b[o] << 8) | b[o + 1];
}

function avRexErrText(e) {
  try {
    if (e && typeof e.message === "string" && e.message) return e.message;
  } catch (x) { /* fall through */ }
  return "internal error";
}

/* Accept Uint8Array (Buffer is one), ArrayBuffer, any typed-array view, or a plain array of
   byte numbers. Anything else -> null (honest refusal, no throw). */
function avRexToU8(x) {
  try {
    if (x == null) return null;
    if (typeof x === "string" || typeof x === "number") return null;
    if (typeof Uint8Array !== "undefined" && x instanceof Uint8Array) return x;
    if (typeof ArrayBuffer !== "undefined" && x instanceof ArrayBuffer) return new Uint8Array(x);
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(x)) {
      return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    }
    if (typeof x.length === "number") {
      const n = x.length >>> 0;
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const v = x[i];
        out[i] = (typeof v === "number" && isFinite(v)) ? (v & 255) : 0;
      }
      return out;
    }
  } catch (e) { return null; }
  return null;
}

function avRexClamp32(v) {
  if (v > 2147483647) return 2147483647;
  if (v < -2147483648) return -2147483648;
  return v | 0;
}

function avRexAdd32(a, b) { return avRexClamp32(a + b); }
function avRexSub32(a, b) { return avRexClamp32(a - b); }

/* one's-complement magnitude used by the average tracker: -1 -> 0, -2 -> 1 */
function avRexMag(v) { return (v ^ (v >> 31)) >>> 0; }

/* ---------- container walk ---------- */

function avRexParse(u8) {
  const p = {
    ok: false, error: "", warnings: [],
    head: null, glob: null, sinf: null,
    slce: [], sdatOff: -1, sdatSize: 0,
    decodable: false, depthCode: 0, globSliceCount: 0
  };
  try {
    const n = u8.length;
    if (n < 12) { p.error = "corrupt: too short to be a REX2 file (" + n + " bytes)"; return p; }
    if (!(u8[0] === 0x43 && u8[1] === 0x41 && u8[2] === 0x54 && u8[3] === 0x20) ||
        !(u8[8] === 0x52 && u8[9] === 0x45 && u8[10] === 0x58 && u8[11] === 0x32)) {
      p.error = "not a REX2 file: CAT /REX2 magic missing";
      return p;
    }

    const bad = function (msg) { if (!p.error) p.error = msg; return false; };

    const parseHead = function (pay, sz) {
      if (sz < 6) return bad("corrupt: HEAD chunk too short (" + sz + " bytes)");
      if (avRexBe32(u8, pay) !== 0x490cf18d) return bad("corrupt: HEAD magic mismatch");
      if (u8[pay + 4] !== 0xbc) return bad("corrupt: HEAD version byte is not 0xbc");
      if (u8[pay + 5] > 3) return bad("unsupported REX2 version (HEAD byte " + u8[pay + 5] + ")");
      p.head = { version: u8[pay + 5] };
      return true;
    };

    const parseGlob = function (pay, sz) {
      if (sz < 22) return bad("corrupt: GLOB chunk too short (" + sz + " bytes)");
      const tempo = avRexBe32(u8, pay + 16);
      if (tempo < 20000 || tempo > 450000) {
        return bad("corrupt: GLOB tempo out of range (" + tempo + ")");
      }
      p.globSliceCount = avRexBe32(u8, pay);
      p.glob = {
        slices: p.globSliceCount,
        bars: avRexBe16(u8, pay + 4),
        beats: u8[pay + 6],
        tsigNum: u8[pay + 7],
        tsigDen: u8[pay + 8],
        sensitivity: u8[pay + 9],
        gate: avRexBe16(u8, pay + 10),
        gain: avRexBe16(u8, pay + 12),
        tempoMilli: tempo
      };
      return true;
    };

    const parseSinf = function (pay, sz) {
      if (sz < 18) return bad("corrupt: SINF chunk too short (" + sz + " bytes)");
      const code = u8[pay + 1];
      let ch = u8[pay];
      if (ch !== 1 && ch !== 2) {
        p.warnings.push("SINF channel count " + ch + " is not 1 or 2 - treated as 1");
        ch = 1;
      }
      p.depthCode = code;
      p.decodable = (code === 3 || code === 5);
      p.sinf = {
        channels: ch,
        code: code,
        bits: code === 1 ? 8 : (code === 5 ? 24 : (code === 7 ? 32 : 16)),
        rate: avRexBe32(u8, pay + 2),
        frames: avRexBe32(u8, pay + 6),
        loopStart: avRexBe32(u8, pay + 10),
        loopEnd: avRexBe32(u8, pay + 14)
      };
      return true;
    };

    const parseSlce = function (pay, sz) {
      if (p.slce.length >= AV_REX_SLICE_MAX) {
        if (p.slce.length === AV_REX_SLICE_MAX) {
          p.warnings.push("slice cap " + AV_REX_SLICE_MAX + " reached - extra SLCE entries ignored");
        }
        return true;
      }
      if (sz < 10) { p.warnings.push("SLCE chunk too short (" + sz + " bytes) - skipped"); return true; }
      const flags = sz > 10 ? u8[pay + 10] : 0;
      p.slce.push({
        start: avRexBe32(u8, pay),
        len: avRexBe32(u8, pay + 4),
        points: avRexBe16(u8, pay + 8),
        selected: (flags & 0x04) ? 1 : 0,
        state: (flags & 0x02) ? 3 : ((flags & 0x01) ? 2 : 1)
      });
      return true;
    };

    const walk = function (start, end, depth) {
      let off = start;
      let guard = 0;
      while (off + 8 < end && off + 8 < n) {
        guard += 1;
        if (guard > 65536) { p.warnings.push("chunk scan limit reached"); return true; }
        const id = String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
        const sz = avRexBe32(u8, off + 4);
        const pay = off + 8;
        if (sz === 0) { p.warnings.push("zero-size chunk \"" + id + "\" - scan stopped"); return true; }
        if (pay + sz > n) {
          return bad("corrupt: chunk \"" + id + "\" size " + sz + " runs past the end of the file");
        }
        if (id === "HEAD") { if (!parseHead(pay, sz)) return false; }
        else if (id === "GLOB") { if (!parseGlob(pay, sz)) return false; }
        else if (id === "SINF") { if (!parseSinf(pay, sz)) return false; }
        else if (id === "SLCE") { if (!parseSlce(pay, sz)) return false; }
        else if ((id === "SDAT" || id === "DWOP") && p.sdatOff < 0) {
          p.sdatOff = pay;
          p.sdatSize = sz;
        }
        else if (id === "CAT " && sz >= 4) {
          if (depth >= AV_REX_CAT_DEPTH) { p.warnings.push("CAT nesting depth limit reached"); }
          else if (!walk(pay + 4, pay + sz, depth + 1)) return false;
        }
        off = pay + sz;
        if (off & 1) off += 1;
      }
      return true;
    };

    if (!walk(12, n, 0)) return p;

    if (!p.head) p.warnings.push("HEAD chunk missing");
    if (!p.sinf) { bad("corrupt: missing SINF chunk"); return p; }
    if (p.sinf.frames === 0) { bad("corrupt: SINF reports zero frames"); return p; }
    if (p.sdatOff < 0 || p.sdatSize <= 0) { bad("corrupt: no SDAT audio payload"); return p; }
    if (p.sdatOff + p.sdatSize > n) {
      bad("corrupt: SDAT payload extends past the end of the file");
      return p;
    }
    if (p.glob && p.glob.slices !== p.slce.length) {
      p.warnings.push("GLOB slice count " + p.glob.slices + " does not match " + p.slce.length +
        " SLCE entries (using SLCE)");
    }
    p.ok = true;
  } catch (e) {
    p.ok = false;
    p.error = avRexErrText(e);
  }
  return p;
}

/* ---------- slice sequence pass (visibility + derived lengths) ---------- */

function avRexFilterPoints(sens) {
  const s = Math.min(sens, 99);
  const visibleRange = Math.floor((s * 0x7fff + 98) / 99);
  return 0x7fff - visibleRange;
}

function avRexGateFrames(gateSens, rate) {
  if (gateSens === 0) return 0;
  const sr = rate > 0 ? rate : 44100;
  let frames = Math.floor((gateSens * sr + 4500) / 9000);
  if (frames < 1) frames = 1;
  return Math.max(1, Math.floor((frames + 64) / 128) * 128);
}

function avRexSlices(p) {
  const out = [];
  try {
    const sinf = p.sinf;
    if (!sinf) return out;
    const glob = p.glob;
    const totalFrames = sinf.frames;
    const loopStart = sinf.loopStart;
    const loopEnd = sinf.loopEnd;
    const loops = loopEnd > loopStart;
    const gateSens = glob ? glob.gate : 0;
    const filterPts = avRexFilterPoints(glob ? glob.sensitivity : 0);
    const gateFrames = avRexGateFrames(gateSens, sinf.rate);

    const list = p.slce.slice(0);
    list.sort(function (a, b) { return a.start - b.start; });

    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (loops && s.start < totalFrames && s.start >= loopEnd) continue;
      if (!(s.len > 1 || s.selected || s.state !== 1 || s.points > filterPts)) continue;
      out.push({ start: s.start, len: s.len, stored: s.len });
    }

    for (let i = 0; i < out.length; i++) {
      const start = out[i].start;
      let next = (loops && start < loopEnd) ? loopEnd : totalFrames;
      for (let j = i + 1; j < out.length; j++) {
        if (out[j].start > start) { next = out[j].start; break; }
      }
      const derived = next > start ? next - start : 1;
      if (gateSens === 0 || out[i].stored <= 1) {
        out[i].len = derived;
        if (gateSens !== 0 && gateFrames > 0) out[i].len = Math.min(out[i].len, gateFrames);
      } else if (derived > 1) {
        out[i].len = Math.min(out[i].stored, derived);
      }
      if (out[i].len < 1) out[i].len = 1;
    }

    if (out.length > 0 && loops && out[0].start > loopStart && out[0].start <= totalFrames) {
      out.unshift({ start: loopStart, len: out[0].start - loopStart, stored: out[0].start - loopStart });
    }
  } catch (e) { /* keep whatever was built; slicing metadata is best-effort, never fatal */ }
  const clean = new Array(out.length);
  for (let i = 0; i < out.length; i++) clean[i] = { start: out[i].start, len: out[i].len };
  return clean;
}

/* ---------- DWOP bitstream ---------- */

/* MSB-first reader over big-endian 32-bit words. br.dead = the stream ran out (or a read was out
   of range) -- callers abort the decode with an honest error; the reference decoder treats the
   same situation as end-of-input. */
function avRexDwopGetBit(br) {
  if (br.dead) return 0;
  const before = br.bl;
  br.bl = before - 1;
  if (before - 1 < 0) {
    if (br.off + 4 > br.end) { br.dead = true; return 0; }
    br.word = avRexBe32(br.u8, br.off);
    br.off += 4;
    br.bl = 31;
  }
  const bit = br.word >>> 31;
  br.word = (br.word << 1) >>> 0;
  return bit;
}

function avRexDwopGetBits(br, n) {
  if (br.dead) return 0;
  if (n <= 0 || n > 31) { br.dead = true; return 0; }
  let result = br.word >>> (32 - n);
  br.word = (br.word << n) >>> 0;
  const before = br.bl;
  br.bl = before - n;
  if (before - n < 0) {
    if (br.off + 4 > br.end) { br.dead = true; return result >>> 0; }
    const next = avRexBe32(br.u8, br.off);
    br.off += 4;
    br.bl = br.bl + 32;
    result = (result | (next >>> br.bl)) >>> 0;
    br.word = (next << (32 - br.bl)) >>> 0;
  }
  return result >>> 0;
}

/* one of five integration-order predictors; mutates the delta history in d[0..4]; returns the
   new doubled-domain sample. All sums clamp to int32 like the reference. */
function avRexDwopPredict(idx, s2x, d) {
  const d0 = d[0], d1 = d[1], d2 = d[2], d3 = d[3];
  if (idx === 0) {
    const t0 = avRexSub32(s2x, d0);
    const t1 = avRexSub32(t0, d1);
    const t2 = avRexSub32(t1, d2);
    d[4] = avRexSub32(t2, d3); d[3] = t2; d[2] = t1; d[1] = t0; d[0] = s2x;
    return s2x;
  }
  if (idx === 1) {
    const t1 = avRexSub32(s2x, d1);
    const t2 = avRexSub32(t1, d2);
    const nd0 = avRexAdd32(d0, s2x);
    d[4] = avRexSub32(t2, d3); d[3] = t2; d[2] = t1; d[1] = s2x; d[0] = nd0;
    return nd0;
  }
  if (idx === 2) {
    const nd1 = avRexAdd32(d1, s2x);
    const nd0 = avRexAdd32(d0, nd1);
    const t = avRexSub32(s2x, d2);
    d[4] = avRexSub32(t, d3); d[3] = t; d[2] = s2x; d[1] = nd1; d[0] = nd0;
    return nd0;
  }
  if (idx === 3) {
    const nd2 = avRexAdd32(d2, s2x);
    const nd1 = avRexAdd32(d1, nd2);
    const nd0 = avRexAdd32(d0, nd1);
    d[4] = avRexSub32(s2x, d3); d[3] = s2x; d[2] = nd2; d[1] = nd1; d[0] = nd0;
    return nd0;
  }
  const nd3 = avRexAdd32(d3, s2x);
  const nd2 = avRexAdd32(d2, nd3);
  const nd1 = avRexAdd32(d1, nd2);
  const nd0 = avRexAdd32(d0, nd1);
  d[4] = s2x; d[3] = nd3; d[2] = nd2; d[1] = nd1; d[0] = nd0;
  return nd0;
}

/* decode one block of a mono coded channel; returns null, or { fail, at } on stream failure.
   d/a/j/rbits are locals like the reference: j/rbits reset per block call, delta/average state
   carries through st. */
function avRexDwopBlockMono(br, st, cnt, out, base, depth) {
  const d = [st.d[0] * 2 | 0, st.d[1] * 2 | 0, st.d[2] * 2 | 0, st.d[3] * 2 | 0, st.d[4] * 2 | 0];
  const a = [st.a[0] >>> 0, st.a[1] >>> 0, st.a[2] >>> 0, st.a[3] >>> 0, st.a[4] >>> 0];
  let j = 2;
  let rbits = 0;
  const maxS = depth === 24 ? 8388607 : 32767;
  const minS = depth === 24 ? -8388608 : -32768;
  const scale = depth === 24 ? 1 / 8388608 : 1 / 32768;

  for (let f = 0; f < cnt; f++) {
    let minAvg = a[0], idx = 0;
    if (a[1] < minAvg) { minAvg = a[1]; idx = 1; }
    if (a[2] < minAvg) { minAvg = a[2]; idx = 2; }
    if (a[3] < minAvg) { minAvg = a[3]; idx = 3; }
    if (a[4] < minAvg) { minAvg = a[4]; idx = 4; }

    let step = ((((minAvg * 3) >>> 0) + 36) >>> 0) >>> 7;
    let prefix = 0;
    let zerosWin = 7;
    for (;;) {
      const bit = avRexDwopGetBit(br);
      if (br.dead) return { fail: "eof", at: base + f };
      if (bit) break;
      if (step > 0 && prefix > 4294967295 - step) return { fail: "overflow", at: base + f };
      prefix = (prefix + step) >>> 0;
      zerosWin -= 1;
      if (zerosWin === 0) { step = (step << 2) >>> 0; zerosWin = 7; }
    }

    if (step < j) {
      for (let jt = j >>> 1; step < jt; jt >>>= 1) { j = jt; rbits -= 1; }
    } else {
      while (step >= j) {
        const prev = j;
        j = (j << 1) >>> 0;
        rbits += 1;
        if (j <= prev) { j = prev; break; }
      }
    }

    let rem = 0;
    if (rbits > 0) {
      rem = avRexDwopGetBits(br, rbits);
      if (br.dead) return { fail: "eof", at: base + f };
    }
    const thresh = j - step;
    if (rem - thresh >= 0) {
      const extra = avRexDwopGetBits(br, 1);
      if (br.dead) return { fail: "eof", at: base + f };
      rem = (rem * 2 - thresh + extra) >>> 0;
    }

    const codeVal = (rem + prefix) >>> 0;
    const signed2x = ((-(codeVal & 1)) ^ (codeVal | 0)) | 0;
    const s2x = avRexDwopPredict(idx, signed2x, d);
    let v = s2x >> 1;
    if (v > maxS) v = maxS; else if (v < minS) v = minS;
    out[base + f] = v * scale;

    a[0] = (a[0] + avRexMag(d[0]) - (a[0] >>> 5)) >>> 0;
    a[1] = (a[1] + avRexMag(d[1]) - (a[1] >>> 5)) >>> 0;
    a[2] = (a[2] + avRexMag(d[2]) - (a[2] >>> 5)) >>> 0;
    a[3] = (a[3] + avRexMag(d[3]) - (a[3] >>> 5)) >>> 0;
    a[4] = (a[4] + avRexMag(d[4]) - (a[4] >>> 5)) >>> 0;
  }

  for (let i = 0; i < 5; i++) { st.d[i] = d[i] >> 1; st.a[i] = a[i]; }
  return null;
}

/* stereo: two coded channel states in one bitstream; channel 0 is left, channel 1 is the side
   value (right - left). Returns null, or { fail, at }. */
function avRexDwopBlockStereo(br, stL, stR, cnt, outL, outR, base, depth) {
  const d = [
    [stL.d[0] * 2 | 0, stL.d[1] * 2 | 0, stL.d[2] * 2 | 0, stL.d[3] * 2 | 0, stL.d[4] * 2 | 0],
    [stR.d[0] * 2 | 0, stR.d[1] * 2 | 0, stR.d[2] * 2 | 0, stR.d[3] * 2 | 0, stR.d[4] * 2 | 0]
  ];
  const a = [
    [stL.a[0] >>> 0, stL.a[1] >>> 0, stL.a[2] >>> 0, stL.a[3] >>> 0, stL.a[4] >>> 0],
    [stR.a[0] >>> 0, stR.a[1] >>> 0, stR.a[2] >>> 0, stR.a[3] >>> 0, stR.a[4] >>> 0]
  ];
  const j = [2, 2];
  const rbits = [0, 0];
  const maxS = depth === 24 ? 8388607 : 32767;
  const minS = depth === 24 ? -8388608 : -32768;
  const scale = depth === 24 ? 1 / 8388608 : 1 / 32768;

  for (let f = 0; f < cnt; f++) {
    const x2 = [0, 0];
    for (let c = 0; c < 2; c++) {
      let minAvg = a[c][0], idx = 0;
      if (a[c][1] < minAvg) { minAvg = a[c][1]; idx = 1; }
      if (a[c][2] < minAvg) { minAvg = a[c][2]; idx = 2; }
      if (a[c][3] < minAvg) { minAvg = a[c][3]; idx = 3; }
      if (a[c][4] < minAvg) { minAvg = a[c][4]; idx = 4; }

      let step = ((((minAvg * 3) >>> 0) + 36) >>> 0) >>> 7;
      let prefix = 0;
      let zerosWin = 7;
      for (;;) {
        const bit = avRexDwopGetBit(br);
        if (br.dead) return { fail: "eof", at: base + f };
        if (bit) break;
        if (step > 0 && prefix > 4294967295 - step) return { fail: "overflow", at: base + f };
        prefix = (prefix + step) >>> 0;
        zerosWin -= 1;
        if (zerosWin === 0) { step = (step << 2) >>> 0; zerosWin = 7; }
      }

      if (step < j[c]) {
        for (let jt = j[c] >>> 1; step < jt; jt >>>= 1) { j[c] = jt; rbits[c] -= 1; }
      } else {
        while (step >= j[c]) {
          const prev = j[c];
          j[c] = (j[c] << 1) >>> 0;
          rbits[c] += 1;
          if (j[c] <= prev) { j[c] = prev; break; }
        }
      }

      let rem = 0;
      if (rbits[c] > 0) {
        rem = avRexDwopGetBits(br, rbits[c]);
        if (br.dead) return { fail: "eof", at: base + f };
      }
      const thresh = j[c] - step;
      if (rem - thresh >= 0) {
        const extra = avRexDwopGetBits(br, 1);
        if (br.dead) return { fail: "eof", at: base + f };
        rem = (rem * 2 - thresh + extra) >>> 0;
      }

      const codeVal = (rem + prefix) >>> 0;
      const signed2x = ((-(codeVal & 1)) ^ (codeVal | 0)) | 0;
      x2[c] = avRexDwopPredict(idx, signed2x, d[c]);

      a[c][0] = (a[c][0] + avRexMag(d[c][0]) - (a[c][0] >>> 5)) >>> 0;
      a[c][1] = (a[c][1] + avRexMag(d[c][1]) - (a[c][1] >>> 5)) >>> 0;
      a[c][2] = (a[c][2] + avRexMag(d[c][2]) - (a[c][2] >>> 5)) >>> 0;
      a[c][3] = (a[c][3] + avRexMag(d[c][3]) - (a[c][3] >>> 5)) >>> 0;
      a[c][4] = (a[c][4] + avRexMag(d[c][4]) - (a[c][4] >>> 5)) >>> 0;
    }

    let vl = x2[0] >> 1;
    if (vl > maxS) vl = maxS; else if (vl < minS) vl = minS;
    outL[base + f] = vl * scale;

    let vr = Math.floor((x2[0] + x2[1]) / 2);
    if (vr > maxS) vr = maxS; else if (vr < minS) vr = minS;
    outR[base + f] = vr * scale;
  }

  for (let i = 0; i < 5; i++) {
    stL.d[i] = d[0][i] >> 1; stL.a[i] = a[0][i];
    stR.d[i] = d[1][i] >> 1; stR.a[i] = a[1][i];
  }
  return null;
}

function avRexDwopDecode(u8, off, size, frames, channels, depth) {
  const res = { ok: false, error: "", ch1: null, ch2: null };
  try {
    const words = Math.floor(size / 4);
    if (words <= 0) { res.error = "corrupt: empty DWOP payload"; return res; }
    const br = { u8: u8, off: off, end: off + words * 4, word: 0, bl: 0, dead: false };
    const st1 = { d: [0, 0, 0, 0, 0], a: [2560, 2560, 2560, 2560, 2560] };
    const st2 = { d: [0, 0, 0, 0, 0], a: [2560, 2560, 2560, 2560, 2560] };
    const ch1 = new Float32Array(frames);
    const ch2 = channels === 2 ? new Float32Array(frames) : null;

    let done = 0;
    while (done < frames) {
      const cnt = Math.min(AV_REX_BLOCK, frames - done);
      const fail = (channels === 2)
        ? avRexDwopBlockStereo(br, st1, st2, cnt, ch1, ch2, done, depth)
        : avRexDwopBlockMono(br, st1, cnt, ch1, done, depth);
      if (fail) {
        res.error = fail.fail === "eof"
          ? "DWOP stream ended early (frame " + fail.at + " of " + frames + ")"
          : "DWOP prefix overflow at frame " + fail.at + " (corrupt stream)";
        return res;
      }
      done += cnt;
    }
    res.ok = true;
    res.ch1 = ch1;
    res.ch2 = ch2;
  } catch (e) {
    res.ok = false;
    res.error = avRexErrText(e);
    res.ch1 = null;
    res.ch2 = null;
  }
  return res;
}

function avRexDepthError(code) {
  if (code === 1) {
    return "unsupported bit depth: 8-bit (SINF code 1) - only 16-bit (3) and 24-bit (5) DWOP decode";
  }
  if (code === 7) {
    return "unsupported bit depth: 32-bit float (SINF code 7) - only 16-bit (3) and 24-bit (5) DWOP decode";
  }
  return "unsupported bit depth: SINF code " + code + " - only 16-bit (3) and 24-bit (5) DWOP decode";
}

/* ---------- facade ---------- */

const AVRex = {

  probe: function (x) {
    const out = {
      ok: false, slices: 0, rate: 0, frames: 0, bits: 0, channels: 0,
      tempo: 0, bars: 0, decodable: false, error: ""
    };
    try {
      const u8 = avRexToU8(x);
      if (!u8) { out.error = "no bytes"; return out; }
      const p = avRexParse(u8);
      if (!p.ok) { out.error = p.error; return out; }
      const sl = avRexSlices(p);
      out.ok = true;
      out.slices = sl.length;
      out.rate = p.sinf.rate;
      out.frames = p.sinf.frames;
      out.bits = p.sinf.bits;
      out.channels = p.sinf.channels;
      out.tempo = p.glob ? p.glob.tempoMilli / 1000 : 120;
      out.bars = p.glob ? p.glob.bars : 1;
      out.decodable = p.decodable;
    } catch (e) {
      out.ok = false;
      out.error = avRexErrText(e);
    }
    return out;
  },

  decode: function (x) {
    const out = {
      ok: false, rate: 0, frames: 0, channels: 0, bits: 0,
      ch1: null, ch2: null, slices: [], tempo: 0, warnings: [], error: ""
    };
    try {
      const u8 = avRexToU8(x);
      if (!u8) { out.error = "no bytes"; return out; }
      const p = avRexParse(u8);
      out.warnings = p.warnings.slice(0);
      if (!p.ok) { out.error = p.error; return out; }

      const sl = avRexSlices(p);
      out.rate = p.sinf.rate;
      out.frames = p.sinf.frames;
      out.channels = p.sinf.channels;
      out.bits = p.sinf.bits;
      out.tempo = p.glob ? p.glob.tempoMilli / 1000 : 120;
      out.slices = sl;

      if (!p.decodable) { out.error = avRexDepthError(p.depthCode); return out; }
      if (p.sinf.frames > AV_REX_FRAME_CAP) {
        out.error = "frame count " + p.sinf.frames + " is beyond the decode cap (" +
          AV_REX_FRAME_CAP + " frames)";
        return out;
      }

      const d = avRexDwopDecode(u8, p.sdatOff, p.sdatSize, p.sinf.frames, p.sinf.channels, p.sinf.bits);
      if (!d.ok) { out.error = d.error; return out; }
      out.ok = true;
      out.ch1 = d.ch1;
      out.ch2 = d.ch2;
    } catch (e) {
      out.ok = false;
      out.ch1 = null;
      out.ch2 = null;
      out.error = avRexErrText(e);
    }
    return out;
  }
};
