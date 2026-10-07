/* av_fx_aw.js -- Anvil M1 studio flavours bank: five bus-colour modes (module `AVFXAW`, child sa-C).
   Wave contract: verify/_m1_wave.md section 2.3 (studio flavours bank) + section 5 (watch-outs).
   One text, three scopes: bundled in the single-file app (build.py js_parts), concatenated into the
   audio-worklet module by build.py (the parent wires it after av_fx_dyn), and loaded verbatim by the
   scratch node harness (cache/scratch/m1/aw/harness.mjs).

   CLEAN-ROOM LINEAGE (no third-party code anywhere in this file): Airwindows-class "bus flavour"
   processing is the design target -- subtle always-available console / tape / drive / air / warm
   colour that a mix bus can sit in. Every algorithm below is authored from first principles out of
   textbook DSP families (biased asymmetric tanh soft-clipping for even-harmonic colour, one-pole
   low/high shelves, one-pole DC blocking, band-split nonlinear HF exciters, one-pole tilt EQ). No
   external code, constants or tunings were copied; names in these comments are technique families,
   not ports.

   LAWS (do not drift; same house laws as av_fx_verb/av_fx_drive/av_fx_dyn):
   - exactly ONE top-level name (AVFXAW). "use strict". No DOM/window/document/console, no page
     reach-ins of any kind: this text runs inside the audio scope.
   - process() allocates nothing: every filter state and scratch array is created in createState()
     (the ONLY allocation site in this file); the per-sample path touches preallocated state only.
   - deterministic: there is no randomness anywhere in this module -- same state + same input gives
     bit-identical output.
   - never NaN: the entry guard zeroes non-finite / absurd inputs; every shaper is bounded (tanh);
     every filter is a one-pole whose coefficient lies in (0,1) (feedback < 1 by construction); the
     DC blocker feedback exp(-2*pi*fc/sr) < 1; divisions are by positive constants only.
   - ONE stereo sample per call; the result is the WET signal in st.oL/st.oR. The parent owns the
     dry/wet blend (FX_WET slot = 1). When st.on === 0 or st.mix <= 0 process() copies the input to
     st.oL/st.oR bit-identically and runs no DSP (module-side null guarantee).

   WET CONVENTION (section 5): this module writes the fully processed signal and NEVER blends
   dry/wet internally -- double-blending is the classic bug, and the harness null law (mix=0
   bit-identical) catches it.

   MODES (5; enum; all share one skeleton: a mode character chain that each stage amount-blends
   against an exact identity, then a shared one-pole tone tilt whose tone=0.5 setting is an exact
   passthrough. amount=0 + tone=0.5 is therefore a bit-identical wire -- an honest zero):
     console  subtle even-harmonic headroom colour: a gently biased asymmetric tanh saturation
              (bias > 0 pushes energy into the EVEN harmonics) followed by a 10 Hz one-pole DC
              blocker that removes the asymmetry offset; both are amount-blended. No EQ of its own:
              the character is a hair of 2nd-harmonic air and a slightly compressed peak -- sitting
              in a good desk.
     tape     soft sat + gentle HF loss + low bump: symmetric tanh saturation, then a low bump
              (one-pole LP at 90 Hz added back, up to +3.5 dB asymptotically at DC) and a gentle
              first-order HF loss (one-pole LP at 12 kHz), both amount-blended -- the classic
              reel-print curve.
     drive    asymmetric harder edge: two cascaded tanh stages -- a hot biased asymmetric stage into
              a symmetric stage -- DC-blocked; sweeps to far more harmonic bite (odd-dominant; the
              bias leaves a small even-order residue) and more peak compression than console.
     air      nonlinear HF shelf / exciter: the input is split at 3.2 kHz (one-pole); the HF band is
              driven through tanh (small HF reads as a state-dependent +HF shelf; loud HF becomes an
              exciter that generates new harmonics) and summed back -- brightness that scales with
              level, never a fixed EQ lift.
     warm     low-tilt thickener: a one-pole LP at 160 Hz feeds a saturated low band (tanh) that is
              added back to the dry path -- weight and low-band fullness, with no HF change of its
              own (the shared tone control can still darken it).

   PARAMS (fx.aw.*; setParam accepts the full path or the bare `aw.` form):
     on      0 | 1                                                 default 0
     mix     0..1                                                  default 1
     mode    "console" | "tape" | "drive" | "air" | "warm"         default "console"
     amount  0..1  character depth (blend from exact identity)     default 0.5
     tone    0..1  shared post one-pole tilt around 800 Hz; 0.5 is an exact passthrough  default 0.5
   Unknown path or non-finite value -> false, never throws. A numeric mode index 0..4 is also
   accepted (mirrors av_fx_drive's mode handling).

   CADENCE: setParam stores targets only (block-safe); amount/tone glide through 15 ms one-poles;
   every audio coefficient is either sr-derived (recomputed in derive() from createState/bindEngine)
   or computed per sample from the smoothed scalars -- no recompute cliffs, no per-sample allocation.

   STATE FIELDS (all created in createState; documented for the parent):
     st.oL / st.oR          wet output (one stereo sample); st.on / st.mix read by the parent
     st.sr                  sample rate (createState opts.sampleRate, then bindEngine -> eng.sr)
     st.modeId              0 console / 1 tape / 2 drive / 3 air / 4 warm
     st.tAmount, st.cAmount raw + 15 ms-smoothed amount; st.tTone, st.cTone the same for tone
     st.f1, f2, f3          Float64Array(2) per-channel one-pole filter states
     st.dcX, st.dcY         Float64Array(2) per-channel DC-blocker x[n-1] / y[n-1] states
     st.out                 Float64Array(2) per-sample scratch
   reset() zeroes the audio state and snaps the smoothers to their targets.

   Harness: cache/scratch/m1/aw/harness.mjs (child sa-C; not shipped). */

