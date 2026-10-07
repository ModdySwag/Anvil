# 09 - The CODE section: write your own modules

Anvil's CODE section lets you write DSP modules in plain JavaScript and run them inside the
instrument's audio engine. Two module kinds exist:

- **fx modules** - post-mix effects that sit in the engine's FX chain (after the voice mix).
- **kind modules** - entire voice architectures (oscillator + envelope + anything else),
  selectable in the SYNTH card's ENGINE pick next to `va`, `acid`, `string`, `drum`, `grain`
  and `sampler`.

This document is the public contract: everything below is what the runtime actually enforces
(`src/av_umod_wl.js` is the runtime; `src/av_code.js` is the page engine behind the CODE card).

---

## 1. Where modules run

The instrument ships one voice engine source that can ride two transports:

- **worklet tier** (normal): the engine runs in an AudioWorklet. Your module source is eval'd
  *inside the worklet* with `new Function('API', '"use strict";\n' + src)` and receives exactly
  one argument: the frozen `API` object. The worklet global scope has no DOM, no network (no
  `fetch`, no `URL`), **no timers**, no `TextEncoder` and no `structuredClone`. Anything your
  module needs must come from the `API` argument or from the engine values passed to your
  functions. This is a real sandbox, not a lint rule.
- **SPN tier** (fallback, shown as "degraded" in the header): the same engine runs on the page's
  main thread via a ScriptProcessorNode. The same module source runs there unchanged. Be honest
  with yourself about this tier: module code runs on the page thread, so a heavy module can
  stutter the UI as well as the audio.

Both tiers use the exact same runtime and message protocol, so a module that works in one works
in the other.

---

## 2. The module contract

Your source text is the **body of a function**. It receives one argument, `API`, and must
`return` a module object (called **MOD** below):

```js
/* my module */
return {
  api: 1,
  id: "myfx",
  name: "My FX",
  kind: "fx",
  params: [ /* see section 4 */ ],
  createState: function (cfg) { /* ... */ },
  setParam: function (st, path, value) { /* ... */ },
  process: function (st, inL, inR) { /* ... */ }
};
```

Because the source is a function body, `return` at the top level is correct and required. The
runtime wraps it in strict mode, so undeclared variables throw - declare everything with
`var`, `let` or `const` (inside functions, `var` and function declarations are fully supported).

MOD fields:

| field  | required | value |
|---|---|---|
| `api`  | yes | must be exactly `1` (the numeric contract version; see section 8) |
| `id`   | yes | must equal the id you added the module as - `/^[a-z][a-z0-9_-]{0,31}$/` (lowercase letter first; then lowercase letters, digits, `_`, `-`; at most 32 chars) |
| `name` | no | display name; the request's name is used when omitted |
| `kind` | yes | `"fx"` or `"kind"` - must match how it is added |
| `params` | no | at most 16 param descriptors (section 4); omit for none |

If `id` or `kind` are declared and disagree with the add request, the loader refuses the module.

---

## 3. The API object

`API` is one frozen object (attempting to write to it throws - it is frozen). It carries:

| member | type | meaning |
|---|---|---|
| `API.api` | `1` | the numeric contract version, same as `MOD.api` |
| `API.VERSION` | string | the runtime build that provided this API (e.g. `"s5.0"`) |
| `API.clamp(v, lo, hi)` | number | clamp `v` into `[lo, hi]`; non-finite input gives `0` |
| `API.lerp(a, b, t)` | number | `a + (b - a) * t` |
| `API.sine(phase)` | number | `Math.sin(phase * TAU)`, result in `[-1, 1]`; `phase` is in turns (1.0 = one full cycle) |
| `API.TAU` | number | `Math.PI * 2` |
| `API.blep` | object or `null` | the engine's minBLEP residual table `{ W, N, RL, MASK, SUBS, tab, deposit }` for advanced band-limited oscillators; `null` when the tier does not provide one. Treat it as read-only. |

Nothing else is injected. There is no engine handle in `API`: kind modules receive the live
engine as the first argument of their callbacks (section 6), and fx modules receive their own
per-module state.

---

## 4. Parameters

Each entry of `params` declares one knob:

