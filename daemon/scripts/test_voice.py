#!/usr/bin/env python3
"""The streaming voice session, driven over a real socket with the bench's audio.

    python scripts/test_voice.py                     # stand-ins: no model, no network (CI)
    PY=~/projects/remote-ai-chat/daemon/.venv312/bin/python
    $PY scripts/test_voice.py --real --account-home ~/.remote-ai-chat/accounts/<claude-id> \\
        [--rounds 2] [--out ../docs/voice-bench/voice-session.json]

A daemon of its own (RAC_HOME and a free port under a temporary folder, the
demo provider for chats, so no chat ever reaches a real CLI) runs in this
process, and a phone made of `websockets` talks to it with `voice.start` and
`voice.audio`, releasing each fixture in 100 ms messages on the wall clock the
way a microphone does.

The fixtures are the bench's (`voice_bench/make_fixtures.py`, synthetic Turkish
from the Mac's own voice; nothing recorded from a person). Without `say` (CI on
Linux) the same scenarios are rebuilt as level-only audio with the same timing.

By default the two things that need a model are stand-ins: the recogniser
replays each fixture's script for whatever stretch of audio it is given, and
the conversational layer is a scripted stream. Everything between them — level
detection, the turn rule, turn ids, cancellation, the commit gate, the bridge
into the chats and their approvals — is the daemon's own code.

`--real` swaps in the daemon's whisper and a real fast layer (Haiku on the given
account's subscription) and measures speech end → first `voice.say` against
`docs/voice-bench/proof.json`.
"""
from __future__ import annotations

import argparse
import array
import asyncio
import base64
import json
import math
import os
import random
import re
import shutil
import socket
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BENCH = Path(__file__).resolve().parent / "voice_bench"
TMP = Path(tempfile.mkdtemp(prefix="rac-voice-"))
os.environ["RAC_HOME"] = str(TMP / "rac")
os.environ["USTABASI_STATE_DIR"] = str(TMP / "nowhere")
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(BENCH))

import bench                                                    # noqa: E402
import websockets                                               # noqa: E402

from remote_ai_chat import voice                               # noqa: E402
from remote_ai_chat.config import Config                       # noqa: E402

RATE = 16000
CHUNK = RATE // 10                    # 100 ms per voice.audio
failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'' if ok else f'  — {detail}'}")
    if not ok:
        failures.append(label)


