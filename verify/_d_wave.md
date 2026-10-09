# D wave contract — ANVIL FOR WINDOWS (desktop app + installer + publishing)

Owner ask (2026-10-09): package Anvil as a downloadable Windows application with a full
installer, open source, "the same format as the rest of the apps" (Pattern Forge, Resonance
Studio): a GitHub repo + release, a moddys.net downloads entry, the same journey discipline.

State at open: R22 CLOSED + LIVE (frozen `183d1588b3c694e72abc95f3542a788139f6de980369c2c40c99021dff197f25`,
app 1.14.0 "R22 - library ux"; commit f484bec). Reference implementations on disk:
- `C:/Users/Moddy/pattern-forge/windows/` — the PRIMARY reference (sibling web synth).
- `C:/Users/Moddy/webmusic-hub/windows/` — the NEWEST shell (Resonance Studio; the
  installer-authoring skill documents its reusable shape: LOOPBACK-origin serving + env hooks +
  Inno per-user + rcedit stamp + install_journey).
Read both before authoring; port the best of each; name every deviation in your report.

## Global laws (all children)

- Children NEVER run build.py / git / browsers / suites / the installer; `node --check` on your
  own .mjs/.js, `python3 -m py_compile` on your own .py, plus reads/stat calls. Write-first
  (complete file to disk, then iterate). ASCII-only source. One writer per file. Source wins on
  conflicts with a pin -- name it. No console windows anywhere (spawns use hidden/CNW rules).
- The Anvil app tree is served over a LOOPBACK origin by the shell (a secure context is what
  AudioWorklet + clipboard + a stable localStorage origin need). Every reference shell already
  does this; port it, never switch to file://.

## 1. Deliverables + file ownership

| # | files | work |
|---|-------|------|
| D1 | `windows/app/main.js` + `windows/app/preload.js` + `windows/payload/package.json` | the Electron shell, ported + Anvil deltas |
| D2 | `windows/tools/build_windows.py` + `windows/installer/anvil.iss` + `windows/version.json` + `windows/tools/make_icon.py` + `windows/icons/` | staging + Inno per-user installer pipeline |
| D3 | `windows/tools/test_desktop_app.mjs` + `windows/tools/install_journey.py` + `windows/tools/take_desktop_shots.mjs` | the desktop test rig + the install journey + screenshots |
| D4 | `windows/RELEASE-NOTES-1.14.0.md` + `README-DRAFT-ANVIL-V1.md` (repo root) + `LICENSE-ANVIL-DRAFT.txt` + `windows/downloads-card-draft.md` | release drafts for the owner's review (his rule: drafts reviewed before any push) |
| P | build + test + journey + publish | parent |

## 2. Pins -- D1: the shell

- Identity: productName "Anvil", appId `net.moddys.anvil`, exe name `Anvil.exe`, publisher
  "Modtech", homepage https://moddys.net/anvil/, version `1.14.0` (from windows/version.json).
- `windows/version.json` (D2 owns the file; D1 reads it for identity -- do not duplicate): same
  field set as the PF reference, with Anvil values: name "Anvil", version "1.14.0", appId
  "net.moddys.anvil", publisher "Modtech", publisherUrl "https://moddys.net", appPage
  "https://moddys.net/anvil/", downloadsPage "https://moddys.net/moddys-downloads.html",
  authorEmail "modtech@gmail.com", github "https://github.com/ModdySwag/Anvil", license
  "AGPL-3.0-or-later", copyright "(c) 2026 Modtech (Moddy)", electron "40.10.2" (the version the
  PF payload ships; reuse the local Electron cache -- never download at build time if a cache
  exists), appBuild "183d1588", appBuildBytes + appBuildSha256: stat/sha256sum the repo's
  index.html and record them; appBuildNote "R22 - library ux" + a one-line gate summary the
  parent supplies at integration (leave a clearly-marked TODO the parent fills).
