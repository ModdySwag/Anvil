/* av_midi.js — Anvil's Web MIDI deck: enable / ports / decode / note routing / monitor / out tap /
   test send / clock out / CC map + learn — one panel mounted into #av-midi-body.

   Ported from Pattern Forge's src/app_midi.js (read-only source) per
   research/reuse/midi-port-digest.md §10: §1-3 PORT · §4a PORT (retargeted to the avNote bus) ·
   §5 PORT · §6a PORT · §6b PORT (tempo → avState.bpm) · §7 ADAPT (av-knob framework) · §8 PORT.
   §4b MPE, §4c capture, §4d program change and §6c track routing are DEFER/DROP per that table —
   nothing of them is invented back.

   LAWS kept (PF line refs are Pattern Forge's src/app_midi.js):
   - IN notes play through the ONE note path (avNoteDown / avNoteUp — PF L3-6, L401-403): a hardware
     note is never a second synth path. Same voice, same hold-to-play; velocity arrives as vel/127.
   - requestMIDIAccess() is called with NO options — the deck never sends sysex, so it never asks
     for it (PF L268-269). Sysex is RECEIVED only through the passive sink hook
     avMidiSetSysExSink (T wave: the TUNE card's MTS live receive registers it; the hook costs
     nothing until then and nothing in the deck's own behaviour changes).
   - the input is attached with addEventListener('midimessage'), never onmidimessage (PF L370-372):
     another WebMidi user on the page may claim the property; listeners coexist.
   - monitor caps: 60 kept / 12 drawn per direction, 240 recorded per second SHARED in+out, one
     repaint per 120 ms (PF L38-42). A rate drop loses the row, never the routing (PF L390-392).
   - the out tap patches MIDIOutput.prototype.send and skips our own sends (PF L655-668); our own
     sends are recorded exactly once by avMidiSendBytes itself (PF L682-684).
   - clock out: 24 ppqn; gap = 2500 / BPM read fresh every tick; the next tick is scheduled off the
     LAST SCHEDULED time — a late wake-up is caught up, never shifted; resync to now only when more
     than half a period behind (PF L1825-1839, L1937-1949). Honest reasons when it cannot run.
   - CC learn: the first CC after arming picks the controller (CC 120-127 refused); the bind click
     is swallowed in the capture phase so binding never turns the control (PF L1518-1520,
     L1544-1545); a learned CC writes through avApplyParam and repaints the knob WITHOUT
     avKnobCommit (PF L1656-1657, L1682-1706) — the knob's damping must not fight hardware.
   - every avNote* / avApplyParam / avKnob* call is typeof-guarded: this file may load before them.
   - DOM-free at top level; avMidiInit() is called by app_core's boot (avBoot) and is idempotent. */
"use strict";

/* ---------- constants (all prefixed; AV_MIDI_* / avMidi*) ---------- */

const AV_MIDI_PREF_KEY = "av-midi";                 /* the only P1 persistence (PF L27) */
const AV_MIDI_BIND_KEY = "av-midi-cc";              /* learned CC bindings (PF L1064) */

/* monitor limits — documented in the panel, enforced here (PF L38-42) */
const AV_MIDI_MON_MAX = 60;    /* entries kept per direction */
const AV_MIDI_DOM_MAX = 12;    /* rows drawn per direction — the DOM is capped, always */
const AV_MIDI_MON_RATE = 240;  /* messages recorded per second; shared in+out budget */
const AV_MIDI_FLUSH_MS = 120;  /* one repaint per window no matter the traffic */

/* CC learn limits (PF L1063-1066) */
const AV_MIDI_CC_MAX = 119;        /* CC 120-127 are channel-mode messages, not controls */
const AV_MIDI_CC_BIND_MAX = 64;    /* a page cannot be flooded with bindings either */
const AV_MIDI_CC_WINDOW = 30;      /* ms — at most one parameter write per binding per window */

/* clock out (PF L1841-1844) */
const AV_MIDI_CLOCK_PPQN = 24;                            /* clocks per quarter note (standard) */
const AV_MIDI_CLOCK_NOTE_MS = 60000 / AV_MIDI_CLOCK_PPQN; /* 2500 ms per clock at 60 BPM */
const AV_MIDI_CLOCK_GAPS = 8;                             /* tick gaps kept for the readout */
const AV_MIDI_CLOCK_START = 0xfa;
const AV_MIDI_CLOCK_TICK = 0xf8;
const AV_MIDI_CLOCK_STOP = 0xfc;

/* state copy map (PF L706-713), verbatim */
const AV_MIDI_STATE_TEXT = {
  unsupported: ["NO WEB MIDI", "err"],
  idle: ["NOT ENABLED", ""],
  asking: ["ASKING…", "busy"],
  enabled: ["ENABLED", "ok"],
  denied: ["DENIED BY BROWSER", "err"],
  failed: ["ERROR", "err"],
};

/* default performance map (PF L1600-1608) — re-pointed at avApplyParam; active only when no
   learned binding hit ("learn always wins", PF L1591). The { cc: { label, apply } } shape is kept. */
const AV_MIDI_CC_DEFAULT = {
  1:  { label: "mod → vibrato", apply: (v) => { avMidiParam("perf.vibrato", v / 127); } },
  5:  { label: "porta time",    apply: (v) => { avMidiParam("perf.glideTime", Math.round((v / 127) * 2000) / 1000); } },
  64: { label: "sustain",       apply: (v) => { avMidiParam("perf.sustain", v >= 64); } },
  65: { label: "porta on/off",  apply: (v) => { avMidiParam("perf.glideOn", v >= 64); } },
  66: { label: "sostenuto",     apply: (v) => { if (v >= 64) avMidiParam("perf.sustain", true); } },
  71: { label: "resonance",     apply: (v) => { avMidiParam("perf.reso", (v / 127) * 24); } },
  74: { label: "cutoff",        apply: (v) => { avMidiParam("perf.cutoff", Math.round(60 * Math.pow(300, v / 127))); } },
};

/* ---------- state (PF L44-60, L1077-1092 — MPE / capture / PC state dropped) ---------- */

let avMidiAccess = null;
let avMidiStatus = "idle";     /* unsupported | idle | asking | enabled | denied | failed */
let avMidiError = "";
let avMidiEnabled = false;
let avMidiPrefs = { in: "", out: "", playIn: true, clockOut: false, mpe: false, mpeBend: 48 };
let avMidiInPort = null;       /* the port we are listening on */
let avMidiInHandler = null;
let avMidiHeld = new Set();    /* note names we started on hardware keys, so we can release them */
let avMidiLastNote = null;     /* { note, name, vel, at } for the live readout */
let avMidiMonIn = [];
let avMidiMonOut = [];
let avMidiMonTotal = { in: 0, out: 0 };
let avMidiMonDropped = { in: 0, out: 0 };
let avMidiRate = { at: 0, n: 0 };
let avMidiFlushTimer = null;
let avMidiOutTapOk = false;
let avMidiSelfSend = false;    /* true while OUR own send is on the stack (the tap skips it) */
let avMidiWired = false;
let avMidiLearnWired = false;
let avMidiSayState = "";
/* T wave: the passive sysex sink the TUNE card registers for MTS receive (null = no cost) */
let avMidiSysExSink = null;
let avMidiSysExBuf = [];

let avMidiLearn = { armed: false, cc: null, chan: 0, at: 0, armedAt: 0, bound: 0, refused: 0, lastRefused: null };
let avMidiCcBinds = [];
let avMidiCcSeq = 0;
let avMidiCcQueue = new Map();
let avMidiCcTimer = null;
let avMidiCcWrites = 0;

let avMidiClockOut = { playing: false, ticking: false, ticks: 0, starts: 0, stops: 0, lastGaps: [], lastError: "", timer: null, nextAt: 0, lastTickAt: 0 };

/* ---------- tiny local helpers (no core leakage) ---------- */

const avMidiEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* path → CSS selector escape: the av-knob framework owns the real one (av_knob.js L143) */
function avMidiCssEsc(s) {
  if (typeof avKnobCssEscape === "function") { try { return avKnobCssEscape(s); } catch (e) { /* fall through */ } }
  return String(s == null ? "" : s).replace(/[^a-zA-Z0-9_-]/g, ch => "\\" + ch);
}

/* ---------- capability + naming (PF L64-72) ---------- */

function avMidiSupported() {
  return typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";
}

function avMidiBrowserNote() {
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  if (/safari/i.test(ua) && !/chrome|chromium|edg|android/i.test(ua)) {
    return "This is Safari, which has no Web MIDI at all — Chrome, Edge or Firefox 108+ on the same machine will see your gear.";
  }
  return "Web MIDI is missing in this browser, so hardware keys and hardware out are both off the table here. Chrome, Edge, Opera and Firefox 108+ have it; Safari does not.";
}

