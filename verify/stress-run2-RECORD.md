# Stress run 2 — result record (2026-11-10)

**Why this file exists:** the run's live log (`verify/stress-run2.log`) was truncated at 12:07:55
when a mis-armed watcher (`gatewait.ps1` launched with `-QuietCpuSec 999`, which its `-lt`
comparison read as "always quiet") fired a fresh rig into the same file. The numbers below are
transcribed verbatim from that run's console output, captured before the truncation.

## Conditions — NOT a quiet box
Discord bot job was running throughout (owner confirmed mid-run: "the machine wasnt quiet my
discord bot was running a job"). Ambient CPU measured by `cpuwatch.ps1` across the same window:
9.19 / 4.78 / 29.67 / 51.59 / 20.48 CPU-seconds per 10 s tick — i.e. peaks around 5 cores busy.

## Frozen bytes
sha256 `d206eec2359719613284dae2867ff67f9a35fa4a0c804c133fa9537a4ce6b412`, 6,141,970 B (index.html)
Runtime: worklet/blob, sr 48000, maxVoices 64, 27 cycles, cap reached 27x, maxHeld 64,
notes +3564/-3564, knob commits 1191, driver errors 0.

## Asserts
```
heap growth: 0 MB (first 14.6 / max 14.6 / last 13.1; limit 60 MB) -> PASS
underrun deltas at cap: verified-envelope FAIL - strict(all-cap) FAIL
  (total delta 47 over 41 intervals; nonzero 8; at-cap 8
   [verified-window 1 - uni>3-window 7]; outside-cap 0)
pool drains: PASS (15 checks; worst 162 ms; 15/15 ok)
page errors: PASS (0)
ctx.state over all samples: PASS (running)
cap coverage: PASS (cycles 27; cap reached 27x; maxHeld 64; notes +3564/-3564; knob commits 1191; driver errors 0)
```

### The single in-envelope offence
```
VERIFIED-ENVELOPE deltas:
[{"from":0,"to":15,"delta":7,"wins":[{"cycle":1,"uni":3,"start":6644,"end":18644}]}]
```
One interval: t=0 to 15 s — the cold-start window, the first 64 voices ever built. Every later
interval in the asserted envelope (uni <= 3) was clean.

### The labelled over-drive probe (uni 7, reported not asserted)
```
[{"from":45,"to":60,"delta":18,  "wins":[{"cycle":3,"uni":7,...}]},
 {"from":60,"to":75,"delta":15,  "wins":[{"cycle":3,"uni":7,...},{"cycle":4,"uni":1,...}]},
 {"from":225,"to":240,"delta":1, "wins":[{"cycle":11,"uni":7,...}]},
 {"from":240,"to":255,"delta":1, "wins":[{"cycle":11,"uni":7,...}]},
 {"from":405,"to":420,"delta":2, "wins":[{"cycle":18,"uni":2,...},{"cycle":19,"uni":7,...}]}]
```

## Comparison against run 1 (also contended, same bytes, 1 hour earlier)
| | run 1 | run 2 |
|---|---|---|
| total delta | 613 | 47 |
| in-envelope intervals | 3 | 1 |
| in-envelope deltas | 11 | 7 |
| mid-run in-envelope deltas | 10 (cycle 13) | 0 |
| largest single interval | 346 (cycle 11, uni 7) | 18 (cycle 3, uni 7) |

Run 1's 346-delta burst did **not** reproduce in run 2. Render time at that burst was
mean 1496 us / p95 2000 us / max 2000 us against a 2666.7 us quantum — the audio render never
exceeded its budget, which points at the thread being descheduled (external CPU contention),
not at engine cost.

## Verdict
Gate **not met** as written (zero-delta assertion). But this is a measurement of a machine under
5-core contention, not a measurement of the build. The only reproducible in-envelope deficit is
the cold-start window. A zero-delta gate run still requires an idle box.
