#!/usr/bin/env python3
"""How soon a conversational Claude turn has its first speakable sentence.

    PY=~/projects/divan/daemon/.venv312/bin/python
    $PY daemon/scripts/voice_bench/llm_latency.py --account-home ~/.divan/accounts/<claude-id> \
        [--rounds 2] [--out docs/voice-bench/llm.json]

The concierge (`divan/call.py`) waits for the whole answer
(`include_partial_messages=False`) and lets the model think. This measures, on a
warm session in its own CLI process, three things per simple non-tool question:
the first text token, the first complete sentence (what a sentence-streaming
voice could start speaking) and the whole answer. One configuration per row:
the concierge's own (Sonnet, default thinking) and the two candidates for a fast
conversational layer (Sonnet and Haiku with thinking disabled).

Uses the given Claude Code account and its subscription, the same way the
concierge does; the daemon is not involved and is not restarted. The questions
are synthetic and carry a small made-up state block of the size the concierge
sends, so nothing private reaches the model.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import statistics
import sys
import time
from pathlib import Path

from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, ClaudeSDKClient, ResultMessage, StreamEvent

ROOT = Path(__file__).resolve().parents[3]

SYSTEM = ("You are the voice of a developer's computer on a phone call. Answer in one or two short "
          "spoken sentences in the caller's language, no markdown, no lists. Only use the state given.")

STATE = "\n".join(
    f"{i}. chat '{t}' in project {p}: {s}" for i, (t, p, s) in enumerate([
        ("login screen error", "web-panel", "working for 12 minutes, running tests"),
        ("payment page", "mobile-app", "idle, last said the fix is merged"),
        ("settings copy", "mobile-app", "waiting for approval to run a shell command"),
        ("release notes", "web-panel", "idle for 2 hours"),
    ] * 6, 1))

QUESTIONS = [
    "Selam, şu an neler çalışıyor?",
    "Beni bekleyen bir şey var mı?",
    "Ödeme sayfası ne durumda?",
    "Tamam, teşekkürler. En son ne yapıldı?",
    "Giriş ekranındaki iş ne zamandır sürüyor?",
    "Peki ayarlar ekranı neden bekliyor?",
]

CONFIGS = {
    "sonnet-default-thinking": ("claude-sonnet-5", None),
    "sonnet-no-thinking": ("claude-sonnet-5", {"type": "disabled"}),
    "haiku-no-thinking": ("claude-haiku-4-5-20251001", {"type": "disabled"}),
}

_SENTENCE_END = re.compile(r"[.!?…](\s|$)")


async def run_config(name: str, model: str, thinking, home: str, rounds: int) -> list[dict]:
    env = {k: v for k, v in os.environ.items() if k not in ("CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY")}
    env["CLAUDE_CONFIG_DIR"] = home
    kw = dict(env=env, cwd=str(Path.home()), model=model, system_prompt=SYSTEM, tools=[],
              setting_sources=None, permission_mode="bypassPermissions", include_partial_messages=True)
    if thinking is not None:
        kw["thinking"] = thinking
    client = ClaudeSDKClient(options=ClaudeAgentOptions(**kw))
    await client.connect()
    rows = []
    try:
        # The first query on a fresh CLI pays for its lazy setup; the concierge
        # warms that away during the ringback, so it is measured apart.
        for i, q in enumerate(["Warm-up. Reply OK."] + QUESTIONS * rounds):
            t0 = time.perf_counter()
            first = sentence = None
            text = ""
            await client.query(f"<state>\n{STATE}\n</state>\n\n{q}\n\n(Answer in Turkish.)")
            async for msg in client.receive_response():
                now = time.perf_counter()
                if isinstance(msg, StreamEvent):
                    ev = msg.event
                    if ev.get("type") == "content_block_delta" and ev.get("delta", {}).get("type") == "text_delta":
                        text += ev["delta"].get("text", "")
                        first = first or now
                        if sentence is None and _SENTENCE_END.search(text):
                            sentence = now
                elif isinstance(msg, AssistantMessage) and first is None:
                    first = now
                elif isinstance(msg, ResultMessage):
                    break
            done = time.perf_counter()
            ms = lambda t: int((t - t0) * 1000) if t else None
            row = {"config": name, "question": q, "warmup": i == 0, "first_token_ms": ms(first),
                   "first_sentence_ms": ms(sentence or done), "total_ms": ms(done), "answer": text.strip()}
            rows.append(row)
            print(f"{name:<24} {'warm-up ' if i == 0 else ''}first {row['first_token_ms']}ms "
                  f"sentence {row['first_sentence_ms']}ms total {row['total_ms']}ms | {row['answer'][:70]}")
    finally:
        await client.disconnect()
    return rows


def pct(xs: list[int], q: float) -> int:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))]


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--account-home", required=True)
    ap.add_argument("--rounds", type=int, default=2)
    ap.add_argument("--only", action="append", default=[])
    ap.add_argument("--out", default=str(ROOT / "docs" / "voice-bench" / "llm.json"))
    a = ap.parse_args()
    rows = []
    for name, (model, thinking) in CONFIGS.items():
        if a.only and name not in a.only:
            continue
        rows += await run_config(name, model, thinking, os.path.expanduser(a.account_home), a.rounds)
    summary = {}
    for name in CONFIGS:
        rs = [r for r in rows if r["config"] == name and not r["warmup"]]
        if not rs:
            continue
        summary[name] = {k: {"median": statistics.median([r[k] for r in rs]), "p95": pct([r[k] for r in rs], 0.95)}
                         for k in ("first_token_ms", "first_sentence_ms", "total_ms")}
        summary[name]["n"] = len(rs)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps({"generated": time.strftime("%Y-%m-%d %H:%M"), "summary": summary,
                                       "rows": rows}, ensure_ascii=False, indent=1))
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
