/* Anvil — THE INSPECTOR COLUMN (C1 chassis, verify/_c1_wave.md 2.4): the persistent right-hand
   column that carries the selected voice — the engine-kind key row, the six core pots on the live
   voice, two dark screens (the oscillator shape and the live amp ADSR), the EDIT VOICE jump and the
   deep-page launcher grid. One job: you never lose your place, or your voice, when a page changes.

   Laws honoured here: classic script (no modules), page module — no DOM at top level, every DOM
   reach is guarded and inside a function, never throws. ONE namespace (avInspector* / AV_INSP*).
   The module SELF-MOUNTS: avInspectorInit() builds aside#av-inspector into .av-work after
   main.av-main (before the dock) and is idempotent through the ready flag + a live-node check.
   avInspectorInit() -> false and stays false when main.av-main is absent (plain page, no shell).

   Kind keys ride the synth card's OWN commit — avSynthSetKind() when the card is loaded (it funnels
   engine.kind through avSynthCommitValue -> avApplyParam and syncs the engine select), else the same
   avApplyParam funnel with the avParams mirror-first law and the 'av-param' event fallback. The
   button vocabulary is the pin's seven (acid · wavetable · fm · string · drum · granular · sampler);
   the engine enum behind it is av_synth's list (va replaces wavetable, grain replaces granular).

   Core pots are av_knob rotaries on REAL paths (see AV_INSP_CORE — provenance in the C1 report):
   engine.outScale · mix.track.m1.pan · filter.cutoff · filter.reso · env1.a · env1.r. The value
   lines are read-only text repainted from the avParams mirror on the 200 ms tick (drag-to-edit on
   the screens is C2). Screens repaint from the mirror and the master tap analyser; the voice
   counter mirrors the engine's own #av-voices readout (av_engine samples it ~2 Hz — one source,
   never a second stats RPC).

   Launchers: avZoneShow(page) then avZoneSub(page, sub) when data-sub is set and avZoneSub exists
   (the parent wires avZoneSub in this same wave; the call is typeof-guarded).

   Public surface (classic-script globals, ONE namespace):
     avInspectorInit() -> bool · avInspectorProof() -> string · avInspectorLaunch(page, sub) -> bool ·
     avInspectorKindSet(k) -> bool · avInspectorKind() -> string · avInspectorSelect() -> object.
     window.__avInspector = { version:"c1.0", init, kind, kindSet, select, launch, proof }.
   Proof: ?avtest=1 ONLY, deferred via setTimeout(..., 0), id "av-inspectortest".
   ASCII source only (glyph-free); the dark screens are 220x84 canvases. */

"use strict";

const AV_INSPECTOR_VERSION = "c1.0";

/* the seven pinned kinds: button key -> engine enum (av_synth AV_SYNTH_KINDS vocabulary) */
const AV_INSP_KINDS = [
  { key: "acid", enumKind: "acid", label: "ACID" },
  { key: "wavetable", enumKind: "va", label: "WAVETABLE" },
  { key: "fm", enumKind: "fm", label: "FM" },
  { key: "string", enumKind: "string", label: "STRING" },
  { key: "drum", enumKind: "drum", label: "DRUM" },
  { key: "granular", enumKind: "grain", label: "GRANULAR" },
  { key: "sampler", enumKind: "sampler", label: "SAMPLER" },
];

/* the six core pots — EXACT paths, ranges copied from the card that owns them in live source:
     engine.outScale  av_dsp.js setParam (clamp 0.05..1, default 0.25 at create)
     mix.track.m1.pan av_mix_ui.js (path mix.track.<id>.<field>, consumed by its avApplyParam wrap)
     filter.cutoff    av_synth.js AV_SYNTH_ROWS (20..20000, log, def 800)
     filter.reso      av_synth.js AV_SYNTH_ROWS (0..1, def 0.3)
     env1.a           av_synth.js AV_SYNTH_ROWS (0.001..4, log, def 0.002)
     env1.r           av_synth.js AV_SYNTH_ROWS (0.001..8, log, def 0.2) */
const AV_INSP_CORE = [
  { id: "av-insp-level", path: "engine.outScale", label: "LEVEL", opts: { min: 0.05, max: 1, step: 0.01, def: 0.25, fmt: "pct" } },
  { id: "av-insp-pan", path: "mix.track.m1.pan", label: "PAN", opts: { min: -1, max: 1, step: 0.02, def: 0, fmt: "pan" } },
  { id: "av-insp-cutoff", path: "filter.cutoff", label: "CUTOFF", opts: { min: 20, max: 20000, step: 1, def: 800, curve: "log", fmt: "hz" } },
  { id: "av-insp-reso", path: "filter.reso", label: "RESO", opts: { min: 0, max: 1, step: 0.01, def: 0.3, fmt: "pct" } },
  { id: "av-insp-attack", path: "env1.a", label: "ATTACK", opts: { min: 0.001, max: 4, step: 0.001, def: 0.002, curve: "log", fmt: "ms" } },
  { id: "av-insp-release", path: "env1.r", label: "RELEASE", opts: { min: 0.001, max: 8, step: 0.001, def: 0.2, curve: "log", fmt: "ms" } },
];

