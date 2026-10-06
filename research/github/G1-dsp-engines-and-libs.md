# G1 — DSP engines & libraries: a verified GitHub scouting report for Anvil

**Written:** 2026-10-06/07 · for the Anvil research build (`C:\Users\Moddy\anvil`) · folder `research/github/`.
**Method:** every licence below was read from the repository's own `LICENSE` / `COPYING` / `README` file via the authenticated `gh` CLI (GitHub REST + raw contents), 2026-10-06/07; activity = last `pushed_at` from `GET /repos/{owner}/{repo}`; star counts / sizes / folder inventories from the same live API reads (GitHub `size` in KB). No clones, no builds, no repo modifications. Sibling research read first: `research/engine/T5-web-audio-engine.md` (its library shortlist — Signalsmith, Elementary, dsp.js, Soundpipe, STK, Faust — is assumed read; this file adds only **new** finds and cites T5 where the value maps) and `research/reuse/T9-pattern-forge-reuse.md` (gap list: worklet engine, per-voice mod, native sequencing, FX/sampler).
**Fold-in vocabulary:** **PORT-STUDY** = read the source to port its algorithms · **ADOPT-IDEA** = take the design/format/pipeline, not the code · **REFERENCE** = background/architecture reading · **SKIP** — each with the plan area (engine / FX / mod / UI / sequencer / packs).

---

### 1. Mutable Instruments firmware monorepo — `pichenettes/eurorack` (Rings, Elements, Clouds, Braids, Plaits, Tides, Warps, Peaks…)

