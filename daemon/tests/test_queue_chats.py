"""Every queue notification that needs the owner lands in a chat he can answer.

    uv run python -m pytest -q tests/test_queue_chats.py

A ticket filed from a chat (`card.origin_chat`) has always woken that chat.
Everything else the queue sent — a ticket filed from the CLI, the night watch,
triage, an escalation — reached Yakup only as a banner that opened the wall.
What is guarded here:

  * an origin-less ticket's notifications open one Hermes chat (chat.create, on
    the owner's accounts in the queue's order) and every later one is posted
    there (chat.send) — one create, two sends for two notifications;
  * a ticket with an origin chat still goes to that chat, and only there;
  * the same notification read again after a restart opens no second chat and
    is not posted twice;
  * the message tells Hermes to lead with what Yakup has to do;
  * the queue's push asks the daemon for the chat and carries its id, and the
    banner says nothing more than it did;
  * the inbox hands each notification out with the chat it went to.

The queue's database belongs to another program, so its tables are built here
by hand from its shape.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

import pytest

HOME = tempfile.mkdtemp(prefix="divan-queuechat-")
QUEUE = Path(tempfile.mkdtemp(prefix="divan-queuechat-q-"))
os.environ["DIVAN_HOME"] = HOME
os.environ["USTABASI_STATE_DIR"] = str(QUEUE / "state")
os.environ["USTABASI_CLI"] = str(QUEUE / "bin" / "ustabasi")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan import accounts as acct  # noqa: E402
from divan import push as pushmod  # noqa: E402
from divan import server as servermod  # noqa: E402
from divan import ustabasi as u  # noqa: E402
from divan.config import Config  # noqa: E402
from divan.server import Server  # noqa: E402

YAKUP, BEDRIYAN = "claude-759b47", "claude-37a8a4"


def queue_db(root: Path) -> sqlite3.Connection:
    (QUEUE / "state").mkdir(parents=True, exist_ok=True)
    (QUEUE / "bin").mkdir(parents=True, exist_ok=True)
    (QUEUE / "config.json").write_text(json.dumps({
        "owner_language": "tr",
        "claude_accounts": [{"name": "brynq", "dir": "/x/accounts/claude-ea4eb4"},
                            {"name": "yakup", "dir": f"/x/accounts/{YAKUP}"},
                            {"name": "bedriyan", "dir": f"/y/accounts/{BEDRIYAN}"}]}))
    db = QUEUE / "state" / "ustabasi.db"
    if db.exists():
        db.unlink()
    conn = sqlite3.connect(db)
    conn.executescript("""
    CREATE TABLE tickets (id INTEGER PRIMARY KEY, title TEXT, card TEXT, repo TEXT, status TEXT,
                          ask TEXT);
    CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER, ts REAL,
                                kind TEXT, text TEXT);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    """)
    conn.executemany("INSERT INTO tickets VALUES (?,?,?,?,?,?)", [
        (1, "Fix the login", json.dumps({"goal": "g"}), str(root / "ledger"), "done", None),
        (2, "Pick a colour", json.dumps({"goal": "g", "origin_chat": "ORIGIN"}),
         str(root / "ledger"), "blocked", "Red or blue?"),
        (3, "Tidy scripts", json.dumps({"goal": "g"}), str(root / "loose"), "failed", None),
    ])
    conn.commit()
    return conn


def notify(conn, ticket, kind, text) -> int:
    cur = conn.execute("INSERT INTO notifications (ticket_id, ts, kind, text) VALUES (?,?,?,?)",
                       (ticket, 1.0, kind, text))
    conn.commit()
    return cur.lastrowid


@pytest.fixture()
def world(monkeypatch):
    root = Path(tempfile.mkdtemp(prefix="divan-queuechat-root-")).resolve()
    (root / "ledger").mkdir()
    (root / "loose").mkdir()
    # Another test file may have imported the daemon first, with its own
    # environment: the queue and the notice store are pointed here outright.
    monkeypatch.setattr(u, "STATE_DIR", QUEUE / "state")
    monkeypatch.setattr(u, "DB_PATH", QUEUE / "state" / "ustabasi.db")
    monkeypatch.setattr(u, "CLI", QUEUE / "bin" / "ustabasi")
    monkeypatch.setattr(Server, "NOTICE_STATE", root / "ustabasi-notices.json")
    conn = queue_db(root)
    cfg = Config.load()
    cfg.allowed_roots = [str(root)]
    cfg.save()

    def build() -> Server:
        srv = Server(Config.load())
        for aid in (YAKUP, BEDRIYAN):
            srv.accounts[aid] = acct.Account(id=aid, provider="claude", label=aid,
                                             home=str(root / ".acc" / aid))
        return srv

    srv = build()
    # One home for every test here, so each world's product has a name of its own.
    project = srv.db.divan.create_project(name=f"Ledger {root.name}", repos=[str(root / "ledger")])
    # Hermes is installed on every account in this world.
    monkeypatch.setattr(servermod.agents, "find", lambda aid, home=None, cwd=None: {"id": aid})
    calls: list[tuple[str, dict]] = []
    yield {"root": root, "conn": conn, "build": build, "srv": srv, "calls": calls,
           "project": project}
    conn.close()
    shutil.rmtree(root, ignore_errors=True)


def spy(srv: Server, calls: list) -> Server:
    """Count the client calls the follower makes; a send records, it starts no CLI."""
    real_create, real_update = srv.h_chat_create, srv.h_chat_update

    async def create(dev, d):
        calls.append(("chat.create", dict(d)))
        return await real_create(dev, d)

    async def update(dev, d):
        calls.append(("chat.update", dict(d)))
        return await real_update(dev, d)

    async def send(dev, d):
        calls.append(("chat.send", dict(d)))
        return {"accepted": True, "queued": 0}

    class Session:
        def __init__(self, cid):
            self.cid = cid

        async def send(self, text, attachments):
            calls.append(("origin.send", {"chat_id": self.cid, "text": text}))

    srv.h_chat_create, srv.h_chat_update, srv.h_chat_send = create, update, send
    srv.sessions.get = lambda cid: Session(cid)
    return srv


def named(calls, what):
    return [d for kind, d in calls if kind == what]


def test_origin_less_ticket_opens_one_hermes_chat_and_posts_every_notification(world):
    srv, conn, calls = spy(world["srv"], world["calls"]), world["conn"], world["calls"]
    start = u.newest_notification()
    notify(conn, 1, "blocked", "#1 ⛔ Fix the login — asks\nWhich provider?\n\nustabasi show 1")
    notify(conn, 1, "done", "#1 ✅ Fix the login — done")
    last = asyncio.run(srv._follow_pass(start))
    assert last == start + 2

    creates, sends = named(calls, "chat.create"), named(calls, "chat.send")
    assert len(creates) == 1 and len(sends) == 2
    c = creates[0]
    assert c["agent_id"] == "user:hermes"
    assert c["account_id"] == YAKUP            # yakup first, as the queue orders them
    assert c["cwd"] == str(world["root"] / "ledger")
    assert sends[0]["chat_id"] == sends[1]["chat_id"]
    chat = srv.db.get_chat(sends[0]["chat_id"])
    assert chat is not None and chat["agent_id"] == "user:hermes"
    assert chat["project_id"] == world["project"]["id"]
    assert "#1" in chat["title"]
    assert "Which provider?" in sends[0]["text"]
    assert not named(calls, "origin.send")


def test_ticket_with_origin_chat_goes_to_that_chat_only(world):
    srv, conn, calls = spy(world["srv"], world["calls"]), world["conn"], world["calls"]
    origin = srv.db.create_chat(provider="claude", model="opus", effort="high", perm_mode="bypass",
                                cwd=str(world["root"]), title="where it was filed")
    conn.execute("UPDATE tickets SET card=? WHERE id=2",
                 (json.dumps({"goal": "g", "origin_chat": origin["id"]}),))
    conn.commit()
    start = u.newest_notification()
    notify(conn, 2, "blocked", "#2 ⛔ Pick a colour\nRed or blue?")
    notify(conn, 2, "reminder", "#2 still waiting")
    asyncio.run(srv._follow_pass(start))
    assert not named(calls, "chat.create") and not named(calls, "chat.send")
    told = named(calls, "origin.send")
    assert [t["chat_id"] for t in told] == [origin["id"]]
    assert "Red or blue?" in told[0]["text"]


def test_projectless_and_ticketless_share_the_general_chat(world):
    srv, conn, calls = spy(world["srv"], world["calls"]), world["conn"], world["calls"]
    start = u.newest_notification()
    notify(conn, 3, "failed", "#3 ✖ Tidy scripts — failed")
    notify(conn, None, "disk", "💾 2 GB left")
    notify(conn, None, "limit", "⏸ paused")             # asks nothing: no chat
    asyncio.run(srv._follow_pass(start))
    creates, sends = named(calls, "chat.create"), named(calls, "chat.send")
    # audit: language-data — the general queue chat's title, as the daemon names it
    assert len(creates) == 1 and creates[0]["title"] == "Ustabaşı"
    # audit: end-language-data
    assert len(sends) == 2 and sends[0]["chat_id"] == sends[1]["chat_id"]
    assert srv.db.get_chat(sends[0]["chat_id"])["project_set"] == 1   # Unfiled, by hand


def test_a_restart_turns_no_notification_into_a_second_chat(world):
    srv, conn, calls = spy(world["srv"], world["calls"]), world["conn"], world["calls"]
    start = u.newest_notification()
    notify(conn, 1, "blocked", "#1 ⛔ Fix the login\nWhich provider?")
    asyncio.run(srv._follow_pass(start))
    assert len(named(calls, "chat.create")) == 1 and len(named(calls, "chat.send")) == 1

    # A new process, and a cursor that never reached the disk: the same
    # notification is read again.
    again: list = []
    srv2 = spy(world["build"](), again)
    asyncio.run(srv2._follow_pass(start))
    assert named(again, "chat.create") == [] and named(again, "chat.send") == []
    # …and the ticket's next notification goes to the chat it already has.
    notify(conn, 1, "done", "#1 ✅ done")
    asyncio.run(srv2._follow_pass(start))
    assert named(again, "chat.create") == []
    assert [d["chat_id"] for d in named(again, "chat.send")] == [named(calls, "chat.send")[0]["chat_id"]]


def test_the_message_tells_hermes_to_lead_with_what_yakup_must_do(world):
    srv, conn, calls = spy(world["srv"], world["calls"]), world["conn"], world["calls"]
    start = u.newest_notification()
    notify(conn, 1, "done", "#1 ✅ Fix the login — done")
    asyncio.run(srv._follow_pass(start))
    text = named(calls, "chat.send")[0]["text"]
    assert u.LEAD_WITH in text
    assert "what Yakup has to do" in text and "nothing, FYI" in text
    assert "Turkish" in text and "ustabasi note 1" in text


def test_accounts_skip_one_the_queue_knows_is_limited(world):
    world["conn"].execute("INSERT INTO meta VALUES ('limit_until:yakup', '99999999999')")
    world["conn"].commit()
    assert u.notice_accounts() == [BEDRIYAN, YAKUP]


def test_notice_chat_call_and_inbox_carry_the_chat(world):
    srv, conn, calls = spy(world["srv"], world["calls"]), world["conn"], world["calls"]
    # The push asks first, before the queue has recorded the notification…
    got = asyncio.run(srv.h_ustabasi_notice_chat(None, {"ticket": 1, "kind": "blocked"}))
    cid = got["chat_id"]
    assert cid and srv.db.get_chat(cid)
    assert asyncio.run(srv.h_ustabasi_notice_chat(None, {"ticket": 1, "kind": "reminder"})) == {"chat_id": cid}
    assert asyncio.run(srv.h_ustabasi_notice_chat(None, {"ticket": 2, "kind": "done"}))["chat_id"] != cid
    # …then the follower posts into that same chat.
    start = u.newest_notification()
    nid = notify(conn, 1, "blocked", "#1 ⛔ Fix the login\nWhich provider?")
    asyncio.run(srv._follow_pass(start))
    assert len([c for c in named(calls, "chat.create") if "#1" in c["title"]]) == 1
    assert named(calls, "chat.send")[0]["chat_id"] == cid
    inbox = asyncio.run(srv.h_ustabasi_notifications(None, {}))
    assert [i["chat"] for i in inbox["items"] if i["id"] == nid] == [cid]


def test_the_queue_push_carries_the_chat_id_and_nothing_more(monkeypatch):
    asked, posted = [], []

    async def protocol(cfg, typ, data):
        asked.append((typ, data))
        return {"chat_id": "CHAT-9"}

    class Client:
        def __init__(self, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json):
            posted.extend(json)

            class R:
                status_code = 200
                text = ""
            return R()

    import divan.__main__ as mainmod
    monkeypatch.setattr(mainmod, "_protocol", protocol)
    monkeypatch.setattr(pushmod.httpx, "AsyncClient", Client)
    data = {"source": "ustabasi", "ticket": 7, "kind": "blocked", "screen": "ustabasi"}
    asyncio.run(pushmod.send_push(["ExponentPushToken[x]"], "⛔ ustabasi #7", "Title — waiting for an answer", data))
    assert asked == [("ustabasi.notice_chat", {"ticket": 7, "kind": "blocked"})]
    assert posted[0]["data"] == {**data, "chat_id": "CHAT-9"}
    assert posted[0]["title"] == "⛔ ustabasi #7" and posted[0]["body"] == "Title — waiting for an answer"

    # A daemon's own push is never touched, and a daemon that is not there
    # costs the banner its chat, not the banner.
    asked.clear()
    posted.clear()
    asyncio.run(pushmod.send_push(["ExponentPushToken[x]"], "t", "b", {"chat_id": "C1", "kind": "done"}))
    assert asked == [] and posted[0]["data"] == {"chat_id": "C1", "kind": "done"}

    async def gone(cfg, typ, data):
        raise SystemExit("connection refused")
    monkeypatch.setattr(mainmod, "_protocol", gone)
    posted.clear()
    asyncio.run(pushmod.send_push(["ExponentPushToken[x]"], "t", "b", dict(data)))
    assert posted[0]["data"] == data
