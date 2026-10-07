/* av_grain.js -- Anvil P3 GRANULAR voice engine: kind 4 (AVGRAIN).
   Contract: verify/_p3_wave.md section 5 (granular voice + sample registry reads); the kind
   interface mirrored here is verify/_p2_wave.md section 2.1 (initEngineK / initVoiceK /
   initVoice / stepVoice / setParam / guarded registerKind footer). Spec lineage: docs/03
   section 2.1 ("granular engine: Hann grains 10-200 ms, overlap 4-8, hard grain budget,
   position/rate clouds") and docs/01 (same).

   LAW PINS (fixed once here; the contract wording is loose in two places):
   1. `grain.density` (1..16) is the OVERLAP factor: a new grain starts every
      `grain.size / grain.density` seconds, i.e. ~`density` grains overlap at steady state.
      (docs/01 "overlap 4-8" can only be reached with this reading: a grains/sec reading top
      out at 0.2 s x 16/s = 3.2 concurrent grains.) The spawn clock is a fractional sample
      accumulator: integer periods give EXACT start-to-start spacing; fractional periods
      alternate floor/ceil with the exact mean.
   2. `grain.jitter` (0..1) is the per-grain read-position scatter: uniform +-0.5 * jitter in
      NORMALISED buffer units around grain.pos (positions mix 0 = buffer start, 1 = buffer
      end). Timing is never jittered (spacing stays exact).
   3. Key tracking: a grain's rate is latched at spawn from the sounding note pitch with root
      C4 = 60 (inc = bufRate/sr * 2^((v.pitch - 60 + grain.pitch + eng.bend + eng.tune)/12));
      a sounding grain NEVER retunes (granular PLUCK=PITCH analogue -- the string engine's
      documented law). grain.pitch is the +-24 st offset on top.
   4. Per-grain read overrun (position past the buffer end, e.g. short samples with late
      starts) CLAMPS the read index to the last frame; the Hann window still runs out, so no
      discontinuity is introduced. No wrap, no early cut.

   BUDGET: a fixed ring of 24 grain slots per voice (section 5 hard budget). A spawn lands in
   k.grNext; if that slot is still ACTIVE the (oldest-in-ring) grain is refused further output
   -- "oldest-refusal" -- counted in k.grEvict. With the pinned period law (overlap <= 16 < 24)
   eviction cannot trigger from legal params; it is a hard guarantee, not a scheduling device.

   LAWS (do not drift):
   - strict mode; exactly ONE top-level name (`AVGRAIN`); no page-scope reach-ins of any kind
     (this text runs verbatim inside the audio worklet AND the page-level SPN fallback).
   - allocation ONLY at create (initVoiceK) / note-on (initVoice) / setParam time. stepVoice
     and spawn allocate NOTHING: no objects, arrays, closures or strings.
   - monomorphic: every v.k field is created in initVoiceK; the 24 grain slots are parallel
     typed arrays + preallocated ref arrays (one shape, every voice, every slot).
   - seeded determinism: ONE eng.rng draw per note (local stream seed); TWO draws per actual
     grain spawn in pinned order -- (1) position jitter, (2) stereo pan. Same boot + same note
     order + same params => bit-identical renders.
   - defensive registry reads: eng.samples may be absent / short / hold empty slots -- a spawn
     with no readable slot produces no grain (the clock still advances). Each grain LATCHES
     its channel refs at spawn, so a slot replaced mid-grain never disturbs a running grain.
     Slot shape (pinned, parent writes it at message time):
       eng.samples[0..3] = null | { name, rate, n, ch1, ch2 }   (ch2 null = mono, n = frames)

   VOICE FIELDS (all on the shared per-voice `v.k` object; prefix `gr`; initVoiceK creates
   every field, initVoice resets the per-note ones):
     k.grAct    Uint8Array(24)   per-slot active flag (1 = rendering)
     k.grPos    Float64Array(24) grain read position (frames, fractional; latched at spawn)
     k.grInc    Float64Array(24) per-output-sample read increment (latched at spawn)
     k.grPh     Float64Array(24) Hann phase [0,1)
     k.grPhI    Float64Array(24) Hann phase increment = 1/(size*sr)
     k.grGL     Float64Array(24) left pan gain (equal-power; latched at spawn)
     k.grGR     Float64Array(24) right pan gain
     k.grAmp    Float64Array(24) per-grain amplitude = vol * TRIM / sqrt(density)
     k.grCh1    Array(24)        ch1 refs the grains read (null until spawned)
     k.grCh2    Array(24)        ch2 refs, or null for mono slots
     k.grN      Float64Array(24) frame counts of the slots the grains read
     k.grLive   number           active grain count (never exceeds 24)
     k.grMaxLive number          high-water mark of grLive for the current note (evidence)
     k.grEvict  number           oldest-refusals so far (evidence; 0 for legal params)
     k.grNext   number           ring index the next spawn lands in (0..23)
     k.grClock  number           fractional spawn clock (samples)
     k.grPeriod number           current spawn period (samples) = size*sr/density
     k.grRng    number           per-voice xorshift32 stream (seeded from eng.rng at initVoice)
     k.grSpawn  number           grains spawned this note (evidence)
     k.grLastSpawn number        k.grSmp at the last spawn (evidence: start times)
     k.grSmp    number           per-note sample counter (evidence)
     k.grOutL   number           last sample's stereo pair (L); the shared mono kind path
     k.grOutR   number           consumes the stepVoice() return = 0.5*(L+R). The parent MAY
                                 read k.grOutL/R for a true-stereo kind branch (reported hook).

   KEXT FIELDS (engine level, set by initEngineK; read at SPAWN, so knob moves apply from the
   next grain -- a sounding grain is never retuned or resized):
     kext.grBuf    0..3      (default 0)    which eng.samples slot to read
     kext.grPos    0..1      (default 0.25) cloud read position (normalised)
     kext.grSize   0.01..0.2 s (default 0.1)  Hann grain duration (output time)
     kext.grDensity 1..16    (default 4)    overlap factor; spacing = size/density
     kext.grPitch  -24..24 st (default 0)   transposition on top of key tracking
     kext.grJitter 0..1      (default 0.2)  +-0.5*jitter normalised position scatter
     kext.grSpread 0..1      (default 0.5)  per-grain stereo pan scatter
     kext.grVol    0..1      (default 0.8)  engine output gain                      */