```js
{ name: "depth", min: 0, max: 1, def: 0.6, step: 0.01, label: "Depth" }
```

| field | required | rules |
|---|---|---|
| `name` | yes | `/^[A-Za-z][A-Za-z0-9_]{0,31}$/` - a letter, then letters/digits/`_`, at most 32 chars; unique within the module |
| `min`, `max` | yes | finite numbers, `max > min` |
| `def` | yes | finite number; clamped into `[min, max]` before use |
| `step` | no | positive number (UI hint) |
| `label` | no | display string |

Limits: **at most 16 params**. On a successful load, the runtime applies every default by
calling your `setParam` once per param, so your state always starts consistent.

### The setParam path convention

The path your `setParam` receives has the module's name in it:

- fx modules: `setParam(st, "fx.<id>.<name>", value)`
- kind modules: `setParam(eng, "<id>.<name>", value)`

Parse the **last dot-segment** as the param name and ignore the rest:

```js
var name = path.slice(path.lastIndexOf(".") + 1);
```

Return `true` when you handled the value, `false` otherwise. A throw inside `setParam` is caught
and turned into `false` (it never disables the module - a bad knob must not kill a running voice).

---

## 5. FX modules

An fx module is a post-mix insert. The engine appends it to the FX chain when you press RUN and
removes it when you press STOP.

```js
createState(cfg)          -> st        // cfg = { sampleRate }
bindEngine(st, eng)       -> optional  // called with the engine object right after createState
setParam(st, path, value) -> boolean
process(st, inL, inR)     -> void      // write st.oL / st.oR
```

### The WET convention

`process` receives the current mix sample as `inL`/`inR` and must write **its own output** into
`st.oL` / `st.oR`. The engine then blends:

```
out = dry * (1 - st.mix) + wet * st.mix
```

with `st.mix` owned by the runtime defaults (see below). This is the same convention the
built-in drive/verb/dyn effects use, which is why a user module can be mixed in parallel with
them.

### `st.on` and `st.mix` defaults

After `createState` and the param defaults have run, the runtime enforces:

- If the module declares a param named `on`: `st.on = 1` when its default is above `0.5`,
  otherwise `st.on = 0` (off = the engine skips the module entirely, bit-exact pass-through).
- If the module does not declare `on`: `st.on = 1` is set explicitly.
- If the module declares a param named `mix`: `st.mix` is reset to that param's clamped default
  (declare `mix` as 0..1). This param is the engine's blend control - do not also mix dry signal
  inside `process`, or you will mix it twice.
- If the module does not declare `mix`: `st.mix = 1` (fully wet - whatever you write is what
  comes out of the module's slot).

Set `st.on` yourself from your `on` param handler (`st.on = v > 0.5 ? 1 : 0;`) so knob changes
apply instantly.

---

## 6. Kind modules

A kind module is a complete voice architecture. It follows Anvil's P2 "kind" contract (the same
one `acid`, `string`, `drum`, `grain` and `sampler` implement), with two differences: user
kinds live at kind ids **64 and up** (built-ins are 1..5), and there is no registration footer -
the runtime registers the module for you under the id you gave it.

Required members:

```js
stepVoice(eng, v)   -> number   // ONE base-rate sample, per voice, per output sample
isVoiceDone(eng, v) -> boolean  // true once a RELEASED voice's tail has finished
setParam(eng, path, value) -> boolean
```

Optional members (called when present):

```js
initEngineK(kext)      // once at load: create engine-level fields on the shared kext object
initVoiceK(k)          // once at load, for EVERY voice: create your fields on v.k
initVoice(eng, v)      // per NOTE (every note-on): reset your per-note voice fields
releaseVoice(eng, v)   // when a note is released
```

What you get in the callbacks:

- `eng` - the live engine object. Useful fields: `eng.sr` (sample rate), `eng.bend`,
  `eng.tune` (semitone offsets), `eng.kext` (the shared engine-level object your
  `initEngineK` filled). Store engine-wide params on `eng.kext`; store per-voice state on `v.k`.
- `v` - the voice. `v.pitch` is the sounding pitch in MIDI semitones (C4 = 60, glide already
  applied), `v.vel` is velocity, `v.state` is `2` once the note has been released (`0` idle).
  The engine multiplies your return value by `v.vel` and a short fade, so return the raw
  waveform * envelope.

