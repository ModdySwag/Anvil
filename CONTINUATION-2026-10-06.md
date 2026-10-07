# Anvil — CONTINUATION (2026-10-06)

Project home: C:\Users\Moddy\anvil (renamed from forge-synth; if an empty `forge-synth`
folder still lingers it is a file-handle artifact — delete it whenever Windows lets you).

## Status: Phase 0 started — scaffold + build pipeline + shell DONE
- Plan package complete & owner-decided (docs/00–05). Decisions: **name Anvil · free ·
  granular+sampler in v1 · phase order locked** (03 §6 revised for grain/sampler).
- Build tree live: `build.py` (explicit js_parts order · `</script` guard · strict
  `node --check` parser guard · sha identity), `src/{head.html,styles.css,body.html,app_core.js}`,
  `verify/`, `harvest/`, `renders/`.
- **index.html built: sha256 2fc8e71862d20361add6f43500cc722618029217e3f8ff8bc2cfe9f7e47828e0** (shell)
- First-light screenshot: `renders/p0-shell.png` (Edge headless, 1440×900).
- Git repo initialized (main); commits: P0 scaffold + P0 build/shell.

## Done since first pass
- **Master tap PORTED** → `src/av_tap.js` (destination-getter install; KEYS bus → MASTER gain → speakers;
avKeysFor/avMasterNodes/avMasterApply/avKeysApply + meter attach; offline renders excluded from live registry).
- **index.html rebuilt: 15,291 bytes · sha256 8ec7f726ccd417d77ec8be7ebfbd85638e4ed3b246911f632d00286d57d557f9**
- Runtime proof: open `index.html?avtest=1` → TAP SELFTEST line shows viaTap/keysBus/masterNode true (headless Edge screenshot `renders/p0-tap.png`).

## Next (Phase 0 remainder)
1. ~~Master tap port~~ **DONE (av_tap.js)** — extend with avKeysFor usage when the engine lands.
2. **Knob framework port** (PF app_knob.js → av_knob.js) + feel suite.
3. **Harness port** — CDP launch laws (1440×900 device metrics, --mute-audio, temp profile,
   explicit exit) + smoke suite (boot → `data-av-ready` → chips filled → zero console errors).
4. Theme polish against 02 §9; header/help stubs.
Then **P1**: mixer AudioWorklet + PolyBLEP/wavetable osc + SVF + env/LFO + voice pool →
**run the T5 §7 proof benchmark — the measured voice count is the first publishable number.**

## Laws (do not drift)
- lab → battery → frozen bytes → deploy; nothing ships without a witness report.
- Verifiers own their AnalyserNode on the master tap; keep a-rate worklet params single-digit.
- No console windows on Moddy's desktop; one writer per file; contracts per stage.
- Licences: Open303 (MIT) = acid DSP foundation; dittytoy = clean-room (CC BY-NC-SA);
  content = own/CC0/PD (see docs/05 §3 for the re-check list).

## How to build
`python3 build.py` → prints bytes + sha256. Add any new src part to js_parts or it never ships.

## Open later-phase decisions (docs/05 §2)
P1 backend green-light (default Cloudflare Workers+D1+R2); embed stance (default links-only);
CC0-only community rule (default yes); MP3 export module (default WAV+Opus; MP3 optional).


## Session close — 2026-10-07 (~444k context; start fresh)

This session delivered: Brave-tabs research → full plan (docs 00–06, all verified) → owner decisions
(Anvil · free · granular+sampler in v1) → Phase 0: scaffold, build pipeline, shell, **master tap (verified)**,
GitHub goldmine wave (G1–G3). Session stat: $3.64 over 71 calls.

### Start the next session with (in order)
1. **KNOB FRAMEWORK PORT (av_knob.js)** — source already scouted (re-read for detail):
   - Feel engine: `C:\Users\Moddy\pattern-forge\src\app_knob.js` (333 lines) — drag/twist arbitration
     (6 px slide / 9 px rim-twist; rim = startR > rad*0.35), damped travel (0.40→2.0× over 260 px),
     settle animation, wheel/click/dblclick/arrow-key, at-min/at-max/at-stop states, aria-slider.
   - Skin: `pattern-forge\src\styles.css` "rotary knobs (Minimoog-style pointer caps)": ring =
     conic-gradient(--knob-arc, 270° span), face radial-gradient, mark rotate(-135 + norm*270). Reskin to
     Anvil tokens (teal/graphite); skip the marantz variant for now.
   - Port decisions: av-namespace (avKnobHTML/Bind/Commit/RefreshAll/NormToVal/ValToNorm/Format/ApplyVisual/RowHTML);
     commit hook = `avApplyParam(path,v)` if defined, else avParams map + CustomEvent 'av-param';
     drop hub*/snapshot/koalaHint (optional guards).
   - **Demo wiring (first live controls):** LEVELS card with INSTRUMENT + MASTER knobs → avApplyParam('keys'|'master')
     → avKeysApply/avMasterApply (tap gains). Extend `?avtest=1` to commit a knob + assert.
   - build.py js_parts becomes [av_tap.js, av_knob.js, app_core.js]; append knob CSS to src/styles.css.
2. **CDP HARNESS + SMOKE suite** — port PF launch laws (cdp_smoke.mjs pattern): device metrics 1440×900,
   --mute-audio, temp --user-data-dir, explicit exit; smoke = boot → data-av-ready → chips filled → tap armed → zero page errors.
3. **P1 — worklet voice engine**: one mixer AudioWorklet, PolyBLEP + wavetable oscillators, TPT SVF, env/LFO,
   voice pool + oldest-first steal → then run the T5 §7 proof benchmark and publish the measured voice count.

### State at close
- commits: be4da47 (scaffold) · d54000a (build+shell) · 5b816ad (G-wave) · 72cd49f (tap) · + this note.
- index.html sha256 8ec7f726… (15,291 B) · tap selftest ✓ (renders/p0-tap.png) · tree clean at commit.

## Resume addendum — 2026-10-07 (knob port session)

- **Knob framework ported** → `src/av_knob.js` (PF feel engine, av-namespaced API, `avApplyParam` hook,
  avParams mirror; hub*/marantz extras dropped per the port decisions). Knob CSS in `src/styles.css`
  (Anvil Teal skin: graphite cap, teal arc ring + pointer mark, at-min/at-max/at-stop states).
- **LEVELS card live**: Instrument + Master knobs → `avApplyParam('keys'|'master')` → `avKeysApply` /
  `avMasterApply` (tap gains, 0–1.2, persisted to localStorage). `?avtest=1` now also prints a
  **KNOB SELFTEST** line (ok:true) alongside the tap line.
- **index.html rebuilt: 40,215 bytes · sha256 0a6b6232ce23daa8a92d5f9b0060ed6c0bccdf90f35caa153569705e2e743d85**
- **Feel suite ported** → `verify/cdp_knob_feel.mjs` (real mouse over CDP: travel curve, rim twist, flick
  weight, mechanical stops, click/wheel/keys/reset, tap-gain witness) — **18/18 green** on the built bytes.
  Screenshots: `renders/p0-knobs.png` (card, 2×) + `renders/p0-knobs-full.png` (page 1440×900).
- Next: **CDP smoke suite** (`verify/cdp_smoke.mjs` — boot → data-av-ready → chips filled → tap armed →
  selftest lines → zero page errors), then **P1**: worklet voice engine + measured voice benchmark.

## Resume addendum 2 — 2026-10-07 (smoke suite + keyboard/MIDI directive)

- **Smoke suite ported** → `verify/cdp_smoke.mjs` — **8/8 green** (log `verify/last-cdp_smoke.log`):
  boot/`data-av-ready` → chips → tap armed + TAP SELFTEST → knobs mounted → KNOB SELFTEST → layout at
  1440 → zero page errors. The layout check caught a selftest-line horizontal overflow; fixed with
  `overflow-wrap: anywhere` on `.av-mono` (offender finder now built into the check). Feel suite
  re-run green on the new bytes (log `verify/last-cdp_knob_feel.log`, 18/18).
