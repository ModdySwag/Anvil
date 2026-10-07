/* Anvil — P6 DELIVER card (wave sa-3): the one-press STEM export orchestrator mounted into the
   parent-owned host `#av-deliver-host` (the parent adds the card at integration and calls
   avDeliverUiInit() in the boot block, like the other cards; this module only fills the host).
   Per verify/_p6_wave.md §2.5/§2.6.

   WHAT THIS CARD IS — one press renders the current pattern OFFLINE and packages the DAW-ready
   result: per-track stem WAVs, a master WAV, full + per-stem MIDI, and a README, all packed at
   the zip ROOT (zip date pinned so the bytes reproduce). Pipeline (§2.5):

     per-part avBounce (ONE part at a time — bounds peak memory; identical opts ⇒ identical
     bytes) → per-part avWavEncode → avMidExport per part + full (single cycle) → key detect
     from exported note weights → names → README → avZipBuild → sha256 per entry (crypto.subtle).

   NAMING (#58/#4): base = "anvil_<intBpm>bpm_<key>"; zip "<base>_stems.zip"; entries at the zip
   ROOT: "<base>_master.wav", "<base>_stem1.wav".."_stem4.wav" (selected only), "<base>_full.mid",
   "<base>_stem1.mid".., "README.txt". includeStems:false ⇒ a single master WAV (kind "wav",
   no zip) and the MIDI/README flags are not delivered (warning when explicitly requested).

   KEY HEURISTIC (pin outcome, implementation discretion): 12-bin pitch-class histogram (weight
   = vel × count), Pearson-correlated against the Krumhansl-Kessler major/minor profiles; the
   best correlation must clear 0.45 or the verdict is "chrom"; no notes ⇒ "nokey". Deterministic
   (strictly-greater replacement while scanning tonic 0..11, maj before min).

   README carries the checksums, so sha-256 is computed BEFORE the zip (the pin's arrow order
   places it after avZipBuild; a README that lists checksums forces the swap — each zip entry,
   README.txt included, still carries its sha256 in the result `entries`). README fields (pin):
   header · source line (pattern · loops × cycleSteps · bpm · grid · swing) · key · format
   (sr · bits · dither) · file list with size + sha256 · warnings · footer
   "Anvil v<ANVIL.version> · free · AGPL-3.0-or-later" + ISO date.

   LAW (inherit §2.6/§3): ONE namespace (avDeliver* / AV_DELIVER_*); "use strict"; NO DOM or
   engine reach-ins at load (node-loadable); every browser reach typeof-guarded inside a
   function; NEVER throws (refuse honestly); absent sibling modules degrade to warnings and an
   honest UI note (typeof-guarded facades, the av_bank pattern); the visible card is class
   prefix `av-deliver-*` reusing `av-btn` / `av-note` / `av-dim`.

   OBSERVABLES: avDeliverKey(pcWeights) → "Fmin"|"C#maj"|"chrom"|"nokey" ·
   avDeliverNames(meta) → { base, zipName, files } · avDeliverReadme(meta) → string ·
   avDeliverRun(opts) → Promise<receipt> · avDeliverDownload(bytes, name) → bool ·
   avDeliverUiInit() → bool (false without host, re-mountable) · avDeliverUiClasses() → string[] ·
   window.__avDeliverUi = { version, init, state, run, download, classes } (rig debug handle).

   ID INVENTORY (rig + parent rely on these):
     #av-deliver-run (EXPORT STEMS (.zip)) · #av-deliver-master-run (MASTER WAV) ·
     #av-deliver-status · #av-deliver-loops · #av-deliver-bits · #av-deliver-stems ·
     #av-deliver-master · #av-deliver-midi · #av-deliver-readme · #av-deliver-progress ·
     #av-deliver-result · #av-deliver-res-name · #av-deliver-res-size · #av-deliver-download ·
     #av-deliver-warnings · #av-deliver-degrade. Card root `.av-deliver[data-av-deliver="1"]`.

   SEAMS / notes for the parent at integration: avDeliverRun reads the snapshot via
   avSeqSnap() (optional opts.snap seam for rigs); the render patch rides the avParams mirror
   (opts.params passes through to avBounce — the determinism seam); the stopwatch of the UI is
   the onProgress callback (phase · done/total); the download path prefers
   showSaveFilePicker and falls back to an anchor (no user-activation → anchor; user cancel
   (AbortError) → nothing). window.__avDeliverLastDownload = { name, bytes, at, via } records
   the last call for the rig. Full browser flow is the parent's rig — this file is proven by a
   node harness only (pure functions + a DOM-stub mount test + a mock-module pipeline test).

   ONE writer (child sa-3). Never throws. */

"use strict";

const AV_DELIVER_VERSION = "p6.0";

/* naming law pins */
const AV_DELIVER_BPM_MIN = 20;
const AV_DELIVER_BPM_MAX = 300;
const AV_DELIVER_BPM_DEF = 120;
const AV_DELIVER_LOOPS_MIN = 1;
const AV_DELIVER_LOOPS_MAX = 64;
const AV_DELIVER_STEPS_MAX = 64;
const AV_DELIVER_STEMS_MAX = 4;
const AV_DELIVER_DEFAULT_STEMS = [1, 2, 3, 4];

