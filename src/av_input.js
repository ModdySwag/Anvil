/* Anvil — S1 audio input (sa-A): getUserMedia → MediaStreamSource → inputGain → (monitor: master).
   Contract: verify/_s1_wave.md §2.1 (pinned surface) + §3 laws. Pinned surface:
     avInputInit() -> boolean                 · idempotent; page module; nothing mounted
     avInputEnable() -> Promise<{ ok, deviceId, label, channels, sampleRate } | { ok:false, error }>
     avInputDisable()                         · idempotent; full teardown
     avInputGain(v) 0..1.2                    · setter/getter; returns the applied value
     avInputMonitor(on) -> boolean            · inputGain → avMasterFor(ctx); OFF by default
     avInputOffset(ms) -200..200 (default 0)  · setter/getter; returns the applied value
     avInputLatency() -> { baseMs, offsetMs, totalFrames, sr }
     avInputLevels() -> { peak, rms }         · own AnalyserNode on the input gain, read on call
     avInputDevices() -> Promise<[{ deviceId, label }]>
     avInputState() · avInputClasses() -> string[] · avInputNode() -> the live input gain node | null

   LAWS:
   - ctx law (§2.1): the SAME AudioContext as the engine — window.__avEngine.handle.ctx (guarded),
     falling back to avTap.ctx; none found → honest refusal in avInputEnable().
   - getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}})
     → MediaStreamAudioSourceNode → inputGain (GainNode, default 1.0). Monitor OFF by default;
     monitor ON connects inputGain → avMasterFor(ctx) ONLY.
   - Recording tap point = inputGain output (avInputNode()): post-gain, pre-master, DRY — the
     takes module (sa-C) records from this node.
   - Sink law (§3.3): the internal pull sink is gain-0 and goes to avTap.real (guarded) else the
     REAL destination — never back into the bus chain. When the tap wraps ctx.destination but does
     not know this ctx, the wrapped bus is refused (sinkless enable, honest state).
   - Track-before-wire (av_rec craft): nodes are stored in module state BEFORE any connect, so a
     throw can never strand a live node; avInputTeardown() is idempotent and full.
   - Node-loadable: no DOM/browser reach at load; every reach typeof-guarded; never throws.
     Allocations: block/call rate only — the analyser read buffer reallocates on size change only.
*/
"use strict";

const AV_INPUT_VERSION = "s1.0";
const AV_INPUT_GAIN_MIN = 0;
const AV_INPUT_GAIN_MAX = 1.2;          /* pinned ceiling (§2.1) */
const AV_INPUT_OFFSET_MIN = -200;       /* ms — the latency-offset knob range */
const AV_INPUT_OFFSET_MAX = 200;
const AV_INPUT_SINK_GAIN = 0;           /* the pull sink is gain-0 — silent twice over */
const AV_INPUT_FFT = 2048;              /* analyser window (~43 ms @ 48 k) */
const AV_INPUT_CLASSES = Object.freeze(["av-input-row", "av-input-btn", "av-input-device", "av-input-gain", "av-input-level", "av-input-mon", "av-input-on", "av-input-err"]);

/* ---------- module state (holds live nodes while enabled; snapshots never leak them) ---------- */
const avInput = {
  inited: false,
  enablePromise: null,   /* the in-flight enable (idempotent enable) */
  pendingDisable: false, /* disable() arrived while enable was still opening the device */
  enabled: false,
  enabling: false,
  monitor: false,
  gain: 1,               /* inputGain default 1.0 */
  offsetMs: 0,           /* latency-offset knob, default 0 */
  ctx: null,             /* the engine context under the live path */
  stream: null,          /* MediaStream */
  source: null,          /* MediaStreamAudioSourceNode */
  gainNode: null,        /* inputGain — THE recording tap point */
  analyser: null,        /* own levels analyser, tapped post-gain */
  levelBuf: null,        /* Float32 read buffer (allocated on call, reused) */
  levelBytes: null,      /* byte fallback buffer */
  sink: null,            /* gain-0 pull sink */
  sinkOn: false,
  deviceId: null,
  label: null,
  channels: 0,
  error: null,
};

/* ---------- guarded helpers (no reach at load; nothing ever throws out) ---------- */
function avInputErr(e) {
  try { return String((e && (e.message || e.name)) || e) || "unknown error"; } catch (e2) { return "unknown error"; }
}
function avInputWarn(msg) {
  try { if (typeof console !== "undefined" && console.warn) console.warn("[anvil] " + msg); } catch (e) { /* console gone */ }
}
function avInputClamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function avInputNum(v) { const n = Number(v); return isFinite(n) ? n : null; }

