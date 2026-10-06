// TB303-like synth.
// 2022/12/4, srtuss

// patterns are encoded as 4 values per step: note,rest,slide,accent (rests are not implemented)
var patterns = [
    [f3,1,1,0,f2,1,0,0,ds2,1,1,0,c2,1,0,0,f2,1,1,0,f3,1,1,0,f3,1,0,0,f3,1,0,0,f2,1,0,0,f3,1,1,0,c2,1,0,0,ds3,1,0,0,f3,1,1,0,c3,1,0,0,ds3,1,0,0,f3,1,0,0],
    [a3,1,1,1,a3,1,0,0,a3,1,0,0,a3,1,1,0,a2,1,0,0,a4,1,0,0,a3,1,1,0,a2,1,0,0,a3,1,0,1,a3,1,1,0,a2,1,0,0,c4,1,1,0,a2,1,0,0,c3,1,0,0,a2,1,0,0,a3,1,0,0],
    [c2,1,1,0,c3,1,0,0,c4,1,0,0,c3,1,0,0,c2,1,0,0,c4,1,1,0,c3,1,1,0,c3,1,0,0],
    [c3,1,1,1,c3,1,0,0,c4,1,0,0,c3,1,1,1,c4,1,0,0,c3,1,0,0,c4,1,1,0,c3,1,0,0]
];

const pblep = (t, dt) => {
    if(t < dt) {
        t /= dt;
        return t + t - t * t - 1;
    }
    else if (t > 1 - dt) {
        t = (t - 1) / dt;
        return t * t + t + t + 1;
    }
    return 0;
}

input.gate=.58; // min=.1,max=1,step=.02
input.tune=-18; // min=-24,max=24,step=.01
input.waveform=0;
input.cutoff=0.28;
input.resonance=0.6;
input.envmod=0;
input.decay=0;
input.overdrive=0;
input.pattern = 1; // min=0, max=3, step=1 (bad square, synthetic b*tch, chainsaw, flying)
input.echo = .8; // value=.8
ditty.bpm = 138;

class SVFilter {
    constructor() {
        this.lastLp = 0;
        this.lastHp = 0;
        this.lastBp = 0;
        this.kf = 0.1;
        this.kq = .1;
    }
    process(input) {
        var lp = this.lastLp + this.kf * this.lastBp;
        var hp = input - lp - this.kq * this.lastBp;
        var bp = this.lastBp + this.kf * hp;
        
        this.lastLp = lp;
        this.lastHp = hp;
        this.lastBp = bp;
        
        return lp;
    }
}

class SVFilter2 {
    constructor() {
        this.f = [new SVFilter(), new SVFilter()];
        this.lastLp = 0;
        this.kf = 0.1;
        this.kq = .3;
    }
    process(input) {
        this.f[0].kf = this.kf;
        this.f[0].kq = this.kq;
        this.f[1].kf = this.kf;
        this.f[1].kq = this.kq;
        this.f[0].process(input);
        this.f[1].process(this.f[0].lastLp);
        this.lastLp = this.f[1].lastLp;
        return this.lastLp;
    }
}

class Convol {
    constructor() {
        this.kernel = [0.013475, 0.097598, 0.235621, 0.306612, 0.235621, 0.097598, 0.013475];
        this.taps = new Float32Array(this.kernel.length);
    }
    process(v) {
        var n = this.kernel.length;
        var t = this.taps;
        for(var i = n-1; i > 0; --i)
            t[i] = t[i-1];
        t[0] = v;
        var o = 0;
        for(var i = 0; i < n; ++i)
            o += this.kernel[i] * t[i];
        return o;
    }
}

