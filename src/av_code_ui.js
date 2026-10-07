/* Anvil — CODE card (S5 wave, child sa-C): the open module API UI (#81) mounted into the
   parent-owned host `#av-code-host` (the parent adds the `#av-code` card at integration and
   calls avCodeUiInit() in the boot block, like the other cards; this module only fills the
   host). Per verify/_s5_wave.md §2.C, against the engine facade pinned in §2.B
   (src/av_code.js, authored in parallel — every core reach is typeof-guarded per call and the
   card degrades honestly, status line first, when the engine is absent).

   WHAT THIS CARD IS — write your own DSP modules, live in the engine:
     · EDITOR   — id/name/kind fields + a plain <textarea> source editor (av-mono; no CodeMirror)
                  · CHECK lints the source WITHOUT eval (id charset · api gate · param schema)
                  · RUN sends the editor to the engine (avCodeAdd) and prints its verdict verbatim
                  · STOP removes the selected module · EXPORT saves it as a .avmod file
                  · IMPORT reads a .avmod file back through avCodeImportText.
     · EXAMPLES — one button per avCodeExamples(), loaded into the editor.
     · LIBRARY  — rows from avCodeList(): name · kind badge · status LED · ON/OFF · EDIT ·
                  EXPORT · remove.
     · PARAMS   — knob rows for the selected module via avKnobHTML/avKnobRowHTML/avKnobBind on
                  the canonical paths fx.<id>.<name> / <id>.<name> (the standard avApplyParam
                  funnel — routing lives in the engine side, not here).
     · CONTRACT — a compact in-page contract summary + the shipped examples.
     · STATUS   — the truth line: engine tier + module count, action receipts, and the engine's
                  own refusal text verbatim when a module is refused.

   BUSY DISCIPLINE (pinned, house pattern): ONE op at a time — while an add/import runs every
   action button is disabled, a second click is refused with an honest status line, jobs are
   never queued. Remove/enable/export are immediate (the studio take-✕ precedent — no dialog);
   the status line carries the verdict.

   LAW: 'use strict'; classic script; ONE namespace avCodeUi* / AV_CODE_UI_*.
   LAWS preserved: node-loadable (zero DOM at load) · never throws · no console noise · every
   cross-module reach (av_code.js facade, av_knob.js builders, avApplyParam, avDeliverDownload)
   is typeof-guarded per call · DOM touches only inside guarded functions · no new AudioContext
   is ever touched here · nothing is uploaded (exports are local downloads).

   ID INVENTORY (rig + parent rely on these):
     root `.av-code[data-av-code="1"]` (id="av-code" assigned only when the parent's own
       #av-code card element is not already in the document)
     #av-code-status (role=status — the truth line)
     EDITOR: #av-code-id · #av-code-name · #av-code-kind (select fx|kind) · #av-code-src
             (textarea) · #av-code-check · #av-code-run · #av-code-stop · #av-code-export ·
             #av-code-import (file input)
     #av-code-examples · #av-code-list · #av-code-params · #av-code-docs · #av-code-note
   CARD HOOKS: [data-av-code-row="<id>"] · [data-av-code-act=enable|edit|export|delete] ·
   [data-av-code-example="<key>"] · dataset avCodeUiWired='1' on the host ·
   class av-code-busy + dataset avCodeBusy='1|0' on the root while an op runs.

   OBSERVABLES: avCodeUiInit() -> bool (false without #av-code-host; idempotent; re-mountable)
   · avCodeUiSync() -> bool · avCodeUiClasses() -> string[] (the NEW css classes; the parent
   styles them) · avCodeUiSnap() -> the honest card state · window.__avCodeUi = { version, init,
   sync, classes, snap, state }.

   ONE writer (child sa-C). Never throws. */

"use strict";

const AV_CODE_UI_VERSION = "s5.0";
const AV_CODE_UI_SRC_CAP = 65536;          /* the §2.B module source cap (64 KB) */
const AV_CODE_UI_PARAM_CAP = 16;           /* the §2.B param count cap */
const AV_CODE_UI_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;   /* the §2.B id charset */
const AV_CODE_UI_POLL_MS = 1500;           /* the light change poll (restores surface after boot) */
const AV_CODE_UI_ROWS_CAP = 200;           /* render cap — never a wall of DOM */

/* the four action buttons (one source of truth: markup ids + busy labels) */
const AV_CODE_UI_BTNS = [
  { id: "av-code-check", label: "CHECK", busy: "", sel: "#av-code-check" },
  { id: "av-code-run", label: "RUN", busy: "RUNNING\u2026", sel: "#av-code-run" },
  { id: "av-code-stop", label: "STOP", busy: "", sel: "#av-code-stop" },
  { id: "av-code-export", label: "EXPORT", busy: "", sel: "#av-code-export" },
];

/* the facade surface this card may call (bare-identifier + global-property, both guarded) */
const AV_CODE_UI_FNS = [
  ["list", "avCodeList"], ["add", "avCodeAdd"], ["remove", "avCodeRemove"],
  ["enable", "avCodeEnable"], ["setParam", "avCodeSetParam"], ["getParam", "avCodeGetParam"],
  ["examples", "avCodeExamples"], ["example", "avCodeExample"], ["exportText", "avCodeExportText"],
  ["importText", "avCodeImportText"], ["status", "avCodeStatus"], ["kinds", "avCodeKinds"],
];

/* the NEW css classes this card introduces (the parent styles them; av-code-host excluded —
   it is parent-owned). Kept in one place so the integration class-coverage check can diff. */
const AV_CODE_UI_CLASSES = [
  "av-code", "av-code-head", "av-code-title", "av-code-cap",
  "av-code-status-line", "av-code-status", "av-code-msg", "av-code-err",
  "av-code-cols", "av-code-sec", "av-code-sec-title",
  "av-code-fields", "av-code-field", "av-code-field-lbl", "av-code-in", "av-code-kind",
  "av-code-src", "av-code-actions", "av-code-btn", "av-code-file", "av-code-import",
  "av-code-examples", "av-code-example",
  "av-code-list", "av-code-none", "av-code-row", "selected", "off", "bad", "av-code-led", "on",
  "av-code-badge", "av-code-row-name", "av-code-row-sub", "av-code-row-acts",
  "av-code-enable", "av-code-edit", "av-code-exp", "av-code-del",
  "av-code-params", "av-code-knobs", "av-code-params-note",
  "av-code-docs", "av-code-docs-h", "av-code-docs-p", "av-code-docs-list", "av-code-docs-item",
  "av-code-note", "av-code-degrade", "av-code-foot", "av-code-busy",
];

/* UI-local state only — every engine fact is read through the pinned facade per paint */
const avCodeUiState = {
  inited: false, mounts: 0,
  selected: "",                              /* the library module the params panel follows */
  busy: false, busyOp: "",
  statusMsg: "", statusKind: "msg",
  examples: [],                              /* cached avCodeExamples() rows */
  examplesKey: "__init__",
  lastListHtml: null, lastListSig: "",
  lastParamsSig: "",
  schemaId: "", schemaKey: "", schemaMap: null,   /* parsed param schema for the selection */
  lastDocsSig: "",
  poll: null, pollSig: "",
  importName: "",
  memos: { text: {}, cls: {} },
};

/* ---------- small pure helpers (no DOM; harness-covered) ---------- */

const avCodeUiEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const avCodeUiNum = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };

function avCodeUiClean(s, max) {
  let t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  if (max && t.length > max) t = t.slice(0, max - 1) + "\u2026";
  return t;
}

function avCodeUiFmtBytes(v) {
  const n = Number(v);
  if (!isFinite(n) || n < 0) return "\u2014";
  if (n < 1024) return Math.round(n) + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

/* the engine's or the browser's error text, never invented */
function avCodeUiErrText(e, fallback) {
  try {
    if (e && typeof e === "object") {
      if (typeof e.error === "string" && e.error) return e.error;
      if (typeof e.message === "string" && e.message) return e.message;
    }
    if (typeof e === "string" && e) return e;
    if (e === false) return fallback || "refused";
  } catch (e2) { /* fall through */ }
  return fallback || "refused";
}

/* a status receipt is ok only when it says so — everything else is a refusal */
function avCodeUiStatusOK(r) {
  try { if (r && typeof r === "object" && r.ok === true) return true; } catch (e) { /* refuse */ }
  return false;
}

/* utf-8 bytes for a string (TextEncoder guarded; manual fallback — av_deliver_ui precedent) */
function avCodeUiUtf8(str) {
  const s = String(str == null ? "" : str);
  try { if (typeof TextEncoder === "function") return new TextEncoder().encode(s); } catch (e) { /* fallback below */ }
  const out = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        const c2 = s.charCodeAt(i + 1);
        if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
          const cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
          out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
          i += 1;
          continue;
        }
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  } catch (e) { /* refuse to the partial */ }
  return Uint8Array.from(out);
}

/* ---------- guarded DOM + facade access (no throw, no noise) ---------- */

function avCodeUiWin() {
  try { if (typeof window !== "undefined") return window; } catch (e) { /* none */ }
  return null;
}

function avCodeUiDoc() {
  try { if (typeof document !== "undefined") return document; } catch (e) { /* none */ }
  return null;
}

function avCodeUiGlobal() {
  const w = avCodeUiWin();
  if (w) return w;
  try { if (typeof globalThis !== "undefined") return globalThis; } catch (e) { /* none */ }
  return null;
}

function avCodeUiHost() {
  try {
    const d = avCodeUiDoc();
    if (d && typeof d.getElementById === "function") return d.getElementById("av-code-host");
  } catch (e) { /* no document */ }
  return null;
}

/* the av_code.js facade + the av_knob.js builders, resolved PER CALL (late arrival is normal).
   Bare identifiers cover the concat scope (const arrows included); the global-property pass
   covers separate script scopes and rigs. */
