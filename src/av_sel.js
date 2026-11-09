/* Anvil — the console select (P1b): every native <select> gets a console field + a real popover.
   The native element stays in the DOM (hidden) as the value carrier, so every module's reader,
   every rig's .value/.options contract and every programmatic dispatch('change') keeps working;
   only the RENDERING and the POPUP are replaced. The LCD's bank selects are left alone (they are
   display fields, styled as dial-glass text). */
"use strict";

const AV_SEL_SKIP = function (s) {
  try {
    if (!s || s.tagName !== "SELECT") return true;
    if (s.dataset.avSel === "1") return true;
    if (s.classList.contains("av-bank-pack") || s.classList.contains("av-bank-preset")) return true;
    if (s.closest && s.closest("#av-lcd-bezel")) return true;
    if (s.dataset.nosel === "1") return true;
    return false;
  } catch (e) { return true; }
};

const avSelState = { open: null, wrap: null, btn: null, pop: null, idx: 0 };

function avSelLabel(s) {
  try {
    const o = s.options[s.selectedIndex];
    return o ? String(o.textContent || "").trim() : "";
  } catch (e) { return ""; }
}

function avSelClose() {
  try {
    const p = avSelState.pop;
    if (p) { p.classList.remove("open"); p.innerHTML = ""; }
    if (avSelState.btn) avSelState.btn.setAttribute("aria-expanded", "false");
    avSelState.open = null; avSelState.wrap = null; avSelState.btn = null; avSelState.pop = null;
  } catch (e) { /* already closed */ }
}

function avSelPosition() {
  try {
    const b = avSelState.btn, p = avSelState.pop;
    if (!b || !p) return;
    const r = b.getBoundingClientRect();
    const w = Math.max(r.width, 168);
    let left = Math.min(Math.max(6, r.left), window.innerWidth - w - 8);
    p.style.width = w + "px";
    p.style.left = left + "px";
    p.style.top = "0px";
    const ph = p.offsetHeight || 200;
    let top = r.bottom + 4;
    if (top + ph > window.innerHeight - 6) top = Math.max(6, r.top - ph - 4);
    p.style.top = top + "px";
  } catch (e) { /* unpositioned is still usable */ }
}

function avSelOpen(s, wrap, btn, pop) {
  try {
    avSelClose();
    avSelState.open = s; avSelState.wrap = wrap; avSelState.btn = btn; avSelState.pop = pop;
    pop.innerHTML = "";
    const opts = Array.prototype.slice.call(s.options || []);
    let act = Math.max(0, s.selectedIndex);
    for (let i = 0; i < opts.length; i++) {
      const o = opts[i];
      const row = document.createElement("div");
      row.className = "av-sel-opt" + (i === s.selectedIndex ? " on" : "");
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", i === s.selectedIndex ? "true" : "false");
      row.dataset.i = String(i);
      row.textContent = String(o.textContent || "").trim() || String(o.value || "");
      row.addEventListener("pointerdown", function (e) { e.preventDefault(); e.stopPropagation(); });
      row.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        try {
          s.selectedIndex = i;
          s.value = o.value;
          s.dispatchEvent(new Event("input", { bubbles: true }));
          s.dispatchEvent(new Event("change", { bubbles: true }));
        } catch (e2) { /* the module keeps its last value */ }
        btn.textContent = avSelLabel(s);
        avSelClose();
        try { btn.focus({ preventScroll: true }); } catch (e3) { /* focus is best effort */ }
      });
      pop.appendChild(row);
    }
    pop.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    avSelPosition();
    const rows = pop.querySelectorAll(".av-sel-opt");
    if (rows[act]) rows[act].classList.add("act");
    avSelState.idx = act;
  } catch (e) { /* a select that cannot open stays readable */ }
}

function avSelMove(d) {
  try {
    const pop = avSelState.pop, s = avSelState.open;
    if (!pop || !s) return;
    const rows = Array.prototype.slice.call(pop.querySelectorAll(".av-sel-opt"));
    if (!rows.length) return;
    let i = (avSelState.idx || 0) + d;
    if (i < 0) i = 0; if (i > rows.length - 1) i = rows.length - 1;
    rows.forEach(function (r, j) { r.classList.toggle("act", j === i); });
    avSelState.idx = i;
    if (rows[i] && rows[i].scrollIntoView) rows[i].scrollIntoView({ block: "nearest" });
  } catch (e) { /* the list stays where it was */ }
}

