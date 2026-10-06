# 07 — Creative build ideas (owner request 2026-10-07, pre-sleep "think hard")

Status: candid ideas for the GOLDEN BUILD (docs/05 §2.7). Each is tagged [easy] / [moderate] /
[stretch] and slotted to a wave. Clinical top-picks marked ★. Nothing here re-opens locked scope —
it extends it; fold into wave contracts as capacity allows.

## A. Jam & capture (the "never lose a good take" layer)
1. ★ Rolling capture [moderate] — audio (off the master tap) + MIDI recorded continuously in a ring
   (~90 s); one button saves the last stretch. (Ableton-style capture, but for both audio and notes.)
2. Jam-to-pattern [moderate] — captured MIDI quantizes into a sequencer pattern in one press; saved
   audio becomes a loaded sample in the sampler.
3. One-press song sketch [moderate] — auto-arrange the current groove into a 32-bar sketch
   (intro/build/main/break) so a jam becomes a demo instantly.

## B. DAW bridge (stems ask, elevated)
4. ★ STEM EXPORT SUITE [moderate] — per-part WAV stems (FX printed) + master reference + preview
   OGG/MP3 + a .mid per part + README (BPM/key/scale), zipped and DAW-ready
   (`anvil_128bpm_Fmin_stems/` naming). The "one press" for Ableton/FL.
5. ★ MIDI import/export [easy] — drop a .mid to get a pattern; export patterns/tracks as .mid.
6. Open in Pattern Forge [easy] — export a pattern as Strudel code into PF's codegen (family
   handshake); import PF snippets back. Two-way door between the apps.
7. Send to Resonance [easy] — bounce a loop and drop it into the Resonance library for listening.

## C. Synth & sound (outlandish permitted)
8. ★ ACID MODE [moderate] — a first-class 303 workflow view: two-pass write model, accent/slide
   semantics, EXPANDED mods panel; its own skin of the sequencer lane.
9. ★ XY morph pad [moderate] — blend two patches (or 4 macro snapshots) with a hand-drawn XY;
   "crossfader" between sounds — performance + sound design in one.
10. Taste-weighted randomizer [easy] — one-press patch generator with section locks and
    genre weighting (acid / techno / ambient) — always musical, never noise.
11. MULTI MODE zones [moderate] — multitimbral stack/split across the keybed (drums + strings +
    synth in zones) — the true "seamless drum<->synth" answer.
12. Vocoder + audio-in [stretch] — run mic/line through the FX rack (filter-bank vocoder first).
    Anvil as an effects processor for his mic rig.
13. Theremin + gesture toys [easy] — XY pitch/volume with glide/freeze; humanizer for recording.
14. 32 pads, MPC-grade [moderate] — banks A-D, note-repeat rates, flam/roll, velocity zones; pads
    and keys share the one note bus.

## D. Display & pro feel (the deck)
15. Deck displays [moderate] — oscilloscope, spectrum, spectrogram waterfall, LUFS/true-peak
    meters, voice/CPU governor readout, MIDI monitor — all on the professional deck panel.
16. Patch-bay rear view [stretch] — Reason-style back panel showing the FX routing as cables.
17. Adaptive voice governor [easy] — auto-manage polyphony under load, drop-from-oldest, never
    glitch; visible voice-budget number.

## E. Content, help & community
18. Patch cards [easy] — share a patch as a PNG card with QR to the URL-encoded patch
    (social-shareable, generated offline).
19. Store synergy [planned P5] — SynthHub listing + drum packs + loop packs (loops = patterns,
    exportable as files).
20. Tutorial ladder + demo song [easy] — first-run demo groove (first sound <30 s, hits the
    acceptance criterion) + guided lessons: first beat / acid line / sample chop / stems export.

## F. Easter eggs (small, outlandish)
21. Hidden theme variants ("TEAL OVERLOAD"); a self-oscillation smiley; a 7x7 unison "beast mode";
    a MODDY boot wordmark with the box's lightning nod.

