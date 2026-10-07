/* Anvil — P5 BANK row + apply core (verify/_p5_wave.md §4b sa-3; sources: pack-pipeline-port-digest
   §4/§6, store-port-digest §1.8/§3.9). ONE shared apply core for installed .avbank.json presets:
   every patch path commits through the app funnel avApplyParam (THE commit funnel — `mod.macroN`
   rides av_mod's EXISTING wrap, so its acceptance counts: the wrap owns macro paths and lands them
   model-side; the funnel's own return for those paths is only the passthrough's word). An optional
   `seq` rides avSeqLoad + avSeqSetPattern + avSeqUiSync (all typeof-guarded). The BANK row mounts
   ONE compact control row (pack select + preset select + APPLY + PREVIEW) into
   #av-synth-bank-host when the parent has added it, else directly after the #av-synth h2.
   PREVIEW auditions a preset on a FRESH offline engine (OfflineAudioContext + avEngineBoot offline,
   2.0 s @ 44.1 kHz — the §2 witness recipe) and plays the rendered buffer on the live context;
   resolves null (honestly) when the environment cannot render.

   LAWS preserved (digest §9 + _p5_wave §4b):
   - page module: NO DOM at top level; every DOM/global reach typeof-guarded inside a function;
     ONE namespace (avBank* / AV_BANK_*); never throws; node-parseable (node --check clean).
   - apply: every legal patch path forwarded through the CURRENT avApplyParam binding (resolved per
     call — av_mod/av_plock wraps REASSIGN the funnel, a captured reference would go stale);
     `engine.kind` ordered FIRST (digest §6.4: kind-specific paths must land after the kind);
     booleans normalised to 1/0 (a JSON flag's truth; the live facade's setParam admits only finite
     numbers/strings, and the witness coerces Number(v) identically); non-finite numbers / null /
     objects / arrays / functions are REFUSED and reported, never silently dropped; paths are
     dotted identifiers starting with a letter (`__proto__`-class keys never reach the mirror).
   - seq leg: avSeqLoad validates into the core model, then avSeqSetPattern gets the core's own
     sanitised snapshot when avSeqSnap exists (core and scheduler can never drift), then
     avSeqUiSync repaints (a nicety — its absence is not a failure; load/set are).
   - preview: the witness recipe verbatim — fresh engine → patch applied via the offline handle's
     setParam → noteOn(60, 0.9), drum kind → noteOn(36, 0.9) → render 2.0 s → finite + peak >
     1e-4 gate (the §2 acceptance) → play the buffer on the live ctx (KEYS bus when the tap
     answers, else the raw destination — the av_sample preview law; the tap part present but
     unanswerable refuses rather than bypassing). The rendered buffer is post-tap (the offline
     context builds the same keys→master chain, levels mirrored from the live store) — the audition
     carries one more pass of the playback path; documented, not compensated. v1 auditions the
     patch; a `seq` is accepted and reported but NOT rendered (no timed-note facility exists
     engine-side — integration seam, never a silent claim; §2 witnesses seq out-of-band too).
   - store reads ride the guarded avStore API (`avStoreInstalled()` — the sa-0 store core); while
     that module is not loaded every read is an honest [] and the row says so.

   Public surface (classic-script globals, ONE namespace):
     avBankInit() -> bool                 mount the BANK row (false without host/parts, never throws)
     avBankRefresh() -> bool              repaint the selects from installed packs (after installs)
     avBankApplyPreset(preset) -> bool    forward every patch path; seq legs; full acceptance only
     avBankPreview(patch[, seq]) -> Promise<receipt|null>
     avBankPresets([packId]) -> []        flat installed-preset list (all packs, or one)
     avBankPacks() -> []                  installed packs via the guarded avStore API
     avBankClasses() -> string[]          CSS classes this row introduces (parent styles them)
     avBankSnap() -> object               observability (mounts, counts, lastApply, lastPreview)
     window.__avBank -> { … }             debug handle (rigs + parent)
*/
"use strict";

const AV_BANK_VERSION = "p5.0";
const AV_BANK_PREVIEW_SR = 44100;        /* §4b pin: preview sample rate */
const AV_BANK_PREVIEW_SECS = 2;          /* §4b pin: 2.0 s render (the §2 witness recipe) */
const AV_BANK_AUDIBLE = 1e-4;            /* §2 witness floor: peak must exceed this */
const AV_BANK_NOTE_GAIN = 0.9;           /* §2 witness note velocity */
/* a §1 path is a dotted identifier starting with a letter — the belt keeps `__proto__`-class
   keys out of avParams; every path the shipped modules accept matches this shape */