function avSelChoose() {
  try {
    const pop = avSelState.pop;
    if (!pop) return;
    const row = pop.querySelectorAll(".av-sel-opt")[avSelState.idx || 0];
    if (row) row.click();
  } catch (e) { /* nothing to choose */ }
}

function avSelBuild(s) {
  try {
    if (AV_SEL_SKIP(s)) return false;
    s.dataset.avSel = "1";
    const wrap = document.createElement("span");
    wrap.className = "av-sel";
    s.parentNode.insertBefore(wrap, s);
    wrap.appendChild(s);
    s.classList.add("av-sel-native");
    s.setAttribute("aria-hidden", "true");
    s.tabIndex = -1;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "av-sel-key";
    btn.setAttribute("role", "combobox");
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    const lab = avSelLabel(s);
    btn.textContent = lab;
    btn.title = (s.getAttribute("aria-label") || s.getAttribute("title") || lab) + " — click to choose";
    btn.setAttribute("aria-label", btn.title);

    const pop = document.createElement("div");
    pop.className = "av-sel-pop";
    pop.setAttribute("role", "listbox");

    wrap.appendChild(btn);
    wrap.appendChild(pop);

    btn.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (avSelState.open === s) { avSelClose(); return; }
      avSelOpen(s, wrap, btn, pop);
    });
    btn.addEventListener("keydown", function (e) {
      const k = e.key;
      if (k === "ArrowDown" || k === "ArrowUp") {
        e.preventDefault();
        if (avSelState.open !== s) { avSelOpen(s, wrap, btn, pop); return; }
        avSelMove(k === "ArrowDown" ? 1 : -1);
      } else if (k === "Enter" || k === " ") {
        e.preventDefault();
        if (avSelState.open !== s) avSelOpen(s, wrap, btn, pop); else avSelChoose();
      } else if (k === "Escape") { if (avSelState.open === s) { e.preventDefault(); avSelClose(); } }
    });
    /* external writes (rigs, modules, patch loads) keep the key honest */
    s.addEventListener("change", function () { if (btn.textContent !== avSelLabel(s)) btn.textContent = avSelLabel(s); });
    return true;
  } catch (e) { return false; }
}

function avSelUpgradeAll(root) {
  let n = 0;
  try {
    const r = root && root.querySelectorAll ? root : document;
    const list = Array.prototype.slice.call(r.querySelectorAll("select"));
    for (let i = 0; i < list.length; i++) if (avSelBuild(list[i])) n++;
  } catch (e) { /* the un-upgraded select is still usable */ }
  return n;
}

function avSelInit() {
  try {
    if (avSelState.ready) return true;
    avSelState.ready = true;
    avSelUpgradeAll(document);
    document.addEventListener("pointerdown", function (e) {
      if (!avSelState.open) return;
      const w = avSelState.wrap;
      if (w && w.contains(e.target)) return;
      avSelClose();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (avSelState.open && e && e.key === "Escape") avSelClose();
    }, true);
    window.addEventListener("resize", function () { if (avSelState.open) avSelPosition(); });
    if (typeof MutationObserver === "function") {
      let t = 0;
      const mo = new MutationObserver(function () {
        if (t) return;
        t = setTimeout(function () { t = 0; avSelUpgradeAll(document); }, 120);
      });
      mo.observe(document.body, { childList: true, subtree: true });
      avSelState.mo = mo;
    }
    return true;
  } catch (e) { return false; }
}

if (typeof window !== "undefined" && window) {
  try {
    window.__avSel = {
      init: avSelInit,
      upgradeAll: avSelUpgradeAll,
      count: function () { return document.querySelectorAll("select[data-av-sel='1']").length; },
      native: function () { return document.querySelectorAll("select:not([data-av-sel='1'])").length; },
      close: avSelClose,
    };
  } catch (e) { /* no window */ }
}

/* self-init: the script sits at the end of <body>, so the first pass runs on parse and the
   observer catches every module that mounts later (cards build their selects from templates). */
if (typeof document !== "undefined" && document) {
  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { avSelInit(); });
    else avSelInit();
  } catch (e) { /* the native selects remain usable */ }
}