- **index.html rebuilt: 40,240 bytes · sha256 9a5c25c4583912bee6f057bfa6866cbd11227db6ed755eed3bdcc14b8b66e665**
- **OWNER DIRECTIVE (2026-10-07): full 61-key keyboard + full MIDI support (PF-grade, "all the bells
  and whistles") — must-have, same tier as the engine.** Recorded in `docs/05` §2.5 + `docs/03` §2.5/§6.
  Building now: `av_kb.js` (piano dock + ONE keydown dispatcher + avNote bus) + `av_midi.js` (Web MIDI
  in/out + panel + CC learn). Source digests in flight → `research/reuse/kb-port-digest.md` +
  `research/reuse/midi-port-digest.md`.
- After the ports land: full battery (smoke + feel + new keyboard/MIDI suites) → then **P1**.

## Resume addendum 3 — 2026-10-07 (reference rig registered)

- **Reference rig registered** → `research/external/REFERENCE-RIG.md`: Korg Collection ×21 (+ SGX-2
  11 GB DB, reference-only), Serum 2 wavetable corpus (`Documents\Xfer\Serum 2 Presets\Tables\`) for the
  G2 wavetable-import acceptance check, FL Studio 2026 (Harmor ideas), Ableton Live 12 Suite, Overtonium
  (AGPLv3) ideas — equal↔just TUNE morph (PERFECT TUNINGS candidate), per-partial drift. **Licence law:
  reference / private-test only — nothing ships.**
## Resume addendum 4 — 2026-10-07 (digests verified; keyboard/MIDI ports dispatched)

- kb + midi source digests COMMITTED (`research/reuse/kb-port-digest.md`, `research/reuse/midi-port-digest.md`)
  after spot-verification against PF source (kbNoteName/kbNoteDown/kbNoteStopAll L249-487, MIDI prefs/monitor
  caps/midiDecode L25-155, the headless stub — all matched).
- **avNote bus** (`src/av_note.js`) landed: name-dedupe, gain clamp 0.05..1 @0.9, taken-set, stop-all,
  engine sink registration for P1; observables `__lastNotePreview`/`__lastNoteCode`; `window.__avNotes`.
- Parent wiring landed (uncommitted until the ports build): dock markup in `body.html` (+ header 🎹 toggle,
  MIDI card host `#av-midi-body`), dock + MIDI panel CSS (teal skin), `build.py` js_parts order
  (av_tap → av_knob → av_note → av_kb → av_midi → app_core), `app_core` boot calls + `avState.bpm`.
- **Two file-scoped port agents dispatched**: `src/av_kb.js` (61-key dock + ONE keydown dispatcher +
  typing note path) and `src/av_midi.js` (states/ports/decode/note-routing/monitor/out-tap/clock-out/
  CC map+learn/panel). On return: verify files → build → smoke+feel → keyboard+MIDI suites → battery → commit.
- **Pre-staged (zero-idle) return plan: `verify/_p0b_suite_wave.md`** — parent verification steps,
  both suite contracts (cdp_keys / cdp_midi), commit messages, close-out checklist. Read it FIRST
  on resume.

## Resume addendum 5 — 2026-10-07 (ports LANDED; suite wave in flight)

- **Keyboard + MIDI ports landed + committed `f56daf7`**: `src/av_kb.js` (423 lines) + `src/av_midi.js`
  (1,279 lines); build **sha256 a69a684f…** (133,582 B). Wiring committed (build.py, app_core, body, styles).
- Battery on the new bytes: **smoke 9/9** (new check: 61 keys + snap + deck mounted) + **feel 18/18**;
  visual pass done (`renders/p0-keys.png`, `p0-keys-tall.png` — dock, rail, MIDI deck all render).
- **Wave status: `verify/cdp_keys.mjs` running as child A (deleg_06e4181b); `verify/cdp_midi.mjs`
  dispatches after A returns** (serialized — one browser suite at a time). Contracts in
  `verify/_p0b_suite_wave.md` §2.
- On both green: full battery (smoke + feel + cdp_keys + cdp_midi on the frozen sha) → commit B →
  README + mnemosyne refresh → P1 next.

## Resume addendum 6 — 2026-10-07 (glide fix; keys 27/27; midi suite dispatched)

- cdp_keys suite landed (`verify/cdp_keys.mjs`, 480 lines, 27 checks) and caught a REAL app bug: the
  dock glide was dead — `pointerenter` never re-fires on the container for a held pointer crossing onto
  a sibling key (latent in PF too). Fixed in `src/av_kb.js` (pointerover). Rebuilt + re-ran the trio:
  **smoke 9/9 · feel 18/18 · keys 27/27** on build **sha cc601710…** (134,019 B); committed `481869a`.
- cdp_midi suite (child B) dispatched against cc601710. On its report: verify → full battery → commit B
  → README + mnemosyne refresh.

## Resume addendum 7 — 2026-10-07 (SESSION SAVE at ~96% context; midi suite in flight)

- HEAD `c01f35a` (this save commit — it swept in a WIP snapshot of the child's `verify/cdp_midi.mjs`;
  **existence of that file is NOT "done"** — judge only by the child's completion report / log tail).
  Build at save: **sha cc601710…** (134,019 B) — **smoke 9/9 · feel 18/18 · keys 27/27 GREEN** on these bytes.
- **IN FLIGHT: `verify/cdp_midi.mjs` suite child** — subagent `sa-0-c6e017b1`, unit `deleg_e12d803b`, transcript
  `C:\Users\Moddy\AppData\Local\hermes\profiles\deepseek\cache\delegation\live\deleg_e12d803b\task-0.log`.
  Contract: §2 'Child B' of `verify/_p0b_suite_wave.md`; frozen build cc601710; may create ONLY
  `verify/cdp_midi.mjs`, `verify/last-cdp_midi.log`, `renders/p0-midi-suite.png`; never src/*, never
  build.py; report shape {checksPassed, checksFailed, appBugs[], freeze{shaBefore,shaAfter}, shots}.
- **ON RESUME — the child may have finished, died, or never reported:** check `verify/cdp_midi.mjs`
  exists and `tail verify/last-cdp_midi.log`. Child dead/mid-flight (no suite file or stale transcript)?
  Re-dispatch the SAME contract in the same file scope. Suite green? Run the full battery
  (smoke + feel + keys + midi) on the frozen sha → commit B → README status line + mnemosyne refresh →
  then **P1 worklet engine** (the next milestone).
- App bugs in the report: fix in src (parent-owned), rebuild, re-run keys+midi, then the battery.
- Session cost ~$2.87 over 55 calls; all state committed; tree CLEAN at save.

## Resume addendum 8 — 2026-10-07 (P0 CLOSE — keyboard + MIDI wave DONE)

- cdp_midi suite landed + **parent-verified: 33/33 green** on frozen build cc601710 (134,019 B); freeze
  sha unchanged across the run; shot `renders/p0-midi-suite.png`; full battery on frozen bytes:
  **smoke 9/9 · feel 18/18 · keys 27/27 · midi 33/33 — P0 COMPLETE.**
- Next milestone: **P1** — mixer AudioWorklet; PolyBLEP + wavetable osc; TPT SVF; env/LFO; voice pool +
  steal → run the T5 §7 proof benchmark and publish the measured voice count (spec docs/03 §2.1/§6).

## Resume addendum 9 — 2026-10-07 (P1 wave started: engine contract frozen)

- **P1 contract + pre-staged return plan: `verify/_p1_wave.md`** — read it FIRST when resuming. It pins
  every interface: `av_dsp.js` (kernels + voice engine API + full param table + voice laws),
  `av_voiceproc.js` (processor + message protocol), `av_engine.js` (tier ladder blob→data→spn, facade,
  boot/resume, observables), `av_synth.js` (SYNTH card), build.py worklet embed, and the rig contracts
  (cdp_bench / cdp_alias / cdp_stress).
- **Halfband decimator designed + verified** (clean-room): `research/engine/hb_design.py` →
  `research/engine/hb-coeffs.json`. Ship set = order 6 (3+3 allpass): 73.5 dB stopband, −3 dB @
  23.999 kHz, power-comp err 4.7e-15; exact decimation algorithm verified 1.6e-12 (variant `sumB`:
  even→A, odd→B, y = 0.5·(aOut[n] + bOut[n−1])).
- **In flight: 4 file-scoped agents** — K: `src/av_dsp.js` + `src/av_voiceproc.js`; E:
  `src/av_engine.js`; U: `src/av_synth.js`; B: `verify/cdp_bench.mjs` + `verify/_bench_mock.html`
  (mock self-test only this phase; the real bench runs after integration). On return: verify files →
  parent integration (contract §8) → build → **P0 battery re-run on the frozen bytes** → bench (B-run,
  parent re-run owns the published number) → alias rig (C) → stress rig (D) — serialized, one browser
  at a time. Voice count is published ONLY from the measured ramp (T5 §7).
- P0 battery baseline (must still pass after integration): smoke 9/9 · feel 18/18 · keys 27/27 ·
  midi 33/33 on cc601710.

## Resume addendum 10 — 2026-10-07 (engine LANDED; battery green; bench in flight)

- **P1 engine core COMMITTED `9e748dd`** — `src/av_dsp.js` (818 lines) + `av_voiceproc.js` (83; adds
  the windowed bench clock) + `av_engine.js` (blob→data→spn ladder; file: skips the doomed blob rung —
  probe-verified refusal) + `av_synth.js` (SYNTH card: 3 selects + 15 knobs). `build.py` embeds the
  worklet source (AV_WORKLET_SRC + SHA + standalone `node --check`); app_core boots the engine eagerly,
  routes `avApplyParam`→engine, and runs ENGINE SELFTEST (`window.__avEngineTest`).
- **Build frozen: `dff3721f` (244,026 B). Battery green on those bytes: smoke 11/11 · feel 18/18 ·
  keys 27/27 · midi 33/33** (midi freeze pin updated cc601710→dff3721f — the only test-side edit).
  Probes (2026-10-07): file:// boots the real worklet via **data: URL** (blob refused on file:, data ok);
  `performance.*` is **absent** in AudioWorkletGlobalScope on this Chromium ⇒ the bench ring records
  32-quanta windows (≈31 µs precision) when only Date.now exists.
- **IN FLIGHT: bench run child** (deleg_750cbd31 / sa-0-8a0259df): `node verify/cdp_bench.mjs` real mode
  against dff3721f (~12–17 min; writes `verify/last-cdp_bench.{log,json}` + `renders/p1-bench.png`; the
  file:// spn cell forces `?avengine=spn`). On return: digest → **parent re-runs the full bench** (owns
  the published number) → alias rig `verify/cdp_alias.mjs` (write+run, contract §9.3) → stress rig
  `verify/cdp_stress.mjs` (§9.4; its cap fills from the bench) → final battery pass + `last-*` log
  refresh → README + addendum 11 + mnemosyne. One browser suite at a time — strictly serialized.
- Reminder: the three rigs (bench/alias/stress) are NEW files this wave; smoke is 11 checks now; the
  engine tier strings: `data-av-engine` = base tier ('worklet'|'spn'), `__avEngine.url` = 'blob'|'data'.
- **REVISION (bench rev2, same day):** the 32-quanta windowed clock was REJECTED by its first real run —
  a window spans device-paced waiting (~2.59 ms/quantum floor at ONE voice; integrity finding in
  `verify/bench-v1-windowed-rejected.log`). `av_voiceproc.js` reverted to per-quantum Date.now lattice;
  **rebuild = 08e3c38f (243,193 B)**; smoke 11/11 re-run; midi freeze pin updated. The publishable cost
  number now comes from a NEW offline marginal-cost ramp in `verify/cdp_bench.mjs`.
- **BENCH REV2 RESULT (delivery race caught; NO number published):** realtime = 64/64 stable ×3 reps
  both variants, 0 underruns (means ~527/543 µs at cap). Offline ramp INVALID as run — fire-and-forget
  noteOn posts raced startRendering (~1-voice renders in 15/20 cells); the bogus 'published 256' was
  refused. Fix VERIFIED by probe = `stats()` FIFO barrier (require active===N before rendering) +
  midi = i pattern (midi space caps N at 128; old 21+i capped at 107). Indicative true cost ≈ 9–11
  µs/voice/quantum → 50%-budget knee ≈ 120–130 voices. Evidence: `verify/bench-v2-delivery-race.log`
  + `last-cdp_bench.json` (verifiedFixProbe / groundTruth / indicativeTrueCosts).
- **BENCH MEASURED + COMMITTED (678873b):** **128 voices @ 38.7% budget** — three independent runs
  (37.9 / 38.7 / 39.7% = 1009–1057 µs/q vs the 2667 µs budget), every cell delivery-verified
  (active=N barrier), monotone; baseline 9.4 µs/q; the 50%-budget knee extrapolates beyond the
  **128-note midi-space ceiling**. Realtime: **64/64 stable ×3 reps both variants, 0 underruns**;
  SPN fallback cell 8v ≈ 68 µs mean. Artifacts: `bench-v{1,2,3}*.{log,json}` (all three revisions of
  the story) + `last-cdp_bench.*` + `renders/p1-bench.png`. Rig: `--offline-only` flag exists.
## Resume addendum 11 — 2026-10-07 (P1 CLOSE-OUT: engine + benchmark done; aliasing blocker recorded)

**Shipped + verified (frozen `08e3c38f`, 243,193 B):** the P1 voice engine — `av_dsp.js` (AVDSP kernels +
voice pool), `av_voiceproc.js` (worklet), `av_engine.js` (tier ladder; file:// rides data:-URL worklets),
`av_synth.js` (SYNTH card), build.py worklet embed, app_core wiring. Final battery green: smoke 11/11 ·
feel 18/18 · keys 27/27 · midi 33/33 (logs in `verify/last-*.log`).

**The measured number:** **128 voices at ~38.7 % of the 2667 µs budget** (three independent runs:
1009.4 / 1030.9 / 1057.5 µs/q; monotone; every cell delivery-verified with the stats() barrier; baseline
fixed cost 9.4 µs/q). The 50 %-budget knee extrapolates beyond the 128-note midi-space ceiling.
Realtime: 64/64 stable ×3 reps both LIGHT and FAT, 0 underruns; SPN fallback 8v ≈ 68 µs mean.
**10-minute stress GREEN** at cap 64: 0 underruns, heap +0.2 MB, 15/15 pool drains, 0 page errors.

**Aliasing (`verify/cdp_alias.mjs`) — GATES NOT MET (the open blocker for "aliasing gates met"):**
- VA saw C4 −52.8 / A4 −48.6 PASS; **saw C6 −39.8 FAIL** (23rd harmonic lands in the halfband
  transition band 24.0–26.9 kHz and folds back partially attenuated).
- **VA square −44.4/−39.5/−32.6, pulse −42.9/−37.7/−30.9 dBc — FAIL all pitches**; spurs sit at exact
  2×-Nyquist folds = polyBLEP residual for harmonics above 48 kHz in the 2× domain (decimation cannot
  fix them). Exactly the limit T5 §8 predicted for 2-point polyBLEP.
- WT: real spurs −46.8 dBc on wt.saw/square/pulse25 @ A4 (harmonics 55–64 in the transition band);
  other rows clean to the floor. The −80 dBc gate is NOT evaluable with the pinned ±3-bin Blackman
  metric (leakage floor ≈ −57 dBc, proven with synthetic signals) — needs a Blackman-Harris window
  amendment when the fix wave lands.
- Determinism PASS (bit-identical pairs); 44.1 k spot PASS (saw C4 −53.1).

**The fix wave (next, owner's call vs starting P2):** minBLEP "Classic" oscillator (already scoped in
T5/research as the v1 quality tier) + a decimation/mip-margin policy pass (margin by the decimator's
stopband edge, not 2× Nyquist) + alias-rig BH-window amendment → re-run cdp_alias.

**Artifacts:** `bench-v{1,2,3}*.{log,json}` (full measurement story incl. two rejected designs),
`last-cdp_bench.*` + `renders/p1-bench.png`; `cdp_alias.mjs` + `last-cdp_alias.log`; `cdp_stress.mjs` +
`last-cdp_stress.log` + `renders/p1-stress.png`. **If resuming cold:** read `verify/_p1_wave.md`
(AMENDMENTS at the end), then `verify/last-cdp_alias.log`.

## FIX WAVE (P1.x) — ENGINE DELIVERED (commit 41938b3, rebuild 56734133)

minBLEP Classic osc (65-tap × 256 subs, clean-room, calibrated) + WT mip-margin rule + 4+4 halfband;
node alias harness ALL PASS (VA worst real −58.2 dBc, WT real ≤ −119 dBc, determinism, alloc-free).
Re-verify child (deleg_2fa7136f) runs the browser suite on the new bytes → close-out commit +
addendum 12 follows.

## GOLDEN BUILD — owner directive 2026-10-07 ("build until completion, industry standard everything")

Recorded in `docs/05` §2.7. Locked scope beyond P1 (no re-ask): STORE + add-on packs/modules; CODE
section (user code creation/interaction); walkthrough + help; PF-grade keyboard incl. POPOUT; maximum
varied sound modules/racks; many-configuration synth+store; outlandish sound extras; sound
packs/loops/drum packs; full recording + varied file I/O; one-press STEM export (per-part WAVs,
DAW-ready); pro deck display/readouts; seamless drum↔synth interchange; final deploy + live verify +
owner pass. Agent discretion on clinical decisions; every wave battery-gated.

PROGRAM (resume from the latest addendum; waves may split across sessions):
1. **NOW:** P1.x close-out (re-verify child in flight) → commit + addendum 12 + owner report.
2. **P2 wave:** ACID (Open303 clean-room foundation) + STRING (Karplus-Strong) + DRUM (expanded kit
   + pads, drum-split law) engines; sample core begins (import WAV/FLAC/MP3/OGG, waveform display);
   RECORDER core (tap recorder → WAV export); drum↔synth keyboard split.
3. **P3 wave:** FX rack ≥12 modules (Dattorro plate / FDN / Freeverb, drive, bitcrush, chorus/
   flanger/phaser, delay, EQ/comp/limiter); per-voice mod matrix + 8 macros; granular + sampler voice.
4. **P4 wave:** sequencer/groovebox (step-objects, chains/songs, acid lane); LOOPS as patterns;
   play/record; audio-clock scheduling.
5. **P5 wave:** STORE — 10 factory packs (580 presets) + drum packs + loop packs; IDB install;
   previews; add-on modules.
6. **CODE section** (user code creation/interaction) + **WALKTHROUGH/help** + **POPOUT keyboard** +
   pro deck display — folded into P3–P7 per wave capacity.
7. **P6–P7:** share links, cloud, polish; STEM export; deploy + live verify + owner pass (the
   golden build finish line).


## SESSION SAVE — 2026-10-07 (~04:50; context full -> NEW SESSION)

- HEAD: after the docs/07 batch-3 commit. P1.x engine fix COMMITTED (`41938b3`: minBLEP Classic osc
  65x256 clean-room + WT margin rule + 4+4 halfband; av_dsp p1.1). Rebuild `index.html` =
  **56734133** (on disk, uncommitted at save).
- **IN FLIGHT at save: re-verify child `deleg_2fa7136f` / sa-0-3e5cb671** — browser suite on 56734133
  (alias rig v2 BH-window + midi pin + battery + bench + stress). A /new session HALTS it; its partial
  outputs are on disk (uncommitted: cdp_alias.mjs, cdp_midi.mjs, hb-coeffs.json, logs, renders,
  index.html).
- **FIRST MOVES in the continued session:** read the child's transcript tail
  (`...cache/delegation/live/deleg_2fa7136f/task-0.log`) -> see which legs completed -> finish the
  rest (one browser at a time) -> commit the P1.x close-out (+ addendum 12) -> then the **P2 wave**
  per the GOLDEN BUILD program above. Mandate: `docs/05` §2.7. Ideas: `docs/07` (59, 3 batches).
  Resume phrase: **"continue anvil"**.

## Resume addendum 12 — 2026-10-07 (P1.x CLOSE-OUT: aliasing gate CLOSED; full re-verify on 56734133)

- Engine fix committed `41938b3` (av_dsp p1.1: minBLEP "Classic" oscillator 65×256 + WT mip-margin
  rule + order-8 4+4 halfband); rebuild `index.html` = **56734133** (259,387 B, byte-reproducible —
  re-verified at close-out). Node-harness evidence kept: `verify/p1x-node-alias-out.{log,json}`
  (ALL PASS: VA worst real −58.2 dBc, WT real ≤ −119 dBc, determinism bit-identical, K-sanity, alloc-free).
- **Browser re-verify on the frozen bytes** (alias+battery+bench completed by the save's child before
  its halt; stress run by the parent — TWO runs):
  - **alias rig v2** (`cdp_alias.mjs` + P1.x amendment: 4-term Blackman-Harris, ±4-bin mask, validated
    synthetically first): **30/30 PASS** — VA worst −58.18 dBc (pulse C6; gate −45), WT worst −91.21 dBc
    (wt.saw A4; gate −80); saw C6 −58.99 (was −39.8); determinism bit-identical; 44.1k spot clean.
  - **battery** frozen: smoke 11/11 · feel 18/18 · keys 27/27 · midi 33/33 (freeze pin 08e3c38f →
    56734133 in `cdp_midi.mjs` — the only test-side edit).
  - **bench (full)**: realtime LIGHT 64/64 ×3 stable; FAT 64 marginal (2/3 reps pass the p95 bar, rep-1
    p95 trip, 0 underruns every cell; means 0.87–1.00 ms vs 1.33 ms) → rig published {light:64, fat:48};
    **offline (publishable): 128 voices @ 1268 µs/q = 47.6 % budget** (was 38.7 % on 08e3c38f; minBLEP
    ≈ +1.65 µs/voice/q ≈ +20 %; knee at the 128-note midi cap). Record: `bench-v4-p1x-full.{log,json}`.
  - **stress ×2, 10 min, cap 64 — verdict `asserts-not-met` in BOTH, for the same single reason**
    (`stress-p1x-run1.log`; `last-cdp_stress.log` = run 2):
    - verified-envelope deltas: **1 in each run, IDENTICAL** — one underrun, cycle 1 @ uni 3, first 15 s
      (cold first-cap entry) → systematic cold-start edge, not a flake;
    - uni-7 over-drive windows (beyond the bench envelope by design): 9 deltas (run 1) / 11 (run 2),
      biggest cluster 13–15 in cycle 3; means ~1.3–1.5 ms vs ~0.6–0.7 ms pre-fix;
    - everything else green both runs: heap +0.2 MB, drains 15/15, 0 page errors, ctx running,
      coverage 27/27 cycles, driver errors 0.
    - Reading: steady-patch cost inside budget; the minBLEP engine is AT THE MARGIN under unison-heavy
      churn at cap 64 → feeds P·1 (per-wave perf gate) + P·2 (minBLEP cost-optimisation pass; docs/07
      batch 4) — the optimisation is a named deliverable now.
- Artifacts: `hb-coeffs.json` annotated (hq 4+4 = shipped; legacy fields relabel piggybacks P·2);
  `hb_design.py --study` + `research/engine/hb-study-capture.txt` (design evidence).
- Owner directives this session: docs/07 Batch 4 (items 60–83, picks) `b0e1a8d`; docs/08 STUDIO
  mandate + competitor matrix + max packs/integrations `194b2da`; full build permission docs/05 §2.10.
- **Frozen at close: `index.html` = 56734133 (259,387 B).**
- **NEXT: P2 wave** — ACID (Open303 clean-room: 303 4-pole filter, accent memory, slide, EXPANDED
  panel) + STRING (Karplus-Strong) + DRUM (expanded kit + pads + split law) + ladder filter/overdrive
  + sample core + recorder + drum↔synth; contract `verify/_p2_wave.md`. Mandates docs/05 §2.7–2.10;
  ideas docs/07; station docs/08. Resume phrase: **"continue anvil"**.

## P2 wave STARTED — 2026-10-07 (7 children dispatched; integration pending)

- Contract: `verify/_p2_wave.md` (kind interface §2 · engine specs §3 · sample §4 · rec §5 · UI §6 ·
  gates §7 · reports §8).
- Children — delegation `deleg_9846f2ce` (background; results re-enter the session when done):
  sa-0 acid `av_acid.js` · sa-1 string `av_string.js` · sa-2 drum+pads `av_drum.js`+`av_pads.js` ·
  sa-3 sample `av_sample.js`+`cdp_sample.mjs` · sa-4 rec `av_rec.js`+`cdp_rec.mjs` · sa-5 synth UI
  (extends `av_synth.js`) · sa-6 ladder `av_ladder.js`. Transcripts:
  `C:\Users\Moddy\AppData\Local\hermes\profiles\deepseek\cache\delegation\live\deleg_9846f2ce\task-{0..6}.log`.
- On return: parent integrates per `_p2_wave.md` §2.3 (av_dsp kind dispatch + build.py + app_core/
  body/styles + hosts), rebuild, P1 battery + the new rigs (parent-run only), PERF GATE (bench +
  stress), commits + addendum 13 + owner report.
- **If resuming cold mid-P2:** check which files landed (`ls src/av_*.js`), read the child reports
  (task-*.log tails), then run the parent integration per `_p2_wave.md` §2.3–§7. Nothing else is
  authoritative — never integrate half-landed files.

## Resume addendum 13 — 2026-10-07 (P2 wave INTEGRATED; battery ALL GREEN on 7ddfedf7)

- **P2 integration landed** (parent, one counted-assert script, 29 edits): av_dsp **p2.0** (kind
  dispatch registerKind/KIND_MODS · v.kindId per-note routing · v.k union + eng.kext · engine.kind +
  drum.split · ladder24 + filter.drive · AVDSP.blep exposure · kind frame path + isVoiceDone end) ·
  build.py (bundle + worklet concat = av_ladder+av_dsp+av_acid+av_string+av_drum+av_voiceproc) ·
  app_core (pads/sample/rec boot + ENGINE SELFTEST extended: kind switches + drum routing
  round-trip) · body.html (Drums/Samples/Recorder cards, P2 copy) · styles.css (P2 blocks).
  New src: av_acid 478 · av_drum 474 · av_sample 582 · av_rec 445 · av_string 333 · av_ladder 200 ·
  av_pads 170 · av_synth engine layer 343 lines.
- **Frozen build: `index.html` = 7ddfedf7… (483,056 B).** Battery ALL GREEN on these bytes:
  smoke 11/11 · feel 18/18 · keys 27/27 · midi 33/33 (pin now 7ddfedf7) · **cdp_sample 29/29**
  (drop/file/host imports · HiDPI waveform · tap-witnessed 440 Hz preview) · **cdp_rec 29/29**
  (tap capture → WAV parse+length · silence control · audible note take; one rig SPEC fix: control
  duration = WAV-vs-wall-clock ±0.5 s — CDP round-trips stretch the arm span).
- Child evidence: acid T1–T5 ALL PASS (accent memory rises 0.273<0.310<0.316<0.342 · slide 29.6/
  30.7 ms @60 ms · saw −6.46 dB/oct) + 3 demo WAVs · string ALL PASS (f0 ±0.05 %) · drum 16-slot
  gates + kits demo · ladder 44/44 (Huovilainen form, ampl→freq pull documented). Harness outputs
  + demos archived (scratch/p2 → copies in verify/ + renders/).
- **PERF GATE (P·1) on 7ddfedf7:** bench = **128 voices @ 47.1 %** (unchanged vs P1.x 47.6 %;
  light 64×3 stable, fat published 48; fallback spn fine) → the P2 engines add ZERO VA-path cost.
  Stress run1 = 142 deltas total (2 verified-window: the known cold-start one + one late single
  (cycles 20/21); 14 in uni-7 windows) vs P1.x 35–45 → fatter tail, means UNCHANGED (~1.45 ms):
  attribution re-run (stress run2) running; records committed `fe41c51` (bench-v5-p2-full.*,
  stress-p2-run1.log). If run2 reproduces the elevation → feeds P·2 (minBLEP optim); if clean →
  environment (machine busier at 06:10).
- **NEXT: P3** (FX rack ≥12 modules + mod matrix + macros + granular + sampler) per docs/05 §2.7–2.10;
  carry: minBLEP cost-optimisation (P·2), smoke-check extension for the P2 cards.

## P3 wave DISPATCHED — 2026-10-07 (7 children; contract `verify/_p3_wave.md`)

- Contract: `verify/_p3_wave.md` — §2 FX chain interface (registerFx, st.oL/oR, fixed chain order
  drive→mod→delay→verb→dyn, bypass = bit-identical) · §3 module specs (verb: Dattorro plate/FDN/
  Freeverb; delay: ping-pong/duck/bpm-div; mod: chorus/ensemble/flanger/phaser; drive: sat/fold/
  crush; dyn: EQ+comp+limiter+soft-clip) · §4 mod matrix (8 macros, ≤32 slots, pinned wire format
  avEngineMod → Float64Array(8) + Float64Array(32*4)) · §5 grain (KIND 4, Hann grains, budget 24,
  buffer transfer {t:'sample'} ≤4×60 s) · §6 sampler (KIND 5, loop/root/zones {t:'zones'}) ·
  §7 UI (av_fx rack + av_mod matrix + av_synth grain/sampler panels) + cdp_fx rig · §8 gates/laws.
- Children — delegation `deleg_126ca06f`: sa-0 verb `av_fx_verb.js` · sa-1 delay+mod
  `av_fx_delay.js`+`av_fx_mod.js` · sa-2 drive+dyn `av_fx_drive.js`+`av_fx_dyn.js` · sa-3 fx UI
  `av_fx.js` + `verify/cdp_fx.mjs` · sa-4 mod matrix `av_mod.js` · sa-5 grain+sampler `av_grain.js`+
  `av_sampler.js` + av_sample.js append · sa-6 synth panels `av_synth.js` ext. Transcripts:
  `cache\delegation\live\deleg_126ca06f\task-{0..6}.log`.
- **CHILDREN LANDED (commit `2a1bc84`; all 7 green; evidence `verify/p3-*-node-out.*`).** Parent
  integration flags (detail in the child report tails + file headers):
  1. **Mix convention SPLIT (critical):** delay + mod write the FINAL mixed output (`l = st.oL`, copy
     — no parent blend); verb + drive + dyn write WET (parent blends `dry*(1-mix)+wet*mix`; they also
     pass dry through at mix<=0/off). Wire per module accordingly.
  2. av_dsp: `registerFx(prefix, mod)` (+ FX_CHAIN, states via `createState()` at create + **call
     `bindEngine(st,eng)` right after each** — else states run at the 48k default); post-mix chain
     order drive→mod→delay→verb→dyn, skip when `!st.on`; registerKind ids widen to **1..5**
     (kk<=3 loops → <=5 in create + setParam dispatch; KIND_MODS >=6); preallocate
     `eng.samples=[null x4]` + `eng.zones=new Float64Array(40)` at create; processor branches
     `{t:'sample'}` (allocate AT MESSAGE TIME) + `{t:'zones'}` + `{t:'mod'}` (copy into
     `eng.modMacros[8]`/`eng.modSlots[128]`).
  3. Facade: `avEngineMod({macros F64(8), slots F64(128)})` (encode [srcIdx,dstIdx,amt,curve]x32, 14
     sources/6 targets per E), `avEngineSample(id,name,rate,ch1,ch2)` (transferables),
     `avEngineZones(F64(40))`.
  4. Mod application v1 (in recomputeFilter / computePitch cadence): cutoffLog2 += Sum(amt·curve(src))
     (cutoff ±4 oct · reso ±0.5 · pitch ±12 st · osc levels ±1 · pan ±1 engine-level); `rand` =
     per-note `v.randVal` from the engine PRNG.
  5. build.py: worklet concat = av_ladder + av_dsp + av_acid + av_string + av_drum + **av_grain +
     av_sampler + av_fx_verb + av_fx_delay + av_fx_mod + av_fx_drive + av_fx_dyn** + av_voiceproc;
     page js_parts += the same, plus av_fx + av_mod before av_synth/app_core.
  6. Hosts `#av-fx-host` + `#av-mod-host` cards, boot (`avFxInit`/`avModInit` guarded), styles (D: 14
     classes · E: 19 · G: 2 optional); smoke counts move 70→85 knobs, engine options 6; cdp_fx rig =
     parent-run + pin EXPECT_SHA. Docs/05 §3 option 7 (Freeverb constants) = RESOLVED per child A;
     option 9 verified. Cleanup: stray `verify/verb_node_out.*` dupes.
  7. Then: rebuild → battery (smoke/feel/keys/midi/sample/rec + cdp_fx) → PERF GATE on a QUIET
     machine (incl. the deferred P2 stress attribution) → commits + addendum 14.
- **P2 perf-gate tail — stress run2 INVALID (contaminated):** ran 13:00–13:10 concurrently with all 7
  P3 children hammering the CPU + desktop activity → 627 deltas (run1's 142 was mildly shared-load
  too; P1.x 35–45 was a quiet box). Decision: the delta metric is load-sensitive at the margin; the
  DEFINITIVE attribution run must happen on a quiet machine (no agents, no user activity) — run it in
  a quiet window and commit both records (`stress-p2-run2.log` committed as raw evidence). Bench
  stays the publishable metric (stable across both runs). Resume phrase: **"continue anvil"**.

## SESSION SAVE — 2026-10-07 (~13:25; context full → CONTINUED SESSION)

**Delivered this session (in order):**
1. **P1.x CLOSE-OUT** — commits `2c930ef`→`69884a0`: alias gates MET (BH4 rig 30/30; VA worst
   −58.2 / WT worst −91.2 dBc), battery 11/18/27/33, bench 128 @ 47.6 %, stress ×2 recorded raw
   (cold-start delta reproduced; uni-7 probe hot) → P·2 optimisation queued. Addendum 12 + README +
   contract close-out + node-harness evidence committed.
2. **P2 wave END-TO-END** — contract `c6c4da0`; 7 children (deleg_9846f2ce) → parent integration
   (29 counted edits) → **battery ALL GREEN on frozen `7ddfedf7` (483,056 B): smoke 11 · feel 18 ·
   keys 27 · midi 33 · cdp_sample 29 · cdp_rec 29**; commit `96a4233`; demos in `renders/`
   (demo_acid_line / demo_accent / demo_slide / kits_demo).
3. **P2 PERF GATE** — bench-v5: **128 voices @ 47.1 % (stable, publishable)**; stress run1 = 142,
   run2 = 627 but **CONTAMINATED** (ran with all 7 P3 children + desktop load) → attribution on a
   QUIET machine deferred. Commits `fe41c51` + `e5f0cd1`.
4. **P3 wave** — contract `5e7527d`; 7 children (deleg_126ca06f) ALL GREEN (`2a1bc84`: verb 61/61 ·
   delay+mod 49 · drive+dyn 49 · cdp_fx rig · mod 89/89 · grain+sampler 146/146 · synth panels 85
   knobs); integration flags banked (`e1e46a2`, the section above). **Integration NOT yet done.**
5. Owner directives recorded: docs/07 batch 4 `b0e1a8d` · docs/08 studio mandate `194b2da` · full
   build permission (docs/05 §2.10). Owner standing order: **build to the final product, complete.**

**FIRST MOVES in the continued session:**
1. Read this file's "P3 wave — Children Landed" section (integration flags 1–7) + `verify/_p3_wave.md`;
   then run the parent integration accordingly (av_dsp: registerFx/chain + bindEngine + kind widening
   1..5 + samples/zones + mod application; av_engine: avEngineMod/Sample/Zones; build.py concat/parts;
   hosts/styles/boot; smoke 70→85 knobs).
2. Rebuild → battery + `cdp_fx` (pin EXPECT_SHA) → commit P3 close-out + addendum 14.
3. Perf gate on a **quiet machine** (no agents, no desktop activity) — includes the deferred P2/P3
   stress attribution; bench stays the publishable metric.
4. Then **P4** (sequencer/groovebox: step-objects, chains/songs, acid lane, audio-clock) per the
   GOLDEN BUILD program. Housekeeping: delete stray `verify/verb_node_out.*`; docs/05 §3 option-7
   resolve note; skill P3 update after integration passes.

**State at save:** HEAD `e1e46a2` (tree CLEAN); all child evidence + transcripts on disk
(`cache\delegation\live\deleg_126ca06f\`); mnemosyne canonical 'anvil' current. Nothing at risk.
Resume phrase: **"continue anvil"**.


## Resume addendum 14 — 2026-10-07 (P3 wave INTEGRATED — battery ALL GREEN on 5861d7d6)

- **Parent integration landed** (ONE counted-assert script, all-or-nothing; path
  `cache/scratch/p3/integrate/_p3_integrate.py`), per the e1e46a2 flags:
  av_dsp **p3.0** — FX_MODS/registerFx + the post-mix chain drive→mod→delay→verb→dyn with the
  per-module convention split (drive/verb/dyn = wet + parent blend; mod/delay = module-final
  copy; `bindEngine(st, eng)` right after each `createState`; `st.on === 0` = skipped, chain
  bit-identical to P2 when all off); kind ids widen **1..5** (grain = 4, sampler = 5);
  `eng.samples[4]` + `eng.zones(40)` + `eng.modMacros(8)`/`eng.modSlots(128)` with
  setSample/setZones/setMod at message time (allocation only there); v1 mod application at the
  recomputeFilter/computePitch cadence — cutoff ±4 oct · reso ±0.5 · pitch ±12 st · osc levels
  ±1 · pan ±1 (block-rate, macro sources in v1) with curves linear / sign·x² / sign·smoothstep
  and a per-note `v.randVal`. Plus: av_voiceproc `{t:'sample'|'zones'|'mod'}` branches · facade
  `avEngineMod` / `avEngineSample` (transferables) / `avEngineZones` · build.py (worklet concat +
  js_parts: five av_fx_* + av_fx + av_mod in order) · app_core (avFxInit/avModInit guarded boot,
  ENGINE SELFTEST kinds 6 + fx/mod acceptance, `fx.delay.bpm` mirror) · body hosts + P3 copy ·
  cdp_smoke counts (85 synth knobs, six engine options, fx rack 20 knobs + 5 toggles + 4 selects,
  mod 8 macro knobs) · docs/05 §3 options 7 + 9 resolved notes.
- **Frozen build: `index.html` = 5861d7d6… (775,551 B).**
- **Battery ALL GREEN on the frozen bytes** (logs refreshed in `verify/last-*.log`): smoke **14/14** ·
  cdp_knob_feel 18/18 · keys 27/27 · midi 33/33 (pin now 5861d7d6) · sample 29/29 · rec 29/29 ·
  **cdp_fx 27/27** (new rig: rack mounted, reverb tail WITNESSED on the master tap, bypass-null
  bit-identical A≡B and mix0≡off, all-ON-mix1 changes the render, 29/29 param round-trips,
  screenshot `renders/p3-fx-suite.png`).
- **Parent node harness (NEW)**: `cache/scratch/p3/integrate/mod_dsp_node.mjs` — the mod-DSP
  accuracy + integration group — **ALL PASS (34 checks)**: analytic a2 matches (cutoff +4 oct,
  exp curve → +1 oct, S curve → +2 oct), reso fk exact, pitch inc1 ×2, osc1 level rms ×5, pan
  collapse, rand determinism, chain determinism pair + mix=0 null, sampler exact-output (0.0837
  pinned law) + zone latch, grain spawns/budget. Evidence: `verify/p3-modint-node-out.{log,json}`.
- **Child harness summary re-run (parent)**: verb 61/61 (passes with `--expose-gc`) · delaymod
  49/49 after ONE test-side expectation fix (I5 asserted av_dsp **p2.0** — the un-integrated
  value; now asserts the integrated **p3.0**, registerFx real) · drivedyn 49/49 · grain+sampler
  146/146 · mod UI 89/89; `verify/p3-*-node-out.*` refreshed.
- Cleanup: `verify/verb_node_out.*` dupes removed (git rm); all freeze pins updated.
- **PERF GATE: running next on a QUIET machine** — bench (publishable metric) + stress, including
  the deferred P2 stress attribution (run2 was contaminated by the P3 children). Records +
  addendum 15 land in the next commit.
- NEXT: perf gate → **P4 sequencer/groovebox** (step-objects, chains/songs, acid lane, audio-clock;
  `bpm` mirror seam already live) per the GOLDEN BUILD program. Resume phrase: **"continue anvil"**.


## Resume addendum 15 — 2026-10-07 (P3 perf gate on a QUIET machine — records + the resolved P2 stress attribution)

- **Bench (the publishable metric) on 5861d7d6, quiet machine:** `verify/bench-v6-p3-full.{log,json}`
  — **offline 128 voices @ 1316 µs/q = 49.35 % budget** (P1.x 47.6 % · P2 47.1 % · P3 +≈2 pp =
  the always-on post-mix chain loop + mod gates; monotone; knee = the 128-note midi-space cap).
  Realtime: **light 64/64 ×3 stable · fat 64/64** (0 underruns — the quiet box published the full
  64; P1.x published fat 48 under load); fallback spn cell PASS. `verify/last-cdp_bench.*` refreshed.
- **Stress ×2 on the quiet machine** (`verify/stress-p3-run1.log` · `run2`) — both `asserts-not-met`
  for the SAME two known reasons, now with quiet numbers:
  - verified-envelope deltas: **1 in each run, IDENTICAL signature** (cycle 1 @ uni 3, ~6.6–18.6 s —
    the systematic cold first-cap entry; unchanged since P1.x; run2 6.642–18.632 s vs run1
    6.648–18.636 s);
  - uni-7 over-drive probe windows (beyond the bench envelope by design): **10 (run 1) / 11 (run 2)**
    deltas (P1.x quiet: 9–11).
  Everything else PASS both runs: heap +0.2 MB, drains 15/15, 0 page errors, ctx running, coverage
  27/27 cycles (+3,564 notes on/off each), driver errors 0.
- **P2 stress attribution RESOLVED:** the run1 = 142 / run2 = 627 elevations were LOAD contamination
  (all 7 P3 children + desktop activity); on a quiet box the profile returns to the P1.x close-out
  baseline. The residual (1 cold-start delta + hot uni-7 windows) is the KNOWN minBLEP margin →
  stays queued as **P·2 (minBLEP cost-optimisation pass)**; the per-wave gate P·1 is satisfied
  (bench stable + recorded). Records committed with this addendum.


## P4 wave DISPATCHED — 2026-10-07 (7 children; contract `verify/_p4_wave.md`)

- Contract: `verify/_p4_wave.md` (commit `6d06a59`) — §2 global pins (time model: 16ths/"8t",
  swing `stepDur×(S−50)/100` ∈ [50,80] def 66, micro ±12 ticks @ stepDur/24, prob 0..100 seeded
  xorshift32, conditions fill/a:b/first/!first, ratchet 1..4, gate, accent ⇒ gain 1.0; lookahead
  0.12 s / wake 25 ms against the live handle ctx; trace ring `window.__avSeqTrace`; 4 tracks
  len 1..64 + speed 0.25..4; onset gates mean ≤ 8 ms + no drift) · §3 module pins · §4 pattern
  schema · §5 gates/reports/laws · §6 parent integration checklist.
- Children — delegation `deleg_663f07ab` (background; results re-enter the session when done):
  sa-0 core `av_seq_core.js` · sa-1 sched `av_seq_sched.js` · sa-2 ui+rig `av_seq_ui.js` +
  `verify/cdp_seq.mjs` (write-only) · sa-3 acid `av_seq_acid.js` · sa-4 plock `av_plock.js` ·
  sa-5 undo `av_undo.js` · sa-6 capture `av_seq_capture.js`. Transcripts:
  `cache\delegation\live\deleg_663f07ab	ask-{0..6}.log`; child reports + harness outputs in
  `cache/scratch/p4/<name>/`.
- **On return: parent integrates per `_p4_wave.md` §6** — build.py parts (core→sched→plock→capture→
  undo→acid→ui before app_core), app_core boot (avSeqInit/avSeqUiInit/avUndoInit/avSeqCaptureInit
  guarded) + the `"bpm"` branch in avApplyParam (avState.bpm clamp 20..300 + `fx.delay.bpm` mirror),
  body card `#av-seq` + `#av-seq-host`, styles (child class lists), smoke additions, rebuild →
  child harness summary + `cdp_seq` rig (pin EXPECT_SHA) → FULL P3 battery on frozen bytes →
  PERF GATE (bench + stress, quiet machine) → commits + addendum 17.
- **If resuming cold mid-P4:** `ls src/av_seq*.js src/av_plock.js src/av_undo.js` for what landed,
  read the child reports, then integrate per `_p4_wave.md` §6. Never integrate half-landed files.
- Carried: **P·2 minBLEP cost-optimisation pass** (named deliverable, docs/07 batch 4) — the P3
  perf records (`stress-p3-run1/2.log`, `bench-v6-p3-full.*`) are its baseline. Resume phrase:
  **"continue anvil"**.


### P4 children LANDED — 2026-10-07 (all 7 green; integration pending)

- **`av_seq_core.js`** (A, 794 lines) — model/serialise/generators; harness **146/146**
  (`verify/p4-core-node-out.*`); default export 29,694 B stable; LS keys pinned.
- **`av_seq_sched.js`** (B, 811) — planner + live transport; harness **79/79**; exact stream for
  16 steps @120/S66/gate .5 delivered (odd shift +0.020000 = stepDur×0.16 exact); live delivery
  mean |Δ| 2.5 ms + ZERO drift; slide order holds; fill toggle on `__avSeq.setFill(on)`; stall
  re-anchor; guarded hooks `avPlockApplyAt(step, tSec)` / `avPlockTransportStart/Stop/Load` and
  `avSeqAcidSlideBegin/End/Abort` — all already wired to the siblings' names.
- **`av_seq_ui.js` + `verify/cdp_seq.mjs`** (C, 925 + 810) — card + 28-check rig (write-only,
  EXPECT_SHA null); static harness **58/58**; 39 classes + full ID inventory in its report;
  timing witness switches engine.kind→drum (kick c2=36) + restores; BPM knob path `"bpm"`.
- **`av_seq_acid.js`** (D, 379) — accent/slide/oct lane + mapping table vs av_acid.js; harness
  **55/55**; cap sequence 0.500·0.705·0.788·0.823 reproduces the P2 log; slide window refcounted.
- **`av_plock.js`** (E, 989) — momentary locks + restore + lin @64 Hz; harness **158/158**;
  internal commits carry meta {from:"plock", noCapture, plock, src:"plock"}.
- **`av_undo.js`** (F, 608) — bounded 64 + A/B; harness **114/114**; push-after-change (first push
  per domain = baseline).
- **`av_seq_capture.js`** (G, 525) — step/live capture; harness **57/57**; wraps forward untouched;
  suppression keys noCapture/plock/src:"plock" + Hold bracket.
- Evidence committed: `verify/p4-*-node-out.{log,json}` · transcripts
  `cache\delegation\live\deleg_663f07ab	ask-{0..6}.log` · reports in `cache/scratch/p4/<name>/`.

**Integration flags to resolve in the parent pass (§6):**
1. **Undo call-order seam:** C's report documents "UI calls `avUndoPush("seq", label)` BEFORE the
   load (restore-point semantics)"; F implements push-AFTER-change (first push = baseline) and its
   report says C/G call AFTER commits. Read both call sites; align (fix whichever differs so undo
   restores the pre-edit state); the cdp_seq undo check is the gate.
2. **E↔G suppression cross-check:** verify G's keys (noCapture / plock / src:"plock") match E's
   meta exactly on BOTH commit paths (funnel + 'av-param' event).
3. **F params tap vs plock playback:** consider skipping params snapshots when meta.from==="plock"
   (avoid params bursts during play); cheap guard if warranted.
4. **Acid accent entry:** av_acid's accent entry is velocity-thresholded `>= 0.8` INCLUSIVE and core
   default vel = 0.8 → default steps enter the accent path. D left the engine un-patched (P2 law).
   Decide: keep + document, or map non-accent acid gains below 0.8 in `avSeqAcidResolve`.
5. **Fill control:** B exposes `__avSeq.setFill(on)` + `snap.fill`; the UI has no fill control yet —
   follow-up (not gate-blocking).
6. Standard: build.py parts (core→sched→plock→capture→undo→acid→ui after av_mod, before av_synth) ·
   app_core boot (avSeqInit / avSeqUiInit / avUndoInit AFTER cards mount / avSeqCaptureInit;
   E's init per its report) + the `"bpm"` branch in avApplyParam (clamp 20..300 + fx.delay.bpm
   mirror) · body `#av-seq` card + `#av-seq-host` · styles (C 39 classes + D 2 + E's returned list)
   · smoke additions · rebuild → repin ALL suites (midi/sample/rec/fx + cdp_seq) → full battery →
   cdp_seq rig → PERF GATE (quiet) → commits + addendum 17.


## Resume addendum 17 — 2026-10-07 (P4 wave INTEGRATED — battery ALL GREEN on 83e4b478; perf gate pending)

- **Parent integration landed** (ONE counted-assert script, all-or-nothing;
  `cache/scratch/p4/integrate/_p4_integrate.py`): build.py js_parts (core→sched→plock→capture→undo→
  acid→ui after av_mod, before av_synth) · app_core (avSeqInit / avPlockInit / avSeqUiInit /
  avSeqCaptureInit / avUndoInit-after-cards boot; the **"bpm" branch** — clamp 20..300 +
  `fx.delay.bpm` mirror; ANVIL 0.4.0 "P4 · sequencing") · body `#av-seq` card + `#av-seq-host` ·
  styles (the P4 block: 39 UI + 13 plock + 2 acid classes) · cdp_smoke P4 card check (15 checks now).
- **Two seam fixes beyond the flags** (probe- and rig-driven):
  1. **Undo call order** — `avSeqUiModelEdit` pushes the "seq" checkpoint AFTER the load
     (probe-verified with F's real module: init+push-after is the working pairing; push-before
     leaves the first edit unrestorable). Probe evidence: `cache/scratch/p4/integrate/undo_probe3.mjs`.
  2. **Import checkpoints** — the UI import path AND the cdp_seq loader push a "seq" checkpoint
     after a successful load (undo must restore the pre-edit pattern; the rig's snap0 comparison
     demands it). Plus: `av_undo.js` skips plock playback writes (funnel + event belt) so playback
     never opens "params" burst entries.
- **Frozen build: `index.html` = 83e4b478… (993,145 B).**
- **Battery ALL GREEN on the frozen bytes** (logs refreshed `verify/last-*.log`): smoke **15/15** ·
  cdp_fx 27/27 · **cdp_seq 31/31** (timing mean |Δ| ≈ 3.5 ms · ZERO drift over 8 bars · swing
  +24.9 ms ≈ 16 % stepDur · prob 0/100 deterministic · p-lock 800 witnessed + base restored ·
  undo/redo deep-equal + repaint · screenshot `renders/p4-seq-suite.png`) · feel 18/18 · keys 27/27 ·
  midi 33/33 · sample 29/29 · rec 29/29. Pins moved to 83e4b478 (midi/sample/rec/fx/seq).
- **PERF GATE: running next** — bench + stress records + the close in the next commit (addendum 18).
- NEXT after the gate: **P5** (STORE — 10 packs / 580 presets + drum packs + loop packs; IDB
  install; preview renders) per the GOLDEN BUILD program; carried: **P·2 minBLEP pass**; follow-ups:
  fill control wiring, chains/scenes undo checkpoints, acid accent-flag mapping decision (flag 4),
  F's plock skip DONE. Resume phrase: **"continue anvil"**.


## Resume addendum 18 — 2026-10-07 (P4 PERF GATE records + attribution)

- **Bench (publishable metric) on 83e4b478:** `verify/bench-v7-p4-full.{log,json}` — **offline 128
  voices @ 1292.5 µs/q = 48.47 % budget** (P3 49.35 % · P2 47.1 % · P1.x 47.6 % — engine unchanged;
  the delta is run variance). Realtime published {light 64 · fat 48}; fallback spn PASS; every
  offline cell replay-stable. `verify/last-cdp_bench.*` refreshed.
- **Stress ×2** (`verify/stress-p4-run1.log` · `run2`) — both `asserts-not-met` for the SAME two
  known reasons:
  - verified-envelope: **1 delta in each run, IDENTICAL signature** (cycle 1 @ uni 3, ~6.6–18.7 s —
    the systematic cold first-cap entry, unchanged since P1.x);
  - uni>3 over-drive probe windows: the SAME five clusters as the P3 runs (cycles 3/4 · 7 · 11) with
    HOTTER magnitudes (13 / 144 deltas vs P3's 2–4 per cluster);
  - everything else PASS both runs: heap +0.2 MB · drains 15/15 · 0 page errors · ctx running ·
    coverage 27/27 cycles (+3,564 notes on/off) · driver errors 0.
- **Attribution (recorded):** environment, not the engine — (a) the engine is byte-identical to P3
  (no av_dsp/worklet changes in P4) and the bench is stable; (b) the asserted verified windows
  reproduce the exact P1.x→P3 signature; (c) **the user session was ACTIVE at the console during
  both runs** (Moddy at the machine — Discord/pythonw/audiodg live) and the metric is documented
  load-sensitive at the margin (the P2 contamination precedent); (d) the P4 page's idle cost was
  measured trivial (the seq rAF loop early-exits when the transport is stopped: two calls + one
  getElementById per frame). **Queued:** a controlled quiet-window re-run (or fold into the P·2
  minBLEP pass) if the margin matters; both raw runs stand as committed evidence.
- Pins/freeze unchanged (83e4b478). **NEXT: P5 — STORE** (10 packs / 580 presets + drum + loop
  packs; preview renders; IDB install) per the GOLDEN BUILD program. Carried: P·2 minBLEP pass;
  P4 follow-ups: fill control wiring, chains/scenes undo checkpoints, acid accent-flag decision.
  Resume phrase: **"continue anvil"**.


## P5 wave STARTED (stage 0) — 2026-10-07 (wave note `verify/_p5_wave.md`; 5 children, `deleg_4e498b21`)

- **Wave note: `verify/_p5_wave.md`** — P5 = STORE per the GOLDEN BUILD program (10 factory packs /
  580 presets + drum + loop packs; IDB install; previews; add-on modules). Staged: **stage 0 (now)**
  = 2 PF port digests + Phase-1 content (T8 authoring order); **stage 1** = store infra ports
  (store core · store UI + cdp_store rig · canonical schema + verifier · synth-card BANK select +
  shared apply core · preview audition) with briefs written AGAINST the digests; **stage 2** =
  integration → battery + cdp_store → perf gate. Phase-2/3 packs (NEON STRINGS · BLADE PADS · DEEP
  SPACE · BASS FORGE · LEAD LAB · FX & RISERS) = later waves P5.1/P5.2; PERFECT TUNINGS blocked on
  the (unbuilt) tuning engine.
- **Pinned in the note:** the `.avbank.json` pack format (one file per pack; flat patch path→value
  maps; optional `seq` = P4 pattern snapshot) + the node WITNESS every content child must run
  (worklet concat load; every patch path accepted; audible 2 s render; finite; determinism pair;
  seq validated via av_seq_core). Canonical verifier (stage 1) must re-witness ALL stage-0 presets.
- **Children — delegation `deleg_4e498b21`:** sa-0 `research/reuse/store-port-digest.md` (PF store
  read-only digest; kb-port-digest format) · sa-1 `research/reuse/pack-pipeline-port-digest.md`
  (schema/author-gate/verify_packs/preview/deploy → .avbank mapping) · sa-2 `packs/starter-100.avbank.json`
  (100) · sa-3 `packs/acid-vault.avbank.json` (64 + seq basslines) · sa-4
  `packs/techno-foundry.avbank.json` (64: kits + 32 patterns). Transcripts:
  `cache\delegation\live\deleg_4e498b21	ask-{0..4}.log`; scratch `cache/scratch/p5/<name>/`.
- **On return:** read the 2 digests → write the stage-1 orts briefs (store core/UI/rig/verifier/BANK/
  preview) into `_p5_wave.md` §4 (replace the placeholder) → dispatch stage 1 → then integration per
  the standard wave discipline + addenda 20+.
- **If resuming cold mid-P5:** read `verify/_p5_wave.md` first; check `ls packs/ research/reuse/` for
  what landed; transcripts as above; then continue from "on return". Resume phrase: **"continue anvil"**.


### P5 stage-1 DISPATCHED — 2026-10-07 (4 children; `deleg_998b1a99`; pins in `_p5_wave.md` §4b)

- **Stage-0 landed first** (commit `7c07d58`): digests `research/reuse/store-port-digest.md` (ADAPT
  store core/UI/install/index.json/bank-select; SKIP compat.json v1/wt-carry/pull-in chrome;
  13 Undetermined) + `research/reuse/pack-pipeline-port-digest.md` (PORT schema architecture +
  verifier skeleton; ADAPT to node-only strict-exit witness; preview recommendation = client-side
  OfflineAudioContext; **schema must carry range tables — AVDSP setParam silently clamps**) + packs
  `starter-100` (100) · `acid-vault` (64, 16 seq) · `techno-foundry` (64 = 32 kits + 32 patterns)
  witnessed **228/228** (determinism pairs; evidence `verify/p5-*-witness-out.*`).
- **Stage-1 pins** (`4eb3783`, `_p5_wave.md` §4b): store law (avStore* API + `avStoreSetFetch` test
  seam, IDB `av-packs-store`, LS `av-packs-ls`, idb|ls|mem, sha256-before-commit) · `packs/index.json`
  shape · apply law (avBankApplyPreset via the avApplyParam funnel; mod.macroN rides av_mod's wrap;
  seq via avSeqLoad/SetPattern/UiSync) · preview = OfflineAudioContext + avEngineBoot (audition =
  witness) · store UI mounts `#av-store-host` · verifier = node-only, strict exit,
  `verify/last-av_packs_verify.*`, `--index` regenerates index.json, must pass 228/228.
- **Children — `deleg_998b1a99`:** sa-0 `src/av_store.js` (core) · sa-1 `src/av_store_ui.js` +
  `verify/cdp_store.mjs` (rig write-only) · sa-2 `verify/av_bank_schema.mjs` +
  `verify/verify_avpacks.mjs` + `packs/index.json` · sa-3 `src/av_bank.js` (apply + BANK row +
  preview). Transcripts: `cache\delegation\live\deleg_998b1a99	ask-{0..3}.log`; scratch
  `cache/scratch/p5/<name>/`.
- **On return (integration — likely NEXT SESSION):** read the child reports → parent integration per
  the standard discipline: build.py js_parts (store_core → bank → store_ui, before app_core) ·
  app_core boot (avStoreInit/avStoreUiInit/avBankInit guarded) · body `#av-store` card +
  `#av-store-host` + `#av-synth-bank-host` · styles (returned class lists) · smoke additions ·
  rebuild → re-run child harnesses + `verify_avpacks.mjs` (228/228) + `cdp_store` (pin EXPECT_SHA) →
  FULL battery on frozen bytes → PERF GATE → commits + addenda 20+.
- **If resuming cold mid-P5:** read `verify/_p5_wave.md` + this section; `ls src/av_store*.js
  src/av_bank.js verify/av_bank_schema.mjs verify/verify_avpacks.mjs packs/` for what landed; child
  transcripts as above. Resume phrase: **"continue anvil"**.


### P5 stage-1 LANDED — 2026-10-07 (all 4 green; parent integration PENDING = next session block)

- `src/av_store.js` (895) — harness 108/108; API per §4b + extras (Get·Hydrate·OnChange·Adopt·…);
  IDB `av-packs-store` / LS `av-packs-ls`; sha256-before-commit; quota = fallback only on
  unavailability ("nothing durable → not installed"); `avStoreStatus()` shape {backend,count,
  installed,index{},net,note,dbGaveUp,adopt}.
- `src/av_store_ui.js` (1042, 50 classes) + `verify/cdp_store.mjs` (674, EXPECT_SHA null) — mount
  harness 27/27 · rig dry-run 13/13 (the rig itself is parent-run; its storeui mount-harness log
  stays in scratch — re-runnable).
- `verify/av_bank_schema.mjs` + `verify/verify_avpacks.mjs` + `packs/index.json` — **verifier RUN:
  228/228 PASS** (2790 paths · 54 seq canon · 6 warnings) · index regenerated with verified sha256s
  · strict exit · `--index` / `--only` modes · outputs `verify/last-av_packs_verify.*`.
- `src/av_bank.js` (744) — harness 63/63; apply law = every path via the CURRENT avApplyParam
  binding, `engine.kind` first, booleans→1/0, mod acceptance belt (`__avModWrap` marker); preview =
  the offline witness recipe (no seq render in v1 — documented).
- Evidence: `verify/p5-store-node-out.*` · `verify/p5-bank-node-out.log` ·
  `verify/last-av_packs_verify.*`.

**INTEGRATION BLOCK (next session; apply in ONE counted-assert script):**
1. **av_store.js one-liner:** `avStoreStatus().index` must carry the manifest `packs` entries
   (sa-1's card + the cdp_store canary read it; today the card renders its honest degraded note).
2. build.py js_parts: `av_store` → `av_bank` → `av_store_ui` (after av_seq_ui, before av_synth/
   app_core — store before bank before ui).
3. app_core boot: `avStoreInit()` → `avBankInit()` → `avStoreUiInit()` guarded + log line; wire
   `avBankRefresh()` on store change (`avStoreOnChange`) so the BANK select follows installs.
4. body.html: `#av-store` card + `#av-store-host`; `#av-synth-bank-host` div inside `#av-synth`.
5. styles.css: `avStoreUiClasses()` (50) + `avBankClasses()` lists.
6. cdp_smoke: add the store-card check (house style like the seq card check).
7. Rebuild → child harness re-runs + `verify_avpacks.mjs` (228/228) + `cdp_store` (pin EXPECT_SHA;
   mock via `avStoreSetFetch` + `localStorage['av-store-url']`) → FULL battery on frozen bytes →
   PERF GATE (quiet window if possible) → commits + addendum 20.
8. Watch items: `avStoreInstalled()` must stay SYNC (sa-3 seam — sa-0 complies); preview parity
   (no offline mod macros) documented; sa-1's rig exits early with a message if hosts are missing.


## SESSION SAVE — 2026-10-07 ~15:45 (context ~91% → NEW SESSION opens the P5 integration block)

- HEAD **`d669610`**, tree clean. P5 stage-0 + stage-1 ALL LANDED (see the two sections above);
  the ONLY remaining step is the **parent integration block** (flags 1–8 in "P5 stage-1 LANDED").
  P4 closed (frozen 83e4b478, battery green, bench-v7 128 @ 48.47%).
- **FIRST MOVES in the continued session:** read the "P5 stage-1 LANDED" section + `verify/_p5_wave.md`
  §4b; then apply flags 1–8 as ONE counted-assert script (suggested scratch path
  `cache/scratch/p5/integrate/_p5_integrate.py`) → `python3 build.py` → smoke + `verify_avpacks.mjs`
  re-run (expect 228/228) + `cdp_store` first run (pin EXPECT_SHA) → FULL battery (re-pin midi/
  sample/rec/fx/seq/store to the new sha) → PERF GATE (bench + stress, quiet window if possible) →
  commits + addendum 20+.
- **Anchor hints (verified 2026-10-07):** `src/av_store.js` `avStoreStatus()` at ~L816 — add the
  manifest entries to its `index` object (`packs: st.index ? st.index.packs : null`).
  `avStoreUiClasses()` returns 50 names (src/av_store_ui.js, search "function avStoreUiClasses");
  `avBankClasses()` returns 13 (src/av_bank.js). build.py: insert `av_store` → `av_bank` →
  `av_store_ui` between `av_seq_ui` and `av_synth` in `js_parts`. body.html: `#av-store` card after
  the `#av-seq` card; `#av-synth-bank-host` div inside `#av-synth` right after its `<h2>Synth</h2>`.
  cdp_smoke.mjs: add the store check after the P4 `seqC` block. app_core boot: after the `undoOk`
  line add `avStoreInit()` → `avBankInit()` → `avStoreUiInit()` (guarded) + `avStoreOnChange` →
  `avBankRefresh` wire + extend the boot console.log. Styles: append the store + bank class blocks
  (`av-store-*` 50 incl. `.av-pf-filter`/`.av-pf-n`/`.av-pack-*`/`.installed`/`.busy`/`.av-store-off-chip`
  families; `av-bank-*` 13).
- Resume phrase: **"continue anvil"**.

## Resume addendum 20 — 2026-10-07 (P5 wave INTEGRATED — battery ALL GREEN on 1c2f112c)

- **Parent integration landed** (ONE counted-assert script, all-or-nothing; `cache/scratch/p5/integrate/_p5_integrate.py` — 6 files): av_store.js `status.index.packs` accessor (the entry route the card + rig read) · build.py js_parts (av_store → av_bank → av_store_ui after av_seq_ui, before av_synth) · app_core (store/bank/storeUi guarded boot + `avStoreOnChange`→`avBankRefresh` wire + log; ANVIL 0.5.0 "P5 · store") · body (#av-store card + `#av-store-host`; `#av-synth-bank-host`; hero/footer) · styles (P5 block: 50 store + 13 bank classes; coverage-checked) · cdp_smoke P5 check (16 checks now).
- **Integration fix (evidence-driven) — the file:// fetch law.** Smoke run 1: 15/16 — the store's auto index kick fired a real fetch of `packs/index.json` on file:// → Chromium scheme-blocks it → 3 console errors (CORS + net::ERR_FAILED) → zero-errors FAIL. Fix in `av_store.js` at the single network choke point (`avStoreFetchUrl`): refuse file:-scheme targets when the source is real fetch (`avStoreUrlScheme` helper) — the seam, hosted http(s) and localhost all fetch as usual; no doomed request, no console noise, honest note renders. Storecore harness re-run **108/108** after the fix; smoke re-run **16/16 zero errors**.
- **cdp_store first run: 27/28** — the one failure was a rig SPEC bug (asserted `sha.bad === 'f'*64`, but the mock stores the REAL digest; the planted f-string lives in the manifest and is proven by the refusal check). Rig spec fix: assert three real distinct digests. Re-run: **28/28** + freeze pinned (`before === after === EXPECT_SHA`).
- **Frozen build: `index.html` = 1c2f112c… (1,126,117 B).** Pins moved 83e4b478 → 1c2f112c (cdp_fx/midi/rec/sample/seq + cdp_store EXPECT_SHA; two pin passes — interim 118cd934 → final after the fetch fix).
- **BATTERY ALL GREEN on the frozen bytes** (`verify/last-*.log` refreshed; log `cache/scratch/p5/integrate/battery-p5.log`): smoke **16/16** · **cdp_store 28/28** (seam mock: install → badge → IDB ground truth → remove → reinstall idempotent → offline badge → mem-chip honesty → sha-mismatch refusal; screenshot `renders/p5-store-suite.png`) · feel 18/18 · keys 27/27 · midi 33/33 · sample 29/29 · rec 29/29 · fx 27/27 · seq 31/31.
- **Node evidence on the integrated sources:** storecore 108/108 · storeui mount 27/27 · bank 63/63 · `av_bank_schema.mjs` self-check PASS (152/152 paths · 10 module sources · 0 unparsed) · **`verify/verify_avpacks.mjs` RUN: 228/228 presets PASS** (packs 3 · harness fails 0 · warnings 6 · seqShorthand 6; `last-av_packs_verify.*` regenerated).
- **PERF GATE: running next** — records + addendum 21 in the next commit.

## Resume addendum 21 — 2026-10-07 (P5 PERF GATE records + attribution; P5 CLOSED)

- **Bench (publishable) on 1c2f112c:** `verify/bench-v8-p5-full.{log,json}` — **offline 128 voices @ 1287.0 µs/q = 48.26 % budget** (P4 48.47 % · P3 49.35 % · P2 47.1 % — engine unchanged; within run variance). Realtime published {light 64 · fat 48}; fallback spn cell PASS; knee {lastPassN 128 · firstFail none · monotone true}. `last-cdp_bench.*` refreshed.
- **Stress ×2** (`stress-p5-run1.log` · `run2`; `last-cdp_stress.log` = run 2) — both `asserts-not-met` for the SAME two known reasons:
  - verified-envelope: **1 delta in each run, IDENTICAL signature** (cycle 1 @ uni 3 first-cap entry — unchanged since P1.x);
  - uni>3 over-drive probe windows (beyond the bench envelope by design): run1 = delta 23 over 41 intervals [verified-window 1 · uni>3-window 10] · run2 = delta 73 [verified 1 · uni>3 9];
  - everything else PASS both runs: heap +0.2/+0.1 MB · drains 15/15 · 0 page errors · ctx running · coverage 27/27 cycles · driver errors 0.
- **Attribution (recorded):** environment + the known minBLEP margin, NOT regression — (a) the worklet sha `6e66274e…` is **byte-identical to the P4 build** (verified via git: `git show 9bd069c:index.html`); (b) the bench is stable; (c) the asserted signature reproduces the P1.x→P4 profile exactly; (d) `query user` = moddy console **Active (idle none)** during both runs — the metric is documented load-sensitive at the margin. **P·2 minBLEP cost-optimisation stays the carried deliverable; per-wave gate P·1 satisfied.**
- **NEXT: P5.1/P5.2 content waves** (NEON STRINGS · BLADE PADS · DEEP SPACE · BASS FORGE · LEAD LAB · FX & RISERS; PERFECT TUNINGS blocked on a tuning engine) + the studio beats (docs/08) per the GOLDEN BUILD program; carried: P·2 minBLEP pass · P4 follow-ups (fill control wiring, chains/scenes undo checkpoints, acid accent-flag decision). Resume phrase: **"continue anvil"**.

## P5.1 wave DISPATCHED — 2026-10-07 (content wave: NEON STRINGS · BLADE PADS · DEEP SPACE)

- Contract: **`verify/_p5b_wave.md`** — scope = T8 §12 Phase 2 (48/56/40 presets); format/witness/gates INHERIT `verify/_p5_wave.md` §1/§2 unchanged; children self-verify with the canonical verifier (`node verify/verify_avpacks.mjs --only <id>`, strict exit); NO `seq` fields this wave.
- Children — delegation **`deleg_3d52b269`** (3 in parallel; results re-enter the session): sa-0 `packs/neon-strings.avbank.json` · sa-1 `packs/blade-pads.avbank.json` · sa-2 `packs/deep-space.avbank.json`. Transcripts: `C:\Users\Moddy\AppData\Local\hermes\profiles\deepseek\cache\delegation\live\deleg_3d52b269\task-{0..2}.log`; scratch `cache/scratch/p5b/<name>/`.
- **On return:** FULL canonical verify (expect **372/372**) → `node verify/verify_avpacks.mjs --index` regenerate `packs/index.json` (6 packs) → commit + addendum 22. **NO rebuild / battery / pins** — `index.html` untouched (packs are runtime data; the verifier is the wave gate).
- **If resuming cold mid-P5.1:** read `verify/_p5b_wave.md`; `ls packs/` for what landed; per pack run `node verify/verify_avpacks.mjs --only <id>`; transcripts as above; integrate per `_p5b_wave.md` §3.

## Resume addendum 22 — 2026-10-07 (P5.1 content wave LANDED + integrated — 372/372; the store now serves 6 packs)

- **Children landed** (deleg_3d52b269, all completed, ~5 min wall): `packs/neon-strings.avbank.json` (48 presets · 32,309 B · sha `090ae6b5…`) · `packs/blade-pads.avbank.json` (56 · 57,129 B · sha `af3726a8…`) · `packs/deep-space.avbank.json` (40 · 47,520 B · sha `5b8e1762…`). Each child self-verified with the canonical verifier (`--only`, strict exit); scratch generators retained in `cache/scratch/p5b/<name>/`.
- **Parent re-verification (THE gate):** FULL canonical verify on the integrated tree — **372/372 presets PASS** (6 packs · harness fails 0 · preset fails 0 · warnings 6 · seqShorthand 6 = the stage-0 packs only; P5.1 packs carry no seq). Independent `sha256sum` cross-check of all three files matches the children's claims exactly.
- **`packs/index.json` regenerated (`--index`, strict exit)** — 6 entries: acid-vault 64 · blade-pads 56 · deep-space 40 · neon-strings 48 · starter-100 100 · techno-foundry 64. **The store now serves 372 presets.**
- Design notes (children's reports): NEON STRINGS = string-kind core, NYLON/KOTO/PREPARED/GLASS/HYBRID (hybrids encode the pair-alongside recipe; string voices own the per-sample chain by design) · BLADE PADS = VA ensembles (bp-vowel formant translation, unison 4–7 wide, 1.9–3.4 s swells, ensemble chorus + plate/fdn verbs) · DEEP SPACE = WT beds + sub + slow-LFO/macro motion + long verbs (4 grain atmospheres on sample slot 0, the starter-GRAIN contract).
- **No rebuild / battery / pins** — `index.html` untouched by design (packs are runtime data; the canonical verifier is the wave gate).
- **NEXT: P5.2** (BASS FORGE · LEAD LAB · FX & RISERS → 548 presets) then PERFECT TUNINGS (blocked on the tuning engine); carried: P·2 minBLEP pass · P4 follow-ups (fill control wiring, chains/scenes undo checkpoints, acid accent-flag decision). Resume phrase: **"continue anvil"**.


## P5.2 wave DISPATCHED — 2026-10-07 (content wave: BASS FORGE · LEAD LAB · FX & RISERS)

- Contract: **`verify/_p5c_wave.md`** — scope = T8 §12 Phase 3 (64/64/48 presets); child law = `verify/_p5b_wave.md` §2; format/witness/gates INHERIT `verify/_p5_wave.md` §1/§2; no `seq` fields.
- Children — delegation **`deleg_79138ec1`** (3 in parallel): sa-0 `packs/bass-forge.avbank.json` · sa-1 `packs/lead-lab.avbank.json` · sa-2 `packs/fx-risers.avbank.json`. Transcripts: `C:/Users/Moddy/AppData/Local/hermes/profiles/deepseek/cache/delegation/live/deleg_79138ec1/task-{0..2}.log`; scratch `cache/scratch/p5c/<name>/`.
- **On return:** FULL canonical verify (expect **548/548**) → `--index` (9 packs) → commit + addendum 23. No rebuild/battery/pins (index.html untouched).
- **If resuming cold mid-P5.2:** read `verify/_p5c_wave.md`; `ls packs/`; per pack `node verify/verify_avpacks.mjs --only <id>`; integrate per §2.


## Resume addendum 23 — 2026-10-07 (P5.2 content wave LANDED + integrated — 548/548; the store now serves 9 packs)

- **Children landed** (deleg_79138ec1, all completed, ~7 min wall): `packs/bass-forge.avbank.json` (64 · 58,828 B · sha `0245ea30…`) · `packs/lead-lab.avbank.json` (64 · 81,753 B · sha `c3977c4a…`) · `packs/fx-risers.avbank.json` (48 · 62,086 B · sha `f2145214…`). All self-verified with the canonical verifier (`--only`, strict, run twice); scratch generators in `cache/scratch/p5c/<name>/`.
- **Parent re-verification (THE gate):** FULL canonical verify — **548/548 presets PASS** (9 packs · harness fails 0 · preset fails 0 · warnings 6 · seqShorthand 6 = the stage-0 packs only). Independent `sha256sum` cross-check matches every child claim.
- **`packs/index.json` regenerated** — 9 entries: acid-vault 64 · bass-forge 64 · blade-pads 56 · deep-space 40 · fx-risers 48 · lead-lab 64 · neon-strings 48 · starter-100 100 · techno-foundry 64. **The store serves 548 presets.**
- Design notes: BASS FORGE (SUB/REESE/HYBRID/ACID-X/GROWL; va 50 + acid 14; "FM" realised as layered-VA hybrids — no FM operator ships, documented) · LEAD LAB (UNISON/SUPERSAW/SOLO/PUNCH/EXPRESSIVE/DIGITAL; unison 2–7, macros on 21/64) · FX & RISERS (SWEEPS/RISERS/IMPACTS/DOWN/NOISE-ART; arc-probe-tuned — risers verified rising, downlifters darkening; 4 presets with >2 s arcs documented; one pre-ship rename "Gravity Well"→"Gravity Sink" avoiding a cross-pack name dup).
- **P5 content COMPLETE except PERFECT TUNINGS** (32 presets — blocked on the tuning engine, not built). 9 packs × 548 presets live; the T8 580 day-one target closes when the tuning engine + PERFECT TUNINGS land.
- **NEXT SESSION: the GOLDEN BUILD studio waves** — read `docs/08` (studio mandate + competitor matrix) + the program list in the "GOLDEN BUILD — owner directive" section above; candidates: CODE section, walkthrough/help, PF-grade popout keyboard, pro deck display, STEM export, maximal modules/racks — then P6-P7 (share/cloud/polish → deploy + live verify + owner pass). Carried: P·2 minBLEP pass · P4 follow-ups (fill control wiring, chains/scenes undo checkpoints, acid accent-flag decision) · PERFECT TUNINGS (tuning engine). Resume phrase: **"continue anvil"**.

## P6 wave STARTED — 2026-10-07 (DELIVER: STEM export suite + MIDI I/O + WAV/ZIP codecs + Deliver card; 4 children, `deleg_fd67dfba`)

- **Offline render platform probe PASSED** (parent-run before pinning): OfflineAudioContext + `avEngineBoot` offline ladder works (tier `worklet:data`); per-boundary `suspend()/resume()` note injection works (silence `0.00e+0` before the injected note · held note RMS `9.65e-2` · onset on 128-frame boundaries · 2 s render ≈ 35 ms). Suspend times resolve at the next render-quantum boundary (≤64 frames ≈ 1.33 ms quantization). Evidence: `verify/p6-offline-probe-out.log`. Consequence: boundary-quantized injection is the pinned bounce timing law — identical schedule across parts ⇒ stems mutually aligned by construction.
- **Wave note: `verify/_p6_wave.md`** — §1 file ownership · §2 pinned interfaces (av_wavio/av_zipc/av_mid/av_bounce/av_deliver_ui) · §3 laws (mirror patch replay, clone-only sample sends, determinism, memory) · §4 rig proof list (`cdp_bounce.mjs`) · §5 parent integration · §6 watch items. Scope = docs/08 S4 + GOLDEN BUILD #4/#5/#58/#77-partial (the first studio wave).
- Children — delegation `deleg_fd67dfba` (4 in parallel, background): sa-0 `src/av_bounce.js` + rig `verify/cdp_bounce.mjs` (WRITE-ONLY) · sa-1 `src/av_mid.js` (SMF type-1 write/parse/pattern-map) · sa-2 `src/av_wavio.js` + `src/av_zipc.js` (WAV 16/24/32f + ZIP store + CRC32) · sa-3 `src/av_deliver_ui.js` (card + one-press pipeline + naming + README + save). Transcripts: `cache\delegation\live\deleg_fd67dfba\task-{0..3}.log`; scratch `cache/scratch/p6/<name>/`.
- **On return (parent integration — `_p6_wave.md` §5):** read child reports → ONE counted-assert script (`cache/scratch/p6/integrate/_p6_integrate.py`): build.py js_parts `av_wavio → av_zipc → av_mid → av_bounce → av_deliver_ui` (after av_store_ui, before av_synth) · body `#av-deliver` card + `#av-deliver-host` + hero/footer copy · styles deliver block (child class lists, coverage-checked) · app_core guarded `avDeliverUiInit()` boot + version `0.6.0` "P6 · deliver" · cdp_smoke deliver-card check (17 checks). Then rebuild → node re-runs + `cdp_bounce.mjs` first run (pin EXPECT_SHA; re-run) → FULL battery (re-pin midi/sample/rec/fx/seq/store/bounce) → PERF GATE (bench + stress) → commits + addendum 24 + README + **python artifact witness** on the rig-saved zip (`zipfile` + `wave`). 
- **If resuming cold mid-P6:** read `verify/_p6_wave.md` + this section; `ls src/av_bounce.js src/av_mid.js src/av_wavio.js src/av_zipc.js src/av_deliver_ui.js verify/cdp_bounce.mjs` for what landed; child transcripts as above; continue from "on return". Resume phrase: **"continue anvil"**.

## Resume addendum 24 — 2026-10-07 (P6 DELIVER wave INTEGRATED + CLOSED — 877d4d35; battery ALL GREEN; perf gate recorded; one-press STEM export ships)

- Wave `verify/_p6_wave.md` (+ **Amendment 1**): 4 children (`deleg_fd67dfba`) → `src/av_bounce.js` (817, p6.1) · `src/av_mid.js` (690) · `src/av_wavio.js` (235) + `src/av_zipc.js` (270) · `src/av_deliver_ui.js` (1323) + write-only rig `verify/cdp_bounce.mjs` (640). Parent: ONE counted-assert integration (5 files) + ONE probe-evidenced fix cycle.
- **The fix (Amendment 1):** first rig run 26/31 — the 4-track master render was nondeterministic/glitchy (probe: 5 identical calls, 5 hashes; lost/stuck notes) while single-track stems were byte-identical. Root cause: bare `suspend → post messages → resume` races message delivery against the render for multi-message bins. Cure (probe-verified): a **per-boundary delivery barrier** — `avBounceBarrier` (stats FIFO round trip, `AV_BOUNCE_SYNC_MS 800`) between the message post and `resume()`; 15/15 syncs resolved while suspended, two runs byte-identical, ~30% faster renders. Rig SPEC fixes (strength kept, documented): onset bound 0..96 / spread ≤ 64; stem-vs-master |Δ| ≤ 96; WAV determinism via `dither:false`; stats check also requires `barrierFail === 0` and `syncs ≥ suspends`.
- **Frozen build: `index.html` = 877d4d35… (1,285,611 B).** Battery ALL GREEN on the frozen bytes: smoke **17** · cdp_bounce **32** (determinism identical · P-lock witness · MIDI round-trip · zip CRC walk · deliver e2e + CDP download landed, file sha === returned sha) · store 28 · feel 18 · keys 27 · midi 33 · sample 29 · rec 29 · fx 27 · seq 31. Pins 877d4d35 (midi/sample/rec/fx/seq/store/bounce).
- **Artifact witness (parent, python):** zip CRC walk ALL OK · 11 entries (5 WAVs 768,044 B each · 5 SMF · README) · WAVs valid 16-bit/48k stereo (4.0 s = 2 s loop + 2 s tail, non-silent) · SMF fmt 1 / 5 tracks / PPQ 480 · README carries key/naming. Zip sha `93ac004e64aacff1…`; dir `%TEMP%\anvil-bounce-dl-1791357524175`.
- **PERF GATE:** `verify/bench-v9-p6-full.{log,json}` — realtime published **{light 64 · fat 64}** (fat up from 48; ratio 0.998) · offline **128 voices @ 1303.2 µs/q = 48.87 % budget** (P5 1287.0 / 48.26 %; engine byte-identical — run variance) · knee monotone (lastPass 128). Stress ×2 (`stress-p6-run1.log` · `stress-p6-run2.log`): both `asserts-not-met` with the known profile — run1: verified-envelope 1 delta (cycle 1 @ uni 3 cold-start) + uni>3 probe windows (delta 18 / 41 intervals); run2 (busier machine): envelope 4 entries (cold-start + cycles 5/8) + uni>3 windows (delta 42). All else PASS both runs: heap +0.1/+0.2 MB · drains 15/15 · 0 page errors · ctx running · coverage 27/27 · driver errors 0. Attribution: known margin + load; per-wave gate satisfied.
- **Runner lesson (carry):** the gate chain's first background attempt was flaky under the agent runner (bench/stress1 exited in <1 s; stress2 hung at t=45 s). Dependable path: launch each long rig via hidden detached `Start-Process` (node + redirected logs) and poll the log for the RESULT marker in bounded foreground loops. Recorded so future waves skip the flake.
- **NEXT SESSION — the GOLDEN BUILD studio continuation** (docs/08): remaining waves = STUDIO S1–S3 (record core: mic/line audio-in + takes/sessions + mix/master), deck display (#15), PF-grade popout keyboard, CODE section (#81), walkthrough/help (#20/#45/#80), maximal modules/racks (#42/#60/#64–#72), then P6 platform (share links #18, PWA #78, FSA remainder, autosave #76, bridges #82, video #83) → P7 polish (#79) → deploy + live verify + owner pass. Carried: P·2 minBLEP pass · P4 follow-ups · PERFECT TUNINGS (tuning engine). Resume phrase: **"continue anvil"**.

## S1 wave STARTED — 2026-10-07 (RECORD CORE: audio input · metronome + count-in · lap takes · Studio card; 4 children, `deleg_a723c5af`)

- **Media-input platform probe PASSED** (parent, pre-contract; evidence `verify/s1-media-probe-out.log`): file:// is a secure context; `getUserMedia({audio})` resolves under the fake-media flags; 3 labeled fake inputs enumerate; the fake device is a **BEEP TRAIN** (nonzero 1934/53248 ≈ 3.6 %, peak 1.13) — rigs assert beeps, never continuous audio.
- **Wave note: `verify/_s1_wave.md`** — §0 probe facts · §1 ownership · §2 pinned interfaces (av_input/av_metro/av_takes/av_studio_ui) · §3 laws (same-ctx input law · monitor default OFF · clicks→master only · recording tap = input-gain output · block-rate writes) · §4 parent integration · §5 watch items. Scope = docs/08 **S1** (the studio record core); S2 sessions + S3 mix/master stay for later waves.
- Children — delegation `deleg_a723c5af` (4 in parallel): sa-0 `src/av_input.js` (getUserMedia → input gain → monitor/master law) · sa-1 `src/av_metro.js` (lookahead click scheduler + count-in, phase-aligned to the transport) · sa-2 `src/av_takes.js` + rig `verify/cdp_studio.mjs` (WRITE-ONLY; lap-split recorder + WAV export) · sa-3 `src/av_studio_ui.js` (Studio card: INPUT/TRANSPORT/TAKES). Transcripts: `cache\delegation\live\deleg_a723c5af\task-{0..3}.log`; scratch `cache/scratch/s1/<name>/`.
- **On return (parent integration — `_s1_wave.md` §4):** read child reports → ONE counted-assert script: build.py js_parts (av_input → av_metro → av_takes → av_studio_ui after av_deliver_ui, before av_synth) · body `#av-studio` card + host + hero/footer · styles block (child class lists, coverage-checked) · app_core guarded boots + version `0.7.0` "S1 · record core" · cdp_smoke studio-card check (→18). Then rebuild → node re-runs + `cdp_studio.mjs` first run (pin EXPECT_SHA; re-run) → FULL battery (re-pin all) → PERF GATE (bench + stress) → commits + addendum 25 + README.
- **If resuming cold mid-S1:** read `verify/_s1_wave.md` + this section; `ls src/av_input.js src/av_metro.js src/av_takes.js src/av_studio_ui.js verify/cdp_studio.mjs` for what landed; child transcripts as above; continue from "on return". Resume phrase: **"continue anvil"**.
- **UPDATE — children LANDED (all 4 green, parent-re-verified; checkpoint `3dfd9c8`):** av_input 503 (195/195) · av_metro 771 (243/243) · av_takes 780 (52/52) + rig `cdp_studio.mjs` 667 (write-only by design) · av_studio_ui 1589 (305/305). Session stopped here at ~89 % context — **NEXT BLOCK = the parent integration per §4** (counted-assert script → rebuild → `cdp_studio.mjs` first run + pin → FULL battery → PERF GATE → commits + addendum 25). Integration watch-outs (child undetermined lists): tolerant field discovery is already built into the rig/UI (avInputState monitor field · avMetroState().clicks {t,accent} shape · studio selectors — first rig run may surface mismatches); device switching needs a pinned `avInputEnable(deviceId)` extension only if wanted; count-in refusal does NOT block recording (documented choice); SPN deprecation notice level vs the zero-error contract (warnings tolerated).

## SESSION SAVE — 2026-10-07 ~19:05 (context ~91 % → NEW SESSION opens the S1 integration block)

- **HEAD `3dfd9c8`** (this save committed on top; chain: `3dfd9c8` S1 children LANDED · `6abf636` P6 bounce log · `8cce3d6` P6 wave CLOSED). Tree clean except `?? cache/` (scratch, intentionally untracked).
- **Nothing is running.** All 4 S1 children COMPLETED (reports: `cache\delegation\live\deleg_a723c5af\task-{0..3}.log` + the consolidated batch text in this session's transcript/state.db). No background processes; the P6 gate chain finished earlier (records committed).
- **Landed + parent-verified (committed):** `src/av_input.js` 503 · `src/av_metro.js` 771 · `src/av_takes.js` 780 · `src/av_studio_ui.js` 1589 · `verify/cdp_studio.mjs` 667 (**WRITE-ONLY — never executed yet**) · `verify/_s1_wave.md` · `verify/s1-media-probe-out.log`. Parent re-ran all four node harnesses green (195/195 · 243/243 · 52/52 · 305/305). **NOT compiled:** the new symbols are absent from the built file (`grep -c avInputEnable index.html` → 0) — the integration rebuild is the next block.
- **CONSTRAINTS (verbatim, still in force):** full build permission ("permission to build to the final product… no check-in pauses") · waves stay battery-gated (lab → battery → frozen bytes) · no console windows on Moddy's desktop (hidden spawns only) · one writer per file · ask before installs · owner reviews release copy before publish.
- **RESUME CHECKLIST (literal first moves in the next session):**
  1. `cd C:\Users\Moddy\anvil && git log --oneline -3 && git status --short` — expect this save at HEAD, only `?? cache/`. Process census (expect 0): `powershell -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node|msedge' -and $_.CommandLine -like '*anvil*' }).Count"`.
  2. Read `verify/_s1_wave.md` (§0/§4 + watch-outs) + this section.
  3. Torn-file pre-flight: `node --check src/av_input.js src/av_metro.js src/av_takes.js src/av_studio_ui.js` + re-run the four scratch harnesses (`cd cache/scratch/s1/input && node input_harness.mjs`; same for metro/takes/ui).
  4. ONE counted-assert integration script (`cache/scratch/s1/integrate/`) per §4: build.py js_parts (av_input → av_metro → av_takes → av_studio_ui after av_deliver_ui, before av_synth) · body `#av-studio` card + `#av-studio-host` after `#av-deliver` (+ hero/footer copy) · styles block from the children's class lists (coverage-checked; `avMetroClasses()` returns [] — metro owns no DOM) · app_core guarded `avInputInit/avMetroInit/avTakesInit/avStudioUiInit` + version `0.7.0` "S1 · record core" · cdp_smoke studio-card check (→ 18).
  5. `python3 build.py` → new sha → `node verify/cdp_studio.mjs > verify/last-cdp_studio.log 2>&1` (FIRST run, EXPECT_SHA null). Triage failures per the rig SPEC-fix law (fix the expectation to the check's intent; patch the app only for real misbehaviour). Then pin EXPECT_SHA and re-run.
  6. Re-pin the battery to the new sha (`verify/cdp_{midi,sample,rec,fx,seq,store,bounce}.mjs` freeze constants) → FULL battery, one rig at a time, redirected to `verify/last-*.log`.
  7. PERF GATE: bench + stress ×2 via **hidden detached `Start-Process` + log-marker polling** (the runner lesson — long foreground calls die ~420 s). Copy the bench record to `verify/bench-v10-s1-full.{log,json}`; keep `stress-s1-run1/2.log`.
  8. Commits (wave-close style) + **addendum 25** + README status + Mnemosyne task-progress set + skill update if any lesson lands.
- **Watch-outs (child Undetermined lists):** tolerant field discovery everywhere (avInputState monitor field · avMetroState().clicks {t,accent} shape · studio selectors — the first rig run may surface naming mismatches) · count-in refusal does NOT block recording (documented choice) · device switching needs `avInputEnable(deviceId)` only if wanted · SPN deprecation notice level vs the zero-error smoke contract (warnings tolerated) · monitor defaults OFF (pinned safety law) · fake-device = beep train (assert pips, never continuous).
- **Carried:** S2 sessions (#76 autosave/recovery, #52 backup) · S3 mix/master (sends #69, master chain #70, LUFS auto-mix #49) · deck (#15) · popout keyboard · CODE (#81) · walkthrough/help (#20/#45/#80) · max modules · platform (share/cloud/PWA/FSA/bridges/video) · P7 polish + deploy + owner pass · P·2 minBLEP pass · P4 follow-ups · PERFECT TUNINGS. Resume phrase: **"continue anvil"**.

## Resume addendum 25 — 2026-10-07 (S1 wave INTEGRATED + CLOSED — battery ALL GREEN on 75c9c2eb; perf gate recorded; the record core ships)

- **Parent integration landed** (ONE counted-assert script, all-or-nothing; `cache/scratch/s1/integrate/_s1_integrate.py` — 10 edits in 5 files): build.py js_parts (av_input → av_metro → av_takes → av_studio_ui after av_deliver_ui, before av_synth) · body `#av-studio` card + `#av-studio-host` (+ hero/footer copy) · styles S1 block (69-class coverage via `css_coverage.mjs`) · app_core ANVIL **0.7.0 "S1 · record core"** + guarded input/metro/takes/studioUi boots + boot-log fields · cdp_smoke S1 studio check (**18 checks**). Commit `87981e3`.
- **Frozen build: `index.html` = 75c9c2eb… (1,448,104 B).** Pins 877d4d35 → 75c9c2eb (8 files; `_s1_pins.py`).
- **cdp_studio first run 35/36 → ONE rig SPEC fix (probe-evidenced):** step-4 count-in now runs with the metronome OFF and asserts ring delta ≥ 8 AND planner pushes ≥ 8. Probe `cache/scratch/s1/integrate/metro_probe.mjs`; evidence `verify/s1-metro-countin-probe-out.log`: with the train running, the count-in's first click can share the SAME 128-frame render quantum as the just-planned train click — a duplicate timestamp the set-difference undercounted (7 "new" for a full 8); app honest in both flows (clean count-in: 8 pushes @ exact 0.5 s spacing, resolves 4050.7 ms). Re-run **36/36** → pinned **37/37**.
- **BATTERY ALL GREEN on the frozen bytes** (`verify/last-*.log` refreshed; log `cache/scratch/s1/integrate/battery-s1.log`): smoke **18** · studio **37** · feel 18 · keys 27 · midi 33 · sample 29 · rec 29 · fx 27 · seq 31 · store 28 · bounce 32.
- **PERF GATE recorded** (hidden-detached `perf-gate-s1.sh`; `query user` = moddy console Active during run1, noted): bench `bench-v10-s1-full.{log,json}` — **128 voices @ 1319.0 µs/q = 49.46 % budget** (P6 1303.2/48.87 · P5 1287.0/48.26 — within run variance); **worklet sha `6e66274e…` byte-identical to the P6 build** (engine untouched); realtime published {light 64 · fat 64}, ratio 0.999, 0 invalid reads; knee monotone (lastPass 128). Stress ×2 (`stress-s1-run1.log` · `run2`; `last-cdp_stress.log` = run 2) — both `asserts-not-met` for the SAME two known reasons: verified-envelope **1 delta in each run, IDENTICAL signature** (cycle 1 @ uni 3 · run1 6.639–18.638 s · run2 6.654–18.645 s — the cold first-cap entry, unchanged since P1.x) + uni>3 over-drive probe windows (run1 total delta 31 [verified 1 · uni>3 9] · run2 total 65 [verified 1 · uni>3 10]); all else PASS both runs (heap +0.6/+0.1 MB · drains 15/15 · 0 page errors · ctx running · 27/27 cycles · +3,564 notes on/off · driver errors 0). Attribution: known minBLEP margin + load — not a regression; P·1 satisfied, **P·2 minBLEP pass stays carried**.
- Runner lessons recorded in the skill: hidden-detach `Start-Process` needs a SINGLE `-ArgumentList` element (array join = bare space → `'-c','cd … && …'` silently no-ops); PS `-Command` containing `$_` must be bash-single-quoted; count-in/click-ring rig method (measure metro-OFF + assert planner pushes).
- **NEXT: the next studio wave (docs/08)** — S2 sessions (#76 autosave/recovery · #52 backup) · S3 mix/master (sends #69 · master chain #70 · LUFS auto-mix #49) · deck (#15) · popout keyboard · CODE (#81) · walkthrough/help (#20/#45/#80) — then max modules / platform (share/cloud/PWA/FSA/bridges/video) → P7 polish → deploy + live verify + owner pass. Carried: S2/S3 · deck · popout · CODE · help · max modules · platform · P7+deploy · P·2 minBLEP pass · P4 follow-ups · PERFECT TUNINGS. Resume phrase: **"continue anvil"**.

## S2 wave DISPATCHED — 2026-10-07 (4 children; contract `verify/_s2_wave.md`, commit `52e0a46`)

- Scope: **sessions persist** (docs/08 §1 "S2 · TAKES & SESSIONS", sessions half): session snapshots + versions (16-ring) + autosave/recovery (#76) + the full backup zip (#52). Take lanes / pick-best comping lite / trims + crossfades = **S2.1** (split out, later wave).
- Children — delegation **`deleg_0b46bc09`** (4 in parallel, background): sa-A `src/av_session.js` (core + IDB `av-sessions-store`) · sa-B `src/av_backup.js` (+ a store-method zip READER) · sa-C `src/av_session_ui.js` (Sessions card) · sa-D `verify/cdp_sessions.mjs` (WRITE-ONLY rig). Transcripts: `cache\delegation\live\deleg_0b46bc09\task-{0..3}.log`; scratch `cache/scratch/s2/<name>/`.
- **On return (parent integration per `_s2_wave.md` §4):** ONE counted-assert script (`cache/scratch/s2/integrate/_s2_integrate.py`) — build.py js_parts (av_session → av_backup → av_session_ui after av_studio_ui, before av_synth) · body `#av-sessions` card + `#av-sessions-host` after `#av-studio` (+ hero/footer) · styles block (coverage-checked) · app_core **0.8.0 "S2 · sessions"** + guarded avSessionInit/avBackupInit/avSessionUiInit boots · cdp_smoke sessions check (→ 19) → rebuild → node re-runs + `cdp_sessions` first run (pin EXPECT_SHA) → FULL battery (re-pin all) → **python artifact witness** on the rig-downloaded backup zip (zipfile walk + manifest sha cross-check + WAV validity) → PERF GATE (bench + stress ×2, hidden-detached) → commits + addendum 26.
- **If resuming cold mid-S2:** read `verify/_s2_wave.md` + this section; `ls src/av_session.js src/av_backup.js src/av_session_ui.js verify/cdp_sessions.mjs` for what landed; child transcripts as above. Resume phrase: **"continue anvil"**.

## Resume addendum 26 — 2026-10-07 (S2 SESSIONS INTEGRATED + CLOSED — battery ALL GREEN on 31087322; perf gate raw + A/B attribution; sessions persist ships)

- Children `deleg_0b46bc09` (4 parallel, ~15 min): sa-A `src/av_session.js` 1624 (harness 96/96) · sa-B `src/av_backup.js` ~900 (63/63; store-method zip READER + additive restore) · sa-C `src/av_session_ui.js` 1599 (236/236) · sa-D `verify/cdp_sessions.mjs` 774 (write-only). Parent re-ran all three harnesses green.
- **Parent integration landed** (ONE counted-assert script, 5 files; `cache/scratch/s2/integrate/_s2_integrate.py`): build.py js_parts (av_session → av_backup → av_session_ui after av_studio_ui, before av_synth) · body `#av-sessions` card + host (+ hero/footer) · styles S2 block (53-class coverage) · app_core **0.8.0 "S2 · sessions"** + guarded boots + log fields · cdp_smoke S2 check (**19 checks**). Commit `3d9050f`.
- **Frozen build: `index.html` = 31087322… (1,635,639 B).** Pins 75c9c2eb → 31087322 (9 files incl. studio + sessions).
- **cdp_sessions first run 38/40 → ONE rig SPEC fix:** the no-error predicates now accept the house `error:null` receipts (`X.error === undefined || X.error === null`; error strings still fail). Re-run 40/40 → pinned **41/41** (round-trip · versions/restore · autosave→reload→recovery · sessions survive reload · backup e2e + a downloaded-file leg sha-matching the built buffer).
- **BATTERY ALL GREEN on the frozen bytes** (12 suites; `cache/scratch/s2/integrate/battery-s2.log`; studio ran as a second pass — the battery script initially dropped it, caught by the pin-stray scan): smoke **19** · sessions **41** · studio 37 · feel 18 · keys 27 · midi 33 · sample 29 · rec 29 · fx 27 · seq 31 · store 28 · bounce 32.
- **Artifact witness (python)** on the rig-downloaded backup zip: CRC walk ALL OK · manifest sha256 2/2 verified · sessions.json v1 (1 session) — `verify/s2-backup-witness-out.log`.
- **PERF GATE — RAW + ATTRIBUTION (the machine was HEAVILY LOADED: moddy console Active, CPU sampled 14–33%, stress deltas 1052/3654 vs the 31/65 quiet baseline):** bench `bench-v11-s2-full.{log,json}` reads **96 voices (first-fail 128 @ 1441.6 µs/q — the 128-cell sits only ~1% under the cap even when quiet, so load pushes it over)**; realtime {light 64 · fat 48}; stress ×2 (`stress-s2-run1/2.log`) `asserts-not-met` with extra mid-run verified-window clusters (cycles 4/8/22/24 — load signature). **A/B under the same conditions — `verify/bench-ab-s1-offline.{log,json}` · `bench-ab-s2-offline.{log,json}` (offline-only): the S1 CONTROL bytes publish the SAME knee 96 / first-fail 128 (n=128 @ 1811.8 µs/q — worse than S2's 1412.4) → ENVIRONMENT, not a build regression; worklet sha `6e66274e…` byte-identical to the P1.x lineage.** `last-cdp_bench.*` restored to the S2 full run. **Queued: a quiet-window bench re-run (expect 128 restored); P·1 gate satisfied raw; P·2 minBLEP pass stays carried.**
- Runner/rig lessons recorded (skill): bench A/B attribution via `--offline-only` on the previous frozen bytes back-to-back; battery set completeness (run EVERY pinned suite, incl. the previous wave's newest rig).
- **NEXT: S2.1 take lanes/comping/trims+crossfades, or S3 mix/master (sends #69 · master chain #70 · LUFS auto-mix #49) / deck (#15) / popout keyboard / CODE (#81) / walkthrough-help — per docs/08.** Carried: quiet-window bench re-run · P·2 minBLEP pass · P4 follow-ups · PERFECT TUNINGS. Resume phrase: **"continue anvil"**.

## SESSION SAVE — 2026-10-07 ~21:00 (S2.1 dispatched; children in flight — a continued session opens the S2.1 integration block)

- State at save: **S2 SESSIONS CLOSED** (addendum 26; close commit `5e66ef5`; frozen `31087322` = 1,635,639 B; battery green 12 suites; perf gate raw + A/B attribution = ENVIRONMENT — quiet-window bench re-run carried). **S2.1 contract committed `c491710`** (`verify/_s2b_wave.md`).
- **ALL S2.1 CHILDREN LANDED + COMMITTED (final — supersedes the earlier in-flight status):** sa-A `src/av_comp.js` (894; harness **87/87** re-verified) · sa-B `src/av_comp_ui.js` (1459; **248/248** re-verified) — committed `24530f9`; sa-C `verify/cdp_comp.mjs` (920 lines; `node --check` OK; 40 planned checks; its own scratch harness executed the shipped expected() against the real `src/av_comp.js` **10/10**) — committed with this save. **NOTHING RUNNING — no background jobs, no live subagents.** Transcripts `cache\delegation\live\deleg_{45ab8025,5029ff67}\task-*.log`; scratch `cache/scratch/s2b/<name>/`.
- **RESUME CHECKLIST (next session):**
  1. `cd C:\Users\Moddy\anvil && git log --oneline -3 && git status --short` — expect this save at HEAD; `?? cache/`; the 3 child files present (possibly uncommitted).
  2. `ls src/av_comp.js src/av_comp_ui.js verify/cdp_comp.mjs` — landed? → read the child report tails (transcripts above) + pre-flight: `node --check` each + re-run the node harnesses from the two scratch dirs.
  3. Parent integration per `verify/_s2b_wave.md` §4 — ONE counted-assert script (`cache/scratch/s2b/integrate/_s2b_integrate.py`): build.py js_parts (`av_comp` → `av_comp_ui` after `av_session_ui`, before `av_synth`) · body `#av-comp` card + `#av-comp-host` after `#av-sessions` (+ hero/footer copy) · styles block (coverage-checked via the avCompUiClasses list) · app_core **0.9.0 "S2.1 · takes & comping"** + guarded `avCompInit`/`avCompUiInit` boots + log fields · `cdp_smoke.mjs` comp-card check (**→ 20 checks**).
  4. Rebuild → smoke → `cdp_comp.mjs` first run (pin EXPECT_SHA; re-run) → **FULL battery — ALL 13 pinned suites** (smoke · studio · sessions · comp · feel · keys · midi · sample · rec · fx · seq · store · bounce; re-pin every file — keep the complete suite list, dropped suits are the S2 lesson) → **PERF GATE** (bench + stress ×2, hidden-detached + marker polling; if the machine is loaded again → record raw + A/B only if the bench drops) → commits + addendum 27.
- Carried: **quiet-window bench re-run** (S2 gate ran loaded; A/B proven environment; expect 128 restored) · P·2 minBLEP pass · P4 follow-ups · PERFECT TUNINGS · then S3 mix/master / deck / popout keyboard / CODE / help. Resume phrase: **"continue anvil"**.
- **LANDING UPDATE — 2026-10-07 ~21:10:** sa-A `src/av_comp.js` (894 lines; harness **87/87** re-verified) + sa-B `src/av_comp_ui.js` (1459; **248/248** re-verified) **LANDED GREEN + COMMITTED** (`24530f9`; not yet in index.html — the integration rebuild ships them). **sa-C `verify/cdp_comp.mjs` died pre-write** (its turn ended at "writing the rig"; empty scratch, no file) — **RE-DISPATCHED** as delegation `deleg_5029ff67` (same contract brief + a write-the-file-first amendment). On its landing: run the resume checklist §3–§4 unchanged (pre-flight includes `node --check verify/cdp_comp.mjs`). **— RESOLVED ~21:20: it LANDED (920 lines, `node --check` OK, 40 checks planned); ALL children done, nothing running (see the final landing line above and the save commit).**

## ADDENDUM 27 — 2026-10-07 (S2.1 TAKES & COMPING INTEGRATED + CLOSED — battery ALL GREEN on `0f79ebc2`; perf gate raw + A/B attribution; rig SPEC fixes)

- **INTEGRATED + checkpoint `46c6ca6`:** ONE counted-assert script (11 edits, all-or-nothing) — build.py
  js_parts `av_comp` → `av_comp_ui` (after `av_session_ui`, before `av_synth`) · body `#av-comp` card +
  `#av-comp-host` after `#av-sessions` (+ hero/footer) · styles block (48-class coverage gate passed) ·
  app_core **0.9.0 "S2.1 · takes & comping"** + guarded comp/compUi boots + log fields · cdp_smoke
  comp-card check (**→ 20 checks**). **Frozen `index.html` sha `0f79ebc2…` = 1,742,403 B.**
- **Rig `cdp_comp.mjs`: first run 38/40 → TWO rig SPEC fixes** (the app was correct on both — the rig-own
  winners/ranges recomputation matched the engine and the render matched the stitch math exactly):
  (1) take-B fixture wait 1250 → 2000 ms — the input capture is **4096-frame block-quantized**, so the old
  50 ms gap landed on take A's exact block count (65536 vs 65536 → now 65536 vs 102400);
  (2) check-6 render leg — the old "≈ min(longest, regions·cycle)" assumed the owner take wins every
  region; a shorter scorer wins legitimately (winner-clamped ranges), so the expectation is now the
  rig-own region picks minus the pinned 240-frame default seams (ΣL − Σmin(240, Lᵢ, Lᵢ₊₁)). Re-run **40/40**
  → pinned (`EXPECT_SHA`) → **41/41**; probe + screenshot inspected clean (`renders/s2b-comp-suite.png`:
  lanes Take 3/4/5 + partial, selected-lane border, RIG AUTO segment `t4 0.00–2.00 s · fade 5.0/5.0 ms`).
- **Freeze pins re-pinned (10 files → S2.1 sha):** cdp_comp (null → sha) + bounce/fx/midi/rec/seq/sample/
  sessions/store/studio (S2 sha → S2.1 sha).
- **BATTERY ALL GREEN — 13 suites** (one detached runner; `cache/scratch/s2b/integrate/battery-s2b.log`):
  smoke **20** · studio 37 · sessions 41 · comp 41 · feel 18 · keys 27 · midi 33 · sample 29 · rec 29 ·
  fx 27 · seq 31 · store 28 · bounce 32 — every exit=0, fails=0.
- **PERF GATE (raw + attribution):** bench `bench-v12-s2b-full.{log,json}` full run knee read **64**
  (the n=96 cell spiked @ 1468.9 µs/q — a transient; n=64 was the fastest seen @ 606.0; realtime
  {light 64 · fat 48}). **Offline A/B back-to-back under the same conditions** (`bench-ab-s2bctl-offline.*`
  = S2 control bytes, sha verified 31087322; `bench-ab-s2b-offline.*` = S2.1): BOTH publish the **identical
  knee 96/128** (control n=96 @ 986.4; S2.1 n=96 @ 1023.5, n=128 @ 1338.9) and the worklet sha
  `6e66274e…` is byte-identical to the S2 / P1.x lineage ⇒ **ENVIRONMENT, not a regression**. Stress ×2
  (`stress-s2b-run1/2.log`): `asserts-not-met` both — run1 loaded profile (deltas 1795, uni-7 over-drive
  windows), run2 near-quiet (deltas 49); drains PASS ×2, heap ≤ 0.3 MB, pageErrors 0. `last-cdp_bench.*`
  restored to the full S2.1 run.
- **README updated** (status = S2.1; battery 13 suites; gate raw + A/B attribution line).
- **Carried:** a genuinely quiet-window bench re-run (both S2 and S2.1 gates ran on an active-console
  machine; under current conditions BOTH builds read 96 — expect 128 truly quiet) · P·2 minBLEP pass ·
  P4 follow-ups · PERFECT TUNINGS.
- **NEXT SESSION OPENS ON: S3 mix/master** — draft `verify/_s3_wave.md` (docs/08 §1: per-track FX +
  send rails #69 · bus glue · master chain #70 · auto-mix #49 with LUFS/true-peak targets · A/B
  reference · export dither) + dispatch children; then S4 deliver / deck / popout keyboard / CODE /
  walkthrough-help. **NOTHING RUNNING** — no background jobs, no live subagents. Resume phrase:
  **"continue anvil"**.

## S3 wave DISPATCHED — 2026-10-07 (4 children; contract `3a80916`)

- Contract: `verify/_s3_wave.md` (commit `3a80916`) — mix & master pins §2.1–2.4 (av_loud · av_mix ·
  av_mix_ui · cdp_mix), laws §3, integration §4, watch §5.
- Children — delegation **`deleg_8752c803`** (4 in parallel, background): sa-A `src/av_mix.js` · sa-B
  `src/av_loud.js` · sa-C `src/av_mix_ui.js` · sa-D `verify/cdp_mix.mjs` (WRITE-ONLY rig). Transcripts:
  `cache\delegation\live\deleg_8752c803\task-{0..3}.log`; scratch `cache/scratch/s3/<name>/`.
- **Carried item actioned at dispatch:** quiet-window bench re-run LAUNCHED ~22:07 (hidden-detached;
  runner `cache/scratch/s2b/integrate/quiet-bench.sh`; marker `QUIET-BENCH-DONE` in its chain log;
  record lands at `verify/bench-v13-s2b-quiet.*`; runs on the frozen S2.1 bytes `0f79ebc2`).
- **On return (parent integration per `_s3_wave.md` §4):** read child reports → ONE counted-assert
  script (`cache/scratch/s3/integrate/_s3_integrate.py`): build.py js_parts (`av_loud` → `av_mix` →
  `av_mix_ui` after `av_comp_ui`, before `av_synth`) · body `#av-mix` card + `#av-mix-host` after
  `#av-comp` (+ hero/footer) · styles block (coverage-checked) · app_core **1.0.0 "S3 · mix & master"**
  + guarded avMixInit/avMixUiInit boots · cdp_smoke mix-card check (→ 21). Then rebuild → node re-runs +
  `cdp_mix` first run (pin EXPECT_SHA; re-run) → FULL battery (ALL 14 pinned suites; re-pin all) →
  PERF GATE (bench + stress ×2; worklet sha must read `6e66274e…`) → commits + addendum 28 + README.
- **If resuming cold mid-S3:** read `verify/_s3_wave.md` + this section; `ls src/av_mix.js src/av_loud.js
  src/av_mix_ui.js verify/cdp_mix.mjs` for what landed; child transcripts as above. Resume phrase:
  **"continue anvil"**.

## Resume addendum 28 — 2026-10-07 (S3 MIX & MASTER INTEGRATED + CLOSED — battery ALL GREEN on `859a897d`; perf gate raw + environment note; the mix desk ships)

- Children `deleg_8752c803` (4 parallel, ~16 min): sa-A `src/av_mix.js` (1646; harness 138/138) ·
  sa-B `src/av_loud.js` (525; 71/0 +1 flagged = the anchor arithmetic → contract AMENDMENT 1) ·
  sa-C `src/av_mix_ui.js` (2405; 338/338; 108 classes) · sa-D `verify/cdp_mix.mjs` (1446; 45 checks,
  write-only). Parent re-ran every harness green.
- Parent integration (ONE counted-assert script, 11 edits; `cache/scratch/s3/integrate/_s3_integrate.py`):
  build.py js_parts `av_loud → av_mix → av_mix_ui` (after av_comp_ui, before av_synth) · body `#av-mix`
  card + `#av-mix-host` after `#av-comp` (+ hero/footer) · styles S3 block (108-class coverage via
  runtime extraction) · app_core **1.0.0 "S3 · mix & master"** + guarded boots + log fields · cdp_smoke
  S3 check (**21 checks**). **Frozen `index.html` = `859a897d…` (1,960,270 B).** Worklet concat untouched
  (`AV_WORKLET_SHA` = `6e66274e…`).
- **Rig cdp_mix: first run 43/45 → TWO rig SPEC fixes (probe-evidenced; the app was honest on both):**
  (1) the fresh-page DEFAULT pattern is **EMPTY** (probe `cache/scratch/s3/integrate/engine_probe.mjs`:
  snapNotes 0 → avBounce warns "pattern has no audible events" → silent engine leg) — group 3 now loads
  the house rig pattern (`RIG MIX PAT`, the cdp_bounce BUILD_PATTERN shape) before the engine track,
  asserted via `patternLoaded`; (2) 13a — the engine REPORTS a silent track's auto-mix row honestly
  (lufs null, applied false; the card renders "silent · skipped") rather than omitting it → expectation
  = reported but NOT applied. Re-run 45/45 → pinned **46/46** (18e). Fix script `_rigfix.py` (10 edits);
  post-fix 17a: eAll 0.0136 > eTake 0.0066 · eEng 0.0067 · both legs alive.
- Freeze pins → `859a897d` (11 files incl. cdp_mix; `_s3_pins.py`). **BATTERY ALL GREEN — 14 suites**
  (`cache/scratch/s3/integrate/battery-s3.log`; every exit=0): smoke 21 · studio 37 · sessions 41 ·
  comp 41 · **mix 46** · feel 18 · keys 27 · midi 33 · sample 29 · rec 29 · fx 27 · seq 31 · store 28 ·
  bounce 32. Screenshot `renders/s3-mix-suite.png` (412,921 B @2x).
- **PERF GATE (raw + environment note):** bench `bench-v14-s3-full.{log,json}` — offline knee **96/128**
  (n=128 @ 1455.02 µs/q = 54.56%; monotone; realtime {light 64 · fat 32}; ratio 0.999; 0 invalid reads).
  Stress ×2 (`stress-s3-run1/2.log`): both `asserts-not-met` — run1 deltas **121** (heap +0.4 MB) ·
  run2 deltas **193** (heap +0 MB); drains PASS ×2 (15/15), 27/27 cycles, +3,564 notes, page errors 0.
  **Attribution: environment baseline** — the engine is byte-identical to the P1.x→S2.1 lineage
  (worklet sha `6e66274e…`; concat untouched) and the same-conditions A/B already proved the knee-96
  reading is the machine (v13 quiet re-run + v14 both read 96; the 128-cell sits ~1% under the cap and
  the console was active throughout). P·1 satisfied raw; quiet-window re-runs optional.
- Close commits: gate records + this addendum + README (S3 status). **NOTHING RUNNING** — no background
  jobs, no live subagents.
- **NEXT SESSION OPENS ON: the next GOLDEN BUILD studio block** — S4 deliver extras (FSA #77 · share
  card #18 · video #83) / deck (#15) / PF-grade popout keyboard / CODE (#81) / walkthrough-help
  (#20/#45/#80) — then max modules / platform (share/cloud/PWA/bridges) → P7 polish → deploy + live
  verify + owner pass. Carried: P·2 minBLEP pass · P4 follow-ups (fill control wiring, chains/scenes
  undo checkpoints, acid accent-flag decision) · PERFECT TUNINGS (tuning engine) · optional quiet-window
  bench re-runs. Resume phrase: **"continue anvil"**.

## DECK wave DISPATCHED — 2026-10-07 (3 children; contract `f65f0df`)

- Contract: `verify/_deck_wave.md` (commit `f65f0df`) — **pro deck readouts (#15)**: deck core §2.1
  (av_deck.js — analyser attach · rings · pure math · the synchronous step engine) · card §2.2
  (av_deck_ui.js — scope/spectrum/waterfall canvases · LUFS/TP meters · readouts · rAF discipline) ·
  rig §2.3 (cdp_deck.mjs, the 10 proof groups); laws §3, integration §4, watch §5. Scope note: the
  deck is also the capture surface video capture (#83) will need — deck first, then S4 extras /
  platform.
- Children — delegation **`deleg_37e0ff7f`** (3 in parallel, background): sa-A `src/av_deck.js` ·
  sa-B `src/av_deck_ui.js` · sa-C `verify/cdp_deck.mjs` (WRITE-ONLY rig). Transcripts:
  `cache\delegation\live\deleg_37e0ff7f\task-{0..2}.log`; scratch `cache/scratch/deck/<name>/`.
- **On return (parent integration per `_deck_wave.md` §4):** read child reports → ONE counted-assert
  script (`cache/scratch/deck/integrate/_deck_integrate.py`): build.py js_parts (`av_deck` →
  `av_deck_ui` after `av_mix_ui`, before `av_synth`) · body `#av-deck` card + `#av-deck-host` after
  `#av-mix` (+ hero/footer) · styles block (coverage-checked) · app_core **1.1.0 "DECK · pro
  readouts"** + guarded avDeckInit/avDeckUiInit boots · cdp_smoke deck-card check (→ 22). Then
  rebuild → node re-runs + `cdp_deck` first run (pin EXPECT_SHA; re-run) → FULL battery (15 suites;
  re-pin all) → PERF GATE (bench must read within variance of bench-v14 — the deck adds no offline
  cost; worklet sha must stay `6e66274e`) → commits + addendum 29 + README.
- **If resuming cold mid-DECK:** read `verify/_deck_wave.md` + this section; `ls src/av_deck.js
  src/av_deck_ui.js verify/cdp_deck.mjs` for what landed; child transcripts as above. Resume phrase:
  **"continue anvil"**.

## SESSION SAVE — 2026-10-07 ~24:05 (DECK wave mid-flight: integrated + smoke green; rig 33/34 — ONE open check)

- **Chain:** contract `f65f0df` → children `deleg_37e0ff7f` LANDED (`f4c5dc5`: av_deck.js 956 — harness
  125/0 · av_deck_ui.js 1479 — 231/231, 41 classes · cdp_deck.mjs — 34 checks, EXPECT_SHA null; parent
  re-ran all three harnesses green) → integration 11 edits (`cache/scratch/deck/integrate/_deck_integrate.py`)
  → **rebuild `index.html` = `0ff22c9c…` (2,063,258 B)** (`f56c4de`) → **smoke 22/22** → rig first run
  **28/40** → parent triage → rig SPEC fixes 10 edits (`_deck_rigfix.py`: deferred-RPC null tolerance at
  2d/2f · −1 no-peak sentinel at 2e · dB-aware `bandMax` metric + waterfall ring extraction in the
  `__deckw` wrappers at 2e/2f/3c/4a) → **re-run 33/34** (`2dd3641`).
- **OPEN — the ONE failing check, 4b:** "waterfall canvas CHANGES while playing" — the waterfall canvas
  digest is BYTE-IDENTICAL (ink 0 · sumLum 1291008) across ~2 s of stepping while `rows` advance (4a is
  green — the wrapper now extracts the row from the core's `cols`/`data` ring). Reading: the waterfall
  CANVAS receives no paint at all in forced steps (flat near-black); scope + spectrum + meters all draw
  fine. **Hypotheses for the next session:** (a) sa-B's ring-mode/push-mode waterfall path doesn't engage
  inside `avDeckUiDrawAll(true)`; (b) the 96×96 ImageData blit silently no-ops / paints all-black
  (dB→dbFloor mapping); (c) the forced-step path skips the wf pane. **Next move:** probe a live page with
  a note held (the `engine_probe.mjs` pattern): read `window.__avDeckUi.state` (wf counters) + call
  `__avDeckUi.step()` repeatedly + digest the canvas; then read `av_deck_ui.js` `avDeckUiDrawAll` +
  `avDeckUiWf*` (and `av_deck.js` wf frame `cols`/`data` layout if needed) and patch — **parent-owned app
  fix** (the file landed; the parent now owns it). Rebuild → smoke → rig re-run → expect 34/34 + pin leg.
- **AFTER 4b GREEN:** pin `EXPECT_SHA` (cdp_deck null→sha; `_deck_pins.py` pattern) + re-run → FULL
  battery (15 suites; re-pin every freeze file) → PERF GATE (bench within variance of bench-v14 — the
  deck adds no offline cost; worklet sha must stay `6e66274e`) → commits + **addendum 29** + README +
  mnemosyne.
- **Nothing running** — children all completed; no background jobs; tree clean except `?? cache/`.
- Watch-outs carried from the child reports: `lufsShort` honestly null until ~3 s of ring audio (rig
  sustains for it — G5 green) · `lastNote.vel` null (the bus exposes no velocity) · attach retry cadence
  2 s (boot comps `avDeckInit` only; the card attaches) · `rowMs` wall-clock gate + 4-step fallback.
- Resume phrase: **"continue anvil"**.

**SAVE CERTIFIED — 2026-10-07 ~24:20 (session-end verification):** tree clean (`?? cache/` only) ·
HEAD `137a767` · `index.html` on disk = `0ff22c9c…` (matches this save) · process census = 0 real
strays (only the querying wrappers self-match) · no background jobs, no live subagents. **Nothing at
risk.** The continued session opens with: 4b probe → fix → rebuild → smoke → rig re-run → pin →
battery 15 → gate → addendum 29 + README.

## Resume addendum 29 — 2026-10-08 (DECK wave INTEGRATED + CLOSED — battery ALL GREEN on `45cc39d7`; the pro deck ships)

- Children `deleg_37e0ff7f` (3 parallel): sa-A `src/av_deck.js` (956; harness 125/0) · sa-B
  `src/av_deck_ui.js` (1479; harness 231/231) · sa-C `verify/cdp_deck.mjs` (34 checks, write-only).
  Parent re-ran every harness green.
- Parent integration (ONE counted-assert script, 11 edits; `cache/scratch/deck/integrate/_deck_integrate.py`):
  build.py js_parts `av_deck → av_deck_ui` (after av_mix_ui, before av_synth) · body `#av-deck` card +
  `#av-deck-host` after `#av-mix` (+ hero/footer) · styles DECK block (41-class coverage) · app_core
  **1.1.0 "DECK · pro readouts"** + guarded boots · cdp_smoke DECK card check (21→22).
- Rig cdp_deck: first run 28/40 → rig SPEC fixes 10 edits (`_deck_rigfix.py`) → 33/34. **OPEN 4b
  (waterfall canvas paint) FIXED this session:** the live probe (`deck_4b_probe.mjs`; record
  `verify/deck-4b-probe-out.txt`) read the canvas digest BYTE-IDENTICAL (sumLum 1291008 · ink 0) while
  the core frame advanced (rows 3→10) — the UI resolver only knew ring/push shapes, never the core's own
  (rows = COUNT number, latestRow = write INDEX number, cols + flat data ring). **Parent fix
  `_deck_4bfix.py` (8 edits)** = the UI "flat" ring mode (+7 harness checks → 238/238; probe re-run:
  mode flat, digest advances sumLum 1291008→1305578 · ink 0→54) → **rebuild `45cc39d7` (2,065,214 B) →
  smoke 22/22 → rig 34/34 unpinned → pins (`_deck_pins.py`; cdp_deck null→sha) → rig pinned 35/35**
  (35 = the 34 checks + 10e sha=pinned).
- **BATTERY ALL GREEN — 15 suites** (`cache/scratch/deck/integrate/battery-deck.log`, every exit=0):
  smoke 22 · studio 37 · sessions 41 · comp 41 · mix 46 · feel 18 · keys 27 · midi 33 · sample 29 ·
  rec 29 · fx 27 · seq 31 · store 28 · bounce 32 · **deck 35 pinned**. Screenshot `renders/deck-suite.png`
  (@2x, live deck card).
- **PERF GATE:** bench `bench-v15-deck-full.{log,json}` — offline knee **128** (n=128 @ **1317.78 µs/q =
  49.42%** budget; monotone; no first-fail; v14/S3 read knee 96 @ 54.56% on a busier window); realtime
  {light 64 · fat 32} · ratio 1.000 · 0 invalid reads; worklet sha `6e66274e…` byte-identical. Stress ×2
  `stress-deck-run1/2.log`: both `asserts-not-met` (standing shape): r1 **887** [verified 4 · uni>3 13] ·
  r2 **322** [verified 2 · uni>3 14]; drains PASS ×2 · heap +0.3 MB · page errors 0. **Attribution =
  environment (proven by control):** the adjacent-window control on the S3 frozen bytes
  (`stress-s3control-run.log`) read **760** with the SAME envelope shape as r1 (4 verified: 1,1,1,3 vs
  1,1,1,13) — while the deck is provably INERT during stress (idle probe: loop off · 0 ticks/9 s · deck
  host 7,642 px below the viewport) and the engine is byte-identical. Records:
  `verify/deck-gate-attribution.txt`.
- Close commits: 4b fix `e34e772` · pins `62a9f69` · battery `f4b41c8` · then this close (gate records +
  addendum 29 + README). **NOTHING RUNNING** — no background jobs, no live subagents.
- **NEXT SESSION OPENS ON: the next GOLDEN BUILD block** — S4 deliver extras (FSA #77 · share card #18 ·
  video #83 — the deck is its capture surface) / PF-grade popout keyboard / CODE (#81) / walkthrough-help
  (#20/#45/#80) — then max modules / platform (share/cloud/PWA/bridges) → P7 polish → deploy + live
  verify + owner pass. Carried: P·2 minBLEP pass · P4 follow-ups (fill control wiring, chains/scenes undo
  checkpoints, acid accent-flag decision) · PERFECT TUNINGS (tuning engine) · optional quiet-window bench
  re-runs. Resume phrase: **"continue anvil"**.

## Resume addendum 30 — 2026-10-08 (S4 DELIVER EXTRAS INTEGRATED + CLOSED — battery ALL GREEN on `c92a4445`; projects · cards · clips ship)

- Children `deleg_4b764d01` (5 parallel): sa-A `src/av_proj.js` (835; harness 273/273) · sa-B `src/av_card.js`
  (1624; 272/272 — QR proven byte-for-byte vs reference qrcode@1.5.4 for all 8 masks × 5 texts) · sa-C
  `src/av_video.js` (1146; 162/162) · sa-D `src/av_files_ui.js` (1032; 274/274) · sa-E `verify/cdp_s4.mjs`
  (rig 37 checks). Parent re-ran every harness green.
- Parent integration (`_s4_integrate.py`, 10 edits): build parts `av_proj → av_card → av_video →
  av_files_ui` (after av_deck_ui) · `#av-files` card + host after `#av-deck` · styles block (22-class
  coverage via `_s4_classes.mjs`) · app_core **1.2.0 "S4 · deliver extras"** + guarded boots + the
  `avCardUrlApply()` #avp= boot hook · smoke 22→23.
- Rig first runs: 29/36 → THREE classified fixes → **36/36** (pins → battery run = 37/37 pinned):
  (1) rig SPEC ×2 (`_s4_rigfix.py`: fake FSA open recorder; lastSave.at ISO-or-epoch tolerance);
  (2) app fix (`_s4_cardfix.py`: the live card wire is a knob-default DIFF — a share link must be
  compact, not the full 127-param mirror); (3) app fix (`_s4_cardfix2.py`: share→download converts the
  PNG Blob via arrayBuffer() before avDeliverDownload — the byteLength seam).
- **Frozen `index.html` = `c92a4445…` (2,269,601 B)** · pins moved (13 files; `_s4_pins.py`) ·
  **BATTERY ALL GREEN — 16 suites** (`cache/scratch/s4/integrate/battery-s4.log`): smoke 23 · studio 37 ·
  sessions 41 · comp 41 · mix 46 · feel 18 · keys 27 · midi 33 · sample 29 · rec 29 · fx 27 · seq 31 ·
  store 28 · bounce 32 · deck 35 · **s4 37 pinned**. Screenshot `renders/s4-suite.png`.
- **PERF GATE:** bench `bench-v16-s4-full.{log,json}` — knee 96/128 @ 59.81% this window; the decisive
  same-conditions A/B (old 45cc39d7 vs new c92a4445, offline-only, back-to-back) read IDENTICAL knees
  (96/128; 1374.76 vs 1335.91 µs/q — new marginally faster) → **environment, not regression**;
  worklet sha `6e66274e…` byte-identical (no engine work). Stress ×2: 20 / 16 deltas (the quietest of
  the night; drains PASS, 0 page errors). Records: `verify/s4-gate-attribution.txt`.
- Close commits: integration `04ef4c6` · fixes+pins `4bf10a4` · battery `d4d6836` · then this close.
  **NOTHING RUNNING** — no background jobs, no live subagents.
- **NEXT SESSION OPENS ON: the next GOLDEN BUILD block** — PF-grade popout keyboard · CODE (#81 open
  module API) · walkthrough/help (#20/#45/#80) — then max modules / platform (share/cloud/PWA, #78/#82)
  → P7 polish → deploy + live verify + owner pass. Carried: P·2 minBLEP pass · P4 follow-ups · PERFECT
  TUNINGS · optional quiet-window bench re-runs. Resume phrase: **"continue anvil"**.

## SESSION SAVE — 2026-10-08 ~02:00 (S4 wave CLOSED + committed; nothing in flight — clean handoff)

- **State: ALL CLOSED.** HEAD `2f09919` (tree clean, `?? cache/` only) · `index.html` on disk =
  `c92a4445…` (2,269,601 B) = the frozen S4 build the whole gate ran against · pins all on `c92a4445`
  (13 files) · 16-suite battery green · perf gate + A/B records committed (`verify/s4-gate-attribution.txt`,
  `bench-v16-s4-full.*`, `stress-s4-run1/2.log`) · addendum 30 + README in the close commit.
- **Nothing running** — 0 background jobs, 0 live subagents, 0 real process strays (the census's residual
  hits are Hermes's own toolchain). The `cache/` scratch is intentionally untracked.
- **The continued session opens on the next GOLDEN BUILD block** (no mid-wave work owed): PF-grade
  popout keyboard · CODE (#81 open module API) · walkthrough/help (#20/#45/#80) — then max modules /
  platform (share/cloud/PWA, #78/#82) → P7 polish → deploy + live verify + owner pass.
- Wave-specific assets a next session may want: contract `verify/_s4_wave.md` · rig `verify/cdp_s4.mjs`
  (37 checks) · fix scripts `cache/scratch/s4/integrate/_s4_{rigfix,cardfix,cardfix2,pins}.py` ·
  children transcripts `cache/delegation/live/deleg_4b764d01/task-{0..4}.log` · gate chain
  `cache/scratch/s4/integrate/{battery-s4,gate-s4,ab-s4}.log`.
- **Resume phrase: "continue anvil".**

## Resume addendum 31 — 2026-10-08 (S5 CODE · KEYS POPOUT · HELP INTEGRATED + CLOSED — battery ALL GREEN on `7accc9fd`; the CODE section ships)

- Children `deleg_1bb78706` (8 parallel): sa-A `src/av_kb_pop.js` (472; harness 49/0) · sa-B
  `src/av_umod_wl.js` (410) + `src/av_code.js` (1039) + `docs/09-code-module-api.md` (541; AVUMOD harness
  106/0 + SPN end-to-end) · sa-C `src/av_code_ui.js` (1651; 93) · sa-D `src/av_help.js` (954; 49) ·
  sa-E `src/av_palette.js` (793; 40) · sa-F `src/av_lessons.js` (1198; 45 + 32-path wizard audit) ·
  sa-G1 `verify/cdp_s5.mjs` + sa-G2 `verify/cdp_code.mjs` (rigs, write-only). Parent re-ran every harness green.
- Probe first (load-bearing): `new Function` WORKS inside AudioWorkletGlobalScope; fetch/URL/performance/
  TextEncoder/structuredClone are ALL undefined there → user modules eval in-worklet with an injected API
  (evidence `cache/scratch/s5/probe/`).
- Parent integration (`_s5_integrate.py`, 32 counted edits): build parts + worklet concat gains av_umod_wl ·
  `#av-code` card + `#pk-pop`/`#pk-return` rail buttons · styles S5 block · app_core **1.3.0 "S5 · code ·
  keys · help"** + six guarded boots · av_dsp kindModOf + user-kind acceptance + AVUMOD fallbacks ·
  av_voiceproc umod branch · av_engine umod reply routing · av_kb bed-root + popout hooks + the ONE
  avUiKeyHook line · av_synth user-kind options + refresh. Smoke 23→24.
- Rig first runs: cdp_s5 29/35 · cdp_code 34/35 → **8 rig SPEC fixes** (`_s5_rigfix.py`; no app defects —
  palette state read via `isOpen()`, lesson tour handle captured from `r.handle`, wizard picks re-query the
  re-rendered rows, engine facade re-read after the ensure await) → **both 35/35** → pins (`_s5_pins.py`;
  13 updated + 2 filled = 15 files) → pinned runs 36/36 each.
- **Frozen `index.html` = `7accc9fd…` (2,608,972 B)** · **BATTERY ALL GREEN — 18 suites**
  (`cache/scratch/s5/integrate/battery-s5.log`): smoke 24 · studio 37 · sessions 41 · comp 41 · mix 46 ·
  feel 18 · keys 27 · midi 33 · sample 29 · rec 29 · fx 27 · seq 31 · store 28 · bounce 32 · deck 35 ·
  s4 37 · **s5 36 · code 36 pinned**. Screenshots `renders/s5-suite.png` + `renders/code-suite.png`.
- **PERF GATE:** bench `bench-v17-s5-full.{log,json}` — knee 96/128 monotone (IDENTICAL to v16); worklet sha
  `e2601849…` (av_umod_wl joined the worklet concat by design; inert — bench unchanged). Stress ×2: 360/183
  vs the S4 quiet record 20/16; the **decisive old-bytes control** (c92a4445 swapped back-to-back, same
  active-console conditions) read **230 [verified 1 · uni>3 14]** — same envelope shape → **environment,
  not regression** (Moddy active: brave/explorer/audiodg; never-quiet machine). Records:
  `verify/s5-gate-attribution.txt` + `stress-s5-control.log`.
- Close commits: integration+battery `f1d46a4` · then this close (gate records + addendum 31 + README +
  docs/05 status). **NOTHING RUNNING** — no background jobs, no live subagents.
- **NEXT SESSION OPENS ON: the next GOLDEN BUILD block** — max modules/racks (FM engine #60 · MPE #61 ·
  chop #65 · wavetable editor #66 · IR #67 · Airwindows bank #68 · sends/sidechain #69 · master chain #70 ·
  generative #72 · arranger #73 · autosave #76 · …) then platform (PWA #78 · suite bridges #82) → P7 polish
  (#79) → deploy + live verify + owner pass. Carried: P·2 minBLEP pass · P4 follow-ups · PERFECT TUNINGS ·
  optional quiet-window bench re-runs. Resume phrase: **"continue anvil"**.

## SESSION SAVE — 2026-10-08 ~03:30 (S5 wave CLOSED + committed; nothing in flight — clean handoff)

- **State: ALL CLOSED.** HEAD `95342b0` (tree clean, `?? cache/` only) · `index.html` on disk =
  `7accc9fd…` (2,608,972 B) = the frozen S5 build the whole gate ran against · pins all on `7accc9fd`
  (15 files) · 18-suite battery green · perf gate + old-bytes control committed
  (`verify/s5-gate-attribution.txt`, `bench-v17-s5-full.*`, `stress-s5-run1/2.log`, `stress-s5-control.log`) ·
  addendum 31 + README + docs/05 status in the close commit.
- **Nothing running** — 0 background jobs, 0 live subagents, 0 real process strays. The `cache/` scratch
  is intentionally untracked.
- **The continued session opens on the next GOLDEN BUILD block** (no mid-wave work owed): max
  modules/racks (FM engine #60 · MPE #61 · chop #65 · wavetable editor #66 · IR #67 · Airwindows bank #68 ·
  sends/sidechain #69 · master chain #70 · generative #72 · arranger #73 · autosave #76 · …) · platform
  (PWA #78 · suite bridges #82) → P7 polish (#79) → deploy + live verify + owner pass.
- Wave assets a next session may want: contract `verify/_s5_wave.md` · rigs `verify/cdp_s5.mjs` +
  `verify/cdp_code.mjs` · module-API docs `docs/09-code-module-api.md` · integration scripts
  `cache/scratch/s5/integrate/_s5_{integrate,rigfix,pins}.py` · probe `cache/scratch/s5/probe/` ·
  children transcripts `cache/delegation/live/deleg_1bb78706/task-{0..7}.log`.
- **S5 surfaces, one line each** (for future sessions): CODE = `av_umod_wl` (in-worklet eval of user
  modules · ids ≥ 64 kinds · fx push eng.fx) + `av_code` (facade · IDB 'av-code-store' · examples) +
  `av_code_ui` (the `#av-code` card); popout = `av_kb_pop` + `#pk-pop`/`#pk-return` + av_kb bed-root hooks;
  help = `av_help` (avUiKeyHook owns ?/Esc); palette = `av_palette` (Ctrl-K · 41 commands); lessons =
  `av_lessons` (#av-firstrun · demo groove · 4 lessons · 4 wizards).
- **Resume phrase: "continue anvil".**

**SAVE CERTIFIED — 2026-10-08 ~03:20 (session-end verification):** tree clean (`?? cache/` only) · HEAD
`60a23d5` (the save; close `95342b0` beneath) · `index.html` on disk = `7accc9fd…` (2,608,972 B — matches
the save) · pins 15 files on `7accc9fd` · all chain markers closed (BATTERY-S5-DONE · GATE-S5-DONE ·
CONTROL-S5-DONE · S5-RIGS-DONE) · process census: 0 rig strays (the one live `node server.js` is Moddy's
own long-running server — the rigs only ever run `node verify/cdp_*.mjs`, and every chain exited) · no
background jobs, no live subagents. **Nothing at risk.** The continued session opens on the next GOLDEN
BUILD block — max modules/racks → platform (PWA #78 · suite bridges #82) → P7 polish (#79) → deploy +
live verify + owner pass. Resume phrase: **"continue anvil"**.

## M1 WAVE OPENED — 2026-10-08 (sound depot: FM engine #60 · studio flavours #68 · convolution IR #67 · wavetable editor #66)

- **Contract `verify/_m1_wave.md`** (this wave's single source of truth): FM = kind 6 (PREFIX fm, param
  schema + 8 algos + `AVFM.algoInfo(i)` pinned in §2.1; card #av-fm §2.2) · AVFXAW prefix `aw` (5
  modes console/tape/drive/air/warm; §2.3) · AVFXCONV prefix `conv` (partitioned-FFT, factory bank +
  user impulse, §2.4) · WT core+card (wt.user0..15 + avEngineWt/setUserWt plumbing, §2.5/§2.6) · rig
  `verify/cdp_m1.mjs` §2.7 · integration recipe §4 · watch-outs §5.
- **Children — delegation `deleg_9716d625` (7 parallel, background):** sa-A `src/av_fm.js` · sa-B
  `src/av_fm_ui.js` · sa-C `src/av_fx_aw.js` · sa-D `src/av_fx_conv.js` · sa-E `src/av_wt.js` · sa-F
  `src/av_wt_ui.js` · sa-G `verify/cdp_m1.mjs` (write-only rig, EXPECT_SHA null). Transcripts:
  `cache\delegation\live\deleg_9716d625\task-{0..6}.log`; scratch `cache/scratch/m1/<name>/`.
- **Pre-drafted integration script: `cache/scratch/m1/integrate/_m1_integrate.py`** — counted-assert,
  all-or-nothing (validates every anchor across all 9 files before writing anything; artifact guard
  refuses until all 7 child files exist). py_compile OK; guard verified refusing (exit 2) while the
  children author. Sites: build.py (worklet concat + parts + asserts) · av_dsp (kind range 1..6 ×5
  sites · kindModOf · engine.kind "fm" · osc2 user tables + frame resolver · userWt literal ·
  FX_PREFIX/FX_WET 7 slots · setUserWt/setConvImpulse + exports · stats uwt/fxChain) · av_voiceproc
  (wtab + conv branches) · av_engine (avEngineWt/avEngineConv senders, structured-clone) · av_synth
  (kinds + fm panel + osc2 optionsFn + avSynthWtOptions/avSynthOscOptionsRefresh) · av_fx (aw/conv
  strips + IMPORT IR button + import leg) · body (#av-fm + #av-wt cards) · app_core (1.4.0 "M1 · fm ·
  flavours · conv · wavetable" + boots + ENGINE SELFTEST fm) · smoke (7 kinds · 7 strips/27 knobs ·
  #av-fm + #av-wt checks).
- **On resume (cold mid-wave):** check `ls src/av_fm.js src/av_fm_ui.js src/av_fx_aw.js
  src/av_fx_conv.js src/av_wt.js src/av_wt_ui.js verify/cdp_m1.mjs` + child transcripts; verify files →
  re-run child harnesses → styles block from `avFmUiClasses()/avWtUiClasses()` → run the integration
  script → `python3 build.py` → smoke → `node verify/cdp_m1.mjs` first run → SPEC fixes → pins →
  battery (19 suites) → perf gate (bench knee vs 96/128 + stress ×2 + old-bytes control if the counts
  jump) → close commits + addendum 32 + README + docs/05 status.
- Resume phrase: **"continue anvil"**.

## Resume addendum 32 — 2026-10-08 (M1 SOUND DEPOT INTEGRATED + CLOSED — battery ALL GREEN on `335f4bd0`; FM · FLAVOUR · CONV · WT editor ship)

- Children `deleg_9716d625` (7 parallel): sa-A `src/av_fm.js` (490; 78/78) · sa-B `src/av_fm_ui.js`
  (640; 64/64) · sa-C `src/av_fx_aw.js` (359; 73/73) · sa-D `src/av_fx_conv.js` (792; 25/25) ·
  sa-E `src/av_wt.js` (1062; 100/100) · sa-F `src/av_wt_ui.js` (1979; 304/304) · sa-G
  `verify/cdp_m1.mjs` (1148; write-only). Parent re-ran every harness green.
- **Shipped surfaces:** **FM engine = kind 6** (`AVFM`; 6 operators · 8 algorithms matching
  `AVFM.algoInfo(i)` · DX-style ADSR per op · op6 self-feedback · exact 51-path schema) + **FM card**
  `#av-fm` (op tabs; ALL six op bodies render — every knob carries its data-def) · **AVFXAW**
  "FLAVOUR" (console/tape/drive/air/warm, wet convention, null law bit-identical) · **AVFXCONV**
  (true-stereo partitioned FFT, P=512 → 511-sample latency, 6 deterministic factory modes + user IR;
  `avEngineConv` sender + IMPORT IR leg in the rack; regen DRAG-COALESCED 120/150 ms after measured
  4.6–9 ms stalls per drag step) · **WT editor** (`av_wt` + `#av-wt` card: draw/spectral/morph ·
  mip law identical to factory · IDB `av-wt-store` · JSON + Serum `.wt` (vawt/RIFF) importers ·
  `wt.user0..15` installs via `avEngineWt`/`setUserWt`; osc2 pick + `avSynthOscOptionsRefresh`).
- **Integration** (`_m1_integrate.py`, 53 counted edits): kind range 1..6 (×5 sites) · engine.kind
  "fm" · `FX_PREFIX` = drive,aw,mod,delay,verb,conv,dyn + FX_WET [1,1,0,0,1,1,1] · osc2.user tables +
  frame resolver (fallback wt.sine) · `setUserWt`/`setConvImpulse` + voiceproc `wtab`/`conv` branches ·
  `stats()` += uwt/fxChain · FM panel in synth card · app_core **1.4.0 "M1 · fm · flavours · conv ·
  wavetable"** + boots + ENGINE SELFTEST fm · styles M1 block — **incl. skins for the FX rack strips
  and mod-matrix rows (a P3-era gap: both cards shipped with NO css — flat text soup; now skinned)**.
- **Triage (battery first lap):** cdp_fx re-pinned to the 7-strip rack (40 controls 27/7/6) ·
  **s4 QR wire bloated (829 B > 500 cap)** — root cause: the FM card rendered only the ACTIVE op's
  knobs, so 40 non-DOM defaults rode the share diff → fix = render ALL op bodies (inactive hidden) →
  s4 37/37, wire compact again · **2f rig fixture fix**: algos 0/3 are byte-identical over {op1,op2};
  the check now opens op3/op4 first (strength preserved).
- **Frozen `index.html` = `335f4bd0…` (2,933,715 B)** · rig cdp_m1 **33/33 pinned** · **BATTERY ALL
  GREEN — 19 suites**: smoke 26 · studio · sessions · comp · mix · knob_feel · keys · midi · sample ·
  rec · fx 27 · seq · store · bounce · deck · s4 37 · s5 · code · **m1 33 pinned**. Screenshot
  `renders/m1-suite.png`.
- **PERF GATE:** bench-v18 knee **128 monotone @ 47.46%** (unchanged family) · stress ×2 **30/66**
  (BELOW the S5 record 360/183 — environment-quiet; **no control run needed**) · records
  `verify/m1-gate-attribution.txt` + `bench-v18-m1-full.*` + `stress-m1-run1/2.log`.
- Close commits: integration+battery `35175a6` · then this close (gate records + addendum 32 +
  README + docs/05 status). **NOTHING RUNNING** — no background jobs, no live subagents.
- **NEXT SESSION OPENS ON: the M2 wave** — MPE #61 · chop #65 · generative #72 remaining (per-track
  clock divide/swing · polyrhythm) · arranger #73 remaining (song-rows UI/timeline · quantised scene
  transitions · arrangement export) → then platform (PWA #78 · suite bridges #82) → P7 polish (#79) →
  deploy + live verify + owner pass. Carried: P·2 minBLEP pass · P4 follow-ups · PERFECT TUNINGS ·
  optional quiet-window bench re-runs. Resume phrase: **"continue anvil"**.
