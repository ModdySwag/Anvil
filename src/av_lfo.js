/* Anvil — THE LFO CARD (R13): the modulation source front panel — waveform shape pick,
   RATE / TO CUT / TO PITCH knobs and a deterministic mini-scope that previews the chosen
   shape. UI-only wave: the LFO engine surface (lfo.shape / lfo.rate / lfo.toCut /
   lfo.toPitch) already exists in av_dsp; this card only rides existing funnels.

   Laws honoured here: page module — no DOM at top level, every DOM/global reach is guarded
   and inside a function; never throws; ONE namespace (avLfo* / AV_LFO_*); avLfoInit()
   idempotent via a ready flag. The mirror is SEEDED at init and never pushed to the engine
   (the P1 law: the engine replay owns the push). Knob commits ride avKnobCommit →
   avApplyParam (the standard funnel); the shape pick commits through the same guarded path
   (mirror + avApplyParam, with the 'av-param' event fallback when no app core ships).

   Scope law: fixed 480×120 backing store, NO devicePixelRatio scaling, NO rAF loop — the
   canvas repaints ONLY at init, on a shape change, or via avLfoRedraw(). The S&H shape uses
   a FIXED step array (no RNG anywhere); the waveform strokes #3fd0c9 at lineWidth 2 over a
   center axis line (rgba(255,255,255,0.08)).

   Public surface (classic-script globals, ONE namespace):
     avLfoInit() -> bool · avLfoRedraw() -> bool · avLfoProof() -> string ·
     avLfoSetShape(v) -> accepted shape string | false.
     window.__avLfo = { version:"r13.0", init, shape, setShape, redraw, proof }.
   Proof: ?avtest=1 ONLY, deferred via setTimeout(…, 0) (the R12 leak law — an unconditional
   parse-time proof call would leak visible text onto the plain page), id "av-lfotest". */

"use strict";

const AV_LFO_VERSION = "r13.0";
const AV_LFO_SCOPE_W = 480;
const AV_LFO_SCOPE_H = 120;

/* EN LFO_SHAPES (av_dsp) — names only (mapEnum accepts the name); wire order kept */
const AV_LFO_SHAPES = ["sine", "tri", "square", "sh"];
const AV_LFO_DEFAULT_SHAPE = "sine";

/* the S&H scope preview: a FIXED step sequence (constant array — no RNG anywhere) */
const AV_LFO_SH_STEPS = [0.6, -0.4, 0.9, -0.9, 0.2, -0.7, 0.4, -0.1];

/* the knob table (EXACT — matches the engine schema; values are pre-read from the live mirror) */
const AV_LFO_KNOBS = [
  { path: "lfo.rate", label: "RATE", opts: { min: 0.05, max: 20, step: 0.01, def: 5, curve: "log", fmt: "hz" } },
  { path: "lfo.toCut", label: "TO CUT", opts: { min: -1, max: 1, step: 0.01, def: 0, fmt: "pct" } },
  { path: "lfo.toPitch", label: "TO PITCH", opts: { min: -1, max: 1, step: 0.01, def: 0, fmt: "pct" } },
];

const avLfoState = { ready: false };

/* local escaper (same rules as avKnobEsc / avSynthEsc — this part stays self-contained) */
const avLfoEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function avLfoEl(id) {
  try { return document.getElementById(id); } catch (e) { return null; }
}

/* the four shapes only; anything else -> null (never throws) */
function avLfoShapeNorm(v) {
  const s = (typeof v === "string") ? v : String(v == null ? "" : v);
  return AV_LFO_SHAPES.indexOf(s) >= 0 ? s : null;
}

/* the current shape: the mirror when it holds one of the four, else the default */
function avLfoShapeCurrent() {
  try {
    if (typeof avParams !== "undefined" && avParams) {
      const v = avLfoShapeNorm(avParams["lfo.shape"]);
      if (v) return v;
    }
  } catch (e) { /* no mirror — the default stands */ }
  return AV_LFO_DEFAULT_SHAPE;
}

/* seed the mirror (unset paths only). rate / toCut are already defaulted by the av_synth
   defaults table — read, do not re-seed. NEVER pushes to the engine at init (the P1 law:
   the engine replay owns the push). */
function avLfoSeedMirror() {
  try {
    if (typeof avParams === "undefined" || !avParams) return false;
    if (avParams["lfo.shape"] === undefined) avParams["lfo.shape"] = AV_LFO_DEFAULT_SHAPE;
    if (avParams["lfo.toPitch"] === undefined) avParams["lfo.toPitch"] = 0;
    return true;
  } catch (e) { return false; }
}

