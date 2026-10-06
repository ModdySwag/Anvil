# T4 — Synth feature matrix: flagship software synthesizers + notable browser instruments (2026)

**Task:** research feeding the design of **Anvil** — a NEW flagship browser synthesizer for moddys.net (pro-grade engine, polished UI, factory packs, multi-user/sharing options; working folder `C:\Users\Moddy\anvil`).
**Date:** 2026-10-06 (all "current" claims are as of this date; prices USD unless stated, each with as-checked date).
**Method:** live fetches of official product pages, manuals, changelogs, release notes + reputable reviews (MusicTech, Sound on Sound, MusicRadar, CDM, Synth Anatomy, KVR news) + community sources (Reddit/KVR/VI-Control threads) where marked. **Licence discipline:** licences are quoted from actual LICENSE files / first-party statements where quoted; GPL/AGPL-family = reference/clean-room only; closed products = behaviour reference only. Anything not confirmable from a first-party or reputable source is tagged **(verify)**.
**Already owned (do not re-research; cited here):** S1 `C:\Users\Moddy\moddys-music-suite\research\synths\S1-padthv1.md` · S2 `…\S2-odin2.md` · S3 `…\S3-vital.md` · S4 `…\S4-surge-xt.md`. Dittytoy is covered by T0 (`anvil/research/tabs/T0-tab-digest.md`) and is cited as the instant-play reference.

---

## A. Desktop flagships (entries 1–13)

### 1. Serum 2 (Xfer Records) — the 2025 refresh; exactly what v2 ADDED over Serum 1

Links: https://xferrecords.com/products/serum-2 · https://static.xferrecords.com/Serum%202%20What%27s%20New.pdf (official What's New deck) · https://www.xferrecords.com/manual/serum-2/docs (manual v2.0.18, ed. 2025-04-27) · https://musictech.com/reviews/software-instruments/xfer-records-serum-2-review/ · https://dawzone.com/serum-2-is-here-a-deep-dive-into-new-features-upgrades · https://djmag.com/tech/xfer-records-launches-long-awaited-serum-2 · https://support.xferrecords.com/article/58-how-to-upgrade-from-serum-1-to-serum-2

Core contribution: the industry-default wavetable synth's v2 — THE spec delta ("what flagship means, 2025") and the clearest list of engine features a new flagship must answer. Serum 1 (2014) → Serum 2 (2025) added, per official sources: 3rd oscillator, per-oscillator synthesis *modes*, a mixer with busses, dual filters, arp + clip sequencer, new FX, 10 LFOs, better matrix/browser.

