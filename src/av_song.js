/* av_song.js — Anvil M2 ARRANGER (verify/_m2_wave.md §2.6, owner sa-F): the song runner, the
   quantised scene recall and the song JSON export/import. Sibling of src/av_seq_core.js (song
   rows, scenes) and src/av_seq_sched.js (the transport + avSeqPosition's monotonic grid-step
   counter); the SMF side lives in src/av_mid.js (avMidExportSong — appended there by the same
   child; one writer per file, ever).

   WHAT THIS FILE IS
   - avSongPlay() -> {ok:true} | {ok:false, error}
       "no rows" when avSeqSongSnap().rows is empty; "already playing" when the runner is live;
       "transport refused" when the scheduler cannot start (or is absent). Otherwise starts (or
       adopts a running) transport, freezes the arrangement at play, applies ROW 0 AT START and
       starts the runner at a 25 ms interval.
   - avSongStop() -> bool — stops the runner + avSeqStop() (guarded); true when something stopped.
   - avSongIsPlaying() -> bool · avSongStatus() -> {playing, row, repeat, rows, quant, queued,
     step}. row/repeat are 0-based (−1 idle; repeat = the current pass inside the current row);
     step = the last observed monotonic transport grid step.
   - ROW WALK (v1): L = row.len || avSeqSchedCycleLen() (guarded; floor 16), R = row.repeats;
     rows are contiguous. The runner advances at song-relative grid-step boundaries derived from
     avSeqPosition().step — the scheduler's MONOTONIC grid-step counter since origin (−1 when
     stopped); the step observed at play is the base (0 on a fresh transport). Entering a row
     applies it: mutes via ONE avSeqSnap → set the 4 track mutes → avSeqLoad (guarded; repaint
     via avSeqUiSync, guarded); tempo (row.tempo > 0) via avApplyParam("bpm", t) (guarded). The
     arrangement is FROZEN at play (mid-run row edits apply on the next play — v1 pin). Past the
     last row's completion the runner AUTO-STOPS (transport included). The runner also dies with
     its transport: a tick that sees avSeqIsPlaying() !== true halts the runner (guarded probe).
   - RUNNER vs UNDO: runner-applied mutes/tempo NEVER push undo (transport-driven — the P4 law
     covers user edits; the §5 watch-out). Scene recalls APPLIED BY THE RUNNER push
     avUndoPush("seq","scene") themselves, exactly ONCE per applied recall, AFTER the apply
     (guarded). A recall the core refuses applies nothing and pushes nothing.
   - avSongSceneRecall(name, quant) -> {ok, at} — quant "instant"|"beat"|"cycle" (def "beat"; an
     explicit valid quant also becomes the stored default reported by status().quant — the UI
     select feeds it through this call). Transport stopped → immediate avSeqSceneRecall (guarded)
     + the ONE checkpoint AFTER. Playing → queue (ONE queued at a time — a new request replaces);
     the recall applies on a runner tick: instant = the next tick, beat = next step ≡ 0 (mod 4)
     boundary, cycle = next cycleLen boundary (both strictly after the observed step). at = the
     absolute grid step of the apply (−1 when applied immediately on an idle transport). A queued
     recall lands AFTER any row apply observed at the same step (the user request wins).
   - SONG JSON: avSongExportJson() -> string `{v:1, name, bpm, grid, rows, pattern}` — pattern is
     the P4 §4 export object of the LIVE pattern (avSeqPatternExport, guarded; avSeqSnap
     fallback). "" when the core pattern source is unreachable. avSongImportJson(str) -> bool —
     rows via avSeqSongLoad, then `pattern` (when present) via avSeqLoad + avUndoPush("seq")
     AFTER (the literal §2.6 call; avUndoLabel then defaults the label to the domain). Refuses
     foreign versions/anything malformed; never throws.
   - avSongExportMidi(opts) -> {ok, bytes, rows, noteCount, warnings} — calls avMidExportSong
     ({snap: avSeqSnap(), song: avSeqSongSnap(), name, trackMask?}) guarded; pass-through result.
   - avSongSnap() -> {v, version, playing, row, repeat, rows, quant, queued, step, rowApplies,
     recalls} (the evidence surface).

   LAWS kept: "use strict"; ONE namespace (avSong* / AV_SONG_*; no module syntax); classic script
   (no imports); NO DOM at load — the only top-level browser touch is the guarded `typeof window`
   publish at the end (window.__avSong, version "m2.0"); every foreign reach (avSeqSongSnap/Load,
   avSeqSnap/Load, avSeqPlay/Stop/IsPlaying/Position, avSeqSchedCycleLen, avSeqSceneRecall,
   avSeqPatternExport, avSeqUiSync, avApplyParam, avUndoPush, avMidExportSong, setInterval) is
   typeof-guarded inside a function; never throws (honest refusals); deterministic (same observed
   steps ⇒ same applies).

   Song rows v1: every row references the LIVE pattern (single bank — refs recorded, resolution
   deferred; the JSON export carries the pattern it speaks about). Harness:
   cache/scratch/m2/song/harness.mjs (ALL-PASS line `SONG-HARNESS: n/n PASS`).                  */

