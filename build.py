#!/usr/bin/env python3
"""Anvil — assemble the single-file index.html from src/ parts.

Copyright (C) 2026 Modtech (a.k.a. Moddy) <modtech@gmail.com>
Home: https://moddys.net/ (Anvil) · GitHub: https://github.com/ModdySwag
Released under the GNU AGPL-3.0-or-later — see LICENSE.

Ported from the Pattern Forge build.py discipline:
- explicit js_parts order list (an unlisted file silently never ships otherwise)
- '</script' guard + strict-mode `node --check` parser guard (catches duplicate
  top-level declarations across concatenated parts — a silent boot-killer in sloppy mode)
- sha256 + byte count printed as the release identity
- P1: the AudioWorklet module source (av_ladder + av_dsp + av_acid + av_string + av_drum + av_voiceproc) is embedded as a JS string
  (AV_WORKLET_SRC + AV_WORKLET_SHA) and `node --check`ed standalone before it can ship
"""
import hashlib
import json
import pathlib
import subprocess as _sp

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / "src"
OUT = ROOT / "index.html"

head = (SRC / "head.html").read_text(encoding="utf-8")
css = (SRC / "styles.css").read_text(encoding="utf-8")
body = (SRC / "body.html").read_text(encoding="utf-8")

# ---- the worklet module source (P2: av_ladder + av_dsp + av_acid + av_string + av_drum + av_voiceproc) ----
# blob:/data: addModule cannot fetch extra files from a file:// page, so the single-file build
# carries the module source itself; the same av_dsp.js also ships as a normal part (SPN tier).
_lad_src = (SRC / "av_ladder.js").read_text(encoding="utf-8")
_dsp_src = (SRC / "av_dsp.js").read_text(encoding="utf-8")
_acid_src = (SRC / "av_acid.js").read_text(encoding="utf-8")
_str_src = (SRC / "av_string.js").read_text(encoding="utf-8")
_drum_src = (SRC / "av_drum.js").read_text(encoding="utf-8")
_proc_src = (SRC / "av_voiceproc.js").read_text(encoding="utf-8")
_worklet_src = _lad_src + "\n" + _dsp_src + "\n" + _acid_src + "\n" + _str_src + "\n" + _drum_src + "\n" + _proc_src
assert "registerProcessor('av-voice'" in _worklet_src, "worklet source must register 'av-voice'"
assert "AVACID" in _worklet_src and "AVSTRING" in _worklet_src and "AVDRUM" in _worklet_src, "P2 kind modules missing from the worklet source"
_wcheck = ROOT / "verify" / "_worklet_check.mjs"
_wcheck.parent.mkdir(exist_ok=True)
with open(_wcheck, "w", encoding="utf-8", newline="\n") as _f:
    _f.write(_worklet_src + "\n")
_proc = _sp.run(["node", "--check", str(_wcheck)], capture_output=True, text=True)
_wcheck.unlink(missing_ok=True)
assert _proc.returncode == 0, "worklet source failed node --check:\n" + _proc.stderr[-3000:]
_wsha = hashlib.sha256(_worklet_src.encode("utf-8")).hexdigest()
# '<' escaped so the HTML parser can never see '</script' inside the embedded string
_worklet_part = (
    "/* Anvil worklet module — src/av_ladder + av_dsp + av_acid + av_string + av_drum + av_voiceproc · sha256 " + _wsha + " */\n"
    "const AV_WORKLET_SHA = \"" + _wsha + "\";\n"
    "const AV_WORKLET_SRC = " + json.dumps(_worklet_src).replace("<", "\\u003c") + ";\n"
)

js_parts = [
    (SRC / "av_tap.js").read_text(encoding="utf-8"),    # LAW: the tap installs before any engine code
    (SRC / "av_knob.js").read_text(encoding="utf-8"),   # the knob feel engine, before the shell that mounts it
    (SRC / "av_note.js").read_text(encoding="utf-8"),   # the ONE note bus (dock + typing keys + MIDI route here)
    (SRC / "av_kb.js").read_text(encoding="utf-8"),     # the 61-key piano dock + the ONE keydown dispatcher
    (SRC / "av_midi.js").read_text(encoding="utf-8"),   # the Web MIDI deck
    (SRC / "av_ladder.js").read_text(encoding="utf-8"), # P2: Moog-ladder kernel (av_dsp ladder24 mode)
    (SRC / "av_dsp.js").read_text(encoding="utf-8"),    # P1 kernels + voice engine (the SPN tier runs this directly)
    (SRC / "av_acid.js").read_text(encoding="utf-8"),   # P2 kind 1: ACID engine (self-registers)
    (SRC / "av_string.js").read_text(encoding="utf-8"), # P2 kind 2: STRING engine (self-registers)
    (SRC / "av_drum.js").read_text(encoding="utf-8"),   # P2 kind 3: DRUM engine (self-registers)
    _worklet_part,                                      # AV_WORKLET_SRC + AV_WORKLET_SHA (generated above)
    (SRC / "av_rec.js").read_text(encoding="utf-8"),    # P2 recorder core (page module)
    (SRC / "av_sample.js").read_text(encoding="utf-8"), # P2 sample core (page module)
    (SRC / "av_pads.js").read_text(encoding="utf-8"),   # P2 drum pads (page module)
    (SRC / "av_engine.js").read_text(encoding="utf-8"), # the facade: blob→data→spn tier ladder + message protocol
    (SRC / "av_synth.js").read_text(encoding="utf-8"),  # the SYNTH card (P2 engine layer)
    (SRC / "app_core.js").read_text(encoding="utf-8"),  # boots last: wire, mount, report
]

BANNER = (
    "/* Anvil — a MODDYS Foundry instrument (single-file web app)\n"
    "   Copyright (C) 2026 Modtech (a.k.a. Moddy) <modtech@gmail.com>\n"
    "   GitHub: https://github.com/ModdySwag · Licence: GNU AGPL-3.0-or-later — see LICENSE. */\n"
)
js = BANNER + "\n" + "\n\n".join(js_parts)

assert "</script" not in js, "app JS must not contain </script"

_check_path = ROOT / "verify" / "_build_check.mjs"
_check_path.parent.mkdir(exist_ok=True)
with open(_check_path, "w", encoding="utf-8", newline="\n") as _f:
    _f.write('"use strict";\n' + js + "\n")
_bproc = _sp.run(["node", "--check", str(_check_path)], capture_output=True, text=True)
assert _bproc.returncode == 0, (
    "concatenated JS failed node --check (strict):\n" + _bproc.stderr[-3000:]
)
_check_path.unlink(missing_ok=True)

STYLE_TOKEN = '<style id="AV_STYLE">\n</style>'
JS_TOKEN = '<script id="AV_JS">\n</script>'
assert STYLE_TOKEN in head, "style token missing in head.html"
assert JS_TOKEN in body, "script token missing in body.html"

head = head.replace(STYLE_TOKEN, "<style>\n" + css + "\n</style>")
body = body.replace(JS_TOKEN, '<script id="AV_JS">\n' + js + "\n</script>")

html = head + "\n" + body
OUT.write_text(html, encoding="utf-8", newline="\n")

size = OUT.stat().st_size
sha = hashlib.sha256(html.encode("utf-8")).hexdigest()
print(f"built {OUT}  ({size:,} bytes)")
print(f"sha256 {sha}")
