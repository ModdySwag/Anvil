#!/usr/bin/env python3
"""The install journey for Anvil, every step asserted:

    install (silent)  ->  files land + one registry entry  ->  the INSTALLED app is launched and
    checked by the desktop rig  ->  upgrade over the top (user data must survive, still ONE
    Add/Remove entry)  ->  uninstall (silent)  ->  the folder + registry are clean and
    %APPDATA%\\Anvil is still there.

Usage:
    py -3.11 windows/tools/install_journey.py                 # full journey, with the CDP app checks
    py -3.11 windows/tools/install_journey.py --no-app-checks # filesystem + registry only
    py -3.11 windows/tools/install_journey.py --via-runas     # elevated shell: re-launch de-elevated

ELEVATION (the installer-authoring skill documents this exactly): the journey inherits the
CALLER's token. On this host the agent shell may be ELEVATED -- and an elevated shell makes Inno
gloms onto admin mode even for PrivilegesRequired=lowest, installing machine-wide (the log says
"Install mode root key: HKEY_LOCAL_MACHINE") while every per-user location check fails. So:

  * this script probes the token FIRST (net session + whoami /groups IL);
  * non-elevated -> proceeds directly;
  * elevated and no --via-runas -> REFUSES (exit 3) and prints the exact runas route;
  * elevated and --via-runas -> writes windows/tmp/journey-de-elevated.cmd and re-launches itself
    through `runas /trustlevel:0x20000` (runas does not forward stdio, so the .cmd does cd,
    redirects the child's output to a log, and records the exit code in a .done file which this
    parent polls);
  * --de-elevated is the marker the wrapper passes; the child re-verifies the limited token is
    real and refuses if it is not.

Nothing here is taken on faith: the installed index.html is hashed against the frozen build
sha256 in windows/version.json, the install log's "Install mode root key" line is checked when
Inno writes one, the uninstall is judged by what is left on disk and in the registry, and the
app checks are the same rig that gates the staged build (windows/tools/test_desktop_app.mjs
--exe <installed>). Note the Inno uninstaller is unins000.exe.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
WIN = os.path.normpath(os.path.join(HERE, ".."))
TMP = os.path.join(WIN, "tmp")

VERSION_PATH = os.path.join(WIN, "version.json")
if not os.path.exists(VERSION_PATH):
    raise SystemExit("no version.json at " + VERSION_PATH + " -- the D2 build owns it; build first")
VERSION = json.load(open(VERSION_PATH, encoding="utf-8"))

SETUP = os.path.join(WIN, "out", "Anvil-" + str(VERSION["version"]) + "-Setup.exe")
INSTALL_DIR = os.path.join(os.environ["LOCALAPPDATA"], "Programs", "Anvil")
EXE = os.path.join(INSTALL_DIR, "Anvil.exe")
UNINST = os.path.join(INSTALL_DIR, "unins000.exe")   # Inno's default uninstaller name
DATA_DIR = os.path.join(os.environ["APPDATA"], "Anvil")
UNINST_KEY_HKCU = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall"
UNINST_KEY_HKLM = r"HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall"
UNINST_KEY_HKLM32 = r"HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
START_MENU = os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs")
PROGRAM_FILES = [
    os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Anvil"),
    os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "Anvil"),
]

passed = failed = 0


def check(ok, label, detail=""):
    global passed, failed
    passed, failed = (passed + 1, failed) if ok else (passed, failed + 1)
    print((" ok  " if ok else " FAIL") + " " + label + ("  -- " + str(detail) if detail else ""))


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def run(cmd, timeout=1200):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)


def wait_gone(path, ms=60000):
    deadline = time.time() + (ms / 1000.0)
    while time.time() < deadline:
        if not os.path.exists(path):
            return True
        time.sleep(0.5)
    return not os.path.exists(path)


def arp_out(root, needle="Anvil"):
    r = run(["reg", "query", root, "/s", "/f", needle], timeout=120)
    return r.stdout or ""


def display_count(out):
    """One Add/Remove entry == one 'DisplayName ... Anvil' value line."""
    return sum(1 for l in out.splitlines() if l.strip().startswith("DisplayName") and "Anvil" in l)


def start_menu_links():
    hits = []
    for root, _dirs, files in os.walk(START_MENU):
        for f in files:
            if f.lower().endswith(".lnk") and "anvil" in f.lower():
                hits.append(os.path.join(root, f))
            elif f.lower().endswith(".lnk"):
                try:
                    raw = open(os.path.join(root, f), "rb").read()
                    if b"Anvil.exe" in raw or b"Anvil" in raw:
                        hits.append(os.path.join(root, f))
                except OSError:
                    pass
    return hits


# ------------------------------------------------------------------ elevation

def probe_elevation():
    """(elevated, net_ok, il_name). net session fails when non-admin (the skill's route);
    whoami /groups carries the token integrity level as a SID (S-1-16-*)."""
    net_ok = False
    try:
        net_ok = run(["net", "session"], timeout=30).returncode == 0
    except Exception:
        pass
    il = "unknown"
    try:
        who = run(["whoami", "/groups"], timeout=30)
        t = (who.stdout or "") + (who.stderr or "")
        if "S-1-16-16384" in t:
            il = "System"
        elif "S-1-16-12288" in t:
            il = "High"
        elif "S-1-16-8192" in t:
            il = "Medium"
        elif "S-1-16-4096" in t:
            il = "Low"
    except Exception:
        pass
    elevated = net_ok or il in ("High", "System")
    return elevated, net_ok, il


def write_runas_wrapper(extra_args):
    os.makedirs(TMP, exist_ok=True)
    cmd_path = os.path.join(TMP, "journey-de-elevated.cmd")
    log_path = os.path.join(TMP, "journey-de-elevated.log")
    done_path = os.path.join(TMP, "journey-de-elevated.done")
    py = os.path.normpath(sys.executable)
    script = os.path.join(HERE, "install_journey.py")
    # FLAT cmd (the installer-authoring skill's parser traps: no blocks, CRLF only).
    lines = [
        "@echo off",
        'cd /d "' + os.path.normpath(WIN) + '"',
        'del /q "' + done_path + '" 2>nul',
        '"' + py + '" "' + script + '" --de-elevated' + extra_args + ' > "' + log_path + '" 2>&1',
        'echo %ERRORLEVEL% > "' + done_path + '"',
    ]
    with open(cmd_path, "w", encoding="ascii", newline="\r\n") as f:
        f.write("\n".join(lines) + "\n")
    return cmd_path, log_path, done_path


def relaunch_via_runas(extra_args):
    """runas does not forward stdio: launch the wrapper .cmd, poll its .done file, stream the log."""
    cmd_path, log_path, done_path = write_runas_wrapper(extra_args)
    print("-- re-launching through a limited token: runas /trustlevel:0x20000 " + cmd_path)
    r = run(["runas", "/trustlevel:0x20000", cmd_path], timeout=120)
    if r.returncode != 0:
        print("   runas returned " + str(r.returncode) + ": " + ((r.stderr or r.stdout or "").strip() or "(no output)"))
    deadline = time.time() + 1800
    code = None
    while time.time() < deadline:
        if os.path.exists(done_path):
            try:
                code = int(open(done_path, encoding="ascii", errors="replace").read().strip())
                break
            except ValueError:
                pass
        time.sleep(2)
    if code is None:
        print("   the de-elevated journey did not finish within 30 minutes (no .done file)")
        return 4
    print("-- the de-elevated journey finished (exit " + str(code) + "); its log:\n")
    if os.path.exists(log_path):
        lines = open(log_path, encoding="utf-8", errors="replace").read().splitlines()
        for l in lines[-400:]:
            print("   | " + l)
    return code


# ------------------------------------------------------------------ main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-app-checks", action="store_true")
    ap.add_argument("--via-runas", action="store_true",
                    help="when the shell is elevated, re-launch this journey de-elevated via runas /trustlevel:0x20000")
    ap.add_argument("--de-elevated", action="store_true",
                    help="set by the runas wrapper; asserts the limited token is real")
    a = ap.parse_args()

    elevated, net_ok, il = probe_elevation()
    print("-- elevation: net session " + ("rc=0 (admin)" if net_ok else "non-zero (limited token)") + " | token integrity level: " + il)

    if a.de_elevated:
        if elevated:
            print("FAIL --de-elevated was passed but the token is STILL elevated (net session " + str(net_ok) + ", IL " + il + ").")
            print("     Refusing: a per-user journey from an elevated shell installs machine-wide (Inno gloms")
            print("     admin mode) and the location checks lie. Retry the runas route from a normal shell.")
            return 3
        print("   (de-elevated route active: limited token verified)")
    elif elevated:
        _cmd, _log, _done = write_runas_wrapper(" --no-app-checks" if a.no_app_checks else "")
        if a.via_runas:
            return relaunch_via_runas(" --no-app-checks" if a.no_app_checks else "")
        print("")
        print("REFUSING: this shell is ELEVATED (net session " + str(net_ok) + ", IL " + il + ").")
        print("A per-user journey launched from an elevated shell installs MACHINE-WIDE: Inno selects")
        print("admin mode ('Install mode root key: HKEY_LOCAL_MACHINE' in its log), {autopf} resolves to")
        print("Program Files, and every %LOCALAPPDATA% location check below fails while the installer")
        print("exits 0. Run the journey de-elevated -- either:")
        print("")
        print('    runas /trustlevel:0x20000 "' + _cmd + '"')
        print("    (the wrapper redirects the child's output to " + _log + " and its exit code to " + _done + ")")
        print("")
        print("or let this script do it for you:")
        print("")
        print("    py -3.11 windows/tools/install_journey.py --via-runas")
        print("")
        return 3


    if not os.path.exists(SETUP):
        raise SystemExit("no installer at " + SETUP + " -- build it first (windows/tools/build_windows.py)")

    os.makedirs(TMP, exist_ok=True)
    setup_log = os.path.join(TMP, "anvil-install.log")
    print("== journey for " + os.path.basename(SETUP) + " (" + format(os.path.getsize(SETUP), ",") + " B, sha " + sha256(SETUP)[:16] + "...)\n")

    # ---------------------------------------------------------------- pre-flight
    print("-- pre-flight")
    if os.path.exists(UNINST):
        run([UNINST, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
        time.sleep(4)
    check(wait_gone(EXE, 60000), "no previous install in the way", INSTALL_DIR)

    hklm_hits = display_count(arp_out(UNINST_KEY_HKLM)) + display_count(arp_out(UNINST_KEY_HKLM32))
    check(hklm_hits == 0, "no stale MACHINE-WIDE (HKLM) Add/Remove entry -- Inno would glom it into admin mode",
          "found " + str(hklm_hits) + " DisplayName row(s)" if hklm_hits else "none")
    pf_stale = [p for p in PROGRAM_FILES if os.path.exists(p)]
    check(not pf_stale, "no stale machine-wide install directory in Program Files", ", ".join(pf_stale) if pf_stale else "clean")

    # ---------------------------------------------------------------- install
    print("\n-- install (silent, per-user, default location)")
    data_dir_before = sorted(os.listdir(DATA_DIR)) if os.path.isdir(DATA_DIR) else []
    t0 = time.time()
    r = run([SETUP, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/LOG=" + setup_log])
    check(r.returncode == 0, "the installer exits 0", format(time.time() - t0, ".1f") + "s")
    check(os.path.exists(EXE), "Anvil.exe is installed", EXE)
    check(os.path.exists(UNINST), "the uninstaller is installed (unins000.exe)")
    check(EXE.lower().startswith(os.path.join(os.environ["LOCALAPPDATA"], "Programs").lower()),
          "the install landed per-user (%LOCALAPPDATA%\\Programs\\Anvil)")
    pf_after = [p for p in PROGRAM_FILES if os.path.exists(p)]
    check(not pf_after, "nothing landed machine-wide (PrivilegesRequired=lowest held)", ", ".join(pf_after) if pf_after else "clean")
    if os.path.exists(setup_log):
        mode_lines = [l for l in open(setup_log, encoding="utf-8", errors="replace").read().splitlines() if "Install mode root key:" in l]
        if mode_lines:
            check("HKEY_CURRENT_USER" in mode_lines[-1], "the install log confirms the chosen mode (per-user)", mode_lines[-1].strip())
        else:
            print("   - the install log carries no 'Install mode root key' line -- mode unchecked (Inno version?)")

    app_html = os.path.join(INSTALL_DIR, "resources", "app", "index.html")
    check(os.path.exists(app_html), "the app payload is inside the install")
    if os.path.exists(app_html):
        got = sha256(app_html)
        check(got == VERSION["appBuildSha256"],
              "the installed index.html IS the frozen app build, byte for byte",
              got[:16] + "... vs version.json " + str(VERSION["appBuildSha256"])[:16] + "...")
    build_info = os.path.join(INSTALL_DIR, "resources", "app", "build-info.json")
    if os.path.exists(build_info):
        bi = json.load(open(build_info, encoding="utf-8"))
        check(bi.get("appBuildSha256") == VERSION["appBuildSha256"] and bi.get("version") == VERSION["version"],
              "build-info.json names the same build", str(bi.get("version")) + " / " + str(bi.get("appBuild")))
    else:
        check(False, "build-info.json is installed (the shell reads its build from it)", build_info)
    links = start_menu_links()
    check(bool(links), "a Start Menu entry exists", links[0] if links else "missing")
    hkcu_hits = display_count(arp_out(UNINST_KEY_HKCU))
    check(hkcu_hits == 1, "Add/Remove Programs lists EXACTLY ONE entry", str(hkcu_hits) + " DisplayName row(s)")
    data_dir_after = sorted(os.listdir(DATA_DIR)) if os.path.isdir(DATA_DIR) else []
    check(data_dir_after == data_dir_before,
          "the installer added nothing to %APPDATA%\\Anvil (app data is the app's own)",
          (str(len(data_dir_before)) + " pre-existing entries untouched") if data_dir_before else "empty, still empty")

    # ---------------------------------------------------------------- the installed app
    if not a.no_app_checks:
        print("\n-- the installed app, driven over CDP (windows/tools/test_desktop_app.mjs)")
        rig = os.path.join(HERE, "test_desktop_app.mjs")
        if not os.path.exists(rig):
            check(False, "the desktop rig exists", rig)
        else:
            r2 = run(["node", rig, "--exe", EXE, "--cdp", "9357"], timeout=1500)
            tail = [l for l in r2.stdout.splitlines() if l.strip()][-1:] or [""]
            check(r2.returncode == 0, "the installed app passes its desktop suite", tail[0])
            for line in r2.stdout.splitlines():
                if line.startswith(" FAIL") or line.startswith(" FATAL"):
                    print("      " + line.strip())
        got_data = os.path.exists(DATA_DIR)
        if not got_data:
            for _i in range(15):
                time.sleep(1)
                if os.path.exists(DATA_DIR):
                    got_data = True
                    break
        check(got_data, "the app created its own data folder when it ran (%APPDATA%\\Anvil)", DATA_DIR)

    # ---------------------------------------------------------------- upgrade over the top
    print("\n-- upgrade over the top")
    marker = os.path.join(DATA_DIR, "journey-marker.txt")
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(marker, "w", encoding="utf-8") as f:
        f.write("user work that must survive an upgrade\n")
    r = run([SETUP, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
    check(r.returncode == 0, "the upgrade install exits 0")
    check(os.path.exists(EXE), "the app is still installed after the upgrade")
    check(os.path.exists(marker), "user data (%APPDATA%\\Anvil) survived the upgrade", marker)
    hkcu_hits2 = display_count(arp_out(UNINST_KEY_HKCU))
    check(hkcu_hits2 == 1, "still exactly one Add/Remove entry after the upgrade", str(hkcu_hits2) + " DisplayName row(s)")
    if os.path.exists(app_html):
        check(sha256(app_html) == VERSION["appBuildSha256"], "the payload is still the frozen build after the upgrade")

    # ---------------------------------------------------------------- uninstall (silent)
    print("\n-- uninstall (silent)")
    r = run([UNINST, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
    check(r.returncode == 0, "the uninstaller exits 0")
    check(wait_gone(EXE, 60000), "the app exe is gone", INSTALL_DIR)
    check(wait_gone(UNINST, 30000), "the uninstaller is gone with it")
    leftover = sorted(os.listdir(INSTALL_DIR))[:6] if os.path.isdir(INSTALL_DIR) else None
    check(not os.path.exists(INSTALL_DIR), "the app folder is gone (folder clean)", ("leftovers: " + repr(leftover)) if leftover is not None else "removed")
    hkcu_hits3 = display_count(arp_out(UNINST_KEY_HKCU))
    check(hkcu_hits3 == 0, "Add/Remove Programs is clean", str(hkcu_hits3) + " DisplayName row(s)")
    check(os.path.exists(marker), "user data was KEPT (the deliberate default) -- %APPDATA%\\Anvil is intact", marker)
    if os.path.exists(marker):
        os.remove(marker)

    print("\n-- summary: " + str(passed) + " passed, " + str(failed) + " failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
