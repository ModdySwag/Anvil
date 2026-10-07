/* av_mpe_deck.js — Anvil M2 wave (child sa-B): the Web MIDI deck's MPE surface — the member-channel
   routing branch (the av_midi input-router hook) + the deck panel's MPE row.
   Wave contract: verify/_m2_wave.md §2.2 (pins) · §4.6 (integration sites — the parent OWNS every
   edit to src/av_midi.js; this file never touches it).

   WHAT THIS IS
   - MPE = one master channel (MIDI ch 1) + 15 member channels (MIDI ch 2–16). Member notes ride the
     ONE note bus (avNoteDown / avNoteUp from av_note.js) TAGGED with their member channel; per-note
     expression (bend / pressure / timbre / pan) is forwarded to the engine through the av_engine
     facade senders avEngineMpeSet / avEngineMpeExpr (§4.5).
   - The deck (av_midi.js) owns the panel: this file only supplies the row markup
     (avMpeDeckPanelHTML — the parent splices it after the CLOCK OUT block, before the LEARN block),
     re-binds the row controls (avMpeDeckWire — the parent calls it from avMidiRender), and paints
     its live readouts itself.

   CHANNEL MAPPING (read before touching the router)
   - avMidiDecode (src/av_midi.js L182-216) builds `chan = (status & 0x0f) + 1` — the decoded object
     is 1-based ("1-based for the panel", L187). The MPE kernel (AVM, §2.1) and every ch argument on
     the avNote bus / engine senders are 0-based member channels 1..15 (ch 0 = master, §4.2).
     So this file converts memberCh = m.chan − 1 and consumes only when memberCh >= 1 (decoded chan
     2..16 = MIDI ch 2..16). Decoded chan 1 = MIDI ch 1 = master → ALWAYS falls through to the
     global path (avMidiNoteOn / avMidiBendIncoming / the CC chain), which also keeps the CC 120/123
     panic alive. The §2.2 wording ".chan 0-based" describes the routing channel, not the raw field.

   LAWS (house)
   - "use strict"; page module (never joins the worklet concat); DOM-free at load (no document reach
     runs at eval time; window is touched only through typeof).
   - ONE namespace: every top-level name is avMpeDeck* (state included; AV_MPE_DECK_* constants).
   - every foreign reach is typeof-guarded + try/catch'd: this file may load before av_note.js /
     av_engine.js / av_midi.js; the panel host (#av-midi-body) and the engine may both come later.
   - nothing here ever throws: avMpeDeckIncoming returns false and the message continues on the
     normal path; panel work fails quietly.
   - persistence rides the deck's own prefs and save funnel (avMidiPrefs.mpe / avMidiPrefs.mpeBend +
     avMidiSavePrefs, added by the parent per §4.6). A module-local mirror keeps the file coherent
     in worlds where the deck object does not exist; in the page avMidiPrefs is always reachable
     (js_parts order pins av_mpe_deck.js after av_midi.js).
   - avMpeDeckRelease() is the broom the deck calls from avMidiReleaseAll + avMidiChannelMode (§4.6;
     those lines must run even when avMidiHeld is empty — see the report / §2.2). avMpeDeckSet(false)
     brooms too. Expression state itself is cleared by the ENGINE on zone-off (AVM.setZone) — this
     file never clears it directly.
   - release bookkeeping uses the bus key law from §4.2: key = ch > 0 ? name + "@" + ch : name.
   - the router always dispatches 0-based member ch (1..15): avNoteDown(name, vel/127, ch) ·
     avNoteUp(name, ch) · avEngineMpeExpr(ch, dim, v) · avEngineMpeSet(on, bend).

   API (exact, §2.2): avMpeDeckInit · avMpeDeckIncoming · avMpeDeckRelease · avMpeDeckSet ·
   avMpeDeckSetBend · avMpeDeckPush · avMpeDeckPanelHTML · avMpeDeckWire · avMpeDeckSnap ·
   avMpeDeckClasses (the styles-block list, §4.10) + window.__avMpeDeck (version "m2.0").

   Panel pins: #av-midi-mpe-row · [data-midimpe] · #av-midi-mpe-bend · #av-midi-mpe-state ·
   #av-midi-mpe-active.
   NEW CSS classes emitted (avMpeDeckClasses(), the parent generates the styles block from it):
   av-midi-mpe · av-midi-select.

   Harness: cache/scratch/m2/mpedeck/harness.mjs (node; ALL-PASS "MPEDECK-HARNESS: n/n PASS"). */
