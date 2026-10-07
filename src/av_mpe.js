/* av_mpe.js - Anvil M2 MPE expression kernel (AVM): per-channel bend / pressure / timbre /
   pan state for MIDI Polyphonic Expression, shared by the AudioWorklet DSP and the page /
   SPN tiers. Contract: verify/_m2_wave.md section 2.1 (exact API + the node-harness list).
   Sibling idiom: src/av_fm.js - ONE top-level const IIFE, strict mode, worklet-safe text
   that is concatenated into BOTH the AudioWorklet module AND the page bundle (concat order
   pinned in the wave's section 4). Lineage: the MPE MIDI convention (a zone on the master
   channel with per-note expression on the member channels 1..15) plus the equal-power pan
   law; written from first principles for this project - no third-party source was used,
   copied or vendored.

   LAWS (same house laws as av_fm / av_grain):
   - strict mode; exactly ONE top-level name (AVM). Worklet-safe AND page-safe: no window,
     document, console, fetch, performance, timers, storage or randomness; no DOM at load.
     The kernel keeps no clock - Date is not needed anywhere in this file.
   - never throws: every entry point validates state / channel / dim / value first and
     answers with an honest default (0 / -1 / [1,1] / false / empty snap) instead.
   - every value clamped: bend to +/- the zone bend range; pressure CC 0..127 -> 0..1;
     timbre CC 0..127 -> log2 Hz clamped into [log2(20), log2(18000)]; pan CC 0..127 ->
     (v-64)/63 clamped to +/-1.
   - deterministic: pure arithmetic only; the same ops produce deep-equal snaps.

   STATE - AVM.create() -> st = { on:0, bendRange:48, chBend:F64(16), chAt:F64(16),
   chTimb:F64(16) filled -1 (none), chPan:F64(16), chNotes:F64(16) held counts, panAny:0 }.
   Channels are 0-based MIDI channel indices; 1..15 are the MPE member channels. Index 0
   (the master channel) is never written by member ops.

   INTERFACE (pinned; names EXACT):
   - setZone(st, on, bend) -> bool. on is coerced to bool. bend is accepted only from
     {24, 48, 96}; any other value keeps the current range. Setting the zone OFF clears
     every channel state: bend/at/pan -> 0, timb -> -1 (none), held counts -> 0, panAny 0.
     The zone bend range itself is kept (callers re-push it; the deck owns the preference).
   - setExpr(st, ch, dim, v) -> bool. Member ch 1..15 (strict integer) only; refused when
     the zone is off, the channel is not a member, dim is unknown, or v is not finite.
     RAW inputs, the kernel clamps (see LAWS):
       "bend"   v already in semitones -> clamp +/- bendRange
       "at"     raw CC 0..127         -> clamp 0..127 then /127 (0..1)
       "timbre" raw CC 0..127         -> log2(60 * 300^(v/127)) clamped to
                                         [log2(20), log2(18000)]
                                         (CC 0 -> log2(60) ~ 5.907; CC 127 -> log2(18000) ~ 14.136)
       "pan"    raw CC 0..127         -> (clamp 0..127 - 64)/63 clamped -1..+1; panAny is
                                         recomputed from all member banks on every pan write
   - pitchSemis(st, ch) -> 0 when off / non-member, else the stored chBend.
   - cutBase(st, ch)    -> -1 when off / none / non-member, else the stored chTimb (log2 Hz).
   - atOct(st, ch)      -> 0 when off / non-member, else chAt * 2 (octaves).
   - panGains(st, ch)   -> fresh [L,R]; equal power L = cos((p+1)*pi/4), R = sin((p+1)*pi/4)
                           so L*L+R*R = 1; exactly [1,1] when the zone is off or p is 0
                           (centre pan applies no attenuation).
   - noteIn(st, ch) / noteOut(st, ch) -> chNotes +/-1, floored at 0; member channels only.
   - activeCount(st)    -> member channels with a held count > 0.
   - clearExpr(st)      -> the four expression dims back to defaults; keeps on and counts.
   - snap(st)           -> JSON-safe { on, bendRange, active, panAny, ch:[{i, notes, bend,
                           at, timb, pan}] } listing only channels with any nonzero activity. */
"use strict";