/* avTap probes: the page global first, then the guarded window/globalThis handles */
function avInputTap() {
  try { if (typeof avTap !== "undefined" && avTap) return avTap; } catch (e) { /* not loaded */ }
  try { if (typeof window !== "undefined" && window && window.__avTap) return window.__avTap; } catch (e) { /* no window */ }
  try { if (typeof globalThis !== "undefined" && globalThis && globalThis.__avTap) return globalThis.__avTap; } catch (e) { /* no global */ }
  return null;
}

/* ctx law: engine handle ctx (guarded) → avTap.ctx (guarded) → null */
function avInputUsableCtx(ctx) {
  try { return !!(ctx && typeof ctx === "object" && typeof ctx.createGain === "function" && ctx.state !== "closed"); } catch (e) { return false; }
}
function avInputEngineCtx() {
  const probes = [];
  try { if (typeof window !== "undefined" && window) probes.push(window); } catch (e) { /* no window */ }
  try { if (typeof globalThis !== "undefined" && globalThis && probes.indexOf(globalThis) < 0) probes.push(globalThis); } catch (e) { /* no global */ }
  for (let i = 0; i < probes.length; i++) {
    try {
      const h = probes[i].__avEngine;
      const ctx = h && h.handle && h.handle.ctx;
      if (avInputUsableCtx(ctx)) return ctx;
    } catch (e) { /* keep probing */ }
  }
  return null;
}
function avInputPickCtx() {
  let ctx = null;
  try { ctx = avInputEngineCtx(); } catch (e) { ctx = null; }
  if (ctx) return ctx;
  try {
    const t = avInputTap();
    if (t && avInputUsableCtx(t.ctx)) return t.ctx;
  } catch (e) { /* no tap ctx */ }
  return null;
}

/* media input probes — every deref guarded, absence is honest */
function avInputMediaDevices() {
  try {
    if (typeof navigator === "undefined" || !navigator) return null;
    const md = navigator.mediaDevices;
    return (md && typeof md === "object") ? md : null;
  } catch (e) { return null; }
}
function avInputTrackInfo(stream) {
  const out = { deviceId: null, label: null, channels: 1 };
  try {
    const tracks = (stream && typeof stream.getAudioTracks === "function") ? stream.getAudioTracks() : null;
    const tr = (tracks && tracks.length) ? tracks[0] : null;
    if (!tr) return out;
    if (typeof tr.label === "string" && tr.label) out.label = tr.label;
    let st = null;
    try { st = (typeof tr.getSettings === "function") ? tr.getSettings() : null; } catch (e) { st = null; }
    if (st) {
      if (st.deviceId) out.deviceId = String(st.deviceId);
      const cc = Number(st.channelCount);
      if (isFinite(cc) && cc >= 1) out.channels = Math.floor(cc);
    }
  } catch (e) { /* honest defaults stand */ }
  return out;
}
function avInputStopTracks(stream) {
  try {
    if (!stream || typeof stream.getTracks !== "function") return;
    const tr = stream.getTracks() || [];
    for (let i = 0; i < tr.length; i++) {
      try { if (tr[i] && typeof tr[i].stop === "function") tr[i].stop(); } catch (e) { /* track gone */ }
    }
  } catch (e) { /* nothing to stop */ }
}

/* Sink law: avTap.real (matching ctx) → the REAL destination; a wrapped bus is never sunk into.
   Reading ctx.destination when the tap wraps it registers the chain for this ctx (the same read
   avEngineDestFor performs as last resort) — after it, the tap's real answer is re-probed. */
function avInputRealDest(ctx) {
  const t = avInputTap();
  try { if (t && t.real && t.real.context === ctx) return t.real; } catch (e) { /* probe next */ }
  let dest = null;
  try { dest = ctx.destination || null; } catch (e) { dest = null; }
  if (!dest) return null;
  try {
    if (dest.__avKeys || dest.__avMaster || dest.__avTap) {
      try { if (t && t.real && t.real.context === ctx) return t.real; } catch (e2) { /* none */ }
      return null;                       /* never sink into the bus chain */
    }
  } catch (e2) { /* marker probe moot — treat as a native destination */ }
  return dest;
}

