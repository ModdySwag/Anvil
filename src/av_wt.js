/* av_wt.js — Anvil M1 WAVETABLE AUTHORING CORE (sa-E, brief verify/_m1_wave.md §2.5). The page-side
   owner of the wavetable model: table creation, draw/seed helpers, morph baking, the MIP LAW, the
   install path into the engine's user wavetable slots, and persistence (IndexedDB `av-wt-store`
   with the localStorage fallback), plus JSON export/import and packed-wavetable file import.

   THE MODEL. A table is plain JSON-safe data: `{v:1, id, name, createdAt, updatedAt, frames:[…]}`
   with 1..256 frames, each a Float64Array(2048) holding one cycle in the sample domain. Every
   entry path sanitises samples (non-finite -> 0, |x| clamped to 64) and copies, so a table the UI
   mutates is never aliasing anyone else's data. avWtNew starts a table with ONE seeded `sine`
   frame (a silent default would read as a broken card).

   THE MIP LAW (must match the engine factory bank — src/av_dsp.js buildTables(), lines ~214-266).
   avWtMips(frame) analyses the 2048-sample frame (forward radix-2 FFT, the same algorithm the
   worklet uses), then for level k = 0..10 rebuilds the spectrum keeping exactly the bins of
   harmonics 1..(1024>>k) (DC and every other bin zeroed; bins 1025..2047 are the conjugate mirror
   side and are zeroed with their harmonic), inverse-FFTs back to 2048 samples, and finally applies
   ONE shared gain to ALL levels: g = 0.95 / peak(level 0). That is byte-for-byte the factory law:
   level-0 peak-normalised to 0.95, no per-level normalise (contract 4.3). Seeded waves use the
   factory's exact harmonic recipes (all sine-phase except pulse25 which uses the factory's A/B
   cosine+sine pair; DC intentionally 0), so avWtMips(wtSeedFrom("saw")) reconstructs the engine's
   `wt.saw` bank within floating-point noise (proved by the node harness against a time-domain
   replication of the factory, <= 1e-9).

   INSTALL. avWtInstall(table, slot?, frameIndex?) bakes avWtMips of one frame (default frame 0)
   and hands them to the parent-added sender `avEngineWt(slot, name, mips)` — typeof-guarded like
   every cross-file reach. The sender contract mirrors avEngineSample: return EXACTLY `true` on
   hand-off, `false`/anything else on refusal; absent sender -> `{ok:false, error:"no-engine"}`.
   The local mirror avWtInstalled() records ONLY successful installs; auto slot = first free 0..15,
   all busy -> `{ok:false, error:"no-slot"}`. avWtUserOscNames() returns exactly 16 entries with
   value strings "wt.user0".."wt.user15" (the av_dsp parser pins those exact strings).

   PERSISTENCE. avWtLibrarySave/Load/List/Delete over IDB `av-wt-store` (object store `wt`,
   keyPath id), LS fallback key `av-wt-ls`, memory last resort — the av_store.js tier law: IDB is
   the durable home; a missing/blocked DB falls through to LS, LS unavailability to memory
   (`volatile:true` reported); a QUOTA failure returns honestly and never silently downgrades.
   `sha-lite integrity not needed — content only` (§2.5). Everything never throws, nothing is
   touched at top level except the guarded `window.__avWt` handle.

   .wt / WAVETABLE FILE IMPORT — FORMAT VERDICT (researched 2026-10-08, public docs only):
   - The `.wt` extension belongs to the Surge XT / Bitwig container, spec'd publicly as the `vawt`
     block in the Surge repo (raw spec fetched from
     https://raw.githubusercontent.com/surge-synthesizer/surge/main/resources/data/wavetables/WT%20fileformat.txt):
     bytes 0-3 'vawt', u32 LE wave_size (2..4096, power of 2), u16 LE wave_count (1..512), u16 LE
     flags (0x1 = is a sample, 0x2 = looped sample, 0x4 = int16 data else float32, 0x8 = int16
     uses the full 16-bit range else 15-bit/-6 dBFS, 0x10 = null-terminated XML metadata follows
     the data), then the sample data. VERIFIED — parsed directly.
   - Serum has no `.wt` of its own: Serum wavetables are packed RIFF WAVE files (2048 samples per
     frame) carrying an optional 'clm ' chunk whose data is an ASCII string "<!>AAAA BC000000 D"
     (AAAA = cycle size, B = interpolation 0..4, C = Serum factory flag, D = vendor string) — per
     Steve Duda's spec as quoted in the xferrecords forum "File Types" thread and documented in
     the iicaras public gist "Wavetable information and formats"
     (https://gist.github.com/iicaras/f63dc9fcc3f9a83ccaf2de3fbc9fbb5a#wav-clm-chunk, fetched);
     Surge's own WAVFileSupport.cpp corroborates ('clm ' chunk, data+3 = "2048"). VERIFIED —
     parsed directly.
   - avWtImportWt accepts BOTH containers (magic sniffed: 'vawt' or 'RIFF'/WAVE), converts
     channel 0, treats 16-bit PCM, 32-bit float (and 32-bit PCM) honestly, respects a clm cycle
     size (power of two 2..8192) and spectrally (band-limited, FFT-domain) resamples non-2048
     frames up/down to 2048 — the source Nyquist bin is dropped. Frame counts are capped at 256
     (the Serum-ecosystem ceiling; over that is a clear error, never a silent truncation).
     Anything else comes back as `{error:"<clear sentence>"}` — no guessing.

   House laws kept: "use strict"; page module (no worklet concat) — NO DOM at top level, no
   top-level side effects (the file parses and loads in plain node); every DOM/global reach is
   guarded inside a function; ONE avWt- / AV_WT- prefixed family; never throws (garbage in -> false/null/
   {error} out). Extensions beyond the §2.5 pins (documented, additive): avWtInstall's optional
   third arg (frame index, default 0), avWtLibraryInit(), avWtSeedFrame() internals, the import
   result also carries `frameSize`/`source`/`note`. Determinism: no Math.random anywhere — the
   `noise` seed uses a module-local mulberry32 stream (fixed seed constant; advances per call so
   consecutive noise seeds differ, yet the whole sequence is reproducible). */

