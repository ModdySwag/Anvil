/* av_kb.js — the 61-key piano dock + the ONE keydown dispatcher (Anvil). Ported from Pattern Forge's
   app_kb.js (src/app_kb.js) per research/reuse/kb-port-digest.md §7.2: constants, dock, note path and
   the dispatcher are PORT/ADAPT; the popout keyboard (§3.7), the keymap overlay, Kody teaches and the
   offline FAQ are SKIP. Every note routes through the avNote bus (av_note.js) — nothing here ever
   sounds a note itself, and nothing here redefines the bus.

   LAWS preserved (PF source refs):
   - THE ONE document keydown listener for the whole app (T9 §9): it is installed HERE by avKbInit and
     everything routes through avKbHandle — never add a second one.
   - Escape is claimed (preventDefault) before it acts — the browser's own "stop loading" otherwise
     aborts the boot fetch and takes the headless renderer down (PF L1105-1107); esc chain PF L1043-1063.
   - typing keys: keydown stores the note each key started in avHeldByKey; keyup releases THAT NOTE,
     never the raw key — passing the key back "left the note droning forever" (PF L1312-1314).
   - leaving KEYS must never leave a note droning (PF L551): avSetInputMode stops all notes and clears
     avHeldByKey the moment the mode leaves 'keys'.
   - pointer wiring lives in avPianoBind, bind-once via a dataset guard — a rebuilt bed otherwise "came
     back visually perfect but unclickable" (PF L646-648).
   - a11y F9: a keyboard-synthesised activation (e.detail === 0) plays the note and times its release,
     so the pointer path is not doubled up (PF L667-676).
   - NO e.repeat handling anywhere — the held-name dedupe inside avNoteDown is the repeat guard (§2).
   - dock geometry (PF L314-337): 36 whites share the width (W = 100/36), the 25 blacks sit absolutely
     on the boundaries (left = (belowIdx + 1) * W - BW/2, BW = W * 0.6); the typing maps are
     Ableton-style, A-row white / W-row black, semitones above the window C (PF L261-268).

   Session prefs (localStorage): 'av-piano' ('1' open — the default / '0' closed), 'av-input-mode'.
   DOM-free top level (parse-safe for the node harness); the only window touch is the __avKb handle at
   the very bottom, typeof-guarded. */
"use strict";

/* ---------- constants (PF L249-268, L278-279, L207) ---------- */

const AV_KB_MODE_LS = "av-input-mode";     /* 'studio' | 'keys' | 'midi' */
const AV_KB_PIANO_LS = "av-piano";         /* '1' dock open (the default) | '0' closed */
const AV_KB_MODES = ["studio", "keys", "midi"];

const AV_PIANO_LO = 36;                    /* C2 in MIDI */
const AV_PIANO_HI = 96;                    /* C7 — 61 keys inclusive (PF L256-259) */

/* Ableton-style typing-key mapping, semitones above the window's C.
   A-row = white keys, W-row = black keys (PF L261-264). */
const AV_PIANO_WHITE_KEYS = { a: 0, s: 2, d: 4, f: 5, g: 7, h: 9, j: 11, k: 12, l: 14, ";": 16 };
const AV_PIANO_BLACK_KEYS = { w: 1, e: 3, t: 6, y: 8, u: 10, o: 13, p: 15 };
const AV_PIANO_MAP = {};    /* typing key -> semitone offset */
const AV_PIANO_LABEL = {};  /* semitone offset -> typing-key letter (upper-case) */
for (const [ch, off] of Object.entries(AV_PIANO_WHITE_KEYS)) { AV_PIANO_MAP[ch] = off; AV_PIANO_LABEL[off] = ch.toUpperCase(); }
for (const [ch, off] of Object.entries(AV_PIANO_BLACK_KEYS)) { AV_PIANO_MAP[ch] = off; AV_PIANO_LABEL[off] = ch.toUpperCase(); }

/* letter -> pitch class, for the scale highlight (PF KB_PC L207) */
const AV_KB_PC = { c: 0, "c#": 1, db: 1, d: 2, "d#": 3, eb: 3, e: 4, f: 5, "f#": 6, gb: 6, g: 7, "g#": 8, ab: 8, a: 9, "a#": 10, bb: 10, b: 11 };

/* the one-line hint under the chips (adapted from PF kbModeHint L490-495 — no workstation jargon,
   single desk: exactly what the typing keys do right now) */
