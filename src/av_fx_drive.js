/* av_fx_drive.js -- Anvil P3 FX rack: drive / saturator + wavefolder + bitcrush
   (module `AVFXDRIVE`, child C; ONE worklet-safe top-level name).
   Wave contract: verify/_p3_wave.md section 2.1 (FX module interface), section 3.3
   (drive row), section 8 (laws); docs/03 section 2.4 line 65 (drive/saturator w/ fold
   mode + bitcrush).

   INTERFACE (pinned, section 2.1):
     VERSION = "p3.0" · PREFIX = "drive"
     createState() -> st   preallocated state (one per engine; allocation happens HERE only)
     reset(st)             zero audio state, keep params (snaps smoothers to targets)
     setParam(st, path, value) -> boolean   handles fx.drive.* ONLY; unknown -> false, never throws
     process(st, xL, xR)   ONE stereo sample; WET result in st.oL / st.oR; alloc-free; no return
     bindEngine(st, eng)   optional hook the parent calls after create: reads eng.sr

   PARAM PATHS (all fx.drive.*):
     on 0|1 (default 0, coerced 0/1) · mix 0..1 (default 1)
     mode "sat"|"fold"|"crush" (default sat; numeric 0|1|2 accepted)
     amount 0..1 (default 0) -> drive gain 10^(1.5*amount) = 0..+30 dB, smoothed 15 ms
     tone 0..1 (default 0.5)  one-pole tilt around ~800 Hz, post-shaper:
                              out = 2*((1-2t)*lp + t*v); t=0.5 is an exact passthrough,
                              t=1 = +6 dB HP side (LP fades), t=0 = +6 dB LP side
     bits 4..16 int (default 16) · down 1..32 int (default 1)  crush quantiser + sample-hold

   DSP:
   - sat   : y = tanh(g*x)             (bounded |y| < 1; THD rises strictly with amount)
   - fold  : y = triangle-fold(g*x) into [-1,1] (reflect at +-1, period 4); input clamped to
             +-64 first so any finite input stays bounded and finite (no NaN path)
   - crush : g*x -> sample-and-hold every `down` samples -> quantise to 2^(bits-1) levels
             (aliasing BY DESIGN; the harness reports the alias spectrum)
   - tone runs AFTER the shaper (classic pedal order), one-pole at TONE_FC = 800 Hz.

   MIX / BYPASS LAW (section 2.1/2.2): process() writes the WET signal into st.oL/st.oR;
   the parent computes out = dry*(1-mix) + wet*mix. When `on` is 0 or `mix` <= 0 the module
   writes the DRY input through unchanged (bit-identical), so a parent that reads st.oL/oR
   directly is also bit-identical at mix=0. This file allocates nothing in process().

   LAWS (worklet-safe): "use strict"; exactly ONE top-level name (AVFXDRIVE); no page/global
   reach-ins; alloc-free process() (all state incl. the (no) delay lines preallocated in
   createState); monomorphic state shape; no NaN for finite input (entry guard + fold clamp +
   quantiser clamp); never throws. Footer self-registers `AVDSP.registerFx("drive", AVFXDRIVE)`.

   Harness: cache/scratch/p3/drivedyn/drivedyn_node.mjs (child C; not shipped). */

