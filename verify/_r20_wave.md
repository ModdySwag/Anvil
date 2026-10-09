# R20 wave contract — WORK PERSISTENCE (autosave default · projects recents · session browser v2 · Song Bundle · backup coverage)

Owner scope = docs/12 §5 R20 (the last roadmap wave; "to the final end stage nothing left of
the build"). Reference: docs/12 §3 D8–D11 + §4 (work & session persistence) + §5's R20 bullet.

State at open: R21 (library overlay) integrated + battery in flight on frozen `1bbfe2cf`
(4,238,455 B; sw `8cd2c52e`; worklet `b65160e0`); pins 22 at 1bbfe2cf. This wave edits page-side
modules only; NO new module file; build.py js_parts UNCHANGED; worklet untouched.

## 1. Deliverables

1. **Autosave**: default ON after the first save (OFF on a virgin store), the user's explicit
   choice persists; `visibilitychange`→hidden flush; fingerprint coverage fix (dirty must flip on
   every surface avSessionCapture() snapshots).
2. **Projects**: Save reuses the stored FSA handle (permission re-grant flow); Save As (always the
   picker); RECENT projects (handle + meta in IDB, cap 8, reopen + forget); the PROJECT & SHARE
   card grows a recent list. (Boot templates = deferred; record honestly in the close if still
   deferred.)
3. **Session browser v2**: rows gain previews (engine kind · pattern bars · take count ·
   timestamps), user tags (additive), search + sort.
4. **Song Bundle**: new avpack item kind `song` carrying the project payload; a builder that
   collects project + referenced library items + user wt tables + user modules + installed-pack
   manifest refs; import applies the project; honest caps/refusals; ONE receipt.
5. **Backup coverage**: the backup zip gains av-samples-store + av-wt-store + av-code-store +
   the user prefs LS set (additive counts; restore side applies what it can, skips named).

## 2. File ownership (one writer per file; siblings must not overlap)

| # | files | work |
|---|-------|------|
| A | `src/av_session.js` + `src/av_session_ui.js` | autosave rules + visibility flush + fingerprint + browser v2 |
| B | `src/av_proj.js` + `src/av_files_ui.js` | handle reuse + Save As + recents + the recent list UI |
| C | `src/av_pack.js` + `verify/avpack_schema.mjs` + `src/av_backup.js` | kind `song` build side (BOTH sides) + backup coverage |
| D | `src/av_lib.js` + `src/av_import_ui.js` | the `song` item LOAD route + row action set |
| E1 | `verify/cdp_sessions.mjs` | autosave/flush/browser-v2 legs |
| E2 | `verify/cdp_s4.mjs` + `verify/cdp_hub.mjs` | recents legs + song-bundle round-trip |
| P | parent | styles, app_core version, gates, pins, deploy, live, close |

Children NEVER run build.py / git / browsers / suites. `node --check` on the child's OWN files is
allowed. Write-first (complete coherent edits on disk before polish). ASCII-only; `\uXXXX`
escapes in JS strings; no `*/` in block comments. Conflict clause: when a pin conflicts with live
source, the SOURCE wins — name it in the report, never silently diverge. Report shapes as plain
prose lists (no brace-template blocks). Keep every existing id/observable unless explicitly
changed here; extend snap/facade surfaces ADDITIVELY.

## 3. §A — sessions (autosave + browser v2)

- `avSessionAutosave(on, ms)` keeps its call/return shape (find the actual getter form in source
  and keep it working). NEW seeding law at init: autosave seeds ON when the store already holds
  >= 1 session (or the persisted choice is on); a virgin store seeds OFF. The EXPLICIT user choice
  persists (pick the storage per source — LS under the sessions keys or an IDB field; document
  which). After the FIRST successful `avSessionSave` while no explicit choice exists, autosave
  flips ON. An explicit off outranks the after-first-save rule.
- `visibilitychange` flush: on document hidden, if `auto.on === true` and the state is dirty, run
  the autosave write immediately (the same ONE `__autosave` record; then rearm). Guarded, silent,
  no throw; the handler reads `document.visibilityState` so rigs can stub it.
- Fingerprint coverage: `avSessionFingerprint()` must flip on every surface `avSessionCapture()`
  writes (params, macros/mod, pattern/steps, chains, song rows, scenes, prefs, takes). Audit both
  functions against each other; extend the fingerprint where it misses. Witness in the rig.
- Browser v2 (av_session_ui.js): rows gain a preview line (engine kind · bars/pattern length ·
  take count · savedAt/at) computed from the row meta (honest "--" when absent); `tags`: additive
  array on session meta (<= 8 tags, each <= 24 chars, lowercase-trimmed), inline editor in the
  row, persisted through the existing save paths; search input `#av-sessions-search` + sort select
  `#av-sessions-sort` (values: newest | name | updated; newest = the current order; name = the
  exact reverse-ish existing convention — mirror the import manager's sort conventions), client-
  side view filters over the row list; search matches name + tags. One shared rerender.

## 4. §B — projects (handle reuse · Save As · recents)

- NEW IDB `av-projects-store` v1 (pinned name): store `recents` (keyPath `id`; record {id, name,
  at, size, handle|null, via}) + store `state` (keyPath `key`; the `current` record {handle,
  name, at} for Save-reuse). Handles are structured-cloneable (the av_sources_store precedent);
  null when unavailable (fallback browsers).
- Save: when a current handle exists, try `queryPermission` then `requestPermission` — granted →
  write straight through (NO picker); denied/absent → the picker. Save As: an explicit
  `{ saveAs: true }` (or the source's opts shape) ALWAYS picks and becomes the new current. Save
  success upserts a recent (dedupe by name; cap 8, oldest rotated out).
- Open success upserts a recent with its handle.
- `avProjOpenRecent(id)` (name per source conventions; facade key pinned in the report): resolve
  record → permission → read → the existing open/apply path; honest refusal notes (never fake).
- av_files_ui.js: a RECENT section in the PROJECT & SHARE card: rows
  `[data-av-proj-recent="<id>"]` with OPEN + FORGET buttons (.mini), empty state, refreshed after
  save/open/forget. Fallback rows (no handle) render name-only; OPEN explains the picker fallback.
- The old "picker every save" behavior is superseded for Save ONLY; Save As keeps picker-always.

## 5. §C — Song Bundle (`song`) + backup coverage

- `AVPACK_KINDS` += `"song"` in av_pack.js AND verify/avpack_schema.mjs (BOTH-SIDES rule; the
  drift probe must stay green; extend fixtures; keep the CLI shape).
- NEW `avPackBuildSong()` (exact name pinned; facade key `song` on `window.__avPack`): ONE zip via
  the real avZipBuild (store method) containing: the current project payload as item kind `song`
  (name `project.anvl`, bytes = the avProjBuild text — bytes, not text) + library items referenced
  by the live sample slots (resolve slot entry names → library items, lowercase-basename law like
  kits) + ALL user wt tables (via the wt store's export fn) + ALL user modules (the code store's
  export fn) + a manifest listing installed pack ids (refs only — never pack bytes). Caps: the
  96 MiB item cap + a 600-item cap; over-budget → honest refusal naming the item. Receipt:
  {ok, bytes, name, counts {project, samples, wt, modules, packs}, refused [names]}.
- Import: the EXISTING zip pre-pass detects the pack (no av_import.js change needed — verify);
  the `song` item lands in the library; its LOAD route (D) applies the project.
- av_backup.js: extend the packed set to av-samples-store items + av-wt-store + av-code-store +
  the user prefs LS set (enumerate the user-facing keys from source; the docs count ~26 — list
  them in the report). Manifest names every entry; the reader/restore side applies what it can
  and reports named skips; keep the receipt shape additive.

## 6. §D — the `song` item route

- av_lib.js: the load dispatch gains kind `song` → apply via guarded `avProjOpenText(payload)`
  (the stored bytes → utf-8 text); receipt {ok, kind:"song", applied, warnings}; kind
  normalization sites accept "song" (audit avLibKindNorm + the row/action consumers).
- av_import_ui.js: the kind `song` row action set = LOAD (label LOAD; title "apply this song
  bundle's project") + REN + EXP + DEL (no SEND/CHOP/SEQ/RELINK extras); receipt/row shape
  otherwise unchanged; the manager view kind facet set stays as-is (song rows appear under
  "all"; note in the report if a chip is added).

## 7. §E — rig legs (keep counts recorded; freeze + zero-error legs last)

E1 `cdp_sessions.mjs`: keep 1e (fresh profile = autosave OFF — still true on a virgin store);
ADD: after the first avSessionSave the auto state flips ON (witness) + survives reload; an
explicit off persists; the visibilitychange flush (stub visibilityState=hidden via
defineProperty, dispatch a plain Event('visibilitychange'), witness lastAutosaveAt moves WITHOUT
the interval elapsing, restore the stub); browser v2: tags add/persist across reload, search
narrows, sort flips. Update any leg that now reads differently because of the default rule —
never loosen; if an old check depends on autosave-off-after-save, it was reading the OLD default —
update it to the new witnessed truth and say so in the report.
E2 `cdp_s4.mjs`: recents via the STUB fs seam (setFs — the av_sources rig precedent): save →
recent row appears; Save As performs a picker call (stub-counted); reopen recent applies; forget
removes; fallback (no handle) rows honest. `cdp_hub.mjs`: song-bundle round-trip — `__avPack.song`
build → the zip imports back (song row present) → the song row LOADs → the project applies (bpm +
pattern witness) → items land; a second import refuses/alerts honestly per the existing dup law.
Keep all freeze legs pinned (pins swept by the parent AFTER the wave freeze) + zero-error legs
last; record the new counts per rig.

## 8. Gates + close (parent)

smoke 78 (expected UNCHANGED — verify; only +1 if a check is truly needed) · cdp_sessions (new
count) · cdp_s4 (new count) · cdp_hub (49 -> 49+N) · platform 52 · import 24 · avpack_check
selftest + file · battery 25 + bench · pins sweep (22 files) · deploy (index + sw) · live probe ·
close addendum + commit. Styles block from the A/B/E class lists (sessions rows/tags/search,
projects recents list) appended to src/styles.css. app_core: ANVIL version 1.10.0 -> 1.11.0,
phase "R20 - work persistence".
