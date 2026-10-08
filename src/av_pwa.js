/* Anvil - PWA + offline page module (PLATFORM wave, child sa-A, #78; verify/_platform_wave.md 2.1).

   WHAT THIS MODULE IS - the page-side half of the installable/offline story:
     - REGISTRATION: avPwaInit() registers ./sw.js (scope ./) only where a service worker can
       actually run: https:, or host localhost / 127.0.0.1 / [::1]. On file: (every other suite
       plus the smoke) it is an honest no-op: supported false, zero registration attempts, zero
       errors. ?nosw=1 skips registration entirely (the platform rig opt-out).
     - STATE: avPwaState() and window.__avPwa.state() report the truth as one JSON-safe object:
       supported, registered, active, waiting, controlled, online, scope, swUrl, errors
       (capped at 16) - plus the honest extras documented below.
     - UPDATE FLOW: a waiting worker sets body class av-pwa-update and shows the chip
       #av-pwa-update ("UPDATE READY - RELOAD"). Its click posts { t: "av-skip-waiting" } to the
       waiting worker; the controllerchange that follows reloads the page ONCE. This module
       NEVER calls skipWaiting itself and never reloads unasked - the chip click is the only path.
     - INSTALL: beforeinstallprompt is captured (preventDefault; the event stored; canInstall
       true; chip #av-pwa-install "INSTALL APP" shown) - click runs prompt() and awaits
       userChoice; appinstalled sets installed true and hides the chip. On iOS/iPadOS where no
       beforeinstallprompt ever fires, the hint chip #av-pwa-ios ("Share -> Add to Home Screen")
       shows when the page is not already standalone.
     - OFFLINE: online/offline events plus navigator.onLine drive body class av-pwa-offline and
       the chip #av-pwa-offline ("OFFLINE - everything is local, keep going").
     - FILE HANDLING: when window.launchQueue exists, its consumer reads the launched file:
       .anvl (case-insensitive) is decoded as text, handed to avProjOpenText(name, text) when
       that seam exists (av_proj.js), else dispatched as a window CustomEvent "av-launch-file"
       with detail { name, text }; EVERY other extension keeps the File INTACT and routes to the
       import funnel avImportFiles([file]) (av_import.js) - never decoded as text (R18b D7).
     - PROOF: avPwaProof() RETURNS one line - PWA SELFTEST {"supported":...,"installPath":...}
       (app_core appends it under ?avtest=1; this module never prints and never calls avTestLine).

   CONTRACT SURFACE (rig + smoke rely on these exact ids):
     chips container #av-pwa-chips (class av-pwa-chips) appended to document.body, holding
     #av-pwa-install / #av-pwa-ios / #av-pwa-offline / #av-pwa-update (class av-pwa-chip; shown
     via the hidden attribute). Body classes: av-pwa-offline, av-pwa-update. Body dataset:
     avPwa = "1" (supported) | "0" (not).
     Debug handle window.__avPwa = { version, supported, registered, active, waiting, state(),
     init, installPrompt(), canInstall, installed, online, swUrl, scope, errors[] } - the value
     members are live getters; state()/installPrompt() are the pinned test hooks.

   LAWS: "use strict"; classic script; ONE namespace avPwa* / AV_PWA_*; node-loadable (no DOM or
   global reach at load - every reach is typeof-guarded inside a function); never throws (honest
   refusals in state, no console output - errors[] leaves via state() only); one writer (child
   sa-A); nothing is uploaded anywhere. */

"use strict";

const AV_PWA_VERSION = "platform.0";
const AV_PWA_SW_URL = "./sw.js";
const AV_PWA_SW_SCOPE = "./";
const AV_PWA_ERRORS_CAP = 16;      /* state().errors cap (contract 2.1) */
const AV_PWA_UPDATE_MS = 60000;    /* registration.update() at most once a minute */
const AV_PWA_CLASSES = Object.freeze(["av-pwa-chips", "av-pwa-chip", "av-pwa-offline", "av-pwa-update"]);

