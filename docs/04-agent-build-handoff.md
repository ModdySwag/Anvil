# 04 — Agent build handoff (Anvil v1)

For a fresh build agent (or a future session) with no memory of the research that produced this package. Read in order: `01-design-doc.md` → `02-ui-design-brief.md` → `03-implementation-spec.md` → the `research/` evidence files this handoff cites (esp. T2 acid, T3 sequencer, T5 engine, T8 packs, T9 reuse). The Pattern Forge codebase at `C:\Users\Moddy\pattern-forge` is the primary reuse source (read-only until you fork working copies per the lane rules).

---

## 1. Mission

Build and ship **Anvil v1**: a flagship, browser-based, multi-engine synthesizer (acid/wavetable/FM/string/drum engines, groovebox-grade sequencer, performance layer, FX rack, ten factory packs, share-links + optional cloud/community layers), in the Pattern Forge family's engineering culture. It must open in a tab and make a producer's first sound in under two minutes — and survive an engineer's A/B against reference hardware.

## 2. Non-negotiables (violating any = stop and escalate)

1. **Lab → battery → frozen bytes → deploy.** Freeze the artifact before running suites; never rebuild mid-battery. No artifact ships without an engine-witness report.
2. **Witness laws.** Tests install their own `AnalyserNode` on the master tap and route the synth blend; panel reads are not witnesses. Wavetable-bank witnesses are table-aware (peak-normalised duplicate must FAIL).
3. **Master tap first.** Port `pfInstallAudioTap` semantics before anything else; synth routes through the tap, never `ctx.destination` directly.
4. **Build guards stay loud.** Explicit `js_parts` order list (unlisted file = fail loudly, not silence); `</script` guard; duplicate top-level declaration check via `node --check`.
5. **Licences.** Code: MIT/ISC/Apache/Unlicense only, verified from files (Open303 = MIT is the acid foundation; MoogLadders = Unlicense). GPL-family = clean-room with attribution. Content: own-authored / CC0 / PD (CC-BY with manifest). Banned outright: Vital factory media, Surge factory content, ditty sources (CC BY-NC-SA), Roland/D16/Behringer trade dress.
6. **Fairness spine.** Local-first; no accounts required for full sound use; no credits/metering/dark patterns; export everything; CC0-first content with provenance manifests.
7. **Machine etiquette (Moddy's box).** No console windows; hidden spawns only (CNW); ask before installing anything; no git pushes without instruction; one writer per file (lane ownership); never run builds/deploys that weren't asked for.
8. **Contracts culture.** Every stage gets a `STAGE-##-CONTRACT.md` (API freezes, laws, return-channel format); laws that cost blood are recorded where the next agent will read them.

## 3. Architecture in one breath

Single-file app (`src/` → `build.py` → `index.html`, sha-printed) hosting an **AudioWorklet-first engine**: one mixer worklet (all voices + FX), sample-accurate audio-clock scheduling, workers for offline jobs, SAB ring when the host enables cross-origin isolation, `postMessage` otherwise; the same `Float32Array` kernels re-serve a `file://` fallback tier (node-graph + ScriptProcessor). Device-rate live rendering; 44.1/48 kHz offline exports. Patch JSON v2 (versioned, sanitised); packs = evolved `.pfsynth` with provenance manifest + witness report; IndexedDB install. Full detail: `03`.

## 4. Phases → tasks → gates (build in order; gates are owner-visible)

**P0 — Foundations.** Repo scaffold; `build.py` port (+order list +guards); master tap + buses port; knob framework port; harness port (CDP launch laws: device metrics override, mute-audio, temp profile, exit codes); theme token file (Anvil Teal); smoke suite green.
**P1 — Worklet voice v1.** Mixer worklet; PolyBLEP + minBLEP oscillators; wavetable (2048-frame, mipmapped, cubic); SVF; env/LFO; unison; voice pool + oldest-first steal; **run the proof-benchmark protocol (T5 §7) — publish the measured voice count**; fallback tier executes the same kernels. Gates: aliasing floors met; 10-min stress flat.
**P2 — Sound identity + sample core.** ACID engine (Open303-based: 4-pole C/2 filter, accent memory = numeric test, slide, EXPANDED mods panel); STRING engine (KS + pluck-position comb + humanisation); DRUM engine (expanded kit, pads, kit bus); ladder filter; overdrive stage; **sample core begins** (buffer manager, import/decode, waveform display, drag-in). Gates: acid checklist passes; A/B renders archived; sample import round-trip green.
**P3 — Depth + grains.** FX rack (12 modules incl. Dattorro plate + FDN + Freeverb, cross-feedback delay, chorus/flanger/phaser, drive/fold, bitcrush, EQ, comp, limiter); master chain; per-voice mod matrix (drag-drop, ≥32 connections, remap curves); 8 macros; scenes; **granular engine**; **sampler voice, loop tools & multisample zones**. Gates: FX battery; mod accuracy; grain timing + CPU budget; null tests.
**P4 — Sequencing.** Native event queue + audio-clock scheduler (replace setInterval; keep arbitration laws verbatim); step-object model; step UI (grid + acid lane); swing/probability/ratchets/micro/parameter-locks; chains + song rows; scenes; per-track lengths/speed. Gates: timing tests; groovebox shortlist smoke (T3 §).
**P5 — Content (parallel P2–P4).** 10 packs / 580 presets through the chain: author gate → licence lint → engine witness → preview render (−1 dBTP → −14 LUFS-i, Ogg q4 + m4a) → manifest/stamp → store → IDB install; SynthHub listing. Gate: every pack witnessed; store e2e + offline proof + live tests.
**P6 — Multi-user (per owner).** P0 share links/files (launch set; sanitised payloads, no executable fields from links); P1 Cloudflare Workers+D1+R2 (patch JSON only; never audio). Gates: share round-trip; sync tests; privacy review.
**P7 — Polish & launch.** UI brief conformance pass (screenshots at 1440/1180/900); onboarding/tour; performance view; a11y gates; Safari/iPad; docs; live deploy + verify; owner's real-surface pass.

## 5. Testing & verification (commands/methods)

- Suites to port/retarget from PF `verify/`: `cdp_synthx`, `cdp_depth`, `cdp_perf`, `cdp_mixvol`, `cdp_store`, `cdp_stress`, `test_midi`, `test_keys`; new: aliasing, THD+N, voice-ramp, null-vs-frozen-references, cross-rate parity.
- Battery runner (sequential, per-suite logs, honest counts); freeze artifact first; flakes recorded with evidence.
- Deploy loop: `python3 build.py` → battery → `upload-site.py --only <files>` → `upload-site.py --verify` (sha in-sync) → `node verify/test_live_site.mjs`. Rollback = re-upload previous artifact.
- Per-phase evidence pack: suite logs + screenshots + sha + witness reports. No phase is "done" without the pack.

## 6. Acceptance criteria (v1 done-means)

1. New user: link → playable acid line <60 s, zero console errors, no account.
2. Engine gates: aliasing/THD thresholds met; **voice count published from the measured ramp**; 10-min stress: heap flat, zero underruns at cap; null tests green; 44.1/48 parity.
3. Acid numerics: accent-memory behaviour test passes; filter transfer matches the T2 reference within tolerance.
4. Sequencer: swing/ratchet/probability timing verified; pattern import/export; parameter locks round-trip.
5. Packs: 10/10 witnessed, installed offline, previews rendered, provenance manifests present; store live-verified.
6. Share: patch link round-trip across browsers; no executable payloads from links (sanitizer suite).
7. UI brief conformance (screens + states + a11y gates), performance budget enforced.
8. Deployed to moddys.net with byte-verified sha, live tests green, rollback artifact recorded; owner's live pass completed.
9. Sampler & granular: sample import round-trip (WAV/FLAC/MP3), grain scheduling timing + CPU budget verified on the ramp rig, loop tools null-tested.

## 7. Kickoff prompt (paste-ready)

> You are building **Anvil v1** for Moddy (moddys.net) in the Pattern Forge family. Read `C:\Users\Moddy\anvil\docs\01-design-doc.md`, `02-ui-design-brief.md`, `03-implementation-spec.md`, then the cited `research/` files. Reuse Pattern Forge's proven infrastructure per `research/reuse/T9-pattern-forge-reuse.md` (build pipeline, master tap, packs store, harness — port first). Start with Phase 0 from `04 §4`. Work through the lab → battery → frozen bytes discipline: every stage ends with suite evidence + a contract note; never claim success without the artifact. Escalate the owner decisions listed in `05-spec-review.md` before building anything that depends on them. Ask before installing tooling; never open console windows on the user's desktop.

## 8. Superpowers / session handoff notes

- Keep evidence in `C:\Users\Moddy\anvil\` alongside the docs; one writer per file; contracts per stage (STAGE-##-CONTRACT.md pattern).
- Record every law/trap discovered into the stage contract *and* the relevant skill before finishing a session.
- Update `README.md` (artifact map) and append to `research/WAVE-LOG.md` when a build wave completes.
- When in doubt: prefer the smaller change that keeps the family laws (tap first, freeze law, loud guards, honest UI).
