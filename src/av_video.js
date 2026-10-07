/* av_video.js — Anvil S4 DELIVER EXTRAS: the clip capture core (child sa-C; spec verify/_s4_wave.md
   §2.3, wave laws §3). ONE file, ONE namespace (avVideo* / AV_VIDEO_*).

   Pinned interface:
     avVideoInit() -> boolean
     avVideoSupported() -> { ok, capture, recorder, audio, mime, reasons[] }   honest degrade report
     avVideoRenderFrame(input, g, t) -> boolean    THE 1280x720 clip compositor (stub-2d-testable)
     avVideoRecord(opts?) -> Promise<receipt>      realtime capture; seconds default 8 clamp 2..60;
                                                   fps default 30; opts.onProgress(phase, frac);
                                                   opts.download (default false)
     avVideoDownload(blob, name?) -> bool          reuse avDeliverDownload / own anchor
     avVideoClasses() -> []
     window.__avVideo = { version, init, supported, record, renderFrame, download, state }

   PIPELINE (realtime, honest):
   - the live page AudioContext is the ONLY context: resolved exactly like av_deck's attach (engine
     facade handle .ctx -> avEngineLiveCtx holder -> avTap.live entries; no context is ever
     constructed here and offline contexts are excluded by the same gate). No live context at all
     = honest refusal.
   - audio = avBounce's master render copied into a fresh AudioBuffer on the live context ->
     AudioBufferSource -> MediaStreamAudioDestinationNode -> its audio track. No pattern snapshot,
     no audible events, or a bounce failure = honest warning + video-only clip (never fake audio).
     The bounce is sized (loops) to cover the clip; a shorter bounce loops (tail 0 => seamless).
   - video = own unattached canvas, 1280x720; captureStream(fps) -> video track. The frame loop
     draws avVideoRenderFrame(frame, g, t) from LIVE inputs: guarded avDeckFrame reads
     (scope/spectrum/waterfall, ready-gated), the ONE avNote bus via window.__avNotes()/
     __lastNotePreview, meta from avSeqSnap()/avState when present. The loop stops at `seconds` on
     the wall clock; a guard timer backstops a stalled frame loop; MediaRecorder.stop -> final Blob.
   - MediaRecorder mime chain (pinned): video/webm;codecs=vp9,opus -> video/webm;codecs=vp8,opus ->
     video/webm. The picked entry is tried first; the rest of the chain follows on refusal.
   - receipt { ok, error?, blob, bytes, seconds, mime, warnings[] } · refusal
     { ok:false, error, reasons, blob:null, bytes:0, seconds, mime:null, warnings }.
   - window.__avVideoLast = { bytes, seconds, mime, at } is set on success.

   LAWS HONORED: 'use strict'; classic script; ONE namespace; node-loadable (zero DOM at load; the
   guarded `typeof window` probe is the last statement); never throws (honest refusals, counted,
   no log noise); no AudioContext is ever constructed here; every browser reach typeof-guarded per
   call; cleanup ALWAYS (frame loop cancelled, timers cleared, tracks stopped, nodes disconnected);
   bounded (seconds 2..60, fps 1..60, note/mime/error lists capped, names capped, duration guarded).

   DOCUMENTED INTERPRETATIONS (report carries the full list):
   - meta carries name (avSeqSnap().name when present, "untitled" else) and bpm (avState.bpm wins
     over the snapshot bpm); meta.at is accepted by the compositor input but not drawn — the pinned
     draw list is name · bpm · ANVIL wordmark.
   - avVideoSupported().audio means the FULL clip-audio path is ready (live ctx + its
     MediaStreamAudioDestinationNode + avBounce present). record() still tolerates a missing
     avBounce at call time with a warning + video-only clip; the report is the strict view.
   - avVideoDownload(Blob, ...) converts via blob.arrayBuffer() (avDeliverDownload needs a
     byteLength) and reports true once the path is engaged; ArrayBuffer/typed-array inputs go
     straight through; a Blob that cannot convert falls to the local anchor.
   - the refusal gate is API absence (capture / recorder / mime / live-ctx output path); data
     absence (no pattern snapshot, no audible events, bounce failure) is warning + video-only.
   - audio starts right after recorder.start(); the few-ms skew is accepted (no timeline smearing).
*/

"use strict";

const AV_VIDEO_VERSION = "s4.1.0";
const AV_VIDEO_W = 1280;
const AV_VIDEO_H = 720;
const AV_VIDEO_SECS_DEF = 8;
const AV_VIDEO_SECS_MIN = 2;
const AV_VIDEO_SECS_MAX = 60;
const AV_VIDEO_FPS_DEF = 30;
const AV_VIDEO_FPS_MIN = 1;
const AV_VIDEO_FPS_MAX = 60;
const AV_VIDEO_CHUNK_MS = 1000;            /* MediaRecorder timeslice */
const AV_VIDEO_STOP_MS = 4000;             /* recorder.stop receipt watchdog */
const AV_VIDEO_GUARD_MS = 2500;            /* frame-loop guard past the clip window */
const AV_VIDEO_LIST_CAP = 16;              /* warnings / reasons cap */
const AV_VIDEO_NAME_CAP = 120;
const AV_VIDEO_NOTES_CAP = 12;             /* live note list cap */
const AV_VIDEO_NOTES_SHOWN = 4;            /* names joined before +N */
const AV_VIDEO_MIMES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
const AV_VIDEO_DB_FLOOR = -90;             /* band display floor (dB) */
const AV_VIDEO_SCOPE_PTS = 320;            /* scope ribbon point cap */
const AV_VIDEO_SPEC_COLS = 96;             /* spectrum bar cap */
const AV_VIDEO_WF_ROWS = 24;               /* waterfall rows shown */
const AV_VIDEO_WF_COLS = 96;               /* waterfall columns cap */
const AV_VIDEO_FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';
/* palette (frozen strings; the compositor is deterministic) */
const AV_VIDEO_C_BG = "#05080c";
const AV_VIDEO_C_PANEL = "rgba(13,26,33,0.72)";
const AV_VIDEO_C_EDGE = "rgba(64,140,132,0.55)";
const AV_VIDEO_C_GRID = "rgba(45,212,191,0.06)";
const AV_VIDEO_C_RIBBON = "rgba(45,212,191,0.22)";
const AV_VIDEO_C_TEXT = "#e6f7f2";
const AV_VIDEO_C_DIM = "#7fa39c";
const AV_VIDEO_C_ACCENT = "#2dd4bf";
const AV_VIDEO_C_WF_LO = "rgba(45,212,191,0.30)";
const AV_VIDEO_C_WF_MID = "rgba(45,212,191,0.55)";
const AV_VIDEO_C_WF_HI = "rgba(170,255,240,0.90)";

