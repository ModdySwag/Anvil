/* Anvil — S2.1 COMP card (child sa-B): the comping UI mounted into the parent-owned host
   `#av-comp-host` (the parent adds the `#av-comp` card at integration and calls avCompUiInit();
   this module only fills the host). Per verify/_s2b_wave.md §2.2.

   WHAT THIS CARD IS
   - LANES: one `.av-comp-lane[data-take]` per take from avTakesList() — name · lap · seconds and a
     timeline bar (width ∝ take.frames / longest take, partial laps marked). Lanes are also the
     SELECTION surface (click a lane to select it — ADD SEGMENT appends from it) and each lane SHOWS
     the trimmed range the current comp uses for that take (from/to readouts; the trims themselves
     live on the segment rows / the engine).
   - COMP: a comp select (`#av-comp-list`, or an implicit single comp created ON DEMAND by the
     first ADD SEGMENT / AUTO-COMP / RENDER / EXPORT), SEGMENT rows `.av-comp-seg[data-idx]`
     (take id · range · fades · REMOVE via avCompRemoveSegment), ADD SEGMENT (from the selected
     lane — full take range, at the fade length), AUTO-COMP (avCompAutoComp pick-best lite —
     reports the regions chosen), RENDER (avCompRender) + EXPORT WAV (avCompExport, downloaded via
     the av_deliver_ui anchor-blob technique), and the fade length input (ms, applied to new
     segments).
   - status line + warnings area (degradation is reported there, never console noise). A light
     ~1.2 s poll compares a takes+comps signature so takes recorded in the STUDIO card (or comps
     edited elsewhere) repaint without any user action.

   LAW: every sibling call is consumed through the pinned §2.1 names with typeof guards ONLY —
   avCompList/Create/AddSegment/RemoveSegment/Segments/AutoComp/Render/Export · avTakesList
   (READ-ONLY — this card never records, never mutates takes, never calls a sibling's Init; the
   parent/app_core owns boots and the STUDIO card owns recording). It never throws. No console
   noise at all. No DOM at load — the file loads in plain node (harness). ONE namespace
   avCompUi* / AV_COMP_UI_*.

   ORCHESTRATION DECISIONS (documented seams for the parent):
   - the card never mutates comp state directly: every read goes through avCompList() /
     avCompSegments(compId) per paint, every write through the pinned calls (single source of
     truth); every action ends with a repaint from the engine's reads.
   - "implicit comp, created on demand": actions that need a comp call avCompAddSegment-path
     ensureComp(), which prefers the selected comp, else the newest listed comp, else creates one
     via avCompCreate() (reported honestly). Painting NEVER creates a comp.
   - lane selection defaults to the NEWEST take when nothing is selected; ADD SEGMENT uses the
     selected lane (the selection is normalized every paint — a deleted take can never linger).
   - segments are appended at the fade length from `#av-comp-fade` (ms; default 5 ms ≈ 240 frames
     @48k, the §2.1 AV_COMP_FADE_DEF), clamped 0..500 ms / 0..24000 frames; the input is read at
     action time AND on change.
   - the trim edit surface is the engine (avCompSetSegment) + the segment rows: ADD SEGMENT /
     AUTO-COMP set the ranges, REMOVE takes a segment out; the lane readouts reflect the comp's
     trims. Inline trim editing (avCompSetSegment from the card) is intentionally NOT exposed in
     v1 — the rig drives trims through the pinned engine call (a documented Undetermined/future).
   - EXPORT prefers the receipt's `blob` (our own object URL, revoked after 8 s), falls back to a
     buffer wrapped in an `audio/wav` Blob, then to the receipt's `url` as-is; the honest
     "no download handle could be opened" copy appears when none is usable. A receipt without
     bytes still reports what it has.
   - one module op gate (add/auto/render/export/remove) keeps the pin honest without queuing
     surprises; the controls stay disabled meanwhile.
   - the poll uses setInterval, guarded; it never runs before init and never rewrites markup that
     did not change (all paints are keyed memos).

   OBSERVABLES: avCompUiInit() -> bool (false without host, never throws, idempotent, dataset
   marker avCompUiWired='1') · avCompUiSync() -> bool (repaint) · avCompUiClasses() -> string[]
   (the NEW css classes — ONLY av-comp-* names; the parent styles them) · avCompUiSnap() -> the
   honest card state · window.__avCompUi = { version, init, sync, classes, state, ensure, sel,
   add, auto, render, export, del, selLane, pick } ·
   window.__avCompUiLastExport = { kind, name, bytes, downloaded, at } (export download stamp).

   ID INVENTORY (rig + parent rely on these):
     #av-comp-status · #av-comp-lanes · #av-comp-lanes-none · #av-comp-take-n · #av-comp-sel-val
     #av-comp-list (the comp select) · #av-comp-comp-val · #av-comp-segs · #av-comp-segs-none
     #av-comp-add · #av-comp-auto · #av-comp-fade · #av-comp-render · #av-comp-export
     #av-comp-render-val · #av-comp-warnings · #av-comp-foot
   CARD HOOKS: `.av-comp[data-av-comp="1"]` root · `.av-comp-lane[data-take]` (state classes
   `av-comp-partial`, `av-comp-sel`) · `.av-comp-seg[data-idx]` · `[data-act=seg-del]`.

   ONE writer (child sa-B). Never throws. */

"use strict";

const AV_COMP_UI_VERSION = "s2.1";
const AV_COMP_UI_POLL_MS = 1200;                     /* the light takes-changed poll (§2.2) */
const AV_COMP_UI_WARN_MAX = 8;
const AV_COMP_UI_LANES_MAX = 32;                     /* takes rendered (keepLast <= 32) */
const AV_COMP_UI_SEGS_MAX = 64;                      /* segments rendered */
const AV_COMP_UI_COMPS_MAX = 24;                     /* comp options rendered */
const AV_COMP_UI_FADE_DEF_MS = 5;                    /* §2.1 AV_COMP_FADE_DEF ≈ 240 frames @48k */
const AV_COMP_UI_FADE_MAX_MS = 500;                  /* 24000 frames @48k = the §2.1 clamp */
const AV_COMP_UI_FADE_MAX_FRAMES = 24000;
const AV_COMP_UI_RATE_DEF = 48000;

/* UI-local state only — every module fact is read through the pinned av* APIs per paint */
const avCompUiState = {
  inited: false, mounts: 0, timerId: null,
  /* selection + inputs */
  compId: "", selTake: "", fadeMs: AV_COMP_UI_FADE_DEF_MS,
  /* op gate */
  addBusy: false, autoBusy: false, renderBusy: false, exportBusy: false, segBusy: false,
  /* last receipts (honest readouts) */
  lastRender: null, lastExport: null,
  /* status + warnings */
  lastMsg: "", lastMsgKind: "msg",
  warnings: [], warnKey: "",
  /* paint memos */
  lanesKey: "", segsKey: "", compKey: "", warnKey: "",
  /* poll signature sentinel so the first poll always syncs */
  pollSig: "\u0000",
};

/* ---------- small pure helpers (no DOM; harness-covered) ---------- */

const avCompUiEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const avCompUiNum = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };

function avCompUiClean(s, max) {
  let t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  if (max && t.length > max) t = t.slice(0, max - 1) + "\u2026";
  return t;
}

/* int with clamp; non-finite/garbage -> def (null def = refuse) */
function avCompUiInt(v, lo, hi, def) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return (def === undefined ? null : def);
  return Math.max(lo, Math.min(hi, n));
}

function avCompUiClampN(v, lo, hi, def) {
  const n = Number(v);
  if (!isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, n));
}

/* seconds text (the studio display law: 1 decimal from 100 s, else 2) */
function avCompUiSecsTextFromSecs(secs) {
  const s = avCompUiClampN(secs, 0, 1e9, 0);
  if (s >= 100) return s.toFixed(1) + " s";
  return s.toFixed(2) + " s";
}

function avCompUiSecsText(frames, rate) {
  const f = avCompUiNum(frames, 0);
  const r = avCompUiNum(rate, AV_COMP_UI_RATE_DEF);
  return avCompUiSecsTextFromSecs((f > 0 ? f : 0) / (r > 0 ? r : AV_COMP_UI_RATE_DEF));
}

function avCompUiFmtBytes(n) {
  const v = Number(n);
  if (!isFinite(v) || v < 0) return "";
  if (v < 1024) return Math.round(v) + " B";
  if (v < 1048576) return (v / 1024).toFixed(1) + " KB";
  return (v / 1048576).toFixed(2) + " MB";
}

/* lap · partial text (the studio take-row law) */
function avCompUiLapText(lap, partial) {
  const n = Number(lap);
  let out = (isFinite(n) && n >= 1) ? ("lap " + Math.round(n)) : "\u2014";
  if (partial === true) out = (out === "\u2014" ? "" : out + " \u00b7 ") + "partial";
  return out;
}

