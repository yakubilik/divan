"""The read-only MCP bridge: what it reads, what it masks, what it refuses."""
import json
import sqlite3

import pytest

from divan import mcp_bridge as mb


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("DIVAN_HOME", str(tmp_path))
    db = sqlite3.connect(tmp_path / "db.sqlite")
    db.executescript("""
        CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT);
        CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT, provider TEXT, status TEXT,
          archived INTEGER, cwd TEXT, task TEXT, done TEXT, last_preview TEXT,
          created_at REAL, updated_at REAL, project_id TEXT);
        CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT,
          type TEXT, payload TEXT, ts REAL);
        INSERT INTO projects VALUES ('p1', 'Divan');
        INSERT INTO chats VALUES ('abcd1111', 'divan · bülten', 'claude', 'idle', 0, '/x',
          'bülteni yaz', 'yazıldı', '', 1, 20, 'p1');
        INSERT INTO chats VALUES ('abcd2222', 'babysee fix', 'codex', 'running', 1, '/y',
          '', '', '', 1, 10, NULL);
    """)
    def ev(chat, typ, text, ts):
        db.execute("INSERT INTO events (chat_id, type, payload, ts) VALUES (?,?,?,?)",
                   (chat, typ, json.dumps({"text": text}), ts))
    ev("abcd1111", "message.user", "ilk soru", 1)
    ev("abcd1111", "message.assistant", "eski cevap", 2)
    ev("abcd1111", "message.user", "anahtar sk-ant-api03-" + "A" * 90 + " bunu kullan", 3)
    ev("abcd1111", "message.assistant", "bir", 4)
    ev("abcd1111", "message.assistant", "iki", 5)
    db.execute("INSERT INTO events (chat_id, type, payload, ts) VALUES ('abcd1111','turn.done','{}',6)")
    db.commit()
    db.close()
    return tmp_path


def test_list_newest_first_and_search(home):
    assert [c["id"] for c in mb.list_chats()["chats"]] == ["abcd1111", "abcd2222"]
    assert [c["id"] for c in mb.list_chats("divan")["chats"]] == ["abcd1111"]
    assert [c["id"] for c in mb.list_chats(running_only=True)["chats"]] == ["abcd2222"]
    assert [c["id"] for c in mb.list_chats(include_archived=False)["chats"]] == ["abcd1111"]


def test_result_is_the_newest_turn_only_and_masked(home):
    r = mb.chat_result("abcd11")
    assert r["state"] == "finished"
    assert r["answer"] == "bir\n\niki"
    assert "sk-ant-api03" not in json.dumps(r)


def test_read_chat_oldest_first(home):
    msgs = mb.read_chat("abcd1111", last=2)["messages"]
    assert [m["text"] for m in msgs] == ["bir", "iki"]


def test_running_chat_says_so(home):
    assert mb.chat_result("abcd2222")["state"] == "still working"


def test_refuses_short_or_ambiguous_ids(home):
    with pytest.raises(mb.Refused):
        mb.read_chat("ab")
    with pytest.raises(mb.Refused):
        mb.read_chat("abcd")
    with pytest.raises(mb.Refused):
        mb.read_chat("ffff0000")


def test_database_is_opened_read_only(home):
    with mb._connect() as conn, pytest.raises(sqlite3.OperationalError):
        conn.execute("DELETE FROM chats")
