/* av_card.js — Anvil S4 SHARE CARD CORE (child sa-B, verify/_s4_wave.md §2.2): patch capture
   (name/kind/params/macros), the compact link encoder (`#avp=` + base64url JSON), the fragment
   apply path (av_session.js's commit discipline: kind first, params in sorted order, then
   mod.macro1..8 through the CURRENT avApplyParam funnel), a CLEAN-ROOM byte-mode QR encoder
   (error correction M, versions 1..15, penalty-based mask selection with a lowest-number
   tie-break — no libraries), the deterministic 1080x1080 PNG share card (dark graphite + teal
   house palette, drawn on the module's own offscreen canvas), and the share/copy helpers
   (navigator.share guarded, clipboard guarded, honest degrade everywhere else).

   PUBLIC SURFACE (classic-script globals, ONE namespace avCard* / AV_CARD_*):
     avCardInit() -> bool                 idempotent; no DOM; nothing to bind
     avCardBuild(patch?) -> {ok, patch, warnings[]}
     avCardEncode(patch) -> {ok, enc, chars, bytes}
     avCardDecode(enc) -> {ok, patch}
     avCardUrl(patch, base?) -> {ok, url, enc}
     avCardApplyUrl(hash?) -> {ok, applied, skipped[], macros, error}
     avCardQr(text) -> {ok, version, ec, size, mask, matrix}
     avCardQrSelfCheck(text) -> {ok, version, syndromesZero, formatOk}
     avCardPng(patch, url?) -> Promise<{ok, blob, bytes, w, h}>
     avCardShare(opts?) -> Promise<receipt>
     avCardCopyLink(patch?) -> Promise<{ok, url, via}>
     avCardClasses() -> []                mounts nothing
     avCardState() -> {...}               honest card state for rigs
     window.__avCard = { version, init, build, encode, decode, url, applyUrl, qr, qrSelfCheck,
                         png, share, copy, state, classes }

   LINK PAYLOAD v1 (url = location.origin + pathname + "#avp=" + base64url(JSON)), keys in a fixed
   order, empties omitted — compact + deterministic (no Date, no random):
     { n: name (string <=48; from the session name when reachable),
       k: engine kind (string <=32; read from the avParams mirror "engine.kind" when present),
       p: { dotted-path: finite number | boolean }  sorted keys, <=256 entries; mod.macro1..8 are
          carried by `m` (never duplicated into p), engine.kind by `k`,
       m: [8 numbers clamped 0..1 from avModPayload() — zeros when av_mod is absent] }
   avCardEncode refuses > 2048 chars honestly (v1 cap). avCardDecode is tolerant (bad base64 /
   JSON / shape -> ok:false) and sanitises whatever comes through (path shape belt keeps
   `__proto__`-class keys out; numbers must be finite; booleans normalise to 1/0 on APPLY, exactly
   like av_session's value law).

   APPLY ORDER (mirrors av_session.js's apply — the ONLY working-state path): kind first through
   the CURRENT funnel (`avApplyParam`, resolved per call — the av_mod / av_undo / av_plock wraps
   reassign it), then the p paths in sorted order, then macros `mod.macro1`..`mod.macro8` exactly
   the way av_session's mod rows commit (regex /^mod\.macro[1-8]$/; when the funnel we called is
   av_mod's wrap, `funnel.__avModWrap === true` is the acceptance belt). When NO funnel exists at
   all, avModMacroSet(i, v) (the module's own setter) is the honest degraded landing for macros.
   Receipt { ok, applied, skipped, macros, error? }; restore discipline is the CALLER's.

   QR (clean-room, §2.2): byte mode only; mode indicator 0100; 8-bit character count for v1..9
   and 16-bit for v10..15; data codewords; Reed-Solomon over GF(2^8) with primitive polynomial
   0x11D and the EC-M block structure per version; block interleaving; matrix with finder /
   separator / timing / alignment / format / version modules; every mask of the 8 is scored by the
   spec penalty rules (N1=3 N2=3 N3=40 N4=10) and the LOWEST penalty wins, ties to the LOWEST mask
   number (deterministic). `matrix` = rows of "0"/"1" strings (JSON-safe; row 0 = top; "1" = dark).
   Text cap 500 bytes; over that (or over version 15's byte capacity, 412) = honest refusal.
   avCardQrSelfCheck(text) proves the encoder from the produced MATRIX: the format-info bits are
   read back from both copies, XOR-unmasked and BCH-checked; the codewords are re-extracted through
   the unmask + placement walk, de-interleaved into blocks, and Reed-Solomon syndromes recomputed —
   every syndrome must be zero.

   PNG CARD: the module's OWN canvas (document.createElement guarded; OffscreenCanvas fallback);
   pure drawing from the payload (no Date, no random) — dark graphite base, teal accents, the
   wordmark "ANVIL — a MODDYS Foundry instrument", patch name, kind, up to 8 parameter lines, the
   QR when the URL text fits (else the honest "link too long for QR" note), the URL text and the
   footer "free · local-first · moddys.net"; canvas.toBlob('image/png') wrapped in a promise.

   SHARE: build + encode + png -> navigator.share({files:[file]}) when navigator.canShare agrees
   (guarded per call; user-cancel = calm ok:false), else avDeliverDownload / an own anchor.
   Observable: window.__avCardLast = { enc, url, pngBytes, via, at }.

   LAWS (verify/_s4_wave.md §3): "use strict"; classic script; ONE namespace; node-loadable (zero
   DOM at load — the only browser touch is the guarded window publish at the end); never throws
   (every public call catches; refusals are honest receipts); no console noise; bounded growth
   (caps everywhere, notes capped); QR = own clean-room math (no libraries); nothing uploads —
   link, QR and card are local artifacts. */

"use strict";

/* ---------- pins (§2.2) ---------- */

const AV_CARD_VERSION = "s4.0";
const AV_CARD_FRAG = "#avp=";
const AV_CARD_ENC_CAP = 2048;              /* base64url chars (v1 link cap) */
const AV_CARD_NAME_CAP = 48;               /* payload name cap */
const AV_CARD_KIND_CAP = 32;               /* payload kind cap */
const AV_CARD_PARAM_CAP = 256;             /* payload param entries cap */
const AV_CARD_CARD_PARAMS = 8;             /* parameter lines drawn on the PNG card */
const AV_CARD_NOTE_CAP = 8;                /* bounded notes/warnings */
const AV_CARD_SKIP_OBS = 16;               /* skipped paths kept in the rig observable */
const AV_CARD_MACRO_COUNT = 8;             /* av_mod's pinned macro count */
const AV_CARD_PNG_W = 1080;
const AV_CARD_PNG_H = 1080;
const AV_CARD_QR_TEXT_CAP = 500;           /* QR text byte cap (§2.2) */
const AV_CARD_QR_EC = "M";
const AV_CARD_QR_VER_MAX = 15;
const AV_CARD_CLASSES = Object.freeze([]); /* this module mounts nothing */

/* a §2.2 path is a dotted identifier starting with a letter — the belt keeps `__proto__`-class
   keys out of a patch (identical shape to av_session's AV_SESSION_PATH_RE) */
const AV_CARD_PATH_RE = /^[A-Za-z][A-Za-z0-9_.-]*$/;
/* av_mod's wrap turf; when that wrap is the funnel we called, its marker is the acceptance */
const AV_CARD_MACRO_RE = /^mod\.macro[1-8]$/;

/* house palette (styles.css tokens, baked for the canvas) */
const AV_CARD_COL = {
  bg: "#0A0E11", panel: "#10161B", hair: "#22303A",
  teal: "#2ED8C9", tealDeep: "#0F8F85", tealGlow: "#7FF3E8",
  text: "#E8F1F2", text2: "#9FB3BC", text3: "#6B7F8A", white: "#FFFFFF",
};

/* ---------- module state (single source of truth; never holds DOM nodes) ---------- */

const avCard = {
  inited: false,
  mounts: 0,
  lastEncode: null,     /* { ok, chars, bytes } */
  lastApply: null,      /* { ok, applied, skipped, macros } */
  lastQr: null,         /* { ok, version, size, mask, penalty } */
  lastPng: null,        /* { ok, bytes } */
  lastShare: null,      /* { ok, via, pngBytes } */
  lastCopy: null,       /* { ok, via } */
  lastError: null,
  notes: [],            /* bounded strings */
};

function avCardNote(text) {
  try {
    avCard.notes.push(String(text).slice(0, 120));
    while (avCard.notes.length > AV_CARD_NOTE_CAP) avCard.notes.shift();
  } catch (e) { /* notes are a nicety */ }
}

function avCardFail(where, e) {
  try { avCard.lastError = String(where) + ": " + avCardErrMsg(e); } catch (e2) { /* ok */ }
}

/* ---------- tiny value laws (garbage in, sane value out — never throw) ---------- */

function avCardObj(v) { return (v !== null && typeof v === "object" && !Array.isArray(v)); }

function avCardErrMsg(e) {
  try { const s = (e && e.message) ? String(e.message) : String(e); return s.slice(0, 120); } catch (e2) { return "error"; }
}

function avCardText(v, cap, dflt) {
  try {
    if (typeof v === "number") { if (!isFinite(v)) return dflt; v = String(v); }
    if (typeof v !== "string") return dflt;
    const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, cap || 80);
    return s || dflt;
  } catch (e) { return dflt; }
}

