# Pack pipeline port digest — Pattern Forge's pack pipeline (.pfsynth schema · author gate · verifier · previews · deploy) → Anvil P5 store stage

**Written:** 2026-10-07 · for the Anvil research build (`C:\Users\Moddy\anvil`) · source `C:\Users\Moddy\pattern-forge\` unless noted · deploy files under `C:\Users\Moddy\radio-browser\deploy\`.
**What this feeds:** `verify/_p5_wave.md` §3 sa-1 → §4 stage-1 briefs (store core, `cdp_store` rig, canonical `verify/av_bank_schema.mjs` + `verify/verify_avpacks.mjs`, BANK select + apply core, preview audition, `index.json`). The pinned target format is `_p5_wave.md` §1 (`p5:16-36`) and the pinned witness `p5:38-48`.
**Read in full:** `verify/synth_pack_schema.mjs` (244 L) · `harvest/build_synth_packs.mjs` (92) · `harvest/_check_pack.mjs` (37) · `verify/verify_packs.mjs` (682) · `verify/_stamp_synth.mjs` (42) · `verify/repair_packs.mjs` (310) · `verify/cdp_store.mjs` (530) · `harvest/wtlab_gen.mjs` (537) · `harvest/pack_store.py` (263) · `harvest/_s19_deploy.sh` (49) · `harvest/_audit_served_packs_check.py` (28) · `radio-browser/deploy/.htaccess` (88) · `packs/README.txt` (93) · `STAGE11-CONTRACT.md` (152) · `annex/05-sound-pack-pipeline.md` (81) · `src/app_store.js` (415). **Targeted reads:** `src/app_synthpanel.js` L815-1074 + greps · `verify/test_live_site.mjs` (grep refs, exact lines — not a full read) · `harvest/build_packs2.py` (defs grep) · `harvest/mathwaves_gen.mjs` (header). **Anvil side:** `verify/_p5_wave.md`, `_p4_wave.md` §4, `research/packs/T8-content-packs.md` §12-17, `src/av_dsp.js` setParam range, `src/av_engine.js`, `src/av_seq_core.js` header greps.
**Ref convention:** module-prefixed — `schema:` `builder:` `check:` `vp:` `stamp:` `repair:` `cdps:` `store:` `panel:` `wtlab:` `packpy:` `bp2:` `ht:` `s19:` `auditpy:` `stage11:` `annex05:` (all under pattern-forge); `p5:` `p4:` `t8:` `avdsp:` `avseq:` `aveng:` `core:` (under anvil); `ht:`/`s19:` per the deploy note above. Line numbers are the source file's.
**Verdict vocabulary (T9):** **PORT** = copy with light edits · **ADAPT** = reuse with rework · **SKIP** = don't bring.

---

## 0. What the pipeline is, and what Anvil wants from it

PF's pack pipeline is six stages, each with a mechanical gate:

1. **Author** — pretty JSON under `harvest/synth_packs/<id>.pfsynth.json` (`wtlab:` writer is the exemplar).
2. **Author gate** — `harvest/build_synth_packs.mjs`: validate every source against the SHARED schema → sha256 → byte-copy into the deploy store → upsert `index.json`; any byte change resets `verified` (`builder:43-83`). A desk-side one-file checker `_check_pack.mjs` exists for iterating (`check:19-36`).
3. **Engine witness** — `verify/verify_packs.mjs` (v5): node-side schema gate (`vp:501-513`) + browser engine layer (apply → play → tap, `vp:240-319`), writing proofs back + stamping `index.json`/`compat.json` (`vp:628-666`); targeted re-stamp via `_stamp_synth.mjs` (`stamp:23-37`).
4. **Preview render** — **does not exist in PF** (§4; nothing in the pipeline renders or ships previews).
5. **Deploy** — byte-diff vs live → upload diffs → re-download + `cmp` → live suite (`s19:13-48`), plus a served-bytes hash audit (`auditpy:11-25`).
6. **Client install** — `src/app_store.js` IDB store (out of scope here; sa-0's digest).

**Anvil P5 wants:** stage-0 packs authored to the pinned `.avbank.json` (`p5:16-36`) and witnessed by a Node harness (`p5:38-48`); stage-1 ports the canonical schema + verifier (which "MUST re-witness every stage-0 pack", `p5:68-72`, 228 presets total per `p5:78-80`), the BANK select/shared apply core, preview audition (client-side OfflineAudioContext v1, `p5:71`), and an `index.json` manifest; hosting/deploy is the final wave (`p5:72-73`). The pack format is **JSON patch maps against the shipped modules** — much closer to PF's *synth sound banks* than to its Strudel pattern packs, so this digest maps the `.pfsynth` half of PF's store onto `.avbank.json` and drops the Strudel half.

---

## 1. The schema module — `verify/synth_pack_schema.mjs` (the single source of truth)

**Role (the law to port):** one module imported by both the authoring gate and the shipping verifier "so the two can never drift apart" (`schema:1-3`). It never throws; everything returns arrays of specific, path-bearing error strings. STAGE11 added wavetables additively while staying `version: 1` (`schema:5-23`, mirrored by `stage11:30-53`) — the pattern for evolving `.avbank.json` later without a version bump.

**Constants & caps.** `SYNTH_PACK_FORMAT='pfsynth'`, `SYNTH_PACK_VERSION=1`, hard cap 20 MB, soft target 10 MB (`schema:29-32`). `VOICE_IDS` = the 10 dock voices, explicitly "mirrors SYNTH_VOICES in src/app_kb.js" (`schema:35-38`) — **the precedent for Anvil: enumerate the engine's shipped set INTO the schema** (P5 demands exactly this for enum strings, `p5:32-34`). Helpers: `isObj` / `R(v,lo,hi)` range check / `SLUG` `/^[a-z0-9][a-z0-9-]{0,48}$/` (`schema:40-44`).

**The "no silent clamp" law** (`schema:25-27`): "Limits mirror the engine's own laws … Anything a patch cannot legally express is an ERROR here, not a silent clamp in the engine." Per-patch checks enforce it: id slug, name ≤48, category ≤24, hint ≤200, `voice` ∈ VOICE_IDS, `def.oscs` 1..8, per-osc ranges (mul 0.25..8, gain 0..1.5, detune ±100, decay 0.01..8; vibrato rate 0.5..12 / cents 1..50; fm mul/index/decay), filter (freq 40..18000 REQUIRED, q 0.1..24, envAmt 0..12000, envDecay 0.02..6), amp (a 0.001..3, d 0.01..6, s 0..1, r 0.03..6), def.gain 0.1..1.4, fx chorus/delay 0..1, def ≤ 8 KB (`schema:120-191`). Pack level: format/version guards, slug id, name ≤60, `kind` ∈ synth|both|strudel, patches ≤ 64, duplicate patch ids, patterns structurally checked (name ≤60, code ≥8 chars), **licence discipline — author + license non-empty or the pack is refused** unless `opts.requireLicense === false` (`schema:195-233`, licence at `224-228`). File gate: empty → error; > cap → error; JSON parse failure → error string; returns `{ pack, errors }` (`schema:236-243`).

**Wavetable block** (`schema:46-118`): base64 `.wt` container validated byte-exact (magic `vawt`, flags 0, size pow2 2..4096, count 1..512, length exactly `12+4*size*count`), ≤8 tables, `wt:<slug>` ids unique, and the **patch refs law** — every `oscs[i].wt` must be a `gen:` builtin or a table declared in the same pack (`schema:107-116`). No counterpart in the `.avbank.json` pin → SKIP the block, but it is the template if Anvil ever ships wavetable banks.

**§1 verdict: PORT the architecture and laws** (shared module, never-throw, path-bearing errors, caps, slug, licence discipline, file gate); **ADAPT the field laws** to `.avbank.json` (§6); **SKIP the wavetable block** for v1.

---

## 2. The author gate + the generator exemplar

**`harvest/build_synth_packs.mjs` (92 L) — validate → copy → upsert.** Per source file: JSON parse (`builder:39-42`) → `validateSynthPack` (`builder:43-48`) → size cap (`builder:49`) → sha256 (`builder:50`) → index entry `{id,name,blurb,kind,file,size,sha256,tags,author,license,guidance,patches,patterns,wavetables}` (`builder:52-69`) → upsert into `index.json` **keeping `verified` only when `prev.sha256 === sha`** — "bytes changed → stale proof" (`builder:71-79`) → byte-copy the file into the deploy store ("the shipped file IS the authored file", `builder:3`, copy at `81`). Exit code 1 on any failure (`builder:92`); `--dry` for a no-write pass (`builder:20`). Dest = `radio-browser/deploy/packs` (`builder:22`).

**`harvest/_check_pack.mjs` (37 L) — the desk-side gate.** One command per authored file; imports the same schema (`check:4`), prints counts/voices/patch list (`check:24-30`), exits 1 with the error list (`check:32-36`). The comment even names the two classic authoring failures: trailing commas and unescaped quotes in code strings (`check:15`).

**`harvest/wtlab_gen.mjs` (537 L) — the generator exemplar** (one of a family: `mathwaves_gen.mjs`, `terrascan_gen.mjs`, `akwf*_gen.mjs`; `bp2.py` is the older Python wave). Header states the law: "Deterministic and dependency-free: plain math over typed arrays, base64 via Buffer, no RNG, no clock, no network, no npm packages. Running it twice writes a byte-identical … file" (`wtlab:3-7`; `mathwaves:3-8` adds the clean-room claim). Structure: constants → DSP math → container encoder (`wtlab:142-155`) → content arrays → house-style serializer (value objects inline, containers expanded — `wtlab:356-425`) → assemble (`wtlab:429-442`) → **SELF-CHECK block** (`wtlab:448-537`): re-parse round-trip equality (`455-460`), per-table byte math (`470-501`), refs law + ≥3 patches/table (`507-526`), `process.exit(1)` on any problem (`532-536`), sha16 + sizes printed (`462-463`).

**`STAGE11-CONTRACT.md`** is the process around all of this: one writer per file; labs work in their own clone and "never run the builder install, never touch `deploy/`" (`stage11:24-28`); order = merge → build/freeze → battery → **builder → `verify_packs --only … --no-stamp` → `_stamp_synth`** → deploy the byte-diff set → live tests (`stage11:126-152`). Anvil's P4/P5 child laws (scratch-only, one writer, §8-shape reports, `p4:180-196`) are the same discipline.

**§2 verdict: ADAPT the gate (it becomes the shared schema + an `_check_avpack` CLI + the eventual stamp/deploy wave); PORT the generator pattern** (deterministic + self-check importing the canonical schema).

---

## 3. The shipping verifier — `verify/verify_packs.mjs` (v5)

**History that matters.** v1 (evalError) and v2 (error banner/console) were unreliable — the editor state updates on a frame queue headless Chrome throttles, and the biggest failure class ("a pattern naming a sound the engine does not have") never sets evalError (`vp:5-8`). v3 dropped playback for three deterministic checks (`vp:11-27`). v4 added synth banks: "apply through the app's own load path → play → witness the audio on the app's OWN master tap node … Engine receipt + live audio, never a code-string assertion" (`vp:29-35`). v5 added wavetable banks (`vp:38-45`). **The law to keep: judge the engine's own behavior, never a string assertion.**

**Architecture.** Node side: read the packs dir (`vp:73`), per file — patterns loop (`vp:432-499`) with quarantine semantics (oversized code >60 000 chars → "not checked" `vp:439-446`; wedge/timeout 20 s → reload + "not checked" `vp:228-236`, `395-400`); synth banks: `validateSynthPack` first, patch-level schema errors itemised by index (`vp:501-513`). Browser side: headless Chrome via CDP (`vp:54-92`), page helpers injected (`vp:64`, `pf_page_helpers.js`), `window.__FORGE_READY` boot wait (`vp:188-194`).

**The patch witness (`patchCheck`, `vp:240-309`) — the core pattern for Anvil's stage-1 rig:**
- verifier-owned AnalyserNode on the app's own master tap; "the EQ panel's bands are UI-gated … so witness the audio on the app's OWN master tap node … with a verifier-owned analyser" (`vp:248-259`) — panel reads are not witnesses (T8 Trap 1, `t8:160`);
- blend switch to synth and restore after (T8 Trap 2, `t8:161`; `vp:264`, `308`);
- apply via the app's own `pfSynApplyPatch` (`vp:269-276`); engine receipt = gain read back from the engine, mismatch fails (`vp:277`, `315`);
- play notes (`vp:283-284`), sample the tap 12×120 ms taking the max peak (`vp:286-295`), read the live voice's built wavetable count for §11 (`vp:296-304`);
- verdict order: applied → receipt → live context → `peak >= PATCH_PEAK_MIN` (20 on the 0-255 byte scale, `vp:239`, `310-319`);
- **factory calibration canary** — every factory voice played first, "the patch bar must never measure a dead engine" (`vp:343-420`); unhealthy voices only warn (`vp:415-416`).

**Verdict discipline is TOLERANT:** errors are recorded per item, written into the pack (`pat.compat`/`compatError` `vp:492-494`; `p.verified` block `vp:628-636`), the packager quarantines ("not checked:" dropped to `excluded.json`, other failures moved to `needs-newer-strudel` — `packpy:136-148`, `173-207`), and the run exits 0 regardless (`vp:672`). **Anvil's pin is the opposite: strict** — "ALL must return true — any false FAILs the run with the path named" and "exit non-zero on any FAIL" (`p5:44-48`). ADAPT architecture, CHANGE discipline.

**Stamping.** `--stamp` (default on for full runs, `vp:78`) merges fresh proofs into `index.json` (sha256/size/patterns/patches/verified per entry, `vp:651-661`) + `compat.json` (`vp:663-664`). `_stamp_synth.mjs` does a targeted merge for named ids without a full re-run ("a full rerun is hours", `stamp:1-2`, `23-37`); it refuses if the pack carries no `verified` block (`stamp:29`). **Note:** PF writes proofs INTO the pack bytes (`vp:636`); for Anvil that would invalidate the pack's own sha256 and re-touch authored content — the canonical verifier should write a report file, not rewrite packs (§6).

**Repair** (`repair_packs.mjs`) is mechanical fix-up of harvested community patterns only (`repair:1-25`), each candidate re-checked by the same deterministic check, original kept in `repairedFrom` (`repair:282-289`). SKIP for Anvil (own-authored content).

**Store-side observables** (for the future `cdp_store` rig; `cdp_store.mjs` full read): node-side manifest checks (size/sha vs shipped bytes, cap, `cdps:63-67`); local HTTP server with `Access-Control-Allow-Origin: *` + `Cache-Control: no-store` — "what moddys.net serves via .htaccess" (`cdps:84-98`); install through the real UI (`cdps:232-236`); independent IDB read with the manifest sha (`cdps:257-265`); CORS assertions (`cdps:419-423`); OFFLINE phase — host closed, reload, installed packs survive, patch still applies and PLAYS (`cdps:425-507`); zero unexpected console errors (`cdps:509-510`). Recorded runs: `cdp_store 44/44` (`stage11:136`).

**§3 verdict: ADAPT the architecture** (schema gate → engine witness → per-item rows → stamp; verdict order; "engine receipt, never a code-string assertion"); **SKIP the CDP/Strudel layers** (see §6.3); **PORT the strict-exit deviation the pin demands.**

---

## 4. Preview renders — what PF does (nothing), and the options for Anvil

**Finding: PF's pack pipeline has NO preview-render step.** Evidence, exhaustively: `verify_packs.mjs` contains no render/preview code — its only audio layer is the live tap analyser (`vp:248-295`, 286-295); index entries carry no preview fields (`builder:52-64`; live `index.json` sample); store-card tests assert only chips/counts/guidance (`cdps:186-202`); the word "preview" appears in the pipeline exactly once — `packpy:138`, a 200-char **text** excerpt `code_preview` of patterns EXCLUDED from the store. What does exist nearby: PF's hub has an `<audio>` audition of recorded takes (`app_hub.js:52`, `606`, `904-918` — takes, not packs); the vendored Strudel repl carries an engine-level offline render, `renderPatternAudio` — OfflineAudioContext 2-ch render → WAV download (`harvest/repl/webaudio.js:277-295`) — but no pack path uses it; PF's previews are **on-demand live play**: patterns evaluate in the drawer, bank patches load onto their voice (`panel:982-1006`). The T8 plan for Anvil (`preview render (Tier B+). Offline render per preset via the engine's own graph`, `t8:163`; conventions `t8:170`) is a PLAN, not a PF port.

