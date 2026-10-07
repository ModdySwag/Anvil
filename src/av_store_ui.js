/* Anvil — PACK STORE card (P5 wave, child sa-1): the store UI mounted into the parent-owned
   host `#av-store-host` (the parent adds the card at integration and calls avStoreUiInit();
   this module only fills the host). Per verify/_p5_wave.md §4b and
   research/reuse/store-port-digest.md §1.2/§3.4/§4/§5/§6.

   WHAT THIS CARD IS (store card anatomy, adapted from Pattern Forge's packs page)
   - header line (title + one honest cap line);
   - search input (`#av-store-search`) + filter chips (`#av-store-filters` > `.av-pf-filter
     [data-f=all|avail|installed]`, live counts in `.av-pf-n[data-count]` — never hardcoded);
   - status line (`#av-store-status`, role=status) with the RETRY button (`#av-store-retry`)
     on index errors; storage line (`#av-store-storage`) with the honest backend chip
     (`#av-store-mode`: IndexedDB | localStorage (fallback) | memory only — this session only);
   - INSTALLED section (`#av-store-installed`, count `#av-store-n-inst`) and AVAILABLE section
     (`#av-store-avail`, count `#av-store-n-avail`); empty notes; the offline badge
     (`.av-store-offline`) appears on installed cards whenever the pack host is unreachable
     (index load error) — installed packs stay listed and keep working;
   - card = `.av-pack-card[data-pack=<id>]` (`.installed` / `.busy` states) with `.av-pack-head`
     (name + INSTALLED chip + count tag + engine + verified chips), clamped guide/blurb,
     `.av-pack-foot` (size · sha256 prefix) and the action button
     (`[data-act=install]` `.av-store-install` / `[data-act=remove]` `.av-store-remove`,
     class `av-btn mini av-store-btn`). While an action runs the card is `.busy`, the button is
     disabled, a `<progress class="av-store-prog">` (indeterminate) shows, and the status line
     says what is happening.

   LAW: ALL store state is read through the pinned store-core API with typeof guards only —
   avStoreStatus() · avStoreInstalled() · avStoreIndex(force) · avStoreInstall(id) ·
   avStoreRemove(id) (+ avStoreSetFetch is the core's seam, not touched here). The card keeps
   NO store state of its own beyond UI state (search · filter · in-flight action · last
   message). It never throws. No DOM at top level (loads in plain node / harness).

   CORE RESULT NORMALIZATION (the core's exact receipt shape is sa-0's; we accept the honest
   variants): install/remove promises may resolve `true`, a receipt `{ok:true|false, error}`,
   or undefined; after an install claims success we ALWAYS re-read avStoreInstalled() — a
   success that left no record is reported as a failure (a claimed install that cannot
   persist is NOT shown as installed). Refusal copy follows the digest §3.2 vocabulary:
   quota → "browser storage is full…", sha mismatch → "checksum mismatch…", removal refusal
   → "storage refused the removal — the pack is still installed".

   INDEX ENTRY ROUTES (all typeof-guarded; the entry accessor is a core seam): this card reads the
   manifest entries from avStoreCatalog() / avStorePacks() / avStoreIndexEntries() if the core
   ships one, else status().index.packs / status().manifest.packs / status().packs, else the last
   index receipt it saw. As of the sa-0 core v1 only `status().index.count` is exposed — when the
   count is known but no route yields entries, the card shows an honest note and zero available
   cards (never invented rows); exposing the entries (st.index already holds {packs}) closes the
   seam. The card also subscribes to avStoreOnChange() (guarded) so core paints repaint it.

   SEAMS / UNDETERMINED (for the parent at integration):
   - host id `#av-store-host`; the parent adds the card (suggested: a `.av-card` after the
     Sequencer card) and calls avStoreUiInit() in the boot block like the other cards.
   - the core's file:// policy is the core's own (seam/mock + honest note); this card only
     paints what avStoreStatus() reports. If the core refuses network on file://, the card
     shows "could not reach the pack host — installed packs stay available offline" and RETRY.
   - auto index kick: init() asks the core for the index once (lazy manifest fetch on first
     view, digest §6.2); later syncs may re-kick up to a small budget (4/session, >=1.2 s
     apart) only while no index is known — avStoreUiRefresh(true) resets the budget. This
     keeps the rig and the app honest without a polling loop.

   OBSERVABLES: avStoreUiInit() -> bool (false without host, never throws, re-mountable)
   · avStoreUiSync() -> bool (repaint from the core state) · avStoreUiClasses() -> string[]
   (the NEW css classes; the parent styles them) · avStoreUiRefresh(force) -> Promise
   ({ok, packs, error} — drives avStoreIndex through this card so the result is captured)
   · window.__avStoreUi = { version, init, sync, classes, snap, refresh, install, remove }.

   ID INVENTORY (rig + parent rely on these):
     #av-store-search · #av-store-filters (`.av-pf-filter[data-f]`, `.av-pf-n[data-count]`)
     #av-store-status · #av-store-retry · #av-store-storage · #av-store-mode · #av-store-used
     #av-store-installed · #av-store-n-inst · #av-store-none-inst · #av-store-offline-note
     #av-store-avail · #av-store-n-avail · #av-store-none-avail · #av-store-foot
   CARD HOOKS: `.av-pack-card[data-pack]` (`.installed`/`.busy`) · `[data-act=install]` ·
   `[data-act=remove]` · `.av-store-chip.inst` · `.av-store-chip.av-store-offline` ·
   `progress.av-store-prog`.

   ONE namespace avStoreUi* / AV_STORE_UI_*. ONE writer (child sa-1). Never throws. */

"use strict";

const AV_STORE_UI_VERSION = "p5.0";
const AV_STORE_UI_ID_RE = /^[a-z0-9][a-z0-9._-]{0,62}$/i;
const AV_STORE_UI_FILTERS = ["all", "avail", "installed"];
const AV_STORE_UI_KICK_BUDGET = 4;
const AV_STORE_UI_KICK_GAP_MS = 1200;

/* UI-local state only — every store fact is read from the avStore* API per paint */
const avStoreUiState = {
  inited: false, mounts: 0,
  search: "", filter: "all",
  installing: "", removing: "",
  lastMsg: "", lastMsgKind: "", lastError: "", lastErrKind: "",
  lastIndex: null, indexLoading: false, indexTried: false, kickAt: 0, kickBudget: AV_STORE_UI_KICK_BUDGET,
  usedText: "", usedAt: 0, subscribed: false,
  lastHtml: { inst: null, avail: null },
  counts: { all: 0, avail: 0, installed: 0, shown: 0 },
  modeText: "storage: —", backend: "", offline: false, skipped: 0,
};