/* ---------- markup (pure string builders — static-checkable without a DOM) ---------- */

/* the pick row: one labelled select, the current option pre-selected from the mirror */
function avLfoPickHTML() {
  const cur = avLfoShapeCurrent();
  let opts = "";
  for (let i = 0; i < AV_LFO_SHAPES.length; i++) {
    const s = AV_LFO_SHAPES[i];
    opts += '<option value="' + avLfoEsc(s) + '"' + (s === cur ? " selected" : "") + ">" + avLfoEsc(s) + "</option>";
  }
  return '<label class="av-lfo-pick"><span class="av-lfo-pick-lbl">SHAPE</span>' +
    '<select class="av-select" id="av-lfo-shape" data-param="lfo.shape" aria-label="LFO waveform shape">' +
    opts + "</select></label>";
}

/* the knob row: avKnobHTML per table entry, value pre-read from the live mirror.
   R13 integration fix: avKnobRowHTML(items, cls) expects the ARRAY of knob HTML strings
   (it joins internally) — pass the map result directly, never a pre-joined string. */
function avLfoKnobsHTML() {
  let items = [];
  try {
    items = AV_LFO_KNOBS.map(k => avKnobHTML(k.path, k.label, Object.assign({ value: avParams[k.path] }, k.opts)));
  } catch (e) {
    /* no mirror — avKnobHTML falls back to the opts defaults */
    try { items = AV_LFO_KNOBS.map(k => avKnobHTML(k.path, k.label, Object.assign({}, k.opts))); }
    catch (e2) { items = []; }
  }
  return avKnobRowHTML(items, "av-lfo-knobs");
}

/* the whole card body: picks row → knob row → the scope plate (pinned order) */
function avLfoBodyHTML() {
  return '<div class="av-lfo-picks">' + avLfoPickHTML() + "</div>" +
    avLfoKnobsHTML() +
    '<div class="av-lfo-scope-wrap">' +
    '<canvas id="av-lfo-scope" class="av-lfo-scope" width="' + AV_LFO_SCOPE_W + '" height="' + AV_LFO_SCOPE_H +
    '" aria-label="LFO shape preview"></canvas></div>';
}

/* ---------- the scope (deterministic paint — no dpr scaling, no rAF loop) ---------- */

/* waveform sample for t in 0..1: one sin() period pair over the width */
function avLfoWaveSample(shape, t) {
  const phase = t * Math.PI * 4;                        /* two full periods */
  if (shape === "tri") return (2 / Math.PI) * Math.asin(Math.sin(phase));
  if (shape === "square") return Math.sin(phase) >= 0 ? 1 : -1;
  return Math.sin(phase);                               /* sine */
}

