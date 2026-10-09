/* av_fm.js - Anvil M1 FM voice engine: kind 6 (AVFM), param prefix "fm".
   Contract: verify/_m1_wave.md section 2.1 (exact param schema + the node-harness test list).
   The kind-module interface mirrored here is verify/_p2_wave.md section 2.1 (initEngineK /
   initVoiceK / initVoice / stepVoice / releaseVoice / isVoiceDone / setParam + the guarded
   registerKind footer), patterned after the living templates src/av_acid.js and src/av_grain.js.
   Lineage: classic digital phase-modulation synthesis (Chowning-lineage FM) with DX-style
   per-operator ADSR envelopes; written from first principles for this project - no third-party
   source was used, copied or vendored.

   LAWS (same house laws as av_acid/av_grain):
   - strict mode; exactly ONE top-level name (AVFM); worklet-safe: no page globals, no network,
     no timers; this exact text is concatenated into the AudioWorklet module AND ships inside
     the page-side SPN tier.
   - stepVoice allocates NOTHING (no objects, arrays, closures, strings); every field is created
     in initVoiceK (voice) / initEngineK (eng.kext) and the shape is monomorphic; no throws on
     any path; NaN-proof: every parameter is clamped in setParam AND re-guarded at every use.
   - deterministic: no randomness anywhere; all six operator phases reset to 0 at note-on; the
     only cross-sample state is the operator phase bank, the envelopes, the smoothed parameters
     and the op6 feedback history.

   TOPOLOGY. Six phase-modulation operators op1..op6 (indices 0..5), eight algorithms
   (fm.algo 0..7). Operator output = sin(2*pi*(phase + inCycles)) * env * level * velGain,
   where inCycles is the sum of the outputs of that operator's listed modulators. One unit of
   operator output = one carrier cycle = 2*pi rad of phase offset, so a modulator at level 1
   with no attenuation is a modulation index of 2*pi. Operators are evaluated in DESCENDING
   index order (5..0) and every algorithm edge points from a higher index to a lower one, so
   modulators are always computed before their targets in the same base-rate sample (zero-delay
   FM; no extra latch). Operator 6 has DX-style self-feedback: its previous sample's output
   (post level and envelope) is added to its own phase input scaled by fm.fb - feedback is
   therefore inaudible while fm.op6.level is 0, and it only reaches the output where the
   algorithm routes op6 into a carrier. The voice output is the SUM of the carrier outputs,
   scaled by fm.volume.

   THE EIGHT ALGORITHMS (op numbers 1-based in these names; algoInfo reports 0-based indices).
     0 "2-op stack (2>1)"                 op2>op1                             carriers 1
     1 "3-op chain (3>2>1)"               op3>op2>op1                         carriers 1
     2 "4-op chain (4>3>2>1)"             op4>op3>op2>op1                     carriers 1
     3 "twin 2-op (2>1 | 4>3)"            op2>op1, op4>op3                    carriers 1,3
     4 "3-chain + 2-op (3>2>1 | 5>4)"     op3>op2>op1, op5>op4                carriers 1,4
     5 "parallel mods (5>1, 6>1)"         op5>op1, op6>op1                    carriers 1
     6 "4-chain + 2-op (4>3>2>1 | 6>5)"   op4>op3>op2>op1, op6>op5            carriers 1,5
     7 "triple 2-op (2>1 | 4>3 | 6>5)"    op2>op1, op4>op3, op6>op5           carriers 1,3,5
   op1 stays a carrier in every algorithm so the default patch (op1 level 1, op2 level 0.35,
   ratio 1:2) sounds on all eight. Operators that are not carriers are never summed; an
   operator with no modulation path into a carrier is computed but silent (its level has no
   audible effect) - exactly as algoInfo(i) reports.

   ENVELOPES (DX-style, one per operator, all six always run): linear attack 0->1 over att
   seconds; exponential decay toward sus with the -40 dB per-dec law (coeff exp(-4.6/(dec*sr)));
   sustain held at sus until release; exponential release with coeff exp(-4.6/(rel*sr)) down to
   a 1e-5 floor, then the stage is done. releaseVoice() moves every live stage to release.
   isVoiceDone() reports a released voice done once every operator has finished OR holds level
   target 0 with the smoothed level already silent (unused operators never hold a voice open).

   RENDER CADENCE (live-param law): fm.algo is read every sample (routing is a static table,
   nothing is allocated). All other parameters are re-read every 64 base samples and one-pole
   smoothed with the house 15 ms law (level, increment from ratio+detune, feedback amount,
   volume); envelope coefficients, sustain levels and velocity gains refresh at the same
   64-sample cadence. Module-owned pitch glide (same cadence; mirrors the parent glide law)
   plus eng.bend + eng.tune becomes f0 = 440*2^(st/12) clamped to [20, 0.45*sr]; every operator
   increment is clamped to [1e-9, 0.5] cycles per base sample (first-order content always
   below Nyquist).

   BASE-RATE CHOICE (pin): this engine runs at the base sample rate - no oversampling and no
   decimation (unlike acid/string/drum). FM is defined by its phase-recurrence itself and the
   shared kind contract hands each voice exactly one base-rate sample; the Nyquist-relevant
   quantities are the operator increments, which are clamped. The FM sideband series above
   Nyquist is deliberately un-band-limited (classic digital FM) and folds like any
   phase-modulation instrument. The operator wave is Math.sin (exact, no wavetable): the
   single-op harmonic-2 measurement in the M1 harness pins <= -60 dBc with a huge margin.

   PARAM SCHEMA (exact names and ranges; the FM card builds its controls from this):
     fm.algo    int 0..7     def 0
     fm.fb      0..1         def 0
     fm.volume  0..1         def 0.8
     fm.opN.ratio   0.5..16   def op1 1, op2 2, op3..op6 1   (detune is in semitones)
     fm.opN.detune  -1..1     def 0
     fm.opN.level   0..1      def op1 1, op2 0.35, op3..op6 0
     fm.opN.att     0.001..8  def 0.001
     fm.opN.dec     0.001..8  def 1.2
     fm.opN.sus     0..1      def 0.5
     fm.opN.rel     0.001..8  def 0.3
     fm.opN.vel     0..1      def 0.5   (velocity gain = 1 - vel*(1 - v.vel))
   setParam accepts every path above, clamps accepted values, and returns false for every
   unknown or non-finite request. algoInfo(i) returns { name, carriers:[idx..],
   edges:[[from,to]..] } with 0-based indices, or null when i is outside 0..7; the DSP routing
   and algoInfo are built from the SAME tables (single source of truth).

   VOICE FIELDS (created in initVoiceK on the shared v.k; prefixed fm; per-note reset in
   initVoice):
     k.fmPh      Float64Array(6)  operator phase, cycles [0,1)
     k.fmOut     Float64Array(6)  operator outputs; out[5] doubles as the feedback history
     k.fmEnv     Float64Array(6)  envelope level 0..1
     k.fmStage   Uint8Array(6)    envelope stage 0 off - 1 attack - 2 decay - 3 sustain -
                                  4 release
     k.fmSL      Float64Array(6)  smoothed operator level
     k.fmTL      Float64Array(6)  target operator level
     k.fmSI      Float64Array(6)  smoothed increment (cycles per base sample)
     k.fmTI      Float64Array(6)  target increment
     k.fmAstep  Float64Array(6)  attack step per sample
     k.fmDc      Float64Array(6)  decay coefficient (-40 dB law)
     k.fmRc      Float64Array(6)  release coefficient
     k.fmSusV    Float64Array(6)  sustain level
     k.fmVelG    Float64Array(6)  per-op velocity gain
     k.fmSmp     number           per-note sample counter (64-sample refresh cadence)
     k.fmPitch   number           module-owned gliding pitch (MIDI units)
     k.fmGliding number           1 while the note glides to its target
     k.fmSR      number           cached engine sample rate
     k.fmS15     number           cached house 15 ms smoothing coefficient
     k.fmSFb     number           smoothed feedback amount
     k.fmTFb     number           target feedback amount
     k.fmSVol    number           smoothed volume
     k.fmTVol    number           target volume
   KEXT FIELDS (eng.kext, filled by initEngineK; plain numbers or Float64Array(6)):
     fmAlgo fmFb fmVol fmRatio fmDet fmLvl fmAtt fmDec fmSus fmRel fmVel                    */
