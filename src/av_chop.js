/* av_chop.js — Anvil M2 SAMPLE-CHOP CORE (sa-C, brief verify/_m2_wave.md §2.3). The page-side owner
   of the chop model: transient detection on an imported avSampleStore entry, the slice kit, the
   per-slice edit math, the zone-table v2 writer (§2.4 layout: 16 zones × [lo, hi, root, buf, vol,
   s0, s1, fIn, fOut]) and the slice→steps writer into the sequencer.

   THE DETECTOR (clean-room, ONE algorithm — block-energy novelty with an adaptive median/MAD
   threshold + first-crossing refinement). Its full math:

     Frame model.  H = max(16, round(rate × 0.002)) frames (≈2 ms hop); W = 2H (50 % overlap).
       Block b covers [b·H, b·H + W); B = floor((n − W) / H) + 1 blocks (n ≥ 4H required).
     Block energy + level.
       E[b]   = Σ x[j]² over block b            (non-finite samples read as 0; never throws)
       dB[b]  = 10·log10(E[b] + 1e-12)          (silence ≈ −120 dB; 1e-12 energy floor)
     Novelty (half-wave rectified first difference — energy rise only).
       nov[b] = max(0, dB[b] − dB[b−1])         for b = 1..B−1
     Adaptive threshold over an 8-value context C(b) = nov[max(0, b−7) .. b]:
       T[b]   = max( minDb(s), median(C) + α(s) · 1.4826 · MAD(C) )
       α(s)      = 4.0 − 2.5·s      (4.0 at sensitivity 0 → 1.5 at sensitivity 1)
       minDb(s)  = 12 − 9·s         (12 dB at s=0 → 3 dB at s=1)
       s        = the caller's sensitivity 0..1 (more sensitivity = lower threshold = more onsets)
     Candidate (a novelty PEAK above T): nov[b] ≥ T[b] ∧ nov[b] > nov[b−1] ∧ (b = B−1 ∨ nov[b] ≥ nov[b+1]).
     Refinement (sample-accurate onset): scan f = max(0,(b−2)·H) .. min(n−1, b·H+W−1) and take the
       FIRST frame with |x[f]| ≥ max(0.05 × max|x| over block b, 1e-7). The spike block is always the
       first window touching the onset and that scan range always contains it; for a hard onset the
       crossing lands within a few frames of the true start (a slow/faded attack lands slightly late —
       honest, documented).
     minGap merging: candidates sorted by frame (ties by block); ascending pass keeps the FIRST onset
       and drops any onset closer than round(minGapMs/1000 × rate) frames to the last kept one.
     maxSlices cap: slices = [0] + onsets + [n], so at most maxSlices−1 onsets are kept; when over,
       the STRONGEST onsets by novelty survive (score descending, ties → lower frame).
     Result: contiguous [s0, s1) frame ranges covering the whole buffer exactly — [0, o₀),
       [o₀, o₁), …, [o_k, n); count = onsets + 1 ≤ maxSlices; `dropped` = detector-found onsets that
       did not make it (merged + capped), with `merged`/`capped`/`found` broken out honestly.
   Deterministic: no randomness, no clock, no allocation surprises; same input ⇒ same result.

   API (names EXACT per §2.3; page module — no worklet concat, no DOM at load, never throws):
     avChopDetectFrames(ch1, rate, opts) -> {ok:true, onsets, slices, count, dropped, merged, capped,
         found, rate, frames, hop, window, opts, via} | {ok:false, error}    via: "onsets" | "rex2" (R16)
     avChopDetect(id, opts)      entry of avSampleStore → detect on channel 0
     avChopKitNew(srcId, opts?)  -> kit {ok:true, v:1, srcId, slot:0, base:36, slices:[{i, s0, s1,
         trim0, trim1, fadeIn:3, fadeOut:5, gainDb:0, norm:false, on:1} × ≤16]}; opts is an
         additive extension (rides into detection; the card's sensitivity slider) — the pinned call
         avChopKitNew(srcId) works unchanged. Failure -> {ok:false, error}
     avChopKitEdit(kit, patch)   additive extension: clamps {slot 0..3, base 0..108} in place
     avChopSliceEdit(kit, i, patch) -> bool   trim0/trim1 (clamped into [s0,s1), ≥32 frames),
         fadeIn/fadeOut ms 0..100, gainDb −24..24, norm bool, on 0/1; unknown fields ignored
     avChopNormGain(kit, i) -> {ok, gainDb, peak} | {ok:false, error}   peak over trim0/trim1 at the
         SOURCE entry channel 0; gain to a 0.99 peak, clamped ±24 dB
     avChopZones(kit) -> Float64Array(144)    §2.4 layout; garbage → zeros (cleared value)
     avChopApply(kit) -> {ok, slot, slices, total, zones:144} | {ok:false, error}   slot/name/rate/
         channel-0-copy to avEngineSample(…) then avEngineZones(zones), both guarded; `slices` = the
         ACTIVE slice count (the UI's "applied: N slices")
     avChopToSteps(kit, {track, start}) -> {ok, written, dropped, track, start} — ONE full step per
         ACTIVE slice (note avNoteName(base+k), §4 pinned defaults, on:1) at consecutive steps from
         start, via avSeqSnap/avSeqLoad (guarded); beyond 63 → dropped; avUndoPush("seq","chop")
         AFTER a successful load (guarded — the P4 undo law)
     avChopSnap(), avChopClasses() ([]), window.__avChop = {version:"m2.0", …all fns…}

   Error strings (honest refusals): "bad channel data" · "bad rate" · "empty sample" ·
   "sample too short" · "unknown sample" · "bad sample data" · "bad kit" · "bad slice" · "no signal"
   · "no-engine" · "no-zones" · "no-seq" · "bad snap" · "load refused" · "detector failed" ·
   "kit failed" · "apply failed" · "steps failed" · "norm failed".

   House laws kept: "use strict"; no randomness anywhere; every core/store/engine reach is
   typeof-guarded inside a function; never throws (garbage in → false / cleared value /
   {ok:false, error} out); ONE avChop* / AV_CHOP_* family; the only top-level touch is the guarded
   window.__avChop handle at the end. */