/* ---------- small pure helpers (no DOM) ---------- */

const avStoreUiEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const avStoreUiNum = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };

function avStoreUiClean(s, max) {
  let t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  if (max && t.length > max) t = t.slice(0, max - 1) + "…";
  return t;
}

function avStoreUiIdOK(id) {
  try { return typeof id === "string" && id.length >= 1 && id.length <= 63 && AV_STORE_UI_ID_RE.test(id); } catch (e) { return false; }
}

function avStoreUiFmtSize(bytes) {
  const n = Number(bytes);
  if (!isFinite(n) || n <= 0) return "";
  if (n < 1024) return Math.round(n) + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(2) + " MB";
}

function avStoreUiSizeNum(p) {
  try {
    const raw = (p && p.bytes != null) ? p.bytes : (p ? p.size : null);
    const n = Number(raw);
    return isFinite(n) && n > 0 ? n : null;
  } catch (e) { return null; }
}

function avStoreUiCount(p) {
  try {
    const n = Number(p && p.presetCount);
    if (isFinite(n) && n >= 0) return Math.round(n);
    if (p && Array.isArray(p.presets)) return p.presets.length;
    const m = Number(p && p.presets);
    if (isFinite(m) && m >= 0) return Math.round(m);
  } catch (e) { /* unknown */ }
  return null;
}

/* manifest `verified` block (stamped by the canonical verifier; absent in v1 is fine) */
function avStoreUiVerified(p) {
  try {
    const v = p ? p.verified : null;
    if (v === true) return { ok: true, title: "verified by the canonical pack verifier" };
    if (!v || typeof v !== "object") return null;
    const errors = avStoreUiNum(v.errors, null);
    const checked = avStoreUiNum(v.checked, null);
    const ok = (v.ok === true) || (errors === 0 && checked != null && checked > 0);
    const bits = [];
    if (checked != null) bits.push(checked + " checked");
    if (errors != null) bits.push(errors + " errors");
    if (typeof v.engine === "string" && v.engine) bits.push(v.engine);
    if (typeof v.date === "string" && v.date) bits.push(v.date);
    return { ok: ok, title: (ok ? "verified" : "unverified") + (bits.length ? " — " + bits.join(" · ") : "") };
  } catch (e) { return null; }
}

/* ---------- guarded store-core access (typeof only; never throws) ---------- */

function avStoreUiHost() {
  try {
    if (typeof document !== "undefined" && document && typeof document.getElementById === "function") {
      return document.getElementById("av-store-host");
    }
  } catch (e) { /* no document */ }
  return null;
}

function avStoreUiStatusRaw() {
  let s = null;
  try { if (typeof avStoreStatus === "function") s = avStoreStatus(); } catch (e) { s = null; }
  return (s && typeof s === "object") ? s : {};
}

function avStoreUiBackend(st) {
  try {
    let b = (st && (st.backend || st.mode || st.storageBackend || st.storage)) || "";
    b = String(b).toLowerCase();
    if (b === "idb" || b === "ls" || b === "mem") return b;
  } catch (e) { /* unknown */ }
  return "";
}

/* installed map: id -> record ({id,name,sha256,size,at,pack}); accepts map OR array */
function avStoreUiInstalledMap() {
  const out = {};
  try {
    if (typeof avStoreInstalled !== "function") return out;
    const v = avStoreInstalled();
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length && i < 500; i++) {
        const r = v[i];
        if (r && typeof r === "object" && avStoreUiIdOK(r.id)) out[r.id] = r;
      }
      return out;
    }
    if (v && typeof v === "object") {
      for (const k in v) {
        const r = v[k];
        if (!r || typeof r !== "object") continue;
        const id = avStoreUiIdOK(r.id) ? r.id : (avStoreUiIdOK(k) ? k : "");
        if (id) out[id] = (r.id === id) ? r : Object.assign({ id: id }, r);
      }
    }
  } catch (e) { return out; }
  return out;
}

/* packs array from any candidate value: [...] | {packs:[...]} | {index:{packs:[...]}} */
function avStoreUiPacksFrom(v) {
  try {
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      if (Array.isArray(v.packs)) return v.packs;
      if (v.index && Array.isArray(v.index.packs)) return v.index.packs;
    }
  } catch (e) { /* none */ }
  return null;
}

/* the current index pack list. Routes, all typeof-guarded: the optional entry accessors
   avStoreCatalog() / avStorePacks() / avStoreIndexEntries() (whichever the core ships), then
   status.index.packs / status.manifest.packs / status.packs, then the last receipt we saw.
   NOTE (see header seam): the shipping sa-0 core exposes only `index.count` today — when no
   route yields entries this card reports the count honestly instead of inventing cards. */
function avStoreUiIndexList() {
  try {
    const fns = ["avStoreCatalog", "avStorePacks", "avStoreIndexEntries"];
    for (let i = 0; i < fns.length; i++) {
      let fn = null;
      try { if (typeof window !== "undefined" && window && typeof window[fns[i]] === "function") fn = window[fns[i]]; } catch (e) { fn = null; }
      if (!fn) { try { if (typeof globalThis !== "undefined" && globalThis && typeof globalThis[fns[i]] === "function") fn = globalThis[fns[i]]; } catch (e) { fn = null; } }
      if (fn) { const packs = avStoreUiPacksFrom(fn()); if (packs) return packs; }
    }
  } catch (e) { /* accessor blew up — fall through */ }
  try {
    const st = avStoreUiStatusRaw();
    const cands = [];
    if (st && st.index && typeof st.index === "object") cands.push(st.index);
    if (st && st.manifest && typeof st.manifest === "object") cands.push(st.manifest);
    if (st && Array.isArray(st.packs)) cands.push({ packs: st.packs });
    if (avStoreUiState.lastIndex && typeof avStoreUiState.lastIndex === "object") cands.push(avStoreUiState.lastIndex);
    for (let i = 0; i < cands.length; i++) { const packs = avStoreUiPacksFrom(cands[i]); if (packs) return packs; }
  } catch (e) { /* no index */ }
  return null;
}

/* the index COUNT as the core reports it (status.index.count — the summary route; works with
   the shipping core even when the entries themselves are not exposed) */
function avStoreUiIndexCount() {
  try {
    const st = avStoreUiStatusRaw();
    if (st && st.index && typeof st.index === "object") {
      const n = avStoreUiNum(st.index.count, null);
      if (n != null && n >= 0) return Math.round(n);
    }
  } catch (e) { /* none */ }
  return null;
}

