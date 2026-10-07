# anvil — Anvil (a MODDYS Foundry instrument)

A flagship web synthesizer for Moddy (moddys.net), in the Pattern Forge family: pro-grade
multi-engine sound (acid / wavetable / FM / string / drums / granular / sampler), a
groovebox-grade sequencer, an FX rack, ten factory packs, and multi-user options
(share links → cloud libraries → community store). **Free** — no monetisation.

Status 2026-10-08: **M1 sound depot in — the FM engine (6 operators · 8 algorithms · DX-style envelopes — a full voice kind with its own operator card), the studio FLAVOUR bank (console · tape · drive · air · warm), convolution IRs (true-stereo partitioned FFT · six factory spaces + your own impulse import), and the wavetable editor (draw · spectral tools · frame morphing · your own tables into OSC2, with a local library). Plus the FX rack and mod matrix finally got their card skins.**
The instrument carries P1–P6 + S1–S5 in one single-file page: the studio chain builds a mixdown from
takes, comps and the engine pattern (per-track gain / pan / send rails / ducking / insert FX · a verb +
delay send pair · bus glue · the master chain with normalize + dither), renders it offline and
deterministically in memory, and exports 16/24/32f WAVs; A/B plays the mixdown against a
loudness-matched reference. The deck attaches to the live master tap read-only; the S5 CODE section
evaluates user module source inside the audio worklet (the probe-verified `new Function` path), adds it
to the live engine and keeps a local module library; the popout keyboard adopts the 61-key bed into its
own window with key forwarding; help ships the shortcut map, the 60-second tour, tooltips and the four
outcome guides; the palette runs 41 commands from Ctrl-K. Nothing uploads — every artifact is local.
The comp engine stitches the studio's takes; sessions version the whole state; the store serves 9 packs
/ 548 presets. Frozen `index.html` sha d311eaf8… (2,933,715 B): battery ALL GREEN — 20 suites (smoke 26 ·
studio 37 · sessions 41 · comp 41 · mix 46 · feel 18 · keys 27 · midi 33 · sample 29 · rec 29 · fx 27 ·
seq 31 · store 28 · bounce 32 · deck 35 · s4 37 · s5 36 · code 36 · m1 33); the perf-gate bench knee is
unchanged (128 · monotone) and the stress window read quieter than the previous record (no control
needed); the worklet sha changed by design (FM + FLAVOUR + CONV joined the worklet concat; all off by
default). The FM card renders every operator's knobs so share links stay compact.
Next: P7 polish (accessibility #79) → deploy + live verify + owner pass. Frozen `b34a28b6` — battery 21 suites green (platform wave closed 2026-10-08).
Resume at `CONTINUATION-2026-10-06.md` addendum 32.

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
