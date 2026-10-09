/* av_tune.js - Anvil TUNING STUDIO CORE (wave T, child A; contract verify/_t_wave.md section 3). The
   page-side owner of the microtuning model: clean-room Scala .scl / .kbm parsers, 12 built-in authored
   scales, the 128-entry semitone-offset table builder, equal<->tuned morph, MIDI Tuning Standard SysEx
   parse, .scl export, and the av-tune-store library (IDB -> LS -> memory), plus the window.__avTune
   facade. PAGE-ONLY: this file must NOT join the worklet concat (the table math stays page-side, sec.10).

   THE .SCL MODEL (clean-room from the documented Scala scale format, huygens-fokker.org/scala/
   scl_format.html, read 2026-10-09): lines beginning with '!' are comments; the first kept line is the
   one-line description; the second is the note count N; then N pitch lines. A pitch line is either a
   ratio (contains a slash; a bare integer like "2" means the ratio 2/1) or a cents value (any token
   containing a period; a trailing '.' with no decimals, like "408.", is still cents). Anything after
   the first valid pitch value on a line is ignored ("100.0 cents" and " 5/4   E" parse fine). The 1/1
   is implicit and normally not listed; a file that DOES list 0.0/1-1 first is handled explicitly (that
   entry IS degree 0, not a duplicate). Values ascend (non-strict). Refusals (ok:false + error): no
   text, missing count, non-numeric pitch, count mismatch (both directions), N < 1 (the Scala format
   also allows N = 0; this module follows the contract's stricter N >= 1), N > 512, zero/negative ratio
   terms, descending values.

   THE .KBM MODEL (clean-room): 7 header lines after comment/blank skipping: mapSize, firstMidi,
   lastMidi, middleNote, refNote, refHz, then the formal-octave scale degree (the 7th header line; the
   contract's pinned output shape names 6 of the 7, so `octaveDegree` is exposed additively). Then
   mapSize chain lines of small integers; -1 marks a plain linear-interpolation point (interpolated in
   cents between the nearest mapped MIDI keys, proportional to key distance). Bounds: mapSize 0..127
   (0 = empty chain, accepted), notes -1..127, refHz 1..100000. Mapping rule: the chain repeats every
   mapSize keys, chain index 0 anchored at the middle note; one pattern cycle advances the scale degree
   by the formal octave (fallback mapSize when absent); the note at refNote sounds refHz, which anchors
   the 1/1. NOTE: xen.wiki was unreachable during authoring; this model is the documented format rule
   set reconstructed from public docs, flagged in the wave report for parent review.

   THE TABLE: avTuneBuildTable(tuning, opts) -> Float32Array(128). tuning.cents = the .scl pitch list
   in cents from the 1/1 (degree 0 implicit). The scale repeats at the LAST listed value (the interval
   of repetition - the standard rule; a 3/1-listed scale repeats at the tritave). Steps per period =
   the listed values minus the final one, with a leading 0 ensured. Default mapping (no usable .kbm):
   MIDI keys map successively onto scale degrees anchored at opts.root (default 60) - key k is degree
   k - root, walked through the period - so a 12-EDO scale yields all-zero offsets at any root. KBM
   mapping: degree(n) = chain[mod(n - middle, size)] + floor((n - middle)/size) * octaveDegree, retuned
   only inside [firstMidi, lastMidi] (first > last = unbounded); unmapped (-1) notes interpolate; each
   note's frequency = refHz * 2^((G(n) - G(refNote))/1200) where G = the 1/1-relative cents of the
   note. Output = per-note semitone offset vs 12-EDO (the A440 grid), clamped to +/-2 semitones,
   non-finite -> 0. Deterministic, never throws. opts.root applies to the default mapping only.

   THE MORPH: avTuneMorph(table, amount) -> Float32Array(128), out[i] = table[i] * amount (amount
   clamped 0..1; 0 = 12-EDO equal, 1 = the scale fully applied).

   MTS (clean-room from the MIDI Tuning Standard, MMA): avTuneMtsParse(bytes) -> {ok, kind, notes,
   cents, error}. Forms accepted (universal SysEx ids 7F real-time and 7E non-real-time, any device):
   - 08 02 single-note change: F0 7F dev 08 02 kk xx yy zz F7 (10 bytes). xx = the highest 12-EDO
     semitone not exceeding the target; yy zz = the 14-bit fraction of 100 cents above it, MSB first,
     in steps of 100/16384 cents (the spec's .0061-cent resolution). offset cents = (xx - kk) * 100 +
     frac * 100/16384. => kind "note", notes [kk].
   - 08 08 scale/octave 1-byte: F0 7F dev 08 08 c1 c2 c3 <12 bytes> F7 (21 bytes). One byte per pitch
     class C..B; value 64 = 0, step 100/64 cents (127 is the representable maximum at +98.4375; the
     spec boundary pair 127/128 is honored by construction - +100 cents is NOT representable in this
     form and is never synthesized). => kind "scale1", notes [0..11].
   - 08 09 scale/octave 2-byte: 24 bytes = 12 pairs, value = first * 128 + second, zero at 8192, step
     100/16384 cents. => kind "scale2", notes [0..11].
   `notes` for the scale forms = the 12 pitch classes the offsets apply to. Additive fields: sub (the
   numeric sub-id), device, channels (16-bit channel mask for the scale forms: bit 0 = channel 1;
   c1 carries channels 1-7, c2 channels 8-14, c3 channels 15-16). Other sub-ids and malformed
   messages: ok:false + error. Never throws.

   THE STORE (av_wt.js tier law): IDB db `av-tune-store`, object store `tune` keyPath id, LS fallback
   key `av-tune-ls`, memory last. Item: { id, v:1, name, kind: "scl"|"kbm"|"builtin", text, cents|chain,
   at }. Cap 64 items (a 65th distinct id is refused honestly), name cap 48 chars, text cap 64K. Load
   returns fresh copies so callers never alias the store. Quota failures are returned, never silently
   downgraded.

   EXPORT: avTuneExportScl(id|item) -> a valid .scl text for a built-in or user entry (own-authored
   output; number formatting preserves full double round-trip precision - integer cents get a ".0" so
   they re-parse as cents, never as ratios). Round-trip law: parseScl(export(id)) reproduces the source
   cents exactly (===). kbm entries return null (no scale to write). Additive async form:
   avTuneExportSclAsync(id) ensures library hydration first.

   House laws: "use strict"; classic script, page module; NO DOM/window/console reach at load, no top
   level side effects (the file parses and loads in plain node); ONE avTune- / AV_TUNE- family; every
   global reach guarded inside a function; never throws (garbage in -> false/null/{error}/zeros out);
   ASCII-only source. */

"use strict";

/* ---------- pins ---------- */

