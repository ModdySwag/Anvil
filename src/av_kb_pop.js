/* av_kb_pop.js — the popout keyboard (Anvil). Ported from Pattern Forge's popout keyboard subsystem
   (src/app_kb.js L593-952, "Stage 18/18.5") — see research/reuse/kb-port-digest.md §3.7 and
   verify/_s5_wave.md §2.A. Loads right after av_kb.js, same concatenated scope: it may read
   avArmed / avInputMode / avPianoWin and call avPianoOctStep / avSetInputMode / avNoteStopAll
   directly.

   The keys are pure UI: every note is played by the app's engine, so the popout carries no audio —
   it carries the KEY BED. The bed's pointer handlers are bound to #piano-keys ITSELF (avPianoBind),
   so they ride with the node when it is ADOPTED into the other window (same-origin, so nothing is
   re-fetched and no script has to run in the popout).

   LAWS preserved (PF refs = app_kb.js):
   - DPIP first: documentPictureInPicture.requestWindow({width,height}) with the impostor check — a
     resolve is NOT a window: accept only a live, CURRENT PiP window, anything else hands the job to
     the named popup (PF L834-855). `{ pip:false }` forces the named popup (the rig's path).
   - window.open('', 'av-keys', features) — NEVER about:blank, and NEVER navigate an existing named
     window: a leftover shell is reused by name, and opening a URL in it NAVIGATES it — anything
     appended before the navigation commits is wiped (the silent no-op that then blocks every later
     attempt; PF L856-862). Foreign-tab ownership token: a window stamped by another tab is left
     strictly alone and the pop is refused with an honest error (PF L872-883).
   - the live bed #piano-keys is APPENDED into the popout (document adoption — pointer handlers ride
     with the node; PF L900); app styles are imported by CONTENT (find the <style> containing
     '.pk-white', stamp data-av-pop-sheet so a reused window can't stack copies; PF L727-736).
   - forwarder re-dispatches new KeyboardEvent(...) into the APP document (the ONE keydown listener,
     avKbHandle, picks it up); if the app claimed the event (defaultPrevented), preventDefault in the
     popout too — Ctrl+R must not reload the popout out from under the keys (PF L781-795); re-mount
     REPLACES forwarders, never stacks (one keypress in = one delivery; PF L798-807).
   - window-death home: poll handle.closed (~500 ms) + pagehide/beforeunload farewell (PF L808-811);
     home is gated on the APP's own state (body.piano-pop), not the handle alone — a dead window left
     a dead ⧉ BACK and a keyboard-less band with no way home (PF L917-922).
   - blocked popup → refuse honestly: {via:null, error} returned, NO piano-pop half state, no
     adoption, no handle (PF L863-866).
   - while out: body.piano-pop + the app hint shows the popout copy (avKbPopHint(), E-kb4); the
     popout bar carries ⧉ BACK · ARM · − OCT + · hint (PF L750-773).

   Anvil adaptations (reported to the parent):
   - return shape: avKbPopOpen() resolves {via:'dpip'|'window'|null, error?} — PF returned the window.
   - PF's band seating (kbPopSeatBand / kbPopRestore / pfDockSet / dock-rail ladder / drawer) is
     dropped: Anvil has no dock-height ladder — body.piano-pop (parent CSS) is what collapses the band
     to its rail. PF's toasts / chrome syncs (toast/pfChromeSync/pfPopTraySync/hubSay) have no Anvil
     equivalent and are dropped; refusals surface through the returned error string.
   - the popout bar keeps PF's ids (#pk-pop-bar / #pk-pop-arm / #pk-pop-win / #pk-pop-hint — rigs
     enumerate by them) and adds the av-pop-* classes the parent styles.

   DOM-free top level (parse-safe for node harnesses): every window/document/localStorage touch sits
   inside a function; the only module-scope window writes are the guarded __avKbPop handle and the
   __lastFwd witness at the very bottom. */
