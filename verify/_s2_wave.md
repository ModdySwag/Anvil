# Anvil S2 wave — SESSIONS PERSIST: session snapshots · autosave + recovery · backup zip · Sessions card (2026-10-07)

Trigger: S1 RECORD CORE closed (`75c9c2eb`; addendum 25). This wave = `docs/08` **S2 · TAKES &
SESSIONS**, scoped to its **sessions half**: working-state snapshots with versions + autosave/recovery
(#76) and the full backup zip (#52). The takes half (take lanes · pick-best comping lite · trims +
crossfades) is split to **S2.1** (later wave; the S1 note's shorthand for S2 is exactly
`sessions (#76, #52)`). Acceptance context (`docs/08` §1): "a full song — record vocals over a groove,
comp a take, mix, master, deliver stems" — comping stays for S2.1, mix/master for S3.

## 0. Platform notes (no probe required)

IDB persistence across reload (`av-packs-store`, `cdp_store`) and browser downloads (`cdp_bounce`
deliver e2e) are already proven on `file://`. NEW rig surface this wave: `Page.navigate` reload legs
(autosave→recovery; sessions survive reload) — standard CDP on the same target; keep the temp profile
(it must survive the reload — IDB visibility is per-profile). No fake-media flags needed.

## 1. Scope & file ownership (ONE writer per file)

| child | owns (write) | scratch |
|---|---|---|
| sa-A | `src/av_session.js` (core: capture/apply · IDB `av-sessions-store` · versions · autosave · recovery) | `cache/scratch/s2/session/` |
| sa-B | `src/av_backup.js` (backup zip write + **store-method zip READER** + restore; rides av_zipc/av_wavio/av_store/av_session) | `cache/scratch/s2/backup/` |
| sa-C | `src/av_session_ui.js` (the Sessions card) | `cache/scratch/s2/ui/` |
| sa-D | `verify/cdp_sessions.mjs` (WRITE-ONLY rig; parent runs it) | `cache/scratch/s2/rig/` |

Children never touch shared files (`build.py`, `src/body.html`, `src/styles.css`, `src/app_core.js`,
`verify/cdp_smoke.mjs`, other `src/*`) and never run the build, browsers, suites or git. Each
self-verifies with a node harness in its scratch. READ-ONLY reference files every child may read:
`src/av_bank.js` (the canonical apply core: every path via the CURRENT `avApplyParam` binding,
`engine.kind` FIRST, booleans→1/0, mod acceptance belt), `src/av_seq_core.js` (snap/load family),
`src/av_store.js` + `src/av_zipc.js` + `src/av_wavio.js` (sa-B), `src/av_takes.js` (takes metadata).

## 2. Pinned interfaces

### 2.1 `av_session.js` (sa-A) — public surface

```js
avSessionInit() -> boolean                 // idempotent; no DOM; binds storage lazily
avSessionCapture(opts?) -> state           // the working-state snapshot (schema below)
avSessionApply(state) -> { ok, applied, skipped }   // write path (laws below)
avSessionSave(name?) -> Promise<receipt>   // capture -> new VERSION of the current session (creates on first save)
avSessionList() -> [{ id, name, savedAt, updatedAt, version, current }]
avSessionLoad(id) -> Promise<receipt>      // apply a session's newest version + mark current
avSessionDelete(id) -> boolean
avSessionVersions(id?) -> [{ version, savedAt, bytes }]
avSessionRestore(id, version) -> Promise<receipt>
avSessionAutosave(on, ms?) -> { on, ms }   // default 45000 ms; clamp 5000..600000
avSessionState() -> { init, backend, count, current:{ id, name } | null, dirty,
                      lastAutosaveAt, autosave:{ on, ms }, recovery:{ available, savedAt, name, at } }
avSessionRecover() -> Promise<receipt>     // apply the autosave snapshot; clears recovery
avSessionDismissRecovery() -> boolean
avSessionExport() -> { v, sessions: [record...] }        // raw records for the backup child
avSessionImport(payloadOrRecord) -> { ok, imported, skipped }  // tolerant; id-dedupe (imported keeps its id when free)
avSessionTouch() -> boolean                // mark dirty (best-effort; fingerprint also works without it)
avSessionClasses() -> string[]             // this module mounts nothing (the card owns markup)
window.__avSession = { version, init, capture, apply, save, list, load, delete, versions, restore,
                       autosave, state, recover, export: avSessionExport, import: avSessionImport }
```

