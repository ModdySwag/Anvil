/* av_fx_delay.js -- Anvil P3 FX module: stereo delay with fractional allpass interpolation,
   cross-feedback ping-pong, input ducking and BPM sync divisions (child B, wave P3).
   Contract: verify/_p3_wave.md section 2.1 (FX module interface) + section 3.2 (this module).
   MIRRORS the P2 kind-module registration pattern (verify/_p2_wave.md section 2.1): ONE
   top-level name, self-registration at load, guarded so a build without registerFx still loads.

   LAWS (carried from P1/P2, do not drift):
   - worklet-safe: strict mode, no page/global-scope reach-ins (no window/document/location/
     Math.random/eval), ONE top-level name (AVFXDELAY).
   - alloc-free render: every buffer is allocated in createState() only; process() writes
     scalars into the preallocated state and never creates objects/arrays/strings/closures.
   - no NaN: setParam rejects non-finite values; every per-sample op is on finite data; the
     feedback gain is hard-bounded (see below), so the recursive loop cannot grow.
   - seeded determinism: no randomness at all - same input + same params => bit-identical output.

   INTERFACE (pinned by the wave contract):
     VERSION = "p3.0" · PREFIX = "delay"
     createState() -> st        allocates the two delay lines (the ONLY allocation point)
     reset(st)                  zeroes lines/states, snaps the smoothed delay to target
     bindEngine(st, eng)        optional parent hook; stores st.eng backref (may be null)
     setParam(st, path, v)      handles "fx.delay.*" only; true on accept, false otherwise
     process(st, xL, xR)        ONE stereo sample; result in st.oL / st.oR (no return value)

   OUTPUT CONVENTION (module-side final mix, section 2.2 "module-side responsibility"):
     st.oL / st.oR carry the module's FINAL output = dry*(1-mix) + wet*mix, computed HERE from
     the allpass-interpolated delay tap (wet) and the input (dry). At mix=0 the output is a
     bit-identical copy of the input (explicit branch - exact, incl. -0); at mix=1 it is the
     pure wet tap. The chain owner COPIES st.oL/st.oR; do not blend a second time.

   PARAMS (fx.delay.*): time 0.01..2 s · spread 0..1 (L/R offset +-25% of the base time) ·
   feedback 0..0.95 · pingpong 0..1 (cross-feedback amount: 0 straight, 1 full cross) ·
   duck 0..1 (feedback path ducks under input; peak follower 2 ms att / 150 ms rel) ·
   div enum free|1/1|1/2|1/4|1/8|1/8d|1/16 (1/8d = dotted 8th; reads bpm) ·
   bpm 20..300 (parent mirrors avState.bpm here) · on 0|1 (default 0) · mix 0..1 (default 0.35).
   Defaults: time 0.3 s · spread 0.15 · feedback 0.4 · pingpong 0.5 · duck 0 · div "free" ·
   bpm 120.

   DSP NOTES:
   - fractional + allpass interpolation: D = N + f samples, read at integer offset N; a
     first-order allpass (a + z^-1)/(1 + a z^-1), a = (1-f)/(1+f), adds the fractional part
     (Dattorro, Effect Design Part 2 - published paper maths). f < 1e-4 is remapped to
     N-1 + 1 (a = 0, pure integer read) so the degenerate a -> 1 case never runs.
   - ping-pong: fbL = g*((1-pp)*wetL + pp*wetR), fbR = g*((1-pp)*wetR + pp*wetL); with pp=1 a
     single-sided input alternates L,R,L,R (harness gate). g is bounded to [0, 0.95] so the
     loop gain is always < 1 (unconditionally stable).
   - delay-time changes glide with a 30 ms one-pole (no zipper/click at param moves).
   - the two channel lines share ONE write cursor st.w; capacity covers 2 s * (1 + 0.25) + pad. */

"use strict";

