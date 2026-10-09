/* av_session.js — Anvil S2 SESSIONS CORE (child sa-A, verify/_s2_wave.md §2.1): working-state
   snapshots — capture, apply, versioned saves on the pinned IDB store, and the autosave/recovery
   net. The module mounts nothing (sa-C owns the Sessions card markup).

   PUBLIC SURFACE (classic-script globals, ONE namespace avSession* / AV_SESSION_*):
     avSessionInit() -> bool              idempotent; no DOM; binds storage lazily (boots hydrate)
     avSessionCapture(opts?) -> state     the working-state snapshot (schema below; JSON-safe)
     avSessionApply(state) -> receipt     write path (laws below)
     avSessionSave(name?) -> Promise      capture -> new VERSION of the current session (creates
                                          on the first save; the ring keeps the last 16 versions)
     avSessionList() -> [{id,name,savedAt,updatedAt,version,current}]
     avSessionLoad(id) -> Promise         apply the session's NEWEST version + mark current
     avSessionDelete(id) -> bool          memory drop now; the durable drop is kicked (async)
     avSessionVersions(id?) -> [{version,savedAt,bytes}]
     avSessionRestore(id, version) -> Promise
     avSessionAutosave(on, ms?) -> {on, ms}      default 45000 ms; clamp 5000..600000
     avSessionState() -> state            the honest card state (§2.1 shape + a few extras)
     avSessionRecover() -> Promise        apply the autosave snapshot; clears the record
     avSessionDismissRecovery() -> bool
     avSessionExport() -> {v, sessions:[record...]}
     avSessionImport(payloadOrRecord) -> {ok, imported, skipped}   tolerant; id-dedupe
     avSessionTouch() -> bool             mark dirty (best-effort; the fingerprint also works)
     avSessionSetTags(id, tags) -> Promise  set a session's tags (max 8, each max 24 chars,
                                          lowercase-trimmed); persists via the record write path
     avSessionClasses() -> string[]       [] — this module mounts nothing
     avSessionHydrate() -> Promise<mode>  (extra: boot hydrate, idempotent, never rejects)
     window.__avSession -> { version, init, capture, apply, save, list, load, delete, versions,
                             restore, autosave, state, recover, export: avSessionExport,
                             import: avSessionImport }
                           + extras: touch, dismiss, classes, hydrate, setTags, flush

   STATE SCHEMA (v1, JSON-safe by construction):
     { v:1, name, savedAt,
       seq: { pattern: avSeqSnap(), chains: avSeqChainsSnap(), song: avSeqSongSnap(),
              scenes: avSeqScenesSnap() },          // each null when its module is absent
       params: { ...avParams clone },               // includes engine.kind when the app mirrors it
       mod: { macros: [8 numbers] },                // from avModPayload(); slot routing = Undetermined v1
       takesMeta: [...],                            // avTakesList() verbatim (metadata only — the
                                                    // take AUDIO is not session data)
       prefs: { inputGain, inputOffsetMs, metro:{ level, beatsPerBar, countIn } } }
   Unknown prefs read as null (never a fake 0 — a fake 0 would APPLY as a value).

   STORAGE (mirrors av_store's honest-backend pattern): IDB db `av-sessions-store`, object store
   `sessions` (keyPath id) — one record per session
   { id, name, createdAt, updatedAt, current, versions:[{ v, savedAt, state }] } (ring <= 16,
   newest last) plus the SINGLE record id `__autosave` { state, savedAt, name }. LS fallback key
   `av-sessions-ls` (JSON { v, sessions, autosave }; per session = meta + newest version only).
   The AUTOSAVE CHOICE (R20) persists separately in localStorage key `av-sessions-autosave`
   (JSON { v:1, on }): the seed never writes it, only an explicit avSessionAutosave(on) call
   does; without localStorage the choice cannot persist (honest). Session TAGS (R20) ride the
   record: an additive `tags` array (max 8, lowercase-trimmed, each max 24 chars).
   No storage at all -> memory last resort. Every receipt names the tier it actually used
   (`idb | ls | mem`) and a memory-only write is `volatile:true`. "Nothing durable → not saved":
   a refused durable write rolls the memory change back and resolves ok:false; only memory mode
   keeps the change (honest, flagged). Never throws.

   APPLY LAWS (mirror av_bank.js's apply core — read it first):
     (1) `seq` FIRST: avSeqLoad(pattern) + avSeqChainsLoad/SongLoad/ScenesLoad; then the canonical
         UI sync pair from av_bank's seq branch — avSeqSetPattern(core's own sanitised snapshot)
         + avSeqUiSync (a nicety) — then the `"seq"` undo checkpoint AFTER the load (P4 undo law;
         only when the pattern actually landed).
     (2) `engine.kind` before any other param.
     (3) EVERY param path rides the CURRENT avApplyParam binding (resolved per apply call — the
         av_mod / av_undo / av_plock wraps REASSIGN the funnel; a captured reference would go
         stale). Booleans normalise to 1/0; non-finite numbers / null / objects are refused and
         reported in `skipped` (counted, never thrown). Paths are dotted identifiers starting
         with a letter (`__proto__`-class keys never reach the funnel).
     (4) mod macros ride the same funnel (`mod.macro1..8` — av_mod's wrap owns those paths; when
         the funnel we called IS that wrap, its marker is the acceptance, the bank belt).
     (5) prefs go through their pinned setters only when the module is present (typeof-guarded):
         avInputGain, avInputOffset, avMetroSet({level,beatsPerBar}); prefs.metro.countIn has no
         sanctioned setter in v1 -> carried, never silently dropped as a refusal.
     (6) takesMeta is NOT applied — carried metadata (`carried` names it), never a skip.
     ok = at least one leg present AND zero skips AND seqOk (bank's full-acceptance law).

   DIRTY + AUTOSAVE (R20): dirty = the fingerprint changed -- the fingerprint now covers the
   FULL avSessionCapture() surface: avSeqPatternExport() (full pattern copy, steps included) +
   JSON of { params, mod.macros } + takesMeta JSON + JSON of { chains, song, scenes } + prefs
   JSON (every leg guarded, never throws). avSessionTouch() marks dirty eagerly. Save/load/
   restore/recover re-base the fingerprint. SEEDING: at hydrate end autosave seeds ON when the
   store holds >= 1 session or the persisted choice is on; a virgin store seeds OFF; after the
   FIRST successful avSessionSave with no explicit choice yet, autosave flips ON (an explicit
   off outranks). The tick (timer at `ms`, only while on) writes the ONE `__autosave` record
   ({ state, savedAt, name }) only when dirty; a landed write stamps lastAutosaveAt; a refused
   write stays dirty (honest). A document `visibilitychange` -> hidden flush writes that same
   ONE record immediately when on and dirty, then rearms (guarded, silent). Boot performs no
   write (the baseline is set post-hydrate).

   RECOVERY: hydrate finds the `__autosave` record -> recovery.available with savedAt/name; the
   offer NEVER auto-applies. avSessionRecover() = apply its state + clear the record durably +
   note "recovered"; avSessionDismissRecovery() drops offer + record.

   LAWS (verify/_s2_wave.md §3): "use strict"; node-loadable (no DOM/browser reach at load — the
   only top-level browser touch is the guarded typeof window publish at the end); never throws;
   no console noise; bounded growth (16 versions/session, ONE autosave record, notes capped).

   v1 notes: save() versions the CURRENT session (the pin — "(creates on first save)"); further
   sessions arrive via avSessionImport (the backup child's restore path). v1 trusts the seq snap
   family for detachment (their contract: fresh deep copies). Delete is memory-first (the pinned
   `-> bool`); a delete made while no DB is up is honoured at the next hydrate (never resurrected). */

"use strict";

/* ---------- pins (§2.1) ---------- */

const AV_SESSION_VERSION = "s2.0";
const AV_SESSION_STATE_V = 1;
const AV_SESSION_DB = "av-sessions-store";          /* pinned IDB name (§2.1) */
const AV_SESSION_DB_VER = 1;
const AV_SESSION_OS = "sessions";                   /* object store, keyPath "id" */
const AV_SESSION_LS = "av-sessions-ls";             /* localStorage fallback key (§2.1) */
const AV_SESSION_MODES = ["idb", "ls", "mem"];      /* reportable backends */
const AV_SESSION_AUTOSAVE_ID = "__autosave";        /* the ONE autosave record id */
const AV_SESSION_VERSIONS_MAX = 16;                 /* the ring bound (§2.1) */
const AV_SESSION_AUTOSAVE_DEF_MS = 45000;
const AV_SESSION_AUTOSAVE_MIN_MS = 5000;
const AV_SESSION_AUTOSAVE_MAX_MS = 600000;
const AV_SESSION_AUTO_LS = "av-sessions-autosave";  /* the EXPLICIT autosave choice (localStorage;
                                                       JSON {v:1,on}; the only persisted choice) */
const AV_SESSION_TAG_MAX = 8;                       /* session tags (R20): max 8 per session */
const AV_SESSION_TAG_LEN = 24;                      /* max 24 chars each (lowercase-trimmed)   */
const AV_SESSION_OPEN_CAP_MS = 1800;                /* hung-open give-up (the av_store cap) */
const AV_SESSION_NAME_CAP = 40;
const AV_SESSION_ID_CAP = 64;
const AV_SESSION_NOTES_CAP = 8;                     /* bounded state (no unbounded logs) */
const AV_SESSION_IMPORT_MAX = 1000;                 /* hostile-payload loop guard */
const AV_SESSION_MACRO_COUNT = 8;                   /* av_mod's pinned macro count */
const AV_SESSION_UNDO_LABEL = "session load";       /* the "seq" checkpoint label (P4 undo law) */
/* a §2.1 path is a dotted identifier starting with a letter — the belt keeps `__proto__`-class
   keys out of the funnel (identical to av_bank's AV_BANK_PATH_RE) */
const AV_SESSION_PATH_RE = /^[A-Za-z][A-Za-z0-9_.-]*$/;
/* av_mod's wrap turf; when that wrap is the funnel we called, its marker is the acceptance */
const AV_SESSION_MOD_MACRO_RE = /^mod\.macro[1-8]$/;
const AV_SESSION_CLASSES = Object.freeze([]);       /* this module mounts nothing */

