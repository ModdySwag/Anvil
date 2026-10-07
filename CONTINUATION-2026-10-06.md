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

