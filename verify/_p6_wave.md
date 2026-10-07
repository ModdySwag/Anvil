# Anvil P6 wave — DELIVER: one-press STEM export · MIDI I/O · WAV/ZIP codecs · Deliver card (2026-10-07)

Trigger: P5 closed (commit `ba576a3`; store serves 9 packs / 548 presets). This wave = the studio
DELIVER half of `docs/08` §1 S4 + the GOLDEN BUILD candidates STEM export (#4), MIDI I/O (#5),
take naming (#58), direct-to-disk save (#77, partial: zip save) — the first of the studio waves.

## 0. Platform probe (parent-run, PASSED 2026-10-07 — headless Chromium, `file://`, this host)

`OfflineAudioContext(2, 96000, 48000)` + `avEngineBoot(oc, {offline:true})` → tier `worklet:data`, os 2.
Suspend/resume note injection verified with the REAL engine:

- silence before the injected note: RMS 0.00e+0 (0.10–0.45 s window); held note RMS 9.65e-2
  (0.60–0.95 s); peak 0.2377 on both channels; stereo.
- `suspend(0.5)` resolved at `oc.currentTime` **0.50133** (frame 24064 = 188×128 — i.e. the call
  resolves at the render-quantum boundary reached when the render passes the requested time:
  round UP to the next 128-frame boundary); `suspend(1.0)` resolved at exactly 1.0 (frame 48000 = 375×128).
- 6 chained suspends 50 ms apart all resolved; a 2 s render took ≈ 35 ms wall time.

Consequences pinned in §3: note/param injection rides per-boundary `suspend()/resume()`; onsets land
on 128-frame boundaries; one identical schedule across parts ⇒ stems are mutually aligned by construction.

## 1. Scope & file ownership (ONE writer per file)

| child | owns (write) | scratch |
|---|---|---|
| sa-0 | `src/av_bounce.js` · `verify/cdp_bounce.mjs` (WRITE-ONLY rig, parent runs it) | `cache/scratch/p6/bounce/` |
| sa-1 | `src/av_mid.js` | `cache/scratch/p6/mid/` |
| sa-2 | `src/av_wavio.js` · `src/av_zipc.js` | `cache/scratch/p6/codecs/` |
| sa-3 | `src/av_deliver_ui.js` | `cache/scratch/p6/deliver/` |

Children never touch shared files (`build.py`, `src/body.html`, `src/styles.css`, `src/app_core.js`,
`verify/cdp_smoke.mjs`, other `src/*`) and never run the build, browsers, the suites or git.
Each child self-verifies with its OWN node harness in its scratch dir (the rig file above is
write-only — authored by sa-0, never executed by a child). Parent owns integration (§5).

## 2. Pinned interfaces

### 2.1 `av_wavio.js` (sa-2)

```js
avWavEncode({ l, r, sr, bits = 24, dither = "auto" }) -> ArrayBuffer | null
avWavInfo(buf) -> { ok, sampleRate, channels, bits, format, frames, dataBytes, bytes } | { ok:false, error }
```

- `l`, `r`: equal-length Float32Arrays (both required; stereo only — the engine is stereo).
  `sr`: 44100 | 48000 (any positive number accepted; the renderer reports its own).
- `bits`: `16` | `24` | `"32f"`. 16/24 = PCM int LE (fmt tag **1**, blockAlign = ch×bits/8); 32f =
  IEEE float (fmt tag **3**). `dither`: `true | false | "auto"` — auto = on for 16, off for 24/32f.
  TPDF dither (two independent uniform draws, ±1 LSB peak), applied before rounding for PCM; never for 32f.
- Returns `null` on invalid input (mismatched lengths, unknown bits, empty) — never throws.
- `avWavInfo` parses the RIFF header of its own output AND of foreign WAVs (16/24/32f PCM float +
  int) — used by rigs/harnesses as the decoder.

### 2.2 `av_zipc.js` (sa-2)

```js
avZipBuild(entries, opts) -> ArrayBuffer | null
avZipInfo(buf) -> { ok, count, names, sizes, bytes } | { ok:false, error }
avZipCrc32(u8) -> number
```

- `entries`: `[{ name: string, data: ArrayBuffer | string }]`, order preserved. Strings encode UTF-8.
- Store method only (compression 0); local file headers + central directory + EOCD; CRC32 per entry;
  UTF-8 name flag (bit 11) when any name is non-ASCII. No zip64: refuse (`null`) above 512 MB total.
- `opts.date`: `Date | number | null`. `null` → FIXED deterministic DOS timestamp (pin `1980-01-01
  00:00:00`, DOS value 0x0021/0x0000) so bytes are reproducible; a real date is clamped to 1980–2107.
- `avZipInfo` walks the central directory (no extraction) — names, sizes, count.

### 2.3 `av_mid.js` (sa-1)

```js
avMidExport({ snap, trackMask, name }) -> { ok, bytes, events, warnings } | { ok:false, error }
avMidParse(bytes) -> { ok, format, ppq, bpm, tracks, noteCount, warnings } | { ok:false, error }
avMidToPattern(parsed, opts) -> { ok, pattern, warnings } | { ok:false, error }
```

- Export: ONE cycle of the pattern snap through the **pure planner** (`avSeqPlan`, guarded typeof;
  `fromStep 0..cycleLen`, 8-step chunks like the live scheduler). SMF **format 1**, PPQ **480**:
  track 0 = tempo + track name; then ONE MIDI track per selected seq track (0..3, `trackMask`
  filter). Step = 120 ticks (grid `8t` = 80); swing/micro/ratchet folded into ABSOLUTE tick times
  (ratchet = R short note pairs inside the step, planner spacing). Note-on velocity =
  `clamp(round(vel*127), 1, 127)`; off after `gate*stepDur` (≥ 1 tick). Warnings vocabulary:
  `"slide not representable in SMF (v1)"` when any step has slide=1.
- Parse: header/chunks, tempo, per-track note on/off pairing → `tSec`, `midi`, `vel`, `durSec`;
  tolerates running status; refuses malformed with `{ok:false}`.
- `avMidToPattern`: ≤ 4 non-meta tracks (first 4 by index order); each note → nearest step
  (`round(tSec/stepDur)`, stepDur from the parsed tempo + grid "16"), remainder → `micro` ticks
  (±12, tick = stepDur/24 — may reuse `avSeqCaptureQuantize` guarded, or re-implement the same
  rounding law); `vel` → 0.05..1; `gate` from `durSec` (clamped 0.05..1); notes outside 64 steps →
  dropped + warning; returns an av_seq_core-shaped pattern OBJECT (never loads it — the caller
  decides). Empty result → `{ok:false, error:"no notes"}`.

### 2.4 `av_bounce.js` (sa-0) — the offline song renderer

```js
avBouncePlan(snap, opts) -> { ok, events, frames, seconds, cycleSteps, sr, warnings } | { ok:false, error }
avBounce(opts) -> Promise<{ ok, sr, frames, seconds, loops, cycleSteps, bpm,
                            parts: [{ track, name, l, r }], master: { l, r } | null,
                            warnings, refused, stats } | { ok:false, error, warnings? }>
```

- `avBouncePlan` is PURE (node-loadable, no DOM): snap → events via `avSeqPlan` over
  `[0, loops × cycleLen)` in 8-step chunks (`cycleLen` = longest track len, 1..64 — same law as
  `avSeqSchedCycleLen`). Event = `{ t, type:"on"|"off", midi, gain, track, step }`, sorted by
  `(t, tie-rank, insertion)` — the planner's own order. `frames = ceil((cyclesSteps*stepDur + tailS) * sr)`.
  The rig cross-checks `avBounce` output against this plan.
- `avBounce` options (all optional): `loops` 1..64 (default 1) · `includeParts` (default true) ·
  `includeMaster` (default true) · `trackMask` `[bool×4]` (default all) · `tailS` 0..10 (default 2) ·
  `applyPlocks` (default true) · `params` object|null (overrides the `avParams` mirror when given —
  the rig uses this for determinism) · `sr` 48000|44100 (default 48000) · `maxSeconds` (default 600,
  refuse above honestly).
- Pipeline: fresh `OfflineAudioContext(2, frames, sr)` → `avEngineBoot(oc,{offline:true})` (guarded;
  refuse `{ok:false}` when unavailable) → patch replay → schedule → `startRendering()` → copy
  channel data into FRESH Float32Arrays (never leak the render buffer).
- **Patch replay law (mirror-sourced):** every row of `opts.params || avParams` via `h.setParam`
  (`engine.kind` first, explicit, default `"va"`); `avModPayload()` → `{t:"mod", macros, slots}` to
  the offline transport; sample slots: for slot 0..3 with a record in `avSampleStore.sent[slot]`,
  rebuild channel copies from `avSampleStore.get(id).buffer` (AudioBuffer → `getChannelData`) and
  send `{t:"sample", id:slot, name, rate, ch1, ch2}` — **CLONE ONLY, never a transfer list** (the
  store's buffers must survive). Worklet tier: post to `h.node.port`; SPN tier: direct
  `AVDSP.setMod/setSample` on `h.engine`. Refusals counted in `refused[]`. No zones source exists
  in page scope today → when `engine.kind === "sampler"` add warning
  `"sampler zones not replayed (no page-side source in v1)"`; same honest note for grain when no
  slot sample is present.
- **Event injection law:** dedupe target times; for each boundary `B = round(t*sr/128)*128` (never
  ≥ frames-128; clamp) suspend at `(B-1)/sr` (probe law §0) — during the suspend, apply that
  boundary's events in planner order: param/plock rows first, then offs, then ons. After the last
  event: `allOff()` once. `suspends` counted in stats. Same schedule for every render ⇒ alignment.
- **P-locks:** when `applyPlocks` and lanes exist: at every step boundary of the render range,
  evaluate each lane via the pure samplers (`avPlockSampleLane`, guarded; read `av_plock.js` for
  the exact live-cadence semantics and mirror them) and apply `h.setParam(path, v)`; refusals counted.
- **Never touches live state:** no `avNoteDown/Up`, no `window.__avEngine`, no live tap registration,
  no console noise. `avNote` bus is NOT used offline. Live notes are never affected.
- Determinism: identical opts + identical page state ⇒ bit-identical buffers (rig asserts two runs).
- Empty pattern (no events) → `ok:true`, silent parts, warning `"pattern has no audible events"`.

### 2.5 `av_deliver_ui.js` (sa-3)

```js
avDeliverKey(pcWeights) -> string                      // "Fmin" | "C#maj" | "chrom" | "nokey"
avDeliverNames(meta) -> { base, zipName, files }       // base = "anvil_<bpm>bpm_<key>"
avDeliverReadme(meta) -> string
avDeliverRun(opts) -> Promise<{ ok, kind, name, bytes, entries:[{name,size,sha256}], meta, warnings }
                       | { ok:false, error, warnings? }>
avDeliverDownload(bytes, name) -> boolean              // FSA showSaveFilePicker when available, else anchor; never throws
avDeliverUiInit() -> boolean                           // mounts into #av-deliver-host (absent → false, no throw); idempotent
avDeliverUiClasses() -> string[]                       // parent appends these to styles.css (coverage-checked)
window.__avDeliverUi = { state(), run }                // rig debug handle (house style)
```

- `avDeliverRun` opts: `loops`, `bits` (16|24), `dither` ("auto"), `includeStems`, `includeMaster`,
  `includeMidi`, `includeReadme`, `date` (null → real Date for README; zip date option passed through),
  `params` (test seam). Pipeline: per-part `avBounce` (ONE part at a time — bounds peak memory;
  identical opts ⇒ identical bytes) → per-part `avWavEncode` → `avMidExport` per part + full
  (single cycle) → key detect from exported note weights → names → README → `avZipBuild` → sha256
  per entry (`crypto.subtle`, async). `includeStems:false` ⇒ `kind:"wav"` single master file (no zip).
- Naming (#58/#4): `base = "anvil_<intBpm>bpm_<key>"`; zip `"<base>_stems.zip"`; entries at zip ROOT:
  `"<base>_master.wav"`, `"<base>_stem1.wav"`..`"_stem4.wav"` (selected only), `"<base>_full.mid"`,
  `"<base>_stem1.mid"`.., `"README.txt"`.
- Key heuristic (pin outcome, implementation discretion): 12-bin pitch-class histogram (weight =
  `vel × count`), correlate against major/minor profiles → `[A-G]#?(maj|min)`; no notes → `"nokey"`;
  below threshold → `"chrom"`. Deterministic.
- README fields (pin): header `Anvil — stem export`; source line (pattern name · loops × cycleSteps ·
  bpm · grid · swing); key line; format line (sr · bits · dither); file list with size + sha256;
  warnings; footer `Anvil v<ANVIL.version> · free · AGPL-3.0-or-later` + ISO date.
- UI (class prefix `av-deliver-*`, reuse `av-btn`/`av-note`/`av-dim`): title, status line, options
  (loops select 1/2/4/8 · bits select 16/24 · checkboxes stems/master/midi/readme), buttons
  `EXPORT STEMS (.zip)` and `MASTER WAV`, progress line (phase + done/total), result line with name,
  size, DOWNLOAD re-click link, warnings area. Degraded state when a module is missing
  (`typeof`-guarded calls) — honest note, never a throw. Absent host → init false without throw.

### 2.6 Shared shapes

- `warnings`/`refused` are string arrays, always present on ok AND failure results.
- All four modules: `"use strict"`; one namespace per file (`avWav*`/`avZip*`/`avMid*`/`avBounce*`/
  `avDeliver*`); NO DOM/worklet reach-ins at load (node-loadable); never throw (refuse honestly);
  absent facade calls are `typeof`-guarded and degrade to warnings.

## 3. Laws (wave-specific — inherit all standing laws)

1. **Probe law (§0):** injection via per-boundary `suspend/resume`; onset alignment = 128-frame
   boundaries; ≤ 64 frames from the analytic planner time; identical schedule across parts.
   Do NOT invent another injection mechanism without probing.
2. **Mirror law:** the render patch = `avParams` mirror (+ `avModPayload` + `avSampleStore.sent`
   slots). Never read live engine internals; never mutate live state.
3. **Clone law:** sample sends to the offline engine use structured CLONE (no transfer list).
4. **Determinism law:** same opts ⇒ bit-identical byte output (assert in harness + rig).
5. **Memory law:** part-by-part rendering in deliver; `maxSeconds` guard; fresh copies out.
6. Style laws: build-order-compatible classic scripts (no modules/imports), allocation-free render
   paths (buffers built off the sample loop), one writer per file, tests self-contained in scratch.

## 4. Rig `verify/cdp_bounce.mjs` (sa-0 writes; parent runs post-integration)

Launch skeleton copied VERBATIM from `cdp_store.mjs` (candidates Chrome/Edge/Brave, free-port scan,
fresh temp profile, 1440×900 metrics, `--autoplay-policy=no-user-gesture-required`, explicit exit,
temp-profile-scoped cleanup; sha before === after; `EXPECT_SHA` null until the parent pins).

Proofs, in order:
1. Boot contract (`data-av-ready`) + module presence: the five new globals exist + `#av-deliver` card
   mounted into `#av-deliver-host` (card root, status line, options, both buttons present).
2. Known pattern via `avSeqLoad` (16-step, 4 tracks, notes on ALL tracks, prob 100, no swing/micro)
   + pinned patch via `avApplyParam` (`engine.kind:"va"`, `master 0.8`).
3. `avBouncePlan` cross-check: event count/positions vs `avSeqPlan` direct call; frames math.
4. Bounce (loops 1, tail 1 s): all parts + master; all buffers finite; per-part energy > 0 where the
   track has notes; stem regions where a track is silent stay below floor; **onset frames are
   multiples of 128** (up to the fixed envelope-attack constant, ≤ 64 frames from the analytic time);
   stem-vs-master onset frames IDENTICAL; frames = expected ± 1 quantum.
5. Isolation: `trackMask` renders only the selected part; region energy moves accordingly.
6. Determinism: same opts twice ⇒ `l`/`r` byte-identical (compare a hash).
7. P-locks: with an extreme lock (e.g. cutoff) applied via `avPlockLoad`, `applyPlocks:true` render
   differs measurably from `applyPlocks:false`; lock value audible at the locked step.
8. WAV: 16/24/32f encodes of the master — `avWavInfo` header truth (bits, sr, frames, tag), data
   size math; 16 vs 24 byte sizes differ as pinned; encoding deterministic.
9. MIDI: `avMidExport` → `avMidParse` round-trip: note count, bpm, tick positions match plan;
   `avMidToPattern` returns a loadable pattern (spot-check via `avSeqLoad`).
10. ZIP: `avZipBuild` with fixed date → `avZipInfo` names/sizes; byte-stable across two builds.
11. Deliver end-to-end: `avDeliverRun({loops:1, bits:16, params:<pinned>})` → ok; zip contains the
    pinned entry set; sha256s in `entries` recomputed and equal; README contains bpm/key/file names;
    the download path fires (CDP `Browser.setDownloadBehavior` → temp dir) and the file lands on disk
    (`<base>_stems.zip`) — the parent then python-verifies the artifact (zipfile + wave).
12. Zero page errors · screenshot `renders/p6-deliver-suite.png` · freeze sha256 before === after.

## 5. Parent integration (after the children land)

1. ONE counted-assert script (`cache/scratch/p6/integrate/_p6_integrate.py`, `rep(old,new,n)` helper,
   one write per file): `build.py` js_parts insert after `av_store_ui`, before `av_synth`:
   `av_wavio` → `av_zipc` → `av_mid` → `av_bounce` → `av_deliver_ui` · `body.html` `#av-deliver`
   card + `#av-deliver-host` after the `#av-store` card (hero copy + footer phase text updated) ·
   `styles.css` deliver class block (coverage-checked) · `app_core.js` guarded `avDeliverUiInit()`
   boot + log line + version `0.6.0` /phase `P6 · deliver`.
2. `cdp_smoke.mjs`: deliver-card check (house style like the store check) → 17 checks.
3. Rebuild → re-run ALL child node harnesses + `verify/cdp_bounce.mjs` first run (then pin
   `EXPECT_SHA` and re-run) → FULL battery (re-pin `cdp_midi/sample/rec/fx/seq/store/bounce` to the
   new frozen sha) → PERF GATE (bench + stress) → commits + addendum 24 + README status.
4. Artifact witness: parent python-verifies the rig-saved zip (`zipfile` names/sizes/CRC + `wave`
   header read of one stem), records paths in the addendum.

## 6. Watch items

- Suspend times must be clamped `< frames/sr`; dedupe; guard against duplicate-boundary races.
- `frames` exactness: assert `ceil((cycles*cycleSteps*stepDur + tailS)*sr)` against rig math.
- The mirror is seeded by `avSynthInit` defaults; FX/pads rows may be sparse — unmirrored paths ride
  the engine defaults (honest; note in README only if a refusal was seen).
- 32f tag 3 vs int tag 1; 24-bit blockAlign; dither only for PCM.
- Zip: DOS time fixed epoch for determinism (default) — real dates optional.
- Deliver UI: absent-host contract; degraded module notes; no console noise.
- Do not add parts to `cdp_smoke` numbering assumptions: 17 total after integration.
- PERF GATE note: the bounce adds no live-engine cost; bench/stress must stay in the known envelope.

Carried: P·2 minBLEP pass · P4 follow-ups (fill control wiring, chains/scenes undo checkpoints,
acid accent-flag decision) · PERFECT TUNINGS (tuning engine) · studio S1–S3 (record core, takes,
mix/master), deck display, popout keyboard, CODE section, walkthrough/help, P6 share/cloud, P7
polish + deploy + owner pass.

---

## AMENDMENT 1 — 2026-10-07 (parent, post-first-rig-run): probe law rev2 — the per-boundary DELIVERY BARRIER + rig SPEC fixes

First rig run on the integrated build (`ace7b17f`): **26/31** — the 5 failures triaged by two parent
platform probes (probe 1 ran the real bounce repeatedly; probe 2 tested the mechanism):

1. **The bare suspend-injection raced message delivery — APP fix, landed in `av_bounce.js` p6.1.**
   Probe 1: the 4-track MASTER render was nondeterministic across 5 identical runs (5 different
   hashes; random lost/stuck region-A notes; mid-gap bleed) while single-track stems were
   byte-identical and clean. Probe 2: with the bare `suspend → post messages → resume` driver, two
   identical runs differ and notes get lost; with a **stats round trip between the message post and
   `resume()`**, 15/15 boundaries synced while suspended, two runs came back byte-identical
   (`8c077962e734034b` twice), clean 8/8 onsets, ~30% faster renders. FIX: `avBounceBarrier(h)`
   (a `h.stats()` FIFO round trip, `AV_BOUNCE_SYNC_MS = 800` cap) runs after every boundary's
   messages, before the resume; a timeout counts as `stats.barrierFail` (+ one warning). Worklet
   tier only (SPN applies messages synchronously). **LAW rev2: a bare suspend-injection is NOT
   deterministic for multi-message bins — every boundary must be barrier'd.**
2. **Rig SPEC fixes (parent; strength preserved, nothing loosened);** the region-B onset check's
   "near-fixed ≤ 4 spread" clause misasserted its fixture — the detection lag = envelope attack +
   PER-NOTE oscillator phase (the engine seeds unison phases per note from its PRNG; the master and
   stem renders draw different phase streams). Now: each delta ∈ [0, 96] (worst observed 64) ·
   spread ≤ 64. The stem-vs-master "IDENTICAL frames" check compares within the same bound, both
   within [B, B+96]. The WAV determinism sub-check encodes with `dither:false` (16-bit TPDF dither
   is stochastic BY DESIGN — the codec pin). The stats check additionally requires
   `barrierFail === 0` and `syncs ≥ suspends` (the barrier ran on every boundary).

