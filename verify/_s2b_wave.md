# Anvil S2.1 wave — TAKES & COMPING: take lanes · pick-best comping (lite) · trims + crossfades (2026-10-07)

Trigger: S2 SESSIONS closed (`31087322`; addendum 26). This wave completes the `docs/08` row **S2 · TAKES
& SESSIONS** — the takes half: **take lanes · pick-best comping (lite) · trims + crossfades** (keep-last-N
landed in S1). Next after this: S3 mix/master. Acceptance context (`docs/08` §1): "a full song — record
vocals over a groove, comp a take, mix, master, deliver stems".

## 0. Platform notes (no probe required)

Recording, lap splitting and WAV export are proven (S1: cdp_studio 37/37; takes export e2e). The rig
reuses the cdp_studio launch + fake-media flags (`--use-fake-ui-for-media-stream`,
`--use-fake-device-for-media-stream`; the fake device is a BEEP TRAIN — assert pips, never continuous).
No new platform capability.

## 1. Scope & file ownership (ONE writer per file)

| child | owns (write) | scratch |
|---|---|---|
| sa-A | `src/av_comp.js` (the comp engine: model · auto pick-best · trims · equal-power crossfades · render · export) | `cache/scratch/s2b/comp/` |
| sa-B | `src/av_comp_ui.js` (the Comp card: take lanes + comp segments + controls) | `cache/scratch/s2b/ui/` |
| sa-C | `verify/cdp_comp.mjs` (WRITE-ONLY rig; parent runs it) | `cache/scratch/s2b/rig/` |

Children never touch shared files (`build.py`, `src/body.html`, `src/styles.css`, `src/app_core.js`,
`src/av_takes.js`, `verify/cdp_smoke.mjs`, other `src/*`) and never run the build, browsers, suites or
git. Each self-verifies with a node harness in its scratch. READ-ONLY references: `src/av_takes.js`
(the takes store + model — note: the build concatenates all parts into ONE strict scope, so top-level
identifiers are shared; still guard every reach), `src/av_wavio.js` (avWavEncode/avWavInfo),
`src/av_studio_ui.js` (house card style + the take-row precedent), `src/av_session_ui.js` (newest card
conventions), `verify/cdp_studio.mjs` (rig skeleton + the lap-split flow).

## 2. Pinned interfaces

### 2.1 `av_comp.js` (sa-A) — the comp engine

```js
avCompInit() -> boolean
avCompList() -> [{ id, name, createdAt, segments, out: { frames, peak, rms, rate, channels } | null }]
avCompCreate(opts?) -> comp                    // { name? } -> fresh empty comp { id:'c1'..., segments:[] }
avCompDelete(id) -> boolean
avCompSetSegment(compId, index, patch) -> { ok, segment }      // patch: { takeId, fromFrame, toFrame, fadeIn, fadeOut }
avCompAddSegment(compId, patch) -> { ok, index }
avCompRemoveSegment(compId, index) -> boolean
avCompSegments(compId) -> [segment]
avCompAutoComp(compId, opts?) -> { ok, segments, regions }     // pick-best (lite) over the CURRENT takes
avCompRender(compId) -> { ok, frames, peak, rms, clipped }     // pure stitch -> comp.out (Float32 ch arrays)
avCompExport(compId) -> Promise<receipt>                       // WAV via avWavEncode; {ok,name,bytes,blob,url,wavInfo}
avCompState() -> { count, comps:[{id,name,segments,rendered}], takesSeen, lastError }
avCompClasses() -> string[]                                    // [] (the card owns markup)
window.__avComp = { version, init, list, create, del, setSegment, addSegment, removeSegment,
                    segments, auto, render, export: avCompExport, state,
                    pure: { xfadeGains(n), applyXfade(dst, dstOff, a, b, n), stitch(parts, opts) } }
```

