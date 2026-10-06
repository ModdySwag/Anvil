#!/usr/bin/env python3
"""Anvil P1 — 2x polyphase half-band decimator: design + numeric verification.

Clean-room design by numerical optimisation (no third-party coefficient sets copied):
a 2-path allpass half-band  H(z) = 0.5 * (A(z^2) + z^-1 * B(z^2))
with each branch a cascade of first-order allpass sections  (a + z^-1)/(1 + a*z^-1),
run at the BASE rate on alternate input samples (the decimator form).

Verifies:
  1. analytic magnitude response (passband ripple, stopband attenuation, -3 dB point)
  2. power-complement symmetry  |H(w)|^2 + |H(pi-w)|^2 = 1
  3. the EXACT time-domain decimation algorithm vs the analytic H(w) (complex error)
     -> pins which branch gets which sample and the output combination form.
     Expected correct form ('sumB'): even sample -> branch A, odd sample -> branch B,
     y[n] = 0.5 * (aOut[n] + bOut[n-1])   (branch B delayed one BASE sample).
  4. decimation sim on real sinusoids: alias attenuation (stopband) + gain (passband)

Run:  uv run --no-project --with numpy --with scipy python research/engine/hb_design.py
Writes research/engine/hb-coeffs.json (ship set + HQ alternative).
"""
import json
import pathlib
import numpy as np

BASE_FS = 48000.0          # post-decimation rate (device rate at 48k)
INT_FS = 2 * BASE_FS       # internal 2x rate

# ---------------------------------------------------------------- model

def ap_cascade(coeffs, w):
    """Cascade of first-order allpasses (a + z^-1)/(1 + a z^-1) evaluated at z^-1 = w."""
    v = np.ones_like(w, dtype=complex)
    for a in coeffs:
        v = v * (a + w) / (1.0 + a * w)
    return v

def H_analytic(Omega, ca, cb):
    """Half-band response at internal-rate normalised frequency Omega (0..pi):
    H(z) = 0.5*(A(z^2) + z^-1*B(z^2)), z = e^{j Omega}."""
    w2 = np.exp(-2j * Omega)
    return 0.5 * (ap_cascade(ca, w2) + np.exp(-1j * Omega) * ap_cascade(cb, w2))

# ---------------------------------------------------------------- design

def design(na, nb, op_pi, os_pi, w_stop=120.0, iters=3, seed=7):
    """Least-squares design; op_pi/os_pi in units of pi (internal rate)."""
    from scipy.optimize import least_squares
    Om = np.linspace(0.0, np.pi, 8193)
    pb = Om <= op_pi * np.pi
    sb = Om >= os_pi * np.pi
    rng = np.random.default_rng(seed)
    best = None
    for it in range(iters):
        x0 = np.clip(0.9 * rng.random(na + nb), 0.01, 0.98)
        if it == 0:
            x0 = np.linspace(0.05, 0.9, na + nb)  # a deterministic first start
        def resid(p):
            ca, cb = p[:na], p[na:]
            m = np.abs(H_analytic(Om, ca, cb))
            return np.concatenate([(m[pb] - 1.0), w_stop * m[sb]])
        r = least_squares(resid, x0, bounds=(0.0, 0.999))
        m = np.abs(H_analytic(Om, r.x[:na], r.x[na:]))
        rip = 20 * np.log10(m[pb].max() / m[pb].min())
        att = -20 * np.log10(m[sb].max() + 1e-300)
        score = att - 2.0 * rip
        if best is None or score > best[0]:
            best = (score, r.x.copy(), rip, att)
    return best[1], best[2], best[3]

