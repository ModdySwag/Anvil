# ANVIL — CONSOLE DESIGN PROGRAMME (save point 2026-11-10, P2 SOUND + FULL SKIN)

## READ THIS FIRST — P2 SOUND LANDED AND EVERY SURFACE IS A HIGGSFIELD MATERIAL

**State:** HEAD `ddbf28e` · `index.html` sha `1f8101ae4ff91eead79c629cc2bf845d2f9e705cec6ca28ef0a827d219b3e064`,
**6,077,887 B** · all rigs pin it · tree clean apart from the untracked concept artifacts.
**GATE — every rig green on these exact bytes: 1,078 legs across 28 rigs, zero failures.**
chassis 47 · a11y 37 · smoke 81 · m1 33 · m2 40 · mix 47 · seq 41 · fx 28 · s4 42 · s5 36 · studio 37 ·
store 28 · code 36 · cockpit 21 · deck 35 · comp 41 · sample 29 · tune 18 · midi 34 · sessions 65 ·
import 26 · bounce 32 · rec 29 · platform 52 · hub 68 · keys 27 · knob_feel 19 · fit 49.
NOT run (load/wave-gate suites that need a quiet machine): bench · stress · alias.
**Boards for the owner eye gate:** `cache/scratch/board-{gold,silver,walnut}.png` — SOUND / MIX /
SEQUENCE / EFFECTS tiled per finish, plus the individual `cache/scratch/fin-<page>-<finish>.png`.

**Owner brief this session (verbatim, both must keep governing):**
1. *"the WHOLE THING, backplate and all textures need higgsfield . i still see original design colours as
   layout colour templates"*
2. *"each and every aVAILABLE AND POSSIBLE ASSET and part of the GUI and program interface professionally
   skinned with as many higgsfield assets and anything needed. they 3 skins must look like 100% professional
   decks and interfaces with No obvious signs of a windows generic design."*
   → He then asked whether the subagents had covered the backplate and ALL assets for ALL 3 themes. They had
   not (no subagents ran; the first pass was ONE neutral surface set shared by three finishes). That gap is
   closed: every finish now owns a full asset set.

### P2 SOUND (commit `2dcb6fe`) — structural, not paint
- **LEVELS is the output stage.** The card still folds to its head (chassis K24 pins that), so the HEAD now
  carries the job: INST + MASTER gains, a live stereo peak meter off `avTap.levels`, a peak-hold readout and
  a latched CLIP tell (`avLevelsStrip` in app_core.js). Card 64 → **40 px**. Knobs stay behind the fold.
- **One engine layer.** `#av-engine-strip` was six chips that only `scrollIntoView`-ed to a card the sub-tab
  row already owns. It no longer paints (`strip.hidden = true` + `.av-engine-strip[hidden]{display:none!
  important}` — a page `display` rule beats the attribute). Element kept: smoke R2 counts its six chips.
- **The card fills the well.** `#av-zone-sound .av-zone-box{min-height:100%}` + `.av-sub:not([hidden])` as a
  column + `#av-synth` flexing. Body = control line / one 12-pot row / **SCREENS BAND** that absorbs every
  spare pixel. New **oscillator scope** (draws the two shapes the engine renders, reusing
  `avInspectorWaveAt` with a local fallback) beside the enlarged filter response. Prose note deleted.
  Dead band **0** (`p2probe.mjs` deadBottom), the 600×180 void is gone.
- **K24h re-pinned** to the new shape (screen shares the band, sits below the pots, band carries the slack,
  h≥140 w≥260) — same rigour, new geometry.

### THE SKIN — one full asset set PER FINISH
`cache/scratch/mk_materials.py` now emits, for gold / silver / walnut separately: **backplate, card face,
screen well, metal plate, knob face, keycap, rubber pad, fader cap, wheel rim, white key, dial glass**
(21 new Higgsfield `gpt_image_2_6` plates; ~90 credits; balance was 2541).
- Textures are **high-passed** (blur-subtracted → grain only, no blotchy macro cloud) and **centred on
  mid-grey** so soft-light adds texture and never a cast, **with per-family contrast**: plates mean 150 /
  spread 150, caps 130/44, keys a photographed object at full opacity. One number for a 448px backplate and
  a 24px keycap turns the small ones into static.
- `styles-console.css` **§15** skins the large surfaces (floor, cards, rail, inspector, dock, screens,
  bands); **§16** the controls (keycaps, field keys, chips, sub-tabs, rockers, kind keys, launcher keys,
  module buttons, pads, step cells, fader caps, wheels, fields, rows, badges, wells, popovers, tooltips,
  piano keys); **§17** buries the last native widgets (range inputs → machined cap on a recessed slot,
  textareas → no resize grip / no OS scrollbar, `.av-seq-cell` → pad material).
