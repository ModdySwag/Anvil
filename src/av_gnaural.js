/* Anvil -- .gnaural clean-room core (PLATFORM wave, C1): tolerant session-XML parse, general
   zip reader, session extraction from packs, info summary, and a deterministic offline
   renderer (pure loop, no AudioContext).

   CLEAN-ROOM REIMPLEMENTATION. The .gnaural file format is by Gnaural
   (gnaural.sourceforge.net), semantics learned from the format + observed behaviour of preset
   files; reimplemented clean-room for Anvil. The Resonance app that also consumes .gnaural
   carries GPL lineage -- no code was copied from it or from any other implementation.

   Pins (verify/_platform_wave.md §2.5):

   - avGnParse(xmlText) -> { ok, error?, session }
     session = { title, description, author, totalSeconds, voiceCount, voices: [{ index, type,
     typeName, state, mono, mute, duration, playable, entries: [{ duration, volL, volR, beat,
     base }] }], warnings[] }.
     Types: 0 binaural, 1 pink noise, 2 PCM file, 3/4 isopulse, 5/6 other Gnaural ext, 7 white
     noise, 8 brown noise (7/8 are Resonance extension types). playable = 0/7/8 (v1 renderer).
     Tolerant: unknown fields ignored, numbers via tolerant float parse, empty <entries> warns,
     a voice's entry list is capped at 4096 (extra entries dropped with a warning). Voices are
     matched from consecutive entries by `parent` where ids line up (the upstream loader is
     flat; <voice>/<entries> nesting is cosmetic); otherwise consecutive parent runs are paired
     with <voice> blocks by document order. Header counts (voicecount/totalentrycount/totaltime)
     are advisory only -- durations derive from entry sums, totalSeconds = max voice duration.
     state stays the raw voice_state number (truthiness decides rendering); mute/mono booleans.

   - avGnUnzip(arrayBuffer) -> Promise<{ ok, error?, files: [{ name, bytes(Uint8Array) }],
     errors[] }>. General zip READER: comment-aware EOCD scan, central-directory walk, STORE (0)
     = slice, DEFLATE (8) = DecompressionStream("deflate-raw") (absent/unusable -> honest
     per-entry error), CRC-32 check only when avZipCrc32 is available (typeof-guarded; never a
     hard dependency). Folder names kept verbatim; non-.gnaural entries pass through (caller
     filters). zip64 and encrypted entries -> honest refusals (zip64 refuses the archive,
     encrypted entries are skipped with an error each); a per-entry size sanity cap applies.

   - avGnSessionsFromZip(zipBuf) -> Promise<{ ok, error?, sessions: [{ name, xml, bytes }],
     errors[] }>. Filters `.gnaural` entries case-insensitively, decodes UTF-8 BOM-tolerant.

   - avGnInfo(session) -> { totalSeconds, voiceCount, playableVoices, types[], renderable }.
     playableVoices counts voices actually renderable by v1 (state-truthy, unmuted, type 0/7/8);
     types[] is every type present, ascending; renderable = playableVoices > 0.

   - avGnRender(session, opts) -> Promise<{ ok, error?, sr, seconds, frames, l, r, warnings[] }>
     with l/r Float32Array. Render set = state-truthy, unmuted voices; timeline = max voice
     duration over that set; length = min(timeline, opts.maxSeconds), default 120 s, hard cap
     600 s; opts.frames overrides the length for harnesses (still hard-capped at 600 sr).
     sr default 48000 (opts.sr honored within 1 kHz..384 kHz). Parameter curve pin: value at
     t = linear interpolation where entry k's values are REACHED at the cumulative end of entry
     k; entry 0's values hold over its own span; values hold past the last entry; a voice keeps
     sounding across the whole render window (the held tail, upstream's voice-stretch spirit).
     Type 0 binaural: left sine at base - beat/2, right sine at base + beat/2, phase-continuous,
     frequency updated per sample along the ramp (magnitude clamped at Nyquist; a negative
     carrier wraps the phase backwards rather than rectifying to DC). Type 7 white noise:
     seeded xorshift32, deterministic per parse -- seed from the FNV-1a hash of session.title
     mixed with the voice index. Type 8 brown noise: leaky-integrated white (leak 0.02, output
     gain 10 = near RMS parity with the white voice). Amplitude = ramped volL/volR clamped to
     0..1, summed across voices. Headroom pin: sum first; only when the absolute peak exceeds
     0.95, scale both channels by 0.9/maxAbs and record a warning (nothing else is clamped).

   Craft laws: "use strict", classic script (no modules/imports), node-loadable (no DOM reach at
   load, no top-level side effects), one namespace (avGn* + AV_GN_*), never throws, no console
   output, ASCII where practical. */

