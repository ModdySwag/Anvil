# Anvil P1.x — minBLEP "Classic" oscillator + margin policy: fix-wave contract (2026-10-07)

Trigger: P1 close-out (addendum 11) — aliasing gates NOT met on 08e3c38f. Owner said GO.
Goal: close the aliasing gate so docs/03 P1's "aliasing gates met" can eventually be claimed:
VA square/pulse at ≤ −45 dBc (C4/A4/C6), saw C6 resolved or documented, WT real spurs ≤ −80 dBc
(post metric amendment), no regressions, determinism + cost recorded.

## 0. Ground truth

- Findings + exact table: `verify/last-cdp_alias.log` (v3 run on 08e3c38f). Summary: VA square
  −44.4/−39.5/−32.6, pulse −42.9/−37.7/−30.9 dBc (FAIL all); saw C4/A4 pass (−52.8/−48.6), saw C6
  −39.8 (23rd harmonic 24.07 kHz folds via the halfband transition 24.0–26.9 kHz); WT wt.saw/square/
  pulse25@A4 −46.8 (harmonics 55–64 in the transition band); tri/sine clean. Determinism PASS.
- Root causes: (1) polyBLEP residual for harmonics ≥ 48 kHz in the 2× domain (square/pulse — the
  dominant audible failure, folds land across the band); (2) decimator transition band 24.0–26.9 kHz
  folds partially-attenuated content (saw C6, WT A4). Exactly T5 §8's predicted polyBLEP ceiling.
- The fix per the plan docs: minBLEP "Classic" oscillator (T5 §8/§10; Brandt, ICMC 2001, hard-sync
  paper — METHOD reference only, implement clean-room) + mip/decimation margin policy.
- The −80 dBc WT gate needs a measurement amendment (v3 rig's ±3-bin Blackman leakage floor ≈ −57 dBc,
  proven synthetic): the node harness below uses a 4-term Blackman-Harris window (sidelobes ≈ −92 dB)
  so −80 rows are evaluable. Parent will amend the browser rig the same way on integration.

## 1. File scope (this wave)

- EDIT: `src/av_dsp.js` ONLY within the engine (`AVDSP` internals): the VA oscillator core (saw/
  square/pulse → minBLEP), the WT mip-selection margin, optionally the halfband constants (only if a
  better set is designed + verified first, see §3c). Public API surface UNCHANGED (create/noteOn/
  noteOff/allOff/setParam/render/stats/bench*/recordQuantum/tableInfo; additive-only if truly needed).
  `AVDSP.version` becomes "p1.1". Determinism (seeded PRNG) and the alloc-free render law stay.
- MAY EXTEND: `research/engine/hb_design.py` (decimator redesign search only; re-run via
  `uv run --no-project --with numpy --with scipy python research/engine/hb_design.py`).