"use strict";

/* ---------- constants & state (PF L602-615) ---------- */

const AV_KB_POP_RECT_LS = "av-keys-pop";     /* the popout window's rect, remembered per browser */
const AV_KB_POP_TOKEN_SS = "av-keys-token";  /* per-TAB ownership stamp (sessionStorage) */
const AV_KB_POP_WIN_NAME = "av-keys";        /* the named popup — ''-opens only, never navigated */
const AV_KB_POP_TITLE = "Anvil — Keyboard";
const AV_KB_POP_WATCH_MS = 500;              /* window-death poll tick */

/* the app hint copy while the keys are out (PF L391-393 — the parent's E-kb4 hook uses this) and the
   popout bar's own hint strings (PF L401) */
const AV_KB_POP_HINT = "KEYBOARD POPPED OUT — click ⧉ BACK (or close that window) to dock them again";
const AV_KB_POP_HINT_ARMED = "typing here plays · this window is the piano";
const AV_KB_POP_HINT_IDLE = "click to play · ARM to type here";

let avKbPopWin = null;        /* the popout window while the keys are out */
let avKbPopVia = null;        /* 'dpip' | 'window' — how the current popout got out (report + rigs) */
let avKbPopEls = null;        /* { bar, win, arm, hint, doc } — the popout's readouts (mirrored) */
let avKbPopInited = false;    /* avKbPopInit idempotence */
let avKbPopWatch = null;      /* the closed-poll interval handle while the keys are out */

/* ---------- helpers ---------- */

/* the handle's liveness — a dead handle must never be focused or treated as out (PF L625) */
function avKbPopAlive() {
  try { return !!(avKbPopWin && !avKbPopWin.closed); } catch (e) { return false; }
}

/* per-TAB popout owner stamp: sessionStorage survives a reload of THIS tab but is not shared with
   another tab, so a leftover window from our own reload is reclaimed while a second Anvil tab's
   window is never wiped. Refused storage degrades to one shared value (PF L603-612). */
function avKbPopToken() {
  try {
    let t = sessionStorage.getItem(AV_KB_POP_TOKEN_SS);
    if (!t) { t = String(Math.random()).slice(2, 10); sessionStorage.setItem(AV_KB_POP_TOKEN_SS, t); }
    return t;
  } catch (e) { return "nostore"; }
}

/* the bed lives in whichever window currently owns it — never assume `document` (PF kbKeyRoot
   L617-624). The parent's avPianoBedRoot() (E-kb1) consults this for the refresh walk. */
function avKbPopKeysRoot() {
  try {
    if (avKbPopWin && !avKbPopWin.closed) { const d = avKbPopWin.document; if (d) return d; }
  } catch (e) { /* foreign or dead document */ }
  return (typeof document !== "undefined") ? document : null;
}

/* The bed can be MISSING: a popout renderer that dies without pagehide (crash, OOM kill, End-process)
   takes the adopted node with it, and the static markup has no second one. Everything that needs the
   bed goes through here — it rebuilds the box in its own slot (after the rail) and its 61 keys
   (PF kbEnsureKeysBox L627-644). */
function avKbPopEnsureBed() {
  if (typeof document === "undefined") return null;
  const dock = document.getElementById("piano-dock");
  if (!dock) return null;
  let box = document.getElementById("piano-keys");
  if (!box) {
    box = document.createElement("div");
    box.id = "piano-keys";
    dock.appendChild(box);
    if (typeof avPianoBuild === "function") avPianoBuild();
  } else if (!box.children.length) {
    if (typeof avPianoBuild === "function") avPianoBuild();
  }
  if (typeof avPianoBind === "function") avPianoBind(box);
  return box;
}

/* the saved-rect filter + clamp, pure for the harness: one filter with avKbPopSaveRect — a 420x200
   window is a real size and must come back; a rect saved on another display must not reopen
   off-screen (monitor unplugged, RDP, scaling change; PF L680-694) */
