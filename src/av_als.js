/* av_als.js -- Anvil R15c STRUCTURED PACKS (child B): the ADG/ALS gzip-XML extractor + the
   clip-to-pattern mapper. Contract: verify/_r15c_wave.md sections 2, 4.2, 7. Research:
   research/import/01-ableton-mystery.md (gzip-XML confirmed first-hand across Live 9-12).
   Scratch harness: cache/r15c/als/run.mjs (plain node, untracked, verification only).

   WHAT THIS FILE IS
   - avAlsProbe(u8) -> { ok, kind, error } -- SYNC. Gzip magic 1f 8b; kind "gzip" when clear.
   - avAlsExtract(arrayBuffer) -> Promise of { ok, kind, creator, refs, notes, tempoBpm,
     warnings, error }. Decompresses with the native DecompressionStream("gzip") (honest
     refusal when unavailable) under a 64 MiB decompressed-size guard (AV_ALS_MAX_XML; reading
     stops at the cap and the pinned warning "XML truncated at 64 MB -- refs may be incomplete"
     is added), then an INCREMENTAL indexOf/regex scan over the decompressed text -- never a
     DOM parse. Audio refs come from both Ableton FileRef forms:
       * Live <=10: <RelativePath><RelativePathElement Dir="..."/> chains + <Name Value="..."/>
       * Live 11/12: <RelativePath Value="..."/> and <Path Value="..."/> attributes
     filtered to .wav/.wave/.aif/.aiff/.aifc/.mp3/.flac/.ogg, "../" segments normalized
     (leading ".." dropped, "x/.." pairs collapsed), deduped by basename case-insensitively
     (first wins), capped at 512 with a counting warning. Notes come from <MidiNoteEvent
     Time/Duration/Velocity> attributes, with the enclosing <KeyTrack><MidiKey Value="..."/>
     taken as pitch context where cheap; capped at 512 (first wins, counted, warned).
     NOTE TIME UNIT: MidiNoteEvent Time/Duration are the file's own floating-point quarter-note
     beats -- verified first-hand on real Live 9.7.1 / 10.1.7 / 11.3.21 / 12.2.5 documents
     (note extents align exactly with clip LoopEnd beats; the doc's "(ticks)" is that unit).
     Tempo: the first <Tempo> element (Live writes <Tempo><Manual Value="..."/>); number or null.
   - avAlsToPattern(extracted, opts) -> { ok, pattern, warnings } -- PURE + SYNC. Maps the
     extracted notes to EXACTLY the avMidToPattern shape (v/name/bpm/grid "16"/swing/tracks
     4 x 64 steps/plocks []/rng): seconds = ticks * 60 / bpm (tempoBpm default 120), quantize
     to the 16th grid with the shared quantize law (avMidQuantize when present, otherwise a
     byte-identical local kernel), first hit wins, gate = duration / step clamped, vel =
     velocity / 127, name from opts.name (cap 24, "PAT 1" fallback). Source tracks = the
     KeyTrack ordinal (first 4 note-carrying lanes win, mirroring avMidToPattern).

   LAWS kept: "use strict"; ONE namespace (avAls* / AV_ALS_*); classic script (no imports);
   no DOM at load (plain-node safe; DecompressionStream / TextDecoder typeof-guarded per
   call); never throws (honest refusals; the extract promise always RESOLVES); deterministic.
   No Ableton needed; this module never touches the network. */

"use strict";

/* ---------- pins ---------- */

const AV_ALS_VERSION = "r15c.0";
const AV_ALS_MAX_XML = 64 * 1024 * 1024;   /* decompressed-size guard (64 MiB), bytes */