function avInputApplyGain(v) {
  const g = avInput.gainNode;
  if (!g || !g.gain) return;
  const at = (avInput.ctx && isFinite(avInput.ctx.currentTime)) ? avInput.ctx.currentTime : 0;
  try { g.gain.setTargetAtTime(v, at, 0.015); }
  catch (e) { try { g.gain.value = v; } catch (e2) { /* node gone */ } }
}

/* full idempotent teardown — safe at any point of the life cycle */
function avInputTeardown() {
  try { const n = avInput.source; if (n && typeof n.disconnect === "function") n.disconnect(); } catch (e) { /* never wired */ }
  try { const n = avInput.gainNode; if (n && typeof n.disconnect === "function") n.disconnect(); } catch (e) { /* gone */ }
  try { const n = avInput.analyser; if (n && typeof n.disconnect === "function") n.disconnect(); } catch (e) { /* gone */ }
  try { const n = avInput.sink; if (n && typeof n.disconnect === "function") n.disconnect(); } catch (e) { /* gone */ }
  avInputStopTracks(avInput.stream);
  avInput.source = null;
  avInput.gainNode = null;
  avInput.analyser = null;
  avInput.levelBuf = null;
  avInput.levelBytes = null;
  avInput.sink = null;
  avInput.stream = null;
  avInput.sinkOn = false;
  avInput.monitor = false;               /* monitor never survives a teardown (feedback safety) */
  avInput.enabled = false;
  avInput.ctx = null;
  avInput.deviceId = null;
  avInput.label = null;
  avInput.channels = 0;
}

/* ---------- enable / disable ---------- */
function avInputInfo() {
  let sr = null;
  try {
    const s = Number(avInput.ctx && avInput.ctx.sampleRate);
    if (isFinite(s) && s > 0) sr = s;
  } catch (e) { /* stays null */ }
  return { ok: true, deviceId: avInput.deviceId, label: avInput.label, channels: avInput.channels, sampleRate: sr };
}

async function avInputEnableRun() {
  avInput.pendingDisable = false;
  avInput.enabling = true;
  try {
    if (avInput.enabled) return avInputInfo();
    const ctx = avInputPickCtx();
    if (!ctx) return { ok: false, error: "no audio context — the input rides the engine's AudioContext; boot the engine first" };
    const md = avInputMediaDevices();
    if (!md || typeof md.getUserMedia !== "function") return { ok: false, error: "media input unavailable — navigator.mediaDevices is missing (secure context required)" };
    avInput.error = null;
    let stream = null;
    try {
      stream = await md.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      avInput.error = "input refused — " + avInputErr(e);
      avInputWarn(avInput.error);
      return { ok: false, error: avInput.error };
    }
    if (avInput.pendingDisable) {                      /* disable() arrived while opening */
      avInputStopTracks(stream);
      return { ok: false, error: "input disabled while enabling" };
    }
    if (!stream || typeof stream.getAudioTracks !== "function") {
      avInput.error = "media input returned no stream";
      return { ok: false, error: avInput.error };
    }
    return avInputBuild(ctx, stream);
  } catch (e) {
    avInput.error = "enable failed — " + avInputErr(e);
    avInputWarn(avInput.error);
    return { ok: false, error: avInput.error };
  } finally {
    avInput.enabling = false;
    avInput.pendingDisable = false;
  }
}

function avInputBuild(ctx, stream) {
  let source = null, gainNode = null, analyser = null, sink = null;
  try {
    source = ctx.createMediaStreamSource(stream);
    gainNode = ctx.createGain();
    gainNode.gain.value = avInput.gain;                /* default 1.0, or the stored knob */
    analyser = ctx.createAnalyser();
    analyser.fftSize = AV_INPUT_FFT;
  } catch (e) {
    avInputStopTracks(stream);
    avInput.error = "input path build failed — " + avInputErr(e);
    avInputWarn(avInput.error);
    return { ok: false, error: avInput.error };
  }
  /* track BEFORE wiring (av_rec craft) — a throw below can never strand a live node */
  const info = avInputTrackInfo(stream);
  avInput.ctx = ctx;
  avInput.stream = stream;
  avInput.source = source;
  avInput.gainNode = gainNode;
  avInput.analyser = analyser;
  avInput.deviceId = info.deviceId;
  avInput.label = info.label;
  avInput.channels = info.channels;
  avInput.sinkOn = false;
  avInput.monitor = false;                             /* monitor OFF by default, every enable */
  try {
    source.connect(gainNode);
    gainNode.connect(analyser);
    const real = avInputRealDest(ctx);
    if (real) {
      sink = ctx.createGain();
      sink.gain.value = AV_INPUT_SINK_GAIN;            /* silent pull keeps levels live with monitor off */
      avInput.sink = sink;
      gainNode.connect(sink);
      sink.connect(real);
      avInput.sinkOn = true;
    }
  } catch (e) {
    avInput.error = "input path wiring failed — " + avInputErr(e);
    avInputWarn(avInput.error);
    avInputTeardown();
    return { ok: false, error: avInput.error };
  }
  /* a suspended context is not a refusal: the path is built and will run on the next resume */
  try {
    if (ctx.state === "suspended" && typeof ctx.resume === "function") {
      const rp = ctx.resume();
      if (rp && typeof rp.catch === "function") rp.catch(() => { /* gesture-gated — never fatal */ });
    }
  } catch (e) { /* resume refused — gestures will retry */ }
  avInput.enabled = true;
  avInput.error = null;
  return avInputInfo();
}

