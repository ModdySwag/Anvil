# Anvil S1 wave — RECORD CORE: audio input · metronome + count-in · lap takes · Studio card (2026-10-07)

Trigger: P6 DELIVER closed (`877d4d35`; addendum 24). This wave = `docs/08` §1 **S1** (the studio's
record core): mic/line audio-in path, count-in + metronome, lap-takes recording, the Studio card.
S2 (takes/sessions polish, autosave #76, backup #52) and S3 (mix/master: sends, bus, master chain,
LUFS auto-mix) stay for the following waves.

## 0. Platform probe (parent-run, PASSED 2026-10-07 — headless Edge, `file://`, fake media devices)

Launched with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`, loaded the real
app, in-page probe (evidence: `verify/s1-media-probe-out.log`):

- `navigator.mediaDevices` present; **`isSecureContext === true` on file://**; `getUserMedia({audio})`
  resolves (auto-granted by the fake UI flag) — track = "Fake Default Audio Input" (kind audio, enabled).
- MediaStreamSource → ScriptProcessor(4096) capture, 1.11 s window: frames 53248, **nonzero 1934
  (≈3.6 % — the fake device is a BEEP TRAIN: mostly silence + periodic loud pips), peak 1.1298,
  rms 0.134**, ctx running, sr 48000.
- 3 audio inputs enumerate with labels after grant: "Fake Default Audio Input" · "Fake Audio Input 1" · "Fake Audio Input 2".

**Rig law from the probe: assert the beep train (peak > 0.05, nonzero > 1000 over a ≥ 2.5 s
window) — NEVER "continuous audio".**

## 1. Scope & file ownership (ONE writer per file)

| child | owns (write) | scratch |
|---|---|---|
| sa-A | `src/av_input.js` | `cache/scratch/s1/input/` |
| sa-B | `src/av_metro.js` | `cache/scratch/s1/metro/` |
| sa-C | `src/av_takes.js` · `verify/cdp_studio.mjs` (WRITE-ONLY rig, parent runs it) | `cache/scratch/s1/takes/` |
| sa-D | `src/av_studio_ui.js` | `cache/scratch/s1/ui/` |

Children never touch shared files (`build.py`, `src/body.html`, `src/styles.css`, `src/app_core.js`,
`verify/cdp_smoke.mjs`, other `src/*`) and never run the build, browsers, suites or git. Each
self-verifies with a node harness in its scratch (the rig above is write-only for sa-C).

## 2. Pinned interfaces

### 2.1 `av_input.js` (sa-A)

```js
avInputInit() -> boolean                 // idempotent; page module; nothing mounted
avInputEnable() -> Promise<{ ok, deviceId, label, channels, sampleRate } | { ok:false, error }>
avInputDisable() · avInputGain(v) 0..1.2 · avInputMonitor(on) -> boolean
avInputOffset(ms) -200..200 (default 0)  · avInputLatency() -> { baseMs, offsetMs, totalFrames, sr }
avInputLevels() -> { peak, rms }         // own AnalyserNode on the input gain, refreshed on call
avInputDevices() -> Promise<[{ deviceId, label }]>
avInputState() · avInputClasses() -> string[] · avInputNode() -> the live input gain node | null
```

- **ctx law:** the SAME AudioContext as the engine — `window.__avEngine.handle.ctx` (guarded) falling
  back to `avTap.ctx`; none found → honest refusal in `avInputEnable()`.
- `getUserMedia({audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false}})` →
  MediaStreamAudioSourceNode → **inputGain** (GainNode, default 1.0). Monitor OFF by default;
  monitor ON connects inputGain → `avMasterFor(ctx)`. Track-before-wire discipline (av_rec craft);
  idempotent enable/disable.
- **Recording tap point = inputGain output** (`avInputNode()`): post-gain, pre-master, DRY — the
  takes module records from this node.
- Sink law: any internal sink goes to `avTap.real` (guarded) else the REAL destination — never back
  into the bus chain.

### 2.2 `av_metro.js` (sa-B)

```js
avMetroInit() -> boolean · avMetroSet({ on, level, beatsPerBar, accent }) -> state
avMetroState() -> { on, level, bpm, beatsPerBar, originT, nextClickAt, clicks: [{ t, accent }] }
avMetroCountIn(bars) -> Promise<{ ok, bars, seconds }>   // 1..4 clamp; resolves at completion
avMetroClasses() -> string[]
```

- **Clock law:** own lookahead ticker (0.12 s lookahead / 25 ms wake — the seq law) against the live
  ctx. When the sequencer plays, PHASE-ALIGN: beat times = origin + k·beatDur with origin from
  `avSeqPosition()` (guarded) so clicks land ON the transport grid; standalone: own origin. Beat =
  60/bpm (`avState.bpm` guarded, 120 default); accent on beat 1 of `beatsPerBar`.
- **Click:** synthesized ping (oscillator; accent 1320 Hz / plain 880 Hz; ~25 ms exp decay) +
  gain (level) → `avMasterFor(ctx)` ONLY. Clicks never touch the takes path (takes record the input).
- `avMetroState().clicks` = a bounded ring (last 64) of PLANNED click times for rigs/UI.

### 2.3 `av_takes.js` (sa-C)

```js
avTakesInit() -> boolean · avTakesArm(on) · avTakesStart({ lapSync: boolean }) -> Promise<receipt>
avTakesStop() -> receipt · avTakesAbort()
avTakesList() -> [take-meta] · avTakesExport(id) -> Promise<{ ok, name, bytes, blob, url, wavInfo }>
avTakesDelete(id) · avTakesKeepLast(n) 0..32 (default 8, enforced on stop)
avTakesState() · avTakesClasses() -> string[] · window.__avTakes
```

- **Capture law:** ScriptProcessorNode(4096, ch, ch) riding `avInputNode()` (parallel branch:
  inputGain → sp → gain-0 sink → `avTap.real`); block-rate chunk copies (av_rec craft); no armed
  input → `{ok:false, error:'input not enabled'}`.
- **Lap law:** `lapSync` && `avSeqIsPlaying()` (guarded) && a snap via `avSeqSnap` → cycleDur =
  cycleSteps·stepDur (cycleSteps = longest track len ≥ 16 — the avSeqSchedCycleLen law; stepDur =
  60/bpm/4 (grid "16") or /3 ("8t") — PURE). The recorder auto-splits at cycle boundaries measured
  from record start in `avSeqSchedNow()` seconds; each completed cycle = one take (lap n); the
  final partial lap is kept and marked `partial:true`. No transport → one continuous take.
- **Take model:** `{ id:'t1'…, name:'Take 1', frames, rate, channels, lap, partial, offsetFrames
  (= avInputLatency().totalFrames at start, honest), startedCtxT, data:[Float32Array,…] }`. Mono
  sources export duplicated to stereo via `avWavEncode` (16-bit default; name
  `anvil_take<N>_lap<n>.wav`).
- Laws: allocations at block rate only; no DOM at load; never throws; honest refusals; `window.__avTakes` debug handle (no live nodes leak).

### 2.4 `av_studio_ui.js` (sa-D)

```js
avStudioUiInit() -> boolean   // mounts into #av-studio-host (absent → false, no throw; idempotent;
                              // dataset marker avStudioUiWired='1')
avStudioUiClasses() -> string[] · window.__avStudioUi { state(), … }
```

- Card (class prefix `av-studio-*`, reuse av-btn/av-note/av-dim/av-select):
  INPUT (ENABLE toggle → avInputEnable/Disable; device select refreshed on enable; GAIN + readout;
  MONITOR toggle; OFFSET ms number; level meter via rAF reading avInputLevels()) ·
  TRANSPORT (count-in select 0/1/2 bars; metronome toggle + LEVEL) ·
  TAKES (REC/STOP button orchestrating: count-in > 0 → `await avMetroCountIn(bars)` → `avTakesStart`;
  rows: name · seconds · lap · EXPORT · ✕; KEEP LAST select; status line; warnings area).
- Degraded module notes (typeof-guarded); no console noise.

### 2.5 Rig `verify/cdp_studio.mjs` (sa-C writes, parent runs)

Launch skeleton copied VERBATIM from `cdp_store.mjs` **PLUS
`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`**; `EXPECT_SHA` null until
pinned. Proofs:
1. boot + card mounted (#av-studio/#av-studio-host · `.av-studio` root · wired marker · REC + enable
   controls present · module globals live · window.__avStudioUi object).
2. input enable (fake device): ok · channels ≥ 1 · sr 48000 · **beep-train assert (§0): ≥ 2.5 s
   window, peak > 0.05, nonzero > 1000** · monitor default OFF · disable clean.
3. metronome: enable → planned-click ring ≥ 4 clicks, spacing = beat (60/bpm) ± 10 ms; audible
   witness: the RIG's own capture on `avMasterFor(ctx)` (guarded) shows ≥ 4 transients (peak > 0.02)
   in ~2 bars; OFF → none.
4. count-in: `avMetroCountIn(2)` resolves in 2 bars ± 150 ms with ≥ 8 clicks scheduled.
5. takes: start (lapSync false) → ~1.5 s → stop → frames ≈ 1.5·sr ± 2 blocks; take audio NON-SILENT
   (beeps); export → avWavInfo ok (16-bit, sr 48000) + blob/url; delete + keepLast enforcement.
6. lap split: rig pattern (16 steps @ 120 bpm → 2 s cycle), avSeqPlay, record ~2.5 cycles → ≥ 2
   takes, frames ≈ 2 s ± 0.15 s, lap numbering; avSeqStop + abort; transport left stopped.
7. zero page errors · screenshot `renders/s1-studio-suite.png` · freeze sha256 before === after.

## 3. Laws (wave-specific)

1. Input rides the ENGINE's ctx (same-context law); refusals honest when no ctx/device.
2. Monitor default OFF (feedback safety); clicks go to the master only; takes capture the input only.
3. Recording tap = avInputNode() output; sink = gain-0 → avTap.real (never into the bus).
4. Block-rate writes; one writer per file; 'use strict'; one namespace per file (avInput*/AV_INPUT_*,
   avMetro*, avTakes*, avStudioUi*); node-loadable (no DOM/browser reach at load; typeof-guarded).