const AV_BANK_PATH_RE = /^[A-Za-z][A-Za-z0-9_.-]*$/;
/* the av_mod wrap's exact turf; when that wrap is the funnel we called, its marker is the
   acceptance for these paths (the wrap synced the macro model + reposted the payload) */
const AV_BANK_MOD_MACRO_RE = /^mod\.macro[1-8]$/;

/* ---------- module state ---------- */

const avBankState = {
  mounted: false,          /* avBankInit succeeded at least once */
  mounts: 0,               /* mount passes (re-mountable, like the sibling cards) */
  host: null,              /* the element the row lives in (repaint target) */
  packId: null,            /* current pack selection */
  presetIndex: -1,         /* current preset selection (index within the pack) */
  activeSrc: null,         /* the ONE preview voice (a new preview preempts) */
  fallbackCtx: null,       /* lazily created playback context when the engine has none */
  lastApply: null,         /* {name, forwarded, accepted, refused[], seq, seqOk, reason, ok} */
  lastPreview: null,       /* the last successful preview receipt */
  lastPreviewError: null,  /* why the last preview refused (null when it landed) */
};

/* ---------- guarded global resolvers (belt 1: binding, belt 2: window property) ---------- */

function avBankFunnel() {
  try { if (typeof avApplyParam === "function") return avApplyParam; } catch (e) { /* not injected */ }
  try { if (typeof window !== "undefined" && window && typeof window.avApplyParam === "function") return window.avApplyParam; } catch (e) { /* no window */ }
  return null;
}

function avBankStoreInstalled() {
  try { if (typeof avStoreInstalled === "function") return avStoreInstalled; } catch (e) { /* store not loaded */ }
  try { if (typeof window !== "undefined" && window && typeof window.avStoreInstalled === "function") return window.avStoreInstalled; } catch (e) { /* no window */ }
  return null;
}

function avBankSeqFns() {
  const out = { load: null, set: null, ui: null, snap: null };
  try { if (typeof avSeqLoad === "function") out.load = avSeqLoad; } catch (e) { /* not injected */ }
  try { if (typeof avSeqSetPattern === "function") out.set = avSeqSetPattern; } catch (e) { /* not injected */ }
  try { if (typeof avSeqUiSync === "function") out.ui = avSeqUiSync; } catch (e) { /* not injected */ }
  try { if (typeof avSeqSnap === "function") out.snap = avSeqSnap; } catch (e) { /* not injected */ }
  try {
    if (typeof window !== "undefined" && window) {
      if (!out.load && typeof window.avSeqLoad === "function") out.load = window.avSeqLoad;
      if (!out.set && typeof window.avSeqSetPattern === "function") out.set = window.avSeqSetPattern;
      if (!out.ui && typeof window.avSeqUiSync === "function") out.ui = window.avSeqUiSync;
      if (!out.snap && typeof window.avSeqSnap === "function") out.snap = window.avSeqSnap;
    }
  } catch (e) { /* no window */ }
  return out;
}

function avBankBootFn() {
  try { if (typeof avEngineBoot === "function") return avEngineBoot; } catch (e) { /* not injected */ }
  try { if (typeof window !== "undefined" && window && typeof window.avEngineBoot === "function") return window.avEngineBoot; } catch (e) { /* no window */ }
  return null;
}

function avBankOfflineCtor() {
  try { if (typeof OfflineAudioContext === "function") return OfflineAudioContext; } catch (e) { /* not here */ }
  try { if (typeof webkitOfflineAudioContext === "function") return webkitOfflineAudioContext; } catch (e) { /* not here */ }
  return null;
}

function avBankAudioCtor() {
  try { if (typeof AudioContext === "function") return AudioContext; } catch (e) { /* not here */ }
  try { if (typeof webkitAudioContext === "function") return webkitAudioContext; } catch (e) { /* not here */ }
  return null;
}

/* ---------- value + patch laws ---------- */

/* §1 values are JSON number / string / boolean. Admit finite numbers as-is; strings as-is (the
   exact-enum law is the schema's call, not the mirror's); booleans as 1/0 (flag truth — see the
   header). Everything else (null, objects, arrays, NaN, ±Infinity, functions, undefined) → null
   = refuse. */
