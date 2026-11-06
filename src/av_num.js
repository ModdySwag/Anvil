/* Anvil — av_num.js: the C4 number control (docs/13 §5, `.av-num`: value field, down-stepper left,
   up-stepper right).

   WHY IT EXISTS: C4's audit found exactly two bare `input[type=number]` controls in the app
   (`#av-comp-fade`, 0..500 ms step 0.5, and `#av-studio-offset`, -200..200 ms step 1). Both are
   values a person nudges one step at a time, which is what a spinner is for; neither had one.

   THE CONTRACT THAT MATTERS: unlike the pair, the number control does NOT replace the input — the
   input stays an input with its id, class, min/max/step and events. The two keys sit beside it and
   do exactly what typing does: set `.value` inside min/max, then dispatch a bubbling `input` and
   `change`. So every existing reader and every rig that types into these ids keeps working, and a
   stepper click is indistinguishable from a keystroke to the cards.

   MARKUP
     <span class="av-num" data-av-num="1">
       <button type="button" class="av-num-step av-num-down" data-num-step="-1" aria-label="Decrease …">−</button>
       <input type="number" id="…" …>
       <button type="button" class="av-num-step av-num-up" data-num-step="1" aria-label="Increase …">+</button>
     </span>

   LAWS: one delegated listener; never throws; a disabled/absent input is a no-op; decimals step
   exactly (the step's own decimal places decide the rounding, so 0.5 never drifts). */

"use strict";

const AV_NUM_VERSION = "c4.0";

function avNumEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function avNumDecimals(n) {
  const s = String(n);
  const i = s.indexOf(".");
  return i < 0 ? 0 : Math.min(6, s.length - i - 1);
}

/* opts: { id, className, label, min, max, step, value, inputmode, unit } */
function avNumHTML(opts) {
  const o = (opts && typeof opts === "object") ? opts : {};
  const id = String(o.id || "");
  if (!id) return "";
  const label = String(o.label || id);
  const cls = "av-num-in" + (o.className ? " " + String(o.className) : "");
  const min = (o.min == null) ? "" : ' min="' + avNumEsc(o.min) + '"';
  const max = (o.max == null) ? "" : ' max="' + avNumEsc(o.max) + '"';
  const step = (o.step == null) ? ' step="1"' : ' step="' + avNumEsc(o.step) + '"';
  const val = (o.value == null) ? ' value="0"' : ' value="' + avNumEsc(o.value) + '"';
  const mode = o.inputmode ? ' inputmode="' + avNumEsc(o.inputmode) + '"' : "";
  const unit = o.unit ? '<span class="av-num-unit">' + avNumEsc(o.unit) + "</span>" : "";
  return '<span class="av-num" data-av-num="1">' +
    '<button type="button" class="av-num-step av-num-down" data-num-step="-1" aria-label="Decrease ' + avNumEsc(label) + '">\u2212</button>' +
    '<input type="number" class="' + cls + '" id="' + avNumEsc(id) + '"' + min + max + step + val + mode +
    ' aria-label="' + avNumEsc(label) + '">' +
    '<button type="button" class="av-num-step av-num-up" data-num-step="1" aria-label="Increase ' + avNumEsc(label) + '">+</button>' +
    unit + "</span>";
}

/* one step on one input: clamp, round to the step's decimals, fire input + change */
function avNumStep(input, dir) {
  try {
    if (!input || typeof input.value === "undefined") return false;
    if (input.disabled === true) return false;
    const stepN = Math.abs(Number(input.getAttribute("step")));
    const step = (isFinite(stepN) && stepN > 0) ? stepN : 1;
    const minN = Number(input.getAttribute("min"));
    const maxN = Number(input.getAttribute("max"));
    const hasMin = input.getAttribute("min") !== null && isFinite(minN);
    const hasMax = input.getAttribute("max") !== null && isFinite(maxN);
    const curN = Number(input.value);
    const cur = isFinite(curN) ? curN : (hasMin ? minN : 0);
    let next = cur + step * (dir < 0 ? -1 : 1);
    const dp = avNumDecimals(step);
    next = Number(next.toFixed(dp));
    if (hasMin && next < minN) next = minN;
    if (hasMax && next > maxN) next = maxN;
    if (next === cur) return true;                        /* already at the end: no event, no noise */
    input.value = String(next);
    const fire = (typeof Event === "function") && (typeof input.dispatchEvent === "function");
    if (fire) {
      try { input.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) { /* no ctor */ }
      try { input.dispatchEvent(new Event("change", { bubbles: true })); } catch (e2) { }
    }
    return true;
  } catch (e) { return false; }
}

function avNumClick(e) {
  try {
    const t = e && e.target;
    const btn = (t && typeof t.closest === "function") ? t.closest(".av-num-step") : null;
    if (!btn) return;
    const wrap = btn.closest(".av-num[data-av-num=\"1\"]");
    if (!wrap) return;
    const input = wrap.querySelector("input[type=number]");
    if (!input) return;
    avNumStep(input, Number(btn.getAttribute("data-num-step")) < 0 ? -1 : 1);
  } catch (e2) { /* a listener never throws outward */ }
}

function avNumBind() {
  try {
    if (typeof document === "undefined" || !document || typeof document.addEventListener !== "function") return false;
    if (document.__avNumBound === true) return true;
    document.__avNumBound = true;
    document.addEventListener("click", avNumClick);
    return true;
  } catch (e) { return false; }
}

function avNumClasses() {
  return ["av-num", "av-num-in", "av-num-step", "av-num-down", "av-num-up", "av-num-unit"];
}

if (typeof window !== "undefined") {
  try { window.__avNum = { version: AV_NUM_VERSION, html: avNumHTML, step: avNumStep, bind: avNumBind, classes: avNumClasses }; } catch (e) { /* guarded */ }
}

try { avNumBind(); } catch (e) { /* no document */ }
