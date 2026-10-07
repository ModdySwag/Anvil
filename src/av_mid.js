/* av_mid.js — Anvil P6 DELIVER (sa-1): MIDI file I/O — the SMF type-1 writer, the parser and the
   pattern mapper. Contract: verify/_p6_wave.md §2.3 (+ §3 laws, §6 watch items); scratch harness
   cache/scratch/p6/mid/run.mjs (plain node, no network, self-contained).

   WHAT THIS FILE IS
   - avMidExport({snap, trackMask, name}) -> {ok, bytes, events, format, ppq, tracks, noteCount,
     cycleLen, warnings} | {ok:false, error, warnings}
       ONE cycle of the pattern snap through the PURE planner avSeqPlan (guarded typeof; fromStep
       0..cycleLen in the live scheduler's 8-step chunks; cycleLen = the avSeqSchedCycleLen law,
       floored at 16). SMF **format 1**, PPQ **480**: track 0 = track name + tempo meta; then ONE
       MIDI track per selected seq track (0..3, trackMask filter; channel = seq track index).
       Step = 120 ticks (grid "8t" = 80); swing / micro / ratchet fold into ABSOLUTE tick times
       straight from the planner's analytic seconds — ratchet = R planner-spaced (gate*td/R) short
       note pairs inside the step; note-off = max(round(offT), on+1 tick). Note-on velocity =
       clamp(round(vel*127), 1, 127). bytes is a FRESH ArrayBuffer. Warnings:
       "slide not representable in SMF (v1)" (any step has slide=1), "pattern has no audible
       events", "no tracks selected", "<n> note(s) unplayable in SMF skipped".
   - avMidParse(bytes) -> {ok, format, ppq, bpm, tempoUs, trackCount, tracks, noteCount, warnings}
       | {ok:false, error, warnings}
       bytes = ArrayBuffer | Uint8Array (Buffer is a Uint8Array) | number[]. Header + chunks;
       global tempo map (first tempo = bpm, multiple tempos integrated per tick); per-track note
       on/off pairing (FIFO per channel+note; note-on vel 0 = off) -> {midi, vel, tick, durTicks,
       tSec, durSec, channel}. Tolerates running status; skips unknown chunk types (warning);
       refuses malformed input honestly (bad magic, truncation, SMPTE division, unknown status,
       unterminated VLQ, ...).
   - avMidToPattern(parsed, opts) -> {ok, pattern, warnings} | {ok:false, error, warnings}
       The first 4 tracks (index order) carrying >= 1 paired note; every note -> nearest step
       (ties to the EARLIER step; stepDur = 60/bpm/4, grid "16") with the remainder in `micro`
       ticks (+-12, tick = stepDur/24) — avSeqCaptureQuantize(t, 0, bpm, "16", swing) when present
       (guarded scope), else the identical local kernel. vel -> 0.05..1; gate = clamp(durSec/
       stepDur, 0.05, 1). One note per step (first hit wins; duplicates merged + warning); notes
       beyond 64 steps dropped + warning; > 4 note tracks dropped + warning. Empty result ->
       {ok:false, error:"no notes"}. Returns an av_seq_core-shaped OBJECT — it never loads it.

   LAWS kept: "use strict"; ONE namespace (avMid* / AV_MID_*; no module syntax); classic script
   (no imports); no DOM at load (plain-node safe; every sibling reach typeof-guarded inside a
   function); never throws (honest refusals); deterministic (same snap => byte-identical bytes).
   Round-trip note: SMF carries no swing/slide/speed/accent/cond; an exported swung step re-
   imports as grid step + folded micro ticks (documented behaviour, asserted in the harness).   */

"use strict";

/* ---------- pins ---------- */

const AV_MID_VERSION = "p6.0";
const AV_MID_PPQ = 480;                 /* §2.3 pin: pulses per quarter */
const AV_MID_TRACKS = 4;
const AV_MID_STEPS = 64;
const AV_MID_CHUNK_STEPS = 8;           /* the live scheduler's plan chunk */
const AV_MID_TICK_DIV = 24;             /* micro ticks per step (wave §2) */
const AV_MID_MICRO_MAX = 12;
const AV_MID_BPM_MIN = 20;
const AV_MID_BPM_MAX = 300;
const AV_MID_BPM_DEF = 120;
const AV_MID_SWING_MIN = 50;            /* import quantize swing window (50 = straight) */
const AV_MID_SWING_MAX = 80;
const AV_MID_SWING_DEF = 50;            /* SMF carries no swing: straight grid is the v1 pin */
const AV_MID_VEL_MIN = 0.05;
const AV_MID_VEL_DEF = 0.8;
const AV_MID_GATE_MIN = 0.05;
const AV_MID_GATE_DEF = 0.95;
const AV_MID_LEN_DEF = 16;              /* = avSeqSchedCycleLen's floor */
const AV_MID_NAME_CAP = 64;             /* SMF text cap we write/read */
const AV_MID_PATNAME_CAP = 24;          /* = core AV_SEQ_NAME_CAP */
const AV_MID_TEMPO_DEF = 500000;        /* 120 bpm = the SMF default */
const AV_MID_SEED_PLAN = 0x9E3779B9;    /* = avSeqSchedSeedNorm's default planner state */
const AV_MID_RNG_DEF = 305419896;       /* = core AV_SEQ_DEF_RNG (0x12345678) */
const AV_MID_REL_VEL = 0;               /* note-off release velocity we write */

const AV_MID_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const AV_MID_PC_NAMES = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];

/* ---------- small value laws (never throw) ---------- */

function avMidIsNum(v) { return typeof v === "number" && isFinite(v); }

function avMidClampNum(v, dflt, lo, hi) {
  const n = Number(v);
  if (v == null || v === "" || !isFinite(n)) return dflt;
  return n < lo ? lo : (n > hi ? hi : n);
}

function avMidClampInt(v, dflt, lo, hi) {
  const n = Number(v);
  if (v == null || v === "" || !isFinite(n)) return dflt;
  const r = Math.round(n);
  return r < lo ? lo : (r > hi ? hi : r);
}

function avMidErrText(e) { return (e && typeof e.message === "string") ? e.message : "internal"; }

