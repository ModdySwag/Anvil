# 13 — The FSVR chassis rework (C programme)

Status: OPEN 2026-11-06. Owner: Moddy. Plan of record.

Owner ask: "make my Anvil build into a similar cohesive integrated program as slick as FSVR —
full integration of my features, but in a layout that makes sense like FSVR. At the moment the
layout is too hard to understand and discourages users."

The reference is **FSVR** (musica.studio, GPL-3, source public): installed at
`C:\Program Files\musica.studio\FSVR`, source `github.com/musicastudio/FSVR`. Its editor is a
Hollow skin; the layout lives in `plugin/skin/views/main.json`, `topbar.json`, `opcol.json` and is
explained in `docs/editor.md`. Local evidence copies are in
`cache/scratch/fsvr/` (screenshot + `layout.json` of our own tree).

This programme is a **chassis** rework: structure, navigation, control language, density. No engine
work. Every existing feature keeps its ids and its home; nothing is removed.

---

## 1. Measured diagnosis (why the current layout discourages users)

Measured 2026-11-06 at the owner's own window class (1440x900) with `cache/scratch/anvil_layout.py`
(Playwright, file://, zero page errors):

| Fact | Anvil now | FSVR | Effect |
|---|---|---|---|
| Navigations | 2 (tab bar + 208px rail) | 1 (tab bar) | The rail is a second, competing map: **50 controls** (24 jump links, 24 float buttons, 8 chevrons, Panels, collapse) |
| Synth page depth | **3388 px of scroll in a 632 px well = 5.4 screens** | 1 screen (566 px well, pages sized to fit) | You cannot see a page whole, so you cannot learn it |
| Controls on the landing page | **146 visible** | ~24 on Parts, the busiest page | Wall of controls on first contact |
| Persistent editing context | none | operator column, on every page | You lose your place whenever you navigate |
| Page meaning | engine-part nouns (Synth/Mod/Studio/Store/Code) | task verbs (Browser, Parts, Effects, Options) | Tabs answer "what is this?" not "what am I doing?" |
| Control language | mixed (cards, one-off button styles, knobs, selects) | one (pots, faders, silver two-choice keys, steppers, title-tabbed groups) | Nothing teaches the next control |
| Global status | 16 small buttons; BPM + transport only | volume, LCD identity readout, meters, panic | No readout of what is loaded or edited |

Landing on a 5.4-screen page with 146 controls and two navigations is the whole problem. It is a
structure defect, not a paint defect.

## 2. What FSVR actually does (anatomy, from source)

Window 1514x952 at 1x. Three bands and a column, each one job:

- **Top bar** 1514x134 — five evenly gapped groups: Volume pot + value; the LCD (330x66 glass,
  25x3 dot cells: performance, part, voice, channel, POLY, CPU, edited mark); Save/Import;
  Editor/Keys toggles; part keys + a **TONE/KN pot-mode switch** with four pots; harmonic scope,
  stereo meters, PANIC, MIDI learn.
- **Folder tabs** 154x44 x8, `y=136`, spanning the content well only (`x=6..1238`), the selected tab
  cut into the well (`main.json`).
- **Content well** 1235x566 — one page, sized to fit; deep domains are **sub-tabs** (Operators holds
  seven) (`docs/editor.md` §The window).
- **Operator column** 255x600 at the right — selection keys (1..8, V/N), two dark screens (the
  selected operator's spectral form graph and its ADSR envelope, both with live curves), a copper
  pot row (Coarse, Fine, Detune, Level, Frequency, Skirt, Reson), an "Edit Operator n" button, then a
  two-column grid of deep-page launchers. Present on **every** page.
- **Keyboard** full width 1514x185, own well, Pitch and Mod vertical sliders at its far left.

Rules worth porting (`editor.md` §Rules): choices of two are radio pairs, never a two-item menu;
every number has steppers; every group carries a title tab on its box; exactly one lit colour;
hardware limits go, data-format limits stay.

**Page composition model** (from the Effects page): a dense page is a stack of titled group boxes,
each box = title tab + rows of pots with a value field under every pot, plus the odd dropdown for the
block's type. Four boxes, all visible, **no scrolling**.

## 3. Page map — every feature assigned, nothing dropped

Task-ordered like FSVR's Browser→Options. Everything below is an existing card unless marked NEW.

| # | Page | Contents | FSVR analogue |
|---|---|---|---|
| 1 | **BROWSE** | Store packs (`av-store`), Import & library (`av-import`), Sessions (`av-sessions`) | Browser + bank manager |
| 2 | **PERFORM** | Master levels & VU (`av-levels`), macro row (NEW: 4 pots + 4 assign slots), poly/glide/velocity, song scenes | Performance + Quick Control |
| 3 | **SOUND** | Sub-tabs: Engine (`av-synth`) · FM (`av-fm`) · Drums (`av-drums`) · Samples (`av-sample`) · Chop (`av-chop`) · Wavetable (`av-wt`) · Tuning (`av-tune`) | Parts + Operators sub-tabs |
| 4 | **SHAPE** | Mod matrix (`av-mod`), LFO (`av-lfo`) | Operators/Modulation |
| 5 | **SEQUENCE** | Sequencer, scenes, arranger (`av-seq`) | Fseq |
| 6 | **EFFECTS** | FX rack (`av-fx`) — insert chain, drag-reorderable | Effects |
| 7 | **MIX** | Sub-tabs: Mix & master (`av-mix`) · Takes & comp (`av-comp`) · Recorder (`av-rec`) · Studio (`av-studio`) | Live 12 / FL 2026 console |
| 8 | **DELIVER** | Deck (`av-deck`), Deliver/bounce (`av-deliver`) | — |
| 9 | **SYSTEM** | MIDI (`av-midi-card`), Project & share (`av-files`), CODE (`av-code`), Family (`av-family`), Roadmap (`av-roadmap`), a11y/help | Options |

Retired surfaces, with where their function goes:
- **The left rail** (`av_rail.js`) — its jump function is replaced by tabs + sub-tabs + the
  inspector's launcher grid. It survives as an optional thin icon rail (`NAV` toggles), default off
  on first run, so the 24-card map stays reachable for owners who learned it.
- **The floating-panel workspace** (`av_panels.js`) — kept, unchanged (it is an opt-in extra, and
  the owner's taste is "advanced behind opt-in"; the palette entry remains).
- `av_console.js`'s ad-hoc header injection — replaced by the band module below.

## 4. The chassis

```
+--------------------------------------------------------------------------+
| PLAY STOP SONG REC | Anvil VOLUME [LCD: pack·preset·engine·edited|BPM]    |  top band 96px
|  (transport, left) |  TONE/MACROS + 4 pots | view keys | scope meters    |
+---------------------------------------------+----------------------------+
| BROWSE PERFORM SOUND SHAPE SEQUENCE EFFECTS  |                            |  tabs 38px
+---------------------------------------------+  INSPECTOR (follows the     |  272px column
|             one page, one screen            |  selection: voice, channel, |
|                                             |  screens, launchers)        |
+---------------------------------------------+----------------------------+
| pitch/mod wheels | 61-key keyboard                               [popout]  |  dock 132px
+--------------------------------------------------------------------------+
```

Page order is **signal flow, left to right**: what you pick (BROWSE), what the performance does
(PERFORM), the voice (SOUND), what moves it (SHAPE), what plays it (SEQUENCE), what processes it
(EFFECTS), where it sums (MIX), what leaves the building (DELIVER), and the plumbing (SYSTEM).

### 4b. Studio-grade affordances (what professionals and studios expect, planned now)

These are page-and-band features, not paint. Each is assigned to a wave so the chassis is built to
receive them rather than retrofitted:

| Affordance | Where | Wave |
|---|---|---|
| Undo **history** (list, jump to state), not two buttons | SYSTEM + Ctrl-Z/Ctrl-Shift-Z | C1 shell, C5 fill |
| A/B compare (two mix states, one key) | MIX header, `A/B` pair | C4 |
| Solo / mute / arm per track, per channel strip | MIX | C3 |
| Snap, quantize, metronome + count-in levels, tempo tap | SEQUENCE + band BPM cluster | C3 |
| CPU, voices readout | band `out` group | C2 (done; latency/buffer has no LCD cell — see `_c2_wave.md` §5) |
| Autosave + last-saved indicator, session versions | BROWSE/sessions + band edited dot | already built (R20), surfaces here |
| Stems, master, MIDI, README export as separate targets | DELIVER | C3 |
| Selection model: single, shift-range, ctrl-toggle on the mixer | MIX, inspector follows | C3 |
| Per-track colour and name | MIX | C4 |
| Simple / advanced disclosure per page (advanced collapsed by default) | every page | C5 |
| Keyboard map, published and searchable | SYSTEM/help | C5 |
| Fixed control positions across pages (no reflow between tabs) | chassis law | C1 gate |

- The tab bar spans the content well only; the inspector column runs from the tab line to the well's
  floor (FSVR's `opcol` rect), the keyboard spans everything.
- The inspector is **persistent on every page** and is the selected voice: kind keys (acid,
  wavetable, FM, string, drum, granular, sampler), core pots (LEVEL, PAN, CUTOFF, RESO, ATTACK,
  RELEASE), **two dark screens** (an engine waveform/spectrum scope and the amp envelope drawn from
  the live ADSR, both editable by drag), an "EDIT VOICE" button, and a launcher grid
  (Osc/FM/Drums/Samples/Chop/WT/Tune/FX).
- Pot-mode switch: **TONE** = the inspector's four tone pots; **MACROS** = four performance macros.
  One switch, four pots, two jobs — FSVR's `knobs` var.
- Height budget: top 96 + tabs 38 + well (flex) + dock 132 at 950 px default. The well never
  scrolls the page; **no page may exceed ~1.2 screens** (a hard gate, see §7).

## 5. Control language (one, everywhere)

| Job | Control | Source |
|---|---|---|
| continuous | `.av-pot` (existing `av_knob.js`) — graphite cap, light pointer, ring | restyle of av_knob |
| continuous, wide | `.av-fader` — cap without pointer over a track | NEW |
| two-choice | `.av-pair` silver key pair, `role=radio` | NEW |
| number | `.av-num` value field, down-stepper left, up-stepper right | NEW |
| group | `.av-group` box + `.av-group-tab` title tab (45° sides) | NEW |
| lit | ONE accent: `--zone-accent`; text under a lit control, never through it | styles.css |

Every existing knob/slider/select gets classified into one of these in C4. Two-item `<select>`s
become pairs; every number gets steppers.

## 6. Waves

| Wave | Scope | Gate |
|---|---|---|
| **C1** chassis | head band module, inspector column module, tab bar re-render to 9 pages, body.html restructure, rail demoted to opt-in icon rail, keyboard wheels, band/tab/inspector CSS | `cdp_chassis` NEW rig; cockpit ZONEMAP re-pinned; smoke/fit green |
| **C2** inspector live — DONE, contract `verify/_c2_wave.md` | kind keys → engine kind, core pots → the live voice params, screens edit, scope, launcher grid → sub-tabs, the live wavetable frame on the oscillator screen, and POLY/MONO → `env.mono` with a real per-channel mono allocator (`stats().mono`) | `cdp_chassis` K16–K19 |
| **C3** page fills | sub-tab systems per page, card migration, macros card | per-page density check |
| **C4** control language | the class audit + conversion sweep; steppers, pairs, groups | overflow scan, `cdp_fit` |
| **C5** density & a11y | advanced sections collapsed by default per page, focus order, tab semantics | `cdp_a11y`, `cdp_fit` |
| **C6** polish & publish | shots, pins sweep, battery, installer, deploy, owner pass | full battery + install journey |

## 7. Gates

- **Density gate** (new, per page): rendered page height <= 1.2 x the well height at 1440x900 and at
  1280x800, measured by `cdp_chassis`; over-budget pages fail the wave.
- **One navigation**: a `cdp_chassis` leg asserts the rail is closed on a virgin profile and that
  every card is reachable from tabs + sub-tabs + inspector launchers with the rail closed.
- Existing battery stays green; `cdp_cockpit` ZONEMAP is the structural guard and is re-pinned per
  wave. `cdp_fit` (width sweep 1440-800) must stay green — the inspector column collapses to a
  56px strip under 1180 px.
- Owner drives the live surface before any wave closes (his standing rule); screenshots are evidence,
  never the verdict.

## 8. Risks

- **Rig churn**: 31 suites, cockpit pins the zone map, fit sweeps widths. Mitigation: card ids and
  zone *names* for the transport-critical suites stay; the zone rename is mapped once in C1.
- **Two writers on body.html**: parent owns body.html and build.py; children own their own new
  module + a CSS block. One writer per file, always.
- **`.av-btn` is a fixed 26x26 icon box** — every text button in the new bands needs `.mini` or a
  scoped wide override (R17b/R18a class).
- **Regressing the cockpit**: the old layout is one commit, so C1 is revertible whole.

## 5b. Visual inventory — every screen, where it lives, what it does

A "screen" is a dark inset panel that shows real engine data for the module it sits in; several are
editable (that is the difference between a picture and an instrument). Metric: screens belong to the
module they describe and to the inspector when they describe the selected voice — never decoration,
never a chart of nothing.

**Built (C1 / C1b):**
| Screen | Home | Reads | Edits |
|---|---|---|---|
| Oscillator shape | inspector | live `osc1.type` | — (C2: draw a wavetable frame) |
| Filter response + corner label | inspector | live `filter.cutoff` / `.reso` | drag: x cutoff, y resonance |
| Amp envelope + time | inspector | live `env1.a/d/s/r` | drag: x attack/decay/release, y sustain |
| Output scope | inspector | master tap analyser | — |
| LCD dot display | band | bank, engine, poly, voices, CPU, tempo | pack/preset steppers |

**Already existed (verified present, keep and restyle to the screen language in C4):** sample
waveform (`av_sample`), chop slice waveform (`av_chop_ui`), LFO scope (`av_lfo`), deck oscilloscope
/ spectrum / spectrogram (`av_deck_ui`), mix meters + LUFS/true-peak, comp take lanes, wavetable
editor canvas, sequencer grid, tuning scale map.

**Planned (C3, in this order):**
1. **Filters group** — the same response screen inside the SOUND engine card beside the cutoff/reso
   pots (the inspector one is the compact mirror; the card one is where you edit).
2. **Envelopes group** — envelope screens for every envelope the engine has (amp, filter, aux), overlaid
   in their operator colours; drag = the same three moves.
3. **EFFECTS, per slot** — drive: input/output transfer curve; dyn: gain-reduction meter; delay:
   tap timeline; verb/conv: decay tail; mod: LFO shape. Each slot gets the screen its block actually has.
4. **MIX** — EQ response curve on the master chain, and per-track mini waveform in the strip.
5. **SHAPE** — the matrix as a routing graph (source chips → destination knobs), replacing the row list
   view as the default and keeping the rows as the advanced view.
6. **SEQUENCE** — arrangement overview (song length, scene blocks, loop bracket) above the grid.

Rule: a screen never blocks a control, never carries chrome of its own beyond its inset, and always
prints its own units (the filter screen prints `LP 800 R30`, the envelope prints its time).
