/* av_bounce.js — Anvil P6 DELIVER: the offline song-bounce renderer (verify/_p6_wave.md §2.4).
   Contract: avBouncePlan (pure) + avBounce (the offline render pipeline). One namespace
   (avBounce* / AV_BOUNCE_*). Classic script, NO DOM/worklet reach at load — loads in plain node
   with zero browser deps; every browser reach is `typeof`-guarded inside a function and every
   failure is an honest refusal ({ok:false, error}) — nothing ever throws.

   THE PIPELINE (mirror-sourced, live state never touched):
     1. snap      — opts.snap or a fresh avSeqSnap() copy; the pure planner avSeqPlan runs over
                    [0, loops × cycleLen) in 8-step chunks (the live scheduler's own cadence).
     2. patch     — every row of opts.params || avParams via h.setParam (engine.kind FIRST,
                    explicit, default "va"); avModPayload() rides as {t:"mod", macros, slots};
                    avSampleStore.sent slots 0..3 rebuild channel copies from the store's
                    AudioBuffer (av_sample.js copy law) and send {t:"sample", id:slot, name,
                    rate, ch1, ch2} — CLONE ONLY, never a transfer list (the store's buffers must
                    survive).
     3. schedule  — one suspend/resume per injected boundary (probe law §0): B =
                    round(t·sr/128)·128, clamped so B ≤ frames−128 (watch item §6: suspend times
                    must stay inside the render); B=0 is applied PRE-render with the patch (no
                    suspend(−1/sr)); each boundary applies param/plock rows first, then offs, then
                    ons, then a per-boundary DELIVERY BARRIER (probe law rev2, 2026-10-07): a
                    stats round trip proves every queued boundary message was already PROCESSED
                    before the render resumes — the bare resume raced message delivery
                    (multi-message bins intermittently lost/stuck notes; the barrier is
                    parent-probe-verified clean AND byte-deterministic, 15/15 syncs while
                    suspended). After the last event one allOff() runs (its own trailing boundary when
                    there is room, else at the end of the last boundary). Same schedule for every
                    render of a bounce ⇒ stems are mutually aligned by construction.
     4. render    — fresh OfflineAudioContext(2, frames, sr) → avEngineBoot(oc,{offline:true}) →
                    patch → a worklet FIFO barrier (await h.stats(), the rev3 delivery lesson —
                    without it queued messages race startRendering) → per-boundary suspends (each
                    barrier'd; stats.barrierFail counts timeouts) →
                    startRendering() → channel data copied into FRESH Float32Arrays (the render
                    buffer is never leaked or referenced afterwards).
     5. parts     — ONE render per emitted buffer: the master (all masked tracks) and one render
                    per selected track (that track's events only, same timebase/schedule). The
                    loop is sequential, so peak memory is one render at a time (memory law).

   P-LOCKS (mirror of av_plock.js's live cadence, pure): when applyPlocks and lanes exist, every
   step boundary of the render range mod the pattern cycle is evaluated per lane; step lanes lock
   at their locked steps and restore the transport-start base when the lock lets go; lin lanes
   take the locked value at grid points and the pure sampler avPlockSampleLane value in between
   (guarded; local mirror of the same math when absent); past the last lock the pinned restore
   law applies; an unknown base holds (never a guessed value). Lanes source: opts.lanes →
   live avPlockLanesSnap() (guarded, non-empty) → snap.plocks. Rows ride h.setParam at the step
   boundary's quantum; refusals counted.

   DETERMINISM: identical opts + identical page state ⇒ bit-identical buffers (same messages,
   same order, same boundary schedule; no randomness anywhere in this file).
   REFUSALS: refused[] is a string list, always present on ok AND failure; warnings[] same.
   The engine's own defaults cover unmirrored paths (watch item: FX/pads rows may be sparse).
   Tap-level rows ("master"/"keys") replay as messages like every other row — the engine
   no-ops unknown paths; the offline render's master/keys levels ride the tap chain defaults
   (avState), which the live commit path keeps in sync. */

"use strict";

const AV_BOUNCE_VERSION = "p6.1";
const AV_BOUNCE_DEF_SR = 48000;
const AV_BOUNCE_QUANTUM = 128;                 /* render quantum: the §0 pinned onset grid */
const AV_BOUNCE_CHUNK_STEPS = 8;               /* planner window, same as the live scheduler */
const AV_BOUNCE_TRACKS = 4;
const AV_BOUNCE_STEPS = 64;
const AV_BOUNCE_LEN_DEF = 16;                  /* cycleLen floor — the avSeqSchedCycleLen law */
const AV_BOUNCE_LOOPS_MIN = 1;
const AV_BOUNCE_LOOPS_MAX = 64;
const AV_BOUNCE_TAIL_MIN = 0;
const AV_BOUNCE_TAIL_MAX = 10;
const AV_BOUNCE_MAX_SECONDS_DEF = 600;         /* memory law: refuse above honestly */
const AV_BOUNCE_KINDS = ["va", "acid", "string", "drum", "grain", "sampler"];
const AV_BOUNCE_SAMPLE_SLOTS = 4;
const AV_BOUNCE_SAMPLE_CAP_S = 60;             /* engine law: ≤ 60 s per channel */
const AV_BOUNCE_BARRIER_MS = 5000;             /* just-in-case the driver outlives the render */
const AV_BOUNCE_SYNC_MS = 800;                 /* per-boundary delivery barrier cap (probe law rev2) */

/* ---------- tiny value laws (never throw) ---------- */