"use strict";

/* ---------- pins ---------- */

const AV_SONG_VERSION = "m2.0";
const AV_SONG_WAKE_MS = 25;                 /* runner cadence (§2.6 pin: interval 25 ms) */
const AV_SONG_TRACKS = 4;                   /* = core AV_SEQ_TRACKS */
const AV_SONG_BEAT_STEPS = 4;               /* beat boundary: step ≡ 0 (mod 4) — the §2.6 pin */
const AV_SONG_QUANTS = ["instant", "beat", "cycle"];
const AV_SONG_QUANT_DEF = "beat";
const AV_SONG_LEN_FLOOR = 16;               /* avSeqSchedCycleLen floor */
const AV_SONG_LEN_MAX = 1024;               /* = core AV_SEQ_ROW_LEN_MAX */
const AV_SONG_REP_MAX = 256;                /* = core AV_SEQ_SONG_REPEAT_MAX */
const AV_SONG_TEMPO_MIN = 20;               /* = core AV_SEQ_BPM_MIN */
const AV_SONG_TEMPO_MAX = 300;              /* = core AV_SEQ_BPM_MAX */

/* ---------- the runner state (single source of truth) ---------- */

let avSongTimer = null;                     /* interval id | null */
let avSongPlaying = false;                  /* the runner flag (avSongIsPlaying) */
let avSongRows = [];                        /* frozen working rows for the current run */
let avSongLens = [];                        /* resolved L per row */
let avSongSpans = [];                       /* L×R per row */
let avSongTotal = 0;                        /* Σ L×R (the arrangement length in grid steps) */
let avSongRow = -1;                         /* current row index; −1 idle */
let avSongRowStart = 0;                     /* first song-relative step of the current row */
let avSongBaseStep = 0;                     /* transport step at play (0 on a fresh transport) */
let avSongStep = -1;                        /* last observed monotonic transport step */
let avSongQuant = AV_SONG_QUANT_DEF;        /* the stored recall default */
let avSongPending = null;                   /* {name, quant, at} | null — ONE queued recall */
let avSongRowApplies = 0;                   /* evidence: rows applied since module load */
let avSongRecalls = 0;                      /* evidence: recalls APPLIED since module load */

/* ---------- small value laws (never throw) ---------- */

function avSongIsNum(v) { return typeof v === "number" && isFinite(v); }

function avSongClampInt(v, dflt, lo, hi) {
  const n = Number(v);
  if (v == null || v === "" || !isFinite(n)) return dflt;
  const r = Math.round(n);
  return r < lo ? lo : (r > hi ? hi : r);
}

/* quant normalisation: an exact member or "" (invalid ⇒ treated as absent) */
function avSongQuantNorm(q) {
  if (typeof q !== "string") return "";
  const s = q.trim().toLowerCase();
  for (let i = 0; i < AV_SONG_QUANTS.length; i++) {
    if (AV_SONG_QUANTS[i] === s) return s;
  }
  return "";
}

/* ---------- row law (the §2.6 pins, over foreign-shaped rows — never throws) ---------- */

/* L = row.len (1..1024) || avSeqSchedCycleLen() (guarded; floor 16) */
function avSongRowLenOf(row) {
  const n = Math.round(Number(row ? row.len : 0));
  if (isFinite(n) && n >= 1) return n > AV_SONG_LEN_MAX ? AV_SONG_LEN_MAX : n;
  let len = AV_SONG_LEN_FLOOR;
  try {
    if (typeof avSeqSchedCycleLen === "function") {
      const d = Math.round(Number(avSeqSchedCycleLen()));
      if (isFinite(d) && d >= AV_SONG_LEN_FLOOR) len = d;
    }
  } catch (e) { /* the floor stands */ }
  return len;
}

function avSongRowRepeatOf(row) {
  return avSongClampInt(row ? row.repeats : 1, 1, 1, AV_SONG_REP_MAX);
}

