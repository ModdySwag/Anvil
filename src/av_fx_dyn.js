/* av_fx_dyn.js -- Anvil P3 FX rack: 3-band EQ + compressor + lookahead limiter + master
   soft-clip safety (module `AVFXDYN`, child C; ONE worklet-safe top-level name).
   Wave contract: verify/_p3_wave.md section 2.1 (FX module interface), section 3.3 (dyn row),
   section 8 (laws); docs/03 section 2.4 line 65 (EQ RBJ / compressor feed-forward dB gain
   computer soft knee / lookahead limiter 1-5 ms stereo-linked / master soft-clip safety).

   INTERFACE (pinned, section 2.1):
     VERSION = "p3.0" · PREFIX = "dyn"
     createState() -> st   preallocated state (one per engine; ALL buffers + arrays live here)
     reset(st)             zero audio state (EQ, detector, gains, delay lines); params stay
     setParam(st, path, value) -> boolean   handles fx.dyn.* ONLY; unknown -> false, never throws
     process(st, xL, xR)   ONE stereo sample; WET result in st.oL / st.oR; alloc-free
     bindEngine(st, eng)   parent hook after create: reads eng.sr, (re)builds sr-derived coeffs

   CHAIN (section 3.3, order fixed by the wave): EQ -> compressor -> limiter -> soft-clip.
   - EQ (RBJ cookbook biquads, DF2-T, normalised by a0):
       band 0 fx.dyn.eqLo  low shelf,  120 Hz, S = 1,  +-15 dB
       band 1 fx.dyn.eqMid peaking,   1000 Hz, Q = 1,  +-15 dB
       band 2 fx.dyn.eqHi  high shelf, 8000 Hz, S = 1, +-15 dB
     (frequencies fixed for v1 - not pinned this wave; noted in the report for a later param!)
     At 0 dB the RBJ coefficients collapse to an EXACT passthrough (b == a -> y = x, state 0).
   - Compressor (feed-forward; stereo-linked peak detector):
       fx.dyn.comp.thresh -40..0 dBFS (default 0) · ratio 1..20 (default 1)
       att 0.001..0.3 s · rel 0.05..1 s · makeup 0..24 dB · soft knee 6 dB
       detector: peak follower of max(|L|,|R|) with 1 ms attack smoothing (PINNED) and 50 ms
       decay; gain computer in dB (Reiss soft-knee form); gain smoothed by att/rel one-poles.
   - Limiter (stereo-linked, TRUE 3 ms lookahead):
       fx.dyn.lim.ceiling -6..0 dBFS (default 0)
       sliding max of max(|L|,|R|) over the last lookN+1 samples (monotonic deque, amortised
       O(1), preallocated) -> gain target min(1, ceilLin/max); one-pole attack 0.5 ms /
       release 120 ms; applied to the signal delayed lookN samples. Guarantee: every output
       sample is bounded by the ceiling up to the smoothing residual (<= ~0.02 dB measured).
   - Master soft-clip safety, ALWAYS ON as the last wet stage (no param disables it; the
       module-wide on/mix<=0 null law still passes the dry signal through bit-identically):
       |x| <= 0.7 exact passthrough; above: sign*(0.7 + 0.3*tanh((|x|-0.7)/0.3)), asymptote
       +-1.0 (0 dBFS). Kink-free (value + slope continuous at 0.7).

   MIX / BYPASS LAW (section 2.1/2.2): process() writes the WET signal into st.oL/st.oR; the
   parent computes out = dry*(1-mix) + wet*mix. When `on` is 0 or `mix` <= 0 the module writes
   the DRY input through unchanged (bit-identical), so a parent that reads st.oL/oR directly
   is also bit-identical at mix=0.

   LAWS: "use strict"; ONE top-level name (AVFXDYN); no page/global reach-ins; alloc-free
   process() (ALL arrays allocated in createState; the only numbers touched at run time);
   monomorphic state shape; no NaN for finite input (entry guard, env floor, finite clamps);
   never throws. Footer self-registers `AVDSP.registerFx("dyn", AVFXDYN)`.

   Harness: cache/scratch/p3/drivedyn/drivedyn_node.mjs (child C; not shipped). */