"use strict";

/* ------------------------------- pins ------------------------------------ */

const AV_CHOP_VERSION = "m2.0";
const AV_CHOP_ZONES = 16;               /* zone slots in the v2 table (§2.4)          */
const AV_CHOP_ZONE_FLOATS = 144;        /* 16 zones × 9 fields                        */
const AV_CHOP_SLOTS = 4;                /* engine sample slots 0..3                   */
const AV_CHOP_BASE_DEF = 36;            /* kit root key default                       */
const AV_CHOP_BASE_MAX = 108;           /* map-row pin (§2.5)                         */
const AV_CHOP_TRIM_MIN = 32;            /* min trim window, frames (§2.3)             */
const AV_CHOP_FADE_MAX_MS = 100;        /* fadeIn/fadeOut ms cap (§2.3)               */
const AV_CHOP_GAIN_LIM = 24;            /* gainDb / norm clamp ±24 (§2.3)             */
const AV_CHOP_TARGET_PEAK = 0.99;       /* normalisation target (§2.3)                */
const AV_CHOP_VOL_SCALE = 0.8;          /* zone vol = 10^(db/20) × 0.8 (§2.3)         */
const AV_CHOP_SENS_DEF = 0.5;
const AV_CHOP_MIN_GAP_DEF = 60;         /* ms (§2.3)                                  */
const AV_CHOP_MIN_GAP_LO = 20;
const AV_CHOP_MIN_GAP_HI = 1000;
const AV_CHOP_MAX_SLICES_DEF = 16;      /* (§2.3)                                     */
const AV_CHOP_MAX_SLICES_LO = 1;
const AV_CHOP_MAX_SLICES_HI = 16;
const AV_CHOP_HOP_MS = 0.002;           /* ≈2 ms analysis hop                         */
const AV_CHOP_HOP_MIN = 16;             /* hop floor, frames                          */
const AV_CHOP_NEED_HOPS = 4;            /* n ≥ 4H to detect (≥3 blocks)               */
const AV_CHOP_CTX = 8;                  /* novelty context length (median/MAD)        */
const AV_CHOP_MAD_K = 1.4826;           /* MAD → σ scale                              */
const AV_CHOP_ALPHA_S0 = 4.0;           /* threshold k at sensitivity 0               */
const AV_CHOP_ALPHA_S1 = 1.5;           /* threshold k at sensitivity 1               */
const AV_CHOP_MINDB_S0 = 12;            /* absolute novelty floor at sensitivity 0    */
const AV_CHOP_MINDB_S1 = 3;             /* absolute novelty floor at sensitivity 1    */
const AV_CHOP_EPS = 1e-12;              /* energy floor inside log10                  */
const AV_CHOP_REF_FRAC = 0.05;          /* refine: 5 % of the spike block's peak      */
const AV_CHOP_REF_FLOOR = 1e-7;         /* absolute refine floor                      */
const AV_CHOP_KIT_FADE_IN = 3;          /* kit slice defaults, ms (§2.3)              */
const AV_CHOP_KIT_FADE_OUT = 5;
const AV_CHOP_STEP_VEL = 0.8;           /* pinned §4 step defaults                    */
const AV_CHOP_STEP_GATE = 0.95;
const AV_CHOP_STEP_PROB = 100;
const AV_CHOP_NOTE_NAMES = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];

/* ------------------------------- state ----------------------------------- */

const avChopState = {
  lastDetect: null,   /* digest of the newest avChopDetect/DetectFrames side effect */
  kit: null,          /* the newest kit built by avChopKitNew (diagnostics only)   */
  lastApply: null,
  lastSteps: null,
  lastError: null,
};

const avChopHas = Object.prototype.hasOwnProperty;

/* --------------------------- small value laws ---------------------------- */

function avChopClamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* finite number or null */
function avChopFin(v) {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

/* finite number clamped; null/""/garbage -> default */
function avChopNum(v, lo, hi, dflt) {
  if (v == null || v === "") return dflt;
  const n = Number(v);
  if (!isFinite(n)) return dflt;
  return avChopClamp(n, lo, hi);
}

/* rounded finite number clamped; null/""/garbage -> default */
function avChopInt(v, lo, hi, dflt) {
  if (v == null || v === "") return dflt;
  const n = Number(v);
  if (!isFinite(n)) return dflt;
  return avChopClamp(Math.round(n), lo, hi);
}

/* 0|1: 1/true/"1" => 1; 0/false/"0"/null => 0; other finite numbers round-clamp; garbage => 0 */
function avChopBit(v) {
  if (v === 1 || v === true || v === "1") return 1;
  if (v == null || v === 0 || v === false || v === "0") return 0;
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return avChopClamp(Math.round(n), 0, 1);
}

/* strict slice index inside [0, kit.slices.length) — never clamps a wrong index onto a neighbour */
function avChopSliceIndex(kit, i) {
  if (!kit || !Array.isArray(kit.slices)) return -1;
  const n = Number(i);
  if (!isFinite(n) || Math.round(n) !== n || n < 0 || n >= kit.slices.length) return -1;
  return n;
}

/* the avNoteName law (av_note.js:35-40 mirrored exactly); page -> avNoteName, node -> the mirror */
function avChopNoteNameLocal(midi) {
  const m = Math.round(Number(midi));
  if (!isFinite(m)) return "";
  return AV_CHOP_NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}
function avChopNoteAt(midi) {
  try {
    if (typeof avNoteName === "function") {
      const s = avNoteName(midi);
      if (s) return String(s);
    }
  } catch (e) { /* page helper absent/broken — the mirror stands */ }
  return avChopNoteNameLocal(midi);
}

/* --------------------------- detector internals -------------------------- */

/* opts sanitisation (§2.3): sensitivity 0..1 def 0.5 · minGapMs 20..1000 def 60 · maxSlices 1..16 def 16 */
function avChopOpts(opts) {
  const o = (opts && typeof opts === "object" && !Array.isArray(opts)) ? opts : {};
  return {
    sensitivity: avChopNum(o.sensitivity, 0, 1, AV_CHOP_SENS_DEF),
    minGapMs: avChopNum(o.minGapMs, AV_CHOP_MIN_GAP_LO, AV_CHOP_MIN_GAP_HI, AV_CHOP_MIN_GAP_DEF),
    maxSlices: avChopInt(o.maxSlices, AV_CHOP_MAX_SLICES_LO, AV_CHOP_MAX_SLICES_HI, AV_CHOP_MAX_SLICES_DEF),
  };
}

/* median of arr[from..to) — fresh small array, plain sort; empty -> 0 */
function avChopMedian(arr, from, to) {
  const m = [];
  for (let i = from; i < to; i++) m.push(arr[i]);
  if (!m.length) return 0;
  m.sort(function (a, b) { return a - b; });
  const h = m.length >> 1;
  return (m.length & 1) ? m[h] : (m[h - 1] + m[h]) / 2;
}

/* median absolute deviation of arr[from..to) around med — fresh small array */
function avChopMad(arr, from, to, med) {
  const m = [];
  for (let i = from; i < to; i++) { const d = arr[i] - med; m.push(d < 0 ? -d : d); }
  if (!m.length) return 0;
  m.sort(function (a, b) { return a - b; });
  const h = m.length >> 1;
  return (m.length & 1) ? m[h] : (m[h - 1] + m[h]) / 2;
}

/* sample-accurate onset refinement inside the spike block's scan range */
function avChopRefine(ch1, n, b, H, W, blockMax) {
  const bm = isFinite(blockMax) ? blockMax : 0;
  const thr = Math.max(AV_CHOP_REF_FRAC * bm, AV_CHOP_REF_FLOOR);
  const lo = Math.max(0, (b - 2) * H);
  const hi = Math.min(n - 1, b * H + W - 1);
  for (let f = lo; f <= hi; f++) {
    let v = ch1[f];
    if (typeof v !== "number" || !isFinite(v)) continue;
    if (v < 0) v = -v;
    if (v >= thr) return f;
  }
  return Math.min(n - 1, Math.max(0, b * H));   /* honest fallback: the block start */
}

/* ------------------------------ the detector ----------------------------- */

function avChopDetectFrames(ch1, rate, opts) {
  try {
    const o = avChopOpts(opts);
    if (!ch1 || typeof ch1 !== "object" || !isFinite(ch1.length)) {
      return { ok: false, error: "bad channel data", opts: o };
    }
    const n = Math.max(0, Math.floor(ch1.length));
    const rt = avChopFin(rate);
    if (rt === null || rt <= 0) return { ok: false, error: "bad rate", opts: o };
    if (n === 0) return { ok: false, error: "empty sample", opts: o };

    const H = Math.max(AV_CHOP_HOP_MIN, Math.round(rt * AV_CHOP_HOP_MS));
    const W = 2 * H;
    if (n < AV_CHOP_NEED_HOPS * H) return { ok: false, error: "sample too short", opts: o };
    const B = Math.floor((n - W) / H) + 1;

    /* block energies, levels, peaks */
    const db = new Float64Array(B);
    const blockMax = new Float64Array(B);
    for (let b = 0; b < B; b++) {
      const s0 = b * H, s1 = s0 + W;
      let e = 0, mx = 0;
      for (let j = s0; j < s1; j++) {
        let v = ch1[j];
        if (typeof v !== "number" || !isFinite(v)) v = 0;   /* NaN/Inf-proof, deterministic */
        const a = v < 0 ? -v : v;
        if (a > mx) mx = a;
        e += v * v;
      }
      db[b] = 10 * Math.log10(e + AV_CHOP_EPS);
      blockMax[b] = mx;
    }

    /* novelty */
    const nov = new Float64Array(B);
    for (let b = 1; b < B; b++) {
      const d = db[b] - db[b - 1];
      nov[b] = d > 0 ? d : 0;
    }

    /* adaptive threshold + peak pick + refinement */
    const s = o.sensitivity;
    const alpha = AV_CHOP_ALPHA_S0 + (AV_CHOP_ALPHA_S1 - AV_CHOP_ALPHA_S0) * s;
    const minDb = AV_CHOP_MINDB_S0 + (AV_CHOP_MINDB_S1 - AV_CHOP_MINDB_S0) * s;
    const cand = [];
    for (let b = 1; b < B; b++) {
      const from = Math.max(0, b - AV_CHOP_CTX + 1);
      const med = avChopMedian(nov, from, b + 1);
      const mad = avChopMad(nov, from, b + 1, med);
      const t = Math.max(minDb, med + alpha * AV_CHOP_MAD_K * mad);
      if (nov[b] < t) continue;
      if (!(nov[b] > nov[b - 1])) continue;
      if (b + 1 < B && !(nov[b] >= nov[b + 1])) continue;
      cand.push({ b: b, frame: avChopRefine(ch1, n, b, H, W, blockMax[b]), score: nov[b] });
    }

    /* frame order (ties by block — deterministic) */
    cand.sort(function (a, b2) { return (a.frame - b2.frame) || (a.b - b2.b); });
    const found = cand.length;

    /* minGap merging: ascending pass, keep the FIRST, drop anything closer than gapFrames */
    const gapFrames = Math.max(1, Math.round(o.minGapMs / 1000 * rt));
    const kept = [];
    let merged = 0;
    for (let i = 0; i < cand.length; i++) {
      const c = cand[i];
      if (c.frame <= 0) { merged++; continue; }     /* no head segment possible */
      const last = kept.length ? kept[kept.length - 1] : null;
      if (last && (c.frame - last.frame) < gapFrames) { merged++; continue; }
      kept.push(c);
    }

    /* maxSlices cap: slices = [0] + onsets + [n] ⇒ at most maxSlices−1 onsets; strongest survive */
    let finalList = kept;
    let capped = 0;
    const cap = o.maxSlices - 1;
    if (kept.length > cap) {
      const byScore = kept.slice().sort(function (a, b3) {
        return (b3.score - a.score) || (a.frame - b3.frame);
      });
      finalList = byScore.slice(0, cap);
      capped = kept.length - cap;
      finalList.sort(function (a, b4) { return a.frame - b4.frame; });
    }

    /* contiguous [s0, s1) chain covering [0, n) */
    const onsets = [];
    for (let i = 0; i < finalList.length; i++) onsets.push(finalList[i].frame);
    const slices = [];
    let s0 = 0;
    for (let i = 0; i < onsets.length; i++) { slices.push({ s0: s0, s1: onsets[i] }); s0 = onsets[i]; }
    slices.push({ s0: s0, s1: n });

    return {
      ok: true,
      onsets: onsets,
      slices: slices,
      count: slices.length,
      dropped: found - onsets.length,   /* merged + capped — honest total */
      merged: merged,
      capped: capped,
      found: found,
      rate: rt,
      frames: n,
      hop: H,
      window: W,
      opts: o,
      via: "onsets",                    /* R16: the transient route's marker (additive) */
    };
  } catch (e) {
    return { ok: false, error: "detector failed" };
  }
}

/* --------------------------- the rex2 slice route ------------------------ */

/* R16 section 4.3: an entry carrying a REX2 slice table (entry.rexSlices, stashed by av_lib's
   rex2 load route) uses the table AS its slice map -- the SAME success shape as
   avChopDetectFrames plus the additive marker via:"rex2"; dropped/merged/capped are 0.
   Each { start, len } pair maps to [s0, s1) = [round(start), round(start + len)) clamped to the
   entry's frames; unusable pairs are skipped and a table with nothing usable falls through
   (null) to the transient path. Deterministic; never throws. */
function avChopDetectRex2(e, opts) {
  try {
    const list = (e && Array.isArray(e.rexSlices)) ? e.rexSlices : null;
    if (!list || !list.length) return null;
    const rate = avChopRateOf(e);
    const frames = avChopFramesOf(e, null);
    if (!(rate > 0) || !(frames > 0)) return null;
    const slices = [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!it || typeof it !== "object") continue;
      const st = Number(it.start);
      const ln = Number(it.len);
      if (!isFinite(st) || !isFinite(ln)) continue;
      let s0 = Math.round(st);
      let s1 = Math.round(st + ln);
      if (s0 < 0) s0 = 0;
      if (s0 > frames) s0 = frames;
      if (s1 < 0) s1 = 0;
      if (s1 > frames) s1 = frames;
      if (!(s1 > s0)) continue;            /* zero/negative range - not a usable slice */
      slices.push({ s0: s0, s1: s1 });
    }
    if (!slices.length) return null;
    const onsets = [];
    for (let i = 1; i < slices.length; i++) onsets.push(slices[i].s0);
    const H = Math.max(AV_CHOP_HOP_MIN, Math.round(rate * AV_CHOP_HOP_MS));
    return {
      ok: true,
      onsets: onsets,
      slices: slices,
      count: slices.length,
      dropped: 0,
      merged: 0,
      capped: 0,
      found: onsets.length,
      rate: rate,
      frames: frames,
      hop: H,
      window: 2 * H,
      opts: avChopOpts(opts),
      via: "rex2",
    };
  } catch (err) { return null; }
}

