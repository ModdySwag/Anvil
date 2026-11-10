# Anvil 1.15.1 - for Windows

A small release on top of 1.15.0. Two things changed: PERFORM now does what its name promised,
and the boot sequence stopped leaving a tail of audio behind it.

## What's new

**PERFORM has an engine.** The page always said "velocity and key response for the performance
land here" - and then didn't. It does now, with two real controls on its VOICE panel:

- **Curve** shapes what you play into the engine, note by note. At the centre it is linear; turn
  it down and the quiet end of your playing gets quieter, so soft passages have somewhere to go.
  Turn it up and the response flattens toward full level. The mod matrix reads the same curved
  value, so anything routed from velocity follows it.
- **Key resp** is how far playing harder opens the filter. At zero it does nothing; at full it
  moves the cutoff about two octaves from soft to hard, centred on the middle of your playing
  range rather than on the extremes.

Both are per-patch, like every other control - a session or project remembers them.

It is measured, not asserted: the same note at the same input gain, three interleaved rounds,
with an analyser on the engine's own master output - soft 0.019, linear 0.058, hard 0.113 peak.
Ordered in every round.

**The first second after launch is cleaner.** 1.15.0 warmed the engine silently at start-up so
your first chord didn't stutter, but it restored the output after a fixed delay - which could
leave a release tail briefly audible if a voice was still ringing. It now waits for the voice
pool to actually empty before letting sound back out.

## In this release

- Anvil-1.15.1-Setup.exe - the installer. Per-user (no admin prompt), Start Menu entry and
  desktop shortcut, upgrades install straight over the top, clean uninstall from Add/Remove.
  Not code-signed yet: SmartScreen will say it hasn't seen this app before - More info, then
  Run anyway.
- Anvil-1.15.1-Setup.exe.zip - the same installer as a zip, byte for byte.
- Anvil-1.15.1-source.zip - the corresponding source for this build (AGPL-3.0-or-later).

## How this build was checked

All 28 app suites ran green on these bytes (hub 68 checks, fit 49, accessibility 37, sessions 65,
smoke 81). The desktop suite drives the packaged program - 32 checks, green. A silent install,
then an upgrade over the top, then an uninstall, left user data intact and the registry clean.

Bench on the packaged engine: realtime ratio 1.0, published 64 voices on the light tier, offline
knee at 96 pass / 128 fail and monotone, zero invalid reads. Alias suite complete.

The stress rig (ten minutes at 64 voices, real knob work, drain checks) reported 5 dropped audio
buffers in the whole run - 4 of them inside its deliberate unison over-drive probe, and **1 in
the first fifteen seconds**. On 1.15.0 the same window measured 0. That single buffer is 2.7 ms
in ten minutes, and the same window has measured 1, 7 and 10 across builds depending on what
else the machine was doing; it is recorded here rather than rounded away.

## sha256

  24068183c6a56dec6d89921cb9fda671fd285002c568e3a95d5cd07f4d7e26b4  Anvil-1.15.1-Setup.exe
      100,936,264 bytes

  3b40f4771e7b3a499fb91ef7a542fab011923b9b0ea755ceac200f1e53f283a4  Anvil-1.15.1-Setup.exe.zip
      100,457,332 bytes

  530fa355b21179544eafd2081e115cb066f00c6b018e4e0cb7428ed71a470cc5  Anvil-1.15.1-source.zip
      45,769,440 bytes

On Windows: `certutil -hashfile "Anvil-1.15.1-Setup.exe.zip" SHA256`. The exe inside unzips to
the first hash. The installer carries app build `ccaff458`, the same build that is live at
moddys.net/anvil.

The download page is also https://moddys.net/moddys-downloads.html.

Cheers Moddy !
