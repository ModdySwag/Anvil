/* av_sample.js — the Anvil sample core (P2, child D): import → decode → registry → waveform → preview.

   THE SHAPE (verify/_p2_wave.md §4, the pin this module is built against):
   - avSampleStore — the buffer manager + registry. File/ArrayBuffer → ctx.decodeAudioData (main
     thread, honest) → entry {id, name, duration, sampleRate, channels, peaks, buffer}. RAM-honest:
     at most avSampleStore.max (32) imports this session; NO persistence in P2 (IndexedDB is a later
     wave).
   - avSampleDrawWaveform(canvas, entry) — min/max column waveform, teal skin, HiDPI-correct: the
     backing store is the CSS box × devicePixelRatio, refitted only when it differs (OFAP law); a
     hidden / zero-size canvas is skipped untouched — width = 0 would destroy the surface.
   - drag-in — a drop zone plus a file-input fallback; the WHOLE #av-sample-host accepts drags. The
     document-level dragover/drop pair is claimed once so a stray drop can never navigate the page
     away (a dropped WAV would otherwise replace the app in the tab).
   - avSamplePreview(id) — one-shot AudioBufferSourceNode PREVIEW ONLY (the in-engine sampler voice
     stays P3), connected through avKeysFor(ctx) so it rides the master tap (KEYS bus → MASTER gain).
     When the tap part is present the preview NEVER connects to ctx.destination directly — the same
     last-resort rule av_engine follows; deletes follow it too.

   DOM contract (returns in the §8 report; the parent adds the host + boot call):
   - host:        #av-sample-host                     (parent-owned; absent → avSampleInit() = false)
   - built by init INTO the host:
       [data-av-sample-drop]      the drop zone (click / Enter / Space open the picker)
       [data-av-sample-input]     hidden <input type=file multiple accept=audio>
       [data-av-sample-list]      the row list
       [data-av-sample-row="id"]  one row; [data-av-sample-canvas="id"] waveform canvas;
       [data-av-sample-preview="id"] ▶ one-shot preview; [data-av-sample-remove="id"] ✕ remove
       [data-av-sample-empty]     the empty-state line
   - state class: "dragover" on the host while a file drag is over it.
   - handle: window.__avSample = avSampleStore (snap() is JSON-safe: no buffers, no nodes).

   Laws kept: DOM-free top level (parse-safe); every DOM / audio call guarded (no throw paths);
   ONE avSample* family of top-level names; no persistence; no randomness anywhere. Preview ctx
   preference: the live engine context first (one context, one tap chain), else one lazily created
   fallback context of our own. */
"use strict";

/* ================================ the store ================================ */

