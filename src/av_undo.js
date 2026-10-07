/* Anvil — UNDO/REDO + A/B (P4 §3.6, child F): the bounded edit-history that spans the editor and
   the sequencer. One global timeline of entries, each entry a pair of JSON-string snapshots of ONE
   domain (params · seq · plock) — undo walks back, redo walks forward, A/B stores and recalls a
   named reference state on the same domains.

   Semantics (PIN — the coordinate system every caller must share):
     - An ENTRY is { domain, label, before, after, t }: `before`/`after` are JSON strings of the
       domain state, captured when the change was recorded. Undo applies `before`; redo applies
       `after`. Storage is strings only, so memory is measurable and the cap enforceable.
     - avUndoPush(domain, label) records the CURRENT state as a new checkpoint. Call it RIGHT
       AFTER a committed domain change (the previous checkpoint becomes the entry's `before`).
       Returns true when an entry was recorded. The FIRST-EVER push for a domain only establishes
       its baseline checkpoint (returns false): avUndoInit() captures baselines for every domain
       already online at boot, so in the app the first user edit is already undoable.
     - A push with no change since the domain's last checkpoint records nothing (false) — the
       history never holds no-op entries. A new recorded change CLEARS the redo stack (classic).
     - A domain whose snapshot hook (avSeqSnap etc.) is not loaded yet refuses with false, never
       throws. Restores are guarded the same way: an entry that cannot be applied stays on its
       stack and the call returns false (the history is never corrupted by a refused restore).

   Domains v1:
     "params" — the avParams mirror diff. One additive, idempotent wrapper around avApplyParam
       (marker `__avUndoWrap`, same pattern as av_mod's) taps every committed page parameter and
       arms a snapshot-on-quiet timer (AV_UNDO_QUIET_MS ≈ 300 ms). One quiet period = one entry
       with a diff-sized label ("filter.cutoff" / "filter.cutoff +2"). Restores apply ONLY the keys
       the entry itself moved (mount-time / out-of-band mirror writes are never clobbered), each
       restored key rides the avApplyParam funnel so the engine hears it; the tap is suppressed
       while restoring (no self-recording), and no restore is ever captured as a new entry.
     "seq" — avSeqSnap() / avSeqLoad() via typeof guards only (contract-pinned names; the module
       must not be loaded yet at boot of this file). Full pattern deep-copy lives in the entry as
       JSON — later mutation of the live pattern cannot leak into history.
     "plock" — avPlockSnap()/avPlockLoad() when the plock module provides them (typeof-guarded);
       otherwise the v1 fallback: the plock container carried inside the core snapshot
       ({plocks:[…]} merged into the CURRENT avSeqSnap() and loaded via avSeqLoad).

   Keyboard (bound by avUndoInit, once): Ctrl+Z = undo · Ctrl+Shift+Z = redo (Ctrl or Cmd), IGNORED
   while a text-entry field is focused (input[type=text-ish], textarea, select, contenteditable —
   range/checkbox/radio/button inputs are not text fields). preventDefault only when the action
   actually ran.

   Observables for the rig: window.__avUndo = { version, depth, redo, label, last, ab, cap, bytes,
   domains } — republished on every init/push/undo/redo/flush/A-store/A-recall.

   Laws honoured here: page module — NO DOM at top level, every DOM/global reach guarded inside a
   function; ONE namespace (avUndo* / AV_UNDO_* — avRedo is the §3.6-pinned name and the single
   deliberate exception); never throws (every public call refuses with false); seeded determinism
   (pure bookkeeping — same ops ⇒ same state); all page commits ride the avApplyParam funnel (the
   params tap wraps it additively and reads the same mirror every card writes).

   Public surface (classic-script globals, ONE namespace):
     avUndoInit() -> bool             install wrap + key bindings; false without window (never throws)
     avUndoPush(domain, label) -> bool    record the current domain state as a checkpoint
     avUndo() -> bool                 undo the newest entry (flush first); false when nothing to undo
     avRedo() -> bool                 redo the newest undone entry; false when empty
     avUndoFlush() -> bool            close a pending params burst NOW (also implicit in push/undo/
                                      redo); true when a burst entry was recorded
     avUndoAStore() / avUndoARecall() -> bool   store / recall the A reference across all domains
     avUndoStatus() -> {depth, redo, label}
     avUndoEnsureWrap() -> bool       install (or adopt) the avApplyParam tap, idempotent
     AV_UNDO_VERSION/CAP/QUIET_MS/MAX_BYTES/DOMAINS/LABEL_MAX */

