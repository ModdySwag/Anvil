# 01 — Sample-pack importer: the "mystery" formats (MXGPR, SXT), KONG, and ADG/ALS

Research notes for the Anvil **SAMPLE PACKS** importer · 2026-10-09 · desk study + first-hand file checks.
Scope: what each format actually is, whether it can be read without the vendor's software, and what a
browser-side importer could realistically extract. Everything cited has provenance + licence noted in
§5. This file is standalone (sibling notes may follow as `02-…`).

## TL;DR

- **SXT = Propellerhead / Reason Studios NN-XT sampler patch.** Unencrypted, chunked, IFF-family
  container. An official "NN-XT Patch Format" spec existed behind a registration wall (not
  redistributable); public evidence is enough for a **clean-room chunk reader**, and at least one
  open-source converter (LGPL-3.0 → read-only for us) already reads it. Feasible; sample-reference
  extraction first, full fidelity later.
- **MXGPR — nothing by that spelling exists in any public index.** The only survivor is a
  **transposition of `.mxgrp` = Native Instruments Maschine 2 Group file** — exactly the "Maschine kit"
  file that commercial sample packs ship alongside WAVs. Proprietary binary with semi-readable strings;
  one OSS extractor exists (GPL-3.0, heuristic). v1: ignore + label; optional string-scan later.
