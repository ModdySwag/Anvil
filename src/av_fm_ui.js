/* Anvil — FM CARD (M1 wave, child sa-B): the FM engine's control surface mounted into the
   parent-owned host #av-fm-host. The parent adds the card + host; this part owns the UI only.

   Layout (DOM pins per verify/_m1_wave.md §2.2):
     op tabs        .av-fm-op-tab[data-op="1".."6"] — one button per operator
     op panels      [data-op-panel="N"] — one panel per operator; the ACTIVE one carries
                    .av-fm-op-on and is visible; ALL panels render their eight fm.opN.* knobs
                    (inactive stay hidden via hidden + inline display:none) so every knob
                    carries its data-def in the DOM for the share-wire diff (M1 triage fix)
     algorithm      #av-fm-algo — select.av-select with data-param="fm.algo", options 0..7
     algorithm view #av-fm-algo-view — a small inline SVG drawn STRICTLY from
                    AVFM.algoInfo(i) (typeof-guarded); with the engine module absent it degrades
                    to a labelled placeholder, never a routing guess
     globals        fm.fb + fm.volume knobs, always visible (self-feedback rides OP 6)
     status line    #av-fm-status

   Param schema (LOCAL copy of verify/_m1_wave.md §2.1 — this part cannot import av_fm.js, so
   the table below is the single source both sides must agree on exactly):
     fm.algo    int 0..7    def 0                  (the select, not a knob)
     fm.fb      0..1        def 0                  (self-feedback on OP 6)
     fm.volume  0..1        def 0.8                (house engine-volume convention)
     per op N = 1..6 (8 knobs each):
       fm.opN.ratio  0.5..16    def {op1:1, op2:2, op3..6:1}   log curve in the UI
       fm.opN.detune -1..1 st   def 0
       fm.opN.level  0..1       def {op1:1, op2:0.35, op3..6:0}
       fm.opN.att    0.001..8 s def 0.001
       fm.opN.dec    0.001..8 s def 1.2
       fm.opN.sus    0..1       def 0.5
       fm.opN.rel    0.001..8 s def 0.3
       fm.opN.vel    0..1       def 0.5
   The defaults above = a usable 2-op patch on algorithm 0 at first paint.

   Laws (M1 brief): NO DOM at top level — every DOM touch sits inside a guarded function;
   never throws outward (mount returns false when the host or the knob parts are missing);
   re-mountable (avFmUiInit rebuilds the markup; seeding only fills UNSET mirror paths, so a
   re-mount can never clobber a live value); no engine reach-ins beyond AVFM.algoInfo
   (typeof-guarded); this file touches no other src file; "use strict" everywhere.

   Public surface (classic-script globals, ONE namespace):
     avFmUiInit() -> bool          mount / re-mount into #av-fm-host
     avFmUiSnap() -> snapshot      plain read of the card state (no DOM -> zeros; never throws)
     avFmUiClasses() -> string[]   the NEW css class names this card emits (parent styles them)
     avFmUiSync(root) -> bool      repaint every fm.* control from avParams (CC writes / loads)
     avFmSetOp(op) -> bool         switch the active operator (extra seam for harness + rigs)
     window.__avFmUi = {version, init, snap, classes, sync}
*/

"use strict";

const AV_FM_VERSION = "m1.0";

/* ---------- the §2.1 table (single source for markup, defaults, paths, ranges) ---------- */

const AV_FM_OPS = 6;             /* operators 1..6 (op 6 carries the self-feedback) */
const AV_FM_ALGO_COUNT = 8;      /* fm.algo 0..7 */

