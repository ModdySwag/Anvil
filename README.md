# anvil — Anvil (a MODDYS Foundry instrument)

A flagship web synthesizer for Moddy (moddys.net), in the Pattern Forge family: pro-grade
multi-engine sound (acid / wavetable / FM / string / drums / granular / sampler), a
groovebox-grade sequencer, an FX rack, ten factory packs, and multi-user options
(share links → cloud libraries → community store). **Free** — no monetisation.

Status 2026-10-07: **S2.1 takes & comping in — take lanes, pick-best comping, trims + equal-power crossfades; render + WAV export.**
The instrument carries P1–P6 + S1 + S2 + S2.1: the comp engine stitches the studio's takes (winner-clamped
trims · equal-power crossfade seams · a 5-minute render cap) and exports a fresh WAV; comps live in memory
for the session (the WAV is the durable artifact). The sessions layer versions the whole working state (16
per session) with autosave + crash recovery, and the backup zip carries sessions + samples + installed
packs. The store serves 9 packs / 548 presets (sha-256 verified installs · IndexedDB · offline-ready).
Frozen `index.html` sha 0f79ebc2… (1,742,403 B): battery smoke 20 · comp 41 · sessions 41 · studio 37 ·
bounce 32 · store 28 · feel 18 · keys 27 · midi 33 · sample 29 · rec 29 · fx 27 · seq 31; **the perf gate
ran on a loaded machine — the full run's knee read 64, and a back-to-back offline A/B (S2 control bytes
vs S2.1, byte-identical engine) reads the identical knee 96/128 on BOTH builds (environment, not
regression; quiet-window re-run queued)**. Next: S3 mix/master · deck · popout keyboard · CODE · help
then P7 polish → deploy + owner pass. Resume at `CONTINUATION-2026-10-06.md` addendum 27.

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
