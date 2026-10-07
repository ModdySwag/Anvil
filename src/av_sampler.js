/* av_sampler.js -- Anvil SAMPLER voice engine: kind 5 (AVSAMPLER).
   Contract: verify/_p3_wave.md section 6 (one-shot / loop, root/tune, sampler.buf,
   sampler.vol, multisample ZONES v1 with the pinned {t:"zones"} Float64Array layout);
   the kind interface mirrored is verify/_p2_wave.md section 2.1. Spec lineage: docs/03
   section 2.1 (sampler voice: one-shot / loop / multisample zones) + docs/01.
   M2 (verify/_m2_wave.md section 2.4): ZONE TABLE v2 (16 x 9 fields) + per-slice WINDOW +
   edge FADES -- law 2b and the M2 behaviour/field blocks below; erases nothing from v1.

   LAWS THAT ARE PINNED HERE (the interfaces the parent wires must match EXACTLY):

   1. SAMPLE SLOT SHAPE (written by the processor at {t:"sample"} message time; up to 4 slots,
      each <= 60 s per channel; replacing a slot frees the old arrays):
        eng.samples = Array(4);  eng.samples[k] = null | { name, rate, n, ch1, ch2 }
        rate = the source sample rate (Hz); n = frame count (may be < ch1.length when the
        60 s clamp truncated the upload); ch1 = Float32Array; ch2 = Float32Array or null.
      avSampleSendToEngine posts {t:"sample", id, name, rate, ch1, ch2?} with id = the slot
      index 0..3; a replaced slot never disturbs grains/voices that already latched refs.

   2. ZONE TABLE LAYOUT v1 ("{t:'zones', zones: Float64Array(40)}", 8 zones x 5 fields; zone i
      occupies [i*5 .. i*5+4]):
        [lo, hi, root, buf, vol]
          lo, hi : MIDI note range (inclusive; lo <= hi)
          root   : MIDI note that plays the zone at rate 1.0 (0..127)
          buf    : engine sample slot 0..3
          vol    : zone gain 0..1
      ACTIVE iff every field finite AND vol > 0 AND hi >= lo AND 0 <= lo <= 127.
      SELECTION per note: nearest-zone -- interval distance, 0 inside [lo,hi]; ties resolve to
      the LOWEST index (so "first containing, else nearest" is one strict-< scan). No active
      zone => sampler.buf/sampler.root/sampler.vol params govern; neither => silence.

   2b. ZONE TABLE v2 (M2): may arrive as Float64Array(144) = 16 zones x 9 fields; zone i
      occupies [i*9 .. i*9+8]:
        [lo, hi, root, buf, vol, s0, s1, fIn, fOut]
          s0, s1 : WINDOW fractions 0..1 of the latched slot's frame count (s1 > s0 is
                   enforced by the w1 law -- the window is always >= 1 frame)
          fIn, fOut : linear edge FADES in SECONDS (0..2)
      MODE DISPATCH by table length: zones.length >= 144 => v2 (16 zones, stride 9, all nine
      fields parsed); anything shorter (the legacy Float64Array(40) wire) => v1 (8 zones,
      stride 5, window defaults s0 0, s1 1, fades 0 for zones 0..7; zones 8..15 are not
      reachable in a 40-float table and stay inactive when the parent fills a 144 table from a
      40-float wire). v1 parsing and selection are the p3 law EXACTLY (regression-pinned).
      v2 ACTIVE = every one of the nine fields finite AND vol > 0 AND hi >= lo AND
      0 <= lo <= 127; selection = the v1 nearest-zone law over 16 zones (ties -> lowest
      index). Non-finite window/fade fields deactivate the zone (never a NaN path).

   BEHAVIOUR:
   - WINDOW (M2): the one-shot read head starts at w0 and reads [w0, w1) with
        w0 = min(n-1, round(s0*n)),  w1 = max(w0+1, min(n, round(s1*n)))
     (v1 / no-zone: s0 0, s1 1 => [0, n) -- the legacy range, bit-identical). The one-shot
     ENDED flag = head >= w1; the last in-window frame plays exactly; output 0 afterwards.
     The note holds the voice until release (kind law: only a released voice may report done).
   - LOOP (sampler.loop 1): wraps inside [L0, L1) = [max(w0, lpS), min(w1, lpE)) -- lpS/lpE
     from the v1 (n-1) fraction law, intersected with the window. L1 <= L0 (or n < 2) =>
     loop off (documented; with w0 0 / w1 n this is the v1 law verbatim). The head still
     starts at w0 (the v1 pre-roll from the buffer start when lpS > 0 is preserved as a
     pre-roll from w0). Wrap lands exactly on L0 + fractional overshoot (within +-1 sample of
     the intended loop point for any increment; multi-wrap is exact via a remainder).
   - FADES (M2): fade-in ramps amplitude 0 -> 1 over svFIn = round(fIn*sr) OUTPUT samples,
     counted from the first windowed sample (gain = c/N with c = the windowed output-sample
     counter; hits exactly 1 at c = N). Fade-out ramps 1 -> 0 over svFOut = round(fOut*sr)
     OUTPUT samples ENDING AT w1, ONE-SHOT ONLY (gain = (w1 - p)/(N*inc) with p = head): a
     loop has no end (it wraps at L1), so applying the w1 end fade per cycle would click at
     the wrap -- pinned interpretation, documented. On the one-shot endpoint the two latched
     lengths are clamped so the ramps never overlap (fade-in keeps priority, fade-out absorbs
     the trim; the budget is span = ceil((w1 - w0)/inc) output samples). The fades multiply
     AFTER the internal velocity law: g = vol * zvol * (0.3 + 0.7*vel) * rel * fa * fb. With
     no fades latched (v1 / no zone) fa = fb = 1 exactly => the v1 render is bit-identical.
   - rate: playback rate from key/root -- inc = (bufRate/sr) * 2^((v.pitch - root + tune +
     eng.bend + eng.tune)/12). Recomputed while gliding or when the shared pitchGen ticks
     (bend/tune/osc changes), so glides retune live (the read head carries no feedback path).
   - velocity to level: fixed law 0.3 + 0.7 * v.vel, applied INSIDE stepVoice per section 6.
     The shared kind path additionally multiplies v.vel, so the composed response is
     v.vel * (0.3 + 0.7 * v.vel); the internal law is kept verbatim (report deviation note).
   - release: a released voice (state 2) fades by exp to -60 dB in 30 ms and reports done
     (or immediately, if the one-shot already ended / no buffer). releaseVoice needs no hook.

   LAWS (worklet-safe): strict mode; ONE top-level name (AVSAMPLER); no page-scope reach-ins;
   allocation only at create (initVoiceK) / note-on (initVoice) / setParam / snap time;
   stepVoice allocates nothing (numbers only, refs latched at note-on); monomorphic k fields; every
   value clamped, no NaN path (non-finite zone fields are skipped; st clamped to +-120 st).

   VOICE FIELDS (on the shared per-voice `v.k`; prefix `sv`; initVoiceK creates all,
   initVoice re-fills per note):
     k.svPos   number  read position (frames, fractional)
     k.svInc   number  read increment (frames per output sample; latched per note/glide tick)
     k.svN     number  frame count of the latched slot (0 = no readable slot -> silence)
     k.svCh1   object|null  latched source slot ch1 ref
     k.svCh2   object|null  latched ch2 ref (null for mono)
     k.svRate  number  latched slot rate (Hz); inc = svRate/sr * 2^(st/12)
     k.svLoop  number  0|1 (latched at note start; invalid points force 0)
     k.svLpS   number  loop start frame (int; M2: max(w0, lpS))
     k.svLpE   number  loop end frame (int; M2: min(w1, lpE); loop region [lpS, lpE))
     k.svZone  number  selected zone index (-1 = none / params path)
     k.svBuf   number  selected engine slot 0..3 (evidence + fallback)
     k.svRoot  number  selected root MIDI note (0..127)
     k.svZvol  number  zone gain 0..1 (1 when no zone)
     k.svRel   number  release fade multiplier (1 until released, then exp decay)
     k.svRelC  number  release fade coefficient (~30 ms to -60 dB)
     k.svEnd   number  one-shot ended flag (head passed the window end w1)
     k.svWraps number  loop wrap events (evidence; multi-wrap counts each crossing)
     k.svPg    number  last v.pitchGen seen (glide/param retune trigger)
     k.svSmp   number  per-note sample counter (evidence)
     k.svW0    number  window start frame (int; 0 in v1 / no-zone)
     k.svW1    number  window end frame (int; n in v1 / no-zone; one-shot end at head >= w1)
     k.svFIn   number  latched fade-in length in OUTPUT samples (0 = no fade)
     k.svFOut  number  latched fade-out length in OUTPUT samples (0 = no fade; one-shot only)
     k.svFadeA number  fade-in gain of the current sample (evidence; exactly 1 = off)
     k.svFadeB number  fade-out gain of the current sample (evidence; exactly 1 = off)
     k.svSmpOut number windowed output-sample counter (the fade-in clock; freezes after end)
     k.svOutL  number  last sample's stereo pair (L); the shared mono path consumes the
     k.svOutR  number  stepVoice() return = 0.5*(L+R); the parent MAY read k.svOutL/R for a
                       true-stereo kind branch (reported hook).

   KEXT FIELDS (engine level, initEngineK):
     kext.svLoop 0|1 (default 0) · kext.svLpS 0..1 (default 0) · kext.svLpE 0..1 (default 1) ·
     kext.svRoot 0..127 (default 60) · kext.svTune -24..24 (default 0) ·
     kext.svBuf 0..3 (default 0) · kext.svVol 0..1 (default 0.8)                        */