Rules the runtime enforces on the engine's behalf:

- `stepVoice` must return a finite number. A non-finite return is replaced with `0`.
- `isVoiceDone` is only consulted for released voices; never return `true` for a held note.
- A throwing `stepVoice` (or `isVoiceDone`) is caught; after the **4th** caught throw the kind
  is marked dead: it disappears from `kindById` and the ENGINE pick, and sounding voices of that
  kind are freed. `setParam` throws are just `false`.

### Selecting your kind

The module id is the value of `engine.kind`. Open the SYNTH card, pick your module in the ENGINE
select (it appears after you press RUN in the CODE card), or call:

```js
avApplyParam("engine.kind", "fold");
```

The engine resolves the string against loaded user kinds via `AVUMOD.kindIdByName`. A dead
(poisoned) kind refuses to resolve until you remove and re-add it.

---

## 7. Limits and the sandbox

| limit | value |
|---|---|
| module source | at most 65536 characters (64 KB) - refused above |
| module id | `/^[a-z][a-z0-9_-]{0,31}$/` |
| params | at most 16 per module |
| param names | `/^[A-Za-z][A-Za-z0-9_]{0,31}$/` |
| module api | exactly `1` |

What user code cannot reach, in the audio scope: `window`, `document`, `fetch`, `URL`,
`localStorage`, `indexedDB`, timers, `performance`, `TextEncoder/TextDecoder`,
`structuredClone`. Do not attempt workarounds; there is nothing to work around. Do not put
per-sample work behind string parsing - paths arrive only through `setParam`.

On the **SPN tier** the same code runs on the page, where those globals *do* exist - a module
that leans on them will behave differently between tiers (and is unsupported). Stick to the API
and the engine values to stay tier-independent.

---

## 8. Versioning policy

Every module declares `api: 1`.

- `api === 1`: accepted.
- `api > 1` (e.g. `2`): refused with a clear error ("newer than this build"). Future contract
  versions will be additive; this build will never silently run a module it does not fully
  understand.
- `api` missing or less than 1: refused ("missing api").
- The `.avmod` file format carries the same `api: 1` and is refused with the same honesty.

---

## 9. Errors, poison and honest failure

Load-time refusals (the CODE card prints these verbatim):

- id charset / kind / source size / duplicate id violations;
- eval failure (syntax error in your source) - the `SyntaxError` message is reported;
- `MOD` missing `api`, declaring a different `id`/`kind` than the request;
- fx missing `createState`/`process`/`setParam`; kind missing `stepVoice`/`isVoiceDone`/`setParam`;
- more than 16 params, bad param names, non-finite `min`/`max`/`def`, `max <= min`;
- `createState`/`bindEngine`/`initEngineK`/`initVoiceK` throwing.

A refusal never touches the engine: no partial effects, no half-registered kinds.

Runtime poison (while audio is running):

- `process` and `stepVoice`/`isVoiceDone` throws are caught by the runtime. The first three are
  counted (the module keeps running, remaining audio keeps working); the fourth disables the
  module: an fx gets `st.on = 0` (the engine skips it), a kind is marked dead.
- Non-finite writes into `st.oL`/`st.oR` (fx) or non-finite `stepVoice` returns are written as
  `0` - a NaN can never leak into the mix bus.
- A disabled module is listed in the CODE card as **poisoned** and stays loaded but inert until
  you remove it (or re-add it after a fix). `avCodeList()` reports `poisoned: true`,
  `avCodeStatus()` collects the ids in `poisoned`.

---

## 10. Persistence and `.avmod` files

Module records persist in the browser database `av-code-store` (object store `modules`,
keyPath `id`), with a localStorage fallback and an in-memory last tier. Record shape:

```json
{ "id": "tremolo", "name": "Tremolo", "kind": "fx", "src": "...", "params": { "depth": 0.6 },
  "enabled": true, "savedAt": 1770000000000 }
```

After boot the page re-adds every **enabled** record through the same add path the editor uses;
disabled records stay on disk but do not load. Toggling the enable switch loads/unloads the
module and remembers the flag.

