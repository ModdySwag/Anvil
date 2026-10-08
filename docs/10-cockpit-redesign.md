# 10 — The cockpit redesign: a Serum-2-faithful workflow (complete plan + build status)

Date 2026-10-08 · Trigger: a professional sound engineer reviewed the live build (moddys.net/anvil) and
reported: the layout, GUI and module GUIs need refinement for a user-friendly workflow; "the scrolling"
is awful; the interaction model is not designed like the tools sound engineers use; Xfer **Serum 2** is
the right template to follow, design and workflow — matching what today's production/mastering landscape
expects. Owner directive: develop the complete plan AND build it to completion, rolling, no stops.

This document is the plan of record. Status markers: ✅ landed · 🚧 in build · ⏳ queued.

---

## 1. The measured receipt (why)

Live build at 1440px, measured 2026-10-08 before the redesign:

- `document.scrollingElement.scrollHeight` = **13,043 px** (≈14 viewports at 900px); ~28 `.av-card`
  sections stacked in ONE document scroll; every workflow reachable only by scrolling thousands of px.
- No navigation model: no tabs, no zones, no persistent context — the engineer's "not designed with
  common programs of this type" is exactly this.
- Serum 2's model (the target): a **fixed instrument window**; one working zone visible at a time,
  switched by tabs; scrolling exists only INSIDE panes that need it (matrix rows, browser list, FX
  chain) — the page itself never scrolls.

## 2. Evidence base (ingested and correlated)