function avBankValueNorm(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

/* ordered, validated patch rows: `engine.kind` FIRST (digest §6.4 — kind-specific paths must land
   after the kind), then the map's own order. Refusals carry the path so nothing is silent. */
function avBankPatchRows(patch) {
  const rows = [], refused = [];
  if (patch == null) return { rows: rows, refused: refused, bad: false, empty: true };
  if (typeof patch !== "object" || Array.isArray(patch)) return { rows: rows, refused: refused, bad: true, empty: false };
  let keys = [];
  try { keys = Object.keys(patch); } catch (e) { keys = []; }
  const order = [];
  for (let i = 0; i < keys.length; i++) if (keys[i] !== "engine.kind") order.push(keys[i]);
  if (keys.indexOf("engine.kind") >= 0) order.unshift("engine.kind");
  for (let i = 0; i < order.length; i++) {
    const path = order[i];
    if (typeof path !== "string" || !AV_BANK_PATH_RE.test(path)) { refused.push(String(path)); continue; }
    const v = avBankValueNorm(patch[path]);
    if (v === null) { refused.push(path); continue; }
    rows.push({ path: path, v: v });
  }
  return { rows: rows, refused: refused, bad: false, empty: keys.length === 0 };
}

/* drum-kind detection from the ordered rows (string enum or the §2.1/P3 ordinal 3) — the §2
   witness plays noteOn(36, 0.9) for drum presets */
function avBankIsDrumKind(rows) {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].path !== "engine.kind") continue;
    return rows[i].v === "drum" || rows[i].v === 3;
  }
  return false;
}

/* ---------- the seq leg (§4b): avSeqLoad → avSeqSetPattern → avSeqUiSync ---------- */

function avBankSeqApply(seq, receipt) {
  const f = avBankSeqFns();
  if (!f.load || !f.set) { receipt.seqError = "seq modules unavailable"; return false; }
  let ok = false;
  try { ok = f.load(seq) === true; } catch (e) { ok = false; }
  if (!ok) { receipt.seqError = "avSeqLoad refused"; return false; }
  /* feed the scheduler the core's own sanitised snapshot when available — core and scheduler
     can never drift; the raw seq is the fallback */
  let norm = seq;
  try { if (f.snap) { const s = f.snap(); if (s && typeof s === "object") norm = s; } } catch (e) { /* raw seq stands */ }
  try { ok = f.set(norm) !== false; } catch (e) { ok = false; }
  if (!ok) { receipt.seqError = "avSeqSetPattern refused"; return false; }
  try { if (f.ui) f.ui(); } catch (e) { /* repaint is a nicety — the pattern landed */ }
  return true;
}

/* ---------- avBankApplyPreset: the shared apply core (§4b apply law) ---------- */

/* Forward EVERY legal patch path through the current funnel (no early stop), then the seq leg
   when present. Returns true only on full acceptance: at least one leg, zero refusals, seqOk.
   The receipt (avBankState.lastApply / avBankSnap) names every refusal — never a silent drop. */
function avBankApplyPreset(preset) {
  const receipt = { name: null, forwarded: 0, accepted: 0, refused: [], seq: false, seqOk: true, reason: null, ok: false };
  avBankState.lastApply = receipt;
  try {
    if (!preset || typeof preset !== "object" || Array.isArray(preset)) { receipt.reason = "not a preset object"; return false; }
    receipt.name = (typeof preset.name === "string" && preset.name) ? preset.name : null;
    const parsed = avBankPatchRows(preset.patch);
    if (parsed.bad) { receipt.reason = "patch is not a plain object"; return false; }
    receipt.refused = parsed.refused.slice();
    const funnel = avBankFunnel();
    for (let i = 0; i < parsed.rows.length; i++) {
      const row = parsed.rows[i];
      if (!funnel) { receipt.refused.push(row.path); continue; }
      let rv = false;
      try { rv = funnel(row.path, row.v, { from: "bank", name: receipt.name }); } catch (e) { rv = false; }
      receipt.forwarded += 1;
      let accepted = rv !== false;
      /* av_mod's wrap owns exactly mod.macro1..8: when the funnel we called IS that wrap, the
         macro landed model-side even if the passthrough's engine leg said false (SPN tiers). */
      if (!accepted && AV_BANK_MOD_MACRO_RE.test(row.path) && funnel && funnel.__avModWrap === true) accepted = true;
      if (accepted) receipt.accepted += 1; else receipt.refused.push(row.path);
    }
    if (!funnel && parsed.rows.length > 0) receipt.reason = "no apply funnel";
    let seqOk = true;
    const rawSeq = preset.seq;
    if (rawSeq != null) {
      if (typeof rawSeq !== "object" || Array.isArray(rawSeq)) { receipt.seqError = "seq is not a pattern object"; seqOk = false; }
      else { receipt.seq = true; seqOk = avBankSeqApply(rawSeq, receipt); }
    }
    const hasLeg = parsed.rows.length > 0 || rawSeq != null;
    const ok = hasLeg && receipt.refused.length === 0 && seqOk;
    receipt.seqOk = seqOk;
    receipt.ok = ok;
    return ok === true;
  } catch (e) {
    receipt.reason = String((e && (e.message || e.name)) || e) || "apply failed";
    receipt.ok = false;
    return false;
  }
}

