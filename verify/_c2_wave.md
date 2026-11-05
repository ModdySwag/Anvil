# C2 wave — the inspector goes live

Plan of record: `docs/13-chassis-fsvr.md` §4 (the inspector column) and §6 (the wave table).
Predecessor: `verify/_c1_wave.md` (the chassis, frozen at `cd12b6936eb1`).

C1 built the inspector and proved it *exists*. C2 makes every part of it *do something*: the
kind keys change the engine, the six core pots reach the live voice, the two screens edit, the
scope shows the master tap, the launchers jump, and the POLY/MONO pair is a real voice mode.

## 1. What C2 changed

| File | Change |
|---|---|
| `src/av_inspector.js` | version c1.0 → c2.0. POLY/MONO now reads and writes `env.mono` through the param funnel (mirror-first, `avApplyParam`), and repaints from the mirror on the 200 ms tick. The oscillator screen resolves the LIVE wavetable frame: when the va engine plays an installed `wt.userN`, it draws one cycle of the actual frame (the WT card's current frame when that card is showing the same table, otherwise frame 0) and stamps `data-shape="wt"` + `data-wt="<name> #i/n"`. |
| `src/av_dsp.js` | `env.mono` is a real engine flag. `create()` allocates a 16 × 16 held-note stack per channel; `noteOn` in mono keeps ONE voice per channel (last-note priority) through the ordinary steal/retrigger path; `noteOff` returns the voice to the newest key still held, and releases only when the stack empties. `stats()` reports `mono`. `mono = 0` is the shipped polyphonic path, untouched. |
| `verify/cdp_chassis.mjs` | legs K16–K19 (see §3). |

No other file changed. `build.py`, `body.html`, the CSS and every card are untouched by C2.

## 2. The param contract additions

- `env.mono` — 0 = poly (default), 1 = mono. Written by the inspector pair, read by the band's
  LCD (`POLY|MONO <voices>`), consumed by `av_dsp`'s allocator. The LCD and the pair can never
  disagree: both read the mirror, and the pair is repainted every tick.
- The oscillator screen's `data-wt` — the live wavetable identity it is drawing. Absent when the
  screen shows a static oscillator shape (`data-shape` carries that instead).

Mono semantics, stated plainly: last-note priority with a held-note stack, per MIDI channel.
Releasing the newest key returns to the newest key still down (a 1.5 ms fade and retrigger through
the existing pending path); releasing the last key releases the voice. Legato (no envelope
retrigger) and a per-patch mono flag are NOT in C2 — see §5.

## 3. Rig legs (the gate)

`node verify/cdp_chassis.mjs` — 20 legs, all green on the C2 build:

| Leg | Proves |
|---|---|
| K16 | A kind key writes `engine.kind`: the param, `#av-synth-engine`'s value, the LCD engine row and the lit key all agree, and clicking WAVETABLE returns the engine to `va`. |
| K17 | A real pointer drag on the CUTOFF and LEVEL pots writes `filter.cutoff` and `engine.outScale` (the drag values move; the pots are not decoration). |
| K18 | POLY/MONO is a voice mode: two held notes give `stats().active = 2` in poly and `1` in mono with `stats().mono = 1`; releasing the newest key returns to the held one (active stays 1); releasing both reaches 0; POLY restores `env.mono = 0`. |
| K19 | The scope and LEVEL see the engine: a sounding note raises the scope trace's spread and ink (1 → 17 px), and the master-tap RMS falls from 0.265 to 0.013 as LEVEL goes 1 → 0.05. |

K1–K15 stay green unchanged. `cdp_smoke` 81/81, `cdp_fit` 49/49 on the same bytes.

## 4. Gates

- `cdp_chassis` green (20/20).
- smoke · fit green; cockpit green apart from the freeze pin, which is swept after the battery.
- The full battery + bench + alias + stress on the C2 bytes (`verify/battery_c2.log`).
- Owner eye pass on the live surface before the wave closes (his standing rule): band balance,
  inspector density, the pair's state, the wavetable screen on a real table, the scope under load.

## 5. Deliberate deviations / open

- **Latency + buffer in the LCD** (docs/13 §4 table row) has no cell: the pinned LCD is three rows
  (pack/preset · engine/poly · voices/CPU/tempo) and the engine exposes no buffer/latency stat of
  its own. Left out rather than squeezed in; it needs a contract change first.
- **Mono is not yet per-patch.** `env.mono` rides the param mirror but is not part of the pack/preset
  schema, so loading a preset does not restore a saved voice mode. The pair stays honest (it follows
  the mirror), and the flag joins the patch schema when the pack format next moves.
- **Legato** (return without an envelope retrigger) is the keyboard-layer port named in docs/03 §68,
  not C2. Mono here is last-note priority with retrigger.
- The C2 build sha supersedes the C1 freeze; the pin sweep lands with the battery close.
