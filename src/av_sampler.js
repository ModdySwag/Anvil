/* av_sampler.js -- Anvil P3 SAMPLER voice engine: kind 5 (AVSAMPLER).
   Contract: verify/_p3_wave.md section 6 (one-shot / loop, root/tune, sampler.buf,
   sampler.vol, multisample ZONES v1 with the pinned {t:"zones"} Float64Array layout);
   the kind interface mirrored is verify/_p2_wave.md section 2.1. Spec lineage: docs/03
   section 2.1 (sampler voice: one-shot / loop / multisample zones) + docs/01.

   LAWS THAT ARE PINNED HERE (the two interfaces the parent wires must match EXACTLY):

   1. SAMPLE SLOT SHAPE (written by the processor at {t:"sample"} message time; up to 4 slots,
      each <= 60 s per channel; replacing a slot frees the old arrays):
        eng.samples = Array(4);  eng.samples[k] = null | { name, rate, n, ch1, ch2 }
        rate = the source sample rate (Hz); n = frame count (may be < ch1.length when the
        60 s clamp truncated the upload); ch1 = Float32Array; ch2 = Float32Array or null.
      avSampleSendToEngine posts {t:"sample", id, name, rate, ch1, ch2?} with id = the slot
      index 0..3; a replaced slot never disturbs grains/voices that already latched refs.

   2. ZONE TABLE LAYOUT ("{t:'zones', zones: Float64Array(40)}", 8 zones x 5 fields; zone i
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

   BEHAVIOUR:
   - one-shot (sampler.loop 0): the read head plays 0..n-1 and stops (position >= n sets the
     ended flag; output 0 afterwards). The note holds the voice until release (kind law: only
     a released voice may report done).
   - loop (sampler.loop 1): positions run inside [lpS, lpE) -- wrap lands exactly on lpS +
     fractional overshoot (within +-1 sample of the intended loop point for any increment;
     multi-wrap is exact via a remainder). Invalid points (lpE <= lpS, n < 2) => loop off.
   - rate: playback rate from key/root -- inc = (bufRate/sr) * 2^((v.pitch - root + tune +
     eng.bend + eng.tune)/12). Recomputed while gliding or when the shared pitchGen ticks
     (bend/tune/osc changes), so glides retune live (the read head carries no feedback path).
   - velocity to level: fixed law 0.3 + 0.7 * v.vel, applied INSIDE stepVoice per section 6.
     The shared kind path additionally multiplies v.vel, so the composed response is
     v.vel * (0.3 + 0.7 * v.vel); the internal law is kept verbatim (report deviation note).
   - release: a released voice (state 2) fades by exp to -60 dB in 30 ms and reports done
     (or immediately, if the one-shot already ended / no buffer). releaseVoice needs no hook.

   LAWS (worklet-safe): strict mode; ONE top-level name (AVSAMPLER); no page-scope reach-ins;
   allocation only at create (initVoiceK) / note-on (initVoice) / setParam time; stepVoice
   allocates nothing (numbers only, refs latched at note-on); monomorphic k fields; every
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
     k.svLpS   number  loop start frame (int)
     k.svLpE   number  loop end frame (int; loop region [lpS, lpE))
     k.svZone  number  selected zone index (-1 = none / params path)
     k.svBuf   number  selected engine slot 0..3 (evidence + fallback)
     k.svRoot  number  selected root MIDI note (0..127)
     k.svZvol  number  zone gain 0..1 (1 when no zone)
     k.svRel   number  release fade multiplier (1 until released, then exp decay)
     k.svRelC  number  release fade coefficient (~30 ms to -60 dB)
     k.svEnd   number  one-shot ended flag (head passed the buffer end)
     k.svWraps number  loop wrap events (evidence; multi-wrap counts each crossing)
     k.svPg    number  last v.pitchGen seen (glide/param retune trigger)
     k.svSmp   number  per-note sample counter (evidence)
     k.svOutL  number  last sample's stereo pair (L); the shared mono path consumes the
     k.svOutR  number  stepVoice() return = 0.5*(L+R); the parent MAY read k.svOutL/R for a
                       true-stereo kind branch (reported hook).

   KEXT FIELDS (engine level, initEngineK):
     kext.svLoop 0|1 (default 0) · kext.svLpS 0..1 (default 0) · kext.svLpE 0..1 (default 1) ·
     kext.svRoot 0..127 (default 60) · kext.svTune -24..24 (default 0) ·
     kext.svBuf 0..3 (default 0) · kext.svVol 0..1 (default 0.8)                        */