5. Children self-verify with node harnesses (pure math + guarded paths); the browser rig is the
   parent's gate.

## 4. Parent integration (after children land)

ONE counted-assert script: `build.py` js_parts (av_input → av_metro → av_takes → av_studio_ui after
av_deliver_ui, before av_synth) · `body.html` `#av-studio` card + `#av-studio-host` after the
`#av-deliver` card (+ hero/footer copy) · styles block (child class lists, coverage-checked) ·
`app_core.js` guarded `avInputInit()`/`avMetroInit()`/`avTakesInit()`/`avStudioUiInit()` boots +
version `0.7.0` "S1 · record core" · `cdp_smoke.mjs` studio-card check (→ 18 checks) · rebuild →
node re-runs + `cdp_studio.mjs` first run (pin EXPECT_SHA; re-run) → FULL battery (re-pin to the new
sha) → PERF GATE (bench + stress; the record path adds no live-engine cost) → commits + addendum 25.

## 5. Watch items

- Fake-device beeps (§0) — never assert continuous audio anywhere.
- SPN deprecation: use it quietly (no console noise; the smoke zero-error contract).
- Take memory: cap a single take at 300 s (refuse beyond, honest); per-take Float32 arrays only.
- Lap boundaries: float math from avSeqSchedNow() deltas; tolerance ±0.15 s at 120 bpm.
- Boot order in app_core: input → metro → takes → ui (guarded, log fields).
- The rig must leave the page clean: input disabled, transport stopped, no recording left armed.

Carried: S2 sessions (#76 autosave/recovery, #52 backup) · S3 mix/master (sends #69, master chain
#70, LUFS auto-mix #49) · deck display (#15) · popout keyboard · CODE section (#81) · walkthrough/help
(#20/#45/#80) · max modules/racks · platform (share/cloud/PWA/FSA/bridges/video) · P7 polish + deploy
+ owner pass · P·2 minBLEP pass · P4 follow-ups · PERFECT TUNINGS (tuning engine).
