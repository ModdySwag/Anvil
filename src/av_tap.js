/* Anvil — master audio tap (ported from Pattern Forge's pfInstallAudioTap discipline, T9 §12).
   LAWS preserved:
   - install BEFORE the first AudioContext; reading ctx.destination builds the per-context chain.
   - chain: <app sources> -> KEYS bus (INSTRUMENT level) -> MASTER gain (MASTER level) -> speakers.
   - ctx.destination returns the KEYS bus; avKeysFor(ctx) hands the bus explicitly.
   - offline renders (startRendering) get the chain but are never registered live / metered.
   - meters + the future recorder attach to the MASTER node (avMasterNodes()); verifiers own
     their own AnalyserNode — panel reads are never witnesses. */
"use strict";

const avTap = { installed: false, ctx: null, node: null, keys: null, real: null, live: [], splitter: null, analyserL: null, analyserR: null, levels: { l: 0, r: 0, peak: 0 } };
const avTapCtxs = new WeakMap();
const AV_TAP_MAX = 1.2;

function avBusLevel(v, fallback) {
  const n = Number(v);
  return isFinite(n) ? Math.max(0, Math.min(AV_TAP_MAX, n)) : fallback;
}
function avMasterLevel() {
  try { if (typeof avState !== "undefined" && avState && isFinite(avState.master)) return avBusLevel(avState.master, 0.8); } catch (e) { /* no state yet */ }
  return 0.8;
}
function avKeysLevel() {
  try { if (typeof avState !== "undefined" && avState && isFinite(avState.keysVol)) return avBusLevel(avState.keysVol, 1); } catch (e) { /* no state yet */ }
  return 1;
}
function avVolRemember(lsKey, v) { try { localStorage.setItem(lsKey, String(v)); } catch (e) { /* storage blocked */ } }

function avKeysFor(ctx) {
  if (!ctx) return null;
  try { const t = avTapCtxs.get(ctx); if (t && t.keys && t.keys.gain) return t.keys; } catch (e) { /* ctx gone */ }
  return null;
}
function avMasterFor(ctx) {
  if (!ctx) return null;
  try { const t = avTapCtxs.get(ctx); if (t && t.master && t.master.gain) return t.master; } catch (e) { /* ctx gone */ }
  return null;
}

function avInstallAudioTap() {
  if (avTap.installed) return true;
  try {
    const proto = (typeof BaseAudioContext !== "undefined" && BaseAudioContext.prototype)
      || (typeof AudioContext !== "undefined" && AudioContext.prototype);
    if (!proto) return false;
    const desc = Object.getOwnPropertyDescriptor(proto, "destination");
    if (!desc || !desc.get) return false;
    Object.defineProperty(proto, "destination", {
      configurable: true,
      get() {
        const ctx = this;
        const existing = avTapCtxs.get(ctx);
        if (existing) return existing.out;
        let real = null;
        try { real = desc.get.call(ctx); } catch (e) { return real; }
        /* offline renders (bounces, probes) ride the gains but never register live / metered */
        const offline = typeof ctx.startRendering === "function";
        try {
          const master = ctx.createGain();
          master.connect(real);
          Object.defineProperty(master, "maxChannelCount", { value: 2, configurable: true });
          Object.defineProperty(master, "__avTap", { value: true });
          Object.defineProperty(master, "__avMaster", { value: true });
          try { master.gain.value = avMasterLevel(); } catch (e) { /* default stands */ }
          const keys = ctx.createGain();
          Object.defineProperty(keys, "maxChannelCount", { value: 2, configurable: true });
          Object.defineProperty(keys, "__avTap", { value: true });
          Object.defineProperty(keys, "__avKeys", { value: true });
          try { keys.gain.value = avKeysLevel(); } catch (e) { /* default stands */ }
          keys.connect(master);
          avTapCtxs.set(ctx, { out: keys, keys: keys, master: master, real: real, offline: offline });
          if (!offline) {
            avTap.live = (avTap.live || []).filter(c => c.state !== "closed");
            avTap.live.push(ctx);
            const cur = avTap.ctx;
            if (!cur || cur.state === "closed") {
              avTap.ctx = ctx;
              avTap.node = master;   /* the MASTER node — meters, recorder, analyser ride this */
              avTap.keys = keys;     /* the instrument bus, one step upstream */
              avTap.real = real;
              avAttachMeters(ctx, master);
            }
          }
          return keys;
        } catch (e) { return real; }
      },
    });
    avTap.installed = true;
    return true;
  } catch (e) { return false; }
}

