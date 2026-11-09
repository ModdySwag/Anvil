# 16 — The Console programme: three hi-fi finishes, one professional layout

Status: CONCEPT COMPLETE (2026-11-10) · Owner: Moddy · Plan of record.

Brief: "change the GUI to a professional sound engineer / DAW / modern music application standard that
when installed instantly makes the user feel at home … unique but top level professional, kept within the
Windows standard … 3 designs in a switcher: 1 gold Marantz, 2 silver brushed Onkyo/Yamaha, 3 old wooden
70s amplifier / Moog synth."

Concept boards: `renders/concept-v2/console.html` (`?s=sound|mix|seq`, `?skin=gold|silver|wood`, or use the
finish switcher at the top). Navigation study (three modes + browser + inspector + piano-roll dock):
`renders/concept-v2/modes.html` (same finish switcher). Renders: `renders/concept-v2/final-<skin>-<screen>.png`
and `renders/concept-v2/modes-<skin>.png`.

---

## 1. Measured diagnosis of the current build (why this is a rebuild, not a repaint)

Measured on the bundled `index.html` at 1440x900, 2026-11-10:

| Fact | Value | Consequence |
|---|---|---|
| Native `<select>` elements | **71** | The single loudest "web form" tell. No DAW ships native dropdowns in its working surface. |
| Buttons | **652** | Control count is not the problem; uniform *weight* is. Everything looks equally important. |
| Card frames | 29 `.av-card` | Nested boxes instead of one panel + hairlines. |
| Chrome height | 96 px header + 84 px band + 40 px tabs | ~220 px of the 900 px window before any work happens. |
| Label size | 8–9.5 px mono uppercase | Below any legible floor; the panel reads as texture, not text. |
| Accent use | teal on values, headings, dots, rules, tabs, keys, borders, rings | Colour stops meaning "selected/active". |
| Knob | 270° always-on conic track + 5 px glow + pointer + value text-shadow | Four competing indicators on one 40 px circle. |
| Prose in the working surface | paragraphs on MIX, DECK, SEQUENCE ("Panel reads are UI witnesses only…") | Documentation rendered as UI. A DAW never explains itself inside the mixer. |
| Right inspector | same 6-knob synth panel on all nine zones | 286 px of 1440 (20%) repeating a panel that is not about the current task. |
| Direct manipulation | almost none — sliders and selects in forms | No drag-to-modulate, no waveform editing, no meters that read signal. |

The reference products studied (Marantz 2270, Onkyo TX-6500 mk2, Yamaha CA-series, Minimoog Model D) all
share one grammar the current build lacks: **a metal faceplate with engraved legends, a small number of
large illuminated displays, and every control physically distinct in size and type.** That is the grammar
this programme adopts.

## 2. The decision: the Console

**One chassis, three finishes, one control language.**

- **Chassis**: metal faceplate (title + transport + engraved zone strip) surrounding a **dark glass working
  area**, with the keyboard dock below and a status strip at the foot. This is the Marantz dial-glass
  idea applied to software: chrome is metal, work is glass.
- **Finishes** are theme tokens and materials, not layouts. Every screen keeps identical geometry:
  1. **Marantz gold** — champagne faceplate, black dial glass, cyan scope windows, fluted silver-gold knobs,
     walnut case. Accent: Marantz cyan `#2FB6C4`.
  2. **Onkyo silver** — brushed aluminium plate, black glass, amber indicator lamps, knurled aluminium knobs,
     thin wood cheeks. Accent: Onkyo amber `#C07A2E`.
  3. **Moog walnut** — near-black panel, cream legends, walnut cheeks and a brass pinstripe, black bakelite
     knobs with cream pointers, amber VU glow. Accent: `#E0A04A`.
- **Density**: 1440x900 default, 1280x800 minimum. Chrome shrinks from ~220 px to **142 px**
  (30 title + 74 transport + 38 zone strip), and the dock from 96 to 68 — a net **~66 px returned to the
  work area**, which is exactly what the K23 density gate at 1280 needs.

