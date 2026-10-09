/* av_note.js — the ONE note bus (Anvil). Every input surface routes here: the 61-key piano dock,
   the computer-typing keys, and the Web MIDI deck. The audio engine (P1 worklet) registers as the
   sink when it exists; until then notes are visible through the observables only.

   LAWS preserved from Pattern Forge's kbNoteDown / kbNoteUp / kbNoteStopAll
   (src/app_kb.js L454-487; see research/reuse/kb-port-digest.md §4):
   - dedupe on the note key (name, or name@channel for MPE member notes) — a second down for a held name is a no-op (also the key-repeat guard;
     nothing anywhere handles e.repeat).
   - velocity is OPTIONAL and arrives pre-scaled (hardware passes vel/127); gain clamps 0.05..1,
     default 0.9. The optional 4th arg (opts - T wave: the tuning/scheduler pass-through) rides
     avNoteSink.on untouched; no caller supplies one here, so the sink sees undefined (pre-T).
   - notes the engine "took" are tracked — their release goes through the sink; nothing heavy runs.
   - stop-all clears every structure (panic safety: leaving KEYS, CC 120/123, device change).
   - observables suites rely on: window.__lastNotePreview (name on every fresh down),
     window.__lastNoteCode (null while the engine is the note path).
   DOM-free; sink calls are fully guarded. */
"use strict";

const AV_NOTE_MIN_GAIN = 0.05;
const AV_NOTE_DEF_GAIN = 0.9;

const avNoteHeld = new Set();      /* held note keys (name, or name@ch for MPE member notes) */
const avNoteGains = new Map();     /* key -> velocity gain (hardware keys); default 0.9 */
const avNoteTaken = new Map();     /* key -> {name, ch} the engine sink took */
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

/* the engine (P1) registers { on(midi, gain, name, ch, opts)->bool, off(midi, name, ch), allOff() } — or null */
function avNoteSetSink(sink) {
  avNoteSink.on = (sink && typeof sink.on === "function") ? sink.on : null;
  avNoteSink.off = (sink && typeof sink.off === "function") ? sink.off : null;
  avNoteSink.allOff = (sink && typeof sink.allOff === "function") ? sink.allOff : null;
}

/* the bus key: the plain name for the global path, "name@ch" for MPE member channels (1..15) */
function avNoteKey(name, ch) {
  const c = Math.floor(Number(ch));
  return (isFinite(c) && c > 0) ? name + "@" + c : name;
}

/* returns true when this call started a fresh note; ch > 0 tags an MPE member channel;
   opts (optional 4th param, T wave) rides the sink call untouched - undefined when omitted */
function avNoteDown(name, vel, ch, opts) {
  const key = avNoteKey(name, ch);
  if (!name || avNoteHeld.has(key)) return false;
  avNoteHeld.add(key);
  /* optional gain: hardware keyboards pass velocity/127, the dock and typing keys do not */
  if (typeof vel === "number" && isFinite(vel)) avNoteGains.set(key, Math.max(AV_NOTE_MIN_GAIN, Math.min(1, vel)));
  const c = Math.floor(Number(ch));
  const mpeCh = (isFinite(c) && c > 0) ? c : 0;
  if (mpeCh === 0) { window.__lastNotePreview = name; window.__lastNoteCode = null; }   /* the dock preview stays global-notes-only */
  const midi = avNoteParse(name);
  let taken = false;
  if (midi != null && typeof avNoteSink.on === "function") {
    const g0 = avNoteGains.has(key) ? avNoteGains.get(key) : AV_NOTE_DEF_GAIN;
    try { taken = avNoteSink.on(midi, Math.max(AV_NOTE_MIN_GAIN, Math.min(1, g0)), name, mpeCh, opts) === true; } catch (e) { taken = false; }
  }
  if (taken) avNoteTaken.set(key, { name: name, ch: mpeCh });
  return true;
}

function avNoteUp(name, ch) {
  const key = avNoteKey(name, ch);
  if (!name || !avNoteHeld.delete(key)) return false;
  avNoteGains.delete(key);
  const t = avNoteTaken.get(key);
  if (t) {
    avNoteTaken.delete(key);
    const midi = avNoteParse(t.name);
    if (midi != null && typeof avNoteSink.off === "function") {
      try { avNoteSink.off(midi, t.name, t.ch); } catch (e) { /* sink gone */ }
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
  const held = [];
  const heldCh = [];
  avNoteHeld.forEach(function (k) {
    const at = k.lastIndexOf("@");
    if (at > 0) heldCh.push({ name: k.slice(0, at), ch: Number(k.slice(at + 1)) });
    else held.push(k);
  });
  const taken = [];
  avNoteTaken.forEach(function (t) { if (t.ch === 0) taken.push(t.name); });
  return { held: held, heldCh: heldCh, taken: taken, sink: !!avNoteSink.on };
}

if (typeof window !== "undefined") window.__avNotes = avNoteState;