const AVM = (function () {
  "use strict";

  const VERSION = "m2.0";
  const NCH = 16;              /* channel slots; 1..15 are the MPE members */
  const DEF_BEND = 48;         /* default zone bend range in semitones */
  const LOG2_20 = Math.log2(20);
  const LOG2_18000 = Math.log2(18000);

  function cl(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* finite-number read sanitiser: hostile NaN / Infinity answers the honest default */
  function san(v, dflt) { return (typeof v === "number" && isFinite(v)) ? v : dflt; }

  function isState(st) {
    return !!(st && typeof st === "object"
      && st.chBend && st.chBend.length >= NCH
      && st.chAt && st.chAt.length >= NCH
      && st.chTimb && st.chTimb.length >= NCH
      && st.chPan && st.chPan.length >= NCH
      && st.chNotes && st.chNotes.length >= NCH);
  }

  /* member channels are 1..15, strict integer test (no coercion of strings / bools) */
  function memberCh(ch) {
    if (typeof ch !== "number" || !isFinite(ch)) return false;
    if (ch < 1 || ch > NCH - 1) return false;
    return ch === Math.floor(ch);
  }

  function create() {
    const st = {
      on: 0,
      bendRange: DEF_BEND,
      chBend: new Float64Array(NCH),
      chAt: new Float64Array(NCH),
      chTimb: new Float64Array(NCH),
      chPan: new Float64Array(NCH),
      chNotes: new Float64Array(NCH),
      panAny: 0,
    };
    st.chTimb.fill(-1);
    return st;
  }

  /* zone off / set-off clears every channel state (bend/at/timb/pan/notes + panAny) */
  function clearChannels(st) {
    st.chBend.fill(0);
    st.chAt.fill(0);
    st.chTimb.fill(-1);
    st.chPan.fill(0);
    st.chNotes.fill(0);
    st.panAny = 0;
  }

  function panAnyNow(st) {
    for (let i = 1; i < NCH; i++) {
      const p = st.chPan[i];
      if (typeof p === "number" && isFinite(p) && p !== 0) return 1;
    }
    return 0;
  }

  function setZone(st, on, bend) {
    if (!isState(st)) return false;
    const b = Number(bend);
    if (b === 24 || b === 48 || b === 96) st.bendRange = b;
    if (on) {
      st.on = 1;
    } else {
      clearChannels(st);
      st.on = 0;
    }
    return true;
  }

  function setExpr(st, ch, dim, v) {
    if (!isState(st) || !st.on) return false;
    if (!memberCh(ch)) return false;
    const n = Number(v);
    if (!isFinite(n)) return false;
    const i = ch | 0;
    if (dim === "bend") {
      let br = st.bendRange;
      if (br !== 24 && br !== 48 && br !== 96) br = DEF_BEND;
      st.chBend[i] = cl(n, -br, br);
      return true;
    }
    if (dim === "at") { st.chAt[i] = cl(n, 0, 127) / 127; return true; }
    if (dim === "timbre") {
      st.chTimb[i] = cl(Math.log2(60 * Math.pow(300, cl(n, 0, 127) / 127)), LOG2_20, LOG2_18000);
      return true;
    }
    if (dim === "pan") {
      st.chPan[i] = cl((cl(n, 0, 127) - 64) / 63, -1, 1);
      st.panAny = panAnyNow(st);
      return true;
    }
    return false;
  }

  function pitchSemis(st, ch) {
    if (!isState(st) || !st.on || !memberCh(ch)) return 0;
    return san(st.chBend[ch | 0], 0);
  }

  function cutBase(st, ch) {
    if (!isState(st) || !st.on || !memberCh(ch)) return -1;
    const v = st.chTimb[ch | 0];
    return (typeof v === "number" && isFinite(v) && v >= 0) ? v : -1;
  }

  function atOct(st, ch) {
    if (!isState(st) || !st.on || !memberCh(ch)) return 0;
    return san(st.chAt[ch | 0], 0) * 2;
  }

  function panGains(st, ch) {
    let p = 0;
    if (isState(st) && st.on && memberCh(ch)) p = cl(san(st.chPan[ch | 0], 0), -1, 1);
    if (p === 0) return [1, 1];
    const a = (p + 1) * Math.PI / 4;
    return [Math.cos(a), Math.sin(a)];
  }

  function noteIn(st, ch) {
    if (!isState(st) || !memberCh(ch)) return;
    const i = ch | 0;
    const v = st.chNotes[i];
    const n = (typeof v === "number" && isFinite(v) && v >= 0) ? Math.floor(v) : 0;
    st.chNotes[i] = n + 1;
  }

  function noteOut(st, ch) {
    if (!isState(st) || !memberCh(ch)) return;
    const i = ch | 0;
    const v = st.chNotes[i];
    const n = (typeof v === "number" && isFinite(v) && v >= 1) ? Math.floor(v) - 1 : 0;
    st.chNotes[i] = n;
  }

  function activeCount(st) {
    if (!isState(st)) return 0;
    let c = 0;
    for (let i = 1; i < NCH; i++) {
      const v = st.chNotes[i];
      if (typeof v === "number" && isFinite(v) && v > 0) c++;
    }
    return c;
  }

  function clearExpr(st) {
    if (!isState(st)) return false;
    st.chBend.fill(0);
    st.chAt.fill(0);
    st.chTimb.fill(-1);
    st.chPan.fill(0);
    st.panAny = 0;
    return true;
  }

  function snap(st) {
    if (!isState(st)) return { on: 0, bendRange: DEF_BEND, active: 0, panAny: 0, ch: [] };
    const ch = [];
    for (let i = 1; i < NCH; i++) {
      const notes = san(st.chNotes[i], 0);
      const bend = san(st.chBend[i], 0);
      const at = san(st.chAt[i], 0);
      const timb = san(st.chTimb[i], -1);
      const pan = san(st.chPan[i], 0);
      if (notes > 0 || bend !== 0 || at !== 0 || pan !== 0 || timb !== -1) {
        ch.push({ i: i, notes: notes, bend: bend, at: at, timb: timb, pan: pan });
      }
    }
    return {
      on: st.on ? 1 : 0,
      bendRange: san(st.bendRange, DEF_BEND),
      active: activeCount(st),
      panAny: st.panAny ? 1 : 0,
      ch: ch,
    };
  }

  return {
    VERSION: VERSION,
    version: VERSION,
    create: create,
    setZone: setZone,
    setExpr: setExpr,
    pitchSemis: pitchSemis,
    cutBase: cutBase,
    atOct: atOct,
    panGains: panGains,
    noteIn: noteIn,
    noteOut: noteOut,
    activeCount: activeCount,
    clearExpr: clearExpr,
    snap: snap,
  };
})();
