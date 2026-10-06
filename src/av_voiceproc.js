/* av_voiceproc.js -- Anvil P1 audio-worklet processor (contract: verify/_p1_wave.md section 5).
   This text is concatenated after av_dsp.js by build.py: one module, one processor, one
   registration. No page/global-scope reach-ins; timing runs through a guarded clock so the
   same source also loads in plain-scope rigs. Message protocol (both directions) is pinned:
   in  {t:'param', path, v} | {t:'note', on, midi, gain} | {t:'allOff'} |
       {t:'bench', cmd:'reset'|'read', id} | {t:'stats', id} | {t:'hello', id}
   out {t:'ready', sr, maxVoices, os, version} | {t:'bench', id, data} | {t:'stats', id, data} */
"use strict";

/* Clock guard + windowed bench sampling. Chromium does NOT expose performance.* inside
   AudioWorkletGlobalScope (probe-verified 2026-10-07 on this box: typeof performance ===
   "undefined" in the audio scope, while the main thread has it), so the worklet's clock is
   Date.now there - integer ms. Per-quantum ms reads would quantise the proof-benchmark ring to
   0/1000/2000 us; with an ms clock the processor instead records ONE sample per 32-quanta
   window (window us, frames = 32*128) - av_dsp.recordQuantum normalises to the per-128-frame
   equivalent, keeping ~31 us precision per sample. Where a us clock exists (performance.now in
   the audio scope, per browser), timing stays per-quantum as pinned by the contract. */
const AV_PROC_PERF = (typeof performance !== 'undefined' && typeof performance.now === 'function');
const NOW_US = AV_PROC_PERF
  ? () => performance.now() * 1000
  : () => Date.now() * 1000;
const AV_PROC_WINDOW = AV_PROC_PERF ? 1 : 32;   /* quanta per bench sample */

class AVVoiceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    AVDSP.buildTables();
    const mo = (options && options.processorOptions) || {};
    const mv = mo.maxVoices || 64;
    this.engine = AVDSP.create({ sampleRate: sampleRate, maxVoices: mv });
    this.win = 0;          /* bench-window state (ms-clock path only) */
    this.winT0 = 0;
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
    if (AV_PROC_WINDOW === 1) {
      /* us clock available in the audio scope: per-quantum sample, as pinned */
      const t0 = NOW_US();
      AVDSP.render(this.engine, l, r, l.length);
      AVDSP.recordQuantum(this.engine, NOW_US() - t0, l.length);
      return true;
    }
    /* ms clock (Chromium worklets): one timed window per AV_PROC_WINDOW quanta */
    if (this.win === 0) this.winT0 = NOW_US();
    AVDSP.render(this.engine, l, r, l.length);
    this.win += 1;
    if (this.win >= AV_PROC_WINDOW) {
      AVDSP.recordQuantum(this.engine, NOW_US() - this.winT0, this.win * 128);
      this.win = 0;
    }
    return true;
  }
}

registerProcessor('av-voice', AVVoiceProcessor);