"use strict";

const AVSAMPLER = (function () {

  const VERSION = "p3.0";
  const PREFIX = "sampler";
  const ZN = 8;                   /* zones */
  const ZF = 5;                   /* fields per zone: lo, hi, root, buf, vol */
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
     nearest-zone: interval distance with 0 inside [lo,hi]; strict-< keeps the FIRST minimum
     (containing zone wins; ties resolve to the lowest index). */
  function pickZone(eng, midi) {
    const zt = eng.zones;
    if (!zt || typeof zt.length !== "number" || zt.length < ZF || !isFinite(midi)) return -1;
    let best = -1;
    let bestD = Infinity;
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
    k.svPos = 0;
    k.svOutL = 0;
    k.svOutR = 0;

    /* zone selection over the pinned Float64Array(40) table (defensive) */
    let m = v.noteMidi;
    if (!isFinite(m) && isFinite(v.pitch)) m = Math.round(v.pitch);
    if (!isFinite(m)) m = 60;
    let selZone = pickZone(eng, m);
    let selBuf = cl(Math.round(kx.svBuf), 0, 3);
    let selRoot = cl(Math.round(kx.svRoot), 0, 127);
    let selVol = 1;
    if (selZone >= 0) {
      const b = selZone * ZF;
      const zt = eng.zones;
      selBuf = cl(Math.round(zt[b + 3]), 0, 3);
      selRoot = cl(Math.round(zt[b + 2]), 0, 127);
      selVol = cl(zt[b + 4], 0, 1);
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

    /* loop points (fractions of the buffer; [lpS, lpE) with at least one frame) */
    k.svLoop = (kx.svLoop >= 0.5) ? 1 : 0;
    k.svLpS = 0;
    k.svLpE = 0;
    const n = k.svN;
    if (k.svLoop === 1 && n >= 2) {
      const s0 = Math.round(cl(kx.svLpS, 0, 1) * (n - 1));
      const e0 = Math.round(cl(kx.svLpE, 0, 1) * (n - 1));
      if (e0 > s0) { k.svLpS = s0; k.svLpE = e0; }
      else k.svLoop = 0;                       /* invalid points: loop off (never a NaN path) */
    } else {
      k.svLoop = 0;
    }
    computeInc(eng, v, k, kx);
  }

  /* ---- one base-rate sample ------------------------------------------------------------
     read (fractional linear interp, refs latched) -> advance / wrap / end -> release fade
     -> gain (vol x zone vol x the section-6 velocity law). Nothing here allocates. */
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
      /* advance: loop wrap (exact: remainder carries multi-wrap + fractional overshoot) or
         one-shot end (position reaches the buffer end; the last frame plays exactly) */
      let np = p + k.svInc;
      if (k.svLoop === 1) {
        if (np >= k.svLpE) {
          const L = k.svLpE - k.svLpS;
          const over = np - k.svLpS;
          k.svWraps += Math.floor(over / L);
          np = k.svLpS + (over % L);
        }
      } else if (np >= n) {
        k.svEnd = 1;
      }
      k.svPos = np;
    }
    /* gain: sampler.vol (live) x zone vol (latched) x velocity law (0.3 + 0.7*vel) x release */
    let vol = kx.svVol; if (!(vol >= 0)) vol = 0; else if (vol > 1) vol = 1;
    let vel = v.vel; if (!(vel >= 0)) vel = 0; else if (vel > 1) vel = 1;
    const g = vol * k.svZvol * (0.3 + 0.7 * vel) * k.svRel;
    const l = o * g;
    const r2 = o2 * g;
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
  };
})();

if (typeof AVDSP !== "undefined" && typeof AVDSP.registerKind === "function") AVDSP.registerKind(5, AVSAMPLER);
