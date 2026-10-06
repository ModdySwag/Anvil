# T5 — Web-audio engine: runtime matrix, voice-budget math, algorithm specs, FX math, library shortlist, verification protocol

Anvil research · engine folder · written 2026-10-06 by the T5 research subagent (Hermes).
Reads before writing: `C:\Users\Moddy\pattern-forge\annex\01-surge-dsp-portability.md`, `annex/04-plugin-ecosystem.md`, `C:\Users\Moddy\moddys-music-suite\research\synths\S4-surge-xt.md` (effect-count correction **31, not 37** is applied throughout), and the seed tabs (`anvil/research/tabs/raw/`, digest `T0-tab-digest.md`).

Method: browser-support data from MDN browser-compat-data (`main`, fetched 2026-10-06) and caniuse-db feature JSONs; spec quotes from `webaudio.github.io/web-audio-api`; licences read from the actual `LICENSE*` files / `package.json` / npm registry metadata on 2026-10-06; two original measurement runs on this machine (Windows, **HeadlessChrome/145.0.0.0** [measured]) — a live WASM SIMD resonator benchmark and a numpy DSP measurement script (wavetable interpolation + PolyBLEP alias floors). Numbers I could not read from a primary source are tagged **(verify)**. Nothing here was copied from CC BY-NC-SA dittytoy code — the ditty sources are used as technique evidence only.

---

### 1. Runtime matrix A — AudioWorklet availability, the `file://` truth, and the fallback tier

- Links: `https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/AudioWorklet.json` · `.../AudioWorkletNode.json` · `https://webaudio.github.io/web-audio-api/` · local `pattern-forge/annex/04-plugin-ecosystem.md` §0.
- Core contribution: the minimum-viable platform floor and the one architectural constraint that shapes the whole engine (worklet vs node-graph tiers).
- KEY FACTS (MDN BCD, fetched 2026-10-06):
  - `AudioWorklet` / `AudioWorkletNode`: **Chrome 66, Edge (Chromium mirror), Firefox 76, Safari 14.1** (iOS Safari = mirror). Everything we target in 2026 clears this floor with years of headroom.
  - Chrome note (BCD, `AudioContext` ctor): *"Before Chrome 66, each tab is limited to 6 audio contexts"* — irrelevant now but worth knowing for multi-context designs (e.g. per-track OfflineAudioContext renders).
  - Safari note (BCD): *"New audio contexts are suspended until the `resume()` method is called via user action"* — the first run needs one click; design the start screen around it.
  - Local probe [measured]: `typeof AudioWorkletNode === "function"` on HeadlessChrome 145 (Windows).
  - `file://` reality (verified in annex/04 §0, kept because it decides the FX tier): `audioWorklet.addModule()` is a **module fetch** — same-origin, CORS-checked. `blob:` URLs from a `file:` page have an opaque origin and are **refused by Chrome and WebKit** (Firefox is lenient); `data:` URIs are reported to work in Chrome but are not a cross-browser guarantee. So a single-file/f`file://` build cannot rely on worklets.
  - Consequence: `ScriptProcessorNode` remains the only universally working in-page fallback; deprecated but shipped everywhere. Its cost: runs on the main thread → treat as a degraded mode with a lower voice cap.
- **Fold-in verdict:** **ADOPT** a two-tier engine: (a) hosted build = AudioWorklet-first (this is the flagship), (b) single-file build = node-graph + ScriptProcessorNode fallback for the same DSP kernels. Write every DSP kernel as a plain function over `Float32Array` so both tiers execute identical math. Home: engine architecture / build plan stage 1.

### 2. Runtime matrix B — render quantum, latency model, channel counts

