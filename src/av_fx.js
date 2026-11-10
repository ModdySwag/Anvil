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
   Defaults MIRROR the modules' own documented stock values (first paint = a module's stock
   sound the moment it is switched on; on = 0 for every module): drive mix 1 · amount 0 ·
   tone .5 (neutral) · bits 16; mod mix .5 · rate .6 Hz · depth .5 · feedback 0; delay mix
   .35 · time .3 s · feedback .4 · pingpong .5; verb mix .3 · size .5 · decay .5 (T60 ≈
   1.9 s) · damp .3; dyn mix 1 · thresh 0 · ratio 1 · ceiling 0 (neutral — dial it in).
   Not mounted in the v1 rack (engine-side / next wave): fx.verb.predelay, fx.delay.spread ·
   duck · bpm, fx.mod.stages, fx.drive.down, fx.dyn.eqLo/eqMid/eqHi · comp.att/rel/makeup —
   the rig still sweeps every one of those paths for delivery acceptance (cdp_fx §sweep).

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
      { path: "fx.drive.mix", label: "MIX", opts: { min: 0, max: 1, step: 0.01, def: 1, fmt: "pct" } },
      { path: "fx.drive.amount", label: "DRIVE", opts: { min: 0, max: 1, step: 0.01, def: 0, fmt: "pct", hint: "up to +30 dB" } },
      { path: "fx.drive.tone", label: "TONE", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct", hint: "one-pole tilt · 50% neutral" } },
      { path: "fx.drive.bits", label: "BITS", opts: { min: 4, max: 16, step: 1, def: 16, fmt: "int", hint: "crush mode quantiser" } },
    ],
  },
  {
    mod: "aw", label: "FLAVOUR", cap: "console · tape · drive · air · warm",
    toggle: { path: "fx.aw.on", aria: "Studio flavours module on/off" },
    selects: [
      { path: "fx.aw.mode", label: "MODE", aria: "Flavour mode (console · tape · drive · air · warm)", options: ["console", "tape", "drive", "air", "warm"], def: "console" },
    ],
    knobs: [
      { path: "fx.aw.mix", label: "MIX", opts: { min: 0, max: 1, step: 0.01, def: 1, fmt: "pct" } },
      { path: "fx.aw.amount", label: "AMOUNT", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct", hint: "flavour depth" } },
      { path: "fx.aw.tone", label: "TONE", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct", hint: "50% neutral" } },
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
      { path: "fx.delay.mix", label: "MIX", opts: { min: 0, max: 1, step: 0.01, def: 0.35, fmt: "pct" } },
      { path: "fx.delay.time", label: "TIME", opts: { min: 0.01, max: 2, step: 0.001, def: 0.3, curve: "log", fmt: "ms" } },
      { path: "fx.delay.feedback", label: "FEEDBACK", opts: { min: 0, max: 0.95, step: 0.01, def: 0.4, fmt: "pct" } },
      { path: "fx.delay.pingpong", label: "PING-PONG", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct", hint: "cross-feedback" } },
    ],
  },
  {
    mod: "verb", label: "VERB", cap: "plate · fdn · freeverb",
    toggle: { path: "fx.verb.on", aria: "Reverb module on/off" },
    selects: [
      { path: "fx.verb.mode", label: "MODE", aria: "Reverb mode (plate · fdn · freeverb)", options: ["plate", "fdn", "freeverb"], def: "plate" },
    ],
    knobs: [
      { path: "fx.verb.mix", label: "MIX", opts: { min: 0, max: 1, step: 0.01, def: 0.3, fmt: "pct" } },
      { path: "fx.verb.size", label: "SIZE", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct" } },
      { path: "fx.verb.decay", label: "DECAY", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct", hint: "≈ T60 0.3–12 s" } },
      { path: "fx.verb.damp", label: "DAMP", opts: { min: 0, max: 1, step: 0.01, def: 0.3, fmt: "pct" } },
    ],
  },
  {
    mod: "conv", label: "CONV", cap: "plate · room · hall · spring · cab · user",
    toggle: { path: "fx.conv.on", aria: "Convolution IR module on/off" },
    selects: [
      { path: "fx.conv.mode", label: "MODE", aria: "IR mode (plate · room · hall · spring · cab · user)", options: ["plate", "room", "hall", "spring", "cab", "user"], def: "plate" },
    ],
    knobs: [
      { path: "fx.conv.mix", label: "MIX", opts: { min: 0, max: 1, step: 0.01, def: 0.25, fmt: "pct" } },
      { path: "fx.conv.size", label: "SIZE", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct" } },
      { path: "fx.conv.decay", label: "DECAY", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct" } },
      { path: "fx.conv.damp", label: "DAMP", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct" } },
    ],
    button: { id: "av-fx-conv-import", label: "IMPORT IR", statusId: "av-fx-conv-status" },
  },
  {
    mod: "dyn", label: "DYN", cap: "comp · limiter · soft-clip",
    toggle: { path: "fx.dyn.on", aria: "Dynamics module on/off" },
    selects: [],
    knobs: [
      { path: "fx.dyn.mix", label: "MIX", opts: { min: 0, max: 1, step: 0.01, def: 1, fmt: "pct" } },
      { path: "fx.dyn.comp.thresh", label: "THRESH", opts: { min: -40, max: 0, step: 0.5, def: 0, fmt: "db", hint: "compressor threshold" } },
      { path: "fx.dyn.comp.ratio", label: "RATIO", opts: { min: 1, max: 20, step: 0.1, def: 1, fmt: "x", hint: "compressor ratio" } },
      { path: "fx.dyn.lim.ceiling", label: "CEIL", opts: { min: -6, max: 0, step: 0.1, def: 0, fmt: "db", hint: "limiter ceiling" } },
    ],
  },
];

/* state (the rig reads inited via avFxSnap) */
const avFxState = { inited: false, mounts: 0 };

/* C3-4 disclosure (owner's call: basic-first defaults). DRIVE and FLAVOUR are the always-on
   tone stage and stay on the face; the five deep modules fold behind one chip each. The chip
   lights up while its module is enabled, so a folded module that is ON is still visible. */
const AV_FX_ADV = [["mod", "MOD"], ["delay", "DELAY"], ["verb", "VERB"], ["conv", "CONV"], ["dyn", "DYN"]];

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
  return '<div class="av-fx-strip' + (on ? " av-fx-on" : "") + '" data-mod="' + avFxEsc(m.mod) + '" data-sect="' + avFxEsc(m.mod) + '" data-idx="' + idx + '">' +
    '<div class="av-fx-strip-head"><span class="av-fx-mod">' + avFxEsc(m.label) + "</span>" +
    '<span class="av-fx-cap">' + avFxEsc(m.cap) + "</span>" + toggle + "</div>" +
    '<div class="av-fx-ctl">' + sels + avKnobRowHTML(knobs, "av-fx-knobs") + "</div>" +
    (m.button ? '<div class="av-fx-actions"><button type="button" class="av-btn mini av-fx-btn" id="' + avFxEsc(m.button.id) + '" aria-label="' + avFxEsc(m.button.label) + '">' + avFxEsc(m.button.label) + '</button><span class="av-fx-status" id="' + avFxEsc(m.button.statusId) + '"></span></div>' : "") +
    "</div>";
}

/* the whole card body (parent styles .av-fx; the strips stack in the pinned order) */
function avFxBodyHTML() {
  const strips = AV_FX_MODULES.map((m, i) => avFxStripHTML(m, i)).join("");
  return '<div class="av-fx" data-av-fx="1">' +
    '<div class="av-fx-head"><span class="av-fx-title">FX RACK</span>' +
    '<span class="av-fx-cap">drive → flavour → mod → delay → verb → conv → dyn · inside the mixer worklet · every module off = bit-identical bypass</span></div>' +
    '<div class="av-fx-strips">' + strips + "</div>" +
    avFxChainHTML() +
    "</div>";
}

/* P2 (2026-11-10): the rack is a SERIAL CHAIN, and the page has to say so. This is the signal-flow
   bar under the strips: IN -> one block per module in processing order -> OUT, each block lit from
   its own strip's on-state. It is a fixed-height block, so it can never stretch a strip (the failure
   mode that killed the first attempt at this page). */
function avFxChainHTML() {
  let out = '<span class="av-fx-chain-term">IN</span>';
  for (let i = 0; i < AV_FX_MODULES.length; i++) {
    const m = AV_FX_MODULES[i];
    out += '<span class="av-fx-chain-arrow" aria-hidden="true">›</span>' +
      '<span class="av-fx-chain-block" data-chain="' + avFxEsc(m.mod) + '">' +
      '<i class="av-fx-chain-led"></i>' + avFxEsc(m.label) + '</span>';
  }
  out += '<span class="av-fx-chain-arrow" aria-hidden="true">›</span>' +
    '<span class="av-fx-chain-term">OUT</span>';
  return '<div class="av-fx-chain" id="av-fx-chain" role="img" aria-label="signal chain: ' +
    'in, then every module in processing order, then out">' + out + '</div>';
}

/* mirror each strip's on-state onto its chain block (the strips own the truth) */
function avFxChainSync() {
  try {
    const card = document.getElementById("av-fx");
    if (!card) return false;
    const strips = card.querySelectorAll(".av-fx-strip[data-sect]");
    for (let i = 0; i < strips.length; i++) {
      const mod = strips[i].getAttribute("data-sect");
      const blk = card.querySelector('.av-fx-chain-block[data-chain="' + mod + '"]');
      if (blk) blk.classList.toggle("on", strips[i].classList.contains("av-fx-on"));
    }
    return true;
  } catch (e) { return false; }
}

/* ---------- C3 disclosure (same contract as the MIX desk and the MIDI panel) ---------- */

/* Fold the deep modules behind one chip each. Proven shape (avMixUiDisclosure): resolve the
   CARD, insert the chip row inside it, give each section's head a .av-sec-toggle, and fold via
   the generic .av-sec-collapsed rule. The chip is only in the row while its section is folded;
   the head toggle is the way back. Runs after every mount, so a re-mount re-folds. */
function avFxFoldInit(root) {
  if (!root || typeof root.querySelector !== "function" || typeof document === "undefined") return false;
  const card = root.querySelector(".av-fx") || root;
  const stripsWrap = card.querySelector(".av-fx-strips");
  if (!stripsWrap) return false;
  if (card.querySelector(".av-fx-adv")) return false;   /* already folded (defensive) */
  const row = document.createElement("div");
  row.className = "av-fx-adv";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "folded FX modules");
  AV_FX_ADV.forEach(function (pair) {
    const name = pair[0], label = pair[1];
    const sec = card.querySelector('.av-fx-strip[data-sect="' + name + '"]');
    if (!sec) return;
    const head = sec.querySelector(".av-fx-strip-head");
    if (!head || head.querySelector(".av-sec-toggle")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "av-sec-toggle";
    btn.textContent = "▸";
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "av-adv-chip";
    chip.dataset.adv = name;
    chip.textContent = label;
    function sync() {
      const folded = sec.classList.contains("av-sec-collapsed");
      const on = !!(typeof avParams !== "undefined" && avParams && avParams["fx." + name + ".on"]);
      chip.hidden = !folded;
      chip.setAttribute("aria-expanded", folded ? "false" : "true");
      chip.classList.toggle("on", on);
      chip.title = (on ? label + " is ON — " : "") + "Show the " + label + " controls";
      chip.setAttribute("aria-label", chip.title);
      btn.textContent = folded ? "▸" : "▾";
      btn.setAttribute("aria-expanded", folded ? "false" : "true");
      btn.title = (folded ? "Show the " : "Hide the ") + label + " controls";
      btn.setAttribute("aria-label", btn.title);
    }
    chip.addEventListener("click", function () { sec.classList.remove("av-sec-collapsed"); sync(); });
    btn.addEventListener("click", function () { sec.classList.toggle("av-sec-collapsed"); sync(); });
    sec.classList.add("av-sec-collapsed");
    head.appendChild(btn);
    row.appendChild(chip);
    sync();
  });
  card.insertBefore(row, stripsWrap);
  return true;
}

/* repaint the chip state (folded visibility + the ON light) without touching layout */
function avFxFoldSync(root) {
  let card = root || null;
  if (!card || typeof card.querySelector !== "function") return false;
  if (!card.querySelector(".av-fx-adv")) card = card.querySelector(".av-fx") || card;
  const row = card.querySelector ? card.querySelector(".av-fx-adv") : null;
  if (!row) return false;
  row.querySelectorAll(".av-adv-chip").forEach(function (chip) {
    const name = chip.dataset.adv;
    const sec = card.querySelector('.av-fx-strip[data-sect="' + name + '"]');
    const folded = !!(sec && sec.classList.contains("av-sec-collapsed"));
    const on = !!(typeof avParams !== "undefined" && avParams && avParams["fx." + name + ".on"]);
    chip.hidden = !folded;
    chip.setAttribute("aria-expanded", folded ? "false" : "true");
    chip.classList.toggle("on", on);
    chip.title = (on ? name.toUpperCase() + " is ON — " : "") + "Show the " + name.toUpperCase() + " controls";
  });
  return true;
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
  try { avFxFoldSync(host); } catch (e) { /* chips keep their last paint */ }
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
  try { avFxChainSync(); } catch (e) { /* the chain mirrors the strips, best-effort */ }
  try { avFxFoldSync(host); } catch (e) { /* chips keep their last paint */ }
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
    if (btn) {
      const path = btn.dataset.fxToggle;
      avFxCommit(path, avParams[path] ? 0 : 1, btn, "toggle");
      return;
    }
    const b2 = t.closest(".av-fx-btn");
    if (b2 && b2.id === "av-fx-conv-import") avFxConvImport();
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
  return ["av-fx", "av-fx-head", "av-fx-title", "av-fx-cap", "av-fx-strips", "av-fx-strip", "av-fx-screen", "av-fx-screencv", "av-fx-screen-cap",
    "av-fx-on", "av-fx-strip-head", "av-fx-mod", "av-fx-toggle", "av-fx-ctl",
    "av-fx-pick", "av-fx-pick-lbl", "av-fx-knobs", "av-fx-actions", "av-fx-btn", "av-fx-status",
    "av-fx-adv", "av-adv-chip", "av-sec-toggle", "av-sec-collapsed"];
}

/* ---------- init (mount) ---------- */

/* mount into the parent-owned host: seed unset mirror paths, render, bind knobs/toggles/
   selects, repaint. Host absent or knob parts missing → false, no throw. Re-mountable: a
   second call rebuilds the markup from the live mirror (used by the rig's absent-host probe). */
/* ---------- C3-14 screen 3: per-slot effect screens ---------- */

/* Each strip gets the screen its block actually has, INSIDE the strip: folded (the default) the
   screen costs 0px, and opening a module paints it through a ResizeObserver (trap 20 — a folded
   canvas has no box). Every screen is computed from that module's own params; none of them pretends
   to show live signal the UI cannot see. */
const AV_FX_SCREEN_META = {
  drive: { cap: function (P) { return String(P("fx.drive.mode")).toUpperCase() + " . DRIVE +" + Math.round(P("fx.drive.amount") * 30) + "dB"; } },
  delay: { cap: function (P) { return Number(P("fx.delay.time")).toFixed(3) + "s . FB " + Math.round(P("fx.delay.feedback") * 100) + "%"; } },
  verb: { cap: function (P) { return "T60 " + (0.3 + P("fx.verb.decay") * 11.7).toFixed(1) + "s . SIZE " + Math.round(P("fx.verb.size") * 100); } },
  conv: { cap: function (P) { return String(P("fx.conv.mode")).toUpperCase() + " . T60 " + (0.3 + P("fx.conv.decay") * 11.7).toFixed(1) + "s"; } },
  dyn: { cap: function (P) { return "T " + Number(P("fx.dyn.comp.thresh")).toFixed(0) + "dB . R " + Number(P("fx.dyn.comp.ratio")).toFixed(1) + "x"; } },
  mod: { cap: function (P) { return String(P("fx.mod.mode")).toUpperCase() + " . " + Number(P("fx.mod.rate")).toFixed(2) + "Hz . " + Math.round(P("fx.mod.depth") * 100); } }
};

function avFxScreenHTML() {
  return '<div class="av-fx-screen"><canvas class="av-fx-screencv" aria-label="Effect block screen"></canvas>' +
    '<span class="av-fx-screen-cap"></span></div>';
}

function avFxScreenPaint(canvas, mod) {
  try {
    if (!canvas || typeof canvas.getContext !== "function") return false;
    const box = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    const cssW = Math.max(40, Math.round((box && box.width) || 300));
    const cssH = Math.max(24, Math.round((box && box.height) || 56));
    const dpr = Math.max(1, Math.min(3, (typeof window !== "undefined" && window.devicePixelRatio) || 1));
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const w = canvas.width, h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const P = function (path, def) {
      if (typeof avParams === "undefined" || !avParams) return def;
      const v = avParams[path];
      return (v == null || (typeof v === "string" && v === "")) ? def : v;
    };
    const N = function (path, def) { const v = Number(P(path, def)); return isFinite(v) ? v : def; };
    const base = h - 5 * dpr, top = 5 * dpr, H = base - top;
    const teal = "#2ed8c9", dim = "rgba(150,170,170,0.35)";
    /* P2: a quarter graticule. Every block screen draws its real curve — and at default settings that
       curve IS the unity line, so without a grid the box reads as blank rather than as an instrument
       sitting at 0 dB. Paint only; the caption still carries the units. */
    ctx.strokeStyle = "rgba(255,255,255,0.115)"; ctx.lineWidth = 1;
    for (let g = 1; g < 4; g++) {
      const gx = Math.round((g / 4) * w) + 0.5, gy = Math.round(top + (g / 4) * H) + 0.5;
      ctx.beginPath(); ctx.moveTo(gx, top); ctx.lineTo(gx, base); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
    }
    if (mod === "drive") {
      const amt = Math.max(0, Math.min(1, N("fx.drive.amount", 0)));
      const mode = String(P("fx.drive.mode", "sat"));
      const k = 1 + amt * 29;                     /* up to +30 dB of drive */
      const bits = Math.max(4, Math.min(16, N("fx.drive.bits", 16)));
      const shape = function (x) {
        if (mode === "fold") { let v = x * (1 + amt * 6); while (v > 1 || v < -1) v = v > 1 ? 2 - v : -2 - v; return v; }
        if (mode === "crush") { const q = Math.pow(2, bits - 1); return Math.round((x * (1 + amt * 6)) * q) / q; }
        return Math.tanh(x * k) / Math.tanh(k || 1);
      };
      ctx.strokeStyle = dim; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, base); ctx.lineTo(w, top); ctx.stroke();
      ctx.strokeStyle = teal; ctx.lineWidth = Math.max(1, 1.6 * dpr); ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const x = (i / 120) * 2 - 1;
        const y = base - ((shape(x) + 1) / 2) * H;
        if (i === 0) ctx.moveTo(0, y); else ctx.lineTo((i / 120) * w, y);
      }
      ctx.stroke();
    } else if (mod === "dyn") {
      const th = Math.max(-48, Math.min(0, N("fx.dyn.comp.thresh", 0)));
      const ra = Math.max(1, Math.min(20, N("fx.dyn.comp.ratio", 1)));
      const ceil = Math.max(-48, Math.min(0, N("fx.dyn.lim.ceiling", 0)));
      const lo = -48;
      ctx.strokeStyle = dim; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, base); ctx.lineTo(w, top); ctx.stroke();
      ctx.strokeStyle = teal; ctx.lineWidth = Math.max(1, 1.6 * dpr); ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const xin = lo + (i / 120) * (0 - lo);
        let out = xin <= th ? xin : th + (xin - th) / ra;
        if (out > ceil && ceil < 0) out = ceil;
        const px = (i / 120) * w, py = base - ((out - lo) / (0 - lo)) * H;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    } else if (mod === "delay") {
      const t = Math.max(0.01, N("fx.delay.time", 0.3));
      const fb = Math.max(0, Math.min(0.95, N("fx.delay.feedback", 0.4)));
      const pp = Math.max(0, Math.min(1, N("fx.delay.pingpong", 0.5)));
      const span = Math.max(2, t * 4);            /* show at least four taps */
      ctx.strokeStyle = teal; ctx.lineWidth = Math.max(1, 1.4 * dpr);
      for (let n = 0; n < 10; n++) {
        const at = (n + 1) * t;
        if (at > span) break;
        const x = (at / span) * w, amp = Math.pow(fb || 0.02, n);
        const hgt = Math.max(1, amp * H);
        ctx.globalAlpha = 0.35 + (pp ? (n % 2 ? 0.15 : 0) : 0);
        ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, base - hgt); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (mod === "verb" || mod === "conv") {
      const d = Math.max(0, Math.min(1, N("fx." + mod + ".decay", 0.5)));
      const t60 = 0.3 + d * 11.7;
      const tau = t60 / 6.9078;
      ctx.strokeStyle = teal; ctx.lineWidth = Math.max(1, 1.6 * dpr); ctx.beginPath();
      for (let i = 0; i <= 140; i++) {
        const tt = (i / 140) * 4 * tau;
        const y = base - Math.exp(-tt / tau) * H;
        if (i === 0) ctx.moveTo(0, y); else ctx.lineTo((i / 140) * w, y);
      }
      ctx.stroke();
    } else if (mod === "mod") {
      const rate = Math.max(0.05, Math.min(10, N("fx.mod.rate", 0.6)));
      const depth = Math.max(0, Math.min(1, N("fx.mod.depth", 0.5)));
      const cyc = 2;
      ctx.strokeStyle = teal; ctx.lineWidth = Math.max(1, 1.6 * dpr); ctx.beginPath();
      for (let i = 0; i <= 140; i++) {
        const ph = (i / 140) * cyc * Math.PI * 2;
        const y = base - H * 0.5 - Math.sin(ph) * H * 0.45 * depth;
        if (i === 0) ctx.moveTo(0, y); else ctx.lineTo((i / 140) * w, y);
      }
      ctx.stroke();
    }
    return true;
  } catch (e) { return false; }
}

function avFxScreensSync(hostArg) {
  try {
    let host = hostArg || null;
    if (!host) { try { host = document.getElementById("av-fx-host"); } catch (e) { host = null; } }
    if (!host || typeof host.querySelectorAll !== "function") return false;
    const P = function (path, def) {
      if (typeof avParams === "undefined" || !avParams) return def;
      const v = avParams[path];
      return (v == null || (typeof v === "string" && v === "")) ? def : v;
    };
    host.querySelectorAll(".av-fx-strip[data-mod]").forEach(function (strip) {
      const mod = strip.getAttribute("data-mod");
      const box = strip.querySelector(".av-fx-screen");
      if (!box || !AV_FX_SCREEN_META[mod]) return;
      const cv = box.querySelector(".av-fx-screencv");
      if (cv) avFxScreenPaint(cv, mod);
      const cap = box.querySelector(".av-fx-screen-cap");
      const txt = AV_FX_SCREEN_META[mod].cap(P);
      if (cap && cap.textContent !== txt) cap.textContent = txt;
    });
    return true;
  } catch (e) { return false; }
}

function avFxScreensInit(hostArg) {
  try {
    let host = hostArg || null;
    if (!host) { try { host = document.getElementById("av-fx-host"); } catch (e) { host = null; } }
    if (!host || typeof host.querySelectorAll !== "function" || typeof document === "undefined") return false;
    host.querySelectorAll(".av-fx-strip[data-mod]").forEach(function (strip) {
      const mod = strip.getAttribute("data-mod");
      if (!AV_FX_SCREEN_META[mod] || strip.querySelector(".av-fx-screen")) return;
      strip.insertAdjacentHTML("beforeend", avFxScreenHTML());
      const box = strip.querySelector(".av-fx-screen");
      try {
        if (box && typeof ResizeObserver === "function" && !box.__avFxRO) {
          box.__avFxRO = new ResizeObserver(function () { try { avFxScreensSync(host); } catch (e5) { } });
          box.__avFxRO.observe(box);
        }
      } catch (e4) { /* the observer is a nicety */ }
    });
    try {
      if (typeof window !== "undefined" && !window.__avFxScreenHook) {
        window.__avFxScreenHook = 1;
        window.addEventListener("av-param", function (ev) {
          const pth = ev && ev.detail && ev.detail.path;
          if (typeof pth === "string" && pth.indexOf("fx.") === 0) { try { avFxScreensSync(); } catch (e3) { } }
        });
      }
    } catch (e2) { /* no window */ }
    avFxScreensSync(host);
    return true;
  } catch (e) { return false; }
}

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
    try { avFxFoldInit(host); } catch (e) { /* deep modules stay up */ }
    avKnobBind(host);
    avFxWire(host);
    avFxBindSelects(host);
    avFxMarkBound(host);
    avFxSync(host);
    try { avFxScreensInit(host); } catch (e6) { /* screens are insets, never the card */ }
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
    fold: { chips: 0, folded: 0, face: [] },
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
    snap.fold.chips = host.querySelectorAll(".av-fx-adv .av-adv-chip").length;
    snap.fold.folded = Array.prototype.slice.call(host.querySelectorAll('.av-fx-strip[data-sect]'))
      .filter(s => s.classList.contains("av-sec-collapsed")).length;
    snap.fold.face = Array.prototype.slice.call(host.querySelectorAll('.av-fx-strip[data-sect]'))
      .filter(s => !s.classList.contains("av-sec-collapsed")).map(s => s.dataset.sect);
  }
  if (typeof avParams !== "undefined" && avParams) {
    inv.forEach(e => { if (Object.prototype.hasOwnProperty.call(avParams, e.path)) snap.params[e.path] = avParams[e.path]; });
  }
  return snap;
}


/* ---------- M1: the CONV IR import leg (page-owned; the worklet module stays pure DSP) ---------- */

function avFxConvStatus(text) {
  try {
    const el = document.getElementById("av-fx-conv-status");
    if (el) el.textContent = String(text == null ? "" : text);
  } catch (e) { /* no DOM */ }
}

/* linear-interpolating resample to the engine rate (IRs only; quality is ample, zero deps) */
function avFxConvResample(data, rate, sr) {
  if (Math.abs(rate - sr) < 1) return data.slice(0);
  const n = Math.max(1, Math.round(data.length * sr / rate));
  const out = new Float64Array(n);
  const step = rate / sr;
  for (let i = 0; i < n; i++) {
    const x = i * step;
    const i0 = Math.floor(x);
    const i1 = Math.min(data.length - 1, i0 + 1);
    const t2 = x - i0;
    out[i] = data[i0] * (1 - t2) + data[i1] * t2;
  }
  return out;
}

function avFxConvImport() {
  try {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "audio/*,.wav,.aif,.aiff,.ogg,.flac,.mp3";
    inp.style.display = "none";
    document.body.appendChild(inp);
    inp.addEventListener("change", async () => {
      try {
        const file = inp.files && inp.files[0];
        if (!file) return;
        avFxConvStatus("decoding " + file.name + "…");
        const bytes = await file.arrayBuffer();
        const AC = window.AudioContext || window.webkitAudioContext;
        const dcx = new AC();
        let buf = null;
        try { buf = await dcx.decodeAudioData(bytes); }
        finally { try { dcx.close(); } catch (e2) { } }
        if (!buf) { avFxConvStatus("decode failed"); return; }
        const sr = (window.__avEngine && window.__avEngine.sr) || 48000;
        const cap = Math.floor(sr * 2.0);
        let ch1 = avFxConvResample(buf.getChannelData(0), buf.sampleRate, sr);
        let ch2 = (buf.numberOfChannels > 1) ? avFxConvResample(buf.getChannelData(1), buf.sampleRate, sr) : null;
        if (ch1.length > cap) ch1 = ch1.slice(0, cap);
        if (ch2 && ch2.length > cap) ch2 = ch2.slice(0, cap);
        if (typeof avEngineConv !== "function") { avFxConvStatus("engine not ready"); return; }
        const ok = avEngineConv(0, file.name.replace(/\.[^.]+$/, ""), sr, ch1, ch2);
        if (ok) {
          avFxCommit("fx.conv.mode", "user", null, "conv-import");
          avFxConvStatus("loaded: " + file.name);
        } else avFxConvStatus("engine refused the impulse (engine ready?)");
      } catch (e2) { avFxConvStatus("import failed: " + String((e2 && e2.message) || e2)); }
      finally { try { inp.remove(); } catch (e2) { } }
    });
    inp.click();
  } catch (e) { avFxConvStatus("import failed"); }
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