/* key heuristic pins (Krumhansl-Kessler profiles, tonic-indexed C..B) */
const AV_DELIVER_PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const AV_DELIVER_KEY_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const AV_DELIVER_KEY_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const AV_DELIVER_KEY_CORR_MIN = 0.45;      /* below ⇒ "chrom" (ambiguous / not a key) */
const AV_DELIVER_KEY_FULL_RE = /^(?:[A-G]#?(?:maj|min)|chrom|nokey)$/;
const AV_DELIVER_KEY_PARSE_RE = /^([A-G])(#?)(maj|min)$/i;

/* ---------- module-local state (UI state only — no store/render facts cached) ---------- */

const avDeliverState = {
  inited: false, mounts: 0,
  busy: false, phase: "", done: 0, total: 0, label: "",
  lastMsg: "", lastMsgKind: "msg", lastError: "",
  lastResult: null, lastBytes: null, lastName: "", lastWarnings: [],
  opts: { loops: 1, bits: 24, stems: true, master: true, midi: true, readme: true },
};

/* ---------- small pure helpers (no DOM) ---------- */

const avDeliverEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function avDeliverClean(s, max) {
  let t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  if (max && t.length > max) t = t.slice(0, max - 1) + "…";
  return t;
}

function avDeliverNum(v, d) { const n = Number(v); return isFinite(n) ? n : d; }

/* clamp + round an int into [min,max]; non-finite ⇒ def (§2.5 knobs) */
function avDeliverInt(v, min, max, def) {
  let n = Math.round(Number(v));
  if (!isFinite(n)) return def;
  if (n < min) n = min;
  if (n > max) n = max;
  return n;
}

function avDeliverFmtSize(bytes) {
  const n = Number(bytes);
  if (!isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return Math.round(n) + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(2) + " MB";
}

/* byte length of an ArrayBuffer or any typed-array view; 0 for anything else */
function avDeliverByteLen(x) {
  try { const n = Number(x && x.byteLength); return isFinite(n) && n > 0 ? Math.round(n) : 0; } catch (e) { return 0; }
}

/* normalize ArrayBuffer | typed view → a real ArrayBuffer (or null); never throws */
function avDeliverAB(x) {
  try {
    if (!x) return null;
    if (x instanceof ArrayBuffer) return x;
    if (typeof x.byteLength === "number" && x.byteLength > 0 && x.buffer instanceof ArrayBuffer) {
      if (x.byteOffset === 0 && x.byteLength === x.buffer.byteLength) return x.buffer;
      return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength);
    }
  } catch (e) { /* refuse */ }
  return null;
}

function avDeliverUniq(list) {
  const out = [], seen = {};
  try {
    for (let i = 0; i < list.length; i++) {
      const s = String(list[i] == null ? "" : list[i]);
      if (!s || seen[s]) continue;
      seen[s] = 1;
      out.push(s);
    }
  } catch (e) { /* refuse */ }
  return out;
}

/* ---------- key detection (§2.5 pin) ---------- */

/* accept an array-like of ≥12 numbers; coerce per-bin (non-finite ⇒ 0, negatives clamp 0) */
function avDeliverPcNorm(pcWeights) {
  try {
    if (!pcWeights || typeof pcWeights.length !== "number" || pcWeights.length < 12) return null;
    const out = [];
    for (let i = 0; i < 12; i++) {
      let v = Number(pcWeights[i]);
      if (!isFinite(v) || v < 0) v = 0;
      out.push(v);
    }
    return out;
  } catch (e) { return null; }
}

/* Pearson correlation of the weights against a rotated profile */
function avDeliverCorr(w, profile, tonic) {
  let mw = 0, mp = 0;
  for (let i = 0; i < 12; i++) { mw += w[i]; mp += profile[i]; }
  mw /= 12; mp /= 12;
  let num = 0, dw = 0, dp = 0;
  for (let i = 0; i < 12; i++) {
    const p = profile[(i - tonic + 120) % 12];
    const a = w[i] - mw, b = p - mp;
    num += a * b; dw += a * a; dp += b * b;
  }
  if (dw <= 0 || dp <= 0) return 0;
  return num / Math.sqrt(dw * dp);
}

/* avDeliverKey(pcWeights) -> "Fmin" | "C#maj" | "chrom" | "nokey" (§2.5 pin).
   Deterministic: scan tonic 0..11, major before minor, replace only on strictly greater. */
function avDeliverKey(pcWeights) {
  try {
    const w = avDeliverPcNorm(pcWeights);
    if (!w) return "nokey";
    let total = 0;
    for (let i = 0; i < 12; i++) total += w[i];
    if (total <= 0) return "nokey";
    let best = -2, bestTonic = -1, bestMode = "";
    for (let tonic = 0; tonic < 12; tonic++) {
      for (let mi = 0; mi < 2; mi++) {
        const mode = (mi === 0) ? "maj" : "min";
        const r = avDeliverCorr(w, (mi === 0) ? AV_DELIVER_KEY_MAJ : AV_DELIVER_KEY_MIN, tonic);
        if (r > best) { best = r; bestTonic = tonic; bestMode = mode; }
      }
    }
    if (bestTonic < 0 || best < AV_DELIVER_KEY_CORR_MIN) return "chrom";
    return AV_DELIVER_PC_NAMES[bestTonic] + bestMode;
  } catch (e) { return "nokey"; }
}

/* note-ons out of an events array — avMidExport events or avBouncePlan events
   ({t,type:"on"|"off",midi,gain,...}); the extraction is liberal but deterministic:
   an event with NO type field is taken as a note (export event lists carry note events). */
function avDeliverNoteOns(events) {
  const out = [];
  try {
    if (!Array.isArray(events)) return out;
    for (let i = 0; i < events.length && out.length < 4096; i++) {
      const e = events[i];
      if (!e || typeof e !== "object") continue;
      let on = true;
      const t = e.type;
      if (t != null) {
        on = (t === "on" || t === "noteOn" || t === "note_on" || t === "note-on" || t === 1 || t === 144);
      }
      if (!on) continue;
      let midi = Number(e.midi != null ? e.midi : (e.note != null ? e.note : e.pitch));
      if (!isFinite(midi)) continue;
      midi = Math.round(midi);
      const velRaw = Number(e.vel != null ? e.vel : (e.gain != null ? e.gain : (e.velocity != null ? e.velocity : e.v)));
      let vel = isFinite(velRaw) ? velRaw : 1;
      if (vel <= 0) continue;
      if (vel > 1) vel = vel / 127;               /* a raw 1..127 velocity */
      out.push({ midi: midi, vel: vel });
    }
  } catch (e) { /* refuse quietly */ }
  return out;
}

/* 12-bin pitch-class histogram, weight = vel × count (pin) */
function avDeliverWeightsFromNotes(notes) {
  const w = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  try {
    if (!Array.isArray(notes)) return w;
    for (let i = 0; i < notes.length && i < 4096; i++) {
      const n = notes[i];
      if (!n || typeof n !== "object") continue;
      const midi = Number(n.midi);
      if (!isFinite(midi)) continue;
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      let vel = Number(n.vel);
      if (!isFinite(vel) || vel <= 0) vel = 1;
      w[pc] += vel;
    }
  } catch (e) { /* zeros */ }
  return w;
}

/* ---------- naming (#58/#4 pin) ---------- */

/* intBpm: rounded and clamped to the app's 20..300 domain; non-finite ⇒ 120 */
function avDeliverIntBpm(v) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return AV_DELIVER_BPM_DEF;
  return avDeliverInt(n, AV_DELIVER_BPM_MIN, AV_DELIVER_BPM_MAX, AV_DELIVER_BPM_DEF);
}

/* a key is canonicalized case-insensitively; anything else ⇒ "nokey" */
function avDeliverKeyName(k) {
  try {
    const s = String(k == null ? "" : k).trim();
    if (AV_DELIVER_KEY_FULL_RE.test(s)) {
      const m = s.match(AV_DELIVER_KEY_PARSE_RE);
      if (m) return m[1].toUpperCase() + m[2] + m[3].toLowerCase();
      return s;
    }
    const m = s.match(AV_DELIVER_KEY_PARSE_RE);
    if (m) return m[1].toUpperCase() + m[2] + m[3].toLowerCase();
  } catch (e) { /* refuse */ }
  return "nokey";
}

/* selected stem numbers: null/absent takes the default 1..4; an array is filtered to unique
   ints in 1..4, ascending; an explicit empty array stays empty */
function avDeliverStemList(v) {
  if (v == null) return AV_DELIVER_DEFAULT_STEMS.slice();
  if (!Array.isArray(v)) return AV_DELIVER_DEFAULT_STEMS.slice();
  const out = [];
  for (let i = 0; i < v.length; i++) {
    const n = Math.round(Number(v[i]));
    if (isFinite(n) && n >= 1 && n <= AV_DELIVER_STEMS_MAX && out.indexOf(n) < 0) out.push(n);
  }
  out.sort(function (a, b) { return a - b; });
  return out;
}

/* optional deliver opts.trackMask (extra seam): [bool×4] or null when absent/invalid */
function avDeliverTrackMask(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (let i = 0; i < AV_DELIVER_STEMS_MAX; i++) out.push(!!v[i]);
  return out;
}

/* avDeliverNames(meta) -> { base, zipName, files } (§2.5 pin).
   meta: { bpm, key, stems, includeStems, includeMaster, includeMidi, includeReadme }
   (all optional; flags default true; stems default 1..4). */
function avDeliverNames(meta) {
  const m = (meta && typeof meta === "object" && !Array.isArray(meta)) ? meta : {};
  let base = "anvil_?", zipName = "anvil_?_stems.zip";
  const files = [];
  try {
    base = "anvil_" + avDeliverIntBpm(m.bpm) + "bpm_" + avDeliverKeyName(m.key);
    zipName = base + "_stems.zip";
    const incS = m.includeStems !== false;
    const incM = m.includeMaster !== false;
    const incD = m.includeMidi !== false;
    const incR = m.includeReadme !== false;
    if (!incS) {
      if (incM) files.push(base + "_master.wav");
      return { base: base, zipName: zipName, files: files };
    }
    const stems = avDeliverStemList(m.stems);
    if (incM) files.push(base + "_master.wav");
    for (let i = 0; i < stems.length; i++) files.push(base + "_stem" + stems[i] + ".wav");
    if (incD) {
      files.push(base + "_full.mid");
      for (let i = 0; i < stems.length; i++) files.push(base + "_stem" + stems[i] + ".mid");
    }
    if (incR) files.push("README.txt");
  } catch (e) { /* refuse with the shape */ }
  return { base: base, zipName: zipName, files: files };
}

/* ---------- version + date + README (§2.5 field pin) ---------- */

function avDeliverAnvilVersion() {
  try { if (typeof ANVIL !== "undefined" && ANVIL && typeof ANVIL.version === "string" && ANVIL.version) return ANVIL.version; } catch (e) { /* not injected */ }
  try { if (typeof window !== "undefined" && window && window.ANVIL && typeof window.ANVIL.version === "string" && window.ANVIL.version) return window.ANVIL.version; } catch (e) { /* no window */ }
  return "dev";
}

/* ISO date (YYYY-MM-DD); null/undefined ⇒ the real date; invalid ⇒ the real date */
function avDeliverDateStr(v) {
  let d = null;
  try {
    if (v instanceof Date) d = v;
    else if (typeof v === "number" && isFinite(v)) d = new Date(v);
    else if (typeof v === "string" && v) { const t = Date.parse(v); if (isFinite(t)) d = new Date(t); }
  } catch (e) { d = null; }
  if (!d) { try { d = new Date(); } catch (e) { d = null; } }
  try {
    if (!d || !isFinite(d.getTime())) return "unknown";
    return d.toISOString().slice(0, 10);
  } catch (e) { return "unknown"; }
}

/* avDeliverReadme(meta) -> string (pure; the pin's fields in order). meta:
   { name, loops, cycleSteps, bpm, grid, swing, key, sr, bits, dither, files:[{name,size,sha256}],
     warnings:[], version, date } — every field guarded, defaults honest. */
function avDeliverReadme(meta) {
  try {
    const m = (meta && typeof meta === "object" && !Array.isArray(meta)) ? meta : {};
    const patName = avDeliverClean(m.name != null ? m.name : "untitled pattern", 80) || "untitled pattern";
    const loops = avDeliverInt(m.loops, AV_DELIVER_LOOPS_MIN, AV_DELIVER_LOOPS_MAX, 1);
    const cycleSteps = avDeliverInt(m.cycleSteps, 1, AV_DELIVER_STEPS_MAX, 16);
    const bpm = avDeliverIntBpm(m.bpm);
    const grid = (m.grid === "8t") ? "8t" : "16";
    const swing = avDeliverInt(m.swing, 50, 80, 66);
    const key = avDeliverKeyName(m.key);
    const sr = avDeliverInt(m.sr, 8000, 192000, 48000);
    const bits = (Number(m.bits) === 16) ? 16 : 24;
    const ditherOn = (m.dither === true) || (m.dither === "auto" && bits === 16);
    const version = (typeof m.version === "string" && m.version) ? m.version : avDeliverAnvilVersion();
    const date = avDeliverDateStr(m.date);
    const files = Array.isArray(m.files) ? m.files : [];
    const warnings = Array.isArray(m.warnings) ? m.warnings : [];
    const lines = [];
    lines.push("Anvil — stem export");
    lines.push("===================");
    lines.push("");
    lines.push("Source : " + patName + " · loops " + loops + " × " + cycleSteps + " steps · " + bpm + " BPM · grid " + grid + " · swing " + swing);
    lines.push("Key    : " + key);
    lines.push("Format : " + sr + " Hz · " + bits + "-bit PCM · dither " + (ditherOn ? "on" : "off"));
    lines.push("");
    lines.push("Files (" + files.length + ")");
    lines.push("----------");
    if (!files.length) lines.push("  (none)");
    for (let i = 0; i < files.length; i++) {
      const f = files[i] || {};
      const fname = avDeliverClean(f.name != null ? f.name : "?", 120) || "?";
      const size = avDeliverFmtSize(f.size);
      const sha = (typeof f.sha256 === "string" && f.sha256) ? f.sha256 : "—";
      lines.push("  " + fname + " · " + size + " · sha256 " + sha);
    }
    lines.push("");
    lines.push("Warnings");
    lines.push("--------");
    if (!warnings.length) lines.push("  (none)");
    for (let i = 0; i < warnings.length; i++) lines.push("  - " + avDeliverClean(warnings[i], 200));
    lines.push("");
    lines.push("Anvil v" + version + " · free · AGPL-3.0-or-later · " + date);
    return lines.join("\n") + "\n";
  } catch (e) {
    return "Anvil — stem export\n";
  }
}

/* ---------- utf-8 + sha-256 ---------- */

function avDeliverUtf8(str) {
  const s = String(str == null ? "" : str);
  try { if (typeof TextEncoder === "function") return new TextEncoder().encode(s); } catch (e) { /* fallback below */ }
  const out = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        const c2 = s.charCodeAt(i + 1);
        if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
          const cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
          out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
          i += 1;
          continue;
        }
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  } catch (e) { /* refuse to the partial */ }
  return Uint8Array.from(out);
}