function avCardNow() { try { return Date.now(); } catch (e) { return 0; } }

function avCardCount(obj) {
  try { return avCardObj(obj) ? Object.keys(obj).length : 0; } catch (e) { return 0; }
}

function avCardSlug(name) {
  try {
    const s = String(name == null ? "" : name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return s || "untitled";
  } catch (e) { return "untitled"; }
}

function avCardClip(s, n) {
  try {
    const t = String(s == null ? "" : s);
    return (t.length > n) ? (t.slice(0, Math.max(1, n - 1)) + "…") : t;
  } catch (e) { return ""; }
}

function avCardPad(s, n) {
  try {
    const t = String(s == null ? "" : s);
    return (t.length >= n) ? t : t + " ".repeat(n - t.length);
  } catch (e) { return ""; }
}

function avCardValText(v) {
  try {
    if (typeof v === "boolean") return v ? "on" : "off";
    if (typeof v === "number") {
      if (!isFinite(v)) return "—";
      if (Number.isInteger(v)) return String(v);
      return String(Math.round(v * 1000) / 1000);
    }
    return String(v);
  } catch (e) { return "?"; }
}

/* ---------- guarded environment reaches (plain node has none of these) ---------- */

/* the avParams mirror (av_knob.js owns it; classic scripts share the scope) */
function avCardParamsMirror() {
  try { if (typeof avParams !== "undefined" && avParams && typeof avParams === "object") return avParams; } catch (e) { /* not injected */ }
  return null;
}

/* macros from avModPayload() — exactly 8 clamped 0..1 numbers (zeros when av_mod is absent);
   mirrors av_session's avSessionMacrosSnap */
function avCardMacrosFromPayload() {
  const out = [0, 0, 0, 0, 0, 0, 0, 0];
  try {
    if (typeof avModPayload === "function") {
      const p = avModPayload();
      const m = (p && typeof p === "object") ? p.macros : null;
      if (m && typeof m.length === "number") {
        for (let i = 0; i < AV_CARD_MACRO_COUNT && i < m.length; i++) {
          const v = Number(m[i]);
          out[i] = isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
        }
      }
    }
  } catch (e) { /* not loaded — zeros */ }
  return out;
}

/* the session name reach (avSessionState().current.name when the sessions core is up) */
function avCardSessionName() {
  try {
    if (typeof avSessionState === "function") {
      const s = avSessionState();
      if (s && s.current && typeof s.current.name === "string") return avCardText(s.current.name, AV_CARD_NAME_CAP, "");
    }
  } catch (e) { /* not loaded */ }
  return "";
}

/* the CURRENT funnel binding (resolved per call — the wraps reassign avApplyParam); identical
   resolution order to av_session's avSessionFunnel */
function avCardFunnel() {
  try { if (typeof avApplyParam === "function") return avApplyParam; } catch (e) { /* not injected */ }
  try { if (typeof window !== "undefined" && window && typeof window.avApplyParam === "function") return window.avApplyParam; } catch (e) { /* no window */ }
  return null;
}

/* location reach for the link base: location.origin + location.pathname (§2.2 default) */
function avCardLocationBase() {
  try {
    if (typeof location !== "undefined" && location) {
      const o = String(location.origin || ""), p = String(location.pathname || "");
      if (o || p) return o + p;
    }
  } catch (e) { /* no location */ }
  try {
    const w = (typeof window !== "undefined") ? window : null;
    if (w && w.location) {
      const o = String(w.location.origin || ""), p = String(w.location.pathname || "");
      if (o || p) return o + p;
    }
  } catch (e) { /* no window */ }
  return "";
}

function avCardLocationHash() {
  try { if (typeof location !== "undefined" && location && typeof location.hash === "string") return location.hash; } catch (e) { /* no location */ }
  try {
    const w = (typeof window !== "undefined") ? window : null;
    if (w && w.location && typeof w.location.hash === "string") return w.location.hash;
  } catch (e) { /* no window */ }
  return null;
}

function avCardNav() {
  try { if (typeof navigator !== "undefined" && navigator) return navigator; } catch (e) { /* none */ }
  try {
    const w = (typeof window !== "undefined") ? window : null;
    if (w && w.navigator) return w.navigator;
  } catch (e) { /* none */ }
  return null;
}

function avCardDocument() {
  try { if (typeof document !== "undefined" && document) return document; } catch (e) { /* none */ }
  try {
    const w = (typeof window !== "undefined") ? window : null;
    if (w && w.document) return w.document;
  } catch (e) { /* none */ }
  return null;
}

/* avDeliverDownload reach (av_deliver_ui.js — FSA-save-preferred with anchor fallback) */
function avCardDeliver() {
  try { if (typeof avDeliverDownload === "function") return avDeliverDownload; } catch (e) { /* not loaded */ }
  try { if (typeof window !== "undefined" && window && typeof window.avDeliverDownload === "function") return window.avDeliverDownload; } catch (e) { /* no window */ }
  return null;
}

/* ---------- payload sanitation (build / decode share the same laws) ---------- */

/* p: { path: finite number | boolean }, sorted keys, <=256 entries; mod.macro1..8 are carried by
   `m` and engine.kind by `k` — never duplicated into p. Returns { p, dropped }. */
function avCardParamsNorm(src) {
  const out = {};
  let dropped = 0;
  try {
    if (!avCardObj(src)) return { p: out, dropped: 0 };
    let keys = [];
    try { keys = Object.keys(src).sort(); } catch (e) { keys = []; }
    let n = 0;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (typeof k !== "string" || !AV_CARD_PATH_RE.test(k)) { dropped += 1; continue; }
      if (k === "engine.kind" || AV_CARD_MACRO_RE.test(k)) continue;   /* carried by k / m */
      const v = src[k], t = typeof v;
      let keep = null;
      if (t === "number") { if (isFinite(v)) keep = v; }
      else if (t === "boolean") keep = v;
      if (keep === null) { dropped += 1; continue; }
      if (n >= AV_CARD_PARAM_CAP) { dropped += 1; continue; }
      out[k] = keep;
      n += 1;
    }
  } catch (e) { /* {} is the honest empty */ }
  return { p: out, dropped: dropped };
}

/* m: exactly 8 numbers clamped 0..1 (missing/garbage -> 0) */
function avCardMacrosNorm(src) {
  const out = [0, 0, 0, 0, 0, 0, 0, 0];
  try {
    if (src && typeof src.length === "number") {
      for (let i = 0; i < AV_CARD_MACRO_COUNT && i < src.length; i++) {
        const v = Number(src[i]);
        out[i] = isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
      }
    }
  } catch (e) { /* zeros */ }
  return out;
}

/* first present override wins (short payload keys + long house aliases both accepted) */
function avCardFirst(v1, v2) {
  if (v1 !== undefined && v1 !== null) return v1;
  if (v2 !== undefined && v2 !== null) return v2;
  return undefined;
}

/* ---------- avCardBuild (§2.2) — live defaults: name/kind/params/macros ---------- */

function avCardBuild(patch) {
  const warnings = [];
  try {
    const o = avCardObj(patch) ? patch : {};
    /* live defaults */
    let name = avCardSessionName();
    let kind = "";
    try {
      const mirror = avCardParamsMirror();
      if (mirror && "engine.kind" in mirror) kind = avCardText(mirror["engine.kind"], AV_CARD_KIND_CAP, "");
    } catch (e) { /* no mirror */ }
    const liveP = avCardParamsNorm(avCardParamsMirror());
    if (liveP.dropped > 0) { avCardNote("build dropped " + liveP.dropped + " param entries"); warnings.push("params: " + liveP.dropped + " entries dropped"); }
    let p = liveP.p;
    let m = avCardMacrosFromPayload();
    /* overrides (payload shape n/k/p/m first, house aliases name/kind/params/macros second) */
    const oName = avCardFirst(o.n, o.name);
    if (oName !== undefined) name = avCardText(oName, AV_CARD_NAME_CAP, "");
    const oKind = avCardFirst(o.k, o.kind);
    if (oKind !== undefined) kind = avCardText(oKind, AV_CARD_KIND_CAP, "");
    const oParams = avCardFirst(o.p, o.params);
    if (oParams !== undefined) {
      if (avCardObj(oParams)) {
        const norm = avCardParamsNorm(oParams);
        p = norm.p;
        if (norm.dropped > 0) { avCardNote("build dropped " + norm.dropped + " param entries"); warnings.push("params: " + norm.dropped + " entries dropped"); }
      } else {
        p = {};
        warnings.push("params: not an object — refused");
      }
    }
    const oMacros = avCardFirst(o.m, o.macros);
    if (oMacros !== undefined) m = avCardMacrosNorm(oMacros);
    const built = { n: name, k: kind, p: p, m: m };
    return { ok: true, error: null, patch: built, warnings: warnings.slice(0, AV_CARD_NOTE_CAP) };
  } catch (e) {
    avCardFail("build", e);
    return { ok: false, error: avCardErrMsg(e), patch: { n: "", k: "", p: {}, m: [0, 0, 0, 0, 0, 0, 0, 0] }, warnings: warnings.slice(0, AV_CARD_NOTE_CAP) };
  }
}

