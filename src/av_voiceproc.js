/* av_voiceproc.js -- Anvil P1 audio-worklet processor (contract: verify/_p1_wave.md section 5).
   This text is concatenated after av_dsp.js by build.py: one module, one processor, one
   registration. No page/global-scope reach-ins; timing runs through a guarded clock so the
   same source also loads in plain-scope rigs. Message protocol (both directions) is pinned:
   in  {t:'param', path, v} | {t:'note', on, midi, gain} | {t:'allOff'} |
       {t:'bench', cmd:'reset'|'read', id} | {t:'stats', id} | {t:'hello', id} |
       {t:'sample', id, name, rate, ch1, ch2?} | {t:'zones', zones} | {t:'mod', macros, slots}
   out {t:'ready', sr, maxVoices, os, version} | {t:'bench', id, data} | {t:'stats', id, data} */
"use strict";

/* BENCH CLOCK (probe-verified 2026-10-07): Chromium does not expose performance.* inside
   AudioWorkletGlobalScope, so the worklet clock is Date.now (integer ms) here: per-quantum
   readings carry an ms lattice - the mean is ~unbiased over a hold; the tail is coarse below
   1 ms. A 32-quanta windowed variant was tried and REJECTED: a window spans the device-paced
   waiting between process() calls (a ~2.59 ms/quantum floor measured at ONE voice), so window
   spans measure pacing, not render cost. Publishable cost numbers come from the offline
   marginal-cost ramp (verify/cdp_bench.mjs); the live ring stays per-quantum. */
const NOW = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? () => performance.now() : () => Date.now();

class AVVoiceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    AVDSP.buildTables();
    const mo = (options && options.processorOptions) || {};
    const mv = mo.maxVoices || 64;
    this.engine = AVDSP.create({ sampleRate: sampleRate, maxVoices: mv });
    this.port.onmessage = (ev) => {
      const m = (ev && ev.data) ? ev.data : {};
      const eng = this.engine;
      if (m.t === 'param') { AVDSP.setParam(eng, m.path, m.v); return; }
      if (m.t === 'note') {
        if (m.on) AVDSP.noteOn(eng, m.midi, m.gain);
        else AVDSP.noteOff(eng, m.midi);
        return;
      }
      if (m.t === 'allOff') { AVDSP.allOff(eng); return; }
      /* P3: sample / zones / mod arrive as messages; allocation happens HERE, never in render */
      if (m.t === 'sample') { AVDSP.setSample(eng, m.id, m.name, m.rate, m.ch1, m.ch2); return; }
      if (m.t === 'zones') { AVDSP.setZones(eng, m.zones); return; }
      if (m.t === 'mod') { AVDSP.setMod(eng, m.macros, m.slots); return; }
      if (m.t === 'bench') {
        if (m.cmd === 'reset') AVDSP.benchReset(eng);
        else this.port.postMessage({ t: 'bench', id: m.id, data: AVDSP.benchRead(eng) });
        return;
      }
      if (m.t === 'stats') { this.port.postMessage({ t: 'stats', id: m.id, data: AVDSP.stats(eng) }); return; }
      if (m.t === 'hello') this.postReady();
    };
    this.postReady();
  }

  postReady() {
    this.port.postMessage({
      t: 'ready', sr: sampleRate, maxVoices: this.engine.maxVoices, os: 2, version: AVDSP.version,
    });
  }

  process(inputs, outputs, parameters) {
    const out0 = outputs[0];
    const l = out0[0];
    const r = out0[1];
    const t0 = NOW();
    AVDSP.render(this.engine, l, r, l.length);
    AVDSP.recordQuantum(this.engine, (NOW() - t0) * 1000, 128);
    return true;
  }
}

registerProcessor('av-voice', AVVoiceProcessor);
