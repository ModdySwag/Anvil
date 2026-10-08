/* av_dsp.js -- Anvil P1 voice engine: pure DSP kernels + the voice pool.
   Contract: verify/_p1_wave.md section 3 (halfband decimator, exact algorithm) and section 4
   (av_dsp interface pin); P1.x minBLEP wave: verify/_p1x_blep_wave.md (sections 2-3).
   One text, three scopes: bundled in the single-file app (the SPN tier calls it directly),
   concatenated into the audio-worklet module with av_voiceproc.js (build.py), and loaded
   verbatim by node scratch rigs. LAWS (do not drift):
   - exactly ONE top-level name (`AVDSP`); the build's strict node --check must stay quiet.
   - no page/global-scope reach-ins of any kind: this file text runs verbatim inside the audio
     scope, where none of them exist.
   - AVDSP.render() allocates nothing: no objects, arrays, closures or strings per call; every
     voice field is initialised in create() so the voice shape stays monomorphic.
   - ONE seeded xorshift32 PRNG per engine (unison phases + noise + S&H): same boot + same patch +
     same note order gives bit-identical renders (the null/alias rigs rely on it).
   - voice core runs at 2x (osc + filter + sub + noise); the per-voice halfband decimator converts
     to base rate; amp env + LFO step at base rate. Nothing in absolute Hz-samples.
   - VA saw/square/pulse/sub-square are the minBLEP "Classic" oscillator (P1.x): naive waveform
     plus a band-limited step residual deposited into a per-slot correction ring; the ring's read
     trails the deposit by the half-table span W (a fixed ~0.33 ms oscillator latency, inaudible,
     and identical across all VA slots). tri/sine/WT stay as they were.
   - parameters: verify/_p1_wave.md section 4.2 is the single source of truth. Unknown path ->
     setParam returns false, never throws.
   - P2 (verify/_p2_wave.md section 2): KIND_MODS/registerKind + AVLADDER are the sanctioned
     cross-module refs (guarded typeof); kind voices own their full per-sample chain via
     stepVoice; v.kindId routes per note; engine.kind + drum.split routing; ladder24 + filter.drive.
   - P3 (verify/_p3_wave.md sections 2/4/5/6): FX_MODS/registerFx + the post-mix chain
     (drive -> mod -> delay -> verb -> dyn; per-module convention: drive/verb/dyn write WET and
     the parent blends dry*(1-mix)+wet*mix; mod/delay write their FINAL mix and the parent
     copies); kind ids widen to 1..5 (grain = 4, sampler = 5); eng.samples[4] + eng.zones(40)
     written at message time; eng.modMacros[8]/modSlots[128] with the v1 mod application
     (recomputeFilter / computePitch cadence). */
"use strict";

