# Serum 2 Web Manual - UI/Workflow Conventions Digest

Purpose: fidelity baseline for the Anvil GUI/workflow redesign. This digest extracts, verbatim
wherever the manual defines interaction behaviour, every UI and workflow convention stated in the
official Xfer Records Serum 2 web manual. Quotes are sourced directly from the manual's own text
(typography normalized to ASCII; wording unchanged).

Sources: the 33 pages of the official Serum 2 web manual at base URL
https://xferrecords.com/web-manual/serum-2/ (slugs and titles listed below).

Fetch date: 2026-10-08, 18:09 (local, UTC+10:30).

Method and results:
- Fetched 33 of 33 pages with curl (User-Agent "Mozilla/5.0", follow redirects); each page saved
  as raw HTML under raw/manual/<slug>.html. All returned HTTP 200 and all contain the
  div.manual-content body node.
- Body text extracted with a Python 3 stdlib HTMLParser script (raw/scripts/extract.py) that
  captures the manual-content div as plain text; results also cached under raw/text/.
- Figures: captions and image URLs extracted from the HTML only (raw/scripts/figures_appendix.py);
  images were NOT downloaded. Note: the site itself ships image URLs with truncated signed-blob
  tokens (a literal "..." in the middle), reproduced as-is in the Figures Appendix.
- Failed pages: none (0). Count fetched: 33/33.
- Page revision metadata stated in each page footer ranges from "Last updated: April 23, 2025"
  (welcome) to "Last updated: May 04, 2025" (11 pages).

Page index (in manual order):
 1. Welcome (welcome)
 2. Registering Serum (registering-serum)
 3. Getting in Touch (getting-in-touch)
 4. Downloading Serum (downloading-serum)
 5. Installing Serum (installing-serum)
 6. Exploring Serum (exploring-serum)
 7. Exploring Sound Design in Serum (exploring-sound-design-in-serum)
 8. Getting Started (getting-started)
 9. Adding Serum to a Track (adding-serum-to-a-track)
10. Loading a Serum Preset (loading-a-serum-preset)
11. Creating a New Sound (creating-a-new-sound)
12. Saving Changes (saving-changes)
13. Embedding Content When Saving a Preset (embedding-content-when-saving-a-preset)
14. Dragging Audio to Your DAW (dragging-audio-to-your-daw)
15. Exploring Basic Operations (exploring-basic-operations)
16. Displaying Help (Tooltips) (displaying-help-tooltips)
17. Using the Serum Keyboard (using-the-serum-keyboard)
18. Using Knobs and Sliders (using-knobs-and-sliders)
19. Undo and Redo (undo-and-redo)
20. Controlling the Main Output Volume (controlling-the-main-output-volume)
21. Using Oscillators and Filters (using-oscillators-and-filters)
22. Enabling an Oscillator or Filter (enabling-an-oscillator-or-filter-7b4f0de4-5686-44f7-8d8e-0b926ce77fe8)
23. Choosing Oscillator or Filter Options (choosing-oscillator-or-filter-options)
24. Using Pitch Controls (using-pitch-controls)
25. Setting the Octave or Semitone Mode (setting-the-octave-or-semitone-mode)
26. Routing an Oscillator or Filter (routing-an-oscillator-or-filter)
27. Accessing the Oscillator or Filter Menu (accessing-the-oscillator-or-filter-menu)
28. Locking a Module (locking-a-module)
29. Initializing a Module (initializing-a-module)
30. Copying a Module (copying-a-module)
31. Enabling Pitch Tracking (enabling-pitch-tracking)
32. Pitch Bend Tracking (pitch-bend-tracking)
33. Resizing the UI (resizing-the-ui)

================================================================================
## 1. Page Digest

### 1. Welcome (welcome)
URL: https://xferrecords.com/web-manual/serum-2/welcome/ | Updated: April 23, 2025
Summary: Opening page of the Serum 2 User Guide. It frames Serum 2 as an advanced virtual
synthesizer and states the naming convention used throughout the manual.
Conventions / notable statements:
- Naming: "Throughout this manual, we'll refer to Serum 2 (the latest version of Serum) simply as
  Serum."
- Synthesis mix: "Serum combines wavetable, subtractive, multi-sampled, sampled, granular, and
  spectral synthesis into an intuitive and cohesive workflow."
Figure: "Serum Main Screen" (the full UI screenshot).

### 2. Registering Serum (registering-serum)
URL: https://xferrecords.com/web-manual/serum-2/registering-serum/ | Updated: April 25, 2025
One line (housekeeping, no UI content): purchases through Xfer Records are automatically
registered for free updates; Splice.com purchases register automatically with the purchase email
(contact support with your Splice username if the registration can't be located).

### 3. Getting in Touch (getting-in-touch)
URL: https://xferrecords.com/web-manual/serum-2/getting-in-touch/ | Updated: April 25, 2025
One line (housekeeping, no UI content): feedback, comments, and links go to
https://support.xferrecords.com.

### 4. Downloading Serum (downloading-serum)
URL: https://xferrecords.com/web-manual/serum-2/downloading-serum/ | Updated: April 25, 2025
One line (housekeeping, no UI content): sign in at www.xferrecords.com, open the user menu, and
choose Your Account; all installers for registered products are listed on the account page.

### 5. Installing Serum (installing-serum)
URL: https://xferrecords.com/web-manual/serum-2/installing-serum/ | Updated: April 27, 2025
One line (housekeeping, no UI content): run the installer wizard, then rescan/refresh plug-ins in
the DAW; "Important: You must select the VST3 version when installing the AU or AAX version of the
plugin." Uninstall is file deletion only (Windows: the Serum 2 folder under
C:\Users\(username)\AppData\Roaming\Xfer\ plus the Serum 2 Presets folder under Documents\Xfer\ or,
with OneDrive, OneDrive\Documents\Xfer\; macOS: VST3, Components, Presets, and Avid plug-in
folders plus ~/Library/Preferences/Serum2Prefs.json and
~/Library/Application Support/com.xfer.serum2/Serum2.lic; use Cmd-Shift-G to navigate quickly);
"Serum does not modify the Windows registry, therefore, you do not need to run an uninstaller
application to completely remove Serum from your system."

### 6. Exploring Serum (exploring-serum)
URL: https://xferrecords.com/web-manual/serum-2/exploring-serum/ | Updated: April 28, 2025
Summary: Overview of Serum's structure - multiple oscillators (including dedicated noise and sub
oscillators), dual filters, assignable envelopes and LFOs, an arpeggiator and MIDI clip system -
described as an interface "conveniently structured" for intuitive sound design.
Conventions / notable statements:
- Oscillator count and types: "Equipped with multiple oscillators, including dedicated noise and
  sub oscillators, Serum allows you to blend and shape a broad range of waveforms, from complex
  wavetables to granular, spectral, and sampled sounds."
- Filters: "Serum features dual filters, each offering a wide selection of filter types for
  precise tonal shaping. You can route oscillators through one or both filters, giving you detailed
  control over the harmonic structure and timbre of your sound."
- Modulation: "Serum includes an array of fully-configurable envelopes and LFOs (Low Frequency
  Oscillators) that you can assign to almost any control."
- Sequencing/performance: "Serum integrates a sophisticated arpeggiator and MIDI clip system,
  offering advanced sequencing and performance options for live and studio use."
- Layout intent: "Taken together, the Serum interface is conveniently structured to help make
  sound design both easy and intuitive."
Figure: "Serum Interface" (annotated screenshot of the interface sections).

### 7. Exploring Sound Design in Serum (exploring-sound-design-in-serum)
URL: https://xferrecords.com/web-manual/serum-2/exploring-sound-design-in-serum/ | Updated: April 29, 2025
Summary: Lists the five sound-generation types available per oscillator (OSC A, OSC B, OSC C) and
states they are chosen from a drop-down menu.
Conventions / notable statements:
- "Serum offers you the following sound generation options, accessible through oscillators A to C
  (OSC A, OSC B, and OSC C), with each offering a distinct approach to sound sculpting:"
  - "Wavetable - Produces an evolving soundscape by cycling through or morphing between multiple
    waveforms stored in a wavetable"
  - "Multisample - Uses multiple recordings (samples) of instruments (or other sound generators)
    across various notes and dynamic ranges"
  - "Sample - Uses single samples that can be played back at different pitches, layered, looped, or
    transformed with various effects"
  - "Granular - Layers, stretches, rearranges, or modulates tiny sound fragments called grains to
    create new sound textures"
  - "Spectral - Manipulates sound by analyzing and resynthesizing the frequency spectrum, creating
    new sounds with independent control over time and pitch"