- Anvil-specific shell behavior (pin these; port the mechanics from the references):
  - LOOPBACK serve of the staged app tree with env hooks: APP_TEST / APP_DEBUG_PORT / APP_PORT /
    APP_OFFLINE / APP_DL_DIR equivalents (port the reference naming exactly, prefix-adjusted).
  - Permissions: grant MIDI + midiSysex (Anvil is full Web MIDI in/out); autoplay allowed
    (no-user-gesture-required); media not needed; probe + note FSA (showDirectoryPicker) behavior
    as a desktop edge note in the report (the hub's LINKED SOURCES uses it).
  - `window.__AV_DESKTOP = true` (preload; the app may gate desktop-only paths on it later) plus
    a `window.__AV_SHELL` info object (version, electron, servePort) -- additive keys only.
  - Single-instance lock; window default 1500x950, min 900x650 (the header design floor is 800);
    background color #0b0f12; title "Anvil".
  - Downloads (the library EXP action downloads files): wire session will-download to save into
    the OS Downloads dir WITHOUT a dialog; report the exact mechanism.
  - Keyboard: keep the app's shortcuts working (Ctrl+R reload allowed); no default menu bar
    (Menu.setApplicationMenu(null) or the reference's choice -- port it).
  - No console windows; all spawns hidden.

## 3. Pins -- D2: build + installer

- `windows/tools/build_windows.py`: port the PF script; it must: verify index.html hashes to the
  appBuildSha256 in version.json BEFORE staging (refuse otherwise, loud); stage the Electron tree
  to windows/stage/Anvil with resources/app/ holding the frozen app build (index.html + sw.js +
  manifest + icons + packs/ + inbox.html + whatever the deploy set carries -- mirror the PF
  staging list, reconciled against what Anvil's index.html actually fetches); then run ISCC with
  /DAppVersion /DVersionInfoVersion /DAppBuild; write the Setup into windows/out/.
- `windows/installer/anvil.iss`: port the PF ISS shape exactly: stable AppId GUID (generate ONE
  and pin it -- never change it again), per-user install (PrivilegesRequired=lowest,
  {autopf}\Anvil), Add/Remove entry, licence page (AGPL-3.0-or-later), /VERYSILENT friendly,
  uninstall keeps user data by default (CurUninstallStepChanged offers, never forces, removal of
  %APPDATA%\Anvil), lzma2/max compression, rcedit-stamped exe.
- `windows/tools/make_icon.py` + `windows/icons/`: port from PF/Resonance; source the Anvil icons
  from the repo's icon-512.png (the app's own icon -- keep the family look honest, do not invent).
- version.json pins are in section 2.

## 4. Pins -- D3: rigs + journey + shots

- `windows/tools/test_desktop_app.mjs`: port the PF desktop rig; drive the STAGED exe over CDP
  (APP_DEBUG_PORT hook). Anvil checks (keep the ported reference checks + these): app boots to
  data-av-ready over loopback:__PORT; ANVIL.version reads 1.14.0; the engine worklet reaches
  "worklet" tier with 64+ voices (read `__avEngine`); a note plays with a master-tap witness
  (port the analyser seam from `verify/cdp_sample.mjs`); MIDI permission granted (feature-detected
  via navigator.requestMIDIAccess when present); the library overlay opens (R22: `__avLibrary`
  snap) and the header renders 15 buttons (fit law); zero page errors. Target a single green
  DESKTOP-RESULT line + exit code.
- `windows/tools/install_journey.py`: port the PF journey: silent install -> assert the installed
  resources/app/index.html hashes to appBuildSha256 + build-info reads -> run the desktop rig
  against the INSTALLED exe -> upgrade-over install (user data survives, ONE Add/Remove entry) ->
  silent uninstall -> folder + registry clean, %APPDATA%\Anvil intact. Mind the elevation law:
  this host's shell may be elevated -- check and note what the journey does about it (the
  installer-authoring skill documents the runas /trustlevel route); the PARENT runs it.
- `windows/tools/take_desktop_shots.mjs`: port for the release shots (boot, hub, library overlay
  with the R22 chrome) into windows/shots/.

## 5. Pins -- D4: release drafts (owner reviews before ANY push)

- `windows/RELEASE-NOTES-1.14.0.md`: house voice (match the PF RELEASE-NOTES-1.0f.md structure).
- `README-DRAFT-ANVIL-V1.md` (repo root): the public README in Moddy's voice -- LCARS/PF repo
  style: one-line tagline, What it is, What it does, Quick start (download + install), Privacy &
  safety block (local-first, no telemetry, free), build-from-source line, Cheers Moddy ! sign-off.
  Natural human voice, never AI-voiced. NO em-dashes from an AI register -- read PF's README first.
- `LICENSE-ANVIL-DRAFT.txt`: the repo's LICENSE currently (WRONG) reproduces Pattern Forge's
  text ("Pattern Forge -- a Strudel-powered music workstation"). Draft the Anvil replacement
  (AGPL-3.0-or-later, "(c) 2026 Modtech (a.k.a. Moddy)", home + GitHub lines). Keep the exact
  licence body the PF LICENSE uses.
- `windows/downloads-card-draft.md`: the moddys-downloads.html card draft -- copy the PF/Resonance
  card structure (read the live page: curl https://moddys.net/moddys-downloads.html) with Anvil
  values; mark the parent-TODO spots (asset URLs + sizes + sha) with TODO tokens.
- Do NOT touch LICENSE itself, git, GitHub, or the live site -- drafts only.

## 6. Parent integration + gates (after children land)

1. Reconciled artifact checks (existence, node --check, py_compile, pins grep).
2. Fix the repo LICENSE from the draft; commit "D wave open + children" as usual (explicit paths).
3. Stage + build: python3 windows/tools/build_windows.py -> windows/out/Anvil-1.14.0-Setup.exe;
   record size + sha256.
4. Desktop rig against the staged tree (green DESKTOP-RESULT), fix edge diffs (worklet tier,
   MIDI, downloads) with focused follow-ups if red.
5. Journey on this host (de-elevated per the skill note), then the release drafts -> owner review
   -> GitHub repo ModdySwag/Anvil + tag v1.14.0-beta + Setup asset + source zip + README/licence
   -> moddys.net downloads card + verify live.

## 7. Watch-outs

- Escape hazard: after any patch whose text contains escape sequences, byte-verify (repr) before
  continuing; repair with chr(92)-built matchers.
- Builds are NOT byte-reproducible (Inno embeds timestamps): hash post-build, never promise a
  stable hash across rebuilds.
- Unsigned installer -> SmartScreen "unknown publisher": expected; note it in the release notes.
- Stale ADMIN installs of the same appId would glom (journey law) -- Anvil has none today.
- The staged payload must carry EXACTLY what the app fetches (packs/ tree, inbox.html, icons,
  manifest) -- reconcile against the deploy set + a quick fetch-log pass in the desktop rig.

## 8. Report shape (every child)

- files touched + exact edit set; per-file static check output (node --check / py_compile);
- reference deltas (what you took from PF vs Resonance and why); pins reconciled against source;
- an Undetermined list.