/* ------------------------- store / entry resolution ---------------------- */

function avChopEntry(id) {
  try {
    if (typeof avSampleStore === "undefined" || !avSampleStore || typeof avSampleStore !== "object") return null;
    let e = null;
    if (typeof avSampleStore.get === "function") e = avSampleStore.get(id);
    else if (avSampleStore.byId && typeof avSampleStore.byId === "object") e = avSampleStore.byId[id];
    return (e && typeof e === "object") ? e : null;
  } catch (err) { return null; }
}

function avChopCh1(entry) {
  try {
    const buf = entry ? entry.buffer : null;
    if (buf && typeof buf.getChannelData === "function") {
      const d = buf.getChannelData(0);
      if (d && typeof d === "object" && isFinite(d.length) && d.length > 0) return d;
    }
  } catch (err) { /* broken buffer */ }
  return null;
}

function avChopRateOf(entry) {
  try {
    if (entry && isFinite(entry.sampleRate) && entry.sampleRate > 0) return entry.sampleRate;
    if (entry && entry.buffer && isFinite(entry.buffer.sampleRate) && entry.buffer.sampleRate > 0) return entry.buffer.sampleRate;
  } catch (err) { /* broken entry */ }
  return 0;
}

function avChopFramesOf(entry, d) {
  try {
    if (entry && entry.buffer && isFinite(entry.buffer.length) && entry.buffer.length > 0) {
      return Math.floor(entry.buffer.length);
    }
  } catch (e) { /* broken entry */ }
  return d ? Math.floor(d.length) : 0;
}

