# Anvil P1 — worklet voice engine wave: contract + pre-staged plan (2026-10-07)

Purpose: zero-idle dispatch. READ THIS FILE FIRST if resuming after a compaction.
Trigger: P0 CLOSED (c8165ff/cc601710 battery); P1 started 2026-10-07.
Authoritative for: every interface the P1 agents code against. The parent (session owner) owns
build.py, app_core.js, body.html, styles.css, commits, integration, battery.

## 0. State & evidence

- HEAD at wave start: `c8215ff` (P0 COMPLETE). Tree clean.
- Frozen halfband design + verification: `research/engine/hb_design.py` (reproduce:
  `uv run --no-project --with numpy --with scipy python research/engine/hb_design.py`) →
  `research/engine/hb-coeffs.json`. **Ship set (order 6, 3+3 allpass sections):**
  - coeffsA = [0.0500126042527, 0.364414899325, 0.735773412262]
  - coeffsB = [0.183957727747, 0.554852766862, 0.909374288911]
  - stopband 73.5 dB (≥ 0.56π internal = ≥ 26.9 kHz), passband ripple ~0 dB, −3 dB @ 23.999 kHz,
    power-complement error 4.66e-15; exact-algorithm check (variant `sumB`) 1.6e-12 absolute.
  - HQ alternative (4+4, 100.6 dB) in the same JSON — lever only, not shipped in P1.
- P0 battery baseline (must still pass after integration): smoke 9/9 · feel 18/18 · keys 27/27 ·
  midi 33/33 on frozen bytes.

## 1. Scope — P1 deliverables (exit gates from docs/03 §6)

Mixer AudioWorklet; PolyBLEP + wavetable oscillators; TPT SVF; env/LFO; amp; unison; voice pool +
oldest-first steal; pitch/glide plumbing; **proof-benchmark run (T5 §7)**; fallback tier executing the
same kernels. Gates: aliasing floors met; **measured voice count published**; 10-min stress green.
NOT in P1: minBLEP "Classic" osc (P1.x), FM, filters v2/ladder (P2), FX (P3), sequencer (P4).

## 2. Architecture decisions (LOCKED)

1. **Two-tier engine, one kernel source.** `src/av_dsp.js` = pure kernels + voice engine (no DOM, no
   window/document, no AudioContext — it must run verbatim in `AudioWorkletGlobalScope`). It is BOTH a
   normal `js_parts` bundle member (so the ScriptProcessor fallback calls the same functions) AND its
   text is embedded by build.py as `AV_WORKLET_SRC` (JSON-escaped `<` as `\u003c`). Worklet module
   source = `av_dsp.js` text + `\n` + `av_voiceproc.js` text.
2. **Worklet delivery ladder** (facade, per context, `avengine=auto|worklet|spn` URL override):
   `blob:` URL addModule → `data:` URL addModule → ScriptProcessorNode fallback. Each attempt caught;
   tier recorded honestly (`worklet:blob` / `worklet:data` / `spn`). Handshake ('hello'→'ready')
   with 2.5 s timeout; failed handshake = failed tier, fall through.
3. **Zero a-rate worklet params.** The mixer node exposes NO AudioWorkletParameters (k-rate law, T5
   §5); everything arrives by port messages (SAB ring is a hosted-tier optimisation, not P1).
4. **Eager boot, gesture resume.** `avEngineEnsure()` starts at app boot (context created
   suspended; addModule + node graph built while suspended). First `pointerdown`/`keydown` anywhere
   calls `ctx.resume()`. `?avtest=1` boot is identical (suites run with
   `--autoplay-policy=no-user-gesture-required`).
5. **2× oversampled voice core (Surge-style, decimation-only).** Osc + filter + sub + noise run at
   2× rate; the per-voice halfband decimator (section 3) converts to base rate; amp env + LFO apply at
   base rate. Every voice carries its own decimator.
6. **Rates law.** Live = device rate (48k on this box). ALL oscillator/filter math against
   `sr2 = 2·sampleRate`; ALL env/LFO time constants against `sampleRate` (they step per output sample).
   Nothing expressed in absolute Hz-samples.
7. **Determinism.** One seeded PRNG (xorshift32, seed 0x9E3779B9) per engine instance; consumed by
   unison phase randomisation + noise + S&H. Same boot + same patch + same note order ⇒ bit-identical
   renders (null/alias rigs rely on this).