/* ---------- avBankPreview: offline witness-recipe audition (§4b preview law) ---------- */

function avBankStopPreview() {
  const src = avBankState.activeSrc;
  avBankState.activeSrc = null;
  if (!src) return false;
  try { if (typeof src.stop === "function") src.stop(); } catch (e) { /* already stopped */ }
  try { src.onended = null; } catch (e) { /* ok */ }
  return true;
}

/* the live playback context: the engine's own context first (one context, one tap chain), else
   ONE lazily created fallback of our own (the av_sample pickCtx law) */
function avBankLiveCtx() {
  try {
    const w = (typeof window !== "undefined") ? window.__avEngine : null;
    const h = (w && w.ready === true && w.handle) ? w.handle : null;
    const c = h ? h.ctx : null;
    if (c && c.state !== "closed" && typeof c.createBufferSource === "function") return c;
  } catch (e) { /* engine facade absent */ }
  try {
    const st = avBankState;
    let c = st.fallbackCtx;
    if (c && c.state === "closed") c = null;
    if (!c) {
      const AC = avBankAudioCtor();
      if (!AC) return null;
      c = new AC({ latencyHint: "interactive" });
      st.fallbackCtx = c;
    }
    return (c && typeof c.createBufferSource === "function") ? c : null;
  } catch (e) { return null; }
}

/* the playback destination — the av_sample preview law: connect to the KEYS bus (avKeysFor) so
   the audition rides the master tap; when the tap part is present but cannot answer, refuse
   rather than bypassing it; the raw destination exists only when av_tap itself does not. */
function avBankDestFor(ctx) {
  if (!ctx || typeof ctx.createBufferSource !== "function") return null;
  let hasTap = false;
  try { hasTap = (typeof avKeysFor === "function"); } catch (e) { hasTap = false; }
  let d = null;
  try { if (hasTap) d = avKeysFor(ctx); } catch (e) { d = null; }
  if (d && typeof d.connect === "function") return d;
  try { void ctx.destination; } catch (e) { /* no destination */ }
  try { if (hasTap) d = avKeysFor(ctx); } catch (e) { d = null; }
  if (d && typeof d.connect === "function") return d;
  if (hasTap) return null;
  try {
    const real = ctx.destination;
    return (real && typeof real.connect === "function") ? real : null;
  } catch (e) { return null; }
}

function avBankPlayBuffer(buf) {
  try {
    const ctx = avBankLiveCtx();
    if (!ctx) return false;
    try {
      if (ctx.state === "suspended" && typeof ctx.resume === "function") {
        const p = ctx.resume();
        if (p && typeof p.catch === "function") p.catch(function () { /* gesture-gated — retried by the app */ });
      }
    } catch (e) { /* resume refused */ }
    const dest = avBankDestFor(ctx);
    if (!dest) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(dest);
    src.onended = function () { if (avBankState.activeSrc === src) avBankState.activeSrc = null; };
    src.start();
    avBankState.activeSrc = src;
    return true;
  } catch (e) { return false; }
}

/* finite + peak over the rendered buffer (the §2 acceptance numbers) */
function avBankBufferStats(buf) {
  const out = { length: 0, peak: 0, finite: true };
  try {
    out.length = Number(buf.length) || 0;
    const chs = Math.max(1, Math.min(2, Number(buf.numberOfChannels) || 1));
    for (let c = 0; c < chs; c++) {
      const data = buf.getChannelData(c);
      if (!data || typeof data.length !== "number") continue;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (!isFinite(v)) { out.finite = false; break; }
        const a = v < 0 ? -v : v;
        if (a > out.peak) out.peak = a;
      }
    }
  } catch (e) { out.finite = false; }
  return out;
}

/* avBankPreview(patch[, seq]) -> Promise<receipt|null>. A new preview preempts the old one.
   null = nothing was playable (no OfflineAudioContext / no avEngineBoot / boot failed / note
   rejected / render threw / render below the audibility floor); avBankState.lastPreviewError
   says which. The receipt knows: sr/secs/frames/midi/gain/tier/refused[]/peak/played/seq. */