const AVDSP = (function () {

  /* ---- constants ---- */
  const VERSION = "p3.0";   /* P3: FX chain + mod matrix + grain/sampler kinds (1..5) */
  const OS = 2;                                  /* voice-core oversampling factor */
  const TAU = Math.PI * 2;
  const SINE_N = 4096;                           /* sine LUT entries */
  const WT_N = 2048;                             /* wavetable frame samples */
  const WT_LEVELS = 11;                          /* mip levels k = 0..10 */
  const WT_NAMES = ["wt.saw", "wt.square", "wt.tri", "wt.sine", "wt.pulse25"];
  const OSC1_TYPES = ["saw", "square", "pulse", "tri", "sine"];
  const FILTER_MODES = ["lp12", "lp24", "bp", "hp", "ladder24"];   /* P2: 5th = Moog ladder */
  const SUB_WAVES = ["square", "sine"];
  const LFO_SHAPES = ["sine", "tri", "square", "sh"];
  /* halfband ship set: order 8, 4+4 allpass sections (P1.x decimator swap, contract 3c).
     Was order 6 (3+3) from research/engine/hb-coeffs.json; the P1.x study (hb_design.py --study)
     showed the 4+4 alternative is +22.1 dB (mean) deeper over 24-27 kHz with a flatter passband
     (-0.13 dB @ 23.5k vs -0.5), and the node harness then improved every VA row by ~4-5 dB
     (saw C6 -54.4 -> -59.0 dBc) with zero regressions - so it ships. hb_design.py --study prints
     the search + comparison; the json still labels the old (3,3) set as ship (parent re-labels). */
  const HB_A = new Float64Array([0.830835156043, 0.581828125595, 0.281947153869, 0.0376716808361]);
  const HB_B = new Float64Array([0.140157501378, 0.435551190198, 0.713070914873, 0.942688824121]);

  /* ---- minBLEP "Classic" oscillator constants (P1.x; contract section 2) ----------------
     The band-limited step residual table is built ONCE in buildTables() from first principles
     (own construction, no third-party tables): a Blackman-Harris-windowed sinc lowpass at
     cutoff BLEP_FC * fs2 is cumulative-summed into a step response S(x), normalised so
     S(-inf)=0 / S(+inf)=1, and the residual TAB[sub][i] = S(i - W + sub/SUBS) - [i >= W]
     is sampled at 256 sub-sample positions ("sub") over 2W+1 taps ("i": the sample offsets
     around the discontinuity). At a waveform jump of size J at fractional position p between
     two 2x samples, the oscillator deposits J*TAB into a per-slot ring; the ring is read W
     steps behind the write cursor, which is exactly the half-table lag that lets the pre-edge
     samples of the residual window still be corrected (the classic efficient minBLEP form).
     W=32 (65 taps) / M=128 design: residual truncation at the window edges ~ -57 dB, deposit
     cost only at discontinuities; the design + calibration record lives in the P1.x scratch
     harness (scratch/blep/alias_node.mjs) and the wave report. */
  const BLEP_W = 32;                             /* ring half-span: deposit window = 2W+1 samples */
  const BLEP_N = 2 * BLEP_W + 1;                 /* taps per discontinuity (65) */
  const BLEP_RL = 128;                           /* per-slot ring length (pow2 >= BLEP_N) */
  const BLEP_MASK = BLEP_RL - 1;
  const BLEP_SUBS = 256;                         /* sub-sample positions */
  const BLEP_M = 128;                            /* design taps (window support) */
  const BLEP_FC = 0.229;                         /* design cutoff as a fraction of the 2x rate */
  const WT_TOP = 0.49;                           /* mip margin: top kept harmonic < WT_TOP * base sr */

  /* ---- P2 engine kinds (contract verify/_p2_wave.md section 2) ----
     Kind modules (av_acid/av_string/av_drum) self-register at load. Kind voices own
     osc+filter+env+decimation via stepVoice; shared = pool, steal, velocity, fade, state. */
  const KIND_MODS = [null, null, null, null, null, null];  /* 0 va · 1 acid · 2 string · 3 drum · 4 grain · 5 sampler */
  function registerKind(id, mod) {
    const i = Number(id);
    if (!(i >= 1 && i <= 6) || !mod || typeof mod.stepVoice !== "function") return false;
    KIND_MODS[i] = mod;
    return true;
  }
  function routeKind(eng, midi) {
    let k = eng.kind;
    if (k === 3 && eng.kext && eng.kext.split > 0 && midi >= eng.kext.split) k = 0;
    return k;
  }

  /* S5: kind dispatch resolves user kind modules (av_umod_wl, ids >= 64) through AVUMOD;
     core kinds 1..5 stay the array; unknown id -> null (the voice ends, honest). */
  function kindModOf(id) {
    if (id >= 1 && id <= 6) return KIND_MODS[id];
    try {
      if (typeof AVUMOD !== "undefined" && AVUMOD && typeof AVUMOD.kindById === "function") return AVUMOD.kindById(id);
    } catch (e) { }
    return null;
  }

  /* ---- P3 FX chain (contract verify/_p3_wave.md section 2) ----
     FX modules (av_fx_*.js) self-register at load. Chain order is FIXED:
     drive -> mod -> delay -> verb -> dyn; states are created at AVDSP.create (one per engine)
     and bindEngine(st, eng) runs right after each so sr-derived coefficients are exact.
     Per-module output convention (wave integration flag): drive/verb/dyn write WET (parent
     blends); mod/delay write their FINAL mix (parent copies). st.on === 0 = skipped entirely,
     so the chain is bit-identical to P2 when every module is off. */
  const FX_MODS = [];                                      /* registered modules, index = slot */
  const FX_PREFIX = ["drive", "aw", "mod", "delay", "verb", "conv", "dyn"];
  const FX_WET = [1, 1, 0, 0, 1, 1, 1];                          /* 1 = wet (blend) · 0 = final (copy) */
  function registerFx(prefix, mod) {
    const fi = FX_PREFIX.indexOf(String(prefix));
    if (fi < 0 || !mod || typeof mod.createState !== "function" || typeof mod.process !== "function") return false;
    FX_MODS[fi] = mod;
    return true;
  }

  /* ---- module tables (built once by buildTables) ---- */
  let tablesBuilt = false;
  const sineTab = new Float64Array(SINE_N + 1);
  const wtBank = [];
  const fftRe = new Float64Array(WT_N);
  const fftIm = new Float64Array(WT_N);
  const blepTab = new Float64Array(BLEP_SUBS * BLEP_N);   /* minBLEP residual, [sub][i] */

  /* ---- small helpers (never called inside render's voice loop unless stated) ---- */
  function cl(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function mapEnum(value, list) {
    const i = list.indexOf(String(value));
    return i;
  }

  /* sine LUT, linear interpolation; phase in [0,1) (callers keep it there) */
  function sineLut(phase) {
    const pos = phase * SINE_N;
    const i = pos | 0;
    const f = pos - i;
    const a = sineTab[i];
    return a + (sineTab[i + 1] - a) * f;
  }

  /* cubic (Catmull-Rom) wavetable read at phase in [0,1) */
  function wtRead(frame, phase) {
    const pos = phase * WT_N;
    const i = pos | 0;
    const f = pos - i;
    const p0 = frame[(i) & (WT_N - 1)];
    const p1 = frame[(i + 1) & (WT_N - 1)];
    const p2 = frame[(i + 2) & (WT_N - 1)];
    const p3 = frame[(i + 3) & (WT_N - 1)];
    const c0 = p1;
    const c1 = 0.5 * (p2 - p0);
    const c2 = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
    const c3 = 0.5 * (p3 - p0) + 1.5 * (p1 - p2);
    return ((c3 * f + c2) * f + c1) * f + c0;
  }

  /* engine PRNG: xorshift32 (seed 0x9E3779B9 default). Never zero after seeding. */
  function prngU32(eng) {
    let x = eng.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x = x >>> 0;
    eng.rng = x;
    return x;
  }
  function prngBip(eng) { return prngU32(eng) * 4.656612873077393e-10 - 1; }   /* [-1, 1) */
  function prngUnit(eng) { return prngU32(eng) * 2.3283064365386963e-10; }     /* [0, 1) */

  /* ---- radix-2 FFT (own implementation; inverse normalised by 1/N) ----
     Deterministic, used only by buildTables to synthesise the mip bank. */
  function fftRadix2(re, im, inverse) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (inverse ? TAU : -TAU) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let j2 = 0; j2 < half; j2++) {
          const ar = re[i + j2], ai = im[i + j2];
          const br = re[i + j2 + half], bi = im[i + j2 + half];
          const vr = br * cr - bi * ci;
          const vi = br * ci + bi * cr;
          re[i + j2] = ar + vr; im[i + j2] = ai + vi;
          re[i + j2 + half] = ar - vr; im[i + j2 + half] = ai - vi;
          const nr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = nr;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    }
  }

  /* ---- tables ---- */

  function buildTables() {
    const t0 = Date.now();
    if (!tablesBuilt) {
      /* sine LUT (last entry mirrors the first so +1 reads need no wrap) */
      for (let i = 0; i < SINE_N; i++) sineTab[i] = Math.sin(TAU * i / SINE_N);
      sineTab[SINE_N] = 0;
      /* wavetable mip bank: 5 waves x 11 levels, 2048-sample frames, IFFT synthesis.
         Level k keeps <= 1024/2^k harmonics. All levels of one wave are scaled by the SAME
         factor: level 0 peak-normalised to 0.95, no per-level normalise (contract 4.3). */
      const re = fftRe, im = fftIm;
      for (let w = 0; w < 5; w++) {
        const frames = [];
        for (let k = 0; k < WT_LEVELS; k++) {
          const H = 1024 >> k;
          re.fill(0); im.fill(0);
          for (let h = 1; h <= H; h++) {
            let A = 0, B = 0;
            if (w === 0) {                                   /* wt.saw: all sine, 1/h */
              B = 1 / h;
            } else if (w === 1) {                            /* wt.square: odd sine, 1/h */
              if ((h & 1) === 1) B = 1 / h;
            } else if (w === 2) {                            /* wt.tri: odd, alt-sign, 1/h^2 */
              if ((h & 1) === 1) B = ((h >> 1) & 1) ? -1 / (h * h) : 1 / (h * h);
            } else if (w === 3) {                            /* wt.sine: fundamental only */
              if (h === 1) B = 1;
            } else {                                         /* wt.pulse25: exact duty-25% pulse */
              const th = Math.PI * h * 0.5;                  /* 2*pi*h*0.25; DC bin intentionally 0 */
              A = 2 * Math.sin(th) / (Math.PI * h);
              B = 2 * (1 - Math.cos(th)) / (Math.PI * h);
            }
            if (A !== 0 || B !== 0) {
              /* x[n] = sum A*cos + B*sin  ->  X[h] = N*(A/2 - i*B/2), X[N-h] = conj */
              const hr = WT_N * A / 2;
              const hi = -WT_N * B / 2;
              re[h] += hr; im[h] += hi;
              re[WT_N - h] += hr; im[WT_N - h] -= hi;
            }
          }
          fftRadix2(re, im, true);
          const frame = new Float64Array(WT_N);
          for (let i = 0; i < WT_N; i++) frame[i] = re[i];
          frames.push(frame);
        }
        let peak = 0;
        const f0 = frames[0];
        for (let i = 0; i < WT_N; i++) { const a = Math.abs(f0[i]); if (a > peak) peak = a; }
        const gain = peak > 0 ? 0.95 / peak : 1;
        for (let k = 0; k < WT_LEVELS; k++) {
          const fr = frames[k];
          for (let i = 0; i < WT_N; i++) fr[i] *= gain;
          wtBank[w * WT_LEVELS + k] = fr;
        }
      }
      /* minBLEP residual table (P1.x, contract section 2). Own deterministic construction:
         h[n] = 2*fc*sinc(2*fc*(n - C)) * wBH(n), C = M/2, fc = BLEP_FC (fraction of fs2, so the
         design is sample-rate independent); cumulate h into the step response S and normalise
         S(+-inf) -> 0/1; sample the residual r(x) = S(x) - u(x) at x = i - W + sub/256.
         The peak |r| at the table edges is the residual truncation (~1e-3 here); the matching
         deposit/read scheme in voiceStep2x makes the corrected VA slots equal the naive
         waveform minus its band-limited step error (calibrated by scratch/blep/alias_node.mjs). */
      {
        const M = BLEP_M, C = M / 2;
        const h = new Float64Array(M);
        for (let n = 0; n < M; n++) {
          const d = n - C;
          const sinc = (d === 0) ? 1 : Math.sin(TAU * BLEP_FC * d) / (TAU * BLEP_FC * d);
          const wd = n / (M - 1);
          const wbh = 0.35875 - 0.48829 * Math.cos(TAU * wd) + 0.14128 * Math.cos(2 * TAU * wd)
                    - 0.01168 * Math.cos(3 * TAU * wd);
          h[n] = 2 * BLEP_FC * sinc * wbh;
        }
        const cum = new Float64Array(M + 1);
        for (let n = 0; n < M; n++) cum[n + 1] = cum[n] + h[n];
        const total = cum[M];
        for (let sub = 0; sub < BLEP_SUBS; sub++) {
          const p = sub / BLEP_SUBS;
          const base = sub * BLEP_N;
          for (let i = 0; i < BLEP_N; i++) {
            const xc = i - BLEP_W + p + C;             /* x + C, for the cumsum lookup */
            let S;
            if (xc <= 0) S = 0;
            else if (xc >= M) S = total;
            else { const k = xc | 0; S = cum[k] + (xc - k) * h[k]; }
            blepTab[base + i] = S / total - (i >= BLEP_W ? 1 : 0);
          }
        }
      }
      tablesBuilt = true;
    }
    return { ok: true, ms: Date.now() - t0 };
  }

  /* debug/probe surface for the scratch rigs (determinism evidence: first/peak + FNV hash) */
  function fnvF64(arr, h) {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return h;
  }
  function tableInfo() {
    const out = { built: tablesBuilt, sineFirst: sineTab[0], sinePeak: 0, wt: [], hash: "00000000" };
    if (!tablesBuilt) return out;
    let pk = 0;
    for (let i = 0; i <= SINE_N; i++) { const a = Math.abs(sineTab[i]); if (a > pk) pk = a; }
    out.sinePeak = pk;
    let h = 0x811c9dc5 >>> 0;
    h = fnvF64(sineTab, h);
    for (let w = 0; w < 5; w++) {
      const f0 = wtBank[w * WT_LEVELS];
      let peak = 0;
      for (let i = 0; i < WT_N; i++) { const a = Math.abs(f0[i]); if (a > peak) peak = a; }
      out.wt.push({ name: WT_NAMES[w], first: f0[0], peak: peak });
      for (let k = 0; k < WT_LEVELS; k++) h = fnvF64(wtBank[w * WT_LEVELS + k], h);
    }
    h = fnvF64(blepTab, h);
    out.hash = ("00000000" + h.toString(16)).slice(-8);
    out.blep = { taps: BLEP_N, subs: BLEP_SUBS, mid: blepTab[(BLEP_SUBS >> 1) * BLEP_N + BLEP_W] };
    return out;
  }

  /* ---- voice construction (every field initialised here: monomorphic shape) ---- */
  /* one bank of per-slot minBLEP rings (called only from makeVoice) */
  function blepRingBank(n) {
    const a = new Array(n);
    for (let i = 0; i < n; i++) a[i] = new Float64Array(BLEP_RL);
    return a;
  }

  function makeVoice() {
    return {
      state: 0,                     /* 0 idle · 1 active · 2 released · 3 steal-fading */
      noteMidi: -1,
      vel: 0.9,
      seq: 0,
      pitch: 0, pitchTarget: 0, glideInc: 0, gliding: false,
      pitchGen: -1, ktrkOct: 0,
      inc1: 0, inc2: 0, incSub: 0, mip2: 0,
      uni1: 1, uni2: 1, uni1Gain: 1, uni2Gain: 1,
      det1: new Float64Array(7), det2: new Float64Array(7),
      inc1v: new Float64Array(7), inc2v: new Float64Array(7),
      ph1: new Float64Array(7), ph2: new Float64Array(7), phSub: 0,
      /* minBLEP state (P1.x): per-slot correction rings + delayed-naive buffers, one bank for
         osc1's unison slots and one pair for the sub oscillator; all slots share t2x. */
      bR1: blepRingBank(7), bN1: blepRingBank(7),
      bRS: new Float64Array(BLEP_RL), bNS: new Float64Array(BLEP_RL),
      t2x: 0,
      sa0: 0, sa1: 0, sa2: 0, sb0: 0, sb1: 0, sb2: 0, bPrev: 0,
      ic1a: 0, ic2a: 0, ic1b: 0, ic2b: 0,
      a1: 0, a2: 0, a3: 0, fk: 2,
      e1Stage: 0, e1Val: 0, e1Astep: 0, e1Dc: 0, e1Rc: 0, e1S: 0,
      e2Stage: 0, e2Val: 0, e2Astep: 0, e2Dc: 0, e2Rc: 0, e2S: 0,
      lfoPhase: 0, lfoVal: 0, shVal: 0,
      fade: 0, fadeStep: 0,
      pending: 0, pendingMidi: -1, pendingVel: 0, pendingStart: 0, pendingCh: 0,
      /* P3 mod-matrix per-voice cache (evaluated at the recomputeFilter cadence; 0 = inactive) */
      randVal: 0, modCut: 0, modReso: 0, modPitch: 0, modL1: 0, modL2: 0,
      kindId: 0,                    /* P2/P3: engine kind for the current note (set in reinitVoice) */
      mpeCh: 0, mpeBendApplied: 0,  /* M2: MPE member channel tag (0 = global path) + applied-bend cache */
      k: {},                        /* P2: kind voice-state union (initVoiceK per module, at create) */
      lad: (typeof AVLADDER !== "undefined" && AVLADDER && typeof AVLADDER.createState === "function")
        ? AVLADDER.createState() : null,   /* P2: Moog-ladder state (filter.mode ladder24) */
    };
  }

  /* ---- engine ---- */
  function create(opts) {
    const t0 = Date.now();
    if (!tablesBuilt) buildTables();   /* safety: create() is callable directly (SPN tier, rigs) */
    opts = opts || {};
    let sr = Number(opts.sampleRate);
    if (!isFinite(sr) || sr <= 0) sr = 48000;
    let maxVoices = Number(opts.maxVoices);
    maxVoices = (isFinite(maxVoices) && maxVoices >= 1) ? Math.min(256, Math.floor(maxVoices)) : 64;
    let seed = (opts.seed === undefined || opts.seed === null) ? 0x9E3779B9 : (Number(opts.seed) >>> 0);
    if (seed === 0) seed = 0x9E3779B9;
    const fs2 = sr * OS;
    const voices = new Array(maxVoices);
    for (let i = 0; i < maxVoices; i++) voices[i] = makeVoice();
    const eng = {
      sr: sr, fs2: fs2, maxVoices: maxVoices, voices: voices,
      rng: seed, seq: 0, lastMidi: -1, stolen: 0, msBoot: 0,
      /* enums */
      osc1Type: 0, osc2Type: 0, subWave: 0, filterMode: 1, lfoShape: 0,
      /* smoothed targets/currents (section 4.2) */
      tOsc1Level: 1.0, cOsc1Level: 1.0,
      tPw: 0.5, cPw: 0.5,
      tOsc2Level: 0.5, cOsc2Level: 0.5,
      tSubLevel: 0, cSubLevel: 0,
      tNoiseLevel: 0, cNoiseLevel: 0,
      tCutoffLog2: Math.log2(800), cCutoffLog2: Math.log2(800),
      tReso: 0.3, cReso: 0.3,
      tEnvAmt: 2, cEnvAmt: 2,
      tOutScale: 0.25, cOutScale: 0.25,
      /* plain params */
      osc1Tune: 0, osc1Fine: 0, tune1F: 1, osc1Uni: 1, osc1Spread: 12,
      osc2Tune: 0, osc2Fine: 0, tune2F: 1, osc2Uni: 1, osc2Spread: 12,
      ktrk: 0.5,
      e1a: 0.002, e1d: 0.3, e1s: 0.8, e1r: 0.2,
      e2a: 0.001, e2d: 0.5, e2s: 0.5, e2r: 0.3,
      lfoRate: 5, lfoStep: 5 / sr, lfoToCut: 0, lfoToPitch: 0,
      glide: 0, bend: 0, tune: 0,
      pitchGen: 0,
      /* derived */
      s15: 1 - Math.exp(-1 / (0.015 * sr)),
      s20: 1 - Math.exp(-1 / (0.02 * sr)),
      fadeInSamples: Math.max(1, Math.round(sr * 0.0015)),   /* <=2 ms fresh-note fade-in */
      fadeOutSamples: Math.max(1, Math.round(sr * 0.0015)),  /* >=1 ms steal fade-out */
      fLim: fs2 * 0.45, fcMax: fs2 * 0.225,
      osCount: 0,
      /* bench ring (256 quanta) */
      ring: new Float64Array(256), ringI: 0, ringN: 0, underruns: 0, budgetUs: 128e6 / sr,
      /* P2 kind machinery */
      kind: 0, kext: {}, tDrive: 0, cDrive: 0,
      /* P3: sample registry + zone table + mod matrix + FX chain (message/setup-time writes) */
      samples: [null, null, null, null], zones: new Float64Array(144),
      modMacros: new Float64Array(8), modSlots: new Float64Array(128),
      modCount: 0, modPitchOn: 0, modPanOn: 0,
      fx: [],
      userWt: [],
      mpe: null,
    };
    if (typeof AVM !== "undefined" && AVM && typeof AVM.create === "function") {
      try { eng.mpe = AVM.create(); } catch (e) { eng.mpe = null; }
    }
    for (let kk = 1; kk <= 6; kk++) {
      const m0 = KIND_MODS[kk];
      if (m0 && typeof m0.initEngineK === "function") { try { m0.initEngineK(eng.kext); } catch (e) { } }
    }
    for (let vi0 = 0; vi0 < maxVoices; vi0++) {
      const kv0 = voices[vi0].k;
      for (let kk = 1; kk <= 6; kk++) {
        const m0 = KIND_MODS[kk];
        if (m0 && typeof m0.initVoiceK === "function") { try { m0.initVoiceK(kv0); } catch (e) { } }
      }
    }
    /* P3: build the FX chain exactly once (states + engine binding); order = the fixed slot order */
    for (let fi = 0; fi < FX_PREFIX.length; fi++) {
      const m0 = FX_MODS[fi];
      if (!m0) continue;
      let st0 = null;
      try { st0 = m0.createState({ sampleRate: sr }); } catch (e) { st0 = null; }
      if (!st0) continue;
      if (typeof m0.bindEngine === "function") { try { m0.bindEngine(st0, eng); } catch (e) { } }
      eng.fx.push({ mod: m0, st: st0, wet: FX_WET[fi] });
    }
    eng.msBoot = Date.now() - t0;
    return eng;
  }

  /* ---- parameters: verify/_p1_wave.md section 4.2 (unknown path -> false) ---- */
  function setParam(eng, path, value) {
    switch (path) {
      case "osc1.type": {
        const e = mapEnum(value, OSC1_TYPES);
        if (e < 0) return false;
        eng.osc1Type = e;
        return true;
      }
      case "osc1.level": { const n = Number(value); if (!isFinite(n)) return false; eng.tOsc1Level = cl(n, 0, 1); return true; }
      case "osc1.pw": { const n = Number(value); if (!isFinite(n)) return false; eng.tPw = cl(n, 0.05, 0.95); return true; }
      case "osc1.tune": {
        const n = Number(value); if (!isFinite(n)) return false;
        eng.osc1Tune = cl(n, -24, 24);
        eng.tune1F = Math.pow(2, (eng.osc1Tune + eng.osc1Fine / 100) / 12);
        eng.pitchGen++;
        return true;
      }
      /* R9: oscillator fine tune, ±100 cents, folded into the same tune factor */
      case "osc1.fine": {
        const n = Number(value); if (!isFinite(n)) return false;
        eng.osc1Fine = cl(n, -100, 100);
        eng.tune1F = Math.pow(2, (eng.osc1Tune + eng.osc1Fine / 100) / 12);
        eng.pitchGen++;
        return true;
      }
      case "osc1.uni": { const n = Number(value); if (!isFinite(n)) return false; eng.osc1Uni = cl(Math.round(n), 1, 7); return true; }
      case "osc1.spread": { const n = Number(value); if (!isFinite(n)) return false; eng.osc1Spread = cl(n, 0, 50); return true; }
      case "osc2.type": {
        const e = mapEnum(value, WT_NAMES);
        if (e >= 0) { eng.osc2Type = e; return true; }
        /* M1: user wavetables wt.user0..wt.user15 -> osc2 types 5..20 */
        const um = /^wt\.user(\d{1,2})$/.exec(String(value));
        const un = um ? Number(um[1]) : -1;
        if (un >= 0 && un <= 15) { eng.osc2Type = 5 + un; return true; }
        return false;
      }
      case "osc2.level": { const n = Number(value); if (!isFinite(n)) return false; eng.tOsc2Level = cl(n, 0, 1); return true; }
      case "osc2.tune": {
        const n = Number(value); if (!isFinite(n)) return false;
        eng.osc2Tune = cl(n, -24, 24);
        eng.tune2F = Math.pow(2, (eng.osc2Tune + eng.osc2Fine / 100) / 12);
        eng.pitchGen++;
        return true;
      }
      /* R9: oscillator fine tune, ±100 cents, folded into the same tune factor */
      case "osc2.fine": {
        const n = Number(value); if (!isFinite(n)) return false;
        eng.osc2Fine = cl(n, -100, 100);
        eng.tune2F = Math.pow(2, (eng.osc2Tune + eng.osc2Fine / 100) / 12);
        eng.pitchGen++;
        return true;
      }
      case "osc2.uni": { const n = Number(value); if (!isFinite(n)) return false; eng.osc2Uni = cl(Math.round(n), 1, 7); return true; }
      case "osc2.spread": { const n = Number(value); if (!isFinite(n)) return false; eng.osc2Spread = cl(n, 0, 50); return true; }
      case "sub.level": { const n = Number(value); if (!isFinite(n)) return false; eng.tSubLevel = cl(n, 0, 1); return true; }
      case "sub.wave": {
        const e = mapEnum(value, SUB_WAVES);
        if (e < 0) return false;
        eng.subWave = e;
        return true;
      }
      case "noise.level": { const n = Number(value); if (!isFinite(n)) return false; eng.tNoiseLevel = cl(n, 0, 1); return true; }
      case "filter.mode": {
        const e = mapEnum(value, FILTER_MODES);
        if (e < 0) return false;
        eng.filterMode = e;
        return true;
      }
      case "filter.cutoff": {
        const n = Number(value); if (!isFinite(n)) return false;
        eng.tCutoffLog2 = Math.log2(cl(n, 20, 20000));
        return true;
      }
      case "filter.reso": { const n = Number(value); if (!isFinite(n)) return false; eng.tReso = cl(n, 0, 1); return true; }
      case "filter.envAmt": { const n = Number(value); if (!isFinite(n)) return false; eng.tEnvAmt = cl(n, -4, 4); return true; }
      case "filter.ktrk": { const n = Number(value); if (!isFinite(n)) return false; eng.ktrk = cl(n, 0, 1); return true; }
      case "env1.a": { const n = Number(value); if (!isFinite(n)) return false; eng.e1a = cl(n, 0.001, 4); return true; }
      case "env1.d": { const n = Number(value); if (!isFinite(n)) return false; eng.e1d = cl(n, 0.001, 8); return true; }
      case "env1.s": { const n = Number(value); if (!isFinite(n)) return false; eng.e1s = cl(n, 0, 1); return true; }
      case "env1.r": { const n = Number(value); if (!isFinite(n)) return false; eng.e1r = cl(n, 0.001, 8); return true; }
      case "env2.a": { const n = Number(value); if (!isFinite(n)) return false; eng.e2a = cl(n, 0.001, 4); return true; }
      case "env2.d": { const n = Number(value); if (!isFinite(n)) return false; eng.e2d = cl(n, 0.001, 8); return true; }
      case "env2.s": { const n = Number(value); if (!isFinite(n)) return false; eng.e2s = cl(n, 0, 1); return true; }
      case "env2.r": { const n = Number(value); if (!isFinite(n)) return false; eng.e2r = cl(n, 0.001, 8); return true; }
      case "lfo.shape": {
        const e = mapEnum(value, LFO_SHAPES);
        if (e < 0) return false;
        eng.lfoShape = e;
        return true;
      }
      case "lfo.rate": {
        const n = Number(value); if (!isFinite(n)) return false;
        eng.lfoRate = cl(n, 0.05, 20);
        eng.lfoStep = eng.lfoRate / eng.sr;
        return true;
      }
      case "lfo.toCut": { const n = Number(value); if (!isFinite(n)) return false; eng.lfoToCut = cl(n, -1, 1); return true; }
      case "lfo.toPitch": { const n = Number(value); if (!isFinite(n)) return false; eng.lfoToPitch = cl(n, -1, 1); return true; }
      case "voice.glide": { const n = Number(value); if (!isFinite(n)) return false; eng.glide = cl(n, 0, 2); return true; }
      case "voice.bend": { const n = Number(value); if (!isFinite(n)) return false; eng.bend = cl(n, -12, 12); eng.pitchGen++; return true; }
      case "tune": { const n = Number(value); if (!isFinite(n)) return false; eng.tune = cl(n, -12, 12); eng.pitchGen++; return true; }
      case "engine.outScale": { const n = Number(value); if (!isFinite(n)) return false; eng.tOutScale = cl(n, 0.05, 1); return true; }
      case "engine.kind": {
        const e = mapEnum(value, ["va", "acid", "string", "drum", "grain", "sampler", "fm"]);
        if (e < 0) {
          /* S5: user kind modules accept their name (av_umod_wl registry; ids >= 64) */
          let uk = null;
          try {
            if (typeof AVUMOD !== "undefined" && AVUMOD && typeof AVUMOD.kindIdByName === "function") uk = AVUMOD.kindIdByName(value);
          } catch (e2) { uk = null; }
          if (uk == null) return false;
          eng.kind = uk;
          return true;
        }
        eng.kind = e;
        return true;
      }
      case "filter.drive": { const n = Number(value); if (!isFinite(n)) return false; eng.tDrive = cl(n, 0, 1); return true; }
      default: {
        /* P3 FX params: fx.<prefix>.* dispatch to the registered module state */
        if (path.slice(0, 3) === "fx.") {
          const dot2 = path.indexOf(".", 3);
          if (dot2 > 3) {
            const pre = path.slice(3, dot2);
            for (let j = 0; j < eng.fx.length; j++) {
              const e0 = eng.fx[j];
              if (e0.mod && e0.mod.PREFIX === pre && typeof e0.mod.setParam === "function") {
                try { return e0.mod.setParam(e0.st, path, value) === true; } catch (e) { return false; }
              }
            }
          }
          return false;
        }
        /* P2/P3 kind params: prefix dispatch to the registered module that claims the prefix */
        const dot = path.indexOf(".");
        if (dot > 0) {
          const pre = path.slice(0, dot);
          for (let kk = 1; kk <= 6; kk++) {
            const m0 = KIND_MODS[kk];
            if (m0 && m0.PREFIX === pre && typeof m0.setParam === "function") {
              try { return m0.setParam(eng, path, value) === true; } catch (e) { return false; }
            }
          }
          /* S5: user kind modules (av_umod_wl) claim their prefixes here */
          try {
            if (typeof AVUMOD !== "undefined" && AVUMOD && typeof AVUMOD.setKindParam === "function") {
              if (AVUMOD.setKindParam(eng, path, value) === true) return true;
            }
          } catch (e) { }
        }
        return false;
      }
    }
  }

  /* ---- voice lifecycle ---- */

  function setDet(v, arr, u, spreadCents) {
    for (let i = 0; i < 7; i++) {
      if (i < u) {
        arr[i] = (u === 1) ? 1 : Math.pow(2, (spreadCents * (2 * i / (u - 1) - 1)) / 1200);
      } else {
        arr[i] = 1;
      }
    }
  }

  /* pitch (semitones, glide applied) -> per-osc increments + osc2 wavetable mip level */
  function computePitch(eng, v) {
    if (v.gliding) {
      v.pitch += v.glideInc;
      if ((v.glideInc > 0 && v.pitch >= v.pitchTarget) || (v.glideInc < 0 && v.pitch <= v.pitchTarget)) {
        v.pitch = v.pitchTarget;
        v.gliding = false;
      }
    }
    /* pitch is the gliding MIDI note value; normalise to A4=440 Hz (section 4.4 test 5 pins
       midi 69 -> 440 Hz), then bend/tune (semitones) + LFO pitch (+-50 ct at +-1) */
    let st = (v.pitch - 69) + eng.bend + eng.tune + 0.5 * eng.lfoToPitch * v.lfoVal;
    if (v.mpeCh > 0 && eng.mpe && eng.mpe.on && typeof AVM !== "undefined" && AVM) st += AVM.pitchSemis(eng.mpe, v.mpeCh);
    if (v.modPitch !== 0) st += v.modPitch * 12;                  /* P3: pitch ±12 st */
    let f = 440 * Math.pow(2, st / 12);
    if (f > eng.fLim) f = eng.fLim;                      /* safety: keeps increments < 0.5 */
    v.inc1 = f * eng.tune1F / eng.fs2;
    v.inc2 = f * eng.tune2F / eng.fs2;
    v.incSub = f / (2 * eng.fs2);
    let k = Math.ceil(Math.log2(3072 * v.inc2));         /* contract 4.3 base mip select */
    if (k > 10) k = 10; else if (k < 0) k = 0;
    /* P1.x mip margin (contract section 3a): the base rule may leave the top kept harmonic up
       to fs2/3 ~ 32 kHz, i.e. inside the halfband transition band, where partially-attenuated
       content folds back through the decimator (measured pre-fix: WT @A4 -46.8 dBc). Step the
       mip level up until the top harmonic sits below WT_TOP * sr - the decimator's essentially
       flat region (droop < ~0.5 dB) - so nothing can fold. Levels are octave-spaced, so at
       most one bump is ever needed (top halves <= 16 kHz, inside the flat region). */
    while (k < 10 && (1024 >> k) * v.inc2 * eng.fs2 > WT_TOP * eng.sr) k++;
    v.mip2 = k;
    for (let i = 0; i < v.uni1; i++) v.inc1v[i] = v.inc1 * v.det1[i];
    for (let i = 0; i < v.uni2; i++) v.inc2v[i] = v.inc2 * v.det2[i];
    v.pitchGen = eng.pitchGen;
    v.mpeBendApplied = (v.mpeCh > 0 && eng.mpe) ? eng.mpe.chBend[v.mpeCh] : 0;
  }

  function reinitVoice(eng, v, midi, gain, start) {
    v.state = 1;
    v.kindId = routeKind(eng, midi);
    v.noteMidi = midi;
    v.vel = cl(gain, 0.05, 1);
    v.seq = ++eng.seq;
    v.pending = 0; v.pendingMidi = -1; v.pendingVel = 0; v.pendingStart = 0;
    v.pitch = start;
    v.pitchTarget = midi;
    v.gliding = (eng.glide > 0 && start !== midi);
    v.glideInc = v.gliding ? (midi - start) / (eng.glide * eng.sr) : 0;
    v.pitchGen = -1;
    v.ktrkOct = (midi - 60) / 12;
    /* unison: counts + detune factors cached for this note; seeded-random phases */
    v.uni1 = eng.osc1Uni; v.uni2 = eng.osc2Uni;
    v.uni1Gain = 1 / Math.sqrt(v.uni1);
    v.uni2Gain = 1 / Math.sqrt(v.uni2);
    setDet(v, v.det1, v.uni1, eng.osc1Spread);
    setDet(v, v.det2, v.uni2, eng.osc2Spread);
    for (let i = 0; i < 7; i++) { v.ph1[i] = prngUnit(eng); v.ph2[i] = prngUnit(eng); }
    v.phSub = prngUnit(eng);
    v.shVal = prngBip(eng);
    v.randVal = prngBip(eng);      /* P3: per-note rand source for the mod matrix */
    /* decimator + filter states */
    v.sa0 = 0; v.sa1 = 0; v.sa2 = 0;
    v.sb0 = 0; v.sb1 = 0; v.sb2 = 0;
    v.bPrev = 0;
    v.ic1a = 0; v.ic2a = 0; v.ic1b = 0; v.ic2b = 0;
    /* minBLEP: fresh note -> zero every correction ring + delayed-naive buffer, step counter 0 */
    for (let i = 0; i < 7; i++) { v.bR1[i].fill(0); v.bN1[i].fill(0); }
    v.bRS.fill(0); v.bNS.fill(0);
    v.t2x = 0;
    /* envelopes: attack linear at 1/(A*sr) per output sample; decay/release exp to -40 dB */
    v.e1Astep = 1 / (eng.e1a * eng.sr);
    v.e1Dc = Math.exp(-4.6 / (eng.e1d * eng.sr));
    v.e1Rc = Math.exp(-4.6 / (eng.e1r * eng.sr));
    v.e1S = eng.e1s;
    v.e2Astep = 1 / (eng.e2a * eng.sr);
    v.e2Dc = Math.exp(-4.6 / (eng.e2d * eng.sr));
    v.e2Rc = Math.exp(-4.6 / (eng.e2r * eng.sr));
    v.e2S = eng.e2s;
    v.e1Stage = 1; v.e1Val = 0;
    v.e2Stage = 1; v.e2Val = 0;
    /* LFO retriggers at note start; fresh notes fade in (<=2 ms) */
    v.lfoPhase = 0; v.lfoVal = 0;
    v.fade = 0;
    v.fadeStep = 1 / eng.fadeInSamples;
    if (eng.modCount > 0) modEvalVoice(eng, v);   /* P3: seed the mod cache before the first pitch pass */
    computePitch(eng, v);
    /* P2 (contract R2): kind per-note reset AFTER the core fields; AVACID reads v.pitch as the
       slide origin and scans eng.voices for the legato origin. Ladder state resets per note. */
    if (v.lad && typeof AVLADDER !== "undefined" && AVLADDER && typeof AVLADDER.resetState === "function") {
      try { AVLADDER.resetState(v.lad); } catch (e) { }
    }
    if (v.kindId > 0) {
      const m0 = kindModOf(v.kindId);
      if (m0 && typeof m0.initVoice === "function") { try { m0.initVoice(eng, v); } catch (e) { } }
    }
  }

  function releaseVoice(eng, v) {
    v.pending = 0;
    v.state = 2;
    v.e1Stage = 4;
    v.e2Stage = 4;
    if (v.fadeStep < 0) v.fadeStep = 1 / eng.fadeInSamples;   /* cancel a steal fade-out */
    if (v.kindId > 0) {
      const m0 = kindModOf(v.kindId);
      if (m0 && typeof m0.releaseVoice === "function") { try { m0.releaseVoice(eng, v); } catch (e) { } }
    }
  }

  /* ---- notes ---- */
  function noteOn(eng, midi, gain, ch) {
    const m = Number(midi);
    if (!isFinite(m)) return false;
    let mc = Math.floor(Number(ch));
    if (!isFinite(mc) || mc < 0 || mc > 15) mc = 0;
    let g = Number(gain);
    if (!isFinite(g)) g = 1;
    g = cl(g, 0.05, 1);
    let start = m;
    if (eng.glide > 0 && eng.lastMidi >= 0) start = eng.lastMidi;
    const vs = eng.voices;
    const nv = eng.maxVoices;
    let v = null;
    /* (1) same-midi voice (retrigger; includes a pending steal of the same note) */
    for (let i = 0; i < nv; i++) {
      const w = vs[i];
      if (w.state === 0) continue;
      const held = (w.state === 3) ? w.pendingMidi : w.noteMidi;
      const heldCh = (w.state === 3) ? w.pendingCh : w.mpeCh;
      if (held === m && heldCh === mc) { v = w; break; }
    }
    const same = v !== null;
    /* (2) idle */
    if (!v) for (let i = 0; i < nv; i++) { if (vs[i].state === 0) { v = vs[i]; break; } }
    /* (3) oldest released */
    if (!v) {
      let bestSeq = Infinity;
      for (let i = 0; i < nv; i++) { const w = vs[i]; if (w.state === 2 && w.seq < bestSeq) { bestSeq = w.seq; v = w; } }
    }
    /* (4) oldest overall (never a steal-in-flight voice); fallback steals-included */
    if (!v) {
      let bestSeq = Infinity;
      for (let i = 0; i < nv; i++) { const w = vs[i]; if (w.state !== 3 && w.seq < bestSeq) { bestSeq = w.seq; v = w; } }
      if (!v) for (let i = 0; i < nv; i++) { const w = vs[i]; if (w.seq < bestSeq) { bestSeq = w.seq; v = w; } }
    }
    if (!v) return false;
    eng.lastMidi = m;
    if (v.state === 0) {
      v.mpeCh = mc;
      reinitVoice(eng, v, m, g, start);
      return true;
    }
    if (v.state === 3 && v.pendingMidi === m && v.pendingCh === mc) {
      v.pendingVel = g;
      v.pendingStart = start;
      return true;
    }
    /* steal: >=1 ms fade-out, then retrigger (contract 4.3) */
    v.state = 3;
    v.pending = 1;
    v.pendingMidi = m;
    v.pendingVel = g;
    v.pendingStart = start;
    v.pendingCh = mc;
    v.fadeStep = -1 / eng.fadeOutSamples;
    if (!same) eng.stolen++;
    return true;
  }

  function noteOff(eng, midi, ch) {
    const m = Number(midi);
    if (!isFinite(m)) return;
    let mc = Math.floor(Number(ch));
    if (!isFinite(mc) || mc < 0 || mc > 15) mc = 0;
    const vs = eng.voices;
    for (let i = 0; i < eng.maxVoices; i++) {
      const v = vs[i];
      if (v.state === 1 && v.noteMidi === m && v.mpeCh === mc) { releaseVoice(eng, v); return; }
    }
    for (let i = 0; i < eng.maxVoices; i++) {
      const v = vs[i];
      if (v.state === 3 && v.pendingMidi === m && v.pendingCh === mc) { releaseVoice(eng, v); return; }
    }
  }

  function allOff(eng) {
    const vs = eng.voices;
    for (let i = 0; i < eng.maxVoices; i++) {
      const v = vs[i];
      if (v.state === 1 || v.state === 3) releaseVoice(eng, v);
    }
  }

  /* ---- M2: MPE zone + expression (worklet message + SPN call the same paths) ---- */
  function mpeSet(eng, on, bend) {
    if (!eng || !eng.mpe || typeof AVM === "undefined" || !AVM || typeof AVM.setZone !== "function") return false;
    const wasOn = eng.mpe.on;
    const r = AVM.setZone(eng.mpe, on, bend) === true;
    if (r && wasOn && !eng.mpe.on) {
      /* zone off: release every member voice (the page keeps its own held map in sync) */
      const vs = eng.voices;
      for (let i = 0; i < eng.maxVoices; i++) {
        const v = vs[i];
        if (v.state === 1 && v.mpeCh > 0) releaseVoice(eng, v);
        else if (v.state === 3 && v.pendingCh > 0) releaseVoice(eng, v);
      }
    }
    return r;
  }
  function mpeExpr(eng, ch, dim, v) {
    if (!eng || !eng.mpe || typeof AVM === "undefined" || !AVM || typeof AVM.setExpr !== "function") return false;
    return AVM.setExpr(eng.mpe, ch, dim, v) === true;
  }

  /* ---- render --- */

  /* deposit one discontinuity's residual into a slot ring (minBLEP, P1.x contract section 2).
     ring: the slot's correction ring; t: 2x step index of the first post-edge sample; j: the
     naive jump size (after - before); p: edge position as a fraction of the sample interval,
     read as (phase AFTER the edge - edge phase)/increment, so p in [0,1) by construction.
     Entry i lands on sample (t - W + i) at x = i - W + p; samples before the note start
     (t - W + i < 0) are skipped - their reads never happen. */
  function blepDeposit(ring, t, j, p) {
    let sub = (p * BLEP_SUBS) | 0;
    if (sub >= BLEP_SUBS) sub = BLEP_SUBS - 1;
    const base = sub * BLEP_N;
    const i0 = t < BLEP_W ? BLEP_W - t : 0;
    for (let i = i0; i < BLEP_N; i++) {
      const idx = (t - BLEP_W + i) & BLEP_MASK;
      ring[idx] += j * blepTab[base + i];
    }
  }

  /* one 2x-rate sample of the voice core: osc mix -> SVF (contract 4.3).
     VA saw/square/pulse (and the sub square) run the minBLEP "Classic" oscillator: the naive
     value is written into the slot's delayed-naive buffer and read back BLEP_W steps later
     together with the slot's correction ring (which by then holds every edge's residual
     deposit covering that sample); the sum is the band-limited waveform. Deposits run only at
     discontinuities; reads are the flat 1-add/sample part. */
  function voiceStep2x(eng, v) {
    const t = v.t2x;
    v.t2x = t + 1;
    let o1 = 0;
    const t1 = eng.osc1Type, u1 = v.uni1, ph1 = v.ph1, inc1v = v.inc1v;
    if (t1 < 3) {
      const pw = eng.cPw;
      const E = (t1 === 1) ? 0.5 : pw;             /* square edge phase; pulse duty edge */
      const jW = (t1 === 0) ? -2 : 2;              /* saw drops at the wrap; square/pulse rise */
      for (let i = 0; i < u1; i++) {
        const dt = inc1v[i], phOld = ph1[i];
        let ph = phOld + dt;
        const phRaw = ph;
        let pW = -1, pH = -1;
        if (phRaw >= 1) { ph = phRaw - 1; pW = ph / dt; }
        if (t1 !== 0 && phOld < E && phRaw >= E) pH = (phRaw - E) / dt;
        if (pW >= 0) blepDeposit(v.bR1[i], t, jW, pW);
        if (pH >= 0) blepDeposit(v.bR1[i], t, -2, pH);
        const naive = (t1 === 0) ? (2 * ph - 1) : (ph < E ? 1 : -1);
        const nb = v.bN1[i];
        nb[t & BLEP_MASK] = naive;
        if (t >= BLEP_W) {
          const b = (t - BLEP_W) & BLEP_MASK;
          o1 += nb[b] + v.bR1[i][b];
          v.bR1[i][b] = 0;
        }
        ph1[i] = ph;
      }
    } else if (t1 === 3) {
      for (let i = 0; i < u1; i++) {
        const tt = ph1[i], dt = inc1v[i];
        o1 += 1 - 4 * Math.abs(tt - 0.5);                       /* naive tri (unchanged) */
        let nn = tt + dt; if (nn >= 1) nn -= 1;
        ph1[i] = nn;
      }
    } else {
      for (let i = 0; i < u1; i++) {
        const tt = ph1[i], dt = inc1v[i];
        o1 += sineLut(tt);
        let nn = tt + dt; if (nn >= 1) nn -= 1;
        ph1[i] = nn;
      }
    }
    o1 *= v.uni1Gain * ((v.modL1 !== 0) ? cl(eng.cOsc1Level + v.modL1, 0, 1) : eng.cOsc1Level);
    /* osc2 -- wavetable mip, cubic read */
    let o2 = 0;
    const o2t = eng.osc2Type;
    const frame = (o2t < 5)
      ? wtBank[o2t * WT_LEVELS + v.mip2]
      : ((eng.userWt[o2t - 5] && eng.userWt[o2t - 5].frames[v.mip2]) ? eng.userWt[o2t - 5].frames[v.mip2] : wtBank[3 * WT_LEVELS + v.mip2]);
    const u2 = v.uni2, ph2 = v.ph2, inc2v = v.inc2v;
    for (let i = 0; i < u2; i++) {
      const tt = ph2[i], dt = inc2v[i];
      o2 += wtRead(frame, tt);
      let nn = tt + dt; if (nn >= 1) nn -= 1;
      ph2[i] = nn;
    }
    o2 *= v.uni2Gain * ((v.modL2 !== 0) ? cl(eng.cOsc2Level + v.modL2, 0, 1) : eng.cOsc2Level);
    /* sub -- minBLEP square (or LUT sine) at f/2 */
    let so = 0;
    if (eng.cSubLevel > 0) {
      const dt = v.incSub;
      if (eng.subWave === 1) {
        const tt = v.phSub;
        so = sineLut(tt);
        let nn = tt + dt; if (nn >= 1) nn -= 1;
        v.phSub = nn;
      } else {
        const phOld = v.phSub;
        let ph = phOld + dt;
        const phRaw = ph;
        let pW = -1, pH = -1;
        if (phRaw >= 1) { ph = phRaw - 1; pW = ph / dt; }
        if (phOld < 0.5 && phRaw >= 0.5) pH = (phRaw - 0.5) / dt;
        if (pW >= 0) blepDeposit(v.bRS, t, 2, pW);
        if (pH >= 0) blepDeposit(v.bRS, t, -2, pH);
        const naive = (ph < 0.5) ? 1 : -1;
        v.bNS[t & BLEP_MASK] = naive;
        if (t >= BLEP_W) {
          const b = (t - BLEP_W) & BLEP_MASK;
          so = v.bNS[b] + v.bRS[b];
          v.bRS[b] = 0;
        }
        v.phSub = ph;
      }
      so *= eng.cSubLevel;
    }
    /* noise -- engine PRNG, bipolar */
    let nz = 0;
    if (eng.cNoiseLevel > 0) nz = prngBip(eng) * eng.cNoiseLevel;
    let x = o1 + o2 + so + nz;
    /* P2 drive stage: level-normalised soft drive (v1) ahead of both filter families */
    if (eng.cDrive > 0) {
      const dg = 1 + 7 * eng.cDrive;
      const xa = x * dg;
      x = (xa * (27 + xa * xa) / (27 + 9 * xa * xa)) / Math.sqrt(dg);
    }
    /* P2 ladder24: the AVLADDER kernel owns the filter when wired (mode index 4) */
    if (eng.filterMode === 4 && v.lad && typeof AVLADDER !== "undefined" && AVLADDER && typeof AVLADDER.process === "function") {
      return AVLADDER.process(v.lad, x, v.lad.g, v.lad.k);
    }
    /* TPT SVF (T5 section 11), one stage; lp24 cascades a second stage */
    let v3 = x - v.ic2a;
    const v1 = v.a1 * v.ic1a + v.a2 * v3;
    const v2 = v.ic2a + v.a2 * v.ic1a + v.a3 * v3;
    v.ic1a = 2 * v1 - v.ic1a;
    v.ic2a = 2 * v2 - v.ic2a;
    const mo = eng.filterMode;
    if (mo === 1 || mo === 4) {   /* 4 = ladder24 fallback when AVLADDER is absent */
      v3 = v2 - v.ic2b;
      const w1 = v.a1 * v.ic1b + v.a2 * v3;
      const w2 = v.ic2b + v.a2 * v.ic1b + v.a3 * v3;
      v.ic1b = 2 * w1 - v.ic1b;
      v.ic2b = 2 * w2 - v.ic2b;
      return w2;
    }
    if (mo === 0) return v2;
    if (mo === 2) return v1;
    return x - v.fk * v1 - v2;
  }

  /* ---- P3 mod matrix (contract verify/_p3_wave.md section 4; v1 application) ----
     Wire: avEngineMod -> eng.modMacros[8] (0..1) + eng.modSlots[128] ([srcIdx, dstIdx, amt, curve] x32).
     v1 evaluation lives at the recomputeFilter / computePitch cadence:
       per-voice targets — cutoff ±4 oct · reso ±0.5 · pitch ±12 st · osc1/osc2 levels ±1;
       engine target — pan ±1 (block-rate, MACRO sources only: per-voice sources have no
       engine-wide value; v1 decision, recorded in the wave report/harness).
     Sources (indices pinned by av_mod.js): 0 env1 · 1 env2 · 2 lfo1 · 3 vel · 4 key · 5 rand ·
     6..13 macro1..8; key = (midi-60)/24 clamped ±1; rand = the per-note v.randVal draw.
     Curves: 0 linear · 1 sign(x)*x^2 · 2 sign(x)*smoothstep(|x|). All-zero slot = inactive. */
  function modCurve(c, x) {
    if (c === 1 || c === 2) {
      const neg = x < 0;
      let a = neg ? -x : x;
      if (a > 1) a = 1;
      const y = (c === 1) ? a * a : a * a * (3 - 2 * a);
      return neg ? -y : y;
    }
    return x;
  }
  function modSrcVal(eng, v, i) {
    switch (i | 0) {
      case 0: return v.e1Val;
      case 1: return v.e2Val;
      case 2: return v.lfoVal;
      case 3: return v.vel;
      case 4: { const kx = (v.noteMidi - 60) / 24; return kx < -1 ? -1 : (kx > 1 ? 1 : kx); }
      case 5: return v.randVal;
      default: { const mi = i - 6; return (mi >= 0 && mi < 8) ? eng.modMacros[mi] : 0; }
    }
  }
  /* one pass over the slots -> the per-voice cache (recomputeFilter cadence, alloc-free) */
  function modEvalVoice(eng, v) {
    let cut = 0, reso = 0, pit = 0, l1 = 0, l2 = 0;
    const s = eng.modSlots;
    for (let i = 0; i < 32; i++) {
      const o = i * 4;
      const amt = s[o + 2];
      if (amt === 0) continue;
      const d = s[o + 1] | 0;
      const val = amt * modCurve(s[o + 3] | 0, modSrcVal(eng, v, s[o] | 0));
      if (d === 0) cut += val;
      else if (d === 1) reso += val;
      else if (d === 2) pit += val;
      else if (d === 3) l1 += val;
      else if (d === 4) l2 += val;
    }
    v.modCut = cut; v.modReso = reso; v.modPitch = pit; v.modL1 = l1; v.modL2 = l2;
  }
  /* engine-level pan value (block-rate): macro sources only in v1 */
  function modPanEval(eng) {
    let p = 0;
    const s = eng.modSlots;
    for (let i = 0; i < 32; i++) {
      const o = i * 4;
      const amt = s[o + 2];
      if (amt === 0 || (s[o + 1] | 0) !== 5) continue;
      const src = s[o] | 0;
      if (src < 6 || src > 13) continue;
      p += amt * modCurve(s[o + 3] | 0, eng.modMacros[src - 6]);
    }
    return p;
  }

  /* filter coefficients: recomputed at least every 16 output samples (tan hoisting) */
  function recomputeFilter(eng, v) {
    /* P3: refresh the mod-matrix cache at this cadence (no-op when the matrix is empty) */
    if (eng.modCount > 0) modEvalVoice(eng, v);
    let cutBase = eng.cCutoffLog2;
    if (v.mpeCh > 0 && eng.mpe && eng.mpe.on && typeof AVM !== "undefined" && AVM) {
      const tb = AVM.cutBase(eng.mpe, v.mpeCh);
      if (tb >= 0) cutBase = tb;
    }
    let l2 = cutBase + eng.cEnvAmt * v.e2Val + 2 * eng.lfoToCut * v.lfoVal + eng.ktrk * v.ktrkOct;
    if (v.mpeCh > 0 && eng.mpe && eng.mpe.on && typeof AVM !== "undefined" && AVM) l2 += AVM.atOct(eng.mpe, v.mpeCh);
    if (v.modCut !== 0) l2 += v.modCut * 4;                       /* cutoff ±4 oct */
    let fc = Math.pow(2, l2);
    if (fc < 10) fc = 10; else if (fc > eng.fcMax) fc = eng.fcMax;
    const g = Math.tan(Math.PI * fc / eng.fs2);
    let baseK = eng.cReso;
    if (v.modReso !== 0) { baseK += v.modReso * 0.5; baseK = cl(baseK, 0, 1); }   /* reso ±0.5 */
    const k = 2 - 1.98 * baseK;
    const a1 = 1 / (1 + g * (g + k));
    v.a1 = a1;
    v.a2 = g * a1;
    v.a3 = g * g * a1;
    v.fk = k;
    /* P2: keep the ladder kernel's coeffs in step (mode ladder24) */
    if (eng.filterMode === 4 && v.lad && typeof AVLADDER !== "undefined" && AVLADDER && typeof AVLADDER.setCoeffs === "function") {
      AVLADDER.setCoeffs(v.lad, fc, eng.fs2, eng.cReso);
    }
  }

  function stepSmoothing(eng) {
    eng.cOsc1Level += (eng.tOsc1Level - eng.cOsc1Level) * eng.s15;
    eng.cPw += (eng.tPw - eng.cPw) * eng.s15;
    eng.cOsc2Level += (eng.tOsc2Level - eng.cOsc2Level) * eng.s15;
    eng.cSubLevel += (eng.tSubLevel - eng.cSubLevel) * eng.s15;
    eng.cNoiseLevel += (eng.tNoiseLevel - eng.cNoiseLevel) * eng.s15;
    eng.cCutoffLog2 += (eng.tCutoffLog2 - eng.cCutoffLog2) * eng.s15;
    eng.cReso += (eng.tReso - eng.cReso) * eng.s15;
    eng.cEnvAmt += (eng.tEnvAmt - eng.cEnvAmt) * eng.s20;
    eng.cOutScale += (eng.tOutScale - eng.cOutScale) * eng.s20;
    eng.cDrive += (eng.tDrive - eng.cDrive) * eng.s15;   /* P2 filter drive */
  }

  /* one output-sample frame of one voice; returns its contribution (amp-scaled) */
  function voiceFrame(eng, v) {
    /* P2 kind path: the module owns osc/filter/env/decimation; shared = vel + fade + steal;
       released kind voices end when the module says done (strings decay out, drums one-shot). */
    if (v.kindId > 0) {
      const m0 = kindModOf(v.kindId);
      if (!m0) { v.state = 0; return 0; }
      const y0 = m0.stepVoice(eng, v);
      if (v.state === 3) {
        v.fade += v.fadeStep;
        if (v.fade <= 0) {
          if (v.pending === 1) { v.mpeCh = v.pendingCh; reinitVoice(eng, v, v.pendingMidi, v.pendingVel, v.pendingStart); }
          else {
            v.fade = 0; v.state = 2;
            if (typeof m0.releaseVoice === "function") { try { m0.releaseVoice(eng, v); } catch (e) { } }
            v.fadeStep = 1 / eng.fadeInSamples;
          }
        }
      } else if (v.fade < 1) {
        v.fade += v.fadeStep;
        if (v.fade > 1) v.fade = 1;
      }
      if (v.state === 2 && typeof m0.isVoiceDone === "function" && m0.isVoiceDone(eng, v)) v.state = 0;
      return y0 * v.vel * v.fade;
    }
    /* envelopes: gate-less (held until noteOff); one step per output sample */
    if (v.e1Stage === 1) {
      v.e1Val += v.e1Astep;
      if (v.e1Val >= 1) { v.e1Val = 1; v.e1Stage = 2; }
    } else if (v.e1Stage === 2) {
      v.e1Val = v.e1S + (v.e1Val - v.e1S) * v.e1Dc;
      if (v.e1Val - v.e1S < 1e-5) { v.e1Val = v.e1S; v.e1Stage = 3; }
    } else if (v.e1Stage === 4) {
      v.e1Val *= v.e1Rc;
      if (v.e1Val < 1e-4) { v.e1Val = 0; v.e1Stage = 0; if (v.pending !== 1) v.state = 0; }
    }
    if (v.e2Stage === 1) {
      v.e2Val += v.e2Astep;
      if (v.e2Val >= 1) { v.e2Val = 1; v.e2Stage = 2; }
    } else if (v.e2Stage === 2) {
      v.e2Val = v.e2S + (v.e2Val - v.e2S) * v.e2Dc;
      if (v.e2Val - v.e2S < 1e-5) { v.e2Val = v.e2S; v.e2Stage = 3; }
    } else if (v.e2Stage === 4) {
      v.e2Val *= v.e2Rc;
      if (v.e2Val < 1e-4) { v.e2Val = 0; v.e2Stage = 0; }
    }
    /* LFO: retrigger at note start; one step per output sample */
    let ph = v.lfoPhase + eng.lfoStep;
    while (ph >= 1) { ph -= 1; if (eng.lfoShape === 3) v.shVal = prngBip(eng); }
    v.lfoPhase = ph;
    let lv;
    if (eng.lfoShape === 0) lv = sineLut(ph);
    else if (eng.lfoShape === 1) lv = ph < 0.25 ? 4 * ph : (ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4);
    else if (eng.lfoShape === 2) lv = ph < 0.5 ? 1 : -1;
    else lv = v.shVal;
    v.lfoVal = lv;
    /* pitch-dependent updates: while gliding, while pitch-routed (LFO or matrix), or on a pitch change */
    if (v.gliding || eng.lfoToPitch !== 0 || eng.modPitchOn !== 0 || v.pitchGen !== eng.pitchGen
        || (v.mpeCh > 0 && eng.mpe && v.mpeBendApplied !== eng.mpe.chBend[v.mpeCh])) computePitch(eng, v);
    if ((eng.osCount & 15) === 0) recomputeFilter(eng, v);
    /* two 2x internal steps -> halfband decimator (exact algorithm, contract section 3) */
    const s0 = voiceStep2x(eng, v);
    const s1 = voiceStep2x(eng, v);
    let va = s0, t;
    t = HB_A[0] * va + v.sa0; v.sa0 = va - HB_A[0] * t; va = t;
    t = HB_A[1] * va + v.sa1; v.sa1 = va - HB_A[1] * t; va = t;
    t = HB_A[2] * va + v.sa2; v.sa2 = va - HB_A[2] * t; va = t;
    let vb = s1;
    t = HB_B[0] * vb + v.sb0; v.sb0 = vb - HB_B[0] * t; vb = t;
    t = HB_B[1] * vb + v.sb1; v.sb1 = vb - HB_B[1] * t; vb = t;
    t = HB_B[2] * vb + v.sb2; v.sb2 = vb - HB_B[2] * t; vb = t;
    const y = 0.5 * (va + v.bPrev);
    v.bPrev = vb;
    /* steal fade-out (>=1 ms) then retrigger; fresh notes keep fading in (<=2 ms) */
    if (v.state === 3) {
      v.fade += v.fadeStep;
      if (v.fade <= 0) {
        if (v.pending === 1) { v.mpeCh = v.pendingCh; reinitVoice(eng, v, v.pendingMidi, v.pendingVel, v.pendingStart); }
        else { v.fade = 0; v.state = 2; v.e1Stage = 4; v.e2Stage = 4; v.fadeStep = 1 / eng.fadeInSamples; }
      }
    } else if (v.fade < 1) {
      v.fade += v.fadeStep;
      if (v.fade > 1) v.fade = 1;
    }
    return y * v.e1Val * v.vel * v.fade;
  }

  function render(eng, outL, outR, n) {
    if (!(n > 0)) return;
    const voices = eng.voices;
    const maxV = eng.maxVoices;
    const fx = eng.fx;
    /* P3 engine-level pan (matrix dst 'pan', macro-driven, block-rate; equal-power gains) */
    let panL = 1, panR = 1;
    if (eng.modPanOn !== 0) {
      let p = modPanEval(eng);
      if (p !== 0) {
        if (p > 1) p = 1; else if (p < -1) p = -1;
        panL = Math.cos((p + 1) * Math.PI * 0.25);
        panR = Math.sin((p + 1) * Math.PI * 0.25);
      }
    }
    for (let i = 0; i < n; i++) {
      stepSmoothing(eng);
      let sum = 0, sumL = 0, sumR = 0;
      const mpePan = (eng.mpe && eng.mpe.on !== 0 && eng.mpe.panAny !== 0 && typeof AVM !== "undefined" && AVM) ? 1 : 0;
      for (let vi = 0; vi < maxV; vi++) {
        const v = voices[vi];
        if (v.state === 0) continue;
        const y0 = voiceFrame(eng, v);
        if (mpePan !== 0 && v.mpeCh > 0 && eng.mpe.chPan[v.mpeCh] !== 0) {
          const pg = AVM.panGains(eng.mpe, v.mpeCh);
          sumL += y0 * pg[0];
          sumR += y0 * pg[1];
        } else sum += y0;
      }
      let l = (sum + sumL) * eng.cOutScale;
      let r = (sum + sumR) * eng.cOutScale;
      /* P3 post-mix FX chain (fixed order built at create; off modules are skipped entirely) */
      for (let fi = 0; fi < fx.length; fi++) {
        const e0 = fx[fi];
        const st = e0.st;
        if (st.on === 0) continue;
        e0.mod.process(st, l, r);
        if (e0.wet === 1) {
          const mix = st.mix;
          if (mix >= 1) { l = st.oL; r = st.oR; }
          else if (mix > 0) {
            const dry = 1 - mix;
            l = l * dry + st.oL * mix;
            r = r * dry + st.oR * mix;
          }
          /* mix <= 0: the module passed the input through; keep l/r untouched */
        } else {
          l = st.oL;
          r = st.oR;
        }
      }
      if (panL !== 1) outL[i] = l * panL; else outL[i] = l;
      if (panR !== 1) outR[i] = r * panR; else outR[i] = r;
      eng.osCount++;
    }
  }

  /* ---- P3 message handlers (worklet port + SPN facade call the SAME paths) ----
     {t:'sample'}: allocate AT MESSAGE TIME (render stays alloc-free); slot shape pinned:
     null | { name, rate, n, ch1, ch2 } — ch2 null = mono; a replaced slot frees the old arrays.
     {t:'zones'}: copy into eng.zones (8 zones x [lo, hi, root, buf, vol]).
     {t:'mod'}: copy into eng.modMacros/modSlots + recount the active-slot flags. */
  function setSample(eng, id, name, rate, ch1, ch2) {
    const i = Number(id);
    if (!(i >= 0 && i <= 3) || !ch1 || typeof ch1.length !== "number" || ch1.length <= 0) return false;
    const n = ch1.length | 0;
    const r = Number(rate);
    eng.samples[i | 0] = {
      name: String(name == null ? "" : name),
      rate: (isFinite(r) && r > 0) ? r : eng.sr,
      n: n,
      ch1: ch1,
      ch2: (ch2 && typeof ch2.length === "number" && ch2.length >= n) ? ch2 : null,
    };
    return true;
  }
  function setZones(eng, zones) {
    if (!zones || typeof zones.length !== "number") return false;
    const L = zones.length | 0;
    /* M2 zone v2: 144 = 16 x 9 (lo, hi, root, buf, vol, s0, s1, fIn, fOut) — read by av_sampler;
       the legacy 40 = 8 x 5 v1 table is CONVERTED to v2 (full windows, no fades) right here. */
    if (L === 144) {
      for (let i = 0; i < 144; i++) { const z = Number(zones[i]); eng.zones[i] = isFinite(z) ? z : 0; }
      return true;
    }
    if (L === 40) {
      for (let i = 0; i < 8; i++) {
        const o5 = i * 5, o9 = i * 9;
        for (let k5 = 0; k5 < 5; k5++) { const z = Number(zones[o5 + k5]); eng.zones[o9 + k5] = isFinite(z) ? z : 0; }
        eng.zones[o9 + 5] = 0;    /* s0  */
        eng.zones[o9 + 6] = 1;    /* s1  */
        eng.zones[o9 + 7] = 0;    /* fIn */
        eng.zones[o9 + 8] = 0;    /* fOut */
      }
      for (let i = 72; i < 144; i++) eng.zones[i] = 0;
      return true;
    }
    return false;
  }
  function setUserWt(eng, slot, name, frames) {
    const i = Number(slot);
    if (!(i >= 0 && i <= 15) || !frames || typeof frames.length !== "number" || frames.length !== 11) return false;
    const bank = [];
    for (let k = 0; k < 11; k++) {
      const f = frames[k];
      if (!f || typeof f.length !== "number" || f.length !== 2048) return false;
      bank.push(f);
    }
    eng.userWt[i] = { name: String(name == null ? "" : name), frames: bank };
    return true;
  }
  function setConvImpulse(eng, id, name, rate, ch1, ch2) {
    for (let j = 0; j < eng.fx.length; j++) {
      const e0 = eng.fx[j];
      if (e0.mod && e0.mod.PREFIX === "conv" && typeof e0.mod.loadImpulse === "function") {
        try { return e0.mod.loadImpulse(e0.st, name, rate, ch1, ch2) === true; } catch (e) { return false; }
      }
    }
    return false;
  }
  function setMod(eng, macros, slots) {
    if (macros && typeof macros.length === "number") {
      const n = Math.min(8, macros.length);
      for (let i = 0; i < n; i++) { const x = Number(macros[i]); eng.modMacros[i] = isFinite(x) ? cl(x, 0, 1) : 0; }
      for (let i = n; i < 8; i++) eng.modMacros[i] = 0;
    }
    if (slots && typeof slots.length === "number") {
      const n = Math.min(128, slots.length);
      for (let i = 0; i < n; i++) {
        let x = Number(slots[i]);
        if (!isFinite(x)) x = 0;
        const m4 = i & 3;
        if (m4 === 2) x = cl(x, -1, 1);
        else if (m4 === 3) x = cl(Math.round(x), 0, 2);
        eng.modSlots[i] = x;
      }
      for (let i = n; i < 128; i++) eng.modSlots[i] = 0;
    }
    let cnt = 0, pit = 0, pan = 0;
    for (let i = 0; i < 32; i++) {
      const o = i * 4;
      const amt = eng.modSlots[o + 2];
      if (amt === 0) continue;
      cnt++;
      const d = eng.modSlots[o + 1] | 0;
      if (d === 2) pit = 1;
      else if (d === 5) pan = 1;
    }
    /* matrix emptied: clear every voice's cached contributions (they would otherwise persist) */
    if (cnt === 0) {
      for (let vi = 0; vi < eng.maxVoices; vi++) {
        const v2 = eng.voices[vi];
        v2.modCut = 0; v2.modReso = 0; v2.modPitch = 0; v2.modL1 = 0; v2.modL2 = 0;
      }
    }
    eng.modCount = cnt; eng.modPitchOn = pit; eng.modPanOn = pan;
    return true;
  }

  /* ---- stats / bench ---- */
  function stats(eng) {
    let active = 0, released = 0;
    const vs = eng.voices;
    for (let i = 0; i < eng.maxVoices; i++) {
      const s = vs[i].state;
      if (s === 1 || s === 3) active++;
      else if (s === 2) released++;
    }
    return {
      active: active, released: released, total: active + released,
      maxVoices: eng.maxVoices, sr: eng.sr, os: OS, stolen: eng.stolen, msBoot: eng.msBoot,
      uwt: (eng.userWt || []).filter(Boolean).length,
      fxChain: eng.fx.map(function (e0) { return e0.mod && e0.mod.PREFIX; }).join(" "),
      mpe: (eng.mpe ? { on: eng.mpe.on, bend: eng.mpe.bendRange, active: (typeof AVM !== "undefined" && AVM && typeof AVM.activeCount === "function") ? AVM.activeCount(eng.mpe) : 0 } : null),
    };
  }

  function benchReset(eng) {
    eng.ringI = 0;
    eng.ringN = 0;
    eng.underruns = 0;
    for (let i = 0; i < 256; i++) eng.ring[i] = 0;
  }

  /* store the LAST 256 per-quantum durations (us, per-128-frame equivalent) */
  function recordQuantum(eng, us, frames) {
    let u = Number(us);
    if (!isFinite(u) || u < 0) u = 0;
    let fr = Number(frames);
    if (!(fr > 0)) fr = 128;
    const norm = u * 128 / fr;
    eng.ring[eng.ringI] = norm;
    eng.ringI = (eng.ringI + 1) & 255;
    eng.ringN++;
    if (norm > eng.budgetUs) eng.underruns++;
  }

  function benchRead(eng) {
    const ring = eng.ring;
    const filled = eng.ringN < 256 ? eng.ringN : 256;
    const out = new Array(256);
    for (let i = 0; i < 256; i++) {
      if (eng.ringN >= 256) out[i] = ring[(eng.ringI + i) & 255];   /* chronological */
      else out[i] = i < filled ? ring[i] : 0;
    }
    const vals = out.slice(0, filled).sort((a, b) => a - b);
    let mean = 0, p95 = 0, max = 0;
    if (filled > 0) {
      let s = 0;
      for (let i = 0; i < filled; i++) s += vals[i];
      mean = s / filled;
      p95 = vals[Math.min(filled - 1, Math.ceil(0.95 * filled) - 1)];
      max = vals[filled - 1];
    }
    return { n: eng.ringN, meanUs: mean, p95Us: p95, maxUs: max, underruns: eng.underruns, ring: out };
  }

  /* ---- the one top-level return ---- */
  return {
    version: VERSION,
    buildTables: buildTables,
    tableInfo: tableInfo,
    create: create,
    noteOn: noteOn,
    noteOff: noteOff,
    allOff: allOff,
    setParam: setParam,
    render: render,
    stats: stats,
    benchReset: benchReset,
    benchRead: benchRead,
    recordQuantum: recordQuantum,
    /* P2 additive surface (contract section 2.2) */
    registerKind: registerKind,
    blep: { W: BLEP_W, N: BLEP_N, RL: BLEP_RL, MASK: BLEP_MASK, SUBS: BLEP_SUBS, tab: blepTab, deposit: blepDeposit },
    /* P3 additive surface (verify/_p3_wave.md sections 2/4/5/6) */
    registerFx: registerFx,
    setSample: setSample,
    setZones: setZones,
    setMod: setMod,
    setUserWt: setUserWt,
    setConvImpulse: setConvImpulse,
    /* M2 additive surface (verify/_m2_wave.md sections 2.1/4.3) */
    mpeSet: mpeSet,
    mpeExpr: mpeExpr,
  };
})();
