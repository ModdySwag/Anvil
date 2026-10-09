# K wave contract — FINISH KNICKS (P4 follow-ups · boot template · WAV metadata · multi-tab)

Owner scope: the last owed items after E closes. This wave's close = the FINISH close.
1. P4 follow-ups: (a) fill control wiring — the runtime FILL flag gets a real UI toggle
   (today it is reachable only via the `__avSeq` debug handle setFill); (b) chains/scenes
   undo checkpoints — the undo "seq" domain captures ONLY the pattern today, so chain/scene
   pushes record entries that cannot actually restore chains/scenes; extend capture+restore
   to {pattern, chains, song, scenes}; (c) the acid accent-flag DECISION already lands in E.
2. Boot templates (deferred by the R20 contract): an optional template applied when starting
   a NEW session, selectable in the sessions card.
3. BWF/iXML/acid/ID3 chunk reads (docs/12 §7.7): clean-room tempo/root/key auto-tags on
   imported WAVs, fixture-evidenced, read-only (never rewrite files).
4. Multi-tab contention (docs/12 §7.5): probe + a lightweight honest note.

State at open: E wave CLOSED first (its frozen sha fills in at open; worklet unchanged by
this wave — page-side only, unless a listed file proves otherwise).

## 1. Deliverables + file ownership

| # | files | work |
|---|-------|------|
| KI | `src/av_seq_sched.js` + `src/av_seq_ui.js` + `src/av_undo.js` | fill toggle (sched exports + UI control) · undo capture v2 (chains/song/scenes) + push audit |
| KS | `src/av_session.js` + `src/av_session_ui.js` | boot template (LS + sessions-card select + NEW-SESSION apply) · multi-tab note (BroadcastChannel beacon) |
| KL | `src/av_wavio.js` + `src/av_import.js` (+ `src/av_import_ui.js` ONLY if the inspector needs explicit rows — report the exact minimal edit) | avWavMeta readers + import fold |
| KR | `verify/cdp_seq.mjs` + `verify/cdp_sessions.mjs` + `verify/cdp_import.mjs` | rig legs for KI + KS + KL |
| P | parent | multi-tab live probe + §7.2/7.3/7.6 benches, docs/12 §7 status update, README refresh, gates, deploy, live, FINISH close |

Children NEVER run build.py / git / browsers / suites; node --check + own scratch harnesses
allowed; write-first; ASCII-only; one writer per file; source wins on conflicts — name them.

## 2. KI pins — fill toggle + undo v2

- `src/av_seq_sched.js`: real exports `avSeqSchedSetFill(on) -> bool` and
  `avSeqSchedGetFill() -> 0|1` (the `__avSeq` debug handle keeps working; same setter
  semantics: sets avSeqSchedFill + rebuilds the view + no throw). Document EXACTLY what the
  pattern.fill field means at load (L~700/777 audit) in the header: pattern.fill initialises
  the runtime flag (or the audited truth); the toggle owns it at runtime.
- `src/av_seq_ui.js`: a FILL toggle in the transport row next to the existing FILL apply
  control — id `#av-seq-fill-toggle`, label "FILL", pressed-state class reflecting
  avSeqSchedGetFill(), click -> avSeqSchedSetFill(!get) + repaint. PERFORMANCE state: no
  undo push, not part of the pattern, not persisted (document). Also: the
  `#av-seq-fill-id`/`#av-seq-fill-apply` (apply-named-fill) surface keeps its current
  semantics and push.
- `src/av_undo.js`: "seq" domain capture v2 = JSON of `{ v:2, pattern: avSeqSnap(),
  chains: avSeqChainsSnap(), song: avSeqSongSnap(), scenes: avSeqScenesSnap() }` (each
  guarded; any missing piece = null field, still honest). Restore = apply all four via their
  LOAD functions in a safe order (pattern last or first — decide by reading the loaders for
  shared state; document). A/B store/recall uses the same capture. Entry bytes accounting
  unchanged. Keep the old push call sites; audit EVERY chain/scene/song mutation surface in
  av_seq_ui.js (and anywhere else — grep avSeqChainsLoad / avSeqScenesLoad / avSeqSongLoad
  callers) for a push-after-change; add missing ones (label "chain"/"scene"/"song").
- Node harness (scratch): capture/restore deep-equal round-trip over a mutated triple;
  restore order safety; refusal honesty when a hook is absent.

## 3. KS pins — boot template + multi-tab note