- Selection convention: "You can access the sound generators using a drop-down menu."
Figure: "Serum Oscillators".

### 8. Getting Started (getting-started)
URL: https://xferrecords.com/web-manual/serum-2/getting-started/ | Updated: April 29, 2025
Summary: Index page listing the basic operations covered in this manual section (add Serum to a
track, load a preset, create a new sound, save changes, drag audio to your DAW, display help, use
the keyboard, use knobs and sliders, use oscillators and filters, and more). No interaction rules
beyond the table of contents.

### 9. Adding Serum to a Track (adding-serum-to-a-track)
URL: https://xferrecords.com/web-manual/serum-2/adding-serum-to-a-track/ | Updated: April 29, 2025
Summary: Serum is added to an instrument (MIDI) track like any software instrument; the default
sawtooth sound can be triggered by MIDI notes or by clicking the on-screen piano keys.
Conventions / notable statements:
- "You can add Serum to an instrument (MIDI) track in your DAW using the same procedure that you
  use with any software instrument. At this point, sending MIDI notes to Serum should trigger the
  default sawtooth sound."
- Playing convention: "you should hear the sawtooth sound if you click any of the piano keys at the
  bottom of the Serum user interface (UI)." (The on-screen keyboard sits at the bottom of the UI.)

### 10. Loading a Serum Preset (loading-a-serum-preset)
URL: https://xferrecords.com/web-manual/serum-2/loading-a-serum-preset/ | Updated: April 29, 2025
Summary: How to browse and load presets from the presets menu or the presets browser, including
arrow navigation, load-progress indication, and preset preview playback.
Conventions / notable statements:
- Presets menu: "To select a preset, click - Init - to display the Serum presets menu." (The
  preset-name slot reads "- Init -" when no preset is loaded.)
- Subfolder stepping: "After choosing a preset, you can click the < > arrows (to the right of the
  preset name) to navigate through a particular preset subfolder without having to repeatedly
  display the presets menu."
- Presets browser: "You can also choose a preset by clicking the button (next to the main menu near
  the top right) to access the presets browser." "Click an entry in the list to load the
  corresponding preset."
- Load progress: "Most presets load immediately; presets with larger embedded samples, such as
  multisampled instruments, display a small green progress bar (directly beneath the preset name)
  when loading."
- Preview: "Click the (play) button to preview the corresponding preset." "Serum plays an embedded
  preview clip (MIDI sequence) if the preset designer specified one. Otherwise, Serum plays a
  'fallback' clip to give you a sense of the preset."
- Preview switching/stopping: "Click another play button to preview the corresponding preset."
  "Click the button to stop the preview."
- Fallback options: "You can choose the fallback clip from among three standard options. Serum
  also allows you to auto-preview clips. See 'Performing Standard Preset Operations' for more
  information."
Figures: "Serum Presets Menu", "Serum Presets Browser", "Presets Showing Play Buttons", "Preset
Playing", plus button images with alt text: "Presets Browser Button", "Play Button", "Stop Button".

### 11. Creating a New Sound (creating-a-new-sound)
URL: https://xferrecords.com/web-manual/serum-2/creating-a-new-sound/ | Updated: April 29, 2025
Summary: The - Init - preset provides a blank slate for designing a sound; a full reset to defaults
is done from the main menu.
Conventions / notable statements:
- Init content: "If you just added Serum to a track, you will see the - Init - preset, which has a
  single wavetable oscillator enabled (OSC A) together with basic envelope and LFO modulators
  defined. This is a perfect blank slate from which to craft and evolve your sound."
- Restart convention: "If you've already loaded a preset or made other changes and would like to
  start over, click the main menu and choose Init Preset in the context menu." "This initializes
  Serum to the default settings and sets the stage for you to work on your new sound."
Figure: "Choose Init Preset from the Main Menu".

### 12. Saving Changes (saving-changes)
URL: https://xferrecords.com/web-manual/serum-2/saving-changes/ | Updated: May 04, 2025
Summary: Saving a polished sound as a preset: optional artist/description metadata, the disk save
button flow, re-save dialog behaviour, and the modifier shortcut to overwrite silently.
Conventions / notable statements:
- Metadata (optional): "(Optional) Before saving a preset, add metadata to the preset."
  "Double-click the ARTIST field directly below the preset name and type the artist name."
  "Double-click the DESC field and add any relevant information related to the preset." "You can
  add any type of information that you consider helpful or informative."
- Save: "Click the button to the left of the preset name." (the Save (Disk) button) "Click the Save
  button."
- Re-save: "After you've already saved a preset and made modifications, click the button to save
  your changes. A dialog appears allowing you to type a new file name or overwrite your existing
  preset file."
- Overwrite shortcut: "If you already know that you want to use the same file name and overwrite
  the existing preset file, Option-click (macOS)/Alt-click (Windows) the disk button. The preset
  saves using the same file name without displaying the dialog."
Figures: "Preset Metadata (Artist and Description)", "Save (Disk) Button".

### 13. Embedding Content When Saving a Preset (embedding-content-when-saving-a-preset)
URL: https://xferrecords.com/web-manual/serum-2/embedding-content-when-saving-a-preset/ | Updated: May 04, 2025
Summary: A toggle button embeds the wavetable or sample into a preset when saving (intended for
sharing presets); unavailable for factory content.
Conventions / notable statements:
- "You can embed a wavetable or sample into your preset when saving by clicking the button." "After
  clicking, the button changes to show that the feature is enabled."
- Alternative path: "Alternatively, you can click the name of the wavetable or sample and choose
  Embed in Preset in the context menu."
- Scope/advice: "In general, you should only consider doing this if you intend to share your preset
  with someone else." "Note that the option to embed a wavetable or sample into a preset is not
  available for factory-supplied content."
Figures: "Embed Indicator", plus embed-preset disabled/enabled button images.

### 14. Dragging Audio to Your DAW (dragging-audio-to-your-daw)
URL: https://xferrecords.com/web-manual/serum-2/dragging-audio-to-your-daw/ | Updated: April 30, 2025
Summary: Drag-out audio export: hovering left of the Serum logo reveals a wave icon that can be
dragged into a DAW track to render the last played note or chord as WAV; modifier variants open the
Renders folder (Option/Alt-click) or copy the preset to the file system (Shift-drag).
Conventions / notable statements:
- "You can quickly export the last played note or chord (in WAV format) to your DAW."
- Reveal convention: "Hover over the left of the Serum logo, and drag the wave icon that appears to
  an audio track in your DAW."
- Render behaviour: "Serum silently plays the note or chord using the corresponding pitch,
  velocity, and duration."
- File capture: "In addition to inserting the audio on to the track, Serum also captures the
  exported audio as a WAV-format file (stored in the Serum Presets > Renders folder)."
- Modifiers: "Option-click (macOS)/Alt-click (Windows) the wave icon to open the Renders folder.
  Shift-drag the wave icon to copy the current (saved) preset to the macOS Finder/Windows
  Explorer."
Figures: "Exporting Audio by Dragging", "Dragging Audio to Your DAW".

### 15. Exploring Basic Operations (exploring-basic-operations)
URL: https://xferrecords.com/web-manual/serum-2/exploring-basic-operations/ | Updated: May 01, 2025
Summary: Section intro: Serum's on-screen controls replicate hardware-synth operation; the
following pages cover options that apply to most knobs and sliders.
Conventions / notable statements:
- "Serum includes a set of elements and on-screen controls designed to closely replicate the
  experience of using a hardware synthesizer, while also providing all the benefits of a digital
  computer."
- Scope: "This section describes common operations when using the on-screen controls, including
  options that you can use with most knobs and sliders."