/* ---------- ports (PF L76-117) ---------- */

function avMidiPorts(type) {
  const out = [];
  if (!avMidiAccess) return out;
  const map = type === "in" ? avMidiAccess.inputs : avMidiAccess.outputs;
  if (!map) return out;
  try {
    map.forEach(p => out.push(avMidiPortInfo(p, type)));
  } catch (e) {
    /* odd implementations: a Map-like without forEach */
    try { [...map.values()].forEach(p => out.push(avMidiPortInfo(p, type))); } catch (e2) { /* give up quietly */ }
  }
  return out;
}

function avMidiPortInfo(p, type) {
  return {
    id: p.id || "",
    name: p.name || "(unnamed port)",
    manufacturer: p.manufacturer || "",
    state: p.state || "unknown",
    connection: p.connection || "closed",
    type: type || p.type || "",
  };
}

/* resolve a selection given either an id or a name, against the live port map (PF L101-112) */
function avMidiPortFor(type, want) {
  if (!avMidiAccess || !want) return null;
  const map = type === "in" ? avMidiAccess.inputs : avMidiAccess.outputs;
  if (!map) return null;
  try {
    if (map.get) { const p = map.get(want); if (p) return p; }
  } catch (e) { /* not a Map-like */ }
  let hit = null;
  avMidiPorts(type).forEach(p => { if (!hit && (p.id === want || p.name === want)) hit = p; });
  if (!hit) return null;
  try { return map.get(hit.id) || null; } catch (e) { return null; }
}

function avMidiSelectedInputPort() { return avMidiPortFor("in", avMidiPrefs.in); }
function avMidiSelectedOutputPort() { return avMidiPortFor("out", avMidiPrefs.out); }
function avMidiSelectedInput() { const p = avMidiSelectedInputPort(); return p ? avMidiPortInfo(p, "in") : null; }
function avMidiSelectedOutput() { const p = avMidiSelectedOutputPort(); return p ? avMidiPortInfo(p, "out") : null; }

/* ---------- decode (PF L121-155, ported exactly) ---------- */

function avMidiDecode(data) {
  const b = data || [];
  if (!b.length) return null;
  const status = b[0] & 0xff;
  const hi = status & 0xf0;
  const chan = (status & 0x0f) + 1;             /* 1-based for the panel (PF L126) */
  const chanMsg = status < 0xf0;
  const v1 = b[1], v2 = b[2];
  let type = "other", label = "other";
  if (chanMsg) {
    if (hi === 0x80) { type = "noteoff"; label = "note off"; }
    else if (hi === 0x90) { type = (v2 === 0) ? "noteoff" : "noteon"; label = (v2 === 0) ? "note off" : "note on"; }   /* velocity-0 rule (PF L132) */
    else if (hi === 0xa0) { type = "polytouch"; label = "poly aftertouch"; }   /* decoded for the monitor only */
    else if (hi === 0xb0) { type = "cc"; label = "cc"; }
    else if (hi === 0xc0) { type = "program"; label = "program"; }
    else if (hi === 0xd0) { type = "touch"; label = "aftertouch"; }
    else if (hi === 0xe0) { type = "pitchbend"; label = "pitch bend"; }
  } else if (status === 0xf8) { type = "clock"; label = "clock"; }
  else if (status === 0xfa) { type = "start"; label = "start"; }
  else if (status === 0xfb) { type = "continue"; label = "continue"; }
  else if (status === 0xfc) { type = "stop"; label = "stop"; }
  else if (status === 0xfe) { type = "sensing"; label = "active sensing"; }
  else if (status === 0xff) { type = "reset"; label = "reset"; }
  else if (status === 0xf0 || status === 0xf7) { type = "sysex"; label = "sysex"; }
  else { type = "system"; label = "system"; }
  const hex = b.slice(0, 4).map(x => (x & 0xff).toString(16).padStart(2, "0")).join(" ");
  const out = { type, label, chan: chanMsg ? chan : 0, data: b.slice(0, 8), hex };
  if (type === "noteon" || type === "noteoff") {
    out.note = v1; out.vel = type === "noteon" ? v2 : 0;
    if (typeof avNoteName === "function") out.name = avNoteName(v1);
  }
  if (type === "cc") { out.cc = v1; out.value = v2; }
  if (type === "pitchbend") out.bend = ((v2 << 7) | v1) - 8192;   /* 14-bit, −8192..8191 (PF L153) */
  return out;
}

/* ---------- the passive sysex sink (T wave: MTS receive for the TUNE card) ---------- */

/* The deck itself never asks for sysex (header law); this hook is how the TUNE card's MTS live
   receive gets its raw bytes once the card holds a SysEx-enabled access of its own. Passive:
   with no sink registered the input handler does zero extra work beyond the length check below.
   Raw F0..F7 arrays are forwarded whole; a message that arrives split across events is
   reassembled first. The sink call is guarded: it can never break the deck. */
function avMidiSetSysExSink(fn) {
  avMidiSysExSink = (typeof fn === "function") ? fn : null;
  avMidiSysExBuf = [];
  return avMidiSysExSink !== null;
}

function avMidiSysExForward(bytes) {
  if (!avMidiSysExSink) { avMidiSysExBuf = []; return false; }
  try {
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i] & 0xff;
      if (b === 0xf0) { avMidiSysExBuf = [b]; continue; }   /* a new F0 restarts the message */
      if (!avMidiSysExBuf.length) continue;                  /* data with no open F0: ignored */
      avMidiSysExBuf.push(b);
      if (b === 0xf7) {
        const msg = avMidiSysExBuf;
        avMidiSysExBuf = [];
        avMidiSysExSink(msg);
      }
      if (avMidiSysExBuf.length > 8192) avMidiSysExBuf = []; /* runaway guard */
    }
    return true;
  } catch (e) { avMidiSysExBuf = []; return false; }
}

/* ---------- monitor (PF L157-254) ---------- */

function avMidiRateOk() {
  const now = Date.now();
  if (now - avMidiRate.at > 1000) { avMidiRate.at = now; avMidiRate.n = 0; }
  avMidiRate.n += 1;
  return avMidiRate.n <= AV_MIDI_MON_RATE;
}

/* the total always moves; a rate drop costs the STORED ROW only — never decoding, never routing */
function avMidiRecord(dir, data, portName) {
  const bytes = Array.prototype.slice.call(data || []);
  if (!bytes.length) return null;
  const key = dir === "out" ? "out" : "in";
  avMidiMonTotal[key] += 1;
  if (!avMidiRateOk()) { avMidiMonDropped[key] += 1; return null; }
  const m = avMidiDecode(bytes);
  if (!m) return null;
  const entry = {
    t: Date.now(), port: portName || "", type: m.type, label: m.label,
    chan: m.chan, data: m.data, hex: m.hex,
  };
  if (m.name) entry.name = m.name;
  if (m.vel != null) entry.vel = m.vel;
  if (m.cc != null) { entry.cc = m.cc; entry.value = m.value; }
  if (m.bend != null) entry.bend = m.bend;
  const ring = key === "out" ? avMidiMonOut : avMidiMonIn;
  ring.push(entry);
  while (ring.length > AV_MIDI_MON_MAX) ring.shift();
  avMidiMonTouch();
  return entry;
}

/* coalesced repaint: at most one per AV_MIDI_FLUSH_MS, whatever arrives (PF L189-192) */
function avMidiMonTouch() {
  if (avMidiFlushTimer) return;
  avMidiFlushTimer = setTimeout(() => { avMidiFlushTimer = null; avMidiDrawMonitor(); }, AV_MIDI_FLUSH_MS);
}

function avMidiClockStamp(t) {
  const d = new Date(t || Date.now());
  const p = (n, w) => String(n).padStart(w || 2, "0");
  return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()) + "." + p(d.getMilliseconds(), 3);
}

function avMidiRowText(e) {
  const chan = e.chan ? "ch" + e.chan : "--";
  let detail = e.hex;
  if (e.type === "noteon") detail = (e.name || e.data[1]) + " vel " + e.vel + " [" + e.hex + "]";
  else if (e.type === "noteoff") detail = (e.name || e.data[1]) + " [" + e.hex + "]";
  else if (e.type === "cc") detail = "cc" + e.cc + " = " + e.value + " [" + e.hex + "]";
  else if (e.type === "pitchbend") detail = String(e.bend) + " [" + e.hex + "]";
  return { chan, detail };
}

