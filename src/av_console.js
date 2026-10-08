/* Anvil — THE TRANSPORT CONSOLE (R11): the header rebuilt as a hardware-style digital console —
   brand plate, a transport key deck (PLAY/PAUSE · STOP · SONG · REC with LED dots), a BPM segment
   readout, and an OLED info window (pack / preset / engine / voices). Every existing header id is
   preserved (suites query ids, never order): av-word stays the logotype, #av-version moves into the
   plate, #av-tier + #av-voices MOVE into the OLED (their text updates are by id and keep landing),
   and every other header button (BROWSE / undo / redo / ABOUT / NAV / a11y / pwa / help / piano) is
   left exactly where it was — the console styles them as keycaps.

   Wiring rides existing guarded funnels only: avSeqPlay/avSeqStop/avSeqIsPlaying (seq transport),
   avSongPlay/avSongStop (song runner), avRecStart/avRecStop (the studio recorder). Space toggles
   the transport globally from av_kb.js (which calls avConsoleTransportToggle). Never throws.

   Public surface: avConsoleInit() -> bool · avConsoleTransportToggle() -> bool|null ·
   avConsoleRefresh() · avConsoleProof() -> string · window.__avConsole { version, init,
   lastAction(), transportToggle(), refresh() }. */

"use strict";

const AV_CONSOLE_VERSION = "r11.0";

const avConsoleState = { ready: false, timer: 0, last: "", songOn: false, playOn: false, recOn: false };

function avConsoleEl(id) {
  try { return document.getElementById(id); } catch (e) { return null; }
}
function avConsoleSetLast(a) { try { avConsoleState.last = String(a || ""); } catch (e) { /* ok */ } }

function avConsoleIsPlaying() {
  try { return (typeof avSeqIsPlaying === "function") ? avSeqIsPlaying() === true : false; } catch (e) { return false; }
}

/* the Space key + the PLAY key both land here: play what you see / stop */
function avConsoleTransportToggle() {
  try {
    if (avConsoleIsPlaying()) {
      if (typeof avSeqStop === "function") avSeqStop();
      avConsoleSetLast("stop");
      avConsoleRefresh();
      return false;
    }
    if (typeof avSeqPlay === "function") avSeqPlay();
    avConsoleSetLast("play");
    avConsoleRefresh();
    return true;
  } catch (e) { return null; }
}

function avConsoleSongToggle() {
  try {
    if (avConsoleState.songOn) {
      if (typeof avSongStop === "function") avSongStop();
      avConsoleState.songOn = false;
      avConsoleSetLast("song-stop");
    } else {
      if (typeof avSongPlay === "function") avSongPlay();
      avConsoleState.songOn = true;
      avConsoleSetLast("song-play");
    }
    avConsoleRefresh();
    return avConsoleState.songOn;
  } catch (e) { return null; }
}

function avConsoleRecToggle() {
  try {
    if (avConsoleState.recOn) {
      if (typeof avRecStop === "function") avRecStop();
      avConsoleSetLast("rec-stop");
    } else {
      if (typeof avRecStart === "function") avRecStart();
      avConsoleSetLast("rec-start");
    }
  } catch (e) { /* the recorder card reports its own errors */ }
  avConsoleRefresh();
  return avConsoleState.recOn;
}

/* ---------- the reads (polls) ---------- */

function avConsoleBankText() {
  try {
    const ps = document.querySelector("select.av-bank-pack");
    const pr = document.querySelector("select.av-bank-preset");
    const pt = (ps && ps.selectedIndex >= 0 && ps.options[ps.selectedIndex]) ? ps.options[ps.selectedIndex].textContent : "";
    const rt = (pr && pr.selectedIndex >= 0 && pr.options[pr.selectedIndex]) ? pr.options[pr.selectedIndex].textContent : "";
    return { pack: String(pt || "").trim() || "\u2014", preset: String(rt || "").trim() || "\u2014" };
  } catch (e) { return { pack: "\u2014", preset: "\u2014" }; }
}