**Model:** comp = { id, name, createdAt, segments: [seg], out }. Segment = `{ takeId, fromFrame,
toFrame, fadeIn, fadeOut }` (frames; trimmed, clamped to the take's length; defaults fromFrame 0,
toFrame take.frames; fades default `AV_COMP_FADE_DEF` = 240 frames ≈ 5 ms @48k, clamp 0..24000).
**The engine reads takes READ-ONLY** (the `avTakes` store object / `avTakesList()`; typeof-guarded;
never mutate av_takes state). Comp artifacts live in the engine (in-memory v1 — persistence = the WAV
export; document that comps do NOT ride session snapshots yet, as Undetermined/future).

**AUTO pick-best (lite), pinned intent:** regions = the lap grid of the LONGEST take: cycleFrames =
the median of full-lap (partial:false) take frames (fallback: longest take frames; fallback: whole
take = one region). Region r covers [r·cycle, min((r+1)·cycle, take.frames)). Score(take, r) =
rmsOf(region) × (peakOf(region) ≤ 0.98 ? 1 : 0.5) — highest wins; ties → earlier take; empty/short
regions skipped. Segments = one per region (takeId of the winner + the region range). The numera
are pure and MUST be exposed for the rig: `window.__avComp.pure.xfadeGains(n)` returns the
equal-power gain PAIR arrays [{g1},{g2}] over n frames (cos/sin quarter-wave; g1[0]=1→0, g2[0]=0→1;
g1²+g2²=1 within 1e-6), `pure.applyXfade(dst, dstOff, a, b, n)` mixes two windows sample-exactly,
`pure.stitch(parts, opts)` is THE render path (render() calls it).

**Render (pure stitch):** concatenate segment windows in order; each seam = equal-power crossfade of
`max(fadeOut(prev), fadeIn(next))` frames (clamped to the shorter segment); 2 ms anti-click fade at
the comp's outer edges; output channels = per-channel stitch of the take data (mono duplicated to
stereo at export, the av_takes convention). Allocation at render time only; never throw; honest
refusals when takes/segments are missing.

### 2.2 `av_comp_ui.js` (sa-B) — the Comp card

```js
avCompUiInit() -> boolean   // mounts into #av-comp-host (absent -> false, no throw; idempotent;
                            // dataset marker avCompUiWired='1')
avCompUiClasses() -> string[] · avCompUiSync() -> boolean · window.__avCompUi { state, sync, ... }
```

Card (class prefix `av-comp-*`, reuse av-btn/av-note/av-dim/av-select; event delegation; the S1/S2 card
house style):
- **LANES** — one lane per take from `avTakesList()`: `.av-comp-lane[data-take]` with name · lap ·
  seconds and a timeline bar (width ∝ take.frames / longest; partial laps marked). Lanes are the trim
  surface: per-lane SHOW trimmed range (from/to readouts; the trim edit surface itself = the segment
  rows below, lanes reflect it).
- **COMP** — comp select (or implicit single comp, created on demand), SEGMENT rows:
  `.av-comp-seg[data-idx]` — take id · range · fades · REMOVE; ADD SEGMENT (from the selected lane);
  AUTO-COMP button (`avCompAutoComp` — pick-best lite; reports regions chosen); RENDER + EXPORT WAV
  (via avCompRender/avCompExport; export uses the anchor-blob technique from av_deliver_ui);
  fade length input (ms) applied to new segments.
- Status line + warnings area (never console noise); honest degraded notes when av_comp/av_takes are
  absent. A light poll (~1.2 s, signature-gated) is fine for takes-changed repaints.

### 2.3 Rig `verify/cdp_comp.mjs` (sa-C writes, parent runs)