function avBounceHas(obj, key) {
  try { return Object.prototype.hasOwnProperty.call(obj, key); } catch (e) { return false; }
}
function avBounceMsg(e) {
  try { return String((e && (e.message || e.name)) || e) || "unknown error"; } catch (e2) { return "unknown error"; }
}
function avBounceClampNum(v, dflt, lo, hi) {
  const n = Number(v);
  if (v == null || v === "" || !isFinite(n)) return dflt;
  return n < lo ? lo : (n > hi ? hi : n);
}
function avBounceInt(v, dflt, lo, hi) {
  const n = Number(v);
  if (v == null || v === "" || !isFinite(n)) return dflt;
  const r = Math.round(n);
  return r < lo ? lo : (r > hi ? hi : r);
}
function avBounceNum(v, dflt) {
  const n = Number(v);
  return isFinite(n) ? n : dflt;
}
function avBounceNow() {
  try { if (typeof performance !== "undefined" && performance && typeof performance.now === "function") return performance.now(); } catch (e) { /* no clock */ }
  try { return Date.now(); } catch (e2) { return 0; }
}
function avBounceMerge(dst, src) {
  try {
    if (!Array.isArray(src)) return dst;
    for (let i = 0; i < src.length; i++) {
      const s = src[i];
      if (typeof s === "string" && s && dst.indexOf(s) < 0) dst.push(s);
    }
  } catch (e) { /* dedupe is a nicety */ }
  return dst;
}
function avBouncePickSr(v) {
  return (Number(v) === 44100) ? 44100 : AV_BOUNCE_DEF_SR;
}
function avBounceMaxSeconds(v) {
  const n = Number(v);
  return (isFinite(n) && n > 0) ? n : AV_BOUNCE_MAX_SECONDS_DEF;
}
function avBounceMaskNorm(m) {
  const out = [true, true, true, true];
  if (Array.isArray(m)) {
    for (let i = 0; i < AV_BOUNCE_TRACKS; i++) {
      const v = (i < m.length) ? m[i] : undefined;
      out[i] = (v === undefined || v === null) ? true : !!v;
    }
  }
  return out;
}

/* ---------- pattern-derived pure laws ---------- */

/* cycleLen: the avSeqSchedCycleLen law — floor 16, longest clamped track len, 1..64 */
function avBounceCycleLen(snap) {
  let len = AV_BOUNCE_LEN_DEF;
  try {
    const tracks = (snap && snap.tracks && typeof snap.tracks.length === "number") ? snap.tracks : [];
    for (let i = 0; i < tracks.length && i < AV_BOUNCE_TRACKS; i++) {
      const tr = tracks[i];
      const n = avBounceInt(tr ? tr.len : AV_BOUNCE_LEN_DEF, AV_BOUNCE_LEN_DEF, 1, AV_BOUNCE_STEPS);
      if (n > len) len = n;
    }
  } catch (e) { /* default stands */ }
  return len;
}

/* base step duration: avSeqSchedGridDur when present (guarded), identical local mirror else */
function avBounceStepDur(snap) {
  try {
    if (typeof avSeqSchedGridDur === "function") {
      const d = avSeqSchedGridDur(snap ? snap.bpm : 120, (snap && snap.grid === "8t") ? "8t" : "16");
      if (isFinite(d) && d > 0) return d;
    }
  } catch (e) { /* fall through to the mirror */ }
  const bpm = avBounceClampNum(snap ? snap.bpm : 120, 120, 20, 300);
  return (snap && snap.grid === "8t") ? (60 / bpm / 3) : (60 / bpm / 4);
}

function avBounceBpmOf(snap) {
  return avBounceClampNum(snap ? snap.bpm : 120, 120, 20, 300);
}

/* note name -> midi (planner's own parser first — guarded; identical local grammar else) */
function avBounceNoteMidi(note) {
  try {
    if (typeof avSeqSchedParseNote === "function") {
      const m = avSeqSchedParseNote(note);
      if (m != null) return m;
    }
  } catch (e) { /* fall through */ }
  const m = /^([a-g])(#?)(-?\d+)$/.exec(String(note == null ? "" : note).toLowerCase());
  if (!m) return null;
  const pc = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1]];
  return (Number(m[3]) + 1) * 12 + pc + (m[2] ? 1 : 0);
}

function avBounceRankOf(ev) {
  try { return (ev && ev.__rank === 1) ? 1 : 0; } catch (e) { return 0; }
}
/* merge comparator across planner chunks: (t, tie-rank); Array.sort stability keeps the
   planner's own insertion order inside ties — the live scheduler's cmpPending law */
function avBounceCmpPlan(a, b) {
  return (a.t - b.t) || (avBounceRankOf(a) - avBounceRankOf(b));
}
function avBounceRngNorm(v) {
  let x = Number(v);
  if (!isFinite(x)) x = 0x12345678;
  x = Math.floor(x) >>> 0;
  return x === 0 ? 0x12345678 : x;
}

/* ---------- the PURE planner (avBouncePlan) ---------- */

