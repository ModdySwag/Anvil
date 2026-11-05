/* Anvil - THE HEADER BAND (C1 sec 2.1): avConsoleBuild() emits the whole top band - one #av-band
   with five groups in hardware order: transport | identity | pots | view | out. It replaces the
   R11 console shell (deck / OLED / centred block are gone); the version string stays r11.0 because
   the public surface does not move.

   transport  avc-play avc-stop (large) + avc-song avc-rec avc-preset-prev avc-preset-next (mini),
              the R14 preset step-and-apply kept. Space still toggles through avConsoleTransportToggle
              (av_kb.js).
   identity   the Anvil logotype, #av-version, the master-volume pot (#av-vol-pot, path "master" -
              the same path the LEVELS card binds), #av-vol-val, the LCD (#av-lcd) with pack / preset
              slots that WRAP the bank's own selects (#avc-pack / #avc-preset, ids assigned here),
              an engine line, the edited dot and the poly readout, plus the avc-bpm slider (role
              =slider, click halves / wheel / arrows, funnel avApplyParam('bpm')). #av-tier and
              #av-voices move into the LCD's engine row by id.
   pots       #av-potmode tone|macros radios; TONE binds env1.a / env1.r / filter.cutoff / filter.reso
              (av_synth.js), MACROS binds mod.macro1..4 (av_mod.js). A mode switch rebuilds that one
              group; every build ends in avKnobBind.
   view       the eight av-head-* / av-help / a11y keys, placed only - av_chrome wires its own keys
              (it is asked to build them here) and av_a11y binds an existing node. #btn-piano rides
              along. A header MutationObserver re-homes late arrivals.
   out        #av-scope (120x40, avTap.levels or a flat baseline), #av-meter-l / #av-meter-r wrapping
              the avc-vu-l / avc-vu-r bars the VU meter writes, #av-panic (avNoteStopAll) and
              #av-learn (avMidiLearnArm), both typeof-guarded.

   Public surface: avConsoleInit() -> bool * avConsoleTransportToggle() -> bool|null *
   avConsoleRefresh() * avConsoleProof() -> string * window.__avConsole { version, init,
   lastAction(), transportToggle(), setBpm, bpm, refresh(), stepPreset(), potMode(), potBank(),
   scope(), vu(), vuTick() }.

   R14 (kept): PRV/NXT step the pack select's preset and apply it through avBankApplyPreset; the VU
   meter is painted from avTap.levels by ONE flag-guarded rAF loop, which also repaints the scope. */

"use strict";

const AV_CONSOLE_VERSION = "r11.0";

