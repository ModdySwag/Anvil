# C1 wave — the chassis (bands · inspector · tabs · control language)

Plan of record: `docs/13-chassis-fsvr.md`. Read §2, §3, §4, §5 before authoring.

State at open: 31 suites, 27 pin files, battery green on the previous close. `body.html` has 8 zones
(synth·fx·mod·seq·studio·store·code·system), 24 chrome cards, a left rail (`av_rail.js`) and a
console injected into `header.av-head` by `av_console.js`. Landing page = 3388 px of scroll in a
632 px well, 146 controls, 50 rail controls. This wave replaces the chassis; it does **not** touch
the engine, the DSP, or a single card's internals.

## 1. File ownership (one writer per file, always)

| Owner | File | Action |
|---|---|---|
| **parent** | `src/body.html` | restructure: 9 zones, sub-tab shells, card moves; head markup |
| **parent** | `src/av_shell.js`, `src/av_rail.js`, `src/av_chrome.js`, `src/av_panels.js` | zone list, rail demotion, first-run host, default zone |
| **parent** | `src/styles.css` | paste the child CSS fragment at integration; band/tab/inspector tokens |
| **parent** | `build.py`, `verify/cdp_cockpit.mjs`, `verify/cdp_hub.mjs`, `verify/cdp_smoke.mjs`, `verify/cdp_fit.mjs` | new parts, zone renames |
| child **H** | `src/av_console.js` | rebuild the DOM build into the band (keeps `avConsoleInit`, `__avConsole`, the transport/VU/preset logic) |
| child **I** | `src/av_inspector.js` (NEW) | the right inspector column module |
| child **S** | `cache/c1/chassis.css` (NEW, fragment) | all chassis CSS: bands, tabs, sub-tabs, inspector, pot/fader/pair/num/group |

Children may `node --check` only their own file. No child runs the build, a browser, a suite or git.
No child touches another owner's file.

## 2. The DOM contract (pinned; ids are the rig surface)

### 2.1 Header band — `header.av-head`, child H (rebuild `avConsoleBuild` in `src/av_console.js`)

The parent reduces the `body.html` header to `<header class="av-head" id="av-head"></header>`; child H
builds the whole band from JS, exactly as the console injects today. Everything H emits goes inside
`#av-band` is the band container. Five groups `.av-band-grp` with `data-grp` =
`transport|identity|pots|view|out`, in that left-to-right order (transport in the far-left thumb zone,
console convention).

- transport: `#avc-play` `#avc-stop` `#avc-song` `#avc-rec` `#avc-preset-prev` `#avc-preset-next`
  in a `.av-band-transport` cluster; PLAY and STOP large, the rest `.mini`.
- identity: `.av-word` "Anvil", `#av-version`, `#av-tier`, `#av-voices`; `#av-vol-pot` (pot mount,
  master-volume path) +  `#av-vol-val`; then `#av-lcd` (glass). Three rows `.av-lcd-row`: `#av-lcd-pack`, `#av-lcd-preset`,
  `#av-lcd-engine`; plus `#av-lcd-edited` (dot) and `#av-lcd-poly` (right-aligned readout).
- pots: `#av-potmode` with `#av-potmode-tone` / `#av-potmode-macros` (`role=radio`, one selected);
  four pot mounts `#av-pot-a` `#av-pot-b` `#av-pot-c` `#av-pot-d`, each inside a `.av-band-pot` with a
  `.av-band-pot-label`; a `.av-band-num` value line under each (child H owns the reads).
  TONE labels: ATTACK · RELEASE · CUTOFF · RESO. MACRO labels: MAC 1..4.
- view: `#av-head-browse`, `#av-head-undo`, `#av-head-redo`, `#av-head-about`, `#av-head-rail`,
  `#av-help`, `#av-a11y-contrast`, `#av-a11y-motion` (all existing ids, `.av-btn.mini`).
- out: `#av-scope` (canvas), `#av-meter-l` + `#av-meter-r` (existing `.avc-vu` bars, ids kept),
  `#av-panic`, `#av-learn`.