"use strict";

const AV_UNDO_VERSION = "p4.0";

/* ---------- pins ---------- */

const AV_UNDO_CAP = 64;                      /* live entries kept (undo + redo combined)  */
const AV_UNDO_QUIET_MS = 300;                /* params burst closes after this quiet gap  */
const AV_UNDO_MAX_BYTES = 4 * 1024 * 1024;   /* JSON-string budget across both stacks     */
const AV_UNDO_LABEL_MAX = 60;
const AV_UNDO_BURST_PATHS_MAX = 12;          /* distinct paths remembered per burst label */
const AV_UNDO_DOMAINS = ["params", "seq", "plock"];

/* ---------- the history (single source of truth) ---------- */

const avUndoState = {
  init: false,
  keysBound: false,
  paramEventBound: false,
  wrapInstalled: false,
  undo: [],                  /* oldest -> newest; entries {domain, label, before, after, t, bytes} */
  redo: [],                  /* newest-popped -> top is the next redo */
  bytes: 0,                  /* running total of entry JSON string lengths (both stacks) */
  baseline: {},              /* domain -> JSON string of the last checkpointed state */
  restoring: false,          /* true while applying an entry: the params tap skips */
  paramsDirty: false,        /* a params burst is open */
  paramsPaths: null,         /* distinct paths touched in the open burst (first-touch order) */
  paramsTimer: null,         /* quiet-timer id (null = none) */
  last: "",                  /* last action, for window.__avUndo */
  ab: null,                  /* A slot: { t, snap: {domain: json} } */
};

/* ---------- guarded environment reaches ---------- */

function avUndoWin() {
  try {
    if (typeof window !== "undefined" && window && typeof window === "object") return window;
  } catch (e) { /* no window */ }
  return null;
}

function avUndoDoc() {
  try {
    if (typeof document !== "undefined" && document && typeof document === "object") return document;
  } catch (e) { /* no document */ }
  return null;
}

function avUndoStamp() {
  try { return Date.now(); } catch (e) { return 0; }
}

/* ---------- small value laws ---------- */

function avUndoDomainName(domain) {
  const d = String(domain == null ? "" : domain);
  return AV_UNDO_DOMAINS.indexOf(d) >= 0 ? d : "";
}

function avUndoLabel(label, domain) {
  let s = (typeof label === "string") ? label : "";
  s = s.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!s) s = domain;
  return s.slice(0, AV_UNDO_LABEL_MAX);
}

function avUndoTopLabel() {
  const u = avUndoState.undo;
  return u.length ? String(u[u.length - 1].label || "") : "";
}

function avUndoEntryBytes(e) {
  return e.before.length + e.after.length + e.label.length;
}

/* ---------- domain snapshots (each -> JSON string | null; never throws) ---------- */

function avUndoSnapParams() {
  try {
    if (typeof avParams === "undefined" || !avParams || typeof avParams !== "object") return null;
    const out = {};
    const keys = Object.keys(avParams);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i], v = avParams[k], t = typeof v;
      if (t === "number" || t === "string" || t === "boolean" || v === null) out[k] = v;
    }
    return JSON.stringify(out);
  } catch (e) { return null; }
}

function avUndoSnapSeq() {
  try {
    if (typeof avSeqSnap !== "function") return null;
    const s = avSeqSnap();
    if (!s || typeof s !== "object") return null;
    return JSON.stringify(s);
  } catch (e) { return null; }
}

