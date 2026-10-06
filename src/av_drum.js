/* av_drum.js — Anvil P2 DRUM engine (kind 3). Worklet-safe module: ONE top-level name (AVDRUM).
   Contract: verify/_p2_wave.md §2.1 (the kind interface) + §3.3 (kit, pinned map, per-voice
   params, one-shot law) + §8 (laws). docs/03 §2.1: "expand PF's 9-voice kit with per-voice
   params; one kit bus; drum split law; pads UI."

   KIT LINEAGE: Pattern Forge's MIX kit recipes (pattern-forge/src/app_synthx.js pfSXDrumBuild,
   read-only source — kick tone 155->42 + hp click, snare body + bandpass noise, 4-burst clap,
   1750 Hz rim click + snap, hp-noise hats, swept toms). Re-expressed here as clean-room
   per-sample synthesis: no Web Audio nodes, no buffers, no per-sample allocation.

   LAWS (worklet-safe):
   - strict mode; NO DOM/window/document/performance/console reach-ins; no throw paths.
   - exactly ONE top-level name (AVDRUM); everything else lives inside the module closure.
   - no allocation in per-sample paths: all fields land in initVoiceK; the cluster Float64Arrays
     are allocated there (once per voice at engine create), never in initVoice/stepVoice.
   - monomorphic per-voice shape: every field is initialised in initVoiceK and only ever read or
     assigned numbers afterwards.
   - no NaN paths: every setParam is clamped, seeds are made nonzero, cluster phases wrap, every
     frequency is clamped below the Nyquist margin at init time.
   - determinism: noise seeds + per-hit phase offsets are drawn from the shared eng.rng
     xorshift32 stream (same constants as av_dsp.prngU32) so same boot + same patch + same note
     order gives bit-identical renders.
   - one-shots: releaseVoice() is a no-op; isVoiceDone() flips true once the tail's last
     component envelope reaches its floor — and NEVER while the voice is not released
     (state !== 2), so both a state-checked and a state-blind parent end-check are lawful.
   - params law: drum.<voice>.{tune,decay,level} take effect on the NEXT hit (drum-machine
     convention); drum.volume rides even ringing voices (one-pole, ~12 ms, click-free).

   VOICE FIELDS (this module's fields on the shared per-voice `v.k`; shape created by initVoiceK,
   values filled per note by initVoice):
     kit            int 0..10 kit id (PAGE16 lookup of the incoming note; -1 = silent/unknown note)
     cnt            active-component count; 0 => tail done (drives isVoiceDone)
     dvol           per-voice smoothed drum.volume (target: eng.kext.vol)
     -- component A: main tone (sine) or inharmonic cluster (crash/ride) --
     aSt,aV,aAs,aDc envelope: stage (0 off / 1 attack / 2 decay), value, attack step, decay coef
     aPh,aF,aF1,aP,aPc  sine: phase, freq span (f0-f1), freq end, pitch-env value + coef
     aW,aG          wave flag (0 sine / 1 cluster), static gain (voice amp x level, baked at start)
     aCf,aCp        cluster member increments (freq/sr) + phases — Float64Array(6), alloc in initVoiceK
     -- component B: secondary sine tone (snare body tone, ride ping) --
     bSt,bV,bAs,bDc envelope (same layout as A)
     bPh,bF,bF1,bP,bPc  oscillator (same layout as A)
     bG             static gain
     -- component N: noise through a TPT SVF --
     nSt,nV,nAs,nDc envelope (same layout as A)
     nSeed          xorshift32 state (odd, never zero)
     nIc1,nIc2      SVF integrator states
     nA1,nA2,nA3,nFk  SVF coefs + damping (k = 1/Q)
     nMode,nG       SVF mode (0 lp / 1 bp / 2 hp), static gain
     cbn,cbd        clap burst countdown (retriggers left) + final tail coef (0 = not a clap)

   ENGINE FIELDS (this module's fields on the shared eng.kext; filled by initEngineK):
     split 0..127 (0 = off: every note is a drum; >0: the PARENT routes notes >= split to VA —
     we only store/publish the value) · vol 0..1 (drum bus volume) · smv vol smoothing coef ·
     invSr 1/sr cache · vtune[N]/vdecay[N]/vlevel[N] per-voice param tables (Float64Array(11)).
   ============================================================================================== */
"use strict";

