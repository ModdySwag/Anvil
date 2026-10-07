/* av_lessons.js — Anvil S5 (sa-F): the tutorial ladder (#20) + the demo groove + the sound
   wizards (#45). Contract: verify/_s5_wave.md §2.F. Sources re-read for the pins below:
   av_seq_core.js (the §3.1 model + the norm/sanitise functions), av_seq_ui.js (the P4 undo
   push-AFTER-change idiom), av_undo.js (avUndoPush signature), av_synth.js + av_dsp.js (kind
   names and the REAL setParam paths), app_core.js (boot order), body.html (card ids).

   WHAT THIS MODULE IS
   - the five published lessons (ids: demo · first-beat · acid-line · sample-chop · stems-export),
     each a 4-7 step prose tour that runs on av_help's tour engine (avHelpTour — the §2.D seam);
     avLessonAction(key) is the action executor the tour calls on entering a step;
   - AV_LESSONS_DEMO — a 16-step, 4-track pattern in the av_seq_core norm shape (drums · acid ·
     strings · bass), canonical at rest: avSeqPatternNorm(AV_LESSONS_DEMO) is deep-equal to the
     constant itself (proven by the node harness). Loaded only via avSeqLoad, and the undo
     checkpoint is pushed AFTER the load (P4 law), exactly like av_seq_ui's callers;
   - the sound wizards (#45) — #av-wiz, a module-owned panel: 4 kinds (bass · pad · pluck · lead),
     3 curated choices per kind, deterministic param sets applied through avApplyParam (+ the kind
     via avSynthSetKind when it exists), an AUDITION phrase on the note bus, KEEP (undo push on
     the "params" domain) and REROLL (next curated variant);
   - the #av-firstrun strip (<30 s first-sound acceptance): one button loads the demo groove and
     starts the transport, a dismiss ✕ sets the localStorage gate "av-first-run".

   LAWS preserved:
   - "use strict"; ONE page module, ONE namespace (avLesson* / avLessons* / avWiz* / AV_LESSONS_*);
     every public call refuses honestly (false / {ok:false, note}) and never throws;
   - NO DOM at load — document / window / localStorage / avParams are reached only inside
     functions and every reach is guarded, so the file loads in plain node (the groove harness)
     and in any concat order;
   - no console windows, no document-level listeners, no browser/global state at top level;
   - the demo groove only ever loads through avSeqLoad (the core sanitises into a fresh copy) and
     the undo checkpoint lands AFTER the load with the same "seq" domain + a short label the seq
     UI's callers use (P4 push-after-change);
   - wizard param sets use ONLY real setParam paths (verified against the av_dsp.js cases and the
     av_synth.js tables) and ride the avApplyParam funnel — never a direct engine call;
   - cross-module seams are typeof-guarded: avHelpTour (av_help, sa-D), avSeqLoad/Snap/Play/Stop/
     SetPattern (av_seq_core/sched), avUndoPush (av_undo), avSynthSetKind/avSynthDefaults
     (av_synth), avNoteDown/avNoteUp (av_note), avKnobApplyVisual/avKnobFormat/avKnobCssEscape
     (av_knob), avSeqUiSync (av_seq_ui). Absent seams degrade with an honest note, never a fake.

   ID INVENTORY (module-owned): #av-firstrun (#av-firstrun-go · #av-firstrun-x) · #av-wiz
   (#av-wiz-close · #av-wiz-rows · #av-wiz-audition · #av-wiz-reroll · #av-wiz-keep · #av-wiz-note;
   rows carry .av-wiz-tab[data-wizk] / .av-wiz-opt[data-wizrow][data-wizopt]).

   OBSERVABLES: avLessonsInit() -> bool · avLessonsList() -> [{id,title,blurb,steps}] ·
   avLessonRun(id) -> {ok, note, handle?} · avLessonAction(key) -> {ok, note} ·
   avWizRun(kind) -> bool · avLessonsClasses() -> string[] · avLessonsStatus() -> {...} ·
   window.__avLessons = {version, list, run, action, wiz, status}.

   CSS CLASSES (the parent styles them): av-firstrun · av-firstrun-btn · av-firstrun-x ·
   av-firstrun-cap · av-wiz · av-wiz-on · av-wiz-head · av-wiz-title · av-wiz-x · av-wiz-tabs ·
   av-wiz-tab · av-wiz-tab-on · av-wiz-rows · av-wiz-row · av-wiz-row-set · av-wiz-lbl ·
   av-wiz-opts · av-wiz-opt · on · av-wiz-actions · av-wiz-btn · av-wiz-keep · av-wiz-note ·
   av-lessons-flash.

   ONE writer (sa-F). Never throws. */

"use strict";

const AV_LESSONS_VERSION = "s5.0";

const AV_LESSONS_FIRST_RUN_KEY = "av-first-run";     /* localStorage gate (§2.F) */
const AV_LESSONS_UNDO_LABEL = "load demo";           /* the "seq" checkpoint label (P4 law) */
const AV_LESSONS_FLASH_MS = 1600;                    /* the reveal highlight lingers this long */
const AV_LESSONS_KINDS = ["va", "acid", "string", "drum", "grain", "sampler"];
const AV_LESSONS_WIZ_KINDS = ["bass", "pad", "pluck", "lead"];

const AV_LESSONS_DEMO_NAME = "DEMO GROOVE";

/* ---------- module state (live values only; everything else is derived per call) ---------- */

const avLessonsState = {
  inited: false,
  mounts: 0,
  firstrun: "",            /* "" | "showing" | "done" */
  lastLesson: "",
  lastAction: "",
  lastActionOk: false,
  lastNote: "",
  lastWiz: "",
};

const avWizState = {
  open: false,
  kind: "",
  sel: [0, 0, 0],
  appliedRows: [false, false, false],
  applied: false,
  rerolls: 0,
  snap: null,              /* pre-wizard avParams snapshot (for ✕ discard) */
  note: "",
  timers: [],              /* pending audition timeouts */
};

/* ---------- small guarded helpers ---------- */

function avLessonDoc() {
  try {
    if (typeof document !== "undefined" && document && typeof document.getElementById === "function") return document;
  } catch (e) { /* no document */ }
  return null;
}

function avLessonWin() {
  try {
    if (typeof window !== "undefined" && window && typeof window === "object") return window;
  } catch (e) { /* no window */ }
  return null;
}

const avLessonEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* reveal: scroll the target into view (smooth when the browser takes options; bare call as the
   fallback). Never throws, returns false when the element cannot be revealed. */
function avLessonReveal(el) {
  try {
    if (!el || typeof el.scrollIntoView !== "function") return false;
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    return true;
  } catch (e) {
    try { el.scrollIntoView(); return true; } catch (e2) { return false; }
  }
}

/* temporary reveal highlight — the parent styles .av-lessons-flash; one timer per element */
function avLessonFlash(el) {
  try {
    if (!el || !el.classList) return false;
    el.classList.add("av-lessons-flash");
    if (el.__avLessonsFlashT) { try { clearTimeout(el.__avLessonsFlashT); } catch (e) { /* gone */ } }
    if (typeof setTimeout === "function") {
      el.__avLessonsFlashT = setTimeout(function () {
        try { el.classList.remove("av-lessons-flash"); } catch (e) { /* node left the page */ }
        el.__avLessonsFlashT = 0;
      }, AV_LESSONS_FLASH_MS);
    }
    return true;
  } catch (e) { return false; }
}