/* ---------- module state (single source of truth; never holds DOM nodes) ---------- */

const avSession = {
  inited: false,
  hydrated: false,
  hydratePromise: null,
  backend: "mem",            /* 'idb' | 'ls' | 'mem' — stays honest */
  sessions: {},              /* id -> record {id,name,createdAt,updatedAt,current,versions} */
  currentId: null,
  db: null,
  dbGaveUp: false,
  dropped: {},               /* ids deleted while no DB was up; honoured at hydrate (never resurrected) */
  autoRec: null,             /* the latest __autosave record seen/written {id,state,savedAt,name} */
  recovery: null,            /* {available,savedAt,name,at,state} — the offer (never auto-applied) */
  auto: { on: false, ms: AV_SESSION_AUTOSAVE_DEF_MS },
  autoChoice: null,          /* the EXPLICIT on/off choice (true|false) or null (never chosen) */
  flushBound: false,         /* the visibilitychange listener is bound once per page */
  timer: null,
  lastAutosaveAt: 0,
  baseFp: null,              /* the dirty baseline fingerprint (post-hydrate) */
  touchDirty: false,         /* avSessionTouch()'s eager flag */
  notes: [],                 /* bounded strings ("recovered", ...) */
  lastApply: null,
  lastSave: null,
  lastLoad: null,
  lastError: null,
};

/* ---------- guarded environment reaches (plain node has none of these) ---------- */

function avSessionLs() {
  try { if (typeof localStorage !== "undefined" && localStorage) return localStorage; } catch (e) { /* blocked */ }
  try { const w = (typeof window !== "undefined") ? window : null; if (w && w.localStorage) return w.localStorage; } catch (e) { /* blocked */ }
  return null;
}

function avSessionIdb() {
  try { if (typeof indexedDB !== "undefined" && indexedDB) return indexedDB; } catch (e) { /* none */ }
  try { const w = (typeof window !== "undefined") ? window : null; if (w && w.indexedDB) return w.indexedDB; } catch (e) { /* none */ }
  return null;
}

function avSessionTimer(fn, ms) {
  try { if (typeof setTimeout === "function") return setTimeout(fn, ms); } catch (e) { /* no timers */ }
  return null;
}

function avSessionClear(t) {
  try { if (t != null && typeof clearTimeout === "function") clearTimeout(t); } catch (e) { /* no timers */ }
}

function avSessionNow() {
  try { return Date.now(); } catch (e) { return 0; }
}

function avSessionErrName(e) { try { return (e && e.name) ? String(e.name) : ""; } catch (e2) { return ""; } }
function avSessionErrMsg(e) { try { const s = (e && e.message) ? String(e.message) : String(e); return s.slice(0, 120); } catch (e2) { return "error"; } }

/* ---------- tiny value laws (garbage in, sane value out — never throw) ---------- */

function avSessionObj(v) {
  return (v !== null && typeof v === "object" && !Array.isArray(v));
}

function avSessionText(v, cap, dflt) {
  try {
    if (typeof v === "number") { if (!isFinite(v)) return dflt; v = String(v); }
    if (typeof v !== "string") return dflt;
    const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, cap || 80);
    return s || dflt;
  } catch (e) { return dflt; }
}

function avSessionNum(v, dflt, lo, hi) {
  try {
    const n = Number(v);
    if (v == null || v === "" || !isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  } catch (e) { return dflt; }
}

function avSessionInt(v, dflt, lo, hi) {
  try {
    const n = Number(v);
    if (v == null || v === "" || !isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, Math.round(n)));
  } catch (e) { return dflt; }
}

function avSessionBit(v) {
  try {
    if (v === 1 || v === true || v === "1") return 1;
    if (v == null || v === 0 || v === false || v === "0") return 0;
    const n = Number(v);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(1, Math.round(n)));
  } catch (e) { return 0; }
}

/* JSON-safe deep copy (states/records are JSON-safe by construction); null when unserialisable */
function avSessionClone(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; }
}

/* ---------- capture pieces (§2.1 schema) ---------- */

/* the avParams mirror clone: JSON-safe primitives only, §2.1 path shape only (mirrors av_bank's
   belt — `__proto__`-class keys never enter a state) */
function avSessionParamsSnap() {
  const out = {};
  try {
    if (typeof avParams === "undefined" || !avParams || typeof avParams !== "object") return out;
    const keys = Object.keys(avParams);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (typeof k !== "string" || !AV_SESSION_PATH_RE.test(k)) continue;
      const v = avParams[k], t = typeof v;
      if (t === "number") { if (isFinite(v)) out[k] = v; continue; }
      if (t === "string" || t === "boolean" || v === null) out[k] = v;
    }
  } catch (e) { /* mirror unreachable — {} is the honest empty */ }
  return out;
}

/* macros from avModPayload() — exactly 8 clamped 0..1 numbers (zeros when av_mod is absent) */
function avSessionMacrosSnap() {
  const out = [0, 0, 0, 0, 0, 0, 0, 0];
  try {
    if (typeof avModPayload === "function") {
      const p = avModPayload();
      const m = (p && typeof p === "object") ? p.macros : null;
      if (m && typeof m.length === "number") {
        for (let i = 0; i < AV_SESSION_MACRO_COUNT && i < m.length; i++) {
          const v = Number(m[i]);
          out[i] = isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
        }
      }
    }
  } catch (e) { /* not loaded — zeros */ }
  return out;
}

/* takesMeta = avTakesList() verbatim (a fresh copy; metadata only) */
function avSessionTakesSnap() {
  const out = [];
  try {
    if (typeof avTakesList === "function") {
      const list = avTakesList();
      if (Array.isArray(list)) {
        for (let i = 0; i < list.length; i++) {
          const c = avSessionClone(list[i]);
          if (c !== null && avSessionObj(c)) out.push(c);
        }
      }
    }
  } catch (e) { /* not loaded — [] */ }
  return out;
}

/* number-or-null reader (a fake 0 would APPLY as a value — null is the honest unknown) */
function avSessionNumOrNull(v) {
  try {
    if (typeof v === "number") return isFinite(v) ? v : null;
    return null;
  } catch (e) { return null; }
}

function avSessionPrefsSnap() {
  const prefs = {
    inputGain: null,
    inputOffsetMs: null,
    metro: { level: null, beatsPerBar: null, countIn: null },
  };
  try {
    if (typeof avInputState === "function") {
      const s = avInputState();
      if (s && typeof s === "object") {
        prefs.inputGain = avSessionNumOrNull(s.gain);
        prefs.inputOffsetMs = avSessionNumOrNull(s.offsetMs);
      }
    }
  } catch (e) { /* input module absent — nulls stand */ }
  try {
    if (typeof avMetroState === "function") {
      const m = avMetroState();
      if (m && typeof m === "object") {
        prefs.metro.level = avSessionNumOrNull(m.level);
        prefs.metro.beatsPerBar = avSessionNumOrNull(m.beatsPerBar);
      }
    }
  } catch (e) { /* metro module absent — nulls stand */ }
  try {
    /* countIn is the Studio card's default count-in bars (0..2); captured when reachable */
    if (typeof avStudioUiSnap === "function") {
      const su = avStudioUiSnap();
      if (su && typeof su === "object") {
        const n = Number(su.countIn);
        if (isFinite(n)) prefs.metro.countIn = Math.max(0, Math.min(2, Math.round(n)));
      }
    }
  } catch (e) { /* studio ui absent — null stands */ }
  return prefs;
}

/* the seq family resolver (belt 1: binding, belt 2: window property) — resolved per call */
function avSessionSeqFns() {
  const out = {
    load: null, set: null, ui: null, snap: null,
    chainsLoad: null, songLoad: null, scenesLoad: null,
    chainsSnap: null, songSnap: null, scenesSnap: null,
  };
  try {
    if (typeof avSeqLoad === "function") out.load = avSeqLoad;
    if (typeof avSeqSetPattern === "function") out.set = avSeqSetPattern;
    if (typeof avSeqUiSync === "function") out.ui = avSeqUiSync;
    if (typeof avSeqSnap === "function") out.snap = avSeqSnap;
    if (typeof avSeqChainsLoad === "function") out.chainsLoad = avSeqChainsLoad;
    if (typeof avSeqSongLoad === "function") out.songLoad = avSeqSongLoad;
    if (typeof avSeqScenesLoad === "function") out.scenesLoad = avSeqScenesLoad;
    if (typeof avSeqChainsSnap === "function") out.chainsSnap = avSeqChainsSnap;
    if (typeof avSeqSongSnap === "function") out.songSnap = avSeqSongSnap;
    if (typeof avSeqScenesSnap === "function") out.scenesSnap = avSeqScenesSnap;
  } catch (e) { /* not injected */ }
  try {
    if (typeof window !== "undefined" && window) {
      if (!out.load && typeof window.avSeqLoad === "function") out.load = window.avSeqLoad;
      if (!out.set && typeof window.avSeqSetPattern === "function") out.set = window.avSeqSetPattern;
      if (!out.ui && typeof window.avSeqUiSync === "function") out.ui = window.avSeqUiSync;
      if (!out.snap && typeof window.avSeqSnap === "function") out.snap = window.avSeqSnap;
      if (!out.chainsLoad && typeof window.avSeqChainsLoad === "function") out.chainsLoad = window.avSeqChainsLoad;
      if (!out.songLoad && typeof window.avSeqSongLoad === "function") out.songLoad = window.avSeqSongLoad;
      if (!out.scenesLoad && typeof window.avSeqScenesLoad === "function") out.scenesLoad = window.avSeqScenesLoad;
      if (!out.chainsSnap && typeof window.avSeqChainsSnap === "function") out.chainsSnap = window.avSeqChainsSnap;
      if (!out.songSnap && typeof window.avSeqSongSnap === "function") out.songSnap = window.avSeqSongSnap;
      if (!out.scenesSnap && typeof window.avSeqScenesSnap === "function") out.scenesSnap = window.avSeqScenesSnap;
    }
  } catch (e) { /* no window */ }
  return out;
}

