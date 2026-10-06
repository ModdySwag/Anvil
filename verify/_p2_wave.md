# Anvil P2 — sound identity + sample core + recorder: wave contract (2026-10-07)

Trigger: golden build, full permission granted. Deliverable per docs/03 §6 P2 + docs/05 §2.7–2.10 +
docs/04 §4: ACID engine (Open303-lineage, accent memory) · STRING engine (Karplus-Strong) · DRUM
engine (expanded kit, pads, kit bus, drum↔synth split) · ladder filter + overdrive stage · sample
core begins (buffer manager, import/decode, waveform display, drag-in) · recorder core (tap →
WAV) · the synth card grows the ENGINE layer.

Gates (wave close): acid numerics pass (incl. accent-memory rise + slide timing) · string/drum
sanity harnesses green · sample import round-trip green · recorder WAV round-trip green · P1 battery
re-run green on frozen bytes · PERF GATE (bench + stress deltas recorded vs 56734133) · A/B render
set archived for the owner pass.

## 0. Evidence first

READ BEFORE ANY EDIT: `src/av_dsp.js` (947 lines — voice pool, minBLEP core, param table, the laws in
its header), `src/av_voiceproc.js`, `src/av_engine.js` (facade + tier ladder), `src/av_synth.js` (the
card you extend), `verify/_p1_wave.md` §4.2 (param table source of truth), `verify/_p1x_blep_wave.md`
(minBLEP deposit/read scheme), docs/03 §2.1–2.6, and for acid: `research/acid/T2-acid-heritage.md`.
Reuse PF sources read-only where told (`C:\Users\Moddy\pattern-forge`).

## 1. File scope & ownership (one writer per file)

| file | owner | notes |
|---|---|---|
| `src/av_acid.js` | A | NEW worklet-safe module (top-level name `AVACID`) |
| `src/av_string.js` | B | NEW worklet-safe module (`AVSTRING`) |
| `src/av_drum.js` | C | NEW worklet-safe module (`AVDRUM`) |
| `src/av_pads.js` | C | NEW page module (`avPadsInit`) — pads UI, DOM ok |
| `src/av_ladder.js` | G | NEW worklet-safe module (`AVLADDER`) — Moog-ladder kernel |
| `src/av_sample.js` | D | NEW page module (`avSampleInit`) — sample core + waveform |
| `src/av_rec.js` | E | NEW page module (`avRecInit`) — tap recorder |
| `src/av_synth.js` | F | EXTEND — engine select + kind panels (read first!) |
| `verify/cdp_sample.mjs` | D | NEW rig (written, NOT run by the child) |
| `verify/cdp_rec.mjs` | E | NEW rig (written, NOT run by the child) |
| `src/av_dsp.js`, `src/av_voiceproc.js`, `src/av_engine.js`, `src/app_core.js`, `src/body.html`, `src/styles.css`, `build.py`, `index.html`, `verify/*` (except D/E's rig files), git | PARENT | children never touch |

Worklet-safe = strict mode, NO DOM/window/document/`location`, ONE top-level name, no allocation in
per-sample paths, no NaN/throw paths. Children may run THEIR OWN node harnesses (deterministic);
children NEVER run browsers, build.py, or git.

## 2. The kind interface (pin — this whole wave compiles against it)

### 2.1 Engine-kind modules (`AVACID`/`AVSTRING`/`AVDRUM`/`AVLADDER`)

Kinds: `engine.kind` ∈ `'va'|'acid'|'string'|'drum'` (0..3; va = current chain). Each module:

- `VERSION` (string, "p2.0"), `PREFIX` ("acid"|"string"|"drum").
- `initEngineK(kext)` — initialise engine-level fields (accent-cap memory etc.) on the shared kext
  object; called once per engine by the parent integration. (LADDER: no kext needed; see §3.4.)
- `initVoiceK(k)` — initialise THIS kind's fields on the shared per-voice `k` object; called once per
  voice at engine create. Document the fields in a `/* VOICE FIELDS: ... */` block at the top.
- `initVoice(eng, v)` — per-NOTE reset (called from reinitVoice when `v.kindId` is mine).
- `stepVoice(eng, v) -> number` — ONE base-rate sample; full ownership of osc/filter/decimation for
  this kind; reads shared `v.pitch` (semitones, glide applied), `v.vel`, `eng.sr`, `eng.bend/tune`.
- `releaseVoice(eng, v)` — optional release semantics (called when the voice is released).
- `isVoiceDone(eng, v) -> boolean` — required; true once a RELEASED voice's tail has decayed (drives
  voice → idle). Must never return true for an active (non-released) voice.
