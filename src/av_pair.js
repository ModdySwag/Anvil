/* Anvil — av_pair.js: the C4 two-choice control (docs/13 §5, `.av-pair` silver key pair, role=radio).

   WHY IT EXISTS: the chassis language says a two-choice decision is a PAIR of keys, not a
   two-option <select> (which opens a menu to choose between two things — two clicks for one bit).
   C4's audit found exactly two fixed two-option selects in the app (`#av-deliver-bits`, 16/24, and
   `#av-code-kind`, fx/kind) and this module is the replacement for both.

   THE CONTRACT THAT MATTERS: both cards already read/write their control by ID and `.value`
   (`avDeliverUiSnapshot` → `document.getElementById('av-deliver-bits').value`;
   `avCodeUiInput/avCodeUiSetInput(host, '#av-code-kind')`). So the pair carries a HIDDEN INPUT with
   that same id and value: every existing reader keeps working unchanged, and a click writes the
   value then dispatches a bubbling `change` on that input, which is exactly what the cards' delegated
   change handlers already listen for.

   MARKUP
     <span class="av-pair" role="radiogroup" aria-label="…">
       <button type="button" class="av-pair-key" role="radio" aria-checked="false" data-pair-value="16">16</button>
       <button type="button" class="av-pair-key" role="radio" aria-checked="true"  data-pair-value="24">24</button>
       <input type="hidden" id="…" value="24">
     </span>

   LAWS: one delegated listener (document), installed once; a pair never throws; no DOM at load; every
   sibling reference guarded; the hidden input is the single source of truth, so a card that writes
   `.value` directly only needs to call avPairSync() to move the keys. */

"use strict";

const AV_PAIR_VERSION = "c4.0";

function avPairEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* opts: { id, label, value, choices: [[value, text], [value, text]] } — two choices, exactly. */
function avPairHTML(opts) {
  const o = (opts && typeof opts === "object") ? opts : {};
  const id = String(o.id || "");
  const label = String(o.label || "");
  const choices = Array.isArray(o.choices) ? o.choices.slice(0, 2) : [];
  if (!id || choices.length !== 2) return "";
  let current = (o.value == null) ? String(choices[0][0]) : String(o.value);
  let found = false;
  for (let i = 0; i < choices.length; i++) if (String(choices[i][0]) === current) found = true;
  if (!found) current = String(choices[0][0]);
  let keys = "";
  for (let i = 0; i < choices.length; i++) {
    const v = String(choices[i][0]), t = String(choices[i][1]);
    const on = (v === current);
    keys += '<button type="button" class="av-pair-key' + (on ? " on" : "") + '" role="radio" aria-checked="' +
      (on ? "true" : "false") + '" tabindex="' + (on ? "0" : "-1") + '" data-pair-value="' + avPairEsc(v) + '">' +
      avPairEsc(t) + "</button>";
  }
  return '<span class="av-pair" role="radiogroup"' + (label ? ' aria-label="' + avPairEsc(label) + '"' : "") + ' data-av-pair="1">' +
    keys + '<input type="hidden" id="' + avPairEsc(id) + '" value="' + avPairEsc(current) + '"></span>';
}

/* paint ONE pair from its hidden input */
function avPairPaint(pair) {
  try {
    if (!pair || typeof pair.querySelector !== "function") return false;
    const input = pair.querySelector("input[type=hidden]");
    if (!input) return false;
    const val = String(input.value == null ? "" : input.value);
    const keys = pair.querySelectorAll(".av-pair-key");
    for (let k = 0; k < keys.length; k++) {
      const on = String(keys[k].getAttribute("data-pair-value")) === val;
      keys[k].classList.toggle("on", on);
      keys[k].setAttribute("aria-checked", on ? "true" : "false");
      keys[k].setAttribute("tabindex", on ? "0" : "-1");
    }
    return true;
  } catch (e) { return false; }
}

