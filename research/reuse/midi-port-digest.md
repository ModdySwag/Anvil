# MIDI port digest — Pattern Forge `src/app_midi.js` → Anvil `av_midi.js`

**Source (read-only, read in full 2026-10-07):** `C:\Users\Moddy\pattern-forge\src\app_midi.js` — 2,302 lines / 112,646 bytes. Every bare `L…` ref below is a line in *that* file. Other files are prefixed (`app_kb.js L…`, `styles.css L…`, …). Tests: `C:\Users\Moddy\pattern-forge\verify\test_midi.mjs` (1,611 lines) — refs prefixed `test L…`.
**Companion verdict:** `C:\Users\Moddy\anvil\research\reuse\T9-pattern-forge-reuse.md` §10 (L131–139): "PORT (light edit) — the whole panel + routing + monitor + clock is exactly what a flagship browser synth needs; only the host page tabs change."
**Anvil house conventions to land in:** `av-` prefix; `avParams` / `avApplyParam` (av_knob.js L151 / app_core.js L26); `window.__avTap`-style debug handle (av_tap.js L174); boot flag `data-av-ready` (app_core.js L58). The file under port is a **single self-contained file** (~2,300 lines) with a 3-phase structure: **P1** = L1–1009 (prefs, ports, decode, note routing, MPE row, out tap, panel, API, boot); **P2** = L1011–2302 header + capture/CC-learn/PC (L1057–1823) and panels/wiring/API for them; **P3 additions** = clock-out L1825–1966, velocity-into-grid L1281–1297, MPE panel L2089–2113. Everything is guarded with `typeof fn === 'function'` before calling PF engine/UI helpers — **keep that discipline, it is what lets the file load before the engine does** (L369-375, L413, L417, L1501-1502).

---

## 1. State machine + request flow

**States** (`midiStatus`, comment L45): `unsupported | idle | asking | enabled | denied | failed`. UI text map `MIDI_STATE_TEXT` L706–713 (`unsupported`: "NO WEB MIDI"/err; `idle`: "NOT ENABLED"; `asking`: "ASKING…"/busy; `enabled`: "ENABLED"/ok; `denied`: "DENIED BY BROWSER"/err; `failed`: "ERROR"/err).

**Transitions**
- **Boot** — `midiInit()` L990–997 sets `midiStatus = midiSupported() ? 'idle' : 'unsupported'` (L993), installs the out tap passively (`midiOutTapInstall()` L994) and pushes a remembered MPE pref (`midiMpePush()` L995). Self-boot: `DOMContentLoaded` fallback L999–1002; a second `window.load` hook re-pushes MPE because `app_synthx.js` boots **after** this file (build order comment L1003–1008). P2 boot `midiP2Init()` L2288–2296 loads CC bindings (L2291) and installs the capture-phase learn click (L2294); wired at L2298–2302.
- **Enable** — `midiEnable()` L258–290. Unsupported → toast "This browser has no Web MIDI" + return snap (L258–263). Else `midiStatus='asking'`, `midiError=''`, `midiRender()` (L264–266), then `await navigator.requestMIDIAccess()` **with no arguments** — comment L268–269: *"no {sysex:true}: the panel never sends sysex, so it never asks for it"*. Success: `midiAccess=acc`, `midiEnabled=true`, `midiStatus='enabled'`, wire `acc.onstatechange/onconnect/ondisconnect = midiOnStateChange` (each in try/catch, L273–275), `midiOutTapInstall()` L276 → `midiAutoPick()` L277 → `midiAttachInput()` L278, then `hubSay('MIDI ON')` + toast with `nIn/nOut` counts (L279–281). Failure: `midiStatus = (name==='NotAllowedError'||name==='SecurityError') ? 'denied' : 'failed'` (L282–287), `midiError` = `err.message`, toast.
- **Statechange/hotplug** — `midiOnStateChange()` L303–308: if not enabled return; else `midiAutoPick(); midiAttachInput(); midiRender();` — plug/unplug re-picks and re-attaches with no manual refresh.
- **Release** — `midiOff()` L292–301: if clock ticking → `midiClockOutStop('MIDI was released')` **while the port is still reachable** (0xFC first, L293); detach input; `midiReleaseAll()`; `midiAccess=null`; `midiEnabled=false`; `midiStatus = midiSupported() ? 'idle' : 'unsupported'` (L298).
- **Error path** — `midiErr(msg)` L892–896 forces `failed`/`unsupported` + `showError`.

**Gesture requirement** — nothing in code gates on a user gesture; the browser does. Panel copy is the contract (L778–780): *"MIDI is a browser permission, not a setting: it needs a real click (this ENABLE button), it is never remembered across a reload"*. The ENABLE button click handler is `hubWireMidi` L860 (`data-midi="enable"` → `midiEnable()`). Tests drive a real CDP click (test L231-233/247) and assert no-sysex (test L257–258) and the padlock way-out copy in `denied` (test L237–239).

**Prefs** — the *only* persistence for P1: localStorage key `MIDI_PREF_KEY = 'pf-midi'` (L27). Load once at L28–35: `{ ...defaults, ...JSON.parse(raw) }`; save wholesale `midiSavePrefs()` L36 (`JSON.stringify(midiPrefs)`; try/catch for blocked storage). **Every saved field** (defaults L29, all written back on each setter): `in` ('' — input port id), `out` ('' — output port id), `playIn` (true), `recTarget` (-1 = follow selection), `recMode` ('merge'), `pcOn` (true), `pcBank` ('styles'), `clockOut` (false), `mpe` (false), `mpeBend` (48). A second key for learn lives in P2: `MIDI_BIND_KEY = 'pf-midi-cc'` (L1064) — array of `{cc, ch, path, label, min, max, step, curve, def}` (load L1419–1433 filter+map, save L1435–1441).

**Debug/snapshot surface** — `midiStateSnap()` L900–933 returns `{ supported, status, enabled, error, inputs, outputs, in, inId, out, outId, playIn, mpe, held, lastNote, master, routed, capture, learn, pc, clock, monitor }`; API object `window.__FORGE_MIDI` built by `midiApi()` L935–986 (`version '1.0'`, raised to `'2.0'` by `midiP2Api()` L2223–2284), also aliased `window.__FORGE.midi` L984. Test contract: test L196–198 (keys state/devices/monitor/enable/setIn/setOut/playIn/route).

---

## 2. Ports