- Finish mapping lives in materials.css: `--mat-backplate/-card/-well/-rail/-btn/-pad/-fader/-wheel/
  key-white/-plate/-knob/-dial` each resolve to that finish's own plates, so a finish swap moves the
  MATERIAL, not a tint, and geometry cannot change.

**Boards:** `cache/scratch/fin-gold3.png`, `fin-silver3.png`, `fin-walnut3.png` (SOUND in all three),
`skin-mix.png`, `skin-sequence.png`, `skin-effects.png`, `crop-band2.png`, `crop-seq-ctl.png`,
`p2-mat-crop3.png`. Tools: `p2probe.mjs` (zone structure + dead bottom), `p2dump.mjs` (card rect tree),
`finishshot.mjs <zone> <finish> [w] [name]` (any page in any finish), `csprobe.mjs <sel>` (computed style).

**TRAPS PAID THIS SESSION (add to the list):**
- **A transparent gradient layer breaks the blend.** `background-image: texture, linear-gradient(…,
  transparent)` leaves soft-light nothing to blend into and the RAW texture shows as a light grey slab (the
  sub-tab row did exactly this). Every blended stack needs an OPAQUE base layer.
- **Contrast is per family, not per sheet.** See above — keys/caps need their own spread or they read as
  television static.
- **An old `flex: 0 0 100%` written for a row-wrap parent measures 100% of the HEIGHT in a column** and
  swallows the card. Reset the basis in the new layer (and mind specificity: an attribute selector counts
  like a class, so `.x[data-y] .z` at 0,3,0 beats `.a .z` at 0,2,0 — scope with an id to win).
- **`sweep_pins.py --old` must be the sha the RIGS carry, not your last build** (paid again): sweeping
  `2f607e72` when the rigs held `30d90f86` rewrote 0 rigs and printed STALE REMAINING.

### LATER THE SAME SESSION (HEAD `7d49d11`, sha `352db606`, 6,070,856 B)
- **MIX P2 (`0913b89`)** — with no tracks the card was a wall of prose over an invisible surface. It now shows
  an **eight-strip ghost rack** (`avMixUiRackHTML`): T1..T8 plates, a fader slot with its cap at unity on a
  0/-6/-12/-24/-40/-inf scale, a stereo meter pair, M/S keys and a MAIN out, hidden the moment a track exists.
  Ghosts only, no invented values. The card's cap + foot prose are off the face (kept in the DOM), and the
  inner `MIX` title is gone because the module head already says MIX & MASTER.
- **Inspector launcher is navigation now (`7d49d11`)** — the entry matching the live zone + sub carries `.on`
  and `aria-current="page"` via `avInspectorLaunchSync`, driven by the shell's own `av-zone-shown` /
  `av-sub-shown` events. Three competing tab layers are down to one.
- Gate on `352db606`: chassis 47/47 · a11y 37/37 · smoke 81/81 · m1 33/33 · m2 40/40 · mix 47/47.

### SEQUENCE (`51735f9`, sha `3a7b42c6`, 6,072,918 B)
- Four 22px track rows on a 580px card read as a half-built page. Inert **ghost rows** fill the rack to eight
  (`av-seq-grow` / `av-seq-gcell`), the "click a grid cell" instruction line is off the face, and the pattern
  textarea shrinks to the two lines EXPORT/IMPORT use.
- **TRAP PAID:** the first cut reused `.av-seq-row`/`.av-seq-cell` for the ghosts and broke two legs (smoke P4
  counted 8 rows, cdp_seq counted 128 cells). The fix is own class names on the ghosts, NOT a relaxed
  assertion — a decorative element must never be matchable by a contract selector.
- Gate on `3a7b42c6`: chassis 47/47 · a11y 37/37 · smoke 81/81 · m1 33/33 · m2 40/40 · seq 41/41.

### EFFECTS — LANDED (`d133f8a1`, 6,076,793 B)
The page is a serial chain and nothing on it said so. A **signal-flow bar** now sits under the strips:
IN -> DRIVE -> FLAVOUR -> MOD -> DELAY -> VERB -> CONV -> DYN -> OUT, each block lit from its own strip's
`.av-fx-on` state (`avFxChainSync`, called from `avFxSync`). It has a DEFINITE 104px height, so it can never
stretch a strip — that stretch is exactly what killed the first attempt. Dead band 153 -> ~48px, and the
head's cap line (which spelled the order out in prose) is off the face because the bar says it visually.
Gate: chassis 47/47 · a11y 37/37 · smoke 81/81 · m1 33/33 · m2 40/40 · **fx 28/28**.

