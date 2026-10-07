/* av_mix.js -- Anvil S3 wave (MIX & MASTER): the mix engine. Per-track chains (fader -> drive ->
   dyn -> duck -> balance), four source types (take / comp / engine / buffers), send buses
   (A: AVFXVERB wet-only; B: AVFXDELAY module-final), bus glue (AVFXDYN), the master chain
   (drive -> dyn = EQ -> comp -> limiter -> soft-clip), LUFS normalize via av_loud, the chunked
   offline render, seeded-dither WAV export, auto-balance and the A/B reference compare.

   Contract: verify/_s3_wave.md sections 2.2 (pinned interface) + 3 (wave laws, items 1-6 + 8).
   ONE namespace (avMix-prefixed functions + AV_MIX_ constants), strict mode, classic script,
   node-loadable (no DOM at load; guarded typeof window probe at the very end), NEVER throws
   (honest refusal objects, counted skips), no console noise, allocation at render time only,
   monomorphic per-sample loop.

   PIN SUMMARY (do not drift):
   - Track model: { id:'m1'.., name, source, gainDb -60..+24 (def 0), pan -1..1 (def 0), mute,
     solo, sends:{a:0,b:0}, duck:{src:null|trackId, depthDb:0..24}, fx:{drive,dyn},
     rendered:{frames}|null }.
   - Chain order (per track): latency advance -> fader -> insert FX (drive -> dyn, each blended
     per its module convention; a disabled state is not called) -> duck multiplier (post-FX,
     pre-pan; scales the contribution incl. sends) -> balance pan -> main += x, sendA += a*x,
     sendB += b*x per channel (sends are post-fader taps of the FINAL contribution).
   - Fader: avMixFaderGain(-60) === 0 EXACTLY. Balance law: gL = pan>0 ? 1-pan : 1;
     gR = pan<0 ? 1+pan : 1 (center = exact unity; hard pan = one exact-zero channel).
   - Audible law: (anySolo ? solo : true) && !mute.
   - Duck: env source = the duck.src track's compensated source x ITS fader gain (pre-FX); peak
     follower AV_MIX_DUCK_ATT 0.005 s / AV_MIX_DUCK_REL 0.15 s; env01 = clamp(env/0.5, 0, 1);
     duckGain = 10^(-(depthDb*env01)/20). Envelopes precomputed once per referenced source per
     render. Self-reference refused (honest, counted).
   - Buses: send A -> AVFXVERB state wet-only (on:1, mix:1); send B -> AVFXDELAY (on:1, mix:1 =
     module-final convention = pure delayed signal). Bus output x return gain -> main bus.
   - Glue: main bus -> AVFXDYN state (glue.* paths; off = skipped).
   - Master: drive -> dyn (dyn blended by its own mix; drive has no mix pin -> wet-only).
   - Normalize (post-chain): gainDb = min(target - lufs, ceiling - dbtp) via av_loud (guarded;
     absent -> skipped + warning). norm.limited records the TP-bound case honestly.
   - Render: fresh states per render; chunks of AV_MIX_CHUNK_FRAMES with await yields; progress
     best-effort; zero randomness (dither lives at export only); fresh output arrays; cap
     AV_MIX_MAX_SECONDS 300 -> refuse above; foreign source rates resampled linearly + warning.
   - Export: uses lastRender only; stale (render.rev !== mix.rev) -> honest refusal; dither via
     pure.ditherApply (seeded xorshift32; off/tpdf/shaped; auto = tpdf for 16, off for 24/32f;
     32f ignores dither) then avWavEncode(..., dither:false) -- the encoder stays untouched.
   - autoBalance: per audible track deltaDb = clamp(target - lufs, -24, +24); applied
     gainDb = clamp(old + delta, -60, +24); silent material (lufs null) skipped; rows + applied.
   - A/B: setRef {l,r,sr} | {take:id} | {comp:id} | null; compare ->
     gainToMatchDb = mixLufs - refLufs (the gain to apply to the REFERENCE to match the mix).

   DOCUMENTED CHOICES (this file's reading of the pin where it leaves room; reported):
   - Track FX param names (flat, per module; dyn accepts comp./lim. aliases):
     drive {on, mix, mode, amount, tone, bits, down};
     dyn {on, mix, eqLo, eqMid, eqHi, thresh, ratio, att, rel, makeup, ceiling}.
   - Insert fader precedes the FX (pin: fader gain is pre-FX); the FX see the faded signal.
   - Glue runs fully wet (copy) -- the glue.* pin has no mix and the bus comp IS the bus sound.
   - Master drive has no mix pin -> run wet-only (mix = 1).
   - trackEnd uses render-rate frames: identical to the pin when source rate == render rate; for
     resampled sources it preserves duration (a 44.1k source in a 48k render loses its tail
     otherwise).
   - comp data is read from the avComp.comps store's `rendered.data` behind typeof+try guards
     (the avCompRender receipt carries no data arrays); a receipt that carries `data` is used
     when present.
   - opts.seconds on render = explicit length override (else max(trackEnd) + tailS*sr).
   - autoBalance is synchronous: engine (avBounce) sources need the async browser render -> the
     row is marked skipped (render first).
   - avMixClasses() returns [] (this file is the pure core; the card's class list is av_mix_ui).
   - avMixSetRef stores the caller's arrays by reference (no copy; the caller owns them).
   - normalize / autoBalance / compare measure with av_loud behind typeof+try guards; when
     av_loud is absent the receipt fields are null (never NaN) and the path is skipped honestly.
*/
"use strict";

const AV_MIX_VERSION = "s3.0";
const AV_MIX_CHUNK_FRAMES = 131072;   /* render chunk (pin) */
const AV_MIX_MAX_SECONDS = 300;       /* output cap (pin): refuse above */
const AV_MIX_SR_DEF = 48000;
const AV_MIX_SRS = [48000, 44100];
const AV_MIX_TAIL_DEF = 1.0;
const AV_MIX_TAIL_MAX = 10;           /* 0..10 s (pin) */
const AV_MIX_FLOOR_S = 0.25;          /* minimum render length (pin) */
const AV_MIX_GAIN_MIN = -60;          /* track fader floor (pin): -60 == exact zero */
const AV_MIX_GAIN_MAX = 24;
const AV_MIX_DUCK_ATT = 0.005;        /* duck envelope attack (pin) */
const AV_MIX_DUCK_REL = 0.15;         /* duck envelope release (pin) */
const AV_MIX_DUCK_MAX = 24;           /* depthDb ceiling (pin) */
const AV_MIX_DUCK_KNEE = 0.5;         /* env01 = clamp(env / 0.5, 0, 1) (pin) */
const AV_MIX_NORM_TARGETS = [-14, -16, -23];
const AV_MIX_DITHER_SEED = 0x9E3779B9; /* default export dither seed (pin: AV_MIX_DITHER_SEED) */
const AV_MIX_DITHER_MODES = ["auto", "off", "tpdf", "shaped"];
const AV_MIX_DEFAULT_NAME = "anvil_mixdown.wav";

/* ---------- tiny helpers (never throw) ---------- */

function avMixNow() {
  try {
    if (typeof performance !== "undefined" && performance && typeof performance.now === "function") return performance.now();
  } catch (e) { /* fall through */ }
  try { return Date.now(); } catch (e2) { return 0; }
}

function avMixErr(e) {
  try { return String((e && (e.message || e.name)) || e) || "unknown error"; } catch (e2) { return "unknown error"; }
}

function avMixClamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function avMixFiniteNum(v) {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function avMixClampNum(v, dflt, lo, hi) {
  const n = avMixFiniteNum(v);
  if (n === null) return dflt;
  return avMixClamp(n, lo, hi);
}

function avMixOnOff(v) {
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = avMixFiniteNum(v);
  return n === null ? 0 : (n > 0 ? 1 : 0);
}

function avMixStr(v, dflt, max) {
  try {
    if (typeof v !== "string") return dflt;
    const s = v.replace(/\s+/g, " ").trim();
    if (!s) return dflt;
    return s.length > max ? s.slice(0, max) : s;
  } catch (e) { return dflt; }
}

function avMixHasOwn(o, k) {
  try { return Object.prototype.hasOwnProperty.call(o, k); } catch (e) { return false; }
}

function avMixIsChan(x) {
  try {
    return x != null && typeof x === "object" && typeof x.length === "number" && isFinite(x.length) && x.length >= 1;
  } catch (e) { return false; }
}

function avMixMergeList(dst, src, prefix) {
  try {
    if (!Array.isArray(src)) return;
    for (let i = 0; i < src.length; i++) dst.push(prefix + String(src[i]));
  } catch (e) { /* never throws */ }
}

/* ---------- module state ---------- */

const avMix = {
  inited: false,
  rev: 0,             /* bumps on every mutation; renders/refs/exports do NOT bump */
  seq: 1,             /* track id sequence: m1, m2, ... */
  tracks: [],
  params: null,       /* flat path tree (see AV_MIX_PARAM_DEFS) */
  ref: null,          /* resolved reference snapshot | null */
  lastRender: null,   /* internal full render receipt (carries l/r arrays) | null */
  lastRenderSum: null,/* JSON-safe summary for state() | null */
  lastExport: null,   /* JSON-safe export summary | null */
  lastError: null,
};

/* ---------- pinned param tree (flat paths; the ONLY master/send funnel) ---------- */

const AV_MIX_PARAM_DEFS = {
  "send.A.return":          { k: "num", d: 0.35, lo: 0, hi: 2 },
  "send.A.verb.mode":       { k: "enum", d: "plate", vals: ["plate", "fdn", "freeverb"] },
  "send.A.verb.size":       { k: "num", d: 0.5, lo: 0, hi: 1 },
  "send.A.verb.decay":      { k: "num", d: 0.55, lo: 0, hi: 1 },
  "send.A.verb.damp":       { k: "num", d: 0.3, lo: 0, hi: 1 },
  "send.A.verb.predelay":   { k: "num", d: 0.01, lo: 0, hi: 0.15 },
  "send.B.return":          { k: "num", d: 0.30, lo: 0, hi: 2 },
  "send.B.delay.time":      { k: "num", d: 0.3, lo: 0.01, hi: 2 },
  "send.B.delay.feedback":  { k: "num", d: 0.45, lo: 0, hi: 0.95 },
  "send.B.delay.pingpong":  { k: "num", d: 0.5, lo: 0, hi: 1 },
  "send.B.delay.spread":    { k: "num", d: 0.15, lo: 0, hi: 1 },
  "send.B.delay.duck":      { k: "num", d: 0, lo: 0, hi: 1 },
  "send.B.delay.div":       { k: "enum", d: "free", vals: ["free", "1/1", "1/2", "1/4", "1/8", "1/8d", "1/16"] },
  "send.B.delay.bpm":       { k: "num", d: 120, lo: 20, hi: 300 },
  "glue.on":                { k: "onoff", d: 0 },
  "glue.thresh":            { k: "num", d: -18, lo: -40, hi: 0 },
  "glue.ratio":             { k: "num", d: 2, lo: 1, hi: 20 },
  "glue.att":               { k: "num", d: 0.03, lo: 0.001, hi: 0.3 },
  "glue.rel":               { k: "num", d: 0.3, lo: 0.05, hi: 1 },
  "glue.makeup":            { k: "num", d: 0, lo: 0, hi: 24 },
  "master.drive.on":        { k: "onoff", d: 0 },
  "master.drive.mode":      { k: "enum", d: "sat", vals: ["sat", "fold", "crush"] },
  "master.drive.amount":    { k: "num", d: 0, lo: 0, hi: 1 },
  "master.drive.tone":      { k: "num", d: 0.5, lo: 0, hi: 1 },
  "master.dyn.on":          { k: "onoff", d: 0 },
  "master.dyn.eqLo":        { k: "num", d: 0, lo: -15, hi: 15 },
  "master.dyn.eqMid":       { k: "num", d: 0, lo: -15, hi: 15 },
  "master.dyn.eqHi":        { k: "num", d: 0, lo: -15, hi: 15 },
  "master.dyn.comp.thresh": { k: "num", d: -6, lo: -40, hi: 0 },
  "master.dyn.comp.ratio":  { k: "num", d: 2, lo: 1, hi: 20 },
  "master.dyn.comp.att":    { k: "num", d: 0.01, lo: 0.001, hi: 0.3 },
  "master.dyn.comp.rel":    { k: "num", d: 0.25, lo: 0.05, hi: 1 },
  "master.dyn.comp.makeup": { k: "num", d: 0, lo: 0, hi: 24 },
  "master.dyn.lim.ceiling": { k: "num", d: -1, lo: -6, hi: 0 },
  "master.dyn.mix":         { k: "num", d: 1, lo: 0, hi: 1 },
  "master.norm.on":         { k: "onoff", d: 0 },
  "master.norm.target":     { k: "normtarget", d: -14 },
  "master.norm.ceiling":    { k: "num", d: -1.0, lo: -3, hi: 0 },
};

function avMixDefaults() {
  const out = {};
  const keys = Object.keys(AV_MIX_PARAM_DEFS);
  for (let i = 0; i < keys.length; i++) out[keys[i]] = AV_MIX_PARAM_DEFS[keys[i]].d;
  return out;
}

/* validate one value against a def; always returns { ok, v } | { ok:false, error } */
function avMixAcceptDef(def, value) {
  try {
    switch (def.k) {
      case "onoff": {
        if (typeof value === "boolean") return { ok: true, v: value ? 1 : 0 };
        const n = Number(value);
        if (!isFinite(n)) return { ok: false, error: "expected 0/1" };
        return { ok: true, v: n > 0 ? 1 : 0 };
      }
      case "num": {
        const n = Number(value);
        if (!isFinite(n)) return { ok: false, error: "expected a finite number" };
        return { ok: true, v: avMixClamp(n, def.lo, def.hi) };
      }
      case "int": {
        const n = Number(value);
        if (!isFinite(n)) return { ok: false, error: "expected a finite number" };
        return { ok: true, v: avMixClamp(Math.round(n), def.lo, def.hi) };
      }
      case "enum": {
        const s = String(value);
        if (def.vals.indexOf(s) < 0) return { ok: false, error: "expected one of: " + def.vals.join(" | ") };
        return { ok: true, v: s };
      }
      case "normtarget": {
        const n = Number(value);
        if (!isFinite(n) || AV_MIX_NORM_TARGETS.indexOf(n) < 0) return { ok: false, error: "expected one of: -14 | -16 | -23" };
        return { ok: true, v: n };
      }
      default: return { ok: false, error: "unknown param kind" };
    }
  } catch (e) { return { ok: false, error: avMixErr(e) }; }
}

/* ---------- track FX (insert) param tables ---------- */

const AV_MIX_FX_DEF = {
  drive: {
    on:     { k: "onoff" },
    mix:    { k: "num", lo: 0, hi: 1 },
    mode:   { k: "enum", vals: ["sat", "fold", "crush"] },
    amount: { k: "num", lo: 0, hi: 1 },
    tone:   { k: "num", lo: 0, hi: 1 },
    bits:   { k: "int", lo: 4, hi: 16 },
    down:   { k: "int", lo: 1, hi: 32 },
  },
  dyn: {
    on:      { k: "onoff" },
    mix:     { k: "num", lo: 0, hi: 1 },
    eqLo:    { k: "num", lo: -15, hi: 15 },
    eqMid:   { k: "num", lo: -15, hi: 15 },
    eqHi:    { k: "num", lo: -15, hi: 15 },
    thresh:  { k: "num", lo: -40, hi: 0 },
    ratio:   { k: "num", lo: 1, hi: 20 },
    att:     { k: "num", lo: 0.001, hi: 0.3 },
    rel:     { k: "num", lo: 0.05, hi: 1 },
    makeup:  { k: "num", lo: 0, hi: 24 },
    ceiling: { k: "num", lo: -6, hi: 0 },
  },
};

const AV_MIX_FX_ALIAS = {
  "comp.thresh": "thresh",
  "comp.ratio": "ratio",
  "comp.att": "att",
  "comp.rel": "rel",
  "comp.makeup": "makeup",
  "lim.ceiling": "ceiling",
};

function avMixFxDefaults() {
  return {
    drive: { on: 0, mix: 1, mode: "sat", amount: 0, tone: 0.5, bits: 16, down: 1 },
    dyn: { on: 0, mix: 1, eqLo: 0, eqMid: 0, eqHi: 0, thresh: -6, ratio: 2, att: 0.01, rel: 0.25, makeup: 0, ceiling: -1 },
  };
}

/* ---------- pure helpers (pinned surface) ---------- */

function avMixDbToLin(db) {
  const n = Number(db);
  if (!isFinite(n)) return 0;
  return Math.pow(10, n / 20);
}

function avMixFaderGain(db) {
  const n = Number(db);
  if (!isFinite(n) || n <= AV_MIX_GAIN_MIN) return 0;   /* -60 -> exact zero (pin) */
  return Math.pow(10, n / 20);
}

function avMixBalanceGains(pan) {
  let p = Number(pan);
  if (!isFinite(p)) p = 0;
  p = avMixClamp(p, -1, 1);
  return { l: p > 0 ? 1 - p : 1, r: p < 0 ? 1 + p : 1 };
}

function avMixDuckGain(depthDb, env01) {
  let d = Number(depthDb);
  if (!isFinite(d) || d < 0) d = 0;
  let e = Number(env01);
  if (!isFinite(e)) e = 0;
  if (e < 0) e = 0; else if (e > 1) e = 1;
  return Math.pow(10, -(d * e) / 20);
}

/* peak follower: attack 5 ms / release 150 ms; src = a channel (array-like of numbers) OR an
   array of channels [chan, ...] (peak = max(|ch|) across channels, stereo-linked). Returns a
   Float32Array of per-sample envelope values (this is the raw envelope; the duck path scales it
   by the SOURCE track's fader gain before the /0.5 knee). Never throws; invalid src -> empty. */
function avMixEnvFollower(src, sr) {
  try {
    const rate = (() => { const n = avMixFiniteNum(sr); return (n !== null && n > 0) ? n : AV_MIX_SR_DEF; })();
    if (!avMixIsChan(src)) return new Float32Array(0);
    let chans = null, frames = 0;
    if (Array.isArray(src) && avMixIsChan(src[0])) {
      chans = [];
      for (let c = 0; c < src.length && c < 8; c++) if (avMixIsChan(src[c])) chans.push(src[c]);
      if (!chans.length) return new Float32Array(0);
      frames = chans[0].length;
      for (let c = 1; c < chans.length; c++) if (chans[c].length < frames) frames = chans[c].length;
    } else {
      chans = [src];
      frames = src.length;
    }
    return avMixEnvArr(chans, 0, frames, rate, frames);
  } catch (e) { return new Float32Array(0); }
}

/* internal: envelope over `len` samples reading chan[off + i] for i < frames (silence beyond). */
function avMixEnvArr(chans, off, frames, sr, len) {
  const env = new Float32Array(len > 0 ? len : 0);
  const aAtt = 1 - Math.exp(-1 / (AV_MIX_DUCK_ATT * sr));
  const aRel = 1 - Math.exp(-1 / (AV_MIX_DUCK_REL * sr));
  const nch = chans.length;
  let e = 0;
  for (let i = 0; i < len; i++) {
    let pk = 0;
    if (i < frames) {
      for (let c = 0; c < nch; c++) {
        const v = Math.abs(chans[c][off + i]);
        if (v > pk) pk = v;
      }
    }
    e += (pk - e) * (pk > e ? aAtt : aRel);
    env[i] = e;
  }
  return env;
}

/* ---------- seeded dither (export only) ---------- */

function avMixNormBits(bits) {
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

/* resolved dither mode: "auto" = tpdf for 16, off for 24/32f; 32f always off; unknown -> null */
function avMixNormDitherMode(mode, bits) {
  let m = mode;
  if (m === undefined || m === null || m === "auto") m = (bits === 16) ? "tpdf" : "off";
  if (typeof m !== "string") return null;
  const t = m.trim().toLowerCase();
  if (AV_MIX_DITHER_MODES.indexOf(t) < 0 || t === "auto") return null;
  if (bits === "32f") return "off";
  if (t !== "off" && bits !== 16 && bits !== 24) return null;
  return t;
}

function avMixRng(seed) {
  let s = (Number(seed) >>> 0);
  if (s === 0) s = (AV_MIX_DITHER_SEED >>> 0) || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/* ditherApply(l, r, bits, mode, seed) -> { l, r, mode } with NEW arrays; dither is added in the
   float domain at LSB scale 2^(bits-1) (mirrors the av_wavio TPDF convention: d = r1 - r2 in
   (+-1 LSB) applied BEFORE rounding). tpdf = seeded TPDF; shaped = 2nd-order error feedback
   (quantised at the same LSB scale, error fed back with coefficients (-2, +1)); off / 32f =
   plain copies. Deterministic per seed; never throws (invalid input -> null). */
function avMixDitherApply(l, r, bits, mode, seed) {
  try {
    if (!avMixIsChan(l) || !avMixIsChan(r)) return null;
    const bitsN = avMixNormBits(bits === undefined ? 16 : bits);
    const modeN = avMixNormDitherMode(mode === undefined ? "auto" : mode, bitsN === null ? 32 : bitsN);
    const n = Math.min(l.length, r.length);
    const outL = new Float32Array(n), outR = new Float32Array(n);
    const eff = (bitsN === "32f" || modeN === null) ? "off" : modeN;
    if (eff === "off") {
      for (let i = 0; i < n; i++) { outL[i] = l[i]; outR[i] = r[i]; }
      return { l: outL, r: outR, mode: "off" };
    }
    const S = (bitsN === 24) ? 8388608 : 32768;      /* 2^(bits-1) */
    const rng = avMixRng(seed === undefined ? AV_MIX_DITHER_SEED : seed);
    if (eff === "tpdf") {
      for (let i = 0; i < n; i++) {
        outL[i] = l[i] + (rng() - rng()) / S;
        outR[i] = r[i] + (rng() - rng()) / S;
      }
      return { l: outL, r: outR, mode: "tpdf" };
    }
    /* shaped: w = x*S + (-2*e1 + e2); v = round(w + d); e = w + d - v; out = v/S */
    let e1L = 0, e2L = 0, e1R = 0, e2R = 0;
    for (let i = 0; i < n; i++) {
      const dL = rng() - rng();
      let wL = l[i] * S + (-2 * e1L + e2L);
      let vL = Math.round(wL + dL);
      e2L = e1L; e1L = (wL + dL) - vL;
      outL[i] = vL / S;
      const dR = rng() - rng();
      let wR = r[i] * S + (-2 * e1R + e2R);
      let vR = Math.round(wR + dR);
      e2R = e1R; e1R = (wR + dR) - vR;
      outR[i] = vR / S;
    }
    return { l: outL, r: outR, mode: "shaped" };
  } catch (e) { return null; }
}

/* ---------- track model helpers ---------- */

function avMixAudible(track, anySolo) {
  return (anySolo ? track.solo === 1 : true) && track.mute !== 1;
}

function avMixFind(id) {
  try {
    const s = String(id);
    for (let i = 0; i < avMix.tracks.length; i++) if (avMix.tracks[i].id === s) return avMix.tracks[i];
  } catch (e) { /* never throws */ }
  return null;
}

function avMixSourceCopy(s) {
  if (!s || typeof s !== "object") return null;
  if (s.type === "take" || s.type === "comp") return { type: s.type, id: s.id };
  if (s.type === "engine") return { type: "engine", mask: [s.mask[0], s.mask[1], s.mask[2], s.mask[3]], loops: s.loops, tailS: s.tailS };
  if (s.type === "buffers") return { type: "buffers", sr: s.sr, offsetFrames: s.offsetFrames, frames: (s.l && typeof s.l.length === "number") ? s.l.length : 0 };
  return null;
}

function avMixTrackCopy(t) {
  return {
    id: t.id,
    name: t.name,
    source: avMixSourceCopy(t.source),
    gainDb: t.gainDb,
    pan: t.pan,
    mute: t.mute,
    solo: t.solo,
    sends: { a: t.sends.a, b: t.sends.b },
    duck: { src: t.duck.src, depthDb: t.duck.depthDb },
    fx: {
      drive: { on: t.fx.drive.on, mix: t.fx.drive.mix, mode: t.fx.drive.mode, amount: t.fx.drive.amount, tone: t.fx.drive.tone, bits: t.fx.drive.bits, down: t.fx.drive.down },
      dyn: { on: t.fx.dyn.on, mix: t.fx.dyn.mix, eqLo: t.fx.dyn.eqLo, eqMid: t.fx.dyn.eqMid, eqHi: t.fx.dyn.eqHi, thresh: t.fx.dyn.thresh, ratio: t.fx.dyn.ratio, att: t.fx.dyn.att, rel: t.fx.dyn.rel, makeup: t.fx.dyn.makeup, ceiling: t.fx.dyn.ceiling },
    },
    rendered: t.rendered ? { frames: t.rendered.frames } : null,
  };
}

/* ---------- source normalisation (add / setTrack) ---------- */

function avMixNormSource(raw) {
  try {
    if (raw == null || typeof raw !== "object") return { ok: false, error: "source must be an object" };
    const type = String(raw.type);
    if (type === "take" || type === "comp") {
      if (raw.id == null || raw.id === "") return { ok: false, error: "source.id required" };
      return { ok: true, source: { type: type, id: String(raw.id) } };
    }
    if (type === "engine") {
      let mask = [true, true, true, true];
      if (Array.isArray(raw.mask)) mask = [!!raw.mask[0], !!raw.mask[1], !!raw.mask[2], !!raw.mask[3]];
      const loops = avMixClampNum(raw.loops, 1, 1, 64);
      const tailS = avMixClampNum(raw.tailS, 2, 0, 10);
      return { ok: true, source: { type: "engine", mask: mask, loops: Math.round(loops), tailS: tailS } };
    }
    if (type === "buffers") {
      if (!avMixIsChan(raw.l)) return { ok: false, error: "buffers.l must be a channel array" };
      if (raw.r != null && !avMixIsChan(raw.r)) return { ok: false, error: "buffers.r must be a channel array or absent" };
      let sr = null;
      if (raw.sr != null && raw.sr !== "") {
        const n = avMixFiniteNum(raw.sr);
        if (n === null || !(n > 0)) return { ok: false, error: "buffers.sr must be a positive number" };
        sr = n;
      }
      const offRaw = avMixFiniteNum(raw.offsetFrames);
      const offsetFrames = (offRaw === null || offRaw < 0) ? 0 : Math.round(offRaw);
      return { ok: true, source: { type: "buffers", l: raw.l, r: raw.r != null ? raw.r : null, sr: sr, offsetFrames: offsetFrames } };
    }
    return { ok: false, error: "unknown source type: " + type };
  } catch (e) { return { ok: false, error: avMixErr(e) }; }
}

/* ---------- patch helpers (setTrack / add)---------- */

function avMixApplySends(track, patch, refused) {
  if (patch == null || typeof patch !== "object") { refused.push("sends must be an object"); return false; }
  let changed = false;
  const keys = Object.keys(patch);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key !== "a" && key !== "b") { refused.push("unknown sends key: " + key); continue; }
    const n = avMixFiniteNum(patch[key]);
    if (n === null) { refused.push("sends." + key + " must be finite"); continue; }
    const v = avMixClamp(n, 0, 1);
    if (track.sends[key] !== v) { track.sends[key] = v; changed = true; }
  }
  return changed;
}

function avMixApplyDuck(track, patch, refused) {
  if (patch == null || typeof patch !== "object") { refused.push("duck must be an object"); return false; }
  let changed = false;
  const keys = Object.keys(patch);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key === "src") {
      const v = patch.src;
      if (v == null || v === "") {
        if (track.duck.src !== null) { track.duck.src = null; changed = true; }
      } else if (typeof v === "string" || typeof v === "number") {
        const s = String(v);
        if (track.duck.src !== s) { track.duck.src = s; changed = true; }
      } else refused.push("duck.src must be a track id or null");
    } else if (key === "depthDb") {
      const n = avMixFiniteNum(patch.depthDb);
      if (n === null) refused.push("duck.depthDb must be finite");
      else {
        const v = avMixClamp(n, 0, AV_MIX_DUCK_MAX);
        if (track.duck.depthDb !== v) { track.duck.depthDb = v; changed = true; }
      }
    } else refused.push("unknown duck key: " + key);
  }
  return changed;
}

