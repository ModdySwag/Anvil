# Anvil M1 wave — SOUND DEPOT: FM engine (#60) · studio flavours bank (#68) · convolution IR (#67) · wavetable editor (#66) (2026-10-08)

State at open: frozen `7accc9fd…` (2,608,972 B) · battery 18 suites green · HEAD `6c926cc` ·
tree clean (`?? cache/`). Parent owns build/freeze/pins/commits; children author ONE scope each,
write the file to disk FIRST, then iterate; `node --check` + own-file node harness only — children
NEVER run build.py, browsers, suites, git, or touch shared files.

Living templates to READ before authoring (the house laws, each file's header restates them):
- FX module contract + laws: `src/av_fx_verb.js` header + `src/av_fx_drive.js` (233 lines — the
  compact model), `src/av_fx_dyn.js`. Footer: `AVDSP.registerFx("<prefix>", <MOD>)` guarded.
- Kind module contract + laws: `src/av_acid.js` header + `src/av_grain.js` (compact), `AVDSP.registerKind(6, <MOD>)`.
- Worklet-scope facts: NO fetch/URL/performance/TextEncoder/structuredClone; `new Function` works;
  in-worklet clock = `Date.now()` only; `performance` absent everywhere in the audio scope.
- Node harness precedents: `cache/scratch/deck/integrate/mod_dsp_node.mjs` (module text loaded in a
  node Function scope with stubbed AVDSP), `cache/scratch/s5/probe/` (scope probes).

## §1 Deliverables + file ownership (one writer per file, ever)

| child | file(s) — sole writer | scratch | deliverable |
|---|---|---|---|
| sa-A | `src/av_fm.js` | `cache/scratch/m1/fm/` | FM voice engine, kind id 6, prefix `fm` |
| sa-B | `src/av_fm_ui.js` | `cache/scratch/m1/fmui/` | the FM card (#av-fm): operator grid + algorithm view |
| sa-C | `src/av_fx_aw.js` | `cache/scratch/m1/aw/` | AVFXAW — studio flavours bank, fx prefix `aw` |
| sa-D | `src/av_fx_conv.js` | `cache/scratch/m1/conv/` | AVFXCONV — partitioned-FFT convolution, fx prefix `conv` |
| sa-E | `src/av_wt.js` | `cache/scratch/m1/wt/` | wavetable authoring core (model · mips · library · I/O) |
| sa-F | `src/av_wt_ui.js` | `cache/scratch/m1/wtui/` | the WT EDITOR card (#av-wt) |
| sa-G | `verify/cdp_m1.mjs` | `cache/scratch/m1/rig/` | write-only rig (pin EXPECT_SHA = null) |

Parent integration (ONE counted-assert script): build.py · av_dsp.js · av_voiceproc.js · av_engine.js ·
av_synth.js · av_fx.js · body.html · styles.css · app_core.js · cdp_smoke.mjs (sites in §4).
NOTE the child file names above are ALSO the required top-level names/order the parent wires:
av_fm before av_fx_verb; av_fx_aw + av_fx_conv after av_fx_dyn; av_fm_ui after av_synth;
av_wt + av_wt_ui after av_sample.

## §2 Interface pins

### 2.1 FM engine — `src/av_fm.js` (sa-A)

- ONE top-level name: `AVFM` (const IIFE). `"use strict"`. Worklet-safe (no DOM/window/document/
  console). Exports exactly the kind-module shape (mirror av_acid.js): `{version, VERSION, PREFIX:"fm",
  initEngineK(kext), initVoiceK(k), initVoice(eng, v), stepVoice(eng, v), releaseVoice(eng, v),
  isVoiceDone(eng, v), setParam(eng, path, value), algoInfo(i)}`. Footer:
  `if (typeof AVDSP !== "undefined" && typeof AVDSP.registerKind === "function") AVDSP.registerKind(6, AVFM);`
- Voice state lives on `v.k` (filled by `initVoiceK`; per-note reset in `initVoice`); engine state on
  `eng.kext` (filled by `initEngineK`). `stepVoice` returns ONE base-rate sample (FM runs at base rate —
  document the choice in the header). Allocation-free render; NaN-proof (clamp every param, guard every
  exponential); determinism: no randomness anywhere (fixed phases at note-on).
- 6 operators, 8 algorithms (0..7), self-feedback on operator 6. `algoInfo(i) -> {name, carriers:[opIdx...],
  edges:[[from,to]...]}` — op indices 0..5; the DSP routing MUST match algoInfo for every i (the UI draws
  from algoInfo). Document all 8 topologies in the file header.
- **Param schema (EXACT — the UI child builds from this; both must agree):**
  - `fm.algo` int 0..7 def 0 · `fm.fb` 0..1 def 0 · `fm.volume` 0..1 def 0.8 (house engine-volume convention)
  - per op N = 1..6: `fm.opN.ratio` 0.5..16 def {op1:1, op2:2, op3..6:1} (log curve in UI) ·
    `fm.opN.detune` -1..1 st def 0 · `fm.opN.level` 0..1 def {op1:1, op2:0.35, op3..6:0} ·
    `fm.opN.att` 0.001..8 s def 0.001 · `fm.opN.dec` 0.001..8 s def 1.2 · `fm.opN.sus` 0..1 def 0.5 ·
    `fm.opN.rel` 0.001..8 s def 0.3 · `fm.opN.vel` 0..1 def 0.5
  - setParam handles EVERY path above (exact names, `fm.` prefix) + returns false on unknown. Params may
    arrive any time; changes must be render-safe (block-rate recompute is fine; document the cadence).
  - Defaults above = a usable 2-op patch on algorithm 0 at first paint.
- Harness (node, `cache/scratch/m1/fm/harness.mjs`): load the file text in a Function scope with a stub
  AVDSP; drive `initEngineK/initVoiceK/initVoice/stepVoice` manually (mirror mod_dsp_node.mjs); assert:
  (1) single op, level 1, ratio 1 -> near-sine at f0 (harmonic 2.. ≤ -60 dBc); (2) modulator at ratio 2
  creates sidebands at f0±fm; (3) envelope: att/dec/sus/rel shape monotone regions; (4) isVoiceDone after
  release ends; (5) determinism: two identical runs bit-identical; (6) algos: for each i, carriers with
  level produce signal when modulators are zero (routing sanity); (7) NaN safety on extreme params.
  ALL-PASS summary line: `FM-HARNESS: n/n PASS`.

### 2.2 FM card — `src/av_fm_ui.js` (sa-B)

- Mounts into parent host `#av-fm-host` (parent adds the card + host). Public API: `avFmUiInit()`
  (idempotent, re-mountable), `avFmUiSnap()`, `avFmUiClasses()` (NEW css class names only),
  `avFmUiSync(root)`, `window.__avFmUi = {version, init, snap, classes, sync}`.
- DOM pins: `#av-fm-host` · op tabs `.av-fm-op-tab[data-op="1".."6"]` · active op panel
  `[data-op-panel="N"]` · algorithm select `#av-fm-algo` (`select.av-select` with
  `data-param="fm.algo"`) · algorithm view `#av-fm-algo-view` (small canvas or SVG drawn from
  `AVFM.algoInfo(i)` — call it defensively via typeof) · knobs `.av-knob[data-knob]` for every
  `fm.*` path of the active op (8) + `fm.fb` + `fm.volume` always visible · status line `#av-fm-status`.
- Knobs use the standard `avKnobHTML(path, label, opts)` + `avKnobBind` idioms; commit via
  `avApplyParam` (with the av-param CustomEvent fallback — copy av_fx.js's commit path); first paint
  reads `avParams[path]` then falls back to the §2.1 defaults table (keep a local copy of the table).
- No engine reach-ins beyond `AVFM.algoInfo` (typeof-guarded).

### 2.3 Studio flavours bank — `src/av_fx_aw.js` (sa-C)

- ONE top-level name `AVFXAW`; fx-module shape like av_fx_verb.js: `{version, VERSION, PREFIX:"aw",
  createState(opts), bindEngine(st, eng), setParam(st, path, value), process(st, inL, inR)}` on the
  returned state shape `st.oL/st.oR/st.on/st.mix`. Footer `AVDSP.registerFx("aw", AVFXAW)` guarded.
- Wet convention: this module writes the **WET (fully processed) signal**; the parent owns the dry/wet
  blend (`FX_WET` slot = 1) — `st.on === 0` or `st.mix === 0` must pass the input through
  bit-identically and skip the DSP.
- Modes (5, enum): `console` · `tape` · `drive` · `air` · `warm` — distinct, documented bus-flavour
  characters (console = subtle even-harmonic headroom colour; tape = soft sat + gentle HF loss + low
  bump; drive = asymmetric harder edge; air = nonlinear HF shelf/exciter; warm = low-tilt thickener).
  Clean-room DSP only — Airwindows-class is the design target; NO third-party code, lineage note in
  the header. Deterministic, NaN-proof, allocation-free process.
- Param schema (EXACT): `aw.on` 0|1 def 0 · `aw.mix` 0..1 def 1 · `aw.mode` enum def "console" ·
  `aw.amount` 0..1 def 0.5 · `aw.tone` 0..1 def 0.5. setParam accepts full path or bare `aw.` form.
- Harness (`cache/scratch/m1/aw/harness.mjs`): null law (on=0 bit-identical; mix=0 bit-identical);
  per mode: harmonic profile change measurable (THD or spectrum centroid delta vs input), amount
  monotone (0 -> 1 increases the effect metric); determinism bit-identical ×2; extremes NaN sweep
  (amount/tone 0/1 × 5 modes, no NaN/inf). Summary `AW-HARNESS: n/n PASS`.

### 2.4 Convolution IR — `src/av_fx_conv.js` (sa-D)

- ONE top-level name `AVFXCONV`; fx-module shape as §2.3 + `loadImpulse(st, name, rate, ch1, ch2) -> bool`.
  Footer `AVDSP.registerFx("conv", AVFXCONV)` guarded. Wet=1 (parent blends).
- True stereo; partition size ≤ 512 samples (latency documented); max impulse 2.0 s at any sr ≤ 96k
  (truncate honestly, report via snap); preallocated FFT/ring buffers (created in createState /
  loadImpulse — NOT in process); allocation-free process; deterministic.
- Factory bank = 6 modes generated deterministically in-worklet (own CC0 content — recipes in the
  header): `plate` · `room` · `hall` · `spring` · `cab` · `user`. Generation uses a local seeded PRNG
  (its own seed constant — do NOT touch the engine voice PRNG). `user` with no impulse loaded =
  honest dry pass + documented.
- Param schema (EXACT): `conv.on` 0|1 def 0 · `conv.mix` 0..1 def 0.25 · `conv.mode` enum def "plate" ·
  `conv.size` 0..1 def 0.5 (length scale) · `conv.decay` 0..1 def 0.5 · `conv.damp` 0..1 def 0.5.
- `loadImpulse`: validates + resamples? NO — the importer (parent page code) resamples to engine sr
  BEFORE the send; loadImpulse accepts {rate ≈ eng.sr, ch1/ch2 Float64Array ≤ 2.0 s}; stores, sets
  mode "user" eligibility. Returns bool. Expose `st.irName` for readouts.
- Harness (`cache/scratch/m1/conv/harness.mjs`): (1) delta impulse -> output ≈ input within epsilon;
  (2) synthetic 2-tap IR -> expected 2-tap response; (3) FFT partition continuity: single-freq sine
  through a flat IR keeps amplitude (partition seam check); (4) tail length ≈ impulse length; (5)
  determinism ×2 bit-identical; (6) modes generate distinct responses; (7) NaN sweep. Summary
  `CONV-HARNESS: n/n PASS`.

### 2.5 Wavetable core — `src/av_wt.js` (sa-E)

- Page module (no worklet concat). Top-level API (names EXACT — UI child + parent integration rely):
  `avWtNew(name) -> table` · `avWtFrameCount(t)` · `avWtSetFrame(t, i, f64_2048)` · `avWtAddFrame(t)` ·
  `avWtDelFrame(t, i)` · `avWtSeedFrom(t, i, kind)` (kinds: "saw","square","tri","sine","pulse25",
  "noise"?) · `avWtMorph(t, iA, iB, x) -> Float64Array(2048)` baked frame ·
  `avWtMips(frame) -> [11 × Float64Array(2048)]` · `avWtInstall(table, slot?) -> {ok, slot, error}`
  (calls `avEngineWt(slot, name, mips)`; auto-pick first free slot 0..15 when slot omitted) ·
  `avWtInstalled()` -> [{slot, name}] (local mirror of installs) ·
  `avWtLibraryList() / avWtLibrarySave(table) / avWtLibraryLoad(id) / avWtLibraryDelete(id)` (IDB
  `av-wt-store`, LS fallback, sha-lite integrity not needed — content only) ·
  `avWtExportJson(table) -> string` / `avWtImportJson(str) -> table|{error}` ·
  `avWtImportWt(buf) -> {frames:[Float64Array], name}|{error}` (Serum .wt: 2048-sample frames + clm
  chunk; verify the format against reachable public docs in scratch — if unverifiable, degrade
  honestly with a clear error string, keep JSON+draw paths) · `avWtSnap()` · `avWtClasses()` (none
  expected — return []) · `avWtUserOscNames() -> [{value:"wt.userN", label:"USER N · name"}...]`.
- **Mip law (must match the engine's factory law):** level 0 peak-normalised to 0.95, all levels share
  the SAME gain (level-0 gain); level k keeps harmonics 1..(1024>>k) (analysis FFT -> zero bins ->
  IFFT; DC and bin > 1024 zeroed); 11 levels. Harness proves: mips of `wtSeedFrom("saw")` match the
  engine factory saw bank within 1e-9 by construction check (compare harmonic magnitudes), band
  limiting reduces HF monotonically, morph midpoint equals average, determinism.
- Harness (`cache/scratch/m1/wt/harness.mjs`): pure-function tests above + JSON round-trip + snap
  shape. Summary `WT-HARNESS: n/n PASS`. IDB paths behind typeof guards (harness runs the pure parts).

### 2.6 WT editor card — `src/av_wt_ui.js` (sa-F)

- Mounts into `#av-wt-host`. API: `avWtUiInit()` (idempotent), `avWtUiSnap()`, `avWtUiClasses()`,
  `avWtUiSync(root)`, `window.__avWtUi`.
- DOM pins: `#av-wt-canvas` (2D, 2048 px logical width; draw = sample domain) · tool row
  `#av-wt-tool` with `[data-tool]` buttons (draw · line · smooth · normalise · undo-lite) ·
  frames strip `#av-wt-frames` (add `#av-wt-frame-add`, per-frame chips `[data-frame="i"]`) ·
  morph `#av-wt-morph` (range input + `#av-wt-morph-b` select) · spectral tools
  `#av-wt-harmonics` (range 1..1024 trim) · library `#av-wt-lib` (rows `[data-lib-id]` with
  LOAD/INSTALL/DELETE buttons) · actions `#av-wt-new` · `#av-wt-import` (+ hidden file input,
  accepts .wt/.json) · `#av-wt-export` · `#av-wt-install` · `#av-wt-audition` · status `#av-wt-status`.
- INSTALL/RENAME behaviour: calls `avWtInstall` (sa-E), then `avApplyParam("osc2.type", "wt.userN")`
  (last installed slot) and — if `avSynthOscOptionsRefresh` exists — calls it (the parent adds that
  hook to av_synth.js; typeof-guard it). AUDITION: install to a free slot + short note via `avNoteDown`/
  `avNoteUp` (if the bus exists; typeof-guard).
- Drawing: pointer events on the canvas — stroke sets frame samples (normalise on commit); redraw on
  frame switch. All canvas work inside guarded functions; no DOM at top level. `avWtUiClasses()` lists
  every NEW css class emitted (the parent generates the styles block from it).

### 2.7 Rig — `verify/cdp_m1.mjs` (sa-G, write-only)

Port the launch block from `verify/cdp_s5.mjs` (file:// target wait, 1440×900 metrics override,
`--autoplay-policy=no-user-gesture-required`, temp profile + cleanup, one browser, explicit exit,
`EXPECT_SHA = null` until the parent pins it). Check groups (≈32-34 checks + the sha leg):

1. **Cards**: `#av-fm` host mounted — 6 op tabs, active panel, `#av-fm-algo` select wired, fm.* knobs
   bound (`data-knob-bound="1"`), algo view painted; `#av-wt` host mounted — canvas present, frame
   controls + library + actions present, `window.__avWtUi` object; both `window.__avFmUi`/`__avWt`.
2. **FM engine**: `avApplyParam("engine.kind","fm")` accepted (select reflects); hold a note via
   `avNoteDown` (or the rig's established note path) + OWN AnalyserNode on `avMasterNodes()` (the
   witness law) → signal present; `fm.op2.level` 0→0.8 changes the spectrum (compare bin energy
   deltas); `fm.algo` 0→3 changes the spectrum; note-off → signal decays to silence.
3. **FLAVOUR**: `fx.aw.on`=1 + mode "tape" (amount 0.7) → spectrum delta vs bypass (analyser);
   `avFxSnap()` reflects 6-7 strips; engine `stats()` fx list includes "aw".
4. **CONV**: `fx.conv.on`=1 → note + tail: RMS after note-off above the bypass tail; mode sweep
   accepted (no throw, receipt true); synthetic delta impulse via `avEngineConv(...)` → true; after
   load, `fx.conv.mode`="user" produces signal; `#av-fx-conv-import` button exists.
5. **WT**: `avWtNew` + seed saw + `avWtInstall` → receipt ok; `stats().uwt >= 1`; set
   `osc2.type="wt.user0"` + osc2 level up → signal; spectrum differs from `wt.sine` (seeded saw has
   more harmonics); UI: canvas interaction smoke (dispatch pointer stroke → frame changed).
6. **Freeze leg** (sha=pinned) — passes when EXPECT_SHA is set and matches.

Rig must parse `?avtest=1` proofs only (never console text), assert its own fixture shapes honestly,
and end with `M1-RIG-RESULT: n/N` + a screenshot `renders/m1-suite.png`.

## §3 Gates

- Child harnesses ALL PASS (re-run by the parent on the landed bytes).
- Build: `python3 build.py` green with the new worklet sha (FM/AW/CONV join the worklet concat).
- Smoke on the frozen build: updated checks (7 kinds · 7 fx strips · #av-fm + #av-wt cards; 24 → ≥26).
- Rig cdp_m1 first run → parent triage (SPEC fixes vs app fixes) → pins → pinned run.
- FULL battery re-pin (cdp_m1 joins as suite 19; every EXPECT_SHA → new sha): smoke · studio ·
  sessions · comp · mix · feel · keys · midi · sample · rec · fx · seq · store · bounce · deck · s4 ·
  s5 · code · m1.
- PERF GATE: bench (knee vs 96/128 record + monotone) · stress ×2 · attribution with the old-bytes
  control if raw counts jump (adjacent-window control on `7accc9fd`). All new fx default OFF +
  FM not the default kind → engine path for existing patches unchanged (worklet sha WILL change by
  design — av_fm/av_fx_aw/av_fx_conv join the concat; the bench knee is the gate, not the sha).
- Close: commits (integration+battery, then gate+docs+addendum 32), README status, docs/05 §2.7 status,
  mnemosyne canonical.

## §4 Parent integration recipe (counted-assert script `cache/scratch/m1/integrate/_m1_integrate.py`)

Sites (each with an exact-occurrence assert; the script captures the actual anchor strings at authoring
time and refuses to run before every child artifact exists):

1. `build.py`: add `_fm_src` (after `_samp_src`), `_fxaw_src` + `_fxconv_src` (after `_fxdy_src`);
   concat order: `_lad + _dsp + _acid + _str + _drum + _grain + _samp + _fm + _fxv + _fxd + _fxm +
   _fxdr + _fxdy + _fxaw + _fxconv + _umod + _proc`; assert line + "AVFM"/"AVFXAW"/"AVFXCONV"
   presence; header comment update.
2. `build.py` js_parts: `av_fm.js` after `av_sampler.js`; `av_fx_aw.js` + `av_fx_conv.js` after
   `av_fx_dyn.js`; `av_fm_ui.js` after `av_synth.js`; `av_wt.js` + `av_wt_ui.js` after `av_sample.js`.
3. `src/av_dsp.js`:
   - registerKind validation `i >= 1 && i <= 5` → `<= 6` (ONE site, line ~84 — also fix the
     duplicate-shape `registerFx` remains untouched).
   - `KIND_MODS` init loops ×2 (`kk <= 5` → `kk <= 6`) + setParam prefix dispatch loop ×1.
   - `kindModOf`: `id >= 1 && id <= 5` → `<= 6`.
   - `engine.kind` mapEnum list + `"fm"`.
   - `osc2.type` setParam: on mapEnum fail, `wt.user<N>` 0..15 → `eng.osc2Type = 5 + N`.
   - osc2 read path (line ~858): resolver `(osc2Type < 5) ? factory : eng.userWt[osc2Type-5]` with
     factory fallback.
   - `eng` literal: `userWt: []`.
   - `setUserWt(eng, slot, name, frames)` (parity with setSample; validate 11 × 2048 F64) +
     `setConvImpulse(eng, id, name, rate, ch1, ch2)` (scan eng.fx for PREFIX "conv" →
     `mod.loadImpulse`); export both on the AVDSP object.
   - `FX_PREFIX` → `["drive", "aw", "mod", "delay", "verb", "conv", "dyn"]`; `FX_WET` →
     `[1, 1, 0, 0, 1, 1, 1]`.
   - `stats()` += `uwt: (eng.userWt || []).filter(Boolean).length` and `fxChain: eng.fx.map(...).join(" ")`.
4. `src/av_voiceproc.js`: two branches — `{t:'wtab'}` → `AVDSP.setUserWt(eng, m.slot, m.name, m.frames)`;
   `{t:'conv'}` → `AVDSP.setConvImpulse(eng, m.id, m.name, m.rate, m.ch1, m.ch2)`.
5. `src/av_engine.js`: `avEngineWt(slot, name, frames)` + `avEngineConv(id, name, rate, ch1, ch2)`
   senders (mirror avEngineSample: worklet postMessage w/ transfer lists; SPN direct); export on the
   facade object.
6. `src/av_synth.js`: `AV_SYNTH_KINDS` + `"fm"`; ENGINE aria text + " · fm"; fm panel
   (`avSynthPanelHTML("fm", kind === "fm", <note to the FM card>)` included in the return string);
   `osc2.type` options → `avSynthWtOptions()` helper (base + `avWtUserOscNames()` guarded);
   `avSynthOscOptionsRefresh()` (mirror avSynthKindOptionsRefresh; called by av_wt_ui + at card init).
7. `src/av_fx.js`: two AV_FX_MODULES entries (order aw after drive, conv after verb) + generic
   `button` support in a strip (id + label + data attr) + the IMPORT IR handler (hidden file input →
   `decodeAudioData` → OfflineAudioContext resample to eng sr → `avEngineConv(0, name, sr, ch1, ch2)`
   → `avApplyParam("fx.conv.mode","user")` → status text). Update the card caption line.
8. `src/body.html`: `#av-fm` card + `#av-fm-host` after `#av-synth`; `#av-wt` card + `#av-wt-host`
   after `#av-sample`; `#av-fx` placeholder text 5 → 7 modules + the new chain.
9. `styles.css`: append the M1 block generated from `avFmUiClasses()` + `avWtUiClasses()` +
   new fx strip bits (button) — coverage-checked against the runtime class lists.
10. `app_core.js`: `ANVIL.version` 1.4.0 · phase `"M1 · fm · flavours · conv · wavetable"` + guarded
    boots `avFmUiInit()` / `avWtUiInit()`.
11. `verify/cdp_smoke.mjs`: kinds check → seven incl. `fm`; fx rack check → `drive,aw,mod,delay,verb,
    conv,dyn` · 7 strips · 27 knobs · 7 toggles · 6 selects + `#av-fx-conv-import`; NEW checks:
    `#av-fm` card mounted/wired + `#av-wt` card mounted/wired (+ APIs). Update count texts.

## §5 Watch-outs

- FX wet conventions differ per module by design (drive/verb/dyn wet; mod/delay final) — aw/conv are
  WET modules (§2.3/§2.4): the parent blend `dry*(1-mix)+wet*mix` is applied by the engine, never by
  the module. Double-blending is the classic bug — the harness null law (mix=0 bit-identical) catches it.
- In-worklet: `performance` does NOT exist; use `Date.now()`; no fetch/TextDecoder — IR factory
  generation must be self-contained math.
- WT mips must reuse the EXACT gain law (level-0 normalise, shared gain) or the alias character drifts.
- `avWtUserOscNames()` value strings must be exactly `wt.user0`..`wt.user15` (the av_dsp parser pins this).
- The engine `kind` semantics: FM is kind 6; the drum split path (`kind === 3`) is untouched.
- Rig: audio witnesses install their OWN AnalyserNode on the master tap (panel/UI reads are not
  witnesses); fresh page default pattern is EMPTY — any witness needing notes plays via avNoteDown.
- Children: write the file to disk FIRST (complete), then iterate; report shape per §6; never touch
  shared files; scratch only under the child's `cache/scratch/m1/<name>/`.

## §6 Report shape (every child)

Plain lists, no brace-template blocks: files written (path + lines + `node --check` result); harness
summary line + where the log lives; every interface pinned in §2 that was NOT met as stated (with the
deviation and why); anything left undetermined; no success claims without the re-run output quoted.

## §7 Dispatch map

sa-A av_fm.js · sa-B av_fm_ui.js · sa-C av_fx_aw.js · sa-D av_fx_conv.js · sa-E av_wt.js ·
sa-F av_wt_ui.js · sa-G verify/cdp_m1.mjs — briefs point at §2 rows; children read the living
templates listed atop this file. Parent: integration script (§4) + freeze + rig triage + battery +
perf gate + close records.