**Options for the stage-1 "preview audition" (`p5:71` pins client-side OfflineAudioContext v1):**

| | A — client-side render (recommended) | B — shipped preview files |
|---|---|---|
| Artifacts | none; render on click/hover | one audio file per preview (Ogg q4 + `m4a` sibling per `annex05:48-50`, or a per-pack medley) |
| Sync with engine | always current (renders the shipped engine) | **stale after every engine byte change** — the "byte change resets proof" law (`builder:74`, `t8:157`) turns previews into a standing re-render burden across P5/P6 waves |
| Offline | works from the installed IDB record | works, but adds deploy weight + CORS/cache/sha rules to the store |
| Cost | render CPU per audition (a 2 s one-note render is cheap; debounce + keep the last N buffers) | hosting bytes (PF packs are ~KB of JSON; previews would be the first heavy store artifacts) |
| Precedent | the witness already renders this exact graph deterministically in Node (`p5:46-47`) | T8 §15 conventions exist (`t8:170`), but nothing was ever built or shipped |

**Recommendation: A.** Render the SAME recipe the witness uses — fresh engine → patch applied → `noteOn(60, 0.9)` (drums `noteOn(36)`) → 2.0 s — so "what you hear" is exactly "what was witnessed" (`p5:46-47`), with the seq presets playing their seq. Mechanics already in the repo: the single-file build embeds the worklet sources and loads them via a blob URL `addModule` (`aveng:204-231`; `blob:/data: addModule cannot fetch extra files from a file:// page, so the single-file build` — `build.py:31`); mirror that on an `OfflineAudioContext` pinned at 44 100 Hz, take the rendered buffer, treat `render completed + finite + peak` as the cdp_store observable. Determinism (bit-identical engine renders, `p5:47`) is the strongest argument: the preview can never drift from the witness. Keep B only if previews must ever be audible outside the app; if so, adopt T8 §15 (−1 dBTP / −14 LUFS, naming, per-pack medley) and accept the re-render-on-change cost. **Undetermined:** OfflineAudioContext + AudioWorklet under `file://` was not exercised in this read-only pass — the cdp_store rig must witness it (§Undetermined 7).