function avMixApplyFx(fx, patch, refused) {
  if (patch == null || typeof patch !== "object") { refused.push("fx must be an object"); return false; }
  let changed = false;
  const mods = Object.keys(patch);
  for (let m = 0; m < mods.length; m++) {
    const mod = mods[m];
    if (mod !== "drive" && mod !== "dyn") { refused.push("unknown fx module: " + mod); continue; }
    const sub = patch[mod];
    if (sub == null || typeof sub !== "object") { refused.push("fx." + mod + " must be an object"); continue; }
    const defs = AV_MIX_FX_DEF[mod];
    const keys = Object.keys(sub);
    for (let i = 0; i < keys.length; i++) {
      const rawKey = keys[i];
      let key = rawKey;
      if (mod === "dyn" && avMixHasOwn(AV_MIX_FX_ALIAS, rawKey)) key = AV_MIX_FX_ALIAS[rawKey];
      if (!avMixHasOwn(defs, key)) { refused.push("unknown fx." + mod + " param: " + rawKey); continue; }
      const acc = avMixAcceptDef(defs[key], sub[rawKey]);
      if (!acc.ok) { refused.push("fx." + mod + "." + rawKey + ": " + acc.error); continue; }
      if (fx[mod][key] !== acc.v) { fx[mod][key] = acc.v; changed = true; }
    }
  }
  return changed;
}

/* ---------- guarded sibling reaches (READ-ONLY) ---------- */

function avMixTakesStore() {
  try {
    if (typeof avTakes === "undefined" || !avTakes) return null;
    const arr = avTakes.takes;
    return Array.isArray(arr) ? arr : null;
  } catch (e) { return null; }
}

function avMixTakeEntry(id) {
  try {
    const store = avMixTakesStore();
    if (!store) return null;
    const s = String(id);
    for (let i = 0; i < store.length; i++) if (String(store[i].id) === s) return store[i];
  } catch (e) { /* never throws */ }
  return null;
}