function avBouncePlanEvents(snap, totalSteps, mask, warnings) {
  const evs = [];
  let rng = avBounceRngNorm(snap ? snap.rng : 0x12345678);
  for (let from = 0; from < totalSteps; from += AV_BOUNCE_CHUNK_STEPS) {
    const to = Math.min(from + AV_BOUNCE_CHUNK_STEPS, totalSteps);
    let res = null;
    try { res = avSeqPlan(snap, from, to, 0, rng); } catch (e) { res = null; }
    if (!res || !Array.isArray(res.events)) { warnings.push("planner window failed (" + from + ".." + to + ")"); continue; }
    rng = res.rngNext >>> 0;
    for (let i = 0; i < res.events.length; i++) evs.push(res.events[i]);
  }
  evs.sort(avBounceCmpPlan);
  const out = [];
  for (let i = 0; i < evs.length; i++) {
    const ev = evs[i];
    if (!ev || typeof ev !== "object") continue;
    const t = Number(ev.t);
    if (!isFinite(t)) continue;
    if (ev.type !== "on" && ev.type !== "off") continue;
    const track = avBounceInt(ev.track, 0, 0, AV_BOUNCE_TRACKS - 1);
    if (mask[track] !== true) continue;
    const midi = avBounceNoteMidi(ev.note);
    if (midi == null) { warnings.push("unparseable note '" + String(ev.note) + "' skipped (track " + track + ")"); continue; }
    const gain = (ev.type === "on") ? avBounceClampNum(ev.vel, 0.8, 0.05, 1) : 0;
    /* a negative-micro step 0 can plan before the render origin — the offline timeline starts
       at frame 0, so the honest clamp is t = 0 (never a drop, never a negative frame) */
    const tt = (t < 0) ? 0 : t;
    out.push({ t: tt, type: ev.type, midi: midi, gain: gain, track: track, step: avBounceInt(ev.step, 0, 0, AV_BOUNCE_STEPS - 1) });
  }
  return out;
}

/* snap + opts -> { ok, events, frames, seconds, cycleSteps, sr, warnings } | { ok:false, error, warnings }
   Pure: prefers the real avSeqSchedGridDur when the scheduler is loaded, refuses honestly when
   the planner itself is absent. frames = ceil((loops × cycleLen × stepDur + tailS) × sr). */
function avBouncePlan(snap, opts) {
  const warnings = [];
  try {
    const o = (opts && typeof opts === "object") ? opts : {};
    if (!snap || typeof snap !== "object") return { ok: false, error: "invalid pattern snapshot", warnings: warnings };
    if (typeof avSeqPlan !== "function") return { ok: false, error: "planner unavailable (avSeqPlan missing)", warnings: warnings };
    const sr = avBouncePickSr(o.sr);
    const loops = avBounceInt(o.loops, 1, AV_BOUNCE_LOOPS_MIN, AV_BOUNCE_LOOPS_MAX);
    const tailS = avBounceClampNum(o.tailS, 2, AV_BOUNCE_TAIL_MIN, AV_BOUNCE_TAIL_MAX);
    const mask = avBounceMaskNorm(o.trackMask);
    const cycleSteps = avBounceCycleLen(snap);
    const stepDur = avBounceStepDur(snap);
    const totalSteps = loops * cycleSteps;
    const rawSeconds = totalSteps * stepDur + tailS;
    const maxSeconds = avBounceMaxSeconds(o.maxSeconds);
    if (rawSeconds > maxSeconds) {
      return { ok: false, error: "render length " + (Math.round(rawSeconds * 100) / 100) + "s exceeds maxSeconds " + maxSeconds, warnings: warnings };
    }
    const frames = Math.ceil(rawSeconds * sr);
    const events = avBouncePlanEvents(snap, totalSteps, mask, warnings);
    if (!events.length) warnings.push("pattern has no audible events");
    return { ok: true, events: events, frames: frames, seconds: frames / sr, cycleSteps: cycleSteps, sr: sr, warnings: warnings };
  } catch (e) {
    return { ok: false, error: "plan failed: " + avBounceMsg(e), warnings: warnings };
  }
}

/* ---------- the PURE schedule builder (avBounceSchedule) ---------- */

/* t -> quantum boundary frame: B = round(t·sr/128)·128, clamped into [0, frames−128] */
function avBounceQuantF(t, sr, frames) {
  const fmax = Math.max(0, (Number(frames) | 0) - AV_BOUNCE_QUANTUM);
  let f = Math.round((Number(t) * sr) / AV_BOUNCE_QUANTUM) * AV_BOUNCE_QUANTUM;
  if (!isFinite(f)) return 0;
  if (f < 0) f = 0;
  if (f > fmax) f = fmax;
  return f;
}

/* events (planner order) + plock rows -> deduped per-boundary bins, ascending:
   [{ f, rows:[], offs:[], ons:[] }] — apply order inside a bin is rows → offs → ons. */
function avBounceSchedule(events, rows, sr, frames) {
  const out = { list: [], count: 0, pre: false, clamped: 0, dropped: 0 };
  try {
    const srv = avBouncePickSr(sr);
    const map = new Map();
    const bin = (f) => {
      let b = map.get(f);
      if (!b) { b = { f: f, rows: [], offs: [], ons: [] }; map.set(f, b); }
      return b;
    };
    const evs = Array.isArray(events) ? events : [];
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      if (!ev || typeof ev !== "object" || (ev.type !== "on" && ev.type !== "off")) { out.dropped++; continue; }
      const t = Number(ev.t);
      if (!isFinite(t) || t < 0) { out.dropped++; continue; }
      const raw = Math.round((t * srv) / AV_BOUNCE_QUANTUM) * AV_BOUNCE_QUANTUM;
      let f = raw < 0 ? 0 : raw;
      if (f > Math.max(0, ((Number(frames) | 0) - AV_BOUNCE_QUANTUM))) { f = Math.max(0, ((Number(frames) | 0) - AV_BOUNCE_QUANTUM)); out.clamped++; }
      const b = bin(f);
      if (ev.type === "off") b.offs.push(ev); else b.ons.push(ev);
    }
    const rws = Array.isArray(rows) ? rows : [];
    for (let i = 0; i < rws.length; i++) {
      const r = rws[i];
      if (!r || typeof r !== "object") { out.dropped++; continue; }
      const t = Number(r.t);
      if (!isFinite(t) || t < 0) { out.dropped++; continue; }
      const raw = Math.round((t * srv) / AV_BOUNCE_QUANTUM) * AV_BOUNCE_QUANTUM;
      let f = raw < 0 ? 0 : raw;
      if (f > Math.max(0, ((Number(frames) | 0) - AV_BOUNCE_QUANTUM))) { f = Math.max(0, ((Number(frames) | 0) - AV_BOUNCE_QUANTUM)); out.clamped++; }
      bin(f).rows.push(r);
    }
    const list = [];
    map.forEach((b) => list.push(b));
    list.sort((a, b) => a.f - b.f);
    out.list = list;
    out.count = list.length;
    out.pre = map.has(0);
    return out;
  } catch (e) { return out; }
}

