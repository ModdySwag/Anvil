#!/usr/bin/env python3
"""Anvil - icon renderer (PLATFORM wave, child sa-A, #78; verify/_platform_wave.md 2.3).

Renders the three PWA icons as PNG bytes: an anvil silhouette in side profile (horn to the
left), in the app's teal (--teal #2ED8C9, read from src/styles.css) on the dark ground
#16140f (the manifest background_color). Flat, no text, readable at 48 px. Supersampled 4x
(supersample count per output pixel = 16 coverage levels) for smooth edges. Pure stdlib -
zlib + struct for the PNG, hashlib only for the selftest's shas; no PIL, no randomness, no
time: the same call always returns the same bytes.

API (imported by build.py via importlib from the src dir):

    render_icon(size, maskable=False) -> bytes      # one square PNG

Standalone:

    python3 src/av_icon.py --selftest               # renders the three icons, decodes them
                                                    # back, checks sizes/shas/determinism/
                                                    # content bounds, exits nonzero on any
                                                    # problem
    python3 src/av_icon.py                          # same as --selftest
    python3 src/av_icon.py --render SIZE PATH [--maskable]

ONE writer (child sa-A).
"""
import hashlib
import struct
import sys
import zlib

ICON_VERSION = "platform.0"

TEAL = (0x2E, 0xD8, 0xC9)          # var --teal in src/styles.css
GROUND = (0x16, 0x14, 0x0F)        # the dark ground (manifest background_color)

SUPERSAMPLE = 4                    # 4x4 = 16 samples per output pixel

# The anvil silhouette, side profile, horn to the left (design units, y grows downward).
# One simple polygon, traced: horn tip -> horn underside -> face-slab underside -> waist ->
# base (left, bottom, right) -> waist right -> underside -> heel -> face top -> close.
ANVIL_POLYGON = (
    (6.0, 40.0),    # horn tip
    (30.0, 46.0),   # horn underside meets the face-slab underside
    (42.0, 46.0),   # slab underside, left of the waist
    (44.0, 58.0),   # waist, pinched
    (36.0, 70.0),   # waist flares onto the base
    (16.0, 70.0),   # base top, left
    (14.0, 80.0),   # base bottom, left
    (86.0, 80.0),   # base bottom, right
    (84.0, 70.0),   # base top, right
    (64.0, 70.0),   # waist flare, right
    (56.0, 58.0),   # waist, right
    (58.0, 46.0),   # slab underside, right of the waist
    (84.0, 46.0),   # slab underside, heel
    (84.0, 34.0),   # heel right edge
    (26.0, 34.0),   # face top, back to the horn root
)
ANVIL_BBOX = (6.0, 34.0, 86.0, 80.0)   # minx, miny, maxx, maxy

FIT_NORMAL = 0.86        # normal icons: the content box spans 86% of the canvas
FIT_MASKABLE = 0.78      # maskable icons: content stays inside the central 80% safe area


def _check_size(size):
    """Validate and normalize the requested size (int-like, 16..4096)."""
    try:
        s = int(size)
    except (TypeError, ValueError):
        raise ValueError("icon size must be an integer, got %r" % (size,))
    if s != size:
        raise ValueError("icon size must be a whole number, got %r" % (size,))
    if s < 16 or s > 4096:
        raise ValueError("icon size out of range (16..4096): %d" % s)
    return s


def _ceil_int(v):
    """ceil(v) as an int - no math import needed (truncation == floor for v >= 0)."""
    i = int(v)
    return i + 1 if i < v else i


