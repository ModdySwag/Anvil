/* Anvil — core shell (Phase 0).
   Boot contract: set document ready marker + fill the header chips.
   The engine (AudioWorklet, P1) will extend this file's namespace, not fork it. */
"use strict";

const ANVIL = Object.freeze({
  version: "0.0.1",
  phase: "P0 shell",
  built: "2026-10-06",
});
window.ANVIL = ANVIL;

(function avBoot() {
  document.documentElement.setAttribute("data-av-ready", "1");
  const ver = document.getElementById("av-version");
  if (ver) ver.textContent = "v" + ANVIL.version + " · " + ANVIL.phase;
  const tier = document.getElementById("av-tier");
  if (tier) tier.textContent = "engine: pending (P1)";
  console.log("[anvil] shell boot ok — v" + ANVIL.version + " (" + ANVIL.phase + ")");
})();
