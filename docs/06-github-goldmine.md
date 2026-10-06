# 06 — GitHub goldmine (addendum)

Date: 2026-10-07 · Trigger: owner ask — "other GitHub resources in this field… scrape for more features / useability / upgrades / plugins / modules / improvements to really go further with the design."
Evidence: `research/github/G1-dsp-engines-and-libs.md` (18 entries) · `G2-web-audio-ecosystem.md` (20) · `G3-oss-synth-feature-catalogs.md` (17 entries + an 80-row ranked feature menu). All parent-verified at the level noted in §3.

## 1. Headline finds

**Engine study corpora (read-before-build, then clean-room/port per file):**
- **Mutable Instruments** lives at `pichenettes/*` — per-**file** licences: Rings/Elements/Clouds/Braids/Plaits/Tides/Warps/Peaks carry **MIT** headers; Edges/Grids are GPL; `stmlib` MIT (two stated exceptions). → the corpora for **granular (Clouds)**, **modal/physical modelling (Rings/Elements)**, **osc models (Braids/Plaits)**.
- **Dexed's FM core (`msfa`) is Apache-2.0** — the cleanest FM reference found (read for the FM slot in P1/P2).
- **Airwindows: MIT, ~500 dependency-free effect sources** (+ `airwin2rack` MIT "Airwindows Consolidated" with a **uniform effect-registry API** worth copying as a pattern) → the FX depth palette for v1.x expansions.
- **ChowDSP is a licence matrix, not "BSD-3"**: `chowdsp_wdf`, ChowKick, ChowMatrix = BSD-3; `chowdsp_utils` mixed (DSP modules GPL, plumbing BSD); **ChowTape = GPL** → handle per repo.

**Web libs to adopt (G2):** webaudio-controls + pianoroll (Apache-2.0, knob/roll controls) · wavesurfer.js (BSD-3, waveform UI) · butterchurn (MIT, visualiser) · WEBMIDI.js (Apache-2.0) / JZZ (MIT) / html-midi-player (BSD-2) · Meyda (MIT, analysis) · pitchy (0BSD, tuner) · loudness-worklet (MIT, LUFS) · libflac.js (MIT) · opus-recorder (MIT) · wasm-audio-decoders (MIT) · SpessaSynth (Apache-2.0, SF2) · smplr (MIT) · sfumato (ISC) · glicol (MIT).
**Skips/flags:** aubiojs (MIT file over GPL-3 upstream — SKIP), webaudiofont (GPL-3 — SKIP), WAM community plugins mostly **unlicensed** (only specific MIT ones usable), `socalabs` org is empty (real account `FigBug`), waveedit-online "CC0" is **README-only, no LICENSE file**.

**Content sources:** `okwt` (MIT wavetables) · **IR-Library (MIT, ~738 IRs)** · openAIR (per-item CC) + EchoThief (derivative grant) · AKWF CC0 re-confirmed. **patchstorage's API exposes 17,580 patches** — scale reference for the community-store design.

**Sequencer semantics backlog (v1.x):** Stochas (GPL-3, active — stochastic step model + polyrhythm), Helio (parametric modifiers, aleatoric scripting, 192-EDO), seq66 (live-loop, mute-groups, playlists, 192+ PPQN), Bespoke Synth (13 sequencer paradigms), klystrack (tracker-style, MIT-style).

## 2. The v1 items this adds (from G3's ranked menu — all small, S)

1. Per-step arp pattern row: octave ±2, semitone ±11, velocity, gate with pause+hold states (Vaporizer2)
2. 4 macro knobs as mod sources (already specced — now an explicit acceptance check) · 3. Real-time filter-response display · 4. Serum/Icarus wavetable import + drag-drop · 5. FX census adds: atomizer, comb, bitcrush, multiband comp, formant · 6. LFO waveform set incl. 3/4/8-step, 3/5/9-pyramid, S&H, S&G + synced divisions (Helm) · 7. Formant filter: 5 vowel sets × 4 formants w/ per-formant dB tables · 8. Stutter FX (≤2 s buffer repeat, tempo-aware) · 9. Voice-priority enum + per-key steal tracking (OB-Xf) · 10. Per-operator realtime meters (Dexed) · 11. 54-family module-category audit checklist (Cardinal taxonomy) · 12. Live-patch-while-playing doctrine (already matches PF law) · 13. Record incoming MIDI straight to the grid · 14. Mute-groups (one pad = a set of patterns) · 15. Playlists (ordered pattern lists as song) · 16. High-res internal PPQN (192+; range 32–19200 proven) · 17. One-cycle wavetable export (already in PF; re-confirmed).

Everything else on the 80-row menu is ranked v1.x ×41 / later ×22 — parked as the post-launch backlog, item-level list in G3.

## 3. Verification & flags

- Parent spot-checks passed: **Airwindows LICENSE = MIT** ✓ · **SpessaSynth = Apache-2.0** ✓ · **Vaporizer2 = GPL-3.0** ✓ · eurorack README live (per-file licence split = child-verified; **per-file audit mandatory before any port**).
- Flagged for their phase gates: Dexed `msfa` COPYING path (parent 404 — re-fetch at P2 read time); MI per-file headers; WAM community unlicensed; waveedit-online README-only CC0.
- **Standing rule:** PORT-STUDY ≠ port. Every code candidate gets a per-file licence audit at its phase gate; GPL/AGPL = clean-room only. Nothing from this wave changes v1 scope — it adds named corpora, lib names, and 16 explicit small items.

## 4. Where it folds in

- `03-implementation-spec.md` §8 → depth-corpora pointer (added).
- P2 read order: MI Clouds/Rings + msfa first (granular + FM). P3 FX pass: Airwindows study list. P4: Stochas/Helio/seq66 semantics backlog into the sequencer spec. P5: IR-Library + okwt into packs.
- `02` UI notes: webaudio-controls/pianoroll/wavesurfer/butterchurn as build candidates.