def _row_rgba(acc, size):
    """One RGBA output row from the per-pixel supersample counts (0..16)."""
    row = bytearray(size * 4)
    tr, tg, tb = TEAL
    gr, gg, gb = GROUND
    o = 0
    for p in range(size):
        c = acc[p]
        if c <= 0:
            row[o] = gr
            row[o + 1] = gg
            row[o + 2] = gb
        elif c >= SUPERSAMPLE * SUPERSAMPLE:
            row[o] = tr
            row[o + 1] = tg
            row[o + 2] = tb
        else:
            k = SUPERSAMPLE * SUPERSAMPLE - c
            row[o] = (tr * c + gr * k + 8) >> 4
            row[o + 1] = (tg * c + gg * k + 8) >> 4
            row[o + 2] = (tb * c + gb * k + 8) >> 4
        row[o + 3] = 255
        o += 4
    return bytes(row)


def _render_rows(size, maskable):
    """RGBA rows (bytes, 4*size each) for one icon - scanline-filled at SUPERSAMPLE x."""
    ss = SUPERSAMPLE
    fit = FIT_MASKABLE if maskable else FIT_NORMAL
    minx, miny, maxx, maxy = ANVIL_BBOX
    bw = maxx - minx
    bh = maxy - miny
    scale = (fit * size) / bw
    if (fit * size) / bh < scale:
        scale = (fit * size) / bh
    cx = size / 2.0
    cy = size / 2.0
    bcx = (minx + maxx) / 2.0
    bcy = (miny + maxy) / 2.0
    pts = [(((px - bcx) * scale + cx) * ss, ((py - bcy) * scale + cy) * ss)
           for (px, py) in ANVIL_POLYGON]

    n = len(pts)
    w_ss = size * ss
    rows = []
    acc = [0] * size
    for sy in range(size * ss):
        y = sy + 0.5
        xs = []
        j = n - 1
        for i in range(n):
            yi = pts[i][1]
            yj = pts[j][1]
            if (yi > y) != (yj > y):
                xi = pts[i][0]
                xj = pts[j][0]
                xs.append(xi + (y - yi) * (xj - xi) / (yj - yi))
            j = i
        if xs:
            xs.sort()
            for k in range(0, len(xs) - 1, 2):
                x1 = xs[k]
                x2 = xs[k + 1]
                if x2 <= x1:
                    continue
                c0 = _ceil_int(x1 - 0.5)      # first cell whose center is >= x1
                if c0 < 0:
                    c0 = 0
                c1 = _ceil_int(x2 - 0.5)      # one past the last cell center < x2
                if c1 > w_ss:
                    c1 = w_ss
                if c1 <= c0:
                    continue
                p0 = c0 // ss
                p1 = (c1 - 1) // ss
                for p in range(p0, p1 + 1):
                    lo = c0 if c0 > (p * ss) else (p * ss)
                    hi = c1 if c1 < ((p * ss) + ss) else ((p * ss) + ss)
                    if hi > lo:
                        acc[p] += hi - lo
        if sy % ss == ss - 1:
            rows.append(_row_rgba(acc, size))
            acc = [0] * size
    return rows


def _png(size, rows):
    """Assemble an 8-bit RGBA PNG (filter type 0 rows; zlib level 9; deterministic)."""
    raw = bytearray()
    for row in rows:
        raw.append(0)          # filter: none
        raw += row

    def _chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n"
            + _chunk(b"IHDR", ihdr)
            + _chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + _chunk(b"IEND", b""))


def render_icon(size, maskable=False):
    """Render one square Anvil icon as PNG bytes. Deterministic: same args, same bytes."""
    s = _check_size(size)
    return _png(s, _render_rows(s, bool(maskable)))


# ---------------------------------------------------------------------------------------
# selftest (standalone): renders the three icons, decodes them back, checks everything
# ---------------------------------------------------------------------------------------

