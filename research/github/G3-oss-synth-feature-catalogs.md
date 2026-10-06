# G3 — OSS synth & sequencer feature catalogs → the Anvil feature menu

**Written:** 2026-10-07 · for the Anvil research build (`C:\Users\Moddy\anvil`) · **Method:** GitHub reconnaissance with authenticated `gh` (repo view / `gh api` contents of README, LICENSE, source trees, plugins manifests, module parameter files; release metadata), plus first-party vendor pages and manuals read this session (Vaporizer2 manual PDF + vast-dynamics.com, stochas.org, cardinal.kx.studio, patchstorage beta API, hydrogen manual, Dexed site, Helio docs, tytel.org/helm). Every licence below was read from the repository's own LICENSE/COPYING file (or the source-file header where the repo ships no license file) — quoted VERBATIM where quoted. **Read-only pass: no clones, no installs, no writes outside this file.** Search-API rate limits were hit once (403) and worked around with the core contents API — logged below.

**Already owned — do NOT re-research (cited only):** T9 `C:\Users\Moddy\anvil\research\reuse\T9-pattern-forge-reuse.md` (Pattern Forge reuse inventory — SynthX engine, wavetables, microtuning, MPE, performance layer, master tap, store/pack pipeline, verify battery) · T3 `C:\Users\Moddy\anvil\research\groovebox\T3-groovebox-sequencing.md` (groovebox sequencer baseline: step model, conditions, ratchet/micro-timing, swing math, arrangement models) · T4 `C:\Users\Moddy\anvil\research\matrix\T4-synth-feature-matrix.md` (closed flagships) · S3 Vital · S4 Surge XT (via T4 §2 and T9 annex 01/02: "reimplement, never paste; Surge factory data NOT shippable").

**Verdict vocabulary:** **ADOPT-IDEA** = reimplement the concept clean-room in Anvil (never paste code — all engines here are GPL/AGPL class) · **REFERENCE** = design-study only, no near-term build · **SKIP** = not wanted. Effort: S ≤ a day, M = days, L = a week+.

**How to use:** entries 1–9 are the synth-side feature census (engine/mod/FX), 10–15 the sequencer-side semantics, 16–17 the packs/community lane. The closing table is the actual menu (item → project → effort → plan area → v1/v1.x/later/skip).

---

## A. Synths — engines, modulation, FX

### 1. Vaporizer2 (VAST Dynamics) — the most feature-complete OSS wavetable hybrid; the closest thing to an Anvil v1 spec sheet

**Links:** https://github.com/VASTDynamics/Vaporizer2 · https://www.vast-dynamics.com/?q=Vaporizer2 · manual PDF `Documentation/Vaporizer2Manual.pdf` (raw: https://raw.githubusercontent.com/VASTDynamics/Vaporizer2/master/Documentation/Vaporizer2Manual.pdf) · release v3.5.0

**Core contribution:** a full hybrid wavetable/additive/subtractive synth + sampler workstation whose published feature list maps almost 1:1 onto what T9's gap list says the flagship engine is missing — bank-based wavetable oscillators, a real wavetable editor, 3 FX busses, a mod matrix with graphical curves, and an arp/step-sequencer with per-step octave/semi/velocity/gate.

**KEY FACTS (all first-party, website + manual + source listings):**
- **Oscillators:** "four independent alias-free wavetable oscillator banks with up to 24 oscillator unison"; bank A–D + noise osc + sampler section; banks manage "normalized detuning and dynamic amplification"; claims "more than 1.000 oscillators playing" at low CPU.
- **FM:** "FM synthesis up to a chain of 4 oscillators"; oscillator pitch/phase modulation "up to ~ 2 kHz".
- **Sampler:** wav/aiff/ogg/mp3, loop points, loop start modulation, zero-crossing detection, key tracking; **granular synthesis mode**; "resample samples to wavetables with pitch detection".
- **Wavetable editor:** draw mode with smooth Bezier curves + snap to grid; "30 real-time wavetable effects per oscillator" incl. hard sync, sincify, brew, bend/bloat; ops mix-in, amplitude-modulate, interpolate, convolute, time→frequency, frequency→time, normalize; generate FM/PWM/harmonic-morphed/reduced, LP/HP/BP/comb/formant-filtered and hard-sync wavetables from an arbitrary single cycle; cycle morphing + phase shifting; import Serum/Icarus wavetables (drag&drop); record single-cycle changes into a new wavetable.
- **Additive section:** free real-time edit of all harmonics and phases.
- **Filters:** "30+ different types" — 4× oversampled LPF (biquad, state variable, diode ladder) + HP/AP/BP/notch/shelf/comb/scream, all with resonance; real-time filter response display; global wavetable frequency character `sharp/soft/dull`.
- **Modulation:** modulation matrix with graphical modulation curves; per the product page **25 sources** (incl. key track, random drift, 4 custom macro knobs) and **220 destinations**; the manual's matrix chapter numbers "16 modulation matrix slots"; **five LFOs** (`m_bLFOSynch_LFO1..5` in `VASTParamState.h`) and **five freely editable MSEG envelopes** (loop + DAW timecode sync).
- **FX:** "three effects busses including 4 x oversampling and mono cutoff"; 11+ effects — source-verified module list: Atomizer, Bitcrush, Chorus, CombFilter, CompressorExpander, Distortion, Eq, Flanger, FormantFilter, MultibandCompressor, Phaser, Reverb, StereoDelay; all effect times sync to host.
- **Arp / step sequencer:** `VASTARPData::ArpStep` per step = `octave` (−2..2), `semitones` (−11..+11), `velocity` (0..127), `gate` (0..4 — "0 is pause and 4 is hold"); pattern length up to 64 entries; pattern presets with names; step count adjustable.
- **Voicing/expression:** mono legato or poly 4/16 (plus a 32-note polyphony mode per release notes); intelligent polyphonic portamento/glissando; velocity & gain modulation; MPE (X/Y/Z, release velocity via MSEG, brightness/timbre assignable); microtuning via AnaMark `.TUN`.
- **Presets/UX:** 780+ wavetables/single cycles, 410+ factory presets; preset system with **tags, free-text search, folder management and ratings**; `.vvp` preset files; freely scalable UI, four themes, hotkeys; polyphonic real-time visualization of parameter modulations; audio-out oscilloscope.

**LICENCE (verbatim):** root `LICENSE` = GNU GPL v3 text ("GNU GENERAL PUBLIC LICENSE / Version 3, 29 June 2007"); README: "Vaporizer2 was developed by VAST Dynamics GbR between 2017 and 2023 and is now free software under GPL3 license." GitHub SPDX: `GPL-3.0`. **Verdict: clean-room reference only; no code or factory-content copying (AGPL-class copyleft; content ships inside the same tree).**

**ACTIVITY:** 590 stars · last push 2024-09-14 · latest release **v3.5.0 (2024-03-02)**, `VERSION` file = 3.5.0 · repo alive but quiet (project was archived-and-open-sourced in 2023).

**Fold-in verdict: ADOPT-IDEA** — the single best feature census in this report: bank osc architecture, wavetable-editor op list, 3-bus FX with oversampling, mod-matrix-with-curves UX, matrix slot/source/destination counts, and the per-step arp pattern row. Home: engine (T9 gaps 1–4), mod system (gap 2), FX chain (gap 4), arp UI, preset browser ergonomics (gap 6). REFERENCE for: .TUN microtuning (T9 gap 10 lists MTS-ESP as unshipped).

---

### 2. Helm (Matt Tytel) — the Vital precursor; the cleanest small-scale mod system to study (ARCHIVED)

**Links:** https://github.com/mtytel/helm · https://tytel.org/helm/ · archived by owner (read-only)

**Core contribution:** a 32-voice polyphonic synth whose whole identity is "lots of modulation, live visual feedback" — and whose source (mopo engine) is the direct ancestor of Vital's design. For Anvil the prize is the **step-sequencer-as-mod-source** and the **formant filter**, both cheap to reimplement.