"use strict";

const AV_MPE_DECK_VERSION = "m2.0";
const AV_MPE_DECK_BENDS = [24, 48, 96];   /* allowed zone ranges (semitone extremes, §2.1 / §2.2) */
const AV_MPE_DECK_BEND_DEF = 48;          /* fallback when the stored range is missing or mangled */

/* ---------- module state (namespace-prefixed, no globals leak) ---------- */

const avMpeDeckHeld = new Map();          /* busKey (name + "@" + ch) -> { name, ch } — member notes THIS deck holds */
const avMpeDeckMirror = { mpe: false, playIn: true, mpeBend: AV_MPE_DECK_BEND_DEF };  /* used only when avMidiPrefs is unreachable */
let avMpeDeckArmed = false;               /* avMpeDeckInit ran */
let avMpeDeckLastExpr = null;             /* { ch, dim, at } — last member expression the deck consumed */
let avMpeDeckPushCount = 0;               /* zone states delivered to the engine (init/set/setBend/push) */
const avMpeDeckWiredHosts = (typeof WeakSet === "function") ? new WeakSet() : null;

/* ---------- local helpers (no core leakage) ---------- */

const avMpeDeckEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function avMpeDeckDom() {
  try { if (typeof document !== "undefined" && document) return document; } catch (e) { /* no DOM */ }
  return null;
}

/* the deck's prefs object (av_midi.js state) — null when that file is not on this page yet */
function avMpeDeckPrefs() {
  try {
    if (typeof avMidiPrefs !== "undefined" && avMidiPrefs && typeof avMidiPrefs === "object") return avMidiPrefs;
  } catch (e) { /* TDZ / not loaded */ }
  return null;
}

function avMpeDeckLegalBend(n) {
  return (n === 24 || n === 48 || n === 96) ? n : AV_MPE_DECK_BEND_DEF;
}

/* zone armed? — strict, exactly the §2.2 gate: avMidiPrefs.mpe === true */
function avMpeDeckOn() {
  const p = avMpeDeckPrefs();
  return p ? p.mpe === true : avMpeDeckMirror.mpe === true;
}

/* the zone range — read-side legalises a mangled stored value to the 48 default */
function avMpeDeckBend() {
  const p = avMpeDeckPrefs();
  return avMpeDeckLegalBend(p ? Number(p.mpeBend) : Number(avMpeDeckMirror.mpeBend));
}

/* the full §2.2 consumption gate: MPE on AND play-in on */
function avMpeDeckGate() {
  if (!avMpeDeckOn()) return false;
  const p = avMpeDeckPrefs();
  const playIn = p ? p.playIn === true : avMpeDeckMirror.playIn === true;
  return playIn;
}

/* decoded chan (1-based, av_midi.js L187) -> 0-based member channel 1..15; -1 = not a member.
   Master (decoded 1 -> 0) and anything outside MIDI ch 2..16 falls through. */
function avMpeDeckMemberCh(chan) {
  const c = Number(chan);
  if (!isFinite(c)) return -1;
  const ch = Math.floor(c) - 1;
  return (ch >= 1 && ch <= 15) ? ch : -1;
}

function avMpeDeckNoteName(m) {
  if (m && typeof m.name === "string" && m.name) return m.name;
  if (m && typeof avNoteName === "function") {
    try { const n = avNoteName(m.note); if (n) return n; } catch (e) { /* name helper gone */ }
  }
  if (m && typeof m.note === "number" && isFinite(m.note)) return String(m.note);
  return "";
}

