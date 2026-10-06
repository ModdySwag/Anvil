# T1 — Dittytoy deep-dive: platform method, synthesis patterns, srtuss/athibaul catalogues, licensing

Date: 2026-10-06 · Author: Hermes subagent (T1) · Scope: verification of the six seed extractions, platform anatomy from live docs + runtime bundles, the srtuss & athibaul catalogues, deep reads, licensing.
Method: everything below was fetched live on 2026-10-06 (build 308 of the site) with `curl` + Python extraction and byte-compared where verification is claimed. Six seed sources (`raw/*.js`) were diffed against the code block embedded in each live page's `<pre>` — **all six are byte-identical, no extraction gaps**. Parent digest (`T0-tab-digest.md`) claims were re-checked against the live pages and sources; corrections are noted per entry and in the verification log at the end.
Runtime artefacts fetched for this file: `js/ditty-all.js` (123,406 B), `js/ditty-worker.js` (58,300 B), `js/ditty-worklet-308.js` (11,548 B), `js/ditty-mp3-export.js` (13,472 B), `js/lame.min.js` (156,350 B), `js/ditty-no-sound.js` (11,170 B), `js/probeOffscreenCanvas.js` (3,258 B), `js/audioOffscreenCanvas.js` (2,591 B), npm tarball `dittytoy@1.0.8`.

---

### 1. DT303 (srtuss) — verified seed: full TB-303 acid voice
Link(s): https://dittytoy.net/ditty/0029103012 · created 2022/10/19 · licence CC BY-NC-SA 4.0 (API-confirmed)
Core contribution: complete acid line engine — PolyBLEP saw/square into a 2-stage 1-pole SVF with accent, slide, overdrive, and a cross-feedback ping-pong echo; live knobs with three shareable hash states published in the page description.
KEY FACTS (all re-read from the source, cross-checked live):
- Verified: `raw/dt303.js` is byte-identical to the live embedded code (7,160 chars).
- Osc: one phase accumulator; `pblep(t,dt)` 2-point PolyBLEP; `saw = ph*2-1-blep0`; `pw = max(.5,waveform)*.95`; `square = (ph>pw?1:-1) + pblep((ph-pw+1)%1,dtph) - blep0`; `v = lerp(saw, square, clamp01(waveform*2))`.
- Filter: two cascaded `SVFilter` (1-pole ladder-ish): `lp += kf*bp; hp = in - lp - kq*bp; bp += kf*hp; return lp`. `kf = 2 ** min(0, cutoff*7 - 7 + fenv*envmod*5 + aenv*.4)`; `kq = 1 - resonance*.9 - aenv*.1` (accent LOWERS Q → bite). Knob cutoff spans 7 octaves (`2^(7*cutoff-7)`).
- Accent semantics: on gate-start `fenv=1; att=0; aenv=accent`; attack ramp `att = min(att + dt/.0005, 1)` (0.5 ms); amp multiplied by `(this.aenv + 1)`; `aenv *= .9995`/sample; `venv *= .995`; `fenv *= exp(-(1-decay)*.004)`.
- Slide: gate stays open; `notecap += (note - notecap)*.0005` per sample (portamento); `dtph = midi_to_hz(notecap)*dt`.
- Overdrive: 7-tap symmetric kernel `[0.013475, 0.097598, 0.235621, 0.306612, 0.235621, 0.097598, 0.013475]` at 4× up/down-sampling, then `clamp(e*(1+od*8),-1,1)` per 4 subsample, `v *= .5` pre-stage.
- Sequencer: patterns = arrays of `[note,gate,slide,accent]` quadruples, 4 patterns, 16 steps each; step clock `dtclk = bpm/60*4*dt` per sample (16th-note grid); default `input.pattern=1` ("bad square, synthetic b*tch, chainsaw, flying" are the 0–3 names); bpm 138.
- Echo filter: delay = `60/bpm/2` ≈ 217 ms @138 (9,586 samples), cross-feedback L=.4 / R=.7 via a 500-sample `dside` line; wet × `input.echo`; loop connects `.connect(stereoEcho.create())`.
- Live inputs (defaults): gate .58, tune -18 (min=-24,max=24,step=.01), waveform 0, cutoff .28, resonance .6, envmod 0, decay 0, overdrive 0, pattern 1, echo .8.
- Hash-share evidence in the live page's `og:description`: 3 full state URLs, e.g. `#tune=-17.01,pattern=3,waveform=0.17485,cutoff=0.31084,resonance=0.78197,envmod=0,decay=0.74859,overdrive=0.55855,echo=0.50512,gate=.58`.
**Fold-in verdict:** ADOPT — this is the acid-engine spec (topology + accent/slide/decay semantics), reimplemented clean-room; the 7-tap kernel and the `2^(7c-7)` map are directly reusable constants.

### 2. Karplus synth with reverb (srtuss, fork of athibaul's) — verified seed: string module + allpass reverb
Link(s): https://dittytoy.net/ditty/827b1b3e63 · fork of https://dittytoy.net/ditty/0c920dd635 (athibaul, "Karplus-Strong string synthesis") · created 2022/10/18
Core contribution: Karplus-Strong plucked string with fractional delay + pluck-position comb, fed into a 12-delay-line allpass reverb; humanized performance of Bach's Cello Suite No. 1.
KEY FACTS (verified byte-identical to `raw/karplus.js`):
- KS: `len = floor(1/(freq*dt)) + 1`; fractional delay `fd = delay_samples % 1` with linear interp `lerp(buf[pos], buf[(pos+1)%len], fd)`; damping one-pole `a1 = clamp01(2π*cutoff*dt)` (cutoff default 2500 Hz → a1 ≈ 0.356); `s0 += a1*(value - s0)`; reinject `buf[pos] = lerp(value, s0, lowpass_amt)` (`lowpass_amt` .1); output `s0 * env.value`; envelope `{env:adsr, release:2.75}`.
- Excitation: 70 noise samples; pluck-position comb `buf[(i+offs)%len] += -buf[i]`, `offs = floor(len*(0.2 + 0.2*random()))` (20–40% along the string).
- Reverb (credit in code: spinsemi.com/knowledge_base/effects.html): 12 delay lines of 10–5000 random samples; four allpass stages (k=.5) each into a long delay scaled `krt=.7`; 8 stereo taps (offsets 111/2250, 311/1150, 511/50, 4411/540); output taps ×.1 + dry; M/S widening: `s *= 1.5`.
- Musical humanization: note `+ random()*0.01`, amp `(random()+0.5+(i%8==0?0.8:0))*.5`, pan `0.5*(2*((note*0.618)%1)-1)` (golden-ratio hash), `sleep(0.25+0.02*random())`; bpm 80.
**Fold-in verdict:** ADOPT — string/pluck module with pluck-position comb and the reverb lineage (also reused by techno beat 1 in reduced form).

