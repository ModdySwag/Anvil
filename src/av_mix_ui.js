/* Anvil — S3 MIX card (child sa-C): the MIX & MASTER card mounted into the parent-owned host
   `#av-mix-host` (the parent adds the `#av-mix` card at integration and calls avMixUiInit();
   this module only fills the host). Per verify/_s3_wave.md §2.3.

   WHAT THIS CARD IS
   - TRACKS: an add picker (TAKES from avTakesList() · COMPS from avCompList() · the ENGINE
     pattern: 4 track mask checkboxes + loops + tail) + ADD; one `.av-mix-track[data-track]` row
     per mix track — name · source badge · GAIN / PAN / SEND-A / SEND-B av-knobs · MUTE / SOLO
     toggles · a DUCK select (none | other tracks) + depth knob · REMOVE · an FX expander
     (DRIVE on + amount; DYN on + thresh + ratio).
   - SENDS: A (verb) RETURN + mode select + decay; B (delay) RETURN + time + feedback.
   - GLUE: on + thresh + ratio. MASTER: drive on + amount; dyn on + eqLo/eqHi + comp thresh/ratio
     + lim ceiling; NORM on + target select (−14/−16/−23) + ceiling.
   - METERS: the LAST RENDER receipt only (LUFS · dBTP · peak · the norm applied/limited note).
   - RENDER / EXPORT: UPDATE MIXDOWN (avMixRender with a live progress fraction) and EXPORT WAV
     (bits 16/24/32f + dither auto/off/tpdf/shaped) downloaded via the anchor-blob technique;
     the export stale-refusal surfaces honestly in the status line.
   - AUTO-MIX: a target select (default −18) + button → avMixAutoBalance → the per-track table.
   - A/B: LOAD REFERENCE (file → arrayBuffer → decodeAudioData on this card's own AudioContext
     → avMixSetRef({l,r,sr})); COMPARE (the avMixCompare readout: gainToMatchDb + LUFS/dBTP
     deltas); one PLAY toggle driving ONE audio element that switches between the mixdown blob
     and the reference blob.

   A/B GAIN TECHNIQUE (documented, §2.3): the reference is rendered to its own WAV blob with the
   samples PRE-GAINED by `10^(gainToMatchDb/20)` — gainToMatchDb = mixLufs − refLufs is the gain
   to apply to the REFERENCE to match the mix (av_loud/av_mix convention), so the reference blob
   plays at the mix's loudness and the A/B switch is loudness-matched, not level-matched. Both
   preview blobs are encoded 16-bit, dither off (the export path carries the user's bits/dither
   choice; previews are audition-only). The mixdown preview blob is encoded from the render
   receipt's own l/r arrays — never a re-render.

   THE COMMIT FUNNEL (the av_mod.js WRAP technique): mix params are NOT engine params. This card
   rides the standard av-knob feel; knob commits arrive through avApplyParam (or the 'av-param'
   event when no app hook exists). avMixUiEnsureHooks() installs ONE additive, idempotent wrap
   scoped to `mix.` paths (marker __avMixUiWrap) that routes to the ONLY two mutation funnels —
   avMixSetTrack(id, patch) for `mix.track.<id>.<field>` and avMixSetParam(path, v) for
   `mix.send.* / mix.glue.* / mix.master.*`. Every non-mix path passes through untouched; mix
   paths are consumed (they are not engine params). The avParams mirror stays harmless (guarded,
   written with the clamped value).

   TRACK ROW REPAINT POLICY: rows rebuild only when the STRUCTURAL key changes (ids · names ·
   sources · mute/solo · duck src · fx on-flags · expander state). Knob values live outside the
   key and sync through the avParams mirror + avKnobRefreshAll, so a mid-drag repaint can never
   eat a drag. Everything is a keyed memo; a second sync with identical state writes nothing.

   LAW: every sibling call is consumed through the pinned §2.2 names with typeof guards ONLY —
   avMixList/AddTrack/SetTrack/RemoveTrack/Clear/SetParam/Params/Render/Export/AutoBalance/
   SetRef/Compare/State · avTakesList/avCompList · avWavEncode · avKnobHTML/Bind/RefreshAll.
   This card never boots a sibling (the parent/app_core owns boots), never starts recording and
   never touches the engine/worklet chain. It never throws. No console noise at all. No DOM at
   load — the file loads in plain node (harness). ONE namespace avMixUi* / AV_MIX_UI_*.

   ID INVENTORY (rig + parent rely on these):
     #av-mix-status · #av-mix-track-n · #av-mix-rev · #av-mix-clear · #av-mix-add-src
     #av-mix-eng · #av-mix-eng-loops · #av-mix-eng-tail · #av-mix-add · #av-mix-tracks
     #av-mix-tracks-none · #av-mix-send-a-return · #av-mix-send-a-mode · #av-mix-send-a-decay
     #av-mix-send-b-return · #av-mix-send-b-time · #av-mix-send-b-feedback · #av-mix-glue-on
     #av-mix-glue-thresh · #av-mix-glue-ratio · #av-mix-md-on · #av-mix-md-amount
     #av-mix-mdyn-on · #av-mix-mdyn-eqlo · #av-mix-mdyn-eqhi · #av-mix-mdyn-thresh
     #av-mix-mdyn-ratio · #av-mix-mdyn-ceil · #av-mix-norm-on · #av-mix-norm-target
     #av-mix-norm-ceil · #av-mix-m-lufs · #av-mix-m-dbtp · #av-mix-m-peak · #av-mix-m-norm
     #av-mix-render · #av-mix-render-val · #av-mix-export · #av-mix-bits · #av-mix-dither
     #av-mix-export-val · #av-mix-auto-target · #av-mix-auto · #av-mix-auto-val
     #av-mix-auto-table · #av-mix-ref-file · #av-mix-ref-val · #av-mix-compare · #av-mix-cmp-val
     #av-mix-playab · #av-mix-ab-val · #av-mix-warnings · #av-mix-foot
   CARD HOOKS: `.av-mix[data-av-mix="1"]` root · `.av-mix-track[data-track]` (state classes
   `av-mix-on` on MUTE/SOLO, `av-mix-fx-open` on the FX button) · `[data-act=mute|solo|fx|remove]`
   · `select[data-mix-duck]` · `input[data-mix-toggle]` (data-mix-path | data-mix-track+data-mix-field)
   · `select[data-mix-param]` (+ data-mix-num="1") · `input[data-eng-mask]` · `[data-mix-local]`.

   OBSERVABLES: avMixUiInit() -> bool (false without host, never throws, idempotent, dataset
   marker avMixUiWired='1') · avMixUiSync() -> bool (repaint) · avMixUiClasses() -> string[]
   (the NEW css classes — ONLY av-mix-* names; the parent styles them) · avMixUiSnap() -> the
   honest card state · window.__avMixUi = { version, init, sync, classes, state, add, remove,
   clear, apply, setParam, render, export, auto, compare, play, stop, refFile, src } ·
   window.__avMixUiLastExport = { kind, name, bytes, downloaded, bits, at } (export stamp).

   ONE writer (child sa-C). Never throws. */

"use strict";

const AV_MIX_UI_VERSION = "s3.0";
const AV_MIX_UI_POLL_MS = 1500;                 /* the light mix-changed poll (§2.3) */
const AV_MIX_UI_WARN_MAX = 8;
const AV_MIX_UI_TRACKS_MAX = 64;                /* rows rendered */
const AV_MIX_UI_PATH_PREFIX = "mix.";           /* this card's funnel namespace */
const AV_MIX_UI_PREVIEW_BITS = 16;              /* A/B preview WAVs (audition only) */
const AV_MIX_UI_RATE_DEF = 48000;
const AV_MIX_UI_ENG_TRACKS = 4;                 /* the engine mask (avBounce trackMask law) */

/* ---------- control tables (one source of truth for markup + mirror + help) ---------- */

/* per-track knobs: field -> the avMixSetTrack patch key, path = mix.track.<id>.<field> */
const AV_MIX_UI_TRACK_KNOBS = [
  { field: "gainDb", label: "GAIN", opts: { min: -60, max: 24, step: 0.5, def: 0, fmt: "db", size: "sm", hint: "track fader" } },
  { field: "pan", label: "PAN", opts: { min: -1, max: 1, step: 0.02, def: 0, fmt: "pan", size: "sm", hint: "linear balance" } },
  { field: "sendA", label: "SEND-A", opts: { min: 0, max: 1, step: 0.01, def: 0, fmt: "pct", size: "sm", hint: "post-fader tap into the verb bus" } },
  { field: "sendB", label: "SEND-B", opts: { min: 0, max: 1, step: 0.01, def: 0, fmt: "pct", size: "sm", hint: "post-fader tap into the delay bus" } },
  { field: "duckDepth", label: "DUCK", opts: { min: 0, max: 24, step: 0.5, def: 0, fmt: "db", size: "sm", hint: "duck depth when the source track plays" } },
  { field: "fx.driveAmount", label: "AMOUNT", opts: { min: 0, max: 1, step: 0.01, def: 0, fmt: "pct", size: "sm", hint: "drive amount" } },
  { field: "fx.dynThresh", label: "THRESH", opts: { min: -60, max: 0, step: 0.5, def: -6, fmt: "db", size: "sm", hint: "insert compressor threshold" } },
  { field: "fx.dynRatio", label: "RATIO", opts: { min: 1, max: 20, step: 0.5, def: 2, fmt: "x", size: "sm", hint: "insert compressor ratio" } },
];

/* sends / glue / master knobs: engine path -> avMixSetParam; ui path = mix.<path> */
const AV_MIX_UI_PARAM_KNOBS = [
  { id: "av-mix-send-a-return", path: "send.A.return", label: "RETURN", opts: { min: 0, max: 1, step: 0.01, def: 0.35, fmt: "pct", size: "sm", hint: "verb bus return level" } },
  { id: "av-mix-send-a-decay", path: "send.A.verb.decay", label: "DECAY", opts: { min: 0, max: 1, step: 0.01, def: 0.55, fmt: "pct", size: "sm", hint: "verb T60 = 0.3..12 s" } },
  { id: "av-mix-send-b-return", path: "send.B.return", label: "RETURN", opts: { min: 0, max: 1, step: 0.01, def: 0.3, fmt: "pct", size: "sm", hint: "delay bus return level" } },
  { id: "av-mix-send-b-time", path: "send.B.delay.time", label: "TIME", opts: { min: 0.01, max: 2, step: 0.01, def: 0.3, fmt: "ms", size: "sm", hint: "delay time (free mode)" } },
  { id: "av-mix-send-b-feedback", path: "send.B.delay.feedback", label: "FEEDBACK", opts: { min: 0, max: 0.95, step: 0.01, def: 0.45, fmt: "pct", size: "sm", hint: "delay feedback" } },
  { id: "av-mix-glue-thresh", path: "glue.thresh", label: "THRESH", opts: { min: -60, max: 0, step: 0.5, def: -18, fmt: "db", size: "sm", hint: "bus glue threshold" } },
  { id: "av-mix-glue-ratio", path: "glue.ratio", label: "RATIO", opts: { min: 1, max: 20, step: 0.5, def: 2, fmt: "x", size: "sm", hint: "bus glue ratio" } },
  { id: "av-mix-md-amount", path: "master.drive.amount", label: "AMOUNT", opts: { min: 0, max: 1, step: 0.01, def: 0, fmt: "pct", size: "sm", hint: "master drive amount" } },
  { id: "av-mix-mdyn-eqlo", path: "master.dyn.eqLo", label: "EQ LO", opts: { min: -15, max: 15, step: 0.5, def: 0, fmt: "db", size: "sm", hint: "master low shelf" } },
  { id: "av-mix-mdyn-eqhi", path: "master.dyn.eqHi", label: "EQ HI", opts: { min: -15, max: 15, step: 0.5, def: 0, fmt: "db", size: "sm", hint: "master high shelf" } },
  { id: "av-mix-mdyn-thresh", path: "master.dyn.comp.thresh", label: "C-THRESH", opts: { min: -40, max: 0, step: 0.5, def: -6, fmt: "db", size: "sm", hint: "master comp threshold" } },
  { id: "av-mix-mdyn-ratio", path: "master.dyn.comp.ratio", label: "C-RATIO", opts: { min: 1, max: 20, step: 0.5, def: 2, fmt: "x", size: "sm", hint: "master comp ratio" } },
  { id: "av-mix-mdyn-ceil", path: "master.dyn.lim.ceiling", label: "CEILING", opts: { min: -6, max: 0, step: 0.1, def: -1, fmt: "db", size: "sm", hint: "limiter ceiling" } },
  { id: "av-mix-norm-ceil", path: "master.norm.ceiling", label: "CEILING", opts: { min: -3, max: 0, step: 0.1, def: -1, fmt: "db", size: "sm", hint: "normalize true-peak ceiling" } },
];

const AV_MIX_UI_PARAM_TOGGLES = [
  { id: "av-mix-glue-on", path: "glue.on", label: "GLUE" },
  { id: "av-mix-md-on", path: "master.drive.on", label: "DRIVE" },
  { id: "av-mix-mdyn-on", path: "master.dyn.on", label: "DYN" },
  { id: "av-mix-norm-on", path: "master.norm.on", label: "NORM" },
];

const AV_MIX_UI_VERB_MODES = ["plate", "fdn", "freeverb"];
const AV_MIX_UI_NORM_TARGETS = [-14, -16, -23];
const AV_MIX_UI_AUTO_TARGETS = [-14, -16, -18, -20, -23];
const AV_MIX_UI_BITS = ["16", "24", "32f"];
const AV_MIX_UI_DITHERS = ["auto", "off", "tpdf", "shaped"];

/* UI-local state only — every module fact is read through the pinned apis per paint */
const avMixUiState = {
  inited: false, mounts: 0, timerId: null,
  /* add picker */
  addSrc: "", engMask: [true, true, true, true], engLoops: 1, engTailS: 1,
  /* expander (track id -> true) */
  expanded: {},
  /* export choices */
  bits: "24", dither: "auto",
  /* auto-mix target */
  autoTarget: "-18",
  /* op gate */
  busyAdd: false, busyRender: false, busyExport: false, busyAuto: false, busyRemove: false, busyRef: false,
  renderPct: null,
  /* last receipts (honest readouts) */
  lastRender: null, lastExport: null, compare: null, ref: null, refArrays: null, refLoadedAt: 0,
  autoRows: null, autoAt: 0,
  /* A/B playback */
  mixURLCache: null, refURLCache: null, playKind: "", audio: null, audioCtx: null,
  /* status + warnings */
  lastMsg: "", lastMsgKind: "msg",
  warnings: [], warnKey: "",
  /* paint memos */
  rowsKey: "", addKey: "", warnKey: "", autoKey: "", cmpKey: "", abKey: "", meterKey: "",
  /* poll signature sentinel so the first poll always syncs */
  pollSig: "\u0000",
};

/* ---------- small pure helpers (no DOM; harness-covered) ---------- */

const avMixUiEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const avMixUiNum = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };

function avMixUiClean(s, max) {
  let t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  if (max && t.length > max) t = t.slice(0, max - 1) + "\u2026";
  return t;
}

function avMixUiInt(v, lo, hi, def) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return (def === undefined ? null : def);
  return Math.max(lo, Math.min(hi, n));
}

function avMixUiClampN(v, lo, hi, def) {
  const n = Number(v);
  if (!isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, n));
}

/* seconds text (the studio display law: 1 decimal from 100 s, else 2) */
function avMixUiSecsTextFromSecs(secs) {
  const s = avMixUiClampN(secs, 0, 1e9, 0);
  if (s >= 100) return s.toFixed(1) + " s";
  return s.toFixed(2) + " s";
}

