# Anvil - current UI structure audit (pre-redesign)

Audit of the CURRENT Anvil UI as built from `src/` by `build.py` into `index.html` (built file: 3,375,055 bytes, timestamp 2026-10-08 07:33). Read-only source audit: no build, no browser, no test suite, no git was run for this document.

Measured numbers referenced throughout (scrollHeight, card heights) come from the parent's live dump of https://moddys.net/anvil/ at 1440x900: **document scrollHeight 13043px vs clientHeight ~900**; at a 568px-tall test viewport 13043 vs 568. Per-card heights quoted below are from that same dump.

Source files read: `src/body.html` (full), `src/head.html` (full), `src/styles.css` (full, 1409 lines), `src/app_core.js` (full), `docs/02-ui-design-brief.md` (full), plus targeted greps/reads across all `src/*.js` (mount points, interaction handlers, keyboard, palette, help, dock, per-card modules).

---

## 1. Shell structure

### 1.1 Header (static markup, `src/body.html:2-10`; skin `src/styles.css:46-53`)

Plain in-flow element `header.av-head` (flex row, gap 10px, padding 10px 16px, border-bottom 1px). NOT sticky/fixed - it scrolls away with the page (no `position` rule on `.av-head`, `styles.css:46-53`).

| Item | id/class | ref | behaviour |
|---|---|---|---|
| Wordmark | `span.av-word` "Anvil" | `body.html:3`; `styles.css:54-60` | static |
| Version chip | `#av-version` (`span.av-chip.av-hot`) | `body.html:4` | text set at boot to `v` + `ANVIL.version` = "v1.7.0" (`app_core.js:6`, `app_core.js:155-156`) |
| Spacer | `span.av-spacer` | `body.html:5`; `styles.css:61` | pushes the rest right |
| Tier chip | `#av-tier` (`av-dim`) | `body.html:6` | boot: "tap: armed - engine: booting" (`app_core.js:157-158`); later owned by the engine facade (`av_engine.js:577`) |
| Voices chip | `#av-voices` (`av-dim`) | `body.html:7` | owned by the engine facade (`av_engine.js:589`) |
| Piano-dock button | `#btn-piano` | `body.html:8` | click toggles dock (`av_kb.js:388-389`); tooltip via `AV_HELP_TIPS` (`av_help.js:57`) |
| Help button | `#av-help` | `body.html:9` | opens help overlay (`av_help.js`; tip `av_help.js:58`) |
| A11y host (JS-injected) | `#av-a11y-host` with `#av-a11y-contrast` + `#av-a11y-motion` buttons | injected into `header.av-head` (`av_a11y.js:276-330`) | toggles high contrast / reduced motion (`av_a11y.js:300-333`); also a skip link `#av-a11y-skip` and a live region `#av-a11y-live` (`av_a11y.js:243`, `av_a11y.js:210-235`) |

### 1.2 Main (`src/body.html:12`; `src/styles.css:86-95`)

`main.av-main`: flex column, gap 12px, `max-width:1080px`, centered, padding 20px 16px, `flex:1`. Contains 24 `section.av-card` elements plus the JS-injected `#av-firstrun` strip (see section 2). Card skin: `.av-card` panel + 2px teal left cap (`styles.css:96-108`). `body:not(.piano-closed) .av-main` gets `padding-bottom: calc(20px + var(--dock-tax))` so the fixed dock does not cover the last card (`styles.css:179-181`). The a11y layer also sets `id="av-main"` + `tabindex="-1"` on the main element for the skip link (`av_a11y.js:265-267`).

Page scroll model: `html, body { height:100% }` (`styles.css:30`), body is a flex column (`styles.css:31-41`), `.av-main` has NO overflow property. The single scrolling box is the DOCUMENT itself (confirmed: no overflow on main/body/html; only `#piano-dock` and overlays are fixed).

### 1.3 Footer (`src/body.html:145-147`; `src/styles.css:290-294`)

`footer.av-foot`: one dim span, text "Anvil - a MODDYS Foundry instrument - S5 - code + keys + help - AGPL-3.0-or-later" (`body.html:146`). When the dock is open it gains `margin-bottom: var(--dock-tax)` (`styles.css:181`).

### 1.4 Piano dock (`src/body.html:149-168`; `src/styles.css:175-261`)

`#piano-dock`: `position:fixed; left:16px; right:16px; bottom:0; z-index:41; height: var(--dock-h)` (136px, `styles.css:178`, `styles.css:182-192`). `body.piano-closed` hides it (`styles.css:193`). The page never resizes; content is just padded via `--dock-tax` (`styles.css:178-181`).

Rail `#piano-rail` (`body.html:150-166`; `styles.css:196-201`):
- `#pk-close` - hide dock (`body.html:151`; bound `av_kb.js:390-391`)
- `#pk-pop` - pop the keys out into a PiP/named window (`body.html:152`; bound `av_kb_pop.js:450-460`)
- `#pk-return` "BACK" - bring the keys home (`body.html:153`; `av_kb_pop.js:450-460`)
- `#pk-modes` input-mode group (`body.html:154-158`): three chips `.pk-mode[data-mode=studio|keys|midi]` (`body.html:155-157`; bound `av_kb.js:402-404`; skin `styles.css:202-213`), with LED `#pk-arm-led` in the KEYS chip (`body.html:156`)
- `#pk-mode-hint` one-line hint (`body.html:159`; text set `av_kb.js:197-198`; copy `av_kb.js:53-57`)
- octave group `.pk-rail-ctl`: `#pk-oct-down` (`body.html:161`; `av_kb.js:392-393`), `#pk-win` readout "OCT C4" (`body.html:162`; updated `av_kb.js:185-186`), `#pk-oct-up` (`body.html:163`; `av_kb.js:394-395`)
- `.pk-rail-note` tutorial string "click to play - hold to sustain - glide to sweep - ` flips STUDIO <-> KEYS" (`body.html:165`)
- key bed `#piano-keys` (`body.html:167`; `styles.css:221`), 61 keys C2..C7 (MIDI 36..96, `av_kb.js:36-37`) built at init (`av_kb.js:130-154`), pointer-glide bound on the bed (`av_kb.js:205-238`)

