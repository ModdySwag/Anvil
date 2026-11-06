# Anvil — CONTINUATION (2026-10-06)

## RESUME HERE — SAVE 2026-11-06 18:55 (session 21). READ THIS BLOCK FIRST; everything below is history.

### STATE (proven, not claimed)
- HEAD `f18f8d2` (+ this save). Bundle `index.html` sha256
  `d3cf06aef67d9a70bed1d1c88853a30886b4d09fccb59e520f7aa417a9b16009`, **4,747,832 B**. Tree clean.
- All 23 `verify/cdp_*.mjs` pins == that sha. (`cdp_rec` carries its pin as a ternary default — the
  sweep replaces the literal old sha anywhere in `cdp_*.mjs`, so it is covered; a regex over
  `EXPECT_SHA = '<hex>'` alone would MISS it and report a freeze FAIL on green bytes.)
- **Battery c3d (`verify/battery_c3d.log`) is the clean receipt: 28/28 suites exit=0 FIRST-LAP, zero
  reds**, bench exit=0, alias exit=0, stress **65** underrun deltas (verdict `asserts-not-met` = the
  documented load class, not a failure). Stress receipt: `verify/last-cdp_stress.log` @ 18:32:43.
  Earlier stress readings of 376 / 543 were contamination, not regression (see traps).
- Bench knee 96/128 monotone, realtime 64/64; alias VA −58.18 / WT −91.21 dBc, determinism
  `maxAbsDiff 0` — byte-identical to C1/C2, so everything done today is provably DSP-inert.