/* the voice row: ratio · detune · level · velocity (display order) */
const AV_FM_OP_MAIN = [
  { key: "ratio", label: "RATIO", opts: { min: 0.5, max: 16, step: 0.001, def: 1, curve: "log", fmt: "x", hint: "frequency ratio vs the note · log" } },
  { key: "detune", label: "DETUNE", opts: { min: -1, max: 1, step: 0.01, def: 0, unit: "st" } },
  { key: "level", label: "LEVEL", opts: { min: 0, max: 1, step: 0.01, def: 1, fmt: "pct", hint: "carrier output / modulator depth" } },
  { key: "vel", label: "VEL", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct", hint: "velocity depth" } },
];

/* the envelope row: att · dec · sus · rel (display order) */
const AV_FM_OP_ENV = [
  { key: "att", label: "ATTACK", opts: { min: 0.001, max: 8, step: 0.001, def: 0.001, curve: "log", fmt: "ms" } },
  { key: "dec", label: "DECAY", opts: { min: 0.001, max: 8, step: 0.001, def: 1.2, curve: "log", fmt: "ms" } },
  { key: "sus", label: "SUSTAIN", opts: { min: 0, max: 1, step: 0.01, def: 0.5, fmt: "pct" } },
  { key: "rel", label: "RELEASE", opts: { min: 0.001, max: 8, step: 0.001, def: 0.3, curve: "log", fmt: "ms" } },
];

/* the always-visible globals */
const AV_FM_GLOBALS = [
  { path: "fm.fb", label: "FEEDBACK", opts: { min: 0, max: 1, step: 0.01, def: 0, fmt: "pct", hint: "self-feedback on OP 6" } },
  { path: "fm.volume", label: "VOLUME", opts: { min: 0, max: 1, step: 0.01, def: 0.8, fmt: "pct" } },
];

/* UI state: the active operator survives re-mounts; mounts/inited feed avFmUiSnap */
const avFmState = { inited: false, mounts: 0, op: 1 };

/* ---------- guards + small helpers (pure) ---------- */

/* the remembered active op, clamped to 1..6 (junk -> the current state, never a NaN) */
function avFmOpNorm(op) {
  const n = Number(op);
  if (!isFinite(n)) return 1;
  return Math.max(1, Math.min(AV_FM_OPS, Math.round(n)));
}

/* fm.algo (0..7) from anything numeric-ish; junk -> 0 */
function avFmAlgoNorm(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(AV_FM_ALGO_COUNT - 1, Math.round(n)));
}

/* local escaper — the same rules as avKnobEsc / avSynthEsc / avFxEsc; no extra deps */
const avFmEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* path -> CSS-attribute escape for readout lookups (av_knob owns the real one) */
function avFmCssEsc(s) {
  if (typeof avKnobCssEscape === "function") { try { return avKnobCssEscape(s); } catch (e) { /* fall through */ } }
  return String(s == null ? "" : s).replace(/[^a-zA-Z0-9_-]/g, ch => "\\" + ch);
}

/* one operator's eight knob specs, straight from the §2.1 table (def overrides for ratio/level) */
function avFmOpKnobs(op) {
  const n = avFmOpNorm(op);
  const out = [];
  for (let i = 0; i < AV_FM_OP_MAIN.length; i++) {
    const f = AV_FM_OP_MAIN[i];
    const o = Object.assign({}, f.opts);
    if (f.key === "ratio") o.def = (n === 2) ? 2 : 1;
    if (f.key === "level") o.def = (n === 1) ? 1 : (n === 2 ? 0.35 : 0);
    out.push({ path: "fm.op" + n + "." + f.key, label: f.label, opts: o });
  }
  for (let i = 0; i < AV_FM_OP_ENV.length; i++) {
    const f = AV_FM_OP_ENV[i];
    out.push({ path: "fm.op" + n + "." + f.key, label: f.label, opts: Object.assign({}, f.opts) });
  }
  return out;
}

/* every path this card mounts: fm.algo · fm.fb · fm.volume · fm.op1..6 x 8 = 51 */
function avFmPaths() {
  const out = ["fm.algo"];
  for (let i = 0; i < AV_FM_GLOBALS.length; i++) out.push(AV_FM_GLOBALS[i].path);
  for (let op = 1; op <= AV_FM_OPS; op++) {
    const ks = avFmOpKnobs(op);
    for (let i = 0; i < ks.length; i++) out.push(ks[i].path);
  }
  return out;
}

/* the full §2.1 default table (a fresh copy every call) */
function avFmDefaults() {
  const d = { "fm.algo": 0 };
  for (let i = 0; i < AV_FM_GLOBALS.length; i++) d[AV_FM_GLOBALS[i].path] = AV_FM_GLOBALS[i].opts.def;
  for (let op = 1; op <= AV_FM_OPS; op++) {
    const ks = avFmOpKnobs(op);
    for (let i = 0; i < ks.length; i++) d[ks[i].path] = ks[i].opts.def;
  }
  return d;
}

/* ---------- the algorithm view (pure string builders; AVFM.algoInfo is the ONLY engine read) ---------- */

const AV_FM_SVG_W = 196, AV_FM_SVG_H = 144, AV_FM_SVG_R = 16;

