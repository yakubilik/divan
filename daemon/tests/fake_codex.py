#!/usr/bin/env python3
"""A scripted `codex app-server` (JSON-RPC over stdio), for the tests.

Answers initialize, thread/start|resume and turn/start, and plays a turn as
notifications: an agent message streamed in deltas over a few seconds (SLOW
makes it about eight), a command approval it waits on when the input says ASK,
then turn/completed. Every line it reads goes to $FAKE_LOG.
"""
import json
import os
import sys
import threading
import time

LOG = os.environ.get("FAKE_LOG")
lock = threading.Lock()
answers: dict = {}
cv = threading.Condition()


def log(obj) -> None:
    if LOG:
        with open(LOG, "a") as f:
            f.write(json.dumps({"kind": "in", "obj": obj, "pid": os.getpid()}) + "\n")


def say(obj: dict) -> None:
    with lock:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()


def note(method: str, params: dict) -> None:
    say({"method": method, "params": params})


def turn(tid: str, text: str) -> None:
    slow = "SLOW" in text
    words = [f"c{i} " for i in range(16 if slow else 4)]
    note("turn/started", {"threadId": "th1", "turn": {"id": tid, "status": "inProgress"}})
    note("item/started", {"item": {"type": "agentMessage", "id": "a1", "text": ""}})
    for w in words:
        note("item/agentMessage/delta", {"itemId": "a1", "delta": w})
        time.sleep(0.5)
    full = "".join(words)
    note("item/completed", {"item": {"type": "agentMessage", "id": "a1", "text": full}})
    if "ASK" in text:
        rid = "srv-ask-1"
        say({"id": rid, "method": "item/commandExecution/requestApproval",
             "params": {"command": "touch /tmp/fake-held-codex", "cwd": "/tmp", "itemId": "x1"}})
        with cv:
            while rid not in answers:
                cv.wait(1)
        dec = ((answers[rid].get("result") or {}).get("decision"))
        note("item/started", {"item": {"type": "agentMessage", "id": "a2", "text": ""}})
        note("item/completed", {"item": {"type": "agentMessage", "id": "a2", "text": f"decision {dec}"}})
    note("turn/completed", {"threadId": "th1", "turn": {"id": tid, "status": "completed"}})


n = 0
for raw in sys.stdin:
    line = raw.strip()
    if not line:
        continue
    try:
        m = json.loads(line)
    except ValueError:
        continue
    log(m)
    if "method" in m and "id" in m:
        meth, rid = m["method"], m["id"]
        if meth == "initialize":
            say({"id": rid, "result": {"userAgent": "fake-codex"}})
        elif meth in ("thread/start", "thread/resume"):
            say({"id": rid, "result": {"thread": {"id": "th1"}}})
        elif meth == "turn/start":
            n += 1
            tid = f"tu{n}"
            say({"id": rid, "result": {"turn": {"id": tid}}})
            text = json.dumps(m.get("params", {}).get("input"))
            threading.Thread(target=turn, args=(tid, text), daemon=True).start()
        else:
            say({"id": rid, "result": {}})
    elif "id" in m:
        with cv:
            answers[m["id"]] = m
            cv.notify_all()