function avMidiMonRowsHTML(dir) {
  const ring = dir === "out" ? avMidiMonOut : avMidiMonIn;
  const rows = ring.slice(-AV_MIDI_DOM_MAX).reverse();
  if (!rows.length) return '<div class="av-midi-none">nothing yet</div>';
  return rows.map(e => {
    const r = avMidiRowText(e);
    return '<div class="av-midi-mon-line' + (e.type === "noteon" ? " on" : "") + '">' +
      '<span class="t">' + avMidiClockStamp(e.t) + '</span> <b>' + avMidiEsc(r.chan) + '</b> ' + avMidiEsc(r.detail) +
      '<span class="p">· ' + avMidiEsc(e.port) + '</span></div>';
  }).join("");
}

function avMidiLastNoteHTML() {
  if (!avMidiLastNote) return '<span class="av-midi-none">no notes yet</span>';
  const vel = avMidiLastNote.vel;
  const w = Math.max(4, Math.min(100, Math.round(vel / 127 * 100)));
  return '<b>' + avMidiEsc(avMidiLastNote.name) + '</b> <span class="av-midi-vel" style="width:' + w + '%"></span> ' + avMidiEsc(vel);
}

/* the only place the monitor DOM is written — always bounded, always idempotent (PF L224-245) */
function avMidiDrawMonitor() {
  const host = document.getElementById("av-midi-body");
  if (!host) return false;
  ["in", "out"].forEach(dir => {
    const list = document.getElementById("av-midi-mon-" + dir);
    if (list) list.innerHTML = avMidiMonRowsHTML(dir);
    const cnt = document.getElementById("av-midi-count-" + dir);
    if (cnt) {
      const ring = dir === "out" ? avMidiMonOut : avMidiMonIn;
      cnt.textContent = ring.length + "/" + AV_MIDI_MON_MAX + " kept · " + avMidiMonTotal[dir] + " total · " + avMidiMonDropped[dir] + " dropped";
    }
  });
  const last = document.getElementById("av-midi-last-note");
  if (last) last.innerHTML = avMidiLastNoteHTML();
  const held = document.getElementById("av-midi-held");
  if (held) held.textContent = avMidiHeld.size ? [...avMidiHeld].join(" ") : "—";
  /* the readouts that ride the same throttled repaint (PF L2173-2219, minus MPE / capture / PC) */
  const learn = document.getElementById("av-midi-learn-state");
  if (learn) learn.textContent = avMidiLearnStateText();
  const clk = document.getElementById("av-midi-clock-state");
  if (clk) clk.textContent = avMidiClockStateText();
  const tk = document.getElementById("av-midi-clock-ticks");
  if (tk) tk.textContent = avMidiClockTicksText();
  avMidiCcBinds.forEach(b => {
    const el = document.querySelector('[data-ccval="' + avMidiCssEsc(b.id) + '"]');
    if (!el) return;
    el.textContent = avMidiCcValText(b);
  });
  return true;
}

function avMidiClearMonitor() {
  avMidiMonIn = []; avMidiMonOut = [];
  avMidiMonTotal = { in: 0, out: 0 };
  avMidiMonDropped = { in: 0, out: 0 };
  avMidiRate = { at: 0, n: 0 };
  avMidiLastNote = null;
  avMidiDrawMonitor();
}

/* ---------- panel markup (PF L704-852 + L1970-2096, hub chrome swapped for the av- classes) ---------- */

function avMidiStatusHTML() {
  const t = AV_MIDI_STATE_TEXT[avMidiStatus] || AV_MIDI_STATE_TEXT.idle;
  const label = t[0], cls = t[1];
  if (avMidiStatus === "unsupported") {
    return '<div id="av-midi-state" class="av-midi-stat err"><b>' + avMidiEsc(label) + '</b> ' + avMidiEsc(avMidiBrowserNote()) + '</div>';
  }
  if (avMidiStatus === "denied") {
    return '<div id="av-midi-state" class="av-midi-stat err"><b>' + avMidiEsc(label) + '</b> ' +
      avMidiEsc(avMidiError || "The browser refused MIDI access.") +
      ' Click the padlock in the address bar, allow MIDI devices for this page, then press ENABLE again.</div>';
  }
  if (avMidiStatus === "failed") {
    return '<div id="av-midi-state" class="av-midi-stat err"><b>' + avMidiEsc(label) + '</b> ' + avMidiEsc(avMidiError || "Could not open Web MIDI.") + '</div>';
  }
  if (avMidiStatus === "enabled") {
    const i = avMidiPorts("in").length, o = avMidiPorts("out").length;
    return '<div id="av-midi-state" class="av-midi-stat ok"><b>' + avMidiEsc(label) + '</b> ' + i + ' input' + (i === 1 ? "" : "s") +
      ' · ' + o + ' output' + (o === 1 ? "" : "s") + ' visible. Access lasts until this tab closes — the browser asks again on the next load.</div>';
  }
  return '<div id="av-midi-state" class="av-midi-stat' + (cls ? " " + cls : "") + '"><b>' + avMidiEsc(label) +
    '</b> The browser has Web MIDI, it just has not been asked yet. Press ENABLE — one click, and it stays for this tab.</div>';
}

function avMidiDevRowsHTML(type) {
  if (!avMidiEnabled || !avMidiAccess) return '<div class="av-midi-none">enable MIDI to list devices</div>';
  const ports = avMidiPorts(type);
  const sel = type === "in" ? avMidiPrefs.in : avMidiPrefs.out;
  if (!ports.length) return '<div class="av-midi-none">no ' + (type === "in" ? "inputs" : "outputs") + ' found — plug one in, then REFRESH</div>';
  return ports.map(p => {
    const on = !!(p.id && p.id === sel);
    const attr = type === "in" ? "data-midiin" : "data-midiout";
    return '<div class="av-midi-dev' + (on ? " on" : "") + '" ' + attr + '="' + avMidiEsc(p.id) + '">' +
      '<b>' + avMidiEsc(p.name) + '</b>' +
      '<span class="grow">' + avMidiEsc(p.manufacturer || "unknown maker") + ' · ' + avMidiEsc(p.state) + ' · ' + avMidiEsc(p.connection) + '</span>' +
      '<button class="av-btn mini' + (on ? " on" : "") + '" ' + attr + '-pick="' + avMidiEsc(p.id) + '" title="use this ' + (type === "in" ? "input" : "output") + '">' + (on ? "IN USE" : "USE") + '</button>' +
      '</div>';
  }).join("");
}

function avMidiCcValText(b) {
  if (b.applied != null) return String(Math.round(b.applied * 1000) / 1000);
  if (b.last != null) return b.last + "/127";
  return "—";
}

function avMidiCcBindsHTML() {
  if (!avMidiCcBinds.length) return '<div class="av-midi-none">no CC bound yet</div>';
  return avMidiCcBinds.map(b => {
    const onScreen = !!avMidiCcElement(b.path);
    return '<div class="av-midi-dev' + (onScreen ? " on" : "") + '" data-ccbind="' + avMidiEsc(b.id) + '">' +
      '<b>CC ' + avMidiEsc(b.cc) + '</b>' +
      '<span class="grow">ch' + avMidiEsc(b.ch || "·") + ' → ' + avMidiEsc(b.path) +
      (b.label && b.label !== b.path ? " · " + avMidiEsc(b.label) : "") +
      (onScreen ? "" : " · not on screen right now") + '</span>' +
      '<span data-ccval="' + avMidiEsc(b.id) + '">' + avMidiEsc(avMidiCcValText(b)) + '</span>' +
      '<button class="av-btn mini" data-ccbind-del="' + avMidiEsc(b.id) + '" title="remove this binding" aria-label="remove this binding">✕</button>' +
      '</div>';
  }).join("");
}

function avMidiLearnStateText() {
  if (avMidiLearn.armed) {
    return avMidiLearn.cc != null
      ? "CC " + avMidiLearn.cc + " on ch" + (avMidiLearn.chan || "·") + " — now click the control to drive"
      : "move one knob on the hardware";
  }
  return avMidiCcBinds.length ? avMidiCcBinds.length + " binding" + (avMidiCcBinds.length === 1 ? "" : "s") : "idle";
}

