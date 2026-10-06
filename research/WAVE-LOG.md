# WAVE LOG — running verification & synthesis notes (anvil)

## Wave 1 — deleg_423fd150 — T1 Dittytoy · T2 Acid · T3 Groovebox — COMPLETE ✓ VERIFIED

- **T1** `research/tabs/T1-dittytoy-deepdive.md` — 53.7 KB / 20 entries. All six seed sources re-verified **byte-identical** to live pages; runtime bundles mined (loop→worker model, 640-frame buffers ×4 + MessageChannel recycling, MSG_* protocol, one AudioWorklet @ 128-frame quanta, sleep-as-tick-accumulator timeline, offline render → lamejs MP3 chain (LAME 3.98.4 / LGPL-3.0), input-parameter parser + URL-hash round-trip + MIDI Learn storage). srtuss (20) + athibaul (47) catalogues parsed. 7 new ditties deep-read: Acid Warrior (ZDF Moog ladder + `tanhXdX` + Euclidean + sidechain-duck shared filter), Snare (3-SVF), Fat kick (4-layer), Feedback/Trippy FM, **ADAA anti-aliasing** (Parker/Zavalishin/Le Bivic 2016), StepperMusic + in-ditty ProTracker player. Licensing closed: seeds CC BY-NC-SA → clean-room only; **npm `dittytoy` runtime = MIT** (reuse path); srtuss GitHub library unlicensed → reference only.
- **T2** `research/acid/T2-acid-heritage.md` — 94 KB / 20 entries. 303 filter settled by circuit analysis: **4-pole/24 dB with C/2 bottom cap** (H(s) captured) — the 18 dB label is marketing; accent = **4 simultaneous changes + sweep-capacitor memory** (consecutive accents rise); mods canon fully captured (Devil Fish 21 items; TD-3-MO ships the mods); ReBirth RB-338 + MC-303 archetype + Roland50.studio (sampled real-hardware click sounds = top delight idea; no published licence → behaviour reference) + tb303.com (only product owning workflow: automation, community sharing, JSON/WAV export); **Open303 = MIT** (C++ engine, WASM/Worklet foundation candidate), JC303 wrapper GPL-3.0 (wrapper only), x0xb0x files MIT; TR-909 shuffle math (2/96-of-beat per key, key 5 = 2:1). Market gap: no product covers sound + mods + workflow together. Includes 30-row comparison table + 3-part must-ship checklist + brand-clean precedent (ReBirth 2017 takedown).
- **T3** `research/groovebox/T3-groovebox-sequencing.md` — 52 KB / 20 entries. 15 device models (Digitakt II p-locks/conditional trigs/retrig math/song mode; Circuit Tracks + Rhythm; MC-707/101; MPC; Polyend Play; OXI One; Deluge; OP-Z step components; PO-12) + 4 tool-verified math entries (swing convention + `delay = pair×(S−50)/100` + ms tables; probability & A:B cycle math; ratchets/micro-timing/gate semantics; polymeter/polyrhythm/Euclidean). Web-tools scan: **no browser product ships modern groovebox semantics — the gap is ours**. Deliverables: 20-item MUST/SHOULD/LATER shortlist, a full step-object model (JSON + playback pseudocode), 3 arrangement options with recommendation.

### Parent spot-checks (verified myself, not just child claims)
- `raw.githubusercontent.com/RobinSchmidt/Open303/master/License.txt` → **200, MIT verbatim** ("released under the terms of the MIT license … Copyright (c) 2009 Robin Schmidt") ✓
- `registry.npmjs.org/dittytoy/latest` → **MIT**, v1.0.8, repo reindernijhoff/dittytoy-package ✓
- `timstinchcombe.co.uk` diode page → 200 ✓
- ladyaada x0xb0x page → parent fetch 403 (child-verified MIT claim stands as child-verified; independent check pending if load-bearing)

### Corrections applied
- `research/tabs/T0-tab-digest.md` patched: Cosmic Drone shimmer = ~1.4 **ms** (700 Hz rate; digest said 1.4 s); shared-filter connection rules note; corrections log appended. All six raw sources byte-identical (extraction validated).
- Recorded conflicts (not papered over): 18-vs-24 dB labelling (physics favors 4-pole C/2); TD-3-MO filter wording; TB-303 unit counts 10k vs 17k; **the dangerousminds article Moddy visited is about Errozero's Acid Machine, not tb303.com**.

## Wave 2 — deleg_b534252f — T4 Matrix · T5 Engine · T6 Multi-user — COMPLETE ✓ VERIFIED

