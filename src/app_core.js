/* Anvil — core shell (Phase 0). Boot contract: arm the master tap FIRST, then fill the header
   chips. `?avtest=1` runs a runtime proof that the destination patch builds the bus chain. */
"use strict";

const ANVIL = Object.freeze({ version: "0.0.2", phase: "P0 · tap armed", built: "2026-10-07" });
window.ANVIL = ANVIL;

(function avBoot() {
  document.documentElement.setAttribute("data-av-ready", "1");
  const tapOk = (typeof avInstallAudioTap === "function") ? avInstallAudioTap() : false;
  const ver = document.getElementById("av-version");
  if (ver) ver.textContent = "v" + ANVIL.version;
  const tier = document.getElementById("av-tier");
  if (tier) tier.textContent = tapOk ? "tap: armed · engine: pending (P1)" : "tap: UNAVAILABLE";
  console.log("[anvil] boot — v" + ANVIL.version + " tap=" + tapOk);
  if (/[?&]avtest=1/.test(location.search)) { try { avTapSelfTest(); } catch (e) { console.warn("avtest", e); } }
})();

function avTapSelfTest() {
  const c = new AudioContext();
  const dest = c.destination;                    /* reading it builds the chain */
  const t = {
    viaTap: dest && dest.__avTap === true,
    keysBus: dest && dest.__avKeys === true,
    masterNode: !!(avTap.node && avTap.node.__avMaster),
    live: (avTap.live || []).filter(x => x.state !== "closed").length,
    ctxState: c.state,
  };
  const p = document.createElement("p");
  p.className = "av-mono"; p.id = "av-taptest";
  p.textContent = "TAP SELFTEST " + JSON.stringify(t);
  document.querySelector(".av-main").appendChild(p);
  try { c.close(); } catch (e) { /* ok */ }
}