Kept control ids, unchanged behaviour: `avc-play` `avc-stop` `avc-song` `avc-rec`
`avc-preset-prev` `avc-preset-next` `avc-bpm` `btn-piano`. `avc-bpm` keeps its `role=slider`
click/wheel/arrow behaviour and its `avApplyParam("bpm")` funnel. The pack/preset `<select>`s keep
`avc-pack` / `avc-preset` but move into `#av-lcd` as a compact row.

`avConsoleInit()` stays the entry point and the public facade `window.__avConsole`
(`setBpm/bpm/transport/...`) is unchanged. `avc-*` proof/rig surface must survive.

### 2.2 Tabs — `nav#av-zones`, parent

Nine `.av-zone-tab` with `data-zone` and `aria-controls`: `browse perform sound shape sequence mix
deliver effects system`, ids `av-tab-<zone>`. Labels: BROWSE · PERFORM · SOUND · SHAPE · SEQUENCE ·
MIX · DELIVER · EFFECTS · SYSTEM. Tabs span the content well only (the well is `flex:1` beside the
272 px inspector). Alt+1..9 replaces Alt+1..8.

### 2.3 Zones + sub-tabs — parent

Zones `section.av-zone#av-zone-<zone>[data-zone]`, one `.av-zone-box` each, exactly as now.

Sub-tab system (only where a page has more than one card, so SOUND and MIX):
`.av-subtabs[role=tablist]` holding `.av-subtab[data-sub][role=tab]` buttons, then one
`.av-sub[data-sub][role=tabpanel]` per sub. Sub ids: sound = `engine fm drums samples chop wt tune`;
mix = `mix comp rec studio`. Only the active `.av-sub` renders; the rest are `hidden`. Sub state
lives in `avZoneSub` (parent wires it in `av_shell.js`) with `?z=sound&s=fm` deep links.

### 2.4 Inspector column — `aside#av-inspector`, child I

Inside `.av-work`, after `main.av-main`, before the dock. Structure:

- `#av-insp-title` — "SELECTED VOICE".
- `.av-kind-keys` — seven `.av-kind-key[data-kind][role=radio]` for `acid wavetable fm string drum
  granular sampler`, each with a `.av-kind-dot`; `aria-checked` on the current one.