### EARLIER ATTEMPT — REVERTED (kept as a map of what not to do)
Tried to kill the 153px void by letting the card own the well and the strip rack spread down it
(`#av-fx-host` flex chain + `.av-fx-strips{flex:1; justify-content:space-between}` + a signal rail with a
node per strip). **It made the page worse:** the strips are flex items in a column, so they took the slack
themselves and DRIVE / FLAVOUR stretched into two 430px cards with a void inside each — the dead band moved
from under the card into the card. Reverted with `git checkout -- src/styles-console.css`; bundle is back to
the committed `3a7b42c6` and the tree is clean.
**The real fix is a strip RACK with definite row heights** (each `.av-fx-strip` a fixed height from its own
content, the chain container scrolling or distributing BESIDE them, never stretching them), not a stretched
flex column. Do that as its own pass with the fx rig (`.av-fx-strip[data-sect=...]` legs, K24j) in hand.

### WHAT IS LEFT
1. **P2 on EFFECTS** — still stacked cards, not the serial chain the spec asks for (a vertical signal rail).
   See the reverted attempt above: fixed-height strips, not a stretched column.
2. **MIX real strips** — the ghost rack is the EMPTY state; populated `.av-mix-track` rows are still
   horizontal, not vertical console strips with a dB-scaled fader.
3. **SEQUENCE transport** — the PLAY/STOP/REC-STEP/FILL row leaves a wide void between the BPM knob and
   GEN/SONG; it could carry the bar/beat and the swing control.
2. **MIX real strips** — the loop-only rack is the EMPTY state; the populated `.av-mix-track` rows are still
   horizontal rows, not vertical console strips with a dB-scaled fader.
3. The SEQ pattern textarea is the last raw-looking field (styled in §17 but never eye-checked).
3. **Owner eye gate** on the three finishes + every page.
4. Bundle is **6.06 MB** (materials.css 980 KB) — a size pass before release would be wise.
5. Carried over untouched: MIDI import bug, full wave battery on final bytes, elevated uninstall of the stale
   `C:\Program Files\Anvil`, publish v1.15.0, P3 finish into patch+installer, P4 craft.

---

# ANVIL — CONSOLE DESIGN PROGRAMME (save point 2026-11-10)

## READ THIS FIRST — P1 LANDED: control language, materials, three finishes (2026-11-10)

**State:** HEAD `35dfe7e` · `index.html` sha `8490ab1387a37992992960a457dd9ca45b97774424f788f331081c180078a7c4`,
5,371,220 B · all rigs pin it · tree clean apart from the untracked concept artifacts.

**Owner notes this pass (all acted on):** "the out of format knobs have returned"; "why not apply the
theme to the whole gui"; "make the lcd as professional as possible higgsfield approved"; "same for all
GUI elements"; "apply the same approach to ALL 3 gui designs".

**P0 (commit `4a38d2e`)** — chassis: chrome 296 → 233 px (title 30 / band 74 / zone strip 38 / status 23 /
dock 68), three modes then six panels, piano rail into the status bar, gold tokens, Inter + Plex Mono,
Iconset glyphs. K23 at 1280 worst 1.19 → 1.10.

**P1 (commit `35dfe7e`)** — the whole GUI speaks the console grammar and all three finishes are real:
- pots: engraved tick ring + one pointer, no conic value ring, no glow; neutral tnum values; the
  ring/face/mark contract and `--knob-arc` kept (knob_feel rig pins them).
- keys, chips, sub-tabs, two-choice pairs (rocker), module heads with an LED, cards, scrollbars.
- native `<select>` styled as console fields (appearance:none + drawn caret). **Still native on open —
  the true `.av-pair` replacement is P1b.**
- the display is rebuilt: cream dial glass in a brass bezel, hero preset row, PAT / ENG / POLY / kHz /
  VOICES / MASTER / CPU / BPM, glass reflection. The old green dot-matrix is gone.
- band 74 → **80 px**, dock 68 → **64 px** (chrome 233 → 235; work area 667 → 665 at 1440, 567 → 565 at 1280).
  Pot cells own a 58 px box inside the 74 px group — no sliced labels or values.
- **materials**: `src/materials.css` (265 KB of JPEG, generated by `cache/scratch/mk_materials.py` from
  Higgsfield `gpt_image_2_6`): dial glass, champagne + silver brushed plates, walnut veneer, graphite /
  fluted-gold / knurled-silver / bakelite knob faces, brass strip. Layered under the token gradients.
