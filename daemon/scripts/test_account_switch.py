#!/usr/bin/env python3
"""Provider/account switches preserve valid ownership and reject invalid updates."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan.accounts import Account, default_accounts
from divan.db import DB
from divan.errors import Err
from divan.server import Server


class AccountSwitchTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.server = object.__new__(Server)
        self.server.db = DB(Path(self.tmp.name) / "test.sqlite")
        self.addCleanup(self.server.db._c.close)
        self.server.accounts = {a.id: a for a in default_accounts()}
        for provider in ("claude", "codex"):
            for suffix in ("one", "two"):
                a = Account(f"{provider}-{suffix}", provider, suffix)
                self.server.accounts[a.id] = a
        self.server.policy = SimpleNamespace(project_for=lambda _: None)
        self.server.cfg = SimpleNamespace(person_names=lambda: ["Owner"])
        self.session = SimpleNamespace(reconfigure=AsyncMock())
        self.server.sessions = SimpleNamespace(peek=lambda _: self.session)
        self.server.broadcast = AsyncMock()
        self.chat = self.server.db.create_chat(
            provider="claude", account_id="claude-one", cwd=self.tmp.name,
            provider_session_id="claude-transcript")

    async def update(self, **fields):
        return await self.server.h_chat_update(None, {"chat_id": self.chat["id"], **fields})

    async def test_provider_only_switch_resolves_destination_default(self):
        chat = await self.update(provider="codex", model="gpt")
        self.assertEqual(chat["account_id"], "default-codex")
        self.assertEqual(self.server._account(chat["account_id"], chat["provider"]).provider, "codex")
        self.assertIsNone(chat["provider_session_id"])
        self.session.reconfigure.assert_awaited_once()
        self.assertEqual(self.server.broadcast.call_args.args[0]["data"], chat)

    async def test_explicit_account_is_validated_against_destination(self):
        chat = await self.update(provider="codex", account_id="codex-two")
        self.assertEqual((chat["provider"], chat["account_id"]), ("codex", "codex-two"))

    async def test_invalid_switches_are_atomic(self):
        for fields, code in (
            ({"provider": "codex", "account_id": "claude-one"}, "account_provider"),
            ({"provider": "codex", "account_id": "missing"}, "account_gone"),
            ({"provider": "missing", "account_id": "codex-one"}, "unknown_provider"),
        ):
            with self.subTest(fields=fields):
                before = self.server.db.get_chat(self.chat["id"])
                with self.assertRaises(Err) as caught:
                    await self.update(title="Must not be saved", **fields)
                self.assertEqual(caught.exception.code, code)
                self.assertEqual(self.server.db.get_chat(self.chat["id"]), before)
        self.session.reconfigure.assert_not_awaited()
        self.server.broadcast.assert_not_awaited()

    async def test_round_trip_restores_only_the_same_accounts_session(self):
        await self.update(provider="codex", account_id="codex-one")
        self.server.db.update_chat(self.chat["id"], provider_session_id="codex-transcript")
        chat = await self.update(provider="claude", account_id="claude-one")
        self.assertEqual(chat["provider_session_id"], "claude-transcript")
        chat = await self.update(provider="codex", account_id="codex-two")
        self.assertIsNone(chat["provider_session_id"])
        await self.update(provider="claude", account_id="claude-one")
        chat = await self.update(provider="codex", account_id="codex-one")
        self.assertEqual(chat["provider_session_id"], "codex-transcript")

    async def test_account_change_clears_resume_but_reselect_does_not(self):
        chat = await self.update(account_id="claude-one")
        self.assertEqual(chat["provider_session_id"], "claude-transcript")
        chat = await self.update(account_id="claude-two")
        self.assertIsNone(chat["provider_session_id"])

    async def test_unowned_legacy_sessions_are_not_resumed(self):
        self.server.db.update_chat(self.chat["id"], session_ids=json.dumps({"codex": "unknown-owner"}))
        chat = await self.update(provider="codex")
        self.assertIsNone(chat["provider_session_id"])
        chat = await self.update(provider="claude", account_id="claude-one")
        self.assertEqual(chat["provider_session_id"], "claude-transcript")


if __name__ == "__main__":
    unittest.main()