function avMidiPanelHTML() {
  const supported = avMidiSupported();
  const enabled = avMidiStatus === "enabled";
  const playIn = !!avMidiPrefs.playIn;
  const clockOn = !!avMidiPrefs.clockOut;
  const armed = !!avMidiLearn.armed;
  const devIn = avMidiSelectedInput();
  return '<div class="av-midi">' +

    '<div class="av-midi-sec"><b>WEB MIDI</b>' +
      avMidiStatusHTML() +
      '<p class="av-midi-cap" id="av-midi-say">' + avMidiEsc(avMidiSayState) + '</p>' +
      '<div class="av-midi-actions">' +
        (supported ? '<button class="av-btn mini' + (enabled ? "" : " on") + '" data-midi="enable">' + (enabled ? "ENABLE MIDI (AGAIN)" : "ENABLE MIDI") + '</button>' : "") +
        '<button class="av-btn mini" data-midi="refresh" title="re-read the port list right now">REFRESH DEVICES</button>' +
        (enabled ? '<button class="av-btn mini" data-midi="disable" title="let go of the ports (the page keeps working)">RELEASE</button>' : "") +
        '<button class="av-btn mini" data-midi="testnote" title="send one note on the selected output — proves the cable, not the sequencer">TEST NOTE</button>' +
      '</div>' +
      '<p class="av-midi-cap">MIDI is a browser permission, not a setting: it needs a real click (this ENABLE button), it is never remembered across a reload, and pages opened over https or as a local file can both ask. No sysex, no extra download. If the browser has no Web MIDI there is nothing to enable — the panel says so instead of pretending.</p>' +
    '</div>' +

    '<div class="av-midi-sec"><b>INPUTS</b><div id="av-midi-dev-in">' + avMidiDevRowsHTML("in") + '</div></div>' +

    '<div class="av-midi-sec"><b>OUTPUTS</b><div id="av-midi-dev-out">' + avMidiDevRowsHTML("out") + '</div></div>' +

    '<div class="av-midi-sec"><b>PLAY IN</b>' +
      '<div class="av-midi-row">' +
        '<button class="av-btn mini' + (playIn ? " on" : "") + '" data-midi="playin" data-midival="1">ON</button>' +
        '<button class="av-btn mini' + (playIn ? "" : " on") + '" data-midi="playin" data-midival="0">OFF</button>' +
        '<span class="av-midi-cap">incoming notes play through the same voice the piano dock uses — hold-to-play, velocity included. Nothing here re-synthesises anything on its own.</span>' +
      '</div>' +
      '<div class="av-midi-row"><span class="av-midi-cap">LISTENING ON</span><b class="av-midi-note">' + avMidiEsc(devIn ? devIn.name : "— none selected") + '</b></div>' +
      '<div class="av-midi-row"><span class="av-midi-cap">LAST NOTE</span><span class="av-midi-note" id="av-midi-last-note">' + avMidiLastNoteHTML() + '</span></div>' +
      '<div class="av-midi-row"><span class="av-midi-cap">HELD NOW</span><b class="av-midi-note" id="av-midi-held">' + (avMidiHeld.size ? avMidiEsc([...avMidiHeld].join(" ")) : "—") + '</b></div>' +
    '</div>' +

    '<div class="av-midi-sec"><b>CLOCK OUT</b>' +
      '<div class="av-midi-row">' +
        '<button class="av-btn mini' + (clockOn ? " on" : "") + '" data-midiclock="on" title="send MIDI clock (0xFA/0xF8/0xFC) to the OUTPUT selected above">ON</button>' +
        '<button class="av-btn mini' + (clockOn ? "" : " on") + '" data-midiclock="off" title="send nothing, even if the transport runs">OFF</button>' +
        '<span class="av-midi-cap">24 ppqn — 0xF8 every 2500 / BPM ms; the tempo (avState.bpm) is read again on every tick, so a change is heard by the gear mid-run.</span>' +
      '</div>' +
      '<div class="av-midi-row"><span class="av-midi-cap">CLOCK OUT</span><b class="av-midi-stat" id="av-midi-clock-state">' + avMidiEsc(avMidiClockStateText()) + '</b></div>' +
      '<div class="av-midi-row"><span class="av-midi-cap">TICKS SENT</span><b class="av-midi-stat" id="av-midi-clock-ticks">' + avMidiEsc(avMidiClockTicksText()) + '</b></div>' +
    '</div>' +

    (typeof avMpeDeckPanelHTML === "function" ? avMpeDeckPanelHTML() : "") +

    '<div class="av-midi-sec"><b>CC → PARAMETER</b>' +
      '<div class="av-midi-actions">' +
        '<button class="av-btn mini' + (armed ? " on" : "") + '" data-midilearn="arm" title="arm CC learn — the next CC selects the controller">' + (armed ? "LEARN ARMED — CANCEL" : "ARM LEARN") + '</button>' +
        '<button class="av-btn mini" data-midilearn="clear" title="forget every binding">CLEAR ALL</button>' +
      '</div>' +
      '<div class="av-midi-row"><span class="av-midi-cap">LEARN</span><b class="av-midi-stat" id="av-midi-learn-state">' + avMidiEsc(avMidiLearnStateText()) + '</b></div>' +
      '<div id="av-midi-cc-binds">' + avMidiCcBindsHTML() + '</div>' +
      '<p class="av-midi-cap">Arm, move one knob on the hardware (the first CC picks the controller; channel-mode CC 120–127 are refused — that is not a knob), then click an av-knob: the click is swallowed, so binding never turns it. That CC then drives the parameter through avApplyParam — the same funnel the knob uses — and the on-screen knob repaints, never re-commits. One controller per parameter, one parameter per controller. Bindings are saved in this browser (av-midi-cc) and can be removed one by one ✕.</p>' +
    '</div>' +

    '<div class="av-midi-sec"><b>MONITOR IN <span class="av-midi-cap" id="av-midi-count-in"></span></b><div id="av-midi-mon-in" class="av-midi-mon"></div></div>' +

    '<div class="av-midi-sec"><b>MONITOR OUT <span class="av-midi-cap" id="av-midi-count-out"></span></b><div id="av-midi-mon-out" class="av-midi-mon"></div></div>' +

    '<div class="av-midi-actions">' +
      '<button class="av-btn mini" data-midi="clear">CLEAR MONITOR</button>' +
      '<span class="av-midi-cap">Showing the newest 12 of the last 60 kept per direction — repainted at most every 120 ms, and anything past 240 messages a second is counted as dropped instead of drawn. A clock or an armed controller cannot flood this page.</span>' +
    '</div>' +

  '</div>';
}

/* re-render the static sections into #av-midi-body (innerHTML replaced); the monitor repaints
   through avMidiDrawMonitor — called here so the first paint is complete */
function avMidiRender() {
  const host = document.getElementById("av-midi-body");
  if (!host) return false;
  host.innerHTML = avMidiPanelHTML();
  try { if (typeof avMpeDeckWire === "function") avMpeDeckWire(host); } catch (e) { /* the MPE row is additive */ }
  avMidiDrawMonitor();
  return true;
}

/* status copy goes into the panel (no hub, no toast) */
function avMidiSay(text) {
  avMidiSayState = String(text == null ? "" : text);
  try {
    const el = document.getElementById("av-midi-say");
    if (el) el.textContent = avMidiSayState;
  } catch (e) { /* panel not up */ }
  return avMidiSayState;
}

/* ---------- out tap + sends (PF L655-702) ---------- */

/* patches MIDIOutput.prototype.send; the wrapper records 'out' unless the send is OUR own */
function avMidiOutTapInstall() {
  if (avMidiOutTapOk) return true;
  try {
    const P = (typeof MIDIOutput !== "undefined" && MIDIOutput.prototype) || null;
    if (!P || typeof P.send !== "function") return false;
    const orig = P.send;
    P.send = function (data, timestamp) {
      try { if (!avMidiSelfSend) avMidiRecord("out", data, (this && this.name) || ""); } catch (e) { /* the tap never breaks a send */ }
      return orig.apply(this, arguments);
    };
    avMidiOutTapOk = true;
    return true;
  } catch (e) { return false; }
}

function avMidiSendBytes(port, bytes) {
  if (!port) return false;
  const arr = Array.prototype.slice.call(bytes || []);
  if (!arr.length) return false;
  try {
    /* a port must be open before it will send (PF L675-678) */
    if (port.connection !== "open" && typeof port.open === "function") {
      try { const p = port.open(); if (p && p.catch) p.catch(() => { /* the send below reports the real problem */ }); } catch (e) { /* already opening */ }
    }
    avMidiSelfSend = true;
    try { port.send(arr); }
    finally { avMidiSelfSend = false; }
    /* the tap skips our own sends, so record here exactly once — whether or not a tap exists (PF L682-684) */
    avMidiRecord("out", arr, port.name || "");
    return true;
  } catch (e) {
    avMidiSelfSend = false;
    avMidiSay("MIDI send failed: " + (e && e.message ? e.message : e));
    return false;
  }
}