- **three finishes + switcher**: gold leads, then silver, then walnut; the `FINISH` key in the title bar
  cycles and persists in localStorage (P3 moves it into the patch and the installer).

**P1b (commit `9b54f2a`)** — the console select. 69 of the 71 `<select>` now render as console field
keys that open a real popover (Arrow / Enter / Space / Escape, outside-click close, flip-up placement,
debounced observer for late-mounting cards); the two LCD bank selects stay dial-glass display fields.
The native element survives in the DOM as the value carrier, so every module reader and every rig's
`.value` / `.options` contract keeps working. Proven with a real CDP click: 7-row popover, choosing row
2 wrote value `acid` / index 1, the key label followed, the popover closed.
**Current state is `9b54f2a` / `83bf5e66…`** (5,382,430 B); gate: chassis 47/47, a11y 37/37,
smoke 81/81, fx green, m1 33/33, m2 40/40, keys 27/27, knob_feel green.

**P1c/P1d — WHOLE-GUI sweep (in progress at this save point):** a 1,156-class audit found 30 surface
families still outside the console grammar; all 30 are now styled in `styles-console.css` §11–12
(tooltip, menu popover, number steppers, ⌘K palette, library, float/about/wizard/tour, drum pads, step
cells, chop pads, every meter + LED, the left rail, text and numeric fields, 13 native checkboxes,
chips, import rows/dropzone, 23 list-row families, wells and canvases, mod-graph nodes, badges, group
tabs, meter readouts). Also: the keyboard wears **Higgsfield ivory/ebony** surfaces; the band pot cell
reserves 68 px so the tick ring never touches ATTACK/RELEASE/CUTOFF/RESO or their values; PANIC gets a
danger finish; the six panel keys were raised to secondary contrast; the status bar stops duplicating
the display; keycap letters show only in KEYS mode; voice tiles are 30 px.

**TRAP PAID — the pin sweep takes a FULL sha.** `sweep_pins.py --old` was handed a truncated 20-char
sha; the script does a literal substring replace, so all 23 rig pins became `<newSha><oldSuffix>`
(108 hex chars) and the rigs' 64-hex guard silently rejected them while printing a correct-looking
prefix. Repaired by prefix-matching the over-long literals (`avpack_check`'s sha256("abc") vector left
alone). Always pass the whole 64-char sha.

**P2 FINDINGS from the two audits (structural, not CSS — the next real work):**
- the LEVELS card on SOUND is an empty shell (1,045×93 px of nothing) — fill it or collapse it to a head;
- three competing tab layers (voice strip, ENGINE sub-tabs, module grid) repeat FM / DRUMS / SAMPLES / CHOP;
- the SYNTH card's upper right is ~600×180 px of dead space;
- ~100 px dead band between the cards and the keyboard;
- the header scope well reads as a failed meter (no label, scale or signal);
- EDIT VOICE is the quietest control in the inspector although it is the primary action.

**Gate on `8490ab13` (P1, kept for the record):** chassis **47/47** · keys **27/27** · knob_feel **green** ·
a11y **37/37** · smoke **81/81**.

**Boards:** `cache/scratch/p0-after-1440-{gold,silver,walnut}.png`, `p0-after-1280.png`.

**TRAPS PAID (add to the list below):**
- **`--fin-metal` was computed on `:root`.** A `body[data-finish]` override of `--fin-face-*` never
  reached a custom property whose value contains `var()` — nested vars resolve where they are DECLARED.
  Silver and walnut bands stayed champagne until each finish restated `--fin-metal` literally.
- **Knob textures carry a white margin.** `background-size: 118%` pushes it outside the circle; at 100%
  a white ring appears inside the bezel.
- **A type change moves chassis constants.** The 10 px value ramp made the MIX DYN row 72 → 73 px;
  K24k was re-pinned to a 70–75 band (the screen still costs zero height — the constant was the ramp).
- **The title/status keys were hardcoded cream.** They now ride `--fin-face-*`, or walnut keeps bright
  cream keys on dark wood.

## P0 SAVE POINT (4a38d2e) — superseded by P1 above, kept for the numbers

**State:** HEAD `4a38d2e` · `index.html` sha `de3bf123…`, 4,995,432 B.

**Owner calls taken (all seven, 2026-11-10):** three modes (Sound/Sequence/Mix) + browser panel +
inspector + dock; gold Marantz leads, order gold → silver → walnut; gold keeps cyan scopes; walnut gets
the brass pinstripe; inspector collapsible on every screen; 1280×800 confirmed as the floor; Inter var
+ IBM Plex Mono bundled. The 1280/Inter calls I took as settled per §5/§10 and he did not contest them.

