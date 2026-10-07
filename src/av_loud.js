/* Anvil — the loudness suite (S3 'MIX & MASTER' wave, child sa-B): BS.1770-4 integrated /
   momentary / short-term LUFS, 4x-oversampled true peak, auto-gain table, normalize-gain and
   A/B compare. PURE, node-loadable, classic script, one namespace (avLoud* / AV_LOUD_*),
   never throws, no console noise, zero DOM reach at load (guarded typeof window probe at end).

   Pinned interface (verify/_s3_wave.md S2.1):
     avLoudLufs(l, r, sr)            -> { ok, lufs, kept, total, rate }   integrated, BS.1770-4
     avLoudMomentary(l, r, sr, atS)  -> { ok, lufs }                      400 ms window ending at atS
     avLoudShortTerm(l, r, sr, atS)  -> { ok, lufs }                      3 s window ending at atS
     avLoudTruePeak(l, r, sr)        -> { ok, dbtp, peakDb }              4x oversampled true peak
     avLoudAnalyze(l, r, sr)         -> { ok, lufs, dbtp, peakDb, rms, seconds, rate }
     avLoudAutoGains(rows, opts)     -> { ok, target, rows:[{ id, lufs, deltaDb }] }
     avLoudNormalizeGain(lufs, dbtp, target, ceiling) -> { ok, gainDb, limited }
     avLoudCompare(a, b)             -> { ok, a:{lufs,dbtp}, b:{lufs,dbtp}, gainToMatchDb }
     window.__avLoud = { version, lufs, momentary, short, tp, analyze, autoGains,
                         normalizeGain, compare }

   K-WEIGHTING (BS.1770-4 Table 1, 48 kHz): two cascaded biquads — the high-shelf pre-filter
   (f0 = 1681.974450955533 Hz, G = +3.999843853973347 dB, Q = 0.7071752369554196,
   Vb = Vh^0.4996667741545416) and the RLB high-pass (f0 = 38.13547087602444 Hz,
   Q = 0.5003270373238773). Coefficients are DERIVED for any rate from that analog prototype via
   the bilinear transform K = tan(pi f0 / sr); at 48 kHz the derivation reproduces the standard's
   published table to ~1e-15 (the node harness records the exact comparison):
     pre:  a0 = 1 + K/Q + K*K;  b = [Vh + Vb*K/Q + K*K, 2(K*K - Vh), Vh - Vb*K/Q + K*K] / a0;
           a = [2(K*K - 1), 1 - K/Q + K*K] / a0
     rlb:  a0 = 1 + K/Q + K*K;  b = [1, -2, 1];  a = [2(K*K - 1), 1 - K/Q + K*K] / a0
   Loudness: L = -0.691 + 10*log10( sum over channels of the mean square of the K-weighted
   signal ) — the -0.691 LUFS offset convention. Integrated gating: 400 ms blocks on a 100 ms
   grid (75 % overlap; block = 4 hops exactly), absolute gate -70 LUFS, relative gate = (power
   mean of the blocks above the absolute gate) - 10 LU; integrated = power mean of the blocks
   above BOTH gates. Gate comparisons are done in the z (power) domain — same decision as the
   LU-domain comparison, monotone, no log noise.

   TRUE PEAK: clean-room 4x polyphase interpolator — a 65-tap symmetric FIR (16 taps per phase
   + the shared center tap), design kernel h[n] = sinc((n - 32) / 4) (cutoff at the input
   Nyquist, unity DC gain per phase) windowed by a 4-term Blackman-Harris window
   (0.35875 - 0.48829 cos + 0.14128 cos2 - 0.01168 cos3, about 92 dB sidelobes; each phase is
   normalized to unity DC gain). Phase 0 lands
   on integer input samples (sinc = 0 at every other multiple of 4 taps) so it is a unity
   passthrough — the sample peak seeds the max and dbtp >= peakDb holds structurally. Phases
   1-3 are scanned over the zero-padded buffer; peakDb = sample peak in dBFS (null on silence).

   CONVENTIONS: non-finite samples (NaN / +-Infinity) are treated as 0 — receipts never carry
   NaN / +-Infinity (null instead); silence or no gated blocks -> lufs: null (+ honest kept: 0);
   empty buffers -> null measurements with ok: true (a measurement of nothing, not a refusal);
   malformed arguments (non-array l, invalid sr, ...) -> ok: false with null fields. sr missing
   or null defaults to 48000; any sr > 0 accepted (coefficients derive for that rate). Deltas /
   gains are exact numbers (callers clamp them). Deterministic, allocation-light, never throws. */