- **T4** `research/matrix/T4-synth-feature-matrix.md` — 55 KB / 19 entries + 42-row MUST/SHOULD/DIFFERENTIATOR/AVOID table. Key finds: **Zebra 3 shipped 2026-04-20** (€249, modal/comb physical modelling, per-voice modulatable FX sends, MTS-ESP); **Omnisphere v3** (2025-10-21, 41,405 sounds, $499); **Serum 2 delta** (3 osc × 5 modes, 2 aux FX buses, 13 FX + 3 splitters, 10 LFOs, MPE-aware clip sequencer, 626 presets, $199→$249); Pigments v7 (6 engines/16 filters/20 FX/1,700+ presets); Massive X punished for no MPE; browser section: Ableton Learning Synths tech inspected (AudioWorklet preferred + ScriptProcessor fallback), **WAM 2.0 = MIT**, web-synth landscape + dittytoy cited.
- **T5** `research/engine/T5-web-audio-engine.md` — 52 KB / 19 entries, with **live local measurements on this machine** (HeadlessChrome 145): WASM SIMD resonator 10→98 µs/quantum (0.38–3.66% budget); SAB === undefined without COI; baseLatency 10 ms @48 kHz; alias floors (PolyBLEP vs naive: −55/−36/−26/−22 vs −47/−28/−18/−14 dBc); wavetable interpolation rms error (linear −35 / cubic −46 / sinc8 −63 dB). Voice budget tables at 1/3/8 GFLOP/s + the proof-benchmark protocol. Licences read from actual files: signalsmith MIT · Elementary MIT · dsp.js MIT · Soundpipe MIT · STK MIT-style · Faust compiler LGPL-2.1+ (metadata conflict logged) · WAM MIT (npm) · lamejs LGPL-3.0 → SKIP · SoundTouchJS MPL-2.0 · Tuna unlicensed.
- **T6** `research/multiuser/T6-multi-user-architecture.md` — 55 KB / 18 entries, scored tech table, P0–P3 phases, 9 owner decisions. **Recommendation: local-first + thin server** — P0 local profiles + share links + file I/O ($0, 4–7 days) → P1 **Cloudflare Workers + D1 + R2** (free tier, no pause; Supabase only as fast-MVP fallback) → P2 GitHub-as-backend + jsDelivr registry w/ CI validation (schema/licence/sha256/witness) → P3 **Yjs patch-design sessions** (no live audio; latency physics rules it out). Fairness-spine scoring: credits/metering marketplace models = reference-only.

- Parent spot-checks: `moddys.net/forge` → **X-Frame-Options: DENY confirmed** (Apache; embeds of /forge are blocked today → deep links are the integration path) ✓; xferrecords Serum 2 page live, '626' + '$249' present ✓; u-he zebra3 raw HTML is JS-rendered (child verified via alternate sources; parent grep inconclusive — flag).

## Wave 3 — deleg_3e4d9645 — T7 UI · T8 Packs · T9 Reuse — COMPLETE ✓ VERIFIED

- **T7** `research/ui/T7-ui-flair.md` — 55.6 KB / 20 entries. Case studies (Serum 2 ×3, Vital, Phase Plant, Pigments, Roland50, Learning Synths, FabFilter, Arturia, Valhalla, Elektron, TE, VCV, dittytoy + interaction corpus). Deliverables: 32-pattern steal-list table; 3 palettes with **WCAG ratios computed in-session** (Anvil Teal default; Copper Forge; Blacksite high-contrast); 7-screen inventory; first-run plan (famous-sound starters from T0); a11y gates; 12 anti-patterns with receipts; ranked top-10 flair moves. Bot-walled sources (KVR/Reddit/Gearspace/Arturia-support) handled via Wayback/snippets — flagged in-file.
- **T8** `research/packs/T8-content-packs.md` — 40 KB / 17 entries. Benchmarks (Serum 2 626+, Vital tiers, Pigments 1700+, Sylenth 2500+, ADSR/Splice economics, AKWF/WaveEdit conventions); **day-one lineup: 10 packs / 580 presets** with authoring order + size budgets; pipeline with PF citations + traps; licence table re-verified (AKWF LICENSE.md = CC0 1.0 + waiver; FreePats CC0-preferred); **CC0 one-way-door flagged as an owner decision**; community governance.
- **T9** `research/reuse/T9-pattern-forge-reuse.md` — 44.8 KB / 24 entries. Reuse map: PORT (build.py + guards, tap/buses, voice core, wavetables, tuning, MPE, performance layer, MIDI panel, kb, recorder/export, store, pack pipeline, knobs, deploy loop); ADAPT (desk frame, drums, share sanitizer, codegen-as-interchange); SKIP (Kody speech, FX visualisers). GAP list = the four new builds: worklet DSP engine · per-voice mod matrix · native sequencing + step UI · fuller FX/sampler. Summary table with effort S/M/L.
- Parent verification: counts match (20/17/24); all on disk at claimed sizes; T7 structure + palette math inspected; T8/T9 already deep-read (lineup/pipeline/reuse captured into 03). Quotes in T7 sourced under bot walls are flagged (snippet)/(Wayback) by the child — accepted as flagged.

