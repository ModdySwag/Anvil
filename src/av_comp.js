/* av_comp.js — Anvil S2.1 wave (child sa-A; verify/_s2b_wave.md §2.1): the COMP ENGINE — the take
   comp model, pick-best (lite) auto-comping, trims + equal-power crossfade seams, the pure stitch
   render path and the WAV export. This file is the comp half of the S2 "takes & comping" row; the
   Comp card (av_comp_ui.js) renders from these reads only, and the browser rig checks the PURE
   math surface directly.

   PIN (§2.1):
     avCompInit() -> boolean
     avCompList() -> [{ id, name, createdAt, segments, out: {frames,peak,rms,rate,channels}|null }]
     avCompCreate(opts?) -> comp copy                  // { name? } -> fresh empty comp { id:'c1'… }
     avCompDelete(id) -> boolean
     avCompSetSegment(compId, index, patch) -> { ok, segment }   // patch { takeId, fromFrame,
     avCompAddSegment(compId, patch) -> { ok, index }            //   toFrame, fadeIn, fadeOut }
     avCompRemoveSegment(compId, index) -> boolean
     avCompSegments(compId) -> [segment]
     avCompAutoComp(compId, opts?) -> { ok, segments, regions }  // pick-best (lite), CURRENT takes
     avCompRender(compId) -> { ok, frames, peak, rms, clipped }  // pure stitch -> comp.out
     avCompExport(compId) -> Promise<receipt>          // WAV via avWavEncode; 16-bit stereo
     avCompState() -> { count, comps, takesSeen, lastError }
     avCompClasses() -> string[]                       // [] — the card owns markup
     window.__avComp = { version, init, list, create, del, setSegment, addSegment, removeSegment,
                         segments, auto, render, export, state, classes,
                         pure: { xfadeGains, applyXfade, stitch } }

   MODEL: comp = { id:'c1'…, name, createdAt, segments:[seg], out }. Segment = { takeId, fromFrame,
   toFrame, fadeIn, fadeOut } (frames; trimmed and clamped to the take's length; defaults fromFrame 0,
   toFrame take.frames; fades default AV_COMP_FADE_DEF=240 frames ≈ 5 ms @48k, clamp 0..24000).
   comp.rendered (engine-internal, NOT in list metas) carries the Float32 channel arrays of the last
   render for export; any segment edit invalidates both out and rendered. Comp artifacts are
   in-memory v1 — comps do NOT ride session snapshots; persistence = the WAV export (Undetermined/
   future per §2.1).

   TAKES ARE READ-ONLY. avTakesList() returns METAS WITHOUT the Float32 `data` arrays, so the engine
   reads the avTakes STORE OBJECT (avTakes.takes) behind typeof+try guards (the cleaner-accessor
   watch item): every reach is read-only, never mutates take state, and renders copy out of the take
   arrays via subarray views. Takes missing their data are skipped (counted, never padding).

   AUTO PICK-BEST (lite, pinned): regions = the lap grid of the LONGEST take (ties -> earlier);
   cycleFrames = the median of full-lap (partial:false) take frames (fallback: longest take frames;
   fallback: whole take = one region). Region r covers [r·cycle, min((r+1)·cycle, owner.frames)).
   Score(take, r) = rms(region) × (peak(region) <= 0.98 ? 1 : 0.5) — highest wins; ties -> earlier
   take; regions no take can be scored for (empty/short after clamping) are skipped and counted.
   Segments = one per scored region (winner takeId + the region range clamped to the winner's
   length — partial tails clamp, never pad). Receipt: { ok, segments, regions, cycleFrames, skipped,
   picked }.

   RENDER (pure stitch, §2.1): resolve each segment's take, re-clamp the window, hand the windows to
   pure.stitch with fades; each seam is an equal-power crossfade of max(fadeOut(prev), fadeIn(next))
   frames CLAMPED TO THE SHORTER SEGMENT; 2 ms equal-power anti-click fade at the comp's outer
   edges; output channels = per-channel stitch of the take data (mono duplicated to stereo at
   export — the av_takes convention). Allocation happens at render time only; the render is REFUSED
   honestly when it would exceed AV_COMP_RENDER_MAX_SECONDS = 300 s of output (checked BEFORE any
   allocation). peak/rms/clipped are measured over the rendered samples (clipped = count of samples
   with |x| > 1; 0 = clean).

   PURE SURFACE (rig-checked directly; dependency-free, exact):
     pure.xfadeGains(n) -> [g1, g2] (Float32Array pair, ALSO carrying .g1/.g2 properties)
       equal-power quarter-wave: g1[i]=cos(t·π/2), g2[i]=sin(t·π/2), t=i/(n-1) for n>=2;
       g1 runs 1->0, g2 runs 0->1; g1²+g2²=1 (<=1e-6). n floored, capped at 1e7; n<=0 -> empty pair;
       n===1 -> ([1],[0]) (a one-frame seam is the identity).
     pure.applyXfade(dst, dstOff, a, b, n) -> dst|null
       writes dst[off+i] = a[i]·g1[i] + b[i]·g2[i] for i in [0, min(n, a.len, b.len, dst.len-off));
       sample-exact: a=1s,b=0s -> dst = g1. n<=0 -> dst untouched; n===1 -> dst[off]=a[0]; garbage
       -> null; NEVER throws.
     pure.stitch(parts, opts) -> { ok, frames, channels, data:[Float32Array,…], skipped } | {ok:false,error}
       parts = [{ chans:[chan,…] | data:[chan,…] | [chan,…] | chan, fadeIn?, fadeOut? }, …] — the
       windows are ALREADY trimmed take slices (read-only). Seam i (between part i and i+1) =
       equal-power crossfade of n = max(fadeOut_i, fadeIn_{i+1}) frames clamped to min(L_i, L_{i+1});
       out frames = ΣL − Σn. Zero-length/invalid parts are dropped (counted in `skipped`).
       opts.edgeFrames (default 0) = equal-power anti-click fade-in/out at both outer edges (clamped
       to floor(frames/2)); render() passes the 2 ms value. Output is deterministic (two calls ->
       identical bytes). THE render path render() calls.

   LAWS: "use strict"; classic script (no modules); node-loadable (no DOM at load — the only
   top-level browser touch is the guarded typeof window probe at the end); ONE namespace
   (avComp* / AV_COMP_*); never throws (honest refusals + counted skips); no console noise. */