def _decode_png(data):
    """Minimal reader for OUR OWN files: returns (width, height, rows) with RGBA row bytes."""
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("missing PNG signature")
    o = 8
    w = None
    h = None
    bd = None
    ct = None
    idat = bytearray()
    while o + 8 <= len(data):
        ln = struct.unpack(">I", data[o:o + 4])[0]
        tag = data[o + 4:o + 8]
        body = data[o + 8:o + 8 + ln]
        if tag == b"IHDR":
            w, h, bd, ct = struct.unpack(">IIBB", body[:10])
        elif tag == b"IDAT":
            idat += body
        elif tag == b"IEND":
            break
        o += 12 + ln
    if w is None or h is None or bd != 8 or ct != 6:
        raise ValueError("unexpected PNG shape (want 8-bit RGBA)")
    raw = zlib.decompress(bytes(idat))
    stride = w * 4
    if len(raw) != (stride + 1) * h:
        raise ValueError("unexpected raw size")
    rows = []
    for y in range(h):
        base = y * (stride + 1)
        if raw[base] != 0:
            raise ValueError("unexpected filter type %d" % raw[base])
        rows.append(raw[base + 1:base + 1 + stride])
    return w, h, rows


def _content_bbox(w, h, rows):
    """Bounding box of every pixel that differs from the ground color."""
    minx = w
    miny = h
    maxx = -1
    maxy = -1
    gr, gg, gb = GROUND
    for y in range(h):
        row = rows[y]
        for x in range(w):
            o = x * 4
            if row[o] != gr or row[o + 1] != gg or row[o + 2] != gb:
                if x < minx:
                    minx = x
                if x > maxx:
                    maxx = x
                if y < miny:
                    miny = y
                if y > maxy:
                    maxy = y
    return minx, miny, maxx, maxy


def _is_ground(rows, x, y):
    row = rows[y]
    o = x * 4
    return row[o] == GROUND[0] and row[o + 1] == GROUND[1] and row[o + 2] == GROUND[2]


# shape probes: (anvil_x, anvil_y, expect_inside) - the transform below maps them into any
# icon size, so the same probes prove the silhouette at 192 and at 512, normal and maskable
SHAPE_PROBES = (
    (55.0, 40.0, True),    # the face slab, between horn root and heel
    (50.0, 58.0, True),    # the waist, pinched
    (50.0, 75.0, True),    # the base
    (12.0, 40.0, True),    # the horn, mid taper
    (50.0, 25.0, False),   # open air above the face
    (25.0, 55.0, False),   # left of the waist, below the slab
    (75.0, 55.0, False),   # right of the waist, below the slab
    (30.0, 66.0, False),   # left of the flaring waist, above the base
)


def _probe_pixel(size, maskable, ax, ay):
    """Map an anvil-space point to the output pixel the renderer puts it in."""
    fit = FIT_MASKABLE if maskable else FIT_NORMAL
    minx, miny, maxx, maxy = ANVIL_BBOX
    bw = maxx - minx
    bh = maxy - miny
    scale = (fit * size) / bw
    if (fit * size) / bh < scale:
        scale = (fit * size) / bh
    cx = size / 2.0
    cy = size / 2.0
    bcx = (minx + maxx) / 2.0
    bcy = (miny + maxy) / 2.0
    return int(cx + (ax - bcx) * scale), int(cy + (ay - bcy) * scale)


