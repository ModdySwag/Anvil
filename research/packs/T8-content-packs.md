# T8 — Factory content & soundware strategy
**Topic:** benchmarks, day-one pack lineup, authoring + verification pipeline, licensing application, pack metadata/UX.
**Date:** 2026-10-06 · **For:** Anvil (working folder `C:\Users\Moddy\anvil`, research phase).
**Scope note:** packs here = *preset/kit/wavetable packs for our own synth engine* (Anvil, browser-first, engine modules seeded per T0: PolyBLEP VA, 303 acid voice, SVF/ZDF filters, Karplus strings, formant-saw ensemble, additive drone, synthesised drums, FX rack, tunings). Sample-based content enters only as CC0 wavetable/percussion bases, never as the primary product.

**Builds on (cite, not redo):**
- `C:\Users\Moddy\pattern-forge\annex\05-sound-pack-pipeline.md` — PF pack pipeline: formats, IndexedDB install, size budgets (5–15 MB leaf / 20 MB cap / 40 MB GM bundle), immutable caching + CORS `.htaccess` rules, verified CC0 sources, the IDB quota/`file://` traps.
- `C:\Users\Moddy\pattern-forge\annex\02-surge-content-formats-licensing.md` — Surge XT asset taxonomy (patch/FX/modulator presets, wavetables, tunings, skins), Patch Tag Data Model, browser UX, factory counts (640 `.fxp`, 202 wavetable entries), GPL reading + the Voxengo blocker.
- `C:\Users\Moddy\pattern-forge\CONTINUATION-2026-09-25.md` — the *proven* PF witness pipeline: `verify_packs.mjs` v4 (apply→play→**tap**), IDB installer (`src/app_store.js`, `pf-packs-store`), the two recorded traps (own AnalyserNode; blend routing), builder byte-copy/verified-reset rule, `WT-BANK` witness, deploy byte-diff + live CORS tests. PF store is live with **95 packs / 1854 patterns / 8 synth banks** at the time of that log.
- `C:\Users\Moddy\moddys-music-suite\ULTIMATE-PLAN.md` **§5 licensing rulebook** + **Program B (The Foundry)** — Tier A static / Tier B audio-render / Tier C live verification; B6 store governance (CC0-only + immutability + required metadata + credit-in-filename); C2 SynthHub registry v2 (synths + content, manifest-driven submit/install, drop-in third-party section).
- `C:\Users\Moddy\moddys-music-suite\research\ecosystem\E2-open-content-licensing.md` — verified source list (VSCO2 CE CC0, FreePats CC0, AKWF CC0, FluidR3 MIT, Iowa MIS; conversion tooling; `(verify)` discipline).

**Method for this pass:** primary pages fetched directly (marked *[fetched]*); where a fetch backend was rate-limited (exa 429s mid-pass) facts come from the search-engine result of the primary page and are marked *[snippet]*; licence texts re-verified verbatim via `curl` where possible. ≤3 attempts per URL. Dead ends logged at the end.

---

## A. BENCHMARKS — what the flagship market actually ships

### 1. Serum 2 — factory scale, artist credits, and the pack marketplace
- Links: https://www.xferrecords.com/products/serum-2 *[fetched]* · https://static.xferrecords.com/Serum%202%20What%27s%20New.pdf *[fetched]* · https://splice.com/sounds/presets/serum-2 *[snippet]*
- Core contribution: the category leader's factory-content bar and how credits/demos are used as marketing.
- KEY FACTS:
  - Official spec line, verbatim: **"Serum comes with over 626 presets, 288 wavetables."**
  - The "What's New" PDF names **30+ credited factory preset designers** (@mrbillstunes, Level 8, 7 SKIES, Databroth, NEST Acoustics, Splice, …); factory wavetables/samples credited to **Splice, Steve Duda, Virtual Riot, ill.gates, Sharooz, Drumsound & Bassline Smith**; factory multisamples to named recordists.
  - **8 macros** on Serum 2 ("Eight macros, with each as a potential destination") — macro-per-preset is the market norm (see entry 7).
  - Artist packs are sold as first-class products: featured pack examples on the official page at **$29.95–$32.00** with genre tags; presets are also sold **individually** on Splice ("Download individual presets, not just packs", "3 credits" each).
  - Browser: "Categories/Tags" filter presets; audio demo per pack.
- **Fold-in verdict: ADOPT** — hit a ~500–700 preset factory total for launch credibility (626+ is the bar); credit every pack author by name in the pack card and preset metadata; ship 8 user macros on every preset; factory browser ships with category + tag filters from day one.