/* ---------- shared state ---------- */

const avVideo = {
  inited: false,
  recording: false,
  runs: 0,
  refusals: 0,
  errors: 0,
  lastMime: null,
  last: null,
  lastError: null,
  lastWarnings: [],
};

/* ---------- tiny value laws (never throw) ---------- */

function avVideoNum(v) {
  if (v === null || v === undefined) return NaN;
  try { const n = Number(v); return isFinite(n) ? n : NaN; } catch (e) { return NaN; }
}
function avVideoFiniteOr(v, dflt) {
  const n = avVideoNum(v);
  return isFinite(n) ? n : dflt;
}
function avVideoClampNum(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function avVideoInt(v, dflt, lo, hi) {
  const n = avVideoFiniteOr(v, dflt);
  const r = Math.round(n);
  return r < lo ? lo : (r > hi ? hi : r);
}
function avVideoMsg(e) {
  try { return String((e && (e.message || e.name)) || e) || "unknown error"; } catch (e2) { return "unknown error"; }
}
function avVideoNow() {
  try {
    if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
      const t = performance.now();
      if (isFinite(t)) return t;
    }
  } catch (e) { /* wall time below */ }
  try { return Date.now(); } catch (e2) { return 0; }
}
function avVideoUniqArr(a) {
  const out = [];
  try {
    if (Array.isArray(a)) {
      for (let i = 0; i < a.length && out.length < AV_VIDEO_LIST_CAP; i++) {
        const s = a[i];
        if (typeof s !== "string" || !s) continue;
        if (out.indexOf(s) < 0) out.push(s);
      }
    }
  } catch (e) { /* best effort */ }
  return out;
}
function avVideoShortStr(v, cap, dflt) {
  try {
    const s = (v === null || v === undefined) ? "" : String(v);
    if (!s) return dflt;
    const c = (isFinite(Number(cap)) && Number(cap) > 0) ? Math.floor(Number(cap)) : 48;
    return (s.length > c) ? (s.slice(0, c - 1) + "\u2026") : s;
  } catch (e) { return dflt; }
}
function avVideoSafeName(name) {
  try {
    let s = String(name == null ? "" : name).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/^\.+/, "");
    s = s.slice(0, AV_VIDEO_NAME_CAP);
    return s || "anvil_clip.webm";
  } catch (e) { return "anvil_clip.webm"; }
}
function avVideoStamp() {
  try {
    const d = new Date();
    const p = function (x) { return (x < 10 ? "0" : "") + x; };
    return String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
  } catch (e) { return "clip"; }
}
function avVideoClipName() { return "anvil-clip-" + avVideoStamp() + ".webm"; }
function avVideoMimeOf(name) {
  try { const n = String(name || "").toLowerCase(); if (n.slice(-5) === ".webm") return "video/webm"; } catch (e) { /* generic below */ }
  return "application/octet-stream";
}

/* ---------- live-context resolution (NEVER constructs a context; offline excluded) ----------
   Mirrors av_deck's attach resolution exactly (avDeckAttach -> avDeckResolveCtx): engine facade
   handle first, then the avEngineLiveCtx holder, then avTap.live entries. The only difference is
   the node-method probe (the clip needs createBufferSource/createBuffer where the deck needs
   analysers + a splitter). */

function avVideoEngineHandle() {
  try {
    if (typeof avEngineLive !== "undefined" && avEngineLive && avEngineLive.ready === true) return avEngineLive;
  } catch (e) { /* holder not loaded */ }
  try {
    const f = (typeof window !== "undefined") ? window.__avEngine : null;
    if (f && f.ready === true && f.handle && f.handle.ready === true) return f.handle;
  } catch (e) { /* no window */ }
  return null;
}

function avVideoUsableCtx(ctx) {
  try {
    if (!ctx || typeof ctx.createBufferSource !== "function" || typeof ctx.createBuffer !== "function") return null;
    if (ctx.state === "closed") return null;
    if (typeof ctx.startRendering === "function") return null;      /* offline: excluded */
    return ctx;
  } catch (e) { return null; }
}

function avVideoResolveCtx() {
  const h = avVideoEngineHandle();
  if (h) { const c = avVideoUsableCtx(h.ctx); if (c) return c; }
  try {
    if (typeof avEngineLiveCtx !== "undefined") { const c = avVideoUsableCtx(avEngineLiveCtx); if (c) return c; }
  } catch (e) { /* holder not loaded */ }
  try {
    const live = (typeof avTap !== "undefined" && avTap && avTap.live && typeof avTap.live.length === "number") ? avTap.live : null;
    if (live) {
      for (let i = 0; i < live.length; i++) { const c = avVideoUsableCtx(live[i]); if (c) return c; }
    }
  } catch (e) { /* no tap */ }
  return null;
}

/* ---------- live reads (guarded; the frame loop's inputs) ---------- */

function avVideoDeckFrameOf(kind) {
  try { if (typeof avDeckFrame === "function") return avDeckFrame(kind); } catch (e) { /* deck absent */ }
  return null;
}

function avVideoNotesPoll() {
  const out = [];
  let held = null, preview = null;
  try {
    const w = (typeof window !== "undefined") ? window : null;
    if (w) {
      try {
        if (typeof w.__avNotes === "function") {
          const s = w.__avNotes();
          if (s && s.held && typeof s.held.length === "number") held = s.held;
        }
      } catch (e) { held = null; }
      try { const p = w.__lastNotePreview; if (typeof p === "string" && p) preview = p; } catch (e2) { preview = null; }
    }
  } catch (e) { /* empty list below */ }
  if (held) {
    for (let i = 0; i < held.length && out.length < AV_VIDEO_NOTES_CAP; i++) {
      const nm = held[i];
      if (typeof nm === "string" && nm) out.push({ name: nm, held: true });
    }
  }
  if (preview && out.length < AV_VIDEO_NOTES_CAP) {
    let dup = false;
    for (let i = 0; i < out.length; i++) { if (out[i].name === preview) { dup = true; break; } }
    if (!dup) out.push({ name: preview, held: false });
  }
  return out;
}

/* name/bpm when the page provides them (avSeqSnap pattern name; avState.bpm wins over snap.bpm) */
function avVideoMeta() {
  const meta = { name: "untitled", bpm: null };
  try {
    if (typeof avSeqSnap === "function") {
      const s = avSeqSnap();
      if (s && typeof s === "object") {
        meta.name = avVideoShortStr(s.name, 48, "untitled");
        const mb = avVideoNum(s.bpm);
        if (isFinite(mb) && mb > 0) meta.bpm = mb;
      }
    }
  } catch (e) { /* defaults stand */ }
  try {
    if (typeof avState !== "undefined" && avState) {
      const b = avVideoNum(avState.bpm);
      if (isFinite(b) && b > 0) meta.bpm = b;
    }
  } catch (e2) { /* snapshot bpm stands */ }
  return meta;
}