function avStoreUiTakeIndex(res) {
  try {
    let packs = null;
    if (Array.isArray(res)) packs = res;
    else if (res && typeof res === "object") {
      if (Array.isArray(res.packs)) packs = res.packs;
      else if (res.index && Array.isArray(res.index.packs)) packs = res.index.packs;
    }
    if (!packs) return null;
    avStoreUiState.lastIndex = { packs: packs };
    return packs;
  } catch (e) { return null; }
}

/* ---------- entry normalization ---------- */

function avStoreUiEntry(p) {
  try {
    if (!p || typeof p !== "object") return null;
    const id = String(p.id == null ? "" : p.id);
    if (!avStoreUiIdOK(id)) return null;
    const sha = (typeof p.sha256 === "string" && /^[0-9a-f]{8,64}$/i.test(p.sha256)) ? p.sha256.toLowerCase() : "";
    return {
      id: id,
      name: avStoreUiClean(p.name != null ? p.name : id, 56) || id,
      count: avStoreUiCount(p),
      size: avStoreUiSizeNum(p),
      tags: Array.isArray(p.tags) ? p.tags.slice(0, 4).map(t => avStoreUiClean(t, 18)).filter(Boolean) : [],
      engine: (typeof p.engine === "string" && p.engine) ? avStoreUiClean(p.engine, 14) : "",
      desc: avStoreUiClean(p.description || p.blurb || p.desc || "", 150),
      sha: sha,
      verified: avStoreUiVerified(p),
      fromRecord: false,
    };
  } catch (e) { return null; }
}

function avStoreUiEntryFromRecord(id, r) {
  try {
    const rec = (r && typeof r === "object") ? r : {};
    const pack = rec.pack;
    let count = avStoreUiNum(rec.presetCount, null);
    if (count != null) count = Math.round(count);
    if (count == null && pack && typeof pack === "object" && Array.isArray(pack.presets)) count = pack.presets.length;
    let engine = (typeof rec.engine === "string" && rec.engine) ? avStoreUiClean(rec.engine, 14) : "";
    if (!engine && pack && typeof pack === "object" && pack.meta && typeof pack.meta === "object" && typeof pack.meta.engine === "string") {
      engine = avStoreUiClean(pack.meta.engine, 14);
    }
    return {
      id: id,
      name: avStoreUiClean(rec.name != null ? rec.name : id, 56) || id,
      count: count,
      size: avStoreUiSizeNum(rec),
      tags: Array.isArray(rec.tags) ? rec.tags.slice(0, 4).map(t => avStoreUiClean(t, 18)).filter(Boolean) : [],
      engine: engine,
      desc: "",
      sha: (typeof rec.sha256 === "string") ? rec.sha256.toLowerCase() : "",
      verified: null,
      fromRecord: true,
    };
  } catch (e) { return null; }
}

function avStoreUiName(id) {
  try {
    const list = avStoreUiIndexList();
    if (list) for (let i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].id) === id) return avStoreUiClean(list[i].name || id, 40);
    }
    const map = avStoreUiInstalledMap();
    if (map[id] && map[id].name) return avStoreUiClean(map[id].name, 40);
  } catch (e) { /* fall through */ }
  return id;
}

/* ---------- status error probes (error / lastError; index-ish only) ---------- */

function avStoreUiStatusErr(st) {
  try {
    if (st && typeof st.error === "string" && st.error) return st.error;
    if (st && typeof st.lastError === "string" && st.lastError) return st.lastError;
  } catch (e) { /* none */ }
  return "";
}

function avStoreUiErrIndexish(e) {
  const s = String(e == null ? "" : e);
  return /^index/i.test(s) || /reach|fetch|network|unreachable|offline|timed|abort/i.test(s);
}

/* ---------- refusal copy (digest §3.2 vocabulary, adapted) ---------- */

function avStoreUiRefusalText(err, what) {
  const raw = String(err == null ? "" : err);
  const e = raw.toLowerCase();
  if (what === "index") {
    if (/abort|timeout/.test(e)) return "pack index timed out — press RETRY";
    if (/quota|full|space/.test(e)) return "browser storage is full — remove a pack, then retry";
    if (e === "" || /fetch|network|failed|refused|unreachable|offline|load failed|scheme|file:/.test(e)) {
      return "could not reach the pack host — installed packs stay available offline";
    }
    return "pack index failed (" + avStoreUiClean(raw, 70) + ")";
  }
  if (/sha|checksum|digest|mismatch/.test(e)) return "checksum mismatch — the pack was refused (not stored)";
  if (/quota|full|space/.test(e)) return (what === "remove") ? "storage refused the removal — the pack is still installed" : "browser storage is full — remove a pack, then install again";
  if (/abort|timeout/.test(e)) return "pack download timed out — nothing was installed";
  if (/fetch|network|unreachable|offline|load failed/.test(e)) return "pack download failed — check the connection to the pack host";
  if (/bad-?pack|parse|json|schema|invalid/.test(e)) return "bad pack file — refused";
  if (/no-?id|slug/.test(e)) return "invalid pack id — refused";
  if (/still-installed/.test(e)) return "storage refused the removal — the pack is still installed";
  if (/no-?record/.test(e)) return "install did not land — nothing was stored";
  if (/idb|indexeddb|closed|storage|blocked/.test(e)) return (what === "remove") ? "storage refused the removal — the pack is still installed" : "browser storage refused the write — nothing was installed";
  if (e === "refused") return "the store refused — nothing was installed";
  if (/threw/.test(e)) return (what === "remove" ? "removal failed — " : "install failed — ") + avStoreUiClean(raw, 70);
  return (what === "remove" ? "removal failed (" : "install failed (") + (e ? avStoreUiClean(raw, 70) : "refused") + ")";
}

/* ---------- storage usage line (honest; optional nicety) ---------- */

function avStoreUiUsageRefresh() {
  try {
    if (typeof navigator === "undefined" || !navigator || !navigator.storage || typeof navigator.storage.estimate !== "function") return false;
    if (Date.now() - (avStoreUiState.usedAt | 0) < 8000) return false;
    avStoreUiState.usedAt = Date.now();
    Promise.resolve(navigator.storage.estimate()).then(est => {
      try {
        if (!est || !isFinite(est.usage)) { avStoreUiState.usedText = ""; return; }
        const u = avStoreUiFmtSize(est.usage);
        avStoreUiState.usedText = u ? (u + " stored") : "";
        avStoreUiSync();
      } catch (e) { /* ignore */ }
    }).catch(() => { /* ignore */ });
    return true;
  } catch (e) { return false; }
}

/* ---------- the view model (pure read of core state + UI state) ---------- */