/* resolve a card by id: "av-seq" or the short "seq" both land (#av- prefix added when missing) */
function avLessonCardEl(id) {
  try {
    const s = String(id == null ? "" : id).trim();
    if (!s) return null;
    const doc = avLessonDoc();
    if (!doc) return null;
    let el = doc.getElementById(s);
    if (!el && s.indexOf("av-") !== 0) el = doc.getElementById("av-" + s);
    return el || null;
  } catch (e) { return null; }
}

/* the avParams mirror snapshot (numbers/strings/booleans only — the undo law's own filter) */
function avLessonParamsSnap() {
  try {
    if (typeof avParams === "undefined" || !avParams || typeof avParams !== "object") return null;
    const out = {};
    const keys = Object.keys(avParams);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i], v = avParams[k], t = typeof v;
      if (t === "number" || t === "string" || t === "boolean") out[k] = v;
    }
    return out;
  } catch (e) { return null; }
}

/* localStorage gate (best-effort: a blocked storage never blocks boot) */
function avLessonLS() {
  try {
    if (typeof localStorage !== "undefined" && localStorage && typeof localStorage.getItem === "function") return localStorage;
  } catch (e) { /* private mode / blocked */ }
  return null;
}

function avLessonFlagGet() {
  try {
    const ls = avLessonLS();
    return !!(ls && ls.getItem(AV_LESSONS_FIRST_RUN_KEY) === "1");
  } catch (e) { return false; }
}

function avLessonFlagSet() {
  try {
    const ls = avLessonLS();
    if (ls) ls.setItem(AV_LESSONS_FIRST_RUN_KEY, "1");
    return true;
  } catch (e) { return false; }
}

/* ==============================================================================================
   THE DEMO GROOVE — canonical at rest
   ==============================================================================================
   16 steps, 4 tracks, A-minor, 124 BPM, a little swing. Written in the av_seq_core norm shape
   (all 64 step slots per track, every field present, notes already canonical) so the core's
   sanitise pass is the identity — the node harness proves avSeqPatternNorm(demo) deep-equals
   the constant. The four tracks are the four lessons' subjects:
     T1 drums   kick c2 0/4/8/12 (+ a ghost on 10) · snare d2 on 4/12 (clap d#2 layer on 12) ·
                closed hat f#2 on the offbeats · open hat a#2 on 14
     T2 acid    a minor 303 line around a2 (45): accents on 0/4/8/12, slides 1→2, 7→8, 10→11
     T3 strings slow a3-e4-c4-b3 pad swells, full gates
     T4 bass    the A-F-G root walk on eighths (a1 33 / f1 29 / g1 31)
   No dead bars: every track has hits in both halves; nothing here is user data. */

function avLessonStepDef(on, note, vel, gate, extra) {
  const s = { on: on ? 1 : 0, note: note, vel: vel, gate: gate, slide: 0, accent: 0, oct: 0,
              prob: 100, cond: "", ratchet: 1, micro: 0 };
  if (extra && typeof extra === "object" && !Array.isArray(extra)) {
    for (const k in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, k)) s[k] = extra[k];
    }
  }
  return s;
}

/* 64 full step slots; the hits table punches the on-steps in ([step, note, vel, gate, extra?]).
   ONE note per step (the core's step shape): a hit landing on an already-on slot is skipped
   (first wins) — the harness pins each track's exact on-count so a silent double-book fails. */
function avLessonTrackBuild(len, hits) {
  const steps = [];
  for (let i = 0; i < 64; i++) steps.push(avLessonStepDef(0, "c4", 0.8, 0.95, null));
  for (let j = 0; j < hits.length; j++) {
    const h = hits[j];
    const at = Math.round(Number(h[0]));
    if (!(at >= 0 && at < 64)) continue;
    if (steps[at].on === 1) continue;
    steps[at] = avLessonStepDef(1, h[1], h[2], h[3], h[4] || null);
  }
  return { len: len, speed: 1, mute: 0, steps: steps };
}

function avLessonBuildDemo() {
  return {
    v: 1,
    name: AV_LESSONS_DEMO_NAME,
    bpm: 124,
    grid: "16",
    swing: 58,
    tracks: [
      /* T1 — drums (kit notes: kick 36 · snare 38 · hat 42 · open hat 46; one note per step) */
      avLessonTrackBuild(16, [
        [0, "c2", 1.0, 0.9], [8, "c2", 1.0, 0.9], [10, "c2", 0.5, 0.5],
        [4, "d2", 0.95, 0.9], [12, "d2", 0.9, 0.85],
        [2, "f#2", 0.5, 0.3], [6, "f#2", 0.55, 0.3],
        [14, "a#2", 0.55, 0.5],
      ]),
      /* T2 — acid: a minor around a2, accents 0/4/8/12, slides 1, 7, 10 */
      avLessonTrackBuild(16, [
        [0, "a2", 0.9, 0.9, { accent: 1 }], [1, "a2", 0.55, 0.5, { slide: 1 }],
        [2, "c3", 0.6, 0.4], [3, "a2", 0.5, 0.3],
        [4, "e3", 0.85, 0.8, { accent: 1 }], [5, "a2", 0.5, 0.3],
        [6, "g2", 0.6, 0.45], [7, "a2", 0.55, 0.5, { slide: 1 }],
        [8, "a2", 0.8, 0.85, { accent: 1 }], [9, "a2", 0.5, 0.3],
        [10, "c3", 0.6, 0.4, { slide: 1 }], [11, "d3", 0.55, 0.35],
        [12, "e3", 0.8, 0.8, { accent: 1 }], [13, "a2", 0.5, 0.3],
        [14, "g2", 0.6, 0.45], [15, "e3", 0.55, 0.4],
      ]),
      /* T3 — strings: the slow a3-e4-c4-b3 swell */
      avLessonTrackBuild(16, [
        [0, "a3", 0.55, 1], [4, "e4", 0.5, 1], [8, "c4", 0.5, 1],
        [12, "b3", 0.45, 1], [14, "e4", 0.35, 0.9],
      ]),
      /* T4 — bass: the A-F-G root walk on eighths */
      avLessonTrackBuild(16, [
        [0, "a1", 0.85, 0.6, { accent: 1 }], [2, "a1", 0.6, 0.35],
        [4, "a1", 0.7, 0.4], [6, "a1", 0.6, 0.3],
        [8, "f1", 0.85, 0.6, { accent: 1 }], [10, "f1", 0.6, 0.35],
        [12, "g1", 0.85, 0.6, { accent: 1 }], [14, "g1", 0.6, 0.35],
      ]),
    ],
    plocks: [],
    rng: 305419896,
  };
}

const AV_LESSONS_DEMO = avLessonBuildDemo();

/* freeze the constant (each level, best-effort) so no caller can scribble on the score */
function avLessonDeepFreeze(o) {
  try {
    if (!o || typeof o !== "object" || Object.isFrozen(o)) return o;
    Object.freeze(o);
    const keys = Object.keys(o);
    for (let i = 0; i < keys.length; i++) avLessonDeepFreeze(o[keys[i]]);
  } catch (e) { /* freeze is best-effort */ }
  return o;
}
avLessonDeepFreeze(AV_LESSONS_DEMO);

/* ---------- the pattern legs (mirroring av_seq_ui's P4 edit path exactly) ---------- */