function avMixCompStore() {
  try {
    if (typeof avComp === "undefined" || !avComp) return null;
    const arr = avComp.comps;
    return Array.isArray(arr) ? arr : null;
  } catch (e) { return null; }
}

/* ---------- source resolution (sync except engine) ---------- */

/* take -> { ok, chans, off, frames, rate } : latency comp = advance by take.offsetFrames
   (drop the leading offsetFrames frames, clamped 0..frames). */
function avMixResolveTake(id) {
  try {
    const t = avMixTakeEntry(id);
    if (!t) return { ok: false, error: "take not found: " + String(id) };
    const d = t.data;
    if (!d || typeof d.length !== "number" || !(d.length >= 1)) return { ok: false, error: "take has no data: " + String(id) };
    const chans = [];
    for (let c = 0; c < d.length && c < 8; c++) {
      if (!avMixIsChan(d[c])) return { ok: false, error: "take channel unreadable: " + String(id) };
      chans.push(d[c]);
    }
    if (!chans.length) return { ok: false, error: "take has no readable channels: " + String(id) };
    let dataLen = chans[0].length;
    for (let c = 1; c < chans.length; c++) if (chans[c].length < dataLen) dataLen = chans[c].length;
    let frames = Math.round(Number(t.frames));
    if (!isFinite(frames) || frames < 0) frames = dataLen;
    if (frames > dataLen) frames = dataLen;
    if (!(frames > 0)) return { ok: false, error: "take is empty: " + String(id) };
    let rate = Number(t.rate);
    if (!isFinite(rate) || !(rate > 0)) rate = AV_MIX_SR_DEF;
    const off = avMixClamp(Math.round(avMixClampNum(t.offsetFrames, 0, 0, frames)), 0, frames);
    return { ok: true, chans: chans, off: off, frames: frames - off, rate: rate };
  } catch (e) { return { ok: false, error: avMixErr(e) }; }
}

/* comp -> avCompRender(id) (guarded) + the store's rendered.data (receipt carries none) */
function avMixResolveComp(id) {
  try {
    if (typeof avCompRender !== "function") return { ok: false, error: "avCompRender unavailable" };
    let r = null;
    try { r = avCompRender(id); } catch (e) { return { ok: false, error: "comp render threw: " + avMixErr(e) }; }
    if (!r || r.ok !== true) return { ok: false, error: "comp render refused: " + String((r && r.error) || "unknown") };
    let data = (r.data != null && typeof r.data.length === "number") ? r.data : null;
    let rate = avMixFiniteNum(r.rate);
    let frames = avMixFiniteNum(r.frames);
    if (!data) {
      const store = avMixCompStore();
      if (store) {
        const s = String(id);
        for (let i = 0; i < store.length; i++) {
          if (String(store[i].id) !== s) continue;
          const rend = store[i].rendered;
          if (rend && rend.data != null && typeof rend.data.length === "number") {
            data = rend.data;
            if (rate === null || !(rate > 0)) rate = avMixFiniteNum(rend.rate);
            if (frames === null) frames = avMixFiniteNum(rend.frames);
          }
          break;
        }
      }
    }
    if (!data || !(data.length >= 1)) return { ok: false, error: "comp render data unavailable: " + String(id) };
    const chans = [];
    for (let c = 0; c < data.length && c < 8; c++) {
      if (!avMixIsChan(data[c])) return { ok: false, error: "comp channel unreadable: " + String(id) };
      chans.push(data[c]);
    }
    if (!chans.length) return { ok: false, error: "comp has no readable channels: " + String(id) };
    let dataLen = chans[0].length;
    for (let c = 1; c < chans.length; c++) if (chans[c].length < dataLen) dataLen = chans[c].length;
    if (frames === null || !(frames > 0) || frames > dataLen) frames = dataLen;
    if (rate === null || !(rate > 0)) rate = AV_MIX_SR_DEF;
    return { ok: true, chans: chans, off: 0, frames: frames, rate: rate };   /* comp latency comp = 0 */
  } catch (e) { return { ok: false, error: avMixErr(e) }; }
}

function avMixResolveBuffers(source) {
  try {
    const l = source.l;
    if (!avMixIsChan(l)) return { ok: false, error: "buffers.l unreadable" };
    const chans = [l];
    if (source.r != null) {
      if (!avMixIsChan(source.r)) return { ok: false, error: "buffers.r unreadable" };
      chans.push(source.r);
    }
    let frames = chans[0].length;
    for (let c = 1; c < chans.length; c++) if (chans[c].length < frames) frames = chans[c].length;
    if (!(frames > 0)) return { ok: false, error: "buffers are empty" };
    let rate = avMixFiniteNum(source.sr);
    const assumed = !(rate !== null && rate > 0);
    if (assumed) rate = AV_MIX_SR_DEF;
    const off = avMixClamp(Math.round(avMixClampNum(source.offsetFrames, 0, 0, frames)), 0, frames);
    return { ok: true, chans: chans, off: off, frames: frames - off, rate: rate, assumedRate: assumed };
  } catch (e) { return { ok: false, error: avMixErr(e) }; }
}

/* engine -> avBounce (guarded, async); includeParts:false, includeMaster:true */
function avMixResolveEngine(source, sr, tid, warnings, refused, cache) {
  try {
    if (typeof avBounce !== "function") {
      return { ok: false, error: "avBounce unavailable (engine source needs the browser renderer)" };
    }
    const key = source;
    if (cache && cache.has(key)) return cache.get(key);
    const promise = (async function () {
      try {
        const res = await avBounce({
          loops: source.loops, tailS: source.tailS, trackMask: source.mask,
          includeParts: false, includeMaster: true, sr: sr,
        });
        avMixMergeList(warnings, res && res.warnings, "engine " + tid + ": ");
        avMixMergeList(refused, res && res.refused, "engine " + tid + ": ");
        if (!res || res.ok !== true) return { ok: false, error: "bounce refused: " + String((res && res.error) || "unknown") };
        const m = res.master;
        if (!m || !avMixIsChan(m.l) || !avMixIsChan(m.r)) return { ok: false, error: "bounce master missing" };
        let frames = Math.round(Number(res.frames));
        if (!isFinite(frames) || frames < 0) frames = Math.min(m.l.length, m.r.length);
        frames = Math.min(frames, m.l.length, m.r.length);
        if (!(frames > 0)) return { ok: false, error: "bounce rendered no frames" };
        let rate = avMixFiniteNum(res.sr);
        if (rate === null || !(rate > 0)) rate = sr;
        return { ok: true, chans: [m.l, m.r], off: 0, frames: frames, rate: rate };
      } catch (e) { return { ok: false, error: "bounce threw: " + avMixErr(e) }; }
    })();
    if (cache) cache.set(key, promise);
    return promise;
  } catch (e) { return { ok: false, error: avMixErr(e) }; }
}

/* source -> { ok, chans, off, frames, rate } | Promise<...> (engine only) */
function avMixResolveSource(source, sr, tid, warnings, refused, engineCache) {
  try {
    if (!source || typeof source !== "object") return { ok: false, error: "source missing" };
    if (source.type === "take") return avMixResolveTake(source.id);
    if (source.type === "comp") return avMixResolveComp(source.id);
    if (source.type === "buffers") return avMixResolveBuffers(source);
    if (source.type === "engine") return avMixResolveEngine(source, sr, tid, warnings, refused, engineCache);
    return { ok: false, error: "unknown source type: " + String(source.type) };
  } catch (e) { return { ok: false, error: avMixErr(e) }; }
}

/* ---------- resample (linear, v1) + prep cache ---------- */

function avMixSrcLenAt(sr, r) {
  if (r.rate === sr) return r.frames;
  if (!(r.frames > 0)) return 0;
  return Math.max(1, Math.ceil(r.frames * sr / r.rate));
}

function avMixResample(chans, off, frames, fromRate, toRate) {
  const ratio = fromRate / toRate;
  const outN = (frames > 0) ? Math.max(1, Math.ceil(frames / ratio)) : 0;
  const out = [];
  for (let c = 0; c < chans.length; c++) {
    const src = chans[c];
    const dst = new Float32Array(outN);
    for (let j = 0; j < outN; j++) {
      let pos = j * ratio;
      if (pos > frames - 1) pos = frames - 1;
      const i0 = Math.floor(pos);
      const f = pos - i0;
      const i1 = (i0 + 1 < frames) ? i0 + 1 : i0;
      const a = src[off + i0];
      const b = src[off + i1];
      dst[j] = a + (b - a) * f;
    }
    out.push(dst);
  }
  return { chans: out, frames: outN };
}

/* entry = { tr, r }; caches the render-rate form on the entry (resample once per render) */
function avMixPrepEntry(entry, sr, warnings) {
  if (entry.prep) return entry.prep;
  const r = entry.r;
  let prep;
  if (r.rate === sr) prep = { chans: r.chans, off: r.off, n: r.frames };
  else {
    const rs = avMixResample(r.chans, r.off, r.frames, r.rate, sr);
    prep = { chans: rs.chans, off: 0, n: rs.frames };
    warnings.push("track " + entry.tr.id + ": source resampled (linear) " + r.rate + " -> " + sr + " Hz");
  }
  entry.prep = prep;
  return prep;
}

/* ---------- FX module states (fresh per render; disabled states never created) ---------- */

function avMixFxModule(mod) {
  try {
    if (mod === "verb") return (typeof AVFXVERB !== "undefined" && AVFXVERB && typeof AVFXVERB.createState === "function") ? AVFXVERB : null;
    if (mod === "delay") return (typeof AVFXDELAY !== "undefined" && AVFXDELAY && typeof AVFXDELAY.createState === "function") ? AVFXDELAY : null;
    if (mod === "drive") return (typeof AVFXDRIVE !== "undefined" && AVFXDRIVE && typeof AVFXDRIVE.createState === "function") ? AVFXDRIVE : null;
    if (mod === "dyn") return (typeof AVFXDYN !== "undefined" && AVFXDYN && typeof AVFXDYN.createState === "function") ? AVFXDYN : null;
  } catch (e) { /* never throws */ }
  return null;
}

