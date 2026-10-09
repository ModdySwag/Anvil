/* Anvil — S2 SESSIONS card (child sa-C): the session snapshot UI mounted into the parent-owned
   host `#av-sessions-host` (the parent adds the `#av-sessions` card at integration and calls
   avSessionUiInit(); this module only fills the host). Per verify/_s2_wave.md §2.3.

   WHAT THIS CARD IS
   - RECOVERY banner row (shown only while avSessionState().recovery.available): states the
     snapshot's savedAt/name; RECOVER applies it (avSessionRecover), DISMISS clears the offer
     (avSessionDismissRecovery). The offer never auto-applies.
   - SESSIONS: a name field + SAVE (avSessionSave(name)) and the saved-sessions list
     (avSessionList()): one row per session — name · savedAt · vN · LOAD (avSessionLoad) · ✕
     (avSessionDelete, immediate — the module owns refusal semantics); the current session is
     marked CURRENT; every session carries a versions sub-row with per-version RESTORE
     (avSessionRestore(id, version)).
   - AUTOSAVE: toggle (avSessionAutosave(on, ms)) + interval select 15/30/45/90 s + readout
     (on/off · interval · last write from avSessionState().lastAutosaveAt).
   - BACKUP: BACKUP NOW -> avBackupBuild() -> anchor-blob download (the av_deliver_ui
     technique) + window.__avSessionUiLastExport stamp · RESTORE (FILE) -> the hidden
     #av-sessions-restore-file input -> avBackupRestore(buffer) with a progress line and a
     report of the restored counts (sessions/packs/samples), skipped and errors.
   - status line + warnings area (degradation is reported there, never console noise).

   LAW: every sibling call is consumed through the pinned §2.1/§2.2 names with typeof guards
   ONLY — avSessionState/List/Save/Load/Delete/Versions/Restore/Autosave/Recover/
   DismissRecovery · avBackupBuild/State/Restore. This file never reaches into another
   module's internals and never calls the siblings' Init functions (app_core owns those
   boots). It never throws. No console noise at all. No DOM at top level — the file loads in
   plain node (harness). ONE namespace avSessionUi* / AV_SESSION_UI_*.

   ORCHESTRATION DECISIONS (documented seams for the parent):
   - the card never edits session state directly: every read goes through avSessionState() /
     avSessionList() / avSessionVersions() per paint, every write through the pinned calls
     (single source of truth).
   - rAF-free: repaint happens on user actions, on async settles and via a light ~1.2 s poll
     that compares a state+list signature (autosave writes and recovery availability surface
     without any loop churn). The poll uses setInterval, guarded; it never runs before init.
   - versions sub-rows are fetched per session per repaint through avSessionVersions(id) with
     a typeof guard; if the module returns a non-array (future async shape), the sub-rows are
     simply omitted — never a throw. Rendering is capped at 16 versions/session and 32
     sessions (the module ring is <= 16, so real data always fits).
   - BACKUP / RESTORE (FILE) and the per-row ops (SAVE · LOAD · ✕ · RESTORE(v)) share one
     module-op gate: one pinned call in flight at a time keeps the pin honest without queuing
     surprises; the controls stay disabled meanwhile.
   - the delete ✕ is immediate (single click) — matching the studio take-✕ precedent; the
     module owns refusal semantics for a missing record.
   - a non-standard autosave interval set elsewhere is shown honestly as an extra option in
     the select (the four pinned values stay 15/30/45/90 s).
   - the recovery banner states savedAt exactly as avSessionState() reports it (epoch ms,
     ISO string or a plain string) — normalized for display, never invented.
   - BACKUP download uses the anchor-blob path from av_deliver_ui (Blob + object URL + a
     click); no File System Access picker (the backup button is the user activation). A
     receipt without buffer bytes says so honestly instead of pretending a download happened.
   - restore-file reads via file.arrayBuffer() with a FileReader fallback; the input value is
     reset so the same file can be picked again.

   BROWSER V2 (R20): the search + sort controls are CLIENT-SIDE view filters over the rows
   (never a module call); search matches name + tags (case-insensitive substring); sort values
   newest | name | updated ("newest" = the module's own order; "name"/"updated" mirror the
   import manager's comparators). Tags commit through the pinned avSessionSetTags (typeof
   guarded, quick meta writes outside the module-op gate); the editor is inline per row and
   Enter/blur commits while Escape cancels. ONE shared rerender serves the list, the filters
   and the tag editor.

   OBSERVABLES: avSessionUiInit() -> bool (false without host, never throws, idempotent,
   dataset marker avSessionUiWired='1') · avSessionUiSync() -> bool (repaint) ·
   avSessionUiClasses() -> string[] (the NEW css classes; the parent styles them) ·
   avSessionUiSnap() -> the honest card state · window.__avSessionUi = { version, init, sync,
   classes, state, save, load, del, restore, backup, pick, recover, dismiss, autosave } ·
   window.__avSessionUiLastExport = { kind, name, bytes, downloaded, at } (backup download
   stamp) · window.__avSessionUiLastRestore = { name, bytes, restored, skipped, errors, at }.

   ID INVENTORY (rig + parent rely on these):
    #av-sessions-search (browser v2 search) | #av-sessions-sort (newest | name | updated)
     #av-sessions-status
     #av-sessions-recovery · #av-sessions-recovery-at · #av-sessions-recover · #av-sessions-dismiss
     #av-sessions-count · #av-sessions-storage
     #av-sessions-name · #av-sessions-save · #av-sessions-list · #av-sessions-none
     #av-sessions-autosave · #av-sessions-autosave-val · #av-sessions-autosave-ms
     #av-sessions-backup · #av-sessions-backup-val · #av-sessions-restore · #av-sessions-restore-file
     #av-sessions-progress · #av-sessions-report · #av-sessions-warnings · #av-sessions-foot
   CARD HOOKS: `.av-sessions[data-av-sessions="1"]` · `.av-sessions-session[data-id]` (state
   class `av-sessions-cur`) · `.av-sessions-ver[data-id][data-ver]` ·
   `[data-act=load|del|restore|tags]` plus `.av-sessions-tags[data-id]` /
   `.av-sessions-tags-input[data-id]` / `.av-sessions-prev[data-id]` (browser v2 rows).
   ONE writer (child sa-C). Never throws. */

"use strict";

const AV_SESSION_UI_VERSION = "s2.0";
const AV_SESSION_UI_WARN_MAX = 8;
const AV_SESSION_UI_AS_OPTS = [15, 30, 45, 90];      /* pinned interval select values, seconds */
const AV_SESSION_UI_AS_DEF = 45;                      /* the module's own default interval */
const AV_SESSION_UI_LIST_MAX = 32;                    /* sessions rendered (bounded growth) */
const AV_SESSION_UI_VERS_MAX = 16;                    /* versions rendered per session (ring bound) */
const AV_SESSION_UI_NAME_MAX = 64;
const AV_SESSION_UI_POLL_MS = 1200;
const AV_SESSION_UI_TAG_MAX = 8;                      /* tags per session (mirrors the module cap) */
const AV_SESSION_UI_TAG_LEN = 24;                     /* chars per tag (mirrors the module cap)    */
const AV_SESSION_UI_SEARCH_MAX = 64;                  /* the search field cap (view filter only)   */
const AV_SESSION_UI_SORTS = ["newest", "name", "updated"];   /* the pinned sort values (R20)        */

/* UI-local state only — every module fact is read through the pinned av* APIs per paint */
const avSessionUiState = {
  inited: false, mounts: 0, timerId: null,
  /* module mirror (avSessionState) */
  count: 0, curId: "", curName: "", dirty: false, lastAsAt: 0,
  autosaveOn: false, autosaveMs: AV_SESSION_UI_AS_DEF * 1000,
  recAvail: false, recAt: "", recName: "",
  backend: "",
  /* name-field refill memo (refill only when the current session id changes) */
  nameId: null,
  /* op gate + transient phases */
  saveBusy: false, opBusy: null, backupBusy: false, restoreFileBusy: false, recovering: false,
  /* last backup receipt (fallback when avBackupState is absent) */
  lastBackup: null,
  /* status + report + warnings */
  lastMsg: "", lastMsgKind: "msg",
  progress: "", report: "", reportKind: "msg",
  warnings: [], warnKey: "",
  /* paint memos */
  sessKey: "", asKey: "",
  /* browser v2 (R20): client-side view filters + the tag inline editor + tags-write counter */
  search: "", sort: "newest", tagEditId: "", tagDraft: "", lastRows: 0, tagsBusy: 0,
  /* poll signature sentinel so the first poll always syncs */
  pollSig: "\u0000",
};

/* ---------- small pure helpers (no DOM; harness-covered) ---------- */

const avSessionUiEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const avSessionUiNum = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };

function avSessionUiClean(s, max) {
  let t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  if (max && t.length > max) t = t.slice(0, max - 1) + "\u2026";
  return t;
}

/* int with clamp; non-finite/garbage -> def (null def = refuse) */
function avSessionUiInt(v, lo, hi, def) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return (def === undefined ? null : def);
  return Math.max(lo, Math.min(hi, n));
}

function avSessionUiPad2(n) { return n < 10 ? ("0" + n) : String(n); }

/* local-time "YYYY-MM-DD HH:MM" for a finite ms epoch */
function avSessionUiFmtDate(ms) {
  const d = new Date(Number(ms));
  if (!isFinite(d.getTime())) return "";
  return d.getFullYear() + "-" + avSessionUiPad2(d.getMonth() + 1) + "-" + avSessionUiPad2(d.getDate()) +
    " " + avSessionUiPad2(d.getHours()) + ":" + avSessionUiPad2(d.getMinutes());
}

/* savedAt/at normalizer: epoch ms (or seconds), ISO/date string, Date — display only */
function avSessionUiWhen(v) {
  try {
    if (v == null || v === "") return "";
    if (typeof v === "number") {
      if (!isFinite(v) || v <= 0) return "";
      return avSessionUiFmtDate(v < 1e11 ? v * 1000 : v);
    }
    if (typeof v === "string") {
      const t = v.trim();
      if (!t) return "";
      if (/^\d+$/.test(t)) return avSessionUiWhen(Number(t));
      const parsed = Date.parse(t);
      if (isFinite(parsed)) return avSessionUiFmtDate(parsed);
      return avSessionUiClean(t, 24);
    }
    if (typeof v === "object" && v !== null && typeof v.getTime === "function") {
      const t = v.getTime();
      if (isFinite(t)) return avSessionUiFmtDate(t);
    }
  } catch (e) { /* none */ }
  return "";
}

function avSessionUiFmtBytes(n) {
  const v = Number(n);
  if (!isFinite(v) || v < 0) return "";
  if (v < 1024) return Math.round(v) + " B";
  if (v < 1048576) return (v / 1024).toFixed(1) + " KB";
  return (v / 1048576).toFixed(2) + " MB";
}

/* module errors -> honest one-liners (the raw text is kept when nothing matches) */
function avSessionUiErrText(err) {
  let raw = "";
  try { raw = String((err && err.message) ? err.message : (err == null ? "" : err)); } catch (e) { raw = ""; }
  raw = raw.replace(/\s+/g, " ").trim().slice(0, 140);
  const e = raw.toLowerCase();
  if (/no session|unknown session|not found|missing session|no record/.test(e)) return "that session no longer exists";
  if (/quota|full|space/.test(e)) return "browser storage is full \u2014 delete something first";
  if (/blocked|denied|idb|indexeddb|storage|refused the write/.test(e)) return "browser storage refused \u2014 nothing landed";
  if (/zip|corrupt|parse|json|invalid|bad file|foreign/.test(e)) return "the file could not be read \u2014 not a valid backup zip";
  if (/busy|in progress/.test(e)) return "another operation is still running \u2014 try again";
  return raw || "refused";
}

