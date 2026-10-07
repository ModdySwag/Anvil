/* av_proj.js — Anvil S4 DELIVER EXTRAS (child sa-A, verify/_s4_wave.md §2.1): the .anvl project
   I/O core — save/open of full session projects through a File System Access seam with an anchor /
   download fallback, plus direct sample import from disk.

   THE PIECES:
     avProjBuild  the envelope — compact JSON text of { magic:"anvl", v:1, app:"anvil",
                  kind:"project", at:<ISO>, name, state:<avSessionCapture() output verbatim> }
                  plus one trailing LF; explicit field order; deterministic (`at` derives from
                  meta.at, then state.savedAt, then the epoch ISO — never a wall-clock read).
     avProjParse  the read half — pure; validates magic==="anvl" && v===1 && kind==="project" &&
                  a state object; foreign/corrupt input is an honest ok:false.
     avProjSave   capture -> build -> FSA showSaveFilePicker -> createWritable -> write(text) ->
                  close; fallback avDeliverDownload(bytes, name) when callable, else an own anchor.
                  AbortError (user cancel) = {ok:false, error:"cancelled"} — no fallback noise.
     avProjOpen   FSA showOpenFilePicker (multiple:false) -> getFile() -> text() -> avProjParse ->
                  avSessionApply(project.state) — the session module's OWN laws apply; nothing is
                  re-implemented here.
     avProjImportSamples  FSA multi-open (audio types) -> avSampleImportFiles(files); fallback =
                  ONE hidden <input type="file" multiple accept="audio/*">, appended once, reused.

   PUBLIC SURFACE (classic-script globals, ONE namespace avProj* / AV_PROJ_*):
     avProjInit() -> bool               idempotent; no DOM; nothing to bind
     avProjSetFs(fs|null) -> bool       injection seam { showOpenFilePicker, showSaveFilePicker };
                                        resolved per call; window FSA is the default. An injected
                                        fs is NEVER merged with window — a fake records every call.
     avProjBuild(state?, meta?) -> {ok, error?, name, text}   pure; deterministic bytes
     avProjParse(text) -> {ok, error?, project}               pure; magic/v/kind/state validation
     avProjSave(opts?) -> Promise<receipt>   { ok, error?, name, bytes, via:"fsa"|"download",
                                               warnings[] } — opts: name, at, state (test seam)
     avProjOpen(opts?) -> Promise<receipt>   { ok, error?, name, applied, skipped, warnings[] }
                                        — opts.state: raw file TEXT | parsed payload | bare state
     avProjImportSamples() -> Promise<receipt>  { ok, error?, added, errors, count, max,
                                                  via:"fsa"|"input" }
     avProjState() -> { version, init, fsKind:"window"|"injected"|"none", lastSave, lastOpen,
                        lastError }
     avProjClasses() -> []              mounts nothing (the UI card owns markup)
     window.__avProj = { version, init, setFs, build, parse, save, open, samples, state }
     observables: window.__avProjLastSave = { name, bytes, via, at }
                  window.__avProjLastOpen = { name, ok, applied, skipped, at }

   DETERMINISM (the pure pair): build emits compact JSON of an explicitly-ordered object plus one
   trailing LF. `at` resolves meta.at (ms number or ISO string, verbatim when a string) ->
   state.savedAt -> AV_PROJ_EPOCH_ISO. Two builds of the same state + meta are byte-identical;
   parse is pure JSON in, project out.

   LAWS (verify/_s4_wave.md §3): 'use strict'; classic script; ONE namespace; node-loadable (zero
   DOM reach at load — every browser reach typeof-guarded inside functions); NEVER throws (honest
   refusals, counted skips); no console noise; bounded arrays (cap 16). The module creates no
   audio objects of any kind.

   ONE writer (child sa-A). */

"use strict";

/* ---------- pins (§2.1) ---------- */

const AV_PROJ_VERSION = "s4.0";
const AV_PROJ_MAGIC = "anvl";
const AV_PROJ_APP = "anvil";
const AV_PROJ_KIND = "project";
const AV_PROJ_V = 1;
const AV_PROJ_PREFIX = "anvil-project-";
const AV_PROJ_EXT = ".anvl";
const AV_PROJ_NAME_CAP = 64;
const AV_PROJ_SLUG_CAP = 40;
const AV_PROJ_MSG_CAP = 120;
const AV_PROJ_LIST_CAP = 16;                       /* every receipt array is bounded (§3 law 7) */
const AV_PROJ_TEXT_CAP = 16777216;                 /* 16 MiB — refuse absurd texts both ways */
const AV_PROJ_EPOCH_ISO = "1970-01-01T00:00:00.000Z";   /* the deterministic `at` of last resort */
const AV_PROJ_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})?$/;
const AV_PROJ_CLASSES = Object.freeze([]);         /* this module mounts nothing */