const AV_ALS_TRACKS = 4;
const AV_ALS_STEPS = 64;
const AV_ALS_REFS_CAP = 512;
const AV_ALS_NOTES_CAP = 512;
const AV_ALS_TICK_DIV = 24;                /* micro ticks per step (the shared quantize law) */
const AV_ALS_MICRO_MAX = 12;
const AV_ALS_BPM_MIN = 20;
const AV_ALS_BPM_MAX = 300;
const AV_ALS_BPM_DEF = 120;
const AV_ALS_SWING_MIN = 50;
const AV_ALS_SWING_MAX = 80;
const AV_ALS_SWING_DEF = 50;
const AV_ALS_VEL_MIN = 0.05;
const AV_ALS_VEL_DEF = 0.8;
const AV_ALS_GATE_MIN = 0.05;
const AV_ALS_GATE_DEF = 0.95;
const AV_ALS_LEN_DEF = 16;
const AV_ALS_PATNAME_CAP = 24;             /* = core AV_SEQ_NAME_CAP */
const AV_ALS_RNG_DEF = 305419896;          /* = core AV_SEQ_DEF_RNG (0x12345678) */
const AV_ALS_CREATOR_CAP = 64;
const AV_ALS_BLOCK_MAX = 16384;            /* bounded window per FileRef / KeyTrack probe */
const AV_ALS_REF_BLOCKS_MAX = 50000;       /* scan budget; pathological inputs stop + warn */
const AV_ALS_KEYS_MAX = 16384;             /* MidiKey context lookup budget (cheap path) */
const AV_ALS_TICKS_PER_BEAT = 1;           /* file note unit = one quarter-note beat (see header) */
const AV_ALS_VEL7 = 127;                   /* velocity is stored 0..127 in the XML */

const AV_ALS_AUDIO_EXT = ["wav", "wave", "aif", "aiff", "aifc", "mp3", "flac", "ogg"];

const AV_ALS_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const AV_ALS_PC_NAMES = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];

/* ---------- small value laws (never throw) ---------- */

function avAlsIsNum(v) { return typeof v === "number" && isFinite(v); }

function avAlsIsObj(v) { return v != null && typeof v === "object" && !Array.isArray(v); }

function avAlsClampNum(v, dflt, lo, hi) {
  const n = Number(v);
  if (v == null || v === "" || !isFinite(n)) return dflt;
  return n < lo ? lo : (n > hi ? hi : n);
}

function avAlsClampInt(v, dflt, lo, hi) {
  const n = Number(v);
  if (v == null || v === "" || !isFinite(n)) return dflt;
  const r = Math.round(n);
  return r < lo ? lo : (r > hi ? hi : r);
}

function avAlsErrText(e) { return (e && typeof e.message === "string") ? e.message : "internal"; }

/* the refuse shape for the mapper (mirrors avMidFail: warnings always present) */
function avAlsFail(error, warnings) {
  return { ok: false, error: String(error || "refused"), warnings: warnings ? warnings.slice() : [] };
}

/* the full-carrier refuse shape for the extractor (every pinned field present) */
function avAlsFailExtract(error, kind, warnings) {
  return {
    ok: false, kind: kind || "", creator: "", refs: [], notes: [], tempoBpm: null,
    warnings: warnings ? warnings.slice() : [], error: String(error || "refused"),
  };
}

/* ArrayBuffer | Uint8Array (Buffer included) | number[] -> Uint8Array | null */
function avAlsToU8(x) {
  try {
    if (x == null) return null;
    if (typeof Uint8Array !== "undefined" && x instanceof Uint8Array) return x;
    if (typeof ArrayBuffer !== "undefined" && x instanceof ArrayBuffer) return new Uint8Array(x);
    if (Array.isArray(x)) {
      const u = new Uint8Array(x.length);
      for (let i = 0; i < x.length; i++) {
        const b = Number(x[i]);
        u[i] = (isFinite(b) ? Math.round(b) : 0) & 0xFF;
      }
      return u;
    }
    return null;
  } catch (e) { return null; }
}

/* printable-ASCII text, controls stripped, trimmed, capped (same law as avMidAscii) */
function avAlsAscii(v, cap) {
  let s = "";
  if (typeof v === "string") s = v;
  else if (avAlsIsNum(v)) s = String(v);
  else return "";
  s = s.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  let out = "";
  for (let i = 0; i < s.length && out.length < cap; i++) {
    const c = s.charCodeAt(i);
    out += (c >= 0x20 && c <= 0x7e) ? s.charAt(i) : "?";
  }
  return out;
}