"use strict";

const AV_COMP_VERSION = "s2.1";
const AV_COMP_FADE_DEF = 240;                 /* §2.1: default fade, ≈5 ms @48k */
const AV_COMP_FADE_MAX = 24000;               /* §2.1: fade clamp 0..24000 */
const AV_COMP_EDGE_MS = 2;                    /* §2.1: 2 ms equal-power outer anti-click edges */
const AV_COMP_RENDER_MAX_SECONDS = 300;       /* §5: cap render at 5 min output (honest refusal) */
const AV_COMP_WAV_BITS = 16;                  /* comp export = 16-bit stereo (rig pin, takes sibling) */
const AV_COMP_CLIP_PEAK = 0.98;               /* auto-comp clip penalty threshold (§2.1) */
const AV_COMP_SR_DEF = 48000;                 /* house native rate (av_rec law) */
const AV_COMP_GAINS_MAX = 10000000;           /* xfadeGains allocation guard (never seen in practice) */
const AV_COMP_PI_HALF = Math.PI / 2;
const AV_COMP_CLASSES = Object.freeze([]);    /* §2.1: [] — the card owns markup */

/* ---------- module state (comp artifacts only; no DOM, no nodes, no take copies) ---------- */

const avComp = {
  inited: false,
  comps: [],            /* comp objects in creation order */
  nextId: 1,
  takesSeen: 0,         /* takes visible to the engine at the most recent read */
  lastError: null,
  lastAuto: null,
  lastRender: null,
  lastExport: null,
  lastUrlKeep: null,    /* the settled export's object URL (revoked on the next export) */
};

const avCompNowMs = (typeof performance !== "undefined" && typeof performance.now === "function")
  ? function () { return performance.now(); }
  : function () { return Date.now(); };

/* ---------- tiny value laws (garbage in, sane value out) ---------- */

function avCompErr(e) {
  try { return String((e && (e.message || e.name)) || e) || "unknown error"; }
  catch (e2) { return "unknown error"; }
}

function avCompClampInt(v, dflt, lo, hi) {
  const n = Number(v);
  if (v == null || v === "" || !isFinite(n)) return dflt;
  const r = Math.round(n);
  return r < lo ? lo : (r > hi ? hi : r);
}

function avCompStr(v, dflt, cap) {
  try {
    if (typeof v !== "string") return dflt;
    const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, cap || 80);
    return s || dflt;
  } catch (e) { return dflt; }
}

function avCompNumOf(id) {
  try {
    const m = /(\d+)/.exec(String(id == null ? "" : id));
    const n = m ? parseInt(m[1], 10) : 0;
    return isFinite(n) && n > 0 ? n : 0;
  } catch (e) { return 0; }
}

/* ---------- guarded takes reach (READ-ONLY; typeof + try, never mutates) ---------- */

/* One take -> a read-only span { id, frames, rate, channels, chans, partial } | null.
   frames never exceeds the actual data length (honest: a render never reads past the arrays). */
function avCompTakeSpan(t) {
  try {
    if (!t || typeof t !== "object") return null;
    const id = (t.id != null && t.id !== "") ? String(t.id) : null;
    if (!id) return null;
    const d = t.data;
    if (!d || typeof d.length !== "number" || !(d.length >= 1)) return null;
    const chans = [];
    for (let c = 0; c < d.length && c < 8; c++) {
      const ch = d[c];
      if (!ch || typeof ch !== "object" || typeof ch.length !== "number" || !(ch.length >= 1)) return null;
      chans.push(ch);
    }
    if (!chans.length) return null;
    let dataLen = chans[0].length;
    for (let c = 1; c < chans.length; c++) if (chans[c].length < dataLen) dataLen = chans[c].length;
    let frames = Math.round(Number(t.frames));
    if (!isFinite(frames) || frames < 0) frames = dataLen;
    if (frames > dataLen) frames = dataLen;
    if (!(frames > 0)) return null;
    let rate = Number(t.rate);
    if (!isFinite(rate) || !(rate > 0)) rate = AV_COMP_SR_DEF;
    return { id: id, frames: frames, rate: rate, channels: chans.length, chans: chans, partial: t.partial === true };
  } catch (e) { return null; }
}