/* ---------- module state (no DOM nodes; the input element is the one browser object held) ---- */

const avProj = {
  inited: false,
  fs: null,              /* the injected seam (null = window FSA default) */
  fsInjected: false,
  inputEl: null,         /* the ONE hidden <input> for the samples fallback — appended once */
  lastSave: null,
  lastOpen: null,
  lastError: null,
};

/* ---------- guarded environment reaches (plain node has none of these) ---------- */

function avProjWin() {
  try {
    const w = (typeof window !== "undefined") ? window : null;
    if (w && typeof w === "object") return w;
  } catch (e) { /* no window */ }
  return null;
}

function avProjDoc() {
  try {
    if (typeof document !== "undefined" && document && typeof document.createElement === "function") return document;
  } catch (e) { /* no document */ }
  return null;
}

function avProjNow() {
  try { return Date.now(); } catch (e) { return 0; }
}

/* ---------- tiny value laws (garbage in, sane value out — never throw) ---------- */

function avProjObj(v) {
  return (v !== null && typeof v === "object" && !Array.isArray(v));
}

function avProjClone(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; }
}

function avProjErrName(e) {
  try { return (e && e.name) ? String(e.name).slice(0, 40) : ""; } catch (e2) { return ""; }
}

function avProjErrMsg(e) {
  try {
    const s = (e && e.message) ? String(e.message) : String(e);
    return s.slice(0, AV_PROJ_MSG_CAP);
  } catch (e2) { return "error"; }
}

/* bounded push: receipt arrays never grow past AV_PROJ_LIST_CAP (§3 law 7) */
function avProjPush(list, item) {
  try {
    if (list && typeof list.push === "function" && list.length < AV_PROJ_LIST_CAP) {
      list.push(String(item == null ? "" : item).slice(0, AV_PROJ_MSG_CAP));
    }
  } catch (e) { /* bounded by design */ }
}

/* copy a list of names/paths into a fresh, capped, string-only array */
function avProjStringList(v) {
  const out = [];
  try {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length && out.length < AV_PROJ_LIST_CAP; i++) {
        out.push(String(v[i] == null ? "" : v[i]).slice(0, AV_PROJ_MSG_CAP));
      }
    }
  } catch (e) { /* [] */ }
  return out;
}

/* ---------- naming (§2.1: anvil-project-<slug>.anvl; slug from the session name or "untitled") */

function avProjCleanName(v) {
  try {
    if (typeof v === "number" && isFinite(v)) v = String(v);
    if (typeof v !== "string") return null;
    const s = v.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
    if (!s) return null;
    return s.slice(0, AV_PROJ_NAME_CAP);
  } catch (e) { return null; }
}

function avProjSlug(v) {
  try {
    let s = String(v == null ? "" : v).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    s = s.replace(/^-+/, "").replace(/-+$/, "").slice(0, AV_PROJ_SLUG_CAP).replace(/-+$/, "");
    return s || "untitled";
  } catch (e) { return "untitled"; }
}

function avProjFileName(name) {
  return AV_PROJ_PREFIX + avProjSlug(name) + AV_PROJ_EXT;
}

/* ---------- the `at` law (deterministic; no wall-clock read) ---------- */

function avProjIso(v) {
  try {
    if (typeof v === "number") {
      if (!isFinite(v)) return null;
      return new Date(v).toISOString();
    }
    if (typeof v === "string") {
      const s = v.trim();
      if (s.length >= 19 && s.length <= 40 && AV_PROJ_ISO_RE.test(s)) return s;
    }
  } catch (e) { /* garbage in */ }
  return null;
}

function avProjResolveAt(state, meta) {
  let at = null;
  try { if (meta && meta.at !== undefined && meta.at !== null) at = avProjIso(meta.at); } catch (e) { at = null; }
  if (at) return at;
  try { if (state) at = avProjIso(state.savedAt); } catch (e) { at = null; }
  if (at) return at;
  return AV_PROJ_EPOCH_ISO;
}

/* ---------- UTF-8 accounting (bytes are the truth, whatever the code units) ---------- */

function avProjUtf8Bytes(text) {
  try {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(String(text == null ? "" : text));
  } catch (e) { /* fall through to the manual count */ }
  return null;
}

function avProjUtf8Len(text) {
  const s = String(text == null ? "" : text);
  try {
    const b = avProjUtf8Bytes(s);
    if (b) return b.length;
  } catch (e) { /* manual count stands */ }
  let n = 0;
  try {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { n += 4; i += 1; } else n += 3;
      } else n += 3;
    }
  } catch (e) { return 0; }
  return n;
}