**Package status: research COMPLETE; plan written** — `docs/00-idea-capture.md`, `01-design-doc.md`, `02-ui-design-brief.md`, `03-implementation-spec.md`, `04-agent-build-handoff.md`, `05-spec-review.md` (+ README). Awaiting owner decisions (05 §2).

## Running fold-in notes (for the plan)
- **Acid engine**: ship a mods-canon control set (accent sweep memory + separate normal/accent decay, filter tracking, overdrive ladder) + 909-derived shuffle; Open303 (MIT) as the clean-room DSP foundation; keep brand-clean (no Roland trade dress).
- **Osc/filters**: PolyBLEP + ADAA (from T1) + ZDF/TPT SVF + Moog-ladder family; oversampled drive section.
- **Sequencer**: step-object model w/ p-locks + probability/conditions + ratchets + micro-timing + Euclidean; three arrangement views (chain/song/scene); swing as a shared law with the arp.
- **Platform/multi-user**: input-parameter/share-state lessons from Dittytoy (URL-hash states, sliders) → our preset/patch sharing; MIT npm path only if we ever embed ditty-compat.
- **Delight items**: Roland50-style hardware click sounds; Dittytoy-style instant play.

## Synthesis map (which evidence feeds which deliverable)
- `docs/01-design-doc.md` — vision/name (T0/T1/T4), sound architecture (T1/T2/T5), sequencer (T3), community (T6), packs (T8), UI summary (T7), reuse & build path (T9).
- `docs/02-ui-design-brief.md` — T7 + platform lessons (T0/T1).
- `docs/03-implementation-spec.md` — T5 + T9 + house build discipline (lab→battery→deploy).
- `docs/04-agent-build-handoff.md` + `docs/05-spec-review.md` — synthesized from all waves.


## Owner decisions + Phase 0 kickoff — 2026-10-06 (same day)

- **Decisions recorded:** name **Anvil** · **free** (no monetisation) · **granular + sampler in v1** (phase plan revised: 03 §6, 04 §4; effort ≈10–14 part-time weeks) · phase order delegated and locked. Docs updated accordingly (00/01/03/04/05).
- **Folder renamed** `forge-synth` → `anvil` (a stale, empty `forge-synth` may linger until a Windows file-handle releases; delete at leisure).
- **Phase 0 started:** `build.py` ported (explicit js_parts · `</script` guard · strict `node --check` guard · sha identity); `src/{head.html,styles.css,body.html,app_core.js}` created (theme tokens per 02 §9 “Anvil Teal”); **index.html built — 6,853 B · sha256 2fc8e71862d20361add6f43500cc722618029217e3f8ff8bc2cfe9f7e47828e0**; first-light screenshot `renders/p0-shell.png` (Edge headless 1440×900, verified). Git repo initialized (main); commits: scaffold + build/shell.
- **Next:** master-tap port → knob framework → CDP harness + smoke → P1 worklet engine + **voice-count proof benchmark** (T5 §7).

## GitHub goldmine wave — dispatched 2026-10-06 (late)

Owner ask: "other GitHub resources in this field… scrape for more features / useability / upgrades / plugins / modules / improvements."
Dispatched 3 scout tasks → `research/github/`:
- G1 — DSP engines & libraries to study/port (Mutable Instruments eurorack/stmlib, Airwindows, ChowDSP, fundsp, DPF/DISTRHO, …)
- G2 — web-audio ecosystem (awesome-web-audio, WAM plugin index, socalabs, UI/widget libs, encoders, analysis, soundfont players)
- G3 — OSS synth feature catalogs as design specs (Vaporizer2, Helm, OB-Xd, Dexed, Cardinal/VCV taxonomy, Stochas/seq66 sequencers)
Folding plan: parent-verify → `docs/06-github-goldmine.md` + implementation-spec updates.

## GitHub goldmine wave — COMPLETE ✓ VERIFIED (2026-10-07 ~00:26)

- Files: `research/github/G1` (18 entries, 50.5 KB) · `G2` (20, 34.9 KB) · `G3` (17 + 80-row feature menu, 63.7 KB). Counts match self-reports.
- Parent spot-checks: Airwindows MIT ✓ · SpessaSynth Apache-2.0 ✓ · Vaporizer2 GPL-3.0 ✓ · eurorack README live (per-file split child-verified, audit required before any port) · Dexed msfa path flagged.
- Folded into `docs/06-github-goldmine.md` (headlines + v1×16 item list + adopt-lib shortlist) + 03 §8 pointer. Ranked menu: v1×16 / v1.x×41 / later×22.