const AVDRUM = (function () {

  const VERSION = "p2.0";
  const PREFIX = "drum";

  /* ---- kit definition ---- */
  const N = 11;
  const VOICE_IDS = Object.freeze(["kick", "snare", "rim", "clap", "ch", "oh", "lt", "mt", "ht", "crash", "ride"]);
  /* the pinned MIDI map (verify/_p2_wave.md §3.3) — kit name -> MIDI note */
  const MAP = Object.freeze({ kick: 36, rim: 37, snare: 38, clap: 39, ch: 42, oh: 46, lt: 45, mt: 47, ht: 50, crash: 49, ride: 51 });
  /* the 16-slot page (midi 36..51): kit index per slot. Slots 40/41/43/44/48 are unpinned; they
     (and every note outside 36..51, wrapped mod 16) fall back to near kit voices so kind-3 play
     stays musical across the whole keybed: 40->snare, 41->lt, 43/44->mt, 48->ht. */
  const PAGE16 = new Uint8Array([0, 2, 1, 3, 1, 6, 4, 7, 7, 6, 5, 7, 8, 9, 8, 10]);
  /* per-voice defaults (ranges are pinned by §3.3; these defaults are OUR first-voice values) */
  const DEF_TUNE = new Float64Array(N);
  const DEF_DECAY = new Float64Array([0.40, 0.22, 0.045, 0.30, 0.05, 0.32, 0.40, 0.35, 0.30, 1.20, 0.80]);
  const DEF_LEVEL = new Float64Array([1.00, 0.90, 0.55, 0.80, 0.50, 0.45, 0.80, 0.80, 0.80, 0.40, 0.45]);

  /* ---- synthesis constants ---- */
  const TAU = Math.PI * 2;
  const ENV_FLOOR = 1e-4;                 /* component env floor (-80 dB); done time = 1.333*decay */
  const ENV_RATE = -6.908;                /* exp coef = e^(ENV_RATE/(t*sr)): -60 dB in t seconds */
  const ATT_TONE = 0.0012;                /* tone attack, s */
  const ATT_CLICK = 0.0008;               /* very short attack (rim / ride ping) */
  const ATT_CYM = 0.0025;                 /* cymbal cluster attack, s */
  const ATT_NOISE = 0.0008;               /* noise component attack, s */
  const CLUSTER_R = new Float64Array([1, 1.342, 1.2312, 1.6532, 1.9523, 2.1523]);
  /* member weights normalised so sum = 1: cluster peak <= 1 even if all members align */
  const CLUSTER_A = new Float64Array([0.25641025641, 0.20512820513, 0.17948717949, 0.14102564103, 0.11538461538, 0.10256410256]);

  /* ---- sine LUT (own; 1024 entries + guard, linear interpolation) ---- */
  const SINE_N = 1024;
  const sineTab = new Float64Array(SINE_N + 1);
  for (let i = 0; i < SINE_N; i++) sineTab[i] = Math.sin(TAU * i / SINE_N);
  sineTab[SINE_N] = 0;
  function sine(p) {
    const x = p * SINE_N;
    const i = x | 0;
    const f = x - i;
    const a = sineTab[i];
    return a + (sineTab[i + 1] - a) * f;
  }

  /* ---- small helpers (init paths only; never in stepVoice) ---- */
  function cl(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function envCoef(t, sr) {
    if (!(t > 0.0005)) t = 0.0005;
    return Math.exp(ENV_RATE / (t * sr));
  }
  /* engine rng, same xorshift32 stream/constants as av_dsp.prngU32 */
  function drumU32(eng) {
    let x = eng.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x = x >>> 0;
    eng.rng = x;
    return x;
  }
  function drumUnit(eng) { return drumU32(eng) * 2.3283064365386963e-10; }

  /* note -> kit id (0..10) or -1 for a non-finite note; wraps mod 16 onto the page */
  function kitFor(midi) {
    if (!isFinite(midi)) return -1;
    let i = Math.round(midi) - 36;
    i = ((i % 16) + 16) % 16;
    return PAGE16[i];
  }

  /* ================================ voice construction ================================ */

  function initVoiceK(k) {
    k.kit = -1;
    k.cnt = 0;
    k.dvol = 0.9;
    /* component A */
    k.aSt = 0; k.aV = 0; k.aAs = 0; k.aDc = 0;
    k.aPh = 0; k.aF = 0; k.aF1 = 0; k.aP = 0; k.aPc = 0;
    k.aW = 0; k.aG = 0;
    k.aCf = new Float64Array(6);
    k.aCp = new Float64Array(6);
    /* component B */
    k.bSt = 0; k.bV = 0; k.bAs = 0; k.bDc = 0;
    k.bPh = 0; k.bF = 0; k.bF1 = 0; k.bP = 0; k.bPc = 0;
    k.bG = 0;
    /* component N (noise) */
    k.nSt = 0; k.nV = 0; k.nAs = 0; k.nDc = 0;
    k.nSeed = 1;
    k.nIc1 = 0; k.nIc2 = 0;
    k.nA1 = 0; k.nA2 = 0; k.nA3 = 0; k.nFk = 2;
    k.nMode = 2; k.nG = 0;
    k.cbn = 0; k.cbd = 0;
    return k;
  }

  function initEngineK(kext) {
    kext.split = 0;                         /* 0 = off: every note is a drum when kind 3 */
    kext.vol = 0.9;                         /* the kit bus volume */
    kext.smv = 1 - Math.exp(-1 / (0.012 * 48000));   /* re-derived per note from eng.sr */
    kext.invSr = 1 / 48000;
    kext.vtune = new Float64Array(N);
    kext.vdecay = new Float64Array(N);
    kext.vlevel = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      kext.vtune[i] = DEF_TUNE[i];
      kext.vdecay[i] = DEF_DECAY[i];
      kext.vlevel[i] = DEF_LEVEL[i];
    }
    return kext;
  }

  /* component builders (per note; callers guarantee k fields exist) */
  function toneA(k, f0, f1, tau, decS, attS, gain, sr) {
    if (k.aSt === 0) k.cnt += 1;
    k.aSt = 1; k.aV = 0;
    k.aAs = 1 / Math.max(1, Math.round(attS * sr));
    k.aDc = envCoef(decS, sr);
    k.aW = 0; k.aG = gain;
    k.aPh = 0;
    k.aP = 1;
    k.aPc = (tau > 0) ? Math.exp(-1 / (tau * sr)) : 1;
    k.aF1 = f1;
    k.aF = f0 - f1;
  }
  function toneB(k, f0, f1, tau, decS, attS, gain, sr) {
    if (k.bSt === 0) k.cnt += 1;
    k.bSt = 1; k.bV = 0;
    k.bAs = 1 / Math.max(1, Math.round(attS * sr));
    k.bDc = envCoef(decS, sr);
    k.bG = gain;
    k.bPh = 0;
    k.bP = 1;
    k.bPc = (tau > 0) ? Math.exp(-1 / (tau * sr)) : 1;
    k.bF1 = f1;
    k.bF = f0 - f1;
  }
  function clusterA(k, base, decS, attS, gain, sr, invSr, tf) {
    if (k.aSt === 0) k.cnt += 1;
    k.aSt = 1; k.aV = 0;
    k.aAs = 1 / Math.max(1, Math.round(attS * sr));
    k.aDc = envCoef(decS, sr);
    k.aW = 1; k.aG = gain;
    k.aPh = 0; k.aP = 1; k.aPc = 1; k.aF = 0; k.aF1 = 0;
    const cap = sr * 0.45;
    for (let i = 0; i < 6; i++) {
      let f = base * CLUSTER_R[i] * tf;
      if (f > cap) f = cap; else if (f < 20) f = 20;
      k.aCf[i] = f * invSr;
      k.aCp[i] = 0;
    }
  }
  function noiseN(k, eng, mode, fc, kq, decS, attS, gain, sr) {
    if (k.nSt === 0) k.cnt += 1;
    k.nSt = 1; k.nV = 0;
    k.nAs = 1 / Math.max(1, Math.round(attS * sr));
    k.nDc = envCoef(decS, sr);
    k.cbn = 0; k.cbd = 0;
    k.nSeed = drumU32(eng) | 1;             /* odd => never zero (xorshift fixed point) */
    let f = fc;
    if (f > sr * 0.45) f = sr * 0.45; else if (f < 20) f = 20;
    const g = Math.tan(Math.PI * f / sr);
    const a1 = 1 / (1 + g * (g + kq));
    k.nA1 = a1; k.nA2 = g * a1; k.nA3 = g * g * a1;
    k.nFk = kq; k.nMode = mode; k.nG = gain;
    k.nIc1 = 0; k.nIc2 = 0;
  }

  /* per-NOTE reset (called from reinitVoice when v.kindId is 3). Assumes the shared fields
     v.noteMidi (preferred) / v.pitch (fallback) are already set by the caller. */
  function initVoice(eng, v) {
    const k = v.k;
    if (!k) return;
    const kext = eng.kext;
    if (!kext) return;
    const sr = eng.sr;
    const invSr = 1 / sr;
    kext.invSr = invSr;                     /* sr is fixed per engine; refresh per note is cheap */
    kext.smv = 1 - Math.exp(-1 / (0.012 * sr));
    if (eng.rng === 0 || !isFinite(eng.rng)) eng.rng = 0x9E3779B9;

    /* reset this tail */
    k.cnt = 0;
    k.dvol = kext.vol;
    k.aSt = 0; k.bSt = 0; k.nSt = 0;
    k.cbn = 0; k.cbd = 0;

    let m = v.noteMidi;
    if (!isFinite(m) && isFinite(v.pitch)) m = Math.round(v.pitch);
    const kit = kitFor(m);
    k.kit = kit;
    if (kit < 0) return;                    /* non-finite note: silent voice, instantly done */

    const tf = Math.pow(2, kext.vtune[kit] / 12);   /* tune: every frequency in the voice */
    const dec = kext.vdecay[kit];
    const lvl = kext.vlevel[kit];

    /* 909 hat law: a new ch silences ringing ch/oh voices; a new oh silences a ringing oh.
       Cross-voice writes happen at note start only; fully guarded (skips itself, idle voices,
       other kinds). */
    if (kit === 4 || kit === 5) {
      const chc = envCoef(0.05, sr);
      const vs = eng.voices;
      for (let i = 0; i < eng.maxVoices; i++) {
        const w = vs[i];
        if (!w || w === v || w.state === 0 || !w.k || w.kindId !== 3) continue;
        const wkit = w.k.kit;
        if (wkit !== 4 && wkit !== 5) continue;
        if (kit === 5 && wkit === 4) continue;    /* an oh never cuts a ch */
        const wk = w.k;
        if (wk.aSt !== 0 && wk.aDc > chc) wk.aDc = chc;
        if (wk.bSt !== 0 && wk.bDc > chc) wk.bDc = chc;
        if (wk.nSt !== 0 && wk.nDc > chc) wk.nDc = chc;
      }
    }

    /* ---- the kit recipes (PF pfSXDrumBuild lineage; own clean-room per-sample code) ---- */
    if (kit === 0) {                                       /* kick: 155->44 Hz sweep + hp click */
      toneA(k, 155 * tf, 44 * tf, Math.max(0.012, dec * 0.12), dec, ATT_TONE, 1.00 * lvl, sr);
      noiseN(k, eng, 2, 1500 * tf, 0.9, Math.max(0.02, dec * 0.08), ATT_NOISE, 0.22 * lvl, sr);
    } else if (kit === 1) {                                /* snare: two body sines + bp noise */
      toneA(k, 185 * tf, 185 * tf, 0, dec * 0.55, ATT_TONE, 0.55 * lvl, sr);
      toneB(k, 331 * tf, 331 * tf, 0, dec * 0.50, ATT_TONE, 0.38 * lvl, sr);
      noiseN(k, eng, 1, 1900 * tf, 1.4, dec, ATT_NOISE, 0.95 * lvl, sr);
    } else if (kit === 2) {                                /* rim: 1750->1600 click + hp snap */
      toneA(k, 1750 * tf, 1600 * tf, 0.004, dec, ATT_CLICK, 0.65 * lvl, sr);
      noiseN(k, eng, 2, 3200 * tf, 0.9, dec * 0.6, ATT_NOISE, 0.50 * lvl, sr);
    } else if (kit === 3) {                                /* clap: 4-burst bp noise */
      noiseN(k, eng, 1, 1200 * tf, 0.83, dec, ATT_NOISE, 1.00 * lvl, sr);
      k.nSt = 2; k.nV = 0.9;                               /* first burst starts at full */
      k.nDc = envCoef(0.06, sr);                           /* burst cadence ~11 ms at 25% re-strike */
      k.cbn = 3;                                           /* 3 retriggers after the first burst */
      k.cbd = envCoef(dec, sr);                            /* final tail = the decay param */
    } else if (kit === 4) {                                /* ch: hp noise tick */
      noiseN(k, eng, 2, 7500 * tf, 0.9, dec, ATT_NOISE, 0.70 * lvl, sr);
    } else if (kit === 5) {                                /* oh: hp noise wash */
      noiseN(k, eng, 2, 7000 * tf, 0.9, dec, ATT_NOISE, 0.65 * lvl, sr);
    } else if (kit === 6 || kit === 7 || kit === 8) {      /* toms: sine sweep + bp thump */
      const j = kit - 6;
      const f0 = [140, 190, 260][j] * tf;
      const f1 = [90, 120, 160][j] * tf;
      const nf = [300, 380, 470][j] * tf;
      toneA(k, f0, f1, Math.max(0.008, dec * 0.10), dec, ATT_TONE, 0.90 * lvl, sr);
      noiseN(k, eng, 1, nf, 1.43, dec * 0.18, ATT_NOISE, 0.30 * lvl, sr);
    } else if (kit === 9) {                                /* crash: inharmonic cluster + hp air */
      clusterA(k, 1800, dec * 0.9, ATT_CYM, 0.32 * lvl, sr, invSr, tf);
      noiseN(k, eng, 2, 3200 * tf, 0.9, dec, ATT_NOISE, 0.65 * lvl, sr);
    } else {                                               /* ride: cluster + 5.2k ping + stick */
      clusterA(k, 1400, dec * 0.95, ATT_CYM, 0.32 * lvl, sr, invSr, tf);
      toneB(k, 5200 * tf, 5200 * tf, 0, dec * 0.05, ATT_CLICK, 0.26 * lvl, sr);
      noiseN(k, eng, 2, 4500 * tf, 0.9, dec * 0.22, ATT_NOISE, 0.35 * lvl, sr);
    }

    /* per-hit life: seeded phase offsets (deterministic — eng.rng stream, same note order) */
    if (k.aSt !== 0) k.aPh = drumUnit(eng);
    if (k.bSt !== 0) k.bPh = drumUnit(eng);
    if (k.aW === 1) { for (let i = 0; i < 6; i++) k.aCp[i] = drumUnit(eng); }
  }

  /* one-shots: no release semantics — the tail's own decay drives isVoiceDone (§3.3) */
  function releaseVoice(eng, v) {
    void eng; void v;
  }

  /* true once a RELEASED voice's last component reached its envelope floor; never true for an
     unreleased (active/stealing) voice — checkable in any state by the parent */
  function isVoiceDone(eng, v) {
    void eng;
    if (v.state !== 2) return false;
    const k = v.k;
    return !k || k.cnt === 0;
  }

  /* ---- the per-sample kernel (base rate; nothing here allocates) ---- */
  function stepVoice(eng, v) {
    const k = v.k;
    if (!k) return 0;
    const kext = eng.kext;
    if (!kext) return 0;
    let out = 0;

    /* drum.volume rides ringing voices (one-pole, ~12 ms) */
    k.dvol += (kext.vol - k.dvol) * kext.smv;

    /* --- component A: sine with pitch env, or inharmonic cluster --- */
    if (k.aSt === 1) {
      k.aV += k.aAs;
      if (k.aV >= 1) { k.aV = 1; k.aSt = 2; }
    } else if (k.aSt === 2) {
      k.aV *= k.aDc;
      if (k.aV < ENV_FLOOR) { k.aV = 0; k.aSt = 0; k.cnt -= 1; }
    }
    if (k.aSt !== 0) {
      if (k.aW === 0) {
        k.aP *= k.aPc;
        let ph = k.aPh + (k.aF1 + k.aF * k.aP) * kext.invSr;
        if (ph >= 1) ph -= 1;
        k.aPh = ph;
        out += sine(ph) * k.aV * k.aG;
      } else {
        const cf = k.aCf;
        const cp = k.aCp;
        let w = 0;
        for (let i = 0; i < 6; i++) {
          let p = cp[i] + cf[i];
          if (p >= 1) p -= 1;
          cp[i] = p;
          w += CLUSTER_A[i] * sine(p);
        }
        out += w * k.aV * k.aG;
      }
    }

    /* --- component B: secondary sine with pitch env --- */
    if (k.bSt === 1) {
      k.bV += k.bAs;
      if (k.bV >= 1) { k.bV = 1; k.bSt = 2; }
    } else if (k.bSt === 2) {
      k.bV *= k.bDc;
      if (k.bV < ENV_FLOOR) { k.bV = 0; k.bSt = 0; k.cnt -= 1; }
    }
    if (k.bSt !== 0) {
      k.bP *= k.bPc;
      let ph = k.bPh + (k.bF1 + k.bF * k.bP) * kext.invSr;
      if (ph >= 1) ph -= 1;
      k.bPh = ph;
      out += sine(ph) * k.bV * k.bG;
    }

    /* --- component N: noise through a TPT SVF (lp/bp/hp), with the clap burst law --- */
    if (k.nSt === 1) {
      k.nV += k.nAs;
      if (k.nV >= 1) { k.nV = 1; k.nSt = 2; }
    } else if (k.nSt === 2) {
      k.nV *= k.nDc;
      if (k.cbn > 0 && k.nV < 0.25) {          /* clap: next burst */
        k.cbn -= 1;
        k.nV = 0.9;
        if (k.cbn === 0) k.nDc = k.cbd;        /* last re-strike decays with the decay param */
      } else if (k.nV < ENV_FLOOR) { k.nV = 0; k.nSt = 0; k.cnt -= 1; }
    }
    if (k.nSt !== 0) {
      let x = k.nSeed;
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x = x >>> 0;
      k.nSeed = x;
      const nx = x * 4.656612873077393e-10 - 1;
      const v3 = nx - k.nIc2;
      const v1 = k.nA1 * k.nIc1 + k.nA2 * v3;
      const v2 = k.nIc2 + k.nA2 * k.nIc1 + k.nA3 * v3;
      k.nIc1 = 2 * v1 - k.nIc1;
      k.nIc2 = 2 * v2 - k.nIc2;
      const nm = k.nMode;
      const nw = nm === 2 ? (nx - k.nFk * v1 - v2) : (nm === 1 ? v1 : v2);
      out += nw * k.nV * k.nG;
    }

    return out * k.dvol;
  }

  /* ---- params: `drum.` paths only (unknown path -> false, never throws) ---- */
  function setParam(eng, path, value) {
    if (typeof path !== "string") return false;
    const kext = eng && eng.kext;
    if (!kext) return false;
    if (path === "drum.split") {
      const n = Number(value);
      if (!isFinite(n)) return false;
      kext.split = cl(Math.round(n), 0, 127);        /* 0 = off (parent routeKind reads this) */
      return true;
    }
    if (path === "drum.volume") {
      const n = Number(value);
      if (!isFinite(n)) return false;
      kext.vol = cl(n, 0, 1);
      return true;
    }
    if (path.indexOf("drum.") !== 0) return false;
    const rest = path.slice(5);
    const dot = rest.indexOf(".");
    if (dot < 1 || dot === rest.length - 1) return false;
    const vi = VOICE_IDS.indexOf(rest.slice(0, dot));
    if (vi < 0) return false;
    const p = rest.slice(dot + 1);
    const n = Number(value);
    if (!isFinite(n)) return false;
    if (p === "tune") { kext.vtune[vi] = cl(n, -12, 12); return true; }
    if (p === "decay") { kext.vdecay[vi] = cl(n, 0.02, 2); return true; }
    if (p === "level") { kext.vlevel[vi] = cl(n, 0, 1); return true; }
    return false;
  }

  /* fresh copy of every default (panel boot / parent replay can align against this) */
  function defaults() {
    const voices = {};
    for (let i = 0; i < N; i++) voices[VOICE_IDS[i]] = { tune: DEF_TUNE[i], decay: DEF_DECAY[i], level: DEF_LEVEL[i] };
    return { split: 0, volume: 0.9, voices: voices };
  }

  /* ---- the one top-level return: the kind module ---- */
  return {
    VERSION: VERSION,
    PREFIX: PREFIX,
    map: MAP,
    voiceIds: VOICE_IDS,
    kitFor: kitFor,
    defaults: defaults,
    initEngineK: initEngineK,
    initVoiceK: initVoiceK,
    initVoice: initVoice,
    stepVoice: stepVoice,
    releaseVoice: releaseVoice,
    isVoiceDone: isVoiceDone,
    setParam: setParam,
  };
})();

if (typeof AVDSP !== "undefined" && typeof AVDSP.registerKind === "function") AVDSP.registerKind(3, AVDRUM);