function avConsoleBpm() {
  try {
    const v = (typeof avParams !== "undefined" && avParams) ? Number(avParams.bpm) : 120;
    return isFinite(v) ? Math.max(20, Math.min(300, Math.round(v))) : 120;
  } catch (e) { return 120; }
}

/* one refresh pass: LEDs + readouts. Called by the 400 ms interval + after every action. */
function avConsoleRefresh() {
  try {
    const play = avConsoleEl("avc-play");
    const rec = avConsoleEl("avc-rec");
    const song = avConsoleEl("avc-song");
    const power = avConsoleEl("avc-power");
    const bpmEl = avConsoleEl("avc-bpm-val");
    const packEl = avConsoleEl("avc-pack");
    const presetEl = avConsoleEl("avc-preset");
    const playing = avConsoleIsPlaying();
    if (playing !== avConsoleState.playOn) {
      avConsoleState.playOn = playing;
      if (play) {
        play.classList.toggle("on", playing);
        play.textContent = playing ? "\u275A\u275A PAUSE" : "\u25B6 PLAY";
        play.setAttribute("aria-label", playing ? "Pause (Space)" : "Play (Space)");
      }
    }
    /* the recorder LED mirrors the REAL recorder state when the card exposes it (.av-rec-on) */
    let recOn = avConsoleState.recOn;
    try {
      const cardRec = document.querySelector(".av-rec-on");
      if (cardRec) recOn = true;
      else if (document.querySelector(".av-rec-btn")) recOn = false;
    } catch (e) { /* card not mounted: keep the local flag */ }
    if (recOn !== avConsoleState.recOn) {
      avConsoleState.recOn = recOn;
      if (rec) rec.classList.toggle("on", recOn);
    }
    if (song) song.classList.toggle("on", avConsoleState.songOn === true);
    if (power) {
      let engReady = false;
      try { engReady = !!(window.__avEngine && window.__avEngine.ready); } catch (e2) { engReady = false; }
      power.classList.toggle("on", engReady);
    }
    if (bpmEl) {
      const b = String(avConsoleBpm());
      if (bpmEl.textContent !== b) bpmEl.textContent = b;
    }
    if (packEl || presetEl) {
      const bt = avConsoleBankText();
      if (packEl && packEl.textContent !== bt.pack) packEl.textContent = bt.pack;
      if (presetEl && presetEl.textContent !== bt.preset) presetEl.textContent = bt.preset;
    }
    return true;
  } catch (e) { return false; }
}

/* ---------- the build (idempotent; appends into header.av-head, moves nothing but the chips) ---------- */

function avConsoleMkKey(id, label, aria, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.id = id;
  b.className = "avc-key";
  b.textContent = label;
  b.setAttribute("aria-label", aria);
  b.title = aria;
  b.addEventListener("click", function () { try { fn(); } catch (e) { /* key never throws */ } });
  return b;
}

