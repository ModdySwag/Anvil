/* av_ladder.js -- Anvil P2 filter v2: the Moog-ladder kernel (module `AVLADDER`, child G).
   Wave contract: verify/_p2_wave.md section 3.4 (lines 144-151) -- a KERNEL, not a kind:
   no registerKind, no kext, no param paths, no PREFIX; the parent wires filter.mode =
   'ladder24' (5th filter-mode enum value) + filter.drive into the VA path afterwards
   (src/av_dsp.js voiceStep2x / recomputeFilter are the parent's edit surface).

   MATH LINEAGE (cited so the port stays auditable):
   - Huovilainen, "Non-linear digital implementation of the Moog ladder filter", DAFx-04,
     Naples -- PDF verification recorded in research/engine/T5-web-audio-engine.md line 175;
     structure summary at T5 lines 178-180: four one-pole stages in a feedback loop, tanh
     saturation in the forward path, an efficient nonlinear solve with tuning compensation
     ("so the model doesn't blow up or detune"), and "requires 2x oversampling to keep the
     nonlinearity's aliasing down".
   - The MoogLadders reference family (github.com/ddiakopoulos/MoogLadders, Unlicense /
     public domain -- licence recorded in verify/_p2_wave.md section 8 and docs/03-
     implementation-spec.md line 57) is the structural reference for the improved nonlinear
     ladder. This file is our own clean text following that published structure (not a
     verbatim copy); no third-party code text is included.
   - Coefficient convention g = tan(pi*fc/fs) is shared with the house SVF kernel
     (T5 section 11, line 153; src/av_dsp.js recomputeFilter lines 772-780) so both filter
     modes read the same units. The ladder runs INSIDE the 2x voice core: callers pass
     fs = fs2 = 2*base rate and update coefficients at the parent's recompute cadence
     (>= every 16 output samples, i.e. every 32 ladder samples).

   STRUCTURE (per 2x sample; stage i = 1..4, TPT = topology-preserving transform):
       G   = g / (1 + g)                  -- bilinear one-pole coefficient from g
       v_i = G * tanh(vin_i - s_i)        -- saturating differential pair (tanh-staged)
       y_i = s_i + v_i                    -- stage output (tap; exposed as state.y1..y4)
       s_i = y_i + v_i                    -- TPT integrator state update
       stage-1 input: u   = x - k * fbc
       fbc = fb1 + FB_C * (fb1 - fb2)     -- half-sample-lag compensation of the one-sample
                                             feedback delay (fb1/fb2 = last two 4-pole outs)
   DC behaviour: with vin constant, tanh(vin - s) -> 0 forces s -> vin, so each stage passes
   DC exactly (no bass squashing); saturation acts on fast differences (the ladder's classic
   compression), and |tanh| <= 1 bounds every state.

   SELF-OSCILLATION / TUNING COMPENSATION: the linearised loop (4 TPT one-poles + feedback
   -k*F(z), F = the compensated delay) has exactly one 180-degree phase crossover. kOsc(fc,
   fs2) solves the discrete phase condition 4*atan(nu) + lagF(w) = pi by bisection and
   returns the loop-gain threshold (-> 4 in the continuous / zero-delay / low-fc limit, the
   classic ladder threshold; the discrete solve sits slightly below it and falls further as
   fc approaches Nyquist -- measured table in the harness). setCoeffs maps reso 0..1 ->
   k = reso * OSC_MARGIN * kOsc, so at EVERY cutoff reso = 1 sits a fixed margin above onset
   (tanh settles the limit-cycle amplitude) and reso = 0 is the linear 4-pole. This is the
   "tuning compensation so the model doesn't blow up or detune" leg of the Huovilainen
   structure (T5 line 178), computed for the discrete loop instead of assuming k = 4.

   PARENT INTEGRATION (av_dsp.js side -- reported, the child never edits it):
     voice create    : v.lad = AVLADDER.createState();            one state per voice, no kext
     reinitVoice     : AVLADDER.resetState(v.lad);                (else a limit cycle leaks in)
     recomputeFilter : AVLADDER.setCoeffs(v.lad, fc, eng.fs2, eng.cReso);   ~0.4 us/call
     voiceStep2x     : return AVLADDER.process(v.lad, x, v.lad.g, v.lad.k);
     filter.drive    : parent-side tanh pre-gain into BOTH modes (wave section 2.2); this
                       kernel's stages also saturate, so drive compounds -- tune the pre-gain
                       map against ladder24 renders (owner pass).

   LAWS (worklet-safe, P2 section 1): strict mode; exactly ONE top-level name (AVLADDER); no
   DOM/window/document/location; alloc-free process() (state preallocated in createState();
   only numbers touched, fixed shape); no NaN paths for finite x (g/k clamped at entry, the
   only division is 1/(1+g) with g >= 0); never throws.
   Harness: scratch/p2/ladder/ladder_node.mjs (stability scan, self-osc, THD, response). */