/* ---------- UTF-8 + base64url (own math — TextEncoder/atob are not assumed) ---------- */

const AV_CARD_B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const AV_CARD_B64_INV = (function () {
  const t = new Array(128);
  for (let i = 0; i < 128; i++) t[i] = -1;
  for (let i = 0; i < AV_CARD_B64_CHARS.length; i++) t[AV_CARD_B64_CHARS.charCodeAt(i)] = i;
  t["+".charCodeAt(0)] = 62;   /* tolerant aliases on decode */
  t["/".charCodeAt(0)] = 63;
  return t;
})();

function avCardUtf8(s) {
  const out = [];
  try {
    const t = String(s == null ? "" : s);
    for (let i = 0; i < t.length; i++) {
      let c = t.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < t.length) {
        const lo = t.charCodeAt(i + 1);
        if (lo >= 0xDC00 && lo <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (lo - 0xDC00); i += 1; }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  } catch (e) { /* empty */ }
  return out;
}

function avCardUtf8Decode(bytes) {
  try {
    let s = "";
    let i = 0;
    while (i < bytes.length) {
      const b = bytes[i++];
      if (b < 0x80) { s += String.fromCharCode(b); continue; }
      let n = 0, cp = 0;
      if ((b & 0xE0) === 0xC0) { n = 1; cp = b & 0x1F; }
      else if ((b & 0xF0) === 0xE0) { n = 2; cp = b & 0x0F; }
      else if ((b & 0xF8) === 0xF0) { n = 3; cp = b & 0x07; }
      else return null;                              /* invalid lead byte */
      if (i + n > bytes.length) return null;
      for (let k = 0; k < n; k++) {
        const c = bytes[i++];
        if ((c & 0xC0) !== 0x80) return null;        /* invalid continuation */
        cp = (cp << 6) | (c & 0x3F);
      }
      if (cp > 0x10FFFF) return null;
      if (cp >= 0x10000) { cp -= 0x10000; s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF)); }
      else s += String.fromCharCode(cp);
    }
    return s;
  } catch (e) { return null; }
}

function avCardB64uEncode(bytes) {
  let out = "";
  try {
    const n = bytes.length;
    let i = 0;
    for (; i + 2 < n; i += 3) {
      const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += AV_CARD_B64_CHARS.charAt((v >> 18) & 63) + AV_CARD_B64_CHARS.charAt((v >> 12) & 63) +
             AV_CARD_B64_CHARS.charAt((v >> 6) & 63) + AV_CARD_B64_CHARS.charAt(v & 63);
    }
    if (n - i === 1) {
      const v = bytes[i] << 16;
      out += AV_CARD_B64_CHARS.charAt((v >> 18) & 63) + AV_CARD_B64_CHARS.charAt((v >> 12) & 63);
    } else if (n - i === 2) {
      const v = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += AV_CARD_B64_CHARS.charAt((v >> 18) & 63) + AV_CARD_B64_CHARS.charAt((v >> 12) & 63) + AV_CARD_B64_CHARS.charAt((v >> 6) & 63);
    }
  } catch (e) { /* honest short output */ }
  return out;
}

function avCardB64uDecode(s) {
  try {
    if (typeof s !== "string") return null;
    let t = "";
    for (let i = 0; i < s.length; i++) {
      const ch = s.charAt(i);
      if (ch === "=") continue;                        /* padding optional */
      if (ch === "+") { t += "-"; continue; }          /* tolerant aliases */
      if (ch === "/") { t += "_"; continue; }
      t += ch;
    }
    if (t.length % 4 === 1) return null;               /* impossible quantum */
    const out = [];
    let buffer = 0, bits = 0;
    for (let i = 0; i < t.length; i++) {
      const code = t.charCodeAt(i);
      const v = (code < 128) ? AV_CARD_B64_INV[code] : -1;
      if (v < 0) return null;
      buffer = (buffer << 6) | v;
      bits += 6;
      if (bits >= 8) { bits -= 8; out.push((buffer >> bits) & 0xFF); }
    }
    return out;
  } catch (e) { return null; }
}

/* ---------- avCardEncode / avCardDecode (§2.2) ---------- */

/* wire = { n, k, p, m } in that fixed order, empties omitted (compact); JSON -> UTF-8 ->
   base64url (no padding). Deterministic: same patch in, same enc out. */
function avCardEncode(patch) {
  try {
    const built = avCardBuild(patch);
    const p = built.patch;
    const wire = {};
    if (p.n) wire.n = p.n;
    if (p.k) wire.k = p.k;
    if (avCardCount(p.p) > 0) wire.p = p.p;
    let mZero = true;
    for (let i = 0; i < AV_CARD_MACRO_COUNT; i++) if (p.m[i] !== 0) { mZero = false; break; }
    if (!mZero) wire.m = p.m;
    const json = JSON.stringify(wire);
    const bytes = avCardUtf8(json);
    const enc = avCardB64uEncode(bytes);
    if (enc.length === 0) {
      avCard.lastEncode = { ok: false, chars: 0, bytes: 0 };
      return { ok: false, error: "encode produced nothing", enc: "", chars: 0, bytes: 0 };
    }
    if (enc.length > AV_CARD_ENC_CAP) {
      avCard.lastEncode = { ok: false, chars: enc.length, bytes: bytes.length };
      avCardNote("link exceeds " + AV_CARD_ENC_CAP + " chars");
      return { ok: false, error: "link exceeds " + AV_CARD_ENC_CAP + " characters", enc: "", chars: enc.length, bytes: bytes.length };
    }
    avCard.lastEncode = { ok: true, chars: enc.length, bytes: bytes.length };
    return { ok: true, error: null, enc: enc, chars: enc.length, bytes: bytes.length };
  } catch (e) {
    avCardFail("encode", e);
    return { ok: false, error: avCardErrMsg(e), enc: "", chars: 0, bytes: 0 };
  }
}

/* tolerant decode: bad base64 / UTF-8 / JSON / shape = ok:false; anything that passes is
   sanitised exactly like build (belt: path shape, finite numbers, booleans, caps). */
function avCardDecode(enc) {
  const receipt = { ok: false, error: null, patch: null };
  try {
    if (typeof enc !== "string" || !enc) { receipt.error = "not a string"; return receipt; }
    let s = enc;
    const cut = s.indexOf(AV_CARD_FRAG);
    if (cut >= 0) s = s.slice(cut + AV_CARD_FRAG.length);
    s = s.replace(/\s+/g, "");
    if (!s) { receipt.error = "empty payload"; return receipt; }
    if (s.length > AV_CARD_ENC_CAP + 64) { receipt.error = "link too long"; return receipt; }
    const bytes = avCardB64uDecode(s);
    if (!bytes || bytes.length === 0) { receipt.error = "bad base64"; return receipt; }
    const json = avCardUtf8Decode(bytes);
    if (json === null) { receipt.error = "bad utf-8"; return receipt; }
    let obj = null;
    try { obj = JSON.parse(json); } catch (e) { receipt.error = "bad json"; return receipt; }
    if (!avCardObj(obj)) { receipt.error = "not a patch object"; return receipt; }
    const patch = {
      n: avCardText(obj.n, AV_CARD_NAME_CAP, ""),
      k: avCardText(obj.k, AV_CARD_KIND_CAP, ""),
      p: avCardParamsNorm(obj.p).p,
      m: avCardMacrosNorm(obj.m),
    };
    receipt.ok = true;
    receipt.patch = patch;
    return receipt;
  } catch (e) {
    receipt.ok = false;
    receipt.error = avCardErrMsg(e);
    return receipt;
  }
}

/* ---------- avCardUrl / avCardApplyUrl (§2.2) ---------- */

function avCardUrl(patch, base) {
  try {
    const e = avCardEncode(patch);
    if (!e.ok) return { ok: false, error: e.error, url: "", enc: "" };
    let b = (typeof base === "string") ? base : null;
    if (b === null) b = avCardLocationBase();
    if (b && b.charAt(b.length - 1) === "#") b = b.slice(0, -1);
    const url = b + AV_CARD_FRAG + e.enc;
    return { ok: true, error: null, url: url, enc: e.enc };
  } catch (e) {
    avCardFail("url", e);
    return { ok: false, error: avCardErrMsg(e), url: "", enc: "" };
  }
}

/* extract the enc from anything fragment-ish: a full URL, "#avp=...", "avp=...", a bare enc */
function avCardFragmentEnc(s) {
  try {
    if (typeof s !== "string" || !s) return null;
    let t = s;
    const cut = t.indexOf(AV_CARD_FRAG);
    if (cut >= 0) return t.slice(cut + AV_CARD_FRAG.length) || null;
    if (t.charAt(0) === "#") t = t.slice(1);
    if (t.indexOf("avp=") === 0) t = t.slice(4);
    if (t.indexOf("#") >= 0) return null;
    return t || null;
  } catch (e) { return null; }
}

/* avCardApplyUrl(hash?) -> { ok, applied, skipped[], macros, error? }
   Apply order mirrors av_session.js §2.2: kind first, then the p paths (sorted — decode
   guarantees that), then mod.macro1..8 through the CURRENT funnel binding (acceptance belt:
   rv !== false, or av_mod's wrap marker on a mod.macro path — the bank belt). No funnel at all
   -> avModMacroSet(i, v) is the honest degraded macro landing. Restore discipline is the
   CALLER's (the UI note says so). */