### 16. Displaying Help (Tooltips) (displaying-help-tooltips)
URL: https://xferrecords.com/web-manual/serum-2/displaying-help-tooltips/ | Updated: April 30, 2025
Summary: Hover-and-pause tooltips provide help for any control; tooltips show modulation
assignments on modulated controls, and depend on a global preference set to SHOW (default on).
Conventions / notable statements:
- Trigger: "You can display help for any control (such as a knob) by hovering the mouse pointer
  over the control and pausing for a moment."
- Preference gate: "Important: The Help tooltips global preference needs to be set to SHOW for
  tooltips to appear. Tooltips are enabled by default when you first install Serum." (See
  "Exploring Global Settings".)
- Modulation display: "Hovering the mouse pointer over a control that has modulation assigned
  displays the modulation sources. For example, hovering the mouse over the CUTOFF knob shows that
  LFO 3 and ENV 2 are assigned to modulate the filter cutoff."
Figures: "Tooltip Help", "Tooltip Showing Modulation Sources".

### 17. Using the Serum Keyboard (using-the-serum-keyboard)
URL: https://xferrecords.com/web-manual/serum-2/using-the-serum-keyboard/ | Updated: April 30, 2025
Summary: The on-screen keyboard plays notes with the mouse, monitors MIDI/computer-keyboard notes,
and indicates clip-player/arpeggiator notes; it also hosts global note settings (TRANSPOSE, KEY,
SCALE, SWING, OSC MAPPING).
Conventions / notable statements:
- "Serum features an on-screen keyboard that you can use to directly play notes using your mouse,
  or monitor the notes being played on an external MIDI or computer keyboard. The on-screen
  keyboard also indicates which notes are being played through the Serum clip player and
  arpeggiator."
- Settings defined on the keyboard:
  - "TRANSPOSE - The number of semitones (positive or negative) to transpose all incoming and
    generated MIDI notes."
  - "KEY - The key to use throughout Serum, most notably in the CLIP and ARP modules."
  - "SCALE - The scale to use. Notes outside the scale automatically conform to the selected
    scale."
  - "SWING - Use to swing or shuffle the timing of the grid in the CLIP and ARP editors."
  - "OSC MAPPING - Edit the note and velocity ranges of the oscillators and arpeggiator."
Figure: "Serum Keyboard".

### 18. Using Knobs and Sliders (using-knobs-and-sliders)
URL: https://xferrecords.com/web-manual/serum-2/using-knobs-and-sliders/ | Updated: May 01, 2025
Summary: The central control-interaction page: drag/scroll/double-click editing with modifiers, the
right-click context menu (modulation assignment, bypass/remove, Reset Control, MIDI Learn, Lock
Parameter), and MIDI CC map persistence rules.
Conventions / notable statements:
- Drag editing: "To adjust a knob or slider, click and drag either up and down or left and right.
  A pop-up displays the current value allowing you to dial in a specific setting. Hold the Shift
  key to fine tune the adjustment."
- Scroll wheel: "If your mouse has a scroll wheel, you can also use it to adjust values up and
  down (without displaying the current value in a pop-up)."
- Exact entry: "Double-click a knob or slider to display a text box showing the current value.
  Enter a new value for precise adjustments."
- Context menu: "Right-click a knob or slider to open a context menu that displays the settings and
  operations available for that control."
- Modulation assignment via menu: "ou can use the menu to choose one or more modulation sources
  (such as ENV 1 or LFO 2) for the control." [sic - the manual's sentence lacks its leading "Y"]
  "You can also choose to bypass or remove a modulator, or remove all modulators assigned to the
  control."
- Context sensitivity: "Note: Some controls offer additional menu options, depending on the
  context."
- Menu options on nearly all knob/slider menus:
  - "Reset Control - Resets the control to the default value." "This is the same as Cmd-clicking
    (macOS) or Ctrl-clicking (Windows) the control."
  - "MIDI Learn - Activates MIDI learn mode. When enabled, Serum waits for an incoming MIDI CC
    value." "After Serum receives a MIDI CC value, MIDI learn mode is deactivated and the CC# is
    assigned to the knob or slider. Note that the assignment is saved with the preset (patch)."
  - Lock Parameter item (its label is omitted in the manual's list; the later tip names the option
    "Lock Parameter"): "When enabled, locks the control setting (preventing a value change) when
    loading presets. You can, however, continue to adjust the control manually."
- Ubiquity: "The Reset Control and Lock Parameter options appear in the context menu of almost
  every control in Serum."
- MIDI CC persistence: "When saving a DAW session, MIDI CC assignments are saved and recalled with
  the session." "When saving a preset, MIDI CC assignments are saved with the preset, but are only
  loaded if the Load MIDI Map from Preset preference is enabled on the Global page (this setting is
  disabled by default)."
- Default MIDI map file: "You can set the current MIDI CC assignments to load by default by
  choosing Save MIDI Map in the main menu and saving the MIDI map as default.SerumMIDIMap in the
  Serum 2 Presets/System/MIDI CC Maps folder." "This map then loads automatically when creating a
  new instance of Serum or choosing Init Preset in the main menu. The map also automatically loads
  when selecting a preset if the Load MIDI Map from Preset preference is disabled."
Figures: "Click-Dragging a Knob", "Right-Click Context Menu", plus lightbulb and gears tip icons.

### 19. Undo and Redo (undo-and-redo)
URL: https://xferrecords.com/web-manual/serum-2/undo-and-redo/ | Updated: May 01, 2025
Summary: Undo/redo buttons live in the header (top right) and cover nearly every operation, with
redo enabling side-by-side comparison of sound-design changes.
Conventions / notable statements:
- Scope: "You can undo and redo just about any operation in Serum, encouraging you to effortlessly
  experiment in your sound design."
- Location: "You can access the undo and redo buttons in the Serum header, near the top right."
- Undo: "Click the button to undo your last operation (such as a change to a knob or an LFO shape,
  among others)."
- Redo: "Click the button to redo the last undo operation. This allows you to quickly compare and
  evaluate changes to your sounds side by side."
Figures: "Undo and Redo Buttons", "Undo Button", "Redo Button".

### 20. Controlling the Main Output Volume (controlling-the-main-output-volume)
URL: https://xferrecords.com/web-manual/serum-2/controlling-the-main-output-volume/ | Updated: May 04, 2025
Summary: The MAIN knob (top right) sets the main output volume; a stereo meter sits beside it.
Conventions / notable statements:
- "You can control the main output volume of Serum using the MAIN knob (near the top right)."
- "The stereo volume appears as a meter next to the knob."
Figure: "Main Volume".

### 21. Using Oscillators and Filters (using-oscillators-and-filters)
URL: https://xferrecords.com/web-manual/serum-2/using-oscillators-and-filters/ | Updated: May 01, 2025
Summary: Section intro: oscillators generate sound via wavetable and sample techniques; filters
sculpt it; the following pages describe operations common across most oscillator and filter types.
Conventions / notable statements:
- "Serum generates sound using a set of oscillators, powered by a range of techniques that use both
  wavetables and samples. Serum then uses filters to sculpt the sound generated by the
  oscillators."
- Scope: "This section describes a series of operations that are common across most oscillator and
  filter types."

### 22. Enabling an Oscillator or Filter (enabling-an-oscillator-or-filter-7b4f0de4-5686-44f7-8d8e-0b926ce77fe8)
URL: https://xferrecords.com/web-manual/serum-2/enabling-an-oscillator-or-filter-7b4f0de4-5686-44f7-8d8e-0b926ce77fe8/ | Updated: May 03, 2025
Summary: How to enable/disable oscillators and filters: oscillators by clicking their label (name +
enable button, turns green), filters by clicking the power button directly; disabled panels dim.
Conventions / notable statements:
- "You can enable an oscillator by clicking the label (containing the oscillator name and enable
  button). When enabled, the button turns green."
- "You can also use the power button to mute (disable) an oscillator to either solo the other
  oscillators or free up CPU, as needed. Notice that when an oscillator is off, the entire panel is
  dimmed."
- Filter difference: "Enabling a filter is very similar, except that you need to click the power
  button directly."
Figures: "Enabling OSC B", "OSC B Enabled", "Enabling Filter 1", "Filter 1 Enabled".

