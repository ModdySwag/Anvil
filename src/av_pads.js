/* av_pads.js — Anvil P2 DRUM pads (page module; ONE top-level name: avPadsInit). Mounts the 4x4
   pads grid into #av-pads-host and fires the ONE note bus (avNoteDown / avNoteUp — av_note.js).

   Contract: verify/_p2_wave.md §3.3 — "4x4 pads grid into a host element (#av-pads-host), pads
   fire the note bus with the MIDI map (page 1: the 16 map notes incl. unused slots
   disabled/labelled); velocity from click position (vertical); kit label per pad."

   THE PINNED PAGE-1 MAP (midi 36..51 across the 16 slots — the engine's own law, av_drum.js):
     36 kick · 37 rim · 38 snare · 39 clap · 42 ch · 45 lt · 46 oh · 47 mt · 49 crash · 50 ht ·
     51 ride; slots 40/41/43/44/48 are UNUSED on this page (disabled + labelled "—").
   Grid order: MPC law — pad row 1 (midi 36..39) is the BOTTOM row, rows ascend upward, so the
   kick sits bottom-left where a drummer's hand already expects it.

   LAWS / idioms (av_kb.js, av_synth.js):
   - velocity from the pointer's VERTICAL position inside the pad: top = soft (0.35), bottom =
     full (1.0); keyboard activation plays 0.9. The bus clamps 0.05..1 again, and pre-scales onto
     the engine voice (avNoteDown's optional vel).
   - pointerdown sounds the note and sets pointer CAPTURE, so the matching pointerup/pointercancel
     always lands back on the pad even when the finger slides off; a window blur flushes every
     pad-held note (no droning, the av_kb law).
   - NO glide/pointerover law: drums do not glissando (each pad is an independent trigger; sliding
     across pads must not re-fire).
   - keyboard activation (e.detail === 0) plays the note and times its release (350 ms) — the
     pointer path (which already sounded on pointerdown) is never doubled up (av_kb a11y F9 law).
   - contextmenu is prevented on the grid (touch long-press hygiene).
   - idempotent via host.dataset.avPads; boot contract: avPadsInit() !== false (app_core idiom).

   CSS CLASSES THIS MODULE NEEDS (parent applies to styles.css):
     .av-pads        the 4x4 grid (display:grid; grid-template-columns:repeat(4,1fr); gap;
                     touch-action:none — REQUIRED so touch drags never scroll mid-hit)
     .av-pad         one pad button (position:relative; user-select:none; touch-action:none)
     .av-pad-off     unused slot (dimmed; native disabled)
     .av-pad-on      hit flash (added ~140 ms on any trigger)
     .av-pad-label   the kit-name line (e.g. KICK)
     .av-pad-note    the small note-name line (e.g. C2)
   ============================================================================================== */
"use strict";

