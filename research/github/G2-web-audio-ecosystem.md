# G2 — Web-audio ecosystem on GitHub: libraries, plugins, widgets, encoders, analysis (verified scouting report)

Date: 2026-10-07 · Author: Bob (Hermes, deepseek profile, subagent) · Status: read-only research; single write = this file.
Scope: GitHub-verified survey of the web-audio ecosystem for Anvil — curated lists; WAM 2.x plugin catalog (deep dive, T4 §15 cited not redone); socalabs/FigBug; web synth & DAW prior art (GridSound, midi.city, midi-synth, glicol, Elementary, Tone.js); UI/widget libs; MIDI libs; analysis/FX; encoders/decoders; soundfont players; IR/reverb collections. Each entry: what it is, VERBATIM licence (from the licence file where one exists; absence stated explicitly), maintenance status, browser reality, value for Anvil, fold-in verdict.
Builds on (read first, not redone): `anvil/research/matrix/T4-synth-feature-matrix.md` §15 [T4-15] (WAM spec history, sync/perf design, ecosystem reality check) · `anvil/research/ui/T7-ui-flair.md` [T7] (evidence format, UI craft).
Provenance: every GitHub fact fetched live 2026-10-07 with authenticated `gh` (gh 2.99.0, `gh api` / `gh search repos` / raw README+LICENSE fetches). Web facts fetched same day (curl / web extract). Uncommitted as facts: nothing below is from memory — licence strings are quoted from the actual files; where a repo has no licence file this is stated. Dead ends + rate-limit incident logged §Dead ends. No URL was fetched more than 3 times.

---

### 1. notthetup/awesome-webaudio — the canonical curated index (CC0), plus the also-rans

**Links:** https://github.com/notthetup/awesome-webaudio (1,397★, pushed 2026-06-05) · https://github.com/amilajack/awesome-web-audio · https://github.com/mikkergimenez/awesome-web-audio · https://github.com/haras-unicorn/awesome-elementary-audio

**Core contribution:** The single best-maintained index of the whole ecosystem (115 links) — and it ships an explicit *Obsolete* graveyard, which is itself intelligence: most Web-Audio classics (Gibberish, WAAX, Pizzicato, Recorderjs, web-audio-test-api, Band.js…) are dead.

**KEY FACTS**
- Licence: **no LICENSE file at repo root** (root = .travis.yml, code-of-conduct.md, contributing.md, readme.md). The README carries a CC0 badge and states verbatim: *"To the extent possible under law, Chinmay Pendharkar has waived all copyright and related or neighboring rights to this work."* → effectively CC0 (readme.md, fetch 2026-10-07). Reusable with confidence.
- Sections: Frameworks · Libraries · Utilities · MIDI · Apps · Resources · Tutorials · Books · Newsletters · Community · Obsolete. 115 unique links counted.
- Alternatives are duds by comparison: amilajack/awesome-web-audio last pushed 2021-09-03; mikkergimenez 2024-08-13; haras-unicorn/awesome-elementary-audio 2023-08-14 (Elementary-only).
- Its live picks matched what we independently verified as maintained: Tone.js, wavesurfer.js, Meyda, html-midi-player, WEBMIDI.js, JZZ, webaudio-tinysynth, cwilso/metronome.

**Fold-in verdict:** ADOPT-IDEA (process) — keep this as the standing mining index for Anvil's shortlist; CC0 lets us reuse its structure in our own docs. Plan area: research maintenance / dependency radar.

---

### 2. WAM 2.x core stack — api / sdk / wam-examples / webdx7 / sdk-parammgr / webcz101 (licence re-verification)

**Links:** https://github.com/webaudiomodules/api · https://github.com/webaudiomodules/sdk · https://github.com/webaudiomodules/wam-examples · https://github.com/webaudiomodules/webdx7 · https://github.com/webaudiomodules/sdk-parammgr · https://github.com/webaudiomodules/webcz101 · [T4-15] for spec/perf (not redone here)

**Core contribution:** The spec + SDK layer for URI-loadable web plugins. T4 §15 already covers what it is and its performance design; this entry only re-verifies licences and liveness so reuse decisions don't rest on stale information.