function avCardApplyUrl(hash) {
  const receipt = { ok: false, applied: 0, skipped: [], macros: 0, error: null };
  try {
    let frag = null;
    if (typeof hash === "string" && hash) frag = avCardFragmentEnc(hash);
    if (frag === null) {
      const h = avCardLocationHash();
      if (h) frag = avCardFragmentEnc(h);
    }
    if (!frag) { receipt.error = "no #avp= fragment"; return receipt; }
    const d = avCardDecode(frag);
    if (!d.ok || !d.patch) { receipt.error = d.error || "bad payload"; return receipt; }
    const patch = d.patch;
    const funnel = avCardFunnel();
    /* (1) kind first */
    if (patch.k) {
      let rv = false;
      if (funnel) { try { rv = funnel("engine.kind", patch.k, { from: "card" }); } catch (e) { rv = false; } }
      if (funnel && rv !== false) receipt.applied += 1;
      else receipt.skipped.push("engine.kind");
    }
    /* (2) params in sorted order (decode's sanitised, sorted keys) */
    let paths = [];
    try { paths = Object.keys(patch.p); } catch (e) { paths = []; }
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      if (!funnel) { receipt.skipped.push(path); continue; }
      let v = patch.p[path];
      if (typeof v === "boolean") v = v ? 1 : 0;      /* av_session's value law */
      let rv = false;
      try { rv = funnel(path, v, { from: "card" }); } catch (e) { rv = false; }
      if (rv !== false) receipt.applied += 1;
      else receipt.skipped.push(path);
    }
    /* (3) macros — exactly the way av_session's mod rows commit */
    for (let i = 0; i < AV_CARD_MACRO_COUNT; i++) {
      const path = "mod.macro" + (i + 1);
      const v = patch.m[i];
      if (funnel) {
        let rv = false;
        try { rv = funnel(path, v, { from: "card" }); } catch (e) { rv = false; }
        let accepted = rv !== false;
        /* av_mod's wrap owns exactly mod.macro1..8: when the funnel we called IS that wrap, the
           macro landed model-side even if the passthrough's engine leg said false */
        if (!accepted && AV_CARD_MACRO_RE.test(path) && funnel.__avModWrap === true) accepted = true;
        if (accepted) { receipt.applied += 1; receipt.macros += 1; }
        else receipt.skipped.push(path);
      } else {
        /* degraded belt: no funnel anywhere — the module's own setter */
        let ok = false;
        try { if (typeof avModMacroSet === "function") ok = avModMacroSet(i, v) !== false; } catch (e) { ok = false; }
        if (ok) { receipt.applied += 1; receipt.macros += 1; }
        else receipt.skipped.push(path);
      }
    }
    receipt.ok = (receipt.applied > 0) && (receipt.skipped.length === 0);
    avCard.lastApply = { ok: receipt.ok, applied: receipt.applied, skipped: receipt.skipped.length, macros: receipt.macros };
    try {
      if (typeof window !== "undefined" && window) {
        window.__avCardLastApply = {
          ok: receipt.ok, applied: receipt.applied, macros: receipt.macros,
          skipped: receipt.skipped.slice(0, AV_CARD_SKIP_OBS), at: avCardNow(),
        };
      }
    } catch (e) { /* observability is a nicety */ }
    return receipt;
  } catch (e) {
    avCardFail("applyUrl", e);
    receipt.ok = false;
    receipt.error = avCardErrMsg(e);
    return receipt;
  }
}

/* ==========================================================================================
   QR — clean-room byte-mode encoder (EC M, versions 1..15). All math is local: mode indicator,
   character count, data codewords, Reed-Solomon (GF(2^8), poly 0x11D), the EC-M block structure
   per version, block interleaving, matrix placement (finder / separator / timing / alignment /
   format / version information), mask selection among the 8 by the spec penalty rules with a
   deterministic lowest-mask tie-break.
   ========================================================================================== */

/* total codewords per version (1..15) — data + EC */
const AV_CARD_QR_TOTAL_CW = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655];
/* EC codewords PER BLOCK, level M (§2.2 pins M) */
const AV_CARD_QR_EC_CW = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24];
/* block count, level M (short blocks first) */
const AV_CARD_QR_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10];
/* alignment pattern centre coordinates per version (1..15) */
const AV_CARD_QR_ALIGN = [
  null,
  [],
  [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
  [6, 26, 46, 66], [6, 26, 48, 70],
];
/* penalty weights (§8.8.2) */
const AV_CARD_QR_N1 = 3, AV_CARD_QR_N2 = 3, AV_CARD_QR_N3 = 40, AV_CARD_QR_N4 = 10;

/* GF(2^8) tables, primitive polynomial 0x11D (α = 2) */
const AV_CARD_QR_EXP = new Array(512);
const AV_CARD_QR_LOG = new Array(256);
(function avCardQrGfInit() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    AV_CARD_QR_EXP[i] = x;
    AV_CARD_QR_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) AV_CARD_QR_EXP[i] = AV_CARD_QR_EXP[i - 255];
})();

function avCardQrMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return AV_CARD_QR_EXP[AV_CARD_QR_LOG[a] + AV_CARD_QR_LOG[b]];
}

/* Reed-Solomon generator polynomial for `deg` EC codewords: g(x) = ∏ (x + α^i), i = 0..deg-1.
   Returns coefficients highest-degree first (length deg+1, gen[0] === 1). */
function avCardQrRsGen(deg) {
  let gen = [1];
  for (let i = 0; i < deg; i++) {
    const root = AV_CARD_QR_EXP[i];
    const next = new Array(gen.length + 1);
    for (let j = 0; j < next.length; j++) next[j] = 0;
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= avCardQrMul(gen[j], root);
    }
    gen = next;
  }
  return gen;
}

/* the `deg` EC codewords for one block: remainder of data(x)·x^deg mod g(x) (LFSR division) */
function avCardQrRsEc(data, deg) {
  const gen = avCardQrRsGen(deg);
  const rem = new Array(deg);
  for (let i = 0; i < deg; i++) rem[i] = 0;
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    for (let j = 0; j < deg - 1; j++) rem[j] = rem[j + 1];
    rem[deg - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < deg; j++) rem[j] ^= avCardQrMul(gen[j + 1], factor);
    }
  }
  return rem;
}

/* syndromes S_j = c(α^j) for j = 0..ecLen-1 over a codeword (data ++ ec, highest degree first) —
   every one must be zero for a valid RS codeword */
function avCardQrSyndromes(cw, ecLen) {
  const syn = new Array(ecLen);
  for (let j = 0; j < ecLen; j++) {
    const x = AV_CARD_QR_EXP[j];
    let y = 0;
    for (let i = 0; i < cw.length; i++) y = avCardQrMul(y, x) ^ cw[i];
    syn[j] = y;
  }
  return syn;
}

/* data codewords for a version at level M */
function avCardQrDataCw(version) {
  return AV_CARD_QR_TOTAL_CW[version] - AV_CARD_QR_EC_CW[version] * AV_CARD_QR_BLOCKS[version];
}

/* byte capacity of version 15 at level M (the QR-able ceiling; the 500-byte cap is on top) */
const AV_CARD_QR_BYTE_MAX = Math.floor((avCardQrDataCw(15) * 8 - 4 - 16) / 8);

/* bit stream -> data codewords -> blocks {data, ec} -> interleaved final codewords. Returns
   { version, dataCw, ecLen, blocks, finalCw } or null when no version in 1..15 fits. */
function avCardQrCodewords(bytes) {
  let version = 0;
  for (let v = 1; v <= AV_CARD_QR_VER_MAX; v++) {
    const need = 4 + (v <= 9 ? 8 : 16) + bytes.length * 8;
    if (need <= avCardQrDataCw(v) * 8) { version = v; break; }
  }
  if (!version) return null;
  const dataCw = avCardQrDataCw(version);
  const capBits = dataCw * 8;
  const out = [];
  let bitBuf = 0, bitLen = 0, used = 0;
  const push = function (val, n) {
    for (let k = n - 1; k >= 0; k--) {
      bitBuf = ((bitBuf << 1) | ((val >>> k) & 1)) & 0xFFF;
      bitLen += 1;
      if (bitLen === 8) { out.push(bitBuf & 0xFF); bitBuf = 0; bitLen = 0; }
    }
    used += n;
  };
  push(0b0100, 4);                                          /* byte mode indicator */
  push(bytes.length, version <= 9 ? 8 : 16);                /* character count */
  for (let i = 0; i < bytes.length; i++) push(bytes[i], 8);
  const term = Math.min(4, capBits - used);                 /* terminator */
  if (term > 0) push(0, term);
  if (bitLen > 0) push(0, 8 - bitLen);                      /* pad to a byte boundary */
  const padCw = [0xEC, 0x11];
  let pi = 0;
  while (out.length < dataCw) { push(padCw[pi & 1], 8); pi += 1; }
  /* EC-M block split, short blocks first */
  const n = AV_CARD_QR_BLOCKS[version];
  const ecLen = AV_CARD_QR_EC_CW[version];
  const shortLen = Math.floor(dataCw / n);
  const longCount = dataCw % n;
  const blocks = [];
  let pos = 0;
  for (let b = 0; b < n; b++) {
    const len = shortLen + ((b >= n - longCount) ? 1 : 0);
    const data = out.slice(pos, pos + len);
    pos += len;
    blocks.push({ data: data, ec: avCardQrRsEc(data, ecLen) });
  }
  /* interleave: data column-wise, then EC column-wise */
  const finalCw = [];
  const maxLen = shortLen + (longCount > 0 ? 1 : 0);
  for (let i = 0; i < maxLen; i++) for (let b = 0; b < n; b++) if (i < blocks[b].data.length) finalCw.push(blocks[b].data[i]);
  for (let i = 0; i < ecLen; i++) for (let b = 0; b < n; b++) finalCw.push(blocks[b].ec[i]);
  return { version: version, dataCw: dataCw, ecLen: ecLen, blocks: blocks, finalCw: finalCw };
}

