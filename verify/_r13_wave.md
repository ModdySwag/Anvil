# R13 wave — THE LFO CARD (contract)

State at open: R12 SHIPPED (frozen `3172a17e`, 3,505,306 B; LIVE at moddys.net/anvil).
The LFO engine surface ALREADY EXISTS in av_dsp — this wave is UI-only, ZERO engine work:

- `lfo.shape` — EN `LFO_SHAPES` = ["sine","tri","square","sh"] (mapEnum accepts name or ordinal)
- `lfo.rate` — cl(0.05, 20), seconds-rate step; default 5
- `lfo.toCut` — cl(-1, 1); cutoff += 2 * lfoToCut * lfoVal
- `lfo.toPitch` — cl(-1, 1); pitch += 0.5 * lfoToPitch * lfoVal semitones

Today only `lfo.rate` + `lfo.toCut` are exposed as knobs (in the synth MOD row); there is no
dedicated module. Owner ask (addendum 46 item 3): a real LFO card. This wave ships it: shape
select + rate/toCut/toPitch knobs + a deterministic waveform mini-scope. The two LFO knobs MOVE
out of the synth MOD row (single source of truth — no duplicated knob paths; a duplicated path
would desync because knob commits only repaint the element that committed).

## 1. Deliverable

`#av-lfo` card in the Mod zone (directly after `#av-mod`, inside `.av-zone-box`), with:
SHAPE select (4 shapes) · RATE / TO CUT / TO PITCH knobs · `#av-lfo-scope` canvas (deterministic
paint) · facade `window.__avLfo` · `?avtest=1`-gated deferred proof line `LFO SELFTEST`.

## 2. File ownership

- CHILD: `src/av_lfo.js` — NEW file, sole writer. Nothing else.
- PARENT integration — ONE counted-assert python script (all-or-nothing), editing:
  `src/body.html` · `build.py` · `src/app_core.js` · `src/av_synth.js` · `src/av_chrome.js` ·
  `src/av_rail.js` · `src/styles.css` · `verify/cdp_smoke.mjs` · `verify/cdp_cockpit.mjs`.
- PARENT direct: this contract, the sweep script (`cache/r1/sweep_r13.py`), battery script
  (`cache/r1/battery_r13.sh`), scratch probes, CONTINUATION addenda.

## 3. Pins — src/av_lfo.js (child follows EXACTLY)

Laws: `"use strict";` at top. EVERY top-level symbol prefixed `avLfo` / `AV_LFO_` (strict
`node --check` of the concatenation catches cross-part duplicates). Never throws. `avLfoInit()`
idempotent (ready flag) → bool. Seed the mirror at init, NEVER push to the engine at init
(the P1 law: the engine replay owns the push):

- `avParams["lfo.shape"]` undefined → `"sine"`; `avParams["lfo.toPitch"]` undefined → `0`
  (rate/toCut are already defaulted by the av_synth defaults table — read, do not re-seed).

Fill `#av-lfo-host` (innerHTML, in this order):

1. `<div class="av-lfo-picks">` row containing
   `<label class="av-lfo-pick"><span class="av-lfo-pick-lbl">SHAPE</span>` +
   `<select class="av-select" id="av-lfo-shape" data-param="lfo.shape" aria-label="LFO waveform shape">`
   with options `sine` `tri` `square` `sh` (value = text; `selected` mirrors the seeded mirror).
2. `<div class="av-lfo-knobs">` ← `avKnobRowHTML(knobs.map(k => avKnobHTML(k.path, k.label, Object.assign({ value: avParams[k.path] }, k.opts))), "av-lfo-knobs")`
   then `avKnobBind(host)`. Knob table (EXACT — matches the engine schema):

   | path | label | opts |
   |---|---|---|
   | `lfo.rate` | RATE | `{min:0.05,max:20,step:0.01,def:5,curve:"log",fmt:"hz"}` |
   | `lfo.toCut` | TO CUT | `{min:-1,max:1,step:0.01,def:0,fmt:"pct"}` |
   | `lfo.toPitch` | TO PITCH | `{min:-1,max:1,step:0.01,def:0,fmt:"pct"}` |