/* fixed node geometry: ops 0/1/2 down the left column, 3/4/5 down the right */
function avFmNodePos(i) {
  const col = (i >= 3) ? 1 : 0;
  const row = i % 3;
  return { x: col ? 148 : 48, y: 32 + row * 40 };
}

/* AVFM.algoInfo(i) via typeof guard; null when the engine module is absent / refuses */
function avFmAlgoInfoSafe(algo) {
  try {
    if (typeof AVFM === "undefined" || !AVFM || typeof AVFM.algoInfo !== "function") return null;
    const info = AVFM.algoInfo(avFmAlgoNorm(algo));
    return (info && typeof info === "object") ? info : null;
  } catch (e) { return null; }
}

/* the #av-fm-algo-view content: a small inline SVG of {name, carriers, edges} — carriers
   highlighted, arrows modulator -> carrier, the OP 6 self-feedback loop always drawn.
   Junk fields are skipped, never thrown on. */
function avFmAlgoSVG(algo, info) {
  const a = avFmAlgoNorm(algo);
  const known = !!(info && typeof info === "object");
  const name = (known && typeof info.name === "string") ? info.name : "";
  const head = '<svg class="av-fm-svg" viewBox="0 0 ' + AV_FM_SVG_W + " " + AV_FM_SVG_H + '" width="' + AV_FM_SVG_W + '" height="' + AV_FM_SVG_H +
    '" role="img" aria-label="' + avFmEsc("FM algorithm " + a + (name ? " — " + name : "")) + '">';
  const lbl = '<text class="av-fm-view-lbl" x="8" y="14">' + avFmEsc("ALGO " + a + (name ? " · " + name : "")) + "</text>";
  if (!known) {
    /* honest placeholder — the engine module is not loaded, so no routing is guessed */
    return head + lbl + '<text class="av-fm-view-lbl" x="8" y="76">' + avFmEsc("engine module not loaded — routing view unavailable") + "</text></svg>";
  }
  const carriers = [];
  if (Array.isArray(info.carriers)) {
    for (let i = 0; i < info.carriers.length; i++) {
      const c = Math.round(Number(info.carriers[i]));
      if (isFinite(c) && c >= 0 && c < AV_FM_OPS && carriers.indexOf(c) < 0) carriers.push(c);
    }
  }
  const edges = [];
  if (Array.isArray(info.edges)) {
    for (let i = 0; i < info.edges.length; i++) {
      const e = info.edges[i];
      if (!Array.isArray(e) || e.length < 2) continue;
      const f = Math.round(Number(e[0])), t = Math.round(Number(e[1]));
      if (!isFinite(f) || !isFinite(t) || f < 0 || f >= AV_FM_OPS || t < 0 || t >= AV_FM_OPS || f === t) continue;
      edges.push([f, t]);
    }
  }
  const pieces = [head, lbl];
  /* edges first (under the nodes) */
  for (let i = 0; i < edges.length; i++) {
    const f = edges[i][0], t = edges[i][1];
    const p1 = avFmNodePos(f), p2 = avFmNodePos(t);
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.max(1e-6, Math.sqrt(dx * dx + dy * dy));
    const ux = dx / len, uy = dy / len;
    const sx = p1.x + ux * (AV_FM_SVG_R + 2), sy = p1.y + uy * (AV_FM_SVG_R + 2);
    const ex = p2.x - ux * (AV_FM_SVG_R + 8), ey = p2.y - uy * (AV_FM_SVG_R + 8);
    pieces.push('<line class="av-fm-edge" x1="' + sx.toFixed(1) + '" y1="' + sy.toFixed(1) + '" x2="' + ex.toFixed(1) + '" y2="' + ey.toFixed(1) + '" />');
    const ax = p2.x - ux * (AV_FM_SVG_R + 2), ay = p2.y - uy * (AV_FM_SVG_R + 2);
    const nx = -uy, ny = ux;
    pieces.push('<path class="av-fm-arrow" d="M ' + ax.toFixed(1) + " " + ay.toFixed(1) +
      " L " + (ax - ux * 7 + nx * 3.5).toFixed(1) + " " + (ay - uy * 7 + ny * 3.5).toFixed(1) +
      " L " + (ax - ux * 7 - nx * 3.5).toFixed(1) + " " + (ay - uy * 7 - ny * 3.5).toFixed(1) + ' Z" />');
  }
  /* the self-feedback loop on OP 6 (index 5) — fm.fb rides it, so it is drawn for every algo */
  const p5 = avFmNodePos(5);
  const fsx = p5.x + AV_FM_SVG_R * 0.55, fsy = p5.y - AV_FM_SVG_R * 0.75;
  const fex = p5.x + AV_FM_SVG_R * 0.55, fey = p5.y + AV_FM_SVG_R * 0.75;
  const fcx = p5.x + AV_FM_SVG_R * 1.9, fcy = p5.y;
  pieces.push('<path class="av-fm-fbpath" d="M ' + fsx.toFixed(1) + " " + fsy.toFixed(1) + " Q " + fcx.toFixed(1) + " " + fcy.toFixed(1) + " " + fex.toFixed(1) + " " + fey.toFixed(1) + '" />');
  pieces.push('<text class="av-fm-fb-lbl" x="' + (fcx + 3).toFixed(1) + '" y="' + (fcy + 3).toFixed(1) + '">fb</text>');
  /* nodes over the edges */
  for (let i = 0; i < AV_FM_OPS; i++) {
    const p = avFmNodePos(i);
    const car = carriers.indexOf(i) >= 0;
    pieces.push('<circle class="av-fm-node' + (car ? " av-fm-car" : "") + '" cx="' + p.x + '" cy="' + p.y + '" r="' + AV_FM_SVG_R + '" />');
    pieces.push('<text class="av-fm-node-lbl" x="' + p.x + '" y="' + (p.y + 4) + '">' + (i + 1) + "</text>");
  }
  pieces.push("</svg>");
  return pieces.join("");
}