"use strict";

const AV_LOUD_VERSION = "s3.0";
const AV_LOUD_LUFS_OFFSET = -0.691;          /* §2.1: the -0.691 LUFS offset convention */
const AV_LOUD_ABS_GATE = -70;                /* absolute gate, LUFS */
const AV_LOUD_REL_GATE = -10;                /* relative gate below the abs-gated power mean, LU */
const AV_LOUD_HOP_S = 0.1;                   /* 100 ms gating step (75 % overlap of 400 ms blocks) */
const AV_LOUD_BLOCK_HOPS = 4;                /* 400 ms block = 4 hops exactly on the hop grid */
const AV_LOUD_MOMENTARY_S = 0.4;             /* momentary window */
const AV_LOUD_SHORT_S = 3.0;                 /* short-term window */
const AV_LOUD_SR_DEFAULT = 48000;            /* house native rate when sr is missing/null */
const AV_LOUD_AUTO_TARGET = -18;             /* avLoudAutoGains default target */
const AV_LOUD_AUTO_MAX_DB = 24;              /* auto-gain delta clamp, +-24 dB */
const AV_LOUD_NORM_TARGET = -14;             /* avLoudNormalizeGain fallback target */
const AV_LOUD_NORM_CEILING = -1;             /* avLoudNormalizeGain fallback true-peak ceiling */

/* K-weighting analog design constants (see header derivation). */
const AV_LOUD_SHELF_F0 = 1681.974450955533;
const AV_LOUD_SHELF_G = 3.999843853973347;
const AV_LOUD_SHELF_Q = 0.7071752369554196;
const AV_LOUD_SHELF_VB_EXP = 0.4996667741545416;
const AV_LOUD_RLB_F0 = 38.13547087602444;
const AV_LOUD_RLB_Q = 0.5003270373238773;

/* 4x true-peak design geometry (see header). */
const AV_LOUD_TP_PHASES = 4;
const AV_LOUD_TP_TAPS_PER_PHASE = 16;

/* ---------- small argument helpers (never throw; null = unusable) ---------- */

function avLoudOptNum(v) {                    /* finite number (numbers or numeric strings) or null */
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return isFinite(n) ? n : null;
  }
  return null;
}

function avLoudRate(sr) {                     /* missing/null -> 48000; invalid -> null (refusal) */
  if (sr === undefined || sr === null) return AV_LOUD_SR_DEFAULT;
  const s = avLoudOptNum(sr);
  return (s !== null && s > 0) ? s : null;
}

function avLoudChan(x) {                      /* array-like with a usable length, or null */
  try {
    if (x === null || x === undefined) return null;
    if (typeof x === "object" || typeof x === "function" || typeof x === "string") {
      const n = Number(x.length);
      return (isFinite(n) && n >= 0) ? x : null;
    }
    return null;
  } catch (e) { return null; }
}

function avLoudFramesOf(a, b) {               /* shared frame count (min of channels); -1 = unusable */
  try {
    let n = Math.floor(Number(a.length));
    if (!isFinite(n) || n < 0) return -1;
    if (b !== null) {
      const m = Math.floor(Number(b.length));
      if (!isFinite(m) || m < 0) return -1;
      if (m < n) n = m;
    }
    return n;
  } catch (e) { return -1; }
}

