# 03 — SerumPreset & EXS24 native import (+ browser `decodeAudioData` support)

Research for the Anvil in-app SAMPLE PACKS importer. Date: **2026-10-09**.
Provenance: community docs + GitHub sources reviewed same day; **629 real `.SerumPreset` files on this machine** parsed and byte-inspected; live `decodeAudioData` test run in HeadlessChrome **145.0.0.0** (Windows 11); Chromium ffmpeg build config pulled from source today.
Clean-room rule applied: reuse only MIT/ISC/Apache code; GPL/no-license projects cited as *facts and read-only reference* (flagged per row below).

---

## TL;DR verdicts

| Question | Verdict |
|---|---|
| Serum 2 `.SerumPreset` parseable in JS? | **Yes.** `XferJson` + zstd + CBOR container, fully documented by ≥3 independent community implementations. Browser libs exist (MIT candidates: `fzstd`/`zstddec`, `cbor-x`). |
| Serum 1 `.fxp` parseable? | Container + ~90% of patch layout documented (verified against 393 presets by serum2vital); **embedded wavetable data region has never been publicly located.** |
| "Wavetables stored as PNG image strips inside the preset" | **NOT VERIFIED — no evidence found.** Contradicting evidence: 0 PNG signatures in 629 real presets. PNG is Serum's wavetable **import/share** format (2048×N luminance strip), not its preset storage encoding per every source checked. Needs a 30-min empirical spike before betting code on it (§1.3). |
| `.exs` is "a text format" | **Wrong — `.exs` is binary** (TBOS chunk format). The text format of that world is SFZ. |
| Chromium `decodeAudioData` today | WAV (u8/s16/s24/s32/f32 + μ-law/a-law), MP3, FLAC, Ogg Vorbis, Ogg Opus, WebM Opus, AAC (M4A & ADTS) → **yes**. **AIFF/AIFF-C → no. CAF → no. MS-ADPCM WAV → no. 64-bit-float WAV → no.** |

---

## 1. SerumPreset (Xfer Serum)

### 1.1 `.SerumPreset` (Serum 2) — container, verified

```
b"XferJson\0"                     (9 bytes)
uint64 LE   json length
bytes       JSON metadata         {fileType:"SerumPreset", hash:md5(compressed payload),
                                   presetName/presetAuthor/presetDescription,
                                   product:"Serum2", productVersion, tags, url, vendor, version}
uint32 LE   uncompressed CBOR size
uint32 LE   encoding (2 = zstd)
bytes       zstd frame → CBOR
```

- Confirmed by: KennethWussmann/serum-preset-packager, cboone/serum-2, wiillownet/serum2-preset-loader (docs/DERIVATION.md), serum2vital, and **our own decode of 629 files (626 factory + 3 fixtures, 0 failures)**.
- CBOR = flat map keyed by module: `Env0–3`, `LFO0–9`, `Oscillator0–4` (A/B/C/Noise/Sub), `WTOsc0…`, `ModSlot0–63`, `FXRack0–2`, `Arp0`, `MidiClip0–11`, `Macro0–7`, `VoiceFilter0/1`, … (~160 modules). Each has `plainParams`: the string `"default"` OR a map of *only* the parameters differing from default, in real units (Hz/s/dB/%).
- Wavetable oscillators reference tables by relative path: `WTOsc0.relativePathToWT` → e.g. `"S2 Tables/Digital/FM Piano.wav"` / `"User/…"`, resolved against Serum's `Tables/` folder (serum2vital FORMATS.md; cboone docs; confirmed in our dumps).
- Serum 2 can **"Embed in Preset"** a wavetable/sample (manual; unavailable for factory content). Embedded encoding is not publicly documented — see 1.3.
- Bonus, verified: Serum 2 **multisample** oscillator embeds an **SFZ document** as text inside the preset (`<region> hikey=… pitch_keycenter=… sample=…flac`), with sample audio as external `.flac` files, not embedded. (Found in `PN - Piano Concert Hall.SerumPreset`, our scan.)

### 1.2 `.fxp` (Serum 1) — container and layout