/* ---------- the PURE p-lock lane cadence (avBounceLaneRows) ---------- */

/* next lock index strictly after s, or -1 — the avPlockNextLockIdx mirror */
function avBounceNextLock(lane, s) {
  let best = -1;
  try {
    const steps = lane && lane.steps;
    if (!steps) return best;
    for (const k in steps) {
      if (!avBounceHas(steps, k)) continue;
      const i = Number(k);
      if (isFinite(i) && i > s && (best < 0 || i < best)) best = i;
    }
  } catch (e) { /* -1 */ }
  return best;
}

/* local mirror of avPlockSampleLane (same math) — used only when the real sampler is absent */
function avBounceSampleLaneLocal(lane, pos) {
  try {
    if (!lane || typeof lane !== "object" || !lane.steps || typeof lane.steps !== "object") return null;
    const p = Number(pos);
    if (!isFinite(p) || p < 0) return null;
    let from = -1, fromVal = 0;
    for (const k in lane.steps) {
      if (!avBounceHas(lane.steps, k)) continue;
      const i = Number(k), v = Number(lane.steps[k]);
      if (!isFinite(i) || !isFinite(v)) continue;
      if (i <= p && i > from) { from = i; fromVal = v; }
    }
    if (from < 0) return null;
    if (lane.interp !== "lin") return { value: fromVal, kind: "lock", from: from };
    const next = avBounceNextLock(lane, from);
    if (next < 0) return { value: fromVal, kind: "hold", from: from };
    const toVal = Number(lane.steps[String(next)]);
    if (!isFinite(toVal)) return { value: fromVal, kind: "hold", from: from };
    let f = (p - from) / (next - from);
    if (f < 0) f = 0;
    if (f > 1) f = 1;
    return { value: fromVal + (toVal - fromVal) * f, kind: "lin", from: from, to: next };
  } catch (e) { return null; }
}

function avBounceLaneNorm(lane) {
  if (!lane || typeof lane !== "object") return null;
  if (typeof lane.path !== "string" || !lane.path) return null;
  const steps = (lane.steps && typeof lane.steps === "object" && !Array.isArray(lane.steps)) ? lane.steps : null;
  if (!steps) return null;
  const clean = {};
  for (const k in steps) {
    if (!avBounceHas(steps, k)) continue;
    const i = Number(k);
    if (!isFinite(i) || i !== Math.round(i) || i < 0 || i >= AV_BOUNCE_STEPS) continue;
    const v = Number(steps[k]);
    if (!isFinite(v)) continue;
    clean[String(i)] = v;
  }
  return { path: lane.path, interp: (lane.interp === "lin") ? "lin" : "step", steps: clean };
}

/* lanes + { totalSteps, cycleSteps, stepDur, base } -> { rows, warnings, refusals }
   Mirrors the live per-boundary cadence (avPlockApplyStepLaneAt / avPlockApplyLinLaneAt):
   step lanes lock at locked steps and restore the transport-start base when the lock lets go;
   lin lanes lock at grid points, take the pure sampler's interpolated value in between (the
   real avPlockSampleLane when loaded), and restore past the last lock; an unknown base holds. */
