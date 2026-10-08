# R3 wave — the workspace: float panels · zone accents · About in the header

Date 2026-10-08 (second owner request same day). Follows R1/R2 (`verify/_r1_wave.md`, `_r2_wave.md`).
Owner asks: (1) move the "Phase S5" notes card into the top bar to save screen space; (2) give each
zone/module a distinct colour when loaded; (3) let modules "pop out" into a free workspace — movable,
resizable, standard + custom layouts — following top-end workstation principles (FL-Studio-style
floating windows; workstation dockable panels).

## Deliverables (parent build, single writer)

1. `src/av_panels.js` (NEW) — float workspace: `avPanelOpen/Close/Toggle` (MOVE model; close
   restores the card to its home zone exactly), drag by the module head, resize grip, z-order on
   focus, persistence `av-float` {id:{x,y,w,h}}, restore at boot, layouts (reset / sounddesign /
   mixdown), the About popover (toggle + outside/Esc close), `__avPanels` facade.
2. `src/body.html` — the hero phase-notes card MOVES from the System zone into
   `#av-about-pop` (hidden host before the dock); content byte-preserved.
3. `src/styles.css` — zone accents (`body[data-av-zone=X] -> --zone-accent`; selected tab +
   card stripe + engine-chip hover use it), the About popover, float panel chrome (border accent,
   grip, drag cursor).
4. `src/av_chrome.js` — a `⧉` float button on every module head; the ABOUT header button.
5. `src/app_core.js` — `avPanelsInit()` in boot (after chrome); boot log + `PANELS SELFTEST`.
6. `build.py` — `av_panels.js` part after `av_chrome.js`.
7. `src/av_palette.js` — "Workspace" command group (reset / sound design / mixdown).
8. Rigs: `cdp_cockpit.mjs` — the hero check becomes the About-popover check; +3 float checks
   (open/move/resize/persist/restore, coexistence + z, reset + About toggle). `cdp_smoke.mjs` —
   +1 workspace check. Pins updated to the new sha; full battery; bench; deploy.

## Pins

- `#av-about-pop` (hidden at rest; contains the `h1` phase notes) · `#av-head-about` (aria-expanded)
- `.av-mod-float-btn` on every `.av-mod-head` (20) · `.av-float` wrapper `#av-float-<cardId>`
  `[data-card]` `[data-zone]` (style `--zone-accent` from the origin zone) · `.av-float-head-drag`
  · `.av-float-grip` · `.av-float-btn` (close)
- `window.__avPanels = {open, close, toggle, move, resize, reset, layout, list, about, version}`
- Zone accents: synth teal · fx orange · mod purple · seq green · studio sky · store yellow ·
  code lightened vermillion · system lightened blue (contrast mode unaffected).
- Persistence keys: `av-float`; zone accent is cosmetic (CSS only).

## Laws

- Default state = nothing floated: every existing suite runs unchanged; float flows are opt-in.
- MOVE model only (no clones): close() must restore the card to its exact home (parent + next
  sibling); the cockpit card-map check re-verifies the whole map after the float checks.
- The about popover never intercepts at rest (hidden); a11y: every new button aria-labelled
  (unnamed-count stays 0); reduced-motion unaffected.
- No `</script`; no non-ASCII anchors (inserts may carry intended glyphs).

## Gates

- smoke (39), cockpit (+3 float legs + about leg), then the full 23-suite battery on the frozen
  bytes; pins; bench; deploy + live verify → addendum 38.
