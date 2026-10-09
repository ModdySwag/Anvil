# Third-party notices - Anvil

Anvil itself - (c) 2026 Modtech (a.k.a. Moddy), <modtech@gmail.com>, github.com/ModdySwag - is
free software under the GNU AGPL-3.0-or-later (see LICENSE). It bundles **no third-party code,
media or data**: the single `index.html` is Anvil's own source, concatenated by `build.py`, and
every shipped sound bank is first-party (authored or generated for this project). Everything
listed below is either credited as an influence on original code, or read from public format
documentation. Nothing here is redistributed inside the artifact.

## Fetched at runtime (not bundled)

The app has **no third-party runtime fetches**. It loads only its own first-party files - its
packs and help from wherever it is served - and the family bridges (a Resonance Studio pack
import, the World Radio hand-off) reach `moddys.net` only when you click them. Nothing else
leaves the machine.

## Influences credited in the source (original code, not copied)

- **Open303** (Robin Schmidt, MIT) - its acid voice design is the published reference Anvil's
  ACID engine follows; the implementation here is clean-room, original text.
- **MoogLadders** (github.com/ddiakopoulos/MoogLadders, Unlicense) - ladder-filter reference for
  the same engine; likewise re-implemented as Anvil's own code.
- **Documented file formats** - the import pipeline (EXS24, NN-XT/SXT, Kontakt NKI, Ableton
  Live .als, Serum presets, REX2, AIFF/AIFC, SMF) was implemented from public format
  documentation and observed file structure only; no third-party decoder code is included.

The Roland TB-303 lineage is present as *behaviour* only (filter response, accent character,
slide); the code and the art are original.