function avSessionSeqCall(fn) {
  try { if (typeof fn === "function") { const s = fn(); if (avSessionObj(s)) return avSessionClone(s); } } catch (e) { /* refuse */ }
  return null;
}

function avSessionSeqSnap() {
  const f = avSessionSeqFns();
  return {
    pattern: avSessionSeqCall(f.snap),
    chains: avSessionSeqCall(f.chainsSnap),
    song: avSessionSeqCall(f.songSnap),
    scenes: avSessionSeqCall(f.scenesSnap),
  };
}

/* the current session's name (null when none) */
function avSessionCurrentName() {
  try {
    const id = avSession.currentId;
    const rec = id ? avSession.sessions[id] : null;
    return rec ? rec.name : null;
  } catch (e) { return null; }
}

/* ---------- avSessionCapture (§2.1) ---------- */

function avSessionCapture(opts) {
  try {
    const o = avSessionObj(opts) ? opts : {};
    const wantName = avSessionText(o.name, AV_SESSION_NAME_CAP, "");
    return {
      v: AV_SESSION_STATE_V,
      name: wantName || avSessionCurrentName() || null,
      savedAt: avSessionNow(),
      seq: avSessionSeqSnap(),
      params: avSessionParamsSnap(),
      mod: { macros: avSessionMacrosSnap() },
      takesMeta: avSessionTakesSnap(),
      prefs: avSessionPrefsSnap(),
    };
  } catch (e) {
    /* the schema stands even when everything else refused */
    return {
      v: AV_SESSION_STATE_V, name: null, savedAt: 0,
      seq: { pattern: null, chains: null, song: null, scenes: null },
      params: {}, mod: { macros: [0, 0, 0, 0, 0, 0, 0, 0] }, takesMeta: [],
      prefs: { inputGain: null, inputOffsetMs: null, metro: { level: null, beatsPerBar: null, countIn: null } },
    };
  }
}

/* ---------- the apply core (mirrors av_bank.js) ---------- */

function avSessionFunnel() {
  try { if (typeof avApplyParam === "function") return avApplyParam; } catch (e) { /* not injected */ }
  try { if (typeof window !== "undefined" && window && typeof window.avApplyParam === "function") return window.avApplyParam; } catch (e) { /* no window */ }
  return null;
}

/* §2.1 values: finite numbers as-is; strings as-is; booleans -> 1/0; everything else refuses */
function avSessionValueNorm(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

/* ordered, validated param rows: `engine.kind` FIRST (mirrors av_bankPatchRows) */
function avSessionParamRows(params) {
  const rows = [], refused = [];
  if (params == null) return { rows: rows, refused: refused, bad: false };
  if (!avSessionObj(params)) return { rows: rows, refused: refused, bad: true };
  let keys = [];
  try { keys = Object.keys(params); } catch (e) { keys = []; }
  const order = [];
  for (let i = 0; i < keys.length; i++) if (keys[i] !== "engine.kind") order.push(keys[i]);
  if (keys.indexOf("engine.kind") >= 0) order.unshift("engine.kind");
  for (let i = 0; i < order.length; i++) {
    const path = order[i];
    if (typeof path !== "string" || !AV_SESSION_PATH_RE.test(path)) { refused.push(String(path)); continue; }
    const v = avSessionValueNorm(params[path]);
    if (v === null) { refused.push(path); continue; }
    rows.push({ path: path, v: v });
  }
  return { rows: rows, refused: refused, bad: false };
}

/* state.mod -> [8 clamped numbers] | null (an invalid container is one counted refusal handled
   by the caller) */
function avSessionMacroList(mod) {
  if (!avSessionObj(mod)) return null;
  const m = mod.macros;
  if (!Array.isArray(m) || m.length < AV_SESSION_MACRO_COUNT) return null;
  const out = [];
  for (let i = 0; i < AV_SESSION_MACRO_COUNT; i++) {
    const v = Number(m[i]);
    if (!isFinite(v)) return null;
    out.push(Math.max(0, Math.min(1, v)));
  }
  return out;
}

/* the seq leg (§2.1 law 1): pattern load FIRST, then chains/song/scenes loads, then the canonical
   UI sync pair (av_bank's seq branch: avSeqSetPattern of the CORE's own sanitised snapshot +
   avSeqUiSync), then the "seq" undo checkpoint AFTER the load (P4 undo law). Returns the leg
   count contributed (0|1); failures land in receipt.skipped and clear receipt.seqOk. */
function avSessionSeqLegLand(value, fn) {
  if (!avSessionObj(value)) return false;
  if (typeof fn !== "function") return false;
  let ok = false;
  try { ok = fn(value) === true; } catch (e) { ok = false; }
  return ok;
}

function avSessionSeqApply(seq, receipt) {
  const out = { pattern: null, chains: null, song: null, scenes: null };
  receipt.seq = out;
  if (!avSessionObj(seq)) {
    receipt.skipped.push("seq");
    receipt.seqOk = false;
    return 0;
  }
  let legs = 0;
  const f = avSessionSeqFns();
  let patternLanded = false;
  if (seq.pattern != null) {
    legs = 1;
    if (!avSessionObj(seq.pattern)) { out.pattern = false; receipt.skipped.push("seq.pattern"); receipt.seqOk = false; }
    else if (typeof f.load !== "function" || typeof f.set !== "function") { out.pattern = false; receipt.skipped.push("seq.pattern"); receipt.seqOk = false; }
    else {
      let ok = false;
      try { ok = f.load(seq.pattern) === true; } catch (e) { ok = false; }
      if (!ok) { out.pattern = false; receipt.skipped.push("seq.pattern"); receipt.seqOk = false; }
      else patternLanded = true;
    }
  }
  if (seq.chains != null) {
    legs = 1;
    if (avSessionSeqLegLand(seq.chains, f.chainsLoad)) { out.chains = true; receipt.applied += 1; }
    else { out.chains = false; receipt.skipped.push("seq.chains"); receipt.seqOk = false; }
  }
  if (seq.song != null) {
    legs = 1;
    if (avSessionSeqLegLand(seq.song, f.songLoad)) { out.song = true; receipt.applied += 1; }
    else { out.song = false; receipt.skipped.push("seq.song"); receipt.seqOk = false; }
  }
  if (seq.scenes != null) {
    legs = 1;
    if (avSessionSeqLegLand(seq.scenes, f.scenesLoad)) { out.scenes = true; receipt.applied += 1; }
    else { out.scenes = false; receipt.skipped.push("seq.scenes"); receipt.seqOk = false; }
  }
  /* the UI sync pair — only after a landed pattern load (bank law: load+set are the leg) */
  if (patternLanded) {
    let norm = seq.pattern;
    try { if (typeof f.snap === "function") { const s = f.snap(); if (avSessionObj(s)) norm = s; } } catch (e) { /* raw seq stands */ }
    let setOk = false;
    try { setOk = f.set(norm) !== false; } catch (e) { setOk = false; }
    if (!setOk) { out.pattern = false; receipt.skipped.push("seq.pattern"); receipt.seqOk = false; }
    else {
      out.pattern = true;
      receipt.applied += 1;
      try { if (typeof f.ui === "function") f.ui(); } catch (e) { /* repaint is a nicety — the pattern landed */ }
      /* P4 undo law: the checkpoint lands AFTER the change; the previous checkpoint becomes before */
      try { if (typeof avUndoPush === "function") avUndoPush("seq", AV_SESSION_UNDO_LABEL); } catch (e) { /* F optional */ }
    }
  }
  return legs;
}

/* the prefs leg (§2.1 law 5): pinned setters only, typeof-guarded; countIn is carried (no
   sanctioned setter in v1). Returns the leg count contributed (0|1). */
function avSessionPrefsApply(prefs, receipt) {
  if (!avSessionObj(prefs)) {
    receipt.skipped.push("prefs");
    return 0;
  }
  let legs = 0;
  const gain = avSessionNumOrNull(prefs.inputGain);
  if (gain !== null) {
    legs = 1;
    if (typeof avInputGain === "function") {
      try { avInputGain(gain); receipt.applied += 1; } catch (e) { receipt.skipped.push("prefs.inputGain"); }
    } else receipt.skipped.push("prefs.inputGain");
  } else if (prefs.inputGain !== undefined && prefs.inputGain !== null) {
    legs = 1; receipt.skipped.push("prefs.inputGain");
  }
  const off = avSessionNumOrNull(prefs.inputOffsetMs);
  if (off !== null) {
    legs = 1;
    if (typeof avInputOffset === "function") {
      try { avInputOffset(off); receipt.applied += 1; } catch (e) { receipt.skipped.push("prefs.inputOffsetMs"); }
    } else receipt.skipped.push("prefs.inputOffsetMs");
  } else if (prefs.inputOffsetMs !== undefined && prefs.inputOffsetMs !== null) {
    legs = 1; receipt.skipped.push("prefs.inputOffsetMs");
  }
  const metro = prefs.metro;
  if (avSessionObj(metro)) {
    const lvl = avSessionNumOrNull(metro.level);
    const bpb = avSessionNumOrNull(metro.beatsPerBar);
    if (lvl !== null || bpb !== null) {
      legs = 1;
      const patch = {};
      if (lvl !== null) patch.level = lvl;
      if (bpb !== null) patch.beatsPerBar = bpb;
      if (typeof avMetroSet === "function") {
        let ok = false;
        try { const r = avMetroSet(patch); ok = (r !== false && r != null); } catch (e) { ok = false; }
        if (ok) receipt.applied += 1; else receipt.skipped.push("prefs.metro");
      } else receipt.skipped.push("prefs.metro");
    } else if ((metro.level !== undefined && metro.level !== null) || (metro.beatsPerBar !== undefined && metro.beatsPerBar !== null)) {
      legs = 1; receipt.skipped.push("prefs.metro");
    }
    /* no sanctioned setter in v1 -> carried, honest (NOT a refusal) */
    if (avSessionNumOrNull(metro.countIn) !== null) receipt.carried.push("prefs.metro.countIn");
  }
  return legs;
}

/* avSessionApply(state) -> { ok, applied, skipped, carried, seq, seqOk, error }
   Never throws; every refusal is counted in `skipped`, every carried-not-applied item in
   `carried`; ok = at least one leg AND zero skips AND the seq leg fully landed. */
function avSessionApply(state) {
  const receipt = { ok: false, applied: 0, skipped: [], carried: [], seq: null, seqOk: true, error: null };
  avSession.lastApply = receipt;
  try {
    if (!avSessionObj(state)) { receipt.error = "not a state object"; return receipt; }
    let legs = 0;
    /* (1) seq FIRST */
    if (state.seq != null) legs += avSessionSeqApply(state.seq, receipt);
    /* (2)+(3) params — engine.kind first, every path through the CURRENT funnel binding */
    const parsed = avSessionParamRows(state.params);
    const funnel = avSessionFunnel();
    if (parsed.bad) {
      receipt.skipped.push("params");
    } else if (parsed.rows.length > 0) {
      legs = 1;
      for (let i = 0; i < parsed.rows.length; i++) {
        const row = parsed.rows[i];
        if (!funnel) { receipt.skipped.push(row.path); continue; }
        let rv = false;
        try { rv = funnel(row.path, row.v, { from: "session" }); } catch (e) { rv = false; }
        let accepted = rv !== false;
        /* av_mod's wrap owns exactly mod.macro1..8: when the funnel we called IS that wrap, the
           macro landed model-side even if the passthrough's engine leg said false (bank belt) */
        if (!accepted && AV_SESSION_MOD_MACRO_RE.test(row.path) && funnel.__avModWrap === true) accepted = true;
        if (accepted) receipt.applied += 1; else receipt.skipped.push(row.path);
      }
      for (let i = 0; i < parsed.refused.length; i++) receipt.skipped.push(parsed.refused[i]);
    } else if (parsed.refused.length) {
      for (let i = 0; i < parsed.refused.length; i++) receipt.skipped.push(parsed.refused[i]);
    }
    /* (4) mod macros via the funnel (same acceptance belt) */
    if (state.mod != null) {
      const macros = avSessionMacroList(state.mod);
      if (macros === null) {
        receipt.skipped.push("mod.macros");
      } else {
        legs = 1;
        for (let i = 0; i < AV_SESSION_MACRO_COUNT; i++) {
          const path = "mod.macro" + (i + 1);
          if (!funnel) { receipt.skipped.push(path); continue; }
          let rv = false;
          try { rv = funnel(path, macros[i], { from: "session" }); } catch (e) { rv = false; }
          let accepted = rv !== false;
          if (!accepted && AV_SESSION_MOD_MACRO_RE.test(path) && funnel.__avModWrap === true) accepted = true;
          if (accepted) receipt.applied += 1; else receipt.skipped.push(path);
        }
      }
    }
    /* (5) prefs via their pinned setters */
    if (state.prefs != null) legs += avSessionPrefsApply(state.prefs, receipt);
    /* (6) takesMeta is NOT applied — carried metadata only */
    if (Array.isArray(state.takesMeta) && state.takesMeta.length > 0) receipt.carried.push("takesMeta");
    receipt.ok = (legs > 0) && receipt.skipped.length === 0 && receipt.seqOk === true;
    return receipt;
  } catch (e) {
    receipt.error = avSessionErrMsg(e);
    receipt.ok = false;
    return receipt;
  }
}

/* ---------- dirty fingerprint (§2.1) ---------- */

/* the dirty fingerprint (R20 coverage law): it must flip on EVERY surface avSessionCapture()
   writes -- pattern (the full export copy, steps included), params, mod.macros, takesMeta,
   seq chains/song/scenes and prefs. Each leg is typeof-guarded and never throws; an absent
   module contributes a stable empty leg (absent is not dirty). */
function avSessionFingerprint() {
  let a = "", b = "", c = "", d = "", e = "";
  try { a = (typeof avSeqPatternExport === "function") ? String(avSeqPatternExport() || "") : ""; } catch (e) { a = ""; }
  try { b = JSON.stringify({ params: avSessionParamsSnap(), mod: { macros: avSessionMacrosSnap() } }); } catch (e) { b = ""; }
  try { c = JSON.stringify(avSessionTakesSnap()); } catch (e) { c = ""; }
  try {
    const f = avSessionSeqFns();
    d = JSON.stringify({ chains: avSessionSeqCall(f.chainsSnap), song: avSessionSeqCall(f.songSnap), scenes: avSessionSeqCall(f.scenesSnap) });
  } catch (e) { d = ""; }
  try { e = JSON.stringify(avSessionPrefsSnap()); } catch (e) { e = ""; }
  if (typeof b !== "string") b = "";
  if (typeof c !== "string") c = "";
  if (typeof d !== "string") d = "";
  if (typeof e !== "string") e = "";
  return a + "\n" + b + "\n" + c + "\n" + d + "\n" + e;
}

function avSessionDirty() {
  try {
    const st = avSession;
    if (st.touchDirty === true) return true;
    if (st.baseFp == null) return false;                 /* no baseline yet — nothing provable */
    return avSessionFingerprint() !== st.baseFp;
  } catch (e) { return false; }
}

function avSessionMarkBaseline() {
  try { avSession.baseFp = avSessionFingerprint(); } catch (e) { avSession.baseFp = null; }
  avSession.touchDirty = false;
}

function avSessionPushNote(text) {
  try {
    avSession.notes.push(String(text));
    while (avSession.notes.length > AV_SESSION_NOTES_CAP) avSession.notes.shift();
  } catch (e) { /* notes are a nicety */ }
}

/* ---------- IndexedDB plumbing (promise-wrapped, never throws — av_store's discipline) ---------- */

function avSessionDbOpen() {
  return new Promise(function (res) {
    let capTimer = null;
    try {
      const st = avSession;
      if (st.db) return res(st.db);
      if (st.dbGaveUp) return res(null);
      const idb = avSessionIdb();
      if (!idb) return res(null);
      let settled = false;
      const give = function (v) { if (!settled) { settled = true; res(v); } };
      /* a hung open (blocked upgrade) must not wedge the sessions core: give up after 1.8 s */
      capTimer = avSessionTimer(function () { avSession.dbGaveUp = true; give(null); }, AV_SESSION_OPEN_CAP_MS);
      const rq = idb.open(AV_SESSION_DB, AV_SESSION_DB_VER);
      rq.onupgradeneeded = function () {
        try {
          const db = rq.result;
          if (!db.objectStoreNames || !db.objectStoreNames.contains(AV_SESSION_OS)) db.createObjectStore(AV_SESSION_OS, { keyPath: "id" });
        } catch (e) { /* upgrade raced */ }
      };
      rq.onsuccess = function () {
        avSessionClear(capTimer);
        if (avSession.dbGaveUp) { try { rq.result.close(); } catch (e) { /* ignore */ } return give(null); }
        const db = rq.result;
        st.db = db;
        try { db.onclose = function () { if (avSession.db === db) avSession.db = null; }; } catch (e) { /* fine */ }
        give(db);
      };
      rq.onerror = function () { avSessionClear(capTimer); give(null); };
      rq.onblocked = function () { avSessionClear(capTimer); give(null); };
    } catch (e) { avSessionClear(capTimer); res(null); }
  });
}

function avSessionDbAll(db) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_SESSION_OS, "readonly");
      const rq = tx.objectStore(AV_SESSION_OS).getAll();
      rq.onsuccess = function () { res(rq.result || []); };
      rq.onerror = function () { res(null); };
      tx.onerror = function () { res(null); };
    } catch (e) { res(null); }
  });
}

