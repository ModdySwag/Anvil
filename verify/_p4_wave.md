# Anvil P4 — Sequencer / groovebox: wave contract (2026-10-07)

Trigger: golden build continues — P3 CLOSED (frozen `5861d7d6`, battery green, perf gate recorded).
Deliverable per `docs/03` §2.6 + the phase table's P4 row + the GOLDEN BUILD program: the native step
sequencer — step-object model · audio-clock scheduler into the note bus · grid UI · swing /
probability / conditions / ratchets / micro-timing · p-locks · chains + song rows + scenes · the
ACID lane · step + live recording · pattern import/export · undo/redo + A/B.

Gates (wave close): `cdp_seq` rig green (parent runs) · child node harnesses + parent summary pass ·
**timing tests (audio-clock: onset spacing + no cumulative drift)** · pattern import/export round-trip ·
null laws (sequencer off ⇒ engine bit-identical; no double-walked notes) · P3 battery re-run green on
frozen bytes · PERF GATE (bench + stress) · commits + addendum 16.

## 0. Evidence first

READ: `research/groovebox/T3-groovebox-sequencing.md` (THE corpus — §16 swing law, §17 probability +
conditions, §18 ratchets/micro/gate, §19 polymeter/quantize/Euclid, DELIVERABLES A/B/C) · `docs/03`
§2.6 (spec) + §2.7 (patch v2 model) · `docs/07` picks #71 (p-locks), #73 (arranger), #74 (live mode),
#75 (undo/redo) · `verify/_p3_wave.md` §2 (module conventions to mirror) · `src/av_note.js` (THE note
bus — every sequenced note goes through `avNoteDown`/`avNoteUp`) · `src/av_engine.js` (facade +
`avEngineEnsure`; the live handle carries `.ctx`) · `src/app_core.js` (`avState.bpm`,
`avApplyParam` funnel — every commit rides it) · `src/av_synth.js` + `src/av_fx.js` (card idioms) ·
`src/av_mod.js` (the additive-wrapper pattern for wrapping `avApplyParam`). PF lineage for the
lookahead law (read-only): `C:\Users\Moddy\pattern-forge` — keep its laws verbatim: **no interceptor
re-expands a walked note**; the scheduler owns timing, the note bus owns dedupe.

## 1. File scope & ownership

| file | owner | notes |
|---|---|---|
| `src/av_seq_core.js` | A | NEW: step-object + pattern model, tracks, chains, song rows, scenes, serialisation, import/export, generators |
| `src/av_seq_sched.js` | B | NEW: pure event planner + live transport (audio clock) + note-bus bridge + slide/legato emission + p-lock dispatch hooks |
| `src/av_seq_ui.js` | C | NEW: the sequencer card (transport · grid · inspector · song/scene). C also writes `verify/cdp_seq.mjs` |
| `verify/cdp_seq.mjs` | C | NEW, WRITE-ONLY (parent runs it after integration) |
| `src/av_seq_acid.js` | D | NEW: the ACID lane (accent / slide / octave semantics vs `av_acid.js`) |
| `src/av_plock.js` | E | NEW: p-lock lanes model + apply core + lane UI rows |
| `src/av_undo.js` | F | NEW: bounded undo/redo + A/B (params · seq · plock domains) |
| `src/av_seq_capture.js` | G | NEW: step + live recording core (quantize; param capture → p-locks) |
| `src/av_dsp.js`, `src/av_engine.js`, `src/app_core.js`, `src/body.html`, `src/styles.css`, `build.py`, `index.html`, other `verify/*`, git | PARENT | children never touch |

Scratch per child: `cache/scratch/p4/<name>/`. Node harnesses YES (own, deterministic; core / sched /
plock / undo / capture MUST load in plain node — no DOM reach-ins at load; guarded access only).
Browsers NO. build.py NO. git NO. ONE writer per file.

## 2. Global pins (all children)

- Namespace `avSeq*` / `AV_SEQ_*`; version strings `"p4.0"`; `"use strict"`; exactly one top-level
  namespace per file; never throws (refuse with false).
