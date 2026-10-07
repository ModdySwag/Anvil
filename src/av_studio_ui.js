/* Anvil — S1 STUDIO card (child sa-D): the record-core UI mounted into the parent-owned host
   `#av-studio-host` (the parent adds the `#av-studio` card at integration and calls
   avStudioUiInit(); this module only fills the host). Per verify/_s1_wave.md §2.4.

   WHAT THIS CARD IS
   - INPUT section: ENABLE toggle (avInputEnable / avInputDisable), device select refreshed on
     enable (avInputDevices), GAIN range 0..1.2 + readout (avInputGain), MONITOR toggle
     (avInputMonitor, OFF by default - feedback safety), OFFSET ms number (avInputOffset,
     -200..200), a latency note (avInputLatency) and a level meter driven by the rAF loop
     reading avInputLevels() (peak bar + rms bar + numeric readout).
   - TRANSPORT section: count-in select 0 / 1 / 2 bars, METRONOME toggle + LEVEL range
     (avMetroSet / avMetroState merged as { on, level, beatsPerBar, accent }).
   - TAKES section: REC/STOP button orchestrating the pinned record path -
     count-in > 0 -> await avMetroCountIn(bars) -> avTakesStart({ lapSync: true });
     STOP -> avTakesStop(). Rows: name · seconds · lap · EXPORT · X. KEEP LAST select
     (avTakesKeepLast). Status line + warnings area.

   LAW: every sibling control is consumed through the pinned API names with typeof guards ONLY -
   avInputEnable/Disable/Devices/Levels/Gain/Monitor/Offset/Latency/State ·
   avMetroSet/State/CountIn · avTakesStart/Stop/Arm/List/Export/Delete/KeepLast/State.
   This file never reaches into another module's internals and never calls the siblings' Init
   functions (app_core owns those boots). It never throws. No console noise at all (degradation
   is reported in the warnings area, never console.warn). No DOM at top level - the file loads
   in plain node (harness).

   ORCHESTRATION DECISIONS (documented seams for the parent):
   - REC passes { lapSync: true }: lap takes auto-split at cycle boundaries while the sequencer
     plays; with no transport the recorder keeps one continuous take (sa-C's own law). The UI
     does not expose a lap toggle (not in §2.4).
   - count-in is a nicety, never a blocker: if avMetroCountIn is missing, refuses
     ({ok:false}) or throws, the recording still starts and the warnings area carries the
     honest note. A count-in already running can be cancelled by pressing REC/STOP again
     (generation-guarded: the late count-in resolution is ignored).
   - REC is ignored while the start receipt is in flight and while a take is being finished
     (fractions of a second); it also refuses honestly when the input is known-disabled.
   - the device select lists the devices (refreshed on enable). The pinned avInputEnable()
     takes NO device argument, so live switching cannot be applied by this pin - picking a
     device shows an honest note instead of a disruptive re-acquire dance. When a future pin
     accepts a device argument, avStudioUiDeviceChange() is the one seam to extend.
   - KEEP LAST offers 1/2/4/8/16/32 (default 8). The pin's 0..32 range is not fully exposed:
     0's semantics ("keep all"? "keep none"?) are unpinned, so the UI never sends 0.
   - avInputState() / avTakesState() field names are unpinned; this card reads them through
     candidate lists (enabled/on/active... monitor/monitoring... recording/rec/active...,
     keepLast/keep...) and only overrides its mirror on an explicit boolean/0/1/on/off read.
     Unknown shapes change nothing.
   - the recording flag is adopted from avTakesState() by the rAF poll (external start/stop
     stays honest); the poll never fights a transient phase (count-in / starting / stopping).
   - if no take handle can be opened (no receipt.url and no blob->objectURL), the status line
     says so honestly instead of pretending a download happened.

   FAILURE COPY: honest refusals surface the module's own error text (normalized) in the status
   line + warnings area - e.g. takes' "input not enabled" reads as "the input is not enabled -
   press ENABLE first".

   OBSERVABLES: avStudioUiInit() -> bool (false without host, never throws, idempotent,
   dataset marker avStudioUiWired='1') · avStudioUiSync() -> bool (repaint) ·
   avStudioUiClasses() -> string[] (the NEW css classes; the parent styles them) ·
   avStudioUiSnap() -> the honest card state ·
   window.__avStudioUi = { version, init, sync, classes, state, rec, stop, export, del,
   devices, arm } · window.__avStudioUiLastExport = { id, name, bytes, downloaded, at } stamp.

   ID INVENTORY (rig + parent rely on these):
     #av-studio-status
     #av-studio-enable · #av-studio-input-state · #av-studio-device
     #av-studio-gain · #av-studio-gain-val · #av-studio-monitor · #av-studio-offset
     #av-studio-meter · #av-studio-meter-bar · #av-studio-meter-rms · #av-studio-meter-val
     #av-studio-latency
     #av-studio-countin · #av-studio-metro · #av-studio-metro-level · #av-studio-metro-val
     #av-studio-metro-bpm
     #av-studio-rec · #av-studio-keep · #av-studio-take-n · #av-studio-takes
     #av-studio-takes-none · #av-studio-warnings · #av-studio-foot
   CARD HOOKS: `.av-studio[data-av-studio="1"]` · `.av-studio-take[data-take]` (state class
   `partial`) · `[data-act=export]` · `[data-act=del]` · `.av-studio-rec` (state class `on`).

   ONE namespace avStudioUi* / AV_STUDIO_UI_*. ONE writer (child sa-D). Never throws. */

"use strict";

const AV_STUDIO_UI_VERSION = "s1.0";
const AV_STUDIO_UI_WARN_MAX = 8;
const AV_STUDIO_UI_KEEP_OPTS = [1, 2, 4, 8, 16, 32];
const AV_STUDIO_UI_KEEP_DEFAULT = 8;
const AV_STUDIO_UI_METER_REF = 1.2;   /* meter full scale = the pinned input gain ceiling */

/* UI-local state only - every module fact is read through the pinned av* APIs per paint */
const avStudioUiState = {
  inited: false, mounts: 0, rafOn: false,
  /* input mirror */
  inputKnown: false, inputEnabled: false, enableBusy: false,
  monitorOn: false, gain: 1, offsetMs: 0,
  deviceLabel: "", inputDeviceId: "", deviceWanted: "", devices: [], devicesKey: "",
  /* transport mirror */
  countIn: 0, metroOn: false, metroLevel: 0.5, metroBeats: 4, metroAccent: true, metroBpm: 0,
  /* takes mirror */
  keepLast: AV_STUDIO_UI_KEEP_DEFAULT, exportingId: "",
  /* record orchestration */
  recPhase: "idle",           /* idle | countin | starting | recording | stopping */
  recSeq: 0, recStartedAt: 0,
  /* status + warnings */
  lastMsg: "", lastMsgKind: "msg",
  warnings: [], warnKey: "",
  /* paint memos */
  takesKey: "",
  meterPPct: 0, meterAt: 0, meterZero: true, meterLastTxt: "",
  /* poll throttle */
  pollAt: 0, lastObjectUrl: "",
};

/* ---------- small pure helpers (no DOM; harness-covered) ---------- */

const avStudioUiEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const avStudioUiNum = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };

function avStudioUiClean(s, max) {
  let t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  if (max && t.length > max) t = t.slice(0, max - 1) + "\u2026";
  return t;
}

function avStudioUiClamp(n, lo, hi, d) {
  const v = Number(n);
  if (!isFinite(v)) return (d === undefined ? null : d);
  return Math.max(lo, Math.min(hi, v));
}

/* count-in bars: 0..2 int (the §2.4 select), anything unreadable -> 0 (off) */
function avStudioUiBars(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(2, Math.floor(n)));
}

/* keep-last: 1..32 int, default 8 (0 is intentionally never sent - see the header seam) */
function avStudioUiKeepN(v) {
  const n = Number(v);
  if (!isFinite(n)) return AV_STUDIO_UI_KEEP_DEFAULT;
  return Math.max(1, Math.min(32, Math.round(n)));
}

function avStudioUiSecs(frames, rate) {
  const f = Number(frames);
  const r = Number(rate);
  const fr = (isFinite(f) && f > 0) ? f : 0;
  const rr = (isFinite(r) && r > 0) ? r : 48000;
  return fr / rr;
}

function avStudioUiSecsTextFromSecs(secs) {
  const s = avStudioUiClamp(secs, 0, 1e9, 0);
  if (s >= 100) return s.toFixed(1) + " s";
  return s.toFixed(2) + " s";
}

function avStudioUiSecsText(frames, rate) {
  return avStudioUiSecsTextFromSecs(avStudioUiSecs(frames, rate));
}

function avStudioUiLapText(meta) {
  const m = (meta && typeof meta === "object") ? meta : {};
  const lap = Number(m.lap);
  let out = (isFinite(lap) && lap >= 1) ? ("lap " + Math.round(lap)) : "\u2014";
  if (m.partial === true) out = (out === "\u2014" ? "" : out + " \u00b7 ") + "partial";
  return out;
}