function avBounceLaneRows(lanes, opts) {
  const out = { rows: [], warnings: [], refusals: [] };
  try {
    const o = (opts && typeof opts === "object") ? opts : {};
    const totalSteps = avBounceInt(o.totalSteps, 0, 0, 1 << 20);
    const cycleSteps = Math.max(1, avBounceInt(o.cycleSteps, AV_BOUNCE_LEN_DEF, 1, AV_BOUNCE_STEPS));
    const stepDur = Number(o.stepDur);
    const base = (o.base && typeof o.base === "object") ? o.base : {};
    if (!(totalSteps > 0)) return out;
    if (!isFinite(stepDur) || !(stepDur > 0)) { out.warnings.push("p-lock rows skipped (invalid step duration)"); return out; }
    const arr = Array.isArray(lanes) ? lanes : [];
    if (!arr.length) return out;
    const sampler = (typeof avPlockSampleLane === "function") ? avPlockSampleLane : null;

    const list = [];
    for (let i = 0; i < arr.length; i++) {
      const lane = avBounceLaneNorm(arr[i]);
      if (!lane) { out.refusals.push("p-lock lane " + i + " skipped (invalid lane)"); continue; }
      list.push(lane);
    }
    if (!list.length) return out;

    const state = [];
    for (let i = 0; i < list.length; i++) state.push({ applied: false, seg: null });

    for (let g = 0; g < totalSteps; g++) {
      const s = g % cycleSteps;
      const key = String(s);
      for (let i = 0; i < list.length; i++) {
        const lane = list[i];
        const st = state[i];
        const hasLock = avBounceHas(lane.steps, key);
        const t = g * stepDur;
        if (lane.interp === "lin") {
          if (hasLock) {
            const v = Number(lane.steps[key]);
            const next = avBounceNextLock(lane, s);
            const toVal = (next >= 0) ? Number(lane.steps[String(next)]) : NaN;
            st.seg = { from: s, fromVal: v, to: (next >= 0 && isFinite(toVal)) ? next : null, toVal: (next >= 0 && isFinite(toVal)) ? toVal : null };
            st.applied = true;
            out.rows.push({ t: t, step: s, path: lane.path, value: v, kind: "lock" });
            continue;
          }
          if (st.seg && st.seg.to !== null) {
            const samp = sampler ? sampler(lane, s) : avBounceSampleLaneLocal(lane, s);
            let value = null;
            if (samp && samp.kind === "lin" && isFinite(samp.value)) {
              value = samp.value;
            } else {
              const span = st.seg.to - st.seg.from;
              let f = (span > 0) ? ((s - st.seg.from) / span) : 1;
              if (f < 0) f = 0;
              if (f > 1) f = 1;
              value = st.seg.fromVal + (st.seg.toVal - st.seg.fromVal) * f;
            }
            st.applied = true;
            out.rows.push({ t: t, step: s, path: lane.path, value: value, kind: "lin" });
            continue;
          }
          if (st.seg || st.applied) {
            st.seg = null;
            const b = avBounceHas(base, lane.path) ? Number(base[lane.path]) : NaN;
            if (isFinite(b)) {
              st.applied = false;
              out.rows.push({ t: t, step: s, path: lane.path, value: b, kind: "restore" });
            }
            /* unknown base: hold (never a guessed restore value) */
          }
          continue;
        }
        /* interp "step" */
        if (hasLock) {
          const v = Number(lane.steps[key]);
          st.applied = true;
          out.rows.push({ t: t, step: s, path: lane.path, value: v, kind: "lock" });
        } else if (st.applied) {
          const b = avBounceHas(base, lane.path) ? Number(base[lane.path]) : NaN;
          if (isFinite(b)) {
            st.applied = false;
            out.rows.push({ t: t, step: s, path: lane.path, value: b, kind: "restore" });
          }
        }
      }
    }
    return out;
  } catch (e) {
    out.refusals.push("p-lock pass failed: " + avBounceMsg(e));
    return out;
  }
}

/* ---------- renderer internals ---------- */

function avBounceResolveLanes(o, snap) {
  try {
    if (Array.isArray(o.lanes)) return o.lanes;
    if (typeof avPlockLanesSnap === "function") {
      const l = avPlockLanesSnap();
      if (Array.isArray(l) && l.length) return l;
    }
    if (snap && Array.isArray(snap.plocks) && snap.plocks.length) return snap.plocks;
  } catch (e) { /* fall through */ }
  return [];
}

function avBounceKindOf(mirror) {
  try {
    const v = mirror ? mirror["engine.kind"] : undefined;
    if (typeof v === "number" && isFinite(v)) {
      const i = Math.round(v);
      if (i >= 0 && i < AV_BOUNCE_KINDS.length) return AV_BOUNCE_KINDS[i];
    }
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (AV_BOUNCE_KINDS.indexOf(s) >= 0) return s;
    }
  } catch (e) { /* default */ }
  return "va";
}

function avBounceSendMod(h, payload) {
  try {
    if (h.kind === "worklet") { h.node.port.postMessage({ t: "mod", macros: payload.macros, slots: payload.slots }); return true; }
    if (typeof AVDSP !== "undefined" && AVDSP && typeof AVDSP.setMod === "function") return AVDSP.setMod(h.engine, payload.macros, payload.slots) === true;
  } catch (e) { /* refused */ }
  return false;
}

/* sample send — structured CLONE ONLY (never a transfer list; the store's buffers must survive) */
function avBounceSendSample(h, id, name, rate, ch1, ch2) {
  try {
    if (h.kind === "worklet") { h.node.port.postMessage({ t: "sample", id: id, name: name, rate: rate, ch1: ch1, ch2: ch2 || null }); return true; }
    if (typeof AVDSP !== "undefined" && AVDSP && typeof AVDSP.setSample === "function") return AVDSP.setSample(h.engine, id, name, rate, ch1, ch2) === true;
  } catch (e) { /* refused */ }
  return false;
}

function avBounceHasSlotRecords() {
  try {
    if (typeof avSampleStore === "undefined" || !avSampleStore || !Array.isArray(avSampleStore.sent)) return false;
    for (let i = 0; i < avSampleStore.sent.length; i++) if (avSampleStore.sent[i]) return true;
  } catch (e) { /* none */ }
  return false;
}