/* ---------- the FSA seam (the ONLY picker reach; resolved per call) ---------- */

function avProjFs() {
  try { if (avProj.fsInjected && avProj.fs && typeof avProj.fs === "object") return avProj.fs; } catch (e) { /* read refused */ }
  return avProjWin();
}

function avProjFsKind() {
  try {
    if (avProj.fsInjected && avProj.fs) return "injected";
    const w = avProjWin();
    if (w && (typeof w.showSaveFilePicker === "function" || typeof w.showOpenFilePicker === "function")) return "window";
  } catch (e) { /* none */ }
  return "none";
}

/* resolved picker: { fs, fn } (called as fn.call(fs, opts) — receivers stay intact) or null */
function avProjPicker(kind) {
  const fs = avProjFs();
  if (!fs) return null;
  try {
    const fn = (kind === "save") ? fs.showSaveFilePicker : fs.showOpenFilePicker;
    if (typeof fn === "function") return { fs: fs, fn: fn };
  } catch (e) { /* property read refused */ }
  return null;
}

/* ---------- sibling-module resolvers (binding, then window property) ---------- */

function avProjCaptureFn() {
  try { if (typeof avSessionCapture === "function") return avSessionCapture; } catch (e) { /* not injected */ }
  try { const w = avProjWin(); if (w && typeof w.avSessionCapture === "function") return w.avSessionCapture; } catch (e) { /* no window */ }
  return null;
}

function avProjApplyFn() {
  try { if (typeof avSessionApply === "function") return avSessionApply; } catch (e) { /* not injected */ }
  try { const w = avProjWin(); if (w && typeof w.avSessionApply === "function") return w.avSessionApply; } catch (e) { /* no window */ }
  return null;
}

function avProjImportFn() {
  try { if (typeof avSampleImportFiles === "function") return avSampleImportFiles; } catch (e) { /* not injected */ }
  try { const w = avProjWin(); if (w && typeof w.avSampleImportFiles === "function") return w.avSampleImportFiles; } catch (e) { /* no window */ }
  return null;
}

function avProjDeliverFn() {
  try { if (typeof avDeliverDownload === "function") return avDeliverDownload; } catch (e) { /* not injected */ }
  try { const w = avProjWin(); if (w && typeof w.avDeliverDownload === "function") return w.avDeliverDownload; } catch (e) { /* no window */ }
  return null;
}

/* ---------- picker option builders (fresh objects per call; deterministic) ---------- */

function avProjSaveTypes() {
  return [{ description: "Anvil project", accept: { "application/json": [".anvl"] } }];
}

function avProjOpenTypes() {
  return [{ description: "Anvil project", accept: { "application/json": [".anvl", ".json"] } }];
}

function avProjAudioTypes() {
  return [{
    description: "Audio samples",
    accept: {
      "audio/wav": [".wav"],
      "audio/mpeg": [".mp3"],
      "audio/ogg": [".ogg"],
      "audio/flac": [".flac"],
      "audio/mp4": [".m4a"],
    },
  }];
}

/* ---------- payload validation (§2.1: magic/v/kind/state; never throw) ---------- */

function avProjValidatePayload(p) {
  try {
    if (!avProjObj(p)) return { ok: false, error: "not a project payload", project: null };
    if (p.magic !== AV_PROJ_MAGIC) return { ok: false, error: "bad magic", project: null };
    if (p.v !== AV_PROJ_V) return { ok: false, error: "bad version", project: null };
    if (p.kind !== AV_PROJ_KIND) return { ok: false, error: "bad kind", project: null };
    if (!avProjObj(p.state)) return { ok: false, error: "no state", project: null };
    return {
      ok: true,
      error: null,
      project: {
        magic: AV_PROJ_MAGIC,
        v: AV_PROJ_V,
        app: (typeof p.app === "string" && p.app) ? p.app.slice(0, AV_PROJ_NAME_CAP) : null,
        kind: AV_PROJ_KIND,
        at: avProjIso(p.at),
        name: avProjCleanName(p.name),
        state: p.state,
      },
    };
  } catch (e) {
    return { ok: false, error: avProjErrMsg(e), project: null };
  }
}

/* ---------- avProjBuild (§2.1) — pure; deterministic bytes ---------- */