const AV_KB_HINTS = {
  studio: "STUDIO — letters are quiet here; ` or the KEYS chip makes the typing keys play.",
  keys: "KEYS — typing keys play the dock: A-row white (A = C), W-row black (W = C♯), Z / X hop octaves, Esc hands back.",
  midi: "MIDI — the hardware plays; PC letters stay quiet. Ctrl/Alt combos, F-keys and Space still work.",
};

/* the dock's own keymap (PF KB_DEFS rows L103-113, trimmed to the piano — no workstation, hub, Kody,
   drawer or edit combos). Ctrl+Alt+1/2/3 are handled directly in avKbHandle so they keep working from
   inside a text field (PF L1097-1099). */
const AV_KB_DEFS = [
  { id: "pianoToggle", key: "y", label: "Y", group: "Piano", desc: "Show / hide the 61-key piano dock", fn: "pianoToggle" },
  { id: "pianoArm", key: "`", label: "`", group: "Piano", desc: "INPUT: flip STUDIO ↔ KEYS — KEYS turns the typing keys into the dock (A = C, W = C♯, Z / X octaves)", fn: "pianoArm" },
  { id: "pianoOctDown", key: "[", label: "[", group: "Piano", desc: "Piano window octave down", fn: "pianoOct", arg: -1 },
  { id: "pianoOctUp", key: "]", label: "]", group: "Piano", desc: "Piano window octave up", fn: "pianoOct", arg: 1 },
];

/* ---------- state ---------- */

let avKbScale = "C:minor";           /* the dock's scale source (PF read the selected track's model;
                                        Anvil has no track equivalent yet, so module state instead) */
let avPianoWin = 2;                  /* octave window 0..3 -> base C2/C3/C4/C5 (PF L270) */
let avInputMode = "studio";          /* what the typing keyboard drives: STUDIO / KEYS / MIDI (PF L272-280) */
let avArmed = false;                 /* MIRRORS KEYS mode (armed === mode 'keys'), so the ` toggle, Esc,
                                        body.kb-armed and the DOM checks all keep their meaning (PF L276-277) */
const avHeldByKey = new Map();       /* typing key -> the note it started (the octave window can hop
                                        mid-hold; keyup releases through this map; PF L283) */
let avPianoMouseDown = false;        /* dock pointer held — the glide guard (PF kbMouseDown L285) */

/* ---------- pure helpers (node-testable) ---------- */

/* Parse a scale string like "C:minor:pentatonic" -> { root: "c", notes: [0,3,5,7,10] } (PF L191-205) */
function avKbScaleNotes(scale) {
  const out = { root: "c", notes: [0, 2, 4, 5, 7, 9, 11] };
  if (!scale || typeof scale !== "string") return out;
  const parts = scale.toLowerCase().split(":");
  if (parts[0]) out.root = parts[0];
  if (parts.includes("major")) out.notes = [0, 2, 4, 5, 7, 9, 11];
  else if (parts.includes("minor")) out.notes = [0, 2, 3, 5, 7, 8, 10];
  else if (parts.includes("dorian")) out.notes = [0, 2, 3, 5, 7, 9, 10];
  else if (parts.includes("mixolydian")) out.notes = [0, 2, 4, 5, 7, 9, 10];
  else if (parts.includes("lydian")) out.notes = [0, 2, 4, 6, 7, 9, 11];
  if (parts.includes("pentatonic")) {
    out.notes = parts.includes("major") ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10];
  }
  return out;
}

function avKbSetScale(s) {
  avKbScale = (typeof s === "string" && s) ? s : "C:minor";
  avPianoRefresh();
}

/* computer key -> note name at the current window, or null.
   No clamp, no fold: notes whose midi falls off 36..96 simply do not sound (PF L290-299). */
function avPianoNoteFor(key) {
  if (key === undefined || key === null) return null;
  const k = String(key).toLowerCase();
  if (k.length !== 1) return null;
  if (!(k in AV_PIANO_MAP)) return null;
  const midi = AV_PIANO_LO + avPianoWin * 12 + AV_PIANO_MAP[k];
  if (midi > AV_PIANO_HI || midi < AV_PIANO_LO) return null;
  return avNoteName(midi);
}

/* S5 (popout): the bed can live in the popout window (document adoption). Whichever document
   currently owns #piano-keys is the refresh root; falls back to the app document. */
function avPianoBedRoot() {
  try {
    if (typeof avKbPopKeysRoot === "function") { const r = avKbPopKeysRoot(); if (r) return r; }
  } catch (e) { /* popout module absent */ }
  return (typeof document !== "undefined") ? document : null;
}