const AV_TUNE_VERSION = "t1.0";
const AV_TUNE_N = 128;                       /* MIDI notes / table entries (sec.3) */
const AV_TUNE_MAX_NOTES = 512;               /* .scl note-count ceiling (sec.3) */
const AV_TUNE_MAX_CHAIN = 127;               /* .kbm map-size ceiling (sec.3) */
const AV_TUNE_MAX_ITEMS = 64;                /* library cap (sec.3) */
const AV_TUNE_NAME_CAP = 48;                 /* name cap (sec.3) */
const AV_TUNE_TEXT_CAP = 65536;              /* stored source-text cap (bytes of chars; sec.3 silent) */
const AV_TUNE_CLAMP_ST = 2;                  /* per-note offset clamp: +/-2 semitones (sec.3) */
const AV_TUNE_DEFAULT_ROOT = 60;             /* key anchoring the scale's 1/1 (sec.3) */
const AV_TUNE_DB = "av-tune-store";          /* pinned IDB name (sec.3) */
const AV_TUNE_DB_VER = 1;
const AV_TUNE_OS = "tune";                   /* object store, keyPath 'id' (sec.3) */
const AV_TUNE_LS = "av-tune-ls";             /* localStorage fallback key (sec.3) */
const AV_TUNE_OPEN_CAP_MS = 1500;            /* a hung IDB open must not wedge a save (av_wt law) */
const AV_TUNE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const AV_TUNE_KINDS = ["scl", "kbm", "builtin"];
const AV_TUNE_ASC_EPS = 1e-9;                /* cents epsilon for the non-strict ascending check */

/* MTS constants (clean-room; see header) */
const AV_TUNE_MTS_1B_ZERO = 64;              /* 0x08 form: 64 = 0 cents */
const AV_TUNE_MTS_1B_STEP = 100 / 64;        /* 0x08 form: cents per byte step */
const AV_TUNE_MTS_2B_ZERO = 8192;            /* 0x09 form: 14-bit zero point */
const AV_TUNE_MTS_2B_STEP = 100 / 16384;     /* 0x09 form + single-note fraction resolution */

/* the authored built-ins (own math, own names; sec.3). Items are authored pitch lines:
   "a/b" = a ratio; a plain number string = cents. gen.div = an N-EDO generator (i+1)*1200/div. */
const AV_TUNE_BUILTIN_DEFS = [
  {
    id: "12edo", name: "12-EDO (equal)", family: "equal",
    description: "12-tone equal temperament; the identity tuning (all offsets zero)",
    gen: { div: 12 },
  },
  {
    id: "just-major", name: "Just Major (5-limit)", family: "just",
    description: "5-limit just major chromatic; the third is 5/4 = 386.31 c",
    items: ["1/1", "16/15", "9/8", "6/5", "5/4", "4/3", "45/32", "3/2", "8/5", "5/3", "9/5", "15/8", "2/1"],
  },
  {
    id: "just-minor", name: "Just Minor (5-limit)", family: "just",
    description: "5-limit just minor chromatic; chromatic step 25/24",
    items: ["1/1", "25/24", "9/8", "6/5", "4/3", "45/32", "3/2", "8/5", "5/3", "9/5", "15/8", "2/1"],
  },
  {
    id: "pythagorean", name: "Pythagorean (3-limit)", family: "historical",
    description: "3-limit / Pythagorean 12-note; chain-of-fifths tuning",
    items: ["1/1", "256/243", "9/8", "32/27", "81/64", "4/3", "729/512", "3/2", "128/81", "27/16", "16/9", "243/128", "2/1"],
  },
  {
    id: "meantone-quarter", name: "Meantone (1/4-comma)", family: "historical",
    description: "1/4-syntonic-comma meantone; fifth 696.58 c, exact 5/4 and 25/16",
    items: ["0", "76.04899926346116", "193.15685693241744", "310.2647146013737", "386.3137138648349",
            "503.4215715337913", "579.4705707972525", "696.5784284662087", "772.6274277296698",
            "889.7352853986263", "1006.8431430675826", "1082.8921423310435", "1200"],
  },
  {
    id: "werckmeister3", name: "Werckmeister III", family: "historical",
    description: "1691 circulating temperament; four fifths narrowed by a quarter of the Pythagorean comma",
    items: ["0", "90.22499567306306", "192.17999653845033", "294.13499740383764", "390.2249956730629",
            "498.0449991346125", "588.2699948076756", "696.0899982692251", "792.1799965384502",
            "888.2699948076755", "996.089998269225", "1092.1799965384503", "1200"],
  },
  {
    id: "kirnberger3", name: "Kirnberger III", family: "historical",
    description: "1/4-comma C-E with pure upper fifths and one schisma-narrowed fifth (F#-C#)",
    items: ["0", "90.22499567306306", "193.15685693241744", "294.13499740383764", "386.3137138648349",
            "498.0449991346125", "590.22371559561", "696.5784284662087", "792.1799965384502",
            "889.7352853986263", "996.089998269225", "1088.2687147302222", "1200"],
  },
  {
    id: "edo19", name: "19-EDO", family: "equal",
    description: "19-tone equal temperament; step 63.16 c",
    gen: { div: 19 },
  },
  {
    id: "edo22", name: "22-EDO", family: "equal",
    description: "22-tone equal temperament; step 54.55 c",
    gen: { div: 22 },
  },
  {
    id: "edo31", name: "31-EDO", family: "equal",
    description: "31-tone equal temperament; near-perfect 5-limit thirds and sevenths",
    gen: { div: 31 },
  },
  {
    id: "harmonic16", name: "Harmonic 8-16", family: "just",
    description: "one octave of the harmonic series, harmonics 8 through 16",
    items: ["8/8", "9/8", "10/8", "11/8", "12/8", "13/8", "14/8", "15/8", "16/8"],
  },
  {
    id: "gamelan", name: "Gamelan (Slendro/Pelog)", family: "world",
    description: "authored 7-tone Slendro/Pelog-flavoured approximation (own math)",
    items: ["0", "126.0", "258.0", "483.0", "618.0", "792.0", "990.0", "1200.0"],
  },
];

/* ---------- state ---------- */

const avTuneState = {
  lastError: null,
  builtins: null,              /* lazy compiled cache: { list: [...], byId: {id: entry} } | null */
  lib: {
    hydrated: false,
    promise: null,
    backend: "mem",            /* 'idb' | 'ls' | 'mem' - stays honest */
    db: null,
    dbGaveUp: false,
    mem: new Map(),            /* id -> rec {id, v, name, kind, text, cents, chain, at} */
    lastError: null,
    opens: 0,
  },
};

/* ---------- tiny laws (garbage in, sane value out - av_store.js idiom) ---------- */

function avTuneErrName(e) { try { return (e && e.name) ? String(e.name) : ""; } catch (e2) { return ""; } }
function avTuneErrStr(e) { try { const s = (e && e.message) ? String(e.message) : String(e); return s.slice(0, 160); } catch (e2) { return "error"; } }

