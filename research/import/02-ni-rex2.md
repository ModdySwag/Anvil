# 02 — Native Instruments (NKI / NBKT) and REX2 — importer research

**For:** Anvil in-app SAMPLE PACKS importer planning.
**Date:** 2026-10-09. **Author:** delegated research agent (file 02 of the `research/import/` series).
**Method:** public format docs, open-source repositories and vendor pages (all cited below); no local
`.nki`/`.nbkt`/`.rx2` files existed on this machine (checked `anvil/`, `Downloads`, `Documents`,
`harvest/` empty), so magic-byte spot checks were not possible — everything below is source/doc-verified,
with confidence noted.

---

## TL;DR verdicts

| Format | Verdict | Realistic surface for Anvil |
|---|---|---|
| **NKI — legacy (saved by Kontakt ≤ 4.2.1)** | **Full best-effort parse feasible** | zlib+XML payload: zones, key/velocity ranges, sample list, scripts — everything in-file |
| **NKI — modern (4.2.2+ / K5–K8, incl. K5 monoliths)** | **Partial extraction** (unencrypted); **honest refusal** for encrypted / Player (NKX) libraries | instrument name/author/vendor/description/tags, authoring app + version, sample file references, pictures; zone/velocity map = stretch goal (high effort, clean-room) |
| **NBKT (Battery 4 kit)** | **Partial extraction** (metadata); pad-map reconstruction = honest refusal | kit name, Battery version, library product ID; sample refs plausible but publicly unproven; samples live in sibling `Samples/` folder |
| **REX2 (.rx2)** | **Full best-effort decode feasible — high value, modest effort** | complete slice list (frames + PPQ + tempo + time-sig), full PCM via DWOP decode (16/24-bit), no proprietary SDK needed |

Sibling-file fallback (below) is realistic and should be the default UX path for all three.

---

## 1. Native Instruments formats

### 1.1 Family map

- Instruments/multis: `.nki` (instrument), `.nkm` (multi), `.nkr` (monolith — samples embedded),
  `.nkx` (packed sample container for Kontakt Player libraries — **encrypted**), `.nkc` (browser cache).