const avSampleStore = {
  version: "p2.0",
  max: 32,                 /* RAM-honest ceiling for one session (P2); a 33rd import is refused */
  entries: [],             /* live entries in import order */
  byId: {},                /* id → entry */
  seq: 0,                  /* id counter ("s1", "s2", …) */
  pending: 0,              /* imports in flight (the cap counts these too, so parallel batches honor it) */
  ctx: null,               /* the lazily created fallback preview/decode context */
  hostEl: null,
  inited: false,
  active: null,            /* the ONE live preview AudioBufferSourceNode */
  activeId: null,          /* the session-entry preview's id (the lib preview path leaves it null) */
  activeLib: null,         /* R22: the active library preview label ("lib:<item id>") or null */
  previewSeq: 0,           /* R22: preview generation -- a newer preview or hit supersedes in-flight decodes */
  lastPreview: { id: null, ctx: null, at: 0, lib: null },
  lastError: null,
  tealCss: null,

  /* local escaper (the build treats each part as standalone: no core helper dependency) */
  esc: (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),

  /* JSON-safe aggregate for the suites + the console */
  snap: function () {
    const st = avSampleStore;
    let bytes = 0;
    const entries = st.entries.map(function (e) {
      let peak = 0, spread = 0;
      try {
        const n = e.peaks ? e.peaks.n : 0, mn = e.peaks ? e.peaks.min : null, mx = e.peaks ? e.peaks.max : null;
        for (let i = 0; i < n; i++) {
          const a = mn[i], b = mx[i];
          const v = Math.max(a < 0 ? -a : a, b < 0 ? -b : b);
          if (v > peak) peak = v;
          if (b - a > spread) spread = b - a;
        }
      } catch (err) { /* entry mid-build */ }
      const eb = (e.buffer ? e.buffer.length * e.channels * 4 : 0);
      bytes += eb;
      return {
        id: e.id, name: e.name, duration: e.duration, sampleRate: e.sampleRate,
        channels: e.channels, frames: e.buffer ? e.buffer.length : 0, bytes: eb,
        peak: peak, spread: spread,
      };
    });
    let engReady = false;
    try { engReady = !!(typeof window !== "undefined" && window.__avEngine && window.__avEngine.ready === true); } catch (e) { engReady = false; }
    return {
      version: st.version, count: st.entries.length, max: st.max, pending: st.pending, bytes: bytes,
      inited: st.inited, host: !!st.hostEl,
      active: st.activeId,
      previewLib: st.activeLib ? String(st.activeLib) : null,   /* R22: the active library preview label */
      lastPreview: st.lastPreview && (st.lastPreview.id || st.lastPreview.lib) ? { id: st.lastPreview.id || null, at: st.lastPreview.at, lib: st.lastPreview.lib || null } : null,
      ctx: st.ctx ? st.ctx.state : null, engineReady: engReady,
      lastError: st.lastError,
      entries: entries,
    };
  },

  get: function (id) { return (id && avSampleStore.byId[id]) || null; },

  /* min/max envelope of the DECODED buffer, 2×N as {n, min, max} — one scan per bucket over every
     channel (an envelope must never cancel phase-inverted stereo, so min/max run across channels,
     not over a mixdown). Resolution ~1 bucket per 64 samples, clamped to [64, 2048]. */
  peaksFor: function (audio) {
    const len = (audio && isFinite(audio.length)) ? Math.max(0, audio.length | 0) : 0;
    const chans = (audio && isFinite(audio.numberOfChannels)) ? Math.max(1, audio.numberOfChannels | 0) : 1;
    const n = len > 0 ? Math.min(2048, Math.max(64, Math.round(len / 64))) : 64;
    const mn = new Float32Array(n), mx = new Float32Array(n);
    if (len > 0) {
      const data = [];
      for (let c = 0; c < chans; c++) data.push(audio.getChannelData(c));
      for (let i = 0; i < n; i++) {
        const s0 = Math.floor((i * len) / n);
        const s1 = Math.max(s0 + 1, Math.floor(((i + 1) * len) / n));
        let lo = Infinity, hi = -Infinity;
        for (let c = 0; c < chans; c++) {
          const d = data[c];
          for (let j = s0; j < s1 && j < len; j++) {
            const v = d[j];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        if (lo === Infinity) { lo = 0; hi = 0; }
        mn[i] = lo; mx[i] = hi;
      }
    }
    return { n: n, min: mn, max: mx };
  },

  makeEntry: function (name, audio) {
    const st = avSampleStore;
    return {
      id: "s" + (++st.seq),
      name: name,
      duration: (audio && isFinite(audio.duration)) ? audio.duration : 0,
      sampleRate: (audio && isFinite(audio.sampleRate)) ? audio.sampleRate : 0,
      channels: (audio && isFinite(audio.numberOfChannels)) ? audio.numberOfChannels : 0,
      peaks: st.peaksFor(audio),
      buffer: audio,
    };
  },

  add: function (entry) {
    const st = avSampleStore;
    if (!entry || !entry.id) return null;
    st.entries.push(entry);
    st.byId[entry.id] = entry;
    try { st.render(); } catch (e) { st.lastError = String((e && e.message) || e); }
    return entry.id;
  },

  remove: function (id) {
    const st = avSampleStore;
    const e = st.byId[id];
    if (!e) return false;
    if (st.activeId === id) st.stopPreview();       /* never leave a removed sample's voice live */
    delete st.byId[id];
    const i = st.entries.indexOf(e);
    if (i >= 0) st.entries.splice(i, 1);
    try { st.render(); } catch (err) { st.lastError = String((err && err.message) || err); }
    return true;
  },

  clear: function () {
    const st = avSampleStore;
    st.stopPreview();
    st.entries.length = 0;
    st.byId = {};
    try { st.render(); } catch (e) { /* list is a nicety */ }
    return true;
  },

  /* stop the ONE live one-shot (safe to call any time; true when something was stopped) */
  stopPreview: function () {
    const st = avSampleStore;
    const src = st.active;
    st.previewSeq = (st.previewSeq | 0) + 1;   /* R22: any in-flight decode is superseded */
    st.active = null;
    st.activeId = null;
    st.activeLib = null;
    if (!src) return false;
    try { if (typeof src.stop === "function") src.stop(); } catch (e) { /* already ended */ }
    try { if (typeof src.disconnect === "function") src.disconnect(); } catch (e) { /* already gone */ }
    return true;
  },

  /* the preview/decode context: the live engine context first (one context, one tap chain — no
     needless second context), else ONE lazily created fallback of our own. */
  pickCtx: function () {
    const st = avSampleStore;
    try {
      const w = (typeof window !== "undefined") ? window.__avEngine : null;
      const h = (w && w.ready === true && w.handle) ? w.handle : null;
      const c = h ? h.ctx : null;
      if (c && c.state !== "closed" && typeof c.createBufferSource === "function") return c;
    } catch (e) { /* engine facade absent */ }
    try {
      let c = st.ctx;
      if (c && c.state === "closed") c = null;
      if (!c && typeof AudioContext !== "undefined") {
        c = new AudioContext({ latencyHint: "interactive" });
        st.ctx = c;
      }
      return (c && typeof c.createBufferSource === "function") ? c : null;
    } catch (e) { return null; }
  },

  /* the preview destination. Law: connect to the KEYS bus (avKeysFor) so the preview rides the
     master tap. The tap answers only for contexts whose chain was already built; reading
     ctx.destination once is how the chain gets built (with the tap installed its getter RETURNS the
     bus — the read is discarded), the same last-resort move av_engine makes. When the tap part is
     present but cannot answer, the preview refuses rather than bypassing the tap; the raw
     destination exists only when av_tap itself does not (harness / pre-tap builds). */
  destFor: function (ctx) {
    if (!ctx || typeof ctx.createBufferSource !== "function") return null;
    let hasTap = false;
    try { hasTap = (typeof avKeysFor === "function"); } catch (e) { hasTap = false; }
    let d = null;
    try { if (hasTap) d = avKeysFor(ctx); } catch (e) { d = null; }
    if (d && typeof d.connect === "function") return d;
    try { void ctx.destination; } catch (e) { /* no destination */ }
    try { if (hasTap) d = avKeysFor(ctx); } catch (e) { d = null; }
    if (d && typeof d.connect === "function") return d;
    if (hasTap) return null;
    try {
      const real = ctx.destination;
      return (real && typeof real.connect === "function") ? real : null;
    } catch (e) { return null; }
  },

  /* the teal from the theme token (getComputedStyle once, cached; the literal is the token value
     in styles.css — do not drift) */
  teal: function () {
    const st = avSampleStore;
    if (st.tealCss) return st.tealCss;
    let v = "";
    try {
      if (typeof document !== "undefined" && typeof getComputedStyle === "function") {
        v = String(getComputedStyle(document.documentElement).getPropertyValue("--teal") || "").trim();
      }
    } catch (e) { v = ""; }
    st.tealCss = v || "#2ed8c9";
    return st.tealCss;
  },

  /* ---------- markup (pure string builders) ---------- */

  bodyHTML: function () {
    const st = avSampleStore;
    return '<div class="av-sample-drop" data-av-sample-drop role="button" tabindex="0" aria-label="Import audio — drop files here or press Enter to choose">' +
      '<input class="av-sample-file" type="file" data-av-sample-input accept="audio/*,.wav,.wave,.mp3,.ogg,.oga,.flac,.aif,.aiff,.m4a" multiple hidden>' +
      '<div class="av-sample-dropmsg">DROP AUDIO HERE <span class="av-dim">— or click to choose · WAV · MP3 · OGG · FLAC · ' + st.max + ' per session</span></div>' +
      "</div>" +
      '<div class="av-sample-list" data-av-sample-list></div>';
  },

  rowHTML: function (e) {
    const st = avSampleStore;
    const secs = (isFinite(e.duration) ? e.duration : 0).toFixed(2);
    const ch = e.channels === 1 ? "mono" : (e.channels + " ch");
    const mb = (((e.buffer ? e.buffer.length * e.channels * 4 : 0)) / 1048576).toFixed(1);
    return '<div class="av-sample-row" data-av-sample-row="' + st.esc(e.id) + '">' +
      '<div class="av-sample-head">' +
      '<span class="av-sample-name" title="' + st.esc(e.name) + '">' + st.esc(e.name) + "</span>" +
      '<span class="av-sample-meta">' + secs + "s · " + (isFinite(e.sampleRate) ? e.sampleRate : "?") + " Hz · " + ch + " · " + mb + " MB</span>" +
      '<span class="av-sample-actions">' +
      '<button class="av-btn mini" type="button" data-av-sample-preview="' + st.esc(e.id) + '" title="Preview — one-shot through the master tap">▶ PREVIEW</button>' +
      '<button class="av-btn mini" type="button" data-av-sample-remove="' + st.esc(e.id) + '" title="Remove this sample from the session">✕</button>' +
      "</span></div>" +
      '<canvas class="av-sample-wave" width="600" height="72" role="img" aria-label="Waveform of ' + st.esc(e.name) + '" data-av-sample-canvas="' + st.esc(e.id) + '"></canvas>' +
      "</div>";
  },

  /* ---------- list paint ---------- */

  render: function () {
    const st = avSampleStore;
    if (typeof document === "undefined") return false;
    const host = st.hostEl;
    if (!host || !host.querySelector) return false;
    const list = host.querySelector("[data-av-sample-list]");
    if (!list) return false;
    if (!st.entries.length) {
      list.innerHTML = '<p class="av-note av-dim av-sample-empty" data-av-sample-empty>No samples yet — drop audio on the zone above, or click it to choose files.</p>';
      return true;
    }
    let html = "";
    for (let i = 0; i < st.entries.length; i++) html += st.rowHTML(st.entries[i]);
    list.innerHTML = html;
    const cvs = list.querySelectorAll("canvas[data-av-sample-canvas]");
    for (let i = 0; i < cvs.length; i++) {
      const ent = st.byId[cvs[i].getAttribute("data-av-sample-canvas")];
      if (ent) avSampleDrawWaveform(cvs[i], ent);
    }
    return true;
  },

  /* ---------- event wiring (bind-once; the host is rebuilt through avSampleInit) ---------- */

  bind: function () {
    const st = avSampleStore;
    const host = st.hostEl;
    if (!host || !host.addEventListener) return false;
    if (host.dataset.avSampleBound === "1") return true;
    host.dataset.avSampleBound = "1";

    /* a stray file drop anywhere else must never navigate the page away (a dropped WAV would
       replace the app in the tab). R17 fix (battery v1): the document-wide DROP default is
       owned by av_import_ui's claim (it preventDefaults every drop and routes unclaimed ones
       to the hub) — this module keeps only the dragover claim, so an unconsumed drop keeps
       defaultPrevented=false and can route. The per-host drop handler below still consumes
       drops on THIS card first. */
    try {
      const de = (typeof document !== "undefined") ? document.documentElement : null;
      if (de && de.dataset && de.dataset.avSampleDoc !== "1") {
        de.dataset.avSampleDoc = "1";
        document.addEventListener("dragover", function (e) { try { e.preventDefault(); } catch (err) { /* ok */ } });
      }
    } catch (e) { /* no documentElement — nothing to claim */ }

    const drop = host.querySelector("[data-av-sample-drop]");
    const input = host.querySelector("[data-av-sample-input]");

    /* the whole host is a drop target; the zone inside it is the visual one (spec: zone + host).
       ONE drop listener on purpose — a listener on the zone too would import the same drop twice. */
    let depth = 0;
    host.addEventListener("dragover", (e) => {
      try { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } catch (err) { /* ok */ }
    });
    host.addEventListener("dragenter", (e) => {
      try { e.preventDefault(); } catch (err) { /* ok */ }
      depth++;
      try { host.classList.add("dragover"); } catch (err) { /* ok */ }
    });
    host.addEventListener("dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (!depth) { try { host.classList.remove("dragover"); } catch (err) { /* ok */ } }
    });
    host.addEventListener("drop", (e) => {
      try {
        e.preventDefault();
        depth = 0;
        host.classList.remove("dragover");
        const dt = e.dataTransfer;
        const files = dt ? dt.files : null;
        if (files && files.length) st.importFiles(files);
      } catch (err) { st.lastError = String((err && err.message) || err); }
    });

    if (drop) {
      drop.addEventListener("click", (e) => {
        if (!input) return;
        if (e.target === input) return;    /* the synthetic picker click returning through the zone */
        try { input.value = ""; } catch (err) { /* ok */ }
        input.click();
      });
      drop.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
          e.preventDefault();
          if (input) { try { input.value = ""; } catch (err) { /* ok */ } input.click(); }
        }
      });
    }
    if (input) {
      input.addEventListener("change", () => {
        const files = input.files;
        if (files && files.length) st.importFiles(files);
        try { input.value = ""; } catch (err) { /* ok */ }   /* re-importing the same file must fire again */
      });
    }

    const list = host.querySelector("[data-av-sample-list]");
    if (list) {
      list.addEventListener("click", (e) => {
        const el = (e.target && e.target.closest) ? e.target.closest("[data-av-sample-preview],[data-av-sample-remove]") : null;
        if (!el) return;
        const pid = el.getAttribute("data-av-sample-preview");
        if (pid) { avSamplePreview(pid); return; }
        const rid = el.getAttribute("data-av-sample-remove");
        if (rid) st.remove(rid);
      });
    }
    return true;
  },

  /* DOM-facing import: fire-and-forget with one honest console line (never a throw) */
  importFiles: function (files) {
    let p = null;
    try { p = avSampleImportFiles(files); }
    catch (e) { p = Promise.resolve({ ok: false, added: [], errors: [String((e && e.message) || e)] }); }
    return p.then(function (r) {
      try {
        if (typeof console !== "undefined" && console.log) {
          console.log("[anvil] sample import — " + r.added.length + " added · " + r.errors.length + " failed" +
            (r.errors.length ? " (" + r.errors[0] + ")" : ""));
        }
      } catch (e) { /* console gone */ }
      return r;
    });
  },
};