- VST2 opaque-chunk preset: `CcnK` / **big-endian** size / `FPCh` / version / plugin id `XfsX` / version / program count / 28-byte name / chunk.
- Chunk = `zlib(state)` + `zlib(second 16 KB block, identical in every preset)` + uint32 + **uint32 LE length trailer** (serum2vital FORMATS.md, checked on 393 presets). Decompressed state 20 KB–172 KB.
- Interior (decompressed offsets in FORMATS.md): mod slots, LFO shape blocks (classic vs "new" 172,736-byte layout), **params 0–227 @0x3460** (float32, normalised 0–1), **wavetable names @0x3C08/0x3E08 (512-byte strings)**, params 228–298, global switch block, macro names, etc.
- Wavetables: referenced by *name* (e.g. `Analog/Basic Shapes.wav`); files are mono WAV (float32/16/24/32) with a `clm ` chunk: `<!>2048 00000000 wavetable (www.xferrecords.com)` (frame size 2048; flag bit = "factory", never embedded in presets).
- Custom/edited tables **are** saved inside the preset (Serum 1 manual: "from 8k to 4 Megabytes" — multiples of 8 KB = 2048×float32 slices). **The embedded region/encoding has never been publicly located**; devalias' RE notes couldn't pin it, serum2vital never needed it, no tool extracts it. Treat as an open spike, not a plan.

### 1.3 The PNG claim — verdict and the real mechanics