function avInputEnable() {
  try {
    if (avInput.enabled) return Promise.resolve(avInputInfo());
    if (avInput.enablePromise) return avInput.enablePromise;
    const p = avInputEnableRun();
    avInput.enablePromise = p;
    const clear = () => { try { if (avInput.enablePromise === p) avInput.enablePromise = null; } catch (e) { /* ok */ } };
    p.then(clear, clear);
    return p;
  } catch (e) {
    return Promise.resolve({ ok: false, error: "enable failed — " + avInputErr(e) });
  }
}

function avInputDisable() {
  try {
    if (avInput.enabling) avInput.pendingDisable = true;   /* consumed at the next checkpoint */
    avInputTeardown();
    return true;
  } catch (e) {
    try { avInputTeardown(); } catch (e2) { /* give up cleanly */ }
    return false;
  }
}

/* ---------- knobs ---------- */
function avInputGain(v) {
  try {
    if (v === undefined || v === null) return avInput.gain;
    const n = avInputNum(v);
    if (n == null) return avInput.gain;
    avInput.gain = avInputClamp(n, AV_INPUT_GAIN_MIN, AV_INPUT_GAIN_MAX);
    avInputApplyGain(avInput.gain);
    return avInput.gain;
  } catch (e) { return avInput.gain; }
}
function avInputOffset(ms) {
  try {
    if (ms === undefined || ms === null) return avInput.offsetMs;
    const n = avInputNum(ms);
    if (n == null) return avInput.offsetMs;
    avInput.offsetMs = avInputClamp(n, AV_INPUT_OFFSET_MIN, AV_INPUT_OFFSET_MAX);
    return avInput.offsetMs;
  } catch (e) { return avInput.offsetMs; }
}
function avInputMonitor(on) {
  try {
    const want = !!on;
    if (!avInput.enabled || !avInput.gainNode || !avInput.ctx) return false;
    if (want === avInput.monitor) return true;         /* idempotent toggle */
    let master = null;
    try { if (typeof avMasterFor === "function") master = avMasterFor(avInput.ctx); } catch (e) { master = null; }
    if (want) {
      if (!master || typeof master.connect !== "function") return false;   /* honest: no master tap */
      avInput.monitor = true;                          /* track before wire */
      try { avInput.gainNode.connect(master); }
      catch (e2) { avInput.monitor = false; return false; }
      return true;
    }
    avInput.monitor = false;                           /* track before unwire */
    if (master && typeof avInput.gainNode.disconnect === "function") {
      try { avInput.gainNode.disconnect(master); } catch (e3) { /* not connected — already off */ }
    }
    return true;
  } catch (e) { return false; }
}

/* ---------- latency / levels / devices ---------- */
function avInputLatency() {
  let baseMs = 0, sr = 48000;
  try {
    let ctx = avInput.ctx;
    if (!ctx) ctx = avInputPickCtx();
    if (ctx) {
      const bl = Number(ctx.baseLatency);
      if (isFinite(bl) && bl >= 0) baseMs = Math.round(bl * 1000000) / 1000;   /* s → ms, 0.001 ms grid */
      const s = Number(ctx.sampleRate);
      if (isFinite(s) && s > 0) sr = s;
    }
  } catch (e) { /* defaults: baseMs 0 (browsers that expose baseLatency report it), sr 48000 */ }
  const offsetMs = avInput.offsetMs;
  const totalMs = Math.max(0, baseMs + offsetMs);
  return { baseMs: baseMs, offsetMs: offsetMs, totalFrames: Math.round(totalMs * sr / 1000), sr: sr };
}