/* ms -> frames for the fade input (clamped to the §2.1 window); never throws */
function avCompUiFadeFrames(ms, rate) {
  const m = avCompUiNum(ms, 0);
  const r = avCompUiNum(rate, AV_COMP_UI_RATE_DEF);
  if (!(m > 0)) return 0;
  let n = Math.round(m / 1000 * (r > 0 ? r : AV_COMP_UI_RATE_DEF));
  if (!isFinite(n) || n < 0) n = 0;
  if (n > AV_COMP_UI_FADE_MAX_FRAMES) n = AV_COMP_UI_FADE_MAX_FRAMES;
  return n;
}

function avCompUiFadeMsText(frames, rate) {
  const f = avCompUiNum(frames, 0);
  const r = avCompUiNum(rate, AV_COMP_UI_RATE_DEF);
  const ms = (f > 0 && r > 0) ? (f / r * 1000) : 0;
  if (ms <= 0) return "no fade";
  if (ms >= 100) return "fade " + ms.toFixed(0) + "/" + ms.toFixed(0) + " ms";
  return "fade " + ms.toFixed(1) + "/" + ms.toFixed(1) + " ms";
}

/* module errors -> honest one-liners (the raw text is kept when nothing matches) */
function avCompUiErrText(err) {
  let raw = "";
  try { raw = String((err && err.message) ? err.message : (err == null ? "" : err)); } catch (e) { raw = ""; }
  raw = raw.replace(/\s+/g, " ").trim().slice(0, 140);
  const e = raw.toLowerCase();
  if (/no comp|unknown comp|comp not found|missing comp/.test(e)) return "that comp no longer exists";
  if (/no takes|take not found|missing take|no such take/.test(e)) return "that take no longer exists \u2014 record or repaint";
  if (/no segment\b|segment not found|bad index|index out of/.test(e)) return "that segment no longer exists";
  if (/cap|too long|5 min|300 s/.test(e)) return "the render would exceed the comp cap";
  if (/empty|nothing to render|no segments/.test(e)) return "the comp has no segments yet";
  if (/wav|encode/.test(e)) return "the WAV encoder refused the render";
  if (/busy|in progress/.test(e)) return "another operation is still running \u2014 try again";
  return raw || "refused";
}

/* receipt verdict: explicit false / null / {ok:false} refuse; everything else (incl.
   undefined) counts as success (the pinned calls only refuse explicitly) */
function avCompUiOK(r) {
  try {
    if (r === false || r === null) return false;
    if (r && typeof r === "object" && r.ok === false) return false;
    return true;
  } catch (e) { return false; }
}

/* warnings list helpers (pure) — dedupe by key, newest last, bounded */
function avCompUiWarnMerge(list, key, text, max) {
  const out = [];
  try {
    const src = Array.isArray(list) ? list : [];
    for (let i = 0; i < src.length; i++) {
      const w = src[i];
      if (!w || w.key === key) continue;
      out.push(w);
    }
    out.push({ key: key, text: text });
    while (out.length > (max || AV_COMP_UI_WARN_MAX)) out.shift();
  } catch (e) { /* keep what we have */ }
  return out;
}

function avCompUiWarnDrop(list, key) {
  const out = [];
  try {
    const src = Array.isArray(list) ? list : [];
    for (let i = 0; i < src.length; i++) {
      const w = src[i];
      if (!w || w.key === key) continue;
      out.push(w);
    }
  } catch (e) { /* empty */ }
  return out;
}

function avCompUiStrField(obj, keys) {
  try {
    if (!obj || typeof obj !== "object" || !Array.isArray(keys)) return "";
    for (let i = 0; i < keys.length; i++) {
      const v = obj[keys[i]];
      if (typeof v === "string" && v) return v;
    }
  } catch (e) { /* none */ }
  return "";
}

function avCompUiNumField(obj, keys) {
  try {
    if (!obj || typeof obj !== "object" || !Array.isArray(keys)) return null;
    for (let i = 0; i < keys.length; i++) {
      const v = obj[keys[i]];
      if (typeof v === "number" && isFinite(v)) return v;
      if (typeof v === "string" && v !== "" && isFinite(Number(v))) return Number(v);
    }
  } catch (e) { /* none */ }
  return null;
}

/* per-take trim readout: the union range of the comp's segments on this take (pure) */
function avCompUiTrimText(segs, takeId, rate) {
  let from = null, to = null, n = 0;
  try {
    if (!Array.isArray(segs) || !takeId) return "trim \u2014";
    for (let i = 0; i < segs.length; i++) {
      const g = segs[i];
      if (!g || typeof g !== "object" || String(g.takeId) !== String(takeId)) continue;
      const f = avCompUiNumField(g, ["fromFrame"]);
      const t = avCompUiNumField(g, ["toFrame"]);
      if (f == null && t == null) continue;
      n += 1;
      if (f != null && (from == null || f < from)) from = f;
      if (t != null && (to == null || t > to)) to = t;
    }
    if (!n || from == null || to == null) return "trim \u2014";
    if (to < from) { const tmp = from; from = to; to = tmp; }
    const r = avCompUiNum(rate, AV_COMP_UI_RATE_DEF) || AV_COMP_UI_RATE_DEF;
    return "trim " + avCompUiSecsTextFromSecs(from / r).replace(" s", "") + "\u2013" + avCompUiSecsTextFromSecs(to / r) +
      (n > 1 ? " \u00b7 " + n + " segs" : "");
  } catch (e) { return "trim \u2014"; }
}

/* auto-comp winner tally (regions -> "t2 \u00d72, t1 \u00d71"; guarded, pure) */
function avCompUiWinnerTally(regions) {
  try {
    if (!Array.isArray(regions) || !regions.length) return "";
    const counts = {}, order = [];
    for (let i = 0; i < regions.length && i < 64; i++) {
      const r = regions[i];
      let id = "";
      if (r && typeof r === "object") id = avCompUiStrField(r, ["takeId", "take", "winner"]);
      else if (typeof r === "string") id = r;
      if (!id) continue;
      if (!Object.prototype.hasOwnProperty.call(counts, id)) { counts[id] = 0; order.push(id); }
      counts[id] += 1;
    }
    if (!order.length) return "";
    const bits = [];
    for (let i = 0; i < order.length && bits.length < 4; i++) bits.push(order[i] + " \u00d7" + counts[order[i]]);
    return bits.join(", ");
  } catch (e) { return ""; }
}

/* ---------- guarded DOM access (no throw, no noise) ---------- */

function avCompUiHost() {
  try {
    if (typeof document !== "undefined" && document && typeof document.getElementById === "function") {
      return document.getElementById("av-comp-host");
    }
  } catch (e) { /* no document */ }
  return null;
}

function avCompUiEl(sel) {
  try {
    const host = avCompUiHost();
    if (host && typeof host.querySelector === "function") return host.querySelector(sel);
  } catch (e) { /* no DOM */ }
  return null;
}

function avCompUiSetValue(el, v) {
  try {
    if (!el) return false;
    const str = String(v == null ? "" : v);
    let focused = false;
    try { if (typeof document !== "undefined" && document && document.activeElement === el) focused = true; } catch (e) { focused = false; }
    if (focused) return false;   /* never clobber the control being edited */
    if (String(el.value) !== str) el.value = str;
    return true;
  } catch (e) { return false; }
}

function avCompUiSetText(host, sel, txt) {
  try { const el = host.querySelector(sel); if (el && el.textContent !== txt) el.textContent = txt; } catch (e) { /* no DOM */ }
}

/* ---------- warnings (stateful wrappers over the pure list helpers) ---------- */

function avCompUiWarn(key, text) {
  try {
    avCompUiState.warnings = avCompUiWarnMerge(avCompUiState.warnings, String(key || "general"), avCompUiClean(text, 170), AV_COMP_UI_WARN_MAX);
  } catch (e) { /* never throws */ }
}

function avCompUiWarnDropKey(key) {
  try { avCompUiState.warnings = avCompUiWarnDrop(avCompUiState.warnings, String(key || "")); } catch (e) { /* ok */ }
}

/* the comp engine facade is "present" when any pinned read/write exists */
function avCompUiCompApi() {
  return (typeof avCompList === "function") || (typeof avCompCreate === "function") ||
    (typeof avCompAddSegment === "function") || (typeof avCompAutoComp === "function") ||
    (typeof avCompRender === "function") || (typeof avCompExport === "function") ||
    (typeof avCompSegments === "function") || (typeof avCompRemoveSegment === "function");
}

