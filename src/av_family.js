/* Anvil — PLATFORM wave (suite bridges #82): the FAMILY card — three local handshakes mounted
   into the parent-owned host `#av-family-host` (the parent adds the `#av-family` card at
   integration, like the other cards; this module only fills the host). Per verify/_platform_wave.md
   §2.6, plus the parent ID pin (2026-10-08):

     HUB        bounce the current loop (master) offline -> encode it 16-bit / 48 k ->
                write the bridge record into IDB `moddys-bridges`/`outbox` (database version 1,
                objectStore keyPath "id") -> open `./inbox.html` in the named target
                "av-hub-inbox". On file:// (or when the store refuses) the WAV is downloaded
                instead and the row says the inbox needs moddys.net (same origin).
     RESONANCE  import Resonance session packs (`https://moddys.net/resonance/app/pack/<id>.zip`,
                overridable via setPackBase — the rig points it at its own server) or a local
                `.zip` / `.gnaural` file -> session list (name + minutes + type names, refusals
                listed) -> preview renders via avGnRender at the 120 s cap, builds an AudioBuffer
                on the LIVE tap context and plays it through the MASTER tap input — NEVER
                ctx.destination (standing witness law: avTap.ctx + avMasterNodes()/avMasterFor()).
                save() encodes the last rendered buffer with avWavEncode -> house download.
     RADIO      read the radio's OWN same-origin localStorage (`rbg-last`, `rbg-meta`) tolerantly
                (foreign keys: any shape, never throws, never writes) and show the last station
                (name + country) + OPEN RADIO + a search deep link `https://moddys.net/#q=<term>`.

   LAWS (house): "use strict"; classic script, no imports; node-loadable (no DOM/global reach at
   load — every reach typeof-guarded inside a function); ONE namespace avFamily* / AV_FAMILY_*;
   never throws (refuse honestly, receipt-shaped { ok, error?, note?, ... }); NO console output;
   ONE op at a time (busy guard); every cross-module call (avBounce · avWavEncode · avGnParse ·
   avGnUnzip · avGnSessionsFromZip · avGnInfo · avGnRender · avSeqSnap · avDeliverDownload ·
   avTap/avMasterNodes/avMasterFor/avKeysFor · avEngineEnsure) is typeof-guarded PER CALL and
   degrades to an honest refusal when its module is absent. IDB writes are structured clones —
   NEVER a transfer list. No new .av-knob controls: selects, buttons, text inputs only.

   ID INVENTORY (rig + smoke pin; all inside #av-family-host):
     root `.av-family[data-av-family="1"]` · row wrapper `.av-fam-row[data-av-fam-row=hub|resonance|radio]`
     (exactly 3) · per-row status lines `.av-fam-status` (ids #av-fam-hub-status ·
     #av-fam-res-status · #av-fam-radio-status) ·
     hub: #av-fam-hub-loops (select 2/4/8, default 8) · #av-fam-hub-send ·
     resonance: #av-fam-res-pack (select of the known pack ids) · #av-fam-res-import ·
     #av-fam-res-preview · #av-fam-res-save · #av-fam-res-file (local .zip/.gnaural input) ·
     #av-fam-res-list (session rows, [data-av-fam-session="<i>"]) ·
     radio: #av-fam-radio-open · #av-fam-radio-q (text) · #av-fam-radio-go.
   OBSERVABLES: avFamilyInit() -> bool · avFamilyState() -> JSON-safe snapshot (lastReceipt per
   row) · avFamilySend(opts) -> Promise<receipt> · avFamilyImportPack(src) -> Promise<receipt> ·
   avFamilyPreview(i) -> Promise<receipt> · avFamilySave() -> bool · avFamilyStop() -> bool ·
   avFamilyOpenRadio(q) -> URL string · avFamilySetPackBase(url) -> bool ·
   avFamilyInboxAvailable() -> bool (IndexedDB present && protocol http(s)) ·
   avFamilyClasses() -> string[] · window.__avFamily = { version, init, state, send, importPack,
   preview, save, stop, openRadio, setPackBase, classes }. (save is on the handle because §2.6
   prose + the P8 rig call save() directly.)

   ONE writer (child sa-D). Never throws. */

"use strict";

const AV_FAMILY_VERSION = "platform.1";
const AV_FAMILY_HOST_ID = "av-family-host";

/* hub bridge store pin (§2.4) */
const AV_FAMILY_DB = "moddys-bridges";
const AV_FAMILY_DB_VER = 1;
const AV_FAMILY_OS = "outbox";
const AV_FAMILY_INBOX_URL = "./inbox.html";
const AV_FAMILY_INBOX_TARGET = "av-hub-inbox";
const AV_FAMILY_DB_TIMEOUT_MS = 4000;      /* a hung/blocked open must not wedge the card */
const AV_FAMILY_LOOP_DEF = 8;
const AV_FAMILY_LOOPS_MIN = 1;
const AV_FAMILY_LOOPS_MAX = 64;
const AV_FAMILY_HUB_TAIL_S = 2;
const AV_FAMILY_HUB_SR = 48000;

/* resonance pin (§2.6) — the known pack ids, verbatim from the wave contract enumeration
   (breathing classic depth focus gnaural-web-complete listener schumann sleep sleepladder
   solfeggio speakers tours wave1..7) */
const AV_FAMILY_PACK_BASE = "https://moddys.net/resonance/app/pack/";
const AV_FAMILY_PACK_IDS = [
  "breathing", "classic", "depth", "focus", "gnaural-web-complete", "listener",
  "schumann", "sleep", "sleepladder", "solfeggio", "speakers", "tours",
  "wave1", "wave2", "wave3", "wave4", "wave5", "wave6", "wave7",
];
const AV_FAMILY_FETCH_MS = 30000;          /* pack download timeout (store precedent) */
const AV_FAMILY_PREVIEW_CAP_S = 120;       /* live preview cap (hard cap 600 in the renderer) */
const AV_FAMILY_SESSIONS_CAP = 32;         /* list render cap — never a wall of DOM */
const AV_FAMILY_TYPES_CAP = 4;

/* radio pin (§2.6) */
const AV_FAMILY_RADIO_URL = "https://moddys.net/";
const AV_FAMILY_RADIO_TARGET = "av-world-radio";
const AV_FAMILY_RADIO_LS_LAST = "rbg-last";
const AV_FAMILY_RADIO_LS_META = "rbg-meta";

/* the .gnaural type vocabulary (§2.5 pin) — fallback when a typeName is not carried */
const AV_FAMILY_GN_TYPES = ["binaural", "pink noise", "pcm file", "isopulse", "isopulse", "gnaural ext", "gnaural ext", "white noise", "brown noise"];
const AV_FAMILY_GN_PLAYABLE = [true, false, false, false, false, false, false, true, true];

/* ---------- module state (UI state only — nothing else cached) ---------- */

const avFamilySt = {
  inited: false, mounts: 0,
  busy: false, busyOp: "",
  packBase: "",                  /* "" = the pinned default */
  sessions: [],                  /* internal: { name, ok, error, info, parsed (full parse), bytes } */
  selected: -1,
  lastRender: null,              /* { l, r, sr, seconds, frames, name, capped } — save() reads this */
  preview: null,                 /* { src, ctx } */
  receipts: { hub: null, resonance: null, radio: null },   /* lastReceipt per row */
  statuses: { hub: "", resonance: "", radio: "" },
  resNote: "",                   /* decoy/unzip-notes line under the resonance list */
  lastSessionsHtml: null,
  radio: null,                   /* last painted radio view */
  lastError: "",
};

/* ---------- tiny value laws (never throw) ---------- */

const avFamilyEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function avFamilyMsg(e) {
  try { return String((e && (e.message || e.name)) || e) || "unknown error"; } catch (e2) { return "unknown error"; }
}

function avFamilyClean(s, max) {
  let t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  if (max && t.length > max) t = t.slice(0, max - 1) + "\u2026";
  return t;
}

function avFamilyNum(v, d) { const n = Number(v); return isFinite(n) ? n : d; }

function avFamilyInt(v, d, lo, hi) {
  const n = Number(v);
  if (!isFinite(n)) return d;
  const r = Math.round(n);
  return r < lo ? lo : (r > hi ? hi : r);
}

function avFamilyErrText(r, fallback) {
  try {
    if (r && typeof r === "object") {
      if (typeof r.error === "string" && r.error) return r.error;
      if (typeof r.reason === "string" && r.reason) return r.reason;
      if (typeof r.message === "string" && r.message) return r.message;
    }
    if (typeof r === "string" && r) return r;
  } catch (e) { /* refuse */ }
  return fallback || "refused";
}

/* normalize ArrayBuffer | typed view -> a real ArrayBuffer (or null); never throws */
function avFamilyAb(x) {
  try {
    if (!x) return null;
    if (typeof ArrayBuffer !== "undefined" && x instanceof ArrayBuffer) return x;
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(x)) {
      if (x.byteOffset === 0 && x.byteLength === x.buffer.byteLength) return x.buffer;
      return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength);
    }
  } catch (e) { /* refuse */ }
  return null;
}

function avFamilyByteLen(x) {
  try { const n = Number(x && x.byteLength); return isFinite(n) && n > 0 ? Math.round(n) : 0; } catch (e) { return 0; }
}