/* the deck's own clamp (avMidiNoteOn): raw 0..127, default 100 when absent */
function avMpeDeckVelByte(v) {
  const n = Number(v);
  if (!isFinite(n)) return 100;
  return Math.max(0, Math.min(127, Math.round(n)));
}

/* channel-aftertouch pressure: the decoded object carries it in data[1] (av_midiDecode sets no
   .value for touch); .value is honoured when a caller supplies it. null = nothing usable. */
function avMpeDeckTouchValue(m) {
  if (m && typeof m.value === "number" && isFinite(m.value)) return m.value;
  if (m && m.data && typeof m.data.length === "number" && m.data.length > 1) {
    const v = Number(m.data[1]);
    if (isFinite(v)) return v;
  }
  return null;
}

/* ---------- guarded foreign reaches (never throw) ---------- */

function avMpeDeckNoteDown(name, gain, ch) {
  if (typeof avNoteDown !== "function") return false;
  try { avNoteDown(name, gain, ch); return true; } catch (e) { return false; }
}

function avMpeDeckNoteUpCall(name, ch) {
  if (typeof avNoteUp !== "function") return false;
  try { avNoteUp(name, ch); return true; } catch (e) { return false; }
}

function avMpeDeckMonTouch() {
  if (typeof avMidiMonTouch !== "function") return false;
  try { avMidiMonTouch(); return true; } catch (e) { return false; }
}

/* the deck's LAST NOTE readout (av_midi.js module binding) — updated for member notes too */
function avMpeDeckTouchLastNote(m, name, velByte) {
  try {
    if (typeof avMidiLastNote === "undefined") return false;
    avMidiLastNote = { note: m.note, name: name, vel: velByte, at: Date.now() };
    return true;
  } catch (e) { return false; }
}

/* zone push: avEngineMpeSet(on, bend) — a push counts when the facade did not refuse it */
function avMpeDeckEngineSet(on, bend) {
  if (typeof avEngineMpeSet !== "function") return false;
  try {
    const r = avEngineMpeSet(on === true, bend);
    const ok = (r !== false);
    if (ok) avMpeDeckPushCount += 1;
    return ok;
  } catch (e) { return false; }
}

function avMpeDeckEngineExpr(ch, dim, v) {
  if (typeof avEngineMpeExpr !== "function") return false;
  try { return avEngineMpeExpr(ch, dim, v) === true; } catch (e) { return false; }
}

/* one member expression message -> engine. lastExpr is the DECK's routing record: it is written on
   every consumed expression even when the guarded engine reach is absent (not the engine's state). */
function avMpeDeckDispatch(ch, dim, v) {
  avMpeDeckLastExpr = { ch: ch, dim: dim, at: Date.now() };
  return avMpeDeckEngineExpr(ch, dim, v);
}

function avMpeDeckSavePrefs() {
  if (typeof avMidiSavePrefs !== "function") return false;
  try { avMidiSavePrefs(); return true; } catch (e) { return false; }
}

function avMpeDeckWriteMpe(v) {
  const p = avMpeDeckPrefs();
  if (p) { p.mpe = v; return true; }
  avMpeDeckMirror.mpe = v;
  return false;
}

function avMpeDeckWriteBend(n) {
  const p = avMpeDeckPrefs();
  if (p) { p.mpeBend = n; return true; }
  avMpeDeckMirror.mpeBend = n;
  return false;
}

/* normalise a mangled/missing stored pref set (init-time; no save — the parent's load constructor
   already supplies the defaults) */
function avMpeDeckReconcile() {
  const p = avMpeDeckPrefs();
  if (p) {
    p.mpe = (p.mpe === true);
    p.mpeBend = avMpeDeckLegalBend(Number(p.mpeBend));
  }
  avMpeDeckMirror.mpe = (avMpeDeckMirror.mpe === true);
  avMpeDeckMirror.mpeBend = avMpeDeckLegalBend(Number(avMpeDeckMirror.mpeBend));
  return true;
}