- `setParam(eng, path, value) -> boolean` — handles `PREFIX + '.'` paths only.
- Footer: `if (typeof AVDSP !== "undefined" && typeof AVDSP.registerKind === "function") AVDSP.registerKind(<id>, <MODULE>);`
  ids: **1 acid · 2 string · 3 drum**. LADDER does NOT register a kind (it exports kernels only).

The shared amp path for kind voices: `voiceFrame` returns `stepVoice(...) * v.vel * v.fade` — kinds
own their envelopes entirely (shared e1/e2/LFO do NOT run for kind voices). The steal fade
(state 3), velocity, glide fields and the voice pool stay shared and lawful.

### 2.2 AVDSP additive surface (parent implements; modules rely on it)

- `AVDSP.registerKind(id, mod)`; kinds dispatch via per-voice `v.kindId` (set in reinitVoice from the
  routing rule; a kind change affects NEW notes only — sounding voices render their own kind).
- `v.k` — shared per-voice object; parent fills via each module's `initVoiceK`. `eng.kext` — shared
  engine object; parent fills via `initEngineK`.
- `AVDSP.blep = { W, N, RL, MASK, SUBS, tab, deposit }` — exposes the P1.x residual table + deposit
  function so kind oscillators reuse the exact same minBLEP scheme (no duplicate tables).
- Routing rule (`routeKind(eng, midi)`): kind = `eng.kind`; special case: when `eng.kind === 3` and
  `drum.split > 0` and `midi >= drum.split`, the note plays as **kind 0 (va)** — the drum↔synth split
  (drums below, synth above, one engine, seamless).
- `engine.kind` param (string enum). Also new: `filter.drive` (0..1) + filter mode `'ladder24'`
  (§3.4); parent wires both into the VA path.

### 2.3 Parent integration edits (after modules land)

`src/av_dsp.js`: registerKind + `v.kindId`/`v.pendingKind` + `v.k` + `eng.kext` + kind dispatch in
`voiceFrame` (+ `isVoiceDone` end-check) + `engine.kind` param + routeKind in noteOn + blep exposure +
`filter.drive`/`ladder24`. `build.py`: `js_parts` becomes [av_tap, av_knob, av_note, av_kb, av_midi,
**av_ladder, av_dsp, av_acid, av_string, av_drum**, av_rec, av_sample, av_pads, av_engine, av_synth,
app_core] and the **worklet source concat = av_ladder + av_dsp + av_acid + av_string + av_drum +
av_voiceproc** (ladder first: av_dsp's ladder mode uses it; keep the standalone `node --check` +
`registerProcessor('av-voice'` guards, `<`-escaping). `app_core.js`/`body.html`/`styles.css`: boot
calls for avPadsInit/avSampleInit/avRecInit, card hosts, CSS (children return class lists).

## 3. Engine specs

### 3.1 ACID (`av_acid.js`, child A) — the emotional core

Structure (per note): DCO = minBLEP saw and minBLEP square at the same phase, LINEAR blend by
`acid.wave`; 4-pole ladder filter tuned to the T2 C/2-cap transfer `H_tb(s) = −1/(s⁴+6.727s³+14.142s²
+9.514s+1)` (TPT/ZDF form, tanh feedback drive), 2× oversampled with the pinned 4+4 halfband coeffs
(copy the values from av_dsp HB_A/HB_B — exact numbers in that file); env = MEG (decay-driven).
Accent = FOUR simultaneous changes (amp boost · cutoff boost · resonance emphasis · MEG decay forced
~200 ms) + sweep-capacitor memory: engine-level `cap` rises on each accent and decays over time —
CONSECUTIVE ACCENTS MUST RISE (the non-negotiable numeric). Accent trigger in P2: velocity ≥ 0.8
(sequencer lane comes at P4). Slide: legato overlap (new note while one is held) glides over
`acid.slide` seconds. Polyphonic at the voice level; mono behavior is play style for now.