function avFamilyFmtSize(bytes) {
  const n = Number(bytes);
  if (!isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return Math.round(n) + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(2) + " MB";
}

function avFamilyFmtDur(sec) {
  const n = Number(sec);
  if (!isFinite(n) || n < 0) return "?";
  const s = Math.round(n);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ":" + (r < 10 ? "0" : "") + r;
}

function avFamilyHex6() {
  try { return ("00000" + Math.floor(Math.random() * 0x1000000).toString(16)).slice(-6); }
  catch (e) { return "000000"; }
}

/* filesystem-safe base for a loop/session name */
function avFamilySafeName(s, fallback) {
  let t = String(s == null ? "" : s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/\s+/g, "_");
  t = t.replace(/^_+|_+$/g, "").slice(0, 48);
  return t || (fallback || "anvil_loop");
}

/* musical bars from the bounce facts: 16 steps = one bar (the house 16-step grid); deterministic,
   documented approximation (an 8t grid is 12 steps/bar — the count stays honest, not exact) */
function avFamilyBars(loops, cycleSteps) {
  const l = avFamilyInt(loops, 1, 1, 64);
  const c = avFamilyInt(cycleSteps, 16, 1, 64);
  const bars = Math.round((l * c) / 16);
  return bars >= 1 ? bars : 1;
}

/* ---------- guarded environment reaches ---------- */

function avFamilyWin() {
  try { if (typeof window !== "undefined" && window) return window; } catch (e) { /* none */ }
  return null;
}

function avFamilyGlobal() {
  const w = avFamilyWin();
  if (w) return w;
  try { if (typeof globalThis !== "undefined") return globalThis; } catch (e) { /* none */ }
  return null;
}

function avFamilyDoc() {
  try { if (typeof document !== "undefined" && document) return document; } catch (e) { /* none */ }
  return null;
}

function avFamilyHost() {
  try {
    const d = avFamilyDoc();
    if (d && typeof d.getElementById === "function") return d.getElementById(AV_FAMILY_HOST_ID);
  } catch (e) { /* no document */ }
  return null;
}

function avFamilyLs() {
  try { if (typeof localStorage !== "undefined" && localStorage) return localStorage; } catch (e) { /* blocked */ }
  try { const w = avFamilyWin(); if (w && w.localStorage) return w.localStorage; } catch (e) { /* blocked */ }
  return null;
}

function avFamilyIdbSource() {
  try { if (typeof indexedDB !== "undefined" && indexedDB) return indexedDB; } catch (e) { /* none */ }
  try { const w = avFamilyWin(); if (w && w.indexedDB) return w.indexedDB; } catch (e) { /* none */ }
  return null;
}

/* ---------- guarded cross-module resolution (resolved PER CALL; late arrival is normal) ---------- */

const AV_FAMILY_FNS = [
  ["bounce", "avBounce"], ["wav", "avWavEncode"],
  ["gnParse", "avGnParse"], ["gnUnzip", "avGnUnzip"], ["gnSessions", "avGnSessionsFromZip"],
  ["gnInfo", "avGnInfo"], ["gnRender", "avGnRender"],
  ["download", "avDeliverDownload"],
  ["masterNodes", "avMasterNodes"], ["masterFor", "avMasterFor"], ["keysFor", "avKeysFor"],
  ["engineEnsure", "avEngineEnsure"], ["seqSnap", "avSeqSnap"],
];

function avFamilyFns() {
  const f = {};
  for (let i = 0; i < AV_FAMILY_FNS.length; i++) f[AV_FAMILY_FNS[i][0]] = null;
  /* bare-identifier pass (the concat scope); each reach is its own guard — never a dynamic lookup */
  try { if (typeof avBounce === "function") f.bounce = avBounce; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avWavEncode === "function") f.wav = avWavEncode; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avGnParse === "function") f.gnParse = avGnParse; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avGnUnzip === "function") f.gnUnzip = avGnUnzip; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avGnSessionsFromZip === "function") f.gnSessions = avGnSessionsFromZip; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avGnInfo === "function") f.gnInfo = avGnInfo; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avGnRender === "function") f.gnRender = avGnRender; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avDeliverDownload === "function") f.download = avDeliverDownload; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avMasterNodes === "function") f.masterNodes = avMasterNodes; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avMasterFor === "function") f.masterFor = avMasterFor; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avKeysFor === "function") f.keysFor = avKeysFor; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avEngineEnsure === "function") f.engineEnsure = avEngineEnsure; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avSeqSnap === "function") f.seqSnap = avSeqSnap; } catch (e) { /* absent/TDZ */ }
  try { if (typeof avTap !== "undefined" && avTap) f.tap = avTap; } catch (e) { /* absent/TDZ */ }
  /* global-property pass (separate script scopes, rigs) */
  try {
    const g = avFamilyGlobal();
    if (g) {
      for (let i = 0; i < AV_FAMILY_FNS.length; i++) {
        const k = AV_FAMILY_FNS[i][0], n = AV_FAMILY_FNS[i][1];
        if (!f[k] && typeof g[n] === "function") f[k] = g[n];
      }
      if (!f.tap) f.tap = (g.avTap && g.avTap.ctx !== undefined) ? g.avTap : (g.__avTap || null);
    }
  } catch (e) { /* no global scope */ }
  return f;
}

/* the live tap context: avTap.ctx (av_tap.js) — the ONE live AudioContext; never a new one */
function avFamilyLiveCtx(fns) {
  try {
    const t = (fns && fns.tap) || null;
    if (t && t.ctx && t.ctx.state !== "closed") return t.ctx;
  } catch (e) { /* no tap */ }
  return null;
}

/* the MASTER tap input (standing witness law): avMasterFor(ctx) first, then the avMasterNodes()
   list (prefer the node of the live ctx), NEVER ctx.destination */
function avFamilyMasterInput(fns, ctx) {
  try { if (fns && fns.masterFor && ctx) { const n = fns.masterFor(ctx); if (n && n.gain) return n; } } catch (e) { /* fall through */ }
  try {
    if (fns && fns.masterNodes) {
      const list = fns.masterNodes();
      if (list && typeof list.length === "number" && list.length) {
        for (let i = 0; i < list.length; i++) {
          const n = list[i];
          if (n && n.gain && (!ctx || n.context === ctx)) return n;
        }
        if (list[0] && list[0].gain) return list[0];
      }
    }
  } catch (e) { /* no masters */ }
  return null;
}

/* ---------- house download path (avDeliverDownload when loaded; local anchor else) ---------- */

