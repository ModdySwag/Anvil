# anvil-modules — 19.2 s module tour

Real captures of the packaged Windows app (stage build, v1.15.1), sequenced through the nine
zone tabs in signal order with a HyperFrames composition.

## Output

`out/anvil-modules.mp4` — 1920x1080, H.264 (High, yuv420p), 30 fps, 19.2 s, 576 frames, no audio.

## How it was made

1. **Capture** — `tools/capture_zones.mjs` launches `windows/stage/Anvil/Anvil.exe` with
   `AV_TEST=1 AV_DEBUG_PORT=9391` (single-instance lock: no other Anvil may be running), sets
   `Emulation.setDeviceMetricsOverride` to 1440x900 at deviceScaleFactor 2, presses the app's own
   FIRST SOUND control (loads + plays the demo groove) and then clicks each
   `#av-tab-<zone>` in turn, capturing the viewport 2880x1800 PNGs into `captures-demo/`.
   `perform` uses its `voice` sub-tab and `system` its `code` sub-tab, because the default
   sub-states on a zero-pack install are near-empty.
2. **Assets** — each capture is Lanczos-downscaled to 1760x1100 into `assets/shots/`.
3. **Composition** — `index.html` (HyperFrames, GSAP paused timeline on `window.__timelines.main`).
   Title card 0–2.35 s, then nine 2.02 s clips on a 1.8 s step (0.22 s cross-dissolve), each with a
   slow 1.0→1.05 push-in on the screenshot, a lower-third label and a nine-mark rail tick.
4. **Render** — `npx hyperframes render . --quality delivery -o out/anvil-modules.mp4`
   (HyperFrames 0.9.29, screenshot capture, hardware GPU).

Re-run: `npx hyperframes check .` (0 errors; the only warning is the expected silent-film one),
then the render command above.

## QC

`qc/final-1.0.png`, `qc/final-7.0.png`, `qc/final-13.6.png`, `qc/final-18.9.png` — 1:1 frames from
the delivered MP4; `qc/nine-modules.jpg` — one mid-module frame per zone in order.
