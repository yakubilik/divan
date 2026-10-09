"""Demo provider: a scripted agent for a machine with no real one behind it.

Built for App Review, whose reviewer pairs a phone with a computer we lend
them and has neither a Claude nor a Codex subscription to drive. Every turn
plays the same short script — some text, one tool call, one approval, then an
edit or a skip depending on the answer — through exactly the events the
Claude provider emits, so the phone and the panel draw it without knowing.

Nothing here runs, reads or writes anything. The tool output and the edit are
canned strings, and the file the edit names is only ever a path in a payload.
That is the whole safety story of a demo machine, so keep it that way: no
child processes, no file handles, no network.
"""
from __future__ import annotations

import asyncio
import time
import uuid

from .base import Provider, ProviderConfig, TurnResult

# Typed out a few words at a time, so the phone shows the reply arriving the
# way a real one does rather than landing whole.
_TICK_S = 0.03

INTRO = (
    "This is a demo machine. There is no AI model behind it: every reply here "
    "is the same short script, played so you can see how the app works. On a "
    "real install the app drives your own Claude Code or Codex on your own "
    "computer, and the answers come from them.\n\n"
    "Let me look at the project first."
)
GIT_STATUS = "git status"
GIT_STATUS_OUT = (
    "On branch main\n"
    "Your branch is up to date with 'origin/main'.\n\n"
    "nothing to commit, working tree clean"
)
ASK = ("The tree is clean. The README has a typo in its first line — I'd like "
       "to fix it. Approve the edit on your phone and I'll make it.")
EDIT_FILE = "README.md"
OLD = "# Sample app\n\nA small exmaple project."
NEW = "# Sample app\n\nA small example project."
DIFF = (
    f"--- a/{EDIT_FILE}\n"
    f"+++ b/{EDIT_FILE}\n"
    "@@ -1,3 +1,3 @@\n"
    " # Sample app\n"
    " \n"
    "-A small exmaple project.\n"
    "+A small example project."
)
EDIT_OUT = (f"The file {EDIT_FILE} has been updated. (Demo: the edit is shown, "
            "not written — nothing on this machine changed.)")
DONE = ("Fixed the typo in README.md. That is the whole demo: on your own "
        "computer this is where your agent would carry on with the real work.")
SKIPPED = ("Okay — skipped that step, so README.md was left as it was. That is "
           "the whole demo: on your own computer your agent would carry on "
           "without the edit.")

MODEL = {"id": "demo", "label": "Demo", "model_id": "demo",
         "hint": "scripted replies · no model behind it", "efforts": []}


class DemoProvider(Provider):
    name = "demo"

    def __init__(self, cfg: ProviderConfig, emit, approval):
        super().__init__(cfg, emit, approval)
        self._session_id = cfg.session_id or f"demo-{uuid.uuid4().hex[:12]}"
        self._session_allow: set[str] = set()
        self._interrupted = False

    @staticmethod
    def catalog() -> dict:
        # One model and the one mode the script honours: it always asks.
        return {"models": [MODEL], "efforts": [], "perm_modes": ["ask"]}

    async def run(self, prompt: str, attachments: list[dict] | None = None) -> TurnResult:
        started = time.monotonic()
        self._interrupted = False
        segment = 0

        async def say(text: str) -> bool:
            """Stream one assistant message; False once the turn was stopped."""
            nonlocal segment
            words = text.split(" ")
            for i, w in enumerate(words):
                if self._interrupted:
                    return False
                chunk = w if i == len(words) - 1 else w + " "
                await self.emit("text.delta", {"segment": segment, "text": chunk}, False)
                await asyncio.sleep(_TICK_S)
            await self.emit("message.assistant", {"segment": segment, "text": text}, True)
            segment += 1
            return True

        async def progress(open_tools: int) -> None:
            await self.emit("turn.progress", {"output_tokens": 0, "open_tools": open_tools}, False)

        def stopped() -> TurnResult:
            return TurnResult(self._session_id, None, None,
                              int((time.monotonic() - started) * 1000), 1,
                              False, None, "interrupted")

        if not await say(INTRO):
            return stopped()

        tool_id = f"demo_{uuid.uuid4().hex[:12]}"
        await self.emit("tool.use", {"id": tool_id, "tool": "Bash",
                                     "input": {"command": GIT_STATUS}}, True)
        await progress(1)
        await asyncio.sleep(_TICK_S * 10)
        await self.emit("tool.result", {"id": tool_id, "output": GIT_STATUS_OUT,
                                        "is_error": False}, True)
        await progress(0)

        if not await say(ASK):
            return stopped()

        path = f"{self.cfg.cwd.rstrip('/')}/{EDIT_FILE}"
        edit = {"file_path": path, "old_string": OLD, "new_string": NEW, "diff": DIFF}
        if "Edit" in self._session_allow:
            decision = "allow"
        else:
            decision = await self.approval("Edit", dict(edit), None)
        if decision == "allow_session":
            self._session_allow.add("Edit")
        if self._interrupted:
            return stopped()

        if decision in ("allow", "allow_session"):
            edit_id = f"demo_{uuid.uuid4().hex[:12]}"
            await self.emit("tool.use", {"id": edit_id, "tool": "Edit", "input": edit}, True)
            await self.emit("tool.result", {"id": edit_id, "output": EDIT_OUT,
                                            "is_error": False}, True)
            done = await say(DONE)
        else:
            done = await say(SKIPPED)
        if not done:
            return stopped()
        return TurnResult(session_id=self._session_id, cost_usd=None, usage=None,
                          duration_ms=int((time.monotonic() - started) * 1000),
                          num_turns=1, stop_reason="end_turn")

    async def interrupt(self) -> None:
        self._interrupted = True

    async def close(self) -> None:
        self._interrupted = True
