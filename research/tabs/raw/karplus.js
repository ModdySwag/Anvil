// Forked from "Karplus-Strong string synthesis" by athibaul
// https://dittytoy.net/ditty/0c920dd635
// I thought about writing a Karplus Ditty but athibaul has alreay done a very nice one.
// Reverb effect implementated as Ditty filter. Adds nice stereo ambiance.

class Delayline {
    constructor(n) {
        this.n = ~~n;
        this.p = 0;
        this.lastOut = 0;
        this.data = new Float32Array(n);
    }
    clock(input) {
        this.lastOut = this.data[this.p];
        this.data[this.p] = input;
        if(++this.p >= this.n) {
            this.p = 0;
        }
    }
    tap(offset) {
        var x = this.p - offset - 1;
        x %= this.n;
        if(x < 0) {
            x += this.n;
        }
        return this.data[x];
    }
}

function allpass(delayline, x, k) {
    var delayin = x - delayline.lastOut * k;
    var y = delayline.lastOut + k * delayin;
    delayline.clock(delayin);
    return y;
}

// Simple allpass reverberator, based on this article:
// http://www.spinsemi.com/knowledge_base/effects.html
const reverb = filter.def(class {
    constructor(options) {
        this.lastReturn = 0;
        this.krt = .7;
        this.delaylines = [];
        // Create several delay lines with random lengths
        for(var i = 0; i < 12; ++i) {
            this.delaylines.push(new Delayline(10 + Math.floor(Math.random() * 5000)));
        }
    }
    process(input, options) {
        var inv = input[0] + input[1];
        var v = this.lastReturn;
        // Let the signal pass through the loop of delay lines. Inject input signal at multiple locations.
        v = allpass(this.delaylines[0], v + inv, .5);
        v = allpass(this.delaylines[1], v, .5);
        this.delaylines[2].clock(v);
        v = this.delaylines[2].lastOut * this.krt;
        v = allpass(this.delaylines[3], v + inv, .5);
        v = allpass(this.delaylines[4], v, .5);
        this.delaylines[5].clock(v);
        v = this.delaylines[5].lastOut * this.krt;
        v = allpass(this.delaylines[6], v + inv, .5);
        v = allpass(this.delaylines[7], v, .5);
        this.delaylines[8].clock(v);
        v = this.delaylines[8].lastOut * this.krt;
        v = allpass(this.delaylines[9], v + inv, .5);
        v = allpass(this.delaylines[10], v, .5);
        this.delaylines[11].clock(v);
        v = this.delaylines[11].lastOut * this.krt;
        this.lastReturn = v;
        // Tap the delay lines at randomized locations and accumulate the output signal.
        var ret = [0, 0];
        ret[0] += this.delaylines[2].tap(111);
        ret[1] += this.delaylines[2].tap(2250);
        ret[0] += this.delaylines[5].tap(311);
        ret[1] += this.delaylines[5].tap(1150);
        ret[0] += this.delaylines[8].tap(511);
        ret[1] += this.delaylines[8].tap(50);
        ret[0] += this.delaylines[11].tap(4411);
        ret[1] += this.delaylines[11].tap(540);
        // Mix wet + dry signal.
        ret[0] = ret[0] * .1 + input[0];
        ret[1] = ret[1] * .1 + input[1];
        // Slight stereo widening:
        var m = (ret[0] + ret[1]) * .5;
        var s = (ret[1] - ret[0]) * .5;
        ret[0] = m + s * 1.5;
        ret[1] = m - s * 1.5;
        return ret;
    }
});

// Karplus-Strong plucked string synthesis

// The string is represented by a delay line, with linear interpolation for fractional delay, 
// and a first-order lowpass filter, which feeds back into the delay line.
// Each note is initialized with a short burst of noise.

const ks = synth.def(class {
    constructor(options) {
        let freq = midi_to_hz(options.note);
        let delay_samples = 1 / (freq * ditty.dt); // Duration of one period in samples
        this.len = Math.floor(delay_samples) + 1; // buffer size
        this.fd = delay_samples % 1; // fractional delay to interpolate between samples
        this.buf = new Float32Array(this.len); // buffer used to create a delay
        this.pos = 0; // current position of the reading/writing head
        this.a1 = clamp01(2 * Math.PI * options.cutoff * ditty.dt); // Lowpass filter the reinjection
        this.s0 = 0; // Signal value history for the lowpass filter
        let offs = Math.floor(this.len * (0.2 + 0.2*Math.random())); // the offset determines the plucking position
        
        // Initialize part of the buffer with noise
        for(let i=0; i < 70 && i < this.len; i++){
            this.buf[i] = Math.random();
            // The following line introduces "comb filtering" in the filter input, for more interesting results
            this.buf[(i+offs)%this.len] += -this.buf[i];
        }
    }
    process(note, env, tick, options) {
        let pos = this.pos;
        let value = lerp(this.buf[pos],
                         this.buf[(pos+1)%this.len],
                         this.fd); // linear interpolation for the fractional delay
        // Nonlinearity (optional)
        // value /= 1 + Math.max(value,0);
        this.s0 += this.a1 * (value - this.s0); // lowpass filter
        this.buf[pos] = lerp(value, this.s0, options.lowpass_amt);
        this.pos = (pos+1)%this.len;
        return this.s0 * env.value; // The natural decay is a bit slow, so we still apply an envelope
    }
}, {env:adsr, release:2.75, cutoff:2500, lowpass_amt:0.1});


ditty.bpm = 80;
loop( () => {
    // Adapted from Bach's Cello Suite No. 1 in G Major BWV 1007
    let notes = [d3,a3,fs4,e4,fs4,a3,fs4,a3,
                 d3,a3,fs4,e4,fs4,a3,fs4,a3,
                 d3,b3,g4,fs4,g4,b3,g4,b3,
                 d3,b3,g4,fs4,g4,b3,g4,b3,
                 d3,cs4,g4,fs4,g4,cs4,g4,cs4,
                 d3,cs4,g4,fs4,g4,cs4,g4,cs4,
                 d3,b3,fs4,e4,fs4,d4,cs4,d4,
                 b3,d4,cs4,d4,fs3,a3,gs3,fs3,
                 gs3,d4,e4,d4,e4,d4,e4,d4,
                 gs3,d4,e4,d4,e4,d4,e4,d4,
                 cs4,e4,a4,gs4,a4,e4,d4,e4,
                 cs4,e4,d4,e4,a3,cs4,b3,a3,
                 b2,fs3,d4,cs4,d4,fs3,d4,fs3,
                 b2,fs3,d4,cs4,d4,fs3,d4,fs3,
                 b2,gs3,a3,b3,a3,gs3,fs3,e3,
                 d4,cs4,b3,a4,gs4,fs4,e4,d4,
                 a2,b3,cs4,a4,e4,a4,cs4,e4,
                 g4,b3,cs4,e4,g4,e4,cs4,a3,
                 ];
    for(let i = 0; i<notes.length; i++) {
        ks.play(notes[i] + Math.random() * 0.01, {amp:(Math.random() + 0.5 + (i%8==0?0.8:0)) * .5, pan:0.5 * (2*((notes[i]*0.618)%1)-1)});
        sleep(0.25+0.02*Math.random());
    }
}, {name:"harp", amp:0.5}).connect(reverb.create());