function avLoudSan(v) {                       /* sample sanitizer: non-finite -> 0 (documented) */
  return (typeof v === "number" && isFinite(v)) ? v : 0;
}

/* ---------- K-weighting / scanning ---------- */

function avLoudKCoefs(sr) {                   /* { pre:[b0,b1,b2,a1,a2], rlb:[b0,b1,b2,a1,a2] } */
  const K = Math.tan(Math.PI * AV_LOUD_SHELF_F0 / sr);
  const Vh = Math.pow(10, AV_LOUD_SHELF_G / 20);
  const Vb = Math.pow(Vh, AV_LOUD_SHELF_VB_EXP);
  const q = AV_LOUD_SHELF_Q;
  const a0 = 1 + K / q + K * K;
  const pre = [
    (Vh + Vb * K / q + K * K) / a0,
    2 * (K * K - Vh) / a0,
    (Vh - Vb * K / q + K * K) / a0,
    2 * (K * K - 1) / a0,
    (1 - K / q + K * K) / a0,
  ];
  const K2 = Math.tan(Math.PI * AV_LOUD_RLB_F0 / sr);
  const q2 = AV_LOUD_RLB_Q;
  const a0b = 1 + K2 / q2 + K2 * K2;
  const rlb = [1, -2, 1, 2 * (K2 * K2 - 1) / a0b, (1 - K2 / q2 + K2 * K2) / a0b];
  return { pre: pre, rlb: rlb };
}

/* Per-hop sum of K-weighted squares, added into z (z[k] = sum over hop k, both channels pooled
   by the caller). Hop index advances on a counter — no per-sample division. Partial trailing
   frames (past the last full hop) are dropped, exactly like the 100 ms block grid. */
function avLoudScanHops(x, frames, co, hop, z) {
  const b = co.pre, a = co.rlb, n = z.length;
  let p1 = 0, p2 = 0, p3 = 0, p4 = 0, q1 = 0, q2 = 0, q3 = 0, q4 = 0;
  let k = 0, c = hop;
  for (let i = 0; i < frames; i++) {
    const v = avLoudSan(x[i]);
    const y = b[0] * v + b[1] * p1 + b[2] * p2 - b[3] * p3 - b[4] * p4;
    p2 = p1; p1 = v; p4 = p3; p3 = y;
    const w = a[0] * y + a[1] * q1 + a[2] * q2 - a[3] * q3 - a[4] * q4;
    q2 = q1; q1 = y; q4 = q3; q3 = w;
    if (k < n) z[k] += w * w;
    c--; if (c === 0) { k++; c = hop; }
  }
}

/* Sum of K-weighted squares over frames [from, to) of one channel. The K-filter runs from
   sample 0 so the window sees live-meter steady state (documented convention). */
function avLoudScanWindow(x, frames, co, from, to) {
  const b = co.pre, a = co.rlb;
  let p1 = 0, p2 = 0, p3 = 0, p4 = 0, q1 = 0, q2 = 0, q3 = 0, q4 = 0;
  let sum = 0;
  const end = (to < frames) ? to : frames;
  for (let i = 0; i < end; i++) {
    const v = avLoudSan(x[i]);
    const y = b[0] * v + b[1] * p1 + b[2] * p2 - b[3] * p3 - b[4] * p4;
    p2 = p1; p1 = v; p4 = p3; p3 = y;
    const w = a[0] * y + a[1] * q1 + a[2] * q2 - a[3] * q3 - a[4] * q4;
    q2 = q1; q1 = y; q4 = q3; q3 = w;
    if (i >= from) sum += w * w;
  }
  return sum;
}

/* ---------- integrated loudness (BS.1770-4) ---------- */