const avConsoleState = { ready: false, timer: 0, last: "", songOn: false, playOn: false, recOn: false, vuL: -1, vuR: -1, meterOn: false, pots: "tone", editedBound: false, obs: null, frame: 0 };

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
  } catch (e) { /* never throws - the result reports what landed */ }
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
      /* the scope repaints every 3rd frame - a 120x40 strip needs nothing faster */
      avConsoleState.frame = (avConsoleState.frame + 1) % 3;
      if (!avConsoleState.frame) { try { avConsoleScopePaint(); } catch (e3) { /* ok */ } }
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
    /* the pack/preset slots WRAP the selects - only write text when no select lives inside */
    if (packEl || presetEl) {
      const bt = avConsoleBankText();
      if (packEl && !(packEl.querySelector && packEl.querySelector("select")) && packEl.textContent !== bt.pack) packEl.textContent = bt.pack;
      if (presetEl && !(presetEl.querySelector && presetEl.querySelector("select")) && presetEl.textContent !== bt.preset) presetEl.textContent = bt.preset;
    }
    /* the engine text + the poly readout (best-effort reads; a dash when the host has nothing) */
    const engEl = avConsoleEl("av-lcd-engine");
    if (engEl) {
      let kind = "";
      try { kind = (typeof avParams !== "undefined" && avParams && avParams["engine.kind"]) ? String(avParams["engine.kind"]) : ""; } catch (e3) { kind = ""; }
      if (kind && engEl.textContent !== kind) engEl.textContent = kind;
    }
    /* the bank card may render (or re-render) its selects after the band was built: pull them in */
    try {
      const packSlot = avConsoleEl("av-lcd-pack");
      const presetSlot = avConsoleEl("av-lcd-preset");
      if (packSlot && !packSlot.querySelector("select")) {
        const s = document.querySelector("select.av-bank-pack");
        if (s) { s.id = "avc-pack"; packSlot.appendChild(s); }
      }
      if (presetSlot && !presetSlot.querySelector("select")) {
        const s2 = document.querySelector("select.av-bank-preset");
        if (s2) { s2.id = "avc-preset"; presetSlot.appendChild(s2); }
      }
    } catch (e6) { /* the card keeps its own row */ }
    /* the LEARN key mirrors the MIDI arm state */
    const learnEl = avConsoleEl("av-learn");
    if (learnEl) {
      let armed = false;
      try { armed = (typeof avMidiLearn !== "undefined" && avMidiLearn) ? avMidiLearn.armed === true : false; } catch (e5) { armed = false; }
      if (learnEl.classList.contains("on") !== armed) learnEl.classList.toggle("on", armed);
      learnEl.setAttribute("aria-pressed", armed ? "true" : "false");
    }
    const polyEl = avConsoleEl("av-lcd-poly");
    if (polyEl) {
      let n = NaN;
      try { n = (window.__avEngine && typeof window.__avEngine.voices === "number") ? window.__avEngine.voices : NaN; } catch (e4) { n = NaN; }
      const txt = "POLY " + (isFinite(n) ? String(Math.max(0, Math.round(n))) : "-");
      if (polyEl.textContent !== txt) polyEl.textContent = txt;
    }
    return true;
  } catch (e) { return false; }
}

/* ---------- the build (C1 sec 2.1: the header band) ----------
   One container #av-band inside header.av-head, five groups in hardware order
   transport | identity | pots | view | out. Known ids are ADOPTED, never rebuilt: the transport
   keys, the pack/preset selects, the view keys (their own script wires those), the a11y keys,
   av-word / av-version / av-tier / av-voices, and the two VU bars (the meter writes them by id).
   Nothing here throws. */

function avConsoleMkKey(id, label, aria, fn, cls) {
  const b = document.createElement("button");
  b.type = "button";
  b.id = id;
  b.className = "av-btn " + (cls || "mini") + " avc-key";
  b.textContent = label;
  b.setAttribute("aria-label", aria);
  b.title = aria;
  b.addEventListener("click", function () { try { fn(); } catch (e) { /* key never throws */ } });
  return b;
}

/* view keys: id -> [label, aria]. av-head-* are created by av_chrome (it skips an id that already
   exists, so the band only PLACES them); the a11y keys are created here because av_a11y binds an
   existing node; av-help / btn-piano already exist in the markup. */
const AV_CONSOLE_VIEW_KEYS = [
  ["av-head-browse", "BROWSE", "Browse packs and presets"],
  ["av-head-undo", "\u21B6", "Undo"],
  ["av-head-redo", "\u21B7", "Redo"],
  ["av-head-about", "ABOUT", "About this build"],
  ["av-head-rail", "NAV", "Module navigator"],
  ["av-help", "?", "Help"],
  ["av-a11y-contrast", "CONTRAST", "High contrast"],
  ["av-a11y-motion", "MOTION", "Reduce motion"],
  ["btn-piano", "\uD83C\uDFB9", "Piano dock"]
];

/* the two pot banks. TONE rides the live voice paths (av_synth.js): env1.a / env1.r /
   filter.cutoff / filter.reso. MACROS rides av_mod.js's knob paths mod.macro1..4
   (AV_MOD_MACRO_PREFIX). */