### 23. Choosing Oscillator or Filter Options (choosing-oscillator-or-filter-options)
URL: https://xferrecords.com/web-manual/serum-2/choosing-oscillator-or-filter-options/ | Updated: May 03, 2025
Summary: Option picking via drop-down menus with two fast-navigation conventions (arrow buttons and
hover + mouse wheel).
Conventions / notable statements:
- "You can choose an oscillator or filter option using the associated drop-down menu."
- "Oscillator options accessible using the drop-down menu include wavetables, samples,
  multisamples, and more." "In the case of filters, you can choose the type of filter using the
  drop-down menu."
- Arrows: "Click the < > arrows to quickly navigate to the previous and next menu option."
- Wheel: "Alternatively, hover over the menu and use the mouse wheel to quickly rotate through menu
  options."
Figure: "Choosing a Wavetable".

### 24. Using Pitch Controls (using-pitch-controls)
URL: https://xferrecords.com/web-manual/serum-2/using-pitch-controls/ | Updated: May 03, 2025
Summary: The four pitch controls (OCT, SEM, FIN, CRS), why the settings are kept separate
(automation/modulation), and how to drive wide pitch sweeps (modulate CRS, or use the Global >
Main Tuning destination for all oscillators).
Conventions / notable statements:
- "You can alter the pitch of the waveform using the OCT (octave), SEM (semitone), FIN (fine
  tuning in cents), and CRS (coarse) controls."
- "The CRS setting controls the pitch transpose that tunes or detunes continuous (no snap)
  semitones. CRS is most useful as a modulation destination or automation parameter for wide
  sweeps."
- Rationale: "Serum uses separate controls for the four settings to facilitate automation and
  modulation (rather than a combined value such as 36.04)."
- LFO workflow: "It's often handy to assign an LFO to the octave setting, for instance, without
  having to count in 12 semitones." "You can do this by modulating the CRS setting."
- Global pitch: "Use the Global > Main Tuning modulation destination to have all oscillators
  follow a coarse pitch change."
Figure: "Oscillator Pitch Controls".

### 25. Setting the Octave or Semitone Mode (setting-the-octave-or-semitone-mode)
URL: https://xferrecords.com/web-manual/serum-2/setting-the-octave-or-semitone-mode/ | Updated: May 03, 2025
Summary: OCT and SEM controls have a right-click context menu that switches their pitch mode among
Semitones, Harmonics, Ratio (adds SRC + ratio settings), and Step (MTS-ESP microtuning only).
Conventions / notable statements:
- "Serum further allows you to specify the mode for the OCT and SEM controls." "Right-click either
  control and choose the mode in the context menu."
- "Semitones - Adjust the pitch in semitones, which are the intervals between two adjacent keys on
  a piano tuned to 12-tone equal temperament used in American/European musical tradition. This
  allows for fine-tuning, transposing, or creating intervals such as minor/major thirds, fifths,
  and more."
- "Harmonics - Change the pitch by multiplying the base frequency using whole number harmonics.
  This generates pitches based on the harmonic series, which is useful for creating overtone-rich
  sounds, like organ tones or harmonic layers."
- "Ratio - Set the pitch of the oscillator in relation to the base frequency using ratios, which is
  common in FM synthesis. In this case, the oscillator is tuned to a specific ratio relative to
  another oscillator to create complex timbres. When you select this mode, you can then set the
  specific source (SRC) and ratio."
- "Step - Adjust the pitch up or down in periods and steps, as defined by the active MTS-ESP
  tuning. This option only appears when you are using microtuning and have an MTS-ESP tuning source
  available."
Figure: "Selecting the Mode".

### 26. Routing an Oscillator or Filter (routing-an-oscillator-or-filter)
URL: https://xferrecords.com/web-manual/serum-2/routing-an-oscillator-or-filter/ | Updated: May 03, 2025
Summary: Signal routing from oscillators (OSC A/B/C, SUB, NOISE) and filters (FILTER 1/2) to
targets (Filter, Main, Direct, None), the routing button and its revealed controls, the filter-mix
knob convention, default routings, and BUS 1/BUS 2 sends.
Conventions / notable statements:
- "You can route the signal from any oscillator (OSC A, OSC B, OSC C, SUB, and NOISE) or any
  filters (FILTER 1 and FILTER 2) to a range of targets."
- Routing target table (verbatim):
  - "Filter - Route the signal to either FILTER 1, FILTER 2, or by varying degrees to both."
  - "Main - Route the signal to the main output, passing through the effects section."
  - "Direct - Route the signal to bypass the filter and effects section and play 'clean' along
    with the main output."
  - "None - Route the signal to no output path. You can use this setting when you want to use an
    oscillator as a modulation source without having the sound included as part of the output
    signal."
- Access: "You can access the routing options by clicking the button near the top right of an
  oscillator or filter." "When you click, a set of controls appear that are relevant to the routing
  path."
- Filter-mix knob convention: "in the case of routing to the Serum filters, you have the option of
  routing the signal completely to FILTER 1 (knob turned far left), completely to FILTER 2 (knob
  turned far right), or to some combination of both (knob set somewhere in between)."
- Defaults: "By default, OSC A is automatically routed to FILTER 1, though FILTER 1 is not enabled
  in new presets." "The other oscillators and filters are automatically routed to the Main output.
  You can change the routing at any time."
- Busses: "You can also send the signal to the Serum busses (BUS 1 and BUS 2) by adjusting the
  corresponding knobs."
- Changing routing: "To change the signal routing, click the button and choose another option, as
  appropriate."
Figures: "Accessing the Signal Routing Settings", "Filter Routing and Busses", "Routing Menu",
"Routing Menu Button".

### 27. Accessing the Oscillator or Filter Menu (accessing-the-oscillator-or-filter-menu)
URL: https://xferrecords.com/web-manual/serum-2/accessing-the-oscillator-or-filter-menu/ | Updated: May 03, 2025
Summary: The module context menu (right-click the module label) hosts the most common per-module
operations: lock, init, copy/paste with or without modulations, and pitch-tracking enable.
Conventions / notable statements:
- "You can use the oscillator or filter menu to perform the most common operations related to the
  module."
- "These operations include locking the module, initializing the module, copying and pasting a
  module (with or without modulations), and enabling pitch tracking (in the case of oscillators)."
- "Right-click the module label to access the context menu."
Figure: "Oscillator Menu".

### 28. Locking a Module (locking-a-module)
URL: https://xferrecords.com/web-manual/serum-2/locking-a-module/ | Updated: May 03, 2025
Summary: Lock Module (module context menu) freezes a module's settings across preset changes;
individual controls can be unlocked; a full Init Preset clears locks.
Conventions / notable statements:
- "You can lock a module by right-clicking the module label and choosing Lock Module in the context
  menu (see the Oscillator Menu above). This causes the parameters (settings) of the oscillator
  module to remain unchanged (locked) as you change presets."
- Example: "if you lock OSC A, the module remains the same even when you load a preset (that would
  normally change the oscillator module)."
- Partial unlock: "After locking a module, you can unlock individual controls (such as the WT POS
  knob, for example), as needed."
- Reset exception: "Note: This does not apply when you initialize the entire preset (by choosing
  Init Preset using the main menu). This initializes all settings and removes any module locks that
  you might have set."

### 29. Initializing a Module (initializing-a-module)
URL: https://xferrecords.com/web-manual/serum-2/initializing-a-module/ | Updated: May 04, 2025
Summary: Init Module (module context menu) resets just that module to initial settings, including
removing its modulators, without touching anything else.
Conventions / notable statements:
- "After making changes to an oscillator or filter, you can return the module to an initialized
  state without affecting any other Serum setting."
- "Right-click the module label and choose Init Module in the context menu. The oscillator returns
  to initial settings (including removing all modulators assigned to the module)."

### 30. Copying a Module (copying-a-module)
URL: https://xferrecords.com/web-manual/serum-2/copying-a-module/ | Updated: May 04, 2025
Summary: Module copy/paste (with or without modulations) via the context menu or modifier-dragging
of the module label; plain drag swaps modules; clipboard persists; cross-instance copy is not
possible.
Conventions / notable statements:
- Scope: "You can copy an oscillator or filter (with or without modulations) and paste it to
  another (similar) module. This works when copying and pasting modules in the same preset, as well
  as when you want to copy and paste between presets."