- Links: https://github.com/pichenettes/eurorack — note: the `mutable-instruments/*` repo names do **not** resolve; the firmware lives under Émilie Gillet's personal account (`pichenettes`), where the whole module set is archived for reuse.
- Core contribution: 27 module firmware directories in one tree; the DSP behind Anvil's voice roadmap — modal/physical modelling (Rings, Elements), granular + reverb (Clouds), oscillator model banks (Braids, Plaits, Tides), wave-shaping/vocoder (Warps), drums/LPG/utility (Peaks, Frames, Stages, Marbles, Streams).
- KEY FACTS
  - **LICENSE: there is no root LICENSE file** (contents listing: none; GitHub API `license: none` — verified). The licence statement lives in the README, verbatim: *"Code (AVR projects): GPL3.0."* · *"Code (STM32F projects): MIT license."* · *"Hardware: cc-by-sa-3.0"* · *"By: Emilie Gillet (emilie.o.gillet@gmail.com)"* — followed by a "Guidelines for derivative works" note that *"Mutable Instruments is a registered trademark."*
  - **Per-file verification (the actual finding — older/newer files vary):** the MIT grant text ("Permission is hereby granted, free of charge…" / "See http://creativecommons.org/licenses/MIT/ for more information.") is in the headers of braids/braids.cc and braids/makefile (Copyright 2012), rings/dsp/resonator.cc (2015), elements/dsp/resonator.cc (2014), clouds/dsp/granular_processor.cc (2014), plaits/plaits.cc (2016), tides/tides.cc (2013), warps/dsp/modulator.cc (2014), peaks/peaks.cc (2014), frames/frames.cc, marbles/marbles.cc, stages/stages.cc, streams/streams.cc. The **GPL-3.0-or-later** header ("GNU General Public License … either version 3 of the License, or (at your option)") is on the AVR modules — verified on edges/edges.cc and grids/grids.cc. Anvil rule: check the header of every file you touch; the split is per project (AVR=GPL, STM32=MIT), not per repo.
  - Activity: last push **2023-12-13** (Mutable was wound down in 2023; repo not archived), created 2013-08-26, **3,191 stars**, 54.3 MB, C++. `stmlib`, `avrlib`, `avrlibx`, bootloaders are git submodules (`.gitmodules`) — shared code is versioned separately.
  - **Module → Anvil map (the value):**
    - **Rings** (`rings/dsp/`: resonator.cc, string.cc, fm_voice.cc, string_synth_part.cc, plucker.h, strummer.h, onset_detector.h, fx/chorus+ensemble+reverb) → modal & string resonator voices, plucker/strummer performance logic; Anvil: the physical-modelling voice family (mallet/pluck), a strummer-style sequenced articulation, and an FX bench (chorus/ensemble/reverb).
    - **Elements** (`elements/dsp/`: resonator.cc, string.cc, exciter.cc, tube.cc, voice.cc, multistage_envelope.cc, ominous_voice.cc, fx/diffuser+reverb) → struck/plucked modal percussion with a designed exciter bank; Anvil: modal drum/pad engines + exciter design (T5 §13-14's "physical modelling" half).
    - **Clouds** (`clouds/dsp/`: granular_processor.cc, granular_sample_player.h, wsola_sample_player.h, looping_sample_player.h, mu_law.cc, correlator.cc, pvoc/, fx/diffuser+reverb+pitch_shifter+f x_engine) → grain scheduler + µ-law buffer compression + WSOLA stretch + diffuser/reverb; Anvil: the granular/sampler module and one of the reverb benches.
    - **Braids** — 49 distinct `MACRO_OSC_SHAPE_*` values counted in braids/settings.h; model code in digital_oscillator.cc + analog_oscillator.cc + macro_oscillator.cc + signature_waveshaper.h + quantizer/quantizer_scales.h + excitation.h; Anvil: the model-per-macro architecture and a warm bank of osc/percussion models.
    - **Plaits** (`plaits/dsp/`: 16 engines in `engine/` — additive, bass_drum, chord, fm, grain, hi_hat, modal, noise, particle, snare_drum, speech, string, swarm, virtual_analog, waveshaping, wavetable; 6 more in `engine2/` — chiptune, phase_distortion, six_op, string_machine, virtual_analog_vcf, wave_terrain; 13 oscillator primitives — formant, grainlet, harmonic, nes_triangle, super_square, variable_saw, variable_shape, vosim, wavetable, z…) → the modern engine architecture (Engine/Engine2 + voice.cc mixer with aux osc) and the richest single source for Anvil's osc bank.
    - **Tides (v1) / Tides2** (generator.cc; tides2: poly_slope_generator.cc, ramp_shaper.h, ramp/, ramp_generator.h) → slope/function generators; Anvil: mod sources & LFO/MSEG shape bank (T9 gap #2 "no MSEG/multi-envelopes").
    - **Warps** (dsp/: vocoder.cc, filter_bank.cc, quadrature_oscillator.h, quadrature_transform.h, sample_rate_conversion_filters.h, oscillator.cc) → vocoder + filter bank + quadrature oscillator; Anvil: the FX rack's vocal/formant FX.
    - **Peaks** (processors.cc, pulse_processor/, drums/, modulations/, number_station) → LPG-style drums, AD/percussion envelopes; Anvil: percussion voices + envelope primitives (T9 gap: drum voices).
    - **Frames** (keyframer.cc, poly_lfo.cc) → 4-point keyframer/"Morph" + poly LFO; **Marbles** (random/) → random & scale logic for generative sequencing (feeds sequencer, T9 gap #3); **Stages** (segment_generator.cc) → multi-segment envelopes; **Streams** (svf.cc, compressor.cc, envelope.cc, vactrol.cc, lorenz_generator.cc) → filter/compressor/vactrol character.
  - Browser/wasm feasibility: plain C++ float DSP on top of stmlib (no framework/OS deps; stmlib's DSP subset has no ARM/CMSIS/STM32 references — see entry 2), so an Emscripten/wasm or manual port is a straight compile per file. Precedent that this code travels: `VCVRack/AudibleInstruments` ("VCV Rack plugin based on Mutable Instruments Eurorack modules", 451 stars) — GPL-3.0-or-later per its LICENSE.md (source © 2016-2020 Andrew Belt & contributors; panel graphics © Émilie Gillet used with permission).
- **Fold-in verdict:** **PORT-STUDY — engine (modal/physical-modelling voices, osc bank, granular) + FX (diffuser/reverb/pitch shifter) + mod/sequencer (Tides/Marbles idea level)**. MIT clears adaptation legally; keep the house "reimplement + attribute" doctrine anyway.

### 2. `pichenettes/stmlib` — the DSP/utility library under every Mutable module

- Links: https://github.com/pichenettes/stmlib
- Core contribution: the shared primitives the Mutable firmwares are built from — the cheapest, highest-signal reading list for Anvil's worklet kernels (polyblep, delay lines, filters, limiter, voice allocation, lookup-table tricks).
- KEY FACTS
  - **LICENSE verbatim:** *"Except when noted otherwise, all code is copyright Emilie Gillet and is released under the MIT License with the following notice: Copyright 2012 Emilie Gillet. [MIT text]"*. Two stated exceptions in the same file: *"The code in third_party/STM is from STMicroelectronics, and released with the following notice: [disclaimer text only]"* and *"The code in programming/serial is from Ivan A-R, and released under the GPL with the following notice: … stm32loader is free software; … either version 3, or (at your option) any later version."*
  - Inventory: `dsp/` — atan.{h,cc} (fast atan), cosine_oscillator.h, delay_line.h, dsp.h (float↔int16, interpolation helpers), filter.h, hysteresis_filter.h, hysteresis_quantizer.h, limiter.h, parameter_interpolator.h, **polyblep.h**, rsqrt.h, sample_rate_converter.h, units; `algorithms/` — note_stack.h, pattern_predictor.h, tiny_map.h, **voice_allocator.h**; `utils/` — ring_buffer.h, random.h/cc, crc32.h, murmurhash3.h, stream_buffer.h, gate_flags.h; `fft/` — shy_fft.h (small FFT).
  - Portability [verified by grep]: zero matches for `__arm|cmsis|stm32` in dsp/dsp.h, dsp/filter.h, dsp/oscillator.h, utils/dsp.h — the DSP subset is portable C++.
  - Activity: last push **2023-09-03**, created 2012-09-12, **201 stars**, 6.0 MB, C++.
  - What Anvil takes: polyblep.h (same family as T5 §8's PolyBLEP math — cross-check constants), delay_line + filter + limiter for worklet kernels, voice_allocator.h for the pool/steal law (third source besides amsynth and Pattern Forge), shy_fft for small transforms, atan/rsqrt approximations for cheap shaping, tiny_map/stream_buffer for the parameter layer.
- **Fold-in verdict:** **PORT-STUDY — engine (DSP primitives) + mod (voice allocation)**. Read alongside T5 §8/§11; stmlib is the "small, proven" end of the spectrum.

### 3. Mutable **Rings + Elements** — modal resonator and physical modelling, verified MIT

- Links: https://github.com/pichenettes/eurorack/tree/master/rings · .../elements
- Core contribution: the two "resonator" firmwares — modal banks, strings, designed exciters, multistage envelopes and their FX — the single most directly transferable voice material for Anvil's physical-modelling family.
- KEY FACTS
  - **Licence verbatim (file headers):** rings/dsp/resonator.cc — *"// Copyright 2015 Emilie Gillet."* + the MIT permission grant; elements/dsp/resonator.cc — *"// Copyright 2014 Emilie Gillet."* + MIT; covered by the eurorack README's *"Code (STM32F projects): MIT license."*
  - Rings code map: `resonator.cc/h` (the modal / sympathetic-string resonator core), `string.cc/h`, `fm_voice.cc/h` (FM voice + LPG), `string_synth_part.cc/h` + `string_synth_oscillator.h` + `string_synth_envelope.h` (the "string synth" plate), `plucker.h`, `strummer.h`, `onset_detector.h`, `follower.h`, `note_filter.h`, `part.cc`, `performance_state.h`, `fx/` (chorus, ensemble, reverb).
  - Elements code map: `resonator.cc/h`, `string.cc/h` (tube-dispersion string — the "harmonic/odd-even" behaviour), `exciter.cc/h` (the exciter bank: noise bursts, gradients), `tube.cc/h`, `voice.cc/h`, `ominous_voice.cc`, `multistage_envelope.cc/h` (the multi-segment envelope — also a mod-system reference), `fx/` (diffuser, reverb).
  - Activity: within eurorack (last push 2023-12-13); repo 54.3 MB, 3,191 stars.
  - What Anvil takes: the modal voice architecture (model the resonator as a bank of tunable modes with input/output filtering = the "real instrument" sound in T5 §13-14); strike/pluck exciters as first-class objects; Elements' dispersion string for the string module; multistage envelope as a mod source (T9 gap #2); strummer/onset following for the performance layer.
- **Fold-in verdict:** **PORT-STUDY — engine (modal + physical-modelling voices), mod (multistage envelopes)**. First read after T5 §11-13 — this is where the flagship's "not a subtractive synth" claim gets its material.

### 4. Mutable **Clouds** — granular processor, µ-law memory trick, diffuser/reverb bench

- Links: https://github.com/pichenettes/eurorack/tree/master/clouds
- Core contribution: a complete granular/loop/stretch processor with its own reverb, diffuser and pitch shifter — Anvil's granular module spec plus a second reverb reference.
- KEY FACTS
  - **Licence verbatim (header):** clouds/dsp/granular_processor.cc — *"// Copyright 2014 Emilie Gillet."* + MIT grant (eurorack README: STM32 = MIT).
  - Code map (clouds/dsp/): `granular_processor.cc/h` (buffer manager + grain scheduler; params position/size/pitch/density/texture; 4 audio quality modes), `granular_sample_player.h`, `wsola_sample_player.h` (WSOLA time-stretch), `looping_sample_player.h`, `mu_law.cc/h` (µ-law companding of the sample buffer — halves RAM for 8-bit-quality storage; directly reusable for Anvil's audio buffer budget), `correlator.cc/h`, `pvoc/` (phase vocoder), `window.h` (window tables), `frame.h`, `audio_buffer.h`, `sample_rate_converter.h`, `fx/{diffuser.h, fx_engine.h, pitch_shifter.h, reverb.h}`.
  - Activity: within eurorack (2023-12-13); 54.3 MB repo.
  - What Anvil takes: grain scheduler + window tables + overlap normalization (T5 §14's granular minimal spec can be validated against this), WSOLA for the sampler's time-stretch, µ-law for buffer budgets, and the diffuser→reverb FX chain (T5 §15's plate/FDN decision can be A/B'd against this code).
- **Fold-in verdict:** **PORT-STUDY — engine (granular/sampler) + FX (diffuser/reverb/pitch shift)**.

### 5. Mutable **Braids + Plaits** — the two macro-oscillator generations (the osc-model bank)

- Links: https://github.com/pichenettes/eurorack/tree/master/braids · .../plaits · official Plaits editor: https://github.com/pichenettes/plaits-editor
- Core contribution: the model-per-macro architecture and its two libraries of sound models; Plaits is the modern engine set (with a browser editor precedent), Braids the wide early bank. This is Anvil's oscillator-module reading list.
- KEY FACTS
  - **Licence verbatim:** both MIT per file headers — braids/braids.cc + braids/makefile (Copyright 2012 + MIT grant; braids is an STM32F project per its README: *"makefile describes the steps to compile the files into a binary file for the STM32F"*), plaits/plaits.cc (Copyright 2016 + MIT). (The eurorack README's AVR=GPL clause does not bite these files; it does bite e.g. edges/grids.)
  - Braids inventory: `analog_oscillator.cc`, `digital_oscillator.cc` (shape renderers), `macro_oscillator.cc/h` (dispatch table of render functions — the architecture), `quantizer.cc` + `quantizer_scales.h` (scale quantization — relevant to Anvil's scale lock), `signature_waveshaper.h`, `svf.h`, `vco_jitter_source.h`, `envelope.h`, `excitation.h` (percussion exciter), `parameter_interpolation.h`; **49 distinct `MACRO_OSC_SHAPE_*` enum values counted in braids/settings.h**. The README states: *"all the other .cc / .h files are designed so that they can be compiled and run on both the actual hardware and a desktop computer"* — i.e. the DSP already runs host-side; `/test` builds a desktop WAV renderer.
  - Plaits inventory: 16 engine files (`dsp/engine/`: additive, bass_drum, chord, fm, grain, hi_hat, modal, noise, particle, snare_drum, speech, string, swarm, virtual_analog, waveshaping, wavetable), 6 more in `dsp/engine2/` (chiptune, phase_distortion, six_op, string_machine, virtual_analog_vcf, wave_terrain), 13 oscillator primitives (formant, grainlet, harmonic, nes_triangle, super_square, variable_saw, variable_shape, vosim, wavetable, z…), plus `drums/`, `physical_modelling/`, `speech/`, `chords/`, `fm/`, `noise/`, `fx/`, `envelope.h`, `voice.cc` (2 engines + aux mixer — the voice architecture).
  - Port precedent: `pichenettes/plaits-editor` — "Editor for Mutable Instruments Plaits models", **MIT**, JavaScript, runs in the browser (74 stars, pushed 2022-12-18); README: *"License ======= MIT license. By: Emilie Gillet"*. It writes the wavetable files Plaits loads — a working browser-side wavetable editor to study.
  - What Anvil takes: the model-dispatch architecture (one macro knob → shape table with parameter interpolation) for the flagship's osc section; specific models (super-saw swarm, wave terrain, six-op FM, phase distortion = engine2's "modern" set); quantizer scales for the scale-lock layer; the Plaits editor's file format + UI as the model for a "custom models" feature and for the pack authoring tooling.
- **Fold-in verdict:** **PORT-STUDY — engine (oscillator bank) + UI (model browser/editor), packs (model format)**.

### 6. Mutable utility modules — Tides2, Warps, Peaks, Frames, Marbles, Stages, Streams

- Links: https://github.com/pichenettes/eurorack/tree/master/tides2 · .../warps · .../peaks · .../frames · .../marbles · .../stages · .../streams
- Core contribution: the supporting DSP that fills the gaps T9 lists — modulation shapes (Tides2/Frames/Stages), FX (Warps), percussion+envelopes (Peaks), generative logic (Marbles), character filters/dynamics (Streams).
- KEY FACTS
  - **Licence verbatim:** MIT (headers checked on tides.cc 2013, warps/dsp/modulator.cc 2014, peaks/peaks.cc 2014, frames/frames.cc, marbles/marbles.cc, stages/stages.cc, streams/streams.cc — all carry the MIT grant; eurorack README: STM32 = MIT).
  - Tides2 = `poly_slope_generator.cc/h` + `ramp_shaper.h` + `ramp/` (poly-slope LFO/envelope with shaped ramps; Tides v1 = `generator.cc`). Warps = `vocoder.cc`, `filter_bank.cc`, `quadrature_oscillator.h`, `quadrature_transform.h`, `sample_rate_conversion_filters.h`, `oscillator.cc` (vocoder + carrier design — the FX rack's formant/vocoder module). Peaks = `processors.cc` + `drums/` + `modulations/` + `number_station` (LPG percussion + AD envelopes). Frames = `keyframer.cc` + `poly_lfo.cc` (4-point keyframer morphing — a UI/mod concept). Marbles = `random/` + `scale_recorder.h` + `clock_self_patching_detector.h` (generative/random — feeds the sequencer). Stages = `segment_generator.cc` (multi-segment envelopes). Streams = `svf.cc`, `compressor.cc`, `vactrol.cc`, `lorenz_generator.cc` (filter/dynamics character).
  - Activity: within eurorack (2023-12-13).
  - What Anvil takes: a ready-made "modulation shape" vocabulary (poly-slope, segments, keyframer) for T9 gap #2; vocoder/filter-bank for FX; LPG drums for the percussion kit; Marbles' random model for the generative layers of the sequencer (pair with Stochas, entry 16).
- **Fold-in verdict:** **PORT-STUDY — mod (shapes/keyframer), FX (vocoder), engine (percussion)**; Marbles = ADOPT-IDEA for sequencer randomness.

### 7. Airwindows (+ its modern distribution `airwin2rack`) — ~500 dependency-free effects, MIT

- Links: https://github.com/airwindows/airwindows (the whole library, MIT) · https://github.com/baconpaul/airwin2rack ("Airwindows Consolidated": static lib + VCV Rack + CLAP/VST3/AU/LV2/Standalone) · official consolidated page: https://www.airwindows.com/consolidated
- Core contribution: the largest single pool of small, self-contained, MIT effect algorithms in existence — one folder per effect, no framework, no dependencies. The densest port-study source for Anvil's FX rack; airwin2rack is how the ecosystem consumes it uniformly.
- KEY FACTS
  - **Licence verbatim (airwindows/airwindows/LICENSE):** *"MIT License / Copyright (c) 2018 Chris Johnson"* + full MIT text. The repo's own manifest opens: *"These are MIT licensed open source: see my github at https://github.com/airwindows/airwindows for the source."*
  - **Counts [from live listings]:** `plugins/WinVST/` = **527 effect folders**, `plugins/MacVST/` = **526**; the repo's manifest `what.txt` = 510 lines (424 matching the `"<Name> is <description>"` pattern — the rest are section/wrapped lines); many are generations of one family (ADClip7/8/9, Air→Air4, Console5-9). `Airwindopedia.txt` = 1,240,802 bytes of documentation (categorised: Ambience, Amp Sims, Bass, Biquads, Brightness, Clipping, Consoles, Distortion…). Repo: **1,244 stars**, 88.2 MB, **last push 2026-10-04**, created 2018-01-22, C++.
  - Layout per effect: `plugins/<platform>/<Effect>/` with e.g. `ADClip7.cpp/.h` + `ADClip7Proc.cpp` + a VST project — i.e. 2-3 files of plain C++ per effect, the exact portability profile a browser FX kernel wants (Emscripten-compilable or hand-portable to a worklet).
  - Upstream is **read-only by policy** (CONTRIBUTING verbatim: *"Airwindows is read-only. There's been only one pull ever, and that was to help Expert Sleepers's port to Eurorack hardware. If there are changes to be made, I will make them. This is for OTHER PEOPLE to use, not for me to get other people to do things for me in this repo."*) — and there is **no README.md** in the repo (docs live in Airwindopedia/what.txt).
  - airwin2rack: **MIT** — LICENSE.md verbatim *"Copyright 2019-2026, Paul Walker"* + MIT text. **721 stars**, 8.5 MB, last push 2026-10-04. README: *"It's all the airwindows presented in three lovely flavors: 1. As a static library with a uniform registry and access pattern… (AirwinRegistry.h … airwin2rackbase operator objects), 2. As module for VCV Rack…, 3. As a CLAP/VST3/AU/LV2/Standalone plugin for your DAW."* Build target for the plugin: `awcons-products` (JUCE).
  - What Anvil takes: (a) pick effects by family for the FX rack — reverbs (kPlate140/240, kChamberAR, Verbity…), delays (TapeDelay2, Doublelay, PitchDelay), EQs (Air/PurestAir, Biquad family), dynamics (ADClip9, ClipOnly3), consoles/tape colour (Console5-9, ToTape), distortion (Density, Hard Vacuum, Mackity); (b) factory FX presets as pack content; (c) airwin2rack's **registry pattern** (one metadata table + uniform parameter model over hundreds of small effects) is what Anvil's FX browser wants; the registry also tells you which effects the community rates.
  - Browser/wasm: per-effect port work (no official web build found in this pass); the sources are dependency-free C++ so a wasm build per effect or a worklet hand-port are both viable; MIT removes licence friction.
- **Fold-in verdict:** **PORT-STUDY — FX (rack algorithms + preset packs); ADOPT-IDEA for the effect-registry metadata pattern (FX + UI)**.

### 8. `Chowdhury-DSP/chowdsp_utils` — the ChowDSP module library (per-module licences, NOT blanket BSD-3)

- Links: https://github.com/Chowdhury-DSP/chowdsp_utils
- Core contribution: Jatin Chowdhury's JUCE DSP module collection — filters (incl. modal filter banks), reverb, waveshapers, EQ, compressor, oscillators, SIMD — the engine behind the ChowDSP plugins; several genuinely novel algorithms to study.
- KEY FACTS
  - **Licence — the brief's "BSD-3" assumption does NOT hold for the modules Anvil wants. LICENSE.md verbatim, in full:** *"# chowdsp_utils / Each module in this repository has its own unique license. If you would like to use code from one of the modules, please check the license of that particular module. / If you are making a proprietary or closed source app and would like to use code from a module that is under a GPL-style license, please contact chowdsp@gmail.com for non-GPL licensing options. / All non-module code in this repository (tests, examples, benchmarks, etc.) is licensed under the GPLv3."*
  - **Per-module `license:` declarations read from each module's JUCE declaration header (2026-10-06):** GPLv3 — chowdsp_compressor, chowdsp_dsp_data_structures, chowdsp_dsp_utils, chowdsp_eq, chowdsp_filters, chowdsp_modal_dsp, chowdsp_reverb, chowdsp_sources, chowdsp_waveshapers. BSD-3-Clause — chowdsp_buffers, chowdsp_math, chowdsp_simd, chowdsp_core. (So: algorithms ≈ GPLv3; plumbing ≈ BSD-3.)
  - Module map: `modules/dsp/` = the 12 above; `modules/plugin/` (clap_extensions, parameters, plugin_base/state/utils, presets, version), `modules/common/` (core, logging, reflection), `modules/music/` (chowdsp_rhythm), `modules/gui/` (foleys, gui, visualizers — the plugin-framework layer).
  - Activity: last push **2026-09-24**, **372 stars**, 6.3 MB, C++.
  - What Anvil takes: **chowdsp_modal_dsp** (`ModalFilters/` — modal filter bank; the DSP counterpart to Rings' resonator, worth reading side-by-side), **chowdsp_filters** (higher/lower-order filter designs), **chowdsp_reverb**, **chowdsp_waveshapers** (nonlinear saturation shapes for the drive family), **chowdsp_dsp_utils** (Convolution/Delay/Resampling/Processors), **chowdsp_sources** (oscillators). Licence handling: the BSD-3 modules are adaptation-clean; the GPLv3 modules are study-and-reimplement for Anvil's AGPL app (and GPL re-use would still be licence-compatible, but the house doctrine is reimplement + attribute).
- **Fold-in verdict:** **PORT-STUDY — engine (filters/modal) + FX**; note the licence matrix — do not treat this repo as BSD-3 wholesale.

### 9. `Chowdhury-DSP/chowdsp_wdf` — wave-digital-filter toolkit, BSD-3

- Links: https://github.com/Chowdhury-DSP/chowdsp_wdf
- Core contribution: a header-only C++17 library for Wave Digital Filters — the circuit-modelling element set (R/C/L, diodes, triodes, transformers) that ChowDSP's analog-modelled effects are built from; the principled route to a "circuit" drive family without a SPICE engine.
- KEY FACTS
  - **Licence verbatim:** *"BSD 3-Clause License / Copyright (c) 2022, Chowdhury-DSP / All rights reserved."* + standard three clauses.
  - Activity: last push **2026-07-03**, **188 stars**, 791 KB (small, focused, current), C++.
  - What Anvil takes: WDF element classes and adaptor structures for the FX rack's saturation/drive family (diode clipper, tube stage, transformer); the paper trail (Chowdhury's DAFx work + the WDF literature) gives Anvil's "analog" story rigour. Kernel-by-kernel reimplementation in a worklet is realistic at this size; vendoring the header is licence-clean.
- **Fold-in verdict:** **PORT-STUDY — FX (analog saturation/drive family)**; BSD-3 means vendor-or-reimplement is a free choice.

### 10. The ChowDSP plugin trio — ChowTape (GPL-3.0), ChowMatrix (BSD-3), ChowKick (BSD-3)

- Links: https://github.com/jatinchowdhury18/AnalogTapeModel (the repo formerly named ChowTapeModel — "CHOW Tape") · https://github.com/Chowdhury-DSP/ChowMatrix · https://github.com/Chowdhury-DSP/ChowKick
- Core contribution: three complete reference plugins — a tape-machine physical model, a growable delay-line tree, and a circuit-modelled kick drum. Three concrete algorithmic blueprints for Anvil.
- KEY FACTS
  - **Licences (the brief said BSD-3 for all three — only two are):**
    - **AnalogTapeModel / CHOW Tape = GPL-3.0.** LICENSE = the full GNU GPL v3 text (35,149 B); README badge "License: GPLv3"; README: *"CHOW Tape Model is a physical model of an analog tape machine, implemented as an audio plugin. The physical model is described in a paper presented at the 2019 DAFx conference."* (Sony TC-260 basis, extended to a range of reel-to-reels.) 1,437 stars, 122.8 MB, last push 2025-04-09.
    - **ChowMatrix = BSD-3-Clause.** LICENSE verbatim: *"BSD 3-Clause License / Copyright (c) 2020, jatinchowdhury18"*. README: *"CHOW Matrix is a delay effect, made up of an infinitely growable tree of delay lines, each with individual controls for feedback, panning, distortion, and more."* 336 stars, 4.0 MB, last push 2022-07-16 (dormant but complete).
    - **ChowKick = BSD-3-Clause.** LICENSE verbatim: same BSD-3 text, *"Copyright (c) 2020, jatinchowdhury18"*. README: *"ChowKick is a kick drum synthesizer plugin based on creative modelling of old-school drum machine circuits. MIDI input to the plugin triggers a pulse with a parameterized size and shape. The pulse is then passed into a resonant filter which can be tuned to a specific frequency, or matched to the frequency of the incoming MIDI notes."* 200 stars, 1.9 MB, last push 2023-01-16.
  - What Anvil takes: **ChowKick's pulse→resonant-filter kick is the exact architecture for Anvil's drum module** (and it is BSD-3 — the cleanest kick blueprint available); ChowMatrix's delay tree + per-node controls is a flagship "delay network" FX beyond T5 §16's chorus/delay spec; CHOW Tape's hysteresis + transport model is the tape/lo-fi colour family (GPL-3.0 → reimplement, but the DAFx paper is public background).
  - Browser: all three are C++/JUCE desktop code; the algorithms are small enough to reimplement in a worklet (ChowKick especially — a handful of kernels).
- **Fold-in verdict:** **PORT-STUDY — engine (drums: ChowKick, BSD-3) + FX (delay network: ChowMatrix BSD-3; tape: ChowTape GPL-3.0 study)**.

### 11. `SamiPerttu/fundsp` — Rust audio DSP with inline graph notation (MIT OR Apache-2.0)

- Links: https://github.com/SamiPerttu/fundsp
- Core contribution: a Rust audio processing/synthesis library whose "inline graph notation" expresses audio networks as composable, zero-cost types; a large operator environment (filters, oscillators, noise, FFT, procedural tools) plus analytic frequency-response computation for linear networks.
- KEY FACTS
  - **Licence verbatim (Cargo.toml):** `license = "MIT OR Apache-2.0"` (crate v0.23.0); both LICENSE-MIT and LICENSE-APACHE files present; GitHub API detects Apache-2.0.
  - README verbatim: *"FunDSP is an audio DSP (digital signal processing) library for audio processing and synthesis. FunDSP features a powerful inline graph notation for describing audio processing networks… Another innovative feature of FunDSP is its signal flow system, which can determine analytic frequency responses for any linear network."* Uses: games/apps, education, prototyping. Categories: `no_std`.
  - Activity: last push **2026-03-03**, **1,221 stars**, 2.3 MB, Rust.
  - What Anvil takes: not code (Rust ≠ the JS/worklet target) but three things: (a) the **graph-notation idea** for a future modular voice/FX graph (pair with T5's one-mixer-worklet decision — graph at the DSP layer, not the node layer); (b) its operator list as a completeness checklist for Anvil's engine; (c) if Anvil ever wants a wasm-compiled DSP core, fundsp is the strongest Rust candidate (wasm32 target, no_std, permissive dual licence) — you'd write your own wasm-bindgen shim (no official web bindings).
- **Fold-in verdict:** **REFERENCE + ADOPT-IDEA — engine architecture (graph/composition, operator inventory); possible future wasm core**. (Header rule: one verdict — **ADOPT-IDEA, engine**.)

### 12. DISTRHO stack — DPF (ISC) + Ildaeil + Carla (GPL-2.0)

- Links: https://github.com/DISTRHO/DPF · https://github.com/DISTRHO/Ildaeil · https://github.com/falkTX/Carla (note: `DISTRHO/Carla` does not exist — Carla lives under falkTX)
- Core contribution: the FLOSS plugin framework (DPF), the mini plugin-host-as-plugin (Ildaeil), and the full host/patchbay (Carla) — the reference for drawing the plugin↔host boundary, plus a pool of ISC-licensed example DSP.
- KEY FACTS
  - **DPF licence verbatim (LICENSE):** *"Copyright (C) 2012-2025 Filipe Coelho <falktx@falktx.com> / Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies. [ISC disclaimer]"*. README: *"DPF is released under ISC, which basically means you can do whatever you want as long as you credit the original authors. Some plugin formats may have additional restrictions, see LICENSING.md for details."* Formats: LADSPA, DSSI, LV2, VST2, VST3, CLAP + JACK/Standalone. Architecture note: *"Plugin DSP and UI communication is done via key-value string pairs"* — a messaging pattern for Anvil's UI↔audio thread. **872 stars**, 28.5 MB, last push 2026-10-04.
  - **Ildaeil licence:** LICENSE = GPL-2.0 text (GitHub API: GPL-2.0). README: *"DISTRHO Ildaeil is mini-plugin host working as a plugin, allowing one-to-one plugin format reusage… basically works as a mini-wrapper around Carla."* **183 stars**, 2.6 MB, last push 2026-02-21.
  - **Carla licence: there is NO LICENSE file** (`/license` → 404 — verified). README verbatim: *"It's open source and licensed under the GNU General Public License, version 2 or later."* Features: LADSPA, DSSI, LV2, VST2/3, AU hosting; SF2/3 and SFZ sound banks. **2,181 stars**, 98.3 MB, last push 2026-06-22.
  - Browser: none of the three target the web (no wasm build); desktop reference, not a port source.
  - What Anvil takes: DPF's example plugins as ISC-licensed DSP to study/adapt; the key-value state pattern for the host/app boundary; Carla's SF2/SFZ loading logic for the sampler content story (T9 gap #5) and its rack/patchbay UI concepts.
- **Fold-in verdict:** **REFERENCE — engine/UI (host boundary, state pattern) + packs (SF2/SFZ loader logic)**; **SKIP** any direct port.

### 13. `amsynth/amsynth` — compact virtual-analog synth, GPL-2.0-or-later

- Links: https://github.com/amsynth/amsynth
- Core contribution: a small, complete subtractive engine — 2 osc w/ hard sync, 12/24 dB multimode filter, 2 ADSR, LFO, mono/poly/legato, distortion + reverb — with unusually readable C++ and a voice-allocation unit + microtuning map worth studying.
- KEY FACTS
  - **Licence verbatim (source header, src/core/synth/Synthesizer.cpp):** *"amsynth is free software; you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation; either version 2 of the License, or (at your option) any later version."* (COPYING = GPLv2 text; GitHub API: GPL-2.0.)
  - Inventory (`src/core/synth/`): Oscillator.cpp (saw/square/sine/noise + hard sync), LowPassFilter.cpp, ADSR.cpp, Distortion.cpp, SoftLimiter.cpp, **VoiceAllocationUnit.cpp** (voice steal/priority policy), **TuningMap.cpp** (microtuning — compare with T9 §4's .scl/.kbm implementation), Preset.cpp/PresetController.cpp (banks of 128), Synthesizer.cpp, MidiController.cpp.
  - Activity: last push **2026-10-02**, **506 stars**, 9.8 MB, C++; created 2012 (long-lived).
  - What Anvil takes: VoiceAllocationUnit as a third data point for the pool/steal law (with stmlib's voice_allocator and Pattern Forge's oldest-first law — reconcile all three into Anvil's spec); TuningMap as a cross-check for microtuning; SoftLimiter + Distortion for the master chain; the whole repo as a sanity reference for "classic subtractive" behaviour tests (null-test material for T5 §19's battery).
- **Fold-in verdict:** **PORT-STUDY — engine (voice allocation, tuning, osc/filter sanity), FX (master limiter/distortion check)**.

### 14. `quamplex/geonkick` — percussive synthesizer (drum architecture), GPL-3.0

- Links: https://github.com/quamplex/geonkick (README lists mirrors at codeberg.org and gitlab.com)
- Core contribution: the most complete open drum-synth architecture to read — 16 instruments × 3 layers × 3 oscillators, per-element filters/envelopes, FM (OSC1→OSC2), distortion set, limiter, choke groups, JSON kit save + SFZ export. The expansion reference for Pattern Forge's drum kit (T9 entry 7).
- KEY FACTS
  - **Licence verbatim (README):** *"**License:** GNU General Public License, Version 3"*; LICENSE = GPLv3 text (35,149 B). *"**Version:** 3.9.0"*.
  - Features (README, selected verbatim): 16 instruments; 3 layers; 3 oscillators per layer — *"sine, square, triangle, saw-tooth, noise(White & Brownian), sample (wav, ogg, flac)"*; *"initial phase control"*; *"amplitude, frequency, noise density, and sample pitch shift envelope"*; *"low, band and high pass filter, cutoff & resonance envelope"*; *"distortion (hard-clip, tan, arctan, log, exp, polynomial)"*; *"FM synthesis OSC1->OSC2"*; amplitude envelope & kick length; limiter; *"Playmode: full, note off, cut, choke groups"*; *"Export: WAV 16/24/32, FLAC, Ogg, SFZ"*; scaleable UI.
  - Activity: last push **2026-10-06** (very active), **192 stars**, 69.6 MB, C++.
  - What Anvil takes: the layer/oscillator/envelope kit model (flatten Pattern Forge's nine hard-coded voices into this generic model), choke groups + play modes for pads, kit-as-JSON + SFZ export as pack content formats, velocity→amplitude and pitch-to-note behaviours; its distortion menu is a ready-made drive palette.
  - Browser: needs libsndfile/JACK/LV2 desktop deps — architecture reference, not a port.
- **Fold-in verdict:** **ADOPT-IDEA — engine (drum kit architecture) + packs (kit JSON/SFZ export)**.

### 15. `mtytel/vital` + `asb2m10/dexed` — two GPL-3.0 synth codebases (wavetable+modulation / 6-op FM)

- Links: https://github.com/mtytel/vital · https://github.com/asb2m10/dexed
- Core contribution: the two big port-study synths of the pair: Vital = spectral-warping wavetable synth with a full modulation system (closest open analogue to Anvil's T9 gaps #1/#2); Dexed = DX7-compatible 6-op FM whose engine core (msfa) is Apache-2.0.
- KEY FACTS
  - **Vital licence:** LICENSE = GNU GPL v3 text; README verbatim: *"The source code is licensed under the GPLv3. If you download the source or create builds you must comply with that license."* and *"If you are making a proprietary or closed source app and would like to use Vital's source code, contact licensing@vital.audio for non GPLv3 licensing options."* Restrictions to respect: no App-Store distribution, no use of the Vital/Tytel marks, no connecting to vital.audio services, and factory presets are under a separate non-redistributable licence. Activity: last push **2023-05-25** (dormant), **2,159 stars**, 31.6 MB, C++.
  - **Dexed licence:** LICENSE = GPLv3 text; README verbatim: *"Dexed is licensed on the GPL v3. The msfa component (acronym for music synthesizer for android, see msfa in the source folder) stays on the Apache 2.0 license to be able to collaborate between projects."* → **the FM engine (msfa) is Apache-2.0**: paste-adaptable with notices — the cleanest FM implementation source for Anvil. Activity: last push **2026-09-21**, **3,548 stars**, 97.5 MB, C++; DX7 sysex patch ecosystem (check per-patch licences before shipping any presets).
  - What Anvil takes: Dexed/msfa — 6-op FM algorithm structures + envelope/algorithm tables for an FM oscillator mode and a DX7 patch-loading UX; Vital — wavetable engine + modulation-matrix architecture/UI (sources→destinations, LFOs/envelopes, drag-and-drop mod UI) as the model for Anvil's per-voice mod system (T9 gap #2) and its wavetable module's "spectral warp" options.
  - Browser: no official web builds; both C++.
- **Fold-in verdict:** **PORT-STUDY — engine (FM via msfa/Apache-2.0; wavetable+mod via Vital) + UI (mod matrix)**.

### 16. `surge-synthesizer/stochas` — probabilistic polyrhythmic step sequencer, GPL-3.0

- Links: https://github.com/surge-synthesizer/stochas · https://stochas.org (docs)
- Core contribution: a MIDI step sequencer whose whole point is controlled randomness — the reference model for Anvil's sequencer's generative layer (T9 gap #3: native sequencing + step UI).
- KEY FACTS
  - **Licence verbatim:** COPYING = GPLv3 text; source header (src/PluginProcessor.cpp): *"Copyright (C) 2016 by Andrew Shakinovsky … You may also use this code under the terms of the GPL v3 (see www.gnu.org/licenses)."* GitHub API: GPL-3.0.
  - Activity: last push **2026-10-05** (actively maintained), **556 stars**, **534 KB** (tiny — mostly UI + sequencing logic), C++; latest release v1.3.13 (2024-11-16).
  - Provenance/features (stochas.org, verbatim highlights): *"Open-source advanced probabilistic polyrhythmic sequencer plugin"*; randomness = *"Randomly determine whether a note should be played or not… Randomly choose between two or more notes… Add slight timing randomness… Add randomness to velocity and length"*; *"Polyrhythms - Create up to 4 simultaneous layers with different time signature, playback speed and/or number of steps per layer"*; patterns; *"Groove and humanization — steps can be individually shifted off the grid. Basic swing… Grooves can be imported from MIDI files"*; chords; scale/note-name customization; MIDI-controllable live features. History: originally commercial (Audio Vitamins), open-sourced 2020; sprang from Andrew Shakinovsky's JSFX "Stochasticizer".
  - What Anvil takes: the stochastic feature set as the spec for the step sequencer's per-step probability model (play/skip, note choice, velocity, timing jitter, length), the polyrhythm layer model, groove import, and its compact codebase as a structure reference; the UI (grid + per-row panels) is a good benchmark for Anvil's step editor.
  - Browser: JUCE desktop C++; the sequencing math is trivially portable to JS — the value is the model, not the code.
- **Fold-in verdict:** **ADOPT-IDEA — sequencer (stochastic step model + polyrhythm) + UI**.

### 17. Wavetable tooling — `wt-tool.py` (in Surge), `okwt` (MIT), `plaits-editor` (MIT, browser)

- Links: https://github.com/surge-synthesizer/surge/blob/main/scripts/wt-tool/wt-tool.py · https://github.com/drzhnn/okwt · https://github.com/pichenettes/plaits-editor
- Core contribution: the wavetable format/authoring toolchain Anvil's pack pipeline needs — read/write/explode the Surge `.wt` format, convert arbitrary audio/images into wavetables with correct metadata chunks, and two browser-proven editor precedents.
- KEY FACTS
  - **wt-tool.py**: Python 3 (259 lines) inside the surge repo — header verbatim: *"# A tool for creating, exploding, and inspecting Surge XT's WT files"*; writes/reads the `vawt` container Pattern Forge already parses (T9 §3). Licence = the Surge repo's **GPL-3.0** (LICENSE; GitHub API GPL-3.0; 4,049 stars, 642 MB, last push 2026-10-01) → reimplement, don't copy (the format itself is public and already handled in PF's parser).
  - **okwt**: **MIT** — LICENSE verbatim *"MIT License / Copyright (c) 2023 Denis Druzhinin"*. Python, 81 stars, 98 KB, last push 2025-10-07. Reads `.wav` 16/24/32-bit, `.wt` (Surge, Bitwig, Dune3), `.vitaltable`; writes metadata chunks (uhWT, srge); creates wavetables from audio, images, and non-audio files; documents frame-size conventions per synth (Hive/Vital/Phase Plant/Dune 2048, Surge/Ableton 1024, Bitwig 256). MIT = logic can be adapted into Anvil's authoring scripts.
  - **plaits-editor**: **MIT** (*"License ======= MIT license. By: Emilie Gillet"*), JavaScript, **runs in the browser** (74 stars, last push 2022-12-18). Official editor for Plaits models — proves wavetable/model editing is a solved browser problem and documents the Plaits wavetable encoding.
  - What Anvil takes: robust `.wt` read/write + metadata conventions for the pack schema (extends T9 §16's validator), image→wavetable generation for content tooling, and the "wavetable = diffable authoring artifact" doctrine already in the house pipeline.
- **Fold-in verdict:** **PORT-STUDY — packs (authoring tooling) + UI (wavetable editor feature)**.

### 18. Permissive wavetable/IR asset repos — AKWF-FREE (CC0), wavedit-online (CC0 stated), IR-Library (MIT)

- Links: https://github.com/KristofferKarlAxelEkstrand/AKWF-FREE · https://github.com/smpldsnds/wavedit-online · https://github.com/itsmusician/IR-Library
- Core contribution: three content libraries that clear the licence bar for factory content (T9 annex-03 veto list): single-cycle waveforms, wavetable banks, and impulse responses — enough raw material to seed Anvil's factory packs with zero licence risk.
- KEY FACTS
  - **AKWF-FREE** (Adventure Kid Waveforms): **CC0 1.0** — LICENSE.md verbatim *"CC0 1.0 Universal"* + full CC0 text. **609 stars**, 862.6 MB, last push 2026-07-14. Content: 600-sample, 16-bit, 44.1 kHz mono one-cycle waves (the classic AKWF set) plus platform-specific variants (AKWF--Surge, --Synthesis-Technology, --u-he-Zebra, --Elektron--Model Samples, --Reaktor…). README documents the 600-sample length convention and the D1+2 tuning quirk.
  - **wavedit-online** ("A growing library of free wavetable banks shared by WaveEdit users"): **706 WAV files**, 18.6 MB, 45 stars, last push 2023-10-06. README verbatim: *"All wavetables here are under CC0 1.0 Universal (CC0 1.0) Public Domain Dedication. Each bank in memory consists of 64 wavetables, in an 8x8 array using 256 fixed-sample-length tables"*. **CAVEAT [verified]: the repo has no LICENSE file** (GitHub API `license: none`) — the CC0 claim lives only in the README; archive the README text in the licence manifest before shipping any of these banks. (The editor that consumes it: `AndrewBelt/WaveEdit` — "Synthesis Technology WaveEdit", GPL-3.0 app; the app is GPL, the bank data is the CC0 part.)
  - **IR-Library**: **MIT** — License.md verbatim *"Copyright (c) 2022 Conner"* + MIT text; README: *"A public library of impulse responses for anyone to use freely under the MIT License… ~1 GB uncompressed and contains 738 IRs"* (Rooms, Plates, Springs, Hardware, Instruments, Outdoors, Synthesized, Utility…). 81 stars, 970.5 MB, last push 2025-07-26. MIT = permissive for factory presets/packs.
  - What Anvil takes: AKWF as the single-cycle source for wavetable builtins and import tests (already an annex-03 source — now with the repo's own CC0 statement + count); wavedit-online banks as ready 64×256 CC0 wavetable packs; IR-Library for convolution-reverb/IR presets (and as test material for T5 §15's ConvolverNode path). All three slot into the existing pack pipeline (T9 §16-17) as factory content with per-card licence lines.
- **Fold-in verdict:** **ADOPT-IDEA — packs (factory content sourcing)**.

---

## Dead ends (logged; ≤3 attempts per URL respected)

- `mutable-instruments/eurorack`, `mutable-instruments/stmlib` do **not** resolve on GitHub — the MI firmware lives at `pichenettes/*` (Émilie Gillet's account). Use those URLs, not the brand name.
- `Chowdhury-DSP/ChowTapeModel` and `jatinchowdhury18/ChowTapeModel` → 404; the repo was renamed **`jatinchowdhury18/AnalogTapeModel`** ("CHOW Tape"). `ChowMatrix`/`ChowKick` are under the org `Chowdhury-DSP`.
- `DISTRHO/Carla` → 404; Carla is **`falkTX/Carla`**. Carla has **no LICENSE file** at all (`/license` 404) — its only licence statement is the README line quoted above.
- `surge-synthesizer/airwin2rack` → 404; the port is **`baconpaul/airwin2rack`**. `synthtech/WaveEdit` and `plausible/waveedit` → 404; the editor is **`AndrewBelt/WaveEdit`**.
- `airwindows/airwindows` has **no README.md** (404) — docs live in `Airwindopedia.txt` (1.24 MB), `what.txt` (manifest) and `CONTRIBUTING`.
- `pichenettes/eurorack` has **no root LICENSE file** (GitHub: no-license-file) — licence = README block + per-file headers; the AVR-side helper repos (`avril`, `avrilx`) also carry no licence files.
- `smpldsnds/wavedit-online` has **no LICENSE file** despite the CC0 statement in its README (flagged in entry 18).
- waveeditonline.com is blocked to web_extract ("private or internal network address"); its CC0 claim was verified from the `smpldsnds/wavedit-online` README and corroborated by `atsushieno/open-vital-resources` ("WAVEEDIT ONLINE … distributed under the CC0 Public Domain dedication").
- GitHub **Search API** rate-limited early in the pass (HTTP 403 ×3, 30/hr bucket) — everything was re-derived via the core REST API and web search; web-search backend had quota errors but returned keyless-tier results.
- Guessed file paths that 404'd and were replaced: `src/core/amsynth.cpp` / `src/main.cpp` in amsynth (used `src/core/synth/Synthesizer.cpp`), `amynth.h` licence grep (empty), `plaits/dsp/voice.cc` engine count via `engine_` grep (not a model count — models counted by directory listing instead), `braids/macro_oscillator.h` enum grep (the shape enum lives in `braids/settings.h` — counted there: 49).
- `okwt` README mentions a tool "osc-gen" — not verified in this pass (optional; no repo confirmed).
- Stochas README is build instructions only; features were taken from stochas.org/stochas/ (documented above).
- Not re-researched (already covered): Signalsmith, Elementary, dsp.js, Soundpipe, STK, Faust, Tuna, WAM, lamejs, SoundTouch, MoogLadders — see T5 §18.

## Fold-in summary

| # | Item | Verdict | Plan area |
|---|------|---------|-----------|
| 1 | pichenettes/eurorack (firmware monorepo) | PORT-STUDY | engine / FX / mod |
| 2 | pichenettes/stmlib | PORT-STUDY | engine / mod |
| 3 | Rings + Elements (modal/physical) | PORT-STUDY | engine / mod |
| 4 | Clouds (granular/reverb) | PORT-STUDY | engine / FX |
| 5 | Braids + Plaits (osc models) | PORT-STUDY | engine / UI / packs |
| 6 | Tides2/Warps/Peaks/Frames/Marbles/Stages/Streams | PORT-STUDY + ADOPT-IDEA | mod / FX / engine / sequencer |
| 7 | Airwindows + airwin2rack | PORT-STUDY + ADOPT-IDEA | FX / UI / packs |
| 8 | chowdsp_utils | PORT-STUDY | engine / FX |
| 9 | chowdsp_wdf | PORT-STUDY | FX |
| 10 | ChowTape / ChowMatrix / ChowKick | PORT-STUDY | engine / FX |
| 11 | fundsp | ADOPT-IDEA | engine |
| 12 | DPF / Ildaeil / Carla | REFERENCE | engine / UI / packs |
| 13 | amsynth | PORT-STUDY | engine / FX |
| 14 | geonkick | ADOPT-IDEA | engine / packs |
| 15 | Vital + Dexed | PORT-STUDY | engine / UI |
| 16 | Stochas | ADOPT-IDEA | sequencer / UI |
| 17 | wt-tool.py / okwt / plaits-editor | PORT-STUDY | packs / UI |
| 18 | AKWF-FREE / wavedit-online / IR-Library | ADOPT-IDEA | packs |

**Bottom line:** the MI firmware (MIT where it matters) plus Airwindows (MIT) cover most of Anvil's engine + FX port-study needs with zero licence friction; ChowDSP and the plugin ecosystem supply the circuit-modelling and drum-machine blueprints (mind the GPL/BSD split); Stochas + Marbles are the sequencer's generative DNA; the wavetable/IR asset repos are factory-content-ready (one README-only CC0 claim to paper over). Nothing here needs cloning to start: every file referenced is readable per-file over the API's raw endpoint.

```json
{"file": "C:\\Users\\Moddy\\anvil\\research\\github\\G1-dsp-engines-and-libs.md", "items_count": 18, "dead_ends": ["mutable-instruments/* repo names do not resolve (use pichenettes/*)", "ChowTapeModel renamed to jatinchowdhury18/AnalogTapeModel", "DISTRHO/Carla 404 (falkTX/Carla); Carla has no LICENSE file", "surge-synthesizer/airwin2rack 404 (baconpaul/airwin2rack)", "synthtech/WaveEdit + plausible/waveedit 404 (AndrewBelt/WaveEdit)", "airwindows/airwindows has no README.md", "pichenettes/eurorack has no root LICENSE file", "smpldsnds/wavedit-online has no LICENSE file despite CC0 README claim", "waveeditonline.com blocked to web_extract", "GitHub Search API rate-limited (403 x3)", "amsynth guessed paths 404 (used src/core/synth/Synthesizer.cpp)", "braids shape count lives in settings.h (49), not macro_oscillator.h", "okwt-referenced osc-gen tool unverified", "stochas README featureless (used stochas.org)"]}
```