function avProjBuild(stateIn, metaIn) {
  try {
    const meta = avProjObj(metaIn) ? metaIn : {};
    let state = null;
    if (stateIn !== undefined && stateIn !== null) {
      if (!avProjObj(stateIn)) {
        return { ok: false, error: "state must be an object", name: avProjFileName(meta.name), text: "" };
      }
      state = stateIn;
    } else {
      /* no explicit state: the live capture is the default source (guarded; degrade refuses) */
      const cap = avProjCaptureFn();
      if (!cap) return { ok: false, error: "no session module", name: avProjFileName(meta.name), text: "" };
      let got = null;
      try { got = cap(); } catch (e) { got = null; }
      if (!avProjObj(got)) return { ok: false, error: "capture failed", name: avProjFileName(meta.name), text: "" };
      state = got;
    }
    const name = avProjCleanName(meta.name) || avProjCleanName(state.name) || "untitled";
    const at = avProjResolveAt(state, meta);
    let text = null;
    try {
      text = JSON.stringify({
        magic: AV_PROJ_MAGIC,
        v: AV_PROJ_V,
        app: AV_PROJ_APP,
        kind: AV_PROJ_KIND,
        at: at,
        name: name,
        state: state,
      });
    } catch (e) { text = null; }
    if (typeof text !== "string" || text.length === 0) {
      return { ok: false, error: "state not serialisable", name: avProjFileName(name), text: "" };
    }
    if (text.length > AV_PROJ_TEXT_CAP) {
      return { ok: false, error: "too large", name: avProjFileName(name), text: "" };
    }
    return { ok: true, error: null, name: avProjFileName(name), text: text + "\n" };
  } catch (e) {
    return { ok: false, error: avProjErrMsg(e), name: AV_PROJ_PREFIX + "untitled" + AV_PROJ_EXT, text: "" };
  }
}

/* ---------- avProjParse (§2.1) — pure; magic/v/kind/state validation ---------- */

function avProjParse(text) {
  try {
    if (typeof text !== "string") return { ok: false, error: "not a string", project: null };
    if (text.length > AV_PROJ_TEXT_CAP) return { ok: false, error: "too large", project: null };
    let p = null;
    try { p = JSON.parse(text); } catch (e) { return { ok: false, error: "not JSON", project: null }; }
    const v = avProjValidatePayload(p);
    if (!v.ok) return { ok: false, error: v.error, project: null };
    return { ok: true, error: null, project: v.project };
  } catch (e) {
    return { ok: false, error: avProjErrMsg(e), project: null };
  }
}

/* ---------- download fallback (avDeliverDownload when callable, else an own anchor) ---------- */

function avProjAnchor(text, name) {
  try {
    const doc = avProjDoc();
    if (!doc) return false;
    if (typeof Blob === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = doc.createElement("a");
    a.href = url;
    a.download = name;
    try { a.rel = "noopener"; } catch (e) { /* attribute refused */ }
    const body = doc.body;
    let attached = false;
    if (body && typeof body.appendChild === "function") { try { body.appendChild(a); attached = true; } catch (e) { attached = false; } }
    try { a.click(); } catch (e) { /* the anchor click never throws outward here */ }
    if (attached && body && typeof body.removeChild === "function") { try { body.removeChild(a); } catch (e) { /* ok */ } }
    try { if (typeof setTimeout === "function") setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { /* ok */ } }, 8000); } catch (e) { /* ok */ }
    return true;
  } catch (e) { return false; }
}

function avProjDownloadFallback(text, name, warnings) {
  const fn = avProjDeliverFn();
  if (fn) {
    const bytes = avProjUtf8Bytes(text);
    let ok = false;
    try { ok = !!(bytes && fn(bytes, name) === true); } catch (e) { ok = false; }
    if (ok) return true;
    avProjPush(warnings, "deliver download refused — used the anchor");
  }
  return avProjAnchor(text, name);
}

/* ---------- observables + receipt helpers ---------- */

function avProjRecordSave(name, bytes, via, at) {
  try { const w = avProjWin(); if (w) w.__avProjLastSave = { name: name, bytes: bytes, via: via, at: at }; } catch (e) { /* nicety */ }
}

function avProjRecordOpen(name, ok, applied, skipped) {
  try {
    const w = avProjWin();
    if (w) w.__avProjLastOpen = { name: name, ok: ok, applied: applied, skipped: skipped, at: avProjNow() };
  } catch (e) { /* nicety */ }
}

function avProjSaveRefuse(error, name, bytes, warnings, via) {
  const receipt = { ok: false, error: error, name: name, bytes: bytes, via: via, warnings: warnings };
  if (error !== "cancelled") avProj.lastError = error;   /* a cancel is calm, not an error */
  return receipt;
}