/* ---------- the 61-key dock (PF L314-340, L343-410, L649-678) ---------- */

/* build the bed: 36 white keys share the width equally; the 25 black keys sit absolutely on the
   boundaries between whites (standard piano geometry, PF L314-316). */
function avPianoBuild() {
  const keysBox = document.getElementById("piano-keys");
  if (!keysBox) return;
  const whites = [];
  for (let m = AV_PIANO_LO; m <= AV_PIANO_HI; m++) {
    const pc = ((m % 12) + 12) % 12;
    if ([0, 2, 4, 5, 7, 9, 11].includes(pc)) whites.push(m);
  }
  const W = 100 / whites.length;      /* one white key, % of dock width */
  const BW = W * 0.6;                 /* black key width */
  let html = whites.map(m =>
    '<button class="pk-key pk-white" data-note="' + avNoteName(m) + '" data-midi="' + m + '" title="' + avNoteName(m) + '"></button>'
  ).join("");
  for (let m = AV_PIANO_LO + 1; m <= AV_PIANO_HI; m++) {
    const pc = ((m % 12) + 12) % 12;
    if (![1, 3, 6, 8, 10].includes(pc)) continue;
    const below = m - 1;              /* the white key just below this black */
    const belowIdx = whites.indexOf(below);
    const left = (belowIdx + 1) * W - BW / 2;
    html += '<button class="pk-key pk-black" data-note="' + avNoteName(m) + '" data-midi="' + m
      + '" title="' + avNoteName(m) + '" style="left:' + left.toFixed(3) + '%;width:' + BW.toFixed(3) + '%"></button>';
  }
  keysBox.innerHTML = html;
  avPianoRefresh();
}