## 3. Layout map (all finishes)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ title bar 30   mark · preset · edited · CPU/latency · undo/redo · ⛶ ✕    │  metal
├──────────────────────────────────────────────────────────────────────────┤
│ transport 74   scopes │ transport keys │ dial scale + position │ macros │ │  glass
│                volume knob (52)                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ zone strip 38  Browse Perform Sound Shape Sequence Effects Mix Deliver System │ engraved metal
├──────────────────────────────────────────────────────────────────────────┤
│ work area      ┌───────────────────────────────┬──────────────────────┐  │  dark glass
│                │ centre surface (swaps)        │ context inspector    │  │
│                │                               │ 286 px, collapsible  │  │
│                └───────────────────────────────┴──────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────┤
│ keyboard dock 68   wheels · 61 keys (collapses to a 24 px strip)          │  metal + felt
├──────────────────────────────────────────────────────────────────────────┤
│ status 23    rate/buffer/latency · one-line hint · MIDI · version         │  metal
└──────────────────────────────────────────────────────────────────────────┘
```

Rules that come from the DAW study (verified against Ableton 12, Bitwig 5, Logic 11, REAPER 7, FL 21):

1. **Transport never scrolls away and is never mode-specific.** One row, always the same controls in the
   same order: transport keys · position · tempo/signature · key/scale · master meter · voices/CPU.
2. **Navigation is a mode model, not a page bar** — see §3.1. Nine equal tabs is the single strongest
   "this is a website" signal in the current build.
3. **Only the centre swaps.** Inspector contents follow selection; the dock persists; nothing else moves.
4. **The page never scrolls.** `overflow:hidden` on the shell; panes scroll internally, with shadow hints.
5. **Empty states are affordances**, not paragraphs: one action line + a button, prose goes to tooltips/help.
6. **No native form controls** in the working surface: `.av-pair`, popover lists, steppers and knobs replace
   all 71 `<select>`s. (The repo already has `av_pair.js` and `av_num.js` — extend, don't reinvent.)

## 3.1 Navigation model: nine tabs → three modes + panels

The DAW study is unambiguous: **no shipping DAW in the surveyed set navigates by nine co-equal top-level
tabs.** Ableton and Bitwig use two primary modes, Studio One two pages, Cubase and Logic one window with
hideable areas, FL zero (floating windows). Nine destinations is 4.5× the maximum — and it is a
structural problem, not a styling one: a tab bar says "these are pages and you are on one"; a DAW says
"this is an instrument and these are its panels".

Recommended demotion, each with a shipping precedent:

| Today | Becomes | Precedent |
|---|---|---|
| SOUND, SEQUENCE, MIX | the **three modes** (centre surface swaps; everything else persists) | Ableton Session/Arrangement, Bitwig Arranger/Launcher, Studio One Song/Project |
| BROWSE | **left browser panel**, toggle `B`, stays open while you work | Ableton browser, Studio One Browser, FL Alt+F8 |
| PERFORM | **launcher toggle inside SEQUENCE** | Bitwig treats the Launcher as a panel beside the Arranger |
| EFFECTS | **device chain in the inspector** plus a device tab in SOUND | Logic/Cubase object-scoped inspector tabs |
| DELIVER | **modal export sheet** (no DAW gives export a permanent nav slot) | every DAW's bounce/export dialog |
| SYSTEM | **Settings window** on Ctrl+, | Ableton Settings, Bitwig Dashboard |

Result: 3 modes + 3 object tabs (Device / Track / Clip), and a chrome budget of **112 px (12.4% of 900)**:
32 title + 56 transport + 24 status — within half a point of Logic's measured 110/871 = 12.6%, the only
primary-source full-window measurement in the study. Keep the browser at 260 px (200–420) and the
inspector at 320 px (280–480), both resizable, both remembered per project; the detail editor is a bottom
dock (220 px, resizable) rather than a mode.

Object-scoped tabs inside the inspector are fine and standard; **app-scoped** tabs are what reads as web
navigation. If PERFORM must stay a peer workflow (live performance as a first-class claim), it can be a
fourth mode — but three is the proven ceiling, and the decision should be explicit, not accidental.

## 3.2 Sequencer and display specifications (built into the concept)

- The step grid is **16 steps per bar x 4 bars = 64 cells**, so the "16 steps / 1 bar" label is true. Every
  cell is one 1/16 note; bar lines every 16, beat lines every 4. Ruler starts measured within 0.7 px of the
  grid bar starts (230 / 523.8 / 818.5 / 1113.3 vs 230 / 524.5 / 819 / 1113.5).
- Pads encode **velocity as height** (5-16 px) and take the **track colour**; the selected step carries a
  1 px accent ring and the readout names it honestly (bar.beat.sixteenth).
- The **velocity lane shares the step grid's column geometry** - measured drift 0.0 px between a step cell
  centre and its velocity bar - and the playhead spans both the grid and the lane.
- The **wavetable display** draws 5 frames with the current frame bold, glowing and filled; the **filter**
  is a real 24 dB/oct response with a resonance bump, filled area and a log axis labelled 20/100/1k/10k/20k;
  the **LFO** is one readable cycle, not four squashed rows.

## 4. Control language (the part that makes it feel engineered)

One grammar, four control types, no exceptions:

| Control | Geometry | Behaviour |
|---|---|---|
| **Pot** | 22 / 26 / 32 / 40 / 44 / 52 px tiers (relief ratio ≥ 1.5:1 between tiers) | vertical drag, 0.5% per px coarse, Shift 0.05%; wheel 1 step; double-click and Ctrl-click reset; Alt-click links pairs; pointer + engraved tick ring (no glow) |
| **Fader** | 5 px groove, 24x11 cap, 24–28 px grab, printed dB scale | 0.5 dB/px, Shift 0.05 dB/px, magnetic unity ±0.05 dB, double-click 0.0, Alt-click −∞ |
| **Key** | metal cap 18–30 px, dark legend, 1 px shadow | momentary/on states; on = accent fill with dark legend |
| **Chip / tab** | 20–24 px, engraved or glass | one selected state, 2 px accent underline, no pills except status |

Hard rules:
- **Labels above, values below, never both glowing.** Value text is neutral ink; accent is reserved for state.
- **One hairline per boundary** at 8–14% white on glass, 26–30% dark on metal.
- **Module header = 26–28 px**: LED · NAME (uppercase, 10 px, 0.16em) · descriptor · right-side keys.
- **Accent budget**: ≤ 3 accent elements per screen region (selected tab, active key, live meter/signal).
- **Modulation** is a second, thinner ring outside the tick ring with a base dot — never a recolour of the
  value ring. The existing Okabe-Ito mod palette is kept for sources only.
- **Every changing number is tabular** (`font-variant-numeric: tabular-nums`), right-aligned, min 5ch.
- **No pure white text, no pure black panel.** Ink alphas 0.92 / 0.66 / 0.45 over the panel.

## 5. Type and icons

Type (decision): **Inter var** (400/500/600) for UI, **IBM Plex Mono** (400/500) for IDs/hex/values that
must align; **Segoe UI Variable** stays a fallback for Windows, not the primary face (it cannot be
redistributed and reads as a Windows utility, not an instrument). Both chosen faces are SIL OFL 1.1 and ship
in the installer with their licence text.

Ramp at 1440x900 (CSS px):

| Role | Size / weight / line | Use |
|---|---|---|
| Display | 22 / 600 / 28 | big readouts (position, LUFS) |
| Title | 17 / 600 / 22 | zone title |
| Subtitle | 14 / 550 / 19 | module group heading |
| Body | 13 / 450 / 18 | prose-limited help, empty states |
| Body strong | 13 / 600 / 18 | emphasised values |
| Small | 12 / 450 / 16 | secondary descriptions |
| Value | 13 / 500 / 16 tnum | parameter readouts |
| Value small | 11 / 500 / 14 tnum | strip values |
| Micro | 10 / 600 / 12 +0.09em uppercase | labels, legends |
| Mono | 12 | patch IDs, paths, hex |

Floors: 12 px sentence case (single line only), 10 px only for uppercase micro, 11 px sentence case banned.
Do **not** force `-webkit-font-smoothing: antialiased` on Windows dark panels.

Icons: one 24-unit master, three optical masters (16 / 20 / 24), **stroke re-set per size** (1.5 / 1.5 /
1.75), corner radius = 1.25 × stroke, round caps and joins, 0.5 overshoot on circles, solid only for
play/pause/stop/record. Hit boxes 28 / 32 / 36 px. Full symbol table in
`C:\Users\Moddy\AppData\Local\hermes\profiles\deepseek\cache\scratch\anvil-out.json` (icon + type digest).

## 6. Audio ergonomics (non-negotiable for "instantly at home")

- **Meter scale** −60 … 0 dBFS, floor −60 (offer −72), colour zones with labelled dB thresholds, peak-hold
  line, clip latch that only clears on click; true-peak oversampled 4× and LUFS integrated/true-peak in the
  master section.
- **Ballistics**: digital peak + a 10 ms PPM-style integration option; VU (300 ms) only as a cosmetic skin
  option in the walnut finish.
- **Strip order**: name/colour → input+trim → inserts → sends → pan → mute/solo/arm → fader+meter → output.
  This is the order every console uses; do not reorder for prettiness.
- **Formatting**: one decimal more than the step, max 4 significant digits; Hz integer below 1 kHz, kHz with
  two decimals above; ms with two decimals below 10 ms, integer to 999 ms, s with two above 1 s.
- **Transport**: Space play/stop, stop twice returns to zero, R record, L loop, metronome key, and the
  computer keyboard plays notes when the dock has focus.

## 7. Windows integration (from the Fluent/Electron study)

- Custom title bar: **32 px**, `titleBarStyle: hidden` + `titleBarOverlay` colours matched to the finish;
  native caption buttons, never hand-drawn ⛶ ✕ (the concept draws them only because it is a mock).
- **Mica via Electron `backgroundMaterial`** for the base window; acrylic only for transient surfaces;
  Windows 10 fallback: solid `backgroundColor`, square corners, same 32 px bar.
- Respect the user's **accent colour** only where the finish allows it (window chrome, focus rings). The
  instrument keeps its own identity colour — that is exactly what a hardware faceplate does.
- Focus visual: **2 px stroke, 1 px offset**; full keyboard navigation; High Contrast must substitute system
  colours and never rely on the metal textures.
- DPI: per-monitor aware, test 125% and 150%; canvas-backed displays must size to `clientWidth × dpr`.

## 8. Finishes — material tokens

| Token | Marantz gold | Onkyo silver | Moog walnut |
|---|---|---|---|
| faceplate | `#E6D6B2 → #C0A670` | `#ECEDED → #C2C4BD` | `#241F1A → #141110` |
| texture | gold brushed, 17% | silver brushed, 17% | black anodised, soft-light 55% |
| case | walnut, 11 px | walnut cheeks, 9 px | walnut, 26 px + brass pinstripe |
| glass | `#0D1112 → #070A0A` | same | `#12100E → #0A0908` |
| ink on metal | `#2E2616` | `#1B2124` | `#F0E6D2` |
| ink on glass | `#E9EEEF / #A9B4B8 / #75828A` | same | `#F0E6D2 / #BCAE95 / #877A63` |
| accent | `#2FB6C4` (cyan) | `#C07A2E` (amber) | `#E0A04A` (amber) |
| knob | fluted champagne-silver, dark pointer | knurled aluminium, black pointer | black bakelite, cream pointer |
| keys | metal caps, dark legends | metal caps, dark legends | dark caps, cream legends |
| meters | cyan scope + LED bars | amber LEDs + LED bars | cream VU + amber |