function avLoudLufs(l, r, sr) {
  const R = avLoudRate(sr);
  try {
    const a = avLoudChan(l);
    if (a === null || R === null) return { ok: false, lufs: null, kept: 0, total: 0, rate: R };
    let b = null;
    if (r !== undefined && r !== null) {
      b = avLoudChan(r);
      if (b === null) return { ok: false, lufs: null, kept: 0, total: 0, rate: R };
    }
    const frames = avLoudFramesOf(a, b);
    if (frames < 0) return { ok: false, lufs: null, kept: 0, total: 0, rate: R };
    const hop = Math.max(1, Math.round(R * AV_LOUD_HOP_S));
    const hopCount = Math.floor(frames / hop);
    if (hopCount < AV_LOUD_BLOCK_HOPS) return { ok: true, lufs: null, kept: 0, total: 0, rate: R };
    const block = hop * AV_LOUD_BLOCK_HOPS;
    const z = new Float64Array(hopCount);
    const co = avLoudKCoefs(R);
    avLoudScanHops(a, frames, co, hop, z);
    if (b !== null) avLoudScanHops(b, frames, co, hop, z);
    const nB = hopCount - AV_LOUD_BLOCK_HOPS + 1;
    const zAbs = Math.pow(10, (AV_LOUD_ABS_GATE - AV_LOUD_LUFS_OFFSET) / 10);
    /* pass 1 — absolute gate: power mean of the blocks above it (z domain) */
    let keptA = 0, sumA = 0;
    for (let bi = 0; bi < nB; bi++) {
      const zb = (z[bi] + z[bi + 1] + z[bi + 2] + z[bi + 3]) / block;
      if (zb > zAbs) { keptA++; sumA += zb; }
    }
    if (keptA === 0) return { ok: true, lufs: null, kept: 0, total: nB, rate: R };
    /* pass 2 — relative gate = that power mean - 10 LU (x 10^-1 in the power domain) */
    const zRel = (sumA / keptA) * Math.pow(10, AV_LOUD_REL_GATE / 10);
    let kept = 0, sum = 0;
    for (let bi = 0; bi < nB; bi++) {
      const zb = (z[bi] + z[bi + 1] + z[bi + 2] + z[bi + 3]) / block;
      if (zb > zRel && zb > zAbs) { kept++; sum += zb; }
    }
    if (kept === 0) return { ok: true, lufs: null, kept: 0, total: nB, rate: R };
    const lufs = AV_LOUD_LUFS_OFFSET + 10 * Math.log10(sum / kept);
    if (!isFinite(lufs)) return { ok: true, lufs: null, kept: kept, total: nB, rate: R };
    return { ok: true, lufs: lufs, kept: kept, total: nB, rate: R };
  } catch (e) {
    return { ok: false, lufs: null, kept: 0, total: 0, rate: R };
  }
}

/* ---------- momentary / short-term (window ENDING at atS seconds) ---------- */

function avLoudWindowCalc(l, r, sr, atS, winS) {
  const R = avLoudRate(sr);
  try {
    const a = avLoudChan(l);
    if (a === null || R === null) return { ok: false, lufs: null };
    let b = null;
    if (r !== undefined && r !== null) {
      b = avLoudChan(r);
      if (b === null) return { ok: false, lufs: null };
    }
    const frames = avLoudFramesOf(a, b);
    if (frames < 0) return { ok: false, lufs: null };
    const win = Math.max(1, Math.round(R * winS));
    let end;
    if (atS === undefined || atS === null) {
      end = frames;                                        /* default: the last full window */
    } else {
      const t = avLoudOptNum(atS);
      if (t === null) return { ok: false, lufs: null };
      end = Math.round(t * R);
      if (end > frames) end = frames;
      if (end < 0) end = 0;
    }
    const from = end - win;
    if (from < 0) return { ok: false, lufs: null };        /* window does not fit -> refusal */
    const co = avLoudKCoefs(R);
    let sum = avLoudScanWindow(a, frames, co, from, end);
    if (b !== null) sum += avLoudScanWindow(b, frames, co, from, end);
    const z = sum / win;
    if (!(z > 0) || !isFinite(z)) return { ok: true, lufs: null };
    const lufs = AV_LOUD_LUFS_OFFSET + 10 * Math.log10(z);
    if (!isFinite(lufs)) return { ok: true, lufs: null };
    return { ok: true, lufs: lufs };
  } catch (e) {
    return { ok: false, lufs: null };
  }
}