/* read the hidden input, move the keys. root defaults to the document; a root that IS a pair is
   handled directly (querySelectorAll only searches descendants, so a pair cannot find itself). */
function avPairSync(rootArg) {
  try {
    const root = rootArg || ((typeof document !== "undefined") ? document : null);
    if (!root || typeof root.querySelectorAll !== "function") return false;
    if (typeof root.matches === "function" && root.matches(".av-pair[data-av-pair=\"1\"]")) return avPairPaint(root);
    const pairs = root.querySelectorAll(".av-pair[data-av-pair=\"1\"]");
    for (let i = 0; i < pairs.length; i++) avPairPaint(pairs[i]);
    return true;
  } catch (e) { return false; }
}

/* the one writer: set the hidden value, sync the keys, dispatch a bubbling change on the input */
function avPairSet(pair, value, opts) {
  try {
    if (!pair || typeof pair.querySelector !== "function") return false;
    const input = pair.querySelector("input[type=hidden]");
    if (!input) return false;
    const val = String(value == null ? "" : value);
    let ok = false;
    const keys = pair.querySelectorAll(".av-pair-key");
    for (let k = 0; k < keys.length; k++) if (String(keys[k].getAttribute("data-pair-value")) === val) ok = true;
    if (!ok) return false;
    if (String(input.value) === val && !(opts && opts.force === true)) { avPairSync(pair); return true; }
    input.value = val;
    avPairSync(pair);
    const fire = !(opts && opts.silent === true) && (typeof input.dispatchEvent === "function") && (typeof Event === "function");
    if (fire) {
      try { input.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) { /* no event ctor */ }
    }
    return true;
  } catch (e) { return false; }
}

function avPairClick(e) {
  try {
    const t = e && e.target;
    const key = (t && typeof t.closest === "function") ? t.closest(".av-pair-key") : null;
    if (!key) return;
    const pair = key.closest(".av-pair[data-av-pair=\"1\"]");
    if (!pair) return;
    avPairSet(pair, key.getAttribute("data-pair-value"), { force: true });
  } catch (e2) { /* a listener never throws outward */ }
}

function avPairKeydown(e) {
  try {
    const key = e && e.target && typeof e.target.closest === "function" ? e.target.closest(".av-pair-key") : null;
    if (!key) return;
    const pair = key.closest(".av-pair[data-av-pair=\"1\"]");
    if (!pair) return;
    const keys = [...pair.querySelectorAll(".av-pair-key")];
    const i = keys.indexOf(key);
    if (i < 0) return;
    const k = e.key;
    let next = -1;
    if (k === "ArrowRight" || k === "ArrowDown") next = (i + 1) % keys.length;
    else if (k === "ArrowLeft" || k === "ArrowUp") next = (i - 1 + keys.length) % keys.length;
    else if (k === " " || k === "Enter") next = i;
    if (next < 0) return;
    e.preventDefault();
    avPairSet(pair, keys[next].getAttribute("data-pair-value"), { force: true });
    try { keys[next].focus(); } catch (e2) { /* focus is best-effort */ }
  } catch (e3) { /* a listener never throws outward */ }
}

function avPairBind() {
  try {
    if (typeof document === "undefined" || !document || typeof document.addEventListener !== "function") return false;
    if (document.__avPairBound === true) return true;
    document.__avPairBound = true;
    document.addEventListener("click", avPairClick);
    document.addEventListener("keydown", avPairKeydown);
    return true;
  } catch (e) { return false; }
}

function avPairClasses() {
  return ["av-pair", "av-pair-key", "on"];
}

if (typeof window !== "undefined") {
  try {
    window.__avPair = { version: AV_PAIR_VERSION, html: avPairHTML, sync: avPairSync, set: avPairSet, bind: avPairBind, classes: avPairClasses };
  } catch (e) { /* guarded */ }
}

try { avPairBind(); } catch (e) { /* no document */ }
