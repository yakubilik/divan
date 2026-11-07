"""Plane's labels decide who does a work item; In Progress starts the queue."""
import asyncio
import json

import httpx

from divan.config import Config
from divan.plane_sync import PlaneSync, spec_for, who

PID = "p1"
STATES = [{"id": s, "name": n, "group": g} for s, n, g in
          [("s-todo", "Todo", "unstarted"), ("s-prog", "In Progress", "started"),
           ("s-done", "Done", "completed"), ("s-cx", "Cancelled", "cancelled")]]
LABELS = [{"id": "l-bot", "name": "ustabaşı"}, {"id": "l-hum", "name": "insan"}]


class FakePlane:
    def __init__(self):
        self.items = {}
        self.calls = []
        self.clock = 0

    def put(self, iid, state="s-todo", labels=(), **kw):
        self.clock += 1
        it = self.items.setdefault(iid, {"id": iid, "name": f"item {iid}", "description_html": "<p>do it</p>",
                                         "external_source": None, "external_id": None})
        it.update(state=state, labels=list(labels), updated_at=f"2026-11-07T00:00:{self.clock:02d}Z", **kw)

    def handler(self, req: httpx.Request) -> httpx.Response:
        path = req.url.path.split("/workspaces/skola/")[1]
        self.calls.append((req.method, path, json.loads(req.content) if req.content else None))
        if path.endswith("/states/"):
            return httpx.Response(200, json={"results": STATES})
        if path.endswith("/labels/"):
            return httpx.Response(200, json={"results": LABELS})
        if req.method == "GET" and path.endswith("/issues/"):
            res = sorted(self.items.values(), key=lambda i: i["updated_at"], reverse=True)
            n = int(req.url.params.get("per_page", 50))
            return httpx.Response(200, json={"results": res[:n], "next_page_results": False, "next_cursor": None})
        if req.method == "PATCH":
            iid = path.rstrip("/").split("/")[-1]
            self.put(iid, **{**{k: self.items[iid][k] for k in ("state", "labels")}, **json.loads(req.content)})
            return httpx.Response(200, json=self.items[iid])
        if req.method == "POST" and path.endswith("/comments/"):
            return httpx.Response(201, json={})
        return httpx.Response(404)


def make(tmp_path, plane, status=None, repos=("/repo/x",)):
    cfg = Config()
    cfg.plane = {"url": "http://plane", "workspace": "skola", "projects": {"x": PID}}
    filed = []

    async def add(spec):
        filed.append(spec)
        return 900 + len(filed)

    sync = PlaneSync(cfg, repos_for=lambda slug: list(repos), is_allowed=lambda p: True,
                     state_path=tmp_path / "s.json", key=lambda: "k", add=add,
                     status_of=lambda n: (status or {}).get(n), transport=httpx.MockTransport(plane.handler))
    return sync, filed


def comments(plane):
    return [c for c in plane.calls if c[1].endswith("/comments/")]


def test_who_reads_the_two_labels():
    assert who(["ustabaşı"]) == "bot" and who(["İnsan"]) == "human" and who(["USTABAŞı"]) == "bot" and who(["web"]) is None


def test_the_first_pass_only_learns_where_now_is(tmp_path):
    plane = FakePlane(); plane.put("a", state="s-prog", labels=["l-bot"])
    sync, filed = make(tmp_path, plane)
    asyncio.run(sync.run_once())
    assert filed == []  # an item already in progress before the daemon looked is not filed


def test_an_ustabasi_item_moved_to_in_progress_is_filed_once(tmp_path):
    plane = FakePlane(); plane.put("a", labels=["l-bot"])
    sync, filed = make(tmp_path, plane)
    asyncio.run(sync.run_once())
    plane.put("a", state="s-prog", labels=["l-bot"])
    asyncio.run(sync.run_once())
    assert len(filed) == 1 and filed[0]["repo"] == "/repo/x" and filed[0]["card"]["goal"] == "do it"
    assert plane.items["a"]["external_id"] == "901" and plane.items["a"]["external_source"] == "ustabasi"
    assert any("#901" in json.dumps(c[2], ensure_ascii=False) for c in comments(plane))
    asyncio.run(sync.run_once())
    plane.put("a", state="s-prog", labels=["l-bot"], name="renamed")
    asyncio.run(sync.run_once())
    assert len(filed) == 1


def test_a_person_item_is_left_alone(tmp_path):
    plane = FakePlane(); plane.put("a", labels=["l-hum"])
    sync, filed = make(tmp_path, plane)
    asyncio.run(sync.run_once())
    plane.put("a", state="s-prog", labels=["l-hum"])
    asyncio.run(sync.run_once())
    assert filed == [] and plane.items["a"]["state"] == "s-prog" and comments(plane) == []


def test_an_item_nobody_owns_goes_back_to_todo_and_says_why(tmp_path):
    plane = FakePlane(); plane.put("a")
    sync, filed = make(tmp_path, plane)
    asyncio.run(sync.run_once())
    plane.put("a", state="s-prog")
    asyncio.run(sync.run_once())
    assert filed == [] and plane.items["a"]["state"] == "s-todo" and len(comments(plane)) == 1


def test_an_item_already_numbered_is_not_filed_again(tmp_path):
    plane = FakePlane(); plane.put("a", labels=["l-bot"], external_source="ustabasi", external_id="12")
    sync, filed = make(tmp_path, plane)
    asyncio.run(sync.run_once())
    plane.put("a", state="s-prog", labels=["l-bot"])
    asyncio.run(sync.run_once())
    assert filed == []


def test_what_the_queue_finishes_moves_to_done(tmp_path):
    plane = FakePlane(); plane.put("a", labels=["l-bot"])
    status = {}
    sync, filed = make(tmp_path, plane, status=status)
    asyncio.run(sync.run_once())
    plane.put("a", state="s-prog", labels=["l-bot"])
    asyncio.run(sync.run_once())
    status[901] = "blocked"
    asyncio.run(sync.run_once()); asyncio.run(sync.run_once())
    assert sum("takıldı" in json.dumps(c[2], ensure_ascii=False) for c in comments(plane)) == 1
    status[901] = "done"
    asyncio.run(sync.run_once())
    assert plane.items["a"]["state"] == "s-done"
    assert "a" not in sync.state["filed"]


def test_spec_reads_the_description_as_the_goal():
    s = spec_for({"name": "T", "description_html": "<p>one &amp; two</p><ul><li><p>three</p></li></ul>"}, "/r")
    assert s["card"]["goal"] == "one & two\nthree" and s["card"]["done_criteria"] == ["T"]