class TbVoice {
    constructor(opt) {
        this.ph = 0;
        this.dtph = .001;
        this.flt = new SVFilter2();
        this.tclk = 0;
        this.dtclk = ditty.bpm / 60 * 4 * ditty.dt;
        this.clkidx = 0;
        this.sqidx = 0;
        this.lastgate = 0;
        this.venv = 0;
        this.fenv = 0;
        this.slide = 0;
        this.note = 0;
        this.notecap = 0;
        this.att = 0;
        this.accent = 0;
        this.aenv = 0;
        this.us = new Convol();
        this.ds = new Convol();
    }
    seqstep() {
        var patdata = patterns[input.pattern];
        var pl = patdata.length>>2;
        this.sqidx %= pl;
        this.slide = patdata[this.sqidx*4+2];
        this.xslide = patdata[((this.sqidx+pl-1)%pl)*4+2];
        this.note = patdata[this.sqidx*4] + input.tune;
        this.accent = patdata[this.sqidx*4+3];
        this.sqidx++;
        this.sqidx %= pl;
    }
    process(note, env, tick, opt) {
        while(this.tclk >= 1) {
            this.tclk -= 1;
            this.seqstep();
        }
        var gate = this.tclk < input.gate || this.slide;
        this.tclk += this.dtclk;
        
        if(gate) {
            if(!this.lastgate) {
                this.fenv = 1;
                this.att = 0;
                this.aenv = this.accent;
            }
            this.venv = 1;
            this.att = Math.min(this.att+ditty.dt/.0005, 1);
        }
        this.lastgate = gate;
        
        if(this.xslide) {
            this.notecap += (this.note - this.notecap) * .0005;
        }
        else {
            this.notecap = this.note;
        }
        this.dtph = midi_to_hz(this.notecap) * ditty.dt;
        this.venv *= .995;
        this.fenv *= Math.exp(-(1-input.decay) * .004);
        
        var blep0 = pblep(this.ph, this.dtph);
        var saw = this.ph * 2 - 1 - blep0;
        var pw = Math.max(.5, input.waveform)*.95;
        var square = (this.ph > pw ? 1 : -1) + pblep((this.ph-pw+1)%1, this.dtph) - blep0;
        var v = lerp(saw, square, clamp01(input.waveform * 2));
        this.flt.kq = 1 - input.resonance * .9 - this.aenv * .1;
        this.flt.kf = 2 ** Math.min(0, input.cutoff * 7 - 7 + this.fenv * input.envmod * 5 + this.aenv * .4);
        this.flt.process(v);
        v = this.flt.process(v);
        this.ph += this.dtph;
        while(this.ph >= 1) {
            this.ph -= 1;
        }
        v = v * this.venv * this.att * (this.aenv + 1);
        this.aenv *= .9995;
        
        v *= .5;
        
        if(input.overdrive > 0) {
            var e = [0, 0, 0, 0];
            e[0] = this.us.process(v*4);
            e[1] = this.us.process(0);
            e[2] = this.us.process(0);
            e[3] = this.us.process(0);
            for(var i = 0; i < 4; ++i) {
                e[i] = clamp(e[i] * (1+input.overdrive*8), -1, 1);
            }
            this.ds.process(e[0]);
            this.ds.process(e[1]);
            this.ds.process(e[2]);
            v = this.ds.process(e[3]);
        }
        return v;
    }
}

class Delayline {
    constructor(n) {
        this.n = ~~n;
        this.p = 0;
        this.lastOutput = 0;
        this.data = new Float32Array(n);
    }
    clock(input) {
        this.lastOutput = this.data[this.p];
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

const stereoEcho = filter.def(class {
    constructor(options) {
        this.lastOutput = [0, 0];
        var time = 60 / ditty.bpm;
        //time *= 3 / 4;
        time /= 2;
        var n = Math.floor(time / ditty.dt);
        this.delay = [new Delayline(n), new Delayline(n)];
        this.dside = new Delayline(500);
        this.kfbl = .4;
        this.kfbr = .7;
    }
    process(inv, options) {
        this.dside.clock(inv[0]);
        var new0 = (this.dside.lastOutput + this.delay[1].lastOutput) * this.kfbl;
        var new1 =              (inv[1] + this.delay[0].lastOutput) * this.kfbr;
        this.lastOutput[0] = inv[0] + this.delay[0].lastOutput * input.echo;
        this.lastOutput[1] = inv[1] + this.delay[1].lastOutput * input.echo;
        this.delay[0].clock(new0);
        this.delay[1].clock(new1);
        return this.lastOutput;
    }
});

const tbvoice = synth.def(TbVoice);
loop( () => {
    tbvoice.play(c0, {duration:600, release:.1, amp: .25});
    sleep(600);
}, { name: 'acid' }).connect(stereoEcho.create());