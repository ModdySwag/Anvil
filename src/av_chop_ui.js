/* Anvil — CHOP card (M2 wave, child sa-E): the sample-chop surface mounted into the parent-owned
   host `#av-chop-host` (the parent adds the `#av-chop` card + host after `#av-sample` at
   integration and calls avChopUiInit()); this module only fills the host. Per verify/_m2_wave.md
   §2.5. The chop core it drives is sa-C's `src/av_chop.js` — WE CODE AGAINST THE §2.3 NAMES
   EXACTLY, every call typeof-guarded PER CALL (the core may load after this file, or not at all:
   absent core = the card still mounts, every action refuses honestly, no throw paths).

   WHAT THIS CARD IS — one chop surface over one avSampleStore entry:
     · SOURCE   `#av-chop-src` — select of avSampleStore.entries (id + name; the store's snap
                entry list is the fallback read). Plus `#av-chop-refresh` (extra id),
                `#av-chop-sens` (range 0..100 → detection sensitivity 0..1) and `#av-chop-detect`.
     · DETECT   runs avChopDetect(srcId, {sensitivity}) on the selected entry (§2.3), then builds
                the kit: avChopKitNew(srcId, {sensitivity}) when present — sa-C's documented ADDITIVE
                opts extension that rides into detection (the bare pinned avChopKitNew(srcId) call is
                honoured unchanged by the fallback), else a LOCAL fallback shaped literally from the
                §2.3 kit pin {ok:true, v:1, srcId, slot:0, base:36, slices:[{i,s0,s1,trim0,trim1,
                fadeIn:3,fadeOut:5,gainDb:0,norm:false,on:1}]} out of the detect receipt (documented
                path: the card stays usable when avChopKitNew is absent or refuses). Rows + markers
                repaint from the kit; the detect receipt (count/onsets/dropped) is kept honestly and
                reported in the status line.
     · CANVAS   `#av-chop-canvas` — the entry waveform (peaks min/max first; a channel-0 column
                scan as the /data fallback) plus slice markers: a faint region + boundary line per
                slice, numbered, teal when on, vermillion-dimmed when off; markers are overlaid only
                when the kit's srcId matches the selected source (the caption says so otherwise).
     · ROWS     `#av-chop-slices` — one `.av-chop-slice[data-slice-idx]` per kit slice with the
                pinned controls .av-chop-trim0/.av-chop-trim1 (frames) .av-chop-fadein/
                .av-chop-fadeout (ms) .av-chop-gain (dB) .av-chop-norm .av-chop-on. Edits commit
                through avChopSliceEdit(kit, i, patch) on input/change, then repaint rows, markers,
                caption and status.
     · MAP      `#av-chop-slot` (0..3) + `#av-chop-base` (number 0..108) — committed through
                avChopKitEdit(kit, {slot|base}) when the core offers it (sa-C's documented additive
                extension for exactly this map row); a direct clamped write to the card-owned kit
                object is the fallback when it does not (§2.3 pins no kit-level setter).
     · PADS     `#av-chop-pads` — 16 `.av-chop-pad[data-pad="0".."15"]`: pointerdown plays
                avNoteDown(avNoteName(base+pad)); pointerup / pointercancel / pointerleave (and
                keyup) plays avNoteUp; the held pad carries data-on="1" + .av-chop-pad-on. A cold
                click (no pad press within 900 ms) plays a short 280 ms blip so a synthetic .click()
                plays too; window blur releases every held pad. All three note reaches typeof-guarded.
     · APPLY    `#av-chop-apply` — avChopApply(kit) → status "applied: N slices → slot S".
     · STEPS    `#av-chop-steps` + `#av-chop-steps-track` (0..3 → labels T1..T4) + `#av-chop-
                steps-start` (extra id, 0..63, default 0) — avChopToSteps(kit, {track, start}) →
                status "wrote N steps → T{t}@{start}" (t printed as the 1-based track label the
                rest of the UI shows).
     · STATUS   `#av-chop-status` (role=status, aria-live=polite) — every refusal is a plain line.

   PINNED IDS (rig + parent rely on these; exact): #av-chop-src · #av-chop-detect · #av-chop-sens ·
   #av-chop-canvas · #av-chop-slices (rows [data-slice-idx] carrying .av-chop-trim0/.av-chop-trim1/
   .av-chop-fadein/.av-chop-fadeout/.av-chop-gain/.av-chop-norm/.av-chop-on) · #av-chop-slot ·
   #av-chop-base · #av-chop-pads (.av-chop-pad[data-pad="0".."15"]) · #av-chop-apply ·
   #av-chop-steps · #av-chop-steps-track · #av-chop-status.
   EXTRA ids (documented, the parent does not need them): #av-chop-refresh · #av-chop-sens-val ·
   #av-chop-canvas-cap · #av-chop-mapnote · #av-chop-steps-start · plus the root `.av-chop` div
   takes id "av-chop" only when no element owns it already (the av_files_ui/av_wt_ui idiom).

   CORE READS (all §2.3 names, all typeof-guarded per call): avChopDetect (DETECT) · avChopKitNew
   (kit construction) · avChopSliceEdit (row edits) · avChopNormGain (norm-gain readout in the row
   info line only) · avChopApply (APPLY KIT) · avChopToSteps (SLICE→STEPS). Note bus: avNoteName +
   avNoteDown + avNoteUp. Store: avSampleStore.entries (fallback .snap().entries, .get(id), .byId).
   Nothing else — no engine reach-ins.

   OBSERVABLES: avChopUiInit() -> bool (false without #av-chop-host; idempotent; re-mountable —
   module state survives a host rebuild) · avChopUiSnap() -> honest JSON-safe card state (never a
   DOM node, never a buffer copy) · avChopUiClasses() -> string[] (every NEW css class the card
   emits; the parent generates the styles block from it) · avChopUiSync(root) -> bool (full repaint
   from the module mirror; root defaults to #av-chop-host) ·
   window.__avChopUi = {version:"m2.0", init, snap, classes, sync}.

   LAWS (house): "use strict"; classic script; ONE namespace avChopUi* / AV_CHOP_UI_*; NO DOM at
   top level (node-loadable — the harness loads this text in a Function scope); every listener and
   every reach wrapped (never throws outward); no console noise; no new AudioContext (this card
   makes no sound of its own — pads ride the note bus); deterministic (no randomness; Date.now used
   only for the pad click-dedupe window). Drag-in of a new wav is DELIBERATELY OUT of scope (§2.5:
   the sample core owns import). ONE writer (child sa-E). */

"use strict";

const AV_CHOP_UI_VERSION = "m2.0";
const AV_CHOP_UI_PADS = 16;              /* the pad grid: pads 0..15 -> base+pad            */
const AV_CHOP_UI_SLOTS = 4;              /* sampler slots 0..3                              */
const AV_CHOP_UI_BASE_DEF = 36;          /* kit default base = c2 (the §2.3 kit pin)        */
const AV_CHOP_UI_BASE_MAX = 108;         /* the §2.5 base pin: MIDI 0..108                  */
const AV_CHOP_UI_START_MAX = 63;         /* the §2.3 to-steps start pin                     */
const AV_CHOP_UI_CLICK_MS = 900;         /* pad click-dedupe window (a press just happened) */
const AV_CHOP_UI_BLIP_MS = 280;          /* the cold-click pad blip length                  */

/* the NEW css classes this card emits (the parent styles them; #av-chop / #av-chop-host are
   parent-owned card ids, av-btn / av-select / av-note / av-dim are existing house classes and are
   NOT listed). Kept in one place so the integration class-coverage check can diff. The dynamic
   ones (error state, empty state, slice-off row, held pad) are listed here all the same. */
const AV_CHOP_UI_CLASSES = [
  "av-chop", "av-chop-head", "av-chop-title", "av-chop-cap",
  "av-chop-status-line", "av-chop-status", "av-chop-msg", "av-chop-err",
  "av-chop-srcsec", "av-chop-lbl", "av-chop-select", "av-chop-btn",
  "av-chop-range", "av-chop-sens-val",
  "av-chop-stage", "av-chop-canvas", "av-chop-canvas-cap",
  "av-chop-maprow", "av-chop-num", "av-chop-slot", "av-chop-base", "av-chop-mapnote",
  "av-chop-slices", "av-chop-empty", "av-chop-slice", "av-chop-slice-off",
  "av-chop-slice-num", "av-chop-chk", "av-chop-trim0", "av-chop-trim1",
  "av-chop-fadein", "av-chop-fadeout", "av-chop-gain", "av-chop-norm", "av-chop-on",
  "av-chop-slice-info",
  "av-chop-pads", "av-chop-pad", "av-chop-pad-on", "av-chop-pad-lbl", "av-chop-pad-note",
  "av-chop-actions", "av-chop-steps-track", "av-chop-steps-start", "av-chop-note",
];

/* UI-local state only — every core fact is read through the pinned §2.3 apis per call */
const avChopUiState = {
  inited: false, mounts: 0,
  kit: null,               /* the current kit object (owned by av_chop.js once built) */
  kitLocal: false,         /* true when the kit came from the local fallback build     */
  srcId: "",               /* the selected source entry id mirror                      */
  sens: 0.5,               /* detection sensitivity 0..1 (range 0..100 / 100)          */
  det: null,               /* last detect receipt summary {done, count, onsets, dropped, error} */
  applied: null,           /* last apply receipt summary                               */
  stepped: null,           /* last to-steps receipt summary                            */
  edits: 0,                /* successful avChopSliceEdit calls                         */
  held: [],                /* pads held right now: [{pad, name}]                       */
  padTouchAt: 0,           /* Date.now() of the last pad down/up (click dedupe)        */
  padBlip: null,           /* the cold-click blip timer id                             */
  status: "", statusKind: "msg",
  lastError: "",
  canvas: null, obs: null, obsCanvas: null, resizeWired: false, raf: 0, draws: 0, dpr: 1,
  rowsKit: null, rowsCount: -1,    /* row-rebuild bookkeeping                          */
  srcSig: "\u0000",                /* the source option ids the select was built from */
  blurWired: false,
  memo: { text: {}, cls: {} },
};