/* the status line text — pure function of (algo, op, algoInfo) */
function avFmStatusText(algo, op, info) {
  const a = avFmAlgoNorm(algo), o = avFmOpNorm(op);
  let s = "ALGO " + a;
  if (info && typeof info === "object") {
    if (typeof info.name === "string" && info.name) s += " · " + info.name;
    if (Array.isArray(info.carriers)) {
      const cars = [];
      for (let i = 0; i < info.carriers.length; i++) {
        const c = Math.round(Number(info.carriers[i]));
        if (isFinite(c) && c >= 0 && c < AV_FM_OPS && cars.indexOf(c + 1) < 0) cars.push(c + 1);
      }
      if (cars.length) s += " · carriers " + cars.join("+");
    }
  } else {
    s += " · engine module not loaded";
  }
  s += " · active OP " + o + "/" + AV_FM_OPS + " · self-fb on OP 6";
  return s;
}

/* ---------- markup (pure string builders; avKnobHTML/avKnobRowHTML arrive from av_knob.js) ---------- */

function avFmKnobSpecHTML(k) {
  return avKnobHTML(k.path, k.label, Object.assign({ value: avParams[k.path] }, k.opts));
}

function avFmKnobRow(cls, knobs) {
  return avKnobRowHTML(knobs.map(avFmKnobSpecHTML), cls);
}

/* one tab button per operator */
function avFmTabHTML(op, active) {
  return '<button type="button" class="av-btn mini av-fm-op-tab' + (active ? " av-fm-op-on" : "") +
    '" role="tab" data-op="' + op + '" aria-selected="' + (active ? "true" : "false") +
    '" aria-label="Operator ' + op + '" title="Operator ' + op + '">OP ' + op + "</button>";
}

function avFmTabsHTML(activeOp) {
  let out = "";
  for (let op = 1; op <= AV_FM_OPS; op++) out += avFmTabHTML(op, op === activeOp);
  return '<div class="av-fm-tabs" role="tablist" aria-label="FM operators">' + out + "</div>";
}

/* one panel per operator; inactive panels ship hidden with an inline display:none (the av_synth
   panel idiom); ALL bodies render so every fm.opN.* knob carries its data-def for the share diff */
function avFmPanelHTML(op, active) {
  const o = avFmOpNorm(op);
  return '<div class="av-fm-op-panel' + (active ? " av-fm-op-on" : "") + '" data-op-panel="' + o + '"' +
    (active ? "" : ' hidden style="display:none"') + ' role="tabpanel" aria-label="Operator ' + o + '">' +
    '<div class="av-fm-op-head"><span class="av-fm-op-num">OP ' + o + "</span>" +
    '<span class="av-fm-op-cap">ratio · detune · level · velocity — attack · decay · sustain · release</span></div>' +
    '<div class="av-fm-op-body">' + avFmPanelBodyHTML(o) + "</div></div>";
}

