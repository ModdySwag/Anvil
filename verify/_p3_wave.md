# Anvil P3 — FX rack + mod matrix + granular + sampler: wave contract (2026-10-07)

Trigger: golden build continues (P2 closed green on 7ddfedf7). Deliverable per docs/03 §2.1/§2.3/§2.4
+ §6 P3 + docs/05 §2.7–2.10: a ≥12-module FX rack (plate/FDN/Freeverb reverb, delay, chorus/
flanger/phaser, drive/fold/crush, EQ, compressor, limiter, soft-clip) ALL inside the mixer worklet ·
a per-voice mod matrix (≥32 slots, 8 macros) · the granular engine · the sampler voice · the rack +
matrix + panels UI.

Gates (wave close): FX battery (new rig) green · mod accuracy harness green · grain timing + budget
harness green · sampler harness green · P2 battery re-run green on frozen bytes · null/bypass checks
(a bypassed chain is bit-identical) · PERF GATE (bench + stress) · committed records.

## 0. Evidence first

READ: `verify/_p2_wave.md` (the kind pattern to MIRROR for FX registration — §2.1/§2.2), `src/av_dsp.js`
(v947 + P2 integration; study `render()` + `voiceFrame` + `recomputeFilter` + `setParam` +
`create`), `src/av_voiceproc.js` (message protocol), `src/av_engine.js` (facade — postMessage
structured-clone arrays), docs/03 §2.1 (granular/sampler), §2.3 (mod matrix), §2.4 (FX rack — the
module list + math hints), `src/av_synth.js` (panels idiom), `src/av_sample.js` (the P2 sample
store). Laws carried from P2 remain (worklet-safe, alloc-free render, monomorphic voices, one
writer per file, children never touch shared files).

## 1. File scope & ownership

