# E wave contract — ENGINE EDGE (explicit acid accent flag + P.2 minBLEP cost-optimisation pass)

Owner scope: the two engine-side owed items after the R17-R21 program closed.
1. The recorded P4 follow-up decision "acid accent-flag mapping": a step's accent flag must be
   the explicit truth for SEQUENCED notes — today a NON-accent step at the core default
   velocity 0.8 also enters the AVACID accent path (av_acid.js: `acc = (v.vel >= 0.8) ? 1 : 0`),
   so the ACC column barely matters at default vel. DECISION (recorded here): the scheduler
   emits an EXPLICIT accent flag per note; av_acid honours the flag when present (0|1) and
   falls back to the legacy velocity threshold when absent (keyboard/MIDI/legacy paths stay
   bit-identical). The P2 accent-memory numeric tests keep their legacy path unchanged.
2. docs/07 batch-4 P.2: minBLEP cost-optimisation pass — reduce the minBLEP oscillator's
   steady cost (~+20 % since P1.x; hot unison-7 stress windows) while every alias gate stays
   green and the audio remains output-preserving.

State at open: T wave must be CLOSED first (its frozen sha fills in below at open time).
This wave changes the WORKLET again by design (av_dsp + av_acid edits) — record both shas.

## 1. Deliverables

1. `src/av_acid.js`: accent predicate reads the explicit flag when the voice carries it
   (0|1), else the legacy `v.vel >= 0.8` threshold. The decision + exact predicate go in the
   file header.
2. `src/av_seq_sched.js`: the DOWN emission passes `opts = { acc: ev.flags.accent ? 1 : 0 }`
   (merged with the T-wave `tune` slot when present) through `avNoteDown(ev.note, ev.vel,
   undefined, opts)`.
3. `src/av_seq_acid.js`: the lane's mapping mirror (`avSeqAcidAccEnters` + header) updated to
   the new truth (explicit flag for sequenced notes; legacy vel threshold documented for the
   non-seq path); its node harness re-run.
4. `src/av_dsp.js`: the minBLEP cost-optimisation pass. OUTPUT-PRESERVING by construction is
   the bar: the node harness must show the SAME render digest before/after; if a candidate
   cannot be bit-identical, it is out of scope (report the rejected candidates).