**KEY FACTS (README + source, this session):**
- Dual oscillators with cross modulation and up to **15 unison oscillators each**; sub oscillator with "shuffle waveshaping"; oscillator feedback and saturation waveshaping.
- Waveform set shipped (verbatim `helm_common.h` strings): sin, triangle, square, saw up, saw down, **3 step, 4 step, 8 step, 3 pyramid, 5 pyramid, 9 pyramid, sample and hold, sample and glide** (13 strings; README says "12 different waveforms" — array is the truth).
- "Blending between 12 or 24dB low/band/high pass filter" + low/band/high shelf filters ("band shelf", "all pass" strings appear in the same filter-type table).
- Modulation: "2 monophonic and 1 polyphonic LFO" + a **polyphonic aftertouch** mod source + a **StepGenerator step sequencer** — `MAX_STEPS = 32`; controls `num_steps`, `step_smoothing` (half-life smoothing of the step output), `step_frequency` (free or tempo-synced via `createTempoSyncSwitch`), per-step values `step_seq_<n>`, reset/retrigger on note retrigger; outputs exposed as mod sources `step_sequencer` (smoothed) and `step_sequencer_step`.
- **Formant filter** (FX): `FormantManager(NUM_FORMANTS)` with `NUM_FORMANTS = 4`; five vowel presets a/e/i/o/u, each a 4-formant table with per-formant dB values (e.g. `formant_a_decibels(-4.0)`), routed through a bypass container in the voice handler.
- Other FX: **stutter** (max buffer `STUTTER_MAX_SAMPLES = 96000`), delay, distortion, reverb.
- Arpeggiator; sustain pedal on/off; pitch wheel, mod wheel, channel & poly aftertouch handlers; "powerful modulation system with live visual feedback".

**LICENCE (verbatim):** `LICENSE` = GPLv3; source header: "helm is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version." → **GPL-3.0-or-later**.

**ACTIVITY:** 2,505 stars · **ARCHIVED** (read-only) · last push 2022-09-24 · no GitHub releases.

**Fold-in verdict: ADOPT-IDEA** — copy the *ideas*: step-sequencer-as-modulation-source with smoothing + tempo sync + retrigger law; the 5-vowel × 4-formant filter table as an FX; LFO wave set that includes stepped/pyramid/S&H shapes; poly aftertouch as a first-class source. Home: mod system (T9 gap 2), FX chain (gap 4). SKIP the engine architecture itself (superseded by the worklet plan).

---

### 3. OB-Xd → OB-Xf (2DaT → discoDSP → Surge Synth Team) — the analog-voice lineage, and the reference per-voice MPE matrix

**Links:** https://github.com/2DaT/Obxd (original) · https://github.com/reales/OB-Xd (discoDSP open branch) · https://github.com/surge-synthesizer/OB-Xf (continuation, active) · https://www.discodsp.com/obxd/ (closed v3 marketing page — REFERENCE only)

**Core contribution:** a Joseph-Oberheim-voiced virtual analog whose open lineage ended at OB-Xd 2.11 and now continues as **OB-Xf** under the Surge Synth Team. OB-Xf carries a per-voice **VoiceMatrix** for MPE routing — the most concrete "per-note modulation" implementation found in this pass.