Params (`acid.`): `wave` 0..1 · `cutoff` 20..20000 (log) · `reso` 0..1 · `envMod` 0..1 · `decay`
0.03..3 · `accent` 0..1 · `volume` 0..1 · `slide` 0.06..0.36 · EXPANDED: `accentDecay` 0.03..3 ·
`veg` 0.016..3 · `filterTrack` 0..1 · `overdrive` 1..66.6 (log) · `muffler` 0..1 · `sweep` −2..2
(oct, continuous) · `softAttack` 0.0003..0.03 · `accentMode` 0|1|2.

Node harness (scratch) must produce: T1 self-oscillation check (max reso, resonance peak near
cutoff); T2 accent step (accented vs plain: amplitude + spectral-centroid jump; MEG settles
150–250 ms); **T3 accent-memory rise** (≥3 consecutive accents at fixed spacing → measured accent
depth STRICTLY rises); T4 slide (~60 ms midpoint crossing ±40%); T5 saw slope ≈ −6 dB/oct ±2 over
200 Hz–4 kHz. Extract exact methodology/numbers from T2 with line refs; deviations documented.
Render set for the owner pass: 3 WAVs (acid line, accent demo, slide demo) → scratch, parent copies.

### 3.2 STRING (`av_string.js`, child B)

Karplus-Strong: delay `N = fs/f0` with allpass fractional interpolation, one-pole damping loop
filter, pluck-position comb injection (20–40%), exciter options, tuning compensation for loop phase
delay. Runs at base rate; cheapest voice class. Seeded per-note humanisation (PRNG via the engine
rng — use `eng.rng` through an injected helper; see av_dsp prngU32 pattern). Params (`string.`):
`damp` 0..1 · `decay` 0..1 · `pluck` 0.05..0.95 · `exciter` 'noise'|'saw'|'pulse' · `tone` 0..1.
Harness: f0 accuracy ±0.5 % at C2/C3/C4/A4/C6 (autocorrelation); decay monotonic in `decay`; no NaN;
alloc-free render; determinism pair.

### 3.3 DRUM (`av_drum.js` + `av_pads.js`, child C)