/* format information: 2-bit EC indicator (M = 00) + 3-bit mask, BCH(15,5) with generator 0x537,
   XOR 0x5412. Written (via the passed setter) to BOTH copies + the always-dark module.
   setAt(x, y, dark) — x = column, y = row. Returns the 15-bit value. */
function avCardQrFormatBits(size, mask, setAt) {
  const data = ((0 /* M */) << 3) | (mask & 7);
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = (((data << 10) | rem) ^ 0x5412) & 0x7FFF;
  for (let i = 0; i <= 5; i++) setAt(8, i, (bits >>> i) & 1);
  setAt(8, 7, (bits >>> 6) & 1);
  setAt(8, 8, (bits >>> 7) & 1);
  setAt(7, 8, (bits >>> 8) & 1);
  for (let i = 9; i <= 14; i++) setAt(14 - i, 8, (bits >>> i) & 1);
  for (let i = 0; i <= 7; i++) setAt(size - 1 - i, 8, (bits >>> i) & 1);
  for (let i = 8; i <= 14; i++) setAt(8, size - 15 + i, (bits >>> i) & 1);
  setAt(8, size - 8, 1);                                   /* the dark module */
  return bits;
}

/* read the format value back from a matrix (both copies) — used by the self-check */
function avCardQrReadFormat(mod, size) {
  const rd = function (x, y) { return mod[y * size + x] ? 1 : 0; };
  let v1 = 0, v2 = 0;
  for (let i = 0; i <= 5; i++) v1 |= rd(8, i) << i;
  v1 |= rd(8, 7) << 6;
  v1 |= rd(8, 8) << 7;
  v1 |= rd(7, 8) << 8;
  for (let i = 9; i <= 14; i++) v1 |= rd(14 - i, 8) << i;
  for (let i = 0; i <= 7; i++) v2 |= rd(size - 1 - i, 8) << i;
  for (let i = 8; i <= 14; i++) v2 |= rd(8, size - 15 + i) << i;
  const clean = v1 ^ 0x5412;
  let rem = clean;
  for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= (0x537 << (i - 10)) & 0x7FFF;
  rem &= 0x3FF;
  const data5 = (clean >>> 10) & 0x1F;
  return {
    value: v1, value2: v2,
    ok: (rem === 0) && (((data5 >>> 3) & 3) === 0 /* level M */) && (v1 === v2),
    mask: data5 & 7,
  };
}

/* the mask predicates (x = column, y = row) */
function avCardQrMaskBit(mask, x, y) {
  switch (mask) {
    case 0: return ((x + y) & 1) === 0;
    case 1: return (y & 1) === 0;
    case 2: return (x % 3) === 0;
    case 3: return ((x + y) % 3) === 0;
    case 4: return (((y >> 1) + Math.floor(x / 3)) & 1) === 0;
    case 5: return (((x * y) % 2) + ((x * y) % 3)) === 0;
    case 6: return ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0;
    default: return ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0;
  }
}

/* function-pattern grid for a version: finder + separators, timing, alignment, format
   reservation (mask 0 — overwritten per mask later) and version information. Data modules stay 0
   with fn = 0. Returns { size, mod, fn }. */
function avCardQrGrid(version) {
  const size = 17 + 4 * version;
  const mod = new Array(size * size);
  const fn = new Array(size * size);
  for (let i = 0; i < mod.length; i++) { mod[i] = 0; fn[i] = 0; }
  const setFn = function (x, y, dark) { const k = y * size + x; mod[k] = dark ? 1 : 0; fn[k] = 1; };
  /* timing first (finders override the intersections, spec-correct) */
  for (let i = 0; i < size; i++) {
    setFn(6, i, (i % 2 === 0) ? 1 : 0);
    setFn(i, 6, (i % 2 === 0) ? 1 : 0);
  }
  /* finder patterns (7x7) with separators — dist 2 and 4 stay light */
  const finder = function (x, y) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || xx >= size || yy < 0 || yy >= size) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setFn(xx, yy, (dist !== 2 && dist !== 4) ? 1 : 0);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  /* alignment patterns (5x5) — skip the three that would overlap finders */
  const pos = AV_CARD_QR_ALIGN[version] || [];
  const pn = pos.length;
  for (let i = 0; i < pn; i++) for (let j = 0; j < pn; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === pn - 1) || (i === pn - 1 && j === 0)) continue;
    const cx = pos[j], cy = pos[i];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setFn(cx + dx, cy + dy, (dist !== 1) ? 1 : 0);
    }
  }
  /* format reservation (mask 0 placeholder) + dark module */
  avCardQrFormatBits(size, 0, setFn);
  /* version information (v >= 7): 6-bit version + 12-bit BCH (0x1F25), two 3x6 blocks */
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const vbits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = (vbits >>> i) & 1;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      setFn(a, b, bit);
      setFn(b, a, bit);
    }
  }
  return { size: size, mod: mod, fn: fn, setFn: setFn };
}

/* place the final codewords (zigzag, bottom-right upward) on a fresh grid */
function avCardQrPlace(grid, finalCw) {
  const size = grid.size, mod = grid.mod, fn = grid.fn;
  const totalBits = finalCw.length * 8;
  let idx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? (size - 1 - vert) : vert;
        const k = y * size + x;
        if (!fn[k] && idx < totalBits) {
          mod[k] = (finalCw[idx >> 3] >> (7 - (idx & 7))) & 1;
          idx += 1;
        }
      }
    }
  }
}

/* read the codeword stream back out of a matrix (reverse placement + unmask) */
function avCardQrReadStream(mod, fn, size, mask) {
  const cw = [];
  let acc = 0, accLen = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? (size - 1 - vert) : vert;
        const k = y * size + x;
        if (!fn[k]) {
          let bit = mod[k] ? 1 : 0;
          if (avCardQrMaskBit(mask, x, y)) bit ^= 1;
          acc = (acc << 1) | bit;
          accLen += 1;
          if (accLen === 8) { cw.push(acc & 0xFF); acc = 0; accLen = 0; }
        }
      }
    }
  }
  return cw;
}

/* de-interleave a final codeword stream back into per-block codewords (data ++ ec) */
function avCardQrDeinterleave(cw, version) {
  const n = AV_CARD_QR_BLOCKS[version];
  const ecLen = AV_CARD_QR_EC_CW[version];
  const dataCw = avCardQrDataCw(version);
  const shortLen = Math.floor(dataCw / n);
  const longCount = dataCw % n;
  const lens = [];
  for (let b = 0; b < n; b++) lens.push(shortLen + ((b >= n - longCount) ? 1 : 0));
  const blocks = [];
  for (let b = 0; b < n; b++) blocks.push([]);
  let p = 0;
  const maxLen = shortLen + (longCount > 0 ? 1 : 0);
  for (let i = 0; i < maxLen; i++) for (let b = 0; b < n; b++) if (i < lens[b]) blocks[b].push(cw[p++]);
  for (let i = 0; i < ecLen; i++) for (let b = 0; b < n; b++) blocks[b].push(cw[p++]);
  return blocks;
}

/* ---------- penalty rules (§8.8.2) ---------- */

/* N1: runs of >= 5 same-colour modules score 3 + (runLen - 5), per row and per column */
function avCardQrRunPenalty(get, size) {
  let score = 0;
  let runColor = 0, runLen = 0;
  for (let i = 0; i < size; i++) {
    const c = get(i);
    if (c === runColor) {
      runLen += 1;
      if (runLen === 5) score += AV_CARD_QR_N1;
      else if (runLen > 5) score += 1;
    } else {
      runColor = c;
      runLen = 1;
    }
  }
  return score;
}

/* N3: the spec's two literal 11-module patterns — 10111010000 (0x5D0) and 00001011101 (0x05D)
   — counted per occurrence, per row and per column, as they appear IN the symbol (the plain
   window reading the deployed generators use; no out-of-symbol quiet-zone extrapolation) */
function avCardQrFinderLikeCount(mod, size) {
  let count = 0;
  for (let row = 0; row < size; row++) {
    let bitsRow = 0, bitsCol = 0;
    for (let col = 0; col < size; col++) {
      bitsRow = ((bitsRow << 1) & 0x7FF) | mod[row * size + col];
      if (col >= 10 && (bitsRow === 0x5D0 || bitsRow === 0x05D)) count += 1;
      bitsCol = ((bitsCol << 1) & 0x7FF) | mod[col * size + row];
      if (col >= 10 && (bitsCol === 0x5D0 || bitsCol === 0x05D)) count += 1;
    }
  }
  return count;
}

