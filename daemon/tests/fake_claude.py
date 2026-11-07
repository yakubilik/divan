#!/usr/bin/env python3
"""A scripted `claude` speaking the SDK's stream-json protocol, for the tests.

It answers `-v`, the `initialize` handshake and any other control request, and
for each user message plays one turn: a text block streamed as deltas over a few
seconds, then — when the message says ASK — a permission request it waits on,
then a result. Every line it reads is appended to $FAKE_LOG, so a test can count
how many handshakes reached the CLI and see what was answered.

The words of the message decide the pace: SLOW stretches the streamed block to
about eight seconds, which is room to stop a daemon in the middle of it.
"""
import json
import os
import sys
import threading
import time
import uuid

if sys.argv[1:] in (["-v"], ["--version"]):
    print("2.1.99 (Claude Code)")
    sys.exit(0)

LOG = os.environ.get("FAKE_LOG")
SID = "fake-session-1"
out_lock = threading.Lock()
answers: dict[str, dict] = {}
answered = threading.Condition()


def log(kind: str, obj) -> None:
    if LOG:
        with open(LOG, "a") as f:
            f.write(json.dumps({"kind": kind, "obj": obj, "pid": os.getpid()}) + "\n")


def say(obj: dict) -> None:
    with out_lock:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()


def ev(event: dict) -> None:
    say({"type": "stream_event", "uuid": str(uuid.uuid4()), "session_id": SID, "event": event})


def turn(text: str) -> None:
    slow = "SLOW" in text
    words = [f"w{i} " for i in range(16 if slow else 4)]
    ev({"type": "message_start", "message": {"id": "m1", "type": "message", "role": "assistant",
                                             "content": [], "model": "fake", "usage": {}}})
    ev({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})
    for w in words:
        ev({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": w}})
        time.sleep(0.5)
    ev({"type": "content_block_stop", "index": 0})
    full = "".join(words)
    say({"type": "assistant", "session_id": SID, "parent_tool_use_id": None,
         "message": {"id": "m1", "model": "fake", "role": "assistant", "content": [{"type": "text", "text": full}],
                     "usage": {"output_tokens": 5}, "stop_reason": "end_turn"}})
    ev({"type": "message_stop"})
    verdict = ""
    if "ASK" in text:
        rid = f"ask-{uuid.uuid4().hex[:8]}"
        say({"type": "control_request", "request_id": rid, "request": {
            "subtype": "can_use_tool", "tool_name": "Write",
            "input": {"file_path": "/tmp/fake-held.txt", "content": "x"}, "permission_suggestions": []}})
        with answered:
            while rid not in answers:
                answered.wait(1)
        verdict = (answers[rid].get("response") or {}).get("behavior", "?")
        say({"type": "assistant", "session_id": SID, "parent_tool_use_id": None,
             "message": {"id": "m2", "model": "fake", "role": "assistant",
                         "content": [{"type": "text", "text": f"permission {verdict}"}],
                         "usage": {"output_tokens": 2}, "stop_reason": "end_turn"}})
    say({"type": "result", "subtype": "success", "duration_ms": 10, "duration_api_ms": 5,
         "is_error": False, "num_turns": 1, "session_id": SID, "total_cost_usd": 0.0,
         "usage": {"input_tokens": 1, "output_tokens": 1}, "result": full + verdict})


for raw in sys.stdin:
    line = raw.strip()
    if not line:
        continue
    try:
        msg = json.loads(line)
    except ValueError:
        continue
    log("in", msg)
    t = msg.get("type")
    if t == "control_request":
        sub = (msg.get("request") or {}).get("subtype")
        body = {"commands": [], "fake": True} if sub == "initialize" else {}
        say({"type": "control_response", "response": {"subtype": "success",
                                                       "request_id": msg.get("request_id"), "response": body}})
    elif t == "control_response":
        r = msg.get("response") or {}
        with answered:
            answers[r.get("request_id")] = r
            answered.notify_all()
    elif t == "user":
        content = (msg.get("message") or {}).get("content")
        text = content if isinstance(content, str) else json.dumps(content)
        threading.Thread(target=turn, args=(text,), daemon=True).start()
