/* Anvil — MOD MATRIX card (P3 §4, child E): the matrix model (8 macros + up to 32 slots), the
   card mounted into the parent-owned host #av-mod-host, the patch-v2 serialisation and the wire
   encoder that carries the live state into the engine worklet.

   Wire format (PIN — mirrored by the parent's facade + processor; do not reorder):
     avEngineMod({ macros: Float64Array(8), slots: Float64Array(32 * 4) })
     - macros[i]        = macro (i+1) value, clamped 0..1
     - slots index k    = [srcIdx, dstIdx, amt, curve] at k*4 .. k*4+3
         srcIdx  env1=0 env2=1 lfo1=2 vel=3 key=4 rand=5 macro1=6 macro2=7 macro3=8
                 macro4=9 macro5=10 macro6=11 macro7=12 macro8=13   (14 pinned sources; the
                 §4 text says "(17)" but the literal list is 14 — v1 pins the literal list)
         dstIdx  cutoff=0 reso=1 pitch=2 osc1.level=3 osc2.level=4 pan=5
         amt     -1..1 · curve 0 linear | 1 exp | 2 S
     - slots past the row count stay all-zero = inactive. Sent on EVERY model change and once
       after the engine boot settles (the replay path — avEngineEnsure().then).

   Serialisation (patch v2 shape, §4): { macros: [{name, value} x8], slots: [{src, dst, amt,
   curve} x0..32] } — avModSnap() returns a fresh deep copy; avModLoad(snap) is the sanitising
   load (unknown source/target slots dropped, numbers clamped, >32 truncated).

   Laws honoured here: page module — NO DOM at top level, every DOM/global reach is guarded and
   inside a function; ONE namespace (avMod* / AV_MOD_*); never throws (avModInit -> false when
   the host or the knob parts are missing). Macro knobs ride the standard avKnob feel; their
   commits arrive through the app funnel avApplyParam (avKnobCommit law) and this module installs
   ONE additive, idempotent wrapper that taps `mod.*` paths into the model + encoder while every
   other path passes through untouched. Fallback when no app hook exists: the 'av-param' window
   event avKnobCommit dispatches itself (same funnel, no app core needed).

   Public surface (classic-script globals, ONE namespace):
     avModInit() -> bool          mount the card (false without host/knob parts, never throws)
     avModSnap() -> snapshot      fresh deep copy, patch-v2 shape
     avModPayload() -> {macros, slots}   the EXACT Float64Arrays the encoder posts
     avModClasses() -> string[]   CSS classes this card introduces (parent styles them)
     avModPost() -> bool          build + avEngineMod() if the facade has it
     avModLoad(snap) -> bool      sanitising load / round-trip partner of avModSnap
     avModSlotAdd/Remove/Set, avModMacroSet, avModParamHit, avModReplayWhenReady,
     avModEnsureHooks, avModSrcIndex, avModDstIndex, avModSourceNames, avModTargetNames,
     avModDefaults, AV_MOD_VERSION, AV_MOD_SOURCES, AV_MOD_TARGETS, AV_MOD_CURVES.
     R8: avModAssign(src, knobPath) -> bool (the drop-map assign law), avModDropMap(),
     avModDragBegin/DragEnd, avModSyncRings, avModStatus(msg). */

"use strict";

const AV_MOD_VERSION = "p3.0";

/* ---------- pinned enums (§4, wire order = index) ---------- */

/* sources: env1=0 env2=1 lfo1=2 vel=3 key=4 rand=5 macro1=6 .. macro8=13 (14 entries) */
const AV_MOD_SOURCES = [
  "env1", "env2", "lfo1", "vel", "key", "rand",
  "macro1", "macro2", "macro3", "macro4", "macro5", "macro6", "macro7", "macro8",
];

/* targets: cutoff=0 reso=1 pitch=2 osc1.level=3 osc2.level=4 pan=5 (pan = engine-level) */
const AV_MOD_TARGETS = ["cutoff", "reso", "pitch", "osc1.level", "osc2.level", "pan"];

/* curves: 0 linear · 1 exp · 2 S (array index = wire value) */
const AV_MOD_CURVES = ["linear", "exp", "S"];

const AV_MOD_MACRO_COUNT = 8;        /* §4: 8 macros                      */
const AV_MOD_MAX_SLOTS = 32;         /* §4: up to 32 matrix slots         */
const AV_MOD_SLOT_STRIDE = 4;        /* [srcIdx, dstIdx, amt, curve]      */
const AV_MOD_MACRO_PREFIX = "mod.macro";   /* knob path: mod.macro1 .. mod.macro8 */

/* R8 — drag-to-modulate: the knob paths whose drops reach a pinned engine target (v1). A drop
   anywhere else in the DOM is refused honestly (no engine drain exists for it). */
const AV_MOD_DROP_MAP = {
  "filter.cutoff": "cutoff",
  "filter.reso": "reso",
  "osc1.level": "osc1.level",
  "osc2.level": "osc2.level",
};