### 3. Cosmic Drone (srtuss) — verified seed: additive crossfade-wavetable drone
Link(s): https://dittytoy.net/ditty/f110ff31e5 · created 2022/10/17
Core contribution: two 1024-sample additive wavetables continuously crossfaded ("morphing nebula"), 8 detuned ops per voice, chord stacks; two live knobs (radiation, nebula).
KEY FACTS (verified byte-identical to `raw/cosmic-drone.js`):
- Table synthesis: harmonics `harm[i] = .3*(1+i)^-1 * exp(-i*nebula)` (1/f rolloff, exponential damping), each `*= random()^3` (sparse buzzy spectrum), random phase per harmonic; sum over `nharm ≤ 512` (`min(nharm||512, len>>1)`).
- Morph: `morph += .000005` per sample → full cycle ≈ 200,000 samples ≈ **4.5 s**; on wrap, swap table refs and re-render the far table; per-sample output `wtb0[idx]*(1-morph) + wtb1[idx]*morph`.
- 8 ops, `ff = 2**((random()-.5)*radiation)` re-randomized at `shimmerc += 700*dt` → **every ~63 samples (~1.4 ms rate)** [NB: parent digest said "~1.4 s" — the code is a 700 Hz re-randomize rate ≈ 1.4 ms; corrected]; ops panned by index `p=i/(nop-1)`: `suml += opv*p; sumr += opv*(1-p)`; stereo widened `s *= 2`.
- Voice: played with `{duration:16, attack:5, release:5, nh:64}` and chord notes `[d4,c4,e4,b4]` with octave offsets chosen from `[-12,0,0,0,7,12]`, plus a `sine` sub an octave up per chord root; bpm 90; ~3 chord cycles per sleep(16).
- Inputs: radiation `min=0.1,max=.5,step=0.01`; nebula `min=0,max=2,step=0.01`.
**Fold-in verdict:** ADOPT — drone/additive engine spec (table builder + crossfade + detune-op shimmer), a factory-pack signature sound.

### 4. Blade Runner pad (athibaul) — verified seed: formant-saw ensemble pad
Link(s): https://dittytoy.net/ditty/7d36343a29 · created 2022/10/26
Core contribution: one synth instance renders an entire 7–8 note chord with per-note detune/pan/vibrato; parabolic formant window shapes each saw; two detuned pad layers + sparkle sine; 7 chord progression.
KEY FACTS (verified byte-identical to `raw/blade-runner-pad.js`):
- `varsaw(p, formant) = (x-0.5) * clamp01(formant*x*(1-x))`, `x = p%1` — saw × parabolic window whose width is the formant parameter (moves spectral centroid/timbre without a filter).
- Single-instance trick: `options.notes` array; `relfreqs = notes.map(nn => 2**((nn-root)/12) * detune)`; **one phase accumulator** scaled per note `phases = relfreqs.map(rf => phase*rf)`.
- Per-note: `vols = 1/√rf` (power normalization), `pans = sin(i + tick*√(6*rf))` (slow auto-pan), `vib = 1 + 0.3*cos(i + 12*tick*√rf)`; osc `varsaw(p, 30*env.value*vols[i]*vib[i]) * vols[i]*0.1*env.value`; stereo split by pan coefficient and summed.
- Explicit in-code perf note: "If you want to play many notes at the same time with the same timbre, the best option is to use a single synth managing all notes at the same time. This avoids the overhead of individual synth management by the API."
- Arrangement: 7 chords (c2..bb1 roots); layer A detune 1, layer B detune 1.01 offset 1 tick; `{attack:5, decay:5, sustain:0.7, duration:10, release:3}`; sparkle = random chord note + random octave, sine, `{amp:.1, attack:.01,...}`, random pan; bpm 60.
**Fold-in verdict:** ADOPT — the ensemble-pad voice (varsaw + single-phase multi-note + 1/√f normalization + auto-pan/vibrato laws give the lush movement cheaply).

### 5. Techno beat 1 (srtuss) — verified seed: drum kit + bus FX + compressor
Link(s): https://dittytoy.net/ditty/b3585fb3a3 · created 2022/11/13
Core contribution: modern techno instrument pack — Cytomic trapezoidal SVF used for kick/perc/hat/noise, per-cycle build-up HP on master, shared allpass reverb and a shared peak compressor across three loops; "slightly different with each playback".
KEY FACTS (verified byte-identical to `raw/techno-beat.js`):
- SVF (credit verbatim in code: "cytomic Sound Music Software — https://cytomic.com/files/dsp/SvfLinearTrapOptimised2.pdf"): state (ic1eq, ic2eq); `v3 = input - ic2eq; v1 = a1*ic1eq + a2*v3; v2 = ic2eq + a2*ic1eq + a3*v3; ic1eq = 2v1-ic1eq; ic2eq = 2v2-ic2eq`; taps lp=v2, bp=v1, hp=in-k*v1-v2, ap=lp+hp-k*bp; `g = tan(π*fc)` with callers passing `svf.fc = Hz * dt` (also `svf.fc*.5` internally — quoted exactly); `k = 1/q`, `a1 = 1/(1+g*(g+k)); a2=g*a1; a3=g*a2`.
- Kick (`bd`): sine `sin(ph*2π)` with pitch env `lerp(700, midi_to_hz(note), clamp01(t*50)**.25)`; noise through `svf` (350→200 Hz) + band-pass `svfw` (fc .03, q 2); two exponential noise bursts (`exp(-20t)*.5`, `exp(-80t)*.4`); waveshaper `fold11((v + kickWsAsym - .5)*env.value, kickWs1)` with fold01/fold11 reflection; input knobs kickWs1 .58, kickWsAsym .52; `{duration:.02, release:.6, attack:.0001}`; played with random release `[.3,.6]`, plus 2 ghost hits pan ±.2.
- Percussion (`perc`): body sine optional; pitch `midi_to_hz(note) + fDrop*clamp01(1-t*50)`; twin SVFs bp/hp per side; filter env `lerp(fcBase+fcEnv, fcBase, clamp01(t*fcEnvSpeed))`; hat = hp @ 4000; long noise sweep release(14) with fcEnv 8000.
- Master `post` filter: HP with per-16-tick-cycle build-up `fc = clamp01((16-x)*2)*.006*(1+max(0,x-8)*.1)+.0005` where `x = ditty.tick%64`.
- `distructor`: `signed((x*ws0+ws1)*10, v=>nonlin(v)**.5)` → `nonlin(x)=min(x-(clamp(x,.4,.6)-.4)*2,.6)` — soft asymmetric fold; SVF bp parallel taps ×.4/×.8.
- Compressor (`.createShared()`, credit "Using a shared filter for compression"): peak follower (instant attack, `peak *= .9999` release), `gain2dB = log10(v)*20`; `compression = max(0, dB - threshold)`; `dgain = 10**(-compression*ratio/20) * makeup`; ratio .9, threshold input default -15 (min -30), makeup 1..4, on/off.
- Reverb shared: krt .5, wet option .04/.2, predelay `60*.425/bpm/dt` samples, pre-dist `clamp(x*dist,-1,1)` (dist 5 on kick).
- Sequencing: kick 16×3 strokes (amp .4/.08/.09); perc uses per-step random `series = random()**2` for filter/duration/amp/pan, swing ±.04 on alternating 16ths; bpm 138; every loop `.connect(reverb).connect(post).connect(compressor)`.
**Fold-in verdict:** ADOPT — drum bus chain + compressor spec and the "build-up HP per cycle" trick; the shared-filter compressor is our master-bus model.

### 6. New-ditty boilerplate — verified: the instant-start surface
Link(s): https://dittytoy.net/ditty/new
Core contribution: the starter a first-time visitor gets — triangle synth lambda, stereo one-pole LPF, 4-note loop that plays immediately; sets the tone for first-run UX.
KEY FACTS (verified byte-identical to `raw/boilerplate-new.js`):
- `ditty.bpm = 120`; `triangle = synth.def((phase, env) => (Math.abs(phase % 1 - .5) * 4 - 1) * env.value)`; LPF filter class with per-channel one-pole `this.l += (input[0]-this.l)*options.cutoff` (cutoff .1); loop plays c4×4 (pan random), d4, f4 with `sleep(0.25/0.5)` ticks; `.connect(lpf.create())`.
- Template header contains the platform's AI policy verbatim: "Dittytoy is a community for creative coding. We believe the joy is in the craft. … Please do not publish code entirely generated by AI. We want to see YOUR creativity, your mistakes, and your logic. If you use AI to learn, try to rewrite the code yourself before sharing, so others can learn from your human approach." (also restated on /about and enforced via /terms: "Ditties that appear to be primarily AI-generated may be set to Unlisted at our discretion.")
- Links in template: API reference https://dittytoy.net/syntax, examples user https://dittytoy.net/user/Dittytoy.
**Fold-in verdict:** ADOPT (UX lesson only) — first-run must make sound on one click; our knobbed surface should keep a comparable "instant instrument" default patch.

