/* av_umod_wl.js -- Anvil S5 CODE section: the user-module runtime (top-level name AVUMOD).
   Contract: verify/_s5_wave.md section 2.B (audio-scope evidence: section 0).

   This ONE text rides two scopes:
   - the audio worklet module (build.py concatenates it before av_voiceproc): user module
     source is eval'd IN the worklet via new Function('API', ...) with everything it may see
     injected as arguments (probe 2026-10-08: new Function works in AudioWorkletGlobalScope;
     fetch/URL/performance/TextEncoder/structuredClone do not exist there - the sandbox is real).
   - the page bundle (the SPN tier calls AVUMOD.handle directly against the page-scope engine).
   It also parses+runs with AVDSP absent (node harness): every AVDSP touch is guarded.

   LAWS preserved:
   - strict mode; exactly ONE top-level name (AVUMOD); no DOM/window/document/location/fetch.
   - no allocation in per-sample paths: the registered guards wrap user functions with plain
     try/catch + counter ops; every wrapper is created ONCE at add time (message time).
   - no throw paths out: handle() NEVER throws; replies are {t:'umodok'|'umoderr'|'umodstat'}.
   - user code sees ONLY the injected frozen API object; no AVDSP handle, no engine surface
     beyond what stepVoice already receives.
   - user kinds live at ids 64..1023 (built-in kinds are 1..5); fx entries push
     {mod, st, wet: 1} onto eng.fx and follow the WET convention (the engine blends
     dry*(1-st.mix) + wet*st.mix).

   MESSAGE PROTOCOL (documented in docs/09-code-module-api.md):
   in  {t:'umod', act:'add', id, name, kind:'fx'|'kind', src}
       {t:'umod', act:'remove', id}
       {t:'umod', act:'list'}
   out {t:'umodok', id, kind, kindId, params, fxIndex?}          (kindId null for fx)
       {t:'umodok', id, kind, kindId, removed:true}              (remove ack)
       {t:'umoderr', id, error}
       {t:'umodstat', id, data:[{id,name,kind,kindId,params,poisoned,on,fxIndex}]}

   The runtime never throws out and touches the port only through guarded postMessage; a
   missing/dead port is tolerated silently (the add still lands). */
"use strict";