/* ---------- small pure helpers (no DOM; harness-covered) ---------- */

const avChopUiEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function avChopUiClamp(v, lo, hi) {
  const n = Number(v);
  if (!isFinite(n)) return lo;
  return n < lo ? lo : (n > hi ? hi : n);
}

/* clamp to an integer in [lo, hi]; junk -> dflt */
function avChopUiInt(v, lo, hi, dflt) {
  const n = Number(v);
  if (!isFinite(n)) return dflt;
  const r = Math.round(n);
  return r < lo ? lo : (r > hi ? hi : r);
}

/* a finite number or the default (snap/readout safety — never NaN out) */
function avChopUiNumOr(v, d) {
  const n = Number(v);
  return isFinite(n) ? n : d;
}

/* a clamped number as an input-value string; dp omitted = raw */
function avChopUiNumStr(v, lo, hi, dflt, dp) {
  const n = Number(v);
  if (!isFinite(n)) return String(dflt);
  const c = n < lo ? lo : (n > hi ? hi : n);
  return (dp == null) ? String(c) : c.toFixed(dp);
}

/* midi -> note name via the note bus (av_note.js); "" when the bus is absent or refuses */
function avChopUiNoteName(midi) {
  try {
    if (typeof avNoteName === "function") {
      const n = avNoteName(midi);
      if (typeof n === "string" && n) return n;
    }
  } catch (e) { /* note bus absent */ }
  return "";
}

/* the kit's base (0..108, default 36) */
function avChopUiBaseOf() {
  try {
    const k = avChopUiState.kit;
    if (k && k.base != null) return avChopUiInt(k.base, 0, AV_CHOP_UI_BASE_MAX, AV_CHOP_UI_BASE_DEF);
  } catch (e) { /* none */ }
  return AV_CHOP_UI_BASE_DEF;
}

/* how many slices are ACTIVE (on) */
function avChopUiActiveCount(kit) {
  let n = 0;
  try {
    if (kit && kit.slices && typeof kit.slices.length === "number") {
      for (let i = 0; i < kit.slices.length && i < 16; i++) {
        if (Number(kit.slices[i] && kit.slices[i].on)) n += 1;
      }
    }
  } catch (e) { /* none */ }
  return n;
}

/* the largest s1 in a kit (marker domain fallback when the buffer length is unknown) */
function avChopUiMaxS1(kit) {
  let m = 0;
  try {
    if (kit && kit.slices && typeof kit.slices.length === "number") {
      for (let i = 0; i < kit.slices.length && i < 16; i++) {
        const v = Number(kit.slices[i] && kit.slices[i].s1);
        if (isFinite(v) && v > m) m = v;
      }
    }
  } catch (e) { /* none */ }
  return m;
}

/* frame -> canvas x (CSS px), clamped; nF <= 0 -> 0 */
function avChopUiX(f, nF, w) {
  if (!(Number(nF) > 0)) return 0;
  const frac = avChopUiClamp(Number(f) / Number(nF), 0, 1);
  return Math.round(frac * Math.max(1, w - 1));
}

/* an error/refusal line out of anything (receipts carry .error strings) */
function avChopUiErrText(e, fallback) {
  try {
    if (e && typeof e === "object") {
      if (typeof e.error === "string" && e.error) return e.error;
      if (typeof e.message === "string" && e.message) return e.message;
    }
    if (typeof e === "string" && e) return e;
  } catch (e2) { /* fall through */ }
  return fallback || "refused";
}

/* ---------- guarded DOM + core access (no throw, no noise) ---------- */

function avChopUiWin() {
  try { if (typeof window !== "undefined") return window; } catch (e) { /* none */ }
  return null;
}

function avChopUiDoc() {
  try { if (typeof document !== "undefined") return document; } catch (e) { /* none */ }
  return null;
}

function avChopUiHost() {
  try {
    const d = avChopUiDoc();
    if (d && typeof d.getElementById === "function") return d.getElementById("av-chop-host");
  } catch (e) { /* no document */ }
  return null;
}

/* every pinned reach, each detected by typeof only (never called here) */
function avChopUiCores() {
  const c = {
    detect: false, detectFrames: false, kitNew: false, sliceEdit: false, normGain: false,
    zones: false, apply: false, toSteps: false, snap: false, classes: false,
    noteName: false, noteDown: false, noteUp: false, store: false,
  };
  try { c.detect = typeof avChopDetect === "function"; } catch (e) { /* none */ }
  try { c.detectFrames = typeof avChopDetectFrames === "function"; } catch (e) { /* none */ }
  try { c.kitNew = typeof avChopKitNew === "function"; } catch (e) { /* none */ }
  try { c.sliceEdit = typeof avChopSliceEdit === "function"; } catch (e) { /* none */ }
  try { c.normGain = typeof avChopNormGain === "function"; } catch (e) { /* none */ }
  try { c.zones = typeof avChopZones === "function"; } catch (e) { /* none */ }
  try { c.apply = typeof avChopApply === "function"; } catch (e) { /* none */ }
  try { c.toSteps = typeof avChopToSteps === "function"; } catch (e) { /* none */ }
  try { c.snap = typeof avChopSnap === "function"; } catch (e) { /* none */ }
  try { c.classes = typeof avChopClasses === "function"; } catch (e) { /* none */ }
  try { c.noteName = typeof avNoteName === "function"; } catch (e) { /* none */ }
  try { c.noteDown = typeof avNoteDown === "function"; } catch (e) { /* none */ }
  try { c.noteUp = typeof avNoteUp === "function"; } catch (e) { /* none */ }
  try { c.store = (typeof avSampleStore !== "undefined" && !!avSampleStore); } catch (e) { /* none */ }
  return c;
}

/* the avSampleStore entry list as [{id, name}] — .entries first, .snap().entries as fallback.
   Never throws; an absent store is [] (the honest empty state). */
function avChopUiStoreEntries() {
  const out = [];
  try {
    if (typeof avSampleStore === "undefined" || !avSampleStore) return out;
    let es = null;
    const direct = avSampleStore.entries;
    if (direct && typeof direct.length === "number") es = direct;
    else if (typeof avSampleStore.snap === "function") {
      const sn = avSampleStore.snap();
      if (sn && sn.entries && typeof sn.entries.length === "number") es = sn.entries;
    }
    if (!es) return out;
    const n = Math.min(64, es.length | 0);
    for (let i = 0; i < n; i++) {
      const e = es[i];
      if (!e || typeof e !== "object" || e.id == null) continue;
      out.push({
        id: String(e.id),
        name: (typeof e.name === "string" && e.name) ? e.name : String(e.id),
      });
    }
  } catch (e) { /* store absent or mid-import */ }
  return out;
}

/* the live store entry for an id (buffer + peaks needed by the canvas), or null */
function avChopUiEntry(id) {
  try {
    if (!id || typeof avSampleStore === "undefined" || !avSampleStore) return null;
    if (typeof avSampleStore.get === "function") {
      const e = avSampleStore.get(id);
      if (e && typeof e === "object") return e;
    }
    const by = avSampleStore.byId;
    if (by && by[id] && typeof by[id] === "object") return by[id];
  } catch (e) { /* none */ }
  return null;
}

/* the entry's frame count (buffer length first, duration x rate as the fallback) */
function avChopUiFramesOf(entry) {
  try {
    if (entry && entry.buffer && isFinite(entry.buffer.length)) return Math.max(0, entry.buffer.length | 0);
    if (entry && isFinite(entry.duration) && isFinite(entry.sampleRate) && entry.sampleRate > 0) {
      return Math.max(0, Math.round(Number(entry.duration) * Number(entry.sampleRate)));
    }
  } catch (e) { /* none */ }
  return 0;
}

/* ---------- kit construction ---------- */

/* LOCAL FALLBACK ONLY — used when avChopKitNew is absent or refuses. Shapes the §2.3 kit pin
   literally out of a detect receipt ({ok:true, slices:[{s0,s1}]}): trim defaults = s0/s1, fades
   3/5 ms, gain 0 dB, norm off, on 1. ok:true mirrors the core kit shape (sa-C's kitNew adds it).
   Returns null when the receipt carries no slices. */
function avChopUiKitFromDetect(srcId, det) {
  try {
    if (!det || !det.slices || typeof det.slices.length !== "number") return null;
    const slices = [];
    const n = Math.min(16, det.slices.length | 0);
    for (let i = 0; i < n; i++) {
      const raw = det.slices[i] || {};
      const s0 = Math.max(0, Math.round(avChopUiNumOr(raw.s0, 0)));
      const s1 = Math.max(s0 + 1, Math.round(avChopUiNumOr(raw.s1, s0 + 1)));
      slices.push({ i: i, s0: s0, s1: s1, trim0: s0, trim1: s1, fadeIn: 3, fadeOut: 5, gainDb: 0, norm: false, on: 1 });
    }
    return { ok: true, v: 1, srcId: String(srcId == null ? "" : srcId), slot: 0, base: AV_CHOP_UI_BASE_DEF, slices: slices };
  } catch (e) { return null; }
}

/* build the kit: avChopKitNew(srcId, opts) when present and kit-shaped, else the local fallback.
   `opts` ({sensitivity}) is sa-C's documented additive extension that rides into the kit's own
   detection — a pure §2.3 core ignores the extra argument, so both stay honoured.
   Returns {kit, local} or null. */
function avChopUiBuildKit(srcId, det, opts) {
  let kit = null;
  try {
    if (typeof avChopKitNew === "function") kit = avChopKitNew(srcId, opts);
  } catch (e) { kit = null; }
  if (!kit || typeof kit !== "object" || !kit.slices || typeof kit.slices.length !== "number") {
    const local = avChopUiKitFromDetect(srcId, det);
    return local ? { kit: local, local: true } : null;
  }
  return { kit: kit, local: false };
}

/* commit the map row ({slot} / {base}) onto the kit — avChopKitEdit first (sa-C's documented
   additive extension for exactly this), else a direct clamped write on the card-owned object. */