/* the refuse shape (§2.6: warnings always present, ok AND failure) */
function avMidFail(error, warnings) {
  return { ok: false, error: String(error || "refused"), warnings: warnings ? warnings.slice() : [] };
}

/* grid -> base step duration (same law as avSeqSchedGridDur) */
function avMidGridDur(bpm, grid) {
  const b = avMidClampNum(bpm, AV_MID_BPM_DEF, AV_MID_BPM_MIN, AV_MID_BPM_MAX);
  return (grid === "8t") ? (60 / b / 3) : (60 / b / 4);
}

/* planner RNG state normalisation (same law as avSeqSchedSeedNorm) */
function avMidSeedNorm(v) {
  let x = Number(v);
  if (!isFinite(x)) x = AV_MID_SEED_PLAN;
  x = Math.floor(x) >>> 0;
  return x === 0 ? AV_MID_SEED_PLAN : x;
}

/* cycleLen = longest track len, floored at 16 (the avSeqSchedCycleLen law, over OUR snap) */
function avMidCycleLen(snap) {
  let len = AV_MID_LEN_DEF;
  try {
    const tracks = (snap && Array.isArray(snap.tracks)) ? snap.tracks : [];
    for (let i = 0; i < tracks.length && i < AV_MID_TRACKS; i++) {
      const n = avMidClampInt(tracks[i] ? tracks[i].len : AV_MID_LEN_DEF, AV_MID_LEN_DEF, 1, AV_MID_STEPS);
      if (n > len) len = n;
    }
  } catch (e) { /* the floor stands */ }
  return len;
}

/* ---------- note names (local mirror; the planner hands us canonical names) ---------- */

function avMidNoteToMidi(note) {
  const s = String(note == null ? "" : note).trim().toLowerCase();
  const m = /^([a-g])(#?)(-?\d+)$/.exec(s);
  if (!m) return null;
  const v = (Number(m[3]) + 1) * 12 + AV_MID_PC[m[1]] + (m[2] ? 1 : 0);
  return (v >= 0 && v <= 127) ? v : null;
}

function avMidMidiToNote(midi) {
  const m = Math.round(Number(midi));
  if (!isFinite(m) || m < 0 || m > 127) return "";
  return AV_MID_PC_NAMES[m % 12] + (Math.floor(m / 12) - 1);
}

/* ---------- text / bytes ---------- */

/* printable-ASCII text, controls stripped, trimmed, capped (deterministic bytes) */
function avMidAscii(v, cap) {
  let s = "";
  if (typeof v === "string") s = v;
  else if (avMidIsNum(v)) s = String(v);
  else return "";
  s = s.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  let out = "";
  for (let i = 0; i < s.length && out.length < cap; i++) {
    const c = s.charCodeAt(i);
    out += (c >= 0x20 && c <= 0x7e) ? s.charAt(i) : "?";
  }
  return out;
}

function avMidTextFromBytes(u8, s, e, cap) {
  let out = "";
  for (let i = s; i < e && out.length < cap; i++) {
    const c = u8[i];
    out += (c >= 0x20 && c <= 0x7e) ? String.fromCharCode(c) : "?";
  }
  return out.trim();
}

/* ArrayBuffer | Uint8Array (Buffer included) | number[] -> Uint8Array | null */
function avMidToU8(x) {
  try {
    if (x == null) return null;
    if (typeof Uint8Array !== "undefined" && x instanceof Uint8Array) return x;
    if (typeof ArrayBuffer !== "undefined" && x instanceof ArrayBuffer) return new Uint8Array(x);
    if (Array.isArray(x)) {
      const u = new Uint8Array(x.length);
      for (let i = 0; i < x.length; i++) {
        const b = Number(x[i]);
        u[i] = (isFinite(b) ? Math.round(b) : 0) & 0xFF;
      }
      return u;
    }
    return null;
  } catch (e) { return null; }
}

function avMidBe16(u8, pos) { return ((u8[pos] << 8) | u8[pos + 1]) & 0xFFFF; }
function avMidBe32(u8, pos) {
  return (((u8[pos] << 24) | (u8[pos + 1] << 16) | (u8[pos + 2] << 8) | u8[pos + 3]) >>> 0);
}
function avMidStr4(u8, pos) {
  return String.fromCharCode(u8[pos], u8[pos + 1], u8[pos + 2], u8[pos + 3]);
}

function avMidPushStr(out, s) { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xFF); }
function avMidPushBe16(out, v) { out.push((v >> 8) & 0xFF, v & 0xFF); }
function avMidPushBe32(out, v) { out.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF); }

/* SMF variable-length quantity */
function avMidPushVlq(out, v) {
  let n = Math.floor(v);
  if (!(n >= 0)) n = 0;
  if (n > 0x0FFFFFFF) n = 0x0FFFFFFF;
  const buf = [n & 0x7F];
  n = Math.floor(n / 128);
  while (n > 0) { buf.push((n & 0x7F) | 0x80); n = Math.floor(n / 128); }
  for (let i = buf.length - 1; i >= 0; i--) out.push(buf[i]);
}

function avMidPushText(out, s) { avMidPushVlq(out, s.length); avMidPushStr(out, s); }

/* -> {v, next} | null on truncation / more than 4 bytes */
function avMidReadVlq(u8, pos, end) {
  let v = 0;
  for (let i = 0; i < 4; i++) {
    if (pos + i >= end) return null;
    const b = u8[pos + i];
    v = v * 128 + (b & 0x7F);
    if (!(b & 0x80)) return { v: v, next: pos + i + 1 };
  }
  return null;
}

/* note-on velocity, clamp(round(v*127), 1, 127) (§2.3 pin) */
function avMidVel7(v) {
  const n = Math.round((avMidIsNum(v) ? v : AV_MID_VEL_DEF) * 127);
  return n < 1 ? 1 : (n > 127 ? 127 : n);
}

/* ---------- core-shaped defaults (key order must match av_seq_core sanitisation) ---------- */

function avMidStepDefault() {
  return { on: 0, note: "c4", vel: AV_MID_VEL_DEF, gate: AV_MID_GATE_DEF, slide: 0, accent: 0,
           oct: 0, prob: 100, cond: "", ratchet: 1, micro: 0 };
}

