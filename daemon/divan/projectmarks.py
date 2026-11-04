"""The picture each product wears on its chat rows.

A list of chats from six products, every row drawn with the same tool icon,
says nothing about which product a chat is work on until its title is read.
So a product can have a picture — its own logo where it has one — and every
chat filed under it shows that picture in place of the tool's icon.

The pictures are plain files, `<data home>/project-icons/<slug>.png`, square
and small (128 px is plenty for a 26 px row). They travel inside `chat.list`
as data URIs: a handful of products, a few kilobytes each, and no second
request, no token on a URL, nothing for a phone to cache wrongly.
"""
from __future__ import annotations

import base64
from pathlib import Path

from .config import CONFIG_DIR

DIR = CONFIG_DIR / "project-icons"
MAX_BYTES = 64 * 1024        # a row icon; anything bigger is a mistake, not a logo

_cache: dict[Path, tuple[float, str]] = {}


def _data_uri(path: Path) -> str | None:
    try:
        st = path.stat()
    except OSError:
        return None
    if st.st_size > MAX_BYTES:
        return None
    hit = _cache.get(path)
    if hit and hit[0] == st.st_mtime:
        return hit[1]
    try:
        uri = "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()
    except OSError:
        return None
    _cache[path] = (st.st_mtime, uri)
    return uri


def marks(projects: list[dict], folder: Path | None = None) -> dict[str, dict]:
    """`{project id: {image, label}}` for every product that has a picture.

    `projects` are rows with `id`, `name` and `slug`."""
    folder = folder or DIR
    out: dict[str, dict] = {}
    for p in projects:
        uri = _data_uri(folder / f"{p['slug']}.png")
        if uri:
            out[p["id"]] = {"image": uri, "label": p["name"]}
    return out