function avProjSaveOk(name, bytes, via, warnings, at) {
  const receipt = { ok: true, error: null, name: name, bytes: bytes, via: via, warnings: warnings };
  avProj.lastSave = receipt;
  avProj.lastError = null;
  avProjRecordSave(name, bytes, via, at);
  return receipt;
}

/* ---------- avProjSave (§2.1) — capture -> build -> FSA save / download fallback ---------- */

function avProjSave(opts) {
  try {
    return Promise.resolve(avProjSaveRun(opts)).catch(function (e) {
      return avProjSaveRefuse(avProjErrMsg(e), null, 0, [], null);
    });
  } catch (e) {
    return Promise.resolve(avProjSaveRefuse(avProjErrMsg(e), null, 0, [], null));
  }
}

async function avProjSaveRun(opts) {
  const o = avProjObj(opts) ? opts : {};
  const warnings = [];
  /* 1) the state: the opts.state test seam, or the live capture (§2.1: capture -> build) */
  let state = null;
  if (o.state !== undefined && o.state !== null) {
    if (!avProjObj(o.state)) return avProjSaveRefuse("state must be an object", null, 0, warnings, null);
    state = o.state;
  } else {
    const cap = avProjCaptureFn();
    if (!cap) return avProjSaveRefuse("no session module", null, 0, warnings, null);
    let got = null;
    try { got = cap(); } catch (e) { got = null; }
    if (!avProjObj(got)) return avProjSaveRefuse("capture failed", null, 0, warnings, null);
    state = got;
  }
  /* 2) the deterministic envelope */
  const at = avProjResolveAt(state, o);
  const b = avProjBuild(state, { name: o.name, at: at });
  if (!b.ok) return avProjSaveRefuse(b.error || "build failed", b.name, 0, warnings, null);
  const name = b.name;
  const text = b.text;
  const bytes = avProjUtf8Len(text);
  if (bytes > AV_PROJ_TEXT_CAP) return avProjSaveRefuse("too large", name, bytes, warnings, null);
  /* 3) FSA save through the seam — AbortError is a calm cancel and never falls back */
  const pick = avProjPicker("save");
  if (pick) {
    let handle = null, pickerNote = "";
    try {
      handle = await pick.fn.call(pick.fs, { suggestedName: name, types: avProjSaveTypes() });
    } catch (e) {
      if (avProjErrName(e) === "AbortError") return avProjSaveRefuse("cancelled", name, bytes, [], null);
      pickerNote = "save picker refused (" + (avProjErrName(e) || "error") + ") — downloaded instead";
      avProjPush(warnings, pickerNote);
    }
    if (handle && typeof handle.createWritable === "function") {
      let wrote = false;
      try {
        const w = await handle.createWritable();
        await w.write(text);
        await w.close();
        wrote = true;
      } catch (e) {
        if (avProjErrName(e) === "AbortError") return avProjSaveRefuse("cancelled", name, bytes, [], null);
        avProjPush(warnings, "fsa write failed (" + (avProjErrName(e) || "error") + ") — downloaded instead");
      }
      if (wrote) return avProjSaveOk(name, bytes, "fsa", warnings, at);
    } else if (handle && !pickerNote) {
      avProjPush(warnings, "fsa handle refused — downloaded instead");
    } else if (!handle && !pickerNote) {
      avProjPush(warnings, "save picker returned nothing — downloaded instead");
    }
  }
  /* 4) the download fallback (via records the truth) */
  const landed = avProjDownloadFallback(text, name, warnings);
  if (!landed) return avProjSaveRefuse("no save path", name, bytes, warnings, null);
  return avProjSaveOk(name, bytes, "download", warnings, at);
}

/* ---------- avProjOpen (§2.1) — FSA open -> parse -> avSessionApply(state) ---------- */

function avProjOpen(opts) {
  try {
    return Promise.resolve(avProjOpenRun(opts)).catch(function (e) {
      return avProjOpenRefuse(avProjErrMsg(e), null, []);
    });
  } catch (e) {
    return Promise.resolve(avProjOpenRefuse(avProjErrMsg(e), null, []));
  }
}

function avProjOpenRefuse(error, name, warnings) {
  const receipt = { ok: false, error: error, name: name, applied: 0, skipped: [], warnings: warnings };
  avProj.lastOpen = avProjClone(receipt) || receipt;
  if (error !== "cancelled") avProj.lastError = error;
  avProjRecordOpen(name, false, 0, []);
  return receipt;
}

function avProjBaseName(fname) {
  try {
    if (typeof fname !== "string") return null;
    const s = fname.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (!s) return null;
    const i = s.lastIndexOf(".");
    const base = (i > 0) ? s.slice(0, i) : s;
    return base ? base.slice(0, AV_PROJ_NAME_CAP) : null;
  } catch (e) { return null; }
}