Export/import uses the `.avmod` format - a JSON text file:

```json
{ "format": "anvil-module", "api": 1, "id": "tremolo", "name": "Tremolo", "kind": "fx",
  "src": "...", "params": { "rate": 4, "depth": 0.6, "mix": 1, "on": 1 } }
```

Import refuses anything whose `format` is not `anvil-module` and any `api` other than `1`;
imported `params` are re-applied on top of the module's defaults, so a shared module sounds the
way its author saved it.

---

## 11. Message protocol (for integrators)

The page talks to the runtime (worklet port or direct call on the SPN tier) with `umod`
messages; replies start with `umod`:

```
in   { t: "umod", act: "add", id, name, kind: "fx"|"kind", src }
     { t: "umod", act: "remove", id }
     { t: "umod", act: "list" }
out  { t: "umodok", id, kind, kindId, params, fxIndex? }     // kindId is null for fx
     { t: "umodok", id, kind, kindId, removed: true }        // remove ack
     { t: "umoderr", id, error }                             // every refusal is one of these
     { t: "umodstat", id, data: [ { id, name, kind, kindId, params, poisoned, on, fxIndex } ] }
```

`handle()` never throws. The top-level runtime object is `window.AVUMOD`:
`{ version, apiVersion, ids(), kindById(id), kindIdByName(name), setKindParam(eng, path, value),
handle(eng, m, port), reset(eng) }` - `kindById` returns `null` for dead modules; `reset(eng)`
removes every user module belonging to that engine (rig cleanup).

---

## 12. Example 1 - Tremolo (fx)

The CODE card's library ships three MIT examples; their sources live in `src/av_code.js`
(`avCodeExamples()`). Tremolo modulates amplitude with a sine LFO:

```js
/* tremolo - a sine-LFO amplitude modulator (anvil CODE example, api 1, fx).
   WET convention: write st.oL / st.oR; the engine blends dry*(1-mix) + wet*mix.
   MIT - use it as the starting point for your own fx modules. */
return {
  api: 1,
  id: "tremolo",
  name: "Tremolo",
  kind: "fx",
  params: [
    { name: "rate",  min: 0.05, max: 20, def: 4,   step: 0.01, label: "Rate (Hz)" },
    { name: "depth", min: 0,    max: 1,  def: 0.6, step: 0.01, label: "Depth" },
    { name: "mix",   min: 0,    max: 1,  def: 1,   step: 0.01, label: "Mix" },
    { name: "on",    min: 0,    max: 1,  def: 1,   step: 1,    label: "On" }
  ],
  createState: function (cfg) {
    return {
      sr: cfg.sampleRate, phase: 0, step: 4 / cfg.sampleRate,
      rate: 4, depth: 0.6, mix: 1, on: 1, oL: 0, oR: 0
    };
  },
  setParam: function (st, path, value) {
    var name = path.slice(path.lastIndexOf(".") + 1);
    var v = Number(value);
    if (!isFinite(v)) return false;
    if (name === "rate") { st.rate = API.clamp(v, 0.05, 20); st.step = st.rate / st.sr; return true; }
    if (name === "depth") { st.depth = API.clamp(v, 0, 1); return true; }
    if (name === "mix") { st.mix = API.clamp(v, 0, 1); return true; }
    if (name === "on") { st.on = v > 0.5 ? 1 : 0; return true; }
    return false;
  },
  process: function (st, inL, inR) {
    var ph = st.phase + st.step;
    while (ph >= 1) ph -= 1;
    st.phase = ph;
    var g = 1 - st.depth * (0.5 - 0.5 * Math.cos(ph * API.TAU));
    st.oL = inL * g;
    st.oR = inR * g;
  }
};
```

Line by line:

- `params` declares the four controls. `rate` and `depth` are free; `mix` and `on` are the two
  names the runtime gives engine meaning (section 5), so declaring them wires the blend and the
  bypass for free.
- `createState` gets `cfg.sampleRate` and returns the module's whole world. It pre-seeds the
  same values as the declared defaults so the module is consistent even before the defaults are
  applied; `st.step` is precomputed from the rate.