def summarize(ca, cb):
    """Full-curve stats for a coefficient set."""
    Om = np.linspace(0.0, np.pi, 65537)
    m = np.abs(H_analytic(Om, ca, cb))
    mdb = 20 * np.log10(np.maximum(m, 1e-300))
    i3 = np.argmax(mdb <= -3.0)
    f3 = Om[i3] / np.pi * (INT_FS / 2) if i3 else float("nan")
    pb = Om <= 0.45 * np.pi
    sb = Om >= 0.56 * np.pi
    mc = np.abs(H_analytic(np.pi - Om, ca, cb))
    pc = float(np.abs(m ** 2 + mc ** 2 - 1.0).max())
    return dict(ripple_db=20 * np.log10(m[pb].max() / m[pb].min()),
                stopband_db=-20 * np.log10(m[sb].max() + 1e-300), m3db_hz=f3,
                powercomp_err=pc, h0=float(m[0]), hpi=float(m[-1]))

# ---------------------------------------------------------------- exact decimation sim

def decimate(x, ca, cb, variant="sumB"):
    """The exact algorithm intended for JS (complex-safe sim).
    Even samples -> branch A, odd -> branch B; variants:
      'sumA': y = 0.5*(aOut[n] + bOut[n])        -- same-iteration pair
      'sumB': y = 0.5*(aOut[n] + bOut[n-1])      -- branch B one base-sample late (expected)
      'diff': y = 0.5*(aOut[n] - bOut[n])        -- sign test
    """
    sa = np.zeros(len(ca), dtype=complex)
    sb = np.zeros(len(cb), dtype=complex)
    n_out = len(x) // 2
    y = np.empty(n_out, dtype=complex)
    bprev = 0.0 + 0.0j
    for n in range(n_out):
        v = x[2 * n]
        for i, a in enumerate(ca):
            t = a * v + sa[i]; sa[i] = v - a * t; v = t
        va = v
        v = x[2 * n + 1]
        for i, b in enumerate(cb):
            t = b * v + sb[i]; sb[i] = v - b * t; v = t
        vb = v
        if variant == "sumA":
            y[n] = 0.5 * (va + vb)
        elif variant == "sumB":
            y[n] = 0.5 * (va + bprev)
        elif variant == "diff":
            y[n] = 0.5 * (va - vb)
        else:
            raise ValueError(variant)
        bprev = vb
    return y

def sim_complex_check(ca, cb):
    """Drive with complex exponentials; recover each variant's transfer function and
    compare with the analytic H(w). The matching variant must land < 1e-9."""
    Om_test = np.array([0.05, 0.15, 0.3, 0.5, 0.7, 0.9]) * np.pi
    results = {}
    for variant in ("sumA", "sumB", "diff"):
        errs = []
        for Om in Om_test:
            m = np.arange(0, 20000)
            x = np.exp(1j * Om * m)
            y = decimate(x, ca, cb, variant)
            # steady state: y[n] should be H(Om) * exp(j*Om*2n)
            ns = np.arange(2000, 4000)
            pred = H_analytic(np.array([Om]), ca, cb)[0] * np.exp(1j * Om * 2 * ns)
            errs.append(np.max(np.abs(y[ns] - pred)))    # absolute error, unit input
        results[variant] = max(errs)
        print(f"    variant {variant:5s}: max absolute error {results[variant]:.3e}")
    win = min(results, key=results.get)
    if results[win] > 1e-9:
        raise SystemExit(f"complex check FAILED: best variant {win} error {results[win]:.3e}")
    return win, results

