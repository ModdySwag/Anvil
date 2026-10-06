# 03 — Implementation spec (Anvil)

Date: 2026-10-06 · Status: drafted from verified research (waves T1–T9); pending owner review alongside 01/02.
Evidence base: `research/engine/T5-web-audio-engine.md` (engine math), `research/reuse/T9-pattern-forge-reuse.md` (reuse map), `research/packs/T8-content-packs.md` (content), `research/groovebox/T3-groovebox-sequencing.md` (sequencer), `research/acid/T2-acid-heritage.md` (acid engine), `research/multiuser/T6-multi-user-architecture.md` (community), `research/tabs/T0-tab-digest.md` (seed + ditty method cards), `research/matrix/T4-synth-feature-matrix.md` (industry floor), `research/WAVE-LOG.md` (verification).

---

## 0. Doctrine (inherited — non-negotiable)

1. **Lab → battery → frozen bytes → deploy.** No artifact ships without an engine-witness report; count lines in suites are contract; flakes are recorded with evidence, never hand-waved. (PF culture, `verify/` ~60 suites.)
2. **Single-file artifact** built from `src/` parts by a `build.py`-style assembler: explicit `js_parts` order list (the order trap: unlisted file = silently unsaid → keep + fail loudly), `</script` guard, `node --check` parser gate (catches duplicate top-level names across parts), sha256 + byte-count print as the release identity.
3. **Licence discipline.** Code: MIT/ISC/Apache-2.0/Unlicense only, verified from actual files; GPL-family = clean-room reimplementation with attribution; closed products = behaviour reference. Content: own-authored / CC0 / PD default; CC-BY only with manifest attribution. **Open303 (MIT, verified verbatim)** is the one directly port-able acid DSP; MoogLadders is Unlicense; everything else is reference.
4. **Fairness spine:** local-first (full instrument offline, no account), no credits, no metering, open formats, export everything.
5. **Family law:** the whole app is one engine instance with **one master tap**; the synth routes through it, never to `ctx.destination` directly (recorder/meters/EQ/export ride the tap).

---

## 1. Runtime architecture