What is **verified true**: Serum (since 1.12, Aug 2016) imports **PNG images as wavetables** — pixel **luminance = amplitude**, image treated as a strip: **2048 px wide × up to 256 rows, one row = one 2048-sample frame** (Xfer feature, ADSR tutorial, okwt's image↔wavetable tool documents the 2048×256 convention exactly). Users also share wavetables *as images*, and Serum's editor can show/export them.

What is **not** supported by any source we checked: that presets *store* wavetables as PNG strips.
- Evidence: our byte-level scan — **626 factory presets + 3 third-party debug/fixture presets decompressed (0 errors); PNG magic count across all payloads: 0.** Largest presets contain SFZ text + `.flac` sample references, not images.
- Caveat (honest): factory content *cannot* embed, and the local `Presets/User` folder is empty — so the **embedded-content case is untested end-to-end**. The claim should be re-checked with a 30-minute spike: save a preset in Serum 2 with a custom table + "Embed in Preset", run the unpack, hexdump. Until then, plan for "path reference + unknown embedded blob", not "PNG".

If/when PNG strips are ever the input (user wavetable assets, or the spike shows embedding = PNG), clean-room extraction in-browser is trivial — **no PNG library needed** (native decode):

```js
// PNG strip → 2048-frame mono tables (browser-native, no deps)
const bmp = await createImageBitmap(pngBlob);              // native PNG decode
const g   = new OffscreenCanvas(2048, bmp.height).getContext('2d', { willReadFrequently: true });
g.drawImage(bmp, 0, 0, 2048, bmp.height);                  // resample rows to 2048 wide
const px  = g.getImageData(0, 0, 2048, bmp.height).data;   // RGBA8
for (let row = 0; row < bmp.height; ++row) {               // row = frame
  const frame = new Float32Array(2048);
  for (let x = 0; x < 2048; ++x) {
    const i = 4 * (row * 2048 + x);
    frame[x] = (0.299*px[i] + 0.587*px[i+1] + 0.114*px[i+2]) / 127.5 - 1; // luma → [-1, 1]
  }
  frames.push(frame);
}
```

Precision caveat: canvas is 8-bit RGBA → 256 levels; fine for import, lossy vs float tables.

The **actual documented path** for Serum wavetables (both generations) is simpler: tables are `.wav` files (usually float32 mono) with a `clm ` chunk declaring frame size; decode via `decodeAudioData` (native, verified) and split at 2048-sample boundaries (frame count = totalSamples / frameSize). No PNG anywhere in it.

### 1.4 Existing open-source parsers & licences

| Project | Lang | License | Does | Reuse for Anvil |
|---|---|---|---|---|
| KennethWussmann/serum-preset-packager | Py | **none (read-only)** | original Serum2 unpack/pack → JSON | facts only |
| CharlesBT/node-serum2-preset-packager | TS | **MIT** | Serum2 decode/encode | ✅ reusable |
| cboone/serum-2 (`serumfile.py`, docs) | Py | **MIT** (per GitHub metadata) | read/verify/dump/diff/patch presets+curves; CC0 fixtures | ✅ reusable |
| btesser/serum2vital | Py | **GPL-3.0 (read-only)** | S1+S2 readers; best format docs (FORMATS.md) | facts only |
| dougwithseismic/serum2gen | Py | **MIT** | read/write/generate presets; factory table catalog | ✅ reusable |
| wiillownet/serum2-preset-loader | Py | **MIT** | preset → VST3 state | ✅ (less relevant) |
| potatoTeto/SerumPresetGenerator | C# | **MIT** | clean-room `.fxp` writer (incomplete skeleton) | ✅ pattern |
| demberto/fxp | Py | **MIT** | generic VST2 FXP container parser | ✅ reusable |
| dafaronbi/Serum-FXP-Python-Reader | Py | none | sketchy .fxp scripts | facts only |
| 0xdevalias gists (RE notes, vst_fxp_extractor) | — | none | Serum 1 RE notes/files | facts only |
| mossgrabers/ConvertWithMoss background — see §2 | | | | |

### 1.5 Realistic effort (Serum)

- **Serum 2 importer (read-only, path-referenced tables): ~3–6 dev-days.** Container parse + CBOR walk (~300–500 LOC) + UI plumbing; browser deps are small MIT libs (`fzstd`/`zstddec` for zstd, `cbor-x` or a ~150-LOC hand-rolled CBOR reader). Test corpus: the 626 local factory presets + fixtures.
- **Wavetable-from-file path:** ~1–2 days (clm frame-size parse, 2048 split, mono/float handling, rate match).
- **Embedded wavetable extraction:** 0.5–1 day spike first (see 1.3); likely small after, but *unknown until the spike runs*.
- **Serum 1 `.fxp`:** ~2–4 days for container + params + wavetable *names* (in-browser zlib via `DecompressionStream('deflate')`); embedded-table extraction **not plannable yet** — recommend deferring/parking it.

---

## 2. EXS24 (`.exs`, Logic)

### 2.1 Format reality check

`.exs` is **binary**, not text. Multiple independent confirmations (sampleminer.com, matt-allan/renoise-exs24, tonverk-elmulti-converter spec, Renoise forums): a flat sequence of fixed-size blocks, little-endian standard, a legacy big-endian variant exists, and a "new" 0x40-prefixed signature generation. Plain text visible in a hex dump is just sample names/paths. (The "text format" notion likely conflates EXS with **SFZ**.)

### 2.2 Structure

- Every block: **84-byte header** = signature/chunk-type (2–4 B; e.g. zone `0x01000101`, group `0x02000101`, sample `0x03000101`, params `0x04000101`; new gen `0x41…/0x42…/0x43…`), size, object id, 8 B reserved, 64-byte NUL-padded name; chunk id ASCII `TBOS`/`JBOS` at offset 16 (`SOBT`/`SOBJ` = byte-swapped big-endian file; detect on byte 16 = `'S'`).
- Typical order: header, **Zone\***, **Group\***, **Sample\***, Params. Content sizes: instrument 88 B, zone 148 B, group 144 B, sample 600 B.
- **Zone** (offsets from data start): 0 `flags` (bit0 oneshot, bit1 pitch-track OFF, bit2 reverse, bit3 velocity range on, bit6 output assigned) · 1 `key` (root) · 2 `fineTuning` i8 cents · 3 `pan` i8 · 4 `volumeAdjust` i8 dB · 5 `volumeScale` · 6 `keyLow` · 7 `keyHigh` · 9 `velocityLow` · 10 `velocityHigh` · 12 `sampleStart` u32 · 16 `sampleEnd` u32 · 20 `loopStart` · 24 `loopEnd` · 28 `loopCrossfade` (ms) · 32 `loopTune` · 33 `loopOptions` (loopOn / equal-power / play-to-end-on-release) · 34 `loopDirection` (0 fwd / 1 back / 2 ping-pong) · 80 `coarseTuning` i8 semitones · 82 `output` · 88 `groupIndex` i32 (−1 none) · 92 `sampleIndex` u32 · (~104 `sampleFade` u32, newer files).
- **Sample** (the "sample list" — one block per sample): 4 `length` (frames) · 8 `sampleRate` · 12 `bitDepth` · 16/20 `channels` · 28 `type` ASCII (`WAVE`/`AIFF`; SDII legacy, CAF since Logic 8) · 32 `size` · 36 `isCompressed` · **80 `filePath` 256 B · 336 `fileName` 256 B** (newer; long names supported since Logic 9).
- **Group**: volume/pan/polyphony, exclusive (choke) group, velocity range, round-robin (`enableByType=2` + `roundRobinGroupPos`), release trigger, key/velocity crossfade amounts, env offsets, output.

### 2.3 Mapping sketch → Anvil sampler zone table

| Anvil field | EXS24 source | Notes |
|---|---|---|
| `low` | `zone.keyLow` | u8 MIDI |
| `high` | `zone.keyHigh` | u8 MIDI |
| `root` | `zone.key` (+ `coarseTuning` semitones folded in; keep `fineTuning` cents in a separate field if the table gets one) | pitch applied as playback-rate ratio vs 44.1k, or resample at import |
| `buffer` | `sample.fileName` (fallback: basename of `sample.filePath`); resolve against user-picked pack folder / .exs dir | `sample.type` tells the decoder: WAVE → `decodeAudioData`; **AIFF/CAF → clean-room decoder (§3)** |
| `vol` | `zone.volumeAdjust` dB → linear `10^(dB/20)` | `volumeScale` is a key-slope trim — flatten/ignore v1 |
| `start` | `zone.sampleStart` | u32 frames; guard 0 / 0xFFFFFFFF; clamp to decoded length |
| `end` | `zone.sampleEnd` | same guards |
| `fadeIn` | — | **no per-zone fadeIn in EXS** → default 0 (table field stays, unused) |
| `fadeOut` | — | **no per-zone fadeOut** → default 0; loop fade is separate (`loopCrossfade` ms) |
| (*extend*) `velLow/velHigh` | `zone.velocityLow/High` | required for drum kits & layered pianos — add 2 columns or split zones |
| (*extend*) loop | `loopStart/End/Mode/Crossfade` + `loopPlayToEndOnRelease` (inverted) | map if the table supports loops |
| (*extend*) flags | `oneshot`, `reverse`, pitch-track-off, `pan`, output | surface as zone options |

Groups/round-robin/choke can be flattened with a warning in v1.

### 2.4 Existing open-source parsers & licences (EXS)

| Project | Lang | License | Reuse |
|---|---|---|---|
| asatamax/tonverk-elmulti-converter (docs/EXS24_FORMAT_SPEC.md + `elmconv.py`) | Py | **ISC** | ✅ reusable w/ notice (spec derived from ConvertWithMoss analysis) |
| matt-allan/renoise-exs24 (`exs.lua`) | Lua | **MIT** | ✅ reusable |
| vonred `exs2sfz.py` (2013; mirrored on sfzformat.com) | Py | **ISC** | ✅ reusable — full working EXS→SFZ reader |
| mossgrabers/ConvertWithMoss | Java | **LGPL-3.0** | read-only (primary RE source) |
| bonzairob/pyexs24 | Py | none | facts only |
| dhilowitz/EXS2SFZ (Swift CLI) | Swift | none detected | facts only |

### 2.5 Realistic effort (EXS)

Small: **1–3 dev-days** for a clean-room binary reader + zone-table mapping (ISC/MIT references above permit even direct porting with attribution; ~300–600 LOC), plus **+0.5–1 day for an AIFF decoder** because Logic packs ship `.aif` samples and Chromium cannot decode AIFF (§3). Big-endian legacy files: add a half-day; modern little-endian is the norm.

---

## 3. Browser `decodeAudioData` format support — TODAY

Tested live: HeadlessChrome **145.0.0.0** (Windows 11, 2026-10-09), `OfflineAudioContext.decodeAudioData()`, files generated with ffmpeg 9.0.1, fetched over a local HTTP server:

| Format produced (0.15 s sine) | Result |
|---|---|
| WAV PCM 16-bit (`pcm_s16le`) | ✅ |
| WAV PCM 8-bit (`pcm_u8`) | ✅ |
| WAV PCM 24-bit (`pcm_s24le`) | ✅ |
| WAV PCM 32-bit (`pcm_s32le`) | ✅ |
| WAV 32-bit float (`pcm_f32le`) | ✅ |
| WAV μ-law / A-law | ✅ / ✅ |
| **WAV 64-bit float (`pcm_f64le`)** | ❌ `EncodingError: Unable to decode audio data` |
| **WAV MS-ADPCM (`adpcm_ms`)** | ❌ |
| MP3 (ID3, 64 kbps) | ✅ |
| FLAC | ✅ |
| Ogg Vorbis | ✅ |
| Ogg Opus (48 k) | ✅ (resampled to context rate) |
| WebM Opus | ✅ |
| AAC in M4A (AAC-LC) | ✅ |
| AAC ADTS (`.aac`) | ✅ |
| **AIFF (big-endian PCM)** | ❌ |
| **AIFF-C `sowt` (little-endian PCM)** | ❌ |
| **CAF (PCM)** | ❌ |

Corroboration (authoritative, pulled today):
- Chromium's bundled ffmpeg build config (`chromium/third_party/ffmpeg`, `Chrome/win/x64`): `--disable-everything` + explicit enables only — decoders `vorbis, libopus, flac, pcm_u8, pcm_s16le, pcm_s24le, pcm_s32le, pcm_f32le, mp3, pcm_s16be, pcm_s24be, pcm_mulaw, pcm_alaw, aac (+h264)`; demuxers `ogg, matroska, wav, flac, mp3, mov, aac`. **No AIFF demuxer; all ADPCM decoders 0; `pcm_f64` 0.**
- `canPlayType('audio/aiff')` → `""` (not supported) on Chrome 145; MDN lists AIFF under Apple/Safari-side support; StackOverflow confirms Chrome/Firefox don't decode AIFF.

**Gating conclusion for the importer:**
- No clean-room decoder needed for: WAV (in the variants above), MP3, FLAC, Ogg Vorbis, Opus (Ogg/WebM), AAC (M4A/ADTS). `decodeAudioData` covers them — note it resamples to the context rate and needs whole files.
- Clean-room decoders needed: **AIFF/AIFF-C** (Logic/EXS packs — top priority; IFF `FORM/AIFF/C`, COMM+SSND, big-endian PCM + `sowt`/`fl32`/`ulaw`/`alaw` variants; ~150–250 LOC) · **CAF PCM** (Logic 8+; IFF-like; similar size) · optional: MS/IMA-ADPCM WAV, 64-bit-float WAV, SDII legacy. Safari decodes AIFF, but Anvil should assume Chromium engines: sniff headers (`FORM….AIFF`) and route to the fallback decoder instead of hard-failing.

---

## Sources (all retrieved 2026-10-09)

- Serum 2 container/format: github.com/KennethWussmann/serum-preset-packager (+ issue #1) · github.com/cboone/serum-2 (docs/SERUM-FILE-FORMAT.md) · github.com/wiillownet/serum2-preset-loader (docs/DERIVATION.md) · github.com/CharlesBT/node-serum2-preset-packager · github.com/dougwithseismic/serum2gen
- Serum 1 + format verification: github.com/btesser/serum2vital (docs/FORMATS.md) · gist.github.com/0xdevalias/135a18e979ac8e302ebbc700a50a8d74 (+ 5a06349b376d01b2a76ad27a86b08c1b) · Serum 1 manual (quoted in gist)
- PNG/import + embedding: xferrecords.com/web-manual/serum-2/embedding-content-when-saving-a-preset · adsrsounds.com serum PNG tutorial · github.com/drzhnn/okwt (2048×256 convention) · monosounds.studio serum-2 preset guide
- EXS24: github.com/asatamax/tonverk-elmulti-converter (docs/EXS24_FORMAT_SPEC.md) · github.com/matt-allan/renoise-exs24 (exs.lua) · sfzformat.com/assets/src/exs2sfz.py · sampleminer.com/formats/exs/ · github.com/mossgrabers/ConvertWithMoss · forum.renoise.com threads 30511 / 49835
- decodeAudioData: live test (this machine) · chromium.googlesource.com/chromium/third_party/ffmpeg (config/Chrome/win/x64) · developer.mozilla.org Web/Media/Guides/Formats · stackoverflow.com/q/74661268
- Local verification corpus: `C:\Users\Moddy\Documents\Xfer\Serum 2 Presets\Presets` (626 presets, 0 parse errors, 0 PNG signatures; decompressed sizes 9,566–459,632 B); scratch scripts: `…\profiles\deepseek\cache\scratch\sx\inspect_presets.py`
