/* Anvil — rotary controls (ported from Pattern Forge's app_knob.js "Hardware Forge" feel engine;
   T9 §12 reuse map). Theme-appropriate turnable knobs: drag up/down or twist the rim to change a
   value, wheel to nudge, double-click to reset, arrow keys when focused, Shift for fine control.
   Everything here is DOM-free at top level; avKnobBind() is only ever called from the browser
   with a real root element.

   Port decisions (recorded in CONTINUATION-2026-10-06.md):
   - av-namespaced: avKnobHTML/Bind/Commit/RefreshAll/NormToVal/ValToNorm/Format/ApplyVisual/
     RowHTML (+ local avKnobEsc / avKnobCssEscape helpers).
   - commit hook: avApplyParam(path, v, meta) when the app defines it, else the avParams map +
     a bubbling 'av-param' CustomEvent on window.
   - dropped from the PF original: hub additions, snapshot(), koalaHint() calls, the marantz
     skin variant. */
"use strict";

/* ---------- value mapping (pure) ---------- */

/* linear | log | exp curves between min and max */
const avKnobNormToVal = (norm, min, max, curve, step) => {
  let n = Math.max(0, Math.min(1, Number(norm) || 0));
  let v;
  if (curve === "log") {
    const lo = Math.max(1e-6, min), hi = Math.max(lo * 1.000001, max);
    v = lo * Math.pow(hi / lo, n);
  } else if (curve === "exp") {
    v = min + (max - min) * Math.pow(n, 2);
  } else {
    v = min + (max - min) * n;
  }
  const st = Number(step) || 0;
  if (st > 0) {
    /* snap to the nearest step measured from min (log curves keep their own resolution) */
    if (curve === "log") {
      const steps = Math.max(1, Math.round((max - min) / st));
      const idx = Math.round(((v - min) / (max - min)) * steps);
      v = min + (max - min) * (idx / steps);
    } else {
      v = min + Math.round((v - min) / st) * st;
    }
    const dec = String(st).includes(".") ? String(st).split(".")[1].length : 0;
    v = Number(v.toFixed(Math.max(0, Math.min(6, dec))));
  }
  return Math.max(min, Math.min(max, v));
};

const avKnobValToNorm = (val, min, max, curve) => {
  const v = Math.max(min, Math.min(max, Number(val)));
  let n;
  if (curve === "log") {
    const lo = Math.max(1e-6, min), hi = Math.max(lo * 1.000001, max);
    n = Math.log(Math.max(lo, v) / lo) / Math.log(hi / lo);
  } else if (curve === "exp") {
    n = Math.sqrt(Math.max(0, (v - min) / Math.max(1e-9, max - min)));
  } else {
    n = (v - min) / Math.max(1e-9, max - min);
  }
  return Math.max(0, Math.min(1, isFinite(n) ? n : 0));
};

/* readable value text for the little display under every knob */
function avKnobFormat(val, opts = {}) {
  const unit = opts.unit || "";
  const v = Number(val);
  if (!isFinite(v)) return "—";
  switch (opts.fmt) {
    case "hz": return v >= 1000 ? (Math.round(v / 10) / 100) + "k" : Math.round(v) + "";
    case "ms": return v >= 1 ? (Math.round(v * 100) / 100) + "s" : Math.round(v * 1000) + "ms";
    case "db": return (v > 0 ? "+" : "") + (Math.round(v * 10) / 10) + "dB";
    case "pct": return Math.round(v * 100) + "%";
    case "pan": return Math.abs(v) < 0.005 ? "C" : (v < 0 ? "L" : "R") + Math.round(Math.abs(v) * 100);
    case "ct": return (Math.round(v * 10) / 10) + "ct";
    case "x": return (Math.round(v * 100) / 100) + "×";
    case "int": return String(Math.round(v));
    default: {
      const s = Math.round(v * 1000) / 1000;
      return unit ? s + unit : String(s);
    }
  }
}

/* ---------- markup (pure string builders) ---------- */

/* local escaper: av_knob.js is treated as standalone by the build's parser guard, so it cannot
   lean on any core helper (same rules as the app_core copy) */
const avKnobEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* avKnobHTML — one rotary control bound to a parameter path.
   opts: { min, max, step, def, value, curve, unit, fmt, size, w, hint, sens } */