/* degraded-module notes: set when missing, dropped when present (honest every paint) */
function avCompUiModulesNote() {
  if (avCompUiCompApi()) avCompUiWarnDropKey("modules.comp");
  else avCompUiWarn("modules.comp", "the comp engine (av_comp.js) is not loaded \u2014 comping is unavailable");
  if (typeof avTakesList === "function") avCompUiWarnDropKey("modules.takes");
  else avCompUiWarn("modules.takes", "the takes module (av_takes.js) is not loaded \u2014 there are no takes to comp; recording lives in the STUDIO card");
}

/* honest note when a single pinned function is absent while the module is present */
function avCompUiMissingNote(fn, what) {
  avCompUiWarn("missing." + String(fn || "fn"), "this build does not expose " + String(fn || "a needed function") + "() \u2014 " + String(what || "that action is unavailable"));
}

/* ---------- mirror reads (pinned APIs, typeof-guarded, explicit reads only) ---------- */

function avCompUiTakesRead() {
  try {
    if (typeof avTakesList !== "function") return { ok: false, list: [] };
    const l = avTakesList();
    return { ok: true, list: Array.isArray(l) ? l : [] };
  } catch (e) { return { ok: false, list: [] }; }
}

function avCompUiCompListRead() {
  try {
    if (typeof avCompList !== "function") return { ok: false, list: [] };
    const l = avCompList();
    return { ok: true, list: Array.isArray(l) ? l : [] };
  } catch (e) { return { ok: false, list: [] }; }
}

function avCompUiSegsRead(compId) {
  try {
    if (!compId || typeof avCompSegments !== "function") return { ok: false, list: [] };
    const l = avCompSegments(compId);
    return { ok: true, list: Array.isArray(l) ? l : [] };
  } catch (e) { return { ok: false, list: [] }; }
}

/* the take the next ADD SEGMENT would use: the explicit selection, else the newest take */
function avCompUiSelTake() {
  try {
    const read = avCompUiTakesRead();
    if (!read.ok || !read.list.length) return null;
    const s = avCompUiState;
    if (s.selTake) {
      for (let i = 0; i < read.list.length; i++) {
        const m = read.list[i];
        if (m && String(m.id) === String(s.selTake)) return { id: String(m.id), meta: m };
      }
    }
    const last = read.list[read.list.length - 1];
    return last ? { id: String(last.id), meta: last } : null;
  } catch (e) { return null; }
}

/* ---------- async settle (receipts may be promises or sync values; never throws) ---------- */

function avCompUiSettle(p, cb) {
  const done = { v: false };
  const once = function (r) {
    if (done.v) return;
    done.v = true;
    try { cb(r); } catch (e) { /* settle never throws */ }
  };
  try {
    if (p && typeof p.then === "function") {
      p.then(once).catch(function (e) { once({ ok: false, error: String((e && e.message) || e || "failed") }); });
      return true;
    }
    once(p);
    return true;
  } catch (e) {
    once({ ok: false, error: String((e && e.message) || e || "failed") });
    return false;
  }
}

/* one module op at a time (keeps the pin honest; controls disabled meanwhile) */
function avCompUiBusy() {
  const s = avCompUiState;
  return !!(s.addBusy || s.autoBusy || s.renderBusy || s.exportBusy || s.segBusy);
}

/* ---------- markup (pure string builders) ---------- */

function avCompUiBodyHTML() {
  return '<div class="av-comp" data-av-comp="1">' +
    '<div class="av-comp-head"><span class="av-comp-title">COMP</span>' +
    '<span class="av-comp-cap">Pick the best parts of your takes into one comp: lanes show every take (name \u00b7 lap \u00b7 seconds \u00b7 length bar) with the trimmed range the comp uses; segments stitch trimmed, crossfaded windows in order; RENDER builds the comp in memory and EXPORT WAV downloads it. Takes are never modified.</span></div>' +
    '<div class="av-comp-status-line"><span class="av-comp-status av-comp-msg" id="av-comp-status" role="status">\u2026</span></div>' +

    '<section class="av-comp-sect" data-sect="lanes">' +
    '<div class="av-comp-sect-head"><span class="av-comp-sect-lbl">LANES</span>' +
    '<span class="av-comp-take-n" id="av-comp-take-n">0 takes</span>' +
    '<span class="av-comp-sel-val" id="av-comp-sel-val">selected: \u2014</span></div>' +
    '<div class="av-comp-lanes" id="av-comp-lanes"></div>' +
    '<p class="av-comp-lanes-none av-comp-none av-note av-dim" id="av-comp-lanes-none">No takes yet \u2014 record in the STUDIO card first.</p>' +
    "</section>" +

    '<section class="av-comp-sect" data-sect="comp">' +
    '<div class="av-comp-sect-head"><span class="av-comp-sect-lbl">COMP</span>' +
    '<select class="av-select av-comp-select av-comp-list" id="av-comp-list" aria-label="Comp to edit"></select>' +
    '<span class="av-comp-comp-val" id="av-comp-comp-val"></span></div>' +
    '<div class="av-comp-segs" id="av-comp-segs"></div>' +
    '<p class="av-comp-segs-none av-comp-none av-note av-dim" id="av-comp-segs-none">No segments yet \u2014 select a lane and press ADD SEGMENT, or run AUTO-COMP.</p>' +
    '<div class="av-comp-row">' +
    '<button type="button" class="av-btn mini av-comp-btn av-comp-add" id="av-comp-add" title="Append a segment from the selected lane (full take range, at the fade length)">ADD SEGMENT</button>' +
    '<button type="button" class="av-btn mini av-comp-btn av-comp-auto" id="av-comp-auto" title="Pick-best: score every take over the longest take\u2019s lap grid and build winning segments">AUTO-COMP</button>' +
    '<label class="av-comp-lab" for="av-comp-fade">FADE (ms)</label>' +
    '<input type="number" class="av-comp-fade" id="av-comp-fade" min="0" max="500" step="0.5" value="5" inputmode="decimal" aria-label="Fade length in milliseconds for new segments">' +
    "</div>" +
    '<div class="av-comp-row">' +
    '<button type="button" class="av-btn mini av-comp-btn av-comp-render" id="av-comp-render" title="Stitch the comp\u2019s segments (trims \u00b7 equal-power crossfades) in memory \u2014 no download">RENDER</button>' +
    '<button type="button" class="av-btn mini av-comp-btn av-comp-export" id="av-comp-export" title="Render the comp and download it as a WAV">EXPORT WAV</button>' +
    '<span class="av-comp-render-val" id="av-comp-render-val">not rendered</span>' +
    "</div>" +
    "</section>" +

    '<div class="av-comp-warnings" id="av-comp-warnings" hidden><div class="av-comp-warn-head">WARNINGS</div></div>' +
    '<p class="av-comp-foot av-note av-dim" id="av-comp-foot">Comps stitch EXISTING takes \u2014 recording lives in the STUDIO card. Comps live in memory for this session; the WAV export is the durable artifact (they do not ride session snapshots yet).</p>' +
    "</div>";
}

function avCompUiCompViews(read) {
  const out = [];
  try {
    if (!read || read.ok !== true || !Array.isArray(read.list)) return out;
    for (let i = 0; i < read.list.length && out.length < AV_COMP_UI_COMPS_MAX; i++) {
      const c = read.list[i];
      if (!c || typeof c !== "object") continue;
      const id = avCompUiStrField(c, ["id"]);
      if (!id) continue;
      const name = avCompUiClean(avCompUiStrField(c, ["name"]) || "untitled", 32);
      const n = Array.isArray(c.segments) ? c.segments.length : 0;
      out.push({
        id: id, name: name, n: n, rendered: (c.out != null),
        label: name + " \u00b7 " + n + " seg" + (n === 1 ? "" : "s") + (c.out != null ? " \u00b7 rendered" : ""),
      });
    }
  } catch (e) { /* empty */ }
  return out;
}

function avCompUiCompOptionsHTML(views, ok) {
  try {
    if (ok === false) return '<option value="">comp engine offline</option>';
    if (!views || !views.length) return '<option value="">no comp yet</option>';
    let out = "";
    for (let i = 0; i < views.length; i++) out += '<option value="' + avCompUiEsc(views[i].id) + '">' + avCompUiEsc(views[i].label) + "</option>";
    return out;
  } catch (e) { return '<option value="">no comp yet</option>'; }
}

