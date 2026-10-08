"""LEGACY NAME BLOCK — the only place in the daemon that spells the old name.

The product was renamed to Divan. Everything the daemon writes carries the new
name; what is listed here is what it still has to *recognise* from before, and
each entry says why. Nothing else in the package may spell the old name
(scripts/test_no_old_name.py holds it to that), so a compatibility that is no
longer needed is deleted from this one file.
"""
from __future__ import annotations

from pathlib import Path

# (a) The deep-link scheme an old QR code or an installed old build carries.
#     The daemon only prints links; the app and the web panel are what read
#     them, and each has its own marked block for this.
SCHEME = "remoteaichat"

# (b) The data home before the rename. Used only when ~/.divan does not exist
#     and DIVAN_HOME is unset, so an install that has not run
#     scripts/migrate_to_divan.py yet keeps its config and database.
HOME_NAME = ".remote-ai-chat"

# (c) The variable agent processes were told their chat id in. It is exported
#     next to DIVAN_CHAT_ID until every reader (the ticket queue's `note`
#     command is one) has switched over.
CHAT_ID_ENV = "RAC_CHAT_ID"

# What follows from (b): an old install is still on disk under these names, or
# is reachable through the symlink the migration leaves behind, so the guards
# and the uninstaller have to know them as well as the new ones.
PROCESS_PATTERN = r"remote[-_]ai[-_]chat"
PLIST_LABEL = "com.remote-ai-chat.daemon"


def plist_labels(user: str) -> list[str]:
    """The launchd labels an old install was registered under."""
    return [PLIST_LABEL, f"com.{user}.remote-ai-chat"]


def fallback_home(home: Path) -> Path | None:
    """The old data home under `home`, if it is still there."""
    old = home / HOME_NAME
    return old if old.exists() else None


def chat_env(chat_id: str) -> dict[str, str]:
    """The legacy half of what a chat's process is told about itself."""
    return {CHAT_ID_ENV: chat_id}