function avProjFileText(file) {
  return new Promise(function (res) {
    let settled = false;
    const done = function (t) { if (!settled) { settled = true; res((typeof t === "string") ? t : null); } };
    try {
      if (file && typeof file.text === "function") {
        let p = null;
        try { p = file.text(); } catch (e) { p = null; }
        if (p && typeof p.then === "function") { p.then(function (t) { done(t); }, function () { done(null); }); return; }
        done(p);
        return;
      }
    } catch (e) { /* fall through to FileReader */ }
    try {
      if (file && typeof FileReader === "function") {
        const fr = new FileReader();
        fr.onload = function () { done(fr.result); };
        fr.onerror = function () { done(null); };
        fr.onabort = function () { done(null); };
        fr.readAsText(file);
        return;
      }
    } catch (e) { /* give up */ }
    done(null);
  });
}

async function avProjOpenRun(opts) {
  const o = avProjObj(opts) ? opts : {};
  const warnings = [];
  let project = null;
  let fileBase = null;
  /* the opts.state test seam (§2.1: skips the picker) — raw text keeps the FULL pipeline */
  if (typeof o.state === "string") {
    const p = avProjParse(o.state);
    if (!p.ok) return avProjOpenRefuse(p.error || "parse failed", null, warnings);
    project = p.project;
  } else if (avProjObj(o.state)) {
    /* a payload carries magic/kind; a bare session state never does (its own `v` field must NOT
       route it into payload validation — a session state always has v:1) */
    if (o.state.magic !== undefined || o.state.kind !== undefined) {
      const v = avProjValidatePayload(o.state);
      if (!v.ok) return avProjOpenRefuse(v.error || "bad payload", null, warnings);
      project = v.project;
    } else {
      /* a bare state object: applied directly (test seam) */
      project = { magic: AV_PROJ_MAGIC, v: AV_PROJ_V, app: AV_PROJ_APP, kind: AV_PROJ_KIND, at: null, name: null, state: o.state };
    }
  } else {
    const pick = avProjPicker("open");
    if (!pick) return avProjOpenRefuse("no file picker", null, warnings);
    let handles = null;
    try {
      handles = await pick.fn.call(pick.fs, { multiple: false, types: avProjOpenTypes() });
    } catch (e) {
      if (avProjErrName(e) === "AbortError") return avProjOpenRefuse("cancelled", null, []);
      return avProjOpenRefuse("open picker failed (" + (avProjErrName(e) || "error") + ")", null, warnings);
    }
    const handle = Array.isArray(handles) ? handles[0] : handles;
    if (!handle) return avProjOpenRefuse("no selection", null, warnings);
    let file = null;
    try { if (typeof handle.getFile === "function") file = await handle.getFile(); } catch (e) { file = null; }
    if (!file) return avProjOpenRefuse("cannot read file", null, warnings);
    fileBase = avProjBaseName(file.name);
    const text = await avProjFileText(file);
    if (typeof text !== "string") return avProjOpenRefuse("cannot read file", fileBase, warnings);
    const p = avProjParse(text);
    if (!p.ok) return avProjOpenRefuse(p.error || "parse failed", fileBase, warnings);
    project = p.project;
  }
  const name = project.name || fileBase || null;
  /* apply through the session module — its OWN laws apply, nothing re-implemented here */
  const applyFn = avProjApplyFn();
  if (!applyFn) return avProjOpenRefuse("no session module", name, warnings);
  let ap = null;
  try { ap = applyFn(project.state); } catch (e) { ap = null; }
  if (!avProjObj(ap)) return avProjOpenRefuse("apply failed", name, warnings);
  const applied = (typeof ap.applied === "number" && isFinite(ap.applied)) ? ap.applied : 0;
  const skipped = avProjStringList(ap.skipped);      /* mirrors avSessionApply's receipt */
  const ok = ap.ok === true;
  let errText = null;
  if (!ok && typeof ap.error === "string" && ap.error) errText = ap.error.slice(0, AV_PROJ_MSG_CAP);
  const receipt = { ok: ok, error: ok ? null : (errText || "apply refused"), name: name, applied: applied, skipped: skipped, warnings: warnings };
  avProj.lastOpen = avProjClone(receipt) || receipt;
  avProj.lastError = receipt.error;
  avProjRecordOpen(name, ok, applied, skipped);
  return receipt;
}

/* ---------- avProjImportSamples (§2.1) — FSA multi-open -> avSampleImportFiles(files) ---------- */