function avChopUiKitMap(kit, patch) {
  try {
    if (typeof avChopKitEdit === "function") {
      const r = avChopKitEdit(kit, patch);
      if (r !== false) return true;
    }
  } catch (e) { /* fall through to the direct write */ }
  try {
    if ("slot" in patch) kit.slot = avChopUiInt(patch.slot, 0, AV_CHOP_UI_SLOTS - 1, 0);
    if ("base" in patch) kit.base = avChopUiInt(patch.base, 0, AV_CHOP_UI_BASE_MAX, AV_CHOP_UI_BASE_DEF);
    return true;
  } catch (e2) { return false; }
}

/* ---------- write-on-change DOM painting ---------- */

function avChopUiWriteText(host, sel, txt, key) {
  try {
    const s = avChopUiState;
    if (s.memo.text[key] === txt) return false;
    s.memo.text[key] = txt;
    const el = (host && typeof host.querySelector === "function") ? host.querySelector(sel) : null;
    if (el && el.textContent !== txt) el.textContent = txt;
    return true;
  } catch (e) { return false; }
}

function avChopUiToggleClass(host, sel, cls, on, key) {
  try {
    const s = avChopUiState;
    const memoKey = key + "|" + cls;
    const want = !!on;
    if (s.memo.cls[memoKey] === want) return false;
    s.memo.cls[memoKey] = want;
    const el = (host && typeof host.querySelector === "function") ? host.querySelector(sel) : null;
    if (el && el.classList && typeof el.classList.add === "function") {
      if (want) el.classList.add(cls); else el.classList.remove(cls);
    }
    return true;
  } catch (e) { return false; }
}

function avChopUiPaintStatus(host) {
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const s = avChopUiState;
    avChopUiWriteText(host, "#av-chop-status", s.status, "status");
    avChopUiToggleClass(host, "#av-chop-status", "av-chop-err", s.statusKind === "err", "status-err");
    return true;
  } catch (e) { return false; }
}

function avChopUiSetStatus(msg, kind) {
  try {
    const s = avChopUiState;
    s.status = String(msg == null ? "" : msg);
    s.statusKind = (kind === "err") ? "err" : "msg";
    return avChopUiPaintStatus(avChopUiHost());
  } catch (e) { return false; }
}

/* the source select's options — pure string builder (harness-covered) */
function avChopUiSrcOptionsHTML(list) {
  let html = "";
  try {
    if (!list || typeof list.length !== "number") return html;
    const n = Math.min(64, list.length | 0);
    for (let i = 0; i < n; i++) {
      const e = list[i] || {};
      html += '<option value="' + avChopUiEsc(e.id) + '">' + avChopUiEsc(e.name) + "</option>";
    }
  } catch (e) { /* none */ }
  return html;
}

/* rebuild / refresh the source select from the store (options only when the id set changed) */
function avChopUiPaintSrc(host, force) {
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const s = avChopUiState;
    const sel = host.querySelector("#av-chop-src");
    if (!sel) return false;
    const list = avChopUiStoreEntries();
    let sig = "";
    for (let i = 0; i < list.length; i++) sig += (i ? "," : "") + list[i].id;
    if (force || sig !== s.srcSig) {
      s.srcSig = sig;
      if (typeof sel.innerHTML === "string") sel.innerHTML = avChopUiSrcOptionsHTML(list);
    }
    let want = s.srcId;
    let found = false;
    for (let i = 0; i < list.length; i++) if (list[i].id === want) { found = true; break; }
    if (!found) want = list.length ? list[0].id : "";
    s.srcId = want;
    if (sel.value !== want) { try { sel.value = want; } catch (e) { /* value assign refused */ } }
    return true;
  } catch (e) { return false; }
}

function avChopUiPaintSens(host) {
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const s = avChopUiState;
    const px = String(Math.round(avChopUiClamp(s.sens, 0, 1) * 100));
    const el = host.querySelector("#av-chop-sens");
    if (el && el.value !== px) { try { el.value = px; } catch (e) { /* ok */ } }
    avChopUiWriteText(host, "#av-chop-sens-val", px + "%", "sensval");
    return true;
  } catch (e) { return false; }
}

function avChopUiPaintMap(host) {
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const s = avChopUiState;
    const slot = host.querySelector("#av-chop-slot");
    if (slot) {
      const want = String(avChopUiInt(s.kit ? s.kit.slot : 0, 0, AV_CHOP_UI_SLOTS - 1, 0));
      if (slot.value !== want) { try { slot.value = want; } catch (e) { /* ok */ } }
    }
    const base = host.querySelector("#av-chop-base");
    const b = avChopUiBaseOf();
    const d = avChopUiDoc();
    if (base && !(d && d.activeElement === base)) {
      const want = String(b);
      if (base.value !== want) { try { base.value = want; } catch (e) { /* ok */ } }
    }
    const mn = host.querySelector("#av-chop-mapnote");
    if (mn) {
      const note = avChopUiNoteName(b);
      const txt = note ? ("\u2192 " + note) : "";
      if (mn.textContent !== txt) mn.textContent = txt;
    }
    return true;
  } catch (e) { return false; }
}

function avChopUiPadEl(i) {
  try {
    const host = avChopUiHost();
    if (!host || typeof host.querySelector !== "function") return null;
    return host.querySelector('#av-chop-pads .av-chop-pad[data-pad="' + avChopUiInt(i, 0, AV_CHOP_UI_PADS - 1, 0) + '"]');
  } catch (e) { return null; }
}

function avChopUiPaintPads(host) {
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const s = avChopUiState;
    const base = avChopUiBaseOf();
    const box = host.querySelector("#av-chop-pads");
    if (!box || typeof box.querySelectorAll !== "function") return false;
    const pads = box.querySelectorAll(".av-chop-pad[data-pad]");
    for (let i = 0; i < pads.length; i++) {
      const el = pads[i];
      const idx = avChopUiInt(el.getAttribute("data-pad"), 0, AV_CHOP_UI_PADS - 1, -1);
      if (idx < 0) continue;
      const note = avChopUiNoteName(base + idx);
      const txt = note || String(base + idx);
      const noteEl = (typeof el.querySelector === "function") ? el.querySelector(".av-chop-pad-note") : null;
      if (noteEl && noteEl.textContent !== txt) noteEl.textContent = txt;
      if (typeof el.setAttribute === "function") {
        const title = "pad " + (idx + 1) + " \u2014 plays " + txt;
        if (el.getAttribute("title") !== title) el.setAttribute("title", title);
        const aria = "Pad " + (idx + 1) + " \u2014 plays " + txt;
        if (el.getAttribute("aria-label") !== aria) el.setAttribute("aria-label", aria);
      }
      let held = false;
      for (let k = 0; k < s.held.length; k++) if (s.held[k].pad === idx) { held = true; break; }
      if (el.classList) {
        if (held) el.classList.add("av-chop-pad-on"); else el.classList.remove("av-chop-pad-on");
      }
      if (held) {
        if (typeof el.setAttribute === "function") el.setAttribute("data-on", "1");
      } else if (typeof el.removeAttribute === "function") {
        el.removeAttribute("data-on");
      }
    }
    return true;
  } catch (e) { return false; }
}

/* one row's info line: frames · note · (norm gain readout when norm is on) */
function avChopUiSliceInfo(kit, sl, i) {
  try {
    const base = avChopUiBaseOf();
    const s0 = Math.round(avChopUiNumOr(sl && sl.s0, 0));
    const s1 = Math.round(avChopUiNumOr(sl && sl.s1, 0));
    let t = "f " + s0 + "\u2013" + s1 + " \u00b7 " + Math.max(0, s1 - s0) + " fr";
    const note = avChopUiNoteName(base + i);
    if (note) t += " \u00b7 " + note;
    if (sl && Number(sl.norm)) {
      if (typeof avChopNormGain === "function") {
        let r = null;
        try { r = avChopNormGain(kit, i); } catch (e) { r = null; }
        if (r && r.ok === true && isFinite(Number(r.gainDb))) {
          const g = Number(r.gainDb);
          t += " \u00b7 norm " + (g >= 0 ? "+" : "") + (Math.round(g * 10) / 10).toFixed(1) + " dB";
        } else {
          t += " \u00b7 norm at apply";
        }
      } else {
        t += " \u00b7 norm at apply";
      }
    }
    return t;
  } catch (e) { return "slice " + (i + 1); }
}

/* one slice row — the pinned controls, classes exactly as §2.5 pins them */
function avChopUiRowHTML(kit, sl, i) {
  const on = Number(sl && sl.on) ? 1 : 0;
  const num = (v, lo, hi) => avChopUiEsc(avChopUiNumStr(v, lo, hi, 0));
  return '<div class="av-chop-slice' + (on ? "" : " av-chop-slice-off") + '" data-slice-idx="' + i + '">' +
    '<span class="av-chop-slice-num" title="slice ' + (i + 1) + '">SL ' + (i + 1) + "</span>" +
    '<label class="av-chop-lbl">TRIM' +
    '<input class="av-chop-num av-chop-trim0" type="number" min="0" step="1" value="' + num(sl && sl.trim0, 0, 1e9) + '" data-chop-field="trim0" aria-label="slice ' + (i + 1) + ' trim start (frames)">' +
    '<input class="av-chop-num av-chop-trim1" type="number" min="0" step="1" value="' + num(sl && sl.trim1, 0, 1e9) + '" data-chop-field="trim1" aria-label="slice ' + (i + 1) + ' trim end (frames)">' +
    "</label>" +
    '<label class="av-chop-lbl">FADE' +
    '<input class="av-chop-num av-chop-fadein" type="number" min="0" max="100" step="1" value="' + num(sl && sl.fadeIn, 0, 100) + '" data-chop-field="fadeIn" aria-label="slice ' + (i + 1) + ' fade in (ms)">' +
    '<input class="av-chop-num av-chop-fadeout" type="number" min="0" max="100" step="1" value="' + num(sl && sl.fadeOut, 0, 100) + '" data-chop-field="fadeOut" aria-label="slice ' + (i + 1) + ' fade out (ms)">' +
    "</label>" +
    '<label class="av-chop-lbl">GAIN' +
    '<input class="av-chop-num av-chop-gain" type="number" min="-24" max="24" step="0.5" value="' + num(sl && sl.gainDb, -24, 24) + '" data-chop-field="gainDb" aria-label="slice ' + (i + 1) + ' gain (dB)">' +
    "</label>" +
    '<label class="av-chop-chk"><input class="av-chop-norm" type="checkbox" data-chop-field="norm"' + (sl && sl.norm ? " checked" : "") + ' aria-label="slice ' + (i + 1) + ' normalise at apply"> NORM</label>' +
    '<label class="av-chop-chk"><input class="av-chop-on" type="checkbox" data-chop-field="on"' + (on ? " checked" : "") + ' aria-label="slice ' + (i + 1) + ' active"> ON</label>' +
    '<span class="av-chop-slice-info">' + avChopUiEsc(avChopUiSliceInfo(kit, sl, i)) + "</span>" +
    "</div>";
}

