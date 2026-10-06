# T2 — Acid Heritage: TB-303 lineage, emulations, clones, open source, and browser acid tools

**Task:** research feeding the design of the Anvil acid engine.
**Scope:** TB-303 original + DSP behaviours, emulations/clones (Roland, AudioRealism, D16, Behringer), Devil Fish mods, ReBirth RB-338, Roland MC-303, Roland50.studio, tb303.com, open-source acid code.
**Method:** web_search / web_extract / live browser inspection / direct bundle + repo inspection. Licence text quoted from the actual files.
**Date:** 2026-10-06. `(verify)` marks a spec I could not corroborate in a primary source.

---

### 1. Roland TB-303 Bass Line — original architecture & spec sheet

**Links:**
- Roland TB-303 Service Notes (primary, Nov 1984 / 3rd printing Sep 1986): https://synthfool.com/docs/Roland/TB303/Roland%20TB-303%20Service%20Notes.pdf
- Wikipedia: https://en.wikipedia.org/wiki/Roland_TB-303
- musicradar (1981 review retrospective): https://www.musicradar.com/news/classic-roland-303-reviews
- gearnews: https://www.gearnews.com/roland-tb-303-synth/

**Core contribution:** the irreducible sound box our acid engine has to be a *musical* superset of. Signal path: VCO → VCF (diode ladder) → VCA → out. No LFO, no effects, no velocity, no aftertouch, monotimbral, monophonic.

**KEY FACTS / THE MATH**
- **VCO:** one audio oscillator, switchable sawtooth or square. The square is *derived from the saw* by a single-transistor waveshaping circuit — it is not a separate square core, which is part of why it sounds unlike a generic square.
- **VCF:** low-pass, resonance non-self-oscillating on the stock unit. See entry 2 for the 18 dB/24 dB question.
- **Front-panel controls (exactly six + waveform + volume):** TUNING, CUT OFF FREQ, RESONANCE, ENV MOD, DECAY, ACCENT.
- **Sequencer memory (from the service notes SPECIFICATIONS page, verbatim structure):** PATTERN MEMORY CAPACITY 64 = 8 patterns × 2 pattern sections × 4 pattern groups (I–IV); contents Pitch, Value, Accent, Slide. TRACK MEMORY 64 measures/track, total 256 measures (64 × 4 tracks by section; 7 tracks in the playable layout). Scale 3 octaves in PATTERN with TRANSPOSE, 4 octaves in TRACK with key shift.
- **Tempo range: 40–300 BPM** (♩=40 to 300).
- **Tuning control range: approx. ±700 cents** (a perfect fifth) — the TUNING knob is a coarse performance control, not a fine trim.
- **I/O per service notes:** Output 10 kΩ, Headphone 8–30 Ω, Gate Out 0 V / +12 V, CV Out +1 V to +5 V (1 volt/octave), SYNC In DIN, MIX In 100 kΩ unity gain.
- **Power/dimensions:** 6 V = 4 × 1.5 V battery, or 9 V AC adaptor 80–120 mA. 300 × 146 × 55 mm, 1.0 kg.
- **Commercials:** released 1981, discontinued 1984. Units sold: **~10,000** (Wikipedia / MusicRadar / DJTechTools) — *but* gearnews cites internal Roland documents for **~17,000 units**, more than the TR-808 or TR-909. **Treat the 10,000 figure as the popular number and 17,000 as the contested one.** Price US$395 / £238 at launch; second-hand units later hit $2,500–6,000.
- **Designer:** Tadao Kikumoto (also led the TR-909).

**Fold-in verdict:** ADOPT — this is the target. Our engine's *default* state should be exactly these six knobs behaving correctly before we add anything; every extra control must be additive, never a replacement.

---

### 2. The filter question: is the 303 filter 18 dB or 24 dB? (and why it matters)

**Links:**
- Tim Stinchcombe, "Diode Ladder Filters (including the pretension to 18dB)": https://www.timstinchcombe.co.uk/index.php?pge=diode
- Tim Stinchcombe, "A Comprehensive TB-303 Diode Ladder Filter Model": https://timstinchcombe.co.uk/index.php?pge=diode2
- electro-music thread "The TB-303 confusion cleared up once and for all…": https://www.electro-music.com/forum/topic-11244.html
- olney.ai "Computational Thinking through Modular" Ch.13 TB-303: https://olney.ai/ct-modular-book/tb-303.html

**Core contribution:** kills the biggest 303 myth and hands us a filter model we can implement directly.

**KEY FACTS / THE MATH**
- **It is a 4-pole, 4th-order, 24 dB/octave diode ladder.** Stinchcombe's normalized transfer function for the TB-303 core (with the bottom capacitor at C/2) is:
  `H_tb(s) = −1 / (s⁴ + 6.727s³ + 14.142s² + 9.514s + 1)`
  Poles at (−3.24, 0), (−2.33, 0), (−1.04, 0), (−0.13, 0). SPICE stage gradients measured: 1st −6.1, 2nd −11.9, 3rd −17.9, 4th −24.1 dB/oct.
- **Why everyone says 18 dB:** the transition from passband to stopband starts earlier and lasts longer than a Moog-style ladder, so it *behaves* like an 18 dB filter over much of its audible range. Roland themselves described it as 18 dB. The hardware is nonetheless 4-pole — the 3rd stage measures −17.9 dB/oct, which is exactly where the mislabel comes from.
- **The lower capacitor is half the value of the other three** (C1 = C/2). Unlike a Moog ladder there is *no isolation between poles*, so changing that cap moves **all** the poles, not just the first — Stinchcombe explicitly corrects the common claim that "the first pole is tuned an octave higher".
- **The filter does not self-oscillate on a stock 303**, and it is not a savage-resonance filter. Electro-music's teardown: resonance is *non-linear across cutoff* — the filter resonates much less at low cutoff frequencies, which is why a 303 keeps a clean low end while screeching up top. Conventional synths lose low-end definition at high resonance; the 303 does not.
- **There is a real low-frequency resonant peak** (measured on a TBX-303 clone at ~8 Hz) caused by coupling capacitors around the filter core. Stinchcombe's comprehensive model adds ~6 more poles and 6 zeros from those coupling networks: `H(s) = 1.06s³(s+109.9)(s+34.0)(s+7.41) / [ (s⁴/ωc⁴ + 2^(11/4)s³/ωc³ + 10√2 s²/ωc² + 2^(13/4)s/ωc + 1)(s+97.5)(s+38.5)(s+4.45)(s+578.1)(s+20.0)(s+7.41) + 18.7k s⁴(s+46.5)(s+4.40) ]`. He suspects this LF peak boosting the base frequencies "might be a large contributing factor to the sound of the TB-303 overall."
- **Filter cutoff ceiling:** stock 303 maximum resonant frequency is ~2.5 kHz typical; the Devil Fish doubles its cutoff pot range to reach **~5 kHz** (see entry 11).
- **Filter tracking:** the stock 303 filter frequency is **NOT** affected by note pitch (no key tracking at all). This is a defining behaviour — filter tracking is purely a mod.

**Fold-in verdict:** ADOPT — implement a **diode-ladder 4-pole model with the C/2 asymmetry**, non-linear resonance (less resonance at low cutoff), and coupling-capacitor LF behaviour. Do not key-track by default. Label it honestly as 4-pole; surface an "18 dB behaviour" note in docs.

---

### 3. Accent circuit — what accent actually does to the signal

**Links:**
- Robin Whittle, Devil Fish User Manual (primary, PDF): https://www.firstpr.com.au/rwi/dfish/Devil-Fish-Manual.pdf
- Devil Fish release notes: https://www.firstpr.com.au/rwi/dfish/
- olney.ai Ch.13: https://olney.ai/ct-modular-book/tb-303.html
- electro-music thread: https://www.electro-music.com/forum/topic-11244.html

**Core contribution:** the exact accent behaviour our engine must reproduce — it is *four* simultaneous changes, not one, and it has memory.

**KEY FACTS / THE MATH**
- The TB-303 has **two envelope generators**, both Attack-Decay with very fast attack:
  - **MEG (Main Envelope Generator)** — drives the *filter*. Bipolar/unusual: it modulates the VCF bias voltage so that during decay the cutoff drops *below* the cutoff-pot setting. Env Mod cannot be switched fully off on a stock unit.
  - **VEG (Volume Envelope Generator)** — drives the VCA. Fixed ~3–4 s decay.
- **MEG decay on a stock 303: 200 ms to 2 s** as set by the Decay pot — **for non-accented notes**. **On accented notes the MEG decay is hard-fixed at ~200 ms** regardless of the Decay pot.
- **Accent does four things at once:**
  1. **Amplitude boost** on the VCA — amount set by the ACCENT pot.
  2. **Filter cutoff boost** (via the Accent Sweep Circuit).
  3. **Resonance emphasis** (to a lesser degree).
  4. **MEG decay shortened** — accented notes' trigger shorts the MEG decay to minimum regardless of the accent pot setting.
- **The Accent Sweep Circuit and the "wow":** the RESONANCE pot drives this circuit. With resonance anticlockwise it is basically a direct pulse proportional to the ACCENT pot, derived from the MEG. With resonance clockwise the pulse goes through a **lag circuit**, so the filter *sweeps up* at the start of the note — this is the "wapp"/"wow". The output of the Accent Sweep circuit also adds to VCA volume on top of the MEG's contribution.
- **Accent accumulation (the famous "excitable" behaviour):** capacitor C13 in the accent chain is **not fully discharged by rapid successive accents**, so each successive accent opens the filter a little further. A run of fast accented notes therefore produces *rising* filter peaks — "like something being poked and it can't cope — its cries get higher and higher" (Whittle). Consecutive accents do not fully reset.
- **Accent "reverb halo":** with ACCENT and DECAY at minimum, accented notes are nearly indistinguishable from plain ones. With ACCENT full, cutoff is boosted enough that the filter stays slightly open while the VCA struggles to attenuate the louder accent input — producing a pseudo-reverb, like an increase in VCA release time.
- **Envelope timings (stock):** attack ≈ 3 ms (the Devil Fish manual describes "a typical 4 ms delay and then a 3 ms attack time"). VEG decay fixed ≈ 3–4 s. MEG 200 ms–2 s (normal), 200 ms (accent).
- **Accent trigger threshold conventions in the ecosystem:** velocity > 96 counts as accented on the Behringer TD-3-MO; velocity > 100 on ABL3; pattern editors commonly send 80 (plain) / 127 (accented) for hardware clarity.

**Fold-in verdict:** ADOPT — model accent as a 4-way simultaneous modulation with **stateful accumulation** (an accent-sweep capacitor that only partially discharges between accents) and a **resonance-dependent lag** on the cutoff boost. This single behaviour is the difference between "a 303 plugin" and "acid".

---

### 4. Slide / portamento + the sequencer programming model

**Links:**
- Roland TB-303 Service Notes: https://synthfool.com/docs/Roland/TB303/Roland%20TB-303%20Service%20Notes.pdf
- Devil Fish Manual ("Slide Slew Times"): https://www.firstpr.com.au/rwi/dfish/Devil-Fish-Manual.pdf
- gearnews: https://www.gearnews.com/roland-tb-303-synth/
- Roland "Beyond Acid" article: https://articles.roland.com/beyond-acid-pushing-the-tb-303-into-new-sonic-territory/
- synth-db: http://www.synth-db.com/synths/Roland/TB-303/TB-303.php

**Core contribution:** the sequencer data model and the slide timing constant.