/* ---------- module state (the one truth store; no DOM, no globals touched at load) ---------- */
const avPwa = {
  inited: false,
  wired: false,
  schedRegister: false,      /* a load-listener registration is pending */
  supported: false,
  nosw: false,               /* ?nosw=1 seen at init */
  registering: false,
  registered: false,
  active: false,
  controlled: false,
  updating: false,           /* updatefound -> installed while controlled */
  scope: "",
  swUrl: "",
  reg: null,                 /* the ServiceWorkerRegistration once register() resolves */
  regWatched: false,
  updateTimer: null,
  updateCheckedAt: 0,
  updates: 0,                /* updatefound count */
  controllerChanges: 0,
  installEvent: null,        /* the captured beforeinstallprompt event */
  installCaptured: false,    /* a beforeinstallprompt was seen at least once */
  installConsumed: false,
  canInstall: false,
  installed: false,
  installOutcome: "",        /* "", "prompted", "accepted", "dismissed", "installed", "error" */
  installNote: "",
  iosHint: false,
  launchQueue: false,        /* a launchQueue consumer was installed */
  launchCount: 0,
  lastLaunch: null,          /* { name, chars, via } or { name, ext, via:"import" } (R18b) */
  launchNote: "",
  updateNote: "",
  reloadWanted: false,       /* set by the update chip click - the only reload path */
  reloading: false,
  errors: [],                /* capped at AV_PWA_ERRORS_CAP; reported via state() only */
};

/* ---------- guarded platform reaches (no DOM/global access at load) ---------- */

function avPwaWin() {
  try { if (typeof window !== "undefined") return window; } catch (e) { /* absent */ }
  return null;
}

function avPwaDoc() {
  try { if (typeof document !== "undefined") return document; } catch (e) { /* absent */ }
  return null;
}

function avPwaLoc() {
  try { if (typeof location !== "undefined") return location; } catch (e) { /* absent */ }
  return null;
}

function avPwaNav() {
  try { if (typeof navigator !== "undefined") return navigator; } catch (e) { /* absent */ }
  return null;
}

function avPwaErrText(e) {
  try {
    if (e && typeof e === "object") {
      if (typeof e.message === "string" && e.message) return e.message;
      if (typeof e.name === "string" && e.name) return e.name;
    }
    if (typeof e === "string" && e) return e;
  } catch (e2) { /* fall through */ }
  return "unknown error";
}

/* the ONE error sink - state().errors, capped, never console */
function avPwaErr(msg) {
  try {
    const t = String(msg == null ? "" : msg).replace(/\s+/g, " ").trim();
    if (!t) return false;
    avPwa.errors.push(t);
    while (avPwa.errors.length > AV_PWA_ERRORS_CAP) avPwa.errors.shift();
    return true;
  } catch (e) { return false; }
}

/* ---------- tiny guarded facts ---------- */

/* ?nosw=1 anywhere in the query (the rig opt-out; same pattern as avtest in app_core) */
function avPwaNoswRequested() {
  try {
    const loc = avPwaLoc();
    if (!loc) return false;
    return /[?&]nosw=1/.test(String(loc.search || ""));
  } catch (e) { return false; }
}