Popout window (separate document) carries its own bar `#pk-pop-bar` / `#pk-pop-arm` / `#pk-pop-win` / `#pk-pop-hint` (`av_kb_pop.js:42-43`, `av_kb_pop.js:220-245`).

### 1.5 Fixed/overlay z-layer inventory

| Element | position | z | ref |
|---|---|---|---|
| `#piano-dock` | fixed bottom | 41 | `styles.css:183` |
| `#av-help-overlay` (help side panel, inline geometry) | fixed top:52 right:12 w:400 | 46 | `av_help.js:305-310`; `.av-help` `styles.css:976` |
| `.av-pwa-chips` (PWA toasts, bottom-right above dock) | fixed right:16 bottom:calc(16px+--dock-tax) | 46 | `styles.css:1274-1278` |
| `.av-a11y-skip` (focus-only skip link) | fixed top-left | 60 | `styles.css:1359-1366` |
| tour shade / ring / panel / spot | fixed | 1500 / 1501 / 1502 / 1503 | `styles.css:1003-1010`; `av_help.js:727-744` |
| `.av-wiz` (sound wizard panel) | fixed top:14vh centered | 1550 | `styles.css:1046` |
| `#av-tip` (tooltip bubble) | fixed, pointer-events none | 1600 | `styles.css:1004`; `av_help.js:560` |
| `#av-palette` (Ctrl-K) | fixed inset:0 | 1620 | `styles.css:1021`; `av_palette.js:465-493` |

---

## 2. Card inventory

Counts verified in the built file: `rg '<section class="av-card"' index.html` = **24 sections** (22 carry `av-*` ids; the hero and the Roadmap card are anonymous), order exactly as below (`index.html:1448-1569`, identical to `src/body.html:13-142`). Plus one JS-injected strip `#av-firstrun` inserted BEFORE `#av-levels` inside `.av-main` (`av_lessons.js:726-754`). Table below has 25 rows: the 22 ids from the parent's list (21 sections + the injected strip), the hero, plus two cards the parent's list omitted but that exist in the current build (`av-family`, Roadmap).

Mount mechanism, all cards: the card root + heading + ONE empty host div are static HTML in `body.html`; the owning JS module fills that host with `innerHTML` and binds DELEGATED listeners on the host (click/change/input), booted from the single avBoot block (`app_core.js:65-168`). The only runtime-created card DOM is `#av-firstrun`.

| # | Card id | Purpose (1 line) | Rendered by / mount mechanism | Height px (live dump) |
|---|---|---|---|---|
| 0 | (hero, no id) | Intro card: phase headline + build/feature essay text | static `body.html:13-17` | 401 |
| 1 | `av-firstrun` | First-sound strip: one button loads demo groove + starts transport; dismiss sets gate | JS-injected `section` before `#av-levels` (`av_lessons.js:726-754`); gate key `av_lessons.js:60`; button `av_lessons.js:711-724` | (not in dump) |
| 2 | `av-levels` | Instrument + Master gain knobs on the master tap | `avMountLevels()` builds 2 av-knobs into `#av-levels-knobs` (`app_core.js:53-62`) | 220 |
| 3 | `av-synth` | Voice engine card: ENGINE select + per-kind panels + preset BANK row | `avSynthInit()` fills `#av-synth-knobs` (`av_synth.js:457-478`); bank row into `#av-synth-bank-host` (`av_bank.js:640-647`, `av_bank.js:681`) | 663 |
| 4 | `av-fm` | FM engine surface: 6 op tabs, 8 algorithms, SVG algorithm view | `avFmUiInit()` fills `#av-fm-host` (`av_fm_ui.js:340`); tabs/algo `av_fm_ui.js:395`, `av_fm_ui.js:558` | 530 |
| 5 | `av-fx` | FX rack: 7 fixed strips (drive/flavour/mod/delay/verb/conv/dyn) | `avFxInit()` fills `#av-fx-host` (`av_fx.js:228-267`); strip table `av_fx.js:46-136` | 1092 |
| 6 | `av-mod` | Mod matrix: 8 macro knobs + up to 32 src->dst slot rows | `avModInit()` fills `#av-mod-host` (`av_mod.js:442-449`, `av_mod.js:527+`); row markup `av_mod.js:396-437` | 304 |
| 7 | `av-midi-card` | Web MIDI deck: enable/ports/monitor/clock out/CC learn | `avMidiInit()` fills `#av-midi-body` (`av_midi.js:294`, `av_midi.js:477`, `av_midi.js:1141`) | 1082 |
| 8 | `av-drums` | Drum pads (16) playing through the note bus | `avPadsInit()` fills `#av-pads-host` (`av_pads.js:42`, `av_pads.js:122+`) | 310 |
| 9 | `av-sample` | Sample core: import/decode/waveform/preview | `avSampleInit()` fills `#av-sample-host` (`av_sample.js:565`); drop zone `av_sample.js:244` | 128 |
| 10 | `av-chop` | Chop surface: detect transients, slice editor, 16 pads, steps | `avChopUiInit()` fills `#av-chop-host` (`av_chop_ui.js:241`, `av_chop_ui.js:1457`) | 438 |
| 11 | `av-wt` | Wavetable editor: canvas paint, morph tools, local library | `avWtUiInit()` fills `#av-wt-host` (`av_wt_ui.js:403`); canvas gestures `av_wt_ui.js:1735-1736` | 525 |
| 12 | `av-rec` | Master-output recorder -> WAV download | `avRecInit()` fills `#av-rec-host` (`av_rec.js:338`) | 88 |
| 13 | `av-seq` | Step sequencer: 4 tracks, swing, p-locks, chains, scenes, capture | `avSeqUiInit()` fills `#av-seq-host` (`av_seq_ui.js:1807`; host getter `av_seq_ui.js:186`) | 895 |
| 14 | `av-store` | Pack store: search/filter, install/remove packs | `avStoreUiInit()` fills `#av-store-host` (`av_store_ui.js:160-162`); anatomy `av_store_ui.js:6-34` | 586 |
| 15 | `av-deliver` | One-press offline stems export (.zip) | `avDeliverUiInit()` fills `#av-deliver-host` (`av_deliver_ui.js:966`) | 282 |
| 16 | `av-studio` | Studio record core: input, metronome, lap takes | `avStudioUiInit()` fills `#av-studio-host` (`av_studio_ui.js:344`) | 417 |
| 17 | `av-sessions` | Versioned session snapshots + autosave + backup zip | `avSessionUiInit()` fills `#av-sessions-host` (`av_session_ui.js:280`) | 399 |
| 18 | `av-comp` | Take lanes + pick-best comping + WAV export | `avCompUiInit()` fills `#av-comp-host` (`av_comp_ui.js:302`) | 398 |
| 19 | `av-mix` | Mix & master: track rows, sends, glue, master chain, A/B, render/export | `avMixUiInit()` fills `#av-mix-host` (`av_mix_ui.js:459`); builder `av_mix_ui.js:824-1003` | 1223 |
| 20 | `av-deck` | Live scope/spectrum/waterfall + meter/readout deck | `avDeckUiInit()` fills `#av-deck-host` (`av_deck_ui.js:220`); canvases `#av-deck-scope/-spectrum/-waterfall` (`av_deck_ui.js:826`, `872`, `1161`) | 370 |
| 21 | `av-files` | Project & share: .anvl save/open, patch card, video clip | `avFilesUiInit()` fills `#av-files-host` (`av_files_ui.js:284`) | 487 |
| 22 | `av-code` | CODE: sandboxed user DSP modules, editor, library, params | `avCodeUiInit()` fills `#av-code-host` (`av_code_ui.js:199`) | 900 |
| 23 | `av-family` | MODDYS suite bridges (hub / resonance / radio) | `avFamilyPaint()` fills `#av-family-host` (`av_family.js:54`, `av_family.js:220-223`) | (not in dump) |
| 24 | (Roadmap, no id) | Static feature-plan list | static `body.html:132-142` | (not in dump) |