/* own analyser read — refreshed on every call; buffer allocates on size change only */
function avInputLevels() {
  try {
    const an = avInput.analyser;
    if (!an) return { peak: 0, rms: 0 };
    const n = (isFinite(an.fftSize) && an.fftSize > 0) ? an.fftSize : AV_INPUT_FFT;
    let buf = avInput.levelBuf;
    if (!buf || buf.length !== n) { buf = new Float32Array(n); avInput.levelBuf = buf; }
    let filled = false;
    try {
      if (typeof an.getFloatTimeDomainData === "function") { an.getFloatTimeDomainData(buf); filled = true; }
      else if (typeof an.getByteTimeDomainData === "function") {
        let bb = avInput.levelBytes;
        if (!bb || bb.length !== n) { bb = new Uint8Array(n); avInput.levelBytes = bb; }
        an.getByteTimeDomainData(bb);
        for (let i = 0; i < n; i++) buf[i] = (bb[i] - 128) / 128;
        filled = true;
      }
    } catch (e) { filled = false; }
    if (!filled) return { peak: 0, rms: 0 };
    let peak = 0, sum = 0;
    for (let i = 0; i < n; i++) {
      const v = buf[i];
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      sum += v * v;
    }
    return { peak: peak, rms: Math.sqrt(sum / n) };
  } catch (e) { return { peak: 0, rms: 0 }; }
}

function avInputDevices() {
  return new Promise((resolve) => {
    try {
      const md = avInputMediaDevices();
      if (!md || typeof md.enumerateDevices !== "function") { resolve([]); return; }
      let p = null;
      try { p = md.enumerateDevices(); } catch (e) { resolve([]); return; }
      if (!p || typeof p.then !== "function") { resolve([]); return; }
      p.then((list) => {
        const out = [];
        try {
          const arr = (list && typeof list.length === "number") ? list : [];
          for (let i = 0; i < arr.length; i++) {
            const d = arr[i];
            if (!d || d.kind !== "audioinput") continue;
            out.push({
              deviceId: d.deviceId == null ? "" : String(d.deviceId),
              label: typeof d.label === "string" ? d.label : "",
            });
          }
        } catch (e) { /* a partial list beats a rejection */ }
        resolve(out);
      }).catch(() => resolve([]));
    } catch (e) { resolve([]); }
  });
}

/* ---------- snapshots / misc ---------- */
function avInputState() {
  let sr = null, ctxState = null;
  try {
    if (avInput.ctx) {
      const s = Number(avInput.ctx.sampleRate);
      if (isFinite(s) && s > 0) sr = s;
      ctxState = avInput.ctx.state || null;
    }
  } catch (e) { /* stays null */ }
  return {
    version: AV_INPUT_VERSION,
    inited: avInput.inited === true,
    enabled: avInput.enabled === true,
    enabling: avInput.enabling === true,
    monitor: avInput.monitor === true,
    gain: avInput.gain,
    offsetMs: avInput.offsetMs,
    deviceId: avInput.deviceId,
    label: avInput.label,
    channels: avInput.channels,
    sr: sr,
    ctxState: ctxState,
    wired: !!(avInput.source && avInput.gainNode),
    sink: avInput.sinkOn === true,
    error: avInput.error,
  };
}
function avInputClasses() { return AV_INPUT_CLASSES.slice(); }
function avInputInit() {
  try {
    avInput.inited = true;                 /* page module: nothing mounted, nothing wired here */
    return true;
  } catch (e) { return false; }
}
function avInputNode() {
  try {
    if (avInput.enabled && avInput.gainNode && typeof avInput.gainNode.connect === "function") return avInput.gainNode;
  } catch (e) { /* no node */ }
  return null;
}

/* ---------- debug handle (guarded; functions + snapshots only — no live nodes leak) ---------- */
if (typeof window !== "undefined" && window) {
  try {
    window.__avInput = {
      version: AV_INPUT_VERSION,
      init: avInputInit,
      enable: avInputEnable,
      disable: avInputDisable,
      gain: avInputGain,
      monitor: avInputMonitor,
      offset: avInputOffset,
      latency: avInputLatency,
      levels: avInputLevels,
      devices: avInputDevices,
      state: avInputState,
      classes: avInputClasses,
      node: avInputNode,
    };
  } catch (e) { /* no window — nothing to publish */ }
}
