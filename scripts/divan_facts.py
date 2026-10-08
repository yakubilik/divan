#!/usr/bin/env python3
"""What each product on this computer *is*, written into the board.

    python3 scripts/divan_facts.py            # say what would change
    python3 scripts/divan_facts.py --write    # and write it

A board knows what is happening this week. A product's page asks two older
questions — when did this begin, and where is it in its life — and no counter on
this machine can answer either: a repository with three commits a day can be a
dead experiment, and one nobody has touched since May can be the thing paying
for the others. So they are written down, and this is where they are written.

Two rules, and they are the same two the panel draws by:

 · **every date is read off the repository**, not typed here. A milestone names
   the commit, tag or workflow it was read from in its own `note`, so the line
   on the page can be checked against the thing it came from. Where a date is a
   judgement rather than a reading — the day a product was first usable by
   somebody outside — the note says which commit it is being read off, and the
   judgement is visible instead of hidden inside a number.
 · **only what is here is written.** A product this file says nothing about is
   left exactly as it was; this is not a migration and it does not clear a
   field it has no opinion about.

Run it again whenever a product moves: it replaces a product's history rather
than appending to it, so re-reading a repository costs nothing.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "daemon"))

from divan import config  # noqa: E402
from divan.db import DB  # noqa: E402

HOME = Path.home()

#: The products, by the slug two computers match them under. `repo` is the
#: checkout a date is read out of; `started` is which commit of it the product
#: began at, which is the first one unless a product outgrew the repository it
#: started in.
FACTS: dict[str, dict] = {
    "divan": {
        "name": "Divan",
        "kind": "app",
        "summary": "This Mac's coding agents, from a phone: chats, queue, one board.",
        # Used every day by the person who wrote it and by nobody else yet: the
        # phone app is not on any store and the panel is served off this Mac.
        "stage": "build",
        "repo": str(Path(__file__).resolve().parent.parent),
        "milestones": [
            {"first": True, "title": "Project started", "kind": "start",
             "note": "first commit: a phone talking to the Mac's coding agent"},
            {"at": "2026-09-27", "title": "v0.2.0",
             "note": "CHANGELOG: the release the redesign shipped under"},
            {"tag": "pre-divan-2026-09-28", "title": "The panel before the board",
             "note": "tag pre-divan-2026-09-28, kept as the last shape of the old console"},
            {"at": "2026-09-29", "title": "Divan: a product has branches and a board",
             "note": "the day the daemon started owning products instead of folders"},
        ],
    },
    "medkit": {
        "name": "medkit",
        "kind": "web",
        "summary": "Clinical training simulator: take the case, get the debrief.",
        # medkit.clinic has been serving its own API and voice since May; the
        # work on it stopped in September rather than the product did.
        "stage": "live",
        "repo": "~/projects/medkit",
        "milestones": [
            {"first": True, "title": "Project started", "kind": "start",
             "note": "first commit"},
            {"at": "2026-04-29", "title": "Backend on its own machine", "kind": "live",
             "note": "commit: Lightsail backend wired, gating and debrief"},
            {"at": "2026-05-15", "title": "Voice on api.medkit.clinic",
             "note": "commit: LiveKit proxied through the API for browser audio"},
            {"at": "2026-09-24", "title": "Last change so far",
             "note": "most recent commit on main"},
        ],
    },
    "babysee": {
        "name": "babysee",
        "kind": "client-work",
        "summary": "Digital time capsule for babysee.com.tr: a family records, a child opens.",
        # A real backend on its own AWS account with an app that runs on his
        # phone, and no family outside the build using it yet.
        "stage": "beta",
        "repo": "~/projects/babysee/backend",
        "milestones": [
            {"first": True, "title": "Backend begun", "kind": "start",
             "note": "first commit of the backend monorepo"},
            {"repo": "~/projects/babysee/app", "first": True, "title": "The app appears",
             "note": "first commit of the phone app: today, archive, capsule, family"},
            {"at": "2026-09-27", "title": "Beta on real AWS", "kind": "live",
             "note": "commit: beta environment, the API owning its own auth"},
        ],
    },
    "isghocam": {
        "name": "isghocam",
        "kind": "web",
        "summary": "Occupational-safety certification course: lessons, exams, certificate.",
        # isghocam.com has been deployed since the first week and is being
        # measured — Sentry, PostHog, an A/B test — rather than only built.
        "stage": "live",
        "repo": "~/projects/isghocam",
        "milestones": [
            {"first": True, "title": "Project started", "kind": "start",
             "note": "first commit: the learning platform"},
            {"at": "2026-01-04", "title": "Deploying to production", "kind": "live",
             "note": "commit: the production deploy workflow and its API address"},
            {"at": "2026-09-26", "title": "Moved onto the medkit AWS account",
             "note": "commit: backend and frontend deployed to 858509007274"},
            {"at": "2026-09-26", "title": "Security audit closed",
             "note": "commits: two rounds across auth, payment, content and headers"},
        ],
    },
}


def run(repo: Path, *args: str) -> str | None:
    """git, where git can be run. None where the folder is not a checkout —
    a repository that was moved is a gap on a timeline, not a crash."""
    try:
        out = subprocess.run(("git", "-C", str(repo), *args), capture_output=True,
                             text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def first_commit(repo: Path) -> float | None:
    out = run(repo, "log", "--reverse", "--format=%at")
    return float(out.split("\n", 1)[0]) if out else None


def tag_at(repo: Path, tag: str) -> float | None:
    out = run(repo, "log", "-1", "--format=%at", tag)
    return float(out) if out else None


def day(value: str) -> float:
    """A date somebody typed, as noon UTC of that day. Noon and not midnight:
    the page prints a date, and a timestamp on the boundary of a day is the one
    that prints as the day before in half the world."""
    return datetime.strptime(value, "%Y-%m-%d").replace(
        hour=12, tzinfo=timezone.utc).timestamp()


def resolve(spec: dict, default_repo: Path) -> tuple[float | None, str]:
    """One milestone's date, and where it was read from."""
    repo = Path(spec.get("repo", str(default_repo))).expanduser()
    if spec.get("first"):
        return first_commit(repo), f"{repo.name}: first commit"
    if spec.get("tag"):
        return tag_at(repo, spec["tag"]), f"{repo.name}: tag {spec['tag']}"
    return day(spec["at"]), "written date"


