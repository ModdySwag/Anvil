# REFERENCE RIG — external tools & content on the build machine

Date: 2026-10-07 · Owner directive: mine this machine for anything that helps Anvil; fold in what helps.

**LICENCE LAW (holds for everything on this page):** commercial instruments, plugins and sound packs
are registered here as **A/B listening references and private test corpora only**. Nothing from them
ships in Anvil; shipping content = own-authored / CC0 / public-domain with a licence audit. Ideas are
folded in as **own implementations** (concept-level — never copied assets or code).

## A/B listening targets (installed, verified 2026-10-07)

**Korg Collection — 21 titles** (`C:\Program Files\KORG\*`, standalones + VST3/VST2; user data in
`Documents\KORG\`): MS-20 · MS-20FX · Polysix · MonoPoly · WAVESTATION · M1 · TRITON · TRITON Extreme ·
TRINITY · Prophecy · PS-3300 · ARP 2600 · ARP ODYSSEY · microKORG · miniKORG · EP-1 · ELECTRIBE-R ·
KAOSS PAD · LegacyCell · MDE-X · Filter Ark · SGX-2 · VOX Super Continental.

Use by phase (listening gates in `docs/03` §5):
- P1 wavetable — WAVESTATION as a wave-motion character reference (concept only).
- P2 engines — MS-20 (filter character A/B vs our ladder), Polysix (ensemble/chorus),
  MonoPoly (sync / 4-VCO behaviour), M1 / TRITON (PCM workstation balance).
- P3 FX — MDE-X + Filter Ark as A/B for the FX rack.
- P5 content — SGX-2 piano for A/B (its 11 GB sample DB at `Desktop\Korg Synths\SGX-2` is a
  proprietary "Korg"-magic protobuf database; reference artifact, not usable content).

**Serum 2** (`Common Files\VST3\Serum2.vst3`; tables at `Documents\Xfer\Serum 2 Presets\Tables\` incl.
`Analog\`, `S2 Tables\`, `User\`) — the **wavetable-import acceptance corpus** for the G2 check
("Serum/Icarus wavetable import + drag-drop", `docs/06`): import-path test material only; the tables
are proprietary and never ship.

**FL Studio 2026** (`C:\Program Files\Image-Line\FL Studio 2026`; user data `Documents\Image-Line\` —
Loops, Harmor, FLEX, FPC, Edison, DirectWave, Fruity Convolver, Maximus) — ideas: Harmor (additive /
spectral resynthesis, P3+ study), FPC/FLEX (workstation UX). Loops = private test fodder for the
sampler/granular import path.

**Ableton Live 12 Suite** — `Documents\Ableton\` (Factory Packs, User Library, Live Recordings):
general A/B + private test fodder.

**Other VST3s** (Kontakt 8 Portable, MeldaProduction, Plugin Alliance, Nexus, Rippler, Unison,
Vanguard, Behringer) — general references at need.

## Ideas to fold in (concept-level; own implementation)

**Overtonium** (AGPLv3, C++/JUCE 32-partial additive synth — `C:\Program Files\Overtonium`,
`Overtonium.vst3`; by Benjamin Dehli):
1. **TUNE — continuous equal↔just morph per partial** ("Just Saw" vs "Equal Saw": one control reframes
   the whole stack). Candidate for the microtuning module + the P5 **PERFECT TUNINGS** pack — a morph
   between 12-TET and exact integer ratios as our own DSP/UX.
2. **Per-partial DRIFT / whole-instrument WOBBLE** (cassette lineage — two independent tape paths =
   double-tracking). Candidate lo-fi character module / FX-rack flavour (P3).
3. **Interval-coloured channel strips** — a channel takes the colour of its musical interval against
   the root. UI idea for mod-source chips / key colouring (02 §9 already reserves per-source hues).
4. Ethics alignment: opt-in update check, no dialog, nothing on the network unless asked — matches the
   fairness spine; nothing to build.

**Harmor (FL)** — additive/spectral resynthesis as a UI study for later-phase engines.
**KAOSS PAD / ELECTRIBE-R** — XY-performance gesture reference for the post-v1 XY pad (02 §6).

## Private test corpora (never committed, never shipped)

- Wavetable import: `Documents\Xfer\Serum 2 Presets\Tables\` (import-path tests only).
- Sampler / granular: Image-Line Loops, Ableton Library, owned packs — inventory when the P2 sample
  core lands.
- A/B listening runs from the installed instruments; any reference renders stay private and undeployed.