- `#av-insp-core` — six pot mounts `#av-insp-level` `#av-insp-pan` `#av-insp-cutoff`
  `#av-insp-reso` `#av-insp-attack` `#av-insp-release`, each `.av-insp-pot` + `.av-insp-pot-label`
  + `.av-insp-num` value line (the pot's current value, read-only text is enough for C1).
- `#av-insp-wave` — dark screen canvas, engine waveform/spectrum (C1: draws the current osc shape from
  the synth select; drag-to-edit is C2).
- `#av-insp-env` — dark screen canvas, the amp ADSR drawn from the live attack/decay/sustain/release;
  drag-to-edit is C2. A `.av-insp-screen-label` reads "20 s"-style at its top right.
- `#av-insp-edit` — the "EDIT VOICE" button (jumps to sound/engine).
- `#av-insp-core`, `#av-insp-wave`, `#av-insp-env` sit inside one `.av-insp-frame` group box.
- `#av-insp-scope` — small canvas.
- `.av-insp-launch` — two-column grid of `.av-insp-launch[data-page][data-sub]` buttons:
  OSC(sound/engine) FM(sound/fm) DRUMS(sound/drums) SMP(sound/samples) CHOP(sound/chop)
  WT(sound/wt) TUNE(sound/tune) FX(effects). Each is a jump: `avZoneShow(page)` then
  `avZoneSub(page, sub)` when `data-sub` is set.
- `#av-insp-voices` — "voices: n / m" readout; `#av-insp-poly` a POLY/MONO `.av-pair`.

Facade `window.__avInspector` with `kind()`, `kindSet(k)`, `select()` (returns the object),
`launch(page, sub)`, and a proof. All getters tolerate a cold start.

### 2.5 Keyboard dock — parent + child I

The dock gains a `.av-wheels` block at its left: `#av-wheel-pitch`, `#av-wheel-mod`
(`role=slider`, vertical, spring-back on pitch), then the existing bed `#piano-keys` and the existing
popout key. Dock height 132 px. Wheels are pointer-drag + keyboard; pitch writes
`avApplyParam("bend")` (clamped), mod writes `avApplyParam("modwheel")`.

## 3. Control-language primitives (child S authors the CSS, parent applies the classes in C4)

`.av-pot` (existing knob, cap restyled: graphite, light pointer, no colour), `.av-fader`,
`.av-pair` (a two-choice silver key pair, `.av-pair-key[aria-checked]`), `.av-num`
(`.av-num-down` / `.av-num-up` steppers flanking an editable value), `.av-group` + `.av-group-tab`.
ONE lit accent: `--zone-accent`; lit text goes white. No new colour anywhere.

**Page composition** (the model every C3 page fill follows): a page is a stack of `.av-group` boxes,
each `.av-group-tab` titled, each holding pot rows where **every pot carries its `.av-num` value
field**. Group boxes fill the well width; a page must fit without scrolling (the density gate).

## 4. Rig contract — `verify/cdp_chassis.mjs` (NEW, parent owns)

Legs (each a `check(...)`):
1. virgin profile: rail is closed (`body.av-rail-closed`), one navigation only;
2. nine tabs exist, in the pinned order, and every `aria-controls` resolves;
3. band groups: 5, in the pinned `data-grp` order; LCD has 3 rows; 4 pot mounts; pot-mode pair has
   exactly one `aria-checked`;
4. inspector: 7 kind keys, 6 core pots, 8 launchers; every launcher's `[data-page]` is a real zone
   and every `[data-sub]` a real sub of it;
5. launcher click lands: page shown + sub shown;
6. wheels: pitch springs back to 0 after drag; mod holds;
7. **density**: for every zone at 1440x900 and 1280x800, `zoneBox.scrollHeight <= 1.2 * zone.clientHeight`
   — fail lists the offending zone + numbers;
8. reachability: with the rail closed, every chrome card id sits inside a zone reachable from
   tabs + subs (the card map, transitively);
9. no console/page errors through the run;
10. `avc-*` transport surface still resolves (play/stop/bpm/preset keys).

`cdp_cockpit` ZONEMAP, `cdp_hub` (store-zone reaches), `cdp_smoke` (synth-zone layout leg) and
`cdp_fit` are updated by the parent in the same landing pass.

## 5. Gates

- `node verify/cdp_chassis.mjs` green (all legs, incl. density + reachability).
- smoke · cockpit · fit · hub · platform green first-lap, then the full 32-suite battery + bench.
- Zero offences from the `.av-btn` text-button class (every band/label button carries `.mini` or a
  scoped wide rule).
- 800 px width: inspector collapses to a 56 px icon strip (`@media (max-width: 1180px)`), nothing
  overlaps, `cdp_fit` green.
- Owner drives the live surface before close.

## 6. Integration recipe (parent)

1. verify the three child artifacts exist by marker (`avBandInit`, `avInspectorInit`,
   `.av-inspector{` in the CSS fragment) — a refusal names the missing marker;
2. apply body.html restructure + head markup + av_shell/av_rail/av_chrome/av_panels edits as ONE
   counted-assert python pass, all writes deferred to the last anchor;
3. append the child CSS fragment to `styles.css` under a `/* C1 chassis */` banner, add the module
   entries to `js_parts` (order: av_head, av_inspector — both after av_console/av_shell);
4. rebuild, run `cdp_chassis` + the renamed rigs, then the battery, then freeze + pins.

## 7. Watch-outs

- `.av-btn` is a fixed 26x26 icon box — text buttons need `.mini` or a scoped wide override;
- `html,body{overflow:hidden}` stays; the page never scrolls, only the well;
- `av_chrome.js` hardcodes `#av-zone-synth` → becomes `#av-zone-sound`; `av_panels.js` default zone
  `"synth"` → `"sound"`;
- `AV_ZONE_DEFAULT` becomes `"browse"`? **No** — the landing page is `sound` (a player must land on a
  sound, not a shop). Keep `sound`;
- ASCII anchors only in the landing script; probe line endings on every edited file;
- no console windows (hidden spawns only).

## 8. Report shape (prose, no brace blocks)

Per child, report: files written, the pinned-id list confirmed present, anything in live source that
conflicted with a pin (source wins, named), and what it could not verify.