"use strict";

/* ---------- pins ---------- */

const AV_WT_VERSION = "m1.0";
const AV_WT_N = 2048;                        /* samples per frame (§2.5; = the engine's WT_N) */
const AV_WT_LEVELS = 11;                     /* mip levels k = 0..10 (§2.5; = WT_LEVELS) */
const AV_WT_HMAX = 1024;                     /* level k keeps harmonics 1..(1024>>k) */
const AV_WT_PEAK = 0.95;                     /* level-0 peak normalisation target (§2.5) */
const AV_WT_MAX_FRAMES = 256;                /* wavetable ceiling (Serum-compatible; §2.5 silent) */
const AV_WT_SLOTS = 16;                      /* wt.user0..wt.user15 */
const AV_WT_SAMPLE_CLAMP = 64;               /* ingest clamp (no musical frame exceeds ~±8) */
const AV_WT_DB = "av-wt-store";              /* pinned IDB name (§2.5) */
const AV_WT_DB_VER = 1;
const AV_WT_OS = "wt";                       /* object store, keyPath 'id' */
const AV_WT_LS = "av-wt-ls";                 /* localStorage fallback key */
const AV_WT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const AV_WT_KINDS = ["saw", "square", "tri", "sine", "pulse25", "noise"];
const AV_WT_OPEN_CAP_MS = 1500;              /* a hung IDB open must not wedge a save */
const AV_WT_PRNG_SEED0 = 0x9e3779b9;         /* the noise-seed stream's own constant */

/* ---------- state ---------- */

const avWtState = {
  made: 0,                       /* tables created this session (snap counter) */
  seq: 0,                        /* name/id counter */
  prng: AV_WT_PRNG_SEED0,        /* module-local mulberry32 state (noise seeds only) */
  installed: new Array(AV_WT_SLOTS).fill(null),  /* slot -> {slot,name,at,frames} | null */
  lastError: null,
  lib: {
    hydrated: false,
    promise: null,
    backend: "mem",              /* 'idb' | 'ls' | 'mem' — stays honest */
    db: null,
    dbGaveUp: false,
    mem: new Map(),              /* id -> {id,v,name,savedAt,frames:[Float64Array]} */
    lastError: null,
    opens: 0,
  },
};

/* ---------- tiny laws (garbage in, sane value out — av_store.js idiom) ---------- */

function avWtErrName(e) { try { return (e && e.name) ? String(e.name) : ""; } catch (e2) { return ""; } }
function avWtErrStr(e) { try { const s = (e && e.message) ? String(e.message) : String(e); return s.slice(0, 160); } catch (e2) { return "error"; } }

function avWtCleanName(v) {
  try {
    let s = (typeof v === "string") ? v : "";
    s = s.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (s.length > 48) s = s.slice(0, 48);
    return s || "table";
  } catch (e) { return "table"; }
}

function avWtNextId() {
  avWtState.seq += 1;
  return "wt-" + Date.now().toString(36) + "-" + avWtState.seq.toString(36);
}

function avWtPow2(n) {
  return typeof n === "number" && isFinite(n) && n >= 1 && n <= 0x40000000 && (n & (n - 1)) === 0;
}

/* sanitising copier: any array-like of EXACTLY 2048 numeric entries -> fresh Float64Array.
   Everything else -> null. Non-finite -> 0; |x| clamped to ±AV_WT_SAMPLE_CLAMP. */
function avWtF64(src) {
  try {
    if (!src || typeof src !== "object" || typeof src.length !== "number" || src.length !== AV_WT_N) return null;
    const out = new Float64Array(AV_WT_N);
    for (let i = 0; i < AV_WT_N; i++) {
      let v = Number(src[i]);
      if (!isFinite(v)) v = 0;
      else if (v > AV_WT_SAMPLE_CLAMP) v = AV_WT_SAMPLE_CLAMP;
      else if (v < -AV_WT_SAMPLE_CLAMP) v = -AV_WT_SAMPLE_CLAMP;
      out[i] = v;
    }
    return out;
  } catch (e) { return null; }
}

function avWtIsTable(t) {
  try {
    if (!t || typeof t !== "object" || !Array.isArray(t.frames)) return false;
    if (t.frames.length < 1 || t.frames.length > AV_WT_MAX_FRAMES) return false;
    for (let i = 0; i < t.frames.length; i++) {
      const f = t.frames[i];
      if (!f || typeof f !== "object" || typeof f.length !== "number" || f.length !== AV_WT_N) return false;
    }
    return true;
  } catch (e) { return false; }
}

/* ---------- the radix-2 FFT (same algorithm as the worklet's fftRadix2 — house code, duplicated
   so the page scope can synthesise and analyse frames without the worklet) ---------- */

function avWtFft(re, im, inverse) {
  try {
    const n = re.length;
    if (n < 2 || (n & (n - 1)) !== 0 || im.length !== n) return false;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    const TAU = 2 * Math.PI;
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (inverse ? TAU : -TAU) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < half; k++) {
          const ar = re[i + k], ai = im[i + k];
          const br = re[i + k + half], bi = im[i + k + half];
          const vr = br * cr - bi * ci;
          const vi = br * ci + bi * cr;
          re[i + k] = ar + vr; im[i + k] = ai + vi;
          re[i + k + half] = ar - vr; im[i + k + half] = ai - vi;
          const nr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = nr;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    return true;
  } catch (e) { return false; }
}

/* ---------- seeds (the factory recipes — src/av_dsp.js buildTables, lines 231-243) ---------- */