Generated materials (Higgsfield, `gpt_image_2_6`, 6 textures): `renders/concept-v2/assets/`
`gold-a.png` (champagne faceplate), `gold-b.png` (amber alternative), `silver.png`, `walnut.png`,
`black.png`, `cream.png`. These are concept assets; production should re-derive tileable, colour-normalised
versions at 1024 px and keep them under ~150 KB each.

## 9. Build plan (phased, gated)

The repo already has 23 rigs and a fast lane; each phase must keep the fast lane green and add a rig for the
new surface.

**P0 — tokens and chassis (no new features)**  
Replace `:root` with the two-layer token set (metal + glass), add the type ramp, icon sprite, and rebuild the
three bands. Delete the fake menu strip. Convert the dock to 68 px.  
Gate: chassis rig, a11y 37, K23 measured at 1280 **before/after** (target: no page worse than today).

**P1 — control language**  
Replace all 71 native selects with `.av-pair` / popover / stepper; unify knobs to the six tiers; unify keys;
delete the conic value ring and glows; add tick rings and hover value popovers.  
Gate: control-language rig (new), a11y keyboard walk per zone, K23 unchanged.

**P2 — the four working surfaces**  
SOUND: oscillator cards (scope + pot row), filter with a large response curve, amp/mod env, routing matrix.
MIX: console strips in the standard order with faders + dB scale + meters; master section with LUFS/true peak.
SEQUENCE: grid with bar shading, velocity lane, step inspector; no prose.
EFFECTS: a real serial chain with a vertical signal rail, not stacked cards.  
Gate: one rig per surface + owner eye gate.