/* a real note on the selected port — proves the route without pressing play */
function avMidiSendTest(note, ms) {
  const port = avMidiSelectedOutputPort();
  if (!port) { avMidiSay("No MIDI output selected"); return false; }
  const n = (note == null) ? 60 : Math.max(0, Math.min(127, note | 0));
  const ok = avMidiSendBytes(port, [0x90, n, 100]);
  setTimeout(() => avMidiSendBytes(port, [0x80, n, 0]), (ms == null) ? 260 : ms);
  if (ok) avMidiSay("Test note → " + (port.name || "output"));
  return ok;
}

/* ---------- enable / disable (PF L258-354) ---------- */

async function avMidiEnable() {
  if (!avMidiSupported()) {
    avMidiStatus = "unsupported";
    avMidiSay("This browser has no Web MIDI");
    avMidiRender();
    return avMidiSnap();
  }
  avMidiStatus = "asking";
  avMidiError = "";
  avMidiRender();
  try {
    /* no {sysex:true}: the deck never sends sysex, so it never asks for it (PF L268-269) */
    const acc = await navigator.requestMIDIAccess();
    avMidiAccess = acc;
    avMidiEnabled = true;
    avMidiStatus = "enabled";
    try { acc.onstatechange = avMidiOnStateChange; } catch (e) { /* not supported */ }
    try { acc.onconnect = avMidiOnStateChange; } catch (e) { /* not supported */ }
    try { acc.ondisconnect = avMidiOnStateChange; } catch (e) { /* not supported */ }
    avMidiOutTapInstall();
    avMidiAutoPick();
    avMidiAttachInput();
    const nIn = avMidiPorts("in").length, nOut = avMidiPorts("out").length;
    avMidiSay("MIDI ON — " + nIn + " in / " + nOut + " out");
  } catch (err) {
    const name = (err && err.name) || "";
    avMidiStatus = (name === "NotAllowedError" || name === "SecurityError") ? "denied" : "failed";
    avMidiError = (err && err.message) ? String(err.message) : String(err || "unknown error");
    avMidiSay(avMidiStatus === "denied" ? "MIDI access denied by the browser" : "MIDI failed: " + avMidiError);
  }
  avMidiRender();
  return avMidiSnap();
}

function avMidiOff() {
  if (avMidiClockOut.ticking) avMidiClockOutStop("MIDI was released");   /* 0xFC while the port is still here */
  avMidiDetachInput();
  avMidiReleaseAll();
  avMidiAccess = null;
  avMidiEnabled = false;
  avMidiStatus = avMidiSupported() ? "idle" : "unsupported";
  avMidiRender();
  return avMidiSnap();
}

function avMidiOnStateChange() {
  if (!avMidiEnabled) return;
  avMidiAutoPick();
  avMidiAttachInput();
  avMidiRender();
}

/* saved pick → first connected → first (PF L312-326; the PF master-route preference is gone) */
function avMidiAutoPick() {
  const ins = avMidiPorts("in"), outs = avMidiPorts("out");
  if (!avMidiSelectedInputPort()) {
    const connected = ins.find(p => p.state === "connected") || ins[0];
    if (connected) avMidiPrefs.in = connected.id;
  }
  if (!avMidiSelectedOutputPort()) {
    const pick = outs.find(p => p.state === "connected") || outs[0];
    if (pick) avMidiPrefs.out = pick.id;
  }
  avMidiSavePrefs();
}

function avMidiSetIn(v) {
  const port = avMidiPortFor("in", v);
  if (!port) { avMidiSay("No such MIDI input"); return false; }
  avMidiDetachInput();
  avMidiReleaseAll();
  avMidiPrefs.in = port.id || port.name || "";
  avMidiSavePrefs();
  avMidiAttachInput();
  avMidiRender();
  return true;
}

function avMidiSetOut(v) {
  const port = avMidiPortFor("out", v);
  if (!port) { avMidiSay("No such MIDI output"); return false; }
  avMidiPrefs.out = port.id || port.name || "";
  avMidiSavePrefs();
  avMidiRender();
  return true;
}

function avMidiRefresh() {
  avMidiAutoPick();
  avMidiAttachInput();
  avMidiRender();
  return { inputs: avMidiPorts("in"), outputs: avMidiPorts("out") };
}

/* ---------- play in: hardware keys → the ONE note path (PF L356-450) ---------- */

function avMidiAttachInput() {
  const port = avMidiSelectedInputPort();
  if (port === avMidiInPort && avMidiInHandler) return;
  avMidiDetachInput();
  if (!port) return;
  avMidiInPort = port;
  avMidiInHandler = (e) => avMidiOnInputMessage(e, port);
  try {
    /* LAW (PF L370-372): addEventListener, not onmidimessage — another WebMidi user on the page
       (the engine's own midi module) may claim onmidimessage on the same port; listeners coexist. */
    port.addEventListener("midimessage", avMidiInHandler);
  } catch (e) {
    try { port.onmidimessage = avMidiInHandler; } catch (e2) { avMidiSay("MIDI input attach failed: " + e2); }
  }
}

function avMidiDetachInput() {
  if (avMidiInPort && avMidiInHandler) {
    try { avMidiInPort.removeEventListener("midimessage", avMidiInHandler); } catch (e) { /* ok */ }
  }
  avMidiInPort = null;
  avMidiInHandler = null;
}

function avMidiOnInputMessage(e, port) {
  const bytes = Array.prototype.slice.call((e && e.data) || []);
  if (!bytes.length) return;
  const pname = (port && port.name) || "";
  avMidiRecord("in", bytes, pname);       /* monitor first (PF L390) */
  /* T wave: the passive sysex forward to the TUNE card's MTS sink - no sink, zero extra work */
  if (avMidiSysExSink && ((bytes[0] & 0xff) === 0xf0 || avMidiSysExBuf.length)) avMidiSysExForward(bytes);
  const m = avMidiDecode(bytes);
  if (!m) return;
  /* M2: the MPE branch -- a live member channel routes to the deck; everything else falls through */
  if (typeof avMpeDeckIncoming === "function" && avMpeDeckIncoming(m) === true) return;
  if (m.type === "noteon") avMidiNoteOn(m.note, m.vel, m.chan);
  else if (m.type === "noteoff") avMidiNoteOff(m.note, m.chan);
  else if (m.type === "cc") avMidiCcIncoming(m);
  else if (m.type === "pitchbend") avMidiBendIncoming(m);
  else if (m.type === "touch") avMidiTouchIncoming(m);
  /* clock / start / continue / stop / sensing / reset / sysex / program / polytouch:
     decoded and monitored only — no branch here (PF L61, L393-398); sysex additionally rides
     the passive sink forward above when the TUNE card has registered one */
}

function avMidiNoteOn(note, velByte, chan) {
  const name = (typeof avNoteName === "function") ? avNoteName(note) : String(note);
  const vel = Math.max(0, Math.min(127, velByte == null ? 100 : velByte));
  avMidiLastNote = { note, name, vel, at: Date.now() };
  avMidiMonTouch();                       /* the readout updates even when play-in is off (PF L407-408) */
  if (!avMidiPrefs.playIn) return;
  if (typeof avNoteDown !== "function") return;
  avMidiHeld.add(name);
  avNoteDown(name, vel / 127);
}

function avMidiNoteOff(note, chan) {
  const name = (typeof avNoteName === "function") ? avNoteName(note) : String(note);
  avMidiHeld.delete(name);
  if (typeof avNoteUp === "function") avNoteUp(name);
}

function avMidiReleaseAll() {
  if (typeof avMpeDeckRelease === "function") avMpeDeckRelease();
  if (!avMidiHeld.size) return;
  [...avMidiHeld].forEach(n => { if (typeof avNoteUp === "function") avNoteUp(n); });
  avMidiHeld = new Set();
  avMidiMonTouch();
}

function avMidiSetPlayIn(v) {
  avMidiPrefs.playIn = !!v;
  avMidiSavePrefs();
  if (!avMidiPrefs.playIn) avMidiReleaseAll();
  avMidiRender();
  return avMidiPrefs.playIn;
}

/* ---------- live expression → avApplyParam (PF L1617-1654) ---------- */

function avMidiParam(path, v) {
  if (typeof avApplyParam !== "function") return false;
  try { avApplyParam(path, v); return true; } catch (e) { return false; }
}

/* pitch bend: ±2 semitones default feel (PF L1620-1626) */
function avMidiBendIncoming(m) {
  const semis = (Math.max(-8192, Math.min(8191, m.bend || 0)) / 8192) * 2;
  return avMidiParam("perf.bend", semis) ? 1 : 0;
}