/* the empty state line for #av-chop-slices */
function avChopUiEmptyMsg() {
  const s = avChopUiState;
  if (!avChopUiStoreEntries().length) return "no samples yet \u2014 import audio in the SAMPLE card, then pick a source and press DETECT";
  if (!s.kit) return "no kit \u2014 pick a source and press DETECT";
  return "the kit holds no slices \u2014 try a higher sensitivity and DETECT again";
}

/* rows: rebuild on kit identity / count change (or force), else refresh values in place */
function avChopUiPaintRows(host, force) {
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const s = avChopUiState;
    const box = host.querySelector("#av-chop-slices");
    if (!box) return false;
    const kit = s.kit;
    const count = (kit && kit.slices && typeof kit.slices.length === "number") ? Math.min(16, kit.slices.length | 0) : 0;
    if (!count) {
      if (force || s.rowsKit !== (kit || null) || s.rowsCount !== 0) {
        box.innerHTML = '<p class="av-note av-dim av-chop-empty">' + avChopUiEsc(avChopUiEmptyMsg()) + "</p>";
        s.rowsKit = kit || null;
        s.rowsCount = 0;
      }
      return true;
    }
    if (force || s.rowsKit !== kit || s.rowsCount !== count) {
      let html = "";
      for (let i = 0; i < count; i++) html += avChopUiRowHTML(kit, kit.slices[i], i);
      box.innerHTML = html;
      s.rowsKit = kit;
      s.rowsCount = count;
      return true;
    }
    /* refresh in place (a live edit repaints its own row; this covers syncs) */
    const d = avChopUiDoc();
    const rows = (typeof box.querySelectorAll === "function") ? box.querySelectorAll("[data-slice-idx]") : null;
    if (!rows) return false;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const i = avChopUiInt(row.getAttribute("data-slice-idx"), 0, 15, -1);
      if (i < 0) continue;
      const sl = kit.slices[i];
      if (!sl) continue;
      const setVal = (cls, v) => {
        const el = (typeof row.querySelector === "function") ? row.querySelector(cls) : null;
        if (!el) return;
        if (d && d.activeElement === el) return;                 /* never fight live typing */
        const str = String(v);
        if (el.value !== str) { try { el.value = str; } catch (e) { /* ok */ } }
      };
      setVal(".av-chop-trim0", avChopUiNumStr(sl.trim0, 0, 1e9, 0));
      setVal(".av-chop-trim1", avChopUiNumStr(sl.trim1, 0, 1e9, 0));
      setVal(".av-chop-fadein", avChopUiNumStr(sl.fadeIn, 0, 100, 0));
      setVal(".av-chop-fadeout", avChopUiNumStr(sl.fadeOut, 0, 100, 0));
      setVal(".av-chop-gain", avChopUiNumStr(sl.gainDb, -24, 24, 0));
      const normEl = (typeof row.querySelector === "function") ? row.querySelector(".av-chop-norm") : null;
      if (normEl && normEl.checked !== !!sl.norm) normEl.checked = !!sl.norm;
      const onEl = (typeof row.querySelector === "function") ? row.querySelector(".av-chop-on") : null;
      const on = !!Number(sl.on);
      if (onEl && onEl.checked !== on) onEl.checked = on;
      const infoEl = (typeof row.querySelector === "function") ? row.querySelector(".av-chop-slice-info") : null;
      if (infoEl) {
        const txt = avChopUiSliceInfo(kit, sl, i);
        if (infoEl.textContent !== txt) infoEl.textContent = txt;
      }
      if (row.classList) {
        if (on) row.classList.remove("av-chop-slice-off"); else row.classList.add("av-chop-slice-off");
      }
    }
    return true;
  } catch (e) { return false; }
}

function avChopUiPaintCanvasCap(host) {
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const s = avChopUiState;
    let txt = "";
    const list = avChopUiStoreEntries();
    const e = avChopUiEntry(s.srcId);
    const name = (e && typeof e.name === "string" && e.name) ? e.name : (s.srcId || "sample");
    const fr = avChopUiFramesOf(e);
    if (!list.length) {
      txt = "no samples \u2014 import audio in the SAMPLE card";
    } else if (!s.kit || !s.kit.slices || typeof s.kit.slices.length !== "number") {
      txt = "source: " + name + " \u00b7 " + fr + " frames \u2014 press DETECT";
    } else {
      const k = s.kit;
      const m = Math.min(16, k.slices.length | 0);
      const base = avChopUiBaseOf();
      const note = avChopUiNoteName(base);
      txt = "kit: " + m + " slices \u00b7 slot " + avChopUiInt(k.slot, 0, AV_CHOP_UI_SLOTS - 1, 0) + " \u00b7 base " + base + (note ? " (" + note + ")" : "");
      if (String(k.srcId) !== s.srcId) {
        const ke = avChopUiEntry(k.srcId);
        const kn = (ke && typeof ke.name === "string" && ke.name) ? ke.name : String(k.srcId || "another sample");
        txt = "kit is for " + kn + " \u2014 press DETECT to rebuild \u00b7 " + txt;
      } else {
        txt += " \u00b7 " + fr + " frames";
      }
    }
    avChopUiWriteText(host, "#av-chop-canvas-cap", txt, "cancap");
    return true;
  } catch (e) { return false; }
}

/* ---------- the canvas (all work inside guarded functions) ---------- */

function avChopUiTeal() {
  try {
    if (typeof getComputedStyle === "function" && typeof document !== "undefined" && document.documentElement) {
      const v = String(getComputedStyle(document.documentElement).getPropertyValue("--teal") || "").trim();
      if (v) return v;
    }
  } catch (e) { /* token unavailable */ }
  return "#2ed8c9";
}

function avChopUiCanvasEl() {
  try {
    const host = avChopUiHost();
    if (host && typeof host.querySelector === "function") return host.querySelector("#av-chop-canvas");
  } catch (e) { /* none */ }
  return null;
}

function avChopUiRefit(c) {
  const s = avChopUiState;
  const dprRaw = (function () {
    try {
      const w = avChopUiWin();
      if (w && isFinite(w.devicePixelRatio)) return w.devicePixelRatio;
    } catch (e) { /* none */ }
    return 1;
  })();
  s.dpr = Math.max(1, Math.min(4, dprRaw));
  let cssW = Number(c.clientWidth) || 0;
  let cssH = Number(c.clientHeight) || 0;
  if (!(cssW > 0)) cssW = 1024;              /* unmeasurable (hidden): a stable design box —
                                                never read c.width here (that grows every draw) */
  if (!(cssH > 0)) cssH = 168;
  cssW = Math.max(1, Math.round(cssW));
  cssH = Math.max(1, Math.round(cssH));
  const bw = Math.max(1, Math.round(cssW * s.dpr));
  const bh = Math.max(1, Math.round(cssH * s.dpr));
  if (c.width !== bw) c.width = bw;
  if (c.height !== bh) c.height = bh;
  return { w: cssW, h: cssH };
}

