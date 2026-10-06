// WIP
// Basic elements of a beat/bassline as commonly found in (modern) techno.

function processSVF(s, input, a1, a2, a3, k) {
    var v1, v2, v3;
    v3 = input - s.ic2eq;
    v1 = a1 * s.ic1eq + a2 * v3;
    v2 = s.ic2eq + a2 * s.ic1eq + a3 * v3;
    s.ic1eq = 2 * v1 - s.ic1eq;
    s.ic2eq = 2 * v2 - s.ic2eq;
    s.lp = v2;
    s.bp = v1;
    s.hp = input - k * v1 - v2;
    s.ap = s.lp + s.hp - k * s.bp;
}

// State Variable Filter based on an article by cytomic Sound Music Software
// https://cytomic.com/files/dsp/SvfLinearTrapOptimised2.pdf
class SVF {
    constructor(opt)
    {
        this.stages = [];
        this.mode = opt ? opt.mode || 'lp' : 'lp';
        this.fc = 0;
        this.q = 1;
        this.num = opt ? opt.num || 1 : 1;
        // g parameter determines cutoff
        // k parameter = 1/Q
        for(var i = 0; i < this.num; ++i) {
            this.stages.push({lp:0, bp:0, hp:0, ap:0, ic1eq:0, ic2eq:0});
        }

        this.q = opt && isFinite(opt.q) ? opt.q : 1;
        this.fc = opt && isFinite(opt.fc) ? opt.fc : .25;
    }
    process(input)
    {
        if(this.fc != this._fc) {
            this._fc = this.fc;
            this._q = this.q;
            var fc = this.fc * .5;
            if (fc >= 0 && fc < .5) {
                this.g = Math.tan(Math.PI * fc);
                this.k = 1 / this.q;
                this.a1 = 1 / (1 + this.g * (this.g + this.k));
                this.a2 = this.g * this.a1;
                this.a3 = this.g * this.a2;
            }
        }
        if(this.q != this._q) {
            this._q = this.q;

            this.k = 1 / this.q;
            this.a1 = 1 / (1 + this.g * (this.g + this.k));
            this.a2 = this.g * this.a1;
            this.a3 = this.g * this.a2;
        }

        for(var i = 0; i < this.num; ++i) {
            processSVF(this.stages[i], input, this.a1, this.a2, this.a3, this.k);
            processSVF(this.stages[i], input, this.a1, this.a2, this.a3, this.k);
            input = this.stages[i][this.mode];
        }
        return input;
    }
}

input.compressorThreshold = -15; // min=-30, max=0, step=0.1
input.compressorGain = 4; // min=1, max=4, step=0.1
input.compressorEn = 1; // min=0, max=1, step=1 (off, on)

const dB2gain = v => 10 ** (v / 20);
const gain2dB = v => Math.log10(v) * 20;
const compressor = filter.def(class Compressor {
    constructor(opt) {
        this.gain = 1;
        this.threshold = -40; // PARAM min:-30 max:-1
        this.ratio = .9; // PARAM
        this.peak = 0.01;
        this.active = 1; // PARAM
    }
    process(inv, opt) {
        this.threshold = input.compressorThreshold;
        this.gain = input.compressorGain;
        this.active = input.compressorEn;
        var inputLevel = Math.max(Math.abs(inv[0]), Math.abs(inv[1]));
        if(inputLevel > this.peak)
            this.peak = inputLevel;
        else
            this.peak *= .9999;
        
        inputLevel = gain2dB(this.peak);
        var compression = Math.max(0, inputLevel - this.threshold);

        var dgain = compression ? dB2gain(-compression * this.ratio) : 1;
        dgain *= this.gain;
        
        if(this.active > .5)
            return [inv[0] * dgain, inv[1] * dgain];
        else
            return inv;
    }
}).createShared();

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
        return this.lastOut;
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

// Simple allpass reverberator, based on this article by Spin Semiconductor:
// http://www.spinsemi.com/knowledge_base/effects.html
const reverb = filter.def(class {
    constructor(opt) {
        this.lastReturn = 0;
        this.krt = .5;
        this.delaylines = [];
        this.flt = new SVF({fc:.02, q:.5, num:1});
        this.pred = new Delayline(60 * .425 / ditty.bpm / ditty.dt);
        // Create several delay lines with random lengths
        for(var i = 0; i < 12; ++i) {
            this.delaylines.push(new Delayline(10 + Math.floor(Math.random() * 2441)));
        }
        this.wet = opt.wet || .04;
    }
    process(input, opt) {
        var inv = input[0];
        if(opt.dist) {
            inv = clamp(inv*opt.dist,-1,1)
        }
        inv = this.flt.process(this.pred.clock(inv));
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
        ret[0] = ret[0] * this.wet + input[0];
        ret[1] = ret[1] * this.wet + input[1];
        return ret;
    }
});


//input.ws0 = 0.5;
input.kickWs1 = 0.58;
input.kickWsAsym = 0.52;
//const wf1 = x => x > input.ws0 ? (x > input.ws1 ? input.ws0+input.ws1 - x : input.ws0) : x;
const fold01 = (x, a) => x > a ? a-(x-a) : x;
const fold11 = (x, a) => x > 0 ? fold01(x,a) : -fold01(-x,a);