/* note names (local mirror of avMidMidiToNote; the planner hands us canonical names) */
function avAlsMidiToNote(midi) {
  const m = Math.round(Number(midi));
  if (!isFinite(m) || m < 0 || m > 127) return "";
  return AV_ALS_PC_NAMES[m % 12] + (Math.floor(m / 12) - 1);
}

/* grid -> base step duration (same law as avSeqSchedGridDur) */
function avAlsGridDur(bpm, grid) {
  const b = avAlsClampNum(bpm, AV_ALS_BPM_DEF, AV_ALS_BPM_MIN, AV_ALS_BPM_MAX);
  return (grid === "8t") ? (60 / b / 3) : (60 / b / 4);
}

/* ---------- core-shaped defaults (key order must match av_seq_core sanitisation) ---------- */

function avAlsStepDefault() {
  return { on: 0, note: "c4", vel: AV_ALS_VEL_DEF, gate: AV_ALS_GATE_DEF, slide: 0, accent: 0,
           oct: 0, prob: 100, cond: "", ratchet: 1, micro: 0 };
}

function avAlsBlankTrack() {
  const steps = [];
  for (let i = 0; i < AV_ALS_STEPS; i++) steps.push(avAlsStepDefault());
  return { len: AV_ALS_LEN_DEF, speed: 1, mute: 0, steps: steps };
}

/* ---------- the quantize law (identical to avMidQuantizeLocal / avSeqCaptureQuantize q=0) ---------- */

function avAlsQuantizeLocal(t, bpm, grid, swing) {
  const stepDur = avAlsGridDur(bpm, grid);
  const shift = stepDur * (swing - 50) / 100;
  const k0 = Math.round(t / stepDur);
  let best = k0, bestD = Infinity;
  for (let k = k0 - 2; k <= k0 + 2; k++) {
    const g = k * stepDur + ((k % 2 !== 0) ? shift : 0);
    const d = Math.abs(g - t);
    if (d < bestD) { bestD = d; best = k; }        /* strict < => ties to the EARLIER step */
  }
  if (best < 0) best = 0;
  const gridT = best * stepDur + ((best % 2 !== 0) ? shift : 0);
  const residual = t - gridT;
  const tick = stepDur / AV_ALS_TICK_DIV;
  let micro = Math.round(residual / tick);
  if (micro > AV_ALS_MICRO_MAX) micro = AV_ALS_MICRO_MAX;
  else if (micro < -AV_ALS_MICRO_MAX) micro = -AV_ALS_MICRO_MAX;
  return { step: best, micro: micro };
}

/* prefer the module's shared kernel when the bundle provides it (guarded, per call) */
function avAlsQuantize(t, bpm, grid, swing) {
  if (typeof avMidQuantize === "function") {
    try {
      const q = avMidQuantize(t, bpm, grid, swing);
      if (q && typeof q === "object" && avAlsIsNum(q.step) && avAlsIsNum(q.micro)) {
        return { step: Math.round(q.step), micro: Math.round(q.micro) };
      }
    } catch (e) { /* fall through to the local kernel */ }
  }
  return avAlsQuantizeLocal(t, bpm, grid, swing);
}

/* ---------- probe ---------- */

function avAlsProbe(u8) {
  try {
    const a = avAlsToU8(u8);
    if (!a || a.length < 2) return { ok: false, kind: "", error: "no data" };
    if (a[0] !== 0x1F || a[1] !== 0x8B) return { ok: false, kind: "", error: "not gzip (missing 1f 8b magic)" };
    return { ok: true, kind: "gzip", error: "" };
  } catch (e) { return { ok: false, kind: "", error: "probe failed (" + avAlsErrText(e) + ")" }; }
}

/* ---------- gunzip (DecompressionStream, 64 MiB cap, never rejects) ---------- */