/* slot records -> fresh channel copies -> the offline transport (av_sample.js copy law) */
function avBounceSendSamples(h, box) {
  let store = null;
  try { if (typeof avSampleStore !== "undefined" && avSampleStore) store = avSampleStore; } catch (e) { store = null; }
  if (!store || !Array.isArray(store.sent)) return;
  for (let slot = 0; slot < AV_BOUNCE_SAMPLE_SLOTS; slot++) {
    const rec = store.sent[slot];
    if (!rec || typeof rec !== "object") continue;
    let entry = null;
    try { if (typeof store.get === "function") entry = store.get(rec.id); } catch (e) { entry = null; }
    const buf = (entry && entry.buffer) ? entry.buffer : null;
    if (!buf || typeof buf.getChannelData !== "function" || typeof buf.length !== "number" || !(buf.length > 0)) {
      box.refused.push("sample slot " + slot + ": source buffer unavailable (" + String(rec.id) + ")");
      continue;
    }
    let okSend = false;
    try {
      const n0 = Math.max(0, buf.length | 0);
      const bsr = Number(buf.sampleRate), rsr = Number(rec.rate);
      const rate = (isFinite(bsr) && bsr > 0) ? bsr : ((isFinite(rsr) && rsr > 0) ? rsr : 0);
      const cap = rate > 0 ? Math.round(AV_BOUNCE_SAMPLE_CAP_S * rate) : n0;
      const n = Math.min(n0, cap);
      if (n > 0) {
        const channels = Math.max(1, Math.min(2, (isFinite(buf.numberOfChannels) ? buf.numberOfChannels | 0 : 1)));
        const src1 = buf.getChannelData(0);
        const ch1 = new Float32Array(n);
        ch1.set(src1.subarray(0, Math.min(n, src1.length)));
        let ch2 = null;
        if (channels > 1) {
          const src2 = buf.getChannelData(1);
          ch2 = new Float32Array(n);
          ch2.set(src2.subarray(0, Math.min(n, src2.length)));
        }
        okSend = avBounceSendSample(h, slot, String(rec.name == null ? rec.id : rec.name), rate, ch1, ch2);
      }
    } catch (e) { okSend = false; }
    if (okSend) box.stats.samples++;
    else box.refused.push("sample slot " + slot + ": send refused (" + String(rec.id) + ")");
  }
}

/* one boundary: param/plock rows first, then offs, then ons (the §2.4 apply law) */
function avBounceApplyBoundary(h, b, clean, box) {
  try {
    for (let i = 0; i < b.rows.length; i++) {
      const row = b.rows[i];
      box.stats.rows++;
      let ok = false;
      try { ok = h.setParam(row.path, row.value) === true; } catch (e) { ok = false; }
      if (!ok) box.refused.push("plock setParam refused: " + String(row.path));
    }
    for (let i = 0; i < b.offs.length; i++) {
      box.stats.offs++;
      try { h.noteOff(b.offs[i].midi); } catch (e) { /* engine gone */ }
    }
    for (let i = 0; i < b.ons.length; i++) {
      const ev = b.ons[i];
      box.stats.ons++;
      let ok = false;
      try { ok = h.noteOn(ev.midi, ev.gain) === true; } catch (e) { ok = false; }
      if (!ok) box.refused.push("noteOn refused (midi " + ev.midi + ")");
    }
    if (b.clean || clean) { box.stats.allOffs++; try { h.allOff(); } catch (e) { /* gone */ } }
  } catch (e) { /* a boundary apply never escapes */ }
}

/* the per-boundary delivery barrier (probe law rev2, 2026-10-07): resolve true when the worklet
   replies to stats — the FIFO proof that every earlier boundary message was already PROCESSED —
   false on timeout; never throws. Worklet tier only (SPN applies messages synchronously). */
function avBounceBarrier(h) {
  return Promise.race([
    Promise.resolve().then(function () { return h.stats(); }).then(function (s) { return !!s; }).catch(function () { return false; }),
    new Promise(function (res) { try { setTimeout(function () { res(false); }, AV_BOUNCE_SYNC_MS); } catch (e) { res(false); } }),
  ]).catch(function () { return false; });
}

