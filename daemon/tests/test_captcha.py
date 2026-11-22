"""captcha.py without a browser: where a touch lands, and what is never sent."""
import asyncio
from pathlib import Path

import pytest

from divan import captcha


class StubPage:
    def __init__(self):
        self.sent = []
        self.ws = object()
        self.lock = asyncio.Lock()

    async def __call__(self, method, timeout=15, **params):
        self.sent.append((method, params))
        return {}

    async def close(self):
        self.ws = None


def _case(desk, box):
    c = captcha.Case(id="c1", chat_id="chat", port=1, url="u", title="t", selector=None,
                     whole=False, page=StubPage(), box=box)
    c.shown[1] = box
    desk.cases[c.id] = c
    return c


def test_a_tap_lands_in_the_box_and_never_outside():
    async def run():
        desk = captcha.Desk(lambda *_: asyncio.sleep(0))
        c = _case(desk, {"x": 100, "y": 200, "w": 300, "h": 80})
        await desk.input("c1", [{"type": "tap", "x": 0.5, "y": 0.5}, {"type": "tap", "x": 9, "y": -3}], 1)
        presses = [p for m, p in c.page.sent if p.get("type") == "mousePressed"]
        assert (presses[0]["x"], presses[0]["y"]) == (250, 240)
        assert (presses[1]["x"], presses[1]["y"]) == (400, 200)     # held to the corner
    asyncio.run(run())


def test_a_tap_belongs_to_the_frame_it_was_made_on():
    async def run():
        desk = captcha.Desk(lambda *_: asyncio.sleep(0))
        c = _case(desk, {"x": 0, "y": 0, "w": 100, "h": 100})
        c.shown[2] = {"x": 50, "y": 50, "w": 400, "h": 600}
        c.box = c.shown[2]
        await desk.input("c1", [{"type": "tap", "x": 1, "y": 1}], 1)
        press = next(p for m, p in c.page.sent if p.get("type") == "mousePressed")
        assert (press["x"], press["y"]) == (100, 100)
    asyncio.run(run())


def test_a_drag_is_pressed_moved_and_released():
    async def run():
        desk = captcha.Desk(lambda *_: asyncio.sleep(0))
        c = _case(desk, {"x": 0, "y": 0, "w": 200, "h": 100})
        await desk.input("c1", [{"type": "drag", "points": [[0, 0.5, 0], [0.5, 0.5, 10], [1, 0.5, 20]]}], 1)
        kinds = [p.get("type") for m, p in c.page.sent if m == "Input.dispatchMouseEvent"]
        assert kinds[1] == "mousePressed" and kinds[-1] == "mouseReleased"
        assert c.page.sent[-1][1]["x"] == 200
    asyncio.run(run())


def test_finish_tells_once_and_input_is_refused_after():
    async def run():
        told = []

        async def tell(what, c):
            told.append((what, c.state))
        desk = captcha.Desk(tell)
        _case(desk, {"x": 0, "y": 0, "w": 10, "h": 10})
        await desk.finish("c1", "solved")
        await desk.finish("c1", "cancelled")
        assert told == [("closed", "solved")]
        with pytest.raises(captcha.CaptchaError):
            await desk.input("c1", [{"type": "tap", "x": 0, "y": 0}])
    asyncio.run(run())


def test_runtime_enable_is_never_sent():
    src = Path(captcha.__file__).read_text()
    code = "\n".join(l for l in src.splitlines() if not l.lstrip().startswith(("#", "*")))
    assert '"Runtime.enable"' not in code