/* chip + ring colour per source family (CSS vars resolve page-side) */
const AV_MOD_SRC_COLORS = {
  env1: "var(--mod-green)", env2: "var(--mod-green)", lfo1: "var(--mod-purple)",
  vel: "var(--mod-yellow)", key: "var(--mod-sky)", rand: "#9AA7B0",
  macro1: "var(--mod-orange)", macro2: "var(--mod-orange)", macro3: "var(--mod-orange)", macro4: "var(--mod-orange)",
  macro5: "var(--mod-orange)", macro6: "var(--mod-orange)", macro7: "var(--mod-orange)", macro8: "var(--mod-orange)",
};

/* ---------- the model (single source of truth) ---------- */

let avModState = null;               /* { macros: [{name, value}] x8, slots: [{src, dst, amt, curve}] } */

function avModDefaults() {
  const macros = [];
  for (let i = 0; i < AV_MOD_MACRO_COUNT; i++) macros.push({ name: "MACRO " + (i + 1), value: 0 });
  return { macros: macros, slots: [] };
}

function avModModelEnsure() {
  if (avModState) return avModState;
  avModState = avModDefaults();
  return avModState;
}

/* ---------- small value laws ---------- */

function avModClamp01(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
function avModClampAmt(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}
function avModCurveOf(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(AV_MOD_CURVES.length - 1, Math.round(n)));
}
function avModNameNorm(name, i) {
  let s = (typeof name === "string") ? name : "";
  s = s.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24);
  return s || (i >= 0 ? "MACRO " + (i + 1) : "MACRO");
}

/* ---------- enum index pins (wire) ---------- */

function avModSrcIndex(name) { return AV_MOD_SOURCES.indexOf(String(name == null ? "" : name)); }
function avModDstIndex(name) { return AV_MOD_TARGETS.indexOf(String(name == null ? "" : name)); }
const avModSourceNames = () => AV_MOD_SOURCES.slice();
const avModTargetNames = () => AV_MOD_TARGETS.slice();

/* one slot from arbitrary input: valid src+dst required, numbers clamped; null = refuse */
function avModSlotNorm(entry) {
  if (!entry || typeof entry !== "object") return null;
  const src = String(entry.src == null ? "" : entry.src);
  const dst = String(entry.dst == null ? "" : entry.dst);
  if (avModSrcIndex(src) < 0 || avModDstIndex(dst) < 0) return null;
  return { src: src, dst: dst, amt: avModClampAmt(entry.amt), curve: avModCurveOf(entry.curve) };
}

/* ---------- serialisation (patch v2 shape) + wire encoder ---------- */

function avModSnap() {
  const st = avModModelEnsure();
  const macros = [];
  for (let i = 0; i < st.macros.length; i++) macros.push({ name: st.macros[i].name, value: st.macros[i].value });
  const slots = [];
  for (let i = 0; i < st.slots.length; i++) {
    const s = st.slots[i];
    slots.push({ src: s.src, dst: s.dst, amt: s.amt, curve: s.curve });
  }
  return { macros: macros, slots: slots };
}

/* the exact arrays the encoder hands to avEngineMod — fresh every call, pinned layout above */
function avModPayload() {
  const st = avModModelEnsure();
  const macros = new Float64Array(AV_MOD_MACRO_COUNT);
  for (let i = 0; i < AV_MOD_MACRO_COUNT; i++) macros[i] = avModClamp01(st.macros[i].value);
  const slots = new Float64Array(AV_MOD_MAX_SLOTS * AV_MOD_SLOT_STRIDE);
  const n = Math.min(AV_MOD_MAX_SLOTS, st.slots.length);
  for (let i = 0; i < n; i++) {
    const s = st.slots[i];
    const si = avModSrcIndex(s.src), di = avModDstIndex(s.dst);
    if (si < 0 || di < 0) continue;                 /* belt — the model only holds normed slots */
    const o = i * AV_MOD_SLOT_STRIDE;
    slots[o] = si;
    slots[o + 1] = di;
    slots[o + 2] = avModClampAmt(s.amt);
    slots[o + 3] = avModCurveOf(s.curve);
  }
  return { macros: macros, slots: slots };
}

/* the facade entry, guarded three ways (global binding, window property, absent) */
function avModFacadeMod() {
  try { if (typeof avEngineMod === "function") return avEngineMod; } catch (e) { /* not injected */ }
  try { if (typeof window !== "undefined" && window && typeof window.avEngineMod === "function") return window.avEngineMod; } catch (e) { /* no window */ }
  return null;
}

/* build + send. false when the parent hook is absent or refuses; never throws. */
function avModPost() {
  avModSyncRings();
  const send = avModFacadeMod();
  if (!send) return false;
  const payload = avModPayload();
  try { return send(payload) !== false; } catch (e) { return false; }
}

/* boot replay: post once the engine is ready. No engine hook yet -> silent false (the parent's
   integration orders this after avEngineEnsure exists; if it lands later, call avModPost()). */