/* ------------------------------ public API ------------------------------- */

function avChopDetect(id, opts) {
  try {
    const e = avChopEntry(id);
    if (!e) return { ok: false, error: "unknown sample" };
    /* R16 section 4.3: an entry carrying a REX2 slice table takes the slice route (marker
       via:"rex2"); a malformed or empty table falls through to the transient detector below */
    let r = avChopDetectRex2(e, opts);
    if (!r) {
      const d = avChopCh1(e);
      if (!d) return { ok: false, error: "bad sample data" };
      r = avChopDetectFrames(d, avChopRateOf(e), opts);
    }
    try {
      if (r && r.ok) {
        r.id = (typeof e.id === "string") ? e.id : ((typeof id === "string") ? id : null);
        r.name = (typeof e.name === "string") ? e.name : "";
        avChopState.lastDetect = { ok: true, id: r.id, count: r.count, onsets: r.onsets.slice(),
          dropped: r.dropped, rate: r.rate, frames: r.frames };
      } else if (r) {
        avChopState.lastDetect = { ok: false, error: r.error };
        avChopState.lastError = r.error;
      }
    } catch (e2) { /* digest only */ }
    return r;
  } catch (err) {
    return { ok: false, error: "detect failed" };
  }
}

function avChopKitNew(srcId, opts) {
  try {
    const e = avChopEntry(srcId);
    if (!e) return { ok: false, error: "unknown sample" };
    const det = avChopDetect(srcId, opts);
    if (!det || !det.ok) return { ok: false, error: (det && det.error) || "detect failed" };
    const slices = [];
    for (let i = 0; i < det.slices.length && i < AV_CHOP_ZONES; i++) {
      const sl = det.slices[i];
      slices.push({
        i: i, s0: sl.s0, s1: sl.s1, trim0: sl.s0, trim1: sl.s1,
        fadeIn: AV_CHOP_KIT_FADE_IN, fadeOut: AV_CHOP_KIT_FADE_OUT,
        gainDb: 0, norm: false, on: 1,
      });
    }
    const kit = {
      ok: true,
      v: 1,
      srcId: (typeof srcId === "string") ? srcId : String(srcId == null ? "" : srcId),
      slot: 0,
      base: AV_CHOP_BASE_DEF,
      slices: slices,
    };
    try { avChopState.kit = kit; } catch (e2) { /* diagnostics only */ }
    return kit;
  } catch (err) {
    return { ok: false, error: "kit failed" };
  }
}

