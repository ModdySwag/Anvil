# docs/11 — SAMPLE PACKS: user-importable sample content (plan of record)

Owner ask (2026-10-09, out-of-band): users add their own sample-pack content into Anvil and use
it throughout — the formats named: ADG, AIF, ALS, EXS, KONG, MXGPR, NBKT, NKI, REX2, SXT, WAV,
MIDI, MP3, SerumPreset. Research wave **R15a DONE 2026-10-09**; findings files:
`research/import/01-ableton-mystery.md` · `research/import/02-ni-rex2.md` ·
`research/import/03-serum-exs-native.md` (full detail + licence tables live there).

## Format verdicts (decided)

- **WAV** — native path today. Core V1. (f64-WAV is NOT decodable by browsers — optional
  clean-room reader later.)
- **MP3** — decodeAudioData ✓. Core V1.
- **AIFF / AIFF-C** — browsers do NOT decode (live-tested Chrome 145) → clean-room PCM reader
  (~200 LOC). Core V1 (priority: Logic-pack users).
- **MIDI** — the SMF parser already ships (`av_mid.js`). Core V1.
- **REX2** — public spec + test vectors (VelociLoops, **Unlicense** — reusable); browser decode
  ≈ 500–900 LOC, no WASM, ms-fast. BEST value/effort of the structured formats → **V1.5** (take
  it as soon as V1 is green).
- **EXS24** — BINARY (TBOS chunks — the earlier "text format" premise was WRONG); layouts fully
  specced; ISC/MIT parsers exist. Maps onto the sampler zone table (low/high/root/buffer/vol/
  start/end; fadeIn/fadeOut = 0 — EXS has no per-zone fades; velocity needs extra columns).
  **V2.**
- **SerumPreset (S2)** — container solved: `XferJson` + uint64 JSON (md5) + zstd→CBOR module
  map (verified on 629 real presets). Wavetables referenced via `relativePathToWT`; the
  PNG-strip claim did NOT verify (0 PNG signatures in 629 presets — the largest embed case is
  SFZ+FLAC refs). **V2 with a 30-min spike first** (embed-in-preset case). Serum 1 `.fxp` —
  defer (embedded wavetable region never publicly located).
- **ADG / ALS** — gzipped XML confirmed first-hand on 6 real files; `DecompressionStream('gzip')`
  works in-browser; extract sample refs + MIDI notes + tempo + device chains. Full ALS project
  import OUT OF SCOPE. **V2 (sample-ref extraction).**
- **NKI** — ≤4.2.1: zlib-XML, fully parseable (nkitool = public domain). 4.2.2+: binary
  container — metadata + sample refs + pictures extractable; zone maps need heavy clean-room;
  encrypted = refuse. **V2 (partial).**
- **NBKT** — same container; extract kit name/version only; pad maps refuse. **V2 (partial,
  mostly refuse).**
- **SXT** — Reason NN-XT patch; IFF-derived chunks; `REFE` carries sample references. Official
  spec behind a registration wall. Clean-room chunk reader feasible. **V2 (recognize + REFE
  extraction).**
- **KONG** — references samples (not samples) in a proprietary container; no OSS reader.
  **HONEST REFUSAL (v1 + likely permanent).**
- **MXGPR** — literal spelling unresolvable; near-certainly `.mxgrp` = NI Maschine 2 Group.
  **V1: skip + label; confirm the actual bytes when a real file appears.**

## Architecture (the canonical bundle)

drop folder/zip → **magic-byte sniffer** → per-format adapters → **canonical bundle**
(samples: PCM → engine slots · zones: sampler v2 table · patterns: seq/SMF · wavetables: OSC2
2048-frame) → **LOCAL IndexedDB library** (the av-packs-store pattern; nothing uploads) →
assignment surfaces: the 4 engine sample slots, drum pads, chop, grain, OSC2, sequencer.

- **Sibling-WAV fallback is the DEFAULT path** — REX2/Kontakt/Battery packs ship same-stem WAVs;
  Kontakt free/Pianobook = `Samples/` WAV; NCW decoders Apache/MIT (further reading in 02).
- Honest refusals (never a silent fail) · clean-room parsers only (LGPL/GPL = read-only; note:
  the NI niche is legally sensitive — monomadic/ni-file sits at HTTP 451).

## Waves

- **R15b** — the SAMPLE PACKS card + sniffer + canonical bundle + IDB library + assignment +
  V1 formats (WAV/MP3/AIFF/MIDI); REX2 joins if the wave has budget (spec ready, Unlicense).
- **R15c** - EXS24 (Logic kits -> sampler kits) + ADG/ALS (sample refs + clip->pattern) + SerumPreset (wavetable refs; native zstd gated) - SHIPPED 2026-10-09 (`b1da601b`); the STRUCTURED PACKS trio.
- **R15d** - SXT REFE refs + NKI partial (legacy zlib-XML zones + modern metadata/refs; encrypted refuse) + NBKT metadata; the R15c pipeline carries them (new adapters register in AV_IMPORT_POLICY). - SHIPPED 2026-10-09 (`50d6d793`); the NI/Reason trio.
- **R16** - the recorded follow-ups: zip reading (a dropped .zip expands its entries through the same import pipeline as a bundle row + honest children) + REX2 slices -> chop kits (the decoded slice table drives the chop card's DETECT via rex2) + f64-WAV reader (tag-3/64-bit: clean-room decode + load route) - SHIPPED 2026-10-09 (`ebc4e907`); `embeddedWTData` decode + MXGPR/KONG stay open.
- Owner-visible acceptance: drop a mixed pack folder → formats recognized honestly → content
  usable in sampler / pads / chop.

## Open items (verify before promising)

MXGPR real bytes · KONG depth (expected refuse) · Serum embeddedWTData decode (needs a Serum-saved
embed fixture — verified 2026-10-09: 0 files in the local corpus carry the field) · NKI modern zone
maps (long-term stretch).