**KEY FACTS**
- The org contains exactly 6 public repos: api (205★), webdx7 (159★), wam-examples (61★), webcz101 (40★), sdk (24★), sdk-parammgr (3★) (org listing, 2026-10-07).
- **api: no LICENSE file at repo root today** — root = .gitignore, README.md, dist, docs, package-lock.json, package.json, src, tsconfig.json; package.json declares `"license": "MIT"`, name `@webaudiomodules/api`, version `2.0.0-alpha.6`; pushed 2023-03-06. (T4 §15 quoted an MIT LICENSE header; that file is no longer at root — flag when reusing.)
- **sdk: no LICENSE file**; package.json `"license": "MIT"`, name `@webaudiomodules/sdk`, version `0.0.12`; pushed 2024-07-26.
- wam-examples: LICENSE verbatim = *"MIT License / Copyright (c) 2021 WebAudioModules 2.0 Working Group"*; pushed 2025-11-02 — the freshest core repo.
- webdx7: LICENSE begins *"Copyright 2021 Jari Kleimola & others / Permission is hereby granted, free of charge…"* (MIT body; GitHub spdx=MIT); pushed 2022-03-01.
- sdk-parammgr: MIT (spdx); pushed 2024-02-24. webcz101: no licence detected anywhere; pushed 2015-08-16 (abandoned).

**Fold-in verdict:** REFERENCE (interop only, per T4 §15) — and **do not import api/sdk code without a per-file header audit** (no root licence). Plan area: architecture / interop.

---

### 3. WAM community catalog — plugins.json, 58 plugins, dissected

**Links:** https://www.webaudiomodules.com/community/plugins.json · https://github.com/boourns/wam-community · gallery: https://mainline.i3s.unice.fr/wamGallery/public/

**Core contribution:** The 58-plugin catalog T4 §15 counted, here broken down so we can mine it for solutions: it is effectively a menu of already-solved browser-plugin problems (SF2 player, drum sampler, MIDI debug, piano roll, IR reverb).

**KEY FACTS**
- 58 plugins total; vendors: **Wimmics 33 / Sequencer Party 25** (counted from the live JSON, 2026-10-07).
- Category counts: Effect 39 · Distortion 9 · MIDI 8 · Modulation 7 · Utility 5 · Instrument 5 · Reverb 5 · Video 4 · Equalizer & Filter 4 · Visualization 4 · Sequencer 3 · External Device 3 · Generator 3 · Delay 3 · Pitch 3 · Modulator 2 · Sampler 2 · Synthesizer 2 · Amp Simulator 2 · Pedalboard 2 · Audio Player 1.
- Instruments worth studying: `com.sequencerParty.soundfont` (SF2 polyphonic player), `drumsampler`/DRM-16, `modal` ("Port of a popular eurorack modal synthesizer. It is a full-blown synt[h]…" — the *Spectrum: Modal* synth T4 §15 cited), `synth101` (mono vintage clone), `audioTrack` (recorder / player / looper).
- MIDI utility gold: `midiIn`/`midiOut` (WebMIDI), `midiDebug` ("Log, generate, and replay MIDI messages"), `pianoRoll` ("Supports variable length clips"), `stepmod` (automation step sequencer), `functionSeq` ("Collaborative live-coding javascript sequencer"), `randomizer`, `envmod` (modulate a parameter with an audio signal), plus patch editors for Korg Microkorg / Roland JX-3p / DSI OB-6.
- Reverb/IR: `microverb` — "Convolution Reverb featuring IRs from some vintage cult-classic hardware"; also `greyhole`, `kbverb`, `owlshimmer`, `owldirty`.
- Visualisation: Wimmics `oscilloscope` / `spectrogram` / `spectroscope` / `livegain` (React WebAudioModules, author Shihong Ren); video: `butterChurn` wrapper, `threejs` livecoder, `isfVideo`, `videoInput`.
- **The index carries no licence metadata** — fields are identifier/name/vendor/website/description/keywords/category/thumbnail/path only. Licence must be chased per vendor (entry 4).

**Fold-in verdict:** ADOPT-IDEA (feature mining; the catalog is our solved-problem checklist) — feed relevant items into the Anvil backlog (MIDI debug panel, piano roll behaviours, IR reverb presets). Plan area: interop + feature backlog.

---

### 4. WAM plugin sources & their real licences — Sequencer Party (MIT) vs Wimmics (dist-only) + micbuffa's SDK

**Links:** https://github.com/boourns/burns-audio-wam · https://github.com/boourns/wam-community · https://github.com/micbuffa/WebAudioPlugins · https://github.com/micbuffa/WAMSampler · https://github.com/boourns/Spectrum

**Core contribution:** The actual open sources behind the catalog — one vendor is clearly MIT, the other is a patchwork that must not be copied blind. This is the licence posture the index hides.