function avSessionDbWrite(db, rec) {
  return new Promise(function (res, rej) {
    try {
      const tx = db.transaction(AV_SESSION_OS, "readwrite");
      tx.objectStore(AV_SESSION_OS).put(rec);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { rej((tx.error) || new Error("idb write failed")); };
      tx.onabort = function () { rej((tx.error) || new Error("idb write aborted")); };
    } catch (e) { rej(e); }
  });
}

function avSessionDbRemove(db, id) {
  return new Promise(function (res) {
    try {
      const tx = db.transaction(AV_SESSION_OS, "readwrite");
      tx.objectStore(AV_SESSION_OS).delete(id);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { res(false); };
      tx.onabort = function () { res(false); };
    } catch (e) { res(false); }
  });
}

/* ---------- record normalisation (garbage in -> null / cleaned record out) ---------- */

/* session tags (R20, additive meta): <= 8 tags, each <= 24 chars, lowercase-trimmed, deduped;
   garbage in -> [] (never throws) */
function avSessionTagsNorm(v) {
  const out = [];
  try {
    if (!Array.isArray(v)) return out;
    for (let i = 0; i < v.length && out.length < AV_SESSION_TAG_MAX; i++) {
      let t = "";
      try {
        t = String(v[i] == null ? "" : v[i]).replace(/[\u0000-\u001f\u007f]/g, "");
        t = t.replace(/\s+/g, " ").trim().toLowerCase().slice(0, AV_SESSION_TAG_LEN);
      } catch (e) { t = ""; }
      if (!t) continue;
      let dup = false;
      for (let j = 0; j < out.length; j++) if (out[j] === t) { dup = true; break; }
      if (!dup) out.push(t);
    }
  } catch (e) { return []; }
  return out;
}

function avSessionVersionNorm(raw) {
  if (!avSessionObj(raw)) return null;
  if (!avSessionObj(raw.state)) return null;
  const state = avSessionClone(raw.state);
  if (!avSessionObj(state)) return null;
  const v = Math.round(Number(raw.v));
  return {
    v: (isFinite(v) && v >= 1) ? v : 0,
    savedAt: avSessionNum(raw.savedAt, 0, 0, 9e15),
    state: state,
  };
}