/* load the demo: avSeqLoad only (the core copies), undo AFTER the load, then the sched + UI legs */
function avLessonLoadDemo() {
  try {
    if (typeof avSeqLoad !== "function") return false;
    const loaded = avSeqLoad(AV_LESSONS_DEMO) === true;
    if (!loaded) return false;
    try { if (typeof avUndoPush === "function") avUndoPush("seq", AV_LESSONS_UNDO_LABEL); } catch (e) { /* F optional */ }
    try {
      if (typeof avSeqSetPattern === "function" && typeof avSeqSnap === "function") {
        const s = avSeqSnap();
        if (s && typeof s === "object") avSeqSetPattern(s);
      }
    } catch (e) { /* no transport yet */ }
    try { if (typeof avSeqUiSync === "function") avSeqUiSync(); } catch (e) { /* repaint is a nicety */ }
    return true;
  } catch (e) { return false; }
}

/* any sequencer-domain edit: snapshot, mutate the copy, load it, undo AFTER the load (P4 law) */
function avLessonModelEdit(mutator, label) {
  try {
    if (typeof avSeqSnap !== "function" || typeof avSeqLoad !== "function") return false;
    const snap = avSeqSnap();
    if (!snap || typeof snap !== "object" || !Array.isArray(snap.tracks)) return false;
    let ok = false;
    try { ok = mutator(snap) !== false; } catch (e) { return false; }
    if (!ok) return false;
    const loaded = avSeqLoad(snap) === true;
    if (loaded) {
      try { if (typeof avUndoPush === "function") avUndoPush("seq", label || "lesson edit"); } catch (e) { /* F optional */ }
      try {
        if (typeof avSeqSetPattern === "function") {
          const s2 = avSeqSnap();
          if (s2 && typeof s2 === "object") avSeqSetPattern(s2);
        }
      } catch (e) { /* no transport yet */ }
      try { if (typeof avSeqUiSync === "function") avSeqUiSync(); } catch (e) { /* repaint is a nicety */ }
    }
    return loaded;
  } catch (e) { return false; }
}

function avLessonSetMutes(mutes, label) {
  if (!Array.isArray(mutes)) return false;
  return avLessonModelEdit(function (snap) {
    for (let t = 0; t < 4; t++) {
      if (snap.tracks[t] && typeof mutes[t] !== "undefined") snap.tracks[t].mute = mutes[t] ? 1 : 0;
    }
    return true;
  }, label || "mute");
}

/* ---------- synth-kind leg (engine.kind through the synth card's own commit when it exists) ---------- */

function avLessonSetKind(kind) {
  const k = (typeof kind === "string") ? kind.trim().toLowerCase() : "";
  if (AV_LESSONS_KINDS.indexOf(k) < 0) return false;
  let ok = false;
  try { if (typeof avSynthSetKind === "function") ok = avSynthSetKind(k) !== false; } catch (e) { ok = false; }
  if (!ok) {
    try { if (typeof avApplyParam === "function") ok = avApplyParam("engine.kind", k) !== false; } catch (e) { ok = false; }
  }
  const synth = avLessonCardEl("av-synth");
  if (synth) avLessonReveal(synth);
  return ok;
}

/* ---------- the action executor (keys per §2.F; unknown keys refuse honestly) ---------- */

function avLessonAction(idOrKey) {
  let res = { ok: false, note: "" };
  const key = (typeof idOrKey === "string") ? idOrKey.trim() : "";
  try {
    if (!key) {
      res = { ok: false, note: "empty action key" };
    } else if (key === "seq.loadDemo") {
      const ok = avLessonLoadDemo();
      res = ok ? { ok: true, note: "demo groove loaded (undo brings your pattern back)" }
               : { ok: false, note: "the sequencer core is not loaded — can't load the demo" };
    } else if (key === "seq.play") {
      let already = false;
      try { already = (typeof avSeqIsPlaying === "function") && avSeqIsPlaying() === true; } catch (e) { already = false; }
      if (already) res = { ok: true, note: "transport already playing" };
      else {
        let ok = false;
        try { if (typeof avSeqPlay === "function") ok = avSeqPlay() === true; } catch (e) { ok = false; }
        res = ok ? { ok: true, note: "transport playing" }
                 : { ok: false, note: "transport refused — no audio context yet (play a key, then retry)" };
      }
    } else if (key === "seq.stop") {
      let ok = false;
      try { if (typeof avSeqStop === "function") ok = avSeqStop() === true; } catch (e) { ok = false; }
      res = (typeof avSeqStop !== "function") ? { ok: false, note: "the sequencer transport is not loaded" }
            : ok ? { ok: true, note: "transport stopped" } : { ok: true, note: "transport was already stopped" };
    } else if (key === "seq.muteOthers") {
      const ok = avLessonSetMutes([0, 1, 1, 1], "lesson: mute others");
      res = ok ? { ok: true, note: "tracks 2-4 muted — the drums solo" }
               : { ok: false, note: "couldn't mute — the sequencer core is not loaded" };
    } else if (key === "seq.unmuteAll") {
      const ok = avLessonSetMutes([0, 0, 0, 0], "lesson: unmute all");
      res = ok ? { ok: true, note: "all four tracks back" }
               : { ok: false, note: "couldn't unmute — the sequencer core is not loaded" };
    } else if (key === "seq.soloAcid") {
      const ok = avLessonSetMutes([1, 0, 1, 1], "lesson: solo acid");
      res = ok ? { ok: true, note: "T2 soloed — the acid line alone" }
               : { ok: false, note: "couldn't solo — the sequencer core is not loaded" };
    } else if (key.indexOf("card.open:") === 0) {
      const cid = key.slice(10).trim();
      const el = avLessonCardEl(cid);
      if (!el) res = { ok: false, note: 'card "' + cid + '" is not on this page' };
      else { avLessonReveal(el); avLessonFlash(el); res = { ok: true, note: "scrolled to " + (el.id || cid) }; }
    } else if (key === "deliver.highlight") {
      const card = avLessonCardEl("av-deliver");
      if (!card) {
        res = { ok: false, note: "the Deliver card is not on this page" };
      } else {
        avLessonReveal(card); avLessonFlash(card);
        let run = null;
        try { const doc = avLessonDoc(); run = doc ? doc.getElementById("av-deliver-run") : null; } catch (e) { run = null; }
        if (run) { avLessonReveal(run); avLessonFlash(run); }
        res = run ? { ok: true, note: "Deliver card revealed — RUN highlighted" }
                  : { ok: true, note: "Deliver card revealed — the RUN button has not mounted yet" };
      }
    } else if (key === "store.open") {
      const card = avLessonCardEl("av-store");
      if (!card) {
        res = { ok: false, note: "the Store card is not on this page" };
      } else {
        avLessonReveal(card); avLessonFlash(card);
        let search = null;
        try { const doc = avLessonDoc(); search = doc ? doc.getElementById("av-store-search") : null; } catch (e) { search = null; }
        if (search) avLessonFlash(search);
        res = { ok: true, note: "Store revealed — factory packs install once and stay offline" };
      }
    } else if (key === "sample.tip") {
      const card = avLessonCardEl("av-sample");
      if (!card) {
        res = { ok: false, note: "the Samples card is not on this page" };
      } else {
        avLessonReveal(card); avLessonFlash(card);
        let zone = null;
        try { zone = card.querySelector ? card.querySelector("[data-av-sample-drop]") : null; } catch (e) { zone = null; }
        if (zone) avLessonFlash(zone);
        res = { ok: true, note: "drop a WAV on the zone (or click it to choose) — nothing uploads" };
      }
    } else if (key.indexOf("wiz.open:") === 0) {
      const wk = key.slice(9).trim();
      const ok = avWizRun(wk);
      res = ok ? { ok: true, note: "wizard panel open — " + wk }
               : { ok: false, note: 'no wizard kind "' + wk + '" (bass · pad · pluck · lead) or no DOM' };
    } else if (key.indexOf("synth.kind:") === 0) {
      const sk = key.slice(11).trim();
      const ok = avLessonSetKind(sk);
      res = ok ? { ok: true, note: "ENGINE set to " + sk }
               : { ok: false, note: 'unknown engine kind "' + sk + '" (va · acid · string · drum · grain · sampler)' };
    } else {
      res = { ok: false, note: 'unknown action "' + key + '"' };
    }
  } catch (e) {
    res = { ok: false, note: "action failed: " + String((e && e.message) || e) };
  }
  avLessonsState.lastAction = key;
  avLessonsState.lastActionOk = res.ok === true;
  avLessonsState.lastNote = res.note;
  avLessonsPublish();
  return res;
}

