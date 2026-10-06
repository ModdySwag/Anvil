# 02 — UI design brief (Anvil)

Date: 2026-10-06 · Sources: `research/ui/T7-ui-flair.md` (the craft research, 20 case studies + steal-list + palettes + screens), `01-design-doc.md` (direction), T0 seed, PF GUI conventions. This brief is the screen-and-feel contract for build; sections are written to be checkable against the live surface.

---

## 1. Purpose & product feel

The instrument should feel like a machine you want to touch: graphite-dark, precise, alive with signal, one teal identity — kin to the family (LCARS dashboard, Pattern Forge, zero-hud) but unmistakably its own instrument. Emotional targets, in order: **curious** (there's more under every control), **in control** (nothing moves without telling you why), **fast** (the next sound is one gesture away). Never feel like a web form; never feel like a toy.

## 2. Design principles

1. **One glance = one sound.** The Voice screen answers "what am I hearing and what can I twist" without navigation.
2. **Everything visible.** Modulation shows in ≥2 places (assigned chip + hover list; ring on the control + row in the matrix). The Massive X failure — modulation with no feedback — is a banned outcome.
3. **Instant, then deep.** No dialogue before the first note; no account; depth is discovered via ghost slots, tips and a 60-second tour — never gated.
4. **Search-first browsing.** The preset browser is the fastest thing we ship; search is the primary control.
5. **Precise feel.** The full knob/pointer contract (§5) on every control, everywhere — this is what "professional" feels like.
6. **60 fps or it doesn't ship.** Animation budget enforced; reduced-motion is a first-class setting.
7. **Fairness chrome.** No interstitials, no timers, no default-checked add-ons, ever.

## 3. The seven screens

1. **Voice (hero).** Hero canvas top-left (live wavetable morph + scope), three oscillator cards (signal-hued), filter + amp row; right rail: 8 macros + quick mod chips; acid "EXPANDED" panel folds out of the filter/drive area. Responsive: cards fold under 1180 px; work-area-relative heights (never fixed vh that fights the keyboard dock — PF law). Empty state: Init patch + dotted ghost slots.
2. **Mod (matrix/modular).** Same data, two views: canvas patch area (modules as cards, cables as bezier, zoom-to-pointer) ⇄ matrix table (source → destination rows, amounts, polarity, response curves). Drag source chips onto any control with **pre-drop audition**; hover a row floods the destination control elsewhere. Dotted slots add; Ctrl-drag duplicates; multi-select + Enter commits.
3. **Sequencer (groovebox heart).** Pattern grid first (16/32 steps; per-step gate/accent/slide per the DT303 lane semantics), piano-roll/clip view for longer ideas; swing, pattern bank, mutate, chains/song rows, scenes; step cells keyboard-navigable. Colour echoes mod-source hues.
4. **Mixer / FX.** Lane-based rack (drag-reorder), aux bus routing view, meter bridge with standard ballistics, relative-mode sliders in narrow channels, double-click text entry everywhere. Surgical and quiet — no faux-3D.
5. **Browser / Store.** Search-first with facets (type/instrument/tag/designer), favourites, playlists, similar-presets, preview ▶ per row (+ fallback clip, auto-preview, loading bar under heavy patches). Store tab obeys the fairness spine.
6. **Perform / Fullscreen.** Stage view: big macros, song/setlist navigation, large targets, one-click save/share; popout windows (keyboard, meters) via the family's existing PiP/popout machinery. Reload-guarded.
7. **Help / Tour.** Teaching layer, not a PDF: tooltips on everything from v1, contextual tips with optimal-range hints, the 60-second tour, outcome-named recipes, "?" keyboard overlay. Help never covers the instrument and never blocks the keyboard.

Persistent header on every screen: **preset name · undo/redo · A/B · CPU/voices + meter · master · help**.

## 4. Layout & information architecture

- Work-area-relative sizing with PF's priority ladder; sections collapse to rails before they squeeze (no peephole layouts).
- One screen = one job; modules not nested tabs.
- Popouts: keyboard, meters, sequencer can pop to their own always-on-top windows (family law: per-name alwaysOnTop list; PiP with named-popup fallback).
- Breakpoints: ≥1440 full; 1180–1440 fold cards under; <1180 rails + essentials.

## 5. Interaction grammar (the felt-quality contract)

- **Drag-source→target modulation with pre-drop audition** (hover = highlight, audition; drop = assign). Primary interaction of the whole app.
- **Hover tooltips** on every control: value, unit, and — if modulated — the list of sources.
- **Right-click power menu** on every control: Reset · Lock · MIDI Learn · Modulate · Bypass.
- **Fine-drag** (Shift or adaptive), **double-click text entry**, **wheel steps**, **arrow-key adjust** (keyboard-only path), **Ctrl/Cmd-click reset**.
- **Undo/redo for everything** (header, persistent); **A/B compare + copy**; **scoped Mutate** (undoable, subtlety slider).
- Section jumps (Alt+. / Alt+,), rebindable shortcuts, "?" overlay.
- Relative-mode sliders for narrow/side controls (pointer-delta, no value jumps).

## 6. Component inventory

Knob · relative slider · toggle · stepped chip · option row · XY pad (post-v1) · matrix row · mod-source chip · step cell · lane strip (FX) · meter · scope/canvas · browser row · store card · tag chip (with ✕ / Clear all) · tooltip · popover menu · dialog (rare; never before first sound) · toast · keyboard overlay · PiP window frame. All themed via the token file from day one.

## 7. Key flows

1. **First run:** land → audio-unlock tap (one gesture) → demo loop already playing (acid line, 138 BPM — the seed) → 6 live sliders visible → optional 60-second tour (4 stops: Play → tweak cutoff → drag an LFO → save & share). KPI: first tweak <30 s, first shared sound <5 min.
2. **Starters:** four outcome-named tiles — **Acid Line · Blade Runner Pad · Karplus Pluck · Cosmic Drone** — each loads a full patch + a skippable 30–45 s overlay (≤3 stops; name the sound, not the technique).
3. **Sound design loop:** browse/start → tweak → modulate (drag) → mutate/scene → save → share link.
4. **Groove loop:** step a pattern (acid lane default) → swing → chain → song → perform view.
5. **Content loop:** browser → audition preview → install pack → patch appears with tags/credit; export/import a pack file.
6. **Share loop (P0):** save patch → copy link (compact JSON) → recipient opens and hears it; QR for devices.

## 8. States

- **Empty:** dotted ghost slots (Mod), curated "start here" row (Browser), dashed hint cells (Sequencer), one action per pane.
- **Loading:** progress under preset name; honest engine-boot states (worklet/fallback tier chip).
- **Error:** honest, plain-language chips ("IndexedDB unavailable — session-only mode"); never silent failure (family law: an install that cannot persist is not "installed").
- **Success:** subtle (count changes + toast), no confetti; share = copy-confirm.
- **Permissions:** MIDI request with clear rationale + states (unsupported/denied/idle); no mic features.
- **Reduced motion / high contrast:** settings + `prefers-reduced-motion`; scopes become stills + numeric levels.
- **Offline / file://:** RAM-mode chip ("packs this session won't persist here") — honest, never blocking.

## 9. Visual direction

**Palette A — "Anvil Teal" (default).** Graphite base: page `#0A0E11` · panel `#10161B` · raised `#161F26` · hairline `#22303A`. Accent: teal `#2ED8C9` primary · deep `#0F8F85` (fills/states) · glow `#7FF3E8` (hover/active only). Text: `#E8F1F2` / `#9FB3BC` / `#6B7F8A` (tertiary never for live values). Modulation accents (Okabe-Ito subset, one hue per source, always chip+icon+label — never colour alone): sky `#56B4E9` · orange `#E69F00` · green `#009E73` · purple `#CC79A7` · yellow `#F0E442` · vermillion `#D55E00` · blue `#0072B2` (fills/curves; lighten to `#4C9FE0` for text). Contrast verified in-session: primary 16.9:1 on page / 15.9:1 panel; secondary 8.9:1; teal 10.9:1; deep teal 4.9:1; copper 7.3:1.
**Palette B — "Copper Forge":** same base, copper accent; teal reserved for signal. Ships as a theme variant, not a fork.
**Palette C — "Blacksite":** high-contrast near-black + amber, larger type preset — the low-vision/theatre mode.

**Typography:** UI = IBM Plex Sans or Inter (11/12/14/18/24 scale; micro-labels uppercase + letterspacing; ≥400 weight at 11 px). Values/mono = IBM Plex Mono with **tabular numerals** (no jitter under animation). Units always suffixed.
**Density & geometry:** 4 px baseline; control heights 24/32 (default)/40; 8 px minimum optical gap between clusters; hairline cards + 2 px accent caps; hit targets ≥24 px CSS (default 32); focus = 2 px teal ring (≥3:1).
**Motion budget:** DOM = transform/opacity only, 120/180/240 ms ease-out, no layout-thrash; canvas = one hero scope + small per-module scopes, dirty-rect redraws, ≤8 ms JS/frame; hidden-tab pause; reduced-motion = stills.

## 10. Accessibility gates (build checks)

Contrast pairs per §9 re-tested per theme · colourblind simulation pass in CI · zoom presets 100–200 % + persisted default + corner drag · vector-first rendering (no blur at any zoom) · keyboard-only path everywhere (tab order, arrows adjust, text entry, Enter commit, rebindable, "?" overlay) · Mirror-DOM for canvas widgets (phased, Voice + Mod first) · reduced-motion honored · no focus-obscuring tooltips (WCAG 2.4.11) · perf-as-a11y (jank budget enforced).

## 11. Anti-patterns (banned, with receipts)

Tiny handles/fonts · hidden modulation (Massive X) · mystery right-click-only power (mitigate with visible affordance hints) · raster blur when scaled (vector-first) · cramped chrome · clunky browsers · skeuomorphism that blocks workflow · modal hell / store spikes (never before first sound) · perf-hurting animation · overwhelm cliffs (Vital/Phase Plant lessons: ghost slots + starters + tips) · keyboard-hostile canvases · multi-click common actions (one-drag mod, one-click audition/A-B).

## 12. Top-10 flair moves (v1, value÷effort order)

1. Drag-to-modulate with pre-drop audition · 2. Modulation visualization layer (rings, animated amounts, hover-floods) · 3. Instant-play onboarding + 4 famous-sound starters · 4. The knob/pointer contract (fine/reset/type-in/wheel/keyboard) · 5. Preset browser craft v1 (search-first, facets, favourites, previews) · 6. Hero canvas + per-module scopes at 60 fps · 7. Theme system with CB/high-contrast variants · 8. Right-click power menu + context tooltips · 9. Undo + A/B + Copy in the header · 10. Scoped Mutate + harnessed chaos LFOs.

## 13. Content & copy notes

Name sounds, not techniques ("Acid Line", "Glass Pluck"); plain, craft-first tone; tips give optimal ranges, not lore; credit lines on every patch/pack; help text never blocks play. Easter eggs: three, subtle, Roland50-nod texture only.

## 14. Handoff notes

Build order: theme token file → header/shell → Voice → Browser → Mod → Sequencer → Mixer → Perform → Help/Tour. Every screen ships with its empty/loading/error states from day one (not bolted on). UI budgets measured (frame timings in the harness). Screens are re-validated against this brief with screenshots at 1440 + 1180 + 900 before sign-off — suite-green alone is not done (family rule: verify on the real surface).