/* channel aftertouch → raw 0..127 (PF L1630-1636) */
function avMidiTouchIncoming(m) {
  const p = (m.data && m.data[1] != null) ? m.data[1] : 0;
  return avMidiParam("perf.at", p) ? 1 : 0;
}

/* channel-mode messages: the panic paths stay alive for hardware (PF L1638-1654);
   the omni/mono/poly switches are acknowledged and ignored */
function avMidiChannelMode(m) {
  if (m.cc === 120 || m.cc === 123) {
    avMidiReleaseAll();
    if (typeof avNoteStopAll === "function") avNoteStopAll();
    avMidiMonTouch();
    return 1;
  }
  if (m.cc === 121) {
    avMidiParam("perf.sustain", false);
    avMidiParam("perf.bend", 0);
    return 1;
  }
  return 0;
}

/* ---------- incoming CC: learn-pick → channel modes → binds → default map (PF L1558-1615) ---------- */

function avMidiCcDefault(m) {
  const row = AV_MIDI_CC_DEFAULT[m.cc];
  if (!row) return 0;
  try { row.apply(m.value); } catch (e) { return 0; }
  return 1;
}

function avMidiCcIncoming(m) {
  /* (1) while armed with no controller picked, the FIRST CC picks it */
  if (avMidiLearn.armed && avMidiLearn.cc == null) {
    if (m.cc > AV_MIDI_CC_MAX) {
      avMidiLearn.refused += 1;
      avMidiLearn.lastRefused = m.cc;
      avMidiSay("CC " + m.cc + " is a channel-mode message (120-127), not a control — move a knob on the hardware");
      avMidiMonTouch();
      return 0;
    }
    avMidiLearn.cc = m.cc;
    avMidiLearn.chan = m.chan || 0;
    avMidiLearn.at = Date.now();
    avMidiSay("LEARN: CC " + m.cc + " — CLICK A KNOB");
    avMidiRender();
    return 0;
  }
  /* (2) CC 120-127 are channel-mode messages, never learnable controls (PF L1574-1576) */
  if (m.cc > AV_MIDI_CC_MAX) { avMidiChannelMode(m); avMidiMonTouch(); return 1; }
  /* (3) learned bindings — learn always wins over the default map (PF L1584-1591) */
  let hits = 0;
  avMidiCcBinds.forEach(b => {
    if (b.cc !== m.cc) return;
    if (b.ch && m.chan && b.ch !== m.chan) return;
    avMidiCcApply(b, m.value);
    hits += 1;
  });
  /* (4) the default performance map plays when nothing is learned */
  if (!hits) hits += avMidiCcDefault(m);
  if (avMidiLearn.armed) avMidiMonTouch();
  return hits;
}

/* ---------- CC learn: arm → pick → swallow-click bind → write (PF L1417-1718) ---------- */