function avMidBlankTrack() {
  const steps = [];
  for (let i = 0; i < AV_MID_STEPS; i++) steps.push(avMidStepDefault());
  return { len: AV_MID_LEN_DEF, speed: 1, mute: 0, steps: steps };
}

/* ---------- the quantize law (identical to avSeqCaptureQuantize at q=0) ---------- */

function avMidQuantizeLocal(t, bpm, grid, swing) {
  const stepDur = avMidGridDur(bpm, grid);
  const shift = stepDur * (swing - 50) / 100;
  const k0 = Math.round(t / stepDur);
  let best = k0, bestD = Infinity;
  for (let k = k0 - 2; k <= k0 + 2; k++) {
    const g = k * stepDur + ((k % 2 !== 0) ? shift : 0);
    const d = Math.abs(g - t);
    if (d < bestD) { bestD = d; best = k; }        /* strict < => ties to the EARLIER step */
  }
  if (best < 0) best = 0;
  const gridT = best * stepDur + ((best % 2 !== 0) ? shift : 0);
  const residual = t - gridT;
  const tick = stepDur / AV_MID_TICK_DIV;
  let micro = Math.round(residual / tick);
  if (micro > AV_MID_MICRO_MAX) micro = AV_MID_MICRO_MAX;
  else if (micro < -AV_MID_MICRO_MAX) micro = -AV_MID_MICRO_MAX;
  return { step: best, micro: micro };
}

/* the guarded reuse: the capture kernel (q=0 keeps the full remainder in micro) */
function avMidQuantize(t, bpm, grid, swing) {
  if (typeof avSeqCaptureQuantize === "function") {
    try {
      const q = avSeqCaptureQuantize(t, 0, bpm, grid, swing);
      if (q && typeof q === "object" && avMidIsNum(q.step) && avMidIsNum(q.micro)) {
        return { step: Math.round(q.step), micro: Math.round(q.micro) };
      }
    } catch (e) { /* fall through to the local kernel */ }
  }
  return avMidQuantizeLocal(t, bpm, grid, swing);
}

/* ---------- export ---------- */

function avMidCmpEvents(a, b) {
  const dt = a.tick - b.tick;
  if (dt) return dt;
  if (a.type !== b.type) return (a.type === "off") ? -1 : 1;   /* SMF law: off before on at a tick */
  return a.seq - b.seq;
}

function avMidExport(opts) {
  try {
    const o = (opts && typeof opts === "object" && !Array.isArray(opts)) ? opts : null;
    const snap = o ? o.snap : null;
    if (!snap || typeof snap !== "object" || Array.isArray(snap)) return avMidFail("no pattern snap");
    if (!Array.isArray(snap.tracks)) return avMidFail("no pattern tracks");
    if (typeof avSeqPlan !== "function") return avMidFail("planner unavailable (avSeqPlan)");

    const warnings = [];
    const bpm = avMidClampNum(snap.bpm, AV_MID_BPM_DEF, AV_MID_BPM_MIN, AV_MID_BPM_MAX);
    const tempoTry = Math.round(60000000 / bpm);
    const tempoUs = (tempoTry >= 1 && tempoTry <= 0xFFFFFF) ? tempoTry : AV_MID_TEMPO_DEF;
    const ticksPerSec = (AV_MID_PPQ * (60000000 / tempoUs)) / 60;

    /* trackMask [bool x 4]; absent/invalid -> all selected */
    const mask = [true, true, true, true];
    const srcMask = (o && Array.isArray(o.trackMask)) ? o.trackMask : null;
    let selected = 0;
    for (let i = 0; i < AV_MID_TRACKS; i++) {
      mask[i] = srcMask ? (srcMask[i] ? true : false) : true;
      if (mask[i]) selected++;
    }
    if (selected === 0) warnings.push("no tracks selected");

    const name = avMidAscii(o && o.name != null ? o.name : snap.name, AV_MID_NAME_CAP) || "Anvil pattern";

    /* slide warning scan (literal pin: any step with slide=1 among the first 4 tracks) */
    let slideFound = false;
    for (let ti = 0; ti < snap.tracks.length && ti < AV_MID_TRACKS && !slideFound; ti++) {
      const sts = (snap.tracks[ti] && Array.isArray(snap.tracks[ti].steps)) ? snap.tracks[ti].steps : [];
      for (let i = 0; i < sts.length; i++) {
        const s2 = sts[i];
        if (s2 && typeof s2 === "object" && s2.on && (s2.slide === 1 || s2.slide === true)) {
          slideFound = true;
          break;
        }
      }
    }
    if (slideFound) warnings.push("slide not representable in SMF (v1)");

    /* ONE cycle through the pure planner: fromStep 0..cycleLen in 8-step chunks */
    const cycleLen = avMidCycleLen(snap);
    let rng = avMidSeedNorm(snap.rng);
    const planned = [];
    for (let from = 0; from < cycleLen; from += AV_MID_CHUNK_STEPS) {
      const to = Math.min(cycleLen, from + AV_MID_CHUNK_STEPS);
      const res = avSeqPlan(snap, from, to, 0, rng);
      const evs = (res && Array.isArray(res.events)) ? res.events : [];
      for (let i = 0; i < evs.length; i++) planned.push(evs[i]);
      if (res && avMidIsNum(res.rngNext)) rng = res.rngNext >>> 0;
    }

    /* seconds -> absolute ticks (single rounding per event, deterministic) */
    const events = [];
    const perTrack = [[], [], [], []];
    let noteOns = 0, badNotes = 0, seq = 0;
    for (let i = 0; i < planned.length; i++) {
      const ev = planned[i];
      if (!ev || typeof ev !== "object") continue;
      const ti = Math.round(Number(ev.track));
      if (!(ti >= 0 && ti < AV_MID_TRACKS) || !mask[ti]) continue;
      if (ev.type !== "on" && ev.type !== "off") continue;
      const midi = avMidNoteToMidi(ev.note);
      if (midi == null) { badNotes++; continue; }
      const t = avMidIsNum(ev.t) ? ev.t : 0;
      let tick = Math.round(t * ticksPerSec);
      if (tick < 0) tick = 0;
      const rec = {
        t: t, tick: tick, type: ev.type, midi: midi,
        vel: avMidIsNum(ev.vel) ? ev.vel : 0,
        track: ti, step: avMidClampInt(ev.step, 0, 0, AV_MID_STEPS - 1), seq: seq++,
      };
      perTrack[ti].push(rec);
      events.push({ t: rec.t, tick: rec.tick, type: rec.type, midi: rec.midi, vel: rec.vel,
                    track: rec.track, step: rec.step });
      if (rec.type === "on") noteOns++;
    }
    if (badNotes > 0) warnings.push(badNotes + " note(s) unplayable in SMF skipped");
    if (noteOns === 0) warnings.push("pattern has no audible events");

    /* pair each off with its on (planner pushes pairs; match by note+step, latest open first) */
    for (let ti = 0; ti < AV_MID_TRACKS; ti++) {
      const list = perTrack[ti];
      const openIdx = [];
      for (let i = 0; i < list.length; i++) {
        if (list[i].type === "on") { openIdx.push(i); continue; }
        let at = -1;
        for (let j = openIdx.length - 1; j >= 0; j--) {
          const cand = list[openIdx[j]];
          if (cand.midi === list[i].midi && cand.step === list[i].step) { at = j; break; }
        }
        const on = (at >= 0) ? list[openIdx.splice(at, 1)[0]] : null;
        if (on && list[i].tick <= on.tick) list[i].tick = on.tick + 1;   /* >= 1 tick long */
      }
    }

    /* chunk assembly */
    const chunks = [];
    const con = [];
    avMidPushVlq(con, 0);
    con.push(0xFF, 0x03);
    avMidPushText(con, name);
    avMidPushVlq(con, 0);
    con.push(0xFF, 0x51, 0x03, (tempoUs >> 16) & 0xFF, (tempoUs >> 8) & 0xFF, tempoUs & 0xFF);
    avMidPushVlq(con, 0);
    con.push(0xFF, 0x2F, 0x00);
    chunks.push(con);

    let outTracks = 1;
    for (let ti = 0; ti < AV_MID_TRACKS; ti++) {
      if (!mask[ti]) continue;
      outTracks++;
      const list = perTrack[ti];
      list.sort(avMidCmpEvents);
      const data = [];
      avMidPushVlq(data, 0);
      data.push(0xFF, 0x03);
      avMidPushText(data, "T" + (ti + 1));
      let cur = 0;
      const ch = ti & 0x0F;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        let d = e.tick - cur;
        if (d < 0) d = 0;
        avMidPushVlq(data, d);
        cur = e.tick;
        if (e.type === "on") data.push(0x90 | ch, e.midi, avMidVel7(e.vel));
        else data.push(0x80 | ch, e.midi, AV_MID_REL_VEL);
      }
      avMidPushVlq(data, 0);
      data.push(0xFF, 0x2F, 0x00);
      chunks.push(data);
    }

    const out = [];
    avMidPushStr(out, "MThd");
    avMidPushBe32(out, 6);
    avMidPushBe16(out, 1);                       /* format 1 */
    avMidPushBe16(out, outTracks);
    avMidPushBe16(out, AV_MID_PPQ);
    for (let i = 0; i < chunks.length; i++) {
      avMidPushStr(out, "MTrk");
      avMidPushBe32(out, chunks[i].length);
      for (let j = 0; j < chunks[i].length; j++) out.push(chunks[i][j] & 0xFF);
    }
    const u8 = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) u8[i] = out[i] & 0xFF;

    return {
      ok: true, bytes: u8.buffer, events: events,
      format: 1, ppq: AV_MID_PPQ, tracks: outTracks, noteCount: noteOns, cycleLen: cycleLen,
      warnings: warnings,
    };
  } catch (e) { return avMidFail("export failed (" + avMidErrText(e) + ")"); }
}

