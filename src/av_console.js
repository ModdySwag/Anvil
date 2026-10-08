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
   lastAction(), transportToggle(), refresh(), stepPreset(), vu(), vuTick() }.

   R14 (additions only — the version stays r11.0, the R12 precedent): PRV/NXT keycaps appended to
   the deck after avc-rec call avConsolePresetStep(dir) — it steps the pack select's preset
   selection (bubbling 'change', so the existing delegated bank handler mirrors it) and applies
   the preset through avBankApplyPreset. The two-bar VU meter (.avc-vu, fills avc-vu-l / avc-vu-r)
   sits between the deck and the BPM window; avConsoleVuTick paints it from avTap.levels, driven
   by ONE flag-guarded rAF loop (avConsoleMeterStart). The proof object grows vu + step. */

"use strict";

const AV_CONSOLE_VERSION = "r11.0";

const avConsoleState = { ready: false, timer: 0, last: "", songOn: false, playOn: false, recOn: false, vuL: -1, vuR: -1, meterOn: false };

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

/* ---------- R14: preset step-and-apply (rides the bank API) ---------- */

function avConsolePresetStep(dir) {
  const d = (Number(dir) === -1) ? -1 : 1;
  const res = { applied: false, pack: null, index: -1, preset: null, reason: "" };
  try {
    if (typeof avBankPacks !== "function" || typeof avBankPresets !== "function" || typeof avBankApplyPreset !== "function") {
      res.reason = "no-bank-api";
    } else {
      const packs = avBankPacks() || [];
      if (!packs.length) {
        res.reason = "no-banks";
      } else {
        /* the pack: the pack select's pick, clamped into the installed list (else the first) */
        let pi = 0;
        try {
          const psel = document.querySelector("select.av-bank-pack");
          if (psel && isFinite(psel.selectedIndex)) pi = Math.round(Number(psel.selectedIndex));
        } catch (e1) { pi = 0; }
        if (!isFinite(pi) || pi < 0) pi = 0;
        if (pi >= packs.length) pi = packs.length - 1;
        const pack = packs[pi];
        const presets = (pack && pack.id != null) ? (avBankPresets(pack.id) || []) : [];
        if (!presets.length) {
          res.reason = "no-presets";
        } else {
          /* the current ordinal from the preset select's value; a bad read seeds the wrap edge */
          const n = presets.length;
          let sel = null, cur = NaN;
          try { sel = document.querySelector("select.av-bank-preset"); } catch (e2) { sel = null; }
          try { if (sel) cur = Math.round(Number(sel.value)); } catch (e3) { cur = NaN; }
          if (!isFinite(cur) || cur < 0 || cur >= n) cur = (d > 0) ? -1 : 0;
          const target = (cur + d + n) % n;
          /* sync the select so the existing delegated bank handler mirrors the step */
          try {
            if (sel && sel.value !== String(target)) {
              try { sel.value = String(target); } catch (e4) { /* value write refused */ }
              try { sel.dispatchEvent(new Event("change", { bubbles: true })); } catch (e5) { /* dispatch refused */ }
            }
          } catch (e6) { /* the sync is a nicety; the apply below rides the object */ }
          let obj = null;
          for (let i = 0; i < n; i++) { if (presets[i] && presets[i].i === target) { obj = presets[i]; break; } }
          if (!obj) obj = presets[target] || null;
          if (!obj) {
            res.reason = "no-presets";
          } else {
            res.pack = (pack && pack.id != null) ? pack.id : null;
            res.index = target;
            res.preset = (typeof obj.name === "string" && obj.name) ? obj.name : null;
            let ok = false;
            try { ok = avBankApplyPreset(obj) === true; } catch (e7) { ok = false; }
            res.applied = ok === true;
            if (!res.applied) res.reason = "refused";
          }
        }
      }
    }
  } catch (e) { /* never throws — the result reports what landed */ }
  /* ALWAYS: the lastAction + a repaint, refusal or not */
  avConsoleSetLast(d > 0 ? "preset-next" : "preset-prev");
  avConsoleRefresh();
  return res;
}

