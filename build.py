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
- P1/P2/P3: the AudioWorklet module source (av_ladder + av_dsp + av_acid + av_string + av_drum + av_grain + av_sampler + the five av_fx_* modules + av_voiceproc) is embedded as a JS string
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

# ---- the worklet module source (M2 joined: av_mpe + av_ladder + av_dsp + av_acid + av_string + av_drum + av_grain +
#      av_sampler + av_fx_verb + av_fx_delay + av_fx_mod + av_fx_drive + av_fx_dyn + av_fm + av_fx_aw + av_fx_conv + av_voiceproc) ----
# blob:/data: addModule cannot fetch extra files from a file:// page, so the single-file build
# carries the module source itself; the same av_dsp.js also ships as a normal part (SPN tier).
_lad_src = (SRC / "av_ladder.js").read_text(encoding="utf-8")
_mpe_src = (SRC / "av_mpe.js").read_text(encoding="utf-8")
_dsp_src = (SRC / "av_dsp.js").read_text(encoding="utf-8")
_acid_src = (SRC / "av_acid.js").read_text(encoding="utf-8")
_str_src = (SRC / "av_string.js").read_text(encoding="utf-8")
_drum_src = (SRC / "av_drum.js").read_text(encoding="utf-8")
_grain_src = (SRC / "av_grain.js").read_text(encoding="utf-8")
_samp_src = (SRC / "av_sampler.js").read_text(encoding="utf-8")
_fm_src = (SRC / "av_fm.js").read_text(encoding="utf-8")
_fxv_src = (SRC / "av_fx_verb.js").read_text(encoding="utf-8")
_fxd_src = (SRC / "av_fx_delay.js").read_text(encoding="utf-8")
_fxm_src = (SRC / "av_fx_mod.js").read_text(encoding="utf-8")
_fxdr_src = (SRC / "av_fx_drive.js").read_text(encoding="utf-8")
_fxdy_src = (SRC / "av_fx_dyn.js").read_text(encoding="utf-8")
_fxaw_src = (SRC / "av_fx_aw.js").read_text(encoding="utf-8")
_fxconv_src = (SRC / "av_fx_conv.js").read_text(encoding="utf-8")
_proc_src = (SRC / "av_voiceproc.js").read_text(encoding="utf-8")
_umod_src = (SRC / "av_umod_wl.js").read_text(encoding="utf-8")
_worklet_src = (_lad_src + "\n" + _mpe_src + "\n" + _dsp_src + "\n" + _acid_src + "\n" + _str_src + "\n" + _drum_src + "\n"
                + _grain_src + "\n" + _samp_src + "\n" + _fm_src + "\n" + _fxv_src + "\n" + _fxd_src + "\n"
                + _fxm_src + "\n" + _fxdr_src + "\n" + _fxdy_src + "\n" + _fxaw_src + "\n" + _fxconv_src + "\n"
                + _umod_src + "\n" + _proc_src)
assert "registerProcessor('av-voice'" in _worklet_src, "worklet source must register 'av-voice'"
assert ("AVACID" in _worklet_src and "AVSTRING" in _worklet_src and "AVDRUM" in _worklet_src
        and "AVGRAIN" in _worklet_src and "AVSAMPLER" in _worklet_src
        and "AVFXVERB" in _worklet_src and "AVFXDELAY" in _worklet_src and "AVFXMOD" in _worklet_src
        and "AVFXDRIVE" in _worklet_src and "AVFXDYN" in _worklet_src
        and "AVFM" in _worklet_src and "AVFXAW" in _worklet_src and "AVFXCONV" in _worklet_src
        and "AVUMOD" in _worklet_src and "AVM" in _worklet_src), "P3/M2 kind/FX modules missing from the worklet source"
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
    "/* Anvil worklet module — src/av_ladder + av_mpe + av_dsp + av_acid + av_string + av_drum + av_grain + av_sampler + av_fx_verb + av_fx_delay + av_fx_mod + av_fx_drive + av_fx_dyn + av_fm + av_fx_aw + av_fx_conv + av_voiceproc · sha256 " + _wsha + " */\n"
    "const AV_WORKLET_SHA = \"" + _wsha + "\";\n"
    "const AV_WORKLET_SRC = " + json.dumps(_worklet_src).replace("<", "\\u003c") + ";\n"
)

