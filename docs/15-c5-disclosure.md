# C5 — DISCLOSURE & A11Y: the measured audit and the plan

Read with `docs/13-chassis-fsvr.md` §C5 ("advanced sections collapsed by default per page, focus order,
tab semantics") and §7 (the gates: `cdp_a11y`, `cdp_fit`).
Method: `cache/scratch/c5audit.mjs` walks all nine zones; raw data in `cache/scratch/c5audit.json`.
`cdp_a11y` is already **33/33 green** — every defect below is a gap BEYOND what the rig asserts.

**STATUS 2026-11-10:** Findings 1 and 2 are SHIPPED and gated (items 1–3 below). Item 4 (the recorded
focus-order walk) is the remaining rig work; item 5 (groups) is still an owner call.

## What the audit measured (2026-11-07, session 24)

| measure | total | notes |
|---|---|---|
| `[role=tab]` | **31** | 25 resolved `aria-controls`, 6 did not → **31/31 after C5** |
| `[role=tabpanel]` | **31** | 25 carried a resolvable `aria-labelledby`, 6 did not → **31/31 after C5** |
| tablists with exactly one `aria-selected=true` | **8 of 8** | every tablist well-formed on selection |
| disclosure toggles (`.av-adv-chip`, `.av-sec-toggle`, `.av-mod-toggle`) | **79** | 55 carried `aria-expanded`, 24 did not → **79/79 after C5** |
| module switches (`.av-fx-toggle`) | 7 | **NOT disclosures** — `aria-pressed` on/off keys, 7/7 correct (see the correction below) |
| controls inside a collapsed region | 495 | **not a defect** — `display:none` removes them from the tab order natively |
| visible tab stops on the shown zone | 215 | the real tab-order surface |

Per zone, the fold contract (`folds` / `with aria-expanded`), audit → after C5:

| zone | folds | aria-expanded |
|---|---|---|
| effects | 11 (+7 module switches) | 6 → **11** |
| system | 21 | 13 → **21** |
| mix | 14 | 9 → **14** |
| sequence | 5 | 3 → **5** |
| sound | 18 | 14 → **18** |
| shape | 3 | 3 → **3** |
| browse · perform · deliver | 3/2/2 | all → **all** |

## Finding 1 — 24 chips did not publish their state (FIXED 2026-11-10)

By class: **24 `.av-adv-chip`**, nothing else. The chip is the CLOSED-state affordance (it is `hidden`
once its section is open, and the open section carries an `.av-sec-toggle` that already had
`aria-expanded`), so the pair was half-annotated: the control you press to open announced nothing.
Every chip sync now sets `aria-expanded` beside `hidden` — folded → `false`, open → `true` — in all
seven creation sites:

| card | file · sync |
|---|---|
| CHOP | `av_chop_ui.js` · `avChopUiFoldInit`'s `sync()` |
| CODE | `av_code_ui.js` · `avCodeUiFoldSync` |
| FX | `av_fx.js` · `avFxFoldInit`'s `sync()` **and** `avFxFoldSync()` (two paths) |
| SYSTEM→MIDI | `av_midi.js` · `avMidiFoldInit`'s `sync()` |
| MIX | `av_mix_ui.js` · `avMixUiDisclosure`'s `sync()` |
| SEQUENCE | `av_seq_ui.js` · `avSeqUiFoldSync` |
| SOUND→ENGINE | `av_synth.js` · `avSynthFoldInit`'s `sync()` |

The `.av-mod-rows-chip` (SHAPE) already did it correctly since C3-11 (`av_mod.js:900`) — that file was
the pattern, not a site to fix.

### CORRECTION — the 7 `.av-fx-toggle`s are NOT disclosures

The original audit counted 31 missing as "24 chips + 7 fx toggles" because `.av-fx-toggle` sat in the
selector list. It should not have: `avFxToggleHTML` builds a module **on/off switch** carrying
`aria-pressed` and an ON light, not a fold key — and `cdp_fx`'s `expandFolds()` clicks `.av-adv-chip`,
never these. Adding `aria-expanded` would have been a semantic lie. Measured on the C5 bytes:
**7 toggles, 7 with `aria-pressed`, 0 with `aria-expanded`** — correct as built. The audit script's
selector now measures them as their own class.

## Finding 2 — the six FM operator keys claimed a tab relationship they did not have (FIXED 2026-11-10)

`av-fm-op-tab` (OP 1 … OP 6) was `role=tab` with no `aria-controls`, and no panel claimed
`aria-labelledby` back. **Option (a) shipped**, in the same wave as Finding 1:

- each tab carries `id="av-fm-op-tab-N"` + `aria-controls="av-fm-op-panel-N"`;
- each panel carries `id="av-fm-op-panel-N"` + `aria-labelledby="av-fm-op-tab-N"` (its `aria-label`
  dropped — the tab's own name is the label now);
- the tab set is **one** tab stop: `tabindex` 0 only on the selected key, -1 on the rest, kept in step
  by `avFmPaintOps`; ArrowLeft/Right/Up/Down walk the six keys, Home/End jump the ends (`avFmWire`'s
  keydown). The click path stays the only commit path.

Measured after the fix: `tabsWithControls` **25 → 31**, `panelsLabelled` **25 → 31**.

## Finding 3 — the group question lands here (deferred from C4)

C4 found **0 `.av-group` boxes** in the app (the inspector's frame carries the class, but it is a class,
not the §5 box). Whether card sections become boxed `.av-group`s with the 45° title tab is a look
change on cards the C3 wave has just settled at 0.89–0.99 density. **Still an owner call.**

## What C5 must also PROVE (the part nobody has measured)

Focus order is asserted by `cdp_a11y` (33 checks) but never *recorded*. C5 pins the actual walk:
**band → tab bar → rail → pane → inspector → dock**, per page, with the count of stops, so a
future card cannot silently move the order. There is no positive `tabindex` anywhere in the bundle
(verified), so DOM order IS the sequential focus order here; one real CDP Tab walk on the boot page
proves the recorded order is the browser's, not an assumption.

## Order of work

1. **DONE** `aria-expanded` on the 24 `.av-adv-chip`s.
2. **DONE (nothing to do)** `.av-fx-toggle`s — `aria-pressed`; the audit was over-broad.
3. **DONE** the FM operator tab set — option (a) + roving tabindex + arrow keys.
4. The focus-order walk leg (`cdp_a11y` extension): record band → tabs → rail → pane → inspector → dock.
5. Groups: owner call, then paint only.

## Gate

`cdp_a11y` (33 checks + the new walk leg), the fast lane, and `cdp_fit` — the aria work is DOM
attributes only, so density must not move at all. **Confirmed on the first C5 build: the 1280 board
reads the same values, knife-edge sequence 1.18 and system/family 1.19 included.**