function avFamilyAnchor(bytes, name, mime) {
  try {
    const d = avFamilyDoc();
    const w = avFamilyWin();
    if (!d || typeof d.createElement !== "function") return false;
    if (typeof Blob === "undefined" || !w || !w.URL || typeof w.URL.createObjectURL !== "function") return false;
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

function avFamilyDownload(bytes, name) {
  try {
    if (!bytes || typeof bytes.byteLength !== "number" || bytes.byteLength <= 0) return false;
    const fns = avFamilyFns();
    let ok = false, via = "refused";
    if (fns.download) {
      try { ok = fns.download(bytes, name) === true; if (ok) via = "deliver"; } catch (e) { ok = false; }
    }
    if (!ok) { ok = avFamilyAnchor(bytes, name, "audio/wav"); if (ok) via = "anchor"; }
    try {
      const w = avFamilyWin();
      if (w) w.__avFamilyLastDownload = { name: name, bytes: avFamilyByteLen(bytes), at: Date.now(), via: via };
    } catch (e) { /* observability is a nicety */ }
    return ok;
  } catch (e) { return false; }
}

/* ---------- the bridge store write (guarded open/migrate, structured clone, no transfer list) ---------- */

function avFamilyOutboxPut(rec) {
  return new Promise(function (resolve) {
    let settled = false;
    const done = function (r) { if (!settled) { settled = true; resolve(r); } };
    let timer = null;
    try {
      const idb = avFamilyIdbSource();
      if (!idb || typeof idb.open !== "function") { done({ ok: false, error: "no-indexeddb" }); return; }
      try { if (typeof setTimeout === "function") timer = setTimeout(function () { done({ ok: false, error: "timeout" }); }, AV_FAMILY_DB_TIMEOUT_MS); } catch (e) { timer = null; }
      let rq = null;
      try { rq = idb.open(AV_FAMILY_DB, AV_FAMILY_DB_VER); } catch (e) { done({ ok: false, error: "open:" + avFamilyMsg(e) }); return; }
      rq.onupgradeneeded = function () {
        try {
          const db = rq.result;
          if (!db.objectStoreNames || !db.objectStoreNames.contains(AV_FAMILY_OS)) db.createObjectStore(AV_FAMILY_OS, { keyPath: "id" });
        } catch (e) { /* upgrade raced — the put below decides */ }
      };
      rq.onerror = function () { try { if (timer) clearTimeout(timer); } catch (e) { /* ok */ } done({ ok: false, error: "open:error" }); };
      rq.onblocked = function () { try { if (timer) clearTimeout(timer); } catch (e) { /* ok */ } done({ ok: false, error: "open:blocked" }); };
      rq.onsuccess = function () {
        if (settled) { try { rq.result.close(); } catch (e) { /* ok */ } return; }
        try {
          const db = rq.result;
          const tx = db.transaction(AV_FAMILY_OS, "readwrite");
          /* structured clone of the record — the wav ArrayBuffer is cloned BY the store;
             never a transfer list (the encoder's bytes must stay addressable) */
          tx.objectStore(AV_FAMILY_OS).put(rec);
          tx.oncomplete = function () {
            try { if (timer) clearTimeout(timer); } catch (e) { /* ok */ }
            try { db.close(); } catch (e) { /* ok */ }
            done({ ok: true });
          };
          tx.onerror = function () { try { if (timer) clearTimeout(timer); } catch (e) { /* ok */ } done({ ok: false, error: "put:error" }); };
          tx.onabort = function () { try { if (timer) clearTimeout(timer); } catch (e) { /* ok */ } done({ ok: false, error: "put:abort" }); };
        } catch (e) { try { if (timer) clearTimeout(timer); } catch (e2) { /* ok */ } done({ ok: false, error: "tx:" + avFamilyMsg(e) }); }
      };
    } catch (e) {
      try { if (timer) clearTimeout(timer); } catch (e2) { /* ok */ }
      done({ ok: false, error: "idb:" + avFamilyMsg(e) });
    }
  });
}

/* §2.6 pin: IndexedDB present AND the page is same-origin-capable (http/https) for inbox.html */
function avFamilyInboxAvailable() {
  try {
    if (!avFamilyIdbSource()) return false;
    let proto = "";
    try { proto = (typeof location !== "undefined" && location) ? String(location.protocol || "") : ""; } catch (e) { proto = ""; }
    return proto === "http:" || proto === "https:";
  } catch (e) { return false; }
}

/* ---------- network + file reads (guarded; resolve null on any failure) ---------- */

function avFamilyFetch(url, ms) {
  return new Promise(function (resolve) {
    try {
      let fn = null;
      try { if (typeof fetch === "function") fn = fetch; } catch (e) { fn = null; }
      if (!fn) { try { const w = avFamilyWin(); if (w && typeof w.fetch === "function") fn = w.fetch; } catch (e) { fn = null; } }
      if (!fn) return resolve(null);
      let ctl = null, timer = null;
      try {
        if (typeof AbortController === "function") {
          ctl = new AbortController();
          if (typeof setTimeout === "function") timer = setTimeout(function () { try { ctl.abort(); } catch (e) { /* ok */ } }, ms || AV_FAMILY_FETCH_MS);
        }
      } catch (e) { ctl = null; timer = null; }
      let p = null;
      try { p = fn(url, ctl ? { signal: ctl.signal } : undefined); } catch (e) { return resolve(null); }
      Promise.resolve(p).then(
        function (r) { try { if (timer) clearTimeout(timer); } catch (e) { /* ok */ } resolve(r || null); },
        function () { try { if (timer) clearTimeout(timer); } catch (e) { /* ok */ } resolve(null); }
      );
    } catch (e) { resolve(null); }
  });
}

function avFamilyFileBuffer(file) {
  return new Promise(function (resolve) {
    try {
      if (file && typeof file.arrayBuffer === "function") {
        Promise.resolve(file.arrayBuffer()).then(
          function (b) { resolve(b || null); },
          function () { resolve(null); }
        );
        return;
      }
      if (typeof FileReader === "function") {
        const fr = new FileReader();
        fr.onload = function () { resolve(fr.result || null); };
        fr.onerror = function () { resolve(null); };
        fr.readAsArrayBuffer(file);
        return;
      }
    } catch (e) { /* fall through */ }
    resolve(null);
  });
}

function avFamilyText(u8) {
  try {
    if (typeof TextDecoder === "function") {
      const t = new TextDecoder("utf-8").decode(u8);
      return (t && t.charCodeAt(0) === 0xFEFF) ? t.slice(1) : t;
    }
  } catch (e) { /* fallback below */ }
  try {
    const b = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8);
    let s = "";
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return s;
  } catch (e) { return ""; }
}

/* a zip always starts "PK" (local header 0x04034b50 or an empty zip's EOCD 0x06054b50) */
function avFamilyLooksZip(buf) {
  try {
    const u8 = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
    return u8.length >= 2 && u8[0] === 0x50 && u8[1] === 0x4B;
  } catch (e) { return false; }
}

function avFamilyLooksXml(text) {
  try {
    const t = String(text == null ? "" : text).replace(/^\uFEFF/, "").trim();
    return t.charAt(0) === "<";
  } catch (e) { return false; }
}

/* ---------- pack base + names ---------- */

function avFamilyPackBase() {
  try { const u = avFamilySt.packBase; if (typeof u === "string" && u) return u; } catch (e) { /* default */ }
  return AV_FAMILY_PACK_BASE;
}

function avFamilySetPackBase(url) {
  try {
    if (url == null || url === "") { avFamilySt.packBase = ""; return true; }   /* reset to default */
    if (typeof url !== "string") return false;
    let u = url.trim();
    if (!u) { avFamilySt.packBase = ""; return true; }
    if (u.charAt(u.length - 1) !== "/") u += "/";
    avFamilySt.packBase = u;
    return true;
  } catch (e) { return false; }
}

function avFamilyPackUrl(id) {
  const s = avFamilyClean(id, 80);
  const suffix = /\.zip$/i.test(s) ? "" : ".zip";    /* tolerate a full file name */
  return avFamilyPackBase() + s + suffix;
}

/* ---------- the radio read (foreign keys: tolerate ANY shape; never throws; never writes) ---------- */

function avFamilyRadioRead() {
  const out = { ok: false, name: "", country: "", id: "", ts: 0, raw: false };
  try {
    const ls = avFamilyLs();
    if (!ls || typeof ls.getItem !== "function") return out;
    let lastObj = null;
    try { const s = ls.getItem(AV_FAMILY_RADIO_LS_LAST); if (s) lastObj = JSON.parse(s); } catch (e) { lastObj = null; }
    if (lastObj == null || typeof lastObj !== "object") return out;
    out.raw = true;
    try { const t = Number(lastObj.ts); if (isFinite(t) && t > 0) out.ts = t; } catch (e) { /* no ts */ }

    const pickStr = function (obj, keys) {
      try {
        for (let i = 0; i < keys.length; i++) {
          const v = obj ? obj[keys[i]] : null;
          if (typeof v === "string" && v.trim()) return v.trim().slice(0, 80);
          if (typeof v === "number" && isFinite(v)) return String(v);
        }
      } catch (e) { /* keep trying */ }
      return "";
    };
    const cands = [];
    try {
      if (lastObj.m && typeof lastObj.m === "object") cands.push(lastObj.m);
      if (lastObj.station && typeof lastObj.station === "object") cands.push(lastObj.station);
      if (typeof lastObj.n === "string" || typeof lastObj.name === "string" || typeof lastObj.title === "string") cands.push(lastObj);
    } catch (e) { /* no candidates */ }
    for (let i = 0; i < cands.length; i++) {
      if (!out.name) out.name = pickStr(cands[i], ["n", "name", "title", "s"]);
      if (!out.country) out.country = pickStr(cands[i], ["c", "country"]);
      if (!out.id) out.id = pickStr(cands[i], ["i", "id", "sid"]);
    }
    /* rbg-meta may carry the missing name/country (or a map keyed by station id) */
    if (!out.name || !out.country) {
      let metaObj = null;
      try { const s2 = ls.getItem(AV_FAMILY_RADIO_LS_META); if (s2) metaObj = JSON.parse(s2); } catch (e) { metaObj = null; }
      if (metaObj && typeof metaObj === "object") {
        const mc = [];
        try {
          if (metaObj.m && typeof metaObj.m === "object") mc.push(metaObj.m);
          if (out.id && metaObj[out.id] && typeof metaObj[out.id] === "object") mc.push(metaObj[out.id]);
          if (typeof metaObj.n === "string" || typeof metaObj.name === "string") mc.push(metaObj);
        } catch (e) { /* no candidates */ }
        for (let i = 0; i < mc.length; i++) {
          if (!out.name) out.name = pickStr(mc[i], ["n", "name", "title", "s"]);
          if (!out.country) out.country = pickStr(mc[i], ["c", "country"]);
          if (!out.id) out.id = pickStr(mc[i], ["i", "id", "sid"]);
        }
      }
    }
    out.ok = !!out.name;
    return out;
  } catch (e) {
    return { ok: false, name: "", country: "", id: "", ts: 0, raw: false };
  }
}

/* the radio deep link (the live page's hash format); q empty -> the base URL. Pure + exact. */
function avFamilyOpenRadio(q) {
  try {
    const term = (q == null) ? "" : String(q).trim();
    if (!term) return AV_FAMILY_RADIO_URL;
    return AV_FAMILY_RADIO_URL + "#q=" + encodeURIComponent(term);
  } catch (e) { return AV_FAMILY_RADIO_URL; }
}

/* never about:blank, never "_blank" (family popout law: named targets only) */
function avFamilyWindowOpen(url, target) {
  try {
    const w = avFamilyWin();
    if (w && typeof w.open === "function") return w.open(url, target);
  } catch (e) { /* blocked / no window */ }
  return null;
}

/* ---------- resonance: one parsed session record ---------- */

function avFamilyTypeName(v) {
  try {
    const n = Number(v.type);
    if (isFinite(n)) {
      const i = Math.round(n);
      if (typeof v.typeName === "string" && v.typeName.trim()) return v.typeName.trim();
      if (i >= 0 && i < AV_FAMILY_GN_TYPES.length) return AV_FAMILY_GN_TYPES[i];
      return "type " + i;
    }
  } catch (e) { /* fall through */ }
  return "";
}

function avFamilyTypesOf(session) {
  const out = [];
  try {
    const voices = (session && Array.isArray(session.voices)) ? session.voices : [];
    for (let i = 0; i < voices.length && out.length < AV_FAMILY_TYPES_CAP; i++) {
      const t = avFamilyTypeName(voices[i]);
      if (t && out.indexOf(t) < 0) out.push(t);
    }
  } catch (e) { /* none */ }
  return out;
}

function avFamilyPlayableCount(session) {
  let n = 0;
  try {
    const voices = (session && Array.isArray(session.voices)) ? session.voices : [];
    for (let i = 0; i < voices.length; i++) {
      const ti = Math.round(Number(voices[i] && voices[i].type));
      if (isFinite(ti) && ti >= 0 && ti < AV_FAMILY_GN_PLAYABLE.length && AV_FAMILY_GN_PLAYABLE[ti]) n += 1;
    }
  } catch (e) { /* 0 */ }
  return n;
}

/* name + xml -> the list record; parse refusals are kept visible, never hidden */
function avFamilySessionRec(name, xml) {
  const rec = { name: "", ok: false, error: "", info: null, parsed: null, bytes: 0 };
  try {
    rec.name = avFamilyClean(name, 80) || "session";
    const fns = avFamilyFns();
    if (!fns.gnParse) { rec.error = "the Resonance reader (av_gnParse) is not loaded"; return rec; }
    let pr = null;
    try { pr = fns.gnParse(xml); } catch (e) { pr = null; }
    if (!pr || pr.ok !== true || !pr.session) {
      rec.error = pr ? avFamilyErrText(pr, "parse refused") : "the parser refused this session";
      return rec;
    }
    rec.parsed = pr;
    rec.ok = true;
    const session = pr.session;
    let info = null;
    if (fns.gnInfo) { try { info = fns.gnInfo(session); } catch (e) { info = null; } }
    if (!info || typeof info !== "object") {
      info = {
        totalSeconds: avFamilyNum(session.totalSeconds, 0),
        voiceCount: avFamilyInt(session.voiceCount, 0, 0, 4096),
        playableVoices: avFamilyPlayableCount(session),
        types: avFamilyTypesOf(session),
        renderable: avFamilyPlayableCount(session) > 0,
      };
    }
    rec.info = {
      totalSeconds: avFamilyNum(info.totalSeconds, avFamilyNum(session.totalSeconds, 0)),
      voiceCount: avFamilyInt(info.voiceCount, avFamilyInt(session.voiceCount, 0, 0, 4096), 0, 4096),
      playableVoices: avFamilyInt(info.playableVoices, avFamilyPlayableCount(session), 0, 4096),
      types: Array.isArray(info.types) && info.types.length ? info.types.slice(0, AV_FAMILY_TYPES_CAP) : avFamilyTypesOf(session),
      renderable: info.renderable !== false,
    };
    try { rec.bytes = String(xml == null ? "" : xml).length; } catch (e) { rec.bytes = 0; }
    return rec;
  } catch (e) {
    rec.error = "session parse failed: " + avFamilyMsg(e);
    return rec;
  }
}

/* build {name, xml} items from an avGnUnzip file list (the fallback when avGnSessionsFromZip
   is absent or refuses) — .gnaural entries only, case-insensitive, BOM-tolerant decode */
function avFamilySessionsFromFiles(files) {
  const out = [];
  try {
    const list = Array.isArray(files) ? files : [];
    for (let i = 0; i < list.length && out.length < AV_FAMILY_SESSIONS_CAP; i++) {
      const f = list[i];
      if (!f || typeof f.name !== "string" || !/\.gnaural$/i.test(f.name)) continue;
      const bytes = f.bytes;
      const xml = (typeof bytes === "string") ? bytes : avFamilyText(bytes);
      out.push({ name: f.name, xml: xml, bytes: avFamilyByteLen(bytes) });
    }
  } catch (e) { /* empty */ }
  return out;
}

/* ---------- resonance: import ---------- */

async function avFamilyImportRun(src) {
  const st = avFamilySt;
  const fns = avFamilyFns();
  try {
    if (!fns.gnUnzip && !fns.gnParse) {
      return { ok: false, error: "the Resonance reader (av_gnaural.js) is not loaded — import is unavailable" };
    }
    let buf = null;
    let label = "";
    let isLocalName = "";
    if (typeof src === "string") {
      const id = src.trim();
      if (!id) return { ok: false, error: "no pack selected" };
      label = id;
      const url = avFamilyPackUrl(id);
      avFamilySetRowStatus("resonance", "fetching " + avFamilyClean(url, 72) + "\u2026", "msg");
      const res = await avFamilyFetch(url, AV_FAMILY_FETCH_MS);
      if (!res || res.ok !== true) {
        const detail = res && res.status != null ? ("HTTP " + res.status) : "network/blocked";
        return {
          ok: false, error: "could not fetch pack \"" + id + "\" (" + detail + ")",
          note: "packs live on moddys.net; import a .zip from disk instead",
        };
      }
      let ab = null;
      try { ab = await res.arrayBuffer(); } catch (e) { ab = null; }
      buf = avFamilyAb(ab);
      if (!buf) return { ok: false, error: "the pack download returned no bytes", note: "import a .zip from disk instead" };
    } else if (src && typeof src === "object" && typeof src.arrayBuffer === "function") {
      label = (typeof src.name === "string" && src.name) ? src.name : "local file";
      isLocalName = label;
      const ab = await avFamilyFileBuffer(src);
      buf = avFamilyAb(ab);
      if (!buf) return { ok: false, error: "the file could not be read" };
    } else {
      buf = avFamilyAb(src);
      if (!buf) return { ok: false, error: "nothing to import (pass a pack id, a File, or zip bytes)" };
      label = "local file";
    }

    const byteLen = avFamilyByteLen(buf);
    if (!byteLen) return { ok: false, error: "the import is empty" };

    /* single .gnaural (local leg): a loose XML file, not a zip — parse it directly */
    const singleXml = /\.gnaural$/i.test(isLocalName) && !avFamilyLooksZip(buf);

    let recs = [];
    let note = "";
    if (singleXml) {
      const xml = avFamilyText(new Uint8Array(buf));
      if (!avFamilyLooksXml(xml)) return { ok: false, error: "this file is not .gnaural XML" };
      recs = [avFamilySessionRec(isLocalName.replace(/\.gnaural$/i, ""), xml)];
    } else {
      if (!fns.gnUnzip) return { ok: false, error: "the zip reader (avGnUnzip) is not loaded" };
      avFamilySetRowStatus("resonance", "unzipping " + avFamilyClean(label, 60) + "\u2026", "msg");
      let zr = null;
      try { zr = await fns.gnUnzip(buf); } catch (e) { zr = null; }
      if (!zr || zr.ok !== true) {
        /* a mislabeled / non-zip loose XML still gets one honest chance */
        const xml = avFamilyText(new Uint8Array(buf));
        if (avFamilyLooksXml(xml)) {
          recs = [avFamilySessionRec(String(label).replace(/\.(zip|gnaural)$/i, ""), xml)];
        } else {
          return { ok: false, error: "unzip refused: " + (zr ? avFamilyErrText(zr, "not a readable zip") : "the reader threw") };
        }
      } else {
        const files = Array.isArray(zr.files) ? zr.files : [];
        const decoys = [];
        for (let i = 0; i < files.length && decoys.length < 3; i++) {
          const nm = (files[i] && typeof files[i].name === "string") ? files[i].name : "";
          if (nm && !/\.gnaural$/i.test(nm) && nm.charAt(nm.length - 1) !== "/") decoys.push(nm);
        }
        const zrn = [];
        if (decoys.length) zrn.push("skipped " + decoys.length + " non-session file(s): " + decoys.join(", "));
        if (Array.isArray(zr.errors) && zr.errors.length) zrn.push("reader notes: " + zr.errors.slice(0, 2).join(" | "));
        note = zrn.join(" \u00b7 ");
        let items = null;
        if (fns.gnSessions) {
          try { const sr = await fns.gnSessions(buf); if (sr && sr.ok === true && Array.isArray(sr.sessions)) items = sr.sessions; } catch (e) { items = null; }
        }
        if (!items) items = avFamilySessionsFromFiles(files);
        if (!items.length) {
          return { ok: false, error: "no .gnaural sessions in this pack", note: note || undefined };
        }
        for (let i = 0; i < items.length && recs.length < AV_FAMILY_SESSIONS_CAP; i++) {
          const it = items[i] || {};
          const nm = (typeof it.name === "string" && it.name) ? it.name : ("session " + (i + 1));
          const xml = (typeof it.xml === "string") ? it.xml : avFamilyText(it.bytes);
          recs.push(avFamilySessionRec(nm, xml));
        }
      }
    }

    if (!recs.length) return { ok: false, error: "no sessions found in this import" };
    st.sessions = recs;
    st.selected = -1;
    for (let i = 0; i < recs.length; i++) if (recs[i].ok) { st.selected = i; break; }
    st.resNote = note;
    const failed = recs.length - recs.filter(function (r) { return r.ok; }).length;
    const receipt = {
      ok: true, source: avFamilyClean(label, 80), sessions: recs.length, failed: failed,
    };
    if (note) receipt.note = note;
    st.receipts.resonance = receipt;
    avFamilySetRowStatus("resonance", "imported " + avFamilyClean(label, 48) + " \u2014 " + recs.length + " session" + (recs.length === 1 ? "" : "s") + (failed ? " (" + failed + " refused)" : ""), "msg");
    return receipt;
  } catch (e) {
    return { ok: false, error: "import failed: " + avFamilyMsg(e) };
  }
}

function avFamilyImportPack(src) {
  return new Promise(function (resolve) {
    try {
      const st = avFamilySt;
      if (st.busy) { resolve({ ok: false, error: "an operation is already running (" + (st.busyOp || "working") + ") \u2014 one at a time" }); return; }
      st.busy = true;
      st.busyOp = "import";
      avFamilyPaint(avFamilyHost());
      avFamilyImportRun(src).then(
        function (r) {
          st.busy = false; st.busyOp = "";
          if (r && r.ok !== true) avFamilySetRowStatus("resonance", "import refused \u2014 " + avFamilyClean(avFamilyErrText(r, "refused"), 80) + (r.note ? " \u00b7 " + avFamilyClean(r.note, 90) : ""), "err");
          avFamilyPaint(avFamilyHost()); resolve(r);
        },
        function (e) { st.busy = false; st.busyOp = ""; avFamilySetRowStatus("resonance", "import failed \u2014 " + avFamilyMsg(e), "err"); avFamilyPaint(avFamilyHost()); resolve({ ok: false, error: avFamilyMsg(e) }); }
      );
    } catch (e) {
      resolve({ ok: false, error: avFamilyMsg(e) });
    }
  });
}

/* ---------- resonance: preview / stop / save ---------- */

async function avFamilyPreviewRun(i) {
  const st = avFamilySt;
  const fns = avFamilyFns();
  try {
    if (!st.sessions.length) return { ok: false, error: "no sessions imported \u2014 fetch a pack or import a file first" };
    let idx = avFamilyInt(i, st.selected, -1, 4096);
    if (idx < 0 || idx >= st.sessions.length) {
      idx = st.selected >= 0 && st.selected < st.sessions.length ? st.selected : -1;
    }
    if (idx < 0) return { ok: false, error: "no session selected" };
    const rec = st.sessions[idx];
    if (!rec || rec.ok !== true || !rec.parsed || !rec.parsed.session) {
      return { ok: false, error: "session refused \u2014 " + (rec ? (rec.error || "parse refused") : "missing") };
    }
    if (rec.info && rec.info.renderable === false) {
      return { ok: false, error: "this session has no playable voices (v1 renders binaural / white / brown noise)" };
    }
    if (!fns.gnRender) return { ok: false, error: "the renderer (avGnRender) is not loaded" };

    avFamilyStopInternal();   /* one preview at a time — a new one replaces the old */

    let ctx = avFamilyLiveCtx(fns);
    if (!ctx && fns.engineEnsure) {
      try { await fns.engineEnsure(); } catch (e) { /* refused — checked below */ }
      ctx = avFamilyLiveCtx(fns);
    }
    if (!ctx) return { ok: false, error: "no live audio context yet \u2014 unlock the engine first (press a key or play a note)" };
    const master = avFamilyMasterInput(fns, ctx);
    if (!master) return { ok: false, error: "the master tap is not available yet \u2014 start the engine first" };

    avFamilySetRowStatus("resonance", "rendering \u00ab" + avFamilyClean(rec.name, 40) + "\u00bb \u2014 capped at " + AV_FAMILY_PREVIEW_CAP_S + " s\u2026", "msg");
    let r = null;
    try { r = await fns.gnRender(rec.parsed.session, { maxSeconds: AV_FAMILY_PREVIEW_CAP_S }); } catch (e) { r = null; }
    if (!r || r.ok !== true) {
      return { ok: false, error: "render refused: " + (r ? avFamilyErrText(r, "refused") : "the renderer threw") };
    }
    const l = r.l, rr = r.r;
    if (!l || !rr || typeof l.length !== "number" || l.length <= 0 || rr.length !== l.length) {
      return { ok: false, error: "the render returned no usable channels" };
    }
    const n = Math.min(l.length, rr.length);
    const sr = avFamilyNum(r.sr, ctx.sampleRate) || 48000;
    const seconds = avFamilyNum(r.seconds, n / sr);

    let buf = null;
    try {
      buf = ctx.createBuffer(2, n, sr);
      buf.getChannelData(0).set(l.subarray ? l.subarray(0, n) : l);
      buf.getChannelData(1).set(rr.subarray ? rr.subarray(0, n) : rr);
    } catch (e) { buf = null; }
    if (!buf) return { ok: false, error: "could not build the preview buffer on the live context" };

    let src = null;
    try {
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(master);                        /* the MASTER tap input — never ctx.destination */
      src.start();
    } catch (e) {
      try { if (src && src.disconnect) src.disconnect(); } catch (e2) { /* ok */ }
      return { ok: false, error: "starting the preview failed: " + avFamilyMsg(e) };
    }
    st.preview = { src: src, ctx: ctx };
    st.lastRender = { l: l, r: rr, sr: sr, seconds: seconds, frames: n, name: avFamilyClean(rec.name, 60) || "session", capped: false };
    try {
      src.onended = function () {
        try { if (avFamilySt.preview && avFamilySt.preview.src === src) { avFamilySt.preview = null; avFamilyPaint(avFamilyHost()); } }
        catch (e) { /* ok */ }
      };
    } catch (e) { /* onended is a nicety */ }

    const total = rec.info && isFinite(Number(rec.info.totalSeconds)) ? Number(rec.info.totalSeconds) : null;
    const capped = (total != null && total > seconds + 0.05) || (seconds >= AV_FAMILY_PREVIEW_CAP_S - 0.01);
    st.lastRender.capped = capped;
    const receipt = { ok: true, seconds: seconds, sr: sr, frames: n, capped: capped, via: "master-tap", index: idx, name: st.lastRender.name };
    if (capped) receipt.note = "preview capped at " + AV_FAMILY_PREVIEW_CAP_S + " s (the session is longer)";
    st.receipts.resonance = receipt;
    avFamilySetRowStatus("resonance", "previewing \u00ab" + st.lastRender.name + "\u00bb \u2014 " + avFamilyFmtDur(seconds) + " @ " + sr + " Hz" + (capped ? " \u00b7 capped at " + AV_FAMILY_PREVIEW_CAP_S + " s" : ""), "msg");
    return receipt;
  } catch (e) {
    return { ok: false, error: "preview failed: " + avFamilyMsg(e) };
  }
}

function avFamilyPreview(i) {
  return new Promise(function (resolve) {
    try {
      const st = avFamilySt;
      if (st.busy) { resolve({ ok: false, error: "an operation is already running (" + (st.busyOp || "working") + ") \u2014 one at a time" }); return; }
      st.busy = true;
      st.busyOp = "preview";
      avFamilyPaint(avFamilyHost());
      avFamilyPreviewRun(i).then(
        function (r) {
          st.busy = false; st.busyOp = "";
          if (r && r.ok !== true) avFamilySetRowStatus("resonance", "preview refused \u2014 " + avFamilyClean(avFamilyErrText(r, "refused"), 80) + (r.note ? " \u00b7 " + avFamilyClean(r.note, 90) : ""), "err");
          avFamilyPaint(avFamilyHost()); resolve(r);
        },
        function (e) { st.busy = false; st.busyOp = ""; avFamilyPaint(avFamilyHost()); resolve({ ok: false, error: avFamilyMsg(e) }); }
      );
    } catch (e) {
      resolve({ ok: false, error: avFamilyMsg(e) });
    }
  });
}

function avFamilyStopInternal() {
  try {
    const st = avFamilySt;
    if (!st.preview) return false;
    const p = st.preview;
    st.preview = null;
    try { if (p.src && typeof p.src.stop === "function") p.src.stop(); } catch (e) { /* already ended */ }
    try { if (p.src && typeof p.src.disconnect === "function") p.src.disconnect(); } catch (e) { /* gone */ }
    return true;
  } catch (e) { return false; }
}

function avFamilyStop() {
  try {
    const was = avFamilyStopInternal();
    if (was) {
      avFamilySt.receipts.resonance = { ok: true, stopped: true };
      avFamilySetRowStatus("resonance", "preview stopped", "msg");
    }
    avFamilyPaint(avFamilyHost());
    return was;
  } catch (e) { return false; }
}

/* save the LAST rendered buffer as a WAV via avWavEncode (the same call pattern as
   av_deliver_ui.js: { l, r, sr, bits, dither }) -> the house download path */
function avFamilySave() {
  try {
    const st = avFamilySt;
    if (!st.lastRender) {
      avFamilySetRowStatus("resonance", "save refused \u2014 render a preview first", "err");
      avFamilyPaint(avFamilyHost());
      return false;
    }
    const fns = avFamilyFns();
    if (!fns.wav) {
      avFamilySetRowStatus("resonance", "save refused \u2014 the WAV encoder (av_wavio.js) is not loaded", "err");
      avFamilyPaint(avFamilyHost());
      return false;
    }
    const lr = st.lastRender;
    let wav = null;
    try { wav = fns.wav({ l: lr.l, r: lr.r, sr: lr.sr, bits: 16, dither: "auto" }); } catch (e) { wav = null; }
    wav = avFamilyAb(wav);
    if (!wav) {
      avFamilySetRowStatus("resonance", "save refused \u2014 the WAV encode returned no bytes", "err");
      avFamilyPaint(avFamilyHost());
      return false;
    }
    const name = "resonance_" + avFamilySafeName(lr.name, "session") + ".wav";
    const ok = avFamilyDownload(wav, name);
    const receipt = ok
      ? { ok: true, name: name, bytes: wav.byteLength, sr: lr.sr, seconds: lr.seconds }
      : { ok: false, error: "the browser refused the download" };
    st.receipts.resonance = receipt;
    avFamilySetRowStatus("resonance", ok ? ("saved " + name + " \u00b7 " + avFamilyFmtSize(wav.byteLength)) : receipt.error, ok ? "msg" : "err");
    avFamilyPaint(avFamilyHost());
    return ok;
  } catch (e) { return false; }
}

/* ---------- hub: bounce -> encode -> outbox -> inbox ---------- */

function avFamilySnapName(fns) {
  try {
    if (fns && fns.seqSnap) {
      const s = fns.seqSnap();
      if (s && typeof s.name === "string" && s.name.trim()) return s.name.trim();
    }
  } catch (e) { /* no name */ }
  return "";
}

async function avFamilySendRun(opts) {
  const st = avFamilySt;
  const fns = avFamilyFns();
  try {
    const o = (opts && typeof opts === "object") ? opts : {};
    let loops = null;
    if (o.loops != null && isFinite(Number(o.loops))) loops = avFamilyInt(o.loops, AV_FAMILY_LOOP_DEF, AV_FAMILY_LOOPS_MIN, AV_FAMILY_LOOPS_MAX);
    if (loops == null) loops = avFamilyLoopsRead(avFamilyHost());

    if (!fns.bounce) return { ok: false, error: "the offline renderer (av_bounce.js) is not loaded \u2014 the hub handshake is unavailable" };
    avFamilySetRowStatus("hub", "bouncing " + loops + " loop" + (loops === 1 ? "" : "s") + " offline\u2026", "msg");

    let r = null;
    try { r = await fns.bounce({ loops: loops, includeParts: false, includeMaster: true, tailS: AV_FAMILY_HUB_TAIL_S, sr: AV_FAMILY_HUB_SR }); }
    catch (e) { r = null; }
    if (!r || r.ok !== true) {
      const why = r ? avFamilyErrText(r, "the renderer refused") : "the renderer threw";
      return { ok: false, error: "bounce refused \u2014 " + why };
    }
    const master = r.master;
    const usable = !!(master && master.l && master.r &&
      typeof master.l.length === "number" && master.l.length > 0 && master.l.length === master.r.length);
    if (!usable) return { ok: false, error: "the bounce returned no master channels (empty pattern?)" };

    const sr = avFamilyInt(r.sr, AV_FAMILY_HUB_SR, 8000, 192000);
    const sec = Math.round(avFamilyNum(r.seconds, master.l.length / sr) * 1000) / 1000;
    const bpm = avFamilyInt(r.bpm, 120, 20, 300);
    const cycleSteps = avFamilyInt(r.cycleSteps, 16, 1, 64);
    const bars = avFamilyBars(loops, cycleSteps);

    if (!fns.wav) return { ok: false, error: "the WAV encoder (av_wavio.js) is not loaded \u2014 the hub handshake is unavailable" };
    let wav = null;
    try { wav = fns.wav({ l: master.l, r: master.r, sr: sr, bits: 16, dither: "auto" }); } catch (e) { wav = null; }
    wav = avFamilyAb(wav);
    if (!wav || wav.byteLength <= 0) return { ok: false, error: "the master WAV encode returned no bytes" };

    const base = avFamilySafeName(avFamilySnapName(fns), "anvil_loop");
    const name = base + "_" + bpm + "bpm_" + loops + "loops.wav";
    const bytes = wav.byteLength;

    if (avFamilyInboxAvailable()) {
      const at = Date.now();
      const rec = {
        id: String(at) + "-" + avFamilyHex6(),
        name: name,
        kind: "loop",
        bpm: bpm,
        bars: bars,
        sec: sec,
        sr: sr,
        ch: 2,
        bytes: bytes,
        at: at,
        wav: wav,             /* structured clone by the store — never a transfer list */
      };
      avFamilySetRowStatus("hub", "writing the bridge record\u2026", "msg");
      const wr = await avFamilyOutboxPut(rec);
      if (wr && wr.ok === true) {
        const w = avFamilyWindowOpen(AV_FAMILY_INBOX_URL, AV_FAMILY_INBOX_TARGET);
        const receipt = { ok: true, via: "inbox", bytes: bytes, sec: sec, bpm: bpm, bars: bars, name: name, loops: loops };
        if (!w) receipt.note = "the inbox popup was blocked \u2014 open inbox.html from the app folder";
        st.receipts.hub = receipt;
        avFamilySetRowStatus("hub", "sent to the hub inbox \u2014 " + name + " \u00b7 " + avFamilyFmtSize(bytes) + " \u00b7 " + avFamilyFmtDur(sec), "msg");
        return receipt;
      }
      /* the store refused after all — honest fallback to the file */
      return avFamilySendFallback(wav, name, bytes, sec, bpm, bars, loops,
        "the bridge store refused (" + ((wr && wr.error) || "unknown") + ") \u2014 saved as a file instead; the hub inbox needs moddys.net (same origin)");
    }
    return avFamilySendFallback(wav, name, bytes, sec, bpm, bars, loops,
      "saved as a file \u2014 the hub inbox needs moddys.net (same origin)");
  } catch (e) {
    return { ok: false, error: "hub send failed: " + avFamilyMsg(e) };
  }
}

function avFamilySendFallback(wav, name, bytes, sec, bpm, bars, loops, note) {
  try {
    const st = avFamilySt;
    const ok = avFamilyDownload(wav, name);
    const receipt = ok
      ? { ok: true, via: "download", bytes: bytes, sec: sec, bpm: bpm, bars: bars, name: name, loops: loops, note: note }
      : { ok: false, via: "download", error: "the browser refused the download", note: note };
    st.receipts.hub = receipt;
    avFamilySetRowStatus("hub", ok ? ("saved " + name + " \u00b7 " + avFamilyFmtSize(bytes) + " \u2014 the hub inbox needs moddys.net") : receipt.error, ok ? "msg" : "err");
    return receipt;
  } catch (e) {
    return { ok: false, error: avFamilyMsg(e), note: note };
  }
}

function avFamilySend(opts) {
  return new Promise(function (resolve) {
    try {
      const st = avFamilySt;
      if (st.busy) { resolve({ ok: false, error: "an operation is already running (" + (st.busyOp || "working") + ") \u2014 one at a time" }); return; }
      st.busy = true;
      st.busyOp = "send";
      avFamilyPaint(avFamilyHost());
      avFamilySendRun(opts).then(
        function (r) {
          st.busy = false; st.busyOp = "";
          if (r && r.ok !== true) avFamilySetRowStatus("hub", "send refused \u2014 " + avFamilyClean(avFamilyErrText(r, "refused"), 80) + (r.note ? " \u00b7 " + avFamilyClean(r.note, 90) : ""), "err");
          avFamilyPaint(avFamilyHost()); resolve(r);
        },
        function (e) { st.busy = false; st.busyOp = ""; avFamilySetRowStatus("hub", "send failed \u2014 " + avFamilyMsg(e), "err"); avFamilyPaint(avFamilyHost()); resolve({ ok: false, error: avFamilyMsg(e) }); }
      );
    } catch (e) {
      resolve({ ok: false, error: avFamilyMsg(e) });
    }
  });
}

/* ---------- loops select read ---------- */

function avFamilyLoopsRead(hostArg) {
  try {
    const host = hostArg || avFamilyHost();
    if (host && typeof host.querySelector === "function") {
      const el = host.querySelector("#av-fam-hub-loops");
      if (el) return avFamilyInt(el.value, AV_FAMILY_LOOP_DEF, AV_FAMILY_LOOPS_MIN, AV_FAMILY_LOOPS_MAX);
    }
  } catch (e) { /* default */ }
  return AV_FAMILY_LOOP_DEF;
}

/* ---------- painting (every reach guarded; no console) ---------- */

function avFamilySetRowStatus(row, msg, kind) {
  try {
    const st = avFamilySt;
    if (st.statuses && row in st.statuses) st.statuses[row] = { msg: String(msg == null ? "" : msg), kind: (kind === "err") ? "err" : "msg" };
    avFamilyPaintRowStatus(row);
  } catch (e) { /* nicety */ }
}

function avFamilyPaintRowStatus(row) {
  try {
    const host = avFamilyHost();
    if (!host || typeof host.querySelector !== "function") return false;
    const ids = { hub: "#av-fam-hub-status", resonance: "#av-fam-res-status", radio: "#av-fam-radio-status" };
    const el = host.querySelector(ids[row]);
    if (!el) return false;
    let rec = avFamilySt.statuses ? avFamilySt.statuses[row] : null;
    if (rec && typeof rec === "object" && rec.msg) {
      if (el.textContent !== rec.msg) el.textContent = rec.msg;
      const cls = "av-fam-status " + (rec.kind === "err" ? "av-fam-err" : "av-fam-msg");
      if (el.className !== cls) el.className = cls;
      return true;
    }
    return false;
  } catch (e) { return false; }
}

function avFamilyRadioLine() {
  try {
    const rd = avFamilyRadioRead();
    avFamilySt.radio = rd;
    if (rd.ok) return "MODDYS WORLD RADIO \u2014 you last played: " + rd.name + (rd.country ? " (" + rd.country + ")" : "");
    if (rd.raw) return "MODDYS WORLD RADIO \u2014 history found, but no station name in it \u2014 open the radio to play";
    return "MODDYS WORLD RADIO \u2014 no history yet \u2014 open the radio to play";
  } catch (e) { return "MODDYS WORLD RADIO"; }
}

function avFamilyPaintRadio() {
  try {
    /* a stored action message stays; otherwise the honest last-played line (re-read per paint) */
    const st = avFamilySt;
    if (!st.statuses.radio) st.statuses.radio = { msg: avFamilyRadioLine(), kind: "msg" };
    return avFamilyPaintRowStatus("radio");
  } catch (e) { return false; }
}

function avFamilySessionHTML(rec, i, selected) {
  const sub = rec.ok
    ? (avFamilyFmtDur(rec.info ? rec.info.totalSeconds : 0) + (rec.info && rec.info.types.length ? " \u00b7 " + rec.info.types.join(" \u00b7 ") : ""))
    : ("refused \u2014 " + avFamilyClean(rec.error || "parse refused", 90));
  const cls = "av-fam-session" + (i === selected ? " av-fam-selected" : "") + (rec.ok ? "" : " av-fam-bad");
  return '<div class="' + cls + '" data-av-fam-session="' + i + '" role="option" aria-selected="' + (i === selected ? "true" : "false") + '">' +
    '<span class="av-fam-session-name">' + avFamilyEsc(rec.name) + "</span>" +
    '<span class="av-fam-session-sub av-dim">' + avFamilyEsc(sub) + "</span></div>";
}

function avFamilyPaintSessions() {
  try {
    const host = avFamilyHost();
    if (!host || typeof host.querySelector !== "function") return false;
    const el = host.querySelector("#av-fam-res-list");
    if (!el) return false;
    const st = avFamilySt;
    let html = "";
    if (!st.sessions.length) {
      html = '<p class="av-fam-note av-fam-empty av-dim">no sessions yet \u2014 fetch a pack or pick a local file</p>';
    } else {
      for (let i = 0; i < st.sessions.length && i < AV_FAMILY_SESSIONS_CAP; i++) html += avFamilySessionHTML(st.sessions[i], i, st.selected);
    }
    if (html !== st.lastSessionsHtml) { st.lastSessionsHtml = html; el.innerHTML = html; }
    const noteEl = host.querySelector("#av-fam-res-note");
    if (noteEl) {
      const t = String(st.resNote || "");
      noteEl.hidden = !t;
      if (t && noteEl.textContent !== t) noteEl.textContent = t;
    }
    return true;
  } catch (e) { return false; }
}

function avFamilyPaintBusy() {
  try {
    const host = avFamilyHost();
    if (!host || typeof host.querySelector !== "function") return false;
    const st = avFamilySt;
    const root = host.querySelector(".av-family");
    if (root && root.classList && typeof root.classList.toggle === "function") {
      try { root.classList.toggle("av-fam-busy", !!st.busy); } catch (e) { /* nicety */ }
    }
    const anyOk = st.sessions.some(function (r) { return r.ok; });
    const sets = [
      ["#av-fam-hub-send", !!st.busy],
      ["#av-fam-res-import", !!st.busy],
      ["#av-fam-res-preview", !!st.busy || !anyOk],
      ["#av-fam-res-save", !!st.busy || !st.lastRender],
    ];
    for (let i = 0; i < sets.length; i++) {
      const el = host.querySelector(sets[i][0]);
      if (el && el.disabled !== sets[i][1]) el.disabled = sets[i][1];
    }
    return true;
  } catch (e) { return false; }
}

function avFamilyPaint(hostArg) {
  try {
    avFamilyPaintRowStatus("hub");
    avFamilyPaintRowStatus("resonance");
    avFamilyPaintRadio();
    avFamilyPaintSessions();
    avFamilyPaintBusy();
    return true;
  } catch (e) { return false; }
}

/* ---------- markup (pure string builders) ---------- */

function avFamilyPackOptionsHTML() {
  let html = "";
  for (let i = 0; i < AV_FAMILY_PACK_IDS.length; i++) {
    const id = AV_FAMILY_PACK_IDS[i];
    html += '<option value="' + avFamilyEsc(id) + '"' + (i === 0 ? " selected" : "") + ">" + avFamilyEsc(id) + "</option>";
  }
  return html;
}

function avFamilyChromeHTML() {
  return '<div class="av-family" data-av-family="1">' +
    '<div class="av-fam-head"><span class="av-fam-title">FAMILY</span>' +
    '<span class="av-fam-cap av-dim">three local bridges \u2014 bounce the loop into the Music Hub inbox, import Resonance sessions and play them through the master tap, and cross-link MODDYS World Radio. Nothing is uploaded.</span></div>' +

    '<div class="av-fam-row" data-av-fam-row="hub">' +
    '<div class="av-fam-row-title">SUITE \u2192 MUSIC HUB</div>' +
    '<div class="av-fam-controls">' +
    '<label class="av-fam-field"><span class="av-fam-field-lbl">LOOPS</span>' +
    '<select class="av-select av-fam-select av-fam-loops" id="av-fam-hub-loops" aria-label="Loop length in pattern cycles">' +
    '<option value="2">2</option><option value="4">4</option><option value="8" selected>8</option></select></label>' +
    '<button type="button" class="av-btn mini av-fam-btn" id="av-fam-hub-send" title="Bounce the master offline (16-bit / 48 kHz), drop it in the hub inbox and open it">SEND TO HUB</button>' +
    "</div>" +
    '<div class="av-fam-status-line"><span class="av-fam-status av-fam-msg" id="av-fam-hub-status" role="status">ready \u2014 bounce the current loop and send it to the hub inbox</span></div>' +
    "</div>" +

    '<div class="av-fam-row" data-av-fam-row="resonance">' +
    '<div class="av-fam-row-title">RESONANCE</div>' +
    '<div class="av-fam-controls">' +
    '<label class="av-fam-field"><span class="av-fam-field-lbl">PACK</span>' +
    '<select class="av-select av-fam-select av-fam-pack" id="av-fam-res-pack" aria-label="Resonance pack id">' +
    avFamilyPackOptionsHTML() + "</select></label>" +
    '<button type="button" class="av-btn mini av-fam-btn" id="av-fam-res-import" title="Fetch the selected pack from moddys.net and list its sessions">FETCH AND IMPORT</button>' +
    '<label class="av-btn mini av-fam-btn av-fam-file" title="Import a Resonance .zip or a single .gnaural from disk">LOCAL FILE' +
    '<input type="file" class="av-fam-file-in" id="av-fam-res-file" hidden accept=".zip,.gnaural,application/zip,application/xml,text/xml"></label>' +
    '<button type="button" class="av-btn mini av-fam-btn" id="av-fam-res-preview" title="Render the selected session (120 s cap) and play it through the master tap" disabled>PREVIEW</button>' +
    '<button type="button" class="av-btn mini av-fam-btn" id="av-fam-res-save" title="Save the last rendered preview as a WAV" disabled>SAVE WAV</button>' +
    "</div>" +
    '<div class="av-fam-status-line"><span class="av-fam-status av-fam-msg" id="av-fam-res-status" role="status">no pack yet \u2014 fetch a pack or import a .zip / .gnaural</span></div>' +
    '<div class="av-fam-list" id="av-fam-res-list" role="listbox" aria-label="imported sessions"></div>' +
    '<p class="av-fam-note av-dim" id="av-fam-res-note" hidden></p>' +
    "</div>" +

    '<div class="av-fam-row" data-av-fam-row="radio">' +
    '<div class="av-fam-row-title">MODDYS WORLD RADIO</div>' +
    '<div class="av-fam-controls">' +
    '<button type="button" class="av-btn mini av-fam-btn" id="av-fam-radio-open" title="Open MODDYS World Radio in a new tab">OPEN RADIO</button>' +
    '<label class="av-fam-field"><span class="av-fam-field-lbl">SEARCH</span>' +
    '<input type="text" class="av-fam-text av-fam-search" id="av-fam-radio-q" placeholder="station or genre" spellcheck="false" autocomplete="off" aria-label="Search MODDYS World Radio"></label>' +
    '<button type="button" class="av-btn mini av-fam-btn" id="av-fam-radio-go" title="Open the radio search deep link">GO</button>' +
    "</div>" +
    '<div class="av-fam-status-line"><span class="av-fam-status av-fam-msg" id="av-fam-radio-status" role="status">MODDYS WORLD RADIO</span></div>' +
    '<p class="av-fam-note av-dim">reads your radio history (rbg-last / rbg-meta) when both run on moddys.net \u2014 same-origin localStorage only; nothing is written and nothing is uploaded.</p>' +
    "</div>" +

    "</div>";
}

/* ---------- wiring (one delegation per host, guarded) ---------- */

function avFamilyRadioOpenAction(url, label) {
  try {
    const w = avFamilyWindowOpen(url, AV_FAMILY_RADIO_TARGET);
    const receipt = { ok: true, url: url, target: AV_FAMILY_RADIO_TARGET };
    if (!w) receipt.note = "the popup was blocked \u2014 allow popups for moddys.net";
    avFamilySt.receipts.radio = receipt;
    avFamilySetRowStatus("radio", (label || "opening") + " \u2014 " + url, "msg");
    return receipt;
  } catch (e) {
    return { ok: false, error: avFamilyMsg(e) };
  }
}

function avFamilyClick(ev) {
  try {
    const t = ev && ev.target;
    if (!t || typeof t.closest !== "function") return;
    if (t.closest("#av-fam-hub-send")) { avFamilySend(); return; }
    if (t.closest("#av-fam-res-import")) { avFamilyImportPack(avFamilyPackSelectValue()); return; }
    if (t.closest("#av-fam-res-preview")) { avFamilyPreview(); return; }
    if (t.closest("#av-fam-res-save")) { avFamilySave(); return; }
    if (t.closest("#av-fam-radio-open")) { avFamilyRadioOpenAction(AV_FAMILY_RADIO_URL, "opening MODDYS World Radio"); return; }
    if (t.closest("#av-fam-radio-go")) { avFamilyRadioGo(); return; }
    const sRow = t.closest("[data-av-fam-session]");
    if (sRow) {
      const idx = Math.round(Number(sRow.getAttribute && sRow.getAttribute("data-av-fam-session")));
      if (isFinite(idx) && idx >= 0 && idx < avFamilySt.sessions.length && avFamilySt.selected !== idx) {
        avFamilySt.selected = idx;
        avFamilyPaintSessions();
      }
    }
  } catch (e) { /* a listener never throws outward */ }
}

function avFamilyRadioGo() {
  try {
    const host = avFamilyHost();
    let term = "";
    if (host && typeof host.querySelector === "function") {
      const el = host.querySelector("#av-fam-radio-q");
      if (el) term = String(el.value == null ? "" : el.value);
    }
    const url = avFamilyOpenRadio(term);
    return avFamilyRadioOpenAction(url, term.trim() ? ("searching \u00ab" + avFamilyClean(term, 30) + "\u00bb") : "opening MODDYS World Radio");
  } catch (e) { return { ok: false, error: avFamilyMsg(e) }; }
}

function avFamilyKeyDown(ev) {
  try {
    const t = ev && ev.target;
    if (!t || t.id !== "av-fam-radio-q") return;
    const key = (ev.key != null) ? String(ev.key) : "";
    if (key === "Enter") { ev.preventDefault(); avFamilyRadioGo(); }
  } catch (e) { /* a listener never throws outward */ }
}

function avFamilyChange(ev) {
  try {
    const t = ev && ev.target;
    if (!t || typeof t.closest !== "function") return;
    if (t.closest("#av-fam-res-file")) {
      const file = (t.files && t.files[0]) ? t.files[0] : null;
      try { t.value = ""; } catch (e) { /* the picker resets so the same file can be picked again */ }
      if (file) avFamilyImportPack(file);
      return;
    }
  } catch (e) { /* a listener never throws outward */ }
}

function avFamilyWire(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  try {
    if (host.dataset && host.dataset.avFamilyWired === "1") return true;
    if (host.dataset) host.dataset.avFamilyWired = "1";
    host.addEventListener("click", avFamilyClick);
    host.addEventListener("change", avFamilyChange);
    host.addEventListener("keydown", avFamilyKeyDown);
    return true;
  } catch (e) { return false; }
}

function avFamilyPackSelectValue() {
  try {
    const host = avFamilyHost();
    if (host && typeof host.querySelector === "function") {
      const el = host.querySelector("#av-fam-res-pack");
      if (el && typeof el.value === "string" && el.value) return el.value;
    }
  } catch (e) { /* default */ }
  return AV_FAMILY_PACK_IDS[0];
}

/* ---------- init / state / classes ---------- */

function avFamilyInit() {
  const host = avFamilyHost();
  if (!host) return false;
  try {
    let root = null;
    try { root = (typeof host.querySelector === "function") ? host.querySelector(".av-family") : null; } catch (e) { root = null; }
    if (!root) {
      /* fresh markup replaces the parent's dim placeholder; repaint from live state */
      host.innerHTML = avFamilyChromeHTML();
      avFamilySt.lastSessionsHtml = null;
      try { root = (typeof host.querySelector === "function") ? host.querySelector(".av-family") : null; } catch (e) { root = null; }
    }
    avFamilyWire(host);
    avFamilySt.inited = true;
    avFamilySt.mounts += 1;
    if (!avFamilySt.statuses.radio) avFamilySt.statuses.radio = { msg: avFamilyRadioLine(), kind: "msg" };
    avFamilyPaint(host);
    return true;
  } catch (e) { return false; }
}

function avFamilySessionState(rec) {
  try {
    return {
      name: rec.name,
      ok: !!rec.ok,
      error: rec.error || "",
      info: rec.info ? {
        totalSeconds: rec.info.totalSeconds,
        voiceCount: rec.info.voiceCount,
        playableVoices: rec.info.playableVoices,
        types: Array.isArray(rec.info.types) ? rec.info.types.slice() : [],
        renderable: rec.info.renderable !== false,
      } : null,
    };
  } catch (e) { return { name: "", ok: false, error: "state failed", info: null }; }
}

function avFamilyState() {
  try {
    const st = avFamilySt;
    let radio = null;
    try { radio = avFamilyRadioRead(); } catch (e) { radio = null; }
    return {
      version: AV_FAMILY_VERSION,
      inited: !!st.inited,
      mounts: st.mounts,
      busy: !!st.busy,
      busyOp: st.busyOp,
      host: !!avFamilyHost(),
      inboxAvailable: avFamilyInboxAvailable(),
      packBase: avFamilyPackBase(),
      packCustom: typeof st.packBase === "string" && !!st.packBase,
      sessions: st.sessions.map(avFamilySessionState),
      sessionCount: st.sessions.length,
      selected: st.selected,
      previewing: !!st.preview,
      lastRender: st.lastRender ? {
        name: st.lastRender.name, seconds: st.lastRender.seconds, sr: st.lastRender.sr,
        frames: st.lastRender.frames, capped: !!st.lastRender.capped,
      } : null,
      lastReceipt: {
        hub: st.receipts.hub,
        resonance: st.receipts.resonance,
        radio: st.receipts.radio,
      },
      radio: radio ? { ok: radio.ok, name: radio.name, country: radio.country, id: radio.id, ts: radio.ts, raw: radio.raw } : null,
      statuses: {
        hub: st.statuses.hub && st.statuses.hub.msg ? st.statuses.hub.msg : "",
        resonance: st.statuses.resonance && st.statuses.resonance.msg ? st.statuses.resonance.msg : "",
        radio: st.statuses.radio && st.statuses.radio.msg ? st.statuses.radio.msg : "",
      },
      lastError: st.lastError,
    };
  } catch (e) {
    return { version: AV_FAMILY_VERSION, inited: false, error: avFamilyMsg(e) };
  }
}

/* the NEW css classes this card introduces (the parent styles them from this list) */
function avFamilyClasses() {
  return [
    "av-family", "av-fam-head", "av-fam-title", "av-fam-cap",
    "av-fam-row", "av-fam-row-title", "av-fam-controls", "av-fam-field", "av-fam-field-lbl",
    "av-fam-btn", "av-fam-file", "av-fam-file-in", "av-fam-select", "av-fam-text",
    "av-fam-loops", "av-fam-pack", "av-fam-search",
    "av-fam-status-line", "av-fam-status", "av-fam-msg", "av-fam-err",
    "av-fam-list", "av-fam-session", "av-fam-session-name", "av-fam-session-sub",
    "av-fam-selected", "av-fam-bad", "av-fam-empty", "av-fam-note", "av-fam-busy",
  ];
}

/* ---------- debug/verify handle (house style; window only) ---------- */

if (typeof window !== "undefined" && window) {
  try {
    window.__avFamily = {
      version: AV_FAMILY_VERSION,
      init: function () { return avFamilyInit(); },
      state: function () { return avFamilyState(); },
      send: function (opts) { return avFamilySend(opts); },
      importPack: function (src) { return avFamilyImportPack(src); },
      preview: function (i) { return avFamilyPreview(i); },
      save: function () { return avFamilySave(); },
      stop: function () { return avFamilyStop(); },
      openRadio: function (q) { return avFamilyOpenRadio(q); },
      setPackBase: function (url) { return avFamilySetPackBase(url); },
      classes: function () { return avFamilyClasses(); },
    };
  } catch (e) { /* no window — nothing to publish */ }
}