const AVUMOD = (function () {
  const VERSION = "s5.0";
  const API_VERSION = 1;
  const MAX_SRC = 65536;                            /* chars (the 64 KB module-source limit) */
  const MAX_PARAMS = 16;
  const KIND_BASE = 64;                             /* first user kind id */
  const KIND_TOP = 1023;                            /* last id the allocator scans */
  const POISON_LIMIT = 4;                           /* the 4th caught throw disables the module */
  const ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;          /* module id charset (contract pin) */
  const PARAM_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;  /* param names stay path-safe */

  /* ---- registry (add-time writes only; nothing here runs per sample) ---- */
  const ENTRIES = [];                       /* user modules in add order (fx + kind) */
  const BY_ID = Object.create(null);        /* id -> entry (open charset: null proto) */
  const KIND_BY_ID = [];                    /* kindId -> entry (sparse, >= KIND_BASE) */

  /* ---- small guarded helpers ---- */
  function errText(e) {
    try {
      if (e && (e.name || e.message)) {
        const nm = e.name ? String(e.name) : "";
        const ms = e.message ? String(e.message) : "";
        return nm && ms ? nm + ": " + ms : (nm || ms);
      }
      return String(e == null ? "unknown error" : e);
    } catch (e2) { return "unknown error"; }
  }
  function post(port, msg) {
    try {
      if (port && typeof port.postMessage === "function") { port.postMessage(msg); return true; }
    } catch (e) { /* port gone - the add still lands */ }
    return false;
  }
  function postErr(port, id, error) {
    post(port, { t: "umoderr", id: id, error: String(error == null ? "error" : error) });
    return false;
  }
  function fin(v) { return typeof v === "number" && isFinite(v); }
  function clampN(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function paramsDefObj(params) {
    const out = {};
    for (let i = 0; i < params.length; i++) out[params[i].name] = params[i].def;
    return out;
  }

  /* ---- the frozen API object injected into every user module ---- */
  function makeApi() {
    let blep = null;
    try { if (typeof AVDSP !== "undefined" && AVDSP && AVDSP.blep) blep = AVDSP.blep; } catch (e) { blep = null; }
    const api = {
      api: API_VERSION,
      VERSION: VERSION,
      TAU: Math.PI * 2,
      clamp: function (v, lo, hi) {
        const n = Number(v);
        if (!isFinite(n)) return 0;
        const l = Number(lo), h = Number(hi);
        if (!isFinite(l) || !isFinite(h) || h < l) return n;
        return clampN(n, l, h);
      },
      lerp: function (a, b, t) { return a + (b - a) * t; },
      sine: function (phase) {
        const p = Number(phase);
        return Math.sin((isFinite(p) ? p : 0) * Math.PI * 2);
      },
      blep: blep,   /* the AVDSP minBLEP residual surface when present, else null */
    };
    return Object.freeze(api);
  }

  /* the pinned eval shape: new Function('API', '"use strict";\n' + src) called with the API */
  function evalSrc(src) {
    const f = new Function("API", "\"use strict\";\n" + src);
    return f(makeApi());
  }

  /* ---- MOD validation (all checks refuse with an honest error string) ---- */
  function validateMod(mod, mid, kind, reqName) {
    if (!mod || typeof mod !== "object") return { ok: false, error: "module did not return an object" };
    if (mod.api === undefined || mod.api === null) return { ok: false, error: "missing api - every module declares api: 1" };
    const api = Number(mod.api);
    if (!fin(api) || api < 1) return { ok: false, error: "unsupported api " + String(mod.api) + " - this build speaks api 1" };
    if (api > 1) return { ok: false, error: "module api " + api + " - newer than this build (api 1)" };
    if (mod.kind !== undefined && mod.kind !== kind) return { ok: false, error: "module declares kind '" + String(mod.kind) + "' but was added as '" + kind + "'" };
    if (mod.id !== undefined && mod.id !== mid) return { ok: false, error: "module declares id '" + String(mod.id) + "' but was added as '" + mid + "'" };
    if (mod.kind === undefined) mod.kind = kind;
    if (mod.id === undefined) mod.id = mid;
    if (typeof mod.name !== "string" || !mod.name) mod.name = (typeof reqName === "string" && reqName) ? reqName : mid;
    return { ok: true, mod: mod };
  }

  function normParams(mod) {
    const raw = mod.params;
    if (raw === undefined || raw === null) return { ok: true, params: [] };
    if (!Array.isArray(raw)) return { ok: false, error: "params must be an array (at most 16 entries)" };
    if (raw.length > MAX_PARAMS) return { ok: false, error: "module declares " + raw.length + " params - the limit is 16" };
    const out = [];
    const seen = Object.create(null);
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      if (!p || typeof p !== "object") return { ok: false, error: "param " + i + " is not an object" };
      if (typeof p.name !== "string" || !PARAM_RE.test(p.name)) return { ok: false, error: "param " + i + " name must match /^[A-Za-z][A-Za-z0-9_]{0,31}$/" };
      if (seen[p.name]) return { ok: false, error: "duplicate param name '" + p.name + "'" };
      seen[p.name] = true;
      const mn = Number(p.min), mx = Number(p.max), df = Number(p.def);
      if (!fin(mn) || !fin(mx) || !fin(df)) return { ok: false, error: "param '" + p.name + "' min/max/def must be finite numbers" };
      if (!(mx > mn)) return { ok: false, error: "param '" + p.name + "' needs max > min" };
      const one = { name: p.name, min: mn, max: mx, def: clampN(df, mn, mx) };
      if (p.step !== undefined && p.step !== null) { const sp = Number(p.step); if (fin(sp) && sp > 0) one.step = sp; }
      if (typeof p.label === "string" && p.label) one.label = p.label;
      out.push(one);
    }
    return { ok: true, params: out };
  }

  /* ---- the registered guards (created ONCE per module, at add time) ----
     process/stepVoice/isVoiceDone: try/catch + poison counter; the 4th caught throw disables
     the module (fx: st.on = 0; kind: dead, so kindById returns null). Non-finite wet writes
     and stepVoice returns are sanitized to 0. setParam: false on throw (never counted, never
     disables - a bad param setter must not kill a running voice). isVoiceDone is guarded too:
     av_dsp calls it on the render path WITHOUT its own try/catch. */
  function wrapFx(entry) {
    const mod = entry.mod;
    const rawProcess = mod.process;
    const rawSet = mod.setParam;
    mod.process = function (st, inL, inR) {
      if (entry.dead === true) { st.on = 0; st.oL = 0; st.oR = 0; return; }
      try { rawProcess.call(mod, st, inL, inR); }
      catch (e) {
        entry.poison = entry.poison + 1;
        if (entry.poison >= POISON_LIMIT) { entry.dead = true; st.on = 0; }
      }
      const a = st.oL;
      if (!(typeof a === "number" && isFinite(a))) st.oL = 0;
      const b = st.oR;
      if (!(typeof b === "number" && isFinite(b))) st.oR = 0;
    };
    mod.setParam = function (st, path, value) {
      try { return rawSet.call(mod, st, path, value) === true; } catch (e) { return false; }
    };
  }
  function wrapKind(entry) {
    const mod = entry.mod;
    const rawStep = mod.stepVoice;
    const rawDone = mod.isVoiceDone;
    const rawSet = mod.setParam;
    mod.stepVoice = function (eng, v) {
      if (entry.dead === true) return 0;
      let y;
      try { y = rawStep.call(mod, eng, v); }
      catch (e) {
        entry.poison = entry.poison + 1;
        if (entry.poison >= POISON_LIMIT) entry.dead = true;
        return 0;
      }
      return (typeof y === "number" && isFinite(y)) ? y : 0;
    };
    mod.isVoiceDone = function (eng, v) {
      if (entry.dead === true) return true;   /* a dead kind must not hold voices hostage */
      try { return rawDone.call(mod, eng, v) === true; }
      catch (e) {
        entry.poison = entry.poison + 1;
        if (entry.poison >= POISON_LIMIT) entry.dead = true;
        return false;
      }
    };
    mod.setParam = function (eng, path, value) {
      try { return rawSet.call(mod, eng, path, value) === true; } catch (e) { return false; }
    };
  }

  /* ---- add: fx ---- */
  function addFx(eng, id, name, mod, params, port) {
    if (typeof mod.createState !== "function") return postErr(port, id, "fx modules need createState(cfg)");
    if (typeof mod.process !== "function") return postErr(port, id, "fx modules need process(st, inL, inR)");
    if (typeof mod.setParam !== "function") return postErr(port, id, "fx modules need setParam(st, path, v)");
    if (!eng.fx || typeof eng.fx.push !== "function") return postErr(port, id, "engine FX chain unavailable (eng.fx)");
    const sr = (typeof eng.sr === "number" && isFinite(eng.sr) && eng.sr > 0) ? eng.sr : 48000;
    let st = null;
    try { st = mod.createState({ sampleRate: sr }); } catch (e) { return postErr(port, id, "createState failed: " + errText(e)); }
    if (!st || typeof st !== "object") return postErr(port, id, "createState did not return a state object");
    const entry = { id: id, name: name, kind: "fx", mod: mod, st: st, kindId: null, eng: eng, fxIndex: -1, params: params, poison: 0, dead: false };
    mod.PREFIX = id;
    if (typeof mod.bindEngine === "function") {
      try { mod.bindEngine(st, eng); } catch (e) { return postErr(port, id, "bindEngine failed: " + errText(e)); }
    }
    wrapFx(entry);
    eng.fx.push({ mod: mod, st: st, wet: 1 });
    entry.fxIndex = eng.fx.length - 1;
    for (let i = 0; i < params.length; i++) {
      try { mod.setParam(st, "fx." + id + "." + params[i].name, params[i].def); } catch (e) { /* the wrapper never lets this escape */ }
    }
    /* st.on / st.mix enforcement (contract 2.B): declared params own the defaults */
    let onP = null, mixP = null;
    for (let i = 0; i < params.length; i++) {
      if (params[i].name === "on") onP = params[i];
      else if (params[i].name === "mix") mixP = params[i];
    }
    if (onP) st.on = (onP.def > 0.5) ? 1 : 0;
    else st.on = 1;
    if (mixP) st.mix = clampN(mixP.def, 0, 1);
    else st.mix = 1;
    BY_ID[id] = entry;
    ENTRIES.push(entry);
    return post(port, { t: "umodok", id: id, kind: "fx", kindId: null, params: paramsDefObj(params), fxIndex: entry.fxIndex });
  }

  /* ---- add: kind (the P2 kind contract, user ids >= 64) ---- */
  function addKind(eng, id, name, mod, params, port) {
    if (typeof mod.stepVoice !== "function") return postErr(port, id, "kind modules need stepVoice(eng, v)");
    if (typeof mod.isVoiceDone !== "function") return postErr(port, id, "kind modules need isVoiceDone(eng, v)");
    if (typeof mod.setParam !== "function") return postErr(port, id, "kind modules need setParam(eng, path, v)");
    if (!eng.voices || typeof eng.voices.length !== "number") return postErr(port, id, "engine voice pool unavailable (eng.voices)");
    let kindId = -1;
    for (let i = KIND_BASE; i <= KIND_TOP; i++) { if (!KIND_BY_ID[i]) { kindId = i; break; } }
    if (kindId < 0) return postErr(port, id, "no free user kind id (" + KIND_BASE + ".." + KIND_TOP + " all taken)");
    mod.PREFIX = id;
    const entry = { id: id, name: name, kind: "kind", mod: mod, st: null, kindId: kindId, eng: eng, fxIndex: null, params: params, poison: 0, dead: false };
    if (typeof mod.initEngineK === "function") {
      try { mod.initEngineK(eng.kext); } catch (e) { return postErr(port, id, "initEngineK failed: " + errText(e)); }
    }
    if (typeof mod.initVoiceK === "function") {
      for (let vi = 0; vi < eng.voices.length; vi++) {
        const vk = eng.voices[vi] && eng.voices[vi].k;
        if (!vk) continue;
        try { mod.initVoiceK(vk); } catch (e) { return postErr(port, id, "initVoiceK failed (voice " + vi + "): " + errText(e)); }
      }
    }
    wrapKind(entry);
    for (let i = 0; i < params.length; i++) {
      try { mod.setParam(eng, id + "." + params[i].name, params[i].def); } catch (e) { /* the wrapper never lets this escape */ }
    }
    KIND_BY_ID[kindId] = entry;
    BY_ID[id] = entry;
    ENTRIES.push(entry);
    return post(port, { t: "umodok", id: id, kind: "kind", kindId: kindId, params: paramsDefObj(params) });
  }

  /* ---- add dispatch ---- */
  function doAdd(eng, m, port) {
    const mid = (m && typeof m.id === "string") ? m.id : null;
    if (!eng || typeof eng !== "object") return postErr(port, mid, "no engine - add refused (engine handle is null)");
    if (mid === null || !ID_RE.test(mid)) return postErr(port, mid, "id must match /^[a-z][a-z0-9_-]{0,31}$/");
    const kind = (m.kind === "kind") ? "kind" : ((m.kind === "fx") ? "fx" : null);
    if (kind === null) return postErr(port, mid, "kind must be 'fx' or 'kind'");
    const src = (typeof m.src === "string") ? m.src : null;
    if (src === null || src.length === 0) return postErr(port, mid, "src must be a non-empty string");
    if (src.length > MAX_SRC) return postErr(port, mid, "src is " + src.length + " chars - the limit is 65536");
    if (BY_ID[mid]) return postErr(port, mid, "id '" + mid + "' is already loaded");
    const name = (typeof m.name === "string" && m.name) ? m.name : mid;
    let mod = null;
    try { mod = evalSrc(src); } catch (e) { return postErr(port, mid, "eval failed: " + errText(e)); }
    const v = validateMod(mod, mid, kind, name);
    if (!v.ok) return postErr(port, mid, v.error);
    const np = normParams(v.mod);
    if (!np.ok) return postErr(port, mid, np.error);
    if (kind === "fx") return addFx(eng, mid, v.mod.name, v.mod, np.params, port);
    return addKind(eng, mid, v.mod.name, v.mod, np.params, port);
  }

  /* ---- remove ---- */
  function removeEntry(entry) {
    if (entry.kind === "fx") {
      const fx = entry.eng && entry.eng.fx;
      if (fx && typeof fx.length === "number") {
        for (let i = 0; i < fx.length; i++) {
          if (fx[i] && fx[i].mod === entry.mod) { fx.splice(i, 1); break; }
        }
      }
    } else if (entry.kindId != null && KIND_BY_ID[entry.kindId] === entry) {
      KIND_BY_ID[entry.kindId] = null;
    }
    delete BY_ID[entry.id];
    for (let i = 0; i < ENTRIES.length; i++) {
      if (ENTRIES[i] === entry) { ENTRIES.splice(i, 1); break; }
    }
  }
  function doRemove(eng, m, port) {
    void eng;
    const id = (m && typeof m.id === "string") ? m.id : null;
    if (id === null) return postErr(port, null, "remove needs an id");
    const entry = BY_ID[id];
    if (!entry) return postErr(port, id, "unknown module id");
    const kind = entry.kind;
    const kindId = entry.kindId;
    removeEntry(entry);
    return post(port, { t: "umodok", id: id, kind: kind, kindId: (kindId == null ? null : kindId), removed: true });
  }

  /* ---- list ---- */
  function doList(eng, m, port) {
    const data = [];
    for (let i = 0; i < ENTRIES.length; i++) {
      const e = ENTRIES[i];
      if (eng && e.eng !== eng) continue;
      data.push({
        id: e.id, name: e.name, kind: e.kind, kindId: (e.kindId == null ? null : e.kindId),
        params: paramsDefObj(e.params), poisoned: e.dead === true,
        on: e.st ? (e.st.on === 0 ? 0 : 1) : (e.dead === true ? 0 : 1),
        fxIndex: (typeof e.fxIndex === "number" && e.fxIndex >= 0) ? e.fxIndex : null,
      });
    }
    return post(port, { t: "umodstat", id: (m && typeof m.id === "string") ? m.id : null, data: data });
  }

  /* ---- the pinned public surface ---- */
  function ids() {
    const out = [];
    for (let i = 0; i < ENTRIES.length; i++) out.push(ENTRIES[i].id);
    return out;
  }
  function kindById(id) {
    try {
      const i = Number(id);
      if (!isFinite(i) || i < KIND_BASE || i > KIND_TOP) return null;
      const e = KIND_BY_ID[Math.floor(i)];
      if (!e || e.dead === true) return null;
      return e.mod;
    } catch (e) { return null; }
  }
  function kindIdByName(name) {
    try {
      if (typeof name !== "string" || !name) return null;
      for (let i = 0; i < ENTRIES.length; i++) {
        const e = ENTRIES[i];
        if (e.kind !== "kind" || e.dead === true) continue;
        if (e.id === name || e.name === name) return e.kindId;
      }
      return null;
    } catch (e) { return null; }
  }
  function setKindParam(eng, path, value) {
    try {
      if (!eng || typeof path !== "string") return false;
      const dot = path.indexOf(".");
      if (dot <= 0) return false;
      const pre = path.slice(0, dot);
      const entry = BY_ID[pre];
      if (!entry || entry.kind !== "kind" || entry.eng !== eng) return false;
      return entry.mod.setParam(eng, path, value) === true;
    } catch (e) { return false; }
  }
  function reset(eng) {
    let n = 0;
    for (let i = ENTRIES.length - 1; i >= 0; i--) {
      const e = ENTRIES[i];
      if (eng && e.eng !== eng) continue;
      removeEntry(e);
      n++;
    }
    return n;
  }
  function handle(eng, m, port) {
    try {
      const act = (m && typeof m === "object") ? m.act : null;
      if (act === "add") { doAdd(eng, m, port); return; }
      if (act === "remove") { doRemove(eng, m, port); return; }
      if (act === "list") { doList(eng, m, port); return; }
      postErr(port, (m && typeof m.id === "string") ? m.id : null, "unknown act '" + String(act) + "'");
    } catch (e) {
      postErr(port, (m && typeof m.id === "string") ? m.id : null, "runtime: " + errText(e));
    }
  }

  return {
    version: VERSION,
    apiVersion: API_VERSION,
    ids: ids,
    kindById: kindById,
    kindIdByName: kindIdByName,
    setKindParam: setKindParam,
    handle: handle,
    reset: reset,
  };
})();