function avSessionRecordNorm(raw) {
  if (!avSessionObj(raw)) return null;
  let id = "";
  try {
    id = (typeof raw.id === "string") ? raw.id.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, AV_SESSION_ID_CAP) : "";
  } catch (e) { id = ""; }
  if (!id || id === AV_SESSION_AUTOSAVE_ID) return null;   /* the autosave id is reserved */
  const createdAt = avSessionNum(raw.createdAt, 0, 0, 9e15);
  const updatedAt = avSessionNum(raw.updatedAt, createdAt, 0, 9e15);
  const versions = [];
  const rawV = Array.isArray(raw.versions) ? raw.versions : [];
  for (let i = 0; i < rawV.length; i++) {
    const vv = avSessionVersionNorm(rawV[i]);
    if (!vv) continue;
    if (vv.v === 0) vv.v = i + 1;
    versions.push(vv);
  }
  versions.sort(function (a, b) { return a.v - b.v; });
  while (versions.length > AV_SESSION_VERSIONS_MAX) versions.shift();   /* keep the newest */
  return {
    id: id,
    name: avSessionText(raw.name, AV_SESSION_NAME_CAP, "Session"),
    createdAt: createdAt,
    updatedAt: updatedAt,
    current: avSessionBit(raw.current) === 1,
    tags: avSessionTagsNorm(raw.tags),
    versions: versions,
  };
}

/* a detached copy for storage/export ({id,name,createdAt,updatedAt,current,versions:[{v,savedAt,
   state}]}); null when a state cannot be serialised */
function avSessionRecordForStore(rec) {
  try {
    const out = {
      id: rec.id, name: rec.name, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
      current: rec.current === true, tags: avSessionTagsNorm(rec.tags), versions: [],
    };
    for (let i = 0; i < rec.versions.length; i++) {
      const vv = rec.versions[i];
      const state = avSessionClone(vv.state);
      if (!state) return null;
      out.versions.push({ v: vv.v, savedAt: vv.savedAt, state: state });
    }
    return out;
  } catch (e) { return null; }
}

function avSessionAutoRecNorm(raw) {
  if (!avSessionObj(raw)) return null;
  if (!avSessionObj(raw.state)) return null;
  const state = avSessionClone(raw.state);
  if (!avSessionObj(state)) return null;
  return {
    id: AV_SESSION_AUTOSAVE_ID,
    state: state,
    savedAt: avSessionNum(raw.savedAt, 0, 0, 9e15),
    name: (typeof raw.name === "string") ? avSessionText(raw.name, AV_SESSION_NAME_CAP, null) : null,
  };
}

function avSessionAutoRecForStore(rec) {
  const state = avSessionClone(rec.state);
  if (!state) return null;
  return { id: AV_SESSION_AUTOSAVE_ID, state: state, savedAt: rec.savedAt, name: rec.name };
}

/* ---------- LS fallback (JSON: sessions = meta + newest version only, + the autosave record) --- */

function avSessionLsRead() {
  const out = { sessions: {}, autosave: null, bad: false };
  try {
    const ls = avSessionLs();
    const raw = ls ? ls.getItem(AV_SESSION_LS) : null;
    if (raw == null) return out;
    let obj = null;
    try { obj = JSON.parse(String(raw)); } catch (e) { out.bad = true; return out; }
    if (!avSessionObj(obj)) { out.bad = true; return out; }
    if (avSessionObj(obj.sessions)) {
      const keys = Object.keys(obj.sessions);
      for (let i = 0; i < keys.length; i++) {
        const rec = avSessionRecordNorm(obj.sessions[keys[i]]);
        if (rec) out.sessions[rec.id] = rec;
      }
    }
    if (obj.autosave != null) out.autosave = avSessionAutoRecNorm(obj.autosave);
  } catch (e) { out.bad = true; }
  return out;
}

function avSessionLsPayload() {
  const st = avSession;
  const sessions = {};
  const ids = Object.keys(st.sessions);
  for (let i = 0; i < ids.length; i++) {
    const rec = st.sessions[ids[i]];
    if (!rec) continue;
    const newest = rec.versions.length ? rec.versions[rec.versions.length - 1] : null;
    sessions[rec.id] = {
      id: rec.id, name: rec.name, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
      current: rec.current === true,
      versions: newest ? [{ v: newest.v, savedAt: newest.savedAt, state: newest.state }] : [],
    };
  }
  return { v: AV_SESSION_STATE_V, sessions: sessions, autosave: st.autoRec ? avSessionAutoRecForStore(st.autoRec) : null };
}

/* write the whole LS snapshot; {ok} / {ok:false,error:'quota'|'ls'} / {skipped:true} without LS */
function avSessionLsWrite() {
  const ls = avSessionLs();
  if (!ls) return { skipped: true };
  try {
    const payload = avSessionLsPayload();
    ls.setItem(AV_SESSION_LS, JSON.stringify(payload));
    if (avSession.backend === "mem") avSession.backend = "ls";   /* the tier really is in use now */
    avSession.lastError = null;
    return { ok: true };
  } catch (e) {
    if (avSessionErrName(e) === "QuotaExceededError") { avSession.lastError = "quota"; return { ok: false, error: "quota" }; }
    return { ok: false, error: "ls" };   /* storage fully unavailable: memory fallback follows */
  }
}

/* ---------- hydrate (LS snapshot paints first, then the DB takes over — av_store's law) -------- */

function avSessionHydrate() {
  const st = avSession;
  if (st.hydratePromise) return st.hydratePromise;
  try {
    st.hydratePromise = avSessionHydrateRun().catch(function (e) {
      st.lastError = "hydrate:" + avSessionErrMsg(e);
      st.hydrated = true;
      try { avSessionAutoSeed(); } catch (e2) { /* seed is best effort */ }
      return st.backend;
    });
    return st.hydratePromise;
  } catch (e) {
    st.hydrated = true;
    return Promise.resolve(st.backend);
  }
}

function avSessionMergeSessions(fromDb, lsClean) {
  const st = avSession;
  const out = {};
  const k1 = Object.keys(fromDb);
  for (let i = 0; i < k1.length; i++) out[k1[i]] = fromDb[k1[i]];
  /* the LS snapshot is written only by a session that could not reach the DB, so for a duplicate
     id the SNAPSHOT wins (av_store's law); this live page's own records win over both */
  const k2 = Object.keys(lsClean);
  for (let i = 0; i < k2.length; i++) out[k2[i]] = lsClean[k2[i]];
  const k3 = Object.keys(st.sessions);
  for (let i = 0; i < k3.length; i++) out[k3[i]] = st.sessions[k3[i]];
  st.sessions = out;
}

function avSessionFixCurrent() {
  const st = avSession;
  if (st.currentId && !st.sessions[st.currentId]) st.currentId = null;
  if (!st.currentId) {
    let best = null;
    const ids = Object.keys(st.sessions);
    for (let i = 0; i < ids.length; i++) {
      const rec = st.sessions[ids[i]];
      if (!rec || rec.current !== true) continue;
      if (!best || (rec.updatedAt || 0) > (best.updatedAt || 0)) best = rec;
    }
    if (best) st.currentId = best.id;
  }
  const ids2 = Object.keys(st.sessions);
  for (let i = 0; i < ids2.length; i++) {
    const rec = st.sessions[ids2[i]];
    if (rec) rec.current = (rec.id === st.currentId);
  }
}

async function avSessionHydrateRun() {
  const st = avSession;
  if (st.hydrated) return st.backend;
  const ls = avSessionLsRead();
  if (ls.bad) st.lastError = "ls:json";
  const lsClean = ls.sessions;
  const lsHad = Object.keys(lsClean).length > 0 || !!ls.autosave;
  const db = await avSessionDbOpen();
  if (db) {
    const recs = await avSessionDbAll(db);
    if (recs === null) {
      st.backend = lsHad ? "ls" : "mem";                 /* the read blew up: stay on the snapshot */
      avSessionMergeSessions({}, lsClean);
      if (ls.autosave) st.autoRec = ls.autosave;
    } else {
      st.backend = "idb";
      const fromDb = {};
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i];
        if (!avSessionObj(r)) continue;
        if (r.id === AV_SESSION_AUTOSAVE_ID) {
          const ar = avSessionAutoRecNorm(r);
          if (ar && !st.autoRec) st.autoRec = ar;
          continue;
        }
        const rec = avSessionRecordNorm(r);
        if (rec) fromDb[rec.id] = rec;
      }
      /* removals made while the DB was unreachable stay honoured (never resurrected) */
      const dropIds = Object.keys(st.dropped);
      for (let i = 0; i < dropIds.length; i++) {
        const id = dropIds[i];
        delete fromDb[id];
        delete lsClean[id];
        try { avSessionDbRemove(db, id); } catch (e) { /* best-effort */ }
      }
      st.dropped = {};
      avSessionMergeSessions(fromDb, lsClean);
      if (ls.autosave) st.autoRec = ls.autosave;         /* snapshot wins for the autosave too */
      /* write through every snapshot id; retire the LS key once its content is safe */
      const ids = Object.keys(lsClean);
      let want = 0, landed = 0;
      for (let i = 0; i < ids.length; i++) {
        want += 1;
        try {
          const payload = avSessionRecordForStore(st.sessions[ids[i]]);
          if (payload) { await avSessionDbWrite(db, payload); landed += 1; }
        } catch (e) { /* best-effort import */ }
      }
      if (st.autoRec && ls.autosave) {
        try {
          const ar = avSessionAutoRecForStore(st.autoRec);
          if (ar) await avSessionDbWrite(db, ar);
        } catch (e) { /* best-effort */ }
      }
      if (want && landed === want) {
        try { const l = avSessionLs(); if (l) l.removeItem(AV_SESSION_LS); } catch (e) { /* keep the spare copy */ }
      }
    }
  } else {
    st.backend = lsHad ? "ls" : "mem";
    avSessionMergeSessions({}, lsClean);
    if (ls.autosave) st.autoRec = ls.autosave;
  }
  avSessionFixCurrent();
  /* the recovery offer: an autosave record exists -> available (NEVER auto-applied) */
  if (st.autoRec) {
    st.recovery = {
      available: true,
      savedAt: st.autoRec.savedAt,
      name: st.autoRec.name,
      at: avSessionNow(),
      state: st.autoRec.state,
    };
  }
  st.hydrated = true;
  avSessionMarkBaseline();
  avSessionAutoSeed();                  /* the seeding law (R20): choice, else store-count */
  return st.backend;
}

/* ---------- durable commits (tier-honest: idb -> ls -> mem; quota never silently downgrades) --- */

