#!/usr/bin/env python3
"""Anvil icon pipeline: the repo's own 512 px app icon, wrapped for Windows.

The Anvil artwork already exists - icon-512.png / icon-192.png / icon-maskable-512.png at the
repo root are the PWA set build.py emits. This script draws nothing: it takes the repo's
icon-512.png and derives the Windows-facing set from it with LANCZOS, so the taskbar icon is the
app's real icon (legible at 16 px, the only size that matters for a taskbar).

Outputs (windows/icons/):
  anvil.ico              16/24/32/48/64/128/256 multi-size, for the exe, shortcuts, installer
  anvil-icon-512.png     the downloads-page icon + press/README use
  anvil-icon-116.png / anvil-icon-58.png
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
WIN = os.path.normpath(os.path.join(HERE, ".."))          # windows/
REPO = os.path.normpath(os.path.join(WIN, ".."))          # anvil/
ICONS = os.path.join(WIN, "icons")
SRC = os.path.join(REPO, "icon-512.png")                  # the app's own icon - never invented


def build():
    if not os.path.exists(SRC):
        raise SystemExit("icon source missing: " + SRC + " (the repo's own icon-512.png)")
    img = Image.open(SRC).convert("RGBA")
    if img.width != img.height or img.width < 512:
        raise SystemExit("icon source must be a square of at least 512 px, got "
                         + str(img.size) + " - regenerate the PWA icons in build.py first")
    os.makedirs(ICONS, exist_ok=True)
    ico = os.path.join(ICONS, "anvil.ico")
    sizes = [16, 24, 32, 48, 64, 128, 256]
    img.save(ico, format="ICO", sizes=[(s, s) for s in sizes])
    img.resize((512, 512), Image.LANCZOS).save(os.path.join(ICONS, "anvil-icon-512.png"))
    for s in (58, 116):
        img.resize((s, s), Image.LANCZOS).save(os.path.join(ICONS, "anvil-icon-" + str(s) + ".png"))
    print("wrote " + ico + " and PNGs to " + ICONS)
    return ico


if __name__ == "__main__":
    build()