/* The CURRENT takes as spans (empty when the store is absent/unreadable). Read-only. */
function avCompTakes() {
  const out = [];
  try {
    if (typeof avTakes === "undefined" || !avTakes) return out;
    const arr = avTakes.takes;
    if (!Array.isArray(arr)) return out;
    avComp.takesSeen = arr.length;
    for (let i = 0; i < arr.length; i++) {
      const s = avCompTakeSpan(arr[i]);
      if (s) out.push(s);
    }
  } catch (e) { /* keep the last known takesSeen; empty list is the honest answer */ }
  return out;
}

/* Light takes-count refresh for state()/init (never clobbers on an unreadable store). */
function avCompTakesSeen() {
  try {
    if (typeof avTakes !== "undefined" && avTakes && Array.isArray(avTakes.takes)) {
      avComp.takesSeen = avTakes.takes.length;
    }
  } catch (e) { /* keep last known */ }
  return avComp.takesSeen;
}

function avCompSpanOf(takes, id) {
  try {
    const s = String(id);
    for (let i = 0; i < takes.length; i++) if (takes[i].id === s) return takes[i];
  } catch (e) { /* never throws */ }
  return null;
}

/* ---------- pure: equal-power gains + applyXfade (§2.1 numera, rig-checked) ---------- */

/* The pair: [g1, g2] Float32Arrays; also reachable as pair.g1 / pair.g2. */
function avCompGainPair(n) {
  let nn = Math.floor(Number(n));
  if (!isFinite(nn) || nn < 0) nn = 0;
  if (nn > AV_COMP_GAINS_MAX) nn = AV_COMP_GAINS_MAX;
  let g1 = null, g2 = null;
  try {
    g1 = new Float32Array(nn);
    g2 = new Float32Array(nn);
  } catch (e) {                                    /* pathological allocation refused honestly */
    g1 = new Float32Array(0);
    g2 = new Float32Array(0);
  }
  const len = g1.length;
  if (len === 1) { g1[0] = 1; g2[0] = 0; }         /* one-frame seam = identity */
  else if (len > 1) {
    for (let i = 0; i < len; i++) {
      const t = i / (len - 1);
      g1[i] = Math.cos(t * AV_COMP_PI_HALF);
      g2[i] = Math.sin(t * AV_COMP_PI_HALF);
    }
  }
  const pair = [g1, g2];
  pair.g1 = g1;
  pair.g2 = g2;
  return pair;
}

function avCompXfadeGains(n) {
  try { return avCompGainPair(n); }
  catch (e) { const p = [new Float32Array(0), new Float32Array(0)]; p.g1 = p[0]; p.g2 = p[1]; return p; }
}

/* dst[off+i] = a[i]·g1[i] + b[i]·g2[i] — sample-exact; garbage (incl. strings) -> null; never
   throws. Windows must be array-likes (TypedArray | plain Array), never strings. */
function avCompApplyXfade(dst, dstOff, a, b, n) {
  try {
    if (!dst || typeof dst !== "object" || typeof dst.length !== "number") return null;
    if (!a || typeof a !== "object" || typeof a.length !== "number") return null;
    if (!b || typeof b !== "object" || typeof b.length !== "number") return null;
    const offN = Number(dstOff);
    if (!isFinite(offN) || offN < 0) return null;
    const off = Math.floor(offN);
    if (!(off <= dst.length)) return null;
    let nn = Math.floor(Number(n));
    if (!isFinite(nn) || nn <= 0) return dst;                       /* nothing to mix */
    nn = Math.min(nn, a.length, b.length, dst.length - off);
    if (!(nn > 0)) return dst;
    if (nn === 1) { dst[off] = a[0]; return dst; }                  /* identity (gains contract) */
    const denom = nn - 1;
    for (let i = 0; i < nn; i++) {
      const t = i / denom;
      const g1 = Math.cos(t * AV_COMP_PI_HALF);
      const g2 = Math.sin(t * AV_COMP_PI_HALF);
      dst[off + i] = a[i] * g1 + b[i] * g2;
    }
    return dst;
  } catch (e) { return null; }
}

/* ---------- pure: stitch (THE render path) ---------- */

/* Windows are read-only views/copies of already-trimmed channels. */
function avCompWindowOf(arr, from, to) {
  try {
    if (!arr || typeof arr.length !== "number") return null;
    const a = from < 0 ? 0 : from;
    const b = to > arr.length ? arr.length : to;
    if (!(b > a)) return null;
    if (typeof arr.subarray === "function") return arr.subarray(a, b);   /* view: zero allocation */
    if (typeof arr.slice === "function") return arr.slice(a, b);
  } catch (e) { /* fall through */ }
  return null;
}

/* array-like of channels | array-like of samples | null */
function avCompChanList(x) {
  if (x == null || typeof x !== "object" || typeof x.length !== "number" || !(x.length >= 1)) return null;
  const first = x[0];
  if (first && typeof first === "object" && typeof first.length === "number") return x;  /* list */
  return [x];                                                                            /* one chan */
}