function avCodeUiFns() {
  const f = {
    list: null, add: null, remove: null, enable: null, setParam: null, getParam: null,
    examples: null, example: null, exportText: null, importText: null, status: null, kinds: null,
  };
  try { if (typeof avCodeList === "function") f.list = avCodeList; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avCodeAdd === "function") f.add = avCodeAdd; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avCodeRemove === "function") f.remove = avCodeRemove; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avCodeEnable === "function") f.enable = avCodeEnable; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avCodeSetParam === "function") f.setParam = avCodeSetParam; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avCodeGetParam === "function") f.getParam = avCodeGetParam; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avCodeExamples === "function") f.examples = avCodeExamples; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avCodeExample === "function") f.example = avCodeExample; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avCodeExportText === "function") f.exportText = avCodeExportText; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avCodeImportText === "function") f.importText = avCodeImportText; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avCodeStatus === "function") f.status = avCodeStatus; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avCodeKinds === "function") f.kinds = avCodeKinds; } catch (e) { /* absent/TDZ */ }
  try {
    const g = avCodeUiGlobal();
    if (g) {
      for (let i = 0; i < AV_CODE_UI_FNS.length; i++) {
        const k = AV_CODE_UI_FNS[i][0], n = AV_CODE_UI_FNS[i][1];
        if (!f[k] && typeof g[n] === "function") f[k] = g[n];
      }
    }
  } catch (e) { /* no global scope */ }
  return f;
}

/* the knob builders (av_knob.js) — avKnobRowHTML/avKnobHTML are const arrows in the concat
   scope (bare typeof), avKnobBind is a function declaration (global-property fallback too) */
function avCodeUiKnobFns() {
  const k = { html: null, row: null, bind: null };
  try { if (typeof avKnobHTML === "function") k.html = avKnobHTML; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avKnobRowHTML === "function") k.row = avKnobRowHTML; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avKnobBind === "function") k.bind = avKnobBind; } catch (e) { /* absent/TDZ */ }
  try {
    const g = avCodeUiGlobal();
    if (g) {
      if (!k.html && typeof g.avKnobHTML === "function") k.html = g.avKnobHTML;
      if (!k.bind && typeof g.avKnobBind === "function") k.bind = g.avKnobBind;
    }
  } catch (e) { /* no global scope */ }
  return k;
}

/* the engine state as the facade reports it — {ok, engine, count, poisoned, why} */
function avCodeUiEngine() {
  const f = avCodeUiFns();
  if (!f.status) {
    if (!f.list && !f.add) return { ok: false, why: "the module engine (av_code.js) is not loaded", count: null, poisoned: 0 };
    return { ok: false, why: "the engine does not report a status (avCodeStatus is missing)", count: null, poisoned: 0 };
  }
  let st = null;
  try { st = f.status(); } catch (e) { st = null; }
  if (!st || typeof st !== "object") return { ok: false, why: "the engine has not reported a status yet", count: null, poisoned: 0 };
  const engine = (typeof st.engine === "string" && st.engine) ? st.engine : "";
  const count = isFinite(Number(st.count)) ? Math.round(Number(st.count)) : null;
  const poisoned = Array.isArray(st.poisoned) ? st.poisoned.length : 0;
  if (!engine) return { ok: false, why: "the audio engine is not ready yet (modules cannot run)", count: count, poisoned: poisoned };
  return { ok: true, engine: engine, count: count == null ? 0 : count, poisoned: poisoned };
}

/* ---------- the library model (pure read of avCodeList() + UI state) ---------- */

function avCodeUiParamNorm(name, p) {
  const min0 = avCodeUiNum(p && p.min, 0);
  const max0 = avCodeUiNum(p && p.max, 1);
  const min = Math.min(min0, max0), max = Math.max(min0, max0);
  const out = {
    name: String(name), min: min, max: max,
    def: avCodeUiNum(p && p.def, min),
    step: avCodeUiNum(p && p.step, 0.01),
    label: "", curve: "", unit: "", fmt: "",
  };
  if (p && typeof p === "object") {
    if (typeof p.label === "string" && p.label) out.label = p.label;
    if (typeof p.curve === "string" && p.curve) out.curve = p.curve;
    if (typeof p.unit === "string" && p.unit) out.unit = p.unit;
    if (typeof p.fmt === "string" && p.fmt) out.fmt = p.fmt;
  }
  return out;
}

/* accept the optimistic shapes for a module's params: array of descriptors, array of names,
   or an object map (name -> descriptor | current value) */
function avCodeUiParamsNorm(v) {
  const out = [];
  try {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length && i < 64; i++) {
        const p = v[i];
        if (typeof p === "string" && p) { out.push(avCodeUiParamNorm(p, null)); continue; }
        if (!p || typeof p !== "object" || typeof p.name !== "string" || !p.name) continue;
        out.push(avCodeUiParamNorm(p.name, p));
      }
      return out;
    }
    if (v && typeof v === "object") {
      const keys = Object.keys(v);
      for (let i = 0; i < keys.length && i < 64; i++) {
        const val = v[keys[i]];
        if (val && typeof val === "object") out.push(avCodeUiParamNorm(keys[i], val));
        else if (typeof val === "number" && isFinite(val)) out.push(avCodeUiParamNorm(keys[i], { def: val }));
      }
      return out;
    }
  } catch (e) { return out; }
  return out;
}

function avCodeUiRow(r) {
  return {
    id: String(r.id == null ? "" : r.id),
    name: avCodeUiClean(r.name != null ? r.name : r.id, 48) || String(r.id == null ? "" : r.id),
    kind: (r.kind === "kind") ? "kind" : "fx",
    api: avCodeUiNum(r.api, 1),
    params: avCodeUiParamsNorm(r.params),
    enabled: r.enabled !== false,
    ready: r.ready !== false,
    poisoned: !!r.poisoned,
    kindId: isFinite(Number(r.kindId)) ? Math.round(Number(r.kindId)) : null,
  };
}

/* rows, or null when the listing is unavailable (engine absent / list() absent) */
function avCodeUiRows() {
  const f = avCodeUiFns();
  if (!f.list) return null;
  let rows = null;
  try { rows = f.list(); } catch (e) { rows = null; }
  if (!Array.isArray(rows)) return null;
  const out = [];
  for (let i = 0; i < rows.length && i < AV_CODE_UI_ROWS_CAP; i++) {
    const r = rows[i];
    if (r && typeof r === "object" && typeof r.id === "string" && r.id) out.push(avCodeUiRow(r));
  }
  return out;
}

/* canonical param paths per §2.C: fx.<id>.<name> / <id>.<name> */
function avCodeUiParamPath(row, name) {
  try { return (row.kind === "fx" ? "fx." : "") + row.id + "." + name; }
  catch (e) { return String(name || ""); }
}

/* the current value: the facade's getParam, then the avParams mirror, then the declared def */
function avCodeUiParamValue(row, p) {
  const path = avCodeUiParamPath(row, p.name);
  try {
    const f = avCodeUiFns();
    if (f.getParam) {
      const v = Number(f.getParam(row.id, p.name));
      if (isFinite(v)) return v;
    }
  } catch (e) { /* fall through */ }
  try {
    if (typeof avParams !== "undefined" && avParams) {
      const n = Number(avParams[path]);
      if (isFinite(n)) return n;
    }
  } catch (e) { /* no mirror */ }
  return isFinite(p.def) ? p.def : p.min;
}

/* ---------- write-on-change DOM painting ---------- */

function avCodeUiWriteText(host, sel, txt, key) {
  try {
    const s = avCodeUiState;
    if (s.memos.text[key] === txt) return false;
    s.memos.text[key] = txt;
    const el = (host && typeof host.querySelector === "function") ? host.querySelector(sel) : null;
    if (el && el.textContent !== txt) el.textContent = txt;
    return true;
  } catch (e) { return false; }
}

function avCodeUiWriteClass(host, sel, cls, on, key) {
  try {
    const s = avCodeUiState;
    const memoKey = key + "|" + cls;
    const want = !!on;
    if (s.memos.cls[memoKey] === want) return false;
    s.memos.cls[memoKey] = want;
    const el = (host && typeof host.querySelector === "function") ? host.querySelector(sel) : null;
    if (el && el.classList && typeof el.classList.add === "function") {
      if (want) el.classList.add(cls); else el.classList.remove(cls);
    }
    return true;
  } catch (e) { return false; }
}

function avCodeUiSetStatus(msg, kind) {
  try {
    const s = avCodeUiState;
    s.statusMsg = String(msg == null ? "" : msg);
    s.statusKind = (kind === "err") ? "err" : "msg";
    return avCodeUiPaintStatus();
  } catch (e) { return false; }
}

function avCodeUiPaintStatus(hostArg) {
  const host = hostArg || avCodeUiHost();
  if (!host) return false;
  try {
    const s = avCodeUiState;
    let txt = "", kind = "msg";
    if (s.statusMsg) { txt = s.statusMsg; kind = s.statusKind; }
    else {
      const e = avCodeUiEngine();
      if (e.ok) {
        txt = "engine " + e.engine + " \u00b7 " + e.count + " module" + (e.count === 1 ? "" : "s") +
          (e.poisoned > 0 ? " \u00b7 " + e.poisoned + " poisoned" : "");
      } else { txt = "engine unavailable \u2014 " + e.why; kind = "err"; }
    }
    avCodeUiWriteText(host, "#av-code-status", txt, "status");
    avCodeUiWriteClass(host, "#av-code-status", "av-code-err", kind === "err", "status-kind");
    return true;
  } catch (e) { return false; }
}