const AV_CONSOLE_POTS = {
  tone: [
    { slot: "a", path: "env1.a", label: "ATTACK", opts: { min: 0.001, max: 4, step: 0.001, def: 0.002, curve: "log", fmt: "ms" } },
    { slot: "b", path: "env1.r", label: "RELEASE", opts: { min: 0.001, max: 8, step: 0.001, def: 0.2, curve: "log", fmt: "ms" } },
    { slot: "c", path: "filter.cutoff", label: "CUTOFF", opts: { min: 20, max: 20000, step: 1, def: 800, curve: "log", fmt: "hz" } },
    { slot: "d", path: "filter.reso", label: "RESO", opts: { min: 0, max: 1, step: 0.01, def: 0.3, fmt: "pct" } }
  ],
  macros: [
    { slot: "a", path: "mod.macro1", label: "MAC 1", opts: { min: 0, max: 1, step: 0.01, def: 0, fmt: "pct" } },
    { slot: "b", path: "mod.macro2", label: "MAC 2", opts: { min: 0, max: 1, step: 0.01, def: 0, fmt: "pct" } },
    { slot: "c", path: "mod.macro3", label: "MAC 3", opts: { min: 0, max: 1, step: 0.01, def: 0, fmt: "pct" } },
    { slot: "d", path: "mod.macro4", label: "MAC 4", opts: { min: 0, max: 1, step: 0.01, def: 0, fmt: "pct" } }
  ]
};

/* the MOD card's state object - absent means the macro paths have nothing behind them */
function avConsoleHasMod() {
  try { return typeof avModState !== "undefined" && avModState !== null; } catch (e) { return false; }
}

function avConsoleMkGroup(grp, aria) {
  const g = document.createElement("div");
  g.className = "av-band-grp av-band-" + grp;
  g.dataset.grp = grp;
  g.setAttribute("role", "group");
  g.setAttribute("aria-label", aria);
  return g;
}

/* adopt the element with this id into `parent` (keeps its own handlers); null when it is not there
   yet - the observer re-homes a late arrival */
function avConsoleAdopt(parent, id) {
  try {
    const have = avConsoleEl(id);
    if (!have) return null;
    if (have.parentNode !== parent) parent.appendChild(have);
    return have;
  } catch (e) { return null; }
}

/* a readout line bound to a knob path (av_knob.js keeps every [data-kval] in sync) */
function avConsoleNumLine(path) {
  const d = document.createElement("div");
  d.className = "av-band-num";
  d.setAttribute("data-kval", path);
  d.setAttribute("aria-hidden", "true");
  return d;
}

/* the transport cluster - large PLAY / STOP, mini SONG / REC / PRV / NXT (ids + handlers kept) */
function avConsoleFillTransport(g) {
  const deck = document.createElement("div");
  deck.className = "av-band-transport";
  deck.appendChild(avConsoleMkKey("avc-play", "\u25B6 PLAY", "Play / pause (Space)", avConsoleTransportToggle, "av-band-big"));
  deck.appendChild(avConsoleMkKey("avc-stop", "\u25A0 STOP", "Stop the transport", function () {
    try { if (typeof avSeqStop === "function") avSeqStop(); } catch (e) { /* ok */ }
    try { if (typeof avSongStop === "function" && avConsoleState.songOn) avSongStop(); } catch (e) { /* ok */ }
    avConsoleState.songOn = false;
    avConsoleSetLast("stop");
    avConsoleRefresh();
  }, "av-band-big"));
  deck.appendChild(avConsoleMkKey("avc-song", "SONG", "Play / stop the song arrangement", avConsoleSongToggle));
  deck.appendChild(avConsoleMkKey("avc-rec", "\u25CF REC", "Record (studio recorder)", avConsoleRecToggle));
  deck.appendChild(avConsoleMkKey("avc-preset-prev", "PRV", "Previous preset (steps and applies)", function () { avConsolePresetStep(-1); }));
  deck.appendChild(avConsoleMkKey("avc-preset-next", "NXT", "Next preset (steps and applies)", function () { avConsolePresetStep(1); }));
  g.appendChild(deck);
}

