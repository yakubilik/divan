"""Keeping every computer on the same commit.

Anyone running this on more than one machine has the same problem: the daemons
have to agree, and none of them should be able to push code at the others. A
machine that could would have to be believed, and there would be no answer to
"which one is right" the day they disagree. So each one follows `origin/main`
on its own. A common source makes drifting apart impossible instead of merely
unlikely.

This is on by default (`auto_update` in config.toml) and is the reason the
daemon can be installed on a laptop you do not sit in front of. Turn it off and
the daemon never touches git.

Both installs are `pip install -e`, so a pull *is* the update: the code on disk
is the code that runs. Dependencies are the exception, and only when
`pyproject.toml` actually changed.

The browser panel is the other exception, and a worse one. `web/` is in git;
`daemon/divan/webui/`, the bundle the daemon actually serves, is build
output and is not. So a pull moves the daemon's Python and leaves the browser on
whatever was built here last — on a machine nobody sits in front of, a panel
drifting weeks behind the daemon serving it, with nothing on screen to say so.
Hence the stamp: the bundle records the commit it was built from, which is the
only way to ask the question, and an update rebuilds it whenever `web/` moved.

Restarting is somebody else's job already. macOS has launchd with
`KeepAlive=true` and Windows has `start.ps1`, and both bring the daemon back
within seconds of it exiting. So the update ends by asking the server to stop,
and the machine's own supervisor starts it again on the new code.

What this will not do:

* touch a repository with uncommitted work in it — that is the development
  machine, mid-thought, and pulling the floor out from under it would be the
  one unforgivable bug here;
* do anything but a fast-forward, so a local commit is never silently dropped;
* interrupt a running turn;
* wait on a credential prompt (a private repo with no cached credentials would
  otherwise hang the fetch forever, invisibly).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import sys
import time
from pathlib import Path
from typing import Awaitable, Callable

log = logging.getLogger("rac.updater")

# How long a git call may take before it is assumed wedged. A fetch over a
# sleepy tailnet is slow; it is not, however, minutes slow.
GIT_TIMEOUT_S = 90

# A cold `npm ci` on a laptop is genuinely slow, and a build that gets killed
# halfway is worse than one that takes five minutes.
NPM_TIMEOUT_S = 900

# What the daemon serves at "/", and the note left inside it saying where it
# came from.
PANEL_DIR = Path(__file__).parent / "webui"
STAMP = "build.json"


def repo_root() -> Path | None:
    """The working copy this daemon is running from, if it is running from one.

    An editable install leaves the package inside the repository, so walking up
    from this file finds it. A copied install has no `.git` and simply never
    updates — correctly, because there would be nothing to pull into.
    """
    for parent in Path(__file__).resolve().parents:
        if (parent / ".git").exists():
            return parent
    return None


async def _git(root: Path, *args: str, timeout: int = GIT_TIMEOUT_S) -> tuple[int, str]:
    """Run git, never interactively.

    `GIT_TERMINAL_PROMPT=0` and the two ssh options below turn "ask for a
    password" into "fail immediately". Against a private repo on a machine whose
    credentials have expired, the alternative is a subprocess that waits for a
    human who is not there, holding the update loop open until the daemon
    restarts.
    """
    env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_ASKPASS": "",
        "GCM_INTERACTIVE": "never",
        "GIT_SSH_COMMAND": "ssh -oBatchMode=yes -oStrictHostKeyChecking=accept-new",
    }
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", *args, cwd=str(root), env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
    except FileNotFoundError:
        return 127, "git not installed"
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        return 124, f"git {args[0]} timed out after {timeout}s"
    return proc.returncode or 0, (out or b"").decode("utf-8", "replace").strip()


async def revision(root: Path | None = None) -> dict:
    """What this computer is actually running.

    The package version is a constant that nobody remembers to raise — both
    machines called themselves 0.1.0 while one was weeks ahead of the other, so
    the number they agreed on was the one thing that could not tell them apart.
    The commit can.
    """
    root = root or repo_root()
    if root is None:
        return {"repo": False}
    rc, out = await _git(root, "log", "-1", "--format=%h%x00%H%x00%cI%x00%s")
    if rc != 0:
        return {"repo": False, "error": out[:200]}
    short, full, when, subject = (out.split("\0") + ["", "", "", ""])[:4]
    _, branch = await _git(root, "rev-parse", "--abbrev-ref", "HEAD")
    _, dirty = await _git(root, "status", "--porcelain")
    return {
        "repo": True, "commit": short, "sha": full, "committed_at": when,
        "subject": subject[:120], "branch": branch,
        "dirty": bool(dirty.strip()),
        "dirty_files": len([l for l in dirty.splitlines() if l.strip()]),
    }


# ── the panel in the browser ───────────────────────────────────────────────

async def panel_state(root: Path | None, head: str | None = None) -> dict:
    """What the browser is being served, and whether it still matches the code.

    `stale` has three answers and the third one matters: True, False, and None
    for a bundle nobody can place — built by hand, or built before this stamp
    existed. Calling that one "current" would be a guess, and the guess is
    wrong exactly on the machine that has been ignored longest.
    """
    built = (PANEL_DIR / "index.html").exists()
    state: dict = {"built": built, "npm": shutil.which("npm") is not None,
                   "sha": None, "built_at": None}
    if not built:
        return {**state, "stale": True, "reason": "no panel has been built here"}
    try:
        stamp = json.loads((PANEL_DIR / STAMP).read_text(encoding="utf-8"))
    except Exception:
        stamp = {}
    sha = stamp.get("sha") or None
    state["sha"] = sha[:7] if sha else None
    state["built_at"] = stamp.get("built_at")
    if root is None or not sha:
        return {**state, "stale": None, "reason": "built outside the updater"}
    head = head or (await revision(root)).get("sha")
    if head and sha == head:
        return {**state, "stale": False, "reason": None}
    # Most commits do not touch `web/`. Asking git which ones did is the
    # difference between rebuilding on every pull and rebuilding when it means
    # something — an npm build is minutes, and minutes spent for nothing are
    # how an automatic update becomes something people turn off.
    rc, out = await _git(root, "diff", "--name-only", sha, head or "HEAD", "--", "web")
    if rc != 0:
        return {**state, "stale": None, "reason": out[:160]}
    changed = bool(out.strip())
    return {**state, "stale": changed,
            "reason": "web/ moved since this build" if changed else None}


def panel_needs_build(panel: dict) -> bool:
    """Whether an update has the panel to do as well.

    Unknown counts as yes, because building it is also what makes it knowable,
    and it only happens once — the build leaves a stamp behind.

    No npm counts as no. A computer without Node cannot rebuild the panel no
    matter how many times it is asked, and a button that is always lit and
    always fails is worse than one that admits what the machine can do.
    """
    if not panel.get("npm"):
        return False
    return panel.get("stale") is not False


async def build_panel(root: Path) -> tuple[bool, str]:
    """`npm run build`, into a directory nobody is serving yet.

    Vite empties its output directory before it writes to it. Building straight
    into `webui/` would therefore hand the browser a 404 for as long as the
    build runs, and forever if it fails — which is the one moment you most want
    the old panel still standing. So it is built to a sibling and swapped in
    only once it has actually produced a page.
    """
    npm = shutil.which("npm")
    if not npm:
        return False, "npm was not found — install Node.js on this computer"
    web = root / "web"
    if not (web / "package.json").exists():
        return False, "this checkout has no web/ to build"

    async def run(*args: str) -> tuple[int, str]:
        try:
            proc = await asyncio.create_subprocess_exec(
                npm, *args, cwd=str(web),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            )
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=NPM_TIMEOUT_S)
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            return 124, f"npm {args[0]} timed out after {NPM_TIMEOUT_S}s"
        except Exception as exc:
            return 1, str(exc)[:300]
        return proc.returncode or 0, (out or b"").decode("utf-8", "replace").strip()

    # `ci` when there is a lockfile: it installs the versions that were tested
    # rather than the newest ones that satisfy the ranges, which is the whole
    # reason the lockfile is committed.
    verb = "ci" if (web / "package-lock.json").exists() else "install"
    rc, out = await run(verb, "--no-audit", "--no-fund")
    if rc != 0:
        return False, f"npm {verb}: {out[-300:]}"

    tmp = PANEL_DIR.parent / f"webui.build-{int(time.time())}"
    shutil.rmtree(tmp, ignore_errors=True)
    # `--emptyOutDir` because the target sits outside the vite root, where vite
    # refuses to clear a directory without being told to.
    rc, out = await run("run", "build", "--", "--outDir", str(tmp), "--emptyOutDir")
    if rc != 0 or not (tmp / "index.html").exists():
        shutil.rmtree(tmp, ignore_errors=True)
        return False, f"vite build: {out[-300:] or 'produced no index.html'}"

    # vite writes this too, and normally gets there first. Written again here
    # so the stamp does not depend on the checkout's vite config having the
    # plugin — an unstamped bundle reads as "cannot be placed", which would
    # make this computer rebuild on every pass forever.
    head = (await revision(root)).get("sha")
    try:
        (tmp / STAMP).write_text(
            json.dumps({"sha": head, "built_at": time.time()}, indent=1),
            encoding="utf-8")
    except Exception as exc:
        shutil.rmtree(tmp, ignore_errors=True)
        return False, f"could not stamp the build: {exc}"

    # The swap. Two renames on the same filesystem, old one first, so there is
    # no instant where the served path is a half-written directory.
    old = PANEL_DIR.parent / f"webui.bak-{int(time.time())}"
    try:
        if PANEL_DIR.exists():
            PANEL_DIR.rename(old)
        tmp.rename(PANEL_DIR)
    except Exception as exc:
        if old.exists() and not PANEL_DIR.exists():
            old.rename(PANEL_DIR)
        shutil.rmtree(tmp, ignore_errors=True)
        return False, f"could not swap the panel in: {exc}"
    shutil.rmtree(old, ignore_errors=True)
    log.info("panel rebuilt at %s", (head or "")[:8])
    return True, (head or "")[:7]


# ── what to call this ──────────────────────────────────────────────────────

_DESCRIBE = re.compile(r"^(?P<tag>.+)-(?P<distance>\d+)-g(?P<commit>[0-9a-f]+)$")


async def release(root: Path | None = None) -> dict:
    """The version this computer is running, said the way a person would.

    Derived from tags, never read from a constant — the constant is exactly
    what went wrong. `__version__` said 0.1.0 on two machines that were weeks
    apart and neither was lying on purpose; nobody remembers to raise a number
    that nothing checks. A tag is a fact somebody had to create on purpose, and
    the distance from it is a fact git can count.

    `v0.2.0` sits exactly on a release. `v0.2.0+7` is seven commits past one,
    which is the normal state of a machine following `main` between releases
    and is worth saying rather than rounding down to the last tag.
    """
    root = root or repo_root()
    blank = {"version": None, "tag": None, "distance": None, "dirty": False, "commit": None}
    if root is None:
        return blank
    rc, out = await _git(root, "describe", "--tags", "--long", "--dirty", "--always")
    if rc != 0:
        return blank
    text = out.strip()
    dirty = text.endswith("-dirty")
    if dirty:
        text = text[: -len("-dirty")]
    m = _DESCRIBE.match(text)
    if not m:
        # No tag anywhere in this history yet — the repository before its first
        # release. A commit is still an answer, just not a version.
        return {**blank, "dirty": dirty, "commit": text or None}
    distance = int(m["distance"])
    version = m["tag"] if distance == 0 else f"{m['tag']}+{distance}"
    return {"version": version, "tag": m["tag"], "distance": distance,
            "dirty": dirty, "commit": m["commit"]}


class Updater:
    """Watches `origin/main` and, when allowed, moves this computer onto it."""

    def __init__(self, cfg, is_idle: Callable[[], bool],
                 announce: Callable[[dict], Awaitable[None]],
                 request_restart: Callable[[], None],
                 record: Callable[[dict], None] | None = None,
                 last_update: dict | None = None):
        self.cfg = cfg
        self.is_idle = is_idle
        self.announce = announce
        self.request_restart = request_restart
        # An update ends by asking the supervisor to stop this process, so the
        # only account of it anybody will ever read is one written down before
        # it goes. Handed in rather than opened here: the updater has no
        # business knowing there is a database.
        self.record = record or (lambda entry: None)
        self.root = repo_root()
        self.state: dict = {
            "repo": self.root is not None,
            "auto": bool(getattr(cfg, "auto_update", True)),
            "behind": 0, "ahead": 0, "checked_at": None,
            "busy": False, "error": None, "local": None, "remote": None,
            # The bundle in the browser, which moves on its own schedule.
            "web": {"built": False, "stale": None, "npm": False,
                    "sha": None, "built_at": None, "reason": None},
            # Versions: what this computer calls itself, and the newest release
            # tagged on origin/main.
            "release": {"version": None, "tag": None, "distance": None,
                        "dirty": False, "commit": None},
            "latest": None,
            # The last time this computer actually moved, from whenever that
            # was — read off disk, because it was a different process.
            "last_update": last_update,
        }
        self._lock = asyncio.Lock()

    # ── reading the world ──────────────────────────────────────────────────
    async def check(self) -> dict:
        """Ask the remote where it is. Cheap, read-only, safe at any moment."""
        if self.root is None:
            self.state["error"] = "not a git checkout"
            return self.state
        async with self._lock:
            # Read locally first. Where this computer stands, and what it is
            # serving, are true whether or not the remote can be reached — and
            # an offline laptop is exactly where someone wants to see them.
            self.state["local"] = local = await revision(self.root)
            self.state["web"] = await panel_state(self.root, local.get("sha"))
            self.state["release"] = await release(self.root)
            # `--tags` as well, because releases are tags and the panel shows
            # both: one fetch answers "which commit" and "which version".
            rc, out = await _git(self.root, "fetch", "--quiet", "--tags", "origin", "main")
            if rc != 0:
                # An unreachable remote is the normal state of a laptop, not an
                # incident. It is recorded and the loop tries again later.
                self.state["error"] = out[:200] or f"git fetch exited {rc}"
                self.state["checked_at"] = time.time()
                return self.state
            self.state["error"] = None
            rc, counts = await _git(self.root, "rev-list", "--left-right", "--count",
                                    "origin/main...HEAD")
            behind = ahead = 0
            if rc == 0 and counts:
                parts = counts.split()
                if len(parts) == 2:
                    behind, ahead = int(parts[0]), int(parts[1])
            # The newest release anyone has tagged, as opposed to the newest
            # commit. A machine can be current on one and behind on the other.
            rc_t, tag = await _git(self.root, "describe", "--tags", "--abbrev=0", "origin/main")
            self.state["latest"] = tag.strip() if rc_t == 0 and tag.strip() else None
            rc, head = await _git(self.root, "log", "-1", "--format=%h%x00%cI%x00%s",
                                  "origin/main")
            if rc == 0:
                c, when, subject = (head.split("\0") + ["", "", ""])[:3]
                self.state["remote"] = {"commit": c, "committed_at": when,
                                        "subject": subject[:120]}
            self.state["behind"] = behind
            self.state["ahead"] = ahead
            self.state["checked_at"] = time.time()
            return self.state

    def blockers(self) -> list[str]:
        """Why an update cannot run right now, in words a phone can show."""
        out: list[str] = []
        if self.root is None:
            out.append("not a git checkout")
            return out
        if self.state.get("behind", 0) <= 0 and not panel_needs_build(self.state.get("web") or {}):
            out.append("already up to date")
        if (self.state.get("local") or {}).get("dirty"):
            out.append("uncommitted changes")
        if self.state.get("ahead", 0) > 0:
            out.append("unpushed commits")
        if not self.is_idle():
            out.append("a turn is running")
        return out

    # ── changing the world ─────────────────────────────────────────────────
    async def apply(self, force: bool = False) -> dict:
        """Fast-forward onto `origin/main`, rebuild the panel, hand over to the
        supervisor.

        Two jobs behind one button, because they are one thing to whoever
        pressed it: a computer that is on the current commit but serving a
        panel from three weeks ago is not updated. Either half can be the only
        work there is — a commit that only touched `web/` needs no restart, and
        a checkout that is already current can still owe a rebuild.

        `force` waives only *waiting* — being behind, and being idle. It never
        waives a dirty tree or unpushed commits, because those are somebody's
        work and this function is not entitled to decide they are expendable.
        """
        if self.root is None:
            return {"ok": False, "error": "not a git checkout"}
        if self.state.get("checked_at") is None:
            await self.check()

        local = self.state.get("local") or await revision(self.root)
        behind = self.state.get("behind", 0)
        web_todo = panel_needs_build(self.state.get("web") or {})
        if local.get("dirty"):
            return {"ok": False, "error": "uncommitted changes — refusing to touch this checkout"}
        if self.state.get("ahead", 0) > 0:
            return {"ok": False, "error": "this checkout has commits that were never pushed"}
        if not force:
            if behind <= 0 and not web_todo:
                return {"ok": False, "error": "already up to date"}
            if not self.is_idle():
                return {"ok": False, "error": "a turn is running"}

        async with self._lock:
            self.state["busy"] = True
            try:
                before = (await revision(self.root)).get("sha")
                pulled = False
                if behind > 0:
                    # Only ever a fast-forward: if the histories have diverged
                    # the pull fails and the machine stays where it is, which is
                    # the right outcome — a merge here would be a robot's guess
                    # at what somebody meant.
                    rc, out = await _git(self.root, "merge", "--ff-only", "origin/main")
                    if rc != 0:
                        return {"ok": False, "error": f"fast-forward failed: {out[:300]}"}
                    pulled = True
                after = await revision(self.root)

                if pulled:
                    log.info("updated %s -> %s", (before or "")[:8], after.get("commit"))
                    if await self._deps_changed(before, after.get("sha")):
                        ok, detail = await self._install_deps()
                        if not ok:
                            await self._rollback(before)
                            return {"ok": False, "error": f"dependency install failed: {detail}"}

                    ok, detail = await self._smoke()
                    if not ok:
                        await self._rollback(before)
                        return {"ok": False, "error": f"new code failed to import: {detail}"}

                # Asked again rather than reused: the pull is what decides
                # whether the panel owes a rebuild, so the answer from before
                # the merge is the wrong one.
                panel = await panel_state(self.root, after.get("sha"))
                web: dict = {"rebuilt": False, "error": None}
                restart = pulled
                if panel_needs_build(panel):
                    # Nothing is mounted at "/" when the daemon started without
                    # a panel, so building one is not enough to serve it.
                    unserved = not panel.get("built")
                    ok, detail = await build_panel(self.root)
                    web = {"rebuilt": ok, "commit": detail if ok else None,
                           "error": None if ok else detail}
                    if ok and unserved:
                        restart = True

                self.state["local"] = after
                self.state["behind"] = 0
                self.state["web"] = await panel_state(self.root, after.get("sha"))
                self.state["release"] = rel = await release(self.root)
                if not pulled and not web["rebuilt"] and not web["error"]:
                    return {"ok": False, "error": "already up to date"}

                # A panel that would not build is not a reason to undo a daemon
                # that did: the Python has already been imported cleanly, and
                # the browser is still being served the older bundle rather than
                # nothing. It is reported, loudly, and the machine keeps the
                # half it got.
                error = None
                if web["error"]:
                    error = (f"the daemon updated, but the panel did not rebuild: {web['error']}"
                             if pulled else f"the panel did not rebuild: {web['error']}")

                # Written before the restart is asked for, and before the
                # announcement: the next process to run is the one that will
                # have to say what this one did.
                entry = {
                    "at": time.time(),
                    "from": (before or "")[:7] or None, "to": after.get("commit"),
                    "version": rel.get("version"), "subject": after.get("subject"),
                    "pulled": pulled, "web": bool(web["rebuilt"]), "error": error,
                }
                self.state["last_update"] = entry
                try:
                    self.record(entry)
                except Exception:
                    log.warning("could not write down the update", exc_info=True)

                await self.announce({"event": "update.applied", "revision": after,
                                     "web": self.state["web"], "release": rel,
                                     "last_update": entry, "error": error})
                if restart:
                    # Everything past this point runs on the old code, so there
                    # is nothing left worth doing here. The supervisor restarts
                    # us.
                    self.request_restart()
                return {"ok": error is None, "error": error, "revision": after,
                        "pulled": pulled, "web": web, "restarting": restart}
            finally:
                self.state["busy"] = False

    async def _deps_changed(self, before: str | None, after: str | None) -> bool:
        if not before or not after or before == after:
            return False
        rc, out = await _git(self.root, "diff", "--name-only", before, after,
                             "--", "daemon/pyproject.toml")
        return rc == 0 and bool(out.strip())

    async def _install_deps(self) -> tuple[bool, str]:
        """Re-install into the venv this daemon is running from."""
        daemon_dir = str(self.root / "daemon")
        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable, "-m", "pip", "install", "--quiet", "-e", daemon_dir,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            )
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=600)
        except Exception as exc:
            return False, str(exc)[:300]
        text = (out or b"").decode("utf-8", "replace").strip()
        return (proc.returncode == 0), text[-300:]

    async def _smoke(self) -> tuple[bool, str]:
        """Import the freshly pulled package in a separate process.

        A syntax error in the new code would otherwise only be discovered after
        the restart — by a supervisor dutifully restarting a daemon that cannot
        start, forever, on a machine nobody is sitting at.
        """
        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable, "-c",
                # `server` pulls in everything that matters, this module
                # included. Naming modules individually would make the check
                # fail the day one of them is renamed — which is exactly the
                # kind of change worth shipping.
                "import divan, divan.server",
                cwd=str(self.root / "daemon"),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            )
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=120)
        except Exception as exc:
            return False, str(exc)[:300]
        text = (out or b"").decode("utf-8", "replace").strip()
        return (proc.returncode == 0), text[-300:]

    async def _rollback(self, sha: str | None) -> None:
        if not sha:
            return
        rc, out = await _git(self.root, "reset", "--hard", sha)
        log.warning("rolled back to %s (%s)", sha[:8], "ok" if rc == 0 else out[:200])

    # ── the loop ───────────────────────────────────────────────────────────
    async def loop(self) -> None:
        if self.root is None:
            log.info("updater: not a git checkout, staying put")
            return
        # Read where we are straight away, so the phone can show a commit
        # rather than a blank the moment it connects.
        self.state["local"] = await revision(self.root)
        self.state["web"] = await panel_state(self.root, self.state["local"].get("sha"))
        self.state["release"] = await release(self.root)
        interval = max(120, int(getattr(self.cfg, "update_interval_s", 900)))
        # Not the fetch, though: a daemon that just restarted may well be a daemon
        # this loop restarted, and a crash loop should not be able to turn into
        # a pull loop.
        await asyncio.sleep(60)
        while True:
            try:
                await self.check()
                behind = self.state.get("behind", 0)
                web_todo = panel_needs_build(self.state.get("web") or {})
                if behind > 0 or web_todo:
                    await self.announce({"event": "update.available", **self.state})
                    if self.state["auto"]:
                        blocked = self.blockers()
                        if blocked:
                            log.info("update available (%d behind%s) but held: %s",
                                     behind, ", panel stale" if web_todo else "",
                                     ", ".join(blocked))
                        else:
                            log.info("update available (%d behind%s) — applying",
                                     behind, ", panel stale" if web_todo else "")
                            res = await self.apply()
                            if not res.get("ok"):
                                log.warning("update failed: %s", res.get("error"))
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("updater: %s", exc)
            await asyncio.sleep(interval)