/* receipt verdict: explicit false / null / {ok:false} refuse; everything else (incl.
   undefined) counts as success (the pinned calls only refuse explicitly) */
function avSessionUiOK(r) {
  try {
    if (r === false || r === null) return false;
    if (r && typeof r === "object" && r.ok === false) return false;
    return true;
  } catch (e) { return false; }
}

/* warnings list helpers (pure) — dedupe by key, newest last, bounded */
function avSessionUiWarnMerge(list, key, text, max) {
  const out = [];
  try {
    const src = Array.isArray(list) ? list : [];
    for (let i = 0; i < src.length; i++) {
      const w = src[i];
      if (!w || w.key === key) continue;
      out.push(w);
    }
    out.push({ key: key, text: text });
    while (out.length > (max || AV_SESSION_UI_WARN_MAX)) out.shift();
  } catch (e) { /* keep what we have */ }
  return out;
}

function avSessionUiWarnDrop(list, key) {
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
function avSessionUiFlagFrom(obj, keys) {
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

function avSessionUiNumField(obj, keys) {
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

function avSessionUiStrField(obj, keys) {
  try {
    if (!obj || typeof obj !== "object" || !Array.isArray(keys)) return "";
    for (let i = 0; i < keys.length; i++) {
      const v = obj[keys[i]];
      if (typeof v === "string" && v) return v;
    }
  } catch (e) { /* none */ }
  return "";
}

/* "N applied · N skipped" bits out of a receipt (guarded) */
function avSessionUiCountBits(r) {
  const bits = [];
  try {
    if (!r || typeof r !== "object") return bits;
    const applied = avSessionUiNumField(r, ["applied"]);
    if (applied != null) bits.push(Math.round(applied) + " applied");
    const skipped = avSessionUiNumField(r, ["skipped"]);
    if (skipped != null && skipped > 0) bits.push(Math.round(skipped) + " skipped");
  } catch (e) { /* none */ }
  return bits;
}

/* ---------- browser v2 helpers (pure; R20) ---------- */

/* tags normalizer (mirrors the module law: max 8 tags, each max 24 chars, lowercase-trimmed,
   deduped); array in -> clean array out (never throws) */
function avSessionUiTagsNorm(v) {
  const out = [];
  try {
    if (!Array.isArray(v)) return out;
    for (let i = 0; i < v.length && out.length < AV_SESSION_UI_TAG_MAX; i++) {
      let t = "";
      try {
        t = String(v[i] == null ? "" : v[i]).replace(/[\u0000-\u001f\u007f]/g, "");
        t = t.replace(/\s+/g, " ").trim().toLowerCase().slice(0, AV_SESSION_UI_TAG_LEN);
      } catch (e) { t = ""; }
      if (!t) continue;
      let dup = false;
      for (let j = 0; j < out.length; j++) if (out[j] === t) { dup = true; break; }
      if (!dup) out.push(t);
    }
  } catch (e) { return []; }
  return out;
}

/* editor input -> tags: comma or semicolon separated, then the same normalizer */
function avSessionUiTagsParse(v) {
  try {
    if (Array.isArray(v)) return avSessionUiTagsNorm(v);
    return avSessionUiTagsNorm(String(v == null ? "" : v).split(/[,;]/));
  } catch (e) { return []; }
}

/* the import manager's name comparator, mirrored (lowercase compare, id tiebreak) */
function avSessionUiByName(a, b) {
  const an = String((a && a.name) || "").toLowerCase(), bn = String((b && b.name) || "").toLowerCase();
  if (an < bn) return -1;
  if (an > bn) return 1;
  const ai = String((a && a.id) || ""), bi = String((b && b.id) || "");
  return ai < bi ? -1 : (ai > bi ? 1 : 0);
}

/* the visible rows: search (name + tags, case-insensitive substring) + sort over the module's
   list; "newest" = the module's own order (the current order; never re-sorted). A filter or
   sort failure falls back to the module order. Never throws. */
function avSessionUiViewRows(list) {
  const s = avSessionUiState;
  const out = [];
  try {
    const src = Array.isArray(list) ? list : [];
    const q = String(s.search || "").toLowerCase();
    for (let i = 0; i < src.length; i++) {
      const r = src[i];
      if (!r || typeof r !== "object") continue;
      if (q) {
        let hit = String(r.name || "").toLowerCase().indexOf(q) >= 0;
        if (!hit) {
          const tags = Array.isArray(r.tags) ? r.tags : [];
          for (let j = 0; j < tags.length; j++) {
            if (String(tags[j] || "").toLowerCase().indexOf(q) >= 0) { hit = true; break; }
          }
        }
        if (!hit) continue;
      }
      out.push(r);
    }
  } catch (e) { return []; }
  try {
    if (s.sort === "name") out.sort(avSessionUiByName);
    else if (s.sort === "updated") out.sort(function (a, b) {
      const d = avSessionUiNum(b.updatedAt, 0) - avSessionUiNum(a.updatedAt, 0);
      return d !== 0 ? d : avSessionUiByName(a, b);
    });
  } catch (e) { /* the module order stands */ }
  return out;
}

/* ---------- guarded DOM access (no throw, no noise) ---------- */

function avSessionUiHost() {
  try {
    if (typeof document !== "undefined" && document && typeof document.getElementById === "function") {
      return document.getElementById("av-sessions-host");
    }
  } catch (e) { /* no document */ }
  return null;
}

function avSessionUiEl(sel) {
  try {
    const host = avSessionUiHost();
    if (host && typeof host.querySelector === "function") return host.querySelector(sel);
  } catch (e) { /* no DOM */ }
  return null;
}

function avSessionUiSetValue(el, v) {
  try {
    if (!el) return false;
    const str = String(v == null ? "" : v);
    let focused = false;
    try { if (typeof document !== "undefined" && document && document.activeElement === el) focused = true; } catch (e) { focused = false; }
    if (focused) return false;   /* never clobber the control being edited */
    if (String(el.value) !== str) el.value = str;
    return true;
  } catch (e) { return false; }
}

function avSessionUiSetText(host, sel, txt) {
  try { const el = host.querySelector(sel); if (el && el.textContent !== txt) el.textContent = txt; } catch (e) { /* no DOM */ }
}

/* ---------- warnings (stateful wrappers over the pure list helpers) ---------- */

function avSessionUiWarn(key, text) {
  try {
    avSessionUiState.warnings = avSessionUiWarnMerge(avSessionUiState.warnings, String(key || "general"), avSessionUiClean(text, 170), AV_SESSION_UI_WARN_MAX);
  } catch (e) { /* never throws */ }
}

function avSessionUiWarnDropKey(key) {
  try { avSessionUiState.warnings = avSessionUiWarnDrop(avSessionUiState.warnings, String(key || "")); } catch (e) { /* ok */ }
}

/* degraded-module notes: set when missing, dropped when present (honest every init) */
function avSessionUiModulesNote() {
  const sessionCore = (typeof avSessionState === "function") || (typeof avSessionList === "function") || (typeof avSessionSave === "function");
  if (sessionCore) avSessionUiWarnDropKey("modules.session");
  else avSessionUiWarn("modules.session", "the session module (av_session.js) is not loaded \u2014 saving, loading and versions are unavailable");
  if (sessionCore && typeof avSessionVersions !== "function") {
    avSessionUiWarn("missing.versions", "this build does not expose avSessionVersions() \u2014 version history is unavailable");
  } else avSessionUiWarnDropKey("missing.versions");
  if (typeof avBackupBuild === "function" && typeof avBackupRestore === "function") avSessionUiWarnDropKey("modules.backup");
  else avSessionUiWarn("modules.backup", "the backup module (av_backup.js) is not loaded \u2014 backup and restore are unavailable");
}

/* honest note when a single pinned function is absent while the module is present */
function avSessionUiMissingNote(fn, what) {
  avSessionUiWarn("missing." + String(fn || "fn"), "this build does not expose " + String(fn || "a needed function") + "() \u2014 " + String(what || "that action is unavailable"));
}

/* storage honesty (mirrors the module's own backend reporting) */
function avSessionUiStorageNote() {
  if (avSessionUiState.backend === "mem") {
    avSessionUiWarn("storage.mem", "browser storage is not durable right now (memory backend) \u2014 sessions vanish on reload");
  } else {
    avSessionUiWarnDropKey("storage.mem");
  }
}

/* ---------- mirror reads (pinned APIs, typeof-guarded, explicit reads only) ---------- */

function avSessionUiStateSync() {
  if (typeof avSessionState !== "function") return false;
  let st = null;
  try { st = avSessionState(); } catch (e) { st = null; }
  if (!st || typeof st !== "object") return false;
  const s = avSessionUiState;
  try {
    const cnt = avSessionUiNumField(st, ["count"]);
    if (cnt != null) s.count = Math.max(0, Math.round(cnt));
    const be = avSessionUiStrField(st, ["backend"]);
    if (be) s.backend = be;
    const dirty = avSessionUiFlagFrom(st, ["dirty"]);
    if (dirty !== null) s.dirty = dirty;
    if (Object.prototype.hasOwnProperty.call(st, "current")) {
      const cur = st.current;
      if (!cur || typeof cur !== "object") { s.curId = ""; s.curName = ""; }
      else {
        s.curId = avSessionUiStrField(cur, ["id"]);
        s.curName = avSessionUiStrField(cur, ["name"]);
      }
    }
    const la = avSessionUiNumField(st, ["lastAutosaveAt"]);
    s.lastAsAt = (la != null && la > 0) ? la : 0;
    const as = st.autosave;
    if (as && typeof as === "object") {
      const on = avSessionUiFlagFrom(as, ["on"]);
      if (on !== null) s.autosaveOn = on;
      const ms = avSessionUiNumField(as, ["ms"]);
      if (ms != null && ms > 0) s.autosaveMs = Math.max(5000, Math.min(600000, ms));
    }
    const rc = st.recovery;
    if (rc && typeof rc === "object") {
      const av = avSessionUiFlagFrom(rc, ["available"]);
      if (av !== null) s.recAvail = av;
      const when = (rc.savedAt != null) ? rc.savedAt : rc.at;
      s.recAt = avSessionUiWhen(when);
      s.recName = avSessionUiStrField(rc, ["name"]);
      if (av === false) { s.recAt = ""; s.recName = ""; }
    }
    return true;
  } catch (e) { return false; }
}

function avSessionUiListRead() {
  try {
    if (typeof avSessionList !== "function") return [];
    const l = avSessionList();
    return Array.isArray(l) ? l : [];
  } catch (e) { return []; }
}

/* ---------- markup (pure string builders) ---------- */

function avSessionUiAsOptionsHTML(extraSecs) {
  let out = "";
  const list = AV_SESSION_UI_AS_OPTS.slice();
  if (extraSecs != null && list.indexOf(extraSecs) < 0) { list.push(extraSecs); list.sort(function (a, b) { return a - b; }); }
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    out += '<option value="' + n + '"' + (n === AV_SESSION_UI_AS_DEF ? " selected" : "") + ">" + n + " s</option>";
  }
  return out;
}

function avSessionUiVerRowHTML(id, ver, busy) {
  const idEsc = avSessionUiEsc(id);
  const v = Math.max(1, Math.round(avSessionUiNum(ver && ver.n, 1)));
  return '<div class="av-sessions-ver" data-id="' + idEsc + '" data-ver="' + v + '">' +
    '<span class="av-sessions-ver-n">v' + v + "</span>" +
    '<span class="av-sessions-ver-at">' + avSessionUiEsc((ver && ver.atText) || "\u2014") + "</span>" +
    '<span class="av-sessions-ver-bytes">' + avSessionUiEsc((ver && ver.bytesText) || "") + "</span>" +
    '<button type="button" class="av-btn mini av-sessions-btn av-sessions-ver-restore" data-act="restore" data-id="' + idEsc + '" data-ver="' + v + '"' + (busy ? " disabled" : "") +
    ' title="Restore this version \u2014 it replaces the working state">' + (busy ? "\u2026" : "RESTORE") + "</button>" +
    "</div>";
}

/* the R20 tags line: the stored tags + the inline editor (Enter/blur commits, Esc cancels) */
function avSessionUiTagsRowHTML(view, s) {
  const idEsc = avSessionUiEsc(view.id);
  const editing = !!(s && s.tagEditId === view.id);
  let html = '<div class="av-sessions-tags" data-id="' + idEsc + '">';
  if (editing) {
    html += '<input type="text" class="av-sessions-tags-input" data-id="' + idEsc + '" value="' + avSessionUiEsc((s && s.tagDraft) || "") + '" spellcheck="false" autocomplete="off" maxlength="220" placeholder="tag, tag \u2014 Enter saves, Esc cancels" aria-label="Session tags, comma separated">';
  } else {
    const tags = Array.isArray(view.tags) ? view.tags : [];
    let inner = "";
    for (let i = 0; i < tags.length; i++) {
      inner += (i ? '<span class="av-sessions-tags-sep"> \u00b7 </span>' : "") + '<span class="av-sessions-tag">' + avSessionUiEsc(tags[i]) + "</span>";
    }
    html += '<span class="av-sessions-tags-list' + (tags.length ? "" : " av-sessions-tags-none") + '">' + (inner || "--") + "</span>";
    html += '<button type="button" class="av-btn mini av-sessions-btn av-sessions-tags-btn" data-act="tags" data-id="' + idEsc + '" title="Edit tags (comma separated, up to 8, 24 chars each)">TAGS</button>';
  }
  html += "</div>";
  return html;
}

/* the R20 preview line: engine kind / pattern bars / take count / saved + updated stamps;
   honest "--" when a field is absent */
function avSessionUiPrevRowHTML(view) {
  const idEsc = avSessionUiEsc(view.id);
  const eng = (typeof view.engine === "string" && view.engine) ? avSessionUiClean(view.engine, 24) : "--";
  const barsN = (typeof view.bars === "number" && isFinite(view.bars)) ? view.bars : null;
  const bars = (barsN != null) ? (Math.round(barsN) + (Math.round(barsN) === 1 ? " bar" : " bars")) : "--";
  const takesN = (typeof view.takes === "number" && isFinite(view.takes)) ? view.takes : null;
  const takes = (takesN != null) ? (Math.round(takesN) + (Math.round(takesN) === 1 ? " take" : " takes")) : "--";
  const saved = view.atText ? ("saved " + view.atText) : "saved --";
  const upd = view.updText ? ("updated " + view.updText) : "updated --";
  const parts = [["eng", eng], ["bars", bars], ["takes", takes], ["saved", saved], ["upd", upd]];
  let html = '<div class="av-sessions-prev" data-id="' + idEsc + '">';
  for (let i = 0; i < parts.length; i++) {
    html += '<span class="av-sessions-prev-part av-sessions-prev-' + parts[i][0] + '">' + avSessionUiEsc(parts[i][1]) + "</span>";
  }
  html += "</div>";
  return html;
}

function avSessionUiSessionRowHTML(view, opBusy) {
  const idEsc = avSessionUiEsc(view.id);
  const loadBusy = !!(opBusy && opBusy.kind === "load" && opBusy.id === view.id);
  const delBusy = !!(opBusy && opBusy.kind === "del" && opBusy.id === view.id);
  let html = '<div class="av-sessions-session' + (view.cur ? " av-sessions-cur" : "") + '" data-id="' + idEsc + '">' +
    '<span class="av-sessions-session-name" title="' + idEsc + '">' + avSessionUiEsc(view.name) + "</span>" +
    '<span class="av-sessions-session-at">' + avSessionUiEsc(view.atText || "\u2014") + "</span>" +
    '<span class="av-sessions-session-v">v' + view.v + "</span>" +
    (view.cur ? '<span class="av-sessions-session-cur">CURRENT</span>' : "") +
    '<button type="button" class="av-btn mini av-sessions-btn av-sessions-session-load" data-act="load" data-id="' + idEsc + '"' + (loadBusy ? " disabled" : "") +
    ' title="Load this session\u2019s newest version \u2014 it replaces the working state">' + (loadBusy ? "\u2026" : "LOAD") + "</button>" +
    '<button type="button" class="av-btn mini av-sessions-btn av-sessions-session-del" data-act="del" data-id="' + idEsc + '"' + (delBusy ? " disabled" : "") +
    ' title="Delete this session (every version)">\u2715</button>' +
    "</div>" +
    avSessionUiTagsRowHTML(view, avSessionUiState) +
    avSessionUiPrevRowHTML(view);
  if (view.vers && view.vers.length) {
    html += '<div class="av-sessions-vers" data-id="' + idEsc + '">';
    for (let i = 0; i < view.vers.length; i++) {
      const vrow = view.vers[i];
      const rBusy = !!(opBusy && opBusy.kind === "restore" && opBusy.id === view.id && opBusy.ver === vrow.n);
      html += avSessionUiVerRowHTML(view.id, vrow, rBusy);
    }
    html += "</div>";
  }
  return html;
}

function avSessionUiBodyHTML() {
  return '<div class="av-sessions" data-av-sessions="1">' +
    '<div class="av-sessions-head"><span class="av-sessions-title">SESSIONS</span>' +
    '<span class="av-sessions-cap">save the whole working state (pattern \u00b7 chains \u00b7 song \u00b7 scenes \u00b7 params \u00b7 macros) as named sessions with version history; autosave keeps a recovery snapshot; BACKUP packs sessions, installed packs and samples into one zip. Nothing is uploaded.</span></div>' +
    '<div class="av-sessions-status-line"><span class="av-sessions-status av-sessions-msg" id="av-sessions-status" role="status">\u2026</span></div>' +

    '<div class="av-sessions-recovery" id="av-sessions-recovery" hidden>' +
    '<span class="av-sessions-recovery-lbl">RECOVERY</span>' +
    '<span class="av-sessions-recovery-at" id="av-sessions-recovery-at"></span>' +
    '<button type="button" class="av-btn mini av-sessions-btn av-sessions-recover" id="av-sessions-recover" title="Apply the autosaved snapshot to the working state">RECOVER</button>' +
    '<button type="button" class="av-btn mini av-sessions-btn av-sessions-dismiss" id="av-sessions-dismiss" title="Dismiss the recovery offer">DISMISS</button>' +
    "</div>" +

    '<section class="av-sessions-sect" data-sect="sessions">' +
    '<div class="av-sessions-sect-head"><span class="av-sessions-sect-lbl">SESSIONS</span>' +
    '<span class="av-sessions-count" id="av-sessions-count">0 sessions</span>' +
    '<span class="av-sessions-storage" id="av-sessions-storage">storage \u2014</span></div>' +
    '<div class="av-sessions-row">' +
    '<input type="text" class="av-sessions-name" id="av-sessions-name" spellcheck="false" autocomplete="off" maxlength="64" placeholder="session name" aria-label="Session name">' +
    '<button type="button" class="av-btn mini av-sessions-btn av-sessions-save" id="av-sessions-save" title="Save the current working state (new session, or a new version of the current one)">SAVE</button>' +
    "</div>" +
    '<div class="av-sessions-tools">' +
    '<input type="search" class="av-sessions-search" id="av-sessions-search" spellcheck="false" autocomplete="off" maxlength="64" placeholder="search name or tags\u2026" aria-label="Search sessions by name or tag">' +
    '<select class="av-select av-sessions-sort" id="av-sessions-sort" aria-label="Sort the sessions list">' +
    '<option value="newest" selected>newest</option><option value="name">name</option><option value="updated">updated</option>' +
    "</select>" +
    "</div>" +
    '<div class="av-sessions-list" id="av-sessions-list"></div>' +
    '<p class="av-sessions-none av-note av-dim" id="av-sessions-none">No sessions yet \u2014 press SAVE to keep the current working state.</p>' +
    "</section>" +

    '<section class="av-sessions-sect" data-sect="autosave">' +
    '<div class="av-sessions-sect-head"><span class="av-sessions-sect-lbl">AUTOSAVE</span>' +
    '<span class="av-sessions-autosave-val" id="av-sessions-autosave-val">off</span></div>' +
    '<div class="av-sessions-row">' +
    '<button type="button" class="av-btn mini av-sessions-btn av-sessions-autosave" id="av-sessions-autosave" aria-pressed="false" title="Autosave \u2014 while on, a recovery snapshot is written whenever the working state changes">AUTOSAVE</button>' +
    '<label class="av-sessions-lab" for="av-sessions-autosave-ms">EVERY</label>' +
    '<select class="av-select av-sessions-autosave-ms" id="av-sessions-autosave-ms" aria-label="Autosave interval">' + avSessionUiAsOptionsHTML(null) + "</select>" +
    "</div>" +
    "</section>" +

    '<section class="av-sessions-sect" data-sect="backup">' +
    '<div class="av-sessions-sect-head"><span class="av-sessions-sect-lbl">BACKUP</span>' +
    '<span class="av-sessions-backup-val" id="av-sessions-backup-val"></span></div>' +
    '<div class="av-sessions-row">' +
    '<button type="button" class="av-btn mini av-sessions-btn av-sessions-backup" id="av-sessions-backup" title="Build a zip with every session, installed pack and sample slot, then download it">BACKUP NOW</button>' +
    '<button type="button" class="av-btn mini av-sessions-btn av-sessions-restore" id="av-sessions-restore" title="Restore sessions, packs and samples from a backup zip">RESTORE (FILE)</button>' +
    '<input type="file" class="av-sessions-file" id="av-sessions-restore-file" accept=".zip,application/zip" hidden aria-label="Backup zip to restore">' +
    "</div>" +
    '<p class="av-note av-dim av-sessions-progress" id="av-sessions-progress" hidden></p>' +
    '<p class="av-note av-sessions-report" id="av-sessions-report" hidden></p>' +
    "</section>" +

    '<div class="av-sessions-warnings" id="av-sessions-warnings" hidden><div class="av-sessions-warn-head">WARNINGS</div></div>' +
    '<p class="av-note av-dim av-sessions-foot" id="av-sessions-foot">Sessions keep the working state (pattern \u00b7 chains \u00b7 song \u00b7 scenes \u00b7 params \u00b7 macros) \u2014 not audio; takes and samples ride the backup zip. Nothing is uploaded.</p>' +
    "</div>";
}

/* ---------- async settle (receipts may be promises or sync values; never throws) ---------- */

function avSessionUiSettle(p, cb) {
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

/* one module op at a time (keeps the pin honest; controls disabled meanwhile) */
function avSessionUiBusy() {
  const s = avSessionUiState;
  return !!(s.saveBusy || s.opBusy || s.backupBusy || s.restoreFileBusy || s.recovering);
}

/* ---------- SESSIONS actions ---------- */

function avSessionUiSave(nameArg) {
  const s = avSessionUiState;
  try {
    if (avSessionUiBusy()) return false;
    if (typeof avSessionSave !== "function") {
      avSessionUiMissingNote("avSessionSave", "saving is unavailable");
      s.lastMsg = "the session module is not loaded \u2014 nothing can be saved";
      s.lastMsgKind = "err";
      avSessionUiSync();
      return false;
    }
    let name = "";
    if (typeof nameArg === "string" && nameArg.trim()) name = avSessionUiClean(nameArg, AV_SESSION_UI_NAME_MAX);
    else {
      const el = avSessionUiEl("#av-sessions-name");
      if (el && typeof el.value === "string") name = avSessionUiClean(el.value, AV_SESSION_UI_NAME_MAX);
    }
    s.saveBusy = true;
    s.lastMsg = "saving\u2026";
    s.lastMsgKind = "msg";
    avSessionUiSync();
    let p = null;
    try { p = name ? avSessionSave(name) : avSessionSave(); } catch (e) { p = { ok: false, error: String((e && e.message) || e || "save failed") }; }
    avSessionUiSettle(p, avSessionUiSaveSettle);
    return true;
  } catch (e) { return false; }
}

function avSessionUiSaveSettle(r) {
  const s = avSessionUiState;
  s.saveBusy = false;
  if (avSessionUiOK(r) === false) {
    const why = (r && typeof r === "object" && r.error) ? avSessionUiErrText(r.error) : "refused";
    s.lastMsg = "save refused \u2014 " + why;
    s.lastMsgKind = "err";
    avSessionUiWarn("save.fail", "the save was refused \u2014 " + why);
  } else {
    const rname = (r && typeof r === "object") ? avSessionUiStrField(r, ["name"]) : "";
    const rver = (r && typeof r === "object") ? avSessionUiNumField(r, ["version", "v"]) : null;
    s.lastMsg = "saved" + (rname ? " \u201c" + avSessionUiClean(rname, 48) + "\u201d" : "") + (rver != null ? " v" + Math.round(rver) : "") + " \u2014 the working state is kept";
    s.lastMsgKind = "msg";
    avSessionUiWarnDropKey("save.fail");
    s.nameId = null;   /* refill the name field from the new current on the next paint */
  }
  avSessionUiSync();
}

function avSessionUiLoad(id) {
  const s = avSessionUiState;
  try {
    if (typeof id !== "string" || !id) return false;
    if (avSessionUiBusy()) return false;
    if (typeof avSessionLoad !== "function") {
      avSessionUiMissingNote("avSessionLoad", "loading is unavailable");
      s.lastMsg = "this build cannot load sessions (avSessionLoad is missing)";
      s.lastMsgKind = "err";
      avSessionUiSync();
      return false;
    }
    s.opBusy = { kind: "load", id: id, ver: 0 };
    s.lastMsg = "loading\u2026";
    s.lastMsgKind = "msg";
    avSessionUiSync();
    let p = null;
    try { p = avSessionLoad(id); } catch (e) { p = { ok: false, error: String((e && e.message) || e || "load failed") }; }
    avSessionUiSettle(p, avSessionUiLoadSettle);
    return true;
  } catch (e) { return false; }
}

function avSessionUiLoadSettle(r) {
  const s = avSessionUiState;
  s.opBusy = null;
  if (avSessionUiOK(r) === false) {
    const why = (r && typeof r === "object" && r.error) ? avSessionUiErrText(r.error) : "refused";
    s.lastMsg = "loading refused \u2014 " + why;
    s.lastMsgKind = "err";
    avSessionUiWarn("load.fail", "the session was not loaded \u2014 " + why);
  } else {
    const rname = (r && typeof r === "object") ? avSessionUiStrField(r, ["name"]) : "";
    const bits = avSessionUiCountBits(r);
    s.lastMsg = "loaded" + (rname ? " \u201c" + avSessionUiClean(rname, 48) + "\u201d" : "") + " \u2014 the working state was replaced" + (bits.length ? " (" + bits.join(" \u00b7 ") + ")" : "");
    s.lastMsgKind = "msg";
    avSessionUiWarnDropKey("load.fail");
    s.nameId = null;   /* the current session may have changed */
  }
  avSessionUiSync();
}

function avSessionUiDelete(id) {
  const s = avSessionUiState;
  try {
    if (typeof id !== "string" || !id) return false;
    if (avSessionUiBusy()) return false;
    if (typeof avSessionDelete !== "function") {
      avSessionUiMissingNote("avSessionDelete", "deleting is unavailable");
      s.lastMsg = "this build cannot delete sessions (avSessionDelete is missing)";
      s.lastMsgKind = "err";
      avSessionUiSync();
      return false;
    }
    let ok = true;
    try { if (avSessionDelete(id) === false) ok = false; } catch (e) { ok = false; }
    if (ok) {
      s.lastMsg = "session deleted";
      s.lastMsgKind = "msg";
      avSessionUiWarnDropKey("del.fail");
    } else {
      s.lastMsg = "the session could not be deleted (it may no longer exist)";
      s.lastMsgKind = "err";
      avSessionUiWarn("del.fail", "the session could not be deleted \u2014 it may no longer exist");
    }
    avSessionUiSync();
    return ok;
  } catch (e) { return false; }
}

function avSessionUiRestore(id, ver) {
  const s = avSessionUiState;
  try {
    if (typeof id !== "string" || !id) return false;
    const v = avSessionUiInt(ver, 1, 9999, null);
    if (v == null) return false;
    if (avSessionUiBusy()) return false;
    if (typeof avSessionRestore !== "function") {
      avSessionUiMissingNote("avSessionRestore", "version restore is unavailable");
      s.lastMsg = "this build cannot restore versions (avSessionRestore is missing)";
      s.lastMsgKind = "err";
      avSessionUiSync();
      return false;
    }
    s.opBusy = { kind: "restore", id: id, ver: v };
    s.lastMsg = "restoring v" + v + "\u2026";
    s.lastMsgKind = "msg";
    avSessionUiSync();
    let p = null;
    try { p = avSessionRestore(id, v); } catch (e) { p = { ok: false, error: String((e && e.message) || e || "restore failed") }; }
    avSessionUiSettle(p, avSessionUiRestoreSettle);
    return true;
  } catch (e) { return false; }
}

function avSessionUiRestoreSettle(r) {
  const s = avSessionUiState;
  const op = s.opBusy || {};
  s.opBusy = null;
  if (avSessionUiOK(r) === false) {
    const why = (r && typeof r === "object" && r.error) ? avSessionUiErrText(r.error) : "refused";
    s.lastMsg = "the version was not restored \u2014 " + why;
    s.lastMsgKind = "err";
    avSessionUiWarn("restoreV.fail", "the version restore was refused \u2014 " + why);
  } else {
    const rname = (r && typeof r === "object") ? avSessionUiStrField(r, ["name"]) : "";
    s.lastMsg = "restored v" + (op.ver || "?") + (rname ? " of \u201c" + avSessionUiClean(rname, 48) + "\u201d" : "") + " \u2014 the working state was replaced";
    s.lastMsgKind = "msg";
    avSessionUiWarnDropKey("restoreV.fail");
    s.nameId = null;
  }
  avSessionUiSync();
}

/* ---------- AUTOSAVE actions ---------- */

function avSessionUiAutosaveSet(on, ms) {
  const s = avSessionUiState;
  try {
    if (avSessionUiBusy()) return false;
    if (typeof avSessionAutosave !== "function") {
      avSessionUiMissingNote("avSessionAutosave", "autosave is unavailable");
      s.lastMsg = "the session module is not loaded \u2014 autosave is unavailable";
      s.lastMsgKind = "err";
      avSessionUiSync();
      return false;
    }
    /* on === null: an interval-only change -- it must NOT become an explicit on/off choice
       (the module records a choice only when `on` is passed; R20) */
    const touchOn = !(on === null || on === undefined);
    const wantOn = touchOn ? !!on : s.autosaveOn;
    const wantMs = avSessionUiInt(ms, 5000, 600000, s.autosaveMs);
    let refused = false;
    let r = null;
    try { r = touchOn ? avSessionAutosave(wantOn, wantMs) : avSessionAutosave(undefined, wantMs); } catch (e) { refused = true; r = null; }
    if (!refused && r && typeof r === "object") {
      const onF = avSessionUiFlagFrom(r, ["on"]);
      s.autosaveOn = (onF !== null) ? onF : wantOn;
      const msF = avSessionUiNumField(r, ["ms"]);
      if (msF != null && msF > 0) s.autosaveMs = Math.max(5000, Math.min(600000, msF));
      else s.autosaveMs = wantMs;
    } else if (!refused) {
      s.autosaveOn = wantOn;
      s.autosaveMs = wantMs;
    }
    if (refused) {
      s.lastMsg = "autosave refused the change";
      s.lastMsgKind = "err";
      avSessionUiWarn("autosave.fail", "autosave refused the change");
    } else {
      const secs = Math.round(s.autosaveMs / 1000);
      s.lastMsg = s.autosaveOn
        ? "autosave on \u2014 snapshots every " + secs + " s while the state changes"
        : "autosave off \u2014 no snapshot is written";
      s.lastMsgKind = "msg";
      avSessionUiWarnDropKey("autosave.fail");
    }
    avSessionUiSync();
    return !refused;
  } catch (e) { return false; }
}

function avSessionUiAutosaveToggle() {
  const s = avSessionUiState;
  try { return avSessionUiAutosaveSet(!s.autosaveOn, s.autosaveMs); } catch (e) { return false; }
}

function avSessionUiAutosaveMsChange(el) {
  const s = avSessionUiState;
  try {
    const secs = avSessionUiInt(el ? el.value : null, AV_SESSION_UI_AS_OPTS[0], AV_SESSION_UI_AS_OPTS[AV_SESSION_UI_AS_OPTS.length - 1], null);
    if (secs == null) return false;
    const ok = avSessionUiAutosaveSet(null, secs * 1000);   /* interval only -- not a choice */
    if (ok) {
      s.lastMsg = "autosave interval set \u2014 every " + secs + " s" + (s.autosaveOn ? "" : " (autosave is off)");
      s.lastMsgKind = "msg";
      avSessionUiSync();
    }
    return ok;
  } catch (e) { return false; }
}

/* ---------- BACKUP actions ---------- */

/* the anchor-blob download technique from av_deliver_ui (no FSA picker; never throws) */
function avSessionUiAnchor(buf, name) {
  try {
    if (!buf) return false;
    if (typeof document === "undefined" || !document || typeof document.createElement !== "function") return false;
    if (typeof Blob === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
    let blob = null;
    if (typeof Blob === "function" && buf instanceof Blob) blob = buf;
    else { try { blob = new Blob([buf], { type: "application/zip" }); } catch (e) { blob = null; } }
    if (!blob) return false;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "anvil_backup.zip";
    try { a.rel = "noopener"; } catch (e) { /* attribute refused */ }
    const body = document.body;
    let attached = false;
    if (body && typeof body.appendChild === "function") { try { body.appendChild(a); attached = true; } catch (e) { attached = false; } }
    try { a.click(); } catch (e) { /* a click never throws outward here */ }
    if (attached && body && typeof body.removeChild === "function") { try { body.removeChild(a); } catch (e) { /* ok */ } }
    try { if (typeof setTimeout === "function") setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { /* ok */ } }, 8000); } catch (e) { /* ok */ }
    return true;
  } catch (e) { return false; }
}

function avSessionUiBackup() {
  const s = avSessionUiState;
  try {
    if (avSessionUiBusy()) return false;
    if (typeof avBackupBuild !== "function") {
      avSessionUiMissingNote("avBackupBuild", "backup is unavailable");
      s.lastMsg = "the backup module is not loaded \u2014 nothing can be packed";
      s.lastMsgKind = "err";
      avSessionUiSync();
      return false;
    }
    s.backupBusy = true;
    s.lastMsg = "building the backup zip\u2026";
    s.lastMsgKind = "msg";
    avSessionUiSync();
    let p = null;
    try { p = avBackupBuild(); } catch (e) { p = { ok: false, error: String((e && e.message) || e || "backup failed") }; }
    avSessionUiSettle(p, avSessionUiBackupSettle);
    return true;
  } catch (e) { return false; }
}

function avSessionUiBackupSettle(r) {
  const s = avSessionUiState;
  s.backupBusy = false;
  if (avSessionUiOK(r) === false) {
    const why = (r && typeof r === "object" && r.error) ? avSessionUiErrText(r.error) : "refused";
    s.lastMsg = "the backup was refused \u2014 " + why;
    s.lastMsgKind = "err";
    avSessionUiWarn("backup.fail", "the backup was refused \u2014 " + why);
  } else {
    const name = (r && typeof r === "object" && typeof r.name === "string" && r.name) ? avSessionUiClean(r.name, 80) : "anvil_backup.zip";
    const bytes = (r && typeof r === "object") ? avSessionUiNumField(r, ["bytes"]) : null;
    const buf = (r && typeof r === "object" && r.buffer) ? r.buffer : null;
    const downloaded = avSessionUiAnchor(buf, name);
    s.lastBackup = { name: name, bytes: (bytes == null ? null : Math.round(bytes)), at: Date.now() };
    s.lastMsg = "backup built" + (bytes != null ? " \u2014 " + avSessionUiFmtBytes(bytes) : "") +
      (downloaded ? " \u2014 check your downloads" : " \u2014 no download handle could be opened");
    s.lastMsgKind = "msg";
    avSessionUiWarnDropKey("backup.fail");
    try {
      if (typeof window !== "undefined" && window) {
        window.__avSessionUiLastExport = { kind: "backup", name: name, bytes: s.lastBackup.bytes, downloaded: downloaded === true, at: Date.now() };
      }
    } catch (e) { /* stamp is a nicety */ }
  }
  avSessionUiSync();
}

/* ---------- RESTORE (FILE) actions ---------- */

function avSessionUiRestoreFilePick() {
  const s = avSessionUiState;
  try {
    const el = avSessionUiEl("#av-sessions-restore-file");
    if (!el || typeof el.click !== "function") {
      s.lastMsg = "the file picker is unavailable in this browser";
      s.lastMsgKind = "err";
      avSessionUiSync();
      return false;
    }
    s.lastMsg = "choose a backup zip\u2026";
    s.lastMsgKind = "msg";
    avSessionUiSync();
    el.click();
    return true;
  } catch (e) { return false; }
}

/* read a File into an ArrayBuffer (file.arrayBuffer() first, FileReader fallback; never throws) */
function avSessionUiFileRead(file, cb) {
  const done = { v: false };
  const once = function (b) {
    if (done.v) return;
    done.v = true;
    try { cb(b); } catch (e) { /* the settle callback never throws */ }
  };
  try {
    if (file && typeof file.arrayBuffer === "function") {
      try {
        Promise.resolve(file.arrayBuffer()).then(function (b) { once(b); }).catch(function () { once(null); });
        return true;
      } catch (e) { /* fall through */ }
    }
    if (typeof FileReader === "function") {
      try {
        const fr = new FileReader();
        fr.onload = function () { once(fr.result); };
        fr.onerror = function () { once(null); };
        fr.readAsArrayBuffer(file);
        return true;
      } catch (e) { /* fall through */ }
    }
  } catch (e) { /* fall through */ }
  once(null);
  return false;
}

function avSessionUiResetFile(el) {
  try { if (el && typeof el.value === "string") el.value = ""; } catch (e) { /* ok */ }
}

function avSessionUiFileChange(t) {
  const s = avSessionUiState;
  try {
    if (!t) return false;
    let file = null;
    try { if (t.files && t.files.length) file = t.files[0]; } catch (e) { file = null; }
    if (!file) return false;
    const fname = avSessionUiClean(file.name || "backup.zip", 80);
    if (avSessionUiBusy()) { avSessionUiResetFile(t); return false; }
    if (typeof avBackupRestore !== "function") {
      avSessionUiMissingNote("avBackupRestore", "restore is unavailable");
      s.lastMsg = "the backup module is not loaded \u2014 restore is unavailable";
      s.lastMsgKind = "err";
      avSessionUiResetFile(t);
      avSessionUiSync();
      return false;
    }
    s.restoreFileBusy = true;
    s.progress = "reading " + fname + "\u2026";
    s.report = "";
    s.lastMsg = "restoring " + fname + "\u2026";
    s.lastMsgKind = "msg";
    avSessionUiSync();
    avSessionUiFileRead(file, function (buf) {
      if (!buf) {
        s.restoreFileBusy = false;
        s.progress = "";
        s.lastMsg = "the backup file could not be read";
        s.lastMsgKind = "err";
        avSessionUiWarn("restore.fail", "the backup file could not be read");
        avSessionUiSync();
        avSessionUiResetFile(t);
        return;
      }
      s.progress = "restoring " + fname + "\u2026";
      s.lastMsg = s.progress;
      avSessionUiSync();
      let p = null;
      try { p = avBackupRestore(buf); } catch (e) { p = { ok: false, error: String((e && e.message) || e || "restore failed") }; }
      avSessionUiSettle(p, function (r) {
        avSessionUiFileSettle(fname, buf, r);
        avSessionUiResetFile(t);
      });
    });
    return true;
  } catch (e) { return false; }
}

function avSessionUiFileSettle(fname, buf, r) {
  const s = avSessionUiState;
  s.restoreFileBusy = false;
  s.progress = "";
  if (avSessionUiOK(r) === false) {
    const why = (r && typeof r === "object" && r.error) ? avSessionUiErrText(r.error) : "refused";
    s.lastMsg = "restore refused \u2014 " + why;
    s.lastMsgKind = "err";
    s.report = "restore of " + fname + " failed \u2014 " + why;
    s.reportKind = "err";
    avSessionUiWarn("restore.fail", "restore from " + fname + " failed \u2014 " + why);
  } else {
    const rst = (r && typeof r === "object" && r.restored && typeof r.restored === "object") ? r.restored : {};
    const parts = [];
    const sn = avSessionUiNumField(rst, ["sessions"]);
    const pn = avSessionUiNumField(rst, ["packs"]);
    const smn = avSessionUiNumField(rst, ["samples"]);
    parts.push("sessions " + (sn != null ? Math.round(sn) : "\u2014"));
    parts.push("packs " + (pn != null ? Math.round(pn) : "\u2014"));
    parts.push("samples " + (smn != null ? Math.round(smn) : "\u2014"));
    let skipped = null;
    if (r && typeof r === "object") {
      if (Array.isArray(r.skipped)) skipped = r.skipped.length;
      else skipped = avSessionUiNumField(r, ["skipped"]);
    }
    let line = "restored \u2014 " + parts.join(" \u00b7 ");
    if (skipped != null && skipped > 0) line += " \u00b7 skipped " + Math.round(skipped);
    const errs = [];
    if (r && typeof r === "object" && Array.isArray(r.errors)) {
      for (let i = 0; i < r.errors.length && errs.length < 4; i++) {
        let e = "";
        try { e = avSessionUiClean(String((r.errors[i] && r.errors[i].message) ? r.errors[i].message : r.errors[i]), 70); } catch (x) { e = ""; }
        if (e) errs.push(e);
      }
      if (r.errors.length > 4) errs.push("\u2026 +" + (r.errors.length - 4) + " more");
    }
    if (errs.length) line += " \u00b7 errors: " + errs.join("; ");
    s.report = line;
    s.reportKind = errs.length ? "err" : "msg";
    s.lastMsg = "restore done \u2014 sessions " + (sn != null ? Math.round(sn) : "\u2014") + " \u00b7 packs " + (pn != null ? Math.round(pn) : "\u2014") + " \u00b7 samples " + (smn != null ? Math.round(smn) : "\u2014") +
      (errs.length ? " \u2014 with errors (see the report)" : "");
    s.lastMsgKind = errs.length ? "err" : "msg";
    avSessionUiWarnDropKey("restore.fail");
    if (errs.length) avSessionUiWarn("restore.errors", "the last restore finished with errors \u2014 see the BACKUP report line");
    else avSessionUiWarnDropKey("restore.errors");
    try {
      if (typeof window !== "undefined" && window) {
        window.__avSessionUiLastRestore = {
          name: fname,
          bytes: (buf && typeof buf.byteLength === "number") ? buf.byteLength : null,
          restored: { sessions: sn, packs: pn, samples: smn },
          skipped: skipped,
          errors: errs.length,
          at: Date.now(),
        };
      }
    } catch (e) { /* stamp is a nicety */ }
  }
  avSessionUiSync();
}

/* ---------- RECOVERY actions ---------- */

function avSessionUiRecover() {
  const s = avSessionUiState;
  try {
    if (avSessionUiBusy()) return false;
    if (typeof avSessionRecover !== "function") {
      avSessionUiMissingNote("avSessionRecover", "recovery is unavailable");
      s.lastMsg = "this build cannot recover (avSessionRecover is missing)";
      s.lastMsgKind = "err";
      avSessionUiSync();
      return false;
    }
    s.recovering = true;
    s.lastMsg = "recovering the autosaved snapshot\u2026";
    s.lastMsgKind = "msg";
    avSessionUiSync();
    let p = null;
    try { p = avSessionRecover(); } catch (e) { p = { ok: false, error: String((e && e.message) || e || "recover failed") }; }
    avSessionUiSettle(p, avSessionUiRecoverSettle);
    return true;
  } catch (e) { return false; }
}

function avSessionUiRecoverSettle(r) {
  const s = avSessionUiState;
  s.recovering = false;
  if (avSessionUiOK(r) === false) {
    const why = (r && typeof r === "object" && r.error) ? avSessionUiErrText(r.error) : "refused";
    s.lastMsg = "recovery refused \u2014 " + why;
    s.lastMsgKind = "err";
    avSessionUiWarn("recover.fail", "the recovery was refused \u2014 " + why);
  } else {
    const bits = avSessionUiCountBits(r);
    s.lastMsg = "recovered the autosaved snapshot \u2014 the working state was replaced" + (bits.length ? " (" + bits.join(" \u00b7 ") + ")" : "");
    s.lastMsgKind = "msg";
    avSessionUiWarnDropKey("recover.fail");
    s.nameId = null;
  }
  avSessionUiSync();
}

function avSessionUiDismiss() {
  const s = avSessionUiState;
  try {
    if (avSessionUiBusy()) return false;
    if (typeof avSessionDismissRecovery !== "function") {
      avSessionUiMissingNote("avSessionDismissRecovery", "dismissing is unavailable");
      s.lastMsg = "this build cannot dismiss the recovery offer (avSessionDismissRecovery is missing)";
      s.lastMsgKind = "err";
      avSessionUiSync();
      return false;
    }
    let ok = true;
    try { if (avSessionDismissRecovery() === false) ok = false; } catch (e) { ok = false; }
    if (ok) {
      s.lastMsg = "the recovery offer was dismissed";
      s.lastMsgKind = "msg";
      avSessionUiWarnDropKey("dismiss.fail");
    } else {
      s.lastMsg = "the recovery offer could not be dismissed";
      s.lastMsgKind = "err";
      avSessionUiWarn("dismiss.fail", "the recovery offer could not be dismissed");
    }
    avSessionUiSync();
    return ok;
  } catch (e) { return false; }
}

/* ---------- browser v2 actions (R20: search / sort / tags) ---------- */

function avSessionUiSearchSet(v) {
  const s = avSessionUiState;
  try {
    const t = String(v == null ? "" : v).slice(0, AV_SESSION_UI_SEARCH_MAX);
    if (t === s.search) return false;
    s.search = t;
    avSessionUiSync();                    /* the ONE shared rerender */
    return true;
  } catch (e) { return false; }
}

function avSessionUiSortSet(v) {
  const s = avSessionUiState;
  try {
    const raw = String(v == null ? "" : v);
    let t = "newest";
    for (let i = 0; i < AV_SESSION_UI_SORTS.length; i++) if (AV_SESSION_UI_SORTS[i] === raw) t = raw;
    if (t === s.sort) return false;
    s.sort = t;
    avSessionUiSync();                    /* the ONE shared rerender */
    return true;
  } catch (e) { return false; }
}

/* the row's current tags from the module list (client truth for the compare step); null when
   the row is absent */
function avSessionUiTagsOf(id) {
  try {
    const list = avSessionUiListRead();
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r && typeof r === "object" && avSessionUiStrField(r, ["id"]) === id) return avSessionUiTagsNorm(r.tags);
    }
  } catch (e) { /* absent */ }
  return null;
}