function avAlsJoin(parts, total) {
  try {
    const out = new Uint8Array(total);
    let off = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p || !p.length) continue;
      out.set(p, off);
      off += p.length;
    }
    return out;
  } catch (e) { return null; }
}

/* u8 (gzip bytes) -> Promise of { ok:true, text, truncated } | { ok:false, error } */
function avAlsGunzipText(u8) {
  return new Promise(function (resolve) {
    let settled = false;
    function done(o) { if (!settled) { settled = true; resolve(o); } }
    try {
      if (typeof TextDecoder !== "function") { done({ ok: false, error: "text decoder unavailable" }); return; }
      const ds = new DecompressionStream("gzip");
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      const parts = [];
      let total = 0, truncated = false, feedErr = "";

      const feed = writer.write(u8).then(function () { return writer.close(); });
      feed.then(function () { /* source fed */ }, function (e) {
        feedErr = avAlsErrText(e);
        if (!settled && total === 0) {
          try { reader.cancel(); } catch (e2) { /* ignore */ }
          done({ ok: false, error: "gzip decompression failed (" + feedErr + ")" });
        }
      });

      function flush() {
        try {
          const dec = new TextDecoder("utf-8");
          let text = "";
          if (parts.length === 1) text = dec.decode(parts[0]);
          else if (parts.length > 1) {
            const joined = avAlsJoin(parts, total);
            text = joined ? dec.decode(joined) : "";
          }
          done({ ok: true, text: text, truncated: truncated });
        } catch (e) { done({ ok: false, error: "text decode failed (" + avAlsErrText(e) + ")" }); }
      }

      function step() {
        reader.read().then(function (r) {
          try {
            if (settled) return;
            if (r.done) { flush(); return; }
            const ch = r.value;
            if (ch && ch.length > 0) {
              const room = AV_ALS_MAX_XML - total;
              if (ch.length > room) {
                if (room > 0) {
                  parts.push(ch.subarray ? ch.subarray(0, room) : ch.slice(0, room));
                  total += room;
                }
                truncated = true;
                try { reader.cancel(); } catch (e2) { /* ignore */ }
                try { writer.abort(); } catch (e2) { /* ignore */ }
                flush();
                return;
              }
              parts.push(ch);
              total += ch.length;
            }
            step();
          } catch (e) { done({ ok: false, error: "gzip decompression failed (" + avAlsErrText(e) + ")" }); }
        }, function (e) {
          done({ ok: false, error: "gzip decompression failed (" + avAlsErrText(e) + ")" });
        });
      }
      step();
    } catch (e) { done({ ok: false, error: "gzip decompression failed (" + avAlsErrText(e) + ")" }); }
  });
}

/* ---------- refs (FileRef scan, both Live path forms) ---------- */

function avAlsNormPath(p) {
  const parts = String(p == null ? "" : p).replace(/\\/g, "/").split("/");
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0) out.pop();     /* "x/.." collapses */
      continue;                          /* leading ".." is dropped (points above the document) */
    }
    out.push(seg);
  }
  return out.join("/");
}

function avAlsBaseName(p) {
  const s = String(p == null ? "" : p);
  const i = s.lastIndexOf("/");
  return (i >= 0) ? s.slice(i + 1) : s;
}

function avAlsIsAudioName(p) {
  const base = avAlsBaseName(p);
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return false;
  const ext = base.slice(dot + 1).toLowerCase();
  for (let i = 0; i < AV_ALS_AUDIO_EXT.length; i++) {
    if (AV_ALS_AUDIO_EXT[i] === ext) return true;
  }
  return false;
}

/* accept one candidate path: normalize, extension-filter, dedupe by basename (first wins), cap */
function avAlsAcceptRef(st, raw) {
  const p0 = String(raw == null ? "" : raw).trim();
  if (!p0) return;
  const p = avAlsNormPath(p0);
  if (!avAlsIsAudioName(p)) return;
  const base = avAlsBaseName(p);
  if (!base) return;
  const key = base.toLowerCase();
  if (st.seen[key]) return;
  st.seen[key] = 1;
  st.refsTotal++;
  if (st.refs.length < AV_ALS_REFS_CAP) st.refs.push({ name: base, path: p });
}