/* min/max columns from the entry peaks (the av_sample shape), then the channel-0 scan fallback */
function avChopUiDrawWave(g, e, w, h, mid, amp) {
  try {
    const pk = e && e.peaks;
    if (pk && pk.min && pk.max && isFinite(pk.n) && pk.n > 0) {
      const n = pk.n | 0;
      g.fillStyle = avChopUiTeal();
      for (let x = 0; x < w; x++) {
        const i0 = Math.floor((x * n) / w);
        const i1 = Math.max(i0 + 1, Math.floor(((x + 1) * n) / w));
        let lo = Infinity, hi = -Infinity;
        for (let i = i0; i < i1 && i < n; i++) {
          const a = Number(pk.min[i]) || 0, b = Number(pk.max[i]) || 0;
          if (a < lo) lo = a;
          if (b > hi) hi = b;
        }
        if (lo === Infinity) { lo = 0; hi = 0; }
        const y0 = mid - hi * amp, y1 = mid - lo * amp;
        g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
      }
      return true;
    }
    if (e && e.buffer && typeof e.buffer.getChannelData === "function") {
      const d = e.buffer.getChannelData(0);
      const n = d ? (d.length | 0) : 0;
      if (n > 0) {
        g.fillStyle = avChopUiTeal();
        for (let x = 0; x < w; x++) {
          const i0 = Math.floor((x * n) / w);
          const i1 = Math.max(i0 + 1, Math.floor(((x + 1) * n) / w));
          let lo = Infinity, hi = -Infinity;
          for (let i = i0; i < i1 && i < n; i++) {
            const v = Number(d[i]) || 0;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
          if (lo === Infinity) { lo = 0; hi = 0; }
          const y0 = mid - hi * amp, y1 = mid - lo * amp;
          g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
        }
        return true;
      }
    }
  } catch (err) { /* buffer gone — the grid stays */ }
  return false;
}

/* the slice markers: a faint region + a boundary line + a number per slice, teal when on,
   vermillion-dimmed when off; plus the kit's tail edge */
function avChopUiDrawMarkers(g, kit, w, h, nF) {
  let drawn = 0;
  try {
    if (!(Number(nF) > 0)) return 0;
    const slices = kit.slices;
    let tail = 0;
    for (let i = 0; i < slices.length && i < 16; i++) {
      const sl = slices[i];
      if (!sl) continue;
      const on = !!Number(sl.on);
      const x0 = avChopUiX(sl.s0, nF, w);
      const x1 = avChopUiX(sl.s1, nF, w);
      if (on) {
        g.fillStyle = "rgba(46,216,201,0.10)";
        g.fillRect(x0, 0, Math.max(1, x1 - x0), h);
      }
      g.fillStyle = on ? "rgba(46,216,201,0.85)" : "rgba(255,143,110,0.55)";
      g.fillRect(x0, 0, 1, h);
      try { g.font = "9px monospace"; } catch (e) { /* font refusal */ }
      g.fillStyle = on ? "rgba(46,216,201,0.95)" : "rgba(255,143,110,0.80)";
      g.fillText(String(i + 1), x0 + 3, 10);
      const s1 = avChopUiNumOr(sl.s1, 0);
      if (s1 > tail) tail = s1;
      drawn += 1;
    }
    if (tail > 0) {
      const xt = avChopUiX(tail, nF, w);
      g.fillStyle = "rgba(46,216,201,0.55)";
      g.fillRect(xt, 0, 1, h);
    }
    return drawn;
  } catch (e) { return drawn; }
}

function avChopUiDraw() {
  try {
    const s = avChopUiState;
    const c = (s.canvas && s.canvas.isConnected !== false) ? s.canvas : avChopUiCanvasEl();
    if (!c || typeof c.getContext !== "function") return false;
    s.canvas = c;
    const box = avChopUiRefit(c);
    const g = c.getContext("2d");
    if (!g) return false;
    const w = box.w, h = box.h;
    g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const mid = h / 2;
    const amp = (h / 2) * 0.92;                  /* the av_sample 8% headroom law */
    g.fillStyle = "rgba(46,216,201,0.16)";
    g.fillRect(0, mid - 0.5, w, 1);              /* the quiet zero line */
    const entry = avChopUiEntry(s.srcId);
    const frames = avChopUiFramesOf(entry);
    if (entry) avChopUiDrawWave(g, entry, w, h, mid, amp);
    if (s.kit && s.kit.slices && typeof s.kit.slices.length === "number" && String(s.kit.srcId) === s.srcId) {
      const nF = frames > 0 ? frames : avChopUiMaxS1(s.kit);
      avChopUiDrawMarkers(g, s.kit, w, h, nF);
    }
    if (!entry) {
      try { g.font = "11px monospace"; } catch (e) { /* font refusal */ }
      g.fillStyle = "rgba(160,170,182,0.85)";
      g.fillText(avChopUiNoEntryText(avChopUiStoreEntries().length), 10, mid + 4);
    }
    s.draws += 1;
    return true;
  } catch (e) {
    try { avChopUiState.lastError = String((e && e.message) || e); } catch (e2) { /* ok */ }
    return false;
  }
}

function avChopUiNoEntryText(n) {
  return n > 0
    ? "pick a source and press DETECT"
    : "no samples \u2014 import audio in the SAMPLE card";
}

function avChopUiRequestDraw() {
  const s = avChopUiState;
  try {
    if (typeof requestAnimationFrame === "function") {
      if (!s.raf) s.raf = requestAnimationFrame(function () { s.raf = 0; avChopUiDraw(); });
      return true;
    }
  } catch (e) { /* no raf */ }
  return avChopUiDraw();
}

function avChopUiBindCanvas() {
  const s = avChopUiState;
  try {
    if (typeof ResizeObserver === "function") {
      const c = avChopUiCanvasEl();
      if (s.obs && s.obsCanvas !== c) { try { s.obs.disconnect(); } catch (e) { /* gone */ } s.obs = null; }
      if (c && s.obsCanvas !== c) {
        s.obs = new ResizeObserver(function () { avChopUiRequestDraw(); });
        s.obs.observe(c);
        s.obsCanvas = c;
      }
    }
  } catch (e) { /* no RO: the window resize fallback covers it */ }
  if (!s.resizeWired) {
    try {
      const w = avChopUiWin();
      if (w && typeof w.addEventListener === "function") {
        s.resizeWired = true;
        w.addEventListener("resize", function () { avChopUiRequestDraw(); });
      }
    } catch (e) { /* no window */ }
  }
  return true;
}

/* ---------- actions ---------- */

/* read the live controls into the module mirror (the user may have typed without a change event) */
function avChopUiReadCtl(host) {
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const s = avChopUiState;
    const src = host.querySelector("#av-chop-src");
    if (src && typeof src.value === "string" && src.value) s.srcId = src.value;
    const sens = host.querySelector("#av-chop-sens");
    if (sens && sens.value !== "" && isFinite(Number(sens.value))) s.sens = avChopUiClamp(Number(sens.value) / 100, 0, 1);
    if (s.kit) {
      const slot = host.querySelector("#av-chop-slot");
      if (slot && isFinite(Number(slot.value))) avChopUiKitMap(s.kit, { slot: avChopUiInt(slot.value, 0, AV_CHOP_UI_SLOTS - 1, 0) });
      const base = host.querySelector("#av-chop-base");
      if (base && base.value !== "" && isFinite(Number(base.value))) avChopUiKitMap(s.kit, { base: avChopUiInt(base.value, 0, AV_CHOP_UI_BASE_MAX, AV_CHOP_UI_BASE_DEF) });
    }
    return true;
  } catch (e) { return false; }
}

function avChopUiDetect() {
  const host = avChopUiHost();
  try {
    const s = avChopUiState;
    avChopUiReadCtl(host);
    if (!s.srcId) {
      avChopUiSetStatus("no source \u2014 import audio in the SAMPLE card first", "err");
      return false;
    }
    if (typeof avChopDetect !== "function") {
      avChopUiSetStatus("the chop core (av_chop.js) is not present \u2014 DETECT is unavailable", "err");
      return false;
    }
    let det = null;
    try { det = avChopDetect(s.srcId, { sensitivity: avChopUiClamp(s.sens, 0, 1) }); }
    catch (e) { det = { ok: false, error: avChopUiErrText(e, "the detect failed") }; }
    if (!det || typeof det !== "object" || det.ok !== true) {
      const err = avChopUiErrText(det, "the core refused the detect");
      s.det = { done: false, count: 0, onsets: 0, dropped: 0, error: err };
      avChopUiSetStatus("detect refused \u2014 " + err, "err");
      return false;
    }
    const count = (det.slices && typeof det.slices.length === "number") ? (det.slices.length | 0) : 0;
    const onsets = (det.onsets && typeof det.onsets.length === "number") ? (det.onsets.length | 0) : count;
    const dropped = isFinite(Number(det.dropped)) ? Math.max(0, Math.round(Number(det.dropped))) : 0;
    s.det = { done: true, count: count, onsets: onsets, dropped: dropped, error: "" };
    const built = avChopUiBuildKit(s.srcId, det, { sensitivity: avChopUiClamp(s.sens, 0, 1) });
    if (!built || !built.kit || !built.kit.slices || typeof built.kit.slices.length !== "number") {
      avChopUiSetStatus("detect found " + count + " slices but no kit could be built \u2014 the core returned no slices", "err");
      return false;
    }
    s.kit = built.kit;
    s.kitLocal = !!built.local;
    const kid = (typeof built.kit.srcId === "string" && built.kit.srcId) ? built.kit.srcId : s.srcId;
    s.srcId = kid;
    avChopUiPaintRows(host, true);
    avChopUiPaintMap(host);
    avChopUiPaintPads(host);
    avChopUiPaintCanvasCap(host);
    avChopUiRequestDraw();
    const mk = Math.min(16, built.kit.slices.length | 0);
    const base = avChopUiBaseOf();
    const note = avChopUiNoteName(base);
    avChopUiSetStatus(
      "detected " + count + " slices \u2192 kit " + mk + "/16" +
      (built.local ? " \u00b7 built locally" : "") +
      " \u00b7 base " + base + (note ? " (" + note + ")" : "") +
      (dropped ? " \u00b7 dropped " + dropped : ""),
      "msg");
    return true;
  } catch (e) {
    avChopUiSetStatus("detect failed \u2014 " + avChopUiErrText(e, "unexpected"), "err");
    return false;
  }
}

function avChopUiFinishApply(r0) {
  const s = avChopUiState;
  try {
    const r = (r0 && typeof r0 === "object") ? r0 : {};
    if (r.ok !== true) {
      const err = avChopUiErrText(r, "the core refused");
      s.applied = { done: false, slot: null, slices: 0, error: err };
      avChopUiSetStatus("apply refused \u2014 " + err, "err");
      return false;
    }
    const n = isFinite(Number(r.slices)) ? Math.max(0, Math.round(Number(r.slices))) : avChopUiActiveCount(s.kit);
    const slot = isFinite(Number(r.slot)) ? avChopUiInt(r.slot, 0, AV_CHOP_UI_SLOTS - 1, 0) : avChopUiInt(s.kit && s.kit.slot, 0, AV_CHOP_UI_SLOTS - 1, 0);
    s.applied = { done: true, slot: slot, slices: n, error: "" };
    avChopUiSetStatus("applied: " + n + " slices \u2192 slot " + slot, "msg");
    return true;
  } catch (e) {
    avChopUiSetStatus("apply failed \u2014 " + avChopUiErrText(e, "unexpected"), "err");
    return false;
  }
}

function avChopUiApply() {
  try {
    const s = avChopUiState;
    const host = avChopUiHost();
    avChopUiReadCtl(host);
    if (!s.kit) { avChopUiSetStatus("no kit \u2014 press DETECT first", "err"); return false; }
    if (typeof avChopApply !== "function") {
      avChopUiSetStatus("the chop core (av_chop.js) is not present \u2014 APPLY is unavailable", "err");
      return false;
    }
    let r = null;
    try { r = avChopApply(s.kit); }
    catch (e) { r = { ok: false, error: avChopUiErrText(e, "the apply failed") }; }
    if (r && typeof r.then === "function") {
      avChopUiSetStatus("applying\u2026", "msg");
      try {
        r.then(function (x) { avChopUiFinishApply(x); }, function (e) { avChopUiFinishApply({ ok: false, error: avChopUiErrText(e, "the apply failed") }); });
      } catch (e2) { /* then refused — the sync receipt stands */ }
      return true;
    }
    return avChopUiFinishApply(r);
  } catch (e) {
    avChopUiSetStatus("apply failed \u2014 " + avChopUiErrText(e, "unexpected"), "err");
    return false;
  }
}