function avWtRand() {
  let t = (avWtState.prng = (avWtState.prng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* one fresh 2048-sample frame for a seed kind — band-limited to harmonics 1..1024 with the
   factory's exact spectral recipes, left UN-normalised (the mips law is the single normalisation
   point, so avWtMips(seed) reproduces the engine's factory bank exactly). */
function avWtSeedFrame(kind) {
  try {
    const k = (typeof kind === "string") ? kind.trim().toLowerCase() : "";
    if (AV_WT_KINDS.indexOf(k) < 0) return null;
    const n = AV_WT_N;
    const frame = new Float64Array(n);
    if (k === "noise") {
      for (let i = 0; i < n; i++) frame[i] = avWtRand() * 2 - 1;
      return frame;
    }
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let h = 1; h <= AV_WT_HMAX; h++) {
      let A = 0, B = 0;
      if (k === "saw") {                                   /* all sine, 1/h */
        B = 1 / h;
      } else if (k === "square") {                         /* odd sine, 1/h */
        if ((h & 1) === 1) B = 1 / h;
      } else if (k === "tri") {                            /* odd, alt-sign, 1/h^2 */
        if ((h & 1) === 1) B = ((h >> 1) & 1) ? -1 / (h * h) : 1 / (h * h);
      } else if (k === "sine") {                           /* fundamental only */
        if (h === 1) B = 1;
      } else {                                             /* pulse25: exact duty-25% pulse, DC 0 */
        const th = Math.PI * h * 0.5;
        A = 2 * Math.sin(th) / (Math.PI * h);
        B = 2 * (1 - Math.cos(th)) / (Math.PI * h);
      }
      if (A !== 0 || B !== 0) {
        /* x[n] = sum A*cos + B*sin  ->  X[h] = N*(A/2 - i*B/2), X[N-h] = conj */
        const hr = n * A / 2;
        const hi = -n * B / 2;
        re[h] += hr; im[h] += hi;
        re[n - h] += hr; im[n - h] -= hi;
      }
    }
    if (!avWtFft(re, im, true)) return null;
    for (let i = 0; i < n; i++) frame[i] = re[i];
    return frame;
  } catch (e) { return null; }
}

/* ---------- table model (§2.5) ---------- */

function avWtTableFrom(frames, name, id) {
  const now = Date.now();
  return {
    v: 1,
    id: (typeof id === "string" && AV_WT_ID_RE.test(id)) ? id : avWtNextId(),
    name: avWtCleanName(name),
    createdAt: now,
    updatedAt: now,
    frames: frames,
  };
}

/* avWtNew(name) -> table : one frame, seeded `sine` (never a silent zero frame). */
function avWtNew(name) {
  try {
    const first = avWtSeedFrame("sine");
    const t = avWtTableFrom([first || new Float64Array(AV_WT_N)], name);
    avWtState.made += 1;
    return t;
  } catch (e) {
    avWtState.lastError = "new:" + avWtErrStr(e);
    return null;
  }
}

function avWtFrameCount(t) { try { return avWtIsTable(t) ? t.frames.length : 0; } catch (e) { return 0; } }

/* avWtSetFrame(t, i, f64_2048) -> bool : writes a sanitised copy of f into frame i. */
function avWtSetFrame(t, i, f) {
  try {
    if (!avWtIsTable(t)) return false;
    const idx = Math.floor(Number(i));
    if (!(idx >= 0 && idx < t.frames.length)) return false;
    const clean = avWtF64(f);
    if (!clean) return false;
    t.frames[idx] = clean;
    t.updatedAt = Date.now();
    return true;
  } catch (e) { return false; }
}

/* avWtAddFrame(t) -> new index (>= 1) | -1 : appends a copy of the last frame (draw-on-continue). */
function avWtAddFrame(t) {
  try {
    if (!avWtIsTable(t)) return -1;
    if (t.frames.length >= AV_WT_MAX_FRAMES) return -1;
    const copy = avWtF64(t.frames[t.frames.length - 1]);
    if (!copy) return -1;
    t.frames.push(copy);
    t.updatedAt = Date.now();
    return t.frames.length - 1;
  } catch (e) { return -1; }
}

/* avWtDelFrame(t, i) -> bool : a table always keeps >= 1 frame. */
function avWtDelFrame(t, i) {
  try {
    if (!avWtIsTable(t)) return false;
    const idx = Math.floor(Number(i));
    if (!(idx >= 0 && idx < t.frames.length)) return false;
    if (t.frames.length <= 1) return false;
    t.frames.splice(idx, 1);
    t.updatedAt = Date.now();
    return true;
  } catch (e) { return false; }
}

/* avWtSeedFrom(t, i, kind) -> bool : kind in AV_WT_KINDS (case/space-tolerant). */
function avWtSeedFrom(t, i, kind) {
  try {
    if (!avWtIsTable(t)) return false;
    const idx = Math.floor(Number(i));
    if (!(idx >= 0 && idx < t.frames.length)) return false;
    const f = avWtSeedFrame(kind);
    if (!f) return false;
    t.frames[idx] = f;
    t.updatedAt = Date.now();
    return true;
  } catch (e) { return false; }
}

/* avWtMorph(t, iA, iB, x) -> baked Float64Array(2048) | null : x clamped to [0,1];
   midpoint (x = 0.5) is exactly the average of the two frames (harness-checked). */
function avWtMorph(t, iA, iB, x) {
  try {
    if (!avWtIsTable(t)) return null;
    const a = Math.floor(Number(iA));
    const b = Math.floor(Number(iB));
    if (!(a >= 0 && a < t.frames.length) || !(b >= 0 && b < t.frames.length)) return null;
    let f = Number(x);
    if (!isFinite(f)) f = 0;
    f = f < 0 ? 0 : (f > 1 ? 1 : f);
    const A = t.frames[a], B = t.frames[b];
    const out = new Float64Array(AV_WT_N);
    for (let j = 0; j < AV_WT_N; j++) out[j] = A[j] * (1 - f) + B[j] * f;
    return out;
  } catch (e) { return null; }
}

/* ---------- the MIP LAW (§2.5; = src/av_dsp.js buildTables lines 214-266) ----------
   analysis FFT -> per level keep only bins of harmonics 1..(1024>>k), zero DC and the rest
   (the mirror side dies with its harmonic) -> IFFT -> ALL levels scaled by g = 0.95 / peak(level 0). */

function avWtMips(frame) {
  try {
    const f = avWtF64(frame);
    if (!f) return null;
    const n = AV_WT_N;
    const re = f, im = new Float64Array(n);
    if (!avWtFft(re, im, false)) return null;
    const out = [];
    for (let k = 0; k < AV_WT_LEVELS; k++) {
      const H = AV_WT_HMAX >> k;
      const re2 = new Float64Array(n), im2 = new Float64Array(n);
      for (let b = 1; b < n; b++) {
        const harm = (b <= n - b) ? b : (n - b);   /* the harmonic this bin carries */
        if (harm <= H) { re2[b] = re[b]; im2[b] = im[b]; }
      }
      if (!avWtFft(re2, im2, true)) return null;
      out.push(re2);
    }
    let peak = 0;
    const f0 = out[0];
    for (let i = 0; i < n; i++) { const a = f0[i] < 0 ? -f0[i] : f0[i]; if (a > peak) peak = a; }
    const gain = peak > 0 ? AV_WT_PEAK / peak : 1;
    if (gain !== 1) {
      for (let k = 0; k < AV_WT_LEVELS; k++) {
        const fr = out[k];
        for (let i = 0; i < n; i++) fr[i] *= gain;
      }
    }
    return out;
  } catch (e) { return null; }
}

/* ---------- install (§2.5): bake one frame -> avEngineWt(slot, name, mips) ---------- */

function avWtInstall(t, slot, frameIdx) {
  try {
    if (!avWtIsTable(t)) { avWtState.lastError = "bad-table"; return { ok: false, slot: -1, error: "bad-table" }; }
    let s = -1;
    if (slot === undefined || slot === null) {
      for (let i = 0; i < AV_WT_SLOTS; i++) if (!avWtState.installed[i]) { s = i; break; }
      if (s < 0) return { ok: false, slot: -1, error: "no-slot" };
    } else {
      s = Math.floor(Number(slot));
      if (!(s >= 0 && s < AV_WT_SLOTS)) return { ok: false, slot: -1, error: "bad-slot" };
    }
    const fi = (frameIdx === undefined || frameIdx === null) ? 0 : Math.floor(Number(frameIdx));
    if (!(fi >= 0 && fi < t.frames.length)) return { ok: false, slot: s, error: "bad-frame" };
    const mips = avWtMips(t.frames[fi]);
    if (!mips) return { ok: false, slot: s, error: "bad-frame" };
    const name = avWtCleanName(t.name);
    if (typeof avEngineWt !== "function") {
      avWtState.lastError = "no-engine";
      return { ok: false, slot: s, error: "no-engine" };
    }
    let r = false;
    try { r = avEngineWt(s, name, mips); }
    catch (e) { avWtState.lastError = "send-threw"; return { ok: false, slot: s, error: "send-threw" }; }
    if (r !== true) { avWtState.lastError = "engine-refused"; return { ok: false, slot: s, error: "engine-refused" }; }
    avWtState.installed[s] = { slot: s, name: name, at: Date.now(), frames: t.frames.length };
    avWtState.lastError = null;
    return { ok: true, slot: s };
  } catch (e) {
    const m = "install:" + avWtErrStr(e);
    avWtState.lastError = m;
    return { ok: false, slot: -1, error: m };
  }
}

function avWtInstalled() {
  const out = [];
  try {
    for (let i = 0; i < AV_WT_SLOTS; i++) {
      const r = avWtState.installed[i];
      if (r) out.push({ slot: r.slot, name: r.name });
    }
  } catch (e) { /* empty */ }
  return out;
}

/* EXACTLY 16 entries; value strings are wt.user0..wt.user15 (the av_dsp parser pins them). */
function avWtUserOscNames() {
  const out = [];
  for (let n = 0; n < AV_WT_SLOTS; n++) {
    let r = null;
    try { r = avWtState.installed[n]; } catch (e) { r = null; }
    out.push({ value: "wt.user" + n, label: "USER " + n + " \u00b7 " + (r ? r.name : "empty") });
  }
  return out;
}

/* ---------- JSON export / import (§2.5) ---------- */

function avWtExportJson(t) {
  try {
    if (!avWtIsTable(t)) return null;
    const fr = [];
    for (let i = 0; i < t.frames.length; i++) fr.push(Array.from(t.frames[i]));
    return JSON.stringify({ v: 1, name: t.name, frames: fr });
  } catch (e) { return null; }
}

function avWtImportJson(str) {
  try {
    if (typeof str !== "string" || !str) return { error: "bad-json" };
    let o = null;
    try { o = JSON.parse(str); } catch (e) { return { error: "bad-json" }; }
    if (!o || typeof o !== "object" || Array.isArray(o)) return { error: "bad-shape" };
    if (o.v != null && o.v !== 1) return { error: "bad-version" };
    if (!Array.isArray(o.frames) || o.frames.length < 1) return { error: "no-frames" };
    if (o.frames.length > AV_WT_MAX_FRAMES) return { error: "too-many-frames" };
    const frames = [];
    for (let i = 0; i < o.frames.length; i++) {
      const f = avWtF64(o.frames[i]);
      if (!f) return { error: "bad-frame" };
      frames.push(f);
    }
    const t = avWtTableFrom(frames, o.name);
    avWtState.made += 1;
    return t;
  } catch (e) { return { error: "bad-json" }; }
}

/* ---------- packed wavetable import (§2.5 — format verdict in the header) ---------- */

function avWtBytes(buf) {
  try {
    if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
    if (buf && typeof buf === "object" && typeof buf.byteLength === "number"
        && typeof buf.byteOffset === "number" && buf.buffer && typeof buf.buffer.byteLength === "number") {
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength > 0 ? buf.byteLength : 0);
    }
  } catch (e) { /* not byte-ish */ }
  return null;
}

/* spectral (band-limited) resample of one frame to 2048 samples: harmonics keep their index,
   X_dst[h] = (2048/srcSize) * X_src[h]; the source Nyquist bin (h = srcSize/2) is dropped. */
function avWtResample(src, srcSize) {
  try {
    if (srcSize === AV_WT_N) { const c = new Float64Array(AV_WT_N); c.set(src); return c; }
    if (!avWtPow2(srcSize) || srcSize < 2 || srcSize > 8192) return null;
    const re = new Float64Array(srcSize), im = new Float64Array(srcSize);
    for (let i = 0; i < srcSize; i++) { const v = Number(src[i]); re[i] = isFinite(v) ? v : 0; }
    if (!avWtFft(re, im, false)) return null;
    const r = AV_WT_N / srcSize;
    const re2 = new Float64Array(AV_WT_N), im2 = new Float64Array(AV_WT_N);
    const hmax = Math.min((srcSize >> 1) - 1, (AV_WT_N >> 1) - 1);
    for (let h = 1; h <= hmax; h++) {
      re2[h] = re[h] * r; im2[h] = im[h] * r;
      re2[AV_WT_N - h] = re[srcSize - h] * r; im2[AV_WT_N - h] = im[srcSize - h] * r;
    }
    if (!avWtFft(re2, im2, true)) return null;
    return re2;
  } catch (e) { return null; }
}

function avWtParseVawt(u8, dv, nameIn) {
  const len = u8.length;
  if (len < 12) return { error: "truncated 'vawt' file: the 12-byte header needs at least 12 bytes" };
  const size = dv.getUint32(4, true);
  const count = dv.getUint16(8, true);
  const flags = dv.getUint16(10, true);
  if ((flags & 0x1) !== 0) return { error: "this .wt is flagged as a sample, not a wavetable" };
  if (!avWtPow2(size) || size < 2 || size > 4096) return { error: "bad 'vawt' wave size (" + size + "): must be a power of two in 2..4096" };
  if (!(count >= 1 && count <= 512)) return { error: "bad 'vawt' wave count (" + count + ")" };
  if (count > AV_WT_MAX_FRAMES) return { error: count + " frames \u2014 the editor caps wavetables at " + AV_WT_MAX_FRAMES };
  const isInt16 = (flags & 0x4) !== 0;
  const full16 = (flags & 0x8) !== 0;
  const bps = isInt16 ? 2 : 4;
  const need = 12 + count * size * bps;
  if (len < need) return { error: "truncated 'vawt' file: need " + need + " bytes, have " + len };
  const scale = isInt16 ? (full16 ? 1 / 32768 : 1 / 16384) : 1;
  const frames = [];
  for (let fr = 0; fr < count; fr++) {
    const base = 12 + fr * size * bps;
    const src = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      let v = isInt16 ? dv.getInt16(base + i * bps, true) : dv.getFloat32(base + i * bps, true);
      if (!isFinite(v)) v = 0;
      src[i] = v * scale;
    }
    const f = avWtResample(src, size);
    if (!f) return { error: "resample failed (" + size + " -> 2048)" };
    frames.push(f);
  }
  return {
    frames: frames,
    name: nameIn ? avWtCleanName(nameIn) : "imported",
    frameSize: size,
    source: "vawt",
    note: (size !== AV_WT_N) ? "spectrally resampled " + size + " \u2192 2048" : null,
  };
}

