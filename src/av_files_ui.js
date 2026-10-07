/* Anvil — PROJECT & SHARE card (child sa-D): the project / share / video card mounted into the
   parent-owned host `#av-files-host` (the parent adds the `#av-files` card at integration and
   calls avFilesUiInit(); this module only fills the host). Per verify/_s4_wave.md §2.4.

   WHAT THIS CARD IS — one card, three sections, seven buttons:
     · PROJECT — SAVE .anvl / OPEN .anvl / IMPORT SAMPLES  ->  avProjSave / avProjOpen /
       avProjImportSamples (the .anvl project file + sample import; the module owns the FSA
       seam with its download fallback — this card only drives the pinned calls).
     · SHARE   — MAKE CARD (avCardPng -> the 1080x1080 card PNG, previewed here in an <img>),
       COPY LINK (avCardCopyLink -> the compact #avp= patch link), SAVE PNG (avCardShare ->
       share sheet where available, download otherwise).
     · VIDEO   — RENDER CLIP (avVideoRecord -> a realtime clip, previewed here in a muted
       <video>; rendered with { download: true } so the clip is also delivered through the
       core's own avVideoDownload path — see the deviation note in the wave report).

   BUSY DISCIPLINE (pinned): ONE module op at a time — while any job runs every action button
   is disabled, a second click is refused with an honest status line, and jobs are never
   queued. Buffers only span one job; receipts are stored in a public (JSON-safe) projection.

   PREVIEWS: object URLs, always through window.URL; the previous URL is revoked the moment a
   replacement lands, and both are revoked when the card re-mounts into fresh markup. Nothing
   auto-plays, nothing auto-runs: init mounts markup + wires delegation ONLY — no core job is
   ever started on init or sync (explicit buttons only).

   HONEST DEGRADE: av_proj / av_card / av_video are each reached typeof-guarded PER CALL;
   absent cores leave their section refusing with a plain note (av-files-note) and a dashed
   action, never an error storm. AbortError-style cancels ("cancelled") are calm, not errors.

   LAW: 'use strict'; classic script; ONE namespace avFilesUi* / AV_FILES_UI_*; node-loadable
   (zero DOM at load); never throws; no console noise; no new AudioContext (none is ever
   touched here — the video core owns audio laws); no uploads (all artifacts are local).

   ID INVENTORY (rig + parent rely on these):
     root card  .av-files[data-av-files="1"]  (id="av-files" assigned only when the parent's
                own #av-files card element is not already in the document)
     #av-files-status · #av-files-note
     PROJECT  #av-files-save · #av-files-open · #av-files-samples · #av-files-pstat
     SHARE    #av-files-card-make · #av-files-card-copy · #av-files-card-png
              #av-files-card-preview (img) · #av-files-cstat
     VIDEO    #av-files-video-run · #av-files-video-preview (muted video) · #av-files-vstat
   CARD HOOKS: [data-av-files-act=save|open|samples|card-make|card-copy|card-png|video-run]
   · [data-av-files-sec=project|share|video] · dataset avFilesUiWired='1' on the host ·
   class av-files-busy + dataset avFilesBusy on the card while a job runs.

   OBSERVABLES: avFilesUiInit() -> bool (false without #av-files-host; idempotent;
   re-mountable) · avFilesUiSync() -> bool · avFilesUiSnap() -> the honest card state (busy
   flags · last receipts · previews present · cores present) · avFilesUiClasses() -> string[]
   (the NEW css classes; the parent styles them) · window.__avFilesUi = { version, state,
   sync, snap, init } (state = the snapshot fn).

   ONE writer (child sa-D). The three cores are consumed through the pinned §2.1/§2.2/§2.3
   names with typeof guards ONLY — avProjSave/Open/ImportSamples · avCardPng/Share/CopyLink ·
   avVideoRecord. DOM touches live only inside guarded functions. */

"use strict";

const AV_FILES_UI_VERSION = "s4.0";
const AV_FILES_UI_URL_CAP = 160;               /* share-link text cap in the SHARE line */

/* ---------- the seven action controls (one source of truth: markup + busy + delegation) ---------- */

const AV_FILES_UI_ACTS = [
  { id: "av-files-save", act: "save", job: "save", lastKey: "save",
    label: "SAVE .anvl", busyLabel: "SAVING\u2026",
    title: "SAVE .anvl \u2014 write the whole session as an anvil project file (File System Access where available, download fallback otherwise)." },
  { id: "av-files-open", act: "open", job: "open", lastKey: "open",
    label: "OPEN .anvl", busyLabel: "OPENING\u2026",
    title: "OPEN .anvl \u2014 open a project file and apply it to the live session (the session module owns the restore laws)." },
  { id: "av-files-samples", act: "samples", job: "samples", lastKey: "samples",
    label: "IMPORT SAMPLES", busyLabel: "IMPORTING\u2026",
    title: "IMPORT SAMPLES \u2014 import audio files (wav / mp3 / ogg / flac / m4a) into the sample store." },
  { id: "av-files-card-make", act: "card-make", job: "cardMake", lastKey: "card",
    label: "MAKE CARD", busyLabel: "MAKING\u2026",
    title: "MAKE CARD \u2014 build the 1080\u00d71080 share card PNG (patch + QR) and preview it below." },
  { id: "av-files-card-copy", act: "card-copy", job: "cardCopy", lastKey: "copy",
    label: "COPY LINK", busyLabel: "COPYING\u2026",
    title: "COPY LINK \u2014 copy the compact patch link (#avp=...) to the clipboard; paste it anywhere. Everything stays local." },
  { id: "av-files-card-png", act: "card-png", job: "cardSave", lastKey: "share",
    label: "SAVE PNG", busyLabel: "SAVING PNG\u2026",
    title: "SAVE PNG \u2014 share or save the card PNG (share sheet when available, download otherwise)." },
  { id: "av-files-video-run", act: "video-run", job: "video", lastKey: "video",
    label: "RENDER CLIP", busyLabel: "RENDERING\u2026",
    title: "RENDER CLIP \u2014 render a realtime clip of the deck + audio and preview it here (the clip renders in real time)." },
];