/* fresh state + bindEngine({sr}) + setParam rows; returns { M, st } or null (warned). The
   per-sample call is M.process(st, xL, xR) -- the state is NOT the module. */
function avMixMakeState(mod, sr, rows, warnings, what) {
  const M = avMixFxModule(mod);
  if (!M) { warnings.push(what + " skipped (" + mod.toUpperCase() + " module unavailable)"); return null; }
  try {
    const st = M.createState();
    try { M.bindEngine(st, { sr: sr }); } catch (e) { /* engine hook is best-effort */ }
    for (let i = 0; i < rows.length; i++) {
      try { M.setParam(st, rows[i][0], rows[i][1]); } catch (e2) { /* pre-validated; never throws */ }
    }
    return { M: M, st: st };
  } catch (e) { warnings.push(what + " skipped (" + mod + " state creation failed)"); return null; }
}

function avMixFxModulePath(mod, key) {
  if (mod === "drive") return "fx.drive." + key;
  if (key === "thresh") return "fx.dyn.comp.thresh";
  if (key === "ratio") return "fx.dyn.comp.ratio";
  if (key === "att") return "fx.dyn.comp.att";
  if (key === "rel") return "fx.dyn.comp.rel";
  if (key === "makeup") return "fx.dyn.comp.makeup";
  if (key === "ceiling") return "fx.dyn.lim.ceiling";
  return "fx.dyn." + key;
}

function avMixTrackFxState(mod, fx, sr, tid, warnings) {
  const defs = AV_MIX_FX_DEF[mod];
  const keys = Object.keys(defs);
  const rows = [];
  for (let i = 0; i < keys.length; i++) rows.push([avMixFxModulePath(mod, keys[i]), fx[keys[i]]]);
  return avMixMakeState(mod, sr, rows, warnings, "track " + tid + " " + mod + " fx");
}

/* ---------- render ---------- */

function avMixRenderSumm(rec) {
  try {
    if (!rec) return null;
    return {
      ok: rec.ok === true,
      error: rec.error !== undefined ? rec.error : undefined,
      frames: rec.frames, rate: rec.rate,
      lufs: rec.lufs !== undefined ? rec.lufs : null,
      dbtp: rec.dbtp !== undefined ? rec.dbtp : null,
      peak: rec.peak !== undefined ? rec.peak : null,
      rms: rec.rms !== undefined ? rec.rms : null,
      clipped: rec.clipped !== undefined ? rec.clipped : null,
      norm: rec.norm !== undefined ? rec.norm : null,
      warnings: Array.isArray(rec.warnings) ? rec.warnings.slice() : [],
      refused: Array.isArray(rec.refused) ? rec.refused.slice() : [],
      ms: rec.ms, at: rec.at, rev: rec.rev,
    };
  } catch (e) { return null; }
}