Sum of the 22 dumped heights = **11,738px**; the live scrollHeight of 13,043px additionally covers 23 card gaps x 12px (`styles.css:91`), header/footer, and the two undumped cards + the injected strip.

Boot order (one block, `app_core.js:65-168`): tap -> levels -> kb -> midi -> mpe deck -> synth -> pads -> sample -> rec -> fx -> mod -> seq(+plock/seqUi/capture/undo) -> store/bank -> deliver -> input/metro/takes/studio -> session/backup -> comp -> mix -> deck -> proj/card/video/files -> kbPop -> code -> help -> palette -> lessons -> fmUi -> wtUi -> chopUi -> pwa -> family -> a11y -> engine ensure.

---

## 3. Scroll analysis

### 3.1 Page-level scroll model

CONFIRMED single document scroll. The document is the only scrolling box for the 24-card stack:
- `html, body { height:100% }` (`styles.css:30`); `body` = flex column (`styles.css:31-41`).
- `.av-main` has `flex:1` but NO `overflow` (`styles.css:86-95`) - it cannot scroll internally.
- `#piano-dock` is `position:fixed` (`styles.css:183`); it never participates in layout, only `--dock-tax` padding (`styles.css:178-181`).
- There is no sticky element anywhere (`position: sticky` count in `styles.css` = 0); the header is not sticky.

Measured: scrollHeight 13043px at both 1440x900 (clientHeight ~900) and a 568px viewport. With the dock open the bottom ~156px (136px dock + 20px pad) of every viewport is permanently dock-occupied.

### 3.2 Explicit scrollable containers (overflow auto/scroll)

| # | Container | Declaration | Content it scrolls | Notes |
|---|---|---|---|---|
| 1 | `.av-seq-gridwrap` | `overflow-x:auto` (`styles.css:359`) | the step grid (`.av-seq-grid` min-width 640px, `styles.css:360`; built `av_seq_ui.js:1051`) | the only horizontal in-page scroller |
| 2 | `.av-code-list` | `max-height:260px; overflow:auto` (`styles.css:935`) | user-module library rows | |
| 3 | `.av-code-docs` | `max-height:240px; overflow:auto` (`styles.css:951`) | in-page module API contract docs | |
| 4 | `.av-help-body` | `overflow:auto; max-height:calc(100vh - 220px)` (`styles.css:985`) | help tabs content | nests inside scroller 8 |
| 5 | `.av-palette-list` | `max-height:320px; overflow:auto` (`styles.css:1026`) | Ctrl-K command list | |
| 6 | `.av-wiz-rows` | `overflow:auto; max-height:55vh` (`styles.css:1055`) | wizard choice rows | |
| 7 | `.av-fam-list` | `max-height:190px; overflow-y:auto` (`styles.css:1329`) | Resonance session list in FAMILY card | |
| 8 | `#av-help-overlay` root (inline styles, JS-created) | `overflow:auto; max-height:calc(100vh - 76px - var(--dock-tax))` (`av_help.js:305-310`) | the whole help side panel | scrolls nested with #4 |

Count: **8 explicit scrollable containers** (7 declared in `styles.css`, 1 inline in `av_help.js`).

### 3.3 Clip-only overflow (NOT scrollable; content is cut or ellipsized)

`.pk-mode-hint` (`styles.css:215`), `.av-midi-dev .grow` (`styles.css:275`), `.av-midi-mon` `max-height:170px; overflow:hidden` (`styles.css:278`, DOM-capped at 12 rows), `.av-midi-mon-line` (`styles.css:279`), `.av-studio-meter` (`styles.css:545`), `.av-comp-lane-bar` (`styles.css:687`), `.av-deck-meter-bar` (`styles.css:861`), `.av-deck-gain-bar` (`styles.css:868`), `.av-palette-box` rounding clip (`styles.css:1024`), `.av-wt-chip` (`styles.css:1146`), `.av-pop-hint` (`av_kb_pop.js:214`), popout document `html,body {overflow:hidden}` (`av_kb_pop.js:210`), screen-reader `.av-a11y-sr` (`styles.css:1369-1373`).

### 3.4 Natively scrollable text surfaces (implicit)

`.av-seq-io-area` textarea (`styles.css:395`, `resize:vertical`) and `.av-code-src` textarea (`styles.css:927`, min-height 240px, `resize:vertical`) scroll internally by browser default.

---

## 4. Interaction inventory (what exists TODAY)

### 4.1 Knob / rotary contract (`src/av_knob.js`)

