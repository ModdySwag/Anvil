# T0 — Tab digest: the seed (Dittytoy + the acid trail)

Date: 2026-10-06 · Author: Bob (Hermes) · Status: parent-verified against live pages + raw page extractions.
Provenance: Brave (profile Default) live tab strip read via UI Automation; history burst + session files cross-checked (see `provenance-brave-tabs-2026-10-06.md`).

## 1. What was open (and why it matters)

Live tabs (1 window, all Dittytoy — a browser music platform by Reinder Nijhoff):

| Tab | Author | URL | Sound |
|---|---|---|---|
| Cosmic Drone | srtuss | dittytoy.net/ditty/f110ff31e5 | additive crossfade-wavetable drone |
| Blade Runner pad | athibaul | dittytoy.net/ditty/7d36343a29 | lush formant-saw ensemble pad |
| Karplus synth with reverb | srtuss | dittytoy.net/ditty/827b1b3e63 | Karplus-Strong strings + allpass reverb |
| New ditty (editor) | — | dittytoy.net/ditty/new | the site's starter template |
| DT303 | srtuss | dittytoy.net/ditty/0029103012 | FULL TB-303 acid emulation w/ live knobs |

Recent (same session): "Techno beat 1" (srtuss, /ditty/b3585fb3a3) — modern techno kit (SVF kick, compressor, reverb).
Search trail (2026-10-06, 11:00–22:10): "tb 303 emulator online" · "Roland MC-303 Groove Box Sequencer Drum emulator" · "Roland MC-303 VST" · "Roland MC-303 webbased"; visits: tb303.com · roland50.studio · rebirthmuseum.com · roland.com/au/products/mc-303 · vintagesynth MC-303 · r/synthesizers MC-303 + "A TB-303 but in your browser" threads · eBay MC-303 · dangerousminds (browser 303 article).

**Read on this**: Moddy was hunting for a browser instrument with genuine 303/groovebox DNA and ditty-class sound quality — and found the pieces exist but scattered. The request ("a Pattern Forge like synthesizer … fully built … packs … multi user") is the product answer to that hunt.

## 2. Dittytoy platform anatomy (the 'method' to extrapolate)

- **Code-driven music, Sonic-Pi-flavoured JS API.** "All music is generated entirely in code. No timelines, no drag-and-drop." Blocks: `synth.def()` (lambda or class per note), `filter.def()` (stereo processors, chainable via `.connect()`, `createShared()` for shared state (connection rules are stricter than they look — T1 entries 8–10)), `env.def()` + builtins `adsr` / `adsr2` / `segenv` / `one`, `loop()` with `sleep()` in ticks (tick = beat = 60/bpm s; `ditty.dt` = sample period; fixed 44.1 kHz).
- **Live input parameters = UI.** `input.cutoff = .28; // min=-24,max=24,step=.01` — declarations become sliders in the UI; values ride in the **URL hash** (`#tune=-16,pattern=1,cutoff=.26,...`); MIDI can drive them (WebMidiVars). Sharing a *sound state* = sharing a link.
- **Execution model.** Each `loop` runs in its own **Web Worker** (parallelism; globals captured per loop); loop bodies evaluate instantly and `play` calls are scheduled onto a timeline by sleep times; filters can run as workers; one **AudioWorklet** node mixes the graph; buffers pass via MessageChannel transfer. MP3 export is itself a worker (LAME). OffscreenCanvas workers power visualizers/probes. Media Session integration for background play.
- **Community.** Fork/remix buttons, likes, comments, browse-newest; per-ditty license notice; "New ditty" template even asks humans not to publish fully-AI code ("joy is in the craft" ethos).
- **License on the ditties: CC BY-NC-SA 4.0** (verified on the DT303 modal). → For us: **clean-room reimplementation only** — the techniques themselves (PolyBLEP, KS, SVF, allpass reverb, additive) are published DSP literature; code stays reference.

## 3. Method cards (math extracted from the actual sources — see `raw/`)

### DT303 — full acid voice (srtuss) → seeds OUR ACID ENGINE
- PolyBLEP saw + square from one phase accumulator; waveform knob blends saw↔square (`v = lerp(saw, square, clamp01(waveform*2))`, pulse width `max(.5,waveform)*.95`).
- Two cascaded 1-pole SVFs (`kf=0.1` default per stage): `kf = 2^(min(0, cutoff*7-7 + fenv*envmod*5 + aenv*.4))`, `kq = 1 - resonance*.9 - aenv*.1` (accent REDUCES Q for the acid 'bite').
- Accent: sets `fenv=1`, `aenv=accent`; 0.5 ms attack ramp; amp multiplied by `(aenv+1)`.
- Slide/portamento: gate extends over slide steps; `notecap += (note - notecap) * .0005` per sample glide.
- Envelopes: amp `venv *= .995`/sample; filter env `fenv *= exp(-(1-decay)*.004)` → decay knob reshapes the pluck.
- Overdrive: 4× up/down-sample (7-tap windowed kernel) + `clamp(x*(1+od*8), -1, 1)`.
- Stereo echo (cross-feedback ping-pong): delay = 60/bpm/2 s, feedbacks .4/.7 L↔R cross, wet scaled by `echo`.
- Sequencer: patterns as `[note, gate, slide, accent]` quadruples; clock = `bpm/60*4` ticks/s; pattern select 0–3.
- Live params: gate, tune, waveform, cutoff, resonance, envmod, decay, overdrive, pattern, echo; bpm 138.