8. **Alloc-free render.** No allocation, no closures, no string ops inside `render()`; all state
   preallocated in `create()`; voice objects monomorphic (fixed field init).

## 3. The halfband decimator (exact algorithm — implement EXACTLY)

Per voice, per output sample, given the two 2×-rate samples s0, s1 (post-filter, pre-amp):

```
# branch state: sa[3], sb[3]; persistent per voice; bPrev (number, init 0)
va = s0
for i in 0..2:  t = coeffsA[i]*va + sa[i];  sa[i] = va - coeffsA[i]*t;  va = t
vb = s1
for i in 0..2:  t = coeffsB[i]*vb + sb[i];  sb[i] = vb - coeffsB[i]*t;  vb = t
y  = 0.5 * (va + bPrev)
bPrev = vb
```

(even sample → A, odd sample → B, B one base-sample late; verified 1.6e-12 vs analytic; sim shows
−90 dB @ 30 kHz, −92 dB @ 40 kHz, passband 0.00 dB to 20 kHz.) Cost ≈ 26 flops/output-sample.

## 4. `src/av_dsp.js` — interface pin (agent K)

Top level: `const AVDSP = (function () { ... return {...}; })();` — no other top-level names (the
build's duplicate-declaration guard must stay quiet). No DOM/window/document/globalThis references.

### 4.1 API (exact names)

```
AVDSP.version            // "p1.0"
AVDSP.buildTables()      // deterministic; idempotent; builds WT mip bank + sine LUT; returns {ok, ms}
AVDSP.create({sampleRate, maxVoices=64, seed=0x9E3779B9}) -> engine
AVDSP.noteOn(eng, midi, gain) -> bool     // true when a voice was allocated
AVDSP.noteOff(eng, midi)                  // releases the (first) voice holding that midi
AVDSP.allOff(eng)
AVDSP.setParam(eng, path, value) -> bool  // false for unknown path (contract check)
AVDSP.render(eng, outL, outR, n)          // planar Float32Array/Float64Array writes; n even; all n frames written
AVDSP.stats(eng) -> {active, released, total, maxVoices, sr, os, stolen, msBoot}
AVDSP.benchReset(eng)
AVDSP.benchRead(eng) -> {n, meanUs, p95Us, maxUs, underruns, ring:[...256]}
AVDSP.recordQuantum(eng, us, frames)      // ring push; per-128 normalised (us*128/frames); underrun when normalised > budget
```

`recordQuantum` stores the LAST 256 per-quantum durations (µs, per-128-frame equivalent) and counts
underruns (normalised duration > `128*1e6/sampleRate`). Both tiers call it (worklet: around
`process()`; SPN: around the render call).

### 4.2 Parameters (paths, ranges, defaults) — SINGLE SOURCE OF TRUTH

| path | range | default | smoothed |
|---|---|---|---|
| osc1.type | 'saw'\|'square'\|'pulse'\|'tri'\|'sine' | 'saw' | — |
| osc1.level | 0..1 | 1.0 | τ15 ms |
| osc1.pw | 0.05..0.95 | 0.5 | τ15 ms |
| osc1.tune | −24..24 st | 0 | — |
| osc1.uni | int 1..7 | 1 | — (applies to new notes) |
| osc1.spread | 0..50 ct | 12 | — (new notes) |
| osc2.type | 'wt.saw'\|'wt.square'\|'wt.tri'\|'wt.sine'\|'wt.pulse25' | 'wt.saw' | — |
| osc2.level | 0..1 | 0.5 | τ15 ms |
| osc2.tune | −24..24 st | 0 | — |
| osc2.uni | 1..7 | 1 | — |
| osc2.spread | 0..50 ct | 12 | — |
| sub.level | 0..1 | 0 | τ15 ms |
| sub.wave | 'square'\|'sine' | 'square' | — |
| noise.level | 0..1 | 0 | τ15 ms |
| filter.mode | 'lp12'\|'lp24'\|'bp'\|'hp' | 'lp24' | — |
| filter.cutoff | 20..20000 Hz | 800 | τ15 ms (log domain) |
| filter.reso | 0..1 (k = 2 − 1.98·reso) | 0.3 | τ15 ms |
| filter.envAmt | −4..4 oct | 2 | τ20 ms |
| filter.ktrk | 0..1 | 0.5 | — |
| env1.a/.d/.s/.r | 0.001..4 s / 0.001..8 s / 0..1 / 0.001..8 s | .002/.3/.8/.2 | — |
| env2.a/.d/.s/.r | same ranges | .001/.5/.5/.3 | — |
| lfo.shape | 'sine'\|'tri'\|'square'\|'sh' | 'sine' | — |
| lfo.rate | 0.05..20 Hz | 5 | — |
| lfo.toCut | −1..1 (±2 oct) | 0 | — |
| lfo.toPitch | −1..1 (±50 ct) | 0 | — |
| voice.glide | 0..2 s | 0 | — |
| voice.bend | −12..12 st | 0 | — |
| tune | −12..12 st | 0 | — |
| engine.outScale | 0.05..1 | 0.25 | τ20 ms |

Unknown path → `false`, no throw. `avApplyParam` routing handles the rest app-side.

### 4.3 Voice laws (pin)

- **Pitch:** `f = 440 · 2^((pitch + bend + tune)/12)`; pitch = gliding note value (semitones).
  Glide: engine keeps `lastMidi` (init −1); with glide > 0 and lastMidi ≥ 0, new voice starts at
  lastMidi and moves LINEARLY to target over exactly `glide` seconds (per output sample), else starts
  at target. Update lastMidi on every noteOn.
- **Velocity:** amp peak = env1 · vel (vel = bus gain, 0.05..1). Linear.
- **Unison** (per osc): u sub-oscillators, detune_i = spread·(2i/(u−1) − 1) cents (u=1 → 0);
  sum scaled 1/√u; each sub-osc seeded-random phase at note start; both osc slots share the u count?
  NO — per-osc uni as params above (uni 1..7 each).
- **Waveforms (pin the math):**
  - polyBLEP(t, dt): `if t < dt: t/=dt; return 2*(t − t*t/2 − 0.5)` … `elif t > 1−dt: t=(t−1)/dt; return t*t + 2*t + 1` … else 0.
  - saw = 2t−1 − pb(t); square = (t<0.5?1:−1) − pb(t) + pb((t+0.5)%1); pulse(d) = (t<d?1:−1) − pb(t) + pb((t+1−d)%1).
  - tri = 1 − 4·|t − 0.5| (naive; 1/h² harmonics; upgrade lever), sine = LUT.
  - sub = polyBLEP square (or LUT sine) at f/2, same per-osc discipline.
  - noise = PRNG bipolar.
- **Wavetables:** bank `wt.saw/wt.square/wt.tri/wt.sine/wt.pulse25`; 2048-sample frames, 11 mip
  levels (k=0..10; level k keeps ≤ 1024/2^k harmonics), built by IFFT synthesis (own radix-2),
  all levels scaled by the SAME factor (peak-normalise level 0 to 0.95; NO per-level normalise);
  mip select per note (recompute on pitch change): `k = clamp(ceil(log2(3072·f/fs2)), 0, 10)`;
  READ: cubic (Catmull-Rom) at phase; float64 phase accumulator [0,1).
- **SVF (T5 §11, per 2×-sample):** g=tan(π·fc/fs2), k as above; a1=1/(1+g(g+k)), a2=g·a1, a3=g·a2;
  v3=v0−ic2; v1=a1·ic1+a2·v3; v2=ic2+a2·ic1+a3·v3; ic1=2v1−ic1; ic2=2v2−ic2; lp=v2, bp=v1, hp=v0−k·v1−v2;
  lp24 = two cascaded stages. Cutoff = base · 2^(envAmt·env2oct + 2·lfo.toCut·lfo + ktrk·(midi−60)/12),
  clamped 10..(fs2/2·0.45). Coefficient recompute ≥ every 16 output samples (tan hoisting; document).
- **Envelopes:** attack linear to target (vel), rate 1/(A·sr) per output sample; decay/release
  exponential with `coef = exp(−4.6/(t·sampleRate))` (t = time to −40 dB). env1 = amp
  (gate-less: notes held until noteOff), env2 = filter (per note). Both step once per output sample.
- **LFO:** per voice, phase resets at note start (retrig); rate/step per output sample; shapes from
  the pinned list; toCut ±2 oct at ±1; toPitch ±50 ct at ±1.
- **Voice pool:** fixed array size maxVoices; alloc order: (1) same-midi voice (retrigger), (2) idle,
  (3) oldest released, (4) oldest overall. Steal must not click: ≥1 ms fade-out before retrigger;
  fresh notes get a short (≤2 ms) fade-in. `stolen` counter in stats.
- **Render structure per output sample (pin):** for each voice: two internal steps → osc mix (osc1
  uni sum + osc2 wt + sub + noise) → SVF(2×) → [s0,s1] → halfband → y → × env1 · vel → sum to L/R
  (mono → both channels). After all voices: multiply by outScale. Write every frame.

### 4.4 Agent-K verification (node scratch, no browser)

`node --check` both files + a node scratch script (scratch dir, NOT in repo) that loads the two files
(concat + eval) and asserts, printing everything:
1. buildTables deterministic (two calls → identical first/peak values), < 500 ms.
2. silence render (no voices) = exact zeros; 1 s note render: no NaN/Inf, peak in (0, 1.5], RMS > 0.
3. note off/allOff → release completes (active+released returns to 0 within 8 s render).
4. determinism: two engines, same note, 4096 frames → identical Float64 checksums.
5. saw-440 zero-crossing count within ±20% of expected over 4800 frames.
6. sweep setParam cutoff/reso/levels during render → no NaN; unknown path → false.
7. maxVoices 4 + 6 noteOns → active ≤ 4, no NaN.
Report: file line counts + every command + raw output + a `deviations` list (empty = none).

## 5. `src/av_voiceproc.js` — interface pin (agent K)

```
class AVVoiceProcessor extends AudioWorkletProcessor
constructor(options): AVDSP.buildTables(); engine = AVDSP.create({sampleRate, maxVoices:
  options.processorOptions.maxVoices || 64}); port.onmessage → protocol; postMessage({t:'ready',
  sr, maxVoices, os:2, version:AVDSP.version})
process(inputs, outputs, parameters): timing = guarded performance.now around AVDSP.render
  (outputs[0][0], outputs[0][1]); AVDSP.recordQuantum(engine, us, 128); return true
registerProcessor('av-voice', AVVoiceProcessor)
```

Message protocol (BOTH directions, exact):
- in: `{t:'param', path, v}` · `{t:'note', on:true, midi, gain}` · `{t:'note', on:false, midi}` ·
  `{t:'allOff'}` · `{t:'bench', cmd:'reset'|'read', id}` · `{t:'stats', id}` · `{t:'hello', id}`
- out: `{t:'ready', sr, maxVoices, os, version}` · `{t:'bench', id, data}` · `{t:'stats', id, data}`
`performance.now` guard: `const NOW = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? () => performance.now() : () => Date.now();`
No DOM references. `registerProcessor` must appear exactly once.

## 6. `src/av_engine.js` — facade pin (agent E)

```
avEngineBoot(ctx, opts) -> Promise<handle>       // pure per-context; opts {maxVoices=64, force, offline}
avEngineEnsure() -> Promise<handle>              // ONE live singleton for the app
window.__avEngine = { ready, tier:'worklet'|'spn'|null, url:'blob'|'data'|null, error:null|string,
                      sr, maxVoices, os, noteOn(midi,gain), noteOff(midi), allOff(), setParam(path,v),
                      bench(cmd)->Promise<data>, stats()->Promise<data>, handle }
```

- Tier ladder per §2.2; `force` from URL `?avengine=spn|worklet|auto` (auto default). Worklet node:
  `new AudioWorkletNode(ctx, 'av-voice', {numberOfInputs:0, numberOfOutputs:1, outputChannelCount:[2],
  processorOptions:{maxVoices}})`; connect to `avKeysFor(ctx) || ctx.destination`. SPN:
  `ctx.createScriptProcessor(1024, 0, 2)`, engine direct, `onaudioprocess` renders + records; SPN
  default maxVoices 16 (degraded tier, honest).
- Handshake: post `hello`; await `ready` ≤ 2.5 s (then fall through the ladder).
- `avEngineEnsure`: creates `new AudioContext({latencyHint:'interactive'})` once; boots; on ready:
  sets `document.documentElement[data-av-engine]=tier`, `window.__avEngine`, registers the avNote sink
  (`avNoteSetSink({on: (midi,gain)=>handle.noteOn(midi,gain), off: ..., allOff: ...})`), replays
  `avNoteState().held` names, replays current `avParams` into the engine, updates the header chips
  (`#av-tier` → `tap: armed · engine: worklet`; `#av-voices` chip → `voices: n/max`, sampled ~2 Hz).
  On failure: `data-av-engine='failed'`, error recorded, no sink.
- Resume: document capture `pointerdown`/`keydown` (passive) → `ctx.resume()` until running; also try
  resume inside noteOn.
- `bench(cmd)` worklet path: postMessage + id-matched promise; SPN path: direct call. `stats()` same.
- No console.error on the fallback ladder (warn at most). Everything caught.
- Guard: `avEngineEnsure` must be idempotent; safe to call before user gesture.

## 7. `src/av_synth.js` — SYNTH card (agent U)

`avSynthInit()` mounts controls into `#av-synth-knobs` (host added by parent), returns bool.
- Body: row of selects + 3 knob rows, all wired via standard avKnob mechanics; every control commits
  through `avApplyParam(path, v)` and mirrors `avParams[path]` (seeds defaults at init). Selects:
  `.av-select` class; on change → `avParams[path]=v; avApplyParam(path, v)`.
- Controls: selects osc1.type, osc2.type, filter.mode. Knobs (labels in caps): OSC1 LVL, OSC2 LVL,
  UNISON (1..7 step 1, int), SPREAD (0..50, ct), SUB (0..1, pct), CUTOFF (20..20000 log, hz),
  RESO (0..1 pct), ENV AMT (−4..4), ATTACK, DECAY, SUSTAIN, RELEASE (env1: 0.001..4/8/1/8; ms fmt),
  GLIDE (0..2 s), LFO RATE (0.05..20 log hz), LFO→CUT (−1..1 pct).
- Defaults must equal §4.2 table. Style: reuse `.av-knobs`, `.av-select` (parent adds CSS).
- No persistence in P1. Read `src/app_core.js` (LEVELS card) + `src/av_knob.js` for the exact idioms.

## 8. Parent integration (build.py · app_core · body · styles)

- build.py: js_parts becomes [av_tap, av_knob, av_note, av_kb, av_midi, av_dsp, av_engine, av_synth,
  app_core]; embed `const AV_WORKLET_SRC = <json>` + `const AV_WORKLET_SHA = "<sha256>"` right before
  av_engine; guard: worklet source parses standalone (`node --check` on a temp file), contains
  `registerProcessor('av-voice'`, has no `</script`; `<` escaped `\u003c` in the JSON string.
- app_core: version 0.1.0 · phase 'P1 · voice engine'; boot adds `avSynthInit()` + `avEngineEnsure()`;
  `avApplyParam` routes unknown paths to `__avEngine.setParam` when ready; `?avtest=1` gains
  ENGINE SELFTEST (`window.__avEngineTest`, line `ENGINE SELFTEST {...}`) asserting tier ∈
  {worklet,spn}, handle ready, noteOn→stats.active ≥ 1 after 150 ms, allOff.
- body.html: SYNTH card host `<section class="av-card" id="av-synth">` with `<div id="av-synth-knobs">`;
  header: `#av-voices` chip id.
- styles.css: `.av-select` + synth card skin (teal tokens); no layout regressions at 1440.

## 9. Rigs (pinned contracts)

### 9.1 `verify/cdp_bench.mjs` (agent B, write + mock-run now; real run after integration)
- Static server: node `http`, serves repo root, own free port 9400+; log `freeze sha256 <sha> (<bytes> B)`.
- Launch skeleton: copy cdp_smoke.mjs launch block VERBATIM (edge/chrome candidates, headless=new,
  temp profile, 1440×900 metrics override, --mute-audio, --autoplay-policy=no-user-gesture-required,
  windowsHide, profile-scoped cleanup). One browser at a time — never kill other processes.
- Sanity phase: load `http://127.0.0.1:<port>/index.html?avtest=1`; wait `data-av-engine`; assert
  ctx.state==='running' after resume attempt AND over 2 s wall `ctx.currentTime` advances ≥ 1.9 s;
  record baseLatency; list console messages (diagnostic). FAIL loudly with evidence if not realtime.
- Ramp (T5 §7): variants LIGHT and FAT (§9.2); steps [1,2,4,8,16,24,32,48,64]; each: bench reset,
  noteOn that many midis (midi_i = 21+i), hold 10 s, bench read → {meanUs,p95Us,maxUs,underruns},
  allOff + 0.5 s settle. Stability per step: p95Us < 1333 AND underruns == 0. 3 reps per variant;
  publish per variant = max stable step across reps → min over reps. JSON → `verify/last-cdp_bench.json`;
  human log `verify/last-cdp_bench.log` (per-step p95 table); shot `renders/p1-bench.png`.
- Fallback cell: file:// load → expect tier 'spn' → sanity → p95 at 8 voices (no full ramp; note why).
- `--quick` flag: light variant, 1 rep, steps [8,32,64] (fast A/B checks).
- Mock self-test NOW: `verify/_bench_mock.html` — single file, inline worklet (blob) with a 256-ring
  + a small oscillator; the rig must drive it via the same code paths (server, launch, evaluate,
  bench read) and prove in this session: (a) headless Edge runs a realtime AudioContext
  (currentTime advances), (b) blob worklet works on http origin, (c) rig mechanics + JSON output work.
  Then wire the real-app code path but leave `--mock` routing intact.

### 9.2 Bench patches (pin)
- LIGHT: osc1 saw 1.0 · osc2 wt.saw 0.5 tune 0 · filter lp24 800/0.3/envAmt 2 · env1 .002/.3/.8/.2 ·
  env2 .001/.5/.5/.3 · uni 1 · lfo 0.
- FAT: LIGHT + osc1 uni 3 spread 15 · osc2 uni 2 spread 20 · lfo.toCut 0.3 rate 5 · glide 0.03.

### 9.3 `verify/cdp_alias.mjs` (dispatch AFTER bench wave; write+run against integrated build)
Offline renders via `avEngineBoot(offlineCtx)` (facade supports OfflineAudioContext; tap chain exists,
never live). 3 s renders; Blackman window; 2^17 FFT in-page (own radix-2); worst non-harmonic spur in
dBc vs carrier (mask ±3 bins around harmonics of f0; ignore < 20 Hz). Cases VA saw/square/pulse(0.3)/
tri/sine @ C4 261.63 / A4 440 / C6 1046.5; WT bank @ same. Gates: WT ≤ −80 dBc; VA ≤ −45 dBc at ≥C4.
Cross-rate spot: 44.1 k saw C4 + wt A4. Determinism: two fresh offline engines, same patch/note →
bit-identical (max abs diff == 0). Log `verify/last-cdp_alias.log`.

### 9.4 `verify/cdp_stress.mjs` (dispatch after alias; write+run)
10 min; page over the local server (worklet tier). Workload: arpeggio bursts at cap (chords cycling
8–cap voices), periodic REAL knob commits (cutoff + reso sweeps via avKnobCommit on the mounted DOM
knobs), unison stepping, occasional allOff → pool-drain check (active+released → 0 ≤ 1 s). Sample every
15 s: active, released, heap (performance.memory), underruns, ctx.state. Assert: heap growth < 60 MB;
zero underruns at the declared cap (= min(published light number, 32) — parent fills after bench);
pool drains; zero page errors. Log `verify/last-cdp_stress.log`; shot `renders/p1-stress.png`.

## 10. Dispatch & sequencing

Phase 1 (now): dispatch K (av_dsp.js + av_voiceproc.js), E (av_engine.js), U (av_synth.js),
B (cdp_bench.mjs + _bench_mock.html, mock-run only). All file-scoped; children never touch
build.py/app_core/body/styles/git; one writer per file; scratch under the Hermes scratch dir.
Phase 2 (parent): verify files (node --check each; read av_dsp.js against §4!), integration edits
(§8), `python3 build.py` → freeze sha, P0 battery re-run (smoke/feel/keys/midi) on frozen bytes.
Phase 3 (serialized rigs, one browser at a time): B-run (real bench) → C (alias) → D (stress).
Parent re-runs the full bench on frozen bytes to own the published number; fills the stress cap.
Phase 4: README + CONTINUATION addendum + mnemosyne; commits B–D.

## 11. Commit plan & close-out
- C1 (now): this plan + hb_design.py + hb-coeffs.json + CONTINUATION addendum 9.
- C2: engine core lands (K/E/U files + build.py + app_core/body/styles) — build green + P0 battery
  green on the frozen sha (cite counts).
- C3: rigs land + bench numbers (cite measured voice count + logs); C4: alias + stress green + docs.

## 12. Laws (do not drift)
lab → battery → frozen bytes; children never run build.py/browsers(beyond their own rig)/git; never
edit files outside your scope; no console windows; if a test exposes an app bug, report a minimal
repro (what/expected/actual/where) — parent fixes src. The measured voice count is published ONLY
from the parent-run ramp. One browser suite at a time on this machine.
