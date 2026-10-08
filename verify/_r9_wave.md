# R9 wave — chrome completeness · knob/slider fluidity · osc PITCH+FINE — contract (as-built)

Owner asks (2026-10-08): (1) LEVELS lacks the module chrome (no collapse / menu / float) — audit
every card; (2) smooth knob + slider interaction a little for fluidity; (3) add industry-standard
options — 1. pitch oscillator, fully integrated.

As built, frozen `65b90976` (3,486,084 B):

- CHROME AUDIT: `AV_CHROME_CARDS` 20 → 23 — added `av-levels` (init:true), `av-family` and
  `av-roadmap` (the Roadmap card gained an id in body.html and joins the rail System group). Every
  zone card now carries head + collapse + menu + float (smoke asserts withHead === withFloat ===
  cards === 23; per-card buttons spot-checked for levels/family/roadmap). The hidden about-popover
  card is a popover surface, not a module — deliberately left as-is.
- FLUIDITY: knob drags now commit ONCE per animation frame (model still advances per pointer
  event; the release flushes the last value synchronously; the settle animation is unchanged) —
  a 120 Hz mouse or a busy frame can no longer stack DOM/engine writes. Range sliders gain
  `touch-action:none`. The feel mapping / weight / stop are untouched (knob_feel 18/18 green on
  the frozen bytes).
- PITCH OSC: VA osc1/osc2 PITCH (±24 st, step 1) + FINE (±100 ct, step 1) knobs — a new
  `av-synth-tune` row after the osc row. Engine already had `osc*.tune` (±24) — added `osc*.fine`
  with the fold law `tuneNF = 2^((tune + fine/100)/12)`; defaults + bank-schema paths
  (`osc1.fine`/`osc2.fine` N(-100,100)) added. WORKLET SHA CHANGED `d7f0ee41` → `b65160e0`
  (deliberate — av_dsp.js is worklet source); bench re-gated on the new worklet.
- Rig: smoke **51** (two new R9 checks: chrome completeness; pitch knobs bound + commit-funnel
  mirror + deferred-commit drag lands on release). Analytic witness `cache/r1/r9_pitch_node.mjs`
  **8/8**: fold law exact (tune1F === 2^(11.5/12) etc.) + rendered A4 measured by crossing count
  — 437.3 / 880.0 / 466.7 / 853.3 Hz (rig SPEC fix recorded: the first autocorrelation build had
  a 60-sample lag floor → octave errors above 800 Hz). Visual pass: `renders/r9-levels.png` +
  `renders/r9-tune.png` inspected at 2x.
- Gates: battery 23 suites ALL GREEN on the frozen bytes; bench exit=0 — offline knee 96/128
  monotone (publishable metric); realtime light 64 / fat 24 (loaded-window read; the fat cell has
  ranged 24–48 under load in this class). Deploy = index.html + sw.js; scoped --verify = 0 not in
  sync; live sha256 = the frozen build.