"use strict";
const AVFXDYN = (function () {

  const VERSION = "p3.0";
  const PREFIX = "dyn";

  /* EQ v1 layout (Hz; Q/S in the coefficient builder) */
  const EQ_LO_F = 120, EQ_MID_F = 1000, EQ_HI_F = 8000;

  /* compressor detector (pinned 1 ms attack smoothing) + knee */
  const DET_ATT_S = 0.001, DET_REL_S = 0.05;
  const KNEE_DB = 6;

  /* limiter */
  const LK_MAX = 2048;            /* delay ring + deque capacity (pow2); 3 ms up to ~680 kHz */
  const LK_MASK = LK_MAX - 1;
  const LOOK_S = 0.003;           /* 3 ms lookahead (pinned) */
  const LK_ATT_S = 0.0005;        /* gain attack smoothing (0.5 ms; <= 3 ms budget) */
  const LK_REL_S = 0.12;          /* gain release (120 ms) */

  /* soft-clip */
  const SC_KNEE = 0.7, SC_SPAN = 0.3;

  const MAX_X = 1e6;              /* entry guard: |x| beyond this (or non-finite) -> 0 */

  function cl(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ---------------- state ---------------- */
  function createState() {
    const st = {
      on: 0, mix: 1,
      /* EQ */
      eqLo: 0, eqMid: 0, eqHi: 0,
      b0: new Float64Array(3), b1: new Float64Array(3), b2: new Float64Array(3),
      a1: new Float64Array(3), a2: new Float64Array(3),
      w1L: new Float64Array(3), w2L: new Float64Array(3),
      w1R: new Float64Array(3), w2R: new Float64Array(3),
      /* compressor */
      thresh: 0, ratio: 1, att: 0.01, rel: 0.25, makeup: 0,
      env: 0, cg: 0,
      aDet: 0, rDet: 0, aAtt: 0, aRel: 0,
      /* limiter */
      ceiling: 0, ceilLin: 1, lookN: 144,
      wIdx: 0, gLim: 1, aLimAtt: 0, aLimRel: 0,
      dL: new Float64Array(LK_MAX), dR: new Float64Array(LK_MAX),
      pkRing: new Float64Array(LK_MAX),
      dq: new Float64Array(LK_MAX),
      dqHead: 0, dqTail: 0,
      /* io */
      sr: 48000,
      oL: 0, oR: 0,
    };
    derive(st);
    return st;
  }

  /* float-exact identity check for the 0 dB shelf case: b/a pairs below are built so that
     at A=1 the numerator and denominator expressions are the same float ops (see header). */
  function eqCoeffs(st, band, db) {
    const f = (band === 0) ? EQ_LO_F : (band === 1 ? EQ_MID_F : EQ_HI_F);
    const w0 = 2 * Math.PI * f / st.sr;
    const cw = Math.cos(w0), sw = Math.sin(w0);
    const A = Math.pow(10, db / 40);
    let b0, b1, b2, a0, a1, a2;
    if (band === 1) {
      /* peaking, Q = 1 -> alpha = sin(w0)/2 */
      const alpha = sw / 2;
      const ap = alpha * A, am = alpha / A;
      b0 = 1 + ap; b1 = -2 * cw; b2 = 1 - ap;
      a0 = 1 + am; a1 = -2 * cw; a2 = 1 - am;
      if (db === 0) {                /* exact identity at 0 dB (b1/a1, b2/a2 below share the ops) */
        b0 = a0; b1 = a1; b2 = a2;
      }
    } else if (band === 0) {
      /* low shelf, S = 1 -> alpha = sin(w0)/2 * sqrt(2) */
      const alpha = sw / 2 * Math.SQRT2;
      const sa = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cw + sa);
      b1 = 2 * A * ((A - 1) - (A + 1) * cw);
      b2 = A * ((A + 1) - (A - 1) * cw - sa);
      a0 = (A + 1) + (A - 1) * cw + sa;
      a1 = -2 * ((A - 1) + (A + 1) * cw);
      a2 = (A + 1) + (A - 1) * cw - sa;
      if (db === 0) { b0 = a0; b1 = a1; b2 = a2; }
    } else {
      /* high shelf, S = 1 */
      const alpha = sw / 2 * Math.SQRT2;
      const sa = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cw + sa);
      b1 = -2 * A * ((A - 1) + (A + 1) * cw);
      b2 = A * ((A + 1) + (A - 1) * cw - sa);
      a0 = (A + 1) - (A - 1) * cw + sa;
      a1 = 2 * ((A - 1) - (A + 1) * cw);
      a2 = (A + 1) - (A - 1) * cw - sa;
      if (db === 0) { b0 = a0; b1 = a1; b2 = a2; }
    }
    const inv = 1 / a0;
    st.b0[band] = b0 * inv; st.b1[band] = b1 * inv; st.b2[band] = b2 * inv;
    st.a1[band] = a1 * inv; st.a2[band] = a2 * inv;
  }

  /* sr-derived coefficients + buffers sizing (no allocation after createState) */
  function derive(st) {
    const sr = st.sr;
    eqCoeffs(st, 0, st.eqLo);
    eqCoeffs(st, 1, st.eqMid);
    eqCoeffs(st, 2, st.eqHi);
    st.aDet = 1 - Math.exp(-1 / (DET_ATT_S * sr));
    st.rDet = 1 - Math.exp(-1 / (DET_REL_S * sr));
    st.aAtt = 1 - Math.exp(-1 / (st.att * sr));
    st.aRel = 1 - Math.exp(-1 / (st.rel * sr));
    let n = Math.round(LOOK_S * sr);
    if (n < 1) n = 1; else if (n > LK_MAX - 2) n = LK_MAX - 2;
    st.lookN = n;
    st.aLimAtt = 1 - Math.exp(-1 / (LK_ATT_S * sr));
    st.aLimRel = 1 - Math.exp(-1 / (LK_REL_S * sr));
    st.ceilLin = Math.pow(10, st.ceiling / 20);
  }

  function bindEngine(st, eng) {
    if (eng) {
      const sr = Number(eng.sr !== undefined ? eng.sr : eng.sampleRate);
      if (isFinite(sr) && sr > 0) st.sr = sr;
    }
    derive(st);
    return true;
  }

  function reset(st) {
    for (let i = 0; i < 3; i++) { st.w1L[i] = 0; st.w2L[i] = 0; st.w1R[i] = 0; st.w2R[i] = 0; }
    st.env = 0; st.cg = 0;
    st.dL.fill(0); st.dR.fill(0); st.pkRing.fill(0);
    st.dqHead = 0; st.dqTail = 0;
    st.wIdx = 0; st.gLim = 1;
    st.oL = 0; st.oR = 0;
  }

  /* ---------------- params ---------------- */
  function setParam(st, path, value) {
    switch (path) {
      case "fx.dyn.on": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.on = n > 0 ? 1 : 0;
        return true;
      }
      case "fx.dyn.mix": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.mix = cl(n, 0, 1);
        return true;
      }
      case "fx.dyn.eqLo": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.eqLo = cl(n, -15, 15);
        eqCoeffs(st, 0, st.eqLo);
        return true;
      }
      case "fx.dyn.eqMid": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.eqMid = cl(n, -15, 15);
        eqCoeffs(st, 1, st.eqMid);
        return true;
      }
      case "fx.dyn.eqHi": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.eqHi = cl(n, -15, 15);
        eqCoeffs(st, 2, st.eqHi);
        return true;
      }
      case "fx.dyn.comp.thresh": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.thresh = cl(n, -40, 0);
        return true;
      }
      case "fx.dyn.comp.ratio": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.ratio = cl(n, 1, 20);
        return true;
      }
      case "fx.dyn.comp.att": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.att = cl(n, 0.001, 0.3);
        st.aAtt = 1 - Math.exp(-1 / (st.att * st.sr));
        return true;
      }
      case "fx.dyn.comp.rel": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.rel = cl(n, 0.05, 1);
        st.aRel = 1 - Math.exp(-1 / (st.rel * st.sr));
        return true;
      }
      case "fx.dyn.comp.makeup": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.makeup = cl(n, 0, 24);
        return true;
      }
      case "fx.dyn.lim.ceiling": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.ceiling = cl(n, -6, 0);
        st.ceilLin = Math.pow(10, st.ceiling / 20);
        return true;
      }
      default:
        return false;
    }
  }

  /* ---------------- process ---------------- */
  function process(st, xL, xR) {
    /* off / mix<=0: bit-identical dry passthrough (module-side null law, section 2.1) */
    if (st.on === 0 || st.mix <= 0) { st.oL = xL; st.oR = xR; return; }
    if (!(xL >= -MAX_X && xL <= MAX_X)) xL = 0;
    if (!(xR >= -MAX_X && xR <= MAX_X)) xR = 0;

    /* ---- 1. EQ: three DF2-T biquads (shared coeffs; per-channel state) ---- */
    let xl = xL, xr = xR;
    for (let bd = 0; bd < 3; bd++) {
      const b0 = st.b0[bd], b1 = st.b1[bd], b2 = st.b2[bd], a1 = st.a1[bd], a2 = st.a2[bd];
      let y = b0 * xl + st.w1L[bd];
      st.w1L[bd] = b1 * xl - a1 * y + st.w2L[bd];
      st.w2L[bd] = b2 * xl - a2 * y;
      xl = y;
      y = b0 * xr + st.w1R[bd];
      st.w1R[bd] = b1 * xr - a1 * y + st.w2R[bd];
      st.w2R[bd] = b2 * xr - a2 * y;
      xr = y;
    }

    /* ---- 2. compressor: stereo-linked peak detector (1 ms attack smoothing), dB computer,
            soft knee 6 dB, att/rel smoothed gain, makeup ---- */
    const ax = Math.abs(xl) > Math.abs(xr) ? Math.abs(xl) : Math.abs(xr);
    st.env += (ax - st.env) * (ax > st.env ? st.aDet : st.rDet);
    const e = st.env > 1e-9 ? st.env : 1e-9;
    const xdb = 20 * Math.log10(e);
    const T = st.thresh, R = st.ratio;
    const slope = 1 / R - 1;
    let gdb;
    if (xdb <= T - KNEE_DB / 2) gdb = 0;
    else if (xdb >= T + KNEE_DB / 2) gdb = (xdb - T) * slope;
    else { const u = xdb - T + KNEE_DB / 2; gdb = u * u * slope / (2 * KNEE_DB); }
    st.cg += (gdb - st.cg) * (gdb < st.cg ? st.aAtt : st.aRel);
    const gl = Math.pow(10, (st.cg + st.makeup) * 0.05);
    xl *= gl;
    xr *= gl;

    /* ---- 3. limiter: 3 ms lookahead; sliding max (monotonic deque) -> gain target;
            fast-attack / slow-release smoothing; gain applied to the delayed signal ---- */
    const t = st.wIdx;
    st.dL[t & LK_MASK] = xl;
    st.dR[t & LK_MASK] = xr;
    const pk = Math.abs(xl) > Math.abs(xr) ? Math.abs(xl) : Math.abs(xr);
    st.pkRing[t & LK_MASK] = pk;
    while (st.dqTail > st.dqHead && st.pkRing[st.dq[st.dqTail - 1] & LK_MASK] <= pk) st.dqTail--;
    st.dq[st.dqTail & LK_MASK] = t;
    st.dqTail++;
    while (st.dq[st.dqHead & LK_MASK] < t - st.lookN) st.dqHead++;
    const m = st.pkRing[st.dq[st.dqHead & LK_MASK] & LK_MASK];
    let req = m > 1e-12 ? st.ceilLin / m : 1;
    if (req > 1) req = 1;
    st.gLim += (req - st.gLim) * (req < st.gLim ? st.aLimAtt : st.aLimRel);
    const rd = (t - st.lookN) & LK_MASK;
    let yl = st.dL[rd] * st.gLim;
    let yr = st.dR[rd] * st.gLim;
    st.wIdx = t + 1;

    /* ---- 4. master soft-clip safety (ALWAYS ON in the wet path; 0 dBFS ceiling) ---- */
    if (yl > SC_KNEE) yl = SC_KNEE + SC_SPAN * Math.tanh((yl - SC_KNEE) / SC_SPAN);
    else if (yl < -SC_KNEE) yl = -SC_KNEE - SC_SPAN * Math.tanh((-yl - SC_KNEE) / SC_SPAN);
    if (yr > SC_KNEE) yr = SC_KNEE + SC_SPAN * Math.tanh((yr - SC_KNEE) / SC_SPAN);
    else if (yr < -SC_KNEE) yr = -SC_KNEE - SC_SPAN * Math.tanh((-yr - SC_KNEE) / SC_SPAN);

    st.oL = yl;
    st.oR = yr;
  }

  return {
    VERSION: VERSION,
    version: VERSION,
    PREFIX: PREFIX,
    createState: createState,
    bindEngine: bindEngine,
    reset: reset,
    setParam: setParam,
    process: process,
  };
})();
if (typeof AVDSP !== "undefined" && typeof AVDSP.registerFx === "function") AVDSP.registerFx("dyn", AVFXDYN);