function avCompUiLaneRowHTML(v, sel) {
  const idEsc = avCompUiEsc(v.id);
  let cls = "av-comp-lane";
  if (v.partial === true) cls += " av-comp-partial";
  if (sel) cls += " av-comp-sel";
  return '<div class="' + cls + '" data-take="' + idEsc + '" title="click to select \u00b7 ' + idEsc + '">' +
    '<span class="av-comp-lane-name" title="' + idEsc + '">' + avCompUiEsc(v.name) + "</span>" +
    '<span class="av-comp-lane-lap">' + avCompUiEsc(v.lapText) + "</span>" +
    '<span class="av-comp-lane-secs">' + avCompUiEsc(v.secsText) + "</span>" +
    '<span class="av-comp-lane-bar" title="' + avCompUiEsc(v.frames + " frames") + '"><span class="av-comp-lane-fill" style="width:' + avCompUiEsc(v.widthPct) + '"></span></span>' +
    '<span class="av-comp-lane-trim" title="the range of this take the comp uses">' + avCompUiEsc(v.trimText) + "</span>" +
    "</div>";
}

function avCompUiTakeView(meta, i, longest, segs) {
  const m = (meta && typeof meta === "object") ? meta : {};
  const idx = Math.max(0, Math.floor(Number(i) || 0));
  const id = (typeof m.id === "string" && m.id) ? m.id : ("t" + (idx + 1));
  const name = (typeof m.name === "string" && m.name) ? m.name : ("Take " + (idx + 1));
  const frames = avCompUiNum(m.frames, 0);
  const rate = avCompUiNum(m.rate, AV_COMP_UI_RATE_DEF);
  const partial = m.partial === true;
  let pct = 0;
  if (frames > 0 && avCompUiNum(longest, 0) > 0) pct = Math.max(0, Math.min(100, frames / longest * 100));
  return {
    id: id,
    name: avCompUiClean(name, 48) || ("Take " + (idx + 1)),
    frames: frames,
    rate: rate,
    partial: partial,
    secsText: avCompUiSecsText(frames, rate),
    lapText: avCompUiLapText(avCompUiNum(m.lap, null), partial),
    widthPct: pct.toFixed(1) + "%",
    trimText: avCompUiTrimText(segs, id, rate),
  };
}

function avCompUiSegView(seg, i, byId) {
  const seg2 = (seg && typeof seg === "object") ? seg : {};
  const idx = Math.max(0, Math.floor(Number(i) || 0));
  const takeId = avCompUiStrField(seg2, ["takeId"]);
  const meta = (takeId && byId && byId[takeId]) ? byId[takeId] : null;
  const rate = avCompUiNum(meta ? meta.rate : null, AV_COMP_UI_RATE_DEF) || AV_COMP_UI_RATE_DEF;
  const from = avCompUiNumField(seg2, ["fromFrame"]);
  const to = avCompUiNumField(seg2, ["toFrame"]);
  const fi = avCompUiNumField(seg2, ["fadeIn"]);
  const fo = avCompUiNumField(seg2, ["fadeOut"]);
  const rangeText = (from == null && to == null)
    ? "\u2014"
    : avCompUiSecsTextFromSecs((from == null ? 0 : from) / rate).replace(" s", "") + "\u2013" + avCompUiSecsTextFromSecs((to == null ? 0 : to) / rate);
  const fms = (v) => { const f = Number(v); return isFinite(f) && f > 0 ? f / rate * 1000 : 0; };
  const fa = fms(fi), fb = fms(fo);
  let fadeText = "no fade";
  if (fa > 0 || fb > 0) {
    fadeText = "fade " + (fa >= 100 ? fa.toFixed(0) : fa.toFixed(1)) + "/" + (fb >= 100 ? fb.toFixed(0) : fb.toFixed(1)) + " ms";
  }
  return {
    idx: idx,
    takeId: takeId || "\u2014",
    takeName: meta && typeof meta.name === "string" ? meta.name : "",
    rangeText: rangeText,
    rangeTitle: "frames " + (from == null ? "?" : Math.round(from)) + "\u2013" + (to == null ? "?" : Math.round(to)),
    fadeText: fadeText,
    fadeTitle: "fade frames " + (fi == null ? 0 : Math.round(fi)) + " / " + (fo == null ? 0 : Math.round(fo)),
  };
}

function avCompUiSegRowHTML(v, busy) {
  const idx = Math.max(0, Math.floor(Number(v && v.idx) || 0));
  const idEsc = avCompUiEsc(v && v.takeId);
  return '<div class="av-comp-seg" data-idx="' + idx + '">' +
    '<span class="av-comp-seg-take" title="' + avCompUiEsc((v && v.takeName) || (v && v.takeId) || "") + '">' + idEsc + "</span>" +
    '<span class="av-comp-seg-range" title="' + avCompUiEsc(v && v.rangeTitle) + '">' + avCompUiEsc(v && v.rangeText) + "</span>" +
    '<span class="av-comp-seg-fade" title="' + avCompUiEsc(v && v.fadeTitle) + '">' + avCompUiEsc(v && v.fadeText) + "</span>" +
    '<button type="button" class="av-btn mini av-comp-btn av-comp-seg-del" data-act="seg-del" data-idx="' + idx + '" title="REMOVE this segment from the comp" aria-label="REMOVE"' + (busy ? " disabled" : "") + '>\u2715</button>' +
    "</div>";
}

/* ---------- receipts -> status copy ---------- */

function avCompUiRenderValText() {
  const lr = avCompUiState.lastRender;
  if (!lr || typeof lr !== "object") return "not rendered";
  let t = "last render" + (lr.compId ? " (" + avCompUiClean(lr.compId, 16) + ")" : "");
  if (lr.frames != null) {
    t += " " + Math.round(lr.frames) + " frames \u00b7 " + avCompUiSecsTextFromSecs(lr.frames / AV_COMP_UI_RATE_DEF) + " @48k";
  }
  if (lr.peak != null) t += " \u00b7 peak " + lr.peak.toFixed(2);
  if (lr.clipped === true) t += " \u00b7 clipped";
  return t;
}

/* ---------- the anchor-blob download technique from av_deliver_ui (never throws) ---------- */

function avCompUiAnchor(blob, buf, urlRaw, name) {
  try {
    if (typeof document === "undefined" || !document || typeof document.createElement !== "function") return false;
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
    let url = "";
    let revoke = "";
    if (typeof Blob === "function" && blob && blob instanceof Blob) {
      try { url = URL.createObjectURL(blob); revoke = url; } catch (e) { url = ""; }
    }
    if (!url && buf) {
      try {
        if (typeof Blob === "function") { url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" })); revoke = url; }
      } catch (e) { url = ""; }
    }
    if (!url && typeof urlRaw === "string" && urlRaw) url = urlRaw;   /* the engine's own URL — leave it alone */
    if (!url) return false;
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "anvil_comp.wav";
    try { a.rel = "noopener"; } catch (e) { /* attribute refused */ }
    const body = document.body;
    let attached = false;
    if (body && typeof body.appendChild === "function") { try { body.appendChild(a); attached = true; } catch (e) { attached = false; } }
    try { a.click(); } catch (e) { /* a click never throws outward here */ }
    if (attached && body && typeof body.removeChild === "function") { try { body.removeChild(a); } catch (e) { /* ok */ } }
    if (revoke) { try { if (typeof setTimeout === "function") setTimeout(function () { try { URL.revokeObjectURL(revoke); } catch (e) { /* ok */ } }, 8000); } catch (e) { /* ok */ } }
    return true;
  } catch (e) { return false; }
}

/* ---------- comp ensure (implicit single comp, created ON DEMAND) ---------- */

function avCompUiEnsureComp() {
  const s = avCompUiState;
  try {
    const read = avCompUiCompListRead();
    if (read.ok) {
      for (let i = 0; i < read.list.length; i++) {
        const c = read.list[i];
        if (c && String(c.id) === String(s.compId)) return s.compId;
      }
      if (read.list.length) {
        const last = read.list[read.list.length - 1];
        const id = last ? avCompUiStrField(last, ["id"]) : "";
        if (id) { s.compId = id; return id; }
      }
    }
    if (typeof avCompCreate !== "function") {
      avCompUiMissingNote("avCompCreate", "no comp exists yet and creating one is unavailable");
      s.lastMsg = "no comp yet and this build cannot create one (avCompCreate is missing)";
      s.lastMsgKind = "err";
      avCompUiSync();
      return null;
    }
    let c = null;
    try { c = avCompCreate(); } catch (e) { c = { ok: false, error: String((e && e.message) || e || "create failed") }; }
    if (c && typeof c === "object" && c.ok === false) {
      const why = avCompUiErrText(c.error);
      s.lastMsg = "the comp could not be created \u2014 " + why;
      s.lastMsgKind = "err";
      avCompUiWarn("comp.create", "the comp could not be created \u2014 " + why);
      avCompUiSync();
      return null;
    }
    let id = "";
    if (c && typeof c === "object") {
      id = avCompUiStrField(c, ["id"]);
      if (!id && c.comp && typeof c.comp === "object") id = avCompUiStrField(c.comp, ["id"]);
    }
    if (!id) {
      const after = avCompUiCompListRead();
      if (after.ok && after.list.length) {
        const last = after.list[after.list.length - 1];
        id = last ? avCompUiStrField(last, ["id"]) : "";
      }
    }
    if (!id) {
      s.lastMsg = "the comp was created but its id could not be read \u2014 nothing was changed";
      s.lastMsgKind = "err";
      avCompUiWarn("comp.create", "the comp was created but its id could not be read");
      avCompUiSync();
      return null;
    }
    s.compId = id;
    avCompUiWarnDropKey("comp.create");
    return id;
  } catch (e) { return null; }
}

/* ---------- actions ---------- */

/* the fade input read at action time (finite values committed; garbage keeps the last) */
function avCompUiFadeMsNow() {
  const s = avCompUiState;
  try {
    const el = avCompUiEl("#av-comp-fade");
    if (el && typeof el.value !== "undefined") {
      const n = Number(el.value);
      if (isFinite(n)) s.fadeMs = Math.max(0, Math.min(AV_COMP_UI_FADE_MAX_MS, n));
    }
  } catch (e) { /* keep the last value */ }
  return s.fadeMs;
}

function avCompUiFadeInput(el) {
  const s = avCompUiState;
  try {
    const n = Number(el ? el.value : NaN);
    if (isFinite(n)) s.fadeMs = Math.max(0, Math.min(AV_COMP_UI_FADE_MAX_MS, n));
    avCompUiSync();
    return true;
  } catch (e) { return false; }
}

function avCompUiAddSegment() {
  const s = avCompUiState;
  try {
    if (avCompUiBusy()) return false;
    if (typeof avCompAddSegment !== "function") {
      avCompUiMissingNote("avCompAddSegment", "adding segments is unavailable");
      s.lastMsg = "this build cannot add segments (avCompAddSegment is missing)";
      s.lastMsgKind = "err";
      avCompUiSync();
      return false;
    }
    const take = avCompUiSelTake();
    if (!take) {
      s.lastMsg = "no takes to comp \u2014 record takes in the STUDIO card first";
      s.lastMsgKind = "err";
      avCompUiSync();
      return false;
    }
    const compId = avCompUiEnsureComp();
    if (!compId) return false;
    const ms = avCompUiFadeMsNow();
    const rate = avCompUiNum(take.meta ? take.meta.rate : null, AV_COMP_UI_RATE_DEF);
    const frames = avCompUiFadeFrames(ms, rate);
    const toFrame = avCompUiNum(take.meta ? take.meta.frames : null, 0);
    s.addBusy = true;
    s.lastMsg = "adding a segment from lane " + take.id + "\u2026";
    s.lastMsgKind = "msg";
    avCompUiSync();
    let r = null;
    try {
      r = avCompAddSegment(compId, { takeId: take.id, fromFrame: 0, toFrame: toFrame, fadeIn: frames, fadeOut: frames });
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e || "add failed") };
    }
    avCompUiAddSettle(r, take.id);
    return true;
  } catch (e) { return false; }
}