/* class/label refresh — scale highlight, window letters, arm LED, chips, hint (PF L343-410) */
function avPianoRefresh() {
  const dock = document.getElementById("piano-dock");
  if (!dock) return;                                  /* a refresh is a no-op without the dock */
  const scale = avKbScaleNotes(avKbScale);
  const rootPC = AV_KB_PC[scale.root] ?? 0;
  const base = AV_PIANO_LO + avPianoWin * 12;
  const avBedRoot = avPianoBedRoot();
  if (avBedRoot) avBedRoot.querySelectorAll(".pk-key").forEach(k => {
    const midi = parseInt(k.dataset.midi, 10);
    const pc = ((midi % 12) + 12) % 12;
    const rel = (pc - rootPC + 12) % 12;
    k.classList.toggle("in-scale", scale.notes.includes(rel));      /* PF L354 */
    k.classList.toggle("root", rel === 0);                           /* PF L355 */
    const off = midi - base;
    const letter = (off >= 0 && AV_PIANO_LABEL[off]) ? AV_PIANO_LABEL[off] : "";
    k.classList.toggle("in-win", !!letter);                          /* PF L356-359 */
    if (letter !== (k.dataset.letter || "")) {
      k.dataset.letter = letter;
      let lab = k.querySelector(".pk-note");
      if (!lab) { lab = document.createElement("span"); lab.className = "pk-note"; k.appendChild(lab); }
      lab.textContent = avNoteName(midi);
      let kc = k.querySelector(".pk-keycap");
      if (letter) {
        if (!kc) { kc = document.createElement("span"); kc.className = "pk-keycap"; k.appendChild(kc); }
        kc.textContent = letter;
      } else if (kc) kc.remove();
    }
  });
  const winLbl = document.getElementById("pk-win");
  if (winLbl) winLbl.textContent = "OCT " + avNoteName(base).toUpperCase();
  const led = document.getElementById("pk-arm-led");
  if (led) led.classList.toggle("on", avArmed);
  document.body.classList.toggle("kb-armed", avArmed);
  document.body.classList.toggle("kb-midi", avInputMode === "midi");
  /* the switcher: exactly one chip lit, and the one-line hint says what the keys do now */
  document.querySelectorAll("#pk-modes .pk-mode").forEach(b => {
    const on = b.dataset.mode === avInputMode;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const hint = document.getElementById("pk-mode-hint");
  if (hint) hint.textContent = (document.body.classList.contains("piano-pop") && typeof avKbPopHint === "function") ? avKbPopHint() : (AV_KB_HINTS[avInputMode] || AV_KB_HINTS.studio);
  if (typeof avKbPopMirror === "function") { try { avKbPopMirror(); } catch (e) { /* popout mirror is best-effort */ } }
}

/* The bed's pointer wiring lives HERE and is guarded so it can never bind twice. It used to be bound
   once in init — a bed REBUILT after a dead renderer came back visually perfect but unclickable:
   every pointer path silent, no error anywhere (PF L646-648). */
function avPianoBind(box) {
  if (!box || box.dataset.avBound === "1") return box;
  box.dataset.avBound = "1";
  box.addEventListener("pointerdown", (e) => {
    const k = e.target.closest(".pk-key");
    if (!k) return;
    e.preventDefault();
    avPianoMouseDown = true;
    avNoteDown(k.dataset.note);
  });
  /* slider/glide uses pointerOVER, not pointerEnter: pointerenter never re-fires on the container
     for a held pointer moving from one key onto a SIBLING key (non-bubbling; the container was
     never "entered" again) — the sweep was silently dead. PF shipped the same latent bug; suite
     cdp_keys caught it. pointerover bubbles from every key, so crossing sounds the new key while
     the old one stays held until release. */
  box.addEventListener("pointerover", (e) => {
    if (!avPianoMouseDown) return;
    const k = e.target.closest(".pk-key");
    if (k) avNoteDown(k.dataset.note);        /* glide: one note per key crossed while held */
  });
  box.addEventListener("pointerup", () => { avPianoMouseDown = false; avNoteStopAll(); });
  box.addEventListener("pointerleave", () => { avPianoMouseDown = false; avNoteStopAll(); });
  box.addEventListener("contextmenu", (e) => e.preventDefault());
  /* a <button> that ignores Enter is worse than no button: keyboard activation plays the note the
     same way a press does. e.detail is 0 for a keyboard-synthesised click, so the pointer path
     (which already sounded the note on pointerdown) is not doubled up (a11y audit F9, PF L667-676). */
  box.addEventListener("click", (e) => {
    if (e.detail > 0) return;
    const k = e.target.closest(".pk-key");
    if (!k) return;
    avNoteDown(k.dataset.note);
    setTimeout(avNoteStopAll, 350);
  });
  return box;
}

/* ---------- input mode + dock open (PF L544-591, L954-958) ---------- */

/* the ONE place the input mode changes: avArmed follows it, it persists, it repaints the dock */
function avSetInputMode(mode, opts) {
  if (AV_KB_MODES.indexOf(mode) < 0) mode = "studio";   /* corrupt/unknown -> STUDIO (PF L545) */
  const o = opts || {};
  avInputMode = mode;
  avArmed = (mode === "keys");
  if (o.persist !== false) { try { localStorage.setItem(AV_KB_MODE_LS, mode); } catch (e) { /* private mode */ } }
  /* leaving KEYS must never leave a note droning (PF L551) */
  if (mode !== "keys") { avNoteStopAll(); avHeldByKey.clear(); }
  avPianoRefresh();
}

/* the legacy arm switch is now just a shortcut into KEYS mode (avArmed === mode 'keys'; PF L561) */
function avSetArmed(v) { avSetInputMode(v ? "keys" : "studio"); }

function avPianoSetOpen(open) {
  /* S5: the popout brings the keys home first (PF law) — either direction */
  if (typeof avKbPopHome === "function") { try { avKbPopHome(); } catch (e) { /* popout home is best-effort */ } }
  document.body.classList.toggle("piano-closed", !open);
  try { localStorage.setItem(AV_KB_PIANO_LS, open ? "1" : "0"); } catch (e) { /* private mode */ }
  if (open) avPianoRefresh();          /* repaint on the way back in (PF L584) */
}

function avPianoToggle() {
  const closed = document.body.classList.contains("piano-closed");
  avPianoSetOpen(closed);
}

function avPianoOctStep(dir) {
  const step = (typeof dir === "number" && isFinite(dir)) ? dir : 0;
  avPianoWin = Math.max(0, Math.min(3, avPianoWin + step));   /* clamp 0..3 (PF L954-958) */
  avPianoRefresh();
}

/* ---------- dispatcher: the ONE keydown path (PF L982-1067, L1069-1167) ---------- */

/* def -> action — trimmed to the dock's own cases (no workstation, hub, Kody or edit actions) */
function avKbDo(id, arg) {
  const def = AV_KB_DEFS.find(d => d.id === id);
  /* dispatch on the def's fn (ids like 'pianoOctDown'/'pianoOctUp' alias one shared fn) */
  const fn = (def && def.fn) || id;
  switch (fn) {
    case "pianoToggle": avPianoToggle(); break;
    case "pianoArm": avSetInputMode(arg || (avArmed ? "studio" : "keys")); break;   /* PF L1038 */
    case "pianoOct": avPianoOctStep(arg); break;                                    /* PF L1040 */
  }
}

function avKbHandle(e) {
  /* a forwarded key can arrive with no target: treat that as "not typing" — a real event always
     carries one (PF L1069-1076). */
  const t = e.target || document.body;
  const tag = ((t && t.tagName) || "").toLowerCase();
  const typing = tag === "input" || tag === "textarea" || tag === "select" || !!(t && t.isContentEditable);
  const mod = e.ctrlKey || e.metaKey;

  /* S5: the help overlay + command palette own their keys before any other dispatch
     (avUiKeyHook lives in av_help.js; it consumes only what it owns and returns false otherwise) */
  if (typeof avUiKeyHook === "function") { try { if (avUiKeyHook(e) === true) return; } catch (e2) { /* hook miss never blocks the dispatcher */ } }

  /* (1) the input-mode picks are modifier combos, so they must work from inside a text field too
     (PF L1097-1099) */
  if (mod && e.altKey && !e.shiftKey && /^[123]$/.test(e.key)) {
    e.preventDefault();
    avSetInputMode(e.key === "1" ? "studio" : e.key === "2" ? "keys" : "midi");
    return;
  }

  /* (2) Esc is ours: every other key the app acts on prevents the browser default, and Escape is the
     one key the browser still claims for itself ("stop loading" — it can abort the boot fetch, and in
     headless builds it takes the renderer down). Claim it, then act (PF L1105-1108).
     esc chain (PF L1043-1063): armed -> hand the keyboard back; else a focused field gives up the
     caret — the same promise the piano makes ("Esc hands the keyboard back"). */
  if (e.key === "Escape") {
    e.preventDefault();
    if (avArmed) { avSetArmed(false); return; }
    const ae = document.activeElement;
    if (ae && ae !== document.body && typeof ae.blur === "function"
      && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) ae.blur();
    return;
  }

  if (typing) return;   /* PF L1109: nothing single-letter fires from a focused field */

  /* R11: Space = transport play/pause (industry standard; the console mirrors it). Falls through
     when the target is a control (a focused button keeps native Space) or when typing above. */
  if (e.key === " " && !mod && !e.altKey && !e.shiftKey) {
    let onCtl = false;
    try {
      const t2 = e.target;
      onCtl = !!(t2 && typeof t2.closest === "function" && t2.closest("button, select, input, textarea, a, [role=button]"));
    } catch (e3) { onCtl = false; }
    if (!onCtl && typeof avConsoleTransportToggle === "function") {
      e.preventDefault();
      try { avConsoleTransportToggle(); } catch (e4) { /* the transport never blocks keys */ }
      return;
    }
  }

  /* (3) MIDI: the hardware owns the notes. One unmodified PC key must never fire an action
     mid-performance, so every printable key and the navigation cluster is swallowed here; the F-keys
     fall through (PF L1111-1123). ` still hands the piano back. */
  if (avInputMode === "midi") {
    if (e.key === "`") { e.preventDefault(); avSetInputMode(avArmed ? "studio" : "keys"); return; }
    if (e.key === " ") { e.preventDefault(); return; }
    if (!/^F([1-9]|1[0-2])$/.test(e.key)) {
      if (e.key.length === 1 || /^(Arrow|Delete|Backspace|Page|Home|End|Insert)/.test(e.key)) e.preventDefault();
      return;
    }
    /* F1-F12 fall through to the keymap below */
  }

  /* (4) KEYS: the typing keys become the dock (A-row white, W-row black). ALT is excluded — Alt+letter
     belongs to the OS menubar and would otherwise play a note while the piano is armed (PF L1125-1128). */
  if (avArmed && !mod && !e.shiftKey && !e.altKey) {
    const k2 = String(e.key || "").toLowerCase();
    if (k2 === "z") { e.preventDefault(); avPianoOctStep(-1); return; }              /* PF L1144 */
    if (k2 === "x") { e.preventDefault(); avPianoOctStep(1); return; }               /* PF L1145 */
    if (e.key === "ArrowLeft") { e.preventDefault(); avPianoOctStep(-1); return; }   /* PF L1140-1142 */
    if (e.key === "ArrowRight") { e.preventDefault(); avPianoOctStep(1); return; }
    if (e.key === " ") { e.preventDefault(); return; }   /* PF L1138 — Space stays claimed (no transport yet) */
    const note = avPianoNoteFor(k2);
    if (note) { e.preventDefault(); avNoteDown(note); avHeldByKey.set(k2, note); return; }   /* PF L1147-1148 */
    /* swallow typing keys so no shortcuts fire mid-performance (PF L1149-1150) */
    if (/^[a-z0-9;,./\[\]=\-]$/.test(k2)) { e.preventDefault(); return; }
  }

  /* (5) KB_DEFS lookup: exact lowercased key + exact mod/shift/alt match (PF L1156-1167) */
  const k = String(e.key || "").toLowerCase();
  const def = AV_KB_DEFS.find(d => {
    if (d.key.toLowerCase() !== k) return false;
    if (!!d.mod !== mod) return false;
    if (!!d.shift !== e.shiftKey) return false;
    if (!!d.alt !== e.altKey) return false;
    return true;
  });
  if (!def) return;
  e.preventDefault();
  avKbDo(def.id, def.arg);
  avPianoRefresh();   /* keep scale/window highlights in sync after any key action (PF L1167) */
}

/* ---------- init (PF L1256-1321 minus the popout / desk / voice pickers) ---------- */

let avKbInited = false;

function avKbInit() {
  if (typeof document === "undefined") return false;
  if (avKbInited) return true;        /* idempotent: never a second build, never a second listener */
  avKbInited = true;

  /* dock open prefs — 'av-piano' ('0' closed; default open) */
  try {
    const saved = localStorage.getItem(AV_KB_PIANO_LS);
    document.body.classList.toggle("piano-closed", saved === "0");
  } catch (e) { /* private mode */ }

  avPianoBuild();                                             /* fill #piano-keys (bails without it) */
  avPianoBind(document.getElementById("piano-keys"));

  const pianoBtn = document.getElementById("btn-piano");
  if (pianoBtn) pianoBtn.addEventListener("click", avPianoToggle);
  const closeBtn = document.getElementById("pk-close");
  if (closeBtn) closeBtn.addEventListener("click", () => avPianoSetOpen(false));
  const octD = document.getElementById("pk-oct-down");
  if (octD) octD.addEventListener("click", () => avPianoOctStep(-1));
  const octU = document.getElementById("pk-oct-up");
  if (octU) octU.addEventListener("click", () => avPianoOctStep(1));

  /* restore the input mode; corrupt/unknown stored values fall back to STUDIO (PF L1284-1286) */
  let savedMode = "studio";
  try { const s = localStorage.getItem(AV_KB_MODE_LS); if (s && AV_KB_MODES.indexOf(s) >= 0) savedMode = s; } catch (e) { /* private mode */ }
  avSetInputMode(savedMode, { persist: false });

  document.querySelectorAll("#pk-modes .pk-mode").forEach(b => {
    b.addEventListener("click", () => avSetInputMode(b.dataset.mode));
  });

  /* THE ONE keydown listener for the whole app (T9 §9 — in PF the binding lives in app_ui.js; in
     Anvil avKbInit installs it). Never add a second one. */
  document.addEventListener("keydown", (e) => { avKbHandle(e); });

  /* keyup -> release held piano notes while armed. The note NAME (not the key) is what avNoteDown
     stored, so remember which note each typing key started — passing the raw key back (the
     pre-switcher behaviour) never matched and left the note droning forever (PF L1312-1321). */
  document.addEventListener("keyup", (e) => {
    if (!avArmed || e.ctrlKey || e.metaKey) return;
    const k = String(e.key || "").toLowerCase();
    const note = avHeldByKey.get(k);
    avHeldByKey.delete(k);
    if (note) avNoteUp(note);
  });

  return true;
}

/* ---------- debug/verify surface ---------- */

/* the whole module's state in one object — window.__avKb (suites + console) */
function avKbSnap() {
  let closed = false, dock = false;
  try {
    if (typeof document !== "undefined" && document.body) {
      closed = document.body.classList.contains("piano-closed");
      dock = !!document.getElementById("piano-dock");
    }
  } catch (e) { /* no DOM */ }
  return {
    mode: avInputMode,
    armed: avArmed,
    win: avPianoWin,
    closed: closed,
    held: [...avHeldByKey.values()],   /* the notes the typing keys started — keyup releases through the same map */
    dock: dock,
  };
}

if (typeof window !== "undefined") window.__avKb = avKbSnap;
