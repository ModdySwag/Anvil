# R1 wave — the COCKPIT: fixed-window chassis + workflow zones

Date 2026-10-08 · Owner directive: full GUI/workflow redesign following Xfer Serum 2's design and
workflow ("the scrolling is awful", module GUI / interactions must follow the tools sound engineers
know; "build until completion, no stops"). Rolling build: R1 chassis -> R2 module chrome + browser
overlay -> R3 polish + deploy. This contract covers R1.

## Why (the review, measured)

Live https://moddys.net/anvil/ at 1440px: `document.scrollingElement.scrollHeight` = **13043 px**
vs a 900 px viewport; ~28 `.av-card` sections stacked in one document scroll; every workflow is
reachable only by scrolling thousands of pixels; navigation model = none. Serum 2: a fixed instrument
window, one zone visible at a time, tabs at the top, everything reachable without page scroll.

## R1 deliverables (file ownership: parent only; no children in this wave)

1. `src/av_shell.js` (NEW) — zone model + tab behaviour + persistence + shortcuts + harness seams + proof.
2. `src/body.html` — static restructure: `nav#av-zones` (8 tabs) + 8 zone sections; every card block
   moved **byte-preserved** (ids/classes unchanged); hero + roadmap cards and the footer move into the
   system zone.
3. `src/styles.css` — the R1 cockpit block (page never scrolls; zone panes; tab bar; cockpit scrollbars)
   + the dock-tax rule edits (dock-tax becomes BODY padding).
4. `src/app_core.js` — shell init in the boot sequence; `avTestLine` targets `#av-proofs`; boot log +
   `?avtest=1` proof line.
5. `build.py` — `av_shell.js` added to `js_parts` (before `app_core.js`).
6. `src/av_palette.js` — `avPaletteCardGo` becomes zone-aware; new "Zones" command group.
7. `verify/cdp_cockpit.mjs` (NEW) — the R1 rig (EXPECT_SHA pinned).
8. `verify/cdp_smoke.mjs` — one cockpit check added (R1 surface).
9. Battery: all suites re-run; suite flows that reach hidden-zone elements are covered by the shell's
   own seams (`__avZoneAuto`, the `scrollIntoView` wrapper) — no check is loosened.

## Zone map (cards -> zones; every id unchanged)

| zone | cards |
|---|---|
| synth | av-firstrun (JS-inserted, before av-levels) · av-levels · av-synth · av-fm · av-drums · av-sample · av-chop · av-wt |
| fx | av-fx |
| mod | av-mod |
| seq | av-seq |
| studio | av-rec · av-studio · av-sessions · av-comp · av-mix · av-deck · av-deliver |
| store | av-store |
| code | av-code |
| system | hero/about card · av-midi-card · av-files · av-family · roadmap card · footer (av-foot) |

Tab order: synth · fx · mod · seq · studio · store · code · system (workflow order: sound -> fx ->
modulation -> pattern -> studio -> store -> code -> system).

## Interface pins

- DOM: `#av-zones` (nav, role=tablist) · `#av-tab-<zone>` (button, role=tab) · `#av-zone-<zone>`
  (section, role=tabpanel, `data-zone`) · `.av-zone-box` (the centered column inside each zone)
  · `#av-proofs` (hidden proof host).
- Facade: `window.__avZone = { show(id, opts), current(), list() }`; `window.__avZoneAuto(sel)` —
  reveals the zone (or store overlay ancestor) that holds `sel`; returns boolean, never throws.
- `avZoneShow(id, opts)`: toggles the `hidden` attribute on zones; `aria-selected` + roving
  `tabindex` on tabs; `body[data-av-zone]`; persists `localStorage["av-zone"]`; announces via
  `avA11yAnnounce` unless `opts.silent`; returns boolean; unknown id -> false.
- Boot default: `?z=<zone>` -> `localStorage av-zone` -> `synth`; invalid values fall back.
- Shortcuts: Alt+1..8 map to the tab order; palette group "Zones" (`zone.synth` ... `zone.system`).
- `scrollIntoView` seam: a prototype wrapper that reveals a hidden zone containing the target before
  delegating to the original — never breaks scrolling, guards with try/catch.
- Proof: `avShellProof()` -> `"SHELL SELFTEST {…}"` at `#av-shelltest` (`?avtest=1`).

## Laws

- The page NEVER scrolls: `html, body { overflow:hidden }`; `documentElement.scrollHeight ==
  clientHeight` (±2 px). Only `.av-zone` panes scroll, internally.
- Exactly one zone visible at a time; all others carry the `hidden` attribute.
- Every existing card id / class / suite selector stays intact — relocation only, no rewrites.
- Header, dock, overlays, popouts, palettes behave as before; dock-tax is now BODY padding with
  `box-sizing:border-box` (content area shrinks; the dock overlays the padded strip).
- Page-side only: the worklet concat, taps, engine — untouched (worklet sha must stay byte-identical).
- a11y: tablist/tab/tabpanel roles; ArrowLeft/ArrowRight move within the tablist; skip-link target
  unchanged; reduced-motion unaffected.

## Gates

- `node verify/cdp_cockpit.mjs` — new rig (~28 checks), pinned to the frozen sha.
- `cdp_smoke.mjs` — new cockpit check; all other suites byte-green on frozen bytes.
- Perf gate: bench knee + stress (page-side wave; worklet sha checked equal; expect 128 monotone).
- Deploy NOT part of R1 (R3 owns deploy + live verify). R1 ends: commits + continuation addendum.

## Watch-outs

- Suites use `scrollIntoView` + viewport-rect coordinate clicks: the seam covers hidden zones; a
  failure that persists means the seam did not fire for that call shape — fix the seam, not the check.
- Screenshot-clip math in suites (`rect + window.scrollX/Y`) stays valid: window scroll is always 0,
  so clip == viewport rect.
- `avTestLine` must target `#av-proofs` (hidden) — otherwise proof paragraphs become flex children of
  `.av-main` and squeeze the zone.
- The store card becomes a zone (an overlay comes in R2) — store suites reach it via the seam.

## Report shape

Battery table (suite -> pass/fail + counts), pin list, bench/stress numbers, build sha, continuation
addendum number, and any suite edits with their intent justification.