1. **Official Serum 2 web manual** (33 pages, https://xferrecords.com/web-manual/serum-2/welcome) —
   digested at `research/external/serum2/01-serum2-manual-digest.md` (conventions library: tooltips,
   knobs and sliders, undo scope, keyboard, module enable/copy/init/lock, routing, pitch tracking,
   resizing, saving/embedding, drag-out to DAW).
2. **"Complete Guide To Master Serum 2" video series** (14 episodes, playlist
   PLrqs7vRFQ4rbSe8YKFkO1z7KK4jgG-H3b; EP1 wavetable → EP12 global, incl. the matrix "pro section"
   and the FX deep dive) + the EDMProd Serum 2 guide (interface / oscillator / mix / FX / matrix /
   global / clips-arp walkthrough) — digested at `research/external/serum2/02-videos-and-guide-digest.md`
   with reference frames + contact sheets under `research/external/serum2/frames/`.
3. **The actual Serum 2 skin on this machine** (`Documents\Xfer\Serum 2 Presets\Skins\Default\`,
   342 assets: 192 control + 84 panel + 66 overlay) — the real component inventory: panel_header,
   panel_osc_headers (OSC A/B/C tab strip), panel_osc_wavetable (display + WT POS/UNISON/DETUNE/
   BLEND/PAN / WARP / LEVEL), panel_mod_tabs (ENV/LFO source tabs), panel_macros (2×4 = 8 macro knobs),
   panel_matrix (SOURCE | CRV | AMOUNT | POL | DESTINATION | OUT | AUX SOURCE | INV | CRV | OUTPUT),
   panel_browser (categories column | search + list | PRESET NAME/AUTHOR/CATEGORY/DESCRIPTION/NOTES/TAGS),
   panel_fx (+FX rail, vertical module chain, splitters), panel_global (VOICE CONTROL / QUALITY /
   TUNING / build), panel_keyboard (wheels | CLIP/ARP | TRANSPOSE/KEY/SCALE/SWING | keys | PORTA/CURVE),
   overlay_mod_drag / overlay_mod_assigns (modulation drag visuals), overlay_*_shadow_top/bottom
   (internal scroll shadows), overlay_vu_* (meter overlays). Reference-only: nothing from these assets
   ships; every convention is re-implemented as own work.
4. **The current Anvil UI audit** — `research/external/serum2/03-anvil-current-ui-audit.md`
   (shell structure, card inventory, scroll surfaces, interaction inventory, divergences vs the
   `docs/02` seven-screen intent).
5. Owner review artifacts: live screenshots + the scroll measurement above (kept in the wave logs).

## 3. Design goals (Serum 2 grammar ⇄ Anvil)

| Serum 2 convention | Anvil cockpit equivalent | wave |
|---|---|---|
| Fixed window, never scrolls the page | `html,body{overflow:hidden}`; body is the chassis | ✅ R1 |
| Top tabs switch the working zone (Osc/FX/Matrix/Global/Clips…) | `nav#av-zones` — Synth · FX · Mod · Seq · Studio · Store · Code · System | ✅ R1 |
| One zone visible; the pane scrolls internally with shadow hints | `.av-zone` scroll panes (slim cockpit scrollbar; sticky scrims in R3) | ✅ R1 (scrims ⏳) |
| Persistent header (preset · undo/redo · A/B · CPU · master) | header stays; preset-name chip + undo/redo buttons + browser button (R2) | 🚧 R2 |
| Module headers: power + menu (Init/Copy/Lock) + collapse | unified module chrome on every card (R2) | 🚧 R2 |
| OSC A/B/C tab strip inside the oscillator zone | engine strip inside Synth (VA/WT · FM · DRUMS · SAMPLE · CHOP · WT-EDITOR) | 🚧 R2 |
| Mod sources tab strip (ENV/LFO/…) + drag-to-modulate | Mod zone: source chips + drag onto any knob (with ring feedback); matrix rows | 🚧 R2 |
| Browser = full-window overlay (search + categories + info panes) | Store becomes a browser overlay (BROWSE button + palette; card internals reused) | 🚧 R2 |
| FX: +FX rail, module rows, bypass, splitters | FX zone: row list with power/menu per module; "+FX" affordance enabling the next slot | 🚧 R2 |
| 8 macros panel | 8 macros strip (from the mod matrix) in the Mod zone / pin to Synth | 🚧 R2 |
| Keyboard strip persistent at the bottom (wheels · clip/arp · porta) | the 61-key dock already persists; stays visible across zones | ✅ (already) |
| Undo/redo everywhere | undo engine exists; header buttons + zone-aware palette | 🚧 R2 |
| Tooltips everywhere; help on demand | tooltip + help layers exist; copy updated for zones | ⏳ R3 |
| UI resizing / persistence / deep links | zone persistence (`av-zone` LS) + `?z=` deep links | ✅ R1 |

## 4. R1 — the cockpit chassis (✅ landed)

**Deliverables:** `src/av_shell.js` (zone model, tabs, Alt+1..8, persistence, `?z=` deep link, the
`__avZoneAuto` + `scrollIntoView` reveal seams, SHELL SELFTEST proof); `src/body.html` restructured —
`nav#av-zones` + 8 zone sections, every card block moved byte-preserved into its zone (hero/about +
footer into System); `src/styles.css` cockpit block (never-scrolling chassis, zone panes, tab bar,
cockpit scrollbars; dock-tax now pads the body); `app_core.js` boot wiring + proof host `#av-proofs`;
`build.py` part registration; `av_palette.js` zone-aware "Open card" + a "Zones" command group;
`verify/cdp_cockpit.mjs` new rig (18 checks); `cdp_smoke.mjs` +2 cockpit checks (35 total).

**Zone map (pinned in `verify/_r1_wave.md`):** Synth (levels · synth · FM · drums · samples · chop ·
wavetable editor) · FX · Mod · Seq · Studio (recorder · studio · sessions · comp · mix · deck ·
deliver) · Store · Code · System (about · MIDI · project & share · family · roadmap · footer).

**Why this answers the review:** the page cannot scroll at the document level any more (witnessed:
scrollHeight == clientHeight, `scrollTo` is a no-op); exactly one zone is visible at a time; moving
between workflows is a tab click, Alt+digit, or palette command away — the Serum 2 navigation grammar.

## 5. R2 — module chrome + interactions (🚧 in build)

1. **Module header on every card**: `[▸] Name · status LED · ⋯menu` — menu actions where safe:
   *Collapse*, *Init* (knob defaults via the av_knob commit funnel), *Randomize* (range-clamped,
   undoable), *Copy/Paste settings* (via the existing avParams store). Mirrors Serum's module menu.
2. **Engine strip in Synth**: VA/WT · FM · DRUMS · SAMPLES · CHOP · WT EDITOR chips that jump the
   zone to the engine's card (keeping the existing ENGINE select as the source of truth).
3. **FX as a Serum-style rack list**: per-module rows (power · name · key controls · bypass), +FX
   affordance; keep every id/class the suites and pack demos use.
4. **Mod drag-to-modulate**: drag a source chip (LFO/ENV/MACRO/…) onto any knob; the existing mod
   matrix gains hover rings; matrix table restyled to the Serum column grammar
   (SOURCE · CURVE · AMOUNT · POL · DESTINATION · OUT).
5. **Store as a browser overlay**: full-window panel (search-first, facets left, list centre, details
   right) opened from the header, palette, and the first-run flow; internals = the existing store card.
6. **Header**: preset-name chip (current bank patch) + prev/next + BROWSE button + undo/redo buttons.

## 6. R3 — polish + deploy (⏳)

Scroll-shadow scrims on panes; zone-aware help/shortcut map + tour + lesson copy; a11y pass re-run
(contrast/reduced-motion unchanged); README/docs updates; delete the dead hero wall-of-text copy from
the about card (keep a short "About this build"); perf gate (bench + stress) and full battery on the
frozen bytes; **deploy to https://moddys.net/anvil/** (index.html + sw.js + manifest + icons +
inbox.html + packs/), live verify (bytes, SW version, offline boot) + screenshots for the owner pass.

## 7. Laws carried into the redesign

- Every existing card id/class stays (suites, share links, .anvl projects, bank presets must not move).
- Page-side only: the worklet concat and engine stay byte-identical; worklet sha unchanged per wave.
- Nothing copied: conventions re-implemented as own work; the local Serum 2 assets are private
  reference material (see `research/external/REFERENCE-RIG.md` licence law).
- Battery-gated: no wave ships without the full suite set on frozen bytes; pins move to the new sha.

## 8. Options needing verification (before/at R3)

1. Scroll-shadow scrim rendering over canvases (blend + perf) — probe first.
2. Module-menu Randomize ranges per module (safe-clamp audit per card).
3. Store overlay vs zone semantics for suites/interop (overlay chosen; seam updated).
4. Small-viewport behaviour (<900px tall): dock + zones + tab bar math — visual pass at 1366×768.

## 9. Results (R1+R2 landed 2026-10-08)

- **Frozen `1ddf7e54` (3,406,861 B)** — the page-scroll receipt: pre-redesign 13,043 px document
  scroll at 1440; post: `documentElement.scrollHeight == clientHeight` (900/900), `scrollTo` a
  witnessed no-op, exactly one zone rendered at a time (cockpit rig checks).
- **Battery ALL GREEN — 23 suites:** smoke 38 · cockpit 18 (new rig, pinned) · studio 37 ·
  sessions 41 · comp 41 · mix 46 · knob_feel 18 · keys 27 · midi 33 · sample 29 · rec 29 · fx 27 ·
  seq 31 · store 28 · bounce 32 · deck 35 · s4 37 · s5 36 · code 36 · m1 33 · m2 40 · platform 52 ·
  a11y 32. Suite flows reach hidden-zone elements through the shipped reveal seams (no check
  loosened; deck + m2 rig SPEC fixes documented in the addendum and in-file).
- Worklet sha `d7f0ee41` UNCHANGED (page-side wave); perf gate + deploy in the continuation's
  addendum 37.
- The full evidence correlation (manual conventions, video workflow lessons, skin inventory,
  current-UI audit) is the reference material behind this plan; the individual digests are the
  appendices of record under `research/external/serum2/`.