"use strict";

const AVGRAIN = (function () {

  const VERSION = "p3.0";
  const PREFIX = "grain";
  const TAU = Math.PI * 2;
  const MAXG = 24;               /* hard per-voice grain budget (contract section 5) */
  const GR_TRIM = 0.5;           /* grain gain scale (density-normalised; report documents) */
  const HANN_N = 2048;           /* Hann LUT entries (built once at load; w = sinLut^2) */
  const DEF_BUF = 0, DEF_POS = 0.25, DEF_SIZE = 0.1, DEF_DENS = 4,
        DEF_PITCH = 0, DEF_JIT = 0.2, DEF_SPREAD = 0.5, DEF_VOL = 0.8;

  /* ---- Hann look-up: lut[i] = sin(pi*i/N); window w(ph) = lut(ph)^2 (exact Hann) ---- */
  const hannLut = new Float64Array(HANN_N + 1);
  for (let i = 0; i <= HANN_N; i++) hannLut[i] = Math.sin(Math.PI * i / HANN_N);

  function cl(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ---- shared engine PRNG (av_dsp prngU32 pattern), used for the per-note stream seed ---- */
  function prngU32(eng) {
    let x = eng.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x = x >>> 0;
    eng.rng = x;
    return x;
  }
  /* ---- local per-voice stream (xorshift32, own state; same constants) ---- */
  function grU32(k) {
    let x = k.grRng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x = x >>> 0;
    k.grRng = x;
    return x;
  }
  function grUnit(k) { return grU32(k) * 2.3283064365386963e-10; }   /* [0, 1) */

  /* ---- engine level ---- */
  function initEngineK(kext) {
    kext.grBuf = DEF_BUF;
    kext.grPos = DEF_POS;
    kext.grSize = DEF_SIZE;
    kext.grDensity = DEF_DENS;
    kext.grPitch = DEF_PITCH;
    kext.grJitter = DEF_JIT;
    kext.grSpread = DEF_SPREAD;
    kext.grVol = DEF_VOL;
  }
  /* defensive: build the kind fields if the parent integration has not yet (never per
     sample; setParam / initVoice / note-on only) */
  function ensureKext(eng) {
    let kx = eng.kext;
    if (!kx) { kx = {}; initEngineK(kx); eng.kext = kx; }
    else if (kx.grDensity === undefined) initEngineK(kx);
    return kx;
  }

  /* ---- per-voice fields (monomorphic shape; called once per voice at engine create) ---- */
  function initVoiceK(k) {
    k.grAct = new Uint8Array(MAXG);
    k.grPos = new Float64Array(MAXG);
    k.grInc = new Float64Array(MAXG);
    k.grPh = new Float64Array(MAXG);
    k.grPhI = new Float64Array(MAXG);
    k.grGL = new Float64Array(MAXG);
    k.grGR = new Float64Array(MAXG);
    k.grAmp = new Float64Array(MAXG);
    k.grCh1 = new Array(MAXG).fill(null);
    k.grCh2 = new Array(MAXG).fill(null);
    k.grN = new Float64Array(MAXG);
    k.grLive = 0;
    k.grMaxLive = 0;
    k.grEvict = 0;
    k.grNext = 0;
    k.grClock = 0;
    k.grPeriod = 4800;
    k.grRng = 0x9E3779B9;
    k.grSpawn = 0;
    k.grLastSpawn = -1;
    k.grSmp = 0;
    k.grOutL = 0;
    k.grOutR = 0;
  }

  /* ---- params: grain.* only (unknown path -> false, never a throw; every value clamped) ---- */
  function setParam(eng, path, value) {
    const kx = ensureKext(eng);
    switch (path) {
      case "grain.buf": {
        const n = Number(value); if (!isFinite(n)) return false;
        kx.grBuf = cl(Math.round(n), 0, 3);
        return true;
      }
      case "grain.pos": {
        const n = Number(value); if (!isFinite(n)) return false;
        kx.grPos = cl(n, 0, 1);
        return true;
      }
      case "grain.size": {
        const n = Number(value); if (!isFinite(n)) return false;
        kx.grSize = cl(n, 0.01, 0.2);
        return true;
      }
      case "grain.density": {
        const n = Number(value); if (!isFinite(n)) return false;
        kx.grDensity = cl(n, 1, 16);
        return true;
      }
      case "grain.pitch": {
        const n = Number(value); if (!isFinite(n)) return false;
        kx.grPitch = cl(n, -24, 24);
        return true;
      }
      case "grain.jitter": {
        const n = Number(value); if (!isFinite(n)) return false;
        kx.grJitter = cl(n, 0, 1);
        return true;
      }
      case "grain.spread": {
        const n = Number(value); if (!isFinite(n)) return false;
        kx.grSpread = cl(n, 0, 1);
        return true;
      }
      case "grain.vol": {
        const n = Number(value); if (!isFinite(n)) return false;
        kx.grVol = cl(n, 0, 1);
        return true;
      }
      default: return false;
    }
  }

  /* ---- per-note reset ---- */
  function initVoice(eng, v) {
    const k = v.k;
    const kx = ensureKext(eng);
    /* local stream seed: ONE eng.rng draw (pinned draw order) */
    let seed = prngU32(eng);
    if (seed === 0) seed = 0x9E3779B9;
    k.grRng = seed;
    k.grAct.fill(0);
    k.grLive = 0;
    k.grMaxLive = 0;
    k.grEvict = 0;
    k.grNext = 0;
    k.grSpawn = 0;
    k.grLastSpawn = -1;
    k.grSmp = 0;
    k.grOutL = 0;
    k.grOutR = 0;
    /* spawn period + clock (clock = period-1 so the FIRST stepVoice call spawns) */
    let p = kx.grSize * eng.sr / kx.grDensity;
    if (!(p >= 1)) p = 1; else if (p > 1e7) p = 1e7;
    k.grPeriod = p;
    k.grClock = p - 1;
  }

  /* ---- grain spawn (called from stepVoice only; allocates nothing) ---- */
  function spawn(eng, v, kx) {
    const k = v.k;
    /* refresh the period from the live knobs first (a spawn is the only clock consumer) */
    let den = kx.grDensity;
    if (!(den >= 1)) den = 1; else if (den > 16) den = 16;
    let sz = kx.grSize;
    if (!(sz >= 0.01)) sz = 0.01; else if (sz > 0.2) sz = 0.2;
    let p = sz * eng.sr / den;
    if (!(p >= 1)) p = 1; else if (p > 1e7) p = 1e7;
    k.grPeriod = p;

    /* defensive slot lookup; no readable slot -> no grain (clock advanced, budget untouched) */
    const reg = eng.samples;
    let slot = null;
    if (reg) {
      const t = reg[kx.grBuf | 0];
      if (t && t.ch1 && t.ch1.length > 0) slot = t;
    }
    if (!slot) return;

    /* slot fields (defensive; latch the refs for this grain) — resolved BEFORE ring admission
       so an unreadable slot can never evict a live grain */
    let n = (typeof slot.n === "number" && isFinite(slot.n) && slot.n > 0) ? (slot.n | 0) : slot.ch1.length;
    if (n > slot.ch1.length) n = slot.ch1.length;
    if (!(n >= 1)) return;
    const ch2 = (slot.ch2 && slot.ch2.length >= n) ? slot.ch2 : null;

    /* ring admission: reuse of an ACTIVE slot is an oldest-refusal (hard budget guarantee) */
    const s = k.grNext;
    let nx = s + 1; if (nx >= MAXG) nx = 0;
    k.grNext = nx;
    if (k.grAct[s] === 1) { k.grEvict++; k.grLive--; }

    /* seeded draws, pinned order: 1 = position jitter, 2 = stereo pan */
    const u1 = grUnit(k);
    const u2 = grUnit(k);

    let jt = kx.grJitter; if (!(jt >= 0)) jt = 0; else if (jt > 1) jt = 1;
    let posN = kx.grPos; if (!(posN >= 0)) posN = 0; else if (posN > 1) posN = 1;
    posN += (u1 * 2 - 1) * jt * 0.5;
    posN -= Math.floor(posN);                       /* wrap into [0,1) */
    let pos = posN * (n - 1);
    if (!(pos >= 0)) pos = 0; else if (pos > n - 1) pos = n - 1;

    let sp = kx.grSpread; if (!(sp >= 0)) sp = 0; else if (sp > 1) sp = 1;
    const pan = sp * (u2 * 2 - 1);                  /* [-sp, sp] */
    const a = (pan + 1) * 0.7853981633974483;       /* * pi/4 -> equal-power pan */
    k.grGL[s] = Math.cos(a);
    k.grGR[s] = Math.sin(a);

    let vol = kx.grVol; if (!(vol >= 0)) vol = 0; else if (vol > 1) vol = 1;
    k.grAmp[s] = vol * GR_TRIM / Math.sqrt(den);

    /* rate: key-tracked (root C4=60) + grain.pitch + master bend/tune, latched per grain */
    const rateB = (typeof slot.rate === "number" && slot.rate > 0) ? slot.rate : eng.sr;
    let st = (v.pitch - 60) + kx.grPitch + eng.bend + eng.tune;
    if (!isFinite(st)) st = 0; else if (st > 120) st = 120; else if (st < -120) st = -120;
    let inc = (rateB / eng.sr) * Math.pow(2, st / 12);
    if (!(inc > 0)) inc = 1e-9; else if (inc > 1e9) inc = 1e9;

    let L = sz * eng.sr;
    if (!(L >= 1)) L = 1;

    k.grPos[s] = pos;
    k.grInc[s] = inc;
    k.grPh[s] = 0;
    k.grPhI[s] = 1 / L;
    k.grCh1[s] = slot.ch1;
    k.grCh2[s] = ch2;
    k.grN[s] = n;
    k.grAct[s] = 1;
    k.grLive++;
    if (k.grLive > k.grMaxLive) k.grMaxLive = k.grLive;
    k.grSpawn++;
    k.grLastSpawn = k.grSmp;
  }

  /* ---- one base-rate sample ------------------------------------------------------------
     spawn clock -> render every live grain (Hann LUT window, fractional linear read,
     per-grain latched rate/pan/amp) -> advance. Stereo pair kept on k.grOutL/R; the shared
     mono kind path consumes the return value. Nothing here allocates. */
  function stepVoice(eng, v) {
    const k = v.k;
    const kx = eng.kext;
    if (!kx) return 0;
    k.grSmp++;
    if (v.state === 1) {
      k.grClock += 1;
      if (k.grClock >= k.grPeriod) {
        k.grClock -= k.grPeriod;
        spawn(eng, v, kx);
      }
    }
    const act = k.grAct, phA = k.grPh, phI = k.grPhI, posA = k.grPos, incA = k.grInc;
    const glA = k.grGL, grA = k.grGR, ampA = k.grAmp, nA = k.grN;
    const c1A = k.grCh1, c2A = k.grCh2;
    let sumL = 0, sumR = 0;
    for (let i = 0; i < MAXG; i++) {
      if (act[i] === 0) continue;
      /* Hann window from the LUT: w = sin(pi*ph)^2 */
      const x = phA[i] * HANN_N;
      const ix = x | 0;
      const fx = x - ix;
      const sv = hannLut[ix] + (hannLut[ix + 1] - hannLut[ix]) * fx;
      const w = sv * sv;
      /* fractional read, index clamped to the buffer (overrun holds the last frame) */
      const ni = nA[i];
      const p = posA[i];
      let i0 = p | 0;
      if (i0 > ni - 1) i0 = ni - 1; else if (i0 < 0) i0 = 0;
      let i1 = i0 + 1; if (i1 > ni - 1) i1 = ni - 1;
      const f = p - i0;
      const ch1 = c1A[i];
      const a0 = ch1[i0];
      const s1 = a0 + f * (ch1[i1] - a0);
      const ch2 = c2A[i];
      let s2 = s1;
      if (ch2 !== null) { const b0 = ch2[i0]; s2 = b0 + f * (ch2[i1] - b0); }
      const g = ampA[i] * w;
      sumL += s1 * g * glA[i];
      sumR += s2 * g * grA[i];
      /* advance: window phase, then read position; full window -> grain done */
      const np = phA[i] + phI[i];
      if (np >= 1) { act[i] = 0; k.grLive--; }
      else phA[i] = np;
      posA[i] = p + incA[i];
    }
    k.grOutL = sumL;
    k.grOutR = sumR;
    return (sumL + sumR) * 0.5;
  }

  /* required: only a RELEASED voice may report done; spawns stop at release (state gate),
     the live grains ring out (<= grain.size), then the voice is idle */
  function isVoiceDone(eng, v) {
    void eng;
    if (v.state !== 2) return false;
    const k = v.k;
    return !k || k.grLive === 0;
  }

  /* ---- the one top-level return ---- */
  return {
    VERSION: VERSION,
    PREFIX: PREFIX,
    initEngineK: initEngineK,
    initVoiceK: initVoiceK,
    initVoice: initVoice,
    stepVoice: stepVoice,
    isVoiceDone: isVoiceDone,
    setParam: setParam,
  };
})();

if (typeof AVDSP !== "undefined" && typeof AVDSP.registerKind === "function") AVDSP.registerKind(4, AVGRAIN);