Markup (`av_knob.js:89-121`): `.av-knob` `div`, `tabindex=0`, `role="slider"` (`av_knob.js:106`), `data-knob/min/max/step/def/curve/unit/fmt/sens/norm`, `aria-valuemin/max/now`, `title` tooltip combining label + formatted value + hint + the fixed string "(drag up/down or twist around the rim - wheel - double-click resets)" (`av_knob.js:103-104`, `av_knob.js:114`).

Gestures:
- Drag: hybrid gesture decided in the first few px - vertical slide ("lin", >6px) vs rim twist ("rot", >9px arc; rim = start radius > 35% of knob radius) (`av_knob.js:198-248`); travel curve 0.40x -> 2.0x over 260px (`av_knob.js:252-255`); damped follow + settle animation on release (`av_knob.js:257-258`, `av_knob.js:278-291`); mechanical stop feedback (`av_knob.js:260-264`).
- Fine drag: Shift multiplies sens 4x (`av_knob.js:227`); wheel + Shift = step/4 (`av_knob.js:315`).
- Click (no drag): one step up; Shift = one step down; Alt = 5% jump (`av_knob.js:295-304`).
- Double-click: reset to default (`av_knob.js:305-309`). **No type-in text entry exists.**
- Wheel: one step (`av_knob.js:310-316`). Arrows: step (Shift x10); Home/End min/max (`av_knob.js:319-332`).
- Commit funnel: `avKnobCommit` -> `avParams` mirror + `avApplyParam` (`av_knob.js:154-176`; app hook `app_core.js:27-45`).
- NO context menu, NO mod-assign gesture, NO mod ring on the knob, NO value popover. a11y pass backfills `tabindex` on knobs (`av_a11y.js:369-379`).

### 4.2 Tooltips

Two systems, both hover-hover only:
- Curated registry `AV_HELP_TIPS` (28 selector->text rows, `av_help.js:56-83`) + `data-av-tip` attributes + `avHelpTip(el,text)`; ONE delegated handler on document (pointerover/pointerout/focusin/focusout, `av_help.js:418-...`); bubble `#av-tip` fixed, pointer-events none, max-width 280px (`av_help.js:560`; `styles.css:1004-1005`); never tips over its own UI (`av_help.js:575`).
- Native `title=` attributes on knobs (`av_knob.js:114`) and most buttons (e.g. `body.html:8-9`, `av_seq_ui.js:1066-1068`).
- No tooltip anywhere lists modulation sources (the knob title string is fixed, `av_knob.js:103-104`).

### 4.3 Keyboard

- THE ONE app keydown listener is installed by `avKbInit` (`av_kb.js:406-408`) -> `avKbHandle` (`av_kb.js:291-368`). Route order: help/palette hook first (`av_help.js:475-511` via `avUiKeyHook`, `av_kb.js:300-301`) -> Ctrl+Alt+1/2/3 input picks (`av_kb.js:305-309`) -> Esc (unarm KEYS / blur field; palette+overlay own Esc inside the hook) (`av_kb.js:316-323`) -> typing-field guard (`av_kb.js:325`) -> MIDI-mode swallow (`av_kb.js:330-338`) -> KEYS-mode typing map (`av_kb.js:342-353`; A-row white / W-row black maps `av_kb.js:41-46`; Z/X and arrows = octave, `av_kb.js:344-347`; Space claimed but a no-op: "no transport yet" `av_kb.js:348`) -> KB_DEFS exact match: `Y` dock toggle, backtick arm, `[` `]` octave (`av_kb.js:62-67`).
- Second document keydown: a11y Enter/Space -> click delegation for `[role=button]` (`av_a11y.js:336-368`).
- Undo keys: Ctrl+Z / Ctrl+Shift+Z bound once by `avUndoInit` (`av_undo.js:36`).
- Popout forwards keydown/keyup into the app document (`av_kb_pop.js:152`, `av_kb_pop.js:289-292`).
- No keyboard shortcut for section jumps (no Alt+. / Alt+, implementation exists; only the palette Cards commands).

### 4.4 Command palette (`src/av_palette.js`) - Ctrl-K

Overlay `#av-palette` fixed inset 0 z 1620, input + list (`av_palette.js:465-493`; `styles.css:1021-1037`); fuzzy subsequence match (`av_palette.js:119-140`); one registered command list grouped by zone. Core commands (`av_palette.js:367-452`), zones:
Piano (toggle) - Input (studio/keys/midi) - Transport (play/stop) - Cards (scrollIntoView of 17 cards, `AV_PALETTE_CARDS` `av_palette.js:82-100`) - Groove (load demo) - Lessons (first-beat, acid-line, sample-chop, stems-export) - Wizards (bass/pad/pluck/lead) - Store (store.open) - Deliver (export stems highlight) - Help (tour, help open) - Studio (metronome, count-in, recorder) - Project (save .anvl, share card).
Note: `AV_PALETTE_CARDS` omits `av-fm`, `av-chop`, `av-wt`, `av-family` (and the hero/Roadmap) - those cards cannot be jumped to by name (`av_palette.js:82-100`). Keys while open: arrows/Enter/Esc owned by the palette (`av_palette.js:632-...`, `av_palette.js:712-...`); click-outside closes (`av_palette.js:638`); browser Ctrl-K suppressed (`av_palette.js:17`).

### 4.5 Help / tour / lessons overlays

- Help: `#av-help-overlay` side panel 400px at right:12 top:52, inline geometry (`av_help.js:305-310`), four tabs shortcuts/tour/guides/tips (`av_help.js:280-286`, tab switch `av_help.js:320-...`), shortcut rows built from AV_KB_DEFS + palette command list (`av_help.js:143-178`). `?` opens it (hook `av_help.js:475-511`).
- Tour engine: four shade divs + ring + panel, all fixed, shades pointer-events none (`av_help.js:727-744`; `styles.css:1003-1017`); each step `scrollIntoView({block:center})` (`av_help.js:143-145`); actions via `avLessonAction`; live state `window.__avHelp.tour = {active, step, total}` (`av_help.js:113-115`, `av_help.js:953`).
- Lessons (`src/av_lessons.js`): 5 lessons (demo, first-beat, acid-line, sample-chop, stems-export) run ON the av_help tour engine (`av_lessons.js:8-9`, `av_lessons.js:613-625`); reveal scrollIntoView smooth (`av_lessons.js:115-119`).
- Wizards: `#av-wiz` fixed centered panel, 4 kinds x 3 curated choices, AUDITION/KEEP/REROLL (`av_lessons.js:39-41`; `styles.css:1046-1065`).