/* the input object the frame loop hands the compositor (meta sampled once per clip) */
function avVideoBuildInput(meta, t, seconds) {
  const scopeF = avVideoDeckFrameOf("scope");
  const specF = avVideoDeckFrameOf("spectrum");
  const wfF = avVideoDeckFrameOf("waterfall");
  return {
    meta: (meta && typeof meta === "object") ? meta : avVideoMeta(),
    scope: (scopeF && scopeF.ready === true) ? scopeF : null,
    spectrum: (specF && specF.ready === true) ? specF : null,
    waterfall: (wfF && wfF.ready === true) ? wfF : null,
    notes: avVideoNotesPoll(),
    t: t,
    seconds: seconds,
  };
}

/* ---------- compositor helpers (deterministic; no wall clock, no randomness) ---------- */

function avVideoSecsText(x) {
  const n = avVideoNum(x);
  if (!isFinite(n) || n < 0) return "0.0";
  return (Math.round(n * 10) / 10).toFixed(1);
}
function avVideoDbNorm(db) {
  const v = avVideoNum(db);
  if (!isFinite(v)) return 0;
  let n = (v - AV_VIDEO_DB_FLOOR) / (0 - AV_VIDEO_DB_FLOOR);
  if (!isFinite(n)) return 0;
  if (n < 0) n = 0;
  if (n > 1) n = 1;
  return n;
}
function avVideoAmpOf(arr, i) {
  try {
    const v = arr[i];
    if (typeof v !== "number" || !isFinite(v)) return 0;
    if (v < -1.2) return -1.2;
    if (v > 1.2) return 1.2;
    return v;
  } catch (e) { return 0; }
}
function avVideoTextW(g, s, perChar) {
  try {
    if (typeof g.measureText === "function") {
      const m = g.measureText(s);
      if (m && isFinite(m.width) && m.width >= 0) return m.width;
    }
  } catch (e) { /* estimate below */ }
  return String(s).length * (isFinite(Number(perChar)) ? Number(perChar) : 16);
}
function avVideoPanel(g, x, y, w, h, label) {
  g.fillStyle = AV_VIDEO_C_PANEL;
  g.fillRect(x, y, w, h);
  g.strokeStyle = AV_VIDEO_C_EDGE;
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (label) {
    g.fillStyle = AV_VIDEO_C_DIM;
    g.font = "600 12px " + AV_VIDEO_FONT;
    g.textAlign = "left";
    g.fillText(label, x + 10, y + 17);
  }
}
function avVideoNoSignal(g, cx, cy) {
  g.textAlign = "center";
  g.fillStyle = AV_VIDEO_C_DIM;
  g.font = "600 18px " + AV_VIDEO_FONT;
  g.fillText("no signal", cx, cy);
  g.textAlign = "left";
}

/* ---------- THE compositor (pinned: avVideoRenderFrame(input, g, t) -> boolean) ----------
   input = { meta:{name,bpm,at?}, scope:{n,min,max}|null, spectrum:{bands}|null,
             waterfall:{rows,latestRow,cols,data}|null, notes:[{name,held}], t, seconds }
   Deterministic given input: fixed palette/geometry, bounded loops, no wall clock, no entropy. */