/* ---------- parse ---------- */

/* seconds at an absolute tick through the tempo map [{tick, us}] (sorted, asc) */
function avMidSecAt(tick, map, ppq) {
  if (!(tick > 0)) return 0;
  let sec = 0, prev = 0, us = AV_MID_TEMPO_DEF;
  for (let i = 0; i < map.length; i++) {
    const m = map[i];
    if (m.tick >= tick) break;
    if (m.tick > prev) {
      sec += (m.tick - prev) * us / (ppq * 1000000);
      prev = m.tick;
    }
    us = m.us;
  }
  sec += (tick - prev) * us / (ppq * 1000000);
  return sec;
}

/* -> track object | null on malformed data */
function avMidParseTrack(u8, start, end, index, warnings, tempoOut) {
  let pos = start, tick = 0, status = 0, seq = 0;
  let name = "";
  const open = [];
  const notes = [];
  let unpairedOff = 0;

  while (pos < end) {
    const d = avMidReadVlq(u8, pos, end);
    if (!d) return null;
    tick += d.v;
    pos = d.next;
    if (pos >= end) return null;
    const b = u8[pos];

    if (b === 0xFF) {                                     /* meta */
      pos++;
      if (pos >= end) return null;
      const type = u8[pos];
      pos++;
      const len = avMidReadVlq(u8, pos, end);
      if (!len) return null;
      const dstart = len.next, dend = dstart + len.v;
      if (dend > end) return null;
      if (type === 0x51 && len.v >= 3) {
        const us = (((u8[dstart] << 16) | (u8[dstart + 1] << 8) | u8[dstart + 2]) >>> 0) || AV_MID_TEMPO_DEF;
        tempoOut.push({ tick: tick, us: us, ti: index, seq: seq++ });
      } else if (type === 0x03) {
        if (!name) name = avMidTextFromBytes(u8, dstart, dend, AV_MID_NAME_CAP);
      } else if (type === 0x2F) {
        pos = dend;
        break;                                            /* end of track */
      }
      pos = dend;
    } else if (b === 0xF0 || b === 0xF7) {                /* sysex: skip by length */
      pos++;
      const len = avMidReadVlq(u8, pos, end);
      if (!len) return null;
      pos = len.next + len.v;
      if (pos > end) return null;
    } else if (b >= 0xF0) {
      return null;                                        /* F1..F6 / F8..FE: not a file event */
    } else {                                              /* channel event (running status aware) */
      let statusByte = status;
      if (b >= 0x80) { statusByte = b; status = b; pos++; }
      else if (!(status >= 0x80 && status < 0xF0)) return null;
      const hi = statusByte & 0xF0, ch = statusByte & 0x0F;
      const need = (hi === 0xC0 || hi === 0xD0) ? 1 : 2;
      if (pos + need > end) return null;
      const d1 = u8[pos] & 0x7F;
      const d2 = need > 1 ? (u8[pos + 1] & 0x7F) : 0;
      pos += need;
      if (hi === 0x90 && d2 > 0) {
        open.push({ midi: d1, vel: d2, channel: ch, tick: tick });
      } else if (hi === 0x80 || hi === 0x90) {            /* note-off, or note-on with vel 0 */
        let at = -1;
        for (let i = 0; i < open.length; i++) {           /* FIFO per channel+note */
          if (open[i].midi === d1 && open[i].channel === ch) { at = i; break; }
        }
        if (at < 0) unpairedOff++;
        else {
          const op = open.splice(at, 1)[0];
          notes.push({ midi: op.midi, vel: op.vel, tick: op.tick, durTicks: tick - op.tick, channel: ch });
        }
      }
      /* other channel messages are consumed and ignored (CC, bend, aftertouch, program) */
    }
  }

  if (open.length > 0) warnings.push("track " + index + ": " + open.length + " unpaired note-on(s) dropped");
  if (unpairedOff > 0) warnings.push("track " + index + ": " + unpairedOff + " unpaired note-off(s) ignored");
  return { index: index, name: name, noteCount: notes.length, notes: notes };
}