"use strict";

const AV_GN_VERSION = "platform.0";
const AV_GN_FORMAT_VERSION = "1.20101006";      /* gnauralfile_version written by Gnaural */
const AV_GN_SR_DEFAULT = 48000;
const AV_GN_SR_MIN = 1000;
const AV_GN_SR_MAX = 384000;
const AV_GN_MAX_SECONDS = 120;                  /* §2.5 preview cap */
const AV_GN_HARD_CAP_SECONDS = 600;             /* §2.5 hard cap */
const AV_GN_MAX_ENTRIES = 4096;                 /* per voice, §2.5 parse cap */
const AV_GN_HEADROOM_FLOOR = 0.95;              /* §2.5: scale only above this */
const AV_GN_HEADROOM_TARGET = 0.9;              /* §2.5: scale to this */
const AV_GN_NOISE_LEAK = 0.02;                  /* brown integrator leak */
const AV_GN_NOISE_GAIN = 10;                    /* brown output gain (RMS parity) */
const AV_GN_ENTRY_LIMIT = 256 * 1024 * 1024;    /* zip entry sanity cap, bytes */
const AV_GN_TWO_PI = Math.PI * 2;

const AV_GN_PLAYABLE_TYPES = { 0: true, 7: true, 8: true };
const AV_GN_TYPE_NAMES = {
  0: "binaural", 1: "pink noise", 2: "PCM file", 3: "isopulse", 4: "isopulse",
  5: "gnaural ext", 6: "gnaural ext", 7: "white noise", 8: "brown noise"
};

/* ---------- generic helpers (never throw) ---------- */

function avGnBytes(x) {
  try {
    if (x === null || x === undefined) return null;
    if (typeof ArrayBuffer !== "undefined" && x instanceof ArrayBuffer) return new Uint8Array(x);
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(x)) {
      return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    }
    return null;
  } catch (e) { return null; }
}

function avGnNum(v, dflt) {
  if (v === undefined || v === null || v === "") return dflt;
  const f = parseFloat(v);
  return isFinite(f) ? f : dflt;
}

function avGnInt(v, dflt) {
  const f = avGnNum(v, null);
  return f === null ? dflt : Math.round(f);
}

function avGnClamp01(x) {
  if (!isFinite(x)) return 0;
  return x < 0 ? 0 : (x > 1 ? 1 : x);
}

function avGnFreqClamp(f, nyq) {
  if (!isFinite(f)) return 0;
  if (f > nyq) return nyq;
  if (f < -nyq) return -nyq;
  return f;
}

function avGnVoiceSeconds(v) {
  if (!v || typeof v !== "object") return 0;
  const d = avGnNum(v.duration, null);
  if (d !== null) return d > 0 ? d : 0;
  let acc = 0;
  const es = Array.isArray(v.entries) ? v.entries : [];
  for (let i = 0; i < es.length; i++) {
    const x = avGnNum(es[i] && es[i].duration, 0);
    if (x > 0) acc += x;
  }
  return acc;
}

/* ---------- tiny XML helpers (tolerant scanner; no DOM) ---------- */

function avGnStrip(src) {
  /* comments, processing instructions and declarations removed so tag scans never see them */
  return String(src)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\?[\s\S]*?\?>/g, " ")
    .replace(/<![\s\S]*?>/g, " ");
}

function avGnUnesc(s) {
  try {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) {
        const cp = parseInt(h, 16);
        return (isFinite(cp) && cp >= 0 && cp <= 0x10FFFF) ? String.fromCodePoint(cp) : "";
      })
      .replace(/&#(\d+);/g, function (_, d) {
        const cp = parseInt(d, 10);
        return (isFinite(cp) && cp >= 0 && cp <= 0x10FFFF) ? String.fromCodePoint(cp) : "";
      })
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  } catch (e) { return ""; }
}

function avGnTagText(src, name, dflt) {
  try {
    const re = new RegExp("<" + name + "(?=[\\s\\/>])[^>]*>([\\s\\S]*?)<\\/" + name + "\\s*>", "i");
    const m = re.exec(src);
    if (!m) return dflt;
    const t = avGnUnesc(m[1]).trim();
    return t === "" ? dflt : t;
  } catch (e) { return dflt; }
}