/* candidates inside one FileRef window, preference order: relative forms first, then Path, Name */
function avAlsCollectRef(st, block) {
  const cands = [];
  const rv = /<RelativePath\s+Value="([^"]*)"/.exec(block);
  if (rv && rv[1]) cands.push(rv[1]);

  let name = "";
  const nm = /<Name\s+Value="([^"]*)"/.exec(block);
  if (nm) name = nm[1];

  /* Live <=10 form: RelativePathElement Dir chain inside <RelativePath> (Dir may be empty) */
  const rp = /<RelativePath>([\s\S]*?)<\/RelativePath>/.exec(block);
  let chain = "";
  if (rp) {
    const re = /<RelativePathElement[^>]*\bDir="([^"]*)"/g;
    let m;
    while ((m = re.exec(rp[1]))) {
      const dir = m[1];
      if (!dir) continue;
      if (chain && chain.charAt(chain.length - 1) !== "/" && dir.charAt(0) !== "/") chain += "/";
      chain += dir;
    }
  }
  if (chain) {
    if (name) cands.push(chain + (chain.charAt(chain.length - 1) === "/" ? "" : "/") + name);
    cands.push(chain);
  }

  const pv = /<Path\s+Value="([^"]*)"/.exec(block);
  if (pv && pv[1]) cands.push(pv[1]);
  if (name) cands.push(name);

  for (let i = 0; i < cands.length; i++) avAlsAcceptRef(st, cands[i]);
}

function avAlsScanRefs(text, st) {
  let pos = 0;
  while (true) {
    if (st.blocks >= AV_ALS_REF_BLOCKS_MAX) { st.blockStop = 1; break; }
    const s = text.indexOf("<FileRef", pos);
    if (s < 0) break;
    const c = text.charAt(s + 8);
    if (c !== ">" && c !== " " && c !== "\n" && c !== "\r" && c !== "\t") { pos = s + 8; continue; }
    st.blocks++;
    const winEnd0 = Math.min(text.length, s + AV_ALS_BLOCK_MAX);
    const win = text.slice(s, winEnd0);
    const e = win.indexOf("</FileRef>", 8);
    if (e >= 0) {
      avAlsCollectRef(st, win.slice(0, e));
      pos = s + 8;                     /* continue inside: nested FileRef blocks still get a look */
    } else {
      avAlsCollectRef(st, win);
      st.unclosedRefs++;
      pos = winEnd0;                   /* bounded window processed once */
    }
  }
}

/* ---------- notes (MidiNoteEvent walk + KeyTrack / MidiKey context) ---------- */

/* next occurrence of a tag opener with an XML-name boundary check (skips e.g. <KeyTracks>) */
function avAlsNextTag(text, from, needle, wantBoundary) {
  let p = from;
  while (true) {
    const i = text.indexOf(needle, p);
    if (i < 0) return -1;
    if (!wantBoundary) return i;
    const c = text.charAt(i + needle.length);
    if (c === ">" || c === "/" || c === " " || c === "\n" || c === "\r" || c === "\t") return i;
    p = i + needle.length;
  }
}

/* the MidiKey Value of the KeyTrack starting at kt, from a bounded window; null when absent.
   The real order is <KeyTrack><Notes>...notes...</Notes><MidiKey Value=".."/><KeyTrack>, so the
   key is searched up to the block's closer inside the window (never past it). */
function avAlsKeyAt(text, kt) {
  try {
    const from = kt + 9;
    const winEnd0 = Math.min(text.length, from + AV_ALS_BLOCK_MAX);
    const win = text.slice(from, winEnd0);
    const close = win.indexOf("</KeyTrack>");
    const lim = (close >= 0) ? close : win.length;
    const mk = win.indexOf("<MidiKey");
    if (mk < 0 || mk >= lim) return null;
    const mke = win.indexOf(">", mk);
    if (mke < 0) return null;
    const mtag = win.slice(mk, mke);
    const mv = /\bValue="(-?[0-9]{1,3})"/.exec(mtag);
    if (!mv) return null;
    const v = parseInt(mv[1], 10);
    return (v >= 0 && v <= 127) ? v : null;
  } catch (e) { return null; }
}