def show(when: float | None) -> str:
    return datetime.fromtimestamp(when, timezone.utc).strftime("%Y-%m-%d") if when else "—"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--write", action="store_true", help="write it, rather than say it")
    args = ap.parse_args()

    db = DB(config.DB_PATH)
    board = db.divan
    missing = []
    for slug, facts in FACTS.items():
        project = board.find_project(slug)
        if project is None:
            missing.append(slug)
            continue
        repo = Path(facts["repo"]).expanduser()
        started = first_commit(repo)
        rows = []
        for spec in facts["milestones"]:
            when, source = resolve(spec, repo)
            if when is None:
                print(f"  ! {slug}: {spec.get('title')} — no date could be read ({source})")
                continue
            rows.append({"at": when, "title": spec["title"],
                         "note": spec.get("note", ""), "kind": spec.get("kind", "")})
        rows.sort(key=lambda r: r["at"])

        print(f"\n{project['name']} ({slug})")
        print(f"  kind    {facts['kind']}")
        print(f"  stage   {facts['stage']}")
        print(f"  started {show(started)}  ← {repo.name}: first commit")
        for r in rows:
            mark = f" [{r['kind']}]" if r["kind"] else ""
            print(f"  · {show(r['at'])}  {r['title']}{mark}  — {r['note']}")

        if args.write:
            board.update_project(
                project["id"], name=facts["name"], kind=facts["kind"],
                summary=facts["summary"], stage=facts["stage"],
                **({"started_at": started} if started else {}))
            board.set_milestones(project["id"], rows)

    if missing:
        print(f"\nnot on this computer's board: {', '.join(missing)}")
    print("\nwritten." if args.write else "\nnothing written (--write to write it).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