function avWtParseRiff(u8, dv, nameIn) {
  const len = u8.length;
  if (len < 12) return { error: "not a RIFF WAVE file (too short)" };
  if (String.fromCharCode(u8[8], u8[9], u8[10], u8[11]) !== "WAVE") return { error: "not a RIFF WAVE file (no WAVE tag)" };
  let fmtOff = -1, fmtSize = 0, dataOff = -1, dataSize = 0, clm = null, sawUhwt = false;
  let cur = 12;
  while (cur + 8 <= len) {
    const id = String.fromCharCode(u8[cur], u8[cur + 1], u8[cur + 2], u8[cur + 3]);
    const sz = dv.getUint32(cur + 4, true);
    const off = cur + 8;
    if (sz === 0xffffffff) return { error: "RIFF chunk '" + id.trim() + "' has an unbounded size" };
    if (off + sz > len) {
      if (id === "data") return { error: "truncated RIFF: 'data' needs " + sz + " bytes, have " + (len - off) };
      break;                                    /* a torn trailing chunk after everything useful */
    }
    if (id === "fmt " && fmtOff < 0) { fmtOff = off; fmtSize = sz; }
    else if (id === "data" && dataOff < 0) { dataOff = off; dataSize = sz; }
    else if (id === "clm ") {
      const n = sz < 4096 ? sz : 4096;
      let s = "";
      for (let i = 0; i < n; i++) s += String.fromCharCode(u8[off + i]);
      clm = s;
    }
    else if (id === "uhWT") sawUhwt = true;     /* Hive metadata: Surge treats it as a 2048 marker */
    cur = off + sz + (sz & 1);
  }
  if (fmtOff < 0 || fmtSize < 16) return { error: "RIFF 'fmt ' chunk missing or too small" };
  if (dataOff < 0 || dataSize < 1) return { error: "RIFF 'data' chunk missing" };
  const audioFormat = dv.getUint16(fmtOff, true);
  const channels = Math.max(1, dv.getUint16(fmtOff + 2, true));
  const bits = dv.getUint16(fmtOff + 14, true);
  let bps = 0, read = null;
  if (audioFormat === 1 && bits === 16) { bps = 2; read = function (o) { return dv.getInt16(o, true) / 32768; }; }
  else if (audioFormat === 3 && bits === 32) { bps = 4; read = function (o) { return dv.getFloat32(o, true); }; }
  else if (audioFormat === 1 && bits === 32) { bps = 4; read = function (o) { return dv.getInt32(o, true) / 2147483648; }; }
  else {
    return { error: "unsupported WAV sample format (" + (audioFormat === 1 ? "PCM" : "format " + audioFormat) + ", " + bits
      + "-bit) \u2014 export 16-bit PCM or 32-bit float" };
  }
  /* clm chunk: "<!>AAAA BC000000 vendor" — AAAA is the cycle size */
  let frameSize = 0, note = null;
  if (clm) {
    let s = clm;
    if (s.charCodeAt(0) === 60 && s.charCodeAt(1) === 33 && s.charCodeAt(2) === 62) s = s.slice(3);  /* '<!>' */
    const m = /^(\d{1,5})/.exec(s);
    if (m) {
      const n0 = parseInt(m[1], 10);
      if (avWtPow2(n0) && n0 >= 2 && n0 <= 8192) frameSize = n0;
      else note = "clm cycle size " + n0 + " unusable (not a power of two in 2..8192) \u2014 assumed 2048";
    }
  }
  if (!frameSize) {
    frameSize = 2048;
    if (!clm && !sawUhwt) note = "no 'clm ' chunk \u2014 assumed 2048-sample frames (the Serum/Vital convention)";
    else if (frameSize !== AV_WT_N) note = "clm/uhWT without a usable cycle size \u2014 assumed 2048";
  }
  const stride = bps * channels;
  const nTotal = Math.floor(dataSize / stride);
  const count = Math.floor(nTotal / frameSize);
  if (count < 1) return { error: "wavetable too short: " + nTotal + " samples, not even one " + frameSize + "-sample frame" };
  if (count > AV_WT_MAX_FRAMES) return { error: count + " frames \u2014 the editor caps wavetables at " + AV_WT_MAX_FRAMES };
  const frames = [];
  for (let fr = 0; fr < count; fr++) {
    const base = dataOff + fr * frameSize * stride;
    const src = new Float64Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      let v = read(base + i * stride);
      if (!isFinite(v)) v = 0;
      src[i] = v;
    }
    const f = avWtResample(src, frameSize);
    if (!f) return { error: "resample failed (" + frameSize + " -> 2048)" };
    frames.push(f);
  }
  if (!note && frameSize !== AV_WT_N) note = "spectrally resampled " + frameSize + " \u2192 2048";
  return {
    frames: frames,
    name: nameIn ? avWtCleanName(nameIn) : "imported",
    frameSize: frameSize,
    source: (clm || sawUhwt) ? "wav-clm" : "wav",
    note: note,
  };
}

