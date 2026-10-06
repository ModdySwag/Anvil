# anvil — Anvil (a MODDYS Foundry instrument)

A flagship web synthesizer for Moddy (moddys.net), in the Pattern Forge family: pro-grade
multi-engine sound (acid / wavetable / FM / string / drums / granular / sampler), a
groovebox-grade sequencer, an FX rack, ten factory packs, and multi-user options
(share links → cloud libraries → community store). **Free** — no monetisation.

Status 2026-10-07: **P1 core in — aliasing gate CLOSED (P1.x)** — worklet voice engine live
(minBLEP "Classic" + wavetable osc · TPT SVF · env/LFO · unison/glide · pool + steal). Frozen
`index.html` sha 56734133… (259,387 B): battery smoke 11/11 · feel 18/18 · keys 27/27 · midi 33/33;
alias rig v2 (4-term Blackman-Harris metric): 30/30 PASS — VA worst −58.2 dBc, WT worst −91.2 dBc
(gates −45/−80); **measured: 128 voices at 47.6 % of the audio budget** (offline ramp, delivery-
verified; minBLEP ≈ +20 % vs the polyBLEP ship). Stress ×2 at cap 64: all dimensions green except
rare deadline crossings under unison-heavy churn (one cold-start delta, reproduced both runs, plus
hot uni-7 probe cycles) — recorded raw; cost-optimisation pass queued (docs/07 P·2). Next: P2 sound
identity (acid/string/drum + sample core + recorder). Resume at `CONTINUATION-2026-10-06.md`
addendum 12.

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