### WHAT LANDED TODAY (all committed)
1. `8524179` **C2b-8 — the glass.** Row 3 (VOICES · CPU · tempo) fitted by resetting three C1-era rules
   (green leading-label paint, the tempo's transport-window box, the absolute-pinned POLY) and giving
   the CPU slot 8ch — NOT by shrinking to 9px and hiding the CPU readout (which is what the C2b-2
   session had done). 136.9px of content in 145; tempo 5px inside the glass. `K22` pins row/field fit
   at 1440 AND 1280.
2. `9faf8b4` **C3-1 — density floor + the gate.** Narrow-width rhythm (zone 10/12/14, gap 8, card
   12/14) took sessions 1.22→1.19, tune 1.23→1.17, family 1.23→1.19. `K23` pins a CLAIMED list of
   page/sub views at ≤1.2× the well at both widths (18 views claimed now).
3. `2ec225f` **C3-2 — MIX folds** (owner's call: disclosure, not sub-tabs). SENDS · GLUE · MASTER ·
   AUTO-MIX · A/B behind one chip row; tracks/meters/render/offline note stay on the face.
   **2.14/2.53 → 0.93/1.20.** `cdp_mix` gained leg 1b2 (46→47 checks).
4. `de0144f` **C3-3 — MIDI folds.** PLAY IN · CLOCK OUT · MPE · CC→PARAM · both monitors behind chips;
   WEB MIDI / INPUTS / OUTPUTS stay. `cdp_midi`'s `clickSel` now expands folds before coordinate clicks.
5. `8637504` **C3-3b — the MPE hole.** MPE's wrapper is a plain div, not `.av-midi-sec`, so the fold
   class had no CSS to act on (MPE stayed visible while marked folded). Generic `.av-sec-collapsed`
   rule + the missing 1b2 leg in `cdp_midi` (**34 checks**). **system/midi 0.88 at 1280.**
6. `06d3611` `.gitattributes` (`index.html`/`sw.js` `-text`) · `6d70df3` corrected the C3-1 battery
   claim · `32ed421` stress truth · `f18f8d2` markup survey.

### THE FOLD MECHANISM (proven twice — copy it, don't reinvent)
- Resolve the CARD, not the host: `var card = root.querySelector('.av-mix') || root;` — the first
  attempt appended the chip row BESIDE `.av-mix`, visually identical but invisible to card-scoped
  queries.
- One `.av-mix-adv` row of `.av-adv-chip` buttons (`data-adv=<sect>`); sections get `.av-sec-collapsed`;
  the section head/label gets a `.av-sec-toggle`; `sync()` keeps `chip.hidden` and `aria-expanded`
  honest. Folded = `display:none` via the GENERIC `.av-sec-collapsed` rule (any wrapper works — that is
  what MPE taught).
- Implementations: `avMixUiDisclosure()` in `src/av_mix_ui.js`; `avMidiFoldInit()` in `src/av_midi.js`;
  both called immediately after `host.innerHTML = …`.
- Rig coverage: `cdp_mix` 1b2 and `cdp_midi` 1b2 assert folded-default, chip labels, face intact,
  chip expands, toggle folds back. `cdp_midi`'s `clickSel` must expand `.av-adv-chip`s before it clicks
  (it clicks by coordinates and refuses `display:none` targets).

### WHAT REMAINS — C3 page rebuilds (measured at 1440/1280)
sound/engine 1.88/2.26 · effects 1.86/2.23 · system/code 1.61/1.89 · sequence 1.53/1.81 ·
sound/fm 1.53/1.78 · sound/wt 1.52/1.77 · sound/chop 1.40/1.62 · shape/matrix 1.31/1.54 ·
sound/drums 1.17/1.34.
- **Only `av-mix` (10 section blocks) and `av-midi` (9) were foldable as-is.** `av_synth` has ONE
  `.av-synth-sec` (MODS); `av_fx`, `av_seq` and `av_code` are unsectioned monolithic builders (probed:
  no section classes, no headings). Each needs `data-sect` hooks written into its module FIRST — that is
  per-module UI work, not a copy-paste of the helper.
- Plus the six planned C3 screens (docs/13 §C3): filters group inside the SOUND engine card · envelopes
  group (amp/filter/aux overlaid) · per-slot EFFECTS screens (drive curve, dyn GR, delay taps, verb
  tail, mod shape) · MIX EQ curve + per-track mini waveform · SHAPE routing graph · SEQUENCE
  arrangement overview.
- `shape/matrix`: a two-column attempt measured WORSE (1.31→1.35 — compacting its 8-track slot grid
  makes each row taller). It needs a real slot redesign, not a wrapper.
- Lever already identified: `av-levels` (222px) is zone-level in SOUND and rides every sub-tab; moving
  it flips drums (1.34→~0.88) but it is in `cdp_cockpit`'s ZONEMAP and `cdp_knob_feel`/`cdp_a11y`
  measure its master knob — a move must update those rigs and re-pin.

### THEN
- **C4** control language (steppers, pairs, groups sweep) · **C5** disclosure everywhere + focus order +
  tab semantics + advanced-collapsed defaults · **C6** shots, pins, battery, installer, deploy
  (v1.15.0 assets; README shots and the downloads card refresh at C6).
- Open from C2: mono is not per-patch (`env.mono` is not in the pack/preset schema); latency/buffer has
  no LCD cell (`verify/_c2_wave.md` §5).

### TRAPS PAID TODAY (do not repeat)
- **autocrlf**: `git checkout -- index.html` rewrote it to CRLF and moved the sha off the pin
  (`aa3641b4` vs pinned `d2cbe864`) — every rig would have reported a freeze FAIL on correct code.
  `.gitattributes` now marks `index.html`/`sw.js` `-text`. If a checkout ever moves the sha, REBUILD.
- **Pin sweep**: old→new only. `cache/scratch/sweep_pins.py --old <sha>` for uncommitted rebuilds
  (deriving from `git show HEAD:index.html` is wrong when you rebuild before committing). Never sweep
  "any 64-hex that isn't current" — it rewrites the `sha256("abc")` vector in `avpack_check.mjs`.
- **`Target crashed`**: a headless renderer abort reports `exit=1 ok=0 fail=0`; no assertion ran, so it
  reads as a total regression. Re-run solo and bisect on a rebuilt bundle before touching code (it hit
  `cdp_s4` twice, then passed 42/42 three times on identical bytes; a no-density rebuild was clean too).
- **Never run a second browser during a battery.** A solo `cdp_sessions` during battery c3c's stress
  inflated it to 376 deltas; the follow-up read 543 on Edge teardown. Both were contamination — the
  clean battery read 65. If stress is 10× off trend, suspect what else you ran, not the build.
- **K23 null safety**: `null <= 1.2` is TRUE in JS, so a broken measurement passes the gate silently.
  The leg fails on a null ratio now. Build ids by concatenation (`'av-zone-' + "browse"`).
- **`cdp_cockpit` pane scroll**: the law is "the window never scrolls; the pane scrolls only when its
  content is taller than the pane" — the old "the mix page always overflows" assumption broke the
  moment the page started fitting.

### FIRST MOVES NEXT SESSION
1. Read this block. Run `node verify/cdp_chassis.mjs` and `node verify/cdp_mix.mjs` to confirm the tree
   is still green at this sha before changing anything.
2. **Owner eye pass** on the two folded pages (MIX, SYSTEM→MIDI) — his gate, not a screenshot.
3. Section `av_fx` (1,094px, worst heavy card): add `data-sect` to its rack/slot blocks, fold the deep
   ones, add a 1b2-style leg to `cdp_fx`, claim `effects` in K23, battery, commit.
4. Then `av_synth` (section it first), `av_seq`, `av_code`; then the six planned screens; then C4–C6.

