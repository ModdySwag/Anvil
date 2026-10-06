/* av_dsp.js -- Anvil P1 voice engine: pure DSP kernels + the voice pool.
   Contract: verify/_p1_wave.md section 3 (halfband decimator, exact algorithm) and section 4
   (av_dsp interface pin). One text, three scopes: bundled in the single-file app (the SPN tier
   calls it directly), concatenated into the audio-worklet module with av_voiceproc.js (build.py),
   and loaded verbatim by node scratch rigs. LAWS (do not drift):
   - exactly ONE top-level name (`AVDSP`); the build's strict node --check must stay quiet.
   - no page/global-scope reach-ins of any kind: this file text runs verbatim inside the audio
     scope, where none of them exist.
   - AVDSP.render() allocates nothing: no objects, arrays, closures or strings per call; every
     voice field is initialised in create() so the voice shape stays monomorphic.
   - ONE seeded xorshift32 PRNG per engine (unison phases + noise + S&H): same boot + same patch +
     same note order gives bit-identical renders (the null/alias rigs rely on it).
   - voice core runs at 2x (osc + filter + sub + noise); the per-voice halfband decimator converts
     to base rate; amp env + LFO step at base rate. Nothing in absolute Hz-samples.
   - parameters: verify/_p1_wave.md section 4.2 is the single source of truth. Unknown path ->
     setParam returns false, never throws. */
"use strict";