"use strict";
const AVLADDER = (function () {

  const VERSION = "p2.0";

  /* ---- constants ---- */
  const OSC_MARGIN = 1.12;   /* reso=1 -> k = OSC_MARGIN * kOsc(fc, fs2) */
  const FB_C = 0.5;          /* feedback half-sample-lag factor: fbc = fb1 + FB_C*(fb1 - fb2).
                                Exactly 0.5 removes half of the one-sample feedback lag
                                (|F| <= 2 at Nyquist; boundedness rests on the stage tanh) */
  const G_MAX = 4.0;         /* g ceiling: G = g/(1+g) <= 0.8; fc edge 0.45*fs2 -> tan() = 6.3 */
  const K_MAX = 6.0;         /* hard feedback ceiling (mapping never passes OSC_MARGIN*4) */
  const FC_MIN = 10;         /* Hz; matches the house filter floor (src/av_dsp.js line 772) */
  const FC_MAX_FRAC = 0.45;  /* fc <= 0.45*fs2 */
  const KOSC_ITERS = 10;     /* bisection steps on [0, wc]: 0.1% relative resolution (the margin
                                absorbs it; the root is always < wc, see kOsc) */

  /* ---- state ---- */
  /* createState() -> preallocated, fixed-shape plain object. Fields:
       s1..s4  TPT integrator states (one per pole)
       fb1,fb2 last two 4-pole outputs (feedback history for the half-sample compensation)
       y1..y4  stage outputs (4-pole taps) written by the last process() call
       g,k     coefficients as last written by setCoeffs (process() also takes them as args)
       kOsc    the threshold kOsc(fc,fs2) cached by setCoeffs (diagnostic/telemetry) */
  function createState() {
    return {
      s1: 0, s2: 0, s3: 0, s4: 0,
      fb1: 0, fb2: 0,
      y1: 0, y2: 0, y3: 0, y4: 0,
      g: 0, k: 0, kOsc: 4,
    };
  }

  /* zero the audio state (call on voice (re)init so a stale limit cycle never leaks into a
     new note); coefficients (g/k/kOsc) are kept -- setCoeffs owns them. */
  function resetState(st) {
    st.s1 = 0; st.s2 = 0; st.s3 = 0; st.s4 = 0;
    st.fb1 = 0; st.fb2 = 0;
    st.y1 = 0; st.y2 = 0; st.y3 = 0; st.y4 = 0;
  }

  /* g = tan(pi*fc/fs) (T5 line 153 convention), clamped + finite for any input. */
  function gFor(fc, fs2) {
    let f = Number(fc), s = Number(fs2);
    if (!(f > FC_MIN)) f = FC_MIN;                       /* also catches NaN: NaN > x is false */
    if (!(s > 0)) s = 48000;
    const fmax = FC_MAX_FRAC * s;
    if (f > fmax) f = fmax;
    const g = Math.tan(Math.PI * f / s);
    if (!(g > 0)) return 1e-9;                           /* fc -> 0 edge: floor, never 0/neg/NaN */
    return g > G_MAX ? G_MAX : g;
  }

  /* kOsc(fc, fs2): the linear self-oscillation threshold of the discrete loop.
     Loop: L(w) = [1/(1 + j*nu)]^4 * F(w) * k, nu = tan(w/2)/tan(wc/2)  (uniform warped ratio),
       F(w) = e^-jw * (1 + FB_C - FB_C*e^-jw)  (the compensated feedback filter),
       lagF(w) = w - atan2(FB_C*sin w, 1 + FB_C - FB_C*cos w).
     Phase condition: 4*atan(nu) + lagF(w) = pi; magnitude 1 at the crossing gives
       kOsc = (1 + nu^2)^2 / |F(w)|.
     h(w) is strictly increasing (atan(nu) rises with w; lagF rises too), h(0) = -pi < 0 and
     h(wc) = lagF(wc) > 0 -> bisection on [0, wc] is unconditionally safe. Returns a finite
     number >= ~1.2 over fc in [FC_MIN, FC_MAX_FRAC*fs2]; falls back to 4 if an edge ever
     produced non-finite. */
  function kOsc(fc, fs2) {
    let f = Number(fc), s = Number(fs2);
    if (!(f > FC_MIN)) f = FC_MIN;
    if (!(s > 0)) s = 48000;
    const fmax = FC_MAX_FRAC * s;
    if (f > fmax) f = fmax;
    const wc = 2 * Math.PI * f / s;            /* digital cutoff angle wc = 2*pi*fc/fs2 */
    const twc = Math.tan(wc * 0.5);
    /* Bracket [0, wc]: at nu = 1 (w = wc) the four stages alone give pi of lag, so h(wc) =
       lagF(wc) > 0 and the root (4*atan(nu) = pi - lagF < pi) always sits below wc. */
    let lo = 0, hi = wc;
    for (let i = 0; i < KOSC_ITERS; i++) {
      const mid = 0.5 * (lo + hi);
      const sn = Math.sin(mid), cs = Math.cos(mid);
      const nu = Math.tan(mid * 0.5) / twc;
      const lag = mid - Math.atan2(FB_C * sn, 1 + FB_C - FB_C * cs);
      const h = 4 * Math.atan(nu) + lag - Math.PI;
      if (h < 0) lo = mid; else hi = mid;
    }
    const w = 0.5 * (lo + hi);
    const sn = Math.sin(w), cs = Math.cos(w);
    const nu = Math.tan(w * 0.5) / twc;
    const br = Math.sqrt((1 + FB_C - FB_C * cs) * (1 + FB_C - FB_C * cs) + FB_C * sn * FB_C * sn);
    const q = (1 + nu * nu) * (1 + nu * nu) / br;
    return (q > 0 && q < 1e6) ? q : 4;
  }

  /* setCoeffs(st, fc, fs2, reso): write st.g / st.k (and cache st.kOsc). Allocation-free.
     reso is clamped to [0,1] NaN-safe. k = reso * OSC_MARGIN * kOsc -- monotone in reso, so
     the sustained self-osc amplitude rises with reso (verified by the harness). */
  function setCoeffs(st, fc, fs2, reso) {
    st.g = gFor(fc, fs2);
    const ko = kOsc(fc, fs2);
    st.kOsc = ko;
    let r = Number(reso);
    if (!(r > 0)) r = 0;               /* NaN-safe: NaN -> 0 */
    else if (r > 1) r = 1;
    let kk = r * OSC_MARGIN * ko;
    if (kk > K_MAX) kk = K_MAX;
    st.k = kk;
  }

  /* process(st, x, g, k) -> y (the 4-pole lowpass output; also stored as st.y4).
     One 2x-rate sample. Allocation-free: numbers only. */
  function process(st, x, g, k) {
    /* NaN-safe clamps (NaN -> 0/floor); keeps every downstream op finite for finite x */
    if (!(g > 0)) g = 0; else if (g > G_MAX) g = G_MAX;
    if (!(k > 0)) k = 0; else if (k > K_MAX) k = K_MAX;
    const G = g / (1 + g);
    const fb = st.fb1;
    const u = x - k * (fb + FB_C * (fb - st.fb2));
    let s = st.s1, d = u - s, v = G * Math.tanh(d), y = s + v;
    st.s1 = y + v; st.y1 = y;
    s = st.s2; d = y - s; v = G * Math.tanh(d); y = s + v;
    st.s2 = y + v; st.y2 = y;
    s = st.s3; d = y - s; v = G * Math.tanh(d); y = s + v;
    st.s3 = y + v; st.y3 = y;
    s = st.s4; d = y - s; v = G * Math.tanh(d); y = s + v;
    st.s4 = y + v;
    st.fb2 = fb; st.fb1 = y;
    st.y4 = y;
    return y;
  }

  return {
    VERSION: VERSION,
    version: VERSION,          /* alias: av_dsp's introspection convention (AVDSP.version) */
    createState: createState,
    resetState: resetState,
    process: process,
    setCoeffs: setCoeffs,
    gFor: gFor,
    kOsc: kOsc,
  };
})();