/* ================================ import ================================ */

/* Import File objects (or raw ArrayBuffers) into the registry. Every file runs its own try: one bad
   file never sinks the batch. The ≤ max cap counts in-flight imports too. Returns a plain object:
   {ok, added: [names], errors: [strings], count, max} — never rejects. */
async function avSampleImportFiles(files, opts) {
  const st = avSampleStore;
  void opts;                                   /* reserved (P3: normalise/target options) */
  const out = { ok: false, added: [], errors: [], count: st.entries.length, max: st.max };
  try {
    const list = [];
    if (files) {
      if (typeof files.length === "number") {
        for (let i = 0; i < files.length; i++) list.push(files[i]);
      } else if (typeof files[Symbol.iterator] === "function") {
        for (const f of files) list.push(f);
      }
    }
    if (!list.length) { out.errors.push("no files"); return out; }
    const ctx = st.pickCtx();
    if (!ctx) { out.errors.push("no AudioContext for decode"); return out; }
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (st.entries.length + st.pending >= st.max) {
        out.errors.push("cap " + st.max + " reached — skipped " + String((f && f.name) || "item"));
        continue;
      }
      let name = "sample", raw = null, reserved = false;
      try {
        if (f && typeof f.arrayBuffer === "function") {
          name = String(f.name || "sample");
          st.pending++;
          reserved = true;
          raw = await f.arrayBuffer();
        } else if (typeof ArrayBuffer !== "undefined" && f instanceof ArrayBuffer) {
          name = "buffer";                       /* a raw buffer is copied: decode detaches its input */
          st.pending++;
          reserved = true;
          raw = f.slice(0);
        } else {
          out.errors.push("not a file");
          continue;
        }
        const audio = await new Promise((res, rej) => {
          let p = null;
          try { p = ctx.decodeAudioData(raw, res, rej); } catch (e) { rej(e); return; }
          if (p && typeof p.then === "function") p.then(res, rej);   /* promise-form browsers */
        });
        st.add(st.makeEntry(name, audio));
        out.added.push(name);
      } catch (e) {
        out.errors.push(name + ": " + String((e && e.message) || e || "decode failed"));
      } finally {
        if (reserved) st.pending = Math.max(0, st.pending - 1);
      }
    }
    out.count = st.entries.length;
    out.ok = out.added.length > 0;
    if (!out.ok && out.errors.length) st.lastError = out.errors[0];
  } catch (e) {
    out.errors.push(String((e && e.message) || e));
    st.lastError = out.errors[out.errors.length - 1];
  }
  return out;
}