function avSessionUiTagsFocus(id) {
  try {
    const host = avSessionUiHost();
    if (!host || typeof host.querySelectorAll !== "function") return false;
    const nodes = host.querySelectorAll(".av-sessions-tags-input");
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n && typeof n.getAttribute === "function" && String(n.getAttribute("data-id") || "") === id && typeof n.focus === "function") {
        n.focus();
        return true;
      }
    }
  } catch (e) { /* focus is a nicety */ }
  return false;
}

function avSessionUiTagsOpen(id) {
  const s = avSessionUiState;
  try {
    if (typeof id !== "string" || !id) return false;
    if (avSessionUiBusy()) return false;
    const cur = avSessionUiTagsOf(id);
    if (cur === null) return false;             /* the row is gone -- never invent one */
    s.tagEditId = id;
    s.tagDraft = cur.join(", ");
    avSessionUiSync();
    avSessionUiTagsFocus(id);
    return true;
  } catch (e) { return false; }
}

function avSessionUiTagsCancel() {
  const s = avSessionUiState;
  try {
    if (!s.tagEditId) return false;
    s.tagEditId = "";
    s.tagDraft = "";
    avSessionUiSync();
    return true;
  } catch (e) { return false; }
}

/* commit the open editor: unchanged -> just close; changed -> avSessionSetTags */
function avSessionUiTagsCommit(input) {
  const s = avSessionUiState;
  try {
    const id = s.tagEditId;
    if (!id) return false;
    let value = s.tagDraft;
    if (input && typeof input.value === "string") value = input.value;
    const next = avSessionUiTagsParse(value);
    const cur = avSessionUiTagsOf(id) || [];
    s.tagEditId = "";
    s.tagDraft = "";
    if (next.join("\u0001") === cur.join("\u0001")) {   /* nothing changed: just close */
      avSessionUiSync();
      return true;
    }
    return avSessionUiTagsSave(id, next);
  } catch (e) { return false; }
}

