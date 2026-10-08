# R5 wave - the menu bar + the rail Panels quick-view

Date 2026-10-08 (fourth same-day owner ask). Follows R1-R4.
Owner asks: a Windows-style top menu bar with every navigation/manipulation option; a left-hand
quick view showing what panels are open / in use / available, with drag-and-drop in/out of the
workspace, delete/restore at will.

## Deliverables
1. `src/av_menubar.js` (NEW) - File / Edit / View / Workspace / Help. Every item routes to an
   existing guarded engine action (save/open project, stems, demo groove; undo/redo + A/B; the 8
   zone jumps + piano + navigator + about; layout reset/desks/save/load; help/tour). Click-away +
   Esc close; `__avMenubar` facade + MENUBAR SELFTEST.
2. Rail Panels quick-view (`av_rail.js`) - a PANELS section under the rail head: OPEN (float rows
   with Minimize/Dock buttons), MINIMIZED (Restore/Dock), AVAILABLE (all 22 cards; float button;
   rows are draggable - drop anywhere on the workspace floats the panel at the drop point; drop on
   the rail floats it stacked-minimized). Live refresh via the `av-panels-changed` event dispatched
   by open/close/minimize.
3. `av_panels.js` dispatches `av-panels-changed`; app_core boots the menubar + proof; build part;
   smoke +2 (menubar, rail quick-view).

## Gates
smoke 44; full battery; pins; bench; deploy -> addendum 40.