function avMidParse(bytes) {
  try {
    const u8 = avMidToU8(bytes);
    if (!u8) return avMidFail("bytes required");
    const n = u8.length;
    const warnings = [];
    if (n < 14) return avMidFail("too short", warnings);
    if (avMidStr4(u8, 0) !== "MThd") return avMidFail("missing MThd magic", warnings);
    const hlen = avMidBe32(u8, 4);
    if (hlen < 6) return avMidFail("bad header length", warnings);
    if (8 + hlen > n) return avMidFail("truncated header", warnings);
    const format = avMidBe16(u8, 8);
    if (format > 2) return avMidFail("unsupported format " + format, warnings);
    const ntrks = avMidBe16(u8, 10);
    const division = avMidBe16(u8, 12);
    if (division & 0x8000) return avMidFail("SMPTE time division unsupported", warnings);
    if (division < 1) return avMidFail("bad time division", warnings);
    const ppq = division;

    let pos = 8 + hlen;
    const tracks = [];
    const tempoRaw = [];
    let guard = 0;
    while (tracks.length < ntrks && pos < n) {
      if (guard++ > 4096) return avMidFail("too many chunks", warnings);
      if (pos + 8 > n) return avMidFail("truncated chunk header", warnings);
      const id = avMidStr4(u8, pos);
      const clen = avMidBe32(u8, pos + 4);
      if (clen > n - (pos + 8)) return avMidFail("truncated chunk data", warnings);
      const start = pos + 8, end = start + clen;
      if (id === "MTrk") {
        const tr = avMidParseTrack(u8, start, end, tracks.length, warnings, tempoRaw);
        if (!tr) return avMidFail("malformed track " + tracks.length, warnings);
        tracks.push(tr);
      } else {
        warnings.push("chunk '" + avMidAscii(id, 8) + "' skipped");
      }
      pos = end;
    }
    if (tracks.length < ntrks) return avMidFail("missing MTrk chunk(s)", warnings);
    if (pos < n) warnings.push("trailing bytes ignored");

    /* global tempo map: sort, first event wins ties */
    tempoRaw.sort(function (a, b) { return (a.tick - b.tick) || (a.ti - b.ti) || (a.seq - b.seq); });
    const map = [];
    for (let i = 0; i < tempoRaw.length; i++) {
      if (!map.length || map[map.length - 1].tick !== tempoRaw[i].tick) {
        map.push({ tick: tempoRaw[i].tick, us: tempoRaw[i].us });
      }
    }
    if (!map.length) warnings.push("no tempo event: 120 bpm assumed");
    else if (map.length > 1) warnings.push("tempo map: " + map.length + " segments applied");
    const tempoUs = map.length ? map[0].us : AV_MID_TEMPO_DEF;
    const bpm = Math.round((60000000 / tempoUs) * 1000) / 1000;

    let noteCount = 0;
    for (let ti = 0; ti < tracks.length; ti++) {
      const notes = tracks[ti].notes;
      for (let i = 0; i < notes.length; i++) {
        const nt = notes[i];
        nt.tSec = avMidSecAt(nt.tick, map, ppq);
        nt.durSec = avMidSecAt(nt.tick + nt.durTicks, map, ppq) - nt.tSec;
      }
      noteCount += notes.length;
    }

    return {
      ok: true, format: format, ppq: ppq, bpm: bpm, tempoUs: tempoUs,
      trackCount: tracks.length, tracks: tracks, noteCount: noteCount, warnings: warnings,
    };
  } catch (e) { return avMidFail("parse failed (" + avMidErrText(e) + ")"); }
}

/* ---------- pattern mapping ---------- */