/* one offline render of one schedule (master or one part) -> { ok, l, r } | { ok:false, error } */
async function avBounceRenderOnce(args) {
  const sched = args.sched, frames = args.frames, sr = args.sr, mirror = args.mirror, kind = args.kind, box = args.out;
  let oc = null;
  try { oc = new OfflineAudioContext(2, frames, sr); } catch (e) { return { ok: false, error: "OfflineAudioContext create failed: " + avBounceMsg(e) }; }
  let h = null;
  try { h = await avEngineBoot(oc, { offline: true }); } catch (e) { h = null; }
  if (!h || h.ready !== true) {
    let log = null;
    try { if (typeof avEngineLastLog !== "undefined" && avEngineLastLog && avEngineLastLog.length) log = avEngineLastLog.join(" | "); } catch (e) { log = null; }
    return { ok: false, error: "offline engine boot failed" + (log ? " — " + log : "") };
  }
  const t0 = avBounceNow();

  /* 1. patch replay (mirror law): engine.kind first, explicit, default "va" */
  box.stats.params++;
  let kindOk = false;
  try { kindOk = h.setParam("engine.kind", kind) === true; } catch (e) { kindOk = false; }
  if (!kindOk) box.refused.push("setParam refused: engine.kind");
  if (mirror) {
    for (const path in mirror) {
      if (!avBounceHas(mirror, path)) continue;
      if (path === "engine.kind") continue;
      const v = mirror[path];
      box.stats.params++;
      if (typeof v === "number" ? !isFinite(v) : (typeof v !== "string")) { box.refused.push("param skipped (bad value): " + String(path)); continue; }
      let ok = false;
      try { ok = h.setParam(path, v) === true; } catch (e) { ok = false; }
      if (!ok) box.refused.push("setParam refused: " + String(path));
    }
  } else {
    avBounceMerge(box.warnings, ["no param mirror available — engine rides its defaults"]);
  }

  /* 2. mod payload (fresh F64(8) + F64(128) from avModPayload) */
  let modFn = null;
  try { if (typeof avModPayload === "function") modFn = avModPayload; } catch (e) { modFn = null; }
  if (modFn) {
    let payload = null;
    try { payload = modFn(); } catch (e) { payload = null; }
    if (payload && payload.macros && payload.slots) {
      if (avBounceSendMod(h, payload)) box.stats.mods++;
      else box.refused.push("mod payload not accepted");
    } else {
      box.refused.push("mod payload unavailable");
    }
  } else {
    avBounceMerge(box.warnings, ["mod matrix not replayed (avModPayload unavailable)"]);
  }

  /* 3. sample slots (clone-only) */
  avBounceSendSamples(h, box);

  /* 4. pre-render bin (f = 0) rides the patch — no suspend(−1/sr) */
  const list = sched.list;
  let idx = 0;
  if (list.length && list[0].f === 0) {
    box.stats.boundaries++;
    avBounceApplyBoundary(h, list[0], false, box);
    idx = 1;
  }

  /* 5. worklet FIFO barrier: the reply proves every queued message was processed */
  if (h.kind === "worklet" && typeof h.stats === "function") {
    let s = null;
    try { s = await h.stats(); } catch (e) { s = null; }
    if (s) box.stats.syncs++;
    else avBounceMerge(box.warnings, ["engine sync barrier timed out — patch replay may be partial"]);
  }

  /* 6. the suspend/resume driver (probe law §0), chained; one trailing allOff */
  const rest = [];
  for (let i = idx; i < list.length; i++) rest.push(list[i]);
  let cleanAtEnd = false;
  if (list.length) {
    const lastF = rest.length ? rest[rest.length - 1].f : 0;
    const fmax = Math.max(0, frames - AV_BOUNCE_QUANTUM);
    const cleanF = Math.min(lastF + AV_BOUNCE_QUANTUM, fmax);
    if (cleanF > lastF) rest.push({ f: cleanF, rows: [], offs: [], ons: [], clean: true });
    else cleanAtEnd = true;
  }
  let driverDone = false;
  const driver = (async function () {
    for (let i = 0; i < rest.length; i++) {
      const b = rest[i];
      let suspended = true;
      try { await oc.suspend((b.f - 1) / sr); } catch (e) { suspended = false; }
      if (!suspended) { box.stats.missed++; continue; }
      box.stats.suspends++;
      box.stats.boundaries++;
      avBounceApplyBoundary(h, b, (cleanAtEnd && i === rest.length - 1), box);
      /* probe law rev2 (2026-10-07): prove the boundary's messages were PROCESSED before the
         render resumes — the bare resume() raced message delivery (multi-message bins
         intermittently lost/stuck notes and made the master render nondeterministic) */
      if (h.kind === "worklet" && typeof h.stats === "function") {
        let sy = false;
        try { sy = await avBounceBarrier(h); } catch (e) { sy = false; }
        if (sy) box.stats.syncs++;
        else { box.stats.barrierFail++; if (box.stats.barrierFail === 1) avBounceMerge(box.warnings, ["boundary delivery barrier timed out"]); }
      }
      try { oc.resume(); } catch (e) { /* a resume refusal is retried by the next boundary */ }
    }
    driverDone = true;
  })();

  let rendered = null;
  try { rendered = await oc.startRendering(); } catch (e) { return { ok: false, error: "startRendering failed: " + avBounceMsg(e) }; }
  try { await Promise.race([driver, new Promise(function (res) { try { setTimeout(res, AV_BOUNCE_BARRIER_MS); } catch (e) { res(); } }) ]); } catch (e) { /* driver never rejects */ }
  if (!driverDone) { box.stats.driverTimeout++; avBounceMerge(box.warnings, ["boundary driver did not settle after the render"]); }
  box.stats.renderMs += (avBounceNow() - t0);
  box.stats.renders++;

  /* 7. fresh copies out — the render buffer is never leaked */
  const l = new Float32Array(frames), r = new Float32Array(frames);
  try {
    const cl = rendered.getChannelData(0), cr = rendered.getChannelData(1);
    if (cl) l.set(cl.subarray(0, Math.min(frames, cl.length)));
    if (cr) r.set(cr.subarray(0, Math.min(frames, cr.length)));
  } catch (e) { return { ok: false, error: "channel copy failed: " + avBounceMsg(e) }; }
  return { ok: true, l: l, r: r };
}

/* ---------- avBounce: the offline song renderer ---------- */

/* opts (all optional): loops 1..64 (1) · includeParts (true) · includeMaster (true) ·
   trackMask [bool×4] (all) · tailS 0..10 (2) · applyPlocks (true) · params object|null ·
   sr 48000|44100 (48000) · maxSeconds (600, refuse above honestly) · snap (test seam; a fresh
   avSeqSnap() copy is used when absent) · lanes (test seam; see the lanes source above).
   -> Promise<{ ok, sr, frames, seconds, loops, cycleSteps, bpm, parts, master, warnings,
                refused, stats } | { ok:false, error, warnings, refused, stats }>.
   Empty pattern (no audible events): ok:true, silent parts/master built without any engine —
   the honest zero path (also the reason this function is callable in plain node for that case). */