/* ==============================================================================================
   THE LESSONS — prose tours; actions land exactly where the words point
   ============================================================================================== */

const AV_LESSONS = [
  {
    id: "demo",
    title: "Hear the demo groove",
    blurb: "Load a finished four-track pattern, press play, and take it apart track by track.",
    steps: [
      { sel: null, title: "The demo groove",
        text: "Four tracks: drums, an acid line, strings and a bass. Nothing here is yours yet, so nothing can break. We load it, we play it, we take it apart." },
      { sel: "#av-seq", title: "Load it",
        text: "One pattern, 16 steps, four instrument parts. The demo replaces what the sequencer plays right now — Ctrl+Z brings the old pattern back.",
        action: "seq.loadDemo" },
      { sel: "#av-seq-play", title: "Press play",
        text: "The transport rides the audio clock. The bright cell is the playhead; each track loops its own 16 steps.",
        action: "seq.play" },
      { sel: ".av-seq-row-mute", title: "Take it apart",
        text: "Every track has an M — mute. Solo the drums (T1) by muting T2-T4, then switch the ENGINE to drum in the synth card above to hear the kit." },
      { sel: "#av-store", title: "More sounds",
        text: "The Store ships factory packs — banks of presets you install once and keep offline. The palette (Ctrl+K) runs every one of these lessons when you don't want the tour.",
        action: "store.open" },
    ],
  },
  {
    id: "first-beat",
    title: "Get your first beat",
    blurb: "Solo the demo drums, add a hit, and make the kit knock.",
    steps: [
      { sel: "#av-seq", title: "Start from the demo bars",
        text: "We begin from the demo groove's beat and make it ours.",
        action: "seq.loadDemo" },
      { sel: "#av-seq", title: "Solo the drums",
        text: "One press: tracks 2-4 mute (their M buttons light) and the beat plays alone — T1 is kick, snare and hats.",
        action: "seq.muteOthers" },
      { sel: ".av-seq-cell", title: "Add a hit",
        text: "Click any dark cell in the T1 row and the step switches on — click again to clear it. The grid records exactly what you hear." },
      { sel: "#av-synth", title: "Make it knock",
        text: "ENGINE is set to drum for you. The DRUM panel below holds tune · decay · level per voice — drop KICK decay for a tighter thump.",
        action: "synth.kind:drum" },
      { sel: "#av-drums", title: "Or play it in",
        text: "The pads play the kit through the same note bus as the dock and your MIDI keys — finger-drum until it feels right, then copy the feel into the grid." },
      { sel: null, title: "Bring the band back",
        text: "Unmute T2-T4 and your kick sits inside the demo groove.",
        action: "seq.unmuteAll" },
    ],
  },
  {
    id: "acid-line",
    title: "Make an acid line",
    blurb: "Hear the demo's 303 track on its own engine, then bend its eight hero knobs.",
    steps: [
      { sel: "#av-seq", title: "The acid track",
        text: "T2 of the demo groove is a 16-step acid line — accents, slides, the works.",
        action: "seq.loadDemo" },
      { sel: "#av-seq", title: "Solo it",
        text: "Now only the line plays — the other three tracks mute.",
        action: "seq.soloAcid" },
      { sel: "#av-synth", title: "Give it its engine",
        text: "The 303 character is a whole engine, so ENGINE switches to acid. The panel swaps to the eight hero knobs.",
        action: "synth.kind:acid" },
      { sel: '.av-knob[data-knob="acid.cutoff"]', title: "Cutoff is the story",
        text: "Turn CUTOFF while the line runs — ENV MOD and DECAY shape each note's sweep, RESO pushes toward a whistle." },
      { sel: "#av-seq", title: "Read the pattern",
        text: "Click a lit cell: the inspector shows note, slide and accent. Slide steps glide into the next note — that's the acid glue." },
      { sel: null, title: "Want the low end too?",
        text: "The sound wizards build a patch from three quick choices — try the bass wizard and keep the acid flavour.",
        action: "wiz.open:bass" },
    ],
  },
  {
    id: "sample-chop",
    title: "Chop a sample",
    blurb: "Import a WAV, point the granular engine at it, and play the cloud.",
    steps: [
      { sel: "#av-sample", title: "The Samples card",
        text: "Everything importable lives here — WAV, MP3, OGG, FLAC straight off your drive. Nothing is uploaded; the file stays in the tab.",
        action: "card.open:av-sample" },
      { sel: "#av-sample", title: "Import one",
        text: "Drop a WAV on the zone — or click it to choose a file. A sample has to come from you; there is nothing we could honestly load for it.",
        action: "sample.tip" },
      { sel: "#av-synth", title: "Point an engine at it",
        text: "Two engines read samples: GRAIN (the granular cloud) and SAMPLER (one-shot or loop playback). ENGINE is set to grain — set BUF to the slot your file landed in.",
        action: "synth.kind:grain" },
      { sel: '.av-knob[data-knob="grain.pos"]', title: "Play the cloud",
        text: "Hold notes on the dock and move POS · SIZE · DENSITY — the granular engine freezes and smears whatever you imported." },
      { sel: null, title: "Or pluck it",
        text: "The pluck wizard sets the STRING engine's exciter, tone and body in three choices — a plucked take on any sample.",
        action: "wiz.open:pluck" },
    ],
  },
  {
    id: "stems-export",
    title: "Export stems to your DAW",
    blurb: "Render the pattern offline and hand your DAW a zip of stems, master, MIDI and a README.",
    steps: [
      { sel: "#av-seq", title: "The pattern ships",
        text: "Deliver renders the sequencer offline — faster than real time, never touching the live output.",
        action: "seq.loadDemo" },
      { sel: "#av-deliver", title: "The Deliver card",
        text: "One press writes a DAW-ready zip — stems, master, MIDI and a README. It lands in your downloads; nothing is uploaded.",
        action: "card.open:av-deliver" },
      { sel: "#av-deliver-run", title: "Press RUN",
        text: "EXPORT STEMS (.zip) is the button — we light it up. PROGRESS shows the render; the status line hands you the zip.",
        action: "deliver.highlight" },
      { sel: "#av-deliver", title: "What's inside",
        text: "One WAV stem per track, the stereo master WAV, a .mid of the pattern, and a README with the render settings — drop the stems straight into a DAW session." },
      { sel: null, title: "Rerender after every change",
        text: "The zip always matches what the transport plays right now — change a step, press RUN again, and the new story replaces the old." },
    ],
  },
];