"use strict";
const AVFXAW = (function () {

  const VERSION = "m1.0";
  const PREFIX = "aw";
  const MODES = ["console", "tape", "drive", "air", "warm"];

  /* ---- shared constants ---- */
  const SMOOTH_MS = 0.015;                 /* amount/tone one-pole time constant (15 ms, house) */
  const TONE_FC = 800;                     /* shared tone tilt pivot (Hz), same as av_fx_drive */
  const DC_FC = 10;                        /* console/drive DC blocker corner (Hz) */
  const MAX_X = 1e6;                       /* entry guard: |x| beyond this (or non-finite) -> 0 */
  const TWO_PI = 6.283185307179586;

  /* ---- per-mode constants (fixed character; amount blends it against identity) ----
     Level trim law: every mode ends its character chain with  mk = 1 / (1 + MKC * amount),
     which tracks the drive-induced small-signal gain so the wet level stays near unity at any
     amount (mk = 1 at amount 0, keeping the identity exact). MKC values are measured in the
     scratch harness on a 0.5-amplitude tone and rounded. */
  /* console: drive 1.00..1.60, bias 0.04..0.12, trim 1/(1+0.40*amount) */
  const CO_G0 = 1.00, CO_GA = 0.60, CO_B0 = 0.04, CO_BA = 0.08, CO_MKC = 0.40;
  /* tape: drive 1.70..3.00, trim 1/(1+0.85*amount); low-bump add-back (asymptote +TP_LOK at
     DC), HF-loss one-pole TP_HFFC, low-bump one-pole TP_LOFC */
  const TP_G0 = 1.70, TP_GA = 1.30, TP_MKC = 0.85, TP_LOK = 0.50;
  const TP_LOFC = 90, TP_HFFC = 12000;
  /* drive: stage-1 drive 2.20..7.20 + bias 0.10..0.38, stage-2 drive 1.50..2.40,
     trim 1/(1+1.50*amount) */
  const DV_G0 = 2.20, DV_GA = 5.00, DV_B0 = 0.10, DV_BA = 0.28, DV_G2 = 1.50, DV_GA2 = 0.90, DV_MKC = 1.50;
  /* air: HF split 3.2 kHz, HF exciter drive AI_EX, exciter depth AI_K, trim 1/(1+0.10*amount) */
  const AI_K = 0.60, AI_EX = 3.00, AI_SPLIT = 3200, AI_MKC = 0.10;
  /* warm: low band one-pole 160 Hz, add-back gain WM_K, low-band tanh drive WM_SAT,
     saturated-low share WM_KS, trim 1/(1+0.10*amount) */
  const WM_K = 0.65, WM_SAT = 3.00, WM_KS = 0.45, WM_LOFC = 160, WM_MKC = 0.10;

  function cl(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* sr-derived one-pole coefficients. Called from createState / bindEngine only (block-rate). */
  function derive(st) {
    const sr = st.sr;
    st.aSm = 1 - Math.exp(-1 / (SMOOTH_MS * sr));
    st.aTone = 1 - Math.exp(-TWO_PI * TONE_FC / sr);
    st.dcR = Math.exp(-TWO_PI * DC_FC / sr);                          /* DC feedback, < 1 */
    st.aLo90 = 1 - Math.exp(-TWO_PI * TP_LOFC / sr);
    st.aHf = 1 - Math.exp(-TWO_PI * TP_HFFC / sr);
    st.aSplit = 1 - Math.exp(-TWO_PI * AI_SPLIT / sr);
    st.aLo160 = 1 - Math.exp(-TWO_PI * WM_LOFC / sr);
  }

  /* ---------------- state ---------------- */
  function createState(opts) {
    const st = {
      on: 0, mix: 1, modeId: 0,
      tAmount: 0.5, cAmount: 0.5, tTone: 0.5, cTone: 0.5,
      sr: 48000,
      aSm: 0, aTone: 0, dcR: 0, aLo90: 0, aHf: 0, aSplit: 0, aLo160: 0,
      f1: new Float64Array(2),
      f2: new Float64Array(2),
      f3: new Float64Array(2),
      dcX: new Float64Array(2),
      dcY: new Float64Array(2),
      out: new Float64Array(2),
      oL: 0, oR: 0,
    };
    if (opts && typeof opts === "object") {
      const sr = Number(opts.sampleRate);
      if (isFinite(sr) && sr >= 8000 && sr <= 192000) st.sr = sr;
    }
    derive(st);
    return st;
  }

  /* parent hook: sr comes from eng.sr (or eng.sampleRate); rederive the one-pole coefficients */
  function bindEngine(st, eng) {
    if (!st) return false;
    if (eng) {
      const sr = Number(eng.sr !== undefined ? eng.sr : eng.sampleRate);
      if (isFinite(sr) && sr >= 8000 && sr <= 192000) st.sr = sr;
    }
    derive(st);
    return true;
  }

  /* zero every audio state; params stay. Smoothers snap to targets (no glide after reset). */
  function reset(st) {
    if (!st) return false;
    st.cAmount = st.tAmount;
    st.cTone = st.tTone;
    st.f1[0] = 0; st.f1[1] = 0;
    st.f2[0] = 0; st.f2[1] = 0;
    st.f3[0] = 0; st.f3[1] = 0;
    st.dcX[0] = 0; st.dcX[1] = 0;
    st.dcY[0] = 0; st.dcY[1] = 0;
    st.out[0] = 0; st.out[1] = 0;
    st.oL = 0; st.oR = 0;
    return true;
  }

  /* ---------------- params (fx.aw.*; full path or bare `aw.` form; unknown -> false) ---------------- */
  function setParam(st, path, value) {
    if (!st || typeof path !== "string") return false;
    let p = path;
    if (p.slice(0, 3) === "fx.") p = p.slice(3);
    switch (p) {
      case "aw.on": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.on = n > 0 ? 1 : 0;
        return true;
      }
      case "aw.mix": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.mix = cl(n, 0, 1);
        return true;
      }
      case "aw.mode": {
        let e = MODES.indexOf(String(value));
        if (e < 0) {
          const n = Number(value);
          if (isFinite(n) && n >= 0 && n <= 4 && Math.floor(n) === n) e = n;
        }
        if (e < 0) return false;
        st.modeId = e;
        return true;
      }
      case "aw.amount": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.tAmount = cl(n, 0, 1);
        return true;
      }
      case "aw.tone": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.tTone = cl(n, 0, 1);
        return true;
      }
      default:
        return false;
    }
  }

  /* ---------------- per-mode character chains (amount-blended; states preallocated) ----------------
     Every stage is written as  out = in + amount * (character(in) - in)  so that amount=0 is an
     exact identity at every stage, the character rises monotonically with amount, and each stage
     blend stays exactly zero at zero instead of relying on a filter tuned to do nothing. */

  /* console: biased asymmetric tanh -> one-pole DC blocker (offset removal), both amount-blended */
  function consoleCh(st, xL, xR) {
    const a = st.cAmount;
    const g = CO_G0 + CO_GA * a;
    const b = CO_B0 + CO_BA * a;
    const cb = Math.tanh(b);
    const mk = 1 / (1 + CO_MKC * a);
    const dx = st.dcX, dy = st.dcY, out = st.out;
    for (let ch = 0; ch < 2; ch++) {
      const x = ch === 0 ? xL : xR;
      const s = Math.tanh(g * x + b) - cb;          /* bounded in (-1,1), s(0)=0, even harmonics */
      let v = x + a * (s - x);
      const d = v - dx[ch] + st.dcR * dy[ch];       /* one-pole DC blocker, feedback < 1 */
      dx[ch] = v; dy[ch] = d;
      v += a * (d - v);
      out[ch] = v * mk;
    }
  }

  /* tape: symmetric tanh -> low bump (one-pole 90 Hz add-back) -> gentle HF loss (one-pole 12 kHz) */
  function tapeCh(st, xL, xR) {
    const a = st.cAmount;
    const g = TP_G0 + TP_GA * a;
    const mk = 1 / (1 + TP_MKC * a);
    const kl = TP_LOK * a;
    const f1 = st.f1, f2 = st.f2, out = st.out;
    for (let ch = 0; ch < 2; ch++) {
      const x = ch === 0 ? xL : xR;
      let v = x + a * (Math.tanh(g * x) - x);
      v *= mk;
      f2[ch] += st.aLo90 * (v - f2[ch]);            /* low band */
      v += kl * f2[ch];                             /* low bump */
      f1[ch] += st.aHf * (v - f1[ch]);              /* softened band */
      v += a * (f1[ch] - v);                        /* gentle HF loss */
      out[ch] = v;
    }
  }

  /* drive: biased asymmetric tanh stage -> symmetric tanh stage -> DC blocker, all amount-blended */
  function driveCh(st, xL, xR) {
    const a = st.cAmount;
    const g1 = DV_G0 + DV_GA * a;
    const b = DV_B0 + DV_BA * a;
    const cb = Math.tanh(b);
    const g2 = DV_G2 + DV_GA2 * a;
    const mk = 1 / (1 + DV_MKC * a);
    const dx = st.dcX, dy = st.dcY, out = st.out;
    for (let ch = 0; ch < 2; ch++) {
      const x = ch === 0 ? xL : xR;
      const s1 = Math.tanh(g1 * x + b) - cb;
      const s2 = Math.tanh(g2 * s1);
      let v = x + a * (s2 - x);
      const d = v - dx[ch] + st.dcR * dy[ch];
      dx[ch] = v; dy[ch] = d;
      v += a * (d - v);
      out[ch] = v * mk;
    }
  }

  /* air: one-pole HF split at 3.2 kHz; the HF band is tanh-driven (state-dependent +HF shelf /
     exciter that generates new harmonics when driven) and summed back */
  function airCh(st, xL, xR) {
    const a = st.cAmount;
    const mk = 1 / (1 + AI_MKC * a);
    const f1 = st.f1, out = st.out;
    for (let ch = 0; ch < 2; ch++) {
      const x = ch === 0 ? xL : xR;
      f1[ch] += st.aSplit * (x - f1[ch]);           /* low band */
      const hf = x - f1[ch];                        /* high band */
      const ex = x + AI_K * (Math.tanh(AI_EX * hf) - hf);
      out[ch] = (x + a * (ex - x)) * mk;
    }
  }

  /* warm: one-pole low band at 160 Hz -> saturated low fullness (tanh) -> add back */
  function warmCh(st, xL, xR) {
    const a = st.cAmount;
    const mk = 1 / (1 + WM_MKC * a);
    const f2 = st.f2, out = st.out;
    for (let ch = 0; ch < 2; ch++) {
      const x = ch === 0 ? xL : xR;
      f2[ch] += st.aLo160 * (x - f2[ch]);           /* low band */
      const lo = f2[ch];
      const thick = lo + WM_KS * (Math.tanh(WM_SAT * lo) - lo);
      const ex = x + WM_K * thick;
      out[ch] = (x + a * (ex - x)) * mk;
    }
  }

  /* ---------------- the per-sample path (alloc-free) ---------------- */
  function process(st, xL, xR) {
    /* module-side null guarantee: on=0 or mix<=0 passes the input through bit-identically and
       runs no DSP. The parent's dry*(1-mix)+wet*mix blend yields the identical result. */
    if (st.on === 0 || st.mix <= 0) { st.oL = xL; st.oR = xR; return; }
    /* entry guard: non-finite / absurd input -> 0 (receiver state stays finite forever) */
    if (!(xL >= -MAX_X && xL <= MAX_X)) xL = 0;
    if (!(xR >= -MAX_X && xR <= MAX_X)) xR = 0;

    st.cAmount += (st.tAmount - st.cAmount) * st.aSm;
    st.cTone += (st.tTone - st.cTone) * st.aSm;

    const mi = st.modeId;
    if (mi === 0) consoleCh(st, xL, xR);
    else if (mi === 1) tapeCh(st, xL, xR);
    else if (mi === 2) driveCh(st, xL, xR);
    else if (mi === 3) airCh(st, xL, xR);
    else warmCh(st, xL, xR);

    /* shared post tone tilt: one-pole at 800 Hz, out = (1+s)*v - 2*s*lp with s = 2*tone-1.
       tone=0.5 -> s=0 -> out = v exactly; tone=1 -> 2*HP side; tone=0 -> 2*LP side. */
    const f3 = st.f3, out = st.out;
    const sT = 2 * st.cTone - 1;
    const k0 = 1 + sT, k1 = 2 * sT;
    f3[0] += st.aTone * (out[0] - f3[0]);
    f3[1] += st.aTone * (out[1] - f3[1]);
    st.oL = k0 * out[0] - k1 * f3[0];
    st.oR = k0 * out[1] - k1 * f3[1];
  }

  return {
    version: VERSION,
    VERSION: VERSION,
    PREFIX: PREFIX,
    MODES: MODES,
    createState: createState,
    bindEngine: bindEngine,
    reset: reset,
    setParam: setParam,
    process: process,
  };
})();
if (typeof AVDSP !== "undefined" && typeof AVDSP.registerFx === "function") AVDSP.registerFx("aw", AVFXAW);
