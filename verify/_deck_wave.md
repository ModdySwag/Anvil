# Anvil DECK wave — pro deck readouts (#15): oscilloscope · spectrum · spectrogram waterfall · LUFS/true-peak meters · voice/CPU readout · note ticker (2026-10-07)

Trigger: S3 MIX & MASTER closed (`859a897d`; addendum 28). Scope: `docs/07` #15 ("Deck displays —
oscilloscope, spectrum, spectrogram waterfall, LUFS/true-peak meters, voice/CPU governor readout,
MIDI monitor — all on the professional deck panel") + `docs/05` §2.7 ("pro deck display/readouts").
This wave also builds the capture surface that video capture (#83, an S4 deliver extra) will need.
Next after: S4 extras / platform wave (FSA #77 · share card #18 · video #83) · popout keyboard ·
CODE (#81) · walkthrough/help.

## 0. Platform notes (no probe required)

Every data source exists: `avMasterFor(ctx)` / `avMasterNodes()` (av_tap — meters attach to the MASTER
node; offline renders are NEVER registered live/metered), `av_loud` (LUFS/TP suite, S3), the engine's
live-ctx holder + the ~2 Hz voices sampler + the `stats()` RPC (av_engine), `avState.bpm`, and the ONE
`avNote` bus (poll-based reads — av_note stays untouched). Canvas + HiDPI discipline proven (av_sample
waveform). **Panel reads are UI witnesses only — the RIG owns its own AnalyserNode on the master tap
(house witness law).** No new platform capability.

## 1. Scope & file ownership (ONE writer per file)

| child | owns (write) | scratch |
|---|---|---|
| sa-A | `src/av_deck.js` — deck core: analyser attach · rings · pure math · the step engine · readouts | `cache/scratch/deck/core/` |
| sa-B | `src/av_deck_ui.js` — the DECK card (canvases · meters · readouts row · controls · rAF discipline) | `cache/scratch/deck/ui/` |
| sa-C | `verify/cdp_deck.mjs` — WRITE-ONLY rig (parent runs it) | `cache/scratch/deck/rig/` |

Children never touch shared files (`build.py`, `src/body.html`, `src/styles.css`, `src/app_core.js`,
`verify/cdp_smoke.mjs`, any other `src/*`) and never run the build, browsers, suites or git. Each
self-verifies with a node harness in its scratch. **Write-first rule:** the complete file goes to
disk FIRST, then iterate — partial progress must exist on disk at all times.

READ-ONLY references: `src/av_tap.js` (avMasterFor/avMasterNodes; the live registry; offline law) ·
`src/av_engine.js` (the live-ctx holder `avEngineLiveCtx` + its accessor, the voices sampler at
AV_ENGINE_CHIP_MS 500, the stats() RPC — REUSE, never add a second loop) · `src/av_loud.js`
(avLoudShortTerm/avLoudTruePeak — guarded) · `src/av_note.js` (`__lastNotePreview` / `__lastNoteCode`
/ `window.__avNotes()`) · `src/av_midi.js` (monitor conventions only) · `src/av_sample.js` (HiDPI
canvas pattern) · `verify/cdp_studio.mjs` (launch skeleton) · `verify/cdp_comp.mjs` (rig conventions).

## 2. Pinned interfaces

### 2.1 `av_deck.js` (sa-A) — the deck core (node-loadable; no DOM at load; no init-time browser reach)

```js
avDeckInit() -> boolean                  // state + rings + all preallocation; idempotent
avDeckAttach() -> { ok, ctx, rate, fft } // LIVE ctx ONLY — resolve via the engine facade (read
                                         // av_engine.js for the exact accessor; fallback avTap.live);
                                         // NEVER create a new AudioContext; honest refusal otherwise
avDeckDetach() -> boolean
avDeckStep() -> { at, frames, attached, voices, notesSeen }   // ONE synchronous update pass — THE
                                         // test seam (the rig steps it; the card's rAF calls it)
avDeckFrame(kind) -> plain object        // 'scope' · 'spectrum' · 'waterfall' · 'meters' · 'gain'
avDeckReadouts() -> { bpm, grid, voices, maxVoices, tier, ctxState, cpuMs, cpuAvgMs, notesSeen,
                      lastNote, fps }
avDeckSetView(kind, patch) -> { ok, view }   // run(bool) · freeze(bool) · dbFloor(-90..-20) ·
                                             // waterfallMs(40..250)
avDeckClasses() -> []
window.__avDeck = { version, init, attach, detach, step, frame, readouts, setView, snapshot, pure }
```

- **Frames (pinned shapes):** scope `{ ready, n, min[], max[] }` (480-pt min/max envelope of the
  time-domain pull); spectrum `{ ready, bands: Float32Array(96), peakBand, peakHz }` (log bands
  20 Hz–20 kHz mapped from the analyser's linear FFT bins); waterfall `{ ready, rows, latestRow,
  rowMs }` (96-row ring of the 96 bands); meters `{ lufsShort|null, dbtp|null, peakDb|null,
  energyDb|null }`; gain `{ l, r, peak }` (time-domain levels for the strip).
- **`pure` surface (rig-verified math):** `hzToBand(hz)`, `bandToHz(i)`, `bandCount()`,
  `logBandPlan(sr, fftSize, count)` (band edges), `dbOfAmp(v)`, `holdDecay(prev, cur, up, down)`
  (peak-hold decay law), `meterNorm(db, floor, top)` (0..1 bar mapping).
- **Step law:** allocation-free; when not attached it still advances counters + readouts honestly
  (`attached:false`, null meters); when attached it pulls one scope slice + spectrum per step and
  pushes waterfall rows at most every `waterfallMs`; LUFS/TP recompute at most every ~500 ms via
  `av_loud` on bounded rings (3 s stereo + 1 s TP ring; guarded — null when av_loud absent).
- **Freeze law:** freeze holds PRESENTED frames (rings do not advance while frozen); counters
  (notesSeen, cpu) keep running. Unfreeze resumes.
- **Voices source:** reuse the engine's existing sampler/accessor (child reads av_engine.js; document
  the exact call in the report; never add a second RPC loop; tolerant nulls when the engine is absent).
- **Note ticker:** poll the avNote bus each step (`__lastNotePreview` / `__lastNoteCode` /
  `__avNotes()`); `notesSeen` counts transitions; `lastNote` = { name, vel, at } | null.
- **Offline law:** offline contexts are never attached (the tap never registers them); no new
  AudioContext anywhere in this wave.

### 2.2 `av_deck_ui.js` (sa-B) — the DECK card

```js
avDeckUiInit() -> boolean     // mounts into #av-deck-host (absent -> false, no throw; idempotent;
                              // dataset marker avDeckUiWired='1')
avDeckUiClasses() -> string[] · avDeckUiSync() -> boolean · avDeckUiSnap() -> {...}
window.__avDeckUi = { state, sync, step }   // step() = forced step + full draw (the rig's driver)
```

- Layout (class prefix `av-deck-*`, house tokens/buttons/selects): canvases `av-deck-scope`,
  `av-deck-spectrum`, `av-deck-waterfall` (HiDPI, devicePixelRatio-scaled, crisp 1px grid, teal
  palette), a meter block (LUFS + TRUE PEAK bars via `meterNorm`, gain strip L/R/peak), and a
  readouts row: BPM · VOICES n/max · TIER · CTX · CPU ms · NOTES · last note.
- Controls: RUN/PAUSE toggle, FREEZE toggle, DB FLOOR select (-90/-60/-40/-20), WATERFALL rate
  select (60/120/240 ms).
- **rAF discipline:** the loop runs only when (visible ∩ !paused ∩ !document.hidden); a step gate
  targets ~30 fps; when idle it early-exits (cheap guard, the seq-loop precedent). All drawing goes
  through `__avDeckUi.step()` so the rig never depends on rAF timing.
- Honest degraded note when av_deck is absent; no console noise; never touches the engine directly.

### 2.3 Rig `verify/cdp_deck.mjs` (sa-C writes; parent runs)

Launch skeleton VERBATIM from `cdp_studio.mjs`; `EXPECT_SHA` null until pinned. Proofs (~30–36):
1. boot + card mounted (#av-deck + #av-deck-host · root · wired · canvases present) + module surface
   (avDeck* + avDeckUi* + window handles; avDeckInit() true).
2. attach: ok on the live ctx; `avDeckStep()` advances `frames`; frames() shapes valid (bands length
   96 · scope n 480 · meters present or null-honest).
3. silence vs note (page-side canvas digests — getImageData nonBlack frac + sums; Float32/bytes never
   cross CDP): silence baseline low; `avNoteDown('c4')` + step × 8 → scope digest rises; spectrum
   `peakBand` ≈ `pure.hzToBand(261.6256)` ± 3.
4. waterfall: rows advance over steps; row content changes while playing (digest of the waterfall
   canvas before vs after).
5. meters: sustained loud note → `lufsShort` finite and above the silent reading; `dbtp >= peakDb`;
   stop → `energyDb` decays across steps.
6. voices: play 6 notes → readout voices > 0 and ≤ max (tolerant, chip cadence); all released →
   returns to 0 within a bounded step/poll window.
7. freeze: FREEZE on + playing → two canvas digests identical across steps; unfreeze + new note →
   digests differ. PAUSE: same no-change law; resume restores.
8. bpm readout: `avApplyParam('bpm',140)` → readout 140 (restore after).
9. **witness law:** the rig attaches its OWN AnalyserNode to `avMasterFor(ctx)` — time-domain energy
   during the note > silence floor (the panel is not the witness; restored after).
10. zero page errors · screenshot `renders/deck-suite.png` · freeze sha256 before === after · cleanup
    (notes off, deck detached/paused, bpm restored, transport stopped).

## 3. Laws (wave-specific)

1. One writer per file; 'use strict'; classic script; ONE namespace per file (`avDeck*`/`AV_DECK_*`;
   sa-B owns `avDeckUi*`); node-loadable (zero DOM at load; guarded `typeof window` probe at the end).
2. NEVER throw (honest refusals, counted skips); no console noise; no new AudioContext; offline
   contexts excluded from the deck.
3. The rig's steps are SYNCHRONOUS and deterministic — never depend on rAF timing in checks.
4. Panel reads are not witnesses: the rig owns its analyser.
5. Rings/all buffers preallocated in init; step() allocation-free; canvas draws re-use paths where
   the house patterns do.
6. av_tap / av_engine / av_note / av_midi stay READ-ONLY this wave (no API additions).
7. Children self-verify with node harnesses (module texts loaded into one `new Function` scope — the
   p3/p4 harness pattern; DOM-free paths only); the browser rig is the parent's gate.

## 4. Parent integration (after children land)

ONE counted-assert script (`cache/scratch/deck/integrate/_deck_integrate.py`): build.py js_parts
(`av_deck` → `av_deck_ui` after `av_mix_ui`, before `av_synth`) · body `#av-deck` card + `#av-deck-host`
after `#av-mix` (+ hero/footer copy) · styles block (class list coverage-checked) · app_core
**1.1.0 "DECK · pro readouts"** + guarded `avDeckInit()`/`avDeckUiInit()` boots + log fields ·
`cdp_smoke.mjs` deck-card check (**→ 22**). Then: rebuild → node re-runs + `cdp_deck.mjs` first run
(pin EXPECT_SHA; re-run) → FULL battery (15 suites; re-pin every freeze file) → PERF GATE (bench +
stress ×2, hidden-detached + marker polling; offline renders are untouched by the deck — bench must
read within variance of the S3 record) → commits + addendum 29 + README + mnemosyne.

## 5. Watch items

- Voices accessor: read av_engine.js and reuse its existing sampler (document the call); tolerant
  nulls when the engine is absent or the tier is SPN.
- Headless rAF can be lazy — the rig drives `avDeckStep()` / `__avDeckUi.step()` directly.
- Canvas readback: page-side getImageData digests only; never ship pixel arrays over CDP.
- Freeze semantics are pinned (rings hold; counters keep); the rig asserts exactly that.
- LUFS rings: bounded (3 s stereo + 1 s TP ≈ ~1 MB) — pull rate ≤ 2 Hz; guard av_loud absence.
- The deck must not wake hidden tabs (visibility-gated loop) and must not add idle CPU when paused.
- One note ticker source (the ONE avNote bus) — do not invent a second note path.

Carried: S4 extras / platform wave (FSA #77 · share card #18 · video #83 — the deck is its capture
surface) · popout keyboard · CODE (#81) · walkthrough/help (#20/#45/#80) · max modules · P·2 minBLEP
pass · P4 follow-ups · PERFECT TUNINGS · optional quiet-window bench re-runs. Resume phrase:
**"continue anvil"**.