**KEY FACTS:**
- Voice architecture (README + `src/engine/` file census): `PulseOsc`, `SawOsc`, `TriangleOsc` + `Noise`, `Filter` (analog-modeled), `AdsrEnvelope`, `Lfo`, `Decimator`, `BlepData` (BLEP anti-aliasing), `Tuning`, `Program` (patch model), `VoiceQueue` + `Motherboard` (voice allocation; `MAX_VOICES`; `unisonVoiceCount` up to `MAX_PANNINGS`; `VoicePriority` enum with `LATEST`; per-key stolen-voice tracking).
- **VoiceMatrix** (verbatim from `src/engine/VoiceMatrix.h`): "per-synth modulation routing from MPE/voice sources to per-voice targets… NUM_MATRIX_ROWS rows, each with a source, target, and depth"; sources are wired *per-voice at note start and note end* (`Voice::NoteOn()`, `Voice::NoteOff()` → `recalculateMatrix()`), and per-channel real-time sources flow through `processMPETimbre` / `processMPEChannelPressure` — i.e. a documented pattern for MPE X/Y/Z → arbitrary per-voice targets.
- OB-Xf README: "currently in a beta phase… feature stable"; **OB-Xd patch/bank import** (FXP/FXB drag-and-drop, "Import OB-Xd Bank…") with a documented fidelity caveat (OB-Xd's 12-semitone reference offset is compensated via Transpose).
- discoDSP's closed OB-Xd **3.24** (marketing page, REFERENCE only): 128 voice slots, up to 16 detuned voices per note, adaptive 1x/2x/4x oversampling, per-voice component-tolerance "Analog Mode", MPE per-note pitch/timbre/pressure freely routable, MTS-ESP, dynamic pan presets, MIDI-learn boards. Treat as a design target, not source.

**LICENCE (verbatim):** OB-Xf file header: "OB-Xf is released under the GNU General Public Licence v3 or later (GPL-3.0-or-later)." Original 2DaT repo + reales/OB-Xd: GPL-3.0 (GitHub SPDX). **discoDSP OB-Xd 3.x is closed — behaviour reference only, never source.**

**ACTIVITY:** 2DaT/Obxd 137★, last push 2014-10-27 · reales/OB-Xd 268★, last push 2026-08-18 · **OB-Xf 512★, pushed 2026-09-30, releases: v1.0.3 (2026-03-27) + Nightly (updated 2026-09-30)**.

**Fold-in verdict: ADOPT-IDEA** — the per-voice matrix pattern (source list + wiring points at note-on/note-off/real-time) is exactly the shape Anvil's T9 gap-2 mod system needs; voice priority/steal tracking confirms PF's stealing law with a modern enum; open-bank-import is the patch-compat lesson for the packs lane. Home: mod system, engine voice allocation, packs (bank import). REFERENCE: analog-mode/oversampling switches.

---

### 4. Dexed (asb2m10) — the DX7 FM reference; sysex + cartridge librarian as a distribution model

**Links:** https://github.com/asb2m10/dexed · https://asb2m10.github.io/dexed/ (user site) · wiki + keybindings docs in-repo

**Core contribution:** the canonical OSS DX7 clone — both the FM engine feature set worth learning and an **editor/librarian UX** (cartridge manager, sysex in/out, real-time per-operator meters) that doubles as a content distribution pattern.

**KEY FACTS:**
- Engine: "closely modeled on the original DX7 characteristics" (msfa engine, Apache-2.0, embedded in the source folder); **144 DAW-automatable DX7 parameters** from one panel; **3 selectable engine types**: `Modern` (24-bit msfa), `Mark I` ("based on the OPL series but at higher resolution (LUT are 10-bits)… closest to the real DX7"), `OPL Series` (8-bit, experimental).
- Parameter census from `PluginParam.cpp`: `ALGORITHM`, `FEEDBACK`, `OSC KEY SYNC`, `LFO SPEED/DELAY/PM DEPTH/AM DEPTH`, `LFO KEY SYNC`, LFO waves (sine/triangle/saw up/saw down/square), `TRANSPOSE`, `P MODE SENS.`, per-operator `PITCH EG RATE/LEVEL`, master tune, `Cutoff`/`Resonance`/`Output` (Dexed's added filter), `MonoMode` (mono/poly as plugin parameter), MIDI CC learn, `wheelMod`/`footMod`/`breathMod`/`aftertouchMod` controller routing, pitch range/step settings → microtuning.
- **Librarian:** full DX7 **sysex in/out including controller change** ("you can use this with a native DX7/TX7 as a patch editor and sysex manager"); loads/saves any DX7/TX7 sysex program; cartridge browser (`.syx` files in a Cartridges dir) with drag-and-drop, right-click send-to-DX7, and "SHOW DIR"; community cartridge compilation referenced (BlackWinny `Dexed_cart_1.0.zip`).
- Expression/extras: MTS-ESP + SCL/KBM microtuning; partial portamento; MPE support (initial); per-operator realtime VU meters; accessibility + keyboard shortcuts; scalable UI.

**LICENCE (verbatim):** README: "Dexed is licensed on the GPL v3. The msfa component (acronym for music synthesizer for android, see msfa in the source folder) stays on the Apache 2.0 license." → code GPL-3.0 (with an Apache-2.0 engine island).

**ACTIVITY:** 3,548 stars · pushed 2026-09-21 · **v1.0.1 (2025-11-29)**, Nightly (2026-07-21) · 10-year-old project, actively maintained.

**Fold-in verdict: ADOPT-IDEA** — the FM parameter taxonomy is the checklist for Anvil's FM osc (algorithm/feedback/operator key sync/LFO key sync/pitch EG scaling); engine-type switching (pristine vs vintage-approximate math) is a cheap authenticity lever; the **cartridge/librarian pattern** is the model for a DX7-style content lane in Anvil's pack store. Home: engine (FM), packs (sysex corpora), UX (per-operator meters). REFERENCE for MTS-ESP depth.

---

### 5. ZynAddSubFX — the three-engine taxonomy (ADsynth / SUBsynth / PADsynth) and the FX taxonomy

**Links:** https://github.com/zynaddsubfx/zynaddsubfx · manual in `doc/`

**Core contribution:** the most thorough **engine-category taxonomy** in open source: additive, subtractive and PAD synthesis as separate engines with a shared parameter surface — plus a classic effects list and an instrument/kit model that Anvil's drum+layered-instrument lane can borrow.

**KEY FACTS (README + `src/` census):**
- "Three synthesizer engines": **Additive Synthesis** ("classic synth sounds composed of a variety of voices with powerful modulation… modulators ranging from LFOs and envelopes to oscillator modulators for FM, PM, and AM"), **Subtractive Synthesis** ("variable bandwidth harmonics from filtered white noise"), **PAD synthesis** ("beautiful pads and other instruments" — the PADsynth algorithm: band-limited random spectra rendered as pad sounds).
- "Powerful waveform generator with up to **128 sine/non-sine harmonics**"; "a variety of filters including analogue modeled filters, formant filters, and state variable filters" (source: `AnalogFilter` [Moog], `SVFilter`, `FormantFilter`, `CombFilter`).
- Envelopes "ADSR (or ASR, etc.) modes or … free modes (with any shape)"; LFOs per-engine; per-note modulators.
- **Effects** (source-verified): Reverb, Echo, Chorus/Flange, Phaser, **Alienwah**, Distortion (wave-shaping), EQ, **DynamicFilter**, **CombFilterBank**, **Sympathetic** resonance, **Reverse** — with flexible routing.
- **Kits**: "instruments can be organized in kits… drum kits or layered instruments… choose what items from the kit should be processed by the Part's effects."
- "Randomness settings to create subtle differences in each sound" (analog warmth as a parameterised source).
- Microtonal: "any scale, up to **128 notes per octave**, and key mapping"; SysEx extensions: floating-point notes (28-bit pitch), **per-note controller events**, per-note pitch bend — i.e. a per-note expression model *before* MPE existed.
- Content: "Over 1100 high quality instruments included."

**LICENCE (verbatim):** `COPYING` = GNU GPL v2 text; source header (ADnote.cpp): "…either version 2 of the License, or (at your option) any later version." → **GPL-2.0-or-later**.

**ACTIVITY:** 1,179 stars · pushed 2026-09-10 · releases stale (latest tag 2.5.3-osx, 2016) — development lives on main.

**Fold-in verdict: ADOPT-IDEA** — the three-engine split (esp. PADsynth as a "pad/atmosphere" generator) is a differentiated engine option for Anvil beyond wavetable+FM; the effects taxonomy fills T9 gap 4 (Alienwah/Sympathetic/Reverse/DynamicFilter/CombFilterBank are all cheap node-graph FX); the kit+per-note-SysEx model feeds the expression and drum lanes. Home: engine, FX, mod (per-note controllers), packs.

---

### 6. Yoshimi (ZynAddSubFX fork, 2009→) — the maintained Linux descendant; UX/integration lessons

**Links:** https://github.com/Yoshimi/yoshimi · user guide v2.3.6.5 in `doc/yoshimi_user_guide/` (CC-BY-SA 4.0 docs)

**Core contribution:** a fork of ZynAddSubFX 2.4.0 that kept the AD/SUB/PAD engine family and focused on robustness, single-window UX and per-part control semantics — useful as the "what happens when you keep polishing one engine family for 15 years" datapoint, and as a documentation model (its guide's topic tree doubles as a parameter taxonomy).

**KEY FACTS:**
- README (v2.3.6): kit-mode improvements ("Kit Mode now has a crossfade Volume option as well as Velocity"), Wayland support, instrument-vs-part control distinction ("Part controls are not read back by an instrument load, but are in patchset and state files").
- User-guide topic tree (verbatim dirs): `vector`, `pad`, `resonance`, `sub`, `wave`, `part`, `lfo`, `envelope`, `filter`, `cc_nrpn`, `mlearn`, `scale`, `preset`, `bank`, `config`, `effects`, `introduction`, `starting` — i.e. the complete parameter surface of the Zyn engine family, documented.
- Dedicated docs for the **Formant Filter** and Formant-Filter-Extension (`doc/Formant_Filter*`) — the same 5-vowel/4-formant lineage as Helm's.
- Linux-only (ALSA/JACK); LV2 plugin build in `src/LV2_Plugin`.

**LICENCE (verbatim):** `COPYING` foreword: "For a time there was confusion over the precise license version applicable to Yoshimi. It has been confirmed as Version 2, or (at your option) any later version." → **GPL-2.0-or-later**.

**ACTIVITY:** 289 stars · pushed 2026-09-06 · current version 2.3.6 · continuous development since 2009 (Sourceforge + GitHub mirrors).

**Fold-in verdict: REFERENCE** — no new engine features beyond Zyn; take the topic taxonomy as a documentation/surface checklist for Anvil's synth panel, and the "instrument load vs part control" state distinction as a patch-serialization law (mirrors PF's one-law-three-callers discipline). Home: docs/UX + patch model.

---

### 7. Cardinal (DISTRHO) — VCV Rack as a self-contained plugin; harvest the MODULE CATEGORY taxonomy, not the modules

**Links:** https://github.com/DISTRHO/Cardinal · https://cardinal.kx.studio/ (incl. a **web build**/WASM "Try Live") · docs `CARDINAL-MODULES.md`, `LICENSES.md`

**Core contribution:** the module-category census for modular-style depth: ~**89 bundled module collections** + Rack's own tag taxonomy (54 tag families) + Cardinal's internal host/DAW modules. For Anvil this is the menu of "what a deep modulation/FX toolbox contains", plus a live proof that a big modular engine runs on the Web.

**KEY FACTS:**
- Bundled collections (partial, from `plugins/`): 21kHz, 8Mode, Aaron Static, admiral, AlgoritmArte, Amalgamated Harmonics, Animated Circuits, Arable Instruments, Aria, **Audible Instruments** (Mutable ports), Autinn, Axioma, BaconPlugs, **Befaco**, Bidoo, Biset, **Bogaudio**, CatroModulo, ChowDSP, Computerscare, DHE, ESeries, EnigmaCurry, **ImpromptuModular** (Foundry/Phrase-sequencer family), JW-Modules, MindMeldModular, **stoermelder packone**, **surgext** (Surge XT modules), Voxglitch (sample modules), repelzen, sonusmodular, stoermelder, unless_modules. Count law: the `plugins/` listing holds 93 entries, of which 4 are non-collection files (`Makefile`, `plugins.cpp`, `plugins-mini.cpp`, `todo.txt`) → **89 module collections**.
- **VCV Rack tag taxonomy** (verbatim from `Rack/src/tag.cpp`, the category census — 54 families): Arpeggiator · Attenuator · Blank · Chorus · Clock generator · Clock modulator · Compressor · Controller · Delay · Digital · Distortion · Drum · Dual · Dynamics · Effect · Envelope follower · Envelope generator · Equalizer · Expander · External · Filter · Flanger · Function generator · Granular · Hardware clone · Limiter · Logic · Low-frequency oscillator · Low-pass gate · MIDI · Mixer · Multiple · Noise · Oscillator · Panning · Phaser · Physical modeling · Polyphonic · Quad · Quantizer · Random · Recording · Reverb · Ring modulator · Sample and hold · Sampler · Sequencer · Slew limiter · Speech · Switch · Synth voice · Tuner · Utility · Visual · Vocoder · Voltage-controlled amplifier · Waveshaper.
- Cardinal's **own internal modules** (`CARDINAL-MODULES.md`): Host Audio (2/8), Host CV, Host MIDI, Host MIDI CC(+Map), Host MIDI Gate, Host Parameters(+Map), **Host Time**, Audio File player (synced loop playback, streams >30 s), **Audio To CV Pitch** (pitch→1V/oct + gate, confidence/tolerance controls), Carla + Ildaeil (plugin hosting), AIDA-X (neural amp models), Sassy Scope, Text Editor (in-canvas scripting), glBars (visual), MPV (video), Expanders MIDI, Blank.
- UI/interop: **OSC remote control** page (control/labels), 3 plugin variants + standalone + **web**; module icons/skins; expander-module pattern for extending IO.

**LICENCE (verbatim):** repo `LICENSE` = GPL-3.0; `plugins/Cardinal/plugin.json`: `"license": "GPL-3.0-or-later"`; `docs/LICENSES.md`: "While Cardinal itself is licensed under GPLv3+, some modules/plugins used by it are not… the more restrictive of the code licenses will apply to the final binary" — table shows module-level **MIT / BSD-3-Clause / GPL-2.0+ / GPL-3.0+** mix (Rack itself: GPL-3.0-or-later).

**ACTIVITY:** 3,213 stars · pushed 2026-07-28 · latest release **26.02 (2026-02-28)** · active.

**Fold-in verdict: ADOPT-IDEA (taxonomy only)** — use the 54-tag category census as the **checklist for Anvil's module/FX/utility surface** (e.g. missing-from-PF families: quantizer, sample & hold, slew limiter, logic, clock modulator, envelope follower, ring modulator, low-pass gate, function generator, physical modeling, speech, vocoder, visual) and steal the *internal module* patterns: Host Time (musical time as a signal), Audio→CV pitch (audio-driven modulation), in-canvas Text Editor (scripting) and OSC remote. The module-by-module code: **clean-room only** (GPL-3.0+, mixed per-module copyleft); Per-module MIT/BSD islands are noted but still referenced, not pasted (Anvil's doctrine: reimplement, attribute).

---

### 8. Bespoke Synth — a live-patchable node graph; the richest open **sequencer-module census** found

**Links:** https://github.com/BespokeSynth/BespokeSynth · https://www.bespokesynth.com/docs/ · community wiki

**Core contribution:** 4.7k-star live-performance modular environment whose module set is effectively a catalogue of sequencing *paradigms* — step, euclidean, M185 (MC-202-style), circle, dot, slider, radio, rhythm, polyrhythms, note canvas, plus a pulse-plumbing family (chance/delay/gate/hocket/router/train). This is the menu T3's sequencer baseline does not fully cover.

**KEY FACTS (README + `Source/` census, 778 files):**
- Platform: "live-patchable environment, so you can build while the music is playing"; VST/VST2/VST3/LV2 hosting; **Python livecoding** (`ScriptModule`, `ScriptModule_PythonInterface.i`); MIDI & OSC controller mapping; Windows/Mac/Linux.
- **Sequencers (source-verified module classes):** `StepSequencer`, `NoteStepSequencer`, `VelocityStepSequencer`, `BassLineSequencer`, `CircleSequencer`, `DotSequencer`, `EuclideanSequencer`, **`M185Sequencer`**, `SliderSequencer`, `ControlSequencer`, `RadioSequencer`, `RhythmSequencer`, `PlaySequencer`, `Polyrhythms`, `NoteCanvas` (free-time note field), `NoteChance`, `NoteChainNode`, `Arpeggiator`, `CurveLooper`.
- **Pulse/trigger plumbing:** `Pulser`, `PulseChance`, `PulseDelayer`, `PulseGate`, `PulseHocket`, `PulseLimit`, `PulseRouter`, `PulseSequence`, `PulseTrain`, `NoteToPulse`, `AudioToPulse`, `BoundsToPulse` — i.e. triggers as first-class routable data.
- **Song/structure:** `SongBuilder`, `ControllingSong`, `FollowingSong`, `GridModule`/`GridController` (Launchpad-style), `SamplerGrid`.
- **Instruments/FX census highlights:** `DrumSynth`, `DrumPlayer`, `KarplusStrong`, `Looper`, `LooperGranulator`, `LooperRecorder`, `BufferShuffler`, `BandVocoder`, `BitcrushEffect`, `BiquadFilterEffect`/`ButterworthFilterEffect`, `Amplifier`, `ADSRDisplay` (visual envelope editing), `Chorder`/`ChordDatabase`, `Scale`/`ScaleDegree`/`ScaleDetect`, `Autotalent` (pitch correction).
- Docs organize modules in categories: *instruments, note effects, synths, audio effects, other* (docs page headers, this session).

**LICENCE (verbatim):** README: "### License / [GNU GPL v3](LICENSE)" → GPL-3.0.

**ACTIVITY:** 4,734 stars · pushed 2026-10-01 · Nightly builds per commit · very active.

**Fold-in verdict: ADOPT-IDEA** — the sequencing *paradigms* list is the biggest single expansion of T3's step-grid baseline (M185, circle, dot, slider, radio, rhythm sequencers = five more generator shapes; pulse plumbing = the missing "trigger cables" idea for Arp/fill logic). Also: ADOPT the "live patch while playing" doctrine (Anvil's engine already supports live param retargeting — PF's `pfSXLiveParam` law) and Python-scripting module as the extensibility roadmap (compare PF's code lane). Home: sequencer (v1.x+), UX, extensibility. SKIP: the node-graph UI itself for v1 (L effort, wrong first surface).