function avLoudMomentary(l, r, sr, atS) { return avLoudWindowCalc(l, r, sr, atS, AV_LOUD_MOMENTARY_S); }
function avLoudShortTerm(l, r, sr, atS) { return avLoudWindowCalc(l, r, sr, atS, AV_LOUD_SHORT_S); }

/* ---------- true peak (4x polyphase, clean-room) ---------- */

let avLoudTpTab = null;                        /* lazily built; deterministic; never touched again */

function avLoudTpPhases() {
  if (avLoudTpTab !== null) return avLoudTpTab;
  const L = AV_LOUD_TP_PHASES, PP = AV_LOUD_TP_TAPS_PER_PHASE;
  const N = L * PP + 1;                        /* 65 taps, symmetric about index 32 */
  const c = (N - 1) / 2;
  const h = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    const x = (n - c) / L;
    const sinc = (x === 0) ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const t = n / (N - 1);
    const w = 0.35875
      - 0.48829 * Math.cos(2 * Math.PI * t)
      + 0.14128 * Math.cos(4 * Math.PI * t)
      - 0.01168 * Math.cos(6 * Math.PI * t);   /* Blackman-Harris, 4-term */
    h[n] = sinc * w;
  }
  const tab = [];
  for (let p = 0; p < L; p++) {
    const sub = new Float64Array(PP + (p === 0 ? 1 : 0));
    let m = 0, dc = 0;
    for (let j = 0; j * L + p < N; j++) { sub[m] = h[j * L + p]; dc += sub[m]; m++; }
    for (let i = 0; i < sub.length; i++) sub[i] /= dc;     /* unity DC gain per phase */
    tab.push(sub);
  }
  avLoudTpTab = tab;
  return tab;
}

function avLoudPrep(x, frames) {               /* { src, peak } — src sanitized only when dirty */
  let peak = 0, bad = false;
  for (let i = 0; i < frames; i++) {
    const v = x[i];
    if (typeof v !== "number" || !isFinite(v)) { bad = true; continue; }
    const m = v < 0 ? -v : v;
    if (m > peak) peak = m;
  }
  if (!bad) return { src: x, peak: peak };
  const s = new Float64Array(frames);
  for (let i = 0; i < frames; i++) s[i] = avLoudSan(x[i]);
  return { src: s, peak: peak };
}

/* max |interpolated| over phases 1..3 of one channel; seed covers the sample peak (and phase 0,
   the unity passthrough). Zero-padded at both ends (the buffer is the signal's extent). */
function avLoudTpScan(x, frames, tab, seed) {
  let mx = seed;
  for (let p = 1; p < tab.length; p++) {
    const sub = tab[p], jMax = sub.length - 1;
    for (let m = 0; m < frames; m++) {
      let acc = 0;
      for (let j = 0; j <= jMax; j++) {
        const k = m - j;
        if (k < 0) break;
        acc += sub[j] * x[k];
        if (k === 0) break;
      }
      const am = acc < 0 ? -acc : acc;
      if (am > mx) mx = am;
    }
  }
  return mx;
}