/* the launcher grid — pinned order, page + sub (sub empty = page only) */
const AV_INSP_LAUNCH = [
  { page: "sound", sub: "engine", label: "OSC" },
  { page: "sound", sub: "fm", label: "FM" },
  { page: "sound", sub: "drums", label: "DRUMS" },
  { page: "sound", sub: "samples", label: "SMP" },
  { page: "sound", sub: "chop", label: "CHOP" },
  { page: "sound", sub: "wt", label: "WT" },
  { page: "sound", sub: "tune", label: "TUNE" },
  { page: "effects", sub: "", label: "FX" },
];

const avInspectorState = { ready: false, timer: 0, kind: "wavetable", poly: "poly", waveKey: "" };

/* ---------- small guards ---------- */

/* ids on a screen DIV name the screen; the drawing surface is the canvas inside it */
function avInspectorEl(id) {
  try {
    const e = document.getElementById(id);
    if (!e) return null;
    if (typeof e.getContext === "function") return e;
    return e.querySelector("canvas") || e;
  } catch (e) { return null; }
}

function avInspectorNum(v, d) {
  const n = Number(v);
  return isFinite(n) ? n : d;
}

/* one mirror read; the default stands on a cold start, a bad value, or a missing mirror */
function avInspectorParam(path, d) {
  try {
    if (typeof avParams === "undefined" || !avParams) return d;
    const n = Number(avParams[path]);
    return isFinite(n) ? n : d;
  } catch (e) { return d; }
}

/* the pin key for a live engine enum (cold start -> the va default) */
function avInspectorKindFromEngine(kind) {
  const k = String(kind == null ? "" : kind);
  for (let i = 0; i < AV_INSP_KINDS.length; i++) if (AV_INSP_KINDS[i].enumKind === k) return AV_INSP_KINDS[i].key;
  return "";
}

function avInspectorKindNorm(k) {
  const s = String(k == null ? "" : k);
  for (let i = 0; i < AV_INSP_KINDS.length; i++) if (AV_INSP_KINDS[i].key === s) return s;
  /* an engine enum is accepted too (va / grain) */
  return avInspectorKindFromEngine(s);
}

/* the current kind: the mirror when it names a known kind, else the wavetable (va) default */
function avInspectorKind() {
  try {
    if (typeof avParams !== "undefined" && avParams) {
      const v = avInspectorKindFromEngine(avParams["engine.kind"]);
      if (v) return v;
    }
  } catch (e) { /* the default stands */ }
  return "wavetable";
}

