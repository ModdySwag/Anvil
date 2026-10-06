# T9 — Pattern Forge reuse inventory for Anvil

**Written:** 2026-10-06 · for the Anvil research build (`C:\Users\Moddy\anvil`) · source root `C:\Users\Moddy\pattern-forge\` (READ-ONLY in this pass; no git, no builds run).
**Method:** enumerated `src/` (23 files + backups; 28,389 wc-l lines of hand-written JS/CSS/HTML), read the synth-relevant modules and contracts by name and content, enumerated `verify/` suites and battery scripts, read `build.py`, `SYNTH-REBUILD-PLAN.md`, `STAGE8/10/11/13-CONTRACT.md`, `annex/01–06`, `README.md`, `LICENSE`, `THIRD-PARTY-NOTICES.md`, and the live deploy tree.
**Live artifact:** `index.html` = 1,538,369 B (single file, built from `src/` by `python3 build.py`); served at `https://moddys.net/forge/`; deploy tree `C:\Users\Moddy\radio-browser\deploy\{forge,packs}`.

Verdict vocabulary: **PORT** = code/pattern copies into Anvil with light edits · **ADAPT** = concepts/parts reusable, moderate rework · **REWRITE** = rebuild · **SKIP** = not wanted.

---

### 1. `build.py` — the single-file build pipeline and its traps

**Paths:** `C:\Users\Moddy\pattern-forge\build.py` (93 lines) · artifact `index.html` · `src/head.html` (30), `src/body.html` (399), `src/styles.css` (2,578)

**What it is:** assembles the whole app into ONE `index.html` from src parts: head + CSS (into `<style id="PF_STYLE">` token) + body (JS into `<script id="PF_JS">` token). The JS is an **explicit ordered list** `js_parts = [...]` (build.py lines 19–43): `app_data → styles_data → app_codegen → app_core → app_knob → app_export → app_hub → app_menu → app_help → app_tour → app_libs → app_vary → app_midi → app_voice → app_fx → app_store → app_synthx → app_synthpanel → app_ui → app_kb → app_ai → app_dancer` + a boot line.

**KEY FACTS / traps:**
- **THE ORDER TRAP:** a new `src/` module that is not appended to the `js_parts` list **silently never ships** — no error, the file simply isn't in the artifact. Anvil must copy the explicit-list build (or an equivalent that fails loudly on unlisted files).
- Guards that DO fail loudly (worth porting): `assert "</script" not in js` (line 57); a strict-mode parser check — the concatenated JS is written to `verify/_build_check.mjs` and run through `node --check` (lines 59–76), which catches **duplicate top-level `function`/`const`/`let`/`class` declarations across parts** (comment cites the real incident: `aiSaveSettings`; sloppy mode would let dups pass silently, "last one wins").
- Build stamps an AGPL banner + prints byte count and sha256 (lines 44–54, 90–93); sha is the release identity for deploy/rollback.
- Freeze law (contracts): land sources → build → FREEZE the artifact → run suites; **never rebuild mid-battery**.