function avMasterNodes() {
  const out = [];
  for (const ctx of ((avTap.live || []).filter(c => c.state !== "closed"))) {
    try { const n = avMasterFor(ctx); if (n && n.gain) out.push(n); } catch (e) { /* gone */ }
  }
  if (!out.length && avTap.node && avTap.node.gain) out.push(avTap.node);
  return out;
}
function avMasterOnNode() { return !!avTap.installed; }
function avMasterApply(v) {
  const val = avBusLevel(v, null);
  if (val == null) return false;
  const nodes = avMasterNodes();
  if (!nodes.length) return false;
  for (const n of nodes) {
    try { n.gain.setTargetAtTime(val, n.context ? n.context.currentTime : 0, 0.015); }
    catch (e) { try { n.gain.value = val; } catch (e2) { /* node gone */ } }
  }
  avVolRemember("av-master", val);
  return true;
}
function avKeysNodes() {
  const out = [];
  for (const ctx of ((avTap.live || []).filter(c => c.state !== "closed"))) {
    try { const n = avKeysFor(ctx); if (n && n.gain) out.push(n); } catch (e) { /* gone */ }
  }
  if (!out.length && avTap.keys && avTap.keys.gain) out.push(avTap.keys);
  return out;
}
function avKeysApply(v) {
  const val = avBusLevel(v, null);
  if (val == null) return false;
  const nodes = avKeysNodes();
  if (!nodes.length) return false;
  for (const n of nodes) {
    try { n.gain.setTargetAtTime(val, n.context ? n.context.currentTime : 0, 0.015); }
    catch (e) { try { n.gain.value = val; } catch (e2) { /* node gone */ } }
  }
  avVolRemember("av-keys-vol", val);
  return true;
}

function avAttachMeters(ctx, node) {
  try {
    if (!node || node.__avMetered) return;
    node.__avMetered = true;
    const splitter = ctx.createChannelSplitter(2);
    const aL = ctx.createAnalyser(); aL.fftSize = 1024;
    const aR = ctx.createAnalyser(); aR.fftSize = 1024;
    node.connect(splitter);
    splitter.connect(aL, 0);
    splitter.connect(aR, 1);
    avTap.splitter = splitter; avTap.analyserL = aL; avTap.analyserR = aR;
    const bl = new Uint8Array(aL.fftSize), br = new Uint8Array(aR.fftSize);
    const loop = () => {
      try {
        if (!avTap.analyserL) return;
        avTap.analyserL.getByteTimeDomainData(bl);
        avTap.analyserR.getByteTimeDomainData(br);
        let pl = 0, pr = 0;
        for (let i = 0; i < bl.length; i++) { const d = Math.abs(bl[i] - 128) / 128; if (d > pl) pl = d; }
        for (let i = 0; i < br.length; i++) { const d = Math.abs(br[i] - 128) / 128; if (d > pr) pr = d; }
        avTap.levels.l = avTap.levels.l * 0.6 + pl * 0.4;
        avTap.levels.r = avTap.levels.r * 0.6 + pr * 0.4;
        avTap.levels.peak = Math.max(avTap.levels.peak * 0.995, Math.max(pl, pr));
      } catch (e) { /* context closed */ }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  } catch (e) { /* meters are a nicety, never fatal */ }
}

function avTapInfo() {
  return {
    installed: avTap.installed,
    live: (avTap.live || []).filter(c => c.state !== "closed").length,
    master: avTap.node && avTap.node.gain ? Number(avTap.node.gain.value.toFixed(3)) : null,
    levels: { l: Number(avTap.levels.l.toFixed(3)), r: Number(avTap.levels.r.toFixed(3)), peak: Number(avTap.levels.peak.toFixed(3)) },
  };
}

window.__avTap = avTap;