function avModReplayWhenReady() {
  if (!avModFacadeMod()) return false;
  try {
    if (typeof window !== "undefined" && window && window.__avEngine && window.__avEngine.ready) {
      avModPost();
      return true;
    }
  } catch (e) { /* no window */ }
  try {
    if (typeof avEngineEnsure === "function" && typeof Promise === "function") {
      /* deferred one microtask so app_core's own avEngineEnsure() call stays the singleton's
         first caller in the boot block; same promise either way */
      Promise.resolve().then(function () {
        try {
          avEngineEnsure().then(function (h) { if (h) avModPost(); }, function () { /* ensure never rejects — belt */ });
        } catch (e2) { /* boot refused */ }
      });
      return true;
    }
  } catch (e) { /* no ensure reachable */ }
  return false;
}

/* ---------- the commit funnel ----------
   avKnobCommit writes the avParams mirror, then calls avApplyParam(path, v, meta) when the app
   defines it (else it dispatches the 'av-param' event). This card taps BOTH: one additive wrap
   scoped to `mod.*` paths (idempotent, every other path passes through untouched) and the event
   fallback. Installed once by avModEnsureHooks() — called from avModInit. */

let avModHooks = null;               /* { installed, wrapped, eventBound } */

/* path -> macro index: exactly mod.macro1 .. mod.macro8, else -1 */
function avModMacroIndexFromPath(path) {
  if (typeof path !== "string") return -1;
  const m = /^mod\.macro([1-8])$/.exec(path);
  return m ? Number(m[1]) - 1 : -1;
}

/* a commit landed on a mod.* path: sync the model, repost. Non-macro paths ignored. */
function avModParamHit(path, value) {
  const i = avModMacroIndexFromPath(path);
  if (i < 0) return false;
  const st = avModModelEnsure();
  const v = avModClamp01(value);
  st.macros[i].value = v;
  try { if (typeof avParams !== "undefined" && avParams && typeof path === "string") avParams[path] = v; } catch (e) { /* no mirror */ }
  avModPost();
  avModSyncOutsFor("macro" + (i + 1));
  return true;
}

function avModParamEvent(ev) {
  const d = ev && ev.detail;
  if (!d) return;
  avModParamHit(d.path, d.value);
}

function avModEnsureHooks() {
  if (!avModHooks) avModHooks = { installed: false, wrapped: false, eventBound: false };
  if (avModHooks.installed) return true;
  /* belt 1 — the event funnel avKnobCommit uses when no app hook exists (dormant otherwise) */
  try {
    if (typeof window !== "undefined" && window && typeof window.addEventListener === "function") {
      window.addEventListener("av-param", avModParamEvent);
      avModHooks.eventBound = true;
    }
  } catch (e) { /* no window — stays unbound */ }
  /* belt 2 — the app funnel itself: one wrap, scoped, idempotent */
  try {
    if (typeof avApplyParam === "function" && avApplyParam.__avModWrap !== true) {
      const orig = avApplyParam;
      const wrapped = function (path, v, meta) {
        try { if (typeof path === "string" && path.indexOf("mod.") === 0) avModParamHit(path, v); }
        catch (e) { /* never break the funnel */ }
        return orig(path, v, meta);
      };
      wrapped.__avModWrap = true;
      avApplyParam = wrapped;
      avModHooks.wrapped = true;
    }
  } catch (e) { /* funnel unreachable — the event belt still works */ }
  if (avModHooks.wrapped || avModHooks.eventBound) avModHooks.installed = true;
  return avModHooks.installed;
}

/* ---------- model mutators (each reposts; structural ones re-render) ---------- */

function avModSlotAdd(src, dst, amt, curve) {
  const st = avModModelEnsure();
  if (st.slots.length >= AV_MOD_MAX_SLOTS) return false;
  const s = avModSlotNorm({
    src: src == null ? "env1" : src,
    dst: dst == null ? "cutoff" : dst,
    amt: amt == null ? 0.5 : amt,
    curve: curve == null ? 0 : curve,
  });
  if (!s) return false;
  st.slots.push(s);
  avModRenderSlots();
  avModPost();
  return true;
}

function avModSlotRemove(i) {
  const st = avModModelEnsure();
  const k = Math.floor(Number(i));
  if (!isFinite(k) || k < 0 || k >= st.slots.length) return false;
  st.slots.splice(k, 1);
  avModRenderSlots();
  avModPost();
  return true;
}