def _check_icon(name, size, maskable):
    """One full check pass; returns (problems, report_line)."""
    problems = []
    done = []
    data = None
    w = h = 0
    try:
        data = render_icon(size, maskable)
        again = render_icon(size, maskable)
        w, h, rows = _decode_png(data)
        if (w, h) != (size, size):
            done.append("dimensions %d x %d != %d x %d" % (w, h, size, size))
        if again != data:
            done.append("not deterministic (the second render differs)")
        if len(data) <= 44:
            done.append("implausibly small (%d bytes)" % len(data))

        # alpha + ground + teal presence (sampled - the icon is 40%+ solid regions)
        alpha_bad = 0
        teal_hits = 0
        for y in range(0, h, 3):
            row = rows[y]
            for x in range(0, w, 3):
                o = x * 4
                if row[o + 3] != 255:
                    alpha_bad += 1
                if row[o] == TEAL[0] and row[o + 1] == TEAL[1] and row[o + 2] == TEAL[2]:
                    teal_hits += 1
        if alpha_bad:
            done.append("%d sampled pixels are not opaque" % alpha_bad)
        if teal_hits == 0:
            done.append("no pure-teal pixels found - the anvil did not draw")
        if not _is_ground(rows, 0, 0) or not _is_ground(rows, size - 1, size - 1):
            done.append("a canvas corner is not the dark ground")

        # content box
        minx, miny, maxx, maxy = _content_bbox(w, h, rows)
        if maxx < 0:
            done.append("no content pixels found")
        else:
            cw = maxx - minx + 1
            ch = maxy - miny + 1
            if maskable:
                # content must sit inside the central 80% safe area (+2 px AA slack)
                lo = 0.10 * size - 2.0
                hi = 0.90 * size + 2.0
                if minx < lo or miny < lo or (maxx + 1) > hi or (maxy + 1) > hi:
                    done.append("maskable content escapes the central 80%%: bbox %d,%d..%d,%d"
                                % (minx, miny, maxx, maxy))
            else:
                if cw < size * 0.55 or cw > size * 0.95:
                    done.append("content width %d of %d looks wrong" % (cw, size))
                if ch < size * 0.30 or ch > size * 0.80:
                    done.append("content height %d of %d looks wrong" % (ch, size))

        # the silhouette itself, probed at mapped points
        for ax, ay, inside in SHAPE_PROBES:
            px, py = _probe_pixel(size, maskable, ax, ay)
            if px < 0 or py < 0 or px >= size or py >= size:
                done.append("probe (%s,%s) maps outside the canvas" % (ax, ay))
                continue
            hit = not _is_ground(rows, px, py)
            if hit != inside:
                done.append("probe (%s,%s) expected %s" % (ax, ay, "teal" if inside else "ground"))
    except Exception as exc:                                # selftest: report, never crash
        done.append("render/decode raised: %s" % exc)

    sha = hashlib.sha256(data).hexdigest() if data else "-"
    status = "ok" if not done else "FAIL"
    report = "%-24s %4dx%-4d %7d bytes  sha256 %s  [%s]" % (name, w, h, len(data) if data else 0, sha, status)
    for line in done:
        report += "\n   - " + line
    return done, report


def _selftest():
    print("av_icon selftest - version %s" % ICON_VERSION)
    icons = (
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
    )
    problems = []
    for name, size, maskable in icons:
        done, report = _check_icon(name, size, maskable)
        print(report)
        for line in done:
            problems.append("%s: %s" % (name, line))
    if problems:
        print("SELFTEST FAILED (%d problem%s)" % (len(problems), "" if len(problems) == 1 else "s"))
        return 1
    print("SELFTEST OK - three icons render, deterministic, inside bounds")
    return 0


def _main(argv):
    args = list(argv[1:])
    if not args or args == ["--selftest"]:
        return _selftest()
    if args[0] == "--render":
        rest = [a for a in args[1:] if a != "--maskable"]
        maskable = "--maskable" in args[1:]
        if len(rest) != 2:
            print("usage: av_icon.py --render SIZE PATH [--maskable]")
            return 2
        try:
            size = int(rest[0])
            data = render_icon(size, maskable)
        except (TypeError, ValueError) as exc:
            print("render refused: %s" % exc)
            return 2
        try:
            with open(rest[1], "wb") as fh:
                fh.write(data)
        except OSError as exc:
            print("write failed: %s" % exc)
            return 1
        print("wrote %s (%dx%d, %d bytes, sha256 %s)"
              % (rest[1], size, size, len(data), hashlib.sha256(data).hexdigest()))
        return 0
    print("usage: av_icon.py [--selftest | --render SIZE PATH [--maskable]]")
    return 2


if __name__ == "__main__":
    sys.exit(_main(sys.argv))