function avKbPopRectClamp(r, sw, sh) {
  if (!r || !(r.width >= 300) || !(r.height >= 120)) return null;
  const clamp = (v, max) => Math.max(0, Math.min(Math.round(v || 0), Math.max(0, max)));
  return { width: Math.min(r.width, sw), height: Math.min(r.height, sh),
    left: clamp(r.left, sw - 160), top: clamp(r.top, sh - 80) };
}

function avKbPopRect() {
  const sw = (window.screen && window.screen.availWidth) || 1280;
  const sh = (window.screen && window.screen.availHeight) || 800;
  try {
    const saved = JSON.parse(localStorage.getItem(AV_KB_POP_RECT_LS) || "null");
    const c = avKbPopRectClamp(saved, sw, sh);
    if (c) return c;
  } catch (e) { /* private mode */ }
  const w = Math.min(1100, sw - 80), h = 236;
  return { width: w, height: h, left: Math.max(0, Math.round((sw - w) / 2)), top: Math.max(0, sh - h - 80) };
}

function avKbPopSaveRect(win) {
  try {
    const r = { width: Math.round(win.outerWidth || 0), height: Math.round(win.outerHeight || 0),
      left: Math.round((win.screenX != null ? win.screenX : win.screenLeft) || 0),
      top: Math.round((win.screenY != null ? win.screenY : win.screenTop) || 0) };
    if (r.width >= 300 && r.height >= 120) localStorage.setItem(AV_KB_POP_RECT_LS, JSON.stringify(r));
  } catch (e) { /* refused or private mode */ }
}

/* the forwarder's KeyboardEvent payload — pure so the node harness can pin it (PF L784-785) */
function avKbPopEventInit(e) {
  return { key: e.key, code: e.code, repeat: e.repeat, shiftKey: e.shiftKey,
    ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, bubbles: true, cancelable: true };
}

/* Stage 18.5 — always-on-top where the browser allows it; the impostor check in avKbPopOpen covers
   the Electron shell (a resolve that is born dead), so no desktop flag is needed (PF L822-833). */
function avKbPopPiPAvailable() {
  try { return !!(window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === "function"); }
  catch (e) { return false; }
}

/* window-death home: a renderer that dies without pagehide (crash, OOM kill, End-process) leaves the
   handle reporting closed with no event — poll it (~500 ms; PF's close path assumes a poll watches
   it, the S5 contract pins the tick). */
function avKbPopWatchStart() {
  avKbPopWatchStop();
  if (typeof setInterval !== "function") return;
  avKbPopWatch = setInterval(() => {
    let dead = true;
    try { dead = !(avKbPopWin && !avKbPopWin.closed); } catch (e) { dead = true; }
    if (dead) avKbPopHome();
  }, AV_KB_POP_WATCH_MS);
}
function avKbPopWatchStop() {
  if (avKbPopWatch != null && typeof clearInterval === "function") {
    try { clearInterval(avKbPopWatch); } catch (e) { /* gone */ }
  }
  avKbPopWatch = null;
}

/* ---------- the popout document (mount, chrome, forwarders; PF L722-814) ---------- */

