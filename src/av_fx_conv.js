/* av_fx_conv.js -- Anvil M1 SOUND DEPOT FX module: convolution IR (module `AVFXCONV`, fx prefix
   "conv", child sa-D). Wave contract: verify/_m1_wave.md section 2.4 (+ section 5 watch-outs).
   One text, three scopes: bundled in the single-file app, concatenated into the audio-worklet
   module by build.py (the parent wires it), and loaded verbatim by the scratch node harness.

   LAWS (do not drift):
   - exactly ONE top-level name (AVFXCONV). strict mode. No DOM/window/document/console, no page
     reach-ins of any kind: this text runs inside the audio scope (worklet global scope facts:
     no fetch/URL/performance/TextEncoder/structuredClone there; the in-worklet clock is Date.now
     -- this module never reads a clock at all).
   - process() allocates nothing and is allocation-free end to end: every buffer -- FFT scratch,
     sliding input window, spectra, output block, the loaded-impulse time domain copy, the IR
     synthesis scratch -- is created in createState() (or bindEngine's sr rebuild, a setup-time
     hook that runs right after createState) and is reused for the whole engine lifetime.
     setParam / loadImpulse write into those preallocated arrays only; they never allocate.
   - deterministic: same state + same call sequence gives bit-identical output. The only
     randomness anywhere is this module's OWN seeded xorshift32 PRNG (seed constant CONV_SEED),
     RESEEDED at the start of every factory generation -- the engine voice PRNG is untouched and
     nothing else in the module is random.
   - never NaN: every parameter is clamped, every divisor has a positive floor, the input is
     guarded at the entry, the factory IR is normalised to a finite unit energy target, loaded
     impulses have non-finite/absurd samples coerced to 0.
   - ONE stereo sample per call; result in st.oL / st.oR (the WET signal; the parent owns the
     dry/wet blend, contract section 2.1). When st.mix <= 0 (or st.on === 0) process() writes
     the input through bit-identically and skips the DSP -- the module-side null guarantee.
     Under a factory mode the module ALWAYS writes the fully convolved signal (never a blend of
     its own); with mode "user" and no impulse loaded it is an honest dry pass (documented).

   ALGORITHM (uniform partitioned overlap-save FFT convolution; clean-room, standard published
   technique -- classic block convolution analysis: Stockham, "High-speed convolution and
   correlation" and the standard real-time partitioned-convolution formulation; no third-party
   code):
   - partition size P = 512 samples, FFT size N = 2P = 1024 (zero-padded partitions). The
     impulse is split into consecutive P-sample segments; segment k's spectrum H_k is the
     N-point DFT of h[kP .. kP+P-1] zero-padded to N. A sliding input window of the last N
     samples is transformed once per completed block; output block m is
         y_m = IDFT( sum_{k=0..K-1} X_{m-k} * H_k ) taken at its LAST P samples,
     which is exact linear convolution (overlap-save; the wrap-around region is discarded).
   - LATENCY: the output for input sample n is emitted at the process() call of sample n+LAT
     with LAT = P - 1 = 511 samples (the just-arrived sample completes the block whose last-P
     IFFT region already contains its h[0] contribution). At 48 kHz that is 10.65 ms, at 96 kHz
     5.32 ms. The harness measures the 511 offset and compares it against snap().latency.
   - spectra are stored in Hermitian half form (bins 0..N/2 = 513 complex values per segment);
     the product of two conjugate-symmetric spectra is conjugate-symmetric, so the mirrored
     half is reconstructed exactly (copy + negation) before the inverse transform -- identical
     maths to the full-complex form at half the multiply count and half the storage.
   - impulse cap: 2.0 s at any sample rate up to 96 kHz (192000 samples above 96 kHz, where the
     path is still honoured, honestly truncated and reported via snap(); see st.irTrunc). The
     partition arrays are sized once for that cap: K_MAX = ceil(MIN(2s*sr, 192000) / 512)
     segments per channel. Memory at 48 kHz is about 9 MB stereo for a full engine state,
     ~17 MB at 96 kHz (FFT machinery + partition bank + input spectra ring + the stored user
     impulse), allocated in createState and never reallocated at run time.
   - loadImpulse NEVER resamples: the page importer pre-resamples to the engine rate and this
     call accepts {rate within 1% of st.sr, ch1 Float64Array/Float32Array, ch2 same or null,
     length <= 2.0 s at <= 96 kHz}. It stores a copy into the preallocated user buffer,
     partitions it into the SAME segment bank the factory modes use, and marks user mode ready;
     switching to mode "user" later re-partitions from that copy. Rate mismatch or a bad channel
     argument is refused (false) -- never a silent resample.

   FACTORY BANK (6 modes, generated deterministically in-worklet by the recipes below; all own
   CC0 content, synthesised from this file's own PRNG + Math only):
   lengths are L = clamp(round(lenS(mode,size) * sr), 64, maxIr) and the tail envelope is
   exp(-n/tau) with tau = L / (3 + 9*decay) (decay 0 -> -26 dB across the IR, 1 -> -104 dB).
   Damping applies damp one-pole lowpass stages (stages = 2 for room/hall, else 1) with
   a = 1 - 0.9*damp^2 (damp 0 = exact no-op). Both channels are generated from separate PRNG
   streams (per-mode, per-channel seeds) so the tail is genuinely decorrelated stereo; each
   mode keeps its documented character:
     plate  0.40+1.40*size s -- dense smooth bright tail: lowpassed white noise (one-pole 6.5
            kHz + 90 Hz low cut) under the exponential envelope, plus 6 fixed early reflections
            (0.7..7.3 ms, alternating signs, gains scaled by size).
     room   0.15+0.75*size s -- 10 sparse early reflections (4 ms on, accelerating spacing,
            alternating signs) over a diffuse layer whose density ramps in over ~20 ms
            (1-exp(-n/20ms) build), one-pole 4.2 kHz.
     hall   0.60+1.35*size s -- slow build: density ramp over ~55 ms, two cascaded one-poles
            at 3.4 kHz (dark, smooth), 4 subtle early reflections in the first 31 ms.
     spring 0.25+0.85*size s -- 26 sparse alternating impulses (PRNG positions/gains decaying
            geometrically) smeared through a 6-stage first-order allpass cascade (c = 0.62) --
            the dispersive chirp character -- plus a low 5.2 kHz-filtered noise floor.
     cab    0.020+0.030*size s -- short resonant box: 7 damped sinusoidal modes (88..1290 Hz,
            PRNG amplitude/frequency jitter, shorter tau for higher modes), a 6 ms lowpassed
            noise burst and a direct tap.
     user   no synthesis: honest dry pass until loadImpulse ran (documented); after a load it
            is the loaded impulse, true stereo.
   Every factory IR is scaled by ONE shared gain so that (E_ch1 + E_ch2)/2 = 1 (unit average L2
   energy -> wet output has unit white-noise RMS and the mix knob behaves predictably; the
   stereo balance is preserved by the shared gain). st.irName reports "factory:<mode>" or the
   loaded name.

   PARAMS (fx.conv.*; setParam accepts the full path or the bare `conv.` form):
     on     0 | 1                                       default 0
     mix    0..1                                        default 0.25
     mode   "plate"|"room"|"hall"|"spring"|"cab"|"user" default "plate"
     size   0..1  (mode length scale)                   default 0.5
     decay  0..1  (tail decay rate)                     default 0.5
     damp   0..1  (one-pole HF damping of the IR)       default 0.5
   Mode picks and conv.on regenerate the factory IR immediately at setParam time. size/decay/
   damp are DRAG-COALESCED (M1 parent decision): the first change after 120 ms of quiet rebuilds
   immediately; changes inside a burst only mark the IR dirty and the rebuild is flushed from
   process() once the burst has settled (150 ms since the last change) -- a UI drag would
   otherwise stall the audio thread once per pointer move (measured 4.6-9 ms @48k, up to
   ~29 ms @96k). size/decay/damp do not touch a loaded user impulse. Every IR change
   also rearms the convolution memory (input spectra + block phase + output block are zeroed),
   so post-change rendering is deterministic from a clean slate; there is no cross-fade between
   IRs (short state cut, documented).

   STATE FIELDS (all created in createState; documented for the parent):
     st.sr, st.eng, st.on, st.mix, st.modeId 0..5, st.mode, st.size, st.decay, st.damp
     st.irName, st.irLen, st.irLenOrig, st.irTrunc, st.irK, st.fDirty, st.userReady
     st.oL / st.oR  (wet output sample)
     internal: st.maxIr, st.kMax, st.kAct, st.phase, st.blk, st.w, st.drain,
     st.inL/st.inR (N-sample input window), st.fRe/st.fIm (FFT scratch), st.aRe/st.aIm
     (accumulator), st.urL/st.urR (stored user impulse), st.genBuf (IR synthesis scratch),
     st.prL/st.piL/st.prR/st.piR (partition spectra), st.xrL/st.xiL/st.xrR/st.xiR (input spectra
     ring), st.obL/st.obR (completed output block), st.genRng (this module's PRNG state).

   Harness: cache/scratch/m1/conv/harness.mjs (child sa-D; not shipped). */