/* job -> the human gerund used by the busy-refusal line */
const AV_FILES_UI_JOB_WORDS = {
  save: "saving the project", open: "opening a project", samples: "importing samples",
  cardMake: "building the share card", cardCopy: "copying the share link",
  cardSave: "delivering the share card", video: "rendering the clip",
};

/* job -> the start line set when the job begins (status line) */
const AV_FILES_UI_JOB_START = {
  save: "saving the project\u2026", open: "opening a project\u2026", samples: "importing samples\u2026",
  cardMake: "building the share card\u2026", cardCopy: "copying the share link\u2026",
  cardSave: "delivering the share card\u2026",
  video: "rendering the clip (realtime \u2014 it takes as long as the clip)\u2026",
};

/* the NEW css classes this card introduces (the parent styles them; av-files-host excluded —
   it is parent-owned). Kept in one place so the integration class-coverage check can diff. */
const AV_FILES_UI_CLASSES = [
  "av-files", "av-files-head", "av-files-title", "av-files-cap",
  "av-files-status-line", "av-files-status", "av-files-msg", "av-files-err",
  "av-files-secs", "av-files-sec", "av-files-sec-title",
  "av-files-row", "av-files-controls", "av-files-btn",
  "av-files-prev-row", "av-files-preview", "av-files-card-preview", "av-files-video-preview",
  "av-files-stat", "av-files-note", "av-files-foot", "av-files-busy",
];

/* UI-local state only — every core fact is read through the pinned apis per call */
const avFilesUiState = {
  inited: false, mounts: 0,
  /* one module op at a time: busy[job] flags + the running job name */
  busy: { save: false, open: false, samples: false, cardMake: false, cardCopy: false, cardSave: false, video: false },
  busyJob: "",
  jobSeq: 0, doneSeq: 0,
  /* last receipts, keyed the way the snapshot presents them (JSON-safe projections only) */
  last: { save: null, open: null, samples: null, card: null, copy: null, share: null, video: null },
  /* preview object URLs + last sizes (revoked on replace and on re-mount) */
  preview: { cardUrl: null, videoUrl: null, cardBytes: 0, videoBytes: 0 },
  /* the three section stat lines (state mirror; painted memoized) */
  stats: { project: "project file: idle", share: "share card: idle", video: "video clip: idle" },
  videoProgress: null,
  /* status line */
  statusMsg: "files idle", statusKind: "msg",
  /* explicit note (wins over the derived degraded text until cleared) */
  noteText: "",
  /* write-on-change memos so idle syncs never touch the DOM */
  memos: { text: {}, cls: {} },
};

/* ---------- small pure helpers (no DOM; harness-covered) ---------- */

const avFilesUiEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const avFilesUiNum = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };

function avFilesUiNumField(obj, keys) {
  try {
    if (!obj || typeof obj !== "object" || !keys || !keys.length) return null;
    for (let i = 0; i < keys.length; i++) {
      const v = obj[keys[i]];
      if (typeof v === "number" && isFinite(v)) return v;
    }
  } catch (e) { /* none */ }
  return null;
}

function avFilesUiStrField(obj, keys) {
  try {
    if (!obj || typeof obj !== "object" || !keys || !keys.length) return null;
    for (let i = 0; i < keys.length; i++) {
      const v = obj[keys[i]];
      if (typeof v === "string" && v) return v;
    }
  } catch (e) { /* none */ }
  return null;
}