- Menu copy example: "Right-clicking the oscillator label and choosing Copy in the menu copies the
  module to Serum's internal clipboard. Right-clicking another oscillator module and choosing Paste
  in the menu pastes the configuration (all settings except the WT POS modulation) to the
  corresponding module."
- With modulations: "To copy and paste a module configuration including modulations, right-click
  the oscillator label and choose Copy (w/mods) in the menu. Pasting to a new module now includes
  the WT POS modulation from the earlier example."
- Clipboard persistence: "the module configuration stays on Serum's internal clipboard after
  pasting, allowing you to quickly paste the same configuration to multiple modules as needed. It
  is not possible, however, to copy a module from one instance of Serum to another."
- Drag-to-copy: "Hold the Option/Alt key and drag the module label (next to the power button) to
  another (similar) module to copy the module without modulations."
- Drag-to-copy with mods: "Hold the Shift-Option or Shift-Alt keys and drag the module label to
  another module to copy with modulations."
- Drag-to-swap: "Dragging from one module label to another without any keyboard modifiers swaps the
  two modules (including modulation assignments)."

### 31. Enabling Pitch Tracking (enabling-pitch-tracking)
URL: https://xferrecords.com/web-manual/serum-2/enabling-pitch-tracking/ | Updated: May 04, 2025
Summary: Pitch tracking (on by default) makes an oscillator follow played MIDI notes; it can be
toggled off via the oscillator context menu for drones/noise/percussion, with documented fallback
pitches when disabled.
Conventions / notable statements:
- "Pitch tracking instructs the oscillator to adjust its pitch in response to the MIDI note or key
  being played. This ensures that the oscillator's frequency corresponds to the desired musical
  pitch."
- Default/toggle: "Pitch tracking is enabled by default." "You can choose to disable pitch tracking
  by right-clicking the oscillator label and toggling Enable Pitch Tracking off in the context
  menu."
- Use cases listed: "Drones or static sounds", "Percussive sounds", "Noise-based effects",
  "Experimental sounds", plus "You can also disable pitch tracking to add layers without harmonic
  conflicts."
- Fixed pitch when disabled: "When pitch tracking is disabled, the Multisample, Sample, Granular,
  and Spectral oscillators play C3 (MIDI note 60), whereas the Wavetable oscillator plays C-2 (MIDI
  note 0), allowing it to be used as an LFO."

### 32. Pitch Bend Tracking (pitch-bend-tracking)
URL: https://xferrecords.com/web-manual/serum-2/pitch-bend-tracking/ | Updated: May 04, 2025
Summary: When pitch tracking is off, a context-menu option (for Sample, Granular, Spectral types
only) decides whether MIDI pitch bend still affects the oscillator; Wavetable and Multisample
always track bend.
Conventions / notable statements:
- "Pitch bend tracking determines whether MIDI pitch bend affects the frequency of an oscillator
  when pitch tracking is disabled."
- Availability: "The option appears on the Oscillator context menu only when Enable Pitch Tracking
  is disabled, and is only available for Sample, Granular, and Spectral oscillator types. Pitch
  bend tracking is enabled by default."
- Use case: "You might choose to disable pitch bend tracking for static, drone, or noise-based
  sounds so that they remain at a constant pitch, even when moving the pitch bend wheel."
- Exception: "Note that Wavetable and Multisample oscillator types always track pitch bend when
  pitch tracking is disabled."
Figure: "Pitch Bend Tracking Enabled".

### 33. Resizing the UI (resizing-the-ui)
URL: https://xferrecords.com/web-manual/serum-2/resizing-the-ui/ | Updated: May 04, 2025
Summary: Two resize paths (corner drag; Serum 2 logo menu with preset sizes), a "set as default"
command, and a documented 100% default.
Conventions / notable statements:
- "You can resize the Serum user interface to make it fit appropriately within your work
  environment."
- Corner drag: "The easiest way to resize the interface is to click and drag the lower right corner
  of the UI (similar to how you would resize most other windows using your computer)."
- Menu path: "For more precise control, click the Serum 2 logo (near the top left) and choose a
  resize option in the menu that appears. The window resizes to match your selection."
- Persist size: "After resizing, you can make this size the default setting by clicking the Serum 2
  logo again and choosing Set x% as Default, where x is the current setting."
- Restore: "To return to the default setting of 100%, click the Serum 2 logo and choose Default
  (100%) using the menu."
Figure: "Resize Menu".

================================================================================
## 2. Conventions Library

Flat list of every UI/workflow convention captured across the 33 pages. Each entry cites its
source page as "(page: slug)". Numbers of key modifiers, pitches, and percentages are as stated in
the manual.

