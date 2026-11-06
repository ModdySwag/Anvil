# C4 — CONTROL LANGUAGE: the measured sweep plan

Read with `docs/13-chassis-fsvr.md` §5 (the control table) and §C4 (the wave scope).
This document is the **audit**, not the work. Nothing here is implemented yet.

## What C4 is meant to do (docs/13 §5)

| Job | Control | Status in the app today |
|---|---|---|
| continuous | `.av-pot` (`av_knob.js`) | exists and is the whole app's knob |
| continuous, wide | `.av-fader` | **does not exist** — no fader class is shipped |
| two-choice | `.av-pair` silver key pair, `role=radio` | **does not exist** |
| number | `.av-num` value field + down/up steppers | **does not exist** |
| group | `.av-group` box + `.av-group-tab` title tab | **does not exist** |
| lit | ONE accent `--zone-accent`, text under a lit control | shipped |

So C4 is **net-new control classes plus a conversion sweep**, not a restyle of existing classes.

## The measured inventory (2026-11-07, session 24)

Method: one headless walk of **every page and sub-tab** at 1440x900, counting only VISIBLE controls
(`cache/scratch/c4audit.mjs`, raw data in `cache/scratch/c4audit.json`).

| control | count |
|---|---|
| `<select>` total | **49** (3 with 2 options · 6 with 3 · 35 with many) |
| `input[type=number]` | **2** |
| `input[type=range]` | 10 |
| `<input type=checkbox>` | 7 |
| `.av-pair` | **0** |
| `.av-group` | **0** |

Per page, the pages that carry selects:

| page | selects | 2-opt | 3-opt | many | numbers |
|---|---|---|---|---|---|
| sequence/- | 16 | – | – | 16 | – |
| sound/tune | 6 | – | – | 6 | – |
| sound/engine | 4 | – | – | 4 | – |
| browse/sessions | 3 | – | 1 | 1 | – |
| mix/mix | 3 | 1 | 1 | 1 | – |
| mix/studio | 3 | – | 1 | 1 | 1 |
| deliver/deck | 2 | – | 1 | 1 | – |
| deliver/deliver | 2 | **1** | – | 1 | – |
| system/family | 2 | – | 1 | 1 | – |
| effects/- | 2 | – | 1 | 1 | – |
| sound/fm · sound/chop · sound/wt · shape/lfo | 1 each | – | – | 1 | – |
| system/code | 1 | **1** | – | – | – |
| mix/comp | 1 | – | – | – | 1 |

## The pair candidates — exactly TWO are real

1. **`#av-deliver-bits`** (`src/av_deliver_ui.js` line ~1015) — a fixed two-option select,
   `<option value="16">16</option><option value="24" selected>24</option>`. This is the textbook
   `.av-pair` case: two fixed choices, no data behind them.
2. **`#av-code-kind`** (`src/av_code_ui.js` line ~1629) — two fixed options,
   `fx — an insert effect` / `kind — a voice engine`. Also a genuine pair.

**Do NOT convert `#av-mix-add-src`.** The audit reports it as two-option, but that is an artefact of an
empty profile: its options are built at runtime from takes + comps (`avMixUiAddOptionsHTML`) and reach
56 entries on a full profile. It is a data picker, not a two-choice control.

## The number candidates — exactly TWO

- **`#av-comp-fade`** (`mix/comp`) — a fade length in samples/frames.
- **`#av-studio-offset`** (`mix/studio`) — an offset.

Both currently render as bare `input[type=number]` inside their cards. `.av-num` (value field with a
down-stepper on the left and an up-stepper on the right) is a drop-in replacement that leaves the input
in place under a class + two buttons.

## The group question — zero instances, so this is a design pass, not a sweep

`.av-group` boxes with the 45° title tab exist in the mockup language but **nowhere in the app**. There is
nothing to convert. Either:
- (a) adopt `.av-group` for the card sections that are already visually boxed (a paint change with no
  new structure), or
- (b) leave groups for C5's disclosure pass, where "which sections become boxes" is decided together
  with "which sections fold".
**This needs the owner's call** — it changes the look of every card, and the C3 work has just settled
those cards at 0.89–0.99 density. **Recommendation: (b).**

## Rig couplings that a conversion must carry (checked, not guessed)

- `verify/cdp_code.mjs:605` reads `W.domGet('av-code-kind')` and drives it. A pair must therefore keep
  **the element with that id** (a hidden input carrying the value, or the radio group itself) and keep
  `.value` readable, or that leg must be rewritten in the same commit.
- `verify/cdp_smoke.mjs:302` only asserts `!!document.getElementById('av-deliver-bits')` — an existence
  check that survives either shape, but the id must not disappear.
- `verify/cdp_smoke.mjs:366` likewise for `#av-comp-fade`.
- No rig touches `#av-studio-offset`.

## The gate for the C4 wave (docs/13 §6)

`overflow scan + cdp_fit` per page, plus the standing fast lane. C4 changes widths, so **`cdp_fit`
(1440→800 width sweep, the inspector collapsing at 1180) is the leg that can actually fail** — it must
run with every converted page, not just the fast lane.
Per card: `bash cache/scratch/battery_fast.sh <card-rig>` and `node verify/cdp_fit.mjs`.

## Order of work (smallest blast radius first)

1. **DONE (2026-11-07, `fc67aa1`)** `.av-pair` (`src/av_pair.js`) + both conversions — `#av-deliver-bits`
   and `#av-code-kind` are now radiogroups of two keys over a hidden input that keeps the original id
   and `.value`, so both cards keep reading the control unchanged. Audit after the sweep: selects
   49 → 47, two-option selects 3 → 1 (only the data-driven `#av-mix-add-src`), pairs 0 → 2. Pinned by
   K24n (×2). A real bug was caught on the way: `avPairSync(pair)` searched only descendants, so a pair
   passed as its own root never repainted the keys.
2. **DONE (2026-11-07, this commit)** `.av-num` (`src/av_num.js`) + both conversions — `#av-comp-fade`
   and `#av-studio-offset` are now stepper fields around the SAME input (id, class, type, min/max/step
   and events untouched); a key click sets `.value` inside the range and dispatches one `input` + one
   `change`, and a clamp emits nothing. Pinned by K24o (×2).
3. `.av-fader` — needs its first real home; DELIVER's master level or MIX's per-track gain are the only
   candidates. **Owner call.**
4. Groups — deferred to C5 per the recommendation above.

**Gate actually run for items 1–2:** fast lane (chassis 46, a11y 33, smoke 81, m1 33, m2 40) ·
`cdp_fit` 49/49 · `cdp_code` 36/36 · `cdp_s4` 42/42 (the DELIVER card's rig) · `cdp_comp` 41/41 ·
`cdp_studio` 37/37 solo twice (one 3-onset metronome read right after the comp suite was CPU
contention — the knife-edge leg, trap 10).

## What is NOT in this wave

- No `.av-fader` anywhere until it has a home (item 3).
- No restyle of `.av-select`; the 35 many-option selects stay selects.
- No change to the 16 sequence selects (they are per-track pattern pickers, data-driven).