function avCodeUiBusyRefuse() {
  const s = avCodeUiState;
  avCodeUiSetStatus("an operation is already running (" + (s.busyOp || "working") + ") \u2014 one at a time", "err");
  return false;
}

function avCodeUiSetBusy(op, msg) {
  try {
    const s = avCodeUiState;
    s.busy = true;
    s.busyOp = String(op || "");
    s.statusMsg = String(msg || "working\u2026");
    s.statusKind = "msg";
    avCodeUiSync();
    return true;
  } catch (e) { return false; }
}

function avCodeUiClearBusy() {
  const s = avCodeUiState;
  s.busy = false;
  s.busyOp = "";
}

/* the busy paint: every action button disabled while an op runs; the running button carries
   its busy label; the root carries av-code-busy + aria-busy */
function avCodeUiPaintBusy(hostArg) {
  const host = hostArg || avCodeUiHost();
  if (!host) return false;
  try {
    const s = avCodeUiState;
    for (let i = 0; i < AV_CODE_UI_BTNS.length; i++) {
      const b = AV_CODE_UI_BTNS[i];
      const el = (typeof host.querySelector === "function") ? host.querySelector("#" + b.id) : null;
      if (!el) continue;
      const running = s.busy && ((s.busyOp === "run" && b.id === "av-code-run") || (s.busyOp === "import" && b.id === "av-code-import"));
      const want = (running && b.busy) ? b.busy : b.label;
      if (el.textContent !== want) el.textContent = want;
      if (el.disabled !== s.busy) el.disabled = s.busy;
    }
    const root = (typeof host.querySelector === "function") ? host.querySelector(".av-code") : null;
    if (root) {
      if (root.dataset) {
        const v = s.busy ? "1" : "0";
        if (root.dataset.avCodeBusy !== v) root.dataset.avCodeBusy = v;
      }
      if (typeof root.setAttribute === "function") {
        const av = s.busy ? "true" : "false";
        if (!root.getAttribute || root.getAttribute("aria-busy") !== av) root.setAttribute("aria-busy", av);
      }
      avCodeUiWriteClass(host, ".av-code", "av-code-busy", s.busy, "root-busy");
    }
    return true;
  } catch (e) { return false; }
}

/* ---------- library rows ---------- */

function avCodeUiRowHTML(row) {
  const s = avCodeUiState;
  const isSel = (s.selected === row.id);
  const led = row.poisoned ? "bad" : (!row.enabled ? "off" : (!row.ready ? "bad" : "on"));
  const ledTitle = row.poisoned
    ? "poisoned \u2014 the engine disabled it after repeated throws; remove it or fix and re-run"
    : (!row.enabled
      ? (row.ready ? "disabled \u2014 still loaded, out of the signal path" : "disabled \u2014 not loaded in the engine")
      : (!row.ready ? "not admitted by the engine (yet)" : "enabled \u2014 live in the engine"));
  const bits = [];
  bits.push(row.kind === "kind" ? "voice kind" : "fx insert");
  bits.push("api " + (isFinite(row.api) ? row.api : 1));
  bits.push(row.params.length + " param" + (row.params.length === 1 ? "" : "s"));
  if (row.kind === "kind" && row.kindId != null) bits.push("kindId " + row.kindId);
  if (!row.enabled) bits.push("disabled");
  else if (!row.ready) bits.push("not ready");
  if (row.poisoned) bits.push("poisoned");
  const cls = "av-code-row" + (isSel ? " selected" : "") + (!row.enabled ? " off" : "") +
    ((row.poisoned || !row.ready) ? " bad" : "");
  return '<div class="' + cls + '" data-av-code-row="' + avCodeUiEsc(row.id) + '" role="listitem" title="' + avCodeUiEsc(row.id) + '">' +
    '<span class="av-code-led ' + led + '" title="' + avCodeUiEsc(ledTitle) + '" aria-hidden="true"></span>' +
    '<span class="av-code-badge ' + (row.kind === "kind" ? "kind" : "fx") + '">' + (row.kind === "kind" ? "KIND" : "FX") + "</span>" +
    '<span class="av-code-row-name">' + avCodeUiEsc(row.name) + "</span>" +
    '<span class="av-code-row-sub av-dim">' + avCodeUiEsc(bits.join(" \u00b7 ")) + "</span>" +
    '<span class="av-code-row-acts">' +
    '<button type="button" class="av-btn mini av-code-btn av-code-enable" data-av-code-act="enable" aria-pressed="' + (row.enabled ? "true" : "false") + '" title="' + (row.enabled ? "disable \u2014 the module stays loaded but leaves the signal path" : "enable \u2014 let the module process again") + '">' + (row.enabled ? "ON" : "OFF") + "</button>" +
    '<button type="button" class="av-btn mini av-code-btn av-code-edit" data-av-code-act="edit" title="load this module\u2019s source into the editor">EDIT</button>' +
    '<button type="button" class="av-btn mini av-code-btn av-code-exp" data-av-code-act="export" title="save this module as a .avmod file">EXPORT</button>' +
    '<button type="button" class="av-btn mini av-code-btn av-code-del" data-av-code-act="delete" title="remove this module from the engine and the library" aria-label="remove ' + avCodeUiEsc(row.id) + '">\u2715</button>' +
    "</span></div>";
}

function avCodeUiPaintList(hostArg) {
  const host = hostArg || avCodeUiHost();
  if (!host) return false;
  try {
    const s = avCodeUiState;
    const listEl = (typeof host.querySelector === "function") ? host.querySelector("#av-code-list") : null;
    const noneEl = (typeof host.querySelector === "function") ? host.querySelector("#av-code-none") : null;
    if (!listEl) return false;
    const rows = avCodeUiRows();
    if (rows === null) {
      if (s.lastListHtml !== "__none__") { s.lastListHtml = "__none__"; listEl.innerHTML = ""; }
      const e = avCodeUiEngine();
      if (noneEl) {
        noneEl.hidden = false;
        const txt = "the module list is unavailable \u2014 " + e.why + ".";
        if (noneEl.textContent !== txt) noneEl.textContent = txt;
      }
      return false;
    }
    const html = rows.map(avCodeUiRowHTML).join("");
    if (html !== s.lastListHtml) { s.lastListHtml = html; listEl.innerHTML = html; }
    let sig = "";
    for (let i = 0; i < rows.length; i++) {
      sig += rows[i].id + "," + (rows[i].enabled ? 1 : 0) + "," + (rows[i].ready ? 1 : 0) + "," + (rows[i].poisoned ? 1 : 0) + ";";
    }
    s.lastListSig = sig;
    if (noneEl) {
      const empty = rows.length === 0;
      if (noneEl.hidden !== !empty) noneEl.hidden = !empty;
      const txt = "no user modules yet \u2014 load an example or write one, then press RUN.";
      if (empty && noneEl.textContent !== txt) noneEl.textContent = txt;
    }
    avCodeUiDisableRows(listEl, s.busy);
    return true;
  } catch (e) { return false; }
}

function avCodeUiDisableRows(listEl, busy) {
  try {
    if (!listEl || typeof listEl.querySelectorAll !== "function") return false;
    const btns = listEl.querySelectorAll("[data-av-code-act]");
    if (btns && typeof btns.forEach === "function") btns.forEach(function (b) { if (b && b.disabled !== busy) b.disabled = busy; });
    return true;
  } catch (e) { return false; }
}

/* ---------- params panel (the pinned avKnobRowHTML/avKnobBind funnel) ---------- */

function avCodeUiKnobHTML(row, p) {
  const path = avCodeUiParamPath(row, p.name);
  const opts = {
    min: p.min, max: p.max, step: p.step, def: p.def,
    value: avCodeUiParamValue(row, p),
    hint: path,
  };
  if (p.curve) opts.curve = p.curve;
  if (p.unit) opts.unit = p.unit;
  if (p.fmt) opts.fmt = p.fmt;
  return avKnobHTML(path, p.label || p.name, opts);
}

function avCodeUiParamsNote(noteEl, txt) {
  try {
    if (!noteEl) return false;
    const t = String(txt == null ? "" : txt);
    if (noteEl.hidden !== !t) noteEl.hidden = !t;
    if (t && noteEl.textContent !== t) noteEl.textContent = t;
    return true;
  } catch (e) { return false; }
}

/* the descriptor schema (min/max/def/step) parsed from the module source — avCodeList() carries
   current VALUES; the range contract lives in the source's params array (the same structural
   scan the CHECK button uses, no eval) */