function avDeliverSubtle() {
  try { if (typeof crypto !== "undefined" && crypto && crypto.subtle && typeof crypto.subtle.digest === "function") return crypto.subtle; } catch (e) { /* not injected */ }
  try { if (typeof window !== "undefined" && window && window.crypto && window.crypto.subtle && typeof window.crypto.subtle.digest === "function") return window.crypto.subtle; } catch (e) { /* no window */ }
  return null;
}

function avDeliverHex(buf) {
  try {
    const u8 = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < u8.length; i++) s += (u8[i] < 16 ? "0" : "") + u8[i].toString(16);
    return s;
  } catch (e) { return ""; }
}

/* sha-256 hex of bytes; "" when crypto.subtle is unavailable (honest, warned upstream) */
function avDeliverSha256(bytes) {
  try {
    const subtle = avDeliverSubtle();
    if (!subtle) return Promise.resolve("");
    return Promise.resolve(subtle.digest("SHA-256", bytes)).then(function (d) { return avDeliverHex(d); }).catch(function () { return ""; });
  } catch (e) { return Promise.resolve(""); }
}

/* ---------- guarded sibling-module resolution (typeof only; resolved per call) ---------- */

function avDeliverFns() {
  const out = { bounce: null, wav: null, midi: null, zip: null, snap: null, plan: null };
  try { if (typeof avBounce === "function") out.bounce = avBounce; } catch (e) { /* not injected */ }
  try { if (typeof avWavEncode === "function") out.wav = avWavEncode; } catch (e) { /* not injected */ }
  try { if (typeof avMidExport === "function") out.midi = avMidExport; } catch (e) { /* not injected */ }
  try { if (typeof avZipBuild === "function") out.zip = avZipBuild; } catch (e) { /* not injected */ }
  try { if (typeof avSeqSnap === "function") out.snap = avSeqSnap; } catch (e) { /* not injected */ }
  try { if (typeof avBouncePlan === "function") out.plan = avBouncePlan; } catch (e) { /* not injected */ }
  try {
    if (typeof window !== "undefined" && window) {
      if (!out.bounce && typeof window.avBounce === "function") out.bounce = window.avBounce;
      if (!out.wav && typeof window.avWavEncode === "function") out.wav = window.avWavEncode;
      if (!out.midi && typeof window.avMidExport === "function") out.midi = window.avMidExport;
      if (!out.zip && typeof window.avZipBuild === "function") out.zip = window.avZipBuild;
      if (!out.snap && typeof window.avSeqSnap === "function") out.snap = window.avSeqSnap;
      if (!out.plan && typeof window.avBouncePlan === "function") out.plan = window.avBouncePlan;
    }
  } catch (e) { /* no window */ }
  return out;
}

/* ---------- the run pipeline (§2.5) ---------- */

function avDeliverErrText(r) {
  try {
    if (r && typeof r.error === "string" && r.error) return r.error;
    if (r && typeof r.reason === "string" && r.reason) return r.reason;
  } catch (e) { /* refuse */ }
  return "refused";
}

/* the channels of a bounce part are usable (both arrays, equal positive length) */
function avDeliverChannelsOK(part) {
  try {
    return !!(part && part.l && part.r &&
      typeof part.l.length === "number" && part.l.length > 0 &&
      part.l.length === part.r.length);
  } catch (e) { return false; }
}

/* the ONE part of track t out of a receipt (track match; a single-part fallback is allowed) */
function avDeliverFindPart(r, t) {
  try {
    const parts = (r && Array.isArray(r.parts)) ? r.parts : [];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] && Math.round(Number(parts[i].track)) === t) return parts[i];
    }
    if (parts.length === 1 && parts[0]) return parts[0];
  } catch (e) { /* refuse */ }
  return null;
}