/* avWtImportWt(buf[, name]) -> {frames:[Float64Array(2048)], name, frameSize, source, note}
   | {error:"<clear sentence>"}. Accepts 'vawt' .wt (Surge XT/Bitwig) and packed RIFF WAVE
   wavetables ('clm ' chunk, Serum style). Never throws. */
function avWtImportWt(buf, name) {
  try {
    const u8 = avWtBytes(buf);
    if (!u8) return { error: "cannot read the file: expected an ArrayBuffer or Uint8Array" };
    if (u8.length < 4) return { error: "not a wavetable file (too short: " + u8.length + " bytes)" };
    const mag = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
    let r = null;
    if (mag === "vawt") r = avWtParseVawt(u8, new DataView(u8.buffer, u8.byteOffset, u8.byteLength), name);
    else if (mag === "RIFF") r = avWtParseRiff(u8, new DataView(u8.buffer, u8.byteOffset, u8.byteLength), name);
    else if (mag === "RF64") return { error: "RF64 files are not supported \u2014 save as a plain RIFF WAVE" };
    if (!r) {
      const m = "unrecognized wavetable container \u2014 expected 'vawt' (Surge XT / Bitwig .wt) or a RIFF WAVE packed wavetable with a 'clm ' chunk (Serum style)";
      avWtState.lastError = "unknown-format";
      return { error: m };
    }
    if (r.error) { avWtState.lastError = r.error; return { error: r.error }; }
    avWtState.lastError = null;
    return r;
  } catch (e) {
    const m = "import failed: " + avWtErrStr(e);
    avWtState.lastError = m;
    return { error: m };
  }
}

