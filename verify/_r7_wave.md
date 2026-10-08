# R7 wave — the rail as a standard menu (collapsible sections) — contract

Owner ask (recorded in addendum 40b; screenshot `clip_20261008_205727_2`): make the left rail
SECTIONS collapsible/expandable ("menu tightenable") — standard menu design: chevron section
headers, independent open/closed state (persist it), tighter spacing, the Panels quick-view
group collapsible too; keep it fully functional.

Starting state: R6 frozen `37268aca` (3,461,742 B), deployed live. This is a page-side wave —
the worklet sha `d7f0ee41` must stay UNCHANGED.

## Design pins (locked)

- DOM per zone group: new header row `.av-rail-zrow` = chevron BUTTON
  `.av-rail-chev[data-zone][aria-expanded][aria-controls="av-rail-cards-<zone>"][aria-label]`
  (glyph span `.av-rail-chev-glyph` = "▸", CSS-rotated 90° when expanded) + the existing
  `.av-rail-zone` label button (keeps class/data-zone; click = jump ONLY — it no longer touches
  section state). The cards list keeps class `.av-rail-cards`, gains id `av-rail-cards-<zone>`.
- Panels section: `.av-rail-sec-head` becomes a BUTTON with `aria-expanded` +
  `aria-controls="av-rail-panels-body"`, containing a `.av-rail-chev-glyph` span + the "Panels"
  label; sublabels + boxes move into `.av-rail-sec-body#av-rail-panels-body`. Head click toggles;
  `.av-rail-sec.collapsed` hides the body. `#av-rail-panels` stays on the section element.
- State: LS `av-rail-sections` — JSON map, one key per zone (`synth fx mod seq studio store code
  system`) + `panels`, values 1|0. Seeded on first run (no key): active zone = 1, others = 0,
  panels = 1; materialized + persisted at init. After that only chevron/head clicks write it.
- Classes: `.av-rail-group.expanded` drives card visibility; the old `.on`-forces-open coupling is
  REMOVED (`.on` remains the active-zone highlight only). Zone accent map moves from
  `.av-rail-zone[data-zone]` to `.av-rail-group[data-zone]` so chevrons inherit it.
- Facade additions: `__avRail.sections()` (copy of the map), `.sectionSet(key, on)`,
  `.sectionToggle(key)`. Proof: RAIL SELFTEST JSON gains `sections` (expanded zone count) +
  `panels` (bool).
- CSS: tighter spacing (zone rows 7→5 px vertical, cards 4→3 px + indent 34→32, sec/prow/sublabel
  tightened), chevron in a 20 px column (zrow padding-left 6 + 2 px border = 18 px glyph centre;
  sec-head padding-left 8 = same centre), glyph transition .12 s (killed by the global
  `.av-reduce-motion *` rule).

## File ownership

- `src/av_rail.js` — rail module (single writer).
- `src/styles.css` — rail rules + the 8-line accent map swap.
- `verify/cdp_smoke.mjs` — two new checks after 6w (smoke 45 → 47).
- Parent owns build, freeze, the 20-file pin sweep, battery, commits, deploy.

## Gates

1. `python3 build.py` (no build.py changes needed) → new sha.
2. Smoke first-run green (`node verify/cdp_smoke.mjs`) — iterate on rig SPEC issues only.
3. Pin sweep: ALL 20 `verify/cdp_*.mjs` files carry the old full 64-hex literal exactly once each
   (rec = env/arg form, same literal) → counted-assert replacement, all-or-nothing.
4. Battery: 23 suites, one browser at a time, chain log `verify/last-battery-r7.log` via
   `cache/r1/battery_r7.sh`, then bench. Poll for `GATE-R7 DONE`.
5. Commit wave + records; deploy `anvil/index.html` + `anvil/sw.js` via
   `python3 upload-site.py --only` from radio-browser; `--verify` = 0 not in sync; live sha256
   equals the frozen build.
6. Addendum 41 + memory update. Carried list refresh.

## Rig contract (smoke, after 6w)

- Check 1 — rail menu: 9 `.av-rail-chev-glyph` total; the synth group: read expanded0/vis0/aria0 +
  the LS map (must contain all 9 keys); chevron click flips expanded, computed display
  (`flex`/`none`), aria-expanded and the LS `synth` value (1/0); second click restores; the zone
  label click still jumps (`__avZone.current() === 'synth'`).
- Check 2 — panels head: body display block → none → block; head aria-expanded true → false →
  (restored true); LS `panels` reads 0 while collapsed.
- The R4 rail check (8 groups, >= 20 links, proof ready/cards) and R5 quick-view check must stay
  green unchanged.
