# T7 — UI/UX flair: interaction craft + visual cues for Anvil (evidence file)

Date: 2026-10-06 · Author: Bob (Hermes, deepseek profile) · Status: read-only research; single write = this file.
Scope: what the best synth UIs *do* (behaviour, not art), mapped to Anvil's screens; palettes/type/density; onboarding; a11y; anti-patterns; top-10 flair moves.
Builds on (read first, not redone): `pattern-forge/GUI-LAYOUT-REVIEW.md` [PF-LAY] · `moddys-music-suite/research/depth/D4-gui-control-surfaces.md` [D4] · `anvil/research/tabs/T0-tab-digest.md` [T0].
Family facts: teal is Moddy's colour; family tools are dark, precise, dense (LCARS dashboard, Pattern Forge, zero-hud). Anvil must feel family but be its own instrument.
Provenance: all sources fetched live 2026-10-06 via browser/read unless marked **(snippet)** (search-result excerpt; page blocked or rate-limited) or **(Wayback)** (Internet Archive copy). Dead ends logged §Dead ends.

---

## CASE STUDIES — interaction patterns with sources

### 1. Serum 2 — drag-to-modulate & direct manipulation (the core interaction model)

**Links:** https://www.musicradar.com/music-tech/plugins/a-copy-of-serum-might-be-the-smartest-investment-any-budding-producer-makes-xfer-serum-2-review · https://musictech.com/reviews/software-instruments/xfer-records-serum-2-review/ · https://xferrecords.com/web-manual/serum-2/using-knobs-and-sliders · https://static.xferrecords.com/Serum%202%20What%27s%20New.pdf

**Core contribution:** The pattern the whole market copied: any modulation source can be dragged onto any control; the control itself is the patch bay; power lives in right-click menus on every knob.

**KEY FACTS**
- "Serum took a particularly user-friendly approach to its varied modulation tools too, allowing users to click and drag elements to quickly route a source to a destination" (MusicRadar). Modulation setup is "very user-friendly" (MusicRadar verdict list).
- Right-click any knob/slider → menu assigns one or more modulation sources (ENV 1, LFO 2…), bypass/remove one modulator, or remove all; plus **Reset Control** and **Lock Parameter** ("prevents a value change when loading presets", manual still adjust) (Xfer manual).
- Tooltips on hover; hovering a modulated knob **lists its modulation sources** (e.g. CUTOFF shows LFO 3 + ENV 2) (Xfer manual).
- What's New PDF: "Direct Manipulation — directly adjust controls (racks and modules) using the graphical display"; "Comprehensive undo and redo"; 3 oscillators × 5 modes, 13 FX + 3 splitter modules, 8 macros (What's New).
- Caveat from a positive review: "Many features like this are hidden within right-click menus, so be sure to explore" (MusicTech) — discovery is the price of menu power.

**Fold-in verdict:** ADOPT — this is Anvil's modulation grammar from day one: drag source → target, hover-preview, right-click menu on every parameter, tooltips that enumerate assigned sources.

---

### 2. Serum 2 — resizable UI, raster lesson, and the theme/skin ecosystem

**Links:** https://xferrecords.com/web-manual/serum-2/resizing-the-ui · https://xferrecords.com/forums/general/serum2-graphics-resolution-quality · https://coloverecordings.com/serum-2-skins-update-1-3-collaboration-with-xfer-records/ · https://www.reddit.com/r/serum/comments/1sbr84u/211_themejson_skin_creation_tools/ **(snippet)**

**Core contribution:** Scale handled as a first-class setting (menu presets + drag + "set as default"), and a user-theming layer (`theme.json`) that turned skins into a cottage industry — with sharp complaints where raster art meets non-100% scales.

**KEY FACTS**
- Resize: drag the lower-right corner, **or** click the logo → menu of sizes; "Set x% as Default"; "Default (100%)" to reset (Xfer manual). Forum evidence: crisp to 200% on 2160p; "Above that, certain raster graphic elements begin to look a little blurry"; "I need to use 150% … and the text is a little fuzzy"; one Mac user: "every resolution except 100% is blurry" (Xfer forum).
- Themes: from Serum 2.1.0, `theme.json` exposes "all colors and palette accents"; skin makers ship palette *variants* "without breaking the overall UI consistency" (COLOVE, Feb 2026, collaborating with Xfer). Community thread tracks "missing parameters from theme.json and the future of custom skin support through creation tools" (r/serum, snippet).
- Lesson: scale + theme = retention features (people rebrand their studio); raster-first rendering taxes them.

**Fold-in verdict:** ADOPT (scale menu + persisted default + zoom via corner) and REFERENCE (token-file theming, later); design **vector-first / resolution-independent** so no zoom level is blurry — the Xfer forum thread is our anti-pattern receipt.

---

### 3. Serum 2 — preset browser & preview workflow

**Links:** https://xferrecords.com/web-manual/serum-2/loading-a-serum-preset · https://static.xferrecords.com/Serum%202%20What%27s%20New.pdf · https://monosounds.studio/serum-2-preset-browser/ **(snippet)** · https://www.reddit.com/r/serum/comments/1kbmjnx/serum_2_possible_to_move_sidebar_on_brower/ **(snippet)**

**Core contribution:** A preset browser that behaves like a record shop: instant previews per row, fallback audition clips for presets without one, quick subfolder arrows, and loading feedback for heavy patches.

**KEY FACTS**
- Preview: click ▶ per preset — plays the preset's embedded MIDI preview clip if the designer supplied one, else a **fallback clip** (3 standard options); optional **auto-preview** while browsing (Xfer manual). What's New: "Quickly search and preview presets"; "Enhanced Presets Browser … feature-rich browser".
- Navigation: `-Init-` menu, then `< >` arrows to step through a subfolder "without having to repeatedly display the presets menu"; heavy multisamples show a **green progress bar** under the preset name while loading (Xfer manual).
- Contents (snippet): 626 factory presets; browser supports search, categories, tags, ratings, preview (Monosounds guide, snippet). KVR user review: "Perfect distance between all knobs, minimal necessary menus" (snippet).
- Complaint (snippet): sidebar not movable left/right; "browser in S2 is very powerfull but i cannot read package name coz is c[ramped]" (r/serum).

**Fold-in verdict:** ADOPT — preview-on-row + fallback clips + auto-preview toggle + folder step arrows + load progress; and make our browser survive cramped widths (responsive rows, ellipsis + hover expansion).

---

### 4. Vital — pre-drop modulation audition + "see everything" visualization

**Links:** https://vital.audio/ · https://davidmvogel.com/docs/Vital/UserGuide/Modulation · https://davidmvogel.com/docs/Vital/UserGuide/Global-Controls-and-Header-Bar · https://www.vitalsynth.com/categories/skins · https://www.musicradar.com/music-tech/soft-synth-showdown-repub

**Core contribution:** The best teaching device in modulation UX: while you *drag* a source, parameters that can be modulated light up, and hovering a target **auditions the modulation before you commit**.