**1.1 Two-tier engine.**
- **Hosted tier (flagship):** AudioWorklet-first. AudioWorklet gates (Chrome 66 / FF 76 / Safari 14.1) clear every 2026 target.
- **Fallback tier (`file://` single-file build):** `blob:`-URL worklets are refused by Chrome/WebKit on `file:` pages, so the file:// build runs the *same DSP kernels* as plain functions over `Float32Array` in a node-graph + `ScriptProcessorNode` harness (deprecated but universal), with an honest degraded voice cap. One codebase, two transport tiers — write every kernel as a pure function; the tiers differ only in who calls it and when.
- **Host headers (hosted):** serve `COOP: same-origin` + `COEP: require-corp` on the app path to unlock `SharedArrayBuffer` (SAB is gated behind cross-origin isolation — verified locally: `SharedArrayBuffer === undefined` on a normal page). Engine must run in **both** modes: SAB ring-buffer for the UI→audio parameter feed when available; `postMessage` otherwise (SuperSonic's "dual transport" precedent).

**1.2 Threading model.**
- **One mixer AudioWorklet per app instance** — all voices, all FX inside it. Hard rule from the field (Casey Primozic's trace): keep a-rate `AudioWorkletNode` parameters to single digits per node; prefer k-rate + engine-side modulation (his bench: cutting a-rate params 34→6/node took render cost 5.9 ms → 2.3 ms). Our mixer node exposes few params; per-voice modulation is engine-internal.
- **Workers for everything non-realtime:** wavetable + mipmap generation, IR generation, FFT/analysis, pack decode, MP3/OGG export helpers (dittytoy's proven split: loops→workers, mixer→one worklet — we harden it).
- **Render quantum = 128 frames** (2,902 µs @44.1k / 2,667 µs @48k). Every budget number is stated per-quantum and per-sample.

**1.3 Master tap first.** Port `pfInstallAudioTap()` semantics before anything else: patch `BaseAudioContext.prototype.destination` at boot; chain engine → **KEYS bus** (native synth volume) / **BEATS** legacy bus → **MASTER** → destination; recorder, WAV export, meters, EQ analyser all attach to the tap. Witness law (cost blood in PF): **tests must install their own `AnalyserNode` on the master tap and set the blend to synth; `eqBands`-style panel reads are NOT audio witnesses.**

**1.4 Rates.** Live context runs at **device rate** (48 kHz on this machine); all DSP expressed in frequency ratios (`f/fs`) never absolute Hz-samples. Offline export picks explicitly: **44.1 kHz** for WAV/MP3 family, **48 kHz** for video/DAW alignment. QA battery passes at both.

**1.5 Latency.** `latencyHint: 'interactive'`; expose a diagnostics panel with measured `baseLatency`/`outputLatency` (measured here: 10 ms @48k). Safari quirk handled: context starts suspended → design the start screen around one user gesture.

---

## 2. The instrument (module specs, v1)

### 2.1 Voice chain
Per voice: **3 oscillator slots + sub + noise + engine mods**, into **2 filter slots (serial/parallel)** → amp → per-voice FX sends → bus. Voice architecture is polyphonic; target polyphony **≥32 voices** desktop (provisional — replaced by the measured proof-benchmark, §5), ≥16 mid, ≥8 iPad.

**Oscillator engines:**
- **VA (PolyBLEP family):** saw/square/pulse/triangle/sine, 2-point PolyBLEP default (`t<dt: t+=t−t²−1`-form, ~8 flops — equations in T5 §8) + voice-chain **2× oversampling with polyphase-IIR halfbands** (order 6 default / order 12 HQ). Measured: PolyBLEP buys ~8–12 dB over naive (e.g. 997 Hz: −36.3 vs −27.7 dBc) but still needs 2× OS above ~1 kHz. **"Classic" quality tier = Surge-style 12-tap BLIT/minBLEP** (table generated offline; correct at high pitch and under sync). Sync via minBLEP at reset; DPW "Modern" variant as the no-table alt.
- **Wavetable:** 2048-sample frames, ≤256 frames, mipmapped (level `k = ceil(log2(M·f0/fs))`; build by band-limited halfband decimation, never naive), **cubic (Catmull-Rom) read default** (measured −45.9 dB rms error vs linear −35; sinc8 −63 dB for HQ mode). Keep ≥half-octave margin at mip tops (measured collapse at the edge). Positions/warp; crossfade pairs for live morph; `.wt`/stacked-WAV parity with the family's existing containers.
- **FM:** 2-op (modulator→carrier, mul/index/decay) native; FM/PM pairs per slot. (4-op matrix = post-v1 SHOULD.)
- **Noise:** white/pink + S&H.
- **Sub osc:** square/sine one octave down.
- **Sampler + granular (v1 — decided 2026-10-06):** shared sample core — import/decode pipeline (WAV native; AIFF/FLAC/MP3/OGG via worker-side decoders — licence + footprint gate), buffer manager, waveform display + loop tools; **sampler voice** (one-shot / loop / multisample zones, drag-in); **granular engine** (Hann grains 10–200 ms, overlap 4–8, ~15–25 flops/grain, hard grain budget, position/rate clouds).

**Dedicated engines (first-class):**
- **ACID engine** (the emotional core — seed tabs): DCO saw↔square blend + PolyBLEP; **filter = 4-pole/24 dB ladder family with the C/2-cap transfer function** `H_tb(s) = −1/(s⁴+6.727s³+14.142s²+9.514s+1)` (T2; the "18 dB" folklore is settled), + SVF alt; **accent = four simultaneous changes + sweep-capacitor memory** (amplitude boost, cutoff boost, resonance emphasis, MEG decay forced ~200 ms; consecutive accents *rise* — non-negotiable for the sound); slide/portamento (stock ≈60 ms, mod range 60→360 ms); controls: tuning · cut off · resonance · env mod · decay · accent · volume · waveform; **mods canon as an "EXPANDED" panel** (Devil Fish lineage, cross-confirmed by TD-3-MO/Phoscyon 2): separate Normal/Accent decay (30 ms–3 s), VEG (16 ms–3 s + infinite), filter tracking, overdrive ladder up to 66.6×, muffler, ±2-oct sweep, soft attack 0.3–30 ms, 3 accent-sweep modes. DSP foundation: **Open303 (MIT) clean-room port**; brand-clean art/naming (no Roland trade dress — ReBirth takedown precedent). Sequencer: 16-step × [note, gate/tie, slide, accent] with the original two-pass pitch/time write model + triplet option + 909-derived shuffle.
- **STRING engine (Karplus-Strong):** delay line `N = fs/f0` with fractional interpolation (allpass preferred), one-pole damping loop filter, pluck-position comb injection (~20–40%), exciter bank, tuning compensation for loop-filter phase delay; stereo pair; ~20–40 flops/sample — cheapest voice we have (2020 bench: 1,000 JS / 2,000 WASM strings). Ships as NEON STRINGS content anchor.
- **DRUM engine:** expand PF's 9-voice kit (kick/snare/rim/clap/hats/toms + more) with per-voice params; one kit bus; drum split law (lowest octave, chromatic, skips scale lock); pads UI.

### 2.2 Filters
**Default kernel: TPT/ZDF SVF (Cytomic form)** — `g=tan(π·fc/fs)`, `k=1/Q`, `a1..a3`; ~12 flops; LP/BP/HP/notch/allpass states from one core; 12 dB/stage, cascade for 24 dB; stable to self-oscillation. **Character filter: one accurate Moog ladder** (Huovilainen-style nonlinear, 2× oversampled; RK4 math port from MoogLadders, Unlicense). Later: comb ±, formant, ring mod (Odin shortlist). Per-filter env amount + keytrack + drive stage.

### 2.3 Modulation
- Sources: **4 envelopes** (ADSR + curve + velocity tracking; MSEG post-v1) + **4 LFOs** (sync divisions, retrig modes, fade) + **8 macros** (first-class destinations) + velocity/aftertouch/MPE pressure/timbre + keytrack + random-per-note.
- **Drag-and-drop modulation matrix**, ≥32 connections, per-voice semantics (pitch-stable), remap curves per connection, mono/poly + range semantics documented in UI.
- Mod system is polyphonic per-voice (the flagship gap #2 in T9 — genuinely new engineering).

### 2.4 FX rack (≥12 modules, 2 aux buses + master insert)
Drive/saturator (with fold mode) · bitcrush · chorus/ensemble · flanger (signed feedback) · phaser (6–8 allpass stages) · **stereo delay** (fractional+allpass interpolation, cross-feedback ping-pong like the DT303 seed, ducking, sync divisions) · **reverb: Dattorro plate (flagship) + FDN (hall/room) + Freeverb (cheap mode)**; IR `ConvolverNode` for presets · EQ (RBJ cookbook biquads / native nodes) · compressor (feed-forward, dB gain computer, soft knee) · lookahead limiter (1–5 ms, stereo-linked) · master soft-clip safety. All inside the mixer worklet; reorderable (SHOULD); per-patch presets + per-slot mix/amount.

### 2.5 Performance layer
Port wholesale from PF (it shipped): arp (modes up/down/updown/updown-inc/order/random/chord, divisions, octaves, gate, swing, latch, 16-step pattern rows w/ accent/skip/ratchet), chord memory (+learn), scale lock (snap|fold), note repeat (rate/gate/velocity ramp/latch), mono/legato/glide (time+curve), sustain pedal (CC64/66 per-key hold map), velocity curves + Full Level, default CC map + learn, bend/aftertouch. **Keep the internal-flag arbitration laws verbatim** (no interceptor re-expands a walked note) and the **lookahead scheduling law**. Add: **MPE** (port; per-note channels 2–16, bend/AT/CC74) and **microtuning** (.scl/.kbm port; MTS-ESP later). Audio-clock tick source replaces `setInterval` at sequencer stage (gap #8) while keeping arbitration intact.

### 2.6 Sequencer (native-engine step sequencer — gap #3, new build)
- **Step-object model** (from T3): per step — note, velocity, gate/length, slide, accent, probability %, condition (fill / A:B / first / !first), ratchet (rate, count), micro-shift (±ticks), plus any **parameter-lock** assignment (any synth param, own value).
- **Patterns:** per-track length (1–64) + speed multiplier (polymeter) ; swing law `delay = pair × (S−50)/100` with S∈[50,80] (default 66 = triplet feel); triplet grids + quantize amount; Euclidean generator (SHOULD); mutate/variation; fill tools; humanize; note repeat (live).
- **Arrangement:** pattern **chains** + **song rows** {pattern, repeats, mute snapshot, tempo} (v1, the T3 recommendation); **scenes** (scene rows = pattern/mute snapshot per track, queued switching) as v1.1; linear arranger + performance FX (scatter/punch-in) LATER.
- **Native bridge:** sequenced events schedule on the **audio clock** into the native voice allocator (no Strudel dependency; `registerSound('pf_voice')`-style bridge is unshipped in PF and stays unshipped — we build our own event queue). Grid UI bound to the engine; step recording + live recording w/ parameter capture.
- Acid pattern mode = the ACID engine's native lane (accent/slide/octave semantics preserved).

### 2.7 Patch model & persistence
- **Patch JSON v2** (extends the PF patch schema): `{v, meta:{name, author, license, tags[], description}, oscs[3]{mode, params, unison, wt refs}, sub, noise, filters[2], fx[], mod{envs, lfos, matrix, macros}, perf{...}, seq{...}, tunings, drums}`. Versioned; sanitized on load (port PF's hardened sanitizer: null-proto, `__proto__`-key drop, caps, link payloads may never carry executable fields).
- Presets: localStorage + IndexedDB; banks group by pack; **tags, categories, favourites, search, audition, random** (new UX, gap #6); scenes 4+ slots; undo/redo across edit states.

---

## 3. Content pipeline (recap of T8 — the exact chain)

**Day one: 10 packs / 580 presets** (STARTER 100 · ACID VAULT · TECHNO FOUNDRY · NEON STRINGS · BLADE PADS · DEEP SPACE · BASS FORGE · LEAD LAB · FX & RISERS · PERFECT TUNINGS — full table + authoring order in T8 §12).

Chain per pack: **author gate** (schema/range/naming; byte change resets `verified`) → **licence lint** (provenance DB entry per file; missing licence/attribution fails the build) → **engine witness** (apply→play→tap with verify-owned AnalyserNode, calibration canary first; band tests trap: wt witnesses are table-aware, a peak-normalised duplicate table must FAIL) → **preview render** (OfflineAudioContext, 44.1k, peak −1 dBTP then −14 LUFS-i; Ogg q4 + m4a sibling) → **manifest + targeted stamp** (id/version/licence/provenance/sha256/witness report into `index.json` + `compat.json`) → **static host** (immutable pack files, CORS `*`, no-gzip zips, `no-store` index) → **IDB install** (sha256-verified, quota-honest, `idb|ls|mem` fallbacks, boot repair pass; Firefox `file://` = RAM mode with honest chip). Nothing ships without its witness report.

---

## 4. Multi-user / community (build view — full analysis in T6)

- **P0 (with launch):** local profiles; patch/pack **export–import files**; **share links** (compact patch JSON in URL, 4–7 days); QR of short URLs. No server. **$0.**
- **P1:** optional accounts (email magic-link primary; passkey/GitHub convenience) → personal cloud patch library, cross-device sync **of patch JSON only, never audio** — **Cloudflare Workers + D1 + R2** inside free tiers ($0; $5/mo step if needed; Supabase only as fast-MVP fallback, pause trap flagged).
- **P2:** community pack store — GitHub-as-backend (repo of pack JSONs + jsDelivr CDN) + CI validation (schema/licence/sha256/witness) + verified/unverified tiers; listing mirrors into the SynthHub registry v2 model. **$0 + moderation labour.**
- **P3 (post-launch):** Yjs **patch-design rooms** (2–4 people editing one patch; presence; no live audio — latency physics). Decision pending (owner).
- Embed stance: read-only viewer path only; the studio is never framed (moddys.net currently sends `X-Frame-Options: DENY` — verified).

---

## 5. Verification (the battery — from T5 §19, mirroring PF culture)

1. **Aliasing floor per oscillator** (Blackman FFT on sustained notes; gates: mip-managed WT ≤ −80 dBc; PolyBLEP+2×OS saw/square ≤ −45 dBc ≥C4) — local measurement rig already bootstrapped (numpy runs on this machine).
2. **THD+N** clean path ≤ −70 dBc harmonics / −90 dBFS floor (provisional gates, first-run calibrated).
3. **Voice-count ramp** — the **proof-benchmark protocol** (T5 §7): in-worklet `performance.now()` ring, geometric ramp 1→64, 10 s holds, p95 < 50% of 2,667 µs + zero underruns ×3; per platform × per tier (JS/WASM, worklet/fallback). **Voice count in 01/launch copy is set from THIS, not from assumptions.**
4. **10-minute stress** (port `cdp_stress.mjs`): mixed load; heap growth < 60 MB; zero underruns at cap; pool drains; counters honest.
5. **Null tests vs frozen reference renders** (impulse + click sequence + loop; max diff < −60 dBFS for unchanged paths; frozen WAVs as CI artefacts).
6. **Cross-rate parity** (44.1/48k) + **platform matrix** (Win Chrome/Edge, macOS Chrome+Safari, Firefox, iPad Safari; hosted + `file://` smoke).
7. **Suites to port/retarget** (T9 §22): `cdp_synthx`, `cdp_depth`, `cdp_perf`, `cdp_mixvol`, `cdp_store`, `cdp_stress`, `test_midi`, `test_keys`, plus new: aliasing, THD, ramp, null; `test_live_site` for the deployed origin.
8. **Deploy loop:** `build.py` → battery → `upload-site.py --only` → `--verify` (sha in-sync) → live tests. Rollback = re-upload previous artifact (sha recorded).

---

## 6. Build sequence & milestones (estimates; gates are owner sign-offs)

| Phase | Deliverable | Exit gate |
|---|---|---|
| **P0 — Foundations (days)** | Repo scaffold; build.py port + part order; master tap + buses port; knob framework port; harness port (CDP launch laws); design tokens (teal-dark). | Build reproduces a walkable shell; smoke suite green. |
| **P1 — Worklet voice v1 (1–2 wk)** | Mixer worklet; PolyBLEP + wavetable osc; SVF; env/LFO; amp; unison; voice pool + steal; pitch/glide plumbing; **proof-benchmark run**; fallback tier for the same kernels. | Aliasing gates met; measured voice count published; 10-min stress green. |
| **P2 — Sound identity + sample core (2–3 wk)** | ACID engine (Open303-based, accent memory); STRING engine; DRUM engine (expanded kit) + pads; filters v2 (ladder); overdrive stage; **sample core begins** — buffer manager, import/decode pipeline, waveform display, drag-in. | A/B renders vs reference recordings; acid behaviour checklist from T2 passes (accent-memory test = numeric); sample import round-trip green. |
| **P3 — Depth + grains (2–3 wk)** | FX rack (12 modules; plate/FDN/Freeverb); master chain; mod matrix v2 (drag-drop, per-voice); macros; scenes; **granular engine** (Hann grains, hard grain budget) + **sampler voice, loop tools & multisample zones**. | FX battery; mod accuracy tests; grain timing + CPU budget; null tests green. |
| **P4 — Sequencing (2–3 wk)** | Native bridge + step sequencer UI; step-object model; swings/probability/ratchets/micro; chains + song rows; scenes; acid lane. | Timing tests (audio-clock); pattern import/export; groovebox shortlist smoke (T3). |
| **P5 — Content (parallel w/ P2–P4)** | 10 packs / 580 presets through the full chain; preview renders; store + IDB; SynthHub listing. | Every pack witnessed; store e2e + live tests; offline proof. |
| **P6 — Multi-user (1–2 wk)** | P0 share links/files; P1 cloud (Workers+D1+R2) if green-lit. | Share-link round-trip; sync tests; privacy review. |
| **P7 — Polish & launch (1–2 wk)** | UI flair pass (02 brief), onboarding/tour, performance view, accessibility, Safari/iPad pass, docs. | Owner's live pass on the real surface; release notes; v1 freeze + deploy + live verify. |

Effort summary: roughly **≈10–14 part-time build weeks** for v1 as now scoped (granular + sampler folded in; the shared sample core keeps the increment tight), with P5 content running parallel.

---

## 7. Risks & mitigations

- **Browser CPU for a flagship engine** — mitigated by the two-tier design, measured budgets, SAB-when-available, and the hard proof-benchmark gate before any voice-count promise. WASM (SIMD) upgrade path kept open (license-clean; C++→wasm of our own kernels; Faust offline-generator workflow allowed for isolated kernels, per-function licences checked).
- **GC/allocations in the audio thread** — allocation-free process loops, preallocated buffers, no JIT surprises (Chrome design-pattern law). Tests assert heap flatness.
- **Safari** — context-suspended start, `outputLatency` late arrival, `file://` limits; iPad smoke in the matrix; degraded-but-honest modes.
- **Scope inflation** (the ask is "everything") — phased plan above; granular/sampler/MTS/4-op-FM explicitly v1.x; flags in 05.
- **Brand/legal** — Roland lineage kept as *behaviour*, original art/naming; dittytoy = clean-room (CC BY-NC-SA); Surge factory content not shippable (annex 02); Vital factory media not shippable.
- **Content hours** (580 presets ≈ 190–580 h) — compressed by STARTER/template method + generator-assisted packs; sequenced across phases.

## 8. Pointers

- Product/design framing → `01-design-doc.md` · UI → `02-ui-design-brief.md` · build handoff → `04-agent-build-handoff.md` · open decisions & readiness → `05-spec-review.md`.
- Evidence tree → `research/` (T0 digest, T1–T9, WAVE-LOG).
- Depth corpora (GitHub scouting, 2026-10-07) → `research/github/G1–G3` + `docs/06-github-goldmine.md` — study-before-build lists: engine (MI Clouds/Rings, msfa FM), FX (Airwindows, ChowDSP), sequencer (Stochas, Helio, seq66), adopt-lib shortlist. PF sources → `C:\Users\Moddy\pattern-forge` (annexes 01–06, verify/, build.py, CONTINUATION).
