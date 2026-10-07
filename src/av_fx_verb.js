/* av_fx_verb.js -- Anvil P3 FX module A: the flagship reverb (plate / FDN / Freeverb, mode-switched).
   Contract: verify/_p3_wave.md sections 2.1 (FX module interface) + 3.1 (this spec) + 8 (laws).
   One text, three scopes: bundled in the single-file app, concatenated into the audio-worklet
   module by build.py (the parent wires it), and loaded verbatim by the scratch node harness.
   LAWS (do not drift):
   - exactly ONE top-level name (AVFXVERB). strict mode. No DOM/window/document/console, no
     page reach-ins of any kind: this text runs inside the audio scope.
   - process() allocates nothing: every delay line and every scratch array is created in
     createState() (one state per engine, created via the parent's registerFx machinery);
     the per-sample path touches preallocated memory only.
   - deterministic: there is no randomness anywhere in this module (the tank modulation is two
     fixed-rate cosines) -- same state + same input gives bit-identical output.
   - never NaN: every feedback gain is < 1 by construction; every param is clamped; divisions
     are by positive constants only.
   - ONE stereo sample per call; result in st.oL / st.oR (the WET signal; the parent owns the
     dry/wet blend, section 2.1). When st.mix == 0 (or st.on == 0) process() writes the input
     through bit-identically and skips the DSP -- the module-side null guarantee.

   MATHS LINEAGE (clean-room; published references only, no third-party code):
   - PLATE: Jon Dattorro, "Effect Design, Part 1: Reverberator and Other Filters", J. Audio Eng.
     Soc. 45(9), 1997. Topology = the paper's figure-of-eight tank; Table 1 defaults
     (input diffusion 0.75/0.625, decay diffusion 1 = 0.70, decay diffusion 2 = 0.50 coupled
     `dd2 = decay+0.15, floor .25, ceiling .50`, bandwidth ~open, damping ~0, excursion 16 max);
     Table 2 output taps; the eight loop delay lengths 672/4453/1800/3720/908/4217/2656/3163
     samples at 29,761 Hz were cross-checked 2026-10-07 against the public-domain port
     khoin/DattorroReverbNode (LICENSE: public domain, verified in research/engine/T5 sec.15).
     Tank signal flow verified on paper: g_figure-eight = dc^4 per full revolution, so
     dc = exp(-ln(1000)/4 * trip/T60) makes the decay knob hit its T60 target (see recalc()).
   - FREEVERB: canonical public-domain tuning.h (Jezar @ Dreampoint, June 2000): 8 lowpass-feedback
     combs + 4 series allpasses per channel, comb tunings 1116..1617 samples at 44.1 kHz,
     allpasses 556/441/341/225, stereospread 23 on the right bank, allpass gain 0.5, scaledamp 0.4.
     Read from a primary mirror 2026-10-07 -- this RESOLVES docs/05 section 3 option 7 (the wave
     contract required the constants be resolved before hardcoding; evidence: tuning.h + revmodel +
     comb/allpass sources fetched and matched against the PASP Freeverb chapter).
   - FDN: feedback delay network with Hadamard feedback (Jot lineage; PASP "Feedback Delay
     Networks" chapter), 8 mutually prime delay lengths (own set, stated at 48 kHz), per-line
     one-pole damping and per-line decay gains g_i = 10^(-3 T_i/T60) -> exact T60 per line.

   PARAMS (fx.verb.*; setParam accepts the full path or the bare `verb.` form):
     mode      enum "plate" | "fdn" | "freeverb"   default "plate"
     size      0..1   (geometry scale 0.6..1.4 of all loop delays)    default 0.5
     decay     0..1   (T60 = 0.3 * 40^decay seconds, 0.3 .. 12 s)     default 0.5
     damp      0..1   (one-pole HF damping: plate/FDN tank cd = 1 - 0.98*damp, 0 = fully
                       open, 1 = near-frozen ~150 Hz; Freeverb comb: classic
                       scaledamp 0.4 mapping)                           default 0.3
     predelay  0..0.15 s (wet input delay, shared by all modes)        default 0.01
     on        0 | 1                                                   default 0
     mix       0..1                                                    default 0.3

   STATE FIELDS (all created in createState; documented for the parent):
     st.sr        sample rate (from bindEngine(eng) -> eng.sr; default 48000)
     st.eng       engine backref when bindEngine ran (else null)
     st.modeId    0 plate / 1 fdn / 2 freeverb
     st.on, st.mix  parent-facing bypass/mix flags (st.mix read by the parent blend)
     st.size, st.decay, st.damp, st.predelay  the four 0..1 (or s) knobs
     st.pd        shared predelay line; st.pdL  runtime predelay in samples
     st.pl        plate engine state (12 lines d[0..11], len/tap/clamp/gains/filter states)
     st.fd        FDN engine state (8 lines, per-line gain + damping + Hadamard scratch)
     st.fv        Freeverb engine state (combL/R, apL/R banks, per-comb gain + fstate)
   */

