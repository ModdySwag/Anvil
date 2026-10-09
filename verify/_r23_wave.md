# R23 wave contract — ENGINE FILTER: a usable filter stage for the synth engine kinds

Owner ask (2026-10-09): "check what happened to the filter... seems to be missing" -> "add the
filter to the synth engine section".

State at open: R22 closed + live (frozen `183d1588`, app 1.14.0). D wave (desktop) in flight --
it touches windows/ and drafts only, never src/ or verify/.

Parent recon at open (evidence):
- Synth card: the VA panel (default kind) shows the engine filter (filter.mode pick +
  CUTOFF/RESO/ENV AMT knobs). The ACID panel has its own 303 filter knobs. The string / drum /
  grain / sampler panels show NO filter controls; fm shows a note only.
- DSP: the shared filter (eng.cCutoffLog2/cReso, fed by filter.cutoff/reso) is applied inside the
  VA voice core (voiceStep2x: osc mix -> drive -> ladder/SVF). Kind voice cores (registerKind
  1..5; user kinds >= 64) run their own DSP and never pass through it.
- Git: the filter group has existed since P1 and was never removed -- the other engines simply
  never had filter stages.

## Design pins (house laws)

1. ONE new engine param `filter.on` (0 | 1), DEFAULT 0. It gates ONLY the new kind filter stage.
2. The VA and ACID paths are UNCHANGED, bit-for-bit (their cores and params are not touched).
3. New kind stage: after a kind voice core yields its sample (per 2x step), apply the EXISTING
   shared filter machinery -- the SAME coefficient recompute the VA core uses (recomputeFilter
   already runs for every voice) and the same per-voice SVF/ladder state application -- when and
   ONLY when `filter.on === 1`. At filter.on === 0 the stage is SKIPPED ENTIRELY: bit-identical
   output for every existing kind sound (the FX "all-off = bit-identical" precedent).
4. The kind filter shares the SAME settings params: filter.mode / filter.cutoff / filter.reso /
   filter.envAmt (one engine filter, one set of values).
5. This is a WORKLET change by design (av_dsp.js is embedded; the worklet sha will change). All
   prior bit-exact claims hold for: va/acid paths unchanged + every kind at filter.on=0.

## Deliverables + file ownership

| # | files | work |
|---|-------|------|
| A | `src/av_dsp.js` | audit each kind voice core (where it produces its 2x sample; where the shared per-voice filter state/slots live; the alloc-free place to apply the gated stage) THEN implement the filter.on-gated kind stage. Report an audit table + exact edit set. |
| B | `src/av_synth.js` | `filter.on` default 0 in avSynthDefaults; add a FILTER group to the string / drum / grain / sampler panels -- an ON toggle knob (0/1) + mode pick (filter.mode) + CUTOFF / RESO / ENV AMT with the SAME specs as the VA group. FM: only if A's audit shows the fm kind has a voice core that lacks filtering -- otherwise leave fm unchanged. VA + ACID panels untouched. |
| C | `verify/cdp_smoke.mjs` | additive synth-card checks: for each of the string/drum/grain/sampler panels the FILTER group is mounted with bound knobs (match the CONTRACT pins; keep every existing check byte-identical). |
| P | parent | integration, the bit-identical harness (old vs new worklet bytes: every kind at filter.on=0 -> identical digests; VA/acid legs identical), rebuild, pins sweep, triage, battery, deploy, close. |

## Watch-outs

- A: keep it alloc-free and 2x-rate-correct (the stage runs inside the per-voice step); reuse the
  existing per-voice slots (v.a1/a2/a3/ic1a/ic2a/ic1b/ic2b/fk/lad, filled by recomputeFilter);
  prime state on note start like the VA path does; never touch the va/acid code or their params.
- A: ALSO report (no fix): what the synth card shows when a USER kind (>= 64) is selected -- if
  no panel matches, note the blank-panel hole in the report.
- B: keep the engine pick + every existing row byte-identical; the new group is append-only per
  panel; the ON knob is `filter.on` with min 0 max 1 step 1, fmt int, def 0, labels per house
  look (ON). Reconcile the VA group's exact specs from AV_SYNTH_ROWS before writing.
- C: smoke's existing count checks are >= based -- additions keep them valid; extend, never
  loosen.
- All children: static checks only (node --check; A may write + RUN a scratch node harness under
  cache/scratch/ to sanity-check its math -- the parent re-proves bit-exactness end to end).
  Write-first. ASCII-only. One writer per file. Source wins over a pin -- name it.

## Report shape

A: audit table (per kind: core fn, line refs, state slots, where the stage lands) + edit set +
node --check + harness notes. B: edit set + node --check + per-panel knob inventory. C: new check
list + node --check + the new total.