/* full-symbol penalty: N1 runs (rows + columns) + N2 2x2 blocks + N3 finder-like patterns +
   N4 dark/light balance, deviation from 50% in steps of 5% (the integer part) */
function avCardQrPenalty(mod, size) {
  let score = 0;
  for (let y = 0; y < size; y++) {
    const row = y * size;
    score += avCardQrRunPenalty(function (x) { return mod[row + x]; }, size);
  }
  for (let x = 0; x < size; x++) {
    score += avCardQrRunPenalty(function (y) { return mod[y * size + x]; }, size);
  }
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = mod[y * size + x];
    if (c === mod[y * size + x + 1] && c === mod[(y + 1) * size + x] && c === mod[(y + 1) * size + x + 1]) score += AV_CARD_QR_N2;
  }
  score += avCardQrFinderLikeCount(mod, size) * AV_CARD_QR_N3;
  let dark = 0;
  for (let i = 0; i < mod.length; i++) dark += mod[i];
  const total = size * size;
  const dev = Math.abs(dark * 20 - total * 10) / total;    /* deviation in steps of 5% */
  score += Math.floor(dev) * AV_CARD_QR_N4;
  return score;
}

/* ---------- the encoder proper ---------- */

/* full pipeline for a byte array: returns null when nothing fits, else the best matrix */
function avCardQrEncodeBytes(bytes) {
  const cw = avCardQrCodewords(bytes);
  if (!cw) return null;
  const grid = avCardQrGrid(cw.version);
  avCardQrPlace(grid, cw.finalCw);
  const size = grid.size;
  let bestMod = null, bestMask = 0, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const t = grid.mod.slice();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const k = y * size + x;
      if (!grid.fn[k] && avCardQrMaskBit(mask, x, y)) t[k] ^= 1;
    }
    avCardQrFormatBits(size, mask, function (x, y, dark) { t[y * size + x] = dark ? 1 : 0; });
    const score = avCardQrPenalty(t, size);
    if (score < bestScore) { bestScore = score; bestMask = mask; bestMod = t; }   /* ties -> lowest mask */
  }
  return { version: cw.version, size: size, mask: bestMask, penalty: bestScore, mod: bestMod, finalCw: cw.finalCw };
}

function avCardQrRows(mod, size) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    let s = "";
    for (let x = 0; x < size; x++) s += mod[y * size + x] ? "1" : "0";
    rows.push(s);
  }
  return rows;
}

function avCardQrRowsToMod(rows, size) {
  const mod = new Array(size * size);
  for (let y = 0; y < size; y++) {
    const r = rows[y];
    for (let x = 0; x < size; x++) mod[y * size + x] = (r.charAt(x) === "1") ? 1 : 0;
  }
  return mod;
}

/* avCardQr(text) -> { ok, error?, version, ec, size, mask, matrix }  (§2.2) */
function avCardQr(text) {
  try {
    const s = (typeof text === "string") ? text : String(text == null ? "" : text);
    const bytes = avCardUtf8(s);
    if (bytes.length > AV_CARD_QR_TEXT_CAP) {
      avCard.lastQr = { ok: false, version: 0, size: 0, mask: -1, penalty: -1 };
      return { ok: false, error: "text exceeds " + AV_CARD_QR_TEXT_CAP + " bytes", version: 0, ec: AV_CARD_QR_EC, size: 0, mask: -1, bytes: bytes.length, matrix: [] };
    }
    const enc = avCardQrEncodeBytes(bytes);
    if (!enc) {
      avCard.lastQr = { ok: false, version: 0, size: 0, mask: -1, penalty: -1 };
      return { ok: false, error: "text exceeds the version-15 (M) byte capacity (" + AV_CARD_QR_BYTE_MAX + " bytes)", version: 0, ec: AV_CARD_QR_EC, size: 0, mask: -1, bytes: bytes.length, matrix: [] };
    }
    const matrix = avCardQrRows(enc.mod, enc.size);
    avCard.lastQr = { ok: true, version: enc.version, size: enc.size, mask: enc.mask, penalty: enc.penalty };
    return { ok: true, error: null, version: enc.version, ec: AV_CARD_QR_EC, size: enc.size, mask: enc.mask, penalty: enc.penalty, bytes: bytes.length, matrix: matrix };
  } catch (e) {
    avCardFail("qr", e);
    avCard.lastQr = { ok: false, version: 0, size: 0, mask: -1, penalty: -1 };
    return { ok: false, error: avCardErrMsg(e), version: 0, ec: AV_CARD_QR_EC, size: 0, mask: -1, bytes: 0, matrix: [] };
  }
}

/* avCardQrSelfCheck(text) -> { ok, version, ec, size, mask, syndromesZero, formatOk, error? }
   Proves the encoder from the produced MATRIX: format-info bits round-trip (both copies, BCH
   remainder zero, level M and the recorded mask) + Reed-Solomon syndromes recomputed over the
   codewords re-extracted from the matrix (unmask -> placement walk -> de-interleave) all zero. */
function avCardQrSelfCheck(text) {
  const receipt = { ok: false, version: 0, ec: AV_CARD_QR_EC, size: 0, mask: -1, syndromesZero: false, formatOk: false, error: null };
  try {
    const q = avCardQr(text);
    if (!q.ok) { receipt.error = q.error; return receipt; }
    receipt.version = q.version;
    receipt.size = q.size;
    receipt.mask = q.mask;
    const mod = avCardQrRowsToMod(q.matrix, q.size);
    const fmt = avCardQrReadFormat(mod, q.size);
    receipt.formatOk = (fmt.ok === true) && (fmt.mask === q.mask);
    const grid = avCardQrGrid(q.version);
    const cw = avCardQrReadStream(mod, grid.fn, q.size, fmt.mask);
    const blocks = avCardQrDeinterleave(cw, q.version);
    const ecLen = AV_CARD_QR_EC_CW[q.version];
    let zero = true;
    for (let b = 0; b < blocks.length; b++) {
      const syn = avCardQrSyndromes(blocks[b], ecLen);
      for (let j = 0; j < syn.length; j++) if (syn[j] !== 0) zero = false;
    }
    receipt.syndromesZero = zero;
    receipt.ok = (receipt.formatOk === true) && (zero === true);
    return receipt;
  } catch (e) {
    avCardFail("qrSelfCheck", e);
    receipt.error = avCardErrMsg(e);
    return receipt;
  }
}

/* ==========================================================================================
   PNG card — deterministic drawing from the payload (dark graphite + teal), the QR when the
   URL text fits, then canvas.toBlob('image/png') wrapped in a promise.
   ========================================================================================== */

function avCardCanvas() {
  try {
    const doc = avCardDocument();
    if (doc && typeof doc.createElement === "function") {
      const c = doc.createElement("canvas");
      if (c && typeof c.getContext === "function") {
        c.width = AV_CARD_PNG_W;
        c.height = AV_CARD_PNG_H;
        return c;
      }
    }
  } catch (e) { /* no DOM */ }
  try {
    if (typeof OffscreenCanvas === "function") {
      const c = new OffscreenCanvas(AV_CARD_PNG_W, AV_CARD_PNG_H);
      if (c && typeof c.getContext === "function") return c;
    }
  } catch (e) { /* none */ }
  return null;
}

function avCardToBlob(canvas) {
  return new Promise(function (res) {
    try {
      if (canvas && typeof canvas.toBlob === "function") {
        canvas.toBlob(function (b) { res(b || null); }, "image/png");
        return;
      }
    } catch (e) { /* fall through */ }
    try {
      if (canvas && typeof canvas.convertToBlob === "function") {
        const p = canvas.convertToBlob({ type: "image/png" });
        if (p && typeof p.then === "function") {
          p.then(function (b) { res(b || null); }).catch(function () { res(null); });
          return;
        }
      }
    } catch (e) { /* none */ }
    res(null);
  });
}

function avCardBlobSize(blob) {
  try { return (blob && typeof blob.size === "number" && isFinite(blob.size)) ? blob.size : 0; } catch (e) { return 0; }
}