### 4.6 Popouts (`src/av_kb_pop.js`)

Only the keyboard pops out. `#pk-pop` -> Document Picture-in-Picture `requestWindow` with an impostor check, else the named window `av-keys` (`av_kb_pop.js:14-20`, `av_kb_pop.js:450-460`); the live `#piano-keys` bed is ADOPTED into the popout document (handlers ride the node) (`av_kb_pop.js:21-23`); app styles imported by content; key forwarding re-dispatches into the app (`av_kb_pop.js:24-27`); window-death poll (~500ms) + pagehide home (`av_kb_pop.js:28-30`); refusal returns `{via:null,error}` honestly (`av_kb_pop.js:31-32`). No meter/sequencer popouts.

### 4.7 Drag interactions matrix

| Feature | Drag? | Mechanism / ref |
|---|---|---|
| Knobs (all cards) | YES | slide/twist pointer drag (`av_knob.js:198-265`) |
| Wavetable canvas paint | YES | draw/line/smooth pointer painting, commits on pointerup (`av_wt_ui.js:1735-1736`; tools `av_wt_ui.js:~30`) |
| Sample import | YES (file drag-drop) | host `dragover/dragenter/drop` (`av_sample.js:312-341`) + document stray-drop guard (`av_sample.js:301-310`) |
| Piano glide (sweep) | YES | `pointerover` while pointer held (`av_kb.js:220-224`) |
| Chop pads | press/hold (pointerdown/up) | not a drag-paint (`av_chop_ui.js:1200-1230`) |
| Sequencer steps | NO - click only | cells are `<button>`; click selects + toggles on/off (`av_seq_ui.js:1040-1042`, handler `av_seq_ui.js:1665`) |
| Mod assignment | NO drag | selects + "+ ADD SLOT" (`av_mod.js:396-437`, `av_mod.js:491-509`) |
| FX reorder / add / remove | NO | fixed 7-strip order (`av_fx.js:46-136`, `av_fx.js:204`) |
| Mixer | NO | native checkbox/select/knob rows (`av_mix_ui.js:824-1003`, handler `av_mix_ui.js:2200`) |
| P-lock lanes | NO | click cells to lock/unlock (`av_plock.js:848-858`) |
| Chop slice editor | text inputs/ranges for trims | per `av_chop_ui.js` rows |

### 4.8 Right-click / context menus

