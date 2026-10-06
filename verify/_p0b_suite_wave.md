# Anvil P0b — keyboard + MIDI wave: pre-staged plan (2026-10-07)

Purpose: zero-idle freeze-time dispatch. Read this file first if resuming after a compaction.
Trigger: `src/av_kb.js` + `src/av_midi.js` land (deleg_dd2076d5).

## 0. State
- Wiring staged UNCOMMITTED: `build.py` js_parts (av_tap → av_knob → av_note → av_kb → av_midi → app_core), `app_core.js` (boot calls avKbInit/avMidiInit, avState.bpm=120), `body.html` (dock markup + #av-midi-body + #btn-piano), `styles.css` (dock + MIDI CSS).
- Committed: kb/midi digests + `av_note.js` bus (807567f); baseline knobs+feel 18/18 + smoke 8/8 on sha 9a5c25c4.
- Build is BROKEN by design until both port files exist. Parent builds only after both land.

## 1. Parent verification on port delivery
1. `ls -la src/av_kb.js src/av_midi.js` — both exist.
2. `node --check src/av_kb.js && node --check src/av_midi.js`.
3. `python3 build.py` → record new sha256 + bytes. (Parent owns the build; agents never run it.)
4. Regression gate on the new bytes: `node verify/cdp_smoke.mjs` (expect 8/8) + `node verify/cdp_knob_feel.mjs` (expect 18/18).
5. Visual duck-check: screenshot the built page (headless Edge) → `renders/p0-keys.png` — dock with 61 keys, rail chips, MIDI card.
6. Green → Commit A: "P0: keyboard + MIDI ports land (av_kb.js + av_midi.js) — build green, smoke+feel re-run". Red → fix (parent or fix-up child), rebuild, repeat.

## 2. Suite wave — two children, SERIALIZED (one browser suite at a time)
Common harness: copy the launch skeleton from `verify/cdp_smoke.mjs` (free port scan, temp --user-data-dir, --headless=new, --mute-audio, --autoplay-policy=no-user-gesture-required, 1440×900 metrics override, explicit exit, kill only own-profile processes, windowsHide).
HARD LAWS: never run build.py; never edit src/*; fix ONLY your own suite file; app bugs come back as minimal repros (what / expected / actual / how to see).

### Child A — write + run `verify/cdp_keys.mjs`
Sources: `research/reuse/kb-port-digest.md` §1–§6 (observables), PF `verify/test_keys.mjs` (phases to adapt), the port file itself. Adapt names to av-; DROP PF-only phases (workstation keys, Kody, tracks, drawer, popout, desk split).
Checks:
- boot + dock present: 61 `.pk-key` (36 white + 25 black) built into #piano-keys.
- fresh state: mode STUDIO, exactly one lit `#pk-modes` chip, hint mentions STUDIO.
- KEYS chip click → mode 'keys', avArmed true, `#pk-arm-led.on`, body.kb-armed.
- typing: keydown A → `window.__lastNotePreview === 'c4'`; keyup → avNoteHeld empty (window.__avNotes), no drone.
- backquote toggles STUDIO↔KEYS; Esc disarms; leaving KEYS stops all notes.
- MIDI chip: letters swallowed (no note, no error).
- pointer: pointerdown on a `.pk-key` plays its data-note; pointerup releases; glide across keys.
- octave: `[` / `]` shift the window (`#pk-win` text changes, notes shift); edges clamp 0..3.
- a11y: keyboard Enter/Space on a focused key plays + auto-releases (detail-0 path).
- persistence: mode survives reload via localStorage `av-input-mode`; corrupt value → STUDIO fallback.
- zero console errors; screenshots → `renders/p0-keys-*.png`.
Report: {file, lines, checksPassed, checksFailed, appBugs[], shots}.

### Child B — write + run `verify/cdp_midi.mjs` (dispatch AFTER Child A returns)
Sources: `research/reuse/midi-port-digest.md` §1–§9; PF `verify/test_midi.mjs` L41-121 = the EXACT stub shape to port (fake requestMIDIAccess unsupported|grant|deny; InPort/OutPort; OutPort on window.MIDIOutput so the app's prototype tap is exercised), injected pre-boot via `Page.addScriptToEvaluateOnNewDocument`.
Checks:
- unsupported: no ENABLE, honest note naming Safari; denied: NotAllowedError → denied + padlock copy; enabled after a REAL click; `requestMIDIAccess` called with no sysex (stub log).
- device rows render; hotplug add/remove updates without refresh.
- play-in: stub fires note-on → `window.__lastNotePreview` set AND avNoteHeld gains the name; note-off releases; velocity 127 → gain 1 (avNoteGain); no console errors.
- monitor flood: ~1200 msgs → total 1200, ring 60/dir, dropped > 0, ≤12 DOM rows per direction; clear resets.
- out tap: `window.__MIDI_STUB.isOurPortClass()` true; TEST NOTE sends real 0x90/0x80 bytes at the stub port.
- CC learn: arm → fire a CC → click a `.av-knob[data-knob]` → binds WITHOUT turning the knob; the hardware CC then moves it (value lands in avParams); unbind removes; a 200-msg burst coalesces.
- clock out: on → one 0xFA then 0xF8 ticks ~24 ppqn (mean-gap tolerance ±30% at avState.bpm); off → 0xFC freezes the wire.
- zero console errors; screenshots → `renders/p0-midi-*.png`.
Report: same shape as Child A.

## 3. Close-out
- Full battery on frozen bytes: smoke + feel + cdp_keys + cdp_midi all green.
- Commit B: suites (+ any fixes) — message cites the battery counts.
- CONTINUATION addendum 5 (ports, sha, battery numbers, suite paths) + README status line + mnemosyne task progress.
- If context is tight, write addendum 5 BEFORE launching the suite wave.

## Notes
- One browser suite at a time on this machine.
- Ports: smoke 9344, feel 9364 — suite children pick their own free ports (harness scans).
- git: children never run git; parent commits.