/* the module call: avSessionSetTags(id, tags) through the pinned name (typeof-guarded); tag
   commits are quick meta writes -- they never take the module-op gate */
function avSessionUiTagsSave(id, list) {
  const s = avSessionUiState;
  try {
    if (typeof id !== "string" || !id) return false;
    if (typeof avSessionSetTags !== "function") {
      avSessionUiMissingNote("avSessionSetTags", "tag editing is unavailable");
      s.lastMsg = "this build cannot save tags (avSessionSetTags is missing)";
      s.lastMsgKind = "err";
      avSessionUiSync();
      return false;
    }
    const next = avSessionUiTagsParse(list);
    s.tagsBusy = (s.tagsBusy || 0) + 1;
    s.lastMsg = "saving tags\u2026";
    s.lastMsgKind = "msg";
    avSessionUiSync();
    let p = null;
    try { p = avSessionSetTags(id, next); } catch (e) { p = { ok: false, error: String((e && e.message) || e || "tags failed") }; }
    avSessionUiSettle(p, function (r) { avSessionUiTagsSettle(id, next, r); });
    return true;
  } catch (e) { return false; }
}

function avSessionUiTagsSettle(id, want, r) {
  const s = avSessionUiState;
  s.tagsBusy = Math.max(0, (s.tagsBusy || 0) - 1);
  if (avSessionUiOK(r) === false) {
    const why = (r && typeof r === "object" && r.error) ? avSessionUiErrText(r.error) : "refused";
    s.lastMsg = "the tags were not saved \u2014 " + why;
    s.lastMsgKind = "err";
    avSessionUiWarn("tags.fail", "the tags were not saved \u2014 " + why);
  } else {
    const got = (r && typeof r === "object" && Array.isArray(r.tags)) ? avSessionUiTagsNorm(r.tags) : (Array.isArray(want) ? want : []);
    s.lastMsg = "tags saved" + (got.length ? " \u2014 " + avSessionUiClean(got.join(" \u00b7 "), 120) : " (cleared)");
    s.lastMsgKind = "msg";
    avSessionUiWarnDropKey("tags.fail");
  }
  avSessionUiSync();
}