---

## 5. Deploy layout (packs dir, headers, byte-diff flow, live witnesses)

**Tree + lifecycle.** Packs deploy to `C:\Users\Moddy\radio-browser\deploy\packs\` — `index.json` (manifest), `compat.json` (proofs), `README.txt`, `*.pfpack.json` + `*.pfsynth.json` (one file per pack; the shipped file is the authored file byte-for-byte, `builder:3`). `README.txt` is the user-facing contract: what the store is, how verification works (transpiler + registry for patterns; apply→play→tap for banks; "keeps its reason and is collected into needs-newer-strudel"), licences per section (`README.txt:1-93`).

**Headers (`radio-browser/deploy/.htaccess`, live).** CORS is an **origin allowlist, not `*`**: `moddys.net`, loopback (`127.0.0.1|localhost`, any port), and `null` (file://) get `Access-Control-Allow-Origin` reflected; a re-hosted copy of the app gets no CORS header — "that is the point" (`ht:61-67`). `index.json`: `no-store, must-revalidate` + `Vary: Origin` (`ht:68-72`). Pack files (`[.]pfpack[.]json`, `[.]pfsynth[.]json`): ACAO + `Vary: Origin` + `Cache-Control: public, max-age=3600` (`ht:73-83`). **Deviation to resolve for Anvil:** `t8:165` and `annex05:64-67` mandate *immutable* pack files (`max-age=31536000, immutable`); the live `.htaccess` still serves 3600 — in PF the immutable rule was written for the future `.pfsound.zip` class (`annex05:65-67`); pick one before Anvil's hosting wave (§Undetermined 5).

**Deploy flow (`harvest/_s19_deploy.sh`, 49 L; the pattern).** Freeze shas → re-download every live file and `cmp` to decide the upload set by BYTES, "never by 'I ran the verify'" (`s19:3-5`, `18-32`) → upload only the diffs (`radio-browser/upload-site.py --only …`, `s19:34-37`) → **independent re-download + `cmp` all IN-SYNC** (`s19:39-45`) → live suite (`s19:47-48`). `_audit_served_packs_check.py` then hashes every served pack against the manifest's sha256+size and exits non-zero on any mismatch (`auditpy:11-27`).

**Live witnesses (`verify/test_live_site.mjs`, grep-sourced):** store index loads from the live origin — 101 packs, synth banks ≥14 (`tls:203-204`); a `.pfsynth.json` downloads and parses with real patch defs (author+license+def.oscs, `tls:206-208`); per-bank checks that the served bytes' sha matches the manifest entry (`tls:213`, `233`, `286-314`, …); CORS: `Origin: null` reflected, foreign origin refused (`tls:617-626`).

**Manifest shape.** `{store, name, base, free, updated, source, packs[]}`; entry `{id, name, blurb, kind, file, size, sha256, tags, author, license, guidance, patches, patterns, wavetables, verified{checked, ok, errors, engine, date, verifier}}` (`builder:52-64`; live sample; `packpy:160-170`). For Anvil stage-1's `index.json` (§6.4): trim to `{id,name,file,size,sha256,presets,meta…,verified}`.

**§5 verdict: PORT the rules** (origin-allowlist CORS — with the null-origin case proven necessary for file://; no-store index; sha-covered served bytes; byte-diff deploy + re-download cmp + live tests). **ADAPT** the manifest entry. **Resolve** the immutable-vs-3600 choice.

---

## 6. Mapping PF's `.pfsynth` pipeline onto the pinned `.avbank.json`

### 6.0 The pin, restated (`p5:16-36`)
`packs/<id>.avbank.json`: `{v:1, id, meta:{name,author,license,tags,description,engine}, presets:[{name, section, tags, patch:{path:value,…}, seq?}]}`. `patch` = flat avApplyParam path→value map; values JSON number/string/boolean; **enum strings must be the exact shipped values (enumerate from `src/av_*.js`); every path must be accepted by the shipped `AVDSP.setParam`/module setters** — the witness proves it (`p5:31-34`). `seq` optional = valid P4 snapshot (`p4:170-178`: `{v, name, bpm, grid, swing, tracks[…], plocks[…], rng}`), import-validated by `avSeqLoad(obj) === true` (`p5:35`, `avseq:37`). No random seeds; CC0 own-authored (`p5:36`). The witness (`p5:38-48`): node harness, worklet concat in ONE Function scope, fresh engine per preset, every path via `AVDSP.setParam` (all true), seq via `avSeqLoad`, `noteOn` → render 2.0 s → finite + peak > 1e-4 + determinism pair bit-identical; per-preset rows; exit non-zero on any FAIL.

### 6.1 Field crosswalk (.pfsynth → .avbank.json)
| .pfsynth | .avbank.json | Note |
|---|---|---|
| `format`+`version:1` | `v:1` | keep a single `v` in the file (the pin); no format string pinned |
| `id` (slug), `name` | `id`, `meta.name` | same slug law `schema:44`; name caps to decide |
| `kind: synth|both|strudel` | `meta.engine` ("mixed"…) | class-kind has no meaning for a module-spanning bank |
| `author`, `license` (required, `schema:224-228`) | `meta.author`, `meta.license` | licence discipline PORTS as-is (CC0-1.0 per `p5:36`) |
| `blurb` ≤300, `guidance` ≤200, `tags` (`schema:229-231`) | `meta.description`, `meta.tags` | recommend similar caps; `guidance` has no home — fold into description or drop |
| `patches[].voice` + `def{oscs,filter,amp,gain,fx}` | `presets[].patch` flat map | the big shape change; `voice` has no analogue (the path prefix names the module: `osc1.*`, `filter.*`, `fx.verb.*`, `acid.*`…) |
| `patches[].category`, `hint` (`schema:126-127`) | `presets[].section` (+?) | `section` ≈ category; `hint` is **not in the pin** — flag (§Undetermined 2) |
| `patterns[]` (Strudel code, separate list) | `presets[].seq` (attached snapshot) | completely different model; Anvil attaches seq to a preset |
| `wavetables[]` (§11) | — | SKIP v1 |
| `verified{…}` merged into the pack | **do not put in the pack** | report file + optional index.json stamp only (immutability/sha; §6.2) |

### 6.2 What `verify/av_bank_schema.mjs` should implement (PORT/ADAPT of `synth_pack_schema.mjs`)
1. **Same shape as PF's module, never throws, returns `errs[]` with paths** (`schema:120-122` style: `presets[3] patch.filter.cutoff: …`).
2. **File gate `validateAvBankFile(buf, label)` → `{pack, errors}`** — empty / size-cap / JSON-parse / attach (`schema:236-243`); plus the size-cap constants (hard + soft, PF's dual at `schema:31-32`) — **values not pinned; pick with the parent** (§Undetermined 1).
3. **`validateAvBank(pack, opts)`** — `v === 1`; id slug; `meta.name/author/license` non-empty (licence discipline, `schema:224-228`); description/tags type+length checks; `presets` array ≥1 and ≤ a cap (PF: patches ≤64 at `schema:209` — Anvil stage-0 packs reach 100 presets, so the cap must be ≥100; flag, §Undetermined 1); per preset: `name` non-empty+cap, `section` string+cap, `tags`, **`patch` = non-empty object whose values are finite numbers | strings | booleans only**; `seq` if present = structurally valid §4-shaped object (`v:1` etc. — full admission is `avSeqLoad`'s job per `p5:45-46`); duplicate preset names flagged (PF dedupes ids, `schema:210-214`; the BANK select indexes by position, so duplicates are authoring foot-guns).
4. **Enum tables enumerated from `src/av_*.js`** (the `VOICE_IDS` precedent, `schema:35-38`): every string-valued path's legal set lives in the schema so a typo fails at the desk, not in the witness. **Range strictness is a real design question:** `avdsp.setParam` CLAMPS out-of-range numbers and still returns `true` (`avdsp:455-528`: `cl(n,0,1)`, cutoff `cl(n,20,20000)`, …) and returns `false` only for non-finite values / unknown enums (`avdsp:449-451`, `537-563` unknown path → false). So the witness alone cannot catch values that will be silently clamped — if Anvil keeps PF's "no silent clamp" law (`schema:25-27`), the schema must carry the ranges. Flag as a recommendation (§Undetermined 3).
5. **Export everything for reuse** — the generator/self-check and the verifier import the same module ("so the two can never drift", `schema:1-3`); also export small helpers (`R`, slug, caps) for tests (`schema:56-82` precedent).

### 6.3 What `verify/verify_avpacks.mjs` should implement (ADAPT of `verify_packs.mjs`)
1. **Node-only.** The workspace-reader pattern is proven at `cache/scratch/p3/integrate/mod_dsp_node.mjs`; load `av_ladder+av_dsp+av_acid+av_string+av_drum+av_grain+av_sampler+av_fx_verb+av_fx_delay+av_fx_mod+av_fx_drive+av_fx_dyn` in ONE Function scope (`p5:42-44`). No CDP, no Chrome spawn (`vp:88-92` dropped), no reinject-on-wedge (`vp:228-236` dropped — a node harness cannot wedge the page).
2. **Loop = schema gate → witness, per pack/preset.** Schema errors abort the pack like `vp:501-513`. Per preset: fresh engine → apply every `patch` path via `AVDSP.setParam`; collect false paths; any false FAILs with the path named (`p5:44-45`); `seq` → `avSeqLoad(seq) === true` (`p5:45-46`, `avseq:37`); `noteOn(60,0.9)` / drums `noteOn(36,0.9)` → render 2.0 s → assert all samples finite, peak > 1e-4, determinism pair bit-identical across two fresh engines (`p5:46-47`).
3. **Output:** per-preset rows + per-pack counts; totals; **exit non-zero on any FAIL** (`p5:47-48`) — this is the STRICT deviation from PF (`vp:672` exits 0; PF quarantines instead, `packpy:136-148`). House style: print rows, write `verify/last-verify_avpacks.{log,json}` (Anvil's `verify/` naming).
4. **CLI (ADAPT of `vp:67-79`):** `--only id1,id2` (`vp:74`), `--dir packs` (`vp:73`), optional `--stamp` that merges `{sha256,size,presets,verified}` into `packs/index.json` (PF merge shape `vp:651-661`; targeted-stamp precedent `stamp:23-37`) — **explicit flag only**, never PF's default-on behavior (`vp:78`). Acceptance at integration: 228/228 presets pass (`p5:78-80`).
5. **Drop list (explicit):** CDP spawn/page-helper plumbing (`vp:54-92`, `183-236`); mirror/transpiler/sound-registry/scale checks (`vp:108-134`, `136-144`); `--play` runtime layer (`vp:77-78`, `458-488`); blend switching + master-tap analyser (`vp:248-264`, `308`) — the node harness measures the rendered buffer directly, which is a stronger witness than a 0-255 byte-scale tap; the wavetable machinery (`schema:46-118`, `vp:322-330`, `548-624`); `repair_packs.mjs` wholesale (`repair:1-25`).
6. **Optional keep:** a factory-calibration canary analogue (`vp:343-420`) — one known-good preset rendered before the corpus, so a broken loader can't pass everything quietly; the P5 witness does not mandate it (§Undetermined 6). Also keep PF's verdict ORDER (`vp:310-319`): refusals first, then acceptance, then audio, then numbers.

### 6.4 Author gate correspondence
PF's builder does three jobs: validate (schema), serialise deployment (byte-copy), and bookkeep (`index.json` upsert + verified reset). For Anvil stage-0/1: the **validate** job = the shared schema imported by content generators and the `_check_avpack` CLI (ADAPT of `check:1-36`); the **bookkeep** job = `verify_avpacks --stamp` against `packs/index.json` (PORT the upsert/reset semantics: sha change ⇒ drop `verified`, `builder:74`); the **byte-copy** job does not exist until the hosting wave (packs live in-repo; deploy = stage-2/final, `p5:72-73`).

---

## 7. Generator + verifier guidance for Anvil pack authoring (the rules that were paid for)

**Generators (scratch-only, per `p5:60-63` laws):**
1. Deterministic, dependency-free, no RNG/clock/network; running twice yields byte-identical output (`wtlab:3-7`). Content is templated + variation, not clicked.
2. Generator self-check imports the canonical schema and runs the same laws the verifier will — one law, two call sites (`schema:1-3`; `wtlab:448-537` re-parse + per-table + refs checks as the model).
3. Print sha16, byte size, counts, and the coverage statement at the end (`wtlab:462-463`, `527-530`); exit 1 on any self-check problem (`wtlab:532-536`) — a generator that hides its own defects is worse than none.
4. Author in final form: any byte change resets `verified` (`builder:74`, `t8:157`), so iterate the generator, not the written pack.
5. Enum strings must be the module's exact accepted values — enumerate from `src/av_*.js` (`p5:32-34`); `avdsp` clamps silently, so "it passed the witness" is not proof of the authored intent (§Undetermined 3).
6. 100 % CC0, own-authored; no third-party bytes (`p5:36`, `t8:185-199`). Licence + author fields mandatory (`schema:224-228`).
7. No random seeds in presets (`p5:36`); determinism comes from the engine, and the §4 seq snapshot carries its own `rng` (`p4:176`) — presets' patch maps must not.
8. One writer per file; pack children touch only their assigned pack(s) (`p5:60-63`, `stage11:15-28`).

**Verifier (canonical):**
1. Schema gate FIRST, engine witness second (`vp:501-513` ordering) — a structural error should never reach the renderer.
2. Judge the engine's own behavior, never a string assertion (`vp:33-35`): `setParam` return values, `avSeqLoad` return value, rendered samples.
3. Name the failing path in the row (`p5:44-45`); print per-preset rows + counts; exit non-zero (`p5:48`).
4. Report to a file, don't rewrite pack bytes (immutability; §6.2/6.4); stamp only `index.json`, only when asked.
5. Re-witness the whole corpus at integration (228 presets, `p5:78-80`) — the verifier IS the acceptance gate, not a spot check.

---

## 8. Per-area PORT/ADAPT/SKIP verdicts

| Area (source refs) | Verdict | Instructions |
|---|---|---|
| Shared schema module: single source of truth, never throws, path-bearing error strings (`schema:1-3`, `120-122`) | **PORT** | `verify/av_bank_schema.mjs` should read exactly like this module. |
| Caps + slug + range-check helpers (`schema:29-32`, `40-44`) | **ADAPT** | Caps need Anvil values (≥100 presets); slug reusable. |
| Licence discipline: author+license required (`schema:224-228`) | **PORT** | Mirrors `p5:36`. |
| File gate `validateSynthPackFile` (`schema:236-243`) | **PORT** | Becomes `validateAvBankFile`. |
| Wavetable block + refs law (`schema:46-118`) | **SKIP (v1)** | No `.avbank.json` counterpart; keep as future template. |
| `voice`-pinned patch defs (`schema:120-191`) | **ADAPT** | Replaced by flat `patch` map; the no-silent-clamp range tables are the ADAPT question (§Undetermined 3). |
| Author gate: validate→sha→upsert→byte-copy; `verified` reset on byte change (`builder:43-92`) | **ADAPT** | Schema-import + `_check_avpack` CLI now; byte-copy + deploy is the final wave; keep the reset law (`builder:74`). |
| Audience `_check_pack` CLI (`check:1-36`) | **PORT** | Twin for `.avbank.json`. |
| Generator exemplar: determinism + self-check + house serializer (`wtlab:3-7`, `448-537`, `356-425`) | **PORT (scratch)** / **SKIP serializer** | Self-check block ports; the custom serializer is unnecessary for small packs. |
| Verifier architecture: schema gate → apply→play→tap → per-item rows → stamp (`vp` passim, `501-513`, `628-666`) | **ADAPT** | Skeleton ports; engine layer is Node (per `p5:38-48`), verdict discipline flips tolerant→strict. |
| CDP/Chrome spawn, page helpers, reinject (`vp:54-92`, `183-236`) | **SKIP** | Not needed for a node-loadable engine. |
| Strudel layers: mirror/transpiler/registry/scale, `--play` (`vp:108-144`, `458-488`) | **SKIP** | No Strudel in Anvil. |
| Tap/blend witness (`vp:240-264`, `286-308`) | **ADAPT→direct** | Measure rendered buffers in Node; STRONGER than the byte-scale tap. |
| Factory calibration canary (`vp:343-420`) | **ADAPT (optional)** | Recommend a minimal engine-alive preamble (§Undetermined 6). |
| Quarantine/drop semantics (`packpy:136-148`, `vp:439-446`) | **SKIP** | Anvil is strict: any FAIL fails the run (`p5:44-48`). |
| `_stamp_synth` targeted stamp (`stamp:23-37`) | **PORT** | `--stamp` mode of `verify_avpacks`. |
| Pack-byte rewriting (compat fields in the pack, `vp:636`) | **SKIP** | Report file; stamp only `index.json`. |
| `repair_packs.mjs` (`repair:1-25`) | **SKIP** | Own-authored content; keep the repair-proof law if ever harvesting. |
| Preview renders | **NEW-BUILD** | No PF precedent; recommend client-side OfflineAudioContext v1 (§4). |
| Deploy: CORS allowlist incl. null origin, no-store index (`ht:61-72`) | **PORT** | Null-origin reflection is what makes file:// installs work (`tls:625`). |
| Deploy: pack-file cache header (`ht:73-83` vs `t8:165`/`annex05:64-67`) | **ADAPT (resolve)** | Live PF serves 3600; T8 wants immutable — pick before hosting (§Undetermined 5). |
| Deploy flow: byte-diff → upload → re-download cmp → live suite → served-hash audit (`s19:13-48`, `auditpy:11-27`) | **PORT (final wave)** | The only deploy discipline any of this ever used. |
| Manifest entry shape (`builder:52-64`) | **ADAPT** | Trim to `{id,name,file,size,sha256,presets,verified,…}`. |
| IDB install/store layer (`store:1-415`, `cdps`) | out of scope | Cross-ref sa-0's store digest. |

---

## 9. House conventions to follow (Anvil side)

- av- prefix, `"use strict"`, header comment stating the source + a "LAWS preserved:" list; node-parseable (no top-level DOM); never throw; `node --check` clean on every own file (`p4:185`).
- Scratch under `cache/scratch/p5/<name>/`; pack children write ONLY their assigned pack file (`p5:60-63`).
- Verifier outputs land as `verify/last-verify_avpacks.{log,json}` (the `verify/` naming already in use).
- Suggested module names (parent decides): `verify/av_bank_schema.mjs` (exports `AV_BANK_VERSION`, `AV_BANK_CAPS`, `validateAvBank`, `validateAvBankFile`, enum tables) · `verify/verify_avpacks.mjs` (witness + `--stamp`) · optional `verify/_check_avpack.mjs`.

## Undetermined (never guessed)
1. **Size caps + preset-count cap.** Not pinned in `p5`. PF: 20 MB hard / 10 MB soft (`schema:31-32`), patches ≤64 (`schema:209`). Anvil packs reach 100 presets → cap must be ≥100; authoring JSON packs will be ~10² KB. Parent to pin the numbers.
2. **`hint`/per-preset description.** PF patches carry `hint` ≤200 (`schema:127`); the `.avbank.json` pin has `name/section/tags/patch/seq` only — whether to add a hint field (cheap now, expensive later) is a format-pin decision.
3. **Range strictness vs `avdsp` clamps.** `AVDSP.setParam` clamps out-of-range numbers and returns true (`avdsp:455-528`); PF's "no silent clamp" law (`schema:25-27`) would demand the schema flag those values with exact ranges enumerated from `src/av_*.js`. Witness cannot catch it; decide whether the schema carries ranges.
4. **file:// fetch split.** The store "must work locally from `file://` + the test harness" (`p5:72-73`); PF's precedent needed a served origin (localStorage `forge-store-url` → local HTTP rig with CORS `*`, `cdps:84-98`, `183`). Exact split (relative fetch vs rig server) is a stage-1 brief decision.
5. **Immutable-vs-3600 pack caching** — live `.htaccess` (`ht:73-83`) vs T8 (`t8:165`) / annex05 (`annex05:64-67`). Anvil hosting must choose; PF never resolved it for `.pfpack/.pfsynth`.
6. **Calibration canary scope** for the Anvil witness — PF ran all factory voices first (`vp:343-420`); the P5 witness spec doesn't mention one. Recommend at least one known-good preset render before the corpus; parent to confirm.
7. **OfflineAudioContext + AudioWorklet (blob `addModule`) under `file://`** was not exercised in this read-only pass (`aveng:204-231` is the live-context path). The preview audition and the cdp_store rig must witness it.
8. **`test_live_site.mjs` refs are grep-sourced** (quoted lines exact); that suite may contain further pack assertions not enumerated here. Same for `build_packs2.py` (authoring-side, not a gate).
9. **Preview-file upgrade path** (Option B) — the T8 §15 conventions (`t8:170`) were never implemented in PF or anywhere verified here; if Anvil later ships rendered previews, the loudness/naming targets in T8 §15 remain unvalidated proposals.