function avDeliverTakeFacts(r, facts) {
  try {
    if (!facts.sr && isFinite(Number(r.sr)) && Number(r.sr) > 0) facts.sr = Math.round(Number(r.sr));
    if (!facts.cycleSteps && isFinite(Number(r.cycleSteps)) && Number(r.cycleSteps) > 0) facts.cycleSteps = Math.round(Number(r.cycleSteps));
    if (!isFinite(facts.bpm) && isFinite(Number(r.bpm)) && Number(r.bpm) > 0) facts.bpm = Number(r.bpm);
  } catch (e) { /* keep facts */ }
}

/* cycleSteps from the snapshot itself (max track len, 1..64 — the avSeqSchedCycleLen law) */
function avDeliverSnapCycleSteps(snap) {
  try {
    let m = 0;
    if (snap && Array.isArray(snap.tracks)) {
      for (let t = 0; t < snap.tracks.length; t++) {
        const L = Math.round(Number(snap.tracks[t] && snap.tracks[t].len));
        if (isFinite(L) && L > m) m = L;
      }
    }
    if (m > 0) return Math.max(1, Math.min(AV_DELIVER_STEPS_MAX, m));
  } catch (e) { /* fall through */ }
  return 0;
}

/* pinned zip order: master.wav · stemN.wav ↑ · full.mid · stemN.mid ↑ · README.txt */
function avDeliverOrderEntries(list) {
  const out = [];
  const take = function (tag) {
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].tag === tag) { out.push(list[i]); list[i] = null; }
    }
  };
  take("master");
  for (let t = 0; t < AV_DELIVER_STEMS_MAX; t++) take("stem:" + t);
  take("fullmid");
  for (let t = 0; t < AV_DELIVER_STEMS_MAX; t++) take("stemmid:" + t);
  take("readme");
  for (let i = 0; i < list.length; i++) if (list[i]) out.push(list[i]);
  return out;
}

/* avDeliverRun(opts) -> Promise<{ ok, kind, name, bytes, entries, meta, warnings }
                                  | { ok:false, error, warnings }>  (§2.5 pin)
   opts: loops (1..64) · bits (16|24) · dither ("auto"|true|false) · includeStems (default true) ·
   includeMaster / includeMidi / includeReadme (default true) · date (null ⇒ README real date,
   zip date passthrough) · params (bounce test seam) · trackMask (optional [bool×4]) ·
   snap (optional snapshot seam) · onProgress (optional {phase,done,total,label} callback).
   One part at a time: every stem is its own avBounce render, encoded, then released. */