/* ---------- paint ---------- */

function avSessionUiIdleText() {
  const s = avSessionUiState;
  if (typeof avSessionList !== "function" && typeof avSessionState !== "function") {
    return "the session module is not loaded \u2014 saving, loading and versions are unavailable";
  }
  if (s.curId) {
    return "current: \u201c" + (s.curName || "untitled") + "\u201d" + (s.dirty ? " \u00b7 unsaved changes" : "") + " \u00b7 " + s.count + " session" + (s.count === 1 ? "" : "s");
  }
  if (s.count > 0) return s.count + " session" + (s.count === 1 ? "" : "s") + " \u2014 LOAD one, or SAVE the current state";
  return "ready \u2014 press SAVE to keep the current working state";
}

function avSessionUiStatusText() {
  const s = avSessionUiState;
  if (s.saveBusy) return { text: "saving\u2026", kind: "msg" };
  if (s.opBusy) {
    if (s.opBusy.kind === "load") return { text: "loading\u2026", kind: "msg" };
    if (s.opBusy.kind === "del") return { text: "deleting\u2026", kind: "msg" };
    if (s.opBusy.kind === "restore") return { text: "restoring v" + s.opBusy.ver + "\u2026", kind: "msg" };
  }
  if (s.backupBusy) return { text: "building the backup zip\u2026", kind: "msg" };
  if (s.restoreFileBusy) return { text: "restoring from file\u2026", kind: "msg" };
  if (s.recovering) return { text: "recovering the autosaved snapshot\u2026", kind: "msg" };
  if (s.tagsBusy > 0) return { text: "saving tags\u2026", kind: "msg" };
  if (s.lastMsg) return { text: s.lastMsg, kind: (s.lastMsgKind === "err") ? "err" : "msg" };
  return { text: avSessionUiIdleText(), kind: "msg" };
}