/* One part -> { chans, L, fin, fout } | null. L = the SHORTEST channel (honest reads). */
function avCompPartNorm(p) {
  try {
    if (p == null) return null;
    let raw = null;
    if (Array.isArray(p)) raw = p;
    else if (typeof p === "object") {
      if (p.chans != null) raw = p.chans;
      else if (p.data != null) raw = p.data;
      else raw = p;                                          /* bare typed array = one channel */
    }
    const chanSrc = avCompChanList(raw);
    if (!chanSrc) return null;
    const chans = [];
    for (let c = 0; c < chanSrc.length && c < 8; c++) {
      const ch = chanSrc[c];
      if (!ch || typeof ch !== "object" || typeof ch.length !== "number" || !(ch.length >= 1)) return null;
      chans.push(ch);
    }
    if (!chans.length) return null;
    let L = chans[0].length;
    for (let c = 1; c < chans.length; c++) if (chans[c].length < L) L = chans[c].length;
    const fin = avCompClampInt((p && typeof p === "object" && !Array.isArray(p)) ? p.fadeIn : null, 0, 0, 1e9);
    const fout = avCompClampInt((p && typeof p === "object" && !Array.isArray(p)) ? p.fadeOut : null, 0, 0, 1e9);
    return { chans: chans, L: L, fin: fin, fout: fout };
  } catch (e) { return null; }
}

function avCompPartsNorm(parts) {
  const list = [];
  let skipped = 0;
  if (Array.isArray(parts)) {
    for (let i = 0; i < parts.length; i++) {
      const n = avCompPartNorm(parts[i]);
      if (n) list.push(n); else skipped += 1;
    }
  }
  return { list: list, skipped: skipped };
}

/* seam i: max(fadeOut_i, fadeIn_{i+1}) clamped to the shorter part (§2.1). Single source of truth
   for both stitch and render's pre-allocation cap check. */
function avCompSeamPlan(list) {
  const seams = [];
  for (let i = 0; i + 1 < list.length; i++) {
    let n = list[i].fout > list[i + 1].fin ? list[i].fout : list[i + 1].fin;
    if (!(n > 0)) n = 0;
    if (n > list[i].L) n = list[i].L;
    if (n > list[i + 1].L) n = list[i + 1].L;
    seams.push(n);
  }
  return seams;
}

function avCompStitchRun(list, edgeFrames) {
  const k = list.length;
  if (!k) return { ok: false, error: "no parts" };
  let ch = 1;
  for (let i = 0; i < k; i++) if (list[i].chans.length > ch) ch = list[i].chans.length;
  const seams = avCompSeamPlan(list);
  let total = 0;
  for (let i = 0; i < k; i++) total += list[i].L;
  let nSum = 0;
  for (let i = 0; i < seams.length; i++) nSum += seams[i];
  const outLen = total - nSum;
  if (!(outLen >= 1)) return { ok: false, error: "empty output" };
  const data = [];
  for (let c = 0; c < ch; c++) data.push(new Float32Array(outLen));
  let cursor = 0;
  for (let i = 0; i < k; i++) {
    const part = list[i];
    const nPrev = i > 0 ? seams[i - 1] : 0;
    const nNext = i + 1 < k ? seams[i] : 0;
    const startIn = nPrev;
    const endIn = part.L - nNext;
    let copyLen = endIn - startIn;
    if (copyLen > outLen - cursor) copyLen = outLen - cursor;      /* safety (never normal input) */
    if (copyLen > 0) {
      for (let c = 0; c < ch; c++) {
        const src = part.chans[c < part.chans.length ? c : 0];
        const win = avCompWindowOf(src, startIn, startIn + copyLen);
        if (win) { try { data[c].set(win, cursor); } catch (e2) { /* shorter chan: leave zeros */ } }
      }
      cursor += copyLen;
    }
    if (i + 1 < k && seams[i] > 0) {
      let n = seams[i];
      if (n > outLen - cursor) n = outLen - cursor;                /* safety (never normal input) */
      if (n > 0) {
        const next = list[i + 1];
        for (let c = 0; c < ch; c++) {
          const a = part.chans[c < part.chans.length ? c : 0];
          const b = next.chans[c < next.chans.length ? c : 0];
          const winA = avCompWindowOf(a, part.L - n, part.L);
          const winB = avCompWindowOf(b, 0, n);
          if (winA && winB) avCompApplyXfade(data[c], cursor, winA, winB, n);
        }
        cursor += n;
      }
    }
  }
  /* 2 ms anti-click fades at the comp's outer edges (equal-power, §2.1) */
  let e = avCompClampInt(edgeFrames, 0, 0, 1e9);
  if (outLen >= 2 && e > Math.floor(outLen / 2)) e = Math.floor(outLen / 2);
  if (outLen < 2) e = 0;
  if (e > 0) {
    const pair = avCompGainPair(e);
    const g1 = pair.g1, g2 = pair.g2;
    for (let c = 0; c < ch; c++) {
      const out = data[c];
      for (let j = 0; j < e; j++) {
        out[j] *= g2[j];                 /* rise in */
        out[outLen - e + j] *= g1[j];    /* fall out */
      }
    }
  }
  return { ok: true, frames: outLen, channels: ch, data: data };
}