**KEY FACTS**
- **burns-audio-wam** ("A collection of Web Audio Modules (WAMs) powering sequencer.party", 30★, pushed 2024-03-05): package.json declares `"license": "MIT"`; **no LICENSE file at root** (root = .github, .gitignore, .gitmodules, .npmignore, .yarn, .yarnrc.yml, README.md, package.json, src, tools, vendor, yarn.lock). `src/plugins` holds all 26 Sequencer Party plugin sources: audio_input, audio_track, delay, distortion, drumsampler, envmod, functionseq, jx3p_editor, microkorg_editor, midi_debug, midi_input, midi_output, modal, ob6_editor, pianoroll, randomizer, reverb, shared, simpleEQ, soundfont, stepmod, synth101, video_butterchurn, video_input, video_isf, video_threejs.
- **wam-community** (the prebuilt bundle repo, 45★, pushed 2024-03-05): **no LICENSE file and no license field in its package.json** — the collection grants nothing itself; each dist inherits upstream terms. Treat the index as distribution infrastructure, not licensed code.
- Wimmics plugins (33/58): dists live under `plugins/wimmics/*`; sample descriptor (`quadrafuzz/dist/descriptor.json`) = vendor Wimmics, authors *"Michel Buffa, Q. Beauchet"*, version 1.0.0 — **descriptor.json has no licence field** and the dist has no LICENSE file (checked quadrafuzz's full dist: assets, descriptor.json, index.js, index.js.map, screenshot.png).
- **micbuffa** (the WAM plugin author's GitHub, 150 repos) hosts the reusable pieces: `WebAudioPlugins` ("WebAudioPlugins SDK + examples", **MIT**, 103★), `WAMSampler` ("A sampler plugin in WAM format, using sounds from freesound.org", **MIT**, pushed 2025-09-01), `Faust2WAM3D` (**no licence**, pushed 2026-03-18), plus course repos (WebAudio-Guitar-Amplifier-Simulator 3, tuner, vueJSWithWebAudioControls).
- Spectral lineage check: `boourns/Spectrum` (the iOS/euro rack port repo, 37★) ships a `licenses/` folder including `MutableInstruments.license` — *"Copyright 2014 Emilie Gillet… Permission is hereby granted, free of charge…"* (MIT-style) — the modal-synth heritage is MIT-compatible.

**Fold-in verdict:** ADOPT-IDEA (patterns) + limited ADOPT-LIB (only the MIT parts: burns-audio-wam, micbuffa/WebAudioPlugins, WAMSampler) — **NO-GO on copying unlicensed Wimmics dists**. Plan area: plugin/module architecture; licence policy for any WAM ingestion.

---

### 5. SocaLabs / FigBug — what the "socalabs org" actually is

**Links:** https://github.com/SocaLabs (empty org) · https://github.com/FigBug/SocaLabs · https://github.com/FigBug/slPlugins

**Core contribution:** The open-source catalogue behind SocaLabs.com (Roland Rabien) — desktop C++/VST, not web, but a compact set of classic synth/chip DSP (SID, RP2A03, SN76489, PAPU, physical-model piano, organ, wavetable, mverb reverb) whose algorithms port well to AudioWorklet/wasm.

**KEY FACTS**
- The GitHub org `SocaLabs` **exists but has zero repos** (org id 138666829); the working account is **FigBug** — SocaLabs aggregator repo (29★, pushed 2026-10-05) with modules as submodules: Organ, PAPU, Piano, RP2A03, SID, SN76489, Voc, Wavetable, mverb, slPlugins.
- **slPlugins** ("Various VST/AU Plugins from SocaLabs.com", 155★): LICENSE.md = BSD-3-Clause — *"Copyright 2020 Roland Rabien / Redistribution and use in source and binary forms…"*, spdx BSD-3-Clause.
- **Module licences are mixed** (verified spdx, 2026-10-07): mverb **GPL-3.0** · SID **GPL-3.0** · Organ **GPL-3.0** · PAPU **GPL-2.0** · Piano **GPL-2.0** · Voc **LGPL-2.1** · SN76489 **LGPL-2.1** · RP2A03 **LGPL-2.1** · Wavetable **BSD-3-Clause**. All pushed 2026-10-05 (family is alive).
- mverb is the classic MVerb reverb lineage already ported elsewhere on the web — the algorithm is studyable, the GPL-3 code is not copy-safe into a permissive product.

**Fold-in verdict:** REFERENCE + ADOPT-IDEA (DSP recipes: physical-model piano, chip emulations) — copy-safe code: **slPlugins + Wavetable (BSD-3) only**; SKIP mverb/SID/Organ/PAPU/Piano code (GPL), LGPL modules only via dynamic-link style or not at all. Plan area: engine DSP research; per-module licence table into our dependency policy.

---

### 6. GridSound — the AGPL-3.0 browser DAW (read-only masterpiece)

**Links:** https://github.com/gridsound/daw (1,876★, v2.60.0, pushed 2026-10-05) · https://gridsound.com · https://github.com/gridsound/gs-ui-components (93★, pushed 2026-10-06)

**Core contribution:** The most complete open web DAW: multi-track arranging, piano roll, effects, export — the best available behavioural reference for our arrange/mix screens. Its AGPL makes it clean-room-only.

**KEY FACTS**
- LICENSE = GNU AGPL-3.0, verbatim header: *"GNU AFFERO GENERAL PUBLIC LICENSE / Version 3, 19 November 2007 / Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>"* (LICENSE file).
- **Even the UI component library is AGPL**: gs-ui-components ("A collection of visual (not audio) components developed for the GridSound's user interface") is AGPL-3.0 too — no copy/paste of code or assets into Anvil; network-copyleft would trigger on our hosted product.
- Actively developed (pushed 2026-10-05/06; version string "GridSound (2.60.0)"). There is also a community site repo (gridsound.com) — a precedent for the accounts/community layer.

**Fold-in verdict:** REFERENCE (behaviour/features only — timeline interaction, mixer, MIDI import handling). Plan area: DAW/arrange prior art + licence-exclusion list.

---

### 7. midi.city — the closed-source instant-play benchmark

**Links:** https://midi.city/ (no public repo found — 3 attempts, §Dead ends)

**Core contribution:** Instant-play web synth with 128 instruments and beats, keyboard/touch play — the closest commercial-grade sibling to Anvil's "instant-on" premise and a coverage benchmark for day-one instrument breadth.

**KEY FACTS**
- Site meta description (verbatim): *"Best Free Online Synthesizer -- Play over 128 instruments (Pianos, Drum Pads, Guitars, Organs, & more) and beats with your keyboard or touchscreen."* (page HTML, 2026-10-07).
- Stack: Next.js app (`/_next/*` bundles); no patch-level depth visible externally (no synth editor exposed) — it competes on breadth + zero friction, not sound-design depth.
- Attribution: page payload text nodes include *"Copyright © 2022 Astral Digital"*; a promo line references *"MoonDial — Bedside Night Clock (iOS) — by the creator of midi.city"* (same maker, no source release found).

**Fold-in verdict:** REFERENCE — benchmark for first-run UX and instrument-count claims; nothing adoptable code-wise (closed). Plan area: onboarding metrics target ("128 instruments" is the number to beat at launch).

---

### 8. cwilso/midi-synth — MIT Web-MIDI poly synth prior art

**Links:** https://github.com/cwilso/midi-synth (609★, pushed 2022-12-24)

**Core contribution:** The canonical minimal Web MIDI → Web Audio polysynth by Chris Wilson (Web Audio spec editor): MIDI input handling, voice allocation, filter/envelope UI in one readable codebase.

**KEY FACTS**
- LICENSE.txt verbatim: *"The MIT License (MIT) / Copyright (c) 2014 Chris Wilson"* → copy-safe with attribution.
- Unmaintained since 2022-12-24, but stable and small — ideal study material, not a dependency.
- The depth-first counterpart to midi.city: one synth done properly (oscillators, envelopes, filter), vs many presets; Anvil needs both lineages ([T4-16]).
- Referenced in [T4 §16/§31] as the Web MIDI I/O prior art.

**Fold-in verdict:** ADOPT-IDEA (voice/MIDI plumbing patterns; MIT permits even code reuse). Plan area: MIDI screen + voice engine.

---

### 9. glicol — MIT graph-oriented live-coding language & DSP (wasm)

**Links:** https://github.com/chaosprint/glicol (3,004★, pushed 2025-04-06) · https://glicol.org · sibling: glicol-cli (195★), glicol-wgpu editor, glicol-vst

**Core contribution:** A live-coding language where a patch is a *graph of nodes* compiled to wasm — the best-studied example of shipping a text/graph patch language in the browser. Direct prior art if Anvil adds a patch-linking/DSL power-user layer.

**KEY FACTS**
- LICENSE verbatim: *"The MIT License (MIT) / Copyright (c) 2020-present Qichao Lan (chaopsrint)"*.
- Rust core, wasm build; 3k★ makes it the most popular experimental web-audio language repo found; last push 2025-04-06 → slowing (watch, don't depend).
- Concept: nodes declared as `func: param;` in a string; graphs update live without restarting the audio thread (README/org repos).

**Fold-in verdict:** ADOPT-IDEA (graph-patch UX + live-edit semantics for the Mod screen and any "text → sound" feature). Not a dependency for our AudioWorklet engine. Plan area: Mod screen / power-user features.

---

### 10. Elementary Audio (elemaudio/elementary) — MIT signal-graph engine

**Links:** https://github.com/elemaudio/elementary (517★, pushed 2026-01-19) · web-examples (ISC) · offline-examples (ISC) · docs (CC-BY-SA-4.0) · srvb (MIT)

**Core contribution:** "Elementary is a JavaScript library for digital audio signal processing" — declarative, functional signal graphs that render in browser *and* native; the most credible alternative engine design to hand-rolled AudioWorklet code, plus a worked offline-rendering story.

**KEY FACTS**
- Core repo licence **MIT**; examples repos **ISC**; community docs **CC-BY-SA-4.0** (attribution required for doc reuse).
- Dead end: the widely-cited `elemaudio/core` is 404 — current repo is `elemaudio/elementary` (rename; verified 2026-10-07).
- Ecosystem: 517★ core, web-examples 44★, community docs 63★; srvb (120★) is a small reverb plugin written in Elementary — a worked plugin example.
- Value: block-size/sample-rate handled by the renderer; nodes are pure functions (`el.cycle`, `el.lowpass` style) — the cleanest teacher of signal-flow thinking we found.

**Fold-in verdict:** REFERENCE/ADOPT-IDEA (engine API aesthetics + offline render patterns; shortlist candidate if we ever change engines). Plan area: engine architecture.

---

### 11. Tone.js — MIT, the ecosystem default (our narrow-import candidate)

**Links:** https://github.com/Tonejs/Tone.js (14,751★, pushed 2026-10-04) · https://tonejs.github.io · verified path: `Tone/core/util/Draw.ts`

**Core contribution:** Full framework: **Transport** (musical scheduling), synths/FX, **OfflineContext** rendering, and **Tone.Draw** — canvas drawing synchronised to audio-time events. Even where Anvil writes its own DSP, these non-DSP layers are the pragmatic reuse target.

**KEY FACTS**
- LICENSE.md verbatim: *"MIT License / Copyright (c) 2014-2025 Yotam Mann"*.
- Actively maintained: pushed 2026-10-04 (three days before this report); npm `tone` v15.1.22, 2 deps.
- Browser reality: npm unpacked 5.28 MB — do **not** ship wholesale; import narrowly (`Transport`, `Draw`, `OfflineContext`) via tree-shaking.
- `Tone/core/util/Draw.ts` exists (verified by directory listing) — the sync-animation-to-audio helper [T7/T4] flagged; OfflineContext is the export-rendering scaffold.

**Fold-in verdict:** ADOPT-LIB (narrow imports for timing/draw/offline layers) + REFERENCE for API design. Plan area: timeline + UI animation + export scaffolding.

---

### 12. webaudio-controls + webaudio-pianoroll (g200kg) — Apache-2.0 widgets

**Links:** https://github.com/g200kg/webaudio-controls (372★, pushed 2025-10-04) · https://github.com/g200kg/webaudio-pianoroll (111★, pushed 2024-04-21)

**Core contribution:** Web-component knob/slider/switch library + a pianoroll editor component — the fastest route to credible hardware-style controls and a note editor without inventing either.

**KEY FACTS**
- Both **Apache-2.0** (LICENSE files verified: "Apache License / Version 2.0, January 2004").
- **Dead end: `GoogleChromeLabs/webaudio-controls` is 404** — the brief's label is off; the canonical, maintained repo is g200kg's (the library was orginally Google-authored in its early life). Nothing live to adopt from GoogleChromeLabs here.
- Distribution is GitHub-first: npm `webaudio-controls` lookup returned Not Found — vendor the JS or use the repo/dist via jsDelivr.
- pianoroll pairs with the controls set (same author; README cross-links); micbuffa maintains forks used in WAM course projects (entry 4).

**Fold-in verdict:** ADOPT-LIB (controls now; pianoroll as base or reference for the note editor). Plan area: UI controls + editing surfaces.

---

### 13. wavesurfer.js — BSD-3 waveform player/renderer

**Links:** https://github.com/katspaugh/wavesurfer.js (10,428★, pushed 2026-10-05) · https://wavesurfer.xyz

**Core contribution:** The de-facto waveform display/playback library: regions, markers, plugin set (spectrogram, minimap, record), and a decoded-buffer path that works without `<audio>`.

**KEY FACTS**
- LICENSE verbatim: *"BSD 3-Clause License / Copyright (c) 2012-2023, katspaugh and contributors"*.
- Actively maintained (pushed 2026-10-05); v8.0.1; npm unpacked 1.52 MB with **0 dependencies**.
- Use cases: sample-browser waveforms, export/preview scrubbing, recording UI — all screens where we'd otherwise hand-draw canvas.

**Fold-in verdict:** ADOPT-LIB. Plan area: sample/audio-file UI.

---

### 14. butterchurn — MIT Milkdrop visualizer (WebGL)

**Links:** https://github.com/jberg/butterchurn (1,963★, pushed 2026-04-20) · precedent: WAM `com.sequencerParty.butterChurn`

**Core contribution:** WebGL implementation of Winamp's Milkdrop — instant high-grade reactive visuals with a large preset ecosystem, already proven inside an audio-graph host via its WAM wrapper.

**KEY FACTS**
- LICENSE verbatim: *"MIT License / Copyright (c) 2013-2018 Jordan Berg"*; npm v2.6.7, 711 KB unpacked.
- Its WAM integration (entry 3) proves it slots into plugin-graph hosts — the pattern transfers.
- Browser reality: WebGL2, the heaviest visual module in this report → gate behind a "Perform/Visual mode" toggle ([T7] Play-View concept), never load in edit screens.

**Fold-in verdict:** ADOPT-LIB (visualiser mode) or ADOPT-IDEA if we build our own canvas visuals; MIT keeps both open. Plan area: perform/visual screen.

---

### 15. MIDI layer — WEBMIDI.js (Apache-2.0) + JZZ (MIT) + html-midi-player (BSD-2)

**Links:** https://github.com/djipco/webmidi (1,715★, pushed 2026-10-01) · https://github.com/jazz-soft/JZZ (MIT, pushed 2026-02-01) · https://github.com/cifkao/html-midi-player (911★, pushed 2025-07-06)

**Core contribution:** Input/output plumbing (two mature options) + a drop-in MIDI-file player with piano-roll display — covers the whole "MIDI in, MIDI files in, MIDI out" surface.

**KEY FACTS**
- **webmidi**: LICENSE.txt = Apache-2.0 (*"Apache License / Version 2.0, January 2004…"*); v3.3.1; "Tame the Web MIDI API. Send and receive MIDI messages with ease. Control instruments with user-friendly functions (playNote, sendPitchBend, …)"; npm unpacked 4.75 MB → import the ESM surface, not the kitchen sink. Active (2026-10-01).
- **JZZ**: MIT (spdx), lighter alternative + `JZZ-midi-Gear` for device presets; active 2026-02-01. (Both were linked from awesome-webaudio — independent verification passed.)
- **html-midi-player**: LICENSE = *"BSD 2-Clause License / Copyright (c) 2020, Ondřej Cífka"*; v1.6.0, only 108 KB unpacked — renders MIDI files as animated piano roll and plays them; ideal for import previews and demo songs.
- **MPE**: no mainstream JS MPE helper exists; the only real find was `dimitriaatos/mpe-state` ("State management for MIDI Polyphonic Expression (MPE)") — small/niche. MPE in the browser remains DIY per-channel pitch bend, confirming [T4 §30]: real MPE support is a differentiator.

**Fold-in verdict:** ADOPT-LIB (webmidi or JZZ for I/O; html-midi-player for MIDI-file preview) + note MPE is ours to build. Plan area: MIDI screen + import/demo.

---

### 16. Meyda — MIT audio feature extraction

**Links:** https://github.com/meyda/meyda (1,669★, pushed 2024-07-15)

**Core contribution:** The standard JS feature-extraction library (spectral centroid/flux, RMS, loudness, MFCC, chroma…) — the analysis brain for visualisers, meters, and "smart" features.

**KEY FACTS**
- LICENSE.md verbatim: *"# The MIT License (MIT) / Copyright (c) 2014 Hugh A. Rawlinson, Nevo Segal, Jakub Fiala"*.
- v5.6.3; npm unpacked 543 KB, 5 deps; last push 2024-07-15 → stable but cooling (no 2025/26 commits). Pin a version; fork-ready if needed.
- Runs off analyser/buffer data (not audio-thread-critical) — pairs with our own scope/spectrum canvases.

**Fold-in verdict:** ADOPT-LIB (analysis layer behind visualisers + smart naming/search features). Plan area: visualisers / meters.

---

### 17. Pitch & loudness cluster — pitchy (0BSD) + loudness-worklet (MIT), with aubiojs as cautionary tale

**Links:** https://github.com/ianprime0509/pitchy (137★, pushed 2024-07-01) · https://github.com/lcweden/loudness-worklet (14★, pushed 2026-10-01) · https://github.com/qiuxiang/aubiojs (174★, pushed 2023-08-17)

**Core contribution:** Real-time pitch detection (pitchy), real-time loudness (LUFS-style) metering inside an AudioWorklet (loudness-worklet), and the aubio-port licence trap to avoid.

**KEY FACTS**
- **pitchy**: LICENSE = *"Copyright Ian Johnson / Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted."* — GitHub spdx = **0BSD** (public-domain-equivalent); npm v4.1.0, **32 KB**, implements the McLeod pitch method. Discrepancy: npm metadata lists "MIT" — both permissive, but credit per the file.
- **loudness-worklet**: *"MIT License / Copyright (c) 2025 lcweden"* — "Lightweight real-time audio loudness measurement in the browser via Audio Worklet"; pushed 2026-10-01 → fresh micro-lib, exactly right for export loudness checks and a mastering-style meter. Tiny (14★): budget a vendored copy + a read of the worklet.
- **aubiojs**: licence file is MIT text (*"Copyright (c) 2021 7c00 <i@7c00.cc>"* + standard grant) **but** it is a wasm port of aubio — upstream aubio is **GPL-3.0**; shipping the wasm under MIT-only terms is legally suspect. Also stale (2023-08).

**Fold-in verdict:** ADOPT-LIB (pitchy for tuner/pitch UI; loudness-worklet for meters/export). **SKIP aubiojs** (licence risk + stale) — Meyda/pitchy cover the need. Plan area: tuner + metering + export QC.

---

### 18. SoundFont / sample players — SpessaSynth (Apache-2.0), smplr (MIT), sfumato (ISC), webaudiofont (GPL-3 → skip)

**Links:** https://github.com/spessasus/SpessaSynth (408★, pushed 2026-10-03) · https://github.com/danigb/smplr (326★, pushed 2026-09-28) · https://github.com/felixroos/sfumato (23★, pushed 2025-01-30) · https://github.com/surikov/webaudiofont (990★, pushed 2026-09-04)

**Core contribution:** The "real instruments on day one" layer: SF2/DLS synthesis + editing (SpessaSynth), a modern zero-dep sampler (smplr), an SF2 synth from the Strudel author (sfumato), and the classic GM engine whose licence disqualifies it (webaudiofont).

**KEY FACTS**
- **SpessaSynth**: LICENSE = Apache-2.0 (*"Apache License / Version 2.0, January 2004"*); "MIDI SoundFont/DLS player and editor written in TypeScript"; npm `spessasynth_lib` v4.3.14 (2.35 MB unpacked); actively developed (2026-10-03). Player *and* editor → covers demo playback and future SF2 tooling.
- **smplr**: package.json `"license": "MIT"` (**no LICENSE file at root**); "A web audio sampler instrument"; v1.1.0, **zero deps**, 1.06 MB unpacked; ships AUTHORING.md + PRESET_SCHEMA.md → a preset format to study. Active (2026-09-28).
- **sfumato**: package.json `"license": "ISC"` (**no LICENSE file**); "soundfont synth for the web, with sf2 file support" by felixroos; dormant since 2025-01-30 — reference only.
- **webaudiofont**: LICENSE.md = GNU GPL-3.0 verbatim (*"GNU GENERAL PUBLIC LICENSE / Version 3, 29 June 2007…"*); 990★ but **copyleft blocks product use** — do not ship; keep as a testing reference.

**Fold-in verdict:** ADOPT-LIB — SpessaSynth (MIDI/SF2 playback, editing tooling) + smplr (sample kits) ; sfumato REFERENCE ; webaudiofont **SKIP (GPL-3)**. Plan area: playback engine + demo songs + sample management.

---

### 19. Export & import codecs — libflac.js, opus-recorder, lamejs, ffmpeg.wasm, wasm-audio-decoders

**Links:** https://github.com/mmig/libflac.js (96★, pushed 2026-07-21) · https://github.com/chris-rudmin/opus-recorder (995★, pushed 2025-07-18) · https://github.com/zhuker/lamejs (899★, pushed 2024-08-10) · https://github.com/ffmpegwasm/ffmpeg.wasm (17,833★, pushed 2026-09-29) · https://github.com/eshaz/wasm-audio-decoders (572★, pushed 2026-08-27)

**Core contribution:** Everything for "export from the tab, import from the user": lossless FLAC, Opus, MP3 (with a licence catch), a general converter (with a bigger catch), and one decoder family for user imports.

**KEY FACTS**
- **libflac.js**: LICENSE = *"The MIT License (MIT) / Copyright (c) 2014-2020 DFKI GmbH / based on FLAC encoder: Copyright (C) 2000-2009 Josh Coalson / Copyright (C) 2011-2014 Xiph.Org Foundation"*; npm `libflacjs` v5.6.0 — 8.0 MB unpacked (multiple builds; measure the actual wasm you ship). Active 2026-07-21.
- **opus-recorder**: LICENSE.md = *"## Opus Recorder License (MIT) / Original Work Copyright © 2013 Matt Diamond / Modified Work Copyright © 2014 Christopher Rudmin"*; v8.0.5, 571 KB unpacked, **0 deps**; worker-based Ogg-Opus encoding from Web Audio. Pushed 2025-07-18.
- **lamejs**: LICENSE is LAME's own FAQ text — *"Can I use LAME in my commercial program? Yes, you can, under the restrictions of the LGPL. The easiest way to do this is to: 1. Link to LAME as separate jar…"*; npm flags **LGPL-3.0** (v1.2.1, 6.3 MB unpacked). Only take it if we accept LGPL obligations; otherwise MP3 export is optional and WAV/FLAC/Opus carry the feature.
- **ffmpeg.wasm**: wrapper LICENSE = *"MIT License / Copyright (c) 2019 Jerome Wu"*; 17.8k★. **Caution: the wasm core is a build of FFmpeg** (LGPL-2.1+ base; GPL for GPL-configured builds) — audit the `@ffmpeg/core` variant before shipping; also heavyweight (tens of MB) → lazy-load only, or run conversions desktop-side.
- **wasm-audio-decoders** (eshaz): README "Licensing" verbatim — *"The source code that originates in this project is licensed under the MIT license. Please note that any external source code included by repository, such as the decoding libraries included as git submodules and compiled into the dist files, may have different licensing terms."* Modules: faad2, flac, mpg123, ogg, opus, opus-ml, vorbis — sync main-thread and worker paths; one dependency for all import decoding. Active 2026-08-27.
- Dead end logged: `eshaz/mpg123-decoder` 404; `eshaz/mpg123` is an unused git mirror (0★, 2021) → use wasm-audio-decoders for MP3 decode.

**Fold-in verdict:** ADOPT-LIB — libflac.js (lossless export), opus-recorder (compressed export), wasm-audio-decoders (all import decode). lamejs = REFERENCE/optional (LGPL decision); ffmpeg.wasm = REFERENCE (desktop/lazy path, core-licence audit needed). Plan area: export/import module.

---

### 20. IR / reverb collections — openAIR (mixed CC per item) + EchoThief (derivative-use grant)

**Links:** https://openairlib.net/ (About) · https://www.echothief.com/ + EchoThief License PDF (mirror: cs.bu.edu) · precedent: WAM `com.sequencerParty.microverb` (entry 3)

**Core contribution:** Free convolution-reverb content with explicit provenance rituals to copy — the suite's "provenance-manifested content" spine ([T4 §30]) applied to IRs.

**KEY FACTS**
- **openAIR** (Open Acoustic Impulse Response Library, AHRC-funded, York): About page verbatim — *"Most of the content on this site is released under Creative Commons licenses… Information about the licensing of specific content can be found by scrolling to the bottom of that content's pages. Users can choose the licensing for content when they post the content to the website."* → **per-IR licence varies; our manifest must capture it per item.** Covers concert halls, churches, etc.
- **EchoThief**: official licence verbatim — *"You are welcome to use the EchoThief Impulse Response Library to create derivative work (such as convolving it with other sounds to create reverberation). If you would like to use it in any other way, let's talk. You can reach me at chris@superhoax.com."* Site footer: *"copyright 2013-2026 Dr. Chris Warren cwarren@sdsu.edu"*. Over 100 distinctive spaces (caves, skateparks, underpasses) → characterful factory reverb pack; note redistribution-as-library is **not** granted — derivative use (convolving) is.
- The WAM `microverb` ("Convolution Reverb featuring IRs from some vintage cult-classic hardware") is the in-ecosystem precedent for shipping IRs inside a plugin/pack.
- Verification limit (logged): openAIR's per-page licence widgets load dynamically; About-level statement + page structure verified today, individual IR licence texts deferred to ingestion time.

**Fold-in verdict:** ADOPT-IDEA + ADOPT (content): ship curated IR packs with a per-item licence/attribution manifest; EchoThief terms permit reverb-derivative use. Plan area: reverb module + pack store provenance.

---

## Dead ends & incidents (house rule: ≤3 attempts/URL)

- `GoogleChromeLabs/webaudio-controls` → **404** (canonical maintained repo = g200kg/webaudio-controls, entry 12).
- `elemaudio/core` → 404; renamed → `elemaudio/elementary` (entry 10).
- `danigb/sfumato` → 404; actual repo `felixroos/sfumato` (entry 18).
- `eshaz/mpg123-decoder` → 404; `eshaz/mpg123` = unused git mirror → use `eshaz/wasm-audio-decoders` (entry 19).
- `github.com/SocaLabs` org exists with **zero repos** → working account is `FigBug` (entry 5).
- `openairlib` GitHub org/user → 404 (site-only project, entry 20).
- midi.city source repo → not found after 3 attempts (gh search ×2, web search ×1); closed source, entry 7.
- MPE JS helpers → only `dimitriaatos/mpe-state` found; no mainstream option (entry 15).
- `qiuxiang/aubiojs` licence ≠ upstream: MIT file over GPL-3 aubio wasm → flagged SKIP (entry 17).
- Incident: one `gh search` call hit the search-API rate limit (HTTP 403) mid-sweep — queries were re-run paced; no data lost.

**File:** `C:\Users\Moddy\anvil\research\github\G2-web-audio-ecosystem.md`
**Items:** `{"file": "C:\\Users\\Moddy\\anvil\\research\\github\\G2-web-audio-ecosystem.md", "entries": 20, "verdict_counts": {"ADOPT-LIB": 9, "ADOPT-IDEA": 6, "REFERENCE": 5}, "sub_skips": ["aubiojs (licence risk)", "webaudiofont (GPL-3)"], "dead_ends_logged": 9, "incidents": ["one gh search rate-limit 403; re-run paced, no data lost"]}`