function avKbPopMount(win) {
  const doc = win.document;
  try { doc.title = AV_KB_POP_TITLE; } catch (e) { /* cosmetic */ }
  /* the bed must look exactly like the app's: import the app's OWN stylesheet wholesale, then add only
     the popout's chrome on top (the keys' ids/classes all still match). Pick by CONTENT, not position:
     the app's sheet is the <style> containing '.pk-white' (build.py inlines styles.css into one
     <style>). Stamp data-av-pop-sheet: re-mounting a REUSED window used to append another full copy
     on every mount — the body textContent reset never touches head (PF L725-736). */
  const head = doc.head || (doc.getElementsByTagName && doc.getElementsByTagName("head")[0]) || doc.documentElement;
  if (head && !(head.querySelector && head.querySelector("[data-av-pop-sheet]"))) {
    try {
      const sheets = [...document.querySelectorAll("style")];
      const src = sheets.find(s => /pk-white/.test(s.textContent || ""))
        || sheets.slice().sort((a, b) => (b.textContent || "").length - (a.textContent || "").length)[0];
      if (src) {
        const c = doc.importNode(src, true);
        c.setAttribute("data-av-pop-sheet", "1");
        head.appendChild(c);
      }
    } catch (e) { /* plain keys still play */ }
  }
  /* structural fallback so the window is usable even before the parent's av-pop-* rules land; the
     imported app sheet carries the keys' own look (teal skin, .pk-white etc.) */
  try {
    if (head && !(head.querySelector && head.querySelector("[data-av-pop]"))) {
      const extra = doc.createElement("style");
      extra.setAttribute("data-av-pop", "1");
      extra.textContent = "html,body{margin:0;height:100%;overflow:hidden;background:#0a0e11}"
        + "body{display:flex;flex-direction:column}"
        + "#piano-keys{flex:1 1 auto;min-height:52px;user-select:none;-webkit-user-select:none;touch-action:none}"
        + ".av-pop-bar{display:flex;gap:6px;align-items:center;padding:5px 8px;flex:0 0 auto}"
        + ".av-pop-hint{flex:1;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}";
      head.appendChild(extra);
    }
  } catch (e) { /* chrome degrades, keys still play */ }

  const bar = doc.createElement("div");
  bar.id = "pk-pop-bar";
  bar.className = "av-pop-bar";
  const back = doc.createElement("button");
  back.className = "av-pop-btn";
  back.textContent = "⧉ BACK";
  back.title = "Bring the keyboard back into Anvil";
  const arm = doc.createElement("button");
  arm.id = "pk-pop-arm";
  arm.className = "av-pop-btn";
  arm.textContent = "ARM";
  arm.title = "Arm the typing keys — this window types notes too";
  arm.setAttribute("aria-pressed", "false");
  const dn = doc.createElement("button");
  dn.className = "av-pop-btn";
  dn.textContent = "−";
  dn.title = "Window octave down ( [ )";
  const winLbl = doc.createElement("span");
  winLbl.id = "pk-pop-win";
  winLbl.className = "pk-win av-pop-win";
  winLbl.textContent = "OCT";
  const up = doc.createElement("button");
  up.className = "av-pop-btn";
  up.textContent = "+";
  up.title = "Window octave up ( ] )";
  const hint = doc.createElement("span");
  hint.id = "pk-pop-hint";
  hint.className = "av-pop-hint";
  hint.textContent = AV_KB_POP_HINT_IDLE;
  bar.appendChild(back); bar.appendChild(arm); bar.appendChild(dn); bar.appendChild(winLbl);
  bar.appendChild(up); bar.appendChild(hint);
  doc.body.appendChild(bar);

  back.addEventListener("click", () => avKbPopHome());
  arm.addEventListener("click", () => { if (typeof avSetInputMode === "function") avSetInputMode(avArmed ? "studio" : "keys"); });
  dn.addEventListener("click", () => { if (typeof avPianoOctStep === "function") avPianoOctStep(-1); });
  up.addEventListener("click", () => { if (typeof avPianoOctStep === "function") avPianoOctStep(1); });

  /* typing in the popout plays too. The app has ONE keyboard entry point (avKbHandle, bound to the
     app's document), so the raw key is forwarded as an event dispatched in the app's own document —
     no second copy of the key logic, and the app's own guards (typing, modes) all still apply.
     NB: this handler is DEFINED in the app's realm even though it runs on the popout's document, so
     `window` inside it is the APP's window — capture it here, not via window.opener (which would be
     this app's own opener: null; PF L774-780). */
  const host = window;
  const fwd = (type) => (e) => {
    try {
      if (!host || host.closed || !host.document) return;
      const s = new host.KeyboardEvent(type, avKbPopEventInit(e));
      /* dispatch on whatever the app has focused, so its own typing guard sees the caret it would
         see for a real keypress. Only while the app itself holds focus: the moment the popout is
         focused the app's own field is not receiving keys either, so the keys are notes (PF L786-791). */
      const t = (host.document.hasFocus && host.document.hasFocus() && host.document.activeElement)
        ? host.document.activeElement : (host.document.body || host.document);
      try { t.dispatchEvent(s); } catch (err) { host.document.dispatchEvent(s); }
      host.__lastFwd = (host.__lastFwd || 0) + 1;   /* delivery witness (suites): one keypress = one count */
      /* the app claimed (preventDefault) the keys it acts on; the popout's own event must be claimed
         too or the BROWSER also acts on it in this window — Ctrl+R would reload the popout out from
         under the keys (PF L793-795). */
      if (s.defaultPrevented && typeof e.preventDefault === "function") e.preventDefault();
    } catch (err) { /* app gone — nothing to forward to */ }
  };
  /* bind ONCE per document, replacing any previous pair: a re-mounted reused window kept its earlier
     forwarders, so one keystroke reached the app N times and every TOGGLE ran an even number of
     times — i.e. did nothing. A leftover pair from a previous app load points at a dead realm and
     must be replaced too (PF L798-807). */
  if (doc.__avFwd) {
    try { doc.removeEventListener("keydown", doc.__avFwd.kd); doc.removeEventListener("keyup", doc.__avFwd.ku); }
    catch (e) { /* gone with the doc */ }
  }
  const kd = fwd("keydown"), ku = fwd("keyup");
  doc.__avFwd = { kd, ku };
  doc.addEventListener("keydown", kd);
  doc.addEventListener("keyup", ku);
  /* a popout the user closes with its own ✕ (or the OS) must hand the bed back at once rather than
     waiting for the poll: the page leaves while the node is still in this document (PF L808-811) */
  const farewell = () => { if (avKbPopWin === win) avKbPopHome(true); };
  try { win.addEventListener("pagehide", farewell); win.addEventListener("beforeunload", farewell); }
  catch (e) { /* the poll still catches it */ }
  avKbPopEls = { bar, win: winLbl, arm, hint, doc };
  avKbPopMirror();   /* chrome fresh — paint the current state; the E-kb5 hook repaints on refresh */
  return avKbPopEls;
}