/* SAVE control: busy label while a save is in flight */
function avSessionUiPaintSave(host) {
  const s = avSessionUiState;
  try {
    const btn = host.querySelector("#av-sessions-save");
    if (btn) {
      if (btn.disabled !== !!s.saveBusy) btn.disabled = !!s.saveBusy;
      const txt = s.saveBusy ? "SAVING\u2026" : "SAVE";
      if (btn.textContent !== txt) btn.textContent = txt;
    }
    return true;
  } catch (e) { return false; }
}

/* refill the name field from the current session — only when the current id changed */
function avSessionUiPaintName(host) {
  const s = avSessionUiState;
  try {
    const el = host.querySelector("#av-sessions-name");
    if (!el) return false;
    if (s.nameId !== s.curId) {
      let focused = false;
      try { if (typeof document !== "undefined" && document && document.activeElement === el) focused = true; } catch (e) { focused = false; }
      if (focused) return true;   /* never clobber the field being edited; refill retries on a later paint */
      avSessionUiSetValue(el, s.curName || "");
      s.nameId = s.curId;
    }
    return true;
  } catch (e) { return false; }
}

function avSessionUiPaintStatus(host) {
  try {
    const st = avSessionUiStatusText();
    const el = host.querySelector("#av-sessions-status");
    if (el) {
      const cls = "av-sessions-status " + (st.kind === "err" ? "av-sessions-err" : "av-sessions-msg");
      if (el.className !== cls) el.className = cls;
      if (el.textContent !== st.text) el.textContent = st.text;
    }
    return true;
  } catch (e) { return false; }
}

function avSessionUiPaintRecovery(host) {
  const s = avSessionUiState;
  try {
    const row = host.querySelector("#av-sessions-recovery");
    if (row) row.hidden = !s.recAvail;
    const at = host.querySelector("#av-sessions-recovery-at");
    if (at) {
      const txt = s.recAvail
        ? ("an autosaved snapshot" + (s.recAt ? " from " + s.recAt : "") + (s.recName ? " \u2014 \u201c" + avSessionUiClean(s.recName, 48) + "\u201d" : "") + " is waiting")
        : "";
      if (at.textContent !== txt) at.textContent = txt;
    }
    const rec = host.querySelector("#av-sessions-recover");
    if (rec) {
      if (rec.disabled !== !!s.recovering) rec.disabled = !!s.recovering;
      const txt = s.recovering ? "RECOVERING\u2026" : "RECOVER";
      if (rec.textContent !== txt) rec.textContent = txt;
    }
    const dis = host.querySelector("#av-sessions-dismiss");
    if (dis) { if (dis.disabled !== !!s.recovering) dis.disabled = !!s.recovering; }
    return true;
  } catch (e) { return false; }
}

function avSessionUiPaintCounts(host) {
  const s = avSessionUiState;
  try {
    const cnt = host.querySelector("#av-sessions-count");
    if (cnt) {
      const txt = s.count + " session" + (s.count === 1 ? "" : "s");
      if (cnt.textContent !== txt) cnt.textContent = txt;
    }
    const st = host.querySelector("#av-sessions-storage");
    if (st) {
      const txt = (s.backend === "idb") ? "storage \u2014 IndexedDB"
        : (s.backend === "ls") ? "storage \u2014 local storage"
          : (s.backend === "mem") ? "storage \u2014 memory only"
            : "storage \u2014";
      if (st.textContent !== txt) st.textContent = txt;
    }
    return true;
  } catch (e) { return false; }
}