3. `<div class="av-lfo-scope-wrap">` + `<canvas id="av-lfo-scope" class="av-lfo-scope" width="480" height="120" aria-label="LFO shape preview"></canvas>`.

Select change → mirror + commit (`avApplyParam("lfo.shape", sel.value)`; guarded fallback:
mirror + dispatch `av-param` CustomEvent when avApplyParam is absent — same shape as
av_synth's avSynthCommitValue) → then `avLfoRedraw()`.

Scope paint (deterministic — this is a digest-tested surface):

- Fixed backing store 480×120 (attributes above). NO devicePixelRatio scaling, NO rAF loop.
- Repaint ONLY at: init · shape change · `avLfoRedraw()`.
- Content: center axis line (rgba(255,255,255,0.08)); waveform stroke `#3fd0c9`, lineWidth 2:
  sine = one sin() period pair over the width; tri; square; sh = FIXED step sequence
  `[0.6,-0.4,0.9,-0.9,0.2,-0.7,0.4,-0.1]` (constant array — no RNG anywhere).
- `canvas.setAttribute("data-shape", <current shape string>)` on every paint.

Facade: `window.__avLfo = { version:"r13.0", init, shape(), setShape(v), redraw(), proof }`.
`setShape(v)`: accept only the four shapes (else false); mirror + commit via the same path,
sync the select value, redraw; return the accepted shape string.

Proof: `avLfoProof()` → `"LFO SELFTEST " + JSON.stringify({v, ready, shape, knobs:3, painted:true})`.
Emitted ONLY when `typeof avTestLine === "function" && /[?&]avtest=1/.test(location.search)`,
DEFERRED `setTimeout(…, 0)`, id `"av-lfotest"` (the R12 leak law — parse-time unconditional
proof calls leak visible text onto the plain page; smoke now guards this class).

Pattern references to study first (read-only): `src/av_console.js` (self-contained card module,
proof gate, facade), `src/av_synth.js` L320-440 (knob HTML/row/bind + select commit patterns),
`src/av_mod.js` (host fill + facade), `src/av_knob.js` (avKnobHTML / avKnobRowHTML /
avKnobBind / avKnobCommit APIs). `node --check src/av_lfo.js` is allowed; no build, no
browsers, no git, no shared files.

## 4. Pins — parent integration (counted-assert script)

- `src/body.html` — insert after `#av-mod`'s `</section>`, before the mod zone-box `</div>`:
  `<section class="av-card" id="av-lfo"><h2>LFO</h2><div id="av-lfo-host"><p class="av-note av-dim">The LFO lands here &mdash; shape, rate and the cutoff / pitch depths, with a live waveform scope.</p></div></section>`
- `build.py` — js_parts gains `(SRC / "av_lfo.js").read_text(encoding="utf-8"),` directly after
  the `av_mod.js` entry (order matters: unlisted = silently never ships).
- `src/app_core.js` — boot block gains, right after the mod init line:
  `let lfoOk = false;` + `try { lfoOk = (typeof avLfoInit === "function") ? (avLfoInit() !== false) : false; } catch (e) { console.warn("[anvil] lfo card failed", e); }`;
  the ready console.log string gains `" lfo=" + lfoOk +` between `" mod=" + modOk +` and `" seq=" + seqOk +`.
- `src/av_synth.js` — REMOVE the `lfo.rate` + `lfo.toCut` entries from the `av-synth-mod` row
  (the row keeps `voice.glide`); the defaults table gains `"lfo.shape": "sine"` and
  `"lfo.toPitch": 0` next to the existing lfo lines.
- `src/av_chrome.js` — `AV_CHROME_CARDS` gains `{ id: "av-lfo", init: true, rnd: false }` right
  after the `av-mod` entry (this is what gives the card its module head + float button; the R9
  smoke check requires head+float on EVERY `.av-zone .av-card`).
- `src/av_rail.js` — Mod group cards gain `["av-lfo", "LFO"]` after the `av-mod` link. This
  single edit also feeds the Panels quick-view Available rows (avRailCardNames reads
  AV_RAIL_GROUPS) — no other rail edit.
- `src/styles.css` — append an `/* R13: the LFO card */` block: `.av-lfo-picks` (row layout),
  `.av-lfo-pick` / `.av-lfo-pick-lbl` (match the `.av-synth-pick` conventions), `.av-lfo-knobs`,
  `.av-lfo-scope-wrap` (inset plate like the OLED — border + dark backdrop), `#av-lfo-scope{width:100%;height:auto;display:block}`.
- `verify/cdp_smoke.mjs` — +2 checks (56 → **58**), inserted AFTER the R12 BPM-window check and
  BEFORE the R12 proof-gate leg (that leg navigates to the plain page — nothing after it may
  touch the app page):
  1. "R13 LFO card: mounted in the mod zone with the shape select + 3 bound knobs + scope canvas + facade":
     `window.__avZoneAuto('#av-lfo')` reveal first (hidden-zone law); assert: `#av-lfo` exists and
     `.closest('.av-zone')` is `#av-zone-mod`; `#av-lfo-shape` select has exactly the 4 shape
     options; `#av-lfo .av-knob[data-knob]` count === 3 with paths lfo.rate/lfo.toCut/lfo.toPitch
     all `dataset.knobBound === '1'`; canvas `#av-lfo-scope` present; `typeof window.__avLfo === 'object'`;
     `avParams['lfo.shape'] === 'sine'`.
  2. "R13 LFO: commit + select ride the funnel and the scope repaints per shape": read canvas
     `toDataURL()` (d0, sine); `avKnobCommit(pitchKnob, 0.6)` → `avParams['lfo.toPitch'] === 0.6` →
     commit back 0; set select 'tri' + dispatch change → `avParams['lfo.shape'] === 'tri'` +
     canvas `data-shape === 'tri'` + `toDataURL()` d1 !== d0; restore select 'sine' + change;
     engine-accept witness `window.__avEngine.setParam('lfo.shape','tri') === true` then
     `setParam('lfo.shape','sine')`. All committed values restored (rig law).
- `verify/cdp_cockpit.mjs` — ZONEMAP `mod: ['av-mod', 'av-lfo']`; the card-map check name
  "(22/22)" → "(23/23)" and `mp.n === 22` → `mp.n === 23`.

## 5. Gates (mirror R12 exactly)

build → smoke **58** first-run → pins sweep (`cache/r1/sweep_r13.py`: OLD `3172a17efe...`
full 64-hex → the new sha; EXPECT_FILES still 20 — no new suite file) → battery 23 suites +
bench ALL green (`cache/r1/battery_r13.sh`) → commit records → deploy `index.html` + `sw.js`
(radio-browser `upload-site.py --only`) → scoped `--verify` = 0 → live evidence (leak
differential probe stays 11/11; NEW: mod-zone screenshot of the live LFO card) → close
addendum 48.

Watch-outs:

- Hidden-zone canvas law: the smoke leg reveals via `__avZoneAuto` BEFORE any canvas assertion.
- The knob MOVE must not break the smoke synth-card count (89 → 87 knobs; its check is `>= 85`).
- s4 QR cap: new knobs carry `data-def` from their opts (defaults are omitted from the knob
  diff) — re-check the s4 QR leg; if it trips, inspect data-def coverage first, never loosen.
- a11y slider floor is `>= 85` — adding one knob (toPitch) keeps it.
- The card must self-heal on reveal IF the child paints lazily; the pinned design paints at
  init (canvas backing store exists while the zone is display:none) — no heal path needed.

## 6. Report shape (child)

Absolute file path · list of top-level names created · DOM ids/classes used ·
`node --check` result. (No build/browser/git runs.)
