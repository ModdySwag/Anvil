<!--
Anvil downloads card - DRAFT for owner review (D wave, child D4). Nothing here is live yet.

To integrate (parent):
- Copy the card block below into moddys-downloads.html; card order on the page is the order the
  cards are written there. Suggested position: directly after the Pattern Forge card (the
  sibling synth).
- In the same pass, add "Anvil" to CARDS in check-moddys-downloads.py - the checker owns the
  card list and compares it to the .card count.
- TODO tokens: fill TODO-SIZE-MB, the three TODO-SHA256-* values and the TODO-ANVIL-SHOT-*
  files after the build + deploy, FROM THE SERVED FILES. TODO-ICON: deploy anvil-icon.png
  (same convention as patternforge-icon.png; source: the repo's icon-512.png).
- Keep the sha256 and the size honest, or delete those lines for this card - the page's whole
  value is that the numbers on it are checkable.
- The pill new marker rides this card (it is the newest addition) - drop it from the World Feed
  DB card in the same pass if the convention is a single marker.

Entity note: the sibling cards carry the middot, arrows and em dash as literal glyphs; those are
entity-encoded here (&middot; &rarr; &mdash; &#11015;) so this draft stays ASCII - they render
identically once pasted into the page.

----- COPY FROM HERE -----
-->

<div class="card">
  <div class="head">
    <img class="icon" src="anvil-icon.png" alt="" width="58" height="58">
    <div>
      <h2 class="name">Anvil</h2>
      <div class="pills">
        <span class="pill ver">v1.15.0-beta</span>
        <span class="pill">Windows 10/11 &middot; 64-bit</span>
        <span class="pill">desktop app</span>
        <span class="pill">AGPL-3.0</span>
        <span class="pill new">new</span>
      </div>
    </div>
  </div>

  <p class="desc">A synthesizer and groovebox you can actually play: <b>acid, wavetable, FM,
  string, drum, granular and sampler</b> engines behind a real step sequencer and song arranger,
  a seven-slot FX rack with a drag-to-modulate matrix, a tuning studio with Scala import, and a
  searchable library for your own sounds &mdash; plus <b>10 packs / 580 presets</b> and
  WAV / stems / MIDI / Song Bundle export. It is the same app as the one at
  <b>moddys.net/anvil</b> &mdash; this is that app in its own window, by itself.</p>

  <div class="acts">
    <a class="go" href="downloads/Anvil-1.15.0-Setup.exe.zip" download>&#11015; Download the installer</a>
    <span class="file"><b>Anvil-1.15.0-Setup.exe.zip</b><br>TODO-SIZE-MB MB &middot; the installer, zipped</span>
  </div>

  <div class="route">
    <span class="who">Install &middot; four steps</span>
    <ol>
      <li>Download the <b>.zip</b> and right-click it &rarr; <b>Extract All</b>.</li>
      <li>Run <b>Anvil-1.15.0-Setup.exe</b>. It installs for your user only &mdash; no admin
          prompt &mdash; and adds a Start Menu entry and a desktop shortcut.</li>
      <li>Windows SmartScreen will say it hasn't seen this app before, because it is not
          code-signed yet: <b>More info</b> &rarr; <b>Run anyway</b>.</li>
      <li>Open <b>Anvil</b>. Press PLAY, load a preset from the store, and the 61-key dock plays
          the engine &mdash; a MIDI keyboard plays through the same path. Upgrades install
          straight over the top and keep your sounds.</li>
    </ol>
  </div>

  <div class="fine">
    <b>What it needs:</b> Windows 10 or 11, 64-bit. Everything it needs is in the install
    &mdash; the engine, all ten packs, the help and the walkthrough &mdash; so it starts and
    plays with <i>no network at all</i>; the family bridges (importing a Resonance Studio pack,
    the World Radio hand-off) are the only things that go online, and only when you click them. <br>
    <b>What it leaves behind:</b> your projects, sessions, takes, installed packs and settings
    live in <code>%APPDATA%\Anvil</code>. The installer never touches that folder, the
    uninstaller asks before deleting it and keeps it by default, so installing again picks up
    where you left off. Nothing is sent anywhere.
  </div>

  <details class="sha">
    <summary>SHA-256 &mdash; check what you downloaded</summary>
    <div class="hashes">
      <div class="hash">
        <label>Anvil-1.15.0-Setup.exe.zip (the file you download)</label>
        <div class="val">
          <code>TODO-SHA256-SETUP-EXE-ZIP</code>
          <button class="copy" type="button">copy</button>
        </div>
      </div>
      <div class="hash">
        <label>Anvil-1.15.0-Setup.exe (what is inside it)</label>
        <div class="val">
          <code>TODO-SHA256-SETUP-EXE</code>
          <button class="copy" type="button">copy</button>
        </div>
      </div>
      <div class="hash">
        <label>Anvil-1.15.0-source.zip (the corresponding source, AGPL-3.0-or-later)</label>
        <div class="val">
          <code>TODO-SHA256-SOURCE-ZIP</code>
          <button class="copy" type="button">copy</button>
        </div>
      </div>
    </div>
    <div class="fine">
      On Windows: <code>certutil -hashfile "Anvil-1.15.0-Setup.exe.zip" SHA256</code> &mdash;
      the exe inside unzips to the second hash, which is also the installer attached to the
      <b>v1.15.0-beta</b> release on GitHub. The installer carries app build
      <code>6ac4425b</code>, the same build that is live at moddys.net/anvil.
    </div>
  </details>

  <!-- SHOTS (parent TODO): capture from the installed app (windows/shots/), convert to
       deploy/shots/anvil-*.jpg + thumbs, then replace the TODO-ANVIL-SHOT tokens below. -->
  <div class="shots">
    <a class="shot" href="shots/TODO-ANVIL-SHOT-1.jpg" target="_blank" rel="noopener"><img src="shots/TODO-ANVIL-SHOT-1-t.jpg" alt="Anvil &mdash; the cockpit: zones, module heads and the rail" loading="lazy" width="224" height="140"></a>
    <a class="shot" href="shots/TODO-ANVIL-SHOT-2.jpg" target="_blank" rel="noopener"><img src="shots/TODO-ANVIL-SHOT-2-t.jpg" alt="Anvil &mdash; the Import &amp; Library overlay" loading="lazy" width="224" height="140"></a>
    <a class="shot" href="shots/TODO-ANVIL-SHOT-3.jpg" target="_blank" rel="noopener"><img src="shots/TODO-ANVIL-SHOT-3-t.jpg" alt="Anvil &mdash; the TUNE card and the scale library" loading="lazy" width="224" height="140"></a>
  </div>

  <div class="acts">
    <a class="go ghost" href="https://moddys.net/anvil/" target="_blank" rel="noopener">Run it in the browser &mdash; moddys.net/anvil</a>
    <a class="go ghost" href="https://github.com/ModdySwag/Anvil/releases/tag/v1.15.0-beta" target="_blank" rel="noopener">Release notes, installer &amp; source on GitHub</a>
    <a class="go ghost" href="downloads/Anvil-1.15.0-source.zip" download>Corresponding source (AGPL-3.0-or-later)</a>
  </div>
</div>

<!--
----- COPY TO HERE -----

Checklist before upload: every TODO token resolved; "Anvil" added to CARDS; icon + shots
deployed; sizes/sha256 read back over HTTPS from the served files; check-moddys-downloads.py
--only local (0 failed); upload --dry-run then --only; then --only live.
-->
