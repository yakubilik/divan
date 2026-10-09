#!/usr/bin/env python3
"""Move an install from before the rename over to Divan.

    python3 daemon/scripts/migrate_to_divan.py --dry-run    # say what it would do
    python3 daemon/scripts/migrate_to_divan.py              # and do it

Stop the daemon first: this refuses to run while anything listens on its port,
because moving a database out from under a running process is how one is lost.

What it does, in order, and each step is skipped when it is already done — so a
second run changes nothing:

 1. moves ~/.remote-ai-chat to ~/.divan;
 2. leaves ~/.remote-ai-chat behind as a symlink to ~/.divan. The CLIs' session
    and memory folders are recorded under the old path (an account's config
    dir is an absolute path, and its projects are keyed by one), and those
    have to keep resolving;
 3. rewrites the old home's absolute path inside config.toml and the other
    text configs at the top of the folder;
 4. writes ~/Library/LaunchAgents/com.yakup.divan.plist from the old plist,
    with the label, the program and the log paths updated, and sets the old
    plist aside so launchd does not start both at the next login.

It never calls launchctl. The commands to run are printed at the end.

Every path is an argument, so it can be pointed at a copy (the test does).
Plain Python, standard library only: it runs before the new package is installed.
"""
from __future__ import annotations

import argparse
import os
import plistlib
import re
import shutil
import socket
import sys
from pathlib import Path

OLD_HOME_NAME = ".remote-ai-chat"
NEW_HOME_NAME = ".divan"
OLD_NAME = re.compile(r"remote[-_ ]?ai[-_ ]?chat|\bRAC_", re.IGNORECASE)
OLD_ENV_PREFIX = "RAC_"
NEW_ENV_PREFIX = "DIVAN_"
OLD_LABELS = ("com.*.remote-ai-chat", "com.remote-ai-chat.daemon")
NEW_LABEL = "com.yakup.divan"
NEW_PROGRAM = "divan"
DEFAULT_PORT = 8790
TEXT_CONFIGS = (".toml", ".json")
SET_ASIDE = ".migrated"


