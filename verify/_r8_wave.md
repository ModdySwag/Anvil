# R8 wave — MOD DRAG-TO-MODULATE + matrix grammar — contract

Owner ask lineage: docs/10-cockpit-redesign.md §5.4 ("drag a source chip (LFO/ENV/MACRO/…) onto
any knob; ring feedback; matrix restyled to the Serum column grammar"). Carried in every R-wave
list since R1. Starts from R7 frozen `24491edd`. Page-side wave: the worklet sha `d7f0ee41` must
stay UNCHANGED.

## Design pins (locked)

- **Drop map v1 (AV_MOD_DROP_MAP)** — only the knob paths that reach a pinned engine target:
  `filter.cutoff` → cutoff · `filter.reso` → reso · `osc1.level` → osc1.level ·
  `osc2.level` → osc2.level. pitch and pan have no page knob (engine-level / vibrato only) —
  matrix-only, recorded. Other knobs are refused honestly via the status line.
- **Chips** (`avModSrcStripHTML`, SOURCES section in the mod card): 14 buttons
  `.av-mod-chip[data-src]` draggable=true, one per AV_MOD_SOURCES entry, `--chip` colour per
  family (env green · lfo purple · vel yellow · key sky · rand grey · macros orange). Click shows a
  drag hint in the status line.
- **Drag plumbing** (document-level, bound once by `avModBindDrag`, guarded by a document flag):
  dragstart on a chip → `avModDragBegin(src)` = body class `av-drag-modsrc` + `.av-mod-target`
  halo on every mappable knob + dataTransfer `text/av-modsrc`; dragover on a mapped knob →
  preventDefault + `.av-mod-droppable`; drop → `avModAssign(src, path)`; dragend/drop →
  `avModDragEnd()` clears everything. Never throws; floats/re-renders covered (delegation).
- **Assign law**: ONE slot per (src, dst) pair. Existing pair → amt re-defaults to +0.5; else
  append `{amt: 0.5, curve: 0}`; full → refuse + status "matrix full — 32 slots". Returns bool.
- **Mod ring** (`avModSyncRings`, rides avModPost so EVERY model change repaints): mapped knobs
  with ≥1 incoming slot → class `av-mod-shown`, `data-mod="<src>:<amt>[ +n]"`, CSS vars
  `--mod-span` (|amt|×270°) + `--mod-color` (first slot's source colour); no slots → class/attr
  removed. Ring element `.av-knob-mod` added to avKnobHTML (hidden by default; the knob is
  already position:relative).
- **Matrix grammar**: header row `.av-mod-hdr` (SOURCE · CURVE · AMOUNT · POL · DESTINATION ·
  OUT) + row reorder to match; POL = new button `[data-slot-pol]` flipping amt sign; OUT = new
  cell `[data-slot-out]` reading the macro mirror ("42%") for macro sources, "—" for per-voice
  sources (no page value exists — honest). Existing classes/attrs kept (`av-mod-src/-dst/-amt/
  -curve/-del`, data-slot-* fields); the arrow span is dropped.
- Grid columns + `overflow-x:auto` on `.av-mod-slots` (narrow floats scroll; the flex-wrap era
  ends — accepted, recorded).

## File ownership

- `src/av_mod.js` — bulk (chips, drag, rings, grammar, status).
- `src/av_knob.js` — the `.av-knob-mod` element (one line in avKnobHTML).
- `src/styles.css` — chip/halo/ring/status/grammar styles (the `.av-mod-slot` rule is replaced,
  not duplicated).
- `verify/cdp_smoke.mjs` — two R8 checks (47 → 49).
- Parent owns build, freeze, pin sweep, battery, deploy.

## Rig contract (smoke)

- Check 1: 14 chips; synthetic DnD (DataTransfer + DragEvent ctor) dragstart env1 → body class +
  4 `.av-mod-target`; dragover on filter.cutoff → `.av-mod-droppable`; drop → +1 slot
  {env1→cutoff}, knob `.av-mod-shown` + display:block + data-mod, row count matches; class state
  cleaned after; refusal leg: env2 dropped on filter.envAmt → no slot added.
- Check 2: hdr grammar tokens present; amt 0.2 → re-drop re-defaults to 0.5 single-instance; POL
  click flips 0.5 → −0.5 and the button reflects; macro1→reso slot + avModMacroSet(0.42) → OUT
  reads "42%"; cleanup removes both slots + macro, ring clears, 0 rows remain.

## Gates

build → smoke first-run → 20-file pin sweep (counted-assert) → battery 23 suites (one browser,
chain `cache/r1/battery_r8.sh` incl. REAL bench) → visual probe (r8-modring screenshot, inspected)
→ commit → deploy index.html+sw.js → scoped verify 0 not in sync + live sha → addendum 42.

## Carried (updated)

Keyboard assign path for chips (a11y), animated rings (needs an engine→page mod value stream),
widen AV_MOD_TARGETS (wire v2), kind-specific drop paths (acid.cutoff etc.), wider knob surface.