function avMixRender(opts) {
  return new Promise(function (resolve) {
    (async function () {
      const warnings = [];
      const refused = [];
      const t0 = avMixNow();
      const fail = function (error, extra) {
        const rec = { ok: false, error: String(error || "render failed"), warnings: warnings, refused: refused, ms: Math.round(avMixNow() - t0), at: Math.round(avMixNow()), rev: avMix.rev };
        if (extra) for (const k in extra) rec[k] = extra[k];
        avMix.lastError = rec.error;
        resolve(rec);
      };
      try {
        avMixEnsure();
        const o = (opts && typeof opts === "object") ? opts : {};
        let sr = AV_MIX_SR_DEF;
        const srN = avMixFiniteNum(o.sr);
        if (srN !== null && AV_MIX_SRS.indexOf(Math.round(srN)) >= 0) sr = Math.round(srN);
        const tailS = avMixClampNum(o.tailS, AV_MIX_TAIL_DEF, 0, AV_MIX_TAIL_MAX);
        const progress = (typeof o.progress === "function") ? o.progress : null;
        const report = function (frac) {
          if (!progress) return;
          try { progress(frac); } catch (e) { /* best-effort */ }
        };

        /* 1. resolve every track's source (engine sources bounce here, async) */
        const engineCache = new Map();
        const entries = [];
        for (let i = 0; i < avMix.tracks.length; i++) {
          const tr = avMix.tracks[i];
          let r = avMixResolveSource(tr.source, sr, tr.id, warnings, refused, engineCache);
          if (r && typeof r.then === "function") r = await r;
          entries.push({ tr: tr, r: r });
          if (!r.ok) {
            refused.push("track " + tr.id + ": " + r.error);
            warnings.push("track " + tr.id + " skipped (source unavailable)");
            tr.rendered = null;
          }
        }

        /* 2. length law: max(trackEnd) + tailS*sr, floor 0.25 s, cap 300 s (refuse above) */
        let trackEnd = 0;
        for (let i = 0; i < entries.length; i++) {
          if (!entries[i].r.ok) continue;
          const e = Math.max(0, avMixSrcLenAt(sr, entries[i].r));
          if (e > trackEnd) trackEnd = e;
        }
        let frames;
        const secOpt = avMixFiniteNum(o.seconds);
        if (secOpt !== null && secOpt > 0) frames = Math.max(1, Math.round(secOpt * sr));
        else frames = Math.max(Math.ceil(trackEnd + tailS * sr), Math.ceil(AV_MIX_FLOOR_S * sr));
        if (frames > AV_MIX_MAX_SECONDS * sr) {
          fail("render length " + (frames / sr).toFixed(2) + " s exceeds the " + AV_MIX_MAX_SECONDS + " s cap");
          return;
        }

        /* 3. fresh output arrays + chain build */
        const mainL = new Float32Array(frames), mainR = new Float32Array(frames);
        const aL = new Float32Array(frames), aR = new Float32Array(frames);
        const bL = new Float32Array(frames), bR = new Float32Array(frames);
        const P = avMix.params;
        let anySolo = false;
        for (let i = 0; i < avMix.tracks.length; i++) if (avMix.tracks[i].solo === 1) { anySolo = true; break; }

        const jobs = [];
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const tr = entry.tr;
          if (!entry.r.ok) continue;
          if (!avMixAudible(tr, anySolo)) { tr.rendered = null; continue; }
          const prep = avMixPrepEntry(entry, sr, warnings);
          const fader = avMixFaderGain(tr.gainDb);
          const bg = avMixBalanceGains(tr.pan);
          const job = {
            tr: tr, chans: prep.chans, off: prep.off, n: prep.n,
            fader: fader, gL: bg.l, gR: bg.r,
            sendA: tr.sends.a, sendB: tr.sends.b,
            drive: null, driveMix: 1, dyn: null, dynMix: 1,
            env: null, envLen: 0, duckFader: 1, depth: 0,
          };
          if (tr.fx.drive.on === 1) { job.drive = avMixTrackFxState("drive", tr.fx.drive, sr, tr.id, warnings); job.driveMix = tr.fx.drive.mix; }
          if (tr.fx.dyn.on === 1) { job.dyn = avMixTrackFxState("dyn", tr.fx.dyn, sr, tr.id, warnings); job.dynMix = tr.fx.dyn.mix; }
          /* duck: envelope of the duck.src track (compensated source x ITS fader, pre-FX) */
          if (tr.duck && tr.duck.src) {
            if (String(tr.duck.src) === String(tr.id)) {
              refused.push("track " + tr.id + ": duck source is itself (self-duck refused)");
              warnings.push("track " + tr.id + " self-duck refused");
            } else {
              let srcEntry = null;
              for (let k = 0; k < entries.length; k++) if (entries[k].tr.id === String(tr.duck.src)) { srcEntry = entries[k]; break; }
              if (!srcEntry || !srcEntry.r.ok) {
                refused.push("track " + tr.id + ": duck source " + tr.duck.src + " unavailable (duck skipped)");
                warnings.push("track " + tr.id + " duck skipped (source unavailable)");
              } else {
                try {
                  const sp = avMixPrepEntry(srcEntry, sr, warnings);
                  const envLen = Math.min(frames, sp.n + Math.ceil(0.5 * sr));
                  job.env = avMixEnvArr(sp.chans, sp.off, sp.n, sr, envLen);
                  job.envLen = envLen;
                  job.duckFader = avMixFaderGain(srcEntry.tr.gainDb);
                  job.depth = tr.duck.depthDb;
                } catch (e) {
                  refused.push("track " + tr.id + ": duck envelope failed (" + avMixErr(e) + ")");
                }
              }
            }
          }
          jobs.push(job);
          tr.rendered = { frames: prep.n };
        }

        /* 4. chunked per-track pass + chained stages (fresh states per stage) */
        const chunks = Math.max(1, Math.ceil(frames / AV_MIX_CHUNK_FRAMES));
        const anySendA = jobs.some(function (j) { return j.sendA > 0; });
        const anySendB = jobs.some(function (j) { return j.sendB > 0; });
        const glueOn = P["glue.on"] === 1;
        const driveOn = P["master.drive.on"] === 1;
        const dynOn = P["master.dyn.on"] === 1;
        const masterOn = driveOn || dynOn;
        let progDone = 0;
        const progTotal = Math.max(1, chunks * (1 + (anySendA ? 1 : 0) + (anySendB ? 1 : 0) + (glueOn ? 1 : 0) + (masterOn ? 1 : 0)));
        const chunkDone = function () { progDone++; report(progDone / progTotal); };

        for (let c = 0; c < chunks; c++) {
          const from = c * AV_MIX_CHUNK_FRAMES;
          const to = Math.min(frames, from + AV_MIX_CHUNK_FRAMES);
          for (let j = 0; j < jobs.length; j++) {
            const job = jobs[j];
            const L = job.chans[0];
            const R = (job.chans.length > 1) ? job.chans[1] : job.chans[0];
            const off = job.off, n = job.n, fader = job.fader;
            const gL = job.gL, gR = job.gR, sA = job.sendA, sB = job.sendB;
            const dFx = job.drive, dMix = job.driveMix;
            const yFx = job.dyn, yMix = job.dynMix;
            const env = job.env, envLen = job.envLen, duckF = job.duckFader, depth = job.depth;
            const nEnd = Math.min(to, n);
            const invD = 1 - dMix, invY = 1 - yMix;
            for (let i = from; i < nEnd; i++) {
              const src = i + off;
              let xL = L[src] * fader;
              let xR = R[src] * fader;
              if (dFx) {
                dFx.M.process(dFx.st, xL, xR);
                xL = xL * invD + dFx.st.oL * dMix;
                xR = xR * invD + dFx.st.oR * dMix;
              }
              if (yFx) {
                yFx.M.process(yFx.st, xL, xR);
                xL = xL * invY + yFx.st.oL * yMix;
                xR = xR * invY + yFx.st.oR * yMix;
              }
              if (env) {
                let e01 = duckF * env[i < envLen ? i : (envLen - 1)] / AV_MIX_DUCK_KNEE;
                if (e01 > 1) e01 = 1; else if (e01 < 0) e01 = 0;
                if (depth > 0) {
                  const dg = Math.pow(10, -(depth * e01) / 20);
                  xL *= dg; xR *= dg;
                }
              }
              xL *= gL; xR *= gR;
              mainL[i] += xL; mainR[i] += xR;
              if (sA > 0) { aL[i] += sA * xL; aR[i] += sA * xR; }
              if (sB > 0) { bL[i] += sB * xL; bR[i] += sB * xR; }
            }
          }
          chunkDone();
          await null;
        }

        /* 4a. send A -> AVFXVERB wet-only (on:1, mix:1); output x return -> main */
        if (anySendA) {
          const vb = avMixMakeState("verb", sr, [
            ["fx.verb.mode", P["send.A.verb.mode"]],
            ["fx.verb.size", P["send.A.verb.size"]],
            ["fx.verb.decay", P["send.A.verb.decay"]],
            ["fx.verb.damp", P["send.A.verb.damp"]],
            ["fx.verb.predelay", P["send.A.verb.predelay"]],
            ["fx.verb.on", 1],
            ["fx.verb.mix", 1],
          ], warnings, "send A bus");
          if (vb) {
            const rGain = P["send.A.return"];
            for (let c = 0; c < chunks; c++) {
              const from = c * AV_MIX_CHUNK_FRAMES;
              const to = Math.min(frames, from + AV_MIX_CHUNK_FRAMES);
              for (let i = from; i < to; i++) {
                vb.M.process(vb.st, aL[i], aR[i]);
                mainL[i] += vb.st.oL * rGain;
                mainR[i] += vb.st.oR * rGain;
              }
              chunkDone();
              await null;
            }
          }
        }

        /* 4b. send B -> AVFXDELAY on:1, mix:1 (module-final = pure delayed signal; copy) */
        if (anySendB) {
          const dlb = avMixMakeState("delay", sr, [
            ["fx.delay.time", P["send.B.delay.time"]],
            ["fx.delay.spread", P["send.B.delay.spread"]],
            ["fx.delay.feedback", P["send.B.delay.feedback"]],
            ["fx.delay.pingpong", P["send.B.delay.pingpong"]],
            ["fx.delay.duck", P["send.B.delay.duck"]],
            ["fx.delay.div", P["send.B.delay.div"]],
            ["fx.delay.bpm", P["send.B.delay.bpm"]],
            ["fx.delay.on", 1],
            ["fx.delay.mix", 1],
          ], warnings, "send B bus");
          if (dlb) {
            const rGain = P["send.B.return"];
            for (let c = 0; c < chunks; c++) {
              const from = c * AV_MIX_CHUNK_FRAMES;
              const to = Math.min(frames, from + AV_MIX_CHUNK_FRAMES);
              for (let i = from; i < to; i++) {
                dlb.M.process(dlb.st, bL[i], bR[i]);
                mainL[i] += dlb.st.oL * rGain;
                mainR[i] += dlb.st.oR * rGain;
              }
              chunkDone();
              await null;
            }
          }
        }

        /* 4c. bus glue (main bus -> AVFXDYN; off = skipped; fully wet = the bus comp IS the bus) */
        if (glueOn) {
          const glb = avMixMakeState("dyn", sr, [
            ["fx.dyn.on", 1],
            ["fx.dyn.eqLo", 0], ["fx.dyn.eqMid", 0], ["fx.dyn.eqHi", 0],
            ["fx.dyn.comp.thresh", P["glue.thresh"]],
            ["fx.dyn.comp.ratio", P["glue.ratio"]],
            ["fx.dyn.comp.att", P["glue.att"]],
            ["fx.dyn.comp.rel", P["glue.rel"]],
            ["fx.dyn.comp.makeup", P["glue.makeup"]],
            ["fx.dyn.mix", 1],
          ], warnings, "glue");
          if (glb) {
            for (let c = 0; c < chunks; c++) {
              const from = c * AV_MIX_CHUNK_FRAMES;
              const to = Math.min(frames, from + AV_MIX_CHUNK_FRAMES);
              for (let i = from; i < to; i++) {
                glb.M.process(glb.st, mainL[i], mainR[i]);
                mainL[i] = glb.st.oL;
                mainR[i] = glb.st.oR;
              }
              chunkDone();
              await null;
            }
          }
        }

        /* 4d. master chain: drive (wet-only; no mix pin) -> dyn (blend by master.dyn.mix) */
        if (masterOn) {
          const drv = driveOn ? avMixMakeState("drive", sr, [
            ["fx.drive.on", 1],
            ["fx.drive.mode", P["master.drive.mode"]],
            ["fx.drive.amount", P["master.drive.amount"]],
            ["fx.drive.tone", P["master.drive.tone"]],
            ["fx.drive.mix", 1],
          ], warnings, "master drive") : null;
          const mdy = dynOn ? avMixMakeState("dyn", sr, [
            ["fx.dyn.on", 1],
            ["fx.dyn.eqLo", P["master.dyn.eqLo"]],
            ["fx.dyn.eqMid", P["master.dyn.eqMid"]],
            ["fx.dyn.eqHi", P["master.dyn.eqHi"]],
            ["fx.dyn.comp.thresh", P["master.dyn.comp.thresh"]],
            ["fx.dyn.comp.ratio", P["master.dyn.comp.ratio"]],
            ["fx.dyn.comp.att", P["master.dyn.comp.att"]],
            ["fx.dyn.comp.rel", P["master.dyn.comp.rel"]],
            ["fx.dyn.comp.makeup", P["master.dyn.comp.makeup"]],
            ["fx.dyn.lim.ceiling", P["master.dyn.lim.ceiling"]],
            ["fx.dyn.mix", P["master.dyn.mix"]],
          ], warnings, "master dyn") : null;
          if (drv || mdy) {
            const mMix = P["master.dyn.mix"], invM = 1 - mMix;
            for (let c = 0; c < chunks; c++) {
              const from = c * AV_MIX_CHUNK_FRAMES;
              const to = Math.min(frames, from + AV_MIX_CHUNK_FRAMES);
              for (let i = from; i < to; i++) {
                let xL = mainL[i], xR = mainR[i];
                if (drv) { drv.M.process(drv.st, xL, xR); xL = drv.st.oL; xR = drv.st.oR; }
                if (mdy) {
                  mdy.M.process(mdy.st, xL, xR);
                  xL = xL * invM + mdy.st.oL * mMix;
                  xR = xR * invM + mdy.st.oR * mMix;
                }
                mainL[i] = xL; mainR[i] = xR;
              }
              chunkDone();
              await null;
            }
          }
        }

        /* 5. normalize (post-chain): gainDb = min(target - lufs, ceiling - dbtp) via av_loud */
        let norm = null;
        if (P["master.norm.on"] === 1) {
          const target = P["master.norm.target"], ceiling = P["master.norm.ceiling"];
          norm = { on: true, target: target, ceiling: ceiling, gainDb: 0, limited: false };
          if (typeof avLoudLufs !== "function" || typeof avLoudTruePeak !== "function") {
            norm.skipped = true; norm.reason = "av_loud unavailable";
            warnings.push("normalize skipped (av_loud unavailable)");
          } else {
            let mLufs = null, mTp = null;
            try { const r = avLoudLufs(mainL, mainR, sr); if (r && r.ok === true && r.lufs !== null && isFinite(r.lufs)) mLufs = r.lufs; } catch (e) { /* skipped */ }
            try { const r = avLoudTruePeak(mainL, mainR, sr); if (r && r.ok === true && r.dbtp !== null && isFinite(r.dbtp)) mTp = r.dbtp; } catch (e2) { /* skipped */ }
            if (mLufs === null || mTp === null) {
              norm.skipped = true; norm.reason = "unmeasurable loudness (silent mix)";
              warnings.push("normalize skipped (loudness unmeasurable)");
            } else {
              const gLoud = target - mLufs, gCeil = ceiling - mTp;
              norm.gainDb = Math.min(gLoud, gCeil);
              norm.limited = gCeil < gLoud;
              if (norm.gainDb !== 0) {
                const lin = Math.pow(10, norm.gainDb / 20);
                for (let i = 0; i < frames; i++) { mainL[i] *= lin; mainR[i] *= lin; }
              }
            }
          }
        }

        /* 6. measure the FINAL output (peak/rms/clipped native; lufs/dbtp via av_loud guarded) */
        let peak = 0, sumSq = 0, clipped = 0;
        for (let i = 0; i < frames; i++) {
          const aLv = Math.abs(mainL[i]); if (aLv > peak) peak = aLv;
          const aRv = Math.abs(mainR[i]); if (aRv > peak) peak = aRv;
          if (aLv > 1) clipped++;
          if (aRv > 1) clipped++;
          sumSq += mainL[i] * mainL[i] + mainR[i] * mainR[i];
        }
        const rms = (frames > 0) ? Math.sqrt(sumSq / (frames * 2)) : 0;
        let lufs = null, dbtp = null;
        if (typeof avLoudLufs === "function") {
          try { const r = avLoudLufs(mainL, mainR, sr); if (r && r.ok === true && r.lufs !== null && isFinite(r.lufs)) lufs = r.lufs; } catch (e) { /* null */ }
        }
        if (typeof avLoudTruePeak === "function") {
          try { const r = avLoudTruePeak(mainL, mainR, sr); if (r && r.ok === true && r.dbtp !== null && isFinite(r.dbtp)) dbtp = r.dbtp; } catch (e2) { /* null */ }
        }

        report(1);
        const rec = {
          ok: true, frames: frames, rate: sr, l: mainL, r: mainR,
          lufs: lufs, dbtp: dbtp, peak: peak, rms: rms, clipped: clipped,
          norm: norm, warnings: warnings, refused: refused,
          ms: Math.round(avMixNow() - t0), at: Math.round(avMixNow()), rev: avMix.rev,
        };
        avMix.lastRender = rec;
        avMix.lastRenderSum = avMixRenderSumm(rec);
        avMix.lastError = null;
        resolve(rec);
      } catch (e) { fail(avMixErr(e)); }
    })();
  });
}

