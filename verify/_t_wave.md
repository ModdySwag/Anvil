# T wave contract — TUNING STUDIO (microtuning engine + TUNE card + PERFECT TUNINGS pack)

Owner scope = docs/07 Batch 4 item #62 (microtuning studio: Scala .scl/.kbm import, per-part
tuning, MTS-ESP live SysEx receive, equal<->tuned TUNE morph) + the blocked content pack
"PERFECT TUNINGS" (T8 §12: 12 authored scales x 2-3 presets = 32) — the LAST pack of the
day-one 10-pack / 580-preset target. After the R17-R21 program closed, this is the biggest
owed item ("finish").

State at open: R20 frozen `354b74dd` (4,358,179 B; sw `56b8af71`; worklet `b65160e0`) deployed
+ live; pins 22 at 354b74dd; tree clean except `?? cache/`. THIS WAVE CHANGES THE WORKLET by
design (tuning bank + note opts) — the worklet sha WILL move; record both shas in the close.

## 1. Deliverables

1. `src/av_tune.js` (NEW, page-side only, node-loadable): Scala `.scl`/`.kbm` clean-room
   parsers, 12 built-in authored scales, 128-entry table builder (semitone offsets vs
   12-EDO), equal<->tuned morph, MTS SysEx parse (single-note + scale/octave forms), the
   `av-tune-store` library (av_wt.js tier law: IDB -> LS fallback -> memory last), `.scl`
   EXPORT text, facade `window.__avTune`.
2. Engine tuning application (worklet): a 8-slot tuning bank + `'tuning'`/`'tuneactive'`
   port messages + per-note tuning slot through the ONE note path; per-voice offset applied
   in the av_dsp pitch calc; stats additive fields.
3. `src/av_tune_ui.js` (NEW, page-side): the TUNE card (SYNTH zone) — scale select + root +
   morph, per-track (4 parts) assignment, library (import/list/apply/export/delete), MTS
   toggle + status.
4. MTS receive wiring in `src/av_midi.js` (SysEx -> avTuneMtsParse -> live slot).
5. `src/av_import.js`: `.scl`/`.kbm` policy rows (honest refusal with a TUNE-card pointer,
   the `.wt` precedent).
6. `verify/cdp_tune.mjs` (NEW rig) + `verify/cdp_smoke.mjs` (+1 TUNE card check).
7. `packs/perfect-tunings.avbank.json` — 32 presets across the 12 authored scales.

## 2. File ownership (one writer per file; siblings must not overlap)

| # | files | work |
|---|-------|------|
| A | `src/av_tune.js` | NEW core: parsers + builtins + builder + morph + MTS parse + store + export + harness |
| B | `src/av_dsp.js` + `src/av_voiceproc.js` + `src/av_engine.js` + `src/av_note.js` | tuning bank, messages, note opts path, pitch application, stats |
| C | `src/av_tune_ui.js` + `src/av_midi.js` | NEW card UI + MTS SysEx receive |
| D | `src/av_import.js` | `.scl`/`.kbm` policy + sniffer rows only (2+2 rows) |
| E1 | `verify/cdp_tune.mjs` + `verify/cdp_smoke.mjs` | NEW rig + smoke TUNE card check |
| F | `packs/perfect-tunings.avbank.json` | the 32-preset pack + scratch generator + self-verify |
| P | parent | styles block, body.html card, app_core boot + version, build.py js_parts, gates, pins, deploy, live, close |