/* ---------- panel text + paint ---------- */

function avMpeDeckStateText() {
  const on = avMpeDeckOn();
  const bend = avMpeDeckBend();
  if (!on) return "off — member channels play like ordinary MIDI";
  const p = avMpeDeckPrefs();
  const playIn = p ? p.playIn === true : avMpeDeckMirror.playIn === true;
  if (!playIn) return "on · bend ±" + bend + " st — PLAY IN is off, nothing is routed";
  const held = avMpeDeckHeld.size;
  return "on · bend ±" + bend + " st · " + (held ? held + " held" : "ready");
}

/* ch is the 0-based member index; show the MIDI channel (ch + 1) a player knows */
function avMpeDeckActiveText() {
  if (!avMpeDeckHeld.size) return "—";
  const parts = [];
  avMpeDeckHeld.forEach(h => parts.push(h.name + "·ch" + (h.ch + 1)));
  return parts.join(" ");
}

/* live readouts — write only when the text actually changes */
function avMpeDeckPaint() {
  const doc = avMpeDeckDom();
  if (!doc || typeof doc.getElementById !== "function") return false;
  const row = doc.getElementById("av-midi-mpe-row");
  if (!row) return false;
  const st = doc.getElementById("av-midi-mpe-state");
  const stateText = avMpeDeckStateText();
  if (st && st.textContent !== stateText) st.textContent = stateText;
  const act = doc.getElementById("av-midi-mpe-active");
  const activeText = avMpeDeckActiveText();
  if (act && act.textContent !== activeText) act.textContent = activeText;
  const sel = doc.getElementById("av-midi-mpe-bend");
  const bendText = String(avMpeDeckBend());
  if (sel && sel.value !== bendText) sel.value = bendText;
  try { if (row.dataset) row.dataset.mpe = avMpeDeckOn() ? "1" : "0"; } catch (e) { /* dataset gone */ }
  return true;
}

/* full re-render of the row (set / setBend) — markup carries the baked state */
function avMpeDeckRenderRow() {
  const doc = avMpeDeckDom();
  if (!doc || typeof doc.getElementById !== "function") return false;
  let row = null;
  try { row = doc.getElementById("av-midi-mpe-row"); } catch (e) { row = null; }
  if (row && row.parentNode && typeof row.outerHTML === "string") {
    try { row.outerHTML = avMpeDeckPanelHTML(); return true; } catch (e) { /* fall through to paint */ }
  }
  return avMpeDeckPaint();
}

/* ---------- the panel row (§2.2 pins: #av-midi-mpe-row · [data-midimpe] · #av-midi-mpe-bend ·
   #av-midi-mpe-state · #av-midi-mpe-active) ---------- */