function avCompUiAddSettle(r, takeId) {
  const s = avCompUiState;
  s.addBusy = false;
  if (avCompUiOK(r) === false) {
    const why = (r && typeof r === "object" && r.error) ? avCompUiErrText(r.error) : "refused";
    s.lastMsg = "the segment was not added \u2014 " + why;
    s.lastMsgKind = "err";
    avCompUiWarn("seg.add", "the segment was not added \u2014 " + why);
  } else {
    const idx = (r && typeof r === "object") ? avCompUiNumField(r, ["index"]) : null;
    const n = avCompUiSegsRead(s.compId).list.length;
    s.lastMsg = "segment added" + (idx != null ? " at index " + Math.round(idx) : "") + " \u2014 lane " + String(takeId || "") +
      " \u00b7 comp " + (s.compId || "?") + " now has " + n + " segment" + (n === 1 ? "" : "s");
    s.lastMsgKind = "msg";
    avCompUiWarnDropKey("seg.add");
  }
  avCompUiSync();
}

function avCompUiAutoComp() {
  const s = avCompUiState;
  try {
    if (avCompUiBusy()) return false;
    if (typeof avCompAutoComp !== "function") {
      avCompUiMissingNote("avCompAutoComp", "auto-comping is unavailable");
      s.lastMsg = "this build cannot auto-comp (avCompAutoComp is missing)";
      s.lastMsgKind = "err";
      avCompUiSync();
      return false;
    }
    if (avCompUiTakesRead().list.length === 0) {
      s.lastMsg = "no takes to comp \u2014 record takes in the STUDIO card first";
      s.lastMsgKind = "err";
      avCompUiSync();
      return false;
    }
    const compId = avCompUiEnsureComp();
    if (!compId) return false;
    s.autoBusy = true;
    s.lastMsg = "picking the best take parts\u2026";
    s.lastMsgKind = "msg";
    avCompUiSync();
    let r = null;
    try { r = avCompAutoComp(compId); } catch (e) { r = { ok: false, error: String((e && e.message) || e || "auto-comp failed") }; }
    avCompUiSettle(r, avCompUiAutoSettle);
    return true;
  } catch (e) { return false; }
}

function avCompUiAutoSettle(r) {
  const s = avCompUiState;
  s.autoBusy = false;
  if (avCompUiOK(r) === false) {
    const why = (r && typeof r === "object" && r.error) ? avCompUiErrText(r.error) : "refused";
    s.lastMsg = "auto-comp was refused \u2014 " + why;
    s.lastMsgKind = "err";
    avCompUiWarn("seg.auto", "auto-comp was refused \u2014 " + why);
  } else {
    const regions = (r && typeof r === "object") ? r.regions : null;
    const rn = Array.isArray(regions) ? regions.length : avCompUiNumField(r, ["regions"]);
    const n = avCompUiSegsRead(s.compId).list.length;
    let line = "auto-comp chose " + (rn != null ? Math.round(rn) : "?") + " region" + (rn === 1 ? "" : "s") +
      " \u2014 comp " + (s.compId || "?") + " now has " + n + " segment" + (n === 1 ? "" : "s");
    const tally = avCompUiWinnerTally(regions);
    if (tally) line += " (" + tally + ")";
    s.lastMsg = line;
    s.lastMsgKind = "msg";
    avCompUiWarnDropKey("seg.auto");
  }
  avCompUiSync();
}

function avCompUiRenderComp() {
  const s = avCompUiState;
  try {
    if (avCompUiBusy()) return false;
    if (typeof avCompRender !== "function") {
      avCompUiMissingNote("avCompRender", "rendering is unavailable");
      s.lastMsg = "this build cannot render (avCompRender is missing)";
      s.lastMsgKind = "err";
      avCompUiSync();
      return false;
    }
    const compId = avCompUiEnsureComp();
    if (!compId) return false;
    s.renderBusy = true;
    s.lastMsg = "rendering the comp\u2026";
    s.lastMsgKind = "msg";
    avCompUiSync();
    let r = null;
    try { r = avCompRender(compId); } catch (e) { r = { ok: false, error: String((e && e.message) || e || "render failed") }; }
    avCompUiRenderSettle(r);
    return true;
  } catch (e) { return false; }
}

function avCompUiRenderSettle(r) {
  const s = avCompUiState;
  s.renderBusy = false;
  if (avCompUiOK(r) === false) {
    const why = (r && typeof r === "object" && r.error) ? avCompUiErrText(r.error) : "refused";
    s.lastMsg = "the render was refused \u2014 " + why;
    s.lastMsgKind = "err";
    avCompUiWarn("render.fail", "the render was refused \u2014 " + why);
  } else {
    const frames = (r && typeof r === "object") ? avCompUiNumField(r, ["frames"]) : null;
    const peak = (r && typeof r === "object") ? avCompUiNumField(r, ["peak"]) : null;
    const rms = (r && typeof r === "object") ? avCompUiNumField(r, ["rms"]) : null;
    const clipped = !!(r && typeof r === "object" && r.clipped === true);
    s.lastRender = { compId: s.compId, frames: frames, peak: peak, rms: rms, clipped: clipped, at: Date.now() };
    let line = "rendered";
    if (frames != null) line += " " + avCompUiSecsTextFromSecs(frames / AV_COMP_UI_RATE_DEF);
    if (peak != null) line += " \u2014 peak " + peak.toFixed(2);
    if (rms != null) line += " \u00b7 rms " + rms.toFixed(2);
    if (clipped) line += " \u00b7 clipped";
    s.lastMsg = line;
    s.lastMsgKind = clipped ? "err" : "msg";
    if (clipped) avCompUiWarn("render.clip", "the render clipped \u2014 lower the take levels or shorten the fades");
    else avCompUiWarnDropKey("render.clip");
    avCompUiWarnDropKey("render.fail");
  }
  avCompUiSync();
}