function avVideoRenderFrame(input, g, t) {
  try {
    if (!g || typeof g.fillRect !== "function" || typeof g.fillText !== "function") return false;
    const inp = (input && typeof input === "object") ? input : {};
    let tt = avVideoNum(t);
    if (!isFinite(tt)) tt = avVideoNum(inp.t);
    if (!isFinite(tt) || tt < 0) tt = 0;
    let total = avVideoNum(inp.seconds);
    if (!isFinite(total) || total < 0) total = 0;

    /* background + washes */
    g.fillStyle = AV_VIDEO_C_BG;
    g.fillRect(0, 0, AV_VIDEO_W, AV_VIDEO_H);
    g.fillStyle = "rgba(26,52,58,0.30)";
    g.fillRect(0, 0, AV_VIDEO_W, 140);
    g.fillStyle = "rgba(18,38,44,0.30)";
    g.fillRect(0, 596, AV_VIDEO_W, 124);

    /* grid */
    g.strokeStyle = AV_VIDEO_C_GRID;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 80; x < AV_VIDEO_W; x += 80) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, AV_VIDEO_H); }
    for (let y = 80; y < AV_VIDEO_H; y += 80) { g.moveTo(0, y + 0.5); g.lineTo(AV_VIDEO_W, y + 0.5); }
    g.stroke();

    if (typeof g.save === "function") g.save();

    /* header: name · bpm (left) · ANVIL wordmark (right) */
    const meta = (inp.meta && typeof inp.meta === "object") ? inp.meta : {};
    const name = avVideoShortStr(meta.name, 48, "untitled");
    g.textBaseline = "alphabetic";
    g.textAlign = "left";
    g.fillStyle = AV_VIDEO_C_TEXT;
    g.font = "700 34px " + AV_VIDEO_FONT;
    g.fillText(name, 40, 78);
    const bpm = avVideoNum(meta.bpm);
    if (isFinite(bpm) && bpm > 0) {
      const nmW = avVideoTextW(g, name, 19);
      g.fillStyle = AV_VIDEO_C_ACCENT;
      g.font = "600 22px " + AV_VIDEO_FONT;
      g.fillText("\u00b7 " + Math.round(bpm) + " BPM", 40 + nmW + 16, 76);
    }
    g.textAlign = "right";
    g.fillStyle = AV_VIDEO_C_TEXT;
    g.font = "800 38px " + AV_VIDEO_FONT;
    g.fillText("ANVIL", AV_VIDEO_W - 40, 76);
    g.fillStyle = AV_VIDEO_C_DIM;
    g.font = "400 14px " + AV_VIDEO_FONT;
    g.fillText("MODDYS Foundry instrument", AV_VIDEO_W - 40, 100);
    g.textAlign = "left";
    g.fillStyle = AV_VIDEO_C_DIM;
    g.font = "400 16px " + AV_VIDEO_FONT;
    g.fillText(avVideoSecsText(tt) + "s / " + avVideoSecsText(total) + "s", 40, 108);

    /* clip progress */
    const frac = (total > 0) ? avVideoClampNum(tt / total, 0, 1) : 0;
    g.fillStyle = "rgba(45,212,191,0.16)";
    g.fillRect(40, 120, AV_VIDEO_W - 80, 6);
    if (frac > 0) {
      g.fillStyle = AV_VIDEO_C_ACCENT;
      g.fillRect(40, 120, Math.round((AV_VIDEO_W - 80) * frac), 6);
    }

    /* panels */
    avVideoPanel(g, 40, 144, 800, 300, "SCOPE");
    avVideoPanel(g, 856, 144, 384, 300, "SPECTRUM");
    avVideoPanel(g, 40, 472, 1200, 104, "NOTES");
    avVideoPanel(g, 40, 596, 1200, 84, "WATERFALL");

    /* scope ribbon (min/max envelope) */
    let scopeDrawn = false;
    const sc = inp.scope;
    if (sc && typeof sc === "object") {
      const nRaw = Math.floor(avVideoNum(sc.n));
      const n = (isFinite(nRaw) && nRaw >= 2) ? nRaw : 0;
      if (n > 0 && sc.min && sc.max) {
        const step = Math.max(1, Math.floor(n / AV_VIDEO_SCOPE_PTS));
        const x0 = 56, x1 = 824, mid = 306, half = 112;
        const span = (n - 1) > 0 ? (n - 1) : 1;
        g.beginPath();
        let started = false;
        for (let i = 0; i < n; i += step) {
          const x = x0 + (x1 - x0) * (i / span);
          const y = mid - avVideoAmpOf(sc.max, i) * half;
          if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
        }
        g.lineTo(x0 + (x1 - x0), mid - avVideoAmpOf(sc.max, n - 1) * half);
        for (let i = n - 1; i >= 0; i -= step) {
          const x = x0 + (x1 - x0) * (i / span);
          g.lineTo(x, mid - avVideoAmpOf(sc.min, i) * half);
        }
        g.lineTo(x0, mid - avVideoAmpOf(sc.min, 0) * half);
        g.closePath();
        g.fillStyle = AV_VIDEO_C_RIBBON;
        g.fill();
        scopeDrawn = true;
      }
    }
    if (!scopeDrawn) avVideoNoSignal(g, 440, 310);

    /* spectrum bars */
    let specDrawn = false;
    const sp = (inp.spectrum && inp.spectrum.bands) ? inp.spectrum.bands : null;
    if (sp && typeof sp.length === "number" && isFinite(sp.length) && sp.length > 0) {
      const cols = Math.min(Math.floor(sp.length), AV_VIDEO_SPEC_COLS);
      const innerX = 868, innerW = 360, baseY = 424, topY = 178;
      const cw = innerW / cols;
      g.fillStyle = AV_VIDEO_C_ACCENT;
      for (let b = 0; b < cols; b++) {
        const bh = Math.round(avVideoDbNorm(sp[b]) * (baseY - topY));
        if (bh <= 0) continue;
        g.fillRect(innerX + b * cw, baseY - bh, Math.max(1, cw * 0.7), bh);
      }
      specDrawn = true;
    }
    if (!specDrawn) avVideoNoSignal(g, 1048, 306);

    /* waterfall slice (newest row first; ring addressed from latestRow) */
    let wfDrawn = false;
    const wf = inp.waterfall;
    if (wf && wf.data && typeof wf.data.length === "number") {
      const colsFull = Math.floor(avVideoNum(wf.cols));
      const rowsRaw = Math.floor(avVideoNum(wf.rows));
      if (colsFull >= 1 && colsFull <= 4096 && isFinite(rowsRaw) && rowsRaw >= 1 && wf.data.length >= colsFull) {
        const ringRows = Math.max(1, Math.floor(wf.data.length / colsFull));
        const rowsShow = Math.min(rowsRaw, ringRows, AV_VIDEO_WF_ROWS);
        const colsDraw = Math.min(colsFull, AV_VIDEO_WF_COLS);
        const lRaw = Math.floor(avVideoNum(wf.latestRow));
        const latest = isFinite(lRaw) ? ((lRaw % ringRows) + ringRows) % ringRows : 0;
        const innerX = 44, innerW = 1192, topY = 604;
        const rh = 68 / AV_VIDEO_WF_ROWS;
        const cw = innerW / colsDraw;
        let lastFill = "";
        for (let k = 0; k < rowsShow; k++) {
          const srcRow = ((latest - k) % ringRows + ringRows) % ringRows;
          const y = topY + k * rh;
          for (let c = 0; c < colsDraw; c++) {
            const nrm = avVideoDbNorm(wf.data[srcRow * colsFull + c]);
            if (nrm <= 0.06) continue;
            const fill = (nrm > 0.66) ? AV_VIDEO_C_WF_HI : ((nrm > 0.33) ? AV_VIDEO_C_WF_MID : AV_VIDEO_C_WF_LO);
            if (fill !== lastFill) { g.fillStyle = fill; lastFill = fill; }
            g.fillRect(innerX + c * cw, y, cw + 0.5, rh + 0.5);
          }
        }
        wfDrawn = true;
      }
    }
    if (!wfDrawn) avVideoNoSignal(g, 640, 642);

    /* notes readout (held set wins; else the last non-held note) */
    const notes = Array.isArray(inp.notes) ? inp.notes : [];
    const held = [];
    let lastNm = null;
    for (let i = 0; i < notes.length && i < AV_VIDEO_NOTES_CAP; i++) {
      const it = notes[i];
      if (!it || typeof it !== "object") continue;
      const nm = avVideoShortStr(it.name, 16, "");
      if (!nm) continue;
      if (it.held === true) held.push(nm);
      else lastNm = nm;
    }
    if (held.length > 0) {
      let txt = held.slice(0, AV_VIDEO_NOTES_SHOWN).join(" \u00b7 ");
      if (held.length > AV_VIDEO_NOTES_SHOWN) txt += " +" + (held.length - AV_VIDEO_NOTES_SHOWN);
      g.fillStyle = AV_VIDEO_C_TEXT;
      g.font = "700 44px " + AV_VIDEO_FONT;
      g.fillText(txt, 60, 540);
      g.fillStyle = AV_VIDEO_C_ACCENT;
      g.font = "600 14px " + AV_VIDEO_FONT;
      g.fillText(held.length + (held.length === 1 ? " note held" : " notes held"), 60, 562);
    } else if (lastNm) {
      g.fillStyle = AV_VIDEO_C_TEXT;
      g.font = "700 44px " + AV_VIDEO_FONT;
      g.fillText(lastNm, 60, 540);
      g.fillStyle = AV_VIDEO_C_DIM;
      g.font = "600 14px " + AV_VIDEO_FONT;
      g.fillText("last note", 60, 562);
    } else {
      g.fillStyle = AV_VIDEO_C_DIM;
      g.font = "600 20px " + AV_VIDEO_FONT;
      g.fillText("waiting for notes\u2026", 60, 538);
    }

    /* footer */
    g.textAlign = "left";
    g.fillStyle = AV_VIDEO_C_DIM;
    g.font = "400 13px " + AV_VIDEO_FONT;
    g.fillText("clip " + avVideoSecsText(tt) + "s \u00b7 local-first", 40, 706);
    g.textAlign = "right";
    g.fillText("free \u00b7 moddys.net", AV_VIDEO_W - 40, 706);
    g.textAlign = "left";
    if (typeof g.restore === "function") g.restore();
    return true;
  } catch (e) {
    avVideo.errors++;
    return false;
  }
}