**P0 landed (chassis only, no feature changes):**
- chrome **296 → 233 px**: title 30 / band 74 / zone strip 38 / status 23 / dock 68.
  Work area **604 → 667** at 1440×900 and **504 → 567** at 1280×800.
- the fake 24 px menu strip above the band is gone; the menu legend rides inside the title bar.
- zone strip: three modes lead (bold, 15 px icon), six panels follow (quiet, 11 px icon, hairline
  separator). Same ids/aria-controls — every zone is still reachable and every rig that shows a zone works.
- the piano dock is 68 px (wheels + keys only); the input-mode rail (STUDIO/KEYS/MIDI, octave, hint)
  moved into the new 23 px status bar, which also mirrors voices/CPU/rate/version from the LCD.
- finish tokens live in `src/styles-console.css` (gold leads; silver + walnut token sets defined, no
  switcher yet — that is P3). The glass retint rides the legacy `:root` vars so every card inherits it.
- Inter var 400–600 + IBM Plex Mono 400/500 embedded (`src/fonts.css`, 90 KB, OFL) and 27 icon masks
  generated from **Iconset's** lucide catalog (`src/icons.css`, `cache/scratch/gen_icons.py`).
- build.py now concatenates styles.css → fonts.css → icons.css → styles-console.css.

**Gate on these bytes (each suite run solo):** chassis **47/47** · a11y **37/37** · smoke **81/81** ·
m1 **33/33** · m2 **40/40** · keys **27/27**. That is the fast-lane set plus the piano rig.

**K23 density (the point of the chassis work):** at 1280 the worst claimed view went **1.19 → 1.10**
(system/family); sequence **1.18 → 1.05**, browse/import 1.15 → 1.02, sound/wt 1.13 → 1.03. At 1440 the
whole board is ≤ 0.93. The knife-edge the C3 notes carried is gone — there is 0.10 of headroom at the
floor now, so P1/P2 have room to spend.

**Rigs updated to the new contract:** chassis K2 (three modes then six panels), K3 (band = transport +
identity + pots + out) + new K3b (title bar 30 px carrying plate/menu/view keys), keys (dock 68 above the
23 px status bar), smoke R1 (zone order string) + R4 (flat engraved keys, metal strip, accent underline).

**NEXT, in order:**
1. **Owner eye gate on the chassis** (this is the stop point of P0). Boards: `cache/scratch/p0-after-1280.png`
   and `p0-before-1440.png`; live at `C:\Users\Moddy\anvil\index.html`.
2. **P1 — control language** (docs/16 §4): kill the 71 native selects, unify knobs to six tiers, delete
   the conic value ring and glows, add tick rings + hover value popovers. Gate: a new control-language
   rig, the per-zone keyboard walk, K23 unchanged.
3. **P2 — the four working surfaces**, then P3 finishes (move the three token sets into a switcher),
   then P4 craft.
4. Carried over from session 25, untouched: MIDI import bug, full wave battery on these bytes, elevated
   uninstall of the stale `C:\Program Files\Anvil`, publish v1.15.0.

**TRAPS PAID THIS SESSION (do not repeat):**
1. **A title-bar deck that re-appends every tick eats real clicks and Tab focus.** The plate query only
   looked inside the band, so after the first move `want` was 2 against a 3-child bar and the 400 ms
   guard re-appended everything — a real mouse click on MOTION missed (G3) and the recorded Tab walk
   broke (I4). If a move must be idempotent, the query has to see BOTH homes.
2. **`body { --dock-h: 132px }` in styles.css beats `:root { --dock-h: 68px }` in the new layer** —
   custom properties inherit from body. The dock stayed 132 px until the override was set on `body`.
3. **The tab row used `flex: 1 1 0`** (R4 chips): on the new strip the nine keys spread across the width.
   `flex: 0 0 auto` + `max-height: 100%` is what makes a 38 px strip measure 37 px on every key.
4. **A selected tab's 3 px underline can push a `height:100%` button past its strip** — pin
   `box-sizing`, `min-height: 0` and `max-height: 100%` or the strip clips the light.
5. **`getComputedStyle().backgroundColor` is not the gradient.** The metal bands read `rgba(0,0,0,0)`
   because the finish rides `background-image`; assert `backgroundImage.indexOf('gradient')`.

---

## SESSION A — DESIGN RESEARCH + CONCEPT (earlier the same day)