function avMixUiSecsText(frames, rate) {
  const f = avMixUiNum(frames, 0);
  const r = avMixUiNum(rate, AV_MIX_UI_RATE_DEF);
  return avMixUiSecsTextFromSecs((f > 0 ? f : 0) / (r > 0 ? r : AV_MIX_UI_RATE_DEF));
}

function avMixUiFmtBytes(n) {
  const v = Number(n);
  if (!isFinite(v) || v < 0) return "";
  if (v < 1024) return Math.round(v) + " B";
  if (v < 1048576) return (v / 1024).toFixed(1) + " KB";
  return (v / 1048576).toFixed(2) + " MB";
}

/* loudness readouts (null-safe — never NaN on screen) */
function avMixUiLufsText(v) {
  const n = Number(v);
  if (v == null || !isFinite(n)) return "\u2014";
  return n.toFixed(1) + " LUFS";
}

function avMixUiDbtpText(v) {
  const n = Number(v);
  if (v == null || !isFinite(n)) return "\u2014";
  return (n > 0 ? "+" : "") + n.toFixed(2) + " dBTP";
}

function avMixUiPeakText(v) {
  const n = Number(v);
  if (v == null || !isFinite(n)) return "\u2014";
  return n.toFixed(3);
}

function avMixUiSignedDb(v, unit) {
  const n = Number(v);
  if (v == null || !isFinite(n)) return "\u2014";
  return (n > 0 ? "+" : "") + n.toFixed(2) + (unit || " dB");
}

/* the A/B gain law: gainToMatchDb -> the linear factor the REFERENCE samples are scaled by */
function avMixUiDbToGain(db) {
  const n = Number(db);
  if (!isFinite(n)) return 1;
  return Math.pow(10, Math.max(-60, Math.min(60, n)) / 20);
}

/* scale a channel array into a FRESH array (never mutates the source) */
function avMixUiGainApply(src, gain) {
  try {
    if (!src || typeof src.length !== "number") return src || null;
    const n = src.length;
    const out = (typeof Float32Array === "function") ? new Float32Array(n) : new Array(n);
    const g = Number(gain);
    const use = isFinite(g) ? g : 1;
    for (let i = 0; i < n; i++) out[i] = Number(src[i]) * use;
    return out;
  } catch (e) { return null; }
}

/* engine mask -> "1111" style readout */
function avMixUiMaskText(mask) {
  try {
    let out = "";
    for (let i = 0; i < AV_MIX_UI_ENG_TRACKS; i++) out += (mask && mask[i]) ? "1" : "0";
    return out;
  } catch (e) { return "1111"; }
}

/* module errors -> honest one-liners (the raw text is kept when nothing matches) */
function avMixUiErrText(err) {
  let raw = "";
  try { raw = String((err && err.message) ? err.message : (err == null ? "" : err)); } catch (e) { raw = ""; }
  raw = raw.replace(/\s+/g, " ").trim().slice(0, 140);
  const e = raw.toLowerCase();
  if (/stale|changed since|re-?render|render the mixdown|no render|not rendered/.test(e)) return "the mix changed since the last render \u2014 press UPDATE MIXDOWN first";
  if (/unknown track|no such track|track not found|missing track/.test(e)) return "that track no longer exists";
  if (/unknown path|bad path|unknown param|unknown key/.test(e)) return "the mix engine refused that parameter";
  if (/no tracks|empty mix|nothing to render/.test(e)) return "the mix has no audible tracks";
  if (/cap|too long|300 s|max seconds/.test(e)) return "the render would exceed the 300 s mix cap";
  if (/wav|encode|bits|dither/.test(e)) return "the WAV encoder refused those settings";
  if (/busy|in progress/.test(e)) return "another mix operation is still running \u2014 try again";
  if (/decode|audio(ct)?x|corrupt|unsupported/.test(e)) return "the file could not be decoded as audio";
  return raw || "refused";
}

/* receipt verdict: explicit false / null / {ok:false} refuse; everything else counts as success */
function avMixUiOK(r) {
  try {
    if (r === false || r === null) return false;
    if (r && typeof r === "object" && r.ok === false) return false;
    return true;
  } catch (e) { return false; }
}

/* warnings list helpers (pure) — dedupe by key, newest last, bounded */
function avMixUiWarnMerge(list, key, text, max) {
  const out = [];
  try {
    const src = Array.isArray(list) ? list : [];
    for (let i = 0; i < src.length; i++) {
      const w = src[i];
      if (!w || w.key === key) continue;
      out.push(w);
    }
    out.push({ key: key, text: text });
    while (out.length > (max || AV_MIX_UI_WARN_MAX)) out.shift();
  } catch (e) { /* keep what we have */ }
  return out;
}