function avTuneCleanName(v) {
  try {
    let s = (typeof v === "string") ? v : "";
    s = s.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (s.length > AV_TUNE_NAME_CAP) s = s.slice(0, AV_TUNE_NAME_CAP);
    return s || "scale";
  } catch (e) { return "scale"; }
}

function avTuneNextId() {
  avTuneState.seq = (avTuneState.seq || 0) + 1;
  return "tune-" + Date.now().toString(36) + "-" + avTuneState.seq.toString(36);
}

function avTuneMod(a, b) { return ((a % b) + b) % b; }

function avTuneClampOff(v) {
  if (!Number.isFinite(v)) return 0;
  if (v > AV_TUNE_CLAMP_ST) return AV_TUNE_CLAMP_ST;
  if (v < -AV_TUNE_CLAMP_ST) return -AV_TUNE_CLAMP_ST;
  return v;
}

/* ---------- .scl parse (sec.3) ---------- */

function avTuneKeepLines(text) {
  const kept = [];
  try {
    const lines = String(text).split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      const s = lines[i].replace(/^[ \t\f\v]+/, "");
      if (s === "") continue;                      /* blank lines skipped (sec.3) */
      if (s.charCodeAt(0) === 33) continue;        /* '!' comment (sec.3) */
      kept.push(s.replace(/[ \t\f\v]+$/, ""));
    }
  } catch (e) { /* torn text -> whatever was collected */ }
  return kept;
}

/* one pitch line -> {ok, cents} | {ok:false, error}. Ratio (slash; bare int = n/1) or cents
   (a token containing a period; optional trailing '.' = the exact marker, ignored). Anything
   after the first valid pitch value is ignored (documented format rule). */
function avTunePitchLine(line) {
  try {
    const s = String(line);
    let tok = s;
    const sp = s.search(/[ \t\f\v]/);
    if (sp >= 0) tok = s.slice(0, sp);
    if (tok.indexOf("/") >= 0) {
      const m = /^([0-9]+)\/([0-9]+)/.exec(tok);
      if (!m) return { ok: false, error: "bad ratio \"" + tok.slice(0, 24) + "\"" };
      const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (!(a > 0) || !(b > 0)) return { ok: false, error: "ratio with a zero term \"" + tok.slice(0, 24) + "\"" };
      return { ok: true, cents: 1200 * Math.log2(a / b) };
    }
    if (tok.indexOf(".") >= 0) {
      const m = /^([+-]?(?:[0-9]+\.[0-9]*|\.[0-9]+))/.exec(tok);
      if (!m) return { ok: false, error: "bad cents value \"" + tok.slice(0, 24) + "\"" };
      const v = parseFloat(m[1]);
      if (!Number.isFinite(v)) return { ok: false, error: "bad cents value \"" + tok.slice(0, 24) + "\"" };
      return { ok: true, cents: v };
    }
    const m = /^\+?([0-9]+)/.exec(tok);
    if (!m) return { ok: false, error: "not a ratio or cents value \"" + tok.slice(0, 24) + "\"" };
    const a = parseInt(m[1], 10);
    if (!(a > 0)) return { ok: false, error: "ratio with a zero term \"" + tok.slice(0, 24) + "\"" };
    return { ok: true, cents: 1200 * Math.log2(a) };
  } catch (e) { return { ok: false, error: "line:" + avTuneErrStr(e) }; }
}

/* avTuneParseScl(text) -> { ok, name, description, count, cents, error } (sec.3).
   name = the description trimmed into the 48-char house name (the store key's label);
   description = the full first kept line; cents = the listed pitches as absolute cents
   from the 1/1 (the implicit degree 0 is NOT prepended here). */
function avTuneParseScl(text) {
  const fail = function (m) { return { ok: false, name: "", description: "", count: 0, cents: [], error: m }; };
  try {
    if (typeof text !== "string" || text.length === 0) return fail("no text");
    const kept = avTuneKeepLines(text);
    if (kept.length < 2) return fail("truncated .scl: needs a description line, a note count and pitch lines");
    const description = kept[0];
    const cm = /^([0-9]+)$/.exec(kept[1].trim());
    if (!cm) return fail("line 2 must be the note count (got \"" + kept[1].slice(0, 24) + "\")");
    const n = parseInt(cm[1], 10);
    if (!(n >= 1)) return fail("note count " + n + ": this module requires at least 1 pitch line");
    if (n > AV_TUNE_MAX_NOTES) return fail("note count " + n + " exceeds the " + AV_TUNE_MAX_NOTES + " limit");
    const pitchLines = kept.slice(2);
    if (pitchLines.length !== n) {
      return fail("count mismatch: header says " + n + " note(s), " + pitchLines.length + " pitch line(s) found");
    }
    const cents = [];
    for (let i = 0; i < pitchLines.length; i++) {
      const r = avTunePitchLine(pitchLines[i]);
      if (!r.ok) return fail("pitch line " + (i + 1) + ": " + r.error);
      if (i > 0 && r.cents + AV_TUNE_ASC_EPS < cents[i - 1]) {
        return fail("pitch line " + (i + 1) + " is lower than the previous value (pitches must ascend)");
      }
      cents.push(r.cents);
    }
    avTuneState.lastError = null;
    return { ok: true, name: avTuneCleanName(description), description: description, count: n, cents: cents, error: null };
  } catch (e) { return fail("parse:" + avTuneErrStr(e)); }
}

/* ---------- .kbm parse (sec.3) ---------- */

function avTuneKbmInt(v, lo, hi) {
  const m = /^([+-]?[0-9]+)$/.exec(String(v).trim());
  if (!m) return null;
  const x = parseInt(m[1], 10);
  if (!Number.isFinite(x) || x < lo || x > hi) return null;
  return x;
}

function avTuneKbmFloat(v, lo, hi) {
  const m = /^([+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+))$/.exec(String(v).trim());
  if (!m) return null;
  const x = parseFloat(m[1]);
  if (!Number.isFinite(x) || x < lo || x > hi) return null;
  return x;
}

/* avTuneParseKbm(text) -> { ok, mapSize, firstMidi, lastMidi, middleNote, refNote, refHz, chain,
   octaveDegree, error } (sec.3 + the additive octaveDegree field). 7 header lines, then mapSize
   chain lines of small ints (-1 = plain linear interpolation point). */