- **Time model:** default grid = 16ths; `pattern.grid` ∈ `"16" | "8t"` (8th triplets = 12 steps/bar);
  `stepDur = 60/bpm/4` ("16") or `60/bpm/3` ("8t"). **Swing** (T3 §16): S ∈ [50,80] default 66; each
  odd-indexed step shifts +`stepDur × (S − 50) / 100`. **Micro** (T3 §18): ±12 ticks, tick =
  `stepDur/24`, applied after swing. **Probability** (T3 §17): 0..100 per step against a scheduler
  xorshift32 (own state, seed stored in the snap; same constants as the engine: 13/17/5). **Conditions
  v1** (T3 §17): `"" | "fill" | "a:b" | "first" | "!first"` — evaluated per cycle by the planner.
  **Ratchet** (T3 §18): integer count 1..4 sub-hits per step — implement T3's exact law and document
  it in the report. **Gate**: 0.05..1 fraction of the step (sub-hit scaled).
- Note names via `avNoteParse`/`avNoteName` (c4 = 60, A4 = 69); velocity/gain 0.05..1; **accent step
  ⇒ gain 1.0** (D verifies against `av_acid.js` and flags any mismatch in its report).
- **4 tracks**, each `{ len: 1..64, speed: 0.25|0.5|1|2|4, mute: 0|1, steps: [ up to 64 ] }`
  (polymeter by per-track len/speed).
- **Scheduler law (pin):** lookahead `0.12 s`, wake every `25 ms`, all times against the live
  handle's `ctx.currentTime` (PF lookahead law kept). Events leave ONLY via `avNoteDown`/`avNoteUp`;
  a bounded trace ring `window.__avSeqTrace` (256 × `{t, type, note, step, track}`) is maintained.
  Sequencer off ⇒ zero events ⇒ the engine renders exactly as P3 (bit-identical null).
- **Onset expectation:** note delivery is quantum-granular (±1 quantum ≈ 2.7 ms @48k). Rig gate:
  mean |onset − grid| ≤ 8 ms and NO cumulative drift (bar 8 offset within ±6 ms of bar 1).

## 3. Module pins

### 3.1 `av_seq_core.js` (A)
Model (single source of truth, deep-copied on snap/load):
```
pattern = { v:1, name:"PAT 1", bpm:120, grid:"16", swing:66,
            tracks:[ {len:16, speed:1, mute:0, steps:[ step×64 ]} ×4 ] }
step    = { on:0|1, note:"c4", vel:0.8, gate:0.95, slide:0|1, accent:0|1, oct:0,
            prob:100, cond:"", ratchet:1, micro:0 }
plock   = { path:"filter.cutoff", interp:"step"|"lin", steps:{ "<stepIdx>": value } }   (E owns model+rules; core carries the container in the snapshot)
```
API: `avSeqDefaults()` · `avSeqSnap()` (fresh deep copy) · `avSeqLoad(obj)` (sanitised: caps, clamps,
drops unknown; false on garbage) · `avSeqPatternExport()` → JSON string · `avSeqPatternImport(str)` →
bool · chains `avSeqChainsSnap()/Load`, song rows `avSeqSongSnap()/Load`, scenes
`avSeqSceneCapture(name)/avSeqSceneRecall(name)/avSeqScenesSnap()` · generators `avSeqEuclid({len,
pulses, rotate}) → steps[]`, `avSeqMutate(seed, amount)`, `avSeqHumanize(seed, amount)`, `avSeqFill(id)`
— all seeded/deterministic, never throwing. LS keys: `av-seq-pattern`, `av-seq-chains`, `av-seq-song`,
`av-seq-scenes` (JSON; load-on-boot best-effort). Import/export = the pinned file format (JSON text).
Report: deviating field semantics (if any) + the exact JSON an export produces.

### 3.2 `av_seq_sched.js` (B)
- **Pure planner:** `avSeqPlan(snap, fromStep, toStep, originT, rngState) → { events:[{t, type:"on"|"off",
  note, vel, track, step, flags:{slide,accent,ratchet,micro}}], rngNext }` — analytic times (swing +
  micro + stepDur math inside; ratchet = sub-hits), no I/O, allocates only the result.
- **Live transport:** `avSeqInit()` (binds deps via typeof guards: `avEngineEnsure` handle for
  `ctx.currentTime`, `avState.bpm`, `avNoteDown/Up`) · `avSeqPlay()` / `avSeqStop()` /
  `avSeqToggle()` · `avSeqIsPlaying()` · `avSeqSetPattern(snap)` (live-safe) · `avSeqPosition()` →
  `{step, track, t}` for the UI playhead · `avSeqRng()` (planner RNG control).