/* ================================ waveform ================================ */

/* min/max column waveform on a 2D canvas. `entry` is a registry entry (or its id).
   HiDPI law: backing store = CSS box × dpr, refitted only when it differs; hidden/zero-size
   canvases are skipped BEFORE any resize (writing width = 0 destroys the surface). Draws in CSS
   pixel space via setTransform, so the code is the same at every dpr. */
function avSampleDrawWaveform(canvas, entry) {
  try {
    if (!canvas || typeof canvas.getContext !== "function") return false;
    let e = entry;
    if (typeof e === "string") e = avSampleStore.byId[e] || null;
    if (!e || !e.peaks || !e.peaks.min || !e.peaks.max) return false;
    const dprRaw = (typeof window !== "undefined" && isFinite(window.devicePixelRatio)) ? window.devicePixelRatio : 1;
    const dpr = Math.max(1, Math.min(4, dprRaw));
    const cw = Number(canvas.clientWidth) || 0, ch = Number(canvas.clientHeight) || 0;
    let cssW = 0, cssH = 0;
    if (cw > 0 && ch > 0) { cssW = Math.round(cw); cssH = Math.round(ch); }
    else if (canvas.isConnected === false) {
      /* detached (a unit harness, a staging canvas): fall back to its own declared box */
      cssW = Math.max(1, Math.round(Number(canvas.width) || 300));
      cssH = Math.max(1, Math.round(Number(canvas.height) || 100));
    } else {
      return false;                       /* hidden in a live document: leave the surface alone */
    }
    const bw = Math.max(1, Math.round(cssW * dpr)), bh = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    const g = canvas.getContext("2d");
    if (!g) return false;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    const mid = cssH / 2;
    g.fillStyle = "rgba(46,216,201,0.16)";      /* the quiet zero line */
    g.fillRect(0, mid - 0.5, cssW, 1);
    const n = e.peaks.n, min = e.peaks.min, max = e.peaks.max;
    const amp = (cssH / 2) * 0.92;              /* 8% headroom so full-scale never touches the edge */
    g.fillStyle = avSampleStore.teal();
    for (let x = 0; x < cssW; x++) {
      const i0 = Math.floor((x * n) / cssW);
      const i1 = Math.max(i0 + 1, Math.floor(((x + 1) * n) / cssW));
      let lo = Infinity, hi = -Infinity;
      for (let i = i0; i < i1 && i < n; i++) {
        const a = min[i], b = max[i];
        if (a < lo) lo = a;
        if (b > hi) hi = b;
      }
      if (lo === Infinity) { lo = 0; hi = 0; }
      const y0 = mid - hi * amp;
      const y1 = mid - lo * amp;
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
    return true;
  } catch (err) {
    try { avSampleStore.lastError = String((err && err.message) || err); } catch (e2) { /* ok */ }
    return false;
  }
}

/* ================================ preview ================================ */

/* One-shot preview through the master tap (KEYS bus → MASTER gain). A new preview preempts the old
   one (one preview voice, ever). avSamplePreview(null) just stops. Returns true when a one-shot
   started. The rig's witness attaches to avMasterFor(ctx) — the same context this records on
   lastPreview.ctx. */
function avSamplePreview(id) {
  const st = avSampleStore;
  try {
    st.stopPreview();
    if (id == null) return false;
    const entry = (typeof id === "object") ? id : (st.byId[id] || null);
    if (!entry || !entry.buffer || !isFinite(entry.buffer.duration)) return false;
    const ctx = st.pickCtx();
    if (!ctx) { st.lastError = "preview: no AudioContext"; return false; }
    try {
      if (ctx.state === "suspended" && typeof ctx.resume === "function") {
        const p = ctx.resume();
        if (p && typeof p.catch === "function") p.catch(() => { /* gesture-gated — engine listeners retry */ });
      }
    } catch (e) { /* resume refused */ }
    const dest = st.destFor(ctx);
    if (!dest) { st.lastError = "preview: tap bus unavailable"; return false; }
    const src = ctx.createBufferSource();
    src.buffer = entry.buffer;
    src.connect(dest);
    src.onended = function () { if (st.active === src) { st.active = null; st.activeId = null; st.activeLib = null; } };
    src.start();
    st.active = src;
    st.activeId = entry.id;
    st.activeLib = null;                     /* this path is a session-entry preview, not a lib one */
    st.lastPreview = { id: entry.id, ctx: ctx, lib: null, at: (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now() };
    return true;
  } catch (e) {
    st.lastError = String((e && e.message) || e);
    return false;
  }
}

/* R22 -- the library preview (child B of verify/_r22_wave.md section 3): audition stored library
   bytes through the SAME master-tap law avSamplePreview uses (pickCtx + destFor), extending the
   ONE preview voice law: a new preview -- session or library -- preempts the old one.
   avSamplePreviewBytes(label, bytes) never throws; the receipt is {ok, label, error, at}.
   decodeAudioData detaches its input, so the bytes are COPIED first (a fresh ArrayBuffer, then
   the callback + promise decode pair behind a once-guard -- the avSampleImportFiles shape).
   activeLib carries the live library label; this path leaves activeId null (session-entry
   previews keep using it). previewSeq is the in-flight generation: stopPreview and every new
   preview bump it, so a stale decode can never start a second voice. avSamplePreviewStop() is
   the public stop for the ONE active voice, whatever its source. */

function avSamplePreviewBytes(label, bytes) {
  const st = avSampleStore;
  const out = {
    ok: false,
    label: (label == null ? "" : String(label)),
    error: "",
    at: (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(),
  };
  return new Promise(function (resolve) {
    const done = { v: false };
    const fin = function (ok, err, quiet) {
      if (done.v) return;
      done.v = true;
      out.ok = (ok === true);
      out.error = out.ok ? "" : String(err == null ? "preview failed" : err);
      if (!out.ok && quiet !== true) { try { st.lastError = "preview: " + out.error; } catch (e) { /* ok */ } }
      resolve(out);
    };
    try {
      st.stopPreview();                 /* one preview voice, ever: the new preview preempts the old */
      const mine = st.previewSeq;       /* this invocation's generation (stopPreview just bumped it) */
      let raw = null;
      try {
        if (typeof ArrayBuffer !== "undefined" && bytes instanceof ArrayBuffer) {
          raw = bytes.slice(0);         /* the detach law: decodeAudioData eats its input */
        } else if (bytes && typeof bytes.byteLength === "number" && typeof ArrayBuffer !== "undefined" &&
                   bytes.buffer instanceof ArrayBuffer) {
          const off = (isFinite(bytes.byteOffset) && bytes.byteOffset > 0) ? (bytes.byteOffset | 0) : 0;
          raw = bytes.buffer.slice(off, off + (bytes.byteLength | 0));
        }
      } catch (e) { raw = null; }
      if (!raw || !raw.byteLength) { fin(false, "no bytes to decode"); return; }
      const ctx = st.pickCtx();
      if (!ctx) { fin(false, "no AudioContext"); return; }
      try {
        if (ctx.state === "suspended" && typeof ctx.resume === "function") {
          const rp = ctx.resume();
          if (rp && typeof rp.catch === "function") rp.catch(function () { /* gesture-gated -- engine listeners retry */ });
        }
      } catch (e) { /* resume refused */ }
      const dest = st.destFor(ctx);
      if (!dest) { fin(false, "tap bus unavailable"); return; }
      const start = function (audio) {
        if (done.v) return;             /* the callback + promise pair may both fire */
        if (mine !== st.previewSeq) { fin(false, "superseded by a newer preview", true); return; }
        if (!audio || !isFinite(audio.duration)) { fin(false, "decode produced no audio"); return; }
        try {
          const src = ctx.createBufferSource();
          src.buffer = audio;
          src.connect(dest);
          src.onended = function () { if (st.active === src) { st.active = null; st.activeId = null; st.activeLib = null; } };
          src.start();
          st.active = src;
          st.activeId = null;           /* this path carries no session entry */
          st.activeLib = out.label;
          out.at = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
          st.lastPreview = { id: null, ctx: ctx, lib: out.label, at: out.at };
          fin(true, "");
        } catch (e) { fin(false, (e && e.message) || e); }
      };
      const fail = function (err) { fin(false, (err && err.message) || err || "decode failed"); };
      let p = null;
      try { p = ctx.decodeAudioData(raw, start, fail); } catch (e) { fail(e); return; }
      if (p && typeof p.then === "function") p.then(start, fail);   /* promise-form browsers */
    } catch (e) {
      fin(false, (e && e.message) || e);
    }
  });
}

/* R22: stop the ONE live preview voice, whatever its source (session or lib); true when
   something was stopped -- the public wrapper the hub's preview act reaches for. */
function avSamplePreviewStop() {
  try { return avSampleStore.stopPreview() === true; } catch (e) { return false; }
}

/* ================================ init ================================ */

/* Mount into the parent-owned #av-sample-host. Host absent → false, no throw (the parent adds the
   element; children never touch body.html). Idempotent; if the host was rebuilt, the markup and
   wiring are rebuilt with it. Returns true when the card is mounted. */
function avSampleInit() {
  const st = avSampleStore;
  try {
    if (typeof document === "undefined" || !document.getElementById) return false;
    const host = document.getElementById("av-sample-host");
    if (!host || !host.querySelector) return false;
    st.hostEl = host;
    if (!host.querySelector("[data-av-sample-drop]")) {
      host.innerHTML = st.bodyHTML();
    }
    st.bind();
    st.inited = true;
    st.render();
    return true;
  } catch (e) {
    st.lastError = String((e && e.message) || e);
    return false;
  }
}

/* ---------- debug/verify surface (suites + console read this; snap() is JSON-safe) ---------- */
if (typeof window !== "undefined") window.__avSample = avSampleStore;

/* ================================ engine transfer (P3, child F append) ================================
   avSampleSendToEngine(id[, slot]) -> Promise<bool> — copy an entry's channel data into PLAIN
   Float32Arrays (decoupled from the live AudioBuffer; <= 60 s per channel) and hand them to the
   engine through the parent-added facade avEngineSample(slot, name, rate, ch1, ch2). Pinned with the
   engine side (see the av_grain.js / av_sampler.js headers): the worklet keeps up to 4 slots
   (eng.samples[0..3] = null | {name, rate, n, ch1, ch2}); the message is
   {t:"sample", id, name, rate, ch1, ch2?} with id = the SLOT index 0..3. Slot choice: an explicit
   second arg wins; else the entry's import sequence (sN -> (N-1) mod 4 — the first four sends fill
   slots 0..3, later sends recycle in order). Resolves false HONESTLY whenever the transfer cannot
   happen: unknown entry, no decodable buffer, facade absent, facade refused/threw. On success the
   slot record lands in avSampleStore.sent[slot] = {slot, id, name, rate, frames, at}.

   Laws kept: append-only (the P2 API above is untouched); no throw paths; nothing touches the audio
   graph here (pure copy + facade call); the copy is what makes transferables safe — the live
   AudioBuffer's channel data must never be detached or sent anywhere. */

avSampleStore.sent = [null, null, null, null];   /* per-slot records: {slot, id, name, rate, frames, at} */

avSampleStore.sendToEngine = function (entryId, slotArg) {
  const st = avSampleStore;
  try {
    const e = (entryId && typeof entryId === "object") ? entryId : st.get(entryId);
    if (!e || !e.buffer || typeof e.buffer.getChannelData !== "function") return Promise.resolve(false);
    const buf = e.buffer;
    let n = (isFinite(buf.length) ? Math.max(0, buf.length | 0) : 0);
    const rate = (isFinite(buf.sampleRate) && buf.sampleRate > 0) ? buf.sampleRate : ((isFinite(e.sampleRate) && e.sampleRate > 0) ? e.sampleRate : 0);
    if (n <= 0) return Promise.resolve(false);
    const cap = rate > 0 ? Math.round(60 * rate) : n;        /* <= 60 s per channel (engine law) */
    if (n > cap) n = cap;
    /* slot: explicit wins; else the entry's import sequence (sN -> N-1, mod 4) */
    let slot = null;
    if (slotArg !== undefined && slotArg !== null) {
      const s0 = Number(slotArg);
      if (isFinite(s0)) slot = Math.round(s0);
    }
    if (slot === null || !isFinite(slot)) {
      const m = /(\d+)$/.exec(String(e.id == null ? "" : e.id));
      const seq = m ? parseInt(m[1], 10) : (st.entries.indexOf(e) + 1);
      slot = Math.max(0, seq - 1) % 4;
    }
    slot = Math.max(0, Math.min(3, slot | 0));
    const channels = Math.max(1, Math.min(2, (isFinite(buf.numberOfChannels) ? buf.numberOfChannels | 0 : 1)));
    /* the copies: plain, exact-length Float32Arrays (structured-clone / transfer safe) */
    const src1 = buf.getChannelData(0);
    const ch1 = new Float32Array(n);
    ch1.set(src1.subarray(0, Math.min(n, src1.length)));
    let ch2 = null;
    if (channels > 1) {
      const src2 = buf.getChannelData(1);
      ch2 = new Float32Array(n);
      ch2.set(src2.subarray(0, Math.min(n, src2.length)));
    }
    if (typeof avEngineSample !== "function") return Promise.resolve(false);
    let r;
    try { r = avEngineSample(slot, String(e.name || e.id || "sample"), rate, ch1, ch2); }
    catch (err) { st.lastError = String((err && err.message) || err); return Promise.resolve(false); }
    if (r === false) return Promise.resolve(false);
    const at = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    const rec = { slot: slot, id: e.id, name: String(e.name || e.id || "sample"), rate: rate, frames: n, at: at };
    if (r && typeof r.then === "function") {
      return r.then(function (x) {
        if (x === false) return false;
        st.sent[slot] = rec;
        return true;
      }, function (err) { st.lastError = String((err && err.message) || err); return false; });
    }
    st.sent[slot] = rec;
    return Promise.resolve(true);
  } catch (e) {
    try { avSampleStore.lastError = String((e && e.message) || e); } catch (e2) { /* ok */ }
    return Promise.resolve(false);
  }
};

/* the pinned top-level name (the parent's UI/rig calls this) */
function avSampleSendToEngine(id, slot) {
  return avSampleStore.sendToEngine(id, slot);
}
