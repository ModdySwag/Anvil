# Anvil P5.1 — content wave: NEON STRINGS · BLADE PADS · DEEP SPACE (2026-10-07)

Trigger: P5 closed (frozen `1c2f112c`, battery green, perf gate recorded — addenda 20-21). P5.1 =
Phase 2 of the T8 §12 authoring order (`research/packs/T8-content-packs.md` rows 4-6).

## 1. Scope (PIN)

| child | deliverable | presets | design (T8 row) |
|---|---|---|---|
| sa-0 | `packs/neon-strings.avbank.json` | **48** | Karplus/plucked strings: nylon, koto, prepared, glass; some presets pair Karplus with WT tables; reverb/tone shaping |
| sa-1 | `packs/blade-pads.avbank.json` | **56** | Ensemble pads: formant-saw, wide unison, slow swells; chorus/detune/reverb |
| sa-2 | `packs/deep-space.avbank.json` | **40** | Drones/additive: morph tables, spectral beds, sci-fi textures; generator-assisted + hand polish |

Format, witness and gates INHERIT `verify/_p5_wave.md` §1 (pinned `.avbank.json` format) and §2
(the witness the canonical verifier implements) — unchanged, single source of truth. This wave:
**no `seq` fields** (patterns stay with acid-vault/techno-foundry). Meta per the shipped packs:
`{name, author:"MODDYS Foundry", license:"CC0-1.0", tags, description, engine}`.

## 2. Child law (all three)

- Read FIRST: this note, then `verify/_p5_wave.md` §1 + §2. Format reference:
  `packs/starter-100.avbank.json` (exact JSON shape, naming, `#tag` style) + `packs/acid-vault.avbank.json`.
- Path/enum/hard-bound ground truth: `verify/av_bank_schema.mjs` tables + the module `setParam`
  switches (`src/av_string.js`, `src/av_dsp.js`, `src/av_*.js`). Out-of-hard-bound values FAIL.
- **Self-verify with the CANONICAL verifier** — from `C:\Users\Moddy\anvil`:
  `node verify/verify_avpacks.mjs --only <pack-id>` until **every preset PASSes** (strict exit 0) —
  that is the gate. The verifier writes the shared `verify/last-av_packs_verify.*` reports; siblings
  may run it concurrently (fine; the parent re-runs the full pass at integration). **Never `--index`.**
- Write ONLY your pack file + your scratch dir
  `C:\Users\Moddy\AppData\Local\hermes\profiles\deepseek\cache\scratch\p5b\<name>\`
  (a scratch generator — node or python templating — is encouraged, esp. for DEEP SPACE; hand-polish
  the shipped values). Never touch other packs, `verify/*` (except running the verifier),
  `src/*`, `build.py`, `index.html`, git, or browsers.
- JSON: valid UTF-8, no BOM, no random seeds. Sections follow the module-led house style
  (STARTER's: VA/ACID/STRING/DRUM/GRAIN/SAMPLER/FX/MOD/SEQ — pick the fitting subset per pack).
- Report shape: `{file, bytes, presetCount, verifierPass (x/y), designSummary (sections/engines),
  deviations, integrationSeams}`.

## 3. Parent integration (after the children land)

1. FULL canonical verify: `node verify/verify_avpacks.mjs` → expect **372/372** (100+64+64+48+56+40).
2. `node verify/verify_avpacks.mjs --index` → regenerate `packs/index.json` (6 packs).
3. Commit + addendum 22. **NO rebuild / battery / pins** — `index.html` is untouched (packs are
   runtime data fetched by the store; the verifier is the wave gate).
4. Carried: P·2 minBLEP pass · P4 follow-ups · P5.2 (BASS FORGE · LEAD LAB · FX & RISERS) ·
   PERFECT TUNINGS (blocked on the tuning engine).