function avBankPreview(patch, seq) {
  avBankStopPreview();
  const st = avBankState;
  st.lastPreview = null;
  st.lastPreviewError = null;
  const parsed = avBankPatchRows(patch);
  const hasSeq = seq != null && typeof seq === "object" && !Array.isArray(seq);
  if (parsed.bad || !(parsed.rows.length > 0 || hasSeq)) {
    st.lastPreviewError = parsed.bad ? "patch is not a plain object" : "nothing to audition";
    return Promise.resolve(null);
  }
  const Ctor = avBankOfflineCtor();
  if (!Ctor) { st.lastPreviewError = "OfflineAudioContext unavailable"; return Promise.resolve(null); }
  const boot = avBankBootFn();
  if (!boot) { st.lastPreviewError = "avEngineBoot unavailable"; return Promise.resolve(null); }
  return (async function () {
    try {
      const frames = Math.round(AV_BANK_PREVIEW_SR * AV_BANK_PREVIEW_SECS);
      const oc = new Ctor(2, frames, AV_BANK_PREVIEW_SR);
      if (!oc || typeof oc.startRendering !== "function") { st.lastPreviewError = "offline context unusable"; return null; }
      const h = await boot(oc, { offline: true });
      if (!h || h.ready !== true) { st.lastPreviewError = "offline engine boot failed"; return null; }
      const refused = [];
      for (let i = 0; i < parsed.rows.length; i++) {
        const row = parsed.rows[i];
        let okp = false;
        try { okp = h.setParam(row.path, row.v) === true; } catch (e) { okp = false; }
        if (!okp) refused.push(row.path);
      }
      const midi = avBankIsDrumKind(parsed.rows) ? 36 : 60;
      let on = false;
      try { on = h.noteOn(midi, AV_BANK_NOTE_GAIN) === true; } catch (e) { on = false; }
      if (!on) { st.lastPreviewError = "note rejected by the offline engine"; return null; }
      const buf = await oc.startRendering();
      if (!buf || typeof buf.getChannelData !== "function") { st.lastPreviewError = "render produced no buffer"; return null; }
      const stats = avBankBufferStats(buf);
      if (!stats.finite || stats.peak <= AV_BANK_AUDIBLE) {
        st.lastPreviewError = "render below the audibility floor (peak " + stats.peak + ")";
        return null;
      }
      const receipt = {
        ok: true, sr: AV_BANK_PREVIEW_SR, secs: AV_BANK_PREVIEW_SECS, frames: frames,
        length: stats.length, midi: midi, gain: AV_BANK_NOTE_GAIN,
        tier: (h.tier || h.mode || null), refused: refused, peak: stats.peak,
        played: avBankPlayBuffer(buf), seq: hasSeq,
      };
      st.lastPreview = receipt;
      return receipt;
    } catch (e) {
      st.lastPreviewError = String((e && (e.message || e.name)) || e) || "preview failed";
      return null;
    }
  })();
}

/* ---------- installed packs via the guarded avStore API (sa-0) ---------- */

function avBankPackNorm(rec) {
  if (!rec || typeof rec !== "object") return null;
  const src = (rec.pack && typeof rec.pack === "object") ? rec.pack : rec;
  const id = (typeof src.id === "string" && src.id) ? src.id : ((typeof rec.id === "string" && rec.id) ? rec.id : null);
  if (!id) return null;
  const meta = (src.meta && typeof src.meta === "object") ? src.meta : null;
  const name = (typeof src.name === "string" && src.name) ? src.name
    : ((meta && typeof meta.name === "string" && meta.name) ? meta.name
      : ((typeof rec.name === "string" && rec.name) ? rec.name : id));
  const presets = Array.isArray(src.presets) ? src.presets : [];
  const out = { id: id, name: name, meta: meta, presets: presets, count: presets.length };
  if (typeof rec.sha256 === "string") out.sha256 = rec.sha256;
  if (isFinite(Number(rec.size))) out.size = Number(rec.size);
  if (isFinite(Number(rec.at))) out.at = Number(rec.at);
  return out;
}

function avBankPacks() {
  const f = avBankStoreInstalled();
  if (!f) return [];
  let raw = null;
  try { raw = f(); } catch (e) { return []; }
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const p = avBankPackNorm(raw[i]);
    if (p) out.push(p);
  }
  return out;
}

/* flat preset list in PF bank-list shape (packId, packName, i, name, section, tags, patch, seq):
   no argument = every installed pack; a packId = that pack only. */