function avUndoSnapPlock() {
  try {
    if (typeof avPlockSnap === "function") {
      const p = avPlockSnap();
      if (p && typeof p === "object") return JSON.stringify(p);
      return null;
    }
    /* v1 fallback: the plock container rides the core snapshot (§3.1) */
    if (typeof avSeqSnap !== "function") return null;
    const s = avSeqSnap();
    if (!s || typeof s !== "object" || !Array.isArray(s.plocks)) return null;
    return JSON.stringify({ plocks: s.plocks });
  } catch (e) { return null; }
}

function avUndoSnapDomain(domain) {
  if (domain === "params") return avUndoSnapParams();
  if (domain === "seq") return avUndoSnapSeq();
  if (domain === "plock") return avUndoSnapPlock();
  return null;
}

/* ---------- domain restores (target snapshot onto current state; never throws) ---------- */

/* params: apply ONLY the keys whose value moved between the entry's two snapshots — the entry's
   own diff. Each restored key rides the funnel when it exists so the engine hears the restore. */
function avUndoApplyParams(targetStr, otherStr) {
  let t = null, o = null;
  try { t = JSON.parse(targetStr); o = JSON.parse(otherStr); } catch (e) { return false; }
  if (!t || typeof t !== "object" || !o || typeof o !== "object") return false;
  let mirror = null;
  try { if (typeof avParams !== "undefined" && avParams && typeof avParams === "object") mirror = avParams; } catch (e) { mirror = null; }
  if (!mirror) return false;
  const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
  const seen = new Set();
  const all = [];
  let k = "";
  for (k in t) if (has(t, k) && !seen.has(k)) { seen.add(k); all.push(k); }
  for (k in o) if (has(o, k) && !seen.has(k)) { seen.add(k); all.push(k); }
  for (let i = 0; i < all.length; i++) {
    k = all[i];
    const tHas = has(t, k), oHas = has(o, k);
    const tv = tHas ? t[k] : undefined;
    const ov = oHas ? o[k] : undefined;
    if (tHas === oHas && tv === ov) continue;    /* this entry never moved the key */
    if (!tHas) {
      try { delete mirror[k]; } catch (e) { /* one stubborn key must not stop the restore */ }
      continue;
    }
    try {
      if (typeof avApplyParam === "function") avApplyParam(k, tv);
      else mirror[k] = tv;
    } catch (e) { /* one bad key must not stop the restore */ }
  }
  return true;
}

function avUndoApplySeq(targetStr) {
  let o = null;
  try { o = JSON.parse(targetStr); } catch (e) { return false; }
  if (!o || typeof o !== "object") return false;
  if (typeof avSeqLoad !== "function") return false;
  try { return avSeqLoad(o) !== false; } catch (e) { return false; }
}

function avUndoApplyPlock(targetStr) {
  let o = null;
  try { o = JSON.parse(targetStr); } catch (e) { return false; }
  if (!o || typeof o !== "object") return false;
  if (typeof avPlockLoad === "function") {
    try { return avPlockLoad(o) !== false; } catch (e) { return false; }
  }
  /* v1 fallback: merge the container into the CURRENT core snapshot, then avSeqLoad */
  if (typeof avSeqSnap !== "function" || typeof avSeqLoad !== "function") return false;
  try {
    if (!Array.isArray(o.plocks)) return false;
    const cur = avSeqSnap();
    if (!cur || typeof cur !== "object") return false;
    cur.plocks = o.plocks;
    return avSeqLoad(cur) !== false;
  } catch (e) { return false; }
}

function avUndoApplyDomain(domain, targetStr, otherStr) {
  avUndoState.restoring = true;
  let ok = false;
  try {
    if (domain === "params") ok = avUndoApplyParams(targetStr, otherStr);
    else if (domain === "seq") ok = avUndoApplySeq(targetStr);
    else if (domain === "plock") ok = avUndoApplyPlock(targetStr);
  } finally { avUndoState.restoring = false; }
  return ok;
}

/* after a successful restore, the baseline becomes the ACTUAL post-load state (sanitising loads
   may land slightly off the raw string — diffing must follow reality, not the request) */
function avUndoResyncBaseline(domain, fallbackStr) {
  const s = avUndoSnapDomain(domain);
  avUndoState.baseline[domain] = (s != null) ? s : fallbackStr;
}

