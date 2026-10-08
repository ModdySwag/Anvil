# R14 wave — CONSOLE FINISH: preset step keys + VU meters (contract)

State at open: R13 shipped (`24ab19b3` live). Carried items (addendum 47/48): "console
step-and-apply preset keys" + "console VU meters (needs a meter accessor)".

THE ACCESSOR ALREADY EXISTS — `av_tap.js` L147-161: `avTap.levels = { l, r, peak }`, smoothed
0..1 peaks (attack .4 / release .6) updated by the tap's own rAF loop.

THE BANK API ALREADY EXISTS — `av_bank.js`: `avBankPacks()` (array of packs), `avBankPresets(packId)`
(array of preset objects carrying `.i` ordinals), `avBankApplyPreset(preset)` -> bool (+ receipt on
`avBankState.lastApply`: {name, forwarded, accepted, refused, seq, reason, ok}). The UI mirrors are
`select.av-bank-pack` / `select.av-bank-preset`; a bubbling 'change' from either select updates
`avBankState` via the delegated handler (L595-612).

## 1. Deliverable

`src/av_console.js` evolves: a PRV/NXT keycap pair in the transport deck that steps the current
pack's preset selection AND applies it (riding `avBankApplyPreset`), plus a two-bar VU meter fed
by `avTap.levels`. NO version bump (AV_CONSOLE_VERSION stays "r11.0" — the R12 precedent:
additions do not bump). UI-only; no engine work.

## 2. File ownership

- CHILD: `src/av_console.js` — SOLE writer. Evolve it; preserve EVERY existing id / class /
  behavior (avc-play/-stop/-song/-rec, avc-bpm window, avc-pack/-preset/-sys, avc-power, the
  legacy ids, the 400 ms poll, transport/song/rec toggles, facade keys). Only ADD.
- PARENT: `src/styles.css` (R14 block) · `verify/cdp_smoke.mjs` (+2 checks) · this contract ·
  gates. NO other files (app_core / build.py / pins untouched; pins stay 20).

## 3. Pins — src/av_console.js (child follows EXACTLY)

Laws: never throws; all DOM/global reach guarded inside functions; reuse the module's existing
helpers (avConsoleEl / avConsoleSetLast / avConsoleRefresh / avConsoleMkKey / avConsoleState).

### 3.1 Preset step keys

- Two keys built via the existing avConsoleMkKey, appended to the deck AFTER `avc-rec`:
  `avc-preset-prev` label "PRV" aria "Previous preset (steps and applies)" · `avc-preset-next`
  label "NXT" aria "Next preset (steps and applies)". Click -> `avConsolePresetStep(-1 | +1)`.
- `avConsolePresetStep(dir)` — dir coerced (-1 stays -1, else +1). Result object with EXACTLY
  the keys `{ applied, pack, index, preset, reason }`; flow:
  1. `typeof avBankPacks/avBankPresets/avBankApplyPreset !== "function"` -> reason `"no-bank-api"`.
  2. `packs = avBankPacks() || []`; empty -> reason `"no-banks"`.
  3. pack from `select.av-bank-pack` selectedIndex (clamped into packs; else 0);
     `presets = avBankPresets(pack.id) || []`; empty -> reason `"no-presets"`.
  4. current index from `Number(select.av-bank-preset.value)` (Math.round; if not finite, < 0,
     or >= presets.length -> reset: `dir > 0 ? -1 : 0`). `target = (cur + dir + n) % n`.
  5. sync: when `select.av-bank-preset.value !== String(target)` set it + dispatch a bubbling
     'change' (the existing delegated handler updates avBankState).
  6. preset object: first `presets[i].i === target`, else `presets[target]`.
  7. `applied = avBankApplyPreset(obj) === true`; false -> reason `"refused"`.
  8. ALWAYS (even on any refusal): `avConsoleSetLast(dir > 0 ? "preset-next" : "preset-prev")`
     then `avConsoleRefresh()`. Return the result object.
