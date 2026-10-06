/* av_note.js — the ONE note bus (Anvil). Every input surface routes here: the 61-key piano dock,
   the computer-typing keys, and the Web MIDI deck. The audio engine (P1 worklet) registers as the
   sink when it exists; until then notes are visible through the observables only.

   LAWS preserved from Pattern Forge's kbNoteDown / kbNoteUp / kbNoteStopAll
   (src/app_kb.js L454-487; see research/reuse/kb-port-digest.md §4):
   - dedupe on the note NAME — a second down for a held name is a no-op (also the key-repeat guard;
     nothing anywhere handles e.repeat).
   - velocity is OPTIONAL and arrives pre-scaled (hardware passes vel/127); gain clamps 0.05..1,
     default 0.9.
   - notes the engine "took" are tracked — their release goes through the sink; nothing heavy runs.
   - stop-all clears every structure (panic safety: leaving KEYS, CC 120/123, device change).
   - observables suites rely on: window.__lastNotePreview (name on every fresh down),
     window.__lastNoteCode (null while the engine is the note path).
   DOM-free; sink calls are fully guarded. */
"use strict";

const AV_NOTE_MIN_GAIN = 0.05;
const AV_NOTE_DEF_GAIN = 0.9;

const avNoteHeld = new Set();      /* held note names */
const avNoteGains = new Map();     /* name -> velocity gain (hardware keys); default 0.9 */
const avNoteTaken = new Set();     /* names the engine sink took */
const avNoteSink = { on: null, off: null, allOff: null };

/* 'c4' -> 60, 'f#3' -> 54; null when unparseable */
function avNoteParse(name) {
  const m = /^([a-g])(#?)(-?\d+)$/.exec(String(name == null ? "" : name).toLowerCase());
  if (!m) return null;
  const pc = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1]];
  return (Number(m[3]) + 1) * 12 + pc + (m[2] ? 1 : 0);
}

/* 60 -> 'c4' (the PF kbNoteName shape, app_kb.js L249-254) */
function avNoteName(midi) {
  const m = Math.round(Number(midi));
  if (!isFinite(m)) return "";
  const names = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
  return names[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

function avNoteGain(name) {
  const g = avNoteGains.get(name);
  if (typeof g === "number" && isFinite(g)) return Math.max(AV_NOTE_MIN_GAIN, Math.min(1, g));
  return AV_NOTE_DEF_GAIN;
}

/* the engine (P1) registers { on(midi, gain, name)->bool, off(midi, name), allOff() } — or null */
function avNoteSetSink(sink) {
  avNoteSink.on = (sink && typeof sink.on === "function") ? sink.on : null;
  avNoteSink.off = (sink && typeof sink.off === "function") ? sink.off : null;
  avNoteSink.allOff = (sink && typeof sink.allOff === "function") ? sink.allOff : null;
}

/* returns true when this call started a fresh note */
function avNoteDown(name, vel) {
  if (!name || avNoteHeld.has(name)) return false;
  avNoteHeld.add(name);
  /* optional gain: hardware keyboards pass velocity/127, the dock and typing keys do not */
  if (typeof vel === "number" && isFinite(vel)) avNoteGains.set(name, Math.max(AV_NOTE_MIN_GAIN, Math.min(1, vel)));
  window.__lastNotePreview = name;
  window.__lastNoteCode = null;   /* the engine is the note path */
  const midi = avNoteParse(name);
  let taken = false;
  if (midi != null && typeof avNoteSink.on === "function") {
    try { taken = avNoteSink.on(midi, avNoteGain(name), name) === true; } catch (e) { taken = false; }
  }
  if (taken) avNoteTaken.add(name);
  return true;
}

function avNoteUp(name) {
  if (!name || !avNoteHeld.delete(name)) return false;
  avNoteGains.delete(name);
  if (avNoteTaken.delete(name)) {
    const midi = avNoteParse(name);
    if (midi != null && typeof avNoteSink.off === "function") {
      try { avNoteSink.off(midi, name); } catch (e) { /* sink gone */ }
    }
  }
  return true;
}

function avNoteStopAll() {
  const hadTaken = avNoteTaken.size > 0;
  avNoteHeld.clear();
  avNoteGains.clear();
  avNoteTaken.clear();
  if (hadTaken && typeof avNoteSink.allOff === "function") {
    try { avNoteSink.allOff(); } catch (e) { /* sink gone */ }
  }
}

function avNoteState() {
  return { held: [...avNoteHeld], taken: [...avNoteTaken], sink: !!avNoteSink.on };
}

if (typeof window !== "undefined") window.__avNotes = avNoteState;