function avChopUiFinishSteps(r0, track, start) {
  const s = avChopUiState;
  try {
    const r = (r0 && typeof r0 === "object") ? r0 : {};
    if (r.ok !== true) {
      const err = avChopUiErrText(r, "the core refused");
      s.stepped = { done: false, written: 0, dropped: 0, track: track, start: start, error: err };
      avChopUiSetStatus("steps refused \u2014 " + err, "err");
      return false;
    }
    const w = isFinite(Number(r.written)) ? Math.max(0, Math.round(Number(r.written))) : 0;
    const d = isFinite(Number(r.dropped)) ? Math.max(0, Math.round(Number(r.dropped))) : 0;
    s.stepped = { done: true, written: w, dropped: d, track: track, start: start, error: "" };
    avChopUiSetStatus("wrote " + w + " steps \u2192 T" + (track + 1) + "@" + start + (d > 0 ? " \u00b7 dropped " + d : ""), "msg");
    return true;
  } catch (e) {
    avChopUiSetStatus("steps failed \u2014 " + avChopUiErrText(e, "unexpected"), "err");
    return false;
  }
}

function avChopUiSteps() {
  try {
    const s = avChopUiState;
    const host = avChopUiHost();
    avChopUiReadCtl(host);
    if (!s.kit) { avChopUiSetStatus("no kit \u2014 press DETECT first", "err"); return false; }
    if (typeof avChopToSteps !== "function") {
      avChopUiSetStatus("the chop core (av_chop.js) is not present \u2014 SLICE\u2192STEPS is unavailable", "err");
      return false;
    }
    const trkEl = (host && typeof host.querySelector === "function") ? host.querySelector("#av-chop-steps-track") : null;
    const stEl = (host && typeof host.querySelector === "function") ? host.querySelector("#av-chop-steps-start") : null;
    const track = avChopUiInt(trkEl ? trkEl.value : 0, 0, AV_CHOP_UI_SLOTS - 1, 0);
    const start = avChopUiInt(stEl ? stEl.value : 0, 0, AV_CHOP_UI_START_MAX, 0);
    let r = null;
    try { r = avChopToSteps(s.kit, { track: track, start: start }); }
    catch (e) { r = { ok: false, error: avChopUiErrText(e, "the write failed") }; }
    if (r && typeof r.then === "function") {
      avChopUiSetStatus("writing steps\u2026", "msg");
      try {
        r.then(function (x) { avChopUiFinishSteps(x, track, start); }, function (e) { avChopUiFinishSteps({ ok: false, error: avChopUiErrText(e, "the write failed") }, track, start); });
      } catch (e2) { /* then refused — the sync receipt stands */ }
      return true;
    }
    return avChopUiFinishSteps(r, track, start);
  } catch (e) {
    avChopUiSetStatus("steps failed \u2014 " + avChopUiErrText(e, "unexpected"), "err");
    return false;
  }
}

function avChopUiPatchDesc(patch) {
  const parts = [];
  try {
    if ("trim0" in patch) parts.push("trim start " + patch.trim0);
    if ("trim1" in patch) parts.push("trim end " + patch.trim1);
    if ("fadeIn" in patch) parts.push("fade in " + patch.fadeIn + " ms");
    if ("fadeOut" in patch) parts.push("fade out " + patch.fadeOut + " ms");
    if ("gainDb" in patch) parts.push("gain " + patch.gainDb + " dB");
    if ("norm" in patch) parts.push(patch.norm ? "norm on" : "norm off");
    if ("on" in patch) parts.push(patch.on ? "active" : "muted");
  } catch (e) { /* none */ }
  return parts.length ? parts.join(" \u00b7 ") : "edited";
}

function avChopUiPatchSlice(i, patch) {
  const s = avChopUiState;
  if (!s.kit || !s.kit.slices || !s.kit.slices[i]) {
    avChopUiSetStatus("no kit \u2014 press DETECT first", "err");
    return false;
  }
  if (typeof avChopSliceEdit !== "function") {
    avChopUiSetStatus("the chop core (av_chop.js) is not present \u2014 edits are unavailable", "err");
    return false;
  }
  let ok = false;
  try { ok = (avChopSliceEdit(s.kit, i, patch) !== false); } catch (e) { ok = false; }
  if (!ok) {
    avChopUiSetStatus("edit refused \u2014 the core refused slice " + (i + 1), "err");
    avChopUiPaintRows(avChopUiHost(), false);
    return false;
  }
  s.edits += 1;
  const host = avChopUiHost();
  avChopUiPaintRows(host, false);
  avChopUiPaintCanvasCap(host);
  avChopUiRequestDraw();
  avChopUiSetStatus("slice " + (i + 1) + ": " + avChopUiPatchDesc(patch), "msg");
  return true;
}

/* ---------- pads (down/up through the note bus, guarded) ---------- */

function avChopUiPadDown(i) {
  const s = avChopUiState;
  try {
    const idx = avChopUiInt(i, 0, AV_CHOP_UI_PADS - 1, -1);
    if (idx < 0) return false;
    for (let k = 0; k < s.held.length; k++) if (s.held[k].pad === idx) return true;   /* already down */
    const name = avChopUiNoteName(avChopUiBaseOf() + idx);
    if (typeof avNoteDown !== "function" || typeof avNoteUp !== "function" || !name) {
      avChopUiSetStatus("the note bus (av_note.js) is not present \u2014 pads are unavailable", "err");
      return false;
    }
    let r = null;
    try { r = avNoteDown(name); } catch (e) { r = false; }
    if (r === false) return false;        /* the bus refused / the note is held elsewhere */
    s.held.push({ pad: idx, name: name });
    s.padTouchAt = Date.now();
    const el = avChopUiPadEl(idx);
    if (el) {
      if (typeof el.setAttribute === "function") el.setAttribute("data-on", "1");
      if (el.classList) el.classList.add("av-chop-pad-on");
    }
    return true;
  } catch (e) { return false; }
}

function avChopUiPadUp(i) {
  const s = avChopUiState;
  try {
    const idx = avChopUiInt(i, 0, AV_CHOP_UI_PADS - 1, -1);
    for (let k = 0; k < s.held.length; k++) {
      if (s.held[k].pad === idx) {
        const h = s.held[k];
        s.held.splice(k, 1);
        s.padTouchAt = Date.now();
        try { if (typeof avNoteUp === "function") avNoteUp(h.name); } catch (e) { /* bus gone */ }
        const el = avChopUiPadEl(idx);
        if (el) {
          if (typeof el.removeAttribute === "function") el.removeAttribute("data-on");
          if (el.classList) el.classList.remove("av-chop-pad-on");
        }
        return true;
      }
    }
    return false;
  } catch (e) { return false; }
}

/* a click that did NOT come from our own press (keyboard / synthetic) plays a short blip */
function avChopUiPadClick(i) {
  const s = avChopUiState;
  try {
    if (Date.now() - (s.padTouchAt || 0) < AV_CHOP_UI_CLICK_MS) return false;
    if (!avChopUiPadDown(i)) return false;
    if (typeof setTimeout === "function") {
      s.padBlip = setTimeout(function () {
        s.padBlip = null;
        avChopUiPadUp(i);
      }, AV_CHOP_UI_BLIP_MS);
    } else {
      avChopUiPadUp(i);
    }
    return true;
  } catch (e) { return false; }
}

function avChopUiPadsReleaseAll() {
  const s = avChopUiState;
  try {
    if (s.padBlip != null) {
      try { if (typeof clearTimeout === "function") clearTimeout(s.padBlip); } catch (e) { /* gone */ }
      s.padBlip = null;
    }
    const held = s.held.slice();
    for (let k = 0; k < held.length; k++) avChopUiPadUp(held[k].pad);
    return held.length > 0;
  } catch (e) { return false; }
}

function avChopUiBindPads(host) {
  try {
    const box = (host && typeof host.querySelector === "function") ? host.querySelector("#av-chop-pads") : null;
    if (!box || typeof box.querySelectorAll !== "function") return false;
    const pads = box.querySelectorAll(".av-chop-pad[data-pad]");
    const usePointer = (function () {
      try {
        const w = avChopUiWin();
        if (w && typeof w.PointerEvent === "function") return true;
      } catch (e) { /* none */ }
      return false;
    })();
    for (let k = 0; k < pads.length; k++) {
      const el = pads[k];
      if (!el || typeof el.addEventListener !== "function") continue;
      if (el.dataset && el.dataset.avChopPad === "1") continue;      /* bound on a previous mount */
      try { if (el.dataset) el.dataset.avChopPad = "1"; } catch (e) { continue; }
      const idx = avChopUiInt(el.getAttribute("data-pad"), 0, AV_CHOP_UI_PADS - 1, 0);
      const down = function () { avChopUiPadDown(idx); };
      const up = function () { avChopUiPadUp(idx); };
      if (usePointer) {
        el.addEventListener("pointerdown", down);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
        el.addEventListener("pointerleave", up);
      } else {
        el.addEventListener("mousedown", down);
        el.addEventListener("mouseup", up);
        el.addEventListener("mouseleave", up);
      }
      el.addEventListener("keydown", function (ev) {
        try {
          if (!ev || ev.repeat) return;
          if (ev.key === " " || ev.key === "Enter" || ev.key === "Spacebar") {
            if (typeof ev.preventDefault === "function") ev.preventDefault();
            avChopUiPadDown(idx);
          }
        } catch (e) { /* a listener never throws outward */ }
      });
      el.addEventListener("keyup", function (ev) {
        try {
          if (!ev) return;
          if (ev.key === " " || ev.key === "Enter" || ev.key === "Spacebar") avChopUiPadUp(idx);
        } catch (e) { /* a listener never throws outward */ }
      });
      el.addEventListener("click", function () { avChopUiPadClick(idx); });
    }
    return true;
  } catch (e) { return false; }
}

/* ---------- event wiring (one delegation per host) ---------- */