### 7. Syntax/API reference (live doc) — the method ground truth
Link(s): https://dittytoy.net/syntax
Core contribution: the complete Dittytoy API reference; verified against the parent's text extraction (`raw/dt_syntax.txt`, similarity 0.956 — raw is a faithful text dump; all key sections re-quoted from live HTML below).
KEY FACTS:
- Building blocks: Synthesizers, Loops, Envelopes, Filters, Options, Input Parameters, Optimizations, built-ins.
- Timing: "A tick (or beat or a quarter note)" = `60/bpm` s; default bpm 120 → 0.5 s/tick; `tick_to_second` / `second_to_tick`. Note names C0–B9 predefined (`Fs3` sharp, `Eb3` flat); `midi_to_hz` / `hz_to_midi`; stereo = return `[left, right]`; built-in `sine` synth.
- Loop semantics (verbatim): "The duration of a loop (in ticks) is equal to the total sleep time of all sleep function calls in the loop combined." · "calling a play method on a synth does not take time and is independent of the duration of the note being played." · "Every time Dittytoy starts a new iteration of a loop, the entire body of the loop is evaluated instantaneously. All play-calls are collected and sorted based on the intervening sleep times and put on a timeline before playback starts." · `sync` option can force loop length.
- Worker capture (verbatim): "A side effect of having each loop run in a separate worker is that it captures all global variables. This makes it impossible to use (global) variables to communicate between different loops." Also `ditty.bpm` is per-worker: "when you modify ditty.bpm within a loop, this will not affect the ditty.bpm in other loops or the global context."
- Dynamic options: any option can be `(tick, options) => ...` lambda; `note` is an alias for `options.note`; option assignments record their tick (portamento via `s.options.target = d4; sleep(1.0); ...`); Shepard tone example by athibaul.
- Filters: default `create()` runs inside the loop's thread; `createShared()` runs as its own worker for cross-loop processing; "after you connect a loop to a shared filter, you cannot connect it to subsequent filters" · "using shared filters will increase latency a bit."
- Envelopes: `env.def`, built-ins `adsr` (attack/decay/sustain/release, curve), `adsr2` (explicit levels), `segenv` (levels/times/curves), `one`.
- Debug: `debug.log/warn/error(label, message)`; `debug.probe(label, value, amp, duration)` renders an oscilloscope (Safari not supported); "a probe expects one value per sample".
- Array/String extensions: `.ring(i)` (= `arr[i%len]`), `.choose()`, `.mirror()`.
- Input parameters: slider default range "0 to 1"; `input.value = x; // min=x, max=x, step=x`; pull-down variant `// value=0, min=0, max=1, step=1 (No, Yes)`; async caveat quoted in entry 10.
- Optimizations section — see entry 8 for the full guidance quotes.
**Fold-in verdict:** REFERENCE — the API surface to imitate partly (block model, tick timing, options-as-object-with-lambdas); the code-first surface itself is Pattern Forge's domain.