function avMidiCcLoad() {
  try {
    const raw = localStorage.getItem(AV_MIDI_BIND_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    avMidiCcBinds = Array.isArray(arr) ? arr
      .filter(b => b && typeof b.cc === "number" && typeof b.path === "string" && b.path)
      .slice(0, AV_MIDI_CC_BIND_MAX)
      .map(b => ({
        id: "b" + (++avMidiCcSeq), cc: b.cc | 0, ch: b.ch | 0, path: String(b.path),
        label: String(b.label || ""),
        min: Number.isFinite(b.min) ? b.min : 0,
        max: Number.isFinite(b.max) ? b.max : 1,
        step: Number.isFinite(b.step) ? b.step : 0,
        curve: String(b.curve || "lin"),
        def: Number.isFinite(b.def) ? b.def : null,
        hits: 0,
      })) : [];
  } catch (e) { avMidiCcBinds = []; }
  return avMidiCcBinds.length;
}

function avMidiCcSave() {
  try {
    localStorage.setItem(AV_MIDI_BIND_KEY, JSON.stringify(avMidiCcBinds.slice(0, AV_MIDI_CC_BIND_MAX).map(b => ({
      cc: b.cc, ch: b.ch, path: b.path, label: b.label, min: b.min, max: b.max, step: b.step, curve: b.curve, def: b.def,
    }))));
  } catch (e) { /* storage blocked */ }
}

function avMidiCcBindKey(b) { return "cc" + b.cc + ":ch" + (b.ch || 0) + ":" + b.path; }
function avMidiCcFind(id) { return avMidiCcBinds.find(b => b.id === id) || null; }

/* the on-screen control bound to a path — the av-knob contract (av_knob.js L106) */
function avMidiCcElement(path) {
  if (!path) return null;
  try { return document.querySelector('.av-knob[data-knob="' + avMidiCssEsc(path) + '"]'); } catch (e) { return null; }
}

function avMidiCcBindFrom(el, path, cc, chan) {
  if (!el || !path) return null;
  if (cc == null || cc < 0 || cc > AV_MIDI_CC_MAX) return null;
  if (avMidiCcBinds.length >= AV_MIDI_CC_BIND_MAX) { avMidiSay("Binding list is full (" + AV_MIDI_CC_BIND_MAX + ")"); return null; }
  const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const isKnob = !!(el.classList && el.classList.contains("av-knob"));
  const label = isKnob ? String(el.getAttribute("aria-label") || path) : String(path);
  const spec = {
    cc: cc | 0, ch: chan | 0, path: String(path), label,
    min: isKnob ? num(el.dataset.min, 0) : num(el.min, 0),
    max: isKnob ? num(el.dataset.max, 1) : num(el.max, 1),
    step: isKnob ? num(el.dataset.step, 0) : num(el.step, 0),
    curve: isKnob ? String(el.dataset.curve || "lin") : "lin",
    def: isKnob ? num(el.dataset.def, 0) : null,
  };
  /* one controller per target, one target per controller — rebinding replaces, never stacks (PF L1475-1476) */
  avMidiCcBinds = avMidiCcBinds.filter(b => !(b.cc === spec.cc && (b.ch || 0) === (spec.ch || 0)) && b.path !== spec.path);
  const b = Object.assign({ id: "b" + (++avMidiCcSeq), hits: 0 }, spec);
  avMidiCcBinds.push(b);
  avMidiCcSave();
  return b;
}

function avMidiCcUnbind(idOrKey) {
  const i = avMidiCcBinds.findIndex(b => b.id === idOrKey || avMidiCcBindKey(b) === idOrKey || b.path === idOrKey);
  if (i < 0) return false;
  avMidiCcBinds.splice(i, 1);
  avMidiCcSave();
  avMidiRender();
  return true;
}

function avMidiCcClearAll() {
  const n = avMidiCcBinds.length;
  avMidiCcBinds = [];
  avMidiCcSave();
  avMidiRender();
  return n;
}

function avMidiLearnArm() {
  if (avMidiLearn.armed) { avMidiLearnCancel(); return false; }
  if (!avMidiEnabled) { avMidiSay("ENABLE MIDI first — learn listens on the selected input"); return false; }
  avMidiLearn.armed = true;
  avMidiLearn.cc = null;
  avMidiLearn.chan = 0;
  avMidiLearn.armedAt = Date.now();
  avMidiSay("CC LEARN armed — move a knob on your hardware, then click an av-knob");
  avMidiRender();
  return true;
}

function avMidiLearnCancel() {
  if (!avMidiLearn.armed) return false;
  avMidiLearn.armed = false;
  avMidiLearn.cc = null;
  avMidiSay("CC LEARN cancelled");
  avMidiRender();
  return true;
}

/* LAW (PF L1518-1520, L1544-1545): the click is swallowed in the capture phase while armed —
   binding a control must never turn it. No hub overlay exists here, so there is nothing to
   step aside; the panel's own copy carries the instructions. */
function avMidiLearnClick(e) {
  if (!avMidiLearn.armed) return;
  const t = e && e.target;
  const el = (t && t.closest) ? t.closest(".av-knob[data-knob]") : null;
  if (!el) return;
  const path = el.dataset.knob;
  if (!path) return;
  e.preventDefault();
  e.stopPropagation();
  if (avMidiLearn.cc == null) { avMidiSay("Move a knob on the hardware first — that is the CC this binds"); return; }
  const b = avMidiCcBindFrom(el, path, avMidiLearn.cc, avMidiLearn.chan);
  if (!b) return;
  avMidiLearn.bound += 1;
  avMidiLearn.armed = false;
  avMidiLearn.cc = null;
  avMidiSay("Bound CC " + b.cc + " → " + b.label + " (" + b.path + ")");
  avMidiRender();
}

function avMidiLearnListen() {
  if (avMidiLearnWired) return false;
  avMidiLearnWired = true;
  document.addEventListener("click", avMidiLearnClick, true);
  return true;
}

/* coalesced: a knob sweep is ~100 messages/s, the parameter is written at most every
   AV_MIDI_CC_WINDOW ms with the newest value (PF L1656-1657) */
function avMidiCcApply(b, value) {
  b.hits += 1;
  b.last = value;
  b.at = Date.now();
  avMidiCcQueue.set(b.id, value);
  if (avMidiCcTimer) return;
  avMidiCcFlush();
  avMidiCcTimer = setTimeout(() => { avMidiCcTimer = null; avMidiCcFlush(); }, AV_MIDI_CC_WINDOW);
}

function avMidiCcFlush() {
  if (!avMidiCcQueue.size) return;
  const items = [...avMidiCcQueue];
  avMidiCcQueue.clear();
  items.forEach(([id, value]) => {
    const b = avMidiCcFind(id);
    if (b) avMidiCcWrite(b, value);
  });
  avMidiMonTouch();
}

/* the write: value → avKnobNormToVal → avApplyParam → repaint the knob DIRECTLY.
   NEVER avKnobCommit: its damping would fight the hardware (PF L1682-1706). */
function avMidiCcWrite(b, value) {
  const norm = Math.max(0, Math.min(1, (Number(value) || 0) / 127));
  const v = (typeof avKnobNormToVal === "function") ? avKnobNormToVal(norm, b.min, b.max, b.curve, b.step) : norm;
  try {
    if (typeof avApplyParam !== "function") throw new Error("avApplyParam missing");
    avApplyParam(b.path, v);
  } catch (e) {
    b.errors = (b.errors || 0) + 1;
    return false;
  }
  avMidiCcWrites += 1;
  b.applied = v;
  b.appliedAt = Date.now();
  const el = avMidiCcElement(b.path);
  const txt = (typeof avKnobFormat === "function") ? avKnobFormat(v, el ? { fmt: el.dataset.fmt || "", unit: el.dataset.unit || "" } : {}) : String(v);
  if (el) {
    if (typeof avKnobApplyVisual === "function") avKnobApplyVisual(el, v);
    if (el.tagName === "INPUT") el.value = v;
    try { document.querySelectorAll('[data-kval="' + avMidiCssEsc(b.path) + '"]').forEach(n => { n.textContent = txt; }); } catch (e) { /* odd path */ }
  }
  return true;
}

function avMidiCcSnap() {
  return {
    armed: !!avMidiLearn.armed,
    cc: avMidiLearn.cc, chan: avMidiLearn.chan, refused: avMidiLearn.refused, boundCount: avMidiLearn.bound,
    max: AV_MIDI_CC_MAX, cap: AV_MIDI_CC_BIND_MAX, window: AV_MIDI_CC_WINDOW, writes: avMidiCcWrites,
    binds: avMidiCcBinds.map(b => ({
      id: b.id, cc: b.cc, ch: b.ch, path: b.path, label: b.label, min: b.min, max: b.max, step: b.step, curve: b.curve,
      hits: b.hits, last: b.last, applied: b.applied, onScreen: !!avMidiCcElement(b.path),
    })),
  };
}

/* ---------- clock out: the transport, on the wire (PF L1825-1966) ---------- */

/* the tempo the clock follows — Anvil's avState.bpm, read fresh on every tick (PF L1849-1855) */
function avMidiClockBpm() {
  try {
    if (typeof avState === "undefined") return 0;
    const bpm = Number(avState.bpm);
    return (isFinite(bpm) && bpm > 0) ? Math.round(bpm * 1000) / 1000 : 0;
  } catch (e) { return 0; }
}

function avMidiClockGapMs() {
  const bpm = avMidiClockBpm();
  return bpm > 0 ? AV_MIDI_CLOCK_NOTE_MS / bpm : 0;
}

function avMidiClockPort() {
  return avMidiEnabled ? avMidiSelectedOutputPort() : null;
}

function avMidiClockOutSnap() {
  const out = avMidiSelectedOutput();
  return {
    on: !!avMidiPrefs.clockOut,
    playing: !!avMidiClockOut.playing,
    ticking: !!avMidiClockOut.ticking,
    ticks: avMidiClockOut.ticks,
    starts: avMidiClockOut.starts,
    stops: avMidiClockOut.stops,
    bpm: avMidiClockBpm(),
    out: out ? out.name : "",
    lastGaps: avMidiClockOut.lastGaps.slice(),
    lastError: avMidiClockOut.lastError,
  };
}

/* why a start could not happen — one sentence, shown on the panel and in state() (PF L1874-1879) */
function avMidiClockWhyNot() {
  if (!avMidiPrefs.clockOut) return "clock out is off — switch the CLOCK OUT row on";
  if (!avMidiEnabled) return "MIDI is not enabled — press ENABLE MIDI first";
  if (!avMidiSelectedOutputPort()) return "no output selected — pick one in OUTPUTS above";
  return "";
}

function avMidiClockOutStart(why) {
  const blocked = avMidiClockWhyNot();
  if (blocked) {
    avMidiClockOut.lastError = blocked;
    avMidiMonTouch();
    return avMidiClockOutSnap();
  }
  if (avMidiClockOut.ticking) return avMidiClockOutSnap();   /* already running: never a second 0xFA */
  const port = avMidiClockPort();
  avMidiClockOut.lastError = "";
  avMidiClockOut.ticking = true;
  avMidiClockOut.starts += 1;
  avMidiClockOut.lastGaps = [];
  avMidiClockOut.nextAt = 0;
  avMidiClockOut.lastTickAt = 0;
  avMidiSendBytes(port, [AV_MIDI_CLOCK_START]);              /* 0xFA now, ticks from here on */
  avMidiClockSchedule();
  avMidiMonTouch();
  return avMidiClockOutSnap();
}

function avMidiClockOutStop(why) {
  if (!avMidiClockOut.ticking) return avMidiClockOutSnap();  /* nothing was running: nothing to send */
  avMidiClockOut.ticking = false;
  if (avMidiClockOut.timer) { clearTimeout(avMidiClockOut.timer); avMidiClockOut.timer = null; }
  avMidiClockOut.nextAt = 0;
  avMidiClockOut.lastTickAt = 0;
  avMidiClockOut.stops += 1;
  const port = avMidiClockPort();
  if (port) avMidiSendBytes(port, [AV_MIDI_CLOCK_STOP]);
  else avMidiClockOut.lastError = "no output to send the stop byte to (" + (why || "stopped") + ")";
  avMidiMonTouch();
  return avMidiClockOutSnap();
}

/* one tick, then re-arm — the gap is read fresh every time, so a tempo change bites here */
function avMidiClockOutTick() {
  avMidiClockOut.timer = null;
  if (!avMidiClockOut.ticking) return;
  const port = avMidiClockPort();
  if (!port) { avMidiClockOut.lastError = "the output went away — clock stopped"; avMidiClockOutStop("the output went away"); return; }
  const now = Date.now();
  if (avMidiClockOut.lastTickAt) {
    avMidiClockOut.lastGaps.push(now - avMidiClockOut.lastTickAt);
    while (avMidiClockOut.lastGaps.length > AV_MIDI_CLOCK_GAPS) avMidiClockOut.lastGaps.shift();
  }
  avMidiClockOut.lastTickAt = now;
  avMidiClockOut.ticks += 1;
  avMidiClockOut.lastError = "";
  avMidiSendBytes(port, [AV_MIDI_CLOCK_TICK]);
  avMidiClockSchedule();
}

function avMidiClockSchedule() {
  if (!avMidiClockOut.ticking) return;
  const gap = avMidiClockGapMs();
  if (!(gap > 0)) { avMidiClockOut.lastError = "the tempo reads 0 — the clock has nothing to follow"; avMidiClockOutStop("tempo 0"); return; }
  const now = Date.now();
  const wasAt = avMidiClockOut.nextAt || now;
  /* LAW (PF L1943-1947): the next tick sits one period after the LAST SCHEDULED one, not after
     "now" — a late wake-up is made up on the following tick instead of shifting the grid. Only a
     tick already more than half a period behind resyncs to now (caught-up clocks stutter). */
  avMidiClockOut.nextAt = (wasAt < now - gap * 0.5 ? now : wasAt) + gap;
  avMidiClockOut.timer = setTimeout(avMidiClockOutTick, Math.max(1, Math.round(avMidiClockOut.nextAt - now)));
}

/* the one-line hook a transport calls — start on play, stop on stop, honest when it cannot (PF L1952-1956) */
function avMidiClockTransport(isPlaying) {
  avMidiClockOut.playing = !!isPlaying;
  if (!isPlaying) {
    if (avMidiClockOut.ticking) return avMidiClockOutStop("the transport stopped");
    return avMidiClockOutSnap();
  }
  if (!avMidiPrefs.clockOut) return avMidiClockOutSnap();    /* off is off: no complaint */
  return avMidiClockOutStart("the transport started");
}

function avMidiClockOutSetOn(on) {
  avMidiPrefs.clockOut = !!on;
  avMidiSavePrefs();
  if (!avMidiPrefs.clockOut) {
    if (avMidiClockOut.ticking) avMidiClockOutStop("clock out switched off");
  } else if (avMidiClockOut.playing && !avMidiClockOut.ticking) {
    avMidiClockOutStart("clock out switched on mid-run");
  } else {
    avMidiClockOut.lastError = "";     /* switching on is not an error, even before the transport */
  }
  avMidiRender();
  return avMidiClockOutSnap();
}

/* one sentence for the panel readout and for state() — never two versions of the truth */
function avMidiClockStateText() {
  const s = avMidiClockOutSnap();
  if (!s.on) return "off — nothing is sent";
  if (s.lastError) return s.lastError;
  if (!avMidiEnabled) return "MIDI is not enabled — press ENABLE MIDI";
  if (!s.out) return "no output selected — pick one in OUTPUTS above";
  if (s.ticking) return "running · " + s.ticks + " ticks · " + s.bpm + " BPM → " + s.out;
  return "ready — waiting for the transport → " + s.out;
}

function avMidiClockTicksText() {
  const s = avMidiClockOutSnap();
  return s.ticks + " · " + s.bpm + " BPM · " + s.starts + " start" + (s.starts === 1 ? "" : "s") + " · " + s.stops + " stop" + (s.stops === 1 ? "" : "s");
}

/* ---------- panel wiring: ONE delegated click listener on the panel root ---------- */

function avMidiWirePanel() {
  const host = document.getElementById("av-midi-body");
  if (!host || host.dataset.avMidiWired === "1") return false;
  host.dataset.avMidiWired = "1";
  host.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== "function") return;
    const act = t.closest("[data-midi]");
    if (act) {
      const a = act.dataset.midi;
      if (a === "enable") { avMidiEnable(); return; }
      if (a === "disable") { avMidiOff(); return; }
      if (a === "refresh") { avMidiRefresh(); avMidiSay("MIDI devices re-read"); return; }
      if (a === "testnote") { avMidiSendTest(); return; }
      if (a === "playin") { avMidiSetPlayIn(act.dataset.midival !== "0"); return; }
      if (a === "clear") { avMidiClearMonitor(); return; }
      return;
    }
    const pin = t.closest("[data-midiin-pick]");
    if (pin) { avMidiSetIn(pin.dataset.midiinPick); return; }
    const pout = t.closest("[data-midiout-pick]");
    if (pout) { avMidiSetOut(pout.dataset.midioutPick); return; }
    const clk = t.closest("[data-midiclock]");
    if (clk) { avMidiClockOutSetOn(clk.dataset.midiclock !== "off"); return; }
    const lrn = t.closest("[data-midilearn]");
    if (lrn) {
      if (lrn.dataset.midilearn === "arm") avMidiLearnArm();
      else if (lrn.dataset.midilearn === "clear") {
        const n = avMidiCcClearAll();
        avMidiSay(n ? "Cleared " + n + " CC binding" + (n === 1 ? "" : "s") : "No bindings to clear");
      }
      return;
    }
    const del = t.closest("[data-ccbind-del]");
    if (del) { avMidiCcUnbind(del.dataset.ccbindDel); return; }
  });
  return true;
}