function avLoudTruePeak(l, r, sr) {
  const R = avLoudRate(sr);
  try {
    const a = avLoudChan(l);
    if (a === null || R === null) return { ok: false, dbtp: null, peakDb: null };
    let b = null;
    if (r !== undefined && r !== null) {
      b = avLoudChan(r);
      if (b === null) return { ok: false, dbtp: null, peakDb: null };
    }
    const frames = avLoudFramesOf(a, b);
    if (frames < 0) return { ok: false, dbtp: null, peakDb: null };
    if (frames < 1) return { ok: true, dbtp: null, peakDb: null };
    const tab = avLoudTpPhases();
    const pa = avLoudPrep(a, frames);
    let pk = pa.peak;
    let mx = avLoudTpScan(pa.src, frames, tab, pk);
    if (b !== null) {
      const pb = avLoudPrep(b, frames);
      if (pb.peak > pk) pk = pb.peak;
      mx = avLoudTpScan(pb.src, frames, tab, mx);
    }
    if (!(pk > 0) || !isFinite(pk)) return { ok: true, dbtp: null, peakDb: null };
    if (!(mx > 0) || !isFinite(mx)) mx = pk;               /* defensive: keep dbtp >= peakDb */
    const peakDb = 20 * Math.log10(pk);
    const dbtp = 20 * Math.log10(mx);
    if (!isFinite(peakDb) || !isFinite(dbtp)) return { ok: true, dbtp: null, peakDb: null };
    return { ok: true, dbtp: dbtp, peakDb: peakDb };
  } catch (e) {
    return { ok: false, dbtp: null, peakDb: null };
  }
}

/* ---------- analyze ---------- */

function avLoudAnalyze(l, r, sr) {
  const R = avLoudRate(sr);
  try {
    const a = avLoudChan(l);
    if (a === null || R === null) return { ok: false, lufs: null, dbtp: null, peakDb: null, rms: null, seconds: null, rate: null };
    let b = null;
    if (r !== undefined && r !== null) {
      b = avLoudChan(r);
      if (b === null) return { ok: false, lufs: null, dbtp: null, peakDb: null, rms: null, seconds: null, rate: null };
    }
    const frames = avLoudFramesOf(a, b);
    if (frames < 0) return { ok: false, lufs: null, dbtp: null, peakDb: null, rms: null, seconds: null, rate: null };
    const lu = avLoudLufs(a, b, R);
    const tp = avLoudTruePeak(a, b, R);
    let sum = 0, n = 0;
    for (let i = 0; i < frames; i++) {
      const v = a[i];
      if (typeof v === "number" && isFinite(v)) { sum += v * v; n++; }
    }
    if (b !== null) {
      for (let i = 0; i < frames; i++) {
        const v = b[i];
        if (typeof v === "number" && isFinite(v)) { sum += v * v; n++; }
      }
    }
    const rms = (n > 0) ? Math.sqrt(sum / n) : null;      /* pooled over channels */
    const rmsOk = (rms === null || isFinite(rms)) ? rms : null;
    return {
      ok: true,
      lufs: lu.ok ? lu.lufs : null,
      dbtp: tp.ok ? tp.dbtp : null,
      peakDb: tp.ok ? tp.peakDb : null,
      rms: rmsOk,
      seconds: frames / R,
      rate: R,
    };
  } catch (e) {
    return { ok: false, lufs: null, dbtp: null, peakDb: null, rms: null, seconds: null, rate: null };
  }
}

/* ---------- auto-gain table ---------- */