---

### 9. samplebrain (Dave Griffiths / Thentrythis; designed by Aphex Twin) — granular/concatenative UX blueprint

**Links:** https://github.com/aeiouaeiouaeiouaeiouaeiouaeiou/samplebrain (GitHub mirror) · https://thentrythis.org · manual `docs/manual.md`

**Core contribution:** the most original granular/sample-mangling parameter set in open source: a **brain** of sample blocks linked by similarity (synapses), a **target** stream matched block-by-block in real time, and a parameter vocabulary (novelty, boredom, stickiness, search stretch, synaptic slide) that Anvil can adapt for both a granular osc and a "texture" performance effect.

**KEY FACTS (manual, verbatim concepts):**
- Core model: "chops samples up into a 'brain' of interconnected small sections called blocks which are connected into a network by similarity. It processes a target sample, chopping it up into blocks in the same way, and tries to match each block with one in its brain to play in realtime."
- **Brain tweaks:** fft ↔ **mfcc** blend (0%/100% disables the other side for CPU); freq+dynamics vs freq-only (normalised blocks); fft subsection (100 bins); **novelty** (bias away from similarity, prioritise unused blocks); **boredom** (novelty wear-off speed); **stickiness** (accept next-in-sequence block if error < threshold — "elongating chunks"); **search stretch** (repeat target blocks — simple timestretch; with synaptic mode = repeated attempts to find closer matches); **algorithm = basic / reversed / synaptic / slide** (synaptic: constant search time over large brains by walking the similarity graph; slide: repeat/stretch until close enough, "unpredictably warps the timing"); **num synapses** (up to 1000, ordered by closeness); **synaptic slide error**.
- **Target:** block size (samples), block overlap, window shape ("dodgy" legacy fade), (re)generate blocks, **use mic input** (live stream).
- **Mix:** autotune (pitch-bend chosen block to target), normalised mix, brain/target blend, **stereo mode** (separate searches L/R).
- **Brain contents:** load sound/directory/clear; per-sample enable/disable **live during playback**; block size/overlap/window; sessions save both target + brain ("load session" vs "load brain"); OSC ports configurable.
- Version 0.18.5; MFCC via Aquila.

**LICENCE (verbatim):** README: "MFCC algo courtesy of the Aquila library by Zbigniew Siciarz MIT/X11 licence 2007-2014… This program is free software licenced under GNU General Public License version 2 (see LICENCE)." → **GPL-2.0** (with an MIT/X11 MFCC island).

**ACTIVITY:** mirror 147★ · pushed 2026-09-21 · upstream at thentrythis.org (Flathub + PPA builds; experimental non-commercial framed) · 0.18.5 released 2022-10-28.