function avStoreUiSearchTokens() {
  const q = avStoreUiClean(avStoreUiState.search, 80).toLowerCase();
  if (!q) return [];
  return q.split(" ").filter(Boolean).slice(0, 6);
}

function avStoreUiMatch(e, tokens) {
  if (!tokens.length) return true;
  const hay = (e.id + " " + e.name + " " + e.desc + " " + e.tags.join(" ") + " " + e.engine).toLowerCase();
  for (let i = 0; i < tokens.length; i++) if (hay.indexOf(tokens[i]) < 0) return false;
  return true;
}

function avStoreUiModeText(backend) {
  if (backend === "idb") return { text: "storage: IndexedDB", cls: "idb", title: "installed packs persist in IndexedDB (av-packs-store) — they survive reloads and work offline" };
  if (backend === "ls") return { text: "storage: localStorage (fallback)", cls: "ls", title: "IndexedDB is unavailable — the localStorage fallback tier is active (small packs only)" };
  if (backend === "mem") return { text: "storage: memory only — this session only", cls: "mem", title: "no browser storage is available — installs live for this session only and vanish on reload" };
  return { text: "storage: —", cls: "", title: "the store core has not reported a storage backend yet" };
}

function avStoreUiStatusText() {
  const ui = avStoreUiState;
  if (ui.installing) return { text: "installing " + avStoreUiName(ui.installing) + "…", kind: "msg" };
  if (ui.removing) return { text: "removing " + avStoreUiName(ui.removing) + "…", kind: "msg" };
  if (ui.lastError) return { text: ui.lastError, kind: "err" };
  if (ui.indexLoading) return { text: "loading the pack index…", kind: "msg" };
  const list = avStoreUiIndexList();
  if (list) return { text: ui.lastMsg || ("pack index ready — " + list.length + " pack" + (list.length === 1 ? "" : "s")), kind: "msg" };
  if (typeof avStoreIndex !== "function") return { text: "store core is not loaded — the pack list is unavailable", kind: "msg" };
  if (!ui.indexTried) return { text: "pack index not loaded yet — press RETRY", kind: "msg" };
  return { text: "pack index unavailable", kind: "err" };
}

function avStoreUiModel() {
  const st = avStoreUiStatusRaw();
  const backend = avStoreUiBackend(st);
  const mode = avStoreUiModeText(backend);
  const installedMap = avStoreUiInstalledMap();
  const indexList = avStoreUiIndexList();
  const idxCount = avStoreUiIndexCount();
  let indexNote = "";
  if (!indexList && idxCount != null && idxCount > 0) {
    indexNote = "the pack index reports " + idxCount + " pack" + (idxCount === 1 ? "" : "s") + ", but the store core does not expose the index entries to this card yet — the sa-0 seam must carry them (avStoreStatus().index.packs)";
  }
  const installedIds = Object.keys(installedMap);
  let skipped = 0;
  const entries = [];
  if (indexList) {
    const cap = Math.min(indexList.length, 500);
    for (let i = 0; i < cap; i++) {
      const e = avStoreUiEntry(indexList[i]);
      if (e) entries.push(e); else skipped += 1;
    }
  }
  const inIndex = {};
  for (let i = 0; i < entries.length; i++) inIndex[entries[i].id] = true;
  const installedEntries = [];
  const installedOnly = [];
  for (let i = 0; i < entries.length; i++) if (installedMap[entries[i].id]) installedEntries.push(entries[i]);
  for (let i = 0; i < installedIds.length; i++) {
    const id = installedIds[i];
    if (!inIndex[id]) {
      const e = avStoreUiEntryFromRecord(id, installedMap[id]);
      if (e) installedOnly.push(e);
    }
  }
  const tokens = avStoreUiSearchTokens();
  const availAll = entries.filter(e => !installedMap[e.id]);
  const avail = (avStoreUiState.filter === "installed") ? [] : availAll.filter(e => avStoreUiMatch(e, tokens));
  let instAll = installedEntries.concat(installedOnly);
  const inst = (avStoreUiState.filter === "avail") ? [] : instAll.filter(e => avStoreUiMatch(e, tokens));
  const union = {};
  for (let i = 0; i < entries.length; i++) union[entries[i].id] = 1;
  for (let i = 0; i < installedIds.length; i++) union[installedIds[i]] = 1;
  const stErrRaw = avStoreUiStatusErr(st);
  const offline = installedIds.length > 0 && (
    avStoreUiState.lastErrKind === "index" ||
    (stErrRaw !== "" && avStoreUiErrIndexish(stErrRaw))
  );
  const status = avStoreUiStatusText();
  return {
    coreOk: (typeof avStoreIndex === "function") || (typeof avStoreInstall === "function") || (typeof avStoreStatus === "function"),
    backend: backend,
    modeText: mode.text, modeClass: mode.cls, modeTitle: mode.title,
    filter: avStoreUiState.filter, search: avStoreUiState.search,
    indexOk: !!indexList, indexLoading: !!avStoreUiState.indexLoading, offline: offline,
    indexCount: idxCount, indexNote: indexNote,
    counts: { all: Object.keys(union).length, avail: availAll.length, installed: installedIds.length, shown: avail.length + inst.length },
    avail: avail, installedCards: inst, allInstalled: instAll.length,
    skipped: skipped,
    statusText: status.text, statusKind: status.kind,
    canRetry: typeof avStoreIndex === "function",
    usedText: avStoreUiState.usedText || "",
    installing: avStoreUiState.installing, removing: avStoreUiState.removing,
  };
}

/* ---------- markup (pure string builders) ---------- */