/* the active op's body: the eight fm.opN.* knobs, two rows of four (voice · envelope) */
function avFmPanelBodyHTML(op) {
  const o = avFmOpNorm(op);
  if (typeof avKnobHTML !== "function" || typeof avKnobRowHTML !== "function") {
    return '<p class="av-note av-dim">knob parts not loaded — av_knob.js must ship before this card.</p>';
  }
  const spec = avFmOpKnobs(o);
  return avFmKnobRow("av-fm-op-main", spec.slice(0, 4)) + avFmKnobRow("av-fm-op-env", spec.slice(4));
}

/* the algorithm pick: the standard select.av-select with data-param="fm.algo" */
function avFmAlgoSelectHTML() {
  const cur = avFmAlgoNorm(avParams["fm.algo"]);
  let opts = "";
  for (let i = 0; i < AV_FM_ALGO_COUNT; i++) {
    opts += '<option value="' + i + '"' + (i === cur ? " selected" : "") + ">ALGO " + i + "</option>";
  }
  return '<label class="av-fm-pick"><span class="av-fm-pick-lbl">ALGO</span>' +
    '<select class="av-select av-fm-select" id="av-fm-algo" data-param="fm.algo" aria-label="FM algorithm (0-7)">' +
    opts + "</select></label>";
}

function avFmAlgoViewHTML() {
  const algo = avFmAlgoNorm(avParams["fm.algo"]);
  return '<div class="av-fm-algo-view" id="av-fm-algo-view">' + avFmAlgoSVG(algo, avFmAlgoInfoSafe(algo)) + "</div>";
}

function avFmGlobalsHTML() {
  if (typeof avKnobHTML !== "function" || typeof avKnobRowHTML !== "function") return "";
  return avFmKnobRow("av-fm-globals", AV_FM_GLOBALS);
}

/* the whole card body */
function avFmBodyHTML() {
  const op = avFmOpNorm(avFmState.op);
  const algo = avFmAlgoNorm(avParams["fm.algo"]);
  let panels = "";
  for (let i = 1; i <= AV_FM_OPS; i++) panels += avFmPanelHTML(i, i === op);
  return '<div class="av-fm" data-av-fm="1">' +
    '<div class="av-fm-head"><span class="av-fm-title">FM ENGINE</span>' +
    '<span class="av-fm-cap">6 operators · 8 algorithms · self-feedback on OP 6 · set ENGINE to fm in the SYNTH card · the routing view redraws from AVFM.algoInfo</span></div>' +
    '<div class="av-fm-top">' + avFmAlgoSelectHTML() + avFmAlgoViewHTML() + avFmGlobalsHTML() + "</div>" +
    '<div class="av-fm-ops">' + avFmTabsHTML(op) + '<div class="av-fm-panels">' + panels + "</div></div>" +
    '<div class="av-fm-status" id="av-fm-status" role="status">' + avFmEsc(avFmStatusText(algo, op, avFmAlgoInfoSafe(algo))) + "</div>" +
    "</div>";
}

/* ---------- guarded DOM accessors ---------- */

function avFmHostEl() {
  try {
    if (typeof document === "undefined" || !document || typeof document.getElementById !== "function") return null;
    return document.getElementById("av-fm-host") || null;
  } catch (e) { return null; }
}

function avFmRootFrom(root) {
  if (root && typeof root.querySelectorAll === "function") return root;
  return avFmHostEl();
}

/* ---------- commits (select; knobs commit through avKnobCommit themselves) ---------- */

/* the shared commit path — mirror first, then the app-side hook; the av-param CustomEvent
   fallback (same shape as av_fx.js / av_synth.js) keeps the card alive without app_core */
function avFmCommit(path, v, el, from) {
  avParams[path] = v;
  if (typeof avApplyParam === "function") {
    try { avApplyParam(path, v, { from: from || "fm", el: el }); }
    catch (e) { try { console.warn("[anvil] avApplyParam(" + path + ") failed", e); } catch (e2) { /* no console */ } }
  } else {
    try {
      if (typeof window !== "undefined" && window && typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new CustomEvent("av-param", { detail: { path: path, value: v, el: el, from: from || "fm" } }));
      }
    } catch (e) { /* no fan-out */ }
  }
  avFmSyncControl(path);
  return v;
}

/* mirror avParams["fm.algo"] into the algorithm select(s): value AND the option `selected`
   marker, so markup-level reads agree with the property after commits and external writes */