## Clinical top picks (value per effort, in build order)
1) Rolling capture + jam-to-pattern (signature feel)  2) Stem suite + MIDI I/O (his ask, DAW glue)
3) ACID MODE (the emotional core)  4) XY morph + taste-weighted randomizer (endless usable patches)
5) MULTI zones (seamless drum<->synth)  6) Deck displays (pro readouts)  7) Demo song + lessons.


## H. Batch 3 (final round — performance, pedagogy, ecosystem, utility)

41. Controller template library [easy] — built-in maps for common surfaces (KeyLab / Launchkey / APC
    etc.); plug a controller in, pick its template, everything is assigned.
42. MIDI-FX rack [moderate] — reorderable pre-voice MIDI processors: strum/chord-spread, humanize,
    note-gate, in-key harmonizer, probability, velocity curves. "Many modules" answered twice.
43. Scratch deck [moderate] — a turntable/platter emulation for scrubbing samples with realistic
    jog physics (velocity, slip/release). Outlandish fun.
44. Vocal harmonizer/tuner [stretch] — audio-in, key-aware real-time harmonization for vocal takes.
45. Sound wizards [easy] — guided patch builders ("bass / pad / pluck / lead" via a few choices) —
    the walkthrough system's productive half.
46. Starter templates [easy] — boot presets: beat starter / bass starter / full-band starter (a
    jam-ready layout out of the box).
47. Scene morphing [moderate] — interpolated transitions between scenes over N bars (performance gold).
48. Looper-style layering [moderate] — loop-record + overdub passes with per-layer undo (pedal looper
    workflow inside the sequencer).
49. Auto-mix assistant [moderate] — one press "balance the mix": LUFS analysis across parts -> sane
    fader/level defaults.
50. MIDI clock IN [moderate] — slave Anvil to external clock (hardware/DAW as master).
51. Patch diff view [easy] — parameter deltas between two patches (learning + collab tool).
52. Backup/restore everything [easy] — one-click full backup zip (packs, patches, sequences, samples).
53. Factory demo songs [moderate] — 3-4 shipped shorts (showcase + learning material).
54. Odd-meter grooves [easy] — 7/8, 5/4 techno presets + prominent time-signature controls.
55. Ideas shelf [easy] — recent auditions/randomizations collect as draggable clips you can pull into
    scenes (captured ideation).
56. Artist/video mode [easy] — big visuals + on-screen key/note display for recording tutorials.
57. Finger-drumming trainer [easy] — pad timing accuracy feedback (small game, big practice value).
58. Take naming [easy] — producer-style auto-naming for exports/renders (anvil_teal_tuesday_v3 vibes).
59. "Foundry check" boot animation [easy] — retro power-on self-test easter egg + scale-highlight pads
    on the dock.

Batch-3 top picks: 41 (controller templates), 42 (MIDI-FX rack), 43 (scratch deck), 45-46 (wizards +
starters), 47-48 (scene morph + looper layering).

## I. Batch 4 (2026-10-07 — owner ask: "finalize to feature-rich outstanding": engine depth, platform, accessibility)

60. ★ FM engine [moderate] — the scouted Dexed msfa core (Apache-2.0, G1) as a first-class voice
    engine: 4–6 operators, matrix + DX-style envelopes. [P3]
61. ★ MPE + per-note expression [moderate] — Web MIDI MPE zones; per-note bend/slide/aftertouch/
    pan; expressive recording into patterns. Reserve engine hooks in the P2 contract. [P2→P3]
62. Microtuning studio [moderate] — Scala .scl/.kbm import, per-part tuning, MTS-ESP live (SysEx),
    equal↔just TUNE morph (the Overtonium idea, clean-room). [P3/P7]
63. Analog-behaviour pass [moderate] — per-voice pitch/level drift, free-running oscillators,
    tolerance modelling; seeded (determinism tests keep holding); per-patch opt-in. [P3]