/* the pot bank - rebuilt in place on a mode switch (that group only) */
function avConsoleFillPots(g) {
  g.innerHTML = "";
  const mode = (avConsoleState.pots === "macros") ? "macros" : "tone";
  const hasMod = avConsoleHasMod();

  const keys = document.createElement("div");
  keys.className = "av-potmode";
  keys.id = "av-potmode";
  keys.setAttribute("role", "radiogroup");
  keys.setAttribute("aria-label", "Pot bank");
  const mkMode = function (id, label, value, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.id = id;
    b.className = "av-btn mini";
    b.textContent = label;
    b.title = title;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", (mode === value) ? "true" : "false");
    b.addEventListener("click", function () { avConsolePotMode(value); });
    return b;
  };
  keys.appendChild(mkMode("av-potmode-tone", "TONE", "tone", "Pots: attack / release / cutoff / reso"));
  const mk = mkMode("av-potmode-macros", "MACROS", "macros", "Pots: macros 1-4 (the MOD card)");
  if (!hasMod) mk.title = "Pots: macros 1-4 (the MOD card - not loaded yet)";
  keys.appendChild(mk);
  g.appendChild(keys);

  const list = AV_CONSOLE_POTS[mode];
  for (let i = 0; i < list.length; i++) {
    const spec = list[i];
    const cell = document.createElement("div");
    cell.className = "av-band-pot";
    const lab = document.createElement("div");
    lab.className = "av-band-pot-label";
    lab.textContent = spec.label;
    cell.appendChild(lab);
    const mount = document.createElement("div");
    mount.id = "av-pot-" + spec.slot;
    mount.className = "av-band-mount";
    if (mode === "macros" && !hasMod) {
      mount.innerHTML = '<span class="av-band-gap" aria-hidden="true">\u2014</span>';
    } else {
      try {
        const live = (typeof avParams !== "undefined" && avParams) ? avParams[spec.path] : undefined;
        mount.innerHTML = avKnobHTML(spec.path, spec.label, Object.assign({ value: (typeof live === "number") ? live : spec.opts.def }, spec.opts));
      } catch (e) { mount.innerHTML = '<span class="av-band-gap" aria-hidden="true">\u2014</span>'; }
    }
    cell.appendChild(mount);
    cell.appendChild(avConsoleNumLine(spec.path));
    g.appendChild(cell);
  }
  try { avKnobBind(g); } catch (e) { /* the pots stay readable */ }
}

/* mode switch: rebuild the pots group only */
function avConsolePotMode(mode) {
  const next = (mode === "macros") ? "macros" : "tone";
  if (avConsoleState.pots === next) return next;
  avConsoleState.pots = next;
  try {
    const g = document.querySelector('#av-band .av-band-grp[data-grp="pots"]');
    if (g) avConsoleFillPots(g);
  } catch (e) { /* rebuilt on the next build */ }
  avConsoleSetLast("pots-" + next);
  return next;
}

