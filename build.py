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
"""
import hashlib
import pathlib
import subprocess as _sp

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / "src"
OUT = ROOT / "index.html"

head = (SRC / "head.html").read_text(encoding="utf-8")
css = (SRC / "styles.css").read_text(encoding="utf-8")
body = (SRC / "body.html").read_text(encoding="utf-8")

js_parts = [
    (SRC / "av_tap.js").read_text(encoding="utf-8"),    # LAW: the tap installs before any engine code
    (SRC / "av_knob.js").read_text(encoding="utf-8"),   # the knob feel engine, before the shell that mounts it
    (SRC / "av_note.js").read_text(encoding="utf-8"),   # the ONE note bus (dock + typing keys + MIDI route here)
    (SRC / "av_kb.js").read_text(encoding="utf-8"),     # the 61-key piano dock + the ONE keydown dispatcher
    (SRC / "av_midi.js").read_text(encoding="utf-8"),   # the Web MIDI deck
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
_proc = _sp.run(["node", "--check", str(_check_path)], capture_output=True, text=True)
assert _proc.returncode == 0, (
    "concatenated JS failed node --check (strict):\n" + _proc.stderr[-3000:]
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