64. ★ Elastic audio [stretch] — WSOLA/phase-vocoder worklet: loops follow project tempo, key-lock,
    sample time-stretch. [P3]
65. Sample chop mode [moderate] — transient detect → pad map → slice-to-steps; trim/fade/normalise
    editor (own engine, not a lib drop-in). [P2/P3]
66. Wavetable editor [moderate] — draw/import 2048-frame tables, spectral tools, morph frames; user
    table library rides packs. [P3]
67. Convolution IR module [easy-moderate] — own CC0 IR set (plates/rooms/springs/cabs) + user IR
    import; true-stereo; rides the FX rack. [P3]
68. ★ Airwindows-style FX bank [moderate] — curate the MIT goldmine (G1) into bus tools (console/
    tape/drive flavours); the attribution registry keeps the licence trail. [P3]
69. Sends + sidechain [moderate] — per-part send rails (reverb/delay), sidechain duck input
    (kick→pads), bus glue compressor. [P3/P4]
70. Master chain [easy-moderate] — tape/console glue, limiter, LUFS-normalised render targets,
    export dither (the export-quality end of #49). [P3→P7]

71. ★ P-lock automation lanes [moderate] — per-step parameter locks + curved interpolation lanes;
    copy/clear/morph. [P4]
72. Generative toolkit [moderate] — euclidean, polyrhythm ratios, ratchets, per-track clock divide/
    swing (companion to #42). [P4]
73. ★ Song arranger [moderate] — chains → drag-arrange timeline, section repeats, quantised scene
    transitions, arrangement export. [P4/P6]
74. Live mode [stretch] — clip/scene launch grid, quantised start, follow actions, setlist. [P4]
75. ★ Undo/redo + A/B compare [moderate] — bounded history across editor+sequencer; snapshot
    compare folds #51 into a system; land it EARLY (editor wave), not last. [P4]

76. Autosave + crash recovery [easy-moderate] — IDB session snapshots, versioned restore points,
    "recovered session" flow (#52 stays the export path). [P4/P6]
77. ★ File System Access I/O [moderate] — real open/save of .anvl projects + direct sample import
    from disk; download fallback. [P5]
78. PWA + offline [easy-moderate] — install, service-worker cache, full offline use; the local-
    first spine made literal. [P6]
79. ★ Accessibility pass [moderate] — keyboard-complete operation, screen-reader roles/labels,
    high-contrast + reduced-motion variants; tested in the battery. [P7]
80. Command palette + shortcut map [easy] — Ctrl-K palette; contextual "what is this knob?" help
    overlays (the tooling half of #20). [P6]

81. ★ Open module API [moderate-stretch] — the CODE section's engine: a documented sandboxed DSP
    module contract (FX/source) that user code runs under; versioned loader; store lists user
    modules. [P5/P6]
82. Suite bridges round 2 [easy] — send loop → webmusic-hub library; world-radio "now playing"
    cross-link; Resonance pack import (reverse of #7). [P6]
83. Video/share capture [easy-moderate] — WebM clip export with the #56 visuals + rendered audio,
    for socials and tutorials. [P6/P7]

Program notes (process, not features):
- P·1 Standing perf gate: every wave freeze runs bench (offline knee) + a stress pass; deltas go in
  the addendum. Motivated by the P1.x close-out: minBLEP ≈ +20 % steady cost, heavier under unison.
- P·2 minBLEP cost-optimisation pass — slot after the P2 planning pass; target: restore stress
  headroom while the alias gates stay green.
- P·3 MIT/Apache adoption registry — licence + attribution file grows as FM/FX modules land
  (Dexed msfa, Airwindows, Mutable per-file MIT).

Batch-4 top picks: 60 FM · 61 MPE · 64 elastic audio · 68 Airwindows bank · 71 p-locks ·
73 arranger · 75 undo/redo · 77 File System Access · 79 accessibility · 81 open module API.