/* the drawing — pure function of (patch, url, qr) into a 2d context */
function avCardDraw(ctx, patch, url, qr) {
  const W = AV_CARD_PNG_W;
  const C = AV_CARD_COL;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, W);
  ctx.fillStyle = C.panel;
  ctx.fillRect(48, 48, 984, 984);
  ctx.strokeStyle = C.hair;
  ctx.lineWidth = 2;
  ctx.strokeRect(48, 48, 984, 984);
  ctx.fillStyle = C.teal;
  ctx.fillRect(48, 48, 984, 6);
  /* wordmark */
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.teal;
  ctx.font = "700 56px \"IBM Plex Mono\", ui-monospace, monospace";
  ctx.fillText("ANVIL", 96, 168);
  ctx.fillStyle = C.text2;
  ctx.font = "400 26px \"IBM Plex Sans\", system-ui, sans-serif";
  ctx.fillText("— a MODDYS Foundry instrument", 96, 208);
  /* patch identity */
  ctx.fillStyle = C.text;
  ctx.font = "700 52px \"IBM Plex Mono\", ui-monospace, monospace";
  ctx.fillText(avCardClip(patch.n || "untitled patch", 28), 96, 320);
  ctx.fillStyle = C.tealGlow;
  ctx.font = "400 26px \"IBM Plex Mono\", ui-monospace, monospace";
  ctx.fillText(avCardClip(patch.k ? ("engine · " + patch.k) : "engine · (unset)", 34), 96, 364);
  /* up to 8 parameter lines (sorted; decode/build guarantee the order) */
  let paths = [];
  try { paths = Object.keys(patch.p); } catch (e) { paths = []; }
  ctx.font = "400 23px \"IBM Plex Mono\", ui-monospace, monospace";
  if (paths.length === 0) {
    ctx.fillStyle = C.text3;
    ctx.fillText("— no parameters —", 96, 430);
  } else {
    ctx.fillStyle = C.text2;
    const n = Math.min(paths.length, AV_CARD_CARD_PARAMS);
    for (let i = 0; i < n; i++) {
      const path = paths[i];
      ctx.fillText(avCardClip(avCardPad(path, 24) + " " + avCardValText(patch.p[path]), 44), 96, 430 + i * 40);
    }
  }
  /* the QR (when it fits) or the honest note */
  const qx = 560, qy = 420, qmax = 440;
  if (qr && qr.matrix && qr.matrix.length === qr.size && qr.size > 0) {
    const modulePx = Math.max(2, Math.floor(qmax / (qr.size + 8)));
    const box = modulePx * (qr.size + 8);
    const x0 = qx + Math.floor((qmax - box) / 2);
    const y0 = qy + Math.floor((qmax - box) / 2);
    ctx.fillStyle = C.white;
    ctx.fillRect(x0, y0, box, box);
    ctx.fillStyle = C.bg;
    const off = 4 * modulePx;
    for (let r = 0; r < qr.size; r++) {
      const row = qr.matrix[r];
      for (let c = 0; c < qr.size; c++) {
        if (row.charAt(c) === "1") ctx.fillRect(x0 + off + c * modulePx, y0 + off + r * modulePx, modulePx, modulePx);
      }
    }
  } else {
    ctx.fillStyle = C.text2;
    ctx.font = "400 30px \"IBM Plex Sans\", system-ui, sans-serif";
    ctx.fillText("link too long for QR", 620, 620);
    ctx.fillStyle = C.text3;
    ctx.font = "400 22px \"IBM Plex Sans\", system-ui, sans-serif";
    ctx.fillText("open the URL below to load this patch", 578, 660);
  }
  /* url + footer */
  ctx.fillStyle = C.text3;
  ctx.font = "400 20px \"IBM Plex Mono\", ui-monospace, monospace";
  ctx.fillText(avCardClip(url || "(no link)", 86), 96, 916);
  ctx.fillStyle = C.teal;
  ctx.font = "400 24px \"IBM Plex Mono\", ui-monospace, monospace";
  ctx.fillText("free · local-first · moddys.net", 96, 984);
}

/* avCardPng(patch, url?) -> Promise<{ ok, error?, blob, bytes, w, h }> */
function avCardPng(patch, url) {
  return new Promise(function (res) {
    try {
      const built = avCardBuild(patch);
      const p = built.patch;
      let u = (typeof url === "string" && url) ? url : null;
      if (u === null) {
        const r = avCardUrl(p);
        u = r.ok ? r.url : null;
      }
      const qr = u ? avCardQr(u) : { ok: false };
      const canvas = avCardCanvas();
      if (!canvas) {
        avCard.lastPng = { ok: false, bytes: 0 };
        res({ ok: false, error: "no canvas (DOM unavailable)", blob: null, bytes: 0, w: 0, h: 0, url: u || "", qr: false });
        return;
      }
      let ctx = null;
      try { ctx = canvas.getContext("2d"); } catch (e) { ctx = null; }
      if (!ctx) {
        avCard.lastPng = { ok: false, bytes: 0 };
        res({ ok: false, error: "no 2d context", blob: null, bytes: 0, w: 0, h: 0, url: u || "", qr: false });
        return;
      }
      avCardDraw(ctx, p, u, qr.ok ? qr : null);
      avCardToBlob(canvas).then(function (blob) {
        const bytes = avCardBlobSize(blob);
        if (!blob || bytes <= 0) {
          avCard.lastPng = { ok: false, bytes: 0 };
          res({ ok: false, error: "toBlob produced nothing", blob: null, bytes: 0, w: AV_CARD_PNG_W, h: AV_CARD_PNG_H, url: u || "", qr: qr.ok === true });
          return;
        }
        avCard.lastPng = { ok: true, bytes: bytes };
        try {
          if (typeof window !== "undefined" && window) window.__avCardLastPng = { bytes: bytes, at: avCardNow() };
        } catch (e) { /* observability is a nicety */ }
        res({ ok: true, error: null, blob: blob, bytes: bytes, w: AV_CARD_PNG_W, h: AV_CARD_PNG_H, url: u || "", enc: qr.ok ? "" : "", qr: qr.ok === true });
      });
    } catch (e) {
      avCardFail("png", e);
      avCard.lastPng = { ok: false, bytes: 0 };
      res({ ok: false, error: avCardErrMsg(e), blob: null, bytes: 0, w: 0, h: 0, url: "", qr: false });
    }
  });
}

/* ---------- share + copy (every browser reach guarded per call; AbortError = calm cancel) ---------- */

function avCardRecordLast(enc, url, pngBytes, via) {
  try {
    if (typeof window !== "undefined" && window) {
      window.__avCardLast = { enc: enc || "", url: url || "", pngBytes: pngBytes || 0, via: via || "none", at: avCardNow() };
    }
  } catch (e) { /* observability is a nicety */ }
}

/* own anchor download (the honest fallback when avDeliverDownload is absent) */
function avCardAnchor(blob, name) {
  try {
    const doc = avCardDocument();
    if (!doc || typeof doc.createElement !== "function") return false;
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof Blob === "undefined") return false;
    const url = URL.createObjectURL(blob);
    const a = doc.createElement("a");
    a.href = url;
    a.download = name;
    try { a.rel = "noopener"; } catch (e) { /* attribute refused */ }
    const body = doc.body;
    let attached = false;
    if (body && typeof body.appendChild === "function") { try { body.appendChild(a); attached = true; } catch (e) { attached = false; } }
    try { a.click(); } catch (e) { /* a click never throws outward here */ }
    if (attached && body && typeof body.removeChild === "function") { try { body.removeChild(a); } catch (e) { /* ok */ } }
    try { if (typeof setTimeout === "function") setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { /* ok */ } }, 8000); } catch (e) { /* ok */ }
    return true;
  } catch (e) { return false; }
}

/* avCardShare(opts?) -> Promise<receipt { ok, error?, enc, url, pngBytes, via, warnings[] }>
   build + encode + png -> navigator.share({files:[png]}) when navigator.canShare agrees
   (guarded; user-cancel = calm ok:false) else avDeliverDownload / anchor. §2.2 */
function avCardShare(opts) {
  return new Promise(function (res) {
    const warnings = [];
    const receipt = { ok: false, error: null, enc: "", url: "", pngBytes: 0, via: "none", warnings: warnings };
    try {
      const o = avCardObj(opts) ? opts : {};
      const built = avCardBuild(avCardFirst(o.patch, o));
      const patch = built.patch;
      const encR = avCardEncode(patch);
      if (!encR.ok) {
        receipt.error = encR.error || "encode failed";
        avCard.lastShare = { ok: false, via: "none", pngBytes: 0 };
        avCardRecordLast("", "", 0, "none");
        res(receipt);
        return;
      }
      receipt.enc = encR.enc;
      const urlR = avCardUrl(patch, (typeof o.url === "string") ? o.url : undefined);
      receipt.url = urlR.ok ? urlR.url : "";
      const name = avCardText(o.name, AV_CARD_NAME_CAP, patch.n || "");
      const fname = "anvil-card-" + avCardSlug(name) + ".png";
      avCardPng(patch, receipt.url || undefined).then(function (png) {
        try {
          if (!png.ok || !png.blob) {
            receipt.error = png.error || "png failed";
            avCard.lastShare = { ok: false, via: "none", pngBytes: 0 };
            avCardRecordLast(receipt.enc, receipt.url, 0, "none");
            res(receipt);
            return;
          }
          receipt.pngBytes = png.bytes;
          const nav = avCardNav();
          const canShareFiles = (function () {
            try {
              if (!nav || typeof nav.canShare !== "function" || typeof nav.share !== "function") return false;
              if (typeof File !== "function") return false;
              const file = new File([png.blob], fname, { type: "image/png" });
              return nav.canShare({ files: [file] }) === true;
            } catch (e) { return false; }
          })();
          if (canShareFiles) {
            let file = null;
            try { file = new File([png.blob], fname, { type: "image/png" }); } catch (e) { file = null; }
            if (file) {
              let p = null;
              try { p = nav.share({ files: [file], title: "ANVIL — " + (patch.n || "untitled patch") }); } catch (e) { p = Promise.reject(e); }
              Promise.resolve(p).then(function () {
                receipt.ok = true;
                receipt.via = "share";
                avCard.lastShare = { ok: true, via: "share", pngBytes: receipt.pngBytes };
                avCardRecordLast(receipt.enc, receipt.url, receipt.pngBytes, "share");
                res(receipt);
              }).catch(function (err) {
                const nm = String((err && err.name) || "");
                if (nm === "AbortError") {
                  /* the user cancelled the share sheet — calm, honest, no fallback */
                  receipt.ok = false;
                  receipt.error = "cancelled";
                  receipt.via = "share";
                  avCard.lastShare = { ok: false, via: "share", pngBytes: receipt.pngBytes };
                  avCardRecordLast(receipt.enc, receipt.url, receipt.pngBytes, "share");
                  res(receipt);
                  return;
                }
                warnings.push("share failed (" + (nm || "error") + ") — downloaded instead");
                avCardDownloadShare(receipt, png.blob, fname, warnings);
                res(receipt);
              });
              return;
            }
          }
          avCardDownloadShare(receipt, png.blob, fname, warnings);
          res(receipt);
        } catch (e) {
          receipt.error = avCardErrMsg(e);
          avCard.lastShare = { ok: false, via: "none", pngBytes: receipt.pngBytes };
          avCardRecordLast(receipt.enc, receipt.url, receipt.pngBytes, "none");
          res(receipt);
        }
      });
    } catch (e) {
      avCardFail("share", e);
      receipt.error = avCardErrMsg(e);
      avCard.lastShare = { ok: false, via: "none", pngBytes: 0 };
      avCardRecordLast("", "", 0, "none");
      res(receipt);
    }
  });
}