1. Oscillators can be routed through one or both of the dual filters. (page: exploring-serum)
2. Envelopes and LFOs are fully configurable and can be assigned to almost any control. (page: exploring-serum)
3. Each of OSC A, OSC B, OSC C picks its sound-generator type (Wavetable, Multisample, Sample, Granular, Spectral) from a drop-down menu. (page: exploring-sound-design-in-serum)
4. Clicking piano keys at the bottom of the UI plays notes (default sawtooth sound). (page: adding-serum-to-a-track)
5. Click "- Init -" to display the Serum presets menu. (page: loading-a-serum-preset)
6. The "< >" arrows to the right of the preset name navigate previous/next within a preset subfolder without reopening the presets menu. (page: loading-a-serum-preset)
7. The presets browser button sits next to the main menu near the top right; clicking a list entry loads that preset. (page: loading-a-serum-preset)
8. Most presets load immediately; presets with larger embedded samples show a small green progress bar directly beneath the preset name while loading. (page: loading-a-serum-preset)
9. In the presets browser, the (play) button previews that preset: an embedded preview clip (MIDI sequence) if defined, otherwise a "fallback" clip. (page: loading-a-serum-preset)
10. Clicking another play button previews that preset; the stop button stops the preview. (page: loading-a-serum-preset)
11. The fallback preview clip is selectable from three standard options; auto-preview clips are also supported (see "Performing Standard Preset Operations"). (page: loading-a-serum-preset)
12. The "- Init -" preset has a single wavetable oscillator enabled (OSC A) plus basic envelope and LFO modulators. (page: creating-a-new-sound)
13. Main menu > Init Preset initializes Serum to default settings (used to start over). (page: creating-a-new-sound)
14. Double-click the ARTIST field (directly below the preset name) to type the artist; double-click the DESC field to add description text. (page: saving-changes)
15. Saving flow: click the disk button to the left of the preset name, then click Save. (page: saving-changes)
16. Re-saving: click the save button; a dialog allows typing a new file name or overwriting the existing preset file. (page: saving-changes)
17. Option-click (macOS)/Alt-click (Windows) the disk button overwrites using the same file name without displaying the dialog. (page: saving-changes)
18. Clicking the embed button while saving embeds a wavetable or sample into the preset; the button changes to show it is enabled. (page: embedding-content-when-saving-a-preset)
19. Alternatively, click the name of the wavetable or sample and choose Embed in Preset in the context menu. (page: embedding-content-when-saving-a-preset)
20. Embedding is not available for factory-supplied content. (page: embedding-content-when-saving-a-preset)
21. Hovering over the left of the Serum logo reveals a wave icon; dragging it to a DAW audio track exports the last played note or chord (WAV). (page: dragging-audio-to-your-daw)
22. The export silently plays the note or chord using the corresponding pitch, velocity, and duration. (page: dragging-audio-to-your-daw)
23. Exported audio is also captured as a WAV file in the Serum Presets > Renders folder. (page: dragging-audio-to-your-daw)
24. Option-click (macOS)/Alt-click (Windows) the wave icon opens the Renders folder. (page: dragging-audio-to-your-daw)
25. Shift-drag the wave icon copies the current (saved) preset to macOS Finder/Windows Explorer. (page: dragging-audio-to-your-daw)
26. Hover over a control and pause to display its help tooltip. (page: displaying-help-tooltips)
27. Tooltips require the "Help tooltips" global preference to be set to SHOW; enabled by default on first install. (page: displaying-help-tooltips)
28. Hovering a control that has modulation assigned displays the modulation sources (e.g. CUTOFF shows LFO 3 and ENV 2). (page: displaying-help-tooltips)
29. The on-screen keyboard plays notes with the mouse and monitors notes played on an external MIDI or computer keyboard. (page: using-the-serum-keyboard)
30. The on-screen keyboard indicates which notes are played through the Serum clip player and arpeggiator. (page: using-the-serum-keyboard)
31. TRANSPOSE sets semitones (positive/negative) to transpose all incoming and generated MIDI notes. (page: using-the-serum-keyboard)
32. KEY sets the key used throughout Serum, most notably in the CLIP and ARP modules. (page: using-the-serum-keyboard)
33. SCALE sets the scale; notes outside the scale automatically conform to the selected scale. (page: using-the-serum-keyboard)
34. SWING swings/shuffles the timing of the grid in the CLIP and ARP editors. (page: using-the-serum-keyboard)
35. OSC MAPPING edits the note and velocity ranges of the oscillators and arpeggiator. (page: using-the-serum-keyboard)
36. Click and drag a knob or slider up/down or left/right to adjust it; a pop-up displays the current value. (page: using-knobs-and-sliders)
37. Hold Shift while dragging for fine-tune adjustment. (page: using-knobs-and-sliders)
38. Mouse scroll wheel adjusts values up/down without showing the value pop-up. (page: using-knobs-and-sliders)
39. Double-click a knob or slider to display a text box showing the current value for precise entry. (page: using-knobs-and-sliders)
40. Right-click a knob or slider to open its context menu of settings and operations for that control. (page: using-knobs-and-sliders)
41. The control menu can assign one or more modulation sources (such as ENV 1 or LFO 2). (page: using-knobs-and-sliders)
42. The control menu can bypass or remove a modulator, or remove all modulators assigned to the control. (page: using-knobs-and-sliders)
43. Some controls offer additional context menu options depending on context. (page: using-knobs-and-sliders)
44. Reset Control resets the control to its default value; identical to Cmd-click (macOS)/Ctrl-click (Windows). (page: using-knobs-and-sliders)
45. MIDI Learn activates MIDI learn mode (Serum waits for an incoming MIDI CC value); on receipt, learn deactivates and the CC# is assigned; assignment is saved with the preset (patch). (page: using-knobs-and-sliders)
46. Lock Parameter locks the control setting so it does not change when loading presets; the control can still be adjusted manually. (page: using-knobs-and-sliders)
47. Reset Control and Lock Parameter appear in the context menu of almost every control. (page: using-knobs-and-sliders)
48. MIDI CC assignments are saved and recalled with the DAW session. (page: using-knobs-and-sliders)
49. MIDI CC assignments saved in a preset load only if the Load MIDI Map from Preset preference (Global page) is enabled; disabled by default. (page: using-knobs-and-sliders)
50. Save MIDI Map (main menu) saves default.SerumMIDIMap into the Serum 2 Presets/System/MIDI CC Maps folder; it loads automatically for a new Serum instance and for Init Preset, and on preset selection when Load MIDI Map from Preset is disabled. (page: using-knobs-and-sliders)
51. Undo and redo buttons are in the Serum header, near the top right. (page: undo-and-redo)
52. Undo reverts the last operation (e.g. a knob change or an LFO shape change); redo reapplies the last undo for side-by-side comparison. (page: undo-and-redo)
53. Just about any operation in Serum can be undone/redone. (page: undo-and-redo)
54. The MAIN knob (near the top right) controls main output volume; the stereo volume appears as a meter next to the knob. (page: controlling-the-main-output-volume)
55. Enable an oscillator by clicking its label (which contains the oscillator name and enable button); when enabled the button turns green. (page: enabling-an-oscillator-or-filter)
56. The power button mutes/disables an oscillator (to solo others or free CPU); a disabled oscillator's entire panel is dimmed. (page: enabling-an-oscillator-or-filter)
57. A filter is enabled by clicking the power button directly. (page: enabling-an-oscillator-or-filter)
58. Oscillator and filter options are chosen through the associated drop-down menu (oscillators: wavetables, samples, multisamples, and more; filters: the filter type). (page: choosing-oscillator-or-filter-options)
59. The "< >" arrows navigate to the previous and next menu option. (page: choosing-oscillator-or-filter-options)
60. Hovering over the menu and using the mouse wheel rotates quickly through menu options. (page: choosing-oscillator-or-filter-options)
61. Pitch controls: OCT (octave), SEM (semitone), FIN (fine tuning in cents), CRS (coarse). (page: using-pitch-controls)
62. CRS is continuous (no snap) semitone transpose; most useful as a modulation destination or automation parameter for wide sweeps. (page: using-pitch-controls)
63. The four pitch settings are separate controls (rather than a combined value such as 36.04) to facilitate automation and modulation. (page: using-pitch-controls)
64. Assigning an LFO to the octave setting avoids counting in 12 semitones; modulating CRS gives smooth wide pitch sweeps (e.g. siren-type sounds). (page: using-pitch-controls)
65. Global > Main Tuning is a modulation destination that makes all oscillators follow a coarse pitch change. (page: using-pitch-controls)
66. Right-click the OCT or SEM control and choose its mode in the context menu. (page: setting-the-octave-or-semitone-mode)
67. OCT/SEM mode options: Semitones, Harmonics, Ratio, Step. (page: setting-the-octave-or-semitone-mode)
68. Ratio mode adds settings for the specific source (SRC) and ratio. (page: setting-the-octave-or-semitone-mode)
69. Step mode appears only when using microtuning with an MTS-ESP tuning source available. (page: setting-the-octave-or-semitone-mode)
70. Routable signal sources: OSC A, OSC B, OSC C, SUB, NOISE, FILTER 1, FILTER 2. (page: routing-an-oscillator-or-filter)
71. Routing targets: Filter (to FILTER 1, FILTER 2, or a mix), Main (through the effects section), Direct (bypasses filter and effects; plays clean alongside main output), None (no output; oscillator usable purely as a modulation source). (page: routing-an-oscillator-or-filter)
72. Routing options are accessed via the routing button near the top right of an oscillator or filter; clicking reveals controls relevant to the routing path. (page: routing-an-oscillator-or-filter)
73. Filter-routing knob convention: far left = completely FILTER 1; far right = completely FILTER 2; in between = a combination of both. (page: routing-an-oscillator-or-filter)
74. Default routing: OSC A to FILTER 1 (though FILTER 1 is not enabled in new presets); all other oscillators and filters to the Main output; changeable at any time. (page: routing-an-oscillator-or-filter)
75. BUS 1 and BUS 2 sends are set by adjusting the corresponding knobs. (page: routing-an-oscillator-or-filter)
76. To change signal routing, click the routing button and choose another option. (page: routing-an-oscillator-or-filter)
77. Right-click the module label (oscillator or filter) to access its context menu. (page: accessing-the-oscillator-or-filter-menu)
78. Module menu operations: lock module, initialize module, copy and paste module (with or without modulations), enable pitch tracking (oscillators). (page: accessing-the-oscillator-or-filter-menu)
79. Lock Module (right-click module label > Lock Module) keeps the module's parameters unchanged (locked) as presets change. (page: locking-a-module)
80. After locking a module, individual controls (e.g. the WT POS knob) can be unlocked as needed. (page: locking-a-module)
81. Init Preset (main menu) removes any module locks - it initializes all settings. (page: locking-a-module)
82. Init Module (right-click module label > Init Module) returns the module to initial settings, including removing all modulators assigned to the module, without affecting any other Serum setting. (page: initializing-a-module)
83. Copy/Paste (right-click module label) copies an oscillator/filter configuration to another similar module; works within a preset and between presets; plain Copy carries all settings except modulations (example: WT POS modulation excluded). (page: copying-a-module)
84. Copy (w/mods) includes modulations in the copied configuration. (page: copying-a-module)
85. The copied configuration stays on Serum's internal clipboard after pasting, allowing paste to multiple modules; it is not possible to copy a module from one instance of Serum to another. (page: copying-a-module)
86. Option/Alt + drag the module label (next to the power button) to another similar module = copy without modulations. (page: copying-a-module)
87. Shift-Option / Shift-Alt + drag the module label = copy with modulations. (page: copying-a-module)
88. Dragging from one module label to another with no keyboard modifiers swaps the two modules (including modulation assignments). (page: copying-a-module)
89. Pitch tracking is enabled by default; disable it by right-clicking the oscillator label and toggling Enable Pitch Tracking off. (page: enabling-pitch-tracking)
90. When pitch tracking is disabled: Multisample, Sample, Granular, and Spectral oscillators play C3 (MIDI note 60); the Wavetable oscillator plays C-2 (MIDI note 0), allowing it to be used as an LFO. (page: enabling-pitch-tracking)
91. The Pitch Bend Tracking option appears in the oscillator context menu only when Enable Pitch Tracking is disabled, and only for Sample, Granular, and Spectral oscillator types; enabled by default. (page: pitch-bend-tracking)
92. Wavetable and Multisample oscillator types always track pitch bend when pitch tracking is disabled. (page: pitch-bend-tracking)
93. Resize the UI by clicking and dragging the lower right corner (like most windows). (page: resizing-the-ui)
94. The Serum 2 logo (near the top left) opens a resize menu with selectable sizes; the window resizes to match the selection. (page: resizing-the-ui)
95. "Set x% as Default" (Serum 2 logo menu) makes the current size the default. (page: resizing-the-ui)
96. "Default (100%)" (Serum 2 logo menu) returns to the default setting of 100%. (page: resizing-the-ui)

