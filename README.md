# anvil — Anvil (a MODDYS Foundry instrument)

A flagship web synthesizer for Moddy (moddys.net), in the Pattern Forge family: pro-grade
multi-engine sound (acid / wavetable / FM / string / drums / granular / sampler), a
groovebox-grade sequencer, an FX rack, ten factory packs, and multi-user options
(share links → cloud libraries → community store). **Free** — no monetisation.

Status 2026-10-07: **DECK pro readouts in — a live oscilloscope, spectrum and spectrogram waterfall off the master tap, LUFS + true-peak meters, and engine voice/CPU readouts with a note ticker (the capture surface for the upcoming video deliver extra).**
The instrument carries P1–P6 + S1–S3 + the deck in one single-file page: the studio chain builds a
mixdown from takes, comps and the engine pattern (per-track gain / pan / send rails / ducking /
insert FX · a verb + delay send pair · bus glue · the master chain with normalize + dither), renders
it offline and deterministically in memory, and exports 16/24/32f WAVs; A/B plays the mixdown against
a loudness-matched reference. The deck attaches to the live master tap read-only (its own analysers;
offline renders are never metered) and adds no engine cost — the worklet sha `6e66274e…` is unchanged.
The comp engine stitches the studio's takes; sessions version the whole state; the store serves 9
packs / 548 presets. Frozen `index.html` sha 45cc39d7… (2,065,214 B): battery ALL GREEN — 15 suites
(smoke 22 · studio 37 · sessions 41 · comp 41 · mix 46 · feel 18 · keys 27 · midi 33 · sample 29 ·
rec 29 · fx 27 · seq 31 · store 28 · bounce 32 · deck 35); offline knee 128 @ 49.42% budget
(bench-v15 — the deck adds no offline cost); **stress ×2 attributed environment on an active-console
machine — the S3-bytes control run read the same burst shape while the deck is provably inert**.
Next: S4 deliver extras · popout keyboard · CODE · help then P7 polish → deploy + owner pass.
Resume at `CONTINUATION-2026-10-06.md` addendum 29.

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