function avAlsScanNotes(text, st) {
  let pos = 0;
  let ord = -1;
  let curKey = null;
  let keyLookups = 0;
  while (true) {
    const nn = avAlsNextTag(text, pos, "<MidiNoteEvent", true);
    if (nn < 0) break;
    const kt = avAlsNextTag(text, pos, "<KeyTrack", true);
    if (kt >= 0 && kt < nn) {
      ord++;
      if (keyLookups < AV_ALS_KEYS_MAX) {
        keyLookups++;
        curKey = avAlsKeyAt(text, kt);
      } else {
        st.keyCapped++;
        curKey = null;
      }
      pos = kt + 9;
      continue;
    }
    const ne = text.indexOf(">", nn);
    if (ne < 0) break;
    const tag = text.slice(nn, ne);
    pos = ne + 1;
    const ie = /\bIsEnabled="(true|false)"/.exec(tag);
    if (ie && ie[1] === "false") { st.muted++; continue; }
    const tm = /\bTime="(-?[0-9.]+)"/.exec(tag);
    if (!tm) continue;
    const dm = /\bDuration="(-?[0-9.]+)"/.exec(tag);
    if (!dm) continue;
    const tick = parseFloat(tm[1]);
    const dur = parseFloat(dm[1]);
    if (!avAlsIsNum(tick) || !avAlsIsNum(dur) || tick < 0 || dur < 0) continue;
    let vel = null;
    const vm = /\bVelocity="(-?[0-9.]+)"/.exec(tag);
    if (vm) { const vv = parseFloat(vm[1]); if (avAlsIsNum(vv)) vel = vv; }
    st.notesTotal++;
    if (st.notes.length < AV_ALS_NOTES_CAP) {
      st.notes.push({ tick: tick, durTicks: dur, vel: vel, midi: curKey, track: (ord < 0 ? 0 : ord) });
    }
  }
}

/* ---------- the text scan (incremental; no DOM) ---------- */

function avAlsScanText(text, truncated) {
  const warnings = [];
  if (truncated) warnings.push("XML truncated at 64 MB \u2014 refs may be incomplete");
  if (typeof text !== "string") return { ok: false, error: "no decompressed text", warnings: warnings };

  const aIdx = text.indexOf("<Ableton");
  if (aIdx < 0) return { ok: false, error: "not an Ableton document (no root element)", warnings: warnings };

  let creator = "";
  try {
    const head = text.slice(aIdx, Math.min(text.length, aIdx + 4096));
    const cm = /\bCreator="([^"]*)"/.exec(head);
    if (cm && cm[1]) creator = avAlsAscii(cm[1], AV_ALS_CREATOR_CAP);
  } catch (e) { /* creator stays "" */ }

  const refState = { refs: [], seen: {}, refsTotal: 0, unclosedRefs: 0, blocks: 0, blockStop: 0 };
  avAlsScanRefs(text, refState);
  if (refState.refsTotal > AV_ALS_REFS_CAP) {
    warnings.push("refs capped at " + AV_ALS_REFS_CAP + " (" + refState.refsTotal + " found)");
  }
  if (refState.unclosedRefs > 0) warnings.push(refState.unclosedRefs + " unclosed FileRef block(s) truncated");
  if (refState.blockStop) warnings.push("FileRef scan stopped after " + AV_ALS_REF_BLOCKS_MAX + " blocks");

  const noteState = { notes: [], notesTotal: 0, muted: 0, keyCapped: 0 };
  avAlsScanNotes(text, noteState);
  if (noteState.notesTotal > AV_ALS_NOTES_CAP) {
    warnings.push("notes capped at " + AV_ALS_NOTES_CAP + " (" + noteState.notesTotal + " found)");
  }
  if (noteState.muted > 0) warnings.push(noteState.muted + " muted note(s) skipped");
  if (noteState.keyCapped > 0) warnings.push("MidiKey context beyond " + AV_ALS_KEYS_MAX + " KeyTrack(s) ignored");

  /* tempo: the first <Tempo> element; Live writes <Tempo><Manual Value=".."/>, older/newer
     variants may carry a direct Value attribute -- accept both, keep only a sane number */
  let tempoBpm = null;
  const ti = text.indexOf("<Tempo");
  if (ti >= 0) {
    const te = text.indexOf(">", ti);
    if (te > ti) {
      const ttag = text.slice(ti, te);
      const tv = /\bValue="([0-9.]+)"/.exec(ttag);
      if (tv) tempoBpm = parseFloat(tv[1]);
      else {
        const tEnd0 = text.indexOf("</Tempo>", ti);
        const tEnd = (tEnd0 < 0) ? Math.min(text.length, ti + 8192) : tEnd0;
        const mv = /<Manual\s+Value="([0-9.]+)"/.exec(text.slice(ti, tEnd));
        if (mv) tempoBpm = parseFloat(mv[1]);
      }
    }
  }
  if (!(avAlsIsNum(tempoBpm) && tempoBpm > 0 && tempoBpm <= 999)) tempoBpm = null;

  return {
    ok: true, creator: creator, refs: refState.refs, notes: noteState.notes,
    tempoBpm: tempoBpm, warnings: warnings,
  };
}

