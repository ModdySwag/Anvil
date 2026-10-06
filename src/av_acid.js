/* av_acid.js -- Anvil P2 ACID engine (kind 1): TB-303-lineage DCO + C/2-cap 4-pole ladder + MEG/VEG
   + accent memory. Contract: verify/_p2_wave.md sections 2.1 (kind interface) and 3.1 (ACID spec).
   Behaviour source: research/acid/T2-acid-heritage.md (line refs in comments below; docs/03 section 2.1).
   Lineage/licence: the design is behaviour-modelled from T2. Open303 (Robin Schmidt, MIT) is the named
   reference engine in the research, but NO Open303 source is vendored in this repo and none was used or
   copied here -- everything below is written from the pinned transfer functions + T2 descriptions.
   MoogLadders (Unlicense) lineage is NOT used either (child G owns the Moog kernel; this file does not
   share it).

   LAWS (verify/_p2_wave.md section 1): worklet-safe = strict mode; exactly ONE top-level name (AVACID);
   no DOM/window/document/location; no allocation or object creation in per-sample paths; every field
   initialised in initVoiceK/initEngineK (monomorphic shape); no NaN paths, no throws; alloc-free render;
   the minBLEP oscillator reuses the shared AVDSP.blep tables/deposit scheme (P1.x, no duplicate tables).

   VOICE FIELDS (all live on v.k, created by the parent, filled by initVoiceK; per-note reset in initVoice):
     ph                 oscillator phase 0..1 (saw and square share it; contract 3.1 "same phase")
     t2x                2x step counter (minBLEP ring bookkeeping)
     bR                 per-voice minBLEP correction ring (Float64Array, AVDSP.blep.RL) or null if absent
     bN                 per-voice delayed-naive ring (same length)
     pitchCur           module-owned pitch in semitones (acid.slide glide; T2 L103)
     slideFrom/slideTo/slideInc/sliding   legato-overlap slide state (module-owned)
     accAmt             accent amount at note start = accent * (1 + 0.6*capMemory); 0 if plain
     ampBoost           VCA accent boost (T2 L77 change 1)
     sw, swDc, lagDc    accent sweep-circuit lag state + coefficients (T2 L81 "wapp")
     megVal/megStage/megDc/megAstep   MEG (filter envelope, decay-driven; T2 L75)
     vegVal/vegStage/vegDc/vegAstep/vegRc   VEG (amp envelope; T2 L74)
     z1..z4, y4, hp, hpA   ladder integrator states + output AC-coupled feedback DC blocker (T2 L53)
     g1..g4, a1..a4, kEff  ladder coefficients (recomputed every 16 base samples)
     dsa0..2, dsb0..2, dbPrev   halfband decimator states (byte-for-byte av_dsp scheme)
     scCut/scReso/scWave/scVol  per-voice smoothed params (15 ms, av_dsp s15 law)
     sCnt               coefficient-recompute counter
   ENGINE FIELDS (eng.kext, filled by initEngineK):
     cap, capTick       accent sweep-capacitor memory 0..1 + eng.osCount stamp of the last accent (T2 L82)
     tWave tCutHz tCutLog2 tReso tEnvMod tDecay tAccent tVolume tSlide tAccDecay tVeg tTrack
     tOverdrive tMuffler tSweep tSoftAttack tMode   the 16 acid.* targets
     s15, fcCap          sr-derived smoothing coefficient + per-stage tan() frequency cap (lazy)          */
"use strict";