function avGnAttrs(s) {
  const out = {};
  try {
    const re = /([A-Za-z_][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(s)) !== null) out[m[1]] = avGnUnesc(m[2] !== undefined ? m[2] : m[3]);
  } catch (e) { /* partial attrs are fine */ }
  return out;
}

function avGnVoiceBlocks(src) {
  /* content of every <voice> element; self-closing voices yield "". <voicecount>/<voice_state>
     etc. never match because the char after "voice" must be space, "/" or ">". */
  const blocks = [];
  try {
    const tags = [];
    const re = /<voice(?=[\s\/>])[^>]*>/g;
    let m;
    while ((m = re.exec(src)) !== null) tags.push({ at: m.index, end: re.lastIndex, text: m[0] });
    for (let i = 0; i < tags.length; i++) {
      const stop = (i + 1 < tags.length) ? tags[i + 1].at : src.length;
      blocks.push(/\/>\s*$/.test(tags[i].text) ? "" : src.slice(tags[i].end, stop));
    }
  } catch (e) { /* partial list is fine */ }
  return blocks;
}

function avGnEntryTags(src) {
  const out = [];
  try {
    const re = /<entry(?=[\s\/>])[^>]*>/g;
    let m;
    while ((m = re.exec(src)) !== null) out.push(m[0]);
  } catch (e) { /* partial list is fine */ }
  return out;
}

/* ---------- UTF-8 decode (BOM-tolerant; TextDecoder when present, manual fallback) ---------- */

function avGnUtf8Decode(bytes) {
  try {
    let off = 0;
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) off = 3;
    const view = off > 0 ? bytes.subarray(off) : bytes;
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder("utf-8", { fatal: false }).decode(view);
    }
    /* manual tolerant decoder: invalid sequences become U+FFFD */
    let s = "", i = 0;
    while (i < view.length) {
      const c = view[i++];
      if (c < 0x80) { s += String.fromCharCode(c); continue; }
      let need = 0, cp = 0;
      if (c >= 0xC0 && c < 0xE0) { need = 1; cp = c & 0x1F; }
      else if (c >= 0xE0 && c < 0xF0) { need = 2; cp = c & 0x0F; }
      else if (c >= 0xF0 && c < 0xF8) { need = 3; cp = c & 0x07; }
      else { s += "\uFFFD"; continue; }
      let ok = true;
      for (let k = 0; k < need; k++) {
        const c2 = view[i];
        if (c2 === undefined || c2 < 0x80 || c2 > 0xBF) { ok = false; break; }
        cp = (cp << 6) | (c2 & 0x3F); i++;
      }
      if (!ok || cp > 0x10FFFF) { s += "\uFFFD"; continue; }
      if (cp < 0x10000) s += String.fromCharCode(cp);
      else { cp -= 0x10000; s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF)); }
    }
    return s;
  } catch (e) { return ""; }
}

/* ---------- raw DEFLATE inflate via DecompressionStream (honest refusal when absent) ---------- */

async function avGnInflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") {
    return { ok: false, error: "DecompressionStream is not available here" };
  }
  if (typeof ReadableStream === "undefined") {
    return { ok: false, error: "ReadableStream is not available here" };
  }
  let ds;
  try { ds = new DecompressionStream("deflate-raw"); }
  catch (e) { return { ok: false, error: "the deflate-raw format is not supported here" }; }
  try {
    const src = new ReadableStream({
      start: function (ctrl) { ctrl.enqueue(bytes); ctrl.close(); }
    });
    const reader = src.pipeThrough(ds).getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const r = await reader.read();
      if (!r || r.done) break;
      if (r.value && r.value.length) { chunks.push(r.value); total += r.value.length; }
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (let i = 0; i < chunks.length; i++) { out.set(chunks[i], o); o += chunks[i].length; }
    return { ok: true, error: null, bytes: out };
  } catch (e) { return { ok: false, error: "inflate failed" }; }
}

/* ---------- parse ---------- */

