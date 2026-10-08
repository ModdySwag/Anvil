# R2 wave — module chrome + header utilities (Serum-2 module grammar)

Date 2026-10-08 · Parent build (no children; single-writer). Follows R1 (`verify/_r1_wave.md`).
Goal: every module card reads like a Serum-2 module — a real header bar with a menu — and the
header gains the browser + undo/redo utilities engineers expect. Engine strip gives the Synth zone
an OSC-A/B/C-style jumps row.

## Deliverables

1. `src/av_chrome.js` (NEW) — module heads (title + collapse toggle + module menu), the menu popover
   (Init / Randomize / Collapse), the engine strip in the Synth zone, header buttons (BROWSE, undo,
   redo). Facade `window.__avChrome = { version, init, initCard(id) -> n, randomizeCard(id) -> n,
   cards() -> [ids] }`.
2. `src/styles.css` — the R2 chrome block (head bar, menu, fold, engine chips).
3. `src/app_core.js` — `avChromeInit()` in boot (after the shell); boot log + `?avtest=1` proof
   (`CHROME SELFTEST` at `#av-chrometest`).
4. `build.py` — `av_chrome.js` part after `av_shell.js`.
5. `cdp_smoke.mjs` — two new checks (6q: chrome surface; 6r: fold + Init through the knob funnel).
6. Pin sweep + full battery on the new frozen bytes; commit.

## Pins

- DOM: `.av-mod-head` (one per chrome card, DIRECT child of the card) · `.av-mod-toggle`
  (aria-expanded) · `.av-mod-menu-btn` (aria-haspopup) · `#av-mod-menu` (fixed popover, `.open`)
  · `.av-engine-strip#av-engine-strip` with 6 `.av-engine-chip[data-target]` in
  `#av-zone-synth > .av-zone-box` (first child after the first-run strip insert point)
  · `#av-head-browse`, `#av-head-undo`, `#av-head-redo` in `header.av-head`.
- Chrome cards + capabilities (id -> init/rnd): av-synth Y/Y · av-fm Y/Y · av-fx Y/N · av-mod Y/N ·
  av-drums Y/N · av-sample Y/N · av-chop Y/N · av-wt Y/N · av-seq N/N · av-mix N/N · av-deck N/N ·
  av-rec N/N · av-studio N/N · av-sessions N/N · av-comp N/N · av-deliver N/N · av-store N/N ·
  av-code N/N · av-files N/N · av-midi-card N/N. Every chrome card gets Collapse.
- Init = every `.av-knob[data-knob]` inside the card returns to `data-def` THROUGH the one commit
  funnel (`avKnobCommit`) — never a second write path.
- Randomize = range/step-clamped values through the same funnel (synth + fm only).
- Fold state persists in `localStorage["av-fold"]` (JSON map cardId -> true).
- Header: BROWSE hides/show the store zone via `avZoneShow('store')` + focuses the store search;
  undo/redo call `avUndo()` / `avRedo()` (typeof-guarded).
- a11y: every created button has a text label or aria-label (the P7 unnamed-count check must stay 0).

## Laws / watch-outs

- Heads MOVE the existing h2 into the head bar (text preserved; no id/class removed).
- The engine strip never changes engine state — it jumps only (the ENGINE select stays the source
  of truth).
- Every created control is inert until clicked; no boot-time side effects on audio or params.
- No `</script` in the new source; no non-ASCII in source (build guard style).

## Gates

- smoke (37 checks, incl. 6q/6r), cdp_cockpit, full 23-suite battery on frozen bytes; pins to the
  new sha; bench + stress; then R3 (polish + deploy).