================================================================================
## 3. Figures Appendix

Figure captions and image URLs exactly as found in the raw HTML (images were not downloaded;
URLs are relative to https://xferrecords.com unless shown absolute, and the site's own signed-blob
tokens are truncated in-source with "..."). Alt text included where present.

### 1. Welcome (welcome)
- Caption: "Serum Main Screen" | Image: https://xferrecords.com/rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTE4MDksInB1ciI6ImJsb2JfaWQifX0=--047dca07d9b3637d30332ddb880567559ba81f45/serum.png | Alt: ""

### 2. Registering Serum (registering-serum)
No figures on this page.

### 3. Getting in Touch (getting-in-touch)
No figures on this page.

### 4. Downloading Serum (downloading-serum)
- Caption: "Xfer Records User Menu" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTI3MTYsInB1ciI6ImJsb2JfaWQifX0=--2210b20910ac41246a392dc81dac9f5a57df91f8/serum_xferrecords_menu.png | Alt: ""

### 5. Installing Serum (installing-serum)
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMwMDksInB1ciI6ImJsb2JfaWQifX0=--2d5970e6651d97bbf7b068721d7ff7b5ff1c723d/icon_lightbulb_x.png | Alt: ""

### 6. Exploring Serum (exploring-serum)
- Caption: "Serum Interface" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMwNTcsInB1ciI6ImJsb2JfaWQifX0=--11dd5516ce269317757ade080e4bb5a0f6b8e42b/serum_explore_sections.png | Alt: "Serum Interface"

### 7. Exploring Sound Design in Serum (exploring-sound-design-in-serum)
- Caption: "Serum Oscillators" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMwNTksInB1ciI6ImJsb2JfaWQifX0=--79da81f903381f63127103c914cf14d678726bc6/serum_oscillators.png | Alt: "Serum Oscillators"

### 8. Getting Started (getting-started)
No figures on this page.

### 9. Adding Serum to a Track (adding-serum-to-a-track)
No figures on this page.

### 10. Loading a Serum Preset (loading-a-serum-preset)
- Caption: "Serum Presets Menu" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMwNjIsInB1ciI6ImJsb2JfaWQifX0=--cebc93ad121d3625fae6d384401182f4ef7f21d8/serum_header_init_zo_co.png | Alt: "Serum Presets Menu"
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMwNjQsInB1ciI6ImJsb2JfaWQifX0=--382bf52b4bc27fbe46d9b04d3a9cf4d2525495fd/serum_button_presets_browser_med.png | Alt: "Presets Browser Button"
- Caption: "Serum Presets Browser" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMwNjYsInB1ciI6ImJsb2JfaWQifX0=--4f5419a962460b88966e26c7536f9b6ecb9c9477/serum_presets_browser.png | Alt: "Serum Presets Browser"
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMwNzIsInB1ciI6ImJsb2JfaWQifX0=--aa5c0e7d0b7d3dc9829711dbed255f24ef23c42c/serum_button_preset_play.png | Alt: "Play Button"
- Caption: "Presets Showing Play Buttons" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMwNjgsInB1ciI6ImJsb2JfaWQifX0=--7483ac98c0892ad2b79524955bd2cbb6120473f4/serum_presets_browser_play.png | Alt: "Presets Showing Play Buttons"
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMwNzQsInB1ciI6ImJsb2JfaWQifX0=--6c67fc9c3df5fb90a0517d7cb21d95c18d9b2866/serum_button_preset_stop.png | Alt: "Stop Button"
- Caption: "Preset Playing" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMwNzAsInB1ciI6ImJsb2JfaWQifX0=--10c9c66efeb7dabc42e99e7ea91f153a66ff78e4/serum_presets_browser_playing.png | Alt: "Preset Playing"

### 11. Creating a New Sound (creating-a-new-sound)
- Caption: "Choose Init Preset from the Main Menu" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMxMDEsInB1ciI6ImJsb2JfaWQifX0=--5cb583d799747084c86fa7e9948180699e3380d1/serum_main_menu_init_preset_zo.png | Alt: "Choose Init Preset from the Main Menu"

### 12. Saving Changes (saving-changes)
- Caption: "Preset Metadata (Artist and Description)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMxMDgsInB1ciI6ImJsb2JfaWQifX0=--0c03486c479c43bf3bb2f7ebc2a1c02c6c0a169a/serum_preset_metadata.png | Alt: "Preset Metadata (Artist and Description)"
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMxMDYsInB1ciI6ImJsb2JfaWQifX0=--5ff37377a080b7cdd581ce2507dc63ebd269afda/serum_button_preset_save.png | Alt: "Save (Disk) Button"
- Caption: "Save (Disk) Button" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMxMDQsInB1ciI6ImJsb2JfaWQifX0=--3aee2d9def751c79055145a8a4a6981f291c0434/serum_preset_save_co.png | Alt: "Save (Disk) Button"
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMwMDksInB1ciI6ImJsb2JfaWQifX0=--2d5970e6651d97bbf7b068721d7ff7b5ff1c723d/icon_lightbulb_x.png | Alt: ""

### 13. Embedding Content When Saving a Preset (embedding-content-when-saving-a-preset)
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMxMTcsInB1ciI6ImJsb2JfaWQifX0=--dc0b46368bfefde0cffe9e10e235fe99179754ef/serum_button_embed_preset_disabled.png | Alt: ""
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMxMTksInB1ciI6ImJsb2JfaWQifX0=--8948041c48c4d17a9cdd7493542719e5963e69fc/serum_button_embed_preset_enabled.png | Alt: ""
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMwMDksInB1ciI6ImJsb2JfaWQifX0=--2d5970e6651d97bbf7b068721d7ff7b5ff1c723d/icon_lightbulb_x.png | Alt: ""
- Caption: "Embed Indicator" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMxMTUsInB1ciI6ImJsb2JfaWQifX0=--f29d022ddcb2b7682c3d2485b5722d73aeb3d17b/serum_osc_embed_preset_zo_co.png | Alt: "Embed Indicator"

### 14. Dragging Audio to Your DAW (dragging-audio-to-your-daw)
- Caption: "Exporting Audio by Dragging" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMxNjYsInB1ciI6ImJsb2JfaWQifX0=--f2c2e2bbd31723ccbc26568100a3d743d8e84f8f/serum_export_wav_zo_co.png | Alt: "Exporting Audio by Dragging"
- Caption: "Dragging Audio to Your DAW" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMxNjgsInB1ciI6ImJsb2JfaWQifX0=--8da0cfa353c67c8f0020fed5836aa17cc7fbeaa4/serum_export_wav_ableton.png | Alt: "Dragging Audio to Your DAW"
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMwMDksInB1ciI6ImJsb2JfaWQifX0=--2d5970e6651d97bbf7b068721d7ff7b5ff1c723d/icon_lightbulb_x.png | Alt: ""

### 15. Exploring Basic Operations (exploring-basic-operations)
No figures on this page.