/* ---------- support report ---------- */

function avVideoCaptureOk() {
  try {
    if (typeof document !== "undefined" && document && typeof document.createElement === "function") {
      const cv = document.createElement("canvas");
      return !!(cv && typeof cv.captureStream === "function");
    }
    return !!(typeof HTMLCanvasElement === "function" && HTMLCanvasElement.prototype
      && typeof HTMLCanvasElement.prototype.captureStream === "function");
  } catch (e) { return false; }
}

/* first chain entry isTypeSupported accepts; null when the API says none do; the first chain entry
   when isTypeSupported is absent (construction-time probing sorts it out downstream) */
function avVideoPickMime() {
  try {
    if (typeof MediaRecorder === "function" && typeof MediaRecorder.isTypeSupported === "function") {
      for (let i = 0; i < AV_VIDEO_MIMES.length; i++) {
        try { if (MediaRecorder.isTypeSupported(AV_VIDEO_MIMES[i]) === true) return AV_VIDEO_MIMES[i]; } catch (e) { /* probe next */ }
      }
      return null;
    }
  } catch (e) { /* chain head below */ }
  return AV_VIDEO_MIMES[0];
}

/* the construction order: the picked entry first, then the rest of the pinned chain */
function avVideoMimeOrder(mime) {
  const out = [];
  try {
    if (typeof mime === "string" && mime) {
      const i = AV_VIDEO_MIMES.indexOf(mime);
      if (i >= 0) {
        for (let j = 0; j < AV_VIDEO_MIMES.length; j++) out.push(AV_VIDEO_MIMES[(i + j) % AV_VIDEO_MIMES.length]);
        return out;
      }
      out.push(mime);
    }
    for (let j = 0; j < AV_VIDEO_MIMES.length; j++) if (out.indexOf(AV_VIDEO_MIMES[j]) < 0) out.push(AV_VIDEO_MIMES[j]);
  } catch (e) { /* head below */ }
  return out.length ? out : AV_VIDEO_MIMES.slice(0);
}

function avVideoSupported() {
  const reasons = [];
  const capture = avVideoCaptureOk();
  if (!capture) reasons.push("canvas.captureStream unavailable");
  const recorder = (typeof MediaRecorder === "function");
  if (!recorder) reasons.push("MediaRecorder unavailable");
  const mime = recorder ? avVideoPickMime() : null;
  if (recorder && !mime) reasons.push("no supported mime in the pinned webm chain");
  let ctx = null;
  try { ctx = avVideoResolveCtx(); } catch (e) { ctx = null; }
  const destOk = !!(ctx && typeof ctx.createMediaStreamDestination === "function");
  if (!ctx) reasons.push("no live AudioContext (never created; the clip plays through the live one)");
  else if (!destOk) reasons.push("live AudioContext lacks MediaStreamAudioDestinationNode");
  const bounceOk = (typeof avBounce === "function");
  if (!bounceOk) reasons.push("avBounce unavailable (clip audio would be skipped)");
  const audio = !!(ctx && destOk && bounceOk);
  return {
    ok: (capture && recorder && !!mime && audio),
    capture: capture,
    recorder: recorder,
    audio: audio,
    mime: mime,
    reasons: reasons.slice(0, AV_VIDEO_LIST_CAP),
  };
}

/* ---------- record: the realtime capture pipeline ---------- */

function avVideoSchedule(fn, fps) {
  try {
    if (typeof requestAnimationFrame === "function") return { id: requestAnimationFrame(fn), kind: 1 };
  } catch (e) { /* timer below */ }
  try {
    const f = (isFinite(Number(fps)) && Number(fps) > 0) ? Number(fps) : AV_VIDEO_FPS_DEF;
    const ms = Math.max(4, Math.round(1000 / f));
    return { id: setTimeout(function () { try { fn(); } catch (e) { /* loop body guards itself */ } }, ms), kind: 2 };
  } catch (e2) { /* no scheduler */ }
  return null;
}

function avVideoCancelHandle(h) {
  if (!h || typeof h !== "object") return;
  try {
    if (h.kind === 1 && typeof cancelAnimationFrame === "function") { cancelAnimationFrame(h.id); return; }
    if (h.kind === 2) { clearTimeout(h.id); return; }
  } catch (e) { /* gone is fine */ }
}

function avVideoJoinStream(canvasStream, vtrack, atrack) {
  try {
    if (typeof MediaStream === "function") {
      const list = atrack ? [vtrack, atrack] : [vtrack];
      const s = new MediaStream(list);
      if (s && typeof s.getTracks === "function") return s;
    }
  } catch (e) { /* addTrack fallback below */ }
  try {
    if (canvasStream && atrack && typeof canvasStream.addTrack === "function") canvasStream.addTrack(atrack);
  } catch (e2) { /* video-only stands */ }
  return canvasStream;
}

function avVideoStreamHasTrack(stream, track) {
  try {
    if (!stream || !track) return false;
    if (typeof stream.getTracks === "function") {
      const ts = stream.getTracks();
      for (let i = 0; i < ts.length; i++) { if (ts[i] === track) return true; }
      return false;
    }
    return true;      /* cannot verify — assume attached */
  } catch (e) { return true; }
}

/* bounce -> AudioBuffer on the LIVE ctx -> source -> destination track; failures are warnings
   (video-only clip), never throws */