/* the scope: 120x40, a flat baseline at rest, otherwise the master tap's levels */
function avConsoleScopePaint() {
  try {
    const cv = avConsoleEl("av-scope");
    if (!cv || typeof cv.getContext !== "function") return false;
    const ctx = cv.getContext("2d");
    if (!ctx) return false;
    const w = cv.width || 120, h = cv.height || 40, mid = h / 2;
    ctx.clearRect(0, 0, w, h);
    let l = 0, r = 0;
    try {
      if (typeof avTap !== "undefined" && avTap && avTap.levels) {
        l = avConsoleVuClamp(avTap.levels.l);
        r = avConsoleVuClamp(avTap.levels.r);
      }
    } catch (e) { l = 0; r = 0; }
    ctx.strokeStyle = "rgba(46,216,201,0.35)";
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();
    if (l > 0.001 || r > 0.001) {
      /* one trace, its height driven by the two bars (no per-sample buffer is tapped here) */
      const span = Math.max(0.001, (l + r) / 2);
      ctx.strokeStyle = "#2ed8c9";
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const t = x / (w - 1);
        const y = mid - (Math.sin(t * Math.PI * 2) * span * (mid - 2));
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    return true;
  } catch (e) { return false; }
}

function avConsoleBuild(head) {
  /* keep the live version text across a rebuild (the old band is dropped below) */
  let verText = "";
  try { const v0 = head.querySelector("#av-version"); verText = v0 ? String(v0.textContent || "") : ""; } catch (e) { verText = ""; }
  try { const old = avConsoleEl("av-band"); if (old && old.parentNode) old.parentNode.removeChild(old); } catch (e) { /* rebuilt below */ }
  head.classList.add("av-console");

  const band = document.createElement("div");
  band.id = "av-band";
  band.className = "av-band";

  /* 1 - transport, 3 - pots: each group is built whole, then appended in contract order */
  const gTransport = avConsoleMkGroup("transport", "Transport");
  avConsoleFillTransport(gTransport);
  const gPots = avConsoleMkGroup("pots", "Pots");
  avConsoleFillPots(gPots);

  /* 2 - identity: plate, volume pot, the LCD */
  const ident = avConsoleMkGroup("identity", "Anvil identity and readouts");
  const plate = document.createElement("div");
  plate.className = "av-band-plate";
  const word = head.querySelector(".av-word");
  const wordEl = document.createElement("span");
  wordEl.className = "av-word";
  wordEl.textContent = "Anvil";
  plate.appendChild(wordEl);
  try { if (word && word.parentNode) word.parentNode.removeChild(word); } catch (e) { /* the fresh one stands */ }

  /* #av-version: the markup carries one - keep its text, drop the old node (never two ids) */
  const ver = document.createElement("span");
  ver.className = "av-chip av-hot";
  ver.id = "av-version";
  ver.textContent = verText || "v0.1.0";
  plate.appendChild(ver);
  try {
    const oldVer = avConsoleEl("av-version");
    if (oldVer && oldVer !== ver) {
      ver.textContent = oldVer.textContent || ver.textContent;
      if (oldVer.parentNode) oldVer.parentNode.removeChild(oldVer);
    }
  } catch (e) { /* the fresh chip stands */ }

  /* the power LED (avConsoleRefresh keeps its .on state) */
  const power = document.createElement("span");
  power.className = "avc-ledbig";
  power.id = "avc-power";
  power.setAttribute("aria-hidden", "true");
  plate.appendChild(power);
  ident.appendChild(plate);

  /* the volume pot - the SAME master path the LEVELS card binds (app_core.js) */
  const vol = document.createElement("div");
  vol.className = "av-band-pot av-band-vol";
  const volMount = document.createElement("div");
  volMount.id = "av-vol-pot";
  volMount.className = "av-band-mount";
  let volLive = 0.8;
  try { if (typeof avState !== "undefined" && avState && isFinite(Number(avState.master))) volLive = Number(avState.master); } catch (e) { volLive = 0.8; }
  try {
    volMount.innerHTML = avKnobHTML("master", "VOL", { min: 0, max: 1.2, step: 0.01, def: 0.8, value: volLive, fmt: "pct", size: "sm", w: 40 });
  } catch (e) { /* the readout still shows */ }
  const volVal = avConsoleNumLine("master");
  volVal.id = "av-vol-val";
  vol.appendChild(volMount);
  vol.appendChild(volVal);
  try { if (typeof avKnobBind === "function") avKnobBind(volMount); } catch (e) { /* the pot stays readable */ }
  ident.appendChild(vol);

  /* the LCD glass: pack / preset / engine rows, the edited dot, the poly readout, the tempo */
  const lcd = document.createElement("div");
  lcd.id = "av-lcd";
  lcd.className = "av-band-lcd";
  lcd.setAttribute("aria-label", "Console readouts");

  const rowPack = document.createElement("div");
  rowPack.className = "av-lcd-row";
  const packLab = document.createElement("span");
  packLab.className = "av-lcd-lbl";
  packLab.textContent = "PACK";
  const packSlot = document.createElement("span");
  packSlot.id = "av-lcd-pack";
  packSlot.className = "av-lcd-slot";
  rowPack.appendChild(packLab);
  rowPack.appendChild(packSlot);
  lcd.appendChild(rowPack);

  const rowPreset = document.createElement("div");
  rowPreset.className = "av-lcd-row";
  const presetLab = document.createElement("span");
  presetLab.className = "av-lcd-lbl";
  presetLab.textContent = "PRESET";
  const presetSlot = document.createElement("span");
  presetSlot.id = "av-lcd-preset";
  presetSlot.className = "av-lcd-slot";
  rowPreset.appendChild(presetLab);
  rowPreset.appendChild(presetSlot);
  lcd.appendChild(rowPreset);

  const rowEng = document.createElement("div");
  rowEng.className = "av-lcd-row av-lcd-row-sys";
  const engLab = document.createElement("span");
  engLab.className = "av-lcd-lbl";
  engLab.textContent = "ENGINE";
  const eng = document.createElement("span");
  eng.id = "av-lcd-engine";
  eng.className = "av-lcd-slot";
  eng.textContent = "\u2014";
  const edited = document.createElement("span");
  edited.id = "av-lcd-edited";
  edited.className = "av-lcd-edited";
  edited.hidden = true;
  edited.setAttribute("aria-hidden", "true");
  edited.title = "edited since the preset loaded";
  const poly = document.createElement("span");
  poly.id = "av-lcd-poly";
  poly.className = "av-lcd-poly";
  poly.textContent = "POLY \u2014";
  rowEng.appendChild(engLab);
  rowEng.appendChild(eng);
  rowEng.appendChild(edited);
  rowEng.appendChild(poly);
  lcd.appendChild(rowEng);

  /* the tempo: avc-bpm keeps role=slider, click halves / wheel / arrows and the
     avApplyParam('bpm') funnel exactly as before */
  const rowBpm = document.createElement("div");
  rowBpm.className = "av-lcd-row av-lcd-row-bpm";
  const bpm = document.createElement("div");
  bpm.className = "avc-window avc-bpm";
  bpm.id = "avc-bpm";
  bpm.innerHTML = '<span class="avc-bpm-lab">BPM</span><span id="avc-bpm-val" aria-label="Tempo">120</span>';
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
  rowBpm.appendChild(bpm);
  lcd.appendChild(rowBpm);
  ident.appendChild(lcd);

  /* 4 - view: placement only. Ask av_chrome for its own keys first - it CREATES + wires them and
     skips ids that already exist, so the band never holds a dead BROWSE / UNDO key. */
  try { if (typeof avChromeBuildHeader === "function") avChromeBuildHeader(); } catch (e) { /* the observer re-homes them */ }
  const view = avConsoleMkGroup("view", "View");
  for (let i = 0; i < AV_CONSOLE_VIEW_KEYS.length; i++) {
    const id = AV_CONSOLE_VIEW_KEYS[i][0];
    const have = avConsoleEl(id);
    if (have) {
      if (!have.classList.contains("av-btn")) have.classList.add("av-btn");
      have.classList.add("mini");
      view.appendChild(have);
      continue;
    }
    /* only the a11y keys are safe to create here: av_a11y binds an existing node */
    if (id === "av-a11y-contrast" || id === "av-a11y-motion") {
      const spec = AV_CONSOLE_VIEW_KEYS[i];
      const b = document.createElement("button");
      b.type = "button";
      b.id = id;
      b.className = "av-btn mini av-a11y-btn";
      b.textContent = spec[1];
      b.setAttribute("aria-label", spec[2]);
      b.title = spec[2];
      view.appendChild(b);
    }
  }

  /* 5 - out: scope, meters, panic, learn */
  const out = avConsoleMkGroup("out", "Output");
  const scope = document.createElement("canvas");
  scope.id = "av-scope";
  scope.className = "av-band-scope";
  scope.width = 120;
  scope.height = 40;
  scope.setAttribute("aria-hidden", "true");
  out.appendChild(scope);

  const meters = document.createElement("div");
  meters.className = "avc-vu av-band-vu";
  meters.setAttribute("aria-hidden", "true");
  const mkBar = function (id, barId) {
    const wrap = document.createElement("span");
    wrap.className = "avc-vu-bar";
    wrap.id = id;
    const have = avConsoleEl(barId);
    if (have) {
      wrap.appendChild(have);           /* the bar the meter writes - adopted, id kept */
    } else {
      const fill = document.createElement("i");
      fill.className = "avc-vu-fill";
      fill.id = barId;
      wrap.appendChild(fill);
    }
    return wrap;
  };
  meters.appendChild(mkBar("av-meter-l", "avc-vu-l"));
  meters.appendChild(mkBar("av-meter-r", "avc-vu-r"));
  out.appendChild(meters);

  const panic = document.createElement("button");
  panic.type = "button";
  panic.id = "av-panic";
  panic.className = "av-btn mini av-band-panic";
  panic.textContent = "PANIC";
  panic.title = "All notes off";
  panic.setAttribute("aria-label", "All notes off");
  panic.addEventListener("click", function () {
    try { if (typeof avNoteStopAll === "function") avNoteStopAll(); } catch (e) { /* ok */ }
    avConsoleSetLast("panic");
    avConsoleRefresh();
  });
  out.appendChild(panic);

  const learn = document.createElement("button");
  learn.type = "button";
  learn.id = "av-learn";
  learn.className = "av-btn mini";
  learn.textContent = "LEARN";
  learn.title = "MIDI learn - arm CC learn, then click the control to drive";
  learn.setAttribute("aria-label", "MIDI learn");
  learn.addEventListener("click", function () {
    try {
      if (typeof avMidiLearnArm === "function") avMidiLearnArm();
      else if (typeof avMidiLearnToggle === "function") avMidiLearnToggle();
    } catch (e) { /* ok */ }
    avConsoleSetLast("learn");
    avConsoleRefresh();
  });
  out.appendChild(learn);

  /* contract order: transport | identity | pots | view | out */
  /* the header markup is now EMPTY, so the legacy ids that other modules only adopt must be
     CREATED here when absent (present ones were already adopted above and are left alone) */
  const ensureChip = function (id, text) {
    let el = avConsoleEl(id);
    if (!el) { el = document.createElement("span"); el.id = id; el.textContent = text; }
    el.className = "av-chip av-dim";
    if (el.parentNode !== eng.parentNode) eng.parentNode.appendChild(el);
    return el;
  };
  ensureChip("av-tier", "engine: pending");
  ensureChip("av-voices", "voices: —");
  const ensureKey = function (id, label, title, fn) {
    let el = avConsoleEl(id);
    if (!el) {
      el = document.createElement("button");
      el.type = "button";
      el.id = id;
      el.className = "av-btn mini";
      el.textContent = label;
      el.title = title;
      el.setAttribute("aria-label", title);
      el.addEventListener("click", function () { try { fn(); } catch (e) { /* guarded */ } });
    }
    if (el.parentNode !== view) view.appendChild(el);
    return el;
  };
  ensureKey("btn-piano", "🎹", "Piano dock - 61 keys at the bottom (Y)", function () {
    if (typeof avKbDockToggle === "function") avKbDockToggle();
    else if (typeof avPianoToggle === "function") avPianoToggle();
  });
  ensureKey("av-help", "?", "Help - shortcuts, the tour and the guides (?)", function () {
    if (typeof avHelpToggle === "function") avHelpToggle();
  });

  band.appendChild(gTransport);
  band.appendChild(ident);
  band.appendChild(gPots);
  band.appendChild(view);
  band.appendChild(out);
  head.appendChild(band);

  /* adopt the pack/preset selects into the LCD slots (ids assigned so the refresh and the step
     keys keep finding them; the bank's delegated change handler rides bubbling, so moving is safe) */
  try {
    const ps = avConsoleEl("avc-pack") || document.querySelector("select.av-bank-pack");
    const pr = avConsoleEl("avc-preset") || document.querySelector("select.av-bank-preset");
    if (ps) { ps.id = "avc-pack"; packSlot.appendChild(ps); }
    if (pr) { pr.id = "avc-preset"; presetSlot.appendChild(pr); }
  } catch (e) { /* the bank card keeps the selects it owns; refresh retries */ }

  /* the moved chips keep their ids - their text updates land by id */
  try {
    if (avConsoleAdopt(eng.parentNode, "av-tier")) { const t = avConsoleEl("av-tier"); t.className = "av-chip av-dim"; }
    if (avConsoleAdopt(eng.parentNode, "av-voices")) { const v = avConsoleEl("av-voices"); v.className = "av-chip av-dim"; }
  } catch (e) { /* chips stay where they are */ }

  /* the edited dot follows the av-param fan-out; a preset pick clears it */
  try {
    if (!avConsoleState.editedBound) {
      avConsoleState.editedBound = true;
      window.addEventListener("av-param", function () {
        try { const d = avConsoleEl("av-lcd-edited"); if (d) d.hidden = false; } catch (e) { /* ok */ }
      });
      document.addEventListener("change", function (e) {
        try {
          const t = e.target;
          if (!t || !t.id || (t.id !== "avc-pack" && t.id !== "avc-preset")) return;
          const d = avConsoleEl("av-lcd-edited");
          if (d) d.hidden = true;
        } catch (e2) { /* ok */ }
      });
    }
  } catch (e) { /* the dot is a nicety */ }

  /* re-home late arrivals (av_chrome may run after this script) */
  try {
    if (!avConsoleState.obs && typeof MutationObserver === "function") {
      const onAdd = function (node) {
        try {
          const id = node && node.id;
          if (!id) return;
          if (id === "avc-pack") { const s2 = avConsoleEl("av-lcd-pack"); if (s2 && node.parentNode !== s2) s2.appendChild(node); return; }
          if (id === "avc-preset") { const s3 = avConsoleEl("av-lcd-preset"); if (s3 && node.parentNode !== s3) s3.appendChild(node); return; }
          for (let i = 0; i < AV_CONSOLE_VIEW_KEYS.length; i++) {
            if (AV_CONSOLE_VIEW_KEYS[i][0] !== id) continue;
            const g = document.querySelector('#av-band .av-band-grp[data-grp="view"]');
            if (!g) return;
            if (!node.classList.contains("av-btn")) node.classList.add("av-btn");
            node.classList.add("mini");
            if (node.parentNode !== g) g.appendChild(node);
            return;
          }
        } catch (e) { /* the key stays where it landed */ }
      };
      avConsoleState.obs = new MutationObserver(function (recs) {
        for (let i = 0; i < recs.length; i++) {
          const added = recs[i].addedNodes || [];
          for (let j = 0; j < added.length; j++) onAdd(added[j]);
        }
      });
      avConsoleState.obs.observe(head, { childList: true });
    }
  } catch (e) { avConsoleState.obs = null; }
  return band;
}

function avConsoleInit() {
  try {
    if (avConsoleState.ready) return true;
    if (typeof document === "undefined" || !document) return false;
    const head = document.querySelector("header.av-head");
    if (!head) return false;
    if (avConsoleEl("avc-play")) { avConsoleState.ready = true; return true; }

    avConsoleBuild(head);

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
  let band = null;
  try {
    const b = avConsoleEl("av-band");
    band = b ? Array.prototype.map.call(b.children, function (n) { return n.getAttribute("data-grp") || ""; }) : null;
  } catch (e) { band = null; }
  return "CONSOLE SELFTEST " + JSON.stringify({
    v: AV_CONSOLE_VERSION,
    ready: avConsoleState.ready === true,
    head: head,
    band: band,
    pots: avConsoleState.pots,
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
      potMode: function (m) { return avConsolePotMode(m); },
      potBank: function () { return avConsoleState.pots; },
      scope: function () { return avConsoleScopePaint(); },
      vu: function () { return avConsoleVuRead(); },
      vuTick: function () { return avConsoleVuTick(); },
    };
  } catch (e) { /* no window - nothing to publish */ }
}

/* boot: self-init at parse time (the header + chips are already in the DOM above the script) */
try { avConsoleInit(); } catch (e) { /* console boots best-effort */ }