/* Public pure surface. parts: see header. opts.edgeFrames (alias .edge), default 0. */
function avCompStitch(parts, opts) {
  try {
    if (!Array.isArray(parts)) return { ok: false, error: "parts must be an array" };
    const o = (opts && typeof opts === "object") ? opts : {};
    const norm = avCompPartsNorm(parts);
    if (!norm.list.length) return { ok: false, error: "no usable parts", skipped: norm.skipped };
    const edge = avCompClampInt(o.edgeFrames != null ? o.edgeFrames : o.edge, 0, 0, 1e9);
    const out = avCompStitchRun(norm.list, edge);
    if (out && out.ok === true) out.skipped = norm.skipped;
    else if (out && norm.skipped) out.skipped = norm.skipped;
    return out;
  } catch (e) {
    return { ok: false, error: avCompErr(e) };
  }
}

/* ---------- comp store ops ---------- */

function avCompFind(id) {
  try {
    const s = String(id);
    for (let i = 0; i < avComp.comps.length; i++) {
      if (String(avComp.comps[i].id) === s) return avComp.comps[i];
    }
  } catch (e) { /* never throws */ }
  return null;
}

function avCompRefuse(msg) {
  avComp.lastError = msg;
  return { ok: false, error: msg };
}

function avCompSegCopy(s) {
  return { takeId: s.takeId, fromFrame: s.fromFrame, toFrame: s.toFrame, fadeIn: s.fadeIn, fadeOut: s.fadeOut };
}

function avCompSegCopies(arr) {
  const out = [];
  try { for (let i = 0; i < arr.length; i++) out.push(avCompSegCopy(arr[i])); } catch (e) { /* empty */ }
  return out;
}

function avCompInvalidate(comp) {
  try { comp.out = null; comp.rendered = null; } catch (e) { /* never throws */ }
}

function avCompMeta(comp) {
  return {
    id: comp.id,
    name: comp.name,
    createdAt: comp.createdAt,
    segments: avCompSegCopies(comp.segments),
    out: comp.out ? {
      frames: comp.out.frames, peak: comp.out.peak, rms: comp.out.rms,
      rate: comp.out.rate, channels: comp.out.channels,
    } : null,
  };
}

/* Validate + clamp one segment against the CURRENT takes. base = the segment being edited
   (Set: missing fields keep the old value; Add: defaults fromFrame 0 / toFrame take.frames /
   fades AV_COMP_FADE_DEF). Returns { segment } | { error } — never stores a dangling take ref. */
function avCompNormSegment(patch, base) {
  try {
    const src = (patch && typeof patch === "object") ? patch : {};
    const b = base || null;
    const idRaw = (src.takeId != null && src.takeId !== "") ? src.takeId : (b ? b.takeId : null);
    if (idRaw == null || idRaw === "") return { error: "takeId required" };
    const takes = avCompTakes();
    const span = avCompSpanOf(takes, idRaw);
    if (!span) return { error: "take not found: " + String(idRaw) };
    const total = span.frames;
    const fromSrc = (src.fromFrame != null) ? src.fromFrame : (b ? b.fromFrame : null);
    const toSrc = (src.toFrame != null) ? src.toFrame : (b ? b.toFrame : null);
    let from = avCompClampInt(fromSrc, b ? b.fromFrame : 0, 0, total);
    let to = avCompClampInt(toSrc, total, 0, total);
    if (to < from) to = from;                       /* an inverted trim collapses to empty (counted) */
    const fiSrc = (src.fadeIn != null) ? src.fadeIn : (b ? b.fadeIn : null);
    const foSrc = (src.fadeOut != null) ? src.fadeOut : (b ? b.fadeOut : null);
    const fadeIn = avCompClampInt(fiSrc, b ? b.fadeIn : AV_COMP_FADE_DEF, 0, AV_COMP_FADE_MAX);
    const fadeOut = avCompClampInt(foSrc, b ? b.fadeOut : AV_COMP_FADE_DEF, 0, AV_COMP_FADE_MAX);
    return { segment: { takeId: span.id, fromFrame: from, toFrame: to, fadeIn: fadeIn, fadeOut: fadeOut } };
  } catch (e) { return { error: avCompErr(e) }; }
}

function avCompCreate(opts) {
  try {
    const o = (opts && typeof opts === "object") ? opts : {};
    const seq = avComp.nextId++;
    const comp = {
      id: "c" + seq,
      name: avCompStr(o.name, "Comp " + seq, 80),
      createdAt: avCompNowMs(),
      segments: [],
      out: null,
      rendered: null,
    };
    avComp.comps.push(comp);
    avComp.lastError = null;
    return avCompMeta(comp);                        /* a detached copy — mutate via the API only */
  } catch (e) { avComp.lastError = avCompErr(e); return null; }
}

function avCompDelete(id) {
  try {
    const s = String(id);
    for (let i = 0; i < avComp.comps.length; i++) {
      if (String(avComp.comps[i].id) === s) { avComp.comps.splice(i, 1); return true; }
    }
  } catch (e) { /* never throws */ }
  return false;
}

function avCompList() {
  const out = [];
  try { for (let i = 0; i < avComp.comps.length; i++) out.push(avCompMeta(avComp.comps[i])); }
  catch (e) { /* empty */ }
  return out;
}