### 8. Execution model: loop → worker, sleep semantics, MSG protocol + the docs' optimization guidance
Link(s): https://dittytoy.net/js/ditty-worker.js · https://dittytoy.net/syntax (Optimizations, Loops sections)
Core contribution: how Dittytoy turns code into sample-accurate audio across workers — the exact semantics our engine should either mirror (timeline scheduling) or consciously replace (AudioWorklet-centric, per our plan).
KEY FACTS (from the worker bundle, quoted):
- Constants: `BUFFER_LENGTH = 128 * 5` (= **640** frames — five 128-frame render quanta), `NUM_BUFFERS = 4`; node types LOOP/INLINE/FILTER/OUT; `RUN_AS_WORKER=0 / RUN_AS_INLINE=1`.
- MSG protocol (verbatim enum): `MSG_INIT=0, MSG_RESET=1, MSG_LOG=2, MSG_ERROR=3, MSG_ANALYZE_STRUCTURE=4, MSG_WORKLET_READY=5, MSG_UPDATE=6, MSG_NOTE_PLAYED=7, MSG_SET_AMP=8, MSG_SET_VARS=9, MSG_PLAY=10, MSG_STOP=11, MSG_PAUSE=12, MSG_RESUME=13`.
- `sleep(time) { ditty.tick += time; }` — sleep is a tick accumulator, not a timer. `LiveLoop.evalLoop()` re-runs the loop body when `ditty.tick >= this._endTick`; the body's `play` calls are captured as operators with `startTick` and dispensed to actual voices when their startTick is reached (`this._operators[this._operatorIndex].startTick < ditty.tick`).
- Loop end calculation: `_endTick = round((sync > 0 ? floor(tick/sync + 1)*sync : tick + duration) * 1e3)/1e3`; if a loop "has no duration. Use sleep() or set sync option." → debug warning.
- Option writes inside a loop become `LOOP_OPERATOR_OPTION` entries and are applied at their recorded tick (this is the portamento/automation mechanism).
- Clock: per sample the worker runs `this.time += this.dt; this.tick += this.dtick` where `dt = 1/sampleRate` (44,100) and `dtick = bpm/(60*sampleRate)`.
- Notes table: `midi_to_hz = midi => (2 ** (midi/12 - 5.75)) * 440` (c4=60=a middle C 261.63 Hz); full `notes` map exported to globals (C0..B9 + enharmonics + octave-less aliases like `c`,`cs`,`db`).
- Pan law: 1024-entry tables, `panleft[i] = sin(π/2*(1-i/1024))*√2`, `panright[i] = cos(...)*√2`; index `(clampWave(pan)*511 + 512|0) & 1023` — constant-power.
- Envelopes (envBase): segment model `levels[] / times[] / curves[] / releaseNode`; per-segment count `(endTick-tick)/dtick`; linear grow `(target-value)/count`; exponential `_a1 = (target-value)/(1-exp(curve)); _a2 = value+_a1; _grow = exp(curve/ceil(count)); value = _a2 - (_a1 *= _grow)`. `adsr` defaults: attack 0, decay 0, sustain 1, release .5, curve -2 (levels [0,1,sustain,0], times [attack,decay,release], releaseNode 2). `adsr2`: 5 explicit levels. `segenv` defaults levels [0,1,.5,0] times [.1,.1,.25] curves [0,-2,-2] duration .5. `one`: value 1, duration 1e100.
- Docs optimization guidance (verbatim, /syntax#optimizations): "CPU will always be a limiting factor when you want to execute javascript 44100 times per second in the browser." · "Try to minimize the number of synths active simultaneously… reduce this duration [envelope] without any audible effect." · "spread active synths over several loops. Each loop runs in its own worker and thus is an excellent way to parallelize the ditty." · "reduce the number of instructions in the process loop? Are there memory allocations that you can move to the constructor?" · "move them to a separate worker by creating a shared filter."
- Platform scale line in the UI (ditty-all.js): "`X loop(s), Y filter(s) (Z worker, 1 AudioWorklet)`" — filters listed separately from worker count.
**Fold-in verdict:** ADOPT (semantics: timeline-recorded play/option events at tick resolution; per-sample process contract) + REFERENCE (worker-per-loop parallelism; our AudioWorklet will own mixing).

### 9. Graph runtime: compile → workers → Audiobus → one AudioWorklet
Link(s): https://dittytoy.net/js/ditty-all.js · https://dittytoy.net/js/ditty-worklet-308.js · https://dittytoy.net/js/ditty-no-sound.js
Core contribution: the complete main-thread architecture — code is compiled to a structure description, each node becomes a worker, audio is pulled from workers in fixed buffers and mixed by a single AudioWorklet; buffers are recycled over MessageChannel with zero-copy transfer.
KEY FACTS:
- Worklet URL is versioned: `js/ditty-worklet-${buildNumber}.js` (build 308 live; bare `/js/ditty-worklet.js` is a 404-fallback SPA page — see dead-ends).
- `compile(code)`: runs the code in a throwaway worker (`MSG_ANALYZE_STRUCTURE`), which executes it to collect `{bpm, sampleRate, loops:[{name,nodeType,runAs,out}], filters:[...]}`. If no loop is found, the code is auto-wrapped: `` loop(()=>{${code};\n},{name:'loop_0',sync:1e10}); ``.
- `setupWorkers()`: one `Worker` per loop and per RUN_AS_WORKER filter; each gets 4 recycled `Float32Array(640*2)` buffers + a `MessageChannel`; `MSG_INIT` transfers `channel.port1`, the 4 buffers and the input ports. Graph edges are computed by matching a consumer's `{nodeType, name}` against producers' `out` field.
- Buffer recycling: consumers post finished buffers back (`{type:'data', buffers: oldBuffers}` with transferables) — the pool is the flow-control mechanism. `Audiobus.checkIfEnoughBuffersAvailable()` starts playback only when **every** input has > 3 buffers queued; a producer that misses a buffer triggers `debug.error('Performance error', "<name> can't keep up.")` and a stop.
- Mixing (Audiobus.fillBuffer): per-input smoothing `amp += (targetAmp - amp)*0.001` per sample; sum; optional master ×.5; RMS metering `volumeSqr` window of 512 with `volume = max(.9*volume, sqrt(volumeSqr/512))`.
- AudioWorklet (`registerProcessor('ditty-worklet', DittyWorklet)`, quoted from ditty-worklet-308.js): keeps a 640-frame mix buffer; `process()` copies it out in **128-frame quanta** (`out[0].length`), advances `ditty.tick += dtick*128; ditty.time += dt*128`, and every 640 frames posts `MSG_UPDATE` with `{amp, debug, state:{tick,time,bpm}}` — i.e. ~69 updates/s (44,100/640; package README says "~60 times per second").
- Audio graph bootstrap: `new AudioContext({sampleRate: 44100})`; a **silent looping AudioBufferSourceNode** (1 s of silence, loop=true) is started and connected `→ ditty-worklet → destination` (keeps the context running on all browsers/policies).
- No-sound mode: `js/ditty-no-sound.js` consumes the same worker buffers with no worklet (used for muted/passive views); visualizers/probes render in two dedicated workers (`js/probeOffscreenCanvas.js`, `js/audioOffscreenCanvas.js`) via transferred `OffscreenCanvas`.
- Media Session: `navigator.mediaSession` playbackState + `MediaMetadata` set for background playback.
- MP3 export is a fourth consumer of the same worker outputs (next entry).
**Fold-in verdict:** REFERENCE — this is the "engine topology to learn from": fixed 640-frame buffers, pool of 4, transfer-based zero-copy, one mixing worklet. Our build can adopt the buffer-pool + worklet-mixer idea while keeping DSP inside our own AudioWorklet(s).

### 10. Input parameters → UI → URL hash → MIDI Learn (the shareable-state system)
Link(s): https://dittytoy.net/js/ditty-all.js · https://dittytoy.net/syntax#input-parameters
Core contribution: code annotations become a live UI; every value round-trips through the URL hash (share a link = share the exact sound state), and can be mapped to a hardware MIDI control.
KEY FACTS:
- Parser regex (verbatim from ditty-all.js): `/^\s*(input.)\s*([a-z0-9_]+)\s*=\s*([-\d\.]+)[;\s]*\/\/\s*min\s*=\s*([-\d\.]+)[,\s]+max\s*=\s*([-\d\.]+)[,\s]+step\s*=\s*([-\d\.]+)(?:[,\s]*\(([^)]*)\))?(?:[, \t]+(.+))?/gmi` — groups: 2 name, 3 default, 4 min, 5 max, 6 step, 7 `(comma,seperated,names)` enum, 8 trailing comment/tooltip. A fallback regex also accepts `input.name = number;` (default range 0..1).
- Enum → dropdown when `v.step > 0 && v.values.length === (max - min)/step`; option value = `min + index*step`.
- `FormVar` defaults: min 0, max 1, step 0.00001; step auto-clamped to `min(step, 10^-maxDecimals)` so sliders never exceed value precision.
- UI grouping: variable names are grouped by their leading lowercase prefix before the first `_` or camelCase hump (`input.kickWs1`, `input.snareBatterSpeed` → group "kick"/"snare") and rendered as columns — free parameter organization from naming convention.
- Hash round-trip: `window.location.hash = vars.map(t => escapeVarName(t.name) + '=' + escapeVarToHashVar(t)).join(',')` with a **1500 ms debounce**; `escapeVarToHashVar`: commas→`;`, spaces→`$`, newlines stripped, text values `@`+base64 (`btoa(unescape(encodeURIComponent(s)))`, `=` stripped); `escapeHashVarToVar` reverses it. A "restore" button sets `window.location.hash = ''` and resets defaults; a "randomize" button randomizes every var.
- Worker side: `setVars(vars) { vars.forEach(kv => input[kv.key] = parseFloat(kv.value)); }` — all values arrive as floats; doc caveat (verbatim): "Updating the input variables from user input is asynchronous and will not happen simultaneously for all loops. So if you want to change, for example, the beats per minute using an input variable, you can be sure that your loops will be out of sync very quickly."
- MIDI Learn (`WebMidiVars` class): per-slider MIDI button; learn mode maps the next received CC; mapping persisted in `localStorage` under key `midi-mapping-<dittyId>`; CC→value `min + (val/127)*(max-min)`; selects pick `floor(val/127*options.length)`; docs: "The mapping is saved in your browser and will be restored when you revisit the ditty."
- Live proof of use: DT303's page description publishes three `#tune=…,pattern=…` state URLs (entry 1).
**Fold-in verdict:** ADOPT — "parameters as first-class objects, shareable via link" is a core product lesson; the annotation grammar (min/max/step/enum) is a proven, extremely cheap UI generator; MIDI-learn + hash state we should reproduce natively.

### 11. MP3 export chain (offline render → lamejs encode) and its licence
Link(s): https://dittytoy.net/js/ditty-mp3-export.js · https://dittytoy.net/js/lame.min.js · UI in https://dittytoy.net/ditty/0029103012 (export dialog)
Core contribution: one-click MP3 bounce — a dedicated worker re-renders the ditty offline from the same worker graph and encodes with an in-browser LAME port; fades and bitrate are user options.
KEY FACTS:
- Chain: `encodeMP3()` stops playback, reboots the worker graph, spawns `js/ditty-mp3-export.js` (13,472 B) which does `importScripts('./lame.min.js')` (156,350 B; embedded version string `getLameVersion() → "3.98.4"` / `"LAME3.98r"` — the zhuker/lamejs JS port of LAME; npm `lamejs` metadata declares **LGPL-3.0**; LAME itself is LGPL. No licence header ships in the served lame.min.js file — for reuse, carry the LGPL notice / dynamic linking assessment).
- Offline render: pulls buffers from the same worker output channels as fast as available (`dataAvailable()`/`fillBuffer()` with `await delay(1)` every 200 buffers), for `state.sampleRate * duration` samples at 44.1 kHz stereo.
- Encoder: `new lamejs.Mp3Encoder(2, 44100, bitRate)` — **default bitRate 320 kbps** (UI field `#mp3Bitrate`; duration `#mp3Duration`, fades `#mp3FadeIn/#mp3FadeOut`); progress events every 200 buffers; result `new Blob(buf, {type:'audio/mp3'})` downloaded via `downloadFile`.
- Gains: fade-in/out are squared curves computed in samples (`fadeIn*44100`, `amp = clamp01(...)**2`); float→int16 `s<0 ? s*0x8000 : s*0x7FFF`.
- The npm package `dittytoy` (MIT) does NOT include MP3 export (no LAME in the bundle) — export is site-only.
**Fold-in verdict:** ADOPT — "render offline from the same graph, then encode" is exactly the export architecture for Anvil; pick encoder license deliberately (lamejs is LGPL — acceptable as a dynamically-loaded worker dependency with notice, or swap for a permissive encoder).

### 12. Licensing, terms, and exactly what a third party may reuse
Link(s): https://dittytoy.net/terms · https://dittytoy.net/api/v1/ditty/0029103012/license · https://www.npmjs.com/package/dittytoy · https://github.com/srtuss/dittytoy-library · https://dittytoy.net/about
Core contribution: the definitive reuse rules for the Anvil build, with verbatim licence text and the one genuinely reusable code asset (an MIT runtime package by the Dittytoy author).
KEY FACTS:
- Per-ditty licence modal (DT303 and every sampled ditty): "This ditty is licensed under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International." API (`/api/v1/ditty/<id>/license`) returns `{"fullName":"Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International","shortName":"CC BY-NC-SA 4.0","url":"https://creativecommons.org/licenses/by-nc-sa/4.0/"}` for all 10 ditties probed (incl. all six seeds + Acid Warrior, Snare, Fat kick, Feedback FM, AA, Trippy FM, StepperMusic, Karplus original).
- Licences CAN vary per ditty. /terms verbatim: "All ditties you submit to Dittytoy belong to you. You decide which license applies to every ditty you create. We recommend that you paste your preferred license on top of your code." · "If you don't place a license on a ditty, it will be protected by the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0) License by default." · "When you post a ditty to Dittytoy, you agree to allow others to view and fork the ditty." · "When you post a ditty to Dittytoy, you also grant other websites to embed your Public and Unlisted ditties via our embed tools." · "Dittytoy allows third parties to access Public Information via the Dittytoy JSON API."
- npm package `dittytoy@1.0.8` (by Reinder Nijhoff, the platform author): **MIT** — "MIT License / Copyright (c) 2025 Reinder Nijhoff / Permission is hereby granted, free of charge, to any person obtaining a copy of this software…". Ships `dittytoy.js` (ESM, 80,748 B), `dittytoy.umd.cjs`, `index.d.ts`, zero dependencies; API: `compile(code)`, `play/pause/stop/resume`, `setVolume({master|loops})`, `setInputParameters([{key,value}])`, `addListener(MSG_*)`; exports the same MSG_* / BUFFER_LENGTH / NUM_BUFFERS constants; embeds the worklet via Blob URL. No MP3 export included.
- `github.com/srtuss/dittytoy-library` (referenced at the top of Acid Warrior's code): **no licence file** (GitHub API `license: None`) → all rights reserved; treat as reference-only. (His ditty code is CC BY-NC-SA.)
- About page, the site's own etiquette statement (verbatim): "Every ditty on this site has its source code visible. See a sound you like? View the code and learn how it works. Check the license before publishing a remix."
- AUTHOR'S GUIDANCE: the author's ditty sources (srtuss, athibaul) are all CC BY-NC-SA 4.0 unless a per-file header says otherwise (none seen on the six + deep reads).
- **Conclusion for Anvil** (commercial-capable): (a) copying ditty code into the product = NO (NC blocks commercial use; SA would infect distribution terms); (b) reimplementing the *techniques/math* from published sources = OK — algorithms, formulas and DSP topology are not copyrightable, and the ditties themselves credit the underlying papers (Cytomic SVF, DAFx ADAA, Spin Semi allpass, Moog-ladder papers) — cite those papers, not the ditties; (c) using the MIT `dittytoy` package = OK with the licence notice retained (credit "Dittytoy © Reinder Nijhoff, MIT"); (d) attribution etiquette: credit musically where a specific patch inspired a factory preset ("technique after srtuss, dittytoy.net/ditty/0029103012") and never imply endorsement.
**Fold-in verdict:** ADOPT as the licensing policy section of the build plan.

### 13. srtuss catalogue (20 ditties — live user page, all CC BY-NC-SA 4.0 default)
Link(s): https://dittytoy.net/user/srtuss (server-rendered; parsed from JSON-LD `ImageGallery`)
Core contribution: the fullest single-author body of ditty DSP; 20 items, several directly relevant to the build. Relevance tags: [acid] [drums] [pad] [phys] [fm] [seq] [fx].
1. DT303 — `0029103012` — [acid] full 303 emu (seed, entry 1)
2. Karplus synth with reverb — `827b1b3e63` — [phys] (seed, entry 2)
3. Cosmic Drone — `f110ff31e5` — [pad] additive drone (seed, entry 3)
4. techno beat 1 — `b3585fb3a3` — [drums][fx] (seed, entry 5)
5. Acid Warrior — `d2801bd785` — [acid][seq] "Happy 303 Day" (2026/03/03) — deep read entry 15
6. Snare Drum — `a0ec5e5a23` — [drums] realistic snare/clap, 10 knobs — deep read entry 16
7. 93' Ditty Jungle — `ad77e03e84` — [drums][seq] "Mixing sampling & synth techniques" (2023/05)
8. dance_to_the_rhythm.mod — `e910e130a3` — [seq] "Minimalist Protracker player inside Ditty" (2025/02) — deep read entry 20
9. DAFX basics: Pitch Shift — `e005e510e5` — [fx] "digital audio effects basics" (2023/12)
10. Sonate Of The Sonars — `080f0719ab` — [fx] "filter demo" (2026/03, newest)
11. Amplitude decay — `01257cf38d` — [env] linear vs exponential decay comparison
12. Oxygene4.js — `24373308b4` — [synth] Oxygène Pt. 4 cover; the echo filter reused by athibaul's StepperMusic (cross-author credit etiquette)
13. Intergalactic Planetary — `9349a15ee5` — [synth] robot voice (Beastie Boys)
14. Für Elise | Grand piano — `512c645bd3` — [phys] "east coast" piano synthesis, contest entry
15. Ditty by Ditty — `cef878f9e1` — [synth] "Ditty-style cover — who even needs a DAW?"
16. Wizards & Warriors C64 Remix — `c35f3133c0` — [chip] C64 remix
17. Monogon — `71967e0cde` — [synth] (2024/06)
18. Christmas Planet — `5f55165fc5` — [cover] (2023/12)
19. In the Bleak Midwinter — `6bf76a9c81` — [cover] (2024/12)
20. Fork: Breakbeat experiment — `34b39abc6f` — [drums] fork of athibaul's "Backbeat experiment" (`ee9a7420a7`), "funky rhythms" (2024/07)
**Fold-in verdict:** ADOPT (entries 1–8 as factory-pack seeds/specs; others as style references).

### 14. athibaul catalogue (47 ditties — live user page, all CC BY-NC-SA 4.0 default)
Link(s): https://dittytoy.net/user/athibaul (server-rendered; parsed from JSON-LD `ImageGallery`; 47 items)
Core contribution: the platform's synthesis R&D lab — physical modelling, FM, anti-aliasing, envelope/critical-damping experiments, all with unusually good explanatory descriptions. Most build-relevant first:
- [fm] **Trippy FM** `344f7c2d34` — two saw oscillators, saw-modulated FM (deep read companion, entry 18); **Feedback FM** `66d8b71e96` — self-modulating FM (deep read companion, entry 18); **Electric Piano 1** `5f66552091` — FM electric piano playing jazz (2022/10)
- [phys] Karplus-Strong original `0c920dd635` (the one srtuss forked); **Variable stiffness** `641a569829` — plucked string from guitar → bells/metal bars; **Piano with hammer** `ae112fdb2a`; **Church bell** `97628284a7`; **Simplified clarinet** `42f7d55903` (DWG synthesis); **Flute + Fauré's Pavane** `02b33cf17f`; **Organ Pipe Trendline Synthesis** `0ab9e3854c`
- [drums] **Fat kick** `57d4ff2921` (deep read entry 17); **Fork: Wide snare** `2c553a9f00` (forked from Ollerich's snare — 2nd cross-author chain); **Backbeat experiment** `ee9a7420a7` (forks: srtuss `34b39abc6f`)
- [fx] **Antiderivative anti-aliasing** `7df07948ca` (deep read entry 19); **Shared filter: compressor** `9d16ed4102`; **Audio EQ Filters** `b0737467eb` (Audio EQ Cookbook, designed for copy-reuse); **Artificial reverberation** `b5d2597d97` + **2** `43e88f64f4` (Fibonacci/Hadamard network reverbs); **Vocoder Puccini** `6f30b0885d`; **DAFX pitch shift** is srtuss's
- [seq] **StepperMusic** `0952e54668` (deep read entry 20); **Rameau | Allemande** `bd3257fcfd` (custom notation)
- [synth] **Saw Pluck** `ac8bd9bb8c` ("classic plucky sawtooth bass" — acid-adjacent); **Filtered sawtooth** `4eba7db501` (the "analog" filtered-saw idiom); **A hacky mono synth** `a798ac6f3b` + **How do I create a mono synth?** `662d460791` (portamento thread; monophonic voice management); **Sine with recurrence formula** `59300f01a0` (1 mult/sample sine; 2 for decaying); **Shepard tone 2** `b7a34fd7b0` / **Shepard scale** `fc047b2613`; **Bunimovich Stadium** `78d5274e22` / **Logistic map** `5f616c4d4d` / **Van der Pol oscillator** `8683f717fb` / **Thomas' attractor** `3409db1471` (chaotic/nonlinear oscillator family — "timbre modulators")
- [other] Philip Glass 'Opening' `13d7ee15e5`; String orchestra `9334688637`; Rameau Synthwave `142ba913c2`; Für Elise | EP1 `bbaf405e65`; Oxygene Pt 4 - optimized `59b8a8d54d` (optimization case study); Rainy Night `ea22c668ca`; Futuristic Cityscape `779e8d63e2`; Morphology `627dc75561`; Preys and predators `88281278d2`; Whistled Speech `ba926830fc`; -- --- .-. ... . `6bf9246f46`; All I Want For Christmas `49e1f66678`; Fauré with reverb `900d59c1f0`.
**Fold-in verdict:** ADOPT (deep-read picks + candidate subjects for reference-only study); the catalogue demonstrates the platform's culture of *documented craft*, worth imitating in our preset/patch notes.

### 15. DEEP READ — Acid Warrior (srtuss, 2026/03/03): the modern acid architecture
Link(s): https://dittytoy.net/ditty/d2801bd785 ("Happy 303 Day"; 322 lines; includes "The Dittytoy Library v1.0" minified helpers)
Core contribution: an evolved acid engine over DT303 — **ZDF Moog ladder filter**, one continuous voice driven by scheduled "poke" events, Euclidean rhythm generation, swing, sidechain ducking filter, ring-mod master. This is the most valuable single artifact in the whole research pass.
THE MATH / KEY FACTS:
- **`Bob` — Zero-Delay-Feedback 4-stage Moog ladder** (named class; the tanh/x approximation identifies D'Angelo & Välimäki's improved Moog ladder model): `sf(fc){ f = tan(π*fc*dt); }`, `sq(reso){ r = (40/9)*reso; }`; per sample: half-sample input average `ih = 0.5*(v0+zi)`; four tanh stages via `tanhXdX(x) = ((a+105)*a + 945) / ((15*a+420)*a + 945)` with `a = x²` (a Padé-style approximation of tanh(x)/x); gains `g_i = 1/(1+f*t_i)`; closed-form ladder solve `y3 = (g3*s3 + f3*g2*s2 + f2*g1*s1 + f1*g0*s0 + f0*v0) / (1 + r*f0)` with `t0 = tanhXdX(ih - r*s3)`; trapezoidal integrator updates `s_i += 2f*(...)`; returns `.lp`; also reads `.hp` at the input stage.
- Voice `syc`: `natural(v) = 20 * 2**(clamp01(v)*9.9657)` maps 0..1 → 20 Hz..~20 kHz; PolyBLEP saw/pulse (`pw = .48`); pre-highpass `SVF.sp(150,1).hp` for bite; cutoff modulated `natural(.2 + sin(t*.1+a)*.1 + .4*exp(-syp.t*4))`; envelope: gate → `en = min(en + dt*5000, 1)`, release `en *= .995`; output `clamp(s*10,-1,1)*.1`; note glide `syp.n += (syp.nn - syp.n)*.001` per sample (custom replacement for the worker-side portamento because this voice is played once).
- **`poke` event pattern**: `__pks = synth.def((p,e,t,o)=>o.f.length ? (o.f.pop()(),0) : 0)` — a "synth" whose process pops a closure from the options array (options are timeline-recorded), letting the sequencer run arbitrary code at exact sample-ticks; the acid voice is a single `duration:1e38` instance and the sequencer writes `syp.nn`/`syp.g` via pokes. Pattern: `[12,0,17,25,12,24]`-type melodies, length chosen `[5,8,16].choose()`, slides `[0,0,1].choose()`, note at +0.15 ticks, gate-off at +1/4.
- **Euclidean rhythms**: `rhy(k,n)` = k-hit Euclidean distribution over n steps via concatenation algorithm; used as `shift(rhy([9,6,7,5].choose(), 16), 2)` for hats/claps/piano.
- **Swing**: `sleeps(v)` splits each step into `oo = 1+floor(v*100)` sub-steps alternating `1+sf` / `1-sf` with `sf = min(ditty.swing, .5)`; `ditty.swing = .05` is a *custom* extension (not a platform feature).
- **`scf` sidechain filter** (shared): `v = min(t*2,1) + exp(t*-200)`, output × (.9v + .1) — ducks every beat (the "pump").
- **`master` shared filter**: HP log-interpolated 20→800 Hz (`llerp = exp(lerp(log a, log b, v))`), optional ring-mod (`l += l*sin(rp0)*.5`, `rp0 += π*midi_to_hz(f5 + input.ring)*dt`), saturation `(tanh(l) + l*.2)*2`.
- Kit extras: kick through the ladder: `bdf.sf(240 + 19200*exp(-t*20)).process(tri(p)).lp` with note = lambda `f1 + 30*2**(t*-30) + 10*(t<.55?0:2**-max((t-.55)*10,0))`; `MR` hat = 64 band-pass SVF resonators (freqs `llerp(500,13000,...)`, decay `exp(-t*60000/ff)`) triple-serial bp; clap/piano same resonator-cluster technique.
- Meta: params are declared as an internal `param` object (commented-out `input.*` versions remain, proving the swap pattern); bpm 143.
**Fold-in verdict:** ADOPT — the single richest source for our acid engine v2 (ZDF ladder + tanhXdX + sidechain duck + Euclidean + poke/event scheduling); clean-room reimplementation of the math, cite the papers.

### 16. DEEP READ — Snare Drum (srtuss, 2023/12/17): the snare/clap voice
Link(s): https://dittytoy.net/ditty/a0ec5e5a23 ("Realistic snare drum / hand clap with many options", 92 lines; page description includes clap-recipe hash `#snareDecay=15,snareTone=2,snareBatterSpeed=37,snareVelocity=1,snareFlavor=…`)
Core contribution: a compact, fully knobbed snare synthesis recipe — noise through three differently-tuned SVF sections with separate decay laws, plus a "batter" amplitude dip that mimics the drum head strike.
THE MATH / KEY FACTS:
- Chamberlin SVF, one-line: `clock(v,q,k){ q = 1-q; hp = v - bp*q - lp; bp += hp*k; lp += bp*k; }` (k = frequency coefficient, q = damping).
- Three filters fed raw white noise, different tunings: f0 `.999*resonance` q / `.03*tone*flavor` k; f1 `.5*resonance` / `.3*tone`; f2 `.9` / `.01*tone`.
- Sound mix: `v = bp0*exp(-t*l) + hp1*exp(-30t)*.3 + bp1*exp(-(l+10)t) + lp2*exp(-(l+1)t)*3*sub` where `l = falloff + (1-velocity)*30` (falloff = input.snareDecay 5..30 — lower velocity = shorter decay).
- Batter dip: `batter = min(1, (1-batterAmt) + |t - 1/batterSpeed| * batterSpeed)` — a V-shaped notch at strike time; attack ramp `v *= min(1, t*(velocity+.01)*sattack)` with sattack = input.snareAttack 100..1000 (inverse-time constant).
- Defaults/range: decay 10 (5..30), tone 1.7 (.25..2), resonance .7, batterSpeed 150 (5..150), batterAmt .9, stereo .6, velocity 1 (.1..1), flavor .7 (.5..2), attack 666 (100..1000), sub .5 — 10 live knobs mapped through dynamic options (`batter: (_,__) => input.snareBatterSpeed` pattern — options read inputs per sample).
- Sequencing: 64-char step string (`'9...1...7...151.9....'`), character→velocity `2 ** (2*((c/9)-1))`; **dual-play stereo**: two `snare.play` per hit with `pan: (x,y) => ±input.snareStereo`; swing via `sleep(i & 2 ? 1/8 - swing : 1/8 + swing)` (swing .02); `{duration:.5}`.
**Fold-in verdict:** ADOPT — snare/clap module formula (3-SVF noise + batter notch + dual-play stereo law) is directly portable.

### 17. DEEP READ — Fat kick (athibaul, 2022/10/16): 4-layer kick recipe
Link(s): https://dittytoy.net/ditty/57d4ff2921 ("A fat kick drum sound", 32 lines)
Core contribution: the simplest complete "modern kick" — four sine/triangle layers, each with its own pitch envelope built from a `tick` lambda (no filter needed).
THE MATH / KEY FACTS:
- Four simultaneous layers per hit:
  1. click: `sine.play(tick => linlin(tick, 0, 0.03, 127, 0), {attack:.0005, release:.05, amp:.1})` — 30 ms pitch drop 127→0.
  2. boom: `sine.play(tick => linlin(tick, 0, 0.3, a1, f1), {env:adsr, attack:.26, release:.2})` — 0.3-tick drop a1(33)→f1(17 Hz midi*—here midi numbers).
  3. low thump: `tri.play(tick => linlin(tick, 0, 0.1, e3, f1), {env:adsr, attack:.005, release:.1})`.
  4. high thump: `tri.play(tick => linlin(tick, 0, 0.03, a5, a3), {attack:.005, release:.03, amp:.3})`.
- Helpers: `linlin(x,x0,x1,y0,y1) = y0 + (y1-y0)*clamp01((x-x0)/(x1-x0))`; `linexp = y0*(y1/y0)**((x-x0)/(x1-x0))`; triangle with 1.22 gain compensation `1.22*(4*|phase%1 - .5| - 1)`; alt distorted osc `atan(25*(|phase%1-.5|-.25))`.
- Rhythm array with a 0.5+0.5 tail: `[1×15, .5, .5]` — note **sleep values can be fractional and sum to the loop length**.
**Fold-in verdict:** ADOPT — the canonical layering recipe (click/boom/thump×2) for our kick module; note lambdas as pitch envelopes is the cheap, elegant way.

### 18. DEEP READ — Feedback FM + Trippy FM (athibaul): the FM corner
Link(s): https://dittytoy.net/ditty/66d8b71e96 ("Feedback FM") · https://dittytoy.net/ditty/344f7c2d34 ("Trippy FM")
Core contribution: two dead-simple but musically huge FM recipes — self-feedback FM (sine → chaos as feedback exceeds 1) and saw-to-saw phase modulation; both expose **probe oscilloscopes** on the live params.
THE MATH / KEY FACTS:
- Feedback FM: per sample `v = sin(2π*phase + feedback*v_prev) * env.value`; `phase += dt*hz`; defaults `input.feedback = 1.3 (0..4, step .001)`, `input.decay = .05`; author's in-code note: "If there is no feedback, the signal is a sine wave. As long as the feedback value is less than 1, everything is fine. When it increases beyond that, weird behaviors start to emerge, including chaotic behavior (which we hear as noise)." Probe: `debug.probe("feedbackFM", v, 1, 5/midi_to_hz(note))` (duration = 5 cycles → stable scope view). Output scaled ×0.2.
- Trippy FM: osc1 phase accumulates `param2freq(f1) = 1 + 1000*p²`; osc2 freq = `param2freq(f2) + param2fm(fm)*(0.5 - phase1)` with `param2fm = 5000*p²` — i.e. **linear FM where the modulator is the saw's ramp** (phase1 is the raw phase, `0.5-phase1` = centered saw); comment: "Uncomment for positive-only frequencies (better for sound effects, less convenient for pitched sounds)". Input smoothing: `a0 = clamp01(dt/0.03)` one-pole on each param (30 ms time constant). Output = 2-stage one-pole LP `a1 = clamp01(2π*dt*param2cutoff(p))`, `param2cutoff = 200 + 10000*p²`; `env:one`, played once, driven entirely by the sliders.
**Fold-in verdict:** ADOPT — an "FM/PM" oscillator section is cheap to add; the feedback-FM tipping point (>1) is a built-in "chaos" macro we can expose as a knob; the 30 ms param-smoothing law is our parameter-smoothing default.

### 19. DEEP READ — Antiderivative anti-aliasing (athibaul, from Parker/Zavalishin/Le Bivic 2016)
Link(s): https://dittytoy.net/ditty/7df07948ca · paper: http://dafx.de/paper-archive/2016/dafxpapers/20-DAFx-16_paper_41-PN.pdf
Core contribution: a working, exactly-specified ADAA (first-order) implementation for hard/soft clippers — the technique that keeps saturation sweeps clean (pro-grade detail for our oscillators and drive stages).
THE MATH / KEY FACTS:
- Citation quoted in code: "Parker, J. D., Zavalishin, V., & Le Bivic, E. (2016, September). Reducing the aliasing of nonlinear waveshaping using continuous-time convolution. In Proc. Int. Conf. Digital Audio Effects (DAFx-16), Brno, Czech Republic (pp. 137-144)."
- First-order ADAA: `out = (F(x_n) - F(x_{n-1})) / (x_n - x_{n-1})` where F = antiderivative of the shaper f; when `|x_n - x_{n-1}| <= 1e-3` fall back to `f(0.5*(x_n + x_{n-1}))` (avoids 0/0 and preserves DC).
- Hard clip f and F: `clip11(x) = clamp(x,-1,1)`; `clip11_antider(x) = x<-1 ? -x-.5 : x>1 ? x-.5 : .5x²`.
- Soft clip (exact): `softclip(x) = x<-1 ? -1 : x>1 ? 1 : 1.5*(1 - x²/3)*x` (cubic); antiderivative `softclip_antider(x) = x<-1 ? -x-3/8 : x>1 ? x-3/8 : (3/4)x² - (1/8)x⁴`.
- Demo design: an `env:one` sine sweeps `hz_to_midi(20000*tick/5)` (0→20 kHz over 5 ticks), amp 3, through naive vs ADAA clippers (`outgain .1`) so the ear compares alias images; four loops, phase-staggered via `sleep(7)/sleep(10)`.
**Fold-in verdict:** ADOPT — drop-in saturation path for the drive/limiter stages; also the pattern for how to A/B DSP techniques in-app (sweep tests).

### 20. DEEP READ — Sequencer/sampler architectures: StepperMusic + dance_to_the_rhythm.mod
Link(s): https://dittytoy.net/ditty/0952e54668 (athibaul, scores from Arduino stepper motors) · https://dittytoy.net/ditty/e910e130a3 (srtuss, "Minimalist Protracker player inside Ditty", 2025/02)
Core contribution: two professional-grade sequencing/sampling architectures built purely on Dittytoy primitives — an encoded-score polyphonic player with portamento, and a full 4-channel ProTracker MOD player with embedded sample data.
THE MATH / KEY FACTS:
- **StepperMusic**: scores are character-encoded (". tempo / subdivisions+31 / instruments+31 / note+64 or ' ' / duration+63 / '!' end-of-part"), generated offline from MusicXML; one `loop` per part; the synth is played **once per part** with `{duration: totaldur}` and driven by timeline option writes: `mySynth.options.nn = note - 64 + 69; mySynth.options.gate = (note==32)?0:1; sleep(sleept*duration);` — the same single-voice + event pattern as Acid Warrior, here with the **documented** portamento mechanism.
- Stepper synth: `sqsyn` — `varsquare(p, formant) = softclip(formant * (x<2 ? 1-x : -3+x))` with `x = 4*(p-~~p)` (variable-width soft-clipped square; formant = `cutoff/(2*freq)` — cutoff-scaled duty cycle); glide `a0 = clamp01(dt/(input.portamento*.03 + 1e-5))`; amp gate smoothing same a0; `{env:one, nn:c4, gate:1, amp:.1, cutoff:8000}`; echo filter reused from srtuss `24373308b4` **with a credit comment + URL** (cross-author etiquette in practice).
- **dance_to_the_rhythm.mod** (4-channel ProTracker): the MOD file is embedded as one base64 string (`b64dec`), decoded to bytes at load. `Modplay.load()` parses: "M.K." magic @1080, 20-byte title, 31 sample headers (22-char name, len×2, finetune `tune = (v&15) - ((v&8)<<1)`, `tune2 = 2**(tune/96)`, volume, loop start/len ×2), 128-entry playlist, 4×64-row patterns (period/effect/param/sample packed as `x&0xFFF` + `(x>>8)&0xF0 | y>>12` etc.), then sample data as Int8Array.
- Player: per-channel `tick()` at row start (effect `f` splits speed/row_ticks: `param<=32` → ticks/row else speed; `d` = pattern break `(hi*10+lo)`); effects implemented: 0 arpeggio `2**(arp[tick%3]/12)`, 1/2 slides (period clamps 113..856), 4 vibrato `2**(vib_amp*sin(phase*vib_speed/64*2π)/192)`, 6/a volume slides, 9 sample offset `param*256`, c volume, e1/e2 fineslides; sample playback: `v = data[~~sp]*vol/8192; sp += clock*dt*CLOCK_PAL*tune2*arp/period` with `CLOCK_PAL = 7093789.2/2` (PAL clock — period math), loop wrap when `loop_len > 2`; a final `filt += (v-filt)*.001; return v - filt` DC-blocker.
- Transport: `clock += input.clock * dt * this.speed * 24 / 60` (BPM from speed×24/60); `input.clock 0.1..4`, `input.start` pattern offset; `input.show` 0/1 (tracker view vs comments view) rendered by writing 5 rows into `debug.log` — the debug console as a UI.
- Track wiring: 4 instances of the Channel class as separate loops `{name:'channel '+(i+1), pan: ±.3}` — a tracker's channel panner for free.
**Fold-in verdict:** ADOPT (sequencer approach: single-voice event timeline + encoded patterns; consider a MOD import as a bonus "import from tracker" path) / REFERENCE (server-side score encodings). Both ditties are technique-rich; the pattern-import angle feeds the "multiple factory packs" idea (standalone .mod/.mid → pattern data).

---

## Dead ends & non-findings (logged)

- `https://dittytoy.net/js/ditty-worklet.js` (without build number) — returns the SPA HTML 404 fallback (134 KB of HTML, not JS). Resolved via the versioned URL pattern `js/ditty-worklet-${buildNumber}.js` → build **308** live (`ditty-worklet-308.js`). Also `js/ditty-mp3-export-308.js` and `js/ditty-worklet-307/306.js` 302-redirect (only current build is served under a versioned name; the unversioned `ditty-mp3-export.js` works).
- `github.com/srtuss/dittytoy-library` — referenced in Acid Warrior's header, but the repo has **no LICENSE file** (GitHub API `license: None`); do not reuse its code, reference-only.
- `lame.min.js` served by Dittytoy has **no licence header comment**; the licence determination comes from upstream metadata only (npm `lamejs` = LGPL-3.0, `github.com/zhuker/lamejs`). A legal pass should confirm before shipping any MP3-export derivative.
- No Wayback/anti-bot workarounds were needed for this pass: dittytoy.net served every page/bundle on first request (no 403/429). The user pages (`/user/srtuss`, `/user/athibaul`) turned out to be **server-rendered** (JSON-LD + plain `<a>` links) — the browser tool was not required, contrary to the task's expectation of JS rendering.
- Minor: `/ditty/new` page metadata reports `og:url = https://dittytoy.net/ditty/` (a template artefact) — the editor is built client-side; the boilerplate source is only in the embedded `<pre>`.

## Verification log vs T0 digest (2026-10-06)

- All six seed sources: `raw/` files are **byte-identical** to live page code blocks. No extraction gaps. (Page `<pre>` layout: [0] a 4-line visualizer artefact, [1] the word "Test" — the GUI log area, [2] the ditty code.)
- T0 correction (minor): Cosmic Drone op re-randomization is `shimmerc += 700*dt` ≈ **every 63 samples / 1.4 ms** (700 Hz rate), not "~every 1.4 s"; morph cycle for the tables is ≈ 4.5 s. Both now stated in entry 3.
- T0 nuance: "filters can run as workers" — only via `createShared()`, and a loop joined to a shared filter cannot connect to further filters; shared filters add latency (docs, entry 7).
- T0 confirmed: MP3 export worker uses an in-browser LAME port (lamejs, LAME 3.98.4); fixed 44.1 kHz; `tick = 60/bpm s`; `dt = 1/sampleRate`; buffer sizes (640 frames × 4) and MessageChannel transfer; WebMidiVars MIDI mapping; CC BY-NC-SA 4.0 default licence; "New ditty" AI note; fork/likes/comments/embed; Media Session.
- T0 addition (new, high value): the MIT `dittytoy` npm package (official runtime, zero deps) — a fully legitimate reuse path for the Anvil build (entry 12/13), which T0 did not have.
- Also new: `ditty.bpm` is worker-local; `sleep` is a tick accumulator; option-writes are timeline events; the input parser regex; hash escaping; the exact allpass/SVF/ladder math quoted above.