function avModSlotSet(i, patch) {
  const st = avModModelEnsure();
  const k = Math.floor(Number(i));
  if (!isFinite(k) || k < 0 || k >= st.slots.length) return false;
  const s = st.slots[k];
  let touched = false;
  if (patch && typeof patch === "object") {
    if (typeof patch.src === "string" && avModSrcIndex(patch.src) >= 0 && patch.src !== s.src) { s.src = patch.src; touched = true; }
    if (typeof patch.dst === "string" && avModDstIndex(patch.dst) >= 0 && patch.dst !== s.dst) { s.dst = patch.dst; touched = true; }
    if (patch.amt !== undefined) { const a = avModClampAmt(patch.amt); if (a !== s.amt) { s.amt = a; touched = true; } }
    if (patch.curve !== undefined) { const c = avModCurveOf(patch.curve); if (c !== s.curve) { s.curve = c; touched = true; } }
  }
  if (!touched) return true;
  avModSyncAmtText(k);
  avModPost();
  return true;
}

/* ---------- R8 drag-to-modulate (chips -> knobs; the drop map is the v1 engine surface) ----------

   A chip drag begins on .av-mod-chip (delegated at the document, so floats and re-renders are
   covered); every knob whose data-knob maps through AV_MOD_DROP_MAP shows the target halo, a
   droppable hover marks the drop point, and the drop writes ONE slot per (src, dst) pair with the
   default depth (+0.5, linear). Un-mapped knobs are refused honestly (status line). avModSyncRings
   paints the mod ring on mapped knobs (first slot's source colour, |amt| span) and rides
   avModPost, so every model change repaints it. */

let avModDragSrc = null;      /* source name being dragged; null when idle */
let avModDropHover = null;    /* the knob currently marked droppable */

function avModDragActive() { return avModDragSrc != null; }

function avModDropMap() {
  const o = {};
  const ks = Object.keys(AV_MOD_DROP_MAP);
  for (let i = 0; i < ks.length; i++) o[ks[i]] = AV_MOD_DROP_MAP[ks[i]];
  return o;
}

function avModMappableKnobs() {
  try {
    if (typeof document === "undefined" || !document || typeof document.querySelectorAll !== "function") return [];
    const out = [];
    const paths = Object.keys(AV_MOD_DROP_MAP);
    for (let i = 0; i < paths.length; i++) {
      const els = document.querySelectorAll('.av-knob[data-knob="' + paths[i] + '"]');
      for (let j = 0; j < els.length; j++) out.push(els[j]);
    }
    return out;
  } catch (e) { return []; }
}

function avModDragBegin(src) {
  try {
    if (avModSrcIndex(src) < 0) return false;
    avModDragSrc = String(src);
    if (typeof document !== "undefined" && document && document.body && document.body.classList) {
      document.body.classList.add("av-drag-modsrc");
    }
    const knobs = avModMappableKnobs();
    for (let i = 0; i < knobs.length; i++) knobs[i].classList.add("av-mod-target");
    return true;
  } catch (e) { return false; }
}

function avModDragEnd() {
  try {
    avModDragSrc = null;
    avModDropHover = null;
    if (typeof document !== "undefined" && document && document.body && document.body.classList) {
      document.body.classList.remove("av-drag-modsrc");
    }
    if (typeof document !== "undefined" && document && typeof document.querySelectorAll === "function") {
      const marked = document.querySelectorAll(".av-mod-target, .av-mod-droppable");
      for (let i = 0; i < marked.length; i++) {
        marked[i].classList.remove("av-mod-target");
        marked[i].classList.remove("av-mod-droppable");
      }
    }
    return true;
  } catch (e) { return false; }
}

/* the assignment law: ONE slot per (src, dst); a re-drop re-defaults the depth */
function avModAssign(src, path) {
  try {
    const dst = AV_MOD_DROP_MAP[String(path == null ? "" : path)];
    if (!dst || avModSrcIndex(src) < 0) return false;
    const st = avModModelEnsure();
    let k = -1;
    for (let i = 0; i < st.slots.length; i++) {
      if (st.slots[i].src === src && st.slots[i].dst === dst) { k = i; break; }
    }
    if (k >= 0) return avModSlotSet(k, { amt: 0.5 });
    const added = avModSlotAdd(src, dst, 0.5, 0);
    if (!added) avModStatus("matrix full \u2014 " + AV_MOD_MAX_SLOTS + " slots");
    return added;
  } catch (e) { return false; }
}

/* the mod ring on mapped knobs: first slot's source colour + |amt| span; extra count in data-mod */
function avModSyncRings() {
  try {
    if (typeof document === "undefined" || !document || typeof document.querySelectorAll !== "function") return false;
    const paths = Object.keys(AV_MOD_DROP_MAP);
    const st = avModModelEnsure();
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      const dst = AV_MOD_DROP_MAP[path];
      let first = null, count = 0;
      for (let k = 0; k < st.slots.length; k++) {
        if (st.slots[k].dst === dst) { if (!first) first = st.slots[k]; count++; }
      }
      const els = document.querySelectorAll('.av-knob[data-knob="' + path + '"]');
      for (let j = 0; j < els.length; j++) {
        const el = els[j];
        if (first) {
          const span = Math.max(0, Math.min(270, Math.abs(first.amt) * 270));
          el.classList.add("av-mod-shown");
          el.setAttribute("data-mod", first.src + ":" + avModAmtText(first.amt) + (count > 1 ? " +" + (count - 1) : ""));
          try {
            el.style.setProperty("--mod-span", span.toFixed(1) + "deg");
            el.style.setProperty("--mod-color", AV_MOD_SRC_COLORS[first.src] || "var(--teal)");
          } catch (e2) { /* style best-effort */ }
        } else if (el.classList.contains("av-mod-shown")) {
          el.classList.remove("av-mod-shown");
          el.removeAttribute("data-mod");
        }
      }
    }
    return true;
  } catch (e) { return false; }
}