**KEY FACTS**
- "See everything… animated controls, filter responses, waveforms, smooth LFOs, oscilloscopes, spectrograms" (vital.audio).
- Drag-and-drop modulation: "the parameters that can be modulated will be highlighted… you can audition the modulation by hovering over the target while playing. **The mapping will not occur until you release the mouse**" (Vital docs).
- After mapping: click source → see targets; hover target → see source + amount; amounts adjust like a knob; **Matrix tab** shows every mapping (source/dest popups, on/off, polarity, amount, linear/log response, Mod Remap) (docs).
- Context menus: macro → Set Default / Learn MIDI / Enter Value; target → "Disconnect from [target]", "Disconnect All" (docs).
- Skins: community directory tagged free/paid; theme packs ship inside preset packs — theming is part of the pack economy (vitalsynth.com).
- Review texture: Ease-of-Use 3/5, Value 5/5; "getting rather greedy when things become more complex"; "depth of modulation can feel overwhelming at first" (MusicRadar showdown; PluginNoise snippet).

**Fold-in verdict:** ADOPT the pre-drop audition + highlight-affordances + Matrix-as-truth; ADOPT upload of skins/theme economy later. Overwhelm critique → progressive disclosure (see §4 onboarding).

---

### 5. Kilohearts Phase Plant — modular lane clarity & blank-slate affordances

**Links:** https://kilohearts.com/docs/phase_plant · https://www.musicradar.com/music-tech/soft-synth-showdown-repub

**Core contribution:** Modularity that reads as clean structure: one text/documented layout — top bar (patch name/author/description + Browse + Undo/Redo), macro row, Generator area, effect Lanes, modulation strip — with empty space that invites clicking.

**KEY FACTS**
- "Click in the dotted area in the unused generator space to add modules"; generator area holds up to **32 modules**; modules "can be moved and copied by dragging and dropping. **Hold ctrl/command while dragging to make a copy**"; Snapin lanes: click the empty space at a lane's bottom or above/between Snapins to insert (kilohearts docs).
- 8 large macro knobs; any macro can route to several parameters; Undo/Redo buttons in the top bar "undo or redo all actions" (docs).
- Showdown: "no 'what's that bit' or 'why is that there'… Everything is here in the chain because you put it there, making it great for learning about sound design"; "Visualisations are detailed, informative and attractive"; best-in-class verdicts — **Flexibility 5, Ease-of-Use 4 (top of the roundup in both)** (MusicRadar).
- Honest docs tell users "It may look a bit overwhelming at first, so let's try to break it down" — expectation management as UX.

**Fold-in verdict:** ADOPT dotted-slot affordances, ctrl-drag copy, always-visible macro row + undo/redo, and lane-based FX structure; the modular view is our "Mod" screen skeleton.

---

### 6. Arturia Pigments — Play View, color-coded workflow, in-context teaching

**Links:** https://www.arturia.com/products/software-instruments/pigments/overview · https://www.gearjunkies.com/2026/02/gearjunkies-review-arturia-pigments-7/ · https://musictech.com/reviews/software-instruments/arturia-pigments-7-review/ · https://www.arturia.com/products/software-instruments/pigments/sound-design

**Core contribution:** The two-tier instrument: a **Play View** that is the picture of the patch (animated, audio-reactive, macros on top, editing grouped at the bottom) over a deep Synth View — plus colour used as navigation (one hue per modulation source).

**KEY FACTS**
- Play View redesign (v7): "The window is now largely occupied by an animated visualization: each sound category has its own animation that reacts to the shape and color of the audio signal. The macros, more prominent than before, are layered over this animation, while editing commands are grouped at the bottom" (Gearjunkies).
- Marketing spec: "color-coded interface, reactive Play View, and drag-and-drop modulation — designed for fast, fluid sound design without breaking your flow"; "color-coded modulation sources make it easy to see where you are and what's connected at a glance" (Arturia overview).
- Numbers: 6 engines / 3 engine slots / 68 filter modes / 20 FX / 1700+ presets; v7 added 150 presets, 50 wavetables, and **integrated tutorials**; **Sound Design Tips** describe each control, **Edit Tips** suggest optimal parameter ranges for the patch (MusicTech; Arturia).
- Critiques: "Clunky patch browser", filtering "a little fiddly", though "algorithmic Similar Presets" helps; only 2 oscillators (MusicTech).

**Fold-in verdict:** ADOPT Play/Perform layer + colour-coded sources + tips-in-context (per-control help and optimal-range hints); browser must not inherit the "clunky/fiddly" verdict — ours is search-first (§1 steal table).

---

### 7. Roland50.studio — delight via constraints; skeuomorphic homage with texture

**Links:** https://roland50.studio/about · https://yurisuzuki.com/projects/roland50-studio · https://musictech.com/news/roland50-studio-free-tb-303-tr-808-sh-101/

**Core contribution:** Three machines, each rendered as its simplest honest interface, with playful physical texture — proof that constraint + a few micro-details beat feature parity for first-impression joy.

**KEY FACTS**
- "simplified interfaces of some of Roland's iconic instruments": 808 = tempo/shuffle + grid; 303 = cutoff, resonance, envmod, decay, accent; SH-101 = pulse/saw + sub, LPF, one-fader envelope, arp; shared grid sequencer; record → name → download **.mp4** (MusicTech).
- Micro-texture: "when you click the play buttons, you hear the recorded physical sound of the button being pressed on an original machine, and the record function metronome countdown is from a real 303" (Yuri Suzuki project page).
- Lineage: 808303.studio (Design Museum exhibition companion) → Roland50 (MusicTech).
- Platform claim: "a professional sounding online musical interface, which records your masterpieces and allows you to share your creations" (roland50.studio/about).

**Fold-in verdict:** ADOPT constraint-first "one face per machine" for starter modes; ADOPT one or two texture details (tasteful, default-off audio clicks); REFERENCE the share/export flow. The homage principle: simplify the *face*, keep the *sound* honest.

---

### 8. Ableton Learning Synths — teaching-first UI, and its measured failure mode

**Links:** https://learningsynths.ableton.com/ · https://www.ableton.com/en/blog/learn-synthesis-in-your-browser/ · https://www.theverge.com/2019/6/30/19154134/ableton-learning-synths-interactive-browser-electronic-music · https://nomadjames.com/pdfs/ableton-learning-synths-cognitive-walkthrough.pdf

**Core contribution:** A browser synth whose primary screen teaches: sequential lessons ending in a Playground, with interaction design that ties every control to audible result — plus a cognitive-walkthrough critique we should internalise.