- Links: `https://webaudio.github.io/web-audio-api/` (§"Render Quantum", §"AudioContext") · `https://developer.chrome.com/blog/audio-worklet-design-pattern/` · `https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext` · BCD `api/AudioContext.json`.
- Core contribution: the timing budget every voice decision must fit inside; the latency knobs we can expose.
- KEY FACTS:
  - Spec: `currentFrame` *"is incremented by 128 (the size of a render quantum) after the processing of each audio block"* — **128 frames is the block size** (WebAudio 1.1 draft; the "128-frame constant" is stable across browsers (verify that no browser exposes a different quantum; Chromium may render the graph in larger chunks internally — Casey Primozic's tracing shows Chrome pulls **512** samples per `AudioDestination` render [measured-by-author]).
  - Budget per quantum: 128/44100 = **2902.5 µs** @44.1k, 128/48000 = **2666.7 µs** @48k [computed]. Chrome's own design-pattern article says it bluntly: *"the timing budget for the stable audio stream is quite demanding: it is only 3 ms at the sample rate of 44.1Khz."*
  - `latencyHint` (MDN, verbatim-ish): `"interactive"` (**default**) = lowest latency that doesn't glitch; `"balanced"`; `"playback"`; or a double = preferred maximum latency in seconds. Read back `baseLatency` (Chrome 58 / FF 70 / Safari 14.1) and `outputLatency` (Chrome 102 / FF 70 / **Safari 18.4** — Safari gained it late). Local [measured]: default context on this Windows machine reports `baseLatency = 0.01 s` at 48000 Hz, state suspended until gesture.
  - Channels: the spec requires implementations to *"support at least 32 channels"* (statement attached to AudioBuffer options) — far above our needs; `AudioWorkletNode` takes `outputChannelCount` in its constructor options (per spec; per-browser edge behaviour (verify), especially Safari).
- **Fold-in verdict:** **ADOPT**: engine processes in fixed **128-frame quanta** internally; every cost number in this file is expressed per-128-frame-quantum and per-sample so it survives a quantum-size change. Use `latencyHint='interactive'` for the instrument context; show measured `baseLatency`/`outputLatency` in a diagnostics panel. Home: engine core loop + QA.

### 3. Runtime matrix C — SharedArrayBuffer / cross-origin isolation, WASM threads, WASM SIMD

- Links: caniuse-db `sharedarraybuffer.json`, `wasm-simd.json`, `wasm-threads.json` (fetched 2026-10-06) · BCD `javascript/builtins/SharedArrayBuffer.json` · local probe.
- Core contribution: what a *threaded/high-throughput* engine tier requires, and what it costs to enable.
- KEY FACTS:
  - `SharedArrayBuffer`: Chrome 68, Firefox 79, Safari 15.2 — **all currently gated behind cross-origin isolation** (caniuse note: *"Requires cross-origin isolation by having Cross-Origin-Embedder-Policy (COEP)..."*, status `y #3` on every current browser). History note in the same dataset: SAB was disabled across browsers in Jan 2018 (Spectre/Meltdown).
  - Local probe [measured]: on a normal (non-COI) page, HeadlessChrome 145 reports `typeof SharedArrayBuffer === "undefined"` and `crossOriginIsolated === false`. This is exactly the gate the hosted build must consciously pass by serving `COOP: same-origin` + `COEP: require-corp` (or `credentialless` (verify support across the 2026 matrix)).
  - WASM threads: Chrome 74, Firefox 79, Safari 14.1 (caniuse) — practical requirement = SAB = COI.
  - WASM SIMD: **Chrome 91, Firefox 89, Safari 16.4**; `WebAssembly.validate()` of an i8x16 module returns `true` on the local Chrome 145 [measured]. SIMD is the page's default target in 2026; keep a scalar fallback build for old Safari ≤16.3.
  - Pattern proven by others: SuperSonic (scsynth-in-worklet) ships **dual transport** — *"SharedArrayBuffer for performance, postMessage for zero-config CDN deployment"* (README, fetched 2026-10-06) — i.e. the engine runs in both modes; COI is an optimisation, not a dependency.
- **Fold-in verdict:** **ADOPT**: (1) ship the engine in plain worklet + postMessage mode as the baseline (works on any static host); (2) enable COI on moddys.net hosting to unlock SAB for the 60 Hz UI→audio parameter feed and optional worker-side scheduling; (3) compile WASM with SIMD when we go WASM, scalar fallback otherwise. Home: engine architecture + deploy plan (cloud-deploy-dns headers).

### 4. Sample-rate strategy — device rate live, chosen rate offline

- Links: MDN `AudioContext()` ctor text · `https://chromestatus.com/feature/5136778254090240` (AudioContextOptions.sampleRate, Chrome 74) · `https://issues.chromium.org/issues/40944208`.
- Core contribution: decide once whether the engine is a 44.1 kHz engine or a device-rate engine.
- KEY FACTS:
  - MDN: if `sampleRate` is omitted *"the new context's output device's preferred sample rate is used by default"*; older MDN text claimed 44.1 kHz is "most common". Local [measured]: 48000 Hz on this Windows machine. Chromium issue 40944208 (2023): even when a `sampleRate` is specified, *"eventually the graph output is resampled to the device output sample rate"* — i.e. you may pay a resample at the output anyway (verify current behaviour; the issue text says lower layers can resample more efficiently).
  - Implication: running the live context at the device rate avoids an extra output resample; but any fixed-rate assumption inside DSP (table sizes, delay line lengths in samples, tuning maps) breaks cross-device.
- **Fold-in verdict:** **ADOPT device-rate live rendering**, with **all DSP expressed in frequency ratios** (`f/fs`), never in absolute Hz-samples. Offline render (`OfflineAudioContext`) selects the export rate explicitly: **44100 for WAV/MP3-family deliverables, 48000 for video/DAW-aligned work**. QA: the verification battery (entry 19) must pass at both 44.1k and 48k. Home: engine contract + export pipeline.

### 5. Execution architecture — workers + one mixer worklet (the dittytoy model, hardened)

- Links: local `research/tabs/raw/dt_syntax.txt` (lines ~337–593: worker-per-loop, shared filters, optimization section) · `research/tabs/T0-tab-digest.md` §2 (parent-verified) · `https://developer.chrome.com/blog/audio-worklet-design-pattern/` · `https://cprimozic.ameo.dev/blog/webaudio-audioworklet-optimization/` · SuperSonic README (`github.com/samaaron/supersonic`).
- Core contribution: the proven division of labour between threads, plus the single biggest AudioWorklet performance trap found in the field.
- KEY FACTS:
  - Dittytoy (T0 digest + raw syntax text): each `loop` runs in its **own Web Worker** (parallelism; globals captured per loop); filters can run in their own worker via `createShared()`; **one AudioWorklet mixes the graph**; buffers pass via MessageChannel transfer; MP3 export is itself a worker (LAME); OffscreenCanvas workers power visualizers/probes; system optimizes by "spread synths over several loops". Dittytoy's own docs: *"CPU will always be a limiting factor when you want to execute javascript 44100 times per second in the browser."*
  - Chrome design pattern (Ho Choi): WASM is the intended companion; goals (a) reuse C/C++ DSP, (b) **avoid JS JIT and GC in the audio thread** — *"Even a slight hiccup ... can cause glitches."*
  - Casey Primozic's traced pitfall (2020, still the canonical writeup): per-`AudioWorkletProcessor` overhead scales with the number of **a-rate parameters**; his wavetable synth ran 16 processors → `AudioWorkletHandler::Process` called **5,504 times/second**; cutting a-rate params from 544 to 96 (34→6 per node) cut the parent process call from ~0.055 ms to ~0.025 ms and total `RequestRender` from 5.936 ms to 2.311 ms.
  - OffscreenCanvas (BCD): Chrome 69, Firefox 105, **Safari 16.4** (2D contexts first; caniuse's first-green for Safari is 17.0 — WebGL-in-worker later (verify)); local Chrome 145 has it [measured]. Transfer with `transferControlToOffscreen()` — we already know this pattern from the visualizer culture of the family.
- **Fold-in verdict:** **ADOPT**: exactly **one mixer AudioWorklet per engine instance** (all voices inside), **workers for non-realtime work** (wavetable/mipmap builds, IR generation, FFT analysis, pack decode), SAB ring-buffers for UI→audio parameter feed when COI is available, postMessage otherwise; visualizers on OffscreenCanvas workers with a throttled data bridge. Hard rule from Casey: **keep a-rate worklet parameters in single digits per node; prefer k-rate + engine-side modulation.** Home: engine architecture.

### 6. Real voice-budget measurements — what a browser actually delivers

- Links: Roma, *"Comparing approaches for new AudioWorklets"*, WAC-2022, `https://zenodo.org/records/6767468/files/WAC_2022_paper_46.pdf` · `https://raw.githubusercontent.com/wiki/jackschaedler/karplus-stress-tester/Home.md` · `https://jhartquist.github.io/resonators/bench/` (run live) · `https://github.com/nodetool-ai/nodetool/pull/3638` (measurement table) · Casey's blog (entry 5).
- Core contribution: the calibration set for "how many voices" — real numbers from real engines, to be confirmed by our own bench (entry 7).
- KEY FACTS:
  - **WAC-2022 (Roma, Leeds Trinity)** — measured on M1 Pro MacBook, Firefox 99 vs Chrome 100, max number of worklets before the reference oscillator distorts (step quantised to 50): JS is ~native in **Firefox**, native nodes win in Chrome; **buffer-based calls always beat per-sample WASM calls**; AssemblyScript worse than both JS and C++/Emscripten; conclusion: *"Emscripten / C++ using a buffer seems to be the safest bet for WebAssembly"*; *"JavaScript still holds promise for AudioWorklets, provided that garbage collection is avoided."* (Absolute counts live in Figs 5–7 (verify by consulting the figures if a hard number is needed).)
  - **karplus-stress-tester wiki (28 May 2020, MacBookAir, FF Nightly 78 / Chrome 83)**: with 100 strings/worklet + SAB + visualization on: **1,000 Karplus-Strong strings in plain JS**, **2,000 in Rust/WASM** (Firefox, glitch-free; WASM ≈ 2× JS). MessagePort for continuous data glitches *"far before you run out of DSP capacity"*; SAB removes it. Scale-relevant: each string here is a full pitched DSP voice (delay line + damping + noise exciter) — our per-voice costs are heavier, multiply accordingly. (2020 hardware; re-baseline locally (verify).)
  - **resonators WASM bench [measured live 2026-10-06, HeadlessChrome 145, Windows]**: bank of N=88/264/440/880 log-spaced SVF-style resonators, 48 kHz, mean of 20 iterations after warmup: **79 / 200 / 312 / 763 ns per sample → 10 / 26 / 40 / 98 µs per 128-frame quantum = 0.38% / 0.96% / 1.50% / 3.66% of the 2,667 µs budget**. SIMD: yes. (≈0.87 ns per resonator per sample ≈ 1.15 GHz resonator-update rate on this machine.) Repo licence: Apache-2.0.
  - **nodetool PR #3638 (2026)**: browser synth pipeline, 32 voices / 60 s: main-thread CPU 14.1% → 2.1%; complex modular patch ceiling: *"1,199 streaming nodes hold 0.999 realtime ... saturation begins between 1,200 and 2,400 nodes — CPU-bound, memory stays flat."*
  - Chrome-side per-call costs (Casey): each AWP `Process` call ≈ 0.013–0.055 ms with modest param counts — the multiplier to watch when deciding how many worklet nodes the engine has.
- **Fold-in verdict:** **ADOPT as the calibration band**: a well-built 2026 browser synth should hold **dozens of native voices per core** (unison-rich, filter+mod), with WASM giving ~2× and SIMD more; per-CPU voice counts are *not* the risk — **GC-free code and node/param hygiene are**. Targets to verify with our bench: ≥32 voices flagship desktop, ≥16 mid, ≥8 on iPad (verify). Home: engine budget + QA gates.

### 7. Budget math — per-primitive op counts, voice table, and the proof-benchmark protocol

- Links: derived here; anchors from entries 6 + 2; Pattern Forge `verify/cdp_stress.mjs` (culture template).
- Core contribution: the arithmetic that converts "how many ops does a voice cost" into "how many voices fit", plus the exact bench to replace assumptions with measurements before we commit to a voice count.
- THE MATH (mult+add counted as 1 flop each; per sample; all our own derivation — treat op counts as estimates, tag (verify) against the real kernels):
  - one-pole LP: 2 · RBJ biquad DF2T: 9 · **TPT SVF (Cytomic, 5-op form): 12** · PolyBLEP saw: ~8 · FM 2-op (sin table + env): ~12 · wavetable read: linear ~10, cubic4 ~24, sinc8 ~34.
  - Composite voices (estimates): **light voice** (2 osc + SVF + 2 env + amp) ≈ **150 flops/sample**; **fat voice** (+3× unison + 2nd filter + drift + mod matrix) ≈ **320 flops/sample**.
  - Budget arithmetic [computed]: at 44.1 kHz a core running `X` GFLOP/s of scalar DSP can afford `X·1e9/44100` flops per audio sample. **With a 50% safety ceiling:**
    | throughput assumption | budget/audio-sample | voices @150 flops | voices @320 flops |
    |---|---|---|---|
    | JS scalar 1 GFLOP/s (conservative; verify) | 22,676 | **75** | **35** |
    | JS/WASM scalar 3 GFLOP/s (verify) | 68,027 | **226** | **106** |
    | WASM SIMD 8 GFLOP/s (verify) | 181,406 | **604** | **283** |
  - Reality check against entry 6: those table numbers are the *ceiling*; measured engines land well inside them because of graph overhead, modulation, FX and GC (the resonators bench shows 880 full filters at 3.66% budget — i.e. filter work is cheap; the expensive parts are architecture mistakes).
- **PROOF-BENCHMARK PROTOCOL (run before committing to a voice count; replaces every (verify) above with local data):**
  1. Build a bench page that loads the real engine, plays a **fixed test patch** (2 osc + filter + 2 env + amp; then a "fat" variant) via `noteOn` at steady state, and measures **inside the worklet**: wrap `process()` in `performance.now()` timers, keep a 256-quantum ring of durations, report mean/p95/max µs per quantum (same pattern as the DTLN worklet bench (verify) — `performance.now()` availability inside `AudioWorkletGlobalScope` must be confirmed per browser).
  2. **Voice ramp**: raise the active voice count geometrically (1,2,4,8,16,24,32,48,64…) with a sustain patch; at each step hold 10 s and read the worklet ring; find `max_voices_stable` = last count with p95 load < 50% of the 2,667 µs budget and **zero underruns**; repeat ×3, take the min.
  3. Count underruns two ways: worklet-side overrun counter (duration > budget) + output-side discontinuity detector (analyser callbacks).
  4. Repeat on the target matrix: Windows Chrome/Edge, macOS Chrome+Safari, Firefox, and one iPad Safari (verify iPad availability); JS build and WASM build; document per-platform voice caps.
  5. Only then set the shipped **polyphony limit** per platform tier (the pattern already used in Pattern Forge: *maxVoicesNow()/profile switches*).
- **Fold-in verdict:** **ADOPT** — this protocol is a hard gate before the voice-count promise goes in the design doc. Home: engine spec §performance + build plan stage 1 exit criteria.

### 8. Anti-aliased oscillator math — PolyBLEP equations and minBLEP tradeoffs

- Links: `https://www.martin-finke.de/articles/audio-plugins-018-polyblep-oscillator/` (verified live) · Valimäki & Huovilainen, *Antialiasing oscillators in subtractive synthesis*, IEEE Signal Processing Magazine 24(2):116–125, 2007 (via WAC-2022 references) · `https://www.cs.cmu.edu/~eli/papers/icmc01-hardsync.pdf` (Brandt, *Hard Sync Without Aliasing*, ICMC 2001 — verified live) · annex/01 §6 (Surge's BLIT machinery).
- Core contribution: the oscillator AA toolkit — the exact polynomial, and when the table variant earns its keep.
- THE MATH — two-point PolyBLEP (verbatim from the WAC-2022 paper's Figure 1, which implements the standard form):
  ```
  polyblep(t, dt):
    if t < dt:  t /= dt;                  return 2*((t - t*t/2 - 0.5))
    elif t > 1-dt: t = (t-1)/dt;          return 2*((t*t/2 + t + 0.5))
    else: 0
  saw(n) = (2*phase - 1) - polyblep(phase, increment)      # then phase += increment
  ```
  Square = naive pulse − polyblep(t) + polyblep((t+0.5) mod 1); triangle = integrate band-limited square (or BLAMP terms (verify)).
- Measured alias floor on this machine [measured 2026-10-06, numpy, 48 kHz, 65,536-pt Blackman FFT, non-integer ratios so aliases don't hide on harmonics] — worst non-harmonic spur relative to carrier:
  | f0 | naive saw | PolyBLEP saw |
  |---|---|---|
  | 97 Hz | −47.1 dBc | **−55.1 dBc** |
  | 997 Hz | −27.7 dBc | **−36.3 dBc** |
  | 3011 Hz | −18.2 dBc | **−26.0 dBc** |
  | 5003 Hz | −13.9 dBc | **−22.2 dBc** |
  Reading: PolyBLEP buys ~8–12 dB and is essentially free (~8 flops), but it does **not** deliver a pro floor above ~1 kHz pitch by itself → **2× oversampling (entry 10) is mandatory for the PolyBLEP family**, and for sync/reset-heavy sounds prefer minBLEP/BLIT.
- minBLEP tradeoffs (Brandt 2001; Surge's BLIT as the industrial variant in annex/01 §6): precompute a windowed-sinc step response table (Surge: 12-tap, 256 sub-sample phases, first-order Taylor correction); apply scaled/scrolled copies at each discontinuity → corrects **all** harmonics at once and stays accurate at high pitch and under hard-sync resets; cost = a handful of taps per discontinuity (cheap in practice), complexity = table generation (one-time, offline) and edge bookkeeping. PolyBLEP = no tables, closed-form, only 1st-order correction.
- **Fold-in verdict:** **ADOPT** PolyBLEP as the default for saw/square/sync-capable oscillators **combined with the voice-chain 2× oversampling**; **ADOPT** the Surge-style 12-tap BLIT/minBLEP engine as the "Classic" oscillator for v1 quality tier (table generated at init/offline — a few hundred lines, the most reusable asset from annex/01). Home: engine oscillators.

### 9. Wavetable anti-aliasing — mipmap math, interpolation maths and measurements, industry conventions

- Links: annex/01 §2 (Surge Wavetable: frames to 4096, 512 sub-tables, 16 mip levels, 63-tap halfband decimation, 12-tap sinc read, 24-bit fixed-point phase) · Serum 2 frame spec: **2,048 samples/frame, up to 256 frames** (`https://www.hyperwave.app/docs/tutorials/import-wavetables-into-serum-and-vital` snippet; kimurataro converter chart: *"2048 samples: Serum, Vital"*) · local raw `karplus.js`, `cosmic-drone.js` (ditty wavetable conventions).
- Core contribution: the standard wavetable AA design and the measured truth about interpolation quality — with the safety-margin lesson.
- THE MATH (derived, consistent with annex/01's conventions):
  - Level choice: a table of `M` samples holds harmonics ≤ M/2; mip level `k` keeps ≤ M/2^(k+1); need `h_max ≤ fs/(2·f0)` ⇒ **k = ceil(log2(M·f0/fs))** — each level = one octave of headroom, so a 2048-sample table needs ⌈log2(2048/2)⌉ ≈ 10 levels' worth of range (plus oversampling margin; Surge uses 16 levels for 4096-sample frames at 2× oversampled voice rate).
  - Build: mips made by band-limited decimation (Surge: 63-tap halfband FIR chain) — **not** by naive decimation; generate offline/worker, bake into the pack.
- MEASURED [this machine, 2026-10-06; 32-harmonic band-limited saw tables; error vs same-normalised ideal; 65,536-pt Blackman FFT]:
  - Mid-octave read (f0=200 Hz, mip k=4, table 128, step 0.533 table-samples/output): rms error **linear −35.0 dB · cubic4 −45.9 dB · sinc8(Blackman) −63.3 dB · sinc12(Hann) −69.9 dB**; worst spur ≤ −114 dBc for all (error sits on the harmonics themselves — timbre change, not new tones).
  - Top-of-octave read (f0=356 Hz, step 0.949): linear −34.9 / cubic −45.6 / sinc8 −63.6 dB rms; worst non-harmonic spurs **−51.6 / −54.8 / −69.9 dBc @ ~13.8 kHz**.
  - Aggressive mip edge (f0=400 Hz → my formula picked 64-sample table; top harmonic at table Nyquist): everything collapses — linear −23.2, cubic −25.9, sinc8 −27.5 dB rms. **Lesson: keep ≥ half-octave to one-octave of margin between the mip's top harmonic and its Nyquist (Surge's practice: each level halves the harmonic count with margin; 2× oversampling adds another octave).**
- **Fold-in verdict:** **ADOPT**: 2048-sample frames (Serum/Vital-compatible — matches the family's existing stacked-WAV convention and PF's `.wt`/vawt container parity), 8–16 mip levels with real margin, **cubic (Catmull-Rom) interpolation as default** (≈10 dB better than linear for ~14 more flops), sinc8 for an HQ/oversampled mode; phase in 24-bit fixed point if profiling wants it (Surge's trick), else float. Home: engine wavetable module + pack pipeline.

### 10. Oscillator sync and oversampling — costs of the halos

- Links: annex/01 §1/§6 (Surge: `OSC_OVERSAMPLING = 2`, halfband order 6 = 51 dB rejection, order 12 = 104 dB; hard-sync via second internal phase + windowed sync) · BCD `api/WaveShaperNode.json` (oversample: Chrome 29+, Firefox 26+, Safari 6+ — verified) · Brandt 2001 (entry 8).
- Core contribution: how sync stays clean and what oversampling actually costs.
- KEY FACTS / MATH:
  - Sync = resetting a second phase accumulator at the master period; naive reset = full-spectrum click → aliasing. Options ranked by cost/quality: (a) PolyBLEP discontinuity correction at the reset point (cheap, good at moderate pitches), (b) minBLEP/BLIT table smear at reset (Brandt — the correct general solution), (c) per-oscillator 2×/4× oversampling + decimation (brute force), (d) DPW-style numerical differentiation (no tables; Surge's Modern osc; excellent for FM/sync stability — annex/01 §2).
  - Halfband cost (annex/01): **polyphase-IIR (HIIR)** converters are the cheap option — order 6 ≈ a few allpass sections ≈ ~6–10 flops/sample per direction with 51 dB rejection; order 12 = 104 dB for HQ. FIR 63-tap halfband (polyphase) ≈ 32 MACs/output-pair ≈ 32 flops/sample — use where linear phase matters (masters), IIR inside the voice.
  - Native shortcut: `WaveShaperNode.oversample = '2x'|'4x'` is supported broadly (versions above) — free oversampling for static shaper LUTs; not applicable to per-voice custom code.
- **Fold-in verdict:** **ADOPT**: voice chain runs **2× oversampled with polyphase-IIR halfbands (order 6 default, order 12 for the "HQ" setting)** — this matches Surge's audibly-important choice and is affordable per entry 7; sync via minBLEP at reset for the Classic osc; Modern/DPW as the no-table alt. Home: engine oscillators + oversampling utility.

### 11. ZDF/TPT SVF — the primary filter kernel (exact formulas)

- Links: `https://cytomic.com/files/dsp/SvfLinearTrapOptimised2.pdf` (Simper/Cytomic, 2013, updated 2016 — fetched; verified) · local `research/tabs/raw/techno-beat.js` lines 1–66 (srtuss's implementation, which mirrors the paper exactly — local reference) · annex/01 §3 (`fut_cytomic_svf` = Fast SVF in Surge XT).
- Core contribution: the single filter kernel to standardise the engine on — unconditionally stable, cheap, all outputs from one state.
- THE MATH (the optimised form; coefficient block + per-sample block, verbatim structure from the paper / the local implementation):
  ```
  g  = tan(pi * fc / fs)          // fc = cutoff Hz, fs = sample rate (oversampling raises effective fs)
  k  = 1 / Q
  a1 = 1 / (1 + g*(g + k))
  a2 = g * a1
  a3 = g * a2
  // per sample (states ic1eq, ic2eq):
  v3    = v0 - ic2eq
  v1    = a1*ic1eq + a2*v3
  v2    = ic2eq + a2*ic1eq + a3*v3
  ic1eq = 2*v1 - ic1eq
  ic2eq = 2*v2 - ic2eq
  low   = v2
  band  = v1
  high  = v0 - k*v1 - v2
  notch = high + low              // (allpass variant added 2016: ap = low + high - k*band)
  ```
  ~12 flops/sample; `tan()` only on coefficient updates (k-rate); mathematically the same family as Zavalishin's TPT SVF (**The Art of VA Filter Design** — cite book; the NI PDF mirror is dead, see dead ends).
- Notes: gives LP/BP/HP/notch/allpass simultaneously per stage → multi-mode filter UIs free; 12 dB/stage, cascade two for 24 dB; stable at self-oscillation (k→0); the "Fast SVF" in Surge XT is exactly this kernel, so it doubles as a Surge-parity filter.
- **Fold-in verdict:** **ADOPT as the default per-voice filter** (worklet-side; per-voice native `BiquadFilterNode`s are not viable). Cascade SVF (two TPT stages) for 24 dB modes. Home: engine filters, first filter coded.

### 12. Moog ladder variants — Stilson-Smith and Huovilainen

- Links: `https://dafx.de/paper-archive/2004/P_061.PDF` — **verified**: PDF metadata: *Title: Non-Linear Digital Implementation of the Moog Ladder Filter / Author: Antti Huovilainen* (DAFx-04, Naples) · Stilson & Smith, *Analyzing the Moog VCF with Considerations for Digital Implementation* (CCRMA; the annex-cited origin) · `https://github.com/ddiakopoulos/MoogLadders` (**Unlicense**, verified via GitHub API — public-domain reference implementations incl. the RK Simulation Model) · annex/01 §3 (Surge's Vintage Ladder = "Stilson/Smith plus Huovilainen's improved nonlinear model, ported from MoogLadders RKSimulationModel", HARD rating).
- Core contribution: the classic ladder sound with honest cost, as a second (character) filter family behind the SVF default.
- KEY FACTS / MATH:
  - Topology: four one-pole LPF stages in a feedback loop with `tanh` saturation in the forward path (and often in feedback), cutoff from a single coefficient; Huovilainen's contribution = efficient nonlinear solve (implicit/one-sample-delay approximations, tuning compensation) so the model doesn't blow up or detune.
  - Numeric structure (typical): per-sample, each stage `y += g*(tanh(x_in) - tanh(y_prev))`-style trapezoidal update; RK4 (ddiakopoulos) evaluates the 4-stage system 4× per sample ≈ ~150–200 flops/sample/voice (verify: port and measure) — one to two orders above the SVF; **requires 2× oversampling** to keep the nonlinearity's aliasing down.
  - The zero-delay-feedback ladder alternative (Zavalishin / Pirkle) is another ~30-flop family with slightly different character — keep as an option (verify against Huovilainen).
- **Fold-in verdict:** **ADOPT one** accurate ladder (Huovilainen-style, 2× oversampled) as the flagship analog character filter; **REFERENCE** the rest; port the RK4 math from MoogLadders (Unlicense — textbook-clean) as the third filter coded. Home: engine filters.

### 13. Physical modelling — Karplus-Strong and its extensions

- Links: `https://ccrma.stanford.edu/~jos/pasp/Karplus_Strong_Algorithm.html` + `https://ccrma.stanford.edu/~jos/pasp/` (Julius Smith's *Physical Audio Signal Processing* — verified live) · Jaffe & Smith, *Extensions of the Karplus-Strong Plucked-String Algorithm*, Computer Music Journal 7(2), 1983 · local `research/tabs/raw/karplus.js` (ditty implementation, technique reference only) · annex/01 §2 (Surge String osc).
- Core contribution: the spec for the string/pluck module — one of the family's DNA sounds (T0) and cheap per voice.
- KEY FACTS / THE SPEC (distilling the local ditty implementation + PASP):
  - Core: delay line of `N = fs/f0` samples (fractional part via linear interpolation or, better, **allpass interpolation** — Dattorro's paper covers why plain linear interpolation colors modulated/allpass-loop delays (verify against Smith's delay-line chapters)); loop filter: one-pole LP `y = a1*x + (1-a1)*y_prev` with `a1 ≈ clamp01(2π·cutoff/fs)`; loop gain sets decay.
  - Improvements that matter (ditty + Surge practice): pluck-position comb injection (`buf[(i+offs)%N] -= buf[i]`, offs ≈ 20–40% of length); noise-burst vs continuous exciters; tone filter (lp/hp); softclip in loop; **tuning compensation** for the loop filter's phase delay (Surge's stiffness modes; otherwise pitch sags on damped strings); optional 2× oversampling.
  - Cost scale: the 2020 stress test ran **1,000 JS / 2,000 WASM strings** on a laptop — a KS voice is one of the cheapest our engine will have (~20–40 flops/sample + memory (verify)).
- **Fold-in verdict:** **ADOPT** as the v1 string module (mono/stereo pair, pluck-position comb, exciter bank from the ditty's 16-exciter idea, allpass-based fractional tuning). Home: engine oscillators/voices + string pack.

### 14. Granular and additive synthesis — minimal specs, and what we defer

- Links: `http://zynaddsubfx.sourceforge.net/doc/PADsynth/PADsynth.htm` (PADsynth; verified live) · suite reference S1 (padthv1/PADsynth research — do not redo) · annex/01 §2/§4 (Surge Twist/Nimbus HARD; skip).
- Core contribution: the cheap versions of the two "big" synthesis methods so they don't inflate v1.
- KEY FACTS / MINIMAL SPECS:
  - **Granular**: grain = windowed read of a buffer with its own playback rate; Hann window (table lookup, ~4 flops + 2 mults per sample per grain); grain scheduling (start time, duration typically 10–200 ms, pitch ratio, pan, position); overlap ~4–8 → sums to unity gain with Hann; add 1-pole smoothing of position/rate for the "cloud" feel. Cost: **~15–25 flops per active grain per sample (verify)** — cap grains (e.g. 64–128) as a voice-like resource. (Nimbus-grade granular *reverb*: SKIP, HARD per annex/01.)
  - **Additive**: two viable paths — (a) per-partial oscillators (only for small partial counts), (b) **inverse FFT frame synthesis**: fill one spectrum per frame from harmonic amplitude/phase rules, real IFFT (e.g. N=1024: ~5·N·log2 N ≈ 51k flops → ~50 flops/sample (verify)) + overlap-add. This is the PADsynth approach, and the suite already holds the padthv1/PADsynth research — reuse it, don't rebuild.
- **Fold-in verdict:** **REFERENCE / DEFER**: granular as a stretch module post-v1 with a hard grain budget; additive ships only as the suite's existing PADsynth-derived engine plugged into the same voice interface (or as wavetable-generation offline — additive → mipmapped table — which is cheaper live — see entry 9). Home: engine roadmap.

### 15. Reverb families — Freeverb, Dattorro plate, FDN (with parameter sets)

- Links: `https://ccrma.stanford.edu/~jos/pasp/Freeverb.html` + `.../Freeverb_Main_Loop.html` (verified live) · `https://ccrma.stanford.edu/~dattorro/EffectDesignPart1.pdf` (verified live) · `https://github.com/khoin/DattorroReverbNode` (**public domain** licence text verified; constants read from `dattorroReverb.js` (verify file path spelling)) · `https://www.dsprelated.com/freebooks/pasp/Feedback_Delay_Networks.html` (Jot-lineage FDN chapter, verified).
- Core contribution: choose the reverb topology with real numbers, not vibes. (Context: Surge XT's Reverb1 is Freeverb-lineage, Reverb2 is its own FDN-ish design; 31 effects total — corrected count.)
- KEY FACTS / PARAMETER SETS:
  - **Freeverb** (public domain, Jezar@Dreampoint): per channel **8 parallel lowpass-feedback combs + 4 series allpasses**; PASP quotes the canonical `revmodel::processreplace` loop (mono-sum input, wet1/wet2 cross-mix, `stereospread` default **23** added to right-channel delays). Classic tuning constants (combs 1116,1188,1277,1356,1422,1491,1557,1617 / allpasses 556,441,341,225 @44.1k, gain 0.015, roomsize→feedback scaling, damping 0.4) are the well-known `tuning.h` defaults **(verify by reading tuning.h before hardcoding; I could not confirm them from a primary file in this pass)**. Cheapest full reverb; sounds "80s algo" but moddable.
  - **Dattorro plate (Effect Design Part 1, JAES 1997)** — the recommended plate. Verified constants (from the public-domain port, exact seconds that map 1:1 to 29,761 Hz-sample lengths in the paper): input diffusers **142, 107, 379, 277** samples (gains 0.75 / 0.625); decay diffusers **672, 1800, 908, 2656** (gains 0.7 / 0.5); tank delays **4453, 3720, 4217, 3163**; 1-s predelay buffer; damping/bandwidth one-poles (damping ~0.0005, bandwidth ~0.9995 — (verify) exact defaults from the paper); modulated tank (excursion LFO) for the plate shimmer. ≈ 12 delay lines + a few allpasses + 3 one-poles — a few hundred flops/sample total (verify), i.e. affordable even per-bus.
  - **FDN**: Jot's matrix reverb — N delay lines + an orthogonal feedback matrix; **Hadamard** matrix is the standard cheap choice (H·Hᵀ = N·I; normalized by 1/√N; O(N log N) fast transform) — right pick when we want adjustable size/decay and a "modern" tail; start from a documented 8- or 16-line set (verify delay primes + damping from a published table before shipping).
  - IR path: `ConvolverNode` for static impulses (EASY, exactly Surge's Convolution effect) but unmodulatable — for buses/presets only.
- **Fold-in verdict:** **ADOPT Dattorro plate (worklet) as the flagship reverb**, **FDN as the second algorithm** (algorithm selector = plate/hall/room variants), **Freeverb as the cheap mode, ConvolverNode for IR presets**. All reverbs live in the single mixer worklet (modulated delays make node graphs painful — annex/04 §2). Home: FX rack, after voice engine.

### 16. Delay and modulation FX — fractional delay, chorus/flanger/phaser

- Links: Dattorro Part 1 (delay-line interpolation + chorus = the canonical treatment; verified live) · annex/01 §4 (Surge chorus/flanger/phaser/delay mathematics) · annex/04 §1 (node-graph feasibility table — reusable directly).
- Core contribution: the spec set for the modulation block, with the interpolation decision made correctly.
- KEY FACTS / MATH:
  - **Fractional delay**: integer delay + interpolation. Linear interpolation = 2 taps, ~4 flops, but acts as a fixed lowpass and (worse) a **moving lowpass when the delay is modulated** — audible dulling; allpass interpolation (1 multiply + 2 adds, allpass filter on the integer tap) gives flat magnitude with a small phase warp (best for chorus/flanger); sinc/Lagrange (4–8 tap) for delay lines that must stay transparent under big modulation. (Dattorro's paper develops the allpass method; cite it, don't guess.)
  - **Chorus**: 2–4 taps, delay ~15–30 ms ±LFO depth, LFO 0.1–6 Hz, per-tap pan/spread, no feedback (ensemble = more taps + slower LFOs). **Flanger**: same structure, base 0.5–5 ms, **feedback ≤ ~0.9**, damping in the feedback leg. Cost per tap ≈ read + 4 flops + LFO add — trivial.
  - **Phaser**: N allpass biquads in series (6–8 typical), notches formed with the dry sum; stage spacing 2^((i+1)·2/N)-style (annex/01: Surge's center spacing) and LFO on the stage frequencies; optional feedback (needs a 1-sample/`DelayNode` allowance in the node-graph tier); cost ~9 flops per stage.
  - Node-graph equivalents exist for all three (annex/04's feasibility table: chorus/flanger/phaser/delay all node-graph-feasible; modulated interpolated loops are the pain point at extremes) — keep as file:// fallback.
- **Fold-in verdict:** **ADOPT** worklet-first implementations inside the mixer worklet (allpass interpolation for chorus/flanger; TPT allpass stages for phaser; syncable echo already spec'd in the acid module); node-graph versions only for the fallback tier. Home: FX rack.

### 17. Dynamics and EQ — compressor/limiter math + the RBJ cookbook

- Links: Giannoulis, Massberg & Reiss, *Digital Dynamic Range Compressor Design — A Tutorial and Analysis*, JAES 60(6) 2012: `http://www.eecs.qmul.ac.uk/~josh/documents/2012/GiannoulisMassbergReiss-dynamicrangecompression-JAES2012.pdf` (verified live) · RBJ Audio EQ Cookbook: `https://www.w3.org/TR/audio-eq-cookbook/` (verified live) · local `techno-beat.js` (peak compressor + dB math reference).
- Core contribution: the master bus and the mix EQ, spec'd with the standard references.
- KEY FACTS / MATH:
  - **Compressor** (feed-forward, the tutorial's structure): level detector (peak or RMS; one-pole attack/release — local ditty uses `peak = max(|L|,|R|)` with `.9999`-style release), static gain computer in **dB** (`gain_dB = (threshold - level_dB)·(1 - 1/ratio)` for level > threshold; soft knee = quadratic interpolation over ±knee/2 dB), then smoothing and makeup. Ladder chain order matters: detector → gain computer → smoothing → apply.
  - **Limiter**: same + **lookahead** = delay the signal by the lookahead window (1–5 ms) and compute gain on the un-delayed copy; ramp the gain over the lookahead (min of windowed max) — guarantees no overshoot; stereo-link the detector (max of both channels) to avoid image shift.
  - **EQ**: RBJ cookbook biquads — lowshelf/peaking/highshelf; coefficients are closed-form from (f0, Q/S, gain dB, fs); 3-band = ~27 flops/sample total. Native `BiquadFilterNode` implements RBJ-derived formulas and covers the mix EQ; **note the shelf `Q` semantics differ from the cookbook's `S`** — verify mapping when matching reference renders (verify, W3C spec comparison).
  - Master safety: hardclip at −18 dBFS and a soft-clip stage (annex/01 §6 pattern) before the limiter.
- **Fold-in verdict:** **ADOPT**: EQ on native nodes when available (worklet biquads otherwise — identical math), compressor+limiter as a dedicated small worklet (single instance, k-rate params only), chain order = saturator → EQ → compressor → limiter → meter. Home: FX rack / master chain.

### 18. Library shortlist — licences verified from the actual files (use / reference / skip)

- Links (all fetched 2026-10-06): `raw.githubusercontent.com/...` licence files + `registry.npmjs.org` metadata; full list per row.
- Core contribution: the vetted ingredient list — nothing enters the build on a rumour.
- KEY FACTS (licence = read from file; where the file was missing, the mismatch is the finding):
  | Library | What it solves | Licence (verified) | Verdict |
  |---|---|---|---|
  | **signalsmith-audio/dsp** | C++ FFT/STFT/delay/effects; clean modern DSP reference | **MIT** — `LICENSE.txt`: "Copyright (c) 2021 Geraint Luff / Signalsmith Audio Ltd." | **REFERENCE** (port-study; C++ not shippable to JS as-is) |
  | **Elementary Audio** (`elemaudio/elementary`) | functional audio graph on a WASM+worklet runtime | **MIT** — `LICENSE.md` "Copyright (c) 2023 Nick Thompson"; GitHub API MIT; npm `@elemaudio/core` 4.0.1 MIT | **REFERENCE** (architecture read; ~600 KB runtime is the wrong budget — annex/04; low activity) |
  | **dsp.js** (corbanbrook) | classic JS FFT/osc/biquad primitives | **MIT** — LICENSE: "Copyright (c) 2010 Corban Brook" + MIT grant | **REFERENCE** (old, slow; clean FFT/window code to crib) |
  | **Tuna.js** (`Theodeus/tuna`) | JS effect topologies (chorus, phaser, bitcrush, moog, ping-pong delay) | **NO licence file in repo** (root listing has none; GitHub API `license: null`; README has no licence section); npm `tunajs` 1.1.3 declares **"MIT"** | **REFERENCE ONLY** — read topologies, do not copy code until provenance is settled (npm claim alone is weak evidence) |
  | **Soundpipe** | C library of 100+ unit generators | **MIT** — "Copyright (c) 2020 Paul Batchelor" | **REFERENCE** (port selected algos; excellent docs) |
  | **STK** (`thestk/stk`) | classic synthesis toolkit (physical models, filters) | **MIT-style** — "Copyright (c) 1995-2023 Perry R. Cook and Gary P. Scavone"; non-binding request to send modifications back | **REFERENCE** (port small pieces; no maintained JS port) |
  | **Faust** | DSP language/compiler; offline generator of C/WASM | Compiler `COPYING.txt`: "FAUST compiler, Version 2.88.0 ... GNU Lesser General Public License ... version 2.1 ... or (at your option) any later version"; npm `@grame/libfaust` 1.3.1 declares **GPL-2.0** (discrepancy (verify)); FAQ: *"The LGPL license of the compiler doesn't apply to the code generated by the compiler. The license of the code generated by the Faust compiler depends only on the licenses of the input files."* and *"when used unmodified, Faust libraries and architecture files are compatible with proprietary, non-open source use."* faustlibraries: no root LICENSE — **per-function licences** declared in-file (e.g. STK-4.3 for some Julius Smith functions) | **ADOPT (offline generator only)** — compile one-off kernels, vendor output, never ship libfaust/compiler; check per-function licences of any used library function |
  | **WAM SDK** (`webaudiomodules/api`,`/sdk`) | plugin-hosting standard | **No LICENSE file** in either repo; `package.json` + npm declare **MIT** (`@webaudiomodules/api` 2.0.0-alpha.6, `@webaudiomodules/sdk` 0.0.12) | **SKIP** (hosting standard, not DSP; wrong scale) |
  | **lamejs** (`zhuker/lamejs`) | MP3 export (dittytoy ships MP3 export — precedent) | npm `lamejs` 1.2.1 declares **LGPL-3.0**; repo `LICENSE` = the LAME FAQ text: *"Can I use LAME in my commercial program? Yes, you can, under the restrictions of the LGPL..."* | **SKIP for the bundled core** (LGPL ≠ our MIT-only rulebook); plan: WAV export native + MediaRecorder Opus (`audio/webm`) free; MP3 as an optional separately-loaded LGPL module **if** demanded, decision documented |
  | **SoundTouchJS** (`cutterbl/SoundTouchJS`) | time-stretch / pitch-shift | repo root `LICENSE` = **MPL-2.0** ("Each file in this project is licensed under the terms of the Mozilla Public License, v. 2.0"); `packages/core/LICENSE` MPL-2.0; npm `soundtouchjs` 0.3.0 still declares LGPL-2.1 (stale(verify)); `@soundtouchjs/core` 2.1.1 MPL-2.0; `cutterbl/soundtouchjs-audio-worklet` LGPL-2.1 | **SKIP for the synth core** (not needed); if a sampler/time-stretch feature later needs it, use as an unmodified MPL-2.0 module |
- **Fold-in verdict:** **REFERENCE the studies (signalsmith, Elementary, dsp.js, Soundpipe, STK, Tuna topologies)**; **ADOPT Faust offline-generator workflow** for one or two hard kernels (with the FAQ quote archived in the licence manifest); **SKIP lamejs/WAM/SoundTouch from the core**. Home: build handoff licence manifest.

### 19. Verification battery — the engine's proof protocol (run before any voice-count or quality claim)

- Links: Pattern Forge `verify/cdp_stress.mjs` (culture+tooling to mirror: headless Chrome over CDP, in-page samplers, assertions with pass/fail log, 10-min stress with heap/frames/voices) · annex/04 §4 (audio verification pattern: analyser peaks + OfflineAudioContext checks) · SuperSonic METRICS docs (glitch counter, ring-buffer telemetry — architecture precedent).
- Core contribution: concrete, runnable tests; no claim ships without engine-witness output.
- THE BATTERY (concrete steps):
  1. **Aliasing floor (per oscillator)**: render 10 s of a sustained note (e.g. A4) for each osc type at fixed settings via `OfflineAudioContext` (44100 and 48000); window (Blackman) + FFT (2^17); report worst non-harmonic component in dBc. Gates: mip-managed wavetable ≤ −80 dBc at standard pitches; PolyBLEP saw/square ≤ −45 dBc ≥ C4 (with 2× OS); anything worse blocks ship. (These thresholds are drawn from entry 8/9 measurements — adjust after first real run (verify).)
  2. **THD+N (clean path)**: sine note through full voice (filter open); report harmonics ≤ −70 dBc and noise floor ≤ −90 dBFS (verify thresholds with first render).
  3. **Voice-count ramp**: entry 7 protocol — geometric ramp, 10 s holds, p95 quantum load + underrun counters; record `max_stable` per platform + build (JS/WASM).
  4. **10-minute stress** (mirror cdp_stress): mixed load — arpeggios, knob sweeps (cutoff/Q), wavetable morph, reverb fully wet, tuning on — sampling every 15 s: active voices, `performance.memory.usedJSHeapSize`, frame time, and worklet-side glitch counters; assertions: heap growth < 60 MB (cdp_stress's bar (verify)) **and** zero underruns at the declared voice cap, engine still healthy after (pool drains, tables intact, tuning intact, counters honest).
  5. **Null tests vs reference renders**: fixed input (impulse + a click sequence + a short loop) through deterministic patch settings; render offline; compare against the frozen reference WAV (previous engine build, or Surge XT renders for ported kernels where timings match): assert sample-wise max difference below threshold for unchanged code paths (start: −60 dBFS (verify) — exactness depends on double vs float paths). Freeze reference WAVs as CI artefacts (frozen-bytes culture).
  6. **Latency measurement**: report `baseLatency`/`outputLatency` + an acoustic loopback check (output → input, cross-correlation of a click) on desktop; assert interactive-hint desktop baseLatency ≤ 10 ms (local measured 10 ms exactly [measured] (verify per device)).
  7. **Cross-rate parity**: full battery at 44.1 k and 48 k; any assertion expressed in absolute Hz is a bug.
  8. **Platform matrix**: Chrome/Edge/Firefox/Safari desktop + iPad Safari; hosted build + `file://` single-file build (fallback tier smoke: plays, no console errors, documented lower voice cap).
- **Fold-in verdict:** **ADOPT** as the stage-gate battery ("lab → battery → frozen bytes → deploy" — suite build discipline). Home: engine QA + build plan exit criteria.

---

## Dead ends (logged, per rules; ≤3 attempts per URL respected)

- `caniuse-db` has **no `audio-worklet` feature id** (404 multiple paths) — used MDN browser-compat-data instead for all version gates.
- `https://xferrecords.com/products/serum` → 404 (Serum 2048-sample frame claim sourced from third-party docs/quotes of the Serum 2 guide instead; re-verify from the official guide PDF before printing it in marketing).
- Zavalishin *Art of VA Filter Design* NI PDF (`VAFilterDesign_2.1.0.pdf`) → 404; cited by title only (find the current host if the book must be linked (verify)).
- `elemaudio/core` repo → 404; the real repo is `elemaudio/elementary` (MIT verified).
- `webaudiomodules/{api,sdk}` repos contain **no LICENSE files** — licences exist only in package.json/npm metadata (MIT); treat as declared-not-filed.
- `Theodeus/tuna` has **no licence file at all** (GitHub API license null; README silent); npm claims MIT — unresolved provenance, reference-only.
- `grame-cncm/faust` has no root `LICENSE`, only `COPYING.txt` (LGPL-2.1-or-later text for the compiler, v2.88.0); npm `@grame/libfaust` says GPL-2.0 — discrepancy unresolved (verify with GRAME before shipping anything libfaust-related; generated-code path is covered by the FAQ).
- `faustlibraries` has no root licence; per-function licences (e.g. STK-4.3) declared in-file — any function we compile must be licence-checked individually.
- DAFx `P_062.PDF` → 404 (only P_061 wanted; verified correct: Huovilainen Moog ladder, DAFx-04).
- Zenodo WAC PDF via exa extract blocked (`CRAWL_UNEXPECTED_CONTENT_TYPE`) — fetched via hound smart_fetch instead (full text read).
- `khoin/DattorroReverbNode/.../dattorro_reverb.js` → 404 (correct name `dattorroReverb.js`); Dattorro constants then verified from the file + the 29,761 Hz sample-length arithmetic.
- Freeverb `tuning.h` constants not read from a primary file in this pass (mirror URLs 404; WebKit `Reverb.cpp` is the newer IR reverb, not Freeverb comb tunings; Chromium mirror hits were `AudioReverb`) — comb/allpass constant list left tagged (verify); structure + loop code verified from PASP.
- Chrome tracing numbers (Casey blog) and karplus-stress findings are from 2020-era browsers/hardware — used as scale references, flagged for local re-baselining (entry 7 protocol).
- MDN's older "44.1 kHz is most common" default-rate text is contradicted by device-rate defaults (Chrome ≥74, local measurement 48 kHz) — treat 44.1 as heritage, 48 k as the modern default.

## Answer-block JSON

```json
{"file": "C:\\Users\\Moddy\\anvil\\research\\engine\\T5-web-audio-engine.md", "items_count": 19, "dead_ends": ["caniuse audio-worklet feature id missing (404)", "xferrecords.com/products/serum 404", "NI VAFilterDesign PDF 404", "elemaudio/core repo 404 (use elemaudio/elementary)", "webaudiomodules repos lack LICENSE files (npm MIT only)", "Tuna repo has no licence file (npm MIT only)", "faust repo root LICENSE absent; libfaust npm GPL-2.0 vs COPYING LGPL-2.1 discrepancy", "faustlibraries per-function licences only", "DAFx P_062.PDF 404", "Zenodo PDF blocked via exa (used hound)", "khoin dattorro_reverb.js 404 (dattorroReverb.js)", "Freeverb tuning.h constants unverified", "2020-era perf numbers need local re-baseline"]}
```