function avFmSyncSelect(root) {
  if (!root || typeof root.querySelectorAll !== "function" || typeof avParams === "undefined" || !avParams) return false;
  let hit = false;
  root.querySelectorAll("select.av-fm-select[data-param]").forEach(sel => {
    hit = true;
    const v = String(avFmAlgoNorm(avParams["fm.algo"]));
    try { if (sel.value !== v) sel.value = v; } catch (e) { /* value assign refused */ }
    try {
      sel.querySelectorAll("option").forEach(opt => {
        const on = opt.getAttribute("value") === v;
        if (on) { if (opt.getAttribute("selected") == null) opt.setAttribute("selected", "selected"); }
        else if (opt.getAttribute("selected") != null) opt.removeAttribute("selected");
      });
    } catch (e2) { /* option sweep is best-effort */ }
  });
  return hit;
}

/* repaint ONE control from the mirror after a commit */
function avFmSyncControl(path) {
  const host = avFmHostEl();
  if (!host || typeof host.querySelector !== "function" || typeof avParams === "undefined" || !avParams) return false;
  if (path === "fm.algo") {
    avFmSyncSelect(host);
    const view = host.querySelector("#av-fm-algo-view");
    if (view) { const algo = avFmAlgoNorm(avParams["fm.algo"]); view.innerHTML = avFmAlgoSVG(algo, avFmAlgoInfoSafe(algo)); }
    avFmRefreshStatus(host);
    return true;
  }
  const knob = host.querySelector('.av-knob[data-knob="' + avFmCssEsc(path) + '"]');
  if (knob && typeof avParams[path] === "number" && typeof avKnobApplyVisual === "function") avKnobApplyVisual(knob, avParams[path]);
  if (knob && typeof avKnobFormat === "function" && typeof avParams[path] === "number") {
    const txt = avKnobFormat(avParams[path], { fmt: knob.getAttribute("data-fmt") || "", unit: knob.getAttribute("data-unit") || "" });
    host.querySelectorAll('[data-kval="' + avFmCssEsc(path) + '"]').forEach(n => { n.textContent = txt; });
  }
  avFmRefreshStatus(host);
  return true;
}

/* ---------- paint (tabs · panels · status) ---------- */

/* tabs + panel visibility + the ACTIVE op's eight knobs; inactive panels go empty, so the DOM
   always holds exactly the active op's knobs (8) plus the two globals */
