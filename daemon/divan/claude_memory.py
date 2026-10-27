"""One Claude memory for every Claude account on this computer.

Claude Code keeps its auto-memory per project at
`<config dir>/projects/<sanitized cwd>/memory/`. Every Divan account is its own
config dir, so without this a chat that moves to another account, or a freshly
added account, starts with none of what the others learned.

The canonical place is `~/.claude/projects/<sanitized cwd>/memory/`, which is
where Claude Code itself looks when no account is chosen, so a terminal session
shares it too. Each account's own `projects/<sanitized cwd>/memory` becomes a
symlink to it. Only the memory folder is linked: the transcripts beside it
(`projects/<x>/*.jsonl`) stay with the account that wrote them.

Standard library only: scripts/share_claude_memory.py imports this before the
daemon's own dependencies are necessarily there.
"""
from __future__ import annotations

import filecmp
import re
import shutil
import tarfile
import time
from pathlib import Path

MEMORY = "memory"
INDEX = "MEMORY.md"
# Claude Code: `name.replace(/[^a-zA-Z0-9]/g, "-")`, and past 200 characters
# the first 200 plus "-" and the base-36 of a 32-bit string hash.
_UNSAFE = re.compile(r"[^a-zA-Z0-9]")
_MAX = 200


def default_claude_home() -> Path:
    return Path.home() / ".claude"


def _hash36(s: str) -> str:
    h = 0
    raw = s.encode("utf-16-le")             # JS charCodeAt walks UTF-16 units
    for i in range(0, len(raw), 2):
        h = (h * 31 + int.from_bytes(raw[i:i + 2], "little")) & 0xFFFFFFFF
    if h >= 1 << 31:
        h -= 1 << 32
    n, out = abs(h), ""
    while True:
        n, r = divmod(n, 36)
        out = "0123456789abcdefghijklmnopqrstuvwxyz"[r] + out
        if not n:
            return out


def sanitize(cwd: str) -> str:
    """The folder name Claude Code gives a working directory under projects/."""
    s = _UNSAFE.sub("-", cwd)
    if len(s) <= _MAX:
        return s
    return f"{s[:_MAX]}-{_hash36(cwd)}"


def canonical_dir(name: str, claude_home: Path | None = None) -> Path:
    return (claude_home or default_claude_home()) / "projects" / name / MEMORY


# ── merging ───────────────────────────────────────────────────────────────

def _free_name(dst_dir: Path, rel: Path, suffix: str) -> Path:
    stem, ext = rel.stem, rel.suffix
    n = 0
    while True:
        tag = suffix if n == 0 else f"{suffix}-{n}"
        cand = dst_dir / rel.with_name(f"{stem}-{tag}{ext}")
        if not cand.exists():
            return cand
        n += 1


def _union_index(src: Path, dst: Path, renamed: dict[str, str]) -> bool:
    """Append src's index lines that dst lacks. Links to a file that was kept
    under a suffixed name point at that name. Returns whether dst changed."""
    have = dst.read_text(encoding="utf-8", errors="replace").splitlines()
    seen = {ln.strip() for ln in have if ln.strip()}
    add = []
    for ln in src.read_text(encoding="utf-8", errors="replace").splitlines():
        for old, new in renamed.items():
            ln = ln.replace(f"({old})", f"({new})")
        if ln.strip() and ln.strip() not in seen:
            seen.add(ln.strip())
            add.append(ln)
    if not add:
        return False
    text = "\n".join(have).rstrip("\n")
    dst.write_text((text + "\n" if text else "") + "\n".join(add) + "\n", encoding="utf-8")
    return True


def merge_dir(src: Path, dst: Path, suffix: str) -> dict:
    """Copy every file of src into dst without losing one.

    Same name and content: nothing to do. Same name, other content: src's copy
    is kept beside it as `<stem>-<suffix><ext>` and reported. MEMORY.md is the
    exception: its lines are unioned, so the index lists both sides once.
    src is left as it was."""
    dst.mkdir(parents=True, exist_ok=True)
    copied, conflicts, renamed = [], [], {}
    indexes = []
    for f in sorted(p for p in src.rglob("*") if p.is_file() or p.is_symlink()):
        if f.is_symlink() and not f.exists():
            continue
        rel = f.relative_to(src)
        if rel.name == INDEX:
            indexes.append(rel)
            continue
        target = dst / rel
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, target)
            copied.append(str(rel))
            continue
        if filecmp.cmp(f, target, shallow=False):
            continue
        # a previous merge may already have kept this very copy
        kept = None
        stem, ext, n = rel.stem, rel.suffix, 0
        while True:
            cand = dst / rel.with_name(f"{stem}-{suffix if n == 0 else f'{suffix}-{n}'}{ext}")
            if not cand.exists():
                break
            if filecmp.cmp(f, cand, shallow=False):
                kept = cand
                break
            n += 1
        if kept is None:
            kept = _free_name(dst, rel, suffix)
            shutil.copy2(f, kept)
            conflicts.append({"file": str(rel), "kept_as": str(kept.relative_to(dst))})
        renamed[rel.name] = kept.name
    index_changed = False
    for rel in indexes:
        target = dst / rel
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src / rel, target)
            index_changed = True
            if renamed and rel.parent == Path("."):
                text = target.read_text(encoding="utf-8", errors="replace")
                for old, new in renamed.items():
                    text = text.replace(f"({old})", f"({new})")
                target.write_text(text, encoding="utf-8")
        elif _union_index(src / rel, target, renamed if rel.parent == Path(".") else {}):
            index_changed = True
    return {"copied": copied, "conflicts": conflicts, "index_changed": index_changed}