function avCompUiExportComp() {
  const s = avCompUiState;
  try {
    if (avCompUiBusy()) return false;
    if (typeof avCompExport !== "function") {
      avCompUiMissingNote("avCompExport", "WAV export is unavailable");
      s.lastMsg = "this build cannot export the comp (avCompExport is missing)";
      s.lastMsgKind = "err";
      avCompUiSync();
      return false;
    }
    const compId = avCompUiEnsureComp();
    if (!compId) return false;
    s.exportBusy = true;
    s.lastMsg = "rendering and encoding the comp WAV\u2026";
    s.lastMsgKind = "msg";
    avCompUiSync();
    let p = null;
    try { p = avCompExport(compId); } catch (e) { p = { ok: false, error: String((e && e.message) || e || "export failed") }; }
    avCompUiSettle(p, avCompUiExportSettle);
    return true;
  } catch (e) { return false; }
}

function avCompUiExportSettle(r) {
  const s = avCompUiState;
  s.exportBusy = false;
  if (avCompUiOK(r) === false) {
    const why = (r && typeof r === "object" && r.error) ? avCompUiErrText(r.error) : "refused";
    s.lastMsg = "the export was refused \u2014 " + why;
    s.lastMsgKind = "err";
    avCompUiWarn("export.fail", "the export was refused \u2014 " + why);
  } else {
    const name = (r && typeof r === "object" && typeof r.name === "string" && r.name) ? avCompUiClean(r.name, 80) : "anvil_comp.wav";
    const bytes = (r && typeof r === "object") ? avCompUiNumField(r, ["bytes"]) : null;
    const blob = (r && typeof r === "object" && r.blob && typeof r.blob === "object") ? r.blob : null;
    const buf = (r && typeof r === "object" && r.buffer) ? r.buffer : null;
    const urlRaw = (r && typeof r === "object") ? avCompUiStrField(r, ["url"]) : "";
    const wavInfo = (r && typeof r === "object" && r.wavInfo && typeof r.wavInfo === "object") ? r.wavInfo : null;
    const downloaded = avCompUiAnchor(blob, buf, urlRaw, name);
    let line = "exported \u201c" + name + "\u201d";
    if (bytes != null) line += " \u2014 " + avCompUiFmtBytes(bytes);
    const sr = wavInfo ? avCompUiNumField(wavInfo, ["sr", "sampleRate"]) : null;
    const bits = wavInfo ? avCompUiNumField(wavInfo, ["bits", "bitDepth"]) : null;
    if (sr != null || bits != null) line += " \u00b7 " + (sr != null ? Math.round(sr) + " Hz" : "? Hz") + " \u00b7 " + (bits != null ? Math.round(bits) + "-bit" : "? bit");
    line += downloaded ? " \u2014 check your downloads" : " \u2014 no download handle could be opened";
    s.lastMsg = line;
    s.lastMsgKind = downloaded ? "msg" : "err";
    s.lastExport = { name: name, bytes: bytes == null ? null : Math.round(bytes), downloaded: downloaded === true, at: Date.now() };
    if (downloaded) avCompUiWarnDropKey("export.fail");
    else avCompUiWarn("export.dl", "the WAV was built but no download handle could be opened \u2014 the receipt still carries it");
    avCompUiWarnDropKey("export.fail");
    try {
      if (typeof window !== "undefined" && window) {
        window.__avCompUiLastExport = { kind: "comp", name: name, bytes: s.lastExport.bytes, downloaded: downloaded === true, at: Date.now() };
      }
    } catch (e) { /* stamp is a nicety */ }
  }
  avCompUiSync();
}

function avCompUiRemoveSegmentAt(idxArg) {
  const s = avCompUiState;
  try {
    const idx = avCompUiInt(idxArg, 0, 9999, null);
    if (idx == null) return false;
    if (avCompUiBusy()) return false;
    if (typeof avCompRemoveSegment !== "function") {
      avCompUiMissingNote("avCompRemoveSegment", "removing segments is unavailable");
      s.lastMsg = "this build cannot remove segments (avCompRemoveSegment is missing)";
      s.lastMsgKind = "err";
      avCompUiSync();
      return false;
    }
    if (!s.compId) {
      s.lastMsg = "no comp selected \u2014 nothing to remove";
      s.lastMsgKind = "err";
      avCompUiSync();
      return false;
    }
    s.segBusy = true;
    s.lastMsg = "removing segment " + idx + "\u2026";
    s.lastMsgKind = "msg";
    avCompUiSync();
    let ok = true;
    try { if (avCompRemoveSegment(s.compId, idx) === false) ok = false; } catch (e) { ok = false; }
    s.segBusy = false;
    if (ok) {
      s.lastMsg = "segment removed";
      s.lastMsgKind = "msg";
      avCompUiWarnDropKey("seg.del");
    } else {
      s.lastMsg = "the segment could not be removed (it may no longer exist)";
      s.lastMsgKind = "err";
      avCompUiWarn("seg.del", "the segment could not be removed \u2014 it may no longer exist");
    }
    avCompUiSync();
    return ok;
  } catch (e) { return false; }
}

function avCompUiSelectComp(id) {
  const s = avCompUiState;
  try {
    if (avCompUiBusy()) return false;
    const val = String(id == null ? "" : id);
    s.compId = val;
    s.lastMsg = val ? ("comp " + avCompUiClean(val, 24) + " selected") : "no comp selected \u2014 actions create one on demand";
    s.lastMsgKind = "msg";
    avCompUiSync();
    return true;
  } catch (e) { return false; }
}

function avCompUiSelectLane(id) {
  const s = avCompUiState;
  try {
    const val = String(id == null ? "" : id);
    if (!val) return false;
    s.selTake = val;
    s.lastMsg = "lane " + val + " selected \u2014 ADD SEGMENT appends it";
    s.lastMsgKind = "msg";
    avCompUiSync();
    return true;
  } catch (e) { return false; }
}

/* ---------- paint ---------- */

function avCompUiIdleText() {
  const s = avCompUiState;
  const compApi = avCompUiCompApi();
  const takesApi = (typeof avTakesList === "function");
  if (!compApi && !takesApi) return "the comp engine and the takes module are not loaded \u2014 comping is unavailable";
  if (!compApi) return "the comp engine is not loaded \u2014 comping is unavailable";
  if (!takesApi) return "the takes module is not loaded \u2014 record takes in the STUDIO card first";
  const comps = avCompUiCompListRead();
  if (!comps.ok) return "this build does not expose avCompList() \u2014 choose a comp to edit";
  if (!comps.list.length) return "ready \u2014 select a lane and ADD SEGMENT, or run AUTO-COMP";
  return "comp " + (s.compId || "?") + " selected \u2014 select a lane and ADD SEGMENT, or run AUTO-COMP";
}

function avCompUiStatusText() {
  const s = avCompUiState;
  if (s.addBusy) return { text: "adding a segment\u2026", kind: "msg" };
  if (s.autoBusy) return { text: "picking the best take parts\u2026", kind: "msg" };
  if (s.renderBusy) return { text: "rendering the comp\u2026", kind: "msg" };
  if (s.exportBusy) return { text: "rendering and encoding the comp WAV\u2026", kind: "msg" };
  if (s.segBusy) return { text: "removing a segment\u2026", kind: "msg" };
  if (s.lastMsg) return { text: s.lastMsg, kind: (s.lastMsgKind === "err") ? "err" : "msg" };
  return { text: avCompUiIdleText(), kind: "msg" };
}

function avCompUiPaintStatus(host) {
  try {
    const st = avCompUiStatusText();
    const el = host.querySelector("#av-comp-status");
    if (el) {
      const cls = "av-comp-status " + (st.kind === "err" ? "av-comp-err" : "av-comp-msg");
      if (el.className !== cls) el.className = cls;
      if (el.textContent !== st.text) el.textContent = st.text;
    }
    return true;
  } catch (e) { return false; }
}