function avConsoleInit() {
  try {
    if (avConsoleState.ready) return true;
    if (typeof document === "undefined" || !document) return false;
    const head = document.querySelector("header.av-head");
    if (!head) return false;
    if (avConsoleEl("avc-play")) { avConsoleState.ready = true; return true; }
    head.classList.add("av-console");

    /* the transport deck */
    const deck = document.createElement("div");
    deck.className = "avc-transport";
    deck.setAttribute("role", "group");
    deck.setAttribute("aria-label", "Transport");
    deck.appendChild(avConsoleMkKey("avc-play", "\u25B6 PLAY", "Play / pause (Space)", avConsoleTransportToggle));
    deck.appendChild(avConsoleMkKey("avc-stop", "\u25A0 STOP", "Stop the transport", function () {
      try { if (typeof avSeqStop === "function") avSeqStop(); } catch (e) { /* ok */ }
      try { if (typeof avSongStop === "function" && avConsoleState.songOn) avSongStop(); } catch (e) { /* ok */ }
      avConsoleState.songOn = false;
      avConsoleSetLast("stop");
      avConsoleRefresh();
    }));
    deck.appendChild(avConsoleMkKey("avc-song", "SONG", "Play / stop the song arrangement", avConsoleSongToggle));
    deck.appendChild(avConsoleMkKey("avc-rec", "\u25CF REC", "Record (studio recorder)", avConsoleRecToggle));

    /* the BPM segment window */
    const bpm = document.createElement("div");
    bpm.className = "avc-window avc-bpm";
    bpm.innerHTML = '<span class="avc-bpm-lab">BPM</span><span id="avc-bpm-val" aria-label="Tempo">120</span>';

    /* the OLED info window: PACK / PRESET + the moved engine/voices chips */
    const oled = document.createElement("div");
    oled.className = "avc-window avc-oled";
    oled.setAttribute("aria-label", "Console readouts");
    oled.innerHTML =
      '<div class="avc-oled-row"><span class="avc-oled-lbl">PACK</span><span class="avc-val" id="avc-pack">\u2014</span></div>' +
      '<div class="avc-oled-row"><span class="avc-oled-lbl">PRESET</span><span class="avc-val" id="avc-preset">\u2014</span></div>' +
      '<div class="avc-oled-row avc-oled-sys" id="avc-sys"></div>';

    /* the power LED next to the logotype */
    const power = document.createElement("span");
    power.className = "avc-ledbig";
    power.id = "avc-power";
    power.setAttribute("aria-hidden", "true");

    const word = head.querySelector(".av-word");
    if (word && word.parentNode !== head) { try { head.insertBefore(word, head.firstChild); } catch (e) { /* ok */ } }
    const spacer = head.querySelector(".av-spacer");
    const anchor = (spacer && spacer.parentNode === head) ? spacer : null;
    if (anchor) {
      head.insertBefore(deck, anchor);
      head.insertBefore(bpm, anchor);
      head.insertBefore(oled, anchor);
    } else {
      head.appendChild(deck); head.appendChild(bpm); head.appendChild(oled);
    }
    if (word) { try { head.insertBefore(power, word.nextSibling); } catch (e) { head.insertBefore(power, head.firstChild); } }
    else head.insertBefore(power, head.firstChild);

    /* move the engine + voices chips into the OLED sys row (ids preserved; text updates by id) */
    try {
      const sys = avConsoleEl("avc-sys");
      const tier = avConsoleEl("av-tier");
      const voices = avConsoleEl("av-voices");
      if (sys && tier) sys.appendChild(tier);
      if (sys && voices) sys.appendChild(voices);
    } catch (e) { /* chips stay wherever they are — the console still works */ }

    /* one interval for every poll; never duplicated */
    if (!avConsoleState.timer) {
      try { avConsoleState.timer = setInterval(avConsoleRefresh, 400); } catch (e) { avConsoleState.timer = 0; }
    }

    /* proof (readable at ?avtest=1 via the house helper when present) */
    try {
      if (typeof avTestLine === "function") { const p = avConsoleProof(); if (p) avTestLine(p, "av-consoletest"); }
    } catch (e) { /* proof is a nicety */ }

    avConsoleRefresh();
    avConsoleState.ready = true;
    return true;
  } catch (e) {
    console.warn("[anvil] console init failed", e);
    return false;
  }
}

function avConsoleProof() {
  let head = false;
  try { head = document.querySelector("header.av-head.av-console") !== null; } catch (e) { head = false; }
  return "CONSOLE SELFTEST " + JSON.stringify({
    v: AV_CONSOLE_VERSION,
    ready: avConsoleState.ready === true,
    head: head,
    play: avConsoleState.playOn === true,
    rec: avConsoleState.recOn === true,
    last: avConsoleState.last,
  });
}

if (typeof window !== "undefined" && window) {
  try {
    window.__avConsole = {
      version: AV_CONSOLE_VERSION,
      init: function () { return avConsoleInit(); },
      lastAction: function () { return avConsoleState.last; },
      transportToggle: function () { return avConsoleTransportToggle(); },
      refresh: function () { return avConsoleRefresh(); },
    };
  } catch (e) { /* no window - nothing to publish */ }
}

/* boot: self-init at parse time (the header + chips are already in the DOM above the script) */
try { avConsoleInit(); } catch (e) { /* console boots best-effort */ }