/* ---------- lesson lookup + copies (the table is never handed out raw) ---------- */

function avLessonFind(id) {
  const s = (typeof id === "string") ? id.trim().toLowerCase() : "";
  if (!s) return null;
  for (let i = 0; i < AV_LESSONS.length; i++) {
    if (AV_LESSONS[i].id === s) return AV_LESSONS[i];
  }
  return null;
}

function avLessonStepsCopy(steps) {
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    out.push({
      sel: (typeof s.sel === "string" && s.sel) ? s.sel : null,
      title: String(s.title == null ? "" : s.title),
      text: String(s.text == null ? "" : s.text),
      action: (typeof s.action === "string" && s.action) ? s.action : null,
    });
  }
  return out;
}

/* ==============================================================================================
   PUBLIC SURFACE
   ============================================================================================== */

function avLessonsList() {
  const out = [];
  try {
    for (let i = 0; i < AV_LESSONS.length; i++) {
      const l = AV_LESSONS[i];
      out.push({ id: l.id, title: l.title, blurb: l.blurb, steps: avLessonStepsCopy(l.steps) });
    }
  } catch (e) { /* a list call never throws */ }
  return out;
}

/* start a lesson through the av_help tour engine; without it, an honest no-op + status note */
function avLessonRun(id) {
  try {
    const les = avLessonFind(id);
    if (!les) return { ok: false, note: 'unknown lesson "' + String(id == null ? "" : id) + '"' };
    if (typeof avHelpTour !== "function") {
      const note = "the tour engine is not loaded — lessons need av_help (its GUIDES tab also starts these)";
      avLessonsState.lastLesson = les.id;
      avLessonsState.lastNote = note;
      avLessonsPublish();
      return { ok: false, note: note };
    }
    let handle = null;
    try { handle = avHelpTour(avLessonStepsCopy(les.steps)); } catch (e) { handle = null; }
    if (!handle) {
      const note = "the tour engine refused to start lesson " + les.id;
      avLessonsState.lastLesson = les.id;
      avLessonsState.lastNote = note;
      avLessonsPublish();
      return { ok: false, note: note };
    }
    avLessonsState.lastLesson = les.id;
    avLessonsState.lastNote = "lesson started — " + les.id;
    avLessonsPublish();
    return { ok: true, note: "lesson started — " + les.id, handle: handle };
  } catch (e) {
    return { ok: false, note: "lesson failed: " + String((e && e.message) || e) };
  }
}

function avLessonsStatus() {
  try {
    return {
      version: AV_LESSONS_VERSION,
      inited: avLessonsState.inited === true,
      firstrun: avLessonsState.firstrun,
      lastLesson: avLessonsState.lastLesson,
      lastAction: avLessonsState.lastAction,
      lastActionOk: avLessonsState.lastActionOk === true,
      lastNote: avLessonsState.lastNote,
      lastWiz: avLessonsState.lastWiz,
      wizOpen: avWizState.open === true,
      wizKind: avWizState.open ? avWizState.kind : "",
    };
  } catch (e) {
    return { version: AV_LESSONS_VERSION };
  }
}

function avLessonsClasses() {
  return [
    "av-firstrun", "av-firstrun-btn", "av-firstrun-x", "av-firstrun-cap",
    "av-wiz", "av-wiz-on", "av-wiz-head", "av-wiz-title", "av-wiz-x",
    "av-wiz-tabs", "av-wiz-tab", "av-wiz-tab-on",
    "av-wiz-rows", "av-wiz-row", "av-wiz-row-set", "av-wiz-lbl", "av-wiz-opts", "av-wiz-opt", "on",
    "av-wiz-actions", "av-wiz-btn", "av-wiz-keep", "av-wiz-note",
    "av-lessons-flash",
  ];
}

function avLessonsPublish() {
  try {
    const win = avLessonWin();
    if (!win) return false;
    win.__avLessons = {
      version: AV_LESSONS_VERSION,
      list: function () { return avLessonsList(); },
      run: function (id) { return avLessonRun(id); },
      action: function (key) { return avLessonAction(key); },
      wiz: function (kind) { return avWizRun(kind); },
      status: function () { return avLessonsStatus(); },
    };
    return true;
  } catch (e) { return false; }
}

/* ==============================================================================================
   THE FIRST-RUN STRIP (#av-firstrun, before #av-levels) — the <30 s first-sound acceptance
   ============================================================================================== */

function avLessonFirstRunRemove() {
  try {
    const doc = avLessonDoc();
    if (!doc) return false;
    const el = doc.getElementById("av-firstrun");
    if (el && el.parentNode) { el.parentNode.removeChild(el); return true; }
  } catch (e) { /* already gone */ }
  return false;
}

function avLessonFirstRunDone(noteText) {
  avLessonFlagSet();
  avLessonsState.firstrun = "done";
  if (noteText) avLessonsState.lastNote = noteText;
  avLessonFirstRunRemove();
  avLessonsPublish();
}

/* the one big button: load the demo groove, start the transport, spend the gate, collapse */
function avLessonFirstRunGo() {
  const loaded = avLessonLoadDemo();
  let playing = false;
  try { playing = (typeof avSeqIsPlaying === "function") && avSeqIsPlaying() === true; } catch (e) { playing = false; }
  if (!playing) {
    try { if (typeof avSeqPlay === "function") playing = avSeqPlay() === true; } catch (e) { playing = false; }
  }
  let note;
  if (loaded && playing) note = "first sound: demo groove loaded and playing";
  else if (loaded) note = "first sound: demo groove loaded — press PLAY";
  else note = "first sound: the sequencer core is not loaded";
  avLessonFirstRunDone(note);
  return { loaded: loaded, playing: playing };
}

function avLessonFirstRunMount() {
  try {
    const doc = avLessonDoc();
    if (!doc || !doc.body) return false;
    if (doc.getElementById("av-firstrun")) return true;          /* idempotent */
    if (avLessonFlagGet()) return false;                          /* the gate is spent */
    const levels = doc.getElementById("av-levels");
    const main = (levels && levels.parentNode) ? levels.parentNode : doc.querySelector(".av-main");
    if (!main || typeof main.insertBefore !== "function") return false;
    const el = doc.createElement("section");
    el.id = "av-firstrun";
    el.className = "av-firstrun";
    el.setAttribute("aria-label", "First sound");
    el.innerHTML = '<button type="button" class="av-firstrun-btn" id="av-firstrun-go" title="Load the demo groove and start the transport">▶ FIRST SOUND — load the demo groove and play</button>' +
      '<button type="button" class="av-firstrun-x" id="av-firstrun-x" aria-label="Dismiss the first-sound strip — it will not come back" title="Dismiss">✕</button>' +
      '<p class="av-firstrun-cap">one press — nothing to set up · the demo replaces the pattern and Ctrl+Z brings it back</p>';
    const go = el.querySelector("#av-firstrun-go");
    if (go && typeof go.addEventListener === "function") {
      go.addEventListener("click", function () { try { avLessonFirstRunGo(); } catch (e) { /* never throw out of a click */ } });
    }
    const x = el.querySelector("#av-firstrun-x");
    if (x && typeof x.addEventListener === "function") {
      x.addEventListener("click", function () { try { avLessonFirstRunDone("first-run strip dismissed"); } catch (e) { /* never throw out of a click */ } });
    }
    if (levels && levels.parentNode === main) main.insertBefore(el, levels);
    else main.insertBefore(el, main.firstChild);
    avLessonsState.firstrun = "showing";
    return true;
  } catch (e) { return false; }
}