This session did **design research + concept only**. No app code was changed: `git` tree is untouched,
`index.html` bundle is still `97ba6540…` / 4,872,362 B, all 23 rigs still pin it. Everything here lives in
`renders/concept-v2/`, `docs/16-console-design-program.md` and the skill reference
`anvil-synth-ops/references/console-design.md`.

Owner's brief this session: turn the GUI into a professional sound-engineer / DAW standard, three finishes
in a switcher — 1) gold Marantz, 2) silver brushed Onkyo/Yamaha, 3) 70s wooden amplifier / Moog — "hold
nothing back", "I want perfection", use Higgsfield for design elements and the installed Iconset for icons.

Owner's last words: *"i love"* (on the sequencer crops) then *"keep working but i advise against one more
quality and functionality pass before we go ahead i want perfection"*. That pass was done (details below).

---

## STATE

| Thing | Value |
|---|---|
| Repo | `C:\Users\Moddy\anvil` |
| Code HEAD | `1e067a7` (session 25 save) — **unchanged by this session** |
| Bundle | `index.html` sha `97ba6540da4e43a7fc731e988381539bf70fed9cc5f0f6170ef1abcd5ddf2847`, 4,872,362 B |
| Tree | clean; nothing committed by this session (concept artifacts are untracked) |
| Costs | ~US$1.30 of model spend, 2546 → ~2540 Higgsfield credits (6 textures) |
| Paper | paper.design desktop 0.5.18 at `C:\Program Files\Paper`; ships `paper.exe mcp` (stdio relay at `resources/app.asar.unpacked/dist/cli-bin/win32-x64/paper.exe`). Not used for the concept — HTML was used so pixels can be judged directly. |
| Iconset | iconset.io 3.0.0 at `C:\Program Files\Iconset` (icon workspace, SVG library). Icon spec is ready to draw there. |

---

## WHAT LANDED

### 1. Research (5 parallel streams, all completed and folded into the plan)
- **DAW window grammar** (Ableton 12, Bitwig 5, Logic 11, FL, Cubase, Studio One, REAPER): every DAW uses
  one permanent transport band, a left library panel, a selection-driven right inspector, a bottom detail
  dock, and **at most two primary modes**. Anvil's nine co-equal tabs are 4.5× that ceiling and are the
  structural reason it reads as a website. Measured reference: Logic's chrome = 110 px of 871 (12.6%).
- **Synth/plugin craft** (Serum 2, Pro-Q 4, Valhalla, Phase Plant, Diva, Vital): professional = luminance
  ladder + size ratio + accent-as-state + one control grammar. Anvil's actual tells: 8 px labels, four
  glows on one knob, teal on every surface, 5% background ladder, three control geometries.
- **Windows 11 / Electron**: Fluent 2 dark tokens, Segoe UI Variable ramp, 4 px control / 8 px overlay
  radii, 32 px title bar, native caption buttons via `titleBarOverlay` (keeps Snap Layouts), Mica via
  `backgroundMaterial`, two-tone focus ring, forced-colors pass, DIP-only layout.
- **Metering/fader standards**: −60…0 dBFS, −18 dBFS reference, digital peak + 20 dB/s fall + 1.5 s hold,
  latched clip; fader unity ~78% travel, 0.5 dB/px coarse / 0.05 fine, magnetic unity; strip order
  name → input/trim → inserts → sends → pan → mute/solo → fader+meter → output.
- **Icon/type**: one 24-unit master → 16/20/24 optical masters, stroke re-set (1.5/1.5/1.75), radius =
  1.25×stroke, round caps; Inter var + IBM Plex Mono (both OFL) with a 22/17/14/13/12/11/10 + mono ramp.
  Segoe UI Variable rejected as primary (not redistributable, reads as a Windows utility).

### 2. The concept — `renders/concept-v2/console.html`
Three finishes, one chassis, screens `?s=sound|mix|seq`, `?skin=gold|silver|wood`, plus a click switcher.
Chrome: 30 title + 74 transport + 38 zone strip + 68 keybed + 23 status = **142 px** (vs ~220 today).
Work area is dark glass inside a metal bezel; panels, scopes and mixers live inside it and use light ink.
- **Marantz gold**: champagne `#E6D6B2→#C0A670`, black dial glass, cyan scopes `#2FB6C4`, fluted silver-gold
  knobs, walnut case 11 px.
- **Onkyo silver**: `#ECEDED→#C2C4BD`, black glass, amber `#C07A2E`, knurled aluminium, walnut cheeks 9 px.
- **Moog walnut**: panel `#2B1D15→#1D130D`, walnut case 26 px + brass pinstripe, cream ink `#F2E4C8`,
  brass accent `#DCAF57`, black bakelite knobs — palette taken from Moddy's own motionstoodio "wood" theme.