/* ---------- prefs + boot ---------- */

function avMidiLoadPrefs() {
  try {
    const raw = localStorage.getItem(AV_MIDI_PREF_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (v && typeof v === "object") {
        avMidiPrefs = {
          in: typeof v.in === "string" ? v.in : "",
          out: typeof v.out === "string" ? v.out : "",
          playIn: typeof v.playIn === "boolean" ? v.playIn : true,
          clockOut: typeof v.clockOut === "boolean" ? v.clockOut : false,
          mpe: typeof v.mpe === "boolean" ? v.mpe : false,
          mpeBend: (v.mpeBend === 24 || v.mpeBend === 48 || v.mpeBend === 96) ? v.mpeBend : 48,
        };
      }
    }
  } catch (e) { /* defaults */ }
  return avMidiPrefs;
}

function avMidiSavePrefs() {
  try { localStorage.setItem(AV_MIDI_PREF_KEY, JSON.stringify(avMidiPrefs)); } catch (e) { /* blocked */ }
}

function avMidiErr(msg) {
  avMidiStatus = avMidiSupported() ? "failed" : "unsupported";
  avMidiError = String(msg || "");
  avMidiRender();
}

/* called by app_core's avBoot; idempotent */
function avMidiInit() {
  if (avMidiWired) return true;
  avMidiWired = true;
  avMidiLoadPrefs();
  avMidiCcLoad();
  avMidiStatus = avMidiSupported() ? "idle" : "unsupported";
  try {
    avMidiOutTapInstall();               /* passive: costs nothing until a send happens (PF L994) */
    avMidiRender();                      /* the full panel into #av-midi-body */
    avMidiWirePanel();                   /* ONE delegated click listener on the panel root */
    avMidiLearnListen();                 /* capture-phase bind click (PF L2294) */
  } catch (e) {
    avMidiErr(String((e && e.message) || e));
  }
  return true;
}

/* ---------- the aggregate snapshot (the PF midiStateSnap shape, L900-933, minus the deferred
   sections: there is no MPE / capture / PC / routing state in Anvil's deck) ---------- */

function avMidiSnap() {
  const inSel = avMidiSelectedInput(), outSel = avMidiSelectedOutput();
  return {
    supported: avMidiSupported(),
    status: avMidiStatus,
    enabled: !!avMidiEnabled,
    error: avMidiError,
    inputs: avMidiPorts("in").length,
    outputs: avMidiPorts("out").length,
    in: inSel ? inSel.name : "",
    inId: inSel ? inSel.id : "",
    out: outSel ? outSel.name : "",
    outId: outSel ? outSel.id : "",
    playIn: !!avMidiPrefs.playIn,
    held: [...avMidiHeld],
    lastNote: avMidiLastNote ? { note: avMidiLastNote.note, name: avMidiLastNote.name, vel: avMidiLastNote.vel, at: avMidiLastNote.at } : null,
    learn: { armed: !!avMidiLearn.armed, cc: avMidiLearn.cc, chan: avMidiLearn.chan, bindings: avMidiCcBinds.length },
    clock: avMidiClockOutSnap(),
    monitor: {
      total: { in: avMidiMonTotal.in, out: avMidiMonTotal.out },
      dropped: { in: avMidiMonDropped.in, out: avMidiMonDropped.out },
      kept: { in: avMidiMonIn.length, out: avMidiMonOut.length },
      caps: { ring: AV_MIDI_MON_MAX, dom: AV_MIDI_DOM_MAX, rate: AV_MIDI_MON_RATE, flushMs: AV_MIDI_FLUSH_MS },
    },
    tap: !!avMidiOutTapOk,
    mpe: (typeof avMpeDeckSnap === "function") ? avMpeDeckSnap() : null,
  };
}

/* ---------- debug API (the suites and the parent call these; names are the contract) ---------- */

if (typeof window !== "undefined") {
  window.__avMidi = {
    version: "1.0",
    snap: () => avMidiSnap(),
    enable: () => avMidiEnable(),
    off: () => avMidiOff(),
    refresh: () => avMidiRefresh(),
    setIn: (v) => avMidiSetIn(v),
    setOut: (v) => avMidiSetOut(v),
    playIn: (v) => avMidiSetPlayIn(v),
    clearMonitor: () => { avMidiClearMonitor(); return avMidiSnap(); },
    sendTest: (note, ms) => avMidiSendTest(note, ms),
    monitor: (dir) => (dir === "in" ? avMidiMonIn.slice() : dir === "out" ? avMidiMonOut.slice() : { in: avMidiMonIn.slice(), out: avMidiMonOut.slice() }),
    learn: {
      arm: () => avMidiLearnArm(),
      cancel: () => avMidiLearnCancel(),
      state: () => avMidiCcSnap(),
      bindings: () => avMidiCcSnap().binds,
      clear: () => avMidiCcClearAll(),
    },
    clock: {
      setOn: (on) => avMidiClockOutSetOn(on),
      state: () => avMidiClockOutSnap(),
    },
  };
}