/* ==============================================================================================
   THE SOUND WIZARDS (#45) — 4 kinds, 3 curated choices each, deterministic param sets
   ==============================================================================================
   Every path below was verified against av_dsp.js's setParam cases (the va block + the kind
   prefix dispatch) and the av_synth.js tables that mount them — no invented paths. engine.kind
   is applied through avSynthSetKind when the synth card is loaded (it commits the same funnel),
   else straight through avApplyParam. */

const AV_LESSONS_WIZ = {
  bass: {
    label: "BASS",
    phrase: ["c2", "c2", "d#2", "g2"],
    gap: 260, dur: 220,
    rows: [
      { label: "FLAVOUR", options: [
        { name: "deep", params: { "engine.kind": "va", "osc1.type": "saw", "osc1.level": 1, "osc2.level": 0.2, "sub.level": 0.9, "filter.cutoff": 320, "filter.envAmt": 1, "env1.d": 0.25, "env1.s": 0.5, "voice.glide": 0 } },
        { name: "acid", params: { "engine.kind": "acid", "acid.wave": 0, "acid.cutoff": 480, "acid.reso": 0.72, "acid.envMod": 0.85, "acid.decay": 0.22, "acid.accent": 0.7, "acid.volume": 0.8, "acid.slide": 0.06 } },
        { name: "reese", params: { "engine.kind": "va", "osc1.uni": 4, "osc1.spread": 22, "osc2.level": 0.85, "osc2.tune": -0.35, "filter.cutoff": 380, "filter.reso": 0.3, "env1.d": 2, "env1.s": 0.9 } },
      ] },
      { label: "FILTER", options: [
        { name: "dark", params: { "filter.cutoff": 260, "filter.reso": 0.2, "acid.cutoff": 260, "acid.reso": 0.45 } },
        { name: "bright", params: { "filter.cutoff": 3200, "filter.reso": 0.45, "acid.cutoff": 3200, "acid.reso": 0.7 } },
      ] },
      { label: "MOVEMENT", options: [
        { name: "none", params: { "lfo.rate": 5, "lfo.toCut": 0 } },
        { name: "slow", params: { "lfo.rate": 0.12, "lfo.toCut": 0.35 } },
        { name: "wobble", params: { "lfo.rate": 2.4, "lfo.toCut": 0.5 } },
      ] },
    ],
  },
  pad: {
    label: "PAD",
    phrase: ["c3", "e3", "g3", "b3"],
    gap: 420, dur: 950,
    rows: [
      { label: "BODY", options: [
        { name: "warm", params: { "engine.kind": "va", "osc1.type": "saw", "osc2.type": "wt.tri", "osc2.level": 0.4, "osc1.uni": 2, "osc1.spread": 8, "filter.cutoff": 900, "filter.reso": 0.25, "env1.a": 0.9, "env1.d": 2.2, "env1.s": 0.85, "env1.r": 2.6 } },
        { name: "glass", params: { "engine.kind": "va", "osc1.type": "tri", "osc2.type": "wt.sine", "osc2.level": 0.45, "osc1.uni": 1, "filter.cutoff": 2600, "env1.a": 0.5, "env1.d": 3, "env1.s": 0.7, "env1.r": 3.2 } },
        { name: "wide", params: { "engine.kind": "va", "osc1.type": "saw", "osc1.uni": 5, "osc1.spread": 28, "osc2.type": "wt.saw", "osc2.level": 0.5, "filter.cutoff": 1200, "env1.a": 1.2, "env1.d": 2.5, "env1.s": 0.8, "env1.r": 3.5 } },
      ] },
      { label: "FILTER", options: [
        { name: "soft", params: { "filter.cutoff": 700, "filter.reso": 0.18 } },
        { name: "open", params: { "filter.cutoff": 4200, "filter.reso": 0.35 } },
      ] },
      { label: "MOTION", options: [
        { name: "still", params: { "lfo.rate": 5, "lfo.toCut": 0 } },
        { name: "drift", params: { "lfo.rate": 0.09, "lfo.toCut": 0.35 } },
        { name: "shimmer", params: { "lfo.rate": 5.3, "lfo.toCut": 0.22 } },
      ] },
    ],
  },
  pluck: {
    label: "PLUCK",
    phrase: ["c3", "g3", "c4", "e4"],
    gap: 200, dur: 160,
    rows: [
      { label: "EXCITER", options: [
        { name: "noise", params: { "engine.kind": "string", "string.exciter": "noise", "string.pluck": 0.3, "string.tone": 0.5, "string.damp": 0.5 } },
        { name: "saw", params: { "engine.kind": "string", "string.exciter": "saw", "string.pluck": 0.45, "string.tone": 0.6, "string.damp": 0.45 } },
        { name: "pulse", params: { "engine.kind": "string", "string.exciter": "pulse", "string.pluck": 0.5, "string.tone": 0.45, "string.damp": 0.4 } },
      ] },
      { label: "TONE", options: [
        { name: "dark", params: { "string.tone": 0.25, "string.damp": 0.75 } },
        { name: "bright", params: { "string.tone": 0.85, "string.damp": 0.25 } },
      ] },
      { label: "BODY", options: [
        { name: "short", params: { "string.decay": 0.25 } },
        { name: "long", params: { "string.decay": 0.85 } },
      ] },
    ],
  },
  lead: {
    label: "LEAD",
    phrase: ["c4", "d#4", "g4", "a#4"],
    gap: 240, dur: 200,
    rows: [
      { label: "VOICE", options: [
        { name: "solo", params: { "engine.kind": "va", "osc1.type": "saw", "osc1.uni": 1, "osc1.spread": 6, "osc2.level": 0.35, "voice.glide": 0 } },
        { name: "fat", params: { "engine.kind": "va", "osc1.type": "saw", "osc1.uni": 5, "osc1.spread": 18, "osc2.level": 0.6, "voice.glide": 0 } },
        { name: "glide", params: { "engine.kind": "va", "osc1.type": "saw", "osc1.uni": 2, "osc1.spread": 10, "voice.glide": 0.08, "filter.cutoff": 1800 } },
      ] },
      { label: "CUT", options: [
        { name: "bright", params: { "filter.cutoff": 6000, "filter.reso": 0.3, "env1.d": 0.4, "env1.s": 0.8 } },
        { name: "scream", params: { "filter.cutoff": 2200, "filter.reso": 0.8, "filter.envAmt": 2.6, "env1.d": 0.3 } },
      ] },
      { label: "SPACE", options: [
        { name: "dry", params: { "osc1.spread": 6, "lfo.toCut": 0 } },
        { name: "wide", params: { "osc1.spread": 34, "osc2.level": 0.5 } },
        { name: "sing", params: { "lfo.rate": 5.6, "lfo.toCut": 0.18 } },
      ] },
    ],
  },
};

function avWizKindNorm(kind) {
  const k = (typeof kind === "string") ? kind.trim().toLowerCase() : "";
  return AV_LESSONS_WIZ_KINDS.indexOf(k) >= 0 ? k : "";
}