function avGnParse(xmlText) {
  try {
    if (typeof xmlText !== "string") return { ok: false, error: "input is not a string", session: null };
    let text = xmlText;
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    if (!text.trim()) return { ok: false, error: "empty input", session: null };

    const warnings = [];
    const clean = avGnStrip(text);

    const title = avGnTagText(clean, "title", "");
    const description = avGnTagText(clean, "schedule_description", "");
    const author = avGnTagText(clean, "author", "");

    const version = avGnTagText(clean, "gnauralfile_version", null);
    if (version !== null && version !== AV_GN_FORMAT_VERSION) {
      warnings.push("file claims format version " + version + " (expected " + AV_GN_FORMAT_VERSION + ") -- reading anyway");
    }
    if (!/<schedule(?=[\s\/>])/i.test(clean)) warnings.push("no <schedule> element -- parsing anyway");
    if (avGnTagText(clean, "loops", null) !== null) {
      const loops = avGnInt(avGnTagText(clean, "loops", null), null);
      if (loops === 0) warnings.push("loops=0 (infinite) -- v1 renders a single pass");
      else if (loops !== null && loops > 1) warnings.push("loops=" + loops + " -- v1 renders a single pass");
    }

    /* voice metadata blocks, document order */
    const blocks = avGnVoiceBlocks(clean);
    const meta = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      meta.push({
        id: avGnInt(avGnTagText(b, "id", null), null),
        type: avGnInt(avGnTagText(b, "type", null), 0),
        state: avGnInt(avGnTagText(b, "voice_state", null), 0),
        mute: avGnInt(avGnTagText(b, "voice_mute", null), 0) !== 0,
        mono: avGnInt(avGnTagText(b, "voice_mono", null), 0) !== 0,
        hasBlock: true
      });
    }
    if (blocks.length === 0) warnings.push("no <voice> blocks -- entries grouped by consecutive parent runs");

    /* entries, document order */
    const tags = avGnEntryTags(clean);
    const raw = [];
    for (let i = 0; i < tags.length; i++) {
      const a = avGnAttrs(tags[i]);
      const volL = avGnNum(a.volume_left, 1);
      const parent = (typeof a.parent === "string") ? a.parent.trim() : null;
      raw.push({
        parent: parent,
        duration: Math.max(0, avGnNum(a.duration, 0)),
        volL: volL,
        volR: avGnNum(a.volume_right, volL),
        beat: avGnNum(a.beatfreq, 0),
        base: avGnNum(a.basefreq, 0)
      });
    }
    if (raw.length === 0) {
      if (blocks.length === 0) return { ok: false, error: "no <voice> or <entry> elements found", session: null };
    }

    /* group entries into voices: by matching parent ids when they line up, else consecutive runs */
    let groups = [];
    if (raw.length > 0) {
      let byId = true;
      if (meta.length === 0) byId = false;
      for (let i = 0; i < meta.length && byId; i++) if (meta[i].id === null) byId = false;
      if (byId) {
        const idToGroup = {};
        for (let i = 0; i < meta.length; i++) if (idToGroup[meta[i].id] === undefined) idToGroup[meta[i].id] = i;
        for (let i = 0; i < raw.length; i++) {
          const p = (raw[i].parent === null) ? null : avGnNum(raw[i].parent, null);
          if (p === null || idToGroup[p] === undefined) { byId = false; break; }
        }
      }
      if (byId) {
        groups = meta.map(function () { return []; });
        const idToGroup = {};
        for (let i = 0; i < meta.length; i++) if (idToGroup[meta[i].id] === undefined) idToGroup[meta[i].id] = i;
        for (let i = 0; i < raw.length; i++) groups[idToGroup[avGnNum(raw[i].parent, 0)]].push(raw[i]);
      } else {
        let cur = null, curKey = null;
        for (let i = 0; i < raw.length; i++) {
          const key = raw[i].parent === null ? "" : raw[i].parent;
          if (cur === null || key !== curKey) { cur = []; curKey = key; groups.push(cur); }
          cur.push(raw[i]);
        }
      }
    }

    const voices = [];
    const nGroups = Math.max(groups.length, meta.length);
    for (let i = 0; i < nGroups; i++) {
      const m = meta[i] || {};
      const mtype = m.hasBlock ? m.type : 0;
      const mstate = m.hasBlock ? m.state : 1;   /* synthesized flat-file voice: enabled */
      const mmute = m.hasBlock ? m.mute : false;
      const mmono = m.hasBlock ? m.mono : false;
      let entries = groups[i] || [];
      if (entries.length > AV_GN_MAX_ENTRIES) {
        warnings.push("voice #" + i + ": " + entries.length + " entries exceed the " + AV_GN_MAX_ENTRIES + " cap -- extra entries dropped");
        entries = entries.slice(0, AV_GN_MAX_ENTRIES);
      }
      let duration = 0;
      for (let k = 0; k < entries.length; k++) duration += entries[k].duration;
      const type = mtype;
      voices.push({
        index: i,
        type: type,
        typeName: AV_GN_TYPE_NAMES[type] || ("type " + type),
        state: mstate,
        mono: !!mmono,
        mute: !!mmute,
        duration: duration,
        playable: !!AV_GN_PLAYABLE_TYPES[type],
        entries: entries
      });
      if (entries.length === 0) warnings.push("voice #" + i + " has no entries");
    }
    if (groups.length > meta.length && meta.length > 0) {
      warnings.push(groups.length - meta.length + " entry group(s) had no <voice> block -- synthesized (binaural, enabled)");
    }

    const declared = avGnInt(avGnTagText(clean, "voicecount", null), null);
    if (declared !== null && declared !== voices.length) {
      warnings.push("voicecount says " + declared + ", parsed " + voices.length + " (header counts are advisory)");
    }

    let totalSeconds = 0;
    for (let i = 0; i < voices.length; i++) if (voices[i].duration > totalSeconds) totalSeconds = voices[i].duration;

    return {
      ok: true,
      error: null,
      session: {
        title: title,
        description: description,
        author: author,
        totalSeconds: totalSeconds,
        voiceCount: voices.length,
        voices: voices,
        warnings: warnings
      }
    };
  } catch (e) {
    return { ok: false, error: "parse failed", session: null };
  }
}