function avProjSamplesBase(error, via) {
  return { ok: false, error: error, added: [], errors: [], count: null, max: null, via: (via === undefined ? null : via) };
}

function avProjSamplesCancel(via) {
  return { ok: false, error: "cancelled", added: [], errors: [], count: null, max: null, via: via };
}

/* normalise the avSampleImportFiles result ({ok, added, errors, count, max}) — it never rejects,
   but every leg is guarded anyway; arrays come out capped and string-only */
async function avProjImportCall(importFn, files) {
  let r = null;
  try { r = await importFn(files); } catch (e) { r = { ok: false, added: [], errors: [avProjErrMsg(e)], count: null, max: null }; }
  if (!avProjObj(r)) r = { ok: false, added: [], errors: ["import refused"], count: null, max: null };
  return {
    ok: r.ok === true,
    added: avProjStringList(r.added),
    errors: avProjStringList(r.errors),
    count: (typeof r.count === "number" && isFinite(r.count)) ? r.count : null,
    max: (typeof r.max === "number" && isFinite(r.max)) ? r.max : null,
  };
}

function avProjSamplesReceipt(r, via) {
  const ok = r.ok === true;
  const receipt = {
    ok: ok,
    error: ok ? null : ((r.errors && r.errors.length) ? r.errors[0] : "import refused"),
    added: r.added,
    errors: r.errors,
    count: r.count,
    max: r.max,
    via: via,
  };
  avProj.lastError = ok ? null : receipt.error;
  return receipt;
}

/* the ONE hidden <input> fallback — appended once, reused on every later import */
function avProjImportInputPick(importFn) {
  return new Promise(function (res) {
    let settled = false;
    const done = function (r) { if (!settled) { settled = true; res(r); } };
    try {
      const doc = avProjDoc();
      if (!doc) return done(avProjSamplesBase("no DOM for the file input", "input"));
      let inp = avProj.inputEl;
      if (!inp) {
        inp = doc.createElement("input");
        try { inp.type = "file"; inp.multiple = true; inp.accept = "audio/*"; } catch (e) { /* attributes refused */ }
        try { inp.style.display = "none"; } catch (e) { /* ok */ }
        const host = doc.body || (doc.documentElement ? doc.documentElement : null);
        if (host && typeof host.appendChild === "function") { try { host.appendChild(inp); } catch (e) { /* ok */ } }
        avProj.inputEl = inp;
      }
      const cleanup = function () {
        try {
          if (typeof inp.removeEventListener === "function") {
            inp.removeEventListener("change", onChange);
            inp.removeEventListener("cancel", onCancel);
          }
        } catch (e) { /* ok */ }
      };
      const onChange = function () {
        cleanup();
        let files = null;
        try { files = inp.files; } catch (e) { files = null; }
        try { inp.value = ""; } catch (e) { /* ok */ }   /* re-importing the same file must fire again */
        if (files && typeof files.length === "number" && files.length > 0) {
          avProjImportCall(importFn, files).then(function (r) { done(avProjSamplesReceipt(r, "input")); });
        } else {
          done(avProjSamplesCancel("input"));
        }
      };
      const onCancel = function () { cleanup(); done(avProjSamplesCancel("input")); };
      if (typeof inp.addEventListener === "function") {
        try { inp.addEventListener("change", onChange); } catch (e) { return done(avProjSamplesBase("file input refused", "input")); }
        try { inp.addEventListener("cancel", onCancel); } catch (e) { /* the cancel event is a nicety */ }
      } else {
        return done(avProjSamplesBase("file input refused", "input"));
      }
      try { inp.value = ""; } catch (e) { /* ok */ }
      try { inp.click(); } catch (e) { cleanup(); return done(avProjSamplesBase("file input refused", "input")); }
    } catch (e) {
      done(avProjSamplesBase(avProjErrMsg(e), "input"));
    }
  });
}

function avProjImportSamples() {
  try {
    return Promise.resolve(avProjImportSamplesRun()).catch(function (e) {
      return avProjSamplesBase(avProjErrMsg(e), null);
    });
  } catch (e) {
    return Promise.resolve(avProjSamplesBase(avProjErrMsg(e), null));
  }
}