function avSongRowMutesOf(row) {
  const out = [0, 0, 0, 0];
  const src = (row && Array.isArray(row.mutes)) ? row.mutes : [];
  for (let t = 0; t < AV_SONG_TRACKS; t++) {
    const v = src[t];
    out[t] = (v === "0" || v === 0 || v === false || v == null) ? 0 : (v ? 1 : 0);
  }
  return out;
}

function avSongRowTempoOf(row) {
  const n = Number(row ? row.tempo : 0);
  if (!isFinite(n) || n <= 0) return 0;
  const r = Math.round(n);
  return r < AV_SONG_TEMPO_MIN ? AV_SONG_TEMPO_MIN : (r > AV_SONG_TEMPO_MAX ? AV_SONG_TEMPO_MAX : r);
}

function avSongRowCount() {
  try {
    if (typeof avSeqSongSnap === "function") {
      const s = avSeqSongSnap();
      if (s && Array.isArray(s.rows)) return s.rows.length;
    }
  } catch (e) { /* frozen fallback below */ }
  return avSongRows.length;
}

/* freeze the arrangement at play: rows → {ref, label, repeats, mutes, len, tempo} + spans */
function avSongFreezeRows(rows) {
  avSongRows = [];
  avSongLens = [];
  avSongSpans = [];
  avSongTotal = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = (rows[i] && typeof rows[i] === "object" && !Array.isArray(rows[i])) ? rows[i] : {};
    const len = avSongRowLenOf(r);
    const rep = avSongRowRepeatOf(r);
    avSongRows.push({
      ref: (typeof r.ref === "string") ? r.ref : "",
      label: (typeof r.label === "string") ? r.label : "",
      repeats: rep,
      mutes: avSongRowMutesOf(r),
      len: len,
      tempo: avSongRowTempoOf(r),
    });
    avSongLens.push(len);
    avSongSpans.push(len * rep);
    avSongTotal += len * rep;
  }
  return avSongRows.length;
}

/* ---------- applying state (guarded core reaches; never throws) ---------- */

/* mutes via ONE avSeqSnap → set the 4 track mutes → avSeqLoad; then tempo; then repaint */
function avSongApplyRow(index) {
  const row = avSongRows[index];
  if (!row) return false;
  try {
    if (typeof avSeqSnap === "function" && typeof avSeqLoad === "function") {
      const sn = avSeqSnap();
      if (sn && Array.isArray(sn.tracks)) {
        for (let t = 0; t < AV_SONG_TRACKS; t++) {
          const tr = sn.tracks[t];
          if (tr && typeof tr === "object") tr.mute = row.mutes[t] ? 1 : 0;
        }
        avSeqLoad(sn);
      }
    }
  } catch (e) { /* a core refusal is honest and never fatal to the runner */ }
  if (row.tempo > 0) {
    try { if (typeof avApplyParam === "function") avApplyParam("bpm", row.tempo); } catch (e) { /* refused */ }
  }
  /* the scheduler plans from its OWN pattern reference — the mute change must be pushed live
     (the UI edit path does this via avSeqUiSchedPush; the runner routes through the same push) */
  try {
    if (typeof avSeqUiSchedPush === "function") avSeqUiSchedPush();
    else if (typeof avSeqSetPattern === "function" && typeof avSeqSnap === "function") avSeqSetPattern(avSeqSnap());
  } catch (e) { /* transport push is best-effort */ }
  try { if (typeof avSeqUiSync === "function") avSeqUiSync(); } catch (e) { /* no UI loaded */ }
  avSongRowApplies++;
  return true;
}

/* apply the ONE queued recall + its single checkpoint AFTER (the §2.6 checkpoint law) */
function avSongApplyRecall() {
  const p = avSongPending;
  avSongPending = null;
  if (!p) return false;
  let ok = false;
  try { if (typeof avSeqSceneRecall === "function") ok = avSeqSceneRecall(p.name) === true; } catch (e) { ok = false; }
  if (!ok) return false;
  try {
    if (typeof avSeqUiSchedPush === "function") avSeqUiSchedPush();
    else if (typeof avSeqSetPattern === "function" && typeof avSeqSnap === "function") avSeqSetPattern(avSeqSnap());
  } catch (e) { /* transport push is best-effort */ }
  avSongRecalls++;
  try { if (typeof avUndoPush === "function") avUndoPush("seq", "scene"); } catch (e) { /* history absent */ }
  return true;
}

