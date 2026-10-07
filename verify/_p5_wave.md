# Anvil P5 — STORE wave, part 0: digests + Phase-1 content (2026-10-07)

Trigger: P4 closed (frozen `83e4b478`, battery green, perf gate recorded). P5 per the GOLDEN BUILD
program: STORE — 10 factory packs (580 presets) + drum packs + loop packs; IDB install; previews;
add-on modules. Runs in stages (waves may split across sessions):

- **Stage 0 (THIS dispatch):** two PF port digests (store surface; pack pipeline) + Phase-1 content
  (STARTER 100 · ACID VAULT · TECHNO FOUNDRY per T8 §12's authoring order).
- **Stage 1 (after the digests land):** store infra ports — store core, store UI + `cdp_store` rig,
  the canonical schema + verifier (must re-validate ALL stage-0 packs), synth-card BANK select +
  shared apply core, preview audition; briefs are written against the digests.
- **Stage 2:** parent integration → rebuild → battery + `cdp_store` → perf gate → addenda.
  Phase-2/3 content (NEON STRINGS · BLADE PADS · DEEP SPACE · BASS FORGE · LEAD LAB · FX & RISERS)
  and PERFECT TUNINGS (blocked on a tuning engine — not shipped) are LATER waves (P5.1/P5.2).

## 1. Pack format (PIN — stage-0 content builds to THIS; stage-1 schema module implements it)

One file per pack: `packs/<id>.avbank.json` (UTF-8 JSON):

```json
{ "v": 1,
  "id": "starter-100",
  "meta": { "name": "STARTER 100", "author": "MODDYS Foundry", "license": "CC0-1.0",
            "tags": ["starter"], "description": "...", "engine": "mixed" },
  "presets": [
    { "name": "Saw Basics", "section": "VA", "tags": ["osc"],
      "patch": { "osc1.type": "saw", "filter.cutoff": 800, "...": 0 },
      "seq": { "...P4 pattern snapshot, optional..." } }
  ] }
```

- `patch` = flat avApplyParam path→value map. Values are JSON numbers / strings / booleans; enum
  strings must be the EXACT values the shipped modules accept (enumerate from `src/av_*.js`).
  EVERY path must be accepted by the shipped `AVDSP.setParam` / module setters (the witness proves it).
- `seq` (optional) = a valid P4 pattern snapshot (see `verify/_p4_wave.md` §4) for pattern presets.
- No random seeds in presets (engine PRNG is engine-owned). Content is own-authored → CC0-1.0.

## 2. Witness (PIN — every content child runs this in scratch; the canonical repo verifier lands in stage 1)

Node harness (own scratch copy; start from the proven loader pattern in
`cache/scratch/p3/integrate/mod_dsp_node.mjs`): load the worklet concat
(`av_ladder+av_dsp+av_acid+av_string+av_drum+av_grain+av_sampler+av_fx_verb+av_fx_delay+av_fx_mod+
av_fx_drive+av_fx_dyn`) in ONE Function scope; then for EVERY preset: fresh engine → apply every
`patch` path via `AVDSP.setParam` (ALL must return `true` — any false FAILs the run with the path
named) → if `seq` present, validate it against `av_seq_core.js` (loaded separately:
`avSeqLoad(seq) === true`) → `noteOn(60, 0.9)` (drums: `noteOn(36, 0.9)`) → render 2.0 s → assert:
all samples finite · peak > 1e-4 (audible) · determinism pair (two fresh engines, bit-identical).
Output per-preset rows + counts; exit non-zero on any FAIL. Report the totals per pack.

## 3. Stage-0 children & deliverables

| child | deliverable | scope |
|---|---|---|
| sa-0 (digest) | `research/reuse/store-port-digest.md` | READ-ONLY of PF `src/app_store.js` + synth-card bank-select flow (`app_synthpanel.js`/`app_synthx.js` as far as it touches banks) + IDB installer + `index.json`/`compat.json` formats + deploy/CORS notes. Format = the existing `research/reuse/kb-port-digest.md` template: line refs on every claim, per-section PORT/ADAPT/SKIP, test observables, CSS inventory, Undetermined list. Ground ADAPT decisions against what Anvil already has (`src/av_*.js`, build.py). |
| sa-1 (digest) | `research/reuse/pack-pipeline-port-digest.md` | READ-ONLY of PF's pack pipeline: the `.pfsynth` schema module, author gate, `verify_packs`, preview-render step, deploy layout. Map onto the PINNED `.avbank.json` format (§1). Per-section PORT/ADAPT/SKIP + exact file/function map + generator/verifier guidance + Undetermined list. |
| sa-2 (content) | `packs/starter-100.avbank.json` | **100 presets** — the tutorial tour, simplest-first, covering ALL shipped modules (VA · ACID · STRING · DRUM · GRAIN · SAMPLER · FX rack · MOD matrix · SEQ — each kind appears; every FX module appears). Template+variation method via a scratch generator; witness all 100. Doubles as the engine smoke-corpus. |
| sa-3 (content) | `packs/acid-vault.avbank.json` | **64 presets** — 303 lines: basses, squelch leads, rave stabs; several presets ship bassline `seq` patterns (acid lane semantics: accent/slide/oct steps; swing ≥ 60). Witness all 64. |
| sa-4 (content) | `packs/techno-foundry.avbank.json` | **64 kit/pattern presets** — synthesised drum kits (DRUM engine; kick/snare/hats/perc) + **32 sequencer patterns** as their own presets (`seq` field; kick/hats grooves, swing 60-70, some probability/accents). Witness all 64. |

Child laws (all): work on ONLY your assigned file(s); never touch other repo files, `build.py`,
`index.html`, git, or browsers; `node --check` allowed on your own .mjs; scratch under
`cache/scratch/p5/<name>/`; report in the §8 shape (files · evidence · pass counts · deviations ·
integration seams). T8 references: pack rows in `research/packs/T8-content-packs.md` §12.

## 4. Stage-1 placeholder (briefs written after the digests land)

Store core (`src/av_store.js` — fetch manifest, verify sha256, IDB install `av-packs-store`,
quota-honest, offline re-launch) · store card UI (`src/av_store_ui.js`) + `verify/cdp_store.mjs`
(parent-run) · canonical `verify/av_bank_schema.mjs` + `verify/verify_avpacks.mjs` (author gate +
verifier; MUST re-witness every stage-0 pack) · synth-card BANK select + ONE shared apply core
(bank → avApplyParam path application) · preview audition (client-side OfflineAudioContext v1) ·
`index.json` manifest for the packs dir. Hosting/deploy = the final wave; the store must work
locally from `file://` + the test harness.

## 5. Gates (wave close)

Digests land → stage-1 briefs → infra ports green (their node harnesses) → parent integration →
rebuild → battery (all existing suites + `cdp_store`) → perf gate (bench + stress, quiet window if
possible) → commits + addenda. The canonical verifier must pass 100 % of stage-0 presets
(228 presets: 100 + 64 + 64) at integration time.
