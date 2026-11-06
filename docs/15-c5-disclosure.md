# C5 — DISCLOSURE & A11Y: the measured audit and the plan

Read with `docs/13-chassis-fsvr.md` §C5 ("advanced sections collapsed by default per page, focus order,
tab semantics") and §7 (the gates: `cdp_a11y`, `cdp_fit`).
This document is the **audit**, not the work. Nothing here is implemented yet.
Method: `cache/scratch/c5audit.mjs` walks all nine zones; raw data in `cache/scratch/c5audit.json`.
`cdp_a11y` is already **33/33 green** — every defect below is a gap BEYOND what the rig asserts.

## What the audit measured (2026-11-07, session 24)

| measure | total | notes |
|---|---|---|
| `[role=tab]` | **31** | 25 resolve their `aria-controls` to a real element, **6 do not** |
| `[role=tabpanel]` | **31** | 25 carry a resolvable `aria-labelledby`, **6 do not** |
| tablists with exactly one `aria-selected=true` | **8 of 8** | every tablist is well-formed on selection |
| disclosure toggles (`.av-adv-chip`, `.av-sec-toggle`, `.av-mod-toggle`, `.av-fx-toggle`) | **86** | **55 carry `aria-expanded`, 31 do not** |
| controls inside a collapsed region | 495 | **not a defect** — `display:none` removes them from the tab order natively |
| visible tab stops on the shown zone | 215 | the real tab-order surface |

Per zone, the laggards on the fold contract (`folds` / `with aria-expanded`):

| zone | folds | aria-expanded |
|---|---|---|
| effects | 18 | 6 |
| system | 21 | 13 |
| mix | 14 | 9 |
| sequence | 5 | 3 |
| sound | 18 | 14 |
| shape | 3 | 3 |
| browse · perform · deliver | 3/2/2 | all |

## Finding 1 — 31 disclosure toggles do not publish their state (the big one)

By class: **24 `.av-adv-chip` + 7 `.av-fx-toggle`**.

The `.av-adv-chip` case is a design nuance worth stating precisely: the chip is the CLOSED-state
affordance (it is `hidden` once its section is open, and the open section carries an `.av-sec-toggle`
that DOES have `aria-expanded`). So the pair is half-annotated: the control you press to open
announces nothing, the control you press to close announces correctly. The fix is mechanical and
low-risk: every chip gets `aria-expanded="false"` at build and its sync sets it alongside `hidden`
(all the sync sites already exist — `avMixUiDisclosure`, the mod/seq/code/store fold helpers).

The `.av-fx-toggle` case is different: those toggles are the per-strip open/close keys *inside* the
FX card (7 of them, the ones `cdp_fx` drives as `expandFolds`). They flip a strip, so they are plain
disclosures and should carry `aria-expanded`.

## Finding 2 — the six FM operator keys claim a tab relationship they do not have

`av-fm-op-tab` (OP 1 … OP 6) is `role=tab` with no `aria-controls`, and no panel claims
`aria-labelledby` back. Two honest fixes:

- **(a)** make them a real tab set: ids, `aria-controls` to the operator editor panel + the panel's
  `aria-labelledby` following the selected key. More DOM, and the panel already exists.
- **(b)** demote them to `aria-pressed` toggle buttons (they select which operator the editor edits),
  which is truthful and needs no panel plumbing.

**Recommendation: (a)** — the editor genuinely swaps content per operator, which is what tabpanels
are for, and C5 is the wave where tab semantics get finished. (b) is the fallback if the panel
cannot be given a stable id without touching the FM card's repaint.

## Finding 3 — the group question lands here (deferred from C4)

C4 found **0 `.av-group` boxes** in the app. Whether card sections become boxed `.av-group`s with the
45° title tab is a look change on cards the C3 wave has just settled at 0.89–0.99 density. It belongs
with C5's "which sections fold" decision, not with C4's control sweep. **Still an owner call.**

## What C5 must also PROVE (the part nobody has measured)

Focus order is asserted by `cdp_a11y` (33 checks) but never *recorded*. C5 should pin the actual
walk: **band → tab bar → pane → inspector → dock**, per page, with the count of stops, so a future
card cannot silently move the order. That is a new rig leg, not a code change.

## Order of work

1. `aria-expanded` on the 24 `.av-adv-chip`s (mechanical; one helper per card, all syncs exist).
2. `aria-expanded` on the 7 `.av-fx-toggle`s.
3. The FM operator tab set — option (a), with (b) as the fallback.
4. The focus-order walk leg (`cdp_a11y` extension): record band → tabs → pane → inspector → dock.
5. Groups: owner call, then paint only.

## Gate

`cdp_a11y` (must go from 33 checks to 33 + the new walk leg), the fast lane, and `cdp_fit` — the
aria work is DOM attributes only, so density must not move at all (assert the K23 ratios are
byte-identical before/after).