function avMpeDeckPanelHTML() {
  const on = avMpeDeckOn();
  const bend = avMpeDeckBend();
  const opts = AV_MPE_DECK_BENDS.map(b =>
    '<option value="' + b + '"' + (b === bend ? " selected" : "") + '>' +
    (b === 24 ? "±2 oct · bend 24" : b === 48 ? "±4 oct · bend 48" : "±8 oct · bend 96") + '</option>').join("");
  return '<div class="av-midi-sec av-midi-mpe" id="av-midi-mpe-row" data-mpe="' + (on ? "1" : "0") + '">' +
    '<b>MPE</b>' +
    '<div class="av-midi-actions">' +
      '<button class="av-btn mini' + (on ? " on" : "") + '" data-midimpe="1" title="route member channels 2–16 with per-note bend / pressure / timbre / pan">ON</button>' +
      '<button class="av-btn mini' + (on ? "" : " on") + '" data-midimpe="0" title="off: member channels behave like ordinary MIDI again">OFF</button>' +
      '<span class="av-midi-stat" id="av-midi-mpe-state">' + avMpeDeckEsc(avMpeDeckStateText()) + '</span>' +
    '</div>' +
    '<div class="av-midi-row">' +
      '<span class="av-midi-cap">BEND RANGE</span>' +
      '<select class="av-midi-select" id="av-midi-mpe-bend" title="the zone range sent to the engine — member bend is scaled inside it">' + opts + '</select>' +
    '</div>' +
    '<div class="av-midi-row">' +
      '<span class="av-midi-cap">HELD MEMBER NOTES</span>' +
      '<b class="av-midi-note" id="av-midi-mpe-active">' + avMpeDeckEsc(avMpeDeckActiveText()) + '</b>' +
    '</div>' +
    '<p class="av-midi-cap">MPE: MIDI channels 2–16 are member channels — each hardware voice bends, presses and pans on its own; channel 1 stays the master (the global path). Member notes ride the ONE note bus, tagged with their channel. Everything here waits for PLAY IN to be on.</p>' +
  '</div>';
}

/* ---------- panel wiring (delegated listeners; idempotent; survives avMidiRender rebuilds) ---------- */

function avMpeDeckOnClick(e) {
  try {
    const t = e && e.target;
    if (!t || typeof t.closest !== "function") return;
    const act = t.closest("[data-midimpe]");
    if (act) avMpeDeckSet(act.dataset.midimpe !== "0");
  } catch (e2) { /* a broken event never breaks the panel */ }
}

function avMpeDeckOnChange(e) {
  try {
    const t = e && e.target;
    if (!t || typeof t.closest !== "function") return;
    const sel = t.closest("#av-midi-mpe-bend");
    if (sel) avMpeDeckSetBend(Number(sel.value));
  } catch (e2) { /* idem */ }
}

/* ---------- THE router hook (av_midi calls this after `if (!m) return;`, §4.6) ---------- */

function avMpeDeckIncoming(m) {
  try {
    if (!m || typeof m !== "object") return false;
    if (!avMpeDeckGate()) return false;                    /* MPE off / PLAY IN off: normal path */
    const ch = avMpeDeckMemberCh(m.chan);
    if (ch < 1) return false;                              /* master + system: normal path */
    const t = m.type;

    if (t === "noteon") {
      const name = avMpeDeckNoteName(m);
      if (!name) return false;
      const vel = avMpeDeckVelByte(m.vel);
      avMpeDeckNoteDown(name, vel / 127, ch);              /* the ONE bus, tagged */
      avMpeDeckTouchLastNote(m, name, vel);                /* deck LAST NOTE readout */
      avMpeDeckMonTouch();
      avMpeDeckHeld.set(name + "@" + ch, { name: name, ch: ch });
      avMpeDeckPaint();
      return true;
    }

    if (t === "noteoff") {
      const name = avMpeDeckNoteName(m);
      if (!name) return false;
      avMpeDeckHeld.delete(name + "@" + ch);
      avMpeDeckNoteUpCall(name, ch);
      avMpeDeckPaint();
      return true;
    }

    if (t === "pitchbend") {
      const raw = Number(m.bend);
      const clamped = isFinite(raw) ? Math.max(-8192, Math.min(8192, raw)) : 0;
      avMpeDeckDispatch(ch, "bend", (clamped / 8192) * avMpeDeckBend());
      return true;
    }

    if (t === "touch") {
      const v = avMpeDeckTouchValue(m);
      if (v != null) avMpeDeckDispatch(ch, "at", v);
      return true;
    }

    if (t === "cc") {
      if (m.cc === 74) { avMpeDeckDispatch(ch, "timbre", m.value); return true; }
      if (m.cc === 10) { avMpeDeckDispatch(ch, "pan", m.value); return true; }
      return false;                                        /* CC 120/123 (and every other CC) fall through */
    }

    return false;
  } catch (e) {
    return false;   /* the hook NEVER throws: a bad message just takes the normal path */
  }
}