/* ---------- zip reader (general; EOCD comment-aware; STORE + DEFLATE) ---------- */

async function avGnUnzip(buf) {
  const errors = [];
  try {
    const b = avGnBytes(buf);
    if (!b) return { ok: false, error: "unsupported input (ArrayBuffer or view required)", files: [], errors: [] };
    const n = b.length;
    if (n < 22) return { ok: false, error: "too short for a zip archive", files: [], errors: [] };

    /* EOCD: backwards scan, comment-aware (max comment 65535) */
    let eocd = -1, loose = -1;
    const floor = Math.max(0, n - 22 - 0xFFFF);
    for (let i = n - 22; i >= floor; i--) {
      if (b[i] === 0x50 && b[i + 1] === 0x4B && b[i + 2] === 0x05 && b[i + 3] === 0x06) {
        const clen = b[i + 20] | (b[i + 21] << 8);
        if (i + 22 + clen === n) { eocd = i; break; }
        if (loose < 0 && i + 22 + clen <= n) loose = i;
      }
    }
    let usedLoose = false;
    if (eocd < 0) { eocd = loose; usedLoose = true; }
    if (eocd < 0) return { ok: false, error: "no end-of-central-directory record (not a zip archive?)", files: [], errors: [] };
    if (usedLoose) errors.push("EOCD only found with trailing-data tolerance -- read anyway");

    const u16 = function (p) { return b[p] | (b[p + 1] << 8); };
    const u32 = function (p) { return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0; };

    const count = u16(eocd + 10);
    const cdSize = u32(eocd + 12);
    const cdOff = u32(eocd + 16);
    const hasZip64Locator = eocd >= 20 &&
      b[eocd - 20] === 0x50 && b[eocd - 19] === 0x4B && b[eocd - 18] === 0x06 && b[eocd - 17] === 0x07;
    if (hasZip64Locator || count === 0xFFFF || cdOff === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
      return { ok: false, error: "zip64 archives are not supported (refused)", files: [], errors: [] };
    }
    if (cdOff + cdSize > n) return { ok: false, error: "central directory out of range", files: [], errors: [] };

    const files = [];
    let p = cdOff;
    for (let i = 0; i < count; i++) {
      if (p + 46 > n) { errors.push("central directory truncated at entry " + i); break; }
      if (!(b[p] === 0x50 && b[p + 1] === 0x4B && b[p + 2] === 0x01 && b[p + 3] === 0x02)) {
        errors.push("bad central-directory signature at entry " + i);
        break;
      }
      const flags = u16(p + 8);
      const method = u16(p + 10);
      const crc = u32(p + 16);
      const csize = u32(p + 20);
      const usize = u32(p + 24);
      const nlen = u16(p + 28);
      const elen = u16(p + 30);
      const clen = u16(p + 32);
      const loff = u32(p + 42);
      if (p + 46 + nlen > n) { errors.push("central-directory name truncated at entry " + i); break; }
      const name = avGnUtf8Decode(b.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;

      if (csize === 0xFFFFFFFF || usize === 0xFFFFFFFF || loff === 0xFFFFFFFF) {
        errors.push("zip64 entry refused: " + name);
        continue;
      }
      if (flags & 0x0001) {                                 /* bit 0 = encrypted */
        errors.push("encrypted entry refused: " + name);
        continue;
      }
      if (usize > AV_GN_ENTRY_LIMIT) {
        errors.push("entry exceeds the size sanity cap, refused: " + name);
        continue;
      }
      if (loff + 30 > n) { errors.push("local header out of range: " + name); continue; }
      if (!(b[loff] === 0x50 && b[loff + 1] === 0x4B && b[loff + 2] === 0x03 && b[loff + 3] === 0x04)) {
        errors.push("bad local-header signature: " + name);
        continue;
      }
      const lfn = u16(loff + 26);
      const lel = u16(loff + 28);
      const dataStart = loff + 30 + lfn + lel;
      if (dataStart + csize > n) { errors.push("entry data out of range: " + name); continue; }

      let bytes = null;
      if (method === 0) {
        bytes = b.slice(dataStart, dataStart + csize);
        if (csize !== usize) errors.push("stored size mismatch (kept anyway): " + name);
      } else if (method === 8) {
        const inf = await avGnInflateRaw(b.subarray(dataStart, dataStart + csize));
        if (!inf.ok) { errors.push("DEFLATE entry failed (" + inf.error + "): " + name); continue; }
        bytes = inf.bytes;
        if (bytes.length !== usize) errors.push("inflated size mismatch (kept anyway): " + name);
      } else {
        errors.push("unsupported compression method " + method + ", refused: " + name);
        continue;
      }

      if (typeof avZipCrc32 === "function") {
        const got = avZipCrc32(bytes);
        if ((got >>> 0) !== (crc >>> 0)) errors.push("CRC-32 mismatch (kept anyway): " + name);
      }
      files.push({ name: name, bytes: bytes });
    }
    return { ok: true, error: null, files: files, errors: errors };
  } catch (e) {
    return { ok: false, error: "zip read failed", files: [], errors: errors };
  }
}

/* ---------- sessions from a pack zip ---------- */

async function avGnSessionsFromZip(zipBuf) {
  try {
    const un = await avGnUnzip(zipBuf);
    const errors = (un && Array.isArray(un.errors)) ? un.errors.slice() : [];
    if (!un || !un.ok) {
      return { ok: false, error: (un && un.error) || "unzip failed", sessions: [], errors: errors };
    }
    const sessions = [];
    for (let i = 0; i < un.files.length; i++) {
      const f = un.files[i];
      if (!f || typeof f.name !== "string" || !/\.gnaural$/i.test(f.name)) continue;
      const bytes = f.bytes;
      sessions.push({ name: f.name, xml: avGnUtf8Decode(bytes), bytes: bytes });
    }
    if (sessions.length === 0 && un.files.length > 0) {
      errors.push("no .gnaural entries in the zip (" + un.files.length + " entries read)");
    }
    return { ok: true, error: null, sessions: sessions, errors: errors };
  } catch (e) {
    return { ok: false, error: "session extraction failed", sessions: [], errors: [] };
  }
}

/* ---------- info ---------- */

function avGnInfo(session) {
  const out = { totalSeconds: 0, voiceCount: 0, playableVoices: 0, types: [], renderable: false };
  try {
    if (!session || typeof session !== "object") return out;
    const voices = Array.isArray(session.voices) ? session.voices : [];
    out.voiceCount = voices.length;
    const seen = {};
    let maxDur = 0;
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i];
      if (!v || typeof v !== "object") continue;
      const t = avGnInt(v.type, 0);
      seen[t] = true;
      if (!!v.state && !v.mute && AV_GN_PLAYABLE_TYPES[t]) out.playableVoices++;
      const d = avGnVoiceSeconds(v);
      if (d > maxDur) maxDur = d;
    }
    out.types = Object.keys(seen).map(function (k) { return parseInt(k, 10); }).sort(function (a, b) { return a - b; });
    const ts = avGnNum(session.totalSeconds, null);
    out.totalSeconds = (ts !== null && ts > 0) ? ts : maxDur;
    out.renderable = out.playableVoices > 0;
  } catch (e) { /* zeros stand */ }
  return out;
}