const bd = synth.def(class {
    constructor(opt) {
        this.t = 0;
        this.p = 0;
        this.svf = new SVF({num:2});
        this.svfw = new SVF({num:1, fc:.03, q: 2, mode:'bp'});
    }
    process(note, env, tick, opt) {
        var v = Math.sin(this.p * Math.PI * 2);
        this.p += lerp(700, midi_to_hz(note), clamp01(this.t * 50) ** .25) * ditty.dt;
        this.t += ditty.dt;
        var nse = (Math.random() - .5) * 2;
        this.svf.fc = lerp(350, 200, clamp01(this.t * 10)) * ditty.dt;
        v += this.svf.process(nse);
        v += this.svfw.process(Math.random()) * Math.exp(this.t * -20) * .5;
        v += (Math.random()) * Math.exp(this.t * -80) * .4;
        return fold11((v+input.kickWsAsym-.5) * env.value, input.kickWs1);
        return v*env.value;
    }
}, {duration: .02, release: .6, attack: .0001});

const perc = synth.def(class {
    constructor(opt) {
        this.t = 0;
        this.p = 0;
        this.amtBody = opt.amtBody||0;
        this.amtBurst = .4;
        this.fDrop = 200;
        this.fcEnv = opt.fcEnv||500;
        this.fcBase = opt.fcBase||3000 + (opt.filter||0) * 2000;
        this.fcEnvSpeed = opt.fcEnvSpeed||100;
        this.svfl = new SVF({num:2, q: opt.q||1, mode:opt.mode||'bp'});
        this.svfr = new SVF({num:2, q: opt.q||1, mode:opt.mode||'bp'});
    }
    process(note, env, tick, opt) {
        var v = Math.sin(this.p * Math.PI * 2) * this.amtBody;
        this.p += (midi_to_hz(note) + this.fDrop * clamp01(1 - this.t * 50)) * ditty.dt;
        this.t += ditty.dt;
        this.svfr.fc = this.svfl.fc = lerp(this.fcBase+this.fcEnv, this.fcBase, clamp01(this.t * this.fcEnvSpeed)) * ditty.dt;
        var vl = v + this.svfl.process(Math.random() - .5);
        var vr = v + this.svfr.process(Math.random() - .5);
        vl += (Math.random()-.5) * Math.exp(this.t * -20) * this.amtBurst;
        vr += (Math.random()-.5) * Math.exp(this.t * -20) * this.amtBurst;
        var sidec = ditty.tick%1;
        vl *= sidec;
        vr *= sidec;
        return [vl * env.value, vr * env.value];
    }
}, {duration: .01, release: .1, attack: .0001});

const triangle = x => 1-Math.abs(1-x%2);
const signed = (x, l) => x > 0 ? l(x) : -l(-x);
const nonlin = x => Math.min(x - (clamp(x, .4, .6)-.4)*2, .6);

ditty.bpm = 138;

const distructor = filter.def(class {
    constructor(opt) {
        this.stages = [];
        for(var i = 0; i < 1; ++i) {
            this.stages.push({flt: new SVF({num: 2, mode: 'bp', fc: .008, q:2}), flt2:new SVF({num: 2, mode: 'bp', fc: .02, q:2})});
        }
    }
    process(inn, opt) {
        var stage = this.stages[0];
        var v = signed((inn[0]*input.ws0+input.ws1)*10, x=>nonlin(x)**.5);
        v = v+stage.flt.process(v)*.4+stage.flt2.process(v)*.8;
        v = signed((v*input.ws0+input.ws1), x=>nonlin(x)**.5);
        return [v, v];
    }
});

const post = filter.def(class {
   constructor(opt) {
       this.flt = [new SVF({mode:'hp', num:2}), new SVF({mode:'hp', num:2})];
   }
   process(inn, opt) {
       var x = ditty.tick%64;
       this.flt[0].fc = this.flt[1].fc = clamp01((16-x) * 2) * .006 * (1 + Math.max(0,x-8)*.1) + .0005;
       inn[0] = this.flt[0].process(inn[0]);
       inn[1] = this.flt[1].process(inn[1]);
       return inn;
   }
});

loop( () => {
    var r = [.3, .6].choose();
    var note = a1;
    for(var i = 0; i < 16; ++i) {
        bd.play(note, {release:r, amp: .4});
        sleep(.5);
        bd.play(note, {release:r, amp: .08, pan: -.2});
        sleep(.25);
        bd.play(note, {release:r, amp: .09, pan: .2});
        sleep(.25);
    }
}, { name: 'bd', amp: .6 }).connect(reverb.create({dist:5})).connect(post.create()).connect(compressor);


const series = (n, lambda) => {
    var r = []
    for(var i = 0; i < n; ++i)
        r.push(lambda(i));
    return r;
}

loop( () => {
    var series0 = series(16, x=>Math.random()**2);
    var series1 = series(16, x=>Math.random()**2);
    var series2 = series(16, x=>Math.random()**2);
    for(var k = 0; k < 16; ++k) {
        var swing = .04;
        for(var i = 0; i < 16; ++i) {
            var nr = i == 6 ? 2 : 1;
            var p = i;
            for(var j = 0; j < nr; ++j) {
                perc.play(g4, {filter: series0[p], duration:series1[p]*.2, amp:series2[p]*.5+.2, pan:(series2[p]*2-1)*.5, amtBody:.1});
                sleep((i&1?.25-swing:.25+swing)/nr);
            }
        }
    }
}, { name: 'perc', amp: .8 }).connect(reverb.create({wet:.2})).connect(post.create()).connect(compressor);

loop( () => {
    sleep(.5);
    perc.play(gs4, {ampBody:0, attack: .01, release:.15, mode:'hp', fcBase:4000, amp:.6});
    sleep(.5);
}, { name: 'hat' }).connect(reverb.create({wet:.2})).connect(post.create()).connect(compressor);

loop( () => {
    sleep(.5);
    perc.play(gs4, {duration: 1, ampBody:0, attack: .1, release:14, mode:'hp', fcBase:1, fcEnv:8000, fcEnvSpeed:.2 });
    sleep(16+15);
}, { name: 'noise', amp: .1 }).connect(reverb.create({wet:.2})).connect(post.create()).connect(compressor);