/* ---------- timers (stubbed freely in node harnesses) ---------- */

function avSongStartTimer() {
  if (avSongTimer != null) return true;
  try {
    if (typeof setInterval === "function") {
      avSongTimer = setInterval(avSongTick, AV_SONG_WAKE_MS);
      return true;
    }
  } catch (e) { avSongTimer = null; }
  return false;
}

function avSongStopTimer() {
  if (avSongTimer == null) return false;
  try { if (typeof clearInterval === "function") clearInterval(avSongTimer); } catch (e) { /* gone */ }
  avSongTimer = null;
  return true;
}

/* halt the runner; stopTransport also stops the scheduler (auto-stop / dies-with-transport) */
function avSongHalt(stopTransport) {
  avSongPlaying = false;
  avSongStopTimer();
  if (stopTransport) {
    try { if (typeof avSeqStop === "function") avSeqStop(); } catch (e) { /* bus gone */ }
  }
  avSongRow = -1;
  avSongRowStart = 0;
  avSongBaseStep = 0;
  avSongTotal = 0;
  avSongSpans = [];
  avSongLens = [];
  avSongRows = [];
  avSongPending = null;
  return true;
}

/* cycleLen for the "cycle" quant: avSeqSchedCycleLen (guarded; floor 16) */
function avSongCycleLenNow() {
  let c = AV_SONG_LEN_FLOOR;
  try {
    if (typeof avSeqSchedCycleLen === "function") {
      const d = Math.round(Number(avSeqSchedCycleLen()));
      if (isFinite(d) && d >= 1) c = d;
    }
  } catch (e) { /* the floor stands */ }
  return c < AV_SONG_LEN_FLOOR ? AV_SONG_LEN_FLOOR : c;
}

/* ---------- the runner tick (row walk → auto-stop → the queued recall) ---------- */

function avSongTick() {
  if (!avSongPlaying) return;
  /* transport-driven: the runner dies with its transport (guarded probe) */
  try {
    if (typeof avSeqIsPlaying === "function" && avSeqIsPlaying() !== true) { avSongHalt(false); return; }
  } catch (e) { /* a probe refusal is not ours */ }
  let step = -1;
  try {
    if (typeof avSeqPosition === "function") {
      const pos = avSeqPosition();
      const s = (pos && typeof pos.step === "number") ? pos.step : NaN;
      if (isFinite(s)) step = Math.floor(s);
    }
  } catch (e) { step = -1; }
  if (step < 0) return;                          /* no live grid yet */
  avSongStep = step;
  let rel = step - avSongBaseStep;
  if (!(rel >= 0)) rel = 0;

  /* row walk: advance across L×R boundaries (song-relative); each entry applies its row */
  let guard = 0;
  while (avSongRow >= 0 && avSongRow < avSongRows.length && guard++ < 4096) {
    const span = avSongSpans[avSongRow];
    if (rel < avSongRowStart + span) break;
    if (avSongRow + 1 >= avSongRows.length) break;   /* the last row's end is the song end */
    avSongRowStart += span;
    avSongRow++;
    avSongApplyRow(avSongRow);
  }
  /* last row completion → auto-stop (transport included) */
  if (rel >= avSongTotal) { avSongHalt(true); return; }
  /* the one queued recall: applies at/after its target step, AFTER any row apply this tick */
  if (avSongPending && step >= avSongPending.at) avSongApplyRecall();
}

/* ---------- the public surface (§2.6) ---------- */

function avSongPlay() {
  try {
    let songSnap = null;
    try { if (typeof avSeqSongSnap === "function") songSnap = avSeqSongSnap(); } catch (e) { songSnap = null; }
    const rows = (songSnap && Array.isArray(songSnap.rows)) ? songSnap.rows : [];
    if (rows.length === 0) return { ok: false, error: "no rows" };
    if (avSongPlaying) return { ok: false, error: "already playing" };

    /* transport: adopt a running scheduler, else start it; refuse honestly when it cannot run */
    let transportOk = false;
    let base = 0;
    let adopted = false;
    try {
      if (typeof avSeqIsPlaying === "function" && avSeqIsPlaying() === true) { transportOk = true; adopted = true; }
    } catch (e) { transportOk = false; }
    if (!transportOk) {
      try { if (typeof avSeqPlay === "function") transportOk = (avSeqPlay() === true); } catch (e) { transportOk = false; }
    }
    if (!transportOk) return { ok: false, error: "transport refused" };
    if (adopted) {
      try {
        const pos = (typeof avSeqPosition === "function") ? avSeqPosition() : null;
        const s = (pos && typeof pos.step === "number") ? pos.step : -1;
        base = (isFinite(s) && s >= 1) ? Math.floor(s) : 0;
      } catch (e) { base = 0; }
    }

    /* freeze the arrangement; row 0 applies AT START (before the first tick) */
    avSongFreezeRows(rows);
    if (avSongRows.length === 0) return { ok: false, error: "no rows" };
    avSongRow = 0;
    avSongRowStart = 0;
    avSongBaseStep = base;
    avSongStep = -1;
    avSongPending = null;
    avSongPlaying = true;
    avSongApplyRow(0);
    avSongStartTimer();
    return { ok: true };
  } catch (e) {
    try { avSongHalt(false); } catch (e2) { /* belt */ }
    return { ok: false, error: "play failed" };
  }
}