/* additive extension (§6 note): the card's map row edits {slot 0..3, base 0..108} with clamping */
function avChopKitEdit(kit, patch) {
  try {
    if (!kit || typeof kit !== "object" || !Array.isArray(kit.slices)) return false;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
    let any = false;
    if (avChopHas.call(patch, "slot")) {
      const cur = avChopInt(kit.slot, 0, AV_CHOP_SLOTS - 1, 0);
      kit.slot = avChopInt(patch.slot, 0, AV_CHOP_SLOTS - 1, cur);
      any = true;
    }
    if (avChopHas.call(patch, "base")) {
      const cur = avChopInt(kit.base, 0, AV_CHOP_BASE_MAX, AV_CHOP_BASE_DEF);
      kit.base = avChopInt(patch.base, 0, AV_CHOP_BASE_MAX, cur);
      any = true;
    }
    return any;
  } catch (e) {
    return false;
  }
}

function avChopSliceEdit(kit, i, patch) {
  try {
    if (!kit || typeof kit !== "object" || !Array.isArray(kit.slices)) return false;
    const idx = avChopSliceIndex(kit, i);
    if (idx < 0) return false;
    const sl = kit.slices[idx];
    if (!sl || typeof sl !== "object") return false;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;

    const s0 = avChopInt(sl.s0, 0, 100000000, 0);
    const base1 = avChopInt(sl.s1, s0, 100000000, s0);
    const s1 = Math.max(s0 + 1, base1);

    if (avChopHas.call(patch, "trim0") || avChopHas.call(patch, "trim1")) {
      let t0 = avChopInt(sl.trim0, s0, s1, s0);
      let t1 = avChopInt(sl.trim1, s0, s1, s1);
      if ((s1 - s0) >= AV_CHOP_TRIM_MIN) {
        if (t1 - t0 < AV_CHOP_TRIM_MIN) { t0 = s0; t1 = s1; }   /* repair a broken pair */
        if (avChopHas.call(patch, "trim0")) {
          t0 = avChopInt(patch.trim0, s0, t1 - AV_CHOP_TRIM_MIN, t0);
        }
        if (avChopHas.call(patch, "trim1")) {
          t1 = avChopInt(patch.trim1, t0 + AV_CHOP_TRIM_MIN, s1, t1);
        }
      } else {
        t0 = s0; t1 = s1;   /* the 32-frame minimum cannot fit inside a <32-frame slice */
      }
      sl.trim0 = t0;
      sl.trim1 = t1;
    }
    if (avChopHas.call(patch, "fadeIn")) sl.fadeIn = avChopNum(patch.fadeIn, 0, AV_CHOP_FADE_MAX_MS, sl.fadeIn);
    if (avChopHas.call(patch, "fadeOut")) sl.fadeOut = avChopNum(patch.fadeOut, 0, AV_CHOP_FADE_MAX_MS, sl.fadeOut);
    if (avChopHas.call(patch, "gainDb")) sl.gainDb = avChopNum(patch.gainDb, -AV_CHOP_GAIN_LIM, AV_CHOP_GAIN_LIM, sl.gainDb);
    if (avChopHas.call(patch, "norm")) sl.norm = !!patch.norm;
    if (avChopHas.call(patch, "on")) sl.on = avChopBit(patch.on);
    return true;
  } catch (e) {
    return false;
  }
}

function avChopNormGain(kit, i) {
  try {
    if (!kit || typeof kit !== "object" || !Array.isArray(kit.slices)) return { ok: false, error: "bad kit" };
    const idx = avChopSliceIndex(kit, i);
    if (idx < 0) return { ok: false, error: "bad slice" };
    const sl = kit.slices[idx];
    if (!sl || typeof sl !== "object") return { ok: false, error: "bad slice" };
    const e = avChopEntry(kit.srcId);
    if (!e) return { ok: false, error: "unknown sample" };
    const d = avChopCh1(e);
    if (!d) return { ok: false, error: "bad sample data" };
    const n = Math.floor(d.length);
    if (n <= 0) return { ok: false, error: "no signal" };
    let t0 = avChopInt(sl.trim0, 0, n - 1, 0);
    let t1 = avChopInt(sl.trim1, 0, n, n);
    if (t1 <= t0) t1 = Math.min(n, t0 + 1);
    let peak = 0;
    for (let f = t0; f < t1; f++) {
      let v = d[f];
      if (typeof v !== "number" || !isFinite(v)) continue;
      if (v < 0) v = -v;
      if (v > peak) peak = v;
    }
    if (!(peak > 0)) return { ok: false, error: "no signal" };
    let g = 20 * Math.log10(AV_CHOP_TARGET_PEAK / peak);
    if (!isFinite(g)) return { ok: false, error: "no signal" };
    g = avChopClamp(g, -AV_CHOP_GAIN_LIM, AV_CHOP_GAIN_LIM);
    return { ok: true, gainDb: g, peak: peak };
  } catch (err) {
    return { ok: false, error: "norm failed" };
  }
}