function avLoudAutoGains(rows, opts) {
  let target = AV_LOUD_AUTO_TARGET;
  try {
    if (opts !== undefined && opts !== null && typeof opts === "object") {
      const t = avLoudOptNum(opts.target);
      if (t !== null) target = t;
    }
  } catch (e) { /* keep default */ }
  try {
    if (rows === null || rows === undefined || typeof rows.length !== "number" ||
        !isFinite(Number(rows.length))) {
      return { ok: false, target: target, rows: [] };
    }
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      let id = null, lufs = null, deltaDb = null;
      const row = rows[i];
      if (row !== null && row !== undefined && typeof row === "object") {
        id = (row.id === undefined) ? null : row.id;
        const lu = avLoudLufs(row.l, (row.r === undefined || row.r === null) ? null : row.r, row.sr);
        if (lu.ok && lu.lufs !== null) {                   /* silent rows are skipped (null delta) */
          lufs = lu.lufs;
          let d = target - lufs;
          if (d > AV_LOUD_AUTO_MAX_DB) d = AV_LOUD_AUTO_MAX_DB;
          if (d < -AV_LOUD_AUTO_MAX_DB) d = -AV_LOUD_AUTO_MAX_DB;
          deltaDb = d;
        }
      }
      out.push({ id: id, lufs: lufs, deltaDb: deltaDb });
    }
    return { ok: true, target: target, rows: out };
  } catch (e) {
    return { ok: false, target: target, rows: [] };
  }
}

/* ---------- normalize gain (LUFS target vs true-peak ceiling) ---------- */

function avLoudNormalizeGain(lufs, dbtp, target, ceiling) {
  try {
    let T = avLoudOptNum(target);
    if (T === null) T = AV_LOUD_NORM_TARGET;
    let C = avLoudOptNum(ceiling);
    if (C === null) C = AV_LOUD_NORM_CEILING;
    const L = avLoudOptNum(lufs);
    const D = avLoudOptNum(dbtp);
    if (L === null && D === null) return { ok: false, gainDb: null, limited: false };
    const gL = (L === null) ? null : (T - L);
    const gD = (D === null) ? null : (C - D);
    if (gL === null) return { ok: true, gainDb: gD, limited: true };
    if (gD === null) return { ok: true, gainDb: gL, limited: false };
    const limited = gD < gL;                     /* the TP term wins (strictly) */
    return { ok: true, gainDb: limited ? gD : gL, limited: limited };
  } catch (e) {
    return { ok: false, gainDb: null, limited: false };
  }
}

/* ---------- A/B compare ---------- */

function avLoudSummary(x) {                    /* { l, r?, sr? } row -> measure; receipt -> echo */
  try {
    if (x === null || x === undefined || typeof x !== "object") return null;
    if (x.l !== undefined && x.l !== null) {
      const an = avLoudAnalyze(x.l, (x.r === undefined || x.r === null) ? null : x.r, x.sr);
      if (!an.ok) return null;
      return { lufs: an.lufs, dbtp: an.dbtp };
    }
    if (x.lufs !== undefined || x.dbtp !== undefined) {
      return { lufs: avLoudOptNum(x.lufs), dbtp: avLoudOptNum(x.dbtp) };
    }
    return null;
  } catch (e) { return null; }
}

function avLoudCompare(a, b) {
  try {
    const A = avLoudSummary(a), B = avLoudSummary(b);
    if (A === null || B === null) {
      return {
        ok: false,
        a: A !== null ? A : { lufs: null, dbtp: null },
        b: B !== null ? B : { lufs: null, dbtp: null },
        gainToMatchDb: null,
      };
    }
    const g = (A.lufs !== null && B.lufs !== null) ? (A.lufs - B.lufs) : null;
    return { ok: true, a: A, b: B, gainToMatchDb: g };
  } catch (e) {
    return { ok: false, a: { lufs: null, dbtp: null }, b: { lufs: null, dbtp: null }, gainToMatchDb: null };
  }
}

/* ---------- debug handle (guarded; node harnesses get the scope names instead) ---------- */

if (typeof window !== "undefined") {
  try {
    window.__avLoud = {
      version: AV_LOUD_VERSION,
      lufs: avLoudLufs,
      momentary: avLoudMomentary,
      short: avLoudShortTerm,
      tp: avLoudTruePeak,
      analyze: avLoudAnalyze,
      autoGains: avLoudAutoGains,
      normalizeGain: avLoudNormalizeGain,
      compare: avLoudCompare,
    };
  } catch (e) { /* no window — node harness only */ }
}