function avSongStop() {
  try {
    const wasPlaying = avSongPlaying === true;
    avSongPlaying = false;
    avSongStopTimer();
    let seqStopped = false;
    try { if (typeof avSeqStop === "function") seqStopped = avSeqStop() === true; } catch (e) { seqStopped = false; }
    avSongRow = -1;
    avSongRowStart = 0;
    avSongBaseStep = 0;
    avSongTotal = 0;
    avSongSpans = [];
    avSongLens = [];
    avSongRows = [];
    avSongPending = null;
    return wasPlaying || seqStopped;
  } catch (e) { return false; }
}

function avSongIsPlaying() {
  return avSongPlaying === true;
}

function avSongRepeatNow() {
  if (!avSongPlaying || avSongRow < 0 || avSongRow >= avSongRows.length) return -1;
  const len = (avSongLens[avSongRow] > 0) ? avSongLens[avSongRow] : 1;
  const rep = avSongRows[avSongRow].repeats;
  let k = Math.floor((avSongStep - avSongRowStart) / len);
  if (!isFinite(k) || k < 0) k = 0;
  if (k > rep - 1) k = rep - 1;
  return k;
}

function avSongStatus() {
  try {
    return {
      playing: avSongPlaying === true,
      row: avSongPlaying ? avSongRow : -1,
      repeat: avSongRepeatNow(),
      rows: avSongRowCount(),
      quant: avSongQuant,
      queued: avSongPending ? { name: avSongPending.name, quant: avSongPending.quant, at: avSongPending.at } : null,
      step: avSongStep,
    };
  } catch (e) {
    return { playing: false, row: -1, repeat: -1, rows: 0, quant: AV_SONG_QUANT_DEF, queued: null, step: -1 };
  }
}

function avSongSceneRecall(name, quant) {
  try {
    const nm = (typeof name === "string") ? name.trim() : "";
    if (!nm) return { ok: false, error: "bad name" };
    const qArg = avSongQuantNorm(quant);
    if (qArg) avSongQuant = qArg;               /* an explicit quant becomes the stored default */
    const qUse = qArg || avSongQuant;

    if (!avSongPlaying) {
      /* stopped → immediate recall + the ONE checkpoint AFTER the apply */
      if (typeof avSeqSceneRecall !== "function") return { ok: false, error: "scene recall unavailable" };
      let ok = false;
      try { ok = avSeqSceneRecall(nm) === true; } catch (e) { ok = false; }
      if (!ok) return { ok: false, error: "unknown scene" };
      try {
        if (typeof avSeqUiSchedPush === "function") avSeqUiSchedPush();
        else if (typeof avSeqSetPattern === "function" && typeof avSeqSnap === "function") avSeqSetPattern(avSeqSnap());
      } catch (e) { /* transport push is best-effort */ }
      avSongRecalls++;
      try { if (typeof avUndoPush === "function") avUndoPush("seq", "scene"); } catch (e) { /* history absent */ }
      return { ok: true, at: -1 };              /* applied immediately (transport idle) */
    }

    /* playing → queue (ONE at a time — a new request replaces) and apply on a runner tick */
    const s = (avSongStep >= 0) ? avSongStep : 0;
    let at = s;
    if (qUse === "beat") at = (Math.floor(s / AV_SONG_BEAT_STEPS) + 1) * AV_SONG_BEAT_STEPS;
    else if (qUse === "cycle") {
      const c = avSongCycleLenNow();
      at = (Math.floor(s / c) + 1) * c;
    }
    avSongPending = { name: nm, quant: qUse, at: at };
    return { ok: true, at: at };
  } catch (e) { return { ok: false, error: "recall failed" }; }
}