5. `verify/cdp_seq.mjs`: new accent legs (see §3).
6. Records: a node micro-bench (render-time before/after at the harness's fixed voice count),
   and the alias rig + bench + stress re-runs (parent).

## 2. File ownership

| # | files | work |
|---|-------|------|
| EG | `src/av_dsp.js` | minBLEP cost pass ONLY (+ nothing else in the file) |
| EH | `src/av_acid.js` + `src/av_seq_sched.js` + `src/av_seq_acid.js` | explicit accent flag semantics + sched emission |
| ER | `verify/cdp_seq.mjs` | accent legs + audit of existing expectations |
| P | parent | alias/bench/stress gates, battery, pins, deploy, live, close |

Conflicts: EG and EH are disjoint files — parallel safe. Both wave-T-frozen lineage: start
from the T-closed tree (pull the exact frozen sources; do not rebase anything yourself).
Children NEVER run build.py / git / browsers / suites; node --check + own scratch harnesses
under `cache/scratch/e/<child>/` allowed; write-first; ASCII-only; source wins on conflicts —
name them.

## 3. Pins

av_acid.js (exact site ~L187): `const acc = (v.vel >= 0.8) ? 1 : 0;` becomes
`const acc = (v.acc === 0 || v.acc === 1) ? v.acc : ((v.vel >= 0.8) ? 1 : 0);`
(v.acc comes from the T-wave plumbing: opts.acc, else -1 sentinel; verify it landed —
if the sentinel differs, adapt to the landed truth and note it). Everything downstream of
`acc` stays untouched. Header: add the decision note.

av_seq_sched.js: at the emission site, build ONE opts object; include `tune` ONLY when the
guarded avTuneTrackSlot lookup returned an int 0..7 (T-wave pin); ALWAYS include
`acc: ev.flags.accent ? 1 : 0` from the step flags. Keep every other behaviour exact.

av_seq_acid.js: update the mirror comments + `avSeqAcidAccEnters` semantics: for sequenced
notes the flag is authoritative; the function keeps reporting the legacy predicate for
GENERAL gain values (it is a pure legacy-vel helper — decide the cleanest honest shape,
document it, keep the node harness green).

EG — minBLEP pass, the disciplined way:
1. FIRST build the harness (scratch) + capture the BASELINE: render digests (bit-exact hash
   of output buffers for 2-3 fixed patches incl. a unison-7 case) + relative timings, on the
   UNTOUCHED file.
2. Then optimise inside the oscillator path only. Candidate classes (choose by profile, prove
   each on the harness): hoist loop-invariant lookups out of per-sample loops; replace
   property/array-of-object accesses with flat typed-array reads; unroll the residual-deposit
   inner loop where it stays bit-identical (order of float additions MUST NOT change — that
   is what bit-identity protects); short-circuit genuinely-dead branches (e.g. deposit skip
   ONLY where the skipped value is exactly 0 and the deposit is provably a no-op).
3. After each candidate: digest equality + timing delta. Stop when improvements plateau;
   report the final numbers and every rejected candidate with its reason.
4. The alias rig (parent-run) is the audio gate; the bench is the publishable metric.

ER — cdp_seq.mjs legs (numbers continue the suite's sequence; the pin leg stays last):
- accent witness (flag on): one-step acid pattern, flag 1 -> master-tap peak on the witness
  analyser materially above the flagged-off render (AVACID ampBoost + env changes); assert a
  ratio threshold measured on the first real run (record raw; never loosen later).
- default-vel unflagged witness: vel 0.8 step, flag 0 -> NO accent (peak within a small band
  of the vel-0.5 unflagged render — i.e. the old auto-accent is gone; measure + pin).
- legacy path: a direct avNoteDown with no opts at vel 0.9 still accents (this pins that
  keyboard/MIDI behaviour did not change); witness via the same peak method.
- audit EVERY existing seq check for the old implicit accent assumption; fix expectations to
  the DECISION (never loosen; record each as a rig SPEC note).

## 4. Gates (parent)

rebuild -> node --check + sha -> smoke -> cdp_seq (first run + SPEC fixes) -> cdp_alias
(gates: VA worst <= -45 dBc, WT <= -80 dBc — numbers must not regress; T-wave lineage
compared) -> pins sweep -> FULL battery -> bench (knee + %) + stress x2 (the P.2 target:
measurable stress headroom improvement; record raw) -> deploy (index + sw) -> live verify
(scoped --verify = 0 not in sync; live sha = frozen) + a live audio probe on the acid accent
-> addendum + commits. Worklet sha change recorded (T sha -> E sha).

## 5. Watch-outs

- The bounce determinism suites consume the engine: if any fixture renders acid default-vel
  steps, its expected audio changes BY THE DECISION — the rig update is a SPEC change to the
  new truth, recorded, never a loosened check. Audit cdp_bounce + cdp_mix fixtures.
- The bench environment law still applies (attribution via offline A/B against the T-frozen
  bytes when the knee moves; the worklet changed, so compare with the T freeze, not older).
- Do not touch anything else in av_dsp.js beyond the oscillator path + zero comments needed.
- If a truly bit-identical optimisation proves impossible, STOP and report — the fallback is
  to keep the current code and record P.2 as attempted with evidence (owner-visible honesty),
  not to ship a sound change without the gate.

## 6. Report shape

Per §11 of the T contract: files, lines, exports touched, evidence (harness digests + timing
tables + logs), deviations/conflicts, integration seams. Plain lists, no template braces.