function avBankPresets(packId) {
  const want = (typeof packId === "string" && packId) ? packId : null;
  const packs = avBankPacks(), out = [];
  for (let i = 0; i < packs.length; i++) {
    const p = packs[i];
    if (want && p.id !== want) continue;
    for (let j = 0; j < p.presets.length; j++) {
      const pr = p.presets[j];
      if (!pr || typeof pr !== "object") continue;
      out.push({
        packId: p.id,
        packName: p.name,
        i: j,
        name: (typeof pr.name === "string" && pr.name) ? pr.name : ("Preset " + (j + 1)),
        section: (typeof pr.section === "string") ? pr.section : "",
        tags: Array.isArray(pr.tags) ? pr.tags : [],
        patch: (pr.patch && typeof pr.patch === "object" && !Array.isArray(pr.patch)) ? pr.patch : null,
        seq: (pr.seq && typeof pr.seq === "object" && !Array.isArray(pr.seq)) ? pr.seq : null,
      });
    }
  }
  return out;
}

/* ---------- the BANK row (markup — pure string builders, no DOM) ---------- */

const avBankEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function avBankRowHTML() {
  return '<div class="av-bank" data-av-bank="1">' +
    '<div class="av-bank-head"><span class="av-bank-title">BANK</span>' +
    '<span class="av-bank-cap">installed packs &middot; APPLY loads a preset &middot; PREVIEW auditions it (2.0 s offline render)</span></div>' +
    '<div class="av-bank-row">' +
    '<label class="av-bank-pick"><span class="av-bank-pick-lbl">PACK</span>' +
    '<select class="av-select av-bank-pack" aria-label="Bank — installed packs"></select></label>' +
    '<label class="av-bank-pick"><span class="av-bank-pick-lbl">PRESET</span>' +
    '<select class="av-select av-bank-preset" aria-label="Preset — selected pack"></select></label>' +
    '<button type="button" class="av-btn mini av-bank-apply" aria-label="Apply the selected preset">APPLY</button>' +
    '<button type="button" class="av-btn mini av-bank-preview" aria-label="Preview the selected preset">PREVIEW</button>' +
    '</div>' +
    '<p class="av-bank-hint av-note av-dim">0 packs installed — the PACKS card installs banks.</p>' +
    "</div>";
}

function avBankPackOptionsHTML(packs, selId) {
  if (!packs.length) return '<option value="">— no banks installed —</option>';
  let out = "";
  for (let i = 0; i < packs.length; i++) {
    const p = packs[i];
    out += '<option value="' + avBankEsc(p.id) + '"' + (p.id === selId ? " selected" : "") + ">" +
      avBankEsc(p.name) + " (" + p.count + ")</option>";
  }
  return out;
}

function avBankPresetOptionsHTML(presets, selIndex) {
  if (!presets.length) return '<option value="">— no presets —</option>';
  let out = "";
  for (let i = 0; i < presets.length; i++) {
    const pr = presets[i];
    const label = (pr.section ? pr.section + " · " : "") + pr.name;
    out += '<option value="' + pr.i + '"' + (pr.i === selIndex ? " selected" : "") + ">" + avBankEsc(label) + "</option>";
  }
  return out;
}

/* ---------- DOM (page side; every reach guarded) ---------- */

function avBankHint(text) {
  try {
    const host = avBankState.host;
    if (!host || typeof host.querySelector !== "function") return false;
    const el = host.querySelector(".av-bank-hint");
    if (el) { el.textContent = String(text == null ? "" : text); return true; }
  } catch (e) { /* hint is a nicety */ }
  return false;
}

/* repaint both selects (+ the default hint) from the installed packs; keeps the current pick when
   it still exists, else falls back to the first pack/preset. Safe with partial DOMs. */
