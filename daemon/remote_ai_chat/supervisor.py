"""Whether anything would start this daemon again.

A restart is only a restart if something brings the process back. Stopping an
unsupervised daemon is a shutdown, and on a computer nobody is sitting at it is
a shutdown that cannot be undone from the phone that asked for it — the one
mistake this feature could make that costs more than it saves. So the question
is asked before the process agrees to stop.

The answer has three values and the third one matters: `True`, `False`, and
`None` for a setup this file has not learned to read. `None` is not `False`.
It is what an honest reader says about a Windows scheduled task or a container
init it cannot see into, and it lets the restart through with the doubt
recorded rather than stranding a machine that was fine all along.

Nothing here looks for the label `remote-ai-chat install` writes. A daemon
started from a hand-written plist under somebody else's label is supervised
just as well, and asking "is this process a launchd job" rather than "is it
*our* launchd job" is the difference between reading the machine and reading
our own assumptions about it.
"""
from __future__ import annotations

import os
import subprocess
import sys

TIMEOUT_S = 5


def _run(*args: str) -> tuple[int, str]:
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=TIMEOUT_S)
    except Exception:
        return 1, ""
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def _launchd() -> dict:
    """macOS. `launchctl list` is keyed by pid, which is how this finds its own
    job without being told what it is called."""
    rc, out = _run("launchctl", "list")
    if rc != 0:
        return {"supervised": None, "how": None, "detail": "launchctl would not answer"}
    me = str(os.getpid())
    label = next((parts[2] for line in out.splitlines()
                  if len(parts := line.split("\t")) >= 3 and parts[0] == me), None)
    if label is None:
        # Parent is launchd but no job claims this pid: started some other way
        # by something that launchd happens to own. Not a claim worth making.
        if os.getppid() == 1:
            return {"supervised": None, "how": None,
                    "detail": "launchd is the parent but no job claims this process"}
        return {"supervised": False, "how": None,
                "detail": "started by hand — nothing would bring it back"}
    how = f"launchd:{label}"
    rc, info = _run("launchctl", "print", f"gui/{os.getuid()}/{label}")
    if rc != 0:
        return {"supervised": None, "how": how, "detail": "could not read the job's properties"}
    # launchctl prints them as one line: "properties = keepalive | runatload | …"
    props = next((ln for ln in info.splitlines() if "properties =" in ln), "")
    if "keepalive" in props.lower():
        return {"supervised": True, "how": how, "detail": None}
    return {"supervised": False, "how": how,
            "detail": "this launchd job has no KeepAlive, so it would not come back"}


def _systemd() -> dict:
    """Linux. A --user unit answers for itself; anything else is a guess."""
    rc, out = _run("systemctl", "--user", "show", "remote-ai-chat",
                   "--property=Restart", "--property=MainPID")
    if rc != 0:
        return {"supervised": None if os.getppid() == 1 else False, "how": None,
                "detail": "no systemd --user unit answers for this daemon"}
    fields = dict(ln.split("=", 1) for ln in out.splitlines() if "=" in ln)
    if fields.get("MainPID") != str(os.getpid()):
        return {"supervised": None, "how": None,
                "detail": "a unit exists but this is not the process it runs"}
    restart = (fields.get("Restart") or "no").strip()
    how = "systemd:remote-ai-chat"
    if restart in ("no", ""):
        return {"supervised": False, "how": how,
                "detail": f"the unit's Restart is {restart!r}, so it would not come back"}
    return {"supervised": True, "how": how, "detail": None}


def supervisor() -> dict:
    """Who, if anyone, would start this process again."""
    try:
        if sys.platform == "darwin":
            return _launchd()
        if sys.platform.startswith("linux"):
            return _systemd()
        # Windows autostart is a scheduled task or a Run key, created by
        # install.ps1. Neither leaves a handle this process can read back, and
        # a Run key in particular only fires at logon — so the truthful answer
        # is that nobody here knows.
        return {"supervised": None, "how": None,
                "detail": "this platform's autostart cannot be read from inside the process"}
    except Exception as exc:                                    # never the reason a restart fails
        return {"supervised": None, "how": None, "detail": str(exc)[:120]}
