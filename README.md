# anvil — Anvil (a MODDYS Foundry instrument)

A flagship web synthesizer for Moddy (moddys.net), in the Pattern Forge family: pro-grade
multi-engine sound (acid / wavetable / FM / string / drums / granular / sampler), a
groovebox-grade sequencer, an FX rack, ten factory packs, and multi-user options
(share links → cloud libraries → community store). **Free** — no monetisation.

Status 2026-10-07: **S3 mix & master in — per-track FX + send rails, bus glue, the master chain (LUFS/true-peak normalize targets + export dither), an auto-mix assistant and A/B reference.**
The instrument carries P1–P6 + S1–S3 in one single-file page: the mix desk builds a mixdown from takes,
comps and the engine pattern (per-track gain / pan / send rails / ducking / insert FX · a verb + delay
send pair · bus glue · the master chain with normalize + dither), renders it offline and deterministically
in memory, and exports 16/24/32f WAVs; A/B plays the mixdown against a loudness-matched reference. The
comp engine stitches the studio's takes; sessions version the whole state; the store serves 9 packs /
548 presets. Frozen `index.html` sha 859a897d… (1,960,270 B): battery ALL GREEN — 14 suites (smoke 21 ·
studio 37 · sessions 41 · comp 41 · mix 46 · feel 18 · keys 27 · midi 33 · sample 29 · rec 29 · fx 27 ·
seq 31 · store 28 · bounce 32); **the perf gate ran on an active-console machine — the offline knee
reads 96/128 here exactly as in the S2.1-era byte-identical A/B (environment, not regression)**.
Next: S4 deliver extras · deck · popout keyboard · CODE · help then P7 polish → deploy + owner pass.
Resume at `CONTINUATION-2026-10-06.md` addendum 28.

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