### 16. Displaying Help (Tooltips) (displaying-help-tooltips)
- Caption: "Tooltip Help" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMxNzQsInB1ciI6ImJsb2JfaWQifX0=--ac54e17edb79563147485095d71dd79c7c4ed530/serum_tooltip.png | Alt: "Tooltip Help"
- Caption: "Tooltip Showing Modulation Sources" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMxNzcsInB1ciI6ImJsb2JfaWQifX0=--f13b7431b5751493e267cc16f4119f2c0dc7279b/serum_tooltip_mod.png | Alt: "Tooltip Showing Modulation Sources"

### 17. Using the Serum Keyboard (using-the-serum-keyboard)
- Caption: "Serum Keyboard" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMxNzksInB1ciI6ImJsb2JfaWQifX0=--6923ef27a11446eb67736df48744dadee3d47f22/serum_keyboard.png | Alt: "Serum Keyboard"

### 18. Using Knobs and Sliders (using-knobs-and-sliders)
- Caption: "Click-Dragging a Knob" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMxODEsInB1ciI6ImJsb2JfaWQifX0=--b326616c3e87e694fc96720c608666daf2a29b98/serum_control_click_drag.png | Alt: "Click-Dragging a Knob"
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMwMDksInB1ciI6ImJsb2JfaWQifX0=--2d5970e6651d97bbf7b068721d7ff7b5ff1c723d/icon_lightbulb_x.png | Alt: ""
- Caption: "Right-Click Context Menu" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMxODMsInB1ciI6ImJsb2JfaWQifX0=--c884a5b26615abfe3516187233469e80835645fe/serum_control_menu.png | Alt: "Right-Click Context Menu"
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMxOTIsInB1ciI6ImJsb2JfaWQifX0=--845fd76842121c34eab24dcbf95e3d76858a464c/gears.png | Alt: ""

### 19. Undo and Redo (undo-and-redo)
- Caption: "Undo and Redo Buttons" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMyMTAsInB1ciI6ImJsb2JfaWQifX0=--b51f48c1c70355a553ab0a1eaa3d861afb1024be/serum_header_undo_redo_zo_co.png | Alt: "Undo and Redo Buttons"
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMyMTIsInB1ciI6ImJsb2JfaWQifX0=--bc3aca334da8745531490a7ee86236cfeb3f3f7d/serum_button_undo.png | Alt: "Undo Button"
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMyMTQsInB1ciI6ImJsb2JfaWQifX0=--b73f411c08d77c8b22e4b7eef0d2ffc38e19b948/serum_button_redo.png | Alt: "Redo Button"

### 20. Controlling the Main Output Volume (controlling-the-main-output-volume)
- Caption: "Main Volume" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMyMjIsInB1ciI6ImJsb2JfaWQifX0=--29f770d108343a41efa1753bb2ca5927edbfd953/serum_main_volume.png | Alt: "Main Volume"

### 21. Using Oscillators and Filters (using-oscillators-and-filters)
No figures on this page.

### 22. Enabling an Oscillator or Filter (enabling-an-oscillator-or-filter-7b4f0de4-5686-44f7-8d8e-0b926ce77fe8)
- Caption: "Enabling OSC B" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMzMTYsInB1ciI6ImJsb2JfaWQifX0=--60e19f960e7f5e5a9b00d616230528673d3033fb/serum_osc_b_disabled_co.png | Alt: "Enabling OSC B"
- Caption: "OSC B Enabled" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMzMTgsInB1ciI6ImJsb2JfaWQifX0=--9705bbaa829eb025a96d602318d1aa02524ae59e/serum_osc_b_enabled.png | Alt: "OSC B Enabled"
- Caption: "Enabling Filter 1" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMzMjAsInB1ciI6ImJsb2JfaWQifX0=--0e61272e2bdd39cdb993153b3360ae22ad7dcda7/serum_filters_disabled_sm_co.png | Alt: "Enabling Filter 1"
- Caption: "Filter 1 Enabled" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMzMjIsInB1ciI6ImJsb2JfaWQifX0=--01101b3e70f43ce27b0cce64a2997a23e836a315/serum_filters_enabled_sm.png | Alt: "Filter 1 Enabled"

### 23. Choosing Oscillator or Filter Options (choosing-oscillator-or-filter-options)
- Caption: "Choosing a Wavetable" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMzMjQsInB1ciI6ImJsb2JfaWQifX0=--35ffcf9533c86f2db9eb72438daac1cf34da60e3/serum_osc_wavetable_menu_r.png | Alt: "Choosing a Wavetable"

### 24. Using Pitch Controls (using-pitch-controls)
- Caption: "Oscillator Pitch Controls" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMzMjYsInB1ciI6ImJsb2JfaWQifX0=--503d5117364a07fae6bbcacea965699d5cc389ef/serum_osc_a_pitch_zo_co.png | Alt: "Oscillator Pitch Controls"
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMwMDksInB1ciI6ImJsb2JfaWQifX0=--2d5970e6651d97bbf7b068721d7ff7b5ff1c723d/icon_lightbulb_x.png | Alt: ""

### 25. Setting the Octave or Semitone Mode (setting-the-octave-or-semitone-mode)
- Caption: "Selecting the Mode" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMzMjgsInB1ciI6ImJsb2JfaWQifX0=--13eac0ec0c666c8fb6d14b60030ca3fee285c52f/serum_osc_a_mode_menu.png | Alt: "Selecting the Mode"

### 26. Routing an Oscillator or Filter (routing-an-oscillator-or-filter)
- Caption: "Accessing the Signal Routing Settings" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMzMzUsInB1ciI6ImJsb2JfaWQifX0=--23248dc9ffa946cbe534b3244fe50b94cfbb105d/serum_osc_routing_zo_co.png | Alt: "Accessing the Signal Routing Settings"
- Caption: "Filter Routing and Busses" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMzNDEsInB1ciI6ImJsb2JfaWQifX0=--42b21c285326e173a182428b72efe32e5d06462d/serum_osc_routing_filter.png | Alt: "Filter Routing and Busses"
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMzNDUsInB1ciI6ImJsb2JfaWQifX0=--9aed0fd98a254740c63261c195e64f3b2f32f53d/serum_button_routing_menu.png | Alt: "Routing Menu Button"
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMzNDMsInB1ciI6ImJsb2JfaWQifX0=--401db82ed29933e11e85b8841bc1542ae2ede6d5/serum_osc_routing_menu.png | Alt: "Routing Menu"

### 27. Accessing the Oscillator or Filter Menu (accessing-the-oscillator-or-filter-menu)
- Caption: "Oscillator Menu" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMzNDcsInB1ciI6ImJsb2JfaWQifX0=--bb77f4ca944831e9e362f97cef6eb4e12a89af4b/serum_osc_header_menu.png | Alt: "Oscillator Menu"

### 28. Locking a Module (locking-a-module)
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMwMDksInB1ciI6ImJsb2JfaWQifX0=--2d5970e6651d97bbf7b068721d7ff7b5ff1c723d/icon_lightbulb_x.png | Alt: ""

### 29. Initializing a Module (initializing-a-module)
No figures on this page.

### 30. Copying a Module (copying-a-module)
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMwMDksInB1ciI6ImJsb2JfaWQifX0=--2d5970e6651d97bbf7b068721d7ff7b5ff1c723d/icon_lightbulb_x.png | Alt: ""

### 31. Enabling Pitch Tracking (enabling-pitch-tracking)
- Caption: "(no caption)" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMxOTIsInB1ciI6ImJsb2JfaWQifX0=--845fd76842121c34eab24dcbf95e3d76858a464c/gears.png | Alt: ""

### 32. Pitch Bend Tracking (pitch-bend-tracking)
- Caption: "Pitch Bend Tracking Enabled" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMzNTQsInB1ciI6ImJsb2JfaWQifX0=--25f56d27091c5baf3a6c841d18f33ad2a3a412b2/serum_osc_header_menu_pitch_bend_tracking.png | Alt: "Pitch Bend Tracking Enabled"

### 33. Resizing the UI (resizing-the-ui)
- Caption: "Resize Menu" | Image: /rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6NTMzNTYsInB1ciI6ImJsb2JfaWQifX0=--54d73459b4df9541c93a656db2aad11fbab77d46/serum_resize_menu.png | Alt: "Resize Menu"