function avModStatus(msg) {
  try {
    const el = (typeof document !== "undefined" && document && typeof document.getElementById === "function") ? document.getElementById("av-mod-status") : null;
    if (el) el.textContent = String(msg == null ? "" : msg);
    return !!el;
  } catch (e) { return false; }
}

/* the OUT column: macro sources read the page model; per-voice sources have no page value */
function avModOutText(slot) {
  const m = /^macro([1-8])$/.exec(String(slot && slot.src));
  if (!m) return "\u2014";
  const st = avModModelEnsure();
  const i = Number(m[1]) - 1;
  return Math.round(avModClamp01(st.macros[i].value) * 100) + "%";
}

function avModSyncOutsFor(srcName) {
  try {
    const host = avModHost();
    if (!host || typeof host.querySelector !== "function") return false;
    const st = avModModelEnsure();
    for (let i = 0; i < st.slots.length; i++) {
      if (st.slots[i].src !== srcName) continue;
      const out = host.querySelector('[data-slot-out="' + i + '"]');
      if (out) out.textContent = avModOutText(st.slots[i]);
    }
    return true;
  } catch (e) { return false; }
}

/* ---------- the document-level drag plumbing (bound once) ---------- */

function avModDragKnobFrom(e) {
  try {
    const t = e && e.target;
    const knob = (t && typeof t.closest === "function") ? t.closest(".av-knob[data-knob]") : null;
    if (!knob) return null;
    return AV_MOD_DROP_MAP[knob.getAttribute("data-knob")] ? knob : null;
  } catch (e2) { return null; }
}

function avModDragStartEvent(e) {
  try {
    const t = e && e.target;
    const chip = (t && typeof t.closest === "function") ? t.closest(".av-mod-chip") : null;
    if (!chip) return;
    const src = chip.getAttribute("data-src");
    if (avModSrcIndex(src) < 0) return;
    if (e.dataTransfer) {
      try { e.dataTransfer.setData("text/av-modsrc", src); e.dataTransfer.effectAllowed = "copy"; } catch (e2) { /* dt best-effort */ }
    }
    avModDragBegin(src);
  } catch (e3) { /* drag start best-effort */ }
}

function avModDragOverEvent(e) {
  try {
    const dt = e && e.dataTransfer;
    const types = dt && dt.types ? dt.types : null;
    const hasType = types && Array.prototype.indexOf.call(types, "text/av-modsrc") >= 0;
    if (!avModDragActive() && !hasType) return;
    const knob = avModDragKnobFrom(e);
    if (avModDropHover && avModDropHover !== knob) avModDropHover.classList.remove("av-mod-droppable");
    avModDropHover = knob;
    if (knob) {
      knob.classList.add("av-mod-droppable");
      if (e.preventDefault) e.preventDefault();
      if (dt) { try { dt.dropEffect = "copy"; } catch (e2) { /* ok */ } }
    }
  } catch (e3) { /* hover best-effort */ }
}

function avModDropEvent(e) {
  try {
    const dt = e && e.dataTransfer;
    let src = avModDragSrc;
    if (!src && dt && typeof dt.getData === "function") {
      try { src = dt.getData("text/av-modsrc"); } catch (e2) { src = null; }
    }
    if (!src || avModSrcIndex(src) < 0) return;
    if (e.preventDefault) e.preventDefault();
    const knob = avModDragKnobFrom(e) || avModDropHover;
    if (knob) {
      const path = knob.getAttribute("data-knob");
      if (avModAssign(src, path)) avModStatus("assigned " + src + " \u2192 " + path);
    } else {
      const t = e && e.target;
      const anyKnob = (t && typeof t.closest === "function") ? t.closest(".av-knob[data-knob]") : null;
      avModStatus(anyKnob ? (anyKnob.getAttribute("data-knob") + " is not a v1 mod target") : "");
    }
    avModDragEnd();
  } catch (e3) { /* drop best-effort */ }
}

function avModBindDrag() {
  try {
    if (typeof document === "undefined" || !document || typeof document.addEventListener !== "function") return false;
    if (document.__avModDragBound === true) return true;
    document.__avModDragBound = true;
    document.addEventListener("dragstart", avModDragStartEvent);
    document.addEventListener("dragend", function () { avModDragEnd(); });
    document.addEventListener("dragover", avModDragOverEvent);
    document.addEventListener("drop", avModDropEvent);
    return true;
  } catch (e) { return false; }
}