### 3. Navigation study — `renders/concept-v2/modes.html`
Three modes (Sound / Sequence / Mix) on a 48 px rail + 258 px browser + centre + 320 px device-chain
inspector + 158 px piano-roll dock. Same finish switcher. This is the recommendation, not yet a decision.

### 4. Displays and sequencer rebuilt in the concept
- Sequencer: **16 steps × 4 bars = 64 cells** (the label is now true), 14 tracks, pads encode velocity as
  height and take the track colour, bar/beat separators, alternate bar shading, selection ring, honest
  `bar.beat.sixteenth` readout, playhead spanning grid + velocity lane, velocity lane shares the step grid
  (0.0 px drift, measured).
- Wavetable: five frames, current frame bold + glow + fill. Filter: real 24 dB/oct with resonance bump,
  filled area, log axis. LFO: one readable cycle.

### 5. Assets
- `renders/concept-v2/assets/`: six Higgsfield `gpt_image_2_6` textures — `gold-a.png`, `gold-b.png`,
  `silver.png`, `walnut.png`, `black.png`, `cream.png` (1–2.5 MB each; production should re-derive 1024 px
  versions under ~150 KB).
- Nine boards: `final-{gold,silver,wood}-{sound,mix,seq}.png` (1440×950).
- Three mode boards: `modes-{gold,silver,wood}.png`.
- `_overview.jpg`, `finishes-compare.jpg` for quick review.

### 6. Plan of record
`docs/16-console-design-program.md` — diagnosis, navigation model §3.1, sequencer/display specs §3.2,
layout map, control language, type/icons, audio ergonomics, Windows integration, finish tokens, the P0–P4
build plan with gates, decisions taken, open owner decisions, options needing verification.

### 7. Skill
`anvil-synth-ops/references/console-design.md` — the one rule (chrome metal, work glass), measured facts
about the current build, control language, finish tokens, type/icons, traps found while building.

---

## PROVED (measured this session, not eyeballed)
- 12 boards render at 1440×900: **0 JS errors**, **0 overflow** on surface / matrix / filter, all 8 canvases
  painted on every board.
- Asset audit in the live DOM: exactly one external file (`assets/walnut.png`), decodes 1024×1024; everything
  else is CSS gradients, inline SVG and canvas. No 404s possible.
- Sequencer bar ruler vs grid: 230 / 523.8 / 818.5 / 1113.3 vs 230 / 524.5 / 819 / 1113.5 → within 0.7 px.
- Velocity lane alignment: 0.0 px drift (cell mid 397.8, bar mid 397.5).
- Transport macro labels clear the band edge by 6 px after the 36/34 pot change.
- Filter and envelope cards equal height (167 px each) after removing the stray caption.

## NOT PROVEN
- All interaction: hover, drag, wheel, keyboard, focus, tooltips. The boards are stills.
- Legibility of 10 px micro-labels on a real 1440 laptop panel at 125%.
- Mica / `backgroundMaterial` on this machine's Electron version.
- Whether `av_pair.js` / `av_num.js` can absorb all 71 native selects without changing ids.
- The 1280×800 floor: the K23 density gate is knife-edge (sequence 1.18, system/family 1.19 vs 1.2).

---

## THE QUEUE (in order)

### A. OWNER DECISIONS (block the build)
1. **Navigation**: adopt the three-mode model (§3.1) or keep nine tabs? Biggest structural call.
2. **Finish**: gold, silver or walnut leading — and the order in the switcher.
3. Gold: keep cyan scope windows or use a cream VU face like the other two?
4. Walnut: brass pinstripe or plain join?
5. Inspector: collapsible everywhere or fixed on Sound only?
6. Floor: confirm 1280×800 as the supported minimum.
7. Fonts: confirm bundling Inter var + IBM Plex Mono (~350 KB).

### B. BUILD (after A)
- **P0 — tokens + chassis.** Replace `:root` with the metal/glass token set, add the type ramp and icon
  sprite, rebuild the three bands, delete the fake menu strip, dock 68 px. Gate: chassis rig, a11y 37,
  K23 measured before/after at 1280 (must not get worse; target is better — 66 px returned).
- **P1 — control language.** Replace all 71 native selects with `.av-pair` / popover / stepper; unify knobs to
  six tiers; delete conic value rings and glows; add tick rings + hover value popovers. Gate: new
  control-language rig, per-zone keyboard walk, K23 unchanged.
