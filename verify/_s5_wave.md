# Anvil S5 — CODE · keys popout · help: wave contract (2026-10-08)

Trigger: golden build, full permission granted (docs/05 §2.7 + docs/07 #20/#45/#80/#81 + docs/08 §4).
Deliverable: **PF-grade popout keyboard** (A) · **the CODE section engine — open module API #81**
(documented sandboxed DSP module contract, versioned loader, live in the worklet + SPN parity,
persistence/export, examples — B runtime + C UI) · **walkthrough/help** (D overlay+tooltips+tour,
E command palette #80, F tutorial ladder #20 + sound wizards #45).

Predecessor: S4 CLOSED `c92a4445` (2,269,601 B; commit d6d91ac = the save). Open on the GOLDEN
BUILD program; resume phrase "continue anvil".

## 0. Evidence first (probe-verified 2026-10-08 — cache/scratch/s5/probe/)

- **AudioWorkletGlobalScope capability probe** (headless Chromium, this machine): `new Function`
  WORKS (sum test = 5). `fetch`, `performance`, `URL`, `TextEncoder`, `structuredClone` are ALL
  undefined there. Consequence: user module source is eval'd IN the worklet via
  `new Function('API', ...)` with everything it may see INJECTED (no network/DOM in worklet scope —
  the sandbox is real there); the runtime never uses fetch; timing stays Date.now (existing law).
- The worklet message protocol (av_voiceproc.js), the FX chain loop (av_dsp.js render L1116-1134 —
  iterates `eng.fx` LIVE, `{mod, st, wet}` entries, `st.on === 0` skipped, wet=1 → parent blends by
  `st.mix`), the kind dispatch (`KIND_MODS[v.kindId]` at voiceFrame L1009 / reinitVoice L668 /
  releaseVoice L680; setParam prefix loop L556) — all re-read this session; the pins below match.
- rig launch skeleton + `--disable-popup-blocking` + `--allow-file-access-from-files` popup technique
  from PF verify/cdp_pop.mjs (CDP target enumeration for the popout window; `{pip:false}` forces the
  named-popup path; stubbing `documentPictureInPicture` to undefined forces the fallback).

READ BEFORE ANY EDIT (children): this contract's §2 (your letter), the files you own in §1, and the
source files your section names. PF repo (`C:\Users\Moddy\pattern-forge`) is READ-ONLY reference.

## 1. File scope & ownership (one writer per file)

| file | owner | notes |
|---|---|---|
| `src/av_kb_pop.js` | sa-A | NEW page module — popout keyboard (port of PF app_kb.js L593-952, adapted to Anvil) |
| `src/av_umod_wl.js` | sa-B | NEW **worklet-safe** module runtime (top-level name `AVUMOD`; included in BOTH concats) |
| `src/av_code.js` | sa-B | NEW page module — CODE engine facade/mirror/persistence + `avCodeOnMessage` |
| `docs/09-code-module-api.md` | sa-B | NEW — the documented module contract (public docs quality) |
| `src/av_code_ui.js` | sa-C | NEW page module — the CODE card UI (editor · library · params · examples · docs) |
| `src/av_help.js` | sa-D | NEW page module — help overlay · tooltips · 60-s tour · recipes · `avUiKeyHook` |
| `src/av_palette.js` | sa-E | NEW page module — command palette (#80) + command registry |
| `src/av_lessons.js` | sa-F | NEW page module — tutorial ladder (#20) + demo groove + sound wizards (#45) |
| `verify/cdp_s5.mjs` | sa-G1 | NEW rig (WRITTEN, not run by the child) — popout · help · palette · lessons |
| `verify/cdp_code.mjs` | sa-G2 | NEW rig (WRITTEN, not run by the child) — module runtime live-proof |
| `src/body.html`, `src/styles.css`, `src/head.html`, `build.py`, `src/app_core.js`, `src/av_kb.js`, `src/av_dsp.js`, `src/av_voiceproc.js`, `src/av_engine.js`, `src/av_synth.js`, `index.html`, `verify/*` (others), git | PARENT | children never touch |

Worklet-safe = strict mode, NO DOM/window/document/location/fetch, ONE top-level name, no allocation
in per-sample paths, no throw paths. Children may run THEIR OWN node harnesses; children NEVER run
browsers, build.py, or git. Write the file to disk FIRST, then iterate (partial progress must exist
on disk at all times). Scratch: `cache/scratch/s5/<letter>/` only. No console windows.

## 2. Pins per child

### 2.A `av_kb_pop.js` — popout keyboard (sa-A)

Port source: PF `app_kb.js` L593-952 read in full (popout summary: research/reuse/kb-port-digest.md
§3.7) + Anvil `av_kb.js` (concat order: av_kb_pop loads right after av_kb — it may read module-scope
state `avArmed`/`avInputMode`/`avPianoWin` and call `avPianoOctStep`/`avSetInputMode`/`avNoteStopAll`
directly; same concatenated scope).

- Export: `avKbPopInit()` (binds `#pk-pop` + `#pk-return`; idempotent) · `avKbPopOpen(opts)` →
  Promise of `{via:'dpip'|'window'|null, error?}` (`opts.pip=false` forces the named popup —
  the rig's deterministic path) · `avKbPopHome()` → brings the bed home + closes the window;
  idempotent, safe when the window died (PF L917-952 law: gating on the handle alone left a dead ⧉ BACK) ·
  `avKbPopIsOut()` · `avKbPopMirror()` (called by avPianoRefresh via the E-kb5 hook — copies win
  label / ARM state / hint / body classes into the popout doc) · `avKbPopHint()` (popout hint copy)
  · `window.__avKbPop` debug handle + delivery witness `window.__lastFwd` (count forwarded keys).
- LAWS to preserve (PF §3.7): PiP first (`documentPictureInPicture.requestWindow({width,height})`)
  with the impostor check (accept only a live, current PiP window); `window.open('', 'av-keys', …)` —
  NEVER about:blank, and NEVER open a URL in an existing named window (navigates it; silent no-op);
  foreign-tab ownership token; the live bed `#piano-keys` is APPENDED into the popout (document
  adoption — pointer handlers ride with the node); styles imported by CONTENT (find the `<style>`
  containing `.pk-white`, stamp so copies can't stack); forwarder re-dispatches `new KeyboardEvent(...)`
  into the APP document (the ONE keydown listener picks it up); if the app claimed the event,
  preventDefault in the popout too (Ctrl+R must not reload the popout out from under the keys);
  re-mount replaces forwarders (never stacks); while out: `body.piano-pop` + app hint shows the
  popout copy; `avKbPopHome()` on window death (poll `handle.closed` ~500 ms) and via `pagehide`;
  blocked popup → refuse honestly (no `piano-pop` half state, error string returned).
- The popout bar: ⧉ BACK (`avKbPopHome`), ARM (`avSetInputMode(avArmed?'studio':'keys')`), −/OCT/+,
  hint. Bed return: `#piano-dock.appendChild(bed)` (rail stays first).
- Return: the full CSS class list needed (parent writes styles) — pinned classes to USE: reuse the
  existing `.pk-*` styles; NEW needed ids/classes `#pk-pop`(the rail button — parent adds markup),
  `#pk-return` (parent adds markup), body `piano-pop` (existing rules), popout-doc chrome classes
  `av-pop-bar`/`av-pop-btn`/`av-pop-hint` (return them).
- No `av_kb.js` edits by the child — the parent applies the pinned hooks (§4).

### 2.B `av_umod_wl.js` + `av_code.js` + `docs/09` — the CODE engine (sa-B)

**AVUMOD runtime (worklet-safe; runs in the worklet AND page-side for SPN parity).** `AVUMOD = { version,
apiVersion: 1, ids(), kindById(id), kindIdByName(name), setKindParam(eng, path, value), handle(eng, m, port),
reset(eng) }`:

- `handle(eng, m, port)` — NEVER throws out; replies `{t:'umodok', id, kind, kindId?, params}` /
  `{t:'umoderr', id, error}` / `{t:'umodstat', id, data}`. Acts: `add` (m.src ≤ 65536 chars; id must
  match `/^[a-z][a-z0-9_-]{0,31}$/`; eval `new Function('API', '"use strict";\n' + src)` called with the
  frozen API — returns MOD), `remove`, `list`.
- API object surface (versioned; docs/09 documents all of it): `{ api: 1, VERSION variant, clamp(v,lo,hi),
  lerp(a,b,t), sine(phase) [∈[-1,1]], TAU, blep (AVDSP.blep when available — the minBLEP residual
  surface for advanced oscillators) }`. NO AVDSP handle, NO eng constructor surface beyond what
  stepVoice receives.
- MOD shape: `{ api: 1, id, name, kind: 'fx'|'kind', params: [{name, min, max, def, step?, label?}] (≤ 16) }`.
  FX kind: `createState(cfg)` (cfg = `{sampleRate}`) → st; optional `bindEngine(st, eng)`;
  `setParam(st, path, v)`; `process(st, inL, inR)` writing **st.oL/st.oR (WET convention — parent
  blends by st.mix; drive/verb/dyn law)**. Source kind: the P2 kind contract verbatim (`PREFIX`,
  `initEngineK`, `initVoiceK`, `initVoice`, `stepVoice(eng, v)`, `releaseVoice`, `isVoiceDone`,
  `setParam(eng, path, value)`) — verify/_p2_wave.md §2 is the normative text.
- On `add` fx: enforce `MOD.PREFIX = id`; `createState({sampleRate: eng.sr})`; `bindEngine` guarded;
  push `{mod, st, wet: 1}` onto `eng.fx`; apply param defaults via `MOD.setParam(st, 'fx.'+id+'.'+name,
  def)`; st.on default 1 when the module declares an `on` param (≤ 0.5 = off), else set `st.on = 1`
  explicitly; `st.mix` default from a `mix` param else 1. Reply with kindId null + params.
- On `add` kind: assign the first free user kindId from 64; `MOD.PREFIX = id`; call `initEngineK(eng.kext)`
  if present, then `initVoiceK(v.k)`, then apply param defaults (`MOD.setParam(eng, id+'.'+name, def)`);
  register for `kindById`. Reply with kindId.
- Guards (register ONCE at add time — message time, not per-sample): wrap `process` and `stepVoice`
  in try/catch + poison counters (throw → counter++, after 4 → disable: fx `st.on = 0`, kind marked
  dead so `kindById` returns null); non-finite st.oL/oR/stepVoice return → 0. `setParam` wrapper →
  false on throw. The wrappers must keep the render path allocation-free (plain ops only).
- `setKindParam(eng, path, value)`: match the prefix (path before first `.`) against loaded user kind
  ids → `MOD.setParam(eng, path, value)`. `kindById(id)`: dead modules → null. `reset(eng)`: remove
  every user entry for that eng (rig cleanup).
- The file must ALSO parse+run page-side with AVDSP absent (node harness) — every AVDSP touch guarded.

**av_code.js (page facade + mirror + persistence).** Persistence: IndexedDB `av-code-store`
(object store `modules`, keyPath `id`; LS fallback like av_store's pattern). Record:
`{id, name, kind, src, params:{name:value}, enabled, savedAt}`. Restore on boot AFTER engine ready:
`avEngineEnsure().then(h => avCodeRestore(h))` — enabled modules re-added via the SAME `umod` message
path (worklet: `h.node.port.postMessage`; SPN: `AVUMOD.handle(h.engine, m, {postMessage: avCodeOnMessage})`).

- Exports (pinned — the UI and both rigs compile against these): `avCodeInit()` ·
  `avCodeList()` → `[{id, name, kind, api, params, enabled, ready, kindId?, fxIndex?, poisoned}]` ·
  `avCodeAdd({id, name, kind, src, enabled})` → Promise<status{ok,id,kind,kindId?,params?,error?}> ·
  `avCodeRemove(id)` · `avCodeEnable(id, on)` · `avCodeSetParam(id, name, v)` → bool (routes through
  `avApplyParam` with the canonical path: fx → `fx.<id>.<name>`, kind → `<id>.<name>`; ALSO write
  `avParams`) · `avCodeGetParam(id, name)` · `avCodeExamples()` → `[{key, name, kind, src}]` (at least
  `tremolo` fx, `bitcrush` fx, `fold` kind — own-authored, MIT, correct per contract) ·
  `avCodeExample(key)` → src text · `avCodeExportText(id)` → `.avmod` JSON string
  (`{format:'anvil-module', api:1, id, name, kind, src, params}`) · `avCodeImportText(text)` →
  Promise<status> (refuse foreign formats honestly) · `avCodeKinds()` → `[{name, label, kindId}]`
  (loaded user kinds, for the synth-card select) · `avCodeStatus()` → `{engine, count, poisoned:[]}` ·
  `avCodeOnMessage(d)` (routes `umodok|umoderr|umodstat` replies; page-defined) ·
  `window.__avCode` = `{version, list, status}`.
- Versioned loader: refuse `api > 1` with a clear error; accept `api === 1`; missing api → refuse
  (docs/09 states the version policy). Also refuse an add while the engine handle is null (honest
  error, no silent queue).
- `.avmod` export uses `avDeliverDownload` when present (guard), else a plain anchor.

**docs/09-code-module-api.md** — public-quality documentation: the MOD shape, the API object, the
param schema, fx vs kind examples (both), the wet/mix convention, `st.on`, limits (id charset, 64 KB
src, ≤16 params, no DOM/network in the audio scope — and the honest note that on the degraded SPN
tier modules run on the page), versioning policy (`api: 1`), error/poison semantics, and the three
shipped examples with line-by-line commentary. No stray non-Latin characters.

### 2.C `av_code_ui.js` — the CODE card (sa-C)

Host `#av-code-host` (parent adds the card `#av-code` + host + h2 "CODE — write your own modules").
Sections (pinned ids): library `#av-code-list` (rows: name · kind badge · status LED · enable toggle ·
edit · export · delete) · editor `#av-code-src` (textarea, mono) + `#av-code-id` + `#av-code-name` +
`#av-code-kind` (select fx|kind) · buttons `#av-code-check` (validate: id charset, api gate, param
schema — NO eval), `#av-code-run` (add/save), `#av-code-stop` (remove), `#av-code-export`,
`#av-code-import` (file input) · examples `#av-code-examples` (one button per `avCodeExamples()`) ·
params panel `#av-code-params` (knob rows for the selected module via `avKnobRowHTML`/`avKnobBind`
with paths `fx.<id>.<name>` / `<id>.<name>` — the standard avApplyParam funnel) · docs
`#av-code-docs` (renders a compact contract summary in-page + the examples) · status line
`#av-code-status`.
- Behaviour: list paints from `avCodeList()`; RUN = `avCodeAdd` with the editor content (id/name/kind
  inputs); STOP/delete confirm via the house pattern used by other cards (read av_files_ui.js for the
  house idioms — buttons, aria, status text, busy flags); import reads the file → `avCodeImportText`;
  export → `avCodeExportText` → download (guarded avDeliverDownload, else anchor); a refused add
  prints the engine's error verbatim; zero page errors when the engine is missing (degrade honestly:
  status line says "engine unavailable").
- Return: the CSS class list needed (`av-code-*` — parent styles). `window.__avCodeUi = {version}`.

### 2.D `av_help.js` — help overlay · tooltips · tour · recipes (sa-D)

- `avHelpInit()` (binds `#av-help` button; idempotent) · `avHelpOpen()`/`avHelpClose()`/`avHelpIsOpen()`
  · `avUiKeyHook(e)` → true when CONSUMED: handles (a) palette first — `if (typeof avPaletteKey ===
  'function' && avPaletteKey(e) === true) return true;` (b) `?` (e.key === '?', not typing-in-field)
  toggles the overlay (closes palette first via guarded `avPaletteClose`); (c) Esc while overlay or
  palette open → close them (consume). Returns false otherwise (av_kb's own chains keep working).
  The parent inserts ONE hook line into avKbHandle (§4) — av_help never adds a document keydown.
- Overlay: `#av-help-overlay` with tabs SHORTCUTS (built from AV_KB_DEFS + `avPaletteCommands()` rows
  carrying a `keys` hint + static Ctrl-K/?/Esc extras) · TOUR (start the 60-second tour) · GUIDES
  (recipes, outcome-named: "Get your first beat" · "Make an acid line" · "Chop a sample" · "Export
  stems to your DAW" — each runs `avLessonRun(id)` when available, else scrolls+spotlights the target
  card) · TIPS (contextual tip list). Help NEVER covers the instrument: overlay is a side panel
  (max ~420 px), tips are bubbles; and it never blocks the keyboard (keys still dispatch through
  avKbHandle while open).
- Tooltips: `data-av-tip="text"` attribute support + a curated DO-NOT-EDIT registry in this file
  (selector → text for ~20 key controls: header buttons, piano rail, seq transport, deliver run,
  store search, deck, mix master row…); one delegated pointerover/focusin handler on document;
  bubble `#av-tip` (`pointer-events:none`). Export `avHelpTip(el, text)`.
- Tour engine: `avHelpTour(steps)` → handle `{next, prev, skip, done}` + `window.__avHelp.tour`
  (`{active, step, total}`). Steps: `[{sel: string|null, title, text, action?: string}]` — `sel`
  resolved at step time (`document.querySelector`), scrolled into view; the cutout = four shading
  divs + a ring around the target rect (recompute on resize); `action` executed on entering the step:
  `if (typeof avLessonAction === 'function') avLessonAction(action)` (the cross-child seam — F owns
  the action map). The built-in 60-second tour = ~12 steps over the main cards, AUTO-ADVANCE OFF
  (explicit next), closable at every step, restores scroll state? (No — leave the user where they
  end; it's a tour).
- `window.__avHelp` = `{version, open, tour}`. Return CSS class list.

### 2.E `av_palette.js` — command palette #80 (sa-E)

- `avPaletteInit()` · `avPaletteKey(e)` → true when consumed (mod+K toggles — works from inside text
  fields; Esc closes; ArrowUp/Down move; Enter runs) · `avPaletteOpen()/Close()` · `avPaletteRegister(cmd)`
  (`{id, label, hint?, group?, keys?, run, when?}`) · `avPaletteCommands()` → sanitized copies ·
  `avPaletteRun(id)` · `window.__avPalette` = `{version, open}`.
- Overlay `#av-palette` (created by this module): input `#av-palette-input` (placeholder "Type a
  command…"), list `#av-palette-list` (rows `.av-palette-row`, fuzzy filter — subsequence scoring,
  match highlight), group labels, footer hint "↵ run · esc close". Opening it closes the help
  overlay (guarded `avHelpClose`); mutual exclusion both ways (avUiKeyHook order in §2.D).
- Core commands registered at init (~18, all guarded typeof calls so the module works alone):
  toggle piano · input modes studio/keys/midi (Ctrl+Alt+1/2/3) · play/stop transport · BPM presets?
  (no — bpm is a knob; skip) · open/close each card (scrollIntoView of #av-* ) · load the demo groove
  · run lessons {first beat, acid line, sample chop, stems export} · sound wizards {bass, pad, pluck,
  lead} · open store · export stems (scrolls to deliver + highlights) · start the 60-second tour ·
  open help · toggle metronome · count-in on/off · save project (.anvl) · export patch card · record
  toggle. Each `run` is a one-line guarded call.
- Return CSS class list. NEVER adds its own document keydown (avUiKeyHook route only).

### 2.F `av_lessons.js` — tutorial ladder #20 + wizards #45 (sa-F)

- `avLessonsInit()` · `avLessonsList()` → `[{id, title, blurb, steps}]` (ids: `demo`, `first-beat`,
  `acid-line`, `sample-chop`, `stems-export`) · `avLessonRun(id)` → starts the lesson (via
  `avHelpTour(steps)` when available; else a graceful no-op with a status note) · `avLessonAction(key)`
  → `{ok, note}` (the action executor the tour calls; keys like `seq.loadDemo`, `seq.play`,
  `card.open:<id>`, `deliver.highlight`, `store.open`, `sample.tip`, `wiz.open:<kind>`) ·
  `avWizRun(kind)` (bass|pad|pluck|lead) · `window.__avLessons` = `{version, list, run, action, wiz}`.
- Demo groove: `AV_LESSONS_DEMO` — a full 4-track pattern in the av_seq_core norm shape (read
  av_seq_core.js: avSeqPatternNorm/avSeqTrackNorm/avSeqStepNorm; playable through avSeqLoad; drums +
  acid + a string/pad layer + bass; 16 steps, tasteful, no dead bars). Load path: `avSeqLoad(pattern)`
  then `avUndoPush` AFTER the load with the SAME label/domain the seq UI uses (read av_seq_ui.js — P4
  law: push-after-change). Play = guarded `avSeqPlay()`.
- First-run strip: `#av-firstrun` (created before #av-levels when localStorage `av-first-run` is
  unset): one big button "▶ FIRST SOUND — load the demo groove and play" (loads pattern + play +
  sets the flag + collapses), a dismiss ✕ (sets the flag). This is the <30 s first-sound acceptance.
- Lessons (each 4-7 tour steps with real actions, honest — never fabricate user data: the sample-chop
  lesson instructs importing a WAV and pauses on the sample card; stems-export ends highlighting the
  deliver RUN): first beat (demo drums solo → mute others → add a step) · acid line (kind→acid, load
  acid pattern? use demo's acid track solo + knob pointers) · sample chop (sample card + import tip +
  grain/sampler kind pointer) · stems export (demo → deliver card → RUN highlight → what the zip holds).
- Wizards: `avWizRun(kind)` opens `#av-wiz` (module-owned panel): 3 quick choices per kind (e.g.
  bass → flavour {deep · acid · reese}, filter {dark · bright}, movement {none · slow · sync}); each
  choice applies a curated deterministic param set via `avApplyParam` (+ `engine.kind` where apt,
  + `avSynthSetKind` guarded); AUDITION plays a short phrase (4 notes via avNoteDown/avNoteUp with
  timeouts) so the user HEARS it; KEEP closes (params stay; `avUndoPush('params','params'? — read
  av_undo.js for the exact signature and mirror an existing caller)`); REROLL picks the next curated
  variant. Wizards scroll the synth card into view on apply.
- Return CSS class list. Node harness (optional but valued): load av_seq_core.js text + av_lessons.js
  text in one scope, `avSeqPatternNorm(AV_LESSONS_DEMO)` deep-equals the demo (no unknown fields, all
  steps valid).

### 2.G1 `verify/cdp_s5.mjs` — rig G1 (write-only)

Copy the launch skeleton VERBATIM from cdp_s4.mjs (candidates/free-port/temp profile+scoped cleanup/
1440x900/autoplay flag) PLUS `--disable-popup-blocking` + `--allow-file-access-from-files` (PF
cdp_pop.mjs). EXPECT_SHA = null until the parent pins. Checks (numbered sections, ~30):
1. boot + engine + new globals (`avHelpOpen`, `avPaletteCommands`, `avLessonsList`, `avKbPopOpen`,
   `window.__avHelp/__avPalette/__avLessons/__avKbPop`) + `#pk-pop` present + `#av-help` button wired.
2. popout via `avKbPopOpen({pip:false})` → CDP target enumeration (find the popup target; evaluate
   IN it): bed `#piano-keys` present with 61 keys; app side: `body.piano-pop`, app `#piano-keys`
   empty; key forward: dispatch keydown 'a' in the POPOUT (its own realm) → opener `__lastNotePreview`
   === 'c4' and `__lastFwd` advanced; keyup → held 0; popout bar buttons exist (⧉ BACK/ARM/OCT).
3. `avKbPopHome()` → bed back in #piano-dock, class cleared, pointerdown on a key sounds again
   (clickable re-bind), 61 keys present app-side.
4. blocked-popup honesty: stub `window.open → null`, force pip:false → `via === null` + no
   `piano-pop` half state + error string; restore.
5. DPIP path if available (honest report + `via==='dpip'` hold/return basic; skip honestly if absent
   — never fail on platform absence, note it).
6. help: button opens overlay; `?` keydown toggles; Esc closes; SHORTCUTS tab lists Ctrl+Alt+1/2/3
   and Ctrl+K; keyboard not blocked while open (`y` still toggles the piano); overlay small (rect
   width ≤ 480) — "help never covers the instrument".
7. tour: `avHelpTour(3 steps incl. one with action 'seq.demo')` → active, step 1, ring present; next;
   action fired (stop when the app reports unknown — F absent-tolerant: the seam is optional);
   skip → inactive.
8. tips: pointerover a registered selector → `#av-tip` visible with text; pointerout hides.
9. palette: Ctrl+K opens (also from a focused textarea); type 'pian' → first row is Toggle piano;
   Enter runs (piano-closed flips); reopen; Esc closes.
10. lessons: fresh profile → `#av-firstrun` visible; click the first-sound button → pattern loaded
    (avSeqSnap notes > 0) + transport playing; flag set; strip gone. `avLessonsList()` ids complete;
    `avLessonRun('first-beat')` starts a tour.
11. wizards: `avWizRun('bass')` → panel open; pick choices; AUDITION fires notes (witness via
    `__lastNotePreview`); KEEP closes; params changed from pre-wizard snapshot.
12. cleanup + zero page errors + screenshot renders/s5-suite.png + sha before===after.
RIG-OWN MATH: read app state live (never plant literals where the app computes); tolerant null-honest
reads for deferred UI (DECK-4b lessons); SPEC fixes at first parent run go to the check's stated
intent, never loosened.

### 2.G2 `verify/cdp_code.mjs` — rig G2 (write-only)

Same launch skeleton (s5 flags not needed here — plain cdp_s4 copy). EXPECT_SHA null until pinned.
Checks (~28): **the real live proof that user code runs in the engine**:
1. boot + `#av-code` card + `avCode*` API surface + `window.__avCode`.
2. add the rig's OWN fx module (source string: `st.oL = inL*0.5` style half-gain, param `amt`
   scaling) via `avCodeAdd` → status ok, kind fx, `avCodeList` ready, engine running (worklet:data
   on file://) — then AUDIO WITNESS (rig owns an AnalyserNode on the master tap, witness law): play
   note 60 via `__avEngine.noteOn`, capture RMS with module mix=1 amt=1 (expect ≈ half of the
   bypass RMS measured before add); param commit `avCodeSetParam(id,'amt',0.25)` → RMS drops further;
   avParams mirrors `fx.<id>.amt`.
3. poison: add a THROWING module (process throws) while a note plays → engine keeps rendering (a
   following note still sounds, stats active), module reported poisoned/off in avCodeList, ZERO
   uncaught page errors; remove it.
4. versioned loader: add with `api:2` → honest refusal; malformed src (syntax error) → refusal;
   bad id ('Bad Id!') → refusal; 70 KB src → refusal. Engine untouched by refusals.
5. persistence/export: `avCodeExportText` parses (format/api/id/kind/src/params round-trip);
   `avCodeImportText` of the export re-adds; foreign text refuses.
6. kind module: add the rig's own simple source kind (per the P2 contract: sine osc + amp env) →
   kindId ≥ 64; `avApplyParam('engine.kind', <id>)` accepted; noteOn → tap witness non-silent;
   `avCodeKinds()` lists it; synth-card select contains the option (parent-integrated edit).
7. UI: examples buttons ≥ 3; run the 'tremolo' example via the editor + `#av-code-run` click path →
   list grows; params panel mounts ≥ 2 knobs for the selection; `#av-code-stop` removes;
   `#av-code-status` text truthful.
8. cleanup (remove all rig modules; restore params; hash) + zero page errors + sha before===after +
   screenshot renders/code-suite.png.
SPEC notes for the first parent run: the exact RMS ratio assertion uses the rig's own before/after on
the SAME note (app computes; rig compares) — never a planted literal.

## 3. Gates (wave close)

- Children: `node --check` every authored file; sa-B additionally a node harness
  (cache/scratch/s5/b/) exercising AVUMOD with a mock AVDSP (add fx → eng.fx entry + defaults; add
  kind → registry + init loops; param dispatch incl. setKindParam; poison disable; version/id/size
  refusals; remove; reset) — ALL PASS recorded; sa-F the pattern harness. Rigs written, NOT run.
- Parent: integration (counted-assert script per the house pattern) → `python3 build.py` → smoke
  (extended, pinned) → run cdp_s5 + cdp_code → fix loop (SPEC fixes to intent; app fixes to parent) →
  FULL battery (18 suites; the S4 set + cdp_s5 + cdp_code; one browser at a time, redirected logs) →
  battery-green commit → PERF GATE (bench full + stress ×2 + same-conditions A/B if the knee moved;
  P·1 law) → close commit + continuation addendum 31 + README + docs/05 §2.7 status note.
- Version: ANVIL 1.3.0, phase "S5 · code · keys · help"; footer/head/body text updated by the parent.

## 4. Parent integration edit list (drafted while children author)

1. `build.py`: page parts += av_kb_pop (after av_kb) · av_umod_wl (after av_dsp) · av_code,
   av_code_ui, av_help, av_palette, av_lessons (after av_engine block). Worklet concat += av_umod_wl
   before av_voiceproc; guard assert "AVUMOD" in worklet src.
2. `av_dsp.js`: (a) add `kindModOf(id)` helper after registerKind; (b) swap the THREE
   `KIND_MODS[v.kindId]` dispatch reads (voiceFrame/reinitVoice/releaseVoice) → kindModOf; (c)
   `engine.kind` case: on mapEnum fail, accept a user kind via `AVUMOD.kindIdByName(value)`;
   (d) setParam kind-prefix loop: after the 1..5 loop, fall back to `AVUMOD.setKindParam(eng, path,
   value)`.
3. `av_voiceproc.js`: message branch `m.t === 'umod'` → `AVUMOD.handle(eng, m, this.port)` guarded.
4. `av_engine.js`: in the handshake onmessage dispatcher, route `d.t` starting with `umod` to
   `avCodeOnMessage(d)` (guarded) after the bench/stats line.
5. `av_kb.js`: (E-kb1) add `avPianoBedRoot()` (popout-aware; consults `avKbPopKeysRoot` when present);
   (E-kb2) avPianoRefresh keys iteration uses the bed root; (E-kb3) `avPianoSetOpen` calls guarded
   `avKbPopHome()` first; (E-kb4) hint line popout-aware (`avKbPopHint()` when `piano-pop`); (E-kb5)
   end of avPianoRefresh calls guarded `avKbPopMirror()`; (E-kb6) avKbHandle: after `const mod = …`
   insert the `avUiKeyHook` line.
6. `av_synth.js`: ENGINE select appends `avCodeKinds()` options (guarded) — anchor resolved with the
   source open at integration.
7. `body.html`: #av-code card + host after #av-files; footer/h1/roadmap text; `#pk-pop`/`#pk-return`
   buttons in the piano rail (pinned markup: AFTER `#pk-close`).
8. `styles.css`: append the S5 block (classes from all children's reports).
9. `app_core.js`: boot calls (avKbPopInit, avCodeInit, avCodeUiInit, avHelpInit, avPaletteInit,
   avLessonsInit) + log line + ANVIL version/phase.
10. `cdp_smoke.mjs`: add the S5 checks (CODE card + hosts + APIs; pk-pop button; help/palette/lessons
    globals) before the zero-errors check; counts re-pinned.
11. `head.html` title/description; pins: after the freeze, update EVERY suite's EXPECT_SHA (now 18
    suites) — battery re-run on frozen bytes.

## 5. Reports (children)

Prose list: files (paths + line counts) · version · interface (exports + observables as written) ·
harness (command + summary + deviations) · css classes · notes/open items. No template-brace blocks.
Raw evidence under cache/scratch/s5/<letter>/; the parent re-verifies every landing by artifacts on
disk (existence + node --check + harness re-run), never by the report alone.