/* the download leg shared by share's fallbacks: avDeliverDownload when callable, own anchor else */
function avCardDownloadShare(receipt, blob, fname, warnings) {
  try {
    const deliver = avCardDeliver();
    let ok = false;
    if (deliver) {
      try { ok = deliver(blob, fname) === true; } catch (e) { ok = false; }
    }
    if (!ok) {
      try { ok = avCardAnchor(blob, fname); } catch (e) { ok = false; }
      if (ok) warnings.push("used the local anchor fallback");
    }
    if (ok) {
      receipt.ok = true;
      receipt.via = "download";
      avCard.lastShare = { ok: true, via: "download", pngBytes: receipt.pngBytes };
      avCardRecordLast(receipt.enc, receipt.url, receipt.pngBytes, "download");
    } else {
      receipt.ok = false;
      receipt.error = receipt.error || "no share or download path available";
      receipt.via = "none";
      avCard.lastShare = { ok: false, via: "none", pngBytes: receipt.pngBytes };
      avCardRecordLast(receipt.enc, receipt.url, receipt.pngBytes, "none");
    }
    receipt.warnings = warnings.slice(0, AV_CARD_NOTE_CAP);
  } catch (e) {
    receipt.ok = false;
    receipt.error = avCardErrMsg(e);
    receipt.via = "none";
  }
}

/* clipboard fallback: the legacy execCommand path, guarded */
function avCardCopyExec(url, done) {
  try {
    const doc = avCardDocument();
    if (doc && typeof doc.createElement === "function" && typeof doc.execCommand === "function") {
      const ta = doc.createElement("textarea");
      ta.value = url;
      try { ta.setAttribute("readonly", ""); } catch (e) { /* ok */ }
      try { if (ta.style) { ta.style.position = "fixed"; ta.style.opacity = "0"; } } catch (e) { /* ok */ }
      const body = doc.body;
      let attached = false;
      if (body && typeof body.appendChild === "function") { try { body.appendChild(ta); attached = true; } catch (e) { attached = false; } }
      try { if (typeof ta.select === "function") ta.select(); } catch (e) { /* ok */ }
      let ok = false;
      try { ok = doc.execCommand("copy") === true; } catch (e) { ok = false; }
      if (attached && body && typeof body.removeChild === "function") { try { body.removeChild(ta); } catch (e) { /* ok */ } }
      if (ok) { done("exec"); return; }
    }
  } catch (e) { /* fall through */ }
  done("none");
}

/* avCardCopyLink(patch?) -> Promise<{ ok, url, via }> — clipboard API guarded; honest fallback */
function avCardCopyLink(patch) {
  return new Promise(function (res) {
    try {
      const built = avCardBuild(patch);
      const r = avCardUrl(built.patch);
      if (!r.ok) {
        avCard.lastCopy = { ok: false, via: "none" };
        res({ ok: false, url: "", via: "none", error: r.error || "encode failed" });
        return;
      }
      const url = r.url;
      const done = function (via) {
        const ok = (via !== "none");
        avCard.lastCopy = { ok: ok, via: via };
        try {
          if (typeof window !== "undefined" && window) window.__avCardLastCopy = { url: url, via: via, ok: ok, at: avCardNow() };
        } catch (e) { /* nicety */ }
        res({ ok: ok, url: url, via: via, error: ok ? null : "clipboard unavailable — copy from the URL text" });
      };
      const finish = function (via) { done(via); };
      const nav = avCardNav();
      const clip = (nav && nav.clipboard) ? nav.clipboard : null;
      if (clip && typeof clip.writeText === "function") {
        try {
          const p = clip.writeText(url);
          if (p && typeof p.then === "function") {
            p.then(function () { finish("clipboard"); }).catch(function () { avCardCopyExec(url, finish); });
            return;
          }
          finish("clipboard");
          return;
        } catch (e) { /* fall through to the legacy path */ }
      }
      avCardCopyExec(url, finish);
    } catch (e) {
      avCardFail("copy", e);
      avCard.lastCopy = { ok: false, via: "none" };
      res({ ok: false, url: "", via: "none", error: avCardErrMsg(e) });
    }
  });
}

/* ---------- init / classes / state ---------- */

function avCardInit() {
  try {
    if (avCard.inited === true) return true;
    avCard.inited = true;
    avCard.mounts += 1;
    return true;
  } catch (e) {
    avCardFail("init", e);
    return false;
  }
}

function avCardClasses() {
  return AV_CARD_CLASSES.slice();   /* this module mounts nothing — the UI card owns markup */
}

function avCardState() {
  try {
    return {
      version: AV_CARD_VERSION,
      init: avCard.inited === true,
      inited: avCard.inited === true,
      mounts: avCard.mounts,
      lastEncode: avCard.lastEncode ? { ok: !!avCard.lastEncode.ok, chars: avCard.lastEncode.chars, bytes: avCard.lastEncode.bytes } : null,
      lastApply: avCard.lastApply ? { ok: !!avCard.lastApply.ok, applied: avCard.lastApply.applied, skipped: avCard.lastApply.skipped, macros: avCard.lastApply.macros } : null,
      lastQr: avCard.lastQr ? { ok: !!avCard.lastQr.ok, version: avCard.lastQr.version, size: avCard.lastQr.size, mask: avCard.lastQr.mask } : null,
      lastPng: avCard.lastPng ? { ok: !!avCard.lastPng.ok, bytes: avCard.lastPng.bytes } : null,
      lastShare: avCard.lastShare ? { ok: !!avCard.lastShare.ok, via: avCard.lastShare.via, pngBytes: avCard.lastShare.pngBytes } : null,
      lastCopy: avCard.lastCopy ? { ok: !!avCard.lastCopy.ok, via: avCard.lastCopy.via } : null,
      notes: avCard.notes.slice(),
      modules: {
        params: !!avCardParamsMirror(),
        mod: (function () { try { return typeof avModPayload === "function"; } catch (e) { return false; } })(),
        funnel: !!avCardFunnel(),
        setter: (function () { try { return typeof avModMacroSet === "function"; } catch (e) { return false; } })(),
        deliver: !!avCardDeliver(),
        session: (function () { try { return typeof avSessionState === "function"; } catch (e) { return false; } })(),
        canvas: !!avCardCanvasReach(),
        share: (function () { try { const nav = avCardNav(); return !!(nav && typeof nav.share === "function" && typeof nav.canShare === "function"); } catch (e) { return false; } })(),
        clipboard: (function () { try { const nav = avCardNav(); return !!(nav && nav.clipboard && typeof nav.clipboard.writeText === "function"); } catch (e) { return false; } })(),
      },
      lastError: avCard.lastError,
    };
  } catch (e) {
    return { version: AV_CARD_VERSION, init: false, inited: false, mounts: 0, lastEncode: null, lastApply: null, lastQr: null, lastPng: null, lastShare: null, lastCopy: null, notes: [], modules: {}, lastError: "state" };
  }
}

/* a purely observational canvas-reach probe (no canvas is created) */
function avCardCanvasReach() {
  try { if (avCardDocument() && typeof avCardDocument().createElement === "function") return true; } catch (e) { /* none */ }
  try { return typeof OffscreenCanvas === "function"; } catch (e) { return false; }
}

/* ---------- debug handle (rigs + parent call these; names are the contract) ---------- */

if (typeof window !== "undefined" && window) {
  try {
    window.__avCard = {
      version: AV_CARD_VERSION,
      init: avCardInit,
      build: avCardBuild,
      encode: avCardEncode,
      decode: avCardDecode,
      url: avCardUrl,
      applyUrl: avCardApplyUrl,
      qr: avCardQr,
      qrSelfCheck: avCardQrSelfCheck,
      png: avCardPng,
      share: avCardShare,
      copy: avCardCopyLink,
      state: avCardState,
      classes: avCardClasses,
    };
  } catch (e) { /* no window — node harness only */ }
}