/* ---------- the library (§2.5): IDB `av-wt-store`, LS fallback, memory last ---------- */

function avWtLs() {
  try { if (typeof localStorage !== "undefined" && localStorage) return localStorage; } catch (e) { /* blocked */ }
  try { const w = (typeof window !== "undefined") ? window : null; if (w && w.localStorage) return w.localStorage; } catch (e) { /* blocked */ }
  return null;
}

function avWtIdb() {
  try { if (typeof indexedDB !== "undefined" && indexedDB) return indexedDB; } catch (e) { /* none */ }
  try { const w = (typeof window !== "undefined") ? window : null; if (w && w.indexedDB) return w.indexedDB; } catch (e) { /* none */ }
  return null;
}

function avWtTimer(fn, ms) {
  try { if (typeof setTimeout === "function") return setTimeout(fn, ms); } catch (e) { /* no timers */ }
  return null;
}

function avWtLibRec(id, v) {
  try {
    if (!v || typeof v !== "object") return null;
    const idS = String((id != null) ? id : v.id);
    if (!AV_WT_ID_RE.test(idS)) return null;
    const fi = v.frames;
    if (!Array.isArray(fi) || fi.length < 1 || fi.length > AV_WT_MAX_FRAMES) return null;
    const frames = [];
    for (let i = 0; i < fi.length; i++) {
      const f = avWtF64(fi[i]);
      if (!f) return null;
      frames.push(f);
    }
    let savedAt = Number(v.savedAt);
    if (!isFinite(savedAt) || savedAt < 0) savedAt = 0;
    return { id: idS, v: 1, name: avWtCleanName(v.name), savedAt: savedAt, frames: frames };
  } catch (e) { return null; }
}