/* the aria/roving surface over the key row */
function avInspectorMark() {
  try {
    const row = avInspectorEl("av-insp-kinds");
    if (!row || !row.querySelectorAll) return false;
    const cur = avInspectorKind();
    row.querySelectorAll(".av-kind-key[data-kind]").forEach(function (b) {
      const on = b.getAttribute("data-kind") === cur;
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    return true;
  } catch (e) { return false; }
}

/* ---------- the ADSR / wave geometry (pure) ---------- */

/* the oscillator shape strings av_dsp accepts, wt.* forms folded to their base */
function avInspectorWaveBase(v) {
  let s = String(v == null ? "saw" : v);
  if (s.indexOf("wt.") === 0) s = s.slice(3);
  if (s === "pulse25") s = "pulse";
  if (s === "noise") return "noise";
  if (s === "square" || s === "pulse" || s === "tri" || s === "sine" || s === "saw") return s;
  return "saw";
}

/* one cycle of the shape at phase p (0..1), -1..1 */
function avInspectorWaveAt(shape, p) {
  const t = p - Math.floor(p);
  if (shape === "sine") return Math.sin(t * Math.PI * 2);
  if (shape === "tri") return 1 - 4 * Math.abs(t - 0.5) + 0; /* -1..1, peak at 0.5 */
  if (shape === "square") return t < 0.5 ? 1 : -1;
  if (shape === "pulse") return t < 0.25 ? 1 : -1;
  if (shape === "noise") return 0;                            /* the noise body is drawn as a band */
  return t < 0.5 ? (t * 4 - 1) : (3 - t * 4);                 /* saw */
}

/* the total envelope time in seconds (a + d + r; sustain is a level, not a time) */
function avInspectorEnvTotal() {
  const a = avInspectorParam("env1.a", 0.002);
  const d = avInspectorParam("env1.d", 0.3);
  const r = avInspectorParam("env1.r", 0.2);
  return Math.max(0.001, a + d + r);
}

/* "20 s" / "340 ms" style — the screen label */
function avInspectorTimeText(sec) {
  const s = avInspectorNum(sec, 0);
  if (s >= 10) return Math.round(s) + " s";
  if (s >= 1) return (Math.round(s * 10) / 10) + " s";
  return Math.round(s * 1000) + " ms";
}

/* ---------- the dark screens ---------- */

function avInspectorScreenInk(canvas, fallback) {
  try {
    const css = getComputedStyle(canvas);
    const v = css.getPropertyValue("--zone-accent");
    const s = String(v || "").trim();
    if (s) return s;
  } catch (e) { /* fall through */ }
  return fallback;
}

function avInspectorClear(ctx, w, h, canvas) {
  ctx.fillStyle = "#0a0c0f";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2 + 0.5);
  ctx.lineTo(w, h / 2 + 0.5);
  ctx.stroke();
  return avInspectorScreenInk(canvas, "#3fd0c9");
}

/* the oscillator screen: two cycles of the live osc shape (C1 preview; drag-to-edit is C2) */
function avInspectorPaintWave() {
  try {
    const canvas = avInspectorEl("av-insp-wave");
    if (!canvas || typeof canvas.getContext !== "function") return false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const w = canvas.width || 220, h = canvas.height || 84;
    const ink = avInspectorClear(ctx, w, h, canvas);
    let shape = "saw";
    try {
      if (typeof avParams !== "undefined" && avParams) shape = avInspectorWaveBase(avParams["osc1.type"]);
    } catch (e) { shape = "saw"; }
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    if (shape === "noise") {
      /* a fixed pseudo-random band (deterministic — no RNG) */
      for (let i = 0; i < 96; i++) {
        const x = (i / 95) * w;
        const amp = ((i * 37) % 29) / 29 - 0.5;
        const y = h / 2 - amp * h * 0.62;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    } else {
      for (let i = 0; i <= 160; i++) {
        const p = (i / 160) * 2;                    /* two cycles */
        const x = (i / 160) * w;
        const y = h / 2 - avInspectorWaveAt(shape, p) * h * 0.34;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    canvas.setAttribute("data-shape", shape);
    avInspectorState.waveKey = shape;
    return true;
  } catch (e) { return false; }
}

/* the amp envelope screen: ADSR drawn from the live a/d/s/r, attack decay release as time */
function avInspectorPaintEnv() {
  try {
    const canvas = avInspectorEl("av-insp-env");
    if (!canvas || typeof canvas.getContext !== "function") return false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const w = canvas.width || 220, h = canvas.height || 84;
    const ink = avInspectorClear(ctx, w, h, canvas);
    const a = avInspectorParam("env1.a", 0.002);
    const d = avInspectorParam("env1.d", 0.3);
    const s = Math.max(0, Math.min(1, avInspectorParam("env1.s", 0.8)));
    const r = avInspectorParam("env1.r", 0.2);
    const tot = Math.max(0.001, a + d + r);
    /* the sustain hold takes a slice of the width so the shape never collapses */
    const holdShare = 0.24;
    const span = 1 - holdShare;
    const xa = (a / tot) * span * w;
    const xd = xa + (d / tot) * span * w;
    const xs = xd + holdShare * w;
    const xr = xs + (r / tot) * span * w;
    const base = h - 7, top = 9;
    const ys = top + (1 - s) * (base - top);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(1, base);
    ctx.lineTo(Math.max(2, xa), top);
    ctx.lineTo(Math.max(xa + 1, xd), ys);
    ctx.lineTo(Math.max(xd + 2, xs), ys);
    ctx.lineTo(Math.max(xs + 1, Math.min(w - 1, xr)), base);
    ctx.stroke();
    /* the end-of-release marker dot */
    ctx.fillStyle = ink;
    try { ctx.beginPath(); ctx.arc(Math.min(w - 2, Math.max(2, xr)), base, 1.8, 0, Math.PI * 2); ctx.fill(); } catch (e2) { /* dot is a nicety */ }
    const lab = avInspectorEl("av-insp-env-lab");
    if (lab) {
      const txt = avInspectorTimeText(tot);
      if (lab.textContent !== txt) lab.textContent = txt;
    }
    return true;
  } catch (e) { return false; }
}

/* the filter response screen: the lowpass magnitude from cutoff + reso, with a corner marker.
   A screen with a job - drag across for cutoff, up for resonance; both ride avApplyParam. */
function avInspectorFilterFreq(v) {
  const t = Math.max(0, Math.min(1, v));
  return 40 * Math.pow(300, t);
}
function avInspectorFilterPos(f) {
  return Math.log(Math.max(40, Math.min(12000, f)) / 40) / Math.log(300);
}
function avInspectorPaintFilter() {
  try {
    const canvas = avInspectorEl("av-insp-filter");
    if (!canvas || typeof canvas.getContext !== "function") return false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const w = canvas.width || 220, h = canvas.height || 84;
    const ink = avInspectorClear(ctx, w, h, canvas);
    const cut = avInspectorParam("filter.cutoff", 1200);
    const reso = Math.max(0, Math.min(1, avInspectorParam("filter.reso", 0.2)));
    const fc = Math.max(0, Math.min(1, avInspectorFilterPos(cut)));
    const base = h - 6, top = 8;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    for (let i = 0; i <= 140; i++) {
      const t = i / 140;
      let mag = 1 / Math.sqrt(1 + Math.pow(t / Math.max(0.02, fc), 4));
      const bump = reso * 0.9 * Math.exp(-Math.pow((t - fc) / Math.max(0.03, 0.10 + reso * 0.10), 2));
      mag = Math.min(1.35, mag + bump * (t > fc * 0.4 ? 1 : 0.35));
      const y = base - mag * (base - top) * 0.72;
      if (i === 0) ctx.moveTo(0, y); else ctx.lineTo(t * w, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(fc * w, top);
    ctx.lineTo(fc * w, base);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const lab = avInspectorEl("av-insp-filter-lab");
    if (lab) {
      const txt = "LP " + (cut >= 1000 ? (cut / 1000).toFixed(1) + "k" : String(Math.round(cut))) + " R" + Math.round(reso * 100);
      if (lab.textContent !== txt) lab.textContent = txt;
    }
    return true;
  } catch (e) { return false; }
}

/* one drag binder: pointer position -> the screen's parameters. The filter screen takes x for
   cutoff and y for resonance; the envelope takes x across a/d/r with the sustain at the height. */
function avInspectorBindScreen(canvas, kind) {
  if (!canvas || typeof canvas.addEventListener !== "function") return false;
  let drag = false;
  const apply = function (e) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const fy = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    try {
      if (kind === "filter") {
        avApplyParam("filter.cutoff", Math.round(avInspectorFilterFreq(fx)));
        avApplyParam("filter.reso", Math.round(fy * 1000) / 1000);
      } else {
        const span = 1 / 3;
        avApplyParam("env1.s", Math.round(fy * 1000) / 1000);
        if (fx < span) avApplyParam("env1.a", Math.round((fx / span) * 2000) / 1000);
        else if (fx < span * 2) avApplyParam("env1.d", Math.round(((fx - span) / span) * 3000) / 1000);
        else avApplyParam("env1.r", Math.round(((fx - span * 2) / span) * 3000) / 1000);
      }
    } catch (e2) { /* a drag never throws */ }
  };
  canvas.addEventListener("pointerdown", function (e) {
    drag = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (e2) { /* best-effort */ }
    canvas.classList.add("av-insp-dragging");
    apply(e);
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", function (e) { if (drag) apply(e); });
  const up = function () { drag = false; canvas.classList.remove("av-insp-dragging"); };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  return true;
}

/* the mini scope: the master tap's left analyser, a flat dim line when the tap is cold */
function avInspectorPaintScope() {
  try {
    const canvas = avInspectorEl("av-insp-scope");
    if (!canvas || typeof canvas.getContext !== "function") return false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const w = canvas.width || 220, h = canvas.height || 36;
    const ink = avInspectorClear(ctx, w, h, canvas);
    let buf = null;
    try {
      if (typeof avTap !== "undefined" && avTap && avTap.analyserL && typeof avTap.analyserL.getByteTimeDomainData === "function") {
        if (!avInspectorState.scopeBuf || avInspectorState.scopeBuf.length !== avTap.analyserL.fftSize) {
          avInspectorState.scopeBuf = new Uint8Array(avTap.analyserL.fftSize);
        }
        avTap.analyserL.getByteTimeDomainData(avInspectorState.scopeBuf);
        buf = avInspectorState.scopeBuf;
      }
    } catch (e) { buf = null; }
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (buf && buf.length) {
      for (let i = 0; i < buf.length; i += 2) {
        const x = (i / (buf.length - 1)) * w;
        const y = h / 2 - ((buf[i] - 128) / 128) * (h * 0.44);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    } else {
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
    }
    ctx.stroke();
    return true;
  } catch (e) { return false; }
}

/* ---------- the value lines + the voice counter ---------- */

function avInspectorFmt(fmt, v) {
  try {
    if (typeof avKnobFormat === "function") return avKnobFormat(v, { fmt: fmt || "" });
  } catch (e) { /* the local formatter stands */ }
  const n = avInspectorNum(v, 0);
  if (fmt === "pct") return Math.round(n * 100) + "%";
  if (fmt === "hz") return n >= 1000 ? (Math.round(n / 10) / 100) + "k" : String(Math.round(n));
  if (fmt === "ms") return n >= 1 ? (Math.round(n * 100) / 100) + "s" : Math.round(n * 1000) + "ms";
  if (fmt === "pan") return Math.abs(n) < 0.005 ? "C" : (n < 0 ? "L" : "R") + Math.round(Math.abs(n) * 100);
  return String(Math.round(n * 1000) / 1000);
}

function avInspectorPaintNums() {
  try {
    for (let i = 0; i < AV_INSP_CORE.length; i++) {
      const e = AV_INSP_CORE[i];
      const mount = avInspectorEl(e.id);
      if (!mount || !mount.querySelector) continue;
      const line = mount.querySelector(".av-insp-num");
      if (!line) continue;
      const v = avInspectorParam(e.path, e.opts.def);
      const txt = avInspectorFmt(e.opts.fmt, v);
      if (line.textContent !== txt) line.textContent = txt;
    }
    return true;
  } catch (e) { return false; }
}

/* "voices: n / m" mirrors the engine's own readout (#av-voices, sampled by av_engine ~2 Hz) */
function avInspectorPaintVoices() {
  try {
    const out = avInspectorEl("av-insp-voices");
    if (!out) return false;
    let txt = "";
    const chip = avInspectorEl("av-voices");
    if (chip && chip.textContent) txt = String(chip.textContent).trim();
    if (!txt) {
      let mx = 0;
      try { if (window.__avEngine && isFinite(Number(window.__avEngine.maxVoices))) mx = Number(window.__avEngine.maxVoices); } catch (e2) { mx = 0; }
      txt = "voices: " + "\u2014" + " / " + (mx > 0 ? String(mx) : "\u2014");
    }
    if (out.textContent !== txt) out.textContent = txt;
    return true;
  } catch (e) { return false; }
}

/* ---------- the 200 ms tick ---------- */

function avInspectorTick() {
  try {
    avInspectorPaintNums();
    avInspectorPaintVoices();
    avInspectorPaintScope();
    avInspectorPaintEnv();
    avInspectorPaintFilter();
    if (!avInspectorState.screensBound) {
      avInspectorState.screensBound = true;
      avInspectorBindScreen(avInspectorEl("av-insp-filter"), "filter");
      avInspectorBindScreen(avInspectorEl("av-insp-env"), "env");
    }
    let shape = "saw";
    try { if (typeof avParams !== "undefined" && avParams) shape = avInspectorWaveBase(avParams["osc1.type"]); } catch (e) { shape = "saw"; }
    if (shape !== avInspectorState.waveKey) avInspectorPaintWave();
    return true;
  } catch (e) { return false; }
}

function avInspectorTimerStop() {
  try {
    if (avInspectorState.timer) clearInterval(avInspectorState.timer);
  } catch (e) { /* already gone */ }
  avInspectorState.timer = 0;
}

function avInspectorTimerStart() {
  avInspectorTimerStop();
  try { avInspectorState.timer = setInterval(avInspectorTick, 200); } catch (e) { avInspectorState.timer = 0; }
  return avInspectorState.timer !== 0;
}

/* ---------- the kind commit ---------- */

/* the shared commit: the synth card's own avSynthSetKind when it ships (it funnels engine.kind
   through avApplyParam), else mirror-first + the same funnel; the av-param event when no core. */
function avInspectorKindApply(enumKind) {
  let ok = false;
  try {
    if (typeof avSynthSetKind === "function") ok = avSynthSetKind(enumKind) !== false;
  } catch (e) { ok = false; }
  if (!ok) {
    try { if (typeof avParams !== "undefined" && avParams) avParams["engine.kind"] = enumKind; } catch (e2) { /* no mirror */ }
    if (typeof avApplyParam === "function") {
      try { avApplyParam("engine.kind", enumKind, { from: "inspector" }); ok = true; } catch (e3) { ok = false; }
    } else {
      try {
        window.dispatchEvent(new CustomEvent("av-param", { detail: { path: "engine.kind", value: enumKind, from: "inspector" } }));
        ok = true;
      } catch (e4) { ok = false; }
    }
  }
  return ok;
}

function avInspectorKindSet(key) {
  try {
    const k = avInspectorKindNorm(key);
    if (!k) return false;
    let enumKind = "va";
    for (let i = 0; i < AV_INSP_KINDS.length; i++) if (AV_INSP_KINDS[i].key === k) enumKind = AV_INSP_KINDS[i].enumKind;
    avInspectorKindApply(enumKind);
    avInspectorState.kind = k;
    avInspectorMark();
    avInspectorPaintWave();
    return true;
  } catch (e) { return false; }
}

/* ---------- the launcher jump ---------- */

function avInspectorLaunch(page, sub) {
  try {
    const p = String(page == null ? "" : page);
    if (!p) return false;
    let ok = false;
    if (typeof avZoneShow === "function") { try { ok = avZoneShow(p) !== false; } catch (e) { ok = false; } }
    const s = String(sub == null ? "" : sub);
    if (ok && s && typeof avZoneSub === "function") {
      try { ok = avZoneSub(p, s) !== false; } catch (e2) { ok = false; }
    }
    return ok;
  } catch (e) { return false; }
}

/* ---------- markup (pure string builders) ---------- */

function avInspectorKindsHTML() {
  let out = "";
  for (let i = 0; i < AV_INSP_KINDS.length; i++) {
    const k = AV_INSP_KINDS[i];
    out += '<button type="button" class="av-kind-key" data-kind="' + k.key + '" role="radio"' +
      ' aria-checked="false" tabindex="-1" title="' + k.label + '">' +
      '<span class="av-kind-dot" aria-hidden="true"></span>' +
      '<span class="av-kind-txt">' + k.label + '</span></button>';
  }
  return '<div class="av-kind-keys" id="av-insp-kinds" role="radiogroup" aria-label="Engine kind">' + out + '</div>';
}

function avInspectorCoreHTML() {
  const pots = [];
  for (let i = 0; i < AV_INSP_CORE.length; i++) {
    const e = AV_INSP_CORE[i];
    const v = avInspectorParam(e.path, e.opts.def);
    const opts = Object.assign({ value: v, size: "sm" }, e.opts);
    pots.push('<div class="av-insp-pot" id="' + e.id + '">' +
      '<div class="av-insp-pot-label">' + e.label + '</div>' +
      avKnobHTML(e.path, e.label, opts) +
      '<div class="av-insp-num" data-insp-num="' + e.path + '">' + avInspectorFmt(e.opts.fmt, v) + '</div>' +
      '</div>');
  }
  return '<div id="av-insp-core">' + avKnobRowHTML(pots, "av-insp-pots") + '</div>';
}

function avInspectorLaunchHTML() {
  let out = "";
  for (let i = 0; i < AV_INSP_LAUNCH.length; i++) {
    const l = AV_INSP_LAUNCH[i];
    out += '<button type="button" class="av-insp-launch av-insp-launch-key" data-page="' + l.page + '"' +
      (l.sub ? ' data-sub="' + l.sub + '"' : "") + ' title="Jump to ' + l.page + (l.sub ? " / " + l.sub : "") + '">' +
      l.label + '</button>';
  }
  return '<div class="av-insp-launch" role="group" aria-label="Deep pages">' + out + '</div>';
}

function avInspectorBodyHTML() {
  return '<div id="av-insp-title">SELECTED VOICE</div>' +
    avInspectorKindsHTML() +
    '<div class="av-insp-frame av-group">' +
      '<div class="av-group-tab">VOICE</div>' +
      avInspectorCoreHTML() +
      '<div class="av-insp-screen" id="av-insp-wave">' +
        '<canvas width="220" height="84" aria-label="Oscillator shape"></canvas>' +
      '</div>' +
      '<div class="av-insp-screen" id="av-insp-filter">' +
        '<canvas width="220" height="84" aria-label="Filter response - drag across for cutoff, up for resonance"></canvas>' +
        '<span class="av-insp-screen-label" id="av-insp-filter-lab">FILTER</span>' +
      '</div>' +
      '<div class="av-insp-screen" id="av-insp-env">' +
        '<canvas width="220" height="84" aria-label="Amp envelope (attack, decay, sustain, release)"></canvas>' +
        '<span class="av-insp-screen-label" id="av-insp-env-lab">\u2014</span>' +
      '</div>' +
    '</div>' +
    '<button type="button" class="av-insp-edit" id="av-insp-edit">EDIT VOICE</button>' +
    '<div class="av-insp-scope-box" id="av-insp-scope-box">' +
      '<canvas id="av-insp-scope" width="220" height="36" aria-label="Output scope"></canvas>' +
    '</div>' +
    avInspectorLaunchHTML() +
    '<div id="av-insp-voices" aria-live="off">voices: \u2014 / \u2014</div>' +
    '<div class="av-pair" id="av-insp-poly" role="radiogroup" aria-label="Voice mode">' +
      '<button type="button" class="av-pair-key" data-poly="poly" role="radio" aria-checked="true">POLY</button>' +
      '<button type="button" class="av-pair-key" data-poly="mono" role="radio" aria-checked="false">MONO</button>' +
    '</div>';
}

/* ---------- the wiring ---------- */

function avInspectorBindKinds() {
  const row = avInspectorEl("av-insp-kinds");
  if (!row || typeof row.querySelectorAll !== "function") return false;
  row.querySelectorAll(".av-kind-key[data-kind]").forEach(function (b) {
    b.addEventListener("click", function () {
      try { avInspectorKindSet(b.getAttribute("data-kind")); } catch (e) { /* a key never throws */ }
    });
    b.addEventListener("keydown", function (e) {
      try {
        const k = e.key;
        if (k !== "ArrowRight" && k !== "ArrowLeft" && k !== "ArrowDown" && k !== "ArrowUp") return;
        e.preventDefault();
        const keys = AV_INSP_KINDS.map(function (x) { return x.key; });
        const cur = keys.indexOf(avInspectorKind());
        const d = (k === "ArrowRight" || k === "ArrowDown") ? 1 : -1;
        const next = keys[(cur + d + keys.length) % keys.length];
        avInspectorKindSet(next);
        const nb = row.querySelector('.av-kind-key[data-kind="' + next + '"]');
        if (nb && typeof nb.focus === "function") nb.focus({ preventScroll: true });
      } catch (e2) { /* arrows are a nicety */ }
    });
  });
  return true;
}

function avInspectorBindLaunch() {
  const host = document.querySelector("#av-inspector .av-insp-launch");
  if (!host || typeof host.querySelectorAll !== "function") return false;
  host.querySelectorAll("[data-page]").forEach(function (b) {
    b.addEventListener("click", function () {
      try { avInspectorLaunch(b.getAttribute("data-page"), b.getAttribute("data-sub") || ""); } catch (e) { /* a jump never throws */ }
    });
  });
  return true;
}

function avInspectorBindEdit() {
  const b = avInspectorEl("av-insp-edit");
  if (!b) return false;
  b.addEventListener("click", function () {
    try { avInspectorLaunch("sound", "engine"); } catch (e) { /* the jump never throws */ }
  });
  return true;
}

function avInspectorBindPoly() {
  const row = avInspectorEl("av-insp-poly");
  if (!row || typeof row.querySelectorAll !== "function") return false;
  row.querySelectorAll(".av-pair-key[data-poly]").forEach(function (b) {
    b.addEventListener("click", function () {
      try {
        const m = b.getAttribute("data-poly") === "mono" ? "mono" : "poly";
        avInspectorState.poly = m;
        row.querySelectorAll(".av-pair-key[data-poly]").forEach(function (x) {
          x.setAttribute("aria-checked", x.getAttribute("data-poly") === m ? "true" : "false");
        });
      } catch (e) { /* the pair is a local readout in C1 */ }
    });
  });
  return true;
}

/* strip the knob's own label + value line: the pinned .av-insp-pot-label / .av-insp-num carry
   both (the knob keeps its aria-label, so nothing is lost to a screen reader) */
function avInspectorTrimKnobChrome() {
  try {
    const core = avInspectorEl("av-insp-core");
    if (!core || typeof core.querySelectorAll !== "function") return false;
    core.querySelectorAll(".av-knob-lbl, .av-knob-val").forEach(function (n) {
      if (n && n.parentNode) n.parentNode.removeChild(n);
    });
    return true;
  } catch (e) { return false; }
}

/* ---------- mount ---------- */

function avInspectorMount() {
  try {
    if (typeof document === "undefined" || !document || typeof document.querySelector !== "function") return null;
    const main = document.querySelector("main.av-main");
    if (!main) return null;
    const aside = document.createElement("aside");
    aside.id = "av-inspector";
    aside.className = "av-inspector";
    aside.setAttribute("aria-label", "Selected voice");
    const work = document.querySelector(".av-work");
    const parent = work || main.parentNode;
    if (!parent) return null;
    if (work && main.parentNode === work) parent.insertBefore(aside, main.nextSibling);
    else parent.appendChild(aside);
    return aside;
  } catch (e) { return null; }
}

function avInspectorInit() {
  try {
    if (typeof document === "undefined" || !document) return false;
    /* already mounted and still attached? */
    const live = avInspectorEl("av-inspector");
    if (avInspectorState.ready && live && document.body && document.body.contains(live)) return true;
    if (live && live.parentNode) { try { live.parentNode.removeChild(live); } catch (e) { /* stale node */ } }
    if (typeof avKnobHTML !== "function" || typeof avKnobRowHTML !== "function" || typeof avKnobBind !== "function") return false;

    const aside = avInspectorMount();
    if (!aside) return false;
    aside.innerHTML = avInspectorBodyHTML();
    avKnobBind(avInspectorEl("av-insp-core"));
    avInspectorTrimKnobChrome();
    avInspectorBindKinds();
    avInspectorBindLaunch();
    avInspectorBindEdit();
    avInspectorBindPoly();

    avInspectorState.kind = avInspectorKind();
    avInspectorMark();
    avInspectorPaintWave();
    avInspectorPaintEnv();
    avInspectorPaintFilter();
    if (!avInspectorState.screensBound) {
      avInspectorState.screensBound = true;
      avInspectorBindScreen(avInspectorEl("av-insp-filter"), "filter");
      avInspectorBindScreen(avInspectorEl("av-insp-env"), "env");
    }
    avInspectorPaintScope();
    avInspectorPaintNums();
    avInspectorPaintVoices();
    avInspectorTimerStart();
    avInspectorState.ready = true;

    /* proof: ?avtest=1 ONLY, deferred (never leaks onto the live page) */
    try {
      if (typeof avTestLine === "function" && typeof location !== "undefined" && /[?&]avtest=1/.test(String(location.search))) {
        setTimeout(function () { try { const p = avInspectorProof(); if (p) avTestLine(p, "av-inspectortest"); } catch (e2) { /* ok */ } }, 0);
      }
    } catch (e) { /* proof is a nicety */ }
    return true;
  } catch (e) {
    console.warn("[anvil] inspector mount failed", e);
    return false;
  }
}

/* ---------- the reads (facade) ---------- */

/* the current selection as a plain object: the kind key, its engine enum, and the six live paths */
function avInspectorSelect() {
  const out = { kind: "wavetable", engine: "va", paths: {}, values: {} };
  try {
    out.kind = avInspectorKind();
    for (let i = 0; i < AV_INSP_KINDS.length; i++) if (AV_INSP_KINDS[i].key === out.kind) out.engine = AV_INSP_KINDS[i].enumKind;
    for (let i = 0; i < AV_INSP_CORE.length; i++) {
      const e = AV_INSP_CORE[i];
      out.paths[e.label.toLowerCase()] = e.path;
      out.values[e.path] = avInspectorParam(e.path, e.opts.def);
    }
    const row = avInspectorEl("av-insp-poly");
    out.poly = avInspectorState.poly === "mono" ? "mono" : "poly";
    if (row) {
      const on = row.querySelector('.av-pair-key[aria-checked="true"]');
      if (on) out.poly = on.getAttribute("data-poly") === "mono" ? "mono" : "poly";
    }
  } catch (e) { /* the defaults stand */ }
  return out;
}

function avInspectorProof() {
  const count = function (sel) {
    try { return document.querySelectorAll(sel).length; } catch (e) { return -1; }
  };
  return "INSPECTOR SELFTEST " + JSON.stringify({
    v: AV_INSPECTOR_VERSION,
    ready: avInspectorState.ready === true,
    host: count("#av-inspector"),
    kinds: count("#av-inspector .av-kind-key[data-kind]"),
    pots: count("#av-inspector .av-insp-pot"),
    knobs: count("#av-inspector .av-knob[data-knob]"),
    launch: count("#av-inspector .av-insp-launch[data-page]"),
    screens: count("#av-inspector canvas"),
    kind: avInspectorKind(),
    poly: avInspectorState.poly,
    timer: avInspectorState.timer !== 0,
  });
}

/* ---------- the window facade ---------- */

if (typeof window !== "undefined" && window) {
  try {
    window.__avInspector = {
      version: AV_INSPECTOR_VERSION,
      init: function () { return avInspectorInit(); },
      kind: function () { return avInspectorKind(); },
      kindSet: function (k) { return avInspectorKindSet(k); },
      select: function () { return avInspectorSelect(); },
      launch: function (page, sub) { return avInspectorLaunch(page, sub); },
      proof: function () { return avInspectorProof(); },
    };
  } catch (e) { /* no window - nothing to publish */ }
}

/* ---------- the dock wheels (C1 chassis): pitch springs back, mod holds ----------
   Pointer drag + arrows. Pitch pushes MPE bend on channel 1 when the MPE deck is live; both also
   dispatch a document "av-wheel" CustomEvent so a later wave can bind them to anything. */
const avWheelState = { pitch: 0, mod: 0, wired: false };

function avWheelSet(name, v, silent) {
  try {
    const el = document.getElementById(name === "pitch" ? "av-wheel-pitch" : "av-wheel-mod");
    const min = name === "pitch" ? -1 : 0;
    const val = Math.max(min, Math.min(1, Number(v) || 0));
    avWheelState[name] = val;
    if (el) {
      el.setAttribute("aria-valuenow", String(Math.round(val * 100) / 100));
      const cap = el.querySelector(".av-wheel-cap");
      const span = Math.max(1, el.clientHeight - 14);
      if (cap) cap.style.transform = "translateY(" + Math.round((1 - (val - min) / (1 - min)) * span) + "px)";
    }
    if (name === "pitch" && typeof avMpeDeckDispatch === "function") {
      try { avMpeDeckDispatch(1, "bend", val * 2); } catch (e) { /* no mpe zone - value still rides */ }
    }
    if (!silent) {
      try { document.dispatchEvent(new CustomEvent("av-wheel", { detail: { wheel: name, value: val } })); } catch (e2) { /* best-effort */ }
    }
    return val;
  } catch (e) { return 0; }
}

function avWheelWire(el, name) {
  if (!el) return false;
  let drag = null;
  el.addEventListener("pointerdown", function (e) {
    const r = el.getBoundingClientRect();
    drag = { y: e.clientY, v: avWheelState[name], h: Math.max(1, r.height) };
    try { el.setPointerCapture(e.pointerId); } catch (e2) { /* capture is best-effort */ }
    e.preventDefault();
  });
  el.addEventListener("pointermove", function (e) {
    if (!drag) return;
    const min = name === "pitch" ? -1 : 0;
    const span = 1 - min;
    avWheelSet(name, drag.v + ((drag.y - e.clientY) / drag.h) * span);
  });
  const up = function () {
    if (!drag) return;
    drag = null;
    if (name === "pitch") avWheelSet("pitch", 0);
  };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("keydown", function (e) {
    const step = e.shiftKey ? 0.01 : 0.05;
    if (e.key === "ArrowUp") { avWheelSet(name, avWheelState[name] + step); e.preventDefault(); }
    else if (e.key === "ArrowDown") { avWheelSet(name, avWheelState[name] - step); e.preventDefault(); }
    else if (e.key === "Home") { avWheelSet(name, name === "pitch" ? 0 : 0); e.preventDefault(); }
    else if (e.key === "End") { avWheelSet(name, 1); e.preventDefault(); }
  });
  return true;
}

function avWheelsInit() {
  if (avWheelState.wired) return true;
  const p = avWheelWire(document.getElementById("av-wheel-pitch"), "pitch");
  const m = avWheelWire(document.getElementById("av-wheel-mod"), "mod");
  avWheelState.wired = !!(p && m);
  return avWheelState.wired;
}

/* boot: self-mount at parse time (the shell markup sits above every part script) */
try { avInspectorInit(); avWheelsInit(); } catch (e) { /* the inspector boots best-effort */ }
