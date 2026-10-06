# anvil — Anvil (a MODDYS Foundry instrument)

A flagship web synthesizer for Moddy (moddys.net), in the Pattern Forge family: pro-grade
multi-engine sound (acid / wavetable / FM / string / drums / granular / sampler), a
groovebox-grade sequencer, an FX rack, ten factory packs, and multi-user options
(share links → cloud libraries → community store). **Free** — no monetisation.

Status 2026-10-07: **Phase 0** — build pipeline, shell, master tap and the knob framework live;
`index.html` sha 0a6b6232… (40,215 B); feel suite `verify/cdp_knob_feel.mjs` 18/18;
shots `renders/p0-knobs*.png`.
Next: CDP smoke suite → then P1 worklet engine + voice benchmark.
Resume at `CONTINUATION-2026-10-06.md`.

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