function avCompSetSegment(compId, index, patch) {
  const comp = avCompFind(compId);
  if (!comp) return avCompRefuse("comp not found: " + String(compId));
  const idx = avCompClampInt(index, -1, -1, 1e9);
  if (idx < 0 || idx >= comp.segments.length) return avCompRefuse("no segment at index " + String(index));
  const norm = avCompNormSegment(patch, comp.segments[idx]);
  if (norm.error) return avCompRefuse(norm.error);
  comp.segments[idx] = norm.segment;
  avCompInvalidate(comp);
  avComp.lastError = null;
  return { ok: true, segment: avCompSegCopy(norm.segment), index: idx };
}

function avCompAddSegment(compId, patch) {
  const comp = avCompFind(compId);
  if (!comp) return avCompRefuse("comp not found: " + String(compId));
  const norm = avCompNormSegment(patch, null);
  if (norm.error) return avCompRefuse(norm.error);
  comp.segments.push(norm.segment);
  avCompInvalidate(comp);
  avComp.lastError = null;
  return { ok: true, index: comp.segments.length - 1, segment: avCompSegCopy(norm.segment) };
}

function avCompRemoveSegment(compId, index) {
  try {
    const comp = avCompFind(compId);
    if (!comp) return false;
    const idx = avCompClampInt(index, -1, -1, 1e9);
    if (idx < 0 || idx >= comp.segments.length) return false;
    comp.segments.splice(idx, 1);
    avCompInvalidate(comp);
    return true;
  } catch (e) { return false; }
}

function avCompSegments(compId) {
  const comp = avCompFind(compId);
  if (!comp) return [];
  return avCompSegCopies(comp.segments);
}

/* ---------- pure scoring helpers (auto pick-best) ---------- */

/* rms + peak over [from, to) across every channel — pooled samples (§2.1 metric numera). */
function avCompRmsPeak(chans, from, to) {
  let sum = 0, peak = 0, n = 0;
  try {
    for (let c = 0; c < chans.length; c++) {
      const ch = chans[c];
      const hi = to < ch.length ? to : ch.length;
      for (let i = from; i < hi; i++) {
        const v = ch[i];
        if (typeof v !== "number" || !isFinite(v)) continue;      /* non-finite samples don't score */
        sum += v * v;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
        n += 1;
      }
    }
  } catch (e) { /* treated as empty */ }
  return { rms: n ? Math.sqrt(sum / n) : 0, peak: peak, n: n };
}

function avCompMedianFrames(vals) {
  const a = vals.slice().sort(function (x, y) { return x - y; });
  const n = a.length;
  if (!n) return 0;
  if (n % 2) return a[(n - 1) / 2];
  return Math.round((a[n / 2 - 1] + a[n / 2]) / 2);
}

/* ---------- AUTO pick-best (lite) — the pinned region/metric formula ---------- */

function avCompAutoComp(compId, opts) {
  try {
    const comp = avCompFind(compId);
    if (!comp) return avCompRefuse("comp not found: " + String(compId));
    const o = (opts && typeof opts === "object") ? opts : {};
    const fadeIn = avCompClampInt(o.fadeIn != null ? o.fadeIn : o.fade, AV_COMP_FADE_DEF, 0, AV_COMP_FADE_MAX);
    const fadeOut = avCompClampInt(o.fadeOut != null ? o.fadeOut : o.fade, AV_COMP_FADE_DEF, 0, AV_COMP_FADE_MAX);

    const takes = avCompTakes();                                    /* READ-ONLY spans */
    if (!takes.length) return avCompRefuse("no takes");

    /* grid owner = the longest take (ties -> earlier) */
    let owner = takes[0];
    for (let i = 1; i < takes.length; i++) if (takes[i].frames > owner.frames) owner = takes[i];

    /* cycleFrames = median of full-lap frames; fallbacks per §2.1 */
    const full = [];
    for (let i = 0; i < takes.length; i++) if (takes[i].partial !== true && takes[i].frames > 0) full.push(takes[i].frames);
    let cycle = full.length ? avCompMedianFrames(full) : owner.frames;
    if (!(cycle > 0)) cycle = owner.frames;
    if (!(cycle > 0)) return avCompRefuse("no scorable regions (empty takes)");

    const regions = Math.max(1, Math.ceil(owner.frames / cycle));
    const segs = [];
    const picked = [];
    let skipped = 0;
    for (let r = 0; r < regions; r++) {
      const from = r * cycle;
      let best = null, bestScore = 0;
      for (let ti = 0; ti < takes.length; ti++) {
        const t = takes[ti];
        const to = Math.min((r + 1) * cycle, t.frames);             /* partial tails clamp, never pad */
        if (to <= from) continue;                                   /* no coverage */
        const m = avCompRmsPeak(t.chans, from, to);
        if (!(m.n > 0)) continue;                                   /* empty/short region for this take */
        const score = m.rms * (m.peak <= AV_COMP_CLIP_PEAK ? 1 : 0.5);
        if (!isFinite(score)) continue;
        if (best === null || score > bestScore) { best = t; bestScore = score; }   /* ties -> earlier */
      }
      if (!best) { skipped += 1; continue; }                        /* no take scored this region */
      segs.push({
        takeId: best.id,
        fromFrame: from,
        toFrame: Math.min((r + 1) * cycle, best.frames),
        fadeIn: fadeIn,
        fadeOut: fadeOut,
      });
      picked.push(best.id);
    }
    if (!segs.length) return avCompRefuse("no scorable regions (every region skipped)");

    comp.segments = segs;                                           /* the comp's segments = the result */
    avCompInvalidate(comp);
    avComp.lastError = null;
    avComp.lastAuto = { compId: comp.id, regions: regions, built: segs.length, skipped: skipped, cycleFrames: cycle };
    return {
      ok: true,
      segments: avCompSegCopies(segs),
      regions: regions,
      cycleFrames: cycle,
      skipped: skipped,
      picked: picked.slice(),
    };
  } catch (e) { return avCompRefuse(avCompErr(e)); }
}