**KEY FACTS**
- Free, browser-based, "comes with its own step-by-step lessons… at your own pace" (Ableton blog); lessons run amplitude/pitch → envelopes/LFOs/oscillators → **Playground** with presets and sequences; drag-and-drop sliders; MIDI keyboard in Chrome; works on mobile Safari (The Verge).
- Real UX research on it (Dishman, cognitive walkthrough): "interactions clearly relate the concepts to audio, which accelerates learnability"; site "succeeds at sequential learning but creates discovery barriers" for outcome-driven users — recipes ("West Coast Lead") are buried, and technical labels like "Envelopes: CHANGE OVER TIME" don't connect to the user's goal; recommends "**outcome-oriented labels or preview signifiers** that connect foundational concepts to recipe outcomes".

**Fold-in verdict:** ADOPT progressive lessons + playground; ADOPT the critique as design law: name starters by *outcome* ("Acid line", "Blade Runner pad"), not by technique ("LFO page").

---

### 9. FabFilter — the knob/curve interaction standard (and the paperwork behind it)

**Links:** https://www.fabfilter.com/help/twin/using/knobs · https://www.fabfilter.com/help/pro-q/using/eqdisplay · https://www.fabfilter.com/help/pro-q/using/undoredo · https://blog.fortunes.io/fabfilter-we-create-the-tools-that-wed-love-to-use-ourselves/ **(Wayback)** · https://prod.fabfilter.com/forum/topic/846/twin2-envelopes-non-ergonomic

**Core contribution:** The most completely documented parameter grammar in audio software — four ways to turn any knob, reset conventions, and displays that preview what a click will do — plus evidence of them iterating on ergonomics for 15+ years.

**KEY FACTS**
- Four knob modes: vertical drag ("reacts to the speed with which you are dragging, so if you move the mouse slowly, you make precise adjustments"); rotate mode (precision grows with drag distance from the knob); mouse wheel; text entry (double-click). Cursor over a knob lights it and pops name + value (FabFilter help).
- Reset: Ctrl/Cmd-click; Pro Tools alt-click convention respected. Fine: Shift while dragging/wheel (Pro Tools: Ctrl/Cmd-drag) (help).
- Pro-Q display intelligence: hovering shows a "subtle curve preview" of the band a click would create; bands selected → preview becomes dashed (single click deselects instead of creating); Alt = dynamic band, Alt+Shift = spectral (help).
- A/B rails: A/B toggle saves state before switching; **Copy** duplicates active → inactive and disables itself when both states are equal (help).
- Design stance: "we heavily started focussing on user interaction and workflow" (interview, Wayback); forum, 2007: "We think the 3D look is very 1995"; a 2009 envelope-handle complaint ("aggravatingly tiny") got "We'll make the EG handles larger" — ergonomics measured in handle pixels.

**Fold-in verdict:** ADOPT as the mandatory floor: all four modes on every control, reset/fine conventions, hover previews on graphs, A/B with Copy. Also steal the *policy* habit: write our conventions down and honour DAW muscle memory.

---

### 10. Arturia — preset browser craft (Analog Lab / Pigments system)

**Links:** https://audiotechpro.pl/wp-content/uploads/2026/06/ARTURIA_AnalogLab-5-11-1_MANUAL_EN.pdf (Analog Lab manual) · https://www.arturia.com/products/software-instruments/analoglab/overview · https://musictech.com/reviews/software-instruments/arturia-pigments-7-review/

**Core contribution:** The most complete library model shipped in a synth plugin: five views (Main / Library / Studio / Stage / Instrument), filter facets, favourites, playlists built for live, and a similarity engine.

**KEY FACTS (Analog Lab manual unless noted)**
- Library sidebar: **Home · Explore · Sound Banks · Store · Favorites · Playlists**; Explore filters by Types (Bass, Piano…), Instruments, Sound Banks, Sound Designers. Grid ⇄ list toggle. Sort by **Liked (heart) / Name / Type**; active tag chips each carry an ✕ plus "Clear All".
- Saving a preset stores more than a name: "Author's name, select a Bank and Type, assign multiple tags… even create your own Bank, Type, and comments" — read back by the browser in later searches.
- **Similar Presets** button: "find variations to your chosen Preset… press again for even further examples". **Stage View**: "simplified and focused view to use when performing live", driven by playlists/songs.
- In-app **Store** is a sidebar citizen (buy sound banks without leaving); Pigments marketing: "Expandable with the sound store".
- Review caveats: Pigments browser called "clunky"/"fiddly at filtering" (MusicTech) — the system is rich; execution must stay fast.

**Fold-in verdict:** ADOPT facets + liked + playlists + similar-presets; ADOPT tags-as-user-data (our CC0 packs can advertise by tag); Store = later phase (fairness spine: no dark patterns).

---

### 11. Valhalla DSP — the minimalism manifesto (dense-clean is a philosophy, not a style)

**Links:** https://valhalladsp.com/2017/05/25/minimalism-in-plugin-guis/ **(Wayback)** · https://valhalladsp.com/manifesto **(snippet)** · https://www.musicradar.com/news/tech/meet-the-programmers-valhalladsp-579815

**Core contribution:** The clearest written doctrine for a restrained tool UI: exactly-what's-needed GUIs, 2D honesty, and usability as the first design constraint.

**KEY FACTS**
- "a plugin should have exactly what is needed to do the required job. Adding extra stuff in there complicates the situation. Plugins are tools, and an ideal tool is easy to pick up and use right away."
- Origin story: Kristin's mockup — circles for knobs, line segments for pointers, sans-serif labels; "I looked at the mockup, and said 'THAT'S IT!!!'".
- "A plugin isn't a 3D object… It doesn't need screws to hold it together. A plugin GUI is just an idea actualized into pixels of light on a 2D screen."
- Influences: the Swiss School (Müller-Brockmann, Tschichold) — "looked like they could be screen printed, using a few colors".
- Interview: "Usability is the most important part of the interface. My goal is to create a GUI that's easy to use, quick to navigate **and self documenting**" ; manifesto (snippet): "We crave clean lines, space and underlying order… remove anything that will slow you down."

**Fold-in verdict:** ADOPT as the counterweight to feature-creep: every screen passes the "what can we delete" test; no fake depth; self-documenting controls. Anvil is dense — but density must be *ordered* (ladder/grid), never decorative.

---

### 12. Elektron (Overbridge software) — hardware ethos, fixed in release notes

**Links:** https://www.elektron.se/release-notes/overbridge-release-notes · https://www.red-dot.org/project/elektron-overbridge-15048 **(snippet)**

**Core contribution:** The plug-in side of hardware instruments shows what "precise" looks like in maintenance: tiny interaction fixes, relative-mode controls, name-your-parameter menus, and visuals that must move when values change.

**KEY FACTS (Overbridge release notes)**
- "**Added name of right-clicked parameter to menu**" — context menus must say what they act on.
- "**All level sliders now use relative motion** for consistent behavior" — pointer-delta sliders, not absolute jumps.
- "The Preset Browser tab now uses all available window space" — reclaim space from chrome, not from content.
- "Added ability to **preview samples with space key**"; "Support for **200% zoom**"; a "Waveform & Metering panel" with scaled signals and gate indicator.
- Bug-fix class worth copying: "The Start Phase indicator in the LFO graph did not move when the parameter was adjusted" — a dead indicator is a defect, not a nit.