/* ---------- export ---------- */

function avMixExportRefuse(msg) {
  const rec = { ok: false, error: msg, name: null, bytes: 0, blob: null, url: null, wavInfo: null, bits: null, dither: null, frames: 0 };
  avMix.lastError = msg;
  return rec;
}

function avMixExport(opts) {
  return new Promise(function (resolve) {
    try {
      avMixEnsure();
      const o = (opts && typeof opts === "object") ? opts : {};
      const lr = avMix.lastRender;
      if (!lr || lr.ok !== true) { resolve(avMixExportRefuse("no render — render the mixdown first")); return; }
      if (lr.rev !== avMix.rev) { resolve(avMixExportRefuse("render stale — the mix changed since the last render; render the mixdown again")); return; }
      const bits = avMixNormBits(o.bits === undefined ? 24 : o.bits);
      if (bits === null) { resolve(avMixExportRefuse("bits must be 16, 24 or \"32f\"")); return; }
      const mode = avMixNormDitherMode(o.dither === undefined ? "auto" : o.dither, bits);
      if (mode === null) { resolve(avMixExportRefuse("dither must be auto | off | tpdf | shaped")); return; }
      const seed = (o.seed === undefined || o.seed === null) ? AV_MIX_DITHER_SEED : (Number(o.seed) >>> 0);
      const d = avMixDitherApply(lr.l, lr.r, bits, mode, seed);
      if (!d) { resolve(avMixExportRefuse("dither failed (bad buffers)")); return; }
      let buf = null;
      if (typeof avWavEncode === "function") {
        try { buf = avWavEncode({ l: d.l, r: d.r, sr: lr.rate, bits: bits, dither: false }); } catch (e) { buf = null; }
      }
      if (!buf) { resolve(avMixExportRefuse("avWavEncode unavailable or refused")); return; }
      const applied = (bits !== "32f") && d.mode !== "off";
      let blob = null, url = null, wavInfo = null;
      try { if (typeof Blob === "function") blob = new Blob([buf], { type: "audio/wav" }); } catch (e2) { blob = null; }
      try { if (blob && typeof URL !== "undefined" && URL && typeof URL.createObjectURL === "function") url = URL.createObjectURL(blob); } catch (e3) { url = null; }
      if (typeof avWavInfo === "function") { try { wavInfo = avWavInfo(buf); } catch (e4) { wavInfo = null; } }
      const name = (typeof o.name === "string" && o.name.trim()) ? o.name.trim().slice(0, 120) : AV_MIX_DEFAULT_NAME;
      const rec = {
        ok: true, name: name, bytes: buf.byteLength, blob: blob, url: url, wavInfo: wavInfo,
        bits: bits, dither: { mode: d.mode, seed: seed, applied: applied }, frames: d.l.length,
      };
      avMix.lastExport = { ok: true, name: name, bytes: rec.bytes, bits: bits, dither: rec.dither, frames: rec.frames, at: Math.round(avMixNow()) };
      avMix.lastError = null;
      resolve(rec);
    } catch (e) { resolve(avMixExportRefuse(avMixErr(e))); }
  });
}

/* ---------- public surface ---------- */

function avMixInit() {
  try {
    if (avMix.inited) return true;
    avMix.params = avMixDefaults();
    avMix.tracks = [];
    avMix.ref = null;
    avMix.rev = 0;
    avMix.seq = 1;
    avMix.lastRender = null;
    avMix.lastRenderSum = null;
    avMix.lastExport = null;
    avMix.lastError = null;
    avMix.inited = true;
    return true;
  } catch (e) {
    avMix.lastError = avMixErr(e);
    return false;
  }
}

function avMixEnsure() { if (!avMix.inited) avMixInit(); }

function avMixState() {
  try {
    avMixEnsure();
    const tracks = [];
    for (let i = 0; i < avMix.tracks.length; i++) tracks.push(avMixTrackCopy(avMix.tracks[i]));
    return {
      count: avMix.tracks.length,
      rev: avMix.rev,
      tracks: tracks,
      params: avMixParams(),
      ref: avMix.ref ? { kind: avMix.ref.kind, seconds: avMix.ref.seconds } : null,
      lastRender: avMix.lastRenderSum,
      lastExport: avMix.lastExport,
      lastError: avMix.lastError,
    };
  } catch (e) {
    return { count: 0, rev: avMix.rev, tracks: [], params: {}, ref: null, lastRender: null, lastExport: null, lastError: avMixErr(e) };
  }
}

function avMixList() {
  try {
    avMixEnsure();
    const out = [];
    for (let i = 0; i < avMix.tracks.length; i++) out.push(avMixTrackCopy(avMix.tracks[i]));
    return out;
  } catch (e) { return []; }
}

const AV_MIX_ADD_KEYS = { name: 1, source: 1, gainDb: 1, pan: 1, mute: 1, solo: 1, sends: 1, duck: 1, fx: 1 };

function avMixAddTrack(opts) {
  try {
    avMixEnsure();
    const o = (opts && typeof opts === "object") ? opts : null;
    if (!o) return { ok: false, error: "opts required", refused: ["opts required"] };
    const refused = [];
    const okKeys = Object.keys(o);
    for (let k = 0; k < okKeys.length; k++) if (!avMixHasOwn(AV_MIX_ADD_KEYS, okKeys[k])) refused.push("unknown key: " + okKeys[k]);
    if (o.name != null && typeof o.name !== "string") refused.push("name must be a string");
    const ns = avMixNormSource(o.source);
    if (!ns.ok) refused.push(ns.error);
    if (refused.length) return { ok: false, error: "invalid track options", refused: refused };

    const seq = avMix.seq;
    const track = {
      id: "m" + seq,
      name: avMixStr(o.name, "Track " + seq, 64),
      source: ns.source,
      gainDb: avMixClampNum(o.gainDb, 0, AV_MIX_GAIN_MIN, AV_MIX_GAIN_MAX),
      pan: avMixClampNum(o.pan, 0, -1, 1),
      mute: avMixOnOff(o.mute),
      solo: avMixOnOff(o.solo),
      sends: { a: 0, b: 0 },
      duck: { src: null, depthDb: 0 },
      fx: avMixFxDefaults(),
      rendered: null,
    };
    if (o.sends != null) avMixApplySends(track, o.sends, refused);
    if (o.duck != null) avMixApplyDuck(track, o.duck, refused);
    if (o.fx != null) avMixApplyFx(track.fx, o.fx, refused);
    if (refused.length) return { ok: false, error: "invalid track options", refused: refused };

    avMix.seq = seq + 1;
    avMix.tracks.push(track);
    avMix.rev++;
    avMix.lastError = null;
    return { ok: true, track: avMixTrackCopy(track) };
  } catch (e) {
    avMix.lastError = avMixErr(e);
    return { ok: false, error: avMixErr(e), refused: [avMixErr(e)] };
  }
}

function avMixSetTrack(id, patch) {
  try {
    avMixEnsure();
    const track = avMixFind(id);
    if (!track) return { ok: false, track: null, refused: ["track not found: " + String(id)] };
    if (patch == null || typeof patch !== "object") return { ok: false, track: avMixTrackCopy(track), refused: ["patch must be an object"] };
    const refused = [];
    let dirty = false;
    const keys = Object.keys(patch);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const v = patch[key];
      if (key === "name") {
        if (typeof v === "string") {
          const nm = avMixStr(v, track.name, 64);
          if (nm !== track.name) { track.name = nm; dirty = true; }
        } else refused.push("name must be a string");
      } else if (key === "source") {
        const ns = avMixNormSource(v);
        if (ns.ok) { track.source = ns.source; track.rendered = null; dirty = true; }
        else refused.push(ns.error);
      } else if (key === "gainDb") {
        const n = avMixFiniteNum(v);
        if (n === null) refused.push("gainDb must be finite");
        else { const g = avMixClamp(n, AV_MIX_GAIN_MIN, AV_MIX_GAIN_MAX); if (g !== track.gainDb) { track.gainDb = g; dirty = true; } }
      } else if (key === "pan") {
        const n = avMixFiniteNum(v);
        if (n === null) refused.push("pan must be finite");
        else { const p = avMixClamp(n, -1, 1); if (p !== track.pan) { track.pan = p; dirty = true; } }
      } else if (key === "mute") {
        const b = avMixOnOff(v); if (b !== track.mute) { track.mute = b; dirty = true; }
      } else if (key === "solo") {
        const b = avMixOnOff(v); if (b !== track.solo) { track.solo = b; dirty = true; }
      } else if (key === "sends") {
        if (avMixApplySends(track, v, refused)) dirty = true;
      } else if (key === "duck") {
        if (avMixApplyDuck(track, v, refused)) dirty = true;
      } else if (key === "fx") {
        if (avMixApplyFx(track.fx, v, refused)) dirty = true;
      } else refused.push("unknown key: " + key);
    }
    if (dirty) avMix.rev++;
    return { ok: refused.length === 0, track: avMixTrackCopy(track), refused: refused };
  } catch (e) {
    return { ok: false, track: null, refused: [avMixErr(e)] };
  }
}

function avMixRemoveTrack(id) {
  try {
    avMixEnsure();
    const s = String(id);
    for (let i = 0; i < avMix.tracks.length; i++) {
      if (avMix.tracks[i].id === s) { avMix.tracks.splice(i, 1); avMix.rev++; return true; }
    }
  } catch (e) { /* never throws */ }
  return false;
}

function avMixClear() {
  try {
    avMixEnsure();
    avMix.tracks = [];
    avMix.rev++;
    return true;
  } catch (e) { return false; }
}