function avFilesUiFmtBytes(v) {
  const n = Number(v);
  if (!isFinite(n) || n < 0) return "\u2014";
  if (n < 1024) return Math.round(n) + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

function avFilesUiFmtIntish(v) {
  const n = Number(v);
  if (!isFinite(n)) return "\u2014";
  return (Math.abs(n - Math.round(n)) < 0.05) ? String(Math.round(n)) : (Math.round(n * 10) / 10).toString();
}

function avFilesUiShort(s, max) {
  try {
    const t = String(s == null ? "" : s);
    const m = (typeof max === "number" && max > 4) ? Math.floor(max) : 96;
    return t.length <= m ? t : t.slice(0, m - 1) + "\u2026";
  } catch (e) { return ""; }
}

function avFilesUiWarnCount(r) {
  try {
    if (r && typeof r === "object" && r.warnings && typeof r.warnings.length === "number") {
      return Math.min(16, Math.floor(r.warnings.length));
    }
  } catch (e) { /* none */ }
  return 0;
}

/* the receipt verdict: true / {ok:true} accept; anything else is a refusal */
function avFilesUiOK(r) {
  try {
    if (r === true) return true;
    if (r && typeof r === "object" && r.ok === true) return true;
  } catch (e) { /* refuse */ }
  return false;
}

/* tolerant receipt normalizer — a receipt is ALWAYS an object after this */
function avFilesUiReceipt(r) {
  try {
    if (r === true) return { ok: true };
    if (r && typeof r === "object") return r;
    if (typeof r === "string" && r) return { ok: false, error: r };
    if (r === false) return { ok: false, error: "refused" };
  } catch (e) { /* fall through */ }
  return { ok: false, error: "no receipt" };
}

/* AbortError-style cancels are calm: they are never dressed up as failures */
function avFilesUiIsCancel(r) {
  try {
    if (!r || typeof r !== "object") return false;
    if (r.cancelled === true || r.canceled === true) return true;
    if (r.ok === false && typeof r.error === "string" && /cancell?ed|abort/i.test(r.error)) return true;
  } catch (e) { /* not a cancel */ }
  return false;
}

function avFilesUiErrText(e, fallback) {
  try {
    if (e && typeof e === "object") {
      if (typeof e.error === "string" && e.error) return e.error;
      if (typeof e.message === "string" && e.message) return e.message;
    }
    if (typeof e === "string" && e) return e;
  } catch (e2) { /* fall through */ }
  return fallback || "refused";
}

/* public (JSON-safe) receipt projection: primitives + small string arrays only; blobs/urls
   beyond plain strings are dropped — the snapshot must survive JSON.stringify */
function avFilesUiPublicReceipt(r) {
  try {
    if (r == null) return { ok: false };
    if (typeof r !== "object") return { ok: r === true };
    const out = { ok: r.ok === true };
    const sk = ["error", "name", "via", "mime"];
    for (let i = 0; i < sk.length; i++) {
      const v = r[sk[i]];
      if (typeof v === "string" && v) out[sk[i]] = v;
    }
    const nk = ["bytes", "applied", "skipped", "added", "count", "max", "w", "h", "seconds", "version", "ec"];
    for (let i = 0; i < nk.length; i++) {
      const v = r[nk[i]];
      if (typeof v === "number" && isFinite(v)) out[nk[i]] = v;
    }
    const ak = ["warnings", "errors", "reasons"];
    for (let i = 0; i < ak.length; i++) {
      const v = r[ak[i]];
      if (v && typeof v.length === "number") {
        const arr = [];
        for (let j = 0; j < v.length && arr.length < 16; j++) {
          const item = v[j];
          if (typeof item === "string") arr.push(item);
          else if (item != null) arr.push(String(item));
        }
        out[ak[i]] = arr;
      }
    }
    if (typeof r.url === "string" && r.url) out.url = r.url;
    return out;
  } catch (e) { return { ok: false, error: "receipt unreadable" }; }
}

/* ---------- guarded DOM + core access (no throw, no noise) ---------- */

function avFilesUiWin() {
  try { if (typeof window !== "undefined") return window; } catch (e) { /* none */ }
  return null;
}

function avFilesUiDoc() {
  try { if (typeof document !== "undefined") return document; } catch (e) { /* none */ }
  return null;
}

function avFilesUiHost() {
  try {
    const d = avFilesUiDoc();
    if (d && typeof d.getElementById === "function") return d.getElementById("av-files-host");
  } catch (e) { /* no document */ }
  return null;
}

/* the cores, each detected by typeof only (never called here) */
function avFilesUiCores() {
  const c = { proj: false, card: false, video: false };
  try { c.proj = typeof avProjSave === "function" || typeof avProjOpen === "function" || typeof avProjImportSamples === "function"; } catch (e) { /* none */ }
  try { c.card = typeof avCardPng === "function" || typeof avCardShare === "function" || typeof avCardCopyLink === "function"; } catch (e) { /* none */ }
  try { c.video = typeof avVideoRecord === "function"; } catch (e) { /* none */ }
  return c;
}

/* ---------- write-on-change DOM painting ---------- */

function avFilesUiWriteText(host, sel, txt, key) {
  try {
    const s = avFilesUiState;
    if (s.memos.text[key] === txt) return false;
    s.memos.text[key] = txt;
    const el = (host && typeof host.querySelector === "function") ? host.querySelector(sel) : null;
    if (el && el.textContent !== txt) el.textContent = txt;
    return true;
  } catch (e) { return false; }
}

function avFilesUiClass(host, sel, cls, on, key) {
  try {
    const s = avFilesUiState;
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

function avFilesUiPaintStatus() {
  const host = avFilesUiHost();
  if (!host) return false;
  try {
    const s = avFilesUiState;
    avFilesUiWriteText(host, "#av-files-status", s.statusMsg, "status");
    avFilesUiClass(host, "#av-files-status", "av-files-err", s.statusKind === "err", "status-err");
    return true;
  } catch (e) { return false; }
}

function avFilesUiSetStatus(msg, kind) {
  try {
    const s = avFilesUiState;
    s.statusMsg = String(msg == null ? "" : msg);
    s.statusKind = (kind === "err") ? "err" : "msg";
    return avFilesUiPaintStatus();
  } catch (e) { return false; }
}

function avFilesUiPaintStats() {
  const host = avFilesUiHost();
  if (!host) return false;
  try {
    const s = avFilesUiState;
    avFilesUiWriteText(host, "#av-files-pstat", s.stats.project, "pstat");
    avFilesUiWriteText(host, "#av-files-cstat", s.stats.share, "cstat");
    avFilesUiWriteText(host, "#av-files-vstat", s.stats.video, "vstat");
    return true;
  } catch (e) { return false; }
}

/* the busy paint: every action button disabled while a job runs; the running button carries
   its busy label; the card carries av-files-busy + aria-busy */
function avFilesUiPaintBusy() {
  const host = avFilesUiHost();
  if (!host) return false;
  try {
    const s = avFilesUiState;
    const busy = avFilesUiBusy();
    for (let i = 0; i < AV_FILES_UI_ACTS.length; i++) {
      const a = AV_FILES_UI_ACTS[i];
      const el = (typeof host.querySelector === "function") ? host.querySelector("#" + a.id) : null;
      if (!el) continue;
      const want = (busy && s.busyJob === a.job) ? a.busyLabel : a.label;
      if (el.textContent !== want) el.textContent = want;
      if (el.disabled !== busy) el.disabled = busy;
    }
    const card = (typeof host.querySelector === "function") ? host.querySelector(".av-files") : null;
    if (card) {
      if (card.dataset) {
        const v = busy ? "1" : "0";
        if (card.dataset.avFilesBusy !== v) card.dataset.avFilesBusy = v;
      }
      if (typeof card.setAttribute === "function") {
        const av = busy ? "true" : "false";
        if (!card.getAttribute || card.getAttribute("aria-busy") !== av) card.setAttribute("aria-busy", av);
      }
      avFilesUiClass(host, ".av-files", "av-files-busy", busy, "card-busy");
    }
    return true;
  } catch (e) { return false; }
}

/* an explicit note (wins over the derived degraded text until cleared) */
function avFilesUiNote(txt) {
  avFilesUiState.noteText = String(txt == null ? "" : txt);
  return avFilesUiPaintNote();
}

function avFilesUiPaintNote() {
  const host = avFilesUiHost();
  if (!host) return false;
  try {
    const s = avFilesUiState;
    const c = avFilesUiCores();
    const missing = [];
    if (!c.proj) missing.push("av_proj.js");
    if (!c.card) missing.push("av_card.js");
    if (!c.video) missing.push("av_video.js");
    let txt = "";
    if (missing.length === 3) {
      txt = "project & share cores (av_proj.js \u00b7 av_card.js \u00b7 av_video.js) not present \u2014 every action refuses honestly. The card fills in when the cores load (the parent boots avProjInit + avCardInit + avVideoInit + avFilesUiInit together).";
    } else if (missing.length > 0) {
      txt = missing.join(" \u00b7 ") + " not present \u2014 those controls refuse honestly until the core loads.";
    }
    if (s.noteText) txt = s.noteText;
    avFilesUiWriteText(host, "#av-files-note", txt, "note");
    const el = (typeof host.querySelector === "function") ? host.querySelector("#av-files-note") : null;
    if (el && el.hidden !== !txt) el.hidden = !txt;
    return true;
  } catch (e) { return false; }
}

/* ---------- previews (object URLs; revoked on replace and on re-mount) ---------- */

function avFilesUiSetPreview(kind, blob) {
  try {
    const s = avFilesUiState;
    const host = avFilesUiHost();
    const w = avFilesUiWin();
    if (!host || !w || !w.URL || typeof w.URL.createObjectURL !== "function") return false;
    if (!blob || typeof blob !== "object" || typeof blob.size !== "number" || !(blob.size > 0)) return false;
    const isVid = (kind === "video");
    const el = (typeof host.querySelector === "function")
      ? host.querySelector(isVid ? "#av-files-video-preview" : "#av-files-card-preview") : null;
    if (!el) return false;
    const url = w.URL.createObjectURL(blob);
    const prev = isVid ? s.preview.videoUrl : s.preview.cardUrl;
    if (prev && prev !== url && typeof w.URL.revokeObjectURL === "function") {
      try { w.URL.revokeObjectURL(prev); } catch (e) { /* revoked best-effort */ }
    }
    if (isVid) { s.preview.videoUrl = url; s.preview.videoBytes = blob.size; }
    else { s.preview.cardUrl = url; s.preview.cardBytes = blob.size; }
    el.src = url;
    if (el.hidden) el.hidden = false;
    if (isVid) { try { el.muted = true; } catch (e2) { /* muted is a nicety of the pinned markup */ } }
    return true;
  } catch (e) { return false; }
}

function avFilesUiRevokePreviewUrls() {
  try {
    const s = avFilesUiState;
    const w = avFilesUiWin();
    if (w && w.URL && typeof w.URL.revokeObjectURL === "function") {
      if (s.preview.cardUrl) { try { w.URL.revokeObjectURL(s.preview.cardUrl); } catch (e) { /* best-effort */ } }
      if (s.preview.videoUrl) { try { w.URL.revokeObjectURL(s.preview.videoUrl); } catch (e) { /* best-effort */ } }
    }
    s.preview.cardUrl = null;
    s.preview.videoUrl = null;
    s.preview.cardBytes = 0;
    s.preview.videoBytes = 0;
    return true;
  } catch (e) { return false; }
}

/* ---------- async settle (receipts may be promises or sync values; never throws) ---------- */

function avFilesUiSettle(p, cb) {
  const done = { v: false };
  const once = function (r) {
    if (done.v) return;
    done.v = true;
    try { cb(r); } catch (e) { /* settle never throws */ }
  };
  try {
    if (p && typeof p.then === "function") {
      p.then(once).catch(function (e) { once({ ok: false, error: avFilesUiErrText(e, "failed") }); });
      return true;
    }
    once(p);
    return true;
  } catch (e) {
    once({ ok: false, error: avFilesUiErrText(e, "failed") });
    return false;
  }
}

/* ---------- the busy discipline (ONE module op at a time) ---------- */

function avFilesUiBusy() {
  const s = avFilesUiState;
  return !!(s.busy.save || s.busy.open || s.busy.samples || s.busy.cardMake ||
            s.busy.cardCopy || s.busy.cardSave || s.busy.video);
}

function avFilesUiJobWord(job) {
  try { return AV_FILES_UI_JOB_WORDS[job] || ""; } catch (e) { return ""; }
}

function avFilesUiActMeta(jobKey) {
  try {
    for (let i = 0; i < AV_FILES_UI_ACTS.length; i++) {
      if (AV_FILES_UI_ACTS[i].job === jobKey) return AV_FILES_UI_ACTS[i];
    }
  } catch (e) { /* none */ }
  return null;
}

function avFilesUiBusyRefuse() {
  const word = avFilesUiJobWord(avFilesUiState.busyJob);
  avFilesUiSetStatus("a job is already running" + (word ? " \u2014 " + word : "") + " \u00b7 one op at a time", "err");
  return false;
}

function avFilesUiMissing(job, why) {
  const s = avFilesUiState;
  const msg = why || "not available in this build";
  try {
    if (job === "save" || job === "open" || job === "samples") s.stats.project = msg;
    else if (job === "video") s.stats.video = msg;
    else s.stats.share = msg;
  } catch (e) { /* stat is a nicety */ }
  avFilesUiSetStatus(msg, "err");
  avFilesUiSync();
  return false;
}

/* start ONE job: marks busy, disables the controls, runs, settles exactly once.
   The run fn is the raw core call (typeof-guarded by the caller); a synchronous throw
   becomes an honest refusal receipt. */
function avFilesUiJob(jobKey, run, settle) {
  const s = avFilesUiState;
  try {
    if (avFilesUiBusy()) return avFilesUiBusyRefuse();
    s.busy[jobKey] = true;
    s.busyJob = jobKey;
    s.jobSeq += 1;
    s.videoProgress = null;
    avFilesUiSetStatus(AV_FILES_UI_JOB_START[jobKey] || "working\u2026");
    avFilesUiSync();                                  /* paints busy before the core runs */
    let out = null;
    try { out = run(); } catch (e) { out = { ok: false, error: avFilesUiErrText(e, "the action failed") }; }
    avFilesUiSettle(out, function (r) {
      s.busy[jobKey] = false;
      s.busyJob = "";
      s.doneSeq += 1;
      s.videoProgress = null;
      const meta = avFilesUiActMeta(jobKey);
      if (meta) s.last[meta.lastKey] = avFilesUiPublicReceipt(r);
      try { settle(r); } catch (e) { /* settle never throws */ }
      avFilesUiSync();
    });
    return true;
  } catch (e) {
    try { s.busy[jobKey] = false; s.busyJob = ""; } catch (e2) { /* shell */ }
    return false;
  }
}

/* ---------- settle renderers (one per job; they set status + section stat + previews) ---------- */

function avFilesUiSettleSave(r0) {
  try {
    const s = avFilesUiState;
    const r = avFilesUiReceipt(r0);
    if (!avFilesUiOK(r)) {
      const why = avFilesUiErrText(r, "the save was refused");
      if (avFilesUiIsCancel(r)) {
        s.stats.project = "project file: save cancelled";
        avFilesUiSetStatus("save cancelled \u2014 nothing was written");
      } else {
        s.stats.project = "project file: save refused \u2014 " + why;
        avFilesUiSetStatus("save refused \u2014 " + why, "err");
      }
      return;
    }
    const name = avFilesUiStrField(r, ["name"]) || "project";
    const bytes = avFilesUiNumField(r, ["bytes"]);
    const via = avFilesUiStrField(r, ["via"]);
    const warns = avFilesUiWarnCount(r);
    const wtxt = warns > 0 ? " \u00b7 " + warns + " warning" + (warns === 1 ? "" : "s") : "";
    const line = "saved " + name + " \u00b7 " + avFilesUiFmtBytes(bytes) + (via ? " \u00b7 via " + via : "") + wtxt;
    s.stats.project = line;
    avFilesUiSetStatus("project " + line);
  } catch (e) { /* settle never throws */ }
}

function avFilesUiSettleOpen(r0) {
  try {
    const s = avFilesUiState;
    const r = avFilesUiReceipt(r0);
    if (!avFilesUiOK(r)) {
      const why = avFilesUiErrText(r, "the open was refused");
      if (avFilesUiIsCancel(r)) {
        s.stats.project = "project file: open cancelled";
        avFilesUiSetStatus("open cancelled \u2014 the session was not touched");
      } else {
        s.stats.project = "project file: open refused \u2014 " + why;
        avFilesUiSetStatus("open refused \u2014 " + why, "err");
      }
      return;
    }
    const name = avFilesUiStrField(r, ["name"]) || "project";
    const applied = avFilesUiNumField(r, ["applied"]);
    const skipped = avFilesUiNumField(r, ["skipped"]);
    const warns = avFilesUiWarnCount(r);
    let line = "opened " + name;
    if (applied != null) line += " \u00b7 applied " + avFilesUiFmtIntish(applied);
    if (skipped != null) line += " \u00b7 skipped " + avFilesUiFmtIntish(skipped);
    if (warns > 0) line += " \u00b7 " + warns + " warning" + (warns === 1 ? "" : "s");
    s.stats.project = line;
    avFilesUiSetStatus("project " + line);
  } catch (e) { /* settle never throws */ }
}

function avFilesUiSettleSamples(r0) {
  try {
    const s = avFilesUiState;
    const r = avFilesUiReceipt(r0);
    if (!avFilesUiOK(r)) {
      const why = avFilesUiErrText(r, "the import was refused");
      if (avFilesUiIsCancel(r)) {
        s.stats.project = "sample import: cancelled";
        avFilesUiSetStatus("sample import cancelled \u2014 nothing was added");
      } else {
        s.stats.project = "sample import refused \u2014 " + why;
        avFilesUiSetStatus("sample import refused \u2014 " + why, "err");
      }
      return;
    }
    const added = avFilesUiNumField(r, ["added"]);
    const count = avFilesUiNumField(r, ["count"]);
    const max = avFilesUiNumField(r, ["max"]);
    const via = avFilesUiStrField(r, ["via"]);
    const errs = (typeof r.errors !== "undefined" && r.errors && typeof r.errors.length === "number") ? r.errors : [];
    let line = "imported " + (added != null ? avFilesUiFmtIntish(added) : "?") + " sample" + (added === 1 ? "" : "s");
    if (count != null) line += " \u00b7 store " + avFilesUiFmtIntish(count) + (max != null ? "/" + avFilesUiFmtIntish(max) : "");
    if (via) line += " \u00b7 via " + via;
    if (errs.length > 0) line += " \u00b7 " + errs.length + " failed";
    s.stats.project = line;
    avFilesUiSetStatus("samples " + line + (errs.length > 0 ? " \u00b7 first: " + avFilesUiShort(errs[0], 60) : ""));
  } catch (e) { /* settle never throws */ }
}

function avFilesUiSettleCard(r0) {
  try {
    const s = avFilesUiState;
    const r = avFilesUiReceipt(r0);
    if (!avFilesUiOK(r)) {
      const why = avFilesUiErrText(r, "the card was refused");
      s.stats.share = "share card refused \u2014 " + why;
      avFilesUiSetStatus("card refused \u2014 " + why, "err");
      return;
    }
    const blob = r.blob;
    const shown = avFilesUiSetPreview("card", blob);
    let bytes = avFilesUiNumField(r, ["bytes"]);
    if (bytes == null && blob && typeof blob.size === "number") bytes = blob.size;
    const w = avFilesUiNumField(r, ["w"]);
    const h = avFilesUiNumField(r, ["h"]);
    let line = "card ready";
    if (w != null && h != null) line += " \u00b7 " + avFilesUiFmtIntish(w) + "\u00d7" + avFilesUiFmtIntish(h);
    if (bytes != null) line += " \u00b7 " + avFilesUiFmtBytes(bytes);
    line += shown ? " \u00b7 previewed below" : " \u00b7 preview unavailable (no object URL)";
    s.stats.share = line;
    avFilesUiSetStatus("share card ready" + (bytes != null ? " \u00b7 " + avFilesUiFmtBytes(bytes) : "") + (shown ? "" : " \u2014 preview unavailable"));
  } catch (e) { /* settle never throws */ }
}

function avFilesUiSettleCopy(r0) {
  try {
    const s = avFilesUiState;
    const r = avFilesUiReceipt(r0);
    if (!avFilesUiOK(r)) {
      const why = avFilesUiErrText(r, "the copy was refused");
      s.stats.share = "share link refused \u2014 " + why;
      avFilesUiSetStatus("copy refused \u2014 " + why, "err");
      return;
    }
    const url = avFilesUiStrField(r, ["url"]);
    const via = avFilesUiStrField(r, ["via"]);
    const clip = (via === "clipboard" || via === "clipboard-api");
    const short = url ? avFilesUiShort(url, AV_FILES_UI_URL_CAP) : "";
    s.stats.share = short ? ("link \u00b7 " + short + (via ? " \u00b7 via " + via : "")) : "link copied" + (via ? " \u00b7 via " + via : "");
    if (clip) avFilesUiSetStatus("share link copied to the clipboard");
    else if (short) avFilesUiSetStatus("clipboard unavailable \u2014 the share link is shown in the SHARE line");
    else avFilesUiSetStatus("share link ready");
  } catch (e) { /* settle never throws */ }
}

function avFilesUiSettlePng(r0) {
  try {
    const s = avFilesUiState;
    const r = avFilesUiReceipt(r0);
    if (!avFilesUiOK(r)) {
      const why = avFilesUiErrText(r, "the card delivery was refused");
      if (avFilesUiIsCancel(r)) {
        s.stats.share = "share card: delivery cancelled";
        avFilesUiSetStatus("card delivery cancelled");
      } else {
        s.stats.share = "share card delivery refused \u2014 " + why;
        avFilesUiSetStatus("card delivery refused \u2014 " + why, "err");
      }
      return;
    }
    const via = avFilesUiStrField(r, ["via"]) || "?";
    let bytes = avFilesUiNumField(r, ["bytes"]);
    const blob = r.blob;
    let shown = false;
    if (blob && typeof blob === "object") shown = avFilesUiSetPreview("card", blob);
    if (bytes == null && blob && typeof blob.size === "number") bytes = blob.size;
    s.stats.share = "card delivered \u00b7 via " + via + (bytes != null ? " \u00b7 " + avFilesUiFmtBytes(bytes) : "") + (shown ? " \u00b7 preview updated" : "");
    avFilesUiSetStatus("share card delivered \u00b7 via " + via + (bytes != null ? " \u00b7 " + avFilesUiFmtBytes(bytes) : ""));
  } catch (e) { /* settle never throws */ }
}

function avFilesUiSettleVideo(r0) {
  try {
    const s = avFilesUiState;
    const r = avFilesUiReceipt(r0);
    if (!avFilesUiOK(r)) {
      const why = avFilesUiErrText(r, "the clip render was refused");
      let reasons = [];
      try { if (r && typeof r === "object" && r.reasons && typeof r.reasons.length === "number") reasons = r.reasons; } catch (e2) { /* none */ }
      const first = reasons.length > 0 ? avFilesUiShort(reasons[0], 80) : "";
      s.stats.video = "clip render refused \u2014 " + why + (first ? " \u00b7 " + first : "");
      avFilesUiSetStatus("clip render refused \u2014 " + why + (first ? " \u00b7 " + first : ""), "err");
      return;
    }
    const blob = r.blob;
    const shown = avFilesUiSetPreview("video", blob);
    let bytes = avFilesUiNumField(r, ["bytes"]);
    if (bytes == null && blob && typeof blob.size === "number") bytes = blob.size;
    const seconds = avFilesUiNumField(r, ["seconds"]);
    const mime = avFilesUiStrField(r, ["mime"]);
    const warns = avFilesUiWarnCount(r);
    let line = "clip ready";
    if (seconds != null) line += " \u00b7 " + avFilesUiFmtIntish(seconds) + " s";
    if (bytes != null) line += " \u00b7 " + avFilesUiFmtBytes(bytes);
    if (mime) line += " \u00b7 " + mime;
    if (warns > 0) line += " \u00b7 " + warns + " warning" + (warns === 1 ? "" : "s");
    line += shown ? " \u00b7 previewed below" : " \u00b7 preview unavailable (no object URL)";
    s.stats.video = line;
    avFilesUiSetStatus("clip rendered" + (seconds != null ? " \u00b7 " + avFilesUiFmtIntish(seconds) + " s" : "") + (bytes != null ? " \u00b7 " + avFilesUiFmtBytes(bytes) : "") + (shown ? "" : " \u2014 preview unavailable"));
  } catch (e) { /* settle never throws */ }
}

/* live progress from the video core (only honored while the video job runs) */
function avFilesUiVideoProgress(phase, frac) {
  try {
    const s = avFilesUiState;
    if (s.busy.video !== true) return false;
    const ph = (typeof phase === "string" && phase) ? phase : "rendering";
    const f = Number(frac);
    let line = "rendering clip \u00b7 " + ph;
    if (isFinite(f)) {
      const pct = Math.round(Math.max(0, Math.min(1, f)) * 100);
      line += " \u00b7 " + pct + "%";
      s.videoProgress = { phase: ph, frac: pct / 100 };
    } else {
      s.videoProgress = { phase: ph, frac: null };
    }
    s.stats.video = line;
    avFilesUiPaintStats();
    return true;
  } catch (e) { return false; }
}

/* ---------- the seven actions (each core reach typeof-guarded per call) ---------- */

function avFilesUiActSave() {
  if (avFilesUiBusy()) return avFilesUiBusyRefuse();
  if (typeof avProjSave !== "function") return avFilesUiMissing("save", "the project module (av_proj.js) is not present \u2014 saving is unavailable");
  return avFilesUiJob("save", function () { return avProjSave(); }, avFilesUiSettleSave);
}

function avFilesUiActOpen() {
  if (avFilesUiBusy()) return avFilesUiBusyRefuse();
  if (typeof avProjOpen !== "function") return avFilesUiMissing("open", "the project module (av_proj.js) is not present \u2014 opening is unavailable");
  return avFilesUiJob("open", function () { return avProjOpen(); }, avFilesUiSettleOpen);
}

function avFilesUiActSamples() {
  if (avFilesUiBusy()) return avFilesUiBusyRefuse();
  if (typeof avProjImportSamples !== "function") return avFilesUiMissing("samples", "the project module (av_proj.js) is not present \u2014 sample import is unavailable");
  return avFilesUiJob("samples", function () { return avProjImportSamples(); }, avFilesUiSettleSamples);
}

function avFilesUiActCardMake() {
  if (avFilesUiBusy()) return avFilesUiBusyRefuse();
  if (typeof avCardPng !== "function") return avFilesUiMissing("cardMake", "the share-card module (av_card.js) is not present \u2014 card making is unavailable");
  return avFilesUiJob("cardMake", function () { return avCardPng(); }, avFilesUiSettleCard);
}

function avFilesUiActCardCopy() {
  if (avFilesUiBusy()) return avFilesUiBusyRefuse();
  if (typeof avCardCopyLink !== "function") return avFilesUiMissing("cardCopy", "the share-card module (av_card.js) is not present \u2014 link copying is unavailable");
  return avFilesUiJob("cardCopy", function () { return avCardCopyLink(); }, avFilesUiSettleCopy);
}

/* SAVE PNG drives avCardShare (the card module's own share-or-download path) — the pinned
   §2.4 control set maps one-to-one onto the pinned av_card surface: MAKE CARD -> avCardPng
   (preview), COPY LINK -> avCardCopyLink, SAVE PNG -> avCardShare. */
function avFilesUiActCardPng() {
  if (avFilesUiBusy()) return avFilesUiBusyRefuse();
  if (typeof avCardShare !== "function") return avFilesUiMissing("cardSave", "the share-card module (av_card.js) is not present \u2014 card saving is unavailable");
  return avFilesUiJob("cardSave", function () { return avCardShare(); }, avFilesUiSettlePng);
}

function avFilesUiActVideo() {
  if (avFilesUiBusy()) return avFilesUiBusyRefuse();
  if (typeof avVideoRecord !== "function") return avFilesUiMissing("video", "the video module (av_video.js) is not present \u2014 clip rendering is unavailable");
  return avFilesUiJob("video", function () {
    /* download:true so the rendered clip is also delivered through the core's own
       avVideoDownload path (the card pins no separate video-save control) */
    return avVideoRecord({ download: true, onProgress: avFilesUiVideoProgress });
  }, avFilesUiSettleVideo);
}

/* the act dispatcher (used by the delegated click and by the rig/harness directly) */
function avFilesUiAct(act) {
  try {
    if (act === "save") return avFilesUiActSave();
    if (act === "open") return avFilesUiActOpen();
    if (act === "samples") return avFilesUiActSamples();
    if (act === "card-make") return avFilesUiActCardMake();
    if (act === "card-copy") return avFilesUiActCardCopy();
    if (act === "card-png") return avFilesUiActCardPng();
    if (act === "video-run") return avFilesUiActVideo();
  } catch (e) { /* an act never throws */ }
  return false;
}

/* ---------- event delegation (one click listener per host) ---------- */

function avFilesUiClick(ev) {
  try {
    const t = ev && ev.target;
    if (!t || typeof t.closest !== "function") return;
    const btn = t.closest("[data-av-files-act]");
    if (!btn) return;
    if (btn.disabled === true) return;
    const act = String((btn.getAttribute && btn.getAttribute("data-av-files-act")) || "");
    avFilesUiAct(act);
  } catch (err) { /* a listener never throws outward */ }
}

function avFilesUiWire(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  try {
    if (host.dataset && host.dataset.avFilesUiWired === "1") return true;   /* one delegation per host element */
    if (host.dataset) host.dataset.avFilesUiWired = "1";
    host.addEventListener("click", avFilesUiClick);
    return true;
  } catch (e) { return false; }
}

/* ---------- markup ---------- */

function avFilesUiBtnHTML(a) {
  return '<button type="button" class="av-btn mini av-files-btn" id="' + avFilesUiEsc(a.id) +
    '" data-av-files-act="' + avFilesUiEsc(a.act) + '" title="' + avFilesUiEsc(a.title) + '">' +
    avFilesUiEsc(a.label) + "</button>";
}

function avFilesUiActsHTML(acts) {
  let out = "";
  for (let i = 0; i < acts.length; i++) {
    const a = avFilesUiActMeta(acts[i]);
    if (a) out += avFilesUiBtnHTML(a);
  }
  return out;
}

function avFilesUiBodyHTML() {
  return '<div class="av-files" data-av-files="1">' +
    '<div class="av-files-head"><span class="av-files-title">PROJECT &amp; SHARE</span>' +
    '<span class="av-files-cap av-dim">Save and reopen the whole session as an .anvl project \u00b7 import samples \u00b7 a patch share card with its link \u00b7 a realtime video clip \u2014 everything stays on this machine.</span></div>' +
    '<div class="av-files-status-line"><span class="av-files-status av-files-msg" id="av-files-status" role="status" aria-live="polite">files idle</span></div>' +

    '<div class="av-files-secs">' +
    '<section class="av-files-sec" data-av-files-sec="project">' +
    '<div class="av-files-sec-title">PROJECT</div>' +
    '<div class="av-files-row av-files-controls">' + avFilesUiActsHTML(["save", "open", "samples"]) + "</div>" +
    '<div class="av-files-stat av-dim" id="av-files-pstat" role="status">project file: idle</div>' +
    "</section>" +

    '<section class="av-files-sec" data-av-files-sec="share">' +
    '<div class="av-files-sec-title">SHARE</div>' +
    '<div class="av-files-row av-files-controls">' + avFilesUiActsHTML(["cardMake", "cardCopy", "cardSave"]) + "</div>" +
    '<div class="av-files-row av-files-prev-row"><img class="av-files-preview av-files-card-preview" id="av-files-card-preview" alt="share card preview" hidden /></div>' +
    '<div class="av-files-stat av-dim" id="av-files-cstat" role="status">share card: idle</div>' +
    "</section>" +

    '<section class="av-files-sec" data-av-files-sec="video">' +
    '<div class="av-files-sec-title">VIDEO</div>' +
    '<div class="av-files-row av-files-controls">' + avFilesUiActsHTML(["video"]) + "</div>" +
    '<div class="av-files-row av-files-prev-row"><video class="av-files-preview av-files-video-preview" id="av-files-video-preview" muted playsinline controls aria-label="last rendered clip preview"></video></div>' +
    '<div class="av-files-stat av-dim" id="av-files-vstat" role="status">video clip: idle</div>' +
    "</section>" +
    "</div>" +

    '<p class="av-files-note av-note av-dim" id="av-files-note" hidden></p>' +
    '<p class="av-files-foot av-dim">Projects, cards and clips never leave this machine \u2014 no uploads, no accounts. Saving uses the File System Access API where available and a download fallback otherwise; the clip renders in realtime and previews muted.</p>' +
    "</div>";
}

/* #av-files root: the parent adds its own `#av-files` card; this root takes the id only when
   no such element exists (never a duplicate id). */
function avFilesUiEnsureRootId(card) {
  try {
    if (!card) return false;
    if (card.id) return false;
    const d = avFilesUiDoc();
    const existing = (d && typeof d.getElementById === "function") ? d.getElementById("av-files") : null;
    if (existing && existing !== card) return false;
    card.id = "av-files";
    return true;
  } catch (e) { return false; }
}

/* ---------- init / sync / snap ---------- */

function avFilesUiInit() {
  const host = avFilesUiHost();
  if (!host) return false;
  try {
    const s = avFilesUiState;
    let card = null;
    try { card = (typeof host.querySelector === "function") ? host.querySelector(".av-files") : null; } catch (e) { card = null; }
    if (!card) {
      /* re-mount into fresh markup: the old preview object URLs die with the old DOM */
      avFilesUiRevokePreviewUrls();
      s.memos.text = {};
      s.memos.cls = {};
      host.innerHTML = avFilesUiBodyHTML();
      try { card = (typeof host.querySelector === "function") ? host.querySelector(".av-files") : null; } catch (e2) { card = null; }
    }
    avFilesUiEnsureRootId(card);
    avFilesUiWire(host);
    s.inited = true;
    s.mounts += 1;
    avFilesUiSync();
    return true;
  } catch (e) { return false; }
}

function avFilesUiSync() {
  const host = avFilesUiHost();
  if (!host) return false;
  try {
    avFilesUiPaintBusy();
    avFilesUiPaintStats();
    avFilesUiPaintStatus();
    avFilesUiPaintNote();
    return true;
  } catch (e) { return false; }
}

function avFilesUiSnap() {
  const host = avFilesUiHost();
  const s = avFilesUiState;
  const cores = avFilesUiCores();
  const out = {
    version: AV_FILES_UI_VERSION,
    inited: !!s.inited,
    mounts: s.mounts,
    host: !!host,
    wired: !!(host && host.dataset && host.dataset.avFilesUiWired === "1"),
    card: false,
    sections: { project: false, share: false, video: false },
    controls: { save: false, open: false, samples: false, cardMake: false, cardCopy: false, cardSave: false, videoRun: false },
    cores: cores,
    busy: {
      any: avFilesUiBusy(),
      job: s.busyJob || "",
      flags: {
        save: !!s.busy.save, open: !!s.busy.open, samples: !!s.busy.samples,
        cardMake: !!s.busy.cardMake, cardCopy: !!s.busy.cardCopy,
        cardSave: !!s.busy.cardSave, video: !!s.busy.video,
      },
    },
    previews: { card: !!s.preview.cardUrl, video: !!s.preview.videoUrl, cardBytes: s.preview.cardBytes, videoBytes: s.preview.videoBytes },
    last: {
      save: s.last.save, open: s.last.open, samples: s.last.samples, card: s.last.card,
      copy: s.last.copy, share: s.last.share, video: s.last.video,
    },
    stats: { project: s.stats.project, share: s.stats.share, video: s.stats.video },
    status: s.statusMsg,
    statusKind: s.statusKind,
    note: s.noteText || "",
    jobs: { started: s.jobSeq, done: s.doneSeq },
    classes: avFilesUiClasses(),
  };
  try {
    if (host && typeof host.querySelector === "function") {
      out.card = !!host.querySelector(".av-files");
      out.sections.project = !!host.querySelector("[data-av-files-sec=\"project\"]") || !!host.querySelector(".av-files");
      out.sections.share = !!host.querySelector("[data-av-files-sec=\"share\"]") || !!host.querySelector(".av-files");
      out.sections.video = !!host.querySelector("[data-av-files-sec=\"video\"]") || !!host.querySelector(".av-files");
      out.controls.save = !!host.querySelector("#av-files-save");
      out.controls.open = !!host.querySelector("#av-files-open");
      out.controls.samples = !!host.querySelector("#av-files-samples");
      out.controls.cardMake = !!host.querySelector("#av-files-card-make");
      out.controls.cardCopy = !!host.querySelector("#av-files-card-copy");
      out.controls.cardSave = !!host.querySelector("#av-files-card-png");
      out.controls.videoRun = !!host.querySelector("#av-files-video-run");
    }
  } catch (e) { /* no DOM */ }
  return out;
}

function avFilesUiClasses() {
  return AV_FILES_UI_CLASSES.slice();
}

/* ---------- debug/verify handle ---------- */

if (typeof window !== "undefined") {
  try {
    const stateFn = function () { return avFilesUiSnap(); };
    try {
      Object.defineProperty(stateFn, "inited", { get: function () { return !!avFilesUiState.inited; } });
      Object.defineProperty(stateFn, "busy", { get: function () { return avFilesUiBusy(); } });
      Object.defineProperty(stateFn, "mounts", { get: function () { return avFilesUiState.mounts; } });
    } catch (e2) { /* getters are a nicety */ }
    window.__avFilesUi = {
      version: AV_FILES_UI_VERSION,
      state: stateFn,
      sync: function () { return avFilesUiSync(); },
      snap: function () { return avFilesUiSnap(); },
      init: function () { return avFilesUiInit(); },
    };
  } catch (e) { /* no window — nothing to publish */ }
}