function avWtDbOpen() {
  const st = avWtState.lib;
  return new Promise(function (res) {
    if (st.db) return res(st.db);
    if (st.dbGaveUp) return res(null);
    const idb = avWtIdb();
    if (!idb) { st.dbGaveUp = true; return res(null); }
    st.opens += 1;
    let settled = false;
    let timer = null;
    const give = function (v) { if (!settled) { settled = true; res(v); } };
    try {
      timer = avWtTimer(function () { st.dbGaveUp = true; give(null); }, AV_WT_OPEN_CAP_MS);
      const rq = idb.open(AV_WT_DB, AV_WT_DB_VER);
      rq.onupgradeneeded = function () {
        try { const db = rq.result; if (!db.objectStoreNames || !db.objectStoreNames.contains(AV_WT_OS)) db.createObjectStore(AV_WT_OS, { keyPath: "id" }); }
        catch (e) { /* upgrade raced */ }
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

function avWtDbAll(db) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_WT_OS, "readonly");
      const rq = tx.objectStore(AV_WT_OS).getAll();
      rq.onsuccess = function () { res(rq.result || []); };
      rq.onerror = function () { res(null); };
      tx.onerror = function () { res(null); };
    } catch (e) { res(null); }
  });
}

function avWtDbPut(db, rec) {
  return new Promise(function (res, rej) {
    try {
      const tx = db.transaction(AV_WT_OS, "readwrite");
      tx.objectStore(AV_WT_OS).put(rec);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { rej((tx.error) || new Error("idb write failed")); };
      tx.onabort = function () { rej((tx.error) || new Error("idb write aborted")); };
    } catch (e) { rej(e); }
  });
}

function avWtDbDel(db, id) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_WT_OS, "readwrite");
      tx.objectStore(AV_WT_OS).delete(id);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { res(false); };
      tx.onabort = function () { res(false); };
    } catch (e) { res(false); }
  });
}

/* LS snapshot: {id -> rec}. Returns {} when absent, null when localStorage is unavailable. */
function avWtLsRead() {
  try {
    const ls = avWtLs();
    if (!ls) return null;
    const raw = ls.getItem(AV_WT_LS);
    if (raw == null) return {};
    let obj = null;
    try { obj = JSON.parse(raw); } catch (e) { return {}; }
    const out = {};
    if (obj && typeof obj === "object" && obj.items && typeof obj.items === "object") {
      const keys = Object.keys(obj.items);
      for (let i = 0; i < keys.length; i++) {
        const rec = avWtLibRec(keys[i], obj.items[keys[i]]);
        if (rec) out[rec.id] = rec;
      }
    }
    return out;
  } catch (e) { return null; }
}

/* full-map LS write; returns 'ok' | 'quota' | 'err' | 'none'. */
function avWtLsWriteAll(map) {
  try {
    const ls = avWtLs();
    if (!ls) return "none";
    const items = {};
    map.forEach(function (rec, id) {
      const fr = [];
      for (let i = 0; i < rec.frames.length; i++) fr.push(Array.from(rec.frames[i]));
      items[id] = { id: rec.id, v: 1, name: rec.name, savedAt: rec.savedAt, frames: fr };
    });
    ls.setItem(AV_WT_LS, JSON.stringify({ v: 1, items: items }));
    return "ok";
  } catch (e) { return (avWtErrName(e) === "QuotaExceededError") ? "quota" : "err"; }
}

function avWtLibEnsure() {
  const st = avWtState.lib;
  if (st.promise) return st.promise;
  try {
    st.promise = avWtLibHydrate().catch(function (e) {
      st.lastError = "hydrate:" + avWtErrStr(e);
      st.hydrated = true;
      return st.backend;
    });
    return st.promise;
  } catch (e) {
    st.hydrated = true;
    return Promise.resolve(st.backend);
  }
}