/* ---------- bounded memory ---------- */

function avUndoEvict() {
  const st = avUndoState;
  while (st.undo.length > AV_UNDO_CAP) {
    const dead = st.undo.shift();
    st.bytes -= avUndoEntryBytes(dead);
  }
  while (st.bytes > AV_UNDO_MAX_BYTES && st.undo.length > 0) {
    const dead = st.undo.shift();
    st.bytes -= avUndoEntryBytes(dead);
  }
  if (st.bytes < 0) st.bytes = 0;                /* belt: never report negative budget use */
}

/* ---------- publish (window.__avUndo) ---------- */

function avUndoPublish() {
  const st = avUndoState;
  const status = { depth: st.undo.length, redo: st.redo.length, label: avUndoTopLabel() };
  try {
    const win = avUndoWin();
    if (win) {
      win.__avUndo = {
        version: AV_UNDO_VERSION,
        depth: status.depth,
        redo: status.redo,
        label: status.label,
        last: st.last,
        ab: !!st.ab,
        cap: AV_UNDO_CAP,
        bytes: st.bytes,
        domains: AV_UNDO_DOMAINS.slice(),
      };
    }
  } catch (e) { /* publish is a nicety */ }
  return status;
}

function avUndoStatus() {
  try {
    return { depth: avUndoState.undo.length, redo: avUndoState.redo.length, label: avUndoTopLabel() };
  } catch (e) {
    return { depth: 0, redo: 0, label: "" };
  }
}

/* ---------- the params burst (snapshot-on-quiet) ---------- */

function avUndoCancelTimer() {
  const t = avUndoState.paramsTimer;
  if (t != null && typeof clearTimeout === "function") {
    try { clearTimeout(t); } catch (e) { /* timer already gone */ }
  }
  avUndoState.paramsTimer = null;
}

function avUndoArmTimer() {
  avUndoCancelTimer();
  try {
    if (typeof setTimeout === "function") {
      avUndoState.paramsTimer = setTimeout(function () {
        avUndoState.paramsTimer = null;
        avUndoFlush();
      }, AV_UNDO_QUIET_MS);
    }
  } catch (e) { avUndoState.paramsTimer = null; }
}

function avUndoBurstLabel(paths) {
  if (!paths || !paths.length) return "params";
  return paths.length > 1 ? paths[0] + " +" + (paths.length - 1) : paths[0];
}

/* a funnel commit landed: open/extend the burst, re-arm the quiet timer */
function avUndoParamTap(path) {
  if (avUndoState.restoring) return;
  if (typeof path !== "string" || path === "") return;
  const st = avUndoState;
  if (!st.paramsDirty) {
    st.paramsDirty = true;
    st.paramsPaths = [];
  }
  const ps = st.paramsPaths;
  if (ps && ps.length < AV_UNDO_BURST_PATHS_MAX && ps.indexOf(path) < 0) ps.push(path);
  avUndoArmTimer();
}

/* belt: the 'av-param' window event avKnobCommit falls back to when no funnel exists */
function avUndoParamEvent(ev) {
  try {
    const d = ev && ev.detail;
    if (!d || typeof d.path !== "string") return;
    /* plock playback writes skip the params tap (their own domain tracks them) */
    if (d.from === "plock") return;
    const m = d.meta;
    if (m && (m.from === "plock" || m.plock === true || m.src === "plock")) return;
    avUndoParamTap(d.path);
  } catch (e) { /* never break the fan-out */ }
}

function avUndoBindParamEvent(win) {
  if (avUndoState.paramEventBound) return true;
  if (!win || typeof win.addEventListener !== "function") return false;
  try {
    win.addEventListener("av-param", avUndoParamEvent);
    avUndoState.paramEventBound = true;
  } catch (e) { /* stays unbound */ }
  return avUndoState.paramEventBound;
}

/* ---------- the commit funnel wrap (additive, idempotent, marker __avUndoWrap) ---------- */

