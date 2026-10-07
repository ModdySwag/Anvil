# anvil — Anvil (a MODDYS Foundry instrument)

A flagship web synthesizer for Moddy (moddys.net), in the Pattern Forge family: pro-grade
multi-engine sound (acid / wavetable / FM / string / drums / granular / sampler), a
groovebox-grade sequencer, an FX rack, ten factory packs, and multi-user options
(share links → cloud libraries → community store). **Free** — no monetisation.

Status 2026-10-07: **S2 sessions in — versioned snapshots, autosave + crash recovery, and a one-press backup zip.**
The instrument carries P1–P6 + S1 + S2: the sessions layer versions the whole working state (16 per
session), autosaves while you work and offers crash recovery on the next load, and the backup zip
carries sessions + samples + installed packs (store-method reader · sha-256-verified restore). The
store serves 9 packs / 548 presets (sha-256 verified installs · IndexedDB · offline-ready). Frozen
`index.html` sha 31087322… (1,635,639 B): battery smoke 19 · sessions 41 · studio 37 · bounce 32 ·
store 28 · feel 18 · keys 27 · midi 33 · sample 29 · rec 29 · fx 27 · seq 31; **the perf gate ran on
a loaded machine — bench read 96 with realtime fat 48, and a back-to-back A/B against the S1 control
bytes under the same conditions shows the identical knee (environment, not regression; engine
byte-identical since the P1.x minBLEP ship; quiet-window re-run queued)**. Next: S2.1 takes &
comping · S3 mix/master · deck · popout keyboard · CODE · help then P7 polish → deploy + owner pass.
Resume at `CONTINUATION-2026-10-06.md` addendum 26.

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