**Fold-in verdict:** ADOPT relative-drag sliders (esp. for narrow vertical controls), context-menu naming, space-to-audition, metering panels, and the defect class "indicator must reflect state". Hardware-ethos = instrument-grade polish, not wood grain.

---

### 13. Teenage Engineering — playful restraint ("no fuzz")

**Links:** https://xlr8r.com/gear/qa-teenage-engineering/ · https://blog.haigarmen.com/2019/01/18/research-note-006/ · https://teenage.engineering/products/op-1/original/features

**Core contribution:** Playfulness as an on-ramp, not decoration: every control tactile and organised; animations fun and weird *after* the mental model is clear; fun within the first minutes as an explicit goal.

**KEY FACTS**
- "our design has a 'no fuzz' philosophy, with as little design as possible. Simple geometry, basic color palette, and accommodating for everyone" (Oscar Ahlgren, XLR8R).
- Constraint-first: their devices' "UI and how to operate [them] came about before the LCDs were on the boards, so we kind of made it work without the LCDs. This made room for…" — the screen animates ideas the instrument already worked without (XLR8R).
- Kouthoofd (via Push Turn Move, quoted by Haig Armen): "Suppose you have an endless canvas to work on — the result is that you can't even start. If your choices include everything, you're [nowhere]"; "They are a bit ugly, funky and raw. If we had a design perspective on things, we would never release a product like that."
- "most people can end up creating music loops and have fun **within the first few minutes** of playing around. You can't say that about a lot of new instruments." (Haig Armen)
- OP-1 features: "**six unique sequencers doing only one task each**"; instant sampler; 4-track tape (teenage.engineering).

**Fold-in verdict:** ADOPT one-task-one-tool for select modes (e.g. pattern tools), playful micro-animations, and "fun in the first minutes" as a launch KPI. Keep the no-fuzz geometry: basic palette, clear grouping, dual-purpose controls only where the mental model stays obvious.

---

### 14. VCV Rack — patch UX at scale, from the community's own mouths

**Links:** https://community.vcvrack.com/t/vcv-2-ux-improvement-suggestions/15075 · https://community.vcvrack.com/t/somebody-should-design-a-new-module-browser/21698

**Core contribution:** A working field study of cable/zoom/browser conventions from the most modular interface most users touch — and a shop-floor reminder that search-first and quick-delete are the features everyone actually uses.

**KEY FACTS**
- Cables: right-click a cable → context menu (colour selection); delete = unplug and release; a user: "I don't find having to shift click cables to delete them very convenient"; middle-mouse as delete was mourned when removed.
- Canvas conventions debated: some want scroll = zoom; counter-argument "mouse wheel always does a vertical scroll [in] a lot of software". The accepted multi-tool scheme: "Scroll: pans up-down · Shift+Scroll: pans left-right · Ctrl+Scroll: zoom · pinch: zoom · two-finger drag: pan" (Inkscape-like, community-posted with wide agreement). Zoom-to-mouse exists.
- Keyboard: arrow-key panning critiqued — "No one naturally has their hand on the arrow keys… WASD would be a better control scheme"; rebinding requested.
- Module browser: request thread with concrete spec — Shift/Shift+Ctrl multi-select, **Enter to commit**, then actions: add to patch / remove / favorite / un-favorite / hide / copy list. User research excerpt: "**Search is the most used feature**"; "most users will not use features that require multiple clicks unless [it] adds new utility, or speeds up a process"; favourites "would be a much more viable feature" with a hotkey.

**Fold-in verdict:** ADOPT search-first browser, keyboard-committable selections, fast cable/patch deletion, zoom-to-pointer, and a rebindable keymap. When our manual is done, run a VCV-style "somebody should" thread *ourselves* — the complaints are free product research.

---

### 15. dittytoy — instant play, sliders-from-code, share-by-link (cite T0)

**Links:** [T0-tab-digest.md §2–4] · https://dittytoy.net/

**Core contribution:** The seed pattern for Anvil's first impression and sharing model: a page that is *already making music* on load, controls that exist because the sound declares them, and sound state that travels as a link.

**KEY FACTS** (from T0, not redone):
- "All music is generated entirely in code. No timelines, no drag-and-drop"; live `input.*` parameters become UI sliders; values ride in the URL hash (`#tune=-16,pattern=1,cutoff=.26`); sharing sound state = sharing a link.
- The "New ditty" template is "equally instant, but with knobs" — the exact template our first-run should mirror.
- Engine lessons adopted elsewhere in the family (workers, one AudioWorklet node, MP3 export worker) — T0 §2–3.
- Site feature list: "Live input parameters and sliders"; "Export to MP3, embed anywhere"; example ditty captioned "The slider controls the 'amount of chaos' in the system" — controls are part of the instrument's story.
- Licensing: ditties are CC BY-NC-SA → clean-room only (T0). Our presets/state format is ours.

**Fold-in verdict:** ADOPT instant-play + parameter-as-object + URL-shareable state (our own schema); SKIP code-first as the primary surface (Pattern Forge owns that in the family). Export/embed = phase 2.

---

### 16. Forum threads — what producers praise and hate (the complaint corpus)

**Links:** https://www.kvraudio.com/forum/viewtopic.php?t=592066 **(snippet)** · https://gearspace.com/board/electronic-music-instruments-and-electronic-music-production/1429350-your-best-sounding-synth-worst-interface.html **(snippet)** · https://legacy-forum.arturia.com/index.php?topic=7083.0 · https://xferrecords.com/forums/general/serum2-graphics-resolution-quality · https://www.musicradar.com/music-tech/soft-synth-showdown-repub

**Core contribution:** The outside view, in users' words — a ready-made acceptance-test list for Anvil.

**KEY FACTS**
- KVR "Best / worst synth gui" (2023): "the look of a synth also influences buying decisions. Eyes have become more important especially in music production" (snippet).
- Gearspace "Your best sounding synth with the worst interface": Waldorf M — "what a chore to program with that little screen and all those abbreviations" (snippet).
- Arturia legacy forum (2012, skeuomorphism debate): classic hardware faces "do not translate well to a 2D GUI"; CS80V "sliders work backwards… wagonloads of GUI elements in a very cramped space, with tiny fonts"; requests "tabbed or otherwise sectioned interfaces… to free up screen real estate" and "improved preset browsing".
- Reviews' recurring negatives: Serum 2 "interface elements can feel a little cramped" (MusicRadar); Pigments "clunky patch browser" (MusicTech); Massive X — "once mapped, there isn't much visual feedback about what each modulator is actually doing" + Ease-of-Use 2/5 (MusicRadar showdown); Vital — "depth of modulation can feel overwhelming at first" (PluginNoise, snippet); Serum 2 raster blur (Xfer forum, §2).
- The positive counter-anchor: KVR user review of Serum 2 — "Perfect distance between all knobs, minimal necessary menus" (snippet).