function avVideoAudioInto(ctx, job, seconds, warnings) {
  return new Promise(function (resolve) {
    (async function () {
      try {
        if (typeof avBounce !== "function") {
          warnings.push("audio skipped: avBounce unavailable (video-only clip)");
          return;
        }
        let snap = null;
        try { if (typeof avSeqSnap === "function") { const s = avSeqSnap(); if (s && typeof s === "object") snap = s; } } catch (e) { snap = null; }
        if (!snap) {
          warnings.push("audio skipped: no pattern snapshot (video-only clip)");
          return;
        }
        const sr = (ctx.sampleRate === 44100) ? 44100 : 48000;
        let loops = 1;
        try {
          if (typeof avBouncePlan === "function") {
            const p1 = avBouncePlan(snap, { loops: 1, tailS: 0, sr: sr });
            if (p1 && p1.ok === true) {
              if (Array.isArray(p1.events) && p1.events.length === 0) {
                warnings.push("audio skipped: the pattern has no audible events (video-only clip)");
                return;
              }
              const cyc = avVideoNum(p1.seconds);
              if (isFinite(cyc) && cyc > 0) loops = Math.ceil(seconds / cyc);
            }
          }
        } catch (e) { loops = 1; }
        if (!isFinite(loops) || loops < 1) loops = 1;
        if (loops > 64) loops = 64;
        const rec = await avBounce({ snap: snap, loops: loops, tailS: 0, includeParts: false, includeMaster: true, sr: sr });
        if (!rec || rec.ok !== true) {
          warnings.push("audio skipped: " + ((rec && rec.error) ? String(rec.error) : "bounce failed"));
          return;
        }
        const master = rec.master;
        if (!master || !master.l || !master.r) {
          warnings.push("audio skipped: bounce produced no master channels");
          return;
        }
        const frames = Math.max(1, Math.floor(avVideoFiniteOr(rec.frames, master.l.length)));
        const buf = ctx.createBuffer(2, frames, sr);
        if (!buf) { warnings.push("audio skipped: createBuffer refused"); return; }
        let copied = true;
        try {
          if (typeof buf.copyToChannel === "function" && typeof master.l.subarray === "function") {
            buf.copyToChannel(master.l.subarray(0, frames), 0);
            buf.copyToChannel(master.r.subarray(0, frames), 1);
          } else {
            const c0 = buf.getChannelData(0), c1 = buf.getChannelData(1);
            if (!c0 || !c1) copied = false;
            else {
              c0.set(master.l.subarray(0, Math.min(c0.length, master.l.length)));
              c1.set(master.r.subarray(0, Math.min(c1.length, master.r.length)));
            }
          }
        } catch (e) { copied = false; }
        if (!copied) { warnings.push("audio skipped: channel copy refused"); return; }
        const src = ctx.createBufferSource();
        const dest = ctx.createMediaStreamDestination();
        if (!src || !dest) { warnings.push("audio skipped: the live context refused the output nodes"); return; }
        try { src.buffer = buf; } catch (e) { /* node keeps its own default; track still opens */ }
        const recSecs = avVideoNum(rec.seconds);
        if (isFinite(recSecs) && recSecs > 0 && recSecs < seconds - 0.05) {
          try { src.loop = true; } catch (e) { /* one-shot stands */ }
        }
        src.connect(dest);
        let atrack = null;
        try {
          const as = (dest.stream && typeof dest.stream.getAudioTracks === "function") ? dest.stream.getAudioTracks() : null;
          atrack = (as && as.length > 0) ? as[0] : null;
        } catch (e) { atrack = null; }
        if (!atrack) {
          warnings.push("audio skipped: the destination produced no audio track");
          try { src.disconnect(); } catch (e) { /* ok */ }
          try { dest.disconnect(); } catch (e) { /* ok */ }
          return;
        }
        job.src = src;
        job.dest = dest;
        job.atrack = atrack;
      } catch (e) {
        warnings.push("audio skipped: " + avVideoMsg(e));
      }
    })().then(function () { resolve(); }, function () { resolve(); });
  });
}