function avModMacroSet(i, value) {
  const st = avModModelEnsure();
  const k = Math.floor(Number(i));
  if (!isFinite(k) || k < 0 || k >= AV_MOD_MACRO_COUNT) return false;
  const v = avModClamp01(value);
  st.macros[k].value = v;
  const path = AV_MOD_MACRO_PREFIX + (k + 1);
  try { if (typeof avParams !== "undefined" && avParams) avParams[path] = v; } catch (e) { /* no mirror */ }
  avModPost();
  avModSyncOutsFor("macro" + (k + 1));
  return true;
}

/* sanitising load — round-trip partner of avModSnap, patch-v2 entry point. Returns false only
   for non-objects; per-entry garbage is dropped/clamped, never thrown. */
function avModLoad(snap) {
  if (!snap || typeof snap !== "object") return false;
  if (!Array.isArray(snap.macros) && !Array.isArray(snap.slots)) return false;
  const d = avModDefaults();
  if (Array.isArray(snap.macros)) {
    const n = Math.min(AV_MOD_MACRO_COUNT, snap.macros.length);
    for (let i = 0; i < n; i++) {
      const m = snap.macros[i];
      if (!m || typeof m !== "object") continue;
      d.macros[i].name = avModNameNorm(m.name, i);
      d.macros[i].value = avModClamp01(m.value);
    }
  }
  if (Array.isArray(snap.slots)) {
    for (let i = 0; i < snap.slots.length && d.slots.length < AV_MOD_MAX_SLOTS; i++) {
      const s = avModSlotNorm(snap.slots[i]);
      if (s) d.slots.push(s);
    }
  }
  avModState = d;
  /* mirror + repaint the macro row from the model */
  for (let i = 0; i < AV_MOD_MACRO_COUNT; i++) {
    const path = AV_MOD_MACRO_PREFIX + (i + 1);
    try { if (typeof avParams !== "undefined" && avParams) avParams[path] = d.macros[i].value; } catch (e) { /* no mirror */ }
  }
  const host = avModHost();
  if (host) {
    try {
      const row = host.querySelector(".av-mod-macros");
      if (row) {
        row.innerHTML = avModMacroKnobsHTML();
        if (typeof avKnobBind === "function") avKnobBind(row);
      }
    } catch (e) { /* repaint is a nicety */ }
  }
  avModRenderSlots();
  avModPost();
  return true;
}

/* ---------- markup (pure string builders — static-checkable without a DOM) ---------- */

const avModEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const avModNumText = (v) => { const n = Number(v); return isFinite(n) ? String(Math.round(n * 100) / 100) : "0"; };
const avModAmtText = (v) => { const n = Number(v); const r = isFinite(n) ? Math.round(n * 100) : 0; return (r > 0 ? "+" : "") + r + "%"; };

function avModMacroKnobHTML(m, i) {
  return avKnobHTML(AV_MOD_MACRO_PREFIX + (i + 1), m.name, {
    min: 0, max: 1, step: 0.01, def: 0, value: m.value, fmt: "pct",
    hint: "mod matrix source macro",
  });
}

function avModMacroKnobsHTML() {
  const st = avModModelEnsure();
  let out = "";
  for (let i = 0; i < st.macros.length; i++) out += avModMacroKnobHTML(st.macros[i], i);
  return out;
}

function avModMacroRowHTML() {
  return '<div class="av-knobs av-mod-macros">' + avModMacroKnobsHTML() + "</div>";
}

function avModOptionsHTML(names, current) {
  let out = "";
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    out += '<option value="' + avModEsc(n) + '"' + (n === current ? " selected" : "") + ">" + avModEsc(n) + "</option>";
  }
  return out;
}

function avModCurveOptionsHTML(curve) {
  const c = avModCurveOf(curve);
  let out = "";
  for (let i = 0; i < AV_MOD_CURVES.length; i++) {
    out += '<option value="' + i + '"' + (i === c ? " selected" : "") + ">" + avModEsc(AV_MOD_CURVES[i]) + "</option>";
  }
  return out;
}