**Fold-in verdict:** ADOPT as test fixtures: crowding test (bottom-up resize), feedback test (every modulation visible), first-run calm test, browser-speed test. Ship-time checklist: none of these five complaints applicable.

---

### 17. The parameter grammar — drag/fine/reset/text/wheel + context-menu power

**Links:** §1, §4, §9 sources (Xfer manual, Vital docs, FabFilter help) · https://support.mixwave.com/help/plugin-interface-overview **(snippet)**

**Core contribution:** The union of conventions users already have fingers for. Deviating from this table is a bug; extending it is flair.

**KEY FACTS (cross-product)**
- **Drag:** vertical only (FabFilter, Serum both axes allowed); precision adapts to drag **speed** (FabFilter) or drag **distance** (rotate mode).
- **Fine:** Shift+drag / Shift+wheel (Serum, FabFilter); Cmd+drag (Vital); Pro Tools substitutes Ctrl/Cmd-drag.
- **Reset:** Ctrl/Cmd-click (Serum, FabFilter); double-click = reset (Vital); context menu "Set Default Value" (Vital); also "Reset Control" in menu (Serum).
- **Text entry:** double-click (Serum, FabFilter); Opt+click or "Enter Value" menu (Vital); plain double-click per MixWave's generic convention (snippet).
- **Wheel:** adjusts value (Serum, FabFilter); FF notes Windows needs the window focused; VCV users fought *against* wheel=zoom on canvas (keep wheel=value on knobs, wheel=zoom on canvas only with Ctrl).
- **Keyboard:** Enter commits in the VCV browser; space auditions samples (Overbridge); Surge XT ships section-jump keys (Alt+. / Alt+,) and Shift+F10 context menus on the focused control [D4 §13]. No mainstream synth ships a discoverable shortcut map → our "?" overlay is differentiation.
- **Lock/learn/menu on every control:** modulation assign, bypass/remove, MIDI Learn, Lock Parameter (Serum §1); Disconnect/Disconnect All (Vital).

**Fold-in verdict:** ADOPT as an implementation contract with a written conformance test (works on every knob, slider, graph handle, step cell). Keyboard steps (↑/↓, Shift for fine) on every control = our WCAG 2.5.7 drag alternative, free.

---

### 18. Undo & A/B compare rails

**Links:** https://www.fabfilter.com/help/pro-q/using/undoredo · https://xferrecords.com/web-manual/serum-2/undo-and-redo · https://kilohearts.com/docs/phase_plant

**Core contribution:** Experimentation insurance: per-change history, A/B slots that cannot lose work, and one-click copy across slots.

**KEY FACTS**
- FabFilter: Undo/Redo buttons; "every change (such as dragging a knob or selecting a new preset) creates a new state"; A/B button "saves the current state before switching" — click twice and you're back; **Copy** copies active → inactive and disables itself when equal; buttons disable when empty; note — MIDI/automation changes do **not** create undo states (policy decision to make explicitly).
- Serum 2: "You can undo and redo just about any operation… encouraging you to effortlessly experiment"; buttons in header (Xfer manual).
- Phase Plant: top-bar Undo/Redo "undo or redo all actions" (docs).
- Pattern Forge precedent: the family already treats experiments as cheap [PF-LAY it]. Same promise for the synth.

**Fold-in verdict:** ADOPT: undo/redo in persistent header, A/B with copy, and an explicit rule for automation-vs-UI history. Preset audition itself should be undoable ("back to what I had").

---

### 19. Randomize / mutate & controlled randomness

**Links:** https://www.mind-flux.com/news-1/2025/11/8/chaos-lfos-in-serum-2-controlled-randomness-for-analog-drift · https://soniccharge.com/public/Synplant%20User%20Guide.pdf **(snippet)** · https://docs.lmms.io/user-manual/instruments/sfxr · http://crosstalk.arizona.edu/Data/Massive%201.1.4%20Manual%20Addendum%20English.pdf **(snippet)** · https://www.arturia.com/products/software-instruments/pigments/overview

**Core contribution:** Randomness done as *musical motion* (chaos attractors, mutations, mutate buttons) rather than a slot machine — the pattern to steal for both a "Mutate" control and generative starter content.

**KEY FACTS**
- Serum 2 Chaos LFOs (Lorenz / Rossler / Henon): "generate motion based on mathematical attractors — systems that evolve unpredictably while remaining smooth and musical"; continuous modulation, "no stepped jumps, no hard resets"; use cases: osc drift, filter breathing, pan/reverb motion, percussive variation (Mind Flux). "It's randomness with intent."
- Synplant: genes "generate useful sounds through random mutations" (manual, snippet); sfxr ships literal **RAND** and **MUTA** buttons — mutation as a first-class verb, even in a toy (LMMS docs).
- Massive addendum: "Randomize for Performer" (snippet). Pigments: Random generators as modulation sources + marketing "turning randomness into melody" (Arturia).
- Design principle emerging: constrain the mutation space (small % deltas in *musical* directions), never randomize everything at once; keep it undoable and A/B-able.

**Fold-in verdict:** ADOPT a scoped **Mutate** command (per-module, subtlety slider, undo + A/B ride-along) and Chaos-style smooth randomness modulators; REFERENCE full-patch randomize (fun, but only behind "Surprise me" with one-click revert).

---

### 20. Visual feedback as identity — scopes, animated displays, and the dead-indicator rule

**Links:** https://vital.audio/ · https://kilohearts.com/docs/phase_plant · https://www.gearjunkies.com/2026/02/gearjunkies-review-arturia-pigments-7/ · https://www.elektron.se/release-notes/overbridge-release-notes · [T0 §2 probes] · [D4 §10–11]

**Core contribution:** Displays that prove the synth is alive: animated wavetables, per-module scopes, audio-reactive play visuals — with the hard rule that indicators must track state and animation must respect the render budget.

**KEY FACTS**
- Vital: "See everything… animated controls, filter responses, waveforms, smooth LFOs, oscilloscopes, spectrograms" (vital.audio).
- Phase Plant: per-module oscilloscope; granular module shows the sample with a draggable play cursor and "visualize[s] all playing grains" (docs).
- Pigments Play View: animation "reacts to the shape and color of the audio signal" per sound category (Gearjunkies).
- dittytoy: visualizers/probes as first-class, OffscreenCanvas workers (T0).
- The guardrails are already researched: meter ballistics + `prefers-reduced-motion` + Page-Visibility pause + layered 2D canvas + OffscreenCanvas [D4 §10–11] — do not re-derive; obey.
- Elektron bug-fix class: a phase indicator that "did not move when the parameter was adjusted" shipped as a defect fix (Overbridge notes) — visual feedback is functionality.

**Fold-in verdict:** ADOPT one hero canvas (wavetable/scope morph) + per-module mini-scopes, all inside D4's motion/render budget; every indicator bound to state; reduced-motion renders static-but-live (level bars, not strobes).

---