**P3 — finishes**  
Move the three token sets into `themes/` and a finish switcher persisted in the patch; export/import the
finish with the project; the installer remembers it.  
Gate: all 23 rigs run on each finish (token swap must not move geometry); screenshots per finish.

**P4 — craft pass**  
Meter ballistics, peak-hold, keyboard feel, drag-to-modulate, tooltips, focus rings, High Contrast pass,
150% DPI pass.  
Gate: full wave battery + desktop rig + owner eye gate on every screen.

## 10. Decisions taken (not open)

- Three finishes share one layout; geometry never changes with the skin.
- Navigation follows the DAW study: three modes (Sound / Sequence / Mix) plus a left browser panel, a
  selection-driven inspector and a bottom dock; the other six zones are demoted by kind (see §3.1).
- Chrome is metal, work is glass — this is the core visual rule.
- Accent is state, not surface.
- Prose leaves the working surface entirely.
- Knobs get tick rings and no glow; values are neutral text.
- Inter var + IBM Plex Mono ship with the app; Segoe is fallback only.
- Chrome height shrinks (194→142 px) so the density gate gains headroom rather than losing it.

## 11. Open for the owner — ANSWERED 2026-11-10

Decisions taken (owner, 2026-11-10):

1. **Finish/order:** gold Marantz leads; switcher order gold → silver → walnut.
2. **Gold scopes:** keep the cyan scope windows (Marantz signature).
3. **Walnut:** brass pinstripe along the case join.
4. **Inspector:** collapsible on every screen.
5. **Navigation:** adopt the three-mode model (§3.1) — Sound / Sequence / Mix + browser panel +
   inspector + dock; the six other zones are demoted panels.
6. **Floor:** 1280×800 is the supported minimum.
7. **Fonts:** bundle Inter var + IBM Plex Mono (done in P0: 90 KB of base64 woff2, OFL).

P0 landed the chassis that carries these calls: chrome 296 → 233 px, K23 at 1280 worst 1.19 → 1.10.
Remaining for P1: the control language (71 native selects), then P2 surfaces, P3 the finish switcher.

## 12. Options needing verification

- Real-world legibility of 10 px micro-labels on a 1440 laptop panel at 125% (needs an on-device eye check).
- Whether the gold faceplate texture survives JPEG re-compression without banding at 1024 px.
- Mica under Electron on this machine (the study says `backgroundMaterial` works on Win 11 22H2+; needs a
  10-minute probe on the packaged app).
- Whether the existing `av_pair.js` / `av_num.js` can absorb all 71 selects without new ids (audit before P1).