function avKnobHTML(path, label, opts = {}) {
  /* NUMBERS ONLY at the boundary. These fields may be fed from live state or a stored patch, so
     a string here is a markup injection waiting to happen, not a value (PF audit F1). Coerce
     first, then escape as a second belt. */
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };
  const min = opts.min != null ? num(opts.min, 0) : 0;
  const max = opts.max != null ? num(opts.max, 1) : 1;
  const step = opts.step != null ? num(opts.step, 0.01) : 0.01;
  const val = num(opts.value != null ? opts.value : (opts.def != null ? opts.def : min), min);
  const defv = num(opts.def != null ? opts.def : min, min);
  const norm = avKnobValToNorm(val, min, max, opts.curve);
  const size = opts.size || "md";
  const w = opts.w || (size === "lg" ? 62 : size === "sm" ? 44 : 54);
  const txt = avKnobFormat(val, opts);
  const tip = (label ? label + " — " : "") + txt + (opts.hint ? " · " + opts.hint : "") +
    " (drag up/down or twist around the rim · wheel · double-click resets)";
  return '<div class="av-knob-wrap k-' + size + '" style="width:' + w + 'px">' +
    '<div class="av-knob" tabindex="0" role="slider" data-knob="' + avKnobEsc(path) + '"' +
    ' data-min="' + avKnobEsc(min) + '" data-max="' + avKnobEsc(max) + '" data-step="' + avKnobEsc(step) + '"' +
    (opts.curve ? ' data-curve="' + avKnobEsc(opts.curve) + '"' : '') +
    ' data-def="' + avKnobEsc(defv) + '"' +
    ' data-unit="' + avKnobEsc(opts.unit || "") + '" data-fmt="' + avKnobEsc(opts.fmt || "") + '"' +
    ' data-sens="' + avKnobEsc(opts.sens != null ? opts.sens : 150) + '"' +
    ' data-norm="' + norm.toFixed(4) + '"' +
    ' aria-valuemin="' + avKnobEsc(min) + '" aria-valuemax="' + avKnobEsc(max) + '" aria-valuenow="' + avKnobEsc(val) + '"' +
    ' aria-label="' + avKnobEsc(label || path) + '" title="' + avKnobEsc(tip) + '">' +
    '<div class="av-knob-ring"></div>' +
    '<div class="av-knob-mod"></div>' +
    '<div class="av-knob-face"><span class="av-knob-mark"></span></div>' +
    '</div>' +
    '<div class="av-knob-lbl">' + avKnobEsc(label || "") + '</div>' +
    '<div class="av-knob-val" data-kval="' + avKnobEsc(path) + '">' + avKnobEsc(txt) + '</div>' +
    '</div>';
}

/* knob cluster: several knobs in a plate, e.g. an ADSR row */
const avKnobRowHTML = (items, cls) => '<div class="av-knobs ' + (cls || "") + '">' + items.join("") + '</div>';

/* label/value refresh for every knob bound to a path (keeps all readouts in sync) */
function avKnobApplyVisual(el, value) {
  if (!el) return;
  const min = parseFloat(el.dataset.min), max = parseFloat(el.dataset.max);
  const curve = el.dataset.curve || "lin";
  const norm = avKnobValToNorm(value, min, max, curve);
  el.dataset.norm = norm.toFixed(4);
  el.setAttribute("aria-valuenow", String(value));
  const mark = el.querySelector(".av-knob-mark");
  if (mark) mark.style.transform = "rotate(" + (-135 + norm * 270).toFixed(1) + "deg)";
  const ring = el.querySelector(".av-knob-ring");
  if (ring) ring.style.setProperty("--knob-arc", (norm * 270).toFixed(1) + "deg");
  const step = parseFloat(el.dataset.step) || 0;
  el.classList.toggle("at-min", value <= min + step / 2);
  el.classList.toggle("at-max", value >= max - step / 2);
}

const avKnobCssEscape = (s) => (typeof CSS !== "undefined" && CSS.escape)
  ? CSS.escape(String(s))
  : String(s).replace(/[^a-zA-Z0-9_-]/g, ch => "\\" + ch);

/* ---------- browser wiring ---------- */

/* the knob framework's own path→value mirror — first paint and refresh read this; the app-side
   avApplyParam() (and, without one, the 'av-param' event) carries the value to the engine */
const avParams = {};

/* commit a knob value: writes the model mirror, updates UI, tells the engine */
function avKnobCommit(el, value, opts = {}) {
  const path = el.dataset.knob;
  const min = parseFloat(el.dataset.min), max = parseFloat(el.dataset.max);
  const step = parseFloat(el.dataset.step) || 0;
  const curve = el.dataset.curve || "lin";
  /* value may arrive as a raw value (click/wheel/keys) or as a normalised position (drag) */
  const v = opts.norm
    ? avKnobNormToVal(value, min, max, curve, step)
    : avKnobNormToVal(avKnobValToNorm(value, min, max, curve), min, max, curve, step);
  const fmtOpts = { fmt: el.dataset.fmt || "", unit: el.dataset.unit || "" };
  const txt = avKnobFormat(v, fmtOpts);
  avParams[path] = v;
  if (typeof avApplyParam === "function") {
    try { avApplyParam(path, v, { from: "knob", el, txt }); }
    catch (e) { console.warn("[anvil] avApplyParam(" + path + ") failed", e); }
  } else {
    try { window.dispatchEvent(new CustomEvent("av-param", { detail: { path, value: v, txt, el, from: "knob" } })); }
    catch (e) { /* no fan-out */ }
  }
  document.querySelectorAll('[data-kval="' + avKnobCssEscape(path) + '"]').forEach(n => { n.textContent = txt; });
  avKnobApplyVisual(el, v);
  return v;
}

