# Anvil P5.2 — content wave: BASS FORGE · LEAD LAB · FX & RISERS (2026-10-07)

Trigger: P5.1 closed (372/372 verified, commit `da1f962`). P5.2 = Phase 3 of the T8 §12 authoring
order (`research/packs/T8-content-packs.md` rows 7-9). After this wave: **548 presets / 9 packs**;
PERFECT TUNINGS stays blocked on the tuning engine.

## 1. Scope (PIN)

| child | deliverable | presets | design (T8 row) |
|---|---|---|---|
| sa-0 | `packs/bass-forge.avbank.json` | **64** | Subs, reeses, FM/VA hybrids, acid crossovers (VA + sub + filter env + drive + acid voice) |
| sa-1 | `packs/lead-lab.avbank.json` | **64** | Unison leads, supersaws, FM/PD leads, expressive solos (PolyBLEP VA, unison, FX rack, macros) |
| sa-2 | `packs/fx-risers.avbank.json` | **48** | Sweeps, impacts, downlifters, noise-art, transitions (noise sources, filter sweeps, delays, reverb, pitch env) |

Format, witness and gates INHERIT `verify/_p5_wave.md` §1/§2 unchanged. Child law identical to
`verify/_p5b_wave.md` §2 (read it): canonical self-verify `node verify/verify_avpacks.mjs --only <id>`
until every preset PASSes; write ONLY your pack + scratch
`C:\Users\Moddy\AppData\Local\hermes\profiles\deepseek\cache\scratch\p5c\<name>\`; no `seq` fields; no
random seeds; meta per the shipped packs; path/enum/hard-bound truth = `verify/av_bank_schema.mjs` +
the module `setParam` switches. Single-kind routing law (learned in P5.1): a preset is ONE engine
kind — "hybrid" = layered params of that kind + FX, documented in meta.description.

## 2. Parent integration (after the children land)

1. FULL canonical verify: `node verify/verify_avpacks.mjs` → expect **548/548** (9 packs).
2. `node verify/verify_avpacks.mjs --index` → regenerate `packs/index.json` (9 packs).
3. Commit + addendum 23. **NO rebuild / battery / pins** — `index.html` untouched (runtime data;
   the canonical verifier is the wave gate).
4. Carried: P·2 minBLEP pass · P4 follow-ups · PERFECT TUNINGS (tuning engine) · the GOLDEN BUILD
   studio waves (docs/08) then P6-P7 (share/cloud/polish/deploy + owner pass).