function avStoreUiCardHTML(e, installed, offline) {
  const busy = (avStoreUiState.installing === e.id) || (avStoreUiState.removing === e.id);
  const isRemoving = avStoreUiState.removing === e.id;
  let chips = "";
  if (installed) chips += '<span class="av-store-chip inst" title="installed — stored locally, works offline">INSTALLED</span>';
  if (e.count != null) chips += '<span class="av-pack-tag">' + e.count + " preset" + (e.count === 1 ? "" : "s") + "</span>";
  if (e.engine) chips += '<span class="av-store-chip eng">' + avStoreUiEsc(e.engine) + "</span>";
  const ver = e.verified;
  if (ver) chips += '<span class="av-store-chip av-store-ver ' + (ver.ok ? "ok" : "warn") + '" title="' + avStoreUiEsc(ver.title) + '">' + (ver.ok ? "✓ verified" : "⚠ unverified") + "</span>";
  if (installed && offline) chips += '<span class="av-store-chip av-store-offline" title="the pack host is unreachable — this pack still loads from local storage">OFFLINE</span>';
  const meta = [];
  const sizeTxt = avStoreUiFmtSize(e.size);
  if (sizeTxt) meta.push(sizeTxt);
  if (e.sha) meta.push("sha256 " + e.sha.slice(0, 10) + "…");
  let guide = "";
  if (e.desc) guide = avStoreUiEsc(e.desc);
  else if (e.tags.length) guide = e.tags.map(t => "#" + avStoreUiEsc(t)).join(" ");
  else if (e.fromRecord) guide = "from local storage — the pack file is not in the current index";
  const act = installed
    ? '<button type="button" class="av-btn mini av-store-btn av-store-remove" data-act="remove"' + (busy ? ' disabled' : '') + ' title="Remove this pack from local storage">' + (isRemoving ? "REMOVING…" : "REMOVE") + "</button>"
    : '<button type="button" class="av-btn mini av-store-btn av-store-install" data-act="install"' + (busy ? ' disabled' : '') + ' title="Download, verify sha-256, then store this pack">' + (busy ? "INSTALLING…" : "INSTALL") + "</button>";
  const prog = busy ? '<progress class="av-store-prog" max="100" aria-label="action in progress"></progress>' : "";
  return '<div class="av-pack-card' + (installed ? " installed" : "") + (busy ? " busy" : "") + '" data-pack="' + avStoreUiEsc(e.id) + '"' + (busy ? ' aria-busy="true"' : "") + ">" +
    '<div class="av-pack-head"><span class="av-pack-name" title="' + avStoreUiEsc(e.id) + '">' + avStoreUiEsc(e.name) + "</span>" + chips + "</div>" +
    (guide ? '<p class="av-pack-guide av-pack-blurb" title="' + avStoreUiEsc(e.desc || "") + '">' + guide + "</p>" : "") +
    '<div class="av-pack-foot"><span class="av-pack-meta">' + (meta.length ? avStoreUiEsc(meta.join(" · ")) : "&nbsp;") + "</span>" + prog + act + "</div>" +
    "</div>";
}

function avStoreUiChromeHTML() {
  return '<div class="av-store" data-av-store="1">' +
    '<div class="av-store-head"><span class="av-store-title">PACK STORE</span>' +
    '<span class="av-store-cap">packs download once, verify sha-256 before commit, and stay available offline — a failed verify is refused, never installed</span></div>' +
    '<div class="av-store-controls">' +
    '<input type="text" class="av-store-search" id="av-store-search" spellcheck="false" autocomplete="off" placeholder="search — name · tags · engine" aria-label="Search the pack store">' +
    '<div class="av-store-filters" id="av-store-filters" role="group" aria-label="Filter packs">' +
    '<button type="button" class="av-pf-filter on" data-f="all" aria-pressed="true">ALL <span class="av-pf-n" data-count="all">0</span></button>' +
    '<button type="button" class="av-pf-filter" data-f="avail" aria-pressed="false">AVAILABLE <span class="av-pf-n" data-count="avail">0</span></button>' +
    '<button type="button" class="av-pf-filter" data-f="installed" aria-pressed="false">INSTALLED <span class="av-pf-n" data-count="installed">0</span></button>' +
    "</div></div>" +
    '<div class="av-store-status-line">' +
    '<span class="av-store-status av-store-msg" id="av-store-status" role="status">loading the pack index…</span>' +
    '<button type="button" class="av-btn mini av-store-retry" id="av-store-retry" hidden title="Re-fetch the pack index">RETRY</button>' +
    "</div>" +
    '<div class="av-store-storage"><span class="av-store-chip av-store-mode" id="av-store-mode" title="">storage: —</span>' +
    '<span class="av-store-used" id="av-store-used"></span></div>' +
    '<section class="av-store-sect" data-sect="installed">' +
    '<div class="av-store-sect-head"><span class="av-pack-sect">INSTALLED</span><span class="av-pack-sect-n" id="av-store-n-inst">0</span>' +
    '<span class="av-store-offline-note av-store-note" id="av-store-offline-note" hidden></span></div>' +
    '<div class="av-store-list" id="av-store-installed"></div>' +
    '<p class="av-store-note av-store-none-note" id="av-store-none-inst">No packs installed yet — install one from AVAILABLE below; it works offline afterwards.</p></section>' +
    '<section class="av-store-sect" data-sect="avail">' +
    '<div class="av-store-sect-head"><span class="av-pack-sect">AVAILABLE</span><span class="av-pack-sect-n" id="av-store-n-avail">0</span></div>' +
    '<div class="av-store-list" id="av-store-avail"></div>' +
    '<p class="av-store-note av-store-none-note" id="av-store-none-avail"></p></section>' +
    '<p class="av-store-note" id="av-store-foot">Every install lands in this browser first (IndexedDB <b>av-packs-store</b> · localStorage fallback · memory last). Nothing is shown as installed unless it was actually stored — and a pack whose sha-256 does not match the manifest is refused before anything is committed.</p>' +
    "</div>";
}

/* ---------- repaint ---------- */

function avStoreUiSetText(host, sel, txt) {
  try { const el = host.querySelector(sel); if (el && el.textContent !== txt) el.textContent = txt; } catch (e) { /* no DOM */ }
}

