# Anvil — CONTINUATION (2026-10-06)

Project home: C:\Users\Moddy\anvil (renamed from forge-synth; if an empty `forge-synth`
folder still lingers it is a file-handle artifact — delete it whenever Windows lets you).

## Status: Phase 0 started — scaffold + build pipeline + shell DONE
- Plan package complete & owner-decided (docs/00–05). Decisions: **name Anvil · free ·
  granular+sampler in v1 · phase order locked** (03 §6 revised for grain/sampler).
- Build tree live: `build.py` (explicit js_parts order · `</script` guard · strict
  `node --check` parser guard · sha identity), `src/{head.html,styles.css,body.html,app_core.js}`,
  `verify/`, `harvest/`, `renders/`.
- **index.html built: sha256 2fc8e71862d20361add6f43500cc722618029217e3f8ff8bc2cfe9f7e47828e0** (shell)
- First-light screenshot: `renders/p0-shell.png` (Edge headless, 1440×900).
- Git repo initialized (main); commits: P0 scaffold + P0 build/shell.

## Done since first pass
- **Master tap PORTED** → `src/av_tap.js` (destination-getter install; KEYS bus → MASTER gain → speakers;
avKeysFor/avMasterNodes/avMasterApply/avKeysApply + meter attach; offline renders excluded from live registry).
- **index.html rebuilt: 15,291 bytes · sha256 8ec7f726ccd417d77ec8be7ebfbd85638e4ed3b246911f632d00286d57d557f9**
- Runtime proof: open `index.html?avtest=1` → TAP SELFTEST line shows viaTap/keysBus/masterNode true (headless Edge screenshot `renders/p0-tap.png`).

## Next (Phase 0 remainder)
1. ~~Master tap port~~ **DONE (av_tap.js)** — extend with avKeysFor usage when the engine lands.
2. **Knob framework port** (PF app_knob.js → av_knob.js) + feel suite.
3. **Harness port** — CDP launch laws (1440×900 device metrics, --mute-audio, temp profile,
   explicit exit) + smoke suite (boot → `data-av-ready` → chips filled → zero console errors).
4. Theme polish against 02 §9; header/help stubs.
Then **P1**: mixer AudioWorklet + PolyBLEP/wavetable osc + SVF + env/LFO + voice pool →
**run the T5 §7 proof benchmark — the measured voice count is the first publishable number.**

## Laws (do not drift)
- lab → battery → frozen bytes → deploy; nothing ships without a witness report.
- Verifiers own their AnalyserNode on the master tap; keep a-rate worklet params single-digit.
- No console windows on Moddy's desktop; one writer per file; contracts per stage.
- Licences: Open303 (MIT) = acid DSP foundation; dittytoy = clean-room (CC BY-NC-SA);
  content = own/CC0/PD (see docs/05 §3 for the re-check list).

## How to build
`python3 build.py` → prints bytes + sha256. Add any new src part to js_parts or it never ships.

## Open later-phase decisions (docs/05 §2)
P1 backend green-light (default Cloudflare Workers+D1+R2); embed stance (default links-only);
CC0-only community rule (default yes); MP3 export module (default WAV+Opus; MP3 optional).


## Session close — 2026-10-07 (~444k context; start fresh)

This session delivered: Brave-tabs research → full plan (docs 00–06, all verified) → owner decisions
(Anvil · free · granular+sampler in v1) → Phase 0: scaffold, build pipeline, shell, **master tap (verified)**,
GitHub goldmine wave (G1–G3). Session stat: $3.64 over 71 calls.

### Start the next session with (in order)
1. **KNOB FRAMEWORK PORT (av_knob.js)** — source already scouted (re-read for detail):
   - Feel engine: `C:\Users\Moddy\pattern-forge\src\app_knob.js` (333 lines) — drag/twist arbitration
     (6 px slide / 9 px rim-twist; rim = startR > rad*0.35), damped travel (0.40→2.0× over 260 px),
     settle animation, wheel/click/dblclick/arrow-key, at-min/at-max/at-stop states, aria-slider.
   - Skin: `pattern-forge\src\styles.css` "rotary knobs (Minimoog-style pointer caps)": ring =
     conic-gradient(--knob-arc, 270° span), face radial-gradient, mark rotate(-135 + norm*270). Reskin to
     Anvil tokens (teal/graphite); skip the marantz variant for now.
   - Port decisions: av-namespace (avKnobHTML/Bind/Commit/RefreshAll/NormToVal/ValToNorm/Format/ApplyVisual/RowHTML);
     commit hook = `avApplyParam(path,v)` if defined, else avParams map + CustomEvent 'av-param';
     drop hub*/snapshot/koalaHint (optional guards).
   - **Demo wiring (first live controls):** LEVELS card with INSTRUMENT + MASTER knobs → avApplyParam('keys'|'master')
     → avKeysApply/avMasterApply (tap gains). Extend `?avtest=1` to commit a knob + assert.
   - build.py js_parts becomes [av_tap.js, av_knob.js, app_core.js]; append knob CSS to src/styles.css.
2. **CDP HARNESS + SMOKE suite** — port PF launch laws (cdp_smoke.mjs pattern): device metrics 1440×900,
   --mute-audio, temp --user-data-dir, explicit exit; smoke = boot → data-av-ready → chips filled → tap armed → zero page errors.
3. **P1 — worklet voice engine**: one mixer AudioWorklet, PolyBLEP + wavetable oscillators, TPT SVF, env/LFO,
   voice pool + oldest-first steal → then run the T5 §7 proof benchmark and publish the measured voice count.

### State at close
- commits: be4da47 (scaffold) · d54000a (build+shell) · 5b816ad (G-wave) · 72cd49f (tap) · + this note.
- index.html sha256 8ec7f726… (15,291 B) · tap selftest ✓ (renders/p0-tap.png) · tree clean at commit.