- `setParam` takes the last dot-segment as the name. `Number(value)` + `isFinite` guard means a
  junk value is refused with `false`, never stored. `rate` recomputes the per-sample phase step
  so a rate change is heard immediately.
- `process` advances a wrapping phase in `[0,1)`, evaluates a unipolar sine `0.5 - 0.5*cos` for
  the gain `g` (1 at the peak, `1 - depth` at the trough), and writes the wet pair. It allocates
  nothing, calls nothing that can throw, and touches only `st`.

## 13. Example 2 - Bitcrush (fx)

Downsample-and-hold plus amplitude quantization - the classic lo-fi pair:

```js
function crush(st, x) {
  var i = Math.floor((x + 1) * 0.5 * st.levels);
  if (i < 0) i = 0; else if (i > st.levels - 1) i = st.levels - 1;
  return i / (st.levels - 1) * 2 - 1;
}
return {
  api: 1, id: "bitcrush", name: "Bitcrush", kind: "fx",
  params: [
    { name: "bits", min: 1, max: 16, def: 8, step: 1,    label: "Bits" },
    { name: "rate", min: 1, max: 64, def: 4, step: 1,    label: "Downsample (x)" },
    { name: "mix",  min: 0, max: 1,  def: 1, step: 0.01, label: "Mix" },
    { name: "on",   min: 0, max: 1,  def: 1, step: 1,    label: "On" }
  ],
  createState: function (cfg) {
    return { sr: cfg.sampleRate, bits: 8, levels: 256, hold: 4, count: 0,
             hL: 0, hR: 0, mix: 1, on: 1, oL: 0, oR: 0 };
  },
  setParam: function (st, path, value) {
    var name = path.slice(path.lastIndexOf(".") + 1);
    var v = Number(value);
    if (!isFinite(v)) return false;
    if (name === "bits") { st.bits = Math.round(API.clamp(v, 1, 16)); st.levels = Math.pow(2, st.bits); return true; }
    if (name === "rate") { st.hold = Math.round(API.clamp(v, 1, 64)); return true; }
    if (name === "mix") { st.mix = API.clamp(v, 0, 1); return true; }
    if (name === "on") { st.on = v > 0.5 ? 1 : 0; return true; }
    return false;
  },
  process: function (st, inL, inR) {
    st.count += 1;
    if (st.count >= st.hold) {
      st.count = 0;
      st.hL = crush(st, inL);
      st.hR = crush(st, inR);
    }
    st.oL = st.hL;
    st.oR = st.hR;
  }
};
```

Notes: `crush` maps `[-1, 1]` onto `2^bits` evenly spaced levels - one helper function declared
inside the module body is fine and is the usual way to keep a module readable. `rate` is a
hold factor: with `rate = 4` a new quantized sample is latched every 4th input sample (with the
output held in between) - sample-rate reduction; `count` is the downsampler clock. Both `hold`
and `levels` live in state, so `setParam` never recomputes anything per sample.

## 14. Example 3 - Fold (kind)

A complete voice: sine oscillator + attack/release envelope, run through a triangle wavefolder.

