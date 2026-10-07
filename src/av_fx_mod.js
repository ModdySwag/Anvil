/* av_fx_mod.js -- Anvil P3 FX module: modulation FX in ONE module, mode-switched:
   chorus (single modulated tap, antiphase stereo) · ensemble (3 taps/side, phase-spread) ·
   flanger (short modulated tap + signed feedback, quadrature stereo) · phaser (4/6/8 first-order
   allpass stages, modulated break frequency, feedback). Child B, wave P3.
   Contract: verify/_p3_wave.md section 2.1 (FX module interface) + section 3.2 (this module).
   MIRRORS the P2 kind-module registration pattern (verify/_p2_wave.md section 2.1): ONE
   top-level name, self-registration at load, guarded so a build without registerFx still loads.

   LAWS (carried from P1/P2, do not drift):
   - worklet-safe: strict mode, no page/global-scope reach-ins of any kind (this text runs
     verbatim inside the audio scope, where none of them exist), ONE top-level name (AVFXMOD).
   - alloc-free render: the delay lines and stage arrays are allocated in createState() only;
     process() writes scalars into the preallocated state, never objects/arrays/closures.
   - no NaN: setParam rejects non-finite values; feedback is hard-bounded to +-0.95 (< 1 loop
     gain around a unity-magnitude allpass chain / delay line), so no growth and no blow-up.
   - seeded determinism: fully deterministic (LFO starts at phase 0 on reset).

   INTERFACE (pinned by the wave contract):
     VERSION = "p3.0" · PREFIX = "mod"
     createState(opts) -> st     allocates delay lines + phaser stage arrays (ONLY allocation);
                                 opts.sampleRate (or opts.sr) picks the rate, default 48000
     reset(st)                   zeroes lines/states/LFO phase, snaps coefficients
     bindEngine(st, eng)         optional parent hook; stores st.eng and re-tunes to eng.sr when
                                 it differs from the create default (setup-time only)
     setParam(st, path, v)       handles "fx.mod.*" only; true on accept, false otherwise
     process(st, xL, xR)         ONE stereo sample; result in st.oL / st.oR (no return value)

   OUTPUT CONVENTION (module-side final mix, section 2.2 "module-side responsibility"):
     st.oL / st.oR carry the module's FINAL output = dry*(1-mix) + wet*mix, computed HERE (wet =
     the mode's modulated/allpass signal, dry = input). At mix=0 the output is a bit-identical
     copy of the input (explicit branch); at mix=1 it is the pure wet signal. The chain owner
     COPIES st.oL/st.oR; do not blend a second time.

   PARAMS (fx.mod.*): mode enum chorus|ensemble|flanger|phaser · rate 0.05..10 Hz ·
   depth 0..1 (modulation excursion; 0 = static delay / static phaser) · feedback -0.95..0.95
   (flanger + phaser only; ignored by chorus/ensemble) · stages 4|6|8 (phaser only, default 6) ·
   on 0|1 (default 0) · mix 0..1 (default 0.5). Defaults: mode "chorus" · rate 0.6 Hz ·
   depth 0.5 · feedback 0.
   Stereo LFO: chorus/ensemble R = L + 0.5 cycles (antiphase); flanger/phaser R = L + 0.25
   (quadrature).

   DSP NOTES:
   - chorus: D = 18 ms +- 6 ms*depth (40 Hz..24 ms usable). ensemble: 3 taps/side at
     16/22/28 ms +- 5 ms*depth, LFO phases 0/1/3/2/3 cycles (+0.5 for R), summed * 1/3.
   - flanger: D = 2.5 ms +- 2.2 ms*depth (0.3..4.7 ms at depth 1); feedback from the previous
     delayed sample, signed.
   - phaser: first-order allpass stage y = -a*x + z, z = x + a*y (H = (z^-1 - a)/(1 - a z^-1));
     a = (1-t)/(1+t), t = tan(pi*fc/fs) puts the stage -90 deg break at exactly fc (verified in
     the harness probe). fc = 700 Hz * 2^(1.8*depth*sin) -> 200..2.4 kHz at depth 1; coefficients
     refresh every 16 samples (control rate); feedback around the whole stage chain.
   - delay reads use linear fractional interpolation (modulated delays; allpass interp is for
     the fixed-delay module); continuous delay trajectories = no zipper. */

