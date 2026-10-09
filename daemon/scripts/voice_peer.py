#!/usr/bin/env python3
"""An isolated daemon for the phone's voice-session test (app/scripts/test-voice-session.cjs).

    python scripts/voice_peer.py [--fixtures /tmp/divan-voice-bench/fixtures] [--synthetic]
    $PY scripts/voice_peer.py --real --account-home ~/.remote-ai-chat/accounts/<claude-id> [--agent]

The daemon of `test_voice.py` — its own RAC_HOME and free loopback port under a
temporary folder, demo chats, the replaying recogniser and the scripted fast
layer — served until stdin closes. The running daemon is never touched.

The phone under test is JavaScript in another process, so the words each
caller has said cannot be handed over in memory: the caller writes them to
`<timelines>/<device>.json` (`[[start_ms, end_ms, text], ...]` on the session's
audio timeline) before it streams them, and the recogniser reads that file.

`--real` is the end-to-end run's daemon (app/scripts/voice-e2e.cjs): the
daemon's own whisper and the real fast layer (Haiku through the Claude Code CLI
on the given, already signed-in account), answering from this daemon's own
snapshot as the product does. With `--agent` its chats are real Claude agents on
that account too, in a throwaway project, instead of the scripted demo.

`--fast-layer anthropic-api` puts the fast layer on the Messages API instead
(voice_api.py), with the key stored for Divan's voice (`voice_api set-key` or
RAC_VOICE_ANTHROPIC_API_KEY) and a spending cap for this run alone
(`--api-cap-usd`, its ledger in this daemon's own RAC_HOME). This is a paid
request per turn: run it only with the owner's say-so. The caller's profile
notes are left out of its prompt; the snapshot is this isolated daemon's.
`--api-url` points it at a stand-in (scripts/fake_anthropic.py) for a free
dry run of the same plumbing, which says nothing about the real API's speed.

Prints one JSON line: {port, token, timelines, fixtures, projects, fast_layer}.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_voice as tv                                         # noqa: E402
from remote_ai_chat import voice, voice_api                    # noqa: E402


class FileTimelines(dict):
    def __init__(self, where: Path):
        super().__init__()
        self.where = where

    def get(self, key, default=None):
        f = self.where / f"{key}.json"
        try:
            return [tuple(x) for x in json.loads(f.read_text())]
        except (OSError, ValueError):
            return default


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", default="/tmp/divan-voice-bench/fixtures")
    ap.add_argument("--synthetic", action="store_true")
    ap.add_argument("--real", action="store_true")
    ap.add_argument("--account-home")
    ap.add_argument("--agent", action="store_true")
    ap.add_argument("--fast-layer", choices=voice_api.PROVIDERS, default=voice_api.CLI)
    ap.add_argument("--api-model", default=voice_api.DEFAULT_MODEL)
    ap.add_argument("--api-cap-usd", type=float, default=0.50)
    ap.add_argument("--api-url")
    a = ap.parse_args()
    if a.real and not a.account_home and (a.fast_layer == voice_api.CLI or a.agent):
        raise SystemExit("--real needs --account-home (the CLI fast layer and --agent run on it)")
    fx = tv.fixtures(Path(a.fixtures), a.synthetic)
    where = tv.TMP / "timelines"
    where.mkdir(parents=True, exist_ok=True)
    tv.TIMELINES = FileTimelines(where)
    srv, server, task, port, token, projects = await tv.daemon(
        False, None, agent_home=a.account_home if a.real and a.agent else None)
    layer = {"provider": a.fast_layer}
    if a.real:
        home = str(Path(a.account_home).expanduser()) if a.account_home else None
        if a.fast_layer == voice_api.API:
            key = voice_api.require_key()          # refuses here, before anything is sent
            budget = voice_api.Budget(a.api_cap_usd)
            layer.update(model=a.api_model, cap_usd=a.api_cap_usd, ledger=str(budget.path),
                         url=a.api_url or voice_api.API_URL)
        else:
            layer.update(model=voice.MODEL_ALIASES.get(voice.FAST_MODEL, voice.FAST_MODEL), via="claude code cli")

        def brain(s, d):
            snap = ((lambda: voice.chat_state(srv.db, srv.sessions, s.chat_id)) if s.chat_id
                    else srv.call_snapshot)
            if a.fast_layer == voice_api.API:
                return voice_api.ApiFastLayer(snap, key, a.api_model, chat_id=s.chat_id, home=None,
                                              budget=budget, base_url=a.api_url)
            return voice.FastLayer(snap, lambda: (home, {}), chat_id=s.chat_id)
        srv.voice = voice.Hub(srv, brain_factory=brain)
    fdir = next(iter(fx.values()))["dir"]
    print(json.dumps({"port": port, "token": token, "timelines": str(where), "fixtures": str(fdir),
                      "projects": str(projects), "account": tv.E2E_ACCOUNT if a.real and a.agent else None,
                      "fast_layer": layer}),
          flush=True)
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, sys.stdin.read)
    server.should_exit = True
    await asyncio.wait_for(task, 15)


if __name__ == "__main__":
    asyncio.run(main())