/* ---------- public API (§2.2) ---------- */

function avMpeDeckInit() {
  try {
    if (!avMpeDeckArmed) {
      avMpeDeckArmed = true;
      avMpeDeckReconcile();
      avMpeDeckPush();                                     /* boot handshake (no-op without engine) */
    }
    avMpeDeckWire();                                       /* re-render safe: no-op until the host exists */
  } catch (e) { /* boot never breaks on the MPE row */ }
  return true;
}

function avMpeDeckRelease() {
  let n = 0;
  const keys = [...avMpeDeckHeld.keys()];
  for (let i = 0; i < keys.length; i++) {
    const h = avMpeDeckHeld.get(keys[i]);
    avMpeDeckHeld.delete(keys[i]);
    if (h) { if (avMpeDeckNoteUpCall(h.name, h.ch)) n += 1; }
  }
  avMpeDeckPaint();
  return n;
}

function avMpeDeckSet(on) {
  const v = !!on;
  avMpeDeckWriteMpe(v);
  avMpeDeckSavePrefs();
  avMpeDeckEngineSet(v, avMpeDeckBend());
  if (!v) avMpeDeckRelease();                              /* zone off: broom the member notes */
  avMpeDeckRenderRow();
  return v;
}

function avMpeDeckSetBend(n) {
  const b = Number(n);
  if (b !== 24 && b !== 48 && b !== 96) return false;
  avMpeDeckWriteBend(b);
  avMpeDeckSavePrefs();
  avMpeDeckEngineSet(avMpeDeckOn(), b);
  avMpeDeckRenderRow();
  return true;
}

function avMpeDeckPush() {
  return avMpeDeckEngineSet(avMpeDeckOn(), avMpeDeckBend());
}

function avMpeDeckWire(root) {
  try {
    const doc = avMpeDeckDom();
    let host = root || null;
    if (typeof host === "string" && doc && typeof doc.querySelector === "function") {
      try { host = doc.querySelector(host); } catch (e) { host = null; }
    }
    if (!host && doc && typeof doc.getElementById === "function") {
      host = doc.getElementById("av-midi-body") || doc.getElementById("av-midi-mpe-row") || null;
    }
    if (!host || typeof host.addEventListener !== "function") return false;
    if (avMpeDeckWiredHosts && avMpeDeckWiredHosts.has(host)) { avMpeDeckPaint(); return true; }
    if (avMpeDeckWiredHosts) avMpeDeckWiredHosts.add(host);
    try { if (host.dataset) host.dataset.avMpeWired = "1"; } catch (e) { /* dataset gone */ }
    host.addEventListener("click", avMpeDeckOnClick);
    host.addEventListener("change", avMpeDeckOnChange);
    avMpeDeckPaint();
    return true;
  } catch (e) { return false; }
}

function avMpeDeckSnap() {
  const held = [];
  avMpeDeckHeld.forEach(h => held.push({ name: h.name, ch: h.ch }));
  const le = avMpeDeckLastExpr;
  return {
    on: avMpeDeckOn(),
    bend: avMpeDeckBend(),
    held: held,
    lastExpr: le ? { ch: le.ch, dim: le.dim, at: le.at } : null,
    pushes: avMpeDeckPushCount,
  };
}

/* every NEW class this module emits (§4.10 — the parent generates the styles block from this) */
function avMpeDeckClasses() {
  return ["av-midi-mpe", "av-midi-select"];
}

/* ---------- page handle (§2.2 — names are the contract) ---------- */

if (typeof window !== "undefined") {
  window.__avMpeDeck = {
    version: AV_MPE_DECK_VERSION,
    init: avMpeDeckInit,
    set: avMpeDeckSet,
    setBend: avMpeDeckSetBend,
    release: avMpeDeckRelease,
    push: avMpeDeckPush,
    snap: avMpeDeckSnap,
    incoming: avMpeDeckIncoming,
  };
}
