# KB port digest — Pattern Forge `app_kb.js` (keyboard dispatcher + 61-key piano dock + note path) → Anvil `av_kb.js`

**Written:** 2026-10-07 · for the Anvil research build (`C:\Users\Moddy\anvil`) · source `C:\Users\Moddy\pattern-forge\src\app_kb.js` (1,322 lines — read in full, offset/limit pages) + `src\body.html` L333-366 (dock markup, read in full) + `src\styles.css` (dock blocks, read at range) + `verify\test_keys.mjs` (read in full) + targeted reads/greps of `cdp_smoke / cdp_pop / cdp_synth / cdp_synthx / cdp_hardening / cdp_a11y_dialogs / cdp_sound`. Exemplar for precision and style: `T9-pattern-forge-reuse.md` §9/§12.
**Ref convention:** bare `L#` = line in `app_kb.js`; other files carry their module (`styles.css:974`, `test_keys.mjs:441`, `app_synthx.js:1869`). All sources under `C:\Users\Moddy\pattern-forge\`.
**Verdict vocabulary (T9):** **PORT** = copy with light edits · **ADAPT** = reuse with rework · **SKIP** = don't bring.

---

## 0. What the module is, and what Anvil wants from it

- Header (L1-6): "One central keyboard dispatcher for the whole workstation (DAW-style), a searchable keymap overlay (?), a floating Kody bubble that teaches each key on first use, an offline UI knowledge base …, and a clickable key strip for scale-highlighted note previews. **No top-level DOM access — this module must parse in the node test harness.**"
- T9 §9 law: the file is the ONE keydown dispatcher — "never add a second document listener". The binding lives in app_ui.js (see §2).
- Four separable layers: (a) `KB_DEFS` + `kbHandle` dispatcher; (b) the 61-key dock + note path (`kbBuildPiano`…`kbNoteStopAll`); (c) the popout keyboard (Stage 18/18.5, L593-952); (d) PF-side extras — keymap overlay (`kbOpenHelp`/`kbRenderHelp` L1172-1227), Kody teach (`kodyShout`/`kbTeach` L961-979), offline FAQ `KOALA_KB` (L123-183) + `aiOfflineRoute` (L1230-1253).
- For Anvil: (a) and (b) are the port; (c) is a self-contained optional later; (d) is SKIP.

## 1. Constants & maps

### 1.1 Piano range, construction, note→key mapping
- `PIANO_LO = 36` (C2), `PIANO_HI = 96` (C7) — "61 keys inclusive" (L256-259). Layout comment L314-316: "Flat layout: 36 white keys share the width equally; the 25 black keys sit absolutely on the boundaries between whites (standard piano geometry)."
- `PIANO_WHITE_KEYS = { a:0, s:2, d:4, f:5, g:7, h:9, j:11, k:12, l:14, ';':16 }` (L263) · `PIANO_BLACK_KEYS = { w:1, e:3, t:6, y:8, u:10, o:13, p:15 }` (L264) — comment L261-262: "Ableton-style typing-key mapping, semitones above the window's C. A-row = white keys, W-row = black keys."
- Derived tables: `PIANO_MAP` (key→semitone) and `PIANO_LABEL` (semitone→upper-case letter) built by looping both objects (L265-268).
- `kbPianoBase() = PIANO_LO + kbPianoWin * 12` (L287). `kbPianoWin` starts at 2 (L270) and is **not persisted anywhere** (no localStorage write in the file); window 0..3 → bases C2/C3/C4/C5 (L270 comment).
- `kbPianoNoteFor(key)` (L290-299): stringify + lowercase, reject length ≠ 1; table = `kbDesk === 'synth' ? SYNTH_MAP : PIANO_MAP` (L294); `midi = kbPianoBase() + map[k]`; **returns null when `midi > PIANO_HI || midi < PIANO_LO`** (L297); else `kbNoteName(midi)` → e.g. window 2 + 'a' = 'c4' (asserted by test_keys.mjs:379-381).
- `kbNoteName(midi)` (L249-254): `['c','c#','d','d#','e','f','f#','g','g#','a','a#','b'][pc] + (floor(midi/12)-1)` → 'c4', 'f#3'.
- Octave shifting: `kbPianoOctStep(dir)` (L954-958): `kbPianoWin = max(0, min(3, kbPianoWin + dir))`; then `kbRefreshPiano()` + a Kody shout (PF-only, L957). Callers: KB_DEFS `[`/`]` (L112-113, kbDo case L1040), armed STRUDEL `z`/`x` (L1143-1146), armed SYNTH ArrowLeft/ArrowRight (L1140-1142), rail buttons `#pk-oct-down/up` (L1306-1309), popout −/+ (L772-773), SOUND-desk octave buttons (PF-only, app_synthpanel.js:677-678, 1656-1664).
- Range edge: on high windows the top of the typing map falls off `PIANO_HI`, and `kbPianoNoteFor` returns null for those keys (they simply don't sound — no clamp, no fold).

### 1.2 Scale math (drives `.in-scale`/`.root`)
- `kbScaleNotes(scale)` (L191-205): 'C:minor:pentatonic' → `{root:'c', notes:[…]}`. Defaults root 'c', major `[0,2,4,5,7,9,11]`; minor `[0,2,3,5,7,8,10]`; dorian `[0,2,3,5,7,9,10]`; mixolydian `[0,2,4,5,7,9,10]`; lydian `[0,2,4,6,7,9,11]`; pentatonic major `[0,2,4,7,9]` / minor `[0,3,5,7,10]`.
- `KB_PC` letter→pitch-class map (L207).
- `kbSelectedScale()` (L301-312): reads the TRACK MODEL — `state.tracks[selTrack]`, per-type fields `.bass.scale` / `.synth.scale` / `.chords.scale` / `.sample.scale`, drums → 'C:minor'; wrapped in try/catch, default 'C:minor'. **PF-only coupling** — Anvil must supply its own scale source (or hardcode 'C:minor').

### 1.3 SYNTH desk maps + voices (only if Anvil keeps the two-desk design)
- Banner comment L209-214: "Two rows of octaves, the layout every DAW has used for thirty years … 29 semitones sit under the hands at once, the octave chips / [ ] / ← → slide the window across all 61 keys … STRUDEL mode keeps the A-row/W-row mapping untouched — this is a mode, not a rewrite of what people learned."
- `SYNTH_BANDS` (L215-220) exact:
  - band 1 whites `{ z:0, x:2, c:4, v:5, b:7, n:9, m:11, ',':12, '.':14, '/':16 }`, blacks `{ s:1, d:3, g:6, h:8, j:10, l:13, ';':15 }`
  - band 2 whites `{ q:12, w:14, e:16, r:17, t:19, y:21, u:23, i:24, o:26, p:28 }`, blacks `{ '2':13, '3':15, '5':18, '6':20, '7':22, '9':25, '0':27 }`
- `SYNTH_MAP` / `SYNTH_LABEL` built with the same loop (L221-226); `SYNTH_SPAN = 28` — "highest semitone the hands reach over the window base" (L227).
- `SYNTH_VOICES` (L231-242) — 10 `{id,label,room,attack,release}` rows: `gm_epiano1` E-Piano 0.2/0.004/0.5 · `gm_acoustic_grand` Grand 0.28/0.004/0.6 · `gm_marimba` 0.22/0.004/0.4 · `gm_string_ensemble_1` Strings 0.35/0.25/1.2 · `gm_flute` 0.3/0.03/0.5 · `gm_synth_bass_1` 0.12/0.01/0.3 · `sawtooth` Saw Lead · `square` · `triangle` · `sine` Sine Bell 0.4/0.01/1.0. `kbVoice()` finds by id, falls back `[0]` (L246). Voice ids are the engine patch ids (app_synthx.js `PFSX_PATCHES`, T9 §2).
- LS keys: `KB_DESK_LS = 'pf-desk-mode'` (L229), `KB_VOICE_LS = 'pf-synth-voice'` (L230), `KB_MODE_LS = 'pf-input-mode'` (L278); dock open LS `'pf-piano'` (L568, L1271); popout `KB_POP_LS = 'pf-keys-pop'` (L602) + sessionStorage `'pf-keys-token'` (L607).

### 1.4 Modes & state
- `KB_MODES = ['studio','keys','midi']` (L279); `kbInputMode = 'studio'` (L280); `kbArmed = false` (L281). Comment L272-277: "INPUT MODE — which set of keys the computer keyboard drives (the dock's switcher) … **kbArmed MIRRORS the KEYS mode (armed === mode 'keys')**, so every existing path — the ` toggle, Esc, body.kb-armed, the DOM checks — keeps its meaning."
- Desk: `kbDesk = 'strudel'` (L243), `kbInputBeforeSynth = 'studio'` (L245).
- Held-note structures (all declared L282-285, plus L452):
  - `kbHeldNotes = new Set()` — held note NAMES (velocity-agnostic).
  - `kbHeldByKey = new Map()` — "typing key → the note it started (the octave window can hop mid-hold)" (L283).
  - `kbHeldGain = new Map()` — "held note name → velocity gain (hardware keys); 0.9 when absent" (L284).
  - `kbMouseDown = false` (L285); `kbNativeHeld = new Set()` — "notes the native SYNTH engine took (Phase 1) — their release never rebuilds the document" (L451-452).

### 1.5 The typing-armed ("backquote") mechanic — full chain
1. KB_DEFS `pianoArm` (L105-106): key `` ` ``, desc "INPUT: flip STUDIO ↔ KEYS — KEYS turns the typing keys into the dock (A = C, W = C♯, Z / X octaves)"; plus `modeStudio`/`modeKeys`/`modeMidi` Ctrl+Alt+1/2/3 entries (L107-109) and `deskMode` Ctrl+Alt+M (L110-111); `pianoOctDown/Up` `[`/`]` (L112-113); `pianoToggle` Y (L103-104).
2. kbDo case `pianoArm` (L1038): `kbSetInputMode(arg || (kbArmed ? 'studio' : 'keys'))`.
3. `kbSetInputMode(mode, opts)` (L544-558) — "the ONE place the input mode changes": invalid mode → 'studio' (L545); `kbArmed = (mode === 'keys')` (L549); persists `pf-input-mode` unless `persist:false` (L550); `if (mode !== 'keys') kbNoteStopAll()` — comment "leaving KEYS must never leave a note droning" (L551); `kbRefreshPiano()` (L552); first-time teach shouts per mode (L553-557, `kbTaught` Set L972-979).
4. `kbSetArmed(v)` (L561) = `kbSetInputMode(v ? 'keys' : 'studio')` — the legacy shim keeps old callers meaning "KEYS mode".
5. kbHandle: in MIDI mode `` ` `` → `kbDo('pianoArm')` (L1117); the armed branch (L1137-1151, §2).
6. Esc: `kbDo('esc')` first branch `if (kbArmed) { kbSetArmed(false); break; }` (L1043-1044).
7. Desk interplay: `kbDeskSet('synth')` forces KEYS mode and remembers the previous one (`kbInputBeforeSynth`); leaving SYNTH restores it unless `restoreInput:false` (L507-512).
8. Mirrors: `kbRefreshPiano` toggles `document.body.classList kb-armed/kb-midi` (L376-377), `#pk-arm-led.on` (L374-375), chip `.on`/aria-pressed (L379-383).
9. Boot restore: kbInit validates the stored mode against KB_MODES and calls `kbSetInputMode(saved, { persist:false, teach:false })` (L1284-1286).

## 2. `kbHandle` — complete key→action table

**Binding (the only document keydown for shortcuts):** `document.addEventListener('keydown', (e) => { if (typeof kbHandle === 'function') kbHandle(e); });` — app_ui.js:2321-2324, comment: "keyboard — everything routes through Kody's keymap (app_kb.js)". Same boot block calls `kbInit()` (app_ui.js:2479). The popout never adds a listener; it re-dispatches raw `KeyboardEvent`s into the app document (L781-797).

**Entry guards (L1069-1076):** `t = e.target || document.body` ("a forwarded key … can arrive with no target: treat that as 'not typing'"); `typing` = tag input/textarea/select OR `t.isContentEditable` OR `t.closest('.cm-editor')`; `mod = e.ctrlKey || e.metaKey`; `tag` lowercased. **There is NO `e.repeat` guard** (the only `repeat` mention is the popout forwarder copying it through, L784). Repeat consequences: piano notes are idempotent because `kbNoteDown` early-returns on `kbHeldNotes.has(name)` (L455); held action keys (tempo, octave) simply repeat.

**Dispatch order** (top to bottom; "PF-only" = drop in Anvil):

| # | when | action (kbDo id) | line | PF-only? |
|---|------|------------------|------|----------|
| 1 | mod+Enter (works while typing) | eval | L1079 | PF |
| 2 | mod+K | drawer toggle | L1080 | PF-only |
| 3 | mod+. | hush | L1081 | PF |
| 4 | mod+Z, !shift, outside `.cm-editor` | undo | L1082-1086 | PF |
| 5 | mod+S !shift | save | L1087 | PF |
| 6 | mod+Shift+C | share | L1088 | PF |
| 7 | Alt+←/→ | tabBack / tabFwd | L1090 | PF-only |
| 8 | mod+Shift+V | Kody voice | L1091 | PF-only |
| 9 | mod+Shift+M | Kody mic | L1092 | PF-only |
| 10 | mod+Shift+D | dockFold (band fold) | L1093 | PF dock |
| 11 | mod+Shift+A / W / ↑ / ↓ | dancer toggle / move / speed | L1094-1096 | PF-only |
| 12 | mod+Alt+1 / 2 / 3, !shift | input mode studio/keys/midi | L1099 | **portable core** |
| 13 | mod+R (mod+Shift+R) | record (stems) | L1100-1101 | PF-only |
| 14 | mod+Shift+E | saveAll | L1102 | PF-only |
| 15 | mod+Shift+I | MIDI panel | L1103 | PF-only |
| 16 | F8 | hub | L1104 | PF-only |
| 17 | Escape | `esc` chain | L1105-1108 | ADAPT |

- Ctrl+Z trap (L1082-1085): claimed only outside `.cm-editor` — "CodeMirror binds Ctrl+Z to ITS undo (and runs first), so claiming the key here as well fired the APP's undo on top, which regenerates the document from the model and silently ate a hand edit."
- Esc chain (L1043-1063): armed → disarm; keymap overlay → close; hub → close; help → close; drawer → close; `side-closed` → restore; finally blur a focused INPUT/TEXTAREA/contentEditable — "the same promise the piano makes ('Esc hands the keyboard back')" (L1056-1062). Esc's preventDefault comment L1105-1107: "[Escape is] the one key the browser still claims for itself ('stop loading' — it can abort the CDN fetch the app boots from, and in headless builds it takes the renderer down). Claim it, then act."
- **Typing guard** L1109: `if (typing) return;` — nothing single-letter fires from a focused field; all combos above still work (that is their point).
- **MIDI swallow** (L1111-1123): comment "the hardware owns the notes. One unmodified PC key must never fire a workstation action mid-performance". Space → play; `` ` `` → pianoArm; every other non-F-key: if `e.key.length === 1` or `/^(Arrow|Delete|Backspace|Page|Home|End|Insert)/` → preventDefault + return; F1-F12 fall through.
- **Alt+1..4 blend hotkey** (L1129-1136): `e.altKey && !ctrl && !meta && !shift && typeof pfBlendHotkey === 'function'` and not typing → consume. PF-only (app_synthpanel.js:2589).
- **Armed branch** (KEYS mode) L1137-1151: `if (kbArmed && !mod && !e.shiftKey && !e.altKey)`:
  - Space → play (L1138);
  - SYNTH desk: ArrowLeft/Right → `kbPianoOctStep(∓1)` (L1140-1142);
  - STRUDEL desk: `z` → octave down, `x` → up (L1143-1146);
  - `k2 = e.key.toLowerCase()`; note = `kbPianoNoteFor(k2)`; if note → preventDefault + `kbNoteDown(note)` + `kbHeldByKey.set(k2, note)` (L1147-1148);
  - else if `/^[a-z0-9;,./\[\]=\-]$/.test(k2)` → preventDefault, swallow ("so no shortcuts fire mid-performance", L1149-1150).
  - Keys NOT swallowed fall through to the blocks below — e.g. plain ArrowUp/Down on the STRUDEL desk still reach KB_DEFS (`selPrev`/`selNext`, L43-45); F-keys keep working. Comment L1127: "ALT is excluded: Alt+letter belongs to the menubar (Alt+F/E/V/H/U/A) — without this the menu letter also played a note while the piano was armed."
- Digits (L1153-1154): plain 1-9 → `pf.sel(i)` when `i < state.tracks.length` (PF-only; and note digits ARE swallowed while armed because the swallow regex includes 0-9).
- KB_DEFS lookup (L1156-1167): match on lowercased key + exact mod/shift/alt booleans (`!!d.mod === mod` etc.); preventDefault; `kbDo(def.id, def.arg)`; then `kbRefreshPiano()` — "keep scale/window highlights in sync after any key action" (L1167).
- `kbDo(id, arg)` (L982-1067): resolves `fn = (def && def.fn) || id` then a switch; after dispatch `if (def) kbTeach(def)` (L1066) fires the one-time teach line.
- **keyup handler** (L1312-1321, registered in kbInit): comment — "keyup → release held piano notes while armed. The note name (not the key) is what kbNoteDown stored, so remember which note each typing key started — passing the raw key back (the pre-switcher behaviour) never matched and left the note droning forever." Code: `if (!kbArmed || e.ctrlKey || e.metaKey) return; const k = String(e.key||'').toLowerCase(); const note = kbHeldByKey.get(k) || k; kbHeldByKey.delete(k); kbNoteUp(note);` (L1315-1321). No alt guard here.

## 3. Dock DOM + interaction

### 3.1 Markup (`body.html:333-366`) — the whole subtree
- `#piano-dock` (333) = `#piano-rail` (334) + `#piano-keys` (365, empty; built by JS).
- Rail, in order: `#pk-close` ✕ "Hide the piano (Y)" (335) · `#pk-pop` ⧉ (336) with `#pk-return` "⧉ BACK" (337, `display:none` until `body.piano-pop`) · `#pk-modes` group (338-342) with three `.pk-mode` buttons `data-mode="studio|keys|midi"`; the KEYS chip contains `<span class="pk-sw-led" id="pk-arm-led">` (340) · `#pk-mode-sw` group (343-346) with `.pk-modesw` chips `data-pfmode="strudel|synth"` · `#pk-mix` (347-352) `.sd-bl` blend chips `data-blend="synth|beats|mix|off"` (shared styling with the sound desk; wired PF-only) · `#pk-mode-hint` (353, initial STUDIO copy) · `.pk-rail-ctl` (354-362): `#pk-voice-slot` label ["VOICE" cap + `#pk-voice` select], `#pk-oct-down` −, `#pk-win` "OCT C4", `#pk-oct-up` + · `.pk-rail-note` (363) "click to play · hold to sustain · glide to sweep · ` flips STUDIO ↔ KEYS".
- Topbar toggle: `#btn-piano` 🎹 title "Piano dock — 61 keys at the bottom (Y)" (body.html:28).

### 3.2 Key generation (`kbBuildPiano`, L317-340)
- whites: every midi 36..96 whose pc ∈ [0,2,4,5,7,9,11] (L321-324) → `<button class="pk-key pk-white" data-note="<name>" data-midi="<m>" title="<name>">` (L327-329).
- `W = 100/whites.length` (≈2.778%), `BW = W * 0.6` (≈1.667%) (L325-326).
- blacks: midi with pc ∈ [1,3,6,8,10]; `below = m-1` (the white beneath), `left = (belowIdx + 1) * W − BW/2`; button with inline `style="left:…%;width:…%"` (L330-337). (styles.css:1059 carries a default width of 8.571% that the inline style overrides.)
- `keysBox.innerHTML = html`, then `kbRefreshPiano()` (L338-339).

### 3.3 Class/label refresh (`kbRefreshPiano`, L343-410)
- Bails without `#piano-dock` (L344-345). `scale = kbScaleNotes(kbSelectedScale())`; `rootPC = KB_PC[scale.root] ?? 0` (L346-347).
- Iterates `kbKeyRoot().querySelectorAll('.pk-key')` — wherever the bed lives (popout-aware, L349-350).
- Per key: `pc`; `rel = (pc − rootPC + 12) % 12`; `classList.toggle('in-scale', scale.notes.includes(rel))` (L354); `('.root', rel === 0)` (L355).
- Window/letter: `off = midi − base`; table = `SYNTH_LABEL` when `kbDesk==='synth'` else `PIANO_LABEL`; `letter = table[off] || ''`; `classList.toggle('in-win', !!letter)` (L356-359). When `letter` changed vs `dataset.letter`: store it, ensure a `.pk-note` span with `kbNoteName(midi)` text, and ensure/update/remove a `.pk-keycap` span with the letter (L360-370). (Conditional on change — the note span is only created for keys that have held a letter.)
- `#pk-win` text = `'OCT ' + kbNoteName(base).toUpperCase()` (L372-373); `#pk-arm-led.on` (L374-375); body classes `kb-armed`/`kb-midi` (L376-377).
- Chips: `#pk-modes .pk-mode` — `.on` + `aria-pressed` on the `data-mode === kbInputMode` one (L379-383); `#pk-mode-sw .pk-modesw` — same vs `data-pfmode === kbDesk` (L385-389).
- `#pk-mode-hint` text: popout copy when `body.piano-pop`, else `kbModeHint(kbInputMode)` (L390-393). `kbModeHint` (L490-495) full strings: SYNTH — voice label + "Z-row white keys (Z = …), S-row black, Q-row the octave above; ← → or [ ] slide the window, Space plays, Esc hands back."; KEYS — "A-row white (A = …), W-row black, Z / X hop octaves, Esc hands back."; MIDI — "the hardware plays; PC letters stay quiet. Ctrl/Alt combos, F-keys and Space still work."; STUDIO — "letters are the workstation: G styles · P presets · D dice · S surprise · A Kody."
- Popout mirror (L396-409): while `kbPopEls` exists, copies win label, ARM state, hint, and body classes into the popout document.

### 3.4 Pointer/click wiring (`kbBindKeysBox`, L649-678)
- Guarded once per box: `if (box.dataset.pfBound === '1') return box;` (L650). Comment L646-648: the wiring "lives HERE … It used to be bound once in kbInit — a bed REBUILT by kbEnsureKeysBox … came back visually perfect but unclickable: every pointer path silent, no error anywhere."
- `pointerdown` → `e.target.closest('.pk-key')` → `preventDefault(); kbMouseDown = true; kbNoteDown(k.dataset.note);` (L652-658).
- `pointerenter` while `kbMouseDown` → `kbNoteDown(k.dataset.note)` — the glide/sweep (L659-663).
- `pointerup` AND `pointerleave` → `kbMouseDown = false; kbNoteStopAll();` (L664-665).
- `contextmenu` → preventDefault (L666).
- `click` with `e.detail === 0` (keyboard-synthesised Enter/Space on the focused button) → `kbNoteDown(note)` + `setTimeout(kbNoteStopAll, 350)` — a11y audit F9; comment: "a <button> that ignores Enter is worse than no button … e.detail is 0 for a keyboard-synthesised click, so the pointer path (which already sounded the note on pointerdown) is not doubled up" (L667-676).
- No pointer capture, no `pointercancel` handler — release relies on pointerup/pointerleave (and `touch-action:none` on the dock, styles.css:983).
- Bed missing/adoption: `kbEnsureKeysBox()` (L630-644) rebuilds `#piano-keys` after the rail and re-binds when absent/empty — comment L626-629: a popout renderer that dies "takes the adopted node with it, and the static markup has no second one." `kbKeysEl`/`kbKeyRoot` (L617-624) resolve "whichever window currently owns the bed".

### 3.5 Key-press → note call chain (summary)
- Mouse: pointerdown → `kbNoteDown(data-note)`; glide → per-key `kbNoteDown`; pointerup/leave → `kbNoteStopAll()` (all notes).
- Keyboard (KEYS mode): keydown → `kbPianoNoteFor` → `kbNoteDown` + `kbHeldByKey.set`; keyup → `kbNoteUp(kbHeldByKey.get(k) || k)`.
- Popout: raw key → re-dispatched in the app document → same kbHandle path (`host.__lastFwd` counts deliveries, L792).
- A11y click → note + timed release.

### 3.6 Y toggle, body classes, dock sizing
- `kbTogglePiano` (L587-591): flips `piano-closed` via `kbSetPianoOpen`; koalaSay on open (PF-only, L590).
- `kbSetPianoOpen(open)` (L563-585): closes the popout first ("bring them home first", L564-566); toggles body `piano-closed`; persists `'pf-piano'` ('1'/'0') (L568); drops any boot-restored `synFit.bootWord` (L570-571); when opening a railed band it un-rails ONLY if there is room — `PF_LIMITS.dock` fallback `{rail:64, def:136}`, `pfPref('dock-h', def)`, `pfSynFitRoom(want).editorTrue >= 120` → `pfDockSet(want)`, else `hubSay('The keys need a taller window than this…')` (L575-583). Comments L572-574: "the rail is a squeeze state, not a destination: asking for the keyboard back un-rails the band — but only where the keys can actually STAY."
- Init default: saved `'pf-piano' === '0'` → `piano-closed` (L1271-1273).
- Body classes owned by this module: `piano-closed`, `kb-armed`, `kb-midi`, `piano-pop` (plus `mode-synth` via kbDeskSet L506); it reads `dock-rail` (owned by pfDockSet, app_ui.js:701).
- kbInit wiring (L1256-1321), the full list: `#btn-kb`→kbOpenHelp (PF overlay); `#btn-kody`, `#btn-side-close`, `#btn-tracklist-close`, `#btn-lights` (PF-only); dock block L1269-1311: restore piano-closed · `kbBuildPiano()` · `#btn-piano`→kbTogglePiano · `#pk-close`→`kbSetPianoOpen(false)` · `#pk-pop`→kbPianoPopOpen · `#pk-return`→kbPianoPopClose · restore input mode · `.pk-mode` chips → `kbSetInputMode(b.dataset.mode)` · `.pk-modesw` chips → `kbDeskSet(b.dataset.pfmode)` · `#pk-voice` options from SYNTH_VOICES + restore saved + change→kbVoiceSet · restore desk `pf-desk-mode` via `kbDeskSet('synth',{persist:false,teach:false})` · `#pk-oct-down/up`→kbPianoOctStep · `kbBindKeysBox(#piano-keys)`. Then the document keyup listener (L1312-1321).

### 3.7 Popout keyboard (Stage 18/18.5) — summary, SKIP-able for v1
- Comment L593-601: the bed is pure UI; handlers bound to `#piano-keys` itself "ride with the node when it is ADOPTED into the other window"; while keys are out the band keeps only its rail (which "makes --dock-tax fall to the rail's 36px BY ITSELF"); the fit ladder reads `body.piano-pop` and leaves the rail alone.
- `kbPopRect`/`kbPopSaveRect` (L680-702): rect persistence, filter `width≥300 && height≥120`, clamp to screen so a rect from an unplugged monitor can't reopen off-screen; default `w=min(1100, sw-80), h=236` near the bottom.
- `kbPopSeatBand` (L704-720): comment "While the keys are out the band holds ONLY its rail — unless the code drawer is open, which needs the band's height for its own code view (#codedrawer's height is var(--dock-h))"; seats via `pfDockSet(drawerOut ? wantH : 40, {silent:true})`.
- `kbPopMount(win)` (L722-814): imports the app stylesheet by CONTENT (finds the `<style>` containing 'pk-white', L731-736, stamps `data-pf-pop-sheet` so a reused window can't stack copies); injects popout chrome + `#pk-pop-bar` [⧉ BACK | ARM | − OCT + | hint] (L737-768); ARM calls `kbSetInputMode(kbArmed ? 'studio' : 'keys')` (L771); key forwarder `fwd(type)` re-dispatches `new host.KeyboardEvent(...)` into the APP document — comment L774-779: "this handler is DEFINED in the app's realm even though it runs on the popout's document, so `window` inside it is the APP's window"; delivery witness `host.__lastFwd` (L792); and if the app claimed the key, the popout event is `preventDefault`ed too "or the BROWSER also acts on it in this window — Ctrl+R would reload the popout out from under the keys" (L793-795). Forwarders are replaced per document — comment L798-801: re-mounting once stacked them "so one keystroke reached the app N times and every TOGGLE … ran an even number of times — i.e. did nothing."
- `kbPianoPopOpen` (L834-915): PiP first (documentPictureInPicture), with an impostor check — "A resolve is not a window … accept only a live, current PiP window" (L845-852); else `window.open('', 'pf-keys', …)` with the comment L856-860: `''` — "NOT about:blank: a window LEFT OVER from an earlier popout … is reused by name, and opening a URL in it NAVIGATES it — anything appended before the navigation commits is wiped, which reads as a silent no-op that then blocks every later attempt."; foreign-tab ownership via `win.__pfKeysOwner !== kbPopToken()` (L872-883); band state saved to `kbPopRestore {h, railed}` (L889-898); body `piano-pop` added; the live bed is APPENDED into the popout (L900); drawer-aware seating + hubSay copy (L901-913).
- `kbPianoPopClose` (L917-952): comment L919-921 — "the app's OWN state is the body class — the window handle can be gone without a close ever running … gating on the handle alone left a dead ⧉ BACK and a permanently railed, keyboard-less band with no way home." Bed comes home to `#piano-dock` (L927-929); `kbNoteStopAll(); kbMouseDown=false` ("a note held in a dead window must not drone", L932); band restore respects drawer-open/railed (L937-943).

## 4. Note path — kbNoteDown / kbNoteUp / kbNoteStopAll

### 4.1 Semantics
- `kbNoteDown(name, vel)` (L454-466), steps in order:
  1. `if (!name || kbHeldNotes.has(name)) return;` — dedupe; also the natural key-repeat guard (L455).
  2. `kbHeldNotes.add(name)` (L456).
  3. Velocity: only if `typeof vel === 'number' && isFinite(vel)` → `kbHeldGain.set(name, clamp(vel, 0.05, 1))`; comment: "optional gain: hardware keyboards pass velocity/127, the dock and typing keys do not" (L457-458). Real callers: app_midi.js:417-419 (`kbNoteDown(name, vel / 127)`), app_midi.js:966-976 (playIn: `vel == null ? 0.9 : vel`).
  4. `window.__lastNotePreview = name;` `window.__lastNoteCode = null;` — comment: "the native engine is the note path now" (L459-460).
  5. Engine resolution: `midi = pfSXNameToMidi(name)` (app_synthx.js:730); `native = (midi != null && typeof pfSXNoteOn === 'function') ? pfSXNoteOn(midi, kbNoteGain(name), name) : false` (L461-462; engine signature `pfSXNoteOn(midi, gain, name, patchId, when, drumForce)` app_synthx.js:1869). If native → `kbNativeHeld.add(name)`; else → `kbPlayHeld()` — "no audio context yet (engine not started): the old preview path answers instead" (L463-464).
  6. First-note teach: `if (typeof koalaSay === 'function' && kbHeldNotes.size === 1) koalaSay('Ooh, ' + name + '. Nice choice.')` (L465) — PF-only.
- `kbNoteUp(name)` (L468-477): `if (!name || !kbHeldNotes.delete(name)) return;` → `kbHeldGain.delete(name)` → if it was native: `pfSXNoteOff(midi)` and return (comment L451: native notes' "release never rebuilds the document"); else `kbPlayHeld()` — "a note the engine never took: restore the document the preview replaced" (L476).
- `kbNoteStopAll()` (L479-487): `kbHeldByKey.clear()` first; snapshots `had = kbHeldNotes.size > 0` and `hadNative = kbNativeHeld.size > 0`; clears `kbHeldNotes` + `kbHeldGain`; if hadNative → clear `kbNativeHeld` + `pfSXAllNotesOff()` (app_synthx.js:2025); if had && !hadNative → `kbPlayHeld()`.
- `kbNoteGain(n)` (L416-419): `kbHeldGain.get(n)` clamped 0.05..1 when finite, else 0.9.
- External callers to keep in mind: app_midi.js:5/401-438 (incoming MIDI → kbNoteDown/kbNoteUp so "an incoming note behaves like a clicked [key]"); app_midi.js:1644 (`kbNoteStopAll` on panic paths).

### 4.2 Fallback preview (document stack) — runs only when the engine cannot take notes
- `kbPlayHeld()` (L420-430): requires `engineReady && mirror && mirror.repl`; `code = kbNoteCode()`; `window.__lastNoteCode = code`; `pfEvalCode(code, false)` — **comment L425: "autostart FALSE: a key press must never start the beats — PLAY is the only transport start"**; `.catch` → `showError('Piano failed: …')`.
- Comment L412-415 (verbatim): "engine playback: held notes stack on top of the document as one more `$:` line; empty set restores the plain document. The string is evaluated on the repl itself — **mirror.evaluate() ignores its argument and re-evaluates the editor buffer, which is why the dock used to be silent no matter what was played.**"
- `kbNoteCode()` (L440-449): `doc = state.raw || buildDoc(state)` (buildDoc = app_codegen.js:354); no held notes → return doc; else append ONE `$:` line: `'// kody-key-preview\n' + doc + '\n$: ' + (held.length > 1 ? 'stack(…)' : …)` where each note is `note("<n>").s("<voice.id>").attack(<v.attack>).release(<v.release>).gain(kbNoteGain(n)).room(<v.room>)` (L445-448). Comment L437-439 (verbatim): "note() carries the pitch: a synth voice reads `note` and ignores `n`, so the old n(\"c4\") form left every key at the default C2. Held notes sound at the next cycle boundary — that is the engine's pattern-swap law, not something this call can change."

### 4.3 Voice-switch trap (kbVoiceSet) — L529-541
Comment L536-539 (verbatim): "re-render the held-note preview only when a held note is one the ENGINE never took — a native note is an instrument over the document, and picking a voice while it rings must not write the preview into the running document (the +97-char activeCode drift the cdp_synthx deep tail caught: kbPlayHeld ran with only engine-native notes held)." Code guard: `if ([...kbHeldNotes].some(n => !kbNativeHeld.has(n))) kbPlayHeld();` (L540).

### 4.4 Every comment-marked trap near this path (quotes + refs)
1. L412-415 — `mirror.evaluate()` ignores its argument (why the old dock was silent). [quoted §4.2]
2. L425 — autostart FALSE: a key press must never start the beats.
3. L432-439 — fallback runs only when the engine can't take notes; `note()` not `n("c4")`; "Held notes sound at the next cycle boundary — that is the engine's pattern-swap law." [quoted §4.2]
4. L451 — native-taken notes' release never rebuilds the document.
5. L457 — velocity path: hardware passes velocity/127; dock/typing keys do not.
6. L460 — `__lastNoteCode = null` because "the native engine is the note path now".
7. L536-540 — voice-change trap above. [quoted §4.3]
8. L551 — "leaving KEYS must never leave a note droning" (kbSetInputMode stop-all).
9. L626-629 — popout renderer death takes the adopted bed; `kbEnsureKeysBox` rebuilds it.
10. L646-648 — pointer wiring must live in `kbBindKeysBox` or a rebuilt bed is unclickable.
11. L667-669 — a11y F9: keyboard Enter must play; `e.detail === 0` distinguishes it from the pointer path (no double-fire).
12. L919-921 — popclose must gate on `body.piano-pop`, not the window handle ("a dead ⧉ BACK and a permanently railed, keyboard-less band with no way home").
13. L1082-1085 — Ctrl+Z must not double-fire over CodeMirror's own undo.
14. L1105-1107 — Esc must be claimed (preventDefault) or the browser's "stop loading" aborts the CDN boot / takes the headless renderer down.
15. L1127 — Alt excluded in armed mode (the menubar owns Alt+letter).
16. L1312-1314 — keyup must pass the NOTE name via `kbHeldByKey`, not the raw key, or "the note dron[es] forever".

### 4.5 Engine resolution order (to re-point in Anvil)
`pfSXNameToMidi` → `pfSXNoteOn(midi, gain, name)` (native; returns false when the engine cannot take it) → fallback `kbPlayHeld()` (document-stack preview). Release: `pfSXNoteOff(midi)` for native-held, else fallback restore. Panic: `pfSXAllNotesOff()` for native, else fallback restore. For Anvil the parent writes the avNote bus: keep this exact structure — dedupe on name, gain clamp 0.05..1, a "taken natively" set so release does nothing heavy, and a stop-all that clears every structure.

## 5. Test observables

### 5.1 `verify/test_keys.mjs` (read in full; 75 checks — 73 phase checks per the table L607-611 [6+14+12+4+21+4+6+6] + 'engine ready' + 'desktop viewport' boot checks L646-658; T9 §22 records 75)
- SNAP (L128-152) reads: body class string (L136), `window.__lastNotePreview` (L145), `kbArmed` (L146), `pfDockGet()` (L147), activeElement id.
- MODE_SNAP (L158-181) reads: `kbInputMode` (L163), `kbArmed` (L164), chips `#pk-modes .pk-mode` `{m,on,pr}` (L160), `#pk-arm-led.on` (L166), `#pk-mode-hint` text (L167), `body.kb-midi` (L168), `localStorage['pf-input-mode']` (L169), `kbHeldNotes.size` (L170).
- RESET (L185-200) — the harness contract to copy: strips body classes `['side-closed','tracks-closed','lights-off','piano-closed','drawer-open','kb-armed','kb-midi','overlay-sidebar','dock-rail']` (L186-187); `kbSetInputMode('studio', {persist:false, teach:false})` (L190); `kbNoteStopAll()` (L192); `window.__lastNotePreview = null` (L193); `pfDockSet(176)` (L194).
- Phase 0 (L217-268, 6 checks): a REAL mouse click at a piano key plays it through the first-run splash — checks `elementFromPoint`/`__pfClickTarget` lands on `button.pk-key`, `window.__lastNotePreview === keyBox.note` (key c2 in `_battery` logs), splash stays up.
- Phase OV (L271-296): '?' keymap open/close (PF overlay).
- Phase A1 (L299-331): workstation keys incl. J panel, tempo = / −.
- Phase A2 (L334-370, 12): view/transport incl. `y` → `piano-closed` (L342), Ctrl+Shift+D fold (L346), Ctrl+K drawer (L345).
- Phase A3 (L373-388, 4): `` ` `` arms → `armed===true && body.kb-armed` (L376-378); `a` → `__lastNotePreview==='c4'` and NO tab switch (L379-381); Escape → disarmed (L382-384); `` ` `` re-arms (L385-387).
- Phase MODE (L441-594, 21): fresh dock = STUDIO, exactly one chip lit, hint says STUDIO (L446-450); all three chips hit-tested at their centres (L452-459); KEYS chip click → `mode==='keys' && armed && #pk-arm-led.on && hint~KEYS` (L462-466); keydown A → c4, tab unchanged (L468-474); keyup → `kbHeldNotes` 1 → 0 (L475-476); `` ` `` → STUDIO (L479-483); STUDIO A opens KODY, no note (L487-490); MIDI chip → mode midi, armed false, `body.kb-midi`, hint MIDI (L494-498); A dead, S (surprise) / ArrowDown / digit 3 all swallowed while keeping style/selection (L499-509); Ctrl+K still toggles, SPACE still plays, F8 still opens hub in MIDI (L510-522); `` ` `` from MIDI → KEYS (L524-528); Ctrl+Alt+3 works from inside a focused text field (L533-539); MIDI × typing guard: letters type into `#style-search` (L540-542); Ctrl+Alt+2 + typing: field types, NO note (L543-549); keymap overlay search "input" lists Ctrl+Alt+1/2/3 (L553-559); mode survives a REAL Page.reload with `pf-input-mode === 'midi'` before/after (L562-581); corrupt stored mode 'klingon' → falls back to STUDIO, localStorage rewritten (L582-590).

### 5.2 Sibling suites (refs quoted from targeted reads/greps — exact lines, not full reads)
- `cdp_smoke.mjs` L467-505: `document.querySelectorAll('.pk-key').length`; dock visible via `!piano-closed`; `.pk-key.in-win` exists; pointerdown on it → `window.__lastNotePreview === pkFirst.dataset.note`; after pointerup + `pf.regen()` the editor text must NOT contain 'kody-key-preview' (release restored the document); `y` toggles; `` ` `` arms; keyed A → armedNote; Esc disarms; drawer/piano split rect check `pr.left >= dr.right - 2 && pr.height > 90 && Math.abs(pr.height - dr.height) <= 3` (L499-505).
- `cdp_pop.mjs`: dock key count (L107-121); bed-in-popout `.pk-key` counts (L207-208, 239-241, 334, 347); `kbHeldNotes`/`__lastNotePreview` hold/release across the popout (L232-241, 619-632); forward witness `window.__lastFwd` (L406-420, 539-553); rebuilt bed via `#piano-keys .pk-key[data-midi="60"]` pointerdown → held (L373-379); `piano-pop` + `dock-rail` + `--dock-tax` readout (L479, 553, 604-606).
- `cdp_synth.mjs` L61-96: switcher chips `data-pfmode` + lit; after clicking SYNTH: `kbDesk==='synth'`, `kbInputMode==='keys'`, `kbArmed===true`, `#pk-mode-sw .pk-modesw.on`, hint text; L130-156: `__lastNotePreview` after z/q keys, `window.__FORGE.mirror.repl.state.activeCode` must NOT contain 'kody-key-preview' (native path never touches the document), `kbPianoWin` after `x`; L165-182: `.pk-keycap` letters per window.
- `cdp_synthx.mjs` L104-106 (desk click → `body.mode-synth`, input keys, armed); L194 `[...kbHeldNotes]`, `__pfSX.stats()`; L239-243 clicks `.pk-key[data-midi="72"]`; L342-348 reads `[...kbHeldNotes]`, `[...kbNativeHeld]`, kbArmed, kbDesk, blend.
- `cdp_hardening.mjs` L214-217 (#piano-dock[inert] leak check), L267-274 (kbDesk/kbArmed probes, note the input-mode flip persists the desk).
- `cdp_a11y_dialogs.mjs` L119-120 + L441-466: `PF_INERT_SEL` includes `#piano-dock`; kbArmed is restored to false and `kbSetInputMode('studio')` after dialog tests.
- `cdp_sound.mjs` L169-198 (dock rect in the SYNTH layout), L374 (`#pk-mode-hint` rect).
- Desk-switch clicks `#pk-mode-sw .pk-modesw[data-pfmode="synth"]` also in cdp_depth_ui.mjs:165, cdp_depth.mjs:183, cdp_stress.mjs:71, cdp_layout.mjs:271-281.

## 6. CSS inventory (`src\styles.css`)

**Layout math (portable pattern):**
- `:root { --dock-h: 136px; --ed-min-v: 260px; }` (951). `body:not(.piano-closed), body.drawer-open { --dock-tax: var(--dock-h, 136px); }` (955; comment 952-954: "The dock tax — ONE variable for 'how much of the bottom is out right now': 0 while nothing shares the band, --dock-h the moment the keyboard or the code view is out").
- `#layout { height: calc(100vh - var(--header-h) - var(--strip-h, 0px) - 8px - var(--dock-tax, 0px)); }` (956).
- PF_LIMITS.dock = `{ min:30, rail:64, max:620, def:136 }` (app_ui.js:686-687). `pfDockSet(h)` clamps, writes `--dock-h = rail ? 36 : want` px and toggles `body.dock-rail` when `want <= 64` (app_ui.js:696-701). `pfDockLive()` reads the computed `--dock-h` (app_ui.js:723-727). On-screen rail height = 36px (comment L988).
- `--dock-tax` consumers: `#errbar` bottom (526), `#toast` bottom calc +14 (543), `#layout` (956), dancer dock `bottom: calc(var(--dock-tax,0px) + 16px)` (1872-1874), `.syn-body` max-height (2329, PF-only).

**Block list (line ranges → purpose):**
- 465-483 `#codedrawer` — height `var(--dock-h,176px)` (474), fixed bottom band, z-40; comment 475-480 (end-cheek inset; "The piano dock solves the same problem with left/right 26px").
- 524-539 `#errbar` — fixed above the dock tax (526).
- 542-556 `#toast` — bottom = dock tax + 14 (543).
- 948-956 layout reconciliation — piano "eats no flow space"; dock tax (see math above).
- 958-967 drawer/piano split — drawer LEFT at `var(--drawer-w, min(560px,45%))`; `#codedrawer.open ~ #piano-dock { left: var(--drawer-w…); height: var(--dock-h,176px); }` (960-962); piano-closed drawer spans the floor + padding-right 26 (963-967). PF-only (no drawer in Anvil v1).
- 974-985 `#piano-dock` — "61-key MIDI keyboard, docked at the bottom (Y toggles)": fixed, `left:26px; right:26px; bottom:0; z-index:41; height:var(--dock-h,136px);` flex column, walnut gradient, top-only radius, `user-select:none; touch-action:none; container-type:inline-size`.
- 986 `body.piano-closed #piano-dock { display:none }`.
- 987-993 piano-pop rules — comment 987-989 ("the band keeps only its rail … --dock-tax fall to the rail's 36px by itself"); `#pk-return` shown / `#pk-pop` hidden (990-992); hint accent (993).
- 994-1004 rail one-row hardening — `#piano-rail .btn { white-space:nowrap; flex:0 0 auto }` (998); hint ellipsis (1000); `body.piano-pop .pk-rail-note { display:none }` (1004; comment 1001-1003).
- 1005 `body.kb-armed #piano-dock` — amber glow.
- 1006-1011 `#piano-rail` — flex row, padding 6px 10px, steel gradient, 2px bottom border.
- 1012-1020 `.pk-switch` + `.pk-sw-led` — LED dot + `.on` glow. (`.pk-switch` has NO markup in src/body.html — dormant; `.pk-sw-led` is used at body.html:340.)
- 1021-1032 `.pk-modes` + `.pk-mode` — segmented INPUT switcher; `.on` = amber.
- 1033-1039 `.pk-mode-hint` — ellipsis; `body.kb-armed` amber (1037); `body.kb-midi` blue (1038) + `body.kb-midi #piano-dock` blue glow (1039).
- 1040 `.pk-win` readout (mono, accent, min-width 64px); 1041 `.pk-rail-ctl`; 1042 `.pk-rail-note`.
- 1043 `#piano-keys` — relative flex, `min-height:52px`, `padding:0 2px 2px`.
- 1044-1056 `.pk-key` base + `.pk-white` (flex:1, z-1) + states: `.in-scale` (1053), `.root` (1054), `.in-win` (1055), `:active, .down` (1056).
- 1057-1068 `.pk-black` — absolute, top 0, height 62%, default width 8.571% (inline style overrides), z-2; states `.in-scale` (1066, amber underline), `.in-win` (1067), `:active, .down` (1068).
- 1069-1072 `.pk-note` (note name at key bottom, `pointer-events:none`); 1073-1080 `.pk-keycap` (letter chip); 1081 `.pk-black .pk-keycap`; 1082 `body.kb-armed .pk-keycap` lights amber; 1083 `.pk-black .pk-note` colour.
- 1084-1088 `@media (max-width:700px)` — dock full-bleed `left/right:0`; drawer split `min(560px,45%)`; rail-note hidden.
- 1089-1095 `@container` — ≤1050px hide `.pk-note`; ≤640px shrink keycap, hide rail-note, `.pk-win` min-width 44.
- 1840-1842 `body.dock-rail` — folded band: `#piano-keys { display:none }`, rail padding 4px 10px.
- 1853-1855 dancer-dock z comment ("above the piano dock (41)", PF-only).
- 2164-2180 SYNTH-mode desk switcher — `.pk-modeswitch/.pk-modesw` + `.on`.
- 2205-2209 `.pk-mix` — shown ONLY on the STRUDEL desk (`body:not(.mode-synth) .pk-mix { display:flex }`); hidden in SYNTH (the sound desk carries the same chips).
- 2211-2219 voice picker — `.pk-voice-slot` shown only `body.mode-synth`; `#pk-voice` select; `body.mode-synth .pk-rail-note { display:none }` (2219).
- 2221-2244 `body.mode-synth` re-tone — variable swap 2222-2237 (bg/panel/ink/accent → instrument blue); dock accents 2238-2244 (chips, hint, dock glow, keycap colour, root inset, PLAY glow).
- 2246-2264 `#synth-panel` placement + `body.mode-synth #layout` rows — PF-only (no such panel in Anvil v1).
- 2326-2330 `.syn-body` max-height obeys `--dock-tax` ("obeys the keyboard's dock tax automatically") — PF-only.
- 2421 hubstrip comment references the piano corridor — PF-only.

**CSS caveat:** `.pk-key.down` rules exist (1056, 1068) but a search of `src/*.js` finds NO code that adds a `down` class to pk-keys — the pressed look in practice is `:active` (pointer). Keep or drop the rules; nothing depends on them.

## 7. Port verdict for Anvil (`av_kb.js`)

### 7.1 PF-module dependency map (what each part calls → Anvil action)
| PF symbol (definition) | Used at (app_kb.js) | Anvil action |
|---|---|---|
| `window.pf` object (app_ui.js:3) `pf.play/hush/regen/stab/sel/mut/…` | kbDo cases L987-1041 | DROP (no workstation); keep only piano/desk cases |
| `state/selTrack/playing/codeDirty/mirror/engineReady` (app_core.js:8-16), `toast` (57), `showError` (65), `setStatus` (74), `saveState` (38), `pushDoc` (174), `randomizeTrack` (486), render* (app_ui.js:1068/1173/1394) | kbDo cases, digits L1154, kbSelectedScale L302, kbPlayHeld L422 | ADAPT — Anvil equivalents or drop |
| `pfEvalCode` (app_core.js:236), `buildDoc` (app_codegen.js:354) | kbPlayHeld L426, kbNoteCode L441 | ADAPT to avNote bus, or DROP fallback |
| `pfSXNameToMidi/pfSXNoteOn/pfSXNoteOff/pfSXAllNotesOff` (app_synthx.js:730/1869/1979/2025) | L461-464, L471-474, L485 | ADAPT → avNote bus (parent writes it) |
| `koalaSay` (app_ai.js:322), `kodyShout`/`kbTeach`/`kbTaught` (L963/972-979) | L465, L521-522, L535, L554-556, L590, L978 | DROP |
| `hubSay/hubOpen/hubClose/hubToggle/hubRecordToggle/hubRenderStems/hubSaveEverything` (app_hub.js:82/423/451/459/923/967/1137) | kbDo L1026-1030, L524 | DROP |
| `pfVoiceToggle/pfVoiceMicKey` (app_voice.js:168/301) | L1031-1033 | DROP |
| `dancerKeyAction` (app_dancer.js:3363) | L1032 | DROP |
| `pfTabBack/pfTabFwd` (app_ui.js:676-677) | L1034-1035, L1090 | DROP |
| `pfHelpClose` (app_help.js:534), `pfA11yDialog/pfModalSyncInert/pfFocusSave/pfFocusRestore` (app_hub.js:331/363/375/381) | kbOpenHelp L1194-1211 | DROP with the overlay (SKIP) |
| `pfBlendDeskDefault/pfSynPanelOpenOnce/pfBlendHotkey` (app_synthpanel.js:91/333/2589) | L513-514, L1132-1136 | ADAPT if a desk switcher is kept |
| `pfChromeSync` (app_ui.js:974), `pfPopTraySync` (app_synthpanel.js:2718) | L905-906, L948-949 | DROP |
| `pfDockSet/Get/Live/pfPref/PF_LIMITS` (app_ui.js:696/715/723/680/686) | L575-583, L708-720, L892-943 | ADAPT — Anvil band sizing (or hardcode; the rail/restore logic is the only consumer) |
| `synFit/pfSynFitRoom` (app_synthpanel.js:105/371) | L571, L580, L896 | DROP (simplify un-rail check) |
| test hooks `window.__lastNotePreview/__lastNoteCode/__lastFwd` | passim | **KEEP verbatim** — suites + debugging rely on them |
| `KOALA_KB` FAQ + `aiOfflineRoute` (L123-183, L1230-1253) | app_ai offline path | SKIP |

### 7.2 Per-section verdicts
| Subsection | Verdict | Notes |
|---|---|---|
| §1 constants/maps | **PORT** (PIANO_*), **ADAPT** (SYNTH_BANDS/SYNTH_VOICES) | Keep names or av-prefix; drop `kbSelectedScale`'s track reading → av scale source; keep `kbNoteName`, `kbScaleNotes`, `KB_PC` as-is (pure). |
| §2 kbHandle | **ADAPT** | Keep the single-dispatcher law, guard order, typing guard, Esc chain (minus hub/help/drawer branches; keep disarm + field-blur), MIDI swallow, armed branch + swallow regex, KB_DEFS lookup + refresh. Drop PF-only combos (table §2). Drop digits→tracks. Keep Ctrl+Alt+1/2/3. Decide Space=play per Anvil transport. |
| §3 dock DOM | **PORT / ADAPT** | Port the markup minus `#pk-mix` (PF mix), minus popout buttons for v1; keep `#pk-modes` + hint + octave ctl + `#piano-keys`. Port `kbBuildPiano`/`kbRefreshPiano`/`kbBindKeysBox` essentially verbatim (swap scale source; drop kodyShout). Port `kbInit` wiring + `kbTogglePiano`/`kbSetPianoOpen` (minus PF dock math or with an Anvil dock-sizing equivalent; the `dock-rail` interplay is droppable). |
| §4 note path | **ADAPT** | Keep kbNoteDown/Up/StopAll semantics, the held structures, gain clamp, `__lastNotePreview`/`__lastNoteCode`, and every quote-marked law; re-point engine resolution to the avNote bus; drop koalaSay. |
| §5 tests | **PORT (contract)** | Copy test_keys phases 0/A3/MODE structure with av- names; keep the RESET semantics and the asserted globals (`__lastNotePreview`, kbHeldNotes, kbArmed, kbInputMode, body classes, chips, `#pk-arm-led`, `pf-input-mode` LS or its av rename). |
| §6 CSS | **PORT (blocks 974-1095, 1840-1842) / ADAPT tokens** | Drop drawer/synth-panel/dancer/hub couplings; keep the `--dock-h`/`--dock-tax` pattern if a band seat is ported, or simplify to a fixed dock with a `piano-closed` display toggle. `.pk-key.down` rules optional. |
| §3.7 popout (Stage 18) | **SKIP for v1** | ~360-line subsystem, self-contained; note path and dock do not depend on it (`kbEnsureKeysBox`/`kbBindKeysBox` stand alone). If ported later: keep the adoption trick, the `__pfFwd` bind-once law, and the `''`-not-about:blank law. |
| Keymap overlay / Kody teaches / FAQ | **SKIP** | L961-979, L1172-1253 — PF personality layer; a minimal `?` list can be rebuilt later on KB_DEFS if wanted. |

### 7.3 House conventions to follow (from anvil/src/av_tap.js, av_knob.js headers)
- av- prefix for every global; `"use strict";` at top; header comment stating the source and "LAWS preserved:" list (T9 §N references); localStorage keys `av-…`; guard external hooks with `typeof fn === 'function'`; no top-level DOM access (parse-safe for a node harness); keep the tested global names (or update the suite in lockstep).
- Suggested rename map (house style; keep whatever the parent prefers): `kbHandle`→`avKbHandle` · `kbBuildPiano`→`avPianoBuild` · `kbRefreshPiano`→`avPianoRefresh` · `kbBindKeysBox`→`avPianoBind` · `kbPianoNoteFor`→`avPianoNoteFor` · `kbNoteDown/Up/StopAll`→`avNoteDown/Up/StopAll` (wrapping the avNote bus) · `KB_DEFS`→`AV_KB_DEFS` · body classes `kb-armed`/`kb-midi` → keep (CSS + suites reference them) or rename in both.

## Undetermined (never guessed)
1. **Anvil's avNote bus API** — parent-written and not yet in the repo; this digest pins only the PF semantics to replicate (name-in/name-out, gain clamp 0.05-1, "native-taken" tracking, stop-all, `__lastNotePreview`/`__lastNoteCode` hooks).
2. **Whether Anvil keeps** the STRUDEL/SYNTH desk split, the MIDI input mode, the popout, and the 0..3 octave-window count — product decisions; all mechanics are documented above for either choice.
3. **`.pk-key.down`** — CSS rules exist (styles.css:1056, 1068) but no code in `src/*.js` adds the class (searched); whether an older build or an external writer used it is undetermined. Pressed visual in practice = `:active`.
4. **kbPianoWin persistence** — verified absent from `app_kb.js` (no localStorage write); presumed session-only; no suite asserts otherwise.
5. **Touch specifics** — no `pointercancel` handler and no explicit touch code; behaviour rides Pointer Events + `touch-action:none` (styles.css:983). Whether `pointercancel` gaps matter in practice was not tested by any suite found.
6. **The 40px rail writes** in kbPopSeatBand/kbPianoPopClose (L717, L941) rely on `pfDockSet`'s rail threshold (`<= 64` → 36px on screen); treated as deliberate, not commented.
7. **Sibling-suite refs** (cdp_pop/cdp_synth/cdp_synthx/cdp_hardening/cdp_a11y_dialogs/cdp_sound) come from targeted searches of those files, not full reads — every quoted line is exact, but those suites contain further piano assertions not enumerated here.