### Karplus synth + reverb (srtuss; fork of athibaul's) → STRING/PLUCK MODULE
- Karplus-Strong: delay line `len = floor(1/(f*ditty.dt))+1` with linear-interp fractional delay; one-pole damping `a1 = clamp01(2π*cutoff*dt)`; `s0 += a1*(v - s0)`; output `s0 * env` (env release 2.75 s).
- Excitation: 70-sample noise burst, with pluck-position comb injection `buf[(i+offs)%len] -= buf[i]` (offs ≈ 20–40% of string).
- Reverb (Spin Semiconductor allpass article): 12 delay lines, 4-stage allpass chain at k=.5, feedback `krt=.7`, eight stereo taps, wet .1 + dry, side-widening ×1.5.
- Musical craft worth keeping: humanization — random detune ±.01, random velocity/timing, pan via golden-ratio hash `2*((note*0.618)%1)-1`; Bach Cello Suite demo.

### Blade Runner pad (athibaul) → PAD/ENSEMBLE MODULE
- **One synth instance manages ALL voices** (explicit perf tip: "avoids the overhead of individual synth management").
- Formant-weighted saw: `varsaw(p, formant) = (x-.5) * clamp01(formant*x*(1-x))`; per-note `detune`, vol `1/√f` (power normalization), auto-pan `sin(i + tick*√(6f))`, vibrato layers; 7 lush chords; 3 polysynth layers (two pads, detune 1 / 1.01, + sparkle sine); 5 s attacks.

### Cosmic Drone (srtuss) → DRONE/ADDITIVE ENGINE
- Additive `MorphWave` tables (1024 samples): harmonic amps `.3*(i+1)^-1 * exp(-i*nebula)`, random phases, `random^3` amplitude scatter; two tables crossfade-morph (copy-swap when morph wraps); morph rate ~5e-6/sample.
- 8 detuned ops per voice (`ff = 2^(±radiation/2)` re-randomized every ~1.4 ms (700 Hz rate; T1 correction)), spread L/R by op index; chord stacks with octave offsets; `sine` sub.

### Techno beat 1 (srtuss) → DRUMS + BUS FX + COMPRESSOR
- Cytomic "SvfLinearTrapOptimised2" trapezoidal SVF (`g = tan(π*fc/2)`, `k=1/q`, `a1..a3`) with lp/bp/hp/ap taps — the modern standard, same paper family as ours.
- Kick: sine + pitch/amp envelopes through SVF + asymmetric waveshaping (`fold01/fold11`).
- Peak compressor with dB math; allpass reverb; shared filter instances (`.createShared()`); macro input params.

### New-ditty boilerplate → the 'instant start' surface
Triangle synth def + stereo one-pole LPF + a 4-note loop — the template Moddy lands on when he clicks "New". Worth mirroring: our synth's first-run should be equally instant, but with knobs.

## 4. Fold-in verdicts (seed → plan)

- **ADOPT (DSP specs, clean-room):** acid voice topology + accent/slide semantics; PolyBLEP-class osc set; SVF/ZDF filter family with envmod; KS string module (with pluck-position comb + humanization); additive crossfade drone; formant-saw ensemble pad (single-synth-many-notes); techno drum synthesis + compressor; cross-feedback stereo delay; allpass-chain reverb lineage. → Engine spec sections of the design doc; packs themed to each.
- **ADOPT (product lessons):** instant play; parameters as first-class objects (modulatable, automatable, shareable); shareable sound-states via link; one-click export; fork/remix mechanics for community; visualization as first-class (probes/scopes).
- **REFERENCE:** dittytoy worker-parallel engine model (we'll be AudioWorklet-centric; worker side-sequencing optional); its sliders-from-code UX as a niche bonus feature (e.g., a 'code view' easter egg), not the core UX.
- **SKIP:** copying ditty code (CC BY-NC-SA; NC + SA incompatible with a possibly-commercial product); dittytoy's niche code-first interaction as our primary surface (Pattern Forge already owns code-first in the family).
- **OPEN (children tasks):** srtuss/athibaul catalog mining (T1); tb303.com / Roland50 / ReBirth / MC-303 feature capture (T2); groovebox sequencing conventions (T3).


## Corrections log
- **Wave 1 (2026-10-06, T1):** Cosmic Drone op re-randomization ≈ every 63 samples (~1.4 ms, 700 Hz rate); table morph cycle ≈ 4.5 s — digest inline-fixed. Shared-filter rules tighter than implied (T1). All six raw sources verified byte-identical to live pages.
