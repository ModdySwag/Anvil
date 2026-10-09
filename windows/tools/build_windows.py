#!/usr/bin/env python3
"""Anvil -> Windows installer. One script, the whole ladder:

  verify the frozen app  ->  stage the Electron runtime + the app tree  ->  stamp the exe
  (icon + version info)  ->  compile the Inno Setup installer  ->  hash what came out.

Every step is an assertion, not a hope: the repo's index.html must hash to the sha pinned in
version.json (the build that passed the app's own battery), every deploy file must exist at the
repo root, the packs/ store must match its own index.json, and the staged copy is re-hashed inside
the package. If those fail, nothing is built - the artifact's whole value is that its insides are
provably the verified bytes.

Usage:
    python3 tools/build_windows.py                 # full build -> windows/out/
    python3 tools/build_windows.py --stage-only    # stop after windows/stage/ (for dev runs)
    python3 tools/build_windows.py --skip-inno     # stage the tree, no installer
    python3 tools/build_windows.py --no-stamp      # skip rcedit (icon/version metadata)
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
WIN = os.path.normpath(os.path.join(HERE, ".."))           # windows/
REPO = os.path.normpath(os.path.join(WIN, ".."))           # anvil/
VERSION = json.load(open(os.path.join(WIN, "version.json"), encoding="utf-8"))

STAGE = os.path.join(WIN, "stage", "Anvil")
OUT = os.path.join(WIN, "out")
ISCC = os.path.expandvars(r"%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe")
EXE_NAME = "Anvil.exe"
ICON_ICO = os.path.join(WIN, "icons", "anvil.ico")

# rcedit resolution order: env override, then this tree, then the sibling repos' tools/npm copies
# (the PF and Resonance builds already cached it; windows/tools/npm is not part of this tree yet).
RCEDIT_CANDIDATES = [
    os.environ.get("RCEDIT", ""),
    os.path.join(WIN, "tools", "npm", "node_modules", "rcedit", "bin", "rcedit-x64.exe"),
    os.path.join(REPO, "..", "pattern-forge", "windows", "tools", "npm", "node_modules",
                 "rcedit", "bin", "rcedit-x64.exe"),
    os.path.join(REPO, "..", "webmusic-hub", "windows", "tools", "npm", "node_modules",
                 "rcedit", "bin", "rcedit-x64.exe"),
]
# The Electron runtime comes from the LOCAL npm/electron-builder cache - never a build-time
# download; ELECTRON_CACHE overrides the default location when a cache lives elsewhere.
ELECTRON_CACHE = (os.environ.get("ELECTRON_CACHE")
                  or os.path.join(os.environ.get("LOCALAPPDATA", ""), "electron", "Cache"))

# The deploy set: the frozen app build the shell serves, reconciled against what Anvil actually
# carries. Evidence from the repo: sw.js's own precache list (src/av_sw.js, instantiated by
# build.py) is ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png",
# "./icon-maskable-512.png", "./inbox.html"]; index.html links icon-192.png + the manifest, opens
# ./inbox.html, and fetches the packs/ store tree (packs/index.json -> one record file per pack).
# Everything else at the repo root (cache/, verify/, docs/, src/, renders/, research/, harvest/,
# .git/) is dev material and never rides into the installer; staging is allow-list only.
APP_FILES = ["index.html", "sw.js", "manifest.webmanifest", "icon-192.png", "icon-512.png",
             "icon-maskable-512.png", "inbox.html"]
APP_DIRS = ["packs"]
PRODUCT_FILES = ["LICENSE", "README.md"]      # ride along like the PF payload (AGPL compliance)
SHELL_SRC = [("main.js", os.path.join(WIN, "app", "main.js")),
             ("preload.js", os.path.join(WIN, "app", "preload.js"))]
PKG_SRC = os.path.join(WIN, "payload", "package.json")   # the D1-authored shell manifest


def sha256(path, buf=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(buf)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def numeric_version(v):
    """The digits-only form the fixed version fields require: "1.14.0" -> "1.14.0.0"."""
    parts = (re.findall(r"\d+", v) + ["0", "0", "0", "0"])[:4]
    return ".".join(parts)


def say(step, msg):
    print(f"[{step}] {msg}", flush=True)


def run(cmd, **kw):
    say("run", " ".join(str(c) for c in cmd))
    r = subprocess.run(cmd, **kw)
    if r.returncode != 0:
        raise SystemExit(f"command failed ({r.returncode}): {cmd}")
    return r


# --------------------------------------------------------------------------- 1. verify the app
def verify_app():
    app = os.path.join(REPO, "index.html")
    got = sha256(app)
    want = VERSION["appBuildSha256"]
    if got != want:
        raise SystemExit(
            "REFUSING TO BUILD: index.html is not the frozen app build.\n"
            f"  expected sha256 {want} ({VERSION['appBuild']})\n"
            f"  found    sha256 {got}\n"
            "Run the app's own battery on the current build, then update windows/version.json "
            "(appBuild/appBuildBytes/appBuildSha256) in the same pass."
        )
    size = os.path.getsize(app)
    if size != VERSION["appBuildBytes"]:
        raise SystemExit("REFUSING TO BUILD: index.html is " + str(size) + " B, version.json says "
                         + str(VERSION["appBuildBytes"]) + " B")
    say("verify", f"frozen app OK: {VERSION['appBuild']} | {size:,} B | {got[:16]}...")

    missing = [f for f in APP_FILES + APP_DIRS + PRODUCT_FILES
               if not os.path.exists(os.path.join(REPO, f))]
    if missing:
        raise SystemExit("REFUSING TO BUILD: the deploy set is incomplete at the repo root: "
                         + ", ".join(missing))
    say("verify", f"deploy set present: {len(APP_FILES)} files + {len(APP_DIRS)} dir + licence/readme")


def verify_sw_version():
    sw = open(os.path.join(REPO, "sw.js"), encoding="utf-8").read()
    m = re.search(r'SW_VERSION\s*=\s*"([0-9a-f]{8})"', sw)
    if not m:
        say("verify", "sw.js: SW_VERSION token not found (skipping the index/sw cross-check)")
        return
    if m.group(1) != VERSION["appBuild"]:
        raise SystemExit(
            "REFUSING TO BUILD: sw.js SW_VERSION " + m.group(1) + " != appBuild "
            + VERSION["appBuild"] + " - rebuild the app (build.py instantiates both in one pass), "
            "then update windows/version.json."
        )
    say("verify", "sw.js SW_VERSION matches the frozen build")


def verify_packs():
    index = os.path.join(REPO, "packs", "index.json")
    try:
        data = json.load(open(index, encoding="utf-8"))
    except ValueError as e:
        raise SystemExit("REFUSING TO BUILD: packs/index.json is not valid JSON (" + str(e) + ")")
    packs = data.get("packs", [])
    if not packs:
        raise SystemExit("REFUSING TO BUILD: packs/index.json lists no packs")
    bad = []
    for p in packs:
        rel = p.get("file")
        if not rel or not p.get("sha256"):
            bad.append(str(p.get("id", "?")) + " (index entry lacks file/sha256)")
            continue
        fp = os.path.join(REPO, "packs", rel)
        if not os.path.exists(fp):
            bad.append(rel + " (missing)")
        elif sha256(fp) != p["sha256"] or os.path.getsize(fp) != p.get("bytes"):
            bad.append(rel + " (hash/bytes differ from index.json)")
    if bad:
        raise SystemExit("REFUSING TO BUILD: packs/ does not match its own index.json: "
                         + ", ".join(bad))
    say("verify", f"packs OK: {len(packs)} banks match packs/index.json pins")


def verify_shell():
    missing = [path for _rel, path in SHELL_SRC if not os.path.exists(path)]
    if missing:
        raise SystemExit("REFUSING TO BUILD: the Electron shell is incomplete (D1 deliverables): "
                         + ", ".join(missing))
    if os.path.exists(PKG_SRC):
        try:
            pkg = json.load(open(PKG_SRC, encoding="utf-8"))
        except ValueError as e:
            raise SystemExit("REFUSING TO BUILD: " + PKG_SRC + " is not valid JSON (" + str(e) + ")")
        if pkg.get("main") != "main.js":
            raise SystemExit("REFUSING TO BUILD: " + PKG_SRC + " 'main' is "
                             + repr(pkg.get("main")) + ", expected 'main.js'")
        if pkg.get("version") != VERSION["version"]:
            raise SystemExit("REFUSING TO BUILD: " + PKG_SRC + " version "
                             + repr(pkg.get("version")) + " != version.json "
                             + repr(VERSION["version"]))
        say("verify", "shell package.json OK (authored in windows/payload, identity matches version.json)")
    else:
        say("verify", "shell package.json absent at windows/payload - a PF-style one will be "
                      "generated from version.json")


# -------------------------------------------------------------------------- 2. the staged tree
def find_electron_zip():
    want = f"electron-v{VERSION['electron']}-win32-x64.zip"
    hits = []
    for root, _dirs, files in os.walk(ELECTRON_CACHE):
        if want in files:
            hits.append(os.path.join(root, want))
    if not hits:
        raise SystemExit(
            f"Electron runtime {want} is not in the cache ({ELECTRON_CACHE}).\n"
            f"Fetch it once: npm install electron@{VERSION['electron']} --no-save  (in a temp dir), "
            "or set ELECTRON_CACHE to a folder that has it."
        )
    return max(hits, key=os.path.getmtime)


def stage_runtime():
    zip_path = find_electron_zip()
    say("stage", f"runtime: {zip_path} ({os.path.getsize(zip_path):,} B)")
    if os.path.isdir(STAGE):
        shutil.rmtree(STAGE)
    os.makedirs(os.path.dirname(STAGE), exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(STAGE)
    default_app = os.path.join(STAGE, "resources", "default_app.asar")
    if os.path.exists(default_app):
        os.remove(default_app)                       # resources/app wins; drop the stub
    exe = os.path.join(STAGE, "electron.exe")
    if not os.path.exists(exe):
        raise SystemExit("stage: electron.exe missing after extraction")
    os.rename(exe, os.path.join(STAGE, EXE_NAME))

    app_dir = os.path.join(STAGE, "resources", "app")
    if os.path.isdir(app_dir):
        shutil.rmtree(app_dir)
    os.makedirs(app_dir)

    # the frozen app build + shell, allow-list only (never the repo's dev trees)
    expected = {}

    def copy_in(src, rel):
        dst = os.path.join(app_dir, rel.replace("/", os.sep))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
        expected[rel] = sha256(src)

    for rel in APP_FILES:
        copy_in(os.path.join(REPO, rel), rel)
    for d in APP_DIRS:
        base = os.path.join(REPO, d)
        for dirpath, _sub, files in os.walk(base):
            for fn in files:
                src = os.path.join(dirpath, fn)
                copy_in(src, os.path.relpath(src, REPO).replace(os.sep, "/"))
    for rel in PRODUCT_FILES:
        copy_in(os.path.join(REPO, rel), rel)
    for rel, src in SHELL_SRC:
        copy_in(src, rel)

    # package.json: the D1-authored file wins; otherwise the PF-style generated one
    if os.path.exists(PKG_SRC):
        copy_in(PKG_SRC, "package.json")
    else:
        pkg = {
            "name": "anvil",
            "productName": "Anvil",
            "version": VERSION["version"],
            "description": "Anvil - a MODDYS Foundry instrument (desktop).",
            "main": "main.js",
            "author": {"name": "Modtech (Moddy)", "email": VERSION["authorEmail"]},
            "license": VERSION["license"],
            "homepage": VERSION["appPage"],
            "private": True,
        }
        with open(os.path.join(app_dir, "package.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(pkg, f, indent=2, ensure_ascii=False)
            f.write("\n")

    # the Windows icon set (derived from the repo's own icon-512.png when not on disk yet)
    if not os.path.exists(ICON_ICO):
        import make_icon
        make_icon.build()
    icons_dir = os.path.join(app_dir, "icons")
    os.makedirs(icons_dir, exist_ok=True)
    shutil.copy2(ICON_ICO, os.path.join(icons_dir, "anvil.ico"))

    # the byte-fidelity proof: what is inside the staged app is the frozen build
    app_tree = {}
    for dirpath, _d, files in os.walk(app_dir):
        for fn in files:
            p = os.path.join(dirpath, fn)
            app_tree[os.path.relpath(p, app_dir).replace(os.sep, "/")] = sha256(p)
    got = app_tree.get("index.html")
    if got != VERSION["appBuildSha256"]:
        raise SystemExit(f"stage: packaged index.html sha mismatch ({got})")
    for rel, want in expected.items():
        if app_tree.get(rel) != want:
            raise SystemExit(f"stage: packaged {rel} differs from the repo copy")
    say("stage", f"staged tree OK - resources/app carries the frozen {VERSION['appBuild']} build "
                 f"+ shell, byte for byte ({len(app_tree)} files)")

    build_info = {
        "name": VERSION["name"],
        "appId": VERSION["appId"],
        "version": VERSION["version"],
        "appBuild": VERSION["appBuild"],
        "appBuildBytes": VERSION["appBuildBytes"],
        "appBuildSha256": VERSION["appBuildSha256"],
        "appBuildNote": VERSION["appBuildNote"],
        "electron": VERSION["electron"],
        "appTreeFiles": len(app_tree),
        "appTree": app_tree,
        "builtAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    with open(os.path.join(app_dir, "build-info.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(build_info, f, indent=2, ensure_ascii=False)
        f.write("\n")


# ------------------------------------------------------------------------------ 3. stamp the exe
def find_rcedit():
    for cand in RCEDIT_CANDIDATES:
        if cand and os.path.exists(cand):
            return cand
    return None


def stamp_exe():
    rcedit = find_rcedit()
    if not rcedit:
        say("stamp", "rcedit not found (env RCEDIT | windows/tools/npm | the sibling repos) - "
                     "stamping SKIPPED; the exe keeps Electron's icon and version info.")
        return False
    say("stamp", f"rcedit: {rcedit}")
    exe = os.path.join(STAGE, EXE_NAME)
    v = VERSION["version"]
    run([rcedit, exe,
         "--set-icon", ICON_ICO,
         "--set-file-version", numeric_version(v),
         "--set-product-version", v,
         "--set-version-string", "ProductName", VERSION["name"],
         "--set-version-string", "FileDescription", "Anvil - a MODDYS Foundry instrument",
         "--set-version-string", "CompanyName", VERSION["publisher"],
         "--set-version-string", "LegalCopyright", VERSION["copyright"],
         "--set-version-string", "OriginalFilename", EXE_NAME,
         "--set-version-string", "InternalName", "Anvil"])
    say("stamp", f"exe stamped: icon + Anvil {v} metadata")
    return True


# ---------------------------------------------------------------------------- 4. the installer
def build_installer():
    if not os.path.exists(ISCC):
        raise SystemExit(f"Inno Setup compiler not found at {ISCC}")
    os.makedirs(OUT, exist_ok=True)
    iss = os.path.join(WIN, "installer", "anvil.iss")
    run([ISCC, f"/DAppVersion={VERSION['version']}",
         f"/DVersionInfoVersion={numeric_version(VERSION['version'])}",
         f"/DAppBuild={VERSION['appBuild']}", iss],
        cwd=os.path.join(WIN, "installer"))
    setup = os.path.join(OUT, f"Anvil-{VERSION['version']}-Setup.exe")
    if not os.path.exists(setup):
        raise SystemExit("installer build reported success but the Setup exe is not there")
    return setup


def report(setup, stamped):
    exe = os.path.join(STAGE, EXE_NAME)
    tree_bytes = 0
    for root, _d, files in os.walk(STAGE):
        for f in files:
            tree_bytes += os.path.getsize(os.path.join(root, f))
    setup_sha, setup_bytes = sha256(setup), os.path.getsize(setup)
    manifest = {
        "product": VERSION["name"],
        "version": VERSION["version"],
        "appBuild": VERSION["appBuild"],
        "appSha256": VERSION["appBuildSha256"],
        "electron": VERSION["electron"],
        "stamped": stamped,
        "setup": os.path.basename(setup),
        "setupBytes": setup_bytes,
        "setupSha256": setup_sha,
        "installedTreeBytes": tree_bytes,
        "installedExeSha256": sha256(exe),
        "builtAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    with open(os.path.join(OUT, "build-manifest.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    with open(os.path.join(OUT, f"Anvil-{VERSION['version']}-Setup.sha256.txt"), "w",
              encoding="utf-8", newline="\n") as f:
        f.write(f"{setup_sha}  {os.path.basename(setup)}\n")
    say("report", f"Setup    {setup_bytes:,} B  sha256 {setup_sha}")
    say("report", f"installs {tree_bytes:,} B ({tree_bytes / setup_bytes:.1f}x unpacked)")
    say("report", f"manifest {os.path.join(OUT, 'build-manifest.json')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage-only", action="store_true")
    ap.add_argument("--skip-inno", action="store_true")
    ap.add_argument("--no-stamp", action="store_true")
    a = ap.parse_args()

    verify_app()
    verify_sw_version()
    verify_packs()
    verify_shell()
    stage_runtime()
    stamped = False
    if not a.no_stamp:
        stamped = stamp_exe()
    say("stage", f"runnable tree: {STAGE}")
    if a.stage_only:
        return
    if a.skip_inno:
        return
    setup = build_installer()
    report(setup, stamped)


if __name__ == "__main__":
    main()