/* ---------- render (pure stitch; allocation at render time only) ---------- */

function avCompStats(data) {
  let peak = 0, sum = 0, n = 0, clipped = 0;
  try {
    for (let c = 0; c < data.length; c++) {
      const ch = data[c];
      for (let i = 0; i < ch.length; i++) {
        const v = ch[i];
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
        sum += v * v;
        if (a > 1) clipped += 1;
        n += 1;
      }
    }
  } catch (e) { /* partial stats beat a throw */ }
  return { peak: peak, rms: n ? Math.sqrt(sum / n) : 0, clipped: clipped };
}

function avCompRenderedFresh(comp) {
  try {
    const r = comp && comp.rendered;
    if (!r || !Array.isArray(r.data) || !r.data.length) return null;
    const d0 = r.data[0];
    if (!d0 || typeof d0.length !== "number" || !(d0.length >= 1)) return null;
    return r;
  } catch (e) { return null; }
}

function avCompRender(compId) {
  try {
    const comp = avCompFind(compId);
    if (!comp) return avCompRefuse("comp not found: " + String(compId));
    avCompInvalidate(comp);                                         /* a render is the only fresh truth */
    const segs = Array.isArray(comp.segments) ? comp.segments : [];
    if (!segs.length) return avCompRefuse("no segments");

    const takes = avCompTakes();                                    /* READ-ONLY */
    const parts = [];
    let skipped = 0, rate = 0;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const span = avCompSpanOf(takes, s.takeId);
      if (!span) return avCompRefuse("take missing: " + String(s.takeId));
      const from = avCompClampInt(s.fromFrame, 0, 0, span.frames);
      const to = avCompClampInt(s.toFrame, span.frames, 0, span.frames);
      if (to <= from) { skipped += 1; continue; }                   /* empty segment: counted skip */
      const chans = [];
      for (let c = 0; c < span.chans.length; c++) {
        const win = avCompWindowOf(span.chans[c], from, to);        /* view — no allocation */
        if (!win) { chans.length = 0; break; }
        chans.push(win);
      }
      if (!chans.length) { skipped += 1; continue; }
      parts.push({
        chans: chans,
        fadeIn: avCompClampInt(s.fadeIn, AV_COMP_FADE_DEF, 0, AV_COMP_FADE_MAX),
        fadeOut: avCompClampInt(s.fadeOut, AV_COMP_FADE_DEF, 0, AV_COMP_FADE_MAX),
      });
      if (!(rate > 0)) rate = span.rate;
    }
    if (!parts.length) return avCompRefuse("no usable segments (all empty or skipped)");
    if (!(rate > 0)) rate = AV_COMP_SR_DEF;

    /* cap check BEFORE any allocation (§5: 5 min of output, honest refusal beyond) */
    const norm = avCompPartsNorm(parts);
    const list = norm.list;
    if (!list.length) return avCompRefuse("no usable segments (all empty or skipped)");
    const seams = avCompSeamPlan(list);
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i].L;
    let nSum = 0;
    for (let i = 0; i < seams.length; i++) nSum += seams[i];
    const outFrames = total - nSum;
    if (!(outFrames >= 1)) return avCompRefuse("degenerate render (empty output)");
    const capFrames = Math.round(AV_COMP_RENDER_MAX_SECONDS * rate);
    if (outFrames > capFrames) {
      return avCompRefuse("render exceeds the 5 min cap (" + outFrames + " frames > " + capFrames + ")");
    }

    const edgeFrames = Math.max(0, Math.round((AV_COMP_EDGE_MS * rate) / 1000));
    const out = avCompStitchRun(list, edgeFrames);                  /* THE pure stitch path */
    if (!out || out.ok !== true) return avCompRefuse("stitch refused: " + ((out && out.error) || "unknown"));
    const stats = avCompStats(out.data);
    comp.out = { frames: out.frames, peak: stats.peak, rms: stats.rms, rate: rate, channels: out.channels };
    comp.rendered = {
      data: out.data, frames: out.frames, peak: stats.peak, rms: stats.rms,
      clipped: stats.clipped, rate: rate, channels: out.channels, at: avCompNowMs(),
    };
    avComp.lastError = null;
    avComp.lastRender = { compId: comp.id, frames: out.frames, peak: stats.peak, rms: stats.rms, clipped: stats.clipped, rate: rate, at: comp.rendered.at };
    return {
      ok: true,
      frames: out.frames,
      peak: stats.peak,
      rms: stats.rms,
      clipped: stats.clipped,
      rate: rate,
      channels: out.channels,
      skipped: skipped + norm.skipped,
    };
  } catch (e) { return avCompRefuse(avCompErr(e)); }
}