function avMidToPattern(parsed, opts) {
  try {
    const p = (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : null;
    if (!p || p.ok === false) return avMidFail("no parsed result");
    const srcTracks = Array.isArray(p.tracks) ? p.tracks : null;
    if (!srcTracks) return avMidFail("no tracks in parsed result");
    const o = (opts && typeof opts === "object" && !Array.isArray(opts)) ? opts : null;
    const warnings = [];

    const bpmV = (avMidIsNum(p.tempoUs) && p.tempoUs > 0)
      ? (60000000 / p.tempoUs)
      : avMidClampNum(p.bpm, AV_MID_BPM_DEF, AV_MID_BPM_MIN, AV_MID_BPM_MAX);
    const ppq = avMidClampInt(p.ppq, AV_MID_PPQ, 1, 32767);
    const swing = Math.round(avMidClampNum(o ? o.swing : null, AV_MID_SWING_DEF, AV_MID_SWING_MIN, AV_MID_SWING_MAX));
    const stepDur = avMidGridDur(bpmV, "16");
    const secPerTick = 60 / (bpmV * ppq);

    /* candidates: the first 4 tracks (index order) carrying >= 1 paired note */
    const cands = [];
    for (let i = 0; i < srcTracks.length; i++) {
      const tr = srcTracks[i];
      const notes = (tr && Array.isArray(tr.notes)) ? tr.notes : [];
      if (notes.length > 0) cands.push(tr);
    }
    if (cands.length > AV_MID_TRACKS) {
      warnings.push((cands.length - AV_MID_TRACKS) + " track(s) beyond the first 4 dropped");
      cands.length = AV_MID_TRACKS;
    }

    const tracks = [];
    for (let t = 0; t < AV_MID_TRACKS; t++) tracks.push(avMidBlankTrack());

    let mapped = 0, dropped = 0, merged = 0;
    for (let c = 0; c < cands.length; c++) {
      const notes = cands[c].notes;
      const tr = tracks[c];
      const used = {};
      let maxIdx = -1;
      for (let i = 0; i < notes.length; i++) {
        const nt = notes[i];
        if (!nt || typeof nt !== "object") continue;
        const tSec = avMidIsNum(nt.tSec) ? nt.tSec : (avMidIsNum(nt.tick) ? nt.tick * secPerTick : null);
        if (tSec == null) continue;
        const qz = avMidQuantize(tSec, bpmV, "16", swing);
        if (!qz) continue;
        if (qz.step < 0 || qz.step >= AV_MID_STEPS) { dropped++; continue; }
        if (used[qz.step]) { merged++; continue; }         /* first hit wins (one note per step) */
        used[qz.step] = 1;
        const st = tr.steps[qz.step];
        st.on = 1;
        st.note = avMidMidiToNote(nt.midi) || "c4";
        st.vel = avMidClampNum(avMidIsNum(nt.vel) ? nt.vel / 127 : AV_MID_VEL_DEF, AV_MID_VEL_DEF, AV_MID_VEL_MIN, 1);
        const durSec = avMidIsNum(nt.durSec) ? nt.durSec : (avMidIsNum(nt.durTicks) ? nt.durTicks * secPerTick : -1);
        st.gate = (durSec >= 0)
          ? avMidClampNum(durSec / stepDur, AV_MID_GATE_DEF, AV_MID_GATE_MIN, 1)
          : AV_MID_GATE_DEF;
        st.micro = qz.micro;
        mapped++;
        if (qz.step > maxIdx) maxIdx = qz.step;
      }
      if (maxIdx >= 0) tr.len = Math.min(AV_MID_STEPS, Math.max(AV_MID_LEN_DEF, maxIdx + 1));
    }

    if (dropped > 0) warnings.push(dropped + " note(s) beyond 64 steps dropped");
    if (merged > 0) warnings.push(merged + " duplicate note(s) merged (first hit wins)");
    if (mapped === 0) return avMidFail("no notes", warnings);

    let name = avMidAscii(o && o.name != null ? o.name : (srcTracks[0] ? srcTracks[0].name : ""), AV_MID_PATNAME_CAP);
    if (!name) name = "PAT 1";

    const pattern = {
      v: 1, name: name,
      bpm: avMidClampInt(bpmV, AV_MID_BPM_DEF, AV_MID_BPM_MIN, AV_MID_BPM_MAX),
      grid: "16",
      swing: swing,
      tracks: tracks,
      plocks: [],
      rng: AV_MID_RNG_DEF,
    };
    return { ok: true, pattern: pattern, warnings: warnings };
  } catch (e) { return avMidFail("pattern mapping failed (" + avMidErrText(e) + ")"); }
}

/* ============================================================================================
   M2 · SONG ARRANGEMENT EXPORT — avMidExportSong (verify/_m2_wave.md §2.6, owner sa-F).
   ADDITIVE appendix: nothing above this line is touched; avMidExport's pins (format 1, PPQ 480,
   step 120/160 ticks, the planner event builder, the writer primitives) are reused verbatim.

   avMidExportSong({snap, song:{v,rows}, name, trackMask?}) -> {ok, bytes, rows, noteCount, steps,
   format, ppq, tracks, events, warnings} | {ok:false, error, warnings}

   - SMF format 1, PPQ 480 (the module's pins). Track 0 = the song name + per-row tempo metas and
     row markers (name meta, text = row.label || row.ref) at each row's absolute start tick;
     tracks 1..4 = the seq tracks (trackMask-filtered; channel = seq track index), exactly the
     avMidExport writer law (deltas, vel7, off-before-on at a tick, EOT).
   - Rows expand contiguously: L = row.len || avSeqSchedCycleLen() (guarded; floor 16; the
     module's own avMidCycleLen(snap) is the snap fallback), R = repeats 1..256. Row r starts at
     absTick = Σ L×R of the rows before it × the grid's ticks per step (PPQ/4 = 120 for "16",
     PPQ/3 = 160 for "8t").
   - Row-local events via the existing avSeqPlan-based builder: each row plans [0, span) in the
     module's 8-step chunks with a row snap (bpm = row.tempo || snap.bpm; track mutes = the ROW's
     mutes, so a muted row-track combo emits nothing for that row — matching the runner, which
     loads the row mutes verbatim), absolute seconds (origin 0 = row-local) × the row's
     ticksPerSec + rowStartTick, single rounding, negative clamped to the row start. The RNG
     threads ONE stream across rows in order (same seed ⇒ same bytes).
   - Cap: Σ L×R ≤ 20000 grid steps; beyond → the arrangement is truncated at exactly 20000 steps
     (the straddling row is cut) + the warning "arrangement truncated at 20000 steps".
   - Deterministic; honest fail shapes like avMidExport ({ok:false, error, warnings} always).
   ============================================================================================ */

const AV_MID_SONG_STEP_CAP = 20000;     /* Σ L×R grid steps cap (§2.6) */
const AV_MID_SONG_REP_MAX = 256;        /* = core AV_SEQ_SONG_REPEAT_MAX */
const AV_MID_SONG_LEN_MAX = 1024;       /* = core AV_SEQ_ROW_LEN_MAX */
const AV_MID_SONG_LEN_FLOOR = 16;       /* = avSeqSchedCycleLen's floor */

/* row mutes -> 0|1 x4 ("0"/0/false/null => 0, else 1 — the core avSeqBit collapse for this field) */
function avMidSongBit(v) {
  if (v === "0" || v === 0 || v === false || v == null) return 0;
  return v ? 1 : 0;
}

function avMidSongMutes(src) {
  const out = [0, 0, 0, 0];
  const m = Array.isArray(src) ? src : [];
  for (let t = 0; t < AV_MID_TRACKS; t++) out[t] = avMidSongBit(m[t]);
  return out;
}

/* L = row.len (1..1024) || avSeqSchedCycleLen() (guarded; floor 16) || avMidCycleLen(snap) */
function avMidSongRowLen(v, snap) {
  const n = Math.round(Number(v));
  if (isFinite(n) && n >= 1) return n > AV_MID_SONG_LEN_MAX ? AV_MID_SONG_LEN_MAX : n;
  try {
    if (typeof avSeqSchedCycleLen === "function") {
      const d = Math.round(Number(avSeqSchedCycleLen()));
      if (isFinite(d) && d >= AV_MID_SONG_LEN_FLOOR) return d > AV_MID_SONG_LEN_MAX ? AV_MID_SONG_LEN_MAX : d;
    }
  } catch (e) { /* fall through to the snap law */ }
  return avMidCycleLen(snap);
}

/* row.tempo 0 = inherit (snap.bpm); else round-clamp 20..300 */
function avMidSongRowTempo(v) {
  const n = Number(v);
  if (v == null || v === "" || !isFinite(n) || n <= 0) return 0;
  return avMidClampInt(n, 0, AV_MID_BPM_MIN, AV_MID_BPM_MAX);
}

/* the row's planner view: shallow snap copy, bpm = the row tempo, track mutes = the row's */
function avMidSongRowSnap(snap, bpm, mutes) {
  const rs = {};
  for (const k in snap) {
    if (Object.prototype.hasOwnProperty.call(snap, k)) rs[k] = snap[k];
  }
  rs.bpm = bpm;
  const src = Array.isArray(snap.tracks) ? snap.tracks : [];
  const tracks = [];
  for (let t = 0; t < AV_MID_TRACKS; t++) {
    const tr = (src[t] && typeof src[t] === "object") ? src[t] : null;
    tracks.push(tr ? { len: tr.len, speed: tr.speed, mute: mutes[t] ? 1 : 0, steps: tr.steps } : null);
  }
  rs.tracks = tracks;
  return rs;
}

function avMidExportSong(opts) {
  try {
    const o = (opts && typeof opts === "object" && !Array.isArray(opts)) ? opts : null;
    const snap = o ? o.snap : null;
    if (!snap || typeof snap !== "object" || Array.isArray(snap)) return avMidFail("no pattern snap");
    if (!Array.isArray(snap.tracks)) return avMidFail("no pattern tracks");
    const song = o ? o.song : null;
    const rowsRaw = (song && typeof song === "object" && !Array.isArray(song) && Array.isArray(song.rows))
      ? song.rows : null;
    if (!rowsRaw || rowsRaw.length === 0) return avMidFail("no song rows");
    if (typeof avSeqPlan !== "function") return avMidFail("planner unavailable (avSeqPlan)");

    const warnings = [];
    const snapBpm = avMidClampNum(snap.bpm, AV_MID_BPM_DEF, AV_MID_BPM_MIN, AV_MID_BPM_MAX);
    const ticksPerStep = (snap.grid === "8t") ? (AV_MID_PPQ / 3) : (AV_MID_PPQ / 4);   /* 160 / 120 */

    /* trackMask [bool x 4]; absent/invalid -> all selected (the avMidExport law) */
    const mask = [true, true, true, true];
    const srcMask = (o && Array.isArray(o.trackMask)) ? o.trackMask : null;
    let selected = 0;
    for (let i = 0; i < AV_MID_TRACKS; i++) {
      mask[i] = srcMask ? (srcMask[i] ? true : false) : true;
      if (mask[i]) selected++;
    }
    if (selected === 0) warnings.push("no tracks selected");

    const name = avMidAscii(o && o.name != null ? o.name : snap.name, AV_MID_NAME_CAP) || "Anvil song";

    /* slide warning scan (the avMidExport literal pin, over the same first-4 tracks) */
    let slideFound = false;
    for (let ti = 0; ti < snap.tracks.length && ti < AV_MID_TRACKS && !slideFound; ti++) {
      const sts = (snap.tracks[ti] && Array.isArray(snap.tracks[ti].steps)) ? snap.tracks[ti].steps : [];
      for (let i = 0; i < sts.length; i++) {
        const s2 = sts[i];
        if (s2 && typeof s2 === "object" && s2.on && (s2.slide === 1 || s2.slide === true)) {
          slideFound = true;
          break;
        }
      }
    }
    if (slideFound) warnings.push("slide not representable in SMF (v1)");

    /* rows normalised (markers + spans); junk entries dropped */
    const rows = [];
    for (let i = 0; i < rowsRaw.length; i++) {
      const r = rowsRaw[i];
      if (!r || typeof r !== "object" || Array.isArray(r)) continue;
      const ref = avMidAscii(r.ref != null ? r.ref : (r.pattern != null ? r.pattern : ""), AV_MID_PATNAME_CAP)
        || ("ROW " + (rows.length + 1));
      rows.push({
        ref: ref,
        label: avMidAscii(r.label, AV_MID_NAME_CAP),
        repeats: avMidClampInt(r.repeats, 1, 1, AV_MID_SONG_REP_MAX),
        mutes: avMidSongMutes(r.mutes),
        len: avMidSongRowLen(r.len, snap),
        tempo: avMidSongRowTempo(r.tempo),
      });
    }
    if (rows.length === 0) return avMidFail("no song rows");

    /* the cap walk: Σ L×R ≤ 20000; the straddling row is cut at the cap (warning once) */
    let total = 0, truncated = false;
    const spans = [];
    for (let i = 0; i < rows.length && !truncated; i++) {
      let span = rows[i].len * rows[i].repeats;
      const rem = AV_MID_SONG_STEP_CAP - total;
      if (span > rem) { span = rem; truncated = true; }
      if (span <= 0) { truncated = true; break; }
      spans.push(span);
      total += span;
    }
    rows.length = spans.length;
    if (truncated) warnings.push("arrangement truncated at 20000 steps");

    /* plan each row (8-step chunks, row-local seconds -> abs ticks); ONE rng across the song */
    const events = [];
    const perTrack = [[], [], [], []];
    const rowTick = [];
    const rowTempoUs = [];
    let noteOns = 0, badNotes = 0, seq = 0;
    let rng = avMidSeedNorm(snap.rng);
    let rowStartTick = 0;
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const span = spans[ri];
      const effBpm = (row.tempo > 0) ? row.tempo : snapBpm;
      const tempoTry = Math.round(60000000 / effBpm);
      const tempoUs = (tempoTry >= 1 && tempoTry <= 0xFFFFFF) ? tempoTry : AV_MID_TEMPO_DEF;
      const ticksPerSec = (AV_MID_PPQ * (60000000 / tempoUs)) / 60;
      rowTick.push(rowStartTick);
      rowTempoUs.push(tempoUs);
      const rowSnap = avMidSongRowSnap(snap, effBpm, row.mutes);
      for (let from = 0; from < span; from += AV_MID_CHUNK_STEPS) {
        const to = Math.min(span, from + AV_MID_CHUNK_STEPS);
        const res = avSeqPlan(rowSnap, from, to, 0, rng);
        const evs = (res && Array.isArray(res.events)) ? res.events : [];
        for (let i = 0; i < evs.length; i++) {
          const ev = evs[i];
          if (!ev || typeof ev !== "object") continue;
          const ti = Math.round(Number(ev.track));
          if (!(ti >= 0 && ti < AV_MID_TRACKS) || !mask[ti]) continue;
          if (ev.type !== "on" && ev.type !== "off") continue;
          const midi = avMidNoteToMidi(ev.note);
          if (midi == null) { badNotes++; continue; }
          const t = avMidIsNum(ev.t) ? ev.t : 0;
          let local = Math.round(t * ticksPerSec);
          if (local < 0) local = 0;                       /* a negative-micro row head pins to its start */
          const rec = {
            t: t, tick: rowStartTick + local, type: ev.type, midi: midi,
            vel: avMidIsNum(ev.vel) ? ev.vel : 0,
            track: ti, step: avMidClampInt(ev.step, 0, 0, AV_MID_STEPS - 1), seq: seq++,
          };
          perTrack[ti].push(rec);
          events.push({ t: rec.t, tick: rec.tick, type: rec.type, midi: rec.midi, vel: rec.vel,
                        track: rec.track, step: rec.step });
          if (rec.type === "on") noteOns++;
        }
        if (res && avMidIsNum(res.rngNext)) rng = res.rngNext >>> 0;
      }
      rowStartTick += span * ticksPerStep;
    }
    if (badNotes > 0) warnings.push(badNotes + " note(s) unplayable in SMF skipped");
    if (noteOns === 0) warnings.push("pattern has no audible events");

    /* pair each off with its on (the avMidExport law: note+step, latest open first, >= 1 tick) */
    for (let ti = 0; ti < AV_MID_TRACKS; ti++) {
      const list = perTrack[ti];
      const openIdx = [];
      for (let i = 0; i < list.length; i++) {
        if (list[i].type === "on") { openIdx.push(i); continue; }
        let at = -1;
        for (let j = openIdx.length - 1; j >= 0; j--) {
          const cand = list[openIdx[j]];
          if (cand.midi === list[i].midi && cand.step === list[i].step) { at = j; break; }
        }
        const on = (at >= 0) ? list[openIdx.splice(at, 1)[0]] : null;
        if (on && list[i].tick <= on.tick) list[i].tick = on.tick + 1;   /* >= 1 tick long */
      }
    }

    /* conductor: song name + per-row tempo metas + row markers at their absolute ticks */
    const con = [];
    avMidPushVlq(con, 0);
    con.push(0xFF, 0x03);
    avMidPushText(con, name);
    let cur = 0;
    for (let ri = 0; ri < rows.length; ri++) {
      const tk = rowTick[ri];
      const us = rowTempoUs[ri];
      let d = tk - cur;
      if (d < 0) d = 0;
      avMidPushVlq(con, d);
      con.push(0xFF, 0x51, 0x03, (us >> 16) & 0xFF, (us >> 8) & 0xFF, us & 0xFF);
      avMidPushVlq(con, 0);
      con.push(0xFF, 0x03);
      avMidPushText(con, rows[ri].label || rows[ri].ref);
      cur = tk;
    }
    avMidPushVlq(con, 0);
    con.push(0xFF, 0x2F, 0x00);
    const chunks = [con];

    /* one MIDI track per selected seq track (same writer law as avMidExport) */
    let outTracks = 1;
    for (let ti = 0; ti < AV_MID_TRACKS; ti++) {
      if (!mask[ti]) continue;
      outTracks++;
      const list = perTrack[ti];
      list.sort(avMidCmpEvents);
      const data = [];
      avMidPushVlq(data, 0);
      data.push(0xFF, 0x03);
      avMidPushText(data, "T" + (ti + 1));
      let cur2 = 0;
      const ch = ti & 0x0F;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        let d2 = e.tick - cur2;
        if (d2 < 0) d2 = 0;
        avMidPushVlq(data, d2);
        cur2 = e.tick;
        if (e.type === "on") data.push(0x90 | ch, e.midi, avMidVel7(e.vel));
        else data.push(0x80 | ch, e.midi, AV_MID_REL_VEL);
      }
      avMidPushVlq(data, 0);
      data.push(0xFF, 0x2F, 0x00);
      chunks.push(data);
    }

    const out = [];
    avMidPushStr(out, "MThd");
    avMidPushBe32(out, 6);
    avMidPushBe16(out, 1);                       /* format 1 */
    avMidPushBe16(out, outTracks);
    avMidPushBe16(out, AV_MID_PPQ);
    for (let i = 0; i < chunks.length; i++) {
      avMidPushStr(out, "MTrk");
      avMidPushBe32(out, chunks[i].length);
      for (let j = 0; j < chunks[i].length; j++) out.push(chunks[i][j] & 0xFF);
    }
    const u8 = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) u8[i] = out[i] & 0xFF;

    return {
      ok: true, bytes: u8.buffer, events: events, format: 1, ppq: AV_MID_PPQ, tracks: outTracks,
      rows: rows.length, noteCount: noteOns, steps: total, warnings: warnings,
    };
  } catch (e) { return avMidFail("song export failed (" + avMidErrText(e) + ")"); }
}
