"""Expo push notifications. Content-free by design: no message text leaves the Mac."""
from __future__ import annotations

import asyncio
import logging

import httpx

log = logging.getLogger("rac.push")
EXPO_URL = "https://exp.host/--/api/v2/push/send"

#: How long the queue's push waits for the daemon to name the notification's
#: chat. The queue gives the whole push thirty seconds; a banner that opens the
#: wall is better than none.
QUEUE_CHAT_TIMEOUT_S = 8.0


async def queue_chat(data: dict) -> str | None:
    """The chat a ticket queue notification is put in, asked of the daemon.

    The queue (ustabasi) sends its pushes from its own process through this
    module (its `rac_push.py`), before the daemon has read the notification.
    So the daemon is asked here, the way any local client asks it, to name —
    and if need be open — the chat; the banner then carries that chat's id and
    a tap opens the conversation instead of the wall. None when the daemon is
    not there, does not answer in time, or the kind opens no chat.
    """
    async def ask() -> dict:
        from .__main__ import _protocol
        from .config import Config
        # _protocol says no with SystemExit. Turned into an ordinary error here,
        # inside what wait_for runs: on Python 3.11 wait_for runs it as a task,
        # and a SystemExit out of a task leaves the event loop altogether, so
        # the push process died instead of sending the banner without a chat.
        try:
            return await _protocol(Config.load(), "ustabasi.notice_chat", {
                "ticket": data.get("ticket"), "kind": data.get("kind") or ""})
        except SystemExit as exc:
            raise RuntimeError(str(exc)) from None

    try:
        got = await asyncio.wait_for(ask(), QUEUE_CHAT_TIMEOUT_S)
        return str(got.get("chat_id") or "") or None
    except Exception as exc:
        log.info("no chat for the queue's push: %s", exc)
        return None


async def send_push(tokens: list[str], title: str, body: str, data: dict | None = None) -> None:
    tokens = [t for t in tokens if t and t.startswith("ExponentPushToken")]
    if not tokens:
        return
    data = dict(data or {})
    # Only the id is added: the banner still says nothing but the ticket's
    # number, title and what happened (the queue's own rule, notify._rac_payload).
    if data.get("source") == "ustabasi" and not data.get("chat_id"):
        if cid := await queue_chat(data):
            data["chat_id"] = cid
    msgs = [{"to": t, "title": title, "body": body, "data": data, "sound": "default"}
            for t in tokens]
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(EXPO_URL, json=msgs)
            if r.status_code >= 300:
                log.warning("expo push failed: %s %s", r.status_code, r.text[:200])
    except Exception as exc:
        log.warning("expo push error: %s", exc)