/* ---------- export (16-bit stereo WAV via avWavEncode; mono duplicated — av_takes convention) ---------- */

function avCompExport(compId) {
  return new Promise(function (resolve) {
    try {
      const comp = avCompFind(compId);
      if (!comp) { resolve({ ok: false, error: "comp not found: " + String(compId) }); return; }
      let rend = avCompRenderedFresh(comp);
      if (rend) {
        /* a cached render is usable only while every segment's take still resolves (honest
           refusals when a take was deleted behind the comp — the render leg would refuse too) */
        const takesNow = avCompTakes();
        const segsNow = Array.isArray(comp.segments) ? comp.segments : [];
        for (let i = 0; i < segsNow.length; i++) {
          if (!avCompSpanOf(takesNow, segsNow[i].takeId)) { rend = null; break; }
        }
      }
      if (!rend) {                                                  /* export auto-renders once */
        const r = avCompRender(comp.id);
        if (!r || r.ok !== true) { resolve({ ok: false, error: "render refused: " + ((r && r.error) || "unknown") }); return; }
        rend = avCompRenderedFresh(comp);
      }
      if (!rend) { resolve({ ok: false, error: "nothing to export (empty render)" }); return; }
      if (typeof avWavEncode !== "function") { resolve({ ok: false, error: "wav encoder unavailable (avWavEncode missing)" }); return; }
      const lCh = rend.data[0];
      const rCh = (rend.data.length > 1 && rend.data[1] && rend.data[1].length) ? rend.data[1] : rend.data[0];
      let buf = null;
      try { buf = avWavEncode({ l: lCh, r: rCh, sr: rend.rate || AV_COMP_SR_DEF, bits: AV_COMP_WAV_BITS, dither: "auto" }); }
      catch (e) { buf = null; }
      if (!buf) { resolve({ ok: false, error: "wav encode refused (bad comp data)" }); return; }
      let bytes = 0;
      try { bytes = (typeof buf.byteLength === "number") ? buf.byteLength : 0; } catch (e) { bytes = 0; }
      let wavInfo = null;
      try { if (typeof avWavInfo === "function") wavInfo = avWavInfo(buf); } catch (e) { wavInfo = null; }
      let blob = null;
      try { blob = new Blob([buf], { type: "audio/wav" }); } catch (e) { blob = null; }
      if (avComp.lastUrlKeep) { try { URL.revokeObjectURL(avComp.lastUrlKeep); } catch (e) { /* already revoked */ } }
      let url = null;
      try { url = (blob && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") ? URL.createObjectURL(blob) : null; }
      catch (e) { url = null; }
      avComp.lastUrlKeep = url;
      const name = "anvil_comp" + avCompNumOf(comp.id) + ".wav";
      avComp.lastExport = { id: comp.id, name: name, bytes: bytes, at: avCompNowMs() };
      resolve({
        ok: true,
        id: comp.id,
        name: name,
        frames: rend.frames,
        rate: rend.rate || AV_COMP_SR_DEF,
        seconds: rend.frames / (rend.rate || AV_COMP_SR_DEF),
        bytes: bytes,
        blob: blob,
        url: url,
        wavInfo: wavInfo,
      });
    } catch (e) {
      resolve({ ok: false, error: avCompErr(e) });
    }
  });
}

/* ---------- state / classes / init (snapshots only) ---------- */

function avCompState() {
  try {
    avCompTakesSeen();
    const comps = [];
    for (let i = 0; i < avComp.comps.length; i++) {
      const c = avComp.comps[i];
      comps.push({ id: c.id, name: c.name, segments: c.segments.length, rendered: !!c.out });
    }
    return {
      version: AV_COMP_VERSION,
      count: comps.length,
      comps: comps,
      takesSeen: avComp.takesSeen,
      lastError: avComp.lastError,
    };
  } catch (e) {
    return { version: AV_COMP_VERSION, count: 0, comps: [], takesSeen: avComp.takesSeen, lastError: avCompErr(e) };
  }
}

function avCompClasses() { return AV_COMP_CLASSES.slice(); }

function avCompInit() {
  try {
    avComp.inited = true;
    avCompTakesSeen();
    return true;
  } catch (e) { return false; }
}

/* ---------- debug handle (guarded; node harnesses get the globals instead) ---------- */

if (typeof window !== "undefined") {
  try {
    window.__avComp = {
      version: AV_COMP_VERSION,
      init: avCompInit,
      list: avCompList,
      create: avCompCreate,
      del: avCompDelete,
      setSegment: avCompSetSegment,
      addSegment: avCompAddSegment,
      removeSegment: avCompRemoveSegment,
      segments: avCompSegments,
      auto: avCompAutoComp,
      render: avCompRender,
      export: avCompExport,
      state: avCompState,
      classes: avCompClasses,
      pure: {
        xfadeGains: avCompXfadeGains,
        applyXfade: avCompApplyXfade,
        stitch: avCompStitch,
      },
    };
  } catch (e) { /* no window — node harness only */ }
}