/* ---------- open / home (PF L834-915, L917-952 adapted to the {via,error} contract) ---------- */

async function avKbPopOpen(opts) {
  const o = opts || {};
  if (typeof document === "undefined") return { via: null, error: "no document (headless)" };
  /* a dead shell must come home before anything else proceeds (PF L919-922 law) */
  if (!avKbPopAlive() && document.body.classList.contains("piano-pop")) avKbPopHome();
  if (avKbPopAlive()) {
    try { avKbPopWin.focus(); } catch (e) { /* gone */ }
    return { via: avKbPopVia || "window" };
  }
  if (document.body.classList.contains("piano-closed") && typeof avPianoSetOpen === "function") avPianoSetOpen(true);
  const keysBox = avKbPopEnsureBed();
  if (!keysBox) return { via: null, error: "no piano dock — nothing to pop out" };
  const r = avKbPopRect();
  let win = null, pipMode = false;
  if (o.pip !== false && avKbPopPiPAvailable()) {
    try {
      win = await window.documentPictureInPicture.requestWindow({ width: r.width, height: r.height });
      /* A resolve is not a window: accept only a live, CURRENT PiP window; anything else is an
         impostor (Electron answers with an object born dead) and hands the job to the named
         popup (PF L843-852). */
      if (!win || win.closed || window.documentPictureInPicture.window !== win) win = null;
      pipMode = !!win;
    } catch (e) { win = null; pipMode = false; }
  }
  if (!win) {
    /* '' — NOT about:blank: a window LEFT OVER from an earlier popout is reused by name, and opening
       a URL in it NAVIGATES it — anything appended before the navigation commits is wiped, which
       reads as a silent no-op that then blocks every later attempt (PF L856-862). */
    win = window.open("", AV_KB_POP_WIN_NAME,
      "popup=yes,width=" + r.width + ",height=" + r.height + ",left=" + r.left + ",top=" + r.top);
    if (!win) return { via: null,
      error: "the browser blocked the keyboard window — allow popups for this page and try ⧉ again" };
  }
  /* the reused window may belong to ANOTHER Anvil tab (a shared browsing context group): the wipe
     below destroys whatever bed that tab adopted, so ownership is stamped and honoured — our own
     leftover (the token survives OUR reload) is reclaimed; a foreign one is left strictly alone and
     the pop is refused (PF L872-883). */
  let foreign = false;
  try {
    if (win.document && win.document.getElementById("pk-pop-bar") && win.__avKeysOwner
      && win.__avKeysOwner !== avKbPopToken()) foreign = true;
  } catch (e) { /* fresh doc */ }
  if (foreign) return { via: null,
    error: "the keyboard window is in use by another Anvil tab — dock its keys there first" };
  avKbPopWin = win;
  avKbPopVia = pipMode ? "dpip" : "window";
  try { win.__avKeysOwner = avKbPopToken(); } catch (e) { /* cosmetic */ }
  if (!pipMode) { try { win.moveTo(r.left, r.top); win.resizeTo(r.width, r.height); } catch (e) { /* refused */ } }
  try { if (win.document && win.document.getElementById("pk-pop-bar")) win.document.body.textContent = ""; }
  catch (e) { /* fresh doc */ }
  avKbPopMount(win);
  document.body.classList.add("piano-pop");
  win.document.body.appendChild(keysBox);   /* ADOPT the live bed — its handlers ride with it (PF L900) */
  avKbPopWatchStart();
  if (typeof avPianoRefresh === "function") avPianoRefresh();
  avKbPopMirror();                          /* belt: the E-kb5 hook covers later refreshes */
  avKbPopSaveRect(win);
  try { win.focus(); } catch (e) { /* fine */ }
  return { via: avKbPopVia };
}

