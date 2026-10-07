# P7 wave — accessibility pass (docs/07 #79) — contract

State at open (2026-10-08): HEAD `2c7ef92` · frozen `b34a28b6` (3,343,688 B, pins 18 files, battery 21
suites green) · worklet sha `d7f0ee41` (must stay UNCHANGED — P7 is page-side + one core edit). Scope per
docs/07 #79: keyboard-complete operation, screen-reader roles/labels, high-contrast + reduced-motion
variants, tested in the battery. Battery grows to **22 suites** (+`cdp_a11y`); pins grow to **19 files**.

## §1 Deliverables + ownership

| # | artifact | kind | owner |
|---|---|---|---|
| A1 | `src/av_a11y.js` | new — a11y core + prefs + decoration pass | sa-A |
| B1 | `src/av_knob.js` | EDIT (sole writer) — keyboard + aria (marker `avKnobKey`) | sa-B |
| C1 | `verify/cdp_a11y.mjs` | new rig (write-only, EXPECT_SHA null) | sa-C |
| P | build.py · src/app_core.js · verify/cdp_smoke.mjs · styles block · integration + pin scripts | parent | parent |

Children: never run the build, browsers, suites or git; `node --check` on own files only. Write each file
to disk COMPLETE first, then iterate.

## §2 Pins

### §2.1 `src/av_a11y.js` (sa-A)
Classic script, "use strict", node-loadable, never throws, no console output; ONE namespace `avA11y*` /
`AV_A11Y_*`. Debug handle `window.__avA11y = { version, init, state(), setPref(k, v), toggle(k) }`.

- **Prefs**: localStorage key `av-a11y` = JSON `{"contrast":false,"motion":"system"}` (motion:
  `"system"|"reduce"`). Tolerant read (any shape -> defaults); write on change (guarded).
- **Body classes**: `av-contrast` when contrast true; `av-reduce-motion` when `motion === "reduce"` OR
  (`motion === "system"` AND `matchMedia("(prefers-reduced-motion: reduce)").matches`). Keep a media
  listener while in system mode (guard `addEventListener` on the MediaQueryList).
- **UI** (built by the module): `#av-a11y-host` (class `av-a11y`) appended to `document.querySelector("header.av-head")`
  (fallback: parentElement of `#av-version`; skip silently when neither exists). Contains two real
  `<button>`s: `#av-a11y-contrast` and `#av-a11y-motion`, each with `title`, `aria-pressed` reflecting
  state ("true"/"false") at every change, `aria-label` when the visible label is an abbreviation.
- **Skip link**: `#av-a11y-skip` (class `av-a11y-skip`) PREPENDED to `document.body`; href `#av-main`;
  the module guarantees the main element (`main.av-main`) carries `id="av-main"` (set if missing).
  Visually hidden until focused (styles in the parent block).
- **Live region**: `#av-a11y-live` (`aria-live="polite"`, `aria-atomic="true"`, class `av-a11y-sr`),
  appended to body; `avA11yAnnounce(text)` writes textContent (string, capped 200). Also announce pref
  changes.
- **Decoration pass** (idempotent; pass 1 at init, pass 2 at +1200 ms, both guarded):
  - `.av-knob[data-knob]` without `tabindex` -> `tabindex="0"` (count `knobsTabbed`).
  - `canvas` inside `.av-card` without `role` -> `role="img"` + `aria-label` from nearby heading text or
    `"visual display"` (count `canvases`).
  - selectors `[".av-fam-status", "#av-deliver-status", ".av-session-status"]` -> `role="status"` when
    missing (count `liveRegions`).
  - `button, select, input, a[href]` inside `header, main, footer`: accessible name = trim(textContent) ||
    aria-label || title || alt of a contained img; when empty, set aria-label from placeholder || name ||
    id || "control" (count `labeled`); a REMAINING unnamed count is reported in `state().counts.unnamed`
    (must be 0 after the pass for buttons with any source — see rig C4).
  - `[role="button"]:not(button)` -> tabindex="0" when missing (count `roleButtons`) + ONE document
    keydown listener: Enter/Space on such an activeElement -> `.click()`.
- `state()` -> `{ version, inited, contrast, motion, systemReduced, reduceActive, skip: bool, live: bool,
  counts: { sliders, knobsTabbed, canvases, liveRegions, roleButtons, labeled, unnamed }, errors[] (cap 16) }`.
- `avA11yProof()` RETURNS one line `A11Y SELFTEST <json>` (never calls avTestLine itself — app_core appends).
- `avA11yClasses()` -> the class list for the styles block (>= `av-a11y`, `av-a11y-btn`, `av-a11y-skip`,
  `av-a11y-sr`, `av-contrast`, `av-reduce-motion`).
- Restore path: init re-applies persisted prefs; a `av-a11y` CustomEvent `{detail:{contrast,motion}}` on change.