Children NEVER run build.py / git / browsers / the suites. `node --check` on the child's OWN
files is allowed (E1's rig runs only at parent triage). Write-first: a complete coherent file
lands on disk first, then iterate. ASCII-only in source (write \uXXXX escapes if ever needed).
Scratch under `cache/scratch/t/<child>/`. Conflict clause: if a pin here conflicts with live
source, the SOURCE wins — name the conflict in the report, never silently diverge.

## 3. Core pins (A)

Module: classic script, "use strict", ONE top-level namespace (`avTune*` + `AV_TUNE_*` consts),
no DOM/window/console reach at load, no top-level side effects, never throw.

- `avTuneParseScl(text) -> { ok, name, description, count, cents: number[], error }`
  Scala .scl semantics (clean-room from the documented format): `!` comments and blank lines
  skipped; line 1 = description; line 2 = note count N; then N pitch lines, each either a
  ratio `a/b` or cents (a number, optional trailing `.` = "exact" marker ignored); cents value
  may also carry the `C#`-style suffix `!#`? NO — keep to spec: ratio or cents only. Values
  must be ascending (non-strict); a first pitch of 0.0/1-1 is the 1/1. Refuse honestly with
  `ok:false` + `error` on count mismatch, non-numeric, N < 1, N > 512.
- `avTuneParseKbm(text) -> { ok, mapSize, firstMidi, lastMidi, middleNote, refNote, refHz, chain: number[], error }`
  Keyboard mapping: 7 header lines (mapSize, firstMidi, lastMidi, middleNote, refNote, refHz;
  comments/blanks skipped), then mapSize lines of the octave degree chain (small ints; -1 =
  plain linear interpolation point). Accept mapSize 0 with an empty chain. Refuse honestly
  outside sane bounds (sizes 0..127, notes -1..127, refHz 1..100000).
- `avTuneBuildTable(tuning, opts) -> Float32Array(128)`
  tuning = `{ cents: number[] }` (.scl absolute cents from the 1/1) plus optional
  `{ chain, refNote, refHz, mapSize, middleNote }` (.kbm); opts = `{ root }` (midi note
  anchoring the scale's 1/1, default 60). Default mapping (no .kbm) = Scala default: MIDI keys
  map SUCCESSIVELY onto scale degrees, octave-wrapped (key k above/below root walks the scale
  by degree, not by semitone). Output = per-MIDI-note semitone OFFSET vs 12-EDO such that a
  12-EDO scale yields all zeros; values clamped +-2 semitones, non-finite -> 0. Deterministic.
- `avTuneMorph(table, amount) -> Float32Array(128)` — `out[i] = table[i] * amount`
  (amount 0 = 12-EDO equal, 1 = the scale fully applied); clamp 0..1.
- 12 built-in authored scales (**own math, own names; no archive files**). Required set (may
  rename within reason, ids stable): `12edo` (identity), `just-major`, `just-minor`,
  `pythagorean`, `meantone-quarter` (1/4-comma), `werckmeister3`, `kirnberger3`, `edo19`,
  `edo22`, `edo31`, `harmonic16` (8..16 harmonic series), `gamelan` (own authored 5/7-tone
  approximation, Slendro/Pelog-flavoured, own math). `avTuneBuiltinIds() -> string[]`,
  `avTuneBuiltin(id) -> { id, name, family, cents, description } | null`.
- MTS receive parse (clean-room from the MIDI Tuning Standard):
  `avTuneMtsParse(bytes) -> { ok, kind, notes: number[], cents: number[]|null, error }`
  - `F0 7F <dev> 08 08 <ch1..> ...` scale/octave tuning 1-byte form: 12 bytes (or 24 for
    2-byte form 0x09) of 14-bit-ish tuning values -> convert to cents offsets per the spec
    (byte = 100/64 cent steps for 0x08; 0x09 = 2 bytes, 100/(16384 c) per step... implement
    from the spec table: 1-byte form value = tuning in steps of 100/64 cents relative to
    the note's 12-EDO position, sentinel 127/128 rules).
  - `F0 7F <dev> 08 02 <note> <xx yy zz>` single note tuning change: 3-byte freq in cents
    (14-bit semitone + 14-bit fraction-of-semitone cents; convert to an offset).
  - Return `notes` = affected midi notes, `cents` = the offsets (per note). ok:false + error
    for other sub-ids / malformed. NEVER throw.
- Store (av_wt.js tier law): IDB db `av-tune-store`, object store `tune` keyPath `id`, LS
  fallback key `av-tune-ls`, memory last. Item: `{ id, name, kind: "scl"|"kbm"|"builtin",
  text (source), cents|chain json, at, v:1 }`. API: `avTuneLibrarySave(item)`,
  `avTuneLibraryList()`, `avTuneLibraryLoad(id)`, `avTuneLibraryDelete(id)` (all
  promise-shaped like av_wt's). Cap 64 items, name 48 chars.
- `avTuneExportScl(id) -> string | null` — a valid `.scl` text for a built-in OR user entry
  (own-authored output). Round-trip law: parse(export(id)) cents deep-equal the source cents.
- Facade `window.__avTune` = `{ version, builtinIds, builtin, parseScl, parseKbm, buildTable,
  morph, mtsParse, exportScl, library: { save, list, load, delete } }` (+ anything additive).
- Node harness (`cache/scratch/t/A/`): authored .scl + .kbm fixtures (hand-written strings),
  MTS byte fixtures (hand-built arrays), table math checks (just-major third = 386.31 cents
  -> offset -0.1369 st on note 64 root 60; edo19 wraps sanely; morph endpoints), export
  round-trip, KBM mapping case, refuse cases. Print PASS/FAIL lines + a JSON summary.

## 4. Engine pins (B)

Message additions (av_voiceproc.js, next to the existing branches):
- `{ t:'tuning', slot (int 0..7), offs (Float32Array(128) | null), name (string, cap 48) }`
  -> `AVDSP.setTuning(eng, slot, offs, name)`. null offs clears the slot. offs: length MUST
  be 128 else refuse false; values clamped +-2 semitones, non-finite -> 0; the engine keeps
  its OWN copy (copyInto a fresh Float32Array).
- `{ t:'tuneactive', slot (int 0..7) }` -> `AVDSP.setTuneActive(eng, slot)`.
- `{ t:'note', on, midi, gain, tune?, acc? }` — two new OPTIONAL flat fields; absent = today's
  behaviour exactly.
av_dsp.js: `eng.tuneBank` = Array(8) of null | Float32Array(128); `eng.tuneActive` = 0.
`noteOn(eng, midi, gain, ch, opts)` — NEW 5th param `opts` (object or undefined;
`opts.tune` int 0..7, `opts.acc` 0|1). `reinitVoice` gains opts threading; set on the voice:
`v.tuneOff` (bank[slot][midi & 127] or 0; slot = valid opts.tune else eng.tuneActive) and
`v.acc` (opts.acc when 0|1, else -1 sentinel). EVERY reinitVoice call path (fresh voice,
steal, pending/retrigger) carries the note's own opts — a retrigger must not inherit the
previous note's tuning. Pitch: in the voice's freq calc (post-`let st = ...`, after the MPE
add) apply `st += v.tuneOff;` — constant per voice (ramp/glide excluded by design, document).
Stats: `AVDSP.stats(eng)` gains `tune: { active: slot, slots: [name|null x8], last: { midi,
slot, off } | null }` — `last` updates on every note-on that read a non-zero table (or any
note-on when any slot is non-null; pick one rule and keep it: update on every note-on,
honest). Additive only; keep every existing stats field.
av_engine.js: page-side senders `avEngineTune(slot, offs, name) -> bool` and
`avEngineTuneActive(slot) -> bool`, mirroring avEngineSample (worklet postMessage + the SPN
direct fallback calls AVDSP.setTuning/setTuneActive on the SPN engine). NOTE: the SPN tier
must apply tuning identically. The note path: `avEngineNoteArgs` (L280 area) gains opts
fields — sink `on(midi, gain, name, ch, opts)`; for ch === 0 the note message carries
`tune`/`acc` when opts provides them; the SPN direct path passes opts to AVDSP.noteOn.
av_note.js: `avNoteDown(name, vel, ch, opts)` — NEW 4th param, passed through to
`avNoteSink.on(midi, g, name, mpeCh, opts)`; `window.__avNotes` unchanged. Backwards
compatible: no opts = today.
Careful: AVDSP.noteOn is called from av_voiceproc (both note + mpenote branches) and the SPN
path — all call sites updated in this one file set; grep `noteOn(` and prove each.
Node harness (`cache/scratch/t/B/`): load the worklet concat sources in node (av_dsp +
av_acid etc. pattern used by the alias rig), build a table, setTuning, noteOn with opts.tune,
render a few quanta with all kinds off except a VA osc; assert the rendered zero-crossing
period matches the tuned freq within tolerance vs the 12-EDO render; assert an out-of-range
slot falls back to active; assert stats fields. Record raw numbers in the report.

## 5. UI pins (C) — the TUNE card

Module `src/av_tune_ui.js`: `avTuneUiInit() -> bool` (mounts into `#av-tune-host` if present;
false when absent — the house guard), `avTuneUiClasses() -> string[]` (runtime class list for
the parent styles block), status mirror `window.__avTuneUi`.
Card ids (PIN — the rig asserts these): `#av-tune` (card, parent-owned in body.html),
`#av-tune-host` (mount point, parent-owned), then module-emitted:
`#av-tune-scale` (select: built-ins + user library items; value = tuning id; a leading
"12-EDO (equal)" option always), `#av-tune-root` (select of midi notes g2..c6 labelled
note names, default c4), `#av-tune-morph` (range 0..100, default 100), `#av-tune-track-0` ..
`#av-tune-track-3` (per-part selects: "GLOBAL" | tuning id), `#av-tune-import` +
`#av-tune-import-file` (hidden file input, accept ".scl,.kbm"), `#av-tune-export`,
`#av-tune-lib` (list container; rows `[data-tune-id]` with APPLY/DEL buttons),
`#av-tune-mts` (checkbox), `#av-tune-status` (status line), `#av-tune-mts-status`.
Behaviour pins:
- Selection state `{ sel (id), root, morph, tracks: [4 x id|""], mts }` persisted in LS
  `av-tune-pref` (v:1) and re-applied on init.
- Slot management (page-side): slot 7 reserved for MTS live; card assigns slots 0..6 to
  distinct selected tunings (global selection first; then track assignments; LRU reuse by
  selection order). Upload = avTuneBuildTable -> avTuneMorph -> avEngineTune(slot, offs,
  name). Derive the table from EITHER builtin OR user library entry (scl [+ kbm]).
- Applying: any change re-uploads the affected slot(s) and calls avEngineTuneActive with the
  global selection's slot. Track select "" = global. A 5th distinct tuning needed with all
  7 slots busy -> status line honest refusal (no silent eviction). MTS ON: incoming tunings
  write slot 7 and set active 7; OFF restores the global slot's active.
- Import: picker -> read text -> sniff (avTuneParseScl then avTuneParseKbm; kbm alone =
  mapping attached to the next/selected scl? KEEP SIMPLE: .kbm files save as library items of
  kind "kbm"; a library row of kind kbm has APPLY = attach as the keyboard mapping of the
  current global selection (rebuild + re-upload). .scl rows APPLY = select as global.) Save
  via avTuneLibrarySave; honest status errors; receipt-style status via #av-tune-status.
- EXPORT: downloads `<name>.scl` text via the house arrayBuffer/blob download law.
- All DOM work guarded; no console errors; Esc/undo NOT in scope.
av_midi.js addition: MTS receive. When `#av-tune-mts` is ON the card calls
`avTuneMtsEnable(true)` (exported by av_tune_ui.js or av_tune.js — pin: av_tune_ui.js owns
it): the MIDI input handler routes `F0 ... F7` byte arrays to avTuneMtsParse; parsed scale
results build a 128-table -> avEngineTune(7, offs, "MTS live") + avEngineTuneActive(7); OFF
restores. SysEx access: Web MIDI needs { sysex:true } — request on first MTS enable (its own
prompt; honest status if denied: "MTS needs SysEx permission"). The av_midi.js edit is
minimal: keep a module-level hook `avMidiSetSysExSink(fn|null)` that the handler forwards
raw F0..F7 arrays to; the card registers/unregisters. Existing MIDI behaviour untouched.

## 6. Import policy rows (D)

`src/av_import.js`: AV_IMPORT_POLICY gains
`scl: { kind:"refused", result:"deferred", reason:"tuning scale - import it in the TUNE card (TUNE > LIBRARY)", persist:false }`
`kbm: { kind:"refused", result:"deferred", reason:"keyboard mapping - import it in the TUNE card (TUNE > LIBRARY)", persist:false }`
and the sniffer table gains the `scl`/`kbm` extension rows exactly like the `wt` row (ext ->
format match). NOTHING else in that file.

## 7. Rig pins (E1)

`verify/cdp_tune.mjs` (NEW): copy the launch block pattern from verify/cdp_hub.mjs (fresh
Edge profile wait for the file:// target; 1440x900 metrics override;
--autoplay-policy=no-user-gesture-required; temp profile; `?avtest=1`; own AnalyserNode
witness on the master tap). `EXPECT_SHA = null` at authoring (parent pins after first run).
Legs (counts final):
- boot: zero page errors; `#av-tune` card mounted (host children > 0) — T1/T2.
- facade: `__avTune` present; builtinIds length 12 (T3).
- select: set `#av-tune-scale` to `just-major`, root c4, morph 100; assert
  `__avEngine.stats().tune.active` slot set + slot name `just-major` (T4/T5).
- spectrum witness: load a clean VA patch (use the cdp_bounce BUILD_PATTERN approach: one
  sustained note on track 0 at c4... simpler: play via avNoteDown('e4') with the default
  engine after loading a minimal pattern; wait ~600 ms; FFT (Blackman-Harris 4-term) the
  witness analyser; assert the fundamental peak within +-3 Hz of 440*2^((64-69)/12) *
  2^((386.31-400)/1200) (just major third anchors: root c4=60, note 64 -> tuned by the
  just-major offset; expected ~329.6 Hz * ... compute expected = 440 * 2^((64 + off64/100
  - 69)/12) with off64 = the module's own table value recomputed independently in the rig
  from the cents fixture). MTS/EDO cases share the helper (T6/T7).
- morph: morph 0 -> peak at 12-EDO freq; delta asserted (T8).
- track leg: assign `#av-tune-track-0` to a non-global tuning (e.g. edo19) with global =
  12edo; `stats().tune.last.slot` proves the note carried the track slot (T9); restore.
- MTS: `__avTune.mtsParse(fixtureBytes)` digest leg + a page-apply leg via
  `avTuneMtsApplyFixture`-style call the module exposes (pin: av_tune_ui.js exports
  `avTuneUiMtsApply(bytes) -> bool` for the rig; honest "no SysEx device" path still works
  because the parse+apply chain is device-free) (T10/T11).
- import: synth a .scl File, assign into `#av-tune-import-file`, dispatch change; assert
  library row appears + `__avTune.library.list()` contains it (T12/T13); reload leg optional
  (T14): after page reload the LS prefs survive (persistence witness).
Log to `verify/last-cdp_tune.log`; screenshots to `renders/tune-suite.png`.
`verify/cdp_smoke.mjs`: +1 check — TUNE card mounted with its host populated (bump the
count; report the new total).

## 8. Pack pins (F)

`packs/perfect-tunings.avbank.json` — 32 presets; follow the EXACT schema of an existing pack
(read `packs/deep-space.avbank.json` + `verify/av_bank_schema.mjs` FIRST; same top-level
shape, id `perfect-tunings`, name "PERFECT TUNINGS"). Spread: 12 scales x 2-3 presets
(bells/drones/plucks/keys voiced for just intonation; use VA/FM/STRING/GRAIN/DRUM kinds as
fits, FX allowed; ONE engine kind per preset = the pack-authoring law — "hybrid" = layered
params of that kind + FX, note it in meta.description). Every preset's meta.description names
its tuning + root, e.g. "Tuned: Werckmeister III, root C - ...". Author via a scratch
generator (`cache/scratch/t/F/`) so variations stay deterministic; self-verify with
`node verify/verify_avpacks.mjs --only perfect-tunings` (strict exit) and record the result.
Do NOT edit packs/index.json (parent regenerates with --index).

## 9. Gates (parent, after integration)

build.py (js_parts + NO new worklet parts; worklet concat unchanged membership) -> node
--check + sha -> smoke -> cdp_tune first run -> rig SPEC work -> pins sweep (22 + cdp_tune
pinned after its first green = 23; NEVER hand-copy the sha — derive from cdp_hub.mjs) ->
FULL battery (the R20 set + tune: smoke cockpit import hub studio sessions comp mix knob_feel
keys midi sample rec fx seq store bounce deck s4 s5 code m1 m2 platform a11y tune) + bench ->
content: full `verify_avpacks.mjs` over ALL packs + `--index` regen + independent sha256
cross-check of the new pack -> deploy (index + sw + packs tree; the packs tree update ships
ONLY the new pack file + index.json) -> live verify (`upload-site.py --verify` scoped = 0
not in sync; live sha = frozen) + the tune live probe (open the live page, select a scale,
read the status + stats) -> addendum + commits. `last-cdp_bench` records both; worklet sha
moves by design (B + the T/E split: THIS wave's worklet change must be recorded).

## 10. Watch-outs

- The `.wt` precedent: the card's own import does NOT ride avImportFiles; receipts are the
  card's status line. Do not silently route through the hub.
- eng.tune (master tune param) vs v.tuneOff vs the bank — three distinct names, keep them.
- The voice retrigger/pending path must carry opts (steal + glide retriggers).
- The worklet concat runs in strict mode with no DOM: av_tune.js must NOT join the worklet
  concat (page-only; the table math stays page-side).
- JSON: keep `av-tune-pref` small; version v:1.
- The spectrum rig must never assert on the tap's raw noise floor — mute the reverb/delay in
  the rig patch (set the fx off via avApplyParam) before measuring.
- cdp_smoke's kinds array does NOT change (no new kind).
- Names: use `avTune*` / `AV_TUNE_*`; ids `av-tune-*`.

## 11. Report shape (each child)

files (abs paths) - lines - version constants - exports added (exact names) - evidence (harness
log path + key numbers) - deviations + conflicts - integration seams the parent must wire
(exact anchor points). Plain lists, no template braces.