/* bring the bed home + close the window; idempotent, safe when the window died. The app's OWN state
   is the body class — the window handle can be gone without a close ever running (a renderer death
   that reports the window as closed); gating on the handle alone left a dead ⧉ BACK and a
   keyboard-less band with no way home (PF L917-922). fromWin: the popout is already leaving
   (pagehide) — do not call win.close() on it. */
function avKbPopHome(fromWin) {
  if (typeof document === "undefined") return false;
  const win = avKbPopWin;
  if (!win && !document.body.classList.contains("piano-pop")) return false;
  avKbPopWin = null;                 /* first: nothing below may still treat the bed as out */
  avKbPopVia = null;
  avKbPopWatchStop();
  if (win) avKbPopSaveRect(win);     /* measured while the window still exists (pagehide), so a size
                                        the user chose there survives its own ✕ (PF L924-925) */
  let keysBox = null;
  if (win) { try { keysBox = win.document.getElementById("piano-keys"); } catch (e) { /* window died with the bed inside */ } }
  const dock = document.getElementById("piano-dock");
  if (keysBox && dock) dock.appendChild(keysBox);   /* the bed comes home (its old slot, after the rail) */
  document.body.classList.remove("piano-pop");
  avKbPopEnsureBed();                /* a renderer that died without pagehide took the node: rebuild it (PF L931) */
  try { if (typeof avNoteStopAll === "function") avNoteStopAll(); avPianoMouseDown = false; }
  catch (e) { /* a note held in a dead window must not drone (PF L932) */ }
  avKbPopEls = null;
  if (!fromWin && win) { try { win.close(); } catch (e) { /* already gone */ } }
  if (typeof avPianoRefresh === "function") avPianoRefresh();
  return true;
}