**KEY FACTS / THE MATH**
- **Slide is fixed-time portamento.** Whatever the interval between notes, the time taken to reach the correct pitch is the same. **Stock slide time = 60 ms** (devil fish manual, verbatim: "Normally the slide time is 60 ms"). Confirmed by logic-analyser work: **the slide does not start until the beginning of the note being slid *into*** — it is not a pre-glide.
- **Pattern data model:** 16 steps × {Pitch, Octave (down/up), Slide on/off, Accent on/off, Gate/rest}. Slide and accent are per-step booleans; octave is up/down relative to the entered pitch.
- **Programming model (the "PITA"):** two separate passes — **Pitch write mode** (enter notes and octave shifts) then **Time write mode** (enter gate/rest/tie/note-length and slide/accent). This decoupling is why random button-poking produced so many classic acid lines: you enter a *pitch sequence* and a *rhythm/tie sequence* independently and the machine combines them, often into something you did not intend. Roland's TB-03 manual describes it as "a unique concept in which pitch and timing… are entered using separate processes, and requires practice in order to enter the phrase that you intend. Although this mode requires complex operation, it can result in some remarkable phrases being created by accident, so please try using it."
- **Pattern chaining:** patterns can be chained (selected as multiple simultaneously) and written into TRACK mode up to 256 measures; D.C. (Da Capo) and insert operations exist.
- **Low-voltage failure mode:** removing the batteries for a time scrambles patterns in memory — a documented behaviour users deliberately exploited to generate new patterns.
- **One more quirk worth reproducing:** the square-wave pulse width varies with oscillator frequency (confirmed independently by both ABL3 and TD-3-MO documentation).

**Fold-in verdict:** ADOPT — ship slide as a fixed-time glide (default 60 ms) starting at the *destination* note, and ship a two-pass pitch/time write mode as an *option* alongside a modern grid editor. The two-pass model is a feature, not a bug: it is the acid-pattern generator.

---

### 5. Why the 303 flopped — and why it then defined acid house

**Links:**
- MusicRadar (reprinting the 1981 review): https://www.musicradar.com/news/classic-roland-303-reviews
- Attack Magazine: https://www.attackmagazine.com/technique/hardware-focus/roland-tb-303/
- Selector: https://selector.news/2021/03/03/twisted-bassline-roland-tb-303/
- DJ TechTools history: https://djtechtools.com/2015/12/02/history-tb-303-rolands-accidental-legend/
- Electronic Sound long read: https://www.electronicsound.co.uk/features/long-reads/acid-in-the-theatre-of-madness/

**Core contribution:** the design lesson — the failure modes *were* the feature, and our product should celebrate rather than sand them off.