# ── fixtures ─────────────────────────────────────────────────────────────────
def synthesize(out: Path) -> None:
    """The scenarios as level-only audio: a voiced buzz at about -20 dBFS where
    the words are, at the bench's speaking rate, over the same noise floor."""
    cfg = json.loads((BENCH / "scenarios.json").read_text())
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(7)

    def noise(n):
        amp = 32768 * 10 ** (-62 / 20) * 1.7
        return array.array("h", (int(rng.uniform(-amp, amp)) for _ in range(n)))

    def voiced(text, level_db=-20.0):
        n = int(len(text.split()) * 60 / cfg["rate_wpm"] * RATE)
        amp = 32768 * 10 ** (level_db / 20) * 1.41
        return array.array("h", (int(amp * math.sin(2 * math.pi * 160 * i / RATE)) for i in range(n)))

    def add(base, top, at, gain=1.0):
        for i, v in enumerate(top):
            if at + i >= len(base):
                base.append(0)
            base[at + i] = max(-32768, min(32767, int(base[at + i] + v * gain)))

    entries = []
    for sc in cfg["scenarios"]:
        track = array.array("h", bytes(2 * RATE * 300 // 1000))
        spans = []
        for seg in sc["segments"]:
            v = voiced(seg["text"])
            s0 = len(track)
            track.extend(v)
            spans.append({"text": seg["text"], "start_ms": s0 * 1000 // RATE, "end_ms": len(track) * 1000 // RATE})
            track.extend(array.array("h", bytes(2 * RATE * seg["pause_ms"] // 1000)))
        entry = {"id": sc["id"], "kind": sc["kind"], "reference": sc["reference"], "spans": spans}
        if sc["kind"] == "silence":
            track.extend(array.array("h", bytes(2 * RATE * sc["silence_ms"] // 1000)))
        if sc["kind"] == "barge-in":
            answer = voiced(sc["assistant"], -25.0)
            bench.write_wav(out / f"{sc['id']}.assistant.wav", answer)
            user = voiced(sc["segments"][0]["text"])
            track = array.array("h", [0] * len(answer))
            add(track, answer, 0, 10 ** (sc["echo_db"] / 20))
            onset = RATE * sc["user_onset_ms"] // 1000
            add(track, user, onset)
            entry["spans"] = [{"text": sc["segments"][0]["text"], "start_ms": sc["user_onset_ms"],
                               "end_ms": (onset + len(user)) * 1000 // RATE}]
            entry["echo_db"] = sc["echo_db"]
        track.extend(array.array("h", bytes(2 * RATE * 3)))
        mixed = noise(len(track))
        for i, v in enumerate(track):
            mixed[i] = max(-32768, min(32767, mixed[i] + v))
        bench.write_wav(out / f"{sc['id']}.wav", mixed)
        entry["duration_ms"] = len(mixed) * 1000 // RATE
        entry["speech_end_ms"] = spans[-1]["end_ms"] if spans else None
        if sc["kind"] == "barge-in":
            entry["speech_end_ms"] = entry["spans"][-1]["end_ms"]
        entries.append(entry)
    (out / "manifest.json").write_text(json.dumps({"voice": "synthetic", "fixtures": entries}, indent=1))


def fixtures(where: Path, synthetic: bool = False) -> dict:
    if synthetic:
        where = TMP / "synthetic"
        synthesize(where)
    elif not (where / "manifest.json").exists():
        has_voice = shutil.which("say") and "Yelda" in subprocess.run(
            ["say", "-v", "?"], capture_output=True, text=True).stdout
        if has_voice:
            subprocess.run([sys.executable, str(BENCH / "make_fixtures.py"), "--out", str(where)], check=True,
                           capture_output=True)
        else:
            synthesize(where)
    m = json.loads((where / "manifest.json").read_text())
    return {f["id"]: {**f, "samples": bench.read_wav(where / f"{f['id']}.wav"), "dir": where}
            for f in m["fixtures"]}


# ── stand-ins for the two models ─────────────────────────────────────────────
# What each caller has said so far, on its session's timeline: the replaying
# recogniser reads it, the caller writes it as it streams a fixture.
TIMELINES: dict[str, list[tuple[int, int, str]]] = {}


class Replay:
    """Returns the words whose audio lies wholly inside the clip it is given:
    what a perfect recogniser would say for that stretch, and nothing at all
    for a stretch with no words in it."""

    def __init__(self, key: str, mode: str):
        self.key, self.mode, self.calls = key, mode, 0

    async def __call__(self, clip: voice.Clip) -> str:
        self.calls += 1
        await asyncio.sleep(0.08 if not clip.final else 0.2)
        if self.mode == "stt-fail":
            raise RuntimeError("recogniser down")
        said = [t for a, b, t in TIMELINES.get(self.key, []) if a >= clip.start_ms - 150 and b <= clip.end_ms]
        return " ".join(said)


REQUEST = re.compile(r"çalıştır\b|bitir\b|düzelt\b|deploy et|merge et|kontrol eder misin|bakar mısın|gönder\b", re.I)
SHORT = ["Şu an ", "bir sohbet ", "çalışıyor, ", "biri de onay bekliyor. ", "Başka bir şey yok. "]
LONG = [f"Bu uzun cevabın {n}. cümlesi, yavaş yavaş okunuyor. " for n in range(1, 13)]


class Scripted:
    """The conversational layer as a scripted stream. In `act` mode a request
    (by its verb) is an intent and nothing is said; a question is answered.
    `talk` never acts; `slow` answers at length, a sentence every 350 ms;
    `brain-fail` fails every time."""

    def __init__(self, mode: str, chat_id: str | None):
        self.mode, self.chat_id = mode, chat_id
        self.asked: list[str] = []
        self.cancels = 0

    async def reply(self, text, lang, intend):
        self.asked.append(text)
        await asyncio.sleep(3.2 if self.mode == "late" else 0.15)   # a slow or a warm model's first token
        if self.mode == "brain-fail":
            raise RuntimeError("model unavailable")
        if self.mode == "act" and REQUEST.search(text):
            if self.chat_id:
                intend("forward", {})
            else:
                intend("start", {"project": "app", "instruction": text})
            return
        if self.mode == "claim":
            for piece in ("Tamam, testleri çalıştırdım. ", "Şu an bir sohbet çalışıyor. "):
                yield piece
            return
        if self.mode == "promise":
            yield "Hemen bakıyorum. "
            return
        for piece in (LONG if self.mode == "slow" else SHORT):
            yield piece
            await asyncio.sleep(0.35 if self.mode == "slow" else 0.04)

    async def cancel(self):
        self.cancels += 1

    async def warm(self):
        pass

    async def close(self):
        pass


# ── the phone ────────────────────────────────────────────────────────────────
class Phone:
    def __init__(self, ws):
        self.ws, self.rid, self.events = ws, 0, []
        self.waiting: dict[int, asyncio.Future] = {}
        self.arrived = asyncio.Event()
        self.replies: list[dict] = []
        self.reader = asyncio.create_task(self._read())

    async def _read(self):
        async for raw in self.ws:
            m = json.loads(raw)
            m["_at"] = time.time()
            if m.get("type") == "event":
                self.events.append(m)
                self.arrived.set()
            elif m.get("id") in self.waiting:
                self.waiting.pop(m["id"]).set_result(m)
            else:
                self.replies.append(m)

    async def call(self, typ, data=None):
        self.rid += 1
        fut = asyncio.get_running_loop().create_future()
        self.waiting[self.rid] = fut
        await self.ws.send(json.dumps({"id": self.rid, "type": typ, "data": data or {}}))
        m = await asyncio.wait_for(fut, 60)
        if m["type"] == "error":
            raise RuntimeError(f"{typ}: {m['data']}")
        return m["data"]

    async def tell(self, typ, data):
        await self.ws.send(json.dumps({"type": typ, "data": data}))

    def voice(self, sid, name=None):
        return [e for e in self.events if e["event"].startswith("voice.")
                and e["data"].get("session_id") == sid and (name is None or e["event"] == name)]

    async def until(self, pred, timeout=30.0, what=""):
        deadline = time.monotonic() + timeout
        while True:
            for e in self.events:
                if pred(e):
                    return e
            self.arrived.clear()
            left = deadline - time.monotonic()
            if left <= 0:
                raise TimeoutError(f"waited {timeout}s for {what}")
            try:
                await asyncio.wait_for(self.arrived.wait(), left)
            except asyncio.TimeoutError:
                pass


class Caller:
    """One voice session: streams audio in real time and plays what it is told."""

    def __init__(self, phone: Phone, key: str):
        self.phone, self.key = phone, key
        self.sent = 0                          # samples streamed
        self.seq = 0
        self.sid = None
        TIMELINES[key] = []

    async def start(self, **data):
        r = await self.phone.call("voice.start", {"lang": "tr-TR", "sample_rate": RATE,
                                                  "client": {"build": "test", "device": self.key}, **data})
        self.sid = r["session_id"]
        return r

    def ms(self):
        return self.sent * 1000 // RATE

    async def stream(self, samples, on_chunk=None) -> float:
        """Release audio in 100 ms messages on the wall clock. Returns the wall
        time its first sample was released."""
        t0 = time.perf_counter()
        wall0 = time.time()
        i = 0
        while i < len(samples):
            due = t0 + i / RATE
            await asyncio.sleep(max(0.0, due - time.perf_counter()))
            chunk = samples[i:i + CHUNK]
            if on_chunk is not None:
                chunk = await on_chunk(i, chunk)
            await self.phone.tell("voice.audio", {"session_id": self.sid, "seq": self.seq,
                                                  "t_client_ms": int(time.time() * 1000),
                                                  "pcm_b64": base64.b64encode(chunk.tobytes()).decode()})
            self.seq += 1
            self.sent += len(chunk)
            i += CHUNK
        return wall0

    async def say(self, fx: dict, on_chunk=None) -> dict:
        """Speak one fixture: its words go on the timeline, its audio on the wire."""
        off = self.ms()
        TIMELINES[self.key].extend((off + s["start_ms"], off + s["end_ms"], s["text"]) for s in fx["spans"])
        wall0 = await self.stream(fx["samples"], on_chunk)
        end = fx.get("speech_end_ms")
        return {"offset_ms": off, "wall0": wall0,
                "speech_end_wall": None if end is None else wall0 + end / 1000}

    async def quiet(self, seconds: float):
        await self.stream(array.array("h", bytes(int(RATE * seconds) * 2)))


def silence(seconds):
    return array.array("h", bytes(int(RATE * seconds) * 2))


def norm(text):
    return " ".join(bench.normalize_tr(text))


def no_stale_audio(events: list[dict]) -> str | None:
    """None, or what broke the rule: no piece of a turn after that turn was
    cancelled or after a newer turn's first event, and ids never go back."""
    newest, dead = 0, set()
    for e in events:
        tid = e["data"].get("turn_id", 0)
        if e["event"] == "voice.say":
            if tid in dead:
                return f"say of cancelled turn {tid}: {e['data'].get('text')!r}"
            if tid < newest:
                return f"say of turn {tid} after turn {newest} began: {e['data'].get('text')!r}"
        if e["event"] == "voice.cancel":
            dead.add(tid)
        newest = max(newest, tid)
    return None


# ── the daemon ───────────────────────────────────────────────────────────────
E2E_ACCOUNT = "claude-voice-e2e"
SLOW_START = [0.0]                    # seconds the general call's "start work" takes, set by a test


class SlowHub(voice.Hub):
    async def start_work(self, project, instruction):
        await asyncio.sleep(SLOW_START[0])
        return await super().start_work(project, instruction)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def daemon(real: bool, account_home: str | None, agent_home: str | None = None):
    """`agent_home`: chats run a real Claude agent on that existing account
    (`E2E_ACCOUNT`) instead of the scripted demo; only the end-to-end run asks."""
    import uvicorn
    from remote_ai_chat.server import Server
    projects = TMP / "projects"
    (projects / "app").mkdir(parents=True, exist_ok=True)
    (projects / "app" / "README.md").write_text("# Sample app\n\nA small exmaple project.\n")
    cfg = Config.load()
    cfg.bind = ["127.0.0.1"]
    cfg.allowed_roots = [str(projects)]
    cfg.auto_update = False
    cfg.demo = agent_home is None             # chats run the scripted demo agent, never a CLI
    if agent_home:
        cfg.accounts = {E2E_ACCOUNT: {"provider": "claude", "label": "voice e2e",
                                      "home": os.path.expanduser(agent_home)}}
    _, token = cfg.add_device("test")
    port = free_port()
    srv = Server(cfg)
    if real:
        from llm_latency import STATE
        home = os.path.expanduser(account_home)

        def brain(s, d):
            # The proof's synthetic state, so the timings compare with proof.json.
            return voice.FastLayer(lambda: (STATE, []), lambda: (home, {}), chat_id=s.chat_id)
        srv.voice = voice.Hub(srv, brain_factory=brain)
    else:
        def rec(s, d):
            c = d.get("client") or {}
            return Replay(c.get("device", ""), c.get("mode", ""))

        def brain(s, d):
            return Scripted((d.get("client") or {}).get("mode", "talk"), s.chat_id)
        srv.voice = SlowHub(srv, recognizer_factory=rec, brain_factory=brain)
    uc = uvicorn.Config(srv.app, host="127.0.0.1", port=port, log_level="warning",
                        ws_ping_interval=None, ws_ping_timeout=None)
    server = uvicorn.Server(uc)
    task = asyncio.create_task(server.serve())
    for _ in range(100):
        if server.started:
            break
        await asyncio.sleep(0.05)
    return srv, server, task, port, token, projects


async def connect(port, token):
    ws = await websockets.connect(f"ws://127.0.0.1:{port}/ws?token={token}", max_size=8 * 1024 * 1024)
    phone = Phone(ws)
    await phone.call("hello", {"device_name": "test", "lang": "tr"})
    return phone


# ── 1 · the replay: every scenario, at once ──────────────────────────────────
SPEECH = ["short-greeting", "short-status", "long-request", "pause-500", "pause-1000", "pause-1500",
          "pause-2000", "two-pauses", "correction", "correction-pause", "tech-names", "tech-agents"]


async def replay(port, token, fx: dict) -> None:
    print("replay: every scenario, in parallel sessions (one phone each)")
    callers = {}
    for sid in SPEECH + ["silence"]:
        c = Caller(await connect(port, token), f"replay-{sid}")
        await c.start()
        callers[sid] = c
    await asyncio.gather(*(c.say(fx[sid]) for sid, c in callers.items()))
    await asyncio.gather(*(c.quiet(1.0) for c in callers.values()))
    for sid in SPEECH:
        phone = callers[sid].phone
        ev = phone.voice(callers[sid].sid)
        turns = [e for e in ev if e["event"] == "voice.turn"]
        texts = [norm(e["data"]["committed_text"]) for e in turns]
        check(len(turns) == 1 and texts[0] == norm(fx[sid]["reference"]),
              f"{sid}: one committed turn with every word", f"{texts}")
        says = [e for e in ev if e["event"] == "voice.say"]
        check(bool(turns) and any(e["data"]["turn_id"] == turns[0]["data"]["turn_id"] and e["data"]["text"]
                                  for e in says),
              f"{sid}: answered under the committed turn's id")
        bad = no_stale_audio(ev)
        check(bad is None, f"{sid}: no piece of an old or cancelled turn", bad or "")
    multi = [s for s in ("pause-1000", "pause-1500", "two-pauses")
             if not any(e["event"] == "voice.cancel" for e in callers[s].phone.voice(callers[s].sid))]
    check(multi == ["pause-1000", "pause-1500", "two-pauses"],
          "a pause after a joining word starts no reply at all", str(multi))
    for sid in ("pause-2000", "correction-pause"):
        ev = callers[sid].phone.voice(callers[sid].sid)
        cancels = [e["data"]["reason"] for e in ev if e["event"] == "voice.cancel"]
        check(cancels == ["resumed"], f"{sid}: the early reply is cancelled when speech resumes", str(cancels))
    ev = callers["silence"].phone.voice(callers["silence"].sid)
    check(not [e for e in ev if e["event"] in ("voice.transcript", "voice.turn", "voice.say")],
          "silence: no transcript, no turn, nothing said",
          str([e["event"] for e in ev if e["event"] != "voice.state"]))
    for c in callers.values():
        await c.phone.call("voice.stop", {"session_id": c.sid})
        c.phone.reader.cancel()
        await c.phone.ws.close()


# ── 2 · barge-in ─────────────────────────────────────────────────────────────
async def barge(phone: Phone, fx: dict) -> None:
    print("barge-in: the caller cuts into a long answer")
    c = Caller(phone, "barge")
    await c.start(client={"build": "test", "device": "barge", "mode": "slow"})
    await c.say(fx["short-status"])
    first = await phone.until(lambda e: e["event"] == "voice.say" and e["data"]["session_id"] == c.sid,
                              10, "the first piece")
    old = first["data"]["turn_id"]
    await phone.tell("voice.playback", {"session_id": c.sid, "turn_id": old, "piece": 0, "state": "started",
                                        "played_ms": 0, "t_client_ms": int(time.time() * 1000)})
    bfx = fx["barge-in"]
    echo = bench.read_wav(bfx["dir"] / "barge-in.assistant.wav")
    gain = 10 ** (bfx["echo_db"] / 20)
    state = {"run": 0, "barged_at": None}

    async def phone_side(i, chunk):
        # The phone's own detector (plan §4): over the echo, 120 ms. Once it
        # has fired the player is stopped, so the microphone hears no answer.
        if state["barged_at"] is not None:
            return array.array("h", (max(-32768, min(32767, int(v - gain * (echo[i + k] if i + k < len(echo) else 0))))
                                     for k, v in enumerate(chunk)))
        for f in range(0, len(chunk) - 319, 320):
            if bench.frame_db(chunk[f:f + 320])[0] >= voice.BARGE_DB:
                state["run"] += 1
                if state["run"] * 20 >= voice.BARGE_MIN_MS:
                    state["barged_at"] = time.time()
                    await phone.tell("voice.barge", {"session_id": c.sid, "turn_id": old,
                                                     "played_ms": 1500, "t_client_ms": int(time.time() * 1000)})
                    break
            else:
                state["run"] = 0
        return chunk

    info = await c.say(bfx, phone_side)
    await c.quiet(1.0)
    ev = phone.voice(c.sid)
    check(state["barged_at"] is not None and state["barged_at"] - info["wall0"] > bfx["spans"][0]["start_ms"] / 1000,
          "the phone-side detector fires on the caller, not on the echo before them")
    cancel = [e for e in ev if e["event"] == "voice.cancel" and e["data"]["turn_id"] == old]
    check(bool(cancel) and cancel[0]["data"]["reason"] == "barge", "the answer is cancelled as a barge-in",
          str([e["data"] for e in cancel]))
    late = [e for e in ev if e["event"] == "voice.say" and e["data"]["turn_id"] == old
            and e["_at"] > (cancel[0]["_at"] if cancel else 0)]
    check(not late, "and none of it is sent after the cancel", str([e["data"]["text"] for e in late]))
    turns = [e for e in ev if e["event"] == "voice.turn"]
    check(len(turns) == 2 and norm(turns[1]["data"]["committed_text"]) == norm(bfx["reference"])
          and turns[1]["data"]["turn_id"] > old,
          "the cut-in becomes the next turn, under a newer id", str([e["data"] for e in turns]))
    check(no_stale_audio(ev) is None, "no piece of an old or cancelled turn", no_stale_audio(ev) or "")
    await phone.call("voice.stop", {"session_id": c.sid})


# ── 3 · the bridge into the real chats ───────────────────────────────────────
async def chat_bridge(phone: Phone, fx: dict, projects: Path) -> None:
    print("a chat call: a request goes to the chat once; questions do not wait for it")
    chat = await phone.call("chat.create", {"provider": "claude", "cwd": str(projects / "app")})
    cid = chat["id"]
    before = {c["id"] for c in (await phone.call("chat.list", {}))["chats"]}
    c = Caller(phone, "chat")
    await c.start(chat_id=cid, client={"build": "test", "device": "chat", "mode": "act"})
    await phone.tell("voice.ready", {"session_id": c.sid, "t_client_ms": int(time.time() * 1000)})
    await c.say(fx["correction-pause"])
    turn = await phone.until(lambda e: e["event"] == "voice.turn" and e["data"]["session_id"] == c.sid, 15,
                             "the committed request")
    check(turn["data"]["routed"] == f"chat:{cid}", "the committed request is routed to this chat",
          turn["data"]["routed"])
    question = await phone.until(lambda e: e["event"] == "voice.say" and e["data"]["session_id"] == c.sid
                                 and e["data"]["kind"] == "question", 20, "the approval, asked aloud")
    # While the chat waits on its approval, an ordinary question is answered.
    asked = await c.say(fx["short-status"])
    answer = await phone.until(lambda e: e["event"] == "voice.say" and e["data"]["session_id"] == c.sid
                               and e["data"]["kind"] == "reply" and e["_at"] > asked["speech_end_wall"],
                               10, "the answer to a status question")
    waiting = (await phone.call("chat.get", {"chat_id": cid}))["chat"]["status"]
    check(waiting == "awaiting_approval" and answer["_at"] - asked["speech_end_wall"] < 2.5,
          "a status question is answered while the chat is still waiting on its approval",
          f"status={waiting} after {answer['_at'] - asked['speech_end_wall']:.2f}s")
    req = next(e for e in phone.events if e["event"] == "approval.request" and e["chat_id"] == cid)
    check(question["_at"] >= req["_at"], "the spoken question follows the real approval request")
    await phone.call("approval.respond", {"chat_id": cid, "request_id": req["data"]["request_id"],
                                          "decision": "allow"})
    done = await phone.until(lambda e: e["event"] == "turn.done" and e["chat_id"] == cid, 20, "turn.done")
    spoken = await phone.until(lambda e: e["event"] == "voice.say" and e["data"]["session_id"] == c.sid
                               and e["data"]["kind"] == "reply" and e["_at"] >= done["_at"], 10,
                               "the finished turn, spoken")
    await c.quiet(0.5)
    ev = phone.voice(c.sid)
    progress = [e for e in ev if e["event"] == "voice.say" and e["data"]["kind"] == "progress"]
    check(len(progress) == 1 and progress[0]["data"]["text"] == voice.LINES["tr"]["tool"]["Bash"],
          "one progress line, from the agent's real tool call", str([e["data"]["text"] for e in progress]))
    before_done = [e for e in ev if e["event"] == "voice.say" and e["_at"] < done["_at"]
                   and "README" in e["data"]["text"]]
    check(not before_done and "README" in spoken["data"]["text"],
          "completion is spoken only after turn.done, in the agent's own words", spoken["data"]["text"])
    events = (await phone.call("chat.get", {"chat_id": cid}))["events"]
    users = [e["data"]["text"] for e in events if e["event"] == "message.user"]
    check(len(users) == 1 and norm(users[0]) == norm(fx["correction-pause"]["reference"]),
          "the chat received the whole corrected request exactly once, never its first half", str(users))
    after = (await phone.call("chat.get", {"chat_id": cid}))["chat"]
    check(all(after[k] == chat[k] for k in ("provider", "account_id", "perm_mode", "model")),
          "on the chat's own provider, account and permission mode",
          str({k: (chat[k], after[k]) for k in ("provider", "account_id", "perm_mode")}))
    now = {c2["id"] for c2 in (await phone.call("chat.list", {}))["chats"]}
    check(now == before, "and no other chat was made", str(now - before))
    states = [e["data"]["state"] for e in ev if e["event"] == "voice.state" and e["_at"] < done["_at"]]
    check("working" in states, "while the chat works the session says it is working", str(states))
    check(no_stale_audio(ev) is None, "no piece of an old or cancelled turn", no_stale_audio(ev) or "")
    await phone.call("voice.stop", {"session_id": c.sid})

    print("the general call: a request starts work in a project, once")
    g = Caller(phone, "general")
    await g.start(client={"build": "test", "device": "general", "mode": "act"})
    await g.say(fx["long-request"])
    turn = await phone.until(lambda e: e["event"] == "voice.turn" and e["data"]["session_id"] == g.sid, 15,
                             "the committed request")
    made = [x for x in (await phone.call("chat.list", {}))["chats"] if x["id"] not in now]
    check(len(made) == 1 and turn["data"]["routed"] == f"new:{made[0]['id']}" and made[0]["cwd"].endswith("/app"),
          "one new chat in the project, and the turn says so", f"{turn['data']['routed']} {len(made)}")
    if made:
        events = (await phone.call("chat.get", {"chat_id": made[0]["id"]}))["events"]
        users = [e["data"]["text"] for e in events if e["event"] == "message.user"]
        check(len(users) == 1 and norm(users[0]) == norm(fx["long-request"]["reference"]),
              "carrying the instruction once", str(users))
    said = [e["data"]["text"] for e in phone.voice(g.sid, "voice.say") if e["data"]["turn_id"] == turn["data"]["turn_id"]]
    check(said and said[-1] == voice.LINES["tr"]["started"].format(where="app"),
          "and what is said is the bridge's own line, after it happened", str(said))
    await phone.call("voice.stop", {"session_id": g.sid})


# ── 4 · acknowledgements ─────────────────────────────────────────────────────
async def acks(phone: Phone, fx: dict) -> None:
    print("acknowledgements: only while a slow action runs, never repeated, never over the caller")
    SLOW_START[0] = 2.5
    try:
        c = Caller(phone, "ack")
        await c.start(client={"build": "test", "device": "ack", "mode": "act"})
        await phone.tell("voice.ready", {"session_id": c.sid, "t_client_ms": int(time.time() * 1000)})
        for sid in ("long-request", "tech-names"):
            await c.say(fx[sid])
            await c.quiet(3.0)
        says = [e["data"] for e in phone.voice(c.sid, "voice.say") if e["data"]["text"]]
        turns = sorted({d["turn_id"] for d in says})
        per = [[(d["kind"], d["text"]) for d in says if d["turn_id"] == t] for t in turns]
        check(len(per) == 2 and all(len(p) == 2 and p[0][0] == "ack" and p[1][1].startswith("app ") for p in per),
              "a slow action gets one acknowledgement, then the bridge's own line", str(per))
        check(len(per) == 2 and per[0][0][1] != per[1][0][1], "the next acknowledgement is a different line",
              str([p[0] for p in per]))
        await phone.call("voice.stop", {"session_id": c.sid})

        c = Caller(phone, "ack-over")
        await c.start(client={"build": "test", "device": "ack-over", "mode": "act"})
        await phone.tell("voice.ready", {"session_id": c.sid, "t_client_ms": int(time.time() * 1000)})
        await c.say(fx["long-request"])           # the commit is inside its 3 s tail; the ack would be 1.2 s after
        info = await c.say(fx["short-greeting"])
        await c.quiet(3.0)
        start = info["wall0"] + fx["short-greeting"]["spans"][0]["start_ms"] / 1000
        over = [e["data"]["text"] for e in phone.voice(c.sid, "voice.say")
                if e["data"]["kind"] == "ack" and start <= e["_at"] <= info["speech_end_wall"] + 0.7]
        check(not over, "no acknowledgement is said while the caller is talking again", str(over))
        await phone.call("voice.stop", {"session_id": c.sid})
    finally:
        SLOW_START[0] = 0.0


# ── 5 · errors and reconnecting ──────────────────────────────────────────────
async def errors(phone: Phone, fx: dict, port, token) -> None:
    print("errors: bounded, and said")
    for mode, code, line in (("stt-fail", voice.E_STT, "unheard"), ("brain-fail", voice.E_REPLY, "no_reply")):
        c = Caller(phone, f"err-{mode}")
        await c.start(client={"build": "test", "device": f"err-{mode}", "mode": mode})
        await c.say(fx["short-greeting"])
        ev = phone.voice(c.sid)
        errs = [e["data"]["code"] for e in ev if e["event"] == "voice.error"]
        said = [e["data"]["text"] for e in ev if e["event"] == "voice.say"]
        states = [e["data"]["state"] for e in ev if e["event"] == "voice.state"]
        check(errs and set(errs) == {code} and voice.LINES["tr"][line] in said and states[-1] == "listening",
              f"{mode}: {code}, a spoken notice and back to listening", f"{errs} {said} {states}")
        await phone.call("voice.stop", {"session_id": c.sid})

    c = Caller(phone, "late")
    await c.start(client={"build": "test", "device": "late", "mode": "late"})
    await c.say(fx["short-greeting"])
    await c.quiet(3.0)
    stop = await phone.call("voice.stop", {"session_id": c.sid})
    t = [x["after_speech_end_ms"] for x in stop["turns"] if x["text"]]
    check(len(t) == 1 and t[0]["commit"] < t[0]["first_say"] <= t[0]["final_stt_start"],
          "an answer slower than the commit is not raced by the commit's transcription", str(t))

    c = Caller(phone, "claim")
    await c.start(client={"build": "test", "device": "claim", "mode": "claim"})
    await c.say(fx["short-greeting"])
    said = [e["data"]["text"] for e in phone.voice(c.sid, "voice.say") if e["data"]["text"]]
    check(said == ["Şu an bir sohbet çalışıyor."],
          "a reply that claims an action nobody took has that sentence dropped", str(said))
    await phone.call("voice.stop", {"session_id": c.sid})

    c = Caller(phone, "promise")
    await c.start(client={"build": "test", "device": "promise", "mode": "promise"})
    await c.say(fx["short-greeting"])
    said = [e["data"]["text"] for e in phone.voice(c.sid, "voice.say") if e["data"]["text"]]
    check(said == [voice.LINES["tr"]["offer"]],
          "a reply that was only a dropped promise is not silence: the offer is said instead", str(said))
    await phone.call("voice.stop", {"session_id": c.sid})

    print("reconnecting")
    c = Caller(phone, "drop")
    await c.start(client={"build": "test", "device": "drop", "mode": "slow"})
    await c.say(fx["short-status"])
    first = await phone.until(lambda e: e["event"] == "voice.say" and e["data"]["session_id"] == c.sid, 10, "a piece")
    await phone.ws.close()
    await asyncio.sleep(0.5)
    phone2 = await connect(port, token)
    c.phone = phone2
    r = await c.start(session_id=c.sid)
    check(r.get("resumed") and r["session_id"] == c.sid and r["turn_id"] > first["data"]["turn_id"],
          "a dropped session is resumed under a newer turn id", str(r))
    await c.quiet(1.5)
    old = [e for e in phone2.voice(c.sid, "voice.say") if e["data"]["turn_id"] <= first["data"]["turn_id"]]
    check(not old, "and nothing of the interrupted turn is replayed", str([e["data"]["text"] for e in old]))
    await c.say(fx["short-greeting"])
    turns = phone2.voice(c.sid, "voice.turn")
    check(len(turns) == 1 and norm(turns[0]["data"]["committed_text"]) == norm(fx["short-greeting"]["reference"]),
          "and it goes on hearing turns", str([t["data"] for t in turns]))
    stop = await phone2.call("voice.stop", {"session_id": c.sid})
    check(stop["ok"] and len(stop["turns"]) >= 1, "voice.stop answers with the session's turn timings")
    try:
        await phone2.call("voice.audio", {"session_id": c.sid, "seq": 0, "pcm_b64": ""})
        check(False, "a stopped session refuses audio")
    except RuntimeError as exc:
        check(voice.E_NO_SESSION in str(exc), "a stopped session refuses audio with its code", str(exc))
    phone2.reader.cancel()
    await phone2.ws.close()


# ── 6 · the opt-in API fast layer, against a stand-in API ────────────────────
FAKE_KEY = "sk-ant-" + "fake0voice0test0" * 3        # not a key; built so no key-shaped literal sits here


async def api_layer(srv, port, token, fx: dict, projects: Path) -> None:
    """voice_api.ApiFastLayer, chosen the way the daemon chooses it
    (`Hub._fast_layer`), over a real HTTP stream from fake_anthropic.py. The
    stand-in's timing is scripted: this proves the plumbing, never the real
    API's latency."""
    import fake_anthropic as fa
    from types import SimpleNamespace
    from remote_ai_chat import voice_api
    print("the API fast layer: off by default, refused without a key")
    saved = {k: os.environ.pop(k, None) for k in (voice_api.PROVIDER_ENV, voice_api.KEY_ENV)}
    hub, factory = srv.voice, srv.voice.brain_factory
    keychain, home, read_s, url = voice_api.keychain_key, voice_api.profile_home, voice_api.READ_S, voice_api.API_URL
    fake = fa.Fake(FAKE_KEY)
    server, task, voice_api.API_URL = await fa.serve(fake)
    voice_api.keychain_key = lambda: None              # never this Mac's keychain in a test
    voice_api.profile_home = lambda resolve: None       # nor the owner's notes
    voice_api.READ_S = 1.0
    hub.brain_factory = hub._fast_layer                 # the daemon's own choice from here on
    phone = await connect(port, token)
    try:
        chat_call, general = SimpleNamespace(chat_id="x"), SimpleNamespace(chat_id=None)
        check(voice_api.settings(srv.cfg).provider == voice_api.CLI
              and type(hub._fast_layer(general, {})) is voice.FastLayer,
              "with nothing configured the fast layer is the subscription CLI")
        os.environ[voice_api.KEY_ENV] = FAKE_KEY
        check(type(hub._fast_layer(chat_call, {})) is voice.FastLayer,
              "a stored key alone opts nothing in")
        del os.environ[voice_api.KEY_ENV]
        os.environ[voice_api.PROVIDER_ENV] = voice_api.API
        c = Caller(phone, "api-nokey")
        try:
            await c.start()
            check(False, "the API layer without a key refuses the call")
        except RuntimeError as exc:
            check(voice_api.E_KEY in str(exc) and "set-key" in str(exc) and 'voice_fast_layer = "cli"' in str(exc),
                  "the API layer without a key refuses the call, saying how to store one or switch back", str(exc))
        os.environ[voice_api.PROVIDER_ENV] = "openai-realtime"
        try:
            await c.start()
            check(False, "an unknown fast layer is refused")
        except RuntimeError as exc:
            check(voice_api.E_PROVIDER in str(exc), "an unknown fast layer is refused by name", str(exc))
        check(not fake.log and not fake.lookups, "and none of that sent a single request", str(len(fake.log)))

        os.environ[voice_api.PROVIDER_ENV] = voice_api.API
        os.environ[voice_api.KEY_ENV] = FAKE_KEY
        layer = hub._fast_layer(general, {})
        check(isinstance(layer, voice_api.ApiFastLayer) and FAKE_KEY not in repr(layer),
              "opted in with a key: the API layer, whose repr does not show the key")
        await layer.close()

        print("the API layer over the socket: every scenario")
        fake.mode = "talk"
        await replay(port, token, fx)
        check(fake.log and all(e["key_ok"] and e["version"] == voice_api.API_VERSION
                               and e["body"]["stream"] and e["body"]["model"] == voice_api.DEFAULT_MODEL
                               and e["body"]["thinking"] == {"type": "disabled"} for e in fake.log),
              "streamed requests to the measured model, thinking off, with the stored key and API version")
        check(all("<state>" in e["body"]["messages"][-1]["content"][-1]["text"]
                  and all("<state>" not in str(m["content"]) for m in e["body"]["messages"][:-1]) for e in fake.log),
              "only the current question carries the state; the history does not repeat it")
        check(fake.lookups >= 1, "a call warms the connection with the unbilled model lookup", str(fake.lookups))

        print("the API layer: early pieces, and a barge-in closes the stream")
        fake.mode = "slow"
        n0 = len(fake.log)
        c = Caller(phone, "api-early")
        await c.start()
        await c.say(fx["short-status"])
        first = await phone.until(lambda e: e["event"] == "voice.say" and e["data"]["session_id"] == c.sid
                                  and e["data"]["text"], 10, "the first piece")
        await c.quiet(5.0)
        entry = fake.log[n0]
        later = [t for t, _ in entry["sent"] if t > first["_at"]]
        check(len(later) >= 3, "the first piece is spoken while the API is still streaming the rest",
              f"{len(later)} chunks after it")
        await phone.call("voice.stop", {"session_id": c.sid})
        n0 = len(fake.log)
        await barge(phone, fx)
        cancelled = fake.log[n0]
        check(cancelled["aborted"] and cancelled["done_at"] is None,
              "the interrupted answer's HTTP stream is closed, not read to the end", str(len(cancelled["sent"])))

        print("the API layer: execution keeps its authority and happens once")
        fake.mode = "act"
        await chat_bridge(phone, fx, projects)
        chat = await phone.call("chat.create", {"provider": "claude", "cwd": str(projects / "app")})
        cid = chat["id"]
        fake.mode = "forward"
        c = Caller(phone, "api-forward")
        await c.start(chat_id=cid)
        await phone.tell("voice.ready", {"session_id": c.sid, "t_client_ms": int(time.time() * 1000)})
        await c.say(fx["pause-2000"])               # its early reply asks to forward, then speech resumes
        turn = await phone.until(lambda e: e["event"] == "voice.turn" and e["data"]["session_id"] == c.sid, 15,
                                 "the committed turn")
        await phone.until(lambda e: e["event"] == "approval.request" and e["chat_id"] == cid, 20, "its approval")
        users = [e["data"]["text"] for e in (await phone.call("chat.get", {"chat_id": cid}))["events"]
                 if e["event"] == "message.user"]
        cancels = [e["data"]["reason"] for e in phone.voice(c.sid, "voice.cancel")]
        check(turn["data"]["routed"] == f"chat:{cid}" and cancels == ["resumed"] and len(users) == 1
              and norm(users[0]) == norm(fx["pause-2000"]["reference"]),
              "a tool call on a reply cancelled before its commit is void; the whole turn is forwarded once",
              f"{turn['data']['routed']} {cancels} {users}")
        fake.mode = "approve"
        await c.say(fx["short-status"])
        done = await phone.until(lambda e: e["event"] == "turn.done" and e["chat_id"] == cid, 20, "turn.done")
        await c.quiet(0.5)
        events = (await phone.call("chat.get", {"chat_id": cid}))["events"]
        resolved = [e for e in events if e["event"] == "approval.resolved"]
        said = [e["data"]["text"] for e in phone.voice(c.sid, "voice.say") if e["data"]["kind"] == "reply"]
        check(len(resolved) == 1 and voice.LINES["tr"]["allowed"] in said and done is not None,
              "an approval answered by voice goes through the server's own approval, once, after the commit",
              f"{len(resolved)} {said}")
        after = (await phone.call("chat.get", {"chat_id": cid}))["chat"]
        check(all(after[k] == chat[k] for k in ("provider", "account_id", "perm_mode", "model")),
              "on the chat's own provider, account and permission mode")
        await phone.call("voice.stop", {"session_id": c.sid})

        print("the API layer: failures are bounded and said")
        for mode, requests, label in (("429", 1, "rate limit: one request, then it waits as told"),
                                      ("401", 1, "refused key: one request, and the error says how to fix it"),
                                      ("529", 4, "overloaded: one retry per turn"),
                                      ("midfail", 4, "an error event mid-stream: one retry per turn"),
                                      ("stall", 4, "a stalled stream: read timeout, one retry per turn")):
            fake.mode = mode
            n0 = len(fake.log)
            c = Caller(phone, f"api-{mode}")
            await c.start()
            info = await c.say(fx["short-greeting"])
            await c.quiet(1.0)
            err = await phone.until(lambda e: e["event"] == "voice.error" and e["data"]["session_id"] == c.sid,
                                    10, f"the {mode} error")
            await c.say(fx["short-greeting"])        # the next turn, while the provider is still failing
            await c.quiet(1.5)
            ev = phone.voice(c.sid)
            said = [e["data"]["text"] for e in ev if e["event"] == "voice.say"]
            states = [e["data"]["state"] for e in ev if e["event"] == "voice.state"]
            sent = len(fake.log) - n0
            took = err["_at"] - info["speech_end_wall"]
            check(err["data"]["code"] == voice.E_REPLY and voice.LINES["tr"]["no_reply"] in said
                  and states[-1] == "listening" and took < 5.0 and FAKE_KEY not in json.dumps(ev),
                  f"{label} ({took:.1f}s, said, back to listening)", f"{err['data']} {said} {states}")
            check(sent == requests, f"{mode}: {requests} request(s) for two failing turns", str(sent))
            if mode == "401":
                check("set-key" in err["data"]["message"], "the refused key's error says how to store another",
                      err["data"]["message"])
            await phone.call("voice.stop", {"session_id": c.sid})
        ledger = voice_api.Budget(1.0)
        check(0 < ledger.spent() < 0.25,
              "usage is counted into the day's ledger from the stream's own figures", f"{ledger.spent():.4f}")
        cap = voice_api.Budget(ledger.spent())
        try:
            cap.check()
            check(False, "a spent budget refuses the next request")
        except voice_api.BudgetSpent as exc:
            check("voice_api_daily_usd" in str(exc), "a spent budget refuses the next request, naming the setting")
    finally:
        phone.reader.cancel()
        await phone.ws.close()
        hub.brain_factory = factory
        voice_api.keychain_key, voice_api.profile_home, voice_api.READ_S, voice_api.API_URL = keychain, home, read_s, url
        for k, v in saved.items():
            os.environ.pop(k, None)
            if v is not None:
                os.environ[k] = v
        server.should_exit = True
        await asyncio.wait_for(task, 10)


# ── the measured run ─────────────────────────────────────────────────────────
MEASURED = ["short-greeting", "short-status", "long-request", "pause-500", "pause-1000", "pause-1500",
            "pause-2000", "two-pauses", "correction", "correction-pause", "tech-agents", "silence"]


def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))] if xs else None


async def measured(phone: Phone, fx: dict, rounds: int, out: Path) -> None:
    from remote_ai_chat import transcribe
    print(f"measured: real whisper ({voice.FAST_STT_MODEL} / {transcribe.MODEL}) and the real fast layer")
    c = Caller(phone, "real")
    await c.start()
    await c.quiet(6.0)                         # the greeting: both models load, the CLI warms
    await c.say(fx["short-greeting"])          # one turn nobody measures, as in the proof
    await c.quiet(4.0)
    rows = []
    for r in range(rounds):
        for sid in MEASURED:
            n0 = len(phone.events)
            info = await c.say(fx[sid])
            lo, hi = info["offset_ms"], info["offset_ms"] + fx[sid]["duration_ms"]
            mine = lambda e: (e["event"] == "voice.turn" and e["data"]["session_id"] == c.sid  # noqa: E731
                              and lo <= e["data"]["t_speech_end_ms"] <= hi)
            if fx[sid]["reference"]:
                try:
                    await phone.until(mine, 15, f"the turn of {sid}")
                except TimeoutError:
                    pass
            await c.quiet(1.0)
            ev = [e for e in phone.events[n0:] if e["event"].startswith("voice.")]
            end = info["speech_end_wall"]
            rel = lambda e: None if (e is None or end is None) else int((e["_at"] - end) * 1000)  # noqa: E731
            # Attributed by where the turn's speech ended on the session's
            # timeline, not by when it arrived: a slow turn lands after the next
            # fixture has started.
            turns = [e for e in phone.events if mine(e)]
            tid = turns[-1]["data"]["turn_id"] if turns else None
            says = [e for e in phone.events if e["event"] == "voice.say" and e["data"]["session_id"] == c.sid
                    and e["data"]["turn_id"] == tid and e["data"]["text"]]
            partial = [e for e in phone.events if e["event"] == "voice.transcript" and not e["data"]["final"]
                       and e["data"]["session_id"] == c.sid and e["data"]["turn_id"] == tid]
            row = {"id": sid, "round": r, "reference": fx[sid]["reference"],
                   "turns": len(turns), "committed": turns[-1]["data"]["committed_text"] if turns else "",
                   "routed": turns[-1]["data"]["routed"] if turns else None,
                   "fast_transcript": partial[-1]["data"]["text"] if partial else "",
                   "cancels": [e["data"]["reason"] for e in ev if e["event"] == "voice.cancel"],
                   "said": " ".join(e["data"]["text"] for e in says),
                   "first_piece": says[0]["data"]["text"] if says else None,
                   "after_speech_end_ms": {"fast_transcript": rel(partial[-1] if partial else None),
                                           "first_say": rel(says[0] if says else None),
                                           "commit": rel(turns[-1] if turns else None)},
                   "errors": [e["data"] for e in ev if e["event"] == "voice.error"]}
            row["wer_committed"] = bench.wer(row["reference"], row["committed"]) if row["reference"] else None
            row["wer_fast"] = bench.wer(row["reference"], row["fast_transcript"]) if row["reference"] else None
            rows.append(row)
            s = row["after_speech_end_ms"]
            print(f"  {sid:<17} first say {s['first_say']} ms  fast stt {s['fast_transcript']}  turn {s['commit']}"
                  f"  turns {row['turns']} cancels {row['cancels']}  said: {row['said'][:50]}")
    stop = await phone.call("voice.stop", {"session_id": c.sid})
    speech = [x for x in rows if x["reference"]]
    first = [x["after_speech_end_ms"]["first_say"] for x in speech if x["after_speech_end_ms"]["first_say"] is not None]
    stage = lambda k: statistics.median([x["after_speech_end_ms"][k] for x in speech  # noqa: E731
                                         if x["after_speech_end_ms"][k] is not None])
    daemon_stages = {}
    for k in ("soft_end", "fast_stt", "first_token", "first_say", "commit", "final_stt"):
        vals = [t["after_speech_end_ms"][k] for t in stop["turns"] if t["text"] and t["after_speech_end_ms"].get(k) is not None]
        daemon_stages[k] = statistics.median(vals) if vals else None
    proof = json.loads((ROOT.parent / "docs" / "voice-bench" / "proof.json").read_text())["summary"]
    summary = {
        "turns": len(speech),
        "first_say_after_speech_end_ms": {"median": statistics.median(first) if first else None,
                                          "p95": pct(first, 0.95), "n": len(first)},
        "client_stage_medians_ms": {k: stage(k) for k in ("fast_transcript", "first_say", "commit")},
        "daemon_stage_medians_ms": daemon_stages,
        "pooled_wer_committed": bench.pooled_wer([(x["reference"], x["committed"]) for x in speech]),
        "pooled_wer_fast": bench.pooled_wer([(x["reference"], x["fast_transcript"]) for x in speech]),
        "segmentation_ok": sum(1 for x in speech if x["turns"] == 1),
        "silence_turns": sum(x["turns"] for x in rows if x["id"] == "silence"),
        "silence_events": sum(1 for x in rows if x["id"] == "silence" and (x["said"] or x["fast_transcript"])),
        "errors": sum(len(x["errors"]) for x in rows),
        "baseline_proof": {"first_clause_text_median_ms": proof["stage_medians_after_speech_end_ms"]["llm_first_clause"],
                           "first_audio_median_ms": proof["first_audio_after_speech_end_ms"]["median"],
                           "first_audio_p95_ms": proof["first_audio_after_speech_end_ms"]["p95"]},
        "models": {"fast_stt": voice.FAST_STT_MODEL, "final_stt": transcribe.MODEL,
                   "fast_layer": voice.MODEL_ALIASES.get(voice.FAST_MODEL, voice.FAST_MODEL)},
        "where": "first_say is the arrival of the first voice.say on a loopback socket; no phone, no EMA",
    }
    out.write_text(json.dumps({"generated": time.strftime("%Y-%m-%d %H:%M"), "summary": summary, "rows": rows,
                               "daemon_turns": stop["turns"]}, ensure_ascii=False, indent=1))
    print(json.dumps(summary, indent=1, ensure_ascii=False))
    check(summary["segmentation_ok"] == len(speech), "every speech turn committed once, whole",
          str([(x["id"], x["turns"]) for x in speech if x["turns"] != 1]))
    check(summary["silence_turns"] == 0, "silence makes no turn")
    check(no_stale_audio(phone.voice(c.sid)) is None, "no piece of an old or cancelled turn",
          no_stale_audio(phone.voice(c.sid)) or "")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--real", action="store_true")
    ap.add_argument("--account-home")
    ap.add_argument("--rounds", type=int, default=2)
    ap.add_argument("--fixtures", default="/tmp/divan-voice-bench/fixtures")
    ap.add_argument("--synthetic", action="store_true", help="level-only audio, as CI without `say` gets")
    ap.add_argument("--out", default=str(ROOT.parent / "docs" / "voice-bench" / "voice-session.json"))
    a = ap.parse_args()
    fx = fixtures(Path(a.fixtures), a.synthetic)
    print("pieces and claims")
    check(voice.cut("Şu an iki sohbet çalışıyor, biri onay bekliyor. Diğeri", True)
          == ("Şu an iki sohbet çalışıyor,", "biri onay bekliyor. Diğeri"),
          "the first piece is the first clause of three words or more")
    check(voice.cut("biri onay bekliyor, diğeri boşta. Son", False) == ("biri onay bekliyor, diğeri boşta.", "Son"),
          "later pieces are whole sentences")
    check(voice.cut("Toplam 3,5", True) == (None, "Toplam 3,5"), "a mark with no space after it is not an end yet")
    check(all(voice.claims_action(t) for t in ("Testleri çalıştırdım.", "Sohbete ilettim.", "I've sent it.",
                                                "Hangisini deploy edeyim?", "check edeyim", "Build ettim."))
          and not any(voice.claims_action(t) for t in ("Testler bitti mi?", "İki sohbet çalışıyor.",
                                                        "It is running the tests.", "Merak ediyorum.",
                                                        "Test edildi mi?")),
          "the fast layer's own claims of having acted are recognised, statuses are not")
    check(all(voice.is_request(t) for t in ("Testleri çalıştır. Hayır dur, önce derlemeyi bitir.",
                                             "Giriş ekranındaki hatayı bir kontrol eder misin?",
                                             "Ödeme sayfasına bir bakar mısın?", "README dosyasını düzeltin."))
          and not any(voice.is_request(t) for t in ("Testler bitti mi?", "Selam, nasılsın?", "Derleme bitti mi?",
                                                     "Çalıştırdın mı testleri?", "Bakalım ne olacak.",
                                                     "Test ettin mi?")),
          "on a chat call a plain Turkish request is recognised as one, a question is not")
    check(voice.HANGING == bench.HANGING and (voice.REPLY_MS, voice.UNFINISHED_MS, voice.COMMIT_MS)
          == (bench.Plan().reply_ms, bench.Plan().unfinished_ms, bench.Plan().commit_ms),
          "the daemon's turn rule is the one the bench measured")
    srv, server, task, port, token, projects = await daemon(a.real, a.account_home)
    try:
        phone = await connect(port, token)
        if a.real:
            if not a.account_home:
                raise SystemExit("--real needs --account-home")
            await measured(phone, fx, a.rounds, Path(a.out))
        else:
            await replay(port, token, fx)
            await barge(phone, fx)
            await chat_bridge(phone, fx, projects)
            await acks(phone, fx)
            await errors(phone, fx, port, token)
            await api_layer(srv, port, token, fx, projects)
        check(not phone.replies or all(m["type"] == "error" for m in phone.replies),
              "audio, playback and barge-in messages get no receipts", str(phone.replies[:2]))
        phone.reader.cancel()
    finally:
        server.should_exit = True
        await asyncio.wait_for(task, 15)
    if failures:
        print(f"\n{len(failures)} failed")
        sys.exit(1)
    shutil.rmtree(TMP, ignore_errors=True)
    print("\nall passed")


if __name__ == "__main__":
    asyncio.run(main())