function avTuneParseKbm(text) {
  const fail = function (m) {
    return { ok: false, mapSize: 0, firstMidi: 0, lastMidi: 0, middleNote: 0, refNote: 0, refHz: 0, chain: [], octaveDegree: 0, error: m };
  };
  try {
    if (typeof text !== "string" || text.length === 0) return fail("no text");
    const kept = avTuneKeepLines(text);
    if (kept.length < 7) return fail("truncated .kbm: 7 header lines are required");
    const mapSize = avTuneKbmInt(kept[0], 0, AV_TUNE_MAX_CHAIN);
    if (mapSize === null) return fail("header line 1 (map size) must be an integer in 0.." + AV_TUNE_MAX_CHAIN);
    const firstMidi = avTuneKbmInt(kept[1], -1, 127);
    if (firstMidi === null) return fail("header line 2 (first MIDI note) must be an integer in -1..127");
    const lastMidi = avTuneKbmInt(kept[2], -1, 127);
    if (lastMidi === null) return fail("header line 3 (last MIDI note) must be an integer in -1..127");
    const middleNote = avTuneKbmInt(kept[3], -1, 127);
    if (middleNote === null) return fail("header line 4 (middle note) must be an integer in -1..127");
    const refNote = avTuneKbmInt(kept[4], -1, 127);
    if (refNote === null) return fail("header line 5 (reference note) must be an integer in -1..127");
    const refHz = avTuneKbmFloat(kept[5], 1, 100000);
    if (refHz === null) return fail("header line 6 (reference frequency) must be a number in 1..100000");
    const octaveDegree = avTuneKbmInt(kept[6], -1, 65535);
    if (octaveDegree === null) return fail("header line 7 (formal octave degree) must be an integer in -1..65535");
    const rest = kept.slice(7);
    if (rest.length !== mapSize) {
      return fail("count mismatch: map size " + mapSize + " but " + rest.length + " chain line(s) found");
    }
    const chain = [];
    for (let i = 0; i < rest.length; i++) {
      const c = avTuneKbmInt(rest[i], -1, 65535);
      if (c === null) return fail("chain line " + (i + 1) + " must be an integer >= -1");
      chain.push(c);
    }
    avTuneState.lastError = null;
    return {
      ok: true, mapSize: mapSize, firstMidi: firstMidi, lastMidi: lastMidi, middleNote: middleNote,
      refNote: refNote, refHz: refHz, chain: chain, octaveDegree: octaveDegree, error: null,
    };
  } catch (e) { return fail("parse:" + avTuneErrStr(e)); }
}

/* ---------- the scale model + table builder (sec.3) ---------- */

/* Normalise a .scl cents list into { base, period }: base = one period's steps starting at 0
   (the final listed value is the interval of repetition and is folded into `period`; an explicit
   leading 0.0/1-1 IS degree 0). */
function avTuneSclModel(cents) {
  try {
    const n = cents.length;
    if (n < 1) return null;
    let base, period;
    if (n === 1) {
      period = (cents[0] > 0) ? cents[0] : 1200;
      base = [0];
    } else {
      period = cents[n - 1];
      if (!Number.isFinite(period) || period <= 0) period = 1200;
      const head = (Math.abs(cents[0]) < AV_TUNE_ASC_EPS) ? cents.slice(0, n - 1) : [0].concat(cents.slice(0, n - 1));
      base = (head.length > 0) ? head : [0];
    }
    return { base: base, period: period };
  } catch (e) { return null; }
}

/* pitch in cents (from the 1/1) of scale degree `deg` (any integer, negative walks down). */
function avTuneScalePitch(model, deg) {
  if (!model || !Number.isFinite(deg)) return 0;
  const d = Math.floor(deg);
  const k = avTuneMod(d, model.base.length);
  const oct = Math.floor(d / model.base.length);
  return model.base[k] + model.period * oct;
}

/* .kbm path -> Float32Array(128) | null (null = unusable, the caller falls back to the default
   mapping). All bounds were validated by avTuneParseKbm; this is the tolerant direct-call path. */
function avTuneBuildKbm(cents, model, tuning) {
  try {
    const ch = tuning.chain;
    if (!Array.isArray(ch)) return null;
    let s = Math.floor(Number(tuning.mapSize));
    if (!Number.isFinite(s) || s < 0 || s > AV_TUNE_MAX_CHAIN) s = ch.length;
    if (s < 1 || s > AV_TUNE_MAX_CHAIN || ch.length !== s) return null;
    const chain = [];
    let mappedCount = 0;
    for (let i = 0; i < s; i++) {
      const c = Math.floor(Number(ch[i]));
      if (!Number.isFinite(c) || c < -1 || c > 65535) return null;
      chain.push(c);
      if (c >= 0) mappedCount += 1;
    }
    if (mappedCount === 0) return null;
    let m = Math.floor(Number(tuning.middleNote));
    if (!Number.isFinite(m)) m = 60;
    let nRef = Math.floor(Number(tuning.refNote));
    if (!Number.isFinite(nRef)) nRef = 69;
    let hz = Number(tuning.refHz);
    if (!Number.isFinite(hz) || hz <= 0) hz = 440;
    let dOct = Math.floor(Number(tuning.octaveDegree));
    if (!Number.isFinite(dOct) || dOct < 1 || dOct > 65535) dOct = s;
    let nFirst = Math.floor(Number(tuning.firstMidi));
    if (!Number.isFinite(nFirst)) nFirst = 0;
    let nLast = Math.floor(Number(tuning.lastMidi));
    if (!Number.isFinite(nLast)) nLast = 127;
    const bounded = (nFirst <= nLast);
    /* raw 1/1-relative cents of a note that the chain maps to a degree; null when unmapped (-1) */
    const gRaw = function (n) {
      const c = chain[avTuneMod(n - m, s)];
      if (c < 0) return null;
      const cyc = Math.floor((n - m) / s);
      return avTuneScalePitch(model, c + cyc * dOct);
    };
    /* G(n): mapped notes use their scale pitch; unmapped notes linearly interpolate (in cents)
       between the nearest mapped keys on each side (the chain is periodic, so both sides exist
       when at least one chain entry is mapped). */
    const gOf = function (n) {
      const g0 = gRaw(n);
      if (g0 !== null) return g0;
      let nb = n - 1, nbG = null;
      for (let i = 0; i < 4096; i++) { const g = gRaw(nb); if (g !== null) { nbG = g; break; } nb -= 1; }
      let na = n + 1, naG = null;
      for (let i = 0; i < 4096; i++) { const g = gRaw(na); if (g !== null) { naG = g; break; } na += 1; }
      if (nbG === null && naG === null) return 0;
      if (nbG === null) return naG;
      if (naG === null) return nbG;
      return nbG + (naG - nbG) * (n - nb) / (na - nb);
    };
    const gRef = gOf(nRef);
    if (!Number.isFinite(gRef)) return null;
    /* the anchor: refNote sounds refHz -> its grid offset c0 = 12*log2(refHz / equal(refNote)) */
    const c0 = 12 * Math.log2(hz / (440 * Math.pow(2, (nRef - 69) / 12)));
    const c0f = Number.isFinite(c0) ? c0 : 0;
    const out = new Float32Array(AV_TUNE_N);
    for (let n = 0; n < AV_TUNE_N; n++) {
      if (bounded && (n < nFirst || n > nLast)) { out[n] = 0; continue; }
      const g = gOf(n);
      if (!Number.isFinite(g)) { out[n] = 0; continue; }
      out[n] = avTuneClampOff(c0f + (g - gRef) / 100 - (n - nRef));
    }
    return out;
  } catch (e) { return null; }
}