**Reuse verdict:** **PORT** — the 93-line script is the cheapest high-value reuse (single-file app architecture, order list, `node --check` guard, sha/byte print; adapt the part list for Anvil's modules).

---

### 2. `src/app_synthx.js` — the native voice engine, core (2,188 wc-l)

**Paths:** `src/app_synthx.js` (the file also carries entries 3–7 below) · boot wire in `src/app_core.js:589` (`pfSXInit()`) · debug surface `window.__pfSX`

**What it is:** the SYNTH desk's own instrument engine (Stage/Phase 1–4, `PFSX_VERSION = '2.2'`). Pure **Web Audio node graph** on purpose (works from `file://` where Blob-URL worklets are blocked; the header states the worklet-DSP engine is "the next phase"). Keys/mouse/MIDI play in ~22 ms measured key-to-audio vs 1–2 s through the pattern path.

**KEY FACTS (function names, laws):**
- Voice build: `pfSXVoiceBuild(ctx,midi,gain,patch,when)` — per-osc: typed `OscillatorNode` (`sine|triangle|sawtooth|square`), noise (`pfSXNoise`), or wavetable; optional 2-op FM (`o.fm = {mul,index,decay}`, modulator → `osc.frequency`), vibrato LFO per osc, per-osc `decay` envelope; then `[filter] → amp → modAmp → bus`. `when` param = exact AudioContext start time.
- Pool: `const PFSX_MAX_VOICES = 16` (`pfSXMaxVoices()`, low profile 8); voice map `pfSXVox` keyed by midi (MPE adds `'ch:midi'` keys); **oldest-first stealing** (`pfSXNoteOn` scans `v.t0` min and `pfSXVoiceRelease(..., fast)`; same law duplicated for the arp path ~line 1957).
- Bus chain (law-level): each voice → `pfSXBusFor(ctx)` (PFSX_MASTER 0.85) → `pfSXKeysFor(ctx)` (KEYBOARD VOL gain) → `pfSXOut(ctx)` = the app's **master tap node** (`pfTap.node`); `pfSXSetAudible` mutes via `setTargetAtTime(0.0001, …, 0.02)` (click-free, held voices survive). `pfSXEnsure()` never creates a second AudioContext — it rides `pfTap.ctx` or boots the app's own.
- Live params: `pfSXLiveParam('cutoff'|'reso'|'release'|'bend'|'wtPos'|'sendChorus'|'sendDelay', v)` retargets ringing voices (`setTargetAtTime` on nodes), else falls back to def edit.
- Patch factory `PFSX_PATCHES` (10 dock voices: gm_epiano1, gm_acoustic_grand, gm_marimba, gm_string_ensemble_1, gm_flute, gm_synth_bass_1, sawtooth, square, triangle, sine) with a compact patch schema: `{oscs:[{type|noise|wt, mul, detune, gain, decay, vibrato, fm:{mul,index,decay}, pos}], filter:{type,freq,q,envAmt,envDecay}, amp:{a,d,s,r}, gain, fx:{chorus,delay}}`; `PFSX_FACTORY` is the pristine deep copy; `pfSXPatchFor(patchId)`.
- `pfSXNoteOn` / `pfSXNoteOff` / `pfSXAllNotesOff`; `pfSXNameToMidi('c4')`; `window.__pfSX` instrumentation (`voiceInfo()`, `stats`, `testNote`, `patches`, `noteOn/Off`, `hw()`, `mpeState()`, `tuning*`, `wt*`, `arp/chord/lock/repeat/mod/fx` getters+setters) — the tests assert against THIS surface, not pixels.
- Note identity guard (cost blood): `testNote`'s auto-off is bound to the exact voice object it created (`pfSXVox.get(midi) === voice`), because a stale timer released a later note on the same midi.

**Reuse verdict:** **PORT** as the flagship's starting engine (node-graph core, pool/steal laws, patch JSON model, live-param law, `__pfSX` instrumentation); the osc/FX sections get extended per the gap list — but the architecture transfers intact.

---

### 3. `src/app_synthx.js` — wavetable subsystem (.wt + builtins)

**Paths:** `src/app_synthx.js` (state `pfSXWT` ~L183–475; parse L242–273; voice use L923–952 + `pfSXWTVoicePos` L452–476; persist `pf-sx-wt`) · engine API frozen in `STAGE10-CONTRACT.md` §1a · bank carrier law in `STAGE11-CONTRACT.md` §1 + `verify/synth_pack_schema.mjs`

**What it is:** a faithful `.wt` (Surge's public format) reader + generator + localStorage persistence, and a **2-oscillator crossfade** wavetable oscillator (frame `floor(pos*(count-1))` and next, mixed by `pos`), built on `PeriodicWave` coefficients (`pfSXWTWave`). Four procedural builtins `gen:harmonics|formant|pulse|bell` (64 frames × 256 samples, peak-normalised, materialised by `pfSXWTMaterialize`).

**KEY FACTS:** `pfSXWTParse(buf)` — magic `vawt` (BE text), `size` u32 LE 2..4096 pow2, `count` u16 LE 1..512, flags u16 (0x04 int16, 0x08 full-range), optional `wtmeta` ignored; errors `bad-magic|bad-size|bad-count|truncated`. `pfSXWTImport/Export/Delete/List/Info/Resolve/Coeffs`, `pfSXWTBuiltins()`, `pfSXWTLoadAll()`. Persistence: localStorage `pf-sx-wt` `{v:1,total, tables:{id:{name,size,count,b64}}}` with a ~4.2 M base64-char cap → overflow becomes **session-only** with an honest `{persist:'session'}` (never silent loss). A missing table **falls back to the typed oscillator** (graceful, documented as a feature). Live morph: `pfSXLiveParam('wtPos', v)` retargets ringing pairs; `voiceInfo().wts` reports the crossfade pairs. Banks carry tables as base64 of exact `.wt` bytes (≤8/bank, float32 only) — validator byte-exact; `pfSynEnsurePackTables(pack)` pushes them into the engine **from the installed record, so it works with the pack host down**.

**Reuse verdict:** **PORT** (light edit) — format reader, builtins, persistence-with-cap and the bank-carried-tables pattern are all directly reusable; only the per-sample interpolation (crossfade → worklet ring buffer) is a later upgrade, per the engine header's own roadmap.

---

### 4. `src/app_synthx.js` — microtuning (.scl/.kbm, tuning-library-faithful)

**Paths:** `src/app_synthx.js` `pfSXTuning` L476–619 (`pfSXParseScl`, `pfSXParseKbm`, `pfSXTuningRawCents`, `pfSXTunedFreq`, `pfSXTuningSet/State/Table`) · contract `STAGE10 §1b` · persistence owned by the panel (`pf-syn-tuning`)

**What it is:** Scala `.scl` and `.kbm` import with tuning-library semantics: degree cents `c(d) = cents[pm(d-1,count)] + floor((d-1)/count)*period`; `freq(n) = refFreq * 2^((c(deg(n)) - c(deg(refNote)))/1200)`, clamped 8–20,000 Hz; unmapped/out-of-range keys stay 12-TET; **drums are never tuned**. Applies instantly to new notes and retunes ringing voices; `pfSXTuningTable()` returns the [128] effective frequencies for tests. Tested against 31-EDO and the 128.kbm identity (`cdp_depth`).

**Reuse verdict:** **PORT** on the current engine (pure functions, no deps); the same math re-hosts over a future worklet voice unchanged.

---

### 5. MPE pipeline (per-note channels) — engine + MIDI + panel

**Paths:** `src/app_synthx.js` `pfSXMPE` L619–728 (`pfSXNoteOnCh/OffCh`, `pfSXMPEBend/AT/Cutoff/AllOff`, `pfSXMPESteal`) · `src/app_midi.js` L466–578 + `midiOnInputMessage` routing (`MIDI_MPE_MASTER=1`, members 2–16, bends 24/48/96, CC74→timbre→that channel's filter) · panel switch in `src/app_synthpanel.js`; contract `STAGE10 §1c`; tests `test_midi.mjs`, `cdp_depth.mjs`

**What it is:** full MPE: member-channel notes get their own pool key (`ch:midi`), skip chord/arp/repeat/pedal, still obey scale lock; per-channel bend/pressure/timbre touch only that channel's voices; master channel (1) stays the global path; `pfSXMPEAllOff([ch])`; MPE off releases pending notes.

**Reuse verdict:** **PORT** (both halves — engine calls and the Web MIDI routing/stub-testable surface are directly movable).

---

### 6. Performance layer — arp, latch, chord memory, scale lock, note repeat, mono/glide/pedal, velocity curves

**Paths:** `src/app_synthx.js` — `pfSXArp` L1162–1318 (modes up/down/updown/updown-inc/order/random/chord, divs, latch, 16-step pattern plain/accent/skip/ratchet), `pfSXChord` L1320–1388 (maj/min/maj7/min7/sus4/pow/user + learn), `pfSXLock` (`PFSX_LOCK_SCALES`, snap|fold), `pfSXRepeat` (rate/gate/ramp), `pfSXGlide`/`pfSXMono`/`pfSXPedal`, `PFSX_VEL_CURVES` · panel persistence `pf-syn-arp|play|chord|lock|repeat` · engine laws `STAGE8 §6` · test `verify/cdp_perf.mjs` (46 checks)

**What it is:** the annex/06 "performance-control layer" groovebox kit: arp with latch + pattern row, one-key chord memory with learn, scale lock (snap/fold) applied to every emitted note, note repeat with velocity ramp, sustain pedal (CC64/66 with per-key hold map), mono/legato/glide with note priority, velocity curves + Full Level.

**KEY FACT / LAWS (carry to Anvil):** the **internal-flag arbitration** — `pfSXArp.internal` / `pfSXRepeat.internal` / `pfSXChord.internal` true while emitting/ releasing so no intercepting layer re-expands a walked note; fresh-chord re-seed (grid restarts at step 1); ONE key-up releases every note the key fired (chord map is the routing table); a hard key's velocity resolves chord/lock/repeat/arp FIRST, then rides into the engine as `velN`. Arp/repeat ticks run on `setInterval(…, 25)` and schedule inside a **lookahead window** (law, app_synthx L866–868: "a fixed now+1 ms would smear every step by the timer slack").

**Reuse verdict:** **PORT** — everything except the arp's UI identity; if Anvil wants sample-accurate sequencing, move the tick source to an audio-clock but keep the arbitration laws verbatim.

---

### 7. Drum synthesis kit + DRUM PADS + kit bus

**Paths:** `src/app_synthx.js` — `PFSX_DRUM_KEYS` (kick,kick,snare,snare,rim,clap,hatC,hatC,hatO,tomL,tomM,tomH) L1694, `pfSXDrumKeyOf` (lowest-octave MIDI split), `pfSXDrumBuild(ctx,midi,gain,id)` L1761+, kit bus `pfSXKitBus` (`ctx.__pfKitGain`) L1696+, `pfSXSetDrumLevel` (LINEAR ramp law: deliberately NOT `setTargetAtTime` — measured: target ramps don't progress on a silent graph) · panel `pfSynPadsBuild`/`pfSynPadFlash`/`pfSynPadHit` · kit level knob

**What it is:** nine synthesized drum voices (no samples), each in its own gain into ONE kit bus (which drains into the synth bus → master tap, so the recorder/EQ cover drums too); drum split on the lowest keyboard octave (chromatic: skips scale lock, per law) and a DRUM PADS UI; kit level has its own persisted volume and live ramped apply.

**Reuse verdict:** **ADAPT** — the kit **architecture** (per-kit bus, split law, linear-ramp level, pads UI idiom, steal-safe voice identity) ports; the individual drum synth voices are the part Anvil will want to expand.

---

### 8. `src/app_synthpanel.js` — the SOUND desk (2,741 wc-l, the largest synth-side module)

**Paths:** `src/app_synthpanel.js` · markup `src/body.html` L122–310 (`#synth-panel`, `#sd-bar`, 15 `.syn-sec` sections) · markup/styles `src/styles.css` · contracts `STAGE8`/`STAGE10` §2/`STAGE13`

**What it is:** the SYNTH-mode desk band (Stage 15) — bar + collapsible body, right of the track list above the piano dock; the code drawer never opens in SYNTH mode. Bar: blend buttons, scenes, voice select, PATCH BANK select, PACKS jump, ⧉ pop-out (document-PiP `sdPopMount`), engine LED. Sections: VOICE, PATCH (knobs + preset save/apply/reset + bank), PERFORM (arp/velocity/voice mode), CHORD, LOCK, REPEAT, ARP pattern row, MOD matrix, SCENES, DRUM PADS, WAVETABLE, TUNING, HARDWARE, SYSTEM-ish.

**KEY FACTS (function names, laws):**
- **Blend law (`pfBlendSet`)**: `synth|beats|mix|off` — `pfSXSetAudible(pfBlendWantsSynth())` mutes/unmutes the keys bus; pattern stop is the quiet STOP; persisted `pf-blend`; desk switches pick the sane default (`pfBlendDeskDefault`). Note "beats can never arrive silently-switched-on".
- **One law, three callers**: every full patch lands via `pfSynApplyPatch(voice, def)` (preset apply, bank apply, FACTORY restore) — it deep-copies the def, live-rides ringing voices, syncs `state.synthpanel.voices[voice]`, and returns false when the def can't legally land.
- Presets: localStorage `pf-syn-presets` `{name:{voice,def}}` (save/apply/delete/paint). Bank: `pfSynBankList/Paint/Apply` merge every installed pack with `patches`; bank apply first pushes pack-carried wavetables (`pfSynEnsurePackTables`) then walks `pfSynApplyPatch`; mirror selects (`syn-bank` + bar `sd-bank`).
- Scenes: 4 slots  (`pfSynSceneSnapshot/Store/Recall`, Shift+click store) persisted `pf-syn-scenes`; topbar A/B buttons call the same functions.
- Mod matrix UI: `pfSynModBuild/Knobs/Paint` + seeded dice (`pfSynModDice`, mulberry32 `00000000`-hex seed — "deterministic, no deps").
- Fit/layout: `pfSynFit`/`pfLayoutFit` (desk folds to bar under 156 px; `SYN_FIT_MIN`); pop-out save/restore rect laws.
- Panel idiom laws (STAGE10 §2): knobs via `knobHTML`/`knobBind`; persistence via localStorage + try/catch; engine calls guarded `typeof pfSX… === 'function'`; **no new top-level name collisions** (build's `node --check` catches); no new document keydown listeners.

**Reuse verdict:** **ADAPT** — the desk frame (bar/columns/collapse/pop-out), blend law, patch-apply funnel, preset/bank/scene persistence and knob idioms all port; the flagship's osc/FX section UIs are new work on top.

---

### 9. `src/app_kb.js` — note router, piano dock, keymap (1,322 wc-l)

**Paths:** `src/app_kb.js` · markup `src/body.html` (#piano-dock) · contract `STAGE8` §1 bridge

**What it is:** the ONE keydown dispatcher (`kbHandle`, law: never add a second document listener) + the 61-key piano dock (keyboard map `PIANO_WHITE/BLACK_KEYS`, octave windows, mouse/touch) + input modes `studio|keys|midi` (`KB_MODES`) + desk mode `strudel|synth` (`kbDesk`). Hardware velocity via `kbNoteGain`; held-note tracking `kbHeldNotes`/`kbHeldByKey`; `kbNoteDown/kbNoteUp` resolve to the NATIVE engine first (`pfSXNoteOn/Off`) — the old holding-stack-then-evaluate path is now only the fallback preview (comment L432).

**KEY FACTS:** `KB_DEFS` is the single source of truth for shortcuts (the `?` overlay, Kody teach lines and the AI guide mirror it; `codegen_test.mjs` asserts the FNS/groups sets — adding actions = extend KB_DEFS + the test, "fails loudly — that is the point"). `SYNTH_VOICES` (10 dock voices) lives here and feeds panel + engine. Keys pop-out to their own window (Stage 18, `cdp_pop.mjs`); dock keeps only a rail in-app.

**Reuse verdict:** **PORT** — the note path (down/up → engine, velocity, held sets), keymap discipline and dock UI all move; Anvil swaps the patch list but keeps the laws.

---

### 10. `src/app_midi.js` — the MIDI panel (2,302 wc-l)

**Paths:** `src/app_midi.js` · hub page `hubMidiHTML`/`hubWireMidi` · tests `verify/test_midi.mjs` (stubbed + `--real` mode), `cdp_perf.mjs` (stubbed input)

**What it is:** full Web MIDI in/out: port picking + auto-pick (`midiPorts/For/AutoPick`), decode (`midiDecode`), note routing to the engine (`midiNoteOn/Off` → `kbNoteDown/Up` semantics + native engine), **MIDI monitor** (in/out rows, rate cap 240 msg/s, dropped counter, 60-entry debug buffer, 12 DOM rows), feedback-guarded out tap (`midiOutTapInstall`, `midiSelfSend`), test send, track routing (`.midi("dev")` code routing: `midiRouteTrack/All`, quote-escaping law), default CC map + learn (`midiSetPlayIn`, "learn always wins"), pitch bend/aftertouch, **MIDI clock OUT tied to transport** (`midiClockOutTransport` from every stop path), and the MPE row (see entry 5).

**KEY FACTS:** prefs persisted `pf-midi`; status states `unsupported|idle|asking|enabled|denied|failed` with an honest browser note; monitor is capped and rate-limited (DOM never floods). The stub injection (suite-side) makes it headless-deterministic.

**Reuse verdict:** **PORT** (light edit) — the whole panel + routing + monitor + clock is exactly what a flagship browser synth needs; only the host page tabs change.

---

### 11. `src/app_fx.js` — 15-band EQ, meters, and the "not an audio witness" law

**Paths:** `src/app_fx.js` (678 wc-l) — `PF_EQ_MODES`, `PF_EQ_BANDS = 15`, `pfEqEnsureAnalyser` (attaches its own AnalyserNode to the master tap node), `pfEqSample/Draw/Tick`, `pf.eqBands()` debug surface (L668) · `pfAttachMeters` in `src/app_export.js` L1479

**What it is:** the topbar 15-band spectrum EQ (live view of the master tap) + the code-visualiser effects (10 loading.io-style effects, Emoji Rain, STRIP mode — **UI candy, not audio DSP**: `pfFx*` drive canvases only, no Web Audio nodes).

**KEY FACTS / LAW (costs blood if forgotten):** `pf.eqBands` is **NOT an audio witness**. Tests must install their **own AnalyserNode on `pfMasterNodes()`** and set blend `'synth'` before measuring (restore `'beats'` after) — `cdp_mixvol.mjs` and `cdp_synthx.mjs` show the pattern (`__pfsxEB` helper reads real bands). Also: one analyser per tap; offline contexts are never tapped (recorder attach law).

**Reuse verdict:** **ADAPT** — take the EQ/metering harness (analyser on the master tap) and the witness law verbatim; the visualiser effects are optional/skip for the synth.

---

### 12. `src/app_export.js` — the master tap and volume buses (the load-bearing integration)

**Paths:** `src/app_export.js` L1251–1510 (`PF_CAPTURE_WORKLET_SRC`, `pfTap`, `pfInstallAudioTap`, `pfTapMasterFor/BeatsFor`, `pfMasterNodes/OnNode/Apply`, `pfBeatsNodes/Apply`, `pfAttachMeters`, `pfVolRemember`) · consumers in `app_synthx.js`, `app_synthpanel.js`

**What it is:** the trick that makes everything cover everything: `pfInstallAudioTap()` patches **`BaseAudioContext.prototype.destination`** BEFORE the engine boots (called from `boot()`), so every sound the app makes (superdough/Strudel engine AND the native synth) routes through a chain of gain nodes the app owns: engine → **BEATS bus** → **MASTER node** → real destination. The recorder, WAV/stem export, meters and EQ analyser all ride `pfTap.node`; the **native synth does NOT land on `ctx.destination`** — `pfSXOut()` returns `pfTap.node` directly and the synth has its own KEYBOARD VOL gain in series before it (`pfSXKeysFor`). `maxChannelCount:2` + `__pfTap/__pfMaster/__pfBeats` markers keep superdough and the tests honest.

**KEY FACTS / LAWS:** MASTER VOL rides the tap gain node — **never the document** (the old `.gain()` in the generated `all()` line recompiled the whole document per knob move; law #1 in STAGE13). Two buses: BEATS VOL scales the pattern side only; KEYBOARD VOL scales the native engine only; MASTER scales the sum — proven with a real AnalyserNode + real drags in `cdp_mixvol.mjs`. Offline render contexts (`startRendering`) are explicitly not tapped. The tap re-points itself if it attaches after a bus was built.

**Reuse verdict:** **PORT** (as-is, near-verbatim) — this is the single most valuable structural reuse: build the tap first, then everything else (volumes, recorder, meters, EQ) comes free.

---

### 13. `src/app_export.js` — recorder + export pipeline (WAV/Opus/MIDI/DAWproject/.wt tools)

**Paths:** `src/app_export.js` (1,776 wc-l total) — recorder L1251–1450 (`pfRec`, `pfRecReleaseCapture` idempotent teardown, `pfRecStart/Stop`, `pfRecCollect`, `pfRecFlush`, `pfTrimTake`) · encoders/tools L20–850 (`pfEncodeWav`, `pfParseWav`, `pfAudioStats`, `pfWav*` table extraction `pfWavExtractTable/pfWavTrack/pfWavClusterPool/pfWavPhaseAlign/pfWavKeyedTable/pfWavStackTable`, `pfWtContainer`, `pfWtParse`, `pfWtToStackWav`, `pfTableResample/Morph`, `pfFft/Inv`) · `pfBuildMidi` L1040, `pfBuildDawprojectXML` L1123, `pfImportDoc` L1197, `pfZip`, `pfCrc32`, `pfSlug`, `pfTimeStamp`

**What it is:** the whole capture/export bench: a **capture branch** on the master bus (AudioWorklet `PF_CAPTURE_WORKLET_SRC` with a ScriptProcessor fallback — dual path for https/file://), record master or stems (per-track splice taps), WAV 16/24/32-float + Opus, take list in the hub, plus **WAV→wavetable extraction** (period search, cycle clustering, phase alignment — the "FROM WAV → .wt" feature), MIDI file export, and DAWproject XML (Ableton/FL/Bitwig stems kit). Offline renders are excluded from the tap, so bounces don't feedback.

**Reuse verdict:** **PORT** — recorder, WAV bench and the .wt extraction pipeline are directly reusable; only branding/formats per Anvil.

---

### 14. `src/app_core.js` — share link + hostile-input state sanitisation (+ `app_data.js` state model)

**Paths:** `src/app_core.js` (594 wc-l) — `shareUrl()` L298, `loadFromHash()` L409, `pfSanitizeState` L346+, `pfNormalizeTrackBodies`; state factory/defaults and the tuning/waveform catalogs live in `src/app_data.js` (775 wc-l: `SCALES`, `TUNING_SETS` — equal/just/overtone4/overtone8, `JUST_TABLES`, transform/partials catalogs)

**What it is:** whole-project share = the state JSON, base64'd into the URL hash (`#s=…`); loading sanitises EVERYTHING (audit-hardened): null-prototype objects, `__proto__`/prototype keys skipped (a JSON `__proto__` key used to SET the prototype and let code execution through), per-type caps (strings 400/20000, arrays 512, depth 8), non-enumerable `Symbol.toPrimitive` so coercion can't throw, and — from a LINK specifically — `raw`/`libs`/track `extra|code|pattern` code fields are **dropped** (a link may never execute code); render failure rolls back to the previous state and refuses.

**Reuse verdict:** **ADAPT** — the *pattern* (b64 URL payload + paranoid sanitisation + rollback) is right for synth patch/link sharing, but Anvil needs its own payload schema and its own field-drop policy; copy the sanitizer, not the state shape.

---

### 15. `src/app_store.js` — the pack storage layer (IndexedDB)

**Paths:** `src/app_store.js` (415 wc-l) · record shape `{id,name,kind,file,sha256,size,at,v:1,pack}` · DB `pf-packs-store` v1 OS `packs` · engine glue `pfSynWtB64ToBytes`, `pfSynEnsurePackTables`, `pfSynEnsureLine`, `pfSynReleasePackTables`

**What it is:** the durable home for downloaded packs (audio-friendly IDB, legacy localStorage `forge-packs` migrated once then retired; fallbacks `'idb'|'ls'|'mem'` reported honestly). Async verbs `pfPacksOpen/Hydrate/Put/Delete/Get/Count/Estimate`; quota failure (`{ok:false,error:'quota'}`) means NOTHING is recorded as installed; a hung `indexedDB.open` gives up after **1.8 s** (boot must not be held hostage) with a **late adoption** (`pfPacksAdoptSoon`/`pfPacksAdoptDb` — one quiet retry ~4 s later that adopts the DB and lands session-installed packs; removals made meanwhile are honoured in both directions). `pfSynReleasePackTables(id, pack)` gives a removed bank's wavetables back — unless a live patch still wears them or another installed pack carries the same id.

**Reuse verdict:** **PORT** (as-is) — this is a finished, audit-hardened installer; Anvil only changes pack kinds/schema.

---

### 16. `verify/synth_pack_schema.mjs` — the `.pfsynth` spec and validator (single source of truth)

**Paths:** `verify/synth_pack_schema.mjs` · consumed by `harvest/build_synth_packs.mjs` (authoring gate) and `verify/verify_packs.mjs` (shipping gate) — "the two can never drift apart"

**What it is:** exports `SYNTH_PACK_FORMAT='pfsynth'`, `SYNTH_PACK_VERSION=1`, `SYNTH_PACK_MAX_BYTES=20 MB` (soft 10 MB), `VOICE_IDS` (10 dock voices), limits (`OSC_TYPES`, `FILTER_TYPES`, freq clamp 40 Hz, fm depth = index·freq·mul), `validatePatch(p, path)`, `validateSynthPack(pack)`, `validateSynthPackFile(buf)`, and the wavetable laws from entry 3 (`SYNTH_PACK_MAX_WAVETABLES=8`, `WT_ID_RE`, builtin ids, byte-exact header math, **PATCH REFERENCE LAW** — every `oscs[i].wt` must be a `gen:` builtin or declared in the same pack; ERROR when shipped packs lean on the engine graceful-fallback).

**Reuse verdict:** **PORT** (as-is for the concept and most rules) — Anvil extends the validator with its new engine fields; the "validator is shared code, errors not clamps" doctrine is the real prize.

---

### 17. Pack authoring/verification pipeline — build → verify → stamp

**Paths:** `harvest/build_synth_packs.mjs` (validate authored banks → byte-copy into `<deploy>/packs/` → upsert `index.json` id/name/kind/file/size/sha256/patches/patterns/author/license/guidance → reset `verified` when bytes change) · `verify/verify_packs.mjs` ("runs synth packs too"; per-pattern engine proof, `--only`, `--no-stamp`; writes per-pattern compatibility + `compat.json`) · `verify/_stamp_synth.mjs` (parent-only re-stamp of index.json + compat.json with engine proof) · authoring content in `harvest/synth_packs/*.pfsynth.json` (14 banks: 7× AKWF vols, bass-leads, keys-bells, mathwaves-vol1, motion-lab, mpe-pads, terrascan-vol1, wt-lab — all CC0/self-generated) · deployed store stats: **101 packs in `deploy/packs/index.json`, 14 of them `.pfsynth` synth/both banks** (counted 2026-10-06)

**What it is:** the full content supply chain: authored JSON → schema gate → deploy copy → engine-verified stamp → client installs with sha256 check. "A bank is a text file anyone can diff, and a stamp says the engine itself proved each pattern/patch."

**Reuse verdict:** **PORT** — the pipeline transfers wholesale; only the content (Anvil factory banks) is new.

---

### 18. Store UI + hub console — `src/app_ui.js` + `src/app_hub.js`

**Paths:** `src/app_ui.js` (2,493 wc-l; public API object with `packsInstall` L152 ff, `packsUninstall`, `packsLoadPatch/Pattern`, pack cards/sections `PATTERN PACKS`/`SOUND BANKS` ~L2100, sidebar panes, LANDS-IN chips) · `src/app_hub.js` (1,164 wc-l; `HUB_TABS`, console strip `hubRenderStrip`, mixer HTML `hubMixHTML`, recorder HTML `hubRecHTML`, takes, export `hubExpHTML`, guide/onboarding, a11y dialog machinery `pfA11yDialog/pfModalWatch/pfFocusSave`)

**What it is:** the install UX (download → **sha256 verified against the store manifest** before install → `pfPacksPut` decides outcome — "an install that cannot persist is not 'installed'" → toast counts; uninstall releases engine tables; availability filters `all|synth|strudel`; per-card licence/size/source guidance) plus the mix/rec/export console the synth's output lands in.

**Reuse verdict:** **PORT** for the install flow and cards; **ADAPT** the hub console (it is pattern-centric — takes/mixer/export reuse, track-list assumptions rework).

---

### 19. `src/app_knob.js` — the knob framework (333 wc-l)

**Paths:** `src/app_knob.js` · used everywhere in panel/hub/mixer · feel suite `verify/cdp_knob_feel.mjs`

**What it is:** `knobHTML(path,label,opts)`, `knobBind(root)`, `knobCommit`, `knobApplyVisual`, `knobRefreshAll`, `knobNormToVal/ValToNorm` (curves + steps), `knobFormat`, `knobRowHTML` — a complete drag/twist/keyboard knob with damped travel, mechanical stops and readout, plus the `state` write path. All synth knobs already ride it.

**Reuse verdict:** **PORT** (as-is) — no reason to redesign; the flagship's bigger panel needs more knobs, not new knob tech.

---

### 20. `src/app_voice.js` — Kody's speech in/out (305 wc-l)

**Paths:** `src/app_voice.js` (`pfVoiceToggle`, `pfVoiceSpeakBrowser`, `pfVoiceListenStartApi/Browser`, `pfVoiceCleanText`, persisted `pf-voice-v1`) · used by Kody teach lines throughout the synth panel

**What it is:** browser TTS + optional API TTS, and STT via SpeechRecognition or a MediaRecorder+API path, with state labels and mic lifecycle handling. Not a synthesis component.

**Reuse verdict:** **SKIP** for engine purposes (optionally reuse later for a Anvil assistant/announcer; it is small and self-contained).

---

### 21. `src/app_codegen.js` — the sequenced side (what "synth tracks" are today)

**Paths:** `src/app_codegen.js` (424 wc-l; `synthPattern(t,i)` L145, `samplePattern`, `drumsGrid` etc.) · `verify/codegen_test.mjs` (212 pure-logic assertions, builds its harness from `src/app_data.js + src/app_codegen.js`)

**What it is:** the GUI-model → Strudel-code compiler. A `type:'synth'` track is NOT rendered by the native engine — it compiles to superdough code (`.s("sawtooth")`, `.partials([...])`, `.fm()/.fmh()`, `.lpf/.lpq/.lpenv`, `TUNING_SETS` spectral `freq(...)` sets, morph via interpolated partials, vel grids...). **No `registerSound`/`pf_voice` bridge exists in the shipped tree** — the plan's "engine:'native' sequenced tracks" idea is unshipped. So today: live play = native engine (instant); grid play = Strudel document (grid-locked but via the pattern path).

**Reuse verdict:** **ADAPT** — keep the codegen as an interchange/render path (and its tuning/pitch math: `pfParseScale`, `pfDegreeToMidi`, `JUST_TABLES`, `TUNING_SETS` are directly useful), but Anvil must build the native sequencer bridge (gap list #3) rather than inherit it.

---

### 22. `verify/` — the suite catalog and the battery/freeze culture

**Paths:** `C:\Users\Moddy\pattern-forge\verify\` (60+ `.mjs` gates/probes + fixtures) · battery runners `harvest/_rc_battery.sh` and `harvest/_audit_battery.sh` (sequential, per-suite logs into `harvest/_audit_<name>.log`, summary block; `--skip-heavy` skips stress) · logs `_batt8_*`, `_battD_*` document the counting culture

**The suites (filename → scope; ★ = directly applies to Anvil):**
- ★ `cdp_synthx.mjs` — native engine: keys/mouse/MIDI play through the app's own tap, document untouched, 16-voice pool + stealing, all 10 patches audible; onset measured from live EQ (57 checks reported).
- ★ `cdp_depth.mjs` — .wt import/playback/export, .scl/.kbm (31-EDO, 128.kbm, unmapped fallback), MPE isolation, hardware profile, reload persistence, Stage-11 bank table imports (57 checks).
- ★ `cdp_depth_ui.mjs` — WAVETABLE·TUNING·HARDWARE surface end-to-end (ids, hints read engine truth, crossfade pair builds, live pos, OFF hands back).
- ★ `cdp_perf.mjs` — performance layer: arp+latch, velocity curve, CC64/CC66, CC map, bend/AT, mono/legato/glide, Stage-8 laws, delay tail after dry voice (46 checks; stubbed Web MIDI).
- ★ `cdp_mixvol.mjs` — volume buses with a REAL AnalyserNode on `pfMasterNodes()` + real drags: BEATS scales pattern only, KEYS scales synth only, MASTER the sum; persistence.
- ★ `cdp_synth.mjs` — desk switcher STRUDEL↔SYNTH with real key events (30 checks era).
- ★ `cdp_sound.mjs` — Stage-15 SOUND desk band in the work area (header bar, three columns, drawer-free).
- ★ `cdp_stress.mjs` — N-minute mixed-load stress (keyboard, MPE, morphs, live moves, tuning, profile switches) sampling voices/heap/frames, then proves health; `--url` variant runs against the live site.
- ★ `cdp_store.mjs` — pack store end-to-end v2: real packs over HTTP+CORS, install into IDB (sha256 checked vs manifest), patches load+PLAY (measured on EQ), strudel pack regression (44 checks).
- ★ `test_midi.mjs` — Web MIDI both directions incl. stub `--real` modes, MPE section.
- ★ `test_keys.mjs` — physical keyboard drives the app (REAL CDP `Input.dispatchKeyEvent`) (75 checks).
- `cdp_smoke.mjs` — full boot: engine, sections, zero page errors (~2 min; waits `__FORGE_READY` ~20 s CDN).
- `cdp_layout/fit/ui/ui_persist/shell/nav/pop/knob_feel/extras_ui/dancer/fx/hub/contrast/a11y_dialogs/lifecycle/hardening.mjs` — chrome, fit ladder, persistence-before-boot, pop-out windows, knob feel, hub console, visualiser, contrast, dialog a11y, resource-lifecycle audit, 2026-09-26 audit regressions (F1–F5).
- `verify_packs.mjs` (+ v1/v2 archive), `synth_pack_schema.mjs` (entry 16), `codegen_test.mjs` (212 pure-logic), `test_live_site.mjs` (deployed-site checks; count bar grows per stage — 15 by Stage 11), `_stamp_synth.mjs`.
- Lab-only: `_probe_*.mjs` (~40), `_s*-shots`, `_diag*` — scratch probes, not gates.

**Culture (reuse the METHOD, not just the files):** build → freeze artifact → battery (sequential, honest logs) → deploy → **live check**; count lines are contract ("the suite's own total honest"); flakes recorded with evidence not hand-waved; harness laws from STAGE10 §4/STAGE13 #7–11: `Emulation.setDeviceMetricsOverride{1440,900}` (headless ignores `--window-size`), `--mute-audio`, temp `--user-data-dir` profiles killed on exit, `process.exit()` or the shell hangs, no regex literals inside template-literal CDP evals, `{value:…}` unwrapping, don't pass `--disable-background-networking` (kills the CDN boot).

**Reuse verdict:** **PORT** — copy the harnesses/launch pattern and the freeze/battery doctrine; `cdp_synthx`/`cdp_depth`/`cdp_perf`/`cdp_mixvol`/`cdp_store`/`cdp_stress` are near-transferable once selectors/IDs match.

---

### 23. Deploy tooling + live verification

**Paths:** `C:\Users\Moddy\radio-browser\upload-site.py` (SFTP/FTP uploader; skips unchanged files after comparing bytes BACK from the server; **`--verify`** fetches every file over https and compares SHA-256; `--only <files>` ships a subset; credentials never in the script/history) · `verify/test_live_site.mjs` (deployed app: engine boots, store talks to live packs, a store pack installs) · deploy tree `radio-browser/deploy/{forge/index.html, packs/*}` · helper scripts in `harvest/`: `check_bakery.py`, `_check_pack.mjs`, `_pprecheck.py`, `_audit_served_packs_check.py`, `_add42_*` etc. (the "check-*"/precheck culture: every content batch gets a checker script)

**What it is:** the release loop Anvil inherits as-is: `python3 build.py` → battery → `python3 upload-site.py --only forge/index.html` → `upload-site.py --verify` → `node verify/test_live_site.mjs`. Rollback = re-upload previous artifact (sha recorded per release).

**Reuse verdict:** **PORT** (as-is) — same host, same script, new deploy subfolder.

---

### 24. Docs, contracts, annexes, licence policy — the working method to copy

**Paths:** `SYNTH-REBUILD-PLAN.md` (22 KB; §0 verdict, §2 Surge conversion map, §4 pack/store design, §5 phases 0–4 — **all phases shipped** per Stage-11 status: engine core, surface+performance, sound bank/store, depth) · `STAGE8-CONTRACT.md` (engine API freeze §1, wave-1 laws §6) · `STAGE10-CONTRACT.md` (depth API §1a–d, panel/midi lane specs, "laws that already cost blood" §4) · `STAGE11-CONTRACT.md` (bank format addition; lane ownership — **one writer per file; labs never touch the engine file**, lab clones + sha256 merge protocol) · `STAGE13-CONTRACT.md` (MIX-lane laws: master-tap volume, single keydown dispatcher, END-CHEEK insets, `display:flex` vs `hidden`, return-channel format) · `annex/01–06` · `LICENSE` (AGPL-3.0-or-later, top-level) · `THIRD-PARTY-NOTICES.md` · `README.md`

**KEY FACTS / annex one-liners (why each matters to Anvil):**
- **annex 01 (25 KB)** — Surge XT DSP→Web Audio portability inventory: per-oscillator/filter/FX algorithms with source paths + EASY/MEDIUM/HARD ratings; the engineering reference for new osc/filter engines (and proves the "reimplement, never paste" path).
- **annex 02 (27 KB)** — Surge content formats + licensing verified on bytes: `.fxp`→XML structure, `.wt` spec details, patch tag vocabulary; **Surge factory data is NOT shippable** (licence unresolved upstream, surge#6741) — reference only.
- **annex 03 (20 KB)** — licence-clean sound sources + conversion pipeline (AKWF CC0, WaveEdit CC0, sf2 tooling) — the source veto list for content.
- **annex 04 (9 KB)** — FX architecture decision: `file://` is load-bearing → **node-graph FX core, worklets hosted-tier only**; AGPL unlocks copyleft DSP reuse (reimplement/adapt) — decides Anvil's FX technology.
- **annex 05 (9 KB)** — sound-pack playback/pipeline: SF2 already playable via the Strudel engine, ZIP+manifest+strudel.json, IDB install, size budgets (5–15 MB packs / 20 MB cap).
- **annex 06 (9 KB)** — the performance-controls gap check that defined the shipped arp/chord/lock/repeat layer; the "do not build" list.
- **Licence/attribution policy:** app is AGPL-3.0-or-later; THIRD-PARTY-NOTICES says "bundles no third-party code/media/data"; runtime fetches (Strudel pinned `@strudel/repl@1.3.0`, three@0.147.0) stay unpinned-to-runtime, never vendored; influences credited (Minimoog/DX7 theme, strudel-box, ryukau). **Rule for Anvil: reimplement, attribute, never paste; factory content only from CC0/MIT/self-generated sources; per-pack licence line on every card.**

**Reuse verdict:** **PORT** — copy the contract/lane/freeze/return-channel methodology and the licence doctrine; the plans themselves are reference reading, not code.

---

## GAP LIST — what does NOT exist in Pattern Forge that the flagship needs

1. **Sample-level DSP (AudioWorklet) engine.** Current voice = node graph + `PeriodicWave` wavetable *crossfade* (2 osc per table slot) — no ring-buffer wavetable playback, no osc sync/PWM, no unison stacks, no true FM matrices, no per-sample anti-aliasing. The engine header itself names the worklet-DSP engine as "the next phase". (Paths: `app_synthx.js` header L7–10, `pfSXVoiceBuild` L869–1023.)
2. **Polyphonic per-voice modulation.** Mod matrix is **4 global slots, one shared LFO** (`pfSXMod`, src lfo/vel/at → dest cutoff/pitch/amp); velocity is baked at voice build, AT live. No per-voice LFOs, no MSEG/multi-envelopes, no arbitrary source→dest routing, no matrix UI beyond 4 rows. (Paths: `app_synthx.js` L202–283, `app_synthpanel.js` `pfSynModBuild`.)
3. **Native-engine sequencing + step-sequencer UI for it.** Grid tracks compile to Strudel/superdough code (`app_codegen.js synthPattern`); bare `synth.steps` exists for the code side; **no `registerSound('pf_voice', …)` bridge and no `engine:'native'` flag exist** — sequenced play and live play are two different instruments today. A flagship needs (a) native voice hosting for sequenced events with grid-accurate scheduling, (b) a step-sequencer UI bound to the native engine. New build.
4. **Full per-patch FX chain.** Native path ships only **chorus + delay sends** on the synth bus (`pfSXFXFor`); no reverb (generated-IR reverb exists only inside the Strudel engine), no phaser/distortion/EQ/filter-FX/dynamic effects, no per-patch FX order UI. (annex 04 has the build shortlist.)
5. **Sampler / multisample engine in the native voice.** No sample playback through the native engine (SF2/samples only via the Strudel side, or WAV→.wt offline extraction). A flagship with sampled instruments/imports needs a new sampler layer (content pipeline exists in annex 03/05).
6. **Patch library ergonomics: tagging, categories UI, ratings, favourites, search across banks; in-app patch export/share.** Today: presets = localStorage name→def; banks group by pack; pack index carries licence/size/author; no tags UI, no stars, no patch search, no "export this patch" action (authoring is script-side). Share exists only for whole *pattern projects* (`#s=` state b64).
7. **Accounts / community backend / user uploads.** Everything is static files + client-side install; no accounts, no cloud sync, no ratings/comments, no user-submitted packs path beyond the manual harvester scripts + `check_bakery.py`.
8. **Audio-clock sequencing for the performance layer.** Arp/repeat/note-repeat use `setInterval(…,25)` + lookahead-window scheduling (a documented law, `app_synthx.js` L866). Fine at groovebox fidelity; a flagship-grade sequencer wants an AudioContext-clock scheduler; the arbitration laws (STAGE8 §6) must ride along.
9. **Polyphony/CPU headroom for bigger voices.** 16 voices (8 on the low profile), single-core budget asserted only by the stress suite; a worklet engine + per-voice mod + more FX will need a measured voice budget (cdp_stress is the template).
10. **Modern instrument extras seen in the plan but unshipped:** MTS-ESP (only .scl/.kbm arrived), MIDI learn per-parameter UI beyond the CC map, per-note expression beyond MPE bend/AT/timbre, patch morphing UI, macro controls (the scenes snapshot is closest).
11. **Docs/help content for a new surface** — help/tour/KB_DEFS/codegen FNS sets must be extended with the new desk (laws say so; `codegen_test.mjs` fails loudly by design).

---

## Reuse summary table

| # | Module | Verdict | Effort estimate |
|---|--------|---------|-----------------|
| 1 | build.py + single-file artifact | PORT | S — hours (1–2 h) |
| 2 | app_synthx.js voice core | PORT | S–M — largely move; M to extend osc engine |
| 3 | Wavetable system (.wt + builtins + bank carrier) | PORT | S–M |
| 4 | Microtuning (.scl/.kbm) | PORT | S (hours) |
| 5 | MPE pipeline | PORT | S–M |
| 6 | Performance layer (arp/chord/lock/repeat/pedal/glide) | PORT | S–M |
| 7 | Drum kit + pads + kit bus | ADAPT | M — architecture ports, voices expand |
| 8 | app_synthpanel.js SOUND desk | ADAPT | L — frame ports, new osc/FX sections |
| 9 | app_kb.js note router/dock/keymap | PORT | S–M |
| 10 | app_midi.js MIDI panel | PORT | S–M |
| 11 | app_fx.js EQ/meters + witness law | ADAPT | S — take EQ + law; skip visualisers |
| 12 | Master tap & volume buses | PORT | S — copy near-verbatim |
| 13 | Recorder & export pipeline | PORT | S–M (light format edits) |
| 14 | Share link + state sanitisation | ADAPT | M — new payload schema, same sanitizer |
| 15 | app_store.js pack storage | PORT | S–M |
| 16 | synth_pack_schema.mjs validator | PORT | S — extend fields |
| 17 | Pack pipeline (build/verify/stamp) | PORT | S — new content |
| 18 | Store UI + hub console | PORT/ADAPT | M — install flow ports; console rework |
| 19 | app_knob.js | PORT | S (hours) |
| 20 | app_voice.js (Kody speech) | SKIP | — (optional later, S) |
| 21 | app_codegen.js sequenced-side synthesis | ADAPT | M — keep as interchange; build native bridge (gap #3) |
| 22 | verify/ suites + battery culture | PORT | M — retarget selectors/IDs |
| 23 | Deploy tooling + live checks | PORT | S (hours) |
| 24 | Docs/contracts/annexes/licence policy | PORT | S — reference + copy method |

**Bottom line:** the flagship reuses Pattern Forge's *infrastructure* almost wholesale (build/tap/buses/recorder/store/pack pipeline/knobs/harness/deploy — the expensive, hard-won parts), and its *instrument core* in large part (voice engine, wavetables, microtuning, MPE, performance layer, drums). The genuinely NEW engineering for a flagship lives in four places: a sample-level AudioWorklet DSP engine (gap 1), a per-voice modulation system (gap 2), native-engine sequencing + step UI (gap 3), and a fuller FX/sampler surface (gaps 4–5) — plus library/account ergonomics (gaps 6–7) at product level.

```json
{"file": "C:\\Users\\Moddy\\anvil\\research\\reuse\\T9-pattern-forge-reuse.md", "items_count": 24}
```
