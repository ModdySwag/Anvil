/* av_string.js -- Anvil P2 STRING voice engine: Karplus-Strong plucked string.
   Contract: verify/_p2_wave.md section 2.1 (engine-kind interface) + section 3.2 (this engine);
   spec lineage: docs/03 section 2.1 (STRING engine) + research/engine/T5-web-audio-engine.md
   section 13 (KS notes: allpass fractional tuning, pluck-position comb, loop phase-delay
   compensation). Clean-room: no third-party code copied; textbook KS structure.
   LAWS (do not drift):
   - strict mode; exactly ONE top-level name (`AVSTRING`); no page-scope reach-ins of any kind
     (this text runs verbatim inside the audio scope); unknown setParam path -> false, never a
     throw; every computed delay/gain is clamp-guarded so no NaN path exists.
   - stepVoice allocates nothing: no objects, arrays, closures or strings per sample; in fact it
     carries no branches at all beyond the per-sample loop math. All per-note work (tuning
     solve, exciter build, comb) happens in initVoice with a small fixed transcendental budget.
   - every per-voice field is initialised in initVoiceK (monomorphic shape); the delay line is
     allocated once per voice on its first note and reused across notes (regrown only if the
     device sample rate demands a longer line).
   - seeded determinism: humanisation + the noise exciter draw from the shared engine PRNG
     (`eng.rng`, xorshift32, drawing through the av_dsp prngU32 pattern) in a pinned order
     (3 humanisation draws, then the burst), so same boot + same note order = bit-identical.
   - base-rate output; ~15 flops/sample. The steady-state loop is a circular delay of integer
     length L, so the sustained content is exactly the f0 harmonic series (the exciter transient
     in the first lap carries the exciter's own foldback; nothing aliases in steady state).
   - PLUCK = PITCH (per-note semantics): L, the allpass coefficient and the damping coefficient
     are solved ONCE, at initVoice, from `v.pitch` + `eng.bend` + `eng.tune` and the current
     `string.*` params. A ringing string is NEVER retuned: a time-varying delay inside a
     near-unity feedback loop is a parametric pump (measured on this loop: per-sample-retuned
     rings can amplify up to ~1/(1-G) ~ 2000x); locking makes every ringing loop time-invariant
     with every mode gain G*|H| < 1, i.e. provably decaying. Consequence (documented
     deviation): glide/bend/pitch-wheel moves and damp/decay/tone/pluck knob changes apply to
     the NEXT pluck, not to a sounding string. releaseVoice stays live (single gain step).
     Glide/vibrato on strings = P3 work (fractional read-head scheme + stability analysis).

   VOICE FIELDS (all on the shared per-voice `v.k` object; `st` prefix = string kind, so the
   object can be shared with other kinds' fields without collisions; initVoiceK initialises
   them all, initVoice resets the per-note ones):
     k.stDl       Float64Array  delay line (capacity k.stCap, pow2, masked ring indexing)
     k.stExc      Float64Array  scratch: exciter burst + pluck comb source (same capacity)
     k.stCap      number        capacity in samples (pow2; ~12 Hz floor at this sample rate)
     k.stW        number        ring write index (starts at k.stL so the first read is dl[0])
     k.stL        number        integer loop delay (samples; solved at initVoice)
     k.stC        number        first-order allpass fractional-delay coefficient (|c| < 1)
     k.stB        number        one-pole damping loop-filter coefficient (small = dark)
     k.stG        number        loop feedback gain (decay; fundamental T60 = string.decay map)
     k.stLp       number        damping filter state
     k.stApX      number        allpass input history
     k.stApY      number        allpass output history
     k.stAmp      number        amplitude estimate (drives isVoiceDone after release)
     k.stAmpS     number        amplitude-estimator smoothing coefficient (~20 ms)
     k.stRel      number        per-sample release damper (1 = held, < 1 after releaseVoice)
     k.stDet      number        per-note humanisation detune (cents; +-2)
     k.stPluckJit number        per-note humanisation pluck-position jitter (+-0.025)
     k.stDampJit  number        per-note humanisation damping scale (1 +- 5%)
     k.stF0       number        the solved sounding f0 of the current tuning (evidence field)

   KEXT FIELDS (engine level, set by initEngineK; all string params live here; read at
   initVoice only):
     kext.stDamp (0..1) · kext.stDecay (0..1) · kext.stPluck (0.05..0.95) ·
     kext.stExciter (0 noise | 1 saw | 2 pulse) · kext.stTone (0..1)                        */
