# 08 — Studio mandate: all-in-one station + competitor answers + maximum packs & integrations

Owner directive (2026-10-07, ~05:15, verbatim intent): think **all-in-one recording studio station**;
match competitors' features and then remove their reason to use them ("destroying" their perceived
moat); a producer/creator friend should **have no option but to use this build**; ship **as many
store packs and integrations AS POSSIBLE**. Extends docs/05 §2.7 (golden build) — no locked scope
is re-opened; waves stay battery-gated.

## 1. The station (recording studio, all-in-one)

One page, no install: SOUND (engines) + SEQUENCE (groovebox) + STUDIO (recording). The studio half,
in waves:

- **S1 · RECORD CORE [P4]** — multitrack: audio tracks (mic/line via the audio-in path; the master
  tap for internals; latency-compensated) + pattern/MIDI tracks on one timeline; count-in,
  metronome (audio + visual), loop-region recording, punch in/out, per-lap takes. Monitoring runs
  through the FX chain (vocals: gate→EQ→comp→tune/harmonizer→verb/delay — #12/#44 material).
- **S2 · TAKES & SESSIONS [P4→P5]** — take lanes, keep-last-N, pick-best comping (lite), trims +
  crossfades; sessions persist (autosave + versions + recovery #76; backup #52).
- **S3 · MIX & MASTER [P5]** — per-track FX + send rails (#69), bus glue, master chain (#70),
  auto-mix (#49) with LUFS/true-peak targets, A/B reference, export dither.
- **S4 · DELIVER [P5→P6]** — mixdown (WAV 16/24/32f), one-press stems (#4), .mid per part, video
  capture (#83), share card (#18), direct-to-disk save (FSA #77).

Acceptance for the station: a full song — record vocals over a groove, comp a take, mix, master,
deliver stems — without leaving the page; battery gains a scripted record→mix→export run.

## 2. Competitor answers (match, then remove the reason to use them)

Their reason to pay/install → Anvil's answer → wave:

1. **Splice / Loopcloud / Noiiz** (subscription libraries) → free max-pack store; loops are
   *editable patterns*, not audio-only; import from disk; offline. [P5]
2. **Output Arcade** (playable loop kits) → drum↔synth + 32 pads + chop mode (#65); kits =
   patterns + samples, fully editable. [P2/P5]
3. **Serum / Vital / Phase Plant** (wavetable synth + editor, paid) → WT engine + wavetable editor
   (#66) + import + table packs; free, no install. [P3]
4. **Scaler / Captain Chords** (chord engines) → MIDI-FX rack (#42) + generative toolkit (#72) +
   chord/MIDI packs. [P4]
5. **BandLab / Soundtrap / Audiotool** (browser studio/collab) → STUDIO station S1–S4; no account,
   offline, pro-grade sound design inside. [P4–P6]
6. **Ableton / FL Studio** (desktop DAW depth) → not replaced — be the fastest idea→DAW feeder:
   jam → pattern → stems + .mid, BPM/key-named, DAW-ready. [P4–P6]
7. **MPC / Elektron** (pads + standalone) → 32 MPC pads (#14) + ACID MODE (#8) + PWA offline; the
   standalone that is always with you. [P2/P4/P6]
8. **Roland / Korg cloud** (legacy machines) → clean-room behaviour targets (303 core, string/
   ensemble family, drum machines); own art/names. [P2+]
9. **Koala / mobile apps** (instant fun) → PWA + touch + rolling capture (#1) + starters (#46). [P6/P7]
10. **Mastering services (LANDR etc.)** → master chain (#70) + auto-mix (#49); local, free, no upload. [P5]
11. **DJ/loop tools** (key/BPM metadata) → deck readouts (#15), harmonic/key display, take naming
    (#58), elastic loops (#64). [P3–P5]
12. **Sample-instrument libraries** (Kontakt/UVI) → factory sampled instruments + chop (#65);
    autosampler = stretch candidate (verify scope before promising). [P3+]

Deliberately not chased (honest): VST/AU plugin hosting; full comping depth; realtime cloud collab
in v1; a hardware OS.

## 3. Maximum store & packs ("as many as possible")

- **Launch targets** (direction; generators make it feasible): ≥30 factory packs · ≥1,500 presets
  (curated + taste-weighted generated, #10) · ≥250 loops · ≥30 drum kits · ≥120 wavetables ·
  ≥100 MIDI/chord packs · ≥30 IRs · ≥60 FX chains · ≥12 demo songs · starters (#46).
- **Method**: STARTER method + pack generators + curation; community uploads (CC0 rule) after
  launch; add-on modules ride the open module API (#81).
- **Gate**: a pack-verifier suite — every pack installs, loads, plays and passes style checks in
  the battery; store pages list licence + provenance.
- **Infra**: categories/search/tags/previews, one-press install (IDB), user pack export/import
  (.anvlpack), update channel; SynthHub + moddys.net synergy (#19).

## 4. Integrations (as many as possible)

- **Suite**: Pattern Forge (#6) · Resonance (#7/#82) · webmusic-hub · world-radio · SynthHub ·
  moddys.net (deploy + downloads). Optional: Laya voice bridge (stretch).
- **Hardware/protocols**: Web MIDI in/out (landed) · controller templates (#41) · MPE (#61) ·
  MTS-ESP (#62) · MIDI clock in/out · CC learn (landed).
- **Files/DAW**: WAV/stems/OGG/MIDI · .anvl projects (FSA #77) · .anvlpack · backup zip (#52) ·
  drag-drop import (wav/mid/scl/zip).
- **Web/OS**: PWA install (#78) · Web Share + QR patch cards (#18) · video capture (#83) · File
  Handling (open .anvl with the app).
- **Community/code**: open module API (#81) · store uploads · patch permalinks · tutorial ladder (#20).
- **AI (opt-in, local-only)**: local-assist (own Ollama stack) for patch ideas / pattern variations
  — stretch, privacy-first, never required.

## 5. Slots & acceptance

S1–S4 fold into P4–P6; max-pack work rides P5; integrations spread across P3–P7. Every wave stays
battery-gated (lab → battery → frozen bytes); the finish line is unchanged: deploy + live verify +
owner's real-surface pass. Wave contracts pick items up as capacity allows.

(Item numbers #n refer to docs/07 — batches 1–4.)