async function avProjImportSamplesRun() {
  const importFn = avProjImportFn();
  if (!importFn) return avProjSamplesBase("no sample module", null);
  const pick = avProjPicker("open");
  if (pick) {
    let handles = null, cancelled = false, failed = null;
    try {
      handles = await pick.fn.call(pick.fs, { multiple: true, types: avProjAudioTypes() });
    } catch (e) {
      if (avProjErrName(e) === "AbortError") cancelled = true;
      else failed = avProjErrName(e) || "error";
    }
    if (cancelled) return avProjSamplesCancel("fsa");
    if (!failed) {
      const files = [];
      const arr = Array.isArray(handles) ? handles : (handles ? [handles] : []);
      let skipped = 0;
      for (let i = 0; i < arr.length; i++) {
        try {
          const f = (arr[i] && typeof arr[i].getFile === "function") ? await arr[i].getFile() : arr[i];
          if (f) files.push(f); else skipped += 1;
        } catch (e) { skipped += 1; }
      }
      if (!files.length) return avProjSamplesBase(skipped ? "no readable files" : "no files", "fsa");
      const r = await avProjImportCall(importFn, files);
      if (skipped > 0) avProjPush(r.errors, "skipped " + skipped + " unreadable file(s)");
      return avProjSamplesReceipt(r, "fsa");
    }
    /* non-abort picker failure: the input fallback follows */
  }
  return avProjImportInputPick(importFn);
}

/* ---------- PLATFORM: avProjOpenText — the File Handling entry (a launched .anvl) ----------
   The read half of avProjOpenRun for text that arrives from outside (the PWA launchQueue consumer):
   parse -> apply through the injected session module (avSessionApply) -> record. Receipt shape
   matches avProjOpenRun's; never throws. */
function avProjOpenText(name, text) {
  const warnings = [];
  const nm = avProjCleanName(name) || "launched.anvl";
  if (typeof text !== "string" || !text) return avProjOpenRefuse("the launched file was empty", nm, warnings);
  const p = avProjParse(text);
  if (!p.ok) return avProjOpenRefuse(p.error || "parse failed", nm, warnings);
  const project = p.project;
  const pname = project.name || nm;
  const applyFn = avProjApplyFn();
  if (!applyFn) return avProjOpenRefuse("no session module", pname, warnings);
  let ap = null;
  try { ap = applyFn(project.state); } catch (e) { ap = null; }
  if (!avProjObj(ap)) return avProjOpenRefuse("apply failed", pname, warnings);
  const applied = (typeof ap.applied === "number" && isFinite(ap.applied)) ? ap.applied : 0;
  const skipped = avProjStringList(ap.skipped);
  const ok = ap.ok === true;
  let errText = null;
  if (!ok && typeof ap.error === "string" && ap.error) errText = ap.error.slice(0, AV_PROJ_MSG_CAP);
  const receipt = { ok: ok, error: ok ? null : (errText || "apply refused"), name: pname, applied: applied, skipped: skipped, warnings: warnings };
  avProj.lastOpen = avProjClone(receipt) || receipt;
  avProj.lastError = receipt.error;
  avProjRecordOpen(pname, ok, applied, skipped);
  return receipt;
}

/* ---------- avProjInit / avProjSetFs / avProjState / avProjClasses (§2.1) ---------- */

function avProjInit() {
  try { avProj.inited = true; return true; } catch (e) { return false; }
}

function avProjSetFs(fs) {
  try {
    const st = avProj;
    if (fs === null || fs === undefined) { st.fs = null; st.fsInjected = false; return true; }
    if (typeof fs !== "object") return false;
    const hasOpen = typeof fs.showOpenFilePicker === "function";
    const hasSave = typeof fs.showSaveFilePicker === "function";
    if (!hasOpen && !hasSave) return false;
    st.fs = fs;
    st.fsInjected = true;
    return true;
  } catch (e) { return false; }
}

function avProjState() {
  try {
    const st = avProj;
    return {
      version: AV_PROJ_VERSION,
      init: st.inited === true,
      fsKind: avProjFsKind(),
      lastSave: st.lastSave ? avProjClone(st.lastSave) : null,
      lastOpen: st.lastOpen ? avProjClone(st.lastOpen) : null,
      lastError: st.lastError,
    };
  } catch (e) {
    return { version: AV_PROJ_VERSION, init: false, fsKind: "none", lastSave: null, lastOpen: null, lastError: "state" };
  }
}

function avProjClasses() {
  return AV_PROJ_CLASSES.slice();   /* this module mounts nothing — the UI card owns markup */
}

/* ---------- debug handle (rigs + parent call these; names are the contract) ---------- */

if (typeof window !== "undefined" && window) {
  try {
    window.__avProj = {
      version: AV_PROJ_VERSION,
      init: avProjInit,
      setFs: avProjSetFs,
      build: avProjBuild,
      parse: avProjParse,
      openText: avProjOpenText,
      save: avProjSave,
      open: avProjOpen,
      samples: avProjImportSamples,
      state: avProjState,
    };
  } catch (e) { /* no window — node harness only */ }
}
