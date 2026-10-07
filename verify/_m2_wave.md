# Anvil M2 wave — EXPRESSION · CHOP · GENERATIVE · ARRANGER: MPE (#61) · sample chop (#65) · generative remainder (#72) · song arranger remainder (#73) (2026-10-08)

State at open: frozen `335f4bd0…` (2,933,715 B) · battery 19 suites green · HEAD `b4400da` ·
tree clean (`?? cache/`). Parent owns build/freeze/pins/commits; children author ONE scope each,
write the file to disk FIRST (complete), then iterate; `node --check` + own-file node harness only —
children NEVER run build.py, browsers, suites, git, or touch files outside their ownership row.

Living templates to READ before authoring (each file's header restates the house laws):
- Kind module + worklet scope: `src/av_sampler.js` header (zone layout) · `src/av_fm.js` (kind shape).
- Page module shape: `src/av_wt.js` (core + node harness precedent `cache/scratch/m1/wt/harness.mjs`),
  `src/av_wt_ui.js` (card idiom: avKnobHTML/avApplyParam/classes), `src/av_sample.js` (store + drag-in),
  `src/av_seq_capture.js` (guarded-core reach idiom), `src/av_song` sibling `src/av_bounce.js`
  (planner consumption), `src/av_mid.js` (SMF writer internals — sa-F extends this file).
- Rig: `verify/cdp_m1.mjs` (newest rig; launch block) + `verify/cdp_midi.mjs` (the Web MIDI stub —
  sa-H ports its injection setup).
- In-worklet facts: NO fetch/URL/performance/TextEncoder/structuredClone; `new Function` works;
  in-worklet clock = `Date.now()` only. The worklet concat = ladder + dsp + acid + string + drum +
  grain + sampler + fm + fx_verb + fx_delay + fx_mod + fx_drive + fx_dyn + fx_aw + fx_conv + umod +
  voiceproc; `av_mpe.js` joins it (order pinned in §4).

## §1 Deliverables + file ownership (one writer per file, ever)

| child | file(s) — sole writer | scratch | deliverable |
|---|---|---|---|
| sa-A | `src/av_mpe.js` (NEW) | `cache/scratch/m2/mpe/` | MPE expression kernel `AVM` (worklet+page; harness) |
| sa-B | `src/av_mpe_deck.js` (NEW) | `cache/scratch/m2/mpedeck/` | the deck MPE surface (member-channel branch + panel row) |
| sa-C | `src/av_chop.js` (NEW) | `cache/scratch/m2/chop/` | chop core: detect · slices · edit math · zone v2 + steps writers |
| sa-D | `src/av_sampler.js` (EDIT) | `cache/scratch/m2/sampler2/` | sampler kind v2: zone v2 144-float parse · per-slice window + fades |
| sa-E | `src/av_chop_ui.js` (NEW) | `cache/scratch/m2/chopui/` | the CHOP card (#av-chop) |
| sa-F | `src/av_song.js` (NEW) + `src/av_mid.js` (EDIT) | `cache/scratch/m2/song/` | song runner + quantised scene recall + arrangement export (JSON + SMF) |
| sa-G | `src/av_seq_ui.js` (EDIT) | `cache/scratch/m2/sequi/` | generative UI + arranger UI (track ctl · GEN block · song rows/timeline) |
| sa-H | `verify/cdp_m2.mjs` (NEW, write-only) | `cache/scratch/m2/rig/` | the M2 rig (EXPECT_SHA = null) |

Parent integration (ONE counted-assert script `cache/scratch/m2/integrate/_m2_integrate.py`):
build.py · av_note.js · av_dsp.js · av_voiceproc.js · av_engine.js · av_midi.js · av_seq_core.js ·
av_seq_sched.js · body.html · styles.css · app_core.js · cdp_smoke.mjs (§4).

## §2 Interface pins

### 2.1 MPE kernel — `src/av_mpe.js` (sa-A)

- ONE top-level name `AVM` (const IIFE). `"use strict"`. Worklet-safe (no window/document/console;
  `Date.now` only if needed). Joins BOTH concats; no DOM at load.
- State: `AVM.create() -> st` — fresh object `{on:0, bendRange:48, chBend:F64(16), chAt:F64(16),
  chTimb:F64(16) (fill −1 = none), chPan:F64(16), chNotes:F64(16) (held count per channel), panAny:0}`.
- API (names EXACT — av_dsp/av_engine/av_mpe_deck rely):
  - `AVM.setZone(st, on, bend) -> bool` — on coerced bool; bend ∈ {24,48,96} else kept; set OFF clears
    every channel state (bend/at/timb/pan → defaults, panAny 0).
  - `AVM.setExpr(st, ch, dim, v) -> bool` — ch 1..15 (member, 0-based MIDI channel index); dim
    `"bend"|"at"|"timbre"|"pan"`; refused (false) when st.on 0 or ch invalid. Values: bend semis
    clamped ±bendRange; at 0..1 (v/127 scaled by caller OR raw 0..127? PIN: **raw input, kernel
    clamps** — bend: already semis; at: 0..127 → /127; timbre: 0..127 raw CC → `log2(60*300^(v/127))`
    clamped `[log2(20), log2(18000)]` stored; pan: 0..127 → `(v−64)/63` clamped ±1; panAny flag
    recomputed on every pan write).
  - `AVM.pitchSemis(st, ch) -> number` — 0 when off/none else chBend.
  - `AVM.cutBase(st, ch) -> number` — −1 when none/off else chTimb (log2 Hz).
  - `AVM.atOct(st, ch) -> number` — 0 when off else chAt*2 (octaves).
  - `AVM.panGains(st, ch) -> [L,R]` (fresh 2-array) — equal-power `L=cos((p+1)π/4)`, `R=sin((p+1)π/4)`;
    [1,1] when off or p===0.
  - `AVM.noteIn(st, ch) / AVM.noteOut(st, ch)` — chNotes ±1 (floored at 0); `AVM.activeCount(st)`
    = channels with chNotes > 0; `AVM.clearExpr(st)` (all channel dims default; keeps on).
  - `AVM.snap(st)` — JSON-safe `{on, bendRange, active, panAny, ch:[{i, notes, bend, at, timb, pan} ×16]}`
    (only channels with any nonzero activity listed).
- Harness (`cache/scratch/m2/mpe/harness.mjs`, node, module text in a Function scope): bend scaling
  across 24/48/96 (clamp ±range); at mapping ×2 oct; timbre CC 0 → log2(60)≈5.907, CC 127 →
  log2(18000)≈14.135; pan law L²+R²=1 and p=0 → [1,1]; setExpr refused when off / ch 0, 16;
  setZone off clears; noteIn/Out floors; snap shape; determinism (same ops → deep-equal snaps).
  ALL-PASS line `MPE-HARNESS: n/n PASS`.

### 2.2 Deck MPE surface — `src/av_mpe_deck.js` (sa-B)

- Page module (NOT in the worklet). ONE namespace `avMpeDeck*`. Exposes:
  - `avMpeDeckInit()` — idempotent; true when armed (host #av-midi-body may come later — re-render safe).
  - `avMpeDeckIncoming(m) -> bool` — the av_midi router hook (m = the decoded message object with
    `.type`/`.chan` 0-based/`.note`/`.vel`/`.bend`/`.value`/`.cc`). Consumes ONLY when enabled
    (`avMidiPrefs.mpe === true` AND `avMidiPrefs.playIn === true` AND `.chan >= 1`): `noteon` →
    `avNoteDown(name, vel/127, chan)` + bookkeeping (avMidiLastNote update + avMidiMonTouch guarded)
    return true; `noteoff` → `avNoteUp(name, chan)` return true; `pitchbend` → semis =
    `clamp(m.bend,±8192)/8192 × avMidiPrefs.mpeBend` → `avEngineMpeExpr(chan,"bend",semis)`;
    `touch` → `avEngineMpeExpr(chan,"at",m.value)`; `cc` 74 → `avEngineMpeExpr(chan,"timbre",m.value)`;
    `cc` 10 → `avEngineMpeExpr(chan,"pan",m.value)`; else false (CC 120/123 MUST fall through to the
    global panic path). Never throws.
  - `avMpeDeckRelease()` — `avNoteUp` every held member key + clears its own map (expression state is
    NOT cleared except by zone off). Called by the parent from the av_midi broom sites.
  - `avMpeDeckSet(on) -> bool` / `avMpeDeckSetBend(n) -> bool` (24/48/96) — persist via
    `avMidiPrefs.mpe/mpeBend` (direct field writes; `avMidiSavePrefs()` guarded), push the zone to
    the engine `avEngineMpeSet(on, bend)` guarded, broom on set-off, re-render the row; return value.
  - `avMpeDeckPush()` — re-send zone state (boot + engine handshake).
  - `avMpeDeckPanelHTML() -> string` — the MPE row markup: container `#av-midi-mpe-row`; toggle
    `[data-midimpe]`; bend select `#av-midi-mpe-bend` (24/48/96); state `#av-midi-mpe-state`;
    activity `#av-midi-mpe-active` (held member notes readout). Class names ANY (list them in the
    report for the styles block) — ids are pinned.
  - `avMpeDeckWire(root)` — (re)bind the row's controls inside root (idempotent, re-wirable after
    avMidiRender rebuilds the panel).
  - `avMpeDeckSnap()` → `{on, bend, held:[{name, ch}], lastExpr:{ch, dim, at}|null, pushes}`;
    `window.__avMpeDeck = {version:"m2.0", init, set, setBend, release, push, snap, incoming:avMpeDeckIncoming}`.
- Harness (node + stub avNoteDown/Up/avEngineMpeExpr/avMidiPrefs): member predicate matrix (off/playIn
  off/master ch → false); bend scaling (bend 48 @ 4096 → +24 semis); CC74/CC10 dispatch args; noteoff
  drop; release broker; snap shape. ALL-PASS `MPEDECK-HARNESS: n/n PASS`.

### 2.3 Chop core — `src/av_chop.js` (sa-C)

- Page module. ONE namespace `avChop*`. Own transient detector (clean-room; document the algorithm +
  its math in the header): spectral-flux OR block-energy novelty with adaptive threshold — the child
  picks ONE, deterministic, no randomness.
- API (names EXACT):
  - `avChopDetectFrames(ch1, rate, opts) -> {ok:true, onsets:[frameIdx], slices:[{s0,s1}], count}` |
    `{ok:false, error}` — ch1 = Float32Array (mono); opts `{sensitivity 0..1 def 0.5, minGapMs 20..1000
    def 60, maxSlices 1..16 def 16}`; slices = onsets + [0] head + [n] tail, contiguous [s0,s1) frame
    ranges; count ≤ maxSlices (extra onsets dropped + honest `dropped` count in result).
  - `avChopDetect(id, opts)` — resolves an avSampleStore entry (guarded) → ch1 = channel 0 data;
    entry unknown → `{ok:false, error:"unknown sample"}`.
  - `avChopKitNew(srcId)` → kit `{v:1, srcId, slot:0, base:36, slices:[{i, s0, s1, trim0, trim1,
    fadeIn:3, fadeOut:5, gainDb:0, norm:false, on:1}]}` (trim defaults = s0/s1).
  - `avChopSliceEdit(kit, i, patch) -> bool` — fields trim0/trim1 (frames clamped inside [s0,s1),
    min 32 frames), fadeIn/fadeOut ms 0..100, gainDb −24..24, norm bool (when true the APPLY pass
    normalises), on 0/1. Never throws.
  - `avChopNormGain(kit, i) -> {ok, gainDb}` — peak from the SOURCE entry channel data over the
    trimmed window; target 0.99 peak; gainDb clamped ±24. (Pure-ish; guarded store read.)
  - `avChopZones(kit) -> Float64Array(144)` — §2.4 layout. Slice k (<16): `lo=hi=base+k`,
    `root=base+k`, `buf=slot`, `vol = clamp(10^((gainDb + normGain)/20) × 0.8, 0, 1)`, `s0/s1 =
    trim0/trim1 ÷ n`, `fIn = fadeIn/1000`, `fOut = fadeOut/1000`. Inactive slices → vol 0.
  - `avChopApply(kit) -> {ok, slot, slices, zones:144, error?}` — resolves entry → channel 0 Float32
    copy → `avEngineSample(slot, name, rate, ch1, null)` + `avEngineZones(zones)` (both guarded;
    refuse honestly when the engine is down).
  - `avChopToSteps(kit, {track 0..3, start 0..63}) -> {ok, written, dropped}` — writes ONE step per
    ACTIVE slice (note = `avNoteName(base+k)`), full step objects with pinned §4 defaults and on=1,
    at consecutive steps from `start` via avSeqSnap/avSeqLoad (guarded); steps beyond 63 dropped;
    **undo law: `avUndoPush("seq", "chop")` AFTER a successful load** (guarded).
  - `avChopSnap()`, `avChopClasses()` (= []), `window.__avChop = {version:"m2.0", …all fns…}`.
- Harness (`cache/scratch/m2/chop/harness.mjs`): synthetic burst train (4 bursts @ exact frames) →
  detect onsets within ±0.5 ms of truth; minGap merging; maxSlices drop count; slice contiguity
  (s0/s1 chain covers [0, n]); trim clamp; norm gain math (constructor sine amp 0.25 → +12 dB ±0.5);
  zones table (144, slice k values, inactive vol 0); to-steps writer against a stubbed core
  (snap/load/undo captured — assert the load content + push-after-load ORDER); determinism.
  ALL-PASS `CHOP-HARNESS: n/n PASS`.

### 2.4 Sampler kind v2 — `src/av_sampler.js` (sa-D, EDIT)

- Zone table v2: `{t:"zones"}` may arrive as `Float64Array(144)` = 16 zones × 9 fields:
  `[lo, hi, root, buf, vol, s0, s1, fIn, fOut]` — s0/s1 = fractions 0..1 of the latched slot's frame
  count (s1 > s0 enforced; s0 + 1 frame minimum), fIn/fOut = linear edge fades in SECONDS 0..2.
  The legacy 40-float v1 (8×5) MUST still parse exactly as before (defaults s0 0, s1 1, fades 0 for
  zones 0..7; zones 8..15 inactive). Selection: the v1 nearest-zone law over the ACTIVE zone count
  (16 for v2 input, 8 for v1 input; ties → lowest index, unchanged).
- Window playback: one-shot reads `[w0, w1)` where `w0 = min(n−1, round(s0×n))`,
  `w1 = max(w0+1, min(n, round(s1×n)))`; loop (when `sampler.loop` 1) wraps inside
  `[max(w0, lpS), min(w1, lpE))` (invalid → loop off, documented). Ended flag = head ≥ w1 (one-shot).
- Fades: amplitude ramp 0→1 over `round(fIn×sr)` output samples from w0; 1→0 over `round(fOut×sr)`
  ending at w1 (clamped so the ramps never overlap; multiply AFTER the internal velocity law).
- Voice fields added on `k` (prefix `sv`): `svW0 svW1 svFIn svFOut svFadeA svFadeB svSmpOut` —
  init in initVoiceK, latch in initVoice; allocation-free stepVoice; NaN-proof; no randomness.
- `initEngineK` unchanged fields keep; snapshot/snap evidence: expose `{zone, buf, w0, w1, fIn, fOut}`
  through whatever snap the module already exposes (keep existing keys; extend additively).
- Harness (`cache/scratch/m2/sampler2/harness.mjs`, stub AVDSP + module text): v1 40-float table
  selects as before (regression); v2 slice zone → exact window bounds (frames); one-shot ends at w1;
  fade envelopes measured (first fIn·sr samples ramp; last fOut ramp to 0; no overlap); loop inside
  window; nearest-zone ties; NaN sweep on all 9 fields; determinism. ALL-PASS
  `SAMPLER2-HARNESS: n/n PASS`.

### 2.5 CHOP card — `src/av_chop_ui.js` (sa-E)

- Mounts into parent host `#av-chop-host` (parent adds card `#av-chop` + host after `#av-sample`).
  API: `avChopUiInit()` (idempotent), `avChopUiSnap()`, `avChopUiClasses()`, `avChopUiSync()`,
  `window.__avChopUi = {version:"m2.0", init, snap, classes, sync}`.
- DOM pins: `#av-chop-src` (select of avSampleStore entries) · `#av-chop-detect` · `#av-chop-sens`
  (range 0..100) · `#av-chop-canvas` (waveform + slice markers drawn from the entry peaks/data) ·
  `#av-chop-slices` (rows `[data-slice-idx]`, each with `.av-chop-trim0` `.av-chop-trim1` number
  inputs (frames), `.av-chop-fadein` `.av-chop-fadeout` (ms), `.av-chop-gain` (dB), `.av-chop-norm`
  (checkbox), `.av-chop-on` (checkbox)) · map row `#av-chop-slot` (0..3) `#av-chop-base` (number
  0..108) · pads `#av-chop-pads` with `.av-chop-pad[data-pad="0".."15"]` · `#av-chop-apply` (APPLY
  KIT) · `#av-chop-steps` (SLICE→STEPS) · `#av-chop-steps-track` (0..3) · status `#av-chop-status`.
- Behaviour: DETECT runs avChopDetect on the selected entry (sensitivity from the range), builds the
  kit, renders rows + markers; edits call avChopSliceEdit + repaint; `.av-chop-pad` click/pointerdown
  plays `avNoteDown(avNoteName(base+pad))` / pointerup|leave `avNoteUp` (guarded; active highlight
  `data-on="1"` while held); APPLY KIT → avChopApply → status text (`applied: N slices → slot S`);
  SLICE→STEPS → avChopToSteps → status (`wrote N steps → T{t}@{start}`). No engine reach-ins beyond
  the guarded avChop*/avNote*/avSampleStore helpers. First paint with no samples = honest empty state.
- Drag-in of a NEW wav on the card = optional (skip; the sample core owns import).
- `avChopUiClasses()` lists every NEW class the card emits (parent generates the styles block from it).

### 2.6 Song runner + arrangement export — `src/av_song.js` (sa-F) + `src/av_mid.js` edit (sa-F)

- `avSong*` namespace (page module, sibling-safe: every foreign reach typeof-guarded):
  - `avSongPlay() -> {ok}` — refuses `{ok:false, error:"no rows"}` when avSeqSongSnap().rows is empty;
    refuses "already playing"; else `avSeqPlay()` guarded + start the runner (interval 25 ms) with
    row 0 applied AT START.
  - `avSongStop() -> bool` — stop the runner + `avSeqStop()` guarded.
  - `avSongIsPlaying()`, `avSongStatus()` → `{playing, row, repeat, rows, quant, queued, step}`.
  - Row walk: L = row.len || `avSeqSchedCycleLen()` (guarded; floor 16); R = row.repeats; the runner
    advances at global grid-step boundaries using `avSeqPosition().step` — the scheduler's MONOTONIC
    grid-step counter since origin (`{step, track, t}`; −1 when stopped). Apply per row: mutes via
    ONE avSeqSnap → set 4 track mutes → avSeqLoad (guard core; repaint via `avSeqUiSync()` guarded —
    the UI must reflect it); tempo (row.tempo > 0) via `avApplyParam("bpm", t)` guarded. Runner-driven
    applies NEVER push undo (transport-driven, documented). Last row completion → auto-stop.
  - Quantised scene recall: `avSongSceneRecall(name, quant) -> {ok, at}` — quant `"instant"|"beat"|
    "cycle"` (def "beat"); stopped → immediate `avSeqSceneRecall(name)`; playing → queue; apply on
    the next boundary (beat = next step-≢0-mod-4 boundary; cycle = next cycleLen boundary) via the
    same runner tick. ONE queued recall at a time (a new request replaces). Checkpoint law: the
    runner pushes `avUndoPush("seq","scene")` itself, ONCE per applied recall, AFTER the apply
    (guarded).
  - `avSongExportMidi(opts) -> {ok, bytes, rows, noteCount, warnings}` — calls
    `avMidExportSong({snap: avSeqSnap(), song: avSeqSongSnap(), name})` guarded.
  - `avSongExportJson() -> string` — `{v:1, name, bpm, grid, rows, pattern: <P4 §4 export object>}`.
  - `avSongImportJson(str) -> bool` — validates rows via avSeqSongLoad; if `pattern` present
    avSeqLoad + avUndoPush("seq") AFTER; never throws.
  - `avSongSnap()` + `window.__avSong = {version:"m2.0", play, stop, isPlaying, status, sceneRecall,
    exportMidi, exportJson, importJson, snap}`.
- `avMidExportSong(opts)` (added to av_mid.js, reusing its internals — ONE writer (sa-F)):
  `{snap, song:{v,rows}, name, trackMask?}` → SMF format 1, PPQ 480 (the module's pins):
  track 0 = song name + per-row tempo metas at their absolute tick + row markers (name meta with
  the row label/ref); tracks 1..4 = seq tracks (mask-filtered; muted row-track combos emit nothing
  for that row). Rows expand: L = len||cycleLen steps, R repeats, contiguous; row-local events via
  the module's existing avSeqPlan-based event builder (chunked 8 steps, absolute seconds × the ROW's
  ticksPerSec + rowStartTick). Row tempo = row.tempo || snap.bpm. Cap: Σ L×R ≤ 20000 grid steps —
  beyond → truncate + `"arrangement truncated at 20000 steps"` warning. Deterministic; honest fail
  shapes like avMidExport (`{ok:false, error}`).
- Harness (`cache/scratch/m2/song/harness.mjs`): pure parts — avMidExportSong with a stub planner/
  snap (2 rows, repeats, mutes, tempo change): header valid, track count, tempo metas at expected
  ticks, muted row-track silent, repeats multiply notes, cap warning; parse-back via
  the real avMidParse (module text loaded in scope); JSON round trip; runner state machine against
  stubbed sched/core (row advance math, quant boundaries, no-undo for mutes). ALL-PASS
  `SONG-HARNESS: n/n PASS`.

### 2.7 Generative + arranger UI — `src/av_seq_ui.js` (sa-G, EDIT)

- Track header, per row `.av-seq-row[data-track]`: `.av-seq-track-ctl` block with
  `select[data-track-len]` (1..64) · `select[data-track-spd]` (0.25 · 0.5 · 0.75 · 1 · 1.5 · 2 · 4 —
  labels ×¼ ×½ ¾ ×1 ×1½ ×2 ×4) · `select[data-track-swg]` (— INHERIT + 50..80). Edits ride the
  existing avSeqUiModelEdit (snap/Load + undo AFTER — the P4 law).
- GEN block `#av-seq-gen`: `#av-seq-gen-track` (T1..T4 select) · euclid `#av-seq-euclid-pulses`
  (1..16) `#av-seq-euclid-len` (2..64) `#av-seq-euclid-rot` (0..63) `#av-seq-euclid-apply` (uses
  avSeqEuclid mask: hits → on=1 keeping each step's note else c4, non-hits cleared within len, steps
  beyond len untouched) · mutate `#av-seq-mutate-amt` (0..100) `#av-seq-mutate-apply`
  (avSeqMutate(seed, amount) — seed from the pattern rng) · humanize `#av-seq-humanize-amt`
  `#av-seq-humanize-apply` · fill `#av-seq-fill-id` (select of avSeqFillIds()) `#av-seq-fill-apply`.
  Every apply = model edit via snap/Load + undo AFTER (label "gen").
- SONG block additions (inside the existing `.av-seq-song`): rows list `#av-seq-song-rows`
  (rows `.av-seq-songrow[data-row]` with `[data-song-field]` inputs: label text, repeats 1..256,
  len 0..1024, tempo 0..300, mutes `.av-seq-songrow-mute[data-track]`; buttons `[data-song-up]`
  `[data-song-dn]` `[data-song-del]`; `#av-seq-song-rows-add` appends a row {ref = live pattern name,
  repeats 1, mutes current, len 0, tempo 0, label ""}); `#av-seq-song-play` (toggle PLAY SONG ↔ STOP
  SONG, aria-pressed; calls avSongPlay/avSongStop guarded; polls avSongStatus for the active-row
  highlight `.cur` + `#av-seq-song-pos` text) · quant select `#av-seq-song-quant` (instant/beat/
  cycle, def beat) — feeds the scene RECALL button's quant argument AND is stored as the recall
  default · `#av-seq-song-midi` (EXPORT SONG MIDI — avSongExportMidi → honest status line, no
  download plumbing beyond a Blob URL anchor like the card's existing export idiom) ·
  `#av-seq-song-json` / `#av-seq-song-open` (hidden file input) · timeline strip
  `#av-seq-song-timeline` with `.av-seq-tl-block[data-row]` (width ∝ L×R, `.cur` highlight during
  playback). All song-row edits ride snap/Load-style core calls (avSeqSongSnap/Load) +
  undo AFTER (label "song").
- Scene recall: the existing RECALL button calls `avSongSceneRecall(name, quantFromSelect)` guarded
  when avSongIsPlaying(), else the existing immediate avSeqSceneRecall; BOTH now push
  `avUndoPush("seq","scene")` AFTER (the carried P4 follow-up — undo covers scenes); chain edits
  (+CHAIN/CLEAR) push checkpoints AFTER too (label "chain").
- Local default pattern builder (`avSeqUiLocalDefault`) gains `swing: 0` per track (model v2).
- `avSeqUiClasses()` covers every NEW class (§ above) — update the list.
- Version surface: `window.__avSeqUi.version` → "m2.0" is NOT required; keep "p4.0" (the rig's
  export check reads classes count; update ≥30 stays).

### 2.8 Rig — `verify/cdp_m2.mjs` (sa-H, write-only)

Port the launch block from `verify/cdp_m1.mjs` (file:// target wait, 1440×900 metrics override,
`--autoplay-policy=no-user-gesture-required`, temp profile + cleanup, ONE browser, explicit exit);
port the Web MIDI stub from `verify/cdp_midi.mjs` (Page.addScriptToEvaluateOnNewDocument BEFORE
navigate). `EXPECT_SHA = null`. Check groups (≈30 + sha leg), audio witnesses install their OWN
AnalyserNode on `avMasterNodes()` (panel reads are not witnesses); fresh-page pattern is EMPTY —
load what you need via the established loaders:

1. **MPE**: enable MIDI (stub), `avMpeDeckSet(true)` + bend 48 (snap reflects; `#av-midi-mpe-row`
   present); inject member note (chan 2 = 0-based 1) c3 → engine audio present (analyser) at
   ≈130.8 Hz (peak or zero-crossing, ±1.5%); inject bend +12 semis (raw `12/48*8192 = 2048`) →
   pitch ratio ≈ 2.000 ±1.5%; touch 127 → spectral centroid rises (measure before/after);
   CC74 127 → centroid rises strongly; CC10 127 → stereo imbalance (right RMS > left by ≥ 3 dB —
   split the tap); note-off → silence; member note while playIn off → no audio; MASTER ch1 note
   still plays through the global path; `avMpeDeckSet(false)` brooms (silence ≤ 300 ms).
   Snap keys asserted (`window.__avMpeDeck.snap()`).
2. **Chop**: build a WAV in-page (avWavEncode a 4-burst synthetic) → feed via DataTransfer into the
   sample store's file input (or the store's public import path) → avChopDetectFrames on the
   entry's channel data → 4 slices (±0.5 ms truth frames); edit trim/fade/norm via the CARD inputs
   (rows `[data-slice-idx]`); APPLY KIT → pad note (avNoteDown base+1) → engine audio burst
   (analyser RMS); norm'd slices RMS-equal ±1.5 dB (two pads compared); fade-out → tail RMS < 30% of
   mid; SLICE→STEPS on track 3 → avSeqSnap steps on ×4 with notes base..base+3; PLAY → 4 onsets.
3. **Generative**: track speed select exists + set track 4 speed 0.75 → `avSeqPlan` pure witness
   (event spacing = stepDur/0.75) + UI reflects snap.tracks[3].speed; per-track swing: track 2 swing
   66 vs pattern 50 → planner onset shift ≈ +16% stepDur on odd steps (pure witness); euclid apply
   → on-count == pulses; mutate keeps count; fill apply changes steps.
4. **Song**: build 3 rows (L=4, repeats 2/1/2, row 2 mutes all but track 1) → PLAY SONG → row
   advance witnessed (status.row = 0 → 1 → 2 monotone with time; mutes applied — muted window
   silence on the muted tracks mid-row); quantised scene recall: queue RECALL at beat → mute flip
   at a step ≡ 0 mod 4 boundary (timing witness via snap poll); EXPORT SONG MIDI → parse via
   avMidParse → noteCount scales with repeats; EXPORT JSON round trip; STOP → clean.
5. **Freeze leg** (sha=pinned).

Rig ends with `M2-RIG-RESULT: n/N` + screenshot `renders/m2-suite.png`. Parse `?avtest=1` proofs
only, never console text; assert own fixtures honestly (SPEC fix vs app fix triage is the parent's).

## §3 Gates

- Child harnesses ALL PASS (parent re-runs every one on the landed bytes).
- Build: `python3 build.py` green; av_mpe joins BOTH concats; new worklet sha.
- Smoke on the frozen build: updated checks (add #av-chop card + API · MPE row present after the deck
  renders · song rows list present; counts updated).
- Rig cdp_m2 first run → parent triage → pins; cdp_smoke · cdp_seq · cdp_midi re-checked (M2 UI edits
  may touch their assertions — fix rig-side per the rig SPEC law).
- FULL battery re-pin: 19 suites + cdp_m2 = **20 suites**, every EXPECT_SHA → the new sha
  (pin list: midi sample rec fx seq store deck s4 s5 code m1 m2 + the env/arg form in cdp_rec).
- PERF GATE: bench (knee vs 96/128 + monotone) + stress ×2 + old-bytes control if raw counts jump
  (worklet changed by design: av_mpe joins the concat + av_dsp MPE paths + sampler v2 — all inert
  when MPE is off / zones v1; the bench knee is the gate).
- Close: commits (integration+battery, then gate+docs+addendum 33), README status, docs/05 §2.7
  status, mnemosyne canonical.

## §4 Parent integration recipe (counted-assert script `cache/scratch/m2/integrate/_m2_integrate.py`)

Sites (each with an exact-occurrence assert; captures anchors at authoring time; artifact guard at
the top refuses until all 8 child files exist):

1. `build.py`: `_mpe_src` after `_lad_src`; worklet concat `_lad + _mpe + _dsp + …` (+ "AVM" in the
   assert list); page js_parts order: av_mpe.js after av_note.js · av_mpe_deck.js after av_midi.js ·
   av_chop.js + av_chop_ui.js after av_wt_ui.js · av_song.js after av_seq_ui.js.
2. `src/av_note.js`: channel tagging — `avNoteDown(name, vel, ch)` / `avNoteUp(name, ch)`: key =
   `ch > 0 ? name + "@" + ch : name`; sinks called `on(midi, gain, name, ch)` / `off(midi, name, ch)`
   (extra args — existing sinks ignore); `__lastNotePreview` for ch 0 only; `avNoteState()` adds
   `heldCh: [{name, ch}]` (held/taken stay ch-0 semantics); avNoteStopAll clears everything.
3. `src/av_dsp.js`:
   - create(): `eng.mpe` init via guarded `AVM.create()`; `zones: new Float64Array(144)`.
   - makeVoice(): `mpeCh: 0, mpeBendApplied: 0`.
   - computePitch(): `st += AVM.pitchSemis(...)` when `v.mpeCh > 0`; record `v.mpeBendApplied` at end.
   - recomputeFilter(): timbre base override + at boost (guarded on `v.mpeCh > 0 && eng.mpe`).
   - voiceFrame recompute trigger (line ~1093 condition): + `|| (v.mpeCh > 0 && v.mpeBendApplied !== eng.mpe.chBend[v.mpeCh])`.
   - render(): per-voice pan split (`mpePanAny` fast path keeps non-MPE sums bit-identical).
   - noteOn/noteOff(eng, midi, gain, ch): ch stored on the voice; member duplicate policy mirrors the
     existing same-note policy keyed on (midi, ch); noteOff matches (midi, ch); allOff unchanged;
     new `mpeAllOff(eng)` releases member voices (zone-off broom).
   - setZones(): accept 40 (legacy) or 144, refuse others; 40 fills slots 0..7 + defaults.
   - `mpeSet(eng, on, bend)` + `mpeExpr(eng, ch, dim, v)` wrappers (validate ch 1..15; delegate AVM;
     set-off → member broom) + export on AVDSP; stats() += `mpe: {on, bend, active}`.
4. `src/av_voiceproc.js`: branches `{t:'mpe'}` → AVDSP.mpeSet · `{t:'mpenote'}` → on ?
   AVDSP.noteOn(eng, midi, gain, ch) : AVDSP.noteOff(eng, midi, ch) · `{t:'mpeexpr'}` → AVDSP.mpeExpr.
5. `src/av_engine.js`: worklet handle noteOn/noteOff gain the ch arg (ch > 0 → `{t:'mpenote'}`);
   SPN handle passes ch; the avNote sink registration forwards ch; new senders `avEngineMpeSet(on,
   bend)` + `avEngineMpeExpr(ch, dim, v)` (worklet postMessage / SPN AVDSP direct) exported on the
   facade.
6. `src/av_midi.js`: pref defaults + load constructor gain `mpe: false, mpeBend: 48`; the input
   router hook line after `if (!m) return;` (`avMpeDeckIncoming`); `avMidiReleaseAll` +
   `avMidiChannelMode` broom lines (`avMpeDeckRelease()` guarded); `avMidiPanelHTML` MPE row splice
   (after the clock-out block, before the LEARN block); `avMidiRender` wire call; `avMidiSnap` +
   `mpe: avMpeDeckSnap()` guarded.
7. `src/av_seq_core.js`: `AV_SEQ_SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4]` (amend the P4 pin,
   documented) · track v2 gains `swing` (0 = inherit | 50..80): defaults + norm + sanitise + snap
   copy + export key order `{len, speed, swing, mute, steps}` + the §4 format note in the header.
8. `src/av_seq_sched.js`: per-track swing override in the planner (track.swing 50..80 else
   pattern.swing) + default/fixture builders gain `swing: 0` on tracks.
9. `src/body.html`: `#av-chop` card + `#av-chop-host` after `#av-sample`; the "playing now" note
   paragraph gains the M2 sentence.
10. `styles.css`: append the M2 block generated from `avChopUiClasses()` + `avMpeDeckClasses()`
    (sa-B reports the list) + the new av_seq_ui classes (from `avSeqUiClasses()` delta) — coverage
    checked against the runtime lists.
11. `app_core.js`: ANVIL.version **1.5.0** · phase `"M2 · expression · chop · generative ·
    arranger"`; boots `avMpeDeckInit()` (after midi) + `avChopUiInit()` (after sample); log line
    gains `mpe=`/`chopUi=`/`song=`; MPE SELFTEST leg appended to the engine selftest out
    (`mpe: {on, expr, off}` round trip).
12. `verify/cdp_smoke.mjs`: add #av-chop card/host/API check, MPE-row check (post-deck-render),
    song-rows check; update count texts.

## §5 Watch-outs

- **Bit-identical law**: with MPE off (default) and zones v1, the engine render must stay
  bit-identical — every MPE branch guards on state that is off by default; the bench/alias rigs are
  the canary. Zone parse v1 must reproduce EXACT selection (regression leg in the sampler harness).
- **The one note path**: MPE member notes ride the avNote bus with a channel tag — the bus stays THE
  path; the dock/typing surfaces pass no tag (ch 0). Capture already forwards `arguments` untouched.
- **av_kb**: does not read avNoteState for held-paint (typing keys track their own map) — MPE notes
  must not break the dock; verify in the rig (dock still plays while a member note sounds).
- **Runner vs undo**: runner-applied mutes/tempo NEVER push undo; user-driven song-row/scene/chain
  edits DO (AFTER the change — the P4 law). Both are asserted in the harness/rig.
- **Song rows v1**: every row references the LIVE pattern (single bank — refs recorded, resolution
  deferred); document in the file header + the UI caption.
- **Rig witnesses are audio-first**; snap reads corroborate. Fresh-page pattern is EMPTY.
- **camelCase ids/classes** — the av- prefix everywhere; no collisions with existing top-level names
  (`AVM`, `avMpeDeck*`, `avChop*`, `avSong*` are free — verified).
- Children: write the file to disk FIRST (complete), then iterate; scratch ONLY under
  `cache/scratch/m2/<name>/`; report per §6.

## §6 Report shape (every child)

Plain lists, no brace-template blocks: files written (path + lines + `node --check` result); harness
summary line + where the log lives; every interface pinned in §2 that was NOT met as stated (with
the deviation and why); anything left undetermined; no success claims without the re-run output
quoted.

## §7 Dispatch map

sa-A av_mpe.js · sa-B av_mpe_deck.js · sa-C av_chop.js · sa-D av_sampler.js (edit) · sa-E
av_chop_ui.js · sa-F av_song.js + av_mid.js (edit) · sa-G av_seq_ui.js (edit) · sa-H verify/cdp_m2.mjs
— briefs point at §2 rows; children read the living templates atop this file. Parent: integration
script (§4) + freeze + rig triage + battery + perf gate + close records.
