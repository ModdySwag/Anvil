/* Anvil — FX RACK card (P3 wave, child D): the rack UI mounted into the parent-owned host
   #av-fx-host. One strip per FX module, fixed order per verify/_p3_wave.md §2.1:
   drive → mod → delay → verb → dyn.

   Per strip: an on toggle (fx.<mod>.on) + MIX knob (fx.<mod>.mix) + three headline knobs,
   plus the module's mode/division enum as a standard <select class="av-select"> (an enum is
   not a knob). Every control rides the standard av-knob / avApplyParam idioms: the knob
   framework's avParams mirror is the first paint source, avKnobCommit fans commits into
   avApplyParam (or, without the app core, the 'av-param' CustomEvent fallback — same shape as
   av_synth.js). The card only OWNS the UI: chain order, bypass bookkeeping and the wet mix
   happen engine-side (§2.2). No persistence: a fresh page starts on the defaults below.

   Pinned paths (verify/_p3_wave.md §3; the rig verify/cdp_fx.mjs asserts exactly these):
     drive  on · mix · mode(sat|fold|crush) · amount · tone · bits
     mod    on · mix · mode(chorus|ensemble|flanger|phaser) · rate · depth · feedback
     delay  on · mix · div(free|1/1|1/2|1/4|1/8|1/8d|1/16) · time · feedback · pingpong
     verb   on · mix · mode(plate|fdn|freeverb) · size · decay · damp
     dyn    on · mix · comp.thresh · comp.ratio · lim.ceiling
   UI-pinned defaults (documented, not in the wave doc): mix drive .5 / mod .5 / delay .3 /
   verb .35 / dyn 1.0; drive.tone 0..1 with .5 = neutral, bits 16 = off; verb decay .55 /
   size .6 / damp .5 (a clearly audible plate); mod rate .6 Hz depth .5 feedback 0; delay
   time .25 s feedback .35 pingpong 0; dyn thresh −18 dB ratio 4:1 ceiling −1 dBFS.
   Not mounted in the v1 rack (engine-side / next wave): verb.predelay, delay.spread ·
   duck · bpm, mod.stages, drive.downsample, dyn.eq.* · comp.att/rel/makeup — the rig still
   sweeps every one of those paths for delivery acceptance (cdp_fx §sweep).

   Exports (globals, build.py part order parent-owned):
     avFxInit()      → mount into #av-fx-host; false without throw when the host is absent or
                       the knob parts are not loaded; re-mountable (rebuilds the markup).
     avFxSnap()      → plain snapshot: inited/host/wired/card/strips/order/controls/paths/
                       params/inventory/classes — safe to call any time (no DOM → zeros).
     avFxClasses()   → the NEW css class names this card emits (parent styles them).
     avFxInventory() → the full control inventory (path · kind · label · range · selector).
     avFxSync(root)  → repaint every control from avParams (CC writes / snapshot loads).
     window.__avFx   → { version, init, snap, classes, inventory, sync, commit } debug handle.

   ONE writer (child D). No DOM at top level; every DOM touch sits inside a guarded function. */

"use strict";

const AV_FX_VERSION = "p3.0";

/* ---------- the table: one entry per strip, in the pinned chain order ---------- */