js_parts = [
    (SRC / "av_tap.js").read_text(encoding="utf-8"),    # LAW: the tap installs before any engine code
    (SRC / "av_knob.js").read_text(encoding="utf-8"),   # the knob feel engine, before the shell that mounts it
    (SRC / "av_note.js").read_text(encoding="utf-8"),   # the ONE note bus (dock + typing keys + MIDI route here)
    (SRC / "av_mpe.js").read_text(encoding="utf-8"),      # M2: MPE expression kernel (page + worklet concat)
    (SRC / "av_kb.js").read_text(encoding="utf-8"),     # the 61-key piano dock + the ONE keydown dispatcher
    (SRC / "av_kb_pop.js").read_text(encoding="utf-8"), # S5: the popout keyboard (bed adoption + key forwarding)
    (SRC / "av_midi.js").read_text(encoding="utf-8"),   # the Web MIDI deck
    (SRC / "av_mpe_deck.js").read_text(encoding="utf-8"), # M2: the deck MPE surface (member channel + panel row)
    (SRC / "av_ladder.js").read_text(encoding="utf-8"), # P2: Moog-ladder kernel (av_dsp ladder24 mode)
    (SRC / "av_dsp.js").read_text(encoding="utf-8"),    # P1 kernels + voice engine (the SPN tier runs this directly)
    (SRC / "av_umod_wl.js").read_text(encoding="utf-8"), # S5: user-module runtime (also embedded in the worklet concat)
    (SRC / "av_acid.js").read_text(encoding="utf-8"),   # P2 kind 1: ACID engine (self-registers)
    (SRC / "av_string.js").read_text(encoding="utf-8"), # P2 kind 2: STRING engine (self-registers)
    (SRC / "av_drum.js").read_text(encoding="utf-8"),   # P2 kind 3: DRUM engine (self-registers)
    (SRC / "av_grain.js").read_text(encoding="utf-8"),  # P3 kind 4: GRANULAR voice (self-registers)
    (SRC / "av_sampler.js").read_text(encoding="utf-8"),# P3 kind 5: SAMPLER voice (self-registers)
    (SRC / "av_fm.js").read_text(encoding="utf-8"),    # M1 kind 6: FM voice engine (self-registers)
    (SRC / "av_fx_verb.js").read_text(encoding="utf-8"),   # P3 FX: reverb (self-registers)
    (SRC / "av_fx_delay.js").read_text(encoding="utf-8"),  # P3 FX: stereo delay (self-registers)
    (SRC / "av_fx_mod.js").read_text(encoding="utf-8"),    # P3 FX: chorus/ensemble/flanger/phaser (self-registers)
    (SRC / "av_fx_drive.js").read_text(encoding="utf-8"),  # P3 FX: drive/fold/crush (self-registers)
    (SRC / "av_fx_dyn.js").read_text(encoding="utf-8"),    # P3 FX: EQ/comp/limiter/soft-clip (self-registers)
    (SRC / "av_fx_aw.js").read_text(encoding="utf-8"),   # M1 FX: studio flavours bank (self-registers)
    (SRC / "av_fx_conv.js").read_text(encoding="utf-8"), # M1 FX: convolution IR (self-registers)
    _worklet_part,                                      # AV_WORKLET_SRC + AV_WORKLET_SHA (generated above)
    (SRC / "av_rec.js").read_text(encoding="utf-8"),    # P2 recorder core (page module)
    (SRC / "av_sample.js").read_text(encoding="utf-8"), # P2 sample core (page module)
    (SRC / "av_wt.js").read_text(encoding="utf-8"),     # M1: wavetable authoring core (page module)
    (SRC / "av_wt_ui.js").read_text(encoding="utf-8"),  # M1: the WT EDITOR card (page module)
    (SRC / "av_chop.js").read_text(encoding="utf-8"),    # M2: chop core (page module)
    (SRC / "av_chop_ui.js").read_text(encoding="utf-8"), # M2: the CHOP card (page module)
    (SRC / "av_aiff.js").read_text(encoding="utf-8"),     # R15b: AIFF clean-room reader (page module)
    (SRC / "av_rex.js").read_text(encoding="utf-8"),      # R15b: REX2 decode -- DWOP + slices (page module)
    (SRC / "av_lib.js").read_text(encoding="utf-8"),      # R15b: the local sample library -- IndexedDB (page module)
    (SRC / "av_import.js").read_text(encoding="utf-8"),   # R15b: the sniffer + canonical bundle pipeline (page module)
    (SRC / "av_import_ui.js").read_text(encoding="utf-8"), # R15b: the SAMPLE PACKS card (page module)
    (SRC / "av_exs.js").read_text(encoding="utf-8"),     # R15c: EXS24 clean-room reader (page module)
    (SRC / "av_als.js").read_text(encoding="utf-8"),     # R15c: ADG/ALS gzip-XML extractor (page module)
    (SRC / "av_serum.js").read_text(encoding="utf-8"),   # R15c: SerumPreset container reader (page module)
    (SRC / "av_sxt.js").read_text(encoding="utf-8"),     # R15d: Reason NN-XT patch reader (page module)
    (SRC / "av_ni.js").read_text(encoding="utf-8"),      # R15d: NI container + legacy NKI/NBKT reader (page module)
    (SRC / "av_pads.js").read_text(encoding="utf-8"),   # P2 drum pads (page module)
    (SRC / "av_engine.js").read_text(encoding="utf-8"), # the facade: blob→data→spn tier ladder + message protocol
    (SRC / "av_code.js").read_text(encoding="utf-8"),    # S5: CODE engine — user-module facade + persistence
    (SRC / "av_code_ui.js").read_text(encoding="utf-8"), # S5: the CODE card
    (SRC / "av_help.js").read_text(encoding="utf-8"),    # S5: help overlay + tour + tooltips
    (SRC / "av_palette.js").read_text(encoding="utf-8"), # S5: command palette (#80)
    (SRC / "av_lessons.js").read_text(encoding="utf-8"), # S5: lessons + demo groove + wizards
    (SRC / "av_fx.js").read_text(encoding="utf-8"),     # P3 FX rack card (page module)
    (SRC / "av_mod.js").read_text(encoding="utf-8"),    # P3 mod matrix card (page module)
    (SRC / "av_lfo.js").read_text(encoding="utf-8"),    # R13: the LFO card (page module)
    (SRC / "av_seq_core.js").read_text(encoding="utf-8"),    # P4 sequencer: model (page module)
    (SRC / "av_seq_sched.js").read_text(encoding="utf-8"),   # P4 sequencer: audio-clock scheduler
    (SRC / "av_plock.js").read_text(encoding="utf-8"),       # P4 p-lock lanes
    (SRC / "av_seq_capture.js").read_text(encoding="utf-8"), # P4 step/live capture
    (SRC / "av_undo.js").read_text(encoding="utf-8"),        # P4 undo/redo + A/B
    (SRC / "av_seq_acid.js").read_text(encoding="utf-8"),    # P4 ACID lane
    (SRC / "av_seq_ui.js").read_text(encoding="utf-8"),      # P4 sequencer card
    (SRC / "av_song.js").read_text(encoding="utf-8"),         # M2: song runner + arrangement export
    (SRC / "av_store.js").read_text(encoding="utf-8"),        # P5 store core (page module)
    (SRC / "av_bank.js").read_text(encoding="utf-8"),         # P5 bank apply + BANK row (page module)
    (SRC / "av_store_ui.js").read_text(encoding="utf-8"),     # P5 store card (page module)
    (SRC / "av_wavio.js").read_text(encoding="utf-8"),         # P6 deliver: WAV codec 16/24/32f (page module)
    (SRC / "av_zipc.js").read_text(encoding="utf-8"),          # P6 deliver: ZIP store writer (page module)
    (SRC / "av_mid.js").read_text(encoding="utf-8"),           # P6 deliver: SMF writer + parser (page module)
    (SRC / "av_bounce.js").read_text(encoding="utf-8"),        # P6 deliver: offline song bounce (page module)
    (SRC / "av_deliver_ui.js").read_text(encoding="utf-8"),    # P6 deliver: the Deliver card (page module)
    (SRC / "av_input.js").read_text(encoding="utf-8"),        # S1 studio: audio input (page module)
    (SRC / "av_metro.js").read_text(encoding="utf-8"),        # S1 studio: metronome + count-in (page module)
    (SRC / "av_takes.js").read_text(encoding="utf-8"),        # S1 studio: lap takes recorder (page module)
    (SRC / "av_studio_ui.js").read_text(encoding="utf-8"),    # S1 studio: the Studio card (page module)
    (SRC / "av_session.js").read_text(encoding="utf-8"),       # S2 sessions: core + autosave/recovery (page module)
    (SRC / "av_backup.js").read_text(encoding="utf-8"),        # S2 sessions: backup zip + store-method reader (page module)
    (SRC / "av_session_ui.js").read_text(encoding="utf-8"),    # S2 sessions: the Sessions card (page module)
    (SRC / "av_comp.js").read_text(encoding="utf-8"),           # S2.1 comp: the comp engine (take lanes / pick-best / trims + crossfades) (page module)
    (SRC / "av_comp_ui.js").read_text(encoding="utf-8"),        # S2.1 comp: the Comp card (page module)
    (SRC / "av_loud.js").read_text(encoding="utf-8"),           # S3 mix: loudness suite - LUFS/true-peak (page module)
    (SRC / "av_mix.js").read_text(encoding="utf-8"),            # S3 mix: the mix engine (page module)
    (SRC / "av_mix_ui.js").read_text(encoding="utf-8"),         # S3 mix: the MIX card (page module)
    (SRC / "av_deck.js").read_text(encoding="utf-8"),            # DECK: the deck core - scope/spectrum/waterfall/meters (page module)
    (SRC / "av_deck_ui.js").read_text(encoding="utf-8"),         # DECK: the DECK card (page module)
    (SRC / "av_proj.js").read_text(encoding="utf-8"),            # S4: .anvl project I/O (page module)
    (SRC / "av_card.js").read_text(encoding="utf-8"),            # S4: patch share cards (page module)
    (SRC / "av_video.js").read_text(encoding="utf-8"),           # S4: video clip capture (page module)
    (SRC / "av_files_ui.js").read_text(encoding="utf-8"),        # S4: the PROJECT & SHARE card (page module)
    (SRC / "av_synth.js").read_text(encoding="utf-8"),  # the SYNTH card (P3 engine layer)
    (SRC / "av_fm_ui.js").read_text(encoding="utf-8"),   # M1: the FM card (page module)
    (SRC / "av_gnaural.js").read_text(encoding="utf-8"),  # PLATFORM: .gnaural parse/render/zip core (page module)
    (SRC / "av_pwa.js").read_text(encoding="utf-8"),      # PLATFORM: the PWA module (page module)
    (SRC / "av_family.js").read_text(encoding="utf-8"),   # PLATFORM: the FAMILY card - suite bridges (page module)
    (SRC / "av_a11y.js").read_text(encoding="utf-8"),     # P7: the accessibility layer (page module)
    (SRC / "av_shell.js").read_text(encoding="utf-8"),    # R1: the cockpit shell — zones + fixed-window chassis (page module)
    (SRC / "av_chrome.js").read_text(encoding="utf-8"),
    (SRC / "av_panels.js").read_text(encoding="utf-8"),  # R3: the float workspace (page module)
    (SRC / "av_rail.js").read_text(encoding="utf-8"),     # R4: the left module rail (page module)
    (SRC / "av_menubar.js").read_text(encoding="utf-8"),
    (SRC / "av_console.js").read_text(encoding="utf-8"),  # R11: the LED/OLED transport console (page module)  # R5: the Windows-style menu bar (page module)   # R2: module chrome — heads + menu, engine strip, header utilities (page module)
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


# ---------- PLATFORM wave: PWA emission (sw.js + manifest.webmanifest + icons) ----------

_sw_tpl = (SRC / "av_sw.js").read_text(encoding="utf-8")
assert "__AV_SW_VERSION__" in _sw_tpl, "sw template: __AV_SW_VERSION__ token missing"
assert "__AV_SW_ASSETS__" in _sw_tpl, "sw template: __AV_SW_ASSETS__ token missing"
import json as _json
_sw_assets = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png",
              "./icon-512.png", "./icon-maskable-512.png", "./inbox.html"]