function avDeliverRun(opts) {
  const o = (opts && typeof opts === "object" && !Array.isArray(opts)) ? opts : {};
  const warnings = [];
  const fns = avDeliverFns();
  return new Promise(function (resolve) {
    let settled = false;
    const settle = function (r) { if (settled) return; settled = true; try { resolve(r); } catch (e) { /* resolve never throws */ } };
    (async function () {
      try {
        /* 0) module gates */
        if (!fns.bounce) { settle({ ok: false, error: "offline renderer (av_bounce.js) is not loaded — export is unavailable", warnings: warnings }); return; }
        if (!fns.wav) { settle({ ok: false, error: "WAV encoder (av_wavio.js) is not loaded — export is unavailable", warnings: warnings }); return; }

        /* 1) options */
        const loops = avDeliverInt(o.loops, AV_DELIVER_LOOPS_MIN, AV_DELIVER_LOOPS_MAX, 1);
        let bits = 24;
        if (Number(o.bits) === 16) bits = 16;
        else if (Number(o.bits) === 24) bits = 24;
        else if (o.bits != null) warnings.push("bits " + String(o.bits) + " is not supported — 24-bit used");
        let dither = "auto";
        if (o.dither === true || o.dither === false || o.dither === "auto") dither = o.dither;
        const ditherResolved = (dither === true) || (dither === "auto" && bits === 16);
        const includeStems = o.includeStems !== false;
        const includeMaster = o.includeMaster !== false;
        const includeMidi = o.includeMidi !== false;
        const includeReadme = o.includeReadme !== false;
        const userMask = avDeliverTrackMask(o.trackMask);
        const params = (o.params && typeof o.params === "object" && !Array.isArray(o.params)) ? o.params : null;

        /* includeStems:false = the single master WAV; the master is required then */
        if (!includeStems && !includeMaster) {
          settle({ ok: false, error: "nothing to render — the single-WAV export needs the master", warnings: warnings });
          return;
        }

        /* 2) snapshot (pattern metadata + the MIDI planner source) */
        let snap = (o.snap && typeof o.snap === "object" && !Array.isArray(o.snap)) ? o.snap : null;
        if (!snap && fns.snap) { try { const s = fns.snap(); if (s && typeof s === "object") snap = s; } catch (e) { snap = null; } }
        if (!snap) warnings.push("no sequence snapshot — pattern metadata falls back to defaults");

        /* 3) selection */
        let trackIdx = [];
        if (userMask) { for (let t = 0; t < AV_DELIVER_STEMS_MAX; t++) if (userMask[t]) trackIdx.push(t); }
        else { for (let t = 0; t < AV_DELIVER_STEMS_MAX; t++) trackIdx.push(t); }
        if (userMask && !trackIdx.length) warnings.push("the track selection is empty — nothing renders audible");
        const wantStems = includeStems && trackIdx.length > 0;
        const wantMaster = includeMaster;

        /* degrade notes for the extras (stated up front so the README carries them) */
        if (includeStems && includeMidi) {
          if (!snap) warnings.push("MIDI export needs the sequence snapshot — .mid files are skipped");
          else if (!fns.midi) warnings.push("MIDI module (av_mid.js) is not loaded — .mid files are skipped");
        }
        if (!includeStems) {
          if (o.includeMidi === true) warnings.push("includeStems is off — MIDI is not delivered in a single-WAV export");
          if (o.includeReadme === true) warnings.push("includeStems is off — the README is not delivered in a single-WAV export");
        }

        /* 4) progress bookkeeping (done/total reaches total even when a unit is skipped) */
        const R = wantStems ? trackIdx.length : 0;
        const M = wantMaster ? 1 : 0;
        const midiOn = includeStems && includeMidi && !!snap && !!fns.midi;
        const D = midiOn ? (1 + R) : 0;
        const C = 1;
        const W = (includeStems && includeReadme) ? 1 : 0;
        const Z = includeStems ? 1 : 0;
        const total = R + M + D + C + W + Z;
        let doneN = 0;
        const step = function (phase, label) {
          doneN += 1;
          try { if (typeof o.onProgress === "function") o.onProgress({ phase: phase, done: doneN, total: total, label: label }); } catch (e) { /* a listener never breaks the render */ }
        };

        /* 5) renders — one part at a time (§2.5 memory law) */
        const facts = { sr: 0, cycleSteps: 0, bpm: NaN };
        const entriesData = [];       /* { tag, buf } — named after key detection */
        const renderedTs = [];        /* 0-based tracks with a landed stem */
        let firstRefusal = "";
        let masterEntry = null;

        for (let i = 0; i < (wantStems ? trackIdx.length : 0); i++) {
          const t = trackIdx[i];
          const stemNo = t + 1;
          const bo = { loops: loops, includeParts: true, includeMaster: false, trackMask: [t === 0, t === 1, t === 2, t === 3] };
          if (params) bo.params = params;
          let r = null;
          try { r = await fns.bounce(bo); } catch (e) { r = null; }
          if (!r || r.ok !== true) {
            const why = r ? avDeliverErrText(r) : "renderer threw";
            if (!firstRefusal) firstRefusal = why;
            warnings.push("stem " + stemNo + " render refused (" + why + ")");
            step("render", "stem " + stemNo + " refused");
            continue;
          }
          if (Array.isArray(r.warnings)) for (let k = 0; k < r.warnings.length; k++) warnings.push(String(r.warnings[k]));
          avDeliverTakeFacts(r, facts);
          const part = avDeliverFindPart(r, t);
          if (!avDeliverChannelsOK(part)) {
            warnings.push("stem " + stemNo + " has no usable channels in the render");
            step("render", "stem " + stemNo + " empty");
            continue;
          }
          let wav = null;
          try { wav = fns.wav({ l: part.l, r: part.r, sr: facts.sr || 48000, bits: bits, dither: dither }); } catch (e) { wav = null; }
          wav = avDeliverAB(wav);
          if (!wav) {
            warnings.push("stem " + stemNo + " WAV encode refused");
            step("render", "stem " + stemNo + " encode refused");
            continue;
          }
          entriesData.push({ tag: "stem:" + t, buf: wav });
          renderedTs.push(t);
          step("render", "rendering stem " + stemNo);
        }

        if (wantMaster) {
          const bo = { loops: loops, includeParts: false, includeMaster: true };
          if (params) bo.params = params;
          if (userMask) bo.trackMask = userMask;
          let r = null;
          try { r = await fns.bounce(bo); } catch (e) { r = null; }
          if (!r || r.ok !== true) {
            const why = r ? avDeliverErrText(r) : "renderer threw";
            if (!firstRefusal) firstRefusal = why;
            warnings.push("master render refused (" + why + ")");
            step("render", "master refused");
          } else {
            if (Array.isArray(r.warnings)) for (let k = 0; k < r.warnings.length; k++) warnings.push(String(r.warnings[k]));
            avDeliverTakeFacts(r, facts);
            const part = r.master ? r.master : (Array.isArray(r.parts) && r.parts.length === 1 ? r.parts[0] : null);
            let wav = null;
            if (avDeliverChannelsOK(part)) {
              try { wav = fns.wav({ l: part.l, r: part.r, sr: facts.sr || 48000, bits: bits, dither: dither }); } catch (e) { wav = null; }
              wav = avDeliverAB(wav);
            }
            if (!wav) {
              warnings.push("master WAV encode refused");
              step("render", "master encode refused");
            } else {
              masterEntry = { tag: "master", buf: wav };
              entriesData.push(masterEntry);
              step("render", "rendering the master");
            }
          }
        }

        /* 6) MIDI — full + per landed stem (single cycle each, §2.3); refuse BEFORE the extras
           when no audio landed: a _stems.zip carrying only midi + README is not the deliverable */
        if (!entriesData.length) {
          settle({ ok: false, error: "nothing was rendered — " + (firstRefusal || "check the engine tier and the pattern"), warnings: avDeliverUniq(warnings) });
          return;
        }
        let fullEvents = null;
        if (midiOn) {
          const maskAll = userMask || [true, true, true, true];
          let full = null;
          try { full = fns.midi({ snap: snap, trackMask: maskAll, name: "full" }); } catch (e) { full = null; }
          if (full && full.ok === true) {
            const ab = avDeliverAB(full.bytes);
            if (ab) entriesData.push({ tag: "fullmid", buf: ab });
            else warnings.push("full MIDI export returned no bytes");
            if (Array.isArray(full.events)) fullEvents = full.events;
            if (Array.isArray(full.warnings)) for (let k = 0; k < full.warnings.length; k++) warnings.push(String(full.warnings[k]));
          } else {
            warnings.push("full MIDI export refused" + (full ? " (" + avDeliverErrText(full) + ")" : ""));
          }
          step("midi", "exporting full.mid");
          for (let i = 0; i < renderedTs.length; i++) {
            const t = renderedTs[i];
            const stemNo = t + 1;
            let sm = null;
            try { sm = fns.midi({ snap: snap, trackMask: [t === 0, t === 1, t === 2, t === 3], name: "stem" + stemNo }); } catch (e) { sm = null; }
            if (sm && sm.ok === true) {
              const ab = avDeliverAB(sm.bytes);
              if (ab) entriesData.push({ tag: "stemmid:" + t, buf: ab });
              else warnings.push("stem " + stemNo + " MIDI export returned no bytes");
              if (Array.isArray(sm.warnings)) for (let k = 0; k < sm.warnings.length; k++) warnings.push(String(sm.warnings[k]));
            } else {
              warnings.push("stem " + stemNo + " MIDI export refused" + (sm ? " (" + avDeliverErrText(sm) + ")" : ""));
            }
            step("midi", "exporting stem " + stemNo + " MIDI");
          }
        }

        /* 7) key detect (pinned: exported note weights; plan fallback only when export gave none) */
        let weights = null;
        if (fullEvents) {
          const notes = avDeliverNoteOns(fullEvents);
          if (notes.length) weights = avDeliverWeightsFromNotes(notes);
        }
        if (!weights && snap && fns.plan) {
          const planOpts = { loops: loops };
          if (params) planOpts.params = params;
          if (userMask) planOpts.trackMask = userMask;
          let plan = null;
          try { plan = fns.plan(snap, planOpts); } catch (e) { plan = null; }
          if (plan && plan.ok === true && Array.isArray(plan.events)) {
            const notes = avDeliverNoteOns(plan.events);
            if (notes.length) weights = avDeliverWeightsFromNotes(notes);
            if (!facts.cycleSteps && isFinite(Number(plan.cycleSteps)) && Number(plan.cycleSteps) > 0) facts.cycleSteps = Math.round(Number(plan.cycleSteps));
          }
        }
        const key = avDeliverKey(weights);

        /* 8) names + assign (§2.5 naming law; the pin's zip-root entry set) */
        const renderedStems = [];
        for (let i = 0; i < renderedTs.length; i++) renderedStems.push(renderedTs[i] + 1);
        const nm = avDeliverNames({
          bpm: facts.bpm, key: key, stems: renderedStems,
          includeStems: includeStems, includeMaster: !!masterEntry,
          includeMidi: includeMidi, includeReadme: includeReadme,
        });
        let ordered = avDeliverOrderEntries(entriesData);
        for (let i = 0; i < ordered.length; i++) {
          const e = ordered[i];
          if (e.tag === "master") e.name = nm.base + "_master.wav";
          else if (e.tag.indexOf("stemmid:") === 0) e.name = nm.base + "_stem" + (Number(e.tag.slice(8)) + 1) + ".mid";
          else if (e.tag.indexOf("stem:") === 0) e.name = nm.base + "_stem" + (Number(e.tag.slice(5)) + 1) + ".wav";
          else if (e.tag === "fullmid") e.name = nm.base + "_full.mid";
          else e.name = "entry_" + i;
        }

        /* 9) checksums (before the README — it lists them) */
        let shaMissing = false;
        for (let i = 0; i < ordered.length; i++) {
          const e = ordered[i];
          e.size = avDeliverByteLen(e.buf);
          e.sha256 = await avDeliverSha256(e.buf);
          if (!e.sha256) shaMissing = true;
        }
        if (shaMissing) warnings.push("crypto.subtle is unavailable — checksums are omitted");
        step("checksum", "computing sha-256");

        /* 10) README (rides the zip only) */
        const patternName = avDeliverClean(snap && snap.name != null ? snap.name : "untitled pattern", 80) || "untitled pattern";
        const grid = (snap && snap.grid === "8t") ? "8t" : "16";
        let swing = Math.round(Number(snap && snap.swing));
        if (!isFinite(swing)) swing = 66;
        swing = Math.max(50, Math.min(80, swing));
        const srFinal = facts.sr || 48000;
        const cycleSteps = facts.cycleSteps || avDeliverSnapCycleSteps(snap) || 16;
        const intBpm = avDeliverIntBpm(facts.bpm);
        if (includeStems && includeReadme) {
          const readmeText = avDeliverReadme({
            name: patternName, loops: loops, cycleSteps: cycleSteps, bpm: intBpm,
            grid: grid, swing: swing, key: key, sr: srFinal, bits: bits, dither: ditherResolved,
            files: ordered.map(function (e) { return { name: e.name, size: e.size, sha256: e.sha256 }; }),
            warnings: avDeliverUniq(warnings).slice(0, 40),
            version: avDeliverAnvilVersion(), date: (o.date === undefined || o.date === null) ? null : o.date,
          });
          const u8 = avDeliverUtf8(readmeText);
          const ab = avDeliverAB(u8);
          if (ab) {
            const rme = { tag: "readme", name: "README.txt", buf: ab, size: avDeliverByteLen(ab), sha256: await avDeliverSha256(ab) };
            if (!rme.sha256) shaMissing = true;
            ordered.push(rme);
          } else {
            warnings.push("README encoding refused — the zip carries no README.txt");
          }
          step("readme", "writing README.txt");
        }

        /* 11) assemble the deliverable */
        let kind = "wav", outName = nm.base + "_master.wav", outBytes = masterEntry ? masterEntry.buf : null, delivered = null;
        if (includeStems) {
          const zipEntries = ordered.map(function (e) { return { name: e.name, data: e.buf }; });
          let zb = null;
          if (fns.zip) {
            try { zb = fns.zip(zipEntries, { date: (o.date === undefined ? null : o.date) }); } catch (e) { zb = null; }
            zb = avDeliverAB(zb);
          } else {
            warnings.push("zip module (av_zipc.js) is not loaded — delivering the master WAV alone");
          }
          if (zb) {
            kind = "zip"; outName = nm.zipName; outBytes = zb; delivered = ordered;
            step("zip", "packing the zip");
          } else {
            if (fns.zip) warnings.push("zip build refused — delivering the master WAV alone");
            kind = "wav"; outName = nm.base + "_master.wav"; outBytes = masterEntry ? masterEntry.buf : null;
            delivered = ordered.filter(function (e) { return e.tag === "master"; });
            step("zip", "zip refused");
          }
        } else {
          delivered = ordered.filter(function (e) { return e.tag === "master"; });
        }
        if (!outBytes || !delivered || !delivered.length) {
          settle({ ok: false, error: "nothing was rendered — " + (firstRefusal || "check the engine tier and the pattern"), warnings: avDeliverUniq(warnings) });
          return;
        }

        /* 12) receipt */
        settle({
          ok: true, kind: kind, name: outName, bytes: outBytes,
          entries: delivered.map(function (e) {
            return { name: e.name, size: (e.size != null ? e.size : avDeliverByteLen(e.buf)), sha256: e.sha256 || "" };
          }),
          meta: {
            base: nm.base, zipName: nm.zipName, key: key, bpm: intBpm,
            loops: loops, cycleSteps: cycleSteps, grid: grid, swing: swing,
            sr: srFinal, bits: bits, dither: ditherResolved,
            stems: renderedStems.slice(), name: patternName,
            version: avDeliverAnvilVersion(),
            includeStems: includeStems, includeMaster: includeMaster,
            includeMidi: includeMidi, includeReadme: includeReadme,
            files: delivered.map(function (e) { return { name: e.name, size: (e.size != null ? e.size : avDeliverByteLen(e.buf)), sha256: e.sha256 || "" }; }),
          },
          warnings: avDeliverUniq(warnings),
        });
      } catch (e) {
        settle({ ok: false, error: String((e && (e.message || e.name)) || e) || "export failed", warnings: avDeliverUniq(warnings) });
      }
    })();
  });
}