async function avWtLibHydrate() {
  const st = avWtState.lib;
  if (st.hydrated) return st.backend;
  st.mem = new Map();
  const db = await avWtDbOpen();
  const lsMap = avWtLsRead();                       /* {} | null(unavailable) */
  if (db) {
    st.backend = "idb";
    const recs = await avWtDbAll(db);
    if (recs) {
      for (let i = 0; i < recs.length; i++) {
        const rec = avWtLibRec(recs[i] && recs[i].id, recs[i]);
        if (rec) st.mem.set(rec.id, rec);
      }
    }
    /* the LS snapshot is written only by a session that could not reach this DB — its ids win
       (the av_store.js law), get written through, and the key retires once they are all safe */
    if (lsMap) {
      const ids = Object.keys(lsMap);
      let want = 0, landed = 0;
      for (let i = 0; i < ids.length; i++) {
        want += 1;
        try { await avWtDbPut(db, lsMap[ids[i]]); st.mem.set(ids[i], lsMap[ids[i]]); landed += 1; } catch (e) { /* best effort */ }
      }
      if (want && want === landed) { try { const ls = avWtLs(); if (ls) ls.removeItem(AV_WT_LS); } catch (e) { /* keep the spare copy */ } }
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

function avWtLibraryInit() {
  try { avWtLibEnsure(); return true; } catch (e) { return false; }
}

function avWtLibrarySave(t) {
  try { return Promise.resolve(avWtLibSaveRun(t)).catch(function (e) { return { ok: false, error: "save:" + avWtErrStr(e) }; }); }
  catch (e) { return Promise.resolve({ ok: false, error: "save:" + avWtErrStr(e) }); }
}

async function avWtLibSaveRun(t) {
  const st = avWtState.lib;
  if (!avWtIsTable(t)) return { ok: false, error: "bad-table" };
  await avWtLibEnsure();
  const id = (typeof t.id === "string" && AV_WT_ID_RE.test(t.id)) ? t.id : avWtNextId();
  const frames = [];
  for (let i = 0; i < t.frames.length; i++) {
    const f = avWtF64(t.frames[i]);
    if (!f) return { ok: false, error: "bad-frame" };
    frames.push(f);
  }
  const rec = { id: id, v: 1, name: avWtCleanName(t.name), savedAt: Date.now(), frames: frames };
  if (st.db) {
    try {
      await avWtDbPut(st.db, rec);
      st.mem.set(id, rec);
      st.lastError = null;
      return { ok: true, id: id, backend: "idb" };
    } catch (e) {
      const nm = avWtErrName(e);
      if (nm === "InvalidStateError" || nm === "TransactionInactiveError") {
        st.db = null;                        /* a closed connection may heal on the NEXT call */
      }
      const err = (nm === "QuotaExceededError") ? "quota" : ("idb:" + (nm || "error"));
      st.lastError = err;
      return { ok: false, error: err, backend: "idb" };
    }
  }
  if (avWtLs()) {
    const map = new Map(st.mem);
    map.set(id, rec);
    const w = avWtLsWriteAll(map);
    if (w === "ok") {
      st.mem.set(id, rec);
      if (st.backend === "mem") st.backend = "ls";
      st.lastError = null;
      return { ok: true, id: id, backend: "ls" };
    }
    if (w === "quota") { st.lastError = "quota"; return { ok: false, error: "quota", backend: "ls" }; }
    /* 'err'/'none': storage unavailable — fall through to memory */
  }
  st.mem.set(id, rec);
  st.lastError = null;
  return { ok: true, id: id, backend: "mem", volatile: true };
}

function avWtLibraryLoad(id) {
  try { return Promise.resolve(avWtLibLoadRun(id)).catch(function () { return null; }); }
  catch (e) { return Promise.resolve(null); }
}

async function avWtLibLoadRun(id) {
  const st = avWtState.lib;
  if (typeof id !== "string" || !AV_WT_ID_RE.test(id)) return null;
  await avWtLibEnsure();
  const rec = st.mem.get(id);
  if (!rec) return null;
  const frames = [];
  for (let i = 0; i < rec.frames.length; i++) {
    const c = new Float64Array(AV_WT_N);
    c.set(rec.frames[i]);
    frames.push(c);                          /* fresh copies: the store is never aliased */
  }
  return avWtTableFrom(frames, rec.name, rec.id);
}

function avWtLibraryDelete(id) {
  try { return Promise.resolve(avWtLibDelRun(id)).catch(function () { return false; }); }
  catch (e) { return Promise.resolve(false); }
}

async function avWtLibDelRun(id) {
  const st = avWtState.lib;
  if (typeof id !== "string" || !AV_WT_ID_RE.test(id)) return false;
  await avWtLibEnsure();
  let dropped = false;
  if (st.db) {
    dropped = await avWtDbDel(st.db, id);
  } else {
    let w = "none";
    if (avWtLs()) {
      const map = new Map(st.mem);
      map.delete(id);
      w = avWtLsWriteAll(map);
    }
    if (w === "ok") dropped = true;
    else if (w === "quota") dropped = false; /* the durable tier refused: the entry stays, honest */
    else dropped = (st.backend === "mem");   /* nothing durable was in use */
  }
  if (dropped) st.mem.delete(id);
  return dropped;
}

function avWtLibraryList() {
  try { return Promise.resolve(avWtLibListRun()).catch(function () { return []; }); }
  catch (e) { return Promise.resolve([]); }
}

async function avWtLibListRun() {
  const st = avWtState.lib;
  await avWtLibEnsure();
  const out = [];
  st.mem.forEach(function (rec, id) {
    out.push({
      id: id,
      name: rec.name,
      frameCount: rec.frames.length,
      bytes: rec.frames.length * AV_WT_N * 8,
      savedAt: rec.savedAt,
      backend: st.backend,
    });
  });
  out.sort(function (a, b) { return (b.savedAt - a.savedAt) || (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)); });
  return out;
}

/* ---------- reports (§2.5) ---------- */

function avWtSnap() {
  try {
    const st = avWtState;
    const lib = st.lib;
    const ids = [];
    lib.mem.forEach(function (rec, id) { ids.push(id); });
    ids.sort();
    const installed = [];
    const free = [];
    for (let i = 0; i < AV_WT_SLOTS; i++) {
      const r = st.installed[i];
      if (r) installed.push({ slot: r.slot, name: r.name, frames: r.frames, at: r.at });
      else free.push(i);
    }
    return {
      version: AV_WT_VERSION,
      ok: true,
      made: st.made,
      next: st.seq,
      installed: installed,
      freeSlots: free,
      library: {
        backend: lib.hydrated ? lib.backend : null,
        hydrated: !!lib.hydrated,
        count: lib.mem.size,
        ids: ids,
        lastError: lib.lastError,
      },
      lastError: st.lastError,
    };
  } catch (e) {
    return { version: AV_WT_VERSION, ok: false, lastError: "snap:" + avWtErrStr(e) };
  }
}

/* no new CSS classes — the WT editor card (sa-F) owns every class it emits. */
function avWtClasses() { return []; }

/* ---------- the page handle (guarded; the rig reads window.__avWt, §2.7) ---------- */

if (typeof window !== "undefined" && window) {
  try {
    window.__avWt = {
      version: AV_WT_VERSION,
      VERSION: AV_WT_VERSION,
      newTable: avWtNew,
      frameCount: avWtFrameCount,
      setFrame: avWtSetFrame,
      addFrame: avWtAddFrame,
      delFrame: avWtDelFrame,
      seed: avWtSeedFrom,
      morph: avWtMorph,
      mips: avWtMips,
      install: avWtInstall,
      installed: avWtInstalled,
      userOscNames: avWtUserOscNames,
      library: {
        init: avWtLibraryInit,
        list: avWtLibraryList,
        save: avWtLibrarySave,
        load: avWtLibraryLoad,
        del: avWtLibraryDelete,
      },
      exportJson: avWtExportJson,
      importJson: avWtImportJson,
      importWt: avWtImportWt,
      snap: avWtSnap,
      classes: avWtClasses,
      kinds: AV_WT_KINDS.slice(),
      maxFrames: AV_WT_MAX_FRAMES,
      slots: AV_WT_SLOTS,
    };
  } catch (e) { /* exposure is best-effort */ }
}
