function varsaw(p, formant) {
    let x = p%1;
    return (x - 0.5) * clamp01(formant*x*(1-x));
}

// If you want to play many notes at the same time with the same timbre,
// the best option is to use a single synth managing all notes at the same time.
// This avoids the overhead of individual synth management by the API.

const lushPad = synth.def((phase, env, tick, options) => {
    let notes = options.notes;
    let relfreqs = notes.map( (nn) => 2**((nn-options.note)/12) * options.detune);
    let phases = relfreqs.map((rf) => phase * rf);
    let vols = relfreqs.map( (rf) => 1/Math.sqrt(rf));
    let pans = relfreqs.map( (rf,i) => Math.sin(i + tick*Math.sqrt(6*rf)) );
    let vib = relfreqs.map( (rf,i) => 1 + 0.3*Math.cos(i + 12*tick*Math.sqrt(rf)) );
    let osc = phases.map( (p,i) => varsaw(p,30*env.value * vols[i] * vib[i]) * vols[i] * 0.1 * env.value);
    let osc2 = osc.map( (sig,i) => [sig * (1 - pans[i]), sig * (1 + pans[i])] );
    let sig = osc2.reduce( (a,b) => [a[0]+b[0],a[1]+b[1]], [0,0]);
    return sig;
}, {detune:1, notes:[]});

ditty.bpm = 60;

const mychords = [[c2,c3,g3,b3,d4,e4,a4],
                  [f2,c3,f3,g3,a3,d4,e4,b4], 
                  [e2,e3,a3,b3,c4,d4,g4],
                  [f2,c3,f3,b3,c4,d4,e4,a4],
                  [bb1,bb2,f3,a3,bb3,d4,f4,e5],
                  [ab1,ab2,eb3,ab3,c4,eb4,g4,d5],
                  [g2,f3,g3,a3,b3,c3,d4,e4]];

loop((i) => {
    lushPad.play(c4, {notes:mychords.ring(i), attack:5, decay:5, sustain:0.7, duration:10, release:3, detune:1});
    sleep(10);
}, {name:"🤖"});

loop((i) => {
    sleep(1);
    lushPad.play(c4, {notes:mychords.ring(i), attack:5, decay:5, sustain:0.7, duration:10, release:3, amp:0.8, detune:1.01});
    sleep(9);
}, {name:"🤖🤖"});

loop((i) => {
    if(i == 0) {
        sleep(3);
    }
    let octave = 12 * Math.floor(Math.random() * 3);
    sine.play(mychords.ring(Math.floor(i/33)).choose() + octave, {amp:0.1,attack:0.01, decay:0.5,sustain:0.5,duration:0.5,release:1, pan:Math.random()*2-1});
    sleep(Math.random()*0.5 + 0.05); // 0.3s on average, may drift after a few loops
}, {name:"✨"});