- **Capability** — `midiSupported()` L64 = `typeof navigator.requestMIDIAccess === 'function'`. `midiBrowserNote()` L66–72: Safari-without-Chromium gets its own sentence ("no Web MIDI at all — Chrome, Edge or Firefox 108+…"), the generic message names Chrome/Edge/Opera/Firefox 108+ and "Safari does not".
- **Name canonicalisation** — `midiDevName(d)` L74: strips `"` quotes and collapses whitespace — used **only** for routing code, not for port lists.
- **Enumeration** — `midiPorts(type)` L76–87: reads `midiAccess.inputs|outputs`; primary `map.forEach(...)`, fallback `[...map.values()]` inside try/catch (odd implementations). Row shape `midiPortInfo` L89–98: `{ id, name:(unnamed port), manufacturer, state, connection, type }` (state/connection default `'unknown'`/`'closed'`). Empty when no access.
- **Resolution** — `midiPortFor(type, want)` L101–112 (T9 called it `midiPortsFor`; the real name is `midiPortFor`): `map.get(want)` first, else scan live port list for `id === want || name === want`, then `map.get(hit.id)`. `want` may be an id **or a name** — this is the only aliasing in the file.
- **Selected helpers** — `midiSelectedInputPort/OutputPort` L114–115, `midiSelectedInput/Output` (info objects) L116–117.
- **Auto-pick** — `midiAutoPick()` L312–326. Input: if saved pick doesn't resolve → first `state==='connected'`, else `ins[0]` (L314–317). Output: if saved pick doesn't resolve → prefer a port whose **name** equals `state.midi.name` (the app's master route, L320–321), else first connected, else `outs[0]` (L322–323). Saves prefs L325. Runs on enable, on every statechange, and on refresh.
- **Picking + persistence** — `midiSetIn(v)` L328–338: resolve; fail → toast "No such MIDI input" + false; else `midiDetachInput(); midiReleaseAll();` store `port.id || port.name`; save; re-attach; render. `midiSetOut(v)` L340–347: resolve, store, save, render (no attach — sends resolve the port live at send time). `midiRefresh()` L349–354: autoPick + attach + render, returns `{inputs, outputs}`.
- **Attach** — `midiAttachInput()` L358–376: no-op if the same port+handler already attached; detach old; **capture-take guard** L365 (`if (midiRec.armed && had) midiRecStop('the input device changed'|'went away')`); attach via `port.addEventListener('midimessage', handler)` — comment L370–372 explains **why not `onmidimessage`**: the engine's own WebMidi may claim it when a pattern uses `midin()/midikeys()`, listeners coexist. Fallback `port.onmidimessage = handler` L374. Detach L378–384 removes the listener and nulls both vars.
- **Hotplug** — `acc.onstatechange` (plus onconnect/ondisconnect) wired at enable L273–275 → `midiOnStateChange` L303–308. Tested live: add out + remove in and the rows update with no manual refresh (test L269–275). The capture watchdog L1225–1236 also polls the selected input every 150 ms as a second net (browsers can drop a device without an event, comment L1218–1222).

---

## 3. Decode — `midiDecode(data)` L121–155

Empty → `null` (L123). `status = b[0]&0xff`, `hi = status&0xf0`, `chan = (status&0x0f)+1` (**1-based for the panel**, comment L126), `chanMsg = status < 0xf0` (L127), `v1=b[1], v2=b[2]`.

**Channel messages** (L130–137):
- `0x80` → `noteoff` / "note off".
- `0x90` → **velocity-0 rule**: `v2 === 0 ? 'noteoff' : 'noteon'` (L132) — label follows.
- `0xa0` → `polytouch` "poly aftertouch" (*decoded for the monitor only — never routed*).
- `0xb0` → `cc`; `0xc0` → `program`; `0xd0` → `touch` "aftertouch"; `0xe0` → `pitchbend`.

**System messages** (L138–145): `0xf8` clock, `0xfa` start, `0xfb` continue, `0xfc` stop, `0xfe` sensing "active sensing", `0xff` reset, `0xf0`/`0xf7` sysex, anything else `system`. **Sysex stance:** decoded for the monitor, `requestMIDIAccess()` is called without sysex (L268–269), panel copy "no sysex, no extra download" (L770), test asserts no call opts and `sysexEnabled` path never asked (test L257–258).

**Field construction** (L146–154): `hex` = first **4** bytes as lowercase 2-hex-digit joined with spaces; `out = { type, label, chan: chanMsg ? chan : 0, data: b.slice(0,8), hex }`. Note messages add `note = v1`, `vel = v2` (noteon) or `0` (noteoff), `name = kbNoteName(v1)` if available (L148–151). CC adds `cc = v1, value = v2` (L152). Pitch bend adds **`bend = ((v2 << 7) | v1) - 8192`** (14-bit, −8192..8191) (L153).

**Routing of decoded types** — `midiOnInputMessage(e, port)` L386–399: slice `e.data`; empty → return; `midiRecord('in', bytes, port.name)` **first** (L390); decode (L391); then dispatch:
- `noteon` → `midiRecCatch(m)` (capture, first) **and** `midiNoteOn(m.note, m.vel, m.chan)` (L393)
- `noteoff` → `midiNoteOff(m.note, m.chan)` (L394)
- `cc` → `midiCcIncoming(m)` (L395) · `program` → `midiPcIncoming(m)` (L396)
- `pitchbend` → `midiBendIncoming(m)` (L397) · `touch` → `midiTouchIncoming(m)` (L398)
- clock/start/continue/stop/sensing/reset/sysex/polytouch are **decoded and monitored but not routed** (no branch).

**Incoming expression formulas** (master/global path): bend → `semis = clamp(bend, ±8192)/8192 * 2` → `pfSXLiveParam('bend', semis)` (L1620–1626, comment: ±2 semitones default feel); aftertouch → `pfSXLiveParam('at', data[1])` raw 0..127 (L1630–1636). Both bail to the MPE per-channel path on a live member channel (L1621, L1631).

---

## 4. Note routing

### 4a. Core (dock path)
`midiNoteOn(note, velByte, chan)` L404–420:
1. `name = kbNoteName(note)` if available else `String(note)` (L405);
2. `vel = clamp(velByte ?? 100, 0, 127)` (L406) and `midiLastNote = {note,name,vel,at}` + `midiMonTouch()` (L407–408) — the readout updates **even when play-in is off**;
3. `if (!midiPrefs.playIn) return;` (L409);
4. MPE branch (4b) if live member channel, else `midiHeld.add(name); kbNoteDown(name, vel / 127);` (L417–419).

`midiNoteOff(note, chan)` L422–433: resolve name; **MPE drop first** — `if (midiMpeDrop(ch, note)) { pfSXNoteOffCh(ch, note); return; }` (L427–430, comment: a member note is released by the channel it started on even when MPE was switched off in between); else `midiHeld.delete(name); kbNoteUp(name);` (L431–432).

`midiReleaseAll()` L435–442: puts down every held name via `kbNoteUp` + `midiMpeReleaseAll()` for member notes; no-op when nothing held. Called from `midiOff` L295, `midiSetIn` L332, `midiSetPlayIn(false)` L447, and channel-mode panic (L1642).

**What it mirrors:** the file header law (L3–6, L401–403): hardware notes play "through the exact path the 61-key piano dock uses (kbNoteDown / kbNoteUp) — same voice, same hold-to-play, velocity included. **No second synth path exists.**" `kbNoteDown(name, vel)` (app_kb.js L454–466) owns voice selection + held set + preview and immediately hits the native engine (`pfSXNameToMidi` → `pfSXNoteOn(midi, kbNoteGain(name), name)`, app_kb.js L461–462); `kbNoteUp` (app_kb.js L468+) mirrors it. **Velocity flow:** `vel/127` is handed to `kbNoteDown` as gain (L419); test proves gain = 100/127 (test L311–313) and clamp at 127 → gain 1 (test L345–348). Tests also assert **no document write** and the native voice is what plays (test L301–310). `midiHeld` (L50) is this panel's own set so it can always release what it started; readout `#midi-held` renders it (L242–243).

**Toggle:** `midiSetPlayIn(v)` L444–450 — persist, release everything when switched off (comment: dock notes AND member notes), render, return value.

### 4b. MPE branch — map only (parent defers it)
Block comment L452–464; constants L466–471: `MIDI_MPE_MASTER = 1` (ch1 = master, keeps every global path), `MIDI_MPE_BENDS = [24,48,96]`, default 48, `MIDI_MPE_CC_TIMBRE = 74`; bookkeeping `midiMpeHeld` = Map ch→Set(midi) L471. Predicates L473–477: `midiMpeMember(ch)` = 2..16, `midiMpeLive()` = `pref.mpe && pref.playIn && typeof pfSXNoteOnCh === 'function'`. In `midiNoteOn` (L411–416): live member note → `midiMpePush()` (tells the engine first, idempotent) + `pfSXNoteOnCh(ch, note, vel/127, name)` + `midiMpeHold(ch, note)` and **return** — the dock is deliberately never fed (comment L9–11, L457–463: the dock has one held set/highlight/preview; an MPE note never lights a key). Note-off L427–430 as above. Expression (per channel, only if engine fn exists): `midiMpeBendIncoming` L512–516 `semis = clamp(bend)/8192 * midiMpeBend()` → `pfSXMPEBend`; `midiMpeTouchIncoming` L518–522 `p/127` → `pfSXMPEAT`; `midiMpeTimbreIncoming` L524–528 `hz = 60 * 300^(v/127)` → `pfSXMPECutoff`. Push `midiMpePush()` L481–484 → `pfSXMPESet({on, bend})`. Broom `midiMpeReleaseAll()` L503–509 → engine `pfSXMPEAllOff()` first, then clears the map; triggered by set-off L560, play-in off L447, releaseAll L440, panic L1642, input change (attach L365 → stop paths), and the engine's own switch-off. Setters `midiSetMpe` L556–564 (hubSay ON/OFF), `midiSetMpeBend` L566–573 (clamps to the list). Snap/text L530–554; panel row L2089–2113 (`data-midimpe`, `#midi-mpe-bend` select, `#midi-mpe-state`, `#midi-mpe-hint`); full test battery P4 test L1128–1514. **Anvil: defer the whole branch; keep the panel row out until the engine grows a per-note entry.**

### 4c. P2 capture (hardware notes → 16-step grids) — map, likely DEFER for Anvil
Purpose L1011–1047. Limits L1060–1066: ring 512 events, 16 steps, 8 rows, CC window 30 ms, bind cap 64. Pad map `MIDI_PAD_MAP` L1070–1075 (GM-ish 35–59 → `bd rim sd cp lt hh mt oh ht cr rd tb sh cb`, ≥60 → `perc`). State `midiRec` L1079–1083. Target resolution `midiRecTrackIndex` L1121–1127 (pref `recTarget`, else `selTrack`); grid kinds `midiGridKind` L1103–1109 (`drums`→drums, `chords`→strum, `synth|sample|bass`→note, else null + why text L1116–1119). Arm `midiRecArm` L1190–1216 (requires MIDI enabled + a grid track; records `transport`). Timing `midiRecCatch` L1239–1279: only while armed **and** `playing`; `cycles = mirror.repl.scheduler.now()`, `frac = cycles % 1`, **`step = round(frac * 16) % 16`** (the quantize, L1249; there is no free position — grids are 16 wide, comment L1024–1028); notes when stopped are counted as `offTransport`, never written (L1243). Degree math `midiRecNoteToDegree` L1150–1167 (scale via `kbScaleNotes`/`KB_PC`, out-of-window snaps to edge + `clamped`), inverse `midiRecDegreeNote` L1170–1176, window readout `midiRecWindow` L1178–1183. Write `midiRecWrite` L1300–1344: merge/overwrite clears steps+vel arrays first (L1305–1315); writes through `snapshot(); saveState(); renderEditor(); renderGrid(); pushDoc();` L1338–1342 (undoable, lands in the generated doc). Stop `midiRecStop` L1346–1364 (writes once, records `lastWrite`, hubSay/toast), cancel L1366–1379, retarget stops a live take L1381–1388, mode L1390–1395; watchdog `midiRecWatch*` L1223–1236 polls `playing` every 150 ms and writes the take when the transport stops or the input vanishes. **Velocity into the grid** L1281–1297: parallel 16-slot array `host.vel` (`synth.vel`/`sample.vel`/`bass.vel`, `row.vel` for drums), `round(vel/127*100)/100`, `null` on empty slots; created only when a take needs it, so old projects have none; strum carries no velocity (comment L1287–1288). Document emission (`.velocity("…")`) is app_codegen's job — PF-only. **Anvil has no step grids; port only if Anvil grows a sequencer. Not in the parent's stated scope.**

### 4d. Program change → presets/styles/packs — map, PF-only
Banks `MIDI_PC_BANKS = ['styles','presets','packs']` L1722; lists L1726–1751 (styles = `STYLE_GENRES` flat 80; presets = `GUI_PRESETS` then `CODE_PRESETS`; packs = `installedPacks` patterns in install order). Apply `midiPcApply` L1753–1788: `PC data byte → 0-based index`; out of range changes nothing, counts `refused`, toast "outside the bank" (L1758–1765); loads via `pf.loadStyle` / `pf.loadGuiPreset` / `pf.loadCodePreset` / `pf.packsLoadPattern` (app_ui.js L126/L93/L101/L201). Incoming `midiPcIncoming` L1790–1799 (`pcOn` off records but refuses). **PC never installs a pack** (comment L1051–1053). Direct dependencies: PF catalog globals — drop unless Anvil grows presets.

---

## 5. Monitor

**Caps (the law — documented in the panel, enforced here)** L38–42: `MIDI_MON_MAX = 60` entries kept per direction (ring), `MIDI_DOM_MAX = 12` rows drawn per direction, `MIDI_MON_RATE = 240` messages recorded per second (**shared in+out budget** — one `midiRate` object L56; excess counted as dropped, per direction), `MIDI_FLUSH_MS = 120` — at most one repaint per window. Panel prints the same numbers L846–848.

**Flow:** `midiRecord(dir, data, portName)` L166–186 — `midiMonTotal[key] += 1` **always** (L170); `midiRateOk()` L159–164 (per-1000ms window reset; `n <= 240` kept) failing → `midiMonDropped[key] += 1` and **return null** (L171) — but note the caller (`midiOnInputMessage` L390–392) does **not** check the return: **rate drop affects the monitor row only, never decoding or note routing**. Entry shape L173–180: `{ t, port, type, label, chan, data, hex }` + optional `name`, `vel`, `cc`+`value`, `bend`. Push to `midiMonIn|midiMonOut`, `while (length > 60) shift()` (L181–183), then `midiMonTouch()`.

**Repaint coalescing:** `midiMonTouch()` L189–192 — if no timer, `setTimeout(midiDrawMonitor, 120)`; a burst collapses into one repaint. `midiDrawMonitor()` L224–245 is *the only place the monitor DOM is written*: guard `#hub-body` exists **and** `hubTab === 'midi'` (L225–226; capture/learn readouts ride the same repaint through `midiDrawP2()` L244). Writes:
- `#midi-mon-in` / `#midi-mon-out` → `midiMonRowsHTML(dir)` L211–221: `ring.slice(-12).reverse()`; empty → `<div class="midi-none">nothing yet</div>`; each row `<div class="midi-mon-line{ on for noteon}"><span class="t">HH:MM:SS.mmm</span> <b>chN</b> detail<span class="p">· port</span></div>` (escaped). `midiRowText` L200–209: size = `hex.length + 'b'`, chan `'ch'+n` or `'--'`, detail per type (`name vel V [hex]`, `ccN = V [hex]`, `bend`, else hex).
- `#midi-count-in` / `#midi-count-out` → `"X/60 kept · N total · D dropped"` (L230–234).
- `#midi-last-note` → `name` + `.midi-vel` bar (`i` width = `max(4, min(100, round(vel/127*100)))%`) + vel (L236–241).
- `#midi-held` → `[...midiHeld].join(' ')` or `—` (L242–243).

`midiClearMonitor()` L247–254 wipes rings, totals, dropped, rate, lastNote and repaints. Debug: `midiApi().monitor(dir)` / `.counters()` L941–946 (`caps` object included). Test proof: 1200-message burst → total 1200, ring 60, dropped 900–960, exactly 12 DOM rows inside a ≤175px box, counter line, clear wipes all (test L352–372).

---

## 6. Output path

### Sends + tap + test
- **`midiOutTapInstall()`** L655–668 — patches **`MIDIOutput.prototype.send`** (P from `window.MIDIOutput`); wrapper: `if (!midiSelfSend) midiRecord('out', data, this.name)` in try/catch, then `orig.apply`. Idempotent via `midiOutTapOk`; returns false when there is no `MIDIOutput` or `send`. Called at enable L276 and passively at boot L994 (L994 comment: costs nothing until a send happens).
- **`midiSendBytes(port, bytes)`** L670–691 — opens the port first if `connection !== 'open'` (`port.open()`, promise catch ignored; comment: "a port must be open before it will send — open it the way the engine's own midi module does", L675–678); sets `midiSelfSend = true` around `port.send(arr)` in try/finally so **the tap skips our own send** (L679–681); then **records exactly once itself** (L682–684: "whether or not a tap is installed"); failure → `showError('MIDI send failed: …')`, false.
- **`midiSendTest(note, ms)`** L694–702 — selected output or toast; note default 60 clamp 0..127; sends `[0x90, n, 100]` then `[0x80, n, 0]` after `ms ?? 260` ms; toast "Test note → name". Test: real 0x90/0x80 note-60 bytes at the stub port (test L430–438).
- Output pick persistence = `midiPrefs.out` (see §2). Out monitor rows come from the tap (engine traffic, `midiSelfSend` guard keeps our own `midiSendBytes` sends from double-recording) — test checks an engine-driven `.midi()` note appears in `monitor('out')` (test L424–428).

### Clock OUT (tied to the transport)
Block doc L1825–1839 ("the transport, on the wire… honestly quiet ≠ stopped"). Constants L1841–1844: `MIDI_CLOCK_PPQN = 24`, note ms `60000/24`, `0xfa` start / `0xf8` tick / `0xfc` stop. State L1846. **BPM = `state.cpm * 4`** (cycles/min × 4 beats, read fresh **every tick** L1849–1854; gap = `2500 / BPM` ms L1855). `midiClockPort()` = selected output **only when enabled** L1856. Start L1881–1902: `midiClockWhyNot()` L1874–1879 gives one honest sentence (off / not enabled / no output); one 0xFA max (L1889); sends 0xFA, schedules. Tick L1920–1935: re-resolves the port every tick (output vanished → stop with reason L1924); pushes the inter-tick gap into `lastGaps` (max 8) L1926–1929; sends 0xF8; re-schedules. Schedule L1937–1949: next tick = last **scheduled** time + gap (a late wake-up is caught up on the next tick, not shifted; resync to `now` only when > half a period behind) — the anti-jitter/anti-stutter law. Stop L1904–1917: clears timer, sends 0xFC if a port still resolves, else records `lastError`. Transport hook **`midiClockOutTransport(isPlaying)`** L1952–1956 — the one-liner app_core.js calls from `togglePlay()` (app_core.js L251–252) and `hush()` (L273–274); off is off (no complaint). `midiClockOutSetOn` L1958–1966 stops on switch-off; starts mid-run if playing. Snap L1858–1871; panel L1970–1996 (`data-midiclock`, `#midi-clock-state`, `#midi-clock-ticks`, copy the 24 ppqn + cpm×4 + transport facts); API L2277–2282; tests L853–986 (0xFA first, mean gap ±30%, stop freezes wire, no-output no-op with reason, transport start/stop, midi-run tempo change halves gaps, hush stop).

### Route to hardware — **PF-ONLY, flag for Anvil**
Comment law L577–580: **single quotes only** — Strudel's transpiler turns every double-quoted literal into mini-notation and `.midi()` refuses a pattern ("Make sure to pass device name with single quotes"). `midiRouteQuote(dev)` L581 escapes `\` then `'`; `MIDI_ROUTE_RE` L582; `midiRouteCode(dev)` L584 = `.midi('dev')`. `midiTrackDevice(t)` L586–589 unescapes the match from `t.extra` (the track's Transform Stack). `midiRouteTrack(i, device)` L603–619: refuse `type === 'code'` with an explanation toast (L607–610); dedupe if already routed; **replace** any existing route (one port per track, L614); append to `t.extra`; `saveState(); renderEditor(); pushDoc();` (the Variation Lab idiom, comment L601–602). `midiUnrouteTrack` L621–631. Global route `midiRouteAll` L634–643 / off L645–651 → `state.midi = {on:true,name}` / `{on:false}` (emitted by buildDoc as `all(x => x….midi('…'))` — L633). Chips `midiRouteChipsHTML` L749–758, `data-midiroute`. Tests L374–474. **All of this is Strudel/PF state — Anvil must design its own out-routing or drop it; keep only `midiSendBytes`/`midiSendTest`/the tap.**

---

## 7. CC map + learn

### Default performance map (flag: targets are PF engine calls)
`MIDI_CC_DEFAULT` L1600–1608 — **active only when no learned binding hit** ("learn always wins", L1591; comment L1596–1599: a hardware knob and the GUI land on identical state):

| CC | label | apply (exact) |
|----|-------|---------------|
| 1 | mod → vibrato | `pfSXLiveParam('vib', v/127)` |
| 5 | porta time | `pfSXGlide.time = round((v/127)*2000)/1000` (seconds) |
| 64 | sustain | `pfSXPedalSet(v >= 64)` |
| 65 | porta on/off | `pfSXGlide.always = v >= 64` |
| 66 | sostenuto | `if (v >= 64) pfSXPedalSet(true)` (edge only) |
| 71 | resonance | `pfSXLiveParam('reso', (v/127)*24)` |
| 74 | cutoff | `pfSXLiveParam('cutoff', round(60 * 300^(v/127)))` |

`midiCcDefault(m)` L1610–1615 (known CCs only, try/catch). Channel-mode `midiChannelMode(m)` L1640–1654: **120 & 123** → `midiReleaseAll() + pfSXAllNotesOff() + kbNoteStopAll()`; **121** → `pfSXPedalSet(false) + pfSXLiveParam('bend', 0)`; omni/mono/poly switches acknowledged-and-ignored. Called whenever `m.cc > MIDI_CC_MAX(119)` outside the learn-pick window (L1576). Incoming order in `midiCcIncoming` L1559–1594: (1) learn-pick if armed & no cc yet — CC>119 refused here with toast, **not** passed to panic handling (L1560–1566); (2) CC>119 → channel mode; (3) CC74 + live member channel → per-note timbre, return (L1579–1583); (4) match `midiCcBinds` (`b.cc === m.cc` and, when both sides have one, channel matches — `if (b.ch && m.chan && b.ch !== m.chan) return;` L1587) → `midiCcApply`; (5) no hits → default map.

### Learn flow
- **Arm** `midiLearnArm()` L1500–1507: toggles (armed → cancel); requires `midiEnabled`; sets `midiLearn = {armed:true, cc:null, chan:0, armedAt}` (state object L1086 — also `bound/refused/lastRefused/hubWasOpen`); toast instructions. Disarm L1509–1516 (also restores the hub).
- **Pick controller** — first incoming CC while armed & `cc == null` (L1560–1572): sets `cc`+`chan`+`at`, then **the hub steps aside** (`midiLearnHubAside` L1521–1528 closes the overlay while remembering it — law comment L1518–1520: "the hub is a full-screen overlay, so a control under it can never be clicked… the control is not in the hub"); hubSay "LEARN: CC N — CLICK A CONTROL" + toast.
- **Click binds** — `midiLearnClick(e)` L1537–1556, registered **capture-phase** on `document` in `midiP2Init` L2294: target must be `.pf-knob[data-knob]` **or** `input[type="range"][data-path]` (L1540; real markup exists — app_ui.js L1241, binder L1320); path from `dataset.knob || dataset.path`; `preventDefault()+stopPropagation()` **swallows the click so binding never turns the control** (L1544–1545, test L729–732); no CC picked yet → toast "Move a knob or fader on the hardware first"; else `midiCcBindFrom`; disarm; hub back (`midiLearnHubBack` L1529–1534 → `hubOpen('midi')`); hubSay/toast.
- **Binding record** — `midiCcBindFrom(el, path, cc, chan)` L1455–1481: refuse `cc > 119`, cap `MIDI_CC_BIND_MAX = 64`; range read **off the DOM**: knob → `dataset.min/max/step/curve/def` (L1468–1474), slider → `el.min/max/step`, curve `'lin'`, def `null`; label = knob `aria-label` (knobHTML sets it, app_knob.js L105) or `.ctl`/parent `.lbl span` for sliders; **rebinding replaces** — filter out same `(cc,ch)` and same `path` (L1475–1476, "one controller per target, one target per controller"); `id = 'b' + (++midiCcSeq)`; save. `midiCcUnbind` L1483–1490 (by id, `ccN:chM:path` key L1443, or path), `midiCcClearAll` L1492–1498.
- **How a learned CC writes a parameter** — `midiCcApply(b, value)` L1658–1666: per-binding coalescing — queue `Map(b.id → value)`, flush **immediately once, then at most every `MIDI_CC_WINDOW = 30 ms`** with the newest value ("the document is never regenerated per message", L1656–1657; test: 200-message burst ≤ 6 writes, final value wins, test L757–766). `midiCcFlush` L1668–1680 (throttled hubSay every 400 ms via `midiCcSaid`). `midiCcWrite(b, value, say)` L1682–1706: `norm = clamp(value,0,127)/127`; `v = knobNormToVal(norm, b.min, b.max, b.curve, b.step)`; **`pfApplyParam(b.path, v)`** else fallback `setPath(state, b.path, v); pushDoc();` (L1686–1687); on error counts `b.errors`; then DOM sync — element via `midiCcElement(b.path)` L1447–1453 (`'.pf-knob[data-knob="…"]'` or `'input[type="range"][data-path="…"]'` with `cssEscape`), `knobApplyVisual(el, v)`, `el.value = v`, `[data-kval]` textContent via `knobFormat(v, {fmt,unit})`, else `pfRefreshValues()`; `hubTouch(b.path, label + ' ' + txt)`; throttled `hubSay`.
- **Snap/API** — `midiCcSnap()` L1708–1718 (armed, cc, chan, refused, boundCount, max 119, cap 64, window 30, writes, binds[] with onScreen); API `base.cc.*` L2241–2251 (`arm/cancel/state/bindings/bind/unbind/clear/apply/flush`). Tests: test L701–783 + reload persistence L1096–1115.

### Anvil reuse angle (the av-namespaced knob framework)
1. **Selectors** `.pf-knob[data-knob]` → `.av-knob[data-knob]`; the dataset contract is identical — avKnobHTML writes `data-knob/min/max/step/curve/def/fmt/unit` and `.av-knob-val[data-kval]` (av_knob.js L106–119); keep the `input[type=range][data-path]` half only if Anvil ever ships sliders.
2. **Functions** `knobNormToVal` → `avKnobNormToVal` (av_knob.js L19), `knobFormat` → `avKnobFormat` (L61), `knobApplyVisual` → `avKnobApplyVisual` (L127), `cssEscape` → `avKnobCssEscape` (L143), `pfApplyParam` → **`avApplyParam(path, v, meta)`** (app_core.js L26–31 — currently parks unknown paths in `avParams`, which is exactly the P1 seam), and the mirror is `avParams` (av_knob.js L151; `avKnobCommit` L154–176 already writes `avParams[path]` before calling `avApplyParam`). Do **not** call `avKnobCommit` from the CC path — write the value + visual + readout directly (midiCcWrite's shape), or the knob's damping would fight the hardware.
3. **The swallow**: av_knob.js commits on `click` (L296–304) as well as pointer drags — the capture-phase learn listener with `preventDefault()+stopPropagation()` (L1537–1556) is *required* for Anvil too, or a learn-click would step the knob.
4. **Drop/replace**: `hubTouch`/`hubSay` (app_hub.js L83/L82) → Anvil's own readout or no-op; storage key `pf-midi-cc` → `av-midi-cc`; default-map applies that call `pfSXLiveParam/pfSXPedalSet/pfSXGlide` keep the *table shape* `{cc: {label, apply}}` but must be re-pointed at Anvil's engine (or dropped until it exists — the map is genuinely optional; learn works standalone).

---

## 8. Panel UI

**Host integration (PF side):** `HUB_TABS` entry `{id:'midi', name:'MIDI', hint:'hardware keys play the app · route any track out to your gear'}` app_hub.js L13; `hubRender()` renders `hubMidiHTML()` when `hubTab==='midi'` app_hub.js L500; `hubWireBody()` calls `hubWireMidi(body)` app_hub.js L825 (then `knobBind(body)` L827); shortcut **Ctrl+Shift+I** (KB_DEFS app_kb.js L72, dispatcher L1103, action `hubOpen('midi')` L1027). Panel body host is `#hub-body`; the monitor repaint guard checks `hubTab==='midi'` (L226).

**Markup builders (all pure string builders, every interpolation `esc()`-ed):**
- `hubMidiHTML()` **L760–852** — root `<div class="hub-grid2">`; order: status panel (wide, L770–781) → INPUTS (`#midi-dev-in`) L783–786 → OUTPUTS (`#midi-dev-out`) L787–790 → PLAY IN L792–805 → `midiMpePanelHTML()` L807 → `midiClockPanelHTML()` L809 → `midiRecPanelHTML()` L811 → `midiLearnPanelHTML()` L813 → `midiPcPanelHTML()` L815 → ROUTE TO HARDWARE L817–831 → MONITOR IN `#midi-mon-in` L833–837 → MONITOR OUT `#midi-mon-out` L838–842 → CLEAR + caps copy L843–850.
- `midiStatusHTML()` L715–731 — per-state copy incl. the unsupported honesty + Safari note, denied padlock instructions, enabled counts.
- `midiDevRowsHTML(type)` L733–747 — `.midi-dev` rows (`b` name, `.grow` maker·state·connection, USE/IN USE button `data-midiin-pick`/`data-midiout-pick`; ids from L869–870).
- `midiRouteChipsHTML()` L749–758 — `hub-chip` per track, `data-midiroute=i`, ✓/→ state.
- `midiMpePanelHTML()` L2089–2113 — `data-midimpe` chips, `#midi-mpe-bend` select (24/48/96), `#midi-mpe-state`, `#midi-mpe-hint`, member/master copy.
- `midiClockPanelHTML()` L1970–1996 — `data-midiclock` on/off, `#midi-clock-state`, `#midi-clock-ticks`, 24 ppqn copy.
- `midiRecPanelHTML()` L2011–2049 — `data-midirec` arm/stop/cancel, `data-midirec-mode` merge/overwrite, `midiRecTargetChipsHTML()` L1998–2009 (`data-midirec-target`, FOLLOW SELECTION), `#midi-rec-state`, `#midi-rec-count`, quantize/velocity/skip copy.
- `midiCcBindsHTML()` L2051–2060 — `.midi-dev` rows `data-ccbind`, `data-ccval`, `data-midicc-del`; "not on screen right now" when the path has no element.
- `midiLearnPanelHTML()` L2062–2086 — `data-midilearn` arm/clear, `#midi-learn-state`, `#midi-cc-binds`, the step-aside law copy; prints `MIDI_BIND_KEY`.
- `midiPcPanelHTML()` L2115–2145 — `data-midipc` on/off, `data-midipc-bank`, `#midi-pc-last`, preview of 8 entries.
- Buttons ride the shared hub classes: `btn`, `btn mini`, `hub-chip(.on)`, `hub-actions`, `hub-panel(.wide)`, `hub-grid2`, `session-facts`, `hub-note`, `midi-none` — Anvil must provide equivalents for whatever it does not already have.

**Wiring functions (name → one-liner, refs):**
- `hubWireMidi(body)` L856–886 — delegated clicks: `[data-midi]` (enable/disable/refresh/testnote/playin/clear/routeall/masteroff L858–868); `[data-midiin-pick]`→`midiSetIn` / `[data-midiout-pick]`→`midiSetOut` L869–870; `[data-midiroute]` toggle route/unroute L871–880; `[data-midimpe]`→`midiSetMpe` L881; `#midi-mpe-bend` change→`midiSetMpeBend` L882–883; `hubWireMidiP2(body)` L884; `midiDrawMonitor()` L885 (first paint).
- `hubWireMidiP2(body)` L2149–2170 — `[data-midirec]` arm/stop/cancel, `[data-midirec-mode]`, `[data-midirec-target]`, `[data-midilearn]` arm/clear, `[data-midicc-del]`, `[data-midipc]`, `[data-midipc-bank]`, `[data-midiclock]`.
- `midiRender()` L888–890 — `hubRender()` only when `hubTab==='midi'` (hub not up yet → swallowed).
- `midiDrawP2()` L2173–2219 — the throttled repaint's P2 half: `#midi-rec-state`, `#midi-rec-count`, `#midi-learn-state`, `[data-ccval]` values, `#midi-pc-last`, `#midi-clock-state`, `#midi-clock-ticks`, `#midi-mpe-state`, `#midi-mpe-hint`.
- `midiDrawMonitor()` L224–245 — §5.

**CSS — styles.css L1957–1985** (block header "MIDI panel (src/app_midi.js)"):
`.midi-stat` L1958–1961 (+ `.ok`/`.err`/`.busy` color variants L1962–1967) · `.midi-dev` L1968–1969 (+`.on` L1970, `b`/`span`/`.grow` L1971–1973) · `#midi-mon-in, #midi-mon-out` L1974–1976 (mono 9.5px, `max-height:170px; overflow:hidden` — the fixed-height box the 12-row cap relies on) · `.midi-mon-line` L1977–1981 (+`.on`, `.t`, `.p`, `b`) · `.midi-vel` L1982–1984 · `.midi-none` L1985. All colors ride **PF theme tokens** (`--mono --serif --ink --ink-dim --ink-faint --cream --ok --danger --accent --accent-soft --line --line-strong`) defined elsewhere in styles.css — Anvil must remap to its own palette. (`body.kb-midi` L1038–1039 is the piano dock, not this panel.)

---

## 9. Test hooks — `verify/test_midi.mjs`

**Run modes** L1–6: `node verify/test_midi.mjs --port 9510` (stubbed, deterministic) · `--port 9511 --real` (real-hardware probe). Launches headless Chrome/Edge L28–32 (`--headless=new`, `--remote-debugging-port`, profile in tmpdir), CDP over `/json/list` L124, custom WS client L126–156, `Runtime/Page/Log.enable` L144. Checks run with `Runtime.evaluate … userGesture:true, awaitPromise:true` L147–151; clicks are real `Input.dispatchMouseEvent` center-clicks after `scrollIntoView` L157–168; viewport 1440×900 + focus emulation L170–171. Readiness loop on `window.__FORGE_READY` L176–179 + the **hidden-tab trap** check (page visible+focused, else rAF/clock are meaningless) L183–185.

**The headless stub — EXACT shape (STUB source string L41–121, injected `Page.addScriptToEvaluateOnNewDocument` L145 so it exists before the app's first line; rationale comment L8–12: the app only ever sees `navigator.requestMIDIAccess / MIDIOutput / MIDIInput`, and stub ports are instances of the class put on `window.MIDIOutput`, "so the app's outgoing tap (a patch of MIDIOutput.prototype.send) is exercised the way a real browser exercises it"):**
- `log = { calls: [], outs: [], overrodeMIDIOutput: false, listenerErrors: [] }` L42; `mode` 'unsupported|grant|deny' L45.
- **`Port(type, id, name, man, state)`** base class L47–64: fields `type/id/name/manufacturer/state('connected')/connection('closed')/version/'_listeners'`; `addEventListener` accepts only `'midimessage'` (dedup); `removeEventListener`; **`open()` sets `connection='open'` and resolves `this`**; `close()` reverses; `fire(bytes)` builds `{type:'midimessage', data: Uint8Array, target, currentTarget, srcElement, timeStamp}` and calls every listener in try/catch (errors → `log.listenerErrors`).
- **`InPort` / `OutPort`** L65–71 (`Object.create(Port.prototype)`); **`OutPort.prototype.send = function (data) { log.outs.push({name,id,data:Array.from(data),t}) }`** — the method the app's tap wraps.
- `access` L73–77: `{inputs: Map, outputs: Map, sysexEnabled:false, onstatechange/onconnect/ondisconnect:null, add/removeEventListener no-ops}`; `fire(type, port)` L78–83 builds a `statechange` event and calls `access.onstatechange` (plus `on<type>` for connect/disconnect).
- **`requestMIDIAccess(opts)`** L85–90: logs `{opts: {sysex, software} | null, at}`; mode `'deny'` → reject `NotAllowedError('Permission denied')`; not `'grant'` → reject `NotSupportedError('Web MIDI unavailable')`; else resolve(access).
- **`window.__MIDI_STUB`** L92–117: `log`; `mode()`; `setMode(m)` — `'unsupported'` hides `navigator.requestMIDIAccess` via `Object.defineProperty(…, {value:undefined})` (fallback assignment); any other mode **re-installs the stub as an own property** (comment L101–102: deleting would expose the browser's real one, which headless Chromium refuses without a gesture); `addIn/removeIn/addOut/removeOut(id,name,man,state)` mutate the Maps and `fire('statechange', p)` (remove marks `state='disconnected'`, `connection='closed'` before deleting) L108–111; `fire(id, bytes)` feeds an input L112; `port(dir,id)` L113; **`isOurPortClass()` = `window.MIDIOutput === OutPort`** L116 (proves the app's tap patched the stub class). Boot line installs `window.MIDIOutput = OutPort; window.MIDIInput = InPort` L120.

**Assertions (blocks, with refs):**
- Boot/tab/API: module+wire+init functions, HUB_TABS carries `midi`, API key contract (test L189–199); engine bundles the midi eval scope (L201–212).
- State honesty: unsupported — no ENABLE button, Safari named (L214–226); denied — NotAllowedError → DENIED + padlock way-out (L228–239); enabled after a **real click**, first `requestMIDIAccess` opts null (no sysex ever), 4 device rows with maker/state/connection (L241–267); hotplug live update (L269–275).
- Play-in: selection sticks (L284–288); note-on plays the app's own voice natively with **no document write**, gain 100/127, monitor entry type/chan/data/name, panel readout (L290–318); note-off releases through the same path (L320–330); CC/bend/clock decode values (`cc 74=64`, `bend=4096`, clock chan 0) (L332–340); full velocity clamps to gain 1 (L342–350).
- Monitor flood: 1200 burst → total 1200, ring 60, dropped 900–960; 12 DOM rows in ≤175px; counter line; clear wipes (L352–372).
- Routing: chip writes the exact `.midi('…')` code into `t.extra`, lands on the track's doc line, routed list; engine accepts the doc and bytes arrive at the stub port; out-monitor records; TEST NOTE sends real 0x90/0x80; unroute empties the stack; MASTER route uses the `all(x=>…)` hook, MASTER OFF removes it; code track refused with explanation (L374–474).
- No error banner; Ctrl+Shift+I opens the panel via the keyboard dispatcher (L476–490).
- P2 (L493–839): panel sections + P2 API present (L509–529); capture refuses code/euclid tracks with reasons (L531–547); transport stopped → counted `offTransport`, grid untouched (L549–560); four notes land on nearest 16th per the engine clock between bracketing readings (L562–588); transport stop writes the take and MERGE keeps old hits (L590–610); OVERWRITE wipes first (L612–626); CANCEL discards, unplug writes + disarms clean (L628–656); strum lane + synth scale-degree grid + clamped count + doc line (L658–699); CC learn: pick+step-aside, click binds without turning the knob, listed with ✕, drives the parameter through the funnel, knob repaints, no cross-talk, 200-msg burst coalesced ≤6 writes + final value, CC123 refused as controller, unbind removes everywhere (L701–783); PC: styles flat-80, PC7 loads the right variation, out-of-range refuses, presets GUI/code, packs, PC off records+refuses (L785–839).
- P3 (L841–1126): clock API shape; ready state (on, output, BPM=cpm×4, not ticking, no error, persisted); 0xFA first then 0xF8 mean gap ±30% at 24 ppqn; stop 0xFC freezes wire; no-output no-op with reason; transport start/stop drives it; mid-run tempo doubling halves gaps; hush stops it; panel row readout + 24 ppqn copy (L853–986). Velocity arrays: parallel 16-slot, two decimals, nulls on empty; `.velocity("…")` emission law (absent → nothing, all-null → nothing); drum row arrays; OVERWRITE clears velocities; save/load round trip (L988–1126).
- P4 (L1128–1514): MPE row defaults (24/48/96, off), ON pushes pref→localStorage→engine (`pfSXMPESet` call args), bend select change, member note uses `pfSXNoteOnCh` and never the dock, two channels independent, per-channel bend ±24 semis at bend 48 only on that channel, AT ×4.15 filter only on that channel, CC74 60·300^(64/127) Hz, per-channel note-off, master ch1 keeps global paths (bend/at/cutoff), sustain on a member channel is still global, OFF brooms, PLAY IN off brooms, CC123 panic brooms, pref survives reload and re-pushes (±96).
- `--real` probe (L1520–1599): environment dump; ENABLE click; device report; then **CDP `Browser.grantPermissions`** tried in order `['midi','midiSysex']` → `['midi']` → `['midiSysex']` (L1558–1563), re-click ENABLE, real port names, then `sendTest(60,250)` and monitor proof.
- `finish()` L1601–1605 exits non-zero on any failure; `process.on('exit')` kills the browser + strays L1607–1611. **Anvil test plan mirrors all of it with `__avMidi`-style API handle, `data-av-ready` readiness, and Anvil's own note-path assertions.**

---

## 10. Port verdict table — per section, for Anvil

| # | Section | Verdict | Notes / PF dependencies to sever |
|---|---------|---------|----------------------------------|
| 1 | State machine + prefs | **PORT** (rename) | Swap `pf-midi`→`av-midi` key + `pf-` prefix; keep states/labels verbatim. Drop `hubSay`/`error` UI couplings for Anvil's own readout or no-op. Deps: `toast` (app_core.js L57), `showError` (L65), `hubSay` (app_hub.js L82). |
| 2 | Ports | **PORT as-is** | Only deps: `toast`, `showError`. Keep `midiPortFor` id-or-name resolution, `addEventListener` (never `onmidimessage`) law, hotplug wiring, auto-pick. |
| 3 | Decode | **PORT as-is** | Sole dep: `kbNoteName` (app_kb.js L249) — Anvil needs its own note-name helper or numeric fallback (guarded `typeof` today). Keep velocity-0 rule + 14-bit bend formula exactly. |
| 4a | Note routing | **PORT (retarget)** | Replace `kbNoteDown/kbNoteUp` (app_kb.js L454/L468) with Anvil's note path (doesn't exist yet); keep `midiHeld`, velocity `/127`, release-all. |
| 4b | MPE | **DEFER** (map above) | Deps: `pfSXNoteOnCh/NoteOffCh/MPESet/MPEAllOff/MPEBend/MPEAT/MPECutoff/MPEState` (app_synthx.js L653/L676/L627/L720/L687/L698/L711/L622). Keep the pref fields out until needed. |
| 4c | Capture | **DEFER** (map above) | Writes into PF's 16-step grids; deps `state/saveState/renderEditor/renderGrid/pushDoc/snapshot/selTrack` (app_core.js L38/L150/L174; app_ui.js L1394/L1458), `mirror.repl.scheduler.now()`, `STYLE_GENRES`-class catalogs. |
| 4d | Program change | **DEFER/DROP** | Deps: `pf.loadStyle/loadGuiPreset/loadCodePreset/packsLoadPattern` (app_ui.js L126/L93/L101/L201), `installedPacks`, `GUI_PRESETS/CODE_PRESETS`. |
| 5 | Monitor | **PORT** | Replace `hubTab`/`#hub-body` host checks with Anvil's panel ids; keep caps 240/60/12/120 + shared in/out rate budget + per-direction dropped exactly. Deps: `esc` (app_core.js L5). |
| 6a | Sends/tap/test | **PORT as-is** | `midiOutTapInstall`/`midiSelfSend`/`midiSendBytes`/`midiSendTest` are generic Web MIDI; keep the record-exactly-once law. Deps: `showError`, `toast`. |
| 6b | Clock out | **PORT (retarget BPM)** | Deps: `state.cpm` → Anvil tempo; hook `midiClockOutTransport` into Anvil app_core's transport functions (PF hook points: app_core.js L252/L274). Everything else (24 ppqn, scheduling law, honest errors) verbatim. |
| 6c | Route to hardware | **DROP (PF-only)** | `.midi('dev')` is a Strudel control; `t.extra` Transform Stack + `state.midi` + `buildDoc` all PF. Keep chips/table out; Anvil needs its own out-routing if wanted. Deps: `state`, `saveState`, `renderEditor`, `pushDoc`, `hubSay`. |
| 7 | CC map + learn | **ADAPT** | Machinery ports; rename knob selectors/functions per §7 reuse angle; default-map apply targets are PF engine calls — re-point or drop, keep `{cc:{label,apply}}` shape. Deps: `knobNormToVal/knobFormat/knobApplyVisual` (app_knob.js L10/L52/L125 → av equivalents), `pfApplyParam` (app_ui.js L1138 → `avApplyParam` app_core.js L26), `setPath` (L632), `pfRefreshValues` (L1128), `cssEscape` (L1391 → `avKnobCssEscape`), `hubTouch/hubSay`. |
| 8 | Panel + CSS | **PORT (re-skin)** | Keep builder/wiring split (`hubMidiHTML`/`hubWireMidi` + P2 pair) and all data-attrs; swap hub host classes/ids and the PF theme tokens in styles.css L1957–1985 for Anvil's. Deps: hub chrome (`hub-panel`, `hub-chip`, `hub-actions`, `session-facts`, `hub-note`, `btn`), `esc`, `toast`. |
| 9 | Test hooks | **PORT (adapt names)** | Stub string + CDP rig port verbatim; rename `__FORGE_READY`→Anvil readiness (`data-av-ready`), `window.__FORGE.midi`→`window.__avMidi` (cf. `window.__avTap`, av_tap.js L174). Keep `isOurPortClass` assertion and CDP `Browser.grantPermissions` fallbacks. |

---

## Undetermined (not determinable from the sources read — do not guess)

1. **Anvil's target note-path function names** to replace `kbNoteDown/kbNoteUp` and the engine per-note entry — `C:\Users\Moddy\anvil\src` (read 2026-10-07) contains only `app_core.js` (127 lines, P0 shell), `av_knob.js`, `av_tap.js`, `body.html`, `head.html`, `styles.css`; no engine/note path exists yet. This digest specifies the PF contract to mirror; the parent must fix the av-side names.
2. **Real-browser writability of `MIDIOutput.prototype.send`** — `midiOutTapInstall` is defensive (returns false, try/catch); the stub suite proves the patch mechanism, not that every target browser's prototype is writable in practice.
3. **PF theme token values** used by the MIDI CSS block (`--mono --serif --ink* --ok --danger --accent* --line* --cream`) — defined elsewhere in styles.css; not re-derived here. Anvil remaps to its own palette anyway.
4. Whether Anvil ever grows **sliders** (`input[type=range][data-path]`) — decides if the learn-click selector keeps its second half. (In PF the markup is real: app_ui.js L1241, binder L1320.)
5. Whether Anvil wants **any** out-routing beyond test-send — determines if §6c's quote/regex helpers are ported at all. (Marked DROP in the table pending that decision.)
