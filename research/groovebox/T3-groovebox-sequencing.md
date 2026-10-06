# T3 — Groovebox sequencing, pattern models & live-performance conventions

Date: 2026-10-06 · Author: T3 research subagent (Hermes) · For: Anvil build plan (research wave 1).
Method: vendor manuals / official guides read this session; **[V]** = fact read in a vendor doc or vendor-published article at research time. Cross-refs: annex `06-performance-controls-gap.md` (arp/latch/chord memory/velocity/sustain/glide + the swing *pairing law*) and `T0-tab-digest.md` (303 acid seed: `[note, gate, slide, accent]` quadruples). This file ADDS: step sequencing, pattern models, song arrangement, performance scenes, probability/generative tools, timing math, and the browser-tools gap scan. It does not repeat the annex's 18-item live-control list.

Device set: Elektron Digitakt II / Digitone II / Model:Cycles · Novation Circuit Tracks / Rhythm · Roland MC-101 / MC-707 · Akai MPC (classic + 2.11+) · Polyend Play / Play+ · OXI One · Synthstrom Deluge · TE OP-Z · TE Pocket Operators · browser tools.

---

## Foundations — the devices

### 1. Elektron Digitakt II — the per-step data model (parameter locks, trig page, retrig page)

**Links:** [Digitakt II User Manual (elektron.se PDF, OS 1.15A)](https://www.elektron.se/wp-content/uploads/2025/07/Digitakt-2-User-Manual_ENG_OS1.15A_250708.pdf) · [easymanua.ls manual text p.53](https://www.easymanua.ls/elektron/digitakt-ii/manual?p=53) · [p.54](https://www.easymanua.ls/elektron/digitakt-ii/manual?p=54) · [p.47](https://www.easymanua.ls/elektron/digitakt-ii/manual?p=47)

**Core contribution:** the most complete per-step field set shipping today — every trig carries its own note, velocity, length, condition, fill flag, and *any* synthesis parameter (parameter locks) **[V]**.

**KEY FACTS:**
- **Parameter locks**: "set every trig to have its own unique parameter values… pitch, amp or filter settings"; works on all track types; entered in grid/live/step recording; live recording also drops lock-only trigs on empty steps **[V]**. **Preset locks** extend this to whole sounds.
- **Trig page (TRIG PAGE 1)**: `NOTE` (pitch; filterable to the keyboard scale), `VEL` (velocity), `LEN` (note length), `FILL` (ON/OFF trig condition), `COND` (trig condition selector) **[V]**. On the track menu there is also `PROB` (trig probability, default 100%, "re-evaluated every time a trig is set to play") **[V]**.
- **Retrig page (TRIG PAGE 2)**: `RTRG` on/off, `RATE` = 1/1, 1/2, 1/3, 1/4, 1/5, 1/6, 1/8, 1/10, 1/12, 1/16, 1/20, 1/24, 1/32, 1/40, 1/48, 1/64, 1/80 — "1/16 is the nominal retrig rate, one trig per step. 1/32 corresponds to two trigs per step… To trig triplets, set to 1/12 (or 1/24)" **[V]**; `LEN` = duration of the retrig velocity curve "in fractions of, or rational or integer multiples of, a step" (**1/16 = one step**); `VFAD` = velocity fade −64…+64 (−64 full fade-out, 0 flat, +64 fade in) **[V]**.
- Per-page randomize ([PARAMETER] + [YES]) re-rolls a whole parameter page — a cheap variation tool to copy **[V]**.

**Fold-in verdict:** ADOPT — this is the spine of our step object: note/vel/gate + per-step parameter overrides + retrig sub-fields. Our step record should serialize sparsely (only locked fields).

### 2. Elektron conditional trigs & fill mode — the rule engine

**Links:** [easymanua p.48 (trig conditions)](https://www.easymanua.ls/elektron/digitakt-ii/manual?p=48) · [p.49 (fill mode)](https://www.easymanua.ls/elektron/digitakt-ii/manual?p=49) · [p.53/54 (PROB, FILL condition)](https://www.easymanua.ls/elektron/digitakt-ii/manual?p=54)

**Core contribution:** conditional locks turn one pattern into a rotating set of variations without extra patterns — the single biggest "feels alive" mechanic in modern hardware **[V]**.

**KEY FACTS — the full condition list (Digitakt II) [V]:**
- `PRE` / `¬PRE` — true if the most recently evaluated condition **on the same track** was true/false (PRE is ignored/not evaluated in this check).
- `NEI` / `¬NEI` — same, but reads the **neighbour track** (the track before the active one; track 3 is neighbour of track 4).
- `1ST` / `¬1ST` — plays only on the first loop of the pattern.
- `LST` / `¬LST` — plays on the **last pass before the pattern changes** (chain-aware "last cycle").
- `A:B` — "A sets how many times the pattern (or track, if shorter) plays before the trig condition is true; B sets how many times it plays before the cycle restarts." Common reading: **fires on the A-th pass of every B passes** (1:2 = first of every two; 8:8 = last of eight). Pass counter is per track when the track is shorter than the pattern **[V]**.
- `PROB` — 0–100% per trig (default 100), **re-rolled independently every pass**, lockable per trig **[V]**.
- `FILL` ON/OFF — plays only when FILL mode is active (OFF = inverse) **[V]**.
- **FILL activation laws**: arm one cycle with [YES]+[PAGE] ("active when the pattern loops, remains active until it loops again"); momentary = hold [PAGE]; latched = [PAGE]+[YES], press [PAGE] to unlatch **[V]**. Manual's own use case: two sequences on one track, one only under FILL **[V]**.

**Fold-in verdict:** ADOPT — per-step `cond` field + one global FILL boolean with momentary/latch/one-cycle modes in v1. PRE/NEI are cheap once a per-track "last condition result" byte exists — ship those in v1.1. This also aligns the annex's "fill" hole for live drum fills.

### 3. Elektron timing toolkit — micro timing, retrig rate math, quantize

**Links:** [Digitakt manual p.31 (manualslib, micro timing + retrig menu)](https://www.manualslib.com/manual/2166470/Elektron-Digitakt.html?page=31) · [easymanua p.45 (micro timing, quantize menu)](https://www.easymanua.ls/elektron/digitakt-ii/manual?p=45) · [Octatrack Notebook (same sequencer family — resolution table)](https://anyflip.com/fvhgu/yckd/basic/201-250)

**Core contribution:** per-step time nudging below the grid line, plus a real-time quantize recovery control **[V]**.

**THE MATH:**
- Elektron internal resolution: **384 ticks per 4/4 bar; 24 ticks per 16th-note step**. Micro timing nudges a trig **±23/384 of a bar = ±23 ticks ≈ 0.958 of a step** — deliberately *just under* one step, so two trigs can swap near-position but never fully overlap **[V]** (Octatrack Notebook table: 1/384 → 23/384 resolution ladder; Elektronauts confirms "384 ticks per bar, 24 ticks per step").
- At 120 BPM: one 16th step = 125 ms, one tick = **5.21 ms**, max nudge ≈ **±119.8 ms**. Scale linearly with tempo.
- **Quantize menu** ([FUNC]+[TRIG PARAMETERS]): TRACK / PATTERN modes, real time, "the higher the quantize value, the more the trigs will be quantized" — i.e. a partial-quantize **amount**, not on/off **[V]**.

**Fold-in verdict:** ADOPT — micro-shift field in ticks (range ±23 of 24), plus a global "quantize amount" knob that can pull recorded nudges back. Both are trivial on a sample clock and make live recording safe.

### 4. Elektron structure — per-track length/speed, Euclidean generator, song mode, chains

**Links:** [easymanua p.44 (Euclidean)](https://www.easymanua.ls/elektron/digitakt-ii/manual?p=44) · [p.46 (per-track mode)](https://www.easymanua.ls/elektron/digitakt-ii/manual?p=46) · [p.47 (locks, CHANGE/RESETS)](https://www.easymanua.ls/elektron/digitakt-ii/manual?p=47) · [p.50 (song mode)](https://www.easymanua.ls/elektron/digitakt-ii/manual?p=50)

**Core contribution:** the full ladder from per-track polymeter/polyrhythm up to a 99-row song arrangement **[V]**.

**KEY FACTS / THE MATH:**
- Pattern: up to **128 steps over 8 pages** of 16. Two modes: **PER PATTERN** (all tracks same length) and **PER TRACK** (individual length + speed per track). Track length increments **2/16 → 128/128** **[V]**.
- **SPEED** per track/pattern: 1/8X, 1/4X, 1/2X, 3/4X, 1X, 3/2X, 2X. Manual's own guidance: **2X gives a 32nd-note base resolution; 3/4X makes the box play triplets against other gear at the same BPM** **[V]** — this is the polyrhythm lever.
- **CHANGE** (pattern change length) vs **RESETS**: chain stepping and phase reset are configurable; "the CHANGE parameter overrides [RESETS] if its value is less" **[V]**.
- **Euclidean mode** per track: two pulse generators (`PL1`, `PL2`) place trigs as evenly as possible; a **boolean operator combines or subtracts** the two sets; `R01` rotation; converting to regular trigs = hold [FUNC] while disabling; p-locks still work on generated trigs **[V]**.
- **Song mode**: rows with — row #, **LABEL** (Verse/Chorus/Fill keywords), **PTN**, **ROW PLAY COUNT** (repeats), **ROW LENGTH** in steps (2–1024; default = pattern length), **ROW TEMPO** (per-row BPM, or one BPM for the song; row inherits pattern's BPM/swing by default), **ROW MUTE** per track. **Up to 99 rows/song, 16 songs/project; swing is always set per row** **[V]**.

**Fold-in verdict:** ADOPT — per-track length + speed multipliers in v1 (they are the whole polymeter/polyrhythm story); Euclidean generator = SHOULD (v1.1); song rows adopt the exact shape (pattern, repeats, mute snapshot, optional tempo) as our arrangement data model.

### 5. Elektron Model:Cycles — the stripped-down groovebox cut

**Link:** [elektron.se Model:Cycles product page](https://www.elektron.se/explore/modelcycles)

**Core contribution:** proof that 6 tracks + Elektron genes + a toy-like surface is a shipped, loved product — the scope bar for our "groovebox lane" **[V]**.

**KEY FACTS:**
- 6 FM machine tracks (with pad-per-track, 6 velocity-sensitive pads); sequencer **up to 64 steps**; "**unique length and scale settings per track**"; parameter locks; micro timing; trig conditions; assignable retrig; real-time or grid recording; **Control All** (grab any parameter and sweep it across every track — a signature live trick) ; 96 projects × 96 patterns **[V]**.
- Product framing: "playful", one-knob-per-function — the anti-menu design language.

**Fold-in verdict:** REFERENCE — validates a 6–8 track default and the Control-All macro (one drag = whole-kit filter sweeps) as a live feature. (A "CHANCE" style control was *searched for and not verified* — see dead ends; do not claim it.)

### 6. Novation Circuit Tracks — the celebrated pattern/clip-per-track workflow

**Links:** [Hardware overview (glossary: Pattern, Probability, Scenes…)](https://userguides.novationmusic.com/hc/en-gb/articles/25494476280850-Circuit-Tracks-hardware-overview) · [Synths/MIDI/Drums guide (probability, mutate)](https://userguides.novationmusic.com/hc/en-gb/articles/26207128061458-Using-Circuit-Tracks-Synths-MIDI-Tracks-and-Drums) · [Mixing/performing (swing 20–80, sidechain)](https://userguides.novationmusic.com/hc/en-gb/articles/26207162799506-Mixing-and-performing-on-your-Circuit-Tracks) · [Product page](https://novationmusic.com/products/circuit-tracks) · [Circuit Tracks User Guide v3 PDF](https://fael-downloads-prod.focusrite.com/customer/prod/downloads/circuit_tracks_user_guide_v3_en.pdf)

**Core contribution:** a pattern-per-track model with per-step probability and micro steps — the workflow people cite as the reason Circuit "just works" **[V]**.

**KEY FACTS:**
- 8 tracks: 2 synth (6-voice), 2 MIDI, 4 drum. **Pattern = up to 32 steps, "contains per-step data for velocity, gate, probability and automation"**; per-note velocity within a step; **8 pattern memories per track**; pattern length any value ≤32 with independent **start/end points**, **play direction**, and **rate** relative to BPM **[V]**.
- **Micro steps**: each step is subdivided into **6 micro steps** for off-grid timing (Shift+Gate) **[V]**.
- **Probability**: 8 values — 100 / 87.5 / 75 / 62.5 / 50 / 37.5 / 25 / 12.5 %; per step; on drum tracks probability is **per step, not per micro step** (all hits on that step fire or none) **[V]**.
- **Mutate** (Shift+Duplicate): reassigns the steps notes/hits land on; "all step parameters are reassigned… including micro steps, gate values, sample flips, probability and automation data" — the *count* of hits and the samples are unchanged **[V]**.
- **Swing: range 20–80, default 50**; it shifts the **even-numbered (off-beat) steps**; below 50 the even step comes *earlier* than straight, above 50 later **[V]**.
- **Scenes**: "one of 16 memories to which multiple Patterns and Pattern Chains can be assigned, so a longer sequence can be triggered by a single pad. Scenes can be further chained to create a Sequence" (queuing supported; project switch queues to end of current pattern, or Shift+select = immediate) **[V]**.
- Extras: 16 scales + transpose; sidechain (7 presets, drum track ducks synth); pattern chains per track.

**Fold-in verdict:** ADOPT — our v1 UI target: step grid with per-step velocity/gate/probability + micro-step nudge + per-track pattern memory + scenes. Mutate and the 8-step probability ladder can ship as-is (both are ~50 lines on top of the step model).

### 7. Novation Circuit Rhythm — per-track chains & mutate law

**Links:** [Using Circuit Rhythm's patterns](https://userguides.novationmusic.com/hc/en-gb/articles/25494352385810-Using-Circuit-Rhythm-s-patterns) · [Circuit Rhythm hardware overview](https://userguides.novationmusic.com/hc/en-gb/articles/25494352288146-Circuit-Rhythm-hardware-overview)

**Core contribution:** the cleanest statement of *per-track pattern chaining* and what a "mutate" may legally touch **[V]**.

**KEY FACTS:**
- 8 sample tracks; 8 patterns/track; patterns default 16 steps, expandable to 32, and chains run **up to 256 (8×32) steps**; "not all the Patterns for each track need to be chained in the same way… 64-step drum patterns on Tracks 1–2 combined with a longer sequence of other tracks"; **the longest chain defines overall sequence length** **[V]**.
- Mutate keeps note count/samples, reassigns all step data (micro steps, gate, flips, probability, automation) **[V]**.

**Fold-in verdict:** REFERENCE — per-track chains + "longest chain = sequence length" is the arrangement model option A (below); mutate law = SHOULD feature spec verbatim.

### 8. Roland MC-101 / MC-707 — clips, scenes, TR-REC, arpeggio ×2, Scatter

**Links:** [MC-707 product page](https://www.roland.com/us/products/mc-707) · [MC-707 Update PDF (arp VARIATION list incl. x2, Scatter, scene banks)](https://static.roland.com/assets/media/pdf/MC-707_update_eng08_W.pdf) · [MC-101 specifications](https://www.roland.com/global/products/mc-101/specifications/) · [MC-101 Reference Manual](https://static.roland.com/assets/media/pdf/MC-101_Reference_eng01_W.pdf)

**Core contribution:** the clip/scene performance model (Roland's answer to Ableton-style launch rows) plus an arpeggiator that generates two notes per step ("x2") **[V]**.

**KEY FACTS:**
- MC-707: 8 tracks; **128 clips (16 per track)**; a clip = sound + note data + **automation** ("real-time or drawn"); built with the classic **TR-REC step sequencer**; clips are captured into **Scenes** and Scenes chain into songs (later fw: scene banks 16×8 via CALL SCENE; Scene Chain article) **[V]**.
- Creative tools: **note repeat, chord designer, step LFO**; per-track MFX + master FX; scale setting per clip (NONE/MAJOR/MINOR) **[V]**.
- **Arpeggio VARIATION values**: 1/4, 1/8, 1/4T, 1/16, 1/8T, 1/32, **1/4x2, 1/8x2, 1/4Tx2, 1/16x2, 1/8Tx2, 1/32x2** — "For the 'x2' variations, the unit plays two notes at each step"; OCTAVE −3…+3; HOLD via pedal; arp works in NOTE/CHORD modes with MOTIF **[V]** (annex 06 already logged MC-707 arp MOTIF/VARIATION/OCTAVE/HOLD — here the x2 semantics are pinned).
- **Scatter**: beat-synchronized performance FX on the pads (insert-destination per pad added in updates; pad-quantize timing setting) **[V]**.
- MC-101: same engine, **4 tracks / 64 clips (16 per track)**, 4 track types (TONE, DRUM, DRUM+COMP, LOOPER), SCATTER mode, arpeggiator + chord designer + **note sub-step** and **note length/tie edit** added by firmware, MOTION punch-in, scene chain **[V]**.

**Fold-in verdict:** ADOPT — clip-as-cell + scene-row performance (SHOULD #12) and the **x2 step-arp variation** (the annex's arp pick-up item: one note value, two notes per step, is the cheapest "instant riff" tool). Scatter → REFERENCE for a later performance-FX page.

### 9. Akai MPC (classic generations) — swing %, note repeat, 16 Levels, Humanize

**Links:** [MPC manual p.92 (swing 50–75%)](https://kitchen.manualsonline.com/manuals/mfg/akai/mpc.html?p=92) · [Akai support: Humanizing your tracks](https://support.akaipro.com/en/support/solutions/articles/69000863026-akai-pro-mpc-series-humanizing-your-tracks) · [MPC5000 Reference Manual (note repeat, 16 Level)](https://cdn.inmusicbrands.com/akai/mpc5000/mpc5000_reference_manual_v2.00_00.pdf_91c05a35d098ada3f17fceae5362d8ba.pdf) · [MPC Software User Guide v2.15 (Time Correct window)](https://cdn.inmusicbrands.com/akai/MPC/MPC%20Software%20-%20User%20Guide%20-%20v2.15.pdf)

**Core contribution:** the origin conventions every groovebox inherits — Time Correct swing, note repeat, 16 Levels, humanize **[V]**.

**KEY FACTS:**
- **Swing: "Values range from 50% to 75%… from subtle to extreme"** — the classic MPC swing scale; Time Correct window hosts grid division + swing; Note Repeat's rate is taken from the Time Correct setting **[V]**.
- **Note Repeat**: hold button + pad → retrigger at TC rate; **latch** via Shift+Note Repeat (or double-press) **[V]**.
- **16 Levels**: last pad copied across all 16 pads with a fixed ascending value — selectable parameter: **Velocity, Tune, Filter, Layer, Attack, or Decay**; Full Level (=127) / Half Level (=63) also exist **[V]**.
- **Humanize**: randomization over time / length / velocity with — Time **Amount (Pulses)** + **Eagerness** (negative = ahead of beat, positive = behind), Length **%**, Velocity **Strength %**, optional "only selected events" **[V]**.

**Fold-in verdict:** ADOPT — humanize (SHOULD) and note-repeat/latch (SHOULD, also annex item #9); record swing convention 50–75 as the *MPC dialect* of our single swing law.

### 10. Akai MPC 2.11 — per-note probability & ratchet

**Links:** [MPC 2.11 Desktop Software & Firmware Update PDF](https://cdn.inmusicbrands.com/akai/M211PCVI/MPC%202.11%20Desktop%20Software%20and%20Firmware%20Update.pdf)

**Core contribution:** probability and ratchet as **per-note properties in a DAW-like editor** — proof these fields scale from hardware buttons to a mouse UI **[V]**.

**KEY FACTS:**
- **Note Probability**: any note gets a probability; "By default each note is assigned a probability of 100%… adjust the value to set how likely the note is to play"; editable from grid automation lane, list column (probability column), step sequencer, and even via **16 Levels** (pads = probability values); saved in pattern files **[V]**.
- **Note Ratchet**: "divide the selected note into four equal parts choose a value of four" — a count that subdivides the note evenly; shown as dotted sub-division lines; editable in grid + step sequencer + list; saved **[V]**.

**Fold-in verdict:** ADOPT — exact mapping for our `prob` and `ratchet.count` fields; UI: probability as an automation-style lane/dropdown, ratchet as "divide into N equal parts".

### 11. Polyend Play / Play+ — grid step model, Chance/Action, fills, randomization, Repeat

**Links:** [Polyend Play manual (polyend.com)](https://polyend.com/manuals/play/) · [Play+ manual PDF](https://polyend.com/wp-content/uploads/2023/11/Polyend-Play-Manual-Rev2.1.pdf) · [easymanua Play+ p.44 Swing](https://www.easymanua.ls/polyend/playplus/manual?p=44) · [p.54 Tempo/Track Swing](https://www.easymanua.ls/polyend/playplus/manual?p=54) · [p.64 Repeat Type/Grid](https://www.easymanua.ls/polyend/playplus/manual?p=64) · [p.65 Chance/Action](https://www.easymanua.ls/polyend/playplus/manual?p=65)

**Core contribution:** the most systematically "algorithmic" step sequencer — probability, cycle logic, generators and randomization as first-class per-step parameters **[V]**.

**KEY FACTS:**
- 8×16 pad grid; 16 tracks; **track length 1–64 per track** (independent lengths "make it easy to create polymeters and polyrhythms; a pattern's length is indicated by the longest track"); **per-track speed** divisions (Pause, 1/16, 1/8, **1/6, 1/3, 2/3** for triplet ratios, …, 8/1) **[V]**.
- **Swing per track: 25–75%, default 50; <50 plays steps early, >50 late** (global = select all tracks) **[V]**.
- **Chance / Action** pair: Chance = 10–90% (or Always) that the Action runs; Action = Play Step (default) / Random X (Sample, Note, Octave Up, Microtune, Cutoff, Repeat, Sample Start/End) / **Humanize (randomize micromove)**; **Group with last** links the step's probability to whether the previous conditioned step played; **Play X / Skip Y** cycle conditions ("plays a step on each of N loops before skipping the step for M loops") **[V]**. Non-destructive until saved.
- **Repeat Type / Repeat Grid**: per-step ratcheting with **2–32 hits over 1–8 steps** (e.g. "4 Hits | 1 Step", "32 Hits | 8 Steps") and repeat algorithms — Straight, Fade, Raise, Pong, Arp Up/Down, Tank, Alien, Echo, Glitter, Octaves, Game Over, Down and Up, etc. **[V]**.
- **Fill tool** (generator): Random placement with density 10–100%; **Euclidean** with 1–64 events; **Beat fill**: 128 pre-programmed rhythms across ~11 genres (Acoustic, Breakbeat, D&B, Electro, Exotic, Garage, HipHop, House, IDM, Techno, Trap) populating kick/snare/hat across 1–3 tracks (16 steps only — "add chance actions to create variety"); Kick/Snare/HiHat single-instrument fills; Chords/Bass fills from folders **[V]**.
- **Randomize**: strength % + type; "all selected events get a random value but only within the selected range"; can target MIDI CCs; preview is non-destructive until Save **[V]**. Plus 35 play modes (playhead direction) and per-track variations **[V]**.

**Fold-in verdict:** ADOPT — per-track swing (v1), Chance/Action structure as our SHOULD randomizer, Fill tool + Euclidean fill as SHOULD generators; Repeat Grid gives the ratchet UI ("hits | over steps").

### 12. OXI One — generative modes, matrices, LFOs

**Links:** [OXI ONE manual (juno mirror PDF)](https://imagescdn.juno.co.uk/manual/948545-01U.pdf) · [Manualslib: Stochastic p.72](https://www.manualslib.com/manual/3649364/Oxi-Instruments-One.html?page=72) · [OXI forum — Stochastic sequencing explainer](https://oxiinstruments.com/forum/d/199-stochastic-sequencing) · [OXI ONE MkII manual PDF](https://soundium.lt/cdn/shop/files/OXI_ONE_MKII_User_Manual_EN.pdf)

**Core contribution:** a sequencer where randomness is *parameterized* (not a dice button) and lanes run at decoupled lengths/speeds — the template for a future generative lane **[V]**.

**KEY FACTS:**
- Sequencer modes: **Mono, Poly, Chord, Multitrack, Stochastic, Matriceal** (8 independent sequencers; 16 patterns each / 64 per project) **[V]**.
- **Stochastic mode**: the grid parametrizes an invisible evolving pattern — per-note probability columns; octave range; time division; **pitch % and rhythm % randomisation** (0% = freeze/lock the current sequence; the same mechanic as Marbles 'deja vu'); a Rand-Perform trig % acts as a **density offset** over all probability columns **[V]**.
- **Matriceal mode**: "4 tracks in one single sequencer"; per-track parameter pages = **Gate, Note, Interval, Velocity, Octave, Retrigger, Trigger Probability, Glide**; "assigning different lengths and speeds to different parameter lanes can create evolving and complex patterns with very few steps — this is the magic of Matriceal mode" **[V]**.
- **LFOs**: 2 per sequencer, can be clocked (rate up to 16 bars) or free-running (~200 Hz max), with phase; LFO→pitch stays in-scale **[V]**. **Random Perform** tools + Roller + Arranger (4 lanes; songs & clip launch; Master Lane) **[V]**.

**Fold-in verdict:** REFERENCE — post-v1 generative lane; but copy two details now: (a) probability as a *density offset knob* for performance, (b) the per-step parameter list (Gate/Note/Interval/Velocity/Octave/Retrigger/Trigger Probability/Glide) confirms our step schema is industry-standard.

### 13. Synthstrom Deluge — song view, arranger view, performance view

**Links:** [Deluge Official Guidebook 4.1 PDF](https://synthstrom-audible-deluge.s3.us-east-2.amazonaws.com/Deluge-Guidebook-4p1-OLED.pdf) · [synthstrom.com product page](https://synthstrom.com/product/deluge/) · [Deluge community docs — Performance/limits](https://seangoodvibes.github.io/DelugeDocs/documentation/getting-started/device-overview/performance/) · [Community Guide PDF](https://synthstrom-audible-deluge.s3.us-east-2.amazonaws.com/Deluge-Community-Guide-4p0.pdf)

**Core contribution:** the four-view arrangement toolkit (clip → song grid → linear arranger → performance) and an explicit "no track limit, CPU is the limit" stance **[V]**.

**KEY FACTS:**
- Views: **Clip view** (one instrument's sequence), **Song view** ("rows represent clips", sections group clips; community fw doubled sections 12→24), **Arranger view** ("clips chained together in series… from the perspective of one track" — linear, DAW-like), **Performance view** (song-global FX; enter from song view) **[V]**.
- "**Deluge does not enforce firm limits on how many tracks or voices may sound at once**… the ultimate limitation will be CPU loading" (tested ~110 sample voices; ~50–100 loaded sounds before overhead; 64 MB RAM ≈ 2M+ notes) **[V]**.
- Per-row/sound **Euclidean sequencing**; notes can extend off-grid with scroll/zoom ("the programming grid is not limited to the 16×8 pads in focus"); auto-extend recording gives unlimited clip length from a blank clip **[V]**.

**Fold-in verdict:** REFERENCE — the end-state arrangement UX (grid-of-clips view + linear arranger + performance page). The "CPU is the limit, no hard track cap" stance should be our browser law too (we already have audio-worklet headroom discipline).

### 14. Teenage Engineering OP-Z — step components (the conditional-behavior layer)

**Links:** [OP-Z interface overview (24 ticks/step, hierarchy)](https://teenage.engineering/guides/op-z/interface-overview) · [OP-Z quick guide](https://teenage.engineering/guides/op-z/quick-guide) · [OP-Z product page (14 step components)](https://teenage.engineering/products/op-z) · [OP-Z step-components guide page (chart)](https://teenage.engineering/guides/op-z/step-components) · [opzed.com step component list](https://www.opzed.com/news/opz-step-components.html) · [op-forums: advanced step components](https://op-forums.com/t/advanced-ways-to-use-step-components/24199)

**Core contribution:** per-step *behaviors* stacked on one trigger — the reference vocabulary of "what a step can do beyond sounding" **[V]**.

**KEY FACTS — the 14 step components [V]** (each has 0–9 values; stackable per step):
1. **Pulse** — repeat the trigger every N-th pass (count 1–9, 0 = random).
2. **Pulse Hold** — trigger once, hold the note across N passes.
3. **Multiply** — retrigger the step 2–8 times evenly across the step (ratchet).
4. **Velocity** — shift level (−4…+4, 5 = default, 9 = mute, 0 = random).
5. **Ramp Up** / 6. **Ramp Down** — arpeggiate up/down through the detected chord on repeats.
7. **Random** — play a random tone from the same note set each pass.
8. **Portamento (Glide 1–7)** — slide from the previous note.
9. **Sweep** — sweep filter/synth/pan parameters across N steps.
10. **Tonality** — transpose by chord recognition (octave / fifth / semitone options).
11. **Jump** — jump to 2/4, 3/4, 4/4, forward/back, random, or "align to global" (time-signature/order tricks).
12–14. **Sparks** (the conditional layers): **Param Spark** = apply parameter locks only on the N-th pass; **Component Spark** = apply other components only on the N-th pass; **Trigger Spark** = play the trigger only on the N-th pass. ("Similar to conditional trigs on Elektron devices" per the community chart) **[V]**.
- Track structure: 10 projects / 16 patterns / 16 tracks / **16 steps per pattern page**; per-track step count and **step-length multiplier** (0–9; 9 = 16× longer — changes playback speed/resolution); **micro timing at 24 ticks per step** (hold step + ±1 tick per press, purple LED depth); per-track quantize 0–100%; 14 pattern chains/project **[V]**.

**Fold-in verdict:** REFERENCE — most components map onto our `cond` + `ratchet` + `locks` fields at zero extra schema cost (Trigger Spark ≡ A:B probability family; Pulse ≡ cycle conditions). Ship `skip/trigger-on-Nth-pass` in v1; Sweep/Jump/Tonality = SKIP (PF's code layer owns that space).

### 15. Teenage Engineering Pocket Operators (PO-12) — constraint discipline & punch-in FX

**Links:** [PO-12 guide (teenage.engineering)](https://teenage.engineering/guides/po-12) · [PO-12 overview PDF (korn mirror)](https://cdn.korn.eu/documents/product/245535_m.pdf)

**Core contribution:** the fun-constraint template — 16 steps, 16 patterns, punch-in FX, swing, retrig multiplier, chaining; everything one thumb away **[V]**.

**KEY FACTS:**
- Pattern = **16 steps**; 16 patterns/slot set; **chain up to 16 patterns** with repeats ("1,1,1,4 plays pattern 1 three times then moves to 4"; wraps after last) **[V]**.
- **16 punch-in FX**: low sample rate, distortion, bit crush, delay, LPF, LP sweep, HPF, HP sweep, stutter 3, stutter 4(8?), repeat 6, repeat 8, note shuffle, feedback, parameter LFO, vibrato — hold FX + key, hold FX alone to clear **[V]**.
- **Parameter locking**: "hold write while turning knobs to write sound parameter changes over time" **[V]**.
- **Swing**: hold BPM + turn A **[V]**. **Live record** punch-in is quantized to the current swing **[V]**. **Step multiplier**: step + BPM inserts a re-trig, BPM presses cycle ×2 / ×4 / ×8 / ×16 **[V]**.

**Fold-in verdict:** REFERENCE (UX philosophy: ADOPT) — punch-in FX + "nothing is more than a thumb away" should govern the live page; the step-multiplier retrig is another ratchet confirmation.

---

## The math (shared laws)

### 16. THE MATH — swing: convention, ranges, and the delay algorithm

**Links:** [Ethan Hein — swing primer (Roger Linn origin, 57/60/67 values)](https://www.ethanhein.com/wp/2023/i-made-a-new-track-for-teaching-swing/) · [Ronter swing % calculator (formula + ratio table)](https://rontersound.com/audio-tools-for-musicians/swing-percentage-calculator/) · [Penn State — swing percentages](https://sites.psu.edu/erlpassion/2022/02/23/i-got-rhythm/) · [JazzProfessional — swing for beginners (66.7 default, 50–75 usable)](http://www.jazzprofessional.com/technical/swing_for_beginners_1.htm) · ranges: [Novation 20–80](https://userguides.novationmusic.com/hc/en-gb/articles/26207162799506-Mixing-and-performing-on-your-Circuit-Tracks) · [Elektron 50–80](https://files.kraftmusic.com/media/ownersmanual/Elektron_Digitakt_Quick_Guide_v120.pdf) · [Akai 50–75](https://kitchen.manualsonline.com/manuals/mfg/akai/mpc.html?p=92) · [Polyend 25–75](https://www.easymanua.ls/polyend/playplus/manual?p=54)

**THE LAW (Roger Linn convention, adopted by every modern groovebox) [V]:**
- Swing% = length of the **on-beat subdivision** as a fraction of the subdivision pair. **50% = straight.**
- Off-beat lands `S%` into the pair → **delay vs straight = pairLen × (S−50)/100**; ratio = S : (100−S).
- **66.7% ≈ 2:1 = triplet/shuffle feel; 57% = septuplet, 60% = quintuplet, 62.5% = golden ratio; 75% = 3:1 max-classic.**
- Reference points: subtle 52–56 · house/garage 58–62 · hard 66–70 (conservative per annex: 54–58 subtle, 60–66 house).

**16th-note pair table (per two 16ths; pair = 500 ms × 60/BPM):**

| Swing % | 120 BPM pair 250 ms → +delay | 140 BPM pair 214 ms → +delay | on:off ratio |
|---|---|---|---|
| 52 | +5.0 ms | +4.3 ms | 1.08 |
| 54 | +10.0 ms | +8.6 ms | 1.17 |
| 56 | +15.0 ms | +12.9 ms | 1.27 |
| 58 | +20.0 ms | +17.1 ms | 1.38 |
| 60 | +25.0 ms | +21.4 ms | 1.50 |
| 62 | +30.0 ms | +25.7 ms | 1.63 |
| **66.7** | **+41.7 ms** | +35.7 ms | **2.00** |
| 70 | +50.0 ms | +42.9 ms | 2.33 |
| 75 | +62.5 ms | +53.6 ms | 3.00 |

**Machine dialects [V]:** Novation 20–80 (below 50 = off-beats *early*; default 50) · Elektron 50–80 (default equal spacing 50; Digitone II manual shows 51–80 — display quirk) · Akai 50–75 · Polyend 25–75 (below 50 early). Display conventions differ across DAWs (Digital Performer: triplet = 100; FL: 0 = straight) — **we adopt the Linn convention (50 = straight)** because every groovebox agrees on it.
**Implementation laws:** (1) swing shifts only the **even/off-beat** steps of each pair; (2) apply **after quantization**, per pair, at schedule time; (3) one shared function for pattern AND arp, with the annex's **pairing law**: never swing pattern *and* arp on the same track simultaneously (compound feel); (4) per-pattern amount + optional per-track override (Polyend/Circuit).

**Fold-in verdict:** ADOPT — one `swing(stepIndex, S, pairSeconds)` function on the master clock; default 50, performance sweet spot 54–62, UI range 50–80 like Elektron.

### 17. THE MATH — probability & cycle conditions

**Links:** [Digitakt II manual p.48 (conditions)](https://www.easymanua.ls/elektron/digitakt-ii/manual?p=48) · [p.53 (PROB)](https://www.easymanua.ls/elektron/digitakt-ii/manual?p=53) · [Polyend Play manual (chance/action, Play X/Skip Y)](https://polyend.com/manuals/play/) · [Circuit guide (probability)](https://userguides.novationmusic.com/hc/en-gb/articles/26207128061458-Using-Circuit-Tracks-Synths-MIDI-Tracks-and-Drums) · [MPC 2.11 PDF](https://cdn.inmusicbrands.com/akai/M211PCVI/MPC%202.11%20Desktop%20Software%20and%20Firmware%20Update.pdf)

**THE LAW [V]:**
- **Per-step probability**: independent Bernoulli per pass, **re-rolled every pass** (Elektron's exact wording: "The probability outcome is re-evaluated every time a trig is set to play"). Expected hits per pass = Σ pᵢ (e.g. [100,50,50,100,25,100,75,50] → 5.5 of 8 steps per pass on average).
- **A:B ratio conditions** = deterministic cycle math: with pass counter `n` (1-based, per track; period = track length when shorter than pattern), condition is true when **n ≡ A (mod B)** — i.e. fires on the A-th pass of every B. `1ST` ≡ n=1; `LST` ≡ last pass before pattern change (needs chain lookahead); `PRE`/`NEI` = previous/neighbour-track last result (state carry).
- **Evaluation order**: conditions first (fill/first/last/ratio/pre/nei), then the probability roll. A fill-armed pattern + 50% fills = the standard "half the passes get the extra hit" feel.
- **Polyend variants to keep**: *Group with last* (chain one step's probability to the previous conditioned step — "either none or all are played"); *Play X / Skip Y* (equivalent to A:B with a skip count); Chance both percentages (10–90) and algorithms.
- **FILL is a modal boolean, not a condition you compute per step**: one performance flag read by every step that has it set — a whole pattern can sprout a fill with one button.

**Fold-in verdict:** ADOPT — `prob` (int) + `cond` (enum + a,b) + a single `fillActive` runtime flag. Per-pass RNG must be independent (re-seed or draw per pass; never cache a roll across passes).

### 18. THE MATH — ratchets, micro-timing, gate semantics

**Links:** [Digitakt II retrig page (RATE/LEN/VFAD)](https://www.easymanua.ls/elektron/digitakt-ii/manual?p=54) · [Digitakt p.31 retrig menu](https://www.manualslib.com/manual/2166470/Elektron-Digitakt.html?page=31) · [MPC 2.11 (ratchet)](https://cdn.inmusicbrands.com/akai/M211PCVI/MPC%202.11%20Desktop%20Software%20and%20Firmware%20Update.pdf) · [Polyend Repeat Grid](https://www.easymanua.ls/polyend/playplus/manual?p=64) · [OP-Z (multiply, 24 ticks/step)](https://teenage.engineering/guides/op-z/interface-overview)

**THE LAW:**
- **Ratchet = subdivide the step's span into k evenly spaced hits.** Two common encodings: *hits-per-step* (MPC: "divide the note into N equal parts"; Polyend: "4 Hits | 1 Step"; PO: ×2/×4/×8/×16; OP-Z Multiply 2–8) or *rate as note value* (Elektron: 1/16 = one per step — hits/step = (1/16)/(rate): 1/32 → 2, 1/64 → 4, 1/80 → 5, **1/24 → 1.5, 1/12 → 0.75** (the triplet rates); "to trig triplets set rate to 1/12 or 1/24") **[V]**.
- Spacing = `gate × stepDur / k`. A velocity envelope over the ratchet is a first-class control (Elektron VFAD −64…+64; Polyend Fade/Raise repeat types) **[V]**.
- **Micro-timing resolution**: Elektron/OP-Z family = **24 ticks per step**; range ±23 ticks (just under one step) ≈ ±0.96 step; at 120 BPM a tick = 5.21 ms. Circuit = **6 micro steps per step**. MPC humanize = ±N pulses + eagerness sign **[V]**.
- **Gate semantics**: gate/length is stored **in fractions or multiples of a step** (Elektron: "1/16 is the nominal length of one step"; values 0.125–∞; 0 = special full); Circuit: gate = "the number of pattern steps the note should sound for" (1–16). Gate < step = staccato; gate ≥ next note = legato/tie; **slide** (303 law from T0) = gate continues into the next step and pitch glides **[V]**.

**Fold-in verdict:** ADOPT — per-step `ratchet {count|rate, len, curve}`, `micro` in ticks, `gate` as step-fraction with legato detection; defaults: gate 0.5–1.0 for drums, 1.0 for synth plucks, `micro` 0, ratchet off.

### 19. THE MATH — polymeter vs polyrhythm, quantization grids, Euclidean

**Links:** [Polyend Play manual (independent lengths; speed list)](https://polyend.com/manuals/play/) · [Digitakt II per-track mode (length/speed)](https://www.easymanua.ls/elektron/digitakt-ii/manual?p=46) · [MC-707 update (triplet & x2 note values)](https://static.roland.com/assets/media/pdf/MC-707_update_eng08_W.pdf) · [Digitakt II Euclidean mode](https://www.easymanua.ls/elektron/digitakt-ii/manual?p=44) · [OP-Z quantize 0–100%](https://teenage.engineering/guides/op-z/track)

**THE LAW:**
- **Polymeter** = same grid, different loop lengths: tracks of 16 and 12 steps realign every **LCM(16,12) = 48 steps = 3 bars**; the composite pattern is the visible "song" the ear hears. Implementations: per-track length 1–64 (Polyend), 2/16–128/128 (Elektron), master length + CHANGE/RESETS to decide when tracks re-phase **[V]**.
- **Polyrhythm** = different subdivisions simultaneously: speed multipliers — 3/4× puts a track in **triplet time** against the others (Elektron's own example), 2× = 32nd-note base resolution, 3/2×, plus Polyend's 1/6, 1/3, 2/3 ratios for triplet/dotted feels **[V]**.
- **Quantization grids include triplets as note values**, not as swing: 1/4T, 1/8T, 1/16T, 1/32 (MC-707 arp VARIATION list = canonical menu; Elektron retrig triplets via 1/12, 1/24) **[V]**. Triplet grid = 3 pulses/beat; swing = 2 pulses/beat tilted 2:1 — never conflate. Order of operations: quantize → swing.
- **Quantize strength**: OP-Z per-track 0–100%; Elektron real-time quantize menu (amount); MPC Time Correct + Humanize for the deliberate *un*-quantize **[V]**.
- **Euclidean**: two pulse generators + boolean combine/subtract + rotation (Digitakt II); fill generator with 1–64 events (Polyend); per-row euclidean (Deluge) — a pattern *seeding* tool, orthogonal to step data **[V]**.

**Fold-in verdict:** ADOPT — per-track length + speed multipliers (MUST), triplet grids in the note-value menu (MUST), quantize amount (MUST); Euclidean generator = SHOULD.

### 20. WEB-TOOLS SCAN — browser grooveboxes & step sequencers, and the gap

**Links:** [Audiotool (browser DAW)](https://www.audiotool.com/) · [Audiotool ToneMatrix device page (step grid + "303-inspired" bass device with accent/slide/groove)](https://www.audiotool.com/devices/tonematrix) · [GridSound](https://gridsound.com/) · [Hackaday on GridSound](https://hackaday.com/2020/08/17/gridsound-an-audio-workstation-in-your-browser/) · [grid-groove (Tone.js step seq, community project)](https://github.com/r3mot/grid-groove) · [Chrome Music Lab Song Maker](https://musiclab.chromeexperiments.com/Song-Maker) · [Suno acquires WavTool](https://suno.com/blog/suno-acquires-wavtool) · [What happened to WavTool](https://riff.garden/blog/what-happened-to-wavtool) · T0 refs: dittytoy (code-first), tb303.com, roland50.studio

**Core contribution:** an honest map of what already exists in the browser, and the shape of the empty lane **[V]**.

**WHAT EXISTS (four buckets) [V]:**
1. **Browser DAWs** — Audiotool (free, no track/time limits, modular routing, VST3 bridge, multiplayer; includes ToneMatrix — a 16×16 visual step sequencer — and a "monophonic bass synthesizer inspired by the 303" with accent/slide/groove); GridSound (open-source, pure vanilla JS, piano roll + drumkit + synth; cluttered, laggy on weak hardware per Hackaday); BandLab / Soundtrap (freemium), Suno Studio (Premier tier editor for AI-generated songs — where WavTool's technology went after Suno acquired it in 2025).
2. **Educational / toy grids** — Chrome Music Lab Song Maker (shareable link, ~2 bars, no pro semantics).
3. **Single-device emulations** — tb303.com, Roland50.studio, iO-808-class clones; code-first platforms (dittytoy hosts the best browser 303s — see T0, CC BY-NC-SA, clean-room only).
4. **Tone.js demo-grade step sequencers** — e.g. grid-groove (~8 stars) — a grid, transport, no pattern model beyond the grid.
- **WavTool** (the most ambitious browser-first DAW, GPT-4 "Conductor", stem separation) went offline; team and tech absorbed by Suno — evidence that the browser-DAW lane is contested but the *groovebox* lane is empty.

**THE GAP (state it):** no mainstream browser instrument ships **modern groovebox sequencing semantics as the product** — probability, cycle conditions, ratchets, per-track lengths/speeds, swing laws, pattern chains and scene performance. Browser tools are either (a) DAWs whose sequencing is a piano-roll afterthought, (b) educational toys, or (c) one-device emulations that stop at "16 steps + a replica sound". Anvil's differentiator = *groovebox-first in the browser*: a real synth engine whose primary surface IS the step machine, with the semantics in §16–19 and Pattern Forge's code-side as the second lane.

**Fold-in verdict:** ADOPT (positioning) — the gap is real and citable; REFERENCE the four tools for UX teardown later (Audiotool's ToneMatrix for visual step feedback; GridSound for open-source engine-scope sanity check).

---

## Dead ends / unverified (logged)

- **Elektron Model:Cycles "CHANCE"-style knob** — searched twice (queries around "chance parameter probability"), zero results; **not claimed anywhere in this file**. Model:Cycles facts used are only the verified spec-page items (see entry 5).
- **MPC "Time Correct" note-division list** (1/16T etc.) — one search returned no results; Time Correct/swing/Note Repeat behaviors captured from other pages, but the full division enumeration is unverified. Do not treat an MPC triplet-division list as sourced here.
- **teenage.engineering/guides/op-z/step-components direct fetch** — blocked once by a backend rate limit (HTTP 429); the chart was sourced via search-index snippets + opzed.com + the OP-Z cheat sheet instead (1 direct attempt made, snippets used per the ≤3-attempts rule).
- **elektron.se/support-downloads/modelcycles** — page loads no static PDF links (JS-rendered); Model:Cycles PDF never fetched; product page used instead.
- **Digitone II swing "51–80%"** vs Digitakt "50–80%" — vendor text inconsistency; recorded as a display quirk, not adopted.
- WavTool is **offline** (acquired by Suno) — cannot be dogfooded; logged instead.

---

## DELIVERABLE A — MUST / SHOULD / LATER shortlist (20 features, ranked for v1)

| # | Tier | Feature | Exact behavior to ship | Reference (entry) |
|---|------|---------|------------------------|-------------------|
| 1 | **MUST** | Step model | Per-step fields: note, velocity, gate, accent, slide, probability, condition, ratchet, micro-shift, sparse param locks — the object in Deliverable B | §1, §6, §10 |
| 2 | **MUST** | Rhythm-first step UX | Grid entry (tap step → set fields, TR-REC style) + live record quantized to swing + per-page copy/paste | §8, §6, §15 |
| 3 | **MUST** | Per-step probability | 0–100% (default 100), re-rolled every pass, per-step lockable; UI ladder 12.5/25/…/100 for pads | §2, §6, §10, §17 |
| 4 | **MUST** | Conditional rules | fill / ¬fill, 1st / ¬1st, last / ¬last, A:B ratios; PRE/NEI as v1.1 | §2, §17 |
| 5 | **MUST** | Fill switch | one performance boolean; momentary hold + one-cycle arm + latch (LED states) | §2 |
| 6 | **MUST** | Micro-timing | Per-step nudge in ticks (24/step resolution, ±23 max ≈ just under a step), stored per pattern; global quantize-amount knob | §3, §18 |
| 7 | **MUST** | Ratchet / retrig | count 2–8 or rate enum (incl. triplet 1/12/1/24), velocity fade curve, length in step-fractions | §1, §10, §11, §18 |
| 8 | **MUST** | Swing law | One function `delay = pair × (S−50)/100`; default 50, range 50–80, per-pattern + per-track override; sweet spots 54–62; **never swing arp + pattern together** | §16 + annex 06 |
| 9 | **MUST** | Per-track length + speed | length 1–64/128 steps (polymeter), speed multipliers incl. 3/4× triplet & 2× 32nd-base (polyrhythm) | §4, §11, §19 |
| 10 | **MUST** | Quantize grids + amount | note-value menu incl. triplets (1/8T, 1/16T, 1/32) and x2 feels; quantize amount 0–100% applied before swing | §8, §19 |
| 11 | **MUST** | Arrangement v0 | per-track pattern chains (longest chain = sequence) + song rows {pattern, repeats, mute snapshot, optional tempo} | §4, §7, Deliverable C |
| 12 | **SHOULD** | Scenes / performance page | 16 scene slots = {pattern per track + mute states}, queued switching (end-of-pattern), chainable into a sequence | §6, §8 |
| 13 | **SHOULD** | Mutate / variation generator | shuffle steps' assignment in place; reassign all step data (micro/gate/prob/automation), keep hit count & sounds | §6, §7 |
| 14 | **SHOULD** | Euclidean generator | per track: 1–2 pulses + rotation + boolean combine/subtract; convert to real steps | §4, §11, §19 |
| 15 | **SHOULD** | Fill tools | density-random fill (10–100%) + 16-step beat fill from kit (kick/snare/hat) + euclidean fill | §11 |
| 16 | **SHOULD** | Humanize | time amount (ticks) + eagerness ±, length %, velocity %; optional selected-steps only | §9 |
| 17 | **SHOULD** | Note repeat / live retrig | hold-to-roll at grid rate, latch mode, gate scaling — the live drum-roll tool (pairs with annex #9) | §9, §15 |
| 18 | **LATER** | Chance/Action randomizer | probability × action pair (humanize / random octave / random note / skip), non-destructive preview + commit | §11 |
| 19 | **LATER** | Generative/stochastic lane | parameterized randomness: per-note probabilities + density offset knob + pitch/rhythm randomization with lock; decoupled-length lanes (Matriceal-inspired) | §12 |
| 20 | **LATER** | Linear arranger + performance FX | Deluge-style linear per-track arrangement view over chains; scatter/punch-in FX page (MC/PO lineage) | §13, §8, §15 |

## DELIVERABLE B — suggested pattern-object model

Drawing directly from Digitakt (fields, conditions, retrig), Circuit (per-step data + micro steps), 303 (slide/accent), Play (chance/action, micromove), OXI (step parameter list), MPC (probability/ratchet):

```jsonc
Pattern {
  id, name,
  bpm:        null | number      // null = inherit project
  swing:      50..80             // Linn convention; default 50 (per-pattern; §16)
  length:     number             // steps, 16/32/64/128; grid div default 1/16
  scale:      { root: 0..11, mode: "major|minor|…" } | null   // scale lock (§6/§8)
  tracks:     Track[]
}

Track {
  id, name,
  voice:      PresetRef | "midi:<ch>",
  length:     1..128  | null     // null = pattern length   (polymeter, §19)
  speed:      "1/8x|1/4x|1/2x|3/4x|1x|3/2x|2x" | null  // polyrhythm incl. triplet 3/4x (§4)
  swing:      null | 20..80      // per-track override (Circuit/Polyend) (§6/§11)
  steps:      Step[]             // sparse: absent = off; only non-defaults serialized
  automation: { [paramId]: Curve }   // per-step/drawn automation (Circuit/Roland MOTION) (§6/§8)
}

Step {
  on:        true,
  note:      0..127 | { degree, octave },   // degree form when scale-locked
  vel:       1..127        = 100,
  gate:      number        = 1.0,   // in steps; 1.0 = one step; <1 staccato; >1 tie/legato (§18)
  accent:    false,                 // 303 accent: fenv boost + Q reduction (T0)
  slide:     false,                 // glide into next note; gate extends over slide steps (303 law)
  prob:      0..100        = 100,   // re-rolled every pass (§17)
  cond:      { type: "none|fill|notFill|first|notFirst|last|notLast|ratio|notRatio|pre|nei",
               a: 1..8, b: 1..8 },  // a:b used by "ratio" (§2/§17)
  ratchet:   { count: 2|3|4|5|6|8 | rate: noteDiv, len: stepFrac, curve: -64..64 } | null,  // (§18)
  micro:     -24..+23,              // ticks of 24 per step; render ±0.96 step max (§3/§18)
  locks:     { [paramId]: value }   // sparse parameter locks, applied at trig time (§1)
}
```

**Runtime laws (pseudocode):**
```
for each pass n (1-based, per track):
  for each step with on:
    cond_true = eval(cond, n, fillActive, prevCondResult, neighborCondResult)   # conditions FIRST
    if not cond_true: continue
    if prob < 100 and rng()*100 >= prob: continue                                # Bernoulli, fresh each pass
    t = stepStart(n, i) + micro * tickSeconds + swingOffset(i)                   # swing AFTER grid (§16)
    k = ratchet ? ratchet.count : 1;  span = gate * stepSeconds
    for j in 0..k-1: schedule(hit(t + j*span/k), vel * curve(j/(k-1)))
    noteOff at t + gate*stepSeconds  unless slide → glide into next trig        # (§18, T0)
```
Serialization notes: sparse + JSON-safe; per-step defaults omitted; `cond`/`prob` need only a pass counter and one boolean to evaluate — cheap in the audio-worklet scheduler alongside the annex's 0.12 s lookahead loop. Fill law: one `fillActive` flag; FILL conditions read it (momentary/cycle/latch drivers, §2).

## DELIVERABLE C — arrangement model options (pick one shape, design for the others)

- **Option 1 — Pattern chain (v1, ship first).** Per-track ordered list of pattern refs, launch quantized to the end of the current pattern; longest chain = sequence length (Circuit Rhythm's exact law) **[§7]**. Cheapest, and it *is* the live-performance model. Data: `chain[tracks][i] = patternRef`.
- **Option 2 — Song rows (v1/v1.1, composition model).** Global list of rows `{patternRef, repeats, muteSnapshot[track], lengthOverride?, tempo?}` + labels (Intro/Verse/Chorus/Fill) — Elektron Digitakt II song mode verbatim (99 rows, per-row mute/tempo, swing per row) **[§4]**. Best for "build the track" mode; renders as a table; exports cleanly to MIDI/DAW later.
- **Option 3 — Scene matrix (SHOULD, performance model).** 16 scenes of {pattern per track + mutes}, triggered by pads, queued, chainable into sequences (Circuit Scenes→Sequence; MC clip→Scene→Scene Chain; Deluge song sections) **[§6/§8]** — this *is* the annex's "Performance scene recall" item, upgraded to a first-class surface.
- **Launch-quantization law (needed by all three)**: choose per trigger — instant (OP-Z: pattern switches instantly, maintaining step position) · beat/end-of-cycle (Digitakt CHANGE/RESETS) · end-of-pattern (Circuit project/pattern queue) **[§4/§6/§14]**. Default: end-of-pattern for chains, beat for mutes/scenes.
- **Recommendation**: v1 = Option 1 + mute snapshots (live-usable on day one); the row shape from Option 2 as the stored data structure; Option 3's scene pads as a SHOULD UX (16 pads × pattern+mute) once the step engine is stable; Deluge-style split (grid of clips view + linear arranger view) remains the *end-state* inspiration, not v1 scope.

---

*End of T3. 20 entries · 6 dead ends logged · 4 math laws · 20-feature shortlist · 1 pattern model · 3 arrangement options.*