**State schema (v1, JSON-safe by construction):**

```js
{ v: 1, name, savedAt, seq: { pattern: avSeqSnap(), chains: avSeqChainsSnap(),
  song: avSeqSongSnap(), scenes: avSeqScenesSnap() },
  params: {...avParams clone},            // includes engine.kind when the app mirrors it
  mod: { macros: [8 numbers] },           // from avModPayload(); slot routing = Undetermined v1 (see laws)
  takesMeta: [...],                       // avTakesList() verbatim (metadata only — take AUDIO is not session data)
  prefs: { inputGain, inputOffsetMs, metro:{ level, beatsPerBar, countIn } } }
```

**Storage:** IDB db `av-sessions-store`, object store `sessions` (one record per session:
`{ id, name, createdAt, updatedAt, current, versions:[{ v, savedAt, state }] }`, ring bounded to the
last **16** versions); a separate record id `__autosave` holds the latest autosave snapshot meta+state.
LS fallback key `av-sessions-ls` (JSON, meta+newest version only). "Nothing durable → not saved" —
mirror av_store's honest backend reporting (`backend: 'idb'|'ls'|'mem'`). No crypto needed (not a
security boundary); ids = `s<n>` counters + timestamp fallback.

**Apply laws (mirror av_bank.js — read it first):** (1) `seq` FIRST: `avSeqLoad(pattern)` +
`avSeqChainsLoad/SongLoad/ScenesLoad`; then the canonical UI sync pair used by the P4 integration
(see av_bank.js's seq branch), then push a `"seq"` undo checkpoint AFTER the load (P4 undo law);
(2) `engine.kind` before other params; (3) EVERY param path through the CURRENT `avApplyParam`
binding (never direct engine writes); unknown/refused paths → `skipped` (counted, never throw);
(4) mod macros via the funnel (`mod.macroN` rides av_mod's wrap); (5) prefs applied via their pinned
setters only when the module is present (typeof-guarded); (6) `takesMeta` is NOT applied (live takes
belong to the session flow, not to load) — record it as carried metadata.

**Dirty + autosave:** dirty = cheap fingerprint changed — fingerprint = `avSeqPatternExport()` string
+ JSON of `{params, mod.macros}` + `avTakesList().length` (guarded, never throw). Autosave tick (timer
at `ms`, only while on): if dirty → capture → write the `__autosave` record ({ state, savedAt, name:
current name }); `avSessionTouch()` marks dirty eagerly (UI + loadable hooks call it best-effort).

**Recovery:** on init, if the `__autosave` record exists → `recovery.available = true` with its
savedAt/name. `avSessionRecover()` = apply its state + clear the record + mark `recovered` in
`avSessionState()` notes. The recovery offer NEVER auto-applies (honest choice surfaces the banner).

### 2.2 `av_backup.js` (sa-B) — public surface

```js
avBackupInit() -> boolean
avBackupBuild(opts?) -> Promise<{ ok, name, bytes, buffer (ArrayBuffer), manifest }>
avBackupRead(buf) -> { ok, entries: [{ name, size, bytes(Uint8Array) }], manifest, errors: [] }
avBackupRestore(bufOrReadResult, mode?) -> Promise<{ ok, restored: { sessions, packs, samples }, skipped, errors }>
avBackupState() -> { busy, lastBuild:{ name, bytes, at } | null, lastRestore: {...} | null }
avBackupClasses() -> string[]   // [] until the card adds shared classes (same convention as S1 metro)
window.__avBackup = { version, init, build, read, restore, state }
```

**Zip layout** (built with `avZipBuild`, WAVs via `avWavEncode`; store-method entries only):

```
manifest.json        { v:1, app:'anvil', at, sha256: { '<entry>': '<hex>', ... }, counts:{sessions,packs,samples} }
sessions.json        avSessionExport() payload (ALL sessions incl. versions)
packs/<id>.json      one per INSTALLED pack (avStoreGet(id) payload — read av_store.js for the record shape)
samples/slot<n>.wav  one per non-empty sample slot (WAV data of {rate, ch1, ch2}; name + slot in the WAV filename)
README.txt           one-line what-this-is + restore hint
```

**Reader:** `avBackupRead` parses the central directory of OUR store-method zips (little-endian
EOCD + entries; validate CRC32 with the existing `avZipCrc32`; deflate/other methods → honest
`errors[]` entry, never throw). `manifest.sha256` re-verified during restore (mismatch → skip entry +
error). **Restore:** sessions via `avSessionImport`; packs via the store's own install machinery
(**read av_store.js** — prefer its public paths; if only internal DB writes exist, use its OWN
functions, never re-implement IDB schema); samples via the sample core's import hooks (**read
av_sample.js** — if it exposes no import entry, restore is best-effort: report skipped + why in
`errors`; list it in the report's Undetermined). Restore = additive (never deletes the user's current
state; id collisions: sessions keep-if-free per avSessionImport).

### 2.3 `av_session_ui.js` (sa-C) — the Sessions card

```js
avSessionUiInit() -> boolean   // mounts into #av-sessions-host (absent -> false, no throw;
                               // idempotent; dataset marker avSessionUiWired='1')
avSessionUiClasses() -> string[] · avSessionUiSync() -> boolean · window.__avSessionUi { state, sync, ... }
```

Card (class prefix `av-sessions-*`, reuse av-btn/av-note/av-dim/av-select): RECOVERY banner row
(shown only when `avSessionState().recovery.available` — RECOVER / DISMISS; states its savedAt) ·
SESSIONS section (name input + SAVE · rows: name · savedAt · vN · LOAD · ✕; current row marked;
versions sub-row with per-version RESTORE) · AUTOSAVE row (toggle + interval select 15/30/45/90 s,
state readout) · BACKUP row (BACKUP NOW → avBackupBuild → download via the anchor-blob technique from
av_deliver_ui; RESTORE (file) → file input → avBackupRestore with a progress/status line + report:
sessions/packs/samples restored · errors listed) · status line + warnings area (never console noise).
All module calls typeof-guarded; degraded notes like the Studio card's.

### 2.4 Rig `verify/cdp_sessions.mjs` (sa-D writes, parent runs)

Launch skeleton VERBATIM from `cdp_studio.mjs` (candidates, free port, temp profile, 1440×900
metrics, explicit exit, profile-scoped cleanup; NO fake-media flags needed); `EXPECT_SHA` null until
pinned. Proofs:
1. boot + card mounted (#av-sessions + #av-sessions-host · `.av-sessions` root · wired marker ·
   SAVE/LOAD/RESTORE controls present via tolerant label scan · module globals live · window objects).
2. **Round-trip:** rig pattern loaded (the `__seqi` helper approach from cdp_studio) + bpm set +
   a couple of param commits + a mod macro value → `avSessionSave('RIG')` → MUTATE (different bpm,
   cleared pattern, different macro) → `avSessionLoad(id)` → witnesses: `avSeqPatternExport()` equal,
   bpm equal, macro equal (rig-owned reads; deep-equal via canonical strings).
3. **Versions:** mutate + save again → `avSessionVersions(id).length >= 2`; `avSessionRestore(id, 1)`
   → state equals the v1 snapshot again.
4. **Autosave → reload → recovery:** autosave on (short ms, e.g. 1500–2000 for the rig — the clamp
   floor is 5000, so the rig MUST wait ≥ one clamped tick; use the clamped ms from the returned
   state) → mutate → wait for the autosave record (poll `avSessionState().lastAutosaveAt`) →
   `Page.navigate` same URL (reload) → boot → `avSessionState().recovery.available === true` (name +
   savedAt sane) → `avSessionRecover()` → witnesses match the mutated state → recovery cleared.
5. **Sessions survive reload:** after reload, `avSessionList()` still holds the saved session(s).
6. **Backup:** `avBackupBuild()` → in-page `avBackupRead(buffer)`: entries present (manifest,
   sessions.json, README, any packs/samples), manifest sha256s ALL verify (recompute with the page's
   crypto.subtle or the rig's own sha over the entry bytes — the reader may expose sha helpers; rig
   asserts real digests), restore round-trip: delete a session + (optionally) mutate → restore →
   sessions back (`avSessionList` equality by id/name). Downloaded-file leg: set
   `Browser.setDownloadBehavior` (the cdp_bounce precedent) and click the card's BACKUP button →
   the file lands (rig records its sha); node-side parent witness walks the zip (python) at
   integration.
7. zero page errors · screenshot `renders/s2-sessions-suite.png` · freeze sha256 before === after ·
   THE PAGE IS LEFT CLEAN (autosave off restored to its pre-run value? no — leave autosave OFF only
   if it was off; restore rig-set mutations: sessions deleted, current session marked as found).

## 3. Laws (wave-specific)

1. One writer per file; 'use strict'; ONE namespace per file (`avSession*` / `AV_SESSION_*` —
   NOTE sa-C's `avSessionUi*` names are the distinct UI namespace; `avBackup*` for sa-B).
2. Node-loadable (no DOM/browser reach at load; every reach typeof-guarded inside functions).
3. NEVER throw — honest refusals, counted skips, no console noise (the smoke zero-error contract).
4. Apply proceeds through the CURRENT avApplyParam binding only; engine.kind first; seq first of all.
5. Storage honest-backend pattern mirrors av_store (idb → ls → mem); "nothing durable → not saved".
6. Bounded growth: version ring ≤ 16/session; autosave = ONE record; no unbounded logs in state.
7. The rig's reload legs must re-arm their own helpers after `Page.navigate` (script context dies).
8. Children self-verify with node harnesses; the browser rig is the parent's gate.

## 4. Parent integration (after children land)

ONE counted-assert script (`cache/scratch/s2/integrate/_s2_integrate.py`): build.py js_parts
(`av_session` → `av_backup` → `av_session_ui` after `av_studio_ui`, before `av_synth`) · body
`#av-sessions` card + `#av-sessions-host` after the `#av-studio` card (+ hero/footer copy) · styles
block (child class lists, coverage-checked) · app_core guarded `avSessionInit()` → `avBackupInit()` →
`avSessionUiInit()` boots + version **0.8.0 "S2 · sessions"** · `cdp_smoke.mjs` sessions-card check
(→ 19) · rebuild → node re-runs + `cdp_sessions.mjs` first run (pin EXPECT_SHA; re-run) → FULL
battery (re-pin all) → **python artifact witness** on the rig-downloaded backup zip (zipfile walk +
manifest sha cross-check + WAV validity) → PERF GATE (bench + stress ×2; hidden-detached) → commits
+ addendum 26.

## 5. Watch items

- The autosave clamp (5000 ms floor) vs rig speed: the rig waits on `lastAutosaveAt`/record state,
  never on raw sleeps alone.
- `Page.navigate` reload: after reload the rig re-injects helpers + re-waits `data-av-ready`; the
  engine will re-boot (worklet) — allow the usual boot budget.
- avModPayload slot arrays: macros restore via the funnel; slot routing restore = best-effort only
  (document Undetermined if av_mod has no sanctioned setter).
- IDB in the rig's temp profile: reload keeps it (same profile); profile cleanup stays scoped.
- Backup file size: samples ≤ 4 slots × 60 s → cap the WAV encode per slot at the stored frames
  (no padding); packs = installed only.
- The card never edits av_session state directly — it calls the pinned API and repaints from
  `avSessionState()`/`avSessionList()` (single source of truth).

Carried: S2.1 takes & comping (lanes · pick-best lite · trims + crossfades) · S3 mix/master (sends
#69 · master chain #70 · LUFS auto-mix #49) · deck (#15) · popout keyboard · CODE (#81) ·
walkthrough/help (#20/#45/#80) · max modules · platform (share/cloud/PWA/FSA/bridges/video) · P7
polish + deploy + owner pass · P·2 minBLEP pass · P4 follow-ups · PERFECT TUNINGS.