/* one matrix row in the Serum column grammar: n · source · curve · amount · pol · destination · out · remove */
function avModSlotRowHTML(slot, idx) {
  const n = idx + 1;
  return '<div class="av-mod-slot" data-slot="' + idx + '">' +
    '<span class="av-mod-slot-n">' + n + "</span>" +
    '<select class="av-select av-mod-src" data-slot-field="src" data-slot-index="' + idx + '" aria-label="Slot ' + n + ' source">' +
    avModOptionsHTML(AV_MOD_SOURCES, slot.src) + "</select>" +
    '<select class="av-select av-mod-curve" data-slot-field="curve" data-slot-index="' + idx + '" aria-label="Slot ' + n + ' curve">' +
    avModCurveOptionsHTML(slot.curve) + "</select>" +
    '<span class="av-mod-amt-box"><input type="range" class="av-mod-amt" data-slot-field="amt" data-slot-index="' + idx +
    '" min="-1" max="1" step="0.01" value="' + avModNumText(slot.amt) + '" aria-label="Slot ' + n + ' amount">' +
    '<span class="av-mod-amt-val" data-slot-amtval="' + idx + '">' + avModEsc(avModAmtText(slot.amt)) + "</span></span>" +
    '<button type="button" class="av-btn mini av-mod-pol" data-slot-pol="' + idx + '" title="Flip polarity" aria-label="Slot ' + n + ' polarity">' +
    (slot.amt < 0 ? "&plusmn;" : "+") + "</button>" +
    '<select class="av-select av-mod-dst" data-slot-field="dst" data-slot-index="' + idx + '" aria-label="Slot ' + n + ' target">' +
    avModOptionsHTML(AV_MOD_TARGETS, slot.dst) + "</select>" +
    '<span class="av-mod-out av-dim" data-slot-out="' + idx + '">' + avModEsc(avModOutText(slot)) + "</span>" +
    '<button type="button" class="av-btn mini av-mod-del" data-slot-del="' + idx + '" title="Remove slot ' + n + '" aria-label="Remove slot ' + n + '">&#10005;</button>' +
    "</div>";
}

function avModHdrHTML() {
  return '<div class="av-mod-hdr" aria-hidden="true"><span></span><span>SOURCE</span><span>CURVE</span>' +
    "<span>AMOUNT</span><span>POL</span><span>DESTINATION</span><span>OUT</span><span></span></div>";
}

function avModSrcStripHTML() {
  let out = "";
  for (let i = 0; i < AV_MOD_SOURCES.length; i++) {
    const n = AV_MOD_SOURCES[i];
    out += '<button type="button" class="av-mod-chip" data-src="' + avModEsc(n) + '" draggable="true"' +
      ' style="--chip:' + avModEsc(AV_MOD_SRC_COLORS[n] || "var(--teal)") + '"' +
      ' title="Drag ' + avModEsc(n) + ' onto a knob to modulate it"' +
      ' aria-label="Modulation source ' + avModEsc(n) + ' - drag onto a knob">' + avModEsc(n) + "</button>";
  }
  return out;
}

function avModSlotsHTML() {
  const st = avModModelEnsure();
  if (!st.slots.length) {
    return '<p class="av-mod-empty av-note av-dim">No modulation slots yet &mdash; drag a source chip onto a target knob, or ADD SLOT (up to 32).</p>';
  }
  let out = avModHdrHTML();
  for (let i = 0; i < st.slots.length; i++) out += avModSlotRowHTML(st.slots[i], i);
  return out;
}

function avModBodyHTML() {
  const st = avModModelEnsure();
  return '<div class="av-mod-body">' +
    '<div class="av-mod-sec"><div class="av-mod-sec-lbl">MACROS</div>' + avModMacroRowHTML() + "</div>" +
    '<div class="av-mod-sec"><div class="av-mod-sec-lbl">SOURCES</div>' + avModSrcStripHTML() +
    '<div class="av-mod-status av-dim" id="av-mod-status"></div></div>' +
    '<div class="av-mod-sec"><div class="av-mod-sec-lbl">MATRIX</div>' +
    '<div class="av-mod-slots" id="av-mod-slots">' + avModSlotsHTML() + "</div>" +
    '<div class="av-mod-actions"><button type="button" class="av-btn av-mod-add" id="av-mod-add">+ ADD SLOT</button>' +
    '<span class="av-mod-count av-dim" id="av-mod-count">' + st.slots.length + " / " + AV_MOD_MAX_SLOTS + "</span></div>" +
    "</div>" +
    '<p class="av-note av-dim">Sources: env1 &middot; env2 &middot; lfo1 &middot; vel &middot; key &middot; rand (per note) &middot; macro1-8. ' +
    'Drag a chip onto a mapped knob (filter cutoff / reso &middot; osc1 / osc2 level) to write a slot; pitch &amp; pan stay matrix-only. ' +
    'Drains: cutoff &plusmn;4 oct &middot; reso &plusmn;0.5 &middot; pitch &plusmn;12 st &middot; osc levels &plusmn;1 &middot; pan &plusmn;1. Curves: linear / exp / S.</p>' +
    "</div>";
}

/* ---------- DOM (page side; every reach guarded) ---------- */

function avModHost() {
  try {
    if (typeof document !== "undefined" && document && typeof document.getElementById === "function") {
      return document.getElementById("av-mod-host");
    }
  } catch (e) { /* no document */ }
  return null;
}

function avModSyncAmtText(k) {
  const host = avModHost();
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const st = avModModelEnsure();
    const s = st.slots[k];
    if (!s) return false;
    const el = host.querySelector('[data-slot-amtval="' + k + '"]');
    if (el) el.textContent = avModAmtText(s.amt);
    const pol = host.querySelector('[data-slot-pol="' + k + '"]');
    if (pol) pol.textContent = (s.amt < 0) ? "\u00B1" : "+";
    const out = host.querySelector('[data-slot-out="' + k + '"]');
    if (out) out.textContent = avModOutText(s);
    return true;
  } catch (e) { return false; }
}