/* ---------- deterministic noise ---------- */

function avGnTitleSeed(session) {
  /* FNV-1a 32 over the session title; deterministic per parse */
  const s = (session && typeof session.title === "string") ? session.title : "";
  let h = 0x811C9DC5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xFF;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function avGnXor32(seed) {
  /* xorshift32; returns a uint32 stream function */
  let x = seed >>> 0;
  if (x === 0) x = 0x9E3779B9;
  return function () {
    x ^= (x << 13); x >>>= 0;
    x ^= (x >>> 17);
    x ^= (x << 5); x >>>= 0;
    return x >>> 0;
  };
}

/* ---------- render ---------- */

async function avGnRender(session, opts) {
  const warnings = [];
  const fail = function (error, sr) {
    return { ok: false, error: error, sr: sr || 0, seconds: 0, frames: 0, l: null, r: null, warnings: warnings };
  };
  try {
    if (!session || typeof session !== "object" || !Array.isArray(session.voices)) {
      return fail("no session to render");
    }
    const o = (opts && typeof opts === "object") ? opts : {};

    let sr = AV_GN_SR_DEFAULT;
    if (o.sr !== undefined && o.sr !== null) {
      const s = avGnNum(o.sr, null);
      if (s !== null && s >= AV_GN_SR_MIN && s <= AV_GN_SR_MAX) sr = Math.round(s);
      else warnings.push("opts.sr ignored (out of range) -- using " + AV_GN_SR_DEFAULT);
    }

    let maxS = AV_GN_MAX_SECONDS;
    if (o.maxSeconds !== undefined && o.maxSeconds !== null) {
      const m = avGnNum(o.maxSeconds, null);
      if (m !== null && m > 0) maxS = m;
      else warnings.push("opts.maxSeconds ignored -- using " + AV_GN_MAX_SECONDS);
    }
    if (maxS > AV_GN_HARD_CAP_SECONDS) {
      warnings.push("maxSeconds clamped to the " + AV_GN_HARD_CAP_SECONDS + " s hard cap");
      maxS = AV_GN_HARD_CAP_SECONDS;
    }

    /* render set: state-truthy, unmuted voices only */
    const set = [];
    for (let i = 0; i < session.voices.length; i++) {
      const v = session.voices[i];
      if (!v || typeof v !== "object") continue;
      if (!!v.state && !v.mute) set.push(v);
    }
    if (set.length === 0) {
      return fail("nothing to render (no state-truthy, unmuted voices)", sr);
    }
    const playable = [];
    for (let i = 0; i < set.length; i++) {
      const v = set[i];
      const t = avGnInt(v.type, 0);
      if (AV_GN_PLAYABLE_TYPES[t]) playable.push(v);
      else {
        const idx = (v.index === undefined || v.index === null) ? set.indexOf(v) : v.index;
        warnings.push("voice #" + idx + " (" + (v.typeName || ("type " + t)) + ") is not renderable in v1 -- skipped");
      }
    }
    if (playable.length === 0) {
      return fail("nothing renderable in v1 (no binaural/white/brown voice in the render set)", sr);
    }

    let timeline = 0;
    for (let i = 0; i < set.length; i++) {
      const d = avGnVoiceSeconds(set[i]);
      if (d > timeline) timeline = d;
    }

    let frames = 0;
    let seconds = 0;
    const fOverride = avGnNum(o.frames, null);
    if (fOverride !== null && fOverride > 0) {
      frames = Math.floor(fOverride);
      const capF = sr * AV_GN_HARD_CAP_SECONDS;
      if (frames > capF) {
        warnings.push("frames clamped to the " + AV_GN_HARD_CAP_SECONDS + " s hard cap");
        frames = capF;
      }
    } else {
      if (timeline <= 0) return fail("nothing to render (zero-length timeline)", sr);
      seconds = Math.min(timeline, maxS);
      if (timeline > maxS) {
        warnings.push("render capped at " + maxS + " s (timeline " + (Math.round(timeline * 100) / 100) + " s)");
      }
      frames = Math.round(seconds * sr);
    }
    if (!(frames >= 1)) return fail("nothing to render (0 frames)", sr);
    seconds = frames / sr;

    const l = new Float32Array(frames);
    const r = new Float32Array(frames);
    const titleSeed = avGnTitleSeed(session);
    const nyq = sr / 2;

    for (let vi = 0; vi < playable.length; vi++) {
      const v = playable[vi];
      const type = avGnInt(v.type, 0);
      const entries = Array.isArray(v.entries) ? v.entries : [];
      const n = entries.length;
      const vIndex = avGnInt(v.index, vi);
      if (n === 0) {
        warnings.push("voice #" + vIndex + " has no entries -- silent");
        continue;
      }
      const ends = new Float64Array(n);
      const vl = new Float64Array(n);
      const vr = new Float64Array(n);
      const bt = new Float64Array(n);
      const bs = new Float64Array(n);
      let acc = 0;
      for (let k = 0; k < n; k++) {
        const e = entries[k] || {};
        const d = avGnNum(e.duration, 0);
        acc += (d > 0 ? d : 0);
        ends[k] = acc;
        vl[k] = avGnClamp01(avGnNum(e.volL, 1));
        vr[k] = avGnClamp01(avGnNum(e.volR, avGnNum(e.volL, 1)));
        bt[k] = avGnNum(e.beat, 0);
        bs[k] = avGnNum(e.base, 0);
      }
      const rng = avGnXor32((titleSeed ^ Math.imul((vIndex + 1) >>> 0, 0x9E3779B9)) >>> 0);
      let seg = 0;
      let phL = 0, phR = 0;
      let brownL = 0, brownR = 0;

      for (let i = 0; i < frames; i++) {
        const t = i / sr;
        while (seg < n - 1 && t > ends[seg]) seg++;
        let ia, ib, f;
        if (t <= ends[0]) { ia = 0; ib = 0; f = 0; }
        else if (t > ends[n - 1]) { ia = n - 1; ib = n - 1; f = 0; }
        else {
          ia = seg > 0 ? seg - 1 : 0;
          ib = seg;
          const span = ends[ib] - ends[ia];
          f = span > 0 ? (t - ends[ia]) / span : 1;
        }
        const vL = vl[ia] + (vl[ib] - vl[ia]) * f;
        const vR = vr[ia] + (vr[ib] - vr[ia]) * f;

        if (type === 0) {
          const bF = bt[ia] + (bt[ib] - bt[ia]) * f;
          const cF = bs[ia] + (bs[ib] - bs[ia]) * f;
          const fL = avGnFreqClamp(cF - bF / 2, nyq);
          const fR = avGnFreqClamp(cF + bF / 2, nyq);
          phL += AV_GN_TWO_PI * fL / sr;
          if (phL >= AV_GN_TWO_PI) phL -= AV_GN_TWO_PI;
          else if (phL < 0) phL += AV_GN_TWO_PI;
          phR += AV_GN_TWO_PI * fR / sr;
          if (phR >= AV_GN_TWO_PI) phR -= AV_GN_TWO_PI;
          else if (phR < 0) phR += AV_GN_TWO_PI;
          l[i] += vL * Math.sin(phL);
          r[i] += vR * Math.sin(phR);
        } else if (type === 7) {
          const wL = (rng() / 4294967296) * 2 - 1;
          const wR = (rng() / 4294967296) * 2 - 1;
          l[i] += vL * wL;
          r[i] += vR * wR;
        } else if (type === 8) {
          const wL = (rng() / 4294967296) * 2 - 1;
          const wR = (rng() / 4294967296) * 2 - 1;
          brownL = (brownL + AV_GN_NOISE_LEAK * wL) / (1 + AV_GN_NOISE_LEAK);
          brownR = (brownR + AV_GN_NOISE_LEAK * wR) / (1 + AV_GN_NOISE_LEAK);
          l[i] += vL * brownL * AV_GN_NOISE_GAIN;
          r[i] += vR * brownR * AV_GN_NOISE_GAIN;
        }
      }
    }

    /* headroom pin: sum, then scale by 0.9/maxAbs only when maxAbs > 0.95 */
    let maxAbs = 0;
    for (let i = 0; i < frames; i++) {
      const a = Math.abs(l[i]);
      if (a > maxAbs) maxAbs = a;
      const c = Math.abs(r[i]);
      if (c > maxAbs) maxAbs = c;
    }
    if (maxAbs > AV_GN_HEADROOM_FLOOR) {
      const gain = AV_GN_HEADROOM_TARGET / maxAbs;
      for (let i = 0; i < frames; i++) { l[i] *= gain; r[i] *= gain; }
      warnings.push("headroom: abs peak " + maxAbs.toFixed(4) + " > " + AV_GN_HEADROOM_FLOOR +
                    " -- scaled by " + gain.toFixed(4));
    }

    return { ok: true, error: null, sr: sr, seconds: seconds, frames: frames, l: l, r: r, warnings: warnings };
  } catch (e) {
    return fail("render failed");
  }
}