```js
function fold4(x) {
  var p = x % 4;
  if (p < 0) p += 4;
  if (p < 1) return p;
  if (p < 3) return 2 - p;
  return p - 4;
}
var Z = { fdFold: 0.35, fdAttack: 0.005, fdRelease: 0.4, fdLevel: 0.8 };
return {
  api: 1, id: "fold", name: "Fold", kind: "kind",
  params: [
    { name: "fold",    min: 0,     max: 1, def: 0.35,  step: 0.01,  label: "Fold" },
    { name: "attack",  min: 0.001, max: 2, def: 0.005, step: 0.001, label: "Attack (s)" },
    { name: "release", min: 0.005, max: 4, def: 0.4,   step: 0.001, label: "Release (s)" },
    { name: "level",   min: 0,     max: 1, def: 0.8,   step: 0.01,  label: "Level" }
  ],
  initEngineK: function (kext) {          // engine-wide params live on kext
    kext.fdFold = 0.35; kext.fdAttack = 0.005; kext.fdRelease = 0.4; kext.fdLevel = 0.8;
  },
  initVoiceK: function (k) {              // per-voice fields, created once, monomorphic
    k.fdPhase = 0; k.fdEnv = 0; k.fdAstep = 0.01; k.fdRc = 0.99; k.fdInc = 440 / 48000;
  },
  initVoice: function (eng, v) {          // per note: reset + derive this note's numbers
    var k = v.k;
    k.fdPhase = 0; k.fdEnv = 0;
    var kx = eng.kext || Z;
    var sr = (typeof eng.sr === "number" && eng.sr > 0) ? eng.sr : 48000;
    k.fdAstep = 1 / (Math.max(0.001, kx.fdAttack) * sr);
    k.fdRc = Math.exp(-4.6 / (Math.max(0.005, kx.fdRelease) * sr));
    k.fdInc = 440 * Math.pow(2, ((v.pitch || 60) + (eng.bend || 0) + (eng.tune || 0) - 69) / 12) / sr;
  },
  stepVoice: function (eng, v) {
    var k = v.k;
    var kx = eng.kext || Z;
    if (v.state === 2) k.fdEnv *= k.fdRc; else if (k.fdEnv < 1) k.fdEnv += k.fdAstep;
    if (k.fdEnv < 1e-5) k.fdEnv = 0;
    var ph = k.fdPhase + k.fdInc;
    while (ph >= 1) ph -= 1;
    k.fdPhase = ph;
    var drive = 1 + 9 * kx.fdFold;
    return fold4(Math.sin(ph * API.TAU) * drive) * k.fdEnv * kx.fdLevel;
  },
  releaseVoice: function (eng, v) { /* the release stage rides v.state === 2 in stepVoice */ },
  isVoiceDone: function (eng, v) { return v.state === 2 && v.k.fdEnv <= 0; },
  setParam: function (eng, path, value) {
    var kext = eng.kext;
    if (!kext) return false;
    var name = path.slice(path.lastIndexOf(".") + 1);
    var v = Number(value);
    if (!isFinite(v)) return false;
    if (name === "fold") { kext.fdFold = API.clamp(v, 0, 1); return true; }
    if (name === "attack") { kext.fdAttack = API.clamp(v, 0.001, 2); return true; }
    if (name === "release") { kext.fdRelease = API.clamp(v, 0.005, 4); return true; }
    if (name === "level") { kext.fdLevel = API.clamp(v, 0, 1); return true; }
    return false;
  }
};
```

Line by line:

- `fold4` is the wavefolder kernel: a triangle wave of period 4 in its input. Driving it with
  `sine * drive` folds the peaks back down whenever the drive exceeds 1 - at `fold = 0` the
  drive is 1 (nearly clean), at `fold = 1` it is 10 (heavily folded).
- `Z` is a fallback copy of the engine params. `eng.kext` always exists in the real engine, but
  reading through `eng.kext || Z` keeps the module honest and safe.
- `initEngineK` creates the four engine-wide knobs on the shared `kext` object; `setParam`
  writes the same fields, so knob moves apply to the next `stepVoice` immediately.
- `initVoiceK` creates every per-voice field ONCE (for every voice, at load). Keeping the voice
  shape fixed keeps the audio thread monomorphic.
- `initVoice` runs per note: it resets phase/envelope and derives the note's pitch increment
  (`440 * 2^((pitch + bend + tune - 69)/12) / sr`) and the envelope coefficients from the
  current attack/release. Both envelope constants follow the engine's own -40 dB law
  (`exp(-4.6 / (time * sr))`).
- `stepVoice` is the whole voice per sample: release decay when `v.state === 2`, otherwise a
  linear attack up to 1; wrap the phase; return `folder * env * level`. The engine multiplies
  the return by `v.vel` and the note fade, so the module never reads `v.vel` itself here.
- `isVoiceDone` only fires for released voices whose envelope has fully decayed - exactly what
  the engine needs to recycle the voice.
- `setParam` is reached for `<id>.<name>` paths (the engine's kind-prefix dispatch), including
  the id `fold` itself - the last-segment parse makes the id part irrelevant to the handler.

---

*Files: runtime `src/av_umod_wl.js` (top-level `AVUMOD`), page engine `src/av_code.js`
(`avCode*` API), CODE card UI `src/av_code_ui.js`. Contract: `verify/_s5_wave.md` section 2.B.*