Kit (11 voices, expand PF's kit read-only): kick · snare · rim · clap · closed-hat (`ch`) · open-hat
(`oh`) · low-tom (`lt`) · mid-tom (`mt`) · high-tom (`ht`) · crash · ride. MIDI map (pin): 36 kick ·
38 snare · 39 clap · 37 rim · 42 ch · 46 oh · 45 lt · 47 mt · 50 ht · 49 crash · 51 ride. Per-voice
params (`drum.<voice>.`): `tune` −12..12 st · `decay` 0.02..2 s · `level` 0..1. Global (`drum.`):
`split` 0..127 (0 = off → all notes drum when kind 3; >0 → notes < split drum, ≥ split VA) ·
`volume` 0..1. One-shots: releaseVoice = no-op; `isVoiceDone` after the tail; voices are cheap
synthesis (osc+env / noise+env / metallic clusters — port structure from PF, expand each with the
three params; clean-room your own code, PF is ours).
`av_pads.js`: 4×4 pads grid into a host element (`#av-pads-host`), pads fire the note bus
(`avNoteDown`/`avNoteUp`) with the MIDI map above (page 1: the 16 map notes incl. unused slots
disabled/labelled); velocity from click position (vertical); kit label per pad; CSS classes returned
in the report. Harness (scratch): every voice renders finite, peak in (0,1.5], decays to done ≤ 3 s,
determinism; map complete.

### 3.4 LADDER + overdrive (`av_ladder.js`, child G)

Moog-ladder kernel, Huovilainen-style nonlinear, 2×-safe: `AVLADDER` exposes a kernel operating on a
plain state object (`createState()` → preallocated Float64Array/fields; `process(state, x, g, k) ->
{y}`-free form: write into state, return y) + its 4-pole taps; stable to self-oscillation; math
lineage = MoogLadders (Unlicense) port + T5 §11 notes. Parent wires `filter.mode='ladder24'` (5th
enum value) + `filter.drive` (0..1 tanh pre-gain into BOTH filter modes). Harness: monotonic
self-osc near max reso, stability at 2×, THD behaviour sanity, no NaN across a sweep.

## 4. Sample core (`av_sample.js`, child D) — begins

- Buffer manager + registry: `avSampleStore` — import File/ArrayBuffer → `ctx.decodeAudioData`
  (main thread, honest) → entry {id, name, duration, sampleRate, channels, peaks(2×N min/max),
  buffer}. Keep ≤ 32 imports (RAM-honest), no persistence this wave (IDB = later).
- Waveform display: `avSampleDrawWaveform(canvas, entry)` — min/max columns, teal skin (class list
  returned), HiDPI-correct (canvas backing = CSS × dpr — OFAP law).
- Drag-in: a drop target region + file input fallback; also accept drags onto `#av-sample-host`.
- PREVIEW playback only: one-shot through the keys bus (`avKeysFor(ctx)`) via AudioBufferSourceNode —
  the in-engine sampler voice stays P3. Preview respects the master tap (rides the bus, never
  ctx.destination).
- Rig `verify/cdp_sample.mjs` (write only): generate a WAV in-page (e.g. 440 Hz + noise, known
  length) → simulate import (DataTransfer/drop or the file-input path) → decoded entry appears with
  correct duration/peaks; preview render captured by an OWN AnalyserNode on the master tap (witness
  law) is non-silent with the right dominant frequency; zero page errors; frozen sha before/after.

## 5. Recorder core (`av_rec.js`, child E) — tap → WAV

- Read `src/av_tap.js` first. Recorder rides the MASTER tap node: capture float chunks via a node
  that cannot disturb the chain (ScriptProcessor(4096, 2, 2) pass-through, silent by design — PF's
  recorder did this; port its approach, read-only).
- API: `avRecInit()`, `avRecStart()`, `avRecStop() -> {ok, seconds, bytes, blob}` (WAV 16-bit
  stereo; 44.1k default out rate by resampling decision documented — 48k native until export
  resample lands), `avRecStats() -> {recording, seconds}`. Blob → `URL.createObjectURL` + a
  download link (the UI host row is parent-added; return the class list).
- Rig `verify/cdp_rec.mjs` (write only): start → play a note 3 s → stop → WAV parses (RIFF header,
  correct length ±0.2 s, stereo 16-bit), RMS non-zero, silence when no note (control), page errors 0.

## 6. UI (`av_synth.js` extension, child F)

- ENGINE select at the top of the SYNTH card (`data-knob`-free `<select class="av-select">`):
  options va/acid/string/drum → `avApplyParam('engine.kind', v)`; persists via avParams mirror.
- Panels per kind: `va` = ALL current rows (unchanged); `acid` = its full knob set from §3.1 (16
  knobs incl. EXPANDED, grouped "MODS (EXPANDED)"); `string` = §3.2 (5 controls); `drum` = 11×3
  voice knobs (compact 3-column layout) + split/volume. Panel switching = show/hide sections
  (`avSynthSetKind(kind)` exported); defaults must equal the §specs. All controls ride the standard
  avKnob mechanics + `avApplyParam` (read av_synth.js + app_core.js idioms first).
- Return: the CSS class list needed (parent applies), the control inventory, and confirmation that
  the `?avtest=1` boot still renders (child cannot run it; parent will).

## 7. Rig & gate contracts (parent-run)

- P1 battery re-run on the frozen P2 bytes: smoke/feel/keys/midi; smoke checks gain: engine select
  present, kind switches (each kind accepted by setParam), pads host mounted, sample host mounted,
  rec host mounted; `?avtest=1` ENGINE SELFTEST extended: kind switch + one acid + one string + one
  drum param round-trip (parent adds these checks).
- New browser rigs: `cdp_sample.mjs` (D), `cdp_rec.mjs` (E) — written by children, RUN by parent
  (one browser at a time; freezer sha lines as usual).
- PERF GATE (docs/07 P·1): `cdp_bench.mjs` full + `cdp_stress.mjs` ×1 on the frozen bytes; deltas
  recorded vs 56734133 (128 @ 47.6 %, stress cold-start finding). No waves close without it.
- Owner A/B: acid render set (§3.1) + kit demo archived to `renders/` (small WAVs only).

## 8. Reports, laws, return format

Children return: `{files, version, interface: {exports, VOICE FIELDS, kext fields}, params: [...],
harness: {command, summary table, deviations[]}, css classes (F/C/D), notes}`. Raw evidence in
scratch (`cache/scratch/p2/<child>/`). Laws: no console windows; one writer per file; scratch never
in repo; licences (Open303 = MIT lineage — cite where used; MoogLadders = Unlicense); alloc-free
render; monomorphic; seeded determinism; if a test exposes an av_dsp-side need, REPORT it (parent
edits av_dsp, never the child).