const AVDSP = (function () {

  /* ---- constants ---- */
  const VERSION = "p1.0";
  const OS = 2;                                  /* voice-core oversampling factor */
  const TAU = Math.PI * 2;
  const SINE_N = 4096;                           /* sine LUT entries */
  const WT_N = 2048;                             /* wavetable frame samples */
  const WT_LEVELS = 11;                          /* mip levels k = 0..10 */
  const WT_NAMES = ["wt.saw", "wt.square", "wt.tri", "wt.sine", "wt.pulse25"];
  const OSC1_TYPES = ["saw", "square", "pulse", "tri", "sine"];
  const FILTER_MODES = ["lp12", "lp24", "bp", "hp"];
  const SUB_WAVES = ["square", "sine"];
  const LFO_SHAPES = ["sine", "tri", "square", "sh"];
  /* halfband ship set: order 6, 3+3 allpass sections (research/engine/hb-coeffs.json) */
  const HB_A = new Float64Array([0.0500126042527, 0.364414899325, 0.735773412262]);
  const HB_B = new Float64Array([0.183957727747, 0.554852766862, 0.909374288911]);

  /* ---- module tables (built once by buildTables) ---- */
  let tablesBuilt = false;
  const sineTab = new Float64Array(SINE_N + 1);
  const wtBank = [];
  const fftRe = new Float64Array(WT_N);
  const fftIm = new Float64Array(WT_N);

  /* ---- small helpers (never called inside render's voice loop unless stated) ---- */
  function cl(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function mapEnum(value, list) {
    const i = list.indexOf(String(value));
    return i;
  }

  /* two-point polyBLEP, exact form pinned by the contract (section 4.3) */
  function polyBLEP(t, dt) {
    if (t < dt) { t /= dt; return 2 * (t - t * t / 2 - 0.5); }
    if (t > 1 - dt) { t = (t - 1) / dt; return t * t + 2 * t + 1; }
    return 0;
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
    out.hash = ("00000000" + h.toString(16)).slice(-8);
    return out;
  }

  /* ---- voice construction (every field initialised here: monomorphic shape) ---- */
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
      sa0: 0, sa1: 0, sa2: 0, sb0: 0, sb1: 0, sb2: 0, bPrev: 0,
      ic1a: 0, ic2a: 0, ic1b: 0, ic2b: 0,
      a1: 0, a2: 0, a3: 0, fk: 2,
      e1Stage: 0, e1Val: 0, e1Astep: 0, e1Dc: 0, e1Rc: 0, e1S: 0,
      e2Stage: 0, e2Val: 0, e2Astep: 0, e2Dc: 0, e2Rc: 0, e2S: 0,
      lfoPhase: 0, lfoVal: 0, shVal: 0,
      fade: 0, fadeStep: 0,
      pending: 0, pendingMidi: -1, pendingVel: 0, pendingStart: 0,
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
      osc1Tune: 0, tune1F: 1, osc1Uni: 1, osc1Spread: 12,
      osc2Tune: 0, tune2F: 1, osc2Uni: 1, osc2Spread: 12,
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
    };
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
        eng.tune1F = Math.pow(2, eng.osc1Tune / 12);
        eng.pitchGen++;
        return true;
      }
      case "osc1.uni": { const n = Number(value); if (!isFinite(n)) return false; eng.osc1Uni = cl(Math.round(n), 1, 7); return true; }
      case "osc1.spread": { const n = Number(value); if (!isFinite(n)) return false; eng.osc1Spread = cl(n, 0, 50); return true; }
      case "osc2.type": {
        const e = mapEnum(value, WT_NAMES);
        if (e < 0) return false;
        eng.osc2Type = e;
        return true;
      }
      case "osc2.level": { const n = Number(value); if (!isFinite(n)) return false; eng.tOsc2Level = cl(n, 0, 1); return true; }
      case "osc2.tune": {
        const n = Number(value); if (!isFinite(n)) return false;
        eng.osc2Tune = cl(n, -24, 24);
        eng.tune2F = Math.pow(2, eng.osc2Tune / 12);
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
      default: return false;
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
    const st = (v.pitch - 69) + eng.bend + eng.tune + 0.5 * eng.lfoToPitch * v.lfoVal;
    let f = 440 * Math.pow(2, st / 12);
    if (f > eng.fLim) f = eng.fLim;                      /* safety: keeps increments < 0.5 */
    v.inc1 = f * eng.tune1F / eng.fs2;
    v.inc2 = f * eng.tune2F / eng.fs2;
    v.incSub = f / (2 * eng.fs2);
    let k = Math.ceil(Math.log2(3072 * v.inc2));         /* contract 4.3 mip select */
    if (k > 10) k = 10; else if (k < 0) k = 0;
    v.mip2 = k;
    for (let i = 0; i < v.uni1; i++) v.inc1v[i] = v.inc1 * v.det1[i];
    for (let i = 0; i < v.uni2; i++) v.inc2v[i] = v.inc2 * v.det2[i];
    v.pitchGen = eng.pitchGen;
  }

  function reinitVoice(eng, v, midi, gain, start) {
    v.state = 1;
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
    /* decimator + filter states */
    v.sa0 = 0; v.sa1 = 0; v.sa2 = 0;
    v.sb0 = 0; v.sb1 = 0; v.sb2 = 0;
    v.bPrev = 0;
    v.ic1a = 0; v.ic2a = 0; v.ic1b = 0; v.ic2b = 0;
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
    computePitch(eng, v);
  }

  function releaseVoice(eng, v) {
    v.pending = 0;
    v.state = 2;
    v.e1Stage = 4;
    v.e2Stage = 4;
    if (v.fadeStep < 0) v.fadeStep = 1 / eng.fadeInSamples;   /* cancel a steal fade-out */
  }

  /* ---- notes ---- */
  function noteOn(eng, midi, gain) {
    const m = Number(midi);
    if (!isFinite(m)) return false;
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
      if (held === m) { v = w; break; }
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
      reinitVoice(eng, v, m, g, start);
      return true;
    }
    if (v.state === 3 && v.pendingMidi === m) {
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
    v.fadeStep = -1 / eng.fadeOutSamples;
    if (!same) eng.stolen++;
    return true;
  }

  function noteOff(eng, midi) {
    const m = Number(midi);
    if (!isFinite(m)) return;
    const vs = eng.voices;
    for (let i = 0; i < eng.maxVoices; i++) {
      const v = vs[i];
      if (v.state === 1 && v.noteMidi === m) { releaseVoice(eng, v); return; }
    }
    for (let i = 0; i < eng.maxVoices; i++) {
      const v = vs[i];
      if (v.state === 3 && v.pendingMidi === m) { releaseVoice(eng, v); return; }
    }
  }

  function allOff(eng) {
    const vs = eng.voices;
    for (let i = 0; i < eng.maxVoices; i++) {
      const v = vs[i];
      if (v.state === 1 || v.state === 3) releaseVoice(eng, v);
    }
  }

  /* ---- render --- */

  /* one 2x-rate sample of the voice core: osc mix -> SVF (contract 4.3) */
  function voiceStep2x(eng, v) {
    let o1 = 0;
    const t1 = eng.osc1Type, u1 = v.uni1, ph1 = v.ph1, inc1v = v.inc1v;
    if (t1 === 0) {
      for (let i = 0; i < u1; i++) {
        const tt = ph1[i], dt = inc1v[i];
        o1 += 2 * tt - 1 - polyBLEP(tt, dt);
        let nn = tt + dt; if (nn >= 1) nn -= 1;
        ph1[i] = nn;
      }
    } else if (t1 === 1) {
      for (let i = 0; i < u1; i++) {
        const tt = ph1[i], dt = inc1v[i];
        o1 += (tt < 0.5 ? 1 : -1) - polyBLEP(tt, dt) + polyBLEP((tt + 0.5) % 1, dt);
        let nn = tt + dt; if (nn >= 1) nn -= 1;
        ph1[i] = nn;
      }
    } else if (t1 === 2) {
      const pw = eng.cPw;
      for (let i = 0; i < u1; i++) {
        const tt = ph1[i], dt = inc1v[i];
        o1 += (tt < pw ? 1 : -1) - polyBLEP(tt, dt) + polyBLEP((tt + 1 - pw) % 1, dt);
        let nn = tt + dt; if (nn >= 1) nn -= 1;
        ph1[i] = nn;
      }
    } else if (t1 === 3) {
      for (let i = 0; i < u1; i++) {
        const tt = ph1[i], dt = inc1v[i];
        o1 += 1 - 4 * Math.abs(tt - 0.5);                       /* naive tri (upgrade lever) */
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
    o1 *= v.uni1Gain * eng.cOsc1Level;
    /* osc2 -- wavetable mip, cubic read */
    let o2 = 0;
    const frame = wtBank[eng.osc2Type * WT_LEVELS + v.mip2];
    const u2 = v.uni2, ph2 = v.ph2, inc2v = v.inc2v;
    for (let i = 0; i < u2; i++) {
      const tt = ph2[i], dt = inc2v[i];
      o2 += wtRead(frame, tt);
      let nn = tt + dt; if (nn >= 1) nn -= 1;
      ph2[i] = nn;
    }
    o2 *= v.uni2Gain * eng.cOsc2Level;
    /* sub -- polyBLEP square (or LUT sine) at f/2 */
    let so = 0;
    if (eng.cSubLevel > 0) {
      const tt = v.phSub, dt = v.incSub;
      if (eng.subWave === 1) so = sineLut(tt);
      else so = (tt < 0.5 ? 1 : -1) - polyBLEP(tt, dt) + polyBLEP((tt + 0.5) % 1, dt);
      let nn = tt + dt; if (nn >= 1) nn -= 1;
      v.phSub = nn;
      so *= eng.cSubLevel;
    }
    /* noise -- engine PRNG, bipolar */
    let nz = 0;
    if (eng.cNoiseLevel > 0) nz = prngBip(eng) * eng.cNoiseLevel;
    const x = o1 + o2 + so + nz;
    /* TPT SVF (T5 section 11), one stage; lp24 cascades a second stage */
    let v3 = x - v.ic2a;
    const v1 = v.a1 * v.ic1a + v.a2 * v3;
    const v2 = v.ic2a + v.a2 * v.ic1a + v.a3 * v3;
    v.ic1a = 2 * v1 - v.ic1a;
    v.ic2a = 2 * v2 - v.ic2a;
    const mo = eng.filterMode;
    if (mo === 1) {
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

  /* filter coefficients: recomputed at least every 16 output samples (tan hoisting) */
  function recomputeFilter(eng, v) {
    const l2 = eng.cCutoffLog2 + eng.cEnvAmt * v.e2Val + 2 * eng.lfoToCut * v.lfoVal + eng.ktrk * v.ktrkOct;
    let fc = Math.pow(2, l2);
    if (fc < 10) fc = 10; else if (fc > eng.fcMax) fc = eng.fcMax;
    const g = Math.tan(Math.PI * fc / eng.fs2);
    const k = 2 - 1.98 * eng.cReso;
    const a1 = 1 / (1 + g * (g + k));
    v.a1 = a1;
    v.a2 = g * a1;
    v.a3 = g * g * a1;
    v.fk = k;
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
  }

  /* one output-sample frame of one voice; returns its contribution (amp-scaled) */
  function voiceFrame(eng, v) {
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
    /* pitch-dependent updates: while gliding, while pitch-routed, or on a pitch change */
    if (v.gliding || eng.lfoToPitch !== 0 || v.pitchGen !== eng.pitchGen) computePitch(eng, v);
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
        if (v.pending === 1) reinitVoice(eng, v, v.pendingMidi, v.pendingVel, v.pendingStart);
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
    for (let i = 0; i < n; i++) {
      stepSmoothing(eng);
      let sum = 0;
      for (let vi = 0; vi < maxV; vi++) {
        const v = voices[vi];
        if (v.state === 0) continue;
        sum += voiceFrame(eng, v);
      }
      const out = sum * eng.cOutScale;
      outL[i] = out;
      outR[i] = out;
      eng.osCount++;
    }
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
  };
})();