function avMixSetParam(path, value) {
  try {
    avMixEnsure();
    const p = (typeof path === "string") ? path : String(path);
    if (!avMixHasOwn(AV_MIX_PARAM_DEFS, p)) return { ok: false, path: p, value: value, error: "unknown param path" };
    const acc = avMixAcceptDef(AV_MIX_PARAM_DEFS[p], value);
    if (!acc.ok) return { ok: false, path: p, value: value, error: acc.error };
    if (avMix.params[p] !== acc.v) { avMix.params[p] = acc.v; avMix.rev++; }
    return { ok: true, path: p, value: acc.v };
  } catch (e) {
    return { ok: false, path: String(path), value: value, error: avMixErr(e) };
  }
}

function avMixParams() {
  try {
    avMixEnsure();
    const out = {};
    for (const k in avMix.params) if (avMixHasOwn(avMix.params, k)) out[k] = avMix.params[k];
    return out;
  } catch (e) { return {}; }
}

function avMixClasses() { return []; }

/* ---------- auto-balance ---------- */

function avMixAutoBalance(opts) {
  const t0 = avMixNow();
  try {
    avMixEnsure();
    const o = (opts && typeof opts === "object") ? opts : {};
    const target = avMixClampNum(o.target, -18, -60, 0);
    const dry = (o.dry === true);
    const rows = [];
    if (typeof avLoudLufs !== "function") {
      avMix.lastError = "av_loud unavailable (avLoudLufs missing)";
      return { ok: false, error: avMix.lastError, target: target, rows: rows, ms: Math.round(avMixNow() - t0) };
    }
    let anySolo = false;
    for (let i = 0; i < avMix.tracks.length; i++) if (avMix.tracks[i].solo === 1) { anySolo = true; break; }
    let touched = false;
    const scratchW = [], scratchR = [];
    for (let i = 0; i < avMix.tracks.length; i++) {
      const tr = avMix.tracks[i];
      if (!avMixAudible(tr, anySolo)) continue;
      const row = { id: tr.id, name: tr.name, lufs: null, deltaDb: null, gainDb: tr.gainDb, applied: false };
      let r = null;
      try { r = avMixResolveSource(tr.source, AV_MIX_SR_DEF, tr.id, scratchW, scratchR, null); } catch (e) { r = { ok: false, error: avMixErr(e) }; }
      if (r && typeof r.then === "function") {
        row.skipped = true; row.error = "engine source (async — render first)";
        rows.push(row); continue;
      }
      if (!r || !r.ok) { row.skipped = true; row.error = r ? r.error : "source unavailable"; rows.push(row); continue; }
      let lufs = null;
      try {
        const m = avLoudLufs(r.chans[0], r.chans.length > 1 ? r.chans[1] : null, r.rate);
        if (m && m.ok === true && m.lufs !== null && isFinite(m.lufs)) lufs = m.lufs;
      } catch (e2) { lufs = null; }
      if (lufs === null) { row.skipped = true; row.error = "silent material (no gated blocks)"; rows.push(row); continue; }
      row.lufs = lufs;
      const delta = avMixClamp(target - lufs, -24, 24);
      row.deltaDb = delta;
      const newGain = avMixClamp(tr.gainDb + delta, AV_MIX_GAIN_MIN, AV_MIX_GAIN_MAX);
      if (!dry) {
        row.gainDb = newGain;
        row.applied = true;
        if (newGain !== tr.gainDb) { tr.gainDb = newGain; touched = true; }
      } else {
        row.gainDb = newGain;
        row.applied = false;
      }
      rows.push(row);
    }
    if (touched) avMix.rev++;
    avMix.lastError = null;
    return { ok: true, target: target, rows: rows, ms: Math.round(avMixNow() - t0), dry: dry };
  } catch (e) {
    avMix.lastError = avMixErr(e);
    return { ok: false, error: avMixErr(e), target: null, rows: [], ms: Math.round(avMixNow() - t0) };
  }
}

/* ---------- A/B reference ---------- */

function avMixRefPublic() {
  return avMix.ref ? { kind: avMix.ref.kind, seconds: avMix.ref.seconds } : null;
}

function avMixRefFromBuffers(ref) {
  try {
    if (!avMixIsChan(ref.l)) return { ok: false, error: "ref.l must be a channel array" };
    const chans = [ref.l];
    if (ref.r != null) {
      if (!avMixIsChan(ref.r)) return { ok: false, error: "ref.r must be a channel array or absent" };
      chans.push(ref.r);
    }
    let frames = chans[0].length;
    for (let c = 1; c < chans.length; c++) if (chans[c].length < frames) frames = chans[c].length;
    if (!(frames > 0)) return { ok: false, error: "ref buffers are empty" };
    let rate = avMixFiniteNum(ref.sr);
    if (rate === null || !(rate > 0)) rate = AV_MIX_SR_DEF;
    return { ok: true, ref: { kind: "buffers", chans: chans, off: 0, frames: frames, rate: rate, seconds: frames / rate } };
  } catch (e) { return { ok: false, error: avMixErr(e) }; }
}

function avMixSetRef(ref) {
  try {
    avMixEnsure();
    if (ref === null || ref === undefined) {
      avMix.ref = null;
      return { ok: true, ref: null };
    }
    if (typeof ref !== "object") return { ok: false, ref: avMixRefPublic(), error: "ref must be {l,r,sr} | {take:id} | {comp:id} | null" };
    /* the reference must be measured as-is: store the resolved channels (no copy; caller-owned) */
    if (ref.take != null) {
      const id = String(ref.take);
      const r = avMixResolveTake(id);
      if (!r.ok) return { ok: false, ref: avMixRefPublic(), error: r.error };
      avMix.ref = { kind: "take", id: id, chans: r.chans, off: r.off, frames: r.frames, rate: r.rate, seconds: r.frames / r.rate };
      return { ok: true, ref: avMixRefPublic() };
    }
    if (ref.comp != null) {
      const id = String(ref.comp);
      const r = avMixResolveComp(id);
      if (!r.ok) return { ok: false, ref: avMixRefPublic(), error: r.error };
      avMix.ref = { kind: "comp", id: id, chans: r.chans, off: r.off, frames: r.frames, rate: r.rate, seconds: r.frames / r.rate };
      return { ok: true, ref: avMixRefPublic() };
    }
    if (ref.l != null) {
      const rb = avMixRefFromBuffers(ref);
      if (!rb.ok) return { ok: false, ref: avMixRefPublic(), error: rb.error };
      avMix.ref = rb.ref;
      return { ok: true, ref: avMixRefPublic() };
    }
    return { ok: false, ref: avMixRefPublic(), error: "ref must be {l,r,sr} | {take:id} | {comp:id} | null" };
  } catch (e) {
    avMix.lastError = avMixErr(e);
    return { ok: false, ref: avMixRefPublic(), error: avMixErr(e) };
  }
}

function avMixMeasure(chans, off, frames, rate) {
  let lufs = null, dbtp = null;
  if (typeof avLoudLufs === "function") {
    try {
      const m = avLoudLufs(chans[0], chans.length > 1 ? chans[1] : null, rate);
      if (m && m.ok === true && m.lufs !== null && isFinite(m.lufs)) lufs = m.lufs;
    } catch (e) { /* null */ }
  }
  if (typeof avLoudTruePeak === "function") {
    try {
      const m = avLoudTruePeak(chans[0], chans.length > 1 ? chans[1] : null, rate);
      if (m && m.ok === true && m.dbtp !== null && isFinite(m.dbtp)) dbtp = m.dbtp;
    } catch (e2) { /* null */ }
  }
  return { lufs: lufs, dbtp: dbtp };
}

function avMixCompare() {
  try {
    avMixEnsure();
    const lr = avMix.lastRender;
    if (!lr || lr.ok !== true) return { ok: false, error: "no render — render the mixdown first" };
    if (!avMix.ref) return { ok: false, error: "no reference — load one with setRef first" };
    let mixLufs = (lr.lufs !== null && lr.lufs !== undefined && isFinite(lr.lufs)) ? lr.lufs : null;
    let mixTp = (lr.dbtp !== null && lr.dbtp !== undefined && isFinite(lr.dbtp)) ? lr.dbtp : null;
    if ((mixLufs === null || mixTp === null) && typeof avLoudLufs === "function" && lr.l && lr.r) {
      const m = avMixMeasure([lr.l, lr.r], 0, lr.frames, lr.rate);
      if (mixLufs === null) mixLufs = m.lufs;
      if (mixTp === null) mixTp = m.dbtp;
    }
    const ref = avMix.ref;
    const rm = avMixMeasure(ref.chans, ref.off, ref.frames, ref.rate);
    const ok = (mixLufs !== null && rm.lufs !== null);
    return {
      ok: ok,
      mix: { lufs: mixLufs, dbtp: mixTp },
      ref: { lufs: rm.lufs, dbtp: rm.dbtp },
      gainToMatchDb: ok ? (mixLufs - rm.lufs) : null,
    };
  } catch (e) {
    avMix.lastError = avMixErr(e);
    return { ok: false, error: avMixErr(e), mix: { lufs: null, dbtp: null }, ref: { lufs: null, dbtp: null }, gainToMatchDb: null };
  }
}

/* ---------- guarded browser handle (the very end; no DOM at load) ---------- */

if (typeof window !== "undefined" && window) {
  try {
    window.__avMix = {
      version: AV_MIX_VERSION,
      init: avMixInit,
      state: avMixState,
      list: avMixList,
      add: avMixAddTrack,
      set: avMixSetTrack,
      remove: avMixRemoveTrack,
      clear: avMixClear,
      setParam: avMixSetParam,
      params: avMixParams,
      render: avMixRender,
      "export": avMixExport,
      autoBalance: avMixAutoBalance,
      setRef: avMixSetRef,
      compare: avMixCompare,
      classes: avMixClasses,
      pure: {
        dbToLin: avMixDbToLin,
        faderGain: avMixFaderGain,
        balanceGains: avMixBalanceGains,
        duckGain: avMixDuckGain,
        envFollower: avMixEnvFollower,
        ditherApply: avMixDitherApply,
      },
    };
  } catch (e) { /* guarded */ }
}