function avStoreUiPaint() {
  const host = avStoreUiHost();
  if (!host) return false;
  try {
    let card = null;
    try { card = host.querySelector(".av-store"); } catch (e) { card = null; }
    if (!card) {
      host.innerHTML = avStoreUiChromeHTML();
      avStoreUiWire(host);
    }
    const m = avStoreUiModel();

    /* filter chips: live counts + .on state (never hardcoded) */
    try {
      host.querySelectorAll("[data-count]").forEach(n => {
        const k = n.getAttribute("data-count");
        if (k && m.counts[k] != null && n.textContent !== String(m.counts[k])) n.textContent = String(m.counts[k]);
      });
      host.querySelectorAll(".av-pf-filter").forEach(b => {
        const on = b.getAttribute("data-f") === m.filter;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    } catch (e) { /* no DOM */ }

    /* search echo (never clobber active typing) */
    try {
      const si = host.querySelector("#av-store-search");
      if (si && si.value !== avStoreUiState.search) si.value = avStoreUiState.search;
    } catch (e) { /* no DOM */ }

    /* lists (memoized innerHTML — no churn) */
    const instHtml = m.installedCards.map(e => avStoreUiCardHTML(e, true, m.offline)).join("");
    const availHtml = m.avail.map(e => avStoreUiCardHTML(e, false, false)).join("");
    try {
      const li = host.querySelector("#av-store-installed");
      if (li && avStoreUiState.lastHtml.inst !== instHtml) { avStoreUiState.lastHtml.inst = instHtml; li.innerHTML = instHtml; }
      const la = host.querySelector("#av-store-avail");
      if (la && avStoreUiState.lastHtml.avail !== availHtml) { avStoreUiState.lastHtml.avail = availHtml; la.innerHTML = availHtml; }
    } catch (e) { /* no DOM */ }

    /* section counts + empty notes + offline note */
    avStoreUiSetText(host, "#av-store-n-inst", String(m.counts.installed));
    avStoreUiSetText(host, "#av-store-n-avail", String(m.counts.avail));
    try {
      const noneInst = host.querySelector("#av-store-none-inst");
      if (noneInst) {
        noneInst.hidden = m.installedCards.length > 0;
        noneInst.textContent = (m.counts.installed > 0)
          ? "Installed packs are hidden by the current filter or search."
          : "No packs installed yet — install one from AVAILABLE below; it works offline afterwards.";
      }
      const noneAvail = host.querySelector("#av-store-none-avail");
      if (noneAvail) {
        noneAvail.hidden = m.avail.length > 0;
        noneAvail.textContent = m.indexOk
          ? (m.filter === "installed" ? "Showing installed packs only — switch the filter to AVAILABLE or ALL."
            : (avStoreUiSearchTokens().length ? "No packs match this search." : "Nothing available — everything in the index is installed."))
          : (m.indexNote ? ("Pack list unavailable here — " + m.indexNote + ".")
            : (m.offline ? "Pack list unavailable — could not reach the pack host; installed packs stay available offline."
              : "No pack index yet — RETRY once the pack host is reachable."));
      }
      const offl = host.querySelector("#av-store-offline-note");
      if (offl) {
        offl.hidden = !m.offline;
        offl.textContent = m.offline ? "— host unreachable; packs below come from local storage" : "";
      }
    } catch (e) { /* no DOM */ }

    /* status line + retry */
    try {
      const st = host.querySelector("#av-store-status");
      if (st) {
        const cls = "av-store-status " + (m.statusKind === "err" ? "av-store-err" : "av-store-msg");
        if (st.className !== cls) st.className = cls;
        if (st.textContent !== m.statusText) st.textContent = m.statusText;
      }
      const retry = host.querySelector("#av-store-retry");
      if (retry) retry.hidden = !(m.statusKind === "err" && m.canRetry);
    } catch (e) { /* no DOM */ }

    /* storage line */
    try {
      const mode = host.querySelector("#av-store-mode");
      if (mode) {
        const cls = "av-store-chip av-store-mode" + (m.modeClass ? " " + m.modeClass : "");
        if (mode.className !== cls) mode.className = cls;
        if (mode.textContent !== m.modeText) mode.textContent = m.modeText;
        if (mode.getAttribute("title") !== m.modeTitle) mode.setAttribute("title", m.modeTitle);
      }
      const used = host.querySelector("#av-store-used");
      if (used && used.textContent !== m.usedText) used.textContent = m.usedText;
    } catch (e) { /* no DOM */ }

    /* cache the model summary for snap() diagnostics */
    avStoreUiState.counts = m.counts;
    avStoreUiState.modeText = m.modeText;
    avStoreUiState.backend = m.backend;
    avStoreUiState.offline = m.offline;
    avStoreUiState.skipped = m.skipped;
    return true;
  } catch (e) {
    console.warn("[anvil] store paint failed", e);
    return false;
  }
}

/* ---------- the auto index kick (bounded; see header seams) ---------- */

function avStoreUiMaybeKick() {
  try {
    if (typeof avStoreIndex !== "function") return false;
    if (avStoreUiState.indexLoading) return false;
    if (avStoreUiIndexList()) return false;
    if ((avStoreUiState.kickBudget | 0) <= 0) return false;
    const now = Date.now();
    if (now - (avStoreUiState.kickAt | 0) < AV_STORE_UI_KICK_GAP_MS) return false;
    avStoreUiState.kickBudget -= 1;
    avStoreUiRefresh(false);
    return true;
  } catch (e) { return false; }
}

/* ---------- sync (repaint from the core state; the parent/rig call this after external writes) ---------- */

function avStoreUiSync() {
  const host = avStoreUiHost();
  if (!host) return false;
  const ok = avStoreUiPaint();
  avStoreUiMaybeKick();
  return ok;
}

/* ---------- actions ---------- */

function avStoreUiRefresh(force) {
  return new Promise((resolve) => {
    if (typeof avStoreIndex !== "function") {
      avStoreUiState.lastMsg = "store core is not loaded — the pack list is unavailable";
      avStoreUiState.lastMsgKind = "index";
      avStoreUiSync();
      resolve({ ok: false, packs: 0, error: "no store core" });
      return;
    }
    let p = null;
    try {
      avStoreUiState.indexLoading = true;
      avStoreUiState.indexTried = true;
      avStoreUiState.kickAt = Date.now();
      avStoreUiState.kickBudget = (force === true) ? AV_STORE_UI_KICK_BUDGET : avStoreUiState.kickBudget;
      avStoreUiSync();
      p = avStoreIndex(force === true);
      if (p && typeof p.then !== "function") p = null;   /* a sync core still lands via status */
    } catch (e) {
      p = Promise.reject(e);
    }
    Promise.resolve(p).then((res) => {
      const list = avStoreUiTakeIndex(res);
      avStoreUiState.indexLoading = false;
      /* verdict: a FRESH list from the receipt wins; otherwise any failure signal (a receipt
         {ok:false,error} or an error the core reports in status) is surfaced honestly even
         when a stale cached list is still renderable — the refetch failed either way. */
      let resFail = "";
      try {
        if (res && typeof res === "object") {
          if (res.ok === false) resFail = String(res.error || res.reason || "refused");
          else if (res.ok !== true && typeof res.error === "string" && res.error) resFail = res.error;
        }
      } catch (e) { resFail = ""; }
      const st = avStoreUiStatusRaw();
      const stErrRaw = avStoreUiStatusErr(st);
      const stErr = avStoreUiErrIndexish(stErrRaw) ? stErrRaw : "";
      const cached = avStoreUiIndexList();
      const idxCount = avStoreUiIndexCount();
      const stReady = !!(res && typeof res === "object" && res.ok === true) ||
        (!!(st && st.index && typeof st.index === "object" && st.index.status === "ready")) ||
        (idxCount != null && idxCount > 0);
      let out;
      if (list) {
        out = { ok: true, packs: list.length, error: "" };
      } else if (resFail) {
        out = { ok: false, packs: cached ? cached.length : (idxCount || 0), error: resFail, stale: !!cached };
      } else if (stErr) {
        out = { ok: false, packs: cached ? cached.length : (idxCount || 0), error: stErr, stale: !!cached };
      } else if (cached) {
        out = { ok: true, packs: cached.length, error: "" };
      } else if (stReady) {
        /* the index loaded (count is known) but no route yields the entries to this card */
        out = { ok: true, packs: idxCount || (res && typeof res === "object" && isFinite(res.count) ? res.count : 0), error: "", entries: false };
      } else {
        out = { ok: false, packs: 0, error: "no index" };
      }
      if (!out.ok && avStoreUiState.lastErrKind !== "install" && avStoreUiState.lastErrKind !== "remove") {
        avStoreUiState.lastError = avStoreUiRefusalText(out.error || "no index", "index");
        avStoreUiState.lastErrKind = "index";
      }
      if (out.ok) {
        avStoreUiState.lastMsg = "pack index ready — " + out.packs + " pack" + (out.packs === 1 ? "" : "s");
        avStoreUiState.lastMsgKind = "index";
        if (avStoreUiState.lastErrKind === "index") { avStoreUiState.lastError = ""; avStoreUiState.lastErrKind = ""; }
        avStoreUiUsageRefresh();
      }
      avStoreUiSync();
      resolve(out);
    }).catch((err) => {
      avStoreUiState.indexLoading = false;
      const msg = String((err && err.message) || err || "fetch failed");
      if (avStoreUiState.lastErrKind !== "install" && avStoreUiState.lastErrKind !== "remove") {
        avStoreUiState.lastError = avStoreUiRefusalText(msg, "index");
        avStoreUiState.lastErrKind = "index";
      }
      avStoreUiSync();
      resolve({ ok: false, packs: 0, error: msg });
    });
  });
}

function avStoreUiVerifyStored(id, base) {
  try {
    const map = avStoreUiInstalledMap();
    if (Object.prototype.hasOwnProperty.call(map, id)) return base;
    return { ok: false, error: "no-record" };
  } catch (e) { return { ok: false, error: "no-record" }; }
}

function avStoreUiInstallVerdict(res, id) {
  try {
    if (res === true || res === undefined) return avStoreUiVerifyStored(id, { ok: true });
    if (res === false || res === null) return { ok: false, error: "refused" };
    if (res && typeof res === "object") {
      if (res.ok === true) return avStoreUiVerifyStored(id, { ok: true, backend: res.backend });
      const e = res.error || res.reason || res.why || res.message;
      return { ok: false, error: (typeof e === "string" && e) ? e : "refused" };
    }
    return avStoreUiVerifyStored(id, { ok: true });
  } catch (e) { return { ok: false, error: "refused" }; }
}

function avStoreUiSettleInstall(id, verdict) {
  try {
    if (avStoreUiState.installing === id) avStoreUiState.installing = "";
    if (verdict && verdict.ok) {
      let suffix = "";
      if (verdict.backend === "mem") suffix = " — this session only: no browser storage available";
      else if (verdict.backend === "ls") suffix = " (localStorage fallback)";
      avStoreUiState.lastMsg = "installed " + avStoreUiName(id) + suffix;
      avStoreUiState.lastMsgKind = "install";
      if (avStoreUiState.lastErrKind === "install") { avStoreUiState.lastError = ""; avStoreUiState.lastErrKind = ""; }
    } else {
      avStoreUiState.lastError = avStoreUiRefusalText((verdict && verdict.error) || "refused", "install");
      avStoreUiState.lastErrKind = "install";
    }
    avStoreUiUsageRefresh();
  } catch (e) { /* settle never throws */ }
  avStoreUiSync();
}

function avStoreUiInstall(id) {
  if (!avStoreUiIdOK(id)) return false;
  if (avStoreUiState.installing) return false;
  if (typeof avStoreInstall !== "function") {
    avStoreUiState.lastError = "store core is not loaded — install is unavailable";
    avStoreUiState.lastErrKind = "install";
    avStoreUiSync();
    return false;
  }
  avStoreUiState.installing = id;
  if (avStoreUiState.lastErrKind === "install") { avStoreUiState.lastError = ""; avStoreUiState.lastErrKind = ""; }
  avStoreUiSync();
  let p = null;
  try { p = avStoreInstall(id); } catch (e) {
    avStoreUiSettleInstall(id, { ok: false, error: "threw: " + String((e && e.message) || e) });
    return true;
  }
  Promise.resolve(p).then((res) => {
    avStoreUiSettleInstall(id, avStoreUiInstallVerdict(res, id));
  }).catch((err) => {
    avStoreUiSettleInstall(id, { ok: false, error: String((err && err.message) || err || "install failed") });
  });
  return true;
}

function avStoreUiRemoveVerdict(res, id) {
  try {
    if (res === false || res === null) return { ok: false, error: "refused" };
    if (res && typeof res === "object" && res.ok === false) return { ok: false, error: String(res.error || res.reason || "refused") };
    const map = avStoreUiInstalledMap();
    if (!Object.prototype.hasOwnProperty.call(map, id)) return { ok: true };
    return { ok: false, error: "still-installed" };
  } catch (e) { return { ok: false, error: "refused" }; }
}

function avStoreUiSettleRemove(id, verdict) {
  try {
    if (avStoreUiState.removing === id) avStoreUiState.removing = "";
    if (verdict && verdict.ok) {
      avStoreUiState.lastMsg = "removed " + avStoreUiName(id);
      avStoreUiState.lastMsgKind = "remove";
      if (avStoreUiState.lastErrKind === "remove") { avStoreUiState.lastError = ""; avStoreUiState.lastErrKind = ""; }
    } else {
      avStoreUiState.lastError = avStoreUiRefusalText((verdict && verdict.error) || "refused", "remove");
      avStoreUiState.lastErrKind = "remove";
    }
    avStoreUiUsageRefresh();
  } catch (e) { /* settle never throws */ }
  avStoreUiSync();
}

function avStoreUiRemove(id) {
  if (!avStoreUiIdOK(id)) return false;
  if (avStoreUiState.removing) return false;
  if (typeof avStoreRemove !== "function") {
    avStoreUiState.lastError = "store core is not loaded — remove is unavailable";
    avStoreUiState.lastErrKind = "remove";
    avStoreUiSync();
    return false;
  }
  avStoreUiState.removing = id;
  if (avStoreUiState.lastErrKind === "remove") { avStoreUiState.lastError = ""; avStoreUiState.lastErrKind = ""; }
  avStoreUiSync();
  let p = null;
  try { p = avStoreRemove(id); } catch (e) {
    avStoreUiSettleRemove(id, { ok: false, error: "threw: " + String((e && e.message) || e) });
    return true;
  }
  Promise.resolve(p).then((res) => {
    avStoreUiSettleRemove(id, avStoreUiRemoveVerdict(res, id));
  }).catch((err) => {
    avStoreUiSettleRemove(id, { ok: false, error: String((err && err.message) || err || "removal failed") });
  });
  return true;
}

/* ---------- wiring (delegated, bound ONCE per host element) ---------- */

function avStoreUiClick(e) {
  try {
    const t = (e && e.target && typeof e.target.closest === "function") ? e.target : null;
    if (!t) return;
    const f = t.closest(".av-pf-filter[data-f]");
    if (f) {
      const v = String(f.getAttribute("data-f") || "all");
      avStoreUiState.filter = (AV_STORE_UI_FILTERS.indexOf(v) >= 0) ? v : "all";
      avStoreUiSync();
      return;
    }
    const act = t.closest("[data-act]");
    if (act) {
      const card = act.closest("[data-pack]");
      const id = card ? String(card.getAttribute("data-pack") || "") : "";
      if (!id || !avStoreUiIdOK(id)) return;
      const what = String(act.getAttribute("data-act") || "");
      if (what === "install") { avStoreUiInstall(id); return; }
      if (what === "remove") { avStoreUiRemove(id); return; }
    }
    if (t.closest("#av-store-retry")) { avStoreUiRefresh(true); return; }
  } catch (err) { /* a listener never throws outward */ }
}

function avStoreUiInput(e) {
  try {
    const t = (e && e.target && typeof e.target.closest === "function") ? e.target : null;
    if (!t || !t.closest("#av-store-search")) return;
    avStoreUiState.search = String(t.value == null ? "" : t.value).slice(0, 80);
    avStoreUiSync();
  } catch (err) { /* a listener never throws outward */ }
}

function avStoreUiWire(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  try {
    if (host.dataset && host.dataset.avStoreUiWired === "1") return true;   /* one delegation per host element */
    if (host.dataset) host.dataset.avStoreUiWired = "1";
    host.addEventListener("click", avStoreUiClick);
    host.addEventListener("input", avStoreUiInput);
    return true;
  } catch (e) { return false; }
}

/* subscribe to the core's change paints (avStoreOnChange), once per module instance; the core
   fires it after index load/failure, installs, removals and late adoption (guarded both ways) */
function avStoreUiSubscribe() {
  try {
    if (avStoreUiState.subscribed) return false;
    if (typeof avStoreOnChange !== "function") return false;
    const ok = avStoreOnChange(function () { try { avStoreUiSync(); } catch (e) { /* never break the store */ } }) === true;
    if (ok) avStoreUiState.subscribed = true;
    return ok;
  } catch (e) { return false; }
}

/* ---------- init (mount, re-mountable) ---------- */

function avStoreUiInit() {
  const host = avStoreUiHost();
  if (!host) return false;
  try {
    if (!host.querySelector(".av-store")) host.innerHTML = avStoreUiChromeHTML();
    avStoreUiWire(host);
    avStoreUiSubscribe();
    avStoreUiState.inited = true;
    avStoreUiState.mounts += 1;
    avStoreUiState.lastHtml.inst = null;
    avStoreUiState.lastHtml.avail = null;
    avStoreUiSync();
    return true;
  } catch (e) {
    console.warn("[anvil] store card mount failed", e);
    return false;
  }
}

/* ---------- observables ---------- */

function avStoreUiSnap() {
  const host = avStoreUiHost();
  let m = null;
  try { m = avStoreUiModel(); } catch (e) { m = null; }
  const snap = {
    version: AV_STORE_UI_VERSION,
    inited: !!avStoreUiState.inited,
    mounts: avStoreUiState.mounts,
    host: !!host,
    wired: !!(host && host.dataset && host.dataset.avStoreUiWired === "1"),
    card: !!(host && host.querySelector && host.querySelector(".av-store")),
    filter: avStoreUiState.filter,
    search: avStoreUiState.search,
    installing: avStoreUiState.installing,
    removing: avStoreUiState.removing,
    lastMsg: avStoreUiState.lastMsg,
    lastError: avStoreUiState.lastError,
    modeText: m ? m.modeText : avStoreUiState.modeText,
    backend: m ? m.backend : avStoreUiState.backend,
    offline: m ? m.offline : !!avStoreUiState.offline,
    counts: m ? m.counts : Object.assign({}, avStoreUiState.counts),
    indexOk: !!avStoreUiIndexList(),
    indexCount: m ? m.indexCount : avStoreUiIndexCount(),
    indexNote: m ? m.indexNote : "",
    indexLoading: !!avStoreUiState.indexLoading,
    indexTried: !!avStoreUiState.indexTried,
    skipped: m ? m.skipped : avStoreUiState.skipped,
    sections: { installed: 0, avail: 0 },
    classes: avStoreUiClasses(),
  };
  try {
    if (host && host.querySelectorAll) {
      snap.sections.installed = host.querySelectorAll("#av-store-installed .av-pack-card").length;
      snap.sections.avail = host.querySelectorAll("#av-store-avail .av-pack-card").length;
    }
  } catch (e) { /* no DOM */ }
  return snap;
}

function avStoreUiClasses() {
  return [
    "av-store", "av-store-head", "av-store-title", "av-store-cap",
    "av-store-controls", "av-store-search", "av-store-filters", "av-pf-filter", "on", "av-pf-n",
    "av-store-status-line", "av-store-status", "av-store-msg", "av-store-err", "av-store-retry",
    "av-store-storage", "av-store-mode", "idb", "ls", "mem", "av-store-used",
    "av-store-sect", "av-store-sect-head", "av-pack-sect", "av-pack-sect-n", "av-store-list",
    "av-pack-card", "installed", "busy", "av-pack-head", "av-pack-name", "av-pack-tag",
    "av-store-chip", "inst", "eng", "av-store-ver", "ok", "warn", "av-store-offline",
    "av-store-offline-note", "av-store-note", "av-store-none-note",
    "av-pack-guide", "av-pack-blurb", "av-pack-foot", "av-pack-meta",
    "av-store-btn", "av-store-install", "av-store-remove", "av-store-prog",
  ];
}

/* ---------- debug/verify handle ---------- */

if (typeof window !== "undefined") {
  window.__avStoreUi = {
    version: AV_STORE_UI_VERSION,
    init: () => avStoreUiInit(),
    sync: () => avStoreUiSync(),
    classes: () => avStoreUiClasses(),
    snap: () => avStoreUiSnap(),
    refresh: (force) => avStoreUiRefresh(force),
    install: (id) => avStoreUiInstall(id),
    remove: (id) => avStoreUiRemove(id),
  };
}