/* avTuneBuildTable(tuning, opts) -> Float32Array(128) (sec.3). Always a fresh, deterministic array:
   bad input -> all zeros (12-EDO). tuning = { cents } plus the optional .kbm fields
   { chain, refNote, refHz, mapSize, middleNote, firstMidi, lastMidi, octaveDegree }.
   opts = { root } anchors the default mapping (default 60). */
function avTuneBuildTable(tuning, opts) {
  const out = new Float32Array(AV_TUNE_N);
  try {
    const cents = (tuning && typeof tuning === "object" && Array.isArray(tuning.cents)) ? tuning.cents : null;
    if (!cents || cents.length < 1 || cents.length > AV_TUNE_MAX_NOTES) {
      avTuneState.lastError = "bad-tuning";
      return out;
    }
    const clean = [];
    for (let i = 0; i < cents.length; i++) {
      let v = Number(cents[i]);
      if (!Number.isFinite(v)) v = 0;
      clean.push(v);
    }
    const model = avTuneSclModel(clean);
    if (!model) { avTuneState.lastError = "bad-tuning"; return out; }
    if (tuning.chain != null) {
      const kbmOut = avTuneBuildKbm(clean, model, tuning);
      if (kbmOut) { avTuneState.lastError = null; return kbmOut; }
    }
    let root = Math.floor(Number(opts && opts.root));
    if (!Number.isFinite(root)) root = AV_TUNE_DEFAULT_ROOT;
    if (root < 0) root = 0;
    if (root > 127) root = 127;
    for (let n = 0; n < AV_TUNE_N; n++) {
      const d = n - root;
      out[n] = avTuneClampOff((avTuneScalePitch(model, d) - d * 100) / 100);
    }
    avTuneState.lastError = null;
    return out;
  } catch (e) {
    avTuneState.lastError = "build:" + avTuneErrStr(e);
    return new Float32Array(AV_TUNE_N);
  }
}

/* avTuneMorph(table, amount) -> Float32Array(128) (sec.3): out[i] = table[i] * amount,
   amount clamped 0..1 (0 = 12-EDO equal, 1 = the scale fully applied). */
function avTuneMorph(table, amount) {
  const out = new Float32Array(AV_TUNE_N);
  try {
    let a = Number(amount);
    if (!Number.isFinite(a)) a = 0;
    if (a < 0) a = 0;
    if (a > 1) a = 1;
    if (!table || typeof table !== "object" || typeof table.length !== "number" || table.length < AV_TUNE_N) return out;
    for (let i = 0; i < AV_TUNE_N; i++) {
      let v = Number(table[i]);
      if (!Number.isFinite(v)) v = 0;
      else if (v > AV_TUNE_CLAMP_ST) v = AV_TUNE_CLAMP_ST;
      else if (v < -AV_TUNE_CLAMP_ST) v = -AV_TUNE_CLAMP_ST;
      out[i] = v * a;
    }
    return out;
  } catch (e) { return new Float32Array(AV_TUNE_N); }
}

/* ---------- MTS parse (sec.3) ---------- */

function avTuneMtsBytes(b) {
  try {
    if (typeof Uint8Array !== "undefined" && b instanceof Uint8Array) return b;
    if (typeof ArrayBuffer !== "undefined" && b instanceof ArrayBuffer) return new Uint8Array(b);
    if (b && typeof b === "object" && typeof b.length === "number") {
      if (typeof b.byteLength === "number" && typeof b.byteOffset === "number" && b.buffer
          && typeof b.buffer.byteLength === "number") {
        return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      }
      const out = new Uint8Array(b.length);
      for (let i = 0; i < b.length; i++) {
        const v = Number(b[i]);
        if (!Number.isFinite(v) || v < 0 || v > 255) return null;
        out[i] = Math.floor(v);
      }
      return out;
    }
  } catch (e) { /* not byte-ish */ }
  return null;
}

/* avTuneMtsParse(bytes) -> { ok, kind, notes, cents, error } (sec.3). kinds: "note" (08 02, one
   affected key), "scale1" (08 08, 12 pitch-class offsets), "scale2" (08 09). cents = offsets
   relative to each note's 12-EDO position. Never throws. */
function avTuneMtsParse(bytes) {
  const fail = function (m) { return { ok: false, kind: "", notes: [], cents: null, error: m }; };
  try {
    const b = avTuneMtsBytes(bytes);
    if (!b || b.length < 10) return fail("not a SysEx byte array");
    if (b[0] !== 0xF0) return fail("not a SysEx message (no F0)");
    if (b[b.length - 1] !== 0xF7) return fail("malformed SysEx (no F7 terminator)");
    if (b[1] !== 0x7F && b[1] !== 0x7E) return fail("not a universal SysEx message");
    if (b[3] !== 0x08) return fail("not a MIDI Tuning message (sub-id 1)");
    for (let i = 3; i < b.length - 1; i++) {
      if (b[i] > 127) return fail("data byte out of range at index " + i);
    }
    const device = b[2];
    const sub = b[4];
    if (sub === 0x02) {
      if (b.length !== 10) return fail("single-note MTS message must be 10 bytes (got " + b.length + ")");
      const kk = b[5], xx = b[6], yy = b[7], zz = b[8];
      const frac = yy * 128 + zz;
      const cents = (xx - kk) * 100 + frac * (100 / 16384);
      return {
        ok: true, kind: "note", notes: [kk], cents: [cents], sub: sub, device: device,
        semitone: xx, fraction: frac, error: null,
      };
    }
    if (sub === 0x08 || sub === 0x09) {
      const nBytes = (sub === 0x08) ? 12 : 24;
      const total = 9 + nBytes;
      if (b.length !== total) {
        return fail((sub === 0x08 ? "1-byte" : "2-byte") + " scale/octave MTS message must be "
          + total + " bytes (got " + b.length + ")");
      }
      const c1 = b[5], c2 = b[6], c3 = b[7];
      const channels = (c1 & 0x7F) | ((c2 & 0x7F) << 7) | ((c3 & 0x03) << 14);
      const cents = [];
      if (sub === 0x08) {
        for (let p = 0; p < 12; p++) cents.push((b[8 + p] - AV_TUNE_MTS_1B_ZERO) * AV_TUNE_MTS_1B_STEP);
      } else {
        for (let p = 0; p < 12; p++) {
          const v = b[8 + 2 * p] * 128 + b[9 + 2 * p];
          cents.push((v - AV_TUNE_MTS_2B_ZERO) * AV_TUNE_MTS_2B_STEP);
        }
      }
      const notes = [];
      for (let p = 0; p < 12; p++) notes.push(p);
      return {
        ok: true, kind: (sub === 0x08 ? "scale1" : "scale2"), notes: notes, cents: cents,
        sub: sub, device: device, channels: channels, error: null,
      };
    }
    return fail("unsupported MIDI Tuning sub-id 0x" + sub.toString(16));
  } catch (e) { return fail("mts:" + avTuneErrStr(e)); }
}