function avChopUiOnClick(ev) {
  try {
    const t = ev && ev.target;
    if (!t || typeof t.closest !== "function") return;
    let el;
    el = t.closest("#av-chop-detect");
    if (el) { avChopUiDetect(); return; }
    el = t.closest("#av-chop-apply");
    if (el) { avChopUiApply(); return; }
    el = t.closest("#av-chop-steps");
    if (el) { avChopUiSteps(); return; }
    el = t.closest("#av-chop-refresh");
    if (el) {
      const host = avChopUiHost();
      avChopUiPaintSrc(host, true);
      avChopUiSetStatus("source list refreshed \u2014 " + avChopUiStoreEntries().length + " sample(s)", "msg");
      return;
    }
  } catch (e) { /* a listener never throws outward */ }
}

/* route one slice-row field to avChopSliceEdit (used by input AND change — the rig may fire
   either; a repeated commit of the same value is idempotent on the core) */
function avChopUiRowField(t) {
  try {
    if (!t || typeof t.closest !== "function") return false;
    const row = t.closest("[data-slice-idx]");
    if (!row) return false;
    const i = avChopUiInt(row.getAttribute("data-slice-idx"), 0, 15, -1);
    if (i < 0) return false;
    const f = String(t.getAttribute && t.getAttribute("data-chop-field") || "");
    if (f === "trim0" || f === "trim1" || f === "fadeIn" || f === "fadeOut" || f === "gainDb") {
      if (String(t.value == null ? "" : t.value).trim() === "") return false;
      const n = Number(t.value);
      if (!isFinite(n)) {
        avChopUiPaintRows(avChopUiHost(), false);
        avChopUiSetStatus("ignored \u2014 not a number", "err");
        return false;
      }
      const patch = {};
      patch[f] = n;
      return avChopUiPatchSlice(i, patch);
    }
    if (f === "norm") return avChopUiPatchSlice(i, { norm: !!t.checked });
    if (f === "on") return avChopUiPatchSlice(i, { on: t.checked ? 1 : 0 });
  } catch (e) { /* a listener never throws outward */ }
  return false;
}

function avChopUiOnInput(ev) {
  try {
    const t = ev && ev.target;
    if (!t) return;
    const s = avChopUiState;
    if (t.id === "av-chop-sens") {
      s.sens = avChopUiClamp(Number(t.value) / 100, 0, 1);
      avChopUiPaintSens(avChopUiHost());
      return;
    }
    if (t.type === "number") avChopUiRowField(t);
  } catch (e) { /* a listener never throws outward */ }
}

function avChopUiOnChange(ev) {
  try {
    const t = ev && ev.target;
    if (!t || typeof t.closest !== "function") return;
    const s = avChopUiState;
    if (t.id === "av-chop-src") {
      s.srcId = String(t.value || "");
      const e = avChopUiEntry(s.srcId);
      const name = (e && typeof e.name === "string" && e.name) ? e.name : (s.srcId || "none");
      if (s.kit && String(s.kit.srcId) !== s.srcId) {
        const ke = avChopUiEntry(s.kit.srcId);
        const kn = (ke && typeof ke.name === "string" && ke.name) ? ke.name : String(s.kit.srcId || "another sample");
        avChopUiSetStatus("source: " + name + " \u2014 the kit is for " + kn + "; press DETECT to rebuild", "msg");
      } else {
        avChopUiSetStatus("source: " + name + " \u00b7 " + avChopUiFramesOf(e) + " frames", "msg");
      }
      avChopUiPaintCanvasCap(avChopUiHost());
      avChopUiRequestDraw();
      return;
    }
    if (t.id === "av-chop-slot") {
      if (!s.kit) { avChopUiSetStatus("no kit \u2014 press DETECT first", "err"); avChopUiPaintMap(avChopUiHost()); return; }
      avChopUiKitMap(s.kit, { slot: avChopUiInt(t.value, 0, AV_CHOP_UI_SLOTS - 1, 0) });
      avChopUiSetStatus("slot " + avChopUiInt(s.kit.slot, 0, AV_CHOP_UI_SLOTS - 1, 0) + " \u2014 press APPLY KIT to send the kit", "msg");
      avChopUiPaintMap(avChopUiHost());
      return;
    }
    if (t.id === "av-chop-base") {
      if (!s.kit) { avChopUiSetStatus("no kit \u2014 press DETECT first", "err"); avChopUiPaintMap(avChopUiHost()); return; }
      avChopUiKitMap(s.kit, { base: avChopUiInt(t.value, 0, AV_CHOP_UI_BASE_MAX, AV_CHOP_UI_BASE_DEF) });
      const nb = avChopUiInt(s.kit.base, 0, AV_CHOP_UI_BASE_MAX, AV_CHOP_UI_BASE_DEF);
      const note = avChopUiNoteName(nb);
      avChopUiSetStatus("base " + nb + (note ? " (" + note + ")" : "") + " \u2014 pads and SLICE\u2192STEPS follow it", "msg");
      avChopUiPaintMap(avChopUiHost());
      avChopUiPaintPads(avChopUiHost());
      avChopUiPaintRows(avChopUiHost(), false);
      avChopUiPaintCanvasCap(avChopUiHost());
      avChopUiRequestDraw();
      return;
    }
    if (t.id === "av-chop-steps-track") {
      try { t.value = String(avChopUiInt(t.value, 0, AV_CHOP_UI_SLOTS - 1, 0)); } catch (e) { /* ok */ }
      return;
    }
    if (t.id === "av-chop-steps-start") {
      try { t.value = String(avChopUiInt(t.value, 0, AV_CHOP_UI_START_MAX, 0)); } catch (e) { /* ok */ }
      return;
    }
    avChopUiRowField(t);
  } catch (e) { /* a listener never throws outward */ }
}

function avChopUiWireHost(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  try {
    if (host.dataset && host.dataset.avChopWired === "1") return true;
    if (host.dataset) host.dataset.avChopWired = "1";
    host.addEventListener("click", avChopUiOnClick);
    host.addEventListener("input", avChopUiOnInput);
    host.addEventListener("change", avChopUiOnChange);
    return true;
  } catch (e) { return false; }
}

function avChopUiWireWindow() {
  const s = avChopUiState;
  if (s.blurWired) return true;
  try {
    const w = avChopUiWin();
    if (w && typeof w.addEventListener === "function") {
      s.blurWired = true;
      w.addEventListener("blur", function () { avChopUiPadsReleaseAll(); });
    }
    return s.blurWired;
  } catch (e) { return false; }
}

/* ---------- markup (pure string builders) ---------- */

function avChopUiPadHTML(i) {
  const base = avChopUiBaseOf();
  const note = avChopUiNoteName(base + i);
  const txt = note || String(base + i);
  return '<button type="button" class="av-btn av-chop-pad" data-pad="' + i + '"' +
    ' title="' + avChopUiEsc("pad " + (i + 1) + " \u2014 plays " + txt) +
    '" aria-label="' + avChopUiEsc("Pad " + (i + 1) + " \u2014 plays " + txt) + '">' +
    '<span class="av-chop-pad-lbl">' + (i + 1) + "</span>" +
    '<span class="av-chop-pad-note">' + avChopUiEsc(txt) + "</span></button>";
}

function avChopUiBodyHTML() {
  const s = avChopUiState;
  const px = Math.round(avChopUiClamp(s.sens, 0, 1) * 100);
  let pads = "";
  for (let i = 0; i < AV_CHOP_UI_PADS; i++) pads += avChopUiPadHTML(i);
  let slotOpts = "";
  for (let i = 0; i < AV_CHOP_UI_SLOTS; i++) slotOpts += '<option value="' + i + '">' + i + "</option>";
  let trkOpts = "";
  for (let i = 0; i < AV_CHOP_UI_SLOTS; i++) trkOpts += '<option value="' + i + '">T' + (i + 1) + "</option>";
  return '<div class="av-chop" data-av-chop="1">' +
    '<div class="av-chop-head"><span class="av-chop-title">CHOP</span>' +
    '<span class="av-chop-cap av-dim">detect slices in a sample \u00b7 trim / fade / normalise each one \u00b7 APPLY as a 16-zone kit on a sampler slot \u00b7 SLICE\u2192STEPS writes the active slices to the sequencer.</span></div>' +
    '<div class="av-chop-status-line"><span class="av-chop-status av-chop-msg" id="av-chop-status" role="status" aria-live="polite">' + avChopUiEsc(s.status) + "</span></div>" +
    '<div class="av-chop-srcsec">' +
    '<label class="av-chop-lbl" for="av-chop-src">SOURCE</label>' +
    '<select class="av-select av-chop-select" id="av-chop-src" aria-label="Sample to chop"></select>' +
    '<button type="button" class="av-btn mini av-chop-btn" id="av-chop-refresh" title="refresh the source list from the sample store">\u27f3</button>' +
    '<label class="av-chop-lbl" for="av-chop-sens">SENS</label>' +
    '<input class="av-chop-range" id="av-chop-sens" type="range" min="0" max="100" step="1" value="' + px + '" aria-label="Detection sensitivity">' +
    '<span class="av-chop-sens-val av-dim" id="av-chop-sens-val">' + px + "%</span>" +
    '<button type="button" class="av-btn av-chop-btn" id="av-chop-detect" title="detect onsets and build the kit">DETECT</button>' +
    "</div>" +
    '<div class="av-chop-stage">' +
    '<canvas class="av-chop-canvas" id="av-chop-canvas" width="1200" height="168" role="img" aria-label="Sample waveform with slice markers"></canvas>' +
    '<span class="av-chop-canvas-cap av-dim" id="av-chop-canvas-cap"></span></div>' +
    '<div class="av-chop-maprow">' +
    '<label class="av-chop-lbl" for="av-chop-slot">SLOT</label>' +
    '<select class="av-select av-chop-select av-chop-slot" id="av-chop-slot" aria-label="Sampler slot 0-3">' + slotOpts + "</select>" +
    '<label class="av-chop-lbl" for="av-chop-base">BASE</label>' +
    '<input class="av-chop-num av-chop-base" id="av-chop-base" type="number" min="0" max="108" step="1" value="' + avChopUiBaseOf() + '" aria-label="Base note (MIDI 0-108)">' +
    '<span class="av-chop-mapnote av-dim" id="av-chop-mapnote"></span></div>' +
    '<div class="av-chop-slices" id="av-chop-slices"></div>' +
    '<div class="av-chop-pads" id="av-chop-pads">' + pads + "</div>" +
    '<div class="av-chop-actions">' +
    '<button type="button" class="av-btn av-chop-btn" id="av-chop-apply" title="send the kit to the engine (zones on a sampler slot)">APPLY KIT</button>' +
    '<button type="button" class="av-btn av-chop-btn" id="av-chop-steps" title="write one step per active slice to the sequencer">SLICE\u2192STEPS</button>' +
    '<label class="av-chop-lbl" for="av-chop-steps-track">TRACK</label>' +
    '<select class="av-select av-chop-select av-chop-steps-track" id="av-chop-steps-track" aria-label="Sequencer track 1-4">' + trkOpts + "</select>" +
    '<label class="av-chop-lbl" for="av-chop-steps-start">START</label>' +
    '<input class="av-chop-num av-chop-steps-start" id="av-chop-steps-start" type="number" min="0" max="63" step="1" value="0" aria-label="First step index (0-63)">' +
    "</div>" +
    '<p class="av-note av-dim av-chop-note">The kit holds up to 16 slices mapped from BASE upward \u00b7 pads play the mapped notes through the note bus \u00b7 everything stays on this machine.</p>' +
    "</div>";
}

