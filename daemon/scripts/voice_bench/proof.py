#!/usr/bin/env python3
"""The proposed voice turn, end to end on one Mac, against the bench fixtures.

    PY=~/projects/remote-ai-chat/daemon/.venv312/bin/python
    RAC_WHISPER_MODEL=mlx-community/whisper-small-mlx $PY daemon/scripts/voice_bench/proof.py \
        --account-home ~/.remote-ai-chat/accounts/<claude-id> [--rounds 2] [--out docs/voice-bench/proof.json]

What is real here: the fixture audio is released in 20 ms frames on the wall
clock, the way a microphone delivers it; turn ending is decided online by the
proposed rule (`bench.Plan`: reply after 700 ms of quiet, 1800 ms when the
words trail off, commit after 2500 ms, resumed speech cancels the reply in
flight); the words come from whisper through the daemon's own `transcribe.pcm`, given
the same vocabulary lead-in as `run_baseline.py`;
the reply streams from a warm Claude session (Haiku, thinking off) on the given
account; the first spoken piece is synthesised by EMA (`ema_worker.py`, one
thread) as soon as the first sentence is complete. Barge-in plays the answer
fixture into a sink and stops it when the caller is detected over the echo.

What is not: there is no phone. "First audio" is the moment the first piece of
audio exists on this Mac, not the moment a speaker makes it audible, and the
network hop to the phone is not in it. Both are reported as unavailable.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "daemon"))
import bench  # noqa: E402
from llm_latency import STATE, SYSTEM, _SENTENCE_END  # noqa: E402
from run_baseline import VOCAB  # noqa: E402
import re  # noqa: E402

# Where the first spoken piece may end: a clause, not the whole sentence. EMA
# makes a piece before any of it plays, at about half real time on one M1 thread,
# so a four-second first sentence is two seconds of silence; its first clause is
# well under one.
_CLAUSE_END = re.compile(r"[,;:.!?…—](\s|$)")


def first_clause(text: str, min_words: int = 3) -> str | None:
    for m in _CLAUSE_END.finditer(text):
        head = text[:m.start() + 1].strip()
        if len(head.split()) >= min_words or text[m.start()] in ".!?…":
            return head
    return None

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient, ResultMessage, StreamEvent  # noqa: E402

FRAME = bench.RATE * bench.FRAME_MS // 1000
SPEECH_DB = -45.0          # level that counts as speech while nothing is playing
BARGE_DB = -35.0           # while the answer plays: above its echo, below a voice
BARGE_MIN_MS = 120         # this much speech over the echo is the caller, not a click
TTS_PY = Path.home() / "projects" / "remote-ai-chat" / "tts" / ".venv" / "bin" / "python"
SIMPLE = ["short-greeting", "short-status", "long-request", "pause-500", "pause-1000", "pause-1500",
          "pause-2000", "two-pauses", "correction", "correction-pause", "tech-agents", "silence"]


class Ema:
    """The EMA worker process: text in, time to the first piece of audio out."""

    def __init__(self):
        self.p = subprocess.Popen([str(TTS_PY), "-B", str(HERE / "ema_worker.py")], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, text=True, bufsize=1)
        assert json.loads(self.p.stdout.readline()).get("ready")
        self.lock = threading.Lock()

    def first_piece(self, text: str, tag: str) -> dict:
        # A cancelled turn's thread still finishes its own exchange; the lock
        # keeps the next turn's request from reading that one's answer.
        with self.lock:
            return self._first_piece(text, tag)

    def _first_piece(self, text: str, tag: str) -> dict:
        self.p.stdin.write(json.dumps({"id": tag, "text": text}) + "\n")
        first = json.loads(self.p.stdout.readline())
        json.loads(self.p.stdout.readline())             # the whole of it; the wav lands for listening
        return first

    def close(self):
        self.p.stdin.close()
        self.p.wait(timeout=10)


class Llm:
    def __init__(self, home: str):
        env = {k: v for k, v in os.environ.items() if k not in ("CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY")}
        env["CLAUDE_CONFIG_DIR"] = home
        self.client = ClaudeSDKClient(options=ClaudeAgentOptions(
            env=env, cwd=str(Path.home()), model="claude-haiku-4-5-20251001", system_prompt=SYSTEM, tools=[],
            setting_sources=None, permission_mode="bypassPermissions", include_partial_messages=True,
            thinking={"type": "disabled"}))

    async def start(self):
        await self.client.connect()
        await self.client.query("Warm-up. Reply OK.")
        async for m in self.client.receive_response():
            if isinstance(m, ResultMessage):
                break

        self.draining: asyncio.Task | None = None
        self.inflight = False           # a query is out and its result has not been read

    def abort(self) -> None:
        """Stop the answer in flight. The CLI still sends that turn's tail, which
        has to be read off before the next question or it would be taken as the
        next answer — so it is drained in the background, and the next turn waits
        for it (that wait is part of the measured latency)."""
        if not self.inflight:
            return                      # cancelled before it asked anything

        async def drain():
            async def tail():
                await self.client.interrupt()
                async for m in self.client.receive_response():
                    if isinstance(m, ResultMessage):
                        break
            try:
                await asyncio.wait_for(tail(), 10)
            except Exception:
                pass
            self.inflight = False
        self.draining = asyncio.create_task(drain())

    async def first_sentence(self, said: str, marks: dict, now) -> str:
        if self.draining is not None:
            await self.draining
            self.draining = None
        self.inflight = True
        await self.client.query(f"<state>\n{STATE}\n</state>\n\n{said}\n\n(Answer in Turkish.)")
        text, sentence = "", None
        async for m in self.client.receive_response():
            if isinstance(m, StreamEvent):
                d = m.event.get("delta", {})
                if m.event.get("type") == "content_block_delta" and d.get("type") == "text_delta":
                    text += d.get("text", "")
                    marks.setdefault("llm_first_token", now())
                    if "clause" not in marks and first_clause(text):
                        marks["clause"] = first_clause(text)
                        marks["llm_first_clause"] = now()
                    if sentence is None and _SENTENCE_END.search(text):
                        sentence = text
                        marks["llm_first_sentence"] = now()
            elif isinstance(m, ResultMessage):
                self.inflight = False
                break
        marks.setdefault("llm_first_sentence", now())
        marks.setdefault("llm_first_clause", marks["llm_first_sentence"])
        marks.setdefault("clause", (sentence or text).strip())
        marks["llm_done"] = now()
        return (sentence or text).strip(), text.strip()


async def one_turn(fx: dict, wav: Path, llm: Llm, ema: Ema, tag: str) -> dict:
    """Release the fixture in real time and run the proposed turn over it."""
    from remote_ai_chat import transcribe
    samples = bench.read_wav(wav)
    plan = bench.Plan()
    t0 = time.perf_counter()
    now = lambda: int((time.perf_counter() - t0) * 1000)
    heard = 0                       # samples released so far
    last_speech = None              # ms of the last speech frame
    run = 0                         # consecutive speech frames
    reply: asyncio.Task | None = None
    replies = cancels = 0
    committed = None
    marks: dict = {}
    words = ""
    log: list[dict] = []

    async def answer(upto: int, start_ms: int):
        nonlocal words
        m = {"soft_end": start_ms}
        r = await asyncio.to_thread(transcribe.pcm, samples[:upto].tobytes(), VOCAB, "tr")
        m["transcript"] = now()
        said = (r or {}).get("text", "").strip()
        words = said
        if not said or not transcribe.said(said):
            m["empty"] = True
            return m
        if bench.sounds_unfinished(said):
            # Mid-sentence: wait for the longer quiet before saying anything.
            due = (last_speech or 0) + plan.unfinished_ms
            while now() < due:
                await asyncio.sleep(0.01)
        m["said"] = said
        # The first piece is synthesised the moment its clause is complete, while
        # the rest of the answer is still streaming.
        llm_task = asyncio.create_task(llm.first_sentence(said, m, now))
        try:
            while "clause" not in m and not llm_task.done():
                await asyncio.sleep(0.005)
            piece = await asyncio.to_thread(ema.first_piece, m.get("clause") or "", tag)
            first, whole = await llm_task
        except asyncio.CancelledError:
            llm_task.cancel()
            raise
        m["reply_first_piece"], m["reply"] = m.get("clause"), whole
        m["llm_log"] = {k: m[k] for k in m if k.startswith("llm_")}
        m["first_audio"] = now()
        m["ema_first_piece_ms"] = piece["ms"]
        return m

    while heard < len(samples):
        due = t0 + (heard + FRAME) / bench.RATE
        await asyncio.sleep(max(0.0, due - time.perf_counter()))
        frame = samples[heard:heard + FRAME]
        heard += FRAME
        t = heard * 1000 // bench.RATE
        loud = bench.frame_db(frame)[0] >= SPEECH_DB if len(frame) == FRAME else False
        if loud:
            run += 1
            if run * bench.FRAME_MS >= 60:
                last_speech = t
                if reply is not None and not reply.done():
                    # They went on talking: the reply in flight is stale.
                    c0 = time.perf_counter()
                    reply.cancel()
                    llm.abort()
                    cancels += 1
                    log.append({"cancel_at": t, "cancel_ms": int((time.perf_counter() - c0) * 1000)})
                    reply = None
                elif reply is not None and reply.done():
                    reply = None            # finished before they resumed; a real call would barge in here
            continue
        run = 0
        if last_speech is None:
            continue
        quiet = t - last_speech
        if reply is None and quiet >= plan.reply_ms and committed is None and not marks:
            replies += 1
            reply = asyncio.create_task(answer(heard, t))
        if quiet >= plan.commit_ms and committed is None:
            committed = t
    if reply is not None:
        try:
            marks = await reply
        except asyncio.CancelledError:
            marks = {}
    end = fx["speech_end_ms"]
    rel = lambda k: (marks[k] - end) if (k in marks and end is not None) else None
    return {
        "id": fx["id"], "speech_end_ms": end, "said": words, "reference": fx["reference"],
        "wer": bench.wer(fx["reference"], words) if fx["reference"] else None,
        "replies_started": replies, "replies_cancelled": cancels, "cancel_log": log,
        "committed_ms": committed, "reply": marks.get("reply"),
        "first_piece": marks.get("reply_first_piece"),
        "tts_wav": f"/tmp/divan-voice-bench/ema/{tag}.wav" if marks.get("reply_first_piece") else None,
        "after_speech_end_ms": {k: rel(k) for k in ("soft_end", "transcript", "llm_first_token",
                                                     "llm_first_clause", "llm_first_sentence", "first_audio")},
        "ema_first_piece_ms": marks.get("ema_first_piece_ms"),
        "audible_playback_ms": None,      # unavailable: no phone in this proof
    }


async def barge(fx: dict, fdir: Path) -> dict:
    """The answer plays; the caller cuts in over its echo; the sink must stop."""
    mic = bench.read_wav(fdir / f"{fx['id']}.wav")
    t0 = time.perf_counter()
    now = lambda: (time.perf_counter() - t0) * 1000
    playing = True
    stop_at = detect_at = None
    heard = run = 0
    while heard < len(mic) and playing:
        due = t0 + (heard + FRAME) / bench.RATE
        await asyncio.sleep(max(0.0, due - time.perf_counter()))
        frame = mic[heard:heard + FRAME]
        heard += FRAME
        if len(frame) == FRAME and bench.frame_db(frame)[0] >= BARGE_DB:
            run += 1
            if run * bench.FRAME_MS >= BARGE_MIN_MS:
                detect_at = now()
                playing = False             # the sink: drop the queue, stop the player
                stop_at = now()
        else:
            run = 0
    onset = fx["user_onset_ms"]
    return {"id": fx["id"], "user_onset_ms": onset,
            "detected_after_onset_ms": None if detect_at is None else int(detect_at - onset),
            "stop_after_detect_ms": None if stop_at is None else round(stop_at - detect_at, 2),
            "false_trigger_before_onset": detect_at is not None and detect_at < onset,
            "note": "level detector over -24 dB echo; on the phone the stop also includes the player's own latency"}


def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))] if xs else None


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--account-home", required=True)
    ap.add_argument("--fixtures", default="/tmp/divan-voice-bench/fixtures")
    ap.add_argument("--rounds", type=int, default=2)
    ap.add_argument("--only", action="append", default=[])
    ap.add_argument("--out", default=str(ROOT / "docs" / "voice-bench" / "proof.json"))
    a = ap.parse_args()
    fdir = Path(a.fixtures)
    fx = {f["id"]: f for f in json.loads((fdir / "manifest.json").read_text())["fixtures"]}
    from remote_ai_chat import transcribe
    transcribe.pcm(bench.read_wav(fdir / "short-status.wav").tobytes(), None, "tr")     # load, untimed
    llm = Llm(os.path.expanduser(a.account_home))
    await llm.start()
    ema = Ema()
    rows = []
    try:
        # One full turn nobody measures: the first query on a fresh session and
        # the first run of each model are set-up costs a call pays during the ringback.
        await one_turn(fx["short-greeting"], fdir / "short-greeting.wav", llm, ema, "warm")
        for r in range(a.rounds):
            for sid in a.only or SIMPLE:
                row = await one_turn(fx[sid], fdir / f"{sid}.wav", llm, ema, f"{sid}-{r}")
                row["round"] = r
                rows.append(row)
                s = row["after_speech_end_ms"]
                print(f"{sid:<17} soft {s['soft_end']} stt {s['transcript']} tok {s['llm_first_token']} "
                      f"sent {s['llm_first_sentence']} audio {s['first_audio']}  replies {row['replies_started']}"
                      f"/cancel {row['replies_cancelled']}  said: {row['said'][:60]}")
        b = await barge(fx["barge-in"], fdir)
        print(json.dumps(b))
    finally:
        ema.close()
        await llm.client.disconnect()
    simple = [x["after_speech_end_ms"]["first_audio"] for x in rows if x["after_speech_end_ms"]["first_audio"] is not None]
    stage = lambda k: statistics.median([x["after_speech_end_ms"][k] for x in rows if x["after_speech_end_ms"][k] is not None])
    summary = {
        "turns": len(rows),
        "first_audio_after_speech_end_ms": {"median": statistics.median(simple), "p95": pct(simple, 0.95), "n": len(simple)},
        "stage_medians_after_speech_end_ms": {k: stage(k) for k in ("soft_end", "transcript", "llm_first_token",
                                                                    "llm_first_clause", "llm_first_sentence",
                                                                    "first_audio")},
        "ema_first_piece_ms_median": statistics.median([x["ema_first_piece_ms"] for x in rows if x["ema_first_piece_ms"]]),
        "pooled_wer": bench.pooled_wer([(x["reference"], x["said"]) for x in rows if x["reference"]]),
        "silence_replies": sum(x["replies_started"] for x in rows if x["id"] == "silence"),
        "turns_with_cancelled_reply": [x["id"] for x in rows if x["replies_cancelled"]],
        "barge_in": b,
        "audible_playback": "unavailable: no phone; add the player start and the network hop on the device",
        "whisper_model": transcribe.MODEL,
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps({"generated": time.strftime("%Y-%m-%d %H:%M"), "summary": summary,
                                       "rows": rows}, ensure_ascii=False, indent=1))
    print(json.dumps(summary, indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