/* ---------- the panel (created once, lazily; one delegated listener on it) ---------- */

function avWizPanelHTML() {
  let tabs = "";
  for (let i = 0; i < AV_LESSONS_WIZ_KINDS.length; i++) {
    const k = AV_LESSONS_WIZ_KINDS[i];
    tabs += '<button type="button" class="av-btn mini av-wiz-tab" data-wizk="' + avLessonEsc(k) + '">' + avLessonEsc(AV_LESSONS_WIZ[k].label) + '</button>';
  }
  return '<div class="av-wiz-head"><span class="av-wiz-title">SOUND WIZARD</span>' +
    '<button type="button" class="av-btn mini av-wiz-x" id="av-wiz-close" title="Dismiss without keeping" aria-label="Dismiss the wizard">✕</button></div>' +
    '<div class="av-wiz-tabs" role="group" aria-label="Wizard target">' + tabs + '</div>' +
    '<div class="av-wiz-rows" id="av-wiz-rows"></div>' +
    '<div class="av-wiz-actions">' +
    '<button type="button" class="av-btn mini av-wiz-btn" id="av-wiz-audition" title="Hear the current choices">AUDITION</button>' +
    '<button type="button" class="av-btn mini av-wiz-btn" id="av-wiz-reroll" title="Cycle to the next curated variant">REROLL</button>' +
    '<button type="button" class="av-btn mini av-wiz-btn av-wiz-keep" id="av-wiz-keep" title="Keep the sound and close">KEEP</button>' +
    '</div>' +
    '<div class="av-wiz-note" id="av-wiz-note" role="status"></div>';
}

function avWizEnsure() {
  try {
    const doc = avLessonDoc();
    if (!doc || !doc.body) return null;
    let el = doc.getElementById("av-wiz");
    if (el) return el;
    el = doc.createElement("div");
    el.id = "av-wiz";
    el.className = "av-wiz";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Sound wizard");
    el.hidden = true;
    el.innerHTML = avWizPanelHTML();
    if (typeof el.addEventListener === "function") el.addEventListener("click", avWizClick);
    doc.body.appendChild(el);
    return el;
  } catch (e) { return null; }
}

function avWizRender() {
  try {
    const doc = avLessonDoc();
    if (!doc) return false;
    const spec = AV_LESSONS_WIZ[avWizState.kind];
    const rowsEl = doc.getElementById("av-wiz-rows");
    if (!spec || !rowsEl) return false;
    let html = "";
    for (let r = 0; r < spec.rows.length; r++) {
      const row = spec.rows[r];
      let opts = "";
      for (let o = 0; o < row.options.length; o++) {
        const on = avWizState.sel[r] === o;
        opts += '<button type="button" class="av-btn mini av-wiz-opt' + (on ? " on" : "") + '" data-wizrow="' + r + '" data-wizopt="' + o + '">' + avLessonEsc(row.options[o].name) + '</button>';
      }
      html += '<div class="av-wiz-row' + (avWizState.appliedRows[r] ? " av-wiz-row-set" : "") + '" data-wizrow="' + r + '">' +
        '<span class="av-wiz-lbl">' + avLessonEsc(row.label) + '</span>' +
        '<span class="av-wiz-opts">' + opts + '</span></div>';
    }
    rowsEl.innerHTML = html;
    doc.querySelectorAll(".av-wiz-tab").forEach(function (tb) {
      tb.classList.toggle("av-wiz-tab-on", tb.getAttribute("data-wizk") === avWizState.kind);
    });
    const noteEl = doc.getElementById("av-wiz-note");
    if (noteEl) noteEl.textContent = avWizState.note || "pick one option per row, then AUDITION";
    return true;
  } catch (e) { return false; }
}

/* paint every mounted knob the applied set touches (dial + readout), best-effort */
function avWizPaintParams(set) {
  try {
    const doc = avLessonDoc();
    if (!doc) return false;
    for (const p in set) {
      if (!Object.prototype.hasOwnProperty.call(set, p)) continue;
      const v = set[p];
      const n = Number(v);
      if (!isFinite(n)) continue;                       /* kind names have no dial */
      try {
        const esc = (typeof avKnobCssEscape === "function")
          ? avKnobCssEscape(p)
          : String(p).replace(/[^a-zA-Z0-9_-]/g, ch => "\\" + ch);
        doc.querySelectorAll('.av-knob[data-knob="' + esc + '"]').forEach(function (el) {
          try {
            if (typeof avKnobApplyVisual === "function") avKnobApplyVisual(el, n);
            if (typeof avKnobFormat === "function") {
              const txt = avKnobFormat(n, { fmt: el.dataset.fmt || "", unit: el.dataset.unit || "" });
              if (txt != null) doc.querySelectorAll('[data-kval="' + esc + '"]').forEach(function (xd) { xd.textContent = txt; });
            }
          } catch (e) { /* one knob must not stop the paint */ }
        });
      } catch (e) { /* one path must not stop the paint */ }
    }
    return true;
  } catch (e) { return false; }
}

/* merge the selected options, apply through the funnel, reveal the synth card (the §2.F pin) */
function avWizApply() {
  try {
    const spec = AV_LESSONS_WIZ[avWizState.kind];
    if (!spec) return false;
    const set = {};
    for (let i = 0; i < spec.rows.length; i++) {
      const opt = spec.rows[i].options[avWizState.sel[i]];
      if (!opt) continue;
      for (const p in opt.params) {
        if (Object.prototype.hasOwnProperty.call(opt.params, p)) set[p] = opt.params[p];
      }
    }
    let applied = 0, refused = 0;
    for (const p in set) {
      if (!Object.prototype.hasOwnProperty.call(set, p)) continue;
      const v = set[p];
      let ok = false;
      if (p === "engine.kind") {
        try { if (typeof avSynthSetKind === "function") ok = avSynthSetKind(v) !== false; } catch (e) { ok = false; }
        if (!ok) {
          try { if (typeof avApplyParam === "function") ok = avApplyParam(p, v) !== false; } catch (e) { ok = false; }
        }
        if (!ok) {
          try { if (typeof avParams !== "undefined" && avParams) { avParams[p] = v; ok = true; } } catch (e) { ok = false; }
        }
      } else {
        try {
          if (typeof avApplyParam === "function") ok = avApplyParam(p, v) !== false;
          else if (typeof avParams !== "undefined" && avParams && typeof avParams === "object") { avParams[p] = v; ok = true; }
        } catch (e) { ok = false; }
      }
      if (ok) applied++; else refused++;
    }
    avWizPaintParams(set);
    const synth = avLessonCardEl("av-synth");
    if (synth) avLessonReveal(synth);
    avWizState.applied = true;
    avLessonsState.lastWiz = avWizState.kind;
    if (refused > 0) avLessonsState.lastNote = "wizard " + avWizState.kind + ": " + applied + " param" + (applied === 1 ? "" : "s") + " applied, " + refused + " refused";
    else avLessonsState.lastNote = "wizard " + avWizState.kind + ": " + applied + " param" + (applied === 1 ? "" : "s") + " applied";
    avLessonsPublish();
    return true;
  } catch (e) { return false; }
}

/* ---------- audition (4 notes on the ONE note bus; timers tracked, notes released on close) ---------- */