/* ---------- extract ---------- */

function avAlsExtract(arrayBuffer) {
  return new Promise(function (resolve) {
    function finish(o) { try { resolve(o); } catch (e) { /* never throws */ } }
    try {
      const u8 = avAlsToU8(arrayBuffer);
      if (!u8 || u8.length < 2) return finish(avAlsFailExtract("no data", ""));
      if (u8[0] !== 0x1F || u8[1] !== 0x8B) return finish(avAlsFailExtract("not gzip (missing 1f 8b magic)", ""));
      if (typeof DecompressionStream !== "function") {
        return finish(avAlsFailExtract("gzip decompression unavailable in this browser", "gzip"));
      }
      avAlsGunzipText(u8).then(function (gz) {
        try {
          if (!gz || gz.ok !== true) {
            return finish(avAlsFailExtract((gz && gz.error) ? gz.error : "gzip decompression failed", "gzip"));
          }
          const sc = avAlsScanText(gz.text, gz.truncated);
          if (!sc.ok) return finish(avAlsFailExtract(sc.error, "gzip", sc.warnings));
          finish({
            ok: true, kind: "gzip", creator: sc.creator, refs: sc.refs, notes: sc.notes,
            tempoBpm: sc.tempoBpm, warnings: sc.warnings, error: "",
          });
        } catch (e) { finish(avAlsFailExtract("extract failed (" + avAlsErrText(e) + ")", "gzip")); }
      }, function (e) {
        finish(avAlsFailExtract("gzip decompression failed (" + avAlsErrText(e) + ")", "gzip"));
      });
    } catch (e) { finish(avAlsFailExtract("extract failed (" + avAlsErrText(e) + ")", "")); }
  });
}

/* ---------- pattern mapping (mirrors avMidToPattern) ---------- */