- Boot template: LS key `av-boot-template`, value JSON `{v:1, id:""}` ("" = none; id = a
  saved session's id). Sessions card gains a "BOOT TEMPLATE" row: a select of saved sessions
  (+ "none") + an apply-on-new affordance: a `NEW SESSION` button (id `#av-sessions-new`)
  that (1) if a template is set, restores that snapshot as the working state and marks the
  session DIRTY (autosave will not silently overwrite; the user saves explicitly), with an
  honest status line; (2) if none, current new-session behaviour (find it — if a new-session
  flow already exists elsewhere, hook it there and report the seam; do not duplicate).
  The recovery offer is untouched — the template applies ONLY on the explicit action.
- Multi-tab note: `av_session.js` opens a guarded BroadcastChannel `'anvil-tabs'`; after a
  successful autosave/save it posts {t:"saved", at}; when a message from another tab arrives
  (< 15 s window), the sessions card shows a dim note line `#av-sessions-tabnote`: "another
  tab saved recently - last write wins". Auto-hide after the window. Absent BroadcastChannel
  = silent no-op. This is the recorded §7.5 disposition (note over lock).

## 4. KL pins — avWavMeta

`avWavMeta(buf) -> { ok, tempo, root, key, source: string[], warnings: string[], error }`
clean-room chunk walk on the EXISTING reader's conventions (mirror avWavInfo's discipline:
never throw, clamp, honest refusal):
- iXML chunk (text): extract `<TEMPO>` (number), `<ROOT>` (note name), `<KEY>` (text) via
  tolerant substring/regex reads (case-insensitive tags); source "iXML".
- acid chunk: root note (hi 16 bits note, lo 16 bits fractional cents — document the layout
  you implement), tempo (float32 LE), beats (uint32); source "acid". Values sanity-clamped
  (tempo 20..300 else dropped; root 0..127).
- id3 / ID3 chunk (ID3v2): frames TBPM (tempo) + TKEY (key), text frames only, size-capped;
  source "id3".
- bext chunk: presence + originator/description text (informational only); source "bext".
Fixtures: author synthetic WAVs (in the harness AND in the cdp_import leg) carrying each
chunk; assert tempo/root/key outcomes + honest absence. wire: `src/av_import.js` folds
detected fields into the item meta (additive keys: meta.tempo, meta.root, meta.key,
meta.metaSource) for the wav-family reads only; refusals untouched. Display: check whether
the library inspector renders item.meta generically; only if NOT, the minimal explicit rows
(report the exact edit). NEVER rewrite files (read-only).

## 5. KR rig legs

- cdp_seq.mjs: fill toggle leg (toggle on -> a `cond:"fill"` step emits; off -> silent;
  witness via the existing events/planner observables, house style); chain undo leg (add a
  chain -> undo -> chain list restored; redo -> re-applied); scene undo leg (apply scene ->
  undo -> prior scene state restored) — state read via the facade observables.
- cdp_sessions.mjs: boot template leg (save two sessions, set template to one, NEW SECION
  apply -> state matches the template marker + dirty set + status line text). Multi-tab leg:
  the rig creates its OWN second BroadcastChannel('anvil-tabs') object in the page and posts
  {t:"saved"} -> the note element appears (same-context second channel receives; do NOT try
  to open a second tab).
- cdp_import.mjs: meta leg — build a minimal WAV with an iXML TEMPO/ROOT chunk in-page,
  import via the funnel, assert the item meta + inspector shows them.
- All rig edits keep counts honest (bump + report); nothing loosened.

## 6. Parent gates + FINISH close

rebuild -> smoke -> seq/sessions/import first runs + SPEC work -> pins sweep -> FULL battery
(incl. the new tune rig) -> bench -> deploy -> live verify + live probe (fill toggle + undo +
template leg read on the live page) -> then the FINISH close: README status refresh (rewrite
the stale status block to the final state), docs/12 §7 item statuses updated (7.1/7.2/7.3/7.4
probe records; 7.5 the multi-tab disposition; 7.6 bundle-ceiling numbers; 7.7 implemented)
+ the §7.2/7.3/7.6 benches recorded, continuation addendum "FINISH COMPLETE" + the
owner-pass ask (real launchQueue arrival + real FSA dir-picker click) + the recorded
optional-extras list (analog pass #63, elastic audio #64, live mode #74, cloud backend,
embed stance etc. — NOT built, owner-gated), Mnemosyne + skill refresh, commits.

## 7. Watch-outs

- The multi-tab PROBE runs before/next to KS: if the probe shows something worse than
  last-write-wins (corruption), stop and report instead of shipping the note.
- Undo v2 must not bloat entries unboundedly (song snapshots can be largish — measure entry
  bytes with a fat fixture, keep the existing cap semantics; report numbers).
- av_wavio.js must stay classic-script + node-loadable; av_import.js edits stay additive and
  must not disturb the existing receipt/dup laws.
- Boot template + autosave interplay is the risk surface: test setting template, applying,
  then a normal save; document the dirty/unsaved contract in the header.
- rig leg thresholds measured-then-pinned, never loosened.

## 8. Report shape

Per §11 of the T contract: files, lines, exports, evidence, deviations, seams. Plain lists.