/* ---------- download (FSA picker → anchor; never throws) ---------- */

function avDeliverPickerFn() {
  try { if (typeof showSaveFilePicker === "function") return showSaveFilePicker; } catch (e) { /* not injected */ }
  try { if (typeof window !== "undefined" && window && typeof window.showSaveFilePicker === "function") return window.showSaveFilePicker; } catch (e) { /* no window */ }
  return null;
}

function avDeliverMime(name) {
  const n = String(name || "").toLowerCase();
  if (n.slice(-4) === ".zip") return "application/zip";
  if (n.slice(-4) === ".wav") return "audio/wav";
  if (n.slice(-4) === ".mid") return "audio/midi";
  if (n.slice(-5) === ".midi") return "audio/midi";
  return "application/octet-stream";
}

function avDeliverSafeName(name) {
  let s = String(name == null ? "" : name).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/^\.+/, "");
  s = s.slice(0, 120);
  return s || "anvil_export";
}

function avDeliverDownloadRec(name, bytes) {
  try {
    if (typeof window !== "undefined" && window) {
      window.__avDeliverLastDownload = { name: name, bytes: avDeliverByteLen(bytes), at: Date.now(), via: "call" };
      return window.__avDeliverLastDownload;
    }
  } catch (e) { /* observability is a nicety */ }
  return null;
}

function avDeliverDownloadVia(name, bytes, via) {
  try { if (avDeliverDownloadRec(name, bytes) && window.__avDeliverLastDownload) window.__avDeliverLastDownload.via = via; } catch (e) { /* nicety */ }
}