"use strict";
const AVFXDRIVE = (function () {

  const VERSION = "p3.0";
  const PREFIX = "drive";
  const MODES = ["sat", "fold", "crush"];

  const SMOOTH_MS = 0.015;      /* amount/tone one-pole time constant (15 ms, house s15) */
  const TONE_FC = 800;          /* tone tilt pivot (Hz) */
  const FOLD_LIM = 64;          /* fold input ceiling: >= 16 folds, keeps any finite x bounded */
  const MAX_X = 1e6;            /* entry guard: |x| beyond this (or non-finite) -> 0 */

  function cl(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function mapEnum(value, list) { return list.indexOf(String(value)); }

  /* ---------------- state ---------------- */
  /* shape (monomorphic; every field initialised here):
       on, mix, mode, tAmount, cAmount, tTone, cTone, bits, levels, down,
       holdL, holdR, holdN, lpL, lpR, a15, aTone, sr, oL, oR */
  function createState() {
    const st = {
      on: 0, mix: 1, mode: 0,
      tAmount: 0, cAmount: 0,
      tTone: 0.5, cTone: 0.5,
      bits: 16, levels: 32768, down: 1,
      holdL: 0, holdR: 0, holdN: 0,
      lpL: 0, lpR: 0,
      a15: 0, aTone: 0,
      sr: 48000,
      oL: 0, oR: 0,
    };
    derive(st);
    return st;
  }

  /* sr-dependent coefficients (no allocation) */
  function derive(st) {
    const sr = st.sr;
    st.a15 = 1 - Math.exp(-1 / (SMOOTH_MS * sr));
    st.aTone = 1 - Math.exp(-2 * Math.PI * TONE_FC / sr);
  }

  /* parent hook: bind the engine so sr-derived coefficients are exact */
  function bindEngine(st, eng) {
    if (eng) {
      const sr = Number(eng.sr !== undefined ? eng.sr : eng.sampleRate);
      if (isFinite(sr) && sr > 0) st.sr = sr;
    }
    derive(st);
    return true;
  }

  /* zero the audio state; params stay. Smoothers snap to their targets (no glide after reset). */
  function reset(st) {
    st.cAmount = st.tAmount;
    st.cTone = st.tTone;
    st.holdL = 0; st.holdR = 0; st.holdN = 0;
    st.lpL = 0; st.lpR = 0;
    st.oL = 0; st.oR = 0;
  }

  /* ---------------- params ---------------- */
  function setParam(st, path, value) {
    switch (path) {
      case "fx.drive.on": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.on = n > 0 ? 1 : 0;
        return true;
      }
      case "fx.drive.mix": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.mix = cl(n, 0, 1);
        return true;
      }
      case "fx.drive.mode": {
        let e = mapEnum(value, MODES);
        if (e < 0) {
          const n = Number(value);
          if (isFinite(n) && n >= 0 && n <= 2 && Math.floor(n) === n) e = n;
        }
        if (e < 0) return false;
        st.mode = e;
        return true;
      }
      case "fx.drive.amount": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.tAmount = cl(n, 0, 1);
        return true;
      }
      case "fx.drive.tone": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.tTone = cl(n, 0, 1);
        return true;
      }
      case "fx.drive.bits": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        const b = cl(Math.round(n), 4, 16);
        st.bits = b;
        st.levels = Math.pow(2, b - 1);
        return true;
      }
      case "fx.drive.down": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.down = cl(Math.round(n), 1, 32);
        return true;
      }
      default:
        return false;
    }
  }

  /* ---------------- process ---------------- */
  /* triangle wavefolder: reflect u into [-1,1] (period 4). fold01(k) = k on [-1,1]. */
  function fold01(u) {
    const fr = u * 0.25 + 0.25;
    return 1 - 4 * Math.abs(fr - Math.floor(fr) - 0.5);
  }

  function process(st, xL, xR) {
    /* off / mix<=0: bit-identical dry passthrough (module-side null law, section 2.1) */
    if (st.on === 0 || st.mix <= 0) { st.oL = xL; st.oR = xR; return; }
    /* entry guard: non-finite / absurd input -> 0 (state stays finite forever) */
    if (!(xL >= -MAX_X && xL <= MAX_X)) xL = 0;
    if (!(xR >= -MAX_X && xR <= MAX_X)) xR = 0;

    /* smoothed amount -> drive gain (0..+30 dB) and smoothed tone */
    st.cAmount += (st.tAmount - st.cAmount) * st.a15;
    st.cTone += (st.tTone - st.cTone) * st.a15;
    const g = Math.pow(10, 1.5 * st.cAmount);

    let vL, vR;
    const mo = st.mode;
    if (mo === 0) {
      /* taper: tanh saturation, bounded < 1 */
      vL = Math.tanh(g * xL);
      vR = Math.tanh(g * xR);
    } else if (mo === 1) {
      /* triangle fold into [-1,1]; clamp before folding so |u| <= FOLD_LIM always */
      let uL = g * xL;
      if (uL > FOLD_LIM) uL = FOLD_LIM; else if (uL < -FOLD_LIM) uL = -FOLD_LIM;
      let uR = g * xR;
      if (uR > FOLD_LIM) uR = FOLD_LIM; else if (uR < -FOLD_LIM) uR = -FOLD_LIM;
      vL = fold01(uL);
      vR = fold01(uR);
    } else {
      /* bitcrush: drive -> sample-and-hold (down) -> quantise (bits) */
      if (st.holdN <= 0) {
        st.holdL = g * xL;
        st.holdR = g * xR;
        st.holdN = st.down;
      }
      st.holdN--;
      const lv = st.levels;
      let uL = st.holdL;
      if (uL > 1) uL = 1; else if (uL < -1) uL = -1;
      let uR = st.holdR;
      if (uR > 1) uR = 1; else if (uR < -1) uR = -1;
      vL = Math.round(uL * lv) / lv;
      vR = Math.round(uR * lv) / lv;
    }

    /* tone: one-pole tilt, out = 2*((1-2t)*lp + t*v); t=0.5 -> exact passthrough */
    st.lpL += (vL - st.lpL) * st.aTone;
    st.lpR += (vR - st.lpR) * st.aTone;
    const kt = 2 * st.cTone;
    const kl = 2 * (1 - kt);
    st.oL = kl * st.lpL + kt * vL;
    st.oR = kl * st.lpR + kt * vR;
  }

  return {
    VERSION: VERSION,
    version: VERSION,
    PREFIX: PREFIX,
    MODES: MODES,
    createState: createState,
    bindEngine: bindEngine,
    reset: reset,
    setParam: setParam,
    process: process,
    fold01: fold01,
  };
})();
if (typeof AVDSP !== "undefined" && typeof AVDSP.registerFx === "function") AVDSP.registerFx("drive", AVFXDRIVE);