function avBankPaint(host) {
  host = host || avBankState.host;
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const st = avBankState;
    const packs = avBankPacks();
    let keep = false;
    for (let i = 0; i < packs.length; i++) if (packs[i].id === st.packId) keep = true;
    if (!keep) st.packId = packs.length ? packs[0].id : null;
    const presets = st.packId ? avBankPresets(st.packId) : [];
    let keepPreset = false;
    for (let i = 0; i < presets.length; i++) if (presets[i].i === st.presetIndex) keepPreset = true;
    if (!keepPreset) st.presetIndex = presets.length ? presets[0].i : -1;
    const packSel = host.querySelector("select.av-bank-pack");
    const presetSel = host.querySelector("select.av-bank-preset");
    if (packSel) {
      packSel.innerHTML = avBankPackOptionsHTML(packs, st.packId);
      try { if (st.packId != null) packSel.value = st.packId; } catch (e) { /* value write refused */ }
    }
    if (presetSel) {
      presetSel.innerHTML = avBankPresetOptionsHTML(presets, st.presetIndex);
      try { if (st.presetIndex >= 0) presetSel.value = String(st.presetIndex); } catch (e) { /* value write refused */ }
    }
    const hint = host.querySelector(".av-bank-hint");
    if (hint) {
      if (!packs.length) hint.textContent = "0 packs installed — the PACKS card installs banks.";
      else {
        let n = 0;
        for (let i = 0; i < packs.length; i++) n += packs[i].count;
        hint.textContent = packs.length + " pack" + (packs.length === 1 ? "" : "s") + " · " + n + " presets — pick one, then APPLY or PREVIEW.";
      }
    }
    return true;
  } catch (e) { return false; }
}

function avBankSelectedPreset() {
  const st = avBankState;
  if (!st.packId) return null;
  const list = avBankPresets(st.packId);
  for (let i = 0; i < list.length; i++) if (list[i].i === st.presetIndex) return list[i];
  return list.length ? list[0] : null;
}

function avBankUiApply() {
  const st = avBankState;
  const preset = avBankSelectedPreset();
  if (!preset) { avBankHint("nothing to apply — install a bank first."); return false; }
  const ok = avBankApplyPreset(preset);
  const r = st.lastApply;
  if (ok) {
    let msg = "applied: " + preset.name + " — " + r.accepted + "/" + r.forwarded + " paths";
    if (r.seq) msg += " + seq";
    avBankHint(msg + ".");
  } else {
    let why = "";
    if (r && r.refused && r.refused.length) why = "refused: " + r.refused.slice(0, 3).join(", ") + (r.refused.length > 3 ? " …" : "");
    else if (r && (r.seqError || r.reason)) why = r.seqError || r.reason;
    let booting = false;
    try { const w = (typeof window !== "undefined") ? window.__avEngine : null; booting = !(w && w.ready === true); } catch (e) { booting = false; }
    avBankHint("apply refused: " + preset.name + (booting ? " — engine still booting (the mirror replays at boot)" : (why ? " — " + why : "")) + ".");
  }
  return ok;
}

function avBankUiPreview() {
  const st = avBankState;
  const preset = avBankSelectedPreset();
  if (!preset) { avBankHint("nothing to preview — install a bank first."); return false; }
  avBankHint("preview: rendering " + preset.name + " …");
  const p = avBankPreview(preset.patch, preset.seq);
  if (!p || typeof p.then !== "function") { avBankHint("preview unavailable here."); return false; }
  p.then(function (r) {
    if (r && r.ok) {
      avBankHint("preview: " + preset.name + " — 2.0 s @ " + r.sr + " Hz · peak " + (Math.round(r.peak * 1000) / 1000) +
        (r.played ? "." : " (rendered; no live out)."));
    } else {
      avBankHint("preview unavailable — " + (st.lastPreviewError || "unsupported here") + ".");
    }
  }).catch(function () {
    avBankHint("preview unavailable — " + (st.lastPreviewError || "render failed") + ".");
  });
  return true;
}

function avBankEvtTarget(e) {
  const t = e && e.target;
  return (t && typeof t.closest === "function") ? t : null;
}

function avBankChange(e) {
  const t = avBankEvtTarget(e);
  if (!t) return;
  const st = avBankState;
  let sel = null;
  try { sel = t.closest("select.av-bank-pack"); } catch (e2) { sel = null; }
  if (sel) {
    st.packId = (typeof sel.value === "string" && sel.value) ? sel.value : null;
    st.presetIndex = -1;
    avBankPaint();
    return;
  }
  try { sel = t.closest("select.av-bank-preset"); } catch (e2) { sel = null; }
  if (sel) {
    const n = Math.round(Number(sel.value));
    st.presetIndex = isFinite(n) ? n : -1;
  }
}

function avBankClick(e) {
  const t = avBankEvtTarget(e);
  if (!t) return;
  let hit = null;
  try { hit = t.closest(".av-bank-apply"); } catch (e2) { hit = null; }
  if (hit) { avBankUiApply(); return; }
  try { hit = t.closest(".av-bank-preview"); } catch (e2) { hit = null; }
  if (hit) avBankUiPreview();
}