| file | owner | notes |
|---|---|---|
| `src/av_fx_verb.js` | A | NEW worklet-safe: Dattorro plate (flagship) + FDN + Freeverb, mode-switched |
| `src/av_fx_delay.js` | B | NEW: stereo delay (fractional+allpass interp, ping-pong cross-feedback, ducking) |
| `src/av_fx_mod.js` | B | NEW: chorus/ensemble + flanger + phaser (one module, mode param) |
| `src/av_fx_drive.js` | C | NEW: drive/saturator (+fold) + bitcrush |
| `src/av_fx_dyn.js` | C | NEW: 3-band EQ (RBJ) + compressor + limiter + master soft-clip |
| `src/av_fx.js` | D | NEW page module: the rack card + param routing + snap; `verify/cdp_fx.mjs` (write-only) |
| `src/av_mod.js` | E | NEW page module: matrix model + macro knobs + card + serialisation |
| `src/av_grain.js` | F | NEW worklet-safe: granular voice (KIND 4) |
| `src/av_sampler.js` | F | NEW worklet-safe: sampler voice (KIND 5) + zone model |
| `src/av_sample.js` | F | EXTEND: `avSampleSendToEngine(id)` — buffer transfer to the worklet |
| `src/av_synth.js` | G | EXTEND: grain + sampler ENGINE panels (+ any drum/acid panel fixes) |
| `src/av_dsp.js`, `src/av_voiceproc.js`, `src/av_engine.js`, `src/app_core.js`, `src/body.html`, `src/styles.css`, `build.py`, `index.html`, `verify/*` (except D's rig), git | PARENT | children never touch |

Scratch per child: `cache/scratch/p3/<name>/`. Node harnesses YES (own, deterministic); browsers
NO; build.py NO; git NO.

## 2. The FX chain (pin) — everything inside the mixer worklet

### 2.1 FX module interface

Each FX module is one worklet-safe top-level (e.g. `AVFXVERB`) that self-registers at load:

`if (typeof AVDSP !== "undefined" && typeof AVDSP.registerFx === "function") AVDSP.registerFx("<prefix>", MOD);`

prefixes: `"verb" | "delay" | "mod" | "drive" | "dyn"`. Module exports:

- `VERSION` ("p3.0"), `PREFIX`.
- `createState() -> st` — preallocated (delay lines etc. allocated HERE, one state per engine).
- `reset(st)`.
- `setParam(st, path, value) -> boolean` — handles `fx.<PREFIX>.*` paths (engine-level params; `eng`
  is not needed — keep this signature; the parent passes the engine kext where relevant by giving
  the state an `eng` backref at create: optional `bindEngine(st, eng)` hook, called by the parent
  after create).
- `process(st, xL, xR)` — ONE stereo sample; result in **`st.oL` / `st.oR`** (alloc-free, no return
  value). Called every sample while the module's `on` flag is set.

Common params every module implements: `fx.<PREFIX>.on` (0|1, default 0) and `fx.<PREFIX>.mix`
(0..1). Per-module params pinned in §3. The parent owns: chain order (fixed v1: **drive → mod →
delay → verb → dyn**), bypass bookkeeping (off ⇒ bit-identical passthrough), and the final mix
(`out = dry*(1-mix) + wet*mix` per module, computed by the parent from `st.oL/oR`).

### 2.2 Chain wiring (parent)

`av_dsp.render()` post-mix: after `out = sum * eng.cOutScale`, run the enabled modules in order on
(l, r) per sample; each enabled module must leave the signal bit-identical when `mix=0` (module-side
responsibility) and the chain must be bit-identical to P2 when ALL modules are off. Registered
modules live in a preallocated `FX_CHAIN` array on the engine (`eng.fx`, states created at
`AVDSP.create` for every registered module). `AVDSP.registerFx(prefix, mod)` additive export.

## 3. FX module specs

### 3.1 `av_fx_verb.js` (A) — the flagship reverb

Modes (`fx.verb.mode` enum `"plate"|"fdn"|"freeverb"`, default plate): Dattorro plate per T5 §15
(figure-of-eight tank, modulated delays, damping/bandwidth defaults verified before hardcoding —
docs/05 §3 option 9), FDN (4-8 line housekeeping, Hadamard feedback), Freeverb (cheap mode). Params:
`size` (0..1), `decay` (0..1 ~ T60 0.3-12 s), `damp` (0..1), `predelay` (0..0.15 s), plus on/mix.
Node harness: RT60 within ±30 % of target across 0.5/2/6 s; no NaN across modes; stability at
decay=1; stereo decorrelation sanity; alloc-free; 44.1k parity spot.

### 3.2 `av_fx_delay.js` + `av_fx_mod.js` (B)

Delay: time 0.01..2 s per side (`fx.delay.time`, `fx.delay.spread` for L/R offset), feedback 0..0.95,
**cross-feedback ping-pong** (`fx.delay.pingpong` 0..1), fractional + allpass interpolation (no zipper
artifacts), ducking (`fx.delay.duck` 0..1: feedback path ducks under input), sync divisions
(`fx.delay.div` enum: `"free"|"1/1"|"1/2"|"1/4"|"1/8"|"1/8d"|"1/16"` reading `eng` bpm from kext or a
passed value — pin: the parent exposes `eng.kext.bpm` (updated from avState.bpm via param
`mod.bpm`? — simpler: `fx.delay.bpm` numeric param, parent mirrors avState.bpm into it). Harness:
echo spacing at 3 times within 1 %, feedback decay curve, ping-pong alternation, no NaN, alloc-free.
Mod: mode enum `"chorus"|"ensemble"|"flanger"|"phaser"`; rate 0.05..10 Hz, depth 0..1, feedback
−0.95..0.95 (flanger/phaser), stages 4/6/8 (phaser, default 6), mix. Harness: LFO rate spot-check via
autocorrelation of wet output; phaser notch movement; no NaN; alloc-free.

### 3.3 `av_fx_drive.js` + `av_fx_dyn.js` (C)

Drive: mode enum `"sat"|"fold"|"crush"`; `amount` 0..1 (up to +30 dB drive), `tone` (one-pole tilt),
crush bits 4..16 + downsample 1..32 when mode=crush. Harness: THD rises monotonically with amount;
fold produces bounded output (no NaN); crush aliasing behaviour documented (it aliases BY DESIGN —
report spectrum); alloc-free.
Dyn: `eq.lo/mid/hi` (RBJ shelves/peak, ±15 dB), compressor (`comp.thresh` −40..0 dBFS, `comp.ratio`
1..20, `comp.att` 0.001..0.3 s, `comp.rel` 0.05..1 s, `comp.makeup` 0..24 dB, soft knee 6 dB),
limiter (`lim.ceiling` −6..0 dBFS, 3 ms lookahead, stereo-linked), soft-clip safety ALWAYS ON at the
very end (0 dBFS ceiling). Harness: static gain-transfer within ±0.5 dB of the dB computer; limiter
catches a +6 dB burst (post-output peak ≤ ceiling + 0.1 dB); EQ shelf curves ±1 dB vs RBJ reference;
alloc-free. (The compressor's RMS/peak detector: peak with 1 ms attack smoothing — pin.)

## 4. Mod matrix (E + parent) — v1 scope

- `av_mod.js` (E, page): the model + UI card `#av-mod-host` + serialisation. Model: 8 macros
  `{name, value 0..1}` (macros are first-class knobs on the card), up to **32 slots**
  `{src, dst, amt −1..1, curve 0|1|2}`. Sources (pin): `env1, env2, lfo1, vel, key, rand,
  macro1..macro8` (17). Targets (pin, v1): `cutoff, reso, pitch, osc1.level, osc2.level, pan`
  (pan = engine-level; the rest per-voice). Curve: 0 linear, 1 exp, 2 S. UI: rows (add/remove),
  src/dst selects, amt slider (reuse av-knob small or a slider), curve select, macro knobs row;
  JSON shape for patch v2: `{macros[8], slots[{src,dst,amt,curve}]}`.
- Wire format (pin — parent implements both ends): the facade gains
  `avEngineMod(payload)` → `port.postMessage({t:"mod", macros: Float64Array(8), slots:
  Float64Array(32*4)})` (structured clone; slot order `[srcIdx, dstIdx, amt, curve]` ×32; indices per
  the pinned enums; slots all-zero = inactive). The processor copies into preallocated engine arrays
  (`eng.modMacros[8]`, `eng.modSlots[128]`) — NO audio-thread allocation. `av_mod.js` calls
  `avEngineMod` on every change and at boot once the engine is ready (replay path).
- Engine application (parent, v1): macros selectable as sources; per-voice evaluation each
  `recomputeFilter` tick: `cutoffLog2 += Σ(amt*curve(srcVal)) * scale(dst)` with pinned scales
  (cutoff ±4 oct, reso ±0.5, pitch ±12 st via computePitch, osc levels ±1, pan ±1 engine-level);
  `rand` = per-note value from the engine PRNG (add `v.randVal` in makeVoice + reinit). E's harness:
  model + serialisation + wire-payload encoder round-trip (exact Float64Array layout), UI smoke via
  static checks; the DSP accuracy is the parent's harness addition (`mod` test group in the P2-style
  node harness).

## 5. Granular (F, KIND 4) + buffer transfer

- Sample registration (worklet side, parent + F): `av_sample.js` gains
  `avSampleSendToEngine(id) -> Promise<bool>` — copies the entry's channel data into plain
  Float32Arrays and posts `{t:"sample", id, name, rate, ch1, ch2?}` (transferables) through the
  facade (`avEngineSample(id, name, rate, ch1, ch2)` — parent adds the facade + processor branch).
  The worklet stores up to **4 slots** (`eng.samples`), each ≤ 60 s per channel, allocated AT MESSAGE
  TIME (render stays alloc-free); replacing a slot frees the old arrays. Harness: round-trip a
  generated buffer through a stubbed worklet-message path.
- `av_grain.js` — granular voice, kind 4 (registerKind(4, AVGRAIN)): Hann grains 10-200 ms,
  overlap/density 1..16 grains (hard per-voice budget **24 concurrent grains**, oldest-refusal),
  position 0..1 + jitter, rate/pitch ±24 st, window randomness seeded (engine PRNG), per-grain
  fractional read over the registered buffer. Params: `grain.buf` 0..3, `grain.pos` 0..1,
  `grain.size` 0.01..0.2 s, `grain.density` 1..16, `grain.pitch` −24..24, `grain.jitter` 0..1,
  `grain.spread` 0..1 (stereo), `grain.vol` 0..1. Harness: grain-start timing within ±10 % of
  density, budget counter never exceeded, alloc-free, no NaN, determinism pair, CPU indicative
  (grains/sec at 24 budget).

## 6. Sampler (F, KIND 5)

`av_sampler.js` — sampler voice, kind 5 (registerKind(5, AVSAMPLER)): one-shot / loop
(`sampler.loop` 0|1, `sampler.loopStart/End` 0..1), root key + tune (`sampler.root` 0..127,
`sampler.tune` ±24 st; playback rate from key/root), `sampler.buf` 0..3, `sampler.vol`; velocity to
level (fixed law 0.3 + 0.7·vel). MULTISAMPLE ZONES v1: message `{t:"zones", zones:
Float64Array(...)}` (up to 8 zones `{lo, hi, root, buf, vol}`, parent wires the wrapper
`avEngineZones`); nearest-zone selection per note; document the layout. Harness: one-shot ends
exactly at buffer end; loop wraps within ±1 sample; rate math exact (2 semitones = ×2^(2/12));
zone selection table; alloc-free.

## 7. UI (D rack · E matrix · G panels) + rig

- `av_fx.js` (D): rack card into `#av-fx-host` (parent adds host): one strip per module (on toggle,
  mix, 2-3 headline knobs reused from §3 params), order shown fixed; ALL controls ride the standard
  av-knob/`avApplyParam` idioms; param paths exactly §3. Returns CSS class list + control inventory.
  `verify/cdp_fx.mjs` (WRITE-ONLY): boot → rack card + 5 strips present + controls bound → real
  clicks: enable verb, set mix 1 → play a note, release, WITNESS the tail on the master tap (own
  AnalyserNode; tail RMS after note-off above control) → bypass-all null check (params off ⇒ the
  stress-style determinism: two offline renders equal — the rig may do an OfflineAudioContext pair)
  → param round-trip for every module path accepted → zero page errors → freeze sha before/after.
- `av_mod.js` (E): matrix card `#av-mod-host`; wire per §4.
- `av_synth.js` (G): extend the ENGINE select with `grain` and `sampler`; add their panels (pins from
  §5/§6; defaults documented); the drum/acid/string/va panels stay byte-identical; return CSS list +
  inventory. (av_synth.js has ONE writer — G.)
- Parent: body.html hosts (`#av-fx-host`, `#av-mod-host` cards), styles.css (all returned lists),
  app_core boot calls (`avFxInit`, `avModInit` guarded), smoke additions if cheap.

## 8. Gates, reports, laws

Gates: FX battery = D's cdp_fx (parent runs) + A/B/C node harnesses (parent re-runs one summary
pass) + the bypass-null + P2 battery re-run (smoke/feel/keys/midi/sample/rec) + PERF GATE (bench +
stress; the §2.2 all-off bit-identical check makes the perf delta attributable). Reports per P2 §8
shape. Laws: worklet-safe/no-DOM in worklet files · alloc-free render (allocation only at create /
message time — state it explicitly per module) · monomorphic voices (F adds grain/sampler fields via
initVoiceK) · seeded determinism · one writer per file · scratch never in repo · licences (Dattorro
= published paper maths; Freeverb constants per docs/05 §3 option 7 resolve FIRST; no third-party
code without a verified licence file). If a child needs an av_dsp-side hook, it goes in the report —
never an edit.
