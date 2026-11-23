"""The office tap speaks pixtuoid's socket protocol both ways (office.py)."""
import asyncio
import os
import shutil
import tempfile
from pathlib import Path

from divan.office import SUBSCRIBE, SUBSCRIBED, OfficeTap

LINE = '{"_pixtuoid_source":"claude-code","hook_event_name":"SessionStart","session_id":"s1","cwd":"/tmp"}'


def _sock_dir() -> Path:
    # A unix socket path must stay short, so not pytest's tmp_path.
    d = Path(tempfile.mkdtemp(prefix="px", dir="/tmp"))
    os.chmod(d, 0o700)
    return d


async def _send(path: Path, data: bytes) -> None:
    _, w = await asyncio.open_unix_connection(str(path))
    w.write(data)
    await w.drain()
    w.close()


def test_owns_a_free_socket_keeps_lines_and_relays_them():
    d = _sock_dir()

    async def run():
        tap = OfficeTap(d / "pixtuoid.sock")
        task = asyncio.create_task(tap.run())
        for _ in range(50):
            if tap.mode == "owner":
                break
            await asyncio.sleep(0.02)
        assert tap.mode == "owner"
        # a second pixtuoid subscribes to us
        r, w = await asyncio.open_unix_connection(str(d / "pixtuoid.sock"))
        w.write(SUBSCRIBE)
        await w.drain()
        assert await r.readline() == SUBSCRIBED
        q = tap.watch()
        await _send(d / "pixtuoid.sock", (LINE + "\n").encode())
        t, line = await asyncio.wait_for(q.get(), 2)
        assert line == LINE
        assert (await asyncio.wait_for(r.readline(), 2)).decode().strip() == LINE
        assert [l for _, l in tap.backlog()] == [LINE]
        w.close()
        task.cancel()

    try:
        asyncio.run(run())
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_subscribes_to_a_live_owner():
    d = _sock_dir()
    path = d / "pixtuoid.sock"

    async def run():
        subs: list[asyncio.StreamWriter] = []

        async def owner(r, w):
            if await r.readline() == SUBSCRIBE:
                w.write(SUBSCRIBED)
                await w.drain()
                subs.append(w)

        server = await asyncio.start_unix_server(owner, path=str(path))
        tap = OfficeTap(path)
        task = asyncio.create_task(tap.run())
        for _ in range(50):
            if subs:
                break
            await asyncio.sleep(0.02)
        assert tap.mode == "subscribed"
        q = tap.watch()
        subs[0].write((LINE + "\n").encode())
        await subs[0].drain()
        _, line = await asyncio.wait_for(q.get(), 2)
        assert line == LINE
        task.cancel()
        server.close()

    try:
        asyncio.run(run())
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_divan_chats_become_hook_lines_in_their_rooms():
    import json as _json
    from divan.office import DivanOffice

    class Tap:
        on_line = None
        def backlog(self):
            return []

    chats = [{"id": "abcdef123456", "title": "Fix login", "project": "Babysee", "status": "idle",
              "archived": 0, "created_at": 1000.0, "updated_at": 2000.0}]
    feed = DivanOffice(Tap(), lambda: chats)
    back = feed.backlog()
    assert [(_json.loads(l)["hook_event_name"], r) for _, l, r in back] == [("SessionStart", "Babysee"), ("Stop", "Babysee")]
    assert feed.rooms()["chats"]["abcdef12"]["title"] == "Fix login"

    async def run():
        q = feed.watch()
        feed.observe({"event": "tool.use", "chat_id": "abcdef123456", "data": {"id": "t1", "tool": "Bash", "input": {"command": "ls"}}})
        kind, _, line, room = q.get_nowait()
        body = _json.loads(line)
        assert (kind, body["hook_event_name"], body["tool_name"], body["session_id"], room) == \
            ("line", "PreToolUse", "Bash", "abcdef123456", "Babysee")

    asyncio.run(run())