function avMixUiWarnDrop(list, key) {
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

function avMixUiStrField(obj, keys) {
  try {
    if (!obj || typeof obj !== "object" || !Array.isArray(keys)) return "";
    for (let i = 0; i < keys.length; i++) {
      const v = obj[keys[i]];
      if (typeof v === "string" && v) return v;
    }
  } catch (e) { /* none */ }
  return "";
}

function avMixUiNumField(obj, keys) {
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

/* read a nested number by key path (def when absent/garbage) */
function avMixUiPathNum(obj, keys, def) {
  try {
    let cur = obj;
    for (let i = 0; i < keys.length; i++) {
      if (!cur || typeof cur !== "object") return def;
      cur = cur[keys[i]];
    }
    const n = Number(cur);
    return isFinite(n) ? n : def;
  } catch (e) { return def; }
}

/* shallow object copy (never throws) */
function avMixUiObjCopy(o) {
  const out = {};
  try {
    if (o && typeof o === "object") {
      for (const k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k]; }
    }
  } catch (e) { /* empty */ }
  return out;
}

/* the mix.<...> path parser: returns { kind:'track', id, field } | { kind:'param', path } | null */
function avMixUiPathParse(path) {
  try {
    if (typeof path !== "string") return null;
    const p = path.indexOf(AV_MIX_UI_PATH_PREFIX) === 0 ? path.slice(AV_MIX_UI_PATH_PREFIX.length) : path;
    const t = /^track\.([^.]+)\.(gainDb|pan|sendA|sendB|duckDepth|fx\.driveOn|fx\.driveAmount|fx\.dynOn|fx\.dynThresh|fx\.dynRatio)$/.exec(p);
    if (t) return { kind: "track", id: t[1], field: t[2] };
    const m = /^(send\.[AB]\.[A-Za-z0-9_.]+|glue\.[A-Za-z0-9_.]+|master\.[A-Za-z0-9_.]+)$/.exec(p);
    if (m) return { kind: "param", path: m[1] };
    return null;
  } catch (e) { return null; }
}

/* build a track patch for one field (pure; null = unsupported field) */
function avMixUiTrackPatch(track, field, value) {
  try {
    const cur = (track && typeof track === "object") ? track : {};
    if (field === "gainDb") return { gainDb: avMixUiClampN(value, -60, 24, 0) };
    if (field === "pan") return { pan: avMixUiClampN(value, -1, 1, 0) };
    if (field === "sendA") return { sends: { a: avMixUiClampN(value, 0, 1, 0), b: avMixUiPathNum(cur, ["sends", "b"], 0) } };
    if (field === "sendB") return { sends: { a: avMixUiPathNum(cur, ["sends", "a"], 0), b: avMixUiClampN(value, 0, 1, 0) } };
    if (field === "duckDepth") {
      const src = (cur.duck && typeof cur.duck === "object" && typeof cur.duck.src === "string" && cur.duck.src) ? cur.duck.src : null;
      return { duck: { src: src, depthDb: avMixUiClampN(value, 0, 24, 0) } };
    }
    if (field === "duckSrc") {
      const v = (value == null || value === "") ? null : String(value);
      return { duck: { src: v, depthDb: avMixUiPathNum(cur, ["duck", "depthDb"], 0) } };
    }
    if (field === "mute") return { mute: !!value };
    if (field === "solo") return { solo: !!value };
    if (field === "fx.driveOn" || field === "fx.driveAmount" || field === "fx.dynOn" || field === "fx.dynThresh" || field === "fx.dynRatio") {
      const fx0 = (cur.fx && typeof cur.fx === "object") ? cur.fx : {};
      const fx = avMixUiObjCopy(fx0);
      const drive0 = (fx0.drive && typeof fx0.drive === "object") ? fx0.drive : {};
      const dyn0 = (fx0.dyn && typeof fx0.dyn === "object") ? fx0.dyn : {};
      if (field === "fx.driveOn") fx.drive = Object.assign(avMixUiObjCopy(drive0), { on: value ? 1 : 0 });
      else if (field === "fx.driveAmount") fx.drive = Object.assign(avMixUiObjCopy(drive0), { amount: avMixUiClampN(value, 0, 1, 0) });
      else if (field === "fx.dynOn") fx.dyn = Object.assign(avMixUiObjCopy(dyn0), { on: value ? 1 : 0 });
      else if (field === "fx.dynThresh") fx.dyn = Object.assign(avMixUiObjCopy(dyn0), { thresh: avMixUiClampN(value, -60, 0, -6) });
      else fx.dyn = Object.assign(avMixUiObjCopy(dyn0), { ratio: avMixUiClampN(value, 1, 20, 2) });
      return { fx: fx };
    }
    return null;
  } catch (e) { return null; }
}

/* the track's source badge text (pure) */
function avMixUiSrcText(source, id) {
  try {
    if (source && typeof source === "object") {
      const t = typeof source.type === "string" ? source.type : "";
      if (t === "take") return "take " + String(source.id || "(?)");
      if (t === "comp") return "comp " + String(source.id || "(?)");
      if (t === "engine") return "engine " + avMixUiMaskText(source.mask);
      if (t === "buffers") return "buffers";
      if (t) return t;
      return "?";
    }
    if (typeof source === "string" && source) return source;
  } catch (e) { /* fall through */ }
  return String(id || "?");
}

/* normalized per-track view for painting (pure) */
function avMixUiTrackView(meta, i) {
  const m = (meta && typeof meta === "object") ? meta : {};
  const idx = Math.max(0, Math.floor(Number(i) || 0));
  const id = (typeof m.id === "string" && m.id) ? m.id : ("m" + (idx + 1));
  const name = avMixUiClean((typeof m.name === "string" && m.name) ? m.name : id, 40) || id;
  return {
    id: id,
    name: name,
    srcText: avMixUiSrcText(m.source, id),
    mute: m.mute === true,
    solo: m.solo === true,
    duckSrc: (m.duck && typeof m.duck === "object" && typeof m.duck.src === "string") ? m.duck.src : "",
    gainDb: avMixUiPathNum(m, ["gainDb"], 0),
    pan: avMixUiPathNum(m, ["pan"], 0),
    sendA: avMixUiPathNum(m, ["sends", "a"], 0),
    sendB: avMixUiPathNum(m, ["sends", "b"], 0),
    duckDepth: avMixUiPathNum(m, ["duck", "depthDb"], 0),
    driveOn: avMixUiPathNum(m, ["fx", "drive", "on"], 0) > 0,
    driveAmount: avMixUiPathNum(m, ["fx", "drive", "amount"], 0),
    dynOn: avMixUiPathNum(m, ["fx", "dyn", "on"], 0) > 0,
    dynThresh: avMixUiPathNum(m, ["fx", "dyn", "thresh"], -6),
    dynRatio: avMixUiPathNum(m, ["fx", "dyn", "ratio"], 2),
  };
}

/* ---------- guarded DOM access (no throw, no noise) ---------- */

function avMixUiHost() {
  try {
    if (typeof document !== "undefined" && document && typeof document.getElementById === "function") {
      return document.getElementById("av-mix-host");
    }
  } catch (e) { /* no document */ }
  return null;
}

function avMixUiEl(sel) {
  try {
    const host = avMixUiHost();
    if (host && typeof host.querySelector === "function") return host.querySelector(sel);
  } catch (e) { /* no DOM */ }
  return null;
}

function avMixUiSetValue(el, v) {
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

function avMixUiSetText(host, sel, txt) {
  try { const el = host.querySelector(sel); if (el && el.textContent !== txt) el.textContent = txt; } catch (e) { /* no DOM */ }
}

function avMixUiSetChecked(el, on) {
  try { if (el && el.checked !== !!on) el.checked = !!on; return true; } catch (e) { return false; }
}

/* ---------- warnings (stateful wrappers over the pure list helpers) ---------- */

function avMixUiWarn(key, text) {
  try {
    avMixUiState.warnings = avMixUiWarnMerge(avMixUiState.warnings, String(key || "general"), avMixUiClean(text, 170), AV_MIX_UI_WARN_MAX);
  } catch (e) { /* never throws */ }
}

function avMixUiWarnDropKey(key) {
  try {
    const l = avMixUiState.warnings || [];
    for (let i = 0; i < l.length; i++) {
      if (l[i] && l[i].key === String(key || "")) { avMixUiState.warnings = avMixUiWarnDrop(l, key); return; }
    }
  } catch (e) { /* ok */ }
}

/* the mix engine facade is "present" when any pinned read/write exists */
function avMixUiMixApi() {
  return (typeof avMixList === "function") || (typeof avMixAddTrack === "function") ||
    (typeof avMixSetTrack === "function") || (typeof avMixRemoveTrack === "function") ||
    (typeof avMixClear === "function") || (typeof avMixSetParam === "function") ||
    (typeof avMixParams === "function") || (typeof avMixRender === "function") ||
    (typeof avMixExport === "function") || (typeof avMixAutoBalance === "function") ||
    (typeof avMixCompare === "function") || (typeof avMixSetRef === "function") ||
    (typeof avMixState === "function");
}

function avMixUiLoudApi() {
  return (typeof avLoudAnalyze === "function") || (typeof avLoudLufs === "function") ||
    (typeof avLoudTruePeak === "function") || (typeof avLoudCompare === "function");
}

function avMixUiKnobsApi() {
  return (typeof avKnobHTML === "function") && (typeof avKnobBind === "function");
}

/* degraded-module notes: set when missing, dropped when present (honest every paint) */
function avMixUiModulesNote() {
  if (avMixUiMixApi()) avMixUiWarnDropKey("modules.mix");
  else avMixUiWarn("modules.mix", "the mix engine (av_mix.js) is not loaded \u2014 mixing is unavailable");
  if (avMixUiLoudApi()) avMixUiWarnDropKey("modules.loud");
  else avMixUiWarn("modules.loud", "the loudness suite (av_loud.js) is not loaded \u2014 LUFS/true-peak meters and normalize are skipped by the engine");
  if (typeof avTakesList === "function") avMixUiWarnDropKey("modules.takes");
  else avMixUiWarn("modules.takes", "the takes module (av_takes.js) is not loaded \u2014 there are no takes to add; recording lives in the STUDIO card");
  if (typeof avCompList === "function") avMixUiWarnDropKey("modules.comps");
  else avMixUiWarn("modules.comps", "the comp engine (av_comp.js) is not loaded \u2014 there are no comps to add");
  if (avMixUiKnobsApi()) avMixUiWarnDropKey("modules.knobs");
  else avMixUiWarn("modules.knobs", "the knob framework (av_knob.js) is not loaded \u2014 the controls render read-only");
}

/* honest note when a single pinned function is absent while the module is present */
function avMixUiMissingNote(fn, what) {
  avMixUiWarn("missing." + String(fn || "fn"), "this build does not expose " + String(fn || "a needed function") + "() \u2014 " + String(what || "that action is unavailable"));
}

/* ---------- mirror reads (pinned apis, typeof-guarded, explicit reads only) ---------- */

function avMixUiMixListRead() {
  try {
    if (typeof avMixList !== "function") return { ok: false, list: [] };
    const l = avMixList();
    return { ok: true, list: Array.isArray(l) ? l : [] };
  } catch (e) { return { ok: false, list: [] }; }
}

function avMixUiMixParamsRead() {
  try {
    if (typeof avMixParams !== "function") return { ok: false, params: null };
    const p = avMixParams();
    return { ok: true, params: (p && typeof p === "object") ? p : null };
  } catch (e) { return { ok: false, params: null }; }
}

function avMixUiMixStateRead() {
  try {
    if (typeof avMixState !== "function") return null;
    const st = avMixState();
    return (st && typeof st === "object") ? st : null;
  } catch (e) { return null; }
}

function avMixUiTakesRead() {
  try {
    if (typeof avTakesList !== "function") return { ok: false, list: [] };
    const l = avTakesList();
    return { ok: true, list: Array.isArray(l) ? l : [] };
  } catch (e) { return { ok: false, list: [] }; }
}

function avMixUiCompsRead() {
  try {
    if (typeof avCompList !== "function") return { ok: false, list: [] };
    const l = avCompList();
    return { ok: true, list: Array.isArray(l) ? l : [] };
  } catch (e) { return { ok: false, list: [] }; }
}

function avMixUiFindTrack(id) {
  try {
    const read = avMixUiMixListRead();
    if (!read.ok) return null;
    for (let i = 0; i < read.list.length; i++) {
      const m = read.list[i];
      if (m && String(m.id) === String(id)) return m;
    }
  } catch (e) { /* none */ }
  return null;
}

/* ---------- async settle (receipts may be promises or sync values; never throws) ---------- */

function avMixUiSettle(p, cb) {
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
function avMixUiBusy() {
  const s = avMixUiState;
  return !!(s.busyAdd || s.busyRender || s.busyExport || s.busyAuto || s.busyRemove || s.busyRef);
}

/* ---------- the commit funnels (the ONLY mutations this card ever causes) ---------- */

function avMixUiApplyParam(engPath, value) {
  try {
    if (typeof avMixSetParam !== "function") {
      avMixUiMissingNote("avMixSetParam", "changing send / glue / master parameters is unavailable");
      return false;
    }
    let r = null;
    try { r = avMixSetParam(String(engPath), value); } catch (e) { r = { ok: false, error: String((e && e.message) || e || "refused") }; }
    if (avMixUiOK(r) === false) {
      const why = (r && typeof r === "object" && r.error) ? avMixUiErrText(r.error) : "refused";
      avMixUiWarn("set.param", "the mix engine refused " + String(engPath) + " \u2014 " + why);
      return false;
    }
    avMixUiWarnDropKey("set.param");
    return true;
  } catch (e) { return false; }
}

function avMixUiApplyTrackField(id, field, value) {
  try {
    if (typeof avMixSetTrack !== "function") {
      avMixUiMissingNote("avMixSetTrack", "changing track controls is unavailable");
      return false;
    }
    const cur = avMixUiFindTrack(id);
    if (!cur) {
      avMixUiWarn("set.track", "a track control fired for " + String(id) + " but that track no longer exists");
      return false;
    }
    const patch = avMixUiTrackPatch(cur, field, value);
    if (!patch) {
      avMixUiWarn("set.track", "the mix engine refused an unsupported track change (" + String(field) + ")");
      return false;
    }
    let r = null;
    try { r = avMixSetTrack(String(id), patch); } catch (e) { r = { ok: false, error: String((e && e.message) || e || "refused") }; }
    if (avMixUiOK(r) === false || (r && typeof r === "object" && Array.isArray(r.refused) && r.refused.length)) {
      const why = (r && typeof r === "object" && r.error) ? avMixUiErrText(r.error) : "refused";
      avMixUiWarn("set.track", "the mix engine refused a track change \u2014 " + why);
      return false;
    }
    avMixUiWarnDropKey("set.track");
    return true;
  } catch (e) { return false; }
}

/* the funnel entry for one mix.<...> path — what the avApplyParam wrap calls. Returns TRUE when
   the path is OURS (consumed — applied or honestly refused with a warning; never leaked to the
   engine); FALSE only for non-mix paths, which belong to the app funnel. */
function avMixUiParamHit(path, value) {
  try {
    if (typeof path !== "string" || path.indexOf(AV_MIX_UI_PATH_PREFIX) !== 0) return false;
    const parsed = avMixUiPathParse(path);
    if (!parsed) return true;   /* a mix.* path that is not ours is still consumed, never leaked */
    if (parsed.kind === "track") avMixUiApplyTrackField(parsed.id, parsed.field, value);
    else avMixUiApplyParam(parsed.path, value);
    return true;
  } catch (e) { return true; }
}

/* ---------- the avApplyParam WRAP (the av_mod.js technique, scoped to `mix.`) ---------- */

let avMixUiHooks = null;   /* { installed, wrapped, eventBound } */

function avMixUiParamEvent(ev) {
  const d = ev && ev.detail;
  if (!d) return;
  try { if (typeof d.path === "string" && d.path.indexOf(AV_MIX_UI_PATH_PREFIX) === 0) avMixUiParamHit(d.path, d.value); } catch (e) { /* never throws */ }
}

function avMixUiEnsureHooks() {
  if (!avMixUiHooks) avMixUiHooks = { installed: false, wrapped: false, eventBound: false };
  /* belt 1 — the event funnel avKnobCommit uses when no app hook exists (dormant otherwise) */
  if (!avMixUiHooks.eventBound) {
    try {
      if (typeof window !== "undefined" && window && typeof window.addEventListener === "function") {
        window.addEventListener("av-param", avMixUiParamEvent);
        avMixUiHooks.eventBound = true;
      }
    } catch (e) { /* no window — stays unbound */ }
  }
  /* belt 2 — the app funnel itself: one wrap, scoped, idempotent (heals a late-loaded funnel) */
  if (!avMixUiHooks.wrapped) {
    try {
      if (typeof avApplyParam === "function" && avApplyParam.__avMixUiWrap !== true) {
        const orig = avApplyParam;
        const wrapped = function (path, v, meta) {
          try {
            if (typeof path === "string" && path.indexOf(AV_MIX_UI_PATH_PREFIX) === 0) {
              avMixUiParamHit(path, v);      /* mix params are NOT engine params — consumed here */
              return true;
            }
          } catch (e) { /* never break the funnel */ }
          return orig(path, v, meta);
        };
        wrapped.__avMixUiWrap = true;
        avApplyParam = wrapped;
        avMixUiHooks.wrapped = true;
      }
    } catch (e) { /* funnel unreachable — the event belt still works */ }
  }
  avMixUiHooks.installed = avMixUiHooks.wrapped || avMixUiHooks.eventBound;
  return avMixUiHooks.installed;
}

/* commit a control value through the wrap's funnel entry (status optional; the funnel entry
   reports consumption, the direct applies below report success) */

/* ---------- markup (pure string builders; knob markup degrades honestly) ---------- */

function avMixUiKnobHTML(path, label, opts) {
  if (typeof avKnobHTML !== "function") {
    return '<span class="av-mix-knob-none av-note av-dim" title="the knob framework (av_knob.js) is not loaded">' + avMixUiEsc(label || "") + "</span>";
  }
  try { return avKnobHTML(path, label, opts || {}); } catch (e) { return ""; }
}

function avMixUiTrackKnobHTML(id, entry, value) {
  const opts = avMixUiObjCopy(entry.opts);
  opts.value = avMixUiNum(value, opts.def);
  return avMixUiKnobHTML("mix.track." + String(id) + "." + entry.field, entry.label, opts);
}

function avMixUiParamKnobHTML(entry, value) {
  const opts = avMixUiObjCopy(entry.opts);
  opts.value = avMixUiNum(value, opts.def);
  /* the wrapper carries a stable id (rig + parent reach it directly); the knob itself is the
     standard av-knob markup, committed through the mix. wrapper */
  return '<span class="av-mix-knob-box" id="' + avMixUiEsc(entry.id) + '">' + avMixUiKnobHTML("mix." + entry.path, entry.label, opts) + "</span>";
}

function avMixUiParamKnobValue(entry, params) {
  const v = (params && typeof params === "object") ? Number(params[entry.path]) : NaN;
  return isFinite(v) ? v : entry.opts.def;
}

function avMixUiDuckOptionsHTML(view, tracks) {
  let out = '<option value="">none</option>';
  try {
    const list = Array.isArray(tracks) ? tracks : [];
    for (let i = 0; i < list.length && i < AV_MIX_UI_TRACKS_MAX; i++) {
      const m = list[i];
      if (!m || typeof m !== "object") continue;
      const id = (typeof m.id === "string" && m.id) ? m.id : "";
      if (!id || id === view.id) continue;
      out += '<option value="' + avMixUiEsc(id) + '">' + avMixUiEsc(id) + "</option>";
    }
  } catch (e) { /* none */ }
  return out;
}

/* one track row (static markup; knob values prefilled from the view; fx knobs grouped
   drive | dyn, expanded state honours v.expanded) */
function avMixUiTrackRowHTML(v, tracks) {
  /* fx knobs grouped drive | dyn; the expander state comes from the view */
  const idEsc = avMixUiEsc(v.id);
  let cls = "av-mix-track";
  if (v.mute) cls += " av-mix-mute-on";
  if (v.solo) cls += " av-mix-solo-on";
  const row = AV_MIX_UI_TRACK_KNOBS;
  let knobs = "";
  let driveKnob = "";
  let dynKnobs = "";
  for (let i = 0; i < row.length; i++) {
    const e = row[i];
    if (e.field === "gainDb") knobs += avMixUiTrackKnobHTML(v.id, e, v.gainDb);
    else if (e.field === "pan") knobs += avMixUiTrackKnobHTML(v.id, e, v.pan);
    else if (e.field === "sendA") knobs += avMixUiTrackKnobHTML(v.id, e, v.sendA);
    else if (e.field === "sendB") knobs += avMixUiTrackKnobHTML(v.id, e, v.sendB);
    else if (e.field === "fx.driveAmount") driveKnob = avMixUiTrackKnobHTML(v.id, e, v.driveAmount);
    else if (e.field === "fx.dynThresh") dynKnobs += avMixUiTrackKnobHTML(v.id, e, v.dynThresh);
    else if (e.field === "fx.dynRatio") dynKnobs += avMixUiTrackKnobHTML(v.id, e, v.dynRatio);
  }
  return '<div class="' + cls + '" data-track="' + idEsc + '">' +
    '<div class="av-mix-track-head">' +
    '<span class="av-mix-track-name" title="' + idEsc + '">' + avMixUiEsc(v.id + " \u00b7 " + v.name) + "</span>" +
    '<span class="av-mix-track-src" title="the mix source">' + avMixUiEsc(v.srcText) + "</span>" +
    '<button type="button" class="av-btn mini av-mix-btn av-mix-mute' + (v.mute ? " av-mix-on" : "") + '" data-act="mute" data-track="' + idEsc + '" title="MUTE this track" aria-pressed="' + (v.mute ? "true" : "false") + '">MUTE</button>' +
    '<button type="button" class="av-btn mini av-mix-btn av-mix-solo' + (v.solo ? " av-mix-on" : "") + '" data-act="solo" data-track="' + idEsc + '" title="SOLO this track" aria-pressed="' + (v.solo ? "true" : "false") + '">SOLO</button>' +
    '<button type="button" class="av-btn mini av-mix-btn av-mix-fx-btn' + (v.expanded ? " av-mix-fx-open" : "") + '" data-act="fx" data-track="' + idEsc + '" title="Insert FX for this track (drive then dyn)" aria-expanded="' + (v.expanded ? "true" : "false") + '">FX</button>' +
    '<button type="button" class="av-btn mini av-mix-btn av-mix-remove" data-act="remove" data-track="' + idEsc + '" title="Remove this track" aria-label="Remove">\u2715</button>' +
    "</div>" +
    '<div class="av-mix-track-knobs">' + knobs + "</div>" +
    '<div class="av-mix-track-extra">' +
    '<span class="av-mix-sub">DUCK</span>' +
    '<select class="av-select av-mix-select av-mix-duck" data-mix-duck="1" data-track="' + idEsc + '" aria-label="Ducking source for ' + idEsc + '">' + avMixUiDuckOptionsHTML(v, tracks) + "</select>" +
    avMixUiTrackKnobHTML(v.id, { field: "duckDepth", label: "DEPTH", opts: { min: 0, max: 24, step: 0.5, def: 0, fmt: "db", size: "sm", hint: "duck depth" } }, v.duckDepth) +
    "</div>" +
    '<div class="av-mix-fx"' + (v.expanded ? "" : " hidden") + ">" +
    '<div class="av-mix-fx-row"><span class="av-mix-sub">DRIVE</span>' +
    '<label class="av-mix-lab" for="av-mix-fx-drive-' + idEsc + '">ON</label>' +
    '<input type="checkbox" class="av-mix-check" id="av-mix-fx-drive-' + idEsc + '" data-mix-toggle="1" data-mix-track="' + idEsc + '" data-mix-field="fx.driveOn"' + (v.driveOn ? " checked" : "") + ">" +
    driveKnob +
    "</div>" +
    '<div class="av-mix-fx-row"><span class="av-mix-sub">DYN</span>' +
    '<label class="av-mix-lab" for="av-mix-fx-dyn-' + idEsc + '">ON</label>' +
    '<input type="checkbox" class="av-mix-check" id="av-mix-fx-dyn-' + idEsc + '" data-mix-toggle="1" data-mix-track="' + idEsc + '" data-mix-field="fx.dynOn"' + (v.dynOn ? " checked" : "") + ">" +
    dynKnobs +
    "</div>" +
    "</div>" +
    "</div>";
}

function avMixUiAddOptionsHTML(takes, comps) {
  let out = '<option value="">pick a source\u2026</option>';
  try {
    const tl = (takes && takes.ok) ? takes.list : [];
    for (let i = 0; i < tl.length && i < 32; i++) {
      const m = tl[i];
      if (!m || typeof m !== "object") continue;
      const id = avMixUiStrField(m, ["id"]);
      if (!id) continue;
      const name = avMixUiClean(avMixUiStrField(m, ["name"]) || id, 30);
      out += '<option value="take:' + avMixUiEsc(id) + '">take ' + avMixUiEsc(id) + " \u00b7 " + avMixUiEsc(name) + " (" + avMixUiEsc(avMixUiSecsText(m.frames, m.rate)) + ")</option>";
    }
    const cl = (comps && comps.ok) ? comps.list : [];
    for (let i = 0; i < cl.length && i < 24; i++) {
      const m = cl[i];
      if (!m || typeof m !== "object") continue;
      const id = avMixUiStrField(m, ["id"]);
      if (!id) continue;
      const name = avMixUiClean(avMixUiStrField(m, ["name"]) || id, 30);
      const n = Array.isArray(m.segments) ? m.segments.length : 0;
      out += '<option value="comp:' + avMixUiEsc(id) + '">comp ' + avMixUiEsc(id) + " \u00b7 " + avMixUiEsc(name) + " (" + n + " seg" + (n === 1 ? "" : "s") + ")</option>";
    }
  } catch (e) { /* placeholder only */ }
  out += '<option value="engine">engine pattern</option>';
  return out;
}

function avMixUiToggleHTML(t, params) {
  const on = !!(params && avMixUiNum(params[t.path], 0) > 0);
  return '<label class="av-mix-lab" for="' + t.id + '">' + avMixUiEsc(t.label) + " ON</label>" +
    '<input type="checkbox" class="av-mix-check" id="' + t.id + '" data-mix-toggle="1" data-mix-path="' + avMixUiEsc(t.path) + '"' + (on ? " checked" : "") + ">";
}

function avMixUiBodyHTML() {
  const params = avMixUiMixParamsRead().params;
  const pknob = (id) => {
    for (let i = 0; i < AV_MIX_UI_PARAM_KNOBS.length; i++) if (AV_MIX_UI_PARAM_KNOBS[i].id === id) return AV_MIX_UI_PARAM_KNOBS[i];
    return null;
  };
  const kv = (id) => { const e = pknob(id); return e ? avMixUiParamKnobHTML(e, avMixUiParamKnobValue(e, params)) : ""; };
  const tog = (id) => {
    for (let i = 0; i < AV_MIX_UI_PARAM_TOGGLES.length; i++) if (AV_MIX_UI_PARAM_TOGGLES[i].id === id) return avMixUiToggleHTML(AV_MIX_UI_PARAM_TOGGLES[i], params);
    return "";
  };
  let modeOpts = "";
  for (let i = 0; i < AV_MIX_UI_VERB_MODES.length; i++) {
    const m = AV_MIX_UI_VERB_MODES[i];
    const sel = (params && String(params["send.A.verb.mode"]) === m) ? " selected" : "";
    modeOpts += '<option value="' + m + '"' + sel + ">" + m + "</option>";
  }
  let normOpts = "";
  for (let i = 0; i < AV_MIX_UI_NORM_TARGETS.length; i++) {
    const t = AV_MIX_UI_NORM_TARGETS[i];
    const sel = (params && Number(params["master.norm.target"]) === t) ? " selected" : "";
    normOpts += '<option value="' + t + '"' + sel + ">" + t + " LUFS</option>";
  }
  let autoOpts = "";
  for (let i = 0; i < AV_MIX_UI_AUTO_TARGETS.length; i++) {
    const t = AV_MIX_UI_AUTO_TARGETS[i];
    autoOpts += '<option value="' + t + '"' + (t === -18 ? " selected" : "") + ">" + t + " LUFS</option>";
  }
  let bitsOpts = "";
  for (let i = 0; i < AV_MIX_UI_BITS.length; i++) {
    bitsOpts += '<option value="' + AV_MIX_UI_BITS[i] + '"' + (AV_MIX_UI_BITS[i] === "24" ? " selected" : "") + ">" + AV_MIX_UI_BITS[i] + "</option>";
  }
  let ditherOpts = "";
  for (let i = 0; i < AV_MIX_UI_DITHERS.length; i++) {
    ditherOpts += '<option value="' + AV_MIX_UI_DITHERS[i] + '"' + (AV_MIX_UI_DITHERS[i] === "auto" ? " selected" : "") + ">" + AV_MIX_UI_DITHERS[i] + "</option>";
  }
  let engMask = "";
  for (let i = 0; i < AV_MIX_UI_ENG_TRACKS; i++) {
    engMask += '<label class="av-mix-lab"><input type="checkbox" class="av-mix-check av-mix-eng-mask" data-eng-mask="' + i + '" checked> T' + (i + 1) + "</label>";
  }
  return '<div class="av-mix" data-av-mix="1">' +
    '<div class="av-mix-head"><span class="av-mix-title">MIX</span>' +
    '<span class="av-mix-cap">Build a mixdown from takes, comps and the engine pattern: per-track gain / pan / sends, ducking and insert FX, a verb + delay send pair, bus glue and a master chain \u2014 then RENDER the mix in memory and EXPORT the WAV. The mix renders offline (no live per-track monitoring in v1); the mixdown WAV is the artifact.</span></div>' +
    '<div class="av-mix-status-line"><span class="av-mix-status av-mix-msg" id="av-mix-status" role="status">\u2026</span></div>' +

    '<section class="av-mix-sect" data-sect="tracks">' +
    '<div class="av-mix-sect-head"><span class="av-mix-sect-lbl">TRACKS</span>' +
    '<span class="av-mix-track-n" id="av-mix-track-n">0 tracks</span>' +
    '<span class="av-mix-rev" id="av-mix-rev"></span>' +
    '<button type="button" class="av-btn mini av-mix-btn av-mix-clear" id="av-mix-clear" title="Remove every mix track">CLEAR</button></div>' +
    '<div class="av-mix-add-row">' +
    '<select class="av-select av-mix-select av-mix-add-src" id="av-mix-add-src" aria-label="Add-track source">' + avMixUiAddOptionsHTML(avMixUiTakesRead(), avMixUiCompsRead()) + "</select>" +
    '<span class="av-mix-eng" id="av-mix-eng" hidden>' +
    "<span class=\"av-mix-sub\">MASK</span>" + engMask +
    '<label class="av-mix-lab" for="av-mix-eng-loops">LOOPS</label><input type="number" class="av-mix-num" id="av-mix-eng-loops" min="1" max="64" step="1" value="1" inputmode="numeric" aria-label="Engine pattern loops">' +
    '<label class="av-mix-lab" for="av-mix-eng-tail">TAIL (s)</label><input type="number" class="av-mix-num" id="av-mix-eng-tail" min="0" max="10" step="0.5" value="1" inputmode="decimal" aria-label="Engine tail seconds">' +
    "</span>" +
    '<button type="button" class="av-btn mini av-mix-btn av-mix-add" id="av-mix-add" title="Add the selected source as a mix track">ADD</button>' +
    "</div>" +
    '<div class="av-mix-tracks" id="av-mix-tracks"></div>' +
    '<p class="av-mix-tracks-none av-mix-none av-note av-dim" id="av-mix-tracks-none">No tracks yet \u2014 pick a take, a comp or the engine pattern above and press ADD.</p>' +
    "</section>" +

    '<section class="av-mix-sect" data-sect="sends">' +
    '<div class="av-mix-sect-head"><span class="av-mix-sect-lbl">SENDS</span>' +
    '<span class="av-mix-hint av-dim">post-fader taps \u2014 A \u2192 verb, B \u2192 delay</span></div>' +
    '<div class="av-mix-row"><span class="av-mix-sub">A \u00b7 VERB</span>' +
    kv("av-mix-send-a-return") +
    '<label class="av-mix-lab" for="av-mix-send-a-mode">MODE</label>' +
    '<select class="av-select av-mix-select" id="av-mix-send-a-mode" data-mix-param="send.A.verb.mode" aria-label="Verb mode">' + modeOpts + "</select>" +
    kv("av-mix-send-a-decay") +
    "</div>" +
    '<div class="av-mix-row"><span class="av-mix-sub">B \u00b7 DELAY</span>' +
    kv("av-mix-send-b-return") + kv("av-mix-send-b-time") + kv("av-mix-send-b-feedback") +
    "</div>" +
    "</section>" +

    '<section class="av-mix-sect" data-sect="glue">' +
    '<div class="av-mix-sect-head"><span class="av-mix-sect-lbl">GLUE</span></div>' +
    '<div class="av-mix-row">' + tog("av-mix-glue-on") + kv("av-mix-glue-thresh") + kv("av-mix-glue-ratio") + "</div>" +
    "</section>" +

    '<section class="av-mix-sect" data-sect="master">' +
    '<div class="av-mix-sect-head"><span class="av-mix-sect-lbl">MASTER</span></div>' +
    '<div class="av-mix-row">' + tog("av-mix-md-on") + kv("av-mix-md-amount") + "</div>" +
    '<div class="av-mix-row">' + tog("av-mix-mdyn-on") + kv("av-mix-mdyn-eqlo") + kv("av-mix-mdyn-eqhi") + kv("av-mix-mdyn-thresh") + kv("av-mix-mdyn-ratio") + kv("av-mix-mdyn-ceil") + "</div>" +
    '<div class="av-mix-row">' + tog("av-mix-norm-on") +
    '<label class="av-mix-lab" for="av-mix-norm-target">TARGET</label>' +
    '<select class="av-select av-mix-select" id="av-mix-norm-target" data-mix-param="master.norm.target" data-mix-num="1" aria-label="Normalize loudness target">' + normOpts + "</select>" +
    kv("av-mix-norm-ceil") +
    "</div>" +
    "</section>" +

    '<section class="av-mix-sect" data-sect="meters">' +
    '<div class="av-mix-sect-head"><span class="av-mix-sect-lbl">METERS</span>' +
    '<span class="av-mix-hint av-dim">from the last render receipt</span></div>' +
    '<div class="av-mix-meters">' +
    '<span class="av-mix-meter"><span class="av-mix-meter-lbl">LUFS</span><span class="av-mix-meter-val" id="av-mix-m-lufs">\u2014</span></span>' +
    '<span class="av-mix-meter"><span class="av-mix-meter-lbl">TRUE PEAK</span><span class="av-mix-meter-val" id="av-mix-m-dbtp">\u2014</span></span>' +
    '<span class="av-mix-meter"><span class="av-mix-meter-lbl">PEAK</span><span class="av-mix-meter-val" id="av-mix-m-peak">\u2014</span></span>' +
    '<span class="av-mix-meter"><span class="av-mix-meter-lbl">NORM</span><span class="av-mix-meter-val av-mix-meter-norm" id="av-mix-m-norm">norm off</span></span>' +
    "</div></section>" +

    '<section class="av-mix-sect" data-sect="render">' +
    '<div class="av-mix-sect-head"><span class="av-mix-sect-lbl">RENDER / EXPORT</span></div>' +
    '<div class="av-mix-row">' +
    '<button type="button" class="av-btn mini av-mix-btn av-mix-render" id="av-mix-render" title="Render the mixdown in memory (offline, chunked) with a live progress fraction">UPDATE MIXDOWN</button>' +
    '<span class="av-mix-render-val" id="av-mix-render-val">not rendered</span>' +
    "</div>" +
    '<div class="av-mix-row">' +
    '<button type="button" class="av-btn mini av-mix-btn av-mix-export" id="av-mix-export" title="Encode the last render as a WAV and download it">EXPORT WAV</button>' +
    '<label class="av-mix-lab" for="av-mix-bits">BITS</label>' +
    '<select class="av-select av-mix-select" id="av-mix-bits" data-mix-local="bits" aria-label="Export bit depth">' + bitsOpts + "</select>" +
    '<label class="av-mix-lab" for="av-mix-dither">DITHER</label>' +
    '<select class="av-select av-mix-select" id="av-mix-dither" data-mix-local="dither" aria-label="Export dither mode">' + ditherOpts + "</select>" +
    '<span class="av-mix-export-val" id="av-mix-export-val"></span>' +
    "</div>" +
    "</section>" +

    '<section class="av-mix-sect" data-sect="automix">' +
    '<div class="av-mix-sect-head"><span class="av-mix-sect-lbl">AUTO-MIX</span></div>' +
    '<div class="av-mix-row">' +
    '<label class="av-mix-lab" for="av-mix-auto-target">TARGET</label>' +
    '<select class="av-select av-mix-select" id="av-mix-auto-target" data-mix-local="autoTarget" aria-label="Auto-balance target">' + autoOpts + "</select>" +
    '<button type="button" class="av-btn mini av-mix-btn av-mix-auto" id="av-mix-auto" title="Measure every audible track and nudge its gain toward the target">AUTO-MIX</button>' +
    '<span class="av-mix-auto-val" id="av-mix-auto-val"></span>' +
    "</div>" +
    '<div class="av-mix-auto-table" id="av-mix-auto-table"></div>' +
    "</section>" +

    '<section class="av-mix-sect" data-sect="ab">' +
    '<div class="av-mix-sect-head"><span class="av-mix-sect-lbl">A/B</span></div>' +
    '<div class="av-mix-row">' +
    '<label class="av-mix-lab" for="av-mix-ref-file">LOAD REFERENCE</label>' +
    '<input type="file" class="av-mix-file" id="av-mix-ref-file" accept="audio/*" aria-label="Load an A/B reference file">' +
    '<span class="av-mix-ref-val" id="av-mix-ref-val">no reference loaded</span>' +
    "</div>" +
    '<div class="av-mix-row">' +
    '<button type="button" class="av-btn mini av-mix-btn av-mix-compare" id="av-mix-compare" title="Measure the mix and the reference (LUFS + true peak) and read the loudness delta">COMPARE</button>' +
    '<span class="av-mix-cmp-val" id="av-mix-cmp-val">no compare yet</span>' +
    "</div>" +
    '<div class="av-mix-row">' +
    '<button type="button" class="av-btn mini av-mix-btn av-mix-playab" id="av-mix-playab" title="Play the mixdown, then the loudness-matched reference, through one audio element">PLAY A/B</button>' +
    '<span class="av-mix-ab-val" id="av-mix-ab-val">stopped</span>' +
    "</div>" +
    "</section>" +

    '<div class="av-mix-warnings" id="av-mix-warnings" hidden><div class="av-mix-warn-head">WARNINGS</div></div>' +
    '<p class="av-mix-foot av-note av-dim" id="av-mix-foot">The mix renders offline \u2014 takes, comps and the engine pattern are copied in; nothing live is touched. Export uses the LAST render: change the mix and the export refuses until you UPDATE MIXDOWN again. A/B plays one element; the reference blob is pre-gained by 10^(gainToMatchDb/20) so the switch is loudness-matched (previews are 16-bit, undithered).</p>' +
    "</div>";
}

/* ---------- receipt/readout text builders ---------- */

function avMixUiNormText() {
  const lr = avMixUiState.lastRender;
  if (!lr || typeof lr !== "object") return "norm off";
  const n = lr.norm;
  if (!n || typeof n !== "object" || !(avMixUiNum(n.on, 0) > 0)) return "norm off";
  let t = "norm \u2192 " + avMixUiNum(n.target, -14).toFixed(0) + " \u00b7 " + avMixUiSignedDb(n.gainDb);
  if (n.limited === true) t += " \u00b7 TP limited";
  return t;
}

function avMixUiRenderValText() {
  const lr = avMixUiState.lastRender;
  if (!lr || typeof lr !== "object") return "not rendered";
  let t = "last render";
  if (lr.frames != null) t += " \u00b7 " + avMixUiSecsText(lr.frames, lr.rate);
  if (lr.lufs != null) t += " \u00b7 " + avMixUiNum(lr.lufs, 0).toFixed(1) + " LUFS";
  if (lr.clipped === true || avMixUiNum(lr.clipped, 0) > 0) t += " \u00b7 clipped";
  return t;
}

function avMixUiAutoRowView(r) {
  const m = (r && typeof r === "object") ? r : {};
  const id = avMixUiStrField(m, ["id"]) || "?";
  const name = avMixUiClean(avMixUiStrField(m, ["name"]) || id, 28);
  const lufs = avMixUiNumField(m, ["lufs"]);
  const delta = avMixUiNumField(m, ["deltaDb"]);
  const gain = avMixUiNumField(m, ["gainDb"]);
  const applied = m.applied === true;
  let note = applied ? "applied" : "held";
  if (lufs == null) note = "silent \u00b7 skipped";
  else if (delta != null && (delta <= -24 || delta >= 24)) note += " \u00b7 clamped";
  return {
    id: id, name: name,
    lufsText: lufs == null ? "\u2014" : lufs.toFixed(1) + " LUFS",
    deltaText: delta == null ? "\u2014" : "\u0394 " + avMixUiSignedDb(delta),
    gainText: gain == null ? "\u2014" : avMixUiSignedDb(gain),
    note: note,
  };
}

function avMixUiAutoTableHTML(rows) {
  try {
    if (!Array.isArray(rows) || !rows.length) return "";
    let out = "";
    for (let i = 0; i < rows.length && i < AV_MIX_UI_TRACKS_MAX; i++) {
      const v = avMixUiAutoRowView(rows[i]);
      out += '<div class="av-mix-auto-row" data-id="' + avMixUiEsc(v.id) + '">' +
        '<span class="av-mix-auto-id">' + avMixUiEsc(v.id) + "</span>" +
        '<span class="av-mix-auto-name">' + avMixUiEsc(v.name) + "</span>" +
        '<span class="av-mix-auto-lufs">' + avMixUiEsc(v.lufsText) + "</span>" +
        '<span class="av-mix-auto-delta">' + avMixUiEsc(v.deltaText) + "</span>" +
        '<span class="av-mix-auto-gain">' + avMixUiEsc(v.gainText) + "</span>" +
        '<span class="av-mix-auto-note">' + avMixUiEsc(v.note) + "</span>" +
        "</div>";
    }
    return out;
  } catch (e) { return ""; }
}

/* ---------- the anchor-blob download technique from av_comp_ui (never throws) ---------- */

function avMixUiAnchor(blob, buf, urlRaw, name) {
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
    a.download = name || "anvil_mixdown.wav";
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

/* ---------- A/B audio plumbing (one element; guarded every reach) ---------- */

function avMixUiAudioEl() {
  const s = avMixUiState;
  try {
    if (s.audio && typeof s.audio === "object") return s.audio;
    if (typeof document === "undefined" || !document || typeof document.createElement !== "function") return null;
    const a = document.createElement("audio");
    if (a && typeof a === "object") { try { a.preload = "auto"; } catch (e) { /* preload is a nicety */ } s.audio = a; return a; }
  } catch (e) { /* no DOM */ }
  return null;
}

function avMixUiAudioCtx() {
  const s = avMixUiState;
  try {
    if (s.audioCtx && typeof s.audioCtx === "object") return s.audioCtx;
    const Ctx = (typeof AudioContext === "function") ? AudioContext : ((typeof webkitAudioContext === "function") ? webkitAudioContext : null);
    if (!Ctx) return null;
    const ctx = new Ctx();
    s.audioCtx = ctx;
    return ctx;
  } catch (e) { return null; }
}

/* the mixdown preview blob: encoded from the render receipt's own arrays (never a re-render) */
function avMixUiMixURL() {
  const s = avMixUiState;
  try {
    const lr = s.lastRender;
    if (!lr || !lr.l) return "";
    const key = "mix:" + String(lr.at) + ":" + String(lr.frames);
    if (s.mixURLCache && s.mixURLCache.key === key) return s.mixURLCache.url;
    if (typeof avWavEncode !== "function") return "";
    const buf = avWavEncode({ l: lr.l, r: lr.r || lr.l, sr: avMixUiNum(lr.rate, AV_MIX_UI_RATE_DEF), bits: AV_MIX_UI_PREVIEW_BITS, dither: false });
    if (!buf) return "";
    if (typeof Blob !== "function" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return "";
    const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
    s.mixURLCache = { key: key, url: url };
    return url;
  } catch (e) { return ""; }
}

/* the reference preview blob: the reference samples PRE-GAINED by 10^(gainToMatchDb/20) — the
   documented A/B gain technique (§2.3); gainToMatchDb = mixLufs − refLufs is the gain to apply
   to the REFERENCE to match the mix, so the switch is loudness-matched. */
function avMixUiRefURL() {
  const s = avMixUiState;
  try {
    const ra = s.refArrays;
    if (!ra || !ra.l) return "";
    const gain = (s.compare && typeof s.compare === "object" && s.compare.gainToMatchDb != null)
      ? avMixUiDbToGain(s.compare.gainToMatchDb) : 1;
    const key = "ref:" + String(s.refLoadedAt) + ":" + gain.toFixed(4);
    if (s.refURLCache && s.refURLCache.key === key) return s.refURLCache.url;
    if (typeof avWavEncode !== "function") return "";
    const l = (gain === 1) ? ra.l : avMixUiGainApply(ra.l, gain);
    const r = (gain === 1) ? (ra.r || ra.l) : avMixUiGainApply(ra.r || ra.l, gain);
    if (!l) return "";
    const buf = avWavEncode({ l: l, r: r, sr: avMixUiNum(ra.sr, AV_MIX_UI_RATE_DEF), bits: AV_MIX_UI_PREVIEW_BITS, dither: false });
    if (!buf) return "";
    if (typeof Blob !== "function" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return "";
    const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
    s.refURLCache = { key: key, url: url };
    return url;
  } catch (e) { return ""; }
}

/* the play toggle: one audio element, switching between the mixdown blob and the reference blob */
function avMixUiPlay(kind) {
  const s = avMixUiState;
  try {
    const k = (kind === "ref") ? "ref" : "mix";
    if (!s.lastRender && k === "mix") {
      s.lastMsg = "render the mixdown first \u2014 PLAY uses the rendered mix";
      s.lastMsgKind = "err";
      avMixUiSync();
      return false;
    }
    const url = (k === "mix") ? avMixUiMixURL() : avMixUiRefURL();
    if (!url) {
      s.lastMsg = (k === "mix")
        ? "the mixdown preview could not be encoded (avWavEncode is missing or the render carries no channels)"
        : "load a reference file first \u2014 the preview decodes it in this card";
      s.lastMsgKind = "err";
      avMixUiSync();
      return false;
    }
    const a = avMixUiAudioEl();
    if (!a) {
      s.lastMsg = "this browser has no audio element \u2014 A/B playback is unavailable";
      s.lastMsgKind = "err";
      avMixUiSync();
      return false;
    }
    let t = 0;
    try { t = Number(a.currentTime); } catch (e) { t = 0; }
    try { a.src = url; } catch (e) { /* src refused */ }
    try { if (isFinite(t) && t > 0) a.currentTime = t; } catch (e) { /* keep going */ }
    try {
      const pr = (typeof a.play === "function") ? a.play() : null;
      if (pr && typeof pr.catch === "function") pr.catch(function () { /* autoplay refusal is the browser's call */ });
    } catch (e) { /* play refused */ }
    s.playKind = k;
    const gain = (s.compare && s.compare.gainToMatchDb != null) ? avMixUiNum(s.compare.gainToMatchDb, 0) : null;
    s.lastMsg = (k === "mix")
      ? "playing the mixdown preview (16-bit, undithered)"
      : ("playing the reference" + (gain == null ? " (no compare yet \u2014 unity gain)" : " (loudness-matched " + avMixUiSignedDb(gain) + ")"));
    s.lastMsgKind = "msg";
    avMixUiSync();
    return true;
  } catch (e) { return false; }
}

function avMixUiPlayToggle() {
  const s = avMixUiState;
  if (avMixUiBusy()) return false;
  const next = (s.playKind === "mix") ? "ref" : "mix";
  return avMixUiPlay(next);
}

/* ---------- status + paint ---------- */

function avMixUiIdleText() {
  if (!avMixUiMixApi()) return "the mix engine (av_mix.js) is not loaded \u2014 mixing is unavailable";
  const read = avMixUiMixListRead();
  if (!read.list.length) return "ready \u2014 pick a source above and press ADD, then UPDATE MIXDOWN";
  return read.list.length + " track" + (read.list.length === 1 ? "" : "s") + " in the mix \u2014 UPDATE MIXDOWN renders it";
}

function avMixUiStatusText() {
  const s = avMixUiState;
  if (s.busyAdd) return { text: "adding a track\u2026", kind: "msg" };
  if (s.busyRemove) return { text: "removing a track\u2026", kind: "msg" };
  if (s.busyRender) return { text: "rendering the mixdown\u2026" + (s.renderPct != null ? " " + s.renderPct + "%" : ""), kind: "msg" };
  if (s.busyExport) return { text: "encoding and downloading the mixdown WAV\u2026", kind: "msg" };
  if (s.busyAuto) return { text: "measuring every audible track\u2026", kind: "msg" };
  if (s.busyRef) return { text: "decoding the reference file\u2026", kind: "msg" };
  if (s.lastMsg) return { text: s.lastMsg, kind: (s.lastMsgKind === "err") ? "err" : "msg" };
  return { text: avMixUiIdleText(), kind: "msg" };
}

function avMixUiPaintStatus(host) {
  try {
    const st = avMixUiStatusText();
    const el = host.querySelector("#av-mix-status");
    if (el) {
      const cls = "av-mix-status " + (st.kind === "err" ? "av-mix-err" : "av-mix-msg");
      if (el.className !== cls) el.className = cls;
      if (el.textContent !== st.text) el.textContent = st.text;
    }
    return true;
  } catch (e) { return false; }
}

function avMixUiProgress(f) {
  try {
    const s = avMixUiState;
    let pct = Math.round(avMixUiClampN(f, 0, 1, 0) * 100);
    if (!isFinite(pct)) pct = 0;
    if (pct === s.renderPct) return;
    s.renderPct = pct;
    const host = avMixUiHost();
    if (host) avMixUiSetText(host, "#av-mix-status", "rendering the mixdown\u2026 " + pct + "%");
  } catch (e) { /* progress is best-effort */ }
}

function avMixUiPaintBtn(host, sel, disabled, label) {
  try {
    const el = host.querySelector(sel);
    if (!el) return false;
    if (el.disabled !== !!disabled) el.disabled = !!disabled;
    if (label != null && el.textContent !== label) el.textContent = label;
    return true;
  } catch (e) { return false; }
}

function avMixUiPaintAdd(host) {
  const s = avMixUiState;
  try {
    const takes = avMixUiTakesRead();
    const comps = avMixUiCompsRead();
    let key = (takes.ok ? "t" : "-") + "|";
    for (let i = 0; i < takes.list.length && i < 32; i++) {
      const m = takes.list[i] || {};
      key += String(m.id) + ":" + String(m.name) + ":" + String(m.frames) + ":" + String(m.rate) + "|";
    }
    key += (comps.ok ? "c" : "-") + "|";
    for (let i = 0; i < comps.list.length && i < 24; i++) {
      const m = comps.list[i] || {};
      key += String(m.id) + ":" + String(m.name) + ":" + (Array.isArray(m.segments) ? m.segments.length : "?") + "|";
    }
    const sel = host.querySelector("#av-mix-add-src");
    if (sel) {
      if (key !== s.addKey) {
        s.addKey = key;
        sel.innerHTML = avMixUiAddOptionsHTML(takes, comps);
      }
      /* keep a live selection, else default: the first real source, else the engine */
      const opts = [];
      try {
        const q = host.querySelectorAll ? host.querySelectorAll("#av-mix-add-src option") : [];
        for (let i = 0; i < q.length; i++) opts.push(String(q[i].getAttribute ? q[i].getAttribute("value") : ""));
      } catch (e) { /* options unreadable */ }
      let want = s.addSrc;
      let have = false;
      for (let i = 0; i < opts.length; i++) if (opts[i] === want) have = true;
      if (!have) {
        let first = "";
        for (let i = 0; i < opts.length; i++) { if (opts[i]) { first = opts[i]; break; } }
        want = first || "engine";
      }
      if (want !== s.addSrc) s.addSrc = want;
      avMixUiSetValue(sel, s.addSrc);
    }
    const eng = host.querySelector("#av-mix-eng");
    if (eng) eng.hidden = (s.addSrc !== "engine");
    avMixUiPaintBtn(host, "#av-mix-add", avMixUiBusy(), null);
    avMixUiPaintBtn(host, "#av-mix-clear", avMixUiBusy() || !avMixUiMixListRead().list.length, null);
    return true;
  } catch (e) { return false; }
}

function avMixUiPaintTracks(host) {
  const s = avMixUiState;
  try {
    const read = avMixUiMixListRead();
    const views = [];
    for (let i = 0; i < read.list.length && i < AV_MIX_UI_TRACKS_MAX; i++) {
      const v = avMixUiTrackView(read.list[i], i);
      v.expanded = !!s.expanded[v.id];
      views.push(v);
    }
    /* the STRUCTURAL key only: ids · names · sources · mute/solo · duck src · fx on-flags ·
       expander state. Knob values live OUTSIDE the key (synced through the avParams mirror +
       avKnobRefreshAll), so a value-only change (auto-mix, an external set — every commit bumps
       rev) can never rebuild a row while a knob drag is in flight. */
    let key = (read.ok ? "ok" : "no") + "|" + (avMixUiBusy() ? "b" : "-") + "|";
    for (let i = 0; i < views.length; i++) {
      const v = views[i];
      key += v.id + ":" + v.name + ":" + v.srcText + ":" + (v.mute ? 1 : 0) + ":" + (v.solo ? 1 : 0) + ":" + v.duckSrc + ":" + (v.driveOn ? 1 : 0) + ":" + (v.dynOn ? 1 : 0) + ":" + (v.expanded ? 1 : 0) + "|";
    }
    if (key !== s.rowsKey) {
      s.rowsKey = key;
      const box = host.querySelector("#av-mix-tracks");
      if (box) {
        let html = "";
        for (let i = 0; i < views.length; i++) html += avMixUiTrackRowHTML(views[i], read.list);
        box.innerHTML = html;
        if (typeof avKnobBind === "function" && box && typeof box.querySelectorAll === "function") {
          try { avKnobBind(box); } catch (e) { /* binding is a nicety */ }
        }
      }
    }
    const none = host.querySelector("#av-mix-tracks-none");
    if (none) none.hidden = views.length > 0;
    avMixUiSetText(host, "#av-mix-track-n", views.length + " track" + (views.length === 1 ? "" : "s"));
    const st = avMixUiMixStateRead();
    avMixUiSetText(host, "#av-mix-rev", st && st.rev != null ? ("rev " + avMixUiInt(st.rev, 0, 1e9, 0)) : "");
    return true;
  } catch (e) { return false; }
}

function avMixUiPaintParams(host) {
  try {
    const p = avMixUiMixParamsRead().params;
    /* toggles (write-on-change only) */
    for (let i = 0; i < AV_MIX_UI_PARAM_TOGGLES.length; i++) {
      const t = AV_MIX_UI_PARAM_TOGGLES[i];
      const el = host.querySelector("#" + t.id);
      avMixUiSetChecked(el, p ? avMixUiNum(p[t.path], 0) > 0 : false);
    }
    /* selects */
    const modeEl = host.querySelector("#av-mix-send-a-mode");
    if (modeEl && p) {
      const cur = String(p["send.A.verb.mode"] || "plate");
      const val = AV_MIX_UI_VERB_MODES.indexOf(cur) >= 0 ? cur : "plate";
      avMixUiSetValue(modeEl, val);
    }
    const normEl = host.querySelector("#av-mix-norm-target");
    if (normEl && p) {
      const cur = Number(p["master.norm.target"]);
      avMixUiSetValue(normEl, isFinite(cur) ? String(cur) : "-14");
    }
    /* local selects + numbers */
    avMixUiSetValue(host.querySelector("#av-mix-bits"), avMixUiState.bits);
    avMixUiSetValue(host.querySelector("#av-mix-dither"), avMixUiState.dither);
    avMixUiSetValue(host.querySelector("#av-mix-auto-target"), avMixUiState.autoTarget);
    avMixUiSetValue(host.querySelector("#av-mix-eng-loops"), String(avMixUiState.engLoops));
    avMixUiSetValue(host.querySelector("#av-mix-eng-tail"), String(avMixUiState.engTailS));
    /* knob visuals follow the mirror (values outside the row key) */
    if (typeof avKnobRefreshAll === "function") { try { avKnobRefreshAll(host); } catch (e) { /* refresh is a nicety */ } }
    return true;
  } catch (e) { return false; }
}

/* write the live engine values into the avParams mirror (harmless when av_knob is absent) */
function avMixUiMirrorState() {
  try {
    if (typeof avParams === "undefined" || !avParams) return false;
    const read = avMixUiMixListRead();
    for (let i = 0; i < read.list.length && i < AV_MIX_UI_TRACKS_MAX; i++) {
      const v = avMixUiTrackView(read.list[i], i);
      const base = "mix.track." + v.id + ".";
      avParams[base + "gainDb"] = v.gainDb;
      avParams[base + "pan"] = v.pan;
      avParams[base + "sendA"] = v.sendA;
      avParams[base + "sendB"] = v.sendB;
      avParams[base + "duckDepth"] = v.duckDepth;
      avParams[base + "fx.driveAmount"] = v.driveAmount;
      avParams[base + "fx.dynThresh"] = v.dynThresh;
      avParams[base + "fx.dynRatio"] = v.dynRatio;
    }
    const p = avMixUiMixParamsRead().params;
    if (p) {
      for (let i = 0; i < AV_MIX_UI_PARAM_KNOBS.length; i++) {
        const e = AV_MIX_UI_PARAM_KNOBS[i];
        const n = Number(p[e.path]);
        if (isFinite(n)) avParams["mix." + e.path] = n;
      }
    }
    return true;
  } catch (e) { return false; }
}

function avMixUiPaintMeters(host) {
  const s = avMixUiState;
  try {
    const lr = s.lastRender;
    avMixUiSetText(host, "#av-mix-m-lufs", lr ? avMixUiLufsText(lr.lufs) : "\u2014");
    avMixUiSetText(host, "#av-mix-m-dbtp", lr ? avMixUiDbtpText(lr.dbtp) : "\u2014");
    avMixUiSetText(host, "#av-mix-m-peak", lr ? avMixUiPeakText(lr.peak) : "\u2014");
    avMixUiSetText(host, "#av-mix-m-norm", avMixUiNormText());
    avMixUiSetText(host, "#av-mix-render-val", avMixUiRenderValText());
    const ex = s.lastExport;
    let ev = "";
    if (ex) {
      ev = "last export \u00b7 " + avMixUiClean(ex.name, 40) + (ex.bytes != null ? " \u00b7 " + avMixUiFmtBytes(ex.bytes) : "") +
        (ex.bits ? " \u00b7 " + ex.bits : "") + (ex.dither ? " \u00b7 " + ex.dither : "");
    }
    avMixUiSetText(host, "#av-mix-export-val", ev);
    avMixUiPaintBtn(host, "#av-mix-render", avMixUiBusy(), s.busyRender ? "RENDERING\u2026" : "UPDATE MIXDOWN");
    avMixUiPaintBtn(host, "#av-mix-export", avMixUiBusy(), s.busyExport ? "EXPORTING\u2026" : "EXPORT WAV");
    avMixUiPaintBtn(host, "#av-mix-auto", avMixUiBusy(), s.busyAuto ? "MEASURING\u2026" : "AUTO-MIX");
    avMixUiPaintBtn(host, "#av-mix-compare", avMixUiBusy(), "COMPARE");
    avMixUiPaintBtn(host, "#av-mix-playab", avMixUiBusy(), "PLAY A/B");
    return true;
  } catch (e) { return false; }
}

function avMixUiPaintAuto(host) {
  const s = avMixUiState;
  try {
    avMixUiSetText(host, "#av-mix-auto-val", s.autoRows && s.autoRows.length ? (s.autoRows.length + " tracks \u00b7 " + new Date(s.autoAt).toLocaleTimeString()) : "");
    const key = s.autoRows ? JSON.stringify(s.autoRows.map(function (r) { return avMixUiAutoRowView(r); })) : "";
    if (key !== s.autoKey) {
      s.autoKey = key;
      const box = host.querySelector("#av-mix-auto-table");
      if (box) box.innerHTML = avMixUiAutoTableHTML(s.autoRows);
    }
    return true;
  } catch (e) { return false; }
}

function avMixUiPaintAB(host) {
  const s = avMixUiState;
  try {
    let rv = "no reference loaded";
    if (s.ref) {
      rv = "ref loaded \u00b7 " + avMixUiNum(s.ref.seconds, 0).toFixed(2) + " s" + (s.refArrays && s.refArrays.sr ? " \u00b7 " + Math.round(s.refArrays.sr) + " Hz" : "") + (s.refArrays && s.refArrays.mono ? " \u00b7 mono \u2192 stereo" : "");
    } else if (s.refArrays) {
      rv = "ref loaded \u00b7 " + avMixUiNum(s.refArrays.sr, AV_MIX_UI_RATE_DEF) + " Hz";
    }
    avMixUiSetText(host, "#av-mix-ref-val", rv);
    let cv = "no compare yet";
    if (s.compare && typeof s.compare === "object") {
      const c = s.compare;
      const g = avMixUiNumField(c, ["gainToMatchDb"]);
      const m = (c.mix && typeof c.mix === "object") ? c.mix : {};
      const r = (c.ref && typeof c.ref === "object") ? c.ref : {};
      cv = "gain to match: " + avMixUiSignedDb(g) +
        " \u00b7 LUFS " + avMixUiLufsText(m.lufs).replace(" LUFS", "") + " / " + avMixUiLufsText(r.lufs).replace(" LUFS", "") +
        " \u00b7 dBTP " + avMixUiDbtpText(m.dbtp).replace(" dBTP", "") + " / " + avMixUiDbtpText(r.dbtp).replace(" dBTP", "");
    }
    avMixUiSetText(host, "#av-mix-cmp-val", cv);
    avMixUiSetText(host, "#av-mix-ab-val", s.playKind ? ("playing: " + s.playKind + " \u00b7 one element, loudness-matched") : "stopped");
    return true;
  } catch (e) { return false; }
}

function avMixUiPaintWarnings(host) {
  try {
    const box = host.querySelector("#av-mix-warnings");
    if (!box) return false;
    const list = avMixUiState.warnings || [];
    box.hidden = list.length === 0;
    let key = "";
    for (let i = 0; i < list.length; i++) key += list[i].key + ":" + list[i].text + "|";
    if (key !== avMixUiState.warnKey) {
      avMixUiState.warnKey = key;
      let html = '<div class="av-mix-warn-head">WARNINGS</div>';
      for (let i = 0; i < list.length; i++) html += '<div class="av-mix-warn-item">' + avMixUiEsc(list[i].text) + "</div>";
      box.innerHTML = html;
    }
    return true;
  } catch (e) { return false; }
}

/* full repaint: mirrors first (guarded), then every control (write-on-change only) */
function avMixUiSync() {
  const host = avMixUiHost();
  if (!host) return false;
  try {
    let card = null;
    try { card = (typeof host.querySelector === "function") ? host.querySelector(".av-mix") : null; } catch (e) { card = null; }
    if (!card) {
      host.innerHTML = avMixUiBodyHTML();
      avMixUiState.rowsKey = "";
      avMixUiState.addKey = "";
      avMixUiState.warnKey = "";
      avMixUiState.autoKey = "";
      avMixUiWire(host);
      if (typeof avKnobBind === "function") { try { avKnobBind(host); } catch (e) { /* binding is a nicety */ } }
    }
    avMixUiEnsureHooks();
    avMixUiModulesNote();
    avMixUiMirrorState();
    avMixUiPaintStatus(host);
    avMixUiPaintAdd(host);
    avMixUiPaintTracks(host);
    avMixUiPaintParams(host);
    avMixUiPaintMeters(host);
    avMixUiPaintAuto(host);
    avMixUiPaintAB(host);
    avMixUiPaintWarnings(host);
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- actions ---------- */

function avMixUiAddSrcChange(el) {
  const s = avMixUiState;
  try {
    if (el && typeof el.value !== "undefined") s.addSrc = String(el.value || "");
    avMixUiSync();
    return true;
  } catch (e) { return false; }
}

function avMixUiEngNum(idKey, lo, hi, def) {
  const s = avMixUiState;
  try {
    const el = avMixUiEl("#av-mix-eng-" + idKey);
    if (el && typeof el.value !== "undefined") {
      const n = Number(el.value);
      if (isFinite(n)) {
        if (idKey === "loops") s.engLoops = Math.max(lo, Math.min(hi, Math.round(n)));
        else s.engTailS = Math.max(lo, Math.min(hi, n));
      }
    }
  } catch (e) { /* keep the last value */ }
  return idKey === "loops" ? s.engLoops : s.engTailS;
}

function avMixUiEngMaskChange(el) {
  const s = avMixUiState;
  try {
    const part = avMixUiInt(el && el.getAttribute ? el.getAttribute("data-eng-mask") : null, 0, AV_MIX_UI_ENG_TRACKS - 1, null);
    if (part == null) return false;
    s.engMask[part] = (el && el.checked === true);
    return true;
  } catch (e) { return false; }
}

function avMixUiAdd() {
  const s = avMixUiState;
  try {
    if (avMixUiBusy()) return false;
    if (typeof avMixAddTrack !== "function") {
      avMixUiMissingNote("avMixAddTrack", "adding tracks is unavailable");
      s.lastMsg = "this build cannot add tracks (avMixAddTrack is missing)";
      s.lastMsgKind = "err";
      avMixUiSync();
      return false;
    }
    let source = null;
    let label = "";
    const raw = String(s.addSrc || "");
    if (raw.indexOf("take:") === 0) {
      const id = raw.slice(5);
      if (id) { source = { type: "take", id: id }; label = "take " + id; }
    } else if (raw.indexOf("comp:") === 0) {
      const id = raw.slice(5);
      if (id) { source = { type: "comp", id: id }; label = "comp " + id; }
    } else if (raw === "engine") {
      avMixUiEngNum("loops", 1, 64, 1);
      avMixUiEngNum("tail", 0, 10, 1);
      source = { type: "engine", mask: s.engMask.slice(0), loops: s.engLoops, tailS: s.engTailS };
      label = "engine pattern (" + avMixUiMaskText(s.engMask) + ", " + s.engLoops + " loop" + (s.engLoops === 1 ? "" : "s") + ")";
    }
    if (!source) {
      s.lastMsg = "pick a source first (a take, a comp or the engine pattern)";
      s.lastMsgKind = "err";
      avMixUiSync();
      return false;
    }
    s.busyAdd = true;
    s.lastMsg = "adding " + label + "\u2026";
    s.lastMsgKind = "msg";
    avMixUiSync();
    let r = null;
    try { r = avMixAddTrack({ source: source }); } catch (e) { r = { ok: false, error: String((e && e.message) || e || "add failed") }; }
    s.busyAdd = false;
    if (avMixUiOK(r) === false) {
      const why = (r && typeof r === "object" && r.error) ? avMixUiErrText(r.error) : "refused";
      s.lastMsg = "the track was not added \u2014 " + why;
      s.lastMsgKind = "err";
      avMixUiWarn("add.fail", "the track was not added \u2014 " + why);
    } else {
      let id = "";
      if (r && typeof r === "object") {
        id = avMixUiStrField(r, ["id"]);
        if (!id && r.track && typeof r.track === "object") id = avMixUiStrField(r.track, ["id"]);
      }
      if (!id) {
        const read = avMixUiMixListRead();
        const last = read.list.length ? read.list[read.list.length - 1] : null;
        id = last ? avMixUiStrField(last, ["id"]) : "";
      }
      s.lastMsg = "track added" + (id ? " (" + id + ")" : "") + " \u2014 " + label;
      s.lastMsgKind = "msg";
      avMixUiWarnDropKey("add.fail");
    }
    avMixUiSync();
    return true;
  } catch (e) { return false; }
}

function avMixUiRemove(idArg) {
  const s = avMixUiState;
  try {
    const id = String(idArg == null ? "" : idArg);
    if (!id) return false;
    if (avMixUiBusy()) return false;
    if (typeof avMixRemoveTrack !== "function") {
      avMixUiMissingNote("avMixRemoveTrack", "removing tracks is unavailable");
      s.lastMsg = "this build cannot remove tracks (avMixRemoveTrack is missing)";
      s.lastMsgKind = "err";
      avMixUiSync();
      return false;
    }
    s.busyRemove = true;
    let ok = true;
    try { if (avMixRemoveTrack(id) === false) ok = false; } catch (e) { ok = false; }
    s.busyRemove = false;
    if (ok) {
      delete s.expanded[id];
      s.lastMsg = "track " + id + " removed";
      s.lastMsgKind = "msg";
      avMixUiWarnDropKey("remove.fail");
    } else {
      s.lastMsg = "the track could not be removed (it may no longer exist)";
      s.lastMsgKind = "err";
      avMixUiWarn("remove.fail", "the track could not be removed \u2014 it may no longer exist");
    }
    avMixUiSync();
    return ok;
  } catch (e) { return false; }
}

function avMixUiClear() {
  const s = avMixUiState;
  try {
    if (avMixUiBusy()) return false;
    if (typeof avMixClear !== "function") {
      avMixUiMissingNote("avMixClear", "clearing the mix is unavailable");
      s.lastMsg = "this build cannot clear the mix (avMixClear is missing)";
      s.lastMsgKind = "err";
      avMixUiSync();
      return false;
    }
    if (!avMixUiMixListRead().list.length) {
      s.lastMsg = "the mix is already empty";
      s.lastMsgKind = "msg";
      avMixUiSync();
      return false;
    }
    let ok = true;
    try { if (avMixClear() === false) ok = false; } catch (e) { ok = false; }
    s.expanded = {};
    s.lastMsg = ok ? "the mix was cleared" : "the mix could not be cleared";
    s.lastMsgKind = ok ? "msg" : "err";
    avMixUiSync();
    return ok;
  } catch (e) { return false; }
}

function avMixUiToggleField(id, field) {
  const cur = avMixUiFindTrack(id);
  if (!cur) return false;
  const next = !(cur[field] === true);
  const ok = avMixUiApplyTrackField(id, field, next ? 1 : 0);
  const s = avMixUiState;
  s.lastMsg = ok ? (field + " " + (next ? "on" : "off") + " \u2014 " + String(id)) : ("the " + field + " change was refused");
  s.lastMsgKind = ok ? "msg" : "err";
  avMixUiSync();
  return ok;
}

function avMixUiToggleFx(id) {
  const s = avMixUiState;
  try {
    const key = String(id == null ? "" : id);
    if (!key) return false;
    s.expanded[key] = !s.expanded[key];
    if (!s.expanded[key]) delete s.expanded[key];
    avMixUiSync();
    return true;
  } catch (e) { return false; }
}

function avMixUiRender() {
  const s = avMixUiState;
  try {
    if (avMixUiBusy()) return false;
    if (typeof avMixRender !== "function") {
      avMixUiMissingNote("avMixRender", "rendering is unavailable");
      s.lastMsg = "this build cannot render the mix (avMixRender is missing)";
      s.lastMsgKind = "err";
      avMixUiSync();
      return false;
    }
    s.busyRender = true;
    s.renderPct = null;
    s.lastMsg = "rendering the mixdown\u2026";
    s.lastMsgKind = "msg";
    avMixUiSync();
    let p = null;
    try { p = avMixRender({ progress: avMixUiProgress }); } catch (e) { p = { ok: false, error: String((e && e.message) || e || "render failed") }; }
    avMixUiSettle(p, avMixUiRenderSettle);
    return true;
  } catch (e) { return false; }
}

function avMixUiRenderSettle(r) {
  const s = avMixUiState;
  s.busyRender = false;
  s.renderPct = null;
  try {
    if (avMixUiOK(r) === false) {
      const why = (r && typeof r === "object" && r.error) ? avMixUiErrText(r.error) : "refused";
      s.lastMsg = "the render was refused \u2014 " + why;
      s.lastMsgKind = "err";
      avMixUiWarn("render.fail", "the render was refused \u2014 " + why);
      avMixUiSync();
      return;
    }
    const frames = avMixUiNumField(r, ["frames"]);
    const rate = avMixUiNumField(r, ["rate"]) || AV_MIX_UI_RATE_DEF;
    const lufs = avMixUiNumField(r, ["lufs"]);
    const dbtp = avMixUiNumField(r, ["dbtp"]);
    const peak = avMixUiNumField(r, ["peak"]);
    const clipped = !!(r && typeof r === "object" && r.clipped === true);
    const norm = (r && typeof r === "object" && r.norm && typeof r.norm === "object") ? r.norm : null;
    const l = (r && typeof r === "object" && r.l && typeof r.l.length === "number") ? r.l : null;
    const rr = (r && typeof r === "object" && r.r && typeof r.r.length === "number") ? r.r : null;
    s.lastRender = {
      frames: frames, rate: rate, lufs: lufs, dbtp: dbtp, peak: peak,
      clipped: clipped, norm: norm, rev: (r && typeof r === "object" && r.rev != null) ? r.rev : null,
      at: Date.now(), l: l, r: rr,
    };
    s.mixURLCache = null;
    let line = "mixdown rendered";
    if (frames != null) line += " \u2014 " + avMixUiSecsText(frames, rate);
    if (lufs != null) line += " \u00b7 " + avMixUiLufsText(lufs);
    if (dbtp != null) line += " \u00b7 " + avMixUiDbtpText(dbtp);
    if (peak != null) line += " \u00b7 peak " + avMixUiPeakText(peak);
    if (clipped) line += " \u00b7 clipped";
    s.lastMsg = line;
    s.lastMsgKind = clipped ? "err" : "msg";
    if (clipped) avMixUiWarn("render.clip", "the render clipped \u2014 lower track gains, the glue threshold or the master limiter ceiling");
    else avMixUiWarnDropKey("render.clip");
    avMixUiWarnDropKey("render.fail");
    const warnings = (r && typeof r === "object" && Array.isArray(r.warnings)) ? r.warnings : [];
    const refused = (r && typeof r === "object" && Array.isArray(r.refused)) ? r.refused : [];
    if (warnings.length) avMixUiWarn("render.warn", "the render reported: " + avMixUiClean(warnings.slice(0, 3).join(" \u00b7 "), 150));
    else avMixUiWarnDropKey("render.warn");
    if (refused.length) avMixUiWarn("render.refused", "the render skipped: " + avMixUiClean(refused.slice(0, 3).join(" \u00b7 "), 150));
    else avMixUiWarnDropKey("render.refused");
  } catch (e) { /* settle never throws */ }
  avMixUiSync();
}

function avMixUiExport() {
  const s = avMixUiState;
  try {
    if (avMixUiBusy()) return false;
    if (typeof avMixExport !== "function") {
      avMixUiMissingNote("avMixExport", "WAV export is unavailable");
      s.lastMsg = "this build cannot export the mixdown (avMixExport is missing)";
      s.lastMsgKind = "err";
      avMixUiSync();
      return false;
    }
    if (!s.lastRender) {
      s.lastMsg = "render the mixdown first \u2014 EXPORT uses the last render";
      s.lastMsgKind = "err";
      avMixUiSync();
      return false;
    }
    /* proactive stale check: a mutation since the render means the export would be refused */
    const st = avMixUiMixStateRead();
    if (st && st.rev != null && s.lastRender.rev != null && Number(st.rev) !== Number(s.lastRender.rev)) {
      s.lastMsg = "the mix changed since the last render \u2014 press UPDATE MIXDOWN, then EXPORT";
      s.lastMsgKind = "err";
      avMixUiSync();
      return false;
    }
    s.busyExport = true;
    s.lastMsg = "encoding the mixdown WAV (" + s.bits + " / dither " + s.dither + ")\u2026";
    s.lastMsgKind = "msg";
    avMixUiSync();
    let p = null;
    try { p = avMixExport({ bits: (s.bits === "16" ? 16 : (s.bits === "24" ? 24 : "32f")), dither: s.dither }); }
    catch (e) { p = { ok: false, error: String((e && e.message) || e || "export failed") }; }
    avMixUiSettle(p, avMixUiExportSettle);
    return true;
  } catch (e) { return false; }
}

function avMixUiExportSettle(r) {
  const s = avMixUiState;
  s.busyExport = false;
  try {
    if (avMixUiOK(r) === false) {
      const why = (r && typeof r === "object" && r.error) ? avMixUiErrText(r.error) : "refused";
      s.lastMsg = "the export was refused \u2014 " + why;
      s.lastMsgKind = "err";
      avMixUiWarn("export.fail", "the export was refused \u2014 " + why);
      avMixUiSync();
      return;
    }
    const name = (r && typeof r === "object" && typeof r.name === "string" && r.name) ? avMixUiClean(r.name, 80) : "anvil_mixdown.wav";
    const bytes = (r && typeof r === "object") ? avMixUiNumField(r, ["bytes"]) : null;
    const blob = (r && typeof r === "object" && r.blob && typeof r.blob === "object") ? r.blob : null;
    const buf = (r && typeof r === "object" && r.buffer) ? r.buffer : null;
    const urlRaw = (r && typeof r === "object") ? avMixUiStrField(r, ["url"]) : "";
    const wavInfo = (r && typeof r === "object" && r.wavInfo && typeof r.wavInfo === "object") ? r.wavInfo : null;
    const dith = (r && typeof r === "object" && r.dither && typeof r.dither === "object") ? r.dither : null;
    const bits = (r && typeof r === "object") ? avMixUiNumField(r, ["bits"]) : null;
    const downloaded = avMixUiAnchor(blob, buf, urlRaw, name);
    let line = "exported \u201c" + name + "\u201d";
    if (bytes != null) line += " \u2014 " + avMixUiFmtBytes(bytes);
    const sr = wavInfo ? avMixUiNumField(wavInfo, ["sr", "sampleRate"]) : null;
    const wbits = wavInfo ? avMixUiNumField(wavInfo, ["bits", "bitDepth"]) : null;
    if (sr != null || wbits != null) line += " \u00b7 " + (sr != null ? Math.round(sr) + " Hz" : "? Hz") + " \u00b7 " + (wbits != null ? Math.round(wbits) + "-bit" : "? bit");
    if (dith) line += " \u00b7 dither " + avMixUiClean(String(dith.mode || "?"), 12) + (dith.applied === true ? " (applied)" : " (off)");
    line += downloaded ? " \u2014 check your downloads" : " \u2014 no download handle could be opened";
    s.lastMsg = line;
    s.lastMsgKind = downloaded ? "msg" : "err";
    s.lastExport = {
      name: name, bytes: bytes == null ? null : Math.round(bytes), downloaded: downloaded === true,
      bits: (bits != null ? String(bits) : s.bits), dither: dith ? avMixUiClean(String(dith.mode || ""), 12) : s.dither,
      at: Date.now(),
    };
    if (downloaded) avMixUiWarnDropKey("export.fail");
    else avMixUiWarn("export.dl", "the WAV was built but no download handle could be opened \u2014 the receipt still carries it");
    avMixUiWarnDropKey("export.fail");
    try {
      if (typeof window !== "undefined" && window) {
        window.__avMixUiLastExport = { kind: "mix", name: name, bytes: s.lastExport.bytes, downloaded: downloaded === true, bits: s.lastExport.bits, at: Date.now() };
      }
    } catch (e) { /* stamp is a nicety */ }
  } catch (e) { /* settle never throws */ }
  avMixUiSync();
}

function avMixUiAuto() {
  const s = avMixUiState;
  try {
    if (avMixUiBusy()) return false;
    if (typeof avMixAutoBalance !== "function") {
      avMixUiMissingNote("avMixAutoBalance", "auto-mix is unavailable");
      s.lastMsg = "this build cannot auto-balance (avMixAutoBalance is missing)";
      s.lastMsgKind = "err";
      avMixUiSync();
      return false;
    }
    const target = avMixUiClampN(Number(s.autoTarget), -24, -6, -18);
    s.busyAuto = true;
    s.lastMsg = "measuring every audible track\u2026";
    s.lastMsgKind = "msg";
    avMixUiSync();
    let r = null;
    try { r = avMixAutoBalance({ target: target }); } catch (e) { r = { ok: false, error: String((e && e.message) || e || "auto-balance failed") }; }
    avMixUiSettle(r, avMixUiAutoSettle);
    return true;
  } catch (e) { return false; }
}

function avMixUiAutoSettle(r) {
  const s = avMixUiState;
  s.busyAuto = false;
  try {
    if (avMixUiOK(r) === false) {
      const why = (r && typeof r === "object" && r.error) ? avMixUiErrText(r.error) : "refused";
      s.lastMsg = "auto-mix was refused \u2014 " + why;
      s.lastMsgKind = "err";
      avMixUiWarn("auto.fail", "auto-mix was refused \u2014 " + why);
      avMixUiSync();
      return;
    }
    const rows = (r && typeof r === "object" && Array.isArray(r.rows)) ? r.rows : [];
    const target = (r && typeof r === "object") ? avMixUiNumField(r, ["target"]) : null;
    const ms = (r && typeof r === "object") ? avMixUiNumField(r, ["ms"]) : null;
    s.autoRows = rows;
    s.autoAt = Date.now();
    let applied = 0, clamped = 0, silent = 0;
    for (let i = 0; i < rows.length; i++) {
      const m = rows[i] || {};
      if (m.applied === true) applied += 1;
      const d = Number(m.deltaDb);
      if (isFinite(d) && (d <= -24 || d >= 24)) clamped += 1;
      if (m.lufs == null) silent += 1;
    }
    let line = "auto-mix: " + applied + "/" + rows.length + " track" + (rows.length === 1 ? "" : "s") + " balanced";
    if (target != null) line += " to " + target + " LUFS";
    if (clamped) line += " \u00b7 " + clamped + " clamped";
    if (silent) line += " \u00b7 " + silent + " silent skipped";
    if (ms != null) line += " \u00b7 " + Math.round(ms) + " ms";
    s.lastMsg = line;
    s.lastMsgKind = "msg";
    avMixUiWarnDropKey("auto.fail");
  } catch (e) { /* settle never throws */ }
  avMixUiSync();
}

function avMixUiCompare() {
  const s = avMixUiState;
  try {
    if (avMixUiBusy()) return false;
    if (typeof avMixCompare !== "function") {
      avMixUiMissingNote("avMixCompare", "A/B compare is unavailable");
      s.lastMsg = "this build cannot compare (avMixCompare is missing)";
      s.lastMsgKind = "err";
      avMixUiSync();
      return false;
    }
    let r = null;
    try { r = avMixCompare(); } catch (e) { r = { ok: false, error: String((e && e.message) || e || "compare failed") }; }
    if (avMixUiOK(r) === false) {
      const why = (r && typeof r === "object" && r.error) ? avMixUiErrText(r.error) : "refused";
      s.lastMsg = "the compare was refused \u2014 " + why;
      s.lastMsgKind = "err";
      avMixUiWarn("cmp.fail", "the compare was refused \u2014 " + why);
      avMixUiSync();
      return false;
    }
    const g = avMixUiNumField(r, ["gainToMatchDb"]);
    s.compare = {
      gainToMatchDb: g,
      mix: (r && typeof r === "object" && r.mix && typeof r.mix === "object") ? r.mix : null,
      ref: (r && typeof r === "object" && r.ref && typeof r.ref === "object") ? r.ref : null,
      at: Date.now(),
    };
    s.refURLCache = null;   /* the reference preview picks up the new gain */
    s.lastMsg = "compare \u2014 gain to match: " + avMixUiSignedDb(g);
    s.lastMsgKind = "msg";
    avMixUiWarnDropKey("cmp.fail");
    avMixUiSync();
    return true;
  } catch (e) { return false; }
}

/* ---------- reference file (arrayBuffer -> decodeAudioData -> avMixSetRef) ---------- */

function avMixUiReadBytes(file) {
  return new Promise(function (resolve) {
    try {
      if (file && typeof file.arrayBuffer === "function") {
        file.arrayBuffer().then(function (b) { resolve(b || null); }, function () { resolve(null); });
        return;
      }
      if (typeof FileReader === "function" && file) {
        const fr = new FileReader();
        fr.onload = function () { resolve(fr.result || null); };
        fr.onerror = function () { resolve(null); };
        fr.onabort = function () { resolve(null); };
        fr.readAsArrayBuffer(file);
        return;
      }
      resolve(null);
    } catch (e) { resolve(null); }
  });
}

function avMixUiDecode(buf) {
  return new Promise(function (resolve) {
    try {
      if (!buf) { resolve({ ok: false, error: "the file could not be read" }); return; }
      const ctx = avMixUiAudioCtx();
      if (!ctx || typeof ctx.decodeAudioData !== "function") { resolve({ ok: false, error: "no AudioContext decoder in this browser" }); return; }
      let settled = false;
      const done = function (ab) {
        if (settled) return;
        settled = true;
        try {
          if (!ab || typeof ab.getChannelData !== "function" || !(ab.length > 0)) { resolve({ ok: false, error: "the file could not be decoded as audio" }); return; }
          const chans = Math.max(1, Math.floor(Number(ab.numberOfChannels) || 1));
          const sr = avMixUiNum(ab.sampleRate, AV_MIX_UI_RATE_DEF);
          const c0 = ab.getChannelData(0);
          const l = (c0 && typeof c0.slice === "function") ? c0.slice(0) : avMixUiGainApply(c0, 1);
          const c1 = chans > 1 ? ab.getChannelData(1) : c0;
          const rr = (c1 && typeof c1.slice === "function") ? c1.slice(0) : avMixUiGainApply(c1, 1);
          resolve({ ok: true, l: l, r: rr, sr: sr, mono: chans < 2 });
        } catch (e) { resolve({ ok: false, error: "the decoded audio could not be read" }); }
      };
      try {
        const p = ctx.decodeAudioData(buf, function (ab) { done(ab); }, function () { done(null); });
        if (p && typeof p.then === "function") p.then(function (ab) { done(ab); }, function () { done(null); });
      } catch (e) { resolve({ ok: false, error: "the file could not be decoded as audio" }); }
    } catch (e) { resolve({ ok: false, error: "the decode failed" }); }
  });
}

function avMixUiRefFile(el) {
  const s = avMixUiState;
  try {
    if (avMixUiBusy()) return false;
    if (typeof avMixSetRef !== "function") {
      avMixUiMissingNote("avMixSetRef", "loading an A/B reference is unavailable");
      s.lastMsg = "this build cannot set a reference (avMixSetRef is missing)";
      s.lastMsgKind = "err";
      avMixUiSync();
      return false;
    }
    let file = null;
    try { file = (el && el.files && el.files[0]) ? el.files[0] : null; } catch (e) { file = null; }
    if (!file) {
      s.lastMsg = "choose an audio file first \u2014 LOAD REFERENCE decodes it here";
      s.lastMsgKind = "err";
      avMixUiSync();
      return false;
    }
    s.busyRef = true;
    s.lastMsg = "decoding the reference file\u2026";
    s.lastMsgKind = "msg";
    avMixUiSync();
    avMixUiReadBytes(file).then(function (buf) {
      return avMixUiDecode(buf);
    }).then(function (dec) {
      try {
        if (!dec || dec.ok !== true || !dec.l) {
          s.busyRef = false;
          s.lastMsg = "the reference could not be decoded \u2014 " + avMixUiErrText(dec && dec.error);
          s.lastMsgKind = "err";
          avMixUiWarn("ref.fail", "the reference could not be decoded");
          avMixUiSync();
          return;
        }
        let r = null;
        try { r = avMixSetRef({ l: dec.l, r: dec.r || dec.l, sr: dec.sr }); } catch (e) { r = { ok: false, error: String((e && e.message) || e || "ref failed") }; }
        s.busyRef = false;
        if (avMixUiOK(r) === false) {
          const why = (r && typeof r === "object" && r.error) ? avMixUiErrText(r.error) : "refused";
          s.lastMsg = "the reference was decoded but the mix engine refused it \u2014 " + why;
          s.lastMsgKind = "err";
          avMixUiWarn("ref.fail", "the mix engine refused the reference \u2014 " + why);
        } else {
          const refMeta = (r && typeof r === "object" && r.ref && typeof r.ref === "object") ? r.ref : null;
          s.ref = refMeta;
          s.refArrays = { l: dec.l, r: dec.r || dec.l, sr: dec.sr, mono: dec.mono === true };
          s.refLoadedAt = Date.now();
          s.refURLCache = null;
          s.lastMsg = "reference loaded" + (refMeta && refMeta.seconds != null ? " \u2014 " + avMixUiNum(refMeta.seconds, 0).toFixed(2) + " s" : "") + (dec.mono ? " (mono \u2192 stereo)" : "");
          s.lastMsgKind = "msg";
          avMixUiWarnDropKey("ref.fail");
        }
        avMixUiSync();
      } catch (e) { s.busyRef = false; avMixUiSync(); }
    }).catch(function () {
      s.busyRef = false;
      s.lastMsg = "the reference load failed";
      s.lastMsgKind = "err";
      avMixUiSync();
    });
    return true;
  } catch (e) { return false; }
}

/* ---------- event delegation (wired once per host element) ---------- */

function avMixUiClick(e) {
  try {
    const t = (e && e.target && typeof e.target.closest === "function") ? e.target : null;
    if (!t) return;
    if (t.closest("#av-mix-add")) { avMixUiAdd(); return; }
    if (t.closest("#av-mix-clear")) { avMixUiClear(); return; }
    if (t.closest("#av-mix-render")) { avMixUiRender(); return; }
    if (t.closest("#av-mix-export")) { avMixUiExport(); return; }
    if (t.closest("#av-mix-auto")) { avMixUiAuto(); return; }
    if (t.closest("#av-mix-compare")) { avMixUiCompare(); return; }
    if (t.closest("#av-mix-playab")) { avMixUiPlayToggle(); return; }
    const act = t.closest("[data-act]");
    if (act) {
      const what = String(act.getAttribute("data-act") || "");
      const id = String(act.getAttribute("data-track") || "");
      if (what === "mute" && id) { avMixUiToggleField(id, "mute"); return; }
      if (what === "solo" && id) { avMixUiToggleField(id, "solo"); return; }
      if (what === "remove" && id) { avMixUiRemove(id); return; }
      if (what === "fx" && id) { avMixUiToggleFx(id); return; }
    }
  } catch (err) { /* a listener never throws outward */ }
}

function avMixUiChange(e) {
  const s = avMixUiState;
  try {
    const t = (e && e.target && typeof e.target.closest === "function") ? e.target : null;
    if (!t) return;
    /* add-picker + engine options */
    if (t.closest("#av-mix-add-src")) { avMixUiAddSrcChange(t); return; }
    if (t.closest("#av-mix-eng-loops")) { avMixUiEngNum("loops", 1, 64, 1); return; }
    if (t.closest("#av-mix-eng-tail")) { avMixUiEngNum("tail", 0, 10, 1); return; }
    const mask = t.closest("[data-eng-mask]");
    if (mask) { avMixUiEngMaskChange(mask); return; }
    /* export / auto selects (UI-local) */
    const local = t.closest("[data-mix-local]");
    if (local) {
      const which = String(local.getAttribute("data-mix-local") || "");
      if (which === "bits") { s.bits = String(local.value || "24"); }
      else if (which === "dither") { s.dither = String(local.value || "auto"); }
      else if (which === "autoTarget") { s.autoTarget = String(Number(local.value) || -18); }
      avMixUiSync();
      return;
    }
    /* duck selects (per-track) */
    const duck = t.closest("[data-mix-duck]");
    if (duck) {
      const id = String(duck.getAttribute("data-track") || "");
      if (id) {
        const ok = avMixUiApplyTrackField(id, "duckSrc", String(duck.value || ""));
        s.lastMsg = ok ? ("ducking " + id + (duck.value ? " from " + String(duck.value) : " off")) : "the duck change was refused";
        s.lastMsgKind = ok ? "msg" : "err";
        avMixUiSync();
      }
      return;
    }
    /* engine-param toggles + selects (send/glue/master), and per-track fx toggles (direct
       applies so the status line reflects the engine's actual answer) */
    const tog = t.closest("input[data-mix-toggle]");
    if (tog) {
      const track = tog.getAttribute("data-mix-track");
      const field = String(tog.getAttribute("data-mix-field") || "");
      const enginePath = String(tog.getAttribute("data-mix-path") || "");
      const label = String(field || enginePath || "toggle");
      const ok = track ? avMixUiApplyTrackField(track, field, tog.checked ? 1 : 0)
                       : avMixUiApplyParam(enginePath, tog.checked ? 1 : 0);
      s.lastMsg = ok ? (label + (tog.checked ? " on" : " off")) : "the change was refused";
      s.lastMsgKind = ok ? "msg" : "err";
      avMixUiSync();
      return;
    }
    const par = t.closest("select[data-mix-param]");
    if (par) {
      const path = String(par.getAttribute("data-mix-param") || "");
      const num = par.getAttribute("data-mix-num") === "1";
      const ok = avMixUiApplyParam(path, num ? Number(par.value) : String(par.value));
      s.lastMsg = ok ? (path + " \u2192 " + String(par.value)) : "the change was refused";
      s.lastMsgKind = ok ? "msg" : "err";
      avMixUiSync();
      return;
    }
    /* reference file input */
    if (t.closest("#av-mix-ref-file")) { avMixUiRefFile(t); return; }
  } catch (err) { /* a listener never throws outward */ }
}

function avMixUiWire(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  try {
    if (host.dataset && host.dataset.avMixUiWired === "1") return true;   /* one delegation per host element */
    if (host.dataset) host.dataset.avMixUiWired = "1";
    host.addEventListener("click", avMixUiClick);
    host.addEventListener("change", avMixUiChange);
    return true;
  } catch (e) { return false; }
}

/* ---------- poll (mix signature; ~1.5 s, no rAF) ---------- */

function avMixUiSig() {
  try {
    let out = "";
    const read = avMixUiMixListRead();
    const list = read.list;
    out += (read.ok ? "ok" : "no") + "|" + list.length + "|";
    for (let i = 0; i < list.length && i < AV_MIX_UI_TRACKS_MAX; i++) {
      const m = list[i] || {};
      out += String(m.id) + ":" + String(m.name) + ":" + (m.mute === true ? 1 : 0) + ":" + (m.solo === true ? 1 : 0) + ":" + avMixUiSrcText(m.source, m.id) + "|";
    }
    const st = avMixUiMixStateRead();
    if (st) out += "r" + String(st.rev) + ":" + (st.ref && typeof st.ref === "object" ? (String(st.ref.kind) + "," + String(st.ref.seconds)) : "-");
    return out;
  } catch (e) { return ""; }
}

function avMixUiPoll() {
  const s = avMixUiState;
  try {
    if (!s.inited) return false;
    const sig = avMixUiSig();
    if (sig === s.pollSig) return false;
    s.pollSig = sig;
    avMixUiSync();
    return true;
  } catch (e) { return false; }
}

function avMixUiStartPoll() {
  const s = avMixUiState;
  try {
    if (s.timerId != null) return false;
    if (typeof setInterval !== "function") return false;
    s.timerId = setInterval(avMixUiPoll, AV_MIX_UI_POLL_MS);
    return s.timerId != null;
  } catch (e) { return false; }
}

/* ---------- init (mount, idempotent, re-mountable) ---------- */

function avMixUiInit() {
  const host = avMixUiHost();
  if (!host) return false;
  try {
    let card = null;
    try { card = (typeof host.querySelector === "function") ? host.querySelector(".av-mix") : null; } catch (e) { card = null; }
    if (!card) {
      host.innerHTML = avMixUiBodyHTML();
      avMixUiState.rowsKey = "";
      avMixUiState.addKey = "";
      avMixUiState.warnKey = "";
      avMixUiState.autoKey = "";
    }
    avMixUiWire(host);
    if (typeof avKnobBind === "function") { try { avKnobBind(host); } catch (e) { /* binding is a nicety */ } }
    const s = avMixUiState;
    s.inited = true;
    s.mounts += 1;
    avMixUiEnsureHooks();
    avMixUiModulesNote();
    avMixUiSync();
    avMixUiStartPoll();
    return true;
  } catch (e) { return false; }
}

/* ---------- observables ---------- */

function avMixUiSnap() {
  const host = avMixUiHost();
  const s = avMixUiState;
  const read = avMixUiMixListRead();
  const st = avMixUiMixStateRead();
  const snap = {
    version: AV_MIX_UI_VERSION,
    inited: !!s.inited,
    mounts: s.mounts,
    host: !!host,
    wired: !!(host && host.dataset && host.dataset.avMixUiWired === "1"),
    card: false,
    modules: {
      mix: avMixUiMixApi(),
      loud: avMixUiLoudApi(),
      knobs: avMixUiKnobsApi(),
      takes: (typeof avTakesList === "function"),
      comps: (typeof avCompList === "function"),
      list: (typeof avMixList === "function"),
      add: (typeof avMixAddTrack === "function"),
      setTrack: (typeof avMixSetTrack === "function"),
      remove: (typeof avMixRemoveTrack === "function"),
      clear: (typeof avMixClear === "function"),
      setParam: (typeof avMixSetParam === "function"),
      params: (typeof avMixParams === "function"),
      render: (typeof avMixRender === "function"),
      export: (typeof avMixExport === "function"),
      autoBalance: (typeof avMixAutoBalance === "function"),
      setRef: (typeof avMixSetRef === "function"),
      compare: (typeof avMixCompare === "function"),
    },
    hooks: avMixUiHooks ? { installed: !!avMixUiHooks.installed, wrapped: !!avMixUiHooks.wrapped, eventBound: !!avMixUiHooks.eventBound } : null,
    tracks: { count: read.list.length, rev: st && st.rev != null ? st.rev : null },
    sel: { addSrc: s.addSrc, engMask: s.engMask.slice(0), engLoops: s.engLoops, engTailS: s.engTailS, expanded: Object.keys(s.expanded) },
    export: { bits: s.bits, dither: s.dither },
    auto: { target: s.autoTarget, rows: s.autoRows ? s.autoRows.length : 0, at: s.autoAt },
    ref: (s.ref && typeof s.ref === "object") ? { kind: s.ref.kind, seconds: s.ref.seconds, arrays: !!s.refArrays } : (s.refArrays ? { kind: "buffers", seconds: avMixUiNum(s.refArrays.l ? s.refArrays.l.length : 0, 0) / avMixUiNum(s.refArrays.sr, AV_MIX_UI_RATE_DEF), arrays: true } : null),
    compare: (s.compare && typeof s.compare === "object") ? { gainToMatchDb: avMixUiNumField(s.compare, ["gainToMatchDb"]) } : null,
    busy: {
      add: !!s.busyAdd, render: !!s.busyRender, export: !!s.busyExport,
      auto: !!s.busyAuto, remove: !!s.busyRemove, ref: !!s.busyRef,
    },
    play: { kind: s.playKind },
    lastRender: s.lastRender ? {
      frames: s.lastRender.frames, rate: s.lastRender.rate, lufs: avMixUiNumField(s.lastRender, ["lufs"]),
      dbtp: avMixUiNumField(s.lastRender, ["dbtp"]), peak: avMixUiNumField(s.lastRender, ["peak"]),
      clipped: s.lastRender.clipped === true, rev: s.lastRender.rev, hasChannels: !!s.lastRender.l,
    } : null,
    lastExport: s.lastExport ? {
      name: s.lastExport.name, bytes: s.lastExport.bytes, downloaded: s.lastExport.downloaded === true,
      bits: s.lastExport.bits, dither: s.lastExport.dither,
    } : null,
    status: s.lastMsg, statusKind: s.lastMsgKind,
    warnings: (s.warnings || []).map(function (w) { return w.text; }),
    classes: avMixUiClasses(),
  };
  try { if (host && host.querySelector) snap.card = !!host.querySelector(".av-mix"); } catch (e) { snap.card = false; }
  return snap;
}

function avMixUiClasses() {
  return [
    "av-mix", "av-mix-head", "av-mix-title", "av-mix-cap",
    "av-mix-status-line", "av-mix-status", "av-mix-msg", "av-mix-err",
    "av-mix-sect", "av-mix-sect-head", "av-mix-sect-lbl", "av-mix-hint",
    "av-mix-track-n", "av-mix-rev", "av-mix-btn", "av-mix-clear",
    "av-mix-add-row", "av-mix-select", "av-mix-add-src", "av-mix-eng",
    "av-mix-eng-mask", "av-mix-eng-loops", "av-mix-eng-tail", "av-mix-num",
    "av-mix-add", "av-mix-tracks", "av-mix-track", "av-mix-track-head",
    "av-mix-track-name", "av-mix-track-src", "av-mix-track-knobs", "av-mix-track-extra",
    "av-mix-mute", "av-mix-solo", "av-mix-on", "av-mix-mute-on", "av-mix-solo-on",
    "av-mix-fx-btn", "av-mix-fx-open", "av-mix-remove",
    "av-mix-duck", "av-mix-fx", "av-mix-fx-row", "av-mix-check",
    "av-mix-none", "av-mix-tracks-none", "av-mix-knob-none", "av-mix-knob-box",
    "av-mix-row", "av-mix-lab", "av-mix-sub",
    "av-mix-send-a-return", "av-mix-send-a-mode", "av-mix-send-a-decay",
    "av-mix-send-b-return", "av-mix-send-b-time", "av-mix-send-b-feedback",
    "av-mix-glue-on", "av-mix-glue-thresh", "av-mix-glue-ratio",
    "av-mix-md-on", "av-mix-md-amount", "av-mix-mdyn-on", "av-mix-mdyn-eqlo",
    "av-mix-mdyn-eqhi", "av-mix-mdyn-thresh", "av-mix-mdyn-ratio", "av-mix-mdyn-ceil",
    "av-mix-norm-on", "av-mix-norm-target", "av-mix-norm-ceil",
    "av-mix-meters", "av-mix-meter", "av-mix-meter-lbl", "av-mix-meter-val", "av-mix-meter-norm",
    "av-mix-render", "av-mix-render-val", "av-mix-export", "av-mix-export-val",
    "av-mix-bits", "av-mix-dither",
    "av-mix-auto-target", "av-mix-auto", "av-mix-auto-val", "av-mix-auto-table",
    "av-mix-auto-row", "av-mix-auto-id", "av-mix-auto-name", "av-mix-auto-lufs",
    "av-mix-auto-delta", "av-mix-auto-gain", "av-mix-auto-note",
    "av-mix-file", "av-mix-ref-file", "av-mix-ref-val", "av-mix-compare", "av-mix-cmp-val",
    "av-mix-playab", "av-mix-ab-val",
    "av-mix-warnings", "av-mix-warn-head", "av-mix-warn-item",
    "av-mix-foot",
    "av-mix-m-lufs", "av-mix-m-dbtp", "av-mix-m-peak", "av-mix-m-norm",
  ];
}

/* ---------- debug/verify handle ---------- */

if (typeof window !== "undefined") {
  try {
    window.__avMixUi = {
      version: AV_MIX_UI_VERSION,
      init: function () { return avMixUiInit(); },
      sync: function () { return avMixUiSync(); },
      classes: function () { return avMixUiClasses(); },
      state: function () { return avMixUiSnap(); },
      add: function () { return avMixUiAdd(); },
      remove: function (id) { return avMixUiRemove(id); },
      clear: function () { return avMixUiClear(); },
      apply: function (path, v) { return avMixUiParamHit(path, v); },
      setParam: function (path, v) { return avMixUiParamHit("mix." + String(path || ""), v); },
      setTrackField: function (id, field, v) { return avMixUiApplyTrackField(id, field, v); },
      render: function () { return avMixUiRender(); },
      export: function () { return avMixUiExport(); },
      auto: function (target) { if (target != null) avMixUiState.autoTarget = String(target); return avMixUiAuto(); },
      compare: function () { return avMixUiCompare(); },
      play: function (kind) { return avMixUiPlay(kind); },
      stop: function () {
        try {
          const s = avMixUiState;
          if (s.audio && typeof s.audio.pause === "function") s.audio.pause();
          s.playKind = "";
          avMixUiSync();
          return true;
        } catch (e) { return false; }
      },
      refFile: function (f) { return avMixUiRefFile({ files: [f] }); },
      src: function (v) { avMixUiState.addSrc = String(v == null ? "" : v); avMixUiSync(); return avMixUiState.addSrc; },
    };
  } catch (e) { /* no window — nothing to publish */ }
}