function avSongExportMidi(opts) {
  try {
    const o = (opts && typeof opts === "object" && !Array.isArray(opts)) ? opts : {};
    let snap = null;
    try { if (typeof avSeqSnap === "function") snap = avSeqSnap(); } catch (e) { snap = null; }
    if (!snap) return { ok: false, error: "no pattern snap" };
    let song = null;
    try { if (typeof avSeqSongSnap === "function") song = avSeqSongSnap(); } catch (e) { song = null; }
    if (!song) return { ok: false, error: "no song" };
    if (typeof avMidExportSong !== "function") return { ok: false, error: "export unavailable (avMidExportSong)" };
    const call = { snap: snap, song: song, name: (o.name != null) ? o.name : snap.name };
    if (Array.isArray(o.trackMask)) call.trackMask = o.trackMask;
    const res = avMidExportSong(call);
    if (!res || typeof res !== "object") return { ok: false, error: "export unavailable (avMidExportSong)" };
    return res;
  } catch (e) { return { ok: false, error: "export failed" }; }
}

function avSongExportJson() {
  try {
    let snap = null;
    try { if (typeof avSeqSnap === "function") snap = avSeqSnap(); } catch (e) { snap = null; }
    let pattern = null;
    try {
      if (typeof avSeqPatternExport === "function") {
        const raw = avSeqPatternExport();
        if (typeof raw === "string" && raw) pattern = JSON.parse(raw);
      }
    } catch (e) { pattern = null; }
    if (!pattern && snap && typeof snap === "object") pattern = snap;
    if (!pattern || typeof pattern !== "object") return "";
    let rows = [];
    try {
      if (typeof avSeqSongSnap === "function") {
        const s = avSeqSongSnap();
        if (s && Array.isArray(s.rows)) rows = s.rows;
      }
    } catch (e) { rows = []; }
    return JSON.stringify({
      v: 1,
      name: (typeof pattern.name === "string") ? pattern.name : "",
      bpm: avSongIsNum(pattern.bpm) ? pattern.bpm : 120,
      grid: (pattern.grid === "8t") ? "8t" : "16",
      rows: rows,
      pattern: pattern,
    });
  } catch (e) { return ""; }
}

function avSongImportJson(str) {
  try {
    if (typeof str !== "string" || !str) return false;
    let obj = null;
    try { obj = JSON.parse(str); } catch (e) { return false; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
    if (obj.v != null && Number(obj.v) !== 1) return false;      /* foreign version */
    let rowsLoaded = false, patternLoaded = false;
    if (Array.isArray(obj.rows)) {
      try {
        if (typeof avSeqSongLoad === "function") rowsLoaded = avSeqSongLoad({ v: 1, rows: obj.rows }) === true;
      } catch (e) { rowsLoaded = false; }
    }
    if (obj.pattern && typeof obj.pattern === "object" && !Array.isArray(obj.pattern)) {
      try {
        if (typeof avSeqLoad === "function") patternLoaded = avSeqLoad(obj.pattern) === true;
      } catch (e) { patternLoaded = false; }
      if (patternLoaded) {
        try { if (typeof avUndoPush === "function") avUndoPush("seq"); } catch (e) { /* history absent */ }
      }
    }
    return rowsLoaded || patternLoaded;
  } catch (e) { return false; }
}

function avSongSnap() {
  try {
    return {
      v: 1,
      version: AV_SONG_VERSION,
      playing: avSongPlaying === true,
      row: avSongPlaying ? avSongRow : -1,
      repeat: avSongRepeatNow(),
      rows: avSongRowCount(),
      quant: avSongQuant,
      queued: avSongPending ? { name: avSongPending.name, quant: avSongPending.quant, at: avSongPending.at } : null,
      step: avSongStep,
      rowApplies: avSongRowApplies,
      recalls: avSongRecalls,
    };
  } catch (e) { return { v: 1, version: AV_SONG_VERSION }; }
}

/* ---------- boot: guarded publish (page only; plain node skips this) ---------- */

if (typeof window !== "undefined") {
  try {
    window.__avSong = {
      version: AV_SONG_VERSION,
      play: avSongPlay,
      stop: avSongStop,
      isPlaying: avSongIsPlaying,
      status: avSongStatus,
      sceneRecall: avSongSceneRecall,
      exportMidi: avSongExportMidi,
      exportJson: avSongExportJson,
      importJson: avSongImportJson,
      snap: avSongSnap,
    };
  } catch (e) { /* publish is a nicety */ }
}