- **P2 — working surfaces.** SOUND (osc cards, big filter response, amp/mod env, routing matrix), MIX
  (standard strip order, dB scale, meters, master), SEQUENCE (64-step grid, velocity lane, step inspector),
  EFFECTS (serial chain with a real signal rail). Gate: one rig per surface + owner eye gate.
- **P3 — finishes.** Move the token sets into `themes/`, add the finish switcher persisted per patch,
  installer remembers it. Gate: all 23 rigs on each finish (token swap must not move geometry).
- **P4 — craft.** Meter ballistics, peak hold, keyboard feel, drag-to-modulate, tooltips, focus rings,
  High Contrast, 150% DPI. Gate: full wave battery + desktop rig + owner eye gate.

### C. REFINEMENTS I WOULD DO NEXT ON THE BOARDS (if the owner wants more stills)
1. Filter axis labels 7.5 px @ 0.38 ink → 9 px @ 0.5.
2. Wavetable: the bottom ~16% is dead space — turn it into a spectrum strip.
3. Real data everywhere (mixer levels, browser list) instead of mock values.
4. A hover/tooltip state board (knob popup, modulation drag ghost) to prove the interaction design.
5. One "installer first-run" board: what the user sees the first time the app opens.

### D. CARRIED OVER FROM SESSION 25 (unchanged, still open in the app)
- MIDI import bug (`.mid` opens the picker, file does not load) — not reproduced yet.
- Full wave battery on `97ba6540`, then rebuild installer / version.json from those bytes.
- Install journey blocked on one elevated uninstall of the stale `C:\Program Files\Anvil`.
- Publish: source zip, three sha256s, push ~68 commits, tag v1.15.0, deploy to moddys.net/anvil.
- Owner calls: where `.av-fader` lives, whether card sections become `.av-group`.
- Owner eye gates on the five folded surfaces + FM/WT/CODE/SEQ/MATRIX + FX screens + the four new controls.

---

## TRAPS / LESSONS FROM THIS SESSION
1. **A palette change after a failed render leaves stale PNGs.** The browser daemon died on a locked
   `~/.config/browser-harness/runtime/bu-default.port`; delete that file and re-render. Always re-render
   after a token change before judging a board.
2. **Inline `flex:0 0 230px` beats a theme variable.** Use `flex:0 0 var(--sec-osc,230px)` so the thicker
   walnut case can reclaim 25 px without clipping the modulation block.
3. **Fader caps positioned in fixed px drift when the strip height changes.** Position with
   `calc(% - 6px)`, never `top: 123px`.
4. **A class that only exists as `.scope .badge` renders at 16 px elsewhere.** The filter caption became a
   20 px heading and overlapped the next section; scoped classes need a base rule or none at all.
5. **Velocity lanes must share the step grid's flex geometry**, including the track-list offset. Pulling the
   lane left by the track-list width (`margin-left:-198px`) without a matching label column breaks alignment.
6. **"16 steps · 1 bar" over four bars is a functional lie.** Grid resolution must match the transport label.
7. **The browser harness window is 762×428 by default** — always `Emulation.setDeviceMetricsOverride` to
   1440×900 before a screenshot, or every measurement is wrong.
8. **Don't grep the whole home directory for prior art with a broad regex** — it pulled cache blobs and
   history databases; the useful hit was `wobblefx/gui/ui/next/tokens.css` (`data-theme="wood"`).

## FILES
```
C:\Users\Moddy\anvil\docs\16-console-design-program.md          plan of record
C:\Users\Moddy\anvil\renders\concept-v2\console.html            three finishes, 3 screens, switcher
C:\Users\Moddy\anvil\renders\concept-v2\modes.html              three-mode navigation study
C:\Users\Moddy\anvil\renders\concept-v2\final-*.png             9 boards
C:\Users\Moddy\anvil\renders\concept-v2\modes-*.png             3 mode boards
C:\Users\Moddy\anvil\renders\concept-v2\assets\*.png            6 Higgsfield material textures
C:\Users\Moddy\AppData\Local\hermes\profiles\deepseek\skills\...\anvil-synth-ops\references\console-design.md
```

## FIRST MOVES NEXT SESSION
1. Read `docs/16-console-design-program.md` §3, §3.1, §11 — the navigation decision and the seven owner calls.
2. Open `renders/concept-v2/console.html` and `modes.html`; confirm the boards still match the doc.
3. Get the owner's seven answers. **Do not start P0 before the navigation call** — it changes the chassis.
4. If he says build: P0 only (tokens, type, icons, three bands), run the fast lane and K23 before/after,
   then stop for his eye gate.
5. If he says more stills: do the five refinements in queue C, starting with the filter labels and the
   hover/tooltip state board.
