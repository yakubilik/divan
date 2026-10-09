"""How late the event loop wakes up, and what it was doing instead.

The phone gives the daemon ten seconds to answer its `ping` before it buries the
socket and dials again (app/src/ws.ts). Everything the daemon does for every
client happens on one event loop, so a loop that is held up — a synchronous
file read, a subprocess waited on, sqlite on a busy disk, or simply a process
the scheduler did not get round to on a Mac at load 20 — is a phone that
reconnects for no reason it can see.

`LoopWatch.run` sleeps a fixed beat and notes how much later than asked it woke.
That alone says *that* the loop was late, not why, and by the time the loop can
say anything the culprit has returned. So a thread outside the loop watches the
same beat and, the first time it goes stale, copies the loop thread's stack:
the frame it was stuck in when the loop is blocked by our own code, or the
selector's wait when the whole process was simply not scheduled.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import threading
import time
import traceback

log = logging.getLogger("rac.loop")

# How often the loop is asked to wake, and how late it may be before it is
# worth a line. Two seconds is a fifth of the phone's ping timeout: well past
# scheduling noise, well before a phone gives up.
EVERY_S = 0.5
THRESHOLD_S = 2.0


class LoopWatch:
    def __init__(self, every: float = EVERY_S, threshold: float = THRESHOLD_S) -> None:
        self.every = every
        self.threshold = threshold
        self.beat = time.monotonic()
        # Worst lateness seen, for anybody who wants to ask (host.info, tests).
        self.worst = 0.0
        self._stack: str | None = None
        self._loop_thread: int | None = None

    async def run(self) -> None:
        self._loop_thread = threading.get_ident()
        self.beat = time.monotonic()
        stop = threading.Event()
        threading.Thread(target=self._watch, args=(stop,), name="loop-watch", daemon=True).start()
        try:
            while True:
                asked = time.monotonic()
                await asyncio.sleep(self.every)
                late = time.monotonic() - asked - self.every
                self.beat = time.monotonic()
                self.worst = max(self.worst, late)
                if late > self.threshold:
                    stack, self._stack = self._stack, None
                    log.warning("event loop woke %.1fs late (load %.1f)%s", late, os.getloadavg()[0],
                                f"; it was in:\n{stack}" if stack else "")
                else:
                    self._stack = None
        finally:
            stop.set()

    def _watch(self, stop: threading.Event) -> None:
        """Copy the loop's stack once per stall, while it is still stalled."""
        taken_for = None
        while not stop.wait(self.every):
            beat = self.beat
            if time.monotonic() - beat <= self.threshold or taken_for == beat:
                continue
            frame = sys._current_frames().get(self._loop_thread or 0)
            if frame is None:
                continue
            taken_for = beat
            self._stack = "".join(traceback.format_stack(frame)[-6:]).rstrip()