def backup(dirs: list[tuple[str, Path]], rollback_dir: Path, tag: str) -> Path:
    """Tar every (archive name, folder) pair into rollback_dir before anything
    is changed. Returns the archive."""
    rollback_dir.mkdir(parents=True, exist_ok=True)
    out = rollback_dir / f"{tag}-{time.strftime('%Y%m%d-%H%M%S')}-{time.time_ns() % 10**6:06d}.tar.gz"
    with tarfile.open(out, "w:gz") as tar:
        for arc, path in dirs:
            tar.add(path, arcname=arc)
    return out


# ── linking ───────────────────────────────────────────────────────────────

def _is_link_to(p: Path, target: Path) -> bool:
    if not p.is_symlink():
        return False
    try:
        return p.resolve() == target.resolve()
    except OSError:
        return False


def link_one(account_home: Path, name: str, claude_home: Path | None = None,
             rollback_dir: Path | None = None) -> dict:
    """Make `<account_home>/projects/<name>/memory` a symlink to the canonical
    memory dir, creating that if missing. A real memory dir already there is
    merged in first (and backed up when rollback_dir is given) and only then
    replaced. Nothing else under projects/<name> is touched."""
    claude_home = claude_home or default_claude_home()
    canon = canonical_dir(name, claude_home)
    proj = account_home / "projects" / name
    mem = proj / MEMORY
    result = {"account": account_home.name, "project": name, "action": "none",
              "conflicts": [], "copied": []}
    try:
        if account_home.resolve() == claude_home.resolve():
            return result                      # this is the canonical home itself
    except OSError:
        pass
    canon.mkdir(parents=True, exist_ok=True)
    if _is_link_to(mem, canon):
        return result
    proj.mkdir(parents=True, exist_ok=True)
    if mem.is_symlink():                       # dangling, or pointing elsewhere
        mem.unlink()
    elif mem.is_dir():
        if rollback_dir is not None:
            backup([(f"{account_home.name}/projects/{name}/{MEMORY}", mem)],
                   rollback_dir, "claude-memory")
        merged = merge_dir(mem, canon, account_home.name)
        result.update(copied=merged["copied"], conflicts=merged["conflicts"])
        shutil.rmtree(mem)
        result["action"] = "merged"
    elif mem.exists():                         # a stray file where the dir goes
        return result
    try:
        mem.symlink_to(canon, target_is_directory=True)
    except FileExistsError:
        if not _is_link_to(mem, canon):
            raise
        return result
    if result["action"] == "none":
        result["action"] = "linked"
    return result


def link_project(account_home: str | Path, cwd: str, claude_home: Path | None = None,
                 rollback_dir: Path | None = None) -> dict:
    """Before a Claude session starts in cwd under this account's config dir."""
    return link_one(Path(account_home), sanitize(cwd), claude_home, rollback_dir)


def link_all_known(account_home: str | Path, claude_home: Path | None = None) -> list[dict]:
    """Link every project that already has a canonical memory dir: a new
    account knows everything from its first chat, whatever the folder."""
    claude_home = claude_home or default_claude_home()
    root = claude_home / "projects"
    out = []
    if not root.is_dir():
        return out
    for d in sorted(root.iterdir()):
        if (d / MEMORY).is_dir():
            out.append(link_one(Path(account_home), d.name, claude_home))
    return out


# ── the one-off migration ─────────────────────────────────────────────────

def claude_account_homes(accounts_dirs: list[Path]) -> list[Path]:
    """Claude account homes (claude-*) under the given folders, each once even
    when two folders are the same one (~/.remote-ai-chat → ~/.divan)."""
    seen, out = set(), []
    for root in accounts_dirs:
        if not root.is_dir():
            continue
        for d in sorted(root.iterdir()):
            if not d.name.startswith("claude-") or not d.is_dir():
                continue
            key = d.resolve()
            if key not in seen:
                seen.add(key)
                out.append(d)
    return out


def plan(homes: list[Path], claude_home: Path) -> list[tuple[Path, str]]:
    """(account home, project name) pairs whose memory is a real folder."""
    todo = []
    for home in homes:
        projects = home / "projects"
        if not projects.is_dir():
            continue
        for p in sorted(projects.iterdir()):
            mem = p / MEMORY
            if p.is_dir() and mem.is_dir() and not mem.is_symlink():
                todo.append((home, p.name))
    return todo


def migrate(homes: list[Path], claude_home: Path, rollback_dir: Path,
            dry_run: bool = False) -> dict:
    """Merge every account's real memory dirs into the canonical ones and
    replace each with a symlink. Everything that will change is tarred into
    rollback_dir first. When nothing is left to merge it changes nothing."""
    todo = plan(homes, claude_home)
    report = {"backup": None, "merged": [], "conflicts": [], "dry_run": dry_run}
    if not todo:
        return report
    if dry_run:
        report["merged"] = [{"account": h.name, "project": n} for h, n in todo]
        return report
    to_save = [(f"{h.name}/projects/{n}/{MEMORY}", h / "projects" / n / MEMORY) for h, n in todo]
    names = sorted({n for _, n in todo})
    to_save += [(f"canonical/projects/{n}/{MEMORY}", canonical_dir(n, claude_home))
                for n in names if canonical_dir(n, claude_home).is_dir()]
    report["backup"] = str(backup(to_save, rollback_dir, "claude-memory"))
    for home, name in todo:
        r = link_one(home, name, claude_home)
        report["merged"].append({"account": home.name, "project": name,
                                 "copied": len(r["copied"])})
        for c in r["conflicts"]:
            report["conflicts"].append({"account": home.name, "project": name, **c})
    return report