- Facade: `__avConsole.stepPreset(dir)` -> the result; every existing facade key untouched.

### 3.2 VU meters

- Build + insert into the header AFTER the transport deck, BEFORE the BPM window:
  `<div class="avc-vu" aria-hidden="true"><span class="avc-vu-bar"><i class="avc-vu-fill" id="avc-vu-l"></i></span><span class="avc-vu-bar"><i class="avc-vu-fill" id="avc-vu-r"></i></span></div>`
- `avConsoleVuTick()` -> bool: read `avTap.levels` behind `typeof avTap !== "undefined" &&
  avTap.levels` (else false); clamp l/r to 0..1; write ONLY when the value moved > 0.01 since
  the last paint: `fill.style.transform = "scaleY(" + v.toFixed(3) + ")"`. Return true.
- `avConsoleMeterStart()`: ONE flag-guarded rAF loop calling vuTick each frame; started at init;
  each tick try/catch'd (the loop must never die, never throw).
- Facade: `__avConsole.vu()` -> `{ l, r }` from avTap.levels (null when avTap absent) ·
  `__avConsole.vuTick()` -> avConsoleVuTick().
- Proof: `avConsoleProof()` object gains `vu` (elements mounted) + `step: true` (wired) —
  additive only; `v` stays "r11.0"; existing keys/values unchanged.

### 3.3 Notes the child MUST confirm from source before editing

- `av_bank.js` L480-492 (`avBankPresetOptionsHTML`) + L595-612 (`avBankChange`) — confirm the
  preset option VALUE space (the `.i` ordinal) so step 4-6 math lands right.
- `av_tap.js` L145-161 — levels shape/smoothing.
- Styles come from the parent (styles.css) — child adds NO CSS.
- `node --check src/av_console.js` allowed; no build/browsers/suites/git; edit ONLY that file.

## 4. Parent edits (counted-assert `cache/r1/int_r14.py`)

- `src/styles.css` append:
  `.avc-vu` (inline-flex, gaps, height) · `.avc-vu-bar` (6px bar, dark plate, border, radius,
  overflow hidden) · `.avc-vu-fill` (absolute inset fill, teal gradient, `transform: scaleY(0)`,
  `transform-origin: bottom`, `font-style: normal`) — exact block in the script.
- `verify/cdp_smoke.mjs` +2 checks (**58 -> 60**), inserted BEFORE the R12 proof-gate leg
  (same anchor as R13 — that leg navigates to the plain page):
  1. "R14 console: step keys + VU bars mounted; the step is an honest no-op with no banks":
     ids avc-preset-prev/-next/-vu-l/-vu-r present; facade stepPreset/vu/vuTick functions;
     `stepPreset(1)` -> `{applied:false, reason:"no-banks"}` + lastAction "preset-next";
     clicking `avc-preset-prev` -> lastAction "preset-prev".
  2. "R14 console: VU bars paint from avTap.levels": inject `avTap.levels.l/r = 0.8/0.4` ->
     `vuTick()` -> fills' `style.transform` "scaleY(v)" with v ~0.8 / ~0.4 (parse via
     `split("scaleY(")`, tolerance 0.05); `vu()` mirrors; restore + tick.
- NO cdp_store edit this wave: the step happy-path (real packs) rides avBankApplyPreset, which
  cdp_store's apply coverage already gates; a dedicated store leg is recorded as a follow-up
  option in the addendum, not smuggled into a frozen rig.

## 5. Gates (mirror R13)

build -> smoke **60** first-run -> pins sweep (`cache/r1/sweep_r14.py`: OLD `24ab19b3...` full
64-hex -> new; EXPECT_FILES 20) -> battery 23 suites + bench -> records commit -> deploy
index.html + sw.js -> scoped --verify 0 -> live pass (leak probe 11/11; console live capture
`renders/r14-live-console.png` — keys + VU visible) -> addendum 49.

## 6. Report shape (child)

File path · exact new/changed top-level names · DOM ids added · node --check result.
