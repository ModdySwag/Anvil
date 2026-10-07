# anvil — Anvil (a MODDYS Foundry instrument)

A flagship web synthesizer for Moddy (moddys.net), in the Pattern Forge family: pro-grade
multi-engine sound (acid / wavetable / FM / string / drums / granular / sampler), a
groovebox-grade sequencer, an FX rack, ten factory packs, and multi-user options
(share links → cloud libraries → community store). **Free** — no monetisation.

Status 2026-10-07: **P5 store in — the instrument now ships P1–P5.** Worklet voice engine (minBLEP
"Classic" + wavetable, alias gates CLOSED), ACID/STRING/DRUM engines, sample core + recorder, FX
rack + mod matrix + granular/sampler, the P4 groovebox sequencer, and the P5 pack store (sha-256
verified installs · IndexedDB · offline-ready; three first-party banks — STARTER 100 · ACID VAULT ·
TECHNO FOUNDRY, all 228 presets re-witnessed). Frozen `index.html` sha 1c2f112c… (1,126,117 B):
battery smoke 16 · store 28 · feel 18 · keys 27 · midi 33 · sample 29 · rec 29 · fx 27 · seq 31;
**measured: 128 voices at 48.3 % of the audio budget** (offline ramp; engine byte-identical since
the P1.x minBLEP ship). Stress ×2 at cap 64: everything green except the known margin profile
(one cold-start delta + unison-heavy probe windows — recorded raw; console active both runs).
Next: P5.1/P5.2 content waves + the studio beats, then P6–P7 share/cloud, deploy + owner pass.
Resume at `CONTINUATION-2026-10-06.md` addendum 21.

## Build
    python3 build.py    # src/ → index.html (explicit js_parts order; node --check guard; sha printed)

## Read first
1. `docs/01-design-doc.md` — the product (vision, features, phases).
2. `docs/05-spec-review.md` — decisions recorded + verification lists.
3. `docs/00-idea-capture.md` — the trigger and the seed.

## The docs
`docs/00-idea-capture.md` · `01-design-doc.md` · `02-ui-design-brief.md` ·
`03-implementation-spec.md` · `04-agent-build-handoff.md` · `05-spec-review.md`

## The research (evidence tree — all parent-verified)
- `research/tabs/` — T0 tab digest (the seed) + raw ditty sources · T1 dittytoy deep-dive
- `research/acid/T2` · `groovebox/T3` · `matrix/T4` · `engine/T5` · `multiuser/T6` · `ui/T7` ·
  `packs/T8` · `reuse/T9` (Pattern Forge inventory)
- `research/github/` — G1–G3 GitHub scouting (goldmine addendum: `docs/06`)
- `research/WAVE-LOG.md` — verification log + decisions + Phase-0 kickoff

## Laws (see docs for detail)
lab → battery → frozen bytes → deploy; witness laws (own AnalyserNode on the master tap,
wavetable witnesses table-aware); licences (MIT/ISC/Apache code; own/CC0/PD content;
dittytoy clean-room; Open303 = acid foundation); fairness spine (local-first, free);
hidden spawns only; one writer per file.
