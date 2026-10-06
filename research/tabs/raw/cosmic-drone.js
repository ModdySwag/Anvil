// 2022/10/17
// by srtuss
ditty.bpm = 90;
input.radiation = .25; // min=0.1,max=.5,step=0.01
input.nebula = 0; // min=0,max=2,step=0.01

function synthharmonics(outp, harm, len, nh) {
    for(var j = 0; j < len; ++j) {
        outp[j] = 0;
    }
    var twopi = Math.PI * 2;
    for(var i = 0; i < nh; ++i) {
        var f = i + 1;
        var amp = harm[i];
        var phas = Math.random();
        for(var j = 0; j < len; ++j) {
            var x = j / len + phas;
            outp[j] += Math.sin(x * f * twopi) * amp;
        }
    }
}
function fract(x) {
    return x - Math.floor(x);
}

class MorphWave {
    constructor(len, nharm) {
        this.len = len;
        this.data = new Float32Array(len);
        this.nharm = Math.min(nharm || 512, len>>1);
        this.update();
    }
    update() {
        var nh = this.nharm;
        var harm = new Float32Array(nh);
        for(var i = 0; i < nh; ++i) {
            harm[i] = .3 * (1 + i)**-1 * Math.exp(-i * input.nebula);
        }
        for(var i = 0; i < nh; i += 1) {
            harm[i] *= Math.pow(Math.random(), 3);
        }
        synthharmonics(this.data, harm, this.len, nh);
    }
}

const syn = synth.def(
    class {
        constructor(opt) {
            this.nwtb = 1024;
            this.wtbs = [new MorphWave(this.nwtb, opt.nh), new MorphWave(this.nwtb, opt.nh)];
            for(var k = 0; k < 2; ++k) {
                this.wtbs[k].update();
            }
            this.ops = [];
            var nop = 8;
            for(var i = 0; i < nop; ++i) {
                this.ops.push({
                    t: Math.random(),
                    ff: 1 + Math.random() * .01,
                    p: i / (nop-1)});
            }
            this.morph = Math.random();
            this.shimmerc = 0;
            this.morphdt = .000005;
        }
        process(note, env, tick, options) {
            var suml = 0;
            var sumr = 0;
            var dt = midi_to_hz(note) * ditty.dt;
            this.morph += this.morphdt;
            if(this.morph >= 1) {
                this.morph -= 1;
                var t = this.wtbs[0]; this.wtbs[0] = this.wtbs[1]; this.wtbs[1] = t;
                this.wtbs[1].update();
            }
            var wtb0 = this.wtbs[0].data;
            var wtb1 = this.wtbs[1].data;
            var wtbm = this.morph;
            
            if(this.shimmerc >= 1) {
                this.shimmerc -= 1;
                for(var i = 0, ni = this.ops.length; i < ni; ++i) {
                    this.ops[i].ff = 2 ** ((Math.random() - .5) * input.radiation);
                }
            }
            this.shimmerc += 700 * ditty.dt;
            
            for(var i = 0, ni = this.ops.length; i < ni; ++i) {
                var op = this.ops[i];
                var idx = Math.floor(op.t * this.nwtb);
                var opv = wtb0[idx] * (1-wtbm) + wtb1[idx] * wtbm;
                suml += opv * op.p;
                sumr += opv * (1 - op.p);
                op.t += dt * op.ff;
                while(op.t >= 1) {
                    op.t -= 1;
                }
            }
            var m = (suml + sumr)*.5;
            var s = (suml - sumr)*.5;
            s *= 2;
            return [(m+s) * env.value, (m-s) * env.value];
        }
    });

loop(() => {
var k = [0, 2, -2, -4];
for(var i = 0; i < 3; ++i) {
    var o = k[i];
    var chord = [d4, c4, e4, b4];
    sine.play(c1+o, {duration: 16, attack: 5, release: 5, amp: .5});
    syn.play(c2+o, {duration: 16, attack: 5, release: 5, nh: 64});
    for(var j = 0; j < chord.length; ++j) {
        syn.play(chord[j]+o + [-12,0,0,0,7,12].choose(), {duration: 16, attack: 5+j, release: 5, nh: 32});
    }
    sleep(16);
}
}, {name: "pad"});