/* ---------- built-ins (sec.3; own math, own names) ---------- */

function avTuneCompileBuiltin(def) {
  try {
    const cents = [];
    if (def && def.gen && Number.isFinite(def.gen.div)) {
      const div = Math.floor(def.gen.div);
      if (div < 2 || div > 256) return null;
      for (let i = 1; i <= div; i++) cents.push(i * 1200 / div);
    } else if (def && Array.isArray(def.items)) {
      for (let i = 0; i < def.items.length; i++) {
        const it = String(def.items[i]);
        const m = /^([0-9]+)\/([0-9]+)$/.exec(it);
        let v;
        if (m) {
          const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
          if (!(a > 0) || !(b > 0)) return null;
          v = 1200 * Math.log2(a / b);
        } else {
          v = Number(it);
        }
        if (!Number.isFinite(v)) return null;
        cents.push(v);
      }
    } else {
      return null;
    }
    if (cents.length < 1 || cents.length > AV_TUNE_MAX_NOTES) return null;
    for (let i = 1; i < cents.length; i++) {
      if (cents[i] + AV_TUNE_ASC_EPS < cents[i - 1]) return null;
    }
    return { id: def.id, name: def.name, family: def.family, cents: cents, description: def.description };
  } catch (e) { return null; }
}

function avTuneBuiltinsAll() {
  try {
    if (avTuneState.builtins) return avTuneState.builtins;
    const list = [];
    const byId = {};
    for (let i = 0; i < AV_TUNE_BUILTIN_DEFS.length; i++) {
      const def = AV_TUNE_BUILTIN_DEFS[i];
      const e = avTuneCompileBuiltin(def);
      if (e) { list.push(e); byId[e.id] = e; }
      else { avTuneState.lastError = "builtin:" + String(def && def.id); }
    }
    avTuneState.builtins = { list: list, byId: byId };
    return avTuneState.builtins;
  } catch (e) {
    return { list: [], byId: {} };
  }
}

function avTuneBuiltinIds() {
  const all = avTuneBuiltinsAll();
  const out = [];
  for (let i = 0; i < all.list.length; i++) out.push(all.list[i].id);
  return out;
}

/* avTuneBuiltin(id) -> { id, name, family, cents, description } | null (fresh cents copy). */
function avTuneBuiltin(id) {
  try {
    if (typeof id !== "string") return null;
    const e = avTuneBuiltinsAll().byId[id];
    if (!e) return null;
    return { id: e.id, name: e.name, family: e.family, cents: e.cents.slice(), description: e.description };
  } catch (e2) { return null; }
}

/* ---------- .scl export (sec.3) ---------- */

/* shortest-round-trip number formatting that always re-parses as a CENTS value (never a ratio):
   integer-valued cents get a ".0"; exponent forms (never expected in the cents domain) fall back
   to fixed notation so no "e" reaches the file. */
function avTuneFmtCents(v) {
  let s = String(v);
  if (s.indexOf("e") >= 0 || s.indexOf("E") >= 0) {
    s = (Math.abs(v) < 1e-6) ? v.toFixed(20) : v.toFixed(12);
  }
  if (s.indexOf(".") < 0) s = s + ".0";
  return s;
}

function avTuneExportSclItem(item) {
  try {
    const cents = item && item.cents;
    if (!Array.isArray(cents) || cents.length < 1 || cents.length > AV_TUNE_MAX_NOTES) return null;
    const vals = [];
    for (let i = 0; i < cents.length; i++) {
      const v = Number(cents[i]);
      if (!Number.isFinite(v)) return null;
      vals.push(avTuneFmtCents(v));
    }
    const out = [
      "! av-tune export",
      "! Scala .scl (clean-room writer)",
      avTuneCleanName(item.name),
      String(cents.length),
    ];
    for (let i = 0; i < vals.length; i++) out.push(vals[i]);
    return out.join("\n") + "\n";
  } catch (e) { return null; }
}

/* avTuneExportScl(idOrItem) -> string | null (sec.3). A built-in id or user entry id, or a plain
   item object ({ name, cents }). Round-trip law: parseScl(export) cents === the source cents. */
function avTuneExportScl(idOrItem) {
  try {
    let item = null;
    if (idOrItem && typeof idOrItem === "object") {
      item = idOrItem;
    } else if (typeof idOrItem === "string") {
      const b = avTuneBuiltin(idOrItem);
      if (b) item = b;
      else {
        const rec = avTuneState.lib.mem.get(idOrItem);
        if (rec) item = rec;
      }
    }
    if (!item) return null;
    return avTuneExportSclItem(item);
  } catch (e) { return null; }
}

/* additive: hydrate the library first, then export (user entries need the store to be readable). */
function avTuneExportSclAsync(id) {
  try {
    return avTuneLibEnsure().then(function () { return avTuneExportScl(id); }, function () { return avTuneExportScl(id); });
  } catch (e) { return Promise.resolve(null); }
}

/* ---------- the library (sec.3): IDB `av-tune-store`, LS fallback, memory last ---------- */

function avTuneLs() {
  try { if (typeof localStorage !== "undefined" && localStorage) return localStorage; } catch (e) { /* blocked */ }
  try { const w = (typeof window !== "undefined") ? window : null; if (w && w.localStorage) return w.localStorage; } catch (e) { /* blocked */ }
  return null;
}

function avTuneIdb() {
  try { if (typeof indexedDB !== "undefined" && indexedDB) return indexedDB; } catch (e) { /* none */ }
  try { const w = (typeof window !== "undefined") ? window : null; if (w && w.indexedDB) return w.indexedDB; } catch (e) { /* none */ }
  return null;
}

function avTuneTimer(fn, ms) {
  try { if (typeof setTimeout === "function") return setTimeout(fn, ms); } catch (e) { /* no timers */ }
  return null;
}