const AVFXVERB = (function () {

  const VERSION = "p3.0";
  const PREFIX = "verb";
  const MODES = ["plate", "fdn", "freeverb"];

  /* allocation cap: delay buffers are sized for the largest device rate supported; runtime
     lengths (samples) scale with st.sr and are clamped into the preallocated caps. */
  const SR_CAP = 96000;
  const PLATE_REF = 29761;          /* Dattorro's paper sample rate */
  const FV_REF = 44100;             /* Freeverb tuning sample rate */
  const FDN_REF = 48000;            /* FDN prime kit is stated at 48 kHz */
  const TWO_PI = 6.283185307179586;

  /* ---- plate constants (paper at PLATE_REF; cross-checked vs the public-domain port) ---- */
  const PL_IN_REFS = [142, 107, 379, 277];                                  /* input diffusers */
  const PL_LOOP_REFS = [672, 4453, 1800, 3720, 908, 4217, 2656, 3163];      /* d[4..11] loop */
  const PL_TAP_REFS = [266, 2974, 1913, 1996, 1990, 187, 1066, 353, 3627, 1228, 2673, 2111, 335, 121];
  const PL_GI1 = 0.75, PL_GI2 = 0.625;      /* input diffusion 1 / 2 (as +g allpass form) */
  const PL_FT = 0.7;                        /* decay diffusion 1 (negative-sign allpass) */
  const PL_OUT = 0.6;                       /* Table 2 output-tap scale */
  const PL_EXC_REF = 8;                     /* modulation half-excursion, ref samples */
  const PL_EXCA_HZ = 0.93, PL_EXCB_HZ = 1.17;   /* tank mod rates (paper: order of 1 Hz) */
  const DC_K = 1.7269388197455343;          /* ln(1000)/4 (four decay multipliers per trip) */

  /* ---- Freeverb constants (public-domain tuning.h; docs/05 option 7 resolved) ---- */
  const FV_COMB_REFS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const FV_AP_REFS = [556, 441, 341, 225];
  const FV_SPREAD = 23;                     /* stereospread: added to the right bank */
  const FV_AP_GAIN = 0.5;                   /* fixed allpass feedback */
  const FV_DAMP_SCALE = 0.4;                /* scaledamp */

  /* ---- FDN constants: 8 mutually prime lengths (samples at 48 kHz) ---- */
  const FDN_REFS = [2719, 3323, 3697, 4271, 4663, 5179, 5657, 6199];
  const FDN_N = 8;
  const FDN_NORM = 0.35355339059327373;     /* 1/sqrt(8) */

  /* ---- mappings ---- */
  const SIZE_MIN = 0.6, SIZE_SPAN = 0.8;    /* size 0..1 -> 0.6 .. 1.4 geometry scale */
  const T60_MIN = 0.3, T60_SPAN = 40;       /* decay 0..1 -> T60 0.3 .. 12 s */
  const DAMP_OPEN = 1 - 0.98;               /* cd at damp=1: near-frozen one-pole (~150 Hz) */
  const BW_FC = 16000;                      /* plate input bandwidth one-pole */
  const PD_MAX = 0.15;                      /* predelay ceiling, seconds */

  /* ---- small helpers (never called from... they are called per sample but allocate nothing) ---- */
  function cl(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function pow2ceil(x) { let p = 1; while (p < x) p <<= 1; return p; }

  function mkLine(cap) { return { buf: new Float64Array(cap), mask: cap - 1, w: 0 }; }

  /* circular delay line: ln.w = next write slot. lr(ln,d) = the sample written d writes ago
     (d>=1 typical); lw advances the write head. */
  function lw(ln, v) { const w = ln.w; ln.buf[w] = v; ln.w = (w + 1) & ln.mask; }

  function lr(ln, d) { return ln.buf[(ln.w - d) & ln.mask]; }

  /* cubic (Catmull-Rom) read at a fractional delay d >= 1 (modulated tank taps). The four taps
     sit at delays i-1..i+2 for i = floor(d), evaluated at the fraction -> delay i+f = d. */
  function lrc(ln, d) {
    const i = d | 0;
    const f = d - i;
    const w = ln.w, m = ln.mask;
    const p0 = ln.buf[(w - i + 1) & m];
    const p1 = ln.buf[(w - i) & m];
    const p2 = ln.buf[(w - i - 1) & m];
    const p3 = ln.buf[(w - i - 2) & m];
    const c1 = 0.5 * (p2 - p0);
    const c2 = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
    const c3 = 0.5 * (p3 - p0) + 1.5 * (p1 - p2);
    return ((c3 * f + c2) * f + c1) * f + p1;
  }

  /* in-place fast Hadamard transform, N=8 (butterflies) -- 4 stages, no allocation */
  function fht8(h) {
    let step = 1;
    while (step < 8) {
      const step2 = step << 1;
      for (let i = 0; i < 8; i += step2) {
        for (let j = i; j < i + step; j++) {
          const a = h[j], b = h[j + step];
          h[j] = a + b; h[j + step] = a - b;
        }
      }
      step = step2;
    }
  }

  /* ---- per-engine construction ---- */

  function mkPlate() {
    const d = new Array(12);
    for (let i = 0; i < 4; i++) d[i] = mkLine(pow2ceil(PL_IN_REFS[i] * SR_CAP / PLATE_REF + 16));
    for (let i = 4; i < 12; i++) d[i] = mkLine(pow2ceil(PL_LOOP_REFS[i - 4] * 1.4 * SR_CAP / PLATE_REF + 80));
    return {
      d: d,
      len: new Int32Array(12),          /* runtime delay lengths, samples */
      tap: new Int32Array(14),          /* runtime output-tap offsets, samples */
      dc: 0.5,                          /* decay multiplier (recomputed) */
      st2: 0.5,                         /* decay diffusion 2 coefficient (recomputed) */
      cd: 0.5,                          /* damping one-pole coefficient (recomputed) */
      bwC: 0.5,                         /* bandwidth one-pole coefficient (recomputed) */
      exc: 8,                           /* modulation amplitude, samples (recomputed) */
      rateA: 0, rateB: 0,               /* per-sample LFO phase increments (recomputed) */
      lpa: 0, lpb: 0,                   /* tank damping filter states */
      bwz: 0,                           /* input bandwidth filter state */
      phA: 0, phB: 0.25,                /* tank modulation phases (quadrature start) */
      trim: 1.0,                        /* wet-level trim (measured; scratch harness) */
    };
  }

  function mkFdn() {
    const d = new Array(FDN_N);
    for (let i = 0; i < FDN_N; i++) d[i] = mkLine(pow2ceil(FDN_REFS[i] * 1.4 * SR_CAP / FDN_REF + 16));
    return {
      d: d,
      len: new Int32Array(FDN_N),
      g: new Float64Array(FDN_N),       /* per-line decay gain */
      z: new Float64Array(FDN_N),       /* per-line damping one-pole state */
      h: new Float64Array(FDN_N),       /* Hadamard scratch */
      cd: 0.5,
      inj: 0.8,
      trim: 0.46,                       /* wet-level trim (measured; scratch harness) */
    };
  }

  function mkFv() {
    const cl = new Array(8), cr = new Array(8);
    const al = new Array(4), ar = new Array(4);
    for (let i = 0; i < 8; i++) {
      const cap = pow2ceil((FV_COMB_REFS[i] + FV_SPREAD) * 1.4 * SR_CAP / FV_REF + 16);
      cl[i] = mkLine(cap);
      cr[i] = mkLine(cap);
    }
    for (let i = 0; i < 4; i++) {
      const capL = pow2ceil(FV_AP_REFS[i] * 1.4 * SR_CAP / FV_REF + 16);
      const capR = pow2ceil((FV_AP_REFS[i] + FV_SPREAD) * 1.4 * SR_CAP / FV_REF + 16);
      al[i] = mkLine(capL);
      ar[i] = mkLine(capR);
    }
    return {
      cl: cl, cr: cr, al: al, ar: ar,
      clLen: new Int32Array(8), crLen: new Int32Array(8),
      alLen: new Int32Array(4), arLen: new Int32Array(4),
      clG: new Float64Array(8), crG: new Float64Array(8),
      clN: new Float64Array(8), crN: new Float64Array(8),   /* 1 - g (DC normalisation) */
      fl: new Float64Array(8), fr: new Float64Array(8),     /* comb damping filter states */
      d1: 0.12, d2: 0.88,                                   /* comb damping coefficients */
      trim: 0.36,                                           /* wet-level trim (measured) */
    };
  }

  /* ---- state ---- */

  function createState() {
    const st = {
      sr: 48000,
      eng: null,
      modeId: 0,
      on: 0,
      mix: 0.3,
      size: 0.5,
      decay: 0.5,
      damp: 0.3,
      predelay: 0.01,
      pd: mkLine(pow2ceil(PD_MAX * SR_CAP + 16)),
      pdL: 0,
      oL: 0, oR: 0,
      pl: mkPlate(),
      fd: mkFdn(),
      fv: mkFv(),
    };
    recalc(st);
    return st;
  }

  /* zero every delay line + filter state; parameters are kept. */
  function reset(st) {
    if (!st) return false;
    st.pd.buf.fill(0); st.pd.w = 0; st.pl.bwz = 0; st.pl.lpa = 0; st.pl.lpb = 0;
    st.pl.phA = 0; st.pl.phB = 0.25;
    const pl = st.pl;
    for (let i = 0; i < 12; i++) { pl.d[i].buf.fill(0); pl.d[i].w = 0; }
    const fd = st.fd;
    for (let i = 0; i < FDN_N; i++) { fd.d[i].buf.fill(0); fd.d[i].w = 0; fd.z[i] = 0; }
    const fv = st.fv;
    for (let i = 0; i < 8; i++) {
      fv.cl[i].buf.fill(0); fv.cl[i].w = 0;
      fv.cr[i].buf.fill(0); fv.cr[i].w = 0;
      fv.fl[i] = 0; fv.fr[i] = 0;
    }
    for (let i = 0; i < 4; i++) {
      fv.al[i].buf.fill(0); fv.al[i].w = 0;
      fv.ar[i].buf.fill(0); fv.ar[i].w = 0;
    }
    st.oL = 0; st.oR = 0;
    return true;
  }

  /* recompute every derived length/gain after a param or sample-rate change. Allocation-free:
     writes into the preallocated typed arrays only. Called from createState / bindEngine /
     setParam -- never from the per-sample path. */
  function recalc(st) {
    const sr = st.sr;
    const sz = SIZE_MIN + SIZE_SPAN * st.size;
    const t60 = T60_MIN * Math.pow(T60_SPAN, st.decay);
    /* tank damping one-pole: damp=0 fully open (paper/port convention), damp=1 near-frozen */
    const cd = DAMP_OPEN + (1 - DAMP_OPEN) * (1 - st.damp);

    /* ---- plate ---- */
    const pl = st.pl;
    const sP = sr / PLATE_REF;
    for (let i = 0; i < 4; i++) {
      const ln = pl.d[i];
      pl.len[i] = cl(Math.round(PL_IN_REFS[i] * sP), 8, ln.mask - 8);
    }
    let trip = 0;
    for (let i = 4; i < 12; i++) {
      const ln = pl.d[i];
      const L = cl(Math.round(PL_LOOP_REFS[i - 4] * sz * sP), 8, ln.mask - 80);
      pl.len[i] = L;
      trip += L;
    }
    trip /= sr;
    pl.dc = Math.exp(-DC_K * trip / t60);
    pl.st2 = cl(pl.dc + 0.15, 0.25, 0.5);
    pl.cd = cd;
    pl.bwC = 1 - Math.exp(-TWO_PI * Math.min(BW_FC, 0.45 * sr) / sr);
    pl.exc = PL_EXC_REF * sP;
    pl.rateA = PL_EXCA_HZ / sr;
    pl.rateB = PL_EXCB_HZ / sr;
    for (let i = 0; i < 14; i++) pl.tap[i] = cl(Math.round(PL_TAP_REFS[i] * sP), 4, pl.d[5].mask - 4);

    /* ---- fdn ---- */
    const fd = st.fd;
    const sD = sr / FDN_REF;
    for (let i = 0; i < FDN_N; i++) {
      const ln = fd.d[i];
      const L = cl(Math.round(FDN_REFS[i] * sz * sD), 8, ln.mask - 8);
      fd.len[i] = L;
      fd.g[i] = Math.min(0.9995, Math.pow(10, -3 * (L / sr) / t60));
    }
    fd.cd = cd;

    /* ---- freeverb ---- */
    const fv = st.fv;
    const sF = sr / FV_REF;
    for (let i = 0; i < 8; i++) {
      const L = cl(Math.round(FV_COMB_REFS[i] * sz * sF), 8, fv.cl[i].mask - 8);
      const R = cl(Math.round((FV_COMB_REFS[i] + FV_SPREAD) * sz * sF), 8, fv.cr[i].mask - 8);
      fv.clLen[i] = L; fv.crLen[i] = R;
      const gL = Math.min(0.9995, Math.pow(10, -3 * (L / sr) / t60));
      const gR = Math.min(0.9995, Math.pow(10, -3 * (R / sr) / t60));
      fv.clG[i] = gL; fv.crG[i] = gR;
      fv.clN[i] = 1 - gL; fv.crN[i] = 1 - gR;
    }
    for (let i = 0; i < 4; i++) {
      fv.alLen[i] = cl(Math.round((FV_AP_REFS[i]) * sz * sF), 8, fv.al[i].mask - 8);
      fv.arLen[i] = cl(Math.round((FV_AP_REFS[i] + FV_SPREAD) * sz * sF), 8, fv.ar[i].mask - 8);
    }
    const d1 = FV_DAMP_SCALE * st.damp;
    fv.d1 = d1; fv.d2 = 1 - d1;

    /* ---- shared predelay ---- */
    st.pdL = cl(Math.round(st.predelay * sr), 0, st.pd.mask - 2);
  }

  /* optional parent hook: st gets the engine backref; sr comes from eng.sr. */
  function bindEngine(st, eng) {
    if (!st || !eng) return false;
    st.eng = eng;
    const sr = Number(eng.sr);
    if (isFinite(sr) && sr >= 8000 && sr <= 192000) st.sr = sr;
    recalc(st);
    return true;
  }

  /* ---- parameters (fx.verb.*; unknown path or bad value -> false, never throws) ---- */
  function setParam(st, path, value) {
    if (!st || typeof path !== "string") return false;
    let p = path;
    if (p.slice(0, 3) === "fx.") p = p.slice(3);
    switch (p) {
      case "verb.mode": {
        const i = MODES.indexOf(String(value));
        if (i < 0) return false;
        st.modeId = i;
        return true;
      }
      case "verb.on": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.on = n ? 1 : 0;
        return true;
      }
      case "verb.mix": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.mix = cl(n, 0, 1);
        return true;
      }
      case "verb.size": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.size = cl(n, 0, 1);
        recalc(st);
        return true;
      }
      case "verb.decay": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.decay = cl(n, 0, 1);
        recalc(st);
        return true;
      }
      case "verb.damp": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.damp = cl(n, 0, 1);
        recalc(st);
        return true;
      }
      case "verb.predelay": {
        const n = Number(value);
        if (!isFinite(n)) return false;
        st.predelay = cl(n, 0, PD_MAX);
        recalc(st);
        return true;
      }
      default: return false;
    }
  }

  /* ---- the per-sample path (alloc-free) ---- */

  function process(st, xL, xR) {
    /* module-side null guarantee: mix 0 (or off) passes the input through bit-identically and
       runs no DSP. The parent's dry*(1-mix)+wet*mix blend yields the identical result. */
    if (st.mix <= 0 || st.on === 0) { st.oL = xL; st.oR = xR; return; }

    /* shared wet input: mono sum -> predelay */
    const pd = st.pd, pm = pd.mask;
    const pw = pd.w;
    pd.buf[pw] = (xL + xR) * 0.5;
    pd.w = (pw + 1) & pm;
    const xin = pd.buf[(pd.w - st.pdL) & pm];

    if (st.modeId === 1) { processFdn(st, xin); return; }
    if (st.modeId === 2) { processFv(st, xin); return; }
    processPlate(st, xin);
  }

  /* Dattorro plate. Two figure-of-eight halves; per-sample order: modulated tank reads, all
     loop reads, both halves' update equations, then all writes. The dc/decay arrangement is
     the paper's (four decay multipliers per full revolution -> gain dc^4/rev), with the
     lowpass damping one-pole per half and the output taps of Table 2. */
  function processPlate(st, xin) {
    const pl = st.pl;
    const d = pl.d, L = pl.len, T = pl.tap;

    /* input bandwidth one-pole + the four input allpass diffusers (+g form: v=x-g*s, y=s+g*v) */
    pl.bwz += pl.bwC * (xin - pl.bwz);
    let u = pl.bwz, s, v;
    s = lr(d[0], L[0]); v = u - PL_GI1 * s; lw(d[0], v); u = s + PL_GI1 * v;
    s = lr(d[1], L[1]); v = u - PL_GI1 * s; lw(d[1], v); u = s + PL_GI1 * v;
    s = lr(d[2], L[2]); v = u - PL_GI2 * s; lw(d[2], v); u = s + PL_GI2 * v;
    s = lr(d[3], L[3]); v = u - PL_GI2 * s; lw(d[3], v); u = s + PL_GI2 * v;
    const split = u;

    /* tank modulation: two quadrature cosines, slightly detuned (paper: order of 1 Hz) */
    let phA = pl.phA + pl.rateA; if (phA >= 1) phA -= 1;
    let phB = pl.phB + pl.rateB; if (phB >= 1) phB -= 1;
    pl.phA = phA; pl.phB = phB;
    const m4 = pl.exc * (1 + Math.cos(TWO_PI * phA));
    const m8 = pl.exc * (1 + Math.cos(TWO_PI * phB));

    /* all loop reads (before any write this sample) */
    const s4 = lrc(d[4], L[4] + m4);
    const s8 = lrc(d[8], L[8] + m8);
    const r5 = lr(d[5], L[5]);
    const r6 = lr(d[6], L[6]);
    const r7 = lr(d[7], L[7]);
    const r9 = lr(d[9], L[9]);
    const r10 = lr(d[10], L[10]);
    const r11 = lr(d[11], L[11]);
    /* Table 2 output taps (read before this sample's writes) */
    const t0 = lr(d[9], T[0]), t1 = lr(d[9], T[1]), t2 = lr(d[10], T[2]), t3 = lr(d[11], T[3]);
    const t4 = lr(d[5], T[4]), t5 = lr(d[6], T[5]), t6 = lr(d[7], T[6]);
    const t7 = lr(d[5], T[7]), t8 = lr(d[5], T[8]), t9 = lr(d[6], T[9]), t10 = lr(d[7], T[10]);
    const t11 = lr(d[9], T[11]), t12 = lr(d[10], T[12]), t13 = lr(d[11], T[13]);

    /* left half: AP(dd1, -ft) -> tank 4453 -> damping -> decay -> AP(dd2, +st2) -> tank 3720 */
    const dc = pl.dc, ft = PL_FT, st2 = pl.st2;
    const v4 = split + dc * r11 + ft * s4;
    const y5 = s4 - ft * v4;
    pl.lpa += pl.cd * (r5 - pl.lpa);
    const v6 = dc * pl.lpa - st2 * r6;
    const y7 = r6 + st2 * v6;
    /* right half: AP(dd3, -ft) -> tank 4217 -> damping -> decay -> AP(dd4, +st2) -> tank 3163 */
    const v8 = split + dc * r7 + ft * s8;
    const y9 = s8 - ft * v8;
    pl.lpb += pl.cd * (r9 - pl.lpb);
    const v10 = dc * pl.lpb - st2 * r10;
    const y11 = r10 + st2 * v10;

    lw(d[4], v4); lw(d[5], y5); lw(d[6], v6); lw(d[7], y7);
    lw(d[8], v8); lw(d[9], y9); lw(d[10], v10); lw(d[11], y11);

    const w = pl.trim * PL_OUT;
    st.oL = w * (t0 + t1 - t2 + t3 - t4 - t5 - t6);
    st.oR = w * (t7 + t8 - t9 + t10 - t11 - t12 - t13);
  }

  /* FDN: 8 lines, per-line damping + decay gain, Hadamard feedback via the fast transform.
     Injection row = Hadamard row 1, outputs = rows 3 and 5 (mutually orthogonal). */
  function processFdn(st, xin) {
    const fd = st.fd;
    const d = fd.d, L = fd.len, g = fd.g, z = fd.z, h = fd.h;
    const r0 = lr(d[0], L[0]), r1 = lr(d[1], L[1]), r2 = lr(d[2], L[2]), r3 = lr(d[3], L[3]);
    const r4 = lr(d[4], L[4]), r5 = lr(d[5], L[5]), r6 = lr(d[6], L[6]), r7 = lr(d[7], L[7]);
    const cd = fd.cd;
    z[0] += cd * (r0 - z[0]); z[1] += cd * (r1 - z[1]); z[2] += cd * (r2 - z[2]); z[3] += cd * (r3 - z[3]);
    z[4] += cd * (r4 - z[4]); z[5] += cd * (r5 - z[5]); z[6] += cd * (r6 - z[6]); z[7] += cd * (r7 - z[7]);
    h[0] = z[0]; h[1] = z[1]; h[2] = z[2]; h[3] = z[3];
    h[4] = z[4]; h[5] = z[5]; h[6] = z[6]; h[7] = z[7];
    fht8(h);
    const inj = fd.inj * xin;
    let oL = 0, oR = 0;
    for (let i = 0; i < 8; i++) {
      const mix = h[i] * FDN_NORM;
      const sgn = (i & 1) ? -1 : 1;                          /* injection row 1: + - + - ... */
      lw(d[i], sgn * inj + g[i] * mix);
      const q3 = (i & 3) === 0 || (i & 3) === 3 ? 1 : -1;    /* output row 3 */
      const q5 = i < 4 ? ((i & 1) ? -1 : 1) : ((i & 1) ? 1 : -1);  /* output row 5 */
      oL += q3 * mix; oR += q5 * mix;
    }
    st.oL = oL * fd.trim;
    st.oR = oR * fd.trim;
  }

  /* Freeverb: 8 parallel lowpass-feedback combs + 4 series allpasses per channel, the right
     bank offset by stereospread. Per-comb outputs are DC-normalised ((1-g) each, exact at any
     decay setting); per-comb feedback is T60-calibrated: g_i = 10^(-3 T_i/T60). */
  function processFv(st, xin) {
    const fv = st.fv;
    let sumL = 0, sumR = 0;
    const d1 = fv.d1, d2 = fv.d2;
    for (let i = 0; i < 8; i++) {
      let ln = fv.cl[i];
      let o = lr(ln, fv.clLen[i]);
      let fs = o * d2 + fv.fl[i] * d1;
      fv.fl[i] = fs;
      lw(ln, xin + fs * fv.clG[i]);
      sumL += o * fv.clN[i];
      ln = fv.cr[i];
      o = lr(ln, fv.crLen[i]);
      fs = o * d2 + fv.fr[i] * d1;
      fv.fr[i] = fs;
      lw(ln, xin + fs * fv.crG[i]);
      sumR += o * fv.crN[i];
    }
    for (let i = 0; i < 4; i++) {
      let ln = fv.al[i];
      let bo = lr(ln, fv.alLen[i]);
      let inp = sumL;
      lw(ln, inp + bo * FV_AP_GAIN);
      sumL = bo - inp;
      ln = fv.ar[i];
      bo = lr(ln, fv.arLen[i]);
      inp = sumR;
      lw(ln, inp + bo * FV_AP_GAIN);
      sumR = bo - inp;
    }
    st.oL = sumL * fv.trim;
    st.oR = sumR * fv.trim;
  }

  return {
    VERSION: VERSION,
    PREFIX: PREFIX,
    createState: createState,
    reset: reset,
    setParam: setParam,
    process: process,
    bindEngine: bindEngine,
  };
})();

if (typeof AVDSP !== "undefined" && typeof AVDSP.registerFx === "function") AVDSP.registerFx("verb", AVFXVERB);