function avKnobBind(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll(".av-knob[data-knob]").forEach(el => {
    if (el.dataset.knobBound === "1") return;
    el.dataset.knobBound = "1";
    const min = parseFloat(el.dataset.min), max = parseFloat(el.dataset.max);
    const curve = el.dataset.curve || "lin";
    /* visual sync on first paint */
    const liveVal = avParams[el.dataset.knob];
    avKnobApplyVisual(el, typeof liveVal === "number" ? liveVal : avKnobNormToVal(parseFloat(el.dataset.norm), min, max, curve, 0));

    /* ---- the feel of the knob ----------------------------------------------------------------
       Two gestures, both natural to a hand on a real knob: slide up/down, or twist around the
       rim. Whichever the hand commits to first (a few px) wins the drag, so neither fights the
       other. The travel curve makes the first millimetres fine and the later ones fast, exactly
       like sliding a finger along a fader, and the value follows the pointer through a damped
       filter — a heavy, viscous weight: it lags slightly, then settles dead on release, never
       snapping to a pixel and never spinning past the stop. */
    let drag = null;
    let dragGen = 0;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.focus({ preventScroll: true });
      dragGen += 1;
      el._gen = dragGen;            /* cancels a settle still running from the previous drag */
      const r = el.getBoundingClientRect();
      const n0 = parseFloat(el.dataset.norm) || 0;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      drag = {
        y: e.clientY, cx, cy, rad: Math.max(10, r.width / 2),
        startR: Math.hypot(e.clientX - cx, e.clientY - cy),   /* a twist needs a hand on the rim */
        disp: n0, target: n0, lin: 0, rot: 0, travel: 0, mode: null,
        ang: Math.atan2(e.clientY - cy, e.clientX - cx),
        last: performance.now(), gen: dragGen, raf: 0,
      };
      el.classList.add("dragging");
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* capture unsupported */ }
      el.style.cursor = "ns-resize";
      document.body.classList.add("knob-dragging");
    });
    el.addEventListener("pointermove", (e) => {
      if (!drag) return;
      e.preventDefault();
      const now = performance.now();
      /* a hand never moves the value in one instant — but a burst of events inside 8 ms (a 120 Hz
         mouse, a coalesced frame, a synthetic test) must still advance it, or tiny moves stick */
      const dt = Math.max(8, Math.min(90, now - drag.last));
      drag.last = now;
      const sens = (parseFloat(el.dataset.sens) || 150) * (e.shiftKey ? 4 : 1);
      /* slide: up is more. twist: clockwise is more. */
      const dy = drag.y - e.clientY;                       /* + = up */
      drag.y = e.clientY;
      const ang = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
      let dAng = ang - drag.ang;
      while (dAng > Math.PI) dAng -= 2 * Math.PI;
      while (dAng < -Math.PI) dAng += 2 * Math.PI;
      drag.ang = ang;
      const arc = dAng * drag.rad;                         /* + = clockwise, in pixels travelled */
      drag.lin += dy;
      drag.rot += arc;
      drag.travel += Math.abs(dy) + Math.abs(arc) * 0.6;
      if (!drag.mode) {
        /* the first few pixels decide the gesture — a slide needs 6 px, a twist 9 px of arc.
           A hand that landed on the cap (not the rim) can never twist: at the dead centre the
           angle is undefined, and reading it there turned a straight slide into a phantom spin. */
        const rim = drag.startR > drag.rad * 0.35;
        if (Math.abs(drag.lin) > 6 && (Math.abs(drag.lin) >= Math.abs(drag.rot) || !rim)) drag.mode = "lin";
        else if (rim && Math.abs(drag.rot) > 9) drag.mode = "rot";
        else return;
      }
      /* a twist is read in degrees of the knob's own rim; clamp one frame's worth so crossing
         the centre can never inject a jump */
      const px = drag.mode === "rot" ? Math.max(-0.6, Math.min(0.6, dAng)) * drag.rad : dy;
      /* the curve: 0.40x at the start of the travel, easing to 2.0x once the hand has moved 260 px */
      const t = Math.min(1, drag.travel / 260);
      const rate = 0.40 + 1.60 * (t * t * (3 - 2 * t));
      drag.target = Math.max(0, Math.min(1, drag.target + (px * rate) / sens));
      /* the weight: the model (and so the sound) glides to the new target instead of jumping */
      drag.disp += (drag.target - drag.disp) * (1 - Math.exp(-dt / 60));
      if (Math.abs(drag.disp - drag.target) < 0.0004) drag.disp = drag.target;
      /* R9 fluidity: the model advances per event, but the DOM/engine write is coalesced to ONE
         commit per animation frame — a 120 Hz mouse or a busy frame can't stack writes. */
      if (!drag.raf) {
        drag.raf = requestAnimationFrame(() => {
          if (!drag) return;
          drag.raf = 0;
          avKnobCommit(el, drag.disp, { norm: true });
          if (drag.target <= 0.0001 || drag.target >= 0.9999) {   /* the mechanical stop */
            el.classList.remove("at-stop");
            void el.offsetWidth;
            el.classList.add("at-stop");
          }
        });
      }
    });
    const endDrag = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.raf) { try { cancelAnimationFrame(d.raf); } catch (err) { /* done */ } }
      el.classList.remove("dragging");
      el.style.cursor = "";
      document.body.classList.remove("knob-dragging");
      try { el.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      /* R9: flush the last frame's value at release so a release between frames never loses it */
      avKnobCommit(el, d.disp, { norm: true });
      if (d.travel > 2) {
        el._supClick = true;                    /* a drag is not also a step-click */
        setTimeout(() => { el._supClick = false; }, 80);
      }
      /* settle: whatever the damping still owes arrives with the same weight — eased, no snap */
      const rest = d.target - d.disp;
      if (Math.abs(rest) > 0.0008) {
        const gen = d.gen;
        const t0 = performance.now();
        const settle = () => {
          if (el._gen !== gen) return;          /* a new drag took over */
          const t = Math.min(1, (performance.now() - t0) / 140);
          avKnobCommit(el, d.disp + rest * (1 - Math.pow(1 - t, 3)), { norm: true });
          if (t < 1) requestAnimationFrame(settle);
        };
        el._gen = gen;
        requestAnimationFrame(settle);
      }
    };
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
    /* click without a drag = one step up (shift: one step down, alt: a 5% jump) */
    el.addEventListener("click", (e) => {
      if (drag || el._supClick) return;
      const step = parseFloat(el.dataset.step) || 0.01;
      const cur = avKnobNormToVal(parseFloat(el.dataset.norm), min, max, curve, step);
      const span = max - min;
      const bigStep = Math.max(step, Math.round((span * 0.05) / Math.max(step, 1e-9)) * step);
      const d = e.altKey ? bigStep : step;
      avKnobCommit(el, e.shiftKey ? cur - d : cur + d);
    });
    el.addEventListener("dblclick", (e) => {
      e.preventDefault();
      const def = parseFloat(el.dataset.def);
      avKnobCommit(el, isFinite(def) ? def : min);
    });
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      const step = parseFloat(el.dataset.step) || 0.01;
      const cur = avKnobNormToVal(parseFloat(el.dataset.norm), min, max, curve, step);
      const dir = e.deltaY < 0 ? 1 : -1;
      avKnobCommit(el, cur + dir * (e.shiftKey ? step / 4 : step));
    }, { passive: false });
    /* avKnobKey - P7 keyboard + aria surface (verify/_p7_wave.md 2.2): arrow steps (Shift x10),
       Home/End; step = numeric data-step else 1% of the range; commits ride avKnobCommit, the funnel. */
    el.addEventListener("keydown", (e) => {
      const rawStep = parseFloat(el.dataset.step);
      const step = isFinite(rawStep) && rawStep > 0 ? rawStep : (max - min) / 100;
      const cur = avKnobNormToVal(parseFloat(el.dataset.norm), min, max, curve, step);
      const big = e.shiftKey ? 10 : 1;
      let d = 0;
      if (e.key === "ArrowUp" || e.key === "ArrowRight") d = step * big;
      else if (e.key === "ArrowDown" || e.key === "ArrowLeft") d = -step * big;
      else if (e.key === "Home") { e.preventDefault(); avKnobCommit(el, min); return; }
      else if (e.key === "End") { e.preventDefault(); avKnobCommit(el, max); return; }
      else return;
      e.preventDefault();
      avKnobCommit(el, cur + d);
    });
  });
}

/* refresh every knob on screen from the model (after project load / undo) */
function avKnobRefreshAll(root) {
  const scope = root || document;
  scope.querySelectorAll(".av-knob[data-knob]").forEach(el => {
    const v = avParams[el.dataset.knob];
    if (typeof v === "number") {
      avKnobApplyVisual(el, v);
      const txt = avKnobFormat(v, { fmt: el.dataset.fmt || "", unit: el.dataset.unit || "" });
      document.querySelectorAll('[data-kval="' + avKnobCssEscape(el.dataset.knob) + '"]').forEach(n => { n.textContent = txt; });
    }
  });
}
