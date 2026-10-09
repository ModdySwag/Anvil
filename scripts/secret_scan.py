#!/usr/bin/env python3
"""Secret-scan gate for public pushes (stdlib only).

Scans the TRACKED TREE and ALL GIT HISTORY OBJECTS for credential-shaped strings.
Masked output (first 4 chars + length). Exit 1 on any hit.

Usage:  python3 scripts/secret_scan.py            (tree + history)
        python3 scripts/secret_scan.py --tree     (tracked tree only)
Run before every public release push.
"""
import re
import subprocess
import sys

PATTERNS = [
    ("google_api", re.compile(rb"AIza[0-9A-Za-z_-]{35}")),
    ("aws_key", re.compile(rb"AKIA[0-9A-Z]{16}")),
    ("github_token", re.compile(rb"gh[pousr]_[A-Za-z0-9]{20,}")),
    ("slack", re.compile(rb"xox[baprs]-[A-Za-z0-9-]{10,}")),
    ("stripe", re.compile(rb"[rs]k_(live|test)_[A-Za-z0-9]{10,}")),
    ("sendgrid", re.compile(rb"SG\.[A-Za-z0-9_-]{16,}")),
    ("private_key", re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("jwt", re.compile(rb"eyJ[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
    ("assigned", re.compile(rb"(?:api[_-]?key|secret|token|password)\s*[:=]\s*[\"'][A-Za-z0-9_./+-]{16,}[\"']", re.I)),
]


def mask(b):
    head = bytes(b[:4]).decode("latin1", "replace")
    return "%s...(%d chars)" % (head, len(b))


def run_git(args, **kw):
    return subprocess.run(["git"] + args, capture_output=True, **kw)


def scan_bytes(data, where, stats, samples, cap=5):
    for name, rx in PATTERNS:
        for m in rx.finditer(data):
            stats[name] = stats.get(name, 0) + 1
            lst = samples.setdefault(name, [])
            if len(lst) < cap:
                lst.append("%s @ %s" % (mask(m.group(0)), where))


def scan_tree(stats, samples):
    out = run_git(["ls-files", "-z"]).stdout
    n = 0
    for f in out.split(b"\x00"):
        if not f:
            continue
        try:
            data = open(f, "rb").read()
        except OSError:
            continue
        n += 1
        if len(data) > 8_000_000:
            continue
        scan_bytes(data, "tree:" + f.decode("utf-8", "replace"), stats, samples)
    return n


def scan_history(stats, samples):
    lst = run_git(["rev-list", "--objects", "--all"]).stdout
    shas = sorted(set(l.split(b" ", 1)[0] for l in lst.splitlines() if l.strip()))
    step = 1500
    for i in range(0, len(shas), step):
        chunk = b"\n".join(shas[i:i + step]) + b"\n"
        out = run_git(["cat-file", "--batch"], input=chunk).stdout
        scan_bytes(out, "history:objects[%d..%d)" % (i, i + step), stats, samples)
    return len(shas)


def main():
    tree_only = "--tree" in sys.argv
    stats, samples = {}, {}
    n = scan_tree(stats, samples)
    h = 0
    if not tree_only:
        h = scan_history(stats, samples)
    total = sum(stats.values())
    print("secret_scan: %d tracked files scanned, %d history objects scanned" % (n, h))
    if total == 0:
        print("secret_scan: CLEAN (0 hits)")
        return 0
    for name in sorted(stats):
        print("HIT %s x%d" % (name, stats[name]))
        for s in samples.get(name, []):
            print("   " + s)
    print("secret_scan: %d HITS -- do not push" % total)
    return 1


if __name__ == "__main__":
    sys.exit(main())