/* supported = serviceWorker in navigator AND (https: OR localhost/127.0.0.1/[::1]). */
function avPwaSupported() {
  try {
    const loc = avPwaLoc();
    if (!loc) return false;
    let swIn = false;
    try { const nav = avPwaNav(); swIn = !!nav && ("serviceWorker" in nav); } catch (e) { swIn = false; }
    if (!swIn) return false;
    if (String(loc.protocol || "") === "https:") return true;
    const host = String(loc.hostname || "");
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch (e) { return false; }
}

function avPwaSwUrlNow() {
  try {
    const loc = avPwaLoc();
    if (loc && typeof loc.href === "string" && typeof URL === "function") {
      return new URL(AV_PWA_SW_URL, loc.href).href;
    }
  } catch (e) { /* fall back to the relative form */ }
  return AV_PWA_SW_URL;
}

function avPwaOnlineNow() {
  try {
    const nav = avPwaNav();
    if (nav) return nav.onLine !== false;
  } catch (e) { /* treat unknown as online */ }
  return true;
}

function avPwaStandaloneNow() {
  try {
    const nav = avPwaNav();
    if (nav && nav.standalone === true) return true;
    const w = avPwaWin();
    if (w && typeof w.matchMedia === "function") {
      const mq = w.matchMedia("(display-mode: standalone)");
      if (mq && mq.matches === true) return true;
    }
  } catch (e) { /* not standalone */ }
  return false;
}

function avPwaIsIOS() {
  try {
    const nav = avPwaNav();
    if (!nav) return false;
    const ua = String(nav.userAgent || "");
    if (ua.indexOf("iPad") !== -1 || ua.indexOf("iPhone") !== -1 || ua.indexOf("iPod") !== -1) return true;
    /* iPadOS reports a desktop UA - the pointer count is the tell */
    if (String(nav.platform || "") === "MacIntel" && Number(nav.maxTouchPoints || 0) > 1) return true;
  } catch (e) { /* not iOS */ }
  return false;
}

/* live facts read through the platform, cached flags only as a fallback */
function avPwaActiveNow() {
  try { if (avPwa.reg && avPwa.reg.active) return true; } catch (e) { /* reg gone */ }
  return avPwa.active === true;
}

function avPwaControlledNow() {
  try {
    const nav = avPwaNav();
    if (nav && nav.serviceWorker && nav.serviceWorker.controller) return true;
  } catch (e) { /* none */ }
  return avPwa.controlled === true;
}

function avPwaWaitingNow() {
  let w = false;
  try { w = !!(avPwa.reg && avPwa.reg.waiting); } catch (e) { w = false; }
  return w || avPwa.updating === true;
}

/* "bip" | "ios" | "none" - which install path this environment offers */
function avPwaInstallPath() {
  if (avPwa.installCaptured === true) return "bip";
  if (avPwa.iosHint === true) return "ios";
  return "none";
}

/* ---------- body + chips (all DOM reached only from inside guarded functions) ---------- */

function avPwaBody() {
  try {
    const d = avPwaDoc();
    return (d && d.body) ? d.body : null;
  } catch (e) { return null; }
}

function avPwaBodyClass(cls, on) {
  try {
    const b = avPwaBody();
    if (!b || !b.classList) return false;
    if (on) b.classList.add(cls); else b.classList.remove(cls);
    return true;
  } catch (e) { return false; }
}

function avPwaChip(d, tag, id, text, title) {
  const el = d.createElement(tag);
  el.id = id;
  el.className = "av-pwa-chip";
  el.textContent = text;
  try { el.title = title; } catch (e) { /* attribute refused */ }
  if (tag === "button") { try { el.type = "button"; } catch (e2) { /* attribute refused */ } }
  if (id === "av-pwa-ios" || id === "av-pwa-offline") { try { el.setAttribute("role", "status"); } catch (e3) { /* attribute refused */ } }
  el.hidden = true;
  return el;
}

/* the chips container, created on first need and reused after (id #av-pwa-chips) */
function avPwaChips() {
  try {
    const d = avPwaDoc();
    if (!d || !d.body || typeof d.getElementById !== "function" || typeof d.createElement !== "function") return null;
    const found = d.getElementById("av-pwa-chips");
    if (found) return found;
    const box = d.createElement("div");
    box.id = "av-pwa-chips";
    box.className = "av-pwa-chips";
    box.appendChild(avPwaChip(d, "button", "av-pwa-install", "INSTALL APP", "install Anvil as an app"));
    box.appendChild(avPwaChip(d, "span", "av-pwa-ios", "Share -> Add to Home Screen", "iOS: Share, then Add to Home Screen"));
    box.appendChild(avPwaChip(d, "span", "av-pwa-offline", "OFFLINE \u2014 everything is local, keep going", "the network is gone - Anvil is local-first"));
    box.appendChild(avPwaChip(d, "button", "av-pwa-update", "UPDATE READY \u2014 RELOAD", "a new build is waiting - reload to switch to it"));
    if (typeof box.addEventListener === "function") box.addEventListener("click", avPwaChipClick);
    d.body.appendChild(box);
    return box;
  } catch (e) { return null; }
}

function avPwaChipShow(box, id, on) {
  try {
    if (!box || typeof box.querySelector !== "function") return false;
    const el = box.querySelector("#" + id);
    if (!el) return false;
    const want = !on;
    if (el.hidden !== want) el.hidden = want;
    return true;
  } catch (e) { return false; }
}

/* one delegated click listener on the container - a listener never throws outward */
function avPwaChipClick(ev) {
  try {
    const t = ev && ev.target;
    if (!t || typeof t.closest !== "function") return;
    if (t.closest("#av-pwa-install")) { avPwaInstallClick(); return; }
    if (t.closest("#av-pwa-update")) { avPwaUpdateClick(); return; }
  } catch (e) { /* swallow */ }
}

/* ---------- the paint: body dataset + classes + chip visibility ---------- */

function avPwaSync() {
  try {
    const s = avPwa;
    s.active = avPwaActiveNow();
    s.controlled = avPwaControlledNow();
    const waiting = avPwaWaitingNow();
    const online = avPwaOnlineNow();
    const b = avPwaBody();
    if (b && b.dataset) b.dataset.avPwa = s.supported ? "1" : "0";
    avPwaBodyClass("av-pwa-offline", !online);
    avPwaBodyClass("av-pwa-update", waiting);
    const box = avPwaChips();
    if (box) {
      avPwaChipShow(box, "av-pwa-install", !!(s.canInstall && !s.installed));
      avPwaChipShow(box, "av-pwa-ios", s.iosHint === true);
      avPwaChipShow(box, "av-pwa-offline", !online);
      avPwaChipShow(box, "av-pwa-update", waiting);
    }
    return true;
  } catch (e) { return false; }
}

/* ---------- online / offline ---------- */

function avPwaOnOnline() {
  try { avPwaSync(); } catch (e) { /* a listener never throws outward */ }
}

function avPwaOnOffline() {
  try { avPwaSync(); } catch (e) { /* a listener never throws outward */ }
}

/* ---------- install (beforeinstallprompt + iOS hint) ---------- */

function avPwaOnBeforeInstallPrompt(ev) {
  try {
    const s = avPwa;
    if (ev && typeof ev.preventDefault === "function") {
      try { ev.preventDefault(); } catch (e) { /* not cancelable - fine */ }
    }
    s.installEvent = ev || null;
    s.installCaptured = true;
    s.canInstall = true;
    s.installNote = "";
    s.iosHint = false;              /* a real prompt beats the hint */
    avPwaSync();
  } catch (e) { avPwaErr("install capture failed: " + avPwaErrText(e)); }
}

function avPwaOnAppInstalled() {
  try {
    const s = avPwa;
    s.installed = true;
    s.canInstall = false;
    s.installOutcome = "installed";
    avPwaSync();
  } catch (e) { avPwaErr("appinstalled handling failed: " + avPwaErrText(e)); }
}

/* one beforeinstallprompt can be prompted once - after the choice the chip retires */
function avPwaInstallConsumed() {
  try {
    const s = avPwa;
    s.canInstall = false;
    s.installConsumed = true;
    avPwaSync();
  } catch (e) { /* consume is best-effort paint */ }
}

function avPwaInstallClick() {
  const s = avPwa;
  const ev = s.installEvent;
  if (!ev || typeof ev.prompt !== "function") {
    s.installNote = "no install prompt is pending";
    avPwaSync();
    return false;
  }
  let prompted = false;
  try { ev.prompt(); prompted = true; }
  catch (e) { avPwaErr("install prompt failed: " + avPwaErrText(e)); }
  if (!prompted) { avPwaSync(); return false; }
  s.installOutcome = "prompted";
  try {
    const uc = ev.userChoice;
    if (uc && typeof uc.then === "function") {
      uc.then(function (res) {
        s.installOutcome = (res && res.outcome) ? String(res.outcome) : "unknown";
        avPwaInstallConsumed();
      }, function () {
        s.installOutcome = "error";
        avPwaInstallConsumed();
      });
    } else {
      avPwaInstallConsumed();
    }
  } catch (e) {
    s.installOutcome = "error";
    avPwaInstallConsumed();
  }
  avPwaSync();
  return true;
}

/* ---------- the update flow (chip click is the ONLY skipWaiting + reload path) ---------- */

function avPwaMarkUpdate() {
  try {
    avPwa.updating = true;
    avPwaSync();
  } catch (e) { /* paint is best-effort */ }
}

function avPwaUpdateClick() {
  const s = avPwa;
  if (s.reloading) return false;
  let sw = null;
  try { sw = (s.reg && s.reg.waiting) ? s.reg.waiting : null; } catch (e) { sw = null; }
  if (!sw || typeof sw.postMessage !== "function") {
    s.updateNote = "no waiting worker - reload the page to update";
    avPwaSync();
    return false;
  }
  s.reloadWanted = true;             /* the controllerchange that follows reloads once */
  try {
    sw.postMessage({ t: "av-skip-waiting" });
    s.updateNote = "";
    return true;
  } catch (e) {
    s.reloadWanted = false;
    avPwaErr("update skip message failed: " + avPwaErrText(e));
    avPwaSync();
    return false;
  }
}

function avPwaOnControllerChange() {
  try {
    const s = avPwa;
    s.controlled = true;
    s.controllerChanges += 1;
    try { if (!s.reg || !s.reg.waiting) s.updating = false; } catch (e) { s.updating = false; }
    avPwaSync();
    if (!s.reloadWanted || s.reloading) return;   /* first claim / external change: stay put */
    s.reloading = true;
    try {
      const loc = avPwaLoc();
      if (loc && typeof loc.reload === "function") loc.reload();
    } catch (e) { avPwaErr("reload after update failed: " + avPwaErrText(e)); }
  } catch (e) { /* a listener never throws outward */ }
}

/* ---------- registration + update checks (all guarded, all late) ---------- */

function avPwaRegWatch(reg) {
  const s = avPwa;
  try {
    if (!reg || typeof reg.addEventListener !== "function" || s.regWatched) return false;
    s.regWatched = true;
    reg.addEventListener("updatefound", function () {
      try {
        s.updates += 1;
        const nu = reg.installing;
        if (!nu || typeof nu.addEventListener !== "function") return;
        nu.addEventListener("statechange", function () {
          try {
            /* installed while a controller exists = an update is waiting for the chip click */
            if (nu.state === "installed" && avPwaControlledNow()) avPwaMarkUpdate();
          } catch (e) { /* never throws outward */ }
        });
      } catch (e) { /* never throws outward */ }
    });
    return true;
  } catch (e) { return false; }
}

function avPwaCheckWaiting(reg) {
  try { if (reg && reg.waiting && avPwaControlledNow()) avPwaMarkUpdate(); } catch (e) { /* none */ }
  return false;
}

function avPwaUpdateCheck() {
  const s = avPwa;
  if (!s.reg || typeof s.reg.update !== "function") return false;
  const now = Date.now();
  if (s.updateCheckedAt && (now - s.updateCheckedAt) < AV_PWA_UPDATE_MS) return false;   /* once a minute at most */
  s.updateCheckedAt = now;
  try {
    const p = s.reg.update();
    if (p && typeof p.then === "function") {
      p.then(function () { avPwaCheckWaiting(s.reg); }, function () { /* offline is normal */ });
    }
    return true;
  } catch (e) { return false; }
}

function avPwaStartUpdateTimer() {
  const s = avPwa;
  try {
    if (s.updateTimer || typeof setInterval !== "function") return false;
    s.updateTimer = setInterval(function () { try { avPwaUpdateCheck(); } catch (e) { /* a timer never throws */ } }, AV_PWA_UPDATE_MS);
    return true;
  } catch (e) { return false; }
}

function avPwaRegisterNow() {
  const s = avPwa;
  try {
    if (!s.supported || s.nosw || s.registered || s.registering) return false;
    const nav = avPwaNav();
    if (!nav || !nav.serviceWorker || typeof nav.serviceWorker.register !== "function") return false;
    s.registering = true;
    let p = null;
    try { p = nav.serviceWorker.register(AV_PWA_SW_URL, { scope: AV_PWA_SW_SCOPE }); }
    catch (e) {
      s.registering = false;
      avPwaErr("service worker registration failed: " + avPwaErrText(e));
      return false;
    }
    Promise.resolve(p).then(function (reg) {
      s.registering = false;
      if (!reg) { avPwaErr("service worker registration returned nothing"); avPwaSync(); return; }
      s.reg = reg;
      s.registered = true;
      try { s.scope = (typeof reg.scope === "string" && reg.scope) ? reg.scope : ""; } catch (e) { s.scope = ""; }
      s.active = avPwaActiveNow();
      avPwaRegWatch(reg);
      avPwaCheckWaiting(reg);
      avPwaStartUpdateTimer();
      avPwaSync();
    }, function (err) {
      s.registering = false;
      avPwaErr("service worker registration failed: " + avPwaErrText(err));
      avPwaSync();
    });
    return true;
  } catch (e) {
    s.registering = false;
    avPwaErr("service worker registration failed: " + avPwaErrText(e));
    return false;
  }
}

/* register AFTER window load (or immediately when the load already happened) */
function avPwaScheduleRegister() {
  const s = avPwa;
  try {
    if (!s.supported || s.nosw || s.registered || s.registering || s.schedRegister) return false;
    const d = avPwaDoc();
    const w = avPwaWin();
    if (d && d.readyState === "complete") return avPwaRegisterNow();
    if (!w || typeof w.addEventListener !== "function") return avPwaRegisterNow();
    s.schedRegister = true;
    w.addEventListener("load", function () {
      try { avPwaRegisterNow(); }
      catch (e) { avPwaErr("service worker registration failed: " + avPwaErrText(e)); }
    });
    return true;
  } catch (e) { return false; }
}

/* ---------- launchQueue file handling ---------- */

function avPwaDecodeUtf8(ab) {
  try { if (typeof TextDecoder === "function") return new TextDecoder("utf-8").decode(ab); } catch (e) { /* fallback */ }
  try {
    const u = new Uint8Array(ab);
    let out = "";
    for (let i = 0; i < u.length; i++) out += String.fromCharCode(u[i]);
    return out;
  } catch (e2) { return ""; }
}

/* hand off: avProjOpenText(name, text) when that seam exists, else the av-launch-file event */
function avPwaLaunchHandoff(name, text) {
  const w = avPwaWin();
  let fn = null;
  try { if (typeof avProjOpenText === "function") fn = avProjOpenText; } catch (e) { fn = null; }
  if (!fn && w) { try { if (typeof w.avProjOpenText === "function") fn = w.avProjOpenText; } catch (e) { fn = null; } }
  if (fn) {
    try {
      const r = fn(name, text);
      if (r && typeof r.then === "function") {
        try { r.then(null, function (e) { avPwaErr("avProjOpenText rejected: " + avPwaErrText(e)); }); } catch (e2) { /* ok */ }
      }
    } catch (e) { avPwaErr("avProjOpenText threw: " + avPwaErrText(e)); }
    return "avProjOpenText";
  }
  try {
    if (w && typeof w.dispatchEvent === "function" && typeof w.CustomEvent === "function") {
      w.dispatchEvent(new w.CustomEvent("av-launch-file", { detail: { name: name, text: text } }));
      return "event";
    }
  } catch (e) { avPwaErr("av-launch-file dispatch failed: " + avPwaErrText(e)); }
  return "none";
}

/* the lowercased extension of a launched file name ("" when there is none) - R18b */
function avPwaExtOf(name) {
  try {
    const n = (name == null) ? "" : String(name);
    const i = n.lastIndexOf(".");
    if (i < 0 || i >= n.length - 1) return "";
    return n.slice(i + 1).toLowerCase();
  } catch (e) { return ""; }
}

/* R18b (D7): .anvl (case-insensitive) keeps the text route; EVERY other extension - known or
   unknown - keeps the File INTACT and routes to the import funnel avImportFiles([file])
   (av_import.js, which sniffs and refuses honestly); a non-anvl file is NEVER decoded as text,
   and an absent funnel is an honest launchNote, never a throw. */
async function avPwaLaunchHandle(params) {
  const s = avPwa;
  try {
    const h0 = (params && params.files && params.files.length) ? params.files[0] : null;
    if (!h0) return false;
    let file = h0;
    if (typeof h0.getFile === "function") file = await h0.getFile();
    const name = (file && file.name != null && String(file.name)) ? String(file.name) : "launched.anvl";
    const ext = avPwaExtOf(name);
    if (ext !== "anvl") {
      s.launchCount += 1;
      s.launchNote = "";
      let fn = null;
      try { if (typeof avImportFiles === "function") fn = avImportFiles; } catch (e) { fn = null; }
      if (fn) {
        try {
          const r = fn([file]);
          if (r && typeof r.then === "function") {
            try { r.then(null, function (e) { avPwaErr("avImportFiles rejected: " + avPwaErrText(e)); }); } catch (e2) { /* ok */ }
          }
        } catch (e) { s.launchNote = "the launched file could not be imported"; avPwaErr("launch import threw: " + avPwaErrText(e)); }
      } else {
        s.launchNote = "the import module is not loaded";
      }
      s.lastLaunch = { name: name, ext: ext, via: "import" };
      avPwaSync();
      return true;
    }
    let text = "";
    if (file && typeof file.text === "function") text = await file.text();
    else if (file && typeof file.arrayBuffer === "function") text = avPwaDecodeUtf8(await file.arrayBuffer());
    if (typeof text !== "string") text = "";
    s.launchCount += 1;
    s.launchNote = "";
    const via = avPwaLaunchHandoff(name, text);
    s.lastLaunch = { name: name, chars: text.length, via: via };
    avPwaSync();
    return true;
  } catch (e) {
    s.launchNote = "the launched file could not be read";
    avPwaErr("launch file failed: " + avPwaErrText(e));
    avPwaSync();
    return false;
  }
}

/* ---------- wire (one pass; listeners are plain, so a synthetic event drives the same code) ---------- */

function avPwaWire() {
  const s = avPwa;
  const w = avPwaWin();
  if (!w || typeof w.addEventListener !== "function") return false;
  if (s.wired) return true;
  s.wired = true;
  try { w.addEventListener("beforeinstallprompt", avPwaOnBeforeInstallPrompt); } catch (e) { /* none */ }
  try { w.addEventListener("appinstalled", avPwaOnAppInstalled); } catch (e) { /* none */ }
  try { w.addEventListener("online", avPwaOnOnline); } catch (e) { /* none */ }
  try { w.addEventListener("offline", avPwaOnOffline); } catch (e) { /* none */ }
  try {
    const nav = avPwaNav();
    if (nav && nav.serviceWorker && typeof nav.serviceWorker.addEventListener === "function") {
      nav.serviceWorker.addEventListener("controllerchange", avPwaOnControllerChange);
    }
  } catch (e) { /* no serviceWorker container */ }
  try {
    if (w.launchQueue && typeof w.launchQueue.setConsumer === "function") {
      w.launchQueue.setConsumer(function (params) {
        try {
          const p = avPwaLaunchHandle(params);
          if (p && typeof p.catch === "function") p.catch(function (e) { avPwaErr("launch handling failed: " + avPwaErrText(e)); });
        } catch (e) { avPwaErr("launch handling failed: " + avPwaErrText(e)); }
      });
      s.launchQueue = true;
    }
  } catch (e) { avPwaErr("launchQueue consumer failed: " + avPwaErrText(e)); }
  return true;
}

/* a late sync so the chips land even when init ran before <body> existed */
function avPwaScheduleLoadSync() {
  try {
    const d = avPwaDoc();
    const w = avPwaWin();
    if (!w || typeof w.addEventListener !== "function") return false;
    if (d && d.readyState === "complete") return true;    /* nothing owed */
    w.addEventListener("load", function () {
      try { avPwaSync(); } catch (e) { /* load sync never throws */ }
      try { avPwaCheckWaiting(avPwa.reg); } catch (e) { /* reg may be null */ }
    });
    return true;
  } catch (e) { return false; }
}

/* ---------- init / state / proof / classes ---------- */

/* the manifest <link> is injected at init, NEVER statically: a static link makes the browser fetch
   manifest.webmanifest on file:// and log a CORS console error (the smoke zero-error law) */
function avPwaLinkManifest() {
  try {
    const d = avPwaDoc();
    if (!d || !d.head || typeof d.createElement !== "function") return false;
    if (typeof d.querySelector === "function" && d.querySelector('link[rel="manifest"]')) return true;
    const l = d.createElement("link");
    l.rel = "manifest";
    l.href = "manifest.webmanifest";
    d.head.appendChild(l);
    return true;
  } catch (e) { return false; }
}

function avPwaInit() {
  let out = false;
  try {
    const s = avPwa;
    s.supported = avPwaSupported();
    s.nosw = avPwaNoswRequested();
    s.swUrl = avPwaSwUrlNow();
    if (s.supported) avPwaLinkManifest();
    avPwaWire();
    if (!s.inited) {
      s.inited = true;
      avPwaScheduleLoadSync();
      /* the iOS hint is a static fact - decided once (Chromium never shows it) */
      s.iosHint = !!(s.supported && avPwaIsIOS() && !avPwaStandaloneNow());
    }
    if (s.supported && !s.nosw) avPwaScheduleRegister();
    avPwaSync();
    out = s.supported;
  } catch (e) {
    avPwaErr("pwa init failed: " + avPwaErrText(e));
    out = false;
  }
  return out;
}

function avPwaState() {
  const s = avPwa;
  try {
    return {
      supported: avPwaSupported(),
      registered: s.registered === true,
      active: avPwaActiveNow(),
      waiting: avPwaWaitingNow(),
      controlled: avPwaControlledNow(),
      online: avPwaOnlineNow(),
      scope: (typeof s.scope === "string") ? s.scope : "",
      swUrl: avPwaSwUrlNow(),
      errors: s.errors.slice(),
      nosw: s.nosw === true,
      registering: s.registering === true,
      updates: s.updates,
      canInstall: s.canInstall === true,
      installed: s.installed === true,
      installPath: avPwaInstallPath(),
      installOutcome: String(s.installOutcome || ""),
      installNote: s.installNote,
      iosHint: s.iosHint === true,
      launchQueue: s.launchQueue === true,
      launchCount: s.launchCount,
      lastLaunch: s.lastLaunch ? { name: s.lastLaunch.name, chars: s.lastLaunch.chars, ext: s.lastLaunch.ext, via: s.lastLaunch.via } : null,
      launchNote: s.launchNote,
      updateNote: s.updateNote,
      reloading: s.reloading === true,
    };
  } catch (e) {
    return {
      supported: false, registered: false, active: false, waiting: false, controlled: false,
      online: avPwaOnlineNow(), scope: "", swUrl: avPwaSwUrlNow(), errors: [],
    };
  }
}

/* one line for app_core's ?avtest=1 list - this module never prints anything itself */
function avPwaProof() {
  const out = {
    supported: false, registered: false, active: false, waiting: false,
    installPath: "none", launch: 0,
  };
  try {
    const st = avPwaState();
    out.supported = st.supported === true;
    out.registered = st.registered === true;
    out.active = st.active === true;
    out.waiting = st.waiting === true;
    out.installPath = (st.installPath === "bip" || st.installPath === "ios") ? st.installPath : "none";
    out.launch = isFinite(st.launchCount) ? Math.round(st.launchCount) : 0;
  } catch (e) { /* keep the honest defaults */ }
  try { return "PWA SELFTEST " + JSON.stringify(out); } catch (e2) { return "PWA SELFTEST {}"; }
}

function avPwaInstallPrompt() {
  return avPwa.installEvent ? avPwa.installEvent : null;
}

function avPwaClasses() {
  return AV_PWA_CLASSES.slice();
}

/* ---------- the debug/test handle (contract surface; live getters) ---------- */

if (typeof window !== "undefined") {
  try {
    const handle = {};
    const def = function (name, fn) {
      try { Object.defineProperty(handle, name, { get: fn, enumerable: true, configurable: true }); }
      catch (e) { try { handle[name] = fn(); } catch (e2) { /* frozen handle */ } }
    };
    handle.version = AV_PWA_VERSION;
    def("supported", function () { return avPwaSupported(); });
    def("registered", function () { return avPwa.registered === true; });
    def("active", function () { return avPwaActiveNow(); });
    def("waiting", function () { return avPwaWaitingNow(); });
    def("canInstall", function () { return avPwa.canInstall === true; });
    def("installed", function () { return avPwa.installed === true; });
    def("online", function () { return avPwaOnlineNow(); });
    def("swUrl", function () { return avPwa.swUrl || avPwaSwUrlNow(); });
    def("scope", function () { return (typeof avPwa.scope === "string") ? avPwa.scope : ""; });
    def("errors", function () { return avPwa.errors.slice(); });
    handle.state = function () { return avPwaState(); };
    handle.init = function () { return avPwaInit(); };
    handle.installPrompt = function () { return avPwaInstallPrompt(); };
    window.__avPwa = handle;
  } catch (e) { /* no window - nothing to publish */ }
}