function avSessionUiPaintList(host) {
  const s = avSessionUiState;
  try {
    const box = host.querySelector("#av-sessions-list");
    const none = host.querySelector("#av-sessions-none");
    const list = avSessionUiListRead();
    let rawN = 0;
    for (let i = 0; i < list.length; i++) {
      const r0 = list[i];
      if (r0 && typeof r0 === "object" && avSessionUiStrField(r0, ["id"])) rawN += 1;
    }
    const rows = avSessionUiViewRows(list);
    if (s.tagEditId) {                    /* the edited row vanished (or was filtered out) */
      let alive = false;
      for (let i = 0; i < rows.length; i++) if (avSessionUiStrField(rows[i], ["id"]) === s.tagEditId) { alive = true; break; }
      if (!alive) { s.tagEditId = ""; s.tagDraft = ""; }
    }
    const views = [];
    let key = "op:" + (s.opBusy ? s.opBusy.kind + ":" + s.opBusy.id + ":" + (s.opBusy.ver == null ? "" : s.opBusy.ver) : "") +
      "|q:" + s.search + "|so:" + s.sort + "|ed:" + s.tagEditId + "|";
    for (let i = 0; i < rows.length && views.length < AV_SESSION_UI_LIST_MAX; i++) {
      const r = rows[i];
      const id = avSessionUiStrField(r, ["id"]);
      if (!id) continue;
      const name = avSessionUiClean(avSessionUiStrField(r, ["name"]) || "untitled", 48);
      const atText = avSessionUiWhen(r.savedAt != null ? r.savedAt : r.updatedAt);
      const updText = avSessionUiWhen(r.updatedAt);
      const v = Math.max(1, Math.round(avSessionUiNum(r.version, 1)));
      const cur = r.current === true;
      const tags = avSessionUiTagsNorm(r.tags);
      const engine = (typeof r.engine === "string" && r.engine) ? r.engine : null;
      const bars = (typeof r.bars === "number" && isFinite(r.bars)) ? r.bars : null;
      const takes = (typeof r.takes === "number" && isFinite(r.takes)) ? r.takes : null;
      const vers = [];
      if (typeof avSessionVersions === "function") {
        let raw = null;
        try { raw = avSessionVersions(id); } catch (e) { raw = null; }
        if (Array.isArray(raw)) {
          for (let j = 0; j < raw.length && vers.length < AV_SESSION_UI_VERS_MAX; j++) {
            const e = raw[j];
            if (!e || typeof e !== "object") continue;
            vers.push({
              n: Math.max(1, Math.round(avSessionUiNum(e.version, j + 1))),
              atText: avSessionUiWhen(e.savedAt),
              bytesText: avSessionUiFmtBytes(e.bytes),
            });
          }
        }
      }
      const view = { id: id, name: name, atText: atText, updText: updText, v: v, cur: cur, tags: tags, engine: engine, bars: bars, takes: takes, vers: vers };
      views.push(view);
      key += id + "|" + name + "|" + atText + "|" + updText + "|" + v + "|" + (cur ? 1 : 0) + "|" + (engine || "") + "|" + (bars == null ? "" : bars) + "|" + (takes == null ? "" : takes) + "|" + tags.join(",") + "|";
      for (let j = 0; j < vers.length; j++) key += ">v" + vers[j].n + "@" + vers[j].atText + "#" + vers[j].bytesText;
      key += "||";
    }
    s.lastRows = views.length;
    if (box && key !== s.sessKey) {
      s.sessKey = key;
      let html = "";
      for (let i = 0; i < views.length; i++) html += avSessionUiSessionRowHTML(views[i], s.opBusy);
      box.innerHTML = html;
    }
    if (none) {
      none.hidden = views.length > 0;
      const searching = String(s.search || "") !== "";
      const txt = (views.length === 0 && rawN > 0 && searching)
        ? "no sessions match \u2014 clear the search"
        : "No sessions yet \u2014 press SAVE to keep the current working state.";
      if (none.textContent !== txt) none.textContent = txt;
    }
    return true;
  } catch (e) { return false; }
}

function avSessionUiSecsOf(ms) {
  const n = Number(ms);
  if (!isFinite(n) || n <= 0) return AV_SESSION_UI_AS_DEF;
  return Math.max(5, Math.min(600, Math.round(n / 1000)));
}

function avSessionUiPaintAutosave(host) {
  const s = avSessionUiState;
  try {
    const btn = host.querySelector("#av-sessions-autosave");
    if (btn) {
      if (btn.classList) btn.classList.toggle("on", !!s.autosaveOn);
      const pressed = s.autosaveOn ? "true" : "false";
      if (btn.getAttribute("aria-pressed") !== pressed) btn.setAttribute("aria-pressed", pressed);
    }
    const sel = host.querySelector("#av-sessions-autosave-ms");
    if (sel) {
      const secs = avSessionUiSecsOf(s.autosaveMs);
      const extra = (AV_SESSION_UI_AS_OPTS.indexOf(secs) >= 0) ? null : secs;
      const key = "k:" + String(extra == null ? "" : extra);
      if (key !== s.asKey) {
        s.asKey = key;
        sel.innerHTML = avSessionUiAsOptionsHTML(extra);
      }
      avSessionUiSetValue(sel, String(secs));
    }
    const val = host.querySelector("#av-sessions-autosave-val");
    if (val) {
      let txt;
      if (typeof avSessionAutosave !== "function") txt = "unavailable";
      else {
        const secs = avSessionUiSecsOf(s.autosaveMs);
        txt = (s.autosaveOn ? "on \u2014 every " + secs + " s" : "off \u2014 no snapshot is written") +
          (s.lastAsAt > 0 ? " \u00b7 last write " + avSessionUiWhen(s.lastAsAt) : "");
      }
      if (val.textContent !== txt) val.textContent = txt;
    }
    return true;
  } catch (e) { return false; }
}

function avSessionUiPaintBackup(host) {
  const s = avSessionUiState;
  try {
    const busy = !!(s.backupBusy || s.restoreFileBusy);
    const bb = host.querySelector("#av-sessions-backup");
    if (bb) {
      if (bb.disabled !== busy) bb.disabled = busy;
      const txt = s.backupBusy ? "BUILDING\u2026" : "BACKUP NOW";
      if (bb.textContent !== txt) bb.textContent = txt;
    }
    const rb = host.querySelector("#av-sessions-restore");
    if (rb) {
      if (rb.disabled !== busy) rb.disabled = busy;
      const txt = s.restoreFileBusy ? "RESTORING\u2026" : "RESTORE (FILE)";
      if (rb.textContent !== txt) rb.textContent = txt;
    }
    /* last build: the module's own truth when present, else the card's own receipt */
    let last = null;
    if (typeof avBackupState === "function") {
      let bs = null;
      try { bs = avBackupState(); } catch (e) { bs = null; }
      if (bs && typeof bs === "object" && bs.lastBuild && typeof bs.lastBuild === "object") last = bs.lastBuild;
    }
    if (!last) last = s.lastBackup;
    const bv = host.querySelector("#av-sessions-backup-val");
    if (bv) {
      let txt = "no backup yet \u2014 BACKUP NOW packs sessions \u00b7 packs \u00b7 samples";
      if (last && typeof last === "object") {
        const lname = avSessionUiStrField(last, ["name"]);
        const lbytes = avSessionUiNumField(last, ["bytes"]);
        const lat = avSessionUiWhen(last.at != null ? last.at : last.savedAt);
        txt = "last backup" + (lname ? " \u201c" + avSessionUiClean(lname, 48) + "\u201d" : "") +
          (lbytes != null ? " \u00b7 " + avSessionUiFmtBytes(lbytes) : "") + (lat ? " \u00b7 " + lat : "");
      }
      if (bv.textContent !== txt) bv.textContent = txt;
    }
    const pg = host.querySelector("#av-sessions-progress");
    if (pg) {
      if (pg.textContent !== s.progress) pg.textContent = s.progress;
      pg.hidden = !s.progress;
    }
    const rp = host.querySelector("#av-sessions-report");
    if (rp) {
      if (rp.textContent !== s.report) rp.textContent = s.report;
      rp.hidden = !s.report;
      const cls = "av-note av-sessions-report" + (s.reportKind === "err" ? " av-sessions-err" : "");
      if (rp.className !== cls) rp.className = cls;
    }
    return true;
  } catch (e) { return false; }
}

function avSessionUiPaintWarnings(host) {
  try {
    const box = host.querySelector("#av-sessions-warnings");
    if (!box) return false;
    const list = avSessionUiState.warnings || [];
    box.hidden = list.length === 0;
    let key = "";
    for (let i = 0; i < list.length; i++) key += list[i].key + ":" + list[i].text + "|";
    if (key !== avSessionUiState.warnKey) {
      avSessionUiState.warnKey = key;
      let html = '<div class="av-sessions-warn-head">WARNINGS</div>';
      for (let i = 0; i < list.length; i++) html += '<div class="av-sessions-warn-item">' + avSessionUiEsc(list[i].text) + "</div>";
      box.innerHTML = html;
    }
    return true;
  } catch (e) { return false; }
}

/* the browser v2 controls: search + sort (write-on-change only; never clobber a focused field) */
function avSessionUiPaintTools(host) {
  const s = avSessionUiState;
  try {
    const inp = host.querySelector("#av-sessions-search");
    if (inp) avSessionUiSetValue(inp, s.search);
    const sel = host.querySelector("#av-sessions-sort");
    if (sel) avSessionUiSetValue(sel, s.sort);
    return true;
  } catch (e) { return false; }
}