### §2.2 `src/av_knob.js` edit (sa-B — sole writer; marker comment `avKnobKey` must appear)
READ the file first; change ONLY: (a) `tabindex="0"` on the knob element at build; (b) `aria-valuemin` /
`aria-valuemax` at build; (c) a sync helper setting `aria-valuenow = String(v)` called from the SAME commit
path every value change goes through (pointer, keyboard, programmatic — find the one funnel and call there);
(d) `aria-label` when missing (from the `[data-kval]` label text else the data-knob path); (e) keydown on
the knob: ArrowUp/ArrowRight +step, ArrowDown/ArrowLeft −step, Shift x10, Home = min, End = max,
preventDefault, commit through the existing funnel (never a second write path). Step = numeric `data-step`
else (max−min)/100. Pointer feel/classes/states must be untouched (the battery's knob_feel + smoke suites
are the witnesses).

### §2.3 `verify/cdp_a11y.mjs` (sa-C)
file:// rig (copy the launch block from `verify/cdp_m2.mjs`; NO http server, NO SW). Boot
`index.html?avtest=1`. Sections/checks (~30):
- A module: `__avA11y` live + `state()` counts: `sliders` === total `.av-knob[data-knob]`, `skip` true, `live` true.
- B skip link: `Input.dispatchKeyEvent` Tab from a fresh load -> activeElement is `#av-a11y-skip` (or the
  first focusable, printed); Enter -> activeElement id `av-main`.
- C knobs: every knob has `tabindex=0` + `role=slider` + numeric `aria-valuemin/max/valuenow`; keyboard
  witness on the master knob (`#av-levels .av-knob[data-knob="master"]`): focus it, read its value (via the
  knob's own observables — reuse the readback the knob_feel rig uses), ArrowUp -> value rose by ~step AND
  `aria-valuenow` matches; Shift+ArrowUp -> ~10x delta; End -> clamped to max; restore the start value
  afterwards (through the same path).
- D names: every VISIBLE `button` has a nonempty accessible name (text || aria-label || title); the
  module's `state().counts.unnamed` === 0 for buttons.
- E live regions: >= 3 elements with role=status or aria-live among the pinned selectors; `avA11yAnnounce("probe")`
  sets `#av-a11y-live` textContent.
- F contrast: click `#av-a11y-contrast` -> body has `av-contrast` + aria-pressed "true" + computed
  `--text` (from `getComputedStyle(document.documentElement).getPropertyValue('--text')`) differs from the
  normal-mode value; reload -> class RESTORED from prefs; then reset to default and assert clean.
- G motion: `Emulation.setEmulatedMedia` features `[{"name":"prefers-reduced-motion","value":"reduce"}]`
  -> sample every element under `main` with `computedStyle.transitionDuration !== "0s"` in normal mode;
  in reduce mode that count === 0 (or every duration parses <= 0.0001 s); also the manual toggle path
  (class + persisted). Reset emulation + prefs at the end.
- H zero page errors across every section + **prefs restored to defaults at the end** (file:// localStorage
  is shared with every other suite — the rig owns its state and cleans up).
Marker: `A11Y-RESULT n/m`. EXPECT_SHA null until the parent pins (pin leg compares the repo index.html sha).

### §2.4 Integration (parent)
build.py js_parts `src/av_a11y.js` before app_core; app_core `version "1.7.0"` + phase `"P7 · accessibility"`
+ `avA11yInit()` init + `avA11yProof()` appended in the avtest block; smoke: add checks — a11y module live on
file:// + skip link first-focusable + `counts.unnamed === 0` (keep the zero-error check last); styles block
from `avA11yClasses()` (contrast token overrides on `.av-contrast`, focus-visible rings, `.av-a11y-skip`
hidden-until-focused, `.av-a11y-sr`, and the WCAG snippet for `.av-reduce-motion *` + inside
`@media (prefers-reduced-motion: reduce)` -> `animation-duration:.01ms!important; animation-iteration-count:1!important;
transition-duration:.01ms!important; scroll-behavior:auto!important`). Pins: 18 -> 19 (all FULL-shas now —
replace the full literal, never a prefix). Battery 22. Gate: bench-v21 + stress x2 (knee must hold 128; the
worklet sha must stay `d7f0ee41`).

## §3 Watch-outs (pre-pinned from the platform wave)
- file:// zero-error contract: the a11y module must touch nothing that fetches; LS writes are try/catch'd.
- The skip link must not disturb the smoke LAYOUT check: it is `position:fixed/absolute` off-screen until
  `:focus` (never a normal-flow element at load).
- No new `.av-knob` controls anywhere (the s4 share-wire knob-diff law); the a11y toggles are real buttons.
- av_knob edit: exactly ONE commit funnel; if the funnel is a shared function, call the aria sync INSIDE it
  (no duplicated paths); never change pointer math/step feel.
- Rig: file:// localStorage is shared across ALL suites — the a11y rig must end with defaults restored
  (and note that in its log).
- ASCII-only anchor strings in every script; `node --check` the rig + module before landing.
- The battery rigs each also boot the app — a11y decorations must cost nothing noticeable (pure DOM attr
  writes; pass 2 is one setTimeout).

## §4 Report shape (children)
Files + absolute paths + line counts + node --check result; exported names as a plain list; harness/command
output for whatever was verifiable without a browser; an Undetermined list; one paragraph on `state()`.