/* one take-meta -> the row view (name · seconds · lap; pure) */
function avStudioUiTakeView(meta, i) {
  const m = (meta && typeof meta === "object") ? meta : {};
  const idx = Math.max(0, Math.floor(Number(i) || 0));
  const id = (typeof m.id === "string" && m.id) ? m.id : ("t" + (idx + 1));
  const name = (typeof m.name === "string" && m.name) ? m.name : ("Take " + (idx + 1));
  const frames = avStudioUiNum(m.frames, 0);
  const rate = avStudioUiNum(m.rate, 48000);
  const lap = avStudioUiNum(m.lap, null);
  const partial = m.partial === true;
  return {
    id: id,
    name: avStudioUiClean(name, 48) || ("Take " + (idx + 1)),
    frames: frames,
    rate: rate,
    lap: lap,
    partial: partial,
    secsText: avStudioUiSecsText(frames, rate),
    lapText: avStudioUiLapText({ lap: lap, partial: partial }),
  };
}

function avStudioUiTakeRowHTML(v) {
  const t = (v && typeof v === "object") ? v : {};
  const id = avStudioUiEsc(t.id);
  return '<div class="av-studio-take' + (t.partial ? " partial" : "") + '" data-take="' + id + '">' +
    '<span class="av-studio-take-name" title="' + id + '">' + avStudioUiEsc(t.name) + "</span>" +
    '<span class="av-studio-take-secs">' + avStudioUiEsc(t.secsText) + "</span>" +
    '<span class="av-studio-take-lap">' + avStudioUiEsc(t.lapText) + "</span>" +
    '<button type="button" class="av-btn mini av-studio-btn av-studio-take-export" data-act="export" title="Encode this take to a WAV and download it">EXPORT</button>' +
    '<button type="button" class="av-btn mini av-studio-btn av-studio-take-del" data-act="del" title="Delete this take">\u2715</button>' +
    "</div>";
}

/* the memo key for the takes list (repaint only on real change) */
function avStudioUiTakesKey(views) {
  try {
    if (!Array.isArray(views)) return "";
    let out = "";
    for (let i = 0; i < views.length && i < 64; i++) {
      const v = views[i] || {};
      out += String(v.id || "") + ":" + String(v.frames || 0) + ":" + (v.partial ? 1 : 0) + ":" + (v.lap == null ? 0 : v.lap) + "|";
    }
    return out;
  } catch (e) { return ""; }
}

/* avInputDevices() list -> [{ value, label }] select options (pure) */
function avStudioUiDeviceOptions(list) {
  const out = [];
  try {
    if (!Array.isArray(list)) return out;
    let n = 0;
    for (let i = 0; i < list.length && out.length < 32; i++) {
      const d = list[i];
      if (!d || typeof d !== "object") continue;
      const value = (typeof d.deviceId === "string" && d.deviceId) ? d.deviceId
        : ((typeof d.id === "string" && d.id) ? d.id : "");
      if (!value) continue;
      n += 1;
      const label = (typeof d.label === "string" && d.label) ? d.label : ("input " + n);
      out.push({ value: value, label: avStudioUiClean(label, 48) });
    }
  } catch (e) { /* none */ }
  return out;
}

/* meter width percent over the pinned 1.2 full scale (pure) */
function avStudioUiMeterPct(v) {
  const n = avStudioUiNum(v, 0);
  const x = Math.max(0, Math.min(1, n / AV_STUDIO_UI_METER_REF));
  return Math.round(x * 1000) / 10;
}

/* module errors -> honest one-liners (the raw text is kept when nothing matches) */
function avStudioUiErrText(err) {
  let raw = "";
  try { raw = String((err && err.message) ? err.message : (err == null ? "" : err)); } catch (e) { raw = ""; }
  raw = raw.replace(/\s+/g, " ").trim().slice(0, 140);
  const e = raw.toLowerCase();
  if (/input not enabled|no input|input disabled/.test(e)) return "the input is not enabled \u2014 press ENABLE first";
  if (/notallowed|permission|denied/.test(e)) return "the browser refused the microphone \u2014 grant permission and retry";
  if (/no ctx|no audio ?context|no context|context (is )?(closed|missing)|not initialized/.test(e)) return "no live audio context \u2014 start the engine first, then record";
  if (/notfound|no device|no microphone|overconstrained/.test(e)) return "no audio input device was found";
  if (/busy|in use/.test(e)) return "the audio device is busy in another tab";
  return raw || "refused";
}

function avStudioUiFmtBytes(n) {
  const v = Number(n);
  if (!isFinite(v) || v < 0) return "";
  if (v < 1024) return Math.round(v) + " B";
  if (v < 1048576) return (v / 1024).toFixed(1) + " KB";
  return (v / 1048576).toFixed(2) + " MB";
}

/* receipt verdict: explicit false / {ok:false} refuse; everything else (incl. undefined)
   counts as success - the pinned receipts only refuse explicitly (§2.1/§2.3) */
function avStudioUiOK(r) {
  try {
    if (r === false || r === null) return false;
    if (r && typeof r === "object" && r.ok === false) return false;
    return true;
  } catch (e) { return false; }
}

/* warnings list helpers (pure) - dedupe by key, newest last, bounded */
function avStudioUiWarnMerge(list, key, text, max) {
  const out = [];
  try {
    const src = Array.isArray(list) ? list : [];
    for (let i = 0; i < src.length; i++) {
      const w = src[i];
      if (!w || w.key === key) continue;
      out.push(w);
    }
    out.push({ key: key, text: text });
    while (out.length > (max || AV_STUDIO_UI_WARN_MAX)) out.shift();
  } catch (e) { /* keep what we have */ }
  return out;
}

function avStudioUiWarnDrop(list, key) {
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

/* boolean flag read from a state object: explicit true/false/1/0/on/off only */
function avStudioUiFlagFrom(obj, keys) {
  try {
    if (!obj || typeof obj !== "object" || !Array.isArray(keys)) return null;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      const v = obj[k];
      if (v === true || v === 1 || v === "on" || v === "true") return true;
      if (v === false || v === 0 || v === "off" || v === "false") return false;
    }
  } catch (e) { /* unknown */ }
  return null;
}