const AVACID = (function () {
  "use strict";

  const VERSION = "p2.0";
  const PREFIX = "acid";
  const TAU = Math.PI * 2;

  /* ---- calibration constants (all T2-cited; measured/checked in the P2 node harness) ----------------
     MEG_UP/MEG_DOWN  MEG sweep depth / post-decay drop below the knob in octaves (T2 L73 bipolar MEG)
     AMP_BOOST        accent VCA boost at accAmt = 1                                (T2 L77 change 1)
     SWEEP_OCT        accent sweep cutoff boost, octaves at sweep=1, accAmt=1       (T2 L78 change 2)
     RESO_EMPH*       accent resonance emphasis                                      (T2 L79 change 3)
     CAP_*            sweep-capacitor memory: accent depth = accent*(1 + extra*cap);
                      cap += (1-cap)*rise per accent, discharged exp with tau (T2 L82)
     KMAX             resonance feedback scale vs the C/2 pole spread (T2 L47-49); calibrated so
                      reso=1 sits just under self-oscillation and accent emphasis can tip past it
                      (TD-3-MO "easily trips into self-oscillation", T2 L240)
     RESO_LO_X        resonance factor at the lowest cutoff (T2 L52: "resonates much less at low
                      cutoff frequencies ... keeps a clean low end")                            */
  const MEG_UP = 4.5;
  const MEG_DOWN = 0.8;
  const MEG_ATK = 0.003;         /* MEG attack ~3 ms (T2 L84) */
  const AMP_BOOST = 1.5;
  const SWEEP_OCT = 1.6;
  const RESO_EMPH = 0.22;
  const RESO_EMPH_M1 = 0.30;     /* accentMode 1 = high-resonance sweep (T2 L234/L287) */
  const CAP_EXTRA = 0.6;         /* cap memory pushes the accent depth up to 1.6x nominal (T2 L82) */
  const CAP_RISE = 0.5;
  const CAP_TAU = 1.5;
  const KMAX = 15.2;
  const RESO_LO_X = 0.55;
  const RESO_LO_F = 1800;        /* cutoff where the resonance factor reaches 1 */
  const LAG_TAU0 = 0.002;        /* sweep lag at reso 0 ... */
  const LAG_TAU1 = 0.020;        /* ... and at reso 1 (the resonance-dependent "wapp", T2 L81) */
  const FB_HP_HZ = 8;            /* feedback DC block ~8 Hz (T2 L53 coupling-cap LF peak) */
  const OD_MAKE = 1.313;         /* 1/tanh(1): unity peak through the overdrive stage at 66.6x=off end */
  const VEG_REL = 0.025;         /* release time constant, s (snappy 303 gate; T2 L84 ~3 ms attack era) */
  const STAGE_CAP = 0.45;        /* per-stage fc <= 0.45*fs2 (tan() safety) */

  /* ---- the C/2-cap pole spread (T2 L47-49): stage cutoffs = fc * Rk.
     Roots of s^4 + 6.727s^3 + 14.142s^2 + 9.514s + 1 -> {-3.24, -2.33, -1.04, -0.13}. The set is
     taken at face value: the slowest stage sits at 0.13*fc (the early-rolling passband knee that makes
     the 303 "behave like 18 dB", T2 L50), and the closed-loop resonance (-180 deg loop phase) lands at
     ~1.16*fc -- which is why the stock unit's ~2.5 kHz max resonant frequency equals its cutoff-knob
     max (T2 L54), and why the resonance tracks the knob.                                */
  const R1 = 0.13;               /* the C/2 bottom-cap pole: 0.13/1 */
  const R2 = 1.04;
  const R3 = 2.33;
  const R4 = 3.24;

  /* ---- halfband decimator (2x -> base): EXACT values from src/av_dsp.js HB_A/HB_B (P1.x hq design,
     research/engine/hb-coeffs.json "hq"). Applied byte-for-byte like the shipped av_dsp voiceFrame
     scheme: 3 applies per branch (indices 0..2), states sa0..2/sb0..2 + bPrev, y = 0.5*(va + bPrev).
     NOTE (reported to parent): the arrays carry 4 values; the shipped engine applies [0..2]; acid
     replicates the shipped behaviour exactly so kind voices decimate like VA voices.                  */
  const HB_A = new Float64Array([0.830835156043, 0.581828125595, 0.281947153869, 0.0376716808361]);
  const HB_B = new Float64Array([0.140157501378, 0.435551190198, 0.713070914873, 0.942688824121]);

  /* ---- late-bound shared minBLEP surface (AVDSP.blep; parent exposes it, section 2.2) ---- */
  let BLEP = null;

  function captureBlep() {
    if (BLEP !== null) return;
    if (typeof AVDSP !== "undefined" && AVDSP && AVDSP.blep &&
        typeof AVDSP.blep.deposit === "function" && AVDSP.blep.RL > 0 && AVDSP.blep.W > 0) {
      BLEP = AVDSP.blep;
    }
  }

  /* ---- small helpers (never allocate) ---- */
  function cl(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* rational tanh approximation (Moore et al. form): max rel. error ~5e-3 in [-3,3], clamped outside;
     1 multiply-heavy divide per call, no libm. */
  function tanhA(x) {
    const x2 = x * x;
    let t = x * (27 + x2) / (27 + 9 * x2);
    if (t > 1) t = 1; else if (t < -1) t = -1;
    return t;
  }

  /* ---- engine level (kext) ---- */
  function initEngineK(kext) {
    kext.cap = 0;
    kext.capTick = 0;
    kext.tWave = 0;               /* saw by default (the classic acid starting point) */
    kext.tCutHz = 800;            /* defaults listed in the P2 acid report for child F */
    kext.tCutLog2 = Math.log2(800);
    kext.tReso = 0.7;
    kext.tEnvMod = 0.5;
    kext.tDecay = 0.5;
    kext.tAccent = 0.6;
    kext.tVolume = 0.8;
    kext.tSlide = 0.06;           /* stock 303 slide time (T2 L103) */
    kext.tAccDecay = 0.2;         /* stock accented MEG decay ~200 ms (T2 L75) */
    kext.tVeg = 1.5;
    kext.tTrack = 0;              /* stock 303 has NO key tracking (T2 L55) */
    kext.tOverdrive = 1;          /* 1..66.6 (T2 L279) */
    kext.tMuffler = 0;
    kext.tSweep = 1;              /* -2..2 oct (EXPANDED) */
    kext.tSoftAttack = 0.003;     /* stock ~3 ms attack (T2 L84) */
    kext.tMode = 2;               /* 0 none | 1 high-res | 2 normal (T2 L234) */
    kext.s15 = 0;                 /* lazy: needs eng.sr */
    kext.fcCap = 0;
  }

  /* ---- per-voice kind fields (called once per voice at engine create) ---- */
  function initVoiceK(k) {
    captureBlep();
    k.ph = 0;
    k.t2x = 0;
    k.bR = BLEP ? new Float64Array(BLEP.RL) : null;
    k.bN = BLEP ? new Float64Array(BLEP.RL) : null;
    k.pitchCur = 60;
    k.slideFrom = 60;
    k.slideTo = 60;
    k.slideInc = 0;
    k.sliding = 0;
    k.accAmt = 0;
    k.ampBoost = 1;
    k.sw = 0;
    k.lagDc = 0;
    k.megVal = 0; k.megStage = 0; k.megDc = 0.99; k.megAstep = 0.01;
    k.vegVal = 0; k.vegStage = 0; k.vegDc = 0.99; k.vegAstep = 0.01; k.vegRc = 0.99;
    k.z1 = 0; k.z2 = 0; k.z3 = 0; k.z4 = 0; k.y4 = 0; k.hp = 0; k.hpA = 0;
    k.g1 = 0; k.g2 = 0; k.g3 = 0; k.g4 = 0;
    k.a1 = 0; k.a2 = 0; k.a3 = 0; k.a4 = 0;
    k.kEff = 0;
    k.incBase = 0;
    k.dsa0 = 0; k.dsa1 = 0; k.dsa2 = 0; k.dsb0 = 0; k.dsb1 = 0; k.dsb2 = 0; k.dbPrev = 0;
    k.scCut = 0; k.scReso = 0; k.scWave = 0; k.scVol = 0;
    k.sCnt = 0;
  }

  /* ---- per-NOTE reset (called from reinitVoice when v.kindId is 1) ---- */
  function initVoice(eng, v) {
    const k = v.k;
    const kext = eng.kext;
    if (!k || !kext) return;

    /* lazy sr constants */
    if (!(kext.s15 > 0)) {
      kext.s15 = 1 - Math.exp(-1 / (0.015 * eng.sr));
      kext.fcCap = STAGE_CAP * eng.fs2;
    }

    const midi = v.noteMidi;
    /* accent trigger: velocity >= 0.8 in P2 (contract 3.1; T2 L85 ecosystem conventions 80/127) */
    const acc = (v.vel >= 0.8) ? 1 : 0;

    /* accent sweep-capacitor memory (T2 L82): lazy discharge since the last accent, then charge.
       The depth of THIS accent reads the cap BEFORE this accent's charge (rising consecutive accents). */
    let capBefore = kext.cap;
    if (acc === 1) {
      const now = eng.osCount | 0;
      let dt = now - kext.capTick;
      if (dt < 0) dt = 0;
      capBefore = capBefore * Math.exp(-dt / (CAP_TAU * eng.sr));
      capBefore = cl(capBefore, 0, 1);
      kext.cap = cl(capBefore + (1 - capBefore) * CAP_RISE, 0, 1);
      kext.capTick = now;
    }
    k.accAmt = acc === 1 ? kext.tAccent * (1 + CAP_EXTRA * capBefore) : 0;
    k.ampBoost = 1 + k.accAmt * AMP_BOOST;

    /* envelopes: VEG (amp) + MEG (filter). Accented notes force the MEG decay to accentDecay
       (stock 303 hard-fixed ~200 ms; T2 L75) and use the fast attack (soft attack is for
       non-accented notes; T2 L281/L229). */
    const atk = acc === 1 ? 0.0004 : kext.tSoftAttack;
    k.vegAstep = 1 / (cl(atk, 0.0002, 0.1) * eng.sr);
    k.vegDc = Math.exp(-4.6 / (cl(kext.tVeg, 0.016, 3) * eng.sr));
    k.vegRc = Math.exp(-4.6 / (VEG_REL * eng.sr));
    k.vegVal = 0; k.vegStage = 1;
    const mdec = acc === 1 ? kext.tAccDecay : kext.tDecay;
    k.megDc = Math.exp(-4.6 / (cl(mdec, 0.03, 3) * eng.sr));
    k.megAstep = 1 / (MEG_ATK * eng.sr);
    k.megVal = 0; k.megStage = 1;

    /* slide = legato overlap (contract 3.1; T2 L103 "does not start until the beginning of the
       note slid INTO"). The module owns the glide: origin = v.pitch when the parent already
       decided a glide start, else the most recent still-held voice's note (new note while one is
       held). Glide time = acid.slide over the full interval. */
    let from = v.pitch;
    if (from === midi && eng.voices) {
      let bestSeq = -1;
      for (let i = 0; i < eng.maxVoices; i++) {
        const w = eng.voices[i];
        if (w !== v && w.state === 1 && w.noteMidi !== midi && w.seq > bestSeq) {
          bestSeq = w.seq; from = w.noteMidi;
        }
      }
    }
    k.pitchCur = from;
    k.slideFrom = from;
    k.slideTo = midi;
    k.sliding = (from !== midi) ? 1 : 0;
    k.slideInc = k.sliding === 1 ? (midi - from) / (cl(kext.tSlide, 0.06, 0.36) * eng.sr) : 0;

    /* oscillator + ladder + decimator state */
    k.ph = 0; k.t2x = 0;
    if (k.bR) { k.bR.fill(0); k.bN.fill(0); }
    k.z1 = 0; k.z2 = 0; k.z3 = 0; k.z4 = 0; k.y4 = 0; k.hp = 0;
    k.hpA = 1 - Math.exp(-TAU * FB_HP_HZ / eng.fs2);
    k.dsa0 = 0; k.dsa1 = 0; k.dsa2 = 0; k.dsb0 = 0; k.dsb1 = 0; k.dsb2 = 0; k.dbPrev = 0;

    /* per-voice smoothing seeded to the current targets (no zipper at note start) */
    k.scCut = kext.tCutLog2; k.scReso = cl(kext.tReso, 0, 1);
    k.scWave = cl(kext.tWave, 0, 1); k.scVol = cl(kext.tVolume, 0, 1);
    k.sw = 0;
    k.lagDc = Math.exp(-1 / ((LAG_TAU0 + LAG_TAU1 * k.scReso * k.scReso) *
      (kext.tMode === 1 ? 1.8 : 1) * eng.sr));
    k.sCnt = 0;
    k.kEff = 0;
  }

  /* ---- 2x-rate core: minBLEP DCO -> overdrive -> C/2-cap ladder ---------------------------------- */
  /* returns one 2x sample of the filtered signal */
  function step2x(eng, v, inc) {
    const k = v.k;
    const t = k.t2x;
    k.t2x = t + 1;
    const w = k.scWave;

    /* -- DCO: minBLEP saw + minBLEP square at the SAME phase, linear blend by acid.wave (contract 3.1).
       Deposit scheme = av_dsp "Classic" exactly: naive value -> delayed-naive ring; discontinuities
       deposit J*TAB into the correction ring; output = naive(t-W) + ring(t-W), ring entry consumed. */
    const phOld = k.ph;
    let ph = phOld + inc;
    const phRaw = ph;
    let pW = -1, pH = -1;
    if (phRaw >= 1) { ph = phRaw - 1; pW = ph / inc; }
    if (phOld < 0.5 && phRaw >= 0.5) pH = (phRaw - 0.5) / inc;
    const naive = (w <= 0) ? (2 * ph - 1)
                : (w >= 1) ? ((ph < 0.5) ? 1 : -1)
                : (1 - w) * (2 * ph - 1) + w * ((ph < 0.5) ? 1 : -1);
    let osc;
    if (k.bR !== null) {
      const B = BLEP;
      if (pW >= 0) {
        const jW = 2 * (2 * w - 1);            /* saw wrap -2*(1-w) + square wrap +2*w */
        if (jW !== 0) B.deposit(k.bR, t, jW, pW);
      }
      if (pH >= 0 && w > 0) B.deposit(k.bR, t, -2 * w, pH);   /* square half-cycle edge */
      const nb = k.bN;
      nb[t & B.MASK] = naive;
      if (t >= B.W) {
        const b = (t - B.W) & B.MASK;
        osc = nb[b] + k.bR[b];
        k.bR[b] = 0;
      } else {
        osc = 0;                               /* pre-latency (same ~0.33 ms as av_dsp) */
      }
    } else {
      osc = naive;                             /* degraded path if AVDSP.blep is absent */
    }
    k.ph = ph;

    /* -- overdrive: oscillator level into the filter, 1..66.6x (T2 L279) -- */
    const x = tanhA(osc * eng.kext.tOverdrive) * OD_MAKE;

    /* -- ladder: 4 TPT one-poles, C/2-cap pole spread, tanh feedback drive, AC-coupled
       (the ~8 Hz coupling-corner feedback block keeps the low end, T2 L52-53). -- */
    const y4p = k.y4;
    k.hp += (y4p - k.hp) * k.hpA;
    const fb = y4p - k.hp;
    let u = x - k.kEff * tanhA(fb);
    let acc2, y;
    acc2 = (u - k.z1) * k.a1; y = acc2 + k.z1; k.z1 = y + acc2; u = y;
    acc2 = (u - k.z2) * k.a2; y = acc2 + k.z2; k.z2 = y + acc2; u = y;
    acc2 = (u - k.z3) * k.a3; y = acc2 + k.z3; k.z3 = y + acc2; u = y;
    acc2 = (u - k.z4) * k.a4; y = acc2 + k.z4; k.z4 = y + acc2;
    k.y4 = y;
    return y;
  }

  /* ---- one base-rate sample of the acid voice (contract 2.1: full ownership of osc/filter/decimation) */
  function stepVoice(eng, v) {
    const k = v.k;
    const kext = eng.kext;
    const s15 = kext.s15;

    /* per-voice param smoothing (15 ms, av_dsp s15 law) */
    k.scCut += (kext.tCutLog2 - k.scCut) * s15;
    k.scReso += (cl(kext.tReso, 0, 1) - k.scReso) * s15;
    k.scWave += (cl(kext.tWave, 0, 1) - k.scWave) * s15;
    k.scVol += (cl(kext.tVolume, 0, 1) - k.scVol) * s15;

    /* module-owned slide (acid.slide seconds, linear in semitones) */
    if (k.sliding === 1) {
      k.pitchCur += k.slideInc;
      if ((k.slideInc > 0 && k.pitchCur >= k.slideTo) || (k.slideInc < 0 && k.pitchCur <= k.slideTo)) {
        k.pitchCur = k.slideTo;
        k.sliding = 0;
      }
    }
    const st = (k.pitchCur - 69) + eng.bend + eng.tune;
    let f = 440 * Math.pow(2, st / 12);
    const fLim = eng.fs2 * 0.45;
    if (f > fLim) f = fLim;
    if (f < 20) f = 20;
    k.incBase = f / eng.fs2;

    /* envelopes (base rate) */
    if (k.megStage === 1) {
      k.megVal += k.megAstep;
      if (k.megVal >= 1) { k.megVal = 1; k.megStage = 2; }
    } else if (k.megStage === 2) {
      k.megVal *= k.megDc;
      if (k.megVal < 1e-6) k.megVal = 0;
    }
    if (k.vegStage === 1) {
      k.vegVal += k.vegAstep;
      if (k.vegVal >= 1) { k.vegVal = 1; k.vegStage = 2; }
    } else if (k.vegStage === 2) {
      k.vegVal *= k.vegDc;
      if (k.vegVal < 1e-6) k.vegVal = 0;
    } else if (k.vegStage === 3) {
      k.vegVal *= k.vegRc;
      if (k.vegVal < 1e-6) k.vegVal = 0;
    }
    /* release detection: the parent sets state 2 (shared release semantics); belt-and-braces if the
       kind releaseVoice hook was not called */
    if (v.state === 2 && k.vegStage < 3) k.vegStage = 3;

    /* accent sweep lag state: pulse derived from the MEG, one-pole lag -> the "wapp" (T2 L81) */
    k.sw += (k.accAmt * k.megVal - k.sw) * (1 - k.lagDc);

    /* filter coefficients at least every 16 output samples (av_dsp tan-hoisting law) */
    if ((k.sCnt & 15) === 0) {
      let l2 = k.scCut
             + kext.tEnvMod * (MEG_UP * k.megVal - MEG_DOWN)   /* bipolar MEG, octaves (T2 L73) */
             + kext.tTrack * (k.pitchCur - 60) / 12;           /* filter tracking mod (T2 L55) */
      if (kext.tMode !== 0) {
        l2 += kext.tSweep * k.sw * SWEEP_OCT * (kext.tMode === 1 ? 1.3 : 1);   /* accent sweep boost */
      }
      let fc = Math.pow(2, l2);
      if (fc < 8) fc = 8; else if (fc > 20000) fc = 20000;
      const fcCap = kext.fcCap;
      let g;
      g = fc * R1; if (g > fcCap) g = fcCap; k.g1 = g;
      g = fc * R2; if (g > fcCap) g = fcCap; k.g2 = g;
      g = fc * R3; if (g > fcCap) g = fcCap; k.g3 = g;
      g = fc * R4; if (g > fcCap) g = fcCap; k.g4 = g;
      const fs2 = eng.fs2, pi = Math.PI;
      const t1 = Math.tan(pi * k.g1 / fs2); k.a1 = t1 / (1 + t1);
      const t2 = Math.tan(pi * k.g2 / fs2); k.a2 = t2 / (1 + t2);
      const t3 = Math.tan(pi * k.g3 / fs2); k.a3 = t3 / (1 + t3);
      const t4 = Math.tan(pi * k.g4 / fs2); k.a4 = t4 / (1 + t4);
      /* resonance: falls off at low cutoff (T2 L52), accent emphasises (T2 L79) */
      const resoM = RESO_LO_X + (1 - RESO_LO_X) * ((fc < RESO_LO_F) ? fc / RESO_LO_F : 1);
      k.kEff = k.scReso * KMAX * resoM *
               (1 + k.accAmt * (kext.tMode === 1 ? RESO_EMPH_M1 : RESO_EMPH));
      const lagTau = (LAG_TAU0 + LAG_TAU1 * k.scReso * k.scReso) * (kext.tMode === 1 ? 1.8 : 1);
      k.lagDc = Math.exp(-1 / (lagTau * eng.sr));
    }
    k.sCnt++;

    /* two 2x steps -> halfband decimator (byte-for-byte the av_dsp scheme; exact P1.x coefficients) */
    const s0 = step2x(eng, v, k.incBase);
    const s1 = step2x(eng, v, k.incBase);
    let va = s0, t;
    t = HB_A[0] * va + k.dsa0; k.dsa0 = va - HB_A[0] * t; va = t;
    t = HB_A[1] * va + k.dsa1; k.dsa1 = va - HB_A[1] * t; va = t;
    t = HB_A[2] * va + k.dsa2; k.dsa2 = va - HB_A[2] * t; va = t;
    let vb = s1;
    t = HB_B[0] * vb + k.dsb0; k.dsb0 = vb - HB_B[0] * t; vb = t;
    t = HB_B[1] * vb + k.dsb1; k.dsb1 = vb - HB_B[1] * t; vb = t;
    t = HB_B[2] * vb + k.dsb2; k.dsb2 = vb - HB_B[2] * t; vb = t;
    const y = 0.5 * (va + k.dbPrev);
    k.dbPrev = vb;

    /* VCA: VEG x accent amp boost; muffler = bass-preserving post-VCA soft clip (T2 L286) */
    let out = y * k.vegVal * k.ampBoost;
    if (kext.tMuffler > 0) {
      const sq = 1.2 * tanhA(out / 1.2);
      out -= kext.tMuffler * (out - sq);
    }
    return out * k.scVol;
  }

  function releaseVoice(eng, v) {
    if (v.k && v.k.vegStage < 3) v.k.vegStage = 3;
  }

  function isVoiceDone(eng, v) {
    return v.state === 2 && v.k.vegVal === 0;
  }

  /* ---- parameters: acid.* only (16, incl. the EXPANDED set; contract 3.1) ---- */
  function setParam(eng, path, value) {
    const kext = eng.kext;
    if (!kext) return false;
    switch (path) {
      case "acid.wave": { const n = Number(value); if (!isFinite(n)) return false; kext.tWave = cl(n, 0, 1); return true; }
      case "acid.cutoff": {
        const n = Number(value); if (!isFinite(n)) return false;
        const c = cl(n, 20, 20000);
        kext.tCutHz = c; kext.tCutLog2 = Math.log2(c);
        return true;
      }
      case "acid.reso": { const n = Number(value); if (!isFinite(n)) return false; kext.tReso = cl(n, 0, 1); return true; }
      case "acid.envMod": { const n = Number(value); if (!isFinite(n)) return false; kext.tEnvMod = cl(n, 0, 1); return true; }
      case "acid.decay": { const n = Number(value); if (!isFinite(n)) return false; kext.tDecay = cl(n, 0.03, 3); return true; }
      case "acid.accent": { const n = Number(value); if (!isFinite(n)) return false; kext.tAccent = cl(n, 0, 1); return true; }
      case "acid.volume": { const n = Number(value); if (!isFinite(n)) return false; kext.tVolume = cl(n, 0, 1); return true; }
      case "acid.slide": { const n = Number(value); if (!isFinite(n)) return false; kext.tSlide = cl(n, 0.06, 0.36); return true; }
      case "acid.accentDecay": { const n = Number(value); if (!isFinite(n)) return false; kext.tAccDecay = cl(n, 0.03, 3); return true; }
      case "acid.veg": { const n = Number(value); if (!isFinite(n)) return false; kext.tVeg = cl(n, 0.016, 3); return true; }
      case "acid.filterTrack": { const n = Number(value); if (!isFinite(n)) return false; kext.tTrack = cl(n, 0, 1); return true; }
      case "acid.overdrive": { const n = Number(value); if (!isFinite(n)) return false; kext.tOverdrive = cl(n, 1, 66.6); return true; }
      case "acid.muffler": { const n = Number(value); if (!isFinite(n)) return false; kext.tMuffler = cl(n, 0, 1); return true; }
      case "acid.sweep": { const n = Number(value); if (!isFinite(n)) return false; kext.tSweep = cl(n, -2, 2); return true; }
      case "acid.softAttack": { const n = Number(value); if (!isFinite(n)) return false; kext.tSoftAttack = cl(n, 0.0003, 0.03); return true; }
      case "acid.accentMode": {
        const n = Number(value); if (!isFinite(n)) return false;
        let m = Math.round(n); if (m < 0) m = 0; else if (m > 2) m = 2;
        kext.tMode = m;
        return true;
      }
      default: return false;
    }
  }

  return {
    version: VERSION,
    VERSION: VERSION,
    PREFIX: PREFIX,
    initEngineK: initEngineK,
    initVoiceK: initVoiceK,
    initVoice: initVoice,
    stepVoice: stepVoice,
    releaseVoice: releaseVoice,
    isVoiceDone: isVoiceDone,
    setParam: setParam,
  };
})();

if (typeof AVDSP !== "undefined" && typeof AVDSP.registerKind === "function") {
  AVDSP.registerKind(1, AVACID);
}