const AVFXDELAY = (function () {
  const VERSION = "p3.0";
  const PREFIX = "delay";

  /* ---- pins ---- */
  const DIVS = ["free", "1/1", "1/2", "1/4", "1/8", "1/8d", "1/16"];
  const DIV_BEATS = [0, 4, 2, 1, 0.5, 0.75, 0.25];    /* beats (quarter notes) per division */
  const T_MIN = 0.01, T_MAX = 2.0;
  const SPREAD_MAX = 0.25;          /* spread 0..1 -> L/R offset +-25% of the base time */
  const FB_MAX = 0.95;
  const BPM_MIN = 20, BPM_MAX = 300;
  const SMOOTH_S = 0.03;            /* delay-time glide time constant */
  const DUCK_ATT_S = 0.002, DUCK_REL_S = 0.15;
  const MIN_D = 2;                  /* never read closer than 2 samples */

  function cl(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* effective base time (s) and the two channel targets (samples); called at create/reset and
     from every setParam that can move the delay time (never from process) */
  function recompute(st) {
    const base = st.div === 0 ? st.time : DIV_BEATS[st.div] * 60 / st.bpm;
    st.base = base;
    const maxD = st.cap - 4;
    let l = base * (1 - SPREAD_MAX * st.spread) * st.sr;
    let r = base * (1 + SPREAD_MAX * st.spread) * st.sr;
    if (l < MIN_D) l = MIN_D; else if (l > maxD) l = maxD;
    if (r < MIN_D) r = MIN_D; else if (r > maxD) r = maxD;
    st.tgtL = l;
    st.tgtR = r;
  }

  function createState(opts) {
    const o = (opts && typeof opts === "object") ? opts : {};
    let sr = Number(o.sampleRate);
    if (!isFinite(sr) || sr <= 0) sr = 48000;
    const cap = Math.ceil(sr * (T_MAX * (1 + SPREAD_MAX) + 0.05)) + 8;
    const st = {
      sr: sr, cap: cap, maxD: cap - 4,
      lineL: new Float64Array(cap), lineR: new Float64Array(cap),
      w: 0,
      apL: 0, apR: 0,               /* allpass interpolation states (one per channel) */
      dL: 0, dR: 0,                 /* current (glided) delays, samples */
      tgtL: 0, tgtR: 0,             /* targets, samples */
      sl: 1 - Math.exp(-1 / (SMOOTH_S * sr)),
      duckAtt: 1 - Math.exp(-1 / (DUCK_ATT_S * sr)),
      duckRel: 1 - Math.exp(-1 / (DUCK_REL_S * sr)),
      duckEnv: 0,
      /* params */
      time: 0.3, spread: 0.15, fb: 0.4, pp: 0.5, duck: 0,
      div: 0, bpm: 120, on: 0, mix: 0.35,
      base: 0.3,
      oL: 0, oR: 0,
      eng: null,
    };
    recompute(st);
    st.dL = st.tgtL;
    st.dR = st.tgtR;
    return st;
  }

  function reset(st) {
    if (!st) return;
    st.lineL.fill(0);
    st.lineR.fill(0);
    st.w = 0;
    st.apL = 0; st.apR = 0;
    st.duckEnv = 0;
    st.oL = 0; st.oR = 0;
    recompute(st);
    st.dL = st.tgtL;
    st.dR = st.tgtR;
  }

  function bindEngine(st, eng) {
    if (st) st.eng = eng || null;
    return true;
  }

  function setParam(st, path, value) {
    if (!st || typeof path !== "string") return false;
    switch (path) {
      case "fx.delay.time": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.time = cl(n, T_MIN, T_MAX);
        recompute(st);
        return true;
      }
      case "fx.delay.spread": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.spread = cl(n, 0, 1);
        recompute(st);
        return true;
      }
      case "fx.delay.feedback": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.fb = cl(n, 0, FB_MAX);
        return true;
      }
      case "fx.delay.pingpong": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.pp = cl(n, 0, 1);
        return true;
      }
      case "fx.delay.duck": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.duck = cl(n, 0, 1);
        return true;
      }
      case "fx.delay.div": {
        const i = DIVS.indexOf(String(value));
        if (i < 0) return false;
        st.div = i;
        recompute(st);
        return true;
      }
      case "fx.delay.bpm": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.bpm = cl(n, BPM_MIN, BPM_MAX);
        recompute(st);
        return true;
      }
      case "fx.delay.on": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.on = n >= 0.5 ? 1 : 0;
        return true;
      }
      case "fx.delay.mix": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.mix = cl(n, 0, 1);
        return true;
      }
      default:
        return false;
    }
  }

  /* ---- one stereo sample ---- */
  function process(st, xL, xR) {
    if (st.on === 0) { st.oL = xL; st.oR = xR; return; }

    /* glide the delay times (no zipper on time/spread/div moves) */
    st.dL += (st.tgtL - st.dL) * st.sl;
    st.dR += (st.tgtR - st.dR) * st.sl;

    /* ---- wet taps: first-order allpass fractional interpolation, one state per channel ---- */
    let d = st.dL;
    if (d < MIN_D) d = MIN_D; else if (d > st.maxD) d = st.maxD;
    let N = Math.floor(d);
    let f = d - N;
    if (f < 0.0001) { f = 1; N -= 1; }
    let idx = st.w - N;
    if (idx < 0) idx += st.cap;
    let a = (1 - f) / (1 + f);
    let v = st.lineL[idx];
    const wetL = a * v + st.apL;
    st.apL = v - a * wetL;

    d = st.dR;
    if (d < MIN_D) d = MIN_D; else if (d > st.maxD) d = st.maxD;
    N = Math.floor(d);
    f = d - N;
    if (f < 0.0001) { f = 1; N -= 1; }
    idx = st.w - N;
    if (idx < 0) idx += st.cap;
    a = (1 - f) / (1 + f);
    v = st.lineR[idx];
    const wetR = a * v + st.apR;
    st.apR = v - a * wetR;

    /* ---- ducking: input peak follower lowers the feedback gain while the input plays ---- */
    let pk = xL < 0 ? -xL : xL;
    const pr = xR < 0 ? -xR : xR;
    if (pr > pk) pk = pr;
    if (pk > st.duckEnv) st.duckEnv += (pk - st.duckEnv) * st.duckAtt;
    else st.duckEnv += (pk - st.duckEnv) * st.duckRel;
    if (st.duckEnv > 1) st.duckEnv = 1;                    /* g stays in [0, fb] */

    /* ---- cross-feedback write (g hard-bounded -> unconditionally stable) ---- */
    const g = st.fb * (1 - st.duck * st.duckEnv);
    const pp = st.pp;
    const fl = g * ((1 - pp) * wetL + pp * wetR);
    const fr = g * ((1 - pp) * wetR + pp * wetL);
    st.lineL[st.w] = xL + fl;
    st.lineR[st.w] = xR + fr;
    let wi = st.w + 1;
    if (wi >= st.cap) wi = 0;
    st.w = wi;

    /* ---- module-side dry/wet (bit-identical at mix=0, pure wet at mix=1) ---- */
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

if (typeof AVDSP !== "undefined" && typeof AVDSP.registerFx === "function") AVDSP.registerFx("delay", AVFXDELAY);