function avVideoRecord(opts) {
  const o = (opts && typeof opts === "object") ? opts : {};
  const seconds = avVideoClampNum(avVideoFiniteOr(o.seconds, AV_VIDEO_SECS_DEF), AV_VIDEO_SECS_MIN, AV_VIDEO_SECS_MAX);
  const fps = avVideoInt(o.fps, AV_VIDEO_FPS_DEF, AV_VIDEO_FPS_MIN, AV_VIDEO_FPS_MAX);
  const onProgress = (typeof o.onProgress === "function") ? o.onProgress : null;
  const wantDownload = (o.download === true);
  const warnings = [];
  const reasons = [];

  return new Promise(function (resolve) {
    let settled = false;
    const emit = function (phase, frac) {
      if (!onProgress) return;
      const f = avVideoClampNum(avVideoFiniteOr(frac, 0), 0, 1);
      try { onProgress(String(phase), f); } catch (e) { /* listener noise is theirs */ }
    };
    const settle = function (r) {
      if (settled) return;
      settled = true;
      try { r.warnings = avVideoUniqArr(warnings); } catch (e) { r.warnings = []; }
      if (r.ok === true) {
        avVideo.runs++;
        avVideo.lastError = null;
        avVideo.lastWarnings = r.warnings.slice(0, AV_VIDEO_LIST_CAP);
      } else {
        avVideo.refusals++;
        avVideo.lastError = String(r.error || "clip refused");
      }
      emit("done", 1);
      try { resolve(r); } catch (e2) { /* resolve never throws */ }
    };
    const refuse = function (error) {
      settle({
        ok: false,
        error: String(error || "clip refused"),
        reasons: avVideoUniqArr(reasons),
        blob: null,
        bytes: 0,
        seconds: seconds,
        mime: null,
        warnings: warnings,
      });
    };

    const job = {
      recorder: null, stream: null, vtrack: null, atrack: null,
      src: null, srcStarted: false, dest: null, g: null,
      chunks: [], mime: null, err: null,
      raf: null, guard: null, stopWatch: null, stopWhy: null,
      stopping: false, finished: false, t0: 0, frames: 0,
    };

    const cleanup = function () {
      /* idempotent; runs on EVERY path */
      if (job.raf) { avVideoCancelHandle(job.raf); job.raf = null; }
      if (job.guard !== null) { try { clearTimeout(job.guard); } catch (e) { /* ok */ } job.guard = null; }
      if (job.stopWatch !== null) { try { clearTimeout(job.stopWatch); } catch (e) { /* ok */ } job.stopWatch = null; }
      try { if (job.recorder) { job.recorder.ondataavailable = null; job.recorder.onstop = null; job.recorder.onerror = null; } } catch (e) { /* ok */ }
      try { if (job.recorder && typeof job.recorder.stop === "function") { if (job.recorder.state !== "inactive" && job.stopping !== true && job.finished !== true) job.recorder.stop(); } } catch (e) { /* ok */ }
      try { if (job.vtrack && typeof job.vtrack.stop === "function") job.vtrack.stop(); } catch (e) { /* ok */ }
      try { if (job.atrack && typeof job.atrack.stop === "function") job.atrack.stop(); } catch (e) { /* ok */ }
      try { if (job.src && job.srcStarted === true && typeof job.src.stop === "function") job.src.stop(); } catch (e) { /* ok */ }
      try { if (job.src && typeof job.src.disconnect === "function") job.src.disconnect(); } catch (e) { /* ok */ }
      try { if (job.dest && typeof job.dest.disconnect === "function") job.dest.disconnect(); } catch (e) { /* ok */ }
      avVideo.recording = false;
    };

    const finalize = function (why) {
      if (job.finished) return;
      job.finished = true;
      if (job.raf) { avVideoCancelHandle(job.raf); job.raf = null; }
      if (job.guard !== null) { try { clearTimeout(job.guard); } catch (e) { /* ok */ } job.guard = null; }
      if (job.stopWatch !== null) { try { clearTimeout(job.stopWatch); } catch (e) { /* ok */ } job.stopWatch = null; }
      let blob = null, bytes = 0;
      try {
        blob = new Blob(job.chunks, { type: job.mime || "video/webm" });
        bytes = blob ? blob.size : 0;
      } catch (e) { blob = null; bytes = 0; }
      if (!blob || !(bytes > 0)) {
        if (job.err) warnings.push("recorder error: " + job.err);
        cleanup();
        refuse(blob ? "recorder produced an empty clip" : "clip blob unavailable");
        return;
      }
      if (job.err) warnings.push("recorder error mid-clip: " + job.err);
      const stopWhy = (why === "timeout") ? "timeout" : (job.stopWhy || why);
      if (stopWhy === "timeout") warnings.push("recorder stop timed out \u2014 the blob was built from streamed chunks");
      if (stopWhy === "guard") warnings.push("capture ran past its window; the clip was cut at the guard deadline");
      const at = Date.now();
      avVideo.lastMime = job.mime;
      avVideo.last = { bytes: bytes, seconds: seconds, mime: job.mime, at: at };
      try { if (typeof window !== "undefined" && window) window.__avVideoLast = { bytes: bytes, seconds: seconds, mime: job.mime, at: at }; } catch (e) { /* observability is a nicety */ }
      cleanup();
      if (wantDownload) {
        let dl = false;
        try { dl = avVideoDownload(blob, avVideoClipName()); } catch (e) { dl = false; }
        if (dl !== true) warnings.push("download path unavailable");
      }
      settle({ ok: true, blob: blob, bytes: bytes, seconds: seconds, mime: job.mime, warnings: warnings });
    };

    const requestStop = function (why) {
      if (job.stopping || job.finished) return;
      job.stopping = true;
      job.stopWhy = why;
      if (job.raf) { avVideoCancelHandle(job.raf); job.raf = null; }
      if (job.guard !== null) { try { clearTimeout(job.guard); } catch (e) { /* ok */ } job.guard = null; }
      job.stopWatch = setTimeout(function () { job.stopWatch = null; finalize("timeout"); }, AV_VIDEO_STOP_MS);
      let stopped = false;
      try {
        if (job.recorder && typeof job.recorder.stop === "function") { job.recorder.stop(); stopped = true; }
      } catch (e) { stopped = false; }
      if (!stopped) {
        if (job.stopWatch !== null) { try { clearTimeout(job.stopWatch); } catch (e) { /* ok */ } job.stopWatch = null; }
        finalize(why);
      }
    };

    /* ---- needs (honest reasons; refusal before anything is created) ---- */
    try {
      if (avVideo.recording === true) {
        reasons.push("a clip is already recording");
        refuse("clip refused: " + reasons[0]);
        return;
      }

      let cv = null, g = null;
      try {
        if (typeof document !== "undefined" && document && typeof document.createElement === "function") {
          cv = document.createElement("canvas");
          if (cv) { cv.width = AV_VIDEO_W; cv.height = AV_VIDEO_H; }
        }
      } catch (e) { cv = null; }
      if (!cv) reasons.push("no document \u2014 a canvas cannot be created");
      else {
        try { g = cv.getContext("2d", { alpha: false }); } catch (e) { g = null; }
        if (!g) { try { g = cv.getContext("2d"); } catch (e2) { g = null; } }
        if (!g || typeof g.fillRect !== "function" || typeof g.fillText !== "function") {
          reasons.push("canvas 2d context unavailable");
          g = null;
        }
      }
      if (cv && typeof cv.captureStream !== "function") reasons.push("canvas.captureStream unavailable");
      const hasRecorder = (typeof MediaRecorder === "function");
      if (!hasRecorder) reasons.push("MediaRecorder unavailable");
      const mime = hasRecorder ? avVideoPickMime() : null;
      if (hasRecorder && !mime) reasons.push("no supported mime in the pinned webm chain");
      const ctx = avVideoResolveCtx();
      if (!ctx) reasons.push("no live AudioContext (never created; the clip plays through the live one)");
      else if (typeof ctx.createMediaStreamDestination !== "function" || typeof ctx.createBufferSource !== "function" || typeof ctx.createBuffer !== "function") {
        reasons.push("live AudioContext lacks the clip output path (MediaStreamAudioDestinationNode)");
      }
      if (reasons.length > 0) { refuse("clip unsupported: " + reasons[0]); return; }

      job.g = g;
      job.mime = mime;
      emit("prepare", 0.15);

      (async function () {
        try {
          /* ---- audio first (bounce + graph park; starts with the recorder) ---- */
          emit("audio", 0);
          await avVideoAudioInto(ctx, job, seconds, warnings);
          emit("audio", 1);
          emit("prepare", 0.4);

          /* ---- capture + recorder ---- */
          let canvasStream = null;
          try { canvasStream = cv.captureStream(fps); } catch (e) { canvasStream = null; }
          if (!canvasStream) { cleanup(); refuse("captureStream failed"); return; }
          let vtrack = null;
          try {
            const vt = (typeof canvasStream.getVideoTracks === "function") ? canvasStream.getVideoTracks() : null;
            vtrack = (vt && vt.length > 0) ? vt[0] : null;
          } catch (e) { vtrack = null; }
          if (!vtrack) { cleanup(); refuse("no video track from captureStream"); return; }
          job.stream = canvasStream;
          job.vtrack = vtrack;

          const recStream = avVideoJoinStream(canvasStream, vtrack, job.atrack);
          if (job.atrack && !avVideoStreamHasTrack(recStream, job.atrack)) {
            warnings.push("audio track could not be attached \u2014 recording video-only");
            try { job.atrack.stop(); } catch (e) { /* ok */ }
            job.atrack = null;
          }

          const order = avVideoMimeOrder(mime);
          let rec = null, recMime = null, lastErr = "";
          for (let i = 0; i < order.length && !rec; i++) {
            try {
              const cand = new MediaRecorder(recStream, { mimeType: order[i] });
              if (cand && typeof cand.start === "function" && typeof cand.stop === "function") {
                rec = cand;
                recMime = (typeof cand.mimeType === "string" && cand.mimeType) ? cand.mimeType : order[i];
              } else { lastErr = "constructor returned no recorder"; rec = null; }
            } catch (e) { lastErr = avVideoMsg(e); rec = null; }
          }
          if (!rec) { cleanup(); refuse("MediaRecorder construction failed (" + lastErr + ")"); return; }
          job.recorder = rec;
          job.mime = recMime || mime;

          rec.ondataavailable = function (e) {
            try { if (e && e.data && (e.data.size === undefined || e.data.size > 0)) job.chunks.push(e.data); } catch (e2) { /* ok */ }
          };
          rec.onstop = function () { try { finalize("stop"); } catch (e) { /* ok */ } };
          rec.onerror = function (e) {
            try { job.err = avVideoMsg(e && e.error ? e.error : e); } catch (e2) { job.err = "recorder error"; }
          };

          const meta = avVideoMeta();
          let started = false;
          try { rec.start(AV_VIDEO_CHUNK_MS); started = true; } catch (e) { started = false; }
          if (!started) { cleanup(); refuse("recorder start failed"); return; }
          avVideo.recording = true;
          job.t0 = avVideoNow();

          if (job.src) {
            try { job.src.start(); job.srcStarted = true; } catch (e) { warnings.push("audio start failed: " + avVideoMsg(e)); }
          }

          const tick = function () {
            if (job.finished || job.stopping) return;
            const now = avVideoNow();
            let elapsed = (now - job.t0) / 1000;
            if (!(elapsed >= 0)) elapsed = 0;
            try {
              avVideoRenderFrame(avVideoBuildInput(meta, elapsed, seconds), job.g, elapsed);
              job.frames++;
            } catch (e) { avVideo.errors++; }
            emit("record", seconds > 0 ? (elapsed / seconds) : 1);
            if (elapsed >= seconds) { requestStop("window"); return; }
            job.raf = avVideoSchedule(tick, fps);
          };

          job.guard = setTimeout(function () { job.guard = null; requestStop("guard"); }, Math.round(seconds * 1000) + AV_VIDEO_GUARD_MS);
          job.raf = avVideoSchedule(tick, fps);
          if (!job.raf) {
            warnings.push("no frame scheduler \u2014 the clip was cut short");
            requestStop("window");
          }
        } catch (e) {
          cleanup();
          refuse("clip pipeline failed: " + avVideoMsg(e));
        }
      })();
    } catch (e) {
      cleanup();
      refuse("clip failed: " + avVideoMsg(e));
    }
  });
}