Launch skeleton VERBATIM from `cdp_studio.mjs` (fake-media flags INCLUDED); `EXPECT_SHA` null until
pinned. Proofs:
1. boot + card mounted (#av-comp + #av-comp-host · `.av-comp` root · wired marker · controls present).
2. takes: record two quick takes via the avTakes path (fake-device beeps; lapSync false) — at least
   two takes with distinct lengths present (rig-evidenced frames).
3. comp build: `avCompCreate` + `avCompSetSegment` (take A full range) + render → frames === take A
   frames ± 0; export → avWavInfo ok 16-bit/48k + blob/url + decodes NON-SILENT (beeps; peak > 0.05).
4. multi-segment + trims: segments [take A 0..N/2, take B 0..N/2] → render frames ≈ N; set trims
   (shrink a segment) → re-render frames shrink by exactly the delta; clip clamp: an oversized
   toFrame clamps to the take length (no throw).
5. crossfade math (pure, rig-owned): `pure.xfadeGains(n)` — g1²+g2² ≈ 1 everywhere (≤ 1e-6), monotone
   pair; `pure.applyXfade` on synthetic constant signals mixes exactly (a=1s, b=0s → output = g1);
   `pure.stitch` deterministic (two calls → identical bytes).
6. lap auto-comp: rig pattern + avSeqPlay + lapSync takes over ~2.5 cycles → 2+ lap takes →
   `avCompAutoComp` → segments ≥ regions; render frames ≈ min(longest take frames, regions·cycle);
   the winning takeIds are the longer/cleaner laps by the pinned metric (rig computes the expected
   winner from its own rms/peak reads of the same regions — real digests, never planted values).
7. zero page errors · screenshot `renders/s2b-comp-suite.png` · freeze sha256 before === after ·
   page left clean (takes deleted, comps deleted, transport stopped, input disabled).

## 3. Laws (wave-specific)

1. One writer per file; 'use strict'; ONE namespace per file (`avComp*` / `AV_COMP_*` — sa-B owns
   `avCompUi*`; the shared-scope reach to `avTakes` is READ-ONLY and typeof-guarded).
2. Node-loadable (no DOM/browser reach at load); NEVER throw (honest refusals, counted skips); no
   console noise; forward-slash paths in scripts.
3. Comp math is PURE at its core (`pure.*`) — the rig checks the math directly; render() is the only
   allocation-heavy path and runs on demand only.
4. Fades: equal-power (cos/sin) — pinned, rig-verified on synthetic signals before trusting seams.
5. The card never mutates comp state directly — pinned API only; repaint from the engine's reads.
6. Children self-verify with node harnesses; the browser rig is the parent's gate.

## 4. Parent integration (after children land)

ONE counted-assert script (`cache/scratch/s2b/integrate/_s2b_integrate.py`): build.py js_parts
(`av_comp` → `av_comp_ui` after `av_session_ui`, before `av_synth`) · body `#av-comp` card + host
after `#av-sessions` (+ hero/footer copy) · styles block (child class lists, coverage-checked) ·
app_core guarded `avCompInit()` → `avCompUiInit()` + version **0.9.0 "S2.1 · takes & comping"** ·
`cdp_smoke.mjs` comp-card check (→ 20) · rebuild → node re-runs + `cdp_comp.mjs` first run (pin
EXPECT_SHA; re-run) → FULL battery (ALL pinned suites — 13 incl. sessions/studio; re-pin all) →
PERF GATE (bench + stress ×2, hidden-detached; if the machine is still loaded, record raw + note the
carried quiet re-run) → commits + addendum 27.

## 5. Watch items

- Takes data reach: the build's single strict scope exposes the `avTakes` store object top-level —
  reach it behind `typeof` guards; if a cleaner accessor exists in av_takes.js, prefer it and note
  which was used in the report.
- Lap takes from `lapSync` carry `partial:true` on the tail — auto-comp regions must handle partial
  takes by clamping (no padding, no throw).
- The beep-train fake device: trimmed/crossfaded renders stay beep-train-shaped — assert pips
  (peak > 0.05), never continuous audio; crossfade checks on synthetic signals stay in `pure.*`.
- Comp memory: one rendered comp ≤ sum of its segments (Float32); cap render at 5 minutes output,
  refuse beyond (honest).
- The card must not start recording — it edits comps from EXISTING takes only (the Studio card owns
  recording).

Carried: quiet-window bench re-run (S2 gate ran loaded; A/B-attributed) · S3 mix/master (sends #69 ·
master chain #70 · LUFS auto-mix #49) · deck (#15) · popout keyboard · CODE (#81) · walkthrough/help
(#20/#45/#80) · max modules · platform (share/cloud/PWA/FSA/bridges/video) · P7 polish + deploy +
owner pass · P·2 minBLEP pass · P4 follow-ups · PERFECT TUNINGS.