KEY FACTS (v2 delta bolded conceptually; release + price verified):
- **Release:** 2025-03 (What's New PDF v1.0.0 dated 2025-03-17). **Price:** US$199 intro → US$249 from 2025-06-01; **free upgrade for Serum 1 owners**; lifetime free updates (MusicTech). Formats VST3/AU/AAX; Windows/macOS.
- **Oscillators (3 slots) × 5 modes:** Wavetable (smooth interpolation, no morph needed), Multisample, Sample (snap-loop detection, rate 'tape-stop', FM/PD/distortion), Granular, **Spectral** (harmonic-level resynthesis w/ transient detection; PNG image import per MusicTech) + noise + sub-osc (official page; MusicTech).
- **Mixer/bus system:** per-source channels (level/pan) with sends to **2 aux FX busses + main processing bus**; direct-to-main vs filtered balance; splitter modules (frequency / mid-side) — routing is the structural v2 upgrade (official; DAW Zone).
- **Filters:** dual filter modules, serial or parallel; "new virtual analog filters"; drawable **PZSVF** mode + comb/formant types (official What's New; 3rd-party guides — exact type count not published **(verify)**).
- **FX:** **13 effects modules + 3 splitter modules** across multiple busses; new Convolve (IR import), Bode frequency shifter, 3 new reverbs (Vintage/Nitrous/Basin) (official What's New; DAW Zone).
- **Modulation:** 4 envelopes (BPM sync, invert, legato modes), **up to 10 LFOs** (independent X/Y grids, drawing tools, swing), 8 macros ("each as potential destination"), matrix overhaul ("Improved Matrix / advanced mod management"; third-party docs count 64 slots **(verify)**). Drag-and-drop routing.
- **Sequencing:** arpeggiator + **clip sequencer** = piano-roll editor with realtime MIDI recording and comprehensive MPE editing (MusicTech).
- **Expression/tuning:** MPE mod sources (MPE Y/Z etc.) and MPE clip editing; **MTS-ESP** tuning section in manual **(verify depth)**.
- **Content/browser:** 626 factory presets, 288 wavetables; Serum 1 presets (incl. 3rd-party) load; browser categorised by type (Bass/Pad/Lead…) + feel (Soft/Aggressive/Ambient); undo/redo added (official; DAW Zone).
- **Praise/complaints:** praised as "still the most powerful soft synth" class, free update is huge; complaints: CPU strain (reviewer recommends 16 GB RAM), "so many powerful competitors" (MusicTech).

**Fold-in verdict: ADOPT** — this is the single most important spec sheet for the build: bus-based mixer, dual filters, granular+spectral import, arp+clip sequencer, 10-LFO modulation, category/feel preset browser. Home: engine architecture + UI + preset system.

### 2. Vital (Vital Audio / mtytel) — the free spectral-warping wavetable synth; deep-dive already on file

Links: **S3** `C:\Users\Moddy\moddys-music-suite\research\synths\S3-vital.md` (cite; do not re-research) · https://vital.audio/ · https://github.com/mtytel/vital

Core contribution: the free-tier benchmark (spectral warping wavetable synth) whose engine sits **beyond** Pattern Forge today, plus the licence/format interop playbook for our preset economy.

KEY FACTS (from S3, verbatim where quoted):
- **Code = GPLv3(-or-later)** (README: "The source code is licensed under the GPLv3…"), **content = separate EULA** — factory presets/wavetables/skins/LFOs not redistributable in any tier; own-authored `.vital` packs sellable (S3 §1–2).
- **Engine:** 12 spectral-morph modes on 2048-bin frequency-domain frames; per-connection **stereo (L/R) modulation** and **remap curves**; MPE zones (reference only) (S3 §TL;DR c).
- **Formats:** `.vital` = JSON text (base64 PCM), `.vitaltable` JSON, `.vitalbank` ZIP — trivially readable in JS; 2048-sample stacked-WAV interop = 1:1 with PF's export (S3 TL;DR b).
- **Tiers/presets:** Basic free (25 wavetables / 75 presets) · Plus (70/250) · Pro (150/400+); Plus/Pro financed via subscription credits that never expire (site text; prices JS-rendered **(verify)**).
- **Status:** public source frozen at **v1.0.6 (Feb 2021)**; binaries 1.5.5 → **1.6.4 early-access (2026)**; no PRs accepted; community forks are where movement is — incl. an Emscripten web port ("WebVial", see entry 16) (S3 TL;DR d).
- **Store/community:** preset share + store behind accounts (S3 §TL;DR e).

**Fold-in verdict: ADOPT** — reuse the licence rules (S3 §1–4 patterns), the .vital JSON/ZIP interchange design, and the "free base + paid packs" tier psychology. **SKIP** shipping any factory-derived media. Home: licensing + preset format strategy.

### 3. Kilohearts Phase Plant (+ Snapin ecosystem) — modular-by-default, snapins as a store

Links: https://kilohearts.com/products/phase_plant · https://kilohearts.com/blog/phase_plant_questions_answered (official FAQ: pricing + slot counts) · https://kilohearts.com/changelog (v2.4.6, 2026-03-10) · https://www.kvraudio.com/product/phase-plant-by-kilohearts · https://www.musicradar.com/reviews/kilohearts-phase-plant · https://www.attackmagazine.com/reviews/gear-software/kilohearts-phase-plant/ · https://kilohearts.com/products/kilohearts_subscription · https://kilohearts.com/products/kilohearts_essentials

Core contribution: the "unlimited modular" archetype + the **Snapin marketplace economy** (effects as modular units; free Essentials tier vs paid Snapins) — the most instructive model for our FX architecture and store.

KEY FACTS:
- **Model/price:** Phase Plant retails **$199 perpetual** (official FAQ; includes tax) with lifetime free updates; **Kilohearts Subscription $9.99/mo** unlocks everything (30+ plugins + content banks); **Kilohearts Ultimate** bundle = own all; **Essentials = 30+ free effects** usable as Snapins (official pages).
- **Architecture:** semi-modular single page: generator area (analog osc, granular generator [added 2023], noise, sample player, wavetable osc + filter/distortion/mix/routing modules) → **3 Snapin lanes** (each lane holds multiple Snapins, freely ordered) → output. Official FAQ: 12 module types, "currently up to 32 slots" in the generator section ("30 slots" of free combination after group+output).
- **Modulation:** "borderless"/wireless modular modulation section — combine modulators + utilities in any topology; drag to targets; audio-rate modulation incl. cross/self FM between all generators (official).
- **Sound design:** advanced wavetable editor; FM A-to-Z; granular; MPE compatible (official). Expressive E co-shipped an MPE preset suite (400 MPE presets, 2024-03, Expressive E press PDF).
- **Version:** **v2.4.6 (2026-03-10)** (changelog); a whole-ecosystem "v3" update announced as in development (r/phaseplant dev reply) **(verify timeline)**.
- **Praise/complaints:** "up with the best, capability-wise" (MusicRadar); complaints: beyond the free Essentials, quality Snapins are **extra purchases** ("unless you've already invested in these, you'll only have…" — Attack), learning curve, patch = module soup.

**Fold-in verdict: ADOPT (architecture + store pattern)** — three-lane FX with free base effects + paid add-on packs maps directly onto our factory-packs + future FX-store plan; keep our modulation drag-and-drop at least this free-form. Home: FX/modulation engine + packs economy.

### 4. Arturia Pigments (v7) — the six-engine hybrid; free major updates forever

Links: https://www.arturia.com/products/software-instruments/pigments/overview · https://support.arturia.com/hc/en-us/articles/23729034214940-Pigments-New-in-Pigments-7 · https://www.soundonsound.com/news/arturia-announce-pigments-7 · https://musictech.com/reviews/software-instruments/arturia-pigments-6-review/ · https://cdm.link/pigments-6-review/ · Pigments manual PDF https://dl.arturia.net/products/pigments/manual/pigments_Manual_7_0_1_EN.pdf

Core contribution: the "every synthesis type in one" hybrid with the industry's friendliest update policy — the closest desktop analogue to what a modern all-rounder must offer, and a masterclass in making depth feel un-overwhelming.

KEY FACTS:
- **Version/price:** **Pigments 7** released 2025-12-16, **free upgrade** for existing users (SOS news); **$199** (official page, 2026-10-06).
- **Engines:** 6 synthesis types — **Modal, Granular, Wavetable, Sample, Harmonic, Virtual Analog** — in 3 engine slots + Utility engine (extra osc + sampled noise) (official).
- **Filters:** **16 filter types, 50+ modes**, twin morphing filters, flexible routing; Pigments 7 adds Rage (distortion-in-feedback), Ripple (allpass phase), Reverb-filter + FM ("audio-rate") modulation of the classic filter from Engines 1/2 (official 7 notes).
- **Modulation:** "unlimited connections" — envelopes, LFOs, random sources; **drag-and-drop**; audio-triggered envelopes; audio-rate modulation (**Pigments 7**); modulation range shown on hover ("Quick Edit V3") (official).
- **FX:** **20 effects**, twin insert buses + send bus, any 3 effects per bus; Pigments 7 adds **Corroder** (FM-based texture) (official).
- **Sequencer/arp:** fully-fledged generative sequencer + arpeggiation, one-click stepped modulations, save/browse sequencer presets (official).
- **Expression:** **MPE since Pigments 2** (manual: "We also added MPE…"); microtuning is the weak spot — Ableton Live 12 tuning files do *not* affect Pigments natively (forum thread; M4L workaround exists) **(verify)**.
- **Presets/browser:** **1,700+** presets; expandable via sound store; color-coded reactive Play view; "Quick Edit"; resizable GUI (Arturia FAQ: plugin UI resize since V Collection 4) **(verify for Pigments specifically)**.
- **Praise/complaints:** "astonishing sonic diversity", "never overwhelming" (MusicTech/SOS); complaints: CPU on older machines + long load times (Arturia forum, Reddit, VI-C threads).

**Fold-in verdict: ADOPT** — copy the "6 engines, 3 slots, unlimited mods, generous free updates" formula and the Play-view clarity; replicate drag-drop w/ visible mod-range. Home: engine lineup + UX + update policy.

### 5. Minimal Audio Current (v2.2) — synth + sampler + effects + cloud content feed

Links: https://www.minimal.audio/products/current · https://www.soundonsound.com/reviews/minimal-audio-current · https://cdm.link/minimal-audio-current-synth/ · https://www.musicradar.com/music-tech/soft-synths/minimal-audio-current-2-0-review · https://www.audiopluginguy.com/news-minimal-audio-relaunches-current-synth-with-rent-to-own-and-perpetual-license-options/ · https://synthanatomy.com/2026/03/minimal-audio-current-2-0-flagship-synth.html · https://www.minimal.audio/products/all-access

Core contribution: the 2023–26 "content platform synth" — granular/wavetable/sampler engine + a huge effects suite + **subscription-connected cloud library**; and the market lesson on subscription backlash → rent-to-own/perpetual corrections.

KEY FACTS:
- **Version:** Current **2.0** (2024-10-23, SOS news; new Play View w/ dual XY, 400+ presets, 170+ wavetables, 800+ samples) → **2.2** free update (2026-03; Poly Flanger, more scales) (Synth Anatomy). (verify if newer than 2.2)
- **Model/price:** **$199 perpetual** ("full engine, complete effects suite, all factory content") *after* relaunch with rent-to-own; **All Access membership $15/mo** (7-day trial) or **$199 / 13 months** subscribe-to-own; credit accrues to buy products (APG news; official All Access page).
- **Oscillators:** 2 wavetable oscs ("hundreds of wavetables"), granular osc (position, spray/jitter, grain rate synced to clock, grain envelope shapes, embedded filters), additive sub, sampler with sub-osc + time-stretch flex modes (SOS review; CDM).
- **Filters:** 2 filters, morphing between types (SOS: "two filters, which can operate in s…" — morphable) **(verify type count)**.
- **FX/modulation:** "multi-effect" suite from the Minimal Audio effects line; modulation system; full details behind product page JS (SOS/CDM cover).
- **Cloud platform:** "The Stream" — sample + preset + wavetable content feed tied to subscription; content/expansion kits ship as updates (CDM).
- **Praise/complaints:** praised sound + FX quality ("rich, complex, high-quality sound" MusicTech; "one of the most powerful synths on the market" MusicRadar 2.0); the **subscription launch** drew heavy criticism → company added perpetual/rent-to-own (APG) — a direct lesson for our multi-user/pricing plan.

**Fold-in verdict: ADOPT (partially)** — steal the granular+sampler depth and content-platform idea, **but** the pricing lesson is the big one: ship perpetual-first with an optional membership. Home: multi-user/store strategy + sampler engine.

### 6. u-he Diva — analogue-modelled classic (5 osc models × 5 filter models)

Links: https://u-he.com/products/diva/ · https://u-he.com/products/diva/releasenotes.html · https://u-he.com/news/2023/09/diva-released/ · https://www.reddit.com/r/TechnoProduction/comments/m2r1r2/uhe_diva_eats_my_cpu

Core contribution: the reference for **component-modelled analogue authenticity** and its CPU economics (zero-delay-feedback filters; accuracy modes) — the calibration point for our analogue-modelled engine.

KEY FACTS:
- **Price/version:** **€179** (u-he page, 2026-10-06); current line v1.4.x (MPE new in **v1.4.8**). Win/macOS (Linux beta).
- **Engine:** 5 oscillator models + 5 filter models ("oscillators, filters and envelopes … meticulously modelled" from classic hardware); 3 ADS(S)R envelope models; ZDF filter design; per-voice oscillator detune; **2 host-syncable LFOs**; multicore + Accuracy (draft→divine) CPU modes (official).
- **FX:** 2 stereo FX slots each choosing chorus (3 modes), phaser (2), plate reverb, delay, rotary speaker (official).
- **Other:** host-syncable arpeggiator (swing, progressions); **1,200+ factory presets**; **resizable UI 70–200%**; **MPE support (v1.4.8)**; **MTS-ESP microtuning support** (release news 2023; .tun support **(verify)**).
- **Polyphony:** voice count is CPU-bound (module set = load); users run multicore option (official/community).
- **Praise/complaints:** gold-standard analogue tone; the classic complaint is **CPU** ("Diva eats my CPU" — r/TechnoProduction; multicore option helps).

**Fold-in verdict: REFERENCE** — the analogue-modelled quality bar + "accuracy" user-facing CPU switch (nice lever for a browser synth too). Home: engine quality targets + UI controls.

### 7. u-he Hive 2 — the CPU-friendly wavetable/analogue hybrid

Links: https://u-he.com/products/hive/ · https://u-he.com/products/plug-ins/hive2/index.html · https://u-he.com/downloads/manuals/plugins/hive/Hive-Wavetables.pdf

Core contribution: the "fast workflow + low CPU" flagship-lite — evidence that workflow speed and CPU are themselves features buyers pay for (Hive's whole pitch).

KEY FACTS:
- **Price:** **€149** (u-he page, 2026-10-06); current v2.1.x (MPE new in v2.1.2).
- **Engine:** 3 synth engines; 2 oscillators (standard waveforms or **2D wavetables**, up to 16× unison) + tunable sub-oscs; "swappable audio engine"; S&H/quantize etc. modifiers.
- **Modulation:** **drag-&-drop assignment; 12×2 mod matrix slots** with modifiers (curvature, rectification, quantization, S&H, slew); 2 function generators (env/gate/LFO/slew).
- **Sequencing:** **8-step shape sequencer (4 independent outputs)**, arpeggiator, step sequencer with realtime recording; scale quantizer.
- **FX:** **7 rearrangeable effects** (distortion, chorus, delay, phaser, EQ, reverb, compressor); panel presets per section; solo buttons; scope viewer.
- **Content/UI:** **2,400+ NKS-ready factory presets**; resizable UI 70–200%; alternative "Izmo" skin; **microtuning support (.tun files)**; MPE (v2.1.2) (official).
- **Praise/complaints:** unusually CPU-friendly with flagship-grade workflow (official framing; community consensus in KVR threads); less deep than Zebra/Phase Plant (positioning, not defect).

**Fold-in verdict: ADOPT (workflow + CPU stance)** — low-latency, low-CPU defaults and a fast assign workflow are core to browser viability; copy the mod-matrix-with-modifiers idea. Home: engine efficiency + UI workflow.

### 8. Native Instruments Massive X (v1.7) — wavetable flagship with a cautionary tale

Links: https://www.native-instruments.com/en/products/komplete/synths/massive-x/ · https://native-instruments.com/ni-tech-manuals/massive-x-manual/en/welcome-to-massive-x · https://rekkerd.org/native-instruments-updates-massive-x-synthesizer-to-v1-7/ · https://community.native-instruments.com/discussion/54/official-update-status-massive-x-current-version-1-7-0 · https://vi-control.net/community/threads/a-frustrated-love-letter-to-massive-x.152343/ · https://www.native-instruments.com/products/massive-x-player

Core contribution: what an under-loved flagship looks like — great engine, thin feature gaps, slow roadmap = years of "almost". Its gaps (no MPE, no microtuning) are the cheapest wins for a new synth.

KEY FACTS:
- **Version/price:** v1.7.0 current (NI community update-status thread; rekkerd 2026-03-02); **$199/€199** (NI product page; upgrade from Massive $149). **Massive X Player**: free, reduced feature set, 60 presets (2025-07).
- **Engine:** 2 wavetable oscillators ("huge selection"), noise sources; filters with sub-modes; **up to 3 insert effects (or extra oscillators) + Stereo FX**; Voice page (unison↔chord crossfade).
- **Modulation:** **9 slots for envelopes + LFOs** (drag-and-drop); **Performer** (draw up to 8 bars of modulation) + Remote octave; macros 1–8; Multi-Compressor added in 1.6 (manual).
- **Presets/browser:** **780 presets** (NI product page "Number of presets: 780"); MX Factory Library consolidated w/ searchable genre/version comments; browser w/ favourites; Play view + Morph across 4 variations (1.6).
- **1.7 adds:** full host automation for all parameters, NKS 2, Animator lock, X/Y Morpher invert (rekkerd).
- **Gaps:** **no MPE** (long-standing user complaint, vi-control: "Why no MPE support?") **(verify)**; no microtuning; performers not polyphonic; no MIDI learn **(verify)**.
- **Praise/complaints:** excellent sound; the "disastrous launch pretty much killed the synth" feeling + slow updates dominate community sentiment (vi-control thread).

**Fold-in verdict: ADOPT (as counter-example)** — treat MPE + microtuning + per-note modulation as table stakes precisely because the market punishes their absence; also: a free "Player"-style tier is a proven funnel. Home: spec floor + funnel strategy.

### 9. Sylenth1 (LennarDigital) — the evergreen virtual-analogue (v3.075)

Links: https://www.lennardigital.com/sylenth1/ · https://www.lennardigital.com/sylenth1/whatsnew.php (v3.075, 2026-04-14) · https://www.lennardigital.com/store/ (price) · https://www.kvraudio.com/product/sylenth1-by-lennarddigital/reviews/4754

Core contribution: 19 years of proof that a **simple, great-sounding, CPU-light subtractive synth never dies** — and what "dated" costs (no MPE/microtuning, fixed routing) even for a beloved product.

KEY FACTS:
- **Price/version:** **€139 (ex VAT)** or **€9.95/mo rental** (official store); current **v3.075** (2026-04-14; v3.072/3.073 earlier 2026). VST2/VST3/AU/AAX; Windows/macOS.
- **Engine:** 4 unison oscillators × 8 unison voices = 32 voices/note; **16-voice poly, up to 512 simultaneous voices** claim; 2 filter sections (4 stages each, nonlinear saturation, self-oscillation+); 2 ADSR + 2 LFO + 2 extra amp envelopes; velocity/kbd-track/modwheel as sources (no mod matrix — fixed routing) (official).
- **FX:** 7 master FX (distortion 5 types, 6-stage phaser, chorus/flanger, EQ, delay w/ ping-pong, reverb, compressor) + **arpeggiator (10 modes, built-in step sequencer, step-velocity as mod source)** (official).
- **CPU stance:** "highly optimized … SSE … automatically turn off unused parts" (official) — the reason producers still open it.
- **Gaps:** no MPE, no microtuning **(verify)**; modulation depth is fixed-routing era.
- **Praise/complaints:** still-used classic for EDM/big-room presets + CPU; "dated" is the standard critique; preset ecosystem is huge but user-preset browsing is old-school (community: r/musicproduction "Does anyone still use Sylenth1?"; KVR rating 4.53/5 from 30 reviews).

**Fold-in verdict: REFERENCE** — borrow the "reach for it because it's instant and light" positioning and the arp-as-mod-source trick; don't borrow its feature ceiling. Home: performance/CPU budget + simplicity tier.

### 10. Spectrasonics Omnisphere (2.x → 3) — the $499 king; v3 shipped 2025-10-21

Links: https://www.spectrasonics.net/products/omnisphere/index.php · https://www.spectrasonics.net/products/omnisphere/library.php · https://www.soundonsound.com/news/spectrasonics-omnisphere-3-arrives · https://www.production-expert.com/production-expert-1/spectrasonics-omnisphere-3-announced · https://www.musicradar.com/music-tech/soft-synths/spectrasonics-omnisphere-3-review · https://blog.dubspot.com/omnisphere-3-review · https://www.kvraudio.com/news/spectrasonics-releases-omnisphere-3-with-expanded-synthesis-fx-and-hardware-integration-65051

Core contribution: the sample+synth hybrid monetised at premium price — proves **content depth + hardware integration + effect suite** can sustain $499; also the v2.x→v3 upgrade economics (10-year cycle, $199 upgrade).

KEY FACTS (note: the capture brief said "2.x"; the line is now on 3):
- **2.x facts:** v2.8 was the final 2.x line (software 2.8.1c); "over 14,000 unique sounds" by 2.8; $499 (2.x era) (gear4music/Sweetwater).
- **v3 (2025-10-21):** **$499** download/boxed (€399; £349), **v2 upgrade $199** (€159) (production-expert; ranzee table 2025-10-18; ilio).
- **Content:** **41,405 total sounds** (official library page); "over 41,000 patches" per MusicRadar; 64 GB library; 18 new libraries; patch Mutations (subtle→extreme, auto-saved).
- **Synthesis:** upgraded filter section with **36 new filter types in 7 "colours"** + circuit-modelled filter saturation; **Quadzone modulation**; vintage oscillator drift; new EDM wavetables; polyphonic dual frequency shifter (official overview).
- **FX:** **35 new FX units**; total effects engine of ~93 usable **standalone** as an effects rack (SOS; Dubspot).
- **Expression:** **full MPE mode** + Intelligent Polyphonic Modulation; expanded hardware synth integration (SOS/KVR).
- **Browser/UX:** redesigned browsing + organisation; Global Controls (Tone/Ambience/Filter/Envelope/Vibrato/Unison auto-mapped per patch) (SOS).
- **Praise/complaints:** "still the synth to beat" (MusicRadar); complaints: price, huge 64 GB footprint, CPU/RAM-hungry patches (VI-Control/Gearspace/Reddit threads).

**Fold-in verdict: REFERENCE** — the content-library + effects-rack-as-product model informs our packs economy; the 10-year cycle/paid-upgrade math shows the ceiling we don't need to chase (we ship web-first + CC0-first). Home: packs/content + positioning (cost honesty).

### 11. SynthMaster 2 (KV331 Audio) — the $49 all-rounder; now feature-frozen behind SynthMaster 3

Links: https://www.kv331audio.com/synthmaster.aspx · https://kv331audio.com/synthmaster.aspx · http://www.kv331audio.com/synthmaster/downloads/synthmasterusermanual.pdf · https://www.kvraudio.com/news/kv331-audio-updates-synthmaster-2-to-v2-9-18-on-windows-macos-and-ios-67338 · https://www.kvraudio.com/news/kv331-audio-releases-synthmaster-3-61584 · https://www.kvraudio.com/forum/viewtopic.php?p=8920047 ("v2.9.18 final update")

Core contribution: how much synth you get for **$49** — the value floor compressing from below; and an instructive endgame (v2 line finished at 2.9.18; v3 is the current product). Its microtuning + online-preset-browser + 64-slot matrix show what even budget synths must carry in 2026.

KEY FACTS:
- **Price/version:** **$49 regular** (official; flash sales to $9; historically $99). **v2.9.18 = final update** of the 2.x line (KVR; also iOS). Successor **SynthMaster 3** released 2024-09-02 ($125 intro / $179 reg; now at v3.4.9 per KV331 news). VST2/VST3/AU/AAX + iOS; Windows/macOS/iOS.
- **Engine:** 2 layers, each with 2 oscillators / 2 filters / 4 modulators / own arp; VA, additive (8-osc), wavetable (up to 256 frames), wavescanning, phase-mod, FM, pulse-width; stereo unison/voice stacking; **17 oscillator algorithms incl. spectral filter categories** (official).
- **Filters:** ZDF filter families: **VAnalog (ladder, self-osc, continuous slope), Multimode (continuous LP→BP→HP, 0–24 dB/oct), Dual (serial/parallel blend), Comb** + distortion before/inside/after (official).
- **Modulation:** **48 sources, "hundreds" of targets, 64-slot mod matrix** with visual filtering; 2D envelopes, multistage envelopes, key-scalers, vocoder bands as sources; 8 easy knobs + 2 XY pads (official).
- **FX:** **11 types** (distortion, LoFi, ensemble, phaser, 6-band EQ, compressor, vocoder, delay, chorus, tremolo, reverb) insertable per layer or on 2 global send busses (official).
- **Sequencing:** arpeggiator with classic + Sequence/Chord modes; **32 steps each with velocity/note/length/slide/hold**; drag-drop MIDI pattern import (official).
- **Content/browser:** **2,000 factory presets**; browser search by type/attributes/style/author; **online user preset library (upload/browse/download in-plugin)** (official).
- **Microtuning:** **Scala (.scl) support, per-preset or global** (official) — better than several bigger flagships.
- **Praise/complaints:** praised as superb value and feature-per-dollar (MusicTech 2.9 "Enhanced Sonic Goodness"); complaints: UI busyness/complexity, long tail of small bugs, sound quality a step below top-tier (community threads).

**Fold-in verdict: ADOPT (value moves + browser patterns)** — copy: Scala tuning in a budget synth = non-negotiable; in-plugin community preset library = model for our multi-user sharing; 64-slot matrix. Home: preset/community system + tuning.

### 12. u-he Zebra 3 — the 12-year wait shipped (2026-04-20); modular-wireless + physical modelling

Links: https://u-he.com/products/plug-ins/zebra3/ · https://u-he.com/news/2026/04/zebra3-released · https://www.kvraudio.com/news/u-he-releases-zebra-3---modular-wireless-synthesis-and-physical-modeling-engine-66720 · https://synthandsoftware.com/2026/05/u-he-zebra3-the-synth-and-software-review/ · https://www.michaelmusco.com/2026/05/zebra-3-review.html · https://u-he.com/news/2026/07/zebra-3-0-1-released

Core contribution: the **newest deep flagship** and the strongest "differentiator list" in the matrix: spline-drawn oscillators, additive partials, physical modelling, per-voice modulatable FX sends, MTS-ESP — plus a hard-won lesson about upgrade-path communication (no crossgrade for Zebra Legacy owners).

KEY FACTS:
- **Release/price:** **Zebra 3.0 — 2026-04-20**; €249 (u-he); 3.0.1 free update 2026-07-13. VST3/AU/AAX/CLAP; Windows/macOS/Linux. Zebralette 3 (free, 2025-12, reduced) shipped first as a taster; curve sets export as .WAV wavetables.
- **Generator Rack:** 4 main oscillators from **hand-drawn spline waveforms**; each can run as **wavetable (up to 16-voice unison per osc)** or **additive (up to 1,024 sine partials,** inharmonic supported); each osc has **2 serial FX slots (20 processes)**; modules only appear when added (adaptive interface); drag-&-drop organisation.
- **Physical modelling suite:** **modal resonators, comb filters**, dedicated Noise + Exciter modules for transients/excitation (u-he/KVR).
- **FM:** **4 dedicated through-zero FM oscillators** that accept any rack signal as modulator (KVR).
- **Filters:** **13 filter models** (classic analog + original digital designs) (KVR).
- **Modulation:** modulation treated as first-class: pitch/gate/trigger as sources; **Mod Math** modules; **Mappers** (custom transfer curves or step sequencers); 4 ADSR envelopes (velocity, one-shot, Vary params); **4 LFOs** (sine/tri/saw/square/S&H/smooth random); unified **spline editor for oscillator waveforms + MSEG curves**; Control ABCD macros (preset-stored, MIDI CC offsets since 3.0.1) (official/KVR).
- **FX Rack:** FX Grid fed by **4 voice lanes → 4 global buses (Main + 3 aux)**; **send levels are per-voice modulatable**, so FX depth participates in polyphonic expression (u-he).
- **Expression/tuning:** **MPE + MTS-ESP real-time tuning + CLAP** (KVR). **1,200+ factory presets** in 12+ categories (official; Synth & Software review confirms).
- **Upgrade path:** pre-2022-11-01 Zebra 2 licensees have upgrade options in My Licenses; **no crossgrade for Zebra Legacy owners** (official — read this as the anti-example for our own messaging).
- **Praise/complaints:** reviews call it "one of the deepest modern synthesizers" (Musco); the wait was worth it on sound; friction: complexity/learning curve, upgrade policy confusion (community).

**Fold-in verdict: ADOPT (feature targets)** — per-voice modulatable FX sends, MPE+MTS-ESP as standard, spline/curve drawing as a first-class UI grammar (maps beautifully to canvas/WebGL UI). Home: engine + expressive routing + UI.

### 13. The FOSS reference set — Surge XT, Odin 2, padthv1 (already deep-dived; cite only)

Links: **S4** `C:\Users\Moddy\moddys-music-suite\research\synths\S4-surge-xt.md` · **S2** `…\S2-odin2.md` · **S1** `…\S1-padthv1.md`

Core contribution: the free-desktop floor (what hobbyists can already get for €0) — sets the price-value expectations our free tier must beat with browser-native benefits.

KEY FACTS (from the S files; no re-research):
- **Surge XT (S4):** GPL-3.0-or-later; **12 oscillator types** (incl. FM2/3, String, Twist/Plaits-derived, S&H), **35 filter types / 8 topologies**, **31 effect types + Off** (corrected count), 41 mod sources, 10 LFO types; nightly 1.4 line adds Xpander+Multi filters, Lua wavetable editor, .wt/Bitwig export; **SST tuning library MIT** (usable as our conformance oracle); no web build of note.
- **Odin 2 (S2):** free, **GPLv3 with font exception** (content GPL-covered — keep out of paid packs); 24-voice; 3 osc slots + 3 filter slots; 5 FX; 4 env; 4 LFO; XY-pad; **9-row mod matrix**; arp/step-sequencer; unison; microtuning (.scl/.kbm); **no browser build exists** (S2 §3) — our web-first claim has no FOSS desktop counterpart to fear on that axis.
- **padthv1 (S1):** "old-school polyphonic additive synthesizer" — 9 years maintained, 1.5.0 (2026-09-15), LV2 + standalone only (no VST), small user base; a maturity datapoint, not a competitor.
- Licence rule (S2 §2): GPL code may fold into our AGPL suite with notice; **GPL/CC-NC content never ships in paid packs**.

**Fold-in verdict: REFERENCE** — use S4's tuning library (MIT) + counts as verification oracle for our engine checklist; cite this trio as "free floor" in positioning copy. Home: engine checklist + licensing + positioning.

---

## B. Browser instruments (entries 14–16)

### 14. Ableton "Learning Synths" — the gold standard of browser synth teaching (tech inspected)

Links: https://learningsynths.ableton.com/ · https://www.ableton.com/en/blog/learn-synthesis-in-your-browser/ · engine file inspected: https://learningsynths.ableton.com/js/musiclab.js · https://frontendmasters.com/courses/web-audio/learning-synths-with-ableton/

Core contribution: proves a **free, zero-install browser synth that sounds good and teaches** can be a flagship-quality product — and gives us the exact UX skeleton (chapters + playground + settings) to beat.

KEY FACTS (inspected 2026-10-06):
- **Tech:** fully client-side; engine bundle `musiclab.js` (~50 KB, v0.14.0) implements a device layer with a **WorkletDevice and a ScriptDevice** and an `auto` mode — verbatim error string: *"Failed to create WorkletDevice due to missing AudioWorklet support. Please use the Device.Script or 'auto' option instead"* → **AudioWorklet preferred, ScriptProcessor fallback**. No Tone.js; own scheduler.
- **How it teaches:** ~9 chapters of guided interactive lessons — "Get started / Making changes (amplitude, pitch) / Synth basics / Envelopes / LFOs / Oscillators / Filters / Recipes / Playground / Learning more" — each a live synth to drag/play, plus a full **Playground** ("Open in Playground" carries state between lessons). Game-like: drag → hear change → read explanation.
- **Settings:** audio quality Low/Medium/High (CPU), keyboard layout Isomorphic/Piano, **MIDI input ON/OFF**, **16 languages**, free, no account.
- **What it doesn't do:** save/share patches, MIDI export, MPE; it's an educational toy, not a production tool — precisely the gap Anvil fills.
- **Licence:** free website, closed-source engine; no licence for reuse published — behaviour reference only.

**Fold-in verdict: ADOPT (UX patterns)** — chapter-based onboarding + playground + quality/latency settings = our tutorial spine; then we go further (save/share/packs/MPE). Home: onboarding UX.

### 15. Web Audio Modules (WAM 2.x) — the web-plugin standard, alive but niche

Links: https://www.webaudiomodules.com/docs/intro/ · https://github.com/webaudiomodules/api · https://www.webaudiomodules.com/community/plugins.json · https://github.com/boourns/wam-community · https://mainline.i3s.unice.fr/wamGallery/public/ · https://dl.acm.org/doi/fullHtml/10.1145/3487553.3524225 (WAM 2.0 paper) · https://github.com/webaudiomodules/sdk

Core contribution: the only real "VST-for-the-web" spec; its ecosystem (58 packaged plugins; sync/perf designs for AudioWorklet hosts) is both prior art and a **distribution channel** we could support or learn from.

KEY FACTS:
- **Spec status:** WAM proposed 2015 (Kleimola/Larkin); **WAM 2.0 released 2021** as a group effort; SDK + abstract API + about a dozen plugin repos + hosts; "over 40 WAM2 plugins ready to integrate"; features: audio, MIDI, video, OSC; third-party module loading across websites (a WAM = a URI, dynamically loaded); works in all major browsers **including iOS Safari**; WebAudio/WebGL2/WebMIDI (official docs).
- **Ecosystem today:** the community index lists **58 plugins** (instruments: Soundfont Player, DRM-16 DrumComputer, **Spectrum: Modal** synth, **Synth-101**, Audio Track; dozens of effects/utilities from vendors Sequencer Party + Wimmics; gallery to try/embed) (plugins.json, 2026-10-06).
- **Performance design:** plugin↔host messaging avoids the Web Audio param layer so AudioWorklet-based DAWs + AudioWorklet plugins don't cross the audio-thread barrier (docs) — read this section before designing our host↔voice protocol.
- **Licences (quoted):** `api` LICENSE = *"The MIT License (MIT)"*, *"Copyright (c) 2015 Web Audio Modules (WAMs)"*; `wam-examples` LICENSE = *"MIT License"*; `sdk` has no LICENSE file at root — **package.json field `"license": "MIT"`** (name `@webaudiomodules/sdk`) **(verify per-file headers if reused)**. All MIT-class → reusable with notice.
- **Reality check:** adoption stayed niche (no major browser DAW ships WAM as its plugin model; the gallery is a demo space, not a market) — treat as a *channel to watch/possibly support*, not a dependency.

**Fold-in verdict: REFERENCE→OPTIONAL ADOPT** — design our preset/plugin interfaces to be WAM-inspirable and consider WAM import as an ecosystem feature later; use the MIT SDK patterns freely. Home: architecture interop + community.

### 16. Notable web synths & the instant-play landscape (2025/26)

Links: https://midi.city/ · https://synth.playtronica.com/ (+ /midi-city) · https://github.com/GridSound/daw · https://github.com/cwilso/midi-synth · https://github.com/vial-kb/vial-web · https://synth.playtronica.com/ (DX7 by Matt Montag listed) · dittytoy: see T0 (`anvil/research/tabs/T0-tab-digest.md`) — **instant-play reference; cite T0, don't re-cover**

Core contribution: the field we must outclass: free browser toys/DAWs prove demand and set expectations for instant sound, but none combine pro engine + packs + sharing + teaching.

KEY FACTS:
- **midi.city** (by Astral Digital/Jack): free online synth, **"over 128 different instruments"**, pattern presets, playable hotkey keyboard, no account (playtronica listing; site live 2026-10-06).
- **GridSound** (github gridsound/daw, v2.59.3): "work-in-progress free browser-based DAW following the Web Audio API"; **licence = "GNU AFFERO GENERAL PUBLIC LICENSE"** (LICENSE first line, quoted) → **reference/clean-room only** under our rules.
- **cwilso/midi-synth** (Chris Wilson — Web Audio spec editor): MIDI-driven Web Audio synth, **MIT**, ~600★ — classic prior art for Web MIDI + scheduling.
- **playtronica "Web synths"** collection: curated directory of **~60 browser instruments** incl. DX7 (Matt Montag), Juno-106, granular sampler, sequencers — proof of breadth, mostly toys.
- **WebVial** (vial-kb/vial-web): **Emscripten build of Vital** (fork renamed "Vial" — Vital's licence forbids the name, per S3); README = build steps only; **no LICENSE file in repo root** (checked main/master) → inherits **GPL-3.0** from Vital code **(verify)** → reference only. Shows a desktop-class synth engine *can* run in-browser via WASM, but also that it's a research build, not a product.
- **Ableton Learning Synths** (entry 14) remains the quality bar; **dittytoy** (T0) remains the instant-play + shareable-link + fork/remix reference (ditties **CC BY-NC-SA 4.0** → clean-room only).

**Fold-in verdict: ADOPT (competitive framing + link-sharing bar)** — the market gap is exactly: ditty-class instant sound + Learning-Synths-class teaching + desktop-class MPE/tuning/content. None of the above combines them. Home: positioning + product requirements.

---

## C. Analysis (entries 17–19)

### 17. What producers expect in 2026 — commodity floor vs differentiators

Links: synthesis of entries 1–16 (no new sources).

**The commodity floor (every serious 2025/26 synth carries these; missing one = lost sale):**
1. **Hybrid engine breadth** — 3+ oscillator slots mixing ≥4 synthesis modes; granular + sampler import are now standard in flagships (Serum 2, Pigments, Current, Phase Plant; even budget SM2 covers VA/additive/wavetable/FM). [1][3][4][5][11]
2. **Dual filters** (serial/parallel) with analog-modelled + digital types; comb/formant present. [1][4][11][12]
3. **Drag-and-drop modulation** — envelopes/LFOs/macros/Random; large matrices (SM2: 48 sources/64 slots; Serum 2: 10 LFOs + 8 macros + overhauled matrix; Hive: 12×2 with modifiers). [1][7][11]
4. **Arp + step/clip sequencer** with pattern save (Serum 2 clip sequencer; Pigments generative seq; Sylenth1 arp still loved). [1][4][9]
5. **≥10 FX modules with bus routing** (13 in Serum 2; 20 in Pigments; 11 in SM2; Phase Plant lanes). [1][3][4][11]
6. **MPE** — Diva/Hive added it late; Omnisphere 3, Zebra 3, Serum 2, Pigments have it; Massive X is punished for lacking it. [4][6][7][8][10][12]
7. **Microtuning** — MTS-ESP (Zebra 3, Diva) or .scl/.tun (SM2, Hive); flagships without it age badly. [6][7][11][12]
8. **Preset browser depth + serious factory count** — 626 (Serum 2), 780 (MX), 1,200+ (Zebra 3), 1,700+ (Pigments), 2,000 (SM2), 2,400+ (Hive); categories, favourites, search-by-anything, audition. [1][4][7][8][11]
9. **Undo/redo, resizable UI, host automation of everything** (Serum 2 added undo/redo; Massive X 1.7's headline feature was full automation). [1][8]
10. **CPU pragmatism** (Diva accuracy modes; Hive's whole identity; Sylenth1 still opened because it's light). [6][7][9]
11. **Perpetual license + free updates** as the trust default; subscriptions only as optional add-ons (Current's sub backlash; KH's sub = optional alongside $199 perpetual). [3][5][9]

**The differentiators (what separates the top tier):** spectral resynthesis (Serum 2); physical modelling (Zebra 3 modal/comb; Pigments Modal); per-voice modulatable FX sends (Zebra 3); through-zero FM stack (Zebra 3); FX rack as standalone product (Omnisphere); content-ecosystem w/ cloud feed (Current); modular FX marketplaces (Phase Plant snapins); free-update longevity as brand (Pigments V7 free). [1][3][4][5][10][12]

**Read for us:** the floor is *known and buildable* (much of it already in the PF/T0 research); the differentiators map to 3 engine upgrades (spectral, physical modelling, per-voice FX routing) + 2 system upgrades (deep browser, share/community). [T0][S3][S4]

### 18. Where a browser instrument can win — and where it must match desktop

Links: entries 14–16 + T0 + S3/S4 (no new sources).

**Can win on (structurally impossible for desktop plugins):** [T0][14][15][16]
- **Instant-on, zero install, zero account** — Learning Synths proves it; ditty proves it with *quality*; a $199 download can't compete for the first 60 seconds.
- **Shareable sound-state links** — ditty encodes parameters in the URL hash; a Forge patch link = marketing loop + classroom + collab.
- **Cross-platform incl. mobile** — one build runs on Win/mac/Linux/iPad (WAM works on iOS Safari); desktop plugins need per-OS installers + dongles.
- **Cloud/community libraries** — fork/remix mechanics (ditty), plugin galleries (WAM), content feeds (Current's Stream = the commercial proof), preset sharing (Vital/SM online browsers).
- **No purchase friction** — free-to-play tier is native to the web; desktop does it via reduced "Player" editions (NI) which lose features.
- **Teaching + tool in one** — Learning Synths' chapter model; nobody pairs serious depth with onboarding in one link.
- **Export from the tab** — ditty's MP3 worker export proves render-in-browser; add MIDI export and we beat most toys.

**Must match desktop on (no forgiveness):** [1][4][6][7][8][12][S4]
- **Sound quality** — anti-aliased oscillators (PolyBLEP/oversampling; T0 has the math), ZDF filters (S4's sst-filters lineage), per-voice oversampled chains like Surge (2×).
- **Expressive depth** — MPE + MTS-ESP/.scl/.kbm tuning; per-note modulation incl. aftertouch/pressure; must not be a checkbox ("MPE mod source exists" ≠ good MPE).
- **Preset depth + browser** — hundreds at launch, tags/search/favourites/audition; packs pipeline from day one.
- **Reliability + latency** — AudioWorklet-only path with sane fallback; WAM's thread-barrier lesson; autosave; no crackling under load (quality modes like Learning Synths).
- **Export/export quality** — offline render (OfflineAudioContext) must be sample-accurate & lossless-capable; MP3 as convenience.
- **Offline/local-first** — PWA caching so a dead network ≠ dead instrument (fairness spine: local-first, no metering [README]).

### 19. Pricing, packs & multi-user economics across the matrix

Links: entries 1–16 (no new sources).

KEY FACTS (price survey 2026-10-06): Serum 2 $199/$249 · Pigments $199 · Current $199 (+$15/mo or $199/13-mo All Access) · Phase Plant $199 (+$9.99/mo optional; free Essentials) · Massive X $199 (free Player tier) · Omnisphere $499 ($199 upgrade) · Zebra 3 €249 · Diva €179 · Hive €149 · Sylenth1 €139 (€9.95/mo) · SynthMaster 2 $49 · Vital free (paid tiers/credits) · Surge XT/Odin 2/padthv1 free (GPL) [1][2][3][4][5][6][7][8][9][10][11][12][13]

**The pattern to copy:** perpetual base + optional subscription; free tier or free "player" as funnel; revenue from **packs/content** (Splice-style preset economies, Vital store, KH snapins) not from paywalling the engine; **free major updates** (Pigments, Serum free updates) buy enormous goodwill; subscribing must never gate core sound design (Current walked its sub-only model back under backlash). [1][2][3][4][5][8][11]

**The multi-user layer (this project's ask):** no desktop flagship in the matrix does live multi-user; nearest precedents are ditty's fork/remix + per-ditty licences (CC BY-NC-SA — clean-room only), WAM's URI-loadable modules, SM2's in-plugin upload/download preset library, Current's content feed, and storefront ecosystems. A browser synth can uniquely ship: accounts+cloud patch libraries, share links, classroom/collab sessions, and a *provenance-manifested CC0* pack store (suite fairness spine). [T0][5][11][15]

---

## D. MUST / SHOULD / DIFFERENTIATOR / AVOID table (for the Anvil build)

Legend: **Refs** = entry numbers in this file; [S1]–[S4] = the existing deep-dive files; [T0] = tab digest. All rows compiled from the entries above.

| # | Class | Item | Why (evidence in one line) | Refs |
|---|-------|------|----------------------------|------|
| 1 | MUST | 3+ oscillator slots × 4+ synthesis modes (wavetable, VA, sample, granular; spectral = bonus) | v2 Serum added 3rd osc × 5 modes; Pigments 6 engines; Phase Plant modular generators | [1][3][4] |
| 2 | MUST | Granular engine with import | Standard in Serum 2, Pigments, Current; Phase Plant added granular on request | [1][3][4][5] |
| 3 | MUST | Sampler/sample import w/ loop tools | Serum 2 (snap-loop, tape-stop), Current (time-stretch) | [1][5] |
| 4 | MUST | Dual filters, serial/parallel, analog-modelled + comb + digital types | Serum 2 dual filters; Pigments 16 types/50+ modes; SM2 ZDF families | [1][4][11] |
| 5 | MUST | Drag-and-drop modulation, big capacity (≥48 sources / ≥32 connections) | SM2 48 sources/64 slots; Serum 2 10 LFOs; Universal expectation | [1][7][11] |
| 6 | MUST | ≥4 envelopes + ≥4 LFOs, BPM sync, draw tools | Serum 2 (4 env/10 LFO); Hive function gens; Zebra 3 4+4 | [1][7][12] |
| 7 | MUST | 8 macros as first-class destinations | Serum 2 (8, "each a potential destination"); MX macros 1–8 | [1][8] |
| 8 | MUST | Arp + step/clip sequencer with saveable patterns | Serum 2 clip seq (MPE-aware); Pigments generative seq; SM2 32-step arp | [1][4][11] |
| 9 | MUST | FX chain ≥10 modules across ≥2 busses (reverb, delay, distortion, EQ, chorus, phaser, comp, bitcrush) | Serum 2 13 FX + 2 FX busses + main; Pigments 20 FX; Sylenth1 7 still insufficient today | [1][4][9] |
| 10 | MUST | Preset browser: search, categories/tags, favourites, audition, user folders | Serum 2 type+feel categories; MX favourites fixed in 1.7; SM2 multi-criteria + online library | [1][8][11] |
| 11 | MUST | MPE (per-note pitch/pressure/timbre) | Added by Diva 1.4.8 / Hive 2.1.2; Omnisphere 3, Zebra 3, Serum 2, Pigments all in; MX punished for absence | [1][4][6][7][8][12] |
| 12 | MUST | Microtuning: .scl/.kbm (+MTS-ESP if possible) | SM2 Scala; Hive .tun; Diva/Zebra 3 MTS-ESP; missing = dated | [6][7][11][12] |
| 13 | MUST | 500+ factory presets at launch, packs roadmap | Serum 2 626; MX 780; Zebra 3 1,200+; Pigments 1,700+; Hive 2,400+ | [1][4][7][8][12] |
| 14 | MUST | Undo/redo + save safety + versioned presets | Serum 2 finally added undo/redo (highlighted in reviews) | [1] |
| 15 | MUST | Resizable/scalable UI (70–200%+) | u-he standard; Arturia resize; MX "any size you like" | [6][7][8] |
| 16 | MUST | Host/DAW automation of ALL params + MIDI learn | MX 1.7 headline = full automation; expected by producers | [8] |
| 17 | MUST | Anti-aliased oscillators, ZDF filters, quality/latency modes | T0 DSP math (PolyBLEP, SVF); Diva accuracy modes; browser CPU reality | [T0][6][S4] |
| 18 | MUST | Perpetual-friendly pricing + free updates posture | Free-update goodwill (Pigments/Serum); subscription-only caused Current backlash | [1][4][5] |
| 19 | MUST | Local-first: works offline, no metering/credits on core use | Suite fairness spine (README); Current cloud = cautionary contrast | [5][README] |
| 20 | SHOULD | Wavetable editor + wavetable import/export (2048-cycle standard) | Serum 2 editor; Phase Plant editor; Vital 2048 interop (S3) | [1][2][3] |
| 21 | SHOULD | FX lanes as modular/reorderable units; future add-on packs | Phase Plant 3 snapin lanes + marketplace; Pigments bus pick-any-3 | [3][4] |
| 22 | SHOULD | Generative/randomize with musical guardrails (scales, magnitudes) | Pigments generative seq; Hive scale quantizer; MX performers | [4][7][8] |
| 23 | SHOULD | Performance tools: XY pads, macro morphing, patch morphs | MX Morph (4 variations); SM2 2 XY pads; Diva per-voice detune play | [7][8][11] |
| 24 | SHOULD | Multiband/mid-side splitters + sidechain-capable routing | Serum 2 splitter modules; differentiates mixing workflows | [1] |
| 25 | SHOULD | Cloud preset sync + shareable patch links | ditty URL-hash sharing; SM2 online library; Current feed | [T0][5][11] |
| 26 | SHOULD | Classroom/teaching layer (guided lessons) | Learning Synths chapter model = best-in-class onboarding | [14] |
| 27 | SHOULD | Export: lossless audio render + stems + MIDI | ditty exports MP3 from browser; producers expect MIDI/audio handoff | [T0][16] |
| 28 | DIFFERENTIATOR | Instant-on zero-install; first sound < 2 s, no account | Learning Synths/ditty prove it; desktop download can't compete | [14][16][T0] |
| 29 | DIFFERENTIATOR | Shareable sound-state links (URL = patch) | ditty sliders-from-code + URL hash; nobody at desktop level does this | [T0][16] |
| 30 | DIFFERENTIATOR | Community packs store w/ provenance manifests + fork/remix | ditty fork/remix; Vital store; suite CC0 provenance rule | [2][T0][README] |
| 31 | DIFFERENTIATOR | Cross-platform incl. iPad/mobile + Web MIDI I/O | WAM runs on iOS Safari; Web MIDI (cwilso/midi-synth prior art) | [15][16] |
| 32 | DIFFERENTIATOR | Per-voice modulatable FX sends in a web synth | Zebra 3's most novel expressive routing; nobody has it in-browser | [12] |
| 33 | DIFFERENTIATOR | Physical-modelling module (modal resonator / comb) | Zebra 3 modal+comb; Pigments Modal; still rare overall | [4][12] |
| 34 | DIFFERENTIATOR | Spectral resynthesis engine | Serum 2's headline; images→sound; only Vital-class territory otherwise | [1] |
| 35 | DIFFERENTIATOR | Live multi-user sessions (collab/classroom in one link) | No desktop flagship does it; web-native only; cite ditty community + Current feed as adjacents | [5][T0] |
| 36 | AVOID | Subscription-ONLY for the core instrument | Current's sub launch drew negative feedback → had to add perpetual/rent-to-own | [5] |
| 37 | AVOID | Shipping GPL/NC content in packs (Vital factory media, ditty ditties, Odin tables, GridSound AGPL code) | Licence quotes: Vital EULA, ditty CC BY-NC-SA, Odin GPL data, GridSound AGPL | [2][13][16] |
| 38 | AVOID | Paywalling basic FX/modules ("snapin tax") | Phase Plant review pain: paid snapins beyond Essentials | [3] |
| 39 | AVOID | Locking core use behind cloud/account/credits | Current model caution; suite fairness spine = local-first | [5][README] |
| 40 | AVOID | Feature-freeze/abandonment (Vital repo frozen; MX slow roadmap) | S3: source frozen 2021; MX: "disastrous launch… NI doesn't care" sentiment | [2][8] |
| 41 | AVOID | Proprietary/opaque preset formats; no import path | Vital .vital JSON/ZIP (S3) is the readable model; AAF/DAW lock-ins hurt | [2][S3] |
| 42 | AVOID | 64 GB installs / long first-run downloads | Omnisphere 64 GB; Pigments load-time complaints; we load in a tab | [10][4] |

*(42 rows — condensed from a longer list; every row carries its evidence refs.)*

---

## E. Dead ends & failed fetches (logged, not hidden)

- `https://u-he.com/products/zebra3/` — web_extract backend returned **HTTP 402 (Nimble trial quota finished)**; recovered via `curl` of `https://u-he.com/products/plug-ins/zebra3/` (redirect target). No facts lost.
- `https://www.audioplugginguy.com/review-zebra-3-by-u-he/` — extractor **blocked ("URL targets private/internal network")**; substituted Synth & Software + Musco reviews for Zebra 3 sentiment. (APG's Massive Audio relaunch news and Phase Plant review were reachable.)
- `https://www.native-instruments.com/en/products/komplete/synths/massive-x/` — JS-only render via curl; facts recovered from NI manual pages + NI product schema + search snippets (780 presets, $199) + rekkerd/KVR.
- `https://www.minimal.audio/products/current` + `/products/all-access` — JS-only (prices/presets not in HTML); recovered via MusicRadar review, APG news, Synth Anatomy, SOS.
- `https://www.lennardigital.com/sylenth1/buy.php` — 404 (page doesn't exist); store page `https://www.lennardigital.com/store/` provided price (€139 ex VAT / €9.95 monthly).
- `https://xferrecords.com/manual/serum-2/docs` — returned embedded PDF binary to curl (not text); used the official "What's New" PDF (text-extractable) + web-manual slugs + DAW Zone/MusicTech for Serum 2 details.
- `https://www.webaudiomodules.com/docs/community/` — links out to GitHub + gallery only; per-plugin licences not aggregated upstream (checked api/sdk/wam-examples individually instead).
- `https://vial-kb/vial-web` (GitHub) — **no LICENSE file** in main/master (checked raw + API); licence inherits Vital's GPL-3.0 (verify before any reuse; reference-only regardless).
- Reddit `.json` endpoints not used (blocked); community sentiment mined from search snippets of thread titles (Reddit, VI-Control, Gearspace, KVR) — labelled as sentiment, not measurement.

**Not re-researched by design:** Surge XT / Odin 2 / padthv1 / Vital deep dives (S1–S4 files, cited above); dittytoy platform anatomy (T0).