def parse(argv: list[str] | None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Move an install from before the rename over to Divan.")
    ap.add_argument("--dry-run", action="store_true", help="print every step and change nothing")
    ap.add_argument("--home", type=Path, default=Path.home(), help="the user's home (default: yours)")
    ap.add_argument("--old-home", type=Path, help=f"default: <home>/{OLD_HOME_NAME}")
    ap.add_argument("--new-home", type=Path, help=f"default: <home>/{NEW_HOME_NAME}")
    ap.add_argument("--launch-agents", type=Path, help="default: <home>/Library/LaunchAgents")
    ap.add_argument("--old-plist", type=Path, help="default: the old label's plist in --launch-agents")
    ap.add_argument("--label", default=NEW_LABEL, help=f"the new launchd label (default: {NEW_LABEL})")
    ap.add_argument("--daemon-dir", type=Path, default=Path(__file__).resolve().parents[1],
                    help="the daemon checkout the service runs from (default: the one this script is in)."
                         " Pass where it WILL be if the repository folder is about to be renamed")
    ap.add_argument("--program", type=Path,
                    help="the executable launchd runs (default: <daemon-dir>/<the old plist's venv>/bin/divan)")
    ap.add_argument("--host", default="127.0.0.1", help="where to look for a running daemon")
    ap.add_argument("--port", type=int, help="its port (default: config.toml's, else 8790)")
    a = ap.parse_args(argv)
    a.old_home = a.old_home or a.home / OLD_HOME_NAME
    a.new_home = a.new_home or a.home / NEW_HOME_NAME
    a.launch_agents = a.launch_agents or a.home / "Library" / "LaunchAgents"
    return a


def data_home(a: argparse.Namespace) -> Path | None:
    """Where the data is right now, whichever side of the move this is."""
    if a.new_home.is_dir():
        return a.new_home
    return a.old_home if a.old_home.is_dir() else None


def configured_port(a: argparse.Namespace) -> int:
    if a.port:
        return a.port
    home = data_home(a)
    try:
        text = (home / "config.toml").read_text(encoding="utf-8") if home else ""
    except OSError:
        text = ""
    m = re.search(r"^port\s*=\s*(\d+)", text, re.MULTILINE)
    return int(m.group(1)) if m else DEFAULT_PORT


def listening(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


def find_old_plist(a: argparse.Namespace) -> Path | None:
    if a.old_plist:
        return a.old_plist if a.old_plist.exists() else None
    if not a.launch_agents.is_dir():
        return None
    found = sorted(p for pattern in OLD_LABELS for p in a.launch_agents.glob(pattern + ".plist"))
    return found[0] if found else None


def rewrite(value, old: str, new: str):
    """`value` with the old home replaced in every string inside it."""
    if isinstance(value, str):
        return value.replace(old, new)
    if isinstance(value, list):
        return [rewrite(v, old, new) for v in value]
    if isinstance(value, dict):
        return {k: rewrite(v, old, new) for k, v in value.items()}
    return value


def new_plist(old: dict, a: argparse.Namespace) -> dict:
    plist = rewrite(old, str(a.old_home), str(a.new_home))
    plist["Label"] = a.label
    args = list(plist.get("ProgramArguments") or ["", "serve"])
    program = a.program
    if program is None:
        # <checkout>/<venv>/bin/<script>: keep the venv the old service ran from.
        was = Path(args[0]) if args[0] else None
        venv = was.parent.parent.name if was and was.parent.name == "bin" else ".venv312"
        program = a.daemon_dir / venv / "bin" / NEW_PROGRAM
    args[0] = str(program)
    plist["ProgramArguments"] = args
    env = plist.get("EnvironmentVariables")
    if isinstance(env, dict):
        plist["EnvironmentVariables"] = {
            (NEW_ENV_PREFIX + k[len(OLD_ENV_PREFIX):] if k.startswith(OLD_ENV_PREFIX) else k): v
            for k, v in env.items()}
    return plist


def old_names_in(value) -> list[str]:
    if isinstance(value, str):
        return [value] if OLD_NAME.search(value) else []
    if isinstance(value, list):
        return [s for v in value for s in old_names_in(v)]
    if isinstance(value, dict):
        return [s for k, v in value.items() for s in old_names_in(k) + old_names_in(v)]
    return []


def main(argv: list[str] | None = None) -> int:
    a = parse(argv)
    dry = a.dry_run
    did = "would" if dry else "did"
    changed = 0

    def step(text: str) -> None:
        nonlocal changed
        changed += 1
        print(f"  {did}: {text}")

    def skip(text: str) -> None:
        print(f"  skip: {text}")

    port = configured_port(a)
    if listening(a.host, port):
        if not dry:
            print(f"Something is listening on {a.host}:{port} — stop the daemon first, then run this again."
                  " Nothing was changed.", file=sys.stderr)
            return 1
        print(f"note: something is listening on {a.host}:{port}; without --dry-run this would refuse to run.")

    old_is_link = a.old_home.is_symlink()
    if a.old_home.is_dir() and not old_is_link and a.new_home.exists():
        print(f"Both {a.old_home} and {a.new_home} exist and neither is a link to the other."
              " Merge them by hand; nothing was changed.", file=sys.stderr)
        return 2

    print(f"Migrating to Divan{' (dry run)' if dry else ''}:")

    # 1. the data home
    moving = a.old_home.is_dir() and not old_is_link
    if moving:
        step(f"move {a.old_home} -> {a.new_home}")
        if not dry:
            shutil.move(str(a.old_home), str(a.new_home))
    else:
        skip(f"{a.old_home} is not a folder to move")

    # 2. the back-link
    if old_is_link and Path(os.readlink(a.old_home)) == a.new_home:
        skip(f"{a.old_home} already links to {a.new_home}")
    elif moving or (a.new_home.is_dir() and not a.old_home.exists() and not old_is_link):
        step(f"link {a.old_home} -> {a.new_home}")
        if not dry:
            os.symlink(a.new_home, a.old_home, target_is_directory=True)
    else:
        skip(f"no link to leave at {a.old_home}")

    # 3. absolute paths in the text configs
    home_now = a.old_home if (dry and moving) else a.new_home
    old_path = re.compile(re.escape(str(a.old_home)) + r"(?![\w.-])")
    configs = sorted(p for p in home_now.iterdir()
                     if p.is_file() and p.suffix in TEXT_CONFIGS) if home_now.is_dir() else []
    rewritten = 0
    for path in configs:
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        fixed, n = old_path.subn(str(a.new_home), text)
        if not n:
            continue
        rewritten += 1
        step(f"rewrite {n} path(s) in {a.new_home / path.name}")
        if not dry:
            path.write_text(fixed, encoding="utf-8")
    if not rewritten:
        skip("no config names the old home")

    # 4. the launchd plist
    target = a.launch_agents / f"{a.label}.plist"
    source = find_old_plist(a)
    plist = None
    if target.exists():
        skip(f"{target} is already there")
    elif source is None:
        skip(f"no old plist in {a.launch_agents}")
    else:
        with source.open("rb") as f:
            old = plistlib.load(f)
        plist = new_plist(old, a)
        step(f"write {target} (label {a.label}, program {plist['ProgramArguments'][0]})")
        step(f"set {source.name} aside as {source.name}{SET_ASIDE}, so launchd does not load both")
        if not dry:
            with target.open("wb") as f:
                plistlib.dump(plist, f)
            source.rename(source.with_name(source.name + SET_ASIDE))
        left = old_names_in(plist)
        if left:
            print("  warning: the new plist still names the old folder:")
            for s in left:
                print(f"    {s}")
            print("    If the repository folder is renamed later, write the plist again with"
                  " --daemon-dir <where it will be>.")

    if not changed:
        print("Nothing to do: this install is already on Divan.")
        return 0

    if plist is not None:
        uid = os.getuid() if hasattr(os, "getuid") else "$(id -u)"
        print("\nNot run for you — the launchd side, in this order:")
        print(f"  launchctl bootout gui/{uid}/{old.get('Label', source.stem)}    # if it is still loaded")
        print(f"  launchctl bootstrap gui/{uid} {target}")
        print(f"The program is {plist['ProgramArguments'][0]}: reinstall the package into that"
              " environment first (daemon/install.sh, or `pip install -e daemon`) so it exists.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