/* zone table v2 (§2.4): 16 zones × [lo, hi, root, buf, vol, s0, s1, fIn, fOut] */
function avChopZones(kit) {
  const out = new Float64Array(AV_CHOP_ZONE_FLOATS);
  try {
    if (!kit || typeof kit !== "object" || !Array.isArray(kit.slices)) return out;
    const e = avChopEntry(kit.srcId);
    const d = e ? avChopCh1(e) : null;
    const n = d ? Math.max(1, Math.floor(d.length)) : 1;
    const base = avChopInt(kit.base, 0, AV_CHOP_BASE_MAX, AV_CHOP_BASE_DEF);
    const slot = avChopInt(kit.slot, 0, AV_CHOP_SLOTS - 1, 0);
    for (let k = 0; k < kit.slices.length && k < AV_CHOP_ZONES; k++) {
      const sl = kit.slices[k];
      if (!sl || typeof sl !== "object" || avChopBit(sl.on) !== 1) continue;
      const o = k * 9;
      out[o + 0] = base + k;   /* lo   */
      out[o + 1] = base + k;   /* hi   */
      out[o + 2] = base + k;   /* root */
      out[o + 3] = slot;       /* buf  */
      let normGain = 0;
      if (sl.norm === true) {
        const ng = avChopNormGain(kit, k);
        if (ng && ng.ok) normGain = ng.gainDb;   /* a silent window normalises by 0 dB */
      }
      const gainDb = avChopNum(sl.gainDb, -AV_CHOP_GAIN_LIM, AV_CHOP_GAIN_LIM, 0);
      let vol = Math.pow(10, (gainDb + normGain) / 20) * AV_CHOP_VOL_SCALE;
      if (!isFinite(vol)) vol = 0;
      out[o + 4] = avChopClamp(vol, 0, 1);
      const t0 = avChopNum(sl.trim0, 0, n, 0);
      const t1 = avChopNum(sl.trim1, 0, n, n);
      let s0 = avChopClamp(t0 / n, 0, 1);
      let s1 = avChopClamp(t1 / n, 0, 1);
      if (!(s1 > s0)) s1 = Math.min(1, s0 + 1 / n);   /* §2.4: s1 > s0, +1 frame minimum */
      out[o + 5] = s0;
      out[o + 6] = s1;
      out[o + 7] = avChopClamp(avChopNum(sl.fadeIn, 0, AV_CHOP_FADE_MAX_MS, 0) / 1000, 0, 2);
      out[o + 8] = avChopClamp(avChopNum(sl.fadeOut, 0, AV_CHOP_FADE_MAX_MS, 0) / 1000, 0, 2);
    }
  } catch (err) { /* zeros — the cleared value */ }
  return out;
}

function avChopApply(kit) {
  try {
    if (!kit || typeof kit !== "object" || !Array.isArray(kit.slices)) return { ok: false, error: "bad kit" };
    const e = avChopEntry(kit.srcId);
    if (!e) return { ok: false, error: "unknown sample" };
    const d = avChopCh1(e);
    if (!d) return { ok: false, error: "bad sample data" };
    const rate = avChopRateOf(e);
    if (!(rate > 0)) return { ok: false, error: "bad rate" };
    if (typeof avEngineSample !== "function" || typeof avEngineZones !== "function") {
      return { ok: false, error: "no-engine" };
    }
    const slot = avChopInt(kit.slot, 0, AV_CHOP_SLOTS - 1, 0);
    const name = String(e.name || e.id || "chop");
    const copy = new Float32Array(d.length);
    for (let f = 0; f < d.length; f++) {
      const v = d[f];
      copy[f] = (typeof v === "number" && isFinite(v)) ? v : 0;
    }
    let sent = false;
    try { sent = avEngineSample(slot, name, rate, copy, null) === true; } catch (err2) { sent = false; }
    if (!sent) return { ok: false, error: "no-engine" };
    const zones = avChopZones(kit);
    let zsent = false;
    try { zsent = avEngineZones(zones) === true; } catch (err3) { zsent = false; }
    if (!zsent) return { ok: false, error: "no-zones" };
    let active = 0, total = 0;
    for (let k = 0; k < kit.slices.length && k < AV_CHOP_ZONES; k++) {
      total++;
      if (kit.slices[k] && typeof kit.slices[k] === "object" && avChopBit(kit.slices[k].on) === 1) active++;
    }
    avChopState.lastApply = { ok: true, slot: slot, slices: active, zones: AV_CHOP_ZONE_FLOATS };
    return { ok: true, slot: slot, slices: active, total: total, zones: AV_CHOP_ZONE_FLOATS };
  } catch (err) {
    return { ok: false, error: "apply failed" };
  }
}

/* one full step object, pinned §4 defaults, on:1 (§2.3) */
function avChopStepFor(midi) {
  return {
    on: 1,
    note: avChopNoteAt(midi),
    vel: AV_CHOP_STEP_VEL,
    gate: AV_CHOP_STEP_GATE,
    slide: 0,
    accent: 0,
    oct: 0,
    prob: AV_CHOP_STEP_PROB,
    cond: "",
    ratchet: 1,
    micro: 0,
  };
}