function avUndoEnsureWrap() {
  if (avUndoState.wrapInstalled) return true;
  try {
    if (typeof avApplyParam === "function") {
      if (avApplyParam.__avUndoWrap === true) {          /* another install already wrapped */
        avUndoState.wrapInstalled = true;
        return true;
      }
      const orig = avApplyParam;
      const wrapped = function (path, v, meta) {
        /* plock playback writes skip the params tap (their own domain tracks them) */
        if (!meta || (meta.from !== "plock" && meta.plock !== true && meta.src !== "plock")) {
          try { avUndoParamTap(path); } catch (e) { /* never break the funnel */ }
        }
        return orig(path, v, meta);
      };
      wrapped.__avUndoWrap = true;
      avApplyParam = wrapped;
      avUndoState.wrapInstalled = true;
      return true;
    }
  } catch (e) { /* funnel unreachable — the event belt still can work */ }
  return false;
}

/* ---------- core stack machinery ---------- */

function avUndoPushInternal(domain, label) {
  const st = avUndoState;
  const snap = avUndoSnapDomain(domain);
  if (snap == null) return false;
  const base = st.baseline[domain];
  if (base === snap) return false;                       /* no change since the last checkpoint */
  if (base === undefined) {                              /* first-ever push for this domain */
    st.baseline[domain] = snap;
    st.last = "baseline:" + domain;
    avUndoPublish();
    return false;
  }
  const entry = {
    domain: domain,
    label: avUndoLabel(label, domain),
    before: base,
    after: snap,
    t: avUndoStamp(),
  };
  entry.bytes = avUndoEntryBytes(entry);
  if (st.redo.length) {                                  /* a new change clears the redo stack */
    for (let i = 0; i < st.redo.length; i++) st.bytes -= st.redo[i].bytes;
    st.redo = [];
  }
  st.undo.push(entry);
  st.bytes += entry.bytes;
  st.baseline[domain] = snap;
  avUndoEvict();
  st.last = "push:" + domain;
  avUndoPublish();
  return true;
}

function avUndoFlush() {
  try {
    const st = avUndoState;
    if (!st.paramsDirty) return false;
    avUndoCancelTimer();
    const paths = st.paramsPaths || [];
    st.paramsDirty = false;
    st.paramsPaths = null;
    return avUndoPushInternal("params", avUndoBurstLabel(paths));
  } catch (e) { return false; }
}

function avUndoPush(domain, label) {
  try {
    const d = avUndoDomainName(domain);
    if (!d) return false;
    avUndoEnsureWrap();          /* heal a late funnel if init ran before app_core */
    avUndoFlush();               /* close any pending params burst first (chronology) */
    return avUndoPushInternal(d, label);
  } catch (e) { return false; }
}

function avUndo() {
  try {
    avUndoEnsureWrap();
    avUndoFlush();               /* Ctrl+Z undoes the LATEST change, burst included */
    const st = avUndoState;
    const e = st.undo.pop();
    if (!e) return false;
    if (!avUndoApplyDomain(e.domain, e.before, e.after)) {
      st.undo.push(e);           /* a refused restore must not corrupt the history */
      return false;
    }
    st.redo.push(e);
    avUndoResyncBaseline(e.domain, e.before);
    st.last = "undo:" + e.domain;
    avUndoPublish();
    return true;
  } catch (err) { return false; }
}

function avRedo() {
  try {
    avUndoFlush();               /* a new un-flushed change kills redo, exactly like a recorded one */
    const st = avUndoState;
    const e = st.redo[st.redo.length - 1];
    if (!e) return false;
    if (!avUndoApplyDomain(e.domain, e.after, e.before)) return false;
    st.redo.pop();
    st.undo.push(e);
    avUndoResyncBaseline(e.domain, e.after);
    st.last = "redo:" + e.domain;
    avUndoPublish();
    return true;
  } catch (err) { return false; }
}

/* ---------- A/B (same domains; A store = reference, A recall = back to it) ---------- */