"use strict";
const AVFXCONV = (function () {

  const VERSION = "m1.0";
  const PREFIX = "conv";

  const MODES = ["plate", "room", "hall", "spring", "cab", "user"];
  const M_USER = 5;                       /* the user-mode index */

  const P = 512;                          /* partition size (samples) -- contract cap <= 512 */
  const FFT_N = P << 1;                   /* FFT size (zero-padded partition), 1024 */
  const FFT_N2 = FFT_N >> 1;              /* 512 */
  const FFT_HN = FFT_N2 + 1;              /* 513 stored Hermitian bins */
  const MASK_N = FFT_N - 1;

  const MAX_S = 2.0;                      /* impulse cap seconds at sr <= 96 kHz */
  const SR_CAP = 96000;                   /* above this rate the 2 s cap becomes a sample cap */
  const MAX_X = 1e6;                      /* entry guard: |x| beyond this (or non-finite) -> 0 */

  const CONV_SEED = 0x1A2B3C4D;           /* this module's OWN PRNG seed -- never the engine's */

  const TWO_PI = 6.283185307179586;

  /* damp: one-pole coefficient a = 1 - DAMP_SPAN*damp^2 (damp 0 -> a = 1 -> exact no-op) */
  const DAMP_SPAN = 0.9;

  /* ---- small helpers ---- */
  function cl(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ---- radix-2 FFT (own implementation; forward e^-i, inverse e^+i normalised by 1/N).
     Tables are built once when this file is evaluated; transform calls allocate nothing and
     touch the two arrays handed in only. */
  const FFT_REV = (function () {
    const a = new Int32Array(FFT_N);
    let bits = 0;
    while ((1 << bits) < FFT_N) bits++;
    for (let i = 0; i < FFT_N; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) { if (i & (1 << b)) r |= 1 << (bits - 1 - b); }
      a[i] = r;
    }
    return a;
  })();
  const FFT_COS = (function () {
    const a = new Float64Array(FFT_N2);
    for (let k = 0; k < FFT_N2; k++) a[k] = Math.cos(TWO_PI * k / FFT_N);
    return a;
  })();
  const FFT_SIN = (function () {
    const a = new Float64Array(FFT_N2);
    for (let k = 0; k < FFT_N2; k++) a[k] = Math.sin(TWO_PI * k / FFT_N);
    return a;
  })();

  function fftCore(re, im, inv) {
    for (let i = 1; i < FFT_N; i++) {
      const j = FFT_REV[i];
      if (i < j) {
        const t = re[i]; re[i] = re[j]; re[j] = t;
        const u = im[i]; im[i] = im[j]; im[j] = u;
      }
    }
    for (let len = 2; len <= FFT_N; len <<= 1) {
      const half = len >> 1;
      const step = FFT_N / len;
      for (let i = 0; i < FFT_N; i += len) {
        for (let j2 = 0; j2 < half; j2++) {
          const k = j2 * step;
          const wr = FFT_COS[k];
          const wi = inv ? FFT_SIN[k] : -FFT_SIN[k];
          const a = i + j2;
          const b = a + half;
          const ar = re[a], ai = im[a], br = re[b], bi = im[b];
          const vr = br * wr - bi * wi;
          const vi = br * wi + bi * wr;
          re[a] = ar + vr; im[a] = ai + vi;
          re[b] = ar - vr; im[b] = ai - vi;
        }
      }
    }
    if (inv) {
      const s = 1 / FFT_N;
      for (let i = 0; i < FFT_N; i++) { re[i] *= s; im[i] *= s; }
    }
  }

  /* ---- this module's PRNG (xorshift32; reseeded per factory generation) ---- */
  function genU32(st) {
    let x = st.genRng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x = x >>> 0;
    st.genRng = x;
    return x;
  }
  function genBip(st) { return genU32(st) * 4.656612873077393e-10 - 1; }   /* [-1, 1) */
  function genUnit(st) { return genU32(st) * 2.3283064365386963e-10; }     /* [0, 1) */

  function genReseed(st, modeId, ch) {
    let s = (CONV_SEED ^ ((modeId + 1) * 0x9E3779B1) ^ ((ch + 1) * 0x85EBCA6B)) >>> 0;
    if (s === 0) s = CONV_SEED | 1;
    st.genRng = s;
  }

  /* ---- buffer construction (the ONLY places allocation happens are createState and the
     setup-time bindEngine rebuild; both run before any process() call) ---- */
  function buildBuffers(st) {
    const sr = st.sr;
    st.maxIr = Math.min(Math.round(MAX_S * sr), Math.round(MAX_S * SR_CAP));
    st.kMax = Math.ceil(st.maxIr / P);
    const km = st.kMax, hn = FFT_HN;
    st.inL = new Float64Array(FFT_N);
    st.inR = new Float64Array(FFT_N);
    st.fRe = new Float64Array(FFT_N);
    st.fIm = new Float64Array(FFT_N);
    st.aRe = new Float64Array(FFT_N);
    st.aIm = new Float64Array(FFT_N);
    st.obL = new Float64Array(P);
    st.obR = new Float64Array(P);
    st.prL = new Float64Array(km * hn);
    st.piL = new Float64Array(km * hn);
    st.prR = new Float64Array(km * hn);
    st.piR = new Float64Array(km * hn);
    st.xrL = new Float64Array(km * hn);
    st.xiL = new Float64Array(km * hn);
    st.xrR = new Float64Array(km * hn);
    st.xiR = new Float64Array(km * hn);
    st.urL = new Float64Array(st.maxIr);
    st.urR = new Float64Array(st.maxIr);
    st.genBuf = new Float64Array(st.maxIr);
    st.kAct = 0;
    st.phase = 0;
    st.blk = 0;
    st.w = 0;
    st.drain = 0;
    st.oL = 0;
    st.oR = 0;
  }

  /* ---- state ---- */
  function createState(opts) {
    const st = {
      sr: 48000,
      eng: null,
      on: 0,
      mix: 0.25,
      modeId: 0,
      mode: "plate",
      size: 0.5,
      decay: 0.5,
      damp: 0.5,
      irName: "",
      irLen: 0,
      irLenOrig: 0,
      irTrunc: 0,
      irK: 0,
      fDirty: 1,          /* factory IR not yet built (built lazily at first use) */
      lastGenMs: 0, pendMs: 0,   /* M1: regen coalescing (drag-safe IR rebuilds) */
      userReady: 0,
      genRng: CONV_SEED,
      oL: 0, oR: 0,
    };
    const o = opts || {};
    const sr0 = Number(o.sampleRate !== undefined ? o.sampleRate : o.sr);
    if (isFinite(sr0) && sr0 >= 8000 && sr0 <= 192000) st.sr = sr0;
    buildBuffers(st);
    return st;
  }

  /* setup-time hook: the engine backref + the exact device rate. A rate change rebuilds the
     buffers (setup time only), invalidating a previously loaded impulse honestly. */
  function bindEngine(st, eng) {
    if (!st || !eng) return false;
    st.eng = eng;
    const sr = Number(eng.sr !== undefined ? eng.sr : eng.sampleRate);
    if (isFinite(sr) && sr >= 8000 && sr <= 192000 && sr !== st.sr) {
      st.sr = sr;
      buildBuffers(st);
      st.fDirty = 1;
      st.userReady = 0;
    }
    return true;
  }

  /* ---- convolution memory rearm (called after every IR change; no allocation) ---- */
  function zeroAudio(st) {
    st.inL.fill(0); st.inR.fill(0);
    st.obL.fill(0); st.obR.fill(0);
    st.phase = 0;
    st.blk = 0;
    st.w = 0;
    st.drain = 0;
    st.oL = 0;
    st.oR = 0;
  }
  function armIR(st, kK) {
    st.xrL.fill(0); st.xiL.fill(0); st.xrR.fill(0); st.xiR.fill(0);
    st.kAct = kK > 0 ? kK : 1;
    zeroAudio(st);
  }

  /* reset(): zero the audio memory (params + the partition bank stay; the parent may use this
     like the other FX modules' reset). */
  function reset(st) {
    if (!st) return false;
    zeroAudio(st);
    return true;
  }

  /* ---- IR partitionisation: write K segment spectra of a time-domain IR into the shared
     partition bank. src is a Float64Array of length >= L; reads only, writes spectra only. */
  function partitionize(st, ch, src, L) {
    const K = Math.ceil(L / P);
    const pr = ch === 0 ? st.prL : st.prR;
    const pi = ch === 0 ? st.piL : st.piR;
    const fre = st.fRe, fim = st.fIm, hn = FFT_HN;
    for (let k = 0; k < K; k++) {
      const base = k * P;
      for (let i = 0; i < P; i++) {
        const idx = base + i;
        fre[i] = idx < L ? src[idx] : 0;
      }
      for (let i = P; i < FFT_N; i++) fre[i] = 0;
      for (let i = 0; i < FFT_N; i++) fim[i] = 0;
      fftCore(fre, fim, false);
      const off = k * hn;
      for (let b = 0; b < hn; b++) { pr[off + b] = fre[b]; pi[off + b] = fim[b]; }
    }
    return K;
  }

  /* ---- factory IR synthesis: per-mode recipes (documented in the header). Writes L samples
     into st.genBuf; deterministic from (mode, size, decay, damp, sr) + this module's PRNG. ---- */
  function modeLenS(mode, size) {
    if (mode === 0) return 0.40 + 1.40 * size;      /* plate */
    if (mode === 1) return 0.15 + 0.75 * size;      /* room */
    if (mode === 2) return 0.60 + 1.35 * size;      /* hall */
    if (mode === 3) return 0.25 + 0.85 * size;      /* spring */
    return 0.020 + 0.030 * size;                    /* cab */
  }

  function recipe(st, mode, L, tau) {
    const sr = st.sr, buf = st.genBuf;
    const em = Math.exp(-1 / tau);
    if (mode === 0) {
      /* plate: bright lowpassed noise + 6 fixed early reflections (times scaled by size) */
      const a6 = 1 - Math.exp(-TWO_PI * 6500 / sr);
      const ah = 1 - Math.exp(-TWO_PI * 90 / sr);
      let lp = 0, hp = 0, env = 1;
      for (let n = 0; n < L; n++) {
        const w = genBip(st);
        lp += a6 * (w - lp);
        let v = lp;
        hp += ah * (v - hp);
        v -= hp;
        buf[n] = v * env;
        env *= em;
      }
      const erT = [0.0007, 0.0012, 0.0019, 0.0031, 0.0047, 0.0073];
      const erG = [0.9, -0.7, 0.55, -0.45, 0.35, -0.28];
      const esc = 0.6 + 0.8 * st.size;
      for (let i = 0; i < 6; i++) {
        const idx = Math.round(erT[i] * sr * esc);
        if (idx < L) buf[idx] += erG[i] * 0.45 * Math.exp(-idx / tau);
      }
    } else if (mode === 1) {
      /* room: diffuse layer with a ~20 ms density build + 10 accelerating early reflections */
      const a4 = 1 - Math.exp(-TWO_PI * 4200 / sr);
      const buildK = 1 - Math.exp(-1 / (0.02 * sr));
      let lp = 0, env = 1, bld = 0;
      for (let n = 0; n < L; n++) {
        bld += (1 - bld) * buildK;
        const w = genBip(st);
        lp += a4 * (w - lp);
        buf[n] = lp * bld * env * 0.8;
        env *= em;
      }
      for (let k = 0; k < 10; k++) {
        const pos = Math.round(sr * (0.004 + k * k * 0.0011));
        if (pos < L) {
          const sgn = (k & 1) ? -1 : 1;
          buf[pos] += sgn * 0.7 * Math.pow(0.78, k) * Math.exp(-pos / tau);
        }
      }
    } else if (mode === 2) {
      /* hall: slow ~55 ms density build, two cascaded 3.4 kHz one-poles, 4 subtle reflections */
      const aH = 1 - Math.exp(-TWO_PI * 3400 / sr);
      const buildK = 1 - Math.exp(-1 / (0.055 * sr));
      let lp1 = 0, lp2 = 0, env = 1, bld = 0;
      for (let n = 0; n < L; n++) {
        bld += (1 - bld) * buildK;
        const w = genBip(st);
        lp1 += aH * (w - lp1);
        lp2 += aH * (lp1 - lp2);
        buf[n] = lp2 * bld * env * 0.9;
        env *= em;
      }
      const erT = [0.008, 0.013, 0.021, 0.031];
      const erG = [0.6, -0.45, 0.35, -0.25];
      for (let i = 0; i < 4; i++) {
        const idx = Math.round(erT[i] * sr);
        if (idx < L) buf[idx] += erG[i] * 0.4 * Math.exp(-idx / tau);
      }
    } else if (mode === 3) {
      /* spring: sparse alternating impulses smeared by a 6-stage allpass cascade (c = 0.62) */
      for (let n = 0; n < L; n++) buf[n] = 0;
      const nImp = 26;
      const step = (0.9 * L) / nImp;
      for (let k = 0; k < nImp; k++) {
        const u1 = genUnit(st), u2 = genUnit(st), u3 = genUnit(st);
        const pos = Math.round(0.0009 * sr + k * step * (0.7 + 0.6 * u1) + u2 * 0.0008 * sr);
        if (pos < L) {
          const sgn = (k & 1) ? -1 : 1;
          const g = 0.9 * Math.pow(0.72, k) * (0.6 + 0.5 * u3) * sgn;
          buf[pos] += g * Math.exp(-pos / tau);
        }
      }
      const C_AP = 0.62;
      for (let s6 = 0; s6 < 6; s6++) {
        let x1 = 0, y1 = 0;
        for (let n = 0; n < L; n++) {
          const xc = buf[n];
          const yv = C_AP * xc + x1 - C_AP * y1;
          buf[n] = yv;
          x1 = xc;
          y1 = yv;
        }
      }
      const aS = 1 - Math.exp(-TWO_PI * 5200 / sr);
      let lp = 0, env = 1;
      for (let n = 0; n < L; n++) {
        const w = genBip(st);
        lp += aS * (w - lp);
        buf[n] += lp * env * 0.05;
        env *= em;
      }
    } else {
      /* cab: 7 damped sinusoidal modes + a 6 ms noise burst + a direct tap */
      for (let n = 0; n < L; n++) buf[n] = 0;
      const F = [88, 132, 187, 253, 342, 610, 1290];
      for (let k = 0; k < 7; k++) {
        const A = (0.9 / (1 + k * 0.55)) * (0.8 + 0.4 * genUnit(st));
        const f = F[k] * (1 + 0.04 * (genUnit(st) - 0.5));
        const tk = L / (2.2 + k * 1.4);
        const ek = Math.exp(-1 / tk);
        const ph = genUnit(st) * TWO_PI;
        let env = 1;
        for (let n = 0; n < L; n++) {
          buf[n] += A * Math.sin(TWO_PI * f * n / sr + ph) * env;
          env *= ek;
        }
      }
      const aN = 1 - Math.exp(-TWO_PI * 3000 / sr);
      const burstN = Math.min(L, Math.round(0.006 * sr));
      let lp = 0;
      for (let n = 0; n < burstN; n++) {
        const w = genBip(st);
        lp += aN * (w - lp);
        buf[n] += 0.35 * lp * (1 - n / (0.006 * sr));
      }
      buf[0] += 0.7;
    }
  }

  /* damp pass: `stages` one-pole lowpasses with a = 1 - 0.9*damp^2 (in place, streaming) */
  function dampPass(st, mode, L) {
    const a = 1 - DAMP_SPAN * st.damp * st.damp;
    const stages = (mode === 1 || mode === 2) ? 2 : 1;
    const buf = st.genBuf;
    for (let s = 0; s < stages; s++) {
      let y = 0;
      for (let n = 0; n < L; n++) {
        y += a * (buf[n] - y);
        buf[n] = y;
      }
    }
  }

  function scaleParts(st, K, g) {
    const n = K * FFT_HN;
    const a1 = st.prL, a2 = st.piL, a3 = st.prR, a4 = st.piR;
    for (let i = 0; i < n; i++) { a1[i] *= g; a2[i] *= g; a3[i] *= g; a4[i] *= g; }
  }

  /* generate the factory IR for the CURRENT (modeId, size, decay, damp, sr) and arm it. */
  function genFactory(st) {
    const mode = st.modeId;
    const L = Math.round(cl(modeLenS(mode, st.size) * st.sr, 64, st.maxIr));
    const tau = L / (3 + 9 * st.decay);
    let e0 = 0, e1 = 0;
    for (let ch = 0; ch < 2; ch++) {
      genReseed(st, mode, ch);
      recipe(st, mode, L, tau);
      dampPass(st, mode, L);
      let e = 0;
      const buf = st.genBuf;
      for (let n = 0; n < L; n++) { const v = buf[n]; e += v * v; }
      const K = partitionize(st, ch, buf, L);
      st.irK = K;
      if (ch === 0) e0 = e; else e1 = e;
    }
    let g = Math.sqrt(2 / (e0 + e1));
    if (!isFinite(g) || g <= 0) g = 1;
    scaleParts(st, st.irK, g);
    st.irLen = L;
    st.irLenOrig = L;
    st.irTrunc = 0;
    st.irK = Math.ceil(L / P);
    st.irName = "factory:" + MODES[mode];
    st.fDirty = 0;
    st.pendMs = 0;
    st.lastGenMs = Date.now();
    armIR(st, st.irK);
  }

  /* M1 parent decision -- drag coalescing: a UI drag sends one change per pointer move and a
     regen per move stalls the audio thread (measured 4.6-9 ms @48k, ~29 ms @96k). The first
     change after 120 ms of quiet rebuilds immediately; changes inside a burst only mark the IR
     dirty, and process() flushes the rebuild once the burst has settled (150 ms since the last
     change). Mode picks and conv.on keep their immediate rebuilds. */
  function scheduleGen(st) {
    const now = Date.now();
    st.pendMs = now;
    st.fDirty = 1;
    if (now - st.lastGenMs >= 120) genFactory(st);
  }

  /* ---- params (fx.conv.*; unknown path or bad value -> false, never throws) ---- */
  function setParam(st, path, value) {
    if (!st || typeof path !== "string") return false;
    let p = path;
    if (p.slice(0, 3) === "fx.") p = p.slice(3);
    switch (p) {
      case "conv.mode": {
        const i = MODES.indexOf(String(value));
        if (i < 0) return false;
        if (i === M_USER) {
          st.modeId = M_USER;
          st.mode = MODES[M_USER];
          if (st.userReady) {
            /* (re)partition from the stored user copy -- the bank may hold factory spectra */
            const L = st.irLen;
            partitionize(st, 0, st.urL, L);
            partitionize(st, 1, st.urR, L);
            st.irK = Math.ceil(L / P);
            st.irName = st.userName || st.irName;
            armIR(st, st.irK);
          }
        } else {
          st.modeId = i;
          st.mode = MODES[i];
          genFactory(st);
        }
        return true;
      }
      case "conv.on": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.on = n ? 1 : 0;
        if (st.fDirty && st.modeId !== M_USER) genFactory(st);
        return true;
      }
      case "conv.mix": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.mix = cl(n, 0, 1);
        return true;
      }
      case "conv.size": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        const v = cl(n, 0, 1);
        const ch = v !== st.size;
        st.size = v;
        if (ch && st.modeId !== M_USER) scheduleGen(st);
        return true;
      }
      case "conv.decay": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        const v = cl(n, 0, 1);
        const ch = v !== st.decay;
        st.decay = v;
        if (ch && st.modeId !== M_USER) scheduleGen(st);
        return true;
      }
      case "conv.damp": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        const v = cl(n, 0, 1);
        const ch = v !== st.damp;
        st.damp = v;
        if (ch && st.modeId !== M_USER) scheduleGen(st);
        return true;
      }
      default: return false;
    }
  }

  /* ---- loadImpulse: accept a PRE-RESAMPLED impulse (never resampled here).
     loadImpulse(st, name, rate, ch1, ch2) -> boolean. ch2 null/undefined = mono (both
     channels use ch1). Also tolerates the object form loadImpulse(st, name, {rate, ch1, ch2}).
     The copy lands in the preallocated user buffers; the partition bank is only touched when
     mode "user" is currently active -- switching to user later re-partitions from the copy. */
  function loadImpulse(st, name, rate, ch1, ch2) {
    if (!st) return false;
    if (rate && typeof rate === "object") {
      const o = rate;
      rate = o.rate;
      ch1 = o.ch1;
      ch2 = o.ch2;
    }
    const r = Number(rate);
    if (!isFinite(r) || r <= 0) return false;
    if (Math.abs(r - st.sr) > 0.01 * st.sr) return false;         /* not pre-resampled to sr */
    if (!isF64Like(ch1)) return false;
    const n1 = ch1.length | 0;
    if (n1 < 1) return false;
    let n2 = n1;
    const has2 = (ch2 !== null && ch2 !== undefined);
    if (has2) {
      if (!isF64Like(ch2)) return false;
      n2 = ch2.length | 0;
      if (n2 < 1) return false;
    }
    const L = Math.min(n1, n2, st.maxIr);
    if (L < 1) return false;
    const trunc = (n1 > st.maxIr || (has2 && n2 > st.maxIr) || (has2 && n2 !== n1)) ? 1 : 0;
    for (let i = 0; i < L; i++) {
      let v = ch1[i];
      if (!(v >= -MAX_X && v <= MAX_X)) v = 0;                    /* NaN-proofing */
      st.urL[i] = v;
      let u = has2 ? ch2[i] : v;
      if (!(u >= -MAX_X && u <= MAX_X)) u = 0;
      st.urR[i] = u;
    }
    st.irLen = L;
    st.irLenOrig = Math.max(n1, has2 ? n2 : n1);
    st.irTrunc = trunc;
    st.userName = String(name == null ? "" : name);
    st.irName = st.userName;
    st.userReady = 1;
    if (st.modeId === M_USER) {
      partitionize(st, 0, st.urL, L);
      partitionize(st, 1, st.urR, L);
      st.irK = Math.ceil(L / P);
      armIR(st, st.irK);
    }
    return true;
  }

  function isF64Like(v) {
    return !!v && typeof v === "object" && typeof v.length === "number" && v.length > 0 &&
      typeof v.BYTES_PER_ELEMENT === "number" &&
      (v.BYTES_PER_ELEMENT === 8 || v.BYTES_PER_ELEMENT === 4);
  }

  /* ---- one output block: window transform, partition multiply-accumulate, inverse ----
     called once per completed block (P calls), never allocates. */
  function blockCompute(st) {
    const kK = st.kAct;
    const slot = st.blk;
    const hn = FFT_HN, mask = MASK_N, w = st.w;
    const free = st.fRe, fimm = st.fIm;

    /* window = last FFT_N samples, oldest first */
    for (let i = 0; i < FFT_N; i++) { free[i] = st.inL[(w - FFT_N + i) & mask]; fimm[i] = 0; }
    fftCore(free, fimm, false);
    let off = slot * hn;
    for (let b = 0; b < hn; b++) { st.xrL[off + b] = free[b]; st.xiL[off + b] = fimm[b]; }

    for (let i = 0; i < FFT_N; i++) { free[i] = st.inR[(w - FFT_N + i) & mask]; fimm[i] = 0; }
    fftCore(free, fimm, false);
    for (let b = 0; b < hn; b++) { st.xrR[off + b] = free[b]; st.xiR[off + b] = fimm[b]; }

    /* left channel product-accumulate over the partition bank */
    const are = st.aRe, aim = st.aIm;
    are.fill(0); aim.fill(0);
    for (let j = 0; j < kK; j++) {
      let s = slot - j;
      if (s < 0) s += kK;
      const xo = s * hn, ho = j * hn;
      for (let b = 0; b < hn; b++) {
        const xr = st.xrL[xo + b], xi = st.xiL[xo + b];
        const hr = st.prL[ho + b], hi = st.piL[ho + b];
        are[b] += xr * hr - xi * hi;
        aim[b] += xr * hi + xi * hr;
      }
    }
    for (let b = 1; b < FFT_N2; b++) { are[FFT_N - b] = are[b]; aim[FFT_N - b] = -aim[b]; }
    fftCore(are, aim, true);
    for (let i = 0; i < P; i++) st.obL[i] = are[P + i];

    /* right channel */
    are.fill(0); aim.fill(0);
    for (let j = 0; j < kK; j++) {
      let s = slot - j;
      if (s < 0) s += kK;
      const xo = s * hn, ho = j * hn;
      for (let b = 0; b < hn; b++) {
        const xr = st.xrR[xo + b], xi = st.xiR[xo + b];
        const hr = st.prR[ho + b], hi = st.piR[ho + b];
        are[b] += xr * hr - xi * hi;
        aim[b] += xr * hi + xi * hr;
      }
    }
    for (let b = 1; b < FFT_N2; b++) { are[FFT_N - b] = are[b]; aim[FFT_N - b] = -aim[b]; }
    fftCore(are, aim, true);
    for (let i = 0; i < P; i++) st.obR[i] = are[P + i];

    st.blk += 1;
    if (st.blk >= kK) st.blk = 0;
  }

  /* ---- the per-sample path (alloc-free) ---- */
  function process(st, xL, xR) {
    if (st.on === 0 || st.mix <= 0) { st.oL = xL; st.oR = xR; return; }
    if (st.fDirty && st.modeId !== M_USER && (st.pendMs === 0 || Date.now() - st.pendMs >= 150)) genFactory(st);          /* safety net: once (trailing flush after a param burst) */
    if (st.modeId === M_USER && !st.userReady) {
      /* honest dry pass; hostile non-finite/huge inputs are sanitised exactly like the wet
         path (finite inputs pass through bit-identically) */
      if (!(xL >= -MAX_X && xL <= MAX_X)) xL = 0;
      if (!(xR >= -MAX_X && xR <= MAX_X)) xR = 0;
      st.oL = xL; st.oR = xR;
      return;
    }
    if (!(xL >= -MAX_X && xL <= MAX_X)) xL = 0;
    if (!(xR >= -MAX_X && xR <= MAX_X)) xR = 0;

    st.inL[st.w] = xL;
    st.inR[st.w] = xR;
    st.w = (st.w + 1) & MASK_N;

    st.phase += 1;
    if (st.phase >= P) {
      st.phase = 0;
      blockCompute(st);
      st.drain = 0;
    }
    st.oL = st.obL[st.drain];
    st.oR = st.obR[st.drain];
    st.drain += 1;
    if (st.drain >= P) st.drain = 0;
  }

  /* ---- readout snapshot (allocates; message/readout time only) ---- */
  function snap(st) {
    if (!st) return null;
    const ready = (st.modeId === M_USER) ? st.userReady : (st.fDirty ? 0 : 1);
    return {
      version: VERSION,
      prefix: PREFIX,
      sr: st.sr,
      on: st.on,
      mix: st.mix,
      mode: st.mode,
      modeId: st.modeId,
      size: st.size,
      decay: st.decay,
      damp: st.damp,
      irName: st.irName || "",
      irLen: st.irLen,
      irLenOrig: st.irLenOrig,
      irTrunc: st.irTrunc,
      irK: st.irK,
      partition: P,
      fft: FFT_N,
      latency: P - 1,
      latencyMs: (P - 1) * 1000 / st.sr,
      maxIr: st.maxIr,
      kMax: st.kMax,
      userReady: st.userReady,
      ready: ready,
      wet: 1,
    };
  }

  return {
    version: VERSION,
    VERSION: VERSION,
    PREFIX: PREFIX,
    createState: createState,
    bindEngine: bindEngine,
    reset: reset,
    setParam: setParam,
    process: process,
    loadImpulse: loadImpulse,
    snap: snap,
  };
})();
if (typeof AVDSP !== "undefined" && typeof AVDSP.registerFx === "function") AVDSP.registerFx("conv", AVFXCONV);