function avStudioUiNumField(obj, keys) {
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

function avStudioUiStrField(obj, keys) {
  try {
    if (!obj || typeof obj !== "object" || !Array.isArray(keys)) return "";
    for (let i = 0; i < keys.length; i++) {
      const v = obj[keys[i]];
      if (typeof v === "string" && v) return v;
    }
  } catch (e) { /* none */ }
  return "";
}

/* ---------- guarded DOM access (no throw, no noise) ---------- */

function avStudioUiHost() {
  try {
    if (typeof document !== "undefined" && document && typeof document.getElementById === "function") {
      return document.getElementById("av-studio-host");
    }
  } catch (e) { /* no document */ }
  return null;
}

function avStudioUiSetValue(el, v) {
  try {
    if (!el) return false;
    const str = String(v == null ? "" : v);
    let focused = false;
    try { if (typeof document !== "undefined" && document && document.activeElement === el) focused = true; } catch (e) { focused = false; }
    if (focused) return false;   /* never clobber the control being dragged */
    if (String(el.value) !== str) el.value = str;
    return true;
  } catch (e) { return false; }
}

function avStudioUiSetText(host, sel, txt) {
  try { const el = host.querySelector(sel); if (el && el.textContent !== txt) el.textContent = txt; } catch (e) { /* no DOM */ }
}

/* ---------- mirror reads (pinned APIs, typeof-guarded, explicit reads only) ---------- */

function avStudioUiInputFields(st) {
  const s = avStudioUiState;
  if (!st || typeof st !== "object") return false;
  const en = avStudioUiFlagFrom(st, ["enabled", "on", "active", "live", "running"]);
  if (en !== null) { s.inputKnown = true; s.inputEnabled = en; }
  const mo = avStudioUiFlagFrom(st, ["monitor", "monitoring", "monitorOn"]);
  if (mo !== null) s.monitorOn = mo;
  const g = avStudioUiNumField(st, ["gain", "inputGain"]);
  if (g != null) s.gain = avStudioUiClamp(g, 0, 1.2, s.gain);
  const off = avStudioUiNumField(st, ["offsetMs", "latencyOffsetMs", "offset"]);
  if (off != null) s.offsetMs = avStudioUiClamp(off, -200, 200, s.offsetMs);
  const lbl = avStudioUiStrField(st, ["label", "deviceLabel"]);
  if (lbl) s.deviceLabel = lbl;
  const did = avStudioUiStrField(st, ["deviceId", "id"]);
  if (did) s.inputDeviceId = did;
  return true;
}

function avStudioUiMirrorInput() {
  if (typeof avInputState !== "function") return false;
  let st = null;
  try { st = avInputState(); } catch (e) { st = null; }
  return avStudioUiInputFields(st);
}

function avStudioUiMetroFields(st) {
  const s = avStudioUiState;
  if (!st || typeof st !== "object") return false;
  const on = avStudioUiFlagFrom(st, ["on", "enabled"]);
  if (on !== null) s.metroOn = on;
  const lv = avStudioUiNumField(st, ["level"]);
  if (lv != null) s.metroLevel = avStudioUiClamp(lv, 0, 1, s.metroLevel);
  const bb = avStudioUiNumField(st, ["beatsPerBar"]);
  if (bb != null) s.metroBeats = Math.max(1, Math.min(12, Math.round(bb)));
  const bpm = avStudioUiNumField(st, ["bpm"]);
  if (bpm != null) s.metroBpm = bpm;
  const ac = avStudioUiFlagFrom(st, ["accent"]);
  if (ac !== null) s.metroAccent = ac;
  return true;
}

function avStudioUiMirrorMetro() {
  if (typeof avMetroState !== "function") return false;
  let st = null;
  try { st = avMetroState(); } catch (e) { st = null; }
  return avStudioUiMetroFields(st);
}

/* keep-last mirror only (safe inside sync); the recording flag is adopted by the poll,
   which never fights a transient phase (see the header seam) */
function avStudioUiMirrorTakes() {
  if (typeof avTakesState !== "function") return false;
  let st = null;
  try { st = avTakesState(); } catch (e) { st = null; }
  if (!st || typeof st !== "object") return false;
  const kl = avStudioUiNumField(st, ["keepLast", "keep"]);
  if (kl != null) avStudioUiState.keepLast = avStudioUiKeepN(kl);
  return true;
}

/* recording flag candidates for the poll's phase adoption: true | false | null(unknown) */
function avStudioUiTakesRecFlag() {
  if (typeof avTakesState !== "function") return null;
  let st = null;
  try { st = avTakesState(); } catch (e) { st = null; }
  if (!st || typeof st !== "object") return null;
  const rec = avStudioUiFlagFrom(st, ["recording", "rec", "active"]);
  const phase = (typeof st.state === "string") ? st.state : (typeof st.phase === "string" ? st.phase : "");
  if (rec !== null) return rec;
  if (phase === "recording") return true;
  if (phase === "idle") return false;
  return null;
}

/* ---------- warnings (stateful wrappers over the pure list helpers) ---------- */

function avStudioUiWarn(key, text) {
  try {
    avStudioUiState.warnings = avStudioUiWarnMerge(avStudioUiState.warnings, String(key || "general"), avStudioUiClean(text, 170), AV_STUDIO_UI_WARN_MAX);
  } catch (e) { /* never throws */ }
}

function avStudioUiWarnDropKey(key) {
  try { avStudioUiState.warnings = avStudioUiWarnDrop(avStudioUiState.warnings, String(key || "")); } catch (e) { /* ok */ }
}

/* degraded-module notes: set when missing, dropped when present (honest every init) */
function avStudioUiModulesNote() {
  if (typeof avInputEnable === "function" && typeof avInputDisable === "function") avStudioUiWarnDropKey("modules.input");
  else avStudioUiWarn("modules.input", "the input module (av_input.js) is not loaded \u2014 ENABLE is unavailable");
  if (typeof avMetroSet === "function" && typeof avMetroState === "function") avStudioUiWarnDropKey("modules.metro");
  else avStudioUiWarn("modules.metro", "the metronome module (av_metro.js) is not loaded \u2014 clicks and count-in are unavailable");
  if (typeof avTakesStart === "function" && typeof avTakesList === "function") avStudioUiWarnDropKey("modules.takes");
  else avStudioUiWarn("modules.takes", "the takes module (av_takes.js) is not loaded \u2014 REC is unavailable");
}

/* ---------- markup (pure string builders) ---------- */

function avStudioUiCountInOptionsHTML() {
  const defs = [[0, "off"], [1, "1 bar"], [2, "2 bars"]];
  let out = "";
  for (let i = 0; i < defs.length; i++) {
    out += '<option value="' + defs[i][0] + '"' + (defs[i][0] === 0 ? " selected" : "") + ">" + defs[i][1] + "</option>";
  }
  return out;
}

function avStudioUiKeepOptionsHTML() {
  let out = "";
  for (let i = 0; i < AV_STUDIO_UI_KEEP_OPTS.length; i++) {
    const n = AV_STUDIO_UI_KEEP_OPTS[i];
    out += '<option value="' + n + '"' + (n === AV_STUDIO_UI_KEEP_DEFAULT ? " selected" : "") + ">" + n + "</option>";
  }
  return out;
}

function avStudioUiBodyHTML() {
  return '<div class="av-studio" data-av-studio="1">' +
    '<div class="av-studio-head"><span class="av-studio-title">STUDIO</span>' +
    '<span class="av-studio-cap">mic / line in \u00b7 count-in + metronome \u00b7 lap takes \u2014 the input rides the engine ctx; monitor stays off by default; takes capture the dry input (post-gain).</span></div>' +
    '<div class="av-studio-status-line"><span class="av-studio-status av-studio-msg" id="av-studio-status" role="status">studio is idle</span></div>' +

    '<section class="av-studio-sect" data-sect="input">' +
    '<div class="av-studio-sect-head"><span class="av-studio-sect-lbl">INPUT</span>' +
    '<span class="av-studio-input-state" id="av-studio-input-state">not enabled</span></div>' +
    '<div class="av-studio-row">' +
    '<button type="button" class="av-btn mini av-studio-btn av-studio-enable" id="av-studio-enable" aria-pressed="false" title="Ask for the audio input (getUserMedia) through the live engine context">ENABLE</button>' +
    '<select class="av-select av-studio-device" id="av-studio-device" aria-label="Audio input device"><option value="">\u2014 device \u2014</option></select>' +
    '</div>' +
    '<div class="av-studio-row">' +
    '<label class="av-studio-lab" for="av-studio-gain">GAIN</label>' +
    '<input type="range" class="av-studio-range" id="av-studio-gain" min="0" max="1.2" step="0.01" value="1" aria-label="Input gain"><span class="av-studio-val" id="av-studio-gain-val">1.00</span>' +
    '<button type="button" class="av-btn mini av-studio-btn av-studio-monitor" id="av-studio-monitor" aria-pressed="false" title="Monitor the input through the master \u2014 feedback risk, keep headphones on (off by default)">MONITOR</button>' +
    '<label class="av-studio-lab" for="av-studio-offset">OFFSET</label>' +
    '<input type="number" class="av-studio-offset" id="av-studio-offset" min="-200" max="200" step="1" value="0" aria-label="Latency offset in milliseconds"><span class="av-studio-unit">ms</span>' +
    '</div>' +
    '<div class="av-studio-row av-studio-meter-row">' +
    '<span class="av-studio-lab">LEVEL</span>' +
    '<div class="av-studio-meter" id="av-studio-meter" role="meter" aria-label="Input level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
    '<div class="av-studio-meter-bar" id="av-studio-meter-bar"></div><div class="av-studio-meter-rms" id="av-studio-meter-rms"></div>' +
    '</div>' +
    '<span class="av-studio-val av-studio-meter-val" id="av-studio-meter-val">peak \u2014 \u00b7 rms \u2014</span>' +
    '</div>' +
    '<p class="av-note av-dim av-studio-latency" id="av-studio-latency"></p>' +
    '</section>' +

    '<section class="av-studio-sect" data-sect="transport">' +
    '<div class="av-studio-sect-head"><span class="av-studio-sect-lbl">TRANSPORT</span>' +
    '<span class="av-studio-metro-bpm" id="av-studio-metro-bpm"></span></div>' +
    '<div class="av-studio-row">' +
    '<label class="av-studio-lab" for="av-studio-countin">COUNT-IN</label>' +
    '<select class="av-select" id="av-studio-countin" aria-label="Count-in bars before recording">' + avStudioUiCountInOptionsHTML() + '</select>' +
    '<button type="button" class="av-btn mini av-studio-btn av-studio-metro" id="av-studio-metro" aria-pressed="false" title="Metronome \u2014 clicks go to the master only (never into a take)">METRONOME</button>' +
    '<label class="av-studio-lab" for="av-studio-metro-level">LEVEL</label>' +
    '<input type="range" class="av-studio-range" id="av-studio-metro-level" min="0" max="1" step="0.01" value="0.5" aria-label="Metronome level"><span class="av-studio-val" id="av-studio-metro-val">0.50</span>' +
    '</div>' +
    '</section>' +

    '<section class="av-studio-sect" data-sect="takes">' +
    '<div class="av-studio-sect-head"><span class="av-studio-sect-lbl">TAKES</span>' +
    '<button type="button" class="av-btn mini av-studio-btn av-studio-rec" id="av-studio-rec" aria-pressed="false" title="REC \u2014 count-in (per the select) then record; STOP finishes the take">REC</button>' +
    '<label class="av-studio-lab" for="av-studio-keep">KEEP LAST</label>' +
    '<select class="av-select" id="av-studio-keep" aria-label="Keep last takes">' + avStudioUiKeepOptionsHTML() + '</select>' +
    '<span class="av-studio-take-n" id="av-studio-take-n">0 takes</span>' +
    '</div>' +
    '<div class="av-studio-takes" id="av-studio-takes"></div>' +
    '<p class="av-studio-none av-note av-dim" id="av-studio-takes-none">No takes yet \u2014 enable the input and press REC.</p>' +
    '</section>' +

    '<div class="av-studio-warnings" id="av-studio-warnings" hidden><div class="av-studio-warn-head">WARNINGS</div></div>' +
    '<p class="av-note av-dim av-studio-foot" id="av-studio-foot">REC runs the selected count-in, then records \u2014 lap takes split at cycle boundaries while the sequencer plays (no transport \u2192 one continuous take). EXPORT encodes a WAV in the browser; nothing is uploaded.</p>' +
    '</div>';
}

/* ---------- status text ---------- */

function avStudioUiRecText() {
  let mid = "";
  try {
    if (typeof avTakesState === "function") {
      const st = avTakesState();
      if (st && typeof st === "object") {
        const bits = [];
        let secs = null;
        if (isFinite(st.seconds)) secs = Number(st.seconds);
        else if (isFinite(st.frames) && isFinite(st.rate) && st.rate > 0) secs = st.frames / st.rate;
        else if (isFinite(st.frames)) secs = st.frames / 48000;
        if (secs != null && secs >= 0) bits.push(avStudioUiSecsTextFromSecs(secs));
        const lap = Number(st.lap);
        if (isFinite(lap) && lap >= 1) bits.push("lap " + Math.round(lap));
        if (st.partial === true) bits.push("partial");
        if (bits.length) mid = " (" + bits.join(" \u00b7 ") + ")";
      }
    }
  } catch (e) { mid = ""; }
  return "recording" + mid + " \u2014 press STOP to finish";
}

function avStudioUiIdleText() {
  const s = avStudioUiState;
  if (typeof avTakesStart !== "function") return "the record modules are not loaded \u2014 nothing to record here yet";
  if (s.inputKnown && !s.inputEnabled) return "input is off \u2014 press ENABLE, then REC";
  return "ready \u2014 press REC to record the input";
}

function avStudioUiStatusText() {
  const s = avStudioUiState;
  if (s.recPhase === "countin") {
    const bars = avStudioUiBars(s.countIn);
    return { text: "count-in \u2014 " + bars + " bar" + (bars === 1 ? "" : "s") + "\u2026 press REC to cancel", kind: "msg" };
  }
  if (s.recPhase === "starting") return { text: "arming the recorder\u2026", kind: "msg" };
  if (s.recPhase === "recording") return { text: avStudioUiRecText(), kind: "msg" };
  if (s.recPhase === "stopping") return { text: "finishing the take\u2026", kind: "msg" };
  if (s.enableBusy) return { text: "enabling the input\u2026", kind: "msg" };
  if (s.lastMsg) return { text: s.lastMsg, kind: (s.lastMsgKind === "err") ? "err" : "msg" };
  return { text: avStudioUiIdleText(), kind: "msg" };
}

/* ---------- INPUT actions ---------- */

function avStudioUiDevicesRefresh() {
  if (typeof avInputDevices !== "function") return false;
  let p = null;
  try { p = avInputDevices(); } catch (e) { p = null; }
  avStudioUiSettle(p, function (list) {
    try {
      const opts = avStudioUiDeviceOptions(list);
      avStudioUiState.devices = opts;
      if (!opts.length) avStudioUiWarn("input.devices", "no audio input devices were found");
      else avStudioUiWarnDropKey("input.devices");
      avStudioUiSync();
    } catch (e) { /* quiet */ }
  });
  return true;
}

function avStudioUiEnableApply(r) {
  const s = avStudioUiState;
  s.enableBusy = false;
  if (avStudioUiOK(r) === false) {
    s.inputKnown = true; s.inputEnabled = false;
    const why = (r && typeof r === "object" && r.error) ? avStudioUiErrText(r.error) : "refused";
    s.lastMsg = "input refused \u2014 " + why;
    s.lastMsgKind = "err";
    avStudioUiWarn("input.enable", s.lastMsg);
  } else {
    s.inputKnown = true; s.inputEnabled = true;
    const label = (r && typeof r === "object") ? avStudioUiStrField(r, ["label", "deviceLabel"]) : "";
    const did = (r && typeof r === "object") ? avStudioUiStrField(r, ["deviceId", "id"]) : "";
    const ch = (r && typeof r === "object") ? avStudioUiNumField(r, ["channels", "channelCount"]) : null;
    const sr = (r && typeof r === "object") ? avStudioUiNumField(r, ["sampleRate", "sr"]) : null;
    if (label) s.deviceLabel = label;
    if (did) s.inputDeviceId = did;
    s.lastMsg = "input on" + (label ? " \u2014 " + label : "") + (ch != null ? " \u00b7 " + Math.round(ch) + " ch" : "") + (sr != null ? " \u00b7 " + (Math.round(sr / 100) / 10) + " kHz" : "");
    s.lastMsgKind = "msg";
    avStudioUiWarnDropKey("input.enable");
    avStudioUiDevicesRefresh();   /* §2.4: the device select refreshes on enable */
  }
  avStudioUiSync();
}

function avStudioUiEnableToggle() {
  const s = avStudioUiState;
  try {
    if (s.enableBusy) return false;
    if (typeof avInputEnable !== "function" && typeof avInputDisable !== "function") {
      avStudioUiWarn("modules.input", "the input module (av_input.js) is not loaded \u2014 ENABLE is unavailable");
      s.lastMsg = "the input module is not loaded \u2014 nothing to enable";
      s.lastMsgKind = "err";
      avStudioUiSync();
      return false;
    }
    if (s.inputEnabled) {
      if (typeof avInputDisable !== "function") {
        s.lastMsg = "the input module cannot disable (avInputDisable is missing)";
        s.lastMsgKind = "err";
        avStudioUiSync();
        return false;
      }
      try { avInputDisable(); } catch (e) { /* fall through to the mirror */ }
      s.inputEnabled = false; s.monitorOn = false; s.inputKnown = true;
      s.lastMsg = "input disabled";
      s.lastMsgKind = "msg";
      avStudioUiSync();
      return true;
    }
    s.enableBusy = true;
    s.lastMsg = "enabling the input\u2026";
    s.lastMsgKind = "msg";
    avStudioUiSync();
    let p = null;
    try { p = avInputEnable(); } catch (e) { p = { ok: false, error: String((e && e.message) || e || "enable failed") }; }
    avStudioUiSettle(p, avStudioUiEnableApply);
    return true;
  } catch (e) { return false; }
}

function avStudioUiMonitorToggle() {
  const s = avStudioUiState;
  try {
    if (typeof avInputMonitor !== "function") {
      avStudioUiWarn("modules.input", "the input module (av_input.js) is not loaded \u2014 ENABLE is unavailable");
      s.lastMsg = "the input module is not loaded \u2014 monitoring is unavailable";
      s.lastMsgKind = "err";
      avStudioUiSync();
      return false;
    }
    if (s.inputKnown && !s.inputEnabled) {
      s.lastMsg = "enable the input first \u2014 there is nothing to monitor";
      s.lastMsgKind = "err";
      avStudioUiSync();
      return false;
    }
    const target = !s.monitorOn;
    let ok = true;
    try { ok = avInputMonitor(target) !== false; } catch (e) { ok = false; }
    if (!ok) {
      s.lastMsg = "the monitor refused the change";
      s.lastMsgKind = "err";
      avStudioUiWarn("input.monitor", s.lastMsg);
    } else {
      s.monitorOn = target;
      s.lastMsg = target ? "monitor on \u2014 feedback risk: keep headphones on" : "monitor off";
      s.lastMsgKind = "msg";
      avStudioUiWarnDropKey("input.monitor");
    }
    avStudioUiSync();
    return ok;
  } catch (e) { return false; }
}

function avStudioUiGainInput(el) {
  try {
    const v = avStudioUiClamp(el ? el.value : null, 0, 1.2, null);
    if (v == null) return false;
    avStudioUiState.gain = v;
    if (typeof avInputGain === "function") { try { avInputGain(v); } catch (e) { /* mirror stands */ } }
    avStudioUiSync();
    return true;
  } catch (e) { return false; }
}

function avStudioUiOffsetChange(el) {
  try {
    const v = avStudioUiClamp(el ? el.value : null, -200, 200, null);
    if (v == null) return false;
    const n = Math.round(v);
    avStudioUiState.offsetMs = n;
    if (typeof avInputOffset === "function") { try { avInputOffset(n); } catch (e) { /* mirror stands */ } }
    avStudioUiSync();
    return true;
  } catch (e) { return false; }
}

/* the device select is an OBSERVATORY under the current pin (avInputEnable takes no device
   argument): picking a device is remembered and noted honestly, never a re-acquire dance. */
function avStudioUiDeviceChange(el) {
  const s = avStudioUiState;
  try {
    const id = (el && typeof el.value === "string") ? el.value : "";
    s.deviceWanted = id;
    if (id) {
      let label = id;
      for (let i = 0; i < s.devices.length; i++) if (s.devices[i].value === id) label = s.devices[i].label;
      s.lastMsg = "device \u201c" + avStudioUiClean(label, 40) + "\u201d remembered \u2014 switching needs a pinned device argument in avInputEnable() (not available yet), so the running input keeps its device";
      s.lastMsgKind = "msg";
      avStudioUiWarn("input.switch", "device switching is not available under the current pin \u2014 avInputEnable() takes no device argument; the running input keeps its device");
    }
    avStudioUiSync();
    return true;
  } catch (e) { return false; }
}

/* ---------- TRANSPORT actions ---------- */

function avStudioUiMetroApply(patch) {
  if (typeof avMetroSet !== "function") return false;
  try {
    const s = avStudioUiState;
    const body = { on: !!s.metroOn, level: s.metroLevel, beatsPerBar: s.metroBeats, accent: !!s.metroAccent };
    for (const k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) body[k] = patch[k];
    let st = null;
    try { st = avMetroSet(body); } catch (e) { return false; }
    if (st && typeof st === "object") avStudioUiMetroFields(st);
    else avStudioUiMirrorMetro();
    return true;
  } catch (e) { return false; }
}

function avStudioUiMetroToggle() {
  const s = avStudioUiState;
  try {
    if (typeof avMetroSet !== "function") {
      avStudioUiWarn("modules.metro", "the metronome module (av_metro.js) is not loaded \u2014 clicks and count-in are unavailable");
      s.lastMsg = "the metronome module is not loaded";
      s.lastMsgKind = "err";
      avStudioUiSync();
      return false;
    }
    const ok = avStudioUiMetroApply({ on: !s.metroOn });
    if (!ok) {
      s.lastMsg = "the metronome refused the change";
      s.lastMsgKind = "err";
      avStudioUiWarn("metro.toggle", s.lastMsg);
    } else {
      s.lastMsg = s.metroOn ? "metronome on" : "metronome off";
      s.lastMsgKind = "msg";
      avStudioUiWarnDropKey("metro.toggle");
    }
    avStudioUiSync();
    return ok;
  } catch (e) { return false; }
}

function avStudioUiMetroLevelInput(el) {
  try {
    const v = avStudioUiClamp(el ? el.value : null, 0, 1, null);
    if (v == null) return false;
    avStudioUiState.metroLevel = v;
    const ok = avStudioUiMetroApply({ level: v });
    avStudioUiSync();
    return ok;
  } catch (e) { return false; }
}

function avStudioUiCountInChange(el) {
  try {
    const bars = avStudioUiBars(el ? el.value : null);
    avStudioUiState.countIn = bars;
    avStudioUiState.lastMsg = (bars > 0)
      ? ("count-in set \u2014 " + bars + " bar" + (bars === 1 ? "" : "s") + " before REC")
      : "count-in off \u2014 REC starts instantly";
    avStudioUiState.lastMsgKind = "msg";
    avStudioUiSync();
    return true;
  } catch (e) { return false; }
}

/* ---------- TAKES actions ---------- */

function avStudioUiKeepChange(el) {
  try {
    const n = avStudioUiKeepN(el ? el.value : null);
    avStudioUiState.keepLast = n;
    let ok = false;
    if (typeof avTakesKeepLast === "function") { try { avTakesKeepLast(n); ok = true; } catch (e) { ok = false; } }
    if (!ok) avStudioUiWarn("takes.keep", "the takes module (av_takes.js) is not loaded \u2014 KEEP LAST has no effect yet");
    else {
      avStudioUiWarnDropKey("takes.keep");
      avStudioUiState.lastMsg = "keep last " + n + " take" + (n === 1 ? "" : "s") + " \u2014 pruned when a recording stops";
      avStudioUiState.lastMsgKind = "msg";
    }
    avStudioUiSync();
    return ok;
  } catch (e) { return false; }
}

/* start: count-in (when > 0) then avTakesStart({ lapSync: true }); generation-guarded so a
   cancelled count-in's late resolution can never start a recording (see header) */
function avStudioUiStart() {
  const s = avStudioUiState;
  try {
    if (typeof avTakesStart !== "function") {
      avStudioUiWarn("modules.takes", "the takes module (av_takes.js) is not loaded \u2014 REC is unavailable");
      s.lastMsg = "the takes module is not loaded \u2014 nothing can be recorded";
      s.lastMsgKind = "err";
      avStudioUiSync();
      return false;
    }
    if (s.inputKnown && !s.inputEnabled) {
      s.lastMsg = "the input is not enabled \u2014 press ENABLE first";
      s.lastMsgKind = "err";
      avStudioUiSync();
      return false;
    }
    s.recSeq = (s.recSeq | 0) + 1;
    const seq = s.recSeq;
    const begin = function () {
      if (seq !== s.recSeq) return;   /* cancelled / superseded */
      s.recPhase = "starting";
      s.lastMsg = "arming the recorder\u2026";
      s.lastMsgKind = "msg";
      avStudioUiSync();
      let p = null;
      try { p = avTakesStart({ lapSync: true }); } catch (e) { p = { ok: false, error: String((e && e.message) || e || "start failed") }; }
      avStudioUiSettle(p, avStudioUiRecSettleStart);
    };
    const bars = avStudioUiBars(s.countIn);
    if (bars > 0 && typeof avMetroCountIn === "function") {
      s.recPhase = "countin";
      s.lastMsg = "count-in \u2014 " + bars + " bar" + (bars === 1 ? "" : "s") + "\u2026";
      s.lastMsgKind = "msg";
      avStudioUiSync();
      let cp = null;
      try { cp = avMetroCountIn(bars); } catch (e) { cp = null; }
      if (cp && typeof cp.then === "function") {
        cp.then(function (r) {
          if (seq !== s.recSeq) return;   /* cancelled while the count-in ran */
          if (!(r && r.ok === true)) {
            avStudioUiWarn("countin", "the count-in did not run" + (r && r.error ? " (" + avStudioUiErrText(r.error) + ")" : "") + " \u2014 recording starts anyway");
          } else {
            avStudioUiWarnDropKey("countin");
          }
          begin();
        }).catch(function (e) {
          if (seq !== s.recSeq) return;
          avStudioUiWarn("countin", "the count-in failed \u2014 recording starts anyway");
          begin();
        });
        return true;
      }
      if (cp && typeof cp === "object" && cp.ok === false) {
        avStudioUiWarn("countin", "the count-in did not run (" + avStudioUiErrText(cp.error) + ") \u2014 recording starts anyway");
      } else {
        avStudioUiWarn("countin", "the count-in did not run (no promise) \u2014 recording starts anyway");
      }
      begin();
      return true;
    }
    if (bars > 0) {
      avStudioUiWarn("modules.metro", "the metronome module (av_metro.js) is not loaded \u2014 clicks and count-in are unavailable");
    }
    begin();
    return true;
  } catch (e) { return false; }
}

function avStudioUiRec() {
  const s = avStudioUiState;
  try {
    if (s.recPhase === "recording" || s.recPhase === "countin") return avStudioUiStop();
    if (s.recPhase !== "idle") return false;   /* starting / stopping: ignored (fractions of a second) */
    return avStudioUiStart();
  } catch (e) { return false; }
}

/* stop: cancels a running count-in (generation bump), finishes a live take via avTakesStop */
function avStudioUiStop() {
  const s = avStudioUiState;
  try {
    if (s.recPhase === "countin") {
      s.recSeq = (s.recSeq | 0) + 1;
      s.recPhase = "idle";
      s.lastMsg = "count-in cancelled \u2014 nothing was recorded";
      s.lastMsgKind = "msg";
      avStudioUiSync();
      return true;
    }
    if (s.recPhase !== "recording") return false;
    if (typeof avTakesStop !== "function") {
      s.recPhase = "idle";
      s.lastMsg = "the takes module is not loaded \u2014 the take cannot be finished";
      s.lastMsgKind = "err";
      avStudioUiWarn("modules.takes", "the takes module (av_takes.js) is not loaded \u2014 REC is unavailable");
      avStudioUiSync();
      return false;
    }
    s.recPhase = "stopping";
    s.lastMsg = "finishing the take\u2026";
    s.lastMsgKind = "msg";
    avStudioUiSync();
    let r = null;
    try { r = avTakesStop(); } catch (e) { r = { ok: false, error: String((e && e.message) || e || "stop failed") }; }
    avStudioUiSettle(r, avStudioUiRecSettleStop);
    return true;
  } catch (e) { return false; }
}

function avStudioUiRecSettleStart(r) {
  const s = avStudioUiState;
  if (avStudioUiOK(r) === false) {
    s.recPhase = "idle";
    const why = (r && typeof r === "object" && r.error) ? avStudioUiErrText(r.error) : "refused";
    s.lastMsg = "recording could not start \u2014 " + why;
    s.lastMsgKind = "err";
    avStudioUiWarn("rec.fail", s.lastMsg);
  } else {
    s.recPhase = "recording";
    s.recStartedAt = Date.now();
    s.lastMsg = "recording";
    s.lastMsgKind = "msg";
    avStudioUiWarnDropKey("rec.fail");
    avStudioUiWarnDropKey("countin");
  }
  avStudioUiSync();
}

function avStudioUiRecSettleStop(r) {
  const s = avStudioUiState;
  s.recPhase = "idle";
  if (avStudioUiOK(r) === false) {
    const why = (r && typeof r === "object" && r.error) ? avStudioUiErrText(r.error) : "refused";
    s.lastMsg = "the take could not be finished \u2014 " + why;
    s.lastMsgKind = "err";
    avStudioUiWarn("rec.fail", s.lastMsg);
  } else {
    let extra = "";
    try {
      let secs = null;
      if (r && typeof r === "object") {
        if (isFinite(r.seconds)) secs = Number(r.seconds);
        else if (isFinite(r.frames) && isFinite(r.rate) && r.rate > 0) secs = r.frames / r.rate;
        else if (isFinite(r.frames)) secs = r.frames / 48000;
      }
      if (secs != null && secs >= 0) extra = " \u2014 " + avStudioUiSecsTextFromSecs(secs);
    } catch (e) { extra = ""; }
    s.lastMsg = "take saved" + extra + " \u2014 export it below";
    s.lastMsgKind = "msg";
    avStudioUiWarnDropKey("rec.fail");
  }
  avStudioUiSync();
}

function avStudioUiExportURL(r) {
  try {
    if (r && typeof r.url === "string" && r.url) return r.url;
    if (r && r.blob && typeof URL !== "undefined" && URL && typeof URL.createObjectURL === "function") {
      if (avStudioUiState.lastObjectUrl) { try { URL.revokeObjectURL(avStudioUiState.lastObjectUrl); } catch (e) { /* ok */ } }
      const u = URL.createObjectURL(r.blob);
      if (typeof u === "string" && u) { avStudioUiState.lastObjectUrl = u; return u; }
    }
  } catch (e) { /* no handle */ }
  return null;
}

function avStudioUiDownloadURL(url, name) {
  try {
    if (!url || typeof document === "undefined" || !document || typeof document.createElement !== "function") return false;
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "take.wav";
    if (document.body && typeof document.body.appendChild === "function") document.body.appendChild(a);
    a.click();
    if (document.body && typeof document.body.removeChild === "function") { try { document.body.removeChild(a); } catch (e) { /* ok */ } }
    return true;
  } catch (e) { return false; }
}

function avStudioUiExport(id) {
  const s = avStudioUiState;
  try {
    if (typeof id !== "string" || !id) return false;
    if (typeof avTakesExport !== "function") {
      avStudioUiWarn("modules.takes", "the takes module (av_takes.js) is not loaded \u2014 REC is unavailable");
      s.lastMsg = "the takes module is not loaded \u2014 export is unavailable";
      s.lastMsgKind = "err";
      avStudioUiSync();
      return false;
    }
    if (s.exportingId) return false;
    s.exportingId = id;
    s.lastMsg = "exporting " + id + "\u2026";
    s.lastMsgKind = "msg";
    avStudioUiSync();
    let p = null;
    try { p = avTakesExport(id); } catch (e) { p = { ok: false, error: String((e && e.message) || e || "export failed") }; }
    avStudioUiSettle(p, function (r) {
      s.exportingId = "";
      try {
        if (!r || typeof r !== "object" || r.ok !== true) {
          const why = (r && r.error) ? avStudioUiErrText(r.error) : "refused";
          s.lastMsg = "export refused \u2014 " + why;
          s.lastMsgKind = "err";
          avStudioUiWarn("export.fail", s.lastMsg);
          avStudioUiSync();
          return;
        }
        const name = (typeof r.name === "string" && r.name) ? avStudioUiClean(r.name, 80) : (id + ".wav");
        const url = avStudioUiExportURL(r);
        const clicked = url ? avStudioUiDownloadURL(url, name) : false;
        const bytes = avStudioUiNumField(r, ["bytes"]);
        const wi = (r.wavInfo && typeof r.wavInfo === "object") ? r.wavInfo : null;
        let extra = "";
        if (bytes != null) extra += " \u00b7 " + avStudioUiFmtBytes(bytes);
        if (wi) {
          const bits = avStudioUiNumField(wi, ["bits"]);
          const sr = avStudioUiNumField(wi, ["sr", "sampleRate"]);
          if (bits != null) extra += " \u00b7 " + Math.round(bits) + "-bit";
          if (sr != null && sr > 0) extra += " \u00b7 " + (Math.round(sr / 100) / 10) + " kHz";
        }
        s.lastMsg = "exported " + name + extra + (clicked ? " \u2014 check your downloads" : " \u2014 no download handle could be opened");
        s.lastMsgKind = "msg";
        avStudioUiWarnDropKey("export.fail");
        try {
          if (typeof window !== "undefined") {
            window.__avStudioUiLastExport = { id: id, name: name, bytes: (bytes == null ? null : Math.round(bytes)), downloaded: clicked, at: Date.now() };
          }
        } catch (e) { /* stamp is a nicety */ }
        avStudioUiSync();
      } catch (e) { /* settle never throws */ }
    });
    return true;
  } catch (e) { return false; }
}

function avStudioUiDelete(id) {
  const s = avStudioUiState;
  try {
    if (typeof id !== "string" || !id) return false;
    if (typeof avTakesDelete !== "function") {
      avStudioUiWarn("modules.takes", "the takes module (av_takes.js) is not loaded \u2014 REC is unavailable");
      s.lastMsg = "the takes module is not loaded \u2014 delete is unavailable";
      s.lastMsgKind = "err";
      avStudioUiSync();
      return false;
    }
    let ok = true;
    try { if (avTakesDelete(id) === false) ok = false; } catch (e) { ok = false; }
    if (ok) {
      s.lastMsg = "take deleted";
      s.lastMsgKind = "msg";
      avStudioUiWarnDropKey("take.del");
    } else {
      s.lastMsg = "the take could not be deleted";
      s.lastMsgKind = "err";
      avStudioUiWarn("take.del", s.lastMsg);
    }
    avStudioUiSync();
    return ok;
  } catch (e) { return false; }
}

/* debug-only arm hook (window.__avStudioUi.arm); the card itself never arms */
function avStudioUiArm(on) {
  try {
    if (typeof avTakesArm !== "function") return false;
    return avTakesArm(!!on) !== false;
  } catch (e) { return false; }
}

/* ---------- async settle (receipts may be promises or sync values; never throws) ---------- */

function avStudioUiSettle(p, cb) {
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

/* ---------- paint ---------- */

function avStudioUiLatencyText() {
  const s = avStudioUiState;
  if (!s.inputEnabled || typeof avInputLatency !== "function") return "";
  let l = null;
  try { l = avInputLatency(); } catch (e) { l = null; }
  if (!l || typeof l !== "object") return "";
  const parts = [];
  const total = avStudioUiNumField(l, ["totalMs"]);
  const base = avStudioUiNumField(l, ["baseMs"]);
  const off = avStudioUiNumField(l, ["offsetMs"]);
  const ms = (total != null) ? total : ((base != null || off != null) ? ((base || 0) + (off || 0)) : null);
  if (ms != null) parts.push("latency " + Math.round(ms) + " ms");
  const fr = avStudioUiNumField(l, ["totalFrames"]);
  if (fr != null) parts.push(Math.round(fr) + " frames");
  const sr = avStudioUiNumField(l, ["sr", "sampleRate"]);
  if (sr != null && sr > 0) parts.push(Math.round(sr) + " Hz");
  return parts.join(" \u00b7 ");
}

function avStudioUiMetaNote() {
  const s = avStudioUiState;
  const parts = [];
  if (s.metroBpm > 0) parts.push(String(Math.round(s.metroBpm)) + " bpm");
  if (s.metroBeats >= 1) parts.push(s.metroBeats + "/4");
  return parts.join(" \u00b7 ");
}

function avStudioUiMeterPaint(host, peak, rms, on) {
  try {
    const s = avStudioUiState;
    const now = Date.now();
    const pPct = on ? avStudioUiMeterPct(peak) : 0;
    const rPct = on ? avStudioUiMeterPct(rms) : 0;
    const txt = on ? ("peak " + Number(peak).toFixed(2) + " \u00b7 rms " + Number(rms).toFixed(2)) : "peak \u2014 \u00b7 rms \u2014";
    const stateChanged = (s.meterZero !== !on);
    const pctChanged = Math.abs(pPct - (s.meterPPct || 0)) >= 0.4;
    if (!stateChanged && !pctChanged) return false;
    if (!stateChanged && (now - (s.meterAt | 0)) < 60) return false;
    s.meterAt = now;
    s.meterPPct = pPct;
    s.meterZero = !on;
    const bar = host.querySelector("#av-studio-meter-bar");
    if (bar) {
      if (bar.style && bar.style.width !== pPct + "%") bar.style.width = pPct + "%";
      if (bar.classList) bar.classList.toggle("hot", !!(on && Number(peak) >= 1.0));
    }
    const rmsEl = host.querySelector("#av-studio-meter-rms");
    if (rmsEl && rmsEl.style && rmsEl.style.width !== rPct + "%") rmsEl.style.width = rPct + "%";
    const val = host.querySelector("#av-studio-meter-val");
    if (val && val.textContent !== txt) val.textContent = txt;
    const meter = host.querySelector("#av-studio-meter");
    if (meter && meter.setAttribute) meter.setAttribute("aria-valuenow", String(Math.round(pPct)));
    return true;
  } catch (e) { return false; }
}

/* the meter tick: live only while the input is enabled; one zero-paint when it goes off */
function avStudioUiMeterTick(host) {
  const s = avStudioUiState;
  try {
    if (!host) return false;
    if (s.inputEnabled && typeof avInputLevels === "function") {
      let lv = null;
      try { lv = avInputLevels(); } catch (e) { lv = null; }
      const peak = avStudioUiClamp(lv ? lv.peak : null, 0, 4, 0);
      const rms = avStudioUiClamp(lv ? lv.rms : null, 0, 4, 0);
      avStudioUiMeterPaint(host, peak, rms, true);
      return true;
    }
    if (!s.meterZero) avStudioUiMeterPaint(host, 0, 0, false);
    return false;
  } catch (e) { return false; }
}

function avStudioUiPaintDevices(host) {
  try {
    const s = avStudioUiState;
    const sel = host.querySelector("#av-studio-device");
    if (!sel) return false;
    const opts = s.devices || [];
    let key = "";
    for (let i = 0; i < opts.length; i++) key += opts[i].value + "\u0001" + opts[i].label + "\u0000";
    if (key !== s.devicesKey) {
      s.devicesKey = key;
      let html = '<option value="">\u2014 device \u2014</option>';
      for (let i = 0; i < opts.length; i++) {
        html += '<option value="' + avStudioUiEsc(opts[i].value) + '">' + avStudioUiEsc(opts[i].label) + "</option>";
      }
      sel.innerHTML = html;
    }
    let want = "";
    let present = false;
    for (let i = 0; i < opts.length; i++) if (opts[i].value === s.deviceWanted) present = true;
    if (s.deviceWanted && present) want = s.deviceWanted;
    else {
      let cur = "";
      try { cur = String(sel.value || ""); } catch (e) { cur = ""; }
      present = false;
      for (let i = 0; i < opts.length; i++) if (opts[i].value === cur) present = true;
      if (cur && present) want = cur;
      else if (s.inputDeviceId) {
        for (let i = 0; i < opts.length; i++) if (opts[i].value === s.inputDeviceId) want = s.inputDeviceId;
      }
    }
    if (String(sel.value || "") !== want) sel.value = want;
    return true;
  } catch (e) { return false; }
}

function avStudioUiPaintTakes(host) {
  try {
    const box = host.querySelector("#av-studio-takes");
    const none = host.querySelector("#av-studio-takes-none");
    const nEl = host.querySelector("#av-studio-take-n");
    let list = [];
    try { if (typeof avTakesList === "function") { const v = avTakesList(); if (Array.isArray(v)) list = v; } } catch (e) { list = []; }
    const views = [];
    for (let i = 0; i < list.length && i < 64; i++) views.push(avStudioUiTakeView(list[i], i));
    const key = avStudioUiTakesKey(views);
    if (box && key !== avStudioUiState.takesKey) {
      avStudioUiState.takesKey = key;
      let html = "";
      for (let i = 0; i < views.length; i++) html += avStudioUiTakeRowHTML(views[i]);
      box.innerHTML = html;
    }
    if (none) none.hidden = views.length > 0;
    if (nEl) {
      const txt = views.length + " take" + (views.length === 1 ? "" : "s");
      if (nEl.textContent !== txt) nEl.textContent = txt;
    }
    return true;
  } catch (e) { return false; }
}

function avStudioUiPaintWarnings(host) {
  try {
    const box = host.querySelector("#av-studio-warnings");
    if (!box) return false;
    const list = avStudioUiState.warnings || [];
    box.hidden = list.length === 0;
    let key = "";
    for (let i = 0; i < list.length; i++) key += list[i].key + ":" + list[i].text + "|";
    if (key !== avStudioUiState.warnKey) {
      avStudioUiState.warnKey = key;
      let html = '<div class="av-studio-warn-head">WARNINGS</div>';
      for (let i = 0; i < list.length; i++) html += '<div class="av-studio-warn-item">' + avStudioUiEsc(list[i].text) + "</div>";
      box.innerHTML = html;
    }
    return true;
  } catch (e) { return false; }
}

/* full repaint: mirrors first (guarded), then every control (write-on-change only) */
function avStudioUiSync() {
  const host = avStudioUiHost();
  if (!host) return false;
  try {
    let card = null;
    try { card = host.querySelector(".av-studio"); } catch (e) { card = null; }
    if (!card) {
      host.innerHTML = avStudioUiBodyHTML();
      avStudioUiState.takesKey = "";
      avStudioUiState.warnKey = "";
      avStudioUiState.devicesKey = "";
      avStudioUiWire(host);
    }
    const s = avStudioUiState;

    /* mirrors (typeof-guarded; explicit reads only) */
    avStudioUiMirrorInput();
    avStudioUiMirrorMetro();
    avStudioUiMirrorTakes();

    /* status line */
    const st = avStudioUiStatusText();
    try {
      const el = host.querySelector("#av-studio-status");
      if (el) {
        const cls = "av-studio-status " + (st.kind === "err" ? "av-studio-err" : "av-studio-msg");
        if (el.className !== cls) el.className = cls;
        if (el.textContent !== st.text) el.textContent = st.text;
      }
    } catch (e) { /* no DOM */ }

    /* INPUT */
    try {
      const btn = host.querySelector("#av-studio-enable");
      if (btn) {
        const txt = s.inputEnabled ? "DISABLE" : (s.enableBusy ? "ENABLING\u2026" : "ENABLE");
        if (btn.textContent !== txt) btn.textContent = txt;
        if (btn.classList) btn.classList.toggle("on", !!s.inputEnabled);
        const pressed = s.inputEnabled ? "true" : "false";
        if (btn.getAttribute("aria-pressed") !== pressed) btn.setAttribute("aria-pressed", pressed);
      }
      const ist = host.querySelector("#av-studio-input-state");
      if (ist) {
        const txt = s.inputEnabled ? ("on" + (s.deviceLabel ? " \u2014 " + s.deviceLabel : "")) : "not enabled";
        if (ist.textContent !== txt) ist.textContent = txt;
      }
      avStudioUiSetValue(host.querySelector("#av-studio-gain"), s.gain.toFixed(2));
      avStudioUiSetText(host, "#av-studio-gain-val", s.gain.toFixed(2));
      const mon = host.querySelector("#av-studio-monitor");
      if (mon) {
        if (mon.classList) mon.classList.toggle("on", !!s.monitorOn);
        const pressed = s.monitorOn ? "true" : "false";
        if (mon.getAttribute("aria-pressed") !== pressed) mon.setAttribute("aria-pressed", pressed);
      }
      avStudioUiSetValue(host.querySelector("#av-studio-offset"), String(Math.round(s.offsetMs)));
      avStudioUiSetText(host, "#av-studio-latency", avStudioUiLatencyText());
    } catch (e) { /* no DOM */ }

    avStudioUiPaintDevices(host);

    /* TRANSPORT */
    try {
      avStudioUiSetValue(host.querySelector("#av-studio-countin"), String(avStudioUiBars(s.countIn)));
      const met = host.querySelector("#av-studio-metro");
      if (met) {
        if (met.classList) met.classList.toggle("on", !!s.metroOn);
        const pressed = s.metroOn ? "true" : "false";
        if (met.getAttribute("aria-pressed") !== pressed) met.setAttribute("aria-pressed", pressed);
      }
      avStudioUiSetValue(host.querySelector("#av-studio-metro-level"), s.metroLevel.toFixed(2));
      avStudioUiSetText(host, "#av-studio-metro-val", s.metroLevel.toFixed(2));
      avStudioUiSetText(host, "#av-studio-metro-bpm", avStudioUiMetaNote());
    } catch (e) { /* no DOM */ }

    /* TAKES */
    try {
      const rec = host.querySelector("#av-studio-rec");
      if (rec) {
        const phase = s.recPhase;
        const txt = (phase === "recording") ? "STOP"
          : (phase === "countin") ? "COUNT-IN\u2026"
            : (phase === "starting" || phase === "stopping") ? "\u2026"
              : "REC";
        if (rec.textContent !== txt) rec.textContent = txt;
        if (rec.classList) rec.classList.toggle("on", phase !== "idle");
        const pressed = (phase === "recording" || phase === "countin" || phase === "starting") ? "true" : "false";
        if (rec.getAttribute("aria-pressed") !== pressed) rec.setAttribute("aria-pressed", pressed);
      }
      avStudioUiSetValue(host.querySelector("#av-studio-keep"), String(avStudioUiKeepN(s.keepLast)));
    } catch (e) { /* no DOM */ }
    avStudioUiPaintTakes(host);
    avStudioUiPaintWarnings(host);

    /* the meter falls back to zero when the input is off (the rAF loop keeps it live when on) */
    if (!s.inputEnabled) avStudioUiMeterPaint(host, 0, 0, false);
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- poll (recording adoption + slow mirror refresh; ~400 ms, no rAF needed) ---------- */

function avStudioUiPoll() {
  const s = avStudioUiState;
  try {
    if (!s.inited) return false;
    const now = Date.now();
    if (now - (s.pollAt | 0) < 400) return false;
    s.pollAt = now;
    let changed = false;
    avStudioUiMirrorInput();
    avStudioUiMirrorMetro();
    avStudioUiMirrorTakes();
    const rec = avStudioUiTakesRecFlag();
    if (rec === true && s.recPhase === "idle") {
      s.recPhase = "recording";
      s.recStartedAt = now;
      s.lastMsg = "recording";
      s.lastMsgKind = "msg";
      changed = true;
    } else if (rec === false && s.recPhase === "recording") {
      s.recPhase = "idle";
      s.lastMsg = "recording stopped";
      s.lastMsgKind = "msg";
      changed = true;
    }
    if (s.recPhase === "recording") changed = true;   /* keep the elapsed text fresh */
    if (changed) avStudioUiSync();
    return changed;
  } catch (e) { return false; }
}

/* ---------- the rAF loop (meter + poll; never breaks the frame) ---------- */

function avStudioUiLoopBody() {
  const s = avStudioUiState;
  if (!s.inited) return false;
  const host = avStudioUiHost();
  if (!host) return false;
  avStudioUiMeterTick(host);
  avStudioUiPoll();
  return true;
}

function avStudioUiLoop() {
  try { avStudioUiLoopBody(); } catch (e) { /* never break the frame */ }
  try {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(avStudioUiLoop);
    else avStudioUiState.rafOn = false;
  } catch (e) { avStudioUiState.rafOn = false; }
}

function avStudioUiStartLoop() {
  const s = avStudioUiState;
  if (s.rafOn) return false;
  if (typeof requestAnimationFrame !== "function") return false;
  s.rafOn = true;
  try { requestAnimationFrame(avStudioUiLoop); } catch (e) { s.rafOn = false; return false; }
  return true;
}

/* ---------- wiring (delegated, bound ONCE per host element; the dataset marker) ---------- */

function avStudioUiClick(e) {
  try {
    const t = (e && e.target && typeof e.target.closest === "function") ? e.target : null;
    if (!t) return;
    if (t.closest("#av-studio-enable")) { avStudioUiEnableToggle(); return; }
    if (t.closest("#av-studio-monitor")) { avStudioUiMonitorToggle(); return; }
    if (t.closest("#av-studio-metro")) { avStudioUiMetroToggle(); return; }
    if (t.closest("#av-studio-rec")) { avStudioUiRec(); return; }
    const act = t.closest("[data-act]");
    if (act) {
      const row = act.closest("[data-take]");
      const id = row ? String(row.getAttribute("data-take") || "") : "";
      if (!id) return;
      const what = String(act.getAttribute("data-act") || "");
      if (what === "export") { avStudioUiExport(id); return; }
      if (what === "del") { avStudioUiDelete(id); return; }
    }
  } catch (err) { /* a listener never throws outward */ }
}

function avStudioUiChange(e) {
  try {
    const t = (e && e.target && typeof e.target.closest === "function") ? e.target : null;
    if (!t) return;
    if (t.closest("#av-studio-device")) { avStudioUiDeviceChange(t); return; }
    if (t.closest("#av-studio-countin")) { avStudioUiCountInChange(t); return; }
    if (t.closest("#av-studio-keep")) { avStudioUiKeepChange(t); return; }
    if (t.closest("#av-studio-offset")) { avStudioUiOffsetChange(t); return; }
  } catch (err) { /* a listener never throws outward */ }
}

function avStudioUiInput(e) {
  try {
    const t = (e && e.target && typeof e.target.closest === "function") ? e.target : null;
    if (!t) return;
    if (t.closest("#av-studio-gain")) { avStudioUiGainInput(t); return; }
    if (t.closest("#av-studio-metro-level")) { avStudioUiMetroLevelInput(t); return; }
  } catch (err) { /* a listener never throws outward */ }
}

function avStudioUiWire(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  try {
    if (host.dataset && host.dataset.avStudioUiWired === "1") return true;   /* one delegation per host element */
    if (host.dataset) host.dataset.avStudioUiWired = "1";
    host.addEventListener("click", avStudioUiClick);
    host.addEventListener("change", avStudioUiChange);
    host.addEventListener("input", avStudioUiInput);
    return true;
  } catch (e) { return false; }
}

/* ---------- init (mount, idempotent, re-mountable) ---------- */

function avStudioUiInit() {
  const host = avStudioUiHost();
  if (!host) return false;
  try {
    let card = null;
    try { card = (typeof host.querySelector === "function") ? host.querySelector(".av-studio") : null; } catch (e) { card = null; }
    if (!card) {
      host.innerHTML = avStudioUiBodyHTML();
      avStudioUiState.takesKey = "";
      avStudioUiState.warnKey = "";
      avStudioUiState.devicesKey = "";
    }
    avStudioUiWire(host);
    const s = avStudioUiState;
    s.inited = true;
    s.mounts += 1;
    avStudioUiModulesNote();
    avStudioUiSync();
    avStudioUiStartLoop();
    return true;
  } catch (e) { return false; }
}

/* ---------- observables ---------- */

function avStudioUiSnap() {
  const host = avStudioUiHost();
  const s = avStudioUiState;
  const snap = {
    version: AV_STUDIO_UI_VERSION,
    inited: !!s.inited,
    mounts: s.mounts,
    host: !!host,
    wired: !!(host && host.dataset && host.dataset.avStudioUiWired === "1"),
    card: false,
    recPhase: s.recPhase,
    input: {
      known: !!s.inputKnown, enabled: !!s.inputEnabled, busy: !!s.enableBusy,
      monitor: !!s.monitorOn, gain: s.gain, offsetMs: s.offsetMs,
      device: s.deviceLabel || "", module: (typeof avInputEnable === "function"),
    },
    metro: {
      on: !!s.metroOn, level: s.metroLevel, beatsPerBar: s.metroBeats,
      bpm: s.metroBpm, module: (typeof avMetroSet === "function"),
    },
    takes: {
      module: (typeof avTakesStart === "function"), count: 0,
      keepLast: avStudioUiKeepN(s.keepLast), exporting: s.exportingId || "",
    },
    countIn: avStudioUiBars(s.countIn),
    status: s.lastMsg, statusKind: s.lastMsgKind,
    warnings: s.warnings.map(function (w) { return w.text; }),
    classes: avStudioUiClasses(),
  };
  try { if (host && host.querySelector) snap.card = !!host.querySelector(".av-studio"); } catch (e) { snap.card = false; }
  try { if (host && host.querySelectorAll) snap.takes.count = host.querySelectorAll(".av-studio-take").length; } catch (e) { /* no DOM */ }
  return snap;
}

function avStudioUiClasses() {
  return [
    "av-studio", "av-studio-head", "av-studio-title", "av-studio-cap",
    "av-studio-status-line", "av-studio-status", "av-studio-msg", "av-studio-err",
    "av-studio-sect", "av-studio-sect-head", "av-studio-sect-lbl", "av-studio-input-state",
    "av-studio-row", "av-studio-lab", "av-studio-btn", "av-studio-enable", "av-studio-device",
    "av-studio-range", "av-studio-val", "av-studio-unit", "av-studio-monitor", "av-studio-offset",
    "av-studio-meter-row", "av-studio-meter", "av-studio-meter-bar", "av-studio-meter-rms",
    "av-studio-meter-val", "hot",
    "av-studio-latency",
    "av-studio-metro", "av-studio-metro-bpm",
    "av-studio-rec", "on",
    "av-studio-take-n", "av-studio-takes", "av-studio-none",
    "av-studio-take", "partial", "av-studio-take-name", "av-studio-take-secs", "av-studio-take-lap",
    "av-studio-take-export", "av-studio-take-del",
    "av-studio-warnings", "av-studio-warn-head", "av-studio-warn-item",
    "av-studio-foot",
  ];
}

/* ---------- debug/verify handle ---------- */

if (typeof window !== "undefined") {
  window.__avStudioUi = {
    version: AV_STUDIO_UI_VERSION,
    init: () => avStudioUiInit(),
    sync: () => avStudioUiSync(),
    classes: () => avStudioUiClasses(),
    state: () => avStudioUiSnap(),
    rec: () => avStudioUiRec(),
    stop: () => avStudioUiStop(),
    export: (id) => avStudioUiExport(id),
    del: (id) => avStudioUiDelete(id),
    devices: () => avStudioUiDevicesRefresh(),
    arm: (on) => avStudioUiArm(on),
  };
}