"use strict";

const AVSTRING = (function () {

  /* ---- constants ---- */
  const VERSION = "p2.0";
  const PREFIX = "string";
  const TAU = Math.PI * 2;
  const EXCITERS = ["noise", "saw", "pulse"];
  const MINF_HZ = 12;            /* delay capacity rule: pow2 >= sr/12 + 8 samples */
  const TRIM = 0.5;              /* output trim (parent applies v.vel * v.fade * bus scale) */
  const REL_T60 = 0.5;           /* release damper: seconds for -60 dB once released */
  const DONE_AMP = 1.2e-4;       /* isVoiceDone threshold on the amplitude estimator */
  const DEF_DAMP = 0.35, DEF_DECAY = 0.55, DEF_PLUCK = 0.28, DEF_EXC = 0, DEF_TONE = 0.6;

  /* ---- shared engine PRNG (av_dsp prngU32 pattern; one stream keeps determinism) ---- */
  function rngU32(eng) {
    let x = eng.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x = x >>> 0;
    eng.rng = x;
    return x;
  }
  function rngBip(eng) { return rngU32(eng) * 4.656612873077393e-10 - 1; }   /* [-1, 1) */
  function rngUnit(eng) { return rngU32(eng) * 2.3283064365386963e-10; }     /* [0, 1) */

  function pow2ceil(n) { let p = 1; while (p < n) p <<= 1; return p; }

  /* ---- engine level ---- */
  function initEngineK(kext) {
    kext.stDamp = DEF_DAMP;
    kext.stDecay = DEF_DECAY;
    kext.stPluck = DEF_PLUCK;
    kext.stExciter = DEF_EXC;
    kext.stTone = DEF_TONE;
  }
  /* defensive: if the parent integration has not built kext yet, build it (never in a
     per-sample path -- setParam/initVoice only) */
  function ensureKext(eng) {
    let kx = eng.kext;
    if (!kx) { kx = {}; initEngineK(kx); eng.kext = kx; }
    return kx;
  }

  /* ---- per-voice fields ---- */
  function initVoiceK(k) {
    k.stDl = null;
    k.stExc = null;
    k.stCap = 0;
    k.stW = 0;
    k.stL = 0;
    k.stC = 0;
    k.stB = 0.6585;
    k.stG = 0;
    k.stLp = 0;
    k.stApX = 0;
    k.stApY = 0;
    k.stAmp = 0;
    k.stAmpS = 0.001;
    k.stRel = 1;
    k.stDet = 0;
    k.stPluckJit = 0;
    k.stDampJit = 1;
    k.stF0 = 440;
  }

  /* ---- params: string.* only (unknown path -> false) ---- */
  function setParam(eng, path, value) {
    const kx = ensureKext(eng);
    switch (path) {
      case "string.damp": {
        const n = Number(value); if (!isFinite(n)) return false;
        kx.stDamp = n < 0 ? 0 : (n > 1 ? 1 : n);
        return true;
      }
      case "string.decay": {
        const n = Number(value); if (!isFinite(n)) return false;
        kx.stDecay = n < 0 ? 0 : (n > 1 ? 1 : n);
        return true;
      }
      case "string.pluck": {
        const n = Number(value); if (!isFinite(n)) return false;
        kx.stPluck = n < 0.05 ? 0.05 : (n > 0.95 ? 0.95 : n);
        return true;
      }
      case "string.exciter": {
        const e = EXCITERS.indexOf(String(value));
        if (e < 0) return false;
        kx.stExciter = e;
        return true;
      }
      case "string.tone": {
        const n = Number(value); if (!isFinite(n)) return false;
        kx.stTone = n < 0 ? 0 : (n > 1 ? 1 : n);
        return true;
      }
      default: return false;
    }
  }

  /* ---- tuning + loop-gain solve (called from initVoice ONLY -- see PLUCK = PITCH above) --
     Loop delay = L (integer) + allpass phase delay + one-pole damping phase delay. The
     self-consistent loop-closure equation is  D_phase(f0) = sr / f0  (the fundamental
     completes exactly one loop phase per period). Fixed point over f with the damping
     delay re-evaluated each pass; 4 passes converge far below 0.01% (loop filter phase
     delay compensation, T5 section 13). Loop gain is set for a target fundamental T60
     and divided by the damping filter's magnitude at f0 so the decay knob reads as TIME
     independent of the damp knob. */
  function retune(eng, v) {
    const k = v.k;
    const kx = ensureKext(eng);
    const sr = eng.sr;
    const st = (v.pitch - 69) + eng.bend + eng.tune + k.stDet * 0.01;
    let fT = 440 * Math.pow(2, st / 12);
    const fMin = sr / (k.stCap - 8);
    const fMax = 0.18 * sr;
    if (!(fT > fMin)) fT = fMin; else if (fT > fMax) fT = fMax;
    let b = (0.97 - 0.89 * kx.stDamp) * k.stDampJit;
    if (!(b >= 0.05)) b = 0.05; else if (b > 0.985) b = 0.985;
    const invB = 1 - b;
    /* integer delay from the target, then iterate the sounding f */
    const w0 = TAU * fT / sr;
    const dlp0 = Math.atan2(invB * Math.sin(w0), 1 - invB * Math.cos(w0)) / w0;
    let L = Math.floor(sr / fT - dlp0);
    if (!(L >= 2)) L = 2; else if (L > k.stCap - 6) L = k.stCap - 6;
    let f = fT;
    let c = 0;
    for (let it = 0; it < 4; it++) {
      const w = TAU * f / sr;
      const sw = Math.sin(w);
      const cw = Math.cos(w);
      const dlp = Math.atan2(invB * sw, 1 - invB * cw) / w;
      let want = sr / f - L - dlp;                    /* allpass phase delay needed */
      if (!(want > 0.001)) want = 0.001; else if (want > 0.999) want = 0.999;
      c = (1 - want) / (1 + want);
      const dap = -(Math.atan2(-sw, c + cw) - Math.atan2(-c * sw, 1 + c * cw)) / w;
      f = sr / (L + dlp + dap);
    }
    /* loop gain (clamped: every mode decays) */
    const wf = TAU * f / sr;
    const cwf = Math.cos(wf);
    const hm = b / Math.sqrt(1 - 2 * invB * cwf + invB * invB);
    let t60 = 0.05 * Math.pow(500, kx.stDecay);
    if (!(t60 > 0)) t60 = 0.05;
    let G = Math.pow(10, -3 / (f * t60)) / hm;
    if (!(G > 1e-9)) G = 1e-9; else if (G > 0.9995) G = 0.9995;
    k.stL = L;
    k.stC = c;
    k.stB = b;
    k.stG = G;
    k.stF0 = f;
  }

  /* ---- excitation: one loop-length burst, tone-shaped, pluck-position comb, circular ----
     dl[i] = lp_tone(exc[i]) - lp_tone(exc[(i - K) mod L])  (K = round(pluck * L)):
     the initial circulating wave; spectral nulls at harmonics of 1/pluck (the physical
     pluck-position comb). DC is cancelled by the comb by construction. */
  function buildExcitation(eng, v) {
    const k = v.k;
    const kx = ensureKext(eng);
    const L = k.stL;
    const dl = k.stDl;
    const exc = k.stExc;
    dl.fill(0);                                        /* stale-content guard */
    const et = kx.stExciter;
    if (et === 0) {
      for (let i = 0; i < L; i++) exc[i] = rngBip(eng);            /* white noise burst */
    } else if (et === 1) {
      const inv = 1 / L;
      for (let i = 0; i < L; i++) exc[i] = 2 * (i * inv) - 1;      /* one-period ramp */
    } else {
      const half = L >> 1;
      for (let i = 0; i < L; i++) exc[i] = i < half ? 1 : -1;      /* 50% duty pulse */
    }
    /* string.tone: one-pole lowpass over the burst, log-mapped 200 Hz .. 0.45*sr; lifted a
       little by velocity (a hard pluck reads brighter -- amplitude itself is the parent's) */
    let fc = 200 * Math.pow(0.45 * eng.sr / 200, kx.stTone);
    fc *= 0.55 + 0.45 * v.vel;
    if (fc > 0.45 * eng.sr) fc = 0.45 * eng.sr;
    const tc = 1 - Math.exp(-TAU * fc / eng.sr);
    let st = 0;
    for (let i = 0; i < L; i++) { st += tc * (exc[i] - st); exc[i] = st; }
    /* pluck-position comb (circular, exact) */
    let pu = kx.stPluck + k.stPluckJit;
    if (!(pu > 0.05)) pu = 0.05; else if (pu > 0.95) pu = 0.95;
    let K = Math.round(pu * L);
    if (K < 1) K = 1; else if (K > L - 1) K = L - 1;
    for (let i = 0; i < L; i++) {
      let j = i - K;
      if (j < 0) j += L;
      dl[i] = exc[i] - exc[j];
    }
  }

  /* ---- per-note reset ---- */
  function initVoice(eng, v) {
    const k = v.k;
    const kx = ensureKext(eng);
    /* capacity: allocated on the voice's first note, reused after (never per sample) */
    const need = pow2ceil(eng.sr / MINF_HZ + 8);
    if (k.stCap < need) {
      k.stDl = new Float64Array(need);
      k.stExc = new Float64Array(need);
      k.stCap = need;
    }
    /* seeded per-note humanisation (pinned draw order: 3 draws, then the burst) */
    k.stDet = (rngUnit(eng) - 0.5) * 4;                /* +-2 cents */
    k.stPluckJit = (rngUnit(eng) - 0.5) * 0.05;        /* +-0.025 pluck position */
    k.stDampJit = 1 + (rngUnit(eng) - 0.5) * 0.10;     /* +-5% damping */
    /* per-note resets */
    k.stLp = 0;
    k.stApX = 0;
    k.stApY = 0;
    k.stAmp = 0.25;
    k.stAmpS = 1 - Math.exp(-1 / (0.02 * eng.sr));
    k.stRel = 1;
    retune(eng, v);
    buildExcitation(eng, v);
    k.stW = k.stL;                                     /* first read lands on dl[0] */
  }

  /* ---- one base-rate sample ------------------------------------------------------------
     ring: read the oldest sample (L behind), one-pole damping, first-order allpass
     fractional delay, loop gain (+ release damper), write back. Output tap = the raw
     circulating sample (exciter attack intact, feedback shaped). No branches, no
     allocation, no retune: the loop is time-invariant for the whole note (see header). */
  function stepVoice(eng, v) {
    const k = v.k;
    const dl = k.stDl;
    const w = k.stW;
    const cap = k.stCap;
    const y = dl[(w - k.stL) & (cap - 1)];
    const lp = k.stLp + k.stB * (y - k.stLp);
    k.stLp = lp;
    const c = k.stC;
    const ap = c * lp + k.stApX - c * k.stApY;
    k.stApX = lp;
    k.stApY = ap;
    dl[w] = k.stG * ap * k.stRel;
    k.stW = (w + 1) & (cap - 1);
    const a = y < 0 ? -y : y;
    k.stAmp += (a - k.stAmp) * k.stAmpS;
    return y * TRIM;
  }

  /* ---- release: damper drops the tail at ~0.5 s T60 (idempotent) ---- */
  function releaseVoice(eng, v) {
    const k = v.k;
    if (k.stRel < 1) return;
    k.stRel = Math.exp(-6.9078 / (REL_T60 * eng.sr));
  }

  /* required: only a RELEASED (state 2) voice may report done; an active voice never does */
  function isVoiceDone(eng, v) {
    const k = v.k;
    if (v.state !== 2) return false;
    return k.stAmp < DONE_AMP;
  }

  /* ---- the one top-level return ---- */
  return {
    VERSION: VERSION,
    PREFIX: PREFIX,
    initEngineK: initEngineK,
    initVoiceK: initVoiceK,
    initVoice: initVoice,
    stepVoice: stepVoice,
    releaseVoice: releaseVoice,
    isVoiceDone: isVoiceDone,
    setParam: setParam,
  };
})();

if (typeof AVDSP !== "undefined" && typeof AVDSP.registerKind === "function") AVDSP.registerKind(2, AVSTRING);