function avChopToSteps(kit, opts) {
  try {
    if (!kit || typeof kit !== "object" || !Array.isArray(kit.slices)) return { ok: false, error: "bad kit" };
    const o = (opts && typeof opts === "object" && !Array.isArray(opts)) ? opts : {};
    const track = avChopInt(o.track, 0, 3, 0);
    const start = avChopInt(o.start, 0, 63, 0);
    const base = avChopInt(kit.base, 0, AV_CHOP_BASE_MAX, AV_CHOP_BASE_DEF);
    if (typeof avSeqSnap !== "function" || typeof avSeqLoad !== "function") {
      return { ok: false, error: "no-seq", written: 0, dropped: 0, track: track, start: start };
    }
    let snap = null;
    try { snap = avSeqSnap(); } catch (err2) { snap = null; }
    if (!snap || typeof snap !== "object" || !Array.isArray(snap.tracks)) {
      return { ok: false, error: "bad snap", written: 0, dropped: 0, track: track, start: start };
    }
    const tr = snap.tracks[track];
    if (!tr || typeof tr !== "object" || !Array.isArray(tr.steps)) {
      return { ok: false, error: "bad snap", written: 0, dropped: 0, track: track, start: start };
    }
    const steps = tr.steps;
    let written = 0, dropped = 0, j = 0;
    for (let k = 0; k < kit.slices.length && k < AV_CHOP_ZONES; k++) {
      const sl = kit.slices[k];
      if (!sl || typeof sl !== "object" || avChopBit(sl.on) !== 1) continue;
      const idx = start + j;
      j++;
      if (idx > 63 || idx >= steps.length) { dropped++; continue; }
      steps[idx] = avChopStepFor(base + k);
      written++;
    }
    let loaded = false;
    try { loaded = avSeqLoad(snap) === true; } catch (err3) { loaded = false; }
    if (!loaded) {
      try { avChopState.lastSteps = { ok: false, track: track, start: start, written: 0, dropped: dropped }; } catch (e2) { /* digest */ }
      return { ok: false, error: "load refused", written: 0, dropped: dropped, track: track, start: start };
    }
    /* the undo law: the checkpoint lands AFTER a successful load (guarded) */
    try { if (typeof avUndoPush === "function") avUndoPush("seq", "chop"); } catch (err4) { /* guarded */ }
    try { avChopState.lastSteps = { ok: true, track: track, start: start, written: written, dropped: dropped }; } catch (e3) { /* digest */ }
    return { ok: true, written: written, dropped: dropped, track: track, start: start };
  } catch (err) {
    return { ok: false, error: "steps failed" };
  }
}

/* ------------------------------ reports ---------------------------------- */

function avChopSnap() {
  try {
    const st = avChopState;
    let detect = null;
    if (st.lastDetect) {
      detect = {
        ok: st.lastDetect.ok === true,
        id: st.lastDetect.id != null ? st.lastDetect.id : null,
        count: st.lastDetect.count != null ? st.lastDetect.count : 0,
        onsets: Array.isArray(st.lastDetect.onsets) ? st.lastDetect.onsets.slice() : [],
        dropped: st.lastDetect.dropped != null ? st.lastDetect.dropped : 0,
        rate: st.lastDetect.rate != null ? st.lastDetect.rate : 0,
        frames: st.lastDetect.frames != null ? st.lastDetect.frames : 0,
        error: st.lastDetect.error != null ? st.lastDetect.error : null,
      };
    }
    let kitDigest = null;
    if (st.kit && typeof st.kit === "object" && Array.isArray(st.kit.slices)) {
      let active = 0;
      for (let k = 0; k < st.kit.slices.length && k < AV_CHOP_ZONES; k++) {
        const sl = st.kit.slices[k];
        if (sl && typeof sl === "object" && avChopBit(sl.on) === 1) active++;
      }
      kitDigest = {
        srcId: st.kit.srcId != null ? st.kit.srcId : null,
        slot: avChopInt(st.kit.slot, 0, AV_CHOP_SLOTS - 1, 0),
        base: avChopInt(st.kit.base, 0, AV_CHOP_BASE_MAX, AV_CHOP_BASE_DEF),
        slices: st.kit.slices.length,
        active: active,
      };
    }
    return {
      version: AV_CHOP_VERSION,
      detect: detect,
      kit: kitDigest,
      lastApply: st.lastApply ? { slot: st.lastApply.slot, slices: st.lastApply.slices, zones: st.lastApply.zones } : null,
      lastSteps: st.lastSteps ? { ok: st.lastSteps.ok === true, track: st.lastSteps.track, start: st.lastSteps.start, written: st.lastSteps.written, dropped: st.lastSteps.dropped } : null,
      lastError: st.lastError != null ? st.lastError : null,
      classes: [],
    };
  } catch (e) {
    return { version: AV_CHOP_VERSION, detect: null, kit: null, lastApply: null, lastSteps: null, lastError: "snap failed", classes: [] };
  }
}

/* the chop core emits no CSS classes of its own — the CHOP card (sa-E) owns every class it renders */
function avChopClasses() { return []; }

/* ------------------------- the page handle (guarded) --------------------- */

try {
  if (typeof window !== "undefined" && window && typeof window === "object") {
    window.__avChop = {
      version: AV_CHOP_VERSION,
      detectFrames: avChopDetectFrames,
      detect: avChopDetect,
      kitNew: avChopKitNew,
      kitEdit: avChopKitEdit,
      sliceEdit: avChopSliceEdit,
      normGain: avChopNormGain,
      zones: avChopZones,
      apply: avChopApply,
      toSteps: avChopToSteps,
      snap: avChopSnap,
      classes: avChopClasses,
    };
  }
} catch (e) { /* exposure is best-effort */ }