"use strict";

const AVSAMPLER = (function () {

  const VERSION = "m2.0";
  const PREFIX = "sampler";
  const ZN = 8;                   /* v1 zones */
  const ZF = 5;                   /* v1 fields per zone: lo, hi, root, buf, vol */
  const ZN2 = 16;                 /* v2 zones (M2) */
  const ZF2 = 9;                  /* v2 fields per zone: lo, hi, root, buf, vol, s0, s1, fIn, fOut */
  const ZV2 = ZN2 * ZF2;          /* 144: minimum table length that engages v2 parsing */
  const REL_T60 = 0.03;           /* release fade: 30 ms to -60 dB */
  const DONE_REL = 1e-4;          /* release fade floor -> done */
  const DEF_LOOP = 0, DEF_LPS = 0, DEF_LPE = 1, DEF_ROOT = 60,
        DEF_TUNE = 0, DEF_BUF = 0, DEF_VOL = 0.8;

  function cl(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ---- engine level ---- */
  function initEngineK(kext) {
    kext.svLoop = DEF_LOOP;
    kext.svLpS = DEF_LPS;
    kext.svLpE = DEF_LPE;
    kext.svRoot = DEF_ROOT;
    kext.svTune = DEF_TUNE;
    kext.svBuf = DEF_BUF;
    kext.svVol = DEF_VOL;
  }
  /* defensive: build the kind fields if the parent integration has not yet (setParam /
     initVoice only -- never a per-sample path) */
  function ensureKext(eng) {
    let kx = eng.kext;
    if (!kx) { kx = {}; initEngineK(kx); eng.kext = kx; }
    else if (kx.svVol === undefined) initEngineK(kx);
    return kx;
  }

  /* ---- per-voice fields ---- */
  function initVoiceK(k) {
    k.svPos = 0;
    k.svInc = 1;
    k.svN = 0;
    k.svCh1 = null;
    k.svCh2 = null;
    k.svRate = 0;
    k.svLoop = 0;
    k.svLpS = 0;
    k.svLpE = 0;
    k.svZone = -1;
    k.svBuf = 0;
    k.svRoot = DEF_ROOT;
    k.svZvol = 1;
    k.svRel = 1;
    k.svRelC = 0.995;              /* placeholder; exact coefficient set in initVoice (needs sr) */
    k.svEnd = 0;
    k.svWraps = 0;
    k.svPg = -2;
    k.svSmp = 0;
    k.svW0 = 0;
    k.svW1 = 0;
    k.svFIn = 0;
    k.svFOut = 0;
    k.svFadeA = 1;
    k.svFadeB = 1;
    k.svSmpOut = 0;
    k.svOutL = 0;
    k.svOutR = 0;
  }

  /* ---- params: sampler.* only (unknown path -> false, never a throw; every value clamped) ---- */
  function setParam(eng, path, value) {
    const kx = ensureKext(eng);
    switch (path) {
      case "sampler.loop": {
        const n = Number(value); if (!isFinite(n)) return false;
        kx.svLoop = n >= 0.5 ? 1 : 0;
        return true;
      }
      case "sampler.loopStart": {
        const n = Number(value); if (!isFinite(n)) return false;
        kx.svLpS = cl(n, 0, 1);
        return true;
      }
      case "sampler.loopEnd": {
        const n = Number(value); if (!isFinite(n)) return false;
        kx.svLpE = cl(n, 0, 1);
        return true;
      }
      case "sampler.root": {
        const n = Number(value); if (!isFinite(n)) return false;
        kx.svRoot = cl(Math.round(n), 0, 127);
        return true;
      }
      case "sampler.tune": {
        const n = Number(value); if (!isFinite(n)) return false;
        kx.svTune = cl(n, -24, 24);
        return true;
      }
      case "sampler.buf": {
        const n = Number(value); if (!isFinite(n)) return false;
        kx.svBuf = cl(Math.round(n), 0, 3);
        return true;
      }
      case "sampler.vol": {
        const n = Number(value); if (!isFinite(n)) return false;
        kx.svVol = cl(n, 0, 1);
        return true;
      }
      default: return false;
    }
  }

  /* ---- zone selection (note-on only; defensive table read; allocates nothing) ----------
     MODE: zones.length >= 144 parses v2 (16 zones x 9 fields); anything shorter keeps the
     legacy v1 law (8 x 5) EXACTLY (regression-pinned). nearest-zone: interval distance with 0
     inside [lo,hi]; strict-< keeps the FIRST minimum (containing zone wins; ties -> lowest
     index). v2 ACTIVE = all nine fields finite AND vol > 0 AND hi >= lo AND 0 <= lo <= 127. */
  function pickZone(eng, midi) {
    const zt = eng.zones;
    if (!zt || typeof zt.length !== "number" || zt.length < ZF || !isFinite(midi)) return -1;
    let best = -1;
    let bestD = Infinity;
    if (zt.length >= ZV2) {
      for (let i = 0; i < ZN2; i++) {
        const b = i * ZF2;
        if (b + ZF2 > zt.length) break;
        const lo = zt[b], hi = zt[b + 1], root = zt[b + 2], buf = zt[b + 3], vol = zt[b + 4];
        const s0 = zt[b + 5], s1 = zt[b + 6], fIn = zt[b + 7], fOut = zt[b + 8];
        if (!(isFinite(lo) && isFinite(hi) && isFinite(root) && isFinite(buf) && isFinite(vol) &&
              isFinite(s0) && isFinite(s1) && isFinite(fIn) && isFinite(fOut))) continue;
        if (!(vol > 0)) continue;
        if (!(hi >= lo)) continue;
        if (lo < 0 || lo > 127) continue;
        let d = (midi < lo) ? (lo - midi) : (midi > hi ? midi - hi : 0);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }
    for (let i = 0; i < ZN; i++) {
      const b = i * ZF;
      if (b + ZF > zt.length) break;
      const lo = zt[b], hi = zt[b + 1], root = zt[b + 2], buf = zt[b + 3], vol = zt[b + 4];
      if (!(isFinite(lo) && isFinite(hi) && isFinite(root) && isFinite(buf) && isFinite(vol))) continue;
      if (!(vol > 0)) continue;
      if (!(hi >= lo)) continue;
      if (lo < 0 || lo > 127) continue;
      let d = (midi < lo) ? (lo - midi) : (midi > hi ? midi - hi : 0);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /* ---- read increment solve (note-on + glide/pitchGen ticks only) ---- */
  function computeInc(eng, v, k, kx) {
    let st = (v.pitch - k.svRoot) + kx.svTune + eng.bend + eng.tune;
    if (!isFinite(st)) st = 0; else if (st > 120) st = 120; else if (st < -120) st = -120;
    let inc = (k.svRate > 0 ? k.svRate / eng.sr : 1) * Math.pow(2, st / 12);
    if (!(inc > 0)) inc = 1e-9; else if (inc > 1e9) inc = 1e9;
    k.svInc = inc;
    k.svPg = (typeof v.pitchGen === "number" && isFinite(v.pitchGen)) ? v.pitchGen : 0;
  }

  /* ---- per-note reset ---- */
  function initVoice(eng, v) {
    const k = v.k;
    const kx = ensureKext(eng);
    k.svRelC = Math.exp(-6.9078 / (REL_T60 * eng.sr));
    k.svRel = 1;
    k.svEnd = 0;
    k.svWraps = 0;
    k.svSmp = 0;
    k.svSmpOut = 0;
    k.svPos = 0;
    k.svFadeA = 1;
    k.svFadeB = 1;
    k.svW0 = 0;
    k.svW1 = 0;
    k.svFIn = 0;
    k.svFOut = 0;
    k.svOutL = 0;
    k.svOutR = 0;

    /* zone selection: v2 (16 x 9, length >= 144) or the legacy v1 table (8 x 5, exact) */
    let m = v.noteMidi;
    if (!isFinite(m) && isFinite(v.pitch)) m = Math.round(v.pitch);
    if (!isFinite(m)) m = 60;
    const zt = eng.zones;
    const zv2 = !!(zt && typeof zt.length === "number" && zt.length >= ZV2);
    let selZone = pickZone(eng, m);
    let selBuf = cl(Math.round(kx.svBuf), 0, 3);
    let selRoot = cl(Math.round(kx.svRoot), 0, 127);
    let selVol = 1;
    let zS0 = 0, zS1 = 1, zFIn = 0, zFOut = 0;   /* window/fade defaults (v1 law) */
    if (selZone >= 0) {
      const b = selZone * (zv2 ? ZF2 : ZF);
      selBuf = cl(Math.round(zt[b + 3]), 0, 3);
      selRoot = cl(Math.round(zt[b + 2]), 0, 127);
      selVol = cl(zt[b + 4], 0, 1);
      if (zv2) {
        zS0 = cl(zt[b + 5], 0, 1);
        zS1 = cl(zt[b + 6], 0, 1);
        zFIn = cl(zt[b + 7], 0, 2);
        zFOut = cl(zt[b + 8], 0, 2);
      }
    }
    k.svZone = selZone;
    k.svBuf = selBuf;
    k.svRoot = selRoot;
    k.svZvol = selVol;

    /* latch the slot (defensive reads; a replaced slot never disturbs this voice) */
    const reg = eng.samples;
    let slot = null;
    if (reg) {
      const t = reg[selBuf | 0];
      if (t && t.ch1 && t.ch1.length > 0) slot = t;
    }
    if (slot) {
      let n = (typeof slot.n === "number" && isFinite(slot.n) && slot.n > 0) ? (slot.n | 0) : slot.ch1.length;
      if (n > slot.ch1.length) n = slot.ch1.length;
      if (n >= 1) {
        k.svN = n;
        k.svCh1 = slot.ch1;
        k.svCh2 = (slot.ch2 && slot.ch2.length >= n) ? slot.ch2 : null;
        k.svRate = (typeof slot.rate === "number" && slot.rate > 0) ? slot.rate : eng.sr;
      } else { k.svN = 0; k.svCh1 = null; k.svCh2 = null; k.svRate = 0; k.svEnd = 1; }
    } else { k.svN = 0; k.svCh1 = null; k.svCh2 = null; k.svRate = 0; k.svEnd = 1; }

    /* window [w0, w1) -- the one-shot read range (M2); v1 / no-zone => [0, n) exactly */
    const n = k.svN;
    let w0 = 0, w1 = n;
    if (n >= 1) {
      w0 = Math.min(n - 1, Math.round(zS0 * n));
      if (!(w0 >= 0)) w0 = 0; else if (w0 > n - 1) w0 = n - 1;
      w1 = Math.max(w0 + 1, Math.min(n, Math.round(zS1 * n)));
      if (!(w1 > w0)) w1 = w0 + 1; else if (w1 > n) w1 = n;
    } else { w0 = 0; w1 = 0; }
    k.svW0 = w0;
    k.svW1 = w1;
    k.svPos = w0;

    /* loop points: the v1 (n-1) fraction law, then intersected with the window [L0, L1);
       L1 <= L0 (or n < 2) => loop off (never a NaN path) */
    k.svLoop = (kx.svLoop >= 0.5) ? 1 : 0;
    k.svLpS = 0;
    k.svLpE = 0;
    if (k.svLoop === 1 && n >= 2) {
      const lps = Math.round(cl(kx.svLpS, 0, 1) * (n - 1));
      const lpe = Math.round(cl(kx.svLpE, 0, 1) * (n - 1));
      const l0 = Math.max(w0, lps);
      const l1 = Math.min(w1, lpe);
      if (l1 > l0) { k.svLpS = l0; k.svLpE = l1; }
      else k.svLoop = 0;
    } else {
      k.svLoop = 0;
    }
    computeInc(eng, v, k, kx);

    /* fades (M2): latched output-sample lengths; on the one-shot endpoint clamp so the two
       ramps never overlap (fade-in keeps priority, fade-out absorbs the trim; the span is the
       number of windowed output samples = ceil((w1 - w0)/inc)) */
    let fInSmp = Math.round(zFIn * eng.sr);
    let fOutSmp = Math.round(zFOut * eng.sr);
    if (!(fInSmp >= 0)) fInSmp = 0;
    if (!(fOutSmp >= 0)) fOutSmp = 0;
    if (k.svLoop === 0 && n >= 1 && (fInSmp > 0 || fOutSmp > 0)) {
      let span = Math.ceil((w1 - w0) / k.svInc);
      if (!(span >= 1)) span = 1;
      if (fInSmp > span) fInSmp = span;
      if (fInSmp + fOutSmp > span) fOutSmp = span - fInSmp;
    }
    k.svFIn = fInSmp;
    k.svFOut = fOutSmp;
  }

  /* ---- one base-rate sample ------------------------------------------------------------
     read (fractional linear interp, refs latched) -> M2 fades -> advance / wrap / end ->
     release fade -> gain (vol x zone vol x the section-6 velocity law x fades). Nothing here
     allocates. */
  function stepVoice(eng, v) {
    const k = v.k;
    const kx = eng.kext;
    if (!kx) return 0;
    const n = k.svN;
    if (n <= 0) return 0;
    k.svSmp++;
    /* live retune on glide / shared pitchGen ticks (bend, tune, ...) */
    if (v.gliding || (v.pitchGen || 0) !== k.svPg) computeInc(eng, v, k, kx);
    /* release fade (state 2) */
    if (v.state === 2 && k.svRel > 1e-6) k.svRel *= k.svRelC;

    let o = 0, o2 = 0;
    let fa = 1, fb = 1;
    if (k.svEnd === 0) {
      const p = k.svPos;
      const ch1 = k.svCh1;
      let i0 = p | 0;
      if (i0 > n - 1) i0 = n - 1; else if (i0 < 0) i0 = 0;
      let i1 = i0 + 1; if (i1 > n - 1) i1 = n - 1;
      const f = p - i0;
      const a0 = ch1[i0];
      o = a0 + f * (ch1[i1] - a0);
      const ch2 = k.svCh2;
      if (ch2 !== null) { const b0 = ch2[i0]; o2 = b0 + f * (ch2[i1] - b0); }
      else o2 = o;
      /* M2 fades: fade-in over svFIn windowed output samples from w0 (gain c/N); fade-out
         over svFOut output samples ending at w1 -- ONE-SHOT ONLY (a loop wraps at L1 and has
         no end; an end fade per cycle would click at the wrap) */
      if (k.svFIn > 0) { fa = k.svSmpOut / k.svFIn; if (fa > 1) fa = 1; }
      if (k.svLoop === 0 && k.svFOut > 0 && k.svW1 > p) {
        fb = (k.svW1 - p) / (k.svFOut * k.svInc);
        if (fb > 1) fb = 1; else if (!(fb > 0)) fb = 0;
      }
      k.svFadeA = fa;
      k.svFadeB = fb;
      k.svSmpOut++;
      /* advance: loop wrap (exact: remainder carries multi-wrap + fractional overshoot) or
         one-shot end (head reaches the window end w1; the last in-window frame plays
         exactly) */
      let np = p + k.svInc;
      if (k.svLoop === 1) {
        if (np >= k.svLpE) {
          const L = k.svLpE - k.svLpS;
          const over = np - k.svLpS;
          k.svWraps += Math.floor(over / L);
          np = k.svLpS + (over % L);
        }
      } else if (np >= k.svW1) {
        k.svEnd = 1;
      }
      k.svPos = np;
    }
    /* gain: sampler.vol (live) x zone vol (latched) x velocity law (0.3 + 0.7*vel) x release
       x the M2 window fades (fa x fb; both exactly 1 when none are latched => the v1 table
       path stays bit-identical) */
    let vol = kx.svVol; if (!(vol >= 0)) vol = 0; else if (vol > 1) vol = 1;
    let vel = v.vel; if (!(vel >= 0)) vel = 0; else if (vel > 1) vel = 1;
    const g = vol * k.svZvol * (0.3 + 0.7 * vel) * k.svRel;
    const l = o * g * fa * fb;
    const r2 = o2 * g * fa * fb;
    k.svOutL = l;
    k.svOutR = r2;
    return (l + r2) * 0.5;
  }

  /* required: only a RELEASED voice may report done (one-shot ended, or release fade spent) */
  function isVoiceDone(eng, v) {
    void eng;
    if (v.state !== 2) return false;
    const k = v.k;
    if (!k || k.svN <= 0) return true;
    return k.svEnd === 1 || k.svRel < DONE_REL;
  }

  /* ---- M2 additive snapshot: the latched zone/window/fade evidence of a voice's k.
     w0/w1 = window frame bounds; fIn/fOut = latched ramp lengths in OUTPUT SAMPLES
     (round(zone seconds x sr), after the no-overlap clamp). Allocates (snap-time only). */
  function snapVoice(k) {
    if (!k) return null;
    return {
      zone: k.svZone, buf: k.svBuf, w0: k.svW0, w1: k.svW1,
      fIn: k.svFIn, fOut: k.svFOut,
    };
  }

  /* ---- the one top-level return ---- */
  return {
    VERSION: VERSION,
    PREFIX: PREFIX,
    initEngineK: initEngineK,
    initVoiceK: initVoiceK,
    initVoice: initVoice,
    stepVoice: stepVoice,
    isVoiceDone: isVoiceDone,
    setParam: setParam,
    snapVoice: snapVoice,
  };
})();

if (typeof AVDSP !== "undefined" && typeof AVDSP.registerKind === "function") AVDSP.registerKind(5, AVSAMPLER);