function avAlsToPattern(extracted, opts) {
  try {
    const p = avAlsIsObj(extracted) ? extracted : null;
    if (!p || p.ok === false) return avAlsFail("no extracted result");
    const o = avAlsIsObj(opts) ? opts : null;
    const warnings = [];

    const bpmV = avAlsClampNum(p.tempoBpm, AV_ALS_BPM_DEF, AV_ALS_BPM_MIN, AV_ALS_BPM_MAX);
    const swing = Math.round(avAlsClampNum(o ? o.swing : null, AV_ALS_SWING_DEF, AV_ALS_SWING_MIN, AV_ALS_SWING_MAX));
    const stepDur = avAlsGridDur(bpmV, "16");
    const secPerTick = 60 / (bpmV * AV_ALS_TICKS_PER_BEAT);

    const srcNotes = Array.isArray(p.notes) ? p.notes : null;
    if (!srcNotes) return avAlsFail("no notes in extracted result");

    /* lanes = the KeyTrack ordinal; first 4 note-carrying lanes win (avMidToPattern law) */
    const laneMap = {};
    const laneKeys = [];
    for (let i = 0; i < srcNotes.length; i++) {
      const nt = srcNotes[i];
      if (!avAlsIsObj(nt)) continue;
      const tr = avAlsClampInt(nt.track, 0, 0, 0x7FFFFFFF);
      if (!laneMap[tr]) { laneMap[tr] = []; laneKeys.push(tr); }
      laneMap[tr].push(nt);
    }
    laneKeys.sort(function (a, b) { return a - b; });
    let lanes = laneKeys;
    if (lanes.length > AV_ALS_TRACKS) {
      warnings.push((lanes.length - AV_ALS_TRACKS) + " track(s) beyond the first 4 dropped");
      lanes = lanes.slice(0, AV_ALS_TRACKS);
    }

    const tracks = [];
    for (let t = 0; t < AV_ALS_TRACKS; t++) tracks.push(avAlsBlankTrack());

    let mapped = 0, dropped = 0, merged = 0;
    for (let c = 0; c < lanes.length; c++) {
      const notes = laneMap[lanes[c]];
      const tr = tracks[c];
      const used = {};
      let maxIdx = -1;
      for (let i = 0; i < notes.length; i++) {
        const nt = notes[i];
        const tSec = avAlsIsNum(nt.tSec) ? nt.tSec
          : (avAlsIsNum(nt.tick) ? nt.tick * secPerTick : null);
        if (tSec == null) continue;
        const qz = avAlsQuantize(tSec, bpmV, "16", swing);
        if (!qz || !avAlsIsNum(qz.step)) continue;
        if (qz.step < 0 || qz.step >= AV_ALS_STEPS) { dropped++; continue; }
        if (used[qz.step]) { merged++; continue; }       /* first hit wins (one note per step) */
        used[qz.step] = 1;
        const st = tr.steps[qz.step];
        st.on = 1;
        st.note = avAlsMidiToNote(nt.midi) || "c4";
        st.vel = avAlsClampNum(avAlsIsNum(nt.vel) ? nt.vel / AV_ALS_VEL7 : AV_ALS_VEL_DEF,
                               AV_ALS_VEL_DEF, AV_ALS_VEL_MIN, 1);
        st.gate = avAlsIsNum(nt.durTicks)
          ? avAlsClampNum((nt.durTicks * secPerTick) / stepDur, AV_ALS_GATE_DEF, AV_ALS_GATE_MIN, 1)
          : AV_ALS_GATE_DEF;
        st.micro = qz.micro;
        mapped++;
        if (qz.step > maxIdx) maxIdx = qz.step;
      }
      if (maxIdx >= 0) tr.len = Math.min(AV_ALS_STEPS, Math.max(AV_ALS_LEN_DEF, maxIdx + 1));
    }

    if (dropped > 0) warnings.push(dropped + " note(s) beyond 64 steps dropped");
    if (merged > 0) warnings.push(merged + " duplicate note(s) merged (first hit wins)");
    if (mapped === 0) return avAlsFail("no notes", warnings);

    let name = avAlsAscii(o && o.name != null ? o.name : "", AV_ALS_PATNAME_CAP);
    if (!name) name = "PAT 1";

    const pattern = {
      v: 1, name: name,
      bpm: avAlsClampInt(bpmV, AV_ALS_BPM_DEF, AV_ALS_BPM_MIN, AV_ALS_BPM_MAX),
      grid: "16",
      swing: swing,
      tracks: tracks,
      plocks: [],
      rng: AV_ALS_RNG_DEF,
    };
    return { ok: true, pattern: pattern, warnings: warnings };
  } catch (e) { return avAlsFail("pattern mapping failed (" + avAlsErrText(e) + ")"); }
}