async function avSessionCommitRecord(rec) {
  const st = avSession;
  const payload = avSessionRecordForStore(rec);
  if (!payload) { st.lastError = "store:serialize"; return { ok: false, error: "serialize", backend: st.backend }; }
  if (st.db) {
    try {
      await avSessionDbWrite(st.db, payload);
      st.lastError = null;
      return { ok: true, backend: "idb" };
    } catch (e) {
      const name = avSessionErrName(e);
      if (name === "InvalidStateError" || name === "TransactionInactiveError") {
        st.db = null;
        try { await avSessionDbOpen(); } catch (e2) { /* stays null */ }
      }
      const err = (name === "QuotaExceededError") ? "quota" : ("idb:" + (name || "error"));
      st.lastError = err;
      return { ok: false, backend: "idb", error: err };
    }
  }
  if (avSessionLs()) {
    const w = avSessionLsWrite();
    if (w && w.ok) return { ok: true, backend: "ls" };
    if (w && w.error === "quota") return { ok: false, backend: "ls", error: "quota" };
    /* storage fully unavailable: fall to memory for this session */
  }
  st.lastError = null;
  return { ok: true, backend: "mem", volatile: true };
}

async function avSessionCommitAutoRec(rec) {
  const st = avSession;
  const prev = st.autoRec;
  const payload = avSessionAutoRecForStore(rec);
  if (!payload) { st.lastError = "autosave:serialize"; return { ok: false, error: "serialize", backend: st.backend }; }
  if (st.db) {
    try {
      await avSessionDbWrite(st.db, payload);
      st.autoRec = rec;
      st.lastError = null;
      return { ok: true, backend: "idb" };
    } catch (e) {
      const err = (avSessionErrName(e) === "QuotaExceededError") ? "quota" : ("idb:" + (avSessionErrName(e) || "error"));
      st.lastError = err;
      return { ok: false, backend: "idb", error: err };
    }
  }
  if (avSessionLs()) {
    st.autoRec = rec;
    const w = avSessionLsWrite();
    if (w && w.ok) return { ok: true, backend: "ls" };
    st.autoRec = prev;
    return { ok: false, backend: "ls", error: (w && w.error) || "ls" };
  }
  st.autoRec = rec;
  st.lastError = null;
  return { ok: true, backend: "mem", volatile: true };
}

async function avSessionClearAutoRec() {
  const st = avSession;
  const prev = st.autoRec;
  if (st.db) {
    const ok = await avSessionDbRemove(st.db, AV_SESSION_AUTOSAVE_ID);
    if (ok) { st.autoRec = null; st.lastError = null; return { ok: true, backend: "idb" }; }
    st.lastError = "clear:" + AV_SESSION_AUTOSAVE_ID;
    return { ok: false, backend: "idb", error: "idb:clear" };
  }
  if (avSessionLs()) {
    st.autoRec = null;
    const w = avSessionLsWrite();
    if (w && w.ok) return { ok: true, backend: "ls" };
    st.autoRec = prev;
    return { ok: false, backend: "ls", error: (w && w.error) || "ls" };
  }
  st.autoRec = null;
  return { ok: true, backend: "mem" };
}

/* ---------- small session helpers ---------- */

function avSessionFind(id) {
  try {
    if (id == null) return null;
    const key = String(id);
    return avSession.sessions[key] || null;
  } catch (e) { return null; }
}

function avSessionNextId() {
  let max = 0;
  try {
    const ids = Object.keys(avSession.sessions);
    for (let i = 0; i < ids.length; i++) {
      const m = /^s(\d+)$/.exec(ids[i]);
      if (m) { const n = Number(m[1]); if (isFinite(n) && n > max) max = n; }
    }
  } catch (e) { max = 0; }
  let id = "s" + (max + 1);
  let guard = 0;
  while (avSession.sessions[id] && guard++ < 64) id = "s" + (max + 1 + guard);
  if (avSession.sessions[id]) {                       /* timestamp fallback (never expected) */
    id = "s" + avSessionNow();
    guard = 0;
    while (avSession.sessions[id] && guard++ < 64) id = "s" + avSessionNow() + "-" + guard;
  }
  return id;
}

function avSessionClearOtherCurrent(id) {
  try {
    const ids = Object.keys(avSession.sessions);
    for (let i = 0; i < ids.length; i++) {
      const rec = avSession.sessions[ids[i]];
      if (rec) rec.current = (rec.id === id);
    }
  } catch (e) { /* flags are re-derived by avSessionFixCurrent after hydrates */ }
}

function avSessionEnsure() {
  try { if (!avSession.inited) avSessionInit(); } catch (e) { /* init never throws anyway */ }
  return avSession.inited === true;
}

function avSessionPersistRecords(recs) {
  const st = avSession;
  try {
    if (st.db) {
      for (let i = 0; i < recs.length; i++) {
        const payload = avSessionRecordForStore(recs[i]);
        if (!payload) continue;
        st.db && avSessionDbWrite(st.db, payload).catch(function () { st.lastError = "persist:" + recs[i].id; });
      }
      return true;
    }
    if (avSessionLs()) {
      const w = avSessionLsWrite();
      if (!w || w.ok !== true) st.lastError = "persist:" + ((w && w.error) || "ls");
      return true;
    }
  } catch (e) { st.lastError = "persist"; }
  return false;
}

/* ---------- public surface: init / save / list / load / delete / versions / restore ---------- */

function avSessionInit() {
  try {
    const st = avSession;
    if (!st.inited) {
      st.inited = true;
      avSessionBindVisibility();          /* R20: the hidden flush listener (guarded) */
      avSessionHydrate();                 /* best-effort boot hydrate; idempotent by promise */
    }
    return true;
  } catch (e) { return false; }
}

/* bind the visibilitychange listener ONCE (guarded: plain node has no document) */
function avSessionBindVisibility() {
  const st = avSession;
  if (st.flushBound) return false;
  try {
    if (typeof document !== "undefined" && document && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", avSessionVisibilityHandler);
      st.flushBound = true;
      return true;
    }
  } catch (e) { /* no DOM reachable */ }
  return false;
}

function avSessionSave(name) {
  try {
    avSessionEnsure();
    return Promise.resolve(avSessionSaveRun(name)).catch(function (e) {
      return { ok: false, error: avSessionErrMsg(e) };
    });
  } catch (e) {
    return Promise.resolve({ ok: false, error: avSessionErrMsg(e) });
  }
}

async function avSessionSaveRun(name) {
  const st = avSession;
  await avSessionHydrate();
  const nm = avSessionText(name, AV_SESSION_NAME_CAP, "");
  const now = avSessionNow();
  let rec = (st.currentId && st.sessions[st.currentId]) ? st.sessions[st.currentId] : null;
  let created = false, prevName = null, prevUpdatedAt = 0, prevLen = 0, prevCurrentId = st.currentId;
  if (!rec) {
    const id = avSessionNextId();
    rec = { id: id, name: nm || "Session", createdAt: now, updatedAt: now, current: true, tags: [], versions: [] };
    st.sessions[id] = rec;
    st.currentId = id;
    created = true;
  } else {
    prevName = rec.name;
    prevUpdatedAt = rec.updatedAt;
    if (nm) rec.name = nm;
  }
  prevLen = rec.versions.length;
  const stateObj = avSessionCapture();
  stateObj.name = rec.name;
  stateObj.savedAt = now;
  let nextV = 1;
  if (rec.versions.length) nextV = (Math.round(Number(rec.versions[rec.versions.length - 1].v)) || 0) + 1;
  if (!(nextV >= 1)) nextV = 1;
  rec.versions.push({ v: nextV, savedAt: now, state: stateObj });
  while (rec.versions.length > AV_SESSION_VERSIONS_MAX) rec.versions.shift();   /* the 16 ring */
  rec.updatedAt = now;
  rec.current = true;
  avSessionClearOtherCurrent(rec.id);
  const put = await avSessionCommitRecord(rec);
  if (!put || put.ok !== true) {
    /* "nothing durable → not saved": roll the memory change back so list matches storage */
    rec.versions.length = prevLen;
    rec.updatedAt = prevUpdatedAt;
    if (created) {
      delete st.sessions[rec.id];
      if (st.currentId === rec.id) st.currentId = prevCurrentId;
    } else if (prevName != null) {
      rec.name = prevName;
    }
    st.lastError = (put && put.error) || "save";
    const bad = { ok: false, id: rec.id, name: rec.name, version: nextV, savedAt: now, backend: (put && put.backend) || st.backend, error: (put && put.error) || "write failed", versions: rec.versions.length };
    st.lastSave = bad;
    return bad;
  }
  avSessionMarkBaseline();
  /* the after-first-save law (R20): while no explicit choice exists, a successful save flips
     autosave ON; an explicit off outranks it and is never overridden */
  if (st.autoChoice == null && st.auto.on !== true) {
    st.auto.on = true;
    avSessionAutosaveRearm();
  }
  const receipt = { ok: true, id: rec.id, name: rec.name, version: nextV, savedAt: now, backend: put.backend, volatile: !!put.volatile, versions: rec.versions.length };
  st.lastSave = receipt;
  st.lastError = null;
  return receipt;
}

/* avSessionSetTags(id, tags) -> Promise<{ok,id,tags,backend,volatile,error}>  set the tags on a
   session's meta (normalised: <= 8 tags, <= 24 chars each, lowercase-trimmed) and persist them
   through the existing record write path; a refused durable write rolls the memory change back
   ("nothing durable -> not saved"). Never throws. */
function avSessionSetTags(id, tags) {
  try {
    avSessionEnsure();
    return Promise.resolve(avSessionSetTagsRun(id, tags)).catch(function (e) {
      return { ok: false, id: String(id == null ? "" : id), tags: [], error: avSessionErrMsg(e) };
    });
  } catch (e) {
    return Promise.resolve({ ok: false, id: String(id == null ? "" : id), tags: [], error: avSessionErrMsg(e) });
  }
}

async function avSessionSetTagsRun(id, tags) {
  const st = avSession;
  await avSessionHydrate();
  const rec = avSessionFind(id);
  if (!rec) return { ok: false, id: String(id == null ? "" : id), tags: [], error: "no-session" };
  const next = avSessionTagsNorm(tags);
  const prev = Array.isArray(rec.tags) ? rec.tags.slice() : [];
  rec.tags = next;
  const put = await avSessionCommitRecord(rec);
  if (!put || put.ok !== true) {
    rec.tags = prev;                                    /* the rollback law */
    st.lastError = (put && put.error) || "tags";
    return { ok: false, id: rec.id, tags: prev.slice(), backend: (put && put.backend) || st.backend, volatile: !!(put && put.volatile), error: (put && put.error) || "write failed" };
  }
  st.lastError = null;
  return { ok: true, id: rec.id, tags: next.slice(), backend: put.backend, volatile: !!put.volatile };
}