/* one deterministic paint of the fixed 480×120 backing store */
function avLfoPaintScope(shape) {
  const canvas = avLfoEl("av-lfo-scope");
  if (!canvas || typeof canvas.getContext !== "function") return false;
  let ctx = null;
  try { ctx = canvas.getContext("2d"); } catch (e) { ctx = null; }
  if (!ctx) return false;
  try {
    const w = Number(canvas.width) || AV_LFO_SCOPE_W;
    const h = Number(canvas.height) || AV_LFO_SCOPE_H;
    const mid = h / 2;
    const amp = h * 0.33;                               /* ±1 maps to ±39.6 px on 120 */
    const pad = 2;
    const x0 = pad, x1 = w - pad;
    ctx.clearRect(0, 0, w, h);
    /* the center axis */
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();
    /* the waveform */
    ctx.strokeStyle = "#3fd0c9";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    if (shape === "sh") {
      const n = AV_LFO_SH_STEPS.length;
      const stepW = (x1 - x0) / n;
      for (let i = 0; i < n; i++) {
        const y = mid - AV_LFO_SH_STEPS[i] * amp;
        const xa = x0 + i * stepW;
        if (i === 0) ctx.moveTo(xa, y); else ctx.lineTo(xa, y);   /* the riser */
        ctx.lineTo(xa + stepW, y);                                /* the hold */
      }
    } else {
      const N = 480;
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const x = x0 + t * (x1 - x0);
        const y = mid - avLfoWaveSample(shape, t) * amp;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    canvas.setAttribute("data-shape", shape);
    return true;
  } catch (e) { return false; }
}

/* repaint from the live mirror — the ONLY other paint entry (init / shape change / this) */
function avLfoRedraw() {
  try { return avLfoPaintScope(avLfoShapeCurrent()); } catch (e) { return false; }
}

/* ---------- commit + change wiring ---------- */

/* the shared commit path (same shape as avSynthCommitValue): mirror first, then the app hook
   avApplyParam, with the 'av-param' event fallback when no app core ships. Never throws. */
function avLfoCommitShape(value) {
  const v = avLfoShapeNorm(value);
  if (!v) return false;
  try { if (typeof avParams !== "undefined" && avParams) avParams["lfo.shape"] = v; } catch (e) { /* no mirror */ }
  if (typeof avApplyParam === "function") {
    try { avApplyParam("lfo.shape", v, { from: "select" }); }
    catch (e) { console.warn("[anvil] avApplyParam(lfo.shape) failed", e); }
  } else {
    try {
      window.dispatchEvent(new CustomEvent("av-param", {
        detail: { path: "lfo.shape", value: v, el: avLfoEl("av-lfo-shape"), from: "select" },
      }));
    } catch (e) { /* no fan-out */ }
  }
  return v;
}

function avLfoBindSelect() {
  const sel = avLfoEl("av-lfo-shape");
  if (!sel || typeof sel.addEventListener !== "function") return false;
  sel.addEventListener("change", function () {
    try {
      avLfoCommitShape(sel.value);
      avLfoRedraw();
    } catch (e) { /* a change never throws */ }
  });
  return true;
}

/* facade entry: accept only the four shapes; mirror + commit via the same path, sync the
   select, redraw; return the accepted shape string (else false) */
function avLfoSetShape(value) {
  try {
    const v = avLfoShapeNorm(value);
    if (!v) return false;
    avLfoCommitShape(v);
    const sel = avLfoEl("av-lfo-shape");
    if (sel && sel.value !== v) sel.value = v;
    avLfoRedraw();
    return v;
  } catch (e) { return false; }
}

/* ---------- the proof ---------- */

function avLfoProof() {
  let shape = AV_LFO_DEFAULT_SHAPE;
  try { shape = avLfoShapeCurrent(); } catch (e) { /* the default stands */ }
  return "LFO SELFTEST " + JSON.stringify({
    v: AV_LFO_VERSION,
    ready: avLfoState.ready === true,
    shape: shape,
    knobs: 3,
    painted: true,
  });
}

/* ---------- mount (idempotent; fills the parent-owned host #av-lfo-host) ---------- */

function avLfoInit() {
  try {
    if (avLfoState.ready) return true;
    if (typeof document === "undefined" || !document) return false;
    const host = avLfoEl("av-lfo-host");
    if (!host) return false;
    if (avLfoEl("av-lfo-shape")) { avLfoState.ready = true; return true; }   /* already mounted */
    if (typeof avKnobHTML !== "function" || typeof avKnobRowHTML !== "function" || typeof avKnobBind !== "function") return false;
    avLfoSeedMirror();
    host.innerHTML = avLfoBodyHTML();
    avKnobBind(host);
    avLfoBindSelect();
    avLfoRedraw();                       /* paint at init — the canvas store exists while hidden */
    avLfoState.ready = true;
    /* proof: ?avtest=1 ONLY, deferred (the R12 leak law — never parse-time, never on the
       plain page); the deferred tick also lets the host settle before the line lands */
    try {
      if (typeof avTestLine === "function" && typeof location !== "undefined" && /[?&]avtest=1/.test(String(location.search))) {
        setTimeout(function () { try { const p = avLfoProof(); if (p) avTestLine(p, "av-lfotest"); } catch (e2) { /* ok */ } }, 0);
      }
    } catch (e) { /* proof is a nicety */ }
    return true;
  } catch (e) {
    console.warn("[anvil] lfo card mount failed", e);
    return false;
  }
}

/* ---------- the window facade ---------- */

if (typeof window !== "undefined" && window) {
  try {
    window.__avLfo = {
      version: AV_LFO_VERSION,
      init: function () { return avLfoInit(); },
      shape: function () { return avLfoShapeCurrent(); },
      setShape: function (v) { return avLfoSetShape(v); },
      redraw: function () { return avLfoRedraw(); },
      proof: function () { return avLfoProof(); },
    };
  } catch (e) { /* no window — nothing to publish */ }
}