- **KONG = Reason Kong kit patch (`.kong`).** Official docs: all 16 pad-channel settings **plus file
  references to samples — but not the samples themselves**. No public spec, **no open-source reader
  found**. Verdict for v1: **honest refusal** (recognise + skip; samples come from the pack's WAVs).
- **ADG/ALS = gzipped XML, confirmed first-hand** (6 real files across Live 9.7/10.1/12.1/12.2/12.3 all
  decompress with plain gzip). Sample file references, clip/note data, and device chains are all
  extractable **in-browser without Ableton** (`DecompressionStream('gzip')`). Green light.

---

## 1. The "mystery" pair: MXGPR and SXT

### 1.1 SXT — confirmed: Propellerhead Reason NN-XT patch

**Identity.** `.sxt` is the patch format of the **NN-XT Advanced Sampler** in Propellerhead (now Reason
Studios) Reason. FileInfo: "Propellerhead Reason NN-XT Patch File … saves a 'patch'" ([fileinfo.com](https://fileinfo.com/extension/sxt));
Wikidata record: "Propellerhead Reason NN-XT Patch File", extensions `.sxt`/`.sx2` ([Q27959881](https://www.wikidata.org/wiki/Q27959881)).
FMJ-Software's Awave Studio format list: ".SXT – Propellerheads Reason NN-XT format … NN-XT file
formats **v2, v3 and v4** are supported … 16-bits, mono/stereo, instrument, layers, loop, name,
articulation, sample start & end offsets, multiple filter types" ([fmjsoft.com](https://fmjsoft.com/fmt/sxt.htm)).
ChickenSys (commercial converter vendor): "The NN-XT uses the **.sxt** extension for its files, and
fortunately it's **unencrypted** … However, NN-XT .sxt's can access and play samples within Refills,
but of course is unable to extract them" ([chickensys.com](http://www.chickensys.com/support/software/translator/reason/index.html)).
In-the-wild example: free/commercial Reason content routinely ships "NN-XT patches" (e.g.
[modernbeats](https://www.modernbeats.com/free_reason_refills.php) "for NN-XT, Dr. Rex, Kong, & Redrum").

**Structure reality.** The format is a **chunked container, an extension of the generic IFF format with
quirks** — stated by the author of `pldb-parser` after reading the official NN-XT spec: "It seems to be
an extension of the generic IFF container format with a few quirks. The version tag … has a specific
5-byte sequence … `0xBC major minor rev 0x00`" ([pldb-parser README](https://github.com/ebai101/pldb-parser)).
Public chunk detail (from a developer who had the official spec): there is a **`REFE` chunk for every
sample referenced by the patch**, carrying: relative path, database path, absolute path, sample name,
ReFill name, ReFill URL, reserved/checkpoint, Package name ([StackOverflow 9218208](https://stackoverflow.com/questions/9218208/propellerheads-nn-xt-fileformat-problems-with-refe-chunk)).
The spec itself was downloaded "after a simple registration" from Propellerhead's site and the poster
believed it **not redistributable** — so we must treat the spec as closed; public facts + our own hex
study of user-owned files are the legitimate basis.

**Who can already read it (feasibility proof).**
- Awave Studio (commercial, reads + writes, v2–v4) — fmjsoft.com, above.
- ChickenSys Translator (commercial, reads, Level 3 status) — chickensys.com, above.
- **ConvertWithMoss** (open source by Jürgen Moßgraber) lists "**Propellerhead Reason NN-XT (\*.sxt)**"
  among supported multisample formats ([mossgrabers.de](https://mossgrabers.de/Software/ConvertWithMoss/ConvertWithMoss.html);
  manual §3.15; CHANGELOG mentions fixing NN-XT sample indices). **Licence: LGPL-3.0** (LICENSE file
  checked) → GPL-family → **read-only reference for Anvil**, no code reuse.

**Importer verdict (realistic path).**
1. v1/v1.5: **skip parsing** (recognise `.sxt`, show "Reason NN-XT patch — samples are the pack's WAVs").
2. v2 (feasible, moderate work): clean-room chunk walker → collect `REFE` entries → sample names/paths
   → match against the pack's audio files. Notes: patches reference samples; when a patch points inside
   a ReFill, audio is not extractable at all (ChickenSys, above) — fine for packs, where WAVs ship loose.
   Whether v2–v4 patches can also *embed* sample audio is **not verified** (Awave's "sample start & end
   offsets" hints at embedded-capable files, but no source states it plainly) → verify against real files.
3. Do **not** obtain/use the registration-gated spec unless we can verify we're allowed to; build from
   public descriptions + byte-level study of the user's own files.

### 1.2 MXGPR — unresolved as spelled; near-certainly `.mxgrp` (NI Maschine 2 group)

**As spelled "MXGPR" does not exist anywhere I can find.** Evidence of absence (all checked 2026-10-09):
- Extension databases: [fileinfo.com/extension/mxgpr](https://fileinfo.com/extension/mxgpr) **404**,
  file-extensions.org **404**, file-extension.info **404**; file.org and reviversoft.com return only
  auto-generated "we don't know this extension" pages; datatypes.net is a bot-walled stub.
- **GitHub issues search "mxgpr": 0 results**; code/repo search returns unrelated hits (xGPR, MIXPRS…).
- Web engines: no relevant result for `"mxgpr"` in any language; the literal string only appears as
  GillPro industrial-grille product codes, an MXGP motocross game tie-in, and parked spam domains —
  i.e. noise. (MAGIX-family also rejected: MAGIX Music Maker projects are `.mmm`
  ([fileinfo](https://fileinfo.com/extension/mmm)); no link to "mxgpr".)

**The surviving hypothesis: `.mxgrp`.** "MXGPR" is an exact letter transposition of **MXGRP**, which is:
- **Native Instruments Maschine 2 Group file.** NI's own manual: "In your operating system, **Group
  files have the extension ".mxgrp"**." (MASCHINE 1.x used `.mgrp`) — [NI Maschine manual, Managing
  Sounds, Groups & your Project](https://docs.native-instruments.com/ni-tech-manuals/maschine-software-manual/en/managing-sounds,-groups,-and-your-project);
  also the Mikro MK3 manual p.198 ([manualshelf](https://www.manualshelf.com/manual/native-instruments/25707/user-s-manual-english/page-198.html)).
  Independent DBs agree: "A .MXGRP file is a Native Instruments Maschine Group file"
  ([file.org](https://file.org/extension/mxgrp)); "Native Instruments Maschine 2 Group File"
  ([filetypeadvisor](https://www.filetypeadvisor.com/extension/mxgrp)); "NI MASCHINE 2.x … replaced the
  previously used MGRP format" ([file-extensions.org](https://www.file-extensions.org/extension/mxgrp)).
- **Exactly what sample packs ship.** Maschine-oriented packs are sold as "Maschine kits" and pack
  vendors' own instructions describe installing them into Maschine 2+ (e.g. [Samples From Mars
  install guide](https://samplesfrommars.com/pages/installation-instructions): "How to Install Maschine
  Kits (these kits require Maschine V2 software and above)"; [Loopmasters "Maschine PRO"
  series](https://www.loopmasters.com/genres/87-Sound-Archives/products/3595-Maschine-Pro-EDM):
  "35 Maschine kits"). A pack that ships Reason NN-XT patches (`.sxt`) plus Maschine groups (`.mxgrp`)
  is a standard multi-format pack pattern — consistent with the brief.

**Structure reality for `.mxgrp`.** Proprietary NI binary; not XML, but **strings are semi-readable**
(SO: "The format is called .mxgrp. When I open the file with a text editor, it looks like …"
[StackOverflow 30684791](https://stackoverflow.com/questions/30684791/garbled-text-within-xml-file)). The one
open-source parser, **joanroig/nitools** ("Extract and convert Native Instruments content", → SP-404
workflows), parses it **heuristically**: find the marker `serialization::archive` (Boost.Serialization
signature), then harvest lines containing sample paths starting with `Samples/`, `//Samples/`, `*Samples/`;
group consecutive samples as multisamples; ignore everything non-sample (sound generators, VST refs)
([nitools docs/DECISIONS.md](https://github.com/joanroig/nitools/blob/main/docs/DECISIONS.md)). **Licence: GPL-3.0**
(badge + LICENSE verified) → read-only reference for Anvil. NV's own docs note sample paths inside groups
often need bulk re-linking after moving ([NI community thread](https://community.native-instruments.com/discussion/14489/how-to-change-the-path-to-samples-in-a-group-in-bulk-rather-than-per-sample)).

**Importer verdict.**
1. v1: **skip + label**. Packs that ship `.mxgrp` always ship the underlying WAVs; importing the audio
   directory is the 80 % win.
2. Optional later: a **feature-flagged heuristic scan** (look for `serialization::archive` + `Samples/`
   path strings) to map group → sample names. Brittle by nature (it is a binary parser in disguise);
   treat as best-effort, never as a promise.
3. **Action item:** confirm the actual extension/bytes of the pack file. If it's literally `.mxgpr`
   (P before R) it remains unidentified — ask for the file or its first 64 bytes (hex).

---

## 2. KONG — Reason Kong kit patch (`.kong`)

**What it is (vendor docs).** Kong is Reason's 16-pad drum machine/sampler. Kit patches: "A Kong Kit
Patch (Windows extension **".kong"**) contains all settings for all 16 Drum sound channels, **including
file references to any used drum samples (but not the actual samples themselves)**. Switching patches
is the same as selecting a new drum kit." Per-pad "Drum Patches" use extension **".drum"**. Kong's
sampler module reads wav/aif/mp3/etc. plus SF2; its loop module reads REX (`.rx2/.rex/.rcy`)
([Reason docs, About file formats](https://docs.reasonstudios.com/reason13/kong-drum-designer); same
text archived at [docs.propellerheads.se/reason10/Kong.28.03.html](http://docs.propellerheads.se/reason10/Kong.28.03.html)).

**Structure reality.** The `.kong` container is the same **proprietary, IFF-derived Reason file family**
as the rest of Reason's device patches — the `pldb-parser` author, working from the (public) NN-XT spec,
found this "proprietary IFF" format "is used for other things, like a few different types of patches"
([pldb-parser](https://github.com/ebai101/pldb-parser)). No **public Kong spec** was found, and no
sketch of Kong chunk tables, in any source (NI/Reason docs, SO, GitHub, forums).

**Open-reader reality: none found.**
- Searches for `.kong` parsers/readers return nothing (GitHub issue/repo hits are noise).
- ConvertWithMoss (the broadest OSS multisample tool; reads `.sxt`, Maschine sounds, etc.) **does not
  list Kong** ([mossgrabers.de](https://mossgrabers.de/Software/ConvertWithMoss/ConvertWithMoss.html),
  [repo](https://github.com/git-moss/ConvertWithMoss)).
- The only Kong-specific third-party tool found is **commercial and write-only**: "Kit Maker — Convert
  your sample packs into Reason Kong drum kits" ([kit-maker.com](https://www.kit-maker.com/reason-drum-kits-kong/))
  — it authoring kits proves the format is crackable, but it isn't a reader we can learn from (closed source).

**Verdict: honest refusal for v1.** Recognise `.kong`/`.drum`, skip, and surface a clear note ("Reason
Kong kit — the pack's WAV loops/one-shots import; kit mapping is not readable"). Rationale: no spec, no
reader, and the file's value is parameter/pad mapping, not audio. A stretch goal (only worth it after
we build the §1.1 IFF-family chunk walker) is a best-effort **string scan for `*.wav` sample names**;
until the container is understood, don't promise readable kits. Same applies to `.drum`.

---

## 3. ADG + ALS — Ableton device group / Live set (the solid one)

### 3.1 Structure: confirmed gzipped XML

- **PRONOM (UK National Archives format registry):** "Ableton Live Set … As of release 8.2.1, .als files
  appear to consist of a **Gzipped XML file**, but with the .als extension"; related formats: contained
  by GZIP, has priority over XML 1.0 ([fmt/1463](https://www.nationalarchives.gov.uk/PRONOM/fmt/1463)).
- **Ableton's own file-type list** (identity of `.adg`/`.adv`/`.als`): ".adg = Ableton device group
  (contains Rack presets) · .adv = Ableton device preset · .als = Ableton Live Set or template set"
  ([help.ableton.com](https://help.ableton.com/hc/en-us/articles/209769625-Live-specific-file-types)).
- **First-hand verification (this study):** 6 real files were downloaded from public repos and decompressed
  — all start `1f 8b` (gzip) and inflate cleanly to XML. See Appendix A. Roots:
  `.als` → `<?xml…?><Ableton …><LiveSet>`; `.adg` → `<Ableton …><**GroupDevicePreset**>`;
  `.adv` → `<Ableton …><OriginalSimpler>` (device element itself). `Ableton` attributes carry
  `MajorVersion/MinorVersion/SchemaChangeCount/Creator (e.g. "Ableton Live 12.1.5")/Revision`.
- Corroboration: community notes ([Qpai](https://github.com/Qpai/ableton-als-file-format): "Many Ableton
  `.als` files are gzip-compressed XML"; [ableton-under-the-hood, MIT](https://github.com/Sample-Offline/ableton-under-the-hood):
  "convert an `.als` file to `.xml` using gzip, then convert it back"), and multiple OSS parsers (below).

### 3.2 What is extractable WITHOUT Ableton

All of this is plain XML — a browser page can read it with **no Ableton, no plugin, no server**:

| Extraction target | Where in the XML | Notes (verified) |
|---|---|---|
| **Sample file references** | `<FileRef>` under `<SampleRef>` (audio clips, Simpler/Sampler, drum pads) | Live ≤10 style: `<HasRelativePath>`, `<RelativePathType>`, `<RelativePath><RelativePathElement Dir="…">` chains; Live 11/12 style: `<RelativePath Value="…">` + `<Path Value="/abs/…">` + `<Type>`, `<LivePackName>`, `<LivePackId>`, `<OriginalFileSize>`, `<OriginalCrc>`. Both styles seen in fixtures. |
| **Notes / clips** | `<MidiClip>` → `<Notes><KeyTracks><KeyTrack><Notes><MidiNoteEvent Time Duration Velocity OffVelocity IsEnabled/></Notes><MidiKey Value="…"/>` | 1,759 note events across 39 clips in the Live 9 fixture; clips also carry timing/loop fields. `<AudioClip>` similarly available. |
| **Tempo, time signature, locators** | `<Tempo>`, `<TimeSignature>`, `<Locators>` in `<LiveSet>` | Present in both ALS fixtures. |
| **Tracks / device chains / automation** | `<AudioTrack|MidiTrack|ReturnTrack>` → `<DeviceChain>` with devices (`<DrumGroupDevice>`, `<OriginalSimpler>`, …), `<AutomationTarget>`/envelope XML | Self-describing XML tree; 129 device chains in the Live 9 fixture. |
| **Preset payload refs** | some `<FileRef>`s embed base64 `<Data>` (e.g. `LastPresetRef`) | ignore for sample import (preset payloads, not audio). |

**Best-effort importer design (samples focus).**
1. Sniff `1f 8b` → `DecompressionStream('gzip')` (native in current Chromium/Firefox/Safari; MIT-licensed
   `fflate` as fallback if an older browser must be supported). `.als`/`.adg` are big (one fixture:
   628 KB gzip → **10.1 MB** XML; packs' sets can be 100 MB+) → **stream/incremental scan**, don't
   DOM-parse the whole document: regex/scan for `<RelativePath Value="…"` and `<Path Value="…"` plus
   `<Name Value="…">` inside FileRef blocks, filter by audio extensions (`.wav/.aif/.aiff/.mp3/…`),
   normalise `../` segments, dedupe by basename.
2. Match to the pack: prefer basename matching over full relative path (paths in shipped presets are
   usually relative to the vendor's folder tree, e.g. `../../Drums/Kick/…`).
3. `.adg` = drum racks / instrument racks: sample refs appear where devices use samples (Drum Rack pads
   = nested Simpler/Sampler; verified: 32 sample refs + 194 FileRefs in one Kick rack). Filter out
   library/preset refs (e.g. `Devices/Instruments/Drum Rack` — not audio).
4. Bonus (cheap): pull `<MidiNoteEvent>`s to offer "import clip → pattern", and tempo for BPM alignment.
5. Robustness: treat parse failures as warnings on that file, never fatal; label files by `Creator`
   version (Live 9/10/11/12 variants are all close enough for FileRef extraction).

**Out of scope (do not promise).**
- Plugin (VST/AU/VST3) states — opaque base64 `<Buffer>` blobs; Max for Live device internals.
- Live Packs/Sound content, ReFills; `.asd` analysis files; warped-audio internals.
- Any audio rendering/interpretation — we import references + metadata, not Ableton's sound.
- Full device-parameter *semantics* (we can carry the XML as opaque metadata; mapping Warp/Simpler
  params to Anvil engines is a separate research task).

**Licence/provenance for tools in this family (for the clean-room gate):** see §5 table — permissive
references: dawtool (BSD-3), als-parser (ISC), SoundHub (MIT), ableton-inspector (MIT), AbleSharp (MIT),
Ableton-Device-Creator (MIT), ableton-under-the-hood (MIT); GPL-family → read-only: ConvertWithMoss
(LGPL-3), R9295/ableton-parser (GPL-3), nitools (GPL-3); **unlicensed repos → read-only, no reuse**
(jake-g, GinoLucianoRojo, maranedah, my5t3ry, ununu-p2p repo itself has no LICENSE file — the npm
package is ISC, the GitHub repo carries none).

---

## 4. Recommendations (importer v1)

1. **ALS + ADG: implement** — gzip → incremental FileRef extraction → basename match. Highest value,
   lowest risk, no legal issues with permissive references; write it clean-room.
2. **SXT: recognise, don't parse yet** — plan a phase-2 clean-room chunk walker (REFE refs first).
   Do not use the registration-gated spec; do not copy LGPL/nitools code.
3. **KONG: recognise + skip (honest refusal)** — revisit only after the IFF-family reader exists.
4. **MXGRP: recognise + skip**; optional heuristic string scan later; confirm the brief's spelling
   (`.mxgpr` vs `.mxgrp`) against the actual pack.
5. Cross-cutting: show *why* a file was skipped (unsupported patch format vs unreadable container) —
   sample-pack users judge importers by how honestly they explain misses.

## 5. Sources & licences (provenance)

| # | Source | Used for | Licence / status |
|---|---|---|---|
| 1 | [fileinfo.com/extension/sxt](https://fileinfo.com/extension/sxt) | SXT identity | Proprietary site — cite only |
| 2 | [fmjsoft.com/fmt/sxt.htm](https://fmjsoft.com/fmt/sxt.htm) (FMJ-Software, Awave Studio) | SXT v2–v4 features | Vendor site — cite only |
| 3 | [chickensys.com Translator reason page](http://www.chickensys.com/support/software/translator/reason/index.html) | SXT unencrypted; ReFill caveat | Vendor site — cite only |
| 4 | [StackOverflow 9218208](https://stackoverflow.com/questions/9218208/propellerheads-nn-xt-fileformat-problems-with-refe-chunk) | NN-XT spec existence; REFE fields; IFF-family | User content, CC BY-SA — attribute |
| 5 | [github.com/ebai101/pldb-parser](https://github.com/ebai101/pldb-parser) | Reason proprietary IFF family; version tag scheme | No LICENSE file found → read-only |
| 6 | [docs.reasonstudios.com](https://docs.reasonstudios.com/reason13/kong-drum-designer) + [docs.propellerheads.se/reason10/Kong.28.03.html](http://docs.propellerheads.se/reason10/Kong.28.03.html) | Kong `.kong`/`.drum` official description | © Reason Studios docs — cite only |
| 7 | [kit-maker.com/reason-drum-kits-kong](https://www.kit-maker.com/reason-drum-kits-kong/) | Kong writer (commercial) exists | Vendor site — cite only |
| 8 | [mossgrabers.de ConvertWithMoss](https://mossgrabers.de/Software/ConvertWithMoss/ConvertWithMoss.html) + [github.com/git-moss/ConvertWithMoss](https://github.com/git-moss/ConvertWithMoss) | OSS converter; reads NN-XT, Maschine sounds; not Kong | **LGPL-3.0** → read-only for us |
| 9 | [docs.native-instruments.com Maschine — Managing …](https://docs.native-instruments.com/ni-tech-manuals/maschine-software-manual/en/managing-sounds,-groups,-and-your-project) | "Group files have the extension .mxgrp" | © NI docs — cite only |
| 10 | [file.org](https://file.org/extension/mxgrp) / [filetypeadvisor](https://www.filetypeadvisor.com/extension/mxgrp) / [file-extensions.org](https://www.file-extensions.org/extension/mxgrp) | `.mxgrp` = NI Maschine group | Database sites — cite only |
| 11 | [github.com/joanroig/nitools](https://github.com/joanroig/nitools) (+ docs/DECISIONS.md, docs/GUIDE.md) | mxgrp parsing reality (heuristic string scan) | **GPL-3.0** → read-only for us |
| 12 | [samplesfrommars.com install guide](https://samplesfrommars.com/pages/installation-instructions), [Loopmasters Maschine PRO](https://www.loopmasters.com/genres/87-Sound-Archives/products/3595-Maschine-Pro-EDM) | Maschine kits ship in commercial packs | Vendor sites — cite only |
| 13 | [help.ableton.com — Live specific file types](https://help.ableton.com/hc/en-us/articles/209769625-Live-specific-file-types) | .adg/.adv/.als identities | © Ableton — cite only |
| 14 | [PRONOM fmt/1463](https://www.nationalarchives.gov.uk/PRONOM/fmt/1463) | ALS = gzipped XML (8.2.1+) | The National Archives — cite only |
| 15 | [Qpai/ableton-als-file-format](https://github.com/Qpai/ableton-als-file-format) | gzip→XML workflow notes | No LICENSE file → read-only |
| 16 | [Sample-Offline/ableton-under-the-hood](https://github.com/Sample-Offline/ableton-under-the-hood) | gzip round-trip | MIT |
| 17 | [offlinemark/dawtool](https://github.com/offlinemark/dawtool) | ALS parser (v8–12); fixtures | BSD-3-Clause **except** `flstudio_core.py` (GPL-3) |
| 18 | [ununu-p2p/als-parser](https://github.com/ununu-p2p/als-parser) | ALS parser (Node) | npm package **ISC**; GitHub repo no LICENSE |
| 19 | [soundXlab/SoundHub als_parser.py](https://github.com/soundXlab/SoundHub/blob/574d0324/backend/app/services/daw/als_parser.py) | ".als files are gzip-compressed XML"; defensive extraction | MIT |
| 20 | [owenbush/ableton-inspector](https://github.com/owenbush/ableton-inspector) MIT · [theokyr/AbleSharp](https://github.com/theokyr/AbleSharp) MIT · [ben-juodvalkis/Ableton-Device-Creator](https://github.com/ben-juodvalkis/Ableton-Device-Creator) MIT (adg fixtures) | ALS/ADG tooling + fixtures | MIT (each verified via API/LICENSE) |
| 21 | [R9295/ableton-parser](https://github.com/R9295/ableton-parser) | ALS parsing prior art | **GPL-3.0** → read-only |
| 22 | jake-g/ableton-parser · GinoLucianoRojo/ableton · maranedah/pyableton · my5t3ry/als-parser | prior art | **No license** → do not reuse code |
| 23 | [fflate](https://registry.npmjs.org/fflate) (if JS inflate fallback needed) | gzip fallback for old browsers | MIT |
| 24 | [StackOverflow 30684791](https://stackoverflow.com/questions/30684791/garbled-text-within-xml-file) | mxgrp = semi-readable binary | CC BY-SA — attribute |

## Appendix A — first-hand checks (2026-10-09)

Fixtures were downloaded from the public repos above **only to verify container structure**; nothing
from them ships in Anvil. Method: raw bytes → gzip magic → decompress → `xml.etree` walk.

| File (source) | Live version | gzip? | Root chain | Key counts (decompressed) |
|---|---|---|---|---|
| `dawtool tests/als/example-120.als` | 10.1.7 | 1f8b → 61 KB | `Ableton` → `LiveSet` | FileRef 4 · SampleRef 4 · AudioClip 4 · DeviceChain 6 |
| `dawtool tests/als/live9/live9-patch-2-0point.als` | 9.7.1 | 1f8b → **10.1 MB** | `Ableton` → `LiveSet` | FileRef 499 · SampleRef 298 · MidiClip 39 · KeyTrack 295 · **MidiNoteEvent 1759** · DrumGroupDevice 6 · OriginalSimpler 52 · AudioClip 124 |
| `Ableton-Device-Creator …/input_rack.adg` | 12.1.5 | 1f8b → 1.11 MB | `Ableton` → **`GroupDevicePreset`** | FileRef 194 (RelativePath+Path both present) · SampleRef 32 · AbletonDevicePreset 64 |
| `Ableton-Device-Creator templates/Kick Racks/Kick 01.adg` | 12.1.5 | 1f8b → 1.11 MB | `Ableton` → `GroupDevicePreset` | FileRef 194 · SampleRef 32 |
| `Ableton-Device-Creator …/Sampler Drum Rack.adg` | 12.3b14 | 1f8b → 111 KB | `Ableton` → `GroupDevicePreset` | FileRef 13 · SampleRef 6 (paths like `…/Burnt Crispr-C1-V21-DG19.aif`) |
| `Ableton-Device-Creator …/simpler-template.adv` | 12.2b11 | 1f8b → 49 KB | `Ableton` → `OriginalSimpler` | FileRef 2 · SampleRef 1 (`Samples/Recorded/Bus 0060 […].aif`) |

Note: FileRefs pointing at `Devices/Instruments/…` (Live library) and base64 `<Data>` preset blobs must be
filtered out when harvesting sample candidates.

## Appendix B — open items

1. Get the actual "MXGPR" file (or its first 64 bytes, hex) from the pack → settle `.mxgpr` vs anything
   else. If `.mxgrp`: expect `serialization::archive` + `Samples/…` strings inside (testable).
2. If a legit, non-redistributable NN-XT spec can't be obtained: build SXT v2 parsing from public chunk
   facts + hex study of user-owned `.sxt` files (clean-room); validate against Awave/CWM output offline.
3. Kong: no action until the IFF-family reader exists; keep the "recognise + skip" UX.
4. Reference-rig note: mined/commercial pack files may be used for *analysis only* (Anvil REFERENCE-RIG
   policy); no content ever ships.