- Battery: `.nbkt`/`.nbcl` (Battery 4 kit/cell), `.kt3`/`.cl3` (Battery 3), `.kt2`/`.cel` (Battery 2)
  ([NI Battery manual — Supported File Types](https://docs.native-instruments.com/ni-tech-manuals/battery-manual/en/supported-file-types)).
- Audio siblings on disk: plain `.wav`/`.aif` or **`.ncw`** (NI's compressed wave; see 1.4).

### 1.2 Structure reality — **two eras**, and yes, there *are* XML portions (in one of them)

**Era A — Kontakt 1 … 4.2.1: zlib-compressed XML.** Community tooling has decoded these files into
plain XML and re-encoded them with zlib for over a decade. The LinuxSampler `nkitool` page states it
"exports and imports the human readable XML file from and to Native Instruments Kontakt .nki instrument
articulation files… Kontakt v1 to v4 format versions are supported"; its source "consists of just one
small C source file… depends on zlib". Critically: *"Starting with Kontakt 4.2.2, Native Instruments
have changed the file format! The new format is not supported… will lead to a 'zpipe error'"*
([linuxsampler.org/nkitool](https://linuxsampler.org/nkitool/)). The same boundary appears in a
vi-control thread by a developer building an NKI script injector: "The NKI file format up to 4.2.2
could be decoded into plain XML and reencoded using zlib"
([vi-control #22525](https://vi-control.net/community/threads/binary-file-format-from-4-2-2-not-able-to-be-decoded.22525/)).
ConvertWithMoss' Kontakt1/Kontakt2 handlers mirror this (XML SAX parsing + `CompressionUtils`).
→ For files **≤ 4.2.1 the whole format is effectively open**: zones, groups, key/velocity maps, sample
references, KSP scripts, envelopes. For an importer this is "read the XML, done".

**Era B — 4.2.2+ / Kontakt 5–8: binary "NI container".** No XML for the mapping data; it is a typed,
nested, chunked binary tree:
- Community-documented file header (Battery `.nbkt`, same structure as `.nki`): 4-byte **little-endian
  container size** @0x00, 4 bytes padding, `hsin` marker @0x0C (hash/identity block), nested **`DSIN`
  chunks begin @0x30** ([fileatlas "Atlas Audio: Battery Kit Extractor"](https://fileatlas.app/docs/extractors/atlas-audio/pack-atlas-audio-battery-kits/)).
- The chunk types are enumerated in ConvertWithMoss' open source (LGPL, read-only for us):
  TERMINATOR(1), BANK(100), **AUTHORING_APPLICATION(101)** (app id + version string + "isCompressed"
  flag), BANK/PRESET_CONTAINER(102/103), BINARY_CHUNK_ITEM(104), AUTHORIZATION(106),
  **SOUNDINFO_ITEM(108)**, PRESET_CHUNK_ITEM(109), **EXTERNAL_FILE_REFERENCE(110)**,
  RESOURCES(111), **AUDIO_SAMPLE_ITEM(112)** (monolith audio), INTERNAL_RESOURCE_REFERENCE(113),
  PICTURE_ITEM(114), **SUB_TREE_ITEM(115, compressed container)**, **ENCRYPTION_ITEM(116)**,
  APP_SPECIFIC(117), CONTAINER_ROOT(118), AUTOMATION_PARAMETERS(120), CONTROLLER_ASSIGNMENTS(121),
  MODULE(122), MODULE_BANK(123) — comment: *"used by Kontakt 5+ and other NI plugins"*
  ([NIContainerChunkType.java](https://github.com/git-moss/ConvertWithMoss/blob/main/src/main/java/de/mossgrabers/convertwithmoss/format/ni/nicontainer/NIContainerChunkType.java)).
- Metadata inside chunk 108 **is XML-shaped but stored as binary records**: ConvertWithMoss'
  `SoundinfoChunkData` reads version, then **UTF-16 strings: name, author, vendor, description**, then
  tags/attributes/properties; its XML counterpart is `<soundinfo version="400">…` — i.e. some NI
  metadata exists in both XML (legacy files) and binary (container chunk) form
  ([SoundinfoChunkData.java](https://github.com/git-moss/ConvertWithMoss/blob/main/src/main/java/de/mossgrabers/convertwithmoss/format/ni/nicontainer/chunkdata/SoundinfoChunkData.java),
  [SoundinfoDocument.java](https://github.com/git-moss/ConvertWithMoss/blob/main/src/main/java/de/mossgrabers/convertwithmoss/format/ni/kontakt/SoundinfoDocument.java)).
- Magic numbers for the older generations and monoliths are tabulated in CWM `Magic.java`: K1/K2
  instrument magics (LE+BE), K2/K4.2 headers, NKR monolith IDs (KONTAKT2_NKR_HEADER_ID 0x5E70AC54,
  NKI 0x4916E63C, SAMPLE 0x16CCF80A, SAMPLE_RAW 0x0040179F), KONTAKT5_MONOLITH 0x2F5C204E, and
  file-container tags `"/\ NI FC MTD  /\"` / `"/\ NI FC TOC  /\""` — so unencrypted monoliths are
  header-identifiable, and K5 monoliths are explicitly detected by CWM.
- **No XML anywhere in the zone/velocity mapping data** in either era's modern form — that is
  proprietary binary inside PRESET/SUB_TREE chunks, decoded only by third-party tools.

### 1.3 What is realistically parseable without NI software

- **Container walk + metadata + sample references + pictures: yes, low effort.** The chunk crawler is
  simple; `soundinfo` gives name/author/vendor/description/tags (UTF-16); `AUTHORING_APPLICATION` gives
  app + version; `EXTERNAL_FILE_REFERENCE` chunks carry sample references, and sample *resolution* is a
  filename search against a user-provided folder — exactly what ConvertWithMoss does ("common sample
  search… NI Kontakt, NI Maschine…" per its 20.2.0 release notes) and what fileatlas extracts for kits.
- **Zone/velocity maps (modern): demonstrated by third parties, not trivial.** ConvertWithMoss (LGPL,
  active — v20.3.0, Sep 2026) contains dedicated readers for Kontakt 1, Kontakt 2, and the K5+ container
  generation (incl. monoliths) and converts zones/groups/velocity modulators/loops/tuning/filters;
  proprietary Awave Studio "reads Kontakt files from v1 up to v8… only unencrypted", extracting
  "16..32-bits, loop, name, lfos, envelopes, layers, instruments, sample start & end offsets, filters,
  key/velocity x-fade" ([fmjsoft.com/fmt/nki.htm](https://www.fmjsoft.com/fmt/nki.htm)); Chicken Systems
  Translator similar. Effort signal: CWM's Kontakt code spans K1 (8k lines of format class), K2 (20k),
  K5 handlers (17k+) plus shared models — i.e. **years of refinement**; for Anvil a clean-room subset
  (key range, velocity range, root key, sample ref, loop points) is a plausible stretch, never a v1 goal.
- **Encrypted content: hard wall.** `ENCRYPTION_ITEM` exists in the container format; Kontakt Player
  libraries ship NKX with encrypted samples ("Chicken Systems Translator can't do more than [4.2.x]
  because of all the encryption that NI added" — forum comment; "Some libraries are Kontakt Player with
  samples hidden inside nkx archives… cannot be extracted easily" — vi-control).

### 1.4 Existing open-source readers + licences

| Project | Licence | What it does | Anvil reuse |
|---|---|---|---|
| [linuxsampler.org/nkitool](https://linuxsampler.org/nkitool/) | **public domain** (stated on page; one C file + zlib) | NKI↔XML export/import, K1–4.2.1 only; script injection | ✅ legacy path reusable |
| [git-moss/ConvertWithMoss](https://github.com/git-moss/ConvertWithMoss) | **LGPL-3.0** | reads K1/K2/K4.2/K5+ NKI + K5 monoliths (unencrypted), writes legacy NKIs; NCW-aware; active 2026 | ⚠️ GPL-family → clean-room only (read for understanding) |
| [monomadic/ni-file](https://github.com/monomadic/ni-file) | **none stated — and now unreachable: HTTP 451** (GitHub's legal-block/takedown status; referenced successor `ni-file-reference` also gone) | "Reverse-engineered kontakt / native instruments file formats" (~105★ indexed) | ⚠️ unavailable; a caution signal about this niche |
| [monomadic/ncw](https://github.com/monomadic/ncw) (Python) + Rust crate [`ncw`](https://crates.io/crates/ncw) | Apache-2.0 / MIT OR Apache-2.0 | NCW audio decode (DPCM + bit truncation, mid/side; "zero-dependency decoder", verified sample-for-sample vs reference WAVs) | ✅ if NCW sibling decode is ever needed |
| [maxton/nkxtract](https://github.com/maxton/nkxtract) | GPL-3.0 | extracts (unencrypted) NKX monoliths | ⚠️ clean-room only |
| Awave Studio (FMJ), Chicken Systems Translator | proprietary | the "full parse" baselines (v1–v8, unencrypted) | ❌ not usable for Anvil (evidence only) |
| "nkitool" (Kontakt 1–4 → SFZ extractor) e.g. [bobicloudvision/nkitool](https://github.com/bobicloudvision/nkitool) | **no licence file** | sample/metadata/SFZ extraction | ⚠️ no licence = all rights reserved → understanding only |

### 1.5 NKI verdict + best-effort extractor surface

**Verdict: partial extraction for modern files; full parse for legacy; honest refusal for encrypted.**
A realistic Anvil extractor could surface, per file:
- always (modern, unencrypted): instrument name / author / vendor / description / tags; authoring app
  + version; container generation; embedded picture; **list of referenced sample filenames/paths**;
  encryption flag → if present, a graceful "locked library" refusal message.
- legacy ≤4.2.1: additionally full zone/groups/key-vel data + scripts via the XML route.
- modern zone maps: only as a later stretch, clean-room, best-effort subset — expect long-tail breakage
  across Kontakt versions; never promise full fidelity. (Scripts, custom UI, group modulation: refused.)
- monoliths: K2-era NKR header IDs and K5 monolith magic are known; extracting embedded audio is
  plausible but extra work — treat as out of scope v1; NKX = refuse.

### 1.6 NBKT (Battery 4 kit) specifics

- Same modern NI container (`hsin`/`DSIN`) as NKI; fileatlas' extractor (public docs) pulls: **kit name**
  (UTF-16LE in the SOUNDINFO chunk), **Battery version** ("4.1.6.27" style), **authoring product ID**
  (AUTHORING_APP chunk; 82+ byte commercial vs 52-byte user kits; resolvable to library names via
  `komplete.db3`). Those docs only claim "library identifiers and kit names" — **no open-source reader
  maps pads/cells**, and sample-reference extraction per cell is structurally plausible (same container)
  but publicly unproven — mark it a probe. Kits reference samples in a sibling **`Samples/` folder on
  disk** (KVR: right-click kit → "Find in explorer" → parent folder contains `Samples`); Battery 4.1.5+
  can batch-resave legacy `.kt3` kits to `.nbkt` (NI support article). Nugget: Battery cells also accept
  `.rex`/`.rx2` as sample sources (NI supported-types page) — a Battery kit's sample folder may itself
  contain REX2 files.
- **Verdict: partial extraction** — kit name/version/product ID + honest UI that pad mapping can't be
  reconstructed; let the user re-map from the sibling samples.

### 1.7 Vendors shipping NKI/NBKT + typical sibling files

- **NKI:** NI itself (Komplete Kontakt libraries) and virtually every third-party Kontakt developer
  (Spitfire Audio, Orchestral Tools, Heavyocity, Output, Cinesamples, 8dio, ProjectSAM, Impact
  Soundworks, Soniccouture…); free sources: **Pianobook** (community libraries ship raw **WAV** samples
  plus Kontakt + DecentSampler/SFZ versions — the strongest sibling-WAV case), plus free Kontakt libs.
- **Alongside samples:** a `Samples/` folder of **WAV** (older/free libraries) or **NCW** (most modern
  commercial libs use Kontakt's compressed wave — "usually in Kontakt's lossless compressed format",
  Loot Audio install guide), or nothing at all: monolith `.nkr` (samples embedded) or encrypted `.nkx`
  (Kontakt Player libraries). So sibling-WAV fallback works for free/older libraries and NCW decode
  (Apache-2.0/MIT refs) extends it to many commercial ones.
- **NBKT:** NI Komplete "Battery" library + **NI Expansions** (which ship Battery kits alongside Maschine
  kits and WAV samples — e.g. "51 BATTERY Kits"; all Expansions work across NI instruments); third-party
  kit vendors: ADSR Sounds, Yurt Rock ("Complete BATTERY Kit Bundle"), Groove Monkee (free kits). Files
  ship as kit + sibling `Samples/` folder of WAVs.

---

## 2. REX2 (.rx2) — ReCycle loops

### 2.1 Layout — fully documented publicly (container, slices, tempo)

Best source: [VelociLoops `docs/format.md`](https://github.com/kunitoki/VelociLoops/blob/main/docs/format.md)
(200+ line spec, based on its production parser/decoder; cross-checked against the official REX SDK
fixtures). Summary:
- **IFF/CIFF-style container**: root `CAT ` container typed `REX2`; chunk IDs are 4 ASCII bytes, sizes
  **big-endian**, chunks padded to even offsets. Tree: `HEAD` (magic `0x490cf18d`, version bytes
  `bc 01/02/03`), optional `CREI` (creator strings), `GLOB` (22 B: slice count, bars/beats, time-sig,
  sensitivity, gate sens, processing gain, pitch, **preview tempo as BPM×1000**), `RECY` (ReCycle
  version + **original tempo** BPM×1000), `CAT DEVL` (`TRSH` transient shaper, `EQ`, `COMP`), `CAT SLCL`
  with one **`SLCE` per slice (11 B: uint32 start frame, uint32 length in PCM frames, uint16 analyze
  points, 1 B flags [muted/locked/selected])**, `SINF` (18 B: channels 1–2, format code 3=16-bit /
  5=24-bit [1=8-bit, 7=32f recognized only], **sample rate, total frames, loop start/end**), `SDAT`
  (**one DWOP-compressed waveform for the whole file**).
- **Slices are frame ranges into that single decoded waveform** — not per-slice audio. Slice→PPQ:
  15360 ticks per 4/4 bar (3840/quarter); marker-like SLCE entries are filtered by a
  sensitivity/gate pass (same as official SDK). Transient-stretch tails (TRSH) are *synthesized* at
  render time (crossfaded loop-around + decay), not stored.
- **DWOP codec** (the only hard part): proprietary adaptive predictive entropy codec. Decoder = MSB-first
  bitreader over big-endian 32-bit words; per coded channel: 5 predictor deltas + 5 running averages
  select 1 of 5 integration-order predictors, adaptive Rice/Golomb-style prefix+remainder (state `j`,
  `rbits`); stereo = left + (right−left) side channel sharing the bitreader; outputs integer PCM at
  SINF depth (samples stored "2x" and halved). Decoded in blocks up to 0x100000 frames; effectively
  sample-exact integer PCM. The spec even ships test vectors (`120Mono.rx2` first DWOP words, decoded
  frame 322 anchor).
- Legacy `.rcy`/`.rex` (ReCycle 1, AIFF-backed) are opened by the same library as PCM loop containers.

### 2.2 Existing open-source readers + licences

| Project | Licence | Decodes audio? | Notes |
|---|---|---|---|
| [kunitoki/VelociLoops](https://github.com/kunitoki/VelociLoops) | **Unlicense (public domain)** ✅ | **Yes — full DWOP decode + encode**, 16/24-bit, slice API, legacy .rex/.rcy read; validated against official SDK fixtures | C library, clean-room; the single most valuable asset for Anvil. Reuse allowed under Anvil's licence law. |
| [Simon-L/revx2](https://github.com/Simon-L/revx2) | **none stated** | No — header metadata only (tempo, slices), Lua, "kinda WIP" | reference for slice/tempo parsing; understanding only |
| [noorus/rexlib](https://github.com/noorus/rexlib) | none stated | via **proprietary REX Shared Library** (wrapper, not standalone) | confirms old-school approach = SDK dependency |
| [dimashenme/rx2slices](https://github.com/dimashenme/rx2slices) | none stated | **built against the proprietary REX SDK** ("Download REX SDK…", needs `REX Shared Library.dll`) | also shows the slice→DAW mapping UX ideas (warp markers, Octatrack `.ot`) |
| Official: REX SDK / REX Shared Library ([developer.reasonstudios.com](https://developer.reasonstudios.com/downloads/other-products)) | proprietary | yes, official | not usable in a browser/local-first web app; requires native lib. (Propellerhead opened REX2 playback to third parties by license in Jan 2004 — press release.) ReCycle itself is now **free** — users can generate their own .rx2. |

No standalone "librex"-style library besides VelociLoops was found; the ecosystem is
VelociLoops (clean-room) + header-only tools + proprietary-SDK wrappers.

### 2.3 Browser decode effort to raw PCM

Very realistic: **decode the one DWOP stream once to Float32/int PCM, then slice = array ranges.**
Scoped port: IFF walker ≈ 100–150 LOC JS; DWOP decoder (bitreader + 5 predictors + adaptive prefix +
stereo side-channel) ≈ 250–400 LOC; slice/metadata/PPQ mapping ≈ 100 LOC → **~500–900 LOC of JS, no
WASM needed**; loops decode in milliseconds; the Unlicense C source + the spec's test vectors make this
a well-bounded task with objective acceptance tests. Caveats: 8-bit/32-float files are "recognized"
but not decoded by any OSS implementation (message honestly; REX2 in the wild is 16-bit dominant);
24-bit supported in VelociLoops. **Verdict: full best-effort parse + decode; effort = small module.**

### 2.4 Vendors shipping REX2 + typical siblings

- **Actively sold today:** Loopmasters keeps a full **Rex2 category** (Big Fish Audio, UNDRGRND Sounds,
  Producer Loops, Singomakers, Loopmasters itself — [loopmasters.com/formats/7-Rex2](https://www.loopmasters.com/formats/7-Rex2));
  **Producer Loops** ships REX2 alongside "WAV, Ableton Live, Apple Loops, MIDI, Reason" per product
  (e.g. Producer Loops "Phases"); **Zero-G** (Pure Rex, Total Rex ~15,000 loops; "Acid, WAV, REX, Apple
  Loops" formats); legacy sample-CD era collections.
- **Alongside files — sibling-WAV fallback is the norm:** these products are multi-format — the *same
  loops* ship as ACIDized WAV / AIFF / Apple Loops in sibling folders, and REX2 downloads are often a
  *subset* ("selected loops") of the WAV set. Match by identical stem (`LoopName.rx2` ↔ `LoopName.wav`)
  → if the WAV sibling exists, it is the exact source audio (bit-perfect original vs our DWOP decode —
  also a free verification path for our decoder!). ReCycle being free means user-made .rx2 usually sit
  next to their source WAVs too.
- Cross-format: Battery kits can reference .rx2 cells (see 1.6), and DAWs (Reaper/Cubase/etc.) ingest
  REX2 via the REX Shared Library — so REX2 files often live inside packs that also contain WAVs.

---

## 3. Implications for the Anvil importer (short)

1. **Sibling-WAV fallback design (all three formats).** On import, resolve by: (a) same-stem `.wav` next
   to the file; (b) the library's sibling `Samples/` folder (NKI/NBKT); (c) case-insensitive name search
   across the dropped folder tree. Offer "use original WAV" always where present.
2. **Effort order (value/risk):** REX2 full decode (small, Unlicense reference, test vectors) →
   NKI modern partial extractor (metadata + sample refs, refusal path for encrypted) → legacy NKI XML
   reader (public-domain tool + zlib; small, but rare files) → NBKT metadata extractor (small) →
   modern-NKI zone maps = explicit non-goal / long-term stretch.
3. **Licence hygiene (Anvil law):** VelociLoops (Unlicense) and nkitool (public domain) are inside the
   reuse set; ConvertWithMoss (LGPL), nkxtract (GPL), revx2/rexlib/rx2slices (no licence) are
   read-for-understanding only; the ni-file HTTP-451 case is a reminder this niche is legally sensitive —
   keep implementations clean-room, ship no NI-derived code, and never bundle the proprietary REX SDK.
4. **UX honesty:** encrypted/monolithic NI libraries and DFD/streaming-only content get a plain-language
   "can't extract" card that still lists the referenced sample filenames so users can locate siblings.

---

## Sources (all fetched 2026-10-09)

- VelociLoops format spec + repo/licence: https://github.com/kunitoki/VelociLoops (docs/format.md, LICENSE, README)
- linuxsampler nkitool: https://linuxsampler.org/nkitool/
- vi-control "Binary File Format From 4.2.2…": https://vi-control.net/community/threads/binary-file-format-from-4-2-2-not-able-to-be-decoded.22525/
- ConvertWithMoss (LGPL-3.0): repo, NIContainerChunkType.java, chunkdata/SoundinfoChunkData.java, AuthoringApplicationChunkData.java, kontakt/SoundinfoDocument.java, Magic.java, KontaktDetector.java, type/kontakt1|2|5/*Format.java, releases.atom, mossgrabers.de software page + manual
- fileatlas Battery Kit Extractor docs: https://fileatlas.app/docs/extractors/atlas-audio/pack-atlas-audio-battery-kits/
- Awave Studio NKI format notes: https://www.fmjsoft.com/fmt/nki.htm
- Sample Miner .nki explainer: https://sampleminer.com/formats/nki/
- NI Battery manual — supported file types; NI/KVR/forums re: Samples folder, Expansions battery kits
- monomadic/ncw (Apache-2.0) + rust crate `ncw` (MIT OR Apache-2.0); monomadic/ni-file (HTTP 451)
- Simon-L/revx2; noorus/rexlib; dimashenme/rx2slices; maxton/nkxtract (GPL-3.0)
- Loopmasters Rex2 category; Producer Loops format pages; Zero-G Rex collections; Reason Studios REX2 press release (2004) + free ReCycle page
- Pianobook packaging pages; Loot Audio Kontakt install guide (NCW); KVR thread (Battery sample location)
