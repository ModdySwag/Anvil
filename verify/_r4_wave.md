# R4 wave - workspace controls: sectioned toggles, the left rail, float window controls

Date 2026-10-08 (third owner ask same day). Follows R1-R3.
Owner asks: highlight + "section" the top toggles for recognition; audit for missing window-menu
options and add them (close/minimise/save-to-workspace/pin/resize/stack/transparency/scroll-wheel);
a fully integrated LEFT module menu, hideable/resizable/pinnable like the rest; any other GUI matrix
that streamlines workflow.

## Deliverables
1. `src/av_rail.js` (NEW) - the left module navigator: 8 accent-dotted zone groups with their cards
   as jump links (switch zone + scroll); sticky head with hide button; right-edge resize grip
   (150-340px, persisted `av-rail-w`); open/hide persisted `av-rail-open`; hidden <1100px;
   `__avRail` facade + RAIL SELFTEST proof.
2. Sectioned toggles - each zone tab is a bordered chip with its own accent dot; the active tab is
   filled with its zone colour (multi-selector accent map adds the tab + rail elements).
3. Float window controls (`av_panels.js`): pin (keeps z on top), opacity cycle (button; wheel over
   the head cycles too), minimize (collapses to a title-bar row stacked in the left corner -
   "stacked without clutter"), maximize/restore, close (existing); named layouts -
   `avPanelsSaveNamed/LoadNamed` + palette "Workspace: save/load layout...".
4. Header NAV toggle + module-menu "Float / dock module" item; `body.html` wraps main in
   `.av-work` with the rail aside.

## Gates
- smoke 42 (rail + sectioned tabs + float controls + named layouts); full 23-suite battery on the
  frozen bytes; pins; bench; deploy + live verify -> addendum 39.
