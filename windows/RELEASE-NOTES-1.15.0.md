# Anvil 1.15.0 (beta) - for Windows

The first Windows release of Anvil - the whole instrument, in its own window.

Anvil is a synth-and-groovebox you can actually play: acid, wavetable, FM, string, drum,
granular and sampler engines in one instrument; a native step sequencer with chains, song rows
and scenes; a seven-slot FX rack with a drag-to-modulate matrix; a tuning studio (12 scales,
Scala .scl/.kbm import, live MTS SysEx receive); an import pipeline and a searchable library for
your own sounds; a store with 10 packs / 580 presets; and a recording desk that exports WAV,
stems, MIDI and Song Bundles. It is the same app as the free in-browser version at
moddys.net/anvil - this is that app in its own window, by itself. It is a MODDYS Foundry
instrument and a sibling of Pattern Forge.

A look at the Windows build:

![Anvil - the cockpit: the SYNTH zone, the module rail and the console](https://raw.githubusercontent.com/ModdySwag/Anvil/main/screenshots/anvil-cockpit.jpg)
![Anvil - the Import & Library overlay: search, facets, bulk actions](https://raw.githubusercontent.com/ModdySwag/Anvil/main/screenshots/anvil-hub.jpg)
![Anvil - the TUNE card and the scale library](https://raw.githubusercontent.com/ModdySwag/Anvil/main/screenshots/anvil-library.jpg)

## What's new

- **The desktop build itself.** Anvil opens as a normal Windows program now - no browser, no
  tabs. It serves its own files from an internal loopback address (what the audio worklet, the
  clipboard and local storage want), grants MIDI and autoplay up front, and asks for nothing
  else.
- **The instrument inside it is app build 1.15.0**, with the newest app work included: the
  Import & Library overlay (search-first, with format and pack facets, bulk actions and row
  preview), the library overlay's resize / minimize / maximize controls, and the header fit fix
  - on top of the finished instrument (the tuning studio, acid step accents, the fill toggle,
  full undo coverage, boot templates, a multi-tab save note, and tempo/root/key auto-tags from
  WAV metadata).

## In this release

- Anvil-1.15.0-Setup.exe - the installer. Per-user (no admin prompt), Start Menu entry and
  desktop shortcut, upgrades install straight over the top, clean uninstall from Add/Remove.
  It is not code-signed yet, so SmartScreen will say it hasn't seen this app before - More
  info, then Run anyway.
- Anvil-1.15.0-Setup.exe.zip - the same installer as a zip, byte for byte: the exact file
  moddys.net/moddys-downloads.html serves.
- Anvil-1.15.0-source.zip - the corresponding source for this build (AGPL-3.0-or-later): the
  app build frozen into the installer, the src/ tree it is assembled from, the Electron shell,
  the installer script, and the build and verification tools.

## Good to know

- Windows 10/11, 64-bit. Everything the app needs is inside the install - the engine, all ten
  packs, the help and the walkthrough - so it opens and plays with no network at all. The only
  online parts are the family bridges (importing a Resonance Studio pack, the World Radio
  hand-off), and those go out only when you click them.
- Your projects, sessions, takes, installed packs and settings live in %APPDATA%\Anvil. The
  installer never touches that folder; the uninstaller keeps it by default and asks before
  deleting anything - installing again picks up where you left off. Nothing is sent anywhere.
- Verified on this exact payload: the desktop suite driving the installed program
  (31 checks - the worklet engine tier, a note played with a master-tap
  witness, MIDI, the library overlay, zero page errors) and a silent install -> upgrade-over
  install -> uninstall journey (28 checks) that leaves your data intact. The
  build inside the installer is byte-identical to the one live at moddys.net/anvil (6ac4425b);
  the app's own gates ran green first-lap (27 suites, hub 68 checks, fit 49; bench and alias
  clean; the leak probe 11/11, file and live).
- This is a beta - if something breaks, tell me: modtech@gmail.com.

## sha256

  2b83ded4c00e6c7d934b8c1a68827a61b29b62ea00ddc83af36c4be064f7a9da  Anvil-1.15.0-Setup.exe
  18da99f75f8ff85dcb60fc0839a9cc566f3580b14a43a625a0da0a2f267bacb7  Anvil-1.15.0-Setup.exe.zip
  5dcea21ac5b6403239640bdbb5f27a1d6b8ff1dc44dc34a8682fc3cf0aff1037  Anvil-1.15.0-source.zip

The download page is also https://moddys.net/moddys-downloads.html.

Cheers Moddy !