/* ---------- download (avDeliverDownload reuse -> own anchor; never throws) ---------- */

function avVideoDownloadRec(name, bytesN, via) {
  try {
    if (typeof window !== "undefined" && window) {
      window.__avVideoLastDownload = { name: name, bytes: bytesN, via: via, at: Date.now() };
      return true;
    }
  } catch (e) { /* observability is a nicety */ }
  return false;
}

function avVideoAnchorUrl(url, name, revoke) {
  try {
    if (typeof document === "undefined" || !document || typeof document.createElement !== "function") return false;
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    try { a.rel = "noopener"; } catch (e) { /* attribute refused */ }
    const body = document.body;
    let attached = false;
    if (body && typeof body.appendChild === "function") { try { body.appendChild(a); attached = true; } catch (e) { attached = false; } }
    try { a.click(); } catch (e) { /* a click never throws outward here */ }
    if (attached && body && typeof body.removeChild === "function") { try { body.removeChild(a); } catch (e) { /* ok */ } }
    if (revoke) {
      try {
        if (typeof setTimeout === "function") {
          setTimeout(function () {
            try { if (typeof URL !== "undefined" && URL && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url); } catch (e) { /* ok */ }
          }, 8000);
        }
      } catch (e) { /* ok */ }
    }
    return true;
  } catch (e) { return false; }
}

function avVideoAnchorBlob(blob, name) {
  let url = null;
  try {
    if (typeof URL === "undefined" || !URL || typeof URL.createObjectURL !== "function") return false;
    url = URL.createObjectURL(blob);
  } catch (e) { return false; }
  const okA = avVideoAnchorUrl(url, name, true);
  if (okA) avVideoDownloadRec(name, (blob && typeof blob.size === "number") ? blob.size : 0, "anchor");
  return okA;
}

function avVideoAnchorBytes(bytes, name) {
  try {
    if (typeof Blob !== "function") return false;
    return avVideoAnchorBlob(new Blob([bytes], { type: avVideoMimeOf(name) }), name);
  } catch (e) { return false; }
}

function avVideoDeliverBytes(bytes, name) {
  try {
    if (typeof avDeliverDownload === "function") {
      const r = avDeliverDownload(bytes, name);
      if (r === true) {
        avVideoDownloadRec(name, (bytes && typeof bytes.byteLength === "number") ? bytes.byteLength : 0, "deliver");
        return true;
      }
    }
  } catch (e) { /* anchor below */ }
  return avVideoAnchorBytes(bytes, name);
}

function avVideoDownload(blob, name) {
  try {
    if (!blob) return false;
    const nm = avVideoSafeName((name === null || name === undefined || name === "") ? avVideoClipName() : name);
    if (typeof blob.byteLength === "number") return avVideoDeliverBytes(blob, nm);
    if (typeof blob.size === "number") {
      if (typeof blob.arrayBuffer === "function") {
        try {
          const p = blob.arrayBuffer();
          if (p && typeof p.then === "function") {
            p.then(function (buf) {
              if (buf && typeof buf.byteLength === "number") avVideoDeliverBytes(buf, nm);
              else avVideoAnchorBlob(blob, nm);
            }).catch(function () { avVideoAnchorBlob(blob, nm); });
            return true;      /* engaged: conversion + deliver/anchor dispatched */
          }
        } catch (e) { /* sync anchor below */ }
      }
      return avVideoAnchorBlob(blob, nm);
    }
    return false;
  } catch (e) { return false; }
}

/* ---------- init · classes · state ---------- */

function avVideoInit() {
  try {
    if (avVideo.inited) return true;
    avVideo.inited = true;
    return true;
  } catch (e) { return false; }
}

function avVideoClasses() { return []; }

function avVideoState() {
  return {
    version: AV_VIDEO_VERSION,
    inited: avVideo.inited === true,
    recording: avVideo.recording === true,
    runs: avVideo.runs,
    refusals: avVideo.refusals,
    errors: avVideo.errors,
    lastMime: avVideo.lastMime,
    last: avVideo.last ? { bytes: avVideo.last.bytes, seconds: avVideo.last.seconds, mime: avVideo.last.mime, at: avVideo.last.at } : null,
    lastError: avVideo.lastError,
    lastWarnings: avVideo.lastWarnings.slice(0, AV_VIDEO_LIST_CAP),
  };
}

/* ---------- the guarded window probe (the very last statement; node harnesses stay DOM-free) ---------- */

if (typeof window !== "undefined") {
  try {
    window.__avVideo = {
      version: AV_VIDEO_VERSION,
      init: avVideoInit,
      supported: avVideoSupported,
      record: avVideoRecord,
      renderFrame: avVideoRenderFrame,
      download: avVideoDownload,
      state: avVideoState,
    };
  } catch (e) { /* no window — node harness only */ }
}