"use strict";

const AVFXMOD = (function () {
  const VERSION = "p3.0";
  const PREFIX = "mod";

  /* ---- pins ---- */
  const MODES = ["chorus", "ensemble", "flanger", "phaser"];
  const RATE_MIN = 0.05, RATE_MAX = 10;
  const FB_MIN = -0.95, FB_MAX = 0.95;
  const STAGES_OK = [4, 6, 8];
  const CAP_S = 0.06;                 /* delay-line span: covers ensemble 28 ms + 5 ms + pad */
  const MIN_D = 2;
  const SR3 = 0.8660254037844386;     /* sin(2*pi/3) for the ensemble phase offsets */
  const CH_D0 = 0.018, CH_A = 0.006;  /* chorus base +- excursion (s) */
  const EN_BASE = [0.016, 0.022, 0.028], EN_A = 0.005;
  const FL_D0 = 0.0025, FL_A = 0.0022;
  const PH_FC0 = 700, PH_OCT = 1.8, PH_CTRL = 16;

  function cl(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* (re)allocate for a sample rate: called from createState, and from bindEngine when the parent
     engine's rate differs from the create default (setup-time only, never mid-render; the ONLY
     allocation point of this module) */
  function retune(st, sr) {
    st.sr = sr;
    st.cap = Math.ceil(sr * CAP_S) + 8;
    st.lineL = new Float64Array(st.cap);
    st.lineR = new Float64Array(st.cap);
    st.w = 0;
    st.ph = 0;
    st.phInc = st.rate / sr;
    st.yL = 0; st.yR = 0; st.fL = 0; st.fR = 0;
    st.ctrl = 0;
    st.oL = 0; st.oR = 0;
    phCoeffs(st);
  }

  function createState(opts) {
    const o = (opts && typeof opts === "object") ? opts : {};
    let sr = Number(o.sampleRate);
    if (!isFinite(sr) || sr <= 0) sr = Number(o.sr);          /* parent may pass either key */
    if (!isFinite(sr) || sr <= 0) sr = 48000;
    const st = {
      sr: 0, cap: 0,
      lineL: null, lineR: null,
      w: 0,
      pL: new Float64Array(8), pR: new Float64Array(8),   /* phaser stage states (max 8) */
      yL: 0, yR: 0,                                       /* phaser feedback store */
      fL: 0, fR: 0,                                       /* flanger feedback store */
      aL: 0, aR: 0,                                       /* phaser coefficients (current) */
      ctrl: 0,
      ph: 0, phInc: 0,
      /* params */
      mode: 0, rate: 0.6, depth: 0.5, fb: 0, n: 6, on: 0, mix: 0.5,
      oL: 0, oR: 0,
      eng: null,
    };
    retune(st, sr);
    return st;
  }

  /* phaser coefficient refresh (control rate, or at create/reset): break freq fc = fc0 * 2^(K*d*s) */
  function phCoeffs(st) {
    const s = Math.sin(Math.PI * 2 * st.ph);
    const c = Math.cos(Math.PI * 2 * st.ph);
    let fL = PH_FC0 * Math.pow(2, PH_OCT * st.depth * s);
    let fR = PH_FC0 * Math.pow(2, PH_OCT * st.depth * c);        /* R = L + 0.25 cycles */
    const fMax = st.sr * 0.45;
    if (fL < 80) fL = 80; else if (fL > fMax) fL = fMax;
    if (fR < 80) fR = 80; else if (fR > fMax) fR = fMax;
    const tL = Math.tan(Math.PI * fL / st.sr);
    const tR = Math.tan(Math.PI * fR / st.sr);
    st.aL = (1 - tL) / (1 + tL);
    st.aR = (1 - tR) / (1 + tR);
  }

  function reset(st) {
    if (!st) return;
    st.lineL.fill(0);
    st.lineR.fill(0);
    st.pL.fill(0); st.pR.fill(0);
    st.w = 0;
    st.ph = 0;
    st.yL = 0; st.yR = 0; st.fL = 0; st.fR = 0;
    st.ctrl = 0;
    st.oL = 0; st.oR = 0;
    phCoeffs(st);
  }

  function bindEngine(st, eng) {
    if (!st) return false;
    st.eng = eng || null;
    /* parent binds right after createState, before any render: re-tune to the engine's true rate
       when it differs from the create default (setup-time allocation only) */
    if (eng && isFinite(eng.sr) && eng.sr > 0 && eng.sr !== st.sr) {
      retune(st, eng.sr);
      st.phInc = st.rate / st.sr;
    }
    return true;
  }

  function setParam(st, path, value) {
    if (!st || typeof path !== "string") return false;
    switch (path) {
      case "fx.mod.mode": {
        const i = MODES.indexOf(String(value));
        if (i < 0) return false;
        st.mode = i;
        return true;
      }
      case "fx.mod.rate": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.rate = cl(n, RATE_MIN, RATE_MAX);
        st.phInc = st.rate / st.sr;
        return true;
      }
      case "fx.mod.depth": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.depth = cl(n, 0, 1);
        return true;
      }
      case "fx.mod.feedback": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.fb = cl(n, FB_MIN, FB_MAX);
        return true;
      }
      case "fx.mod.stages": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        let s = 0;
        for (let i = 0; i < 3; i++) if (n === STAGES_OK[i]) s = n;
        if (s === 0) return false;
        st.n = s;
        return true;
      }
      case "fx.mod.on": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.on = n >= 0.5 ? 1 : 0;
        return true;
      }
      case "fx.mod.mix": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.mix = cl(n, 0, 1);
        return true;
      }
      default:
        return false;
    }
  }

  /* fractional (linear) delay read: d samples back from the write cursor */
  function tap(line, cap, w, d) {
    let df = d < MIN_D ? MIN_D : d;
    const maxD = cap - 2;
    if (df > maxD) df = maxD;
    const i0 = Math.floor(df);
    const fr = df - i0;
    let p = w - i0;
    if (p < 0) p += cap;
    let p1 = p - 1;
    if (p1 < 0) p1 += cap;
    return line[p] * (1 - fr) + line[p1] * fr;
  }

  /* ---- one stereo sample ---- */
  function process(st, xL, xR) {
    if (st.on === 0) { st.oL = xL; st.oR = xR; return; }

    /* LFO (one sine + one cosine per sample; all phase offsets derived from them) */
    let ph = st.ph + st.phInc;
    if (ph >= 1) ph -= 1;
    st.ph = ph;
    const s = Math.sin(6.283185307179586 * ph);
    const c = Math.cos(6.283185307179586 * ph);

    let wetL, wetR;
    const mode = st.mode;

    if (mode === 0) {
      /* chorus: one modulated tap per side, antiphase stereo */
      const d0 = CH_D0, a0 = CH_A * st.depth;
      wetL = tap(st.lineL, st.cap, st.w, (d0 + a0 * s) * st.sr);
      wetR = tap(st.lineR, st.cap, st.w, (d0 - a0 * s) * st.sr);
    } else if (mode === 1) {
      /* ensemble: 3 taps per side, LFO phases 0 / 1/3 / 2/3 (R + 0.5) */
      const a0 = EN_A * st.depth;
      const s2 = -0.5 * s + SR3 * c;                 /* sin(ph + 1/3 cyc) */
      const s3 = -0.5 * s - SR3 * c;                 /* sin(ph + 2/3 cyc) */
      const r1 = -s;                                 /* sin(ph + 1/2 cyc) */
      const r2 = 0.5 * s - SR3 * c;                  /* sin(ph + 5/6 cyc) */
      const r3 = 0.5 * s + SR3 * c;                  /* sin(ph + 7/6 cyc) */
      const sr1 = st.sr;
      wetL = (tap(st.lineL, st.cap, st.w, (EN_BASE[0] + a0 * s) * sr1)
            + tap(st.lineL, st.cap, st.w, (EN_BASE[1] + a0 * s2) * sr1)
            + tap(st.lineL, st.cap, st.w, (EN_BASE[2] + a0 * s3) * sr1)) * 0.3333333333333333;
      wetR = (tap(st.lineR, st.cap, st.w, (EN_BASE[0] + a0 * r1) * sr1)
            + tap(st.lineR, st.cap, st.w, (EN_BASE[1] + a0 * r2) * sr1)
            + tap(st.lineR, st.cap, st.w, (EN_BASE[2] + a0 * r3) * sr1)) * 0.3333333333333333;
    } else if (mode === 2) {
      /* flanger: short modulated tap + signed feedback, quadrature stereo */
      const a0 = FL_A * st.depth;
      const fb = st.fb;
      const dl = (FL_D0 + a0 * s) * st.sr;
      const dr = (FL_D0 + a0 * c) * st.sr;
      wetL = tap(st.lineL, st.cap, st.w, dl);
      wetR = tap(st.lineR, st.cap, st.w, dr);
      st.lineL[st.w] = xL + fb * wetL;            /* loop through the tap (d >= 14 smp) */
      st.lineR[st.w] = xR + fb * wetR;
      st.fL = wetL;
      st.fR = wetR;
      st.w = st.w + 1 >= st.cap ? 0 : st.w + 1;
    } else {
      /* phaser: N first-order allpass stages + feedback; coefficients at control rate */
      st.ctrl++;
      if (st.ctrl >= PH_CTRL) { st.ctrl = 0; phCoeffs(st); }
      const fb = st.fb;
      const n = st.n;
      let x = xL + fb * st.yL;
      for (let k = 0; k < n; k++) {
        const z = st.pL[k];
        const y = -st.aL * x + z;
        st.pL[k] = x + st.aL * y;
        x = y;
      }
      st.yL = x;
      wetL = x;
      x = xR + fb * st.yR;
      for (let k = 0; k < n; k++) {
        const z = st.pR[k];
        const y = -st.aR * x + z;
        st.pR[k] = x + st.aR * y;
        x = y;
      }
      st.yR = x;
      wetR = x;
    }

    /* stereo delay-based modes advance the shared write cursor with dry input (+ nothing else:
       the modulation is read-side; flanger already wrote its feedback into the line) */
    if (mode === 0 || mode === 1) {
      st.lineL[st.w] = xL;
      st.lineR[st.w] = xR;
      st.w = st.w + 1 >= st.cap ? 0 : st.w + 1;
    }

    /* module-side dry/wet (bit-identical at mix=0, pure wet at mix=1) */
    const mix = st.mix;
    if (mix <= 0) { st.oL = xL; st.oR = xR; }
    else if (mix >= 1) { st.oL = wetL; st.oR = wetR; }
    else {
      const dry = 1 - mix;
      st.oL = xL * dry + wetL * mix;
      st.oR = xR * dry + wetR * mix;
    }
  }

  return {
    VERSION: VERSION,
    PREFIX: PREFIX,
    createState: createState,
    reset: reset,
    bindEngine: bindEngine,
    setParam: setParam,
    process: process,
  };
})();

if (typeof AVDSP !== "undefined" && typeof AVDSP.registerFx === "function") AVDSP.registerFx("mod", AVFXMOD);