function avTuneLibRec(id, v) {
  try {
    if (!v || typeof v !== "object") return null;
    const idS = String((id != null) ? id : v.id);
    if (!AV_TUNE_ID_RE.test(idS)) return null;
    const kind = (typeof v.kind === "string") ? v.kind : "";
    if (AV_TUNE_KINDS.indexOf(kind) < 0) return null;
    let cents = null;
    if (Array.isArray(v.cents)) {
      if (v.cents.length < 1 || v.cents.length > AV_TUNE_MAX_NOTES) return null;
      cents = [];
      for (let i = 0; i < v.cents.length; i++) {
        const x = Number(v.cents[i]);
        if (!Number.isFinite(x)) return null;
        cents.push(x);
      }
    }
    let chain = null;
    if (Array.isArray(v.chain)) {
      if (v.chain.length > AV_TUNE_MAX_CHAIN) return null;
      chain = [];
      for (let i = 0; i < v.chain.length; i++) {
        const x = Math.floor(Number(v.chain[i]));
        if (!Number.isFinite(x) || x < -1) return null;
        chain.push(x);
      }
    }
    if (kind === "kbm") { if (!chain) return null; }
    else { if (!cents) return null; }
    let text = null;
    if (typeof v.text === "string") text = v.text.slice(0, AV_TUNE_TEXT_CAP);
    let at = Number(v.at);
    if (!Number.isFinite(at) || at < 0) at = 0;
    return { id: idS, v: 1, name: avTuneCleanName(v.name), kind: kind, text: text, cents: cents, chain: chain, at: at };
  } catch (e) { return null; }
}

function avTuneDbOpen() {
  const st = avTuneState.lib;
  return new Promise(function (res) {
    if (st.db) return res(st.db);
    if (st.dbGaveUp) return res(null);
    const idb = avTuneIdb();
    if (!idb) { st.dbGaveUp = true; return res(null); }
    st.opens += 1;
    let settled = false;
    let timer = null;
    const give = function (v) { if (!settled) { settled = true; res(v); } };
    try {
      timer = avTuneTimer(function () { st.dbGaveUp = true; give(null); }, AV_TUNE_OPEN_CAP_MS);
      const rq = idb.open(AV_TUNE_DB, AV_TUNE_DB_VER);
      rq.onupgradeneeded = function () {
        try {
          const db = rq.result;
          if (!db.objectStoreNames || !db.objectStoreNames.contains(AV_TUNE_OS)) db.createObjectStore(AV_TUNE_OS, { keyPath: "id" });
        } catch (e) { /* upgrade raced */ }
      };
      rq.onsuccess = function () {
        try { if (timer != null && typeof clearTimeout === "function") clearTimeout(timer); } catch (e) { /* fine */ }
        if (st.dbGaveUp) { try { rq.result.close(); } catch (e) { /* fine */ } return give(null); }
        st.db = rq.result;
        give(st.db);
      };
      rq.onerror = function () { give(null); };
      rq.onblocked = function () { st.dbGaveUp = true; give(null); };
    } catch (e) { give(null); }
  });
}

function avTuneDbAll(db) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_TUNE_OS, "readonly");
      const rq = tx.objectStore(AV_TUNE_OS).getAll();
      rq.onsuccess = function () { res(rq.result || []); };
      rq.onerror = function () { res(null); };
      tx.onerror = function () { res(null); };
    } catch (e) { res(null); }
  });
}

function avTuneDbPut(db, rec) {
  return new Promise(function (res, rej) {
    try {
      const tx = db.transaction(AV_TUNE_OS, "readwrite");
      tx.objectStore(AV_TUNE_OS).put(rec);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { rej((tx.error) || new Error("idb write failed")); };
      tx.onabort = function () { rej((tx.error) || new Error("idb write aborted")); };
    } catch (e) { rej(e); }
  });
}

function avTuneDbDel(db, id) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_TUNE_OS, "readwrite");
      tx.objectStore(AV_TUNE_OS).delete(id);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { res(false); };
      tx.onabort = function () { res(false); };
    } catch (e) { res(false); }
  });
}

/* LS snapshot: {id -> rec}. Returns {} when absent, null when localStorage is unavailable. */
function avTuneLsRead() {
  try {
    const ls = avTuneLs();
    if (!ls) return null;
    const raw = ls.getItem(AV_TUNE_LS);
    if (raw == null) return {};
    let obj = null;
    try { obj = JSON.parse(raw); } catch (e) { return {}; }
    const out = {};
    if (obj && typeof obj === "object" && obj.items && typeof obj.items === "object") {
      const keys = Object.keys(obj.items);
      for (let i = 0; i < keys.length; i++) {
        const rec = avTuneLibRec(keys[i], obj.items[keys[i]]);
        if (rec) out[rec.id] = rec;
      }
    }
    return out;
  } catch (e) { return null; }
}

/* full-map LS write; returns 'ok' | 'quota' | 'err' | 'none'. */
function avTuneLsWriteAll(map) {
  try {
    const ls = avTuneLs();
    if (!ls) return "none";
    const items = {};
    map.forEach(function (rec, id) {
      items[id] = {
        id: rec.id, v: 1, name: rec.name, kind: rec.kind, text: rec.text,
        cents: rec.cents ? rec.cents.slice() : null,
        chain: rec.chain ? rec.chain.slice() : null,
        at: rec.at,
      };
    });
    ls.setItem(AV_TUNE_LS, JSON.stringify({ v: 1, items: items }));
    return "ok";
  } catch (e) { return (avTuneErrName(e) === "QuotaExceededError") ? "quota" : "err"; }
}

function avTuneLibEnsure() {
  const st = avTuneState.lib;
  if (st.promise) return st.promise;
  try {
    st.promise = avTuneLibHydrate().catch(function (e) {
      st.lastError = "hydrate:" + avTuneErrStr(e);
      st.hydrated = true;
      return st.backend;
    });
    return st.promise;
  } catch (e) {
    st.hydrated = true;
    return Promise.resolve(st.backend);
  }
}

async function avTuneLibHydrate() {
  const st = avTuneState.lib;
  if (st.hydrated) return st.backend;
  st.mem = new Map();
  const db = await avTuneDbOpen();
  const lsMap = avTuneLsRead();                       /* {} | null(unavailable) */
  if (db) {
    st.backend = "idb";
    const recs = await avTuneDbAll(db);
    if (recs) {
      for (let i = 0; i < recs.length; i++) {
        const rec = avTuneLibRec(recs[i] && recs[i].id, recs[i]);
        if (rec) st.mem.set(rec.id, rec);
      }
    }
    /* the LS snapshot is written only by a session that could not reach this DB - its ids win
       (the av_store.js law), get written through, and the key retires once they are all safe */
    if (lsMap) {
      const ids = Object.keys(lsMap);
      let want = 0, landed = 0;
      for (let i = 0; i < ids.length; i++) {
        want += 1;
        try {
          await avTuneDbPut(db, lsMap[ids[i]]);
          st.mem.set(ids[i], lsMap[ids[i]]);
          landed += 1;
        } catch (e) { /* best effort */ }
      }
      if (want && want === landed) {
        try { const ls = avTuneLs(); if (ls) ls.removeItem(AV_TUNE_LS); } catch (e) { /* keep the spare copy */ }
      }
    }
  } else if (lsMap !== null) {
    st.backend = "ls";
    const ids = Object.keys(lsMap);
    for (let i = 0; i < ids.length; i++) st.mem.set(ids[i], lsMap[ids[i]]);
  } else {
    st.backend = "mem";
  }
  st.hydrated = true;
  return st.backend;
}