def sim_sinusoid(f_hz, ca, cb, variant, secs=0.6):
    n = int(INT_FS * secs)
    m = np.arange(n)
    x = np.sin(2 * np.pi * (f_hz / INT_FS) * m)
    y = np.real(decimate(x, ca, cb, variant))
    y = y[len(y) // 2:]                     # drop the transient
    rms_r = np.sqrt(np.mean(y ** 2))
    rms_i = np.sqrt(np.mean(x[len(x) // 2:] ** 2))
    return 20 * np.log10(max(rms_r, 1e-300) / max(rms_i, 1e-300))

# ---------------------------------------------------------------- main

def main():
    print(f"half-band decimator design — base fs {BASE_FS/1000:.1f} kHz, internal {INT_FS/1000:.1f} kHz")
    print("search: config -> (sections A,B) x transition")
    cands = []
    for (na, nb) in ((3, 3), (4, 4)):
        for (op, os_) in ((0.44, 0.56), (0.45, 0.55), (0.46, 0.54)):
            p, rip, att = design(na, nb, op, os_)
            cands.append((na, nb, op, os_, p.copy(), rip, att))
            print(f"  ({na},{nb}) tr {op:.2f}-{os_:.2f}pi: ripple {rip:+.3f} dB, stopband {att:.1f} dB")

    # SHIP set: fewest sections among candidates meeting >= 65 dB; deepest stopband wins ties
    ok = [c for c in cands if c[6] >= 65.0 and c[5] < 0.6]
    if not ok:
        raise SystemExit("no candidate met gates — widen search")
    ok.sort(key=lambda c: (c[0] + c[1], -(c[6])))
    na, nb, op, os_, p, rip, att = ok[0]
    ca = [float(f"{v:.12g}") for v in p[:na]]
    cb = [float(f"{v:.12g}") for v in p[na:]]
    # HQ alternative: deepest stopband overall
    hq = sorted([c for c in cands if c[6] >= 65.0], key=lambda c: -(c[6]))[0]
    hqa = [float(f"{v:.12g}") for v in hq[4][:hq[0]]]
    hqb = [float(f"{v:.12g}") for v in hq[4][hq[0]:]]

    print(f"\nSHIP set: ({na},{nb}) sections, stopband {att:.1f} dB, ripple {rip:.4f} dB")
    print("A =", json.dumps(ca))
    print("B =", json.dumps(cb))
    print(f"HQ alt:  ({hq[0]},{hq[1]}) sections, stopband {hq[6]:.1f} dB")

    print("\nanalytic summary (ship set):")
    s = summarize(np.array(ca), np.array(cb))
    print(f"  ripple(0-0.45pi) {s['ripple_db']:+.4f} dB | stopband(0.56-1.0pi) {s['stopband_db']:.1f} dB | "
          f"-3dB @ {s['m3db_hz']/1000:.3f} kHz | power-comp err {s['powercomp_err']:.2e} | "
          f"H(0)={s['h0']:.12f} H(pi)={s['hpi']:.2e}")

    print("\ncomplex exponential check (analytic vs exact sim):")
    win, results = sim_complex_check(np.array(ca), np.array(cb))
    print(f"  -> matching variant: {win}")

    print("\nsinusoid decimation (level re output vs input, dB):")
    rows = {}
    for f, tag in ((100, "pass"), (1000, "pass"), (10000, "pass"), (20000, "pass"),
                   (23500, "edge"), (25000, "stop"), (30000, "stop"), (40000, "stop")):
        g = sim_sinusoid(f, np.array(ca), np.array(cb), win)
        rows[str(f)] = round(float(g), 2)
        print(f"    {f:6d} Hz [{tag:4s}] {g:+.2f} dB")

    out = dict(schema="anvil-hb-coeffs-v1", base_fs=BASE_FS, int_fs=INT_FS,
               sections=[na, nb], coeffsA=ca, coeffsB=cb,
               algorithm=win,
               algorithm_form="even->A, odd->B, y[n] = 0.5*(aOut[n] + bOut[n-1])",
               stopband_db=round(att, 1), ripple_db=round(float(rip), 4),
               m3db_khz=round(s["m3db_hz"] / 1000, 3),
               powercomp_err=s["powercomp_err"], sinusoid_db=rows,
               hq=dict(sections=[hq[0], hq[1]], coeffsA=hqa, coeffsB=hqb, stopband_db=round(hq[6], 1)),
               method="clean-room least-squares design + complex/tone verification (this script)")
    dest = pathlib.Path(__file__).parent / "hb-coeffs.json"
    dest.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(f"\nwrote {dest}")
    print(json.dumps(out, indent=1))

if __name__ == "__main__":
    main()