_sw = _sw_tpl.replace("__AV_SW_VERSION__", sha[:8]).replace("__AV_SW_ASSETS__", _json.dumps(_sw_assets))
assert "__AV_" not in _sw, "sw template: unsubstituted token remains"
_swout = ROOT / "sw.js"
_swout.write_text(_sw, encoding="utf-8", newline="\n")
print("built %s  (%d bytes)" % (_swout.name, _swout.stat().st_size))
print("sw sha256 %s" % hashlib.sha256(_sw.encode("utf-8")).hexdigest())

_MANIFEST = {
    "name": "Anvil",
    "short_name": "Anvil",
    "description": "A MODDYS Foundry instrument \u2014 acid, wavetable, FM, string, drum, granular and sampler engines in one local-first browser synth.",
    "id": "./",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "orientation": "any",
    "background_color": "#16140f",
    "theme_color": "#16140f",
    "categories": ["music", "entertainment"],
    "icons": [
        {"src": "./icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "./icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "./icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
    "file_handlers": [
        {"action": "./index.html", "accept": {"application/x-anvil-project": [".anvl"]}},
    ],
}
_mf = ROOT / "manifest.webmanifest"
_mf.write_text(_json.dumps(_MANIFEST, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
print("built %s  (%d bytes)" % (_mf.name, _mf.stat().st_size))

import importlib.util as _ilu
_spec = _ilu.spec_from_file_location("av_icon", str(SRC / "av_icon.py"))
_icon = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_icon)
for _nm, _sz, _mk in (("icon-192.png", 192, False), ("icon-512.png", 512, False), ("icon-maskable-512.png", 512, True)):
    _png = _icon.render_icon(_sz, _mk)
    assert isinstance(_png, (bytes, bytearray)) and len(_png) > 66, "icon render failed: " + _nm
    (ROOT / _nm).write_bytes(bytes(_png))
    print("wrote %s (%d bytes, sha256 %s)" % (_nm, len(_png), hashlib.sha256(bytes(_png)).hexdigest()))