function avCodeUiSchemaFromSrc(src) {
  const map = {};
  try {
    const ps = avCodeUiParamsScan(src);
    if (!ps.ok || !ps.items.length) return map;
    for (let i = 0; i < ps.items.length && i < 32; i++) {
      const cell = ps.items[i];
      const nm = cell.match(/\bname\s*:\s*['"]([A-Za-z][A-Za-z0-9_]{0,31})['"]/);
      if (!nm) continue;
      const d = { name: nm[1] };
      const num = function (field) {
        const m = cell.match(new RegExp("\\b" + field + "\\s*:\\s*(-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)"));
        return m ? Number(m[1]) : null;
      };
      const mi = num("min"), ma = num("max"), de = num("def"), st = num("step");
      if (mi != null && isFinite(mi)) d.min = mi;
      if (ma != null && isFinite(ma)) d.max = ma;
      if (de != null && isFinite(de)) d.def = de;
      if (st != null && isFinite(st)) d.step = st;
      map[d.name] = d;
    }
  } catch (e) { /* the schema is a nicety */ }
  return map;
}

function avCodeUiSchemaFor(row) {
  const s = avCodeUiState;
  const key = row.api + ":" + row.params.length;
  if (s.schemaId === row.id && s.schemaKey === key && s.schemaMap) return s.schemaMap;
  let map = {};
  try {
    const f = avCodeUiFns();
    if (f.exportText) {
      const txt = f.exportText(row.id);
      if (typeof txt === "string" && txt) {
        const obj = JSON.parse(txt);
        if (obj && typeof obj.src === "string" && obj.src) map = avCodeUiSchemaFromSrc(obj.src);
      }
    }
  } catch (e) { map = {}; }
  s.schemaId = row.id;
  s.schemaKey = key;
  s.schemaMap = map;
  return map;
}

function avCodeUiClearSchema(id) {
  const s = avCodeUiState;
  if (!id || s.schemaId === id) { s.schemaId = ""; s.schemaKey = ""; s.schemaMap = null; }
}

/* merge the current values (list row) with the source schema (ranges) — the knob list */
function avCodeUiParamsWithSchema(sel) {
  const out = [];
  let schema = {};
  try { schema = avCodeUiSchemaFor(sel) || {}; } catch (e) { schema = {}; }
  if (!sel.params.length) {
    const keys = Object.keys(schema);
    for (let i = 0; i < keys.length && i < 16; i++) {
      const sc = schema[keys[i]];
      out.push({
        name: sc.name || keys[i],
        min: isFinite(sc.min) ? sc.min : 0, max: isFinite(sc.max) ? sc.max : 1,
        def: isFinite(sc.def) ? sc.def : 0, step: isFinite(sc.step) ? sc.step : 0.01,
        label: "", curve: "", unit: "", fmt: "",
      });
    }
    return out;
  }
  for (let i = 0; i < sel.params.length; i++) {
    const p = sel.params[i];
    const sc = (schema && schema[p.name]) ? schema[p.name] : null;
    const q = {
      name: p.name,
      min: (sc && isFinite(sc.min)) ? sc.min : p.min,
      max: (sc && isFinite(sc.max)) ? sc.max : p.max,
      def: (sc && isFinite(sc.def)) ? sc.def : p.def,
      step: (sc && isFinite(sc.step)) ? sc.step : p.step,
      label: p.label || "", curve: p.curve || "", unit: p.unit || "", fmt: p.fmt || "",
    };
    if (q.max < q.min) { const t = q.min; q.min = q.max; q.max = t; }
    out.push(q);
  }
  return out;
}

function avCodeUiPaintParams(hostArg) {
  const host = hostArg || avCodeUiHost();
  if (!host) return false;
  try {
    const s = avCodeUiState;
    const panel = (typeof host.querySelector === "function") ? host.querySelector("#av-code-params") : null;
    if (!panel) return false;
    const noteEl = (typeof host.querySelector === "function") ? host.querySelector("#av-code-params-note") : null;
    const rows = avCodeUiRows();
    let sel = null;
    if (rows) {
      for (let i = 0; i < rows.length; i++) if (rows[i].id === s.selected) { sel = rows[i]; break; }
    }
    if (!sel) {
      if (rows && s.selected) s.selected = "";       /* stale selection on a live list */
      if (s.lastParamsSig !== "__none__") { s.lastParamsSig = "__none__"; panel.innerHTML = ""; }
      const why = rows ? "" : avCodeUiEngine().why;
      avCodeUiParamsNote(noteEl, rows ? "select a module to see its controls" : ("the module list is unavailable \u2014 " + why));
      return true;
    }
    const k = avCodeUiKnobFns();
    if (!k.html || !k.row) {
      if (s.lastParamsSig !== "__noknobs__") { s.lastParamsSig = "__noknobs__"; panel.innerHTML = ""; }
      avCodeUiParamsNote(noteEl, "the knob renderer (av_knob.js) is not loaded \u2014 params shown as text: " + (sel.params.map(function (p) { return p.name; }).join(" \u00b7 ") || "(none)"));
      return false;
    }
    const params = avCodeUiParamsWithSchema(sel);
    let sig = sel.id + "|";
    for (let i = 0; i < params.length; i++) {
      sig += params[i].name + "," + params[i].min + "," + params[i].max + "," + params[i].step + "," + params[i].def + ";";
    }
    if (sig !== s.lastParamsSig) {
      s.lastParamsSig = sig;
      const knobs = [];
      for (let i = 0; i < params.length; i++) knobs.push(avCodeUiKnobHTML(sel, params[i]));
      panel.innerHTML = knobs.length ? k.row(knobs, "av-code-knobs") : "";
      if (knobs.length && k.bind) { try { k.bind(panel); } catch (e) { /* binding is a nicety */ } }
    }
    avCodeUiParamsNote(noteEl, params.length ? "" : "this module declares no params");
    return true;
  } catch (e) { return false; }
}

/* ---------- examples ---------- */

function avCodeUiPaintExamples(hostArg) {
  const host = hostArg || avCodeUiHost();
  if (!host) return false;
  try {
    const s = avCodeUiState;
    const el = (typeof host.querySelector === "function") ? host.querySelector("#av-code-examples") : null;
    if (!el) return false;
    const f = avCodeUiFns();
    let ex = null;
    if (f.examples) { try { ex = f.examples(); } catch (e) { ex = null; } }
    let norm = null;
    if (Array.isArray(ex)) {
      norm = [];
      for (let i = 0; i < ex.length && i < 12; i++) {
        const r = ex[i];
        if (!r || typeof r !== "object" || typeof r.key !== "string" || !r.key) continue;
        norm.push({
          key: r.key,
          name: avCodeUiClean(r.name != null ? r.name : r.key, 32) || r.key,
          kind: (r.kind === "kind") ? "kind" : "fx",
          src: (typeof r.src === "string") ? r.src : "",
        });
      }
    }
    s.examples = norm || [];
    const sig = norm ? norm.map(function (e) { return e.key + ":" + e.name + ":" + e.kind; }).join("|") : "__none__";
    if (sig !== s.examplesKey) {
      s.examplesKey = sig;
      if (!norm) {
        el.innerHTML = '<span class="av-code-note av-dim">examples load with the engine (av_code.js)</span>';
      } else if (!norm.length) {
        el.innerHTML = '<span class="av-code-note av-dim">the engine ships no examples here</span>';
      } else {
        el.innerHTML = norm.map(function (e) {
          return '<button type="button" class="av-btn mini av-code-example" data-av-code-example="' + avCodeUiEsc(e.key) + '" title="load the ' + avCodeUiEsc(e.name) + " example (" + avCodeUiEsc(e.kind) + ') into the editor">' + avCodeUiEsc(e.name) + "</button>";
        }).join("");
      }
    }
    return true;
  } catch (e) { return false; }
}

/* ---------- the contract summary (docs) ---------- */

function avCodeUiDocsHTML() {
  const s = avCodeUiState;
  let exList = "";
  if (s.examples.length) {
    exList = '<ul class="av-code-docs-list">' + s.examples.map(function (e) {
      return '<li class="av-code-docs-item"><b>' + avCodeUiEsc(e.name) + "</b> \u2014 " +
        (e.kind === "kind" ? "voice kind" : "fx insert") +
        (e.src ? " \u00b7 " + avCodeUiEsc(avCodeUiFmtBytes(e.src.length)) + " source" : "") + "</li>";
    }).join("") + "</ul>";
  } else {
    exList = '<p class="av-code-docs-p av-dim">the shipped examples (tremolo \u00b7 bitcrush \u00b7 fold) arrive with the engine.</p>';
  }
  return '<p class="av-code-docs-h"><b>Anvil module contract \u00b7 api 1</b></p>' +
    '<p class="av-code-docs-p">an <b>fx</b> module returns <code>{ api: 1, id, name, kind: \u0027fx\u0027, params }</code> and provides <code>createState({ sampleRate }) \u2192 st</code>, <code>setParam(st, path, v)</code> and <code>process(st, inL, inR)</code> \u2014 write <code>st.oL</code> / <code>st.oR</code> (wet: the rack blends by <code>st.mix</code>; <code>st.on</code> \u2264 0.5 disables).</p>' +
    '<p class="av-code-docs-p">a <b>kind</b> module is a full voice: <code>PREFIX \u00b7 initVoiceK \u00b7 initVoice \u00b7 stepVoice(eng, v) \u2192 amp \u00b7 releaseVoice \u00b7 isVoiceDone \u00b7 setParam(eng, path, value)</code>.</p>' +
    '<p class="av-code-docs-p">limits \u2014 id <code>a-z 0-9 _ -</code> (letter first, \u2264 32) \u00b7 source \u2264 64 KB \u00b7 \u2264 16 params <code>{name, min, max, def, step?}</code> \u00b7 no DOM, network or imports in the audio scope; the sandbox injects <code>api \u00b7 clamp \u00b7 lerp \u00b7 sine \u00b7 TAU</code>.</p>' +
    '<p class="av-code-docs-p">versioning \u2014 declare <code>api: 1</code>; other api numbers and a missing api are refused. a module that throws is reported poisoned and disabled after four throws \u2014 the engine keeps playing.</p>' +
    '<p class="av-code-docs-p av-dim">params ride the canonical paths <code>fx.&lt;id&gt;.&lt;name&gt;</code> / <code>&lt;id&gt;.&lt;name&gt;</code>. full contract: docs/09-code-module-api.md \u00b7 examples:</p>' + exList;
}

function avCodeUiPaintDocs(hostArg) {
  const host = hostArg || avCodeUiHost();
  if (!host) return false;
  try {
    const s = avCodeUiState;
    const el = (typeof host.querySelector === "function") ? host.querySelector("#av-code-docs") : null;
    if (!el) return false;
    const sig = s.examplesKey;
    if (s.lastDocsSig === sig && el.dataset && el.dataset.avCodeDocsSig === sig) return true;
    s.lastDocsSig = sig;
    el.innerHTML = avCodeUiDocsHTML();
    if (el.dataset) { try { el.dataset.avCodeDocsSig = sig; } catch (e) { /* ok */ } }
    return true;
  } catch (e) { return false; }
}

/* ---------- the honest degrade note ---------- */

function avCodeUiPaintNote(hostArg) {
  const host = hostArg || avCodeUiHost();
  if (!host) return false;
  try {
    const el = (typeof host.querySelector === "function") ? host.querySelector("#av-code-note") : null;
    if (!el) return false;
    const f = avCodeUiFns();
    let txt = "";
    if (!f.list && !f.add && !f.status) {
      txt = "the CODE engine (av_code.js) is not loaded \u2014 the card is dormant and every action refuses honestly.";
    } else {
      const e = avCodeUiEngine();
      if (!e.ok) txt = "engine unavailable \u2014 " + e.why + ".";
    }
    if (el.hidden !== !txt) el.hidden = !txt;
    if (txt && el.textContent !== txt) el.textContent = txt;
    return true;
  } catch (e) { return false; }
}

/* ---------- sync (repaint from facade state; the parent/rig call this after external writes) ---------- */

function avCodeUiSync() {
  const host = avCodeUiHost();
  if (!host) return false;
  try {
    avCodeUiPaintList(host);
    avCodeUiPaintParams(host);
    avCodeUiPaintExamples(host);
    avCodeUiPaintDocs(host);
    avCodeUiPaintStatus(host);
    avCodeUiPaintBusy(host);
    avCodeUiPaintNote(host);
    return true;
  } catch (e) { return false; }
}

/* ---------- the editor (read-only reach; paint NEVER writes these while typing) ---------- */

function avCodeUiInput(host, sel) {
  try {
    const el = (host && typeof host.querySelector === "function") ? host.querySelector(sel) : null;
    return el ? String(el.value == null ? "" : el.value) : null;
  } catch (e) { return null; }
}

function avCodeUiSetInput(host, sel, val) {
  try {
    const el = (host && typeof host.querySelector === "function") ? host.querySelector(sel) : null;
    if (!el) return false;
    const v = String(val == null ? "" : val);
    if (el.value !== v) el.value = v;
    return true;
  } catch (e) { return false; }
}

function avCodeUiEditor(hostArg) {
  const host = hostArg || avCodeUiHost();
  const id = host ? avCodeUiInput(host, "#av-code-id") : null;
  const name = host ? avCodeUiInput(host, "#av-code-name") : null;
  const kind = host ? avCodeUiInput(host, "#av-code-kind") : null;
  const src = host ? avCodeUiInput(host, "#av-code-src") : null;
  return {
    id: (id == null ? "" : id).trim(),
    name: (name == null ? "" : name).trim(),
    kind: (kind === "kind") ? "kind" : "fx",
    src: (src == null ? "" : src),
  };
}

function avCodeUiTargetId() {
  const s = avCodeUiState;
  const rows = avCodeUiRows();
  const has = function (id) {
    if (!rows) return !!id;                    /* list unavailable — trust the string */
    for (let i = 0; i < rows.length; i++) if (rows[i].id === id) return true;
    return false;
  };
  if (s.selected && has(s.selected)) return s.selected;
  const ed = avCodeUiEditor().id;
  if (ed && has(ed)) return ed;
  return "";
}

/* ---------- CHECK — the lint (NO eval: structural scan only) ---------- */

/* bracket match from an open '[', respecting strings and comments (a lint, not a parser) */
function avCodeUiBracketEnd(src, open) {
  let depth = 0, q = 0, line = false, block = false;
  for (let i = open; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (line) { if (c === 10) line = false; continue; }
    if (block) { if (c === 42 && src.charCodeAt(i + 1) === 47) { block = false; i++; } continue; }
    if (q) {
      if (c === 92) { i++; continue; }
      if (c === q) q = 0;
      continue;
    }
    if (c === 47 && src.charCodeAt(i + 1) === 47) { line = true; i++; continue; }
    if (c === 47 && src.charCodeAt(i + 1) === 42) { block = true; i++; continue; }
    if (c === 39 || c === 34 || c === 96) { q = c; continue; }
    const ch = src.charAt(i);
    if (ch === "[") depth++;
    else if (ch === "]") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/* top-level { ... } cells inside a slice (strings/comments respected) — the param descriptors */
function avCodeUiTopObjects(inner) {
  const out = [];
  let depth = 0, q = 0, line = false, block = false, start = -1;
  for (let i = 0; i < inner.length; i++) {
    const c = inner.charCodeAt(i);
    if (line) { if (c === 10) line = false; continue; }
    if (block) { if (c === 42 && inner.charCodeAt(i + 1) === 47) { block = false; i++; } continue; }
    if (q) {
      if (c === 92) { i++; continue; }
      if (c === q) q = 0;
      continue;
    }
    if (c === 47 && inner.charCodeAt(i + 1) === 47) { line = true; i++; continue; }
    if (c === 47 && inner.charCodeAt(i + 1) === 42) { block = true; i++; continue; }
    if (c === 39 || c === 34 || c === 96) { q = c; continue; }
    const ch = inner.charAt(i);
    if (ch === "{" || ch === "[" || ch === "(") { if (depth === 0 && ch === "{") start = i; depth++; }
    else if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      if (depth === 0 && start >= 0 && ch === "}") { out.push(inner.slice(start, i + 1)); start = -1; }
    }
  }
  return out;
}

/* the first code-level `word` followed by a `:` (comments and strings are transparent to the
   lint) — returns the index of the ':' or -1 */
function avCodeUiFindMember(src, word) {
  const n = src.length, wl = word.length;
  let q = 0, line = false, block = false;
  for (let i = 0; i < n; i++) {
    const c = src.charCodeAt(i);
    if (line) { if (c === 10) line = false; continue; }
    if (block) { if (c === 42 && src.charCodeAt(i + 1) === 47) { block = false; i++; } continue; }
    if (q) {
      if (c === 92) { i++; continue; }
      if (c === q) q = 0;
      continue;
    }
    if (c === 47 && src.charCodeAt(i + 1) === 47) { line = true; i++; continue; }
    if (c === 47 && src.charCodeAt(i + 1) === 42) { block = true; i++; continue; }
    if (c === 39 || c === 34 || c === 96) { q = c; continue; }
    if (c >= 97 && c <= 122 && src.startsWith(word, i)) {
      const prev = (i > 0) ? src.charCodeAt(i - 1) : 0;
      const prevWord = (prev >= 48 && prev <= 57) || (prev >= 65 && prev <= 90) || (prev >= 97 && prev <= 122) || prev === 95 || prev === 36;
      if (!prevWord) {
        let j = i + wl;
        while (j < n) {
          const w = src.charCodeAt(j);
          if (w === 32 || w === 9 || w === 10 || w === 13) { j++; continue; }
          break;
        }
        if (src.charCodeAt(j) === 58) return j;
      }
    }
  }
  return -1;
}

/* locate `params: [ ... ]` and sweep the descriptor cells; {ok, error, count, items} */
function avCodeUiParamsScan(src) {
  const out = { ok: false, error: "", count: 0, items: [] };
  try {
    const ci = avCodeUiFindMember(src, "params");
    if (ci < 0) {
      out.error = "no params array found \u2014 a module declares params: [\u2026] (an empty array is fine)";
      return out;
    }
    let j = ci + 1;
    while (j < src.length) {
      const w = src.charCodeAt(j);
      if (w === 32 || w === 9 || w === 10 || w === 13) { j++; continue; }
      break;
    }
    if (src.charAt(j) !== "[") {
      out.error = "params must be an array \u2014 params: [ { name, min, max, def }, \u2026 ]";
      return out;
    }
    const end = avCodeUiBracketEnd(src, j);
    if (end < 0) { out.error = "params does not close \u2014 check the brackets"; return out; }
    const inner = src.slice(j + 1, end);
    const items = avCodeUiTopObjects(inner);
    out.items = items;
    out.count = items.length;
    out.ok = true;
    return out;
  } catch (e) {
    out.error = "the check could not read the params block";
    return out;
  }
}

/* the pure lint behind #av-code-check: id charset · api gate · param schema — nothing runs */
function avCodeUiValidate(idRaw, kindRaw, srcRaw) {
  const out = { ok: false, error: "", api: 0, params: 0, notes: [] };
  try {
    const id = String(idRaw == null ? "" : idRaw).trim();
    const src = String(srcRaw == null ? "" : srcRaw);
    if (!src.trim()) { out.error = "the editor is empty \u2014 paste a module or load an example"; return out; }
    if (src.length > AV_CODE_UI_SRC_CAP) {
      out.error = "source is " + src.length + " chars \u2014 modules are capped at " + AV_CODE_UI_SRC_CAP + " (64 KB)";
      return out;
    }
    if (!AV_CODE_UI_ID_RE.test(id)) {
      out.error = "id \"" + avCodeUiClean(id, 40) + "\" is invalid \u2014 a letter first, then a-z \u00b7 0-9 \u00b7 _ \u00b7 - (max 32 chars)";
      return out;
    }
    const ai = avCodeUiFindMember(src, "api");
    if (ai < 0) {
      out.error = "no api field found \u2014 a module declares api: 1 (a missing api is refused by the engine)";
      return out;
    }
    const am = src.slice(ai + 1, ai + 24).match(/^\s*['"]?([0-9]+)/);
    if (!am) {
      out.error = "the api field is not a number \u2014 a module declares api: 1";
      return out;
    }
    if (parseInt(am[1], 10) !== 1) {
      out.error = "api " + am[1] + " is not supported \u2014 this build accepts api: 1";
      return out;
    }
    out.api = 1;
    const ps = avCodeUiParamsScan(src);
    if (!ps.ok) { out.error = ps.error; return out; }
    out.params = ps.count;
    if (ps.count > AV_CODE_UI_PARAM_CAP) {
      out.error = ps.count + " params declared \u2014 the contract allows " + AV_CODE_UI_PARAM_CAP;
      return out;
    }
    for (let i = 0; i < ps.items.length && i < 24; i++) {
      const it = ps.items[i];
      const miss = [];
      if (!/\bname\s*:/.test(it)) miss.push("name");
      if (!/\bmin\s*:/.test(it)) miss.push("min");
      if (!/\bmax\s*:/.test(it)) miss.push("max");
      if (!/\bdef\s*:/.test(it)) miss.push("def");
      if (miss.length) {
        out.error = "param " + (i + 1) + " is missing " + miss.join(" \u00b7 ") + " \u2014 params are { name, min, max, def, step? }";
        return out;
      }
    }
    out.ok = true;
    return out;
  } catch (e) {
    out.error = "the check could not read the source";
    return out;
  }
}

function avCodeUiCheck() {
  const s = avCodeUiState;
  if (s.busy) return avCodeUiBusyRefuse();
  const host = avCodeUiHost();
  if (!host) return false;
  const ed = avCodeUiEditor(host);
  const res = avCodeUiValidate(ed.id, ed.kind, ed.src);
  if (!res.ok) { avCodeUiSetStatus("check refused \u2014 " + res.error, "err"); return false; }
  let txt = "check ok \u00b7 id \"" + ed.id + "\" \u00b7 api 1 \u00b7 " + res.params + " param" + (res.params === 1 ? "" : "s") +
    " \u00b7 " + ed.src.length + " chars \u00b7 nothing executed (no eval)";
  const rows = avCodeUiRows();
  if (rows) {
    for (let i = 0; i < rows.length; i++) if (rows[i].id === ed.id) { txt += " \u00b7 id already loaded (RUN sends it again)"; break; }
  }
  avCodeUiSetStatus(txt);
  return true;
}

/* ---------- RUN / STOP / enable / edit / export / import ---------- */

function avCodeUiRunSettle(r0, wantId, existed) {
  const s = avCodeUiState;
  avCodeUiClearBusy();
  try {
    if (avCodeUiStatusOK(r0)) {
      const id = (typeof r0.id === "string" && r0.id) ? r0.id : wantId;
      if (id) s.selected = id;
      let txt = (existed ? "saved " : "added ") + (id || "module");
      if (r0.kind === "kind" && isFinite(Number(r0.kindId))) txt += " \u00b7 kindId " + Math.round(Number(r0.kindId));
      const pc = Array.isArray(r0.params) ? r0.params.length : ((r0.params && typeof r0.params === "object") ? Object.keys(r0.params).length : -1);
      if (pc >= 0) txt += " \u00b7 " + pc + " param" + (pc === 1 ? "" : "s");
      s.statusMsg = txt;
      s.statusKind = "msg";
      s.lastParamsSig = "";
      avCodeUiClearSchema(id);
    } else {
      /* a refused add prints the ENGINE's error verbatim */
      s.statusMsg = avCodeUiErrText(r0, "the engine refused the module");
      s.statusKind = "err";
    }
  } catch (e) { /* settle never throws */ }
  avCodeUiSync();
}

function avCodeUiRun() {
  const s = avCodeUiState;
  if (s.busy) return avCodeUiBusyRefuse();
  const f = avCodeUiFns();
  if (!f.add) { avCodeUiSetStatus("run refused \u2014 the module engine (av_code.js) is not loaded", "err"); return false; }
  const host = avCodeUiHost();
  if (!host) return false;
  const ed = avCodeUiEditor(host);
  const rows = avCodeUiRows();
  let existed = false;
  if (rows) for (let i = 0; i < rows.length; i++) if (rows[i].id === ed.id) { existed = true; break; }
  avCodeUiSetBusy("run", (existed ? "saving " : "adding ") + (ed.id || "module") + "\u2026");
  const settled = { v: false };
  const done = function (r) {
    if (settled.v) return;
    settled.v = true;
    avCodeUiRunSettle(r, ed.id, existed);
  };
  let p = null;
  try { p = f.add({ id: ed.id, name: (ed.name || ed.id), kind: ed.kind, src: ed.src, enabled: true }); }
  catch (e) { done({ ok: false, error: avCodeUiErrText(e, "the engine threw") }); return true; }
  try {
    Promise.resolve(p).then(done, function (err) { done({ ok: false, error: avCodeUiErrText(err, "the add failed") }); });
  } catch (e) { done({ ok: false, error: avCodeUiErrText(e, "the add failed") }); }
  return true;
}

function avCodeUiRemove(id) {
  const s = avCodeUiState;
  if (s.busy) return avCodeUiBusyRefuse();
  if (typeof id !== "string" || !id) {
    avCodeUiSetStatus("stop refused \u2014 no module selected (pick one in the library)", "err");
    return false;
  }
  const f = avCodeUiFns();
  if (!f.remove) { avCodeUiSetStatus("stop refused \u2014 the module engine (av_code.js) is not loaded", "err"); return false; }
  let out = null;
  try { out = f.remove(id); } catch (e) { out = { ok: false, error: avCodeUiErrText(e, "the remove threw") }; }
  if (out && typeof out.then === "function") {
    /* the facade round-trips the engine (sync bool OR promise) — settle on its reply */
    avCodeUiSetBusy("remove", "removing " + id + "\u2026");
    const settled = { v: false };
    const done = function (r) {
      if (settled.v) return;
      settled.v = true;
      avCodeUiRemoveSettle(r, id);
    };
    try { out.then(done, function (err) { done({ ok: false, error: avCodeUiErrText(err, "the remove failed") }); }); }
    catch (e2) { done({ ok: false, error: avCodeUiErrText(e2, "the remove failed") }); }
    return true;
  }
  return avCodeUiRemoveSettle(out, id);
}

function avCodeUiRemoveSettle(r, id) {
  const s = avCodeUiState;
  avCodeUiClearBusy();
  let ok = true;
  try {
    if (r === false || r === null) ok = false;
    else if (r && typeof r === "object" && r.ok === false) ok = false;
    if (ok) {
      let txt = "removed " + id;
      if (r && typeof r === "object" && typeof r.note === "string" && r.note) txt += " (" + avCodeUiClean(r.note, 60) + ")";
      s.statusMsg = txt;
      s.statusKind = "msg";
      if (s.selected === id) { s.selected = ""; s.lastParamsSig = ""; avCodeUiClearSchema(id); }
    } else {
      s.statusMsg = avCodeUiErrText(r, "the module could not be removed");
      s.statusKind = "err";
    }
  } catch (e) { /* settle never throws */ }
  avCodeUiSync();
  return ok;
}

function avCodeUiStop() {
  const id = avCodeUiTargetId();
  if (!id) { avCodeUiSetStatus("stop refused \u2014 no module selected (pick one in the library)", "err"); return false; }
  return avCodeUiRemove(id);
}

function avCodeUiEnable(id, on) {
  const s = avCodeUiState;
  if (s.busy) return avCodeUiBusyRefuse();
  if (typeof id !== "string" || !id) return false;
  const f = avCodeUiFns();
  if (!f.enable) { avCodeUiSetStatus("the toggle is unavailable \u2014 the module engine (av_code.js) is not loaded", "err"); return false; }
  let out = null;
  try { out = f.enable(id, !!on); } catch (e) { out = { ok: false, error: avCodeUiErrText(e, "the toggle threw") }; }
  if (out && typeof out.then === "function") {
    avCodeUiSetBusy("toggle", (on ? "enabling " : "disabling ") + id + "\u2026");
    const settled = { v: false };
    const done = function (r) {
      if (settled.v) return;
      settled.v = true;
      avCodeUiEnableSettle(r, id, on);
    };
    try { out.then(done, function (err) { done({ ok: false, error: avCodeUiErrText(err, "the toggle failed") }); }); }
    catch (e2) { done({ ok: false, error: avCodeUiErrText(e2, "the toggle failed") }); }
    return true;
  }
  return avCodeUiEnableSettle(out, id, on);
}

function avCodeUiEnableSettle(r, id, on) {
  const s = avCodeUiState;
  avCodeUiClearBusy();
  let ok = true;
  try {
    if (r === false || r === null) ok = false;
    else if (r && typeof r === "object" && r.ok === false) ok = false;
    if (ok) {
      let txt = (on ? "enabled " : "disabled ") + id;
      if (!on && r && typeof r === "object" && r.removed === false) txt += " (it was not loaded in the engine)";
      s.statusMsg = txt;
      s.statusKind = "msg";
    } else {
      s.statusMsg = avCodeUiErrText(r, "the engine refused the toggle");
      s.statusKind = "err";
    }
  } catch (e) { /* settle never throws */ }
  avCodeUiSync();
  return ok;
}

function avCodeUiEdit(id) {
  const s = avCodeUiState;
  if (s.busy) return avCodeUiBusyRefuse();
  const f = avCodeUiFns();
  if (!f.exportText) { avCodeUiSetStatus("editing is unavailable \u2014 the module engine (av_code.js) is not loaded", "err"); return false; }
  let txt = null;
  try { txt = f.exportText(id); } catch (e) { txt = null; }
  if (typeof txt !== "string" || !txt) { avCodeUiSetStatus("cannot load \"" + id + "\" for editing \u2014 the engine returned no text", "err"); return false; }
  let obj = null;
  try { obj = JSON.parse(txt); } catch (e) { obj = null; }
  if (!obj || typeof obj.src !== "string") { avCodeUiSetStatus("cannot load \"" + id + "\" for editing \u2014 the export text is unreadable", "err"); return false; }
  const host = avCodeUiHost();
  if (!host) return false;
  avCodeUiSetInput(host, "#av-code-id", (typeof obj.id === "string" && obj.id) ? obj.id : id);
  avCodeUiSetInput(host, "#av-code-name", (typeof obj.name === "string" && obj.name) ? obj.name : id);
  avCodeUiSetInput(host, "#av-code-kind", (obj.kind === "kind") ? "kind" : "fx");
  avCodeUiSetInput(host, "#av-code-src", obj.src);
  s.selected = id;
  s.lastParamsSig = "";
  avCodeUiClearSchema(id);
  s.statusMsg = "editing " + id + " \u2014 RUN sends it back to the engine";
  s.statusKind = "msg";
  avCodeUiSync();
  return true;
}

/* the local anchor download (used when avDeliverDownload is absent or refused) */
function avCodeUiAnchor(bytes, name, mime) {
  try {
    const d = avCodeUiDoc();
    const w = avCodeUiWin();
    if (!d || typeof d.createElement !== "function") return false;
    if (typeof Blob !== "function" || !w || !w.URL || typeof w.URL.createObjectURL !== "function") return false;
    const url = w.URL.createObjectURL(new Blob([bytes], { type: mime || "application/octet-stream" }));
    const a = d.createElement("a");
    a.href = url;
    a.download = name;
    try { a.rel = "noopener"; } catch (e) { /* attribute refused */ }
    const body = d.body;
    let attached = false;
    if (body && typeof body.appendChild === "function") { try { body.appendChild(a); attached = true; } catch (e) { attached = false; } }
    try { a.click(); } catch (e) { /* a click never throws outward here */ }
    if (attached && body && typeof body.removeChild === "function") { try { body.removeChild(a); } catch (e) { /* ok */ } }
    try { if (typeof setTimeout === "function") setTimeout(function () { try { w.URL.revokeObjectURL(url); } catch (e) { /* ok */ } }, 8000); } catch (e) { /* ok */ }
    return true;
  } catch (e) { return false; }
}

function avCodeUiExport(idArg) {
  const s = avCodeUiState;
  if (s.busy) return avCodeUiBusyRefuse();
  const f = avCodeUiFns();
  const id = (typeof idArg === "string" && idArg) ? idArg : avCodeUiTargetId();
  if (!id) { avCodeUiSetStatus("export refused \u2014 select a module in the library first", "err"); return false; }
  if (!f.exportText) { avCodeUiSetStatus("export refused \u2014 the module engine (av_code.js) is not loaded", "err"); return false; }
  let txt = null;
  try { txt = f.exportText(id); } catch (e) { txt = null; }
  if (typeof txt !== "string" || !txt) { avCodeUiSetStatus("export refused \u2014 the engine returned no text for \"" + id + "\"", "err"); return false; }
  const name = id + ".avmod";
  const bytes = avCodeUiUtf8(txt);
  let ok = false, via = "";
  if (typeof avDeliverDownload === "function") {
    try { ok = (avDeliverDownload(bytes, name) === true); if (ok) via = "deliver"; } catch (e) { ok = false; }
  }
  if (!ok) { ok = avCodeUiAnchor(bytes, name, "application/json"); if (ok) via = "anchor"; }
  if (ok) { s.statusMsg = "exported " + name + " \u00b7 " + avCodeUiFmtBytes(bytes.length) + " \u00b7 via " + via; s.statusKind = "msg"; }
  else { s.statusMsg = "export failed \u2014 the browser refused the download"; s.statusKind = "err"; }
  avCodeUiSync();
  return ok;
}

/* read a chosen file as text (file.text() first; FileReader fallback) — never rejects */
function avCodeUiFileText(file) {
  return new Promise(function (resolve) {
    try {
      if (file && typeof file.text === "function") {
        Promise.resolve(file.text()).then(
          function (t) { resolve(typeof t === "string" ? t : ""); },
          function () { resolve(null); }
        );
        return;
      }
      if (typeof FileReader === "function") {
        const fr = new FileReader();
        fr.onload = function () { resolve(typeof fr.result === "string" ? fr.result : null); };
        fr.onerror = function () { resolve(null); };
        fr.readAsText(file);
        return;
      }
    } catch (e) { /* fall through */ }
    resolve(null);
  });
}

function avCodeUiImportSettle(r0, fileName) {
  const s = avCodeUiState;
  avCodeUiClearBusy();
  try {
    if (avCodeUiStatusOK(r0)) {
      const id = (typeof r0.id === "string" && r0.id) ? r0.id : "";
      if (id) { s.selected = id; s.lastParamsSig = ""; avCodeUiClearSchema(); }
      let txt = "imported " + (id || (fileName ? fileName.replace(/\.avmod$/i, "") : "module"));
      if (r0.kind === "kind" && isFinite(Number(r0.kindId))) txt += " \u00b7 kindId " + Math.round(Number(r0.kindId));
      const ipc = Array.isArray(r0.params) ? r0.params.length : ((r0.params && typeof r0.params === "object") ? Object.keys(r0.params).length : -1);
      if (ipc >= 0) txt += " \u00b7 " + ipc + " param" + (ipc === 1 ? "" : "s");
      s.statusMsg = txt;
      s.statusKind = "msg";
    } else {
      s.statusMsg = avCodeUiErrText(r0, "the import was refused");
      s.statusKind = "err";
    }
  } catch (e) { /* settle never throws */ }
  avCodeUiSync();
}

function avCodeUiImportFile(file) {
  const s = avCodeUiState;
  if (!file) return false;
  if (s.busy) return avCodeUiBusyRefuse();
  const f = avCodeUiFns();
  if (!f.importText) { avCodeUiSetStatus("import refused \u2014 the module engine (av_code.js) is not loaded", "err"); return false; }
  s.importName = avCodeUiClean(file.name != null ? file.name : "", 60);
  avCodeUiSetBusy("import", "importing " + (s.importName || "module") + "\u2026");
  const settled = { v: false };
  const done = function (r) {
    if (settled.v) return;
    settled.v = true;
    avCodeUiImportSettle(r, s.importName);
  };
  avCodeUiFileText(file).then(function (txt) {
    if (typeof txt !== "string" || !txt) { done({ ok: false, error: "the file could not be read" }); return; }
    let p = null;
    try { p = f.importText(txt); }
    catch (e) { done({ ok: false, error: avCodeUiErrText(e, "the import threw") }); return; }
    try { Promise.resolve(p).then(done, function (err) { done({ ok: false, error: avCodeUiErrText(err, "the import failed") }); }); }
    catch (e) { done({ ok: false, error: avCodeUiErrText(e, "the import failed") }); }
  });
  return true;
}

/* load an example into the editor (src from the cached rows, or avCodeExample(key)) */
function avCodeUiLoadExample(key) {
  const s = avCodeUiState;
  if (s.busy) return avCodeUiBusyRefuse();
  let e = null;
  for (let i = 0; i < s.examples.length; i++) if (s.examples[i].key === key) { e = s.examples[i]; break; }
  let src = e && e.src ? e.src : "";
  if (!src) {
    const f = avCodeUiFns();
    if (f.example) {
      try { const t = f.example(key); if (typeof t === "string") src = t; } catch (err) { src = ""; }
    }
  }
  if (!src) { avCodeUiSetStatus("the example \"" + avCodeUiClean(key, 32) + "\" is not available from the engine", "err"); return false; }
  const host = avCodeUiHost();
  if (!host) return false;
  avCodeUiSetInput(host, "#av-code-id", key);
  avCodeUiSetInput(host, "#av-code-name", (e && e.name) ? e.name : key);
  avCodeUiSetInput(host, "#av-code-kind", (e && e.kind === "kind") ? "kind" : "fx");
  avCodeUiSetInput(host, "#av-code-src", src);
  s.statusMsg = "example \"" + key + "\" loaded into the editor \u2014 press RUN to add it";
  s.statusKind = "msg";
  avCodeUiSync();
  return true;
}

/* ---------- event delegation (one click + one change listener per host) ---------- */

function avCodeUiClick(ev) {
  try {
    const t = ev && ev.target;
    if (!t || typeof t.closest !== "function") return;
    const exBtn = t.closest("[data-av-code-example]");
    if (exBtn) {
      const key = String((exBtn.getAttribute && exBtn.getAttribute("data-av-code-example")) || "");
      if (key) avCodeUiLoadExample(key);
      return;
    }
    const act = t.closest("[data-av-code-act]");
    if (act) {
      if (act.disabled === true) return;
      const rowEl = act.closest("[data-av-code-row]");
      const id = rowEl ? String((rowEl.getAttribute && rowEl.getAttribute("data-av-code-row")) || "") : "";
      const what = String((act.getAttribute && act.getAttribute("data-av-code-act")) || "");
      if (!id) return;
      if (what === "enable") {
        const pressed = String((act.getAttribute && act.getAttribute("aria-pressed")) || "true");
        avCodeUiEnable(id, pressed !== "true");
        return;
      }
      if (what === "edit") { avCodeUiEdit(id); return; }
      if (what === "export") { avCodeUiExport(id); return; }
      if (what === "delete") { avCodeUiRemove(id); return; }   /* immediate — the studio take-✕ precedent */
    }
    const row = t.closest("[data-av-code-row]");
    if (row) {
      const id = String((row.getAttribute && row.getAttribute("data-av-code-row")) || "");
      if (id && avCodeUiState.selected !== id) {
        avCodeUiState.selected = id;
        avCodeUiState.lastParamsSig = "";
        avCodeUiSync();
      }
      return;
    }
    if (t.closest("#av-code-check")) { avCodeUiCheck(); return; }
    if (t.closest("#av-code-run")) { avCodeUiRun(); return; }
    if (t.closest("#av-code-stop")) { avCodeUiStop(); return; }
    if (t.closest("#av-code-export")) { avCodeUiExport(""); return; }
  } catch (err) { /* a listener never throws outward */ }
}

function avCodeUiChange(ev) {
  try {
    const t = ev && ev.target;
    if (!t || typeof t.closest !== "function") return;
    if (t.closest("#av-code-import")) {
      const file = (t.files && t.files[0]) ? t.files[0] : null;
      try { t.value = ""; } catch (e) { /* the picker resets so the same file can be picked again */ }
      if (file) avCodeUiImportFile(file);
      return;
    }
  } catch (err) { /* a listener never throws outward */ }
}

function avCodeUiWire(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  try {
    if (host.dataset && host.dataset.avCodeUiWired === "1") return true;   /* one delegation per host element */
    if (host.dataset) host.dataset.avCodeUiWired = "1";
    host.addEventListener("click", avCodeUiClick);
    host.addEventListener("change", avCodeUiChange);
    return true;
  } catch (e) { return false; }
}

/* ---------- the light change poll (restored modules surface after boot; no loop churn) ---------- */

function avCodeUiListSig() {
  const e = avCodeUiEngine();
  let sig = (e.ok ? e.engine : "no") + "|" + (e.count == null ? "?" : e.count) + "|" + e.poisoned + "|" + avCodeUiState.selected + "|";
  const rows = avCodeUiRows();
  if (rows) {
    for (let i = 0; i < rows.length; i++) {
      sig += rows[i].id + "," + (rows[i].enabled ? 1 : 0) + "," + (rows[i].ready ? 1 : 0) + "," + (rows[i].poisoned ? 1 : 0) + ";";
    }
  } else sig += "none";
  return sig;
}

function avCodeUiPoll() {
  const s = avCodeUiState;
  if (!s.inited || s.busy) return false;
  let sig = "";
  try { sig = avCodeUiListSig(); } catch (e) { sig = "err"; }
  if (sig === s.pollSig) return false;
  s.pollSig = sig;
  avCodeUiSync();
  return true;
}

function avCodeUiStartPoll() {
  try {
    const s = avCodeUiState;
    if (s.poll || typeof setInterval !== "function") return false;
    s.poll = setInterval(function () { try { avCodeUiPoll(); } catch (e) { /* a poll never throws */ } }, AV_CODE_UI_POLL_MS);
    return true;
  } catch (e) { return false; }
}

/* ---------- markup (pure string builders) ---------- */

function avCodeUiBodyHTML() {
  return '<div class="av-code" data-av-code="1">' +
    '<div class="av-code-head"><span class="av-code-title">CODE</span>' +
    '<span class="av-code-cap av-dim">write your own modules \u2014 an fx insert or a whole voice kind \u2014 sandboxed inside the audio engine: CHECK lints it without running, RUN loads it live, EXPORT saves it as a .avmod.</span></div>' +
    '<div class="av-code-status-line"><span class="av-code-status av-code-msg" id="av-code-status" role="status">code idle</span></div>' +

    '<div class="av-code-cols">' +
    '<section class="av-code-sec av-code-sec-edit">' +
    '<div class="av-code-sec-title">EDITOR</div>' +
    '<div class="av-code-fields">' +
    '<label class="av-code-field"><span class="av-code-field-lbl">ID</span>' +
    '<input type="text" class="av-code-in av-mono" id="av-code-id" spellcheck="false" autocomplete="off" placeholder="my-module" title="a-z \u00b7 0-9 \u00b7 _ \u00b7 - \u2014 a letter first, max 32 chars"></label>' +
    '<label class="av-code-field"><span class="av-code-field-lbl">NAME</span>' +
    '<input type="text" class="av-code-in" id="av-code-name" spellcheck="false" autocomplete="off" placeholder="My Module"></label>' +
    '<label class="av-code-field"><span class="av-code-field-lbl">KIND</span>' +
    '<select class="av-select av-code-kind" id="av-code-kind" aria-label="module kind \u2014 fx insert or voice kind">' +
    '<option value="fx">fx \u2014 an insert effect</option>' +
    '<option value="kind">kind \u2014 a voice engine</option>' +
    "</select></label>" +
    "</div>" +
    '<textarea class="av-code-src av-mono" id="av-code-src" spellcheck="false" wrap="off" rows="12" aria-label="module source" placeholder="// anvil module source \u2014 api: 1 \u2014 CHECK lints it, RUN loads it"></textarea>' +
    '<div class="av-code-actions">' +
    '<button type="button" class="av-btn mini av-code-btn" id="av-code-check" title="lint the source without running it: id charset \u00b7 api gate \u00b7 param schema">CHECK</button>' +
    '<button type="button" class="av-btn mini av-code-btn" id="av-code-run" title="send the editor to the engine \u2014 it validates, then loads the module">RUN</button>' +
    '<button type="button" class="av-btn mini av-code-btn" id="av-code-stop" title="remove the selected module from the engine and the library">STOP</button>' +
    '<button type="button" class="av-btn mini av-code-btn" id="av-code-export" title="save the selected module as a .avmod file">EXPORT</button>' +
    '<label class="av-btn mini av-code-btn av-code-file" title="load a .avmod file back in \u2014 it lands in the engine and the library">IMPORT' +
    '<input type="file" class="av-code-import" id="av-code-import" hidden accept=".avmod,application/json,text/plain"></label>' +
    "</div>" +
    '<div class="av-code-examples" id="av-code-examples" role="group" aria-label="example modules"></div>' +
    "</section>" +

    '<section class="av-code-sec av-code-sec-lib">' +
    '<div class="av-code-sec-title">LIBRARY</div>' +
    '<div class="av-code-list" id="av-code-list" role="list"></div>' +
    '<p class="av-code-note av-code-none av-dim" id="av-code-none">no user modules yet \u2014 load an example or write one, then press RUN.</p>' +
    "</section>" +
    "</div>" +

    '<section class="av-code-sec av-code-sec-params">' +
    '<div class="av-code-sec-title">PARAMS</div>' +
    '<div class="av-code-params" id="av-code-params"></div>' +
    '<p class="av-code-note av-code-params-note av-dim" id="av-code-params-note">select a module to see its controls</p>' +
    "</section>" +

    '<section class="av-code-sec av-code-sec-docs">' +
    '<div class="av-code-sec-title">CONTRACT</div>' +
    '<div class="av-code-docs" id="av-code-docs"></div>' +
    "</section>" +

    '<p class="av-code-note av-code-degrade av-dim" id="av-code-note" hidden></p>' +
    '<p class="av-code-foot av-note av-dim">modules run inside the audio engine \u2014 no DOM, no network, no imports in the audio scope. A module that throws is disabled after four throws and never takes the engine down. Everything stays on this machine.</p>' +
    "</div>";
}

/* #av-code root: the parent adds its own `#av-code` card; this root takes the id only when no
   such element exists (never a duplicate id) */
function avCodeUiEnsureRootId(root) {
  try {
    if (!root) return false;
    if (root.id) return false;
    const d = avCodeUiDoc();
    const existing = (d && typeof d.getElementById === "function") ? d.getElementById("av-code") : null;
    if (existing && existing !== root) return false;
    root.id = "av-code";
    return true;
  } catch (e) { return false; }
}

/* ---------- init / snap / classes ---------- */

function avCodeUiInit() {
  const host = avCodeUiHost();
  if (!host) return false;
  try {
    const s = avCodeUiState;
    let root = null;
    try { root = (typeof host.querySelector === "function") ? host.querySelector(".av-code") : null; } catch (e) { root = null; }
    if (!root) {
      /* re-mount into fresh markup: reset the memos so the first paint lands */
      s.memos.text = {};
      s.memos.cls = {};
      s.lastListHtml = null;
      s.lastListSig = "";
      s.lastParamsSig = "";
      s.schemaId = ""; s.schemaKey = ""; s.schemaMap = null;
      s.lastDocsSig = "";
      s.examplesKey = "__init__";
      host.innerHTML = avCodeUiBodyHTML();
      try { root = (typeof host.querySelector === "function") ? host.querySelector(".av-code") : null; } catch (e2) { root = null; }
    }
    avCodeUiEnsureRootId(root);
    avCodeUiWire(host);
    s.inited = true;
    s.mounts += 1;
    avCodeUiStartPoll();
    avCodeUiSync();
    return true;
  } catch (e) { return false; }
}

function avCodeUiSnap() {
  const host = avCodeUiHost();
  const s = avCodeUiState;
  const rows = avCodeUiRows();
  const e = avCodeUiEngine();
  const out = {
    version: AV_CODE_UI_VERSION,
    inited: !!s.inited,
    mounts: s.mounts,
    host: !!host,
    root: false,
    wired: !!(host && host.dataset && host.dataset.avCodeUiWired === "1"),
    selected: s.selected,
    busy: !!s.busy,
    busyOp: s.busyOp,
    status: s.statusMsg,
    statusKind: s.statusKind,
    engine: { ok: !!e.ok, engine: e.ok ? e.engine : "", count: e.count, poisoned: e.poisoned, why: e.ok ? "" : e.why },
    rows: rows ? rows.length : null,
    examples: s.examples.length,
    classes: avCodeUiClasses(),
  };
  try {
    if (host && typeof host.querySelector === "function") out.root = !!host.querySelector(".av-code");
  } catch (e2) { /* no DOM */ }
  return out;
}

function avCodeUiClasses() {
  return AV_CODE_UI_CLASSES.slice();
}

/* ---------- debug/verify handle ---------- */

if (typeof window !== "undefined") {
  try {
    window.__avCodeUi = {
      version: AV_CODE_UI_VERSION,
      init: function () { return avCodeUiInit(); },
      sync: function () { return avCodeUiSync(); },
      classes: function () { return avCodeUiClasses(); },
      snap: function () { return avCodeUiSnap(); },
      state: function () { return avCodeUiSnap(); },
    };
  } catch (e) { /* no window — nothing to publish */ }
}
