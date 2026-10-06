# anvil — Anvil — project package

A flagship web-based synthesizer for Moddy (moddys.net), in the Pattern Forge family: pro-grade
multi-engine sound (acid / wavetable / FM / string / drums), a groovebox-grade sequencer, an FX
rack, ten factory packs, and multi-user options (share links → cloud libraries → community store).
**Status 2026-10-06: research complete + plan package written — awaiting owner review + decisions.**

## Read first
1. `docs/01-design-doc.md` — the product (what we're building and why; decisions needed).
2. `docs/05-spec-review.md` — readiness gate + the consolidated owner decisions + verification list.
3. `docs/00-idea-capture.md` — the trigger and the seed.

## The docs
- `docs/00-idea-capture.md` — capture + condensed interview (defaults taken; owner decisions listed)
- `docs/01-design-doc.md` — design doc (vision, features, phases, non-goals)
- `docs/02-ui-design-brief.md` — screens, interaction grammar, palettes (teal), a11y, flair moves
- `docs/03-implementation-spec.md` — architecture, reuse map, engine/content specs, verification
- `docs/04-agent-build-handoff.md` — build-ready handoff (phases → tasks → gates, kickoff prompt)
- `docs/05-spec-review.md` — readiness: PASS WITH CHANGES + decisions + options needing verification

## The research (evidence tree — all parent-verified)
- `research/tabs/` — T0 tab digest (the seed: Dittytoy ditties + the acid trail) + raw ditty sources
- `research/tabs/T1-dittytoy-deepdive.md` · `research/acid/T2-acid-heritage.md` · `research/groovebox/T3-groovebox-sequencing.md`
- `research/matrix/T4-synth-feature-matrix.md` · `research/engine/T5-web-audio-engine.md` · `research/multiuser/T6-multi-user-architecture.md`
- `research/ui/T7-ui-flair.md` · `research/packs/T8-content-packs.md` · `research/reuse/T9-pattern-forge-reuse.md`
- `research/WAVE-LOG.md` — verification log (spot-checks, corrections, conflicts, fold-ins)

## Laws this project inherits (see docs for detail)
- Lab → battery → frozen bytes → deploy; nothing ships without an engine-witness report.
- Master tap first; verifiers own their AnalyserNode; wavetable witnesses are table-aware.
- Licences: code MIT/ISC/Apache/Unlicense (verified per file); content own/CC0/PD/CC-BY-manifest;
  dittytoy = clean-room (CC BY-NC-SA); Open303 (MIT) = the acid DSP foundation.
- Fairness spine: local-first, no credits/metering, open formats, CC0-first with provenance.
- Machine etiquette: hidden spawns only, ask before installs, one writer per file.