function avPadsInit(hostArg) {
  if (typeof document === "undefined") return false;
  const host = (hostArg && hostArg.nodeType === 1) ? hostArg
    : document.getElementById("av-pads-host");
  if (!host) return false;
  if (host.dataset && host.dataset.avPads === "1") return true;    /* idempotent: built once */

  /* the bus pieces must exist or the pads would be dead paint */
  if (typeof avNoteDown !== "function" || typeof avNoteUp !== "function" || typeof avNoteName !== "function") return false;

  /* ---- the pinned page-1 map (midi -> kit id) and labels ---- */
  const PIN = { 36: "kick", 37: "rim", 38: "snare", 39: "clap", 42: "ch", 45: "lt", 46: "oh", 47: "mt", 49: "crash", 50: "ht", 51: "ride" };
  const LABELS = { kick: "KICK", snare: "SNARE", rim: "RIM", clap: "CLAP", ch: "CH", oh: "OH", lt: "LT", mt: "MT", ht: "HT", crash: "CRASH", ride: "RIDE" };
  /* MPC row law: bottom row = midi 36..39, rows ascend upward */
  const ROWS = [
    [48, 49, 50, 51],
    [44, 45, 46, 47],
    [40, 41, 42, 43],
    [36, 37, 38, 39],
  ];
  const VEL_LO = 0.35;      /* pad top */
  const VEL_HI = 1.0;       /* pad bottom */
  const KB_VEL = 0.9;       /* keyboard activation, the bus default */
  const FLASH_MS = 140;
  const KB_RELEASE_MS = 350;

  const heldPtr = new Map();    /* pointerId -> note name (each press releases exactly its note) */

  /* ---- helpers (closure-local; no top-level leaks beyond avPadsInit) ---- */
  function padOf(e) {
    const t = e && e.target;
    return (t && typeof t.closest === "function") ? t.closest(".av-pad") : null;
  }
  function flash(pad) {
    if (!pad) return;
    pad.classList.add("av-pad-on");
    if (pad.__avPadT) clearTimeout(pad.__avPadT);
    pad.__avPadT = setTimeout(() => { pad.classList.remove("av-pad-on"); pad.__avPadT = null; }, FLASH_MS);
  }
  /* velocity from the pointer's vertical position: top = soft, bottom = full */
  function velFromEvent(e, pad) {
    const r = pad.getBoundingClientRect();
    const h = r.height || 1;
    let rel = (e.clientY - r.top) / h;
    rel = rel < 0 ? 0 : (rel > 1 ? 1 : rel);
    return VEL_LO + (VEL_HI - VEL_LO) * rel;
  }
  function releasePtr(e) {
    const name = heldPtr.get(e.pointerId);
    if (name === undefined) return;
    heldPtr.delete(e.pointerId);
    avNoteUp(name);
  }
  function flushHeld() {
    for (const name of heldPtr.values()) avNoteUp(name);
    heldPtr.clear();
  }

  /* ---- build the grid ---- */
  try {
    let html = "";
    for (const row of ROWS) {
      for (const midi of row) {
        const kit = PIN[midi] || "";
        const note = avNoteName(midi).toUpperCase();
        if (kit) {
          html += '<button class="av-pad" type="button" data-midi="' + midi + '" data-kit="' + kit +
            '" aria-label="' + LABELS[kit] + " — " + note + '"><span class="av-pad-label">' + LABELS[kit] +
            '</span><span class="av-pad-note">' + note + "</span></button>";
        } else {
          html += '<button class="av-pad av-pad-off" type="button" data-midi="' + midi +
            '" disabled aria-label="Unused — ' + note + '"><span class="av-pad-label">—</span><span class="av-pad-note">' + note + "</span></button>";
        }
      }
    }
    host.innerHTML = '<div class="av-pads">' + html + "</div>";
    host.dataset.avPads = "1";
  } catch (e) {
    console.warn("[anvil] pads mount failed", e);
    return false;
  }

  /* ---- interactions (delegated on the host; pads are plain buttons) ---- */
  host.addEventListener("pointerdown", (e) => {
    const pad = padOf(e);
    if (!pad || pad.disabled || pad.classList.contains("av-pad-off")) return;
    e.preventDefault();
    const midi = parseInt(pad.dataset.midi, 10);
    const name = avNoteName(midi);
    heldPtr.set(e.pointerId, name);
    try { pad.setPointerCapture(e.pointerId); } catch (err) { /* capture unavailable — window blur still flushes */ }
    flash(pad);
    avNoteDown(name, velFromEvent(e, pad));
  });
  host.addEventListener("pointerup", releasePtr);
  host.addEventListener("pointercancel", releasePtr);
  host.addEventListener("contextmenu", (e) => e.preventDefault());
  /* keyboard activation (Enter/Space on a focused pad): detail 0 means it was NOT a pointer click */
  host.addEventListener("click", (e) => {
    if (e.detail > 0) return;
    const pad = padOf(e);
    if (!pad || pad.disabled) return;
    const name = avNoteName(parseInt(pad.dataset.midi, 10));
    flash(pad);
    avNoteDown(name, KB_VEL);
    setTimeout(() => avNoteUp(name), KB_RELEASE_MS);
  });
  /* a lost window must never leave a pad note droning (the av_kb flush law) */
  window.addEventListener("blur", flushHeld);

  /* ---- verify surface (namespace: window.__avPads / window.__avPadsFlash) ---- */
  window.__avPads = function () {
    return {
      mounted: true,
      page: 1,
      host: host.id || null,
      pads: host.querySelectorAll(".av-pad").length,
      live: host.querySelectorAll(".av-pad:not(.av-pad-off)").length,
      held: [...heldPtr.values()],
    };
  };
  window.__avPadsFlash = function (midi) {
    const m = Number(midi);
    if (!isFinite(m)) return false;
    const pad = host.querySelector('.av-pad[data-midi="' + Math.round(m) + '"]');
    if (!pad) return false;
    flash(pad);
    return true;
  };

  return true;
}