function avModRenderSlots() {
  const host = avModHost();
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const box = host.querySelector(".av-mod-slots");
    if (box) box.innerHTML = avModSlotsHTML();
    const st = avModModelEnsure();
    const cnt = host.querySelector(".av-mod-count");
    if (cnt) cnt.textContent = st.slots.length + " / " + AV_MOD_MAX_SLOTS;
    const add = host.querySelector(".av-mod-add");
    if (add) {
      const full = st.slots.length >= AV_MOD_MAX_SLOTS;
      add.disabled = full;
      if (full) { if (typeof add.setAttribute === "function") add.setAttribute("aria-disabled", "true"); }
      else if (typeof add.removeAttribute === "function") add.removeAttribute("aria-disabled");
    }
    return true;
  } catch (e) { return false; }
}

/* ---------- delegated card wiring (survives slot re-renders) ---------- */

function avModEventTarget(e) {
  const t = e && e.target;
  return (t && typeof t.closest === "function") ? t : null;
}

function avModClick(e) {
  const t = avModEventTarget(e);
  if (!t) return;
  if (t.closest(".av-mod-add")) { avModSlotAdd(); return; }
  const chip = t.closest(".av-mod-chip");
  if (chip) { avModStatus("drag " + chip.getAttribute("data-src") + " onto a knob"); return; }
  const pol = t.closest(".av-mod-pol");
  if (pol) {
    const i = Math.floor(Number(pol.getAttribute("data-slot-pol")));
    const st = avModModelEnsure();
    if (st.slots[i]) avModSlotSet(i, { amt: -st.slots[i].amt });
    return;
  }
  const del = t.closest(".av-mod-del");
  if (del) avModSlotRemove(Number(del.getAttribute("data-slot-del")));
}

function avModChange(e) {
  const t = avModEventTarget(e);
  if (!t) return;
  const sel = t.closest("select[data-slot-field]");
  if (!sel) return;
  const i = Number(sel.getAttribute("data-slot-index"));
  const f = sel.getAttribute("data-slot-field");
  if (f === "src") avModSlotSet(i, { src: sel.value });
  else if (f === "dst") avModSlotSet(i, { dst: sel.value });
  else if (f === "curve") avModSlotSet(i, { curve: Number(sel.value) });
}

function avModInput(e) {
  const t = avModEventTarget(e);
  if (!t) return;
  const rng = t.closest("input.av-mod-amt");
  if (!rng) return;
  avModSlotSet(Number(rng.getAttribute("data-slot-index")), { amt: Number(rng.value) });
}

function avModBindCard(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  if (host.__avModBound === true) return true;
  host.__avModBound = true;
  host.addEventListener("click", avModClick);
  host.addEventListener("change", avModChange);
  host.addEventListener("input", avModInput);
  return true;
}

/* ---------- mount ---------- */

function avModInit() {
  const host = avModHost();
  if (!host) return false;
  if (typeof avKnobHTML !== "function" || typeof avKnobBind !== "function" || typeof avKnobRowHTML !== "function") return false;
  try {
    const st = avModModelEnsure();
    avModEnsureHooks();
    /* seed the mirror (unset paths only) — first paint reads avParams, like every other card */
    for (let i = 0; i < AV_MOD_MACRO_COUNT; i++) {
      const path = AV_MOD_MACRO_PREFIX + (i + 1);
      try { if (typeof avParams !== "undefined" && avParams && !(path in avParams)) avParams[path] = st.macros[i].value; } catch (e) { /* no mirror */ }
    }
    host.innerHTML = avModBodyHTML();
    avKnobBind(host);
    avModBindCard(host);
    avModBindDrag();
    avModRenderSlots();
    avModSyncRings();
    avModReplayWhenReady();
    return true;
  } catch (e) {
    console.warn("[anvil] mod card mount failed", e);
    return false;
  }
}

/* ---------- css classes this card introduces (parent styles them in styles.css) ---------- */

function avModClasses() {
  return [
    "av-mod-body", "av-mod-sec", "av-mod-sec-lbl", "av-mod-macros", "av-mod-slots",
    "av-mod-slot", "av-mod-slot-n", "av-mod-src", "av-mod-dst",
    "av-mod-amt-box", "av-mod-amt", "av-mod-amt-val", "av-mod-curve", "av-mod-del",
    "av-mod-empty", "av-mod-actions", "av-mod-add", "av-mod-count",
    "av-mod-srcstrip", "av-mod-chip", "av-mod-status", "av-mod-hdr", "av-mod-pol", "av-mod-out",
    "av-mod-target", "av-mod-droppable", "av-mod-shown", "av-knob-mod",
  ];
}