function avDeliverAnchor(buf, name) {
  try {
    if (typeof document === "undefined" || !document || typeof document.createElement !== "function") return false;
    if (typeof Blob === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
    const url = URL.createObjectURL(new Blob([buf], { type: avDeliverMime(name) }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    try { a.rel = "noopener"; } catch (e) { /* attribute refused */ }
    const body = document.body;
    let attached = false;
    if (body && typeof body.appendChild === "function") { try { body.appendChild(a); attached = true; } catch (e) { attached = false; } }
    try { a.click(); } catch (e) { /* a click never throws outward here */ }
    if (attached && body && typeof body.removeChild === "function") { try { body.removeChild(a); } catch (e) { /* ok */ } }
    try { if (typeof setTimeout === "function") setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { /* ok */ } }, 8000); } catch (e) { /* ok */ }
    avDeliverDownloadVia(name, buf, "anchor");
    return true;
  } catch (e) { return false; }
}

/* avDeliverDownload(bytes, name) -> boolean (§2.5 pin). FSA showSaveFilePicker when available
   and callable (a missing user activation throws/rejects → the anchor is the honest fallback);
   a user cancel (AbortError) ends the call with nothing. Never throws. */
function avDeliverDownload(bytes, name) {
  try {
    if (!bytes || typeof bytes.byteLength !== "number" || bytes.byteLength <= 0) return false;
    const fname = avDeliverSafeName(name);
    avDeliverDownloadRec(fname, bytes);
    const pick = avDeliverPickerFn();
    if (pick) {
      try {
        const p = pick({ suggestedName: fname });
        if (p && typeof p.then === "function") {
          p.then(function (handle) {
            try {
              if (!handle || typeof handle.createWritable !== "function") { avDeliverAnchor(bytes, fname); return; }
              const w = handle.createWritable();
              Promise.resolve(w.write(bytes)).then(function () {
                try { return w.close(); } catch (e) { /* ok */ }
              }).then(function () { avDeliverDownloadVia(fname, bytes, "picker"); }).catch(function () { /* write refused — nothing else to try */ });
            } catch (e) { avDeliverAnchor(bytes, fname); }
          }).catch(function (err) {
            const nm = String((err && err.name) || "");
            if (nm === "AbortError") return;   /* the user cancelled — no fallback */
            avDeliverAnchor(bytes, fname);     /* no gesture / refused — the last resort */
          });
          return true;
        }
      } catch (e) { /* not a gesture / refused — fall through to the anchor */ }
    }
    return avDeliverAnchor(bytes, fname);
  } catch (e) { return false; }
}

/* ---------- DOM helpers (every reach guarded; no DOM at load) ---------- */

function avDeliverHost() {
  try {
    if (typeof document !== "undefined" && document && typeof document.getElementById === "function") {
      return document.getElementById("av-deliver-host");
    }
  } catch (e) { /* no document */ }
  return null;
}

function avDeliverSetText(host, sel, txt, cls) {
  try {
    const el = host.querySelector(sel);
    if (!el) return false;
    if (cls && el.className !== cls) el.className = cls;
    const t = String(txt == null ? "" : txt);
    if (el.textContent !== t) el.textContent = t;
    return true;
  } catch (e) { return false; }
}

function avDeliverSetHidden(host, sel, hidden) {
  try {
    const el = host.querySelector(sel);
    if (!el) return false;
    const h = !!hidden;
    if (el.hidden !== h) el.hidden = h;
    return true;
  } catch (e) { return false; }
}

function avDeliverSetDisabled(host, sel, disabled) {
  try {
    const el = host.querySelector(sel);
    if (!el) return false;
    const d = !!disabled;
    if (el.disabled !== d) el.disabled = d;
    return true;
  } catch (e) { return false; }
}

/* ---------- the card (markup — pure string builders) ---------- */

function avDeliverChromeHTML() {
  return '<div class="av-deliver" data-av-deliver="1">' +
    '<div class="av-deliver-head"><span class="av-deliver-title">DELIVER</span>' +
    '<span class="av-deliver-cap">one press renders the pattern offline — stems, master, full MIDI and a README packed as a zip; nothing plays live, nothing is uploaded</span></div>' +
    '<div class="av-deliver-status-line"><span class="av-deliver-status av-deliver-msg" id="av-deliver-status" role="status">ready — press EXPORT STEMS (.zip)</span></div>' +
    '<div class="av-deliver-opts">' +
    '<label class="av-deliver-opt"><span class="av-deliver-opt-lbl">LOOPS</span>' +
    '<select class="av-select av-deliver-loops" id="av-deliver-loops" aria-label="Export length in pattern loops">' +
    '<option value="1" selected>1</option><option value="2">2</option><option value="4">4</option><option value="8">8</option></select></label>' +
    '<label class="av-deliver-opt"><span class="av-deliver-opt-lbl">BITS</span>' +
    '<select class="av-select av-deliver-bits" id="av-deliver-bits" aria-label="WAV bit depth">' +
    '<option value="16">16</option><option value="24" selected>24</option></select></label>' +
    '<label class="av-deliver-check"><input type="checkbox" class="av-deliver-ck" id="av-deliver-stems" checked> STEMS</label>' +
    '<label class="av-deliver-check"><input type="checkbox" class="av-deliver-ck" id="av-deliver-master" checked> MASTER</label>' +
    '<label class="av-deliver-check"><input type="checkbox" class="av-deliver-ck" id="av-deliver-midi" checked> MIDI</label>' +
    '<label class="av-deliver-check"><input type="checkbox" class="av-deliver-ck" id="av-deliver-readme" checked> README</label>' +
    '</div>' +
    '<div class="av-deliver-actions">' +
    '<button type="button" class="av-btn av-deliver-go" id="av-deliver-run" title="Render every stem + the master + MIDI + README offline and pack them as a zip">EXPORT STEMS (.zip)</button>' +
    '<button type="button" class="av-btn av-deliver-go" id="av-deliver-master-run" title="Render just the master WAV (single file, no zip)">MASTER WAV</button>' +
    '</div>' +
    '<div class="av-deliver-progress-line"><span class="av-deliver-progress" id="av-deliver-progress" role="status"></span></div>' +
    '<div class="av-deliver-result" id="av-deliver-result" hidden>' +
    '<span class="av-deliver-res-name" id="av-deliver-res-name"></span>' +
    '<span class="av-deliver-res-size av-dim" id="av-deliver-res-size"></span>' +
    '<button type="button" class="av-btn mini av-deliver-dl" id="av-deliver-download" title="Save the last export to a file">DOWNLOAD</button></div>' +
    '<ul class="av-deliver-warn" id="av-deliver-warnings" hidden></ul>' +
    '<p class="av-deliver-note av-deliver-degrade" id="av-deliver-degrade" hidden></p>' +
    '<p class="av-deliver-foot av-note av-dim">renders run on an offline engine copy — the live instrument keeps playing; stems land sample-aligned (one identical schedule per part).</p>' +
    "</div>";
}

/* ---------- card paint / wiring / actions ---------- */

function avDeliverMods() {
  const f = avDeliverFns();
  return { bounce: !!f.bounce, wav: !!f.wav, midi: !!f.midi, zip: !!f.zip, snap: !!f.snap, subtle: !!avDeliverSubtle() };
}

function avDeliverUiPaint(hostArg) {
  const host = hostArg || avDeliverHost();
  if (!host || typeof host.querySelector !== "function") return false;
  try {
    const st = avDeliverState;
    const mods = avDeliverMods();
    const canRun = mods.bounce && mods.wav;
    try {
      const card = host.querySelector(".av-deliver");
      if (card && card.classList) card.classList.toggle("av-deliver-busy", !!st.busy);
    } catch (e) { /* nicety */ }
    const msg = st.busy ? "rendering…" : (st.lastMsg || "ready — press EXPORT STEMS (.zip)");
    const kind = st.busy ? "msg" : (st.lastMsgKind || "msg");
    avDeliverSetText(host, "#av-deliver-status", msg, "av-deliver-status " + (kind === "err" ? "av-deliver-err" : "av-deliver-msg"));
    avDeliverSetDisabled(host, "#av-deliver-run", st.busy || !canRun);
    avDeliverSetDisabled(host, "#av-deliver-master-run", st.busy || !canRun);
    let prog = "";
    if (st.busy && st.total) prog = (st.label ? st.label + " · " : "") + st.done + "/" + st.total;
    avDeliverSetText(host, "#av-deliver-progress", prog, "");
    const res = st.lastResult;
    avDeliverSetHidden(host, "#av-deliver-result", !res);
    if (res) {
      avDeliverSetText(host, "#av-deliver-res-name", res.name, "");
      avDeliverSetText(host, "#av-deliver-res-size", avDeliverFmtSize(res.size) + " · " + res.count + (res.count === 1 ? " file" : " files"), "");
    }
    avDeliverSetDisabled(host, "#av-deliver-download", !(res && st.lastBytes));
    try {
      const ul = host.querySelector("#av-deliver-warnings");
      if (ul) {
        const list = st.lastWarnings || [];
        ul.hidden = list.length === 0;
        let html = "";
        for (let i = 0; i < list.length && i < 24; i++) html += '<li class="av-deliver-warn-item">' + avDeliverEsc(list[i]) + "</li>";
        if (ul.innerHTML !== html) ul.innerHTML = html;
      }
    } catch (e) { /* nicety */ }
    try {
      const dg = host.querySelector("#av-deliver-degrade");
      if (dg) {
        const miss = [];
        if (!mods.bounce) miss.push("the offline renderer (av_bounce.js)");
        if (!mods.wav) miss.push("the WAV encoder (av_wavio.js)");
        if (!mods.midi) miss.push("the MIDI module (av_mid.js)");
        if (!mods.zip) miss.push("the zip module (av_zipc.js)");
        if (!mods.snap) miss.push("the sequencer core (av_seq_core.js)");
        let txt = "";
        if (!canRun) txt = "export unavailable — " + (miss.length ? miss.join(" and ") : "a required module") + " is not loaded.";
        else if (miss.length) txt = "degraded — " + miss.join(", ") + " not loaded; exports still render with the affected files skipped.";
        dg.hidden = !txt;
        if (dg.textContent !== txt) dg.textContent = txt;
      }
    } catch (e) { /* nicety */ }
    return true;
  } catch (e) { return false; }
}

function avDeliverUiReadOpts(host) {
  const st = avDeliverState;
  const out = { loops: st.opts.loops, bits: st.opts.bits, stems: st.opts.stems, master: st.opts.master, midi: st.opts.midi, readme: st.opts.readme };
  try {
    const l = host.querySelector("#av-deliver-loops");
    if (l) { const n = Math.round(Number(l.value)); if (isFinite(n) && n >= 1 && n <= AV_DELIVER_LOOPS_MAX) out.loops = n; }
    const b = host.querySelector("#av-deliver-bits");
    if (b) { const n = Number(b.value); if (n === 16 || n === 24) out.bits = n; }
    const ids = [["#av-deliver-stems", "stems"], ["#av-deliver-master", "master"], ["#av-deliver-midi", "midi"], ["#av-deliver-readme", "readme"]];
    for (let i = 0; i < ids.length; i++) {
      const el = host.querySelector(ids[i][0]);
      if (el && typeof el.checked === "boolean") out[ids[i][1]] = el.checked;
    }
  } catch (e) { /* keep defaults */ }
  st.opts = { loops: out.loops, bits: out.bits, stems: out.stems, master: out.master, midi: out.midi, readme: out.readme };
  return out;
}

function avDeliverUiProgress(host, evt) {
  try {
    const st = avDeliverState;
    if (!evt || typeof evt !== "object") return;
    st.phase = String(evt.phase || st.phase || "");
    st.done = Math.max(0, Math.round(Number(evt.done) || 0));
    st.total = Math.max(0, Math.round(Number(evt.total) || 0));
    st.label = String(evt.label || "");
    avDeliverUiPaint(host || avDeliverHost());
  } catch (e) { /* nicety */ }
}

function avDeliverUiRun(asMaster, hostArg) {
  const host = hostArg || avDeliverHost();
  if (!host) return false;
  const st = avDeliverState;
  if (st.busy) {
    st.lastMsg = "already rendering — one export at a time";
    st.lastMsgKind = "msg";
    avDeliverUiPaint(host);
    return false;
  }
  const mods = avDeliverMods();
  if (!mods.bounce || !mods.wav) {
    st.lastMsg = "export unavailable — the offline renderer or the WAV encoder is not loaded";
    st.lastMsgKind = "err";
    avDeliverUiPaint(host);
    return false;
  }
  const o = avDeliverUiReadOpts(host);
  const ro = {
    loops: o.loops, bits: o.bits,
    onProgress: function (evt) { avDeliverUiProgress(host, evt); },
  };
  if (asMaster) {
    ro.includeStems = false; ro.includeMaster = true; ro.includeMidi = false; ro.includeReadme = false;
  } else {
    ro.includeStems = o.stems; ro.includeMaster = o.master; ro.includeMidi = o.midi; ro.includeReadme = o.readme;
  }
  st.busy = true;
  st.lastMsg = ""; st.lastMsgKind = "msg"; st.lastError = "";
  st.lastResult = null; st.lastWarnings = [];
  st.phase = ""; st.done = 0; st.total = 0; st.label = "";
  avDeliverUiPaint(host);
  let p = null;
  try { p = avDeliverRun(ro); } catch (e) { p = null; }
  if (!p || typeof p.then !== "function") {
    st.busy = false;
    st.lastMsg = "export failed — the pipeline refused to start";
    st.lastMsgKind = "err";
    avDeliverUiPaint(host);
    return false;
  }
  Promise.resolve(p).then(function (res) {
    st.busy = false;
    st.phase = ""; st.done = 0; st.total = 0; st.label = "";
    if (res && res.ok === true) {
      const count = Array.isArray(res.entries) ? res.entries.length : 0;
      st.lastResult = { name: String(res.name || ""), size: avDeliverByteLen(res.bytes), count: count, kind: String(res.kind || "") };
      st.lastBytes = res.bytes;
      st.lastName = String(res.name || "");
      st.lastWarnings = Array.isArray(res.warnings) ? res.warnings.slice(0, 24) : [];
      st.lastMsg = (res.kind === "zip")
        ? "export ready — " + count + " files — press DOWNLOAD to save"
        : "master WAV ready — press DOWNLOAD to save";
      st.lastMsgKind = "msg";
    } else {
      st.lastError = (res && res.error) ? String(res.error) : "export failed";
      st.lastMsg = "export failed — " + st.lastError;
      st.lastMsgKind = "err";
      st.lastWarnings = (res && Array.isArray(res.warnings)) ? res.warnings.slice(0, 24) : [];
    }
    avDeliverUiPaint(host);
  }).catch(function (err) {
    st.busy = false;
    st.phase = ""; st.done = 0; st.total = 0; st.label = "";
    st.lastMsg = "export failed — " + String((err && err.message) || err || "unknown error");
    st.lastMsgKind = "err";
    avDeliverUiPaint(host);
  });
  return true;
}

function avDeliverUiDownload(hostArg) {
  const host = hostArg || avDeliverHost();
  const st = avDeliverState;
  if (!st.lastBytes || !st.lastName) return false;
  const ok = avDeliverDownload(st.lastBytes, st.lastName);
  st.lastMsg = ok ? ("saving " + st.lastName + "…") : "save failed — the browser refused the download";
  st.lastMsgKind = ok ? "msg" : "err";
  avDeliverUiPaint(host);
  return ok;
}

function avDeliverUiEvtTarget(e) {
  const t = e && e.target;
  return (t && typeof t.closest === "function") ? t : null;
}

function avDeliverUiClick(e) {
  try {
    const t = avDeliverUiEvtTarget(e);
    if (!t) return;
    if (t.closest("#av-deliver-run")) { avDeliverUiRun(false); return; }
    if (t.closest("#av-deliver-master-run")) { avDeliverUiRun(true); return; }
    if (t.closest("#av-deliver-download")) { avDeliverUiDownload(); return; }
  } catch (err) { /* a listener never throws outward */ }
}

function avDeliverUiChange(e) {
  try {
    if (!avDeliverUiEvtTarget(e)) return;
    /* options are read live at run time; a change just repaints for optics */
    avDeliverUiPaint();
  } catch (err) { /* a listener never throws outward */ }
}

function avDeliverWire(host) {
  if (!host || typeof host.addEventListener !== "function") return false;
  try {
    if (host.__avDeliverWired === true || (host.dataset && host.dataset.avDeliverUiWired === "1")) return true;
    try { host.__avDeliverWired = true; } catch (e) { /* ok */ }
    if (host.dataset) { try { host.dataset.avDeliverUiWired = "1"; } catch (e) { /* ok */ } }
    host.addEventListener("click", avDeliverUiClick);
    host.addEventListener("change", avDeliverUiChange);
    return true;
  } catch (e) { return false; }
}

/* ---------- init (mount, re-mountable; absent host ⇒ false, no throw) ---------- */

function avDeliverUiInit() {
  const host = avDeliverHost();
  if (!host) return false;
  try {
    let card = null;
    try { card = (typeof host.querySelector === "function") ? host.querySelector(".av-deliver") : null; } catch (e) { card = null; }
    if (!card) host.innerHTML = avDeliverChromeHTML();
    avDeliverWire(host);
    avDeliverState.inited = true;
    avDeliverState.mounts += 1;
    avDeliverUiPaint(host);
    return true;
  } catch (e) {
    try { console.warn("[anvil] deliver card mount failed", e); } catch (e2) { /* console gone */ }
    return false;
  }
}

/* ---------- css classes this card introduces (parent styles them in styles.css) ---------- */

function avDeliverUiClasses() {
  return [
    "av-deliver", "av-deliver-head", "av-deliver-title", "av-deliver-cap",
    "av-deliver-status-line", "av-deliver-status", "av-deliver-msg", "av-deliver-err",
    "av-deliver-opts", "av-deliver-opt", "av-deliver-opt-lbl", "av-deliver-loops", "av-deliver-bits",
    "av-deliver-check", "av-deliver-ck",
    "av-deliver-actions", "av-deliver-go",
    "av-deliver-progress-line", "av-deliver-progress",
    "av-deliver-result", "av-deliver-res-name", "av-deliver-res-size", "av-deliver-dl",
    "av-deliver-warn", "av-deliver-warn-item", "av-deliver-note", "av-deliver-degrade",
    "av-deliver-foot", "av-deliver-busy",
  ];
}

/* ---------- observability (rigs + parent) ---------- */

function avDeliverUiState() {
  const st = avDeliverState;
  const mods = avDeliverMods();
  const host = avDeliverHost();
  let card = false, wired = false;
  try {
    if (host) {
      card = !!(typeof host.querySelector === "function" && host.querySelector(".av-deliver"));
      wired = !!(host.__avDeliverWired === true || (host.dataset && host.dataset.avDeliverUiWired === "1"));
    }
  } catch (e) { /* no DOM */ }
  return {
    version: AV_DELIVER_VERSION,
    inited: !!st.inited, mounts: st.mounts,
    host: !!host, card: card, wired: wired,
    busy: !!st.busy, phase: st.phase, done: st.done, total: st.total, label: st.label,
    opts: { loops: st.opts.loops, bits: st.opts.bits, stems: st.opts.stems, master: st.opts.master, midi: st.opts.midi, readme: st.opts.readme },
    lastMsg: st.lastMsg, lastMsgKind: st.lastMsgKind, lastError: st.lastError,
    lastResult: st.lastResult ? { name: st.lastResult.name, size: st.lastResult.size, count: st.lastResult.count, kind: st.lastResult.kind } : null,
    hasBytes: !!st.lastBytes, lastName: st.lastName,
    warnings: (st.lastWarnings || []).slice(0, 20),
    modules: mods,
  };
}

/* ---------- debug/verify handle (house style; state() + run() are the pin) ---------- */

if (typeof window !== "undefined" && window) {
  try {
    window.__avDeliverUi = {
      version: AV_DELIVER_VERSION,
      init: function () { return avDeliverUiInit(); },
      state: function () { return avDeliverUiState(); },
      run: function (opts) { return avDeliverRun(opts); },
      download: function (bytes, name) { return avDeliverDownload(bytes, name); },
      classes: function () { return avDeliverUiClasses(); },
    };
  } catch (e) { /* no window — nothing to publish */ }
}
