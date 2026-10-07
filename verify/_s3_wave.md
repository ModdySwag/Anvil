# Anvil S3 wave — MIX & MASTER: per-track FX + send rails (#69) · bus glue · master chain (#70) · auto-mix (#49) · A/B reference · export dither (2026-10-07)

Trigger: S2.1 TAKES & COMPING closed (`0f79ebc2`; addendum 27). This wave completes the `docs/08`
§1 row **S3 · MIX & MASTER**: "per-track FX + send rails (#69), bus glue, master chain (#70),
auto-mix (#49) with LUFS/true-peak targets, A/B reference, export dither". Acceptance context
(`docs/08` §1): "a full song — record vocals over a groove, comp a take, mix, master, deliver stems".
Next after this: S4 deliver extras (FSA #77, share card #18, video #83) / deck (#15) / popout
keyboard / CODE (#81) / walkthrough-help.

## 0. Platform notes (no probe required)

Every ingredient is already proven: offline renders (av_bounce, barrier law), takes + comps as
in-memory Float32 channel arrays, and the four FX modules (`AVFXVERB` · `AVFXDELAY` · `AVFXDRIVE` ·
`AVFXDYN`) are worklet-safe **scalar** processors whose full interface is
`{ VERSION, PREFIX, createState(), reset(st), bindEngine(st, eng), setParam(st, path, v),
process(st, xL, xR) -> (result in st.oL/st.oR) }`. The SAME module texts ship page-side in
`js_parts` (build.py), so the mix engine instantiates its **own** module states directly — the
live engine/worklet chain is never touched. The mix is an **offline page-side render** (chunked
main-thread JS over module states); it is auditioned by playing the rendered mixdown (WAV blob).
Live per-track monitoring is out of scope v1 (documented — the S1 monitor path covers recording).

No rebuild of the worklet source happens this wave: `AV_WORKLET_SHA` must stay `6e66274e…`; the
perf gate re-records it as evidence that the engine is untouched.

## 1. Scope & file ownership (ONE writer per file)

| child | owns (write) | scratch |
|---|---|---|
| sa-A | `src/av_mix.js` — the mix engine (track model · source resolution · per-track chain + duck · sends · bus glue · master chain · offline render · LUFS normalize · dither · export) | `cache/scratch/s3/mix/` |
| sa-B | `src/av_loud.js` — the loudness suite (BS.1770-4 LUFS · true-peak · auto-gain table · normalize gain · compare) | `cache/scratch/s3/loud/` |
| sa-C | `src/av_mix_ui.js` — the MIX card (tracks · sends · glue · master · auto-mix · meters · A/B · export) | `cache/scratch/s3/ui/` |
| sa-D | `verify/cdp_mix.mjs` — WRITE-ONLY rig (parent runs it) | `cache/scratch/s3/rig/` |

Children never touch shared files (`build.py`, `src/body.html`, `src/styles.css`, `src/app_core.js`,
`verify/cdp_smoke.mjs`, any other `src/*` or `verify/*`) and never run the build, browsers, suites
or git. Each self-verifies with a node harness in its scratch. **Write-first rule:** the complete
file goes to disk FIRST, then iterate — partial progress must exist on disk at all times.

READ-ONLY references (all in-repo):
- `src/av_fx_verb.js` / `av_fx_delay.js` / `av_fx_drive.js` / `av_fx_dyn.js` — the module interface,
  blend conventions, param paths + defaults (the mix maps onto these names, §2.2).
- `src/av_takes.js` — take model (`{ id, name, frames, rate, channels, lap, partial, offsetFrames,
  seconds, data:[Float32Array,…] }`); `avTakesList()` metas carry NO `data` — reach the store object
  `avTakes.takes` behind typeof+try guards (the av_comp.js pattern, its lines 171–190).
- `src/av_comp.js` — `avCompRender(id)` returns the rendered channel `data` + `rate`; `avCompList()`.
- `src/av_bounce.js` — `avBounce(opts)` → `{ ok, sr, frames, seconds, parts[], master:{l,r},
  warnings, refused, stats }`; the mirror-sourced schedule + delivery-barrier laws.
- `src/av_wavio.js` — `avWavEncode({ l, r, sr, bits, dither })` (16/24/"32f"; `dither:"auto"` =
  on for 16, off otherwise; TPDF convention at L85–88 — the mix's seeded dither MIRRORS that
  convention) + `avWavInfo`.
- `src/av_studio_ui.js` / `src/av_comp_ui.js` — the card house style (host mount, `av…Classes()`
  list, status line, honest degraded notes) + the anchor-blob export technique (in av_comp_ui).
- `src/app_core.js` — the guarded-boot + version idioms.
- `verify/cdp_studio.mjs` — the rig launch skeleton (fake-media flags included; the fake device is
  a BEEP TRAIN — assert pips, never continuous audio) + the takes/comp flows.
- `verify/cdp_comp.mjs` — the newest rig conventions (expected() helper, cleanup, screenshot,
  freeze before===after).
- `cache/scratch/p3/drivedyn/drivedyn_node.mjs` — the node-harness load pattern (module texts
  concatenated into ONE `new Function` scope, then exercised).

## 2. Pinned interfaces

### 2.1 `av_loud.js` (sa-B) — the loudness suite (PURE; node-loadable; no DOM reach; no init)

```js
avLoudLufs(l, r, sr)          -> { ok, lufs, kept, total, rate }   // integrated, BS.1770-4
avLoudMomentary(l, r, sr, atS)-> { ok, lufs }                      // 400 ms window; atS optional (default: last full window)
avLoudShortTerm(l, r, sr, atS)-> { ok, lufs }                      // 3 s window; same atS law
avLoudTruePeak(l, r, sr)      -> { ok, dbtp, peakDb }              // 4x oversampled true peak
avLoudAnalyze(l, r, sr)       -> { ok, lufs, dbtp, peakDb, rms, seconds, rate }
avLoudAutoGains(rows, opts)   -> { ok, target, rows:[{ id, lufs, deltaDb }] }
avLoudNormalizeGain(lufs, dbtp, target, ceiling) -> { ok, gainDb, limited }
avLoudCompare(a, b)           -> { ok, a:{lufs,dbtp}, b:{lufs,dbtp}, gainToMatchDb }
window.__avLoud = { version, lufs, momentary, short, tp, analyze, autoGains, normalizeGain, compare }
```

Laws:
1. **Gating (BS.1770-4):** K-weighting (two biquads), 400 ms blocks, 100 ms step, absolute gate
   −70 LU, relative gate −10 LU. Coefficients: 48 kHz values must match the standard (record the
   comparison in the harness); other rates derived from the same design (document the derivation).
   `r` may be null → single-channel mode. Silence / no gated blocks → `lufs: null` (NEVER NaN,
   NEVER −Infinity leaking out of JSON — null + honest `kept: 0`).
2. **True peak:** 4× oversampling via a clean-room polyphase FIR (own design; document taps +
   window). Always `dbtp >= peakDb`; `peakDb` = sample peak in dBFS; empty buffers → both null.
3. **ANCHOR LAWS** (harness + rig; record exact measured values in the child report):
   - 997 Hz sine, amplitude 0.1, stereo L=R → **lufs ≈ −23.0** (tolerance ±0.2 LU; the derivation:
     −0.691 + 10·log10(ms) with the K gain at ~1 kHz ≈ +0.7 dB ⇒ expected ≈ −23.04).
   - Amplitude doubling (0.1 → 0.2) → **+6.02 ± 0.05 LU**; stereo dup vs single channel → **+3.01 ± 0.05**.
   - TP: 997 Hz amp 0.5 → **−6.02 ± 0.15 dBTP**; the 12 kHz straddle case (4 samples/cycle, phase
     chosen so samples hit ±45°) amp 1.0 → **dBTP ≥ −0.2**; `dbtp ≥ peakDb` in every fixture.
4. Deterministic, allocation-light, never throws; unknown args → honest refusals.

### 2.2 `av_mix.js` (sa-A) — the mix engine (pure core + guarded browser reach)

```js
avMixInit()                     -> boolean        // idempotent; no DOM; state created here
avMixState()                    -> { count, rev, tracks:[meta], params, ref, lastRender, lastExport, lastError }
avMixList()                     -> [trackMeta]
avMixAddTrack(opts)             -> { ok, track }  // opts { name?, source, gainDb, pan, mute, solo, sends:{a,b}, duck:{src,depthDb}, fx }
avMixSetTrack(id, patch)        -> { ok, track, refused:[] }      // partial patch; unknown keys -> refused (never throw)
avMixRemoveTrack(id)            -> boolean
avMixClear()                    -> boolean
avMixSetParam(path, value)      -> { ok, path, value }            // the ONLY master/send param funnel (§2.2 paths)
avMixParams()                   -> { ... }                        // flat copy
avMixRender(opts)               -> Promise<renderReceipt>
avMixExport(opts)               -> Promise<exportReceipt>
avMixAutoBalance(opts)          -> { ok, target, rows:[{ id, name, lufs, deltaDb, gainDb, applied }], ms }
avMixSetRef(ref)                -> { ok, ref: { kind, seconds } | null }
avMixCompare()                  -> { ok, mix:{lufs,dbtp}, ref:{lufs,dbtp}, gainToMatchDb }
avMixClasses()                  -> []
window.__avMix = { version, init, state, list, add, set, remove, clear, setParam, params, render,
                   export, autoBalance, setRef, compare,
                   pure: { dbToLin, faderGain(db), balanceGains(pan), duckGain(depthDb, env01),
                           envFollower(src, sr), ditherApply(l, r, bits, mode, seed) } }
```

**Track model:** `{ id:'m1'…, name, source, gainDb (−60..+24, def 0), pan (−1..1, def 0),
mute, solo, sends:{a:0,b:0}, duck:{src:null|trackId, depthDb:0..24}, fx:{…}, rendered:{frames}|null }`.

**Source types (pinned):**
- `{ type:'take', id }` — the take's `data` channels + `rate`; latency comp = **advance by
  `take.offsetFrames`** (drop the leading offsetFrames frames, clamped 0..frames).
- `{ type:'comp', id }` — `avCompRender(id)` → its `data` + `rate`; latency comp 0 (documented).
- `{ type:'engine', mask:[bool×4], loops, tailS }` — `avBounce` guarded; includeParts:false,
  includeMaster:true; master `{l,r}` + sr. Missing avBounce → honest refusal (skipped, reported).
- `{ type:'buffers', l, r?, sr, offsetFrames? }` — pre-rendered (rig fixtures + future imports);
  `r` absent = mono duplicated (house convention).

**Chain order (per track, pinned):** latency advance → fader gain → insert FX (**drive → dyn**,
each blended per its module convention; a disabled state is not called) → **duck multiplier**
(post-FX, pre-pan; scales the contribution incl. sends) → **balance pan** → contribute
`main += x`, `sendA += a·x`, `sendB += b·x` per channel (sends = post-fader taps of the final
contribution).
- Fader: `dbToLin(gainDb)`; `gainDb <= −60` ⇒ gain 0 **exactly**.
- Balance law (pinned, linear balance): `gL = pan > 0 ? (1−pan) : 1`, `gR = pan < 0 ? (1+pan) : 1`
  — center = exact unity both channels; hard pan = one channel exactly 0.
- Audible law: `(anySolo ? solo : true) && !mute`.
- Duck: envelope source = the `duck.src` track's compensated source × its **fader gain (pre-FX)**;
  peak follower `AV_MIX_DUCK_ATT 0.005 s` / `AV_MIX_DUCK_REL 0.15 s`; `env01 = clamp(env/0.5, 0, 1)`;
  `duckGain = 10^(−(depthDb·env01)/20)`. Envelopes precomputed once per referenced source per
  render. Self-reference refused (honest, counted).

**Buses (pinned):** send A → an `AVFXVERB` state run **wet-only** (`on:1, mix:1`); send B → an
`AVFXDELAY` state (`on:1, mix:1` — module-final convention ⇒ pure delayed signal). Bus output ×
return gain → main bus. Paths + defaults:
- `send.A.return` 0.35 · `send.A.verb.mode` "plate" · `.size` 0.5 · `.decay` 0.55 · `.damp` 0.3 ·
  `.predelay` 0.01 (0..0.15)
- `send.B.return` 0.30 · `send.B.delay.time` 0.3 · `.feedback` 0.45 · `.pingpong` 0.5 ·
  `.spread` 0.15 · `.duck` 0 · `.div` "free" · `.bpm` 120

**Bus glue (pinned):** main bus → an `AVFXDYN` "glue" state. Paths: `glue.on` 0 · `glue.thresh`
−18 · `glue.ratio` 2 · `glue.att` 0.03 · `glue.rel` 0.3 · `glue.makeup` 0. Off ⇒ skipped.

**Master chain (pinned order):** drive (tape/console) → dyn (EQ → comp → limiter → soft-clip):
- `master.drive.on` 0 · `.mode` "sat" · `.amount` 0 · `.tone` 0.5
- `master.dyn.on` 0 · `.eqLo/eqMid/eqHi` 0 · `.comp.thresh` −6 · `.comp.ratio` 2 ·
  `.comp.att` 0.01 · `.comp.rel` 0.25 · `.comp.makeup` 0 · `.lim.ceiling` −1 · `.mix` 1
- **Normalize (post-chain):** `master.norm.on` 0 · `.target` −14 (⊂ {−14, −16, −23}) · `.ceiling`
  −1.0 (−3..0). When on: `gainDb = min(target − lufs, ceiling − dbtp)` (via av_loud, guarded; if
  av_loud absent → skipped + warning) — applied to the final output; `norm.limited` records the
  TP-bound case honestly.

**Render (`avMixRender(opts)`):** opts `{ seconds?, tailS=1.0 (0..10), sr=48000 (48000|44100),
progress? }`.
- Length: `frames = ceil(max trackEnd + tailS·sr)`, floor 0.25 s; `trackEnd` = max over tracks of
  `max(0, srcFrames − offsetFrames)` (engine: bounce frames). Cap `AV_MIX_MAX_SECONDS 300` → refuse
  above honestly.
- Rate: sources at other rates get linear-interpolated resample + an honest warning (v1 quality).
- **Fresh states per render** (createState + bindEngine({sr}) + setParam from the tree) — no
  cross-render contamination; allocation at render time only; output = FRESH Float32Arrays.
- Chunked: process in `AV_MIX_CHUNK_FRAMES 131072` chunks, yield (`await`) between chunks,
  `opts.progress(fraction)` best-effort.
- **Deterministic:** zero randomness in the render path (dither lives at export only) → two
  renders are byte-identical (l/r incl. lengths).
- Receipt: `{ ok, frames, rate, l, r, lufs, dbtp, peak, rms, clipped, norm:{on,target,ceiling,
  gainDb,limited}|null, warnings:[], refused:[], ms, at, rev }`.

**Export (`avMixExport(opts)`):** opts `{ bits=24 (16|24|"32f"), dither="auto" ("off"|"tpdf"|
"shaped"|"auto"), seed=AV_MIX_DITHER_SEED, name? }`.
- Uses `lastRender` only; when none or stale (`render.rev !== mix.rev`) → **honest refusal**
  ("render the mixdown first / render stale"). Mutations bump `rev`; `setRef/compare` do not.
- Dither: `pure.ditherApply(l, r, bits, mode, seed)` returns NEW arrays with dither added in
  float domain at LSB scale (`2^(bits−1)`; mirrors the av_wavio TPDF convention but with a SEEDED
  xorshift32; `shaped` = 2nd-order error feedback; `"auto"` = tpdf for 16, off for 24/32f; 32f
  ignores dither). Then `avWavEncode(..., dither:false)` — the encoder stays untouched.
- Receipt: `{ ok, name, bytes, blob, url, wavInfo, bits, dither:{ mode, seed, applied }, frames }`;
  name default `anvil_mixdown.wav`.

**Auto-balance (`avMixAutoBalance(opts)`):** opts `{ target=−18, dry=false }`. Per audible track:
measure the compensated source's integrated LUFS (av_loud); `deltaDb = clamp(target − lufs, −24,
+24)`; applied `gainDb = clamp(old + delta, −60, +24)`; silent material (lufs null) skipped.
Rows + `applied` reported.

**A/B reference (`avMixSetRef` / `avMixCompare`):** ref = `{l,r,sr}` arrays | `{take:id}` |
`{comp:id}` | null. Compare: `{ mix:{lufs,dbtp}, ref:{lufs,dbtp}, gainToMatchDb = mixLufs − refLufs }`
(the gain to apply to the REFERENCE to match the mix).

### 2.3 `av_mix_ui.js` (sa-C) — the MIX card

```js
avMixUiInit() -> boolean    // mounts into #av-mix-host (absent -> false, no throw; idempotent; dataset marker avMixUiWired='1')
avMixUiClasses() -> string[] · avMixUiSync() -> boolean · avMixUiSnap() -> {...} · window.__avMixUi
```

Card (class prefix `av-mix-*`, reuse av-btn/av-note/av-dim/av-select; event delegation; house style):
- **TRACKS** — add-track picker (TAKES from avTakesList · COMPS from avCompList · ENGINE: mask
  checkboxes + loops + tail) + ADD; per-track row: name · source badge · GAIN/PAN/SEND-A/SEND-B
  knobs (av-knob; commit via avMixSetTrack) · MUTE/SOLO toggles · DUCK select (none | track list) +
  depth · REMOVE · FX expander (DRIVE on + amount; DYN on + thresh + ratio).
- **SENDS** — A: RETURN + mode select + decay; B: RETURN + time + feedback.
- **GLUE** — on + thresh + ratio. **MASTER** — drive on + amount; dyn on + eqLo/eqHi + comp
  thresh/ratio + lim ceiling; NORM on + target select (−14/−16/−23) + ceiling.
- **METERS** — last render: LUFS · dBTP · peak (+ norm applied/limited note).
- **RENDER / EXPORT** — UPDATE MIXDOWN (avMixRender with progress); EXPORT WAV (bits select
  16/24/32f + dither select auto/off/tpdf/shaped); status line; export refusal (stale) surfaced
  honestly; export uses the anchor-blob technique.
- **AUTO-MIX** — target select (default −18) + button → avMixAutoBalance → applies + shows the
  table. **A/B** — LOAD REFERENCE (file input → decodeAudioData → avMixSetRef({l,r,sr})); COMPARE
  (readout gainToMatch/deltas); play A/B toggle (one audio element switching mix vs reference blob,
  the reference gain applied via 10^(gainToMatchDb/20) — document the gain technique used).
- Honest degraded notes when av_mix/av_loud are absent; light signature-gated poll (~1.5 s max);
  never starts recording; never touches the engine.

### 2.4 Rig `verify/cdp_mix.mjs` (sa-D writes; parent runs)

Launch skeleton VERBATIM from `cdp_studio.mjs` (fake-media flags INCLUDED); `EXPECT_SHA` null until
pinned. Proofs:
1. boot + card mounted (#av-mix + #av-mix-host · root class · wired marker · key controls present).
2. sources: two takes via the avTakes path (fake beeps, distinct lengths), one comp via
   avCompCreate/avCompSetSegment/avCompRender, the default engine pattern.
3. add take-A + comp + engine tracks → render (loops 1, tail 0.5) → ok; frames > 0; lufs/dbtp
   finite; deterministic (second render byte-identical l/r).
4. gain law ('buffers' fixture): soloed amp-0.5 sine — gainDb 0 vs −6 → rms ratio 0.5012 ±1.5%;
   mute → exact silence (≤1e-7); solo semantics hold (solo B ⇒ A silent).
5. pan law exact: hard left ⇒ right channel |x| ≤ 1e-12; center ⇒ both channels carry the source
   (≤1e-7 abs vs source); hard right mirrored.
6. per-track FX: drive on/amount 1 changes the render (rms ratio ≠ 1) and stays deterministic;
   dyn on (thresh −30, ratio 10) → peak ≤ off-peak (+1e-6) and rms ratio < 1 on a hot fixture.
7. sends: sendA 0.8 + verb decay 0.7 → post-source tail window energy ≥ 100× the dry tail; sendB
   0.8 + delay time 0.25 → post-source echo energy present (window rms > dry).
8. bus glue: on/thresh −30/ratio 8 on a two-level fixture → quiet-half rms ratio (on/off) ≥ 1.05.
9. master limiter: hot fixture (amp 1.5 sine) + master dyn on, ceiling −1 → max|out| ≤ 0.910 + 5e-3.
10. normalize: target −14, ceiling −1 → measured lufs ≈ −14 ±0.6 OR (limited case) lufs < −14 with
    `norm.limited` true and dbtp ≤ −0.95; deterministic.
11. LUFS anchors via av_loud (§2.1 law 3): −23.0 ±0.2; doubling +6.02 ±0.05; single vs stereo +3.01
    ±0.05; silence → null (never NaN).
12. TP anchors: amp 0.5 → −6.02 ±0.15; 12 kHz straddle ≥ −0.2; dbtp ≥ peak in all fixtures.
13. auto-balance: two fixtures 20 dB apart → deltas differ by ≈ 20 dB (±1); applied gainDb set;
    clamps ±24.
14. A/B: ref = mix × 0.5 → gainToMatchDb ≈ +6.02 ±0.15.
15. dither: 16-bit off vs tpdf differ; |diff| ≤ 4 LSB; tpdf vs shaped differ; same seed ⇒ identical
    bytes; different seed ⇒ different; 32f forces off; receipt carries {mode, seed, applied}.
16. export: wavInfo 16-bit (when chosen) /48k/2ch; frames match; blob/url; non-silent (peak > 0.05);
    stale-refusal (mutate a track → export refuses until re-render).
17. e2e: engine + take mix → render contains both (mute one → energy differs).
18. zero page errors · screenshot `renders/s3-mix-suite.png` · freeze sha256 before === after ·
    cleanup (tracks cleared, takes/comps deleted, ref cleared, transport stopped, input disabled).

## 3. Laws (wave-specific)

1. One writer per file; 'use strict'; ONE namespace per file (`avMix*`/`AV_MIX_*` · `avLoud*`/
   `AV_LOUD_*` · `avMixUi*`/`AV_MIX_UI_*`); the single build scope is shared — guard every reach
   into sibling modules (`typeof` + try).
2. Node-loadable (no DOM/browser reach at load; the guarded `typeof window` probe at the end);
   NEVER throw (honest refusals, counted skips); no console noise; forward-slash paths in scripts.
3. **FX reuse law:** instantiate module states directly (`.createState()` · `.bindEngine(st,{sr})` ·
   `.setParam(st, "fx.<mod>.*", v)` · `.process(st, xL, xR)`); blend per convention — drive/verb/dyn
   write WET (parent `dry*(1−mix)+wet*mix`; mix 1 = wet only), delay writes its FINAL mix (copy).
   Disabled states are not called (fast path; identical to the modules' own off passthrough).
4. Render determinism (no randomness in render), fresh states per render, chunked with yields,
   fresh output arrays only.
5. Memory: output ≤ 300 s (refuse above); per-render states/arrays freed after (no module-state
   leakage across renders).
6. The mix owns its param tree; the ONLY funnel = `avMixSetParam` / `avMixSetTrack`; the card
   never mutates state directly.
7. av_loud is pure: anchors pinned (§2.1); `lufs/dbtp` null (never NaN) on empty/silent input.
8. Children self-verify with node harnesses (module texts loaded into one `new Function` scope —
   the p3/p4 harness pattern); the browser rig is the parent's gate.

## 4. Parent integration (after children land)

ONE counted-assert script (`cache/scratch/s3/integrate/_s3_integrate.py`): build.py js_parts
(`av_loud` → `av_mix` → `av_mix_ui` after `av_comp_ui`, before `av_synth`) · body `#av-mix` card +
`#av-mix-host` after `#av-comp` (+ hero/footer copy) · styles block (child class lists, coverage
via the css_coverage.mjs pattern) · app_core **1.0.0 "S3 · mix & master"** + guarded
`avMixInit()`/`avMixUiInit()` boots + log fields · `cdp_smoke.mjs` mix-card check (**→ 21**).
Then: rebuild → node re-runs + `cdp_mix.mjs` first run (pin EXPECT_SHA; re-run) → FULL battery
(ALL 14 pinned suites incl. studio/sessions/comp + the new mix rig; re-pin every freeze file) →
PERF GATE (bench + stress ×2, hidden-detached + marker polling; if the machine is loaded → record
raw + note; worklet sha must read `6e66274e…`) → commits + addendum 28 + README + mnemosyne.

## 5. Watch items

- Takes reach: `avTakes.takes` store object (metas have NO data) — typeof+try, read-only.
- Fake device = beep train: the takes/comp/engine e2e legs assert pips; exact math (gain/pan/duck/
  dither/anchors) rides 'buffers' fixtures.
- offsetFrames compensation law (advance = drop leading frames, clamp) — assert it explicitly in
  one check (take source vs its raw data).
- Resample: linear in v1; warn honestly when triggered.
- Export stale-refusal: UI keeps the RENDER → EXPORT order; stale export is refused, never silent.
- Normalize + ceiling: the TP-limited case is honest (`limited`), never over-target.
- LUFS null (never NaN) for silence; JSON-safe receipt.
- Perf: with every FX off the render is a cheap gain/sum loop; enabled modules cost per-sample —
  keep chunks + progress honest for long songs.

Carried: quiet-window bench re-run (S2 gate ran loaded; A/B-attributed; re-run launched 2026-10-07
~22:07) · P·2 minBLEP pass · P4 follow-ups (fill control wiring, chains/scenes undo checkpoints,
acid accent-flag decision) · PERFECT TUNINGS (tuning engine) · S4 deliver extras · deck (#15) ·
popout keyboard · CODE (#81) · walkthrough/help (#20/#45/#80) · max modules · platform (share/cloud/
PWA/FSA/bridges/video) · P7 polish + deploy + owner pass. Resume phrase: **"continue anvil"**.
