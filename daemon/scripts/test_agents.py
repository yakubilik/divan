#!/usr/bin/env python3
"""An installed agent is the whole agent, and says what it can reach.

    .venv312/bin/python scripts/test_agents.py

Two failures hid behind one symptom. A bundle is forty-odd files fetched one
after another, and a fetch that failed was skipped without a word: Hermes
arrived once without hermes-persona and simply felt like no one in particular,
sixteen skills of forty-six, reported as a success. Separately, the list of
abilities written into the agent file was built from that one install, so it
never mentioned the skills the machine already shared, and a skill added
afterwards never appeared at all.

Nothing here touches the network: the tree and the fetch are both replaced.
"""
from __future__ import annotations

import logging
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from remote_ai_chat import agents                                # noqa: E402

failures = 0


def check(ok: bool, label: str, detail: str = "") -> None:
    global failures
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}" + (f"   {detail}" if detail and not ok else ""))
    if not ok:
        failures += 1


def skill(root: Path, name: str) -> None:
    """A skill already on disk, as a shared one appears to an account."""
    (root / name).mkdir(parents=True, exist_ok=True)
    (root / name / "SKILL.md").write_text("---\nname: x\ndescription: x\n---\n")


SRC = dict(agents._BY_ID["hermes"])
TREE = [f"master/skills/{n}/SKILL.md"
        for n in ("hermes-persona", "hermes-route", "arxiv", "chroma")]
BLOB = b"---\nname: t\ndescription: t\n---\nbody"


def skills_line(path: str) -> str:
    for line in Path(path).read_text().splitlines():
        if line.startswith("Skills available to you:"):
            return line
    return ""


print("the list an agent is given")
with tempfile.TemporaryDirectory() as td:
    root = Path(td) / "skills"
    skill(root, "alpha")
    skill(root, "beta")
    (root / "synced" / "bucket").mkdir(parents=True)     # no SKILL.md of its own
    line = [l for l in agents.bundle_file(SRC, ["gamma"], root).splitlines()
            if l.startswith("Skills available")][0]
    check("alpha" in line and "beta" in line, "names what was already on disk", line)
    check("gamma" in line, "names what this install fetched", line)
    check("synced" not in line, "leaves a folder that is not a skill out", line)
    check("alpha" not in agents.bundle_file(SRC, ["gamma"]), "reads disk only when given it")

print("a fetch that keeps failing")
tries = {"n": 0}


class Resp:
    def read(self, cap): return b"payload"
    def __enter__(self): return self
    def __exit__(self, *a): return False


import urllib.request                                            # noqa: E402

real_open, real_sleep = urllib.request.urlopen, agents.time.sleep
agents.time.sleep = lambda s: None
try:
    def flaky(req, timeout=None):
        tries["n"] += 1
        if tries["n"] < 3:
            raise OSError("connection reset")
        return Resp()

    urllib.request.urlopen = flaky
    check(agents._get("https://example/x") == b"payload" and tries["n"] == 3,
          "a blip is retried, not counted as a missing skill", f"tries={tries['n']}")

    urllib.request.urlopen = lambda req, timeout=None: (_ for _ in ()).throw(OSError("dead"))
    try:
        agents._get("https://example/x")
        check(False, "a fetch that never works still raises")
    except OSError:
        check(True, "a fetch that never works still raises")
finally:
    urllib.request.urlopen, agents.time.sleep = real_open, real_sleep

print("an install that only half worked")
real_tree, real_get = agents._tree, agents._get
agents._tree = lambda repo, branch="main": TREE
try:
    def half(url, **kw):
        if "hermes-persona" in url or "chroma" in url:
            raise OSError("rate limited")
        return BLOB

    agents._get = half
    logging.getLogger("rac.agents").setLevel(logging.CRITICAL)   # expected, not news
    with tempfile.TemporaryDirectory() as td:
        r = agents.install_bundle(SRC, td)
        check(r["missing"] == ["chroma", "hermes-persona"], "says which skills did not arrive",
              repr(r["missing"]))
        check(r["skills"] == 2, "counts only what arrived", repr(r["skills"]))
        check("hermes-persona" not in skills_line(r["path"]),
              "does not claim an ability it failed to install", skills_line(r["path"]))

    agents._get = lambda url, **kw: BLOB
    with tempfile.TemporaryDirectory() as td:
        skill(Path(td) / "skills", "yakup-projects")
        r = agents.install_bundle(SRC, td)
        line = skills_line(r["path"])
        check(r["missing"] == [], "a whole install reports nothing missing", repr(r["missing"]))
        check("yakup-projects" in line, "keeps a skill the account already had", line)
        check("hermes-persona" in line, "names the one that carries the character", line)
finally:
    agents._tree, agents._get = real_tree, real_get

print(f"\n{'all good' if not failures else str(failures) + ' failed'}")
sys.exit(1 if failures else 0)