/* full repaint: mirrors first (guarded), then every control (write-on-change only) */
function avSessionUiSync() {
  const host = avSessionUiHost();
  if (!host) return false;
  try {
    let card = null;
    try { card = (typeof host.querySelector === "function") ? host.querySelector(".av-sessions") : null; } catch (e) { card = null; }
    if (!card) {
      host.innerHTML = avSessionUiBodyHTML();
      avSessionUiState.sessKey = "";
      avSessionUiState.asKey = "";
      avSessionUiState.warnKey = "";
      avSessionUiWire(host);
    }
    avSessionUiStateSync();
    avSessionUiStorageNote();
    avSessionUiPaintName(host);
    avSessionUiPaintTools(host);
    avSessionUiPaintSave(host);
    avSessionUiPaintStatus(host);
    avSessionUiPaintRecovery(host);
    avSessionUiPaintCounts(host);
    avSessionUiPaintList(host);
    avSessionUiPaintAutosave(host);
    avSessionUiPaintBackup(host);
    avSessionUiPaintWarnings(host);
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- poll (light state+list signature; ~1.2 s, no rAF) ---------- */

function avSessionUiListSig() {
  try {
    if (typeof avSessionList !== "function") return "";
    const l = avSessionList();
    if (!Array.isArray(l)) return "";
    let out = "";
    for (let i = 0; i < l.length && i < AV_SESSION_UI_LIST_MAX; i++) {
      const r = l[i] || {};
      out += String(r.id) + ":" + String(r.name) + ":" + String(r.version) + ":" + (r.current === true ? 1 : 0) + ":" + String(r.updatedAt) + ":" + (Array.isArray(r.tags) ? r.tags.join(",") : "") + "|";
    }
    return out;
  } catch (e) { return ""; }
}

function avSessionUiSig() {
  try {
    let sig = "";
    if (typeof avSessionState === "function") {
      let st = null;
      try { st = avSessionState(); } catch (e) { st = null; }
      if (st && typeof st === "object") {
        const cur = st.current;
        const curId = (cur && typeof cur === "object" && typeof cur.id === "string") ? cur.id : "";
        const as = st.autosave;
        const asOn = (as && typeof as === "object") ? (as.on === true ? 1 : (as.on === false ? 0 : -1)) : -1;
        const asMs = (as && typeof as === "object" && isFinite(Number(as.ms))) ? Number(as.ms) : -1;
        const rc = st.recovery;
        const rcAv = (rc && typeof rc === "object") ? (rc.available === true ? 1 : (rc.available === false ? 0 : -1)) : -1;
        const rcAt = (rc && typeof rc === "object" && rc.savedAt != null) ? String(rc.savedAt) : "";
        sig += [st.count, curId, (st.dirty === true ? 1 : 0), st.lastAutosaveAt, asOn, asMs, rcAv, rcAt, st.backend].join("|");
      }
    }
    return sig + ";" + avSessionUiListSig();
  } catch (e) { return ""; }
}

function avSessionUiPoll() {
  const s = avSessionUiState;
  try {
    if (!s.inited) return false;
    const sig = avSessionUiSig();
    if (sig === s.pollSig) return false;
    s.pollSig = sig;
    avSessionUiSync();
    return true;
  } catch (e) { return false; }
}

function avSessionUiStartPoll() {
  const s = avSessionUiState;
  try {
    if (s.timerId != null) return false;
    if (typeof setInterval !== "function") return false;
    s.timerId = setInterval(avSessionUiPoll, AV_SESSION_UI_POLL_MS);
    return s.timerId != null;
  } catch (e) { return false; }
}

/* ---------- wiring (delegated, bound ONCE per host element; the dataset marker) ---------- */

function avSessionUiClick(e) {
  try {
    const t = (e && e.target && typeof e.target.closest === "function") ? e.target : null;
    if (!t) return;
    if (t.closest("#av-sessions-save")) { avSessionUiSave(); return; }
    if (t.closest("#av-sessions-autosave")) { avSessionUiAutosaveToggle(); return; }
    if (t.closest("#av-sessions-recover")) { avSessionUiRecover(); return; }
    if (t.closest("#av-sessions-dismiss")) { avSessionUiDismiss(); return; }
    if (t.closest("#av-sessions-backup")) { avSessionUiBackup(); return; }
    if (t.closest("#av-sessions-restore")) { avSessionUiRestoreFilePick(); return; }
    const act = t.closest("[data-act]");
    if (act) {
      const what = String(act.getAttribute("data-act") || "");
      let id = String(act.getAttribute("data-id") || "");
      if (!id) {
        const row = (typeof act.closest === "function") ? act.closest("[data-id]") : null;
        id = row ? String(row.getAttribute("data-id") || "") : "";
      }
      if (!id) return;
      if (what === "load") { avSessionUiLoad(id); return; }
      if (what === "del") { avSessionUiDelete(id); return; }
      if (what === "tags") { avSessionUiTagsOpen(id); return; }
      if (what === "restore") {
        const ver = String(act.getAttribute("data-ver") || "");
        avSessionUiRestore(id, ver);
        return;
      }
    }
  } catch (err) { /* a listener never throws outward */ }
}

function avSessionUiChange(e) {
  try {
    const t = (e && e.target && typeof e.target.closest === "function") ? e.target : null;
    if (!t) return;
    if (t.closest("#av-sessions-autosave-ms")) { avSessionUiAutosaveMsChange(t); return; }
    if (t.closest("#av-sessions-restore-file")) { avSessionUiFileChange(t); return; }
    if (t.closest("#av-sessions-sort")) { avSessionUiSortSet(t.value); return; }
    if (t.closest(".av-sessions-tags-input")) { avSessionUiTagsCommit(t); return; }
  } catch (err) { /* a listener never throws outward */ }
}

/* delegated input events: the search field (per keystroke) + the tags draft mirror */
function avSessionUiInput(e) {
  const s = avSessionUiState;
  try {
    const t = (e && e.target && typeof e.target.closest === "function") ? e.target : null;
    if (!t) return;
    if (t.closest("#av-sessions-search")) { avSessionUiSearchSet(t.value); return; }
    if (t.closest(".av-sessions-tags-input")) { if (s.tagEditId) s.tagDraft = String(t.value == null ? "" : t.value); return; }
  } catch (err) { /* a listener never throws outward */ }
}

/* delegated keydown: Enter commits the tags draft, Escape cancels it */
function avSessionUiKeydown(e) {
  try {
    const t = (e && e.target && typeof e.target.closest === "function") ? e.target : null;
    if (!t) return;
    if (!t.closest(".av-sessions-tags-input")) return;
    const key = String((e && e.key) || "");
    if (key === "Enter") {
      try { if (e && typeof e.preventDefault === "function") e.preventDefault(); } catch (x) { /* ok */ }
      avSessionUiTagsCommit(t);
      return;
    }
    if (key === "Escape") {
      try { if (e && typeof e.preventDefault === "function") e.preventDefault(); } catch (x) { /* ok */ }
      avSessionUiTagsCancel();
      return;
    }
  } catch (err) { /* a listener never throws outward */ }
}

/* delegated focusout: leaving the tags editor commits it (unchanged drafts just close) */
function avSessionUiFocusOut(e) {
  try {
    const t = (e && e.target && typeof e.target.closest === "function") ? e.target : null;
    if (!t) return;
    if (t.closest(".av-sessions-tags-input")) avSessionUiTagsCommit(t);
  } catch (err) { /* a listener never throws outward */ }
}

function avSessionUiWire(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  try {
    if (host.dataset && host.dataset.avSessionUiWired === "1") return true;   /* one delegation per host element */
    if (host.dataset) host.dataset.avSessionUiWired = "1";
    host.addEventListener("click", avSessionUiClick);
    host.addEventListener("change", avSessionUiChange);
    host.addEventListener("input", avSessionUiInput);
    host.addEventListener("keydown", avSessionUiKeydown);
    host.addEventListener("focusout", avSessionUiFocusOut);
    return true;
  } catch (e) { return false; }
}

/* ---------- init (mount, idempotent, re-mountable) ---------- */

function avSessionUiInit() {
  const host = avSessionUiHost();
  if (!host) return false;
  try {
    let card = null;
    try { card = (typeof host.querySelector === "function") ? host.querySelector(".av-sessions") : null; } catch (e) { card = null; }
    if (!card) {
      host.innerHTML = avSessionUiBodyHTML();
      avSessionUiState.sessKey = "";
      avSessionUiState.asKey = "";
      avSessionUiState.warnKey = "";
    }
    avSessionUiWire(host);
    const s = avSessionUiState;
    s.inited = true;
    s.mounts += 1;
    avSessionUiModulesNote();
    avSessionUiSync();
    avSessionUiStartPoll();
    return true;
  } catch (e) { return false; }
}

/* ---------- observables ---------- */

function avSessionUiSnap() {
  const host = avSessionUiHost();
  const s = avSessionUiState;
  const snap = {
    version: AV_SESSION_UI_VERSION,
    inited: !!s.inited,
    mounts: s.mounts,
    host: !!host,
    wired: !!(host && host.dataset && host.dataset.avSessionUiWired === "1"),
    card: false,
    modules: {
      session: (typeof avSessionState === "function") || (typeof avSessionList === "function") || (typeof avSessionSave === "function"),
      backup: (typeof avBackupBuild === "function"),
      versions: (typeof avSessionVersions === "function"),
    },
    sessions: {
      count: s.count,
      current: s.curId ? { id: s.curId, name: s.curName } : null,
      curId: s.curId,
      dirty: !!s.dirty,
      backend: s.backend,
    },
    autosave: { on: !!s.autosaveOn, ms: s.autosaveMs, lastAt: s.lastAsAt },
    recovery: { available: !!s.recAvail, at: s.recAt, name: s.recName },
    busy: {
      save: !!s.saveBusy,
      op: s.opBusy ? (s.opBusy.kind + ":" + s.opBusy.id + ":" + (s.opBusy.ver == null ? "" : s.opBusy.ver)) : "",
      backup: !!s.backupBusy,
      restoreFile: !!s.restoreFileBusy,
      recovering: !!s.recovering,
      tags: s.tagsBusy > 0,
    },
    view: { search: s.search, sort: s.sort, editing: s.tagEditId || null, rows: s.lastRows },
    status: s.lastMsg, statusKind: s.lastMsgKind,
    warnings: s.warnings.map(function (w) { return w.text; }),
    classes: avSessionUiClasses(),
  };
  try { if (host && host.querySelector) snap.card = !!host.querySelector(".av-sessions"); } catch (e) { snap.card = false; }
  return snap;
}

function avSessionUiClasses() {
  return [
    "av-sessions", "av-sessions-head", "av-sessions-title", "av-sessions-cap",
    "av-sessions-status-line", "av-sessions-status", "av-sessions-msg", "av-sessions-err",
    "av-sessions-recovery", "av-sessions-recovery-lbl", "av-sessions-recovery-at",
    "av-sessions-recover", "av-sessions-dismiss",
    "av-sessions-sect", "av-sessions-sect-head", "av-sessions-sect-lbl",
    "av-sessions-count", "av-sessions-storage",
    "av-sessions-row", "av-sessions-lab", "av-sessions-btn",
    "av-sessions-name", "av-sessions-save",
    "av-sessions-list", "av-sessions-none",
    "av-sessions-session", "av-sessions-cur", "av-sessions-session-name",
    "av-sessions-session-at", "av-sessions-session-v", "av-sessions-session-cur",
    "av-sessions-session-load", "av-sessions-session-del",
    "av-sessions-vers", "av-sessions-ver", "av-sessions-ver-n", "av-sessions-ver-at",
    "av-sessions-ver-bytes", "av-sessions-ver-restore",
    "av-sessions-autosave", "av-sessions-autosave-val", "av-sessions-autosave-ms", "on",
    "av-sessions-backup", "av-sessions-backup-val", "av-sessions-restore", "av-sessions-file",
    "av-sessions-progress", "av-sessions-report",
    "av-sessions-warnings", "av-sessions-warn-head", "av-sessions-warn-item",
    "av-sessions-foot",
    "av-sessions-tools", "av-sessions-search", "av-sessions-sort",
    "av-sessions-tags", "av-sessions-tags-list", "av-sessions-tags-none", "av-sessions-tag",
    "av-sessions-tags-sep", "av-sessions-tags-input", "av-sessions-tags-btn",
    "av-sessions-prev", "av-sessions-prev-part", "av-sessions-prev-eng", "av-sessions-prev-bars",
    "av-sessions-prev-takes", "av-sessions-prev-saved", "av-sessions-prev-upd",
  ];
}

/* ---------- debug/verify handle ---------- */

if (typeof window !== "undefined") {
  try {
    window.__avSessionUi = {
      version: AV_SESSION_UI_VERSION,
      init: function () { return avSessionUiInit(); },
      sync: function () { return avSessionUiSync(); },
      classes: function () { return avSessionUiClasses(); },
      state: function () { return avSessionUiSnap(); },
      save: function (name) { return avSessionUiSave(name); },
      load: function (id) { return avSessionUiLoad(id); },
      del: function (id) { return avSessionUiDelete(id); },
      restore: function (id, ver) { return avSessionUiRestore(id, ver); },
      backup: function () { return avSessionUiBackup(); },
      pick: function () { return avSessionUiRestoreFilePick(); },
      recover: function () { return avSessionUiRecover(); },
      dismiss: function () { return avSessionUiDismiss(); },
      autosave: function (on, ms) { return avSessionUiAutosaveSet(on, ms); },
      setTags: function (id, tags) { return avSessionUiTagsSave(id, tags); },
    };
  } catch (e) { /* no window — nothing to publish */ }
}