**Fold-in verdict: ADOPT-IDEA** — the *parameter vocabulary* is the prize: novelty/boredom/stickiness/search-stretch as UI concepts for any granular engine; the brain/synapse data model is an L-effort later feature (fits "sample-mangling lane" beyond T9's sampler gap); the MFCC-vs-FFT blend and autotune are M-effort granular polish. Home: engine (granular), UX (novel controls), packs (brain files as shareable content). Note the licence: GPL-2.0 → clean-room.

---

## B. Sequencers — semantics to extend the T3 baseline

### 10. Stochas (Surge Synth Team; originally Audio Vitamins) — probabilistic step sequencing, formalised

**Links:** https://github.com/surge-synthesizer/stochas · https://stochas.org/stochas/ (features) · v1.3.13

**Core contribution:** a step sequencer whose *product identity* is randomness-on-purpose — the cleanest open list of **which step parameters deserve a probability, and what "polyrhythm" means as a UI concept** (4 layers, each with its own time signature, speed and step count).

**KEY FACTS (first-party feature list):**
- Randomness dimensions: (a) whether a note plays; (b) **which** of 2+ notes plays at a time; (c) **timing** randomisation ("slightly before or after their position"); (d) velocity and **length** randomisation.
- **Polyrhythms:** "up to 4 simultaneous layers with different time signature, playback speed and/or number of steps per layer".
- Patterns: switch during playback; **timing** per part (half/double-time); per-step off-grid shift; basic swing + **grooves, importable from MIDI files**.
- **Chain mode:** "procedural programming (e.g. 'if this note plays/doesn't play then always/never play this other note')" — a cross-step logic layer beyond T3's per-step conditions.
- Chords helper; note visibility/renaming customisation for drum kits (import/export); scale selection; **record incoming MIDI to the grid**; themable UI; "most features can be controlled by MIDI so that you can mute/unmute layers, switch patterns, change timing, transpose notes".

**LICENCE (verbatim):** GitHub SPDX `GPL-3.0` (repo LICENSE = GPLv3).

**ACTIVITY:** 556 stars · pushed 2026-10-05 · latest release **v1.3.13 (2024-11-16)** · actively maintained.

**Fold-in verdict: ADOPT-IDEA** — maps onto T3 Deliverable A: per-step `prob` already MUST; add *note-choice randomness* and *timing/velocity/length jitter* as step fields (T3 §11 Chance/Action partial); **Chain mode** = a cross-step rule layer above `cond` (v1.x); **groove import from MIDI** is a competitive differentiator for v1.x; 4-polyrhythmic-layer model = concrete shape for T3 §19's per-track length/speed at layer level. Home: sequencer, UX.

---

### 11. seq66 (ahlstromcj) — live-loop MIDI sequencing (the Seq24 lineage) — set/trigger/playlist semantics

**Links:** https://github.com/ahlstromcj/seq66 · PDF user manual + tutorial in-repo (`doc/`) · v0.99.27 (2026-08-10)

**Core contribution:** the reference for **live MIDI looping as a grid of slots**: patterns organised into sets, mute-groups, transposable triggers, playlists, song layout, and MIDI automation of the whole transport — plus an LFO that modifies CC/velocity inside sequences.

**KEY FACTS (README, verbatim behaviours):**
- "MIDI sequencer/live-looper with a hardware-sampler grid interface; pattern banks, **triggers**, and **playlists** for song management; scale and chord aware piano-roll; song layout… control/status via MIDI automation, and **mute-groups** to enable/disable sets of patterns… headless" (CLI daemon for grid controllers). "It does not support audio samples, just MIDI."
- UI: loop-button grid, colourful slots + saveable `.palette`; tabs/windows for patterns, sets, mute-groups, song layout, event edit, playlists, session; drag-and-drop a MIDI file onto the grid.
- **LFO to modify continuous-controller and velocity values**; "pattern fixer" (expansion/compression/alignment of note patterns); **MIDI learn** manager; RPN/NRPN editor producing macros; event editor; zoom; "Extremely resizable".
- Config files: `.rc/.usr/.ctrl/.mutes/.playlist/.drums/.palette/.qss`; unified keystroke+MIDI controls in `.ctrl` (sample Launchpad Mini files provided).
- "Supports configurable PPQN from **32 to 19200** (default is 192)"; "Transposable triggers to re-use patterns"; "Song import/export from/to stock MIDI (SMF 0 or 1)"; configurable MIDI metronome; scale/key/chord management; NSM session management.

**LICENCE (verbatim):** `licenses/LICENSE.GPL` = "GNU GENERAL PUBLIC LICENSE / Version 3, 29 June 2007" (repo also ships `LICENSE.LGPL` + `LICENSE.FDL` for other components) → **GPL-3.0** for code.

**ACTIVITY:** 192 stars · pushed 2026-10-03 · release v0.99.27 (2026-08-10) · active (pre-1.0 by design, 10+ years).

**Fold-in verdict: ADOPT-IDEA** — four mechanics to fold into Anvil's sequencer: **mute-groups** (one-button pattern-set states), **transposable triggers** (re-use a pattern at other pitches), **playlists** (ordered pattern lists as the v1 song model beside T3 Option 1), and the **pattern fixer** idea (align/expand note patterns after recording). PPQN headroom (192 default) validates a high-resolution internal clock. Home: sequencer, UX (loop-grid launcher), MIDI panel (grid-controller mapping).

---

### 12. klystrack (kometbomb) — tracker sequencing with a chiptune synth engine

**Links:** https://github.com/kometbomb/klystrack · man page `doc/klystrack.1` · v1.7.6

**Core contribution:** a compact tracker that shows what a *pattern/order-list* sequencing layer adds beyond step grids — free pattern positioning, per-pattern transpose, non-fixed pattern lengths, and an instrument model of "programmable instrument programs" — plus a small synthesizer feature set (SID-style hard sync/ring mod, FM) that dovetails with Anvil's engine lane.

**KEY FACTS (man page, verbatim):**
- Sound: "Additive synthesis with filters (think SID, Atari, NES etc.)"; "**Hard sync and ring modulation** (like SID)"; "FM synthesis (think Adlib, MSX, OPL2 etc.)"; "Wavetable for samples or custom waveforms"; "Built-in wave generator and editor"; "**Programmable instruments not limited to simple arpeggios**".
- Sequencer: "Tracker with **free positioning of patterns**"; "Pattern **transpose**"; "**Pattern length is not fixed**"; hard limit of 32 channels (raisable).
- Effects: stereo chorus, "SNES-style **multitap echo**", **bit crusher/decimator**.
- Export/Import: custom format + tiny playback lib; WAV export; "Export each track as separate WAVs"; "**Export wavetable items as .WAVs (use klystrack to create one-cycle waveforms for other synths!)**"; import .AHX, Protracker/FT2 modules, SID files (Rob Hubbard player).
- Fully themeable (half-dozen themes).

**LICENCE (verbatim):** `LICENSE`: "Copyright (c) 2009-2018 Tero Lindeman (kometbomb)… Permission is hereby granted, free of charge, to any person obtaining a copy of this software… without restriction…" → **MIT/X11-style permissive** (GitHub reports it as "Other/NOASSERTION" because the file is custom-formatted). Note: permissive code, but still: ideas first; attribution required for any reuse.

**ACTIVITY:** 551 stars · last push 2022-03-23 · release 1.7.6 (2019-07-06) · dormant but complete.

**Fold-in verdict: ADOPT-IDEA (small, targeted)** — (1) the **one-cycle wavetable export** already exists in PF's export bench (T9 entry 13) — klystrack independently confirms it as a killer feature; (2) pattern-model details: free placement, transpose and variable pattern length are cheap additions to Anvil's arrangement data model; (3) hard sync/ring mod/bitcrush raise the engine/FX menu. Home: sequencer (tracker lane = "second lane" beside the step grid), engine, FX.

---

### 13. Helio (Peter Rudenko) — a sequencer that experiments where others don't: microtonality, non-destructive modifiers, aleatoric scripting

**Links:** https://github.com/helio-fm/helio-sequencer · https://docs.helio.fm/ · docs in-repo `Docs/*.md`

**Core contribution:** a modern, distraction-free sequencer whose three differentiators are directly relevant to Anvil's planned "modern groovebox + code lane" positioning: **parametric modifiers** (non-destructive sequence transforms), **polymetric time-signature setup**, and **microtonal piano roll** + **aleatoric DSL**.

**KEY FACTS (docs, verbatim concepts):**
- **Parametric modifiers** (`parametric-modifiers.md`): "apply effects in a non-destructive way, without affecting the base notes"; stacked and reordered per clip; meant "for testing arpeggiators… while keeping the underlying chords editable"; generated notes shown "dashed semi-transparent"; `Alt+M` mutes/unmutes all modifiers; "Apply all" makes changes permanent (replaces the sequence, resets the stack); included in playback and MIDI export.
- **Polymetric setup** (`polymetric-setup.md`): global timeline time signatures (draggable, copyable) + per-track time signatures (exactly one per track, anchored, draggable within the track's range); time signatures set both grid lines and the metronome's accent pattern.
- **Microtonal setup** (`microtonal-setup.md`): built-in temperaments + 7-tone scales; the piano roll "works as a microtonal keyboard with a wide key range from **0 up to 2048**"; mapping spans "**16 MIDI channels**, of 128 keys each" → "temperaments of size up to **192-EDO**"; a keyboard-mapping page with per-key preview; the built-in SoundFont player "automatically recalculate[s] the pitches and ranges of its samples to match the frequencies of the current temperament".
- **Aleatoric setup** (`aleatoric-setup.md`): "a small scripting DSL with Scheme-inspired syntax" for generating music from scratch or writing custom modifiers; deliberately separate from audio processing/UI; inspiration: Common Music; immutable data / pure functions style.
- Extras: version-control-friendly project model; command palette; SFZero-based SoundFont player; metronome.

**LICENCE (verbatim):** README: "GNU GPL v3 © Peter Rudenko and contributors, see LICENSE for details." → **GPL-3.0**. (Bundled SoundFont player based on SFZero — check upstream licence per component.)

**ACTIVITY:** 3,557 stars · pushed 2026-09-22 · builds v3.18 distributed via helio.fm (CI, not GitHub releases) · actively maintained.

**Fold-in verdict: ADOPT-IDEA** — (1) **parametric modifiers = the killer sequencer UX pattern**: transform stacks (arp, humanize, random, transpose) that preview non-destructively and commit with "Apply all"; this is the natural evolution of T3's "mutate" + PF's code-lane interchange; (2) microtonal roll up to 2048 keys / 192-EDO across 16 MIDI channels = the reference implementation for Anvil's tuning lane (T9 gap 10); (3) per-track + timeline time signatures = concrete model for polymeter; (4) the aleatoric DSL = L-effort roadmap item matching Anvil's "code lane" identity. Home: sequencer, tuning, UX, code lane.

---

### 14. Hydrogen — the drum-machine pattern/song model (instrument layers, humanization, stacked patterns)

**Links:** https://github.com/hydrogen-music/hydrogen · http://hydrogen-music.org/documentation/manual/manual_en.html · v1.2.7

**Core contribution:** the canonical open drum machine — its **pattern vs stacked-pattern vs song** structure, **instrument = layers + components** model, and **humanization** parameters are the specifics Anvil's drum lane (T9 entry 7: ADAPT — "voices expand") should absorb.

**KEY FACTS (README + manual):**
- "Both a drum sequencer for pattern-based programming and a drum synth"; "First-class MIDI support… In-depth control of instrument, sample, and note properties"; "High quality time-stretching and pitch shifting"; "Automate it using MIDI or OSC API".
- **Pattern modes:** "Stacked Pattern Mode will play multiple patterns simultaneously"; separate Pattern Mode; Song Mode for arrangement; max resolution **192 ticks per whole note** (grid resolutions are its factors).
- **Instrument model:** each instrument = **layers** (velocity-range sample mapping: "layers will be assigned an equally sized velocity range corresponding to their layer number") + **components** with per-component gain/mute/solo; ADSR per instrument (attack/decay/sustain/release specified in the manual); gain/mute-group warnings.
- **Humanization** is a documented feature section (13.4.1) — random note/pitch deviations, per-instrument and master-level.
- Drumkit concept as a shareable collection with metadata (name, author, licence); NSM session management.

**LICENCE (verbatim):** GitHub SPDX `GPL-2.0` (repo COPYING = GPLv2 text).

**ACTIVITY:** 1,338 stars · pushed 2026-10-05 · release **1.2.7 (2026-10-02)** · very active.

**Fold-in verdict: ADOPT-IDEA** — (1) instrument-layer velocity mapping = the sample-lane design for Anvil's drum/kit engine; (2) stacked patterns (play N patterns at once) is a cheap, powerful performance mode beyond T3's single-pattern grid; (3) humanization parameters to compare against T3 §9 (MPC) before implementing; (4) the drumkit-as-content model feeds the packs lane. Home: engine (drum lane), sequencer, packs.

---

### 15. IanniX (buzzinglight) — the graphical/curve sequencer (Xenakis lineage): scores as geometry

**Links:** https://github.com/buzzinglight/IanniX · https://github.com/buzzinglight/IanniX/wiki (docs)

**Core contribution:** sequencing as **geometry**: triggers and curves drawn on a 2D canvas, moving read heads firing OSC/events — the most different UI paradigm in this survey and a natural fit for a browser canvas product's "visual score" mode.

**KEY FACTS:**
- Self-description: "IanniX is a graphical open-source sequencer, based on Iannis Xenakis works, for digital art. IanniX syncs via **Open Sound Control (OSC) events and curves** to your real-time environment."
- Repo structure (top-level): `geometry/`, `gui/`, `items/`, `messages/`, `objects/`, `render/`, `shaders/`, `transport/`, `interfaces/`, `Patches/`, `Examples/` — i.e. a full score-renderer architecture (curves as objects; transport; OSC messaging).
- Maintenance status (verbatim): "IanniX is no longer actively maintained; the original team is trying to keep the program alive as much as possible."

**LICENCE (verbatim):** `COPYING.txt` = "GNU GENERAL PUBLIC LICENSE / Version 3, 29 June 2007" → **GPL-3.0**.

**ACTIVITY:** 400 stars · pushed 2026-07-25 (maintenance only) · Qt5 desktop app.

**Fold-in verdict: REFERENCE** — not a v1 feature, but the paradigm to keep on the roadmap for Anvil's "visual/experimental" surface: a canvas score where shapes are patterns and a playhead fires notes (Browser-canvas friendly; pairs with the T3 §20 finding that no browser tool ships serious sequencing semantics). Also a reminder: OSC as a first-class control path (Cardinal has it too). Home: UX (later), sequencer.

---

## C. Packs & community

### 16. Patch-community repos — patchstorage's beta API, DX7 cartridge corpora, and preset-content repos

**Links:** https://github.com/patchstorage/patchstorage-docs (API wiki) · https://patchstorage.com/docs/api/beta/ (OpenAPI) · https://github.com/patchstorage/patchstorage-lv2-uploader · https://github.com/asb2m10/dexed#cartridge-manager (community DX7 cartridges, e.g. BlackWinny's Dexed_cart_1.0.zip)

**Core contribution:** the **community-content lane** for Anvil's pack store: a live, documented, read/write HTTP API for an existing patch community (~17.6k patches) plus proven librarian models (DX7 sysex cartridge browsers) — either as an import source (curated), a mirror target, or an interop feature.

**KEY FACTS:**
- Patchstorage Beta API: base `https://patchstorage.com/api/beta/`; docs `https://patchstorage.com/docs/api/beta/` (Swagger). "This API provides essential read and write operations to retrieve or create patch objects"; `User-Agent` header required; auth = `POST /beta/auth/token` → Bearer token valid **7 days**; artwork upload via `POST /beta/files`; platform registry (`/beta/platforms`) carries id/slug/name/description (VCV Rack, AudioKit Synth One, 201 Pocket Piano, Organelle etc.); patch objects carry `download_count`, `view_count`, `like_count`, `comment_count`, `revision`, `author`, artwork, licence field.
- Live census this session: `X-WP-Total: 17580` patches on the platform (2026-10-07) — a large, real corpus to curate from.
- Alpha API deprecated (shutdown 2023Q1) — use Beta.
- DX7 cartridge model (Dexed): local `Cartridges/` dir scanned by the CART window; drag-and-drop between plugin and browser; right-click "send program/cartridge to DX7"; community-compiled `.syx` cartridges circulated (Dexed_cart_1.0.zip).
- (No dedicated "wavetable collection" repos surfaced in `gh search` this session — wavetable content lives inside synth repos and store products; log as a dead end.)

**LICENCE:** patchstorage-docs repo = GPL-3.0; patchstorage-lv2-uploader = GPL-3.0. **The patch *content* on the site carries per-patch licences — must be checked per item before any mirroring.** Dexed = GPL-3.0; DX7 sysex *program data* is a data format, but each cartridge's redistribution rights need per-source review (community compilations often have no explicit licence).

**ACTIVITY:** patchstorage platform: live, ~17.6k patches; docs repo last push 2022-12-19; lv2-uploader 2024-05-05. Dexed: active (above).

**Fold-in verdict: ADOPT-IDEA** — design Anvil's community lane now along these lines: (1) a **beta-style public API** (read + token-authed upload, platform/slug registry, counts) as the long-term shape; (2) an **import pipe** that crawls curated patchstorage platforms on the authoring side (like PF's harvester scripts) with per-item licence capture; (3) the **cartridge/librarian UX** (local folder + drag-drop + "send to hardware") for any DX7-style lane; (4) per-item licence fields on pack cards (PF already has this). Home: packs/community (T9 gaps 6–7). Keep: content = curated separately from code.

---

### 17. SpessaSynth (spessasus) — SF2/DLS synthesis + editing in the browser, **Apache-2.0** (the one permissive licence in this set)

**Links:** https://github.com/spessasus/SpessaSynth (app) · https://github.com/spessasus/spessasynth_core (SF2/DLS/MIDI library) · https://github.com/spessasus/spessasynth_lib (browser/WebAudio wrapper) · https://github.com/spessasus/SpessaFont (SF2/DLS editor)

**Core contribution:** proof that a full **SoundFont2-based synthesizer runs in a browser** — the reference implementation for Anvil's sample-playback/packs lane, and the only project in this pass whose licence (Apache-2.0) even permits direct code reuse with attribution.

**KEY FACTS:**
- Self-description: "SpessaSynth is a SoundFont2-based real-time synthesizer written in TypeScript"; project split: core (SF2/DLS/MIDI library), lib ("wrapper optimized for browsers and WebAudioAPI"), app (online/local MIDI player/editor GUI), SpessaFont (SF2/DLS editor).
- App features: MIDI-sequence visualization ("visual pitch bend and note-on effects"), playable keyboard of various sizes (mobile friendly), "integrated controller for the synthesizer with numerous options: Edit instruments, controllers, and more", supported on Chromium/Gecko incl. Android.
- Relevance: T9 entry 13's export bench already extracts wavetables from audio; annex 05 says SF2 plays through the Strudel engine — SpessaSynth is the alternative in-house path (SF2/DLS → WebAudio without a third-party runtime), and it ships an editor (content authoring).

**LICENCE (verbatim):** GitHub SPDX `Apache-2.0` for SpessaSynth (also Apache-2.0 for `spessasynth_core`/`spessasynth_lib` per search). **Permissive — direct reuse permitted with NOTICE/attribution; still prefer reimplementation where it touches Anvil's engine core.**

**ACTIVITY:** SpessaSynth 408 stars · pushed 2026-10-03 · core 69★, lib 51★ (pushed 2026-09/10) · active.

**Fold-in verdict: ADOPT-IDEA** — (1) use as the architecture reference for the sampler/SF2 lane (T9 gap 5) with a real browser precedent; (2) SpessaFont's editor surface = authoring-tool precedent for Anvil's content pipeline; (3) its existence sharpens the differentiation: SF2 playback is table stakes; Anvil's edge is the groovebox/sequencer + native engine. Home: engine (sampler), packs, UX (MIDI player drop-in for previews). Licence note: keep a NOTICE line if any Apache-2.0 code is adapted.

---

## FEATURE MENU TABLE — ranked (item → source → effort → plan area → recommend)

Effort: S ≤ day · M = days · L = week+. Areas: engine / mod / FX / sequencer / UX / packs. Recommend: v1 = first flagship release · v1.x = first update wave · later = roadmap · skip = drop.

| # | Feature / item | Source | Effort | Area | Rec |
|---|---|---|---|---|---|
| 1 | Per-step arp pattern row: octave −2..2, semitone ±11, velocity, gate with pause+hold states | Vaporizer2 | S | sequencer | **v1** |
| 2 | Mod-matrix UX w/ graphical modulation curves + slot/source/dest counts (16/25/220 scale) | Vaporizer2 | M | mod | **v1.x** |
| 3 | 4 macro knobs as mod sources | Vaporizer2 | S | mod | **v1** |
| 4 | 5 LFOs + 5 MSEGs with loop + host sync | Vaporizer2 | M | mod | **v1.x** |
| 5 | Random drift + key-track mod sources | Vaporizer2 | S | mod | **v1.x** |
| 6 | 30+ filter types incl. diode ladder, SVF, comb, scream + 4× oversampled LPF | Vaporizer2 | M | engine | **v1.x** |
| 7 | Real-time filter response display | Vaporizer2 | S | UX | **v1** |
| 8 | Wavetable editor op set (freq shift, smooth, bend/bloat, mix, convolute, time↔freq) | Vaporizer2 | M | UX/engine | **v1.x** |
| 9 | Wavetable generation from one cycle (FM/PWM/sync/filter types) | Vaporizer2 | M | engine | **v1.x** |
| 10 | Serum/Icarus wavetable import with drag & drop | Vaporizer2 | S | UX/packs | **v1** |
| 11 | Sampler→wavetable resample with pitch detection | Vaporizer2 | M | engine/UX | **v1.x** |
| 12 | Bank osc architecture: 4 banks × up to 24-unison w/ normalized detune | Vaporizer2 | L | engine | **v1.x** (post-worklet) |
| 13 | FM chain up to 4 ops + audio-rate pitch/phase mod (~2 kHz) | Vaporizer2 | M | engine | **v1.x** |
| 14 | Sampler osc: loop points, loop-start mod, zero-crossing, key tracking | Vaporizer2 | L | engine | **later** (T9 gap 5) |
| 15 | Granular sampler mode | Vaporizer2 / Bespoke `LooperGranulator` | L | engine | **later** |
| 16 | Real-time additive harmonic+phase editor | Vaporizer2 / Zyn | L | engine | **later** |
| 17 | 3 FX buses + per-bus 4× oversampling + mono-cutoff option | Vaporizer2 | M | FX | **v1.x** |
| 18 | FX census additions: atomizer, comb filter, bitcrush, multiband comp, limiter, formant | Vaporizer2 (src) | M | FX | **v1/v1.x** |
| 19 | Preset browser: tags + free-text search + folders + ratings + `.vvp`-style files | Vaporizer2 | M | UX/packs | **v1.x** (T9 gap 6) |
| 20 | Step-sequencer-as-mod-source: 32 steps, smoothing, tempo sync, retrigger, per-step values | Helm | S | mod | **v1.x** |
| 21 | LFO waveform set incl. 3/4/8-step, 3/5/9-pyramid, S&H, S&G + synced division table | Helm | S | mod | **v1** |
| 22 | Formant filter FX: 5 vowel sets × 4 formants w/ per-formant dB tables | Helm / Zyn / Vaporizer2 | S | FX | **v1** |
| 23 | Stutter FX (buffer repeat up to 2 s, tempo-aware) | Helm | S | FX | **v1** |
| 24 | Polyphonic aftertouch + poly LFO as mod sources | Helm | S | mod | **v1.x** |
| 25 | Per-voice mod matrix w/ documented wiring points (note-on/note-off/realtime MPE) | OB-Xf | M | mod | **v1.x** (T9 gap 2) |
| 26 | Voice priority enum + steal tracking per key | OB-Xf | S | engine | **v1** |
| 27 | Unison voice count + panning spread incl. random pan modes | OB-Xd | S | engine | **v1.x** |
| 28 | Open patch/bank import (foreign FXP/FXB-style) | OB-Xf | M | packs | **v1.x** |
| 29 | FM parameter taxonomy (algorithm, feedback, operator/LFO key sync, pitch EG scaling) | Dexed | M | engine | **v1.x** |
| 30 | Engine-character switch (pristine vs vintage-approximate math) | Dexed (Modern/Mark I/OPL) | S | engine | **later** |
| 31 | Sysex/librarian lane (cartridge browser, send-to-device) | Dexed | M | packs/UX | **v1.x** |
| 32 | Per-operator realtime meters | Dexed | S | UX | **v1** |
| 33 | PAD synthesis engine (random-spectra pad generator) | ZynAddSubFX | L | engine | **later** |
| 34 | FX taxonomy additions: Alienwah, Sympathetic, Reverse, DynamicFilter, CombFilterBank | Zyn | M | FX | **v1.x** |
| 35 | Kit model: layered instruments + per-item FX routing | Zyn / Hydrogen | M | engine/UX | **v1.x** |
| 36 | Per-note controller events (pre-MPE per-note expression) | Zyn (SysEx) | M | mod | **later** |
| 37 | 128-harmonic waveform generator | Zyn | M | engine | **later** |
| 38 | Randomness/"analog drift" as a parameterised source | Zyn / Vaporizer2 | S | mod | **v1.x** |
| 39 | Module-category checklist (54 Rack tag families) as the utility-surface audit | Cardinal | S | UX/engine | **v1** (audit) |
| 40 | Attack the missing utility families: quantizer, S&H, slew, logic, clock modulator, ring mod, LPG, function generator, envelope follower | Cardinal taxonomy | M | mod/FX | **v1.x** |
| 41 | Host Time as a signal + Audio→CV pitch (audio-driven modulation) | Cardinal internal | M | mod | **later** |
| 42 | OSC remote control surface | Cardinal | M | UX | **v1.x** |
| 43 | In-canvas scripting module (extensibility pattern) | Cardinal Text Editor / Bespoke Python | L | UX | **later** |
| 44 | Sequencer paradigm census: M185, circle, dot, slider, radio, rhythm sequencers | Bespoke | M | sequencer | **later** (pick 1–2 in v1.x) |
| 45 | Pulse plumbing: chance/delay/gate/hocket/router/train trigger modules | Bespoke | M | sequencer | **later** |
| 46 | Note canvas (free-time note field) | Bespoke | M | sequencer/UX | **later** |
| 47 | Live-patch-while-playing doctrine (already compatible with PF live-param law) | Bespoke | S | UX | **v1** |
| 48 | Song builder / arrangement module pattern | Bespoke / Hydrogen | M | sequencer | **v1.x** |
| 49 | Nov/bor/stickiness granular parameter family | samplebrain | M | engine/UX | **later** |
| 50 | Brain/synapse similarity data model + session files | samplebrain | L | engine/packs | **later** |
| 51 | MFCC vs FFT matching + autotune of matched blocks | samplebrain | M | engine | **later** |
| 52 | Probabilistic step fields: play probability, note-choice, timing/velocity/length jitter | Stochas | M | sequencer | **v1.x** (extends T3 §17) |
| 53 | 4 polyrhythmic layers (own TS/speed/step count per layer) | Stochas | M | sequencer | **v1.x** |
| 54 | Grooves importable from MIDI files | Stochas | M | sequencer | **later** |
| 55 | Chain mode: cross-step conditional rules ("if note A plays then always/never B") | Stochas | S | sequencer | **v1.x** |
| 56 | Record incoming MIDI straight to the grid | Stochas / seq66 | S | sequencer | **v1** |
| 57 | Mute-groups (one pad = a set of patterns on/off) | seq66 / Stochas | S | sequencer | **v1** |
| 58 | Transposable triggers (re-use a pattern at other pitches) | seq66 | S | sequencer | **v1.x** |
| 59 | Playlists (ordered pattern lists as song) | seq66 | S | sequencer | **v1** |
| 60 | Sequencer LFO → CC/velocity values | seq66 | S | sequencer/mod | **v1.x** |
| 61 | Pattern fixer (expand/compress/align recorded patterns) | seq66 | S | sequencer/UX | **later** |
| 62 | High-resolution internal PPQN (192+ default, 32–19200 range proven) | seq66 | S | engine/scheduler | **v1** |
| 63 | Tracker lane: free pattern placement, transpose, variable pattern length | klystrack | M | sequencer | **later** (second lane) |
| 64 | One-cycle wavetable export (independent confirmation of PF feature) | klystrack | S | packs/export | **v1** (already in PF bench) |
| 65 | Hard sync + ring mod + bitcrush (SID-style engine/FX) | klystrack | S | engine/FX | **v1.x** |
| 66 | Parametric (non-destructive) modifier stacks with "Apply all" | Helio | M | sequencer/UX | **v1.x** |
| 67 | Polymetric model: timeline + per-track time signatures | Helio | M | sequencer | **v1.x** |
| 68 | Microtonal roll: 2048-key range / 192-EDO mapping across 16 channels | Helio | M | engine/UX | **later** (extends PF tuning) |
| 69 | Aleatoric DSL (generative scripting lane) | Helio | L | sequencer/code | **later** |
| 70 | Stacked pattern mode (play multiple patterns simultaneously) | Hydrogen | S | sequencer | **v1.x** |
| 71 | Instrument layers with velocity-range mapping | Hydrogen | M | engine | **v1.x** |
| 72 | Humanization (per-instrument + master, time/pitch) | Hydrogen | S | sequencer | **v1.x** (vs T3 §9) |
| 73 | Drumkit-as-content (metadata, author, licence fields) | Hydrogen | S | packs | **v1.x** |
| 74 | Curve/geometry score surface (shapes as patterns, read-head playhead) | IanniX | L | UX/sequencer | **later** |
| 75 | OSC as a first-class control path | IanniX / Cardinal | M | UX | **later** |
| 76 | Patch-community API design (platform registry, token auth, counts, downloads) | patchstorage beta | M | packs | **v1.x** |
| 77 | Curated import pipe from external patch communities (with per-item licence capture) | patchstorage | M | packs | **v1.x** |
| 78 | Cartridge/librarian UX (local folder + drag-drop + send) | Dexed / patchstorage | M | UX/packs | **v1.x** |
| 79 | Browser SF2/DLS playback path + editor (permissive reference) | SpessaSynth | M | engine/packs | **v1.x** (T9 gap 5) |
| 80 | Microtuning corpus lane (.TUN/.scl/.kbm + MTS-ESP as roadmap) | Vaporizer2/Dexed/Helio | S/M | packs/engine | **v1.x** |

**Menu stats (counted from the table above):** 80 items → **v1 × 16 · v1.x × 41 · v1/v1.x-boundary × 1 · later × 22**; effort mix **S × 30 · M × 40 · L × 9 · S/M × 1**. No row is marked `skip` — `skip` appears only as fold-in verdicts inside entries (node-graph UI as a v1 surface; BeSpec-as-synth; PF-codegen supersession) — see the entries and dead ends. The heavy L-items cluster where T9 already placed the new engineering: worklet DSP engine (rows 12, 14–16), granular lane (15, 49–51), scripting/extensibility (43, 69), visual score (74).

---

## Dead ends / unverified (logged)

- **"Bespec" disambiguation:** `gh search repos bespec` → `BeSpec-Dev/BeSpec` ("Real-time audio spectrum visualizer", 18★, no licence file) — a visualizer, **not a synth**. Taken the intended target to be **Bespoke Synth** (modular synth, novel node-graph UX, GPL-3.0, 4.7k★); both logged here. If "Bespec" meant something else, re-check with the parent.
- **`surge-synthesizer/obxd` 404** — the OB-Xd continuation repo is `surge-synthesizer/OB-Xf`. (1 attempt, redirected.)
- **`Yoshimi-and-ZynAddSubFX/zyn-fusion` 404** — correct repos: `Yoshimi/yoshimi`, `zynaddsubfx/zynaddsubfx`. (1 attempt, redirected.)
- **GitHub search API rate limit** — one `gh search repos` call returned HTTP 403 (search quota 30/min); retried via core `gh api` endpoints after cooldown. No data lost.
- **Vaporizer2 manual PDF extraction** — fetched twice; the extractor returned the TOC + scattered fragments only (no full text, no saved-file path). Feature list was therefore rebuilt from the vendor product page + repo source listings (both first-party); the manual's own numbers (16 matrix slots / "11 input sources" wording) conflict with the current product page (25 sources / 220 destinations) — **recorded both, marked by source**; do not cite the old manual numbers as current.
- **Helm manual PDF** (tytel.org/static/docs/helm_manual.pdf) — extraction returned only the TOC. ALL Helm specifics above come from the repo source (README, `helm_common.h`, `helm_engine.*`, `helm_voice_handler.*`, `helm_editor.cpp`) instead. (2 attempts.)
- **ZynAddSubFX GitHub releases are stale** (latest tag 2.5.3-osx, 2016) while `main` is active (pushed 2026-09-10) — activity figures use push dates, not releases.
- **Helio has no GitHub releases** (404) — versions ship via helio.fm CI (v3.18 on the site).
- **klystrack GitHub licence detector says "Other"** — the actual `LICENSE` file is MIT/X11-style text (quoted above). Trust the file, not the detector.
- **typebeat (`kofigumbs/typebeat`, AGPL-3.0, 450★)** — keyboard-as-keyboard-layout sequencer; considered, **not entered**: unmaintained since 2022 and macOS-only per its own README ("The Windows app crashes on startup"). Logged as a novel-UX idea only.
- **`textbeat` (MIT, 444★) / `miti` (MIT, 184★)** — plaintext sequencers; noted during search, not entered (Thin coverage in this pass; potential future G-file if the "code lane" needs a text-syntax precedent).
- **Furnace / MilkyTracker / Helio tracker-family alternatives** — not fetched (budget); klystrack + Helio cover the tracker and microtonal-sequencer lanes for this pass.
- **No dedicated open wavetable-collection repos surfaced** (`gh search "wavetables collection"` → empty). Wavetable content in this space lives inside synth repos (Vaporizer2 780+; Serum/Icarus import) and commercial stores — log for the packs workstream.

---

```json
{"file": "C:\\Users\\Moddy\\anvil\\research\\github\\G3-oss-synth-feature-catalogs.md", "items_count": 17}
```