function avFmPaintOps(root) {
  if (!root || typeof root.querySelectorAll !== "function") return false;
  const op = avFmOpNorm(avFmState.op);
  const canKnobs = (typeof avKnobHTML === "function" && typeof avKnobRowHTML === "function");
  root.querySelectorAll(".av-fm-op-tab").forEach(btn => {
    const on = avFmOpNorm(btn.getAttribute("data-op")) === op;
    btn.classList.toggle("av-fm-op-on", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  root.querySelectorAll(".av-fm-op-panel[data-op-panel]").forEach(panel => {
    const on = avFmOpNorm(panel.getAttribute("data-op-panel")) === op;
    panel.classList.toggle("av-fm-op-on", on);
    panel.hidden = !on;
    if (panel.style) panel.style.display = on ? "" : "none";
    const body = (typeof panel.querySelector === "function") ? panel.querySelector(".av-fm-op-body") : null;
    if (!body) return;
    const have = (typeof body.querySelectorAll === "function") ? body.querySelectorAll(".av-knob[data-knob]").length : 0;
    const pop = avFmOpNorm(panel.getAttribute("data-op-panel"));
    if (canKnobs && have !== 8) body.innerHTML = avFmPanelBodyHTML(pop);
  });
  return true;
}

function avFmRefreshStatus(root) {
  if (!root || typeof root.querySelector !== "function" || typeof avParams === "undefined" || !avParams) return false;
  const el = root.querySelector("#av-fm-status");
  if (!el) return false;
  const algo = avFmAlgoNorm(avParams["fm.algo"]);
  const txt = avFmStatusText(algo, avFmState.op, avFmAlgoInfoSafe(algo));
  if (el.textContent !== txt) el.textContent = txt;
  return true;
}

/* ---------- wiring ---------- */

/* ONE delegated click listener on the host for every op tab */
function avFmWire(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  if (host.dataset && host.dataset.avFmWired === "1") return false;
  try { if (host.dataset) host.dataset.avFmWired = "1"; } catch (e) { /* dataset-less host */ }
  host.addEventListener("click", (e) => {
    try {
      const t = e && e.target;
      if (!t || typeof t.closest !== "function") return;
      const tab = t.closest(".av-fm-op-tab");
      if (!tab) return;
      const op = avFmOpNorm(tab.getAttribute("data-op"));
      if (op === avFmState.op) return;
      avFmSetOp(op);
    } catch (err) { /* the card never throws outward */ }
  });
  return true;
}

/* direct change listeners on the algorithm pick (fresh elements on every mount -> re-bound) */
function avFmBindSelects(root) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll("select.av-fm-select[data-param]").forEach(sel => {
    sel.addEventListener("change", () => {
      try {
        const path = sel.getAttribute("data-param");
        const v = (path === "fm.algo") ? avFmAlgoNorm(sel.value) : sel.value;
        avFmCommit(path, v, sel, "select");
      } catch (e) { /* no fan-out */ }
    });
  });
}

/* per-control bound markers (knobs carry avKnobBind's data-knob-bound) */
function avFmMark(root) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll("select.av-fm-select[data-param]").forEach(sel => { sel.dataset.fmBound = "1"; });
}

/* ---------- init (mount) ---------- */

/* mount into the parent-owned host: seed unset mirror paths, render, bind, repaint. Host absent
   or knob parts missing -> false, no throw. Re-mountable: a second call rebuilds the markup
   from the live mirror (and keeps the active op). */
function avFmUiInit() {
  const host = avFmHostEl();
  if (!host) return false;
  if (typeof avKnobHTML !== "function" || typeof avKnobRowHTML !== "function" || typeof avKnobBind !== "function") return false;
  if (typeof avParams === "undefined" || !avParams || typeof avParams !== "object") return false;
  try {
    const defs = avFmDefaults();
    for (const p in defs) { if (!(p in avParams)) avParams[p] = defs[p]; }
    /* repair an invalid stored algo before first paint (never a throw, never a surprise) */
    avParams["fm.algo"] = avFmAlgoNorm(avParams["fm.algo"]);
    avFmState.op = avFmOpNorm(avFmState.op);
    host.innerHTML = avFmBodyHTML();
    avFmWire(host);
    avFmBindSelects(host);
    avKnobBind(host);
    avFmMark(host);
    avFmUiSync(host);
    avFmState.inited = true;
    avFmState.mounts += 1;
    return true;
  } catch (e) {
    try { console.warn("[anvil] fm card mount failed", e); } catch (e2) { /* no console */ }
    return false;
  }
}

/* ---------- operator switch (tabs; also the harness seam) ---------- */

function avFmSetOp(op) {
  const n = Number(op);
  if (!isFinite(n)) return false;
  avFmState.op = Math.max(1, Math.min(AV_FM_OPS, Math.round(n)));
  const host = avFmRootFrom(null);
  if (!host) return true;   /* state updated; nothing to paint (headless / pre-mount) */
  try {
    avFmPaintOps(host);
    if (typeof avKnobBind === "function") avKnobBind(host);
    avFmRefreshStatus(host);
    return true;
  } catch (e) { return false; }
}

/* ---------- sync (repaint from avParams) ---------- */

/* repaint every fm.* control from the mirror: op tabs/panels (the active op's eight knobs,
   rebuilt if missing), knob visuals + readouts, the algorithm select, the algorithm view and
   the status line. Called by init and by the parent after external writes (CC, patch load). */
function avFmUiSync(root) {
  const host = avFmRootFrom(root);
  if (!host) return false;
  try {
    if (typeof host.querySelector !== "function" || !host.querySelector(".av-fm")) return false;
    avFmPaintOps(host);
    if (typeof avKnobBind === "function") avKnobBind(host);
    host.querySelectorAll(".av-knob[data-knob]").forEach(el => {
      const path = el.getAttribute("data-knob");
      const v = avParams[path];
      if (typeof v !== "number") return;
      if (typeof avKnobApplyVisual === "function") avKnobApplyVisual(el, v);
      if (typeof avKnobFormat === "function") {
        const txt = avKnobFormat(v, { fmt: el.getAttribute("data-fmt") || "", unit: el.getAttribute("data-unit") || "" });
        host.querySelectorAll('[data-kval="' + avFmCssEsc(path) + '"]').forEach(n => { n.textContent = txt; });
      }
    });
    avFmSyncSelect(host);
    const view = host.querySelector("#av-fm-algo-view");
    if (view) {
      const algo = avFmAlgoNorm(avParams["fm.algo"]);
      view.innerHTML = avFmAlgoSVG(algo, avFmAlgoInfoSafe(algo));
    }
    avFmRefreshStatus(host);
    return true;
  } catch (e) { return false; }
}

/* ---------- snapshot ---------- */

function avFmUiSnap() {
  const host = avFmHostEl();
  const paths = avFmPaths();
  const snap = {
    version: AV_FM_VERSION,
    inited: !!avFmState.inited,
    mounts: avFmState.mounts,
    host: !!host,
    wired: false,
    card: false,
    activeOp: avFmOpNorm(avFmState.op),
    algo: 0,
    algoInfoLoaded: false,
    tabs: 0,
    panels: 0,
    status: "",
    controls: { knobs: 0, boundKnobs: 0, opKnobs: 0, globals: 0, selects: 0, selectsBound: 0 },
    expect: { ops: AV_FM_OPS, tabs: AV_FM_OPS, panels: AV_FM_OPS, opKnobs: AV_FM_OPS * 8, globals: AV_FM_GLOBALS.length, knobs: AV_FM_OPS * 8 + AV_FM_GLOBALS.length, selects: 1, algoOptions: AV_FM_ALGO_COUNT },
    paths: paths,
    params: {},
    classes: avFmUiClasses(),
  };
  try {
    snap.algo = avFmAlgoNorm((typeof avParams !== "undefined" && avParams) ? avParams["fm.algo"] : 0);
    snap.algoInfoLoaded = !!avFmAlgoInfoSafe(snap.algo);
    if (host && typeof host.querySelectorAll === "function") {
      if (host.dataset) snap.wired = host.dataset.avFmWired === "1";
      snap.card = (typeof host.querySelector === "function") ? !!host.querySelector(".av-fm") : false;
      snap.tabs = host.querySelectorAll(".av-fm-op-tab").length;
      snap.panels = host.querySelectorAll(".av-fm-op-panel[data-op-panel]").length;
      const knobs = Array.prototype.slice.call(host.querySelectorAll(".av-knob[data-knob]"));
      const sels = Array.prototype.slice.call(host.querySelectorAll("select.av-fm-select[data-param]"));
      snap.controls.knobs = knobs.length;
      snap.controls.boundKnobs = knobs.filter(k => k.dataset && k.dataset.knobBound === "1").length;
      snap.controls.opKnobs = knobs.filter(k => /^fm\.op[1-6]\./.test(k.getAttribute("data-knob") || "")).length;
      snap.controls.globals = knobs.filter(k => { const p = k.getAttribute("data-knob"); return p === "fm.fb" || p === "fm.volume"; }).length;
      snap.controls.selects = sels.length;
      snap.controls.selectsBound = sels.filter(s => s.dataset && s.dataset.fmBound === "1").length;
      if (typeof host.querySelector === "function") {
        const st = host.querySelector("#av-fm-status");
        if (st && typeof st.textContent === "string") snap.status = st.textContent;
      }
    }
    if (typeof avParams !== "undefined" && avParams) {
      paths.forEach(p => { if (Object.prototype.hasOwnProperty.call(avParams, p)) snap.params[p] = avParams[p]; });
    }
  } catch (e) { /* snap never throws — zeroed fields are the honest read */ }
  return snap;
}

/* ---------- classes + debug handle ---------- */

function avFmUiClasses() {
  return ["av-fm", "av-fm-head", "av-fm-title", "av-fm-cap", "av-fm-top",
    "av-fm-pick", "av-fm-pick-lbl", "av-fm-select",
    "av-fm-algo-view", "av-fm-svg", "av-fm-view-lbl",
    "av-fm-edge", "av-fm-arrow", "av-fm-fbpath", "av-fm-fb-lbl",
    "av-fm-node", "av-fm-car", "av-fm-node-lbl",
    "av-fm-globals", "av-fm-ops", "av-fm-tabs", "av-fm-op-tab", "av-fm-op-on",
    "av-fm-panels", "av-fm-op-panel", "av-fm-op-head", "av-fm-op-num", "av-fm-op-cap",
    "av-fm-op-body", "av-fm-op-main", "av-fm-op-env", "av-fm-status"];
}

if (typeof window !== "undefined") {
  window.__avFmUi = {
    version: AV_FM_VERSION,
    init: () => avFmUiInit(),
    snap: () => avFmUiSnap(),
    classes: () => avFmUiClasses(),
    sync: (root) => avFmUiSync(root),
  };
}