function avBounce(opts) {
  return new Promise(function (resolve) {
    (async function () {
      const warnings = [];
      const refused = [];
      const stats = {
        renders: 0, boundaries: 0, suspends: 0, missed: 0, ons: 0, offs: 0, rows: 0,
        params: 0, mods: 0, samples: 0, syncs: 0, barrierFail: 0, allOffs: 0, refusals: 0, renderMs: 0, driverTimeout: 0,
      };
      const fail = function (error) {
        stats.refusals = refused.length;
        resolve({ ok: false, error: String(error || "bounce failed"), warnings: warnings, refused: refused, stats: stats });
      };
      try {
        const o = (opts && typeof opts === "object") ? opts : {};
        const loops = avBounceInt(o.loops, AV_BOUNCE_LOOPS_MIN, AV_BOUNCE_LOOPS_MIN, AV_BOUNCE_LOOPS_MAX);
        const tailS = avBounceClampNum(o.tailS, 2, AV_BOUNCE_TAIL_MIN, AV_BOUNCE_TAIL_MAX);
        const sr = avBouncePickSr(o.sr);
        const mask = avBounceMaskNorm(o.trackMask);
        const includeParts = (o.includeParts === false) ? false : true;
        const includeMaster = (o.includeMaster === false) ? false : true;
        const applyPlocks = (o.applyPlocks === false) ? false : true;
        const maxSeconds = avBounceMaxSeconds(o.maxSeconds);

        let snap = null;
        if (o.snap && typeof o.snap === "object") snap = o.snap;
        else if (typeof avSeqSnap === "function") { try { snap = avSeqSnap(); } catch (e) { snap = null; } }
        if (!snap) { fail("no pattern snapshot available (avSeqSnap missing and no snap option given)"); return; }

        const plan = avBouncePlan(snap, { loops: loops, tailS: tailS, sr: sr, trackMask: mask, maxSeconds: maxSeconds });
        if (!plan.ok) { avBounceMerge(warnings, plan.warnings); fail(plan.error); return; }
        avBounceMerge(warnings, plan.warnings);
        const frames = plan.frames;
        const events = plan.events;
        const bpm = avBounceBpmOf(snap);

        const mirror = (o.params && typeof o.params === "object") ? o.params
          : ((typeof avParams !== "undefined" && avParams) ? avParams : null);
        const kind = avBounceKindOf(mirror);

        const sel = [];
        for (let t = 0; t < AV_BOUNCE_TRACKS; t++) if (mask[t] === true) sel.push(t);

        /* empty pattern: honest silent parts, no engine — and no browser needed */
        if (!events.length) {
          const partsSilent = [];
          if (includeParts) {
            for (let i = 0; i < sel.length; i++) {
              partsSilent.push({ track: sel[i], name: "stem" + (sel[i] + 1), l: new Float32Array(frames), r: new Float32Array(frames) });
            }
          }
          let masterSilent = null;
          if (includeMaster) masterSilent = { l: new Float32Array(frames), r: new Float32Array(frames) };
          stats.refusals = refused.length;
          resolve({ ok: true, sr: sr, frames: frames, seconds: frames / sr, loops: loops, cycleSteps: plan.cycleSteps, bpm: bpm, parts: partsSilent, master: masterSilent, warnings: warnings, refused: refused, stats: stats });
          return;
        }

        /* browser reach — guarded, honest refusal in plain node */
        if (typeof OfflineAudioContext !== "function") { fail("OfflineAudioContext unavailable — the offline song render needs a browser"); return; }
        if (typeof avEngineBoot !== "function") { fail("offline engine facade unavailable (avEngineBoot missing)"); return; }

        /* p-lock rows (pure cadence; base = the replay mirror at transport start) */
        let rows = [];
        if (applyPlocks) {
          const lanes = avBounceResolveLanes(o, snap);
          if (lanes.length) {
            const base = {};
            for (let i = 0; i < lanes.length; i++) {
              const lane = lanes[i];
              const p = (lane && typeof lane.path === "string") ? lane.path : null;
              if (!p) continue;
              let v = null;
              if (mirror && avBounceHas(mirror, p)) { const n = Number(mirror[p]); if (isFinite(n)) v = n; }
              base[p] = v;
            }
            const lr = avBounceLaneRows(lanes, { totalSteps: loops * plan.cycleSteps, cycleSteps: plan.cycleSteps, stepDur: avBounceStepDur(snap), base: base });
            rows = lr.rows;
            avBounceMerge(warnings, lr.warnings);
            for (let i = 0; i < lr.refusals.length; i++) refused.push(lr.refusals[i]);
          }
        }

        /* mirror-law honesty notes */
        if (kind === "sampler") avBounceMerge(warnings, ["sampler zones not replayed (no page-side source in v1)"]);
        if (kind === "grain" && !avBounceHasSlotRecords()) avBounceMerge(warnings, ["grain sample source not replayed (no slot sample present in v1)"]);

        /* jobs: master + one render per selected track (sequential — one render in memory) */
        const jobs = [];
        if (includeMaster) jobs.push({ master: true, events: events });
        if (includeParts) for (let i = 0; i < sel.length; i++) jobs.push({ master: false, track: sel[i], events: events.filter((ev) => ev.track === sel[i]) });

        const partsOut = [];
        let masterOut = null;
        for (let j = 0; j < jobs.length; j++) {
          const job = jobs[j];
          const jsched = avBounceSchedule(job.events, rows, sr, frames);
          const r = await avBounceRenderOnce({ sched: jsched, frames: frames, sr: sr, mirror: mirror, kind: kind, out: { warnings: warnings, refused: refused, stats: stats } });
          if (!r.ok) { fail(r.error); return; }
          if (job.master) masterOut = { l: r.l, r: r.r };
          else partsOut.push({ track: job.track, name: "stem" + (job.track + 1), l: r.l, r: r.r });
        }

        stats.refusals = refused.length;
        resolve({
          ok: true, sr: sr, frames: frames, seconds: frames / sr, loops: loops, cycleSteps: plan.cycleSteps,
          bpm: bpm, parts: partsOut, master: masterOut, warnings: warnings, refused: refused, stats: stats,
        });
      } catch (e) {
        fail("bounce failed: " + avBounceMsg(e));
      }
    })();
  });
}