/* ---------- R14: the VU meter (fed by the master tap's levels) ---------- */

function avConsoleVuClamp(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function avConsoleVuTick() {
  try {
    if (typeof avTap === "undefined" || !avTap || !avTap.levels) return false;
    const lv = avConsoleVuClamp(avTap.levels.l);
    const rv = avConsoleVuClamp(avTap.levels.r);
    const fl = avConsoleEl("avc-vu-l");
    const fr = avConsoleEl("avc-vu-r");
    /* write ONLY when the value moved > 0.01 since the last paint (per bar) */
    if (fl && Math.abs(lv - avConsoleState.vuL) > 0.01) {
      fl.style.transform = "scaleY(" + lv.toFixed(3) + ")";
      avConsoleState.vuL = lv;
    }
    if (fr && Math.abs(rv - avConsoleState.vuR) > 0.01) {
      fr.style.transform = "scaleY(" + rv.toFixed(3) + ")";
      avConsoleState.vuR = rv;
    }
    return true;
  } catch (e) { return false; }
}

function avConsoleVuRead() {
  try {
    if (typeof avTap === "undefined" || !avTap || !avTap.levels) return null;
    return { l: avConsoleVuClamp(avTap.levels.l), r: avConsoleVuClamp(avTap.levels.r) };
  } catch (e) { return null; }
}

function avConsoleMeterStart() {
  if (avConsoleState.meterOn) return true;
  avConsoleState.meterOn = true;
  try {
    if (typeof requestAnimationFrame !== "function") { avConsoleState.meterOn = false; return false; }
    const frame = function () {
      try { avConsoleVuTick(); } catch (e) { /* a frame never throws */ }
      try { requestAnimationFrame(frame); } catch (e2) { avConsoleState.meterOn = false; }
    };
    requestAnimationFrame(frame);
    return true;
  } catch (e) { avConsoleState.meterOn = false; return false; }
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

/* set bpm through the app's OWN funnel (the seq branch: 20..300 + the delay mirror) */
function avConsoleBpmSet(v) {
  try {
    const n = Math.max(20, Math.min(300, Math.round(Number(v))));
    if (!isFinite(n)) return null;
    if (typeof avApplyParam === "function") avApplyParam("bpm", n);
    else if (typeof avParams !== "undefined" && avParams) avParams.bpm = n;
    avConsoleRefresh();
    return n;
  } catch (e) { return null; }
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

    /* R14: PRV/NXT step the pack's preset selection and apply it (the bank API) */
    deck.appendChild(avConsoleMkKey("avc-preset-prev", "PRV", "Previous preset (steps and applies)", function () { avConsolePresetStep(-1); }));
    deck.appendChild(avConsoleMkKey("avc-preset-next", "NXT", "Next preset (steps and applies)", function () { avConsolePresetStep(1); }));

    /* R14: the two-bar VU meter (built here, painted from avTap.levels by the meter loop) */
    const vu = document.createElement("div");
    vu.className = "avc-vu";
    vu.setAttribute("aria-hidden", "true");
    vu.innerHTML =
      '<span class="avc-vu-bar"><i class="avc-vu-fill" id="avc-vu-l"></i></span>' +
      '<span class="avc-vu-bar"><i class="avc-vu-fill" id="avc-vu-r"></i></span>';

    /* the BPM segment window */
    const bpm = document.createElement("div");
    bpm.className = "avc-window avc-bpm";
    bpm.innerHTML = '<span class="avc-bpm-lab">BPM</span><span id="avc-bpm-val" aria-label="Tempo">120</span>';
    /* R12: the BPM window is a live control — click top/bottom half to step, wheel, arrow keys */
    bpm.tabIndex = 0;
    bpm.setAttribute("role", "slider");
    bpm.setAttribute("aria-label", "Tempo - click top or bottom half to step, wheel, or arrow keys");
    bpm.title = "Tempo - click top/bottom half to step, wheel, or arrow keys (Shift = 10)";
    bpm.addEventListener("wheel", function (e) {
      try { e.preventDefault(); avConsoleBpmSet(avConsoleBpm() + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1)); } catch (e2) { /* ok */ }
    }, { passive: false });
    bpm.addEventListener("click", function (e) {
      try {
        const r = bpm.getBoundingClientRect();
        const top = (e.clientY - r.top) < r.height / 2;
        avConsoleBpmSet(avConsoleBpm() + (top ? 1 : -1));
      } catch (e2) { /* ok */ }
    });
    bpm.addEventListener("keydown", function (e) {
      try {
        const k = e.key;
        if (k !== "ArrowUp" && k !== "ArrowDown" && k !== "ArrowLeft" && k !== "ArrowRight") return;
        e.preventDefault();
        const d = (k === "ArrowUp" || k === "ArrowRight") ? 1 : -1;
        avConsoleBpmSet(avConsoleBpm() + d * (e.shiftKey ? 10 : 1));
      } catch (e2) { /* ok */ }
    });

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
    /* R19 owner clip (2026-10-09): the BPM + OLED pair rides in ONE centred console block
       ("centre this section") -- absolutely centred in the header at wide viewports so it never
       drifts with the side clusters (falls back to the flow position below 1520px). */
    const center = document.createElement("div");
    center.className = "avc-center";
    center.appendChild(bpm);
    center.appendChild(oled);
    if (anchor) {
      head.insertBefore(deck, anchor);
      head.insertBefore(vu, anchor);
      head.insertBefore(center, anchor);
    } else {
      head.appendChild(deck); head.appendChild(vu); head.appendChild(center);
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

    /* proof: ?avtest=1 ONLY, deferred so the host exists (never leaks onto the live page) */
    try {
      if (typeof avTestLine === "function" && typeof location !== "undefined" && /[?&]avtest=1/.test(String(location.search))) {
        setTimeout(function () { try { const p = avConsoleProof(); if (p) avTestLine(p, "av-consoletest"); } catch (e2) { /* ok */ } }, 0);
      }
    } catch (e) { /* proof is a nicety */ }

    /* R14: the VU meter's ONE rAF loop (flag-guarded; a frame never throws) */
    avConsoleMeterStart();

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
  let vu = false;
  try { vu = !!(avConsoleEl("avc-vu-l") && avConsoleEl("avc-vu-r")); } catch (e) { vu = false; }
  return "CONSOLE SELFTEST " + JSON.stringify({
    v: AV_CONSOLE_VERSION,
    ready: avConsoleState.ready === true,
    head: head,
    play: avConsoleState.playOn === true,
    rec: avConsoleState.recOn === true,
    last: avConsoleState.last,
    vu: vu,
    step: true,
  });
}

if (typeof window !== "undefined" && window) {
  try {
    window.__avConsole = {
      version: AV_CONSOLE_VERSION,
      init: function () { return avConsoleInit(); },
      lastAction: function () { return avConsoleState.last; },
      transportToggle: function () { return avConsoleTransportToggle(); },
      setBpm: function (v) { return avConsoleBpmSet(v); },
      bpm: function () { return avConsoleBpm(); },
      refresh: function () { return avConsoleRefresh(); },
      stepPreset: function (dir) { return avConsolePresetStep(dir); },
      vu: function () { return avConsoleVuRead(); },
      vuTick: function () { return avConsoleVuTick(); },
    };
  } catch (e) { /* no window - nothing to publish */ }
}

/* boot: self-init at parse time (the header + chips are already in the DOM above the script) */
try { avConsoleInit(); } catch (e) { /* console boots best-effort */ }