function avBankWire(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  if (host.__avBankWired === true) return true;
  host.__avBankWired = true;
  host.addEventListener("change", avBankChange);
  host.addEventListener("click", avBankClick);
  return true;
}

/* ---------- mount (§4b: #av-synth-bank-host when present, else after the #av-synth h2) ---------- */

function avBankMountHost() {
  try {
    const doc = (typeof document !== "undefined") ? document : null;
    if (!doc || typeof doc.createElement !== "function") return null;
    if (typeof doc.getElementById === "function") {
      const primary = doc.getElementById("av-synth-bank-host");
      if (primary) return primary;
    }
    if (typeof doc.querySelector !== "function") return null;
    /* idempotent fallback wrap: reuse the one we already injected */
    const existing = doc.querySelector("#av-synth .av-bank-wrap");
    if (existing) return existing;
    const h2 = doc.querySelector("#av-synth h2");
    if (!h2 || !h2.parentNode || typeof h2.parentNode.insertBefore !== "function") return null;
    const wrap = doc.createElement("div");
    try { wrap.className = "av-bank-wrap"; } catch (e) { /* className refused — markup still lands */ }
    h2.parentNode.insertBefore(wrap, h2.nextSibling || null);
    return wrap;
  } catch (e) { return null; }
}

/* mount the BANK row. false without a host (or without a DOM at all), never throws; re-mountable
   (a second call rebuilds the markup from the live store — the sibling cards' discipline). */
function avBankInit() {
  const host = avBankMountHost();
  if (!host) return false;
  try {
    host.innerHTML = avBankRowHTML();
    avBankState.host = host;
    avBankWire(host);
    avBankPaint(host);
    avBankState.mounted = true;
    avBankState.mounts += 1;
    return true;
  } catch (e) {
    try { console.warn("[anvil] bank row mount failed", e); } catch (e2) { /* console gone */ }
    return false;
  }
}

/* repaint hook for the parent/sa-1 after install/remove/hydrate (the store paint-hook seam) */
function avBankRefresh() {
  let host = avBankState.host;
  if (!host) {
    try {
      const doc = (typeof document !== "undefined") ? document : null;
      host = (doc && typeof doc.getElementById === "function") ? doc.getElementById("av-synth-bank-host") : null;
    } catch (e) { host = null; }
  }
  if (!host) return false;
  return avBankPaint(host);
}

/* ---------- css classes this row introduces (parent styles them in styles.css) ---------- */

function avBankClasses() {
  return [
    "av-bank", "av-bank-wrap", "av-bank-head", "av-bank-title", "av-bank-cap", "av-bank-row",
    "av-bank-pick", "av-bank-pick-lbl", "av-bank-pack", "av-bank-preset",
    "av-bank-apply", "av-bank-preview", "av-bank-hint",
  ];
}

/* ---------- observability (rigs + parent) ---------- */

function avBankSnap() {
  const st = avBankState;
  let packs = [], presets = 0;
  try {
    packs = avBankPacks();
    for (let i = 0; i < packs.length; i++) presets += packs[i].count;
  } catch (e) { packs = []; }
  let la = null, lp = null;
  try { if (st.lastApply) la = JSON.parse(JSON.stringify(st.lastApply)); } catch (e) { la = null; }
  try { if (st.lastPreview) lp = JSON.parse(JSON.stringify(st.lastPreview)); } catch (e) { lp = null; }
  return {
    version: AV_BANK_VERSION,
    mounted: st.mounted === true,
    mounts: st.mounts,
    wired: !!(st.host && st.host.__avBankWired === true),
    host: !!st.host,
    packs: packs.length,
    presets: presets,
    packId: st.packId,
    presetIndex: st.presetIndex,
    previewing: !!st.activeSrc,
    lastApply: la,
    lastPreview: lp,
    lastPreviewError: st.lastPreviewError,
  };
}

/* ---------- debug handle (rigs + parent call these; names are the contract) ---------- */

if (typeof window !== "undefined" && window) {
  try {
    window.__avBank = {
      version: AV_BANK_VERSION,
      init: function () { return avBankInit(); },
      refresh: function () { return avBankRefresh(); },
      apply: function (preset) { return avBankApplyPreset(preset); },
      preview: function (patch, seq) { return avBankPreview(patch, seq); },
      stop: function () { return avBankStopPreview(); },
      presets: function (packId) { return avBankPresets(packId); },
      packs: function () { return avBankPacks(); },
      classes: function () { return avBankClasses(); },
      snap: function () { return avBankSnap(); },
    };
  } catch (e) { /* no window — nothing to publish */ }
}
