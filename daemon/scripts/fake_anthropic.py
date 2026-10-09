#!/usr/bin/env python3
"""A stand-in for the Anthropic Messages API on loopback, for the voice tests.

    python scripts/fake_anthropic.py [--mode talk] [--port 0]   # serves until stdin closes

It speaks the wire format voice_api.py reads (server-sent events as in
https://platform.claude.com/docs/en/build-with-claude/streaming) over real
HTTP, so the daemon's own client, timeouts and connection handling are what is
tested. Nothing it says is a model's: the answers are scripted and the timing
is chosen. It is not evidence of the real API's latency or quality.

Modes (`Fake.mode`, or the `x-fake-mode` of the test that set it):
  talk     five short pieces, 40 ms apart
  slow     twelve sentences, one every 350 ms (something to interrupt)
  act      a request (by its verb) is a tool call, a question is answered
  forward  every question is forward_to_chat (a chat call)
  approve  every question is answer_approval allow=true (a chat call)
  late-act every question is start_work, after 5 s (a general call)
  429      HTTP 429 with retry-after: 30
  529      HTTP 529 overloaded_error
  401      HTTP 401 authentication_error
  stall    headers, then nothing
  midfail  one piece, then an `error` event (overloaded_error)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

REQUEST = re.compile(r"çalıştır\b|bitir\b|düzelt\b|deploy et|merge et|kontrol eder misin|bakar mısın|gönder\b", re.I)
SHORT = ["Şu an ", "bir sohbet ", "çalışıyor, ", "biri de onay bekliyor. ", "Başka bir şey yok. "]
LONG = [f"Bu uzun cevabın {n}. cümlesi, yavaş yavaş okunuyor. " for n in range(1, 13)]


def sse(kind: str, data: dict) -> bytes:
    return f"event: {kind}\ndata: {json.dumps({'type': kind, **data}, ensure_ascii=False)}\n\n".encode()


class Fake:
    def __init__(self, key: str, mode: str = "talk"):
        self.key = key
        self.mode = mode
        self.log: list[dict] = []          # one entry per POST /v1/messages
        self.lookups = 0                   # GET /v1/models/... (the unbilled warm-up)

    def app(self):
        app = FastAPI()

        def refuse(status: int, kind: str, msg: str, headers=None):
            return JSONResponse({"type": "error", "error": {"type": kind, "message": msg}}, status, headers=headers)

        @app.get("/v1/models/{model}")
        async def model(model: str, request: Request):
            self.lookups += 1
            if request.headers.get("x-api-key") != self.key:
                return refuse(401, "authentication_error", "invalid x-api-key")
            return {"type": "model", "id": model}

        @app.post("/v1/messages")
        async def messages(request: Request):
            body = await request.json()
            last = body["messages"][-1]["content"]
            text = next((b["text"] for b in reversed(last) if b.get("type") == "text"), "")
            question = text.split("</state>\n\n", 1)[-1].rsplit("\n\n(", 1)[0]
            entry = {"t": time.time(), "mode": self.mode, "question": question, "body": body,
                     "key_ok": request.headers.get("x-api-key") == self.key,
                     "version": request.headers.get("anthropic-version"),
                     "sent": [], "done_at": None, "aborted": False}
            self.log.append(entry)
            mode = self.mode
            if not entry["key_ok"] or mode == "401":
                return refuse(401, "authentication_error", "invalid x-api-key")
            if mode == "429":
                return refuse(429, "rate_limit_error", "Number of requests has exceeded your rate limit",
                              {"retry-after": "30"})
            if mode == "529":
                return refuse(529, "overloaded_error", "Overloaded")

            async def stream():
                try:
                    yield sse("message_start", {"message": {
                        "id": "msg_fake", "type": "message", "role": "assistant", "content": [],
                        "model": body["model"], "stop_reason": None,
                        "usage": {"input_tokens": 900, "output_tokens": 1}}})
                    if mode == "stall":
                        await asyncio.sleep(60)
                        return
                    await asyncio.sleep(5.0 if mode == "late-act" else 0.12)   # a slow or a warm first token
                    tool = None
                    if mode == "forward" or (mode == "act" and REQUEST.search(question) and body["tools"]
                                             and body["tools"][0]["name"] == "forward_to_chat"):
                        tool = ("forward_to_chat", {})
                    elif mode == "approve":
                        tool = ("answer_approval", {"allow": True})
                    elif mode == "late-act" or (mode == "act" and REQUEST.search(question)):
                        tool = ("start_work", {"project": "app", "instruction": question})
                    if tool:
                        name, args = tool
                        yield sse("content_block_start", {"index": 0, "content_block": {
                            "type": "tool_use", "id": f"toolu_{len(self.log)}", "name": name, "input": {}}})
                        raw = json.dumps(args, ensure_ascii=False)
                        for part in (raw[:len(raw) // 2], raw[len(raw) // 2:]):
                            yield sse("content_block_delta", {"index": 0, "delta": {
                                "type": "input_json_delta", "partial_json": part}})
                            entry["sent"].append((time.time(), part))
                        yield sse("content_block_stop", {"index": 0})
                        stop = "tool_use"
                    else:
                        yield sse("content_block_start", {"index": 0, "content_block": {"type": "text", "text": ""}})
                        yield sse("ping", {})
                        pieces = LONG if mode == "slow" else SHORT[:1] if mode == "midfail" else SHORT
                        for p in pieces:
                            yield sse("content_block_delta", {"index": 0, "delta": {"type": "text_delta", "text": p}})
                            entry["sent"].append((time.time(), p))
                            await asyncio.sleep(0.35 if mode == "slow" else 0.04)
                        if mode == "midfail":
                            yield sse("error", {"error": {"type": "overloaded_error", "message": "Overloaded"}})
                            return
                        yield sse("content_block_stop", {"index": 0})
                        stop = "end_turn"
                    yield sse("message_delta", {"delta": {"stop_reason": stop, "stop_sequence": None},
                                                "usage": {"output_tokens": 40}})
                    yield sse("message_stop", {})
                    entry["done_at"] = time.time()
                except asyncio.CancelledError:
                    entry["aborted"] = True
                    raise
                finally:
                    if entry["done_at"] is None and mode not in ("midfail", "stall"):
                        entry["aborted"] = True

            return StreamingResponse(stream(), media_type="text/event-stream")

        return app


async def serve(fake: Fake, port: int = 0):
    """Start it on loopback; returns (server, task, base_url)."""
    import socket
    import uvicorn
    if not port:
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(fake.app(), host="127.0.0.1", port=port, log_level="warning"))
    task = asyncio.create_task(server.serve())
    for _ in range(100):
        if server.started:
            break
        await asyncio.sleep(0.05)
    return server, task, f"http://127.0.0.1:{port}"


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="talk")
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--key", default="sk-ant-fake-voice-test")
    a = ap.parse_args()
    fake = Fake(a.key, a.mode)
    server, task, url = await serve(fake, a.port)
    print(json.dumps({"url": url}), flush=True)
    await asyncio.get_running_loop().run_in_executor(None, sys.stdin.read)
    server.should_exit = True
    await asyncio.wait_for(task, 10)


if __name__ == "__main__":
    asyncio.run(main())
