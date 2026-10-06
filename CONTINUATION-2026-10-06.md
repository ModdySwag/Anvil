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