/* ---------- mirror + state surface (PF L394-409; E-kb4/E-kb5 hooks) ---------- */

/* the popout mirrors the app's state: the window readout, the ARM lamp, the bar hint and the popout
   body's own classes (ARM glow / MIDI tint read straight off the imported sheet). Called by the
   parent's avPianoRefresh (E-kb5) and by the flows here. Guarded: never throws. */
function avKbPopMirror() {
  if (!avKbPopEls) return;
  try {
    let wl = null;
    try { const el = document.getElementById("pk-win"); if (el) wl = el.textContent; } catch (e) { /* no app doc */ }
    if (!wl) {
      const nm = (typeof avNoteName === "function") ? avNoteName(AV_PIANO_LO + avPianoWin * 12) : "";
      wl = "OCT " + String(nm).toUpperCase();
    }
    if (avKbPopEls.win) avKbPopEls.win.textContent = wl;
    if (avKbPopEls.arm) {
      avKbPopEls.arm.classList.toggle("on", !!avArmed);
      avKbPopEls.arm.setAttribute("aria-pressed", avArmed ? "true" : "false");
    }
    if (avKbPopEls.hint) avKbPopEls.hint.textContent = avArmed ? AV_KB_POP_HINT_ARMED : AV_KB_POP_HINT_IDLE;
    const b = avKbPopEls.doc && avKbPopEls.doc.body;
    if (b) {
      b.classList.toggle("kb-armed", !!avArmed);
      b.classList.toggle("kb-midi", avInputMode === "midi");
    }
  } catch (e) { /* popout gone mid-refresh */ }
}

/* keys are out: the handle is live, or the app still believes they are out (class set before the
   poll homes it) */
function avKbPopIsOut() {
  if (avKbPopAlive()) return true;
  try { return typeof document !== "undefined" && document.body.classList.contains("piano-pop"); }
  catch (e) { return false; }
}

/* the app-side hint copy while the keys are out; null at home (the parent's E-kb4 hook calls this) */
function avKbPopHint() {
  try { return (typeof document !== "undefined" && document.body.classList.contains("piano-pop")) ? AV_KB_POP_HINT : null; }
  catch (e) { return null; }
}

/* the whole popout state in one object — window.__avKbPop (suites + console) */
function avKbPopSnap() {
  let bed = false;
  try { const root = avKbPopKeysRoot(); bed = !!(root && root.getElementById && root.getElementById("piano-keys")); }
  catch (e) { bed = false; }
  return { out: avKbPopIsOut(), alive: avKbPopAlive(), via: avKbPopVia, inited: avKbPopInited, bed: bed };
}

/* ---------- init (PF L1279-1282; the parent adds the rail markup) ---------- */

function avKbPopInit() {
  if (typeof document === "undefined") return false;
  if (avKbPopInited) return true;    /* idempotent: never a second set of listeners */
  avKbPopInited = true;
  /* the rail buttons (parent markup, AFTER #pk-close): #pk-pop ⧉ pops out, #pk-return ⧉ BACK homes —
     bind when present, tolerate absence (a build without the markup must not throw) */
  const popBtn = document.getElementById("pk-pop");
  if (popBtn) popBtn.addEventListener("click", () => { avKbPopOpen(); });
  const retBtn = document.getElementById("pk-return");
  if (retBtn) retBtn.addEventListener("click", () => { avKbPopHome(); });
  return true;
}

/* ---------- debug/verify surface (guarded — parse-safe without a DOM) ---------- */

if (typeof window !== "undefined") {
  window.__avKbPop = {
    version: "S5",
    isOut: avKbPopIsOut,
    snap: avKbPopSnap,
    open: avKbPopOpen,
    home: avKbPopHome,
    hint: avKbPopHint,
    keysRoot: avKbPopKeysRoot,
  };
  if (window.__lastFwd == null) window.__lastFwd = 0;   /* the delivery witness starts at 0 */
}