function avTuneLibraryInit() {
  try { avTuneLibEnsure(); return true; } catch (e) { return false; }
}

/* avTuneLibrarySave(item) -> Promise<{ok, id, backend} | {ok:false, error}> (sec.3).
   item = { id?, name, kind, text?, cents?|chain? }. Cap 64 distinct items. */
function avTuneLibrarySave(item) {
  try { return Promise.resolve(avTuneLibSaveRun(item)).catch(function (e) { return { ok: false, error: "save:" + avTuneErrStr(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, error: "save:" + avTuneErrStr(e) }); }
}

async function avTuneLibSaveRun(item) {
  const st = avTuneState.lib;
  if (!item || typeof item !== "object") return { ok: false, error: "bad-item" };
  await avTuneLibEnsure();
  const id = (typeof item.id === "string" && AV_TUNE_ID_RE.test(item.id)) ? item.id : avTuneNextId();
  const rec = avTuneLibRec(id, {
    id: id, v: 1, name: item.name, kind: item.kind, text: item.text,
    cents: item.cents, chain: item.chain, at: Date.now(),
  });
  if (!rec) return { ok: false, error: "bad-item" };
  if (!st.mem.has(rec.id) && st.mem.size >= AV_TUNE_MAX_ITEMS) {
    return { ok: false, error: "library full (cap " + AV_TUNE_MAX_ITEMS + " items)" };
  }
  if (st.db) {
    try {
      await avTuneDbPut(st.db, rec);
      st.mem.set(rec.id, rec);
      st.lastError = null;
      return { ok: true, id: rec.id, backend: "idb" };
    } catch (e) {
      const nm = avTuneErrName(e);
      if (nm === "InvalidStateError" || nm === "TransactionInactiveError") {
        st.db = null;                        /* a closed connection may heal on the NEXT call */
      }
      const err = (nm === "QuotaExceededError") ? "quota" : ("idb:" + (nm || "error"));
      st.lastError = err;
      return { ok: false, error: err, backend: "idb" };
    }
  }
  if (avTuneLs()) {
    const map = new Map(st.mem);
    map.set(rec.id, rec);
    const w = avTuneLsWriteAll(map);
    if (w === "ok") {
      st.mem.set(rec.id, rec);
      if (st.backend === "mem") st.backend = "ls";
      st.lastError = null;
      return { ok: true, id: rec.id, backend: "ls" };
    }
    if (w === "quota") { st.lastError = "quota"; return { ok: false, error: "quota", backend: "ls" }; }
    /* 'err'/'none': storage unavailable - fall through to memory */
  }
  st.mem.set(rec.id, rec);
  st.lastError = null;
  return { ok: true, id: rec.id, backend: "mem", volatile: true };
}

/* avTuneLibraryLoad(id) -> Promise<item | null>; fresh copies, the store is never aliased. */
function avTuneLibraryLoad(id) {
  try { return Promise.resolve(avTuneLibLoadRun(id)).catch(function () { return null; }); }
  catch (e) { return Promise.resolve(null); }
}

async function avTuneLibLoadRun(id) {
  const st = avTuneState.lib;
  if (typeof id !== "string" || !AV_TUNE_ID_RE.test(id)) return null;
  await avTuneLibEnsure();
  const rec = st.mem.get(id);
  if (!rec) return null;
  return {
    id: rec.id, v: 1, name: rec.name, kind: rec.kind, text: rec.text,
    cents: rec.cents ? rec.cents.slice() : null,
    chain: rec.chain ? rec.chain.slice() : null,
    at: rec.at,
  };
}

/* avTuneLibraryDelete(id) -> Promise<boolean>. */
function avTuneLibraryDelete(id) {
  try { return Promise.resolve(avTuneLibDelRun(id)).catch(function () { return false; }); }
  catch (e) { return Promise.resolve(false); }
}

async function avTuneLibDelRun(id) {
  const st = avTuneState.lib;
  if (typeof id !== "string" || !AV_TUNE_ID_RE.test(id)) return false;
  await avTuneLibEnsure();
  let dropped = false;
  if (st.db) {
    dropped = await avTuneDbDel(st.db, id);
  } else {
    let w = "none";
    if (avTuneLs()) {
      const map = new Map(st.mem);
      map.delete(id);
      w = avTuneLsWriteAll(map);
    }
    if (w === "ok") dropped = true;
    else if (w === "quota") dropped = false;       /* the durable tier refused: the entry stays, honest */
    else dropped = (st.backend === "mem");         /* nothing durable was in use */
  }
  if (dropped) st.mem.delete(id);
  return dropped;
}

/* avTuneLibraryList() -> Promise<[{id, name, kind, count, at, backend}]>, newest first. */
function avTuneLibraryList() {
  try { return Promise.resolve(avTuneLibListRun()).catch(function () { return []; }); }
  catch (e) { return Promise.resolve([]); }
}

async function avTuneLibListRun() {
  const st = avTuneState.lib;
  await avTuneLibEnsure();
  const out = [];
  st.mem.forEach(function (rec, id) {
    out.push({
      id: id,
      name: rec.name,
      kind: rec.kind,
      count: rec.cents ? rec.cents.length : (rec.chain ? rec.chain.length : 0),
      at: rec.at,
      backend: st.backend,
    });
  });
  out.sort(function (a, b) { return (b.at - a.at) || (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)); });
  return out;
}

/* ---------- reports ---------- */

function avTuneSnap() {
  try {
    const st = avTuneState;
    const lib = st.lib;
    return {
      version: AV_TUNE_VERSION,
      ok: true,
      builtins: avTuneBuiltinsAll().list.length,
      library: {
        backend: lib.hydrated ? lib.backend : null,
        hydrated: !!lib.hydrated,
        count: lib.mem.size,
        lastError: lib.lastError,
      },
      lastError: st.lastError,
    };
  } catch (e) {
    return { version: AV_TUNE_VERSION, ok: false, lastError: "snap:" + avTuneErrStr(e) };
  }
}

/* ---------- the page handle (guarded; the rig reads window.__avTune, sec.3) ---------- */

if (typeof window !== "undefined" && window) {
  try {
    window.__avTune = {
      version: AV_TUNE_VERSION,
      builtinIds: avTuneBuiltinIds,
      builtin: avTuneBuiltin,
      parseScl: avTuneParseScl,
      parseKbm: avTuneParseKbm,
      buildTable: avTuneBuildTable,
      morph: avTuneMorph,
      mtsParse: avTuneMtsParse,
      exportScl: avTuneExportScl,
      library: {
        save: avTuneLibrarySave,
        list: avTuneLibraryList,
        load: avTuneLibraryLoad,
        delete: avTuneLibraryDelete,
        init: avTuneLibraryInit,
      },
      exportSclAsync: avTuneExportSclAsync,
      snap: avTuneSnap,
    };
  } catch (e) { /* exposure is best-effort */ }
}