**None exist.** `rg contextmenu src/*.js` finds exactly 3 hits, all `preventDefault` only: piano bed (`av_kb.js:227`), drum pads (`av_pads.js:135`). No popover menu component anywhere (the brief's "Right-click power menu" is unimplemented).

### 4.9 Test observables related to UI (window handles)

- `documentElement[data-av-ready="1"]` smoke contract (`app_core.js:159`); `?avtest=1` runs tap/knob/engine selftests writing `#av-taptest` / `#av-knobtest` / `#av-enginetest` paragraphs into `.av-main` (`app_core.js:161-167`, `app_core.js:171-179`); `window.__avKnobTest` (`app_core.js:229`), `window.__avEngineTest` (`app_core.js:299`).
- UI modules: `window.__avKb` (snapshot fn, `av_kb.js:445`), `window.__avKbPop` (`av_kb_pop.js:462`), `window.__avPalette` `{version, open, close, run...}` (`av_palette.js:780`), `window.__avHelp` `{version, open, tour}` (`av_help.js:953`), `window.__avLessons` (`av_lessons.js:46`), `window.__avA11y` (`av_a11y.js:702`).
- Per-card debug handles (same pattern): `__avFx` (`av_fx.js:495`), `__avFmUi` (`av_fm_ui.js:634`), `__avBank` (`av_bank.js:731`), `__avSeqUi` (`av_seq_ui.js:1910`), `__avSeq`/`__avSeqTrace` (`av_seq_sched.js:680-681`), `__avSeqCapture` (`av_seq_capture.js:524`), `__avPlock` (`av_plock.js:769`), `__avPads`/`__avPadsFlash` (`av_pads.js:150-160`), `__avSample` (`av_sample.js:582`), `__avChopUi` (`av_chop_ui.js:1638`), `__avStoreUi` (`av_store_ui.js:1032`), `__avDeliverUi` (`av_deliver_ui.js:1314`), `__avStudioUi` (`av_studio_ui.js:1576`), `__avSessionUi` (`av_session_ui.js:1582`), `__avCompUi` (`av_comp_ui.js:1442`), `__avMixUi` (`av_mix_ui.js:2375`), `__avDeckUi` (`av_deck_ui.js:1511`), `__avFilesUi` (`av_files_ui.js:1024`), `__avCodeUi` (`av_code_ui.js:1642`), `__avFamily` (`av_family.js:1493`), `__avMidi` (`av_midi.js:1264`), `__avUndo` (`av_undo.js:~277`), `__avTakes` (`av_takes.js:765`). The wavetable editor exposes NO `window.__av*` handle.

---

## 5. How the key flows work TODAY

### (a) Choose an oscillator / engine kind in the SYNTH card
1. Scroll to the SYNTH card (page position ~621px from top of the card stack; the card is 663px tall).
2. The first control is the ENGINE `<select id="av-synth-engine">` rendered at the top of the body HTML (`av_synth.js:349-356`; option list va/acid/string/drum/grain/sampler + user kinds `av_synth.js:160-186`).
3. `change` -> `avSynthSetKind(sel.value)` (`av_synth.js:415-419`) -> commits `engine.kind` through `avSynthCommitValue` -> `avApplyParam` (`av_synth.js:400-404`).
4. The card swaps panels: one `.av-synth-panel[data-kind]` per kind, hidden unless active (`av_synth.js:442-449`).
5. Oscillator wave picks are plain selects (`select.av-select[data-param=osc1.type / osc2.type / filter.mode]`, `av_synth.js:126-159`, `av_synth.js:315-322`).

### (b) Assign modulation (av_mod)
1. Scroll to the MOD MATRIX card (top offset ~2906px of card stack; 304px tall).
2. Click "+ ADD SLOT" (`#av-mod-add`, `av_mod.js:431`; click route `av_mod.js:491`).
3. A new row appears: SRC `<select>` (14 sources: env1/env2/lfo1/vel/key/rand/macro1-8, `av_mod.js:47-50`) -> DST `<select>` (6 targets: cutoff/reso/pitch/osc1.level/osc2.level/pan, `av_mod.js:53`) -> `input[type=range]` amount -1..1 with readout -> curve `<select>` (linear/exp/S) -> X remove (`av_mod.js:396-413`).
4. Edits commit via delegated change/input (`av_mod.js:494-518`); model -> engine wire `avEngineMod` (`av_mod.js:172`).
There is NO drag assignment, no drop-target highlight, no per-control modulation badge, no visible ring on the destination knob.

### (c) Add / edit an FX slot (av_fx)
- No slots to add: the rack is 7 FIXED strips in a pinned order drive -> flavour -> mod -> delay -> verb -> conv -> dyn (`av_fx.js:46-136`; caption string `av_fx.js:204`).
- Each strip: an ON toggle button (`data-fx-toggle`, `av_fx.js:181-186`; click `av_fx.js:291-...`), a MODE/DIV select, and 3-4 headline knobs (per-module tables `av_fx.js:46-136`). No reorder, no insert/remove, no bypass-per-slot beyond the toggle; conv strip additionally has `#av-fx-conv-import` "IMPORT IR" + status (`av_fx.js:123`).

### (d) Open the store / bank
- Store = an INLINE card, not an overlay: `#av-store` section + `#av-store-host` (`body.html:82-85`; `av_store_ui.js:160-162`), with search `#av-store-search`, filter chips, INSTALLED/AVAILABLE sections, per-card install button (`av_store_ui.js:6-34`).
- Palette "Open store" (`store.open`, `av_palette.js:424-426`) scrolls the card into view and flashes it (`avPaletteStoreOpen`; flash class `styles.css:1036-1037`).
- Bank = one compact row (pack select + preset select + APPLY + PREVIEW) inside the SYNTH card, mounted into `#av-synth-bank-host` (parent) or inserted after the `#av-synth` h2 fallback (`av_bank.js:640-647`).

### (e) Switch between "stations"
None exist. There is no tab bar, no sidebar, no view switcher: 24 cards stack vertically in one document scroll. The only "navigation" is (i) palette Cards commands = `scrollIntoView({block:"start"})` (`av_palette.js:78-100`, `av_palette.js:248-272`), (ii) tour/lesson step `scrollIntoView` (`av_help.js:143-145`, `av_lessons.js:115-119`), (iii) manual scrolling. The dock chips named STUDIO/KEYS/MIDI do NOT switch views - they pick what the computer keyboard drives (section 6).

### (f) Start the sequencer and edit steps
1. Scroll to the SEQ card (top offset ~5781px of card stack - about 6 viewports down).
2. PLAY button `#av-seq-play` (built `av_seq_ui.js:1066`) -> click route `avSeqUiTransport("play")` (`av_seq_ui.js:1662`); STOP/REC beside it (`av_seq_ui.js:1667-1668`; REC cycles off -> step -> live, `av_seq_ui.js:1664`). Palette also has transport.play/stop (`av_palette.js:381-386`).
3. Edit: click a grid cell - selects it and toggles on/off (`av_seq_ui.js:1041-1042`); the inspector below (`av_seq_ui.js:1086-1101`) edits the selected step: NOTE, VEL, GATE, PROB, RATCHET, MICRO, OCT, COND, SLIDE, ACCENT, plus CLEAR (`#av-seq-insp-del`, `av_seq_ui.js:1089`). Selection state `avSeqUiState.sel` (`av_seq_ui.js:128`, `av_seq_ui.js:335-344`).
4. P-locks: in the inspector, "+ LANE" adds a lane row (path select + custom path + interp select), then click cells to lock/unlock the current knob value (`av_plock.js:848-858`; host = `#av-seq-plock` or the inspector shell, `av_plock.js:778-793`).
5. Grid scrolls horizontally via `.av-seq-gridwrap` (`styles.css:359`); rows are 4 tracks with per-track length/speed/swing selects (`av_seq_ui.js:459-461`).

---

## 6. Dock + keyboard

- The dock tabs (chips) STUDIO / KEYS / MIDI are the INPUT-MODE picker for the computer keyboard, not screen navigation. One place changes the mode: `avSetInputMode` (`av_kb.js:243-256`; persisted in localStorage `av-input-mode`, `av_kb.js:32`, `av_kb.js:249`). Same three states via Ctrl+Alt+1/2/3 (`av_kb.js:305-309`), the backtick key toggles STUDIO<->KEYS (`av_kb.js:64`, `av_kb.js:286`), and Esc hands the keyboard back from KEYS (`av_kb.js:316-323`).
- What each mode means: STUDIO = letters quiet; KEYS = typing keys play the dock (A-row white, W-row black) with the `KEYS` LED on and body class `kb-armed` (`av_kb.js:53-57`, `av_kb.js:188-199`); MIDI = hardware plays, PC letters stay quiet, F-keys/Space/modifiers still work (`av_kb.js:330-338`).
- Where the keyboard bed lives: `#piano-keys` inside the fixed 136px dock (section 1.4); 61 keys C2..C7 (`av_kb.js:36-37`), window octave C2/C3/C4/C5 via `#pk-oct-up/down` or `[ ]` or Z/X (`av_kb.js:271-274`, `av_kb.js:73`); scale highlight from module state `avKbScale` default "C:minor" (`av_kb.js:71`, `av_kb.js:84-98`).
- Popout behaviour: `#pk-pop` opens a PiP/named window `av-keys` and the SAME bed node is adopted into it (`av_kb_pop.js:14-34`); body gets `piano-pop`, the rail hint switches to the popout copy (`av_kb.js:198`; copy `av_kb_pop.js:58-62`); `#pk-return` or closing the window brings the bed home; while out, one forwarder re-dispatches keys into the app (`av_kb_pop.js:24-27`). A blocked popup refuses honestly (no half state).

---

## 7. Divergence list vs docs/02-ui-design-brief.md (the 7-screen intent)

Each row: what the brief promised (docs/02 file:line) vs what the built app actually does (evidence).

| # | Brief promise | Built reality | Evidence |
|---|---|---|---|
| 1 | "The seven screens" with one job each: Voice / Mod / Sequencer / Mixer-FX / Browser-Store / Perform / Help (docs/02:21-29) | ONE 13043px scrolling page of 24 stacked cards + 1 injected strip; no screens, no navigation, no view switching | `body.html:12-143`; `styles.css:86-95`; section 5(e) |
| 2 | Persistent header on every screen: "preset name - undo/redo - A/B - CPU/voices + meter - master - help" (docs/02:31) | Header has: wordmark, version chip, tier chip, voices chip, piano button, help button, a11y toggles. NO preset name, NO undo/redo UI (Ctrl+Z only, `av_undo.js:36`), NO A/B UI (exists as `avUndoAStore/ARecall` with no surface), NO CPU meter, NO master control in the header | `body.html:2-10`; `av_engine.js:577-589`; `av_undo.js:36-59` |
| 3 | Drag-source->target modulation with pre-drop audition = "Primary interaction of the whole app" (docs/02:42; principle docs/02:14; flair #1 docs/02:93) | Mod matrix row builder via selects + ADD SLOT; no drag gesture, no audition, no drop targets | `av_mod.js:396-437`, `av_mod.js:491-509`; section 5(b) |
| 4 | Right-click power menu on every control: Reset / Lock / MIDI Learn / Modulate / Bypass (docs/02:44; flair #8 docs/02:93) | No context menus at all; `contextmenu` only ever prevented (kb bed, drum pads) | `av_kb.js:227`, `av_pads.js:135`; rg contextmenu = 3 hits |
| 5 | Hover tooltips on every control: value, unit, and - if modulated - the list of sources (docs/02:43) | Tooltips exist (curated `#av-tip` + native `title=`), but NONE carry modulation sources; knob title string is fixed | `av_help.js:56-83`, `av_knob.js:103-104` |
| 6 | Interaction grammar: fine-drag, **double-click text entry**, wheel steps, arrow-key adjust, Ctrl/Cmd-click reset (docs/02:45) | Fine-drag yes, wheel yes, arrows yes; double-click = RESET only (no numeric type-in); no Ctrl-click reset variant (dblclick resets) | `av_knob.js:295-332` |
| 7 | Undo/redo for everything, persistent in header; A/B compare + copy (docs/02:46) | Undo/redo engine exists (`av_undo.js`, Ctrl+Z/Ctrl+Shift+Z, domains params/seq/plock); no header UI, no A/B surface | `av_undo.js:36-59`; header `body.html:2-10` |
| 8 | Section jumps Alt+. / Alt+, ; rebindable shortcuts; "?" overlay (docs/02:47) | `?` overlay exists (`av_help.js`); NO Alt+. / Alt+, section jump keys (KB_DEFS = Y, backtick + [ ] only) | `av_kb.js:62-67`; `av_help.js:475-511` |
| 9 | Voice screen: hero canvas (live wavetable morph + scope) top-left, three oscillator cards, right rail macros + mod chips (docs/02:23) | SYNTH card = one ENGINE select + knob rows; no canvas in the card; the "hero" section is a text essay; scopes live only in the DECK card | `av_synth.js:349-393`; `body.html:13-17`; `av_deck_ui.js:826-1161` |
| 10 | Mod screen: same data two views - canvas patch area (cables, zoom) AND matrix table (docs/02:24) | Matrix table view only; no patch canvas / cables / zoom | `av_mod.js:425-437` |
| 11 | Sequencer: pattern grid + piano-roll/clip view; swing, pattern bank, chains/song rows, scenes; step cells keyboard-navigable (docs/02:25) | Grid + inspector + song rows + scenes + p-locks + capture; NO piano-roll; cells are tab-reachable buttons but no arrow-key cell navigation found | `av_seq_ui.js:1051`, `av_seq_ui.js:1086-1101`, `av_seq_ui.js:1155-1200`; no Arrow handling in `av_seq_ui.js` |
| 12 | Mixer/FX: lane-based rack (drag-reorder), aux bus routing view, meter bridge, double-click text entry everywhere (docs/02:26) | FX rack = fixed order; mix card rows w/ knobs but no drag-reorder; no double-click text entry on controls | `av_fx.js:46-136`, `av_fx.js:204`; `av_mix_ui.js:824-1003` |
| 13 | Browser/Store: search-first, facets, favourites, per-row preview, similar presets (docs/02:27; principle docs/02:16) | Store card has search + 3 filter chips + install/remove; bank row has APPLY/PREVIEW on a fresh offline engine; no favourites/playlists/similar; preview is bank-only | `av_store_ui.js:6-34`; `av_bank.js:1-11`, `av_bank.js:640-647` |
| 14 | Perform/Fullscreen screen; popout windows for keyboard AND meters/sequencer (docs/02:28, docs/02:37) | No Perform screen; only the keyboard pops out | `av_kb_pop.js:1-47`; no other popout module in src/ |
| 15 | Layout: work-area-relative sizing, priority ladder, collapse to rails; breakpoints 1440/1180 (docs/02:35, docs/02:38) | One fixed 1080px max-width column for all viewport sizes; no fold/rail logic; only a dock media query <700px and key-label container queries | `styles.css:86-95`, `styles.css:259-261` |
| 16 | First run: land -> audio unlock -> demo loop already playing -> 6 live sliders visible -> optional 60s tour (docs/02:56) | First-run strip button loads the demo + starts transport; only 2 LIVE knobs on screen at top (LEVELS); tour is manual (help/palette) | `av_lessons.js:689-754`, `av_lessons.js:711-724`; `app_core.js:48-62` |
| 17 | Anti-patterns banned: "multi-click common actions", "hidden modulation", "mystery right-click-only power" (mitigated by visible affordances) (docs/02:89) | Mod assignment is multi-click (ADD SLOT + 2 selects + slider); modulation visibility is limited to the matrix card itself | `av_mod.js:396-437` |
| 18 | Build order/screens re-validated at 1440/1180/900 (docs/02:101); header/shell -> Voice -> Browser -> Mod -> Sequencer -> Mixer -> Perform -> Help (docs/02:101) | Card order in the shipped page: hero, [first-run strip], Levels, Synth, FM, FX, Mod, MIDI, Drums, Samples, Chop, WT, Recorder, Sequencer, Store, Deliver, Studio, Sessions, Comp, Mix, Deck, Files, Code, Family, Roadmap | `body.html:13-142`; `index.html:1448-1569` |

Implemented AND matching the brief (for balance): theme tokens exactly per docs/02 sec 9 (`styles.css:4-27` comments cite the brief); `?` help overlay that never covers the keyboard (`av_help.js:12-15`); outcome-named recipes (4 guides, `av_help.js:87-100`); wizards for starters (`av_lessons.js:39-41`); scenes/mutate/humanize in SEQ (`av_seq_ui.js:1117-1136`); high-contrast + reduced-motion modes (`av_a11y.js`, `styles.css:1382-1408`).

---

## 8. Friction inventory (observations only)

Structural friction points matching the reviewing engineer's complaints ("the scrolling is awful", "not designed with common sound-engineer programs in mind", "workflow GUI/interactions of modules should be refined"):

1. **Single document scroll, 13043px tall.** At 1440x900 that is ~14.5 viewports of vertical travel; at a 568px viewport ~23 viewports. There is no in-page navigation (no tabs, no sidebar, no sticky header - the header scrolls away, `styles.css:46-53`). Measured live: scrollHeight 13043 vs clientHeight ~900.

2. **Stacking order is phase-append order, not workflow order.** Instrument controls (Levels 220 + Synth 663 + FM 530 + FX 1092 + Mod 304) span y 0-2906; the 1082px MIDI card sits between Mod and Drums (y 3210-4292); sample/chop/wt occupy y 4602-5693; the 88px Recorder sits at y 5693-5781 immediately before the 895px Sequencer; the store (586px) sits between Sequencer and Deliver (y 6676-7262); the production stack (Studio 417 / Sessions 399 / Comp 398 / Mix 1223 / Deck 370) occupies y 7544-10351; Project&Share + CODE (900px) end the page. A sound engineer's likely first tasks (sequencer start, FX tweak) are 3-9k px apart.

3. **Card height extremes.** 88px (Recorder) to 1223px (Mix = 1.36x a 900px viewport). The dump sums to 11,738px of card height for 22 cards (average ~534px).

4. **Related controls are far apart vertically (measured top offsets of the card stack):**
   - SYNTH card top ~621px vs its FM surface ~1284px vs Mod Matrix ~2906px - the voice, its FM engine, and its modulation assignments are 1-2.3k px apart.
   - Wavetable editor (y ~5168-5693) is ~4.5k px below the SYNTH OSC2 it feeds (~621).
   - Chop card (~4730) feeds the Sampler voice but the ENGINE select that must be set to "sampler" is ~4.1k px above it.
   - Sequencer PLAY (~5781) is ~5.8k px below the LEVELS/ENGINE controls; Mix render (~8758) another ~3k below that.

5. **Deep-page discoverability.** Everything below the first ~900px is reachable only by scrolling or by typing in Ctrl-K (the palette's Cards commands scrollIntoView, `av_palette.js:78-100`, `av_palette.js:248-272`). The palette itself omits 4 cards from its jump list (av-fm, av-chop, av-wt, av-family, `av_palette.js:82-100`), so those are scroll-only.

6. **Requires 6000+px scroll to reach:** Sequencer ~5.8k (card sum) / ~6k with gaps+header; Store ~6.7k; Mix ~8.8k (top) and ~10k (bottom); CODE ~10.8k; bottom of page 13k.

7. **Nested/independent scroll silos in a giant page.** 8 explicit scrollable containers (section 3.2), 6 of them with fixed max-heights (code list/docs 260/240px, palette 320px, wiz 55vh, fam 190px, help body calc). The help panel nests TWO scroll maxima (root overflow auto `av_help.js:307` inside which `.av-help-body` has its own overflow auto `styles.css:985`). The seq grid has the page's only horizontal scroller (`styles.css:359`).

8. **Dock occlusion budget.** The fixed 136px dock (styles.css:182-192) + 20px pad permanently occupies the bottom ~156px of every viewport; at 900px that leaves ~744px of usable height; the dock never shrinks the page, it only pads the scroll end (`styles.css:179-181`). Bottom-right fixed elements (pwa chips `styles.css:1275`, tour panel `av_help.js:744`) position themselves ABOVE the dock via `--dock-tax`.

9. **No modulation visibility on controls.** The only place a routing exists is inside the Mod card (rows); destination knobs carry no ring, badge or tooltip note (`av_knob.js:103-104`), i.e. the "Massive X failure" the brief explicitly banned (docs/02:14) is present in the shipped UI.

10. **No right-click affordances at all** - power actions implied by the brief (reset/lock/MIDI learn/modulate/bypass, docs/02:44) have no surface; MIDI CC learn exists only inside the MIDI card (`av_midi.js:22-24`).

11. **The instrument's "play" and "record" surfaces are split.** Transport PLAY lives only in the SEQ card (`av_seq_ui.js:1066`; Space is explicitly a no-op, `av_kb.js:348`); the studio REC lives in the STUDIO card (`av-studio-rec`); the Recorder is a separate 88px card (`av_rec`). Starting a take requires visiting 2-3 cards thousands of px apart.

12. **Onboarding surface disappears.** The only in-page first-sound affordance is the `#av-firstrun` strip, removed after one use (localStorage gate `av_lessons.js:60`, `av_lessons.js:704-707`); afterwards the page top is a static text hero plus a 2-knob LEVELS card.

13. **Overlays present, but not for the store/browser.** Store and bank are inline cards in the scroll flow (sections 5(d)); the modal-family elements that DO exist (palette z1620, wizard z1550, tour z1500-1503, help z46) are all keyboard/help surfaces, so there is no quick, vision-covering browser moment - every browsing task adds scroll.

14. **The mid-page MIDI card is 1082px (1.2 viewports)** for a set-once configuration surface (ports/enable/clock), sitting between frequently used Mod and Drums cards.