/* R20 row meta for the session browser: engine kind / pattern bars / take count read off the
   NEWEST version's state; null when absent (the UI renders the honest "--" fallback). */
function avSessionRowMeta(rec) {
  const out = { engine: null, bars: null, takes: null };
  try {
    if (!rec || !rec.versions || !rec.versions.length) return out;
    const state = rec.versions[rec.versions.length - 1].state;
    if (!avSessionObj(state)) return out;
    const params = state.params;
    if (avSessionObj(params)) {
      const k = params["engine.kind"];
      if (typeof k === "string" && k) out.engine = k.slice(0, 24);
    }
    const sq = state.seq;
    const pat = avSessionObj(sq) ? sq.pattern : null;
    if (avSessionObj(pat) && Array.isArray(pat.tracks)) {
      let maxLen = 0;
      for (let i = 0; i < pat.tracks.length; i++) {
        const tr = pat.tracks[i];
        const n = Math.round(Number(tr ? tr.len : 0));
        if (isFinite(n) && n > maxLen) maxLen = n;
      }
      /* the house law: 16 steps = one bar (avFamilyBars); the longest track is the cycle */
      if (maxLen > 0) out.bars = Math.max(1, Math.round(maxLen / 16));
    }
    if (Array.isArray(state.takesMeta)) out.takes = state.takesMeta.length;
  } catch (e) { /* absent fields stand */ }
  return out;
}

function avSessionList() {
  const out = [];
  try {
    const st = avSession;
    const ids = Object.keys(st.sessions);
    for (let i = 0; i < ids.length; i++) {
      const rec = st.sessions[ids[i]];
      if (!rec) continue;
      const newest = rec.versions.length ? rec.versions[rec.versions.length - 1] : null;
      const meta = avSessionRowMeta(rec);
      out.push({
        id: rec.id,
        name: rec.name,
        savedAt: newest ? newest.savedAt : rec.updatedAt,
        updatedAt: rec.updatedAt,
        version: newest ? newest.v : 0,
        current: (rec.current === true) || (rec.id === st.currentId),
        engine: meta.engine,
        bars: meta.bars,
        takes: meta.takes,
        tags: avSessionTagsNorm(rec.tags),
      });
    }
  } catch (e) { /* [] */ }
  return out;
}

async function avSessionMarkCurrent(rec) {
  const st = avSession;
  const prevId = st.currentId;
  st.currentId = rec.id;
  avSessionClearOtherCurrent(rec.id);
  let put = await avSessionCommitRecord(rec);
  if (prevId && prevId !== rec.id && st.sessions[prevId]) {
    const p = await avSessionCommitRecord(st.sessions[prevId]);
    if (!p.ok && put.ok) put = p;                       /* a failure is reported honestly */
  }
  return put;
}

function avSessionLoad(id) {
  try {
    avSessionEnsure();
    return Promise.resolve(avSessionLoadRun(id)).catch(function (e) {
      return { ok: false, id: String(id == null ? "" : id), error: avSessionErrMsg(e) };
    });
  } catch (e) {
    return Promise.resolve({ ok: false, id: String(id == null ? "" : id), error: avSessionErrMsg(e) });
  }
}

async function avSessionLoadRun(id) {
  const st = avSession;
  await avSessionHydrate();
  const rec = avSessionFind(id);
  if (!rec) return { ok: false, id: String(id == null ? "" : id), error: "no-session" };
  if (!rec.versions.length) return { ok: false, id: rec.id, name: rec.name, error: "no-versions" };
  const ver = rec.versions[rec.versions.length - 1];
  const ap = avSessionApply(ver.state);
  const marked = await avSessionMarkCurrent(rec);
  avSessionMarkBaseline();
  const receipt = {
    ok: ap.ok === true, id: rec.id, name: rec.name, version: ver.v, savedAt: ver.savedAt,
    applied: ap.applied, skipped: ap.skipped, carried: ap.carried, seqOk: ap.seqOk,
    marked: marked.ok === true, backend: marked.backend, error: ap.error,
  };
  st.lastLoad = receipt;
  if (!ap.ok && ap.error) st.lastError = ap.error;
  return receipt;
}

function avSessionDelete(id) {
  try {
    const st = avSession;
    avSessionEnsure();
    const rec = avSessionFind(id);
    if (!rec) return false;
    delete st.sessions[rec.id];
    if (st.currentId === rec.id) st.currentId = null;
    if (st.db) {
      avSessionDbRemove(st.db, rec.id).then(function (ok) {
        if (!ok) st.lastError = "delete:" + rec.id;
      }, function () { st.lastError = "delete:" + rec.id; });
    } else if (avSessionLs()) {
      st.dropped[rec.id] = true;
      const w = avSessionLsWrite();
      if (!w || w.ok !== true) st.lastError = "delete:" + ((w && w.error) || "ls");
    } else {
      st.dropped[rec.id] = true;                        /* memory last resort */
    }
    return true;
  } catch (e) { return false; }
}

function avSessionVersions(id) {
  try {
    const st = avSession;
    const want = (id == null) ? st.currentId : id;
    const rec = want != null ? avSessionFind(want) : null;
    if (!rec) return [];
    const out = [];
    for (let i = 0; i < rec.versions.length; i++) {
      const vv = rec.versions[i];
      let bytes = 0;
      try { bytes = JSON.stringify(vv.state).length; } catch (e) { bytes = 0; }
      out.push({ version: vv.v, savedAt: vv.savedAt, bytes: bytes });
    }
    return out;
  } catch (e) { return []; }
}

function avSessionRestore(id, version) {
  try {
    avSessionEnsure();
    return Promise.resolve(avSessionRestoreRun(id, version)).catch(function (e) {
      return { ok: false, id: String(id == null ? "" : id), error: avSessionErrMsg(e) };
    });
  } catch (e) {
    return Promise.resolve({ ok: false, id: String(id == null ? "" : id), error: avSessionErrMsg(e) });
  }
}

async function avSessionRestoreRun(id, version) {
  const st = avSession;
  await avSessionHydrate();
  const rec = avSessionFind(id);
  if (!rec) return { ok: false, id: String(id == null ? "" : id), error: "no-session" };
  const want = Math.round(Number(version));
  let ver = null;
  for (let i = 0; i < rec.versions.length; i++) if (rec.versions[i].v === want) { ver = rec.versions[i]; break; }
  if (!ver) return { ok: false, id: rec.id, name: rec.name, version: (isFinite(want) ? want : null), error: "no-version" };
  const ap = avSessionApply(ver.state);
  const marked = await avSessionMarkCurrent(rec);
  avSessionMarkBaseline();
  const receipt = {
    ok: ap.ok === true, id: rec.id, name: rec.name, version: ver.v, savedAt: ver.savedAt,
    applied: ap.applied, skipped: ap.skipped, carried: ap.carried, seqOk: ap.seqOk,
    marked: marked.ok === true, backend: marked.backend, error: ap.error,
  };
  st.lastLoad = receipt;
  if (!ap.ok && ap.error) st.lastError = ap.error;
  return receipt;
}

/* ---------- autosave (R20: ONE timer; one __autosave record; dirty-only writes; the seeding
   law; the persisted explicit choice; the visibilitychange hidden flush) ---------- */

/* the EXPLICIT autosave choice: localStorage key `av-sessions-autosave` (JSON {v:1,on});
   true / false / null (null = no explicit choice yet). Never throws. */
function avSessionAutoChoiceRead() {
  try {
    const ls = avSessionLs();
    if (!ls) return null;
    const raw = ls.getItem(AV_SESSION_AUTO_LS);
    if (raw == null) return null;
    const s = String(raw).trim();
    if (s === "1") return true;
    if (s === "0") return false;
    let obj = null;
    try { obj = JSON.parse(s); } catch (e) { obj = null; }
    if (avSessionObj(obj)) {
      if (obj.on === true || obj.on === 1 || obj.on === "1") return true;
      if (obj.on === false || obj.on === 0 || obj.on === "0") return false;
    }
  } catch (e) { /* no storage -> no persisted choice */ }
  return null;
}

function avSessionAutoChoiceWrite(on) {
  try {
    const ls = avSessionLs();
    if (!ls) return false;
    ls.setItem(AV_SESSION_AUTO_LS, JSON.stringify({ v: 1, on: on === true }));
    return true;
  } catch (e) { return false; }
}

/* the seeding law (R20): the persisted EXPLICIT choice wins; otherwise autosave seeds ON when
   the store already holds >= 1 session; a virgin store seeds OFF. Runs once at hydrate end. */
function avSessionAutoSeed() {
  const st = avSession;
  try {
    if (st.autoChoice == null) st.autoChoice = avSessionAutoChoiceRead();
    if (st.autoChoice !== null) st.auto.on = (st.autoChoice === true);
    else {
      let count = 0;
      try { count = Object.keys(st.sessions).length; } catch (e) { count = 0; }
      st.auto.on = count >= 1;
    }
    avSessionAutosaveRearm();
    return st.auto.on === true;
  } catch (e) { return false; }
}

function avSessionAutosave(on, ms) {
  try {
    avSessionEnsure();
    const st = avSession;
    let changed = false;
    if (on !== undefined && on !== null) {
      st.auto.on = !!on;
      st.autoChoice = !!on;               /* the explicit choice persists across loads */
      avSessionAutoChoiceWrite(st.autoChoice);
      changed = true;
    }
    if (ms !== undefined && ms !== null) {
      const n = Number(ms);
      if (isFinite(n)) st.auto.ms = Math.max(AV_SESSION_AUTOSAVE_MIN_MS, Math.min(AV_SESSION_AUTOSAVE_MAX_MS, Math.round(n)));
      changed = true;
    }
    if (changed) avSessionAutosaveRearm();
    return { on: st.auto.on === true, ms: st.auto.ms };
  } catch (e) {
    return { on: false, ms: AV_SESSION_AUTOSAVE_DEF_MS };
  }
}