const AV_FX_MODULES = [
  {
    mod: "drive", label: "DRIVE", cap: "sat · fold · crush",
    toggle: { path: "fx.drive.on", aria: "Drive module on/off" },
    selects: [
      { path: "fx.drive.mode", label: "MODE", aria: "Drive mode (sat · fold · crush)", options: ["sat", "fold", "crush"], def: "sat" },
    ],
    knobs: [
      { path: "fx.drive.mix", label: "MIX", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct" } },
      { path: "fx.drive.amount", label: "DRIVE", opts: { min: 0, max: 1, step: 0.01, def: 0.4, fmt: "pct", hint: "up to +30 dB" } },
      { path: "fx.drive.tone", label: "TONE", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct", hint: "one-pole tilt · 50% neutral" } },
      { path: "fx.drive.bits", label: "BITS", opts: { min: 4, max: 16, step: 1, def: 16, fmt: "int", hint: "crush mode quantiser" } },
    ],
  },
  {
    mod: "mod", label: "MOD", cap: "chorus · ensemble · flanger · phaser",
    toggle: { path: "fx.mod.on", aria: "Mod module on/off" },
    selects: [
      { path: "fx.mod.mode", label: "MODE", aria: "Mod mode (chorus · ensemble · flanger · phaser)", options: ["chorus", "ensemble", "flanger", "phaser"], def: "chorus" },
    ],
    knobs: [
      { path: "fx.mod.mix", label: "MIX", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct" } },
      { path: "fx.mod.rate", label: "RATE", opts: { min: 0.05, max: 10, step: 0.01, def: 0.6, curve: "log", fmt: "hz" } },
      { path: "fx.mod.depth", label: "DEPTH", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct" } },
      { path: "fx.mod.feedback", label: "FEEDBACK", opts: { min: -0.95, max: 0.95, step: 0.01, def: 0, fmt: "pct", hint: "flanger / phaser only" } },
    ],
  },
  {
    mod: "delay", label: "DELAY", cap: "free · tempo divisions · ping-pong",
    toggle: { path: "fx.delay.on", aria: "Delay module on/off" },
    selects: [
      { path: "fx.delay.div", label: "DIV", aria: "Delay sync division (free or tempo)", options: ["free", "1/1", "1/2", "1/4", "1/8", "1/8d", "1/16"], def: "free" },
    ],
    knobs: [
      { path: "fx.delay.mix", label: "MIX", opts: { min: 0, max: 1, step: 0.01, def: 0.3, fmt: "pct" } },
      { path: "fx.delay.time", label: "TIME", opts: { min: 0.01, max: 2, step: 0.001, def: 0.25, curve: "log", fmt: "ms" } },
      { path: "fx.delay.feedback", label: "FEEDBACK", opts: { min: 0, max: 0.95, step: 0.01, def: 0.35, fmt: "pct" } },
      { path: "fx.delay.pingpong", label: "PING-PONG", opts: { min: 0, max: 1, step: 0.01, def: 0, fmt: "pct", hint: "cross-feedback" } },
    ],
  },
  {
    mod: "verb", label: "VERB", cap: "plate · fdn · freeverb",
    toggle: { path: "fx.verb.on", aria: "Reverb module on/off" },
    selects: [
      { path: "fx.verb.mode", label: "MODE", aria: "Reverb mode (plate · fdn · freeverb)", options: ["plate", "fdn", "freeverb"], def: "plate" },
    ],
    knobs: [
      { path: "fx.verb.mix", label: "MIX", opts: { min: 0, max: 1, step: 0.01, def: 0.35, fmt: "pct" } },
      { path: "fx.verb.size", label: "SIZE", opts: { min: 0, max: 1, step: 0.01, def: 0.6, fmt: "pct" } },
      { path: "fx.verb.decay", label: "DECAY", opts: { min: 0, max: 1, step: 0.01, def: 0.55, fmt: "pct", hint: "≈ T60 0.3–12 s" } },
      { path: "fx.verb.damp", label: "DAMP", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct" } },
    ],
  },
  {
    mod: "dyn", label: "DYN", cap: "comp · limiter · soft-clip",
    toggle: { path: "fx.dyn.on", aria: "Dynamics module on/off" },
    selects: [],
    knobs: [
      { path: "fx.dyn.mix", label: "MIX", opts: { min: 0, max: 1, step: 0.01, def: 1, fmt: "pct" } },
      { path: "fx.dyn.comp.thresh", label: "THRESH", opts: { min: -40, max: 0, step: 0.5, def: -18, fmt: "db", hint: "compressor threshold" } },
      { path: "fx.dyn.comp.ratio", label: "RATIO", opts: { min: 1, max: 20, step: 0.1, def: 4, fmt: "x", hint: "compressor ratio" } },
      { path: "fx.dyn.lim.ceiling", label: "CEIL", opts: { min: -6, max: 0, step: 0.1, def: -1, fmt: "db", hint: "limiter ceiling" } },
    ],
  },
];

/* state (the rig reads inited via avFxSnap) */
const avFxState = { inited: false, mounts: 0 };

/* local escaper — the same rules as avKnobEsc / avSynthEsc; this part keeps no extra deps */
const avFxEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* path → CSS-attribute escape for readout lookups (av_knob owns the real one) */
function avFxCssEsc(s) {
  if (typeof avKnobCssEscape === "function") { try { return avKnobCssEscape(s); } catch (e) { /* fall through */ } }
  return String(s == null ? "" : s).replace(/[^a-zA-Z0-9_-]/g, ch => "\\" + ch);
}

/* ---------- the default table for every path this card mounts (§3 ranges + the documented
   UI pins above). Only unset paths are seeded at mount, so a re-mount can never clobber a
   live value — the LEVELS idiom av_synth.js uses. ---------- */

function avFxDefaults() {
  const d = {};
  AV_FX_MODULES.forEach(m => {
    d[m.toggle.path] = 0;
    m.selects.forEach(s => { d[s.path] = s.def; });
    m.knobs.forEach(k => { d[k.path] = k.opts.def; });
  });
  return d;
}

/* ---------- markup (pure string builders) ---------- */

/* one enum pick — a plain select.av-select like the synth card's, current option pre-selected
   from the live mirror (an invalid stored value falls back to the pinned default) */
function avFxSelectHTML(spec) {
  const cur = (spec.options.indexOf(avParams[spec.path]) >= 0) ? avParams[spec.path] : spec.def;
  const opts = spec.options.map(o =>
    '<option value="' + avFxEsc(o) + '"' + (o === cur ? " selected" : "") + ">" + avFxEsc(o) + "</option>").join("");
  return '<label class="av-fx-pick"><span class="av-fx-pick-lbl">' + avFxEsc(spec.label) + "</span>" +
    '<select class="av-select av-fx-select" data-param="' + avFxEsc(spec.path) + '" aria-label="' + avFxEsc(spec.aria) + '">' +
    opts + "</select></label>";
}

/* one on/off toggle — a button.av-btn.mini (the MIDI deck's idiom) with aria-pressed + 'on' */
function avFxToggleHTML(spec) {
  const on = !!avParams[spec.path];
  return '<button type="button" class="av-btn mini av-fx-toggle' + (on ? " on" : "") + '"' +
    ' data-fx-toggle="' + avFxEsc(spec.path) + '" aria-pressed="' + (on ? "true" : "false") + '"' +
    ' aria-label="' + avFxEsc(spec.aria) + '" title="' + avFxEsc(spec.aria) + '">' + (on ? "ON" : "OFF") + "</button>";
}

/* one strip: head (name · cap · toggle) + ctl row (enum pick + the knob row) */
function avFxStripHTML(m, idx) {
  const toggle = avFxToggleHTML(m.toggle);
  const sels = m.selects.map(avFxSelectHTML).join("");
  const knobs = m.knobs.map(k => avKnobHTML(k.path, k.label, Object.assign({ value: avParams[k.path] }, k.opts)));
  const on = !!avParams[m.toggle.path];
  return '<div class="av-fx-strip' + (on ? " av-fx-on" : "") + '" data-mod="' + avFxEsc(m.mod) + '" data-idx="' + idx + '">' +
    '<div class="av-fx-strip-head"><span class="av-fx-mod">' + avFxEsc(m.label) + "</span>" +
    '<span class="av-fx-cap">' + avFxEsc(m.cap) + "</span>" + toggle + "</div>" +
    '<div class="av-fx-ctl">' + sels + avKnobRowHTML(knobs, "av-fx-knobs") + "</div>" +
    "</div>";
}

/* the whole card body (parent styles .av-fx; the strips stack in the pinned order) */
function avFxBodyHTML() {
  const strips = AV_FX_MODULES.map((m, i) => avFxStripHTML(m, i)).join("");
  return '<div class="av-fx" data-av-fx="1">' +
    '<div class="av-fx-head"><span class="av-fx-title">FX RACK</span>' +
    '<span class="av-fx-cap">drive → mod → delay → verb → dyn · inside the mixer worklet · every module off = bit-identical bypass</span></div>' +
    '<div class="av-fx-strips">' + strips + "</div>" +
    "</div>";
}

/* ---------- commits (toggles + selects; knobs commit through avKnobCommit themselves) ---------- */

/* the shared commit path — mirror first, then the app-side hook, mirroring avSynthCommitValue */
function avFxCommit(path, v, el, from) {
  avParams[path] = v;
  if (typeof avApplyParam === "function") {
    try { avApplyParam(path, v, { from: from || "fx", el: el }); }
    catch (e) { console.warn("[anvil] avApplyParam(" + path + ") failed", e); }
  } else {
    try { window.dispatchEvent(new CustomEvent("av-param", { detail: { path: path, value: v, el: el, from: from || "fx" } })); }
    catch (e) { /* no fan-out */ }
  }
  avFxSyncControl(path);
  return v;
}

/* repaint ONE control from the mirror (used after commits; avFxSync is the full pass) */
function avFxSyncControl(path) {
  let host = null;
  try { host = (typeof document !== "undefined" && document) ? document.getElementById("av-fx-host") : null; } catch (e) { host = null; }
  if (!host || !host.querySelectorAll) return false;
  const knob = host.querySelector('.av-knob[data-knob="' + avFxCssEsc(path) + '"]');
  if (knob && typeof avParams[path] === "number" && typeof avKnobApplyVisual === "function") avKnobApplyVisual(knob, avParams[path]);
  const btn = host.querySelector('[data-fx-toggle="' + avFxCssEsc(path) + '"]');
  if (btn) {
    const on = !!avParams[path];
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = on ? "ON" : "OFF";
  }
  const sel = host.querySelector('select.av-fx-select[data-param="' + avFxCssEsc(path) + '"]');
  if (sel && typeof avParams[path] === "string" && sel.value !== avParams[path]) sel.value = avParams[path];
  const mod = String(path).split(".")[1];
  const strip = host.querySelector('.av-fx-strip[data-mod="' + avFxCssEsc(mod) + '"]');
  if (strip && typeof avParams["fx." + mod + ".on"] !== "undefined") strip.classList.toggle("av-fx-on", !!avParams["fx." + mod + ".on"]);
  return true;
}

/* full repaint from avParams: every knob's visual + readout, toggle states, select values and
   the per-strip on class. The rig and the parent call this after external writes (CC, load). */
function avFxSync(root) {
  let host = root || null;
  if (!host) {
    try { host = (typeof document !== "undefined" && document) ? document.getElementById("av-fx-host") : null; } catch (e) { host = null; }
  }
  if (!host || !host.querySelectorAll) return false;
  host.querySelectorAll(".av-knob[data-knob]").forEach(el => {
    const path = el.dataset.knob;
    const v = avParams[path];
    if (typeof v !== "number") return;
    if (typeof avKnobApplyVisual === "function") avKnobApplyVisual(el, v);
    if (typeof avKnobFormat === "function") {
      const txt = avKnobFormat(v, { fmt: el.dataset.fmt || "", unit: el.dataset.unit || "" });
      try { host.querySelectorAll('[data-kval="' + avFxCssEsc(path) + '"]').forEach(n => { n.textContent = txt; }); }
      catch (e) { /* odd path */ }
    }
  });
  host.querySelectorAll("[data-fx-toggle]").forEach(btn => {
    const on = !!avParams[btn.dataset.fxToggle];
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = on ? "ON" : "OFF";
  });
  host.querySelectorAll("select.av-fx-select[data-param]").forEach(sel => {
    const v = avParams[sel.dataset.param];
    if (typeof v === "string" && sel.value !== v) sel.value = v;
  });
  host.querySelectorAll(".av-fx-strip[data-mod]").forEach(strip => {
    strip.classList.toggle("av-fx-on", !!avParams["fx." + strip.dataset.mod + ".on"]);
  });
  return true;
}

/* ---------- wiring ---------- */

/* ONE delegated click listener on the host for every toggle (the MIDI deck's pattern) */
function avFxWire(host) {
  if (!host || host.dataset.avFxWired === "1") return false;
  host.dataset.avFxWired = "1";
  host.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== "function") return;
    const btn = t.closest("[data-fx-toggle]");
    if (!btn) return;
    const path = btn.dataset.fxToggle;
    avFxCommit(path, avParams[path] ? 0 : 1, btn, "toggle");
  });
  return true;
}

/* direct change listeners on the enum picks (fresh elements on every mount → re-bound) */
function avFxBindSelects(host) {
  if (!host || !host.querySelectorAll) return;
  host.querySelectorAll("select.av-fx-select[data-param]").forEach(sel => {
    sel.addEventListener("change", () => { avFxCommit(sel.dataset.param, sel.value, sel, "select"); });
  });
}

/* a per-control bound marker for toggles/selects (knobs carry avKnobBind's data-knob-bound) */
function avFxMarkBound(host) {
  if (!host || !host.querySelectorAll) return;
  host.querySelectorAll("[data-fx-toggle], select.av-fx-select[data-param]").forEach(el => { el.dataset.fxBound = "1"; });
}

/* ---------- the inventory + class list (returned for the parent's reports + smoke checks) ---------- */

function avFxInventory() {
  const out = [];
  AV_FX_MODULES.forEach(m => {
    out.push({ mod: m.mod, kind: "toggle", path: m.toggle.path, label: m.label + " ON",
      sel: '[data-fx-toggle="' + m.toggle.path + '"]' });
    m.knobs.forEach(k => {
      const e = { mod: m.mod, kind: "knob", path: k.path, label: k.label,
        min: k.opts.min, max: k.opts.max, step: k.opts.step, def: k.opts.def,
        sel: '.av-knob[data-knob="' + k.path + '"]' };
      if (k.opts.curve) e.curve = k.opts.curve;
      if (k.opts.fmt) e.fmt = k.opts.fmt;
      if (k.opts.unit) e.unit = k.opts.unit;
      out.push(e);
    });
    m.selects.forEach(s => {
      out.push({ mod: m.mod, kind: "select", path: s.path, label: s.label,
        options: s.options.slice(), def: s.def,
        sel: 'select.av-fx-select[data-param="' + s.path + '"]' });
    });
  });
  return out;
}

function avFxClasses() {
  return ["av-fx", "av-fx-head", "av-fx-title", "av-fx-cap", "av-fx-strips", "av-fx-strip",
    "av-fx-on", "av-fx-strip-head", "av-fx-mod", "av-fx-toggle", "av-fx-ctl",
    "av-fx-pick", "av-fx-pick-lbl", "av-fx-knobs"];
}

/* ---------- init (mount) ---------- */

/* mount into the parent-owned host: seed unset mirror paths, render, bind knobs/toggles/
   selects, repaint. Host absent or knob parts missing → false, no throw. Re-mountable: a
   second call rebuilds the markup from the live mirror (used by the rig's absent-host probe). */
function avFxInit() {
  let host = null;
  try { host = (typeof document !== "undefined" && document) ? document.getElementById("av-fx-host") : null; } catch (e) { host = null; }
  if (!host) return false;
  if (typeof avKnobHTML !== "function" || typeof avKnobRowHTML !== "function" || typeof avKnobBind !== "function") return false;
  if (typeof avParams === "undefined" || !avParams) return false;
  try {
    const defs = avFxDefaults();
    for (const p in defs) {
      if (!(p in avParams)) avParams[p] = defs[p];
    }
    /* repair an invalid stored enum before first paint (never a throw, never a surprise) */
    AV_FX_MODULES.forEach(m => m.selects.forEach(s => {
      if (s.options.indexOf(avParams[s.path]) < 0) avParams[s.path] = s.def;
    }));
    host.innerHTML = avFxBodyHTML();
    avKnobBind(host);
    avFxWire(host);
    avFxBindSelects(host);
    avFxMarkBound(host);
    avFxSync(host);
    avFxState.inited = true;
    avFxState.mounts += 1;
    return true;
  } catch (e) {
    console.warn("[anvil] fx rack mount failed", e);
    return false;
  }
}

/* ---------- snapshot ---------- */

function avFxSnap() {
  let host = null;
  try { host = (typeof document !== "undefined" && document) ? document.getElementById("av-fx-host") : null; } catch (e) { host = null; }
  const inv = avFxInventory();
  const expect = {
    strips: AV_FX_MODULES.length,
    knobs: AV_FX_MODULES.reduce((n, m) => n + m.knobs.length, 0),
    toggles: AV_FX_MODULES.length,
    selects: AV_FX_MODULES.reduce((n, m) => n + m.selects.length, 0),
    controls: inv.length,
  };
  const snap = {
    version: AV_FX_VERSION,
    inited: !!avFxState.inited,
    mounts: avFxState.mounts,
    host: !!host,
    wired: !!(host && host.dataset && host.dataset.avFxWired === "1"),
    card: !!(host && host.querySelector && host.querySelector(".av-fx")),
    strips: (host && host.querySelectorAll) ? host.querySelectorAll(".av-fx-strip[data-mod]").length : 0,
    order: AV_FX_MODULES.map(m => m.mod),
    expect: expect,
    controls: { knobs: 0, boundKnobs: 0, toggles: 0, selects: 0, bound: 0 },
    paths: inv.map(e => e.path),
    params: {},
    inventory: inv,
    classes: avFxClasses(),
  };
  if (host && host.querySelectorAll) {
    const knobs = Array.prototype.slice.call(host.querySelectorAll(".av-knob[data-knob]"));
    const toggles = Array.prototype.slice.call(host.querySelectorAll("[data-fx-toggle]"));
    const sels = Array.prototype.slice.call(host.querySelectorAll("select.av-fx-select[data-param]"));
    snap.controls.knobs = knobs.length;
    snap.controls.boundKnobs = knobs.filter(k => k.dataset.knobBound === "1").length;
    snap.controls.toggles = toggles.length;
    snap.controls.selects = sels.length;
    snap.controls.bound = toggles.filter(b => b.dataset.fxBound === "1").length + sels.filter(s => s.dataset.fxBound === "1").length;
  }
  if (typeof avParams !== "undefined" && avParams) {
    inv.forEach(e => { if (Object.prototype.hasOwnProperty.call(avParams, e.path)) snap.params[e.path] = avParams[e.path]; });
  }
  return snap;
}

/* ---------- debug handle (rigs + parent call these; names are the contract) ---------- */

if (typeof window !== "undefined") {
  window.__avFx = {
    version: AV_FX_VERSION,
    init: () => avFxInit(),
    snap: () => avFxSnap(),
    classes: () => avFxClasses(),
    inventory: () => avFxInventory(),
    sync: (root) => avFxSync(root),
    commit: (path, v, el, from) => avFxCommit(path, v, el, from),
  };
}