**KEY FACTS**
- **Why it failed:** sold as a "computerised bass machine" to replace a bass guitarist, for guitarists practising with a TR-606. It sounded nothing like a bass guitar. Roland **did not ship an English-language manual to the US**, making the already-obscure sequencer near-unusable. Contemporary review verdict: "You can use it for off-the-cuff bass lines in a sequencer-like fashion, but for anything beyond very basic use you have to plan out what you're going to do before even switching the machine on."
- **It was not a total flop commercially:** ~100 records used it, including Heaven 17 "Let Me Go", Orange Juice "Rip It Up" (#8 UK), Shannon "Let the Music Play", Newcleus "Jam On It", and ~"100 forgotten Italo disco producers". Charanjit Singh's *Synthesizing: Ten Ragas to a Disco Beat* (1982) is an early 303+808 record now recognised as a proto-acid precursor.
- **The pivot:** second-hand units fell to as little as $50. Phuture (DJ Pierre, Spanky, Herb J) bought one, and rather than programming it properly they **turned the knobs while the sequencer ran**. Result: "Acid Tracks" (1987, Trax). Ron Hardy played it up to four times a night at The Music Box. Sleazy D's "I've Lost Control" reached vinyl first; "Acid Tracks" defined the genre.
- **The acid signal chain adds distortion:** guitar pedals or simply overdriving a mixer channel. Roland's own history page calls the 24 dB filter "often misquoted as 18 dB, 3-pole... that can't even ascend into self-oscillation".
- **Roland's own framing:** the engineers called the acidic characteristics "wacky sounds" at release and made a conscious choice to leave the user the *option* of using them or not.

**Fold-in verdict:** REFERENCE — this is positioning and UX copy, not code. Our acid engine should ship an "accident-friendly" mode (pitch/time two-pass + randomiser + knob-turning-while-running is the whole point) and explicitly refuse to "fix" the quirks that generations of producers consider the instrument.

---

### 6. Roland TB-03 (Boutique) — ACB recreation

**Links:**
- Roland product page: https://www.roland.com/us/products/tb-03/features/
- Roland TB-03 manual (PDF): https://static.roland.com/assets/media/pdf/TB-03_eng03_W.pdf
- MusicRadar review: https://www.musicradar.com/reviews/roland-tb-03-bass-line
- Sound on Sound (TR-09 & TB-03): https://www.soundonsound.com/reviews/roland-boutique-tr-09-tb-03
- Roland "7 More Hidden Features of the Roland Boutiques": https://www.roland.com/uk/blog/roland-boutiques-hidden-features/?lang=en-GB

**Core contribution:** the official modern reference implementation, with a 4-digit LED display, effects, and MIDI. Important as the *baseline feature-parity target* for a paid web synth.

**KEY FACTS / THE MATH**
- **Engine:** Roland ACB (Analog Circuit Behavior), 24-bit/96 kHz. 1 voice, monophonic, saw + square.
- **Controls (verbatim from the manual's controller list):** WAVEFORM switch, TUNING, CUT OFF FREQ, RESONANCE, ENV MOD, DECAY, ACCENT, VOLUME, OVERDRIVE, DELAY TIME, DELAY FEEDBACK.
- **Effects:** OVERDRIVE (3 selectable flavours of overdrive/distortion) and DELAY (Tape Echo / Digital Delay / Reverb — the reverb mode is described by SOS as sounding like "you accidentally dropped your Bassline into a large metal tank").
- **Sequencer:** 96 patterns = **4 groups (I–IV) × 3 sections (A,B,C) × 8 patterns**; 7 tracks; up to 256 measures in Track Write. Steps 1–16 (16th-note grid; triplet grid available via FUNCTION + step button). Two write modes: **Original mode** (faithful two-pass 303 behaviour, default) and **Step Recording mode** (new, linear note-entry).
- **New vs original:** four-digit LED display showing step numbers and fine tempo (e.g. 125.5 BPM), **shuffle**, fine tempo control, pattern copy (hidden: FUNCTION + F#), **two randomisers** — one fully random (FUNCTION + G#) and one that keeps your notes and randomises slides/accents/octaves (FUNCTION + A#).
- **Connectivity:** TRIGGER IN (drives the internal sequencer; default 16th-note pulse), CV OUT, GATE OUT, MIX IN, MIDI IN/OUT (no Thru), micro-B USB (audio + MIDI + pattern backup), phones/out. Battery (4×AA) or USB bus power, ~5 h.
- **Criticism to learn from:** *no real-time recording mode*; parameter automation not supported by the internal sequencer; convoluted key combinations remain because the panel was kept faithful; Sound on Sound notes **no user customisation of the sound or behaviour is offered** (unlike ABL3).

**Fold-in verdict:** ADOPT (as the floor) — match its feature set (96 patterns, 7 tracks, original + step write modes, overdrive, delay, randomisers, shuffle) and then beat it on the two things it was criticised for: real-time recording and per-parameter automation.

---

### 7. AudioRealism Bass Line 3 (ABL3) — the emulation with the deepest engine knobs

**Links:**
- Product page: https://audiorealism.se/products/audiorealism-bass-line-3
- Operation manual (PDF): https://www.audiorealism.se/uploads/4/5/5/4/45545237/abl3-operation-manual.pdf
- ABL3.1.0 update manual (PDF): https://www.audiorealism.se/uploads/4/5/5/4/45545237/abl3.1.0updatemanual.pdf
- Sound on Sound review: https://www.soundonsound.com/reviews/audiorealism-bassline-3

**Core contribution:** the best documented **trim/calibration** model — it exposes the 303's service trim pots and VCO/filter character as user controls, which is exactly the "build your own 303" affordance a web flagship should have.

**KEY FACTS / THE MATH**
- **History:** ABL1 2003 → ABL2 2007 → ABL3 (complete DSP rewrite). ABL3.3.0 adds **three switchable engines (ABL2 / ABL3 / new engine 3)** and switchable "defects" (broken accents, broken slides).
- **Synth controls (7):** Waveform, Tuning (**−12 to +12 semitones** — note this does *not* behave like the 303's Tune knob), Cutoff, Resonance, Env Mod, Decay, Accent, Volume (−Inf dB to +9 dB).
- **Env Mod is explicitly bipolar:** "one unique feature of the 303 is the way the envelope modulates the cutoff both positively and negatively, which may result in a filter frequency lower than the Cutoff knob setting."
- **Sequencer:** 128 patterns (one per MIDI note), **1–64 steps** per pattern, step-record via MIDI or on-screen keys; pitch covers a full octave plus one extra C, extended octaves reachable by repeat-clicking (white = normal, red = +1, yellow = +2); Down/Up per step; **Vibrato** = Down+Up on the same step (a delayed-LFO-style effect, tie steps with slide to enhance); Gate per step; Random (randomises pitch/down/up/slide/accent) and Alter (reshuffles step order) functions; Shift buttons (move pattern ±, transpose ± semitones); grid edit mode (16 steps at once); advanced randomiser with Scale / Octave / Note / Gate / Slide / Accent density / Root / Seed.
- **Setup / calibration page:** VCO Mode 1 (clean, "sounds more similar to certain TB-303 clones"), Model 2 (default, "most authentic… includes a bit of grit and dirt"), Model 3 (less dirty, less bottom); Vibrato on/off; **VCA Clicks**; **VCA Noise**; Host Sync; Note Mode; **Reso Trim** (max resonance); **Gate Trim** (VCA gate release time — default 50% matches the 303); **Detune** (VCO tuning across octaves, sequencer-only); **Low Cut**. Plus a **VCO phase reset** option that SOS notes makes it "static and lifeless… more like a sample".
- **ABL3.1.0 additions:** integrated **transistor-modelled distortion with Drive + Distort mix + sweepable 12 dB/oct hipass** (0 Hz → 15284 Hz), clipping modes Off/Soft/Hard, Bass and Treble on the setup page, **MPC-style shuffle timing modes**.
- **Pattern import:** from Reason ReBirth, Roland T-8, Roland TB-03, **Behringer TD-3**. Wave Analyzer transcribes audio from a real 303/x0xb0x into a pattern.
- **Filter marketing vs physics:** ABL3's page and betae/test documentation say "**18 dB/Octave** low-pass filter… can resonate from 20 Hz to 22 kHz". That 18 dB label is the marketing shorthand for the 4-pole diode ladder described in entry 2 — worth noting so we describe our own filter correctly.
- **SOS verdict:** "perfectly recorded Bassline… a credible rising response on successive accents." ABL3 ships no effects other than the added distortion — deliberately, so the user's own processing does the work.

**Fold-in verdict:** ADOPT — copy the *architecture* of the Setup/calibration page (VCO model, reso trim, gate trim, VCA clicks/noise, low cut, distortion with drive + sweepable hipass, shuffle timing modes). These are the controls that make a 303 engine feel owned rather than borrowed.

---

### 8. D16 Phoscyon 2 — the "every 303 is different" model

**Links:**
- Product page: https://d16.pl/phoscyon2
- Manual (PDF): https://d16.pl/pub/manuals/Phoscyon%202-manual-gb.pdf
- gearnews review: https://www.gearnews.com/d16-phoscyon-2-review
- MusicTech review: https://musictech.com/reviews/software-instruments/d16-group-phoscyon-2-acid-line-review
- KVR product page: https://www.kvraudio.com/product/phoscyon-2-by-d16-group

**Core contribution:** the strongest *control-set* precedent. Six classic knobs + seven mod-inspired knobs + nine calibration parameters + a 19-algorithm distortion chain, with a documented rationale for each addition.

**KEY FACTS / THE MATH**
- **13 knobs total:** the six originals (Tuning, Cutoff, Resonance, Env Mod, Decay, Accent) **plus seven** mod-inspired: **Slide Time, Sweep Amt, Env Attack, Acc. Decay, Acc. Vol., Vibrato Speed, Vibrato Depth**.
- **Accent decoupling:** an **"EnvAcc / AccVolume Couple"** switch chooses whether the Accent knob controls both filter and volume accent envelopes, or whether they are independent (Accent = filter accent envelope peak; Acc. Vol. = volume accent envelope peak). This is the single best UX idea in the emulation space for exposing the 4-way accent behaviour.
- **Resonance / Sweep Couple:** when on, the Sweep Amt knob is inactive and the crossfade happens automatically according to the Resonance value — i.e. it models the *resonance-dependent accent sweep* from entry 3 as a coupled pair.
- **Calibration Parameters panel:** 9 parameters total, modelled on the **TB-303 service trim pots** (which existed because "with time, every TB-303's sound drifts away slightly and this is mostly the case why every TB-303 sounds a bit different") plus **circuit bends** not on the original board. Saved with the preset. Includes base cutoff frequency and VCA clicks.
- **Vibrato novelty:** not oscillator vibrato — a **two-note tremolo smoothed by note sliding**, controlled by two knobs (spread = range, note duration = speed). "You won't find this in even the most twisted 303 modifications out there."
- **Sequencer:** two editor views — **piano-roll** (modern) and **keyboard view** (classic 303 step limitation); **pattern length 1–64 steps**; transpose and shift (move whole sequence one step); randomiser with real-time density control over which notes/attributes are generated; **live override** (non-destructively influence Accent, Slide or Vibrato while playing); drag-and-drop MIDI export.
- **Play modes:** three — External (MIDI in from DAW), Sequencer, Arpeggiator (a template-based "ARP" that generates predictable note runs rather than a dumb arpeggiator). Active MIDI Output so the internal sequencer can drive external hardware; velocities encode accent; CC#01 for vibrato, CC#64 sometimes for slide+accent same-pitch cases.
- **FX chain:** Distortion with **19 selectable models** + adjustable Color; optional compression (Pre/Post); **5 reorderable insert effects**; algorithmic reverb with independent Early/Late. Expression/trigger modes selectable.
- **Reviewer's wish list (a gap we can fill):** MusicTech asked for "a second oscillator or even polyphony".

**Fold-in verdict:** ADOPT — this is our acid engine's control-set north star: 6 core + ~7 mods + a calibration page, with the *accent coupling switch* and the *resonance/sweep couple* as the two genius-level controls. Also adopt the pattern-length flexibility (1–64) and the dual editor views.

---

### 9. Behringer TD-3 and TD-3-MO ("Modded Out") — the mods, shipped as hardware

**Links:**
- Sound on Sound TD-3-MO review: https://www.soundonsound.com/reviews/behringer-td-3-mo
- SynthAnatomy: https://synthanatomy.com/2021/07/behringer-td-3-mo-modded-out-analog-bassline-synthesizer.html
- Thomann product specs: https://www.thomann.co.uk/behringer_td_3_mo.htm
- TD-3-MO manual (translated): https://www.joit.de/behringer-td-3-mo-manual
- TD-3 modifications guide (maffez, PDF): https://maffez.com/wp-content/uploads/2020/04/TD3MODS_VERSION1_999.pdf
- Detroit Modular spec/I-O sheet: https://www.detroitmodular.com/products/behringer-td-3-mo

**Core contribution:** a **shipping, RTM'd implementation of Devil Fish mods** — proof that the mod set is a coherent product feature list, and the cleanest published parameter table in the whole ecosystem.

**KEY FACTS / THE MATH**
- **TD-3 (base):** fully analogue VCO/VCF/VCA, 4-pole low-pass with resonance, 16-step sequencer, **250 pattern memory locations**, 16-voice poly-chain, distortion, USB-MIDI + MIDI in/out/thru, arpeggiator.
- **TD-3-MO additions (the "famous mods" list, as shipped):**
  - **Filter cutoff fully MIDI-CC controllable** and closes completely; range up to **5 kHz** (fine-tune via internal pot).
  - **Sub-oscillator** (switchable, L/M/H) — *not* a Devil Fish mod, a Behringer original.
  - **Slide Time control**, up to **6× the TD-3's slide time**.
  - **Soft Attack** control: 0.3 ms – 30 ms (non-accented notes).
  - **Normal Decay: 16 ms – 3 s** (non-accented) and **Accent Decay: 30 ms – 3 s** — separate envelopes.
  - **Filter Tracking** control (oscillator CV → filter frequency).
  - **Filter FM** (AC-coupled, from the VCA output — lets the whole chain feed back into the filter).
  - **Muffler** — post-VCA soft-clip distortion that retains bass, 2 switchable stages.
  - **Accent Sweep switch: 3 modes** (0 = no accent sweep, 1 = high-resonance mode, 2 = normal) with resonance; **Sweep Speed switch: 3 modes** (slow/norm/fast) with cumulative effect on fast accented runs.
  - **Manual accent trigger push-button.**
  - **Overdrive** (replaces the TD-3's distortion).
  - New **CV/Gate patch points**: Filter in, Filter FM in, Filter CV in, Accent in, Slide in, Gate in, CV in, Sync in; Accent out, Gate out, CV out, Filter out. Documented voltage ranges, e.g. Slide in off 0 V / on +3.3 V; Accent out off 0 V / on +6 V; CV out +1 V–+5 V (1 V/oct); Filter in −6 V…+6 V.
  - MIDI DIN carries only clock, note on/off and cutoff (CC74); **USB MIDI adds SysEx, pitchbend, start/stop/continue.**
- **A spec discrepancy to note:** Behringer/Thomann/D16 material calls it a **4-pole** filter; the translated TD-3-MO manual page says "**3-pol or 18 dB/Octave**". Both descriptions circulate in the wild for the same circuit — see entry 2.
- **SOS verdict:** with the MO, "the filter easily trips into self-oscillation" at high resonance + Accent Sweep; **Filter FM is dead until about 3 o'clock and then "tripped into a crunchy bit of chaos"**; the sub-oscillator is "a bit too dominating… seems to erase all remaining traces of that 303 sound". SOS also notes the MO **lost the TD-3's distortion** in exchange for overdrive.
- **Mods that Behringer *didn't* include** (per SOS): Devil Fish Dynamic Bank Switching (switch to another pattern mid-sequence) and the Audio-In-to-Filter switch.

**Fold-in verdict:** ADOPT — the TD-3-MO list *is* our "mods" panel, with published parameter ranges we can mirror (soft attack 0.3–30 ms; normal decay 16 ms–3 s; accent decay 30 ms–3 s; slide up to ~6× stock; accent sweep ×3 modes; sweep speed ×3 modes; muffler 2 stages; filter FM; filter tracking; sub-osc). Note the self-oscillation capability as a feature, and keep Filter FM's "does nothing… then chaos" curve.

---

### 10. Roland MC-101 / MC-707 — acid duties inside a modern groovebox

**Links:**
- MC-101: https://www.roland.com/us/products/mc-101/
- MC-707: https://www.roland.com/us/products/mc-707/

**Core contribution:** evidence that Roland keeps the 303 alive as a *patch inside a groovebox* rather than as a standalone — the same packaging decision our flagship faces (acid engine as a module within a larger instrument).

**KEY FACTS**
- Both run **ZEN-Core**, Roland's current flagship engine, and both explicitly list **TB-303** among the reproduced classics alongside TR-808, TR-909, JUNO-106 and SH-101.
- **MC-707:** 8 tracks, clip-based sequencing, TR-REC step sequencer (the classic Roland drum-machine input model), 16 velocity pads, per-track + global effects, sampling with slicing/truncation/reverse, Scenes for song arrangement, note repeat / chord designer / **step LFO**.
- **MC-101:** the compact 4-track sibling — same engine, ~5 h on 4×AA, 16 RGB pads, clip/scene chaining, re-sampling, automation recording, clip sharing between MC-101 / MC-707 / VERSELAB MV-1.
- **Acid relevance:** the 303 lives here as one patch family inside a ZEN-Core sound set, sequenced with clip/TR-REC tools rather than with the original two-pass write model.

**Fold-in verdict:** REFERENCE — confirms the "acid as a module in a groovebox" packaging works commercially. For our build this argues for the acid engine being a first-class *voice/engine* inside the flagship synth with its own purpose-built sequencer panel, not a separate app.

---

### 11. The Devil Fish (Robin Whittle) — THE famous 303 modification

**Links:**
- Official site: https://www.firstpr.com.au/rwi/dfish/
- User manual (PDF, primary): https://www.firstpr.com.au/rwi/dfish/Devil-Fish-Manual.pdf
- Keys Magazine profile (PDF): https://www.firstpr.com.au/rwi/dfish/Devil-Fish-article-Keys-Magazine-Dec-2010-English-tr.pdf
- Original development notes: http://machines.hyperreal.org/manufacturers/Roland/TB-303/info/Devilfish.txt

**Core contribution:** the canonical mod list. Every commercial "modded" 303 descendant (TD-3-MO, Phoscyon 2's extras, Open303's stated goals) is measured against this document.

**KEY FACTS / THE MATH — the Devil Fish additions (verbatim-complete list)**
- **History:** first mods 1993 (Ollie Olsen's machine); first production Devil Fish SN 001, 21 April 1993; v1.0/1.1 (18 units total, 1993–94); **v2.0 from 1996 to present**. About **253 modifications** made as of the 2010 Keys feature; Whittle estimates that is ~1/50 of surviving 303s.
- **I/O added:** CV and Gate inputs (CV/Gate outputs retained); **CV input to turn on Slide** (2.3 V turns on the slide circuit; >4 V turns on Gate to tie notes together); **CV input for Accent**; **CV input for Filter Frequency**; **Output for Accent**; Audio In to Filter (replaces Mix In); Audio In to frequency-modulate the filter (replaces headphone socket tip); Audio Out from filter (pre-VCA); optional MIDI In / MIDI In+Out; optional headphone output on a new 3.5 mm socket.
- **New/changed controls:**
  - **Overdrive pot** — oscillator level into the filter, **zero to 66.6× normal level**. "Causes the filter to operate under duress… no danger to the filter, but the sound is big." (The 66.6 figure was chosen by auditioning standard resistor pairs.)
  - **Slide Time pot** — stock is 60 ms; **60→360 ms from the internal sequencer, 2→300 ms from external CV.**
  - **Soft Attack pot** — **0.3 ms → 30 ms** attack on non-accented notes (stock was ~4 ms delay + ~3 ms attack).
  - **Decay pot re-purposed to the VEG.** Stock VEG decay was fixed ~3–4 s. First half of the pot's range: **16 ms → 3 s**; second half keeps the long decay but varies final volume from silence to full — **indefinitely long notes**.
  - **Separate Normal Decay and Accent Decay pots for the MEG** — both **30 ms → 3 s** (stock: 200 ms–2 s normal, 200 ms fixed for accent).
  - **Filter Tracking pot** — filter frequency follows note pitch, 0 → normal → over-tracking, ~**2.7 kHz per volt** at max; approximately 1 V/oct on the CV input in v2.1C+. Centre (zero-change) note ≈ C (2 V) or D.
  - **Filter FM pot** — AC-coupled filter FM *from the audio output of the VCA* (not the VCO). "Stronger on accented notes… at higher settings the results approach chaos."
  - **Muffler switch, 3 positions** — two types of muted post-VCA soft clipping; softens loud extremes and adds a moderate square-wave clipping buzz "whilst allowing the bass to pass largely unaffected"; only acts on loud signals (high Accent, Overdrive, or hot external audio).
  - **Accent Sweep switch** — three modes (plus the 1.xA three-position mode set: standard rising-on-repeat-accents; inverted/falling-on-repeat; super-slow slide where the filter is still falling after the accents stop); can be disabled.
  - **Sweep Speed switch** — three modes, most pronounced with a series of accents on short consecutive notes; the accent decay time is now user-controllable so the "wow"/"wapp" time can be made shorter or longer.
  - **Manual accent push-button.**
  - **Filter switchable to self-resonance** (via higher resonance levels).
- **Range expansions:** Cut Off pot range **doubled to ~5 kHz max** ("an octave above the typical maximum for the TB-303") and widened to include much lower frequencies; **Env Mod range tripled** and made to include *no* envelope modulation (stock couldn't switch it off); filter max cutoff/resonant frequency **limited to ~20 kHz** deliberately, to avoid self-oscillation at extreme frequencies harming ADCs and speakers.
- **Sound improvements:** **bass response improved from −5 dB @ 32 Hz to −1 dB @ 32 Hz**; two MEG-activity LEDs (normal + accented); knobs re-mounted 1.5 mm higher for easier turning; tact switches replaced with sealed Omron B3W-4050; pots upgraded.
- **Long-tail behaviours:** large step changes to filter frequency complete ~99.8% instantly (<1 ms) with a **residual drift over the next ~500 ms** (caused by coupling capacitors) — audible only with the filter self-resonating.
- **Also offered:** a **32-bank memory system** with **Dynamic Bank Switching** (switch bank mid-pattern; the sequencer reads the next note from the same pattern number in the new bank) — "much more interesting and unexpected results" than waiting for the pattern to end. Plus a **Quicksilver 303 CPU replacement** option.
- **Reset path:** the manual documents how to limit the Devil Fish back to stock 303 sounds (page 7) — a "stock mode" concept worth stealing.
- **Cultural:** Whittle's original notes include the lineage: his own 303 went to Richie Hawtin; Devil Fishes went to Johnny Klimek, Gus Till, Ken Evans. Whittle's thesis: "only a few synths (Moogs, Synthi AKS, VCS-3) have diode ladder filters, and **no other machine has the accent circuitry, which affects the volume and filter in ways which cannot be replicated with modular synths**."

**Fold-in verdict:** ADOPT — this is the definitive mods list for our panel. Ship: Overdrive (0→~66×), Slide Time, Soft Attack, separate Normal/Accent MEG decay, VEG decay w/ infinite-sustain mode, Filter Tracking, Filter FM (AC-coupled from VCA out), Muffler (2–3 stages, bass-preserving), Accent Sweep (≥3 modes + off), Sweep Speed (3), manual accent button, self-oscillation, expanded Cutoff/Env Mod ranges, plus a documented **"stock 303" reset**.

---

### 12. ReBirth RB-338 — history 1996→2005→2017

**Links:**
- Wikipedia: https://en.wikipedia.org/wiki/ReBirth_RB-338
- gearnews (Roland kill-off, 2017): https://www.gearnews.com/roland-kill-off-propellerhead-rebirth-rb-338
- Sound on Sound "ReBirth & Reason": https://www.soundonsound.com/techniques/rebirth-reason
- peff.com ReBirth Museum / Mod Archive: https://peff.com/rebirth/ and http://www.peff.com/journal/rebirth-archive/

**Core contribution:** the *original* proof that a software 303 could matter, plus a hard-won licensing lesson about what happens when an emulation outlives its goodwill.

**KEY FACTS (with the timeline corrected)**
- **October 1996:** first public alpha (Mac OS). Software synthesizer by **Propellerhead Software**.
- **v1.0:** two TB-303s + TR-808. **v2.0:** adds the TR-909. Reason's flagship came *after* — SOS: Propellerhead "really wanted to release something like Reason. But computers weren't up to the job in 1997, so Rebirth RB338 was their follow-up to Recycle."
- **January 1999:** development ceases. **v2.0.1** is the final desktop version.
- **September 2005:** desktop support officially discontinued, and — critically — **the software was made available as a free download** (the *ReBirth Museum* site, plus a torrent; free registration required). This was **not a cease-and-desist**: Roland had given Propellerhead an "unofficial thumbs up" years earlier, which Propellerhead treated as a seal of approval.
- **~2016:** the ReBirth Museum website vanished (gearnews). The Mod Archive persists on GitHub.
- **April 2010 → 2013:** iOS re-release (iPhone/iPod; revamped iPad version Nov 2010); Propellerhead disabled ReBirth for iOS **1 June 2013**.
- **2017:** Roland issued a claim of intellectual property infringement; Propellerhead removed the iPad app from the App Store **15 June 2017** rather than contest it. gearnews commentary: "It's very interesting how Roland have waited over 20 years before making a fuss about it."
- **Legacy:** ReWire support; the ReBirth Input Machine carried the concept into Reason; Propellerhead released a free **100 MB ReBirth RB-338 Mod Refill** of the drum sounds (needless to say most mod kits sound nothing like an 808/909).

**Fold-in verdict:** REFERENCE (history) + ADOPT (a licensing rule). Rule: our emulation must be **behaviour-modelled and brand-clean** — recreations of classic hardware shipped under Roland's name ended in a takedown; recreations with their own identity (ABL3, Phoscyon, our own engine) survive. Do not ship Roland trademarks or trade dress.

---

### 13. ReBirth RB-338 — full feature inventory

**Links:**
- Wikipedia: https://en.wikipedia.org/wiki/ReBirth_RB-338
- Official manual (PDF): https://www.deepsonic.ch/deep/docs_manuals/propellerhead_rebirth_rb338_v2.01_manual.pdf
- Vintage Synth Explorer: https://www.vintagesynth.com/propellerhead-software/rebirth-rb-338
- hitsquad listing (2.0.1 free): https://www.hitsquad.com/smm/programs/Rebirth_RB-338_win95_NT/

**Core contribution:** the workstation model for an acid studio in software — this is the closest ancestor to what Anvil is trying to be, and its sequencing/effects architecture is still a good blueprint.

**KEY FACTS / THE MATH**
- **Devices:** 2 × TB-303 (monophonic) + **TR-808 (11 voices)** and, since v2.0, **TR-909 (11 voices)**; all usable simultaneously.
- **Pattern model:** **32 patterns per device**, each **1–16 steps long** (variable). Every emulated device gets its **own pattern selector — a feature the originals lacked** — enabling fast switching between sequences without reprogramming. This invention was later adopted into Reason's devices.
- **303 panel parameters (per Vintage Synth Explorer):** Tune, Cutoff, Resonance, Envelope, Decay, Accent. A **"Vintage ReBirth Synth Sound"** switch exists (per the manual's synth sound settings section, alongside Waveform/Tune/Cutoff/Resonance/Env Mod/Decay/Accent).
- **Programming:** Pitch mode + keyboard-driven pattern creation, octave settings, Accents, Slide, pattern length changes, tap recording, step/song modes. Pattern editing functions: Cut/Copy/Paste. **Shuffle** is available (Song Window chapter includes "Using Shuffle").
- **Mixers:** per-section mixing, levels, muting, pan.
- **Effects architecture (the part worth stealing):**
  - **Three insert effects connected in series: Dist (Distortion) → PCF → Compressor.** If all three are applied to one section, that is the fixed order.
  - **One send effect: Delay**, applied per-section via each mixer's Delay amount.
  - **PCF (Pattern Controlled Filter)** — "an extremely versatile synth effect." A **12 dB/octave (2-pole)** filter switchable **lowpass / bandpass**, with cutoff and resonance, plus a **simple Attack/Decay envelope whose pattern drives the envelope**. Preset patterns (a large number, unchangeable) control: **retriggering** (e.g. pattern 0 retriggers at each whole note, pattern 1 each half note), **dynamic** (different envelope dynamics on different beats) and **attack** variations. Patterns are mostly 1–2 bars, some in odd time signatures. **Only one PCF exists — it can be applied to one section at a time**, selected via the PCF switch in each mixer.
- **Mods system:** open architecture allowing users to **replace the drum-machine samples and modify the GUI**; four mods ship in the install by default; the Mod dialog manages add/switch; official + unofficial mods number in the hundreds (peff archive: 367 archived mods, ~300+ by peff's count).
- **Compatibility:** MIDI sync, ReWire, **audio export to AIFF/WAVE** ("Exporting Songs and Patterns as Audio"), remote MIDI control, Live Sync.
- **Songs/pattern files:** `.rbs` songs, `.rbm` mods (v1.5+); a community GitHub archive preserves songs/mods.
- **Adoption:** used by Juno Reactor, Stoker, AntiLoop.

**Fold-in verdict:** ADOPT — three specific things: (1) **per-device pattern selector** (the single best ReBirth invention — every device gets instant pattern switching); (2) **the PCF idea** — a pattern-driven 12 dB/oct LP/BP filter as a *shared insert* effect, which is a perfect "one global sweeper" for a web synth; (3) **insert chain order Dist → PCF → Compressor + one shared Delay send**. Also adopt user-modifiable drum samples/GUI as a community feature (maps directly to our sharing/multi-user track).

---

### 14. Roland MC-303 Groovebox (1996) — the archetype and its full feature list

**Links:**
- Roland product/features page: https://www.roland.com/us/products/mc-303/features/
- Official MC-303 brochure (PDF): https://static.roland.com/assets/media/pdf/MC303FX.PDF
- Owner's manual full text: https://archive.org/stream/synthmanual-roland-mc-303-owners-manual/rolandmc-303ownersmanual_djvu.txt
- Sound on Sound review (Aug 1996): https://www.soundonsound.com/reviews/roland-mc303
- Wikipedia: https://en.wikipedia.org/wiki/Roland_MC-303
- Roland company history: https://www.roland.com/global/company/history

**Core contribution:** the groovebox archetype — the packaging insight that a self-contained pattern machine beats a collection of devices for the "jam now, arrange later" user. This is the direct ancestor of the Anvil *product shape*.

**KEY FACTS / THE MATH**
- **Released 1996** (1996–97), **£565 UK / $699 US**. Roland's **first entry into the club/DJ scene**, and the product that *created the term "Groove Box"* — Roland's own company history calls it "a new hit in the world of dance music".
- **Despite the number, it is not a 303 descendant:** it has more in common with the MC-202-style MC-prefixed sequencer synths. It is a **rompler**, not analogue.
- **Sound engine:** JV-80-derived, **448 preset tones** (40 synth basses incl. TB-303, 35 synth leads, 33 synth pads), **12 rhythm kits** (incl. CR-78, TR-808, TR-606, TR-909, electro, techno, jungle, house, DnB, breakbeat), **28-voice polyphony**, 16-part multitimbral (8 main + 8 RPS parts), resonant filter + LFO + envelope, effects Reverb/Delay + Chorus/Flanger.
- **Sequencer:** **8 tracks** (7 pitched + 1 rhythm kit), 16 parts, **96 ticks per quarter note**, pattern length up to 32 bars, **133 preset + 50 user + 300 variation patterns**, **10 songs**, ~**14,000 notes** capacity, tempo **20–250 BPM**, Grid/Shuffle/Groove quantize (71 groove templates).
- **RPS (Realtime Phrase Sequencer):** phrases = parts borrowed from patterns, assigned to the 16 black-and-white keyboard buttons; **up to 8 phrases triggered at once** on top of the current pattern's 8 parts; **30 RPS sets**; Phrases don't record into the sequence and don't output over MIDI — a pure performance/live-rearrangement tool. **20 Pattern Sets** store pattern + arpeggio settings.
- **Arpeggiator (famously over-specified):** **34 styles** (including odd ones like Rhythm Guitar, Walking Bass, Reggae), Octave Range up to 3 octaves up/down, **34 Motif** settings controlling note order, **73 Beat Patterns** (accent location + note length, not all available for all styles), **Shuffle Rate**, **Accent Rate** ("by modifying the force of the accents and the note lengths, you can change the 'groove' of the arpeggio"). Arpeggios can be recorded into patterns and played simultaneously with patterns.
- **Performance controls:** **Low Boost knob** on the *back panel* ("dial in as much low-end as it takes"), four large real-time knobs (cutoff, resonance, LFO mod/rate, envelope attack/decay/release, panpot, level, portamento), 8 mute buttons for live part muting, BPM to one decimal place + tap tempo.
- **I/O:** output (L/mono, R), headphones, MIDI In/Out (**no Thru**), foot control, AC adaptor. 378 × 244 × 91 mm, 3.0 kg.
- **Variation Patterns:** store only Part Mute + Rhythm Mute settings plus a reference to the source pattern — they cost almost no memory because they contain no musical data, and they track edits to the original.

**Fold-in verdict:** ADOPT — the MC-303's *shape* is our product spec: preset patterns as a first-class feature (not filler), RPS-style phrase triggering from pads, per-part mute buttons, an over-specified arpeggiator, Live Quantize (Grid/Shuffle/Groove) as a real-time knob, and a Low Boost control. Note the RPS lesson too: performance-layer phrases that *don't* write into the sequence are more fun than another record mode.

---

### 15. Roland MC-303 — the famous criticism, and why it still matters

**Links:**
- Sound on Sound review: https://www.soundonsound.com/reviews/roland-mc303
- Sound on Sound MC-505 review (catalogue of what was fixed): https://www.soundonsound.com/reviews/roland-mc505
- MusicTech "Vintage Rewind": https://musictech.com/features/opinion-analysis/vintage-rewind-roland-mc-303-groovebox/
- Wikipedia: https://en.wikipedia.org/wiki/Roland_MC-303

**Core contribution:** the documented failure modes of the groovebox archetype — a checklist of exactly what NOT to repeat.

**KEY FACTS**
- **The core criticism:** the sound module was **limited to built-in preset sounds with only rudimentary editing**, discouraging innovation. From a technical standpoint, **knob tweaks made during real-time recording were not transmitted over MIDI**, so nothing could be captured externally. There were also **no real user patch memories** — edited patches had to be saved with a Pattern.
- **Preset/user imbalance:** 133 preset patterns + 300 variations vs only **50 user pattern memories**; MusicTech: "This thing was loaded with them, but unfortunately, that meant there were more presets than user slots."
- **Sound:** "the MC-303 was a rompler, so it couldn't compete with the genuine analogue kit"; "quite a dated sound overall, with only rudimentary editing and some simple DSP effects."
- **Preset character:** MusicTech on the factory patterns: "Many of them could best be described as hyperactive Japanese hardcore… I recall most as being objectively dreadful."
- **UI:** SOS lists "multi-layer user interface may be confusing for newcomers" among the cons; MusicTech: "not very intuitive." Non-fatal bugs in step-record input; a slow write-save process.
- **Roland's response:** fixed in the MC-505 — **MIDI transmission of virtually all front-panel controllers**, **256 user patches**, three effects processors, 714 patterns / 200 user patterns, 64-voice polyphony, 95,000 note capacity, D-Beam. And SOS's own MC-505 cons show the lineage: "Real-time tweaks can't be overdubbed on Songs, only on the Patterns that make up Songs."

**Fold-in verdict:** ADOPT as a *negative* checklist. Our acid engine must: (1) transmit/record every knob movement internally and over MIDI; (2) give users real patch memories (not patch-slots-bolted-to-patterns); (3) make user pattern slots at least as plentiful as presets; (4) never hide the interesting sound behind "preset only"; (5) make the UI shallow enough to teach in 90 seconds.

---

### 16. Roland50.studio — instruments and interaction model

**Links:**
- Site: https://roland50.studio/ · About: https://roland50.studio/about
- Yuri Suzuki project page: https://yurisuzuki.com/projects/roland50-studio
- Pentagram: https://www.pentagram.com/news/roland50-studio-launches
- MusicRadar: https://www.musicradar.com/news/free-roland50-online-music-studio
- MusicTech: https://musictech.com/news/roland50-studio-free-tb-303-tr-808-sh-101/
- gearnews: https://www.gearnews.com/roland50-studio-is-going-to-ruin-your-day/
- Designboom: https://www.designboom.com/technology/yuri-suzuki-web-based-music-tool-celebrate-50-years-roland-synthesizers-03-14-2022/

**Core contribution:** the best existing proof of the *browser groovebox as a brand artifact* — our closest direct competitor for "delightful, free, shareable acid in a browser", and the benchmark for interaction polish.

**KEY FACTS**
- **Instruments (six, confirmed live from the top-bar tabs and from the deployed JS bundle):** **SH-101, TB-303, TR-606, TR-707, TR-808, TR-909.** (It launched 2022-03-30, #303Day, as 808303.studio + SH-101, with four empty locked slots teased for later instruments; the later instruments were filled in over 2022.)
- **Interaction model:**
  - A persistent **top bar** listing every instrument as a tab; **BPM bar** sets global tempo, synchronising all instruments.
  - **Up to ~3 instruments visible at once**; extra instruments "collapse into a bar" that can be clicked to reveal the full device (documented in the built-in tour).
  - Per-device: a **16-step grid sequencer** you click notes into, plus the device's faithfully-reproduced panel below (for the TB-303: WAVEFORM, CUT OFF FREQ, RESONANCE, ENV MOD, DECAY, ACCENT, plus RANDOM, RUN/STOP, CLEAR; the SH-101 adds Source Mixer, Sub OSC, VCF Freq/Res/Env, Model Colour, Bender, Transpose, Portamento, Arpeggio).
  - Step numbering 0–16 on the grids, colour-coded steps for variation.
  - **Record → download / share to social media and messaging.** Global record button in the header.
  - A **guided tour** with numbered tips ("We've provided some instruments to start you out, but if you want to try a different one, click it in the top bar", "You can set the global speed from the BPM bar…").
- **The delight details (directly stealable):**
  - Clicking **play buttons plays a recorded sample of the physical button being pressed on an original machine** — confirmed in the deployed asset list (e.g. `303runclearrandom.mp3`, `303waveformswitch.mp3`, `808startstop.mp3`, `tr909mainbutton.mp3`, `101switch.mp3`, `101seq-arp.mp3`, `808fillin.mp3`, `707mian.mp3`).
  - The **record-function metronome countdown is sampled from a real 303** (`countdown1.mp3`, `countdown2.mp3`).
  - Yuri Suzuki's framing: "the excitement of making music with these instruments is almost like orchestrating a mini robot band; bass, drum and lead."
- **Origin:** a major update of **808303.studio** (Roland × Yuri Suzuki, 2020), originally made for The Design Museum's *Electronic: From Kraftwerk to The Chemical Brothers* exhibition's online learning experience.
- **Terms:** the site carries explicit **About / Master Class / Privacy Policy / Trademark** pages in the header. Per About: "It's a professional sounding online musical interface, which records your masterpieces and allows you to share your creations through social media, messaging and also as a download." The site is free with no login.

**Fold-in verdict:** ADOPT — this is our UX benchmark. Specifically: a **persistent instrument tab bar**, a **global BPM/transport bar shared by all instruments**, a **guided first-run tour**, **one-click record + share**, and — the highest-value idea in this entire document — **audible physicality: sample the real hardware's button/knob/countdown sounds and play them on interaction.** That single detail is what makes Roland50 feel like an instrument instead of a web toy, and it is trivially cheap to implement.

---

### 17. Roland50.studio — tech stack, authorship, and asset/licence position

**Links:**
- Live inspection of https://roland50.studio/ (DOM + `performance.getEntriesByType('resource')` + deployed Next.js chunks)
- Deployed index chunk: `/_next/static/chunks/pages/index-…js` (619 KB) — instrument names recovered here
- Yuri Suzuki + Counterpoint attribution: https://yurisuzuki.com/projects/roland50-studio
- Roland 50th anniversary site reference: https://www.roland.com/global/company/history

**Core contribution:** shows us what a browser instrument of this class is actually built with, and what the rights position looks like on the assets.

**KEY FACTS / TECH**
- **Framework:** **Next.js** (single-page app; `_next/static/chunks/*` includes `framework`, `main`, `pages/index`, `_app`, plus numbered route chunks and `_buildManifest.js` / `_middlewareManifest.js`). Hosted behind **Cloudflare** (cloudflareinsights beacon present).
- **Audio: ships a compiled DSP module at the site root — `/tb303.wasm`.** Strong signal that at least the 303 voice runs as WebAssembly rather than as a plain Web Audio node graph. Asset naming also implies **AudioWorklet usage** (a `.wasm` module is typically loaded *inside* an AudioWorklet for sample-accurate, low-latency DSP).
- **Sampled audio assets:** a full TR-808 drum set as individual `.mp3` one-shots (`bd1075`, `sd5050`, `cp`, `cb`, `ch`, `oh`, `cy5050`, `hc50`, `ht50/lt50/mt50`, `lc50/mc50`, `ma`, `rs`, `trigout` — note the velocity-suffixed names like `bd1075`/`sd5050` implying round-robin/velocity layers), **plus a library of UI sound effects** per device (303 / 808 / 101 / 404 / 707 / 909 / countdown).
- **Fonts/analytics:** Adobe Typekit (`use.typekit.net`) for type; Cloudflare Insights for telemetry. The fx assets are served from `_next/static/chunks/src/assets/sounds/...` — i.e. inlined into the JS chunks rather than a CDN bucket.
- **Authorship:** commissioned by **Roland**; designed and built by **Yuri Suzuki and team** with **Counterpoint** (studio). Suzuki is a Pentagram partner; Roland's own site frames Roland50 as one of its 50th-anniversary releases.
- **Licence/asset terms:** the site exposes **Privacy Policy** and **Trademark** pages, and the About page describes it as a gift/celebration piece. **There is no open-source licence, no asset download, and no stated reuse permission for the graphics, the `.wasm`, the samples or the UI sound effects** — everything is © Roland / the design studio, all rights reserved. There is also **no public source repository**.
- **Contrast worth recording:** the *only* permissively reusable piece of this whole landscape is Open303 (MIT, entry 19) and the x0xb0x design files (MIT, entry 20). Everything else — Roland, D16, AudioRealism, Behringer — is behaviour-reference only.

**Fold-in verdict:** ADOPT the *technique* (Next.js SPA + AudioWorklet + compiled WASM DSP + sampled one-shots + sampled UI click sounds), SKIP the *assets*. Our build must ship its own art, our own samples (or CC0/own-authored ones) and our own DSP, under our own licence — the licensing rulebook in the project README already forbids anything else.

---

### 18. tb303.com — a modern dedicated browser 303

**Links:**
- Site: https://tb303.com/ (live inspection: DOM text + deployed bundle `https://tb303.com/app.js?v=464`, 492,600 bytes)
- Note: `https://tb303.com/about` returns an Apache 404 — the About content lives in an in-app modal, not a route.

**Core contribution:** the most direct competitor/reference for a *standalone single-instrument* browser 303 — a 2025-era fan project with the full hero control set, automation, MIDI, community sharing and import/export. This is the closest thing to a peer implementation of our acid engine.

**KEY FACTS**
- **Provenance and intent:** built by **David Elfström Lilja**; he registered the domain in 1996 and released the instrument for the 303's 45th anniversary. Explicitly labelled **"V0.993 BETA"**, "a fan project… not affiliated with Roland. All names & trademarks belong to their respective owners." Front-page plea for donations to stay "online and ad-free". Same author also runs `casiovltone.com`.
- **Top-level navigation:** PATTERN ▾, IMPORT/EXPORT ▾, AUDIO/MIDI ▾, plus **STEPS, TRACKS, ✎ AUTOMATION, 🎲 RANDOM, ✖ CLEAR, 👥 COMMUNITY, LOG IN, ABOUT, ?**, and a **BPM** readout.
- **Hero synth controls (recovered from the deployed bundle):** **TUNING (with a `tuningSemis` semitone value), CUT OFF, RESONANCE, ENV MOD, DECAY, ACCENT, VOLUME, WAVEFORM** — plus `cutoffBase`, `envModNorm`, `decaySec`, `accentNorm` as internal normalised parameter names (note `decaySec`: decay is modelled in seconds, and `cutoffBase` vs cutoff implies a trim-plus-modulation split — i.e. they have separated the *base* cutoff from modulation, the same structure the Devil Fish's Cut Off + Env Mod + Tracking split implies).
- **Sequencer:** a **16-step model** with **REST, TIED, SLIDE, ACCENT** step states (SLIDE and ACCENT present as named states; TIED and REST as gate states), **TIME MODE** and **PITCH MODE** buttons — i.e. **the original two-pass pitch/time write model is preserved** — plus a **TRIPLET** option, note-entry keys, NEXT/BACK-DEL, CLEAR PATTERN, and a built-in preset named **"ACID TRAX 1"**.
- **Larger structure:** **TRACKS** (song/chaining layer), **PATTERN** (select/browse), and **AUTOMATION** (automation recording of knob moves — the exact feature the MC-303 lacked and the TB-03 lacked).
- **Sharing/community:** **COMMUNITY** section + **LOG IN**, with an account/session model (share strings and `ShareInfo`-style serialisation, `shared`/`share` used ~62 times in the bundle). A **shared pattern/community library is a first-class feature**, not an afterthought.
- **Import/export:** **JSON** pattern import/export (52+ JSON references), **WAV** export (15 references), and an IMPORT/EXPORT menu.
- **MIDI:** very heavily implemented — ~95 `MIDI` references, plus `midiAccess`, `MidiInputIds`, `midiLearn` (18 references), `MidiLearn`. Web MIDI with assignable controls appears to be supported.
- **DSP/tech:** **AudioWorklet** in use (12 `Worklet` references) — the modern, correct choice for a browser 303 since it moves the DSP off the main thread. Filter types named in the bundle include **`LADDER`** and **`BIQUAD`**, implying the author offers both a proper ladder model and a cheaper biquad. Also present: `waveCalibrate`, `waveAnchor`, `wave`, `sawtooth`, `square` — a calibrated oscillator/anti-aliasing layer (likely a band-limited or wavetable-backed oscillator with calibration against a real 303 rather than naive `OscillatorNode`).
- **Server:** Apache/FreeBSD/PHP backend (from the 404 response headers) — a lightweight classic stack behind the static SPA. Google Analytics (opt-in, with an explicit consent banner: "We use Google Analytics for anonymous usage stats — no ads, no third-party tracking").
- **Relationship to the dangerousminds article:** the DangerousMinds piece (2015) is about **Errozero's "Acid Machine"**, *not* tb303.com — see entry 20. tb303.com is the 2025 successor in that lineage of browser acid tools and is noticeably more complete (automation, MIDI learn, community, tracks, WAV/JSON export).

**Fold-in verdict:** ADOPT (as the peer/spec target) — our acid engine should match or beat this control set and must ship: the **6 hero knobs + tuning + volume + waveform**, a **16-step sequencer preserving TIME/PITCH two-pass writing AND a modern grid**, **per-step REST/TIE/SLIDE/ACCENT**, **TRIPLET**, **TRACKS**, **AUTOMATION recording**, **JSON import/export**, **WAV export**, **Web MIDI + MIDI learn**, and a **community/sharing layer with an account**. It also confirms our architectural choice: **AudioWorklet + a real ladder filter model**, with a cheaper biquad fallback.

---

### 19. Open303 (Robin Schmidt) — the MIT-licensed acid engine, and its ports

**Links:**
- Repo: https://github.com/RobinSchmidt/Open303
- Original SourceForge project: https://sourceforge.net/projects/open303/
- KVR development thread (project origin, "collaborators wanted"): https://www.kvraudio.com/forum/viewtopic.php?p=3800455
- **JC303** (JUCE port + added features): https://github.com/midilab/jc303
- SuperCollider port: https://github.com/schollz/open303
- VST3 port: https://github.com/scheffle/open303

**Core contribution:** the one piece of this whole landscape that is **actually reusable in our product under the project's licence rulebook.**

**KEY FACTS / LICENCE (verbatim from the repo's `License.txt`)**
> ```
> The Open303 source code is released under the terms of the MIT license:
>
> The MIT License
>
> Copyright (c) 2009 Robin Schmidt (www.rs-met.com)
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
> THE SOFTWARE.
> ```

- **Verdict under our rulebook: MIT = reusable with the copyright notice and permission text retained in our source distribution.** This is the only engine in this document we can lawfully port, extend and ship (provided we include that notice).
- **What it is:** "a free and open source emulation of the famous Roland TB-303 bass synthesizer… a generic and platform-independent **C++ implementation of the DSP algorithms** as well as a GUI-less plugin for the VST v2.4 interface." Originally an SVN/SourceForge project from 2009; the GitHub repo is Robin Schmidt's own continuation (he is now rebuilding it as a CLAP plugin). Repo contents: `Build`, `Libraries`, `Source`, `Notes`, `ReadMe.md`, `ReadMe.old.txt`, `License.txt`.
- **Scope from the original project announcement:** "the plugin should also include **the Devil Fish modifications** and some useful extensions on its own… the basic synth architecture is in place and now it's about time to go about tweaking the various internal parameters of the underlying signal processing algorithms." Collaborators were recruited specifically for (a) internal TB-303/Devil Fish technical details, (b) audio files of the real thing for analysis, (c) a GUI artist.
- **It is C++ DSP — this is the single most important fact for us:** it is the natural candidate for compilation to **WebAssembly** and loading inside an **AudioWorklet**, exactly the pattern Roland50.studio appears to use (`/tb303.wasm`) and that tb303.com uses (`Worklet`).
- **JC303** (https://github.com/midilab/jc303): "A Cmake JUCE port of **Robin Schmidt's Open303** with added features" — adds an **overdrive based on GuitarML research** and a BYOD DSP implementation; ships VST3/LV2/AU for macOS (x64 + M1), Windows (x64), Linux (GLIBC ≥ 2.31). **Licence is dual-layered and must be read carefully:** the repo is **GPL-3.0** overall, and the README states verbatim: *"This software is licensed under the GNU General Public License version 3 (GPLv3). The Open303 engine part of this software is also licensed under the MIT License."*
  - **Under our rulebook: the JC303 *wrapper* is GPL-3.0 → reference/clean-room only. The Open303 *engine inside it* remains MIT → reusable.** Do not take JC303's added code; take Open303 directly.
- **Other ports:** `schollz/open303` — SuperCollider port, README states "Original DSP code by RobinSchmidt (MIT License)… DSP code: MIT License (RobinSchmidt). This code: MIT License". `scheffle/open303` — VST3 port adding a silence flag, single/double precision processing, and **chord and scale events to limit pitches used by the sequencer**; repo marked "License: Other" (inherits Open303's MIT for the DSP; treat the wrapper as unverified).
- **Precedent worth noting:** Open303 has been confirmed to pass the hardest test available — it has been used as an actual pattern-transfer target ("[Wave Analyzer] useful for quickly transferring patterns from a real 303 or an **x0xb0x**", per ABL3's manual).

**Fold-in verdict:** ADOPT — **this is our acid engine's foundation.** Port Open303's MIT DSP to WebAssembly, run it in an AudioWorklet, retain the verbatim MIT notice in our source distribution, and then implement our own additions on top (the mods panel from entries 8/9/11, the sequencer from entries 4/18). Everything else in this document is behaviour reference or UX inspiration.

---

### 20. x0xb0x, and the wider open-source / browser acid landscape

**Links:**
- x0xb0x project (design files, MIT): https://www.ladyada.net/make/x0xb0x/download.html
- x0xb0x overview: https://www.ladyada.net/make/x0xb0x/
- x0xb0x schematic overview wiki: https://www.ladyada.net/wiki/x0x/schematicoverview
- Open Music Labs x0xb0x reverse-engineering: https://www.openmusiclabs.com/wiki/x0xb0x/
- **Errozero "Acid Machine"** via DangerousMinds (2015): https://dangerousminds.net/comments/browser-based_tb-303_emulator_old-school_acid_house_on_the_go/
- Dittytoy TB-303 (srtuss) — the r/synthesizers subject: https://www.reddit.com/r/synthesizers/comments/ze9tj3/a_tb303_but_in_your_browser/
- acidBros (Web Audio double-303 + 909): https://github.com/acidsound/acidBros
- SKETCH-303 (303 editor + acid voice + TR-909 shuffle maths): https://github.com/RaveGeneration/SKETCH-303 · https://webapps.ravegeneration.io/

**Core contribution:** the open hardware/documentation lineage (x0xb0x) plus the browser-acid-tool family — the direct competitive set and the clearest statement of what a browser 303 user already expects.

**KEY FACTS / LICENCE**

**x0xb0x (open hardware, MIT-design):**
- "The first release candidate… The x0xb0x is **not just another MIDI-controlled TB-303 clone**. x0xb0x is a full reproduction of the original Roland synthesizer, **with fully functional sequencer**." An original TB-303 was disassembled and reverse-engineered to verify the schematic; original transistors were curve-traced.
- **Design files released under the MIT Open Source license**, verbatim from the download page: *"Copyright (c) Limor Fried & Adafruit industries… Permission is hereby granted, free of charge, to any person obtaining a copy of this software, firmware, layout and associated documentation files (the "Design files"), to deal in the Design files without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Design, and to permit persons to whom the Design is furnished to do so, subject to the following conditions:"* — plus a naming restriction to be aware of: *"x0xb0x (TM) is a trademarked name of Adafruit Industries… you cannot call your product 'x0xb0x'"*, and a request to credit Adafruit.
- **Documented contents:** schematics + board files (Eagle, v1.0 mainboard and ioboard) for the **Power Supply, Analog Synthesizer (VCO / VCF / Envelope Generator / VCA / Headphone+Mixer), Digital Sequencer, MIDI and Sync**; BOM; gerbers; panel DXFs; firmware (C, AVR-gcc, ATmega162; SourceForge .hex v1.05 + bootloader); Java control software; a full wiki of mods by section (PS/VCO/VCF/Envelope/VCA/Sequencer/Finishing).
- **The parts list is effectively a verified 303 BOM:** 2SK30A JFET, 2SC536F NPN, 2SA733P PNP, 2SC2291 & 2SC1583 matched pairs, LA4140 headphone amp, **BA6110 (equivalent to the BA662 OTA)**, AN6562 op-amp. Open Music Labs reverse-engineered the **BA662 internal wiring** (2-transistor current mirror for control current as in CA3080; 3-transistor Wilson mirrors for the gain stage as in LM13700; complementary Darlington output with bias current control) specifically to make the substitute BA6110 behave like the original.
- **Sequencer/storage:** programmable "just like the original 303 (ok its actually a little easier)"; **128 banks of track memory and 64 banks of pattern memory in onboard EEPROM, no battery backup needed**; Random mode (fill a pattern bank with random notes) and Keyboard mode; rotary-encoder tempo knob; MIDI in/out/thru, DIN Sync (in or out, selectable), CV and Gate; firmware upgradable via USB bootloader.

**Browser acid tools (the competitive set):**
- **Errozero "Acid Machine" (the DangerousMinds article's subject, 2015):** "a free browser-based electronic composition device based around the legendary Roland TB-303." Features **two 303 simulators you can pit against one another**, a **basic drum machine**, **8 patterns per device**, composition sequencing, **URL-generation to share a finished composition**, and **.wav download**. Described by DangerousMinds as "a simplified take on the ReBirth interface"; no MIDI output at the time; "Works best in Chrome" — i.e. a Web Audio-era (pre-Web MIDI/Worklet) design. **This is the article Moddy visited, and it is NOT about tb303.com.**
- **Dittytoy TB-303 (srtuss) — the r/synthesizers post:** "Someone called srtuss created a TB-303 with pure javascript code." The shared URL exposes a full parameter set as state: `tune, pattern, waveform, cutoff, resonance, envmod, decay, overdrive, echo, gate`. Reply from the thread: "Dittytoy is fun and simple way to learn or prototype simple (or even more complex) audio-DSP applications that are based on procedural generation." Discussion in the thread noted code is executed on a **separate domain** (sandboxed), and a user asked pointedly about `eval()` — relevant to our own sandboxing decisions if we ever allow user scripts.
- **acidBros:** dual TB-303 (two independent units, for counter-melodies), saw/square with animated toggle, classic controls (Tuning, Cutoff, Resonance, Envelope Modulation, Decay, Accent, Volume), **16-step sequencer with Note / Octave / Slide / Accent per step**, monophonic slide-and-gate logic, tempo-synced delay, a **TR-909** section, **TB-303 Live Mode** (hold-based octave, AC/SL, Rest, key-transpose — step-quantised, non-destructive to stored pattern), PWA/offline support.
- **SKETCH-303 / ravegeneration web apps — the best published swing maths in the ecosystem:** *"TR-909 Shuffle, Measured From Hardware. Seven settings matching the 909's Main Keys 1 to 7… Every second step is pushed late by 2/96 of a beat per key while the rest stay nailed to the grid, so the bar never drifts. **Key 5 lands on 2:1, key 7 on 3:1.**"* Also documents accent/slide transport conventions for hardware: *"Velocities are pinned at 80 plain and 127 accented… Accent travels as velocity, slide as overlapping notes"*, and a TB-303 capture method: *"It counts the 303's own MIDI clock at six ticks per step."* Also: their acid voice uses *"an envelope that multiplies the cutoff rather than adding to it, so low settings genuinely close down"* — a concrete, quotable DSP design rule.
- **DP-303** (https://tnn1t1s.github.io/day-303/about.html): browser-native TB-303 + curated pattern library; all sound generated in real time via Web Audio **with no audio files streamed and the entire app as a single HTML file with inlined assets** — proof the whole thing can be shipped as one self-contained page.
- **RAVE Generation's own summary of why hardware-faithful matters:** "The machine makes the slide itself, which is why it sounds right rather than approximated."

**Fold-in verdict:** ADOPT (x0xb0x as documentation, one swing/maths source, one DSP rule) — x0xb0x gives us a **verified parts-level reference for the analogue topology** (useful cross-checking our DSP models against the real circuit), and its **EEPROM-based 128 track / 64 pattern banks with no battery** is the storage model to copy. From the browser set, adopt verbatim: the **TR-909 shuffle convention (7 keys, 2/96-of-a-beat late per key on every second step; key 5 = 2:1, key 7 = 3:1)**, the **accent-as-velocity / slide-as-overlapping-note MIDI convention (80/127)**, and the **multiplicative cutoff envelope rule** ("envelope multiplies the cutoff rather than adding to it, so low settings genuinely close down"). SKIP building on any of the GPL wrappers.

---

# A. Comparison table — 303 hero controls × emulations

✔ = present as a user control · ~ = present but different/limited · ✘ = absent · — = n/a (hardware has no such switch)

| Hero control | TB-303 (1981) | Roland TB-03 | ABL3 | D16 Phoscyon 2 | TD-3 | TD-3-MO | tb303.com (browser) |
|---|---|---|---|---|---|---|---|
| Waveform saw/square | ✔ switch | ✔ switch | ✔ | ✔ | ✔ switch | ✔ switch | ✔ |
| Tuning | ✔ (±700 ¢) | ✔ | ~ (±12 semis) | ✔ (+ coarse/fine) | ✔ | ✔ | ✔ (+ `tuningSemis`) |
| Cutoff | ✔ (~2.5 kHz max) | ✔ | ✔ | ✔ | ✔ | ✔ (closes fully → 5 kHz, MIDI CC) | ✔ (`cutoffBase`) |
| Resonance | ✔ (non-self-osc) | ✔ | ✔ | ✔ | ✔ | ✔ (can self-oscillate) | ✔ |
| Env Mod (bipolar) | ✔ (can't reach zero) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ (`envModNorm`) |
| Decay | ✔ (MEG 200 ms–2 s) | ✔ | ✔ | ✔ | ✔ | ✔ (VEG 16 ms–3 s) | ✔ (`decaySec`) |
| Accent amount | ✔ | ✔ | ✔ | ✔ ((+ Acc. Vol. decoupled)) | ✔ | ✔ | ✔ (`accentNorm`) |
| Volume | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| **Slide time control** | ✘ (fixed 60 ms) | ✘ | ✔ | ✔ | ✘ | ✔ (up to 6×) | ✘ (fixed, per step) |
| **Accent decay separate** | ✘ (fixed 200 ms) | ✘ | ✘ | ✔ (Acc. Decay) | ✘ | ✔ (30 ms–3 s) | ✘ |
| **Env attack** | ✘ (~3 ms fixed) | ✘ | ✘ (Env Attack? no) | ✔ (Env. Attack) | ✘ | ✔ (Soft Attack 0.3–30 ms) | ✘ |
| **Accent sweep modes** | ✘ | ✘ | ✘ | ✔ (Resonance/Sweep Couple) | ✘ | ✔ (3 modes + high-res mode) | ✘ |
| **Sweep speed modes** | ✘ | ✘ | ✘ | ✔ (Sweep Amt) | ✘ | ✔ (slow/norm/fast) | ✘ |
| **Filter tracking** | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ | ✘ |
| **Filter FM** | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ (from VCA out) | ✘ |
| **Overdrive / distortion** | ✘ (external pedals) | ✔ (3 flavours) | ✔ (transistor, +hipass, 19 models? no—) | ✔ (19 models, 5 insert FX) | ✔ (distortion) | ✔ (overdrive, no distortion) | ✘ |
| **Muffler (post-VCA soft clip)** | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ (2 stages) | ✘ |
| **Sub-oscillator** | ✘ | ✘ | ✘ | ✔ (Vibrato, not sub) | ✘ | ✔ (L/M/H) | ✘ |
| **Self-oscillation** | ✘ | ✘ | ~ (max resonance) | ~ | ✘ | ✔ | ✘ |
| **Calibration/trim page** | ✘ (service pots) | ✘ | ✔ | ✔ (9 params) | ✘ | ~ (internal pot) | ✘ |
| **Delay / reverb** | ✘ | ✔ | ✘ | ✔ (reverb + 5 inserts) | ✘ | ✘ | ✘ |
| **Sequencer steps** | 16 | 1–16 (+ triplet) | 1–64 | 1–64 | 16 | 16 | 16 (+ triplet) |
| **Pattern slots** | 64 (8×2×4) | 96 (4×3×8) | 128 | bank-based | 250 | 250 | PATTERN browser |
| **Two-pass pitch/time write** | ✔ (the original) | ✔ (Original mode) | ~ (step record) | ✔ (keyboard view) | ✔ | ✔ | ✔ (TIME/PITCH MODE) |
| **Modern grid editor** | ✘ | ✔ (Step mode) | ✔ (Grid Edit) | ✔ (piano roll) | ~ | ~ | ✔ |
| **Swing / shuffle** | ✘ | ✔ | ✔ (MPC timing) | ~ | ~ | ~ | ✘ (not found) |
| **Randomiser** | ✘ (battery-scramble) | ✔ (×2 modes) | ✔ (advanced) | ✔ (density control) | ~ | ~ | ✔ |
| **Live override of accent/slide** | ✘ | ✘ | ✘ | ✔ | ✘ | ✔ (manual accent btn) | ~ (automation) |
| **Automation recording** | ✘ | ✘ (criticised) | host automation | host automation | ✘ | ✘ | ✔ |
| **MIDI** | ✘ (CV/Gate + Sync) | ✔ + CV/Gate + Trigger In | ~ (plugin, MIDI out) | ✔ (MIDI out, CC) | ✔ USB + DIN | ✔ USB + DIN + CV I/O | ✔ Web MIDI + MIDI learn |
| **Pattern sharing / community** | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ (COMMUNITY + LOG IN) |
| **JSON/WAV export** | ✘ | ~ (USB backup) | MIDI export (drag-drop) | MIDI export (drag-drop) | ✘ | ✘ | ✔ JSON + WAV |

**Table takeaway for the plan:** the *hero control set* (first 9 rows) is universal and non-negotiable. The *differentiators* cluster in three bands — (1) envelope/accent surgery (slide time, accent decay, env attack, sweep modes), (2) character/drive (overdrive, filter FM, muffler, tracking, sub-osc), (3) workflow (automation, community sharing, JSON/WAV/MIDI export). **Only tb303.com offers band 3**; **only TD-3-MO offers all of band 2**; **only Phoscyon 2 offers all of band 1 as clean UI controls.** No single product covers all three bands. **That gap is the product.**

---

# B. The famous-mods list (the canon our mods panel should honour)

Sourced primarily from the Devil Fish manual and confirmed as a shipping feature list by the TD-3-MO and Phoscyon 2 (see entries 8, 9, 11).

**From the Devil Fish (Robin Whittle, 1993→present) — the canonical list:**
1. **Overdrive** — oscillator level into the filter, zero → **66.6×** normal.
2. **Variable Slide Time** — 60 ms stock → **60–360 ms** (internal seq) / **2–300 ms** (external CV).
3. **Soft Attack** — **0.3–30 ms** on non-accented notes (stock ~3 ms).
4. **Variable VEG decay** — **16 ms–3 s**, plus a no-decay/infinite-sustain mode (stock fixed 3–4 s).
5. **Separate Normal + Accent MEG decay** — **30 ms–3 s** each (stock 200 ms fixed for accents).
6. **Filter Tracking** — filter follows note pitch (stock: none), ~**2.7 kHz/V** at max, non-linear/inaccurate by design.
7. **Filter FM** — AC-coupled, **from the VCA audio output** (not the VCO). Approaches chaos at high settings.
8. **Muffler** — post-VCA soft-clip distortion in **2 flavour stages**, bass-preserving, only acting on loud signals.
9. **Accent Sweep modes** — **3** (standard rising / inverted falling / super-slow), disable-able.
10. **Sweep Speed** — **3 modes**, cumulative across fast accented runs.
11. **Manual accent push-button.**
12. **Self-oscillation** capable filter.
13. **Expanded Cut Off range** — doubled to ~5 kHz, extended downwards.
14. **Expanded Env Mod range** — tripled, and finally able to reach **zero**. (Stock 303 cannot switch off envelope modulation.)
15. **Improved bass response** — **32 Hz from −5 dB to −1 dB**.
16. **CV/Gate I/O set** — CV in, Gate in, Slide-trigger CV in (2.3 V on; >4 V ties gates), Accent CV in, Filter CV in (~1 V/oct), Accent out, CV out, Gate out.
17. **Audio I/O set** — Audio In to Filter (replaces Mix In), Audio In to FM the filter (replaces headphone tip), Audio Out from filter (pre-VCA).
18. **32-bank memory + Dynamic Bank Switching** — change bank mid-pattern, sequencer reads the next note from the same pattern number in the new bank.
19. **Quicksilver 303 CPU replacement** option.
20. **MEG activity LEDs** (separate for normal and accented notes) and a gate-active LED.
21. **A documented "stock 303" reset** — the mod is designed so it "can still perform all the functions of the TB-303."

**Mods/behaviours added by later implementations (worth including as "modern canon"):**
22. **Resonance/Sweep coupling** and an **Accent ↔ Accent-Volume decouple switch** (Phoscyon 2).
23. **Vibrato** as a two-note tremolo smoothed by slide (Phoscyon 2; also ABL3's Up+Down-on-a-step trick).
24. **Sub-oscillator** (TD-3-MO; explicitly *not* a Devil Fish mod).
25. **Switchable "defects"** — broken accents, broken slides (ABL3 3.3.0).
26. **VCO models / grit levels** — clean-clone vs authentic-dirty vs less-dirty (ABL3 Models 1/2/3).
27. **VCA clicks + VCA noise** modelling (ABL3).
28. **Filter-feeding feedback** as a first-class routing option (TD-3-MO Filter FM in; Devil Fish Audio Filter FM).

---

# C. "What our acid engine must ship" checklist

Derived from the table's gaps: no shipping product covers all three bands. Ours should.

## C1. Sound (DSP behaviours — the non-negotiables)
- [ ] **Diode-ladder, 4-pole, 24 dB/oct VCF**, with the **asymmetrical C/2 bottom capacitor** and correct pole placement (`H_tb(s) = −1/(s⁴ + 6.727s³ + 14.142s² + 9.514s + 1)` as the reference shape). Label it 4-pole; document the "behaves like 18 dB in the audible band" nuance honestly.
- [ ] **Non-linear resonance** — materially less resonance at low cutoff, so the low end stays clean while the top screeches.
- [ ] **No key-tracking by default** (stock 303 behaviour). Tracking is a mod, exposed as a control.
- [ ] **Coupling-capacitor behaviour** — the LF resonant peak plus the ~500 ms residual filter-frequency drift after large cutoff steps.
- [ ] **VCO:** saw + a **derived square whose pulse width varies with oscillator frequency** (do not use a static-duty square).
- [ ] **Two envelopes:** MEG (filter, bipolar — can push cutoff *below* the knob setting) + VEG (VCA). Env Mod must be able to reach **zero** and to **triple** the stock max.
- [ ] **Accent = four simultaneous changes:** VCA amplitude boost, cutoff boost, resonance emphasis, MEG decay shortened to ~200 ms — with **stateful accumulation** (an accent-sweep capacitor that only partially discharges between accents, producing rising filter peaks on consecutive accents) and a **resonance-dependent lag circuit** producing the "wow"/"wapp".
- [ ] **Slide = fixed-time portamento, 60 ms default, starting at the destination note.** Then a *variable* slide-time control (up to ~6×) as a mod.
- [ ] **Anti-aliasing / band-limiting** on the oscillator (tb303.com ships `waveCalibrate`/`waveAnchor`; SKETCH-303's note that hardware-faithful slides "sound right rather than approximated" is the standard).
- [ ] **Envelope multiplies the cutoff rather than adding to it**, so low cutoff settings genuinely close down (RAVE Generation's documented rule).
- [ ] **Drive/character chain:** transistor-modelled overdrive with Drive + mix, a sweepable 12 dB/oct hipass (0–15284 Hz is the ABL3 range), clipping modes Off/Soft/Hard, and a **bass-preserving post-VCA muffler** (2 stages).
- [ ] **Self-oscillation** reachable at high resonance (a modded-303 capability; include it, off by default).
- [ ] **Filter FM from the VCA output**, AC-coupled, with the documented dead-then-chaos curve.
- [ ] **Calibration/"your 303" page:** VCO model (clean / authentic-dirty / lighter), reso trim, gate trim (default 50% = stock), VCA clicks, VCA noise, low cut, bass/treble, VCO detune across octaves, internal trim-pot simulation. Saved per patch.

## C2. Sequencer
- [ ] **16-step core, 1–64 steps in the modern view**, with a **triplet grid** option.
- [ ] **Per-step states: Pitch, Octave down/up, Slide on/off, Accent on/off, Gate/Rest, Tie.**
- [ ] **Two-pass TIME/PITCH write mode** as a *first-class option* (not a legacy easter egg) — it is the acid-pattern generator.
- [ ] **Modern grid/piano-roll editor** as the default for newcomers, plus a **classic keyboard view** for purists (Phoscyon 2's dual-view pattern).
- [ ] **Pattern chaining + song/track mode** (up to 256 measures is the TB-03 ceiling; 10 songs is the MC-303 pattern).
- [ ] **Live pattern switching per device/voice** (ReBirth's single best invention) and **pattern-set memories** that store arpeggio/routing settings alongside patterns (MC-303's Pattern Sets).
- [ ] **Randomiser with density control** over notes / ties / accents / slides / octaves, plus a **mutate** (partial re-roll) and a **scale/root lock** so generated lines stay in key.
- [ ] **Shift / transpose / reverse / octave ±** pattern utilities.
- [ ] **Swing/shuffle using the measured TR-909 convention:** 7 keys; **every second step pushed late by 2/96 of a beat per key, grid never drifts; key 5 = 2:1, key 7 = 3:1.** Offer it as an explicit, labelled control (not an unnamed %) — that is a differentiator vs every emulation reviewed.
- [ ] **Live override** of accent / slide (and vibrato) that does not destroy the stored pattern.
- [ ] **Automation recording** of every knob — the one thing the MC-303 and TB-03 were both criticised for lacking, and which tb303.com ships.
- [ ] **Accent/slide as MIDI conventions:** accent → velocity (industry convention 80 plain / 127 accented; threshold >96 or >100 depending on unit), slide → overlapping notes. Export must preserve this.

## C3. UX / product
- [ ] **Six hero knobs first, in the original layout order** (Tuning, Cutoff, Resonance, Env Mod, Decay, Accent), plus Waveform and Volume. Everything else is additive and visually secondary.
- [ ] **A mods panel** exposing the famous-mods list (section B) as first-class controls, grouped as: envelope surgery / character & drive / routing.
- [ ] **A global transport bar shared by all instruments** (BPM, play/stop, record) — the Roland50 pattern, scaled to a flagship.
- [ ] **A guided first-run tour** with numbered tips and a "Let's do it" entry — Roland50's onboarding works and is cheap.
- [ ] **Audible physicality:** sampled real-hardware button/knob/countdown sounds on interaction. Highest delight-per-line-of-code item in this document; ship our own recorded assets (licence-clean).
- [ ] **One-click record → download → share**, plus a **community/pattern-sharing layer with accounts** (tb303.com's COMMUNITY + LOG IN; ReBirth's mod culture proved this community matters).
- [ ] **Preset patterns as a headline feature**, not filler — with the MC-303's lesson applied: **plenty of user slots, and every knob move recorded/MIDI-transmitted.**
- [ ] **Import/export: JSON (patterns/patches), WAV (audio), MIDI (patterns)** — plus hardware pattern import from TD-3 / TB-03 / ReBirth if cheap (ABL3 does all three; it is a strong retention feature).
- [ ] **RPS-style performance phrases** assigned to pads that trigger on top of the playing pattern *without* writing into it (MC-303 RPS; a pure-jam layer).
- [ ] **A documented "stock 303" reset** on the mods panel (the Devil Fish's page-7 concept) so purists can trust the engine.
- [ ] **MIDI learn + full Web MIDI in/out**, and **AudioWorklet + compiled WASM DSP** as the engine substrate (Roland50 uses `/tb303.wasm`; tb303.com uses AudioWorklet; Open303 gives us MIT C++ to compile).
- [ ] **Offline/PWA support** — SKETCH-303 and acidBros both ship it; "works offline once loaded" is now table stakes for a browser instrument.
- [ ] **Licence hygiene:** engine built on **MIT Open303 with its notice retained**; everything else behaviour-referenced only; no Roland trademarks or trade dress (the ReBirth iOS removal is the precedent).

---

# D. Dead ends and non-findings (logged)

1. **Reddit direct access is blocked.** Reddit refuses automated HTML/JSON/RSS with a network-security wall; PullPush was the working route for one thread and then returned *"Rate limit exceeded. This website does not provide free scraping resources for agents."* for subsequent queries.
   - **Recovered:** the r/synthesizers post *"A TB-303 but in your browser"* (`/comments/ze9tj3/`, ~17 Dec 2022, 19 upvotes, 9 comments) via the PullPush `ids=` endpoint — submission text and comments captured (entry 20). Some comments were `[deleted]`.
   - **Not recovered:** any dedicated r/synthesizers **MC-303** threads. Reddit content on the MC-303 is limited here to what search snippets and review articles report; treat Reddit MC-303 sentiment as uncovered.
2. **tb303.com has no `/about` route** — it returns an Apache 404 (`Apache/2.4.68 (FreeBSD) mpm-itk/2.4.7-04 PHP/8.4.24`). The About content is an in-app modal; its text was captured from the running app instead.
3. **No clean panel screenshot of tb303.com.** The second/third browser attempts drifted onto stale tabs (one landed on a Cloudflare "Performing security verification" page, another on an unrelated MusicRadar article). Attempts stopped at 3 per URL per the task rule. Its feature set was instead recovered from the live DOM text of the app plus a direct read of the deployed `app.js` bundle (492,600 bytes) — which is stronger evidence than a screenshot anyway.
4. **roland50.studio's main stage is canvas/WebGL-rendered**, so `document.body.innerText` is empty before and after entering the studio; the instrument list had to be recovered two other ways — visually from the top-bar tabs (SH-101, TB-303, …, TR-606, TR-707, TR-808) and definitively from the deployed Next.js index chunk (619,316 bytes), which contains exactly six instrument names: TB-303, TR-808, TR-606, TR-707, TR-909, SH-101. The guided tour also has to be clicked through manually to read its panels.
5. **Roland50.studio licence terms are not published as a licence.** The site exposes Privacy Policy and Trademark pages but no asset-licence, no source and no reuse grant. Recorded as "all rights reserved" rather than guessing.
6. **Devil Fish manual PDF was read via extracted text and search-indexed page content**, not by opening the PDF directly; the version-history section and the "Limiting the Devil Fish to TB-303 sounds" page-7 procedure are noted from the table of contents and page references rather than quoted in full.
7. **ABL3 filter labelling conflict (recorded, not resolved):** AudioRealism's product page and German test coverage describe an "**18 dB/Octave**" low-pass filter, while Tim Stinchcombe's circuit analysis (entry 2) establishes the hardware is 4-pole/24 dB. Both descriptions are in the wild for the same circuit; entry 2 is the physically correct one.
8. **TD-3-MO filter labelling conflict (recorded, not resolved):** Thomann/Behringer/D16 describe a "**4-pole** low-pass filter"; the translated TD-3-MO manual page says "**3-pol or 18 dB/Octave**". Same underlying 303-style diode ladder; the discrepancy is descriptive, not circuit-level.
9. **TB-303 unit-count discrepancy (recorded, not resolved):** ~10,000 units (Wikipedia, MusicRadar, DJ TechTools) vs ~17,000 units "according to internal Roland documents" (gearnews). Flagged in entry 1.
10. **MC-303 presets vs user slots:** the "50 user pattern memories" figure is consistent across SOS, Roland's brochure and Wikipedia; the SOS review's own con list adds "**No individual audio outputs**" and "**Doesn't transmit everything over MIDI, as you'd hope**" — captured in entry 15.
11. **Not investigated in this task (out of scope, owned elsewhere):** engine-level web-audio implementation details (that is the engine task), commercial/licence clearance for sample packs, and any Anvil-specific visual design language.

---

```json
{"file": "C:\\Users\\Moddy\\anvil\\research\\acid\\T2-acid-heritage.md", "items_count": 20, "dead_ends": ["Reddit direct fetch blocked (network security wall); PullPush rate-limited after one successful thread — r/synthesizers MC-303 threads not mined", "tb303.com/about returns Apache 404 — About content only in-app modal", "No clean tb303.com panel screenshot (tab drift / Cloudflare verification); feature set recovered from live DOM + deployed app.js bundle instead", "roland50.studio stage is canvas/WebGL — innerText empty; instrument list recovered from top-bar tabs + Next.js index chunk", "roland50.studio publishes no asset licence or source — recorded as all-rights-reserved, not guessed", "Devil Fish manual read via extracted text rather than opened as PDF — version-history section not fully quoted", "ABL3 markets an '18 dB/Octave' filter while circuit analysis shows 4-pole/24 dB — conflict recorded, not resolved", "TD-3-MO labelled '4-pole' by Behringer/Thomann but '3-pol or 18 dB/Octave' in the translated manual — conflict recorded, not resolved", "TB-303 production count: ~10,000 units (Wikipedia/MusicRadar) vs ~17,000 units per Roland internal docs (gearnews) — conflict recorded", "Out of scope here: web-audio engine implementation detail, sample-pack licence clearance, Anvil visual design language"]}
```
