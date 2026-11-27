"""A client can write a short note into the daemon's log, and no more than that.

    uv run python -m pytest -q

27 Nov 2026: the phone's send button was tapped ten times and did nothing, and
nothing anywhere recorded it — the phone has no log anybody can read later. The
app now reports a tap its button never answered (`app/src/press.ts`) as a
`client.note`. What is guarded here: the note reaches the log with the device
that sent it, the kind is a plain name, the data is capped, and a device cannot
fill the log with them.
"""
from __future__ import annotations

import asyncio
import logging

from divan.config import Config
from divan.server import Server


class Dev:
    id = "d1"
    name = "iPhone"


def test_a_note_is_logged_capped_and_rate_limited(caplog):
    srv = Server(Config.load())
    caplog.set_level(logging.INFO, logger="rac.server")

    async def run():
        first = await srv.h_client_note(Dev(), {"kind": "send.lost", "data": {"pressIn": True, "ms": 90}})
        odd = await srv.h_client_note(Dev(), {"kind": "Bad Kind\n2026 rac.server ERROR forged", "data": "x" * 5000})
        rest = [await srv.h_client_note(Dev(), {"kind": "n"}) for _ in range(srv.NOTES_PER_MIN + 5)]
        return first, odd, rest

    first, odd, rest = asyncio.run(run())
    lines = [r.getMessage() for r in caplog.records if "client note" in r.getMessage()]
    assert first == {"logged": True}
    assert lines[0] == 'client note from iPhone (d1): send.lost {"pressIn":true,"ms":90}'
    # A kind cannot bring a line break or a fake log line with it, and data is cut.
    assert odd == {"logged": True}
    assert "\n" not in lines[1] and "badkind2026rac.servererrorforged" in lines[1]
    assert len(lines[1]) < 700
    # Twenty a minute, then quiet.
    assert sum(1 for r in rest if r["logged"]) == srv.NOTES_PER_MIN - 2
    assert len(lines) == srv.NOTES_PER_MIN