function avWizClearTimers() {
  const t = avWizState.timers;
  for (let i = 0; i < t.length; i++) { try { if (typeof clearTimeout === "function") clearTimeout(t[i]); } catch (e) { /* gone */ } }
  avWizState.timers = [];
}

function avWizStopNotes() {
  avWizClearTimers();
  try {
    const spec = AV_LESSONS_WIZ[avWizState.kind];
    if (!spec || typeof avNoteUp !== "function") return;
    for (let i = 0; i < spec.phrase.length; i++) {
      try { avNoteUp(spec.phrase[i]); } catch (e) { /* bus gone */ }
    }
  } catch (e) { /* never throw out */ }
}

function avWizAudition() {
  try {
    const spec = AV_LESSONS_WIZ[avWizState.kind];
    if (!spec) return false;
    avWizStopNotes();
    for (let i = 0; i < spec.phrase.length; i++) {
      const name = spec.phrase[i];
      const tDown = setTimeout(function () {
        try { if (typeof avNoteDown === "function") avNoteDown(name, 0.85); } catch (e) { /* bus gone */ }
      }, i * spec.gap);
      const tUp = setTimeout(function () {
        try { if (typeof avNoteUp === "function") avNoteUp(name); } catch (e) { /* bus gone */ }
      }, i * spec.gap + spec.dur);
      avWizState.timers.push(tDown, tUp);
    }
    avWizState.note = "audition — " + spec.phrase.join(" ");
    avLessonsState.lastNote = avWizState.note;
    avWizRender();
    avLessonsPublish();
    return true;
  } catch (e) { return false; }
}

/* ---------- open / reroll / keep / discard ---------- */

function avWizRun(kind) {
  try {
    const k = avWizKindNorm(kind);
    if (!k) return false;
    const el = avWizEnsure();
    if (!el) return false;
    if (!avWizState.open) {
      avWizState.snap = avLessonParamsSnap();
      avWizState.rerolls = 0;
      avWizState.note = "pick one option per row, then AUDITION";
    }
    avWizState.kind = k;
    avWizState.sel = [0, 0, 0];
    avWizState.appliedRows = [false, false, false];
    avWizState.applied = false;
    avWizState.open = true;
    el.hidden = false;
    el.classList.add("av-wiz-on");
    avWizRender();
    avLessonsState.lastWiz = k;
    avLessonsState.lastNote = "wizard " + k + " open";
    avLessonsPublish();
    return true;
  } catch (e) { return false; }
}

function avWizReroll() {
  try {
    const spec = AV_LESSONS_WIZ[avWizState.kind];
    if (!spec) return false;
    for (let i = 0; i < spec.rows.length; i++) {
      const n = spec.rows[i].options.length;
      if (n > 0) avWizState.sel[i] = (avWizState.sel[i] + 1) % n;
      avWizState.appliedRows[i] = true;
    }
    avWizState.rerolls += 1;
    avWizApply();
    const names = [];
    for (let i = 0; i < spec.rows.length; i++) {
      const opt = spec.rows[i].options[avWizState.sel[i]];
      if (opt) names.push(opt.name);
    }
    avWizState.note = "variant " + (avWizState.rerolls + 1) + " — " + names.join(" · ");
    avWizRender();
    return true;
  } catch (e) { return false; }
}

function avWizClosePanel() {
  try {
    avWizStopNotes();
    const doc = avLessonDoc();
    const el = doc ? doc.getElementById("av-wiz") : null;
    if (el) { el.hidden = true; el.classList.remove("av-wiz-on"); }
  } catch (e) { /* panel gone */ }
  avWizState.open = false;
  avWizState.snap = null;
}

/* KEEP: params stay; the checkpoint is pushed on the "params" domain AFTER the change (P4 law) */
function avWizKeep() {
  try {
    if (!avWizState.open) return false;
    const kind = avWizState.kind;
    let pushed = false;
    try { if (typeof avUndoPush === "function") pushed = avUndoPush("params", "wizard " + kind) === true; } catch (e) { pushed = false; }
    avLessonsState.lastWiz = kind;
    avLessonsState.lastNote = pushed
      ? "wizard " + kind + " kept — Ctrl+Z reverts the sweep"
      : "wizard " + kind + " kept — the params are yours";
    avWizClosePanel();
    avLessonsPublish();
    return true;
  } catch (e) { return false; }
}

/* ✕ discard: put the pre-wizard values of every touched key back through the funnel */
function avWizDiscard() {
  try {
    const snap = avWizState.snap;
    let restored = 0;
    if (snap) {
      for (const p in snap) {
        if (!Object.prototype.hasOwnProperty.call(snap, p)) continue;
        let cur;
        try { cur = (typeof avParams !== "undefined" && avParams) ? avParams[p] : undefined; } catch (e) { cur = undefined; }
        if (cur === snap[p]) continue;
        try {
          if (typeof avApplyParam === "function" && avApplyParam(p, snap[p]) !== false) restored++;
          else if (typeof avApplyParam !== "function" && typeof avParams !== "undefined" && avParams) { avParams[p] = snap[p]; restored++; }
        } catch (e) { /* one key must not stop the discard */ }
      }
    }
    avLessonsState.lastNote = "wizard dismissed — " + restored + " knob" + (restored === 1 ? "" : "s") + " went back";
    avWizClosePanel();
    avLessonsPublish();
    return true;
  } catch (e) { return false; }
}

function avWizClick(e) {
  try {
    const t = (e && e.target && typeof e.target.closest === "function") ? e.target : null;
    if (!t) return;
    const tab = t.closest(".av-wiz-tab");
    if (tab) {
      const k = avWizKindNorm(tab.getAttribute("data-wizk"));
      if (k) {
        avWizState.kind = k;
        avWizState.sel = [0, 0, 0];
        avWizState.appliedRows = [false, false, false];
        avWizState.rerolls = 0;
        avWizState.note = "pick one option per row, then AUDITION";
        avWizRender();
      }
      return;
    }
    if (t.closest("#av-wiz-audition")) { avWizAudition(); return; }
    if (t.closest("#av-wiz-reroll")) { avWizReroll(); return; }
    if (t.closest("#av-wiz-keep")) { avWizKeep(); return; }
    if (t.closest("#av-wiz-close")) { avWizDiscard(); return; }
    const opt = t.closest(".av-wiz-opt");
    if (opt) {
      const r = Math.round(Number(opt.getAttribute("data-wizrow")));
      const o = Math.round(Number(opt.getAttribute("data-wizopt")));
      const spec = AV_LESSONS_WIZ[avWizState.kind];
      if (!spec || !(r >= 0 && r < spec.rows.length) || !isFinite(o)) return;
      if (!spec.rows[r].options[o]) return;
      avWizState.sel[r] = o;
      avWizState.appliedRows[r] = true;
      avWizApply();
      avWizState.note = "picked " + spec.rows[r].options[o].name + " — AUDITION to hear it, KEEP to lock it in";
      avWizRender();
      return;
    }
  } catch (err) { /* a listener never throws outward */ }
}

/* ==============================================================================================
   INIT
   ============================================================================================== */

function avLessonsInit() {
  try {
    avLessonsState.inited = true;
    avLessonsState.mounts += 1;
    avLessonFirstRunMount();
    avLessonsPublish();
    return true;
  } catch (e) { return false; }
}

/* publish the handle at load (guarded — plain node skips it) */
if (typeof window !== "undefined") {
  avLessonsPublish();
}