function avCompUiPaintLanes(host) {
  const s = avCompUiState;
  try {
    const read = avCompUiTakesRead();
    const segs = avCompUiSegsRead(s.compId).list;
    /* normalize the selection: an explicit lane while it exists, else the newest take */
    let selId = "";
    for (let i = 0; i < read.list.length && i < AV_COMP_UI_LANES_MAX; i++) {
      const m = read.list[i];
      if (m && s.selTake && String(m.id) === String(s.selTake)) selId = s.selTake;
    }
    if (!selId && read.list.length) {
      let last = null;
      for (let i = 0; i < read.list.length && i < AV_COMP_UI_LANES_MAX; i++) last = read.list[i];
      const id = last ? avCompUiStrField(last, ["id"]) : "";
      if (id && s.selTake !== id) selId = id;
    }
    if (!selId) s.selTake = "";
    else if (s.selTake !== selId) s.selTake = selId;

    let longest = 0;
    for (let i = 0; i < read.list.length && i < AV_COMP_UI_LANES_MAX; i++) {
      const f = avCompUiNum(read.list[i] ? read.list[i].frames : null, 0);
      if (f > longest) longest = f;
    }
    const views = [];
    for (let i = 0; i < read.list.length && i < AV_COMP_UI_LANES_MAX; i++) {
      views.push(avCompUiTakeView(read.list[i], i, longest, segs));
    }
    const box = host.querySelector("#av-comp-lanes");
    let key = (read.ok ? "ok" : "no") + "|" + (s.selTake || "") + "|";
    for (let i = 0; i < views.length; i++) {
      const v = views[i];
      key += v.id + ":" + v.name + ":" + v.frames + ":" + v.rate + ":" + (v.partial ? 1 : 0) + ":" + v.lapText + ":" + v.widthPct + ":" + v.trimText + "|";
    }
    if (box && key !== s.lanesKey) {
      s.lanesKey = key;
      let html = "";
      for (let i = 0; i < views.length; i++) html += avCompUiLaneRowHTML(views[i], views[i].id === s.selTake);
      box.innerHTML = html;
    }
    const none = host.querySelector("#av-comp-lanes-none");
    if (none) {
      none.hidden = views.length > 0;
      const txt = read.ok ? "No takes yet \u2014 record in the STUDIO card first." : "The takes module is not loaded \u2014 recording lives in the STUDIO card.";
      if (none.textContent !== txt) none.textContent = txt;
    }
    avCompUiSetText(host, "#av-comp-take-n", views.length + " take" + (views.length === 1 ? "" : "s"));
    let selTxt = "selected: \u2014";
    for (let i = 0; i < views.length; i++) {
      if (views[i].id === s.selTake) selTxt = "selected: " + views[i].id + " \u2014 " + views[i].name;
    }
    avCompUiSetText(host, "#av-comp-sel-val", selTxt);
    return true;
  } catch (e) { return false; }
}

function avCompUiPaintBtn(host, sel, disabled, label) {
  try {
    const el = host.querySelector(sel);
    if (!el) return false;
    if (el.disabled !== !!disabled) el.disabled = !!disabled;
    if (el.textContent !== label) el.textContent = label;
    return true;
  } catch (e) { return false; }
}

function avCompUiPaintComp(host) {
  const s = avCompUiState;
  try {
    const read = avCompUiCompListRead();
    const views = avCompUiCompViews(read);
    /* selection: keep a live selection, else the newest listed comp (paint never creates one) */
    let sel = "";
    for (let i = 0; i < views.length; i++) if (views[i].id === s.compId) sel = s.compId;
    if (!sel && views.length) sel = views[views.length - 1].id;
    s.compId = sel;

    const selEl = host.querySelector("#av-comp-list");
    let key = (read.ok ? "ok" : "no") + "|" + sel + "|";
    for (let i = 0; i < views.length; i++) key += views[i].id + ":" + views[i].label + "|";
    if (selEl) {
      if (key !== s.compKey) {
        s.compKey = key;
        selEl.innerHTML = avCompUiCompOptionsHTML(views, read.ok);
      }
      if (selEl.disabled !== !read.ok) selEl.disabled = !read.ok;
      avCompUiSetValue(selEl, sel);
    }
    let val;
    if (!read.ok) val = avCompUiCompApi() ? "this build does not expose avCompList() \u2014 the comp list is unavailable" : "the comp engine is not loaded";
    else if (!views.length) val = "no comp yet \u2014 the first ADD SEGMENT / AUTO-COMP / RENDER / EXPORT creates one on demand";
    else {
      let v = null;
      for (let i = 0; i < views.length; i++) if (views[i].id === sel) v = views[i];
      val = v ? ("comp " + v.id + " \u00b7 " + v.name + " \u00b7 " + v.n + " segment" + (v.n === 1 ? "" : "s") + (v.rendered ? " \u00b7 rendered" : "")) : "";
    }
    avCompUiSetText(host, "#av-comp-comp-val", val);

    /* segment rows */
    const segsRead = avCompUiSegsRead(s.compId);
    const takes = avCompUiTakesRead().list;
    const byId = {};
    for (let i = 0; i < takes.length && i < AV_COMP_UI_LANES_MAX; i++) {
      const m = takes[i];
      if (m && typeof m.id === "string" && m.id) byId[m.id] = m;
    }
    const rows = [];
    for (let i = 0; i < segsRead.list.length && i < AV_COMP_UI_SEGS_MAX; i++) rows.push(avCompUiSegView(segsRead.list[i], i, byId));
    let segKey = (s.compId || "") + "|" + (segsRead.ok ? "ok" : "no") + "|" + (avCompUiBusy() ? "b" : "-") + "|";
    for (let i = 0; i < rows.length; i++) segKey += rows[i].takeId + ":" + rows[i].rangeText + ":" + rows[i].fadeText + "|";
    const segBox = host.querySelector("#av-comp-segs");
    if (segBox && segKey !== s.segsKey) {
      s.segsKey = segKey;
      let html = "";
      const busy = avCompUiBusy();
      for (let i = 0; i < rows.length; i++) html += avCompUiSegRowHTML(rows[i], busy);
      segBox.innerHTML = html;
    }
    const none = host.querySelector("#av-comp-segs-none");
    if (none) none.hidden = rows.length > 0;

    /* controls (all gated while any op is in flight; the busy button carries the phase label) */
    const busyAll = avCompUiBusy();
    avCompUiPaintBtn(host, "#av-comp-add", busyAll, s.addBusy ? "ADDING\u2026" : "ADD SEGMENT");
    avCompUiPaintBtn(host, "#av-comp-auto", busyAll, s.autoBusy ? "PICKING\u2026" : "AUTO-COMP");
    avCompUiPaintBtn(host, "#av-comp-render", busyAll, s.renderBusy ? "RENDERING\u2026" : "RENDER");
    avCompUiPaintBtn(host, "#av-comp-export", busyAll, s.exportBusy ? "EXPORTING\u2026" : "EXPORT WAV");
    const fadeEl = host.querySelector("#av-comp-fade");
    if (fadeEl) avCompUiSetValue(fadeEl, String(s.fadeMs));
    avCompUiSetText(host, "#av-comp-render-val", avCompUiRenderValText());
    return true;
  } catch (e) { return false; }
}

function avCompUiPaintWarnings(host) {
  try {
    const box = host.querySelector("#av-comp-warnings");
    if (!box) return false;
    const list = avCompUiState.warnings || [];
    box.hidden = list.length === 0;
    let key = "";
    for (let i = 0; i < list.length; i++) key += list[i].key + ":" + list[i].text + "|";
    if (key !== avCompUiState.warnKey) {
      avCompUiState.warnKey = key;
      let html = '<div class="av-comp-warn-head">WARNINGS</div>';
      for (let i = 0; i < list.length; i++) html += '<div class="av-comp-warn-item">' + avCompUiEsc(list[i].text) + "</div>";
      box.innerHTML = html;
    }
    return true;
  } catch (e) { return false; }
}

