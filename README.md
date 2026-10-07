# anvil — Anvil (a MODDYS Foundry instrument)

A flagship web synthesizer for Moddy (moddys.net), in the Pattern Forge family: pro-grade
multi-engine sound (acid / wavetable / FM / string / drums / granular / sampler), a
groovebox-grade sequencer, an FX rack, ten factory packs, and multi-user options
(share links → cloud libraries → community store). **Free** — no monetisation.

Status 2026-10-07: **S1 record core in — mic/line input, count-in metronome and lap takes ship.**
The instrument carries P1–P6 plus the first studio wave: audio input riding the engine's own context
(same-context law · monitor off by default), a lookahead click scheduler with a 1–4-bar count-in,
and lap takes that split at sequencer cycle boundaries with one-click WAV export — all driven by the
Studio card. The store serves 9 packs / 548 presets (sha-256 verified installs · IndexedDB ·
offline-ready). Frozen `index.html` sha 75c9c2eb… (1,448,104 B): battery smoke 18 · studio 37 ·
bounce 32 · store 28 · feel 18 · keys 27 · midi 33 · sample 29 · rec 29 · fx 27 · seq 31;
**measured: realtime published {light 64 · fat 64} · offline 128 voices** (knee monotone; engine
byte-identical since the P1.x minBLEP ship). Stress ×2: the known margin profile only (one cold-start
delta + unison-heavy probe windows — recorded raw). Next: the next studio waves (sessions ·
mix/master · deck · popout keyboard · CODE · help) then P7 polish → deploy + owner pass. Resume at
`CONTINUATION-2026-10-06.md` addendum 25.

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