- **Emission law:** slide step k ⇒ `avNoteDown(k+1)` is delivered **before** `avNoteOff(k)` at the
  same planned time (legato; AVACID's slide-origin scan does the rest — P2 law). No other reordering.
  Off-time = clamped `on + gate × stepDur` (never past the next on).
- **P-lock dispatch:** at each step boundary the scheduler calls `avPlockApplyAt(step)` when E defines
  it (guarded typeof) — order: plocks → note events.
- **Capture feed:** B exposes `avSeqSchedNow()` (ctx time) for G; G taps the note path itself.
- Trace ring + `window.__avSeq = {...}` debug handle (playing, patternName, lastEvents). Report: the
  planner's event stream for a known pattern (exact times) as evidence.

### 3.3 `av_seq_ui.js` (C) + `verify/cdp_seq.mjs`
Card mounts into the parent-added host `#av-seq-host` (inside the parent card `#av-seq`) via
`avSeqUiInit()` → false-without-throw when absent; re-mountable. DOM pins (rig + parent styles rely on
these): transport buttons `#av-seq-play`, `#av-seq-stop`, `#av-seq-rec`; position readout
`#av-seq-pos`; BPM knob rides the standard av-knob idiom path **`"bpm"`** (parent adds the app_core
branch); grid: `.av-seq-grid` → rows `.av-seq-row[data-track]` → cells `.av-seq-cell[data-track]
[data-step]` with `.on`, `.cur` (playhead), `.sel`; inspector `.av-seq-insp`; song/scene block
`.av-seq-song` (chain list + `#av-seq-song-add` etc. — C documents the full list in its report);
`avSeqUiSync()` repaint from the core snapshot; `avSeqUiClasses()` returns the new class list;
window.__avSeqUi published. Every control commits through `avApplyParam` (or the 'av-param' event
fallback), never direct engine calls. C ALSO writes the rig:
- boot → card + grid mounted, 4 rows, controls bound;
- real click PLAY → transport runs, playhead `.cur` advances; real click STOP halts;
- **timing witness:** START a known 16-step pattern @120 bpm; the rig owns an AnalyserNode on the
  master tap (avMasterFor — panel reads are never witnesses) and samples the RMS envelope tightly
  (~5 ms); detect onsets over ≥8 bars → mean |Δ| ≤ 8 ms vs the analytic grid + no drift (bar 8 ±6 ms
  vs bar 1) + 16 onsets/bar when all steps on;
- swing: set S=66 → odd onsets shift ≈ +16 % of stepDur on average (witnessed, tolerance ±6 ms);
- probability/conditions: set prob 0 on odd steps → their onsets disappear across 2 bars (statistical:
  with S=150 steps... use prob 0 = deterministic silence; prob 100 keeps them);
- pattern import/export round-trip through the UI path (export → import → deep-equal snap);
- p-lock: write a lock (filter.cutoff) on one step, run, witness the cutoff value at that step's time
  (avParams mirror via the funnel), and restore after;
- undo/redo: edit a step, undo restores, redo reapplies (via F's API guards);
- zero page errors · freeze sha before === after · screenshot `renders/p4-seq-suite.png`.

### 3.4 `av_seq_acid.js` (D)
The ACID lane: active when the engine kind is `acid` (the UI row switches to accent/slide/oct
columns; `avSeqAcidLane()` presence probe). Laws: accent step ⇒ gain 1.0 + the AVACID accent entry
path (VERIFY against `src/av_acid.js` — the P2 child's accent-memory rise test is the reference —
and report the exact mapping; adjust within the lane module only). Slide step ⇒ the sched's legato
emission + `voice.glide` set to the 303 stock ≈60 ms during the slide pair (restore after; values
via `avApplyParam`, defaults documented). Octave ±1..2 → note ±12/24 st at plan time (flagged to
sched via the step's `oct` field — the planner applies `oct × 12`). Report: the three-column lane
inventory + the mapping table + a node harness proving the step→param/gain mapping.

### 3.5 `av_plock.js` (E)
Lane model `{path, interp:"step"|"lin", steps:{idx:value}}` inside the core snapshot; `avPlockApplyAt(step)`
(called by B at each step boundary): locked path → `avApplyParam(path, value)`; a path locked at step
k with NO lock at k+1 → restore the base value captured at transport start (and re-captured when the
user moves the control while running — funnel tap, marker `__avPlockWrap`, idempotent). Interp "lin":
values interpolate between locked steps at ~64 Hz control rate while running (step = immediate jump).
UI: lane rows under the inspector (path select from a pinned v1 list — filter.cutoff, filter.reso,
fx.verb.mix, fx.delay.mix, fx.delay.feedback, fx.mod.rate, engine.outScale — plus free-text path
accepted), step painting on the lane row (`.av-seq-plock-cell`). Node harness: apply/restore/interp
math + funnel wrap idempotence.

### 3.6 `av_undo.js` (F)
`avUndoInit()` (instal the funnel wrap + key bindings; false without window) · `avUndoPush(domain,
label)` · `avUndo()` / `avRedo()` → bool · `avUndoAStore()` / `avUndoARecall()` (A/B on the same
domains) · `avUndoStatus()` → `{depth, redo, label}`. Domains v1: `"params"` (avParams mirror diff —
wrap `avApplyParam` additively, marker `__avUndoWrap`, snapshot-on-quiet ~300 ms), `"seq"` (core
snapshot via avSeqSnap), `"plock"`. Cap 64 entries, bounded memory (JSON strings), Ctrl+Z /
Ctrl+Shift+Z bound when no text field is focused. Observables for the rig: `window.__avUndo`.
Node harness: push/undo/redo semantics + cap + A/B + wrap idempotence.

### 3.7 `av_seq_capture.js` (G)
`avSeqCaptureArm(mode)` (`"step"|"live"|off`) · `avSeqCaptureSetQuantize(pct)` · funnel tap for param
capture → auto-writes a plock at the current step when armed (marker `__avSeqCapWrap`, idempotent) ·
note capture: additively wraps `avNoteDown`/`avNoteUp` (marker `__avSeqCapNoteWrap`) — while armed,
played notes quantize to the nearest step (step-record writes the step under the playhead; live-record
quantizes to the grid with quantize 0..100 % strength) — ALWAYS forwards the original call untouched
(no re-expansion; the arbitration law). `avSeqCaptureState()` observable. Node harness: wrap
idempotence + quantize math + step writing.

## 4. Pattern file format (pin — import/export + rig)

```json
{ "v": 1, "name": "PAT 1", "bpm": 120, "grid": "16", "swing": 66,
  "tracks": [ { "len": 16, "speed": 1, "mute": 0, "steps": [ { "on": 1, "note": "c4", "vel": 0.8, "gate": 0.95, "slide": 0, "accent": 0, "oct": 0, "prob": 100, "cond": "", "ratchet": 1, "micro": 0 } ] } ],
  "plocks": [ { "path": "filter.cutoff", "interp": "step", "steps": { "0": 800 } } ],
  "rng": 305419896 }
```
Sanitised on import exactly like `avSeqLoad`; export = `avSeqPatternExport()`.

## 5. Gates, reports, laws

Per child: node --check own files · own deterministic node harness → `cache/scratch/p4/<name>/<name>_node_out.{log,json}` ·
§8-shape report (files, version, exports, evidence, deviations, integration seams). Laws: one writer
per file · scratch never in repo · no build/browser/git for children · core/sched/plock/undo/capture
load in plain node (no DOM at load) · seeded determinism (same seed ⇒ same output) · never throw ·
all page commits ride the avApplyParam funnel · the note bus stays the ONE note path (no parallel
note delivery).

## 6. Parent integration (after children land)

build.py parts (core → sched → plock → capture → undo → acid → ui, before app_core) · app_core boot
(`avSeqInit`, `avSeqUiInit`, `avUndoInit`, `avSeqCaptureInit` guarded) + the `"bpm"` branch in
avApplyParam (avState.bpm clamp 20..300 + mirror `fx.delay.bpm`) · body card `#av-seq` +
`#av-seq-host` · styles (C/D/E returned lists) · smoke additions (seq card mounted; counts) ·
re-run child harnesses + the rig + the FULL P3 battery on the frozen bytes · PERF GATE (bench +
stress, quiet machine) · docs updates as needed · commits + addendum 16.