"use strict";

const AVFM = (function () {
  "use strict";

  const VERSION = "m1.0";
  const PREFIX = "fm";
  const TAU = Math.PI * 2;
  const NOP = 6;             /* operator count */
  const REFRESH = 64;        /* base samples between parameter refreshes */
  const SILENT = 1e-12;      /* operator output floor: below this an op is skipped (inaudible) */
  const ENV_FLOOR = 1e-5;    /* envelope done floor (house ADSR law) */

  /* ---- the eight algorithms: the single source of truth for BOTH the DSP routing and
     algoInfo(). ALGO_CARRIERS[a] = operator indices summed into the output;
     ALGO_EDGES[a] = [from, to] modulation pairs. Invariant (checked in the M1 harness):
     every edge has from > to - that is exactly what makes the descending 5..0 evaluation
     order exact (modulators always computed before their targets). */
  const ALGO_NAMES = [
    "2-op stack (2>1)",
    "3-op chain (3>2>1)",
    "4-op chain (4>3>2>1)",
    "twin 2-op (2>1 | 4>3)",
    "3-chain + 2-op (3>2>1 | 5>4)",
    "parallel mods (5>1, 6>1)",
    "4-chain + 2-op (4>3>2>1 | 6>5)",
    "triple 2-op (2>1 | 4>3 | 6>5)",
  ];
  const ALGO_CARRIERS = [[0], [0], [0], [0, 2], [0, 3], [0], [0, 4], [0, 2, 4]];
  const ALGO_EDGES = [
    [[1, 0]],
    [[2, 1], [1, 0]],
    [[3, 2], [2, 1], [1, 0]],
    [[1, 0], [3, 2]],
    [[2, 1], [1, 0], [4, 3]],
    [[4, 0], [5, 0]],
    [[3, 2], [2, 1], [1, 0], [5, 4]],
    [[1, 0], [3, 2], [5, 4]],
  ];

  /* ---- compiled routing (built once at load; read-only afterwards): per algorithm, for each
     target op t, the flat source list src[base[t] .. base[t]+srcN[t]-1], plus carriers. */
  const ROUTES = (function () {
    const out = [];
    for (let a = 0; a < ALGO_NAMES.length; a++) {
      const src0 = ALGO_CARRIERS[a];
      const car = new Int8Array(src0.length);
      for (let c = 0; c < src0.length; c++) car[c] = src0[c];
      const ed = ALGO_EDGES[a];
      const srcN = new Int8Array(NOP);
      for (let e = 0; e < ed.length; e++) srcN[ed[e][1]]++;
      const base = new Int8Array(NOP);
      let tot = 0;
      for (let t = 0; t < NOP; t++) { base[t] = tot; tot += srcN[t]; }
      const src = new Int8Array(tot);
      const fill = new Int8Array(NOP);
      for (let e = 0; e < ed.length; e++) {
        const f = ed[e][0], t = ed[e][1];
        src[base[t] + fill[t]] = f;
        fill[t]++;
      }
      out.push({ nCar: car.length, car: car, srcN: srcN, base: base, src: src });
    }
    return out;
  })();

  function cl(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ---- engine level (eng.kext) ---- */
  function initEngineK(kext) {
    kext.fmAlgo = 0;
    kext.fmFb = 0;
    kext.fmVol = 0.8;
    const ratio = new Float64Array(NOP);
    ratio[0] = 1; ratio[1] = 2; ratio[2] = 1; ratio[3] = 1; ratio[4] = 1; ratio[5] = 1;
    kext.fmRatio = ratio;
    kext.fmDet = new Float64Array(NOP);
    const lvl = new Float64Array(NOP);
    lvl[0] = 1; lvl[1] = 0.35;
    kext.fmLvl = lvl;
    kext.fmAtt = new Float64Array(NOP); kext.fmAtt.fill(0.001);
    kext.fmDec = new Float64Array(NOP); kext.fmDec.fill(1.2);
    kext.fmSus = new Float64Array(NOP); kext.fmSus.fill(0.5);
    kext.fmRel = new Float64Array(NOP); kext.fmRel.fill(0.3);
    kext.fmVel = new Float64Array(NOP); kext.fmVel.fill(0.5);
  }

  /* defensive: build the kind fields if the parent wiring has not yet (mirrors av_grain).
     Never called from the per-sample path with work to do - a single property compare. */
  function ensureKext(eng) {
    if (!eng) return null;
    let kx = eng.kext;
    if (!kx) { kx = {}; initEngineK(kx); eng.kext = kx; return kx; }
    if (kx.fmAlgo === undefined) initEngineK(kx);
    return kx;
  }

  /* ---- per-voice fields (monomorphic shape; called once per voice at engine create) ---- */
  function initVoiceK(k) {
    k.fmPh = new Float64Array(NOP);
    k.fmOut = new Float64Array(NOP);
    k.fmEnv = new Float64Array(NOP);
    k.fmStage = new Uint8Array(NOP);
    k.fmSL = new Float64Array(NOP);
    k.fmTL = new Float64Array(NOP);
    k.fmSI = new Float64Array(NOP);
    k.fmTI = new Float64Array(NOP);
    k.fmAstep = new Float64Array(NOP); k.fmAstep.fill(0.02);
    k.fmDc = new Float64Array(NOP); k.fmDc.fill(0.99);
    k.fmRc = new Float64Array(NOP); k.fmRc.fill(0.99);
    k.fmSusV = new Float64Array(NOP);
    k.fmVelG = new Float64Array(NOP); k.fmVelG.fill(1);
    k.fmSmp = 0;
    k.fmPitch = 60;
    k.fmGliding = 0;
    k.fmSR = 48000;
    k.fmS15 = 0.001;
    k.fmSFb = 0;
    k.fmTFb = 0;
    k.fmSVol = 0.8;
    k.fmTVol = 0.8;
  }

  /* ---- targets (block cadence): pitch -> per-op increments, levels, envelope coefficients,
     feedback, volume. Every read is re-guarded (hostile kext writes cannot produce NaN). ---- */
  function computeTargets(eng, v) {
    const k = v.k;
    const kx = ensureKext(eng);
    if (!kx) return;
    if (!isFinite(k.fmPitch)) k.fmPitch = 60;
    const sr = (k.fmSR > 0 && isFinite(k.fmSR)) ? k.fmSR : 48000;
    let bend = eng.bend, tune = eng.tune;
    if (!isFinite(bend)) bend = 0;
    if (!isFinite(tune)) tune = 0;
    let tuneOff = v.tuneOff;                  /* T wave: per-note microtuning (semis; constant per voice) */
    if (!isFinite(tuneOff)) tuneOff = 0;
    let st = (k.fmPitch - 69) + bend + tune + tuneOff;
    if (!isFinite(st)) st = 0;
    if (st < -132) st = -132; else if (st > 132) st = 132;
    let f0 = 440 * Math.pow(2, st / 12);
    if (!(f0 >= 20)) f0 = 20; else if (f0 > sr * 0.45) f0 = sr * 0.45;
    let vel = v.vel;
    if (!(vel >= 0)) vel = 0; else if (vel > 1) vel = 1;
    let fb = kx.fmFb;
    if (!(fb >= 0)) fb = 0; else if (fb > 1) fb = 1;
    k.fmTFb = fb;
    let vol = kx.fmVol;
    if (!(vol >= 0)) vol = 0; else if (vol > 1) vol = 1;
    k.fmTVol = vol;
    for (let i = 0; i < NOP; i++) {
      let r = kx.fmRatio[i];
      if (!(r >= 0.5)) r = 0.5; else if (r > 16) r = 16;
      let d = kx.fmDet[i];
      if (!(d >= -1)) d = -1; else if (d > 1) d = 1;
      let inc = (f0 * r * Math.pow(2, d / 12)) / sr;
      if (!(inc >= 1e-9)) inc = 1e-9; else if (inc > 0.5) inc = 0.5;
      k.fmTI[i] = inc;
      let lv = kx.fmLvl[i];
      if (!(lv >= 0)) lv = 0; else if (lv > 1) lv = 1;
      k.fmTL[i] = lv;
      let a = kx.fmAtt[i];
      if (!(a >= 0.001)) a = 0.001; else if (a > 8) a = 8;
      k.fmAstep[i] = 1 / (a * sr);
      let dc = kx.fmDec[i];
      if (!(dc >= 0.001)) dc = 0.001; else if (dc > 8) dc = 8;
      k.fmDc[i] = Math.exp(-4.6 / (dc * sr));
      let su = kx.fmSus[i];
      if (!(su >= 0)) su = 0; else if (su > 1) su = 1;
      k.fmSusV[i] = su;
      let rl = kx.fmRel[i];
      if (!(rl >= 0.001)) rl = 0.001; else if (rl > 8) rl = 8;
      k.fmRc[i] = Math.exp(-4.6 / (rl * sr));
      let vv = kx.fmVel[i];
      if (!(vv >= 0)) vv = 0; else if (vv > 1) vv = 1;
      k.fmVelG[i] = 1 - vv * (1 - vel);
    }
  }

  /* ---- block-cadence refresh: module glide + release belt-and-braces + targets ---- */
  function refresh(eng, v) {
    const k = v.k;
    if (k.fmGliding === 1) {
      const gi = v.glideInc, tg = v.pitchTarget;
      if (isFinite(gi) && isFinite(tg)) {
        let np = k.fmPitch + gi * REFRESH;
        if ((gi > 0 && np >= tg) || (gi < 0 && np <= tg)) { np = tg; k.fmGliding = 0; }
        if (isFinite(np)) k.fmPitch = np;
      } else {
        k.fmGliding = 0;
      }
    }
    if (v.state === 2) {
      const s = k.fmStage;
      for (let i = 0; i < NOP; i++) { const t = s[i]; if (t !== 0 && t !== 4) s[i] = 4; }
    }
    computeTargets(eng, v);
  }

  /* ---- per-note reset (called from reinitVoice when v.kindId is 6) ---- */
  function initVoice(eng, v) {
    const k = v.k;
    if (!k || !k.fmStage) return;
    const kx = ensureKext(eng);
    if (!kx) return;
    let sr = eng.sr;
    if (!(sr > 0) || !isFinite(sr)) sr = 48000;
    k.fmSR = sr;
    k.fmS15 = 1 - Math.exp(-1 / (0.015 * sr));
    let p = v.pitch;
    if (!isFinite(p)) p = 60;
    k.fmPitch = p;
    k.fmGliding = (v.gliding === true && isFinite(v.glideInc) && isFinite(v.pitchTarget)) ? 1 : 0;
    k.fmPh.fill(0);
    k.fmOut.fill(0);
    k.fmEnv.fill(0);
    k.fmStage.fill(1);           /* all six operators attack together (DX key-sync law) */
    k.fmSmp = 0;
    computeTargets(eng, v);
    /* seed the smoothed state to the targets: no ramp at note start */
    k.fmSL.set(k.fmTL);
    k.fmSI.set(k.fmTI);
    k.fmSFb = k.fmTFb;
    k.fmSVol = k.fmTVol;
  }

  function releaseVoice(eng, v) {
    if (!v || !v.k) return;
    const s = v.k.fmStage;
    if (!s) return;
    for (let i = 0; i < NOP; i++) { const t = s[i]; if (t !== 0 && t !== 4) s[i] = 4; }
  }

  /* ---- one base-rate sample of the FM voice --------------------------------------------
     envelopes -> algorithm table -> operators (descending) -> carrier sum -> volume. */
  function stepVoice(eng, v) {
    const k = v && v.k;
    const kext = eng && eng.kext;
    if (!k || !k.fmStage || !kext) return 0;
    if ((k.fmSmp & 63) === 0) refresh(eng, v);
    k.fmSmp = k.fmSmp + 1;

    /* operator envelopes: one step per output sample, all six always run (monomorphic) */
    const env = k.fmEnv, stg = k.fmStage, ast = k.fmAstep, dcv = k.fmDc,
          susv = k.fmSusV, rcv = k.fmRc, velg = k.fmVelG;
    for (let i = 0; i < NOP; i++) {
      const st = stg[i];
      if (st === 2) {
        const s = susv[i];
        const e = s + (env[i] - s) * dcv[i];
        if (e - s < ENV_FLOOR) { env[i] = s; stg[i] = 3; } else env[i] = e;
      } else if (st === 4) {
        const e = env[i] * rcv[i];
        if (e < ENV_FLOOR) { env[i] = 0; stg[i] = 0; } else env[i] = e;
      } else if (st === 1) {
        const e = env[i] + ast[i];
        if (e >= 1) { env[i] = 1; stg[i] = 2; } else env[i] = e;
      }
    }

    /* algorithm routing: static table; fm.algo is live per sample */
    let ai = kext.fmAlgo | 0;
    if (ai < 0 || ai > 7) ai = 0;
    const R = ROUTES[ai];
    const out = k.fmOut, phA = k.fmPh, slA = k.fmSL, tlA = k.fmTL,
          siA = k.fmSI, tiA = k.fmTI;
    const sc = k.fmS15;
    k.fmSFb = k.fmSFb + (k.fmTFb - k.fmSFb) * sc;
    const fb = k.fmSFb;

    /* operators, descending index: a modulator's index is always ABOVE its targets', so the
       modulation reads below see this sample's modulator outputs (zero-delay FM). out[5] is
       the op6 feedback history: at i === 5 it is read before it is overwritten. */
    for (let i = NOP - 1; i >= 0; i--) {
      const sl = slA[i] + (tlA[i] - slA[i]) * sc;
      slA[i] = sl;
      const inc = siA[i] + (tiA[i] - siA[i]) * sc;
      siA[i] = inc;
      let ph = phA[i] + inc;
      if (ph >= 1) ph -= 1;
      phA[i] = ph;
      let m = 0;
      const b = R.base[i], nn = R.srcN[i];
      for (let j = 0; j < nn; j++) m = m + out[R.src[b + j]];
      if (i === 5) m = m + out[5] * fb;
      const e = env[i] * velg[i] * sl;
      out[i] = e > SILENT ? Math.sin(TAU * (ph + m)) * e : 0;
    }
    let y = 0;
    const car = R.car;
    for (let c = 0; c < R.nCar; c++) y = y + out[car[c]];
    k.fmSVol = k.fmSVol + (k.fmTVol - k.fmSVol) * sc;
    y = y * k.fmSVol;
    if (!(y > -64) || !(y < 64)) return 0;
    return y;
  }

  /* required: only a RELEASED voice may report done, and only when every operator is either
     finished or holds level target 0 with the smoothed level already silent. */
  function isVoiceDone(eng, v) {
    if (!v || v.state !== 2) return false;
    const k = v.k;
    if (!k || !k.fmStage) return true;
    const s = k.fmStage, tl = k.fmTL, sl = k.fmSL;
    for (let i = 0; i < NOP; i++) {
      if (s[i] === 0) continue;
      if (!(tl[i] <= 1e-9) || !(sl[i] <= 1e-9)) return false;
    }
    return true;
  }

  /* ---- parameters: fm.* only (unknown path or non-finite value -> false, never a throw;
     every accepted value is clamped) ---- */
  function setParam(eng, path, value) {
    if (typeof path !== "string") return false;
    const kx = ensureKext(eng);
    if (!kx) return false;
    const n = Number(value);
    if (!isFinite(n)) return false;
    if (path === "fm.algo") {
      let a = Math.round(n);
      if (a < 0) a = 0; else if (a > 7) a = 7;
      kx.fmAlgo = a;
      return true;
    }
    if (path === "fm.fb") { kx.fmFb = cl(n, 0, 1); return true; }
    if (path === "fm.volume") { kx.fmVol = cl(n, 0, 1); return true; }
    /* fm.opN.<field>, N = 1..6 (exact schema; no other op spellings accepted) */
    if (path.length < 8) return false;
    if (path.charCodeAt(0) !== 102 || path.charCodeAt(1) !== 109 || path.charCodeAt(2) !== 46) return false;
    if (path.charCodeAt(3) !== 111 || path.charCodeAt(4) !== 112) return false;
    const d = path.charCodeAt(5) - 49;                 /* "1".."6" -> 0..5 */
    if (d < 0 || d > 5) return false;
    if (path.charCodeAt(6) !== 46) return false;
    const f = path.slice(7);
    if (f === "ratio") { kx.fmRatio[d] = cl(n, 0.5, 16); return true; }
    if (f === "detune") { kx.fmDet[d] = cl(n, -1, 1); return true; }
    if (f === "level") { kx.fmLvl[d] = cl(n, 0, 1); return true; }
    if (f === "att") { kx.fmAtt[d] = cl(n, 0.001, 8); return true; }
    if (f === "dec") { kx.fmDec[d] = cl(n, 0.001, 8); return true; }
    if (f === "sus") { kx.fmSus[d] = cl(n, 0, 1); return true; }
    if (f === "rel") { kx.fmRel[d] = cl(n, 0.001, 8); return true; }
    if (f === "vel") { kx.fmVel[d] = cl(n, 0, 1); return true; }
    return false;
  }

  /* ---- algorithm info for the FM card: 0-based op indices (0 = fm.op1); fresh arrays;
     null for anything outside 0..7. Built from the SAME tables the DSP routing uses. ---- */
  function algoInfo(i) {
    const a = Number(i);
    if (!isFinite(a) || a !== Math.floor(a) || a < 0 || a > 7) return null;
    const r = ROUTES[a];
    const ed = ALGO_EDGES[a];
    const edges = [];
    for (let e = 0; e < ed.length; e++) edges.push([ed[e][0], ed[e][1]]);
    const carriers = [];
    for (let c = 0; c < r.nCar; c++) carriers.push(r.car[c]);
    return { name: ALGO_NAMES[a], carriers: carriers, edges: edges };
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
    algoInfo: algoInfo,
  };
})();

if (typeof AVDSP !== "undefined" && typeof AVDSP.registerKind === "function") {
  AVDSP.registerKind(6, AVFM);
}