/* the parent's own `#av-chop` card element: this root takes the id only when no such element
   exists (never a duplicate id) — the av_files_ui / av_wt_ui idiom */
function avChopUiEnsureRootId(card) {
  try {
    if (!card || card.id) return false;
    const d = avChopUiDoc();
    const existing = (d && typeof d.getElementById === "function") ? d.getElementById("av-chop") : null;
    if (existing && existing !== card) return false;
    card.id = "av-chop";
    return true;
  } catch (e) { return false; }
}

/* ---------- init / sync / snap / classes ---------- */

function avChopUiInit() {
  const host = avChopUiHost();
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const s = avChopUiState;
    let card = null;
    try { card = host.querySelector(".av-chop"); } catch (e) { card = null; }
    if (!card) {
      s.memo = { text: {}, cls: {} };
      s.srcSig = "\u0000";              /* a fresh select needs a rebuild, whatever the ids */
      s.rowsKit = null;
      s.rowsCount = -1;                 /* a fresh slices box needs its first paint        */
      host.innerHTML = avChopUiBodyHTML();
      try { card = host.querySelector(".av-chop"); } catch (e2) { card = null; }
    }
    avChopUiEnsureRootId(card);
    avChopUiWireHost(host);
    avChopUiBindPads(host);
    avChopUiBindCanvas();
    avChopUiWireWindow();
    s.inited = true;
    s.mounts += 1;
    avChopUiPaintSrc(host, false);
    if (!s.status) {
      const cores = avChopUiCores();
      if (!cores.detect) {
        avChopUiSetStatus("the chop core (av_chop.js) is not present \u2014 the card mounts and every action refuses honestly", "err");
      } else if (!avChopUiStoreEntries().length) {
        avChopUiSetStatus("no samples \u2014 import audio in the SAMPLE card, then press DETECT", "msg");
      } else {
        avChopUiSetStatus("ready \u2014 pick a source and press DETECT", "msg");
      }
    }
    avChopUiSync(host);
    return true;
  } catch (e) {
    try { avChopUiState.lastError = String((e && e.message) || e); } catch (e2) { /* ok */ }
    return false;
  }
}

function avChopUiSync(root) {
  let host = root || null;
  if (!host) host = avChopUiHost();
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    if (!host.querySelector(".av-chop")) return false;
    avChopUiPaintStatus(host);
    avChopUiPaintSrc(host, false);
    avChopUiPaintSens(host);
    avChopUiPaintMap(host);
    avChopUiPaintRows(host, false);
    avChopUiPaintPads(host);
    avChopUiPaintCanvasCap(host);
    avChopUiRequestDraw();
    return true;
  } catch (e) { return false; }
}

function avChopUiSnap() {
  const host = avChopUiHost();
  const s = avChopUiState;
  const out = {
    version: AV_CHOP_UI_VERSION,
    inited: !!s.inited,
    mounts: s.mounts,
    host: !!host,
    wired: !!(host && host.dataset && host.dataset.avChopWired === "1"),
    card: false,
    cores: avChopUiCores(),
    samples: { count: 0, max: 0, entries: [] },
    srcId: s.srcId || "",
    sens: avChopUiClamp(s.sens, 0, 1),
    kit: null,
    slices: [],
    detect: s.det ? { done: !!s.det.done, count: avChopUiInt(s.det.count, 0, 1e9, 0), onsets: avChopUiInt(s.det.onsets, 0, 1e9, 0), dropped: avChopUiInt(s.det.dropped, 0, 1e9, 0), error: String(s.det.error || "") } : null,
    apply: s.applied ? { done: !!s.applied.done, slot: (s.applied.slot == null ? null : avChopUiInt(s.applied.slot, 0, AV_CHOP_UI_SLOTS - 1, 0)), slices: avChopUiInt(s.applied.slices, 0, 1e9, 0), error: String(s.applied.error || "") } : null,
    steps: s.stepped ? { done: !!s.stepped.done, written: avChopUiInt(s.stepped.written, 0, 1e9, 0), dropped: avChopUiInt(s.stepped.dropped, 0, 1e9, 0), track: avChopUiInt(s.stepped.track, 0, AV_CHOP_UI_SLOTS - 1, 0), start: avChopUiInt(s.stepped.start, 0, AV_CHOP_UI_START_MAX, 0), error: String(s.stepped.error || "") } : null,
    pads: { count: AV_CHOP_UI_PADS, held: [], base: avChopUiBaseOf(), notes: [] },
    canvas: { present: false, w: 0, h: 0, dpr: s.dpr, draws: s.draws },
    edits: s.edits,
    status: s.status,
    statusKind: s.statusKind,
    lastError: s.lastError || "",
    controls: {
      src: false, refresh: false, detect: false, sens: false, canvas: false, slices: false,
      slot: false, base: false, mapnote: false, pads: false, apply: false, steps: false,
      stepsTrack: false, stepsStart: false, status: false, canvasCap: false,
    },
    classes: avChopUiClasses(),
  };
  try {
    const list = avChopUiStoreEntries();
    out.samples.count = list.length;
    out.samples.entries = list.slice(0, 64);
    if (typeof avSampleStore !== "undefined" && avSampleStore && isFinite(Number(avSampleStore.max))) {
      out.samples.max = Number(avSampleStore.max);
    }
  } catch (e) { /* no store */ }
  try {
    for (let k = 0; k < s.held.length; k++) out.pads.held.push(avChopUiInt(s.held[k].pad, 0, AV_CHOP_UI_PADS - 1, 0));
  } catch (e) { /* none */ }
  try {
    for (let i = 0; i < AV_CHOP_UI_PADS; i++) out.pads.notes.push(avChopUiNoteName(out.pads.base + i));
  } catch (e) { /* none */ }
  try {
    if (s.kit && s.kit.slices && typeof s.kit.slices.length === "number") {
      const k = s.kit;
      out.kit = {
        srcId: String(k.srcId == null ? "" : k.srcId),
        slot: avChopUiInt(k.slot, 0, AV_CHOP_UI_SLOTS - 1, 0),
        base: avChopUiBaseOf(),
        sliceCount: Math.min(16, k.slices.length | 0),
        active: avChopUiActiveCount(k),
        local: !!s.kitLocal,
      };
      for (let i = 0; i < k.slices.length && i < 16; i++) {
        const sl = k.slices[i] || {};
        out.slices.push({
          i: i,
          s0: Math.round(avChopUiNumOr(sl.s0, 0)),
          s1: Math.round(avChopUiNumOr(sl.s1, 0)),
          trim0: Math.round(avChopUiNumOr(sl.trim0, 0)),
          trim1: Math.round(avChopUiNumOr(sl.trim1, 0)),
          fadeIn: avChopUiNumOr(sl.fadeIn, 0),
          fadeOut: avChopUiNumOr(sl.fadeOut, 0),
          gainDb: avChopUiNumOr(sl.gainDb, 0),
          norm: !!sl.norm,
          on: Number(sl.on) ? 1 : 0,
        });
      }
    }
  } catch (e) { /* kit vanished */ }
  try {
    if (host && typeof host.querySelector === "function") {
      out.card = !!host.querySelector(".av-chop");
      const q = function (sel) { return !!host.querySelector(sel); };
      out.controls.src = q("#av-chop-src");
      out.controls.refresh = q("#av-chop-refresh");
      out.controls.detect = q("#av-chop-detect");
      out.controls.sens = q("#av-chop-sens");
      out.controls.canvas = q("#av-chop-canvas");
      out.controls.slices = q("#av-chop-slices");
      out.controls.slot = q("#av-chop-slot");
      out.controls.base = q("#av-chop-base");
      out.controls.mapnote = q("#av-chop-mapnote");
      out.controls.pads = q("#av-chop-pads");
      out.controls.apply = q("#av-chop-apply");
      out.controls.steps = q("#av-chop-steps");
      out.controls.stepsTrack = q("#av-chop-steps-track");
      out.controls.stepsStart = q("#av-chop-steps-start");
      out.controls.status = q("#av-chop-status");
      out.controls.canvasCap = q("#av-chop-canvas-cap");
      const c = host.querySelector("#av-chop-canvas");
      if (c) {
        out.canvas.present = true;
        out.canvas.w = Number(c.width) || 0;
        out.canvas.h = Number(c.height) || 0;
      }
    }
  } catch (e) { /* no DOM */ }
  return out;
}

function avChopUiClasses() {
  return AV_CHOP_UI_CLASSES.slice();
}

/* ---------- debug/verify handle (rigs + parent call these; names are the contract) ---------- */

if (typeof window !== "undefined") {
  try {
    window.__avChopUi = {
      version: AV_CHOP_UI_VERSION,
      init: function () { return avChopUiInit(); },
      snap: function () { return avChopUiSnap(); },
      classes: function () { return avChopUiClasses(); },
      sync: function (root) { return avChopUiSync(root); },
    };
  } catch (e) { /* no window — nothing to publish */ }
}
