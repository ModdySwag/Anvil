# Anvil - a MODDYS Foundry synthesizer (single-file web app)

A synth-and-groovebox in one `index.html`: acid, wavetable, FM, string, drum, granular and
sampler engines; a native step sequencer with chains, song rows and scenes; a seven-slot FX rack
with a drag-to-modulate matrix; a tuning studio; an import pipeline and a searchable library for
your own sounds; a store with 10 packs / 580 presets; and a recording desk that exports WAV,
stems, MIDI and Song Bundles. Free, local-first, no accounts, nothing uploaded. A sibling of
Pattern Forge (the Strudel-powered workstation at moddys.net/forge), from the same workshop.

**Designed, built and maintained by Modtech** (a.k.a. **Moddy**) - an original work: over 94,000
lines of HTML/CSS/JS in `src/`, no framework and no bundler beyond its own `build.py`.

- Live app: **https://moddys.net/anvil/** (free, in the browser, installable as an app)
- Windows app: **the 1.15.0 beta** - download the installer from
  [moddys.net/moddys-downloads.html](https://moddys.net/moddys-downloads.html) or
  [Releases](https://github.com/ModdySwag/Anvil/releases); each build ships with its
  corresponding source (AGPL-3.0-or-later).
- GitHub: **https://github.com/ModdySwag/Anvil**
- Correspondence: **modtech@gmail.com**
- (c) 2026 Modtech (Moddy) - free software under the **GNU AGPL-3.0-or-later** licence
  (see `LICENSE`).

Shipped file: **4,604,527 bytes**, sha256
`6ac4425b8d42fa583b8d2b17b04629039f00491c3890a98c3209dd26e93fa02e`; the deployed copy at
moddys.net/anvil is byte-identical to the built local file (checked 2026-10-09).

## Screenshots

The Windows build, captured from the app itself:

![Anvil - the cockpit: the SYNTH zone, the module rail and the console](TODO-SHOT-URL-1)
![Anvil - the Import & Library overlay: search, facets, bulk actions](TODO-SHOT-URL-2)
![Anvil - the TUNE card and the scale library](TODO-SHOT-URL-3)

## Quick start

1. Open **https://moddys.net/anvil/** - or run the Windows app, or double-click `index.html`
   from a local copy.
2. Press PLAY (Space does the same), install a pack from the store and load a preset, and play
   the 61-key dock at the bottom with your mouse or a MIDI keyboard. `Ctrl+K` opens the command
   palette; `?` shows the shortcut map and the tour.

Rebuilding: `python3 build.py` concatenates `src/` into `index.html` and syntax-checks the
result before writing - the sha256 and byte count it prints are the release identity. The
headless verification suites need Node 21+.

## What it does

- **Seven engines, one instrument** - ACID (the 303 lineage: 4-pole ladder, accent memory,
  slide), wavetable (2,048-sample mipmapped frames, a built-in editor and your own tables), FM
  (6 operators, 8 algorithms), STRING (Karplus-Strong), DRUM (a full kit engine), GRANULAR
  (Hann grains and position/rate clouds) and SAMPLER (one-shot, loop and multisample zones).
  Layer them, split them, switch them per part.
- **A sequencer, not a toy** - a step-object model: per-step velocity, gate, slide, accent,
  probability, ratchets, micro-shift and parameter locks; per-track length (1-64) and speed for
  polymeter; swing; Euclidean generation; pattern chains, song rows and scenes; live
  recording.
- **A seven-slot FX rack and a real mod matrix** - drive, the flavours bank (console / tape /
  drive / air / warm), modulation, delay, plate reverb, convolution and dynamics; drag any
  modulation source onto any knob, with macros and per-voice modulation.
- **The tuning studio** - 12 authored microtuning scales, Scala `.scl` / `.kbm` import, a scale
  library and a scale editor, per-part tuning, and live MTS SysEx receive.
- **Your sounds, imported and kept** - WAV, MP3, AIFF, REX2 and MIDI read directly, plus EXS24,
  SXT, Kontakt, Ableton Live and Serum material - and it tells you honestly when it can't.
  Everything lands in a searchable library (facets, bulk actions, duplicate checks, linked
  folders).
- **A store that is checked** - 10 factory packs / 580 presets, every file sha256-verified
  against the store index before it installs, then kept offline.
- **A studio at the end of the chain** - record takes, comp them, build a mixdown with bus glue
  and a master chain (normalize and dither), A/B it against a loudness-matched reference, and
  export WAV (16/24/32-float), stems, MIDI and a Song Bundle.
- **CODE** - write your own engine modules against the documented module API and run them in
  the audio worklet, with a local module library.
- **Play it for real** - a full 61-key dock with a popout window, full Web MIDI in and out, MPE
  per-note expression, CC learn, Alt+1..8 zone switching, undo/redo, and the Ctrl+K palette
  over every command.

## The Windows app

The 1.15.0 beta is the same instrument in its own window: no browser, no tabs, a per-user
installer (no admin prompt) and an uninstall that keeps your data by default. It starts and
plays with no network at all. The installer is not code-signed yet, so SmartScreen will say it
hasn't seen the app before - More info, then Run anyway. Your sounds live in
`%APPDATA%\Anvil`.

From source it is the usual page plus the desktop pipeline: `python3 build.py` rebuilds
`index.html` from `src/`, and the Windows build under `windows/` stages that file into the
Electron shell and runs the installer script against it.

## Files

- `index.html` - the app (double-click to open; installable as an app from Chromium browsers)
- `build.py` - regenerates it from `src/` (`python3 build.py`) and syntax-checks the
  concatenated JavaScript with `node --check` before writing
- `src/` - `head.html`, `styles.css`, `body.html` and the `av_*.js` parts in a fixed order; a
  new part must join `build.py`'s `js_parts` list or it never ships
- `verify/` - the headless CDP suites: the battery, the perf bench, the alias rig, the leak
  probe
- `packs/` - the ten factory packs and `index.json` (the store)
- `windows/` - the Windows app: the Electron shell, the installer, and the build and test tools

## Verification

Headless, over CDP, against the frozen build, before any deploy. On 1.15.0 the battery is 27
suites, all green first-lap: smoke, cockpit, studio, sessions, comp, mix, knob_feel, keys, midi,
sample, rec, fx, seq, store, bounce, deck, s4, s5, code, m1, m2, platform, a11y, import, hub
(68 checks), tune and fit (49). Plus the perf bench (the voice ramp), the aliasing rig and the
leak probe - 11 checks that no test output can reach the plain page - 11/11 on the built file
and on the live site.

## Privacy & safety

- **No telemetry, no analytics, no accounts.** Nothing leaves the machine unless you ask it to;
  the only remote calls are the ones you trigger (the family bridges to moddys.net, or a link
  you open yourself).
- **Your work stays yours.** Projects, sessions, samples, packs and settings live in your
  browser's local storage and IndexedDB - and in `%APPDATA%\Anvil` in the desktop app. Exports
  are plain files (WAV, MIDI, `.anvl`, Song Bundles); the desktop build saves them straight to
  your Downloads folder. Nothing is uploaded.
- **The store is static files, and it is checked.** Every pack download is hashed in your
  browser with `crypto.subtle` against the sha256 published in the store index; a mismatch
  aborts the install.
- **Free software.** GNU AGPL-3.0-or-later; no monetisation and no locked features.

## License

**Anvil (c) 2026 Modtech (a.k.a. Moddy)** - modtech@gmail.com -
[github.com/ModdySwag/Anvil](https://github.com/ModdySwag/Anvil) -
[moddys.net](https://moddys.net)

Anvil is free software under the **GNU AGPL-3.0-or-later** (see `LICENSE`). It is an original
work: no third-party code text is included in the build. The acid and ladder filter designs
follow published open references (Open303, MIT; MoogLadders, Unlicense) and are re-implemented
as the project's own clean text.

Thanks for checking out Anvil. Enjoy the instrument :) Cheers Moddy !

---

## TODO for review

- The screenshot URLs (three in the release notes, three here) are tokens until the desktop
  capture run lands (`windows/shots/`); the repo needs a `screenshots/` folder if the raw
  GitHub URLs are used.
- Sizes and sha256s in `windows/RELEASE-NOTES-1.15.0.md` and `windows/downloads-card-draft.md`
  are TODO tokens until the build lands.
- The setup artifact name (`Anvil-1.15.0-Setup.exe`) follows the D wave contract; if the
  build pipeline renames it, update the notes, the card and their zip/source names together.
- Release tag assumed `v1.15.0-beta` (the card and this README link it) - confirm before
  publishing.
- "Installable as an app": the PWA install path needs the app served (https or localhost)
  - true of moddys.net/anvil and the desktop shell, not of a raw `file://` double-click.