/* full repaint: mirrors first (guarded), then every control (write-on-change only) */
function avCompUiSync() {
  const host = avCompUiHost();
  if (!host) return false;
  try {
    let card = null;
    try { card = (typeof host.querySelector === "function") ? host.querySelector(".av-comp") : null; } catch (e) { card = null; }
    if (!card) {
      host.innerHTML = avCompUiBodyHTML();
      avCompUiState.lanesKey = "";
      avCompUiState.segsKey = "";
      avCompUiState.compKey = "";
      avCompUiState.warnKey = "";
      avCompUiWire(host);
    }
    avCompUiModulesNote();
    avCompUiPaintStatus(host);
    avCompUiPaintComp(host);
    avCompUiPaintLanes(host);
    avCompUiPaintWarnings(host);
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- poll (takes+comps signature; ~1.2 s, no rAF) ---------- */

function avCompUiTakesSig() {
  try {
    if (typeof avTakesList !== "function") return "";
    const l = avTakesList();
    if (!Array.isArray(l)) return "";
    let out = "";
    for (let i = 0; i < l.length && i < AV_COMP_UI_LANES_MAX; i++) {
      const r = l[i] || {};
      out += String(r.id) + ":" + String(r.name) + ":" + String(r.frames) + ":" + String(r.rate) + ":" +
        (r.partial === true ? 1 : 0) + ":" + String(r.lap) + "|";
    }
    return out;
  } catch (e) { return ""; }
}

function avCompUiCompsSig() {
  try {
    let out = "";
    if (typeof avCompList === "function") {
      const l = avCompList();
      if (Array.isArray(l)) {
        for (let i = 0; i < l.length && i < AV_COMP_UI_COMPS_MAX; i++) {
          const c = l[i] || {};
          out += String(c.id) + ":" + String(c.name) + ":" + (Array.isArray(c.segments) ? c.segments.length : "?") + ":" + (c.out ? "r" : "-") + "|";
        }
      }
    }
    out += ";";
    if (typeof avCompSegments === "function" && avCompUiState.compId) {
      const segs = avCompSegments(avCompUiState.compId);
      if (Array.isArray(segs)) {
        for (let j = 0; j < segs.length && j < AV_COMP_UI_SEGS_MAX; j++) {
          const g = segs[j] || {};
          out += String(g.takeId) + ":" + String(g.fromFrame) + ":" + String(g.toFrame) + ":" + String(g.fadeIn) + ":" + String(g.fadeOut) + "|";
        }
      }
    }
    return out;
  } catch (e) { return ""; }
}

function avCompUiSig() {
  try { return avCompUiTakesSig() + ";" + avCompUiCompsSig(); } catch (e) { return ""; }
}

function avCompUiPoll() {
  const s = avCompUiState;
  try {
    if (!s.inited) return false;
    const sig = avCompUiSig();
    if (sig === s.pollSig) return false;
    s.pollSig = sig;
    avCompUiSync();
    return true;
  } catch (e) { return false; }
}

function avCompUiStartPoll() {
  const s = avCompUiState;
  try {
    if (s.timerId != null) return false;
    if (typeof setInterval !== "function") return false;
    s.timerId = setInterval(avCompUiPoll, AV_COMP_UI_POLL_MS);
    return s.timerId != null;
  } catch (e) { return false; }
}

/* ---------- wiring (delegated, bound ONCE per host element; the dataset marker) ---------- */

function avCompUiClick(e) {
  try {
    const t = (e && e.target && typeof e.target.closest === "function") ? e.target : null;
    if (!t) return;
    if (t.closest("#av-comp-add")) { avCompUiAddSegment(); return; }
    if (t.closest("#av-comp-auto")) { avCompUiAutoComp(); return; }
    if (t.closest("#av-comp-render")) { avCompUiRenderComp(); return; }
    if (t.closest("#av-comp-export")) { avCompUiExportComp(); return; }
    const act = t.closest("[data-act]");
    if (act) {
      const what = String(act.getAttribute("data-act") || "");
      if (what === "seg-del") { avCompUiRemoveSegmentAt(String(act.getAttribute("data-idx") || "")); return; }
    }
    const lane = t.closest(".av-comp-lane");
    if (lane) {
      const id = String(lane.getAttribute("data-take") || "");
      if (id) avCompUiSelectLane(id);
      return;
    }
  } catch (err) { /* a listener never throws outward */ }
}

function avCompUiChange(e) {
  try {
    const t = (e && e.target && typeof e.target.closest === "function") ? e.target : null;
    if (!t) return;
    if (t.closest("#av-comp-fade")) { avCompUiFadeInput(t); return; }
    if (t.closest("#av-comp-list")) { avCompUiSelectComp(t.value); return; }
  } catch (err) { /* a listener never throws outward */ }
}

function avCompUiWire(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  try {
    if (host.dataset && host.dataset.avCompUiWired === "1") return true;   /* one delegation per host element */
    if (host.dataset) host.dataset.avCompUiWired = "1";
    host.addEventListener("click", avCompUiClick);
    host.addEventListener("change", avCompUiChange);
    return true;
  } catch (e) { return false; }
}

/* ---------- init (mount, idempotent, re-mountable) ---------- */

function avCompUiInit() {
  const host = avCompUiHost();
  if (!host) return false;
  try {
    let card = null;
    try { card = (typeof host.querySelector === "function") ? host.querySelector(".av-comp") : null; } catch (e) { card = null; }
    if (!card) {
      host.innerHTML = avCompUiBodyHTML();
      avCompUiState.lanesKey = "";
      avCompUiState.segsKey = "";
      avCompUiState.compKey = "";
      avCompUiState.warnKey = "";
    }
    avCompUiWire(host);
    const s = avCompUiState;
    s.inited = true;
    s.mounts += 1;
    avCompUiModulesNote();
    avCompUiSync();
    avCompUiStartPoll();
    return true;
  } catch (e) { return false; }
}

/* ---------- observables ---------- */

function avCompUiSnap() {
  const host = avCompUiHost();
  const s = avCompUiState;
  const snap = {
    version: AV_COMP_UI_VERSION,
    inited: !!s.inited,
    mounts: s.mounts,
    host: !!host,
    wired: !!(host && host.dataset && host.dataset.avCompUiWired === "1"),
    card: false,
    modules: {
      comp: avCompUiCompApi(),
      takes: (typeof avTakesList === "function"),
      list: (typeof avCompList === "function"),
      create: (typeof avCompCreate === "function"),
      segments: (typeof avCompSegments === "function"),
      add: (typeof avCompAddSegment === "function"),
      remove: (typeof avCompRemoveSegment === "function"),
      auto: (typeof avCompAutoComp === "function"),
      render: (typeof avCompRender === "function"),
      export: (typeof avCompExport === "function"),
    },
    takes: { count: avCompUiTakesRead().list.length },
    comps: (function () {
      const read = avCompUiCompListRead();
      let name = "";
      if (s.compId) {
        for (let i = 0; i < read.list.length; i++) {
          const c = read.list[i];
          if (c && String(c.id) === String(s.compId)) name = avCompUiStrField(c, ["name"]);
        }
      }
      return { count: read.list.length, id: s.compId, name: name, segments: avCompUiSegsRead(s.compId).list.length };
    })(),
    sel: { takeId: s.selTake, fadeMs: s.fadeMs },
    busy: {
      add: !!s.addBusy, auto: !!s.autoBusy, render: !!s.renderBusy,
      export: !!s.exportBusy, seg: !!s.segBusy,
    },
    lastRender: s.lastRender ? {
      compId: s.lastRender.compId, frames: s.lastRender.frames, peak: s.lastRender.peak,
      rms: s.lastRender.rms, clipped: s.lastRender.clipped === true,
    } : null,
    lastExport: s.lastExport ? {
      name: s.lastExport.name, bytes: s.lastExport.bytes, downloaded: s.lastExport.downloaded === true,
    } : null,
    status: s.lastMsg, statusKind: s.lastMsgKind,
    warnings: s.warnings.map(function (w) { return w.text; }),
    classes: avCompUiClasses(),
  };
  try { if (host && host.querySelector) snap.card = !!host.querySelector(".av-comp"); } catch (e) { snap.card = false; }
  return snap;
}

function avCompUiClasses() {
  return [
    "av-comp", "av-comp-head", "av-comp-title", "av-comp-cap",
    "av-comp-status-line", "av-comp-status", "av-comp-msg", "av-comp-err",
    "av-comp-sect", "av-comp-sect-head", "av-comp-sect-lbl",
    "av-comp-take-n", "av-comp-sel-val",
    "av-comp-lanes", "av-comp-lane", "av-comp-lane-name", "av-comp-lane-lap",
    "av-comp-lane-secs", "av-comp-lane-bar", "av-comp-lane-fill", "av-comp-lane-trim",
    "av-comp-partial", "av-comp-sel",
    "av-comp-none", "av-comp-lanes-none", "av-comp-segs-none",
    "av-comp-select", "av-comp-list", "av-comp-comp-val",
    "av-comp-segs", "av-comp-seg", "av-comp-seg-take", "av-comp-seg-range",
    "av-comp-seg-fade", "av-comp-seg-del",
    "av-comp-row", "av-comp-lab", "av-comp-btn",
    "av-comp-add", "av-comp-auto", "av-comp-fade", "av-comp-render", "av-comp-export",
    "av-comp-render-val",
    "av-comp-warnings", "av-comp-warn-head", "av-comp-warn-item",
    "av-comp-foot",
  ];
}

/* ---------- debug/verify handle ---------- */

if (typeof window !== "undefined") {
  try {
    window.__avCompUi = {
      version: AV_COMP_UI_VERSION,
      init: function () { return avCompUiInit(); },
      sync: function () { return avCompUiSync(); },
      classes: function () { return avCompUiClasses(); },
      state: function () { return avCompUiSnap(); },
      ensure: function () { return avCompUiEnsureComp(); },
      sel: function () { return avCompUiSelTake(); },
      add: function () { return avCompUiAddSegment(); },
      auto: function () { return avCompUiAutoComp(); },
      render: function () { return avCompUiRenderComp(); },
      export: function () { return avCompUiExportComp(); },
      del: function (idx) { return avCompUiRemoveSegmentAt(idx); },
      selLane: function (id) { return avCompUiSelectLane(id); },
      pick: function (id) { return avCompUiSelectComp(id); },
    };
  } catch (e) { /* no window — nothing to publish */ }
}