- SCRATCH (never in repo): the node harness + probes under
  `C:\Users\Moddy\AppData\Local\hermes\profiles\deepseek\cache\scratch\blep\`.
- NEVER touch: av_voiceproc.js, av_engine.js, av_synth.js, build.py, index.html, verify/*, git;
  never run a browser. (Parent rebuilds + re-runs rigs.)

## 2. The minBLEP oscillator (pin)

Structure (the efficient standard form — implement clean-room from the method):
- Per oscillator slot (each unison sub-osc of osc1/osc2/sub), a small correction delay line
  ("blep ring") of length L, preallocated; output = naive waveform + ring[n mod L]; the ring is
  advanced by one each sample (1 add/sample).
- At a waveform discontinuity of size J at fractional position p (0..1) between samples n and n+1:
  for i in 0..L-1: ring[(n + 1 + i) mod L] += J * TAB[sub(p)][i]. Cost only at edges.
- TAB: precomputed residual = (band-limited step response − ideal step), 256 sub-positions × L taps;
  L ≈ 32; constructed DETERMINISTICALLY in buildTables() from a Blackman-Harris-windowed sinc step
  response (one-time; document the construction in comments; no third-party tables — build it from
  the math). The harness calibrates SIGN/ORIENTATION and confirms the residual decays to ~0.
- saw: naive 2t−1 with one edge/cycle (jump +2); square: ±1 with two edges (jump ∓2); pulse(d): same
  with the d-edge (jump ∓2 at t=d). tri/sine: UNCHANGED (naive tri is clean; sine LUT). sub square:
  minBLEP as well (same code path); sub sine unchanged.
- Memory: L×u floats per osc slot (u ≤ 7) — acceptable; keep voice objects monomorphic (init all
  fields in create()/reinit).
- polyBLEP code: remove once minBLEP is in (dead code does not ship).

## 3. Margin policy + decimator (pin)

a. WT mip selection: candidates — current `k = clamp(ceil(log2(3072·f0/fs2)), 0, 10)` lets the top
   harmonic reach 28.2 kHz (inside the transition band). New rule must place the top harmonic safely
   BELOW the decimator's stopband edge, e.g. `if (H_k·f0 > 25.0 kHz for the selected k) k += 1` —
   choose the exact threshold by MEASUREMENT (harness) so every WT row ≤ −80 dBc @ BH window, while
   not dropping brightness more than necessary (A4 k=4→5 is expected; C4 must stay k=4). Report the
   final rule + each wave's chosen levels.
b. VA side: minBLEP alone should carry square/pulse to the gate; VERIFY at C4/A4/C6, full band.
   If any row still exceeds −45 dBc in the AUDIBLE band (< 20 kHz), iterate (taps/subs/window).
c. saw C6's −39.8 fold at 23.93 kHz is the decimator transition band, not the osc. OPTIONAL: search
   a sharper halfband (extend hb_design.py; candidate transitions narrower/lower, order ≥ (4,4));
   swap the constants ONLY if the search proves ≥ ~20 dB better at 24–27 kHz and the node harness
   shows the saw C6 row improved. If a full-band ≤ −45 is not reachable at reasonable cost, do NOT
   force it: report the number and the (inaudible, >20 kHz) frequency context — the parent proposes
   the documented metric amendment to the owner.
d. Cost: record every design decision + est. added flops; keep an eye on the voice budget (128 voices
   @ 38.7 % today — the wave should stay within a small delta; parent re-runs the bench).

## 4. Node harness (scratch) — the acceptance instrument

Write `scratch/blep/alias_node.mjs`: loads src/av_dsp.js text in node (concat + eval, like the K-style
sanity rigs), and for each case renders 3 s of one held note (sustain 1, filter lp12 cutoff 20000,
reso ~0, one osc alone) via AVDSP.render at 48 k, then: 4-term Blackman-Harris window, 2^17 radix-2
FFT, worst NON-harmonic spur in dBc (mask ±3 bins per harmonic; ignore < 20 Hz) — the SAME metric as
the browser rig, plus the same old-Blackman numbers for continuity with last-cdp_alias.log.
Cases: VA saw/square/pulse(0.3)/tri/sine @ C4 261.63 / A4 440 / C6 1046.5; WT bank (5) @ same;
44.1 k spot (saw C4 + wt.saw A4); determinism pair (two fresh engines → bit-identical).
Paste the full table (old window + BH window) in the report. Iterate until §5 holds or you can
prove a row cannot reach the gate at sane cost.

## 5. Acceptance (what "done" means for this child)

1. Harness table: VA square + pulse ≤ −45 dBc (BH) at C4/A4/C6; saw ≤ −45 at C4/A4; saw C6 either
   ≤ −45 or explicitly documented with its >20 kHz fold context; tri/sine unchanged or better.
2. WT rows: real spurs ≤ −80 dBc (BH) after the margin fix; no row left floor-limited above −80.
3. Determinism pair bit-identical; render alloc-free; zero NaN; the K-style node sanity behaviors
   (silence zeros, envelope drain, zero-crossings, setParam, steal) still hold.
4. Raw evidence: harness commands + full outputs; every design decision + deviation listed.

Report: {files, version, minblep:{taps, subs, construction}, marginRule, decimator: {kept|swapped,
numbers}, tableBH: 'case: dBc …', tableBlackman: 'case: dBc …', cost:{flopsDelta, notes}, sanity,
deviations[]}.

## 6. Parent continuity (after this child returns)

1. Verify diff + node checks → rebuild (`python3 build.py`) → new sha.
2. Browser rig v2: amend `verify/cdp_alias.mjs` to the 4-term BH window (documented as an amendment),
   re-run → gate table; also re-run battery (smoke/feel/keys/midi) + `node verify/cdp_bench.mjs
   --offline-only` to refresh the published cost number (voice count expected to hold ≥ ~120).
3. Commit wave + docs (addendum 12); owner report.

## 7. Close-out record (2026-10-07; continuation addendum 12)

Re-verify on frozen 56734133: alias rig v2 (BH4 amendment) 30/30 PASS — VA worst −58.18 dBc, WT worst
−91.21 dBc; saw C6 −58.99 (was −39.8). Battery 11/18/27/33. Bench: offline 128 @ 47.6 % (minBLEP
≈ +20 % steady); realtime light 64×3 stable, fat 64 marginal → rig published fat 48. Stress ×2:
`asserts-not-met` both runs — ONE verified-window delta, identical cold-start entry in each (cycle 1
@ uni 3, first 15 s), plus hot uni-7 over-drive windows (by design beyond the envelope); all other
dimensions green. Cost-optimisation pass recorded as P·2 (docs/07 batch 4). Evidence:
`last-cdp_alias.log`, `bench-v4-p1x-full.*`, `stress-p1x-run{1,2}.log`, `p1x-node-alias-out.*`.