## 1) STEAL-LIST TABLE — interaction patterns → where WE use it

| # | Pattern | How it works | Who does it best | Where WE use it |
|---|---|---|---|---|
| 1 | Drag-source→target modulation | Drag LFO/ENV chip onto any control; highlights + audition before drop | Vital (pre-drop audition), Serum (menu fallback) | Mod view + every knob |
| 2 | Hover tooltip listing sources | Knob hover shows value; if modulated, lists sources | Serum 2 | Every control |
| 3 | Right-click power menu | Reset / Lock / MIDI Learn / Modulate / bypass | Serum 2 | Every control |
| 4 | Fine-drag modifier | Shift+drag (or drag-speed/distance adaptive) | FabFilter | Global + canvas handles |
| 5 | Ctrl/Cmd-click reset; dbl-click text entry | Reset + type exact value | FabFilter / Serum / Vital | Every control |
| 6 | A/B compare + Copy | Two states, switch-safe, copy across | FabFilter | Header, next to undo |
| 7 | Header undo/redo for everything | Buttons cover "just about any operation" | Serum / Phase Plant | Persistent header |
| 8 | Resize menu + "set as default" | Logo menu of sizes, remembered | Serum 2 | Header → View |
| 9 | Modulatable-by-token theming | theme.json palette accents, skin ecosystem | Serum 2.1+ / Vital skins | Theme system v2 |
| 10 | Vector-first rendering | No blur at any zoom | (Serum fails >200%) | Build constraint |
| 11 | Preset preview per row + fallback clip | ▶ plays embedded clip else standard fallback; auto-preview | Serum 2 | Browser |
| 12 | Folder step arrows | `< >` walks a subfolder without reopening | Serum 2 | Browser |
| 13 | Search-first browser | Type "env" beats clicks; search = most-used feature | VCV (users' own finding) | Browser (primary control) |
| 14 | Facets/tags/favourites/playlists | Filter by type/instrument/designer; heart; live playlists | Arturia Analog Lab | Browser + Perform |
| 15 | Similar presets | Algorithmic "more like this" | Arturia / Pigments ML | Browser |
| 16 | Loading progress for heavy patches | Green bar under preset name | Serum 2 | Browser rows |
| 17 | Blank-slate dotted slots | Click dotted space to add module | Phase Plant | Mod view |
| 18 | Ctrl-drag = copy module | Duplicate by modifier-drag | Phase Plant | Mod view, sequencer |
| 19 | Macro row (8 knobs) | Designer routes; user performs | Phase Plant / Pigments | Voice + Perform |
| 20 | Colour-coded sources | One hue per mod source, everywhere | Pigments | Mod overlays, matrix, scope |
| 21 | Play/Perform top layer | Big picture + macros + few controls | Pigments Play / Analog Lab Stage | Perform screen |
| 22 | Tips-in-context | Control descriptions + optimal-range hints | Pigments | Help layer |
| 23 | Lessons/recipes with outcome names | Guided path ending in playground | Learning Synths | First-run (§4) |
| 24 | Chaos/attractor LFOs | Smooth musical randomness (Lorenz etc.) | Serum 2 | Mod sources |
| 25 | Scoped Mutate | Random small musical deltas, undoable | Synplant / sfxr MUTA | Per-module "Mutate" |
| 26 | Relative-mode sliders | Pointer-delta, no value jumps | Elektron | Narrow/side controls |
| 27 | Space-to-audition | Space previews sample/preset | Elektron | Browser, sampler |
| 28 | Section-jump keys | Alt+. / Alt+, snap between panel sections | Surge XT [D4] | Keyboard map |
| 29 | Keyboard entry + Enter commit | Multi-select then Enter inserts | VCV | Browser |
| 30 | Zoom-to-pointer canvas | Ctrl+wheel zooms at cursor; plain wheel pans | VCV accepted scheme | Mod view, sequencer |
| 31 | Micro-texture (button clicks etc.) | Real-machine click sounds as homage | Roland50 | Easter eggs (§2) |
| 32 | Share-by-link state | Parameters in URL → link = sound | dittytoy [T0] | Share button |

---

## 2) VISUAL LANGUAGE — proposal options

**Option A — "Anvil Teal" (recommended default, family-first).** Graphite base, one teal identity, Okabe-Ito signal colours. Extremely legible, clearly a Moddy tool.
- Base: page `#0A0E11` · panel `#10161B` · raised `#161F26` · hairline `#22303A`.
- Accent: primary teal `#2ED8C9` · deep teal `#0F8F85` (fills/states) · glow `#7FF3E8` (hover/active only).
- Text: primary `#E8F1F2` · secondary `#9FB3BC` · tertiary `#6B7F8A` (avoid tertiary for live values).
- Modulation source accents (Okabe-Ito subset, one hue per source): sky `#56B4E9` · orange `#E69F00` · green `#009E73` · purple `#CC79A7` · yellow `#F0E442` · vermillion `#D55E00` · blue `#0072B2`.
- Verified WCAG ratios (computed this session): primary text 16.9:1 on page / 15.9:1 on panel; secondary 8.9:1; tertiary 4.4:1 (large text only); teal primary 10.9:1; deep teal 4.9:1 (fills, not fine text); copper 7.3:1; all mod accents ≥3.7:1 — blue `#0072B2` (3.74:1) is for fills/curves, **not** small text; lighten to `#4C9FE0` if used as text.

**Option B — "Copper Forge" (alternate skin; warmer seasonal identity).** Same graphite base; accent copper `#E08A3C` (7.3:1) with deep copper `#B45E2A`; teal reserved for *signal/modulation only* (so the family colour still means "live data"). Good A/B to test identity, ships as a theme variant, not a fork.

**Option C — "Blacksite" (highest-contrast; TV/second screen + low-vision).** Near-black `#05070A`, panels `#0B1016`, amber `#F5A623` (10:1) accents with per-section hue caps (LCARS energy); larger type preset; forced into the theme system alongside "high-contrast" (D4 §8). This is the mode for the Pattern Forge-style dashboard crowd.

**Typography.** UI: one OFL sans with strong small-size rendering (IBM Plex Sans or Inter); values/harmony: IBM Plex Mono with **tabular numerals** (no jitter when values animate). Scale: 11 / 12 / 14 / 18 / 24; micro-labels uppercase + letterspacing (LCARS-family vibe); never <11px live data; units always suffixed; weight ≥400 at 11px.

**Density & geometry.** 4px baseline grid; control heights 24 (compact) / **32 (default)** / 40 (touch/TV); 8px minimum optical gap between parameter clusters; group = hairline card + 2px accent cap; panel padding 12px. Hit targets ≥24px CSS (WCAG 2.5.8), default 32.

**Panel language.** Modules, not tabs-within-tabs: each screen answers one job; persistent header (preset name · undo/redo · A/B · CPU/meter · master · help) like Serum/Phase Plant; states: hover = glow ≤6px, focus = 2px teal ring, selected = teal caret + dimmed siblings, modulated = coloured ring + chip; graphs = layered 2D canvas (static grid + dynamic overlay). Inherit Pattern Forge's layout laws: work-area-relative sizing, priority ladder, no peephole squeeze [PF-LAY].

**Animation budget (60fps-safe).** DOM motion: transform/opacity only; 120/180/240ms; ease-out; no layout-thrash animations. Canvas: one hero scope + small per-module scopes; dirty-rect redraws; ≤8ms JS/frame budget target; pause loops on `document.hidden`; kill decorative animation under `prefers-reduced-motion` (freeze scopes to a still + level bar) [D4 §10–11]. Rule: no animation may be load-bearing — the UI must be fully usable frozen.

**Canvas usage.** Hero wavetable/morph display; modulation overlays (rings, animated amounts); per-module mini-scopes; sequencer grid (drawing steps is fine, but hit-testing stays in DOM for a11y); meter/scope strip. Everything else = DOM (text, knobs, menus) for accessibility + crispness at every zoom.

**Subtle easter eggs (≤3).**
1. **303 nod:** the demo acid preset's pattern (16 steps) — pressing its "accent" step three times in a row toggles a hidden swing display labelled "MC corner" (nod to the MC-303 hunt in T0).
2. **Texture toggle:** "Machine sounds" off by default; when on, transport/mute clicks play one carefully recorded click (Roland50 homage).
3. **Skinners' club:** a "veteran" badge earns the "ReBirth-era candy chrome" theme — punning on the browser-303 heritage (T0). All three cost a day; none alter workflow.

---

## 3) SCREEN INVENTORY + layout cues

1. **Voice (main) — "one glance = one sound".** Hero canvas (wavetable morph + live scope) top-left, oscillator cards (1–3, signal-hued), filter + amp, persistent header. Right rail: macros (8) + quick mod chips. Layout: hero ~40% of width, cards fold under 1180px; work-area-relative heights (never fixed vh claims that fight the keyboard dock) [PF-LAY]. Empty state: Init + dotted ghost slots.
2. **Mod (matrix/modular) — "everything is visible".** Split: canvas patch area (modules as cards, cables as bezier, zoom-to-pointer) ⇄ matrix table (source→dest rows with amounts, polarity, response curve). Both views are the *same data*; hovering a row floods the destination control elsewhere (echo of Vital). Multi-select + Enter to commit citations (VCV). Dotted-slot adds, ctrl-drag copy (Phase Plant).
3. **Sequencer/Pattern — "the groovebox heart".** Pattern grid first (16/32 steps with per-step gate/accent/slide per the DT303 semantics already spec'd [T0]), then piano-roll/clip view for longer ideas, swing + pattern bank + mutate. Colour codes mirror mod-source hues; step edit must be keyboard-navigable (cells = DOM grid).
4. **Mixer/FX — "surgical, quiet".** Lane-based FX (Phase Plant lanes; splitter bus), meter bridge with standard ballistics [D4 §10], relative-mode narrow sliders (Elektron), double-click text entry everywhere. No faux-3D.
5. **Browser/Store — "search box is the instrument".** Search-first (VCV lesson: search is the most-used feature), facets (type/instrument/tag/designer), favourites, playlists, similar-presets, tag chips with ✕ + Clear All (Arturia), preview ▶ per row + fallback clip + auto-preview + loading bar (Serum 2). Store tab exists but obeys fairness spine: no interstitials, no timers, no default-checked add-ons.
6. **Perform/Fullscreen — "stage view".** Macros + playlists/songs + big targets + setlist navigation, simplified (Analog Lab Stage; Pigments Play); popout windows for keyboard/meters per the family's existing PiP/popout machinery [D4 §6], share/save state one click.
7. **Help/Tour — "teaching layer, not a manual PDF".** Tooltips everywhere from v1 (Serum), contextual tips w/ optimal ranges (Pigments), a 60-second guided tour, learning recipes with outcome names (Learning Synths critique), keyboard overlay on "?". Help never blocks the instrument (no modals over the keyboard).

---

## 4) FIRST-RUN / ONBOARDING PLAN

- **t=0 second: the synth is already playing.** Land on a playable demo (acid line at 138 BPM — the T0 seed), transport pulsing, 6 live sliders visible. No setup wizard before sound; audio-unlock prompt only (browser requirement) with one clear tap. "New ditty" template principle: instant, but with knobs [T0].
- **Famous-sound starters (outcome-named, one click):**
  - **Acid Line** — DT303 acid voice (saw/square blend, cascaded SVF, accent/slide) [T0 §3];
  - **Blade Runner Pad** — formant-weighted saw ensemble, 5s attacks [T0 §3];
  - **Karplus Pluck** — KS string with pluck-position comb + humanization [T0 §3];
  - **Cosmic Drone** — additive crossfade tables [T0 §3].
  Each starter = preset + 30-45s overlay (3 stops max: this knob → this mod → save/share), all skippable; name the *sound*, not the technique (Learning Synths critique, §8).
- **Guided tour:** 60 seconds, 4 stops (Play → Tweak cutoff → Drag an LFO (pre-drop audition shows off) → Save & Share link). Resumable; never modal-blocking; progress as chips.
- **Empty states:** every pane self-explains with one action (dotted slots in Mod view; "start here" curated row in Browser; dashed hint rows in Sequencer). Tips-in-context on first visit to each control family; a "recipes" shelf for goal-first users.
- **KPI:** "fun within the first few minutes" (TE, §13) — target: first sound tweak < 30s, first saved/shared sound < 5 min, no dialogue before first note.

---

## 5) ACCESSIBILITY CHECKLIST (build gates)

- **Contrast:** body text ≥ 4.5:1 (target 7:1); large text ≥ 3:1; UI component boundaries ≥ 3:1; verified pairs from §2 (re-run per theme; tertiary text never used for live values).
- **Colourblind-safe:** Okabe-Ito modulation accents (never colour alone — always chip + icon + label); no red/green-only semantics; palette sim test in CI [D4 §8].
- **Resizable/scale:** zoom presets 100/125/150/200 + persisted default + corner drag (Serum model); `zoom`-based UI scale per D4 §9; vector-first rendering (no blur, §2 entry); DPR-aware canvases.
- **Keyboard-only path:** tab order across every screen; section jumps (Alt+. / Alt+, convention [D4 §13]); arrows/Shift-arrows adjust every control (drag alternative — WCAG 2.5.7); double-click text entry; Enter to commit selections; rebindable map + "?" shortcut overlay.
- **Screen-reader:** Mirror-DOM plan for canvas widgets (phased, start with Voice + Mod) with aria-slider/valuetext semantics and throttled live regions [D4 §13].
- **Reduced motion:** setting + `prefers-reduced-motion`; scopes become still frame + numeric level; no strobing; decorative animation capped.
- **Targets:** ≥24×24 CSS px (WCAG 2.5.8), default 32; focus never obscured by tooltips/popouts (WCAG 2.4.11); focus ring 2px, ≥3:1.
- **Perf as a11y:** 60fps budget + hidden-tab pause [D4 §10–11] (jank is a vestibular and usability harm).

---

## 6) ANTI-PATTERNS TO AVOID (with receipts)

1. **Tiny handles / tiny fonts** — FabFilter's own "aggravatingly tiny" envelope nodes; Arturia CS80V "tiny fonts" complaint. Min 24px targets, 11px text.
2. **Hidden modulation / dead feedback** — Massive X: "once mapped, there isn't much visual feedback about what each modulator is actually doing" (Ease 2/5). Every assignment visible in ≥2 places.
3. **Mystery right-click treasure** — Serum's power is "hidden within right-click menus" (MusicTech). Mitigate: tooltip hint "right-click for options" + visible affordances.
4. **Raster blur at scale** — Xfer forum ("every resolution except 100% is blurry"). Vector-first or accept the same thread about us.
5. **Cramped chrome** — Serum 2 "a little cramped" + unreadable package names (r/serum). Responsive rows; movable/reclaimable sidebars.
6. **Clunky/fiddly browser** — Pigments "clunky patch browser"; filtering "fiddly". Browser must be the fastest thing we ship.
7. **Skeuomorphism that blocks workflow** — Arturia forum: backwards sliders, cramped panels, requests for sectioned UI. Homage = texture + proportions, never obstacle.
8. **Modal hell / store spikes** — no dialogs before first sound; no timed offers; help overlays never cover the instrument.
9. **Perf-hurting animation** — per-frame shadows/blur, unthrottled loops (D4 §11). Budget or don't ship it.
10. **Overwhelm cliff** — Vital "overwhelming at first"; Phase Plant admits "may look overwhelming". Blank slate ≠ blank stare: ghost slots, tips, starters.
11. **Keyboard-hostile canvases** — VCV arrow-key panning critique; no hand-travel-only shortcuts. WASD-style options + rebinding.
12. **Multi-click for common actions** — VCV browser user's own rule: users won't click multiple times unless it adds utility or saves typing. One-click ear-check (audition), one-drag mod, one-click A/B.

---

## RANKED TOP-10 FLAIR MOVES — value ÷ effort for v1

1. **Drag-to-modulate with pre-drop audition** (Vital-grade) — XL value / M effort. The single most copyable "wow"; our modulation identity.
2. **Modulation visualization layer** (source-hued rings, animated amounts, hover-floods, mod-source tooltips) — XL / M. Earns "alive"; kills the Massive X failure mode.
3. **Instant-play onboarding + 4 famous-sound starters** (Acid/Blade Runner/Karplus/Drone, outcome-named) — L / S. Highest first-minute payoff; content already seeded by T0.
4. **The knob/pointer contract** (fine, reset, type-in, wheel, keyboard steps — on every control) — L / S. Cheap, invisible, converts "precise" into felt quality.
5. **Preset browser craft v1** (search-first, facets, favourites, previews + fallback clips, loading progress) — L / M. This is where retention lives; ship it before the store.
6. **Hero canvas + per-module scopes** at 60fps with reduced-motion stills — L / M. The "see everything" identity; obey D4's render budget.
7. **Teal/graphite theme system with CB + high-contrast variants** — M / S. Family recognition + a11y in one; theme = token file later.
8. **Right-click power menu + context tooltips** (Modulate / MIDI learn / Lock / Reset) — M / S. Pro-grade verbs under one gesture.
9. **Undo + A/B compare + Copy** in the header — M / S. Removes fear; makes the synth feel safe to experiment in.
10. **Scoped Mutate + harnessed chaos LFOs** (per-module, subtlety slider, undoable) — M / S-M. The "idea generator" flourish that stays musical.

Bonus (post-v1): share-by-link state + export (dittytoy principle), community theme/skin economy (Serum/Vital model), texture easter eggs (Roland50 nod).

---

## DEAD ENDS (logged)

- **monosounds.studio/serum-2-preset-browser** — 2 attempts (Exa 429; browser returned wrong page content). Snippet used for the 626-presets/browser-features claim.
- **KVR forum + product pages** — Cloudflare bot wall; Wayback has no snapshot of the thread. Search snippets used (quotes flagged).
- **Reddit** (r/VSTi thread, r/serum pages) — "blocked by network security" on old.reddit and .json. Snippets used.
- **Gearspace** — Cloudflare wall on the featured article; snippet used.
- **support.arturia.com FAQ** — Cloudflare wall; Analog Lab manual PDF used instead.
- **blog.fortunes.io (FabFilter interview)** — DNS dead; Wayback copy used.
- **valhalladsp.com live pages** — Cloudflare wall; Wayback used for the minimalism essay; manifesto via snippet.
- **xferrecords.com/manual/serum-2/docs (full manual)** — 26MB JS-compressed dump, not text-extractable; used individual web-manual pages + What's New PDF instead.
- **learningsynths.ableton.com app** — cookie wall blocks innerText; used Ableton blog + The Verge + the Dishman cognitive-walkthrough PDF.
- **Serum 1 skin-engine port** — concept-only (same conclusion as D4; not re-examined).

## METHOD NOTES

- All external items fetched live on 2026-10-06 (browser via CDP; PDFs via `pdftotext`) unless flagged (snippet)/(Wayback). ≤3 attempts per blocked URL; Wayback/search excerpts used per house rule.
- Reused, not re-derived: Pattern Forge layout laws [PF-LAY], D4 control-surface/a11y/motion findings [D4 §6,8–11,13], dittytoy engine/product lessons [T0].
- Contrast ratios in §2 computed this session (WCAG 2.x formula) — re-verify at build against final hexes.
- Facts to re-verify before build: Serum 2 factory preset count (snippet-only); Vital exact modulator counts per version; Arturia manual version (5.11) vs current; Kinetic wording of the KVR/Gearspace quotes (snippet-sourced).
- Item count: 20 case-study entries.

```json
{
  "file": "C:\\\\Users\\\\Moddy\\\\anvil\\\\research\\\\ui\\\\T7-ui-flair.md",
  "items_count": 20,
  "dead_ends": [
    "monosounds.studio Serum 2 browser guide (429 + wrong-content fetch; snippet used)",
    "kvraudio.com threads/reviews (Cloudflare; no Wayback snapshot; snippets used)",
    "reddit.com & old.reddit.com (network security block; snippets used)",
    "gearspace.com article (Cloudflare; snippet used)",
    "support.arturia.com FAQ (Cloudflare; Arturia manual PDF used instead)",
    "blog.fortunes.io FabFilter interview (DNS dead; Wayback copy used)",
    "valhalladsp.com live pages (Cloudflare; Wayback + snippet used)",
    "xfers Serum 2 full manual at /manual/serum-2/docs (compressed JS dump; per-page manual used)",
    "learningsynths.ableton.com app text (cookie wall; blog + Verge + walkthrough PDF used)"
  ]
}
```