function avUndoAStore() {
  try {
    const snap = {};
    let n = 0;
    for (let i = 0; i < AV_UNDO_DOMAINS.length; i++) {
      const d = AV_UNDO_DOMAINS[i];
      const s = avUndoSnapDomain(d);
      if (s != null) { snap[d] = s; n++; }
    }
    if (!n) return false;
    avUndoState.ab = { t: avUndoStamp(), snap: snap };
    avUndoState.last = "a-store";
    avUndoPublish();
    return true;
  } catch (e) { return false; }
}

function avUndoARecall() {
  try {
    const st = avUndoState;
    const ab = st.ab;
    if (!ab || !ab.snap || typeof ab.snap !== "object") return false;
    if (ab.snap.params && st.paramsDirty) {     /* the recall overwrites the open burst */
      avUndoCancelTimer();
      st.paramsDirty = false;
      st.paramsPaths = null;
    }
    let ok = false;
    for (let i = 0; i < AV_UNDO_DOMAINS.length; i++) {
      const d = AV_UNDO_DOMAINS[i];
      const target = ab.snap[d];
      if (typeof target !== "string") continue;
      const cur = avUndoSnapDomain(d);
      if (avUndoApplyDomain(d, target, cur)) {
        avUndoResyncBaseline(d, target);        /* next push diffs from the recalled state */
        ok = true;
      }
    }
    st.last = "a-recall";
    avUndoPublish();
    return ok;
  } catch (e) { return false; }
}

/* ---------- keyboard ---------- */

function avUndoTextish(el) {
  if (!el || typeof el !== "object") return false;
  try {
    const tag = String(el.tagName || "").toUpperCase();
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag === "INPUT") {
      const ty = String(el.type == null ? "" : el.type).toLowerCase();
      if (ty === "range" || ty === "checkbox" || ty === "radio" || ty === "button" || ty === "submit" || ty === "file") return false;
      return true;                              /* text/search/email/url/tel/password/number/… */
    }
    if (el.isContentEditable === true) return true;
    if (typeof el.closest === "function") {
      /* belt: a keydown target nested inside a text-entry surface */
      const host = el.closest("input, textarea, select, [contenteditable]");
      if (host) return true;
    }
  } catch (e) { /* guarded read */ }
  return false;
}

function avUndoTextFocus(e) {
  const doc = avUndoDoc();
  if (doc && avUndoTextish(doc.activeElement)) return true;
  if (e && avUndoTextish(e.target)) return true;
  return false;
}

function avUndoKey(e) {
  try {
    if (!e || e.defaultPrevented) return;
    if (!(e.ctrlKey === true || e.metaKey === true)) return;
    if (e.altKey === true) return;
    const k = (typeof e.key === "string") ? e.key.toLowerCase() : "";
    if (k !== "z") return;
    if (avUndoTextFocus(e)) return;
    const ok = e.shiftKey === true ? avRedo() : avUndo();
    if (ok && typeof e.preventDefault === "function") e.preventDefault();
  } catch (e2) { /* never throw out of a key handler */ }
}

function avUndoBindKeys() {
  const st = avUndoState;
  if (st.keysBound) return true;
  const win = avUndoWin();
  if (!win || typeof win.addEventListener !== "function") return false;
  try {
    win.addEventListener("keydown", avUndoKey, true);
    st.keysBound = true;
  } catch (e) { /* stays unbound */ }
  return st.keysBound;
}

/* ---------- init ---------- */

function avUndoBaselineInit() {
  for (let i = 0; i < AV_UNDO_DOMAINS.length; i++) {
    const d = AV_UNDO_DOMAINS[i];
    if (avUndoState.baseline[d] !== undefined) continue;
    const s = avUndoSnapDomain(d);
    if (s != null) avUndoState.baseline[d] = s;
  }
}

function avUndoInit() {
  const win = avUndoWin();
  try { avUndoEnsureWrap(); } catch (e) { /* belt */ }   /* wrap works without window too */
  if (!win) return false;                                /* key bindings need a window */
  let ok = false;
  try {
    avUndoBindParamEvent(win);
    ok = avUndoBindKeys();
    avUndoBaselineInit();
    avUndoState.init = true;
    avUndoPublish();
  } catch (e) { ok = false; }
  return ok;
}