function avSessionAutosaveRearm() {
  const st = avSession;
  if (st.timer != null) { avSessionClear(st.timer); st.timer = null; }
  if (st.auto.on !== true) return;
  st.timer = avSessionTimer(avSessionAutosaveTick, st.auto.ms);
}

/* the dirty-only write shared by the tick and the hidden flush: ONE __autosave record; the
   fingerprint re-bases ONLY on a landed write (a refused write stays dirty, honest). */
function avSessionAutosaveWrite() {
  const st = avSession;
  const fp = avSessionFingerprint();
  const dirty = st.touchDirty === true || (st.baseFp != null && fp !== st.baseFp);
  if (!dirty) return false;
  const stateObj = avSessionCapture();
  const rec = { id: AV_SESSION_AUTOSAVE_ID, state: stateObj, savedAt: avSessionNow(), name: stateObj.name };
  avSessionCommitAutoRec(rec).then(function (r) {
    if (r && r.ok === true) {
      st.lastAutosaveAt = rec.savedAt;
      st.baseFp = fp;
      st.touchDirty = false;
      if (st.recovery && st.recovery.available === true) {   /* refresh the pending offer */
        st.recovery.savedAt = rec.savedAt;
        st.recovery.name = rec.name;
        st.recovery.state = rec.state;
      }
    } else {
      st.lastError = "autosave:" + ((r && r.error) || "write failed");   /* stays dirty */
    }
  }, function () { st.lastError = "autosave:write failed"; });
  return true;
}

function avSessionAutosaveTick() {
  const st = avSession;
  st.timer = null;
  try {
    if (st.auto.on === true) avSessionAutosaveWrite();
  } catch (e) { st.lastError = "autosave:" + avSessionErrMsg(e); }
  if (st.auto.on === true) st.timer = avSessionTimer(avSessionAutosaveTick, st.auto.ms);
}

/* visibilitychange -> hidden flush (R20): while auto is on and the state is dirty, run the same
   ONE write immediately, then rearm. Reads document.visibilityState per event (rigs stub it).
   Guarded, silent, never throws outward. */
function avSessionVisibilityFlush() {
  const st = avSession;
  try {
    if (st.auto.on !== true) return false;
    const wrote = avSessionAutosaveWrite();
    if (wrote) avSessionAutosaveRearm();
    return wrote;
  } catch (e) { return false; }
}

function avSessionVisibilityHandler() {
  try {
    let vis = "";
    try { if (typeof document !== "undefined" && document) vis = String(document.visibilityState || ""); } catch (e) { vis = ""; }
    if (vis !== "hidden") return false;
    return avSessionVisibilityFlush();
  } catch (e) { return false; }
}

/* ---------- state / recovery ---------- */

function avSessionNote() {
  try {
    const st = avSession;
    if (st.hydrated !== true) return null;
    if (st.backend === "idb") return null;
    if (avSessionLs()) return "no IndexedDB — sessions keep the newest version per session (localStorage)";
    return "no persistent storage here — sessions live only until this page closes";
  } catch (e) { return null; }
}

function avSessionState() {
  try {
    const st = avSession;
    const ids = Object.keys(st.sessions);
    let current = null;
    if (st.currentId && st.sessions[st.currentId]) current = { id: st.currentId, name: st.sessions[st.currentId].name };
    const rec = st.recovery;
    const hasRec = !!(rec && rec.available === true && avSessionObj(rec.state));
    return {
      version: AV_SESSION_VERSION,
      init: st.inited === true,
      inited: st.inited === true,
      hydrated: st.hydrated === true,
      backend: st.backend,
      volatile: st.backend === "mem",
      modes: AV_SESSION_MODES.slice(),
      note: avSessionNote(),
      notes: st.notes.slice(),
      count: ids.length,
      current: current,
      dirty: avSessionDirty(),
      lastAutosaveAt: st.lastAutosaveAt,
      autosave: { on: st.auto.on === true, ms: st.auto.ms, choice: (st.autoChoice === true) ? true : (st.autoChoice === false ? false : null) },
      recovery: hasRec
        ? { available: true, savedAt: rec.savedAt, name: rec.name, at: rec.at }
        : { available: false, savedAt: null, name: null, at: null },
      lastError: st.lastError,
      lastSave: st.lastSave ? avSessionClone(st.lastSave) : null,
      lastLoad: st.lastLoad ? avSessionClone(st.lastLoad) : null,
    };
  } catch (e) {
    return {
      version: AV_SESSION_VERSION, init: false, inited: false, hydrated: false, backend: null,
      volatile: false, modes: AV_SESSION_MODES.slice(), note: null, notes: [], count: 0,
      current: null, dirty: false, lastAutosaveAt: 0,
      autosave: { on: false, ms: AV_SESSION_AUTOSAVE_DEF_MS, choice: null },
      recovery: { available: false, savedAt: null, name: null, at: null },
      lastError: "state", lastSave: null, lastLoad: null,
    };
  }
}

function avSessionRecover() {
  try {
    avSessionEnsure();
    return Promise.resolve(avSessionRecoverRun()).catch(function (e) {
      return { ok: false, error: avSessionErrMsg(e), applied: 0, skipped: [], carried: [] };
    });
  } catch (e) {
    return Promise.resolve({ ok: false, error: avSessionErrMsg(e), applied: 0, skipped: [], carried: [] });
  }
}

async function avSessionRecoverRun() {
  const st = avSession;
  await avSessionHydrate();
  const rec = st.recovery;
  if (!rec || rec.available !== true || !avSessionObj(rec.state)) {
    return { ok: false, error: "no-recovery", applied: 0, skipped: [], carried: [] };
  }
  const savedAt = rec.savedAt;
  const ap = avSessionApply(rec.state);
  st.recovery = null;                                   /* the offer is consumed */
  const clear = await avSessionClearAutoRec();
  avSessionPushNote("recovered");
  avSessionMarkBaseline();
  const receipt = {
    ok: ap.ok === true, applied: ap.applied, skipped: ap.skipped, carried: ap.carried,
    seqOk: ap.seqOk, savedAt: savedAt, cleared: clear.ok === true, backend: clear.backend,
    error: ap.error,
  };
  st.lastLoad = receipt;
  return receipt;
}

function avSessionDismissRecovery() {
  try {
    const st = avSession;
    avSessionEnsure();
    if (!st.recovery || st.recovery.available !== true) return false;
    st.recovery = null;
    avSessionPushNote("recovery dismissed");
    avSessionClearAutoRec().then(function (r) {
      if (!r || r.ok !== true) st.lastError = "dismiss:" + ((r && r.error) || "clear failed");
    }, function () { st.lastError = "dismiss:clear failed"; });
    return true;
  } catch (e) { return false; }
}

/* ---------- export / import (the backup child's seam) ---------- */

function avSessionExport() {
  try {
    const out = [];
    const ids = Object.keys(avSession.sessions);
    for (let i = 0; i < ids.length; i++) {
      const rec = avSession.sessions[ids[i]];
      if (!rec) continue;
      const payload = avSessionRecordForStore(rec);   /* detached, raw records for the backup child */
      if (payload) out.push(payload);
    }
    return { v: AV_SESSION_STATE_V, sessions: out };
  } catch (e) { return { v: AV_SESSION_STATE_V, sessions: [] }; }
}

function avSessionImport(payloadOrRecord) {
  const receipt = { ok: false, imported: 0, skipped: 0, ids: [] };
  try {
    avSessionEnsure();
    const st = avSession;
    let list = null;
    if (Array.isArray(payloadOrRecord)) list = payloadOrRecord;
    else if (avSessionObj(payloadOrRecord)) {
      if (Array.isArray(payloadOrRecord.sessions)) list = payloadOrRecord.sessions;
      else if (payloadOrRecord.id != null || Array.isArray(payloadOrRecord.versions)) list = [payloadOrRecord];
    }
    if (!list) { receipt.error = "not a payload"; return receipt; }
    const n = Math.min(list.length, AV_SESSION_IMPORT_MAX);
    const touched = [];
    for (let i = 0; i < n; i++) {
      const rec = avSessionRecordNorm(list[i]);
      if (!rec || !rec.versions.length) { receipt.skipped += 1; continue; }
      if (st.sessions[rec.id]) { receipt.skipped += 1; continue; }   /* id-dedupe: the existing wins */
      st.sessions[rec.id] = rec;
      touched.push(rec);
      receipt.imported += 1;
      receipt.ids.push(rec.id);
    }
    if (list.length > n) receipt.skipped += (list.length - n);
    if (touched.length) avSessionPersistRecords(touched);
    avSessionFixCurrent();
    receipt.ok = (receipt.imported > 0 && receipt.skipped === 0);
    return receipt;
  } catch (e) {
    receipt.ok = false;
    receipt.error = avSessionErrMsg(e);
    return receipt;
  }
}

/* ---------- touch / classes ---------- */

function avSessionTouch() {
  try {
    avSessionEnsure();
    avSession.touchDirty = true;
    return true;
  } catch (e) { return false; }
}

function avSessionClasses() {
  return AV_SESSION_CLASSES.slice();   /* this module mounts nothing — the card owns markup */
}

/* ---------- debug handle (rigs + parent call these; names are the contract) ---------- */

if (typeof window !== "undefined" && window) {
  try {
    window.__avSession = {
      version: AV_SESSION_VERSION,
      init: avSessionInit,
      capture: avSessionCapture,
      apply: avSessionApply,
      save: avSessionSave,
      list: avSessionList,
      load: avSessionLoad,
      "delete": avSessionDelete,
      versions: avSessionVersions,
      restore: avSessionRestore,
      autosave: avSessionAutosave,
      state: avSessionState,
      recover: avSessionRecover,
      "export": avSessionExport,
      "import": avSessionImport,
      touch: avSessionTouch,
      dismiss: avSessionDismissRecovery,
      classes: avSessionClasses,
      hydrate: avSessionHydrate,
      setTags: avSessionSetTags,
      flush: avSessionVisibilityFlush,
    };
  } catch (e) { /* no window — node harness only */ }
}