### 2. Vital — tiered factory content as a product ladder (and a hard licence line)
- Links: https://vital.audio/ *[fetched]* · https://forum.vital.audio/t/number-of-presets-and-waveforms-in-vital-plus/5164 *[snippet]* · https://github.com/mtytel/vital (README) [licence quote via E2 #14]
- Core contribution: content tiers = pricing tiers, from the synth whose visual language seeded ours.
- KEY FACTS:
  - Official tiers: **Basic (free): "75 presets", "25 wavetables"** · **Plus: "250 presets", "70 wavetables"** · **Pro: "400+ presets", "150 wavetables"** + "Additional skins" + unlimited text-to-wavetable.
  - Factory presets are curated by **named sound designers**; the forum thread shows the real installed base is a mix of factory + designer banks (~235 total for Plus vs the advertised 250), and that a misnamed bank folder ("Factory Presets" vs "Presets") hides content — **content-bank folder conventions are load-bearing**.
  - Licence, verbatim (README, re-quoted from E2 #14): **"Do not distribute the presets that come with the free version of Vital. They're under a separate license that does not allow redistribution."**
- **Fold-in verdict: ADOPT (model) / DO-NOT-SHIP (content)** — our free starter content + expansion ladder mirrors the suite doctrine ("free to start, open spine, paid polish"); every Anvil factory preset is own-authored (clean-room from the T0 math cards), so no Vital-derived material ever enters our packs.

### 3. Arturia Pigments — the "1700+ library + Sound Store expansions" model
- Links: https://www.arturia.com/products/software-instruments/pigments/overview *[fetched via curl]* · https://www.arturia.com/products/software-instruments/pigments/free *[snippet]*
- Core contribution: the template for a big tagged factory library plus a post-launch expansion cadence.
- KEY FACTS:
  - Verbatim: **"over 1700 instantly-rewarding presets … Expandable with the sound store."**
  - **Pigments Play (free) = 100 presets** (official comparison table: Presets 100 vs 1700+; engines/filters/FX unlocked, editing limited).
  - Expansion cadence example, verbatim: **"Pigments 7 introduces Explorations Volume 5: three new expansions … each one offers 150 presets crafted for immediacy, expression, and mix-ready impact."**
  - Browser filters by "Types / Styles / Banks"; factory content split keys/basses/leads/pads/sequences.
- **Fold-in verdict: ADOPT** — (a) launch with a big, tagged factory library; (b) promise a seasonal expansion line (~100–150 presets per drop) as the post-day-one content program; (c) keep a free tier meaningfully stocked — our STARTER 100 is that tier.

### 4. Kilohearts Phase Plant — cadence + the best-documented preset-browser conventions
- Links: https://kilohearts.com/docs/presets *[fetched]* · https://rekkerd.org/kilohearts-updates-phase-plant-synth-to-v2-1-4-incl-200-new-factory-presets/ *[snippet]* · https://www.musicradar.com/reviews/kilohearts-phase-plant *[snippet]*
- Core contribution: browser mechanics we should copy 1:1, and a content-growth schedule to imitate.
- KEY FACTS:
  - Counts: 2019 review "**300+ presets**"; Dec-2023 update added "**over 200 new factory presets**" — "new go-to 'staple' presets" + "**a handful of straightforward patches, tagged #basic, that offer common synth sounds for easy adaptation and reverse-engineering**"; a user count (Dec 2023) found **862**. Official docs say only: "Some plugins have a very small number, others have hundreds and hundreds." (per-plugin totals are not published).
  - Browser conventions (docs, verbatim fragments): "**Favorites** starts out empty but will be filled with any presets you favorite by clicking their heart icon. **Factory** contains the presets shipped with the plugins, categorized in subfolders… The **User** folder is the default location for saving your own presets… **Add Location**."
  - Search: "free text search of all preset information: **name, description, and author**"; `by:Author Name` operator; "Any '#' characters in the preset descriptions will be interpreted as **tags**… searchable like this: '#tag'".
  - Right-click a preset → "**set the default preset for the plugin** … all new instances start with the specified preset automatically loaded." "**the New button clears the current patch**."
- **Fold-in verdict: ADOPT** — favourites heart, factory/user/add-location sources, name+author+description search, `#tag` vocabulary, set-default-preset, and New=init; add a `#basic` template bank at launch (see entry 11).

### 5. Spectrasonics Omnisphere 3 — the taxonomy benchmark (41k sounds, patch vs soundsource vs multi)
- Links: https://www.spectrasonics.net/products/omnisphere/library.php *[fetched]* · https://www.spectrasonics.net/products/omnisphere/overview.php *[snippet]*
- Core contribution: how the largest commercial soundware library separates *content types* and curates collections; calibrates "content as value" at the extreme.
- KEY FACTS:
  - Library page, verbatim: **"Total Sounds: 41,405"** = 26,421 new-library patches + 9,242 legacy patches + **5,590 soundsources** + **152 multis**.
  - Libraries are curated *by use type* (Electronic Underground, Ambient Dreams, Club Land, Scoring Electronic, Warm Tones…), not just instrument family; v3 adds "**Patch Mutations**" that "instantly create fascinating and useful variations of any patch".
  - Three separate browsers (Multis / Patches / Soundsources) — content type is a top-level navigation axis.
- **Fold-in verdict: REFERENCE** — adopt the *shape*: presets vs **sources** (wavetables/tunings/samples) vs **kits/multis** as separate browsable types with their own counts; "curated collection" naming for packs; steal mutation-style "variations" as a free UX win; do not chase 41k.

### 6. Sylenth1 — bank engineering: 512-cap banks, default bank, honest previews
- Links: https://www.lennardigital.com/sylenth1/specs.php *[fetched]* · https://www.lennardigital.com/support/soundbanks.php *[snippet, page text]* · https://www.lennardigital.com/home/oldnews4.php *[snippet]*
- Core contribution: proof that "small synth + huge preset bank" sells, with concrete bank engineering for our store.
- KEY FACTS:
  - Official specs, verbatim: **"2500+ presets."**
  - "**Each soundbank in Sylenth1 contains up to 512 presets divided over 4 sub-banks of 128 presets each.**" · "**Sylenth1 loads FactoryBank1.fxb by default at start-up**" (changeable via `Settings.xml` `DefaultBank`).
  - Demo version is "**Limited to 128 presets**" (content-cripple as the freemium lever).
  - Soundbank releases are marketed by named producers; previews are stated to be "**100% Sylenth1, 192kbps mp3 and have not been processed in any way**" — i.e. previews rendered by the synth itself, honestly labelled.
- **Fold-in verdict: ADOPT** — packs behave like banks with a hard per-bank cap and sub-bank pagination (128/page); an explicit default bank/preset on first run; previews rendered by our engine only, labelled "100% Anvil, no post-processing".

### 7. Marketplace anatomy I — ADSR: the pack-page checklist
- Links: https://www.adsrsounds.com/product/presets/surge-sounds-future-bass-starter-pack-serum-presets *[snippet]* · https://www.adsrsounds.com/synth/serum-presets *[snippet]*
- Core contribution: the listing anatomy our store cards should mirror field-for-field.
- KEY FACTS (from a live pack page):
  - Fields present: label + **genre tags** + **format tags** ("Serum Presets ALSO INCLUDES Construction Kits MIDI Files STEMS WAV Samples and Loops"), **price** ($12), a **contents breakdown** ("32 Xfer Serum Presets → 6 Synths, 5 Pads, 4 Basses, 4 Plucks, 3 Leads, 3 Guitars…"), "**4 Macros on every preset**", a **compatibility line** ("Required Xfer Serum Version 1.322 or higher"), **totals** ("146 files", "622 MB"), an **audio demo player**.
  - Site mechanics: per-synth hubs sorted by price/date, weekly bundles ("15 SERUM PACKS FOR $30"), loyalty/free-credit programs, free-sound samples as lead-gen.
- **Fold-in verdict: ADOPT** — every Anvil pack card carries: count, per-type breakdown, macro count, version compatibility, size, licence/attribution, demo audio, tags. Bundles for events; free taster packs as the funnel.

### 8. Marketplace anatomy II — Splice: credits, per-preset sale, tag rows, filename pattern
- Links: https://splice.com/plans *[snippet]* · https://splice.com/sounds *[snippet]* · https://splice.com/sounds/presets/serum-2 *[snippet]*
- Core contribution: the dominant marketplace's mechanics and its observed pack/tag/naming conventions.
- KEY FACTS:
  - Credit mechanics, verbatim: "**All samples are one credit each. MIDI patterns and presets use up to three credits each.**" Credits roll over; downloads are keep-forever; everything "**100% royalty-free**".
  - Plans: Sounds+ / Creator / Creator+ ≈ $12.99 / $19.99 / $39.99 per month with 100/200/500 monthly credits *[snippet via DJTechReviews review; splice.com/plans confirmed the credit rules but rendered prices inconsistently — flag as approximate]*.
  - Observed conventions on the Serum 2 presets page: files named **`VOX_MDTH_bass_synth_flukey.SerumPreset`** (VENDOR_PACKABBR_TYPE_descriptor), tag rows like "synth bass techno tech house pop minimal techno melodic techno", per-item preview play buttons, "Add to your Library (3 credits)", **random sort** alongside most popular/recent.
- **Fold-in verdict: REFERENCE (mechanics) + ADOPT (conventions)** — our store stays free/static (no credits), but copy: per-item previews, dense tag rows, the `PKG_TYPE_descriptor` naming pattern, and a sort mode that includes **random**.

### 9. Wavetable pack conventions — AKWF (600-sample cycles), WaveEdit (64×256 banks), Serum/Vital (2048 frames)
- Links: https://github.com/KristofferKarlAxelEkstrand/AKWF-FREE (+ `LICENSE.md`) *[fetched: API listing + raw licence + site via curl]* · https://www.adventurekid.se/akrt/waveforms/adventure-kid-waveforms/ *[fetched via curl]* · https://github.com/smpldsnds/wavedit-online *[fetched]* · https://gist.github.com/iicaras/f63dc9fcc3f9a83ccaf2de3fbc9fbb5a *[snippet]* · Serum Synthesizer Manual (mirror) *[snippet]*
- Core contribution: the three container conventions our wavetable packs must speak.
- KEY FACTS:
  - **AKWF**: "The download contains 4300 single cycle wave forms" (collection listing); core waves are "**600 samples long**", 16-bit, 44.1 kHz, mono; repo `LICENSE.md` = the full **CC0 1.0 Universal** legal text; site dedication, verbatim: "**To the extent possible under law, Kristoffer Ekstrand has waived all copyright and related or neighboring rights to AKWF Waveforms.**" · PF's annex/05 measured a subset: 65 families × ~50 waves, **1,344 B/WAV, ≈4.2 MB total** → the whole collection is ≈5.8 MB of WAV.
  - **WaveEdit Online** (mirror, CC0): "All wavetables here are under CC0 1.0 Universal (CC0 1.0) Public Domain Dedication." · "**Each bank in memory consists of 64 wavetables, in an 8x8 array using 256 fixed-sample-length tables**" (i.e. a bank file = 16,384 samples = 64 × 256).
  - **Serum/Vital (the modern default)**: Serum "wavetables … consist of up to **256 sub-tables**" each "**2048 samples**" (Serum manual); CLM chunk ASCII `<!>2048 01000000 wavetable (www.xferrecords.com)` marks the standard; Vital "always assumes a wave size of **2048 samples** when importing"; Vital export writes "**256 cycles, each resampled to 2048 samples**" + CLM interpolation mode 2, 16-bit, header rate 88200.
- **Fold-in verdict: ADOPT** — author our wavetable packs as **multi-table banks** (PF precedent: `forge-mathwaves-vol1` = 8 tables × 64 frames × 512 samples; WaveEdit shape = 64 × 256); accept AKWF 600-sample cycles on import; emit the **2048/clm convention on export** so our tables round-trip into Serum/Vital (and note the `clm ` chunk is already a planned export door in the suite, ULTIMATE-PLAN D1/A11).

### 10. Drum pack conventions — physical formats, naming, and why a synth drum pack skips the sampler
- Links: https://sounds.loopcloud.com/product/13497-element-techno *[snippet]* · https://www.audiolancer.io/articles/how-to-make-a-sample-pack-10-steps-for-creating-pro-quality-sounds-producers-love *[snippet]* · https://gravitascreate.com/how-to-make-a-sample-pack *[snippet]*
- Core contribution: buyer expectations for drum content; the licence escape hatch when drums are synthesised.
- KEY FACTS:
  - Format spec, verbatim (Loopcloud pack page): "**All these sounds are downloadable in HD WAV at 44.1kHz and 24bit and are all tempo labelled**". Pack pages classify by element counts ("Drum 151 · Synth 132 · Bass 54 · Effects 48 · Cymbal 44 · Pluck 39…"); loops carry **BPM + key** filters.
  - Naming conventions: "Kick_120BPM.wav, Pad_Amin_120BPM.wav" (guide); "The most commonly used filename labels are **musical key, bpm, sample type, and pack name or pack name abbreviation**. If you plan to sell … through distributors such as Splice, your sample pack will need to follow certain industry-standard file naming guidelines." (Gravitas Create).
  - One-shots vs loops split is universal; count-based pack badges are how stores surface value.
- **Fold-in verdict: ADOPT (conventions) / SKIP (sampled drums)** — TECHNO FOUNDRY ships **synthesised kits + sequencer patterns** (zero sample clearance); any one-shot exports follow 44.1 kHz/24-bit/mono naming conventions; label pattern tempo & key; pack cards show element counts.

### 11. Init patch + template norms — what "INIT" must mean in our browser
- Links: https://moogmusic-help.freshdesk.com/en/support/solutions/articles/69000876144-moog-initial-patch-templates-for-synths-with-digital-presets *[snippet]* · https://ask.video/article/apple/the-building-blocks-of-logics-es2-synth *[snippet]* · https://www.productionmusiclive.com/blogs/news/117066309-massive-sound-design-our-init-preset-patch *[snippet]* · Kilohearts docs (entry 4)
- Core contribution: what to ship as the reset/default/first-run surface.
- KEY FACTS:
  - Standard init semantics (community definition, verbatim): "An init patch usually has **the filter fully open with no filter envelope and the amp envelope with full sustain, no attack, decay or release**."
  - Logic Pro ships "Tutorial Settings" including "**Analog Saw Init**" — "essentially 'zeroes' the ES2 … sets you up with a basic sawtooth patch that you can build from"; NI Massive distinguishes "**No Preset Loaded**" (host default) vs "**Untitled Sound**" (menu reset) — players get confused by the gap, so name it explicitly.
  - Hardware norm: boot = bank1/prog1 or last patch, plus an explicit INIT command; Kilohearts: "New" clears the patch and a per-plugin **default preset** loads in new instances.
- **Fold-in verdict: ADOPT** — the factory store ships: (1) **INIT** (true zero: filter open, amp ADSR neutral, no FX), (2) a **quick-start template set** ("Basic Saw / Basic Pad / Basic Bass / Basic Drum / Basic FX" — the Phase Plant `#basic` analogue), (3) "New Patch" always returns to INIT, (4) a set-default-preset mechanism, (5) STARTER 100's first tutorial links to INIT so "learn from zero" is a first-class path.

---

## B. DAY-ONE LINEUP — 10 packs

### 12. The table (this is the deliverable's core)
**Targets:** 10 packs · **580 presets total** · every engine module covered ≥2× · all packs ship at launch ("fully featured from the start") but are authored in the order at the bottom.

| # | Pack | One-liner | Presets | Engine coverage | Authoring plan | Licence lane | Verify tier |
|---|------|-----------|--------:|----------------|----------------|-------------|-------------|
| 1 | **STARTER 100** | Tutorial-linked tour: every module at its simplest, named for what it teaches | 100 | ALL (VA, acid, Karplus, ensemble, additive, drums, FX, WT, tuning) | Own-authored; template+variation method; first pack built (doubles as the engine's smoke-test corpus) | Own-authored → CC0 | A+B (+C) |
| 2 | **ACID VAULT** | 303 lines: basses, squelch leads, rave stabs, sequencer patterns | 64 | 303 acid voice, PolyBLEP osc, SVF, ping-pong echo, accents/slides | Own-authored, clean-room from T0/DT303 math card; pattern per bassline | Own-authored → CC0 | A+B |
| 3 | **TECHNO FOUNDRY** | Synthesised drum kits + patterns (kick/SVF, snare, hats, perc) | 64 kit/pattern presets | Drum synth, compressor, shared filters, allpass reverb | Own-authored drum engine patches + 32 patterns; PF pattern-pack machinery reused | Own-authored → CC0 | A+B |
| 4 | **NEON STRINGS** | Karplus/plucked strings: nylon, koto, prepared, glass | 48 | Karplus module, pluck-position comb, allpass reverb, humanisation | Own-authored; some presets pair Karplus with WT tables | Own-authored → CC0 | A+B |
| 5 | **BLADE PADS** | Ensemble pads: formant-saw, wide unison, slow swells | 56 | Formant-saw ensemble, chorus/detune, reverb | Own-authored; single-synth-many-voices design law from T0 | Own-authored → CC0 | A+B |
| 6 | **DEEP SPACE** | Drones/additive: morph tables, spectral beds, sci-fi textures | 40 | Additive MorphWave crossfade, per-op detune, sub | Generator-assisted (mathwaves precedent: small gen script + SELFCHECK) + hand polish | Own-authored → CC0 | A+B |
| 7 | **BASS FORGE** | Subs, reeses, FM/VA hybrids, acid crossovers | 64 | VA + sub + filter env + drive + acid voice | Own-authored | Own-authored → CC0 | A+B |
| 8 | **LEAD LAB** | Unison leads, supersaws, FM/PD leads, expressive solos | 64 | PolyBLEP VA, unison, FX rack, macros | Own-authored | Own-authored → CC0 | A+B |
| 9 | **FX & RISERS** | Sweeps, impacts, downlifters, noise-art, transitions | 48 | Noise sources, filter sweeps, delays, reverb, pitch env | Own-authored | Own-authored → CC0 | A+B |
| 10 | **PERFECT TUNINGS** | Microtuning showcase: 12 authored scales × 2–3 presets each | 32 | Tuning engine (SCL/KBM + MTS), bells/drones/plucks tuned justly | Own-authored `.scl` collections (own math, no archive files) + presets | Own-authored → CC0 | A+B |

**Authoring order (launch push):** Phase 1 = STARTER 100 + ACID VAULT + TECHNO FOUNDRY (fastest to witness; STARTER also seeds the verifier corpus) → Phase 2 = NEON STRINGS, BLADE PADS, DEEP SPACE → Phase 3 = BASS FORGE, LEAD LAB, FX & RISERS → Phase 4 = PERFECT TUNINGS (after the tuning engine passes Tier B on MTS/SCL).
**Engine coverage check:** each of the 9 engine modules appears in ≥2 packs; 100% coverage in STARTER 100.
**Cross-pack rules:** every preset gets 8 macros (entry 1 convention), a description with `#tags` (entry 4), an `author_license` field (entry 9/14), and a preview render (entry 15).

### 13. Aggregate math & size budgets (why 580)
- **Calibration:** Serum 2 = 626+ · Phase Plant ≈ 300→862 · Pigments = 1700+ (free tier 100) · Vital = 75→400+ · Sylenth1 = 2500+ (see entries 1–6). **580 day-one presets** lands inside the "credible flagship" band, ≈10× Vital's free tier, ≈⅓ of Pigments, and 10× the minimum viable free tier.
- **File-size reality (measured in PF):** preset-only banks are **6–8 KB each** and the whole 95-pack PF index is **54,945 B** — 10 preset packs of 580 presets ≈ **<250 KB total** excluding audio. So size budgets bite only on wavetable/sample content: annex/05 rules apply — wavetable pack ≈ **0.7 MB per 512 AKWF waves** (1,344 B/WAV) or **100–400 KB per 64-frame computed bank**; sampled leaf packs **5–15 MB typical, warn >12 MB, hard cap 20 MB**.
- **Free-tier stance:** the entire factory ships free (open spine doctrine; ULTIMATE-PLAN B1 "free; monetization is an owner decision"). The credit/marketplace mechanics in entries 7–8 are *reference* for a future paid expansion line, not day-one behaviour.
- **Authoring cost note (estimate):** 580 presets at 20–60 min each ≈ **190–580 h**; the STARTER/template method and generator-assisted packs (DEEP SPACE) are the compressors — sequence accordingly.

---

## C. PIPELINE — the PF-proven flow, applied to Anvil

### 14. Author → witness → preview → manifest → host → install (steps with PF citations)
1. **Author gate (Tier A).** Pretty JSON sources in `harvest/`-style workspace; builder (`build_synth_packs.mjs` analogue) validates schema + ranges + naming, then byte-copies sources to deploy files. **Rule (paid for once in PF): any byte change resets `verified` for the whole affected set — builder → re-verify `--only … --no-stamp` → stamp.** [CONTINUATION: 768–771]
2. **Licence lint (same gate).** Every pack/file resolves to a provenance DB entry (source, licence string, author, retrieval date, sha256); licence + attribution non-empty or the build fails (E2 pipeline step 6c; ULTIMATE-PLAN D2).
3. **Engine witness (Tier B) — apply→play→tap.** Reuse `verify_packs.mjs` v4: each preset is applied through the app's **own load path**, played, and measured on the engine's master tap; factory voices run first as a **calibration canary**; per-preset peaks must clear the floor (PF: `PATCH_PEAK_MIN 20` on the 0–255 byte scale; healthy presets read **212–255**). [CONTINUATION: 748–763]
   - **Trap 1 (mandatory): the verifier owns its AnalyserNode on the master tap.** `pf.eqBands`-style panel reads are not witnesses (they reflect UI paint that never runs headless). The tap may only exist once something first reads `ctx.destination`.
   - **Trap 2 (mandatory): route rule.** Synth audio routes into the master tap only on the synth blend — the measurement must switch the mix to synth and restore after.
4. **Wavetable-bank witness (Tier B, WT packs).** Pattern: `ensure via app` import test (**PF result: "8 imported · 0 failed"**) → per-patch tap witness on the bank (**8/8**) → `WT-BANK PASSED`. **Trap 3: wt witnesses are table-aware, not peak-aware** — a peak-normalised duplicate table must FAIL (PF's negative control). [CONTINUATION: 950, 967, 1746]
5. **Preview render (Tier B+).** Offline render per preset via the engine's own graph in headless Chromium — see entry 15 for conventions.
6. **Manifest + stamp.** Pack file = zip/json w/ id, version, licence, provenance, per-file sha256, witness report; targeted **stamp** merges only fresh ids into `index.json` + `compat.json` (a full stamp rerun is hours — don't). [CONTINUATION: 751]
7. **Host (static store).** `packs/`-style store with `index.json` `no-store`; pack files **immutable** (`Cache-Control "public, max-age=31536000, immutable"`), **`Access-Control-Allow-Origin "*"`**, `no-gzip` on pack zips, correct `AddType`s (annex/05 §3 verbatim rules). Deploy = byte-diff decides the set → upload → **re-download + `cmp` all IN-SYNC** → live tests (CORS on packs, store counts, fetch+parse a bank from the live origin).
8. **Client install (IDB).** fetch → `crypto.subtle.digest('SHA-256')` vs manifest → write to **IndexedDB** (`idb|ls|mem` backends) → hydrate/register at boot; **proven offline** (host down → reload → packs still load); honest `{ok:false,error:'quota'}` on refusal, never a fake "installed" toast; `persist()` on first install + boot repair pass (re-hash, re-download on mismatch). **Constraints:** Firefox blocks localStorage+IDB on `file://` → every pack must also play from RAM in-session with an honest **mode chip**; OPFS throws on `file://` — don't build on it. [annex/05 §3; CONTINUATION: 740–744]
- **Fold-in verdict: ADOPT wholesale** — Anvil uses the same chain (author gate → witness → stamp → byte-diff deploy → live tests → IDB install). Nothing ships without its witness report, per the suite law.

### 15. Preview audio, naming, tags, browsing UX (conventions to fix now)
- **Preview render convention (proposal, built on annex/05 encoding rules):** per-preset preview = deterministic offline render of the engine graph (`OfflineAudioContext`), 44.1 kHz stereo, tail-safe; **peak-normalise to −1 dBTP, then loudness-normalise to −14 LUFS integrated** (matches streaming normalisation so store demos don't lie about level); encode **Ogg Vorbis q4 + an `m4a`/AAC sibling** picked by `canPlayType` (annex/05: Safari <18.4 can't decode Ogg); per-preset 8–15 s, per-pack 60–90 s medley demo. Label like Sylenth: rendered by the synth only, no post-processing.
- **Preset naming convention:** `PKG_TYPE_descriptor` — e.g. `ACV_BS_303_rasp`, `NST_PL_nylon_rain`, `BDP_PD_blade_wide`. Type codes: `BS` bass, `LD` lead, `PD` pad, `PL` pluck/string, `KY` keys/bell, `SQ` sequence/arp, `DR` drum/kit, `FX` effect/riser, `TP` tuning showcase, `WT` wavetable-led. Pack-id prefix always (also the B6 "credit-in-filename" idiom ⇒ `pack_id__preset_id` in the manifest). Precedent: Splice file pattern `VOX_MDTH_bass_synth_flukey.SerumPreset`; ADSR compatibility/version fields.
- **Tag taxonomy (3 layers):**
  1. **Structured (Surge Patch Tag Data Model, annex/02):** `category` (one, prescribed) · `sub-category` (free, e.g. EP, FM) · `features` (Layered, Split, Sequenced, MPE) · `character` (Analog, Cinematic…) · `author_collection` · `author_url` · `author_license` (SPDX) · `user_tag` (free).
  2. **`#tags` in descriptions** (Kilohearts convention — searchable as `#tag`).
  3. **Genre/style tags** at store level (Splice-style tag rows; ADSR genre taxonomy).
- **Browse UX:** heart favourites as a flat cross-cutting list; search over name/description/author + `AUTHOR=`/`CAT=` operators; **random patch** (mid-click/button); A/B compare; sort modes incl. random; "New"=INIT; set-default-preset; factory/user/third-party source split (annex/02 §3; Kilohearts docs; Splice).
- **Init/template design:** per entry 11.
- **Fold-in verdict: ADOPT** — these are cheap now and expensive to retrofit (metadata is content; the PF rebuild paid for this lesson).

---

## D. LICENSING APPLICATION

### 16. Per-pack table + verified texts
**Default lane = own-authored (clean-room) → the safest possible provenance.** T0 verdict stands: ditty code is CC BY-NC-SA (non-commercial + share-alike — incompatible); the *techniques* (PolyBLEP, KS, SVF, allpass) are published literature and are re-implemented clean-room.

| Pack | Licence lane | External base (if any) | Attribution duty | Notes |
|---|---|---|---|---|
| STARTER 100 | Own-authored → CC0 | — | none | Pure engine content |
| ACID VAULT | Own-authored → CC0 | — | none | Clean-room 303 from T0 math card |
| TECHNO FOUNDRY | Own-authored → CC0 | — (synthesised drums) | none | If one-shots ever sampled: CC0 sources only |
| NEON STRINGS | Own-authored → CC0 | — | none | Karplus is DSP math |
| BLADE PADS | Own-authored → CC0 | — | none | Formant-saw math from T0 |
| DEEP SPACE | Own-authored → CC0 | — | none | Generated tables (mathwaves precedent, self-generated CC0) |
| BASS FORGE | Own-authored → CC0 | — | none | — |
| LEAD LAB | Own-authored → CC0 | — | none | — |
| FX & RISERS | Own-authored → CC0 | — | none | — |
| PERFECT TUNINGS | Own-authored → CC0 | — | none | Own `.scl` collections; **no** Huygens-Fokker archive files |
| *(optional WT add-ons)* | CC0 | AKWF (CC0), WaveEdit Online mirror (CC0), computed tables | none | Ship as table packs feeding any preset pack |

**Verified licence texts (verbatim this pass unless noted):**
- **AKWF** — repo `LICENSE.md` begins: `CC0 1.0 Universal` / `Statement of Purpose` (full standard CC0 text; GitHub licence ID `CC0-1.0`). Site: *"To the extent possible under law, Kristoffer Ekstrand has waived all copyright and related or neighboring rights to AKWF Waveforms."* → CC0, commercial OK, no attribution required (credit courteously).
- **WaveEdit Online mirror** — README: *"All wavetables here are under CC0 1.0 Universal (CC0 1.0) Public Domain Dedication."* (service dead since 2025-02; the repo is the surviving copy — E2 dead-end #1).
- **FreePats** — licences page: *"FreePats currently prefers Creative Commons CC0, please use it for your new contributions."* CC0 1.0 is described as *"Worldwide public domain dedication. Easy to use. It allows everything."*; per-instrument pages carry their own licence (CC0 preferred; CC BY 3.0/4.0 also accepted — E2 #1). GPL+exception is *"deprecated and it won't be accepted anymore"*.
- **VSCO 2 CE** — CC0 (E2 #5: *"Creative Commons 0 (i.e. public domain) license"*). **Iowa MIS** — *"may be downloaded and used for any projects, without restrictions"* (E2 #6). **Freesound** — CC0 filter only, per-sound manifest (E2 #8).
- **DO-NOT-SHIP (quotes):** Vital factory: *"Do not distribute the presets that come with the free version of Vital…"* · Surge XT factory content (patches/wavetables/**tunings**): no content carve-out, repo GPL-3.0 default → treat as GPL; the FAQ only grants freedom to *use* it in music, not redistribute files (annex/02 §1; E2 #13; ULTIMATE-PLAN §5) · DX7 cartridges *"no known authors or terms"* (E2 #12) · DecentSampler: *"You may not redistribute any of the samples or sample libraries on their own…"* (E2 #10) · Scala archive: no licence statement → permission needed; author our own (E2 #18) · dittytoy: CC BY-NC-SA 4.0 (T0 §2) · Voxengo impulses: *"You may not sell these impulse files or earn any direct or indirect profit from their distribution"* (annex/02 §1) — irrelevant unless we ever use impulses. 
- **OPEN DECISION — CC0 is a one-way door.** Releasing factory packs as CC0 means anyone may redistribute/resell the content forever (consistent with the "open spine" doctrine and padthv1 governance). Alternative: "free download, all-rights-reserved" keeps later monetisation optional but blocks community remixing. Recommend: CC0 for STARTER/tutorial/community-adjacent packs; owner call for the flagship sound packs (decide before first release — not after).

---

## E. COMMUNITY PACKS & LISTING

### 17. Submission governance, install safety (data-not-code), SynthHub registry v2
- **Governance (adopt the suite's verified templates):** CC0-only + immutability + required author/license metadata (padthv1-preset model, S1); submission must carry *"clear CC0 or equivalent licence provided from the sample author"* — Shortcircuit XT policy rejects *"statements like 'They said its ok' or 'I've had these on my HDD forever'"* (E2 #15). Per-file provenance (`source URL, licence, author, retrieval date, sha256`) in a `sources.lock`-style DB (E2 pipeline).
- **Install safety — packs are DATA, never code:** a pack contains only JSON presets + wavetable/sample binaries. No JS, no eval, no remote module loading. Enforce: strict JSON-schema validation at **submit and at install** (unknown fields/engine-module ids rejected; frame counts must be power-of-2 within engine limits); per-file sha256 verified in-browser before IndexedDB write; content-addressed, immutable pack files; size caps (annex/05 budgets); the same licence-lint+audio-witness gate as factory packs; a revoke/tombstone list (immutability vs takedown needs its own mechanism — **open decision**).
- **SynthHub registry v2 listing (from ULTIMATE-PLAN C2/B6 + C1):** SynthHub grows from the synth catalogue (today: "Behringer synth control in your browser" at moddys.net/synthhub) into "the suite's registry — synths *and* content packs, with the install/discovery mechanics… (drop-in folders, manifests, third-party sections)". Manifest-driven submit/install; suite index JSON with **stable IDs** read by all apps; pack cards show id/version/licence/attribution/sha256/witness chip; **"third-party" section conventions** and the credit-in-filename idiom; moderation funnel = PR/forum (padthv1 style).
- **Fold-in verdict: ADOPT** — day-one governance text drafted *before* the first community pack arrives; the store's install path and the factory path are the same path.

---

## Open decisions (for the parent / owner)
1. **Factory pack licence**: CC0 (one-way door; open-spine doctrine) vs free-download-all-rights-reserved (keeps monetisation optional). Recommend CC0 for all day-one packs *or* CC0 for starter/tutorial + decide per flagship pack before launch. [entry 16]
2. **Free vs paid**: factory free at launch; expansions later? (ULTIMATE-PLAN B1 says owner's call; entries 3/7/8 give the market mechanics if a paid line is ever wanted.)
3. **Preview loudness target** −14 LUFS / −1 dBTP — confirm or adjust (entry 15).
4. **Counts**: 580 total / 10 packs / per-pack table (entry 12) — owner sign-off on targets, esp. STARTER 100 = free-tier flagship.
5. **Naming scheme** `PKG_TYPE_descriptor` + type codes — confirm before the first pack is authored (renames reset verification).
6. **Community channel**: PR vs forum vs web form; review SLA; tombstone policy for immutable packs (entry 17).
7. **SynthHub v2 scope timing** vs the synth launch (registry must exist before community packs can list).

## Dead ends / not-findable this pass
- **Serum 2 per-category preset counts** — not published; only the aggregate ("over 626 presets, 288 wavetables"). Marketplace listings (Splice) do not attribute pack sizes to the factory bank.
- **Kilohearts exact factory count** — docs say only "hundreds and hundreds"; use the 862 user-count (Dec 2023) with the flag, or avoid quoting a number.
- **Vital tier counts are contested in-forum** (installed Plus shows 235 vs advertised 250; a misnamed "Factory Presets" folder hides banks) — official tier figures used here; per-user counts cannot be a benchmark source.
- **exa fetch backend rate-limited mid-pass (HTTP 429)**: adventurekid.se page, AKWF-FREE GitHub page, lennardigital specs, arturia overview, kilohearts docs (first try). Recovered via `curl` (adventurekid waiver, lennardigital "2500+ presets", arturia Explorations text, AKWF `LICENSE.md` via GitHub API + raw) or via search snippets (kilohearts docs full text was later fetched successfully; ADSR product page, Splice pages, Loopcloud, naming guides are snippet-sourced and marked). adventurekid.se never returned via exa; curl succeeded — logged, not worked around.
- **AKWF `LICENSE` 404 → file is `LICENSE.md` on `main`** (first attempt used `master` + wrong name). Resolved.
- **Splice dollar amounts** rendered inconsistently on splice.com/plans for this region; prices quoted from a third-party review and marked approximate. Credit *mechanics* are verbatim from Splice's own FAQ.
- **Serum wavetable frame-size spec** not in the What's New PDF; sourced from the Serum manual mirror (2048 × up to 256) + the community CLM write-up. Functional claims verified against two independent sources.
- **No CC0 factory-preset banks for classic synths** (already logged in E2 dead ends) — confirms the plan: **author, don't harvest.**

## Sources & method
Primary sources fetched directly this pass: xferrecords.com/product page; static.xferrecords.com What's New PDF; vital.audio; spectrasonics.net library; kilohearts.com/docs/presets; github.com/smpldsnds/wavedit-online README; freepats.zenvoid.org/licenses.html; raw AKWF-FREE `LICENSE.md` + GitHub REST API (repo licence = CC0-1.0); adventurekid.se (curl); lennardigital.com/sylenth1/specs.php (curl); arturia.com pigments overview (curl). Snippet-sourced (search result of the primary page, page not re-fetched): splice.com/plans + /sounds + /sounds/presets/serum-2; adsrsounds.com product page + hub; loopcloud.com pack page; naming guides (audiolancer, gravitascreate); Moog help article; ask.video ES2 article; productionmusiclive Massive init; rekkerd + musicradar Phase Plant; vital forum thread. Local citations: PF annex/02, annex/05, CONTINUATION-2026-09-25; ULTIMATE-PLAN §5/Program B/C; E2; T0 tab digest. *(No git, no installs; all fetches read-only.)